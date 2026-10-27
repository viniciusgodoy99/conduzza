import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { portaDaAgendaDoWhatsapp } from "@/lib/agente/agenda";
import { dadosVazios, estadoVazio } from "@/lib/agente/atendimento";
import type { AtendimentoDoTurno } from "@/lib/agente/ferramentas/agenda-do-turno";
import { mascararNome } from "@/lib/agente/historico";
import {
  executarTurnoDoAgente,
  type ClienteDoAgente,
  type MensagemDaConversa,
  type ResultadoDoTurno,
} from "@/lib/agente/laco";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";

import { bancoDaAg3, rpcsDaAg3 } from "@/tests/unit/agente/ag3-contrato";
import type { AgendaEmMemoria } from "@/tests/unit/agente/agenda-em-memoria";
import {
  AGORA,
  CLINICA,
  codigoDoProcedimento,
  configComAgenda,
  CONTATO,
  CONVERSA,
  FUSO,
  iso,
  PROC,
  PROF,
  VINC,
} from "@/tests/unit/agente/agenda-fixtures";
import {
  catalogoDoCadastro,
  UNID,
} from "@/tests/unit/agente/cadastro-fixtures";

// Revisao curta das correcoes da AG3 (27/10/2026): os cenarios da revisao
// (LLM FALSO de roteiro, contrato das RPCs em memoria) que valem como
// regressao do filtro no turno de verdade: os fatos saem do motor (o eco da
// busca, o profissional e a unidade da acao, a consulta relida do estado).
// O verificador aprova tudo: o que barra aqui e a camada deterministica.
// Nenhum teste fala com a OpenAI nem com o banco.

const CATALOGO = catalogoDoCadastro();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const NOME_DO_CONTATO = "Maria Souza";
const OUTRO_CONTATO = "c1000000-0000-4000-8000-000000000009";
const USO = {
  input_tokens: 1_000,
  output_tokens: 60,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 20 },
};
const USO_LIDO = {
  tokensEntrada: 1_000,
  tokensSaida: 60,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
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

function ferramenta(name: string, args: unknown) {
  const callId = randomUUID();
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

const aprovador: Verificador = async (): Promise<ResultadoDoVerificador> => ({
  tipo: "veredicto",
  veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: { ...USO_LIDO },
});
const classificador: ClassificadorDeEntrada = async () => ({
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: { ...USO_LIDO },
});

function busca(extra: Record<string, unknown> = {}) {
  return {
    procedimento: P_CONSULTA,
    profissional: null,
    convenio: null,
    a_partir_de: null,
    periodo: null,
    unidade: null,
    hora: null,
    ...extra,
  };
}

const REGISTRO = {
  nome_completo: "Fulano da Silva Souza",
  data_nascimento: "1985-03-12",
  para_o_titular: true,
  campos_mascarados: [],
};

const ambiente: { banco: AgendaEmMemoria; agora: number } = {
  banco: bancoDaAg3(),
  agora: AGORA,
};

function reiniciar() {
  ambiente.agora = AGORA;
  ambiente.banco = bancoDaAg3();
  rpcsDaAg3(ambiente.banco, {
    catalogo: CATALOGO,
    exigidos: { nomeCompleto: true, nascimento: true, cpf: false },
    agora: () => ambiente.agora,
    recusarAgendar: null,
  });
}

class Conversa {
  mensagens: MensagemDaConversa[] = [];
  atendimento: AtendimentoDoTurno;
  chamadasDoModelo = 0;
  private turnos = 0;

  constructor(atendimento?: AtendimentoDoTurno) {
    this.atendimento = atendimento ?? {
      estado: estadoVazio(),
      dados: dadosVazios(["nome_completo", "data_nascimento"]),
    };
  }

  async fala(texto: string, roteiro: unknown[]): Promise<ResultadoDoTurno> {
    if (this.turnos > 0) {
      ambiente.agora += 2 * 60_000;
    }
    this.turnos += 1;
    this.mensagens.push({
      autor: "paciente",
      texto: mascararNome(texto, NOME_DO_CONTATO),
      textoOriginal: texto,
    });
    const create = vi.fn(async () => {
      this.chamadasDoModelo += 1;
      return roteiro.shift();
    });
    const momento = ambiente.agora;
    const r = await executarTurnoDoAgente({
      cliente: { responses: { create } } as unknown as ClienteDoAgente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: "a".repeat(64),
      config: configComAgenda(),
      catalogo: CATALOGO,
      mensagens: [...this.mensagens],
      agoraMs: momento,
      fuso: FUSO,
      verificador: aprovador,
      classificador,
      agenda: portaDaAgendaDoWhatsapp(ambiente.banco.cliente(), {
        clinicId: CLINICA,
        conversationId: CONVERSA,
        contactId: CONTATO,
        jobId: randomUUID(),
        agora: () => momento,
      }),
      atendimento: this.atendimento,
      agora: () => momento,
    });
    this.mensagens.push({ autor: "assistente", texto: r.resposta });
    if (r.atendimento) {
      this.atendimento = {
        estado: r.atendimento.estado,
        dados: r.atendimento.dados,
      };
    }
    return r;
  }
}

/** A oferta e a reserva de quarta 14:00 (h2, Dra. Ana Lima, Centro). */
async function ateAReserva(conversa: Conversa) {
  await conversa.fala("Quero marcar uma consulta à tarde, no particular", [
    ferramenta("buscar_horario", busca({ periodo: "tarde" })),
    final(
      "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?",
    ),
  ]);
  await conversa.fala("Pode ser quarta às 14h", [
    ferramenta("reservar_horario", { horario: "h2" }),
    final(
      "Reservei quarta, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.",
    ),
  ]);
}

const CONFIRMA_QUARTA =
  "Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?";

/** A conversa com a consulta marcada pela IA (quarta 14:00, Ana, Centro). */
async function ateMarcar(mensagem: string) {
  const c = new Conversa();
  await ateAReserva(c);
  await c.fala("Maria da Silva Souza, nascida em 12/03/1985", [
    ferramenta("registrar_dados_do_paciente", REGISTRO),
    final(`Obrigada! ${CONFIRMA_QUARTA}`),
  ]);
  return c.fala("Sim, confirmo", [ferramenta("agendar", {}), final(mensagem)]);
}

/** O estado com a consulta de quarta 14:00 (Ana, Centro) marcada pela IA. */
function marcada(): AtendimentoDoTurno {
  const id = randomUUID();
  ambiente.banco.inserir("appointment", {
    id,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    professional_id: PROF.ana,
    service_link_id: VINC.consultaAna,
    unit_id: UNID.centro,
    starts_at: iso("2026-10-21", "14:00"),
    ends_at: iso("2026-10-21", "14:30"),
    status: "agendado",
    created_by: "ia",
    approval_status: "pendente",
  });
  return {
    estado: {
      ...estadoVazio(),
      etapa: "pos_marcacao",
      intencao: "agendar",
      procedure_id: PROC.consulta,
      professional_id: PROF.ana,
      particular: true,
      unit_id: UNID.centro,
      appointment_id: id,
      desfecho: "marcou",
    },
    dados: {
      ...dadosVazios(),
      nome_completo: true,
      data_nascimento: true,
      para_o_titular: true,
    },
  };
}

function passou(r: ResultadoDoTurno) {
  expect(r.tipo, JSON.stringify(r.desfecho)).toBe("resposta");
}

function barrou(r: ResultadoDoTurno, categoria: string) {
  expect(r.tipo).not.toBe("resposta");
  expect(r.desfecho).toMatchObject({ tipo: "bloqueou", categoria });
}

beforeEach(() => {
  reiniciar();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("achado 3: a hora pedida ocupada, dita com as negativas naturais", () => {
  function ocupada() {
    for (const [id, prof, vinc] of [
      ["o1", PROF.ana, VINC.consultaAna],
      ["o2", PROF.bruno, VINC.consultaBruno],
    ] as const) {
      ambiente.banco.inserir("appointment", {
        id,
        clinic_id: CLINICA,
        professional_id: prof,
        contact_id: OUTRO_CONTATO,
        service_link_id: vinc,
        starts_at: iso("2026-10-21", "15:00"),
        ends_at: iso("2026-10-21", "15:30"),
        status: "agendado",
      });
    }
  }

  it.each([
    "Quarta, 21/10 às 15:00 já está ocupado. Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima. Pode ser?",
    "Às 15:00 de quarta já foi preenchido, mas tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima. Serve?",
    "O horário de quarta, 21/10 às 15:00 está indisponível. Posso oferecer quarta, 21/10 às 14:00?",
    "Quarta às 15:00 a agenda está cheia. Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima.",
    "Quarta, 21/10 às 15:00 está lotado. Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima.",
    "Às 15:00 já tem paciente. Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima.",
    "Você pediu quarta às 15:00, certo? Esse já foi. Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima.",
  ])("passa: %s", async (mensagem) => {
    ocupada();
    const r = await new Conversa().fala("Tem quarta às 15h?", [
      ferramenta(
        "buscar_horario",
        busca({ a_partir_de: "2026-10-21", hora: "15:00" }),
      ),
      final(mensagem),
    ]);
    passou(r);
  });

  it("e o eco nunca prova que a hora pedida está livre", async () => {
    ocupada();
    const r = await new Conversa().fala("Tem quarta às 15h?", [
      ferramenta(
        "buscar_horario",
        busca({ a_partir_de: "2026-10-21", hora: "15:00" }),
      ),
      final("Quarta, 21/10 às 15:00 não está ocupado."),
    ]);
    barrou(r, "horario_nao_verificado");
  });
});

describe("achado 4: a consulta relida não licencia a marca forte da reserva nova", () => {
  it.each([
    "Reservei {d} às {h} para a limpeza, por 10 minutos. Te esperamos {d} às {h}!",
    "Combinado! Sua limpeza ficou para {d} às {h}.",
    "Pronto! Limpeza marcada para {d} às {h}.",
  ])("barra: %s", async (molde) => {
    const c = new Conversa(marcada());
    const P_LIMPEZA = codigoDoProcedimento(CATALOGO, PROC.limpeza);
    await c.fala("Quero marcar também uma limpeza", [
      ferramenta(
        "buscar_horario",
        busca({ procedimento: P_LIMPEZA, periodo: "tarde" }),
      ),
      final("Tenho horários para a limpeza. Qual prefere?"),
    ]);
    const mensagem = molde
      .replaceAll("{d}", "terça, 20/10")
      .replaceAll("{h}", "14:00");
    const r = await c.fala("Pode ser terça", [
      ferramenta("reservar_horario", { horario: "h1" }),
      final(mensagem),
    ]);
    barrou(r, "acao_nao_executada");
  });
});

describe("achado 5: o profissional e a unidade da ação, com os fatos do motor", () => {
  it.each([
    "Perfeito! Sua consulta está marcada com o Dr. Bruno Costa na quarta, 21/10 às 14:00.",
    "Perfeito! Sua consulta está marcada para quarta, 21/10 às 14:00 na unidade Aldeota.",
  ])("ao marcar, barra: %s", async (mensagem) => {
    barrou(await ateMarcar(mensagem), "acao_nao_executada");
  });

  it("ao marcar, com a Dra. Ana e o Centro, passa", async () => {
    passou(
      await ateMarcar(
        "Prontinho! Consulta marcada: quarta, 21/10 às 14:00, com a Dra. Ana Lima, unidade Centro. Fica pendente da aprovação da equipe e a confirmação chega por aqui.",
      ),
    );
  });

  it("no turno seguinte, a unidade da consulta relida", async () => {
    const outra = new Conversa(marcada());
    barrou(
      await outra.fala("Ficou marcada mesmo?", [
        final(
          "Sim! Sua consulta está marcada para quarta, 21/10 às 14:00, na unidade Aldeota.",
        ),
      ]),
      "acao_nao_executada",
    );
    reiniciar();
    const certa = new Conversa(marcada());
    passou(
      await certa.fala("Ficou marcada mesmo?", [
        final(
          "Sim! Sua consulta está marcada para quarta, 21/10 às 14:00, na unidade Centro, pendente da aprovação da equipe.",
        ),
      ]),
    );
  });
});

describe("achados 6 e 7: no turno da reserva e no dos dados", () => {
  it.each([
    "Combinado! Reservei quarta, 21/10 às 14:00 por 10 minutos. Me envie seu nome completo e sua data de nascimento.",
    "Ótimo, tudo certo! Reservei quarta, 21/10 às 14:00 por 10 minutos. Me envie seu nome completo e sua data de nascimento.",
    "Feito! Reservei quarta, 21/10 às 14:00 por 10 minutos. Me envie seu nome completo e sua data de nascimento.",
  ])("a interjeição com a reserva passa: %s", async (mensagem) => {
    const c = new Conversa();
    await c.fala("Quero marcar uma consulta à tarde, no particular", [
      ferramenta("buscar_horario", busca({ periodo: "tarde" })),
      final(
        "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro. Pode ser?",
      ),
    ]);
    passou(
      await c.fala("Pode ser quarta às 14h", [
        ferramenta("reservar_horario", { horario: "h2" }),
        final(mensagem),
      ]),
    );
  });

  it.each([
    "Obrigada! Pode vir quarta, 21/10 às 14:00.",
    "Obrigada! A Dra. Ana Lima te recebe quarta, 21/10 às 14:00.",
    "Obrigada! Quarta, 21/10 às 14:00 já está no seu nome.",
    "Obrigada! Quarta, 21/10 às 14:00 está confirmadíssimo.",
    "Sua consulta: quarta, 21/10 às 14:00 com a Dra. Ana Lima.",
  ])("com só a reserva, barra: %s", async (mensagem) => {
    const c = new Conversa();
    await ateAReserva(c);
    barrou(
      await c.fala("Maria da Silva Souza, nascida em 12/03/1985", [
        ferramenta("registrar_dados_do_paciente", REGISTRO),
        final(mensagem),
      ]),
      "acao_nao_executada",
    );
  });

  it.each([
    "Separei quarta, 21/10 às 14:00 para você.",
    "Guardei quarta, 21/10 às 14:00 para você. Me envie seu nome completo.",
  ])("sem reserva, barra: %s", async (mensagem) => {
    barrou(
      await new Conversa().fala(
        "Quero marcar uma consulta à tarde, no particular",
        [
          ferramenta("buscar_horario", busca({ periodo: "tarde" })),
          final(mensagem),
        ],
      ),
      "acao_nao_executada",
    );
  });
});

describe("achados 9 e 14: o portão e o plano que não é convênio", () => {
  it.each([
    "A consulta é para mim, não para minha mãe.",
    "Meu marido vai passar aí para pagar a consulta.",
    "Preciso de um horário que dê para minha mãe me levar.",
  ])("não escala no portão (o modelo é chamado): %s", async (texto) => {
    const c = new Conversa();
    const r = await c.fala(texto, [final("Claro! Para quando você gostaria?")]);
    expect(c.chamadasDoModelo).toBeGreaterThan(0);
    passou(r);
  });

  it("o pedido para a mãe continua escalando no portão", async () => {
    const c = new Conversa();
    const r = await c.fala("Quero marcar uma consulta para minha mãe", [
      final("Claro!"),
    ]);
    expect(c.chamadasDoModelo).toBe(0);
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "consulta_para_outra_pessoa",
    });
  });

  it("'meu plano era ir hoje' não é convênio", async () => {
    passou(
      await new Conversa().fala(
        "Meu plano era ir hoje à tarde, vocês aceitam cartão?",
        [final("Aceitamos sim! Quer que eu veja horários para hoje à tarde?")],
      ),
    );
  });
});
