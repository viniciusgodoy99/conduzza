import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// O resumo dos fatos que nao se deixa montar (falha fechada): o modulo e
// trocado por um que, com a trava ligada, devolve "nao montou"; o resto do
// turno e o de verdade.
const resumo = vi.hoisted(() => ({ falhar: false }));
vi.mock("@/lib/domain/conformidade/resumo-dos-fatos", async (original) => {
  const real =
    await original<
      typeof import("@/lib/domain/conformidade/resumo-dos-fatos")
    >();
  return {
    ...real,
    resumirFatosDoTurno: (
      ...args: Parameters<typeof real.resumirFatosDoTurno>
    ) =>
      resumo.falhar
        ? { ok: false as const, motivo: "longo" as const }
        : real.resumirFatosDoTurno(...args),
  };
});

import { portaDaAgendaDoSimulador } from "@/lib/agente/agenda";
import { buscarProfissionais } from "@/lib/agente/ferramentas/buscar-profissionais";
import type { PortaDaAgenda } from "@/lib/agente/ferramentas/agenda-do-turno";
import {
  executarTurnoDoAgente,
  type ClienteDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import { TEXTO_FIXO_DO_AGENTE, VERSAO_DO_PROMPT } from "@/lib/agente/prompt";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type {
  EntradaDoVerificador,
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";

import type { AgendaEmMemoria } from "./agenda-em-memoria";
import {
  AGORA,
  bancoComJornadas,
  catalogoDaAgenda,
  CLINICA,
  codigoDoProcedimento,
  configComAgenda,
  FUSO,
  PROC,
} from "./agenda-fixtures";
import { catalogoDoCadastro, TUDO_LIGADO, UNID } from "./cadastro-fixtures";

// Revisao 2 da AG2 (27/10/2026) no turno inteiro, com um LLM FALSO de
// roteiro e um verificador FALSO (nenhum teste fala com a OpenAI): o
// verificador recebe o resumo dos fatos do turno, sem dado de paciente, e o
// que ele aponta como fato sem fonte bloqueia na camada "modelo"; resumo que
// nao monta bloqueia sem chamar o verificador; buscar_profissionais com o
// procedimento que so a equipe informa; a cidade da unidade citada sozinha;
// a resposta da base que o modelo usou; e o prompt sem a unidade do horario.
// Agora e terca, 20/10/2026, 09:00 em Fortaleza.

const CATALOGO = catalogoDaAgenda();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const IDENTIFICADOR = "a".repeat(64);
const USO = {
  input_tokens: 1_000,
  output_tokens: 60,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 20 },
};

function resposta(output: unknown[]) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output,
    usage: USO,
    _request_id: "req_1",
  };
}

function ferramenta(name: string, args: unknown, callId = randomUUID()) {
  return resposta([
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "x" },
    {
      type: "function_call",
      id: `fc_${callId}`,
      call_id: callId,
      name,
      arguments: JSON.stringify(args),
      status: "completed",
    },
  ]);
}

function final(mensagem: string, perguntasDaBase: string[] = []) {
  return resposta([
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            mensagem,
            encerra_a_conversa: false,
            perguntas_da_base: perguntasDaBase,
          }),
          annotations: [],
        },
      ],
    },
  ]);
}

function clienteComRoteiro(roteiro: unknown[]) {
  const create = vi.fn(async () => roteiro.shift());
  return { responses: { create } } as unknown as ClienteDoAgente;
}

const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: null,
};
const classificador: ClassificadorDeEntrada = async () => LIMPO;

const APROVA: ResultadoDoVerificador = {
  tipo: "veredicto",
  veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: null,
};

let verificador: ReturnType<typeof vi.fn<Verificador>>;
let entradasDoVerificador: EntradaDoVerificador[];
let banco: AgendaEmMemoria;

function paciente(texto: string): MensagemDaConversa {
  return { autor: "paciente", texto };
}

const BUSCA_DE_MANHA = {
  procedimento: P_CONSULTA,
  profissional: null,
  convenio: null,
  a_partir_de: null,
  periodo: "manha",
};

function portaDoSimulador(): PortaDaAgenda {
  return portaDaAgendaDoSimulador(banco.cliente(), {
    clinicId: CLINICA,
    agora: () => AGORA,
  });
}

function entrada(
  extra: Partial<EntradaDoTurno> & { cliente: ClienteDoAgente | null },
): EntradaDoTurno {
  return {
    modelo: "gpt-6-luna",
    clinicId: CLINICA,
    identificadorDeSeguranca: IDENTIFICADOR,
    config: configComAgenda(),
    catalogo: CATALOGO,
    mensagens: [
      paciente("Oi"),
      { autor: "assistente", texto: "Olá! Como posso ajudar?" },
      paciente("Quero marcar uma consulta"),
    ],
    agoraMs: AGORA,
    fuso: FUSO,
    verificador,
    classificador,
    agenda: portaDoSimulador(),
    ...extra,
  };
}

async function turno(roteiro: unknown[], extra: Partial<EntradaDoTurno> = {}) {
  verificador.mockClear();
  entradasDoVerificador = [];
  return executarTurnoDoAgente(
    entrada({ cliente: clienteComRoteiro(roteiro), ...extra }),
  );
}

/** O resumo que o verificador recebeu na unica chamada do turno. */
function resumoRecebido(): string {
  expect(entradasDoVerificador).toHaveLength(1);
  const recebido = entradasDoVerificador[0]?.resumoDosFatos;
  expect(typeof recebido).toBe("string");
  return recebido ?? "";
}

beforeEach(() => {
  banco = bancoComJornadas();
  resumo.falhar = false;
  entradasDoVerificador = [];
  verificador = vi.fn<Verificador>(async (e) => {
    entradasDoVerificador.push(e);
    return APROVA;
  });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  resumo.falhar = false;
  vi.restoreAllMocks();
});

type Resultado = Awaited<ReturnType<typeof executarTurnoDoAgente>>;

function barrouPelaRegra(r: Resultado, categoria: string) {
  expect(r.tipo).toBe("frase_fixa");
  expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
  expect(r.desfecho).toEqual({
    tipo: "bloqueou",
    categoria,
    camada: "regra",
    motivoDaFalha: null,
  });
  expect(verificador).not.toHaveBeenCalled();
}

describe("o verificador recebe o resumo dos fatos do turno", () => {
  it("com buscar_horario: os horários livres vão no resumo; o paciente, não", async () => {
    const r = await turno(
      [
        ferramenta("buscar_horario", BUSCA_DE_MANHA),
        final("Tenho quarta, 21/10 às 8h com a Dra. Ana Lima. Pode ser?"),
      ],
      {
        mensagens: [
          paciente("Oi"),
          { autor: "assistente", texto: "Olá! Como posso ajudar?" },
          paciente(
            "Quero marcar uma consulta. Sou a Joana Prates, meu email é joana.prates@exemplo.com",
          ),
        ],
      },
    );
    expect(r.tipo).toBe("resposta");
    const texto = resumoRecebido();
    expect(texto).toContain("- terça, 20/10 às 11:15");
    expect(texto).toContain("- quarta, 21/10 às 08:00");
    expect(texto).toContain(
      "Ações que as ferramentas fizeram com sucesso nesta resposta: nenhuma.",
    );
    expect(texto).toContain("Hoje na clínica: terça-feira, 20/10/2026.");
    for (const proibido of ["Joana", "Prates", "joana.prates", "exemplo.com"]) {
      expect(texto, proibido).not.toContain(proibido);
    }
    // As mensagens do paciente seguem no campo delas, como antes.
    expect(entradasDoVerificador[0]?.mensagensDoPaciente).toHaveLength(1);
  });

  it("a resposta da base que o modelo disse ter usado vai no resumo", async () => {
    const config = configComAgenda({
      base: [
        {
          id: "0b6a6f7e-6d2c-4c0e-9a51-1f1f8b6b1a01",
          pergunta: "O que levar na consulta?",
          resposta: "Traga um documento com foto.",
          ativo: true,
        },
      ],
    });
    const r = await turno([final("Traga um documento com foto.", ["b1"])], {
      config,
    });
    expect(r.tipo).toBe("resposta");
    expect(resumoRecebido()).toContain(
      "Respostas da base publicada pela clínica usadas nesta resposta:\n- Traga um documento com foto.",
    );
  });

  it("o fato sem fonte que a regra não pega é barrado pelo verificador, na camada modelo", async () => {
    verificador.mockImplementation(async (e) => {
      entradasDoVerificador.push(e);
      return {
        tipo: "veredicto",
        veredicto: {
          aprovado: false,
          violacoes: [{ categoria: "acao_nao_executada", gravidade: "alta" }],
          confianca: "alta",
        },
        modelo: "gpt-6-luna",
        uso: null,
      };
    });
    const r = await turno([
      final("Prontinho! Já está tudo encaminhado para você."),
    ]);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.desfecho).toEqual({
      tipo: "bloqueou",
      categoria: "acao_nao_executada",
      camada: "modelo",
      motivoDaFalha: null,
    });
    expect(r.rascunhoBloqueado).toBe(
      "Prontinho! Já está tudo encaminhado para você.",
    );
    expect(r.trilha).toContainEqual({
      tipo: "bloqueio",
      texto:
        "A resposta foi bloqueada pela conformidade: ação de agenda que não foi feita.",
    });
    expect(resumoRecebido()).toContain(
      "Ações que as ferramentas fizeram com sucesso nesta resposta: nenhuma.",
    );
  });

  it("o resumo que não monta é falha fechada: a resposta não sai e o verificador não é chamado", async () => {
    resumo.falhar = true;
    const r = await turno([final("Posso ajudar com mais alguma coisa?")]);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.desfecho).toEqual({
      tipo: "bloqueou",
      categoria: "falha_verificador",
      camada: "falha",
      motivoDaFalha: "desconhecida",
    });
    expect(verificador).not.toHaveBeenCalled();
  });
});

describe("buscar_profissionais com o procedimento que só a equipe informa", () => {
  const cadastro = catalogoDoCadastro();

  it("o filtro de convênio não é aceito e não há fato de convênio", () => {
    const comConvenio = buscarProfissionais(
      cadastro,
      {
        especialidade: null,
        procedimento: "p5",
        convenio: "Unimed Nacional",
        unidade: null,
      },
      TUDO_LIGADO,
    );
    expect(JSON.parse(comConvenio.saida)).toEqual({
      resultado: "so_com_a_equipe",
      procedimento: "Implante",
    });
    expect(comConvenio.fatos).toBeUndefined();
    expect(comConvenio.passo).not.toContain("Unimed");
    // Sem o convenio, quem faz continua listado (sem fato de convenio).
    const semConvenio = buscarProfissionais(
      cadastro,
      {
        especialidade: null,
        procedimento: "p5",
        convenio: null,
        unidade: null,
      },
      TUDO_LIGADO,
    );
    expect(semConvenio.resultado).toBe("profissionais");
    expect(semConvenio.fatos).toBeUndefined();
    // O procedimento so com a equipe que DEIXA informar (p4) continua com o
    // convenio e o fato.
    const botox = buscarProfissionais(
      cadastro,
      {
        especialidade: null,
        procedimento: "p4",
        convenio: "Unimed Nacional",
        unidade: null,
      },
      TUDO_LIGADO,
    );
    expect(botox.resultado).toBe("profissionais");
    expect(botox.fatos?.coberturas?.[0]).toMatchObject({
      nome: "Unimed",
      plano: "Nacional",
      estado: "atende",
      procedimento: "Botox",
    });
  });

  it("no turno, dizer que atende o procedimento pelo convênio é barrado", async () => {
    barrouPelaRegra(
      await turno(
        [
          ferramenta("buscar_profissionais", {
            especialidade: null,
            procedimento: "p5",
            convenio: "Unimed Nacional",
            unidade: null,
          }),
          final("O Dr. Bruno Costa atende o Implante pela Unimed, sim."),
        ],
        { catalogo: cadastro },
      ),
      "cobertura_nao_verificada",
    );
  });
});

describe("consultar_unidades: o bairro e a cidade em campos próprios", () => {
  const catalogo = catalogoDoCadastro({
    unidades: [
      {
        id: UNID.centro,
        name: "Interior",
        active: true,
        logradouro: "Rua X",
        numero: "15",
        bairro: "Centro",
        cidade: "Nossa Senhora dos Remédios",
        uf: "PI",
      },
    ],
  });

  it("a cidade citada sozinha passa e vai no resumo", async () => {
    const r = await turno(
      [
        ferramenta("consultar_unidades", { unidade: null }),
        final("A outra unidade fica em Nossa Senhora dos Remédios (PI)."),
      ],
      { catalogo },
    );
    expect(r.tipo).toBe("resposta");
    expect(resumoRecebido()).toContain(
      "- Interior: endereço Rua X, 15, Centro, Nossa Senhora dos Remédios, PI; bairro Centro; cidade Nossa Senhora dos Remédios; funcionamento não cadastrado",
    );
    const r2 = await turno(
      [
        ferramenta("consultar_unidades", { unidade: null }),
        final(
          "A unidade do interior fica na Rua X, 15, em Nossa Senhora dos Remédios.",
        ),
      ],
      { catalogo },
    );
    expect(r2.tipo).toBe("resposta");
  });

  it("sem a ferramenta no turno, o mesmo texto continua barrado", async () => {
    barrouPelaRegra(
      await turno(
        [final("A outra unidade fica em Nossa Senhora dos Remédios (PI).")],
        { catalogo },
      ),
      "medicamento",
    );
  });
});

describe("o prompt até a unidade do horário chegar", () => {
  it("nunca diz em que unidade é um horário, e a versão mudou", () => {
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "Nunca diga em que unidade é um horário: a consulta de horários ainda não traz a unidade.",
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'Se buscar_profissionais disser "so_com_a_equipe", não fale de convênio nem de quem faz esse procedimento',
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "consultar_requisitos não confirma que a clínica atende o convênio",
    );
    expect(TEXTO_FIXO_DO_AGENTE).not.toMatch(/[–—]/);
    // A versao antes da revisao 2 (b7f32fc).
    expect(VERSAO_DO_PROMPT).not.toBe("agente-f6478ac0a865");
    expect(VERSAO_DO_PROMPT).toMatch(/^agente-[0-9a-f]{12}$/);
  });
});
