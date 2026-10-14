import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => ({
    ...configPadraoDoAgente(),
    status: "publicada",
    versao: 7,
  }),
  carregarCatalogoDoAgente: async () => ({
    procedimentos: [],
    vinculos: [],
    convenios: [],
    conveniosDoCadastro: [],
  }),
}));

import { executarTurnoDoAgente, type ClienteDoAgente } from "@/lib/agente/laco";
import { configPadraoDoAgente } from "@/lib/domain/agente/config";
import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  enviarFraseFixaDaIa,
  enviarRespostaDaIa,
} from "@/lib/integrations/whatsapp/send";

import type { DependenciasDoExecutorDaIa } from "@/lib/jobs/responder-com-ia";

import { BancoEmMemoria, type Linha } from "./banco-em-memoria";

const { executarRespostaComIa } = await import("@/lib/jobs/responder-com-ia");
const { executarJobComPosse } = await import("@/lib/jobs/worker");

// Ponta a ponta sem rede: o executor com o LACO DE VERDADE (executarTurno
// do agente) sobre um LLM falso de roteiro, o envio de verdade (send.ts)
// sobre o provedor falso, e um gatilho de message emulado com a regra do
// banco (author 'ia' so com decisao aprovada do mesmo job e o mesmo hash;
// frase so com o corpo fixo). Nenhum teste chama a OpenAI.
//
// "Frase que nao sai (slot adiado)" (achado X3 da revisao): esta e a PROVA
// da propriedade (o executor comum do worker, o executor da IA, o laco e o
// send.ts de verdade; so o banco e em memoria, com reservar_slot_envio_v2
// devolvendo 'adiado'): o job conclui sem reagendar_job (devolucoes nunca
// sobe), a frase nao e gravada nem enviada, e o evento do aviso e gravado.
// A suite de integracao (tests/integration/ia-whatsapp.test.ts) prova so as
// duas RPCs com o banco real.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const CONTATO = "c1000000-0000-4000-8000-000000000001";
const NUMERO = "a0000000-0000-4000-8000-000000000001";
const JOB = "10000000-0000-4000-8000-000000000001";
const EXECUTOR = "motor-ia:20000000-0000-4000-8000-000000000001";
const TELEFONE = "+5584999990001";
const AGORA = Date.UTC(2026, 9, 13, 15, 0);

const USO_DA_API = {
  input_tokens: 1_200,
  output_tokens: 80,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 10 },
};

function respostaFinal(mensagem: string) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    usage: USO_DA_API,
    output: [
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
    ],
  };
}

let banco: BancoEmMemoria;

function montar(pergunta: string) {
  banco = new BancoEmMemoria();
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
    numero: {
      id: NUMERO,
      provider: "fake",
      server_url: null,
      instance_id: "fake-a0000000",
      nome: "Recepção",
      connection_status: "conectado",
      removido_em: null,
    },
  });
  banco.linhas("contact").push({
    id: CONTATO,
    clinic_id: CLINICA,
    phone_key: TELEFONE,
    phone_e164: TELEFONE,
    name: null,
    birth_date: null,
  });
  banco.linhas("whatsapp_account_secret").push({
    clinic_id: CLINICA,
    account_id: NUMERO,
    instance_token: "token",
  });
  banco.linhas("ia_janela_da_conversa").push({
    conversation_id: CONVERSA,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    phone_key: TELEFONE,
    desde: "2026-10-13T14:58:00.000Z",
    aberta_por: "ingestao",
  });
  banco.linhas("message").push({
    id: "m1",
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    author: "paciente",
    direction: "entrada",
    content_type: "texto",
    body: pergunta,
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
  for (const nome of [
    "ia_pode_falar_com",
    "confirmar_posse_job",
    "consentimento_vigente",
    "ia_marcar_respondida",
  ]) {
    banco.rpc(nome, () => ({ data: true, error: null }));
  }
  banco.rpc("ia_pode_enviar_agora", () => ({ data: "ok", error: null }));
  banco.rpc("reservar_slot_envio_v2", () => ({
    data: { estado: "ok", espera_ms: 0 },
    error: null,
  }));
  banco.rpc("reservar_gasto_da_ia", () => ({
    data: "30000000-0000-4000-8000-000000000001",
    error: null,
  }));
  banco.rpc("passar_conversa_da_ia_para_equipe", () => {
    const c = banco.linhas("conversation")[0]!;
    c.status = "aguardando_humano";
    return { data: { passou: true, codigo: "passou" }, error: null };
  });
  // O gatilho de message (M3), na regra que importa aqui.
  banco.aoInserir = (tabela, linha: Linha) => {
    if (tabela !== "message") {
      return null;
    }
    if (linha.author === "ia") {
      const sha = sha256DoTexto(String(linha.body));
      const aprovada = banco
        .linhas("ai_decision_log")
        .some(
          (d) =>
            d.aprovado === true &&
            d.compliance_blocked === false &&
            d.job_id === linha.job_id &&
            d.texto_sha256 === sha,
        );
      return aprovada ? null : { code: "CZIA1", message: "ia_sem_aprovacao" };
    }
    if (linha.job_id === JOB && linha.body !== FRASE_DE_ESCALONAMENTO) {
      return { code: "CZIA3", message: "frase_divergente" };
    }
    return null;
  };
}

const JOB_DO_TESTE = {
  id: JOB,
  clinic_id: CLINICA,
  kind: "responder_com_ia",
  payload: { conversation_id: CONVERSA, ultima_mensagem_id: "m1" },
  attempts: 1,
  max_attempts: 3,
  whatsapp_account_id: NUMERO,
  created_at: "2026-10-13T14:59:00.000Z",
} as const;

function dependencias(
  create: ReturnType<typeof vi.fn>,
): DependenciasDoExecutorDaIa {
  return {
    admin: banco.cliente(),
    config: { ligado: true, clinicas: [CLINICA] },
    prazoFinalMs: AGORA + 55_000,
    agora: () => AGORA,
    clienteDoAgente: () =>
      ({ responses: { create } }) as unknown as ClienteDoAgente,
    modeloDoAgente: () => "gpt-6-luna",
    segredoDoIdentificador: () => "s".repeat(40),
    criarVerificador: () => async () => ({
      tipo: "veredicto",
      veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
      modelo: "gpt-6-luna",
      uso: null,
    }),
    criarClassificador: () => async () => ({
      tipo: "classificacao",
      classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
      modelo: "gpt-6-luna",
      uso: null,
    }),
    executarTurno: executarTurnoDoAgente,
    enviarResposta: enviarRespostaDaIa,
    enviarFrase: enviarFraseFixaDaIa,
  };
}

function rodar(roteiro: unknown[]) {
  const create = vi.fn(async () => roteiro.shift());
  return executarRespostaComIa(
    { ...JOB_DO_TESTE, payload: { ...JOB_DO_TESTE.payload } },
    EXECUTOR,
    dependencias(create),
  ).then((resultado) => ({ resultado, create }));
}

beforeEach(() => {
  resetFakeProvider();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ponta a ponta com LLM falso", () => {
  it("pergunta comum: a resposta aprovada sai como 'ia', com custo zero, e o hash bate com a decisão", async () => {
    montar("Vocês atendem aos sábados?");
    const texto = "Atendemos de segunda a sexta. Posso ajudar em algo mais?";
    const { resultado, create } = await rodar([respostaFinal(texto)]);
    expect(resultado).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(fakeSentMessages().map((m) => [m.to, m.body])).toEqual([
      [TELEFONE, texto],
    ]);
    const linha = banco.linhas("message").find((m) => m.author === "ia");
    expect(linha).toMatchObject({
      body: texto,
      job_id: JOB,
      cost_cents: 0,
      billable: false,
      delivery_status: "enviada",
    });
    expect(banco.linhas("ai_decision_log")[0]).toMatchObject({
      desfecho: "respondeu",
      texto_sha256: sha256DoTexto(texto),
      config_version: 7,
    });
    expect(banco.linhas("ai_turno")[0]).toMatchObject({
      estado: "enviado",
      texto: null,
    });
  });

  it("sintoma: o portão escala sem chamar o modelo, a conversa passa e só a frase sai", async () => {
    montar("Estou com muita dor de cabeça desde ontem");
    const { resultado, create } = await rodar([]);
    expect(resultado).toEqual({ ok: true });
    expect(create).not.toHaveBeenCalled();
    expect(fakeSentMessages().map((m) => m.body)).toEqual([
      FRASE_DE_ESCALONAMENTO,
    ]);
    expect(banco.linhas("conversation")[0]?.status).toBe("aguardando_humano");
    expect(banco.linhas("ai_decision_log")[0]).toMatchObject({
      desfecho: "escalou",
      escalation_reason: "sintoma",
      gatilho_entrada: "sintoma",
    });
  });

  it("frase que não sai (slot adiado, X3): o job conclui sem reagendar, nada é gravado nem enviado e o aviso fica no fio", async () => {
    montar("Estou com muita dor de cabeça desde ontem");
    // O canal do número está ocupado: o send.ts de verdade devolve
    // slot_adiado para a frase (nada reservado, nada gravado).
    banco.rpc("reservar_slot_envio_v2", () => ({
      data: { estado: "adiado", livre_em: "2026-10-13T15:00:20.000Z" },
      error: null,
    }));
    banco.rpc("gravar_evento_da_ia", () => ({ data: true, error: null }));
    banco.rpc("concluir_job", () => ({ data: true, error: null }));
    const create = vi.fn(async () => undefined);
    const desfecho = await executarJobComPosse(
      banco.cliente(),
      EXECUTOR,
      { ...JOB_DO_TESTE, payload: { ...JOB_DO_TESTE.payload } },
      { prazoFinalMs: AGORA + 55_000, dependenciasDaIa: dependencias(create) },
    );
    expect(desfecho).toBe("concluido");
    expect(create).not.toHaveBeenCalled();
    expect(banco.chamadasDe("reservar_slot_envio_v2")).toHaveLength(1);
    expect(fakeSentMessages()).toEqual([]);
    expect(banco.linhas("message").filter((m) => m.job_id === JOB)).toEqual([]);
    expect(banco.chamadasDe("passar_conversa_da_ia_para_equipe")).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "sintoma" },
    ]);
    expect(banco.chamadasDe("gravar_evento_da_ia")).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "aviso_nao_enviado" },
    ]);
    expect(banco.chamadasDe("concluir_job")).toEqual([
      { p_id: JOB, p_worker: EXECUTOR },
    ]);
    // devolucoes so sobe em reagendar_job; falhar_job queimaria tentativa.
    expect(banco.chamadasDe("reagendar_job")).toEqual([]);
    expect(banco.chamadasDe("falhar_job")).toEqual([]);
    expect(banco.linhas("conversation")[0]?.status).toBe("aguardando_humano");
    expect(banco.linhas("ai_turno")[0]).toMatchObject({
      estado: "passou_para_equipe",
    });
  });
});
