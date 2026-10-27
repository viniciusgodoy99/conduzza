import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { portaDaAgendaDoSimulador } from "@/lib/agente/agenda";
import { hojeNaClinica, montarFatosDoTurno } from "@/lib/agente/fatos";
import type { PortaDaAgenda } from "@/lib/agente/ferramentas/agenda-do-turno";
import type { CatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  executarTurnoDoAgente,
  type ClienteDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import { agoraNaClinica } from "@/lib/agente/prompt";
import { fatosValidos } from "@/lib/domain/conformidade/fatos-do-turno";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
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
  PROC,
} from "./agenda-fixtures";
import { catalogoDoCadastro, UNID } from "./cadastro-fixtures";

// A revisao independente da AG2 (27/10/2026) no turno inteiro, com um LLM
// FALSO de roteiro (nenhum teste fala com a OpenAI): o horario livre so com
// o horario livre que buscar_horario trouxe, conferido em par; a hora do
// paciente so negando ou perguntando; o convenio com o procedimento do
// fato; a negativa sem convenio ativo; o endereco da ferramenta com nome de
// lugar que parece sintoma; a promessa de passagem com o que o turno fez.
// Agora e terca, 20/10/2026, 09:00 em Fortaleza; a busca de manha traz
// terca, 20/10 as 11:15 e as 11:30 e quarta, 21/10 as 08:00.

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
  return { responses: { create } } as unknown as ClienteDoAgente;
}

const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: null,
};
const classificador: ClassificadorDeEntrada = async () => LIMPO;

let verificador: ReturnType<typeof vi.fn<Verificador>>;
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

async function turno(roteiro: unknown[], extra: Partial<EntradaDoTurno> = {}) {
  verificador.mockClear();
  return executarTurnoDoAgente(
    entrada({ cliente: clienteComRoteiro(roteiro), ...extra }),
  );
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

type Resultado = Awaited<ReturnType<typeof executarTurnoDoAgente>>;

function barrouPor(r: Resultado, categoria: string) {
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

function passou(r: Resultado) {
  expect(r.tipo).toBe("resposta");
  expect(verificador).toHaveBeenCalledTimes(1);
}

function passouParaAEquipe(r: Resultado) {
  expect(r.tipo).toBe("frase_fixa");
  expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
  expect(r.desfecho).toEqual({
    tipo: "escalou",
    motivo: "agente_pediu",
    gatilho: null,
    origem: "texto_do_agente",
  });
  expect(verificador).not.toHaveBeenCalled();
}

describe("os fatos novos que o turno monta", () => {
  it("os horários livres da busca e da reserva, os procedimentos, o dia de hoje e o Cadastro sem convênio", () => {
    const fatos = montarFatosDoTurno({
      config: configComAgenda(),
      catalogo: CATALOGO,
      agoraTexto: agoraNaClinica(AGORA, FUSO),
      agoraMs: AGORA,
      fuso: FUSO,
      ferramentas: [
        {
          saida: "{}",
          fatos: { horarios: [{ dia: "terça, 20/10", hora: "11:15" }] },
        },
        {
          saida: "{}",
          fatos: {
            acao: "reservou",
            horarios: [{ dia: "terça, 20/10", hora: "11:15" }],
          },
        },
      ],
    });
    expect(fatosValidos(fatos)).toBe(true);
    expect(fatos.horariosLivres).toEqual([
      { dia: "terça, 20/10", hora: "11:15" },
      { dia: "terça, 20/10", hora: "11:15" },
    ]);
    expect(fatos.procedimentos).toEqual([
      "Consulta",
      "Exame",
      "Limpeza de pele",
    ]);
    expect(fatos.hoje).toEqual({ dia: 20, mes: 10, ano: 2026 });
    expect(fatos.semConvenioAtivo).toBe(false);
    const semConvenio = montarFatosDoTurno({
      config: configComAgenda(),
      catalogo: catalogoSemConvenio(),
      agoraTexto: "x",
      agoraMs: AGORA,
      fuso: FUSO,
      ferramentas: [],
    });
    expect(semConvenio.semConvenioAtivo).toBe(true);
    expect(semConvenio.convenios).toEqual([]);
    expect(fatosValidos(semConvenio)).toBe(true);
  });

  it("hoje é o do fuso da clínica (31/12 às 23h em Fortaleza ainda é 31/12)", () => {
    expect(hojeNaClinica(Date.UTC(2027, 0, 1, 2, 0), FUSO)).toEqual({
      dia: 31,
      mes: 12,
      ano: 2026,
    });
  });
});

function catalogoSemConvenio(): CatalogoDoAgente {
  return {
    ...CATALOGO,
    convenios: [],
    conveniosDoCadastro: [],
    conveniosSoComAEquipe: [],
    vinculos: CATALOGO.vinculos.filter((v) => v.convenioId === null),
  };
}

describe("horário livre no turno", () => {
  it("a hora do paciente afirmada como livre, sem buscar_horario, é barrada; negar ou perguntar passa", async () => {
    const mensagens = [
      paciente("Oi"),
      { autor: "assistente" as const, texto: "Olá! Como posso ajudar?" },
      paciente("Pode ser às 11h15?"),
    ];
    barrouPor(
      await turno([final("Pode ser às 11h15, sim.")], { mensagens }),
      "horario_nao_verificado",
    );
    barrouPor(
      await turno([final("Anotado: às 11h15, então.")], { mensagens }),
      "horario_nao_verificado",
    );
    passou(
      await turno(
        [final("Prefere às 11h15 mesmo? Posso consultar a agenda.")],
        {
          mensagens,
        },
      ),
    );
    passou(
      await turno([final("Às 11h15 eu ainda não sei. Quer que eu consulte?")], {
        mensagens,
      }),
    );
  });

  it("com buscar_horario, o dia e a hora em par: o horário de outro dia é barrado", async () => {
    passou(
      await turno([
        ferramenta("buscar_horario", BUSCA_DE_MANHA),
        final("Tenho quarta, 21/10 às 8h com a Dra. Ana Lima. Pode ser?"),
      ]),
    );
    barrouPor(
      await turno([
        ferramenta("buscar_horario", BUSCA_DE_MANHA),
        final("Tenho às 11h15 na quarta, 21/10, com a Dra. Ana Lima."),
      ]),
      "horario_nao_verificado",
    );
  });

  it("amanhã e o período, pelo dia de hoje na clínica", async () => {
    passou(
      await turno([
        ferramenta("buscar_horario", BUSCA_DE_MANHA),
        final("Amanhã de manhã tenho às 8h com a Dra. Ana Lima. Pode ser?"),
      ]),
    );
    barrouPor(
      await turno([
        ferramenta("buscar_horario", BUSCA_DE_MANHA),
        final("Amanhã tenho às 11h15 com a Dra. Ana Lima."),
      ]),
      "horario_nao_verificado",
    );
    barrouPor(
      await turno([final("Amanhã de manhã tenho vaga com a Dra. Ana Lima.")]),
      "horario_nao_verificado",
    );
  });

  it("o horário reservado no turno também é horário livre", async () => {
    passou(
      await turno([
        ferramenta("buscar_horario", BUSCA_DE_MANHA),
        ferramenta("reservar_horario", { horario: "h1" }),
        final(
          "Tenho terça, 20/10 às 11:15 reservado para você por 10 minutos. Confirma a Consulta com a Dra. Ana Lima?",
        ),
      ]),
    );
  });
});

describe("convênio no turno, com o procedimento do fato", () => {
  it("a cobertura da Consulta não vale para o Exame", async () => {
    const busca = ferramenta("buscar_procedimento", {
      procedimento: P_CONSULTA,
      convenio: "Unimed Nacional",
    });
    passou(await turno([busca, final("A Unimed Nacional cobre a Consulta.")]));
    barrouPor(
      await turno([
        ferramenta("buscar_procedimento", {
          procedimento: P_CONSULTA,
          convenio: "Unimed Nacional",
        }),
        final("A Unimed Nacional cobre o Exame."),
      ]),
      "cobertura_nao_verificada",
    );
  });

  it("a operadora fora do Cadastro nunca tem fato, nem com outra consulta no turno", async () => {
    barrouPor(
      await turno([final("Atendemos pela Camed, sim.")]),
      "cobertura_nao_verificada",
    );
    barrouPor(
      await turno([
        ferramenta("buscar_procedimento", {
          procedimento: P_CONSULTA,
          convenio: "Unimed Nacional",
        }),
        final("Atendemos pela Camed também."),
      ]),
      "cobertura_nao_verificada",
    );
  });

  it("sem convênio ativo no Cadastro, a negativa passa; com convênio, precisa de fato", async () => {
    const negativa = "Não atendemos convênios, apenas particular.";
    passou(await turno([final(negativa)], { catalogo: catalogoSemConvenio() }));
    barrouPor(await turno([final(negativa)]), "cobertura_nao_verificada");
  });
});

describe("endereço da ferramenta com nome de lugar que parece sintoma", () => {
  const catalogo = catalogoDoCadastro({
    unidades: [
      {
        id: UNID.centro,
        name: "Centro",
        active: true,
        logradouro: "Rua das Dores",
        numero: "100",
        bairro: "Centro",
        cidade: "Fortaleza",
        uf: "CE",
      },
    ],
  });

  it("consultar_unidades traz o endereço e ele passa; o resto da resposta continua lido", async () => {
    passou(
      await turno(
        [
          ferramenta("consultar_unidades", { unidade: null }),
          final("A clínica fica na Rua das Dores, 100, Centro, Fortaleza, CE."),
        ],
        { catalogo },
      ),
    );
    barrouPor(
      await turno(
        [
          ferramenta("consultar_unidades", { unidade: null }),
          final("Fica na Rua das Dores, 100. Está com dores?"),
        ],
        { catalogo },
      ),
      "triagem",
    );
    // Sem a ferramenta, o mesmo texto e barrado (a vedacao e o endereco).
    barrouPor(
      await turno([final("A clínica fica na Rua das Dores, 100.")], {
        catalogo,
      }),
      "triagem",
    );
  });
});

describe("promessa de passagem com o que o turno fez", () => {
  const depoisDaReserva: MensagemDaConversa[] = [
    paciente("Quero marcar"),
    {
      autor: "assistente",
      texto:
        "Reservei terça, 20/10 às 11:15 por 10 minutos. Confirma a Consulta com a Dra. Ana Lima?",
    },
    paciente("Confirmo"),
  ];
  const aprovacao =
    "Pronto! Sua consulta foi marcada, pendente de aprovação da equipe. Te confirmo assim que for aprovada.";

  it("depois de agendar, avisar da aprovação é informação", async () => {
    passou(
      await turno([ferramenta("agendar", {}), final(aprovacao)], {
        mensagens: depoisDaReserva,
      }),
    );
    passou(
      await turno(
        [
          ferramenta("agendar", {}),
          final(
            "Sua consulta ficou marcada, pendente da aprovação da equipe. Te aviso assim que a equipe confirmar.",
          ),
        ],
        { mensagens: depoisDaReserva },
      ),
    );
  });

  it("sem agendar, a mesma promessa passa para a equipe", async () => {
    passouParaAEquipe(
      await turno([final("Te confirmo assim que for aprovada.")]),
    );
  });

  it("'vou conferir a agenda' sem ferramenta, ou no fim da resposta, passa para a equipe", async () => {
    passouParaAEquipe(await turno([final("Vou conferir a agenda.")]));
    passouParaAEquipe(await turno([final("Vou verificar a disponibilidade.")]));
    passouParaAEquipe(
      await turno([
        ferramenta("buscar_procedimento", {
          procedimento: P_CONSULTA,
          convenio: null,
        }),
        final("Vou verificar a disponibilidade."),
      ]),
    );
    // Com o resultado logo depois, nao e promessa.
    passou(
      await turno([
        ferramenta("buscar_horario", BUSCA_DE_MANHA),
        final("Vou verificar aqui... Tenho quarta, 21/10 às 8h. Pode ser?"),
      ]),
    );
  });
});
