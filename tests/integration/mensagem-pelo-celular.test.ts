import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/webhooks/whatsapp/route";
import { ORIGEM_DO_RASTREIO } from "@/lib/integrations/whatsapp/rastreio";
import {
  caminhoDoWebhook,
  criarNumeroDeTeste,
  type NumeroDeTeste,
} from "../rls/numeros";
import { adminClient, stackCredentials } from "../rls/stack";

// Mensagem enviada pelo celular pareado (Pelo WhatsApp), migration
// 20261005120000, contra o banco REAL.
//
// O que se prova: registrar_mensagem_do_celular grava UMA linha de saida,
// pelo_celular, de custo zero, na conversa aberta do numero que enviou, com
// created_at na hora de CHEGADA (nunca o horario do payload) e o horario de
// envio plausivel em enviada_no_aparelho_em; reconhece a resposta automatica
// do app WhatsApp Business (autor 'sistema') pelos HORARIOS DE ENVIO quando o
// eco e a ultima mensagem do paciente os tem (o paciente enviou de 8 s antes
// a 2 s depois do eco) e, sem um deles, pela CHEGADA (o paciente chegou de
// 8 s antes a 10 s depois do envio); so derruba a espera quando a ultima
// mensagem do paciente e anterior ao envio (a pergunta que veio depois segue
// esperando, mesmo com eco de pessoa); nunca cria nem mexe em contato,
// consentimento, last_inbound_at ou unread_count; e ignora numero proprio,
// numero ativo de outra clinica da plataforma, numero removido, contato
// desconhecido e wa_message_id de outra clinica. Nas duas ignoradas de
// plataforma e colisao, a espera da conversa aberta daquele numero desce e o
// contato volta (para o termo-chave), sem criar nada.
// reclassificar_resposta_automatica grava o horario de envio do paciente e
// corrige o eco de pessoa que correu na frente da mensagem dele (chegou de
// 8 s antes a 2 s depois e, com os dois horarios, saiu depois dele); a fala
// da equipe enviada antes, que chega colada na rajada de reconexao, continua
// de pessoa. adotar_eco_do_envio desfaz o eco duplicado de um envio nosso,
// resolve a conversa vazia que o eco abriu e devolve a espera que o eco de
// pessoa derrubou. O CHECK message_pelo_celular_coerente barra linha
// incoerente ate do service role.
// E, pela porta real (POST da rota do webhook com o payload do uazapi), o
// eco do celular vira linha, a midia vira job, o eco marcado com a nossa
// origem de rastreio nao vira nada, a ausencia que chega antes da mensagem
// do paciente vira 'sistema' quando ela chega, a ingestao grava o horario de
// envio do paciente e a fala de pessoa da rajada continua de pessoa.
//
// Horarios relativos (envio, chegada do paciente) sao montados a partir do
// last_inbound_at e do created_at que o BANCO gravou, nunca do relogio desta
// maquina: a janela e de segundos, e relogio fora de sincronia daria falso
// resultado.
//
// Clinicas e_de_teste (o motor de producao as ignora: nenhum job
// enfileirado aqui sai sozinho). Provedor 'fake' em todo numero: nenhum
// teste encosta no WhatsApp real. Nada aqui imprime conteudo de mensagem.

// A rota cria o admin client pelo ambiente; fora do Next ele nao vem
// carregado.
const credenciais = stackCredentials();
process.env.NEXT_PUBLIC_SUPABASE_URL ??= credenciais.url;
process.env.SUPABASE_SERVICE_ROLE_KEY ??= credenciais.serviceRoleKey;

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const INVALID_PARAMETER_VALUE = "22023";

let sequencia = 0;
function telefone(): string {
  sequencia += 1;
  return `+55849785${String(sequencia).padStart(5, "0")}`;
}

function waId(nome: string): string {
  return `cel:${sufixo}:${nome}`;
}

/** O chatid do WhatsApp para um telefone E.164. */
function jid(phone: string): string {
  return `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
}

async function clinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Pelo celular ${nome} ${sufixo}`,
      slug: `pelo-celular-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  return clinicId;
}

// Clinica X com dois numeros (A principal, B comum, cada um com o
// display_phone como o uazapi grava: so digitos, sem o nono digito) e a
// clinica Y, de outra conta da plataforma.
let preparo: Promise<{
  x: string;
  a: NumeroDeTeste;
  b: NumeroDeTeste;
  y: string;
  y1: NumeroDeTeste;
}> | null = null;
function cenario() {
  preparo ??= (async () => {
    const x = await clinica("x");
    const a = await criarNumeroDeTeste(admin, x, {
      nome: "Recepção",
      display_phone: "558466660001",
    });
    const b = await criarNumeroDeTeste(admin, x, {
      nome: "Estética",
      display_phone: "558466660002",
    });
    const y = await clinica("y");
    const y1 = await criarNumeroDeTeste(admin, y);
    return { x, a, b, y, y1 };
  })();
  return preparo;
}

/** Contato cadastrado (com consentimento), como a recepcao faz. */
async function paciente(
  clinicId: string,
): Promise<{ contactId: string; phone: string }> {
  const phone = telefone();
  const { data } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: phone, name: "Paciente" })
    .select("id")
    .single()
    .throwOnError();
  const contactId = data!.id as string;
  await admin
    .from("contact_consent")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      channel: "whatsapp",
      source: "recepcao",
    })
    .throwOnError();
  return { contactId, phone };
}

async function conversaNoNumero(
  clinicId: string,
  contactId: string,
  accountId: string,
): Promise<string> {
  const { data } = await admin
    .rpc("garantir_conversa_aberta", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
      p_whatsapp_account_id: accountId,
    })
    .throwOnError();
  return data as unknown as string;
}

type Registro = {
  inserted: boolean;
  ignorada?: string;
  contact_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  whatsapp_account_id: string | null;
  automatica: boolean | null;
};

type EntradaDoRegistro = {
  clinicId: string;
  accountId: string;
  phone: string;
  waMessageId: string;
  contentType?: string;
  body?: string | null;
  mediaUrl?: string | null;
  mediaFilename?: string | null;
  mediaMimetype?: string | null;
  quoted?: string | null;
  enviadaEm?: string | null;
};

/** Chama a RPC como o webhook chama (service role). */
async function registrar(entrada: EntradaDoRegistro) {
  const resposta = await admin.rpc("registrar_mensagem_do_celular", {
    p_clinic_id: entrada.clinicId,
    p_whatsapp_account_id: entrada.accountId,
    p_phone_e164: entrada.phone,
    p_wa_message_id: entrada.waMessageId,
    p_content_type: entrada.contentType ?? "texto",
    p_body: entrada.body ?? null,
    p_media_url: entrada.mediaUrl ?? null,
    p_media_filename: entrada.mediaFilename ?? null,
    p_media_mimetype: entrada.mediaMimetype ?? null,
    p_quoted_wa_message_id: entrada.quoted ?? null,
    p_enviada_em: entrada.enviadaEm ?? null,
  });
  return {
    data: (resposta.data ?? null) as Registro | null,
    error: resposta.error,
  };
}

async function registrado(entrada: EntradaDoRegistro): Promise<Registro> {
  const { data, error } = await registrar(entrada);
  expect(error).toBeNull();
  return data!;
}

/** Mensagem do paciente pela ingestao real. */
async function ingerir(
  clinicId: string,
  accountId: string,
  phone: string,
  id: string,
): Promise<{
  conversation_id: string;
  message_id: string;
  contact_id: string;
}> {
  const { data } = await admin
    .rpc("ingest_inbound_message", {
      p_clinic_id: clinicId,
      p_phone_e164: phone,
      p_name: "Paciente",
      p_wa_message_id: id,
      p_content_type: "texto",
      p_body: "Oi, tudo bem?",
      p_media_url: null,
      p_transcript: null,
      p_whatsapp_account_id: accountId,
    })
    .throwOnError();
  return data as {
    conversation_id: string;
    message_id: string;
    contact_id: string;
  };
}

type Linha = {
  id: string;
  clinic_id: string;
  conversation_id: string;
  whatsapp_account_id: string;
  direction: string;
  author: string;
  author_user_id: string | null;
  pelo_celular: boolean;
  content_type: string;
  body: string | null;
  media_url: string | null;
  media_filename: string | null;
  media_mimetype: string | null;
  billable: boolean;
  cost_cents: number | null;
  delivery_status: string | null;
  job_id: string | null;
  is_internal_note: boolean;
  reply_to_message_id: string | null;
  reply_to_wa_message_id: string | null;
  enviada_no_aparelho_em: string | null;
  created_at: string;
};

async function linhasCom(waMessageId: string): Promise<Linha[]> {
  const { data } = await admin
    .from("message")
    .select(
      "id, clinic_id, conversation_id, whatsapp_account_id, direction, author, author_user_id, pelo_celular, content_type, body, media_url, media_filename, media_mimetype, billable, cost_cents, delivery_status, job_id, is_internal_note, reply_to_message_id, reply_to_wa_message_id, enviada_no_aparelho_em, created_at",
    )
    .eq("wa_message_id", waMessageId)
    .throwOnError();
  return (data ?? []) as Linha[];
}

type Conversa = {
  id: string;
  status: string;
  contact_id: string;
  whatsapp_account_id: string;
  awaiting_reply: boolean;
  unread_count: number;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_preview: string | null;
  last_preview_author: string | null;
  last_preview_author_user_id: string | null;
};

async function conversa(id: string): Promise<Conversa> {
  const { data } = await admin
    .from("conversation")
    .select(
      "id, status, contact_id, whatsapp_account_id, awaiting_reply, unread_count, last_inbound_at, last_message_at, last_preview, last_preview_author, last_preview_author_user_id",
    )
    .eq("id", id)
    .single()
    .throwOnError();
  return data as Conversa;
}

/** Paciente que escreveu ha uma hora e esta esperando resposta. */
async function esperandoHaUmaHora(conversationId: string): Promise<string> {
  const umaHoraAtras = new Date(Date.now() - HORA).toISOString();
  await admin
    .from("conversation")
    .update({
      awaiting_reply: true,
      last_inbound_at: umaHoraAtras,
      unread_count: 2,
    })
    .eq("id", conversationId)
    .throwOnError();
  return umaHoraAtras;
}

/** Instante (ms) da ultima mensagem do paciente, pelo relogio do banco. */
async function ultimaEntrada(conversationId: string): Promise<number> {
  const { last_inbound_at } = await conversa(conversationId);
  expect(last_inbound_at).not.toBeNull();
  return Date.parse(last_inbound_at!);
}

/** Horario de envio do eco, `deslocamento` ms depois de `instante`. */
function aos(instante: number, deslocamento: number): string {
  return new Date(instante + deslocamento).toISOString();
}

/** A linha 'enviando' (sem wa_message_id) que o send.ts grava antes de chamar o provedor. */
async function linhaEnviando(
  clinicId: string,
  conversationId: string,
  author: "sistema" | "usuario",
): Promise<string> {
  const { data } = await admin
    .from("message")
    .insert({
      clinic_id: clinicId,
      conversation_id: conversationId,
      direction: "saida",
      author,
      content_type: "texto",
      body: "Sua consulta é amanhã",
      delivery_status: "enviando",
      billable: false,
      cost_cents: 0,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function adotar(
  clinicId: string,
  messageId: string,
  waMessageId: string,
): Promise<boolean | null> {
  const { data, error } = await admin.rpc("adotar_eco_do_envio", {
    p_clinic_id: clinicId,
    p_message_id: messageId,
    p_wa_message_id: waMessageId,
  });
  expect(error).toBeNull();
  return data as boolean | null;
}

async function reclassificar(
  clinicId: string,
  messageId: string,
  enviadaEm?: string,
): Promise<number | null> {
  const { data, error } = await admin.rpc("reclassificar_resposta_automatica", {
    p_clinic_id: clinicId,
    p_message_id: messageId,
    ...(enviadaEm === undefined ? {} : { p_enviada_em: enviadaEm }),
  });
  expect(error).toBeNull();
  return data as number | null;
}

/** Horario de envio gravado na linha (ms), ou null. */
async function enviadaNoAparelhoEm(messageId: string): Promise<number | null> {
  const { data } = await admin
    .from("message")
    .select("enviada_no_aparelho_em")
    .eq("id", messageId)
    .single()
    .throwOnError();
  const valor = data!.enviada_no_aparelho_em as string | null;
  return valor === null ? null : Date.parse(valor);
}

async function autorDe(messageId: string): Promise<string> {
  const { data } = await admin
    .from("message")
    .select("author")
    .eq("id", messageId)
    .single()
    .throwOnError();
  return data!.author as string;
}

async function criadaEm(messageId: string): Promise<number> {
  const { data } = await admin
    .from("message")
    .select("created_at")
    .eq("id", messageId)
    .single()
    .throwOnError();
  return Date.parse(data!.created_at as string);
}

/** Simula a hora de chegada de uma linha (o fio e a janela leem created_at). */
async function chegouEm(messageId: string, instante: number): Promise<void> {
  await admin
    .from("message")
    .update({ created_at: new Date(instante).toISOString() })
    .eq("id", messageId)
    .throwOnError();
}

async function contarMensagensDaClinica(clinicId: string): Promise<number> {
  const { count } = await admin
    .from("message")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .throwOnError();
  return count ?? 0;
}

type RespostaDoWebhook = { status: number; corpo: Record<string, unknown> };

/** Chama o handler REAL do webhook, como o provedor chamaria. */
async function postar(
  caminho: string,
  corpo: unknown,
): Promise<RespostaDoWebhook> {
  const resposta = await POST(
    new NextRequest(new URL(caminho, "http://localhost:3000"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  );
  return {
    status: resposta.status,
    corpo: (await resposta.json()) as Record<string, unknown>,
  };
}

/** Evento "messages" do uazapi para o que saiu do celular pareado. */
function doCelular(
  phone: string,
  id: string,
  mensagem: Record<string, unknown> = {},
) {
  return {
    EventType: "messages",
    message: {
      messageid: id,
      chatid: jid(phone),
      fromMe: true,
      messageType: "Conversation",
      text: "Respondido pelo celular",
      messageTimestamp: Date.now(),
      ...mensagem,
    },
  };
}

/** Evento "messages" do uazapi para a mensagem que o PACIENTE enviou. */
function doPaciente(phone: string, id: string, enviadaEm: number = Date.now()) {
  return {
    EventType: "messages",
    message: {
      messageid: id,
      chatid: jid(phone),
      sender_pn: jid(phone),
      fromMe: false,
      messageType: "Conversation",
      text: "Oi, tudo bem?",
      messageTimestamp: enviadaEm,
    },
  };
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("registrar_mensagem_do_celular: a linha", () => {
  it("grava uma linha de saída, pelo celular, custo zero, na conversa aberta do número que enviou", async () => {
    const { x, a, b } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    const conversaB = await conversaNoNumero(x, contactId, b.id);
    const umaHoraAtras = await esperandoHaUmaHora(conversaA);
    await esperandoHaUmaHora(conversaB);

    const { data: antesDoContato } = await admin
      .from("contact")
      .select("last_contact_at, name, phone_e164")
      .eq("id", contactId)
      .single()
      .throwOnError();
    const { data: consentimentoAntes } = await admin
      .from("contact_consent")
      .select("id, active, source")
      .eq("contact_id", contactId)
      .throwOnError();
    const antesDaConversa = await conversa(conversaA);

    const id = waId("pessoa");
    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Pode vir amanhã às 10h",
    });
    expect(resultado).toEqual({
      inserted: true,
      contact_id: contactId,
      conversation_id: conversaA,
      message_id: expect.any(String),
      whatsapp_account_id: a.id,
      automatica: false,
    });

    const linhas = await linhasCom(id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      id: resultado.message_id,
      clinic_id: x,
      conversation_id: conversaA,
      whatsapp_account_id: a.id,
      direction: "saida",
      author: "usuario",
      author_user_id: null,
      pelo_celular: true,
      content_type: "texto",
      body: "Pode vir amanhã às 10h",
      billable: false,
      cost_cents: 0,
      delivery_status: "enviada",
      job_id: null,
      is_internal_note: false,
      // Sem horario no payload: nada a guardar.
      enviada_no_aparelho_em: null,
    });

    // A pessoa da clinica respondeu: a conversa do A sai da espera. A
    // ordem do Inbox (last_inbound_at) e o "por ler" nao mudam; a previa
    // vira a mensagem do celular, com autoria de equipe sem pessoa.
    const depois = await conversa(conversaA);
    expect(depois.awaiting_reply).toBe(false);
    expect(Date.parse(depois.last_inbound_at!)).toBe(Date.parse(umaHoraAtras));
    expect(depois.unread_count).toBe(2);
    expect(depois.status).toBe(antesDaConversa.status);
    expect(depois.last_preview).toBe("Pode vir amanhã às 10h");
    expect(depois.last_preview_author).toBe("usuario");
    expect(depois.last_preview_author_user_id).toBeNull();
    expect(Date.parse(depois.last_message_at!)).toBeGreaterThanOrEqual(
      Date.parse(antesDaConversa.last_message_at!),
    );

    // O mesmo paciente no numero B continua esperando (uma conversa por
    // numero, decisao 1 do dono).
    expect((await conversa(conversaB)).awaiting_reply).toBe(true);

    // Contato e consentimento intactos: a fala da clinica nao e resposta do
    // lead (follow-up) nem relacao nova com o canal.
    const { data: depoisDoContato } = await admin
      .from("contact")
      .select("last_contact_at, name, phone_e164")
      .eq("id", contactId)
      .single()
      .throwOnError();
    expect(depoisDoContato).toEqual(antesDoContato);
    const { data: consentimentoDepois } = await admin
      .from("contact_consent")
      .select("id, active, source")
      .eq("contact_id", contactId)
      .throwOnError();
    expect(consentimentoDepois).toEqual(consentimentoAntes);
  });

  it("documento: nome e tipo saneados como na entrada, legenda vazia vira nula, citação guardada pelo id", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    await conversaNoNumero(x, contactId, a.id);
    const id = waId("documento");
    await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      contentType: "documento",
      body: "   ",
      mediaUrl: "https://mmg.whatsapp.net/arquivo.enc",
      mediaFilename: "pasta/exa\u0001me.pdf",
      mediaMimetype: "Application/PDF; charset=binary",
      quoted: "citada-no-whatsapp",
    });
    const [linha] = await linhasCom(id);
    expect(linha).toMatchObject({
      content_type: "documento",
      body: null,
      media_url: "https://mmg.whatsapp.net/arquivo.enc",
      media_filename: "pastaexame.pdf",
      media_mimetype: "application/pdf",
      reply_to_wa_message_id: "citada-no-whatsapp",
      reply_to_message_id: null,
      pelo_celular: true,
    });
  });
});

describe("registrar_mensagem_do_celular: idempotência", () => {
  it("o mesmo eco 3 vezes em sequência grava 1 linha", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    await conversaNoNumero(x, contactId, a.id);
    const id = waId("tres-vezes");
    const entrada = {
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Confirmado",
    };
    const resultados = [
      await registrado(entrada),
      await registrado(entrada),
      await registrado(entrada),
    ];
    expect(resultados.map((r) => r.inserted)).toEqual([true, false, false]);
    // A reentrega devolve os ids da linha que ja existe, sem decidir nada.
    for (const reentrega of resultados.slice(1)) {
      expect(reentrega).toEqual({
        inserted: false,
        contact_id: contactId,
        conversation_id: resultados[0]!.conversation_id,
        message_id: resultados[0]!.message_id,
        whatsapp_account_id: a.id,
        automatica: null,
      });
    }
    expect(await linhasCom(id)).toHaveLength(1);
  });

  it("entregas simultâneas do mesmo eco: 1 linha, 1 inserted e uma conversa aberta só", async () => {
    const { x, a } = await cenario();
    // Sem conversa aberta: a corrida passa tambem pela criacao da conversa.
    const { contactId, phone } = await paciente(x);
    const id = waId("simultaneas");
    const resultados = await Promise.all(
      Array.from({ length: 6 }, () =>
        registrar({
          clinicId: x,
          accountId: a.id,
          phone,
          waMessageId: id,
          body: "Chego em 10 minutos",
        }),
      ),
    );
    for (const resultado of resultados) {
      expect(resultado.error).toBeNull();
    }
    const dados = resultados.map((r) => r.data!);
    expect(dados.filter((d) => d.inserted)).toHaveLength(1);
    const linhas = await linhasCom(id);
    expect(linhas).toHaveLength(1);
    expect(new Set(dados.map((d) => d.message_id))).toEqual(
      new Set([linhas[0]!.id]),
    );

    const { data: abertas } = await admin
      .from("conversation")
      .select("id")
      .eq("clinic_id", x)
      .eq("contact_id", contactId)
      .eq("whatsapp_account_id", a.id)
      .neq("status", "resolvida")
      .throwOnError();
    expect(abertas).toHaveLength(1);
  });

  it("ecos diferentes simultâneos na mesma conversa: uma linha cada", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    await conversaNoNumero(x, contactId, a.id);
    const ids = Array.from({ length: 5 }, (_, i) => waId(`rajada-${i}`));
    const resultados = await Promise.all(
      ids.map((id) =>
        registrar({
          clinicId: x,
          accountId: a.id,
          phone,
          waMessageId: id,
          body: "Parte da resposta",
        }),
      ),
    );
    for (const resultado of resultados) {
      expect(resultado.error).toBeNull();
      expect(resultado.data!.inserted).toBe(true);
    }
    const { count } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .in("wa_message_id", ids)
      .eq("pelo_celular", true)
      .throwOnError();
    expect(count).toBe(ids.length);
  });
});

describe("registrar_mensagem_do_celular: pessoa, resposta automática e horário", () => {
  it("resposta automática do app Business (paciente 2 s antes do envio): autor sistema e a espera fica", async () => {
    const { x, a } = await cenario();
    const phone = telefone();
    const entrada = await ingerir(x, a.id, phone, waId("paciente-agora"));
    expect((await conversa(entrada.conversation_id)).awaiting_reply).toBe(true);
    const chegadaDoPaciente = await ultimaEntrada(entrada.conversation_id);

    const id = waId("automatica");
    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Olá! Recebemos sua mensagem e já respondemos.",
      enviadaEm: aos(chegadaDoPaciente, 2 * SEGUNDO),
    });
    expect(resultado.inserted).toBe(true);
    expect(resultado.automatica).toBe(true);
    expect(resultado.conversation_id).toBe(entrada.conversation_id);

    const [linha] = await linhasCom(id);
    expect(linha).toMatchObject({
      direction: "saida",
      author: "sistema",
      author_user_id: null,
      pelo_celular: true,
      billable: false,
      cost_cents: 0,
    });
    // Ninguem atendeu: a conversa continua em "Aguardando voce".
    const depois = await conversa(entrada.conversation_id);
    expect(depois.awaiting_reply).toBe(true);
    expect(depois.last_preview_author).toBe("sistema");
  });

  it("paciente que escreveu 30 s DEPOIS do envio: o eco é de pessoa e a pergunta dele segue esperando", async () => {
    const { x, a } = await cenario();
    const phone = telefone();
    const entrada = await ingerir(x, a.id, phone, waId("paciente-30s-depois"));
    const chegadaDoPaciente = await ultimaEntrada(entrada.conversation_id);

    const id = waId("antes-do-paciente");
    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Pode vir às 15h",
      enviadaEm: aos(chegadaDoPaciente, -30 * SEGUNDO),
    });
    expect(resultado).toMatchObject({ inserted: true, automatica: false });
    expect((await linhasCom(id))[0]).toMatchObject({
      author: "usuario",
      author_user_id: null,
      pelo_celular: true,
    });
    // A fala da clinica saiu ANTES da pergunta: a pergunta segue sem
    // resposta. Autoria e espera sao decisoes separadas.
    expect((await conversa(entrada.conversation_id)).awaiting_reply).toBe(true);
  });

  it("janela da automática: o paciente escreveu de 8 s antes a 10 s depois do envio; fora dela, pessoa", async () => {
    const { x, a } = await cenario();
    // As bordas exatas (8 s e 10 s) ficam no ensaio do banco: aqui o
    // last_inbound_at volta em microssegundos e o horario do payload so tem
    // milissegundos.
    const casos = [
      // [apelido, paciente menos envio (ms), automatica, espera depois]
      ["paciente-7s-antes", -7 * SEGUNDO, true, true],
      ["paciente-9s-antes", -9 * SEGUNDO, false, false],
      ["paciente-9s-depois", 9 * SEGUNDO, true, true],
      ["paciente-11s-depois", 11 * SEGUNDO, false, true],
    ] as const;
    for (const [apelido, pacienteMenosEnvio, automatica, espera] of casos) {
      const phone = telefone();
      const entrada = await ingerir(x, a.id, phone, waId(apelido));
      const chegadaDoPaciente = await ultimaEntrada(entrada.conversation_id);
      const id = waId(`eco-${apelido}`);
      const resultado = await registrado({
        clinicId: x,
        accountId: a.id,
        phone,
        waMessageId: id,
        body: "Já te respondo",
        enviadaEm: aos(chegadaDoPaciente, -pacienteMenosEnvio),
      });
      expect(resultado.automatica, apelido).toBe(automatica);
      expect((await linhasCom(id))[0]!.author, apelido).toBe(
        automatica ? "sistema" : "usuario",
      );
      expect(
        (await conversa(entrada.conversation_id)).awaiting_reply,
        apelido,
      ).toBe(espera);
    }
  });

  it("eco atrasado (enviado há 10 minutos) entra na hora de chegada e não vira automática só pelo atraso", async () => {
    const { x, a } = await cenario();
    const phone = telefone();
    // O paciente escreveu agora, depois do envio que chega atrasado.
    const entrada = await ingerir(x, a.id, phone, waId("paciente-depois"));
    const chegadaDoPaciente = await ultimaEntrada(entrada.conversation_id);
    const conversaAntes = await conversa(entrada.conversation_id);

    const enviadaEm = aos(chegadaDoPaciente, -10 * MINUTO);
    const id = waId("atrasado");
    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Mensagem de antes",
      enviadaEm,
    });
    expect(resultado.automatica).toBe(false);
    const [linha] = await linhasCom(id);
    expect(linha!.author).toBe("usuario");
    // created_at e a hora de CHEGADA (now() do banco), a mesma regra da
    // ingestao: o eco chegou depois da mensagem do paciente e fica abaixo
    // dela no fio, nunca 10 minutos acima.
    expect(Date.parse(linha!.created_at)).toBeGreaterThanOrEqual(
      chegadaDoPaciente,
    );
    expect(Date.parse(linha!.created_at)).not.toBe(Date.parse(enviadaEm));
    // O horario do payload fica guardado so para as decisoes de autoria.
    expect(Date.parse(linha!.enviada_no_aparelho_em!)).toBe(
      Date.parse(enviadaEm),
    );

    // A pergunta do paciente veio depois do envio: segue esperando. A
    // previa e a ultima que chegou. last_message_at nao volta no tempo.
    const depois = await conversa(entrada.conversation_id);
    expect(depois.awaiting_reply).toBe(true);
    expect(depois.last_preview_author).toBe("usuario");
    expect(Date.parse(depois.last_message_at!)).toBeGreaterThanOrEqual(
      Date.parse(conversaAntes.last_message_at!),
    );
  });

  it("eco atrasado com o paciente esperando desde antes do envio: pessoa, e a espera desce", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    const umaHoraAtras = await esperandoHaUmaHora(conversaA);

    const id = waId("atrasado-respondendo");
    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Respondendo",
      enviadaEm: aos(Date.parse(umaHoraAtras), 50 * MINUTO),
    });
    expect(resultado).toMatchObject({ inserted: true, automatica: false });
    expect((await conversa(conversaA)).awaiting_reply).toBe(false);
  });

  it("eco recente (menos de 2 minutos) entra na hora de chegada", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    await conversaNoNumero(x, contactId, a.id);
    const enviadaEm = new Date(Date.now() - 30_000).toISOString();
    const id = waId("recente");
    const antes = Date.now();
    await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Agora",
      enviadaEm,
    });
    const [linha] = await linhasCom(id);
    // Hora do banco (now() da transacao), nao a do payload. Folga de 1
    // minuto para relogio da maquina de teste fora de sincronia.
    expect(Date.parse(linha!.created_at)).toBeGreaterThan(antes - MINUTO);
    expect(Date.parse(linha!.created_at)).not.toBe(Date.parse(enviadaEm));
  });
});

describe("registrar_mensagem_do_celular: pelos horários de envio", () => {
  // A mensagem do paciente ganha o horario de envio pela reclassificacao (a
  // chamada que a ingestao faz logo depois de gravar). O horario do eco e
  // montado a partir da chegada que o BANCO gravou, longe dela o bastante
  // para a regra de chegada decidir o contrario: so a regra do envio da o
  // resultado esperado.

  /** Paciente novo: mensagem que chegou agora, enviada em `envio(chegada)`. */
  async function pacienteComEnvio(
    apelido: string,
    envio: (chegada: number) => number,
  ) {
    const { x, a } = await cenario();
    const phone = telefone();
    const entrada = await ingerir(x, a.id, phone, waId(apelido));
    const chegada = await ultimaEntrada(entrada.conversation_id);
    expect(
      await reclassificar(x, entrada.message_id, aos(envio(chegada), 0)),
    ).toBe(0);
    expect(await enviadaNoAparelhoEm(entrada.message_id)).toBe(envio(chegada));
    return { x, a, phone, entrada, chegada };
  }

  it("o paciente enviou 3 s antes do eco (e chegou 2 min depois dele): automática, a espera fica", async () => {
    const eco = (chegada: number) => chegada - 2 * MINUTO;
    const { x, a, phone, entrada, chegada } = await pacienteComEnvio(
      "envio-3s-antes",
      (c) => eco(c) - 3 * SEGUNDO,
    );
    const id = waId("eco-envio-3s-antes");
    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Olá! Recebemos sua mensagem.",
      enviadaEm: aos(eco(chegada), 0),
    });
    expect(resultado).toMatchObject({
      inserted: true,
      automatica: true,
      conversation_id: entrada.conversation_id,
    });
    expect((await linhasCom(id))[0]).toMatchObject({ author: "sistema" });
    expect((await conversa(entrada.conversation_id)).awaiting_reply).toBe(true);
  });

  it("o paciente enviou 20 s antes do eco, mas chegou colado nele: pessoa, e a espera desce", async () => {
    // O eco saiu 1 s antes da chegada do paciente: pela chegada, automatica.
    const eco = (chegada: number) => chegada - SEGUNDO;
    const { x, a, phone, entrada, chegada } = await pacienteComEnvio(
      "envio-20s-antes",
      (c) => eco(c) - 20 * SEGUNDO,
    );
    const id = waId("eco-envio-20s-antes");
    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Pode vir amanhã",
      enviadaEm: aos(eco(chegada), 0),
    });
    expect(resultado).toMatchObject({ inserted: true, automatica: false });
    expect((await linhasCom(id))[0]).toMatchObject({ author: "usuario" });
    expect((await conversa(entrada.conversation_id)).awaiting_reply).toBe(
      false,
    );
  });

  it("o paciente enviou 30 s DEPOIS do eco: pessoa, e a pergunta dele segue esperando", async () => {
    const eco = (chegada: number) => chegada - 2 * MINUTO;
    const { x, a, phone, entrada, chegada } = await pacienteComEnvio(
      "envio-30s-depois",
      (c) => eco(c) + 30 * SEGUNDO,
    );
    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("eco-envio-30s-depois"),
      body: "Pode trazer os exames",
      enviadaEm: aos(eco(chegada), 0),
    });
    expect(resultado).toMatchObject({ inserted: true, automatica: false });
    expect((await conversa(entrada.conversation_id)).awaiting_reply).toBe(true);
  });

  it("a ÚLTIMA mensagem do paciente sem horário: vale a chegada, mesmo com uma anterior enviada colada no eco", async () => {
    const { x, a } = await cenario();
    const phone = telefone();
    const primeira = await ingerir(
      x,
      a.id,
      phone,
      waId("ultima-sem-horario-1"),
    );
    const chegadaDaPrimeira = await ultimaEntrada(primeira.conversation_id);
    const eco = chegadaDaPrimeira - 2 * MINUTO;
    expect(
      await reclassificar(x, primeira.message_id, aos(eco, -3 * SEGUNDO)),
    ).toBe(0);
    // A segunda chega sem horario de envio (nenhuma reclassificacao com ele).
    const segunda = await ingerir(x, a.id, phone, waId("ultima-sem-horario-2"));
    expect(segunda.conversation_id).toBe(primeira.conversation_id);
    expect(await enviadaNoAparelhoEm(segunda.message_id)).toBeNull();

    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("eco-ultima-sem-horario"),
      body: "Já te respondo",
      enviadaEm: aos(eco, 0),
    });
    // Pela chegada: o paciente chegou mais de 2 min depois do envio.
    expect(resultado).toMatchObject({ inserted: true, automatica: false });
    expect((await conversa(primeira.conversation_id)).awaiting_reply).toBe(
      true,
    );
  });

  it("eco sem horário: vale a chegada (o paciente acabou de chegar): automática, sem horário guardado", async () => {
    const { x, a, phone, entrada } = await pacienteComEnvio(
      "eco-sem-horario",
      (c) => c - 20 * SEGUNDO,
    );
    const id = waId("eco-sem-horario-eco");
    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Olá! Recebemos sua mensagem.",
    });
    expect(resultado).toMatchObject({ inserted: true, automatica: true });
    expect((await linhasCom(id))[0]).toMatchObject({
      author: "sistema",
      enviada_no_aparelho_em: null,
    });
    expect((await conversa(entrada.conversation_id)).awaiting_reply).toBe(true);
  });
});

describe("registrar_mensagem_do_celular: o que não grava", () => {
  it("contato que não está no sistema: ignorada, sem criar contato, conversa nem mensagem", async () => {
    const { x, a } = await cenario();
    const phone = telefone();
    const mensagensAntes = await contarMensagensDaClinica(x);
    const { count: conversasAntes } = await admin
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", x)
      .throwOnError();

    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("desconhecido"),
      body: "Oi, aqui é da clínica",
    });
    expect(resultado).toEqual({
      inserted: false,
      ignorada: "contato_desconhecido",
      contact_id: null,
      conversation_id: null,
      message_id: null,
      whatsapp_account_id: a.id,
      automatica: null,
    });

    const { data: contatos } = await admin
      .from("contact")
      .select("id")
      .eq("clinic_id", x)
      .eq("phone_e164", phone)
      .throwOnError();
    expect(contatos).toEqual([]);
    const { count: conversasDepois } = await admin
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", x)
      .throwOnError();
    expect(conversasDepois).toBe(conversasAntes);
    expect(await contarMensagensDaClinica(x)).toBe(mensagensAntes);
  });

  it("número próprio (o A escrevendo para o B, com ou sem o nono dígito): ignorada", async () => {
    const { x, a } = await cenario();
    for (const [apelido, destino] of [
      ["proprio-com-9", "+5584966660002"],
      ["proprio-sem-9", "+558466660002"],
    ] as const) {
      const id = waId(apelido);
      const resultado = await registrado({
        clinicId: x,
        accountId: a.id,
        phone: destino,
        waMessageId: id,
        body: "Teste entre números",
      });
      expect(resultado.ignorada).toBe("numero_proprio");
      expect(resultado.inserted).toBe(false);
      expect(await linhasCom(id)).toEqual([]);
    }
  });

  it("número ATIVO de outra clínica da plataforma: ignorada, sem gravar nem abrir conversa; o contato volta; o id fica com quem recebeu", async () => {
    const { x, a } = await cenario();
    // Uma clinica da plataforma com numero proprio (display_phone como o
    // uazapi grava: so digitos, sem o nono digito). Final unico por rodada:
    // a regra olha os numeros ativos de TODAS as clinicas. O digito depois
    // do 9 fica entre 6 e 9 em todos os testes de plataforma: so assim a
    // chave do telefone trata o numero como celular e casa a forma com e sem
    // o nono digito (91 a 95 seguidos de 7 digitos sao fixo de 8 digitos).
    const outra = await clinica("plataforma");
    const final = String(Date.now()).slice(-7);
    const destino = `+558496${final}`;
    const numeroDaOutra = await criarNumeroDeTeste(admin, outra, {
      display_phone: `55846${final}`,
    });
    // A X cadastrou esse telefone como contato: sem a regra, o eco gravaria
    // nele e tomaria o wa_message_id da mensagem que a outra RECEBEU.
    const { data: contato } = await admin
      .from("contact")
      .insert({ clinic_id: x, phone_e164: destino, name: "Outra clínica" })
      .select("id")
      .single()
      .throwOnError();
    const contatoId = contato!.id as string;

    for (const [apelido, fone] of [
      ["plataforma-com-9", destino],
      ["plataforma-sem-9", `+55846${final}`],
    ] as const) {
      const id = waId(apelido);
      const resultado = await registrado({
        clinicId: x,
        accountId: a.id,
        phone: fone,
        waMessageId: id,
        body: "Oi, aqui é da clínica",
      });
      expect(resultado, apelido).toEqual({
        inserted: false,
        ignorada: "numero_da_plataforma",
        // O contato desta clinica volta para o termo-chave da rota.
        contact_id: contatoId,
        conversation_id: null,
        message_id: null,
        whatsapp_account_id: a.id,
        automatica: null,
      });
      expect(await linhasCom(id), apelido).toEqual([]);
    }
    const { count: conversasDoContato } = await admin
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contatoId)
      .throwOnError();
    expect(conversasDoContato).toBe(0);

    // O eco da X chegou primeiro e foi ignorado; a ingestao da outra, que
    // recebeu a mesma mensagem (o mesmo id), grava normalmente.
    const id = waId("plataforma-recebida");
    expect(
      (
        await registrado({
          clinicId: x,
          accountId: a.id,
          phone: destino,
          waMessageId: id,
          body: "Oi, aqui é da clínica",
        })
      ).ignorada,
    ).toBe("numero_da_plataforma");
    const recebida = await ingerir(
      outra,
      numeroDaOutra.id,
      "+5584966660001",
      id,
    );
    const linhas = await linhasCom(id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      id: recebida.message_id,
      clinic_id: outra,
      direction: "entrada",
      author: "paciente",
      pelo_celular: false,
    });

    // Numero da outra removido: deixa de ser da plataforma, e o eco grava no
    // contato da X.
    await admin
      .rpc("remover_numero", {
        p_clinic_id: outra,
        p_account_id: numeroDaOutra.id,
      })
      .throwOnError();
    const depois = await registrado({
      clinicId: x,
      accountId: a.id,
      phone: destino,
      waMessageId: waId("plataforma-removido"),
      body: "Oi de novo",
    });
    expect(depois).toMatchObject({ inserted: true, contact_id: contatoId });
  });

  it("número da plataforma e colisão: sem linha, a espera da conversa ABERTA daquele número desce; a do outro número e a resolvida ficam; sem contato, nada é criado", async () => {
    const { x, a, b, y, y1 } = await cenario();
    const outra = await clinica("plataforma-espera");
    const final = String(Date.now()).slice(-7);
    const destino = `+558498${final}`;
    await criarNumeroDeTeste(admin, outra, { display_phone: `55848${final}` });
    const finalSemContato = String(Number(final) + 1)
      .padStart(7, "0")
      .slice(-7);
    await criarNumeroDeTeste(admin, outra, {
      nome: "Segundo da plataforma",
      display_phone: `55848${finalSemContato}`,
    });
    const umaHoraAtras = new Date(Date.now() - HORA).toISOString();

    /** Resolvida no A (marcada esperando de proposito), aberta no A e no B. */
    async function tresConversas(contactId: string) {
      const resolvida = await conversaNoNumero(x, contactId, a.id);
      await admin
        .from("conversation")
        .update({
          status: "resolvida",
          awaiting_reply: true,
          last_inbound_at: umaHoraAtras,
        })
        .eq("id", resolvida)
        .throwOnError();
      const abertaA = await conversaNoNumero(x, contactId, a.id);
      const abertaB = await conversaNoNumero(x, contactId, b.id);
      expect(abertaA).not.toBe(resolvida);
      await esperandoHaUmaHora(abertaA);
      await esperandoHaUmaHora(abertaB);
      return { resolvida, abertaA, abertaB };
    }

    async function conferir(
      conversas: Awaited<ReturnType<typeof tresConversas>>,
      rotulo: string,
    ) {
      expect((await conversa(conversas.abertaA)).awaiting_reply, rotulo).toBe(
        false,
      );
      expect((await conversa(conversas.abertaB)).awaiting_reply, rotulo).toBe(
        true,
      );
      expect(await conversa(conversas.resolvida), rotulo).toMatchObject({
        status: "resolvida",
        awaiting_reply: true,
      });
    }

    // Numero da plataforma, com o contato cadastrado na X.
    const { data: contato } = await admin
      .from("contact")
      .insert({ clinic_id: x, phone_e164: destino, name: "Outra clínica" })
      .select("id")
      .single()
      .throwOnError();
    const contatoDaPlataforma = contato!.id as string;
    const daPlataforma = await tresConversas(contatoDaPlataforma);
    const idPlataforma = waId("plataforma-espera");
    expect(
      await registrado({
        clinicId: x,
        accountId: a.id,
        phone: destino,
        waMessageId: idPlataforma,
        body: "Oi, aqui é da clínica",
      }),
    ).toEqual({
      inserted: false,
      ignorada: "numero_da_plataforma",
      contact_id: contatoDaPlataforma,
      conversation_id: null,
      message_id: null,
      whatsapp_account_id: a.id,
      automatica: null,
    });
    expect(await linhasCom(idPlataforma)).toEqual([]);
    await conferir(daPlataforma, "plataforma");

    // Colisao: o id ja entrou na Y como mensagem recebida.
    const { contactId, phone } = await paciente(x);
    const daColisao = await tresConversas(contactId);
    const idColisao = waId("colisao-espera");
    await ingerir(y, y1.id, telefone(), idColisao);
    expect(
      await registrado({
        clinicId: x,
        accountId: a.id,
        phone,
        waMessageId: idColisao,
        body: "Olá",
      }),
    ).toEqual({
      inserted: false,
      ignorada: "colisao_wa_message_id",
      contact_id: contactId,
      conversation_id: null,
      message_id: null,
      whatsapp_account_id: a.id,
      automatica: null,
    });
    expect(await linhasCom(idColisao)).toEqual([
      expect.objectContaining({ clinic_id: y, direction: "entrada" }),
    ]);
    await conferir(daColisao, "colisao");

    // Sem contato na X: contact_id nulo, nenhum contato nem conversa criados.
    const { count: conversasAntes } = await admin
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", x)
      .throwOnError();
    const desconhecido = telefone();
    for (const [rotulo, fone, id, ignorada] of [
      [
        "plataforma",
        `+558498${finalSemContato}`,
        waId("plataforma-sem-contato"),
        "numero_da_plataforma",
      ],
      ["colisao", desconhecido, idColisao, "colisao_wa_message_id"],
    ] as const) {
      const resultado = await registrado({
        clinicId: x,
        accountId: a.id,
        phone: fone,
        waMessageId: id,
        body: "Oi",
      });
      expect(resultado, rotulo).toMatchObject({
        inserted: false,
        ignorada,
        contact_id: null,
      });
      const { data: contatos } = await admin
        .from("contact")
        .select("id")
        .eq("clinic_id", x)
        .eq("phone_e164", fone)
        .throwOnError();
      expect(contatos, rotulo).toEqual([]);
    }
    const { count: conversasDepois } = await admin
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", x)
      .throwOnError();
    expect(conversasDepois).toBe(conversasAntes);
  });

  it("número da plataforma: a pergunta que o paciente fez depois do envio continua esperando", async () => {
    const { x, a } = await cenario();
    const outra = await clinica("plataforma-depois");
    const final = String(Date.now() + 7).slice(-7);
    const destino = `+558499${final}`;
    await criarNumeroDeTeste(admin, outra, { display_phone: `55849${final}` });
    // O paciente (que e o numero da outra clinica) escreveu agora...
    const entrada = await ingerir(
      x,
      a.id,
      destino,
      waId("plataforma-paciente"),
    );
    const chegada = await ultimaEntrada(entrada.conversation_id);
    // ...e o eco tinha saido 1 minuto antes: a pergunta e posterior.
    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone: destino,
      waMessageId: waId("plataforma-depois-do-envio"),
      body: "Oi",
      enviadaEm: aos(chegada, -MINUTO),
    });
    expect(resultado).toMatchObject({
      ignorada: "numero_da_plataforma",
      contact_id: entrada.contact_id,
    });
    expect((await conversa(entrada.conversation_id)).awaiting_reply).toBe(true);
  });

  it("número removido: ignorada, nada gravado", async () => {
    const clinicId = await clinica("removido");
    const numero = await criarNumeroDeTeste(admin, clinicId);
    const { contactId, phone } = await paciente(clinicId);
    await conversaNoNumero(clinicId, contactId, numero.id);
    await admin
      .rpc("remover_numero", {
        p_clinic_id: clinicId,
        p_account_id: numero.id,
      })
      .throwOnError();
    const id = waId("removido");
    const resultado = await registrado({
      clinicId,
      accountId: numero.id,
      phone,
      waMessageId: id,
      body: "Depois da remoção",
    });
    expect(resultado).toMatchObject({
      inserted: false,
      ignorada: "numero_removido",
      whatsapp_account_id: numero.id,
      message_id: null,
    });
    expect(await linhasCom(id)).toEqual([]);
  });

  it("número de outra clínica: erro 23503, nada gravado", async () => {
    const { x, y1 } = await cenario();
    const { phone } = await paciente(x);
    const id = waId("numero-alheio");
    const { error } = await registrar({
      clinicId: x,
      accountId: y1.id,
      phone,
      waMessageId: id,
      body: "Não pode",
    });
    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(await linhasCom(id)).toEqual([]);
  });

  it("wa_message_id que já existe em OUTRA clínica: ignorada, sem nenhum id de lá; o contato desta clínica volta", async () => {
    const { x, a, y, y1 } = await cenario();
    const { contactId, phone } = await paciente(x);
    const id = waId("colisao");
    // A clinica X escreveu do celular para o numero da clinica Y da
    // plataforma: o mesmo id ja entrou la como mensagem do paciente.
    await ingerir(y, y1.id, telefone(), id);

    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Olá",
    });
    expect(resultado).toEqual({
      inserted: false,
      ignorada: "colisao_wa_message_id",
      contact_id: contactId,
      conversation_id: null,
      message_id: null,
      whatsapp_account_id: a.id,
      automatica: null,
    });
    const linhas = await linhasCom(id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      clinic_id: y,
      direction: "entrada",
      author: "paciente",
      pelo_celular: false,
    });
  });

  it("entrada inválida: 22023 (tipo fora da lista, id vazio, número nulo)", async () => {
    const { x, a } = await cenario();
    const { phone } = await paciente(x);
    const base = { clinicId: x, accountId: a.id, phone, body: "x" };
    const tipo = await registrar({
      ...base,
      waMessageId: waId("template"),
      contentType: "template",
    });
    expect(tipo.error?.code).toBe(INVALID_PARAMETER_VALUE);
    const vazio = await registrar({ ...base, waMessageId: "   " });
    expect(vazio.error?.code).toBe(INVALID_PARAMETER_VALUE);
    const semNumero = await admin.rpc("registrar_mensagem_do_celular", {
      p_clinic_id: x,
      p_whatsapp_account_id: null,
      p_phone_e164: phone,
      p_wa_message_id: waId("sem-numero"),
    });
    expect(semNumero.error?.code).toBe(INVALID_PARAMETER_VALUE);
  });
});

describe("registrar_mensagem_do_celular: conversa", () => {
  it("só há conversa resolvida: abre uma nova daquele número, sem reabrir a antiga", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const antiga = await conversaNoNumero(x, contactId, a.id);
    await admin
      .from("conversation")
      .update({ status: "resolvida", awaiting_reply: false })
      .eq("id", antiga)
      .throwOnError();

    const id = waId("depois-de-resolvida");
    const resultado = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Voltando a falar",
    });
    expect(resultado.inserted).toBe(true);
    expect(resultado.conversation_id).not.toBe(antiga);

    const nova = await conversa(resultado.conversation_id!);
    expect(nova).toMatchObject({
      status: "aguardando_humano",
      contact_id: contactId,
      whatsapp_account_id: a.id,
      awaiting_reply: false,
      last_inbound_at: null,
    });
    expect((await conversa(antiga)).status).toBe("resolvida");
    expect((await linhasCom(id))[0]!.conversation_id).toBe(nova.id);
  });
});

describe("adotar_eco_do_envio", () => {
  it("eco do nosso envio gravado antes do id: sobra 1 linha, a do sistema, com o id e o recibo mais avançado", async () => {
    const { x, a, y } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);

    // A linha que o send.ts grava ANTES de chamar o provedor.
    const { data: nossa } = await admin
      .from("message")
      .insert({
        clinic_id: x,
        conversation_id: conversaA,
        direction: "saida",
        author: "sistema",
        content_type: "texto",
        body: "Lembrete da sua consulta",
        delivery_status: "enviando",
        billable: false,
        cost_cents: 0,
      })
      .select("id")
      .single()
      .throwOnError();
    const nossaId = nossa!.id as string;

    // O eco escapou dos filtros e chegou primeiro; o recibo de leitura ja
    // marcou a linha dele.
    const id = waId("eco-do-envio");
    const eco = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Lembrete da sua consulta",
    });
    expect(eco.inserted).toBe(true);
    await admin
      .from("message")
      .update({ delivery_status: "lida" })
      .eq("id", eco.message_id!)
      .throwOnError();

    // O update do send.ts bate no unique.
    const { error: erroDoSend } = await admin
      .from("message")
      .update({ delivery_status: "enviada", wa_message_id: id })
      .eq("id", nossaId);
    expect(erroDoSend?.code).toBe(UNIQUE_VIOLATION);

    // Outra clinica nao adota.
    const deOutra = await admin.rpc("adotar_eco_do_envio", {
      p_clinic_id: y,
      p_message_id: nossaId,
      p_wa_message_id: id,
    });
    expect(deOutra.error).toBeNull();
    expect(deOutra.data).toBe(false);

    const adocao = await admin.rpc("adotar_eco_do_envio", {
      p_clinic_id: x,
      p_message_id: nossaId,
      p_wa_message_id: id,
    });
    expect(adocao.error).toBeNull();
    expect(adocao.data).toBe(true);

    const linhas = await linhasCom(id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      id: nossaId,
      pelo_celular: false,
      author: "sistema",
      delivery_status: "lida",
    });
    const { data: ecoDepois } = await admin
      .from("message")
      .select("id")
      .eq("id", eco.message_id!)
      .throwOnError();
    expect(ecoDepois).toEqual([]);
    expect((await conversa(conversaA)).last_preview).toBe(
      "Lembrete da sua consulta",
    );

    // Repetir a chamada nao muda nada e continua true.
    const repeticao = await admin.rpc("adotar_eco_do_envio", {
      p_clinic_id: x,
      p_message_id: nossaId,
      p_wa_message_id: id,
    });
    expect(repeticao.data).toBe(true);
    expect(await linhasCom(id)).toHaveLength(1);

    // A reentrega do eco agora devolve a linha do sistema, sem gravar outra.
    const reentrega = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Lembrete da sua consulta",
    });
    expect(reentrega).toMatchObject({ inserted: false, message_id: nossaId });
  });

  it("eco de outro número da clínica não é adotado", async () => {
    const { x, a, b } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    await conversaNoNumero(x, contactId, b.id);
    const { data: nossa } = await admin
      .from("message")
      .insert({
        clinic_id: x,
        conversation_id: conversaA,
        direction: "saida",
        author: "sistema",
        content_type: "texto",
        body: "Pelo A",
        delivery_status: "enviando",
        billable: false,
        cost_cents: 0,
      })
      .select("id")
      .single()
      .throwOnError();
    const id = waId("eco-do-b");
    await registrado({
      clinicId: x,
      accountId: b.id,
      phone,
      waMessageId: id,
      body: "Pelo B",
    });
    const { data, error } = await admin.rpc("adotar_eco_do_envio", {
      p_clinic_id: x,
      p_message_id: nossa!.id as string,
      p_wa_message_id: id,
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
    const linhas = await linhasCom(id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      pelo_celular: true,
      whatsapp_account_id: b.id,
    });
  });

  it("o eco abriu uma conversa nova (a nossa foi resolvida no meio do envio): depois da adoção ela fica resolvida, sem atendimento vazio", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    const nossaId = await linhaEnviando(x, conversaA, "sistema");
    await admin
      .from("conversation")
      .update({ status: "resolvida", awaiting_reply: false })
      .eq("id", conversaA)
      .throwOnError();

    const id = waId("eco-abriu-conversa");
    const eco = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Sua consulta é amanhã",
    });
    expect(eco.inserted).toBe(true);
    expect(eco.conversation_id).not.toBe(conversaA);
    expect((await conversa(eco.conversation_id!)).status).not.toBe("resolvida");

    expect(await adotar(x, nossaId, id)).toBe(true);

    // A conversa que o eco abriu ficou sem nenhuma mensagem: resolvida, sem
    // espera e sem previa (senao sobrava na fila um atendimento vazio "Sem
    // atendente").
    expect(await conversa(eco.conversation_id!)).toMatchObject({
      status: "resolvida",
      awaiting_reply: false,
      last_preview: null,
      last_preview_author: null,
    });
    const { count } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", eco.conversation_id!)
      .throwOnError();
    expect(count).toBe(0);
    // A nossa linha ficou com o id, na nossa conversa, que continua resolvida.
    expect(await linhasCom(id)).toEqual([
      expect.objectContaining({ id: nossaId, conversation_id: conversaA }),
    ]);
    expect((await conversa(conversaA)).status).toBe("resolvida");
  });

  it("a conversa aberta pelo eco que tem outra mensagem continua aberta", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    const nossaId = await linhaEnviando(x, conversaA, "sistema");
    await admin
      .from("conversation")
      .update({ status: "resolvida", awaiting_reply: false })
      .eq("id", conversaA)
      .throwOnError();
    const id = waId("eco-abriu-conversa-com-fala");
    const eco = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Sua consulta é amanhã",
    });
    // Depois do eco, a pessoa da clinica escreveu de novo pelo celular.
    const outra = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("fala-depois-do-eco"),
      body: "Qualquer dúvida, estou aqui",
    });
    expect(outra.conversation_id).toBe(eco.conversation_id);

    expect(await adotar(x, nossaId, id)).toBe(true);
    const depois = await conversa(eco.conversation_id!);
    expect(depois.status).not.toBe("resolvida");
    expect(depois.last_preview).toBe("Qualquer dúvida, estou aqui");
  });

  it("envio automático que adota o eco gravado como pessoa devolve a espera que o eco derrubou", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    await esperandoHaUmaHora(conversaA);
    const nossaId = await linhaEnviando(x, conversaA, "sistema");

    const id = waId("eco-pessoa-de-envio-automatico");
    const eco = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: id,
      body: "Sua consulta é amanhã",
    });
    // Escapou dos filtros e foi lido como pessoa: derrubou a espera.
    expect(eco).toMatchObject({ inserted: true, automatica: false });
    expect((await conversa(conversaA)).awaiting_reply).toBe(false);

    expect(await adotar(x, nossaId, id)).toBe(true);
    // O envio era da regua (sistema), que de proposito nao derruba: a
    // pergunta do paciente volta para "Aguardando voce".
    expect((await conversa(conversaA)).awaiting_reply).toBe(true);
  });

  it("com fala humana depois do paciente, ou com envio de pessoa, a adoção não devolve a espera", async () => {
    const { x, a } = await cenario();

    // A IA respondeu o paciente antes do envio automatico.
    const comIa = await paciente(x);
    const conversaIa = await conversaNoNumero(x, comIa.contactId, a.id);
    await esperandoHaUmaHora(conversaIa);
    await admin
      .from("message")
      .insert({
        clinic_id: x,
        conversation_id: conversaIa,
        direction: "saida",
        author: "ia",
        content_type: "texto",
        body: "Temos horário amanhã",
        delivery_status: "enviada",
        billable: false,
        cost_cents: 0,
      })
      .throwOnError();
    await admin
      .from("conversation")
      .update({ awaiting_reply: false })
      .eq("id", conversaIa)
      .throwOnError();
    const nossaIa = await linhaEnviando(x, conversaIa, "sistema");
    const idIa = waId("eco-com-fala-da-ia");
    await registrado({
      clinicId: x,
      accountId: a.id,
      phone: comIa.phone,
      waMessageId: idIa,
      body: "Sua consulta é amanhã",
    });
    expect(await adotar(x, nossaIa, idIa)).toBe(true);
    expect((await conversa(conversaIa)).awaiting_reply).toBe(false);

    // O envio adotado e de pessoa (Atendimento): quem derruba a espera e o
    // proprio send.ts, nunca a adocao.
    const dePessoa = await paciente(x);
    const conversaPessoa = await conversaNoNumero(x, dePessoa.contactId, a.id);
    await esperandoHaUmaHora(conversaPessoa);
    const nossaPessoa = await linhaEnviando(x, conversaPessoa, "usuario");
    const idPessoa = waId("eco-de-envio-de-pessoa");
    await registrado({
      clinicId: x,
      accountId: a.id,
      phone: dePessoa.phone,
      waMessageId: idPessoa,
      body: "Sua consulta é amanhã",
    });
    expect(await adotar(x, nossaPessoa, idPessoa)).toBe(true);
    expect((await conversa(conversaPessoa)).awaiting_reply).toBe(false);
  });
});

describe("reclassificar_resposta_automatica", () => {
  it("o eco de pessoa que chegou até 8 s antes da mensagem do paciente vira sistema; o de 20 s antes, não", async () => {
    const { x, a, y } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    await esperandoHaUmaHora(conversaA);

    // Os dois ecos chegaram ANTES da mensagem do paciente: gravados como
    // pessoa (o paciente tinha escrito ha uma hora).
    const ausencia = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("reclassifica-ausencia"),
      body: "Estamos fora do horário",
    });
    const antiga = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("reclassifica-antiga"),
      body: "Pode trazer os exames",
    });
    expect([ausencia.automatica, antiga.automatica]).toEqual([false, false]);

    const entrada = await ingerir(
      x,
      a.id,
      phone,
      waId("reclassifica-paciente"),
    );
    expect(entrada.conversation_id).toBe(conversaA);
    // Horarios de chegada pelo relogio do banco: a ausencia 3 s antes da
    // mensagem do paciente, a outra fala 20 s antes.
    const chegadaDaEntrada = await criadaEm(entrada.message_id);
    await chegouEm(ausencia.message_id!, chegadaDaEntrada - 3 * SEGUNDO);
    await chegouEm(antiga.message_id!, chegadaDaEntrada - 20 * SEGUNDO);

    // Outra clinica, linha que nao e do paciente: 0, nada muda.
    expect(await reclassificar(y, entrada.message_id)).toBe(0);
    expect(await reclassificar(x, ausencia.message_id!)).toBe(0);
    expect(await autorDe(ausencia.message_id!)).toBe("usuario");

    expect(await reclassificar(x, entrada.message_id)).toBe(1);
    expect(await autorDe(ausencia.message_id!)).toBe("sistema");
    expect(await autorDe(antiga.message_id!)).toBe("usuario");
    // A espera e da ingestao (que a levantou), nao daqui.
    expect((await conversa(conversaA)).awaiting_reply).toBe(true);

    // Repetir nao muda mais nada.
    expect(await reclassificar(x, entrada.message_id)).toBe(0);
  });

  it("entrada vazia: 22023", async () => {
    const { x } = await cenario();
    const semMensagem = await admin.rpc("reclassificar_resposta_automatica", {
      p_clinic_id: x,
      p_message_id: null as unknown as string,
    });
    expect(semMensagem.error?.code).toBe(INVALID_PARAMETER_VALUE);
  });

  it("com o horário do paciente: grava na linha dele (sem sobrescrever) e troca só o eco que SAIU depois dele, até 2 s depois da chegada", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    await esperandoHaUmaHora(conversaA);
    // O paciente enviou 1 minuto atras (relogio desta maquina: so a
    // diferenca entre os horarios de envio importa).
    const envioDoPaciente = Date.now() - MINUTO;

    // Ecos de pessoa que chegaram antes da mensagem do paciente.
    const ausencia = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("reclass-envio-ausencia"),
      body: "Estamos fora do horário",
      enviadaEm: aos(envioDoPaciente, SEGUNDO),
    });
    const antes = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("reclass-envio-antes"),
      body: "Pode trazer os exames",
      enviadaEm: aos(envioDoPaciente, -3 * SEGUNDO),
    });
    expect([ausencia.automatica, antes.automatica]).toEqual([false, false]);

    const entrada = await ingerir(
      x,
      a.id,
      phone,
      waId("reclass-envio-paciente"),
    );
    expect(await enviadaNoAparelhoEm(entrada.message_id)).toBeNull();
    // Chegadas pelo relogio do banco: a ausencia 1,5 s DEPOIS da entrada (a
    // corrida das transacoes), a outra fala 1 s antes.
    const chegadaDaEntrada = await criadaEm(entrada.message_id);
    await chegouEm(ausencia.message_id!, chegadaDaEntrada + 1500);
    await chegouEm(antes.message_id!, chegadaDaEntrada - SEGUNDO);

    expect(
      await reclassificar(x, entrada.message_id, aos(envioDoPaciente, 0)),
    ).toBe(1);
    expect(await enviadaNoAparelhoEm(entrada.message_id)).toBe(envioDoPaciente);
    expect(await autorDe(ausencia.message_id!)).toBe("sistema");
    // Saiu 3 s ANTES do paciente: e fala da equipe, mesmo chegando colada.
    expect(await autorDe(antes.message_id!)).toBe("usuario");
    expect((await conversa(conversaA)).awaiting_reply).toBe(true);

    // Outra chamada com outro horario nao sobrescreve o gravado.
    expect(
      await reclassificar(x, entrada.message_id, aos(envioDoPaciente, MINUTO)),
    ).toBe(0);
    expect(await enviadaNoAparelhoEm(entrada.message_id)).toBe(envioDoPaciente);
  });

  it("horário implausível (8 dias atrás ou 2 min à frente) não é gravado; sem ele, só a chegada decide", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    await esperandoHaUmaHora(conversaA);
    const eco = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("reclass-implausivel-eco"),
      body: "Estamos fora do horário",
      enviadaEm: new Date(Date.now() - 30 * MINUTO).toISOString(),
    });
    const entrada = await ingerir(
      x,
      a.id,
      phone,
      waId("reclass-implausivel-paciente"),
    );
    await chegouEm(
      eco.message_id!,
      (await criadaEm(entrada.message_id)) - SEGUNDO,
    );

    expect(
      await reclassificar(
        x,
        entrada.message_id,
        new Date(Date.now() + 2 * MINUTO).toISOString(),
      ),
    ).toBe(1);
    expect(await enviadaNoAparelhoEm(entrada.message_id)).toBeNull();
    expect(await autorDe(eco.message_id!)).toBe("sistema");
    expect(
      await reclassificar(
        x,
        entrada.message_id,
        new Date(Date.now() - 8 * 24 * HORA).toISOString(),
      ),
    ).toBe(0);
    expect(await enviadaNoAparelhoEm(entrada.message_id)).toBeNull();
  });

  it("outra clínica não grava o horário na mensagem do paciente", async () => {
    const { x, a, y } = await cenario();
    const entrada = await ingerir(x, a.id, telefone(), waId("reclass-alheia"));
    expect(
      await reclassificar(y, entrada.message_id, new Date().toISOString()),
    ).toBe(0);
    expect(await enviadaNoAparelhoEm(entrada.message_id)).toBeNull();
  });
});

describe("rajada de reconexão (a fala da equipe das 10:00 e a mensagem do paciente das 10:03 chegam juntas)", () => {
  const minutosAtras = (minutos: number) => Date.now() - minutos * MINUTO;

  it("ecos primeiro: a fala de pessoa continua de pessoa, só a ausência (enviada 1 s depois do paciente) vira sistema", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    await esperandoHaUmaHora(conversaA);
    const envioDaEquipe = minutosAtras(30);
    const envioDoPaciente = envioDaEquipe + 3 * MINUTO;

    const fala = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("rajada-fala"),
      body: "Pode vir amanhã às 10h",
      enviadaEm: aos(envioDaEquipe, 0),
    });
    const ausencia = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("rajada-ausencia"),
      body: "Estamos fora do horário",
      enviadaEm: aos(envioDoPaciente, SEGUNDO),
    });
    const entrada = await ingerir(x, a.id, phone, waId("rajada-paciente"));
    // Chegaram juntos: as duas falas 1 s antes da entrada (relogio do banco).
    const chegada = await criadaEm(entrada.message_id);
    await chegouEm(fala.message_id!, chegada - SEGUNDO);
    await chegouEm(ausencia.message_id!, chegada - SEGUNDO);

    expect(
      await reclassificar(x, entrada.message_id, aos(envioDoPaciente, 0)),
    ).toBe(1);
    expect(await autorDe(fala.message_id!)).toBe("usuario");
    expect(await autorDe(ausencia.message_id!)).toBe("sistema");
    // O paciente escreveu depois da fala: a conversa espera resposta.
    expect((await conversa(conversaA)).awaiting_reply).toBe(true);
  });

  it("paciente primeiro: a fala das 10:00 é de pessoa e NÃO derruba a espera; a ausência é automática pelo envio", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    await esperandoHaUmaHora(conversaA);
    const envioDaEquipe = minutosAtras(30);
    const envioDoPaciente = envioDaEquipe + 3 * MINUTO;

    const entrada = await ingerir(x, a.id, phone, waId("rajada2-paciente"));
    expect(
      await reclassificar(x, entrada.message_id, aos(envioDoPaciente, 0)),
    ).toBe(0);

    const fala = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("rajada2-fala"),
      body: "Pode vir amanhã às 10h",
      enviadaEm: aos(envioDaEquipe, 0),
    });
    expect(fala).toMatchObject({ inserted: true, automatica: false });
    expect((await conversa(conversaA)).awaiting_reply).toBe(true);

    const ausencia = await registrado({
      clinicId: x,
      accountId: a.id,
      phone,
      waMessageId: waId("rajada2-ausencia"),
      body: "Estamos fora do horário",
      enviadaEm: aos(envioDoPaciente, SEGUNDO),
    });
    expect(ausencia).toMatchObject({ inserted: true, automatica: true });
    expect((await conversa(conversaA)).awaiting_reply).toBe(true);

    // A reclassificacao repetida nao troca a fala colada na entrada.
    await chegouEm(
      fala.message_id!,
      (await criadaEm(entrada.message_id)) + SEGUNDO,
    );
    expect(
      await reclassificar(x, entrada.message_id, aos(envioDoPaciente, 0)),
    ).toBe(0);
    expect(await autorDe(fala.message_id!)).toBe("usuario");
  });
});

describe("message_pelo_celular_coerente", () => {
  it("nem o service role grava pelo_celular incoerente; a linha coerente passa", async () => {
    const { x, a } = await cenario();
    const { contactId } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    const base = {
      clinic_id: x,
      conversation_id: conversaA,
      content_type: "texto",
      body: "Forjada",
      billable: false,
      cost_cents: 0,
      pelo_celular: true,
    };
    const incoerentes = [
      { ...base, direction: "entrada", author: "paciente" },
      { ...base, direction: "saida", author: "ia" },
      {
        ...base,
        direction: "saida",
        author: "sistema",
        content_type: "evento",
      },
      {
        ...base,
        direction: "saida",
        author: "usuario",
        is_internal_note: true,
      },
      {
        ...base,
        direction: "saida",
        author: "usuario",
        content_type: "template",
      },
    ];
    for (const linha of incoerentes) {
      const { error } = await admin.from("message").insert(linha);
      expect(error?.code, JSON.stringify({ ...linha, body: undefined })).toBe(
        CHECK_VIOLATION,
      );
    }

    // Positivo: a forma que a RPC grava.
    const { error } = await admin
      .from("message")
      .insert({ ...base, direction: "saida", author: "usuario" });
    expect(error).toBeNull();

    // E uma linha comum nao vira "do celular" depois.
    const { data: comum } = await admin
      .from("message")
      .insert({
        ...base,
        pelo_celular: false,
        direction: "entrada",
        author: "paciente",
      })
      .select("id")
      .single()
      .throwOnError();
    const { error: erroUpdate } = await admin
      .from("message")
      .update({ pelo_celular: true })
      .eq("id", comum!.id as string);
    expect(erroUpdate?.code).toBe(CHECK_VIOLATION);
  });
});

describe("pela rota do webhook (payload do uazapi)", () => {
  it("texto enviado pelo celular vira linha na conversa do número da URL e tira da espera", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    await esperandoHaUmaHora(conversaA);
    const id = waId("rota-texto");

    const { status, corpo } = await postar(
      caminhoDoWebhook(a),
      doCelular(phone, id, { text: "  Pode sim, te espero  " }),
    );
    expect(status).toBe(200);
    expect(corpo).toMatchObject({
      inserted: true,
      contact_id: contactId,
      conversation_id: conversaA,
      whatsapp_account_id: a.id,
      automatica: false,
    });
    const linhas = await linhasCom(id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      conversation_id: conversaA,
      direction: "saida",
      author: "usuario",
      author_user_id: null,
      pelo_celular: true,
      body: "Pode sim, te espero",
      billable: false,
      cost_cents: 0,
      delivery_status: "enviada",
    });
    expect((await conversa(conversaA)).awaiting_reply).toBe(false);

    // Reentrega do provedor: 200 e nenhuma linha a mais.
    const reentrega = await postar(
      caminhoDoWebhook(a),
      doCelular(phone, id, { text: "  Pode sim, te espero  " }),
    );
    expect(reentrega.status).toBe(200);
    expect(reentrega.corpo).toMatchObject({ inserted: false });
    expect(await linhasCom(id)).toHaveLength(1);
  });

  it("imagem enviada pelo celular: linha de imagem e o download vira job do número", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    await conversaNoNumero(x, contactId, a.id);
    const id = waId("rota-imagem");

    const { status, corpo } = await postar(
      caminhoDoWebhook(a),
      doCelular(phone, id, {
        messageType: "ImageMessage",
        mediaType: "image",
        text: "",
        content: {
          URL: "https://mmg.whatsapp.net/teste-do-celular.enc",
          mimetype: "image/jpeg",
        },
      }),
    );
    expect(status).toBe(200);
    expect(corpo.inserted).toBe(true);
    const [linha] = await linhasCom(id);
    expect(linha).toMatchObject({
      content_type: "imagem",
      body: null,
      media_url: "https://mmg.whatsapp.net/teste-do-celular.enc",
      media_mimetype: "image/jpeg",
      pelo_celular: true,
    });

    const { data: jobs } = await admin
      .from("job_queue")
      .select("kind, whatsapp_account_id, payload")
      .eq("clinic_id", x)
      .eq("kind", "baixar_midia")
      .eq("payload->>message_id", linha!.id)
      .throwOnError();
    expect(jobs).toHaveLength(1);
    expect(jobs![0]).toMatchObject({
      whatsapp_account_id: a.id,
      payload: { message_id: linha!.id, wa_message_id: id },
    });
  });

  it("citação feita no celular aponta para a mensagem do paciente", async () => {
    const { x, a } = await cenario();
    const phone = telefone();
    const citada = waId("rota-citada");
    const entrada = await ingerir(x, a.id, phone, citada);
    const id = waId("rota-citando");

    const { status } = await postar(
      caminhoDoWebhook(a),
      doCelular(phone, id, { text: "Sobre isso, sim", quoted: citada }),
    );
    expect(status).toBe(200);
    const [linha] = await linhasCom(id);
    expect(linha).toMatchObject({
      reply_to_wa_message_id: citada,
      reply_to_message_id: entrada.message_id,
      conversation_id: entrada.conversation_id,
    });
  });

  it("contato desconhecido: 200 com o motivo, nada gravado", async () => {
    const { x, a } = await cenario();
    const id = waId("rota-desconhecido");
    const mensagensAntes = await contarMensagensDaClinica(x);
    const { status, corpo } = await postar(
      caminhoDoWebhook(a),
      doCelular(telefone(), id),
    );
    expect(status).toBe(200);
    expect(corpo).toMatchObject({
      inserted: false,
      ignorada: "contato_desconhecido",
    });
    expect(await linhasCom(id)).toEqual([]);
    expect(await contarMensagensDaClinica(x)).toBe(mensagensAntes);
  });

  it("eco com a nossa marca de rastreio (envio do sistema) não vira linha", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    await esperandoHaUmaHora(conversaA);
    const id = waId("rota-rastreio");

    const { status } = await postar(
      caminhoDoWebhook(a),
      doCelular(phone, id, {
        track_source: ORIGEM_DO_RASTREIO,
        track_id: crypto.randomUUID(),
      }),
    );
    expect(status).toBe(200);
    expect(await linhasCom(id)).toEqual([]);
    // O envio do sistema ja cuida da espera; o eco nao mexe em nada.
    expect((await conversa(conversaA)).awaiting_reply).toBe(true);
  });

  it("a ausência do app Business que chega ANTES da mensagem do paciente vira sistema quando ela chega", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    await esperandoHaUmaHora(conversaA);

    // Os dois webhooks correm em paralelo; o eco ganhou a corrida. Sem a
    // mensagem nova do paciente, ele e lido como pessoa e derruba a espera.
    // A ausencia sai do aparelho 1 s depois da mensagem do paciente.
    const envioDoPaciente = Date.now();
    const ecoId = waId("rota-ausencia");
    const eco = await postar(
      caminhoDoWebhook(a),
      doCelular(phone, ecoId, {
        text: "Estamos fora do horário",
        messageTimestamp: envioDoPaciente + SEGUNDO,
      }),
    );
    expect(eco.status).toBe(200);
    expect(eco.corpo).toMatchObject({ inserted: true, automatica: false });
    expect((await linhasCom(ecoId))[0]).toMatchObject({ author: "usuario" });
    expect((await conversa(conversaA)).awaiting_reply).toBe(false);

    // A mensagem do paciente chega logo depois (bem dentro dos 8 s), pela
    // mesma rota: a ingestao corrige o eco antes de devolver.
    const entradaId = waId("rota-paciente-depois-do-eco");
    const entrada = await postar(
      caminhoDoWebhook(a),
      doPaciente(phone, entradaId, envioDoPaciente),
    );
    expect(entrada.status).toBe(200);
    expect(entrada.corpo).toMatchObject({
      inserted: true,
      conversation_id: conversaA,
    });
    expect((await linhasCom(ecoId))[0]).toMatchObject({
      author: "sistema",
      author_user_id: null,
      pelo_celular: true,
    });
    const depois = await conversa(conversaA);
    expect(depois.awaiting_reply).toBe(true);
    expect(depois.last_preview_author).toBe("paciente");
  });

  it("a fala de pessoa que chegou mais de 8 s antes da mensagem do paciente continua pessoa", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    await esperandoHaUmaHora(conversaA);

    const ecoId = waId("rota-fala-antiga");
    const eco = await postar(
      caminhoDoWebhook(a),
      doCelular(phone, ecoId, { text: "Pode trazer os exames" }),
    );
    expect(eco.corpo).toMatchObject({ inserted: true, automatica: false });
    // Recua a chegada do eco 20 s pelo relogio do banco (o que o teste nao
    // pode esperar de verdade).
    const [linha] = await linhasCom(ecoId);
    await chegouEm(linha!.id, Date.parse(linha!.created_at) - 20 * SEGUNDO);

    const entrada = await postar(
      caminhoDoWebhook(a),
      doPaciente(phone, waId("rota-paciente-bem-depois")),
    );
    expect(entrada.status).toBe(200);
    expect(entrada.corpo).toMatchObject({ inserted: true });
    expect(await autorDe(linha!.id)).toBe("usuario");
  });

  it("a ingestão grava o horário de envio do paciente (enviada_no_aparelho_em)", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    await conversaNoNumero(x, contactId, a.id);
    const enviadaEm = Date.now() - 5 * SEGUNDO;
    const id = waId("rota-horario-do-paciente");
    const { status, corpo } = await postar(
      caminhoDoWebhook(a),
      doPaciente(phone, id, enviadaEm),
    );
    expect(status).toBe(200);
    expect(corpo).toMatchObject({ inserted: true });
    const [linha] = await linhasCom(id);
    expect(Date.parse(linha!.enviada_no_aparelho_em!)).toBe(enviadaEm);
  });

  it("rajada de reconexão: a fala de pessoa enviada 3 min antes do paciente, chegando colada na mensagem dele, continua de pessoa", async () => {
    const { x, a } = await cenario();
    const { contactId, phone } = await paciente(x);
    const conversaA = await conversaNoNumero(x, contactId, a.id);
    await esperandoHaUmaHora(conversaA);
    const envioDoPaciente = Date.now() - 27 * MINUTO;

    const ecoId = waId("rota-rajada-fala");
    const eco = await postar(
      caminhoDoWebhook(a),
      doCelular(phone, ecoId, {
        text: "Pode vir amanhã às 10h",
        messageTimestamp: envioDoPaciente - 3 * MINUTO,
      }),
    );
    expect(eco.corpo).toMatchObject({ inserted: true, automatica: false });

    const entrada = await postar(
      caminhoDoWebhook(a),
      doPaciente(phone, waId("rota-rajada-paciente"), envioDoPaciente),
    );
    expect(entrada.status).toBe(200);
    expect(entrada.corpo).toMatchObject({ inserted: true });
    const [linha] = await linhasCom(ecoId);
    expect(linha!.author).toBe("usuario");
    expect((await conversa(conversaA)).awaiting_reply).toBe(true);
  });

  it("número da plataforma pela rota: 200 com o contato, sem linha, e a conversa aberta daquele número sai da espera", async () => {
    const { x, a } = await cenario();
    const outra = await clinica("plataforma-rota");
    const final = String(Date.now() + 13).slice(-7);
    const destino = `+558496${final}`;
    await criarNumeroDeTeste(admin, outra, { display_phone: `55846${final}` });
    const { data: contato } = await admin
      .from("contact")
      .insert({ clinic_id: x, phone_e164: destino, name: "Outra clínica" })
      .select("id")
      .single()
      .throwOnError();
    const contatoId = contato!.id as string;
    const conversaA = await conversaNoNumero(x, contatoId, a.id);
    await esperandoHaUmaHora(conversaA);
    const id = waId("rota-plataforma");

    const { status, corpo } = await postar(
      caminhoDoWebhook(a),
      doCelular(destino, id, { text: "Oi, aqui é da clínica" }),
    );
    expect(status).toBe(200);
    expect(corpo).toMatchObject({
      inserted: false,
      ignorada: "numero_da_plataforma",
      contact_id: contatoId,
      message_id: null,
    });
    expect(await linhasCom(id)).toEqual([]);
    expect((await conversa(conversaA)).awaiting_reply).toBe(false);
  });
});
