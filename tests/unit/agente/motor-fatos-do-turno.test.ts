import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { portaDaAgendaDoSimulador } from "@/lib/agente/agenda";
import {
  montarFatosDoTurno,
  textosPublicadosDoTurno,
} from "@/lib/agente/fatos";
import type { PortaDaAgenda } from "@/lib/agente/ferramentas/agenda-do-turno";
import { buscarProcedimento } from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  executarTurnoDoAgente,
  rotuloDoBloqueio,
  type ClienteDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import { agoraNaClinica } from "@/lib/agente/prompt";
import { fatosValidos } from "@/lib/domain/conformidade/fatos-do-turno";
import {
  FRASE_DE_ESCALONAMENTO,
  FRASE_DO_ASSISTENTE_VIRTUAL,
} from "@/lib/domain/conformidade/frase-fixa";
import type {
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
  iso,
  PROC,
  VINC,
} from "./agenda-fixtures";

// O turno do agente com os fatos do turno ligados (AG2, 27/10/2026), com um
// LLM FALSO de roteiro: o filtro recebe as saidas das ferramentas, o texto
// publicado, as mensagens novas do paciente e o que cada ferramenta afirmou
// de convenio e de acao. Data e hora, endereco, convenio e acao de agenda
// so passam com fato; sem fato, a regra barra (frase fixa e a equipe) sem
// chamar o verificador. Nenhum teste fala com a OpenAI.

const CATALOGO = catalogoDaAgenda();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const P_EXAME = codigoDoProcedimento(CATALOGO, PROC.exame);
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

function final(mensagem: string) {
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
            perguntas_da_base: [],
          }),
          annotations: [],
        },
      ],
    },
  ]);
}

function clienteComRoteiro(roteiro: unknown[]) {
  const create = vi.fn(async () => roteiro.shift());
  return {
    cliente: { responses: { create } } as unknown as ClienteDoAgente,
    create,
  };
}

const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: null,
};
const classificador: ClassificadorDeEntrada = async () => LIMPO;

let verificador: ReturnType<typeof vi.fn<Verificador>>;

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

let banco: AgendaEmMemoria;

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
    // Uma resposta do assistente ja saiu: sem saudacao e sem aviso.
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

/** Um turno; as chamadas do verificador contam so as dele. */
async function turno(roteiro: unknown[], extra: Partial<EntradaDoTurno> = {}) {
  const { cliente } = clienteComRoteiro(roteiro);
  verificador.mockClear();
  return executarTurnoDoAgente(entrada({ cliente, ...extra }));
}

beforeEach(() => {
  banco = bancoComJornadas();
  verificador = vi.fn<Verificador>(
    async (): Promise<ResultadoDoVerificador> => ({
      tipo: "veredicto",
      veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
      modelo: "gpt-6-luna",
      uso: null,
    }),
  );
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function barrouPor(
  r: Awaited<ReturnType<typeof executarTurnoDoAgente>>,
  categoria: string,
) {
  expect(r.tipo).toBe("frase_fixa");
  expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
  expect(r.desfecho).toEqual({
    tipo: "bloqueou",
    categoria,
    camada: "regra",
    motivoDaFalha: null,
  });
  // A regra barra antes do verificador (falha fechada sem custo).
  expect(verificador).not.toHaveBeenCalled();
}

describe("data e hora no turno", () => {
  it("sem ferramenta, a hora e a data inventadas sao barradas pela regra, e a trilha diz por quê", async () => {
    const r = await turno([
      final("Tenho terça, 20/10 às 11:15 com a Dra. Ana Lima. Pode ser?"),
    ]);
    barrouPor(r, "horario_nao_verificado");
    expect(r.trilha.map((p) => p.texto)).toContain(
      `A resposta foi bloqueada pela conformidade: ${rotuloDoBloqueio("horario_nao_verificado")}.`,
    );
    expect(rotuloDoBloqueio("horario_nao_verificado")).toBe(
      "data ou horário sem confirmação na agenda",
    );
  });

  it("com buscar_horario no turno, o mesmo horário passa em outro formato", async () => {
    const r = await turno([
      ferramenta("buscar_horario", BUSCA_DE_MANHA),
      final("Tenho terça, 20/10 às 11h15 com a Dra. Ana Lima. Pode ser?"),
    ]);
    expect(r.tipo).toBe("resposta");
    expect(verificador).toHaveBeenCalledTimes(1);
  });

  it("com buscar_horario no turno, um horário que ela não trouxe é barrado", async () => {
    const r = await turno([
      ferramenta("buscar_horario", BUSCA_DE_MANHA),
      final("Tenho terça, 20/10 às 10h com a Dra. Ana Lima. Pode ser?"),
    ]);
    barrouPor(r, "horario_nao_verificado");
  });

  it("a hora que o paciente escreveu na mensagem nova passa (e só a mensagem nova)", async () => {
    const r = await turno(
      [final("Entendi, às 11:15 não dá. Prefere à tarde?")],
      {
        mensagens: [
          paciente("Oi"),
          { autor: "assistente", texto: "Olá! Como posso ajudar?" },
          paciente("Às 11:15 não posso"),
        ],
      },
    );
    expect(r.tipo).toBe("resposta");
    const antiga = await turno(
      [final("Entendi, às 11:15 não dá. Prefere à tarde?")],
      {
        mensagens: [
          paciente("Às 11:15 não posso"),
          { autor: "assistente", texto: "Certo. Prefere outro dia?" },
          paciente("Pode ser"),
        ],
      },
    );
    barrouPor(antiga, "horario_nao_verificado");
  });

  it("a hora da clínica (a linha que vai ao modelo) é fato", async () => {
    // Agora: terca, 20/10/2026, 09:00 em Fortaleza.
    const r = await turno([final("Hoje, 20/10, já são 09:00.")]);
    expect(r.tipo).toBe("resposta");
  });
});

describe("endereço no turno", () => {
  const comBase = configComAgenda({
    base: [
      {
        id: "11111111-0000-4000-8000-000000000001",
        pergunta: "Onde fica a clínica?",
        resposta: "Na Avenida Santos Dumont, 1500, sala 302, Aldeota.",
        ativo: true,
      },
    ],
  });

  it("o endereço da base publicada passa; outro número é barrado", async () => {
    const r = await turno(
      [final("A clínica fica na Av. Santos Dumont, 1500, sala 302.")],
      { config: comBase },
    );
    expect(r.tipo).toBe("resposta");
    const outro = await turno(
      [final("A clínica fica na Av. Santos Dumont, 1600.")],
      { config: comBase },
    );
    barrouPor(outro, "endereco_nao_verificado");
  });

  it("a base inativa não é fonte (não vai ao modelo)", async () => {
    const inativa = configComAgenda({
      base: [{ ...comBase.base[0]!, ativo: false }],
    });
    const r = await turno(
      [final("A clínica fica na Av. Santos Dumont, 1500, sala 302.")],
      { config: inativa },
    );
    barrouPor(r, "endereco_nao_verificado");
  });
});

describe("saudação, aviso e encerramento colados", () => {
  it("o horário e o endereço da saudação não são afirmação do modelo", async () => {
    const config = configComAgenda({
      saudacao: "Olá! Atendemos das 7h às 19h, na Rua Augusta, 900.",
    });
    const r = await turno([final("Como posso ajudar?")], {
      config,
      mensagens: [paciente("Oi")],
    });
    expect(r.tipo).toBe("resposta");
    if (r.tipo === "resposta") {
      expect(r.resposta).toContain("Rua Augusta, 900");
      expect(r.resposta).toContain(FRASE_DO_ASSISTENTE_VIRTUAL);
    }
  });

  it("o modelo pode repetir o horário da saudação publicada", async () => {
    const config = configComAgenda({
      saudacao: "Olá! Atendemos das 7h às 19h.",
    });
    const r = await turno([final("Sim, até as 19h.")], { config });
    expect(r.tipo).toBe("resposta");
  });
});

describe("convênio no turno", () => {
  it("buscar_procedimento disse 'coberto': a cobertura passa; sem a busca, é barrada", async () => {
    const texto = "Pelo Unimed Nacional, a Consulta é coberta.";
    const r = await turno([
      ferramenta("buscar_procedimento", {
        procedimento: P_CONSULTA,
        convenio: "Unimed Nacional",
      }),
      final(texto),
    ]);
    expect(r.tipo).toBe("resposta");
    barrouPor(await turno([final(texto)]), "cobertura_nao_verificada");
  });

  it("com valor no convênio, ele atende mas não 'cobre'", async () => {
    const busca = ferramenta("buscar_procedimento", {
      procedimento: P_EXAME,
      convenio: "Amil",
    });
    const atende = await turno([
      busca,
      final("Atendemos o Exame pelo Amil, e o valor é R$ 50,00."),
    ]);
    expect(atende.tipo).toBe("resposta");
    const cobre = await turno([
      ferramenta("buscar_procedimento", {
        procedimento: P_EXAME,
        convenio: "Amil",
      }),
      final("O Amil cobre o Exame."),
    ]);
    barrouPor(cobre, "cobertura_nao_verificada");
  });

  it("'sem informação' nunca vira 'não cobre'; o 'não atende' de buscar_horario vale", async () => {
    const semInformacao = await turno([
      ferramenta("buscar_procedimento", {
        procedimento: P_CONSULTA,
        convenio: "Amil",
      }),
      final("Infelizmente não atendemos o Amil na Consulta."),
    ]);
    barrouPor(semInformacao, "cobertura_nao_verificada");
    const naoAtendido = await turno([
      ferramenta("buscar_horario", {
        ...BUSCA_DE_MANHA,
        convenio: "Amil",
      }),
      final(
        "A Dra. Ana Lima não atende a Consulta pelo Amil. Quer fazer no particular?",
      ),
    ]);
    expect(naoAtendido.tipo).toBe("resposta");
  });
});

describe("ação de agenda no turno", () => {
  it("sem a ferramenta, 'marquei' é barrado", async () => {
    barrouPor(
      await turno([
        final("Marquei sua consulta, pendente da aprovação da equipe."),
      ]),
      "acao_nao_executada",
    );
  });

  it("com o agendar do simulador, 'ficou marcada' passa; o dia e a hora da reserva de antes, não (o simulador não guarda a reserva)", async () => {
    const mensagens: MensagemDaConversa[] = [
      paciente("Quero marcar"),
      {
        autor: "assistente",
        texto:
          "Reservei terça, 20/10 às 11:15 por 10 minutos. Confirma a Consulta com a Dra. Ana Lima?",
      },
      paciente("Confirmo"),
    ];
    const r = await turno(
      [
        ferramenta("agendar", {}),
        final(
          "Pronto, sua consulta ficou marcada, pendente da aprovação da equipe. A confirmação chega por aqui.",
        ),
      ],
      { mensagens },
    );
    expect(r.tipo).toBe("resposta");
    const comDia = await turno(
      [
        ferramenta("agendar", {}),
        final(
          "Pronto, sua consulta de terça, 20/10 às 11:15 ficou marcada, pendente da aprovação da equipe.",
        ),
      ],
      { mensagens },
    );
    barrouPor(comDia, "horario_nao_verificado");
  });

  it("com a reserva do turno, 'reservei' e o dia e a hora passam", async () => {
    const r = await turno([
      ferramenta("buscar_horario", BUSCA_DE_MANHA),
      ferramenta("reservar_horario", { horario: "h1" }),
      final(
        "Reservei terça, 20/10 às 11:15 por 10 minutos. Confirma a Consulta com a Dra. Ana Lima?",
      ),
    ]);
    expect(r.tipo).toBe("resposta");
  });

  it("confirmar_presenca leu a consulta: o estado e a confirmação passam, com o dia e a hora dela", async () => {
    const porta: PortaDaAgenda = {
      ...portaDoSimulador(),
      simulada: false,
      confirmarPresenca: async () => ({
        ok: true,
        inicio: iso("2026-10-21", "14:00"),
        serviceLinkId: VINC.consultaAna,
      }),
    };
    const r = await turno(
      [
        ferramenta("confirmar_presenca", {}),
        final(
          "Sua consulta está marcada para quarta, 21/10 às 14:00, e a presença ficou confirmada. Até lá!",
        ),
      ],
      { agenda: porta },
    );
    expect(r.tipo).toBe("resposta");
    const outraHora = await turno(
      [
        ferramenta("confirmar_presenca", {}),
        final(
          "Sua presença na consulta de quarta, 21/10 às 15:00 está confirmada.",
        ),
      ],
      { agenda: porta },
    );
    barrouPor(outraHora, "horario_nao_verificado");
  });
});

describe("os fatos que o turno monta", () => {
  it("as saídas das ferramentas, o texto publicado como vai ao modelo, os convênios do Cadastro e o ano no fuso da clínica", () => {
    const config = configComAgenda({
      saudacao: "Olá!",
      encerramento: "Até logo!",
      instrucoes: "Atenda com calma.",
      base: [
        {
          id: "11111111-0000-4000-8000-000000000001",
          pergunta: "Onde fica?",
          resposta: "Na Avenida Santos Dumont, 1500.",
          ativo: true,
        },
        {
          id: "11111111-0000-4000-8000-000000000002",
          pergunta: "Antiga",
          resposta: "Inativa.",
          ativo: false,
        },
      ],
    });
    const busca = buscarProcedimento(CATALOGO, {
      procedimento: P_CONSULTA,
      convenio: "Unimed Nacional",
    });
    const agoraTexto = agoraNaClinica(AGORA, FUSO);
    const fatos = montarFatosDoTurno({
      config,
      catalogo: CATALOGO,
      agoraTexto,
      agoraMs: AGORA,
      fuso: FUSO,
      ferramentas: [
        { saida: busca.saida, fatos: busca.fatos },
        { saida: '{"resultado":"reservado"}', fatos: { acao: "reservou" } },
        {
          saida: '{"resultado":"confirmada"}',
          fatos: { acao: "confirmou_presenca", consultaLida: true },
        },
      ],
    });
    expect(fatosValidos(fatos)).toBe(true);
    expect(fatos.saidasDasFerramentas).toEqual([
      busca.saida,
      '{"resultado":"reservado"}',
      '{"resultado":"confirmada"}',
    ]);
    expect(fatos.textosPublicados).toEqual([
      "Onde fica?",
      "Na Avenida Santos Dumont, 1500.",
      "Atenda com calma.",
      "Olá!",
      "Até logo!",
      `Agora na clínica: ${agoraTexto}.`,
    ]);
    expect(fatos.textosPublicados).toEqual(
      textosPublicadosDoTurno({ config, catalogo: CATALOGO, agoraTexto }),
    );
    expect(fatos.textosColados).toContain("Olá!");
    expect(fatos.textosColados).toContain("Até logo!");
    expect(fatos.textosColados).toContain(FRASE_DO_ASSISTENTE_VIRTUAL);
    expect(fatos.coberturas).toEqual([
      { nome: "Unimed", plano: "Nacional", estado: "coberto" },
    ]);
    expect(fatos.acoes).toEqual(["reservou", "confirmou_presenca"]);
    expect(fatos.consultaLida).toBe(true);
    expect(fatos.anoCorrente).toBe(2026);
    expect(fatos.convenios).toEqual([
      { nome: "Amil", plano: null },
      { nome: "Bradesco Saúde", plano: "Top" },
      { nome: "Bradesco Saúde", plano: "Flex" },
      { nome: "Unimed", plano: "Nacional" },
      { nome: "Unimed Fortaleza", plano: "Flex" },
    ]);
  });

  it("o ano é o do fuso da clínica (31/12 às 23h em Fortaleza ainda é o ano velho)", () => {
    const fatos = montarFatosDoTurno({
      config: configComAgenda(),
      catalogo: CATALOGO,
      agoraTexto: "x",
      agoraMs: Date.UTC(2027, 0, 1, 2, 0),
      fuso: FUSO,
      ferramentas: [],
    });
    expect(fatos.anoCorrente).toBe(2026);
  });
});
