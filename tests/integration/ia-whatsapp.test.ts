import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, anonClient } from "../rls/stack";

// E3, a IA no WhatsApp so com os telefones da equipe (migrations
// 20261013100000 M1, 20261013110000 M3 e 20261013120000 M2) contra o banco
// REAL, pelo cliente de servico (o servidor) e, so no Devolver e no Assumir,
// pela sessao de uma recepcionista sintetica. Os comportamentos que dependem
// de tempo (rajada, teto de 15 s, claim, higiene, varredura) ficaram fora
// dos ensaios (now() e fixo na transacao) e vivem aqui:
// - ingestao: telefone liberado cria conversa NA IA com janela; telefone
//   fora da lista fica com a equipe; telefone liberado num numero nao
//   liberado fica com a equipe (evento 'parada'); conversa que ja existia nunca entra
//   (aguardando ou em atendimento); conversa ja na IA continua com o teto
//   estourado (ia_pode_falar_com) e conversa nova no teto nasce com a
//   equipe e com o evento 'parada'; numero_proprio igual a hoje; numero da
//   plataforma nunca entra;
// - fila: a rajada vira UM job; o run_at ANDA a cada mensagem (espera
//   deslizante) e, com o job criado ha mais de 11 s, para em created_at +
//   15 s (teto);
//   mensagem nova durante o turno, retry (falhar_job) e retomada
//   (reagendar_job 'retomar_envio') convivem sem 23505 e saem na ordem;
//   claim com e sem a flag de teste; dois claims ao mesmo tempo nao esperam
//   um ao outro e so um leva o job; o claim legado nao enterra o kind; a
//   higiene cancela pendente de conversa fora da IA; desligar o telefone
//   cancela o pendente e grava o evento;
// - janela: o Devolver numa conversa antiga abre a janela DEPOIS das
//   mensagens antigas (o carregador so le created_at >= desde); contato com
//   sinal de paciente nao volta (contato_de_paciente); job criado antes de
//   Assumir e Devolver nao envia (janela_invalida);
// - gatilho de message: CZIA1, CZIA2 e CZIA3; recibo, apagar e poda passam;
//   clinica de teste sem job_id grava 'ia' (fixture);
// - celular: pessoa tira da IA e MANTEM "Aguardando voce" quando o paciente
//   escreveu depois; a resposta automatica do app nao tira; o eco do envio
//   da IA (o MESMO texto da decisao aprovada) nao tira; outro texto da pessoa
//   tira mesmo com a linha da IA ainda sem wa_message_id, e cancela o
//   pendente;
// - varredura de 3 minutos (motor_manutencao): devolve a conversa sem
//   resposta, com o evento, sem mensagem ao contato;
// - frase que nao sai: as RPCs de passagem e do evento 'aviso_nao_enviado'
//   nao mexem no job (o executor com slot_adiado e provado na unidade,
//   tests/unit/ia-whatsapp/ponta-a-ponta.test.ts);
// - correcoes da revisao de 13/10/2026: fora da lista nunca (gatilho CZIA2,
//   claim vazio e enfileirar fora_da_fase numa clinica descartavel que deixa
//   de ser de teste so durante o teste, foraDeTeste; enfileirar de clinica
//   de teste sem a flag; gatilho com o telefone desligado); D-B (contato que
//   vira paciente sai da IA; telefone forcado entra e volta pelo Devolver);
//   D-A (job de antes do Devolver nao mexe na sessao nova, e o claim o
//   cancela); a ingestao devolve a conversa que perdeu a liberacao (evento
//   'parada'); o caminho positivo de tirar_conversa_da_ia_pelo_servidor;
// - varios numeros (decisao do dono de 19/10/2026, migration
//   20261019110000): com dois numeros ligados, o telefone da equipe entra
//   na IA pelos dois, numa conversa por numero (a mesma pessoa, duas
//   conversas, cada uma com a propria janela e a propria fila); telefone
//   fora da lista nunca; desligar um numero devolve so a conversa dele (com
//   o evento e o pendente cancelado) e o outro continua atendendo.
// - onda 2 (migration 20261022110000, M2): o publico da versao publicada na
//   ENTRADA (so leads: o paciente forcado nao entra, o contato sem cadastro
//   entra como lead; so pacientes: o inverso), e o lead que vira paciente no
//   meio da conversa continua (ia_pode_falar_com nao olha o publico);
//   excluir telefone devolve a conversa dele para a equipe, com o evento; o
//   forcar sem a confirmacao do teste da 23514 ate para o servidor. ESCRITO
//   NA ONDA 2 E NAO RODADO por quem escreveu: roda depois de aplicar a
//   migration.
// O claim LEGADO nunca e chamado com limite (ele reivindicaria jobs reais
// de outras clinicas): so com p_limit 0, para provar que nao enterra o kind.
// Que ele nao REIVINDICA o kind e provado no harness local e no ensaio.
// Ponta a ponta com o LLM falso: tests/integration/ia-whatsapp-ponta-a-ponta.test.ts.
//
// A manutencao de producao (pg_cron, a cada minuto) tambem varre conversa
// de teste COM janela que espera resposta ha mais de 3 minutos: cada bloco
// ingere logo antes de usar a conversa.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste (fora da lista
// fechada: nao dependem do interruptor, so atendem em numero 'fake' e o
// motor da IA de producao nunca as reivindica), apagadas no afterAll. O
// interruptor global NUNCA e tocado. Nada usa a id da salud-care, da
// teste123 nem da Conduzza Teste. Nenhuma mensagem sai (numero fake e
// nenhum executor roda aqui).

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `IaWhatsappInt!${sufixo}`;
const clinicas: string[] = [];

const EQ1 = `+5584971${digitos}`;
const EQ2 = `+5584972${digitos}`;
const EQ3 = `+5584973${digitos}`;
const EQ4 = `+5584974${digitos}`;
const EQ5 = `+5584976${digitos}`;
const EQ6 = `+5584977${digitos}`;
const EQ7 = `+5584978${digitos}`;
const OUTRA = `+5584979${digitos}`;
// Correcoes da revisao (13/10/2026)
const EQ_PACIENTE = `+5584961${digitos}`;
const EQ_FORCADO = `+5584962${digitos}`;
const EQ_DA = `+5584963${digitos}`;
const EQ_PERDA = `+5584964${digitos}`;
const EQ_F = `+5584965${digitos}`;
const EQ_ECO = `+5584966${digitos}`;
const EQ_DESLIGA = `+5584967${digitos}`;
const EQ_SERVIDOR = `+5584968${digitos}`;
// Varios numeros ligados (decisao do dono de 19/10/2026)
const EQ_VARIOS = `+5584969${digitos}`;
const DISPLAY_T = `+55 84 2${digitos}-1`;
const NUMERO_T_E164 = `+55842${digitos}1`;
const DISPLAY_U = `+55 84 2${digitos}-2`;
const NUMERO_U_E164 = `+55842${digitos}2`;

let clinicaT = "";
let clinicaU = "";
let numeroT = "";
let numeroT2 = "";
let recepcionista = "";
let sessao: SupabaseClient;

type Ingestao = {
  inserted: boolean;
  ignorada?: string;
  conversation_id: string | null;
  message_id: string | null;
  contact_id: string | null;
  ia_atendendo?: boolean;
};

type Enfileirado = { codigo: string; job_id: string | null };

type Job = {
  id: string;
  status: string;
  attempts: number;
  devolucoes: number;
  run_at: string;
  created_at: string;
  payload: Record<string, unknown>;
  last_error: string | null;
};

let seq = 0;
const wa = () => `ia-whatsapp-int:${sufixo}:${++seq}`;

async function novaClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `IA WhatsApp ${nome} ${sufixo}`,
      slug: `ia-whatsapp-int-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const id = (data as { id: string }).id;
  clinicas.push(id);
  return id;
}

async function rpcOk<T>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
}

async function ingerir(
  telefone: string,
  corpo = "Mensagem sintética",
  numero = numeroT,
  clinica = clinicaT,
): Promise<Ingestao> {
  return rpcOk<Ingestao>("ingest_inbound_message", {
    p_clinic_id: clinica,
    p_phone_e164: telefone,
    p_name: "Contato sintético",
    p_wa_message_id: wa(),
    p_content_type: "texto",
    p_body: corpo,
    p_whatsapp_account_id: numero,
  });
}

async function enfileirar(
  conversa: string,
  mensagem: string,
): Promise<Enfileirado> {
  return rpcOk<Enfileirado>("enfileirar_resposta_da_ia", {
    p_clinic_id: clinicaT,
    p_conversation_id: conversa,
    p_message_id: mensagem,
    p_incluir_teste: true,
  });
}

async function claim(worker: string, incluirTeste = true): Promise<Job[]> {
  return rpcOk<Job[]>("claim_jobs_da_ia", {
    p_worker: worker,
    p_max: 4,
    p_clinic_ids: [clinicaT],
    p_incluir_teste: incluirTeste,
  });
}

async function job(id: string): Promise<Job> {
  const { data } = await admin
    .from("job_queue")
    .select(
      "id, status, attempts, devolucoes, run_at, created_at, payload, last_error",
    )
    .eq("id", id)
    .single()
    .throwOnError();
  return data as Job;
}

/** Deixa o job devido (o claim compara run_at com now()). */
async function vencer(id: string): Promise<void> {
  await admin
    .from("job_queue")
    .update({ run_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", id)
    .throwOnError();
}

async function conversa(id: string) {
  const { data } = await admin
    .from("conversation")
    .select("status, awaiting_reply, assignee_user_id, contact_id")
    .eq("id", id)
    .single()
    .throwOnError();
  return data as {
    status: string;
    awaiting_reply: boolean;
    assignee_user_id: string | null;
    contact_id: string;
  };
}

async function eventos(conversationId: string): Promise<string[]> {
  const { data } = await admin
    .from("message")
    .select("body")
    .eq("conversation_id", conversationId)
    .eq("content_type", "evento")
    .order("created_at")
    .throwOnError();
  return (data as { body: string }[]).map((linha) => linha.body);
}

// Sempre com a confirmacao do aviso da OpenAI: telefone novo so entra com
// ela (migration 20261019120000); ao desligar ou religar ela nao muda nada.
async function liberarTelefone(telefone: string, ativo = true): Promise<void> {
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinicaT,
    p_telefone_e164: telefone,
    p_rotulo: "Equipe sintética",
    p_ativo: ativo,
    p_confirmou_aviso_da_openai: true,
  });
}

/** Um job da IA em execucao, montado direto (como o claim deixaria). */
async function jobEmExecucao(
  conversationId: string,
  worker: string,
): Promise<string> {
  const { data } = await admin
    .from("job_queue")
    .insert({
      clinic_id: clinicaT,
      kind: "responder_com_ia",
      whatsapp_account_id: numeroT,
      payload: { conversation_id: conversationId },
      status: "executando",
      locked_by: worker,
      locked_at: new Date().toISOString(),
      attempts: 1,
      max_attempts: 3,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function sha256(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// O texto de 'parada' desde a migration 20261019120000 (revisao de producao
// de 19/10/2026), como os outros pedidos desta suite que dependem dela.
const PARADA =
  "O assistente não atendeu esta mensagem: ele está parado para este telefone ou este número.";
const FRASE =
  "Recebi sua mensagem. Vou passar sua conversa para alguém da nossa equipe, que vai te responder por aqui assim que possível.";

beforeAll(async () => {
  clinicaT = await novaClinica("T");
  clinicaU = await novaClinica("U");
  numeroT = (
    await criarNumeroDeTeste(admin, clinicaT, {
      nome: "Recepção",
      display_phone: DISPLAY_T,
    })
  ).id;
  numeroT2 = (await criarNumeroDeTeste(admin, clinicaT, { nome: "Segundo" }))
    .id;
  await criarNumeroDeTeste(admin, clinicaU, {
    nome: "Recepção",
    display_phone: DISPLAY_U,
  });

  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinicaT,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de integracao do E3",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinicaT,
    p_whatsapp_account_id: numeroT,
    p_ativo: true,
  });
  for (const telefone of [
    EQ1,
    EQ3,
    EQ5,
    EQ6,
    EQ7,
    EQ_PACIENTE,
    EQ_DA,
    EQ_PERDA,
    EQ_ECO,
    EQ_DESLIGA,
    EQ_SERVIDOR,
  ]) {
    await liberarTelefone(telefone);
  }
  await admin
    .from("ai_agent_config")
    .insert({ clinic_id: clinicaT, version: 1, status: "publicada" })
    .throwOnError();

  // Recepcionista sintetica (so para o Devolver e o Assumir pela sessao).
  const { data: criada, error } = await admin.auth.admin.createUser({
    email: `ia-whatsapp-int-${sufixo}@teste.dev`,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: "Recepcionista Sintética" },
  });
  if (error || !criada.user) {
    throw new Error(`criar recepcionista: ${error?.message ?? "sem usuário"}`);
  }
  recepcionista = criada.user.id;
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicaT,
      user_id: recepcionista,
      role: "recepcao",
      status: "ativo",
    })
    .throwOnError();
  sessao = anonClient();
  const { error: erroLogin } = await sessao.auth.signInWithPassword({
    email: `ia-whatsapp-int-${sufixo}@teste.dev`,
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login: ${erroLogin.message}`);
  }
});

afterAll(async () => {
  if (clinicas.length > 0) {
    await admin.from("clinic").delete().in("id", clinicas);
  }
  if (recepcionista) {
    await admin.auth.admin.deleteUser(recepcionista);
  }
});

describe("ingestao", () => {
  it("telefone liberado, conversa nova: nasce na IA, com a janela", async () => {
    const r = await ingerir(EQ1, "Quanto custa a consulta?");
    expect(r).toMatchObject({ inserted: true, ia_atendendo: true });
    expect(await conversa(r.conversation_id!)).toMatchObject({
      status: "ia_atendendo",
      awaiting_reply: true,
    });
    const { data: janela } = await admin
      .from("ia_janela_da_conversa")
      .select("contact_id, phone_key, aberta_por")
      .eq("conversation_id", r.conversation_id!)
      .single()
      .throwOnError();
    expect(janela).toEqual({
      contact_id: r.contact_id,
      phone_key: EQ1,
      aberta_por: "ingestao",
    });
    const segunda = await ingerir(EQ1, "E o convênio?");
    expect(segunda).toMatchObject({
      ia_atendendo: true,
      conversation_id: r.conversation_id,
    });
  });

  it("telefone fora da lista: fica com a equipe, sem janela e sem evento", async () => {
    const r = await ingerir(OUTRA);
    expect(r.ia_atendendo).toBe(false);
    expect((await conversa(r.conversation_id!)).status).toBe(
      "aguardando_humano",
    );
    expect(await eventos(r.conversation_id!)).toEqual([]);
    const { data } = await admin
      .from("ia_janela_da_conversa")
      .select("conversation_id")
      .eq("conversation_id", r.conversation_id!)
      .throwOnError();
    expect(data).toEqual([]);
  });

  it("telefone liberado num numero nao liberado: fica com a equipe, com o evento 'parada'", async () => {
    const r = await ingerir(EQ1, "Mensagem pelo segundo número", numeroT2);
    expect(r).toMatchObject({ inserted: true, ia_atendendo: false });
    expect((await conversa(r.conversation_id!)).status).toBe(
      "aguardando_humano",
    );
    expect(await eventos(r.conversation_id!)).toEqual([PARADA]);
  });

  it("conversa que ja existia nunca entra pela mensagem (aguardando ou em atendimento)", async () => {
    const aguardando = await ingerir(EQ2);
    expect(aguardando.ia_atendendo).toBe(false);
    await liberarTelefone(EQ2);
    const depois = await ingerir(EQ2);
    expect(depois).toMatchObject({
      ia_atendendo: false,
      conversation_id: aguardando.conversation_id,
    });
    expect((await conversa(aguardando.conversation_id!)).status).toBe(
      "aguardando_humano",
    );
    await admin
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: recepcionista })
      .eq("id", aguardando.conversation_id!)
      .throwOnError();
    const emAtendimento = await ingerir(EQ2);
    expect(emAtendimento.ia_atendendo).toBe(false);
    expect((await conversa(aguardando.conversation_id!)).status).toBe(
      "em_atendimento",
    );
  });

  it("teto estourado: a conversa ja na IA continua; a nova nasce com a equipe e com o evento 'parada'", async () => {
    await admin
      .from("ia_uso")
      .insert({
        clinic_id: clinicaT,
        origem: "whatsapp",
        papel: "agente",
        modelo: "gpt-6-luna",
        custo_microdolar: 500 * 10_000,
      })
      .throwOnError();
    try {
      const jaNaIa = await ingerir(EQ1, "Mais uma pergunta");
      expect(jaNaIa.ia_atendendo).toBe(true);
      const nova = await ingerir(EQ3, "Oi");
      expect(nova.ia_atendendo).toBe(false);
      expect((await conversa(nova.conversation_id!)).status).toBe(
        "aguardando_humano",
      );
      expect(await eventos(nova.conversation_id!)).toEqual([PARADA]);
    } finally {
      await admin
        .from("ia_uso")
        .delete()
        .eq("clinic_id", clinicaT)
        .throwOnError();
    }
  });

  it("numero proprio: ignorada como hoje", async () => {
    const r = await ingerir(NUMERO_T_E164, "eco");
    expect(r).toMatchObject({
      inserted: false,
      ignorada: "numero_proprio",
      ia_atendendo: false,
    });
  });

  it("numero de WhatsApp da plataforma: nem forcado na lista entra na IA", async () => {
    // A RPC recusa (23514); o teste grava a linha direto, como o dono faria
    // por engano no SQL editor, para provar a defesa em profundidade.
    const { error } = await admin.rpc("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaT,
      p_telefone_e164: NUMERO_U_E164,
      p_rotulo: "Numero da U",
      p_ativo: true,
    });
    expect(error?.code).toBe("23514");
    expect(error?.message).toBe("telefone_invalido_para_equipe");
    await admin
      .from("ia_contato_liberado")
      .insert({ clinic_id: clinicaT, phone_key: NUMERO_U_E164, ativo: true })
      .throwOnError();
    try {
      const r = await ingerir(NUMERO_U_E164, "Sou outra clínica");
      expect(r.ia_atendendo).toBe(false);
      expect(await eventos(r.conversation_id!)).toEqual([PARADA]);
    } finally {
      await admin
        .from("ia_contato_liberado")
        .update({ ativo: false })
        .eq("clinic_id", clinicaT)
        .eq("phone_key", NUMERO_U_E164)
        .throwOnError();
    }
  });
});

describe("fila", () => {
  let conversaDaFila = "";

  it("rajada: um job so; o run_at anda a cada mensagem e para em created_at + 15 s; payload so com ids", async () => {
    const r1 = await ingerir(EQ5, "m1");
    conversaDaFila = r1.conversation_id!;
    expect(r1.ia_atendendo).toBe(true);
    const e1 = await enfileirar(conversaDaFila, r1.message_id!);
    expect(e1.codigo).toBe("enfileirado");
    const runAt1 = new Date((await job(e1.job_id!)).run_at).getTime();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const r2 = await ingerir(EQ5, "m2");
    const e2 = await enfileirar(conversaDaFila, r2.message_id!);
    expect(e2).toEqual({ codigo: "juntou", job_id: e1.job_id });
    const runAt2 = new Date((await job(e1.job_id!)).run_at).getTime();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const r3 = await ingerir(EQ5, "m3");
    const e3 = await enfileirar(conversaDaFila, r3.message_id!);
    expect(e3).toEqual({ codigo: "juntou", job_id: e1.job_id });
    const linha = await job(e1.job_id!);
    const runAt3 = new Date(linha.run_at).getTime();
    // espera deslizante: cada mensagem empurra o run_at (now() + 4 s)
    expect(runAt2).toBeGreaterThan(runAt1);
    expect(runAt3).toBeGreaterThan(runAt2);
    expect(Object.keys(linha.payload).sort()).toEqual([
      "conversation_id",
      "ultima_mensagem_id",
    ]);
    expect(linha.payload.ultima_mensagem_id).toBe(r3.message_id);
    // teto: com o job criado 18 s antes do run_at da terceira (14 s antes do
    // now() do banco, sem depender do relogio desta maquina), a mensagem
    // seguinte nao passa de created_at + 15 s. A janela da conversa (desde =
    // now() da 1a ingestao) recua junto, 1 s antes do job: job criado antes
    // do desde e job antigo (D-A), e a higiene do claim do teste seguinte o
    // cancelaria com job_antigo.
    await admin
      .from("job_queue")
      .update({ created_at: new Date(runAt3 - 18_000).toISOString() })
      .eq("id", e1.job_id!)
      .throwOnError();
    await admin
      .from("ia_janela_da_conversa")
      .update({ desde: new Date(runAt3 - 19_000).toISOString() })
      .eq("conversation_id", conversaDaFila)
      .throwOnError();
    const r4 = await ingerir(EQ5, "m4");
    expect(await enfileirar(conversaDaFila, r4.message_id!)).toEqual({
      codigo: "juntou",
      job_id: e1.job_id,
    });
    const noTeto = await job(e1.job_id!);
    expect(new Date(noTeto.run_at).getTime()).toBe(
      new Date(noTeto.created_at).getTime() + 15_000,
    );
    const { data: pendentes } = await admin
      .from("job_queue")
      .select("id")
      .eq("kind", "responder_com_ia")
      .eq("status", "pendente")
      .eq("payload->>conversation_id", conversaDaFila)
      .throwOnError();
    expect(pendentes).toHaveLength(1);
  });

  it("claim: sem a flag de teste, nada; com a flag, o job", async () => {
    const { data: pendente } = await admin
      .from("job_queue")
      .select("id")
      .eq("payload->>conversation_id", conversaDaFila)
      .eq("status", "pendente")
      .single()
      .throwOnError();
    const id = (pendente as { id: string }).id;
    await vencer(id);
    expect(await claim(`int-${sufixo}-a`, false)).toEqual([]);
    const pegos = await claim(`int-${sufixo}-a`);
    expect(pegos.map((j) => j.id)).toEqual([id]);
  });

  it("mensagem nova durante o turno, retry e retomada: sem 23505, e a resposta velha sai antes da nova", async () => {
    const { data: rodando } = await admin
      .from("job_queue")
      .select("id")
      .eq("payload->>conversation_id", conversaDaFila)
      .eq("status", "executando")
      .single()
      .throwOnError();
    const velho = (rodando as { id: string }).id;
    const r4 = await ingerir(EQ5, "m4, durante o turno");
    const novo = await enfileirar(conversaDaFila, r4.message_id!);
    expect(novo.codigo).toBe("enfileirado");
    expect(novo.job_id).not.toBe(velho);
    // retry do velho: volta a pendente com attempts >= 1 (fora do indice)
    await rpcOk("falhar_job", {
      p_id: velho,
      p_erro: "conexao",
      p_definitivo: false,
      p_worker: `int-${sufixo}-a`,
    });
    expect(await job(velho)).toMatchObject({ status: "pendente", attempts: 1 });
    const r5 = await ingerir(EQ5, "m5");
    expect(await enfileirar(conversaDaFila, r5.message_id!)).toEqual({
      codigo: "juntou",
      job_id: novo.job_id,
    });
    // o novo devido e o velho em backoff: o novo nao passa a frente
    await vencer(novo.job_id!);
    expect(await claim(`int-${sufixo}-b`)).toEqual([]);
    await vencer(velho);
    expect((await claim(`int-${sufixo}-b`)).map((j) => j.id)).toEqual([velho]);
    expect(await claim(`int-${sufixo}-c`)).toEqual([]);
    // retomada (sem tempo para enviar): devolucoes + 1, sem 23505
    expect(
      await rpcOk("reagendar_job", {
        p_id: velho,
        p_worker: `int-${sufixo}-b`,
        p_run_at: new Date(Date.now() - 1_000).toISOString(),
        p_motivo: "retomar_envio",
      }),
    ).toBe(true);
    expect(await job(velho)).toMatchObject({
      status: "pendente",
      devolucoes: 1,
    });
    const r6 = await ingerir(EQ5, "m6");
    expect(await enfileirar(conversaDaFila, r6.message_id!)).toEqual({
      codigo: "juntou",
      job_id: novo.job_id,
    });
    await vencer(novo.job_id!);
    expect((await claim(`int-${sufixo}-d`)).map((j) => j.id)).toEqual([velho]);
    await rpcOk("concluir_job", { p_id: velho, p_worker: `int-${sufixo}-d` });
    expect((await claim(`int-${sufixo}-e`)).map((j) => j.id)).toEqual([
      novo.job_id,
    ]);
    await rpcOk("concluir_job", {
      p_id: novo.job_id,
      p_worker: `int-${sufixo}-e`,
    });
  });

  it("dois claims ao mesmo tempo: nenhum espera o outro e so um leva o job", async () => {
    const r = await ingerir(EQ5, "m7");
    const e = await enfileirar(conversaDaFila, r.message_id!);
    await vencer(e.job_id!);
    const inicio = Date.now();
    const [a, b] = await Promise.all([
      claim(`int-${sufixo}-x`),
      claim(`int-${sufixo}-y`),
    ]);
    expect(Date.now() - inicio).toBeLessThan(10_000);
    expect([...a, ...b].map((j) => j.id)).toEqual([e.job_id]);
    const dono = a.length === 1 ? `int-${sufixo}-x` : `int-${sufixo}-y`;
    await rpcOk("concluir_job", { p_id: e.job_id, p_worker: dono });
  });

  it("o claim legado nao enterra o kind; o claim da IA enterra (lease de 90 s)", async () => {
    const id = await jobEmExecucao(conversaDaFila, `int-${sufixo}-morto`);
    await admin
      .from("job_queue")
      .update({
        locked_at: new Date(Date.now() - 10 * 60_000).toISOString(),
        attempts: 3,
      })
      .eq("id", id)
      .throwOnError();
    // p_limit 0: so o enterro roda (o legado nunca reivindica nada aqui)
    await rpcOk("claim_jobs", { p_worker: `int-${sufixo}-legado`, p_limit: 0 });
    expect((await job(id)).status).toBe("executando");
    await claim(`int-${sufixo}-f`);
    expect(await job(id)).toMatchObject({
      status: "falhou",
      last_error: "lease_expirado",
    });
  });

  it("higiene: pendente de conversa que saiu da IA e cancelado pelo claim", async () => {
    const r = await ingerir(EQ5, "m8");
    const e = await enfileirar(conversaDaFila, r.message_id!);
    await admin
      .from("conversation")
      .update({ status: "aguardando_humano" })
      .eq("id", conversaDaFila)
      .throwOnError();
    await claim(`int-${sufixo}-g`);
    expect(await job(e.job_id!)).toMatchObject({
      status: "cancelado",
      last_error: "conversa_fora_da_ia",
    });
    // e o enfileirar recusa a conversa fora da IA
    expect(await enfileirar(conversaDaFila, r.message_id!)).toEqual({
      codigo: "conversa_fora_da_ia",
      job_id: null,
    });
  });

  it("desligar o telefone cancela o pendente e grava o evento na conversa devolvida", async () => {
    const r = await ingerir(EQ6, "oi");
    expect(r.ia_atendendo).toBe(true);
    const e = await enfileirar(r.conversation_id!, r.message_id!);
    await liberarTelefone(EQ6, false);
    expect((await conversa(r.conversation_id!)).status).toBe(
      "aguardando_humano",
    );
    expect(await eventos(r.conversation_id!)).toEqual([
      "O assistente foi desligado. A conversa voltou para a equipe.",
    ]);
    expect(await job(e.job_id!)).toMatchObject({
      status: "cancelado",
      last_error: "ia_desligada",
    });
    await liberarTelefone(EQ6, true);
  });
});

describe("janela", () => {
  it("Devolver numa conversa antiga: a janela comeca depois das mensagens antigas", async () => {
    const antiga = await ingerir(EQ4, "Mensagem antiga, antes da IA");
    expect(antiga.ia_atendendo).toBe(false);
    await liberarTelefone(EQ4);
    await admin
      .from("conversation")
      .update({
        status: "em_atendimento",
        assignee_user_id: recepcionista,
        awaiting_reply: false,
      })
      .eq("id", antiga.conversation_id!)
      .throwOnError();
    const { data, error } = await sessao.rpc("devolver_para_ia", {
      p_conversation_id: antiga.conversation_id,
    });
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    const { data: janela } = await admin
      .from("ia_janela_da_conversa")
      .select("desde, aberta_por")
      .eq("conversation_id", antiga.conversation_id!)
      .single()
      .throwOnError();
    const { data: mensagem } = await admin
      .from("message")
      .select("created_at")
      .eq("id", antiga.message_id!)
      .single()
      .throwOnError();
    expect((janela as { aberta_por: string }).aberta_por).toBe("devolver");
    expect(
      new Date((janela as { desde: string }).desde).getTime(),
    ).toBeGreaterThan(
      new Date((mensagem as { created_at: string }).created_at).getTime(),
    );
    expect(await eventos(antiga.conversation_id!)).toEqual([
      "Recepcionista Sintética devolveu a conversa para a IA",
    ]);
  });

  it("contato com sinal de paciente (telefone trocado pelo da equipe) nao volta para a IA", async () => {
    const { data: paciente } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicaT,
        phone_e164: `+5584980${digitos}`,
        name: "Paciente sintético",
        kind: "paciente",
      })
      .select("id")
      .single()
      .throwOnError();
    const contatoId = (paciente as { id: string }).id;
    const { data: criada } = await admin
      .from("conversation")
      .insert({
        clinic_id: clinicaT,
        contact_id: contatoId,
        whatsapp_account_id: numeroT,
        status: "em_atendimento",
        assignee_user_id: recepcionista,
        awaiting_reply: false,
      })
      .select("id")
      .single()
      .throwOnError();
    // o telefone do paciente vira o da equipe (EQ7, liberado no numero liberado)
    await admin
      .from("contact")
      .update({ phone_e164: EQ7 })
      .eq("id", contatoId)
      .throwOnError();
    const { error } = await sessao.rpc("devolver_para_ia", {
      p_conversation_id: (criada as { id: string }).id,
    });
    expect(error?.code).toBe("42501");
    expect(error?.message).toBe("contato_de_paciente");
    expect((await conversa((criada as { id: string }).id)).status).toBe(
      "em_atendimento",
    );
    const sinal = await rpcOk<boolean>("contato_tem_sinal_de_paciente", {
      p_clinic_id: clinicaT,
      p_phone_key: EQ7,
    });
    expect(sinal).toBe(true);
  });

  it("job criado antes de Assumir e Devolver nao envia (janela_invalida)", async () => {
    const r = await ingerir(EQ3, "Oi de novo");
    // EQ3 tem a conversa que nasceu no teto (aguardando): resolve e comeca outra
    await admin
      .from("conversation")
      .update({ status: "resolvida" })
      .eq("id", r.conversation_id!)
      .throwOnError();
    const nova = await ingerir(EQ3, "Nova conversa");
    expect(nova.ia_atendendo).toBe(true);
    const worker = `int-${sufixo}-janela`;
    const antigo = await jobEmExecucao(nova.conversation_id!, worker);
    expect(
      await rpcOk<string>("ia_pode_enviar_agora", {
        p_job_id: antigo,
        p_worker: worker,
        p_conversation_id: nova.conversation_id,
        p_whatsapp_account_id: numeroT,
        p_telefone: EQ3,
        p_tipo: "resposta",
      }),
    ).toBe("ok");
    // Assumir pela sessao e Devolver
    const { error: assumir } = await sessao
      .from("conversation")
      .update({
        status: "em_atendimento",
        assignee_user_id: recepcionista,
        awaiting_reply: false,
      })
      .eq("id", nova.conversation_id!);
    expect(assumir).toBeNull();
    expect(
      await rpcOk<string>("ia_pode_enviar_agora", {
        p_job_id: antigo,
        p_worker: worker,
        p_conversation_id: nova.conversation_id,
        p_whatsapp_account_id: numeroT,
        p_telefone: EQ3,
        p_tipo: "resposta",
      }),
    ).toBe("fora_da_ia");
    const { error: devolver } = await sessao.rpc("devolver_para_ia", {
      p_conversation_id: nova.conversation_id,
    });
    expect(devolver).toBeNull();
    expect(
      await rpcOk<string>("ia_pode_enviar_agora", {
        p_job_id: antigo,
        p_worker: worker,
        p_conversation_id: nova.conversation_id,
        p_whatsapp_account_id: numeroT,
        p_telefone: EQ3,
        p_tipo: "resposta",
      }),
    ).toBe("janela_invalida");
  });
});

describe("gatilho de message", () => {
  let conversaNaIa = "";

  beforeAll(async () => {
    const { data } = await admin
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicaT)
      .eq("status", "ia_atendendo")
      .eq(
        "contact_id",
        (await ingerir(EQ1, "pergunta para o gatilho")).contact_id!,
      )
      .single()
      .throwOnError();
    conversaNaIa = (data as { id: string }).id;
  });

  it("'ia' sem decisao aprovada do mesmo job e hash: CZIA1; aprovada passa; recibo, apagar e poda passam", async () => {
    const texto = "A consulta custa R$ 200.";
    const jobId = await jobEmExecucao(conversaNaIa, `int-${sufixo}-gatilho`);
    const linha = {
      clinic_id: clinicaT,
      conversation_id: conversaNaIa,
      direction: "saida",
      author: "ia",
      content_type: "texto",
      body: texto,
      job_id: jobId,
    };
    const { error: semDecisao } = await admin.from("message").insert(linha);
    expect(semDecisao?.code).toBe("CZIA1");
    await admin
      .from("ai_decision_log")
      .insert({
        clinic_id: clinicaT,
        conversation_id: conversaNaIa,
        job_id: jobId,
        aprovado: true,
        texto_sha256: await sha256("outro texto"),
        desfecho: "respondeu",
      })
      .throwOnError();
    const { error: outroHash } = await admin.from("message").insert(linha);
    expect(outroHash?.code).toBe("CZIA1");
    await admin
      .from("ai_decision_log")
      .insert({
        clinic_id: clinicaT,
        conversation_id: conversaNaIa,
        job_id: jobId,
        aprovado: true,
        texto_sha256: await sha256(texto),
        desfecho: "respondeu",
      })
      .throwOnError();
    const { data: gravada, error } = await admin
      .from("message")
      .insert({ ...linha, delivery_status: "enviando" })
      .select("id")
      .single();
    expect(error).toBeNull();
    const id = (gravada as { id: string }).id;
    await admin
      .from("message")
      .update({ delivery_status: "enviada", wa_message_id: wa() })
      .eq("id", id)
      .throwOnError();
    await admin
      .from("job_queue")
      .update({ status: "concluido", locked_by: null, locked_at: null })
      .eq("id", jobId)
      .throwOnError();
    await admin
      .from("message")
      .update({ body: null, deleted_at: new Date().toISOString() })
      .eq("id", id)
      .throwOnError();
    await admin
      .from("message")
      .update({ job_id: null })
      .eq("id", id)
      .throwOnError();
  });

  it("'ia' com job de outra conversa ou conversa fora da IA: CZIA2", async () => {
    const fora = await ingerir(OUTRA, "fora da IA");
    const jobId = await jobEmExecucao(
      fora.conversation_id!,
      `int-${sufixo}-fora`,
    );
    await admin
      .from("ai_decision_log")
      .insert({
        clinic_id: clinicaT,
        conversation_id: fora.conversation_id,
        job_id: jobId,
        aprovado: true,
        texto_sha256: await sha256("Texto"),
        desfecho: "respondeu",
      })
      .throwOnError();
    const { error } = await admin.from("message").insert({
      clinic_id: clinicaT,
      conversation_id: fora.conversation_id,
      direction: "saida",
      author: "ia",
      content_type: "texto",
      body: "Texto",
      job_id: jobId,
    });
    expect(error?.code).toBe("CZIA2");
  });

  it("frase: so o corpo fixo, como sistema (CZIA3); a exata passa", async () => {
    const jobId = await jobEmExecucao(conversaNaIa, `int-${sufixo}-frase`);
    const base = {
      clinic_id: clinicaT,
      conversation_id: conversaNaIa,
      direction: "saida",
      content_type: "texto",
      job_id: jobId,
    };
    const { error: outra } = await admin
      .from("message")
      .insert({ ...base, author: "sistema", body: "Outra frase qualquer." });
    expect(outra?.code).toBe("CZIA3");
    const { error: comoUsuario } = await admin
      .from("message")
      .insert({ ...base, author: "usuario", body: FRASE });
    expect(comoUsuario?.code).toBe("CZIA3");
    const { error } = await admin
      .from("message")
      .insert({ ...base, author: "sistema", body: FRASE });
    expect(error).toBeNull();
    await admin
      .from("job_queue")
      .update({ status: "concluido", locked_by: null, locked_at: null })
      .eq("id", jobId)
      .throwOnError();
  });

  it("clinica de teste sem job_id grava 'ia' (fixture antiga)", async () => {
    const { error } = await admin.from("message").insert({
      clinic_id: clinicaT,
      conversation_id: conversaNaIa,
      direction: "saida",
      author: "ia",
      content_type: "texto",
      body: "Fixture sintética",
    });
    expect(error).toBeNull();
  });
});

describe("celular", () => {
  it("resposta automatica do app nao tira; eco do envio da IA nao tira; pessoa tira e mantem Aguardando voce", async () => {
    // conversa nova de EQ6 na IA (a anterior foi devolvida no desligar)
    const contato = (await ingerir(EQ6, "ping")).contact_id!;
    await admin
      .from("conversation")
      .update({ status: "resolvida" })
      .eq("contact_id", contato)
      .throwOnError();
    const r = await ingerir(EQ6, "Pergunta");
    expect(r.ia_atendendo).toBe(true);
    const conv = r.conversation_id!;

    // automatica: logo depois da mensagem do paciente
    const automatica = await rpcOk<{ automatica: boolean }>(
      "registrar_mensagem_do_celular",
      {
        p_clinic_id: clinicaT,
        p_whatsapp_account_id: numeroT,
        p_phone_e164: EQ6,
        p_wa_message_id: wa(),
        p_body: "Olá! Respondemos em breve.",
      },
    );
    expect(automatica.automatica).toBe(true);
    expect((await conversa(conv)).status).toBe("ia_atendendo");

    // eco: a linha 'ia' do job ainda sem wa_message_id
    const texto = "Resposta sintética da IA.";
    const jobId = await jobEmExecucao(conv, `int-${sufixo}-eco`);
    await admin
      .from("ai_decision_log")
      .insert({
        clinic_id: clinicaT,
        conversation_id: conv,
        job_id: jobId,
        aprovado: true,
        texto_sha256: await sha256(texto),
        desfecho: "respondeu",
      })
      .throwOnError();
    await admin
      .from("message")
      .insert({
        clinic_id: clinicaT,
        conversation_id: conv,
        direction: "saida",
        author: "ia",
        content_type: "texto",
        body: texto,
        job_id: jobId,
        delivery_status: "enviando",
      })
      .throwOnError();
    await admin
      .from("conversation")
      .update({ last_inbound_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", conv)
      .throwOnError();
    const eco = await rpcOk<{ automatica: boolean }>(
      "registrar_mensagem_do_celular",
      {
        p_clinic_id: clinicaT,
        p_whatsapp_account_id: numeroT,
        p_phone_e164: EQ6,
        p_wa_message_id: wa(),
        p_body: texto,
      },
    );
    expect(eco.automatica).toBe(false);
    expect((await conversa(conv)).status).toBe("ia_atendendo");

    // o envio da IA terminou (a linha ganhou o wa_message_id); a fala abaixo
    // nao tem o hash da decisao: e de uma pessoa
    await admin
      .from("message")
      .update({ delivery_status: "enviada", wa_message_id: wa() })
      .eq("job_id", jobId)
      .throwOnError();

    // pessoa: o paciente escreveu DEPOIS do envio pelo celular
    const pergunta = await ingerir(EQ6, "Mais uma pergunta");
    await admin
      .from("message")
      .update({ enviada_no_aparelho_em: new Date().toISOString() })
      .eq("id", pergunta.message_id!)
      .throwOnError();
    const pessoa = await rpcOk<{ automatica: boolean }>(
      "registrar_mensagem_do_celular",
      {
        p_clinic_id: clinicaT,
        p_whatsapp_account_id: numeroT,
        p_phone_e164: EQ6,
        p_wa_message_id: wa(),
        p_body: "Oi, aqui é a recepção.",
        p_enviada_em: new Date(Date.now() - 60_000).toISOString(),
      },
    );
    expect(pessoa.automatica).toBe(false);
    expect(await conversa(conv)).toMatchObject({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
    expect((await eventos(conv)).slice(-1)).toEqual([
      "Alguém respondeu pelo celular. A IA parou de responder nesta conversa.",
    ]);
  });
});

describe("varredura e frase que nao sai", () => {
  it("sem resposta ha mais de 3 minutos: a manutencao devolve, com o evento e sem mensagem ao contato", async () => {
    const { data: abertas } = await admin
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicaT)
      .eq("contact_id", (await ingerir(EQ7, "ping")).contact_id!)
      .neq("status", "resolvida")
      .throwOnError();
    for (const linha of abertas as { id: string }[]) {
      await admin
        .from("conversation")
        .update({ status: "resolvida" })
        .eq("id", linha.id)
        .throwOnError();
    }
    // EQ7 e telefone de paciente (teste anterior): o servidor forca
    await rpcOk("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaT,
      p_telefone_e164: EQ7,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_forcar_contato_existente: true,
      p_confirmou_aviso_da_openai: true,
      // onda 2 (P3, migration 20261022110000): o forcar exige a
      // confirmacao do teste com paciente, ate para o servidor
      p_confirmou_teste_com_paciente: true,
    });
    const r = await ingerir(EQ7, "Alguém aí?");
    expect(r.ia_atendendo).toBe(true);
    await admin
      .from("conversation")
      .update({
        last_inbound_at: new Date(Date.now() - 4 * 60_000).toISOString(),
      })
      .eq("id", r.conversation_id!)
      .throwOnError();
    const { count: antes } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", r.conversation_id!)
      .neq("content_type", "evento");
    const resumo = await rpcOk<{ resposta_da_ia: { sem_resposta: number } }>(
      "motor_manutencao",
    );
    expect(resumo.resposta_da_ia.sem_resposta).toBeGreaterThanOrEqual(1);
    expect(await conversa(r.conversation_id!)).toMatchObject({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
    expect((await eventos(r.conversation_id!)).slice(-1)).toEqual([
      "A IA não respondeu a tempo. A conversa voltou para a equipe.",
    ]);
    const { count: depois } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", r.conversation_id!)
      .neq("content_type", "evento");
    expect(depois).toBe(antes);
  });

  // Achado X3 da revisao: este caso prova SO as duas RPCs que o executor
  // chama quando a frase nao sai (passagem e evento do aviso) contra o banco
  // real: elas nao tocam no job (continua 'executando', devolucoes 0) e o
  // fio fica com os dois eventos. Que o executor de verdade, com o send.ts
  // devolvendo slot_adiado para a frase, conclui sem reagendar_job e sem
  // gravar a frase, esta provado em
  // tests/unit/ia-whatsapp/ponta-a-ponta.test.ts ("frase que não sai (slot
  // adiado, X3)").
  it("passagem e aviso da frase que nao sai: as RPCs gravam os dois eventos e nao mexem no job", async () => {
    await admin
      .from("conversation")
      .update({ status: "resolvida" })
      .eq("clinic_id", clinicaT)
      .eq("contact_id", (await ingerir(EQ1, "ping")).contact_id!)
      .throwOnError();
    const r = await ingerir(EQ1, "Estou com dor");
    expect(r.ia_atendendo).toBe(true);
    const worker = `int-${sufixo}-aviso`;
    const jobId = await jobEmExecucao(r.conversation_id!, worker);
    expect(
      await rpcOk("passar_conversa_da_ia_para_equipe", {
        p_job_id: jobId,
        p_worker: worker,
        p_motivo: "sintoma",
      }),
    ).toEqual({ passou: true, codigo: "passou" });
    expect(
      await rpcOk("gravar_evento_da_ia", {
        p_job_id: jobId,
        p_worker: worker,
        p_motivo: "aviso_nao_enviado",
      }),
    ).toBe(true);
    expect((await eventos(r.conversation_id!)).slice(-2)).toEqual([
      "A IA passou a conversa para a equipe: o paciente descreveu um sintoma.",
      "O aviso automático ao contato não foi enviado.",
    ]);
    expect(await job(jobId)).toMatchObject({
      status: "executando",
      devolucoes: 0,
    });
    expect(await conversa(r.conversation_id!)).toMatchObject({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
    await rpcOk("concluir_job", { p_id: jobId, p_worker: worker });
  });
});

// ---------------------------------------------------------------------------
// Correcoes da revisao adversarial (13/10/2026)
// ---------------------------------------------------------------------------

async function decisaoAprovada(
  conversationId: string,
  jobId: string,
  texto: string,
): Promise<void> {
  await admin
    .from("ai_decision_log")
    .insert({
      clinic_id: clinicaT,
      conversation_id: conversationId,
      job_id: jobId,
      aprovado: true,
      texto_sha256: await sha256(texto),
      desfecho: "respondeu",
    })
    .throwOnError();
}

/** Assumir pela sessao da recepcionista (sem pergunta pendente). */
async function assumir(conversationId: string): Promise<void> {
  const { error } = await sessao
    .from("conversation")
    .update({
      status: "em_atendimento",
      assignee_user_id: recepcionista,
      awaiting_reply: false,
    })
    .eq("id", conversationId);
  expect(error).toBeNull();
}

describe("fora da lista nunca (X2 da revisao)", () => {
  let clinicaF = "";
  let numeroF = "";

  /**
   * A F fora da lista e SEM e_de_teste so durante o corpo (o papel da
   * salud-care, sem nunca usar a id dela); volta a ser de teste no finally.
   */
  async function foraDeTeste(corpo: () => Promise<void>): Promise<void> {
    await admin
      .from("clinic")
      .update({ e_de_teste: false })
      .eq("id", clinicaF)
      .throwOnError();
    try {
      await corpo();
    } finally {
      await admin
        .from("clinic")
        .update({ e_de_teste: true })
        .eq("id", clinicaF)
        .throwOnError();
    }
  }

  beforeAll(async () => {
    clinicaF = await novaClinica("F");
    numeroF = (await criarNumeroDeTeste(admin, clinicaF, { nome: "Recepção" }))
      .id;
    await rpcOk("definir_liberacao_da_ia", {
      p_clinic_id: clinicaF,
      p_liberada: true,
      p_modo: "contatos",
      p_motivo: "teste de integracao do E3 (fora da lista)",
    });
    await rpcOk("definir_numero_da_ia", {
      p_clinic_id: clinicaF,
      p_whatsapp_account_id: numeroF,
      p_ativo: true,
    });
    await rpcOk("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaF,
      p_telefone_e164: EQ_F,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_confirmou_aviso_da_openai: true,
    });
    await admin
      .from("ai_agent_config")
      .insert({ clinic_id: clinicaF, version: 1, status: "publicada" })
      .throwOnError();
  });

  it("clinica fora da lista e nao de teste: gatilho CZIA2, claim vazio e enfileirar fora_da_fase", async () => {
    // Ainda de teste: a conversa entra na IA e o job roda.
    const r = await ingerir(EQ_F, "Pergunta", numeroF, clinicaF);
    expect(r.ia_atendendo).toBe(true);
    const e = await rpcOk<Enfileirado>("enfileirar_resposta_da_ia", {
      p_clinic_id: clinicaF,
      p_conversation_id: r.conversation_id,
      p_message_id: r.message_id,
      p_incluir_teste: true,
    });
    expect(e.codigo).toBe("enfileirado");
    await vencer(e.job_id!);
    const pegos = await rpcOk<Job[]>("claim_jobs_da_ia", {
      p_worker: `int-${sufixo}-f`,
      p_max: 4,
      p_clinic_ids: [clinicaF],
      p_incluir_teste: true,
    });
    expect(pegos.map((j) => j.id)).toEqual([e.job_id]);
    const texto = "Resposta aprovada da clínica F.";
    await admin
      .from("ai_decision_log")
      .insert({
        clinic_id: clinicaF,
        conversation_id: r.conversation_id,
        job_id: e.job_id,
        aprovado: true,
        texto_sha256: await sha256(texto),
        desfecho: "respondeu",
      })
      .throwOnError();
    const r2 = await ingerir(EQ_F, "Outra pergunta", numeroF, clinicaF);

    await foraDeTeste(async () => {
      const { error } = await admin.from("message").insert({
        clinic_id: clinicaF,
        conversation_id: r.conversation_id,
        direction: "saida",
        author: "ia",
        content_type: "texto",
        body: texto,
        job_id: e.job_id,
      });
      expect(error?.code).toBe("CZIA2");
      expect(error?.message).toBe("ia_nao_liberada");
      // sem job tambem (o atalho de fixture e so para clinica de teste)
      const { error: semJob } = await admin.from("message").insert({
        clinic_id: clinicaF,
        conversation_id: r.conversation_id,
        direction: "saida",
        author: "ia",
        content_type: "texto",
        body: "Fixture.",
      });
      expect(semJob?.code).toBe("CZIA2");
      await vencer(e.job_id!);
      await admin
        .from("job_queue")
        .update({ locked_at: new Date(Date.now() - 120_000).toISOString() })
        .eq("id", e.job_id!)
        .throwOnError();
      expect(
        await rpcOk<Job[]>("claim_jobs_da_ia", {
          p_worker: `int-${sufixo}-f2`,
          p_max: 4,
          p_clinic_ids: [clinicaF],
          p_incluir_teste: true,
        }),
      ).toEqual([]);
      for (const comFlag of [true, false]) {
        expect(
          await rpcOk<Enfileirado>("enfileirar_resposta_da_ia", {
            p_clinic_id: clinicaF,
            p_conversation_id: r.conversation_id,
            p_message_id: r2.message_id,
            p_incluir_teste: comFlag,
          }),
        ).toEqual({ codigo: "fora_da_fase", job_id: null });
      }
    });
    const { data: daIa } = await admin
      .from("message")
      .select("id")
      .eq("conversation_id", r.conversation_id!)
      .eq("author", "ia")
      .throwOnError();
    expect(daIa).toEqual([]);
    await admin
      .from("job_queue")
      .update({ status: "concluido", locked_by: null, locked_at: null })
      .eq("id", e.job_id!)
      .throwOnError();
  });

  it("clinica de teste sem a flag de teste: enfileirar devolve fora_da_fase", async () => {
    const r = await ingerir(EQ_SERVIDOR, "Pergunta sem a flag");
    expect(r.ia_atendendo).toBe(true);
    expect(
      await rpcOk<Enfileirado>("enfileirar_resposta_da_ia", {
        p_clinic_id: clinicaT,
        p_conversation_id: r.conversation_id,
        p_message_id: r.message_id,
      }),
    ).toEqual({ codigo: "fora_da_fase", job_id: null });
  });

  it("gatilho com o telefone desligado no meio do turno: CZIA2", async () => {
    const r = await ingerir(EQ_DESLIGA, "Pergunta");
    expect(r.ia_atendendo).toBe(true);
    const worker = `int-${sufixo}-desliga`;
    const jobId = await jobEmExecucao(r.conversation_id!, worker);
    const texto = "Resposta aprovada.";
    await decisaoAprovada(r.conversation_id!, jobId, texto);
    // desligado direto na linha (sem ia_desligar): a conversa fica na IA
    await admin
      .from("ia_contato_liberado")
      .update({ ativo: false })
      .eq("clinic_id", clinicaT)
      .eq("phone_key", EQ_DESLIGA)
      .throwOnError();
    try {
      expect((await conversa(r.conversation_id!)).status).toBe("ia_atendendo");
      const { error } = await admin.from("message").insert({
        clinic_id: clinicaT,
        conversation_id: r.conversation_id,
        direction: "saida",
        author: "ia",
        content_type: "texto",
        body: texto,
        job_id: jobId,
      });
      expect(error?.code).toBe("CZIA2");
    } finally {
      await admin
        .from("ia_contato_liberado")
        .update({ ativo: true })
        .eq("clinic_id", clinicaT)
        .eq("phone_key", EQ_DESLIGA)
        .throwOnError();
      await admin
        .from("job_queue")
        .update({ status: "concluido", locked_by: null, locked_at: null })
        .eq("id", jobId)
        .throwOnError();
    }
  });
});

describe("D-B: sinal de paciente sem o forcar barra em todo lugar; o forcado entra", () => {
  it("contato que vira paciente depois de ligado: a mensagem seguinte tira da IA (evento 'parada')", async () => {
    const r = await ingerir(EQ_PACIENTE, "Quanto custa?");
    expect(r.ia_atendendo).toBe(true);
    await admin
      .from("contact")
      .update({ kind: "paciente" })
      .eq("id", r.contact_id!)
      .throwOnError();
    expect(
      await rpcOk<boolean>("ia_pode_falar_com", {
        p_clinic_id: clinicaT,
        p_whatsapp_account_id: numeroT,
        p_telefone: EQ_PACIENTE,
      }),
    ).toBe(false);
    const seguinte = await ingerir(EQ_PACIENTE, "E o convênio?");
    expect(seguinte).toMatchObject({
      ia_atendendo: false,
      conversation_id: r.conversation_id,
    });
    expect((await conversa(r.conversation_id!)).status).toBe(
      "aguardando_humano",
    );
    expect((await eventos(r.conversation_id!)).slice(-1)).toEqual([PARADA]);
    // a conversa nova do mesmo telefone tambem nasce com a equipe
    await admin
      .from("conversation")
      .update({ status: "resolvida" })
      .eq("id", r.conversation_id!)
      .throwOnError();
    const nova = await ingerir(EQ_PACIENTE, "Oi de novo");
    expect(nova.ia_atendendo).toBe(false);
  });

  it("telefone de paciente forcado pela equipe Conduzza: entra na IA e volta pelo Devolver", async () => {
    await admin
      .from("contact")
      .insert({
        clinic_id: clinicaT,
        phone_e164: EQ_FORCADO,
        name: "Equipe e paciente",
        kind: "paciente",
      })
      .throwOnError();
    const { error: semForcar } = await admin.rpc(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaT,
        p_telefone_e164: EQ_FORCADO,
        p_rotulo: "Equipe sintética",
        p_ativo: true,
      },
    );
    expect(semForcar?.message).toBe("contato_de_paciente");
    await rpcOk("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaT,
      p_telefone_e164: EQ_FORCADO,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_forcar_contato_existente: true,
      p_confirmou_aviso_da_openai: true,
      // onda 2 (P3, migration 20261022110000): o forcar exige a
      // confirmacao do teste com paciente, ate para o servidor
      p_confirmou_teste_com_paciente: true,
    });
    const r = await ingerir(EQ_FORCADO, "Oi");
    expect(r.ia_atendendo).toBe(true);
    await assumir(r.conversation_id!);
    const { data: disponivel } = await sessao.rpc("ia_devolver_disponivel", {
      p_conversation_id: r.conversation_id,
    });
    expect(disponivel).toEqual({ pode: true, motivo: null });
    const { data, error } = await sessao.rpc("devolver_para_ia", {
      p_conversation_id: r.conversation_id,
    });
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect((await conversa(r.conversation_id!)).status).toBe("ia_atendendo");
  });
});

describe("D-A: job de antes do Devolver nao mexe na sessao nova", () => {
  it("passagem job_antigo, evento e fechamento do worker sem efeito; o claim cancela o executando vencido", async () => {
    const r = await ingerir(EQ_DA, "Pergunta");
    expect(r.ia_atendendo).toBe(true);
    const conv = r.conversation_id!;
    const worker = `int-${sufixo}-velho`;
    const velho = await jobEmExecucao(conv, worker);
    // Assumir, responder e Devolver no meio do turno
    await assumir(conv);
    const { error: devolver } = await sessao.rpc("devolver_para_ia", {
      p_conversation_id: conv,
    });
    expect(devolver).toBeNull();
    const eventosAntes = await eventos(conv);
    expect(
      await rpcOk("passar_conversa_da_ia_para_equipe", {
        p_job_id: velho,
        p_worker: worker,
        p_motivo: "liberacao_perdida",
      }),
    ).toEqual({ passou: false, codigo: "job_antigo" });
    expect(
      await rpcOk("gravar_evento_da_ia", {
        p_job_id: velho,
        p_worker: worker,
        p_motivo: "aviso_nao_enviado",
      }),
    ).toBe(false);
    expect(
      await rpcOk("tirar_conversa_da_ia_pelo_servidor", {
        p_clinic_id: clinicaT,
        p_conversation_id: conv,
        p_motivo: "falha_tecnica",
        p_job_id: velho,
      }),
    ).toBe(false);
    expect(await conversa(conv)).toMatchObject({
      status: "ia_atendendo",
      awaiting_reply: false,
    });
    expect(await eventos(conv)).toEqual(eventosAntes);
    // a invocacao do velho caiu: lease vencido; o claim cancela (nunca devolve)
    await admin
      .from("job_queue")
      .update({ locked_at: new Date(Date.now() - 120_000).toISOString() })
      .eq("id", velho)
      .throwOnError();
    expect((await claim(`int-${sufixo}-novo`)).map((j) => j.id)).not.toContain(
      velho,
    );
    expect(await job(velho)).toMatchObject({
      status: "cancelado",
      last_error: "job_antigo",
    });
    // caminho positivo: um job da sessao atual que desistiu tira a conversa
    const atual = await jobEmExecucao(conv, `int-${sufixo}-atual`);
    expect(
      await rpcOk("tirar_conversa_da_ia_pelo_servidor", {
        p_clinic_id: clinicaT,
        p_conversation_id: conv,
        p_motivo: "falha_tecnica",
        p_job_id: atual,
      }),
    ).toBe(true);
    expect(await conversa(conv)).toMatchObject({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
    expect((await eventos(conv)).slice(-1)).toEqual([
      "A IA passou a conversa para a equipe: o assistente teve uma falha técnica.",
    ]);
    await admin
      .from("job_queue")
      .update({ status: "concluido", locked_by: null, locked_at: null })
      .eq("id", atual)
      .throwOnError();
  });

  it("tirar_conversa_da_ia_pelo_servidor sem job (rota do webhook): tira, cancela o pendente e grava o evento", async () => {
    const r = await ingerir(EQ_SERVIDOR, "Mensagem de grupo");
    const conv = r.conversation_id!;
    // a conversa deste telefone nasceu na IA no teste "sem a flag"
    expect(r.ia_atendendo).toBe(true);
    const e = await enfileirar(conv, r.message_id!);
    expect(e.job_id).not.toBeNull();
    expect(
      await rpcOk("tirar_conversa_da_ia_pelo_servidor", {
        p_clinic_id: clinicaT,
        p_conversation_id: conv,
        p_motivo: "nao_individual",
      }),
    ).toBe(true);
    expect(await conversa(conv)).toMatchObject({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
    expect((await eventos(conv)).slice(-1)).toEqual([
      "Chegou uma mensagem de grupo ou de status. A conversa voltou para a equipe.",
    ]);
    expect(await job(e.job_id!)).toMatchObject({
      status: "cancelado",
      last_error: "conversa_fora_da_ia",
    });
    // outra clinica: falso, sem efeito
    expect(
      await rpcOk("tirar_conversa_da_ia_pelo_servidor", {
        p_clinic_id: clinicaU,
        p_conversation_id: conv,
        p_motivo: "nao_individual",
      }),
    ).toBe(false);
  });
});

describe("ingestao e celular (X7 e B3 da revisao)", () => {
  it("conversa na IA que perdeu a liberacao: a mensagem seguinte volta para a equipe com o evento 'parada'", async () => {
    const r = await ingerir(EQ_PERDA, "Pergunta");
    expect(r.ia_atendendo).toBe(true);
    // pausada direto na linha (sem ia_desligar): a conversa fica na IA
    await admin
      .from("ia_liberacao")
      .update({ pausada_pela_clinica: true })
      .eq("clinic_id", clinicaT)
      .throwOnError();
    try {
      const seguinte = await ingerir(EQ_PERDA, "Ainda aí?");
      expect(seguinte).toMatchObject({
        ia_atendendo: false,
        conversation_id: r.conversation_id,
      });
      expect(await conversa(r.conversation_id!)).toMatchObject({
        status: "aguardando_humano",
        awaiting_reply: true,
      });
      expect((await eventos(r.conversation_id!)).slice(-1)).toEqual([PARADA]);
    } finally {
      await admin
        .from("ia_liberacao")
        .update({ pausada_pela_clinica: false })
        .eq("clinic_id", clinicaT)
        .throwOnError();
    }
  });

  it("pessoa pelo celular com outro texto tira da IA mesmo com a resposta da IA sem wa_message_id, e cancela o pendente", async () => {
    const r = await ingerir(EQ_ECO, "Quanto custa?");
    expect(r.ia_atendendo).toBe(true);
    const conv = r.conversation_id!;
    // o envio da IA falhou com retry: a linha 'ia' fica sem wa_message_id
    const texto = "Custa R$ 150.";
    const emVoo = await jobEmExecucao(conv, `int-${sufixo}-eco2`);
    await decisaoAprovada(conv, emVoo, texto);
    await admin
      .from("message")
      .insert({
        clinic_id: clinicaT,
        conversation_id: conv,
        direction: "saida",
        author: "ia",
        content_type: "texto",
        body: texto,
        job_id: emVoo,
        delivery_status: "falhou",
      })
      .throwOnError();
    // uma pergunta nova com o pendente na fila
    const r2 = await ingerir(EQ_ECO, "E o convênio?");
    const pendente = await enfileirar(conv, r2.message_id!);
    expect(pendente.codigo).toBe("enfileirado");
    await admin
      .from("conversation")
      .update({ last_inbound_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", conv)
      .throwOnError();
    const pessoa = await rpcOk<{ automatica: boolean }>(
      "registrar_mensagem_do_celular",
      {
        p_clinic_id: clinicaT,
        p_whatsapp_account_id: numeroT,
        p_phone_e164: EQ_ECO,
        p_wa_message_id: wa(),
        p_body: "Oi, aqui é a recepção, eu te respondo.",
      },
    );
    expect(pessoa.automatica).toBe(false);
    expect((await conversa(conv)).status).toBe("aguardando_humano");
    expect((await eventos(conv)).slice(-1)).toEqual([
      "Alguém respondeu pelo celular. A IA parou de responder nesta conversa.",
    ]);
    expect(await job(pendente.job_id!)).toMatchObject({
      status: "cancelado",
      last_error: "conversa_fora_da_ia",
    });
    await admin
      .from("job_queue")
      .update({ status: "concluido", locked_by: null, locked_at: null })
      .eq("id", emVoo)
      .throwOnError();
  });
});

describe("varios numeros ligados (decisao do dono de 19/10/2026)", () => {
  const DESLIGADA =
    "O assistente foi desligado. A conversa voltou para a equipe.";

  it("o telefone da equipe entra na IA pelos dois numeros, numa conversa por numero; fora da lista nunca; desligar um devolve so a conversa dele", async () => {
    // um terceiro numero fake da T, ligado JUNTO com o da recepcao (o
    // segundo continua desligado: e o do teste do numero nao liberado)
    const numeroT3 = (
      await criarNumeroDeTeste(admin, clinicaT, { nome: "Terceiro" })
    ).id;
    await liberarTelefone(EQ_VARIOS);
    expect(
      await rpcOk<boolean>("definir_numero_da_ia", {
        p_clinic_id: clinicaT,
        p_whatsapp_account_id: numeroT3,
        p_ativo: true,
      }),
    ).toBe(true);
    const { data: ligados } = await admin
      .from("ia_numero_liberado")
      .select("whatsapp_account_id")
      .eq("clinic_id", clinicaT)
      .eq("ativo", true)
      .throwOnError();
    expect(
      (ligados as { whatsapp_account_id: string }[])
        .map((linha) => linha.whatsapp_account_id)
        .sort(),
    ).toEqual([numeroT, numeroT3].sort());

    // a mesma pessoa pelos dois numeros: duas conversas, as duas na IA
    const peloPrimeiro = await ingerir(
      EQ_VARIOS,
      "Mensagem sintética pelo primeiro número",
      numeroT,
    );
    const peloTerceiro = await ingerir(
      EQ_VARIOS,
      "Mensagem sintética pelo terceiro número",
      numeroT3,
    );
    expect(peloPrimeiro).toMatchObject({ inserted: true, ia_atendendo: true });
    expect(peloTerceiro).toMatchObject({
      inserted: true,
      ia_atendendo: true,
      contact_id: peloPrimeiro.contact_id,
    });
    expect(peloTerceiro.conversation_id).not.toBe(peloPrimeiro.conversation_id);
    const { data: conversas } = await admin
      .from("conversation")
      .select("id, whatsapp_account_id, status")
      .in("id", [peloPrimeiro.conversation_id!, peloTerceiro.conversation_id!])
      .throwOnError();
    expect(conversas).toEqual(
      expect.arrayContaining([
        {
          id: peloPrimeiro.conversation_id,
          whatsapp_account_id: numeroT,
          status: "ia_atendendo",
        },
        {
          id: peloTerceiro.conversation_id,
          whatsapp_account_id: numeroT3,
          status: "ia_atendendo",
        },
      ]),
    );
    const { data: janelas } = await admin
      .from("ia_janela_da_conversa")
      .select("conversation_id, phone_key, aberta_por")
      .in("conversation_id", [
        peloPrimeiro.conversation_id!,
        peloTerceiro.conversation_id!,
      ])
      .throwOnError();
    expect(janelas).toHaveLength(2);
    for (const janela of janelas as {
      phone_key: string;
      aberta_por: string;
    }[]) {
      expect(janela).toMatchObject({
        phone_key: EQ_VARIOS,
        aberta_por: "ingestao",
      });
    }
    // a fila confere pelo numero da conversa: o terceiro enfileira
    const naFila = await enfileirar(
      peloTerceiro.conversation_id!,
      peloTerceiro.message_id!,
    );
    expect(naFila.codigo).toBe("enfileirado");

    // telefone fora da lista, pelo terceiro numero: equipe, sem janela nem
    // evento
    const fora = await ingerir(OUTRA, "Mensagem sintética de fora", numeroT3);
    expect(fora.ia_atendendo).toBe(false);
    expect((await conversa(fora.conversation_id!)).status).toBe(
      "aguardando_humano",
    );
    expect(await eventos(fora.conversation_id!)).toEqual([]);

    // desligar o terceiro: so a conversa dele volta para a equipe, com o
    // evento e o pendente cancelado; a do primeiro continua na IA
    expect(
      await rpcOk<boolean>("definir_numero_da_ia", {
        p_clinic_id: clinicaT,
        p_whatsapp_account_id: numeroT3,
        p_ativo: false,
      }),
    ).toBe(false);
    expect((await conversa(peloTerceiro.conversation_id!)).status).toBe(
      "aguardando_humano",
    );
    expect(await eventos(peloTerceiro.conversation_id!)).toEqual([DESLIGADA]);
    expect(await job(naFila.job_id!)).toMatchObject({
      status: "cancelado",
      last_error: "ia_desligada",
    });
    expect((await conversa(peloPrimeiro.conversation_id!)).status).toBe(
      "ia_atendendo",
    );
    expect(await eventos(peloPrimeiro.conversation_id!)).toEqual([]);

    // a mensagem nova pelo primeiro continua na IA; pelo terceiro, com a
    // equipe, na mesma conversa
    expect(
      await ingerir(EQ_VARIOS, "De novo pelo primeiro número", numeroT),
    ).toMatchObject({
      ia_atendendo: true,
      conversation_id: peloPrimeiro.conversation_id,
    });
    expect(
      await ingerir(EQ_VARIOS, "De novo pelo terceiro número", numeroT3),
    ).toMatchObject({
      ia_atendendo: false,
      conversation_id: peloTerceiro.conversation_id,
    });
    const { data: primeiro } = await admin
      .from("ia_numero_liberado")
      .select("ativo")
      .eq("whatsapp_account_id", numeroT)
      .single()
      .throwOnError();
    expect(primeiro).toEqual({ ativo: true });
  });
});

describe("onda 2 (M2): o publico na entrada e excluir telefone", () => {
  // Telefones novos da equipe (ficticios). O lead sem cadastro, o paciente
  // forcado, o lead forcado que vira paciente, outro paciente forcado e o
  // que e excluido.
  const PUB_LEAD = `+5584951${digitos}`;
  const PUB_PACIENTE = `+5584952${digitos}`;
  const PUB_VIRA = `+5584953${digitos}`;
  const PUB_PACIENTE2 = `+5584954${digitos}`;
  const PUB_LEAD2 = `+5584955${digitos}`;
  const EXCLUIR = `+5584956${digitos}`;
  const DESLIGOU =
    "O assistente foi desligado. A conversa voltou para a equipe.";

  async function publicar(publico: string | null): Promise<void> {
    const { data } = await admin
      .from("ai_agent_config")
      .select("version")
      .eq("clinic_id", clinicaT)
      .order("version", { ascending: false })
      .limit(1)
      .throwOnError();
    const versao = ((data ?? []) as { version: number }[])[0]?.version ?? 0;
    await admin
      .from("ai_agent_config")
      .insert({
        clinic_id: clinicaT,
        version: versao + 1,
        status: "publicada",
        publico_atendido: publico,
      })
      .throwOnError();
  }

  /**
   * Telefone forcado pela equipe (com a confirmacao do teste). O forcado so
   * fica marcado quando o contato tem sinal de paciente na hora: o contato
   * nasce paciente e, para o lead forcado, volta a lead depois.
   */
  async function forcar(telefone: string, kind: "lead" | "paciente") {
    await admin
      .from("contact")
      .insert({
        clinic_id: clinicaT,
        phone_e164: telefone,
        name: "Contato sintético",
        kind: "paciente",
      })
      .throwOnError();
    await rpcOk("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaT,
      p_telefone_e164: telefone,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_forcar_contato_existente: true,
      p_confirmou_aviso_da_openai: true,
      p_confirmou_teste_com_paciente: true,
    });
    if (kind === "lead") {
      await admin
        .from("contact")
        .update({ kind: "lead" })
        .eq("clinic_id", clinicaT)
        .eq("phone_e164", telefone)
        .throwOnError();
    }
  }

  it("o forcar sem a confirmacao do teste: 23514 ate para o servidor, e nada muda", async () => {
    await admin
      .from("contact")
      .insert({
        clinic_id: clinicaT,
        phone_e164: PUB_PACIENTE,
        name: "Contato sintético",
        kind: "paciente",
      })
      .throwOnError();
    const { error } = await admin.rpc("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaT,
      p_telefone_e164: PUB_PACIENTE,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_forcar_contato_existente: true,
      p_confirmou_aviso_da_openai: true,
    });
    expect(error?.code).toBe("23514");
    expect(error?.message).toBe("teste_com_paciente_nao_confirmado");
    const { data } = await admin
      .from("ia_contato_liberado")
      .select("id")
      .eq("clinic_id", clinicaT)
      .eq("phone_key", PUB_PACIENTE);
    expect(data).toEqual([]);
    // com a confirmacao, forcado
    await rpcOk("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaT,
      p_telefone_e164: PUB_PACIENTE,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_forcar_contato_existente: true,
      p_confirmou_aviso_da_openai: true,
      p_confirmou_teste_com_paciente: true,
    });
  });

  it("so leads: o lead sem cadastro entra, o paciente forcado nao; o lead que vira paciente no meio continua", async () => {
    await publicar("leads");
    await liberarTelefone(PUB_LEAD);
    expect((await ingerir(PUB_LEAD, "Oi")).ia_atendendo).toBe(true);
    const doPaciente = await ingerir(PUB_PACIENTE, "Oi");
    expect(doPaciente.ia_atendendo).toBe(false);
    expect(await eventos(doPaciente.conversation_id!)).toEqual([PARADA]);

    await forcar(PUB_VIRA, "lead");
    const primeira = await ingerir(PUB_VIRA, "Oi");
    expect(primeira.ia_atendendo).toBe(true);
    await admin
      .from("contact")
      .update({ kind: "paciente" })
      .eq("clinic_id", clinicaT)
      .eq("phone_e164", PUB_VIRA)
      .throwOnError();
    const segunda = await ingerir(PUB_VIRA, "Agora sou paciente");
    expect(segunda).toMatchObject({
      ia_atendendo: true,
      conversation_id: primeira.conversation_id,
    });
  });

  it("so pacientes: o paciente forcado entra, o lead nao", async () => {
    await publicar("pacientes");
    await forcar(PUB_PACIENTE2, "paciente");
    expect((await ingerir(PUB_PACIENTE2, "Oi")).ia_atendendo).toBe(true);
    await liberarTelefone(PUB_LEAD2);
    const doLead = await ingerir(PUB_LEAD2, "Oi");
    expect(doLead.ia_atendendo).toBe(false);
    expect(await eventos(doLead.conversation_id!)).toEqual([PARADA]);
    // de volta ao publico nao escolhido (no teste, vale tudo)
    await publicar(null);
  });

  it("excluir telefone: a conversa dele volta para a equipe, com o evento; de novo, false", async () => {
    await liberarTelefone(EXCLUIR);
    const r = await ingerir(EXCLUIR, "Oi");
    expect(r.ia_atendendo).toBe(true);
    const { data: linha } = await admin
      .from("ia_contato_liberado")
      .select("id")
      .eq("clinic_id", clinicaT)
      .eq("phone_key", EXCLUIR)
      .single()
      .throwOnError();
    const id = (linha as { id: string }).id;
    expect(
      await rpcOk("excluir_contato_liberado_da_ia", {
        p_clinic_id: clinicaT,
        p_contato_liberado_id: id,
      }),
    ).toBe(true);
    expect((await conversa(r.conversation_id!)).status).toBe(
      "aguardando_humano",
    );
    expect(await eventos(r.conversation_id!)).toEqual([DESLIGOU]);
    expect(
      await rpcOk("excluir_contato_liberado_da_ia", {
        p_clinic_id: clinicaT,
        p_contato_liberado_id: id,
      }),
    ).toBe(false);
    // a mensagem seguinte fica com a equipe (o telefone nao esta na lista)
    const depois = await ingerir(EXCLUIR, "Ainda ai?");
    expect(depois.ia_atendendo).toBe(false);
  });
});
