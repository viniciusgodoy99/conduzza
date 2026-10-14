import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { ClienteDoAgente } from "@/lib/agente/laco";
import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import { executarPassagemDaIa } from "@/lib/jobs/motor-ia";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// E3, ponta a ponta com o LLM FALSO contra o banco REAL (M1, M3 e M2
// aplicadas): a mensagem entra por ingest_inbound_message, vira job por
// enfileirar_resposta_da_ia, o motor da IA (executarPassagemDaIa) reivindica
// por claim_jobs_da_ia com a flag de teste, o executor roda o LACO DE VERDADE
// sobre um cliente falso de roteiro (nenhum teste chama a OpenAI: o pacote
// 'openai' e um stub e o fetch recusa o host), o filtro de conformidade de
// verdade com verificador e classificador falsos, e o envio de verdade
// (send.ts) sobre o provedor 'fake'. O gatilho de message (M3) e o de
// verdade: a resposta so grava como 'ia' com a decisao aprovada do mesmo job
// e o mesmo hash.
//
// Casos:
// - pergunta comum: a resposta aprovada sai como 'ia' com custo zero, a
//   decisao tem o hash do texto, o turno fica 'enviado' sem texto, a
//   conversa segue na IA e a espera cai (ia_marcar_respondida);
// - sintoma: o portao escala sem chamar o modelo, a conversa passa para a
//   equipe com o evento e so a frase fixa sai, como 'sistema';
// - bloqueio do verificador: o rascunho vai SO para ai_rascunho_bloqueado
//   (blocked_draft nulo em ai_decision_log), a conversa passa com o evento de
//   conformidade e so a frase sai;
// - (revisao de 13/10/2026) duas passagens ao mesmo tempo sobre o mesmo job
//   devido: uma linha 'ia' e um envio so; o telefone da equipe que revogou a
//   autorizacao para receber mensagens nao chega ao modelo, nao recebe nada
//   (nem a frase) e a conversa passa com o evento proprio; nenhuma batida
//   'motor-ia' e gravada (baterPonto: false: worker_heartbeat e global e a
//   higiene protege essa linha).
//
// CUIDADO, o banco e o da producao: clinica e_de_teste (fora da lista
// fechada: o motor da IA de producao nunca a reivindica), numero 'fake'
// (nenhuma mensagem sai), apagada no afterAll. O interruptor global NUNCA e
// tocado. Nada usa a id da salud-care, da teste123 nem da Conduzza Teste.
// Cada caso ingere logo antes de rodar o motor: a manutencao de producao
// devolve conversa de teste com janela sem resposta ha mais de 3 minutos.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const clinicas: string[] = [];

const EQ_COMUM = `+5584981${digitos}`;
const EQ_SINTOMA = `+5584982${digitos}`;
const EQ_BLOQUEIO = `+5584983${digitos}`;
const EQ_DUAS = `+5584984${digitos}`;
const EQ_SEM_AUTORIZACAO = `+5584985${digitos}`;

let clinicaT = "";
let numeroT = "";
/** A batida 'motor-ia' antes da suite (nula se a linha nao existe). */
let batidaAntes: string | null = null;

type Ingestao = {
  inserted: boolean;
  conversation_id: string | null;
  message_id: string | null;
  contact_id: string | null;
  ia_atendendo?: boolean;
};

type Enfileirado = { codigo: string; job_id: string | null };

let seq = 0;
const wa = () => `ia-whatsapp-pap:${sufixo}:${++seq}`;

async function rpcOk<T>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
}

const USO_DA_API = {
  input_tokens: 1_200,
  output_tokens: 80,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 10 },
};

/** Uma resposta final da Responses API, no formato que o laco le. */
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

const verificadorQueAprova: Verificador = async () => ({
  tipo: "veredicto",
  veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: null,
});

const verificadorQueReprova: Verificador = async () => ({
  tipo: "veredicto",
  veredicto: {
    aprovado: false,
    violacoes: [{ categoria: "triagem", gravidade: "alta" }],
    confianca: "alta",
  },
  modelo: "gpt-6-luna",
  uso: null,
});

const classificadorNeutro: ClassificadorDeEntrada = async () => ({
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: null,
});

/** Ingere, enfileira e deixa o job devido. */
async function prepararTurno(telefone: string, corpo: string) {
  const ingestao = await rpcOk<Ingestao>("ingest_inbound_message", {
    p_clinic_id: clinicaT,
    p_phone_e164: telefone,
    p_name: "Contato sintético",
    p_wa_message_id: wa(),
    p_content_type: "texto",
    p_body: corpo,
    p_whatsapp_account_id: numeroT,
  });
  expect(ingestao).toMatchObject({ inserted: true, ia_atendendo: true });
  const enfileirado = await rpcOk<Enfileirado>("enfileirar_resposta_da_ia", {
    p_clinic_id: clinicaT,
    p_conversation_id: ingestao.conversation_id,
    p_message_id: ingestao.message_id,
    p_incluir_teste: true,
  });
  expect(enfileirado.codigo).toBe("enfileirado");
  await admin
    .from("job_queue")
    .update({ run_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", enfileirado.job_id!)
    .throwOnError();
  return {
    conversationId: ingestao.conversation_id!,
    contactId: ingestao.contact_id!,
    jobId: enfileirado.job_id!,
  };
}

async function batidaDoMotorDaIa(): Promise<string | null> {
  const { data } = await admin
    .from("worker_heartbeat")
    .select("batida_em")
    .eq("worker_id", "motor-ia")
    .maybeSingle()
    .throwOnError();
  return (data as { batida_em: string } | null)?.batida_em ?? null;
}

/** Uma passagem do motor da IA com o LLM falso de roteiro. */
async function passagem(roteiro: unknown[], verificador: Verificador) {
  const create = vi.fn(async () => roteiro.shift());
  const resumo = await executarPassagemDaIa({
    executorId: `motor-ia:${crypto.randomUUID()}`,
    prazoFinalMs: Date.now() + 55_000,
    incluirClinicasDeTeste: true,
    // a suite nunca grava a batida 'motor-ia' da producao
    baterPonto: false,
    dependencias: {
      admin,
      config: { ligado: true, clinicas: [clinicaT] },
      agora: Date.now,
      clienteDoAgente: () =>
        ({ responses: { create } }) as unknown as ClienteDoAgente,
      modeloDoAgente: () => "gpt-6-luna",
      segredoDoIdentificador: () => "s".repeat(40),
      criarVerificador: () => verificador,
      criarClassificador: () => classificadorNeutro,
    },
  });
  return { resumo, create };
}

async function mensagens(conversationId: string) {
  const { data } = await admin
    .from("message")
    .select(
      "author, body, job_id, content_type, cost_cents, billable, delivery_status",
    )
    .eq("conversation_id", conversationId)
    .order("created_at")
    .throwOnError();
  return data as {
    author: string;
    body: string | null;
    job_id: string | null;
    content_type: string;
    cost_cents: number | null;
    billable: boolean | null;
    delivery_status: string | null;
  }[];
}

async function decisao(jobId: string) {
  const { data } = await admin
    .from("ai_decision_log")
    .select(
      "desfecho, aprovado, texto_sha256, escalation_reason, compliance_blocked, blocked_draft, gatilho_entrada",
    )
    .eq("job_id", jobId)
    .single()
    .throwOnError();
  return data as Record<string, unknown>;
}

async function turno(jobId: string) {
  const { data } = await admin
    .from("ai_turno")
    .select("estado, texto, saida")
    .eq("job_id", jobId)
    .single()
    .throwOnError();
  return data as { estado: string; texto: string | null; saida: string | null };
}

async function conversa(id: string) {
  const { data } = await admin
    .from("conversation")
    .select("status, awaiting_reply, assignee_user_id")
    .eq("id", id)
    .single()
    .throwOnError();
  return data as {
    status: string;
    awaiting_reply: boolean;
    assignee_user_id: string | null;
  };
}

beforeAll(async () => {
  batidaAntes = await batidaDoMotorDaIa();
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `IA WhatsApp ponta a ponta ${sufixo}`,
      slug: `ia-whatsapp-pap-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  clinicaT = (data as { id: string }).id;
  clinicas.push(clinicaT);

  numeroT = (
    await criarNumeroDeTeste(admin, clinicaT, {
      nome: "Recepção",
      connection_status: "conectado",
      instance_token: `tok-${sufixo}`,
    })
  ).id;

  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinicaT,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de integracao do E3 (ponta a ponta)",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinicaT,
    p_whatsapp_account_id: numeroT,
    p_ativo: true,
  });
  for (const telefone of [
    EQ_COMUM,
    EQ_SINTOMA,
    EQ_BLOQUEIO,
    EQ_DUAS,
    EQ_SEM_AUTORIZACAO,
  ]) {
    await rpcOk("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaT,
      p_telefone_e164: telefone,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
    });
  }
  // Versao publicada, 24 horas (o padrao do banco).
  await admin
    .from("ai_agent_config")
    .insert({
      clinic_id: clinicaT,
      version: 1,
      status: "publicada",
      operating_mode: "24h",
    })
    .throwOnError();
});

afterAll(async () => {
  if (clinicas.length > 0) {
    await admin.from("clinic").delete().in("id", clinicas);
  }
});

beforeEach(() => {
  resetFakeProvider();
});

describe("ponta a ponta com o LLM falso", () => {
  it("pergunta comum: a resposta aprovada sai como 'ia', com custo zero e o hash da decisão", async () => {
    const { conversationId, jobId } = await prepararTurno(
      EQ_COMUM,
      "Vocês atendem aos sábados?",
    );
    const texto = "Atendemos de segunda a sexta. Posso ajudar em algo mais?";
    const { resumo, create } = await passagem(
      [respostaFinal(texto)],
      verificadorQueAprova,
    );

    expect(resumo).toMatchObject({
      reivindicados: 1,
      concluidos: 1,
      falhos: 0,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(fakeSentMessages().map((m) => [m.to, m.body])).toEqual([
      [EQ_COMUM, texto],
    ]);

    const daIa = (await mensagens(conversationId)).filter(
      (m) => m.author === "ia",
    );
    expect(daIa).toEqual([
      expect.objectContaining({
        body: texto,
        job_id: jobId,
        cost_cents: 0,
        billable: false,
        delivery_status: "enviada",
      }),
    ]);
    expect(await decisao(jobId)).toMatchObject({
      desfecho: "respondeu",
      aprovado: true,
      texto_sha256: sha256DoTexto(texto),
      blocked_draft: null,
    });
    expect(await turno(jobId)).toMatchObject({
      estado: "enviado",
      texto: null,
    });
    expect(await conversa(conversationId)).toMatchObject({
      status: "ia_atendendo",
      awaiting_reply: false,
      assignee_user_id: null,
    });
  });

  it("sintoma: o portão escala sem chamar o modelo; a conversa passa e só a frase sai", async () => {
    const { conversationId, jobId } = await prepararTurno(
      EQ_SINTOMA,
      "Estou com muita dor de cabeça desde ontem",
    );
    const { resumo, create } = await passagem([], verificadorQueAprova);

    expect(resumo).toMatchObject({ reivindicados: 1, concluidos: 1 });
    expect(create).not.toHaveBeenCalled();
    expect(fakeSentMessages().map((m) => m.body)).toEqual([
      FRASE_DE_ESCALONAMENTO,
    ]);

    const todas = await mensagens(conversationId);
    expect(todas.some((m) => m.author === "ia")).toBe(false);
    expect(todas.filter((m) => m.job_id === jobId)).toEqual([
      expect.objectContaining({
        author: "sistema",
        body: FRASE_DE_ESCALONAMENTO,
      }),
    ]);
    expect(
      todas.filter((m) => m.content_type === "evento").map((m) => m.body),
    ).toContain(
      "A IA passou a conversa para a equipe: o paciente descreveu um sintoma.",
    );
    expect(await decisao(jobId)).toMatchObject({
      desfecho: "escalou",
      escalation_reason: "sintoma",
      gatilho_entrada: "sintoma",
    });
    expect(await turno(jobId)).toMatchObject({ estado: "passou_para_equipe" });
    expect(await conversa(conversationId)).toMatchObject({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
  });

  it("bloqueio do verificador: o rascunho vai só para o lugar restrito e só a frase sai", async () => {
    const { conversationId, jobId } = await prepararTurno(
      EQ_BLOQUEIO,
      "Quanto custa a limpeza de pele?",
    );
    const rascunho = "A limpeza de pele custa a partir de cento e vinte reais.";
    const { resumo } = await passagem(
      [respostaFinal(rascunho)],
      verificadorQueReprova,
    );

    expect(resumo).toMatchObject({ reivindicados: 1, concluidos: 1 });
    expect(fakeSentMessages().map((m) => m.body)).toEqual([
      FRASE_DE_ESCALONAMENTO,
    ]);
    expect(
      (await mensagens(conversationId)).some((m) => m.author === "ia"),
    ).toBe(false);

    expect(await decisao(jobId)).toMatchObject({
      desfecho: "bloqueou",
      compliance_blocked: true,
      escalation_reason: "conformidade",
      blocked_draft: null,
    });
    const { data: guardado } = await admin
      .from("ai_rascunho_bloqueado")
      .select("texto, job_id, conversation_id")
      .eq("job_id", jobId)
      .throwOnError();
    expect(guardado).toEqual([
      { texto: rascunho, job_id: jobId, conversation_id: conversationId },
    ]);
    expect(await conversa(conversationId)).toMatchObject({
      status: "aguardando_humano",
    });
    const eventosDaConversa = (await mensagens(conversationId))
      .filter((m) => m.content_type === "evento")
      .map((m) => m.body);
    expect(eventosDaConversa).toContain(
      "A IA passou a conversa para a equipe: a resposta não passou na conformidade.",
    );
  });

  it("duas passagens ao mesmo tempo sobre o mesmo job devido: uma linha 'ia' e um envio so", async () => {
    const { conversationId, jobId } = await prepararTurno(
      EQ_DUAS,
      "Qual o endereço da clínica?",
    );
    const texto = "Ficamos na Rua Exemplo, 100. Posso ajudar em algo mais?";
    const [a, b] = await Promise.all([
      passagem([respostaFinal(texto)], verificadorQueAprova),
      passagem([respostaFinal(texto)], verificadorQueAprova),
    ]);
    expect(a.resumo.reivindicados + b.resumo.reivindicados).toBe(1);
    expect(a.create.mock.calls.length + b.create.mock.calls.length).toBe(1);
    expect(fakeSentMessages().map((m) => [m.to, m.body])).toEqual([
      [EQ_DUAS, texto],
    ]);
    const daIa = (await mensagens(conversationId)).filter(
      (m) => m.author === "ia",
    );
    expect(daIa).toEqual([
      expect.objectContaining({ body: texto, job_id: jobId }),
    ]);
  });

  it("autorizacao revogada pelo telefone da equipe: nada vai ao modelo nem ao contato; a conversa passa com o evento", async () => {
    const { conversationId, contactId, jobId } = await prepararTurno(
      EQ_SEM_AUTORIZACAO,
      "Quanto custa a consulta?",
    );
    await admin
      .from("contact_consent")
      .update({ revoked_at: new Date().toISOString() })
      .eq("clinic_id", clinicaT)
      .eq("contact_id", contactId)
      .throwOnError();
    const { resumo, create } = await passagem(
      [respostaFinal("Não deveria sair.")],
      verificadorQueAprova,
    );
    expect(resumo).toMatchObject({ reivindicados: 1, concluidos: 1 });
    expect(create).not.toHaveBeenCalled();
    expect(fakeSentMessages()).toEqual([]);
    const todas = await mensagens(conversationId);
    expect(todas.filter((m) => m.job_id === jobId)).toEqual([]);
    expect(
      todas.filter((m) => m.content_type === "evento").map((m) => m.body),
    ).toContain(
      "A IA passou a conversa para a equipe: o contato não tem autorização para receber mensagens.",
    );
    expect(await conversa(conversationId)).toMatchObject({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
  });

  it("nenhuma batida 'motor-ia' gravada pela suite (worker_heartbeat da producao)", async () => {
    // Sem o motor da IA ligado na producao, a linha nao existe e tem de
    // continuar sem existir. Com ele ligado, a batida pode andar pelo motor
    // de verdade (nao da para separar); o baterPonto: false acima vale igual.
    if (batidaAntes === null) {
      expect(await batidaDoMotorDaIa()).toBeNull();
    }
  });
});
