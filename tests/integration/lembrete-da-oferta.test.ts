import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/webhooks/whatsapp/route";
import { idsRespondidos } from "@/lib/agente/historico";
import {
  CHAVE_DO_LEMBRETE,
  textoDoLembreteDaOferta,
} from "@/lib/domain/lembrete-da-oferta";
import { idDoJobDoLembrete } from "@/lib/integrations/whatsapp/interceptar-resposta";
import { executarOfertaDeEspera } from "@/lib/jobs/lista-espera";
import type { Job } from "@/lib/jobs/worker";

import {
  caminhoDoWebhook,
  criarNumeroDeTeste,
  type NumeroDeTeste,
} from "../rls/numeros";
import { adminClient, stackCredentials } from "../rls/stack";

// AG5, a oferta da lista de espera na conversa com a IA (desenho, secoes 1.6
// e 5; decisao D-39 pela recomendacao, pendente do dono), contra o banco
// REAL e pelas portas reais: a rota do webhook (POST, com a ingestao, o
// interceptador e a marcacao de verdade), o job da reoferta
// (executarOfertaDeEspera) e o aceite (aceitar_oferta_de_espera):
// - a mensagem que nao e SIM nem NAO QUERO, com a oferta de pe, recebe o
//   lembrete fixo (T-E4) pela fila, uma vez, com o numero que recebeu e sem
//   offer_id; nenhum turno da IA; a mensagem sai das pendentes (o turno
//   sintetico de marcar_mensagem_tratada_pelo_sistema) e a conversa sai do
//   contador;
// - revisao da AG5 (achado 1b): a mensagem seguinte, com o lembrete AINDA NA
//   FILA, fica coberta por ele (marcada, sem turno, sem segundo lembrete); o
//   lembrete sai e o SIM e aceito: a consulta nasce no horario, a oferta
//   fecha e o SIM tambem sai das pendentes;
// - achado 1a: a resposta da IA entre a oferta e a saida do lembrete nao
//   leva o SIM para a IA (o lembrete que saiu e a pergunta de novo);
// - achado 1c, o caso que CONTINUA com a IA: o lembrete saiu, a pessoa
//   perguntou outra coisa (vai para a IA), a IA RESPONDEU (a resposta
//   simulada aqui: a clinica de teste nao roda o turno, e sem ela o SIM
//   passava so por isso), e o SIM sem citar fica com quem atende: a oferta
//   continua aberta. Citando o lembrete, o SIM e aceito;
// - achado 3: sem a autorizacao para receber mensagens, nenhum lembrete, e a
//   mensagem fica com a IA (que passa para a equipe);
// - a conversa com a equipe (telefone fora da lista da IA) fica como hoje:
//   sem lembrete, nada marcado.
//
// PRECISA da migration 20261029100000 (marcar_mensagem_tratada_pelo_sistema
// e as colunas novas da fila) aplicada. ESCRITO, AINDA NAO RODADO: grava no
// banco. Roda depois de aplicar a migration, com
// npm run test:integration -- lembrete-da-oferta.
//
// CUIDADO, o banco e o da producao: a clinica e_de_teste com o slug
// lembrete-oferta-int-*, apagada no afterAll (fila, ofertas, consultas,
// jobs, turnos e mensagens vao em cascata; o beforeAll apaga a sobra de uma
// execucao que morreu ha mais de uma hora). A IA liberada so nela (fora da
// lista fechada: nao depende do interruptor, so atende em numero 'fake' e o
// motor da IA de producao nunca a reivindica); nenhum executor roda aqui e
// nenhuma mensagem sai (numero 'fake'; o motor de producao ignora a clinica
// de teste, entao o lembrete fica 'pendente' na fila; a mensagem da oferta,
// a do lembrete e a resposta da IA "saem" por um insert do teste, como em
// tests/integration/lista-espera.test.ts). O interruptor global NUNCA e
// tocado. Telefones ficticios.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic
//    where slug like 'lembrete-oferta-int-%' and e_de_teste;

// A rota cria o admin client pelo ambiente; fora do Next ele nao vem
// carregado.
const credenciais = stackCredentials();
process.env.NEXT_PUBLIC_SUPABASE_URL ??= credenciais.url;
process.env.SUPABASE_SERVICE_ROLE_KEY ??= credenciais.serviceRoleKey;

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const FUSO = "America/Fortaleza";
const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;

let clinica = "";
let numero: NumeroDeTeste;
let profissional = "";
let procedimento = "";
let vinculo = "";
let telefones = 0;
let mensagens = 0;

type Oferta = { id: string; slot_starts_at: string; expires_at: string };
type Lembrete = {
  id: string;
  payload: Record<string, unknown>;
  whatsapp_account_id: string | null;
};

async function rpcOk<T>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
}

async function inserir(
  tabela: string,
  linha: Record<string, unknown>,
): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

function novoTelefone(): string {
  telefones += 1;
  return `+55849${digitos}${String(telefones).padStart(2, "0")}`;
}

/** O evento canonico de mensagem recebida (provedor falso), pela rota. */
async function receber(
  telefone: string,
  body: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; waMessageId: string }> {
  mensagens += 1;
  const waMessageId = `lembrete-oferta-int:${sufixo}:${mensagens}`;
  const resposta = await POST(
    new NextRequest(
      new URL(caminhoDoWebhook(numero), "http://localhost:3000"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "message_received",
          phone: telefone,
          name: "Contato sintético",
          waMessageId,
          contentType: "texto",
          body,
          ...extra,
        }),
      },
    ),
  );
  return { status: resposta.status, waMessageId };
}

/** O contato e a conversa NA IA (telefone liberado, pela ingestao). */
async function contatoNaIa(): Promise<{
  telefone: string;
  contato: string;
  conversa: string;
}> {
  const telefone = novoTelefone();
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinica,
    p_telefone_e164: telefone,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_confirmou_aviso_da_openai: true,
  });
  return contatoPelaIngestao(telefone, true);
}

/** O contato e a conversa COM A EQUIPE (telefone fora da lista da IA). */
async function contatoComAEquipe(): Promise<{
  telefone: string;
  contato: string;
  conversa: string;
}> {
  return contatoPelaIngestao(novoTelefone(), false);
}

async function contatoPelaIngestao(
  telefone: string,
  naIa: boolean,
): Promise<{ telefone: string; contato: string; conversa: string }> {
  mensagens += 1;
  const r = await rpcOk<{
    conversation_id: string | null;
    contact_id: string | null;
    ia_atendendo?: boolean;
  }>("ingest_inbound_message", {
    p_clinic_id: clinica,
    p_phone_e164: telefone,
    p_name: "Contato sintético",
    p_wa_message_id: `lembrete-oferta-int:${sufixo}:${mensagens}`,
    p_content_type: "texto",
    p_body: "Oi",
    p_whatsapp_account_id: numero.id,
  });
  expect(r.ia_atendendo === true, "a conversa com a IA ou com a equipe").toBe(
    naIa,
  );
  const contato = r.contact_id!;
  // A autorizacao para receber mensagens: sem ela a reoferta pula a pessoa.
  await inserir("contact_consent", {
    clinic_id: clinica,
    contact_id: contato,
    channel: "whatsapp",
    source: "recepcao",
  });
  return { telefone, contato, conversa: r.conversation_id! };
}

/**
 * A oferta para o contato: ele na fila, uma consulta de outra pessoa
 * cancelada (o gatilho enfileira a reoferta), o job da reoferta executado e
 * a mensagem da oferta "saindo" na conversa dele (send.ts grava o job_id).
 */
async function ofertaPara(contato: string, conversa: string): Promise<Oferta> {
  await inserir("waitlist", {
    clinic_id: clinica,
    contact_id: contato,
    procedure_id: procedimento,
  });
  const outro = await inserir("contact", {
    clinic_id: clinica,
    phone_e164: novoTelefone(),
    name: "Quem cancelou",
  });
  const inicio = new Date(Date.now() + 7 * DIA + telefones * 60 * MINUTO);
  const consulta = await inserir("appointment", {
    clinic_id: clinica,
    contact_id: outro,
    professional_id: profissional,
    service_link_id: vinculo,
    starts_at: inicio.toISOString(),
    ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
  });
  await admin
    .from("appointment")
    .update({ status: "cancelado_clinica" })
    .eq("id", consulta)
    .throwOnError();
  const { data: jobs } = await admin
    .from("job_queue")
    .select("id, clinic_id, kind, payload, attempts, max_attempts, status")
    .eq("clinic_id", clinica)
    .eq("kind", "oferecer_lista_espera")
    .eq("status", "pendente")
    .order("created_at", { ascending: false })
    .limit(1)
    .throwOnError();
  const job = (jobs ?? [])[0];
  expect(job, "o job da reoferta").toBeDefined();
  expect(await executarOfertaDeEspera(admin, job as unknown as Job)).toEqual({
    ok: true,
  });
  await admin
    .from("job_queue")
    .update({ status: "concluido", completed_at: new Date().toISOString() })
    .eq("id", (job as { id: string }).id)
    .throwOnError();

  const { data: oferta } = await admin
    .from("waitlist_offer")
    .select("id, slot_starts_at, expires_at, offered_to, status")
    .eq("clinic_id", clinica)
    .contains("offered_to", [contato])
    .eq("status", "aberta")
    .order("created_at", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  const { data: envio } = await admin
    .from("job_queue")
    .select("id")
    .eq("clinic_id", clinica)
    .eq("kind", "enviar_mensagem_ativa")
    .eq("payload->>contact_id", contato)
    .contains("payload", { offer_id: (oferta as { id: string }).id })
    .single()
    .throwOnError();
  await inserir("message", {
    clinic_id: clinica,
    conversation_id: conversa,
    direction: "saida",
    author: "sistema",
    content_type: "texto",
    body: "Mensagem da oferta (simulada no teste)",
    job_id: (envio as { id: string }).id,
    delivery_status: "enviada",
    whatsapp_account_id: numero.id,
    billable: false,
    cost_cents: 0,
  });
  return oferta as Oferta;
}

/**
 * O executor manda o lembrete (o motor de producao ignora a clinica de
 * teste): a mensagem do sistema com o job do lembrete, como send.ts a grava.
 * O wa_message_id permite citar o lembrete.
 */
async function lembreteSai(
  lembrete: Lembrete,
  conversa: string,
): Promise<string> {
  const waMessageId = `lembrete-oferta-int:${sufixo}:lembrete:${lembrete.id}`;
  await inserir("message", {
    clinic_id: clinica,
    conversation_id: conversa,
    direction: "saida",
    author: "sistema",
    content_type: "texto",
    body: lembrete.payload.body,
    job_id: lembrete.id,
    wa_message_id: waMessageId,
    delivery_status: "enviada",
    whatsapp_account_id: numero.id,
    billable: false,
    cost_cents: 0,
  });
  return waMessageId;
}

/**
 * A resposta da IA a uma pergunta da pessoa (o turno nao roda na clinica de
 * teste; sem job, o gatilho da IA deixa a clinica de teste gravar).
 */
async function iaResponde(conversa: string): Promise<void> {
  await inserir("message", {
    clinic_id: clinica,
    conversation_id: conversa,
    direction: "saida",
    author: "ia",
    content_type: "texto",
    body: "Resposta da IA (simulada no teste)",
    delivery_status: "enviada",
    whatsapp_account_id: numero.id,
    billable: false,
    cost_cents: 0,
  });
}

async function mensagemPeloWa(waMessageId: string): Promise<string> {
  const { data } = await admin
    .from("message")
    .select("id")
    .eq("clinic_id", clinica)
    .eq("wa_message_id", waMessageId)
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/** O que o carregador do historico (lib/agente/historico.ts) conta como lido. */
async function respondidas(conversa: string): Promise<Set<string>> {
  const { data } = await admin
    .from("ai_turno")
    .select("job_id, estado, mensagens_lidas")
    .eq("clinic_id", clinica)
    .eq("conversation_id", conversa)
    .throwOnError();
  return idsRespondidos(
    (data ?? []) as {
      job_id: string;
      estado: string;
      mensagens_lidas: string[] | null;
    }[],
    "00000000-0000-4000-8000-000000000000",
  );
}

async function lembretesDe(contato: string): Promise<Lembrete[]> {
  const { data } = await admin
    .from("job_queue")
    .select("id, kind, payload, whatsapp_account_id")
    .eq("clinic_id", clinica)
    .eq("kind", "enviar_mensagem_ativa")
    .eq("payload->>contact_id", contato)
    .not(`payload->>${CHAVE_DO_LEMBRETE}`, "is", null)
    .throwOnError();
  return (data ?? []) as Lembrete[];
}

async function turnosDaIa(conversa: string): Promise<number> {
  const { data } = await admin
    .from("job_queue")
    .select("id")
    .eq("clinic_id", clinica)
    .eq("kind", "responder_com_ia")
    .eq("payload->>conversation_id", conversa)
    .throwOnError();
  return (data ?? []).length;
}

async function aguardandoResposta(conversa: string): Promise<boolean> {
  const { data } = await admin
    .from("conversation")
    .select("awaiting_reply")
    .eq("id", conversa)
    .single()
    .throwOnError();
  return (data as { awaiting_reply: boolean }).awaiting_reply;
}

async function situacaoDaOferta(id: string): Promise<{
  status: string;
  responded_by: string | null;
  appointment_id: string | null;
}> {
  const { data } = await admin
    .from("waitlist_offer")
    .select("status, responded_by, appointment_id")
    .eq("id", id)
    .single()
    .throwOnError();
  return data as {
    status: string;
    responded_by: string | null;
    appointment_id: string | null;
  };
}

/** A oferta aceita pelo contato: a consulta nasce no horario oferecido. */
async function esperarAceita(oferta: Oferta, contato: string): Promise<void> {
  const depois = await situacaoDaOferta(oferta.id);
  expect(depois).toMatchObject({
    status: "preenchida",
    responded_by: contato,
  });
  const { data: consulta } = await admin
    .from("appointment")
    .select("contact_id, status, starts_at, created_by")
    .eq("id", depois.appointment_id!)
    .single()
    .throwOnError();
  expect(consulta).toMatchObject({
    contact_id: contato,
    status: "agendado",
    created_by: "sistema",
  });
  expect(Date.parse((consulta as { starts_at: string }).starts_at)).toBe(
    Date.parse(oferta.slot_starts_at),
  );
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "lembrete-oferta-int-%")
    .lt("created_at", new Date(Date.now() - 60 * MINUTO).toISOString());

  clinica = await inserir("clinic", {
    name: `Lembrete da oferta integração ${sufixo}`,
    slug: `lembrete-oferta-int-${sufixo}`,
    e_de_teste: true,
    timezone: FUSO,
  });
  numero = await criarNumeroDeTeste(admin, clinica, { nome: "Recepção" });
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinica,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de integracao da AG5 (lembrete da oferta)",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinica,
    p_whatsapp_account_id: numero.id,
    p_ativo: true,
  });
  // O lembrete nao depende de habilidade: e do interceptador (sistema), e
  // vale para toda entrada da fila, da recepcao ou da IA.
  await inserir("ai_agent_config", {
    clinic_id: clinica,
    version: 1,
    status: "publicada",
  });

  profissional = await inserir("professional", {
    clinic_id: clinica,
    name: "Dra. Espera Sintética",
  });
  procedimento = await inserir("procedure", {
    clinic_id: clinica,
    name: "Consulta sintética",
    default_duration_min: 30,
  });
  vinculo = await inserir("service_link", {
    clinic_id: clinica,
    professional_id: profissional,
    procedure_id: procedimento,
    insurance_id: null,
    price_cents: 20000,
    covered_by_insurance: false,
    duration_min: 30,
  });
  // Jornada de 24 h em todos os dias: a vaga so e oferecida dentro dela.
  await admin
    .from("professional_schedule")
    .insert(
      [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
        {
          clinic_id: clinica,
          professional_id: profissional,
          weekday,
          starts_at: "00:00",
          ends_at: "12:00",
        },
        {
          clinic_id: clinica,
          professional_id: profissional,
          weekday,
          starts_at: "12:00",
          ends_at: "00:00",
        },
      ]),
    )
    .throwOnError();
});

afterAll(async () => {
  if (clinica) {
    await admin.from("clinic").delete().eq("id", clinica);
  }
});

describe("a oferta na conversa com a IA (D-39)", () => {
  it("o lembrete enfileirado, nenhum turno, a mensagem fora das pendentes; a seguinte, com o lembrete na fila, coberta por ele; o lembrete sai e o SIM é aceito", async () => {
    const { telefone, contato, conversa } = await contatoNaIa();
    const oferta = await ofertaPara(contato, conversa);

    // 1) Outra coisa, nem SIM nem NAO QUERO: o lembrete.
    const primeira = await receber(telefone, "Oi, que horário é esse?");
    expect(primeira.status).toBe(200);
    const [lembrete, ...mais] = await lembretesDe(contato);
    expect(mais).toEqual([]);
    expect(lembrete?.id).toBe(idDoJobDoLembrete(oferta.id, contato));
    expect(lembrete?.whatsapp_account_id).toBe(numero.id);
    expect(lembrete?.payload).toMatchObject({
      contact_id: contato,
      resposta_ao_paciente: true,
      [CHAVE_DO_LEMBRETE]: oferta.id,
      body: textoDoLembreteDaOferta({
        inicioDoHorario: oferta.slot_starts_at,
        venceEm: oferta.expires_at,
        fuso: FUSO,
      }),
    });
    expect(lembrete?.payload).not.toHaveProperty("offer_id");
    // Nenhum turno da IA; a mensagem lida pelo turno sintetico; a conversa
    // fora do contador.
    expect(await turnosDaIa(conversa)).toBe(0);
    const idDaPrimeira = await mensagemPeloWa(primeira.waMessageId);
    expect((await respondidas(conversa)).has(idDaPrimeira)).toBe(true);
    expect(await aguardandoResposta(conversa)).toBe(false);
    const { data: turno } = await admin
      .from("ai_turno")
      .select("estado, saida, mensagens_lidas")
      .eq("conversation_id", conversa)
      .contains("mensagens_lidas", [idDaPrimeira])
      .single()
      .throwOnError();
    expect(turno).toEqual({
      estado: "enviado",
      saida: "nenhuma",
      mensagens_lidas: [idDaPrimeira],
    });

    // 2) A seguinte chega com o lembrete AINDA NA FILA (o motor de producao
    // ignora a clinica de teste): coberta por ele, marcada, sem turno e sem
    // segundo lembrete (revisao da AG5, achado 1b).
    const segunda = await receber(telefone, "E onde fica a clínica?");
    expect(segunda.status).toBe(200);
    expect(await lembretesDe(contato)).toHaveLength(1);
    const idDaSegunda = await mensagemPeloWa(segunda.waMessageId);
    expect((await respondidas(conversa)).has(idDaSegunda)).toBe(true);
    expect(await turnosDaIa(conversa)).toBe(0);
    expect(await aguardandoResposta(conversa)).toBe(false);

    // 3) O lembrete sai (autor sistema, com o job do lembrete; ele nao fecha
    // a oferta) e o SIM seguinte e do interceptador: a consulta nasce no
    // horario.
    await lembreteSai(lembrete!, conversa);
    const sim = await receber(telefone, "SIM");
    expect(sim.status).toBe(200);
    await esperarAceita(oferta, contato);
    // O SIM tambem sai das pendentes, sem turno.
    const idDoSim = await mensagemPeloWa(sim.waMessageId);
    expect((await respondidas(conversa)).has(idDoSim)).toBe(true);
    expect(await turnosDaIa(conversa)).toBe(0);
  });

  it("a resposta da IA entre a oferta e a saída do lembrete não leva o SIM para a IA: o lembrete que saiu é a pergunta de novo (achado 1a)", async () => {
    const { telefone, contato, conversa } = await contatoNaIa();
    const oferta = await ofertaPara(contato, conversa);

    await receber(telefone, "Que horas mesmo?");
    const [lembrete] = await lembretesDe(contato);
    expect(lembrete).toBeDefined();
    // Um turno que ja estava em andamento responde agora (mais nova que a
    // oferta); so depois o lembrete sai.
    await iaResponde(conversa);
    await lembreteSai(lembrete!, conversa);

    const sim = await receber(telefone, "SIM");
    expect(sim.status).toBe(200);
    await esperarAceita(oferta, contato);
    const idDoSim = await mensagemPeloWa(sim.waMessageId);
    expect((await respondidas(conversa)).has(idDoSim)).toBe(true);
  });

  it("o caso que continua com a IA (achado 1c): o lembrete saiu, a pessoa perguntou outra coisa, a IA respondeu, e o SIM sem citar fica com quem atende; citando o lembrete, é aceito", async () => {
    const { telefone, contato, conversa } = await contatoNaIa();
    const oferta = await ofertaPara(contato, conversa);

    await receber(telefone, "Que horas mesmo?");
    const [lembrete] = await lembretesDe(contato);
    expect(lembrete).toBeDefined();
    const waDoLembrete = await lembreteSai(lembrete!, conversa);

    // O lembrete ja saiu: a outra pergunta vai para a IA (nada marcado, sem
    // segundo lembrete). A clinica de teste nao enfileira o turno sem a flag
    // do teste (fora_da_fase, so no log): a RESPOSTA da IA e simulada.
    const pergunta = await receber(telefone, "E onde fica a clínica?");
    expect(pergunta.status).toBe(200);
    expect(await lembretesDe(contato)).toHaveLength(1);
    const idDaPergunta = await mensagemPeloWa(pergunta.waMessageId);
    expect((await respondidas(conversa)).has(idDaPergunta)).toBe(false);
    await iaResponde(conversa);

    // O SIM sem citar responde a fala mais recente, a da IA: o interceptador
    // nao aceita, a mensagem fica com quem atende (a IA, que pelo prompt
    // passa para a equipe quem fala do horario oferecido). A oferta continua
    // aberta para esta pessoa.
    const sim = await receber(telefone, "SIM");
    expect(sim.status).toBe(200);
    expect(await situacaoDaOferta(oferta.id)).toMatchObject({
      status: "aberta",
      responded_by: null,
    });
    const idDoSim = await mensagemPeloWa(sim.waMessageId);
    expect((await respondidas(conversa)).has(idDoSim)).toBe(false);
    expect(await aguardandoResposta(conversa)).toBe(true);

    // Citando o lembrete ("responder" no WhatsApp), o SIM e da oferta.
    const citando = await receber(telefone, "SIM", {
      quotedWaMessageId: waDoLembrete,
    });
    expect(citando.status).toBe(200);
    await esperarAceita(oferta, contato);
  });

  it("sem a autorização para receber mensagens: nenhum lembrete, e a mensagem fica com a IA (achado 3)", async () => {
    const { telefone, contato, conversa } = await contatoNaIa();
    await ofertaPara(contato, conversa);
    await admin
      .from("contact_consent")
      .update({ revoked_at: new Date().toISOString() })
      .eq("clinic_id", clinica)
      .eq("contact_id", contato)
      .is("revoked_at", null)
      .throwOnError();

    const r = await receber(telefone, "Que horas mesmo?");
    expect(r.status).toBe(200);
    expect(await lembretesDe(contato)).toEqual([]);
    const id = await mensagemPeloWa(r.waMessageId);
    expect((await respondidas(conversa)).has(id)).toBe(false);
    expect(await aguardandoResposta(conversa)).toBe(true);
  });

  it("na conversa com a equipe nada muda: sem lembrete e nada marcado", async () => {
    const { telefone, contato, conversa } = await contatoComAEquipe();
    await ofertaPara(contato, conversa);
    const r = await receber(telefone, "Que horas mesmo?");
    expect(r.status).toBe(200);
    expect(await lembretesDe(contato)).toEqual([]);
    expect(await respondidas(conversa)).toEqual(new Set());
  });

  it("na conversa com a IA sem oferta: a mensagem fica com a IA, sem lembrete nem marca", async () => {
    const { telefone, contato, conversa } = await contatoNaIa();
    const r = await receber(telefone, "Bom dia, tudo bem?");
    expect(r.status).toBe(200);
    expect(await lembretesDe(contato)).toEqual([]);
    const id = await mensagemPeloWa(r.waMessageId);
    expect((await respondidas(conversa)).has(id)).toBe(false);
  });
});
