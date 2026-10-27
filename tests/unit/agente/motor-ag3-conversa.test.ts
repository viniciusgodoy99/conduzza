import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { portaDaAgendaDoWhatsapp } from "@/lib/agente/agenda";
import {
  dadosVazios,
  estadoVazio,
  type EstadoDoAtendimento,
} from "@/lib/agente/atendimento";
import type { AtendimentoDoTurno } from "@/lib/agente/ferramentas/agenda-do-turno";
import { mascararNome } from "@/lib/agente/historico";
import {
  esconderCodigosNoTurno,
  executarTurnoDoAgente,
  historicoParaOModelo,
  PASSO_DAS_FALHAS_SEGUIDAS,
  type ClienteDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
  type ResultadoDoTurno,
} from "@/lib/agente/laco";
import { linhaDaDecisao } from "@/lib/agente/whatsapp";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import {
  criarClassificadorDeEntrada,
  type ClassificadorDeEntrada,
  type ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";
import { criarVerificador } from "@/lib/integrations/llm/verificador";

import { bancoDaAg3, rpcsDaAg3 } from "./ag3-contrato";
import type { AgendaEmMemoria, Linha } from "./agenda-em-memoria";
import {
  AGORA,
  CLINICA,
  codigoDoProcedimento,
  configComAgenda,
  CONTATO,
  CONV,
  CONVERSA,
  FUSO,
  iso,
  PROC,
  PROF,
  VINC,
} from "./agenda-fixtures";
import { catalogoDoCadastro, UNID } from "./cadastro-fixtures";

// O agendamento completo (AG3) em conversas de VARIAS falas com um LLM
// FALSO de roteiro, sobre o contrato das RPCs em memoria (ag3-contrato.ts):
// o estado do atendimento passa de um turno para o outro (como o executor
// faz com ler_atendimento_da_ia e gravar_atendimento_da_ia), os codigos dos
// horarios valem entre as mensagens, a reserva leva a unidade, os dados sao
// pedidos e registrados (o CPF so pelo servidor, do texto original), a
// pergunta "Confirma" vem antes de marcar e a consulta nasce pendente. E as
// recusas novas, as duas falhas seguidas e a nota para a equipe sem dado de
// paciente. Nenhum teste fala com a OpenAI nem com o banco.

const CATALOGO = catalogoDoCadastro();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const IDENTIFICADOR = "a".repeat(64);
const NOME_DO_CONTATO = "Maria Souza";
const CPF = "529.982.247-25";
const CPF_DIGITOS = "52998224725";
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

let banco: AgendaEmMemoria;
let agora = AGORA;
let escrito: string[] = [];

type Fala = {
  /** O que o paciente escreveu (o original). */
  texto: string;
  roteiro: unknown[];
};

/**
 * Uma conversa: cada fala do paciente roda um turno inteiro, com o estado
 * do turno anterior (o que o executor leria de ler_atendimento_da_ia depois
 * da gravacao) e um job novo, dois minutos depois.
 */
class Conversa {
  mensagens: MensagemDaConversa[] = [];
  atendimento: AtendimentoDoTurno;
  corpos: Record<string, unknown>[] = [];
  jobs: string[] = [];
  config = configComAgenda();

  constructor(atendimento?: AtendimentoDoTurno) {
    this.atendimento = atendimento ?? {
      estado: estadoVazio(),
      dados: dadosVazios(["nome_completo", "data_nascimento"]),
    };
  }

  async fala(
    { texto, roteiro }: Fala,
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
      this.corpos.push(structuredClone(corpo) as Record<string, unknown>);
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

  /** As instrucoes da primeira chamada ao modelo do ultimo turno. */
  instrucoesDoTurno(indice: number): string {
    return String(this.corpos[indice]?.instructions ?? "");
  }
}

function saidas(corpo: Record<string, unknown> | undefined) {
  return ((corpo?.input as { type?: string; output?: string }[]) ?? [])
    .filter((item) => item.type === "function_call_output")
    .map((item) => JSON.parse(item.output ?? "{}") as Record<string, unknown>);
}

beforeEach(() => {
  agora = AGORA;
  banco = bancoDaAg3();
  rpcsDaAg3(banco, {
    catalogo: CATALOGO,
    exigidos: { nomeCompleto: true, nascimento: true, cpf: false },
    agora: () => agora,
  });
  escrito = [];
  vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
    escrito.push(String(linha));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((linha) => {
    escrito.push(String(linha));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** As quatro falas do caminho feliz, ate a pergunta "Confirma". */
async function ateAPerguntaConfirma(conversa: Conversa) {
  const t1 = await conversa.fala({
    texto: "Quero marcar uma consulta à tarde, no particular",
    roteiro: [
      ferramenta("buscar_horario", busca({ periodo: "tarde" })),
      final(
        "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?",
      ),
    ],
  });
  const t2 = await conversa.fala({
    texto: "Pode ser quarta às 14h",
    roteiro: [
      // O codigo vem do estado: nenhuma busca neste turno.
      ferramenta("reservar_horario", { horario: "h2" }),
      final(
        "Reservei quarta, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.",
      ),
    ],
  });
  const t3 = await conversa.fala({
    texto: "Maria da Silva Souza, nascida em 12/03/1985",
    roteiro: [
      ferramenta("registrar_dados_do_paciente", {
        nome_completo: "Fulano da Silva Souza",
        data_nascimento: "1985-03-12",
        para_o_titular: true,
        campos_mascarados: [],
      }),
      final(
        "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?",
      ),
    ],
  });
  return { t1, t2, t3 };
}

describe("o caminho feliz: informar, escolher, oferecer, reservar, os dados, confirmar e marcar", () => {
  it("quatro falas, com o estado entre elas; a consulta nasce pendente, com a unidade", async () => {
    const conversa = new Conversa();
    const { t1, t2, t3 } = await ateAPerguntaConfirma(conversa);

    // 1. Oferecer: os horarios espalhados, com a unidade, ficam no estado.
    expect(t1.tipo).toBe("resposta");
    const oferta = saidas(conversa.corpos[1])[0];
    expect(oferta).toMatchObject({ resultado: "horarios", convenio: "particular" });
    expect(
      (oferta?.horarios as { codigo: string; unidade: string | null }[]).map(
        (h) => `${h.codigo} ${h.unidade}`,
      ),
    ).toEqual(["h1 null", "h2 Centro", "h3 null", "h4 Centro"]);
    expect(t1.atendimento?.estado).toMatchObject({
      etapa: "oferta",
      intencao: "agendar",
      procedure_id: PROC.consulta,
      particular: true,
      insurance_id: null,
    });
    expect(
      t1.atendimento?.estado.horarios_oferecidos.map((h) => h.codigo),
    ).toEqual(["h1", "h2", "h3", "h4"]);

    // 2. Reservar pelo codigo do estado (sem buscar de novo), com a unidade.
    expect(t2.tipo).toBe("resposta");
    // O modelo viu o estado (reconferido agora) no bloco proprio.
    const instrucoes = conversa.instrucoesDoTurno(2);
    expect(instrucoes).toContain("<atendimento_em_andamento>");
    expect(instrucoes).toContain(
      "- h2: quarta, 21/10 às 14:00, Dra. Ana Lima, Consulta, unidade [u2] Centro: livre agora.",
    );
    expect(instrucoes).toContain(
      "Dados que faltam para marcar: nome completo e data de nascimento.",
    );
    expect(banco.chamadasDe("reservar_horario_da_ia")).toEqual([
      expect.objectContaining({
        p_service_link_id: VINC.consultaAna,
        p_starts_at: iso("2026-10-21", "14:00"),
        p_unit_id: UNID.centro,
        p_job_id: conversa.jobs[1],
      }),
    ]);
    expect(saidas(conversa.corpos[3])[0]).toEqual({
      resultado: "reservado",
      minutos: 10,
      dia: "quarta, 21/10",
      hora: "14:00",
      profissional: "Dra. Ana Lima",
      procedimento: "Consulta",
      unidade: "Centro",
      pagamento: "particular",
      dados_que_faltam: ["nome_completo", "data_nascimento"],
    });
    expect(t2.atendimento?.estado).toMatchObject({
      etapa: "oferta",
      unit_id: UNID.centro,
      professional_id: PROF.ana,
    });
    expect(t2.atendimento?.estado.slot_hold_id).toBe(
      banco.linhas("slot_hold")[0]?.id,
    );

    // 3. Os dados: o nome vem do texto ORIGINAL (o modelo so viu a marca).
    expect(t3.tipo).toBe("resposta");
    expect(banco.chamadasDe("registrar_dados_da_marcacao")).toEqual([
      expect.objectContaining({
        p_para_o_titular: true,
        p_nome_completo: "Maria da Silva Souza",
        p_data_nascimento: "1985-03-12",
        p_cpf: null,
        p_carteirinha: null,
        p_job_id: conversa.jobs[2],
      }),
    ]);
    expect(saidas(conversa.corpos[5])[0]).toEqual({
      resultado: "registrado",
      registrados: ["nome_completo", "data_nascimento"],
      faltam: [],
    });
    // A pergunta "Confirma" com a reserva viva e nada faltando: o proximo
    // turno pode marcar.
    expect(t3.atendimento?.estado.etapa).toBe("aguardando_confirmacao");
    expect(t3.atendimento?.dados).toMatchObject({
      nome_completo: true,
      data_nascimento: true,
      faltam: [],
    });

    // 4. Marcar so depois da resposta: pendente, com a unidade.
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
    expect(banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    const consulta = banco.linhas("appointment")[0];
    expect(consulta).toMatchObject({
      approval_status: "pendente",
      created_by: "ia",
      unit_id: UNID.centro,
    });
    expect(t4.atendimento?.estado).toMatchObject({
      etapa: "pos_marcacao",
      desfecho: "marcou",
      appointment_id: consulta?.id,
      slot_hold_id: null,
      horarios_oferecidos: [],
      falhas_seguidas: 0,
    });
    // Os dados informados ficam ligados a consulta (a aprovacao aplica).
    expect(banco.linhas("dados_informados_na_marcacao")[0]).toMatchObject({
      appointment_id: consulta?.id,
      nome_completo: "Maria da Silva Souza",
    });
    // LGPD: o nome original do contato nunca foi a OpenAI.
    // Nem id do Cadastro, da reserva ou da consulta: so codigos (p1, h2,
    // u2...).
    const tudo = JSON.stringify(conversa.corpos);
    expect(tudo).not.toContain("Maria");
    for (const id of [
      PROC.consulta,
      PROF.ana,
      VINC.consultaAna,
      UNID.centro,
      String(banco.linhas("slot_hold")[0]?.id),
      String(consulta?.id),
    ]) {
      expect(tudo).not.toContain(id);
    }
  });

  it("sem a pergunta Confirma num turno anterior, o agendar não chega à RPC", async () => {
    const conversa = new Conversa();
    await conversa.fala({
      texto: "Quero marcar uma consulta à tarde",
      roteiro: [
        ferramenta("buscar_horario", busca({ periodo: "tarde" })),
        final("Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima. Pode ser?"),
      ],
    });
    await conversa.fala({
      texto: "Pode",
      roteiro: [
        ferramenta("reservar_horario", { horario: "h2" }),
        final("Reservei quarta, 21/10 às 14:00. Me envie seu nome completo e sua data de nascimento."),
      ],
    });
    // O paciente manda os dados e o modelo ja tenta marcar: a pergunta
    // "Confirma" com tudo ainda nao foi feita.
    const r = await conversa.fala({
      texto: "Maria da Silva Souza, 12/03/1985",
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: "Fulano da Silva Souza",
          data_nascimento: "1985-03-12",
          para_o_titular: true,
          campos_mascarados: [],
        }),
        ferramenta("agendar", {}),
        final(
          "Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?",
        ),
      ],
    });
    expect(r.tipo).toBe("resposta");
    expect(saidas(conversa.corpos.at(-1))[1]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(r.atendimento?.estado.etapa).toBe("aguardando_confirmacao");
  });
});

describe("a hora pedida e a unidade", () => {
  it("livre: oferece; ocupada: diz que não está livre e oferece as mais próximas", async () => {
    const conversa = new Conversa();
    const livre = await conversa.fala({
      texto: "Tem quarta às 15h?",
      roteiro: [
        ferramenta("buscar_horario", busca({ a_partir_de: "2026-10-21", hora: "15:00" })),
        final("Tenho quarta, 21/10 às 15:00 com a Dra. Ana Lima na unidade Centro. Pode ser?"),
      ],
    });
    expect(livre.tipo).toBe("resposta");
    expect(saidas(conversa.corpos[1])[0]).toMatchObject({
      resultado: "hora_pedida_livre",
      hora_pedida: "15:00",
    });
    banco.inserir("appointment", {
      id: "outra",
      clinic_id: CLINICA,
      professional_id: PROF.ana,
      contact_id: "c1000000-0000-4000-8000-000000000009",
      service_link_id: VINC.consultaAna,
      starts_at: iso("2026-10-21", "15:00"),
      ends_at: iso("2026-10-21", "15:30"),
      status: "agendado",
    });
    const ocupada = await conversa.fala({
      texto: "E na quarta às 15h, ainda tem?",
      roteiro: [
        ferramenta("buscar_horario", busca({ a_partir_de: "2026-10-21", hora: "15:00" })),
        final(
          "Às 15:00 de quarta não está mais livre. Tenho quarta, 21/10 às 14:30 ou às 15:30 com a Dra. Ana Lima. Qual prefere?",
        ),
      ],
    });
    expect(ocupada.tipo).toBe("resposta");
    expect(saidas(conversa.corpos.at(-1))[0]).toMatchObject({
      resultado: "hora_pedida_ocupada",
      hora_pedida: "15:00",
      dia_pedido: "quarta, 21/10",
    });
    // O horario oferecido antes (15:00) foi reconferido: nao esta mais
    // livre, e o modelo leu isso no bloco do estado.
    expect(conversa.instrucoesDoTurno(2)).toContain(
      "às 15:00, Dra. Ana Lima, Consulta, unidade [u2] Centro: não está mais livre.",
    );
  });

  it("o horário do estado que deixou de estar livre não é fato: dizer que está livre é barrado", async () => {
    const conversa = new Conversa();
    await conversa.fala({
      texto: "Quero marcar à tarde",
      roteiro: [
        ferramenta("buscar_horario", busca({ periodo: "tarde" })),
        final("Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima. Pode ser?"),
      ],
    });
    banco.inserir("appointment", {
      id: "outra",
      clinic_id: CLINICA,
      professional_id: PROF.ana,
      contact_id: "c1000000-0000-4000-8000-000000000009",
      service_link_id: VINC.consultaAna,
      starts_at: iso("2026-10-21", "14:00"),
      ends_at: iso("2026-10-21", "14:30"),
      status: "agendado",
    });
    const r = await conversa.fala({
      texto: "Ainda tem quarta às 14h?",
      roteiro: [final("Tenho sim, quarta, 21/10 às 14:00 continua livre. Posso reservar?")],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({
      tipo: "bloqueou",
      categoria: "horario_nao_verificado",
    });
  });
});

describe("as recusas novas", () => {
  /** Um estado com a reserva viva e a pergunta Confirma feita. */
  function aguardando(): AtendimentoDoTurno {
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
      expires_at: new Date(AGORA + 10 * 60_000).toISOString(),
      consumido_em: null,
    };
    banco.inserir("slot_hold", hold);
    return {
      estado: {
        ...estadoVazio(),
        etapa: "aguardando_confirmacao",
        intencao: "agendar",
        procedure_id: PROC.consulta,
        professional_id: PROF.ana,
        particular: true,
        unit_id: UNID.centro,
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

  it.each(["consulta_para_outra_pessoa", "menor_de_idade"])(
    "agendar %s: passa para a equipe com o motivo do banco, e a nota não tem dado do paciente",
    async (motivo) => {
      rpcsDaAg3(banco, {
        catalogo: CATALOGO,
        exigidos: { nomeCompleto: true, nascimento: true, cpf: false },
        agora: () => agora,
        recusarAgendar: motivo,
      });
      const conversa = new Conversa(aguardando());
      const r = await conversa.fala({
        texto: "Sim, pode marcar",
        roteiro: [ferramenta("agendar", {}), final("não deveria sair")],
      });
      expect(r.tipo).toBe("frase_fixa");
      expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
      expect(r.desfecho).toEqual({
        tipo: "escalou",
        motivo,
        gatilho: null,
        origem: "ferramenta",
      });
      expect(r.atendimento?.estado.desfecho).toBe("passou_para_equipe");
      expect(r.notaParaAEquipe).toContain("Pedido: marcar Consulta, com Dra. Ana Lima, particular, unidade Centro.");
      expect(r.notaParaAEquipe).toContain("Horário reservado: quarta, 21/10 às 14:00");
      expect(r.notaParaAEquipe).toMatch(/Parou em: .+\./);
      expect(r.notaParaAEquipe).not.toMatch(/Maria|Fulano|1985|[–—]/);
      // O motivo novo cabe no CHECK de escalation_reason.
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
      ).toMatchObject({ escalation_reason: motivo, tool_used: "agendar" });
    },
  );

  it("ja_tem_consulta: diz só o dia e a hora da consulta que já existe e oferece passar se quiser mudar", async () => {
    banco.inserir("appointment", {
      id: "existente",
      clinic_id: CLINICA,
      contact_id: CONTATO,
      professional_id: PROF.bruno,
      service_link_id: VINC.consultaBruno,
      starts_at: iso("2026-10-27", "10:00"),
      ends_at: iso("2026-10-27", "10:30"),
      status: "agendado",
      approval_status: "aprovado",
    });
    const conversa = new Conversa(aguardando());
    const r = await conversa.fala({
      texto: "Pode marcar",
      roteiro: [
        ferramenta("agendar", {}),
        final(
          "Você já tem uma Consulta marcada para terça, 27/10 às 10:00. Quer mudar essa consulta?",
        ),
      ],
    });
    expect(r.tipo).toBe("resposta");
    expect(saidas(conversa.corpos.at(-1))[0]).toEqual({
      resultado: "ja_tem_consulta",
      dia: "terça, 27/10",
      hora: "10:00",
    });
    // Se quiser mudar, o modelo passa com o motivo ja_tem_consulta.
    const muda = await conversa.fala({
      texto: "Quero mudar",
      roteiro: [ferramenta("escalar_humano", { motivo: "ja_tem_consulta" })],
    });
    expect(muda.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "ja_tem_consulta",
      origem: "agente",
    });
  });

  it("faltam_dados: pede o que falta (a lista do banco)", async () => {
    const semDados: AtendimentoDoTurno = { ...aguardando(), dados: dadosVazios() };
    const conversa = new Conversa(semDados);
    const r = await conversa.fala({
      texto: "Confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        final("Para marcar, preciso do seu nome completo e da sua data de nascimento."),
      ],
    });
    expect(r.tipo).toBe("resposta");
    expect(saidas(conversa.corpos.at(-1))[0]).toEqual({
      resultado: "faltam_dados",
      faltam: ["nome_completo", "data_nascimento"],
    });
    expect(r.atendimento?.dados.faltam).toEqual(["nome_completo", "data_nascimento"]);
    expect(r.atendimento?.estado.etapa).toBe("oferta");
  });

  it("registrar com para_o_titular false: só a marca, e passa para a equipe", async () => {
    const conversa = new Conversa(aguardando());
    // Revisao final da AG3: "para o meu marido" o portao ja passa (achado
    // 15); aqui a pessoa so diz que nao e para ela, e o modelo registra.
    const r = await conversa.fala({
      texto: "Na verdade a consulta não é para mim",
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: null,
          data_nascimento: null,
          para_o_titular: false,
          campos_mascarados: [],
        }),
      ],
    });
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "consulta_para_outra_pessoa",
      gatilho: null,
      origem: "ferramenta",
    });
    expect(banco.linhas("dados_informados_na_marcacao")[0]).toMatchObject({
      para_o_titular: false,
    });
    expect(r.notaParaAEquipe).toContain("A consulta é para outra pessoa.");
  });

  it("registrar com nascimento de menor de 18: passa para a equipe", async () => {
    const conversa = new Conversa(aguardando());
    const r = await conversa.fala({
      texto: "Joana Prates Lima, nasci em 10/01/2010",
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: "Joana Prates Lima",
          data_nascimento: "2010-01-10",
          para_o_titular: true,
          campos_mascarados: [],
        }),
      ],
    });
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "menor_de_idade",
      gatilho: null,
      origem: "ferramenta",
    });
  });
});

describe("as duas falhas seguidas", () => {
  it("a primeira conta; a segunda passa para a equipe e a resposta não sai", async () => {
    const conversa = new Conversa();
    const primeira = await conversa.fala({
      texto: "Quero o horário de sempre",
      roteiro: [
        ferramenta("reservar_horario", { horario: "h7" }),
        final("Qual dia e período você prefere para a consulta?"),
      ],
    });
    expect(primeira.tipo).toBe("resposta");
    expect(primeira.atendimento?.estado.falhas_seguidas).toBe(1);
    // So conversa (sem ferramenta): o contador nao muda.
    const conversaSo = await conversa.fala({
      texto: "Tanto faz",
      roteiro: [final("Prefere de manhã ou à tarde?")],
    });
    expect(conversaSo.atendimento?.estado.falhas_seguidas).toBe(1);
    const segunda = await conversa.fala({
      texto: "Meu cpf é o mesmo de sempre",
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: null,
          data_nascimento: null,
          para_o_titular: true,
          campos_mascarados: ["cpf"],
        }),
        final("Pode me mandar o CPF com os 11 números?"),
      ],
    });
    expect(segunda.tipo).toBe("frase_fixa");
    expect(segunda.desfecho).toEqual({
      tipo: "escalou",
      motivo: "falhas_seguidas",
      gatilho: null,
      origem: "sistema",
    });
    expect(segunda.trilha.map((p) => p.texto)).toContain(PASSO_DAS_FALHAS_SEGUIDAS);
    expect(segunda.atendimento?.estado).toMatchObject({
      falhas_seguidas: 2,
      desfecho: "passou_para_equipe",
    });
    // O verificador nem foi chamado: a resposta do turno nao sai.
    expect(segunda.filtro).toBeNull();
  });

  it("um avanço zera o contador", async () => {
    const conversa = new Conversa();
    await conversa.fala({
      texto: "Quero marcar",
      roteiro: [
        ferramenta("reservar_horario", { horario: "h9" }),
        final("Qual período você prefere?"),
      ],
    });
    const r = await conversa.fala({
      texto: "Tarde",
      roteiro: [
        ferramenta("buscar_horario", busca({ periodo: "tarde" })),
        final("Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima. Pode ser?"),
      ],
    });
    expect(r.atendimento?.estado.falhas_seguidas).toBe(0);
  });
});

describe("o CPF: só o servidor lê, do texto original", () => {
  /**
   * A OpenAI falsa das tres chamadas: o classificador e o verificador de
   * VERDADE (por responses.parse) e o agente (responses.create, o roteiro).
   * Guarda todo corpo, para conferir o que sairia para a OpenAI.
   */
  function openAiFalsa(roteiro: unknown[]) {
    const corpos: Record<string, unknown>[] = [];
    const create = vi.fn(async (corpo: Record<string, unknown>) => {
      corpos.push(structuredClone(corpo));
      return roteiro.shift();
    });
    const parse = vi.fn(async (corpo: Record<string, unknown>) => {
      corpos.push(structuredClone(corpo));
      const formato = (corpo.text as { format?: { name?: unknown } } | undefined)
        ?.format?.name;
      const lido =
        formato === "classificacao_de_entrada"
          ? { gatilhos: ["nenhum"], confianca: "alta" }
          : { aprovado: true, violacoes: [], confianca: "alta" };
      return {
        model: "gpt-6-luna",
        status: "completed",
        incomplete_details: null,
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              { type: "output_text", text: JSON.stringify(lido), annotations: [] },
            ],
          },
        ],
        output_parsed: lido,
        usage: USO,
      };
    });
    return {
      cliente: { responses: { create, parse } } as unknown as ClienteDoAgente,
      corpos,
    };
  }

  it("o modelo, o classificador e o verificador veem [cpf]; a RPC recebe os dígitos; nada em log", async () => {
    rpcsDaAg3(banco, {
      catalogo: CATALOGO,
      exigidos: { nomeCompleto: true, nascimento: true, cpf: true },
      agora: () => agora,
    });
    const conversa = new Conversa();
    conversa.config = configComAgenda({
      dadosExigidos: { nomeCompleto: true, nascimento: true, cpf: true },
    });
    // A reserva primeiro (o turno de antes).
    await conversa.fala({
      texto: "Quero marcar à tarde",
      roteiro: [
        ferramenta("buscar_horario", busca({ periodo: "tarde" })),
        final("Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima. Pode ser?"),
      ],
    });
    await conversa.fala({
      texto: "Pode",
      roteiro: [
        ferramenta("reservar_horario", { horario: "h2" }),
        final("Reservei quarta, 21/10 às 14:00. Me envie seu nome completo, sua data de nascimento e seu CPF."),
      ],
    });
    const openAi = openAiFalsa([
      ferramenta("registrar_dados_do_paciente", {
        nome_completo: "Fulano da Silva Souza",
        data_nascimento: "1985-03-12",
        para_o_titular: true,
        campos_mascarados: ["cpf"],
      }),
      final(
        "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?",
      ),
    ]);
    const r = await conversa.fala(
      {
        texto: `Maria da Silva Souza, 12/03/1985, CPF ${CPF}`,
        roteiro: [],
      },
      {
        cliente: openAi.cliente,
        verificador: criarVerificador({
          cliente: openAi.cliente,
          modelo: "gpt-6-luna",
          identificadorDeSeguranca: IDENTIFICADOR,
        }),
        classificador: criarClassificadorDeEntrada({
          cliente: openAi.cliente,
          modelo: "gpt-6-luna",
          identificadorDeSeguranca: IDENTIFICADOR,
        }),
      },
    );
    expect(r.tipo).toBe("resposta");
    // A RPC recebeu os digitos, achados no texto original pelo servidor.
    expect(banco.chamadasDe("registrar_dados_da_marcacao").at(-1)).toMatchObject({
      p_cpf: CPF_DIGITOS,
      p_nome_completo: "Maria da Silva Souza",
    });
    // Classificador, agente e verificador: o CPF nunca saiu (nem em pedaco).
    expect(openAi.corpos.length).toBeGreaterThanOrEqual(4);
    const paraAOpenAi = JSON.stringify([...openAi.corpos, ...conversa.corpos]);
    expect(paraAOpenAi).toContain("[cpf]");
    for (const pedaco of [CPF, CPF_DIGITOS, "529.982", "982.247", "52998224"]) {
      expect(paraAOpenAi).not.toContain(pedaco);
    }
    // Nem a saida da ferramenta, nem a trilha, nem o log.
    const saida = saidas(openAi.corpos.find((c) => c.instructions !== undefined && saidas(c).length > 0))[0];
    expect(saida).toEqual({
      resultado: "registrado",
      registrados: ["nome_completo", "data_nascimento", "cpf"],
      faltam: [],
    });
    expect(JSON.stringify(r.trilha)).not.toMatch(/529|982\.247|1985|Maria/);
    expect(escrito.join("\n")).not.toMatch(/529\.?982|52998224725|Maria|1985/);
  });

  it("a carteirinha CURTA (menos de 8 dígitos) que a minimização deixa passar: com a carteirinha em jogo, nenhum modelo vê; a RPC recebe", async () => {
    const conversa = new Conversa();
    await conversa.fala({
      texto: "Quero marcar à tarde",
      roteiro: [
        ferramenta("buscar_horario", busca({ periodo: "tarde" })),
        final("Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima. Pode ser?"),
      ],
    });
    await conversa.fala({
      texto: "Pode",
      roteiro: [
        ferramenta("reservar_horario", { horario: "h2" }),
        final(
          "Reservei quarta, 21/10 às 14:00. Me envie seu nome completo, sua data de nascimento e o número da sua carteirinha.",
        ),
      ],
    });
    const openAi = openAiFalsa([
      ferramenta("registrar_dados_do_paciente", {
        nome_completo: "Fulano da Silva Souza",
        data_nascimento: "1985-03-12",
        para_o_titular: true,
        campos_mascarados: ["carteirinha"],
      }),
      final(
        "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?",
      ),
    ]);
    // A mensagem nem cita a carteirinha: o pedido dela no historico basta.
    const r = await conversa.fala(
      { texto: "Maria da Silva Souza, 12/03/1985, AB-12345", roteiro: [] },
      {
        cliente: openAi.cliente,
        verificador: criarVerificador({
          cliente: openAi.cliente,
          modelo: "gpt-6-luna",
          identificadorDeSeguranca: IDENTIFICADOR,
        }),
        classificador: criarClassificadorDeEntrada({
          cliente: openAi.cliente,
          modelo: "gpt-6-luna",
          identificadorDeSeguranca: IDENTIFICADOR,
        }),
      },
    );
    expect(r.tipo).toBe("resposta");
    expect(banco.chamadasDe("registrar_dados_da_marcacao").at(-1)).toMatchObject({
      p_carteirinha: "AB-12345",
      p_nome_completo: "Maria da Silva Souza",
      p_data_nascimento: "1985-03-12",
    });
    // Classificador, agente e verificador: o codigo nunca saiu; a data,
    // que o modelo precisa ler, saiu.
    expect(openAi.corpos.length).toBeGreaterThanOrEqual(4);
    const paraAOpenAi = JSON.stringify(openAi.corpos);
    expect(paraAOpenAi).toContain("[numero]");
    expect(paraAOpenAi).toContain("12/03/1985");
    for (const pedaco of ["AB-12345", "12345", "AB-1234"]) {
      expect(paraAOpenAi).not.toContain(pedaco);
    }
    expect(JSON.stringify(r.trilha)).not.toContain("12345");
    expect(escrito.join("\n")).not.toContain("12345");
  });

  it("quando a carteirinha esta em jogo: pedida ou informada no atendimento, ou citada no histórico; senão, o número curto (um preço) fica", () => {
    const fala = (texto: string): MensagemDaConversa => ({ autor: "paciente", texto });
    const semNada = [fala("Vi no anúncio por 1500, é isso?")];
    expect(esconderCodigosNoTurno({ mensagens: semNada })).toBe(false);
    expect(
      esconderCodigosNoTurno({
        mensagens: semNada,
        atendimento: { estado: estadoVazio(), dados: dadosVazios(["carteirinha"]) },
      }),
    ).toBe(true);
    expect(
      esconderCodigosNoTurno({
        mensagens: semNada,
        atendimento: {
          estado: estadoVazio(),
          dados: { ...dadosVazios([]), carteirinha: true },
        },
      }),
    ).toBe(true);
    expect(
      esconderCodigosNoTurno({
        mensagens: [...semNada, fala("Minha carteirinha é 4321")],
      }),
    ).toBe(true);
    expect(
      historicoParaOModelo(semNada).map((m) => (m as { content: string }).content),
    ).toEqual(["Vi no anúncio por 1500, é isso?"]);
    expect(
      historicoParaOModelo(semNada, { esconderCodigos: true }).map(
        (m) => (m as { content: string }).content,
      ),
    ).toEqual(["Vi no anúncio por [numero], é isso?"]);
  });
});

describe("consultar_cadastro_do_contato: só sinais do cadastro, nunca o valor", () => {
  function porta() {
    return portaDaAgendaDoWhatsapp(banco.cliente(), {
      clinicId: CLINICA,
      conversationId: CONVERSA,
      contactId: CONTATO,
      jobId: randomUUID(),
      agora: () => agora,
    });
  }

  function contato(): Linha {
    const linha = banco.linhas("contact").find((c) => c.id === CONTATO);
    if (!linha) {
      throw new Error("sem contato");
    }
    return linha;
  }

  function consulta(extra: Linha): Linha {
    return {
      id: randomUUID(),
      clinic_id: CLINICA,
      contact_id: CONTATO,
      starts_at: iso("2026-10-28", "10:00"),
      status: "agendado",
      approval_status: null,
      ...extra,
    };
  }

  it("o modelo recebe o tipo, o nome confirmado, SE há nascimento e CPF, o convênio e quantas consultas futuras; nenhum valor é lido", async () => {
    Object.assign(contato(), {
      kind: "paciente",
      birth_date: "1985-03-12",
      cpf: "52998224725",
      insurance_id: CONV.unimed,
      insurance_card: "0001234500",
    });
    banco.inserir(
      "audit_log",
      {
        clinic_id: CLINICA,
        user_id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a",
        action: "editou",
        entity: "contact",
        entity_id: CONTATO,
      },
    );
    banco.inserir(
      "appointment",
      consulta({}),
      consulta({ approval_status: "pendente" }),
      consulta({ approval_status: "recusado" }),
      consulta({ status: "cancelado_paciente" }),
      consulta({ starts_at: iso("2026-10-01", "10:00") }),
    );
    const conversa = new Conversa();
    const r = await conversa.fala({
      texto: "Eu já sou paciente de vocês, tenho consulta marcada?",
      roteiro: [
        ferramenta("consultar_cadastro_do_contato", {}),
        final("Vi aqui que você já tem consulta com a gente. Posso ajudar com outra coisa?"),
      ],
    });
    expect(r.tipo).toBe("resposta");
    expect(saidas(conversa.corpos[1])[0]).toEqual({
      resultado: "cadastro",
      tipo: "paciente",
      nome_no_cadastro: "confirmado",
      tem_data_de_nascimento: true,
      tem_cpf: true,
      convenio_cadastrado: { nome: "Unimed", plano: "Nacional" },
      consultas_futuras: 2,
    });
    // Nenhum valor do cadastro foi ao modelo, a trilha ou o log...
    const tudo = JSON.stringify([conversa.corpos, r.trilha]) + escrito.join("\n");
    for (const valor of ["Maria", "Souza", "52998224725", "1985", "0001234500"]) {
      expect(tudo).not.toContain(valor);
    }
    // ... e nem foi lido: do contato, so o tipo, o convenio, a importacao e
    // contagens (head) dos campos preenchidos.
    const doContato = banco.leituras.filter((l) => l.tabela === "contact");
    expect(doContato.length).toBeGreaterThan(0);
    for (const leitura of doContato) {
      expect(leitura.colunas).not.toMatch(/name|cpf|birth_date|insurance_card|email|phone/);
    }
  });

  it.each([
    {
      caso: "nome do WhatsApp (sem trilha de pessoa, sem importação)",
      contato: {},
      trilha: [],
      esperado: "do_whatsapp",
    },
    {
      // So espacos conta como preenchido (neq ""): o PostgREST nao tem btrim
      // no filtro. O sinal so orienta a pergunta (os dados exigidos sao
      // pedidos sempre) e a aprovacao aplica pelo criterio do banco.
      caso: "nome só de espaços",
      contato: { name: "  " },
      trilha: [],
      esperado: "do_whatsapp",
    },
    { caso: "nome nulo", contato: { name: null }, trilha: [], esperado: "sem_nome" },
    {
      caso: "veio de importação",
      contato: { criado_por_importacao: true },
      trilha: [],
      esperado: "confirmado",
    },
    {
      caso: "alguém da equipe criou",
      contato: {},
      trilha: [{ action: "criou", user_id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a" }],
      esperado: "confirmado",
    },
    {
      caso: "criado sem pessoa (pelo sistema)",
      contato: {},
      trilha: [{ action: "criou", user_id: null }],
      esperado: "do_whatsapp",
    },
    {
      caso: "nome informado aplicado na aprovação",
      contato: {},
      trilha: [
        {
          action: "aplicou_dados_da_marcacao",
          user_id: null,
          detalhes: { campos: ["name", "birth_date"] },
        },
      ],
      esperado: "confirmado",
    },
    {
      caso: "aplicação sem o nome",
      contato: {},
      trilha: [
        {
          action: "aplicou_dados_da_marcacao",
          user_id: null,
          detalhes: { campos: ["birth_date"] },
        },
      ],
      esperado: "do_whatsapp",
    },
  ])("o nome do cadastro pelo critério da aprovação: $caso", async ({ contato: extra, trilha, esperado }) => {
    Object.assign(contato(), extra);
    for (const linha of trilha) {
      banco.inserir("audit_log", {
        clinic_id: CLINICA,
        entity: "contact",
        entity_id: CONTATO,
        ...linha,
      });
    }
    const lido = await porta().lerCadastroDoContato?.();
    expect(lido?.nome).toBe(esperado);
  });

  it("a leitura que falha não vira sinal inventado: a ferramenta falha e o modelo não recebe cadastro", async () => {
    banco.comErro.add("audit_log");
    const conversa = new Conversa();
    const r = await conversa.fala({
      texto: "Vocês têm meu cadastro?",
      roteiro: [
        ferramenta("consultar_cadastro_do_contato", {}),
        final("Vou verificar com a equipe e já te retorno."),
      ],
    });
    expect(saidas(conversa.corpos[1])[0]).not.toMatchObject({ resultado: "cadastro" });
    expect(r.trilha.map((p) => p.texto)).toContain(
      "Não foi possível consultar o cadastro da pessoa agora.",
    );
  });
});
