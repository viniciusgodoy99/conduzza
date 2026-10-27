import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { portaDaAgendaDoWhatsapp } from "@/lib/agente/agenda";
import {
  dadosVazios,
  estadoVazio,
  type EstadoDoAtendimento,
  type HorarioDoEstado,
} from "@/lib/agente/atendimento";
import type { AtendimentoDoTurno } from "@/lib/agente/ferramentas/agenda-do-turno";
import { mascararNome } from "@/lib/agente/historico";
import {
  executarTurnoDoAgente,
  type ClienteDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
  type ResultadoDoTurno,
} from "@/lib/agente/laco";
import { linhaDaDecisao } from "@/lib/agente/whatsapp";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";

import { bancoDaAg3, rpcsDaAg3 } from "./ag3-contrato";
import type { AgendaEmMemoria, Linha } from "./agenda-em-memoria";
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
} from "./agenda-fixtures";
import { catalogoDoCadastro, UNID } from "./cadastro-fixtures";

// A revisao final do agendamento completo pela IA (AG3, 27/10/2026), em
// conversas de varias falas com um LLM FALSO de roteiro sobre o contrato
// das RPCs em memoria (ag3-contrato.ts): a pergunta "Confirma" contra a
// reserva viva e o p_slot_hold_id (achado 1), a acao e a consulta lida com
// o horario (2), a marca de fechamento licenciada pela acao (3), a recusa do
// agendar pelo horario (4), o eco da hora pedida (5), ja_tem_consulta no
// reservar (6), a reserva que vence no meio do turno (10), os falsos
// positivos (11), o nome e o nascimento mascarados no turno da coleta (14)
// e o portao da consulta para outra pessoa adulta (15). Nenhum teste fala
// com a OpenAI nem com o banco.

const CATALOGO = catalogoDoCadastro();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const IDENTIFICADOR = "a".repeat(64);
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

const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: { ...USO_LIDO },
};
const classificador: ClassificadorDeEntrada = async () => LIMPO;

/** A busca de buscar_horario com todas as chaves (strict). */
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

const CONFIRMA_QUARTA =
  "Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?";

let banco: AgendaEmMemoria;
let agora = AGORA;

type Fala = {
  /** O que o paciente escreveu (o original). */
  texto: string;
  roteiro: unknown[];
  /** Chamado a cada chamada do modelo (o relogio que anda no turno). */
  aoChamar?: () => void;
};

/**
 * Uma conversa: cada fala do paciente roda um turno inteiro, com o estado
 * do turno anterior e um job novo, dois minutos depois.
 */
class Conversa {
  mensagens: MensagemDaConversa[] = [];
  atendimento: AtendimentoDoTurno;
  corpos: Record<string, unknown>[] = [];
  jobs: string[] = [];
  config = configComAgenda();
  chamadasDoModelo = 0;

  constructor(atendimento?: AtendimentoDoTurno) {
    this.atendimento = atendimento ?? {
      estado: estadoVazio(),
      dados: dadosVazios(["nome_completo", "data_nascimento"]),
    };
  }

  async fala(
    { texto, roteiro, aoChamar }: Fala,
    extra: Partial<EntradaDoTurno> = {},
  ): Promise<ResultadoDoTurno> {
    if (this.jobs.length > 0) {
      agora += 2 * 60_000;
    }
    const job = randomUUID();
    this.jobs.push(job);
    this.mensagens.push({
      autor: "paciente",
      texto: mascararNome(texto, NOME_DO_CONTATO),
      textoOriginal: texto,
    });
    const create = vi.fn(async (corpo: unknown) => {
      this.chamadasDoModelo += 1;
      this.corpos.push(structuredClone(corpo) as Record<string, unknown>);
      aoChamar?.();
      return roteiro.shift();
    });
    const momento = agora;
    const r = await executarTurnoDoAgente({
      cliente: { responses: { create } } as unknown as ClienteDoAgente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: IDENTIFICADOR,
      config: this.config,
      catalogo: CATALOGO,
      mensagens: [...this.mensagens],
      agoraMs: momento,
      fuso: FUSO,
      verificador: aprovador,
      classificador,
      agenda: portaDaAgendaDoWhatsapp(banco.cliente(), {
        clinicId: CLINICA,
        conversationId: CONVERSA,
        contactId: CONTATO,
        jobId: job,
        agora: () => momento,
      }),
      atendimento: this.atendimento,
      agora: () => momento,
      ...extra,
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

  get estado(): EstadoDoAtendimento {
    return this.atendimento.estado;
  }

  /** As instrucoes de uma chamada ao modelo. */
  instrucoes(indice: number): string {
    return String(this.corpos[indice]?.instructions ?? "");
  }
}

function saidas(corpo: Record<string, unknown> | undefined) {
  return ((corpo?.input as { type?: string; output?: string }[]) ?? [])
    .filter((item) => item.type === "function_call_output")
    .map((item) => JSON.parse(item.output ?? "{}") as Record<string, unknown>);
}

function contrato(recusarAgendar: string | null = null) {
  rpcsDaAg3(banco, {
    catalogo: CATALOGO,
    exigidos: { nomeCompleto: true, nascimento: true, cpf: false },
    agora: () => agora,
    recusarAgendar,
  });
}

beforeEach(() => {
  agora = AGORA;
  banco = bancoDaAg3();
  contrato();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A oferta e a reserva de quarta, 21/10 as 14:00 (h2, Dra. Ana, Centro). */
async function ateAReserva(conversa: Conversa) {
  await conversa.fala({
    texto: "Quero marcar uma consulta à tarde, no particular",
    roteiro: [
      ferramenta("buscar_horario", busca({ periodo: "tarde" })),
      final(
        "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?",
      ),
    ],
  });
  await conversa.fala({
    texto: "Pode ser quarta às 14h",
    roteiro: [
      ferramenta("reservar_horario", { horario: "h2" }),
      final(
        "Reservei quarta, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.",
      ),
    ],
  });
}

/** O turno dos dados, com a resposta dada. */
async function turnoDosDados(conversa: Conversa, mensagem: string) {
  return conversa.fala({
    texto: "Maria da Silva Souza, nascida em 12/03/1985",
    roteiro: [ferramenta("registrar_dados_do_paciente", REGISTRO), final(mensagem)],
  });
}

function emUtc(instante: string): string {
  return new Date(instante).toISOString();
}

/** O horario h2 (quarta 14:00, Dra. Ana, Centro) como o estado guarda. */
function h2DoEstado(): HorarioDoEstado {
  return {
    codigo: "h2",
    service_link_id: VINC.consultaAna,
    professional_id: PROF.ana,
    unit_id: UNID.centro,
    starts_at: emUtc(iso("2026-10-21", "14:00")),
    ends_at: emUtc(iso("2026-10-21", "14:30")),
    oferecido_em: new Date(AGORA - 5 * 60_000).toISOString(),
  };
}

/**
 * Um estado com a reserva de quarta 14:00 viva (vence em `vence` ms) e a
 * pergunta Confirma feita; com o codigo h2 no estado quando pedido.
 */
function aguardando(
  opcoes: { comCodigo?: boolean; vence?: number; etapa?: EstadoDoAtendimento["etapa"] } = {},
): AtendimentoDoTurno {
  const hold: Linha = {
    id: randomUUID(),
    clinic_id: CLINICA,
    professional_id: PROF.ana,
    conversation_id: CONVERSA,
    service_link_id: VINC.consultaAna,
    job_id: randomUUID(),
    unit_id: UNID.centro,
    starts_at: iso("2026-10-21", "14:00"),
    ends_at: iso("2026-10-21", "14:30"),
    expires_at: new Date(AGORA + (opcoes.vence ?? 10 * 60_000)).toISOString(),
    consumido_em: null,
  };
  banco.inserir("slot_hold", hold);
  return {
    estado: {
      ...estadoVazio(),
      etapa: opcoes.etapa ?? "aguardando_confirmacao",
      intencao: "agendar",
      procedure_id: PROC.consulta,
      professional_id: PROF.ana,
      particular: true,
      unit_id: UNID.centro,
      horarios_oferecidos: opcoes.comCodigo ? [h2DoEstado()] : [],
      slot_hold_id: String(hold.id),
    },
    dados: {
      ...dadosVazios(),
      nome_completo: true,
      data_nascimento: true,
      para_o_titular: true,
    },
  };
}

/** A consulta que a IA marcou nesta conversa (quarta 14:00), no estado. */
function marcada(): AtendimentoDoTurno {
  const id = randomUUID();
  banco.inserir("appointment", {
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

/** A consulta que o contato ja tem (terca 27/10 10:00, outra marcacao). */
function consultaQueJaExiste() {
  banco.inserir("appointment", {
    id: "ab000000-0000-4000-8000-000000000001",
    clinic_id: CLINICA,
    contact_id: CONTATO,
    professional_id: PROF.bruno,
    service_link_id: VINC.consultaBruno,
    starts_at: iso("2026-10-27", "10:00"),
    ends_at: iso("2026-10-27", "10:30"),
    status: "agendado",
    approval_status: "aprovado",
  });
}

function barrou(r: ResultadoDoTurno, categoria: string) {
  expect(r.tipo).toBe("frase_fixa");
  expect(r.desfecho).toMatchObject({ tipo: "bloqueou", categoria });
}

describe("achado 1: a pergunta Confirma tem de mostrar a reserva viva", () => {
  it("Confirma com outro horário não arma a etapa, e o sim seguinte não marca nada", async () => {
    const conversa = new Conversa();
    await ateAReserva(conversa);
    const t3 = await turnoDosDados(
      conversa,
      "Obrigada! Confirma a Consulta com o Dr. Bruno Costa na quinta, 22/10 às 13:00, no particular?",
    );
    expect(t3.tipo).toBe("resposta");
    expect(t3.atendimento?.estado.etapa).toBe("oferta");

    const t4 = await conversa.fala({
      texto: "Sim, confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        final(`Esse horário ainda não foi confirmado. ${CONFIRMA_QUARTA}`),
      ],
    });
    expect(saidas(conversa.corpos.at(-1))[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    // Nada chegou a RPC e nada foi marcado.
    expect(banco.chamadasDe("agendar_pela_ia")).toHaveLength(0);
    expect(banco.linhas("appointment")).toHaveLength(0);
    // A pergunta de novo, com o horario certo, arma a etapa.
    expect(t4.tipo).toBe("resposta");
    expect(t4.atendimento?.estado.etapa).toBe("aguardando_confirmacao");
  });

  it.each([
    `Ótimo, confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?`,
    `Você confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?`,
    CONFIRMA_QUARTA,
  ])("'%s' arma a etapa, e o agendar manda a reserva perguntada", async (pergunta) => {
    const conversa = new Conversa();
    await ateAReserva(conversa);
    const hold = banco.linhas("slot_hold")[0];
    const t3 = await turnoDosDados(conversa, `Obrigada! ${pergunta}`);
    expect(t3.tipo).toBe("resposta");
    expect(t3.atendimento?.estado).toMatchObject({
      etapa: "aguardando_confirmacao",
      slot_hold_id: hold?.id,
    });
    const t4 = await conversa.fala({
      texto: "Sim, confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        final(
          "Pronto! Sua Consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe. A confirmação chega por aqui.",
        ),
      ],
    });
    expect(t4.tipo).toBe("resposta");
    expect(banco.chamadasDe("agendar_pela_ia")).toEqual([
      expect.objectContaining({ p_slot_hold_id: hold?.id }),
    ]);
    expect(banco.linhas("appointment")[0]).toMatchObject({
      starts_at: iso("2026-10-21", "14:00"),
      professional_id: PROF.ana,
    });
  });

  it("a pergunta que cita outro profissional ou outra unidade não arma", async () => {
    for (const pergunta of [
      "Confirma a Consulta com o Dr. Bruno Costa na quarta, 21/10 às 14:00, no particular?",
      "Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Aldeota, no particular?",
      "Confirma a Consulta na quarta, 21/10 às 14:00 ou na quinta, 22/10 às 13:00?",
    ]) {
      banco = bancoDaAg3();
      contrato();
      const conversa = new Conversa();
      await ateAReserva(conversa);
      const t3 = await turnoDosDados(conversa, pergunta);
      expect(t3.atendimento?.estado.etapa, pergunta).toBe("oferta");
    }
  });

  it("reserva_diferente: a viva é outra; o turno pergunta de novo com o horário dela e marca a viva", async () => {
    // O estado guarda a reserva de quarta 14:00 (perguntada), mas a viva da
    // conversa e a de quinta 13:00 (a de quarta foi trocada fora deste
    // estado).
    const estado = aguardando();
    banco.tabelas.set("slot_hold", []);
    const viva: Linha = {
      id: randomUUID(),
      clinic_id: CLINICA,
      professional_id: PROF.bruno,
      conversation_id: CONVERSA,
      service_link_id: VINC.consultaBruno,
      job_id: randomUUID(),
      unit_id: null,
      starts_at: iso("2026-10-22", "13:00"),
      ends_at: iso("2026-10-22", "13:30"),
      expires_at: new Date(AGORA + 10 * 60_000).toISOString(),
      consumido_em: null,
    };
    banco.inserir("slot_hold", viva);
    // Os dados que a pessoa ja informou (a linha aberta da conversa).
    banco.inserir("dados_informados_na_marcacao", {
      id: randomUUID(),
      conversation_id: CONVERSA,
      contact_id: CONTATO,
      appointment_id: null,
      nome_completo: "Maria da Silva Souza",
      data_nascimento: "1985-03-12",
      cpf: null,
      carteirinha: null,
      para_o_titular: true,
    });
    const conversa = new Conversa(estado);
    const t1 = await conversa.fala({
      texto: "Sim, pode marcar",
      roteiro: [
        ferramenta("agendar", {}),
        final(
          "O horário reservado nesta conversa é quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Confirma a Consulta com o Dr. Bruno Costa na quinta, 22/10 às 13:00, no particular?",
        ),
      ],
    });
    expect(banco.chamadasDe("agendar_pela_ia")).toEqual([
      expect.objectContaining({ p_slot_hold_id: estado.estado.slot_hold_id }),
    ]);
    expect(saidas(conversa.corpos.at(-1))[0]).toEqual({
      resultado: "reserva_diferente",
      horario_reservado: {
        dia: "quinta, 22/10",
        hora: "13:00",
        profissional: "Dr. Bruno Costa",
        procedimento: "Consulta",
        unidade: null,
      },
    });
    expect(banco.linhas("appointment")).toHaveLength(0);
    expect(t1.tipo).toBe("resposta");
    // O estado passa a guardar a viva, e a pergunta nova (com o horario
    // dela) arma a etapa.
    expect(t1.atendimento?.estado).toMatchObject({
      etapa: "aguardando_confirmacao",
      slot_hold_id: viva.id,
      professional_id: PROF.bruno,
      unit_id: null,
    });
    const t2 = await conversa.fala({
      texto: "Isso, confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        final(
          "Pronto! Sua Consulta de quinta, 22/10 às 13:00 com o Dr. Bruno Costa ficou marcada e fica pendente da aprovação da equipe. A confirmação chega por aqui.",
        ),
      ],
    });
    expect(t2.tipo).toBe("resposta");
    expect(banco.chamadasDe("agendar_pela_ia")[1]).toMatchObject({
      p_slot_hold_id: viva.id,
    });
    expect(banco.linhas("appointment")[0]).toMatchObject({
      starts_at: iso("2026-10-22", "13:00"),
      professional_id: PROF.bruno,
    });
  });
});

describe("achado 2: a ação e a consulta lida levam o horário", () => {
  it("reservou quarta 14h: 'Reservei quinta, 22/10 às 13:00' é barrado (mesmo livre na busca)", async () => {
    const conversa = new Conversa();
    await conversa.fala({
      texto: "Quero marcar uma consulta à tarde, no particular",
      roteiro: [
        ferramenta("buscar_horario", busca({ periodo: "tarde" })),
        final(
          "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?",
        ),
      ],
    });
    const r = await conversa.fala({
      texto: "Pode ser quarta às 14h",
      roteiro: [
        ferramenta("reservar_horario", { horario: "h2" }),
        final(
          "Reservei quinta, 22/10 às 13:00 com o Dr. Bruno Costa por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.",
        ),
      ],
    });
    barrou(r, "acao_nao_executada");
  });

  it.each([
    "Sim! Sua consulta ficou marcada para quarta, 21/10 às 14:00, pendente da aprovação da equipe.",
    "Foi marcada sim, quarta, 21/10 às 14:00, e está pendente da aprovação da equipe.",
    "Sim! Sua consulta de quarta, 21/10 às 14:00 está marcada e pendente da aprovação da equipe.",
  ])("depois de marcar, com a consulta do estado relida: '%s' passa", async (mensagem) => {
    const conversa = new Conversa(marcada());
    const r = await conversa.fala({
      texto: "Ficou marcada mesmo?",
      roteiro: [final(mensagem)],
    });
    expect(r.tipo).toBe("resposta");
  });

  it("depois de marcar, outro dia ou outra hora para a consulta é barrado", async () => {
    const conversa = new Conversa(marcada());
    const r = await conversa.fala({
      texto: "Ficou marcada mesmo?",
      roteiro: [
        final(
          "Sim! Sua consulta ficou marcada para quinta, 22/10 às 13:00, pendente da aprovação da equipe.",
        ),
      ],
    });
    barrou(r, "acao_nao_executada");
  });

  it("ja_tem_consulta do agendar: o dia e a hora da consulta que existe passam; os da reserva, não", async () => {
    consultaQueJaExiste();
    const certo = new Conversa(aguardando());
    const r1 = await certo.fala({
      texto: "Pode marcar",
      roteiro: [
        ferramenta("agendar", {}),
        final(
          "Você já tem uma Consulta marcada para terça, 27/10 às 10:00. Quer falar com a equipe sobre essa consulta?",
        ),
      ],
    });
    expect(r1.tipo).toBe("resposta");
    const errado = new Conversa(aguardando());
    const r2 = await errado.fala({
      texto: "Pode marcar",
      roteiro: [
        ferramenta("agendar", {}),
        final(
          "Você já tem uma Consulta marcada para quarta, 21/10 às 14:00. Quer falar com a equipe sobre essa consulta?",
        ),
      ],
    });
    barrou(r2, "acao_nao_executada");
  });
});

describe("achado 3: a reserva viva do estado não libera o fechamento", () => {
  it.each([
    "Anotei seus dados! Te esperamos quarta, 21/10 às 14:00 na unidade Centro.",
    "Obrigada! Ficou combinado: quarta, 21/10 às 14:00 com a Dra. Ana Lima.",
    "Perfeito! Te esperamos quarta, 21/10 às 14:00, na unidade Centro.",
    "Tudo certo para quarta, 21/10 às 14:00!",
    "Nos vemos quarta, 21/10 às 14:00!",
    "Sua consulta será quarta, 21/10 às 14:00 com a Dra. Ana Lima.",
  ])("no turno dos dados, '%s' é barrado", async (mensagem) => {
    const conversa = new Conversa();
    await ateAReserva(conversa);
    const r = await turnoDosDados(conversa, mensagem);
    barrou(r, "acao_nao_executada");
  });

  it("a reserva libera só 'reservado', com o par dela", async () => {
    const conversa = new Conversa();
    await ateAReserva(conversa);
    const r = await conversa.fala({
      texto: "Meu horário continua reservado?",
      roteiro: [
        final(
          "Sim, seu horário de quarta, 21/10 às 14:00 continua reservado. Para marcar, me envie seu nome completo e sua data de nascimento.",
        ),
      ],
    });
    expect(r.tipo).toBe("resposta");
  });
});

describe("achado 4: a recusa do agendar pelo horário perde a reserva", () => {
  it("conflito: a reserva fica perdida, o estado sem o id, e 'continua reservado' e 'tenho' são barrados", async () => {
    contrato("conflito");
    const conversa = new Conversa(aguardando({ comCodigo: true }));
    const r = await conversa.fala({
      texto: "Sim, confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        final(
          "Esse horário não está mais disponível. Quer que eu procure outros horários?",
        ),
      ],
    });
    expect(saidas(conversa.corpos.at(-1))[0]).toEqual({ resultado: "conflito" });
    expect(r.tipo).toBe("resposta");
    expect(r.atendimento?.estado).toMatchObject({
      slot_hold_id: null,
      etapa: "oferta",
    });

    for (const mensagem of [
      "Seu horário de quarta, 21/10 às 14:00 continua reservado. Quer confirmar?",
      "Tenho quarta, 21/10 às 14:00 livre ainda. Pode ser?",
    ]) {
      banco = bancoDaAg3();
      contrato("conflito");
      const outra = new Conversa(aguardando({ comCodigo: true }));
      const barrada = await outra.fala({
        texto: "Sim, confirmo",
        roteiro: [ferramenta("agendar", {}), final(mensagem)],
      });
      expect(barrada.tipo, mensagem).toBe("frase_fixa");
      expect(barrada.desfecho, mensagem).toMatchObject({ tipo: "bloqueou" });
    }
  });

  it("a reconferência acha o horário da reserva ocupado: reserva perdida, sem a etapa", async () => {
    banco.inserir("appointment", {
      id: "outra",
      clinic_id: CLINICA,
      professional_id: PROF.ana,
      contact_id: OUTRO_CONTATO,
      service_link_id: VINC.consultaAna,
      starts_at: iso("2026-10-21", "14:00"),
      ends_at: iso("2026-10-21", "14:30"),
      status: "agendado",
    });
    const conversa = new Conversa(aguardando({ comCodigo: true }));
    const r = await conversa.fala({
      texto: "Ainda dá para confirmar?",
      roteiro: [final(CONFIRMA_QUARTA)],
    });
    // O modelo viu que o horario nao esta mais livre.
    expect(conversa.instrucoes(0)).toContain(
      "o horário não está mais livre (diga isso e ofereça outros com buscar_horario)",
    );
    expect(r.atendimento?.estado).toMatchObject({
      slot_hold_id: null,
      etapa: "oferta",
    });
  });
});

describe("achado 5: o eco da hora pedida só vale na frase que nega ou pergunta", () => {
  function ocupada() {
    for (const [id, prof, vinc] of [
      ["o1", PROF.ana, VINC.consultaAna],
      ["o2", PROF.bruno, VINC.consultaBruno],
    ] as const) {
      banco.inserir("appointment", {
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

  async function pedeQuartaAs15(mensagem: string) {
    banco = bancoDaAg3();
    contrato();
    ocupada();
    const conversa = new Conversa();
    const r = await conversa.fala({
      texto: "Tem quarta às 15h?",
      roteiro: [
        ferramenta("buscar_horario", busca({ a_partir_de: "2026-10-21", hora: "15:00" })),
        final(mensagem),
      ],
    });
    return { conversa, r };
  }

  it("a busca devolve o eco ao modelo; a frase que nega passa", async () => {
    const { conversa, r } = await pedeQuartaAs15(
      "Quarta, 21/10 às 15:00 não está livre. Quer que eu veja outros horários?",
    );
    expect(saidas(conversa.corpos.at(-1))[0]).toMatchObject({
      resultado: "hora_pedida_ocupada",
      hora_pedida: "15:00",
      dia_pedido: "quarta, 21/10",
    });
    expect(r.tipo).toBe("resposta");
  });

  it.each([
    "A Dra. Ana Lima atende quarta, 21/10 às 15:00.",
    "Sua consulta será quarta, 21/10 às 15:00 com a Dra. Ana Lima.",
    "Então fica quarta, 21/10 às 15:00 com a Dra. Ana Lima, nos vemos lá!",
  ])("afirmar a hora pedida não passa: '%s'", async (mensagem) => {
    const { r } = await pedeQuartaAs15(mensagem);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({ tipo: "bloqueou" });
  });
});

describe("achado 6: reservar recusa ja_tem_consulta antes de qualquer dado", () => {
  async function ateARecusa(mensagem: string) {
    consultaQueJaExiste();
    const conversa = new Conversa();
    await conversa.fala({
      texto: "Quero marcar uma consulta à tarde, no particular",
      roteiro: [
        ferramenta("buscar_horario", busca({ periodo: "tarde" })),
        final(
          "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?",
        ),
      ],
    });
    const r = await conversa.fala({
      texto: "Pode ser quarta às 14h",
      roteiro: [ferramenta("reservar_horario", { horario: "h2" }), final(mensagem)],
    });
    return { conversa, r };
  }

  it("diz só o dia e a hora da consulta que já existe; nada é reservado nem pedido", async () => {
    const { conversa, r } = await ateARecusa(
      "Você já tem uma consulta desse procedimento marcada para terça, 27/10 às 10:00. Quer falar com a equipe sobre essa consulta?",
    );
    expect(saidas(conversa.corpos.at(-1))[0]).toEqual({
      resultado: "ja_tem_consulta",
      dia: "terça, 27/10",
      hora: "10:00",
    });
    // Nada de profissional, procedimento nem id da consulta ao modelo (a
    // saida e so o dia e a hora, acima).
    expect(JSON.stringify(conversa.corpos.at(-1))).not.toContain("ab000000");
    expect(r.tipo).toBe("resposta");
    expect(banco.linhas("slot_hold")).toHaveLength(0);
    expect(banco.chamadasDe("registrar_dados_da_marcacao")).toHaveLength(0);
    expect(r.atendimento?.estado.slot_hold_id).toBeNull();
  });

  it("outro dia para a consulta que já existe é barrado", async () => {
    const { r } = await ateARecusa(
      "Você já tem uma consulta desse procedimento marcada para quarta, 21/10 às 14:00. Quer falar com a equipe sobre essa consulta?",
    );
    barrou(r, "acao_nao_executada");
  });
});

describe("achado 10: a reserva que vence no meio do turno", () => {
  async function turnoQueVence(mensagem: string) {
    // A reserva vence 60 s depois do comeco do turno, e o modelo demora: o
    // relogio do turno passa do vencimento antes da resposta final.
    const conversa = new Conversa(
      aguardando({ comCodigo: true, vence: 60_000, etapa: "oferta" }),
    );
    let relogio = AGORA;
    const r = await conversa.fala(
      {
        texto: "Mandei os dados, pode confirmar?",
        roteiro: [final(mensagem)],
        aoChamar: () => {
          relogio += 5 * 60_000;
        },
      },
      { agora: () => relogio, prazoMs: 60 * 60_000 },
    );
    return r;
  }

  it("a pergunta Confirma não arma, e o estado grava a reserva nula", async () => {
    const r = await turnoQueVence(CONFIRMA_QUARTA);
    expect(r.tipo).toBe("resposta");
    expect(r.atendimento?.estado).toMatchObject({
      slot_hold_id: null,
      etapa: "oferta",
    });
  });

  it("'continua reservado' depois do vencimento é barrado", async () => {
    const r = await turnoQueVence(
      "Seu horário de quarta, 21/10 às 14:00 continua reservado. Confirma?",
    );
    barrou(r, "acao_nao_executada");
  });
});

describe("achado 11: os falsos positivos da reserva que venceu", () => {
  it.each([
    "Anotei seus dados. A reserva de quarta, 21/10 às 14:00 venceu.",
    "Pronto, anotei seus dados. O horário de quarta, 21/10 às 14:00 não está mais reservado.",
    "Anotei seus dados. A reserva de quarta, 21/10 às 14:00 venceu, quer que eu veja se ainda está livre?",
  ])("'%s' passa", async (mensagem) => {
    const conversa = new Conversa();
    await ateAReserva(conversa);
    // O paciente demora: a reserva vence antes da fala seguinte.
    agora += 13 * 60_000;
    const r = await turnoDosDados(conversa, mensagem);
    expect(r.tipo).toBe("resposta");
  });
});

describe("achado 14: o nome e o nascimento mascarados na cópia do classificador e do verificador", () => {
  it("no turno da coleta, o agente lê os dados e os outros dois não", async () => {
    const vistosPeloClassificador: string[] = [];
    const vistosPeloVerificador: string[] = [];
    const conversa = new Conversa();
    await ateAReserva(conversa);
    const r = await conversa.fala(
      {
        texto: "Maria Aparecida da Silva Souza, nascida em 12/03/1985",
        roteiro: [
          ferramenta("registrar_dados_do_paciente", {
            ...REGISTRO,
            nome_completo: "Fulano Aparecida da Silva Souza",
          }),
          final(`Obrigada, Fulano Aparecida da Silva Souza! ${CONFIRMA_QUARTA}`),
        ],
      },
      {
        classificador: async ({ mensagens }) => {
          vistosPeloClassificador.push(...mensagens);
          return LIMPO;
        },
        verificador: async (pedido) => {
          vistosPeloVerificador.push(
            ...pedido.mensagensDoPaciente,
            pedido.rascunho,
          );
          return aprovador(pedido);
        },
      },
    );
    expect(r.tipo).toBe("resposta");
    // O agente leu o nome (com a marca do contato) e o nascimento.
    const doAgente = JSON.stringify(conversa.corpos.at(-1));
    expect(doAgente).toContain("Aparecida da Silva Souza");
    expect(doAgente).toContain("12/03/1985");
    // O classificador e o verificador, nao.
    for (const visto of [...vistosPeloClassificador, ...vistosPeloVerificador]) {
      expect(visto).not.toMatch(/Aparecida|Silva|Souza|1985|12\/03/);
    }
    expect(vistosPeloClassificador.join(" ")).toContain("[nome]");
    expect(vistosPeloClassificador.join(" ")).toContain("[nascimento]");
    // O texto aprovado e o rascunho (sem a marca do contato), byte a byte:
    // a mascara e so da copia do verificador.
    expect(r.resposta).toContain("Obrigada Aparecida da Silva Souza!");
  });
});

describe("achado 15: o portão passa a consulta para outra pessoa adulta", () => {
  it.each([
    "Quero marcar uma consulta para minha mãe",
    "Tem horário pro meu pai amanhã?",
    "Gostaria de agendar para o meu marido, por favor",
    "É para minha esposa",
  ])("'%s' passa para a equipe antes do modelo", async (texto) => {
    const conversa = new Conversa();
    const r = await conversa.fala({ texto, roteiro: [final("não deveria sair")] });
    expect(conversa.chamadasDoModelo).toBe(0);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "consulta_para_outra_pessoa",
      gatilho: null,
      origem: "portao",
    });
    expect(
      linhaDaDecisao({
        clinicId: CLINICA,
        conversationId: CONVERSA,
        jobId: conversa.jobs[0] ?? "",
        desfecho: r.desfecho,
        textoSha256: null,
        filtro: null,
        trilha: r.trilha,
        uso: r.uso,
        versaoDoPrompt: r.versaoDoPrompt,
        configVersion: 1,
        latenciaMs: 1,
        ferramentasUsadas: r.ferramentasUsadas,
      }),
    ).toMatchObject({
      escalation_reason: "consulta_para_outra_pessoa",
      gatilho_entrada: null,
    });
  });

  it("filho e filha seguem pela regra do menor (o gatilho de sempre)", async () => {
    const conversa = new Conversa();
    const r = await conversa.fala({
      texto: "Quero marcar uma consulta para meu filho",
      roteiro: [final("não deveria sair")],
    });
    expect(conversa.chamadasDoModelo).toBe(0);
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "menor_de_idade",
      gatilho: "menor_de_idade",
      origem: "portao",
    });
  });

  it.each([
    "Posso levar minha mãe na consulta?",
    "Minha mãe que me indicou vocês, quero marcar uma consulta",
    "Quero marcar uma consulta para mim",
  ])("'%s' segue para o modelo (acompanhante e indicação não são consulta para outra pessoa)", async (texto) => {
    const conversa = new Conversa();
    const r = await conversa.fala({
      texto,
      roteiro: [final("Claro! Para quando você gostaria?")],
    });
    expect(conversa.chamadasDoModelo).toBe(1);
    expect(r.tipo).toBe("resposta");
  });
});
