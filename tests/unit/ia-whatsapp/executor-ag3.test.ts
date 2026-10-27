import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { estadoVazio } from "@/lib/agente/atendimento";
import type { ClienteDoAgente, ResultadoDoTurno } from "@/lib/agente/laco";
import {
  configPadraoDoAgente,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { TextoAprovado } from "@/lib/domain/conformidade/texto-aprovado";
import type { Job } from "@/lib/jobs/worker";

import { BancoEmMemoria, estadoVazioDoBanco, type Linha } from "./banco-em-memoria";
import { aprovarParaTeste } from "./texto-aprovado-de-teste";

// O executor do job 'responder_com_ia' com o ESTADO DO ATENDIMENTO (AG3):
// lido no comeco (ler_atendimento_da_ia, pelo job) e gravado no fim, ANTES
// de decidir e enviar (gravar_atendimento_da_ia, com a versao lida). Recusa
// ou erro: a resposta construida sobre o estado velho nunca sai (a frase
// fixa e a equipe; sem frase quando a conversa ja saiu da IA). E a nota
// interna da passagem, pelo caminho da nota da automacao (sem job_id).
// Banco em memoria, turno falso de roteiro, envio falso; nenhum teste fala
// com a OpenAI.

const estadoDoTeste = vi.hoisted(() => ({ config: null as unknown }));

vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => estadoDoTeste.config,
  carregarCatalogoDoAgente: async () => ({
    procedimentos: [],
    vinculos: [],
    convenios: [],
    conveniosDoCadastro: [],
  }),
}));

const {
  executarRespostaComIa,
  PASSO_DO_ESTADO_NAO_GRAVADO,
  PASSO_DO_ESTADO_NAO_LIDO,
} = await import("@/lib/jobs/responder-com-ia");
type Dependencias = Parameters<typeof executarRespostaComIa>[2];

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const CONTATO = "c1000000-0000-4000-8000-000000000001";
const NUMERO = "a0000000-0000-4000-8000-000000000001";
const JOB = "10000000-0000-4000-8000-000000000001";
const EXECUTOR = "motor-ia:20000000-0000-4000-8000-000000000001";
const TELEFONE = "+5584999990001";
const AGORA = Date.UTC(2026, 9, 13, 15, 0);
const DESDE = "2026-10-13T14:58:00.000Z";
const CRIADO = "2026-10-13T14:59:00.000Z";
const RESPOSTA = "Atendemos de segunda a sexta. Posso ajudar em algo mais?";
const PROC = "11111111-1111-4111-8111-111111111111";
const NOTA =
  "Resumo do assistente para a equipe (montado pelo sistema, sem dados do paciente).\nParou em: o paciente descreveu um sintoma.";

const APROVADA: TextoAprovado = await aprovarParaTeste(RESPOSTA);

const USO = {
  tokensEntrada: 1000,
  tokensSaida: 50,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
};

const COMUM = {
  trilha: [{ tipo: "outro" as const, texto: "Respondeu." }],
  uso: [{ papel: "agente" as const, modelo: "gpt-6-luna", uso: USO }],
  versaoDoPrompt: "agente-teste",
  descartados: { instrucoes: false, itensDaBase: 0 },
};

/** O estado que o turno devolve (a etapa e o procedimento mudaram). */
const ESTADO_NOVO = {
  ...estadoVazio(),
  etapa: "escolha" as const,
  intencao: "agendar" as const,
  procedure_id: PROC,
};

function respondeu(): ResultadoDoTurno {
  return {
    ...COMUM,
    tipo: "resposta",
    resposta: APROVADA,
    desfecho: { tipo: "respondeu" },
    filtro: {
      aprovado: true,
      texto: APROVADA,
      sha256: sha256DoTexto(RESPOSTA),
      versaoDasRegras: "regras-teste",
      verificador: { modelo: "gpt-6-luna", uso: USO },
    },
    rascunhoBloqueado: null,
    atendimento: {
      estado: ESTADO_NOVO,
      dados: {
        nome_completo: false,
        data_nascimento: false,
        cpf: false,
        carteirinha: false,
        para_o_titular: null,
        faltam: [],
      },
    },
    notaParaAEquipe: null,
  };
}

function escalou(): ResultadoDoTurno {
  return {
    ...COMUM,
    tipo: "frase_fixa",
    resposta: FRASE_DE_ESCALONAMENTO,
    desfecho: {
      tipo: "escalou",
      motivo: "sintoma",
      gatilho: "sintoma",
      origem: "portao",
    },
    filtro: null,
    rascunhoBloqueado: null,
    atendimento: {
      estado: { ...ESTADO_NOVO, desfecho: "passou_para_equipe" },
      dados: {
        nome_completo: false,
        data_nascimento: false,
        cpf: false,
        carteirinha: false,
        para_o_titular: null,
        faltam: [],
      },
    },
    notaParaAEquipe: NOTA,
  };
}

let banco: BancoEmMemoria;
let passagens: string[];
let turno: ReturnType<typeof vi.fn<Dependencias["executarTurno"]>>;
let enviarResposta: ReturnType<typeof vi.fn<Dependencias["enviarResposta"]>>;
let enviarFrase: ReturnType<typeof vi.fn<Dependencias["enviarFrase"]>>;

function job(extra: Partial<Job> = {}): Job {
  return {
    id: JOB,
    clinic_id: CLINICA,
    kind: "responder_com_ia",
    payload: { conversation_id: CONVERSA, ultima_mensagem_id: "m1" },
    attempts: 1,
    max_attempts: 3,
    whatsapp_account_id: NUMERO,
    created_at: CRIADO,
    ...extra,
  };
}

function conversa(): Linha {
  return banco.linhas("conversation")[0]!;
}

function montar() {
  banco = new BancoEmMemoria();
  passagens = [];
  estadoDoTeste.config = {
    ...configPadraoDoAgente(),
    status: "publicada",
    versao: 3,
  } satisfies ConfigDoAgente;
  banco.linhas("clinic").push({
    id: CLINICA,
    timezone: "America/Fortaleza",
    e_de_teste: false,
  });
  banco.linhas("conversation").push({
    id: CONVERSA,
    clinic_id: CLINICA,
    status: "ia_atendendo",
    assignee_user_id: null,
    contact_id: CONTATO,
    whatsapp_account_id: NUMERO,
    awaiting_reply: true,
  });
  banco.linhas("contact").push({
    id: CONTATO,
    clinic_id: CLINICA,
    phone_key: TELEFONE,
    name: "Maria Souza",
    birth_date: null,
  });
  banco.linhas("ia_janela_da_conversa").push({
    conversation_id: CONVERSA,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    phone_key: TELEFONE,
    desde: DESDE,
    aberta_por: "ingestao",
  });
  banco.linhas("message").push({
    id: "m1",
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    author: "paciente",
    direction: "entrada",
    content_type: "texto",
    body: "Vocês atendem aos sábados?",
    media_url: null,
    deleted_at: null,
    is_internal_note: false,
    pelo_celular: false,
    created_at: "2026-10-13T14:58:30.000Z",
  });
  banco.linhas("ia_liberacao").push({
    clinic_id: CLINICA,
    teto_respostas_por_conversa_hora: 20,
  });
  banco.linhas("llm_preco").push({
    modelo: "gpt-6-luna",
    entrada_microdolar_por_milhao: 1_000_000,
    saida_microdolar_por_milhao: 4_000_000,
    cache_leitura_microdolar_por_milhao: 100_000,
    cache_escrita_microdolar_por_milhao: 0,
  });
  banco.rpc("ia_pode_falar_com", () => ({ data: true, error: null }));
  banco.rpc("confirmar_posse_job", () => ({ data: true, error: null }));
  banco.rpc("consentimento_vigente", () => ({ data: true, error: null }));
  banco.rpc("reservar_gasto_da_ia", () => ({
    data: "30000000-0000-4000-8000-000000000001",
    error: null,
  }));
  banco.rpc("acertar_gasto_da_ia", () => ({ data: null, error: null }));
  banco.rpc("passar_conversa_da_ia_para_equipe", (args) => {
    passagens.push(String(args.p_motivo));
    const c = conversa();
    if (c.status === "ia_atendendo") {
      c.status = "aguardando_humano";
      return { data: { passou: true, codigo: "passou" }, error: null };
    }
    return { data: { passou: false, codigo: "ja_fora_da_ia" }, error: null };
  });
  banco.rpc("gravar_evento_da_ia", () => ({ data: true, error: null }));
  turno = vi.fn<Dependencias["executarTurno"]>(async () => respondeu());
  enviarResposta = vi.fn<Dependencias["enviarResposta"]>(async () => ({
    ok: true,
    messageId: "msg-1",
  }));
  enviarFrase = vi.fn<Dependencias["enviarFrase"]>(async () => ({
    ok: true,
    messageId: "msg-frase",
  }));
}

function rodar(extra: Partial<Dependencias> = {}) {
  return executarRespostaComIa(job(), EXECUTOR, {
    admin: banco.cliente(),
    config: { ligado: true, clinicas: [CLINICA] },
    prazoFinalMs: AGORA + 55_000,
    agora: () => AGORA,
    clienteDoAgente: () =>
      ({ responses: { create: vi.fn() } }) as unknown as ClienteDoAgente,
    modeloDoAgente: () => "gpt-6-luna",
    segredoDoIdentificador: () => "s".repeat(40),
    criarVerificador: () => async () => ({
      tipo: "falha",
      motivo: "sem_cliente",
      modelo: null,
      uso: null,
      httpStatus: null,
    }),
    criarClassificador: () => async () => ({
      tipo: "falha",
      motivo: "sem_cliente",
      modelo: null,
      uso: null,
      httpStatus: null,
    }),
    executarTurno: turno,
    enviarResposta,
    enviarFrase,
    ...extra,
  });
}

let logs: string[] = [];

beforeEach(() => {
  montar();
  logs = [];
  const capturar = (linha: string | Uint8Array): boolean => {
    logs.push(String(linha));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
});

afterEach(() => {
  vi.restoreAllMocks();
  const tudo = logs.join("");
  expect(tudo).not.toContain("Maria");
  expect(tudo).not.toContain("sábados");
});

describe("o estado lido no começo e gravado antes de decidir", () => {
  it("o turno parte do estado lido, e o novo é gravado com a versão lida antes do envio", async () => {
    banco.linhas("ia_atendimento").push({
      conversation_id: CONVERSA,
      job_id: "99999999-9999-4999-8999-999999999999",
      versao: 4,
      estado: { ...estadoVazioDoBanco(), etapa: "oferta", intencao: "agendar" },
      anterior: null,
    });
    const ordem: string[] = [];
    banco.rpc("gravar_atendimento_da_ia", (args) => {
      ordem.push("gravar");
      expect(args.p_versao).toBe(4);
      expect(args.p_job_id).toBe(JOB);
      expect(args.p_estado).toEqual(ESTADO_NOVO);
      return { data: { ok: true, versao: 5, reutilizado: false }, error: null };
    });
    enviarResposta.mockImplementation(async () => {
      ordem.push("enviar");
      return { ok: true, messageId: "msg-1" };
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno.mock.calls[0]?.[0].atendimento).toEqual({
      estado: { ...estadoVazioDoBanco(), etapa: "oferta", intencao: "agendar" },
      dados: {
        nome_completo: false,
        data_nascimento: false,
        cpf: false,
        carteirinha: false,
        para_o_titular: null,
        faltam: [],
      },
    });
    expect(ordem).toEqual(["gravar", "enviar"]);
  });

  it("janela nova (Devolver): o estado recomeça do vazio, versão 0", async () => {
    // O banco devolve o vazio para a janela nova, mesmo com estado da
    // anterior (a gravacao seguinte apaga o de outra janela).
    banco.rpc("ler_atendimento_da_ia", () => ({
      data: {
        ok: true,
        versao: 0,
        janela_desde: "2026-10-13T14:58:00+00:00",
        estado: estadoVazioDoBanco(),
        dados: {
          nome_completo: false,
          data_nascimento: false,
          cpf: false,
          carteirinha: false,
          para_o_titular: null,
          faltam: ["nome_completo", "data_nascimento"],
        },
      },
      error: null,
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(turno.mock.calls[0]?.[0].atendimento?.estado).toEqual(estadoVazio());
    expect(banco.chamadasDe("gravar_atendimento_da_ia")[0]?.p_versao).toBe(0);
  });

  it("outro job gravou depois da leitura (versão velha): a resposta não sai; a frase e a equipe", async () => {
    banco.rpc("gravar_atendimento_da_ia", () => ({
      data: { ok: false, motivo: "estado_mudou" },
      error: null,
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    expect(passagens).toEqual(["falha_tecnica"]);
    const decisao = banco.linhas("ai_decision_log")[0];
    expect(decisao).toMatchObject({
      desfecho: "falhou",
      aprovado: false,
      texto_sha256: null,
      escalation_reason: "falha_tecnica",
      motivo_da_falha: "desconhecida",
    });
    expect(
      (decisao?.context_read as { trilha: { texto: string }[] }).trilha.map(
        (p) => p.texto,
      ),
    ).toContain(PASSO_DO_ESTADO_NAO_GRAVADO);
  });

  it("erro na gravação: o mesmo (falha fechada)", async () => {
    banco.rpc("gravar_atendimento_da_ia", () => ({
      data: null,
      error: { code: "57014" },
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(enviarFrase).toHaveBeenCalledTimes(1);
  });

  it("a conversa saiu da IA no meio (fora_da_ia na gravação): nada sai, nem a frase", async () => {
    banco.rpc("gravar_atendimento_da_ia", () => {
      conversa().status = "em_atendimento";
      return { data: { ok: false, motivo: "fora_da_ia" }, error: null };
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(banco.linhas("ai_decision_log")[0]).toMatchObject({
      desfecho: "falhou",
      motivo_da_falha: "liberacao_suspensa",
    });
  });

  it("sem posse na gravação: nada decidido, nada sai, o job volta", async () => {
    banco.rpc("gravar_atendimento_da_ia", () => ({
      data: { ok: false, motivo: "sem_posse" },
      error: null,
    }));
    expect(await rodar()).toEqual({ ok: false, erro: "sem_posse" });
    expect(banco.linhas("ai_decision_log")).toEqual([]);
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(enviarFrase).not.toHaveBeenCalled();
  });

  it("job antigo na gravação: só conclui (D-A)", async () => {
    banco.rpc("gravar_atendimento_da_ia", () => ({
      data: { ok: false, motivo: "job_antigo" },
      error: null,
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual([]);
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(enviarFrase).not.toHaveBeenCalled();
  });

  it("erro na leitura: sem chamar o modelo, a frase e a equipe", async () => {
    banco.rpc("ler_atendimento_da_ia", () => ({
      data: null,
      error: { code: "PGRST202" },
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    const decisao = banco.linhas("ai_decision_log")[0];
    expect(decisao).toMatchObject({ desfecho: "falhou" });
    expect(
      (decisao?.context_read as { trilha: { texto: string }[] }).trilha.map(
        (p) => p.texto,
      ),
    ).toContain(PASSO_DO_ESTADO_NAO_LIDO);
  });

  it("fora_da_ia e job_antigo na leitura: conclui sem modelo, sem passagem e sem frase", async () => {
    for (const motivo of ["fora_da_ia", "job_antigo"]) {
      montar();
      banco.rpc("ler_atendimento_da_ia", () => ({
        data: { ok: false, motivo },
        error: null,
      }));
      expect(await rodar(), motivo).toEqual({ ok: true });
      expect(turno).not.toHaveBeenCalled();
      expect(passagens).toEqual([]);
      expect(enviarFrase).not.toHaveBeenCalled();
    }
  });
});

describe("revisao curta das correcoes da AG4: a mensagem nova da pessoa no meio do turno", () => {
  it("o turno que para sem enviar (mensagem_nova_do_paciente): grava o estado do comeco, nada sai, nada passa, e as lidas dele nao contam como respondidas", async () => {
    const { idsRespondidos } = await import("@/lib/agente/historico");
    const armado = {
      ...estadoVazio(),
      etapa: "cancelar" as const,
      intencao: "cancelar" as const,
      pedido_pendente: "cancelar" as const,
      pedido_pendente_em: "2026-10-13T14:57:00.000Z",
      appointment_id: "a1a1a1a1-0000-4000-8000-000000000001",
    };
    let gravado: unknown = null;
    banco.rpc("gravar_atendimento_da_ia", (args) => {
      gravado = args.p_estado;
      return { data: { ok: true, versao: 1, reutilizado: false }, error: null };
    });
    turno.mockImplementation(async () => ({
      ...COMUM,
      trilha: [
        {
          tipo: "agenda" as const,
          texto:
            "Não cancelou a consulta: a pessoa mandou outra mensagem enquanto o assistente respondia. Nada foi enviado; a próxima resposta lê a mensagem nova.",
        },
      ],
      tipo: "frase_fixa",
      resposta: FRASE_DE_ESCALONAMENTO,
      desfecho: { tipo: "falhou", motivo: "sem_mensagem" },
      filtro: null,
      rascunhoBloqueado: null,
      atendimento: {
        estado: armado,
        dados: {
          nome_completo: false,
          data_nascimento: false,
          cpf: false,
          carteirinha: false,
          para_o_titular: null,
          faltam: [],
        },
      },
      notaParaAEquipe: null,
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(gravado).toEqual(armado);
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(passagens).toEqual([]);
    expect(conversa().status).toBe("ia_atendendo");
    expect(
      banco.linhas("message").filter((m) => m.is_internal_note === true),
    ).toEqual([]);
    const turnoDoJob = banco.linhas("ai_turno").find((t) => t.job_id === JOB);
    expect(turnoDoJob).toMatchObject({ estado: "sem_envio", saida: "nenhuma" });
    expect(banco.linhas("ai_decision_log")[0]).toMatchObject({
      desfecho: "falhou",
      escalation_reason: null,
      motivo_da_falha: "sem_mensagem",
    });
    // O proximo job le de novo as mensagens que este leu (o turno sem envio
    // nao as respondeu) junto da mensagem nova.
    expect(
      idsRespondidos(
        [
          {
            job_id: JOB,
            estado: String(turnoDoJob?.estado),
            mensagens_lidas: ["m1"],
          },
        ],
        "20000000-0000-4000-8000-000000000002",
      ).has("m1"),
    ).toBe(false);
  });
});

describe("a nota para a equipe na passagem (item 8)", () => {
  it("vai como nota interna, pelo caminho da automação: sistema, sem job e sem custo", async () => {
    turno.mockImplementation(async () => escalou());
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["sintoma"]);
    const notas = banco
      .linhas("message")
      .filter((m) => m.is_internal_note === true);
    expect(notas).toEqual([
      expect.objectContaining({
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        direction: "saida",
        author: "sistema",
        content_type: "texto",
        body: NOTA,
        is_internal_note: true,
        billable: false,
        cost_cents: 0,
      }),
    ]);
    expect(notas[0]?.job_id).toBeUndefined();
    expect(enviarFrase).toHaveBeenCalledTimes(1);
  });

  it("alguém assumiu antes da passagem: nem nota nem frase", async () => {
    turno.mockImplementation(async () => {
      const r = escalou();
      conversa().status = "em_atendimento";
      return r;
    });
    banco.rpc("gravar_atendimento_da_ia", () => ({
      data: { ok: true, versao: 1, reutilizado: false },
      error: null,
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(
      banco.linhas("message").filter((m) => m.is_internal_note === true),
    ).toEqual([]);
    expect(enviarFrase).not.toHaveBeenCalled();
  });
});
