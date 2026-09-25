import { NextRequest } from "next/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { POST } from "@/app/api/webhooks/whatsapp/route";
import {
  FakeProvider,
  fakeDeletedMessages,
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  carregarInstancia,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";
import {
  MIDIA_BUCKET,
  executarJobComPosse,
  garantirBucketDeMidia,
  type Job,
} from "@/lib/jobs/worker";
import {
  caminhoDoWebhook,
  criarNumeroDeTeste,
  type NumeroDeTeste,
  type OpcoesDoNumeroDeTeste,
} from "../rls/numeros";
import { adminClient, stackCredentials } from "../rls/stack";

// Varios numeros de WhatsApp por clinica, FASE 2 (o codigo por numero),
// contra o banco REAL. Desenho em docs/07_multiplos_numeros_whatsapp.md.
//
// O que se prova aqui e que tudo o que um evento ou um envio toca pertence a
// UM numero (whatsapp_account.id): o webhook descobre o numero pela URL (a
// nova, com ?account=, e a legada, pelo segredo), e a conversa, o eco do
// celular, o recibo, o apagamento, a midia, o status e o envio seguem esse
// numero. Tudo pelas portas reais: o handler do webhook (POST da rota), o
// executor da fila (executarJobComPosse, com o claim feito a mao so para o
// job do teste) e o orquestrador de envio.
//
// NESTA FASE o unique temporario whatsapp_account_uma_por_clinica ainda
// impede o segundo numero numa clinica. O que vale com UM numero e testado
// agora, e o "outro numero" dos casos negativos e o de outra clinica. Os
// casos que exigem dois numeros na MESMA clinica ficam em it.skip, prontos,
// e ativam na Fase 3 (quando o unique sai).
//
// Clinicas e_de_teste: o motor de producao as ignora, entao nenhum job
// enfileirado aqui sai sozinho. Provedor 'fake' em todo numero: nenhum teste
// encosta no WhatsApp real.

// A rota cria o admin client pelo ambiente; fora do Next ele nao vem
// carregado.
const credenciais = stackCredentials();
process.env.NEXT_PUBLIC_SUPABASE_URL ??= credenciais.url;
process.env.SUPABASE_SERVICE_ROLE_KEY ??= credenciais.serviceRoleKey;

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];
const arquivosCriados: string[] = [];

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const AMANHA = () => new Date(Date.now() + 24 * HORA).toISOString();
const JANELA_ABERTA = {
  send_window_start: "00:00",
  send_window_end: "23:59",
  send_weekdays: [0, 1, 2, 3, 4, 5, 6],
};

let sequencia = 0;
function telefone(): string {
  sequencia += 1;
  return `+55849783${String(sequencia).padStart(5, "0")}`;
}

/** O chatid do WhatsApp para um telefone E.164. */
function jid(phone: string): string {
  return `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
}

type Clinica = { clinicId: string; numero: NumeroDeTeste };

async function clinicaComNumero(
  nome: string,
  opcoes: OpcoesDoNumeroDeTeste = {},
): Promise<Clinica> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Numeros F2 ${nome} ${sufixo}`,
      slug: `num-f2-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  const numero = await criarNumeroDeTeste(admin, clinicId, opcoes);
  return { clinicId, numero };
}

async function contatoComConsentimento(
  clinicId: string,
  phone: string,
  campos: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: phone,
      name: "Paciente",
      ...campos,
    })
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
  return contactId;
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

/** Mensagem de SAIDA ja enviada por aquele numero (herda o numero da conversa). */
async function mensagemEnviada(
  clinicId: string,
  conversationId: string,
  waMessageId: string,
): Promise<string> {
  const { data } = await admin
    .from("message")
    .insert({
      clinic_id: clinicId,
      conversation_id: conversationId,
      wa_message_id: waMessageId,
      direction: "saida",
      author: "usuario",
      content_type: "texto",
      body: "Mensagem de teste",
      delivery_status: "enviada",
      billable: false,
      cost_cents: 0,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
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

/** Evento canonico de mensagem recebida (provedor falso e simulador). */
function recebida(
  phone: string,
  waMessageId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    kind: "message_received",
    phone,
    name: "Paciente",
    waMessageId,
    contentType: "texto",
    body: "Oi, tudo bem?",
    ...extra,
  };
}

async function numeroDaConversa(
  conversationId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("conversation")
    .select("whatsapp_account_id")
    .eq("id", conversationId)
    .single()
    .throwOnError();
  return (data!.whatsapp_account_id as string | null) ?? null;
}

async function mensagensComWaId(waMessageId: string) {
  const { data } = await admin
    .from("message")
    .select("id, whatsapp_account_id, delivery_status, deleted_at")
    .eq("wa_message_id", waMessageId)
    .throwOnError();
  return (data ?? []) as {
    id: string;
    whatsapp_account_id: string | null;
    delivery_status: string | null;
    deleted_at: string | null;
  }[];
}

/**
 * O claim que o motor faria, SO para este job (claim_jobs pegaria jobs de
 * outras clinicas): executando, com posse e uma tentativa a mais. Devolve a
 * linha no formato que o executor recebe.
 */
async function reivindicar(jobId: string, workerId: string): Promise<Job> {
  const { data: atual } = await admin
    .from("job_queue")
    .select("attempts")
    .eq("id", jobId)
    .single()
    .throwOnError();
  const { data } = await admin
    .from("job_queue")
    .update({
      status: "executando",
      locked_by: workerId,
      locked_at: new Date().toISOString(),
      attempts: (atual!.attempts as number) + 1,
    })
    .eq("id", jobId)
    .eq("status", "pendente")
    .select(
      "id, clinic_id, kind, payload, attempts, max_attempts, whatsapp_account_id",
    )
    .single()
    .throwOnError();
  return data as unknown as Job;
}

beforeAll(async () => {
  await garantirBucketDeMidia(admin);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (arquivosCriados.length > 0) {
    await admin.storage.from(MIDIA_BUCKET).remove(arquivosCriados);
  }
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("webhook: qual número está chamando", () => {
  it("a URL nova entrega a mensagem no número que ela nomeia", async () => {
    const { numero } = await clinicaComNumero("url-nova");
    const waId = `num2:${sufixo}:url-nova`;
    const { status, corpo } = await postar(
      caminhoDoWebhook(numero),
      recebida(telefone(), waId),
    );
    expect(status).toBe(200);
    expect(corpo.inserted).toBe(true);
    expect(corpo.whatsapp_account_id).toBe(numero.id);
    expect(await numeroDaConversa(corpo.conversation_id as string)).toBe(
      numero.id,
    );
    expect((await mensagensComWaId(waId))[0]?.whatsapp_account_id).toBe(
      numero.id,
    );
  });

  it("a URL legada (sem o número) acha o número pelo segredo e entrega nele", async () => {
    const { numero } = await clinicaComNumero("url-legada");
    const waId = `num2:${sufixo}:url-legada`;
    const { status, corpo } = await postar(
      caminhoDoWebhook(numero, { legado: true }),
      recebida(telefone(), waId),
    );
    expect(status).toBe(200);
    expect(corpo.inserted).toBe(true);
    expect(corpo.whatsapp_account_id).toBe(numero.id);
    expect(await numeroDaConversa(corpo.conversation_id as string)).toBe(
      numero.id,
    );
  });

  it("segredo errado é 401 nos dois formatos, e nada é gravado", async () => {
    const { numero } = await clinicaComNumero("segredo-errado");
    const waId = `num2:${sufixo}:segredo-errado`;
    const nova = await postar(
      caminhoDoWebhook(numero, { segredo: "errado" }),
      recebida(telefone(), waId),
    );
    expect(nova.status).toBe(401);
    const legada = await postar(
      caminhoDoWebhook(numero, { legado: true, segredo: "errado" }),
      recebida(telefone(), waId),
    );
    expect(legada.status).toBe(401);
    expect(await mensagensComWaId(waId)).toHaveLength(0);
  });

  it("número de outra clínica na URL é 401, mesmo com o segredo dele", async () => {
    const { clinicId } = await clinicaComNumero("dona-da-url");
    const { numero: deFora } = await clinicaComNumero("numero-de-fora");
    const waId = `num2:${sufixo}:de-fora`;
    const { status } = await postar(
      caminhoDoWebhook({ ...deFora, clinicId }),
      recebida(telefone(), waId),
    );
    expect(status).toBe(401);
    expect(await mensagensComWaId(waId)).toHaveLength(0);
  });

  it("token da instância trocado é 401; o token daquele número passa", async () => {
    const { numero } = await clinicaComNumero("token", {
      instance_token: `tok-certo-${sufixo}`,
    });
    const phone = telefone();
    const eventoUazapi = (token: string | undefined, waId: string) => ({
      EventType: "messages",
      ...(token === undefined ? {} : { token }),
      message: {
        messageid: waId,
        chatid: jid(phone),
        sender_pn: jid(phone),
        fromMe: false,
        messageType: "Conversation",
        text: "Oi",
      },
    });

    const trocado = await postar(
      caminhoDoWebhook(numero),
      eventoUazapi(`tok-de-outro-numero-${sufixo}`, `num2:${sufixo}:tok-1`),
    );
    expect(trocado.status).toBe(401);
    // Sem token nenhum tambem nao passa: a camada nao e opcional.
    const semToken = await postar(
      caminhoDoWebhook(numero),
      eventoUazapi(undefined, `num2:${sufixo}:tok-2`),
    );
    expect(semToken.status).toBe(401);

    const certo = await postar(
      caminhoDoWebhook(numero),
      eventoUazapi(`tok-certo-${sufixo}`, `num2:${sufixo}:tok-3`),
    );
    expect(certo.status).toBe(200);
    expect(certo.corpo.whatsapp_account_id).toBe(numero.id);
  });

  it("número removido é 401 na URL nova e na legada, até com o segredo girado", async () => {
    const { clinicId, numero } = await clinicaComNumero("removido");
    await admin
      .rpc("remover_numero", { p_clinic_id: clinicId, p_account_id: numero.id })
      .throwOnError();
    const { data: segredo } = await admin
      .from("whatsapp_account_secret")
      .select("webhook_secret")
      .eq("account_id", numero.id)
      .single()
      .throwOnError();
    const girado = segredo!.webhook_secret as string;
    expect(girado).not.toBe(numero.webhookSecret);

    const conexao = { kind: "connection_update", status: "conectado" };
    for (const caminho of [
      caminhoDoWebhook(numero),
      caminhoDoWebhook(numero, { legado: true }),
      caminhoDoWebhook(numero, { segredo: girado }),
      caminhoDoWebhook(numero, { legado: true, segredo: girado }),
    ]) {
      expect((await postar(caminho, conexao)).status).toBe(401);
    }
    // E o evento recusado nao reconectou o numero removido.
    const { data: depois } = await admin
      .from("whatsapp_account")
      .select("connection_status")
      .eq("id", numero.id)
      .single();
    expect(depois?.connection_status).toBe("desconectado");
  });

  // Ativa na Fase 3: dois numeros na mesma clinica, a URL antiga com o
  // segredo do SEGUNDO entrega no segundo, nao no principal.
  it.skip("URL legada com o segredo do segundo número entrega no segundo", async () => {
    const { clinicId, numero: principal } = await clinicaComNumero("legada-2");
    const segundo = await criarNumeroDeTeste(admin, clinicId, {
      nome: "Segundo",
    });
    const { corpo } = await postar(
      caminhoDoWebhook(segundo, { legado: true }),
      recebida(telefone(), `num2:${sufixo}:legada-2`),
    );
    expect(corpo.whatsapp_account_id).toBe(segundo.id);
    expect(corpo.whatsapp_account_id).not.toBe(principal.id);
  });

  // Ativa na Fase 3: o token da instancia do numero A nao passa na URL do B.
  it.skip("token do número A na URL do número B é 401", async () => {
    const { clinicId } = await clinicaComNumero("token-2", {
      instance_token: `tok-a-${sufixo}`,
    });
    const b = await criarNumeroDeTeste(admin, clinicId, {
      nome: "Segundo",
      instance_token: `tok-b-${sufixo}`,
    });
    const phone = telefone();
    const { status } = await postar(caminhoDoWebhook(b), {
      EventType: "messages",
      token: `tok-a-${sufixo}`,
      message: {
        messageid: `num2:${sufixo}:token-2`,
        chatid: jid(phone),
        sender_pn: jid(phone),
        fromMe: false,
        messageType: "Conversation",
        text: "Oi",
      },
    });
    expect(status).toBe(401);
  });
});

describe("webhook: tudo o que o evento toca é daquele número", () => {
  it("status de conexão grava só no número da URL", async () => {
    const a = await clinicaComNumero("status-a");
    const b = await clinicaComNumero("status-b");
    const { status } = await postar(caminhoDoWebhook(a.numero), {
      kind: "connection_update",
      status: "desconectado",
    });
    expect(status).toBe(200);

    const { data: numeros } = await admin
      .from("whatsapp_account")
      .select("id, connection_status, disconnected_at")
      .in("id", [a.numero.id, b.numero.id])
      .throwOnError();
    const linha = (id: string) => (numeros ?? []).find((n) => n.id === id);
    expect(linha(a.numero.id)?.connection_status).toBe("desconectado");
    expect(linha(a.numero.id)?.disconnected_at).not.toBeNull();
    expect(linha(b.numero.id)?.connection_status).toBe("conectado");
    expect(linha(b.numero.id)?.disconnected_at).toBeNull();
  });

  // Ativa na Fase 3: dois numeros na mesma clinica.
  it.skip("a queda do número A não derruba o número B da mesma clínica", async () => {
    const { clinicId, numero: a } = await clinicaComNumero("status-2");
    const b = await criarNumeroDeTeste(admin, clinicId, { nome: "Segundo" });
    await postar(caminhoDoWebhook(a), {
      kind: "connection_update",
      status: "desconectado",
    });
    const { data } = await admin
      .from("whatsapp_account")
      .select("connection_status")
      .eq("id", b.id)
      .single();
    expect(data?.connection_status).toBe("conectado");
  });

  it("resposta pelo celular tira da espera só a conversa daquele número", async () => {
    const a = await clinicaComNumero("eco-celular-a");
    const b = await clinicaComNumero("eco-celular-b");
    const phone = telefone();
    const umaHoraAtras = new Date(Date.now() - HORA).toISOString();
    const conversas: string[] = [];
    for (const { clinicId, numero } of [a, b]) {
      const contactId = await contatoComConsentimento(clinicId, phone);
      const conversa = await conversaNoNumero(clinicId, contactId, numero.id);
      await admin
        .from("conversation")
        .update({ awaiting_reply: true, last_inbound_at: umaHoraAtras })
        .eq("id", conversa)
        .throwOnError();
      conversas.push(conversa);
    }

    const { status } = await postar(caminhoDoWebhook(a.numero), {
      EventType: "messages",
      message: {
        messageid: `num2:${sufixo}:eco-celular`,
        chatid: jid(phone),
        fromMe: true,
        messageType: "Conversation",
        text: "Respondido pelo celular",
      },
    });
    expect(status).toBe(200);

    const { data } = await admin
      .from("conversation")
      .select("id, awaiting_reply")
      .in("id", conversas)
      .throwOnError();
    const espera = (id: string) =>
      (data ?? []).find((c) => c.id === id)?.awaiting_reply;
    expect(espera(conversas[0]!)).toBe(false);
    // O mesmo paciente, no numero de outra clinica: continua esperando.
    expect(espera(conversas[1]!)).toBe(true);
  });

  // Ativa na Fase 3: o mesmo paciente com uma conversa em cada numero da
  // clinica (decisao 1 do dono). A resposta dada pelo celular do A nao
  // responde a pergunta feita no B.
  it.skip("eco do celular do número A não mexe na conversa do mesmo paciente no B", async () => {
    const { clinicId, numero: a } = await clinicaComNumero("eco-celular-2");
    const b = await criarNumeroDeTeste(admin, clinicId, { nome: "Segundo" });
    const phone = telefone();
    const contactId = await contatoComConsentimento(clinicId, phone);
    const conversaA = await conversaNoNumero(clinicId, contactId, a.id);
    const conversaB = await conversaNoNumero(clinicId, contactId, b.id);
    expect(conversaA).not.toBe(conversaB);
    const umaHoraAtras = new Date(Date.now() - HORA).toISOString();
    await admin
      .from("conversation")
      .update({ awaiting_reply: true, last_inbound_at: umaHoraAtras })
      .in("id", [conversaA, conversaB])
      .throwOnError();
    await postar(caminhoDoWebhook(a), {
      EventType: "messages",
      message: {
        messageid: `num2:${sufixo}:eco-celular-2`,
        chatid: jid(phone),
        fromMe: true,
        messageType: "Conversation",
        text: "Respondido pelo celular do A",
      },
    });
    const { data } = await admin
      .from("conversation")
      .select("id, awaiting_reply")
      .in("id", [conversaA, conversaB]);
    const espera = (id: string) =>
      (data ?? []).find((c) => c.id === id)?.awaiting_reply;
    expect(espera(conversaA)).toBe(false);
    expect(espera(conversaB)).toBe(true);
  });

  it("recibo de entrega marca só a mensagem do número que o recebeu", async () => {
    const a = await clinicaComNumero("recibo-a");
    const b = await clinicaComNumero("recibo-b");
    const contactId = await contatoComConsentimento(a.clinicId, telefone());
    const conversa = await conversaNoNumero(a.clinicId, contactId, a.numero.id);
    const waId = `num2:${sufixo}:recibo`;
    await mensagemEnviada(a.clinicId, conversa, waId);
    const recibo = {
      kind: "message_status",
      waMessageId: waId,
      status: "lida",
    };

    expect((await postar(caminhoDoWebhook(b.numero), recibo)).status).toBe(200);
    expect((await mensagensComWaId(waId))[0]?.delivery_status).toBe("enviada");

    expect((await postar(caminhoDoWebhook(a.numero), recibo)).status).toBe(200);
    expect((await mensagensComWaId(waId))[0]?.delivery_status).toBe("lida");
  });

  // Ativa na Fase 3: o recibo que chega pela instancia B nao marca a linha
  // do numero A, mesmo com o mesmo wa_message_id (numero A escrevendo para o
  // numero B). A unicidade por numero e da Fase 5; aqui so o filtro.
  it.skip("recibo que chega pelo número B não marca a mensagem do número A", async () => {
    const { clinicId, numero: a } = await clinicaComNumero("recibo-2");
    const b = await criarNumeroDeTeste(admin, clinicId, { nome: "Segundo" });
    const contactId = await contatoComConsentimento(clinicId, telefone());
    const conversa = await conversaNoNumero(clinicId, contactId, a.id);
    const waId = `num2:${sufixo}:recibo-2`;
    await mensagemEnviada(clinicId, conversa, waId);
    await postar(caminhoDoWebhook(b), {
      kind: "message_status",
      waMessageId: waId,
      status: "lida",
    });
    expect((await mensagensComWaId(waId))[0]?.delivery_status).toBe("enviada");
  });

  it("apagamento para todos só alcança a mensagem do número que o recebeu", async () => {
    const a = await clinicaComNumero("apagar-a");
    const b = await clinicaComNumero("apagar-b");
    const contactId = await contatoComConsentimento(a.clinicId, telefone());
    const conversa = await conversaNoNumero(a.clinicId, contactId, a.numero.id);
    const waId = `num2:${sufixo}:apagar`;
    await mensagemEnviada(a.clinicId, conversa, waId);
    const apagou = { kind: "message_deleted", waMessageId: waId };

    expect((await postar(caminhoDoWebhook(b.numero), apagou)).status).toBe(200);
    expect((await mensagensComWaId(waId))[0]?.deleted_at).toBeNull();

    expect((await postar(caminhoDoWebhook(a.numero), apagou)).status).toBe(200);
    expect((await mensagensComWaId(waId))[0]?.deleted_at).not.toBeNull();
  });

  // Ativa na Fase 3: dois numeros na mesma clinica.
  it.skip("apagamento que chega pelo número B não apaga a mensagem do número A", async () => {
    const { clinicId, numero: a } = await clinicaComNumero("apagar-2");
    const b = await criarNumeroDeTeste(admin, clinicId, { nome: "Segundo" });
    const contactId = await contatoComConsentimento(clinicId, telefone());
    const conversa = await conversaNoNumero(clinicId, contactId, a.id);
    const waId = `num2:${sufixo}:apagar-2`;
    await mensagemEnviada(clinicId, conversa, waId);
    await postar(caminhoDoWebhook(b), {
      kind: "message_deleted",
      waMessageId: waId,
    });
    expect((await mensagensComWaId(waId))[0]?.deleted_at).toBeNull();
  });
});

describe("mídia e apagar pelo número", () => {
  it("mídia recebida baixa pela instância do número que a recebeu", async () => {
    const instancia = `fake-f2-midia-${sufixo}`;
    const { clinicId, numero } = await clinicaComNumero("midia", {
      instance_id: instancia,
    });
    const waId = `num2:${sufixo}:midia`;
    const { status, corpo } = await postar(
      caminhoDoWebhook(numero),
      recebida(telefone(), waId, { contentType: "imagem", body: null }),
    );
    expect(status).toBe(200);
    const messageId = corpo.message_id as string;
    arquivosCriados.push(`${clinicId}/${messageId}`);

    // O job nasce com o numero que recebeu, na coluna e no payload.
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id, whatsapp_account_id, payload")
      .eq("clinic_id", clinicId)
      .eq("kind", "baixar_midia")
      .throwOnError();
    expect(jobs).toHaveLength(1);
    const job = jobs![0]!;
    expect(job.whatsapp_account_id).toBe(numero.id);
    expect(
      (job.payload as { whatsapp_account_id?: string }).whatsapp_account_id,
    ).toBe(numero.id);

    const baixar = vi.spyOn(FakeProvider.prototype, "downloadMedia");
    const worker = `teste-f2-midia-${sufixo}`;
    const desfecho = await executarJobComPosse(
      admin,
      worker,
      await reivindicar(job.id as string, worker),
    );
    expect(desfecho).toBe("concluido");
    expect(baixar).toHaveBeenCalledTimes(1);
    const [ref, idBaixado] = baixar.mock.calls[0]!;
    expect(idBaixado).toBe(waId);
    expect(ref.accountId).toBe(numero.id);
    expect(ref.instanceId).toBe(instancia);

    const { data: mensagem } = await admin
      .from("message")
      .select("media_url")
      .eq("id", messageId)
      .single()
      .throwOnError();
    expect(mensagem!.media_url).toBe(
      `storage://${MIDIA_BUCKET}/${clinicId}/${messageId}`,
    );
  });

  it("apagar no WhatsApp usa a instância do número que enviou; número de outra clínica não abre nada", async () => {
    const instancia = `fake-f2-apagar-${sufixo}`;
    const a = await clinicaComNumero("revogar", {
      instance_id: instancia,
      instance_token: `tok-revogar-${sufixo}`,
    });
    const b = await clinicaComNumero("revogar-fora", {
      instance_id: `fake-f2-apagar-fora-${sufixo}`,
      instance_token: `tok-revogar-fora-${sufixo}`,
    });
    const contactId = await contatoComConsentimento(a.clinicId, telefone());
    const conversa = await conversaNoNumero(a.clinicId, contactId, a.numero.id);
    const waId = `num2:${sufixo}:revogar`;
    await mensagemEnviada(a.clinicId, conversa, waId);

    // O que a acao de apagar faz: o numero vem da MENSAGEM (copia imutavel do
    // numero da conversa), e a instancia e a daquele numero.
    const [linha] = await mensagensComWaId(waId);
    expect(linha?.whatsapp_account_id).toBe(a.numero.id);
    const { provider, ref } = await carregarInstancia(
      admin,
      a.clinicId,
      linha!.whatsapp_account_id!,
    );
    expect(ref).toMatchObject({
      clinicId: a.clinicId,
      accountId: a.numero.id,
      instanceId: instancia,
      instanceToken: `tok-revogar-${sufixo}`,
    });
    resetFakeProvider();
    expect(await provider.deleteMessage(ref, waId)).toEqual({ ok: true });
    expect(fakeDeletedMessages()).toEqual([waId]);

    // Numero de outra clinica: referencia vazia, nunca a instancia alheia.
    const alheia = await carregarInstancia(admin, a.clinicId, b.numero.id);
    expect(alheia.ref.instanceId ?? null).toBeNull();
    expect(alheia.ref.instanceToken ?? null).toBeNull();
  });
});

describe("envio pelo número da conversa", () => {
  // O envio com UM numero (sai pelo numero da conversa, conta_divergente,
  // numero_removido, carregarInstancia) esta provado contra o banco em
  // tests/integration/envio-por-numero.test.ts, do mesmo orquestrador. Aqui
  // fica so o caso de dois numeros, que depende da Fase 3.

  // Ativa na Fase 3: a conversa do numero B sai pelo B, mesmo com o A sendo
  // o principal.
  it.skip("conversa do segundo número sai pelo segundo, não pelo principal", async () => {
    const { clinicId } = await clinicaComNumero("envio-2");
    const b = await criarNumeroDeTeste(admin, clinicId, { nome: "Segundo" });
    const contactId = await contatoComConsentimento(clinicId, telefone());
    const conversationId = await conversaNoNumero(clinicId, contactId, b.id);
    resetFakeProvider();
    const resultado = await sendWhatsAppText(admin, {
      clinicId,
      conversationId,
      contactId,
      body: "Pelo segundo",
      authorUserId: null,
      author: "sistema",
    });
    expect(resultado.ok).toBe(true);
    expect(fakeSentMessages()[0]?.accountId).toBe(b.id);
  });
});

describe("régua e eco pelo número", () => {
  /** Follow-up ativo na etapa em_contato, um passo 60 min depois da entrada. */
  async function execucaoDeFollowup(clinicId: string, phone: string) {
    const { data: regua } = await admin
      .from("cadence")
      .insert({
        clinic_id: clinicId,
        kind: "followup",
        name: `Follow-up F2 ${sufixo}`,
        trigger_stage: "em_contato",
        active: true,
        ...JANELA_ABERTA,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: passo } = await admin
      .from("cadence_step")
      .insert({
        clinic_id: clinicId,
        cadence_id: regua!.id,
        offset_minutes: 60,
        fixed_body: "Oi, {{nome}}! Podemos ajudar?",
      })
      .select("id")
      .single()
      .throwOnError();
    const contactId = await contatoComConsentimento(clinicId, phone, {
      funnel_stage: "em_contato",
    });
    // A ancora da etapa uma hora atras: o passo de 60 min vence agora.
    const ancora = new Date(Date.now() - HORA);
    await admin
      .from("contact")
      .update({ funnel_stage_changed_at: ancora.toISOString() })
      .eq("id", contactId)
      .throwOnError();
    const { data: execucao } = await admin
      .from("cadence_run")
      .insert({
        clinic_id: clinicId,
        cadence_step_id: passo!.id,
        contact_id: contactId,
        scheduled_for: new Date(ancora.getTime() + HORA).toISOString(),
      })
      .select("id")
      .single()
      .throwOnError();
    return { contactId, runId: execucao!.id as string };
  }

  it("número desconectado: o toque reagenda e continua no mesmo número", async () => {
    const { clinicId, numero } = await clinicaComNumero("regua-desconectada", {
      connection_status: "desconectado",
    });
    const { runId } = await execucaoDeFollowup(clinicId, telefone());
    const { data: criado } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "executar_passo_de_regua",
        payload: { cadence_run_id: runId },
        run_at: AMANHA(),
      })
      .select("id, whatsapp_account_id")
      .single()
      .throwOnError();
    // O job nasce carimbado com o numero de envio (job_ganha_numero).
    expect(criado!.whatsapp_account_id).toBe(numero.id);

    resetFakeProvider();
    const worker = `teste-f2-regua-${sufixo}`;
    const antes = Date.now();
    const desfecho = await executarJobComPosse(
      admin,
      worker,
      await reivindicar(criado!.id as string, worker),
    );
    expect(desfecho).toBe("reagendado");

    const { data: job } = await admin
      .from("job_queue")
      .select("status, whatsapp_account_id, run_at")
      .eq("id", criado!.id)
      .single()
      .throwOnError();
    expect(job!.status).toBe("pendente");
    // Espera a reconexao DAQUELE numero: nunca troca sozinho.
    expect(job!.whatsapp_account_id).toBe(numero.id);
    expect(new Date(job!.run_at as string).getTime()).toBeGreaterThan(
      antes + 60_000,
    );

    const { data: run } = await admin
      .from("cadence_run")
      .select("sent_at, skipped_reason")
      .eq("id", runId)
      .single()
      .throwOnError();
    expect(run).toEqual({ sent_at: null, skipped_reason: null });
    expect(fakeSentMessages().filter((m) => m.clinicId === clinicId)).toEqual(
      [],
    );
  });

  // Ativa na Fase 3: com o A (carimbado) desconectado e o B conectado, o
  // toque espera o A em vez de sair pelo B.
  it.skip("toque carimbado no número A desconectado não sai pelo B conectado", async () => {
    const { clinicId, numero: a } = await clinicaComNumero("regua-2", {
      connection_status: "desconectado",
    });
    const b = await criarNumeroDeTeste(admin, clinicId, { nome: "Segundo" });
    const { runId } = await execucaoDeFollowup(clinicId, telefone());
    const { data: criado } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "executar_passo_de_regua",
        payload: { cadence_run_id: runId },
        run_at: AMANHA(),
        whatsapp_account_id: a.id,
      })
      .select("id")
      .single()
      .throwOnError();
    resetFakeProvider();
    const worker = `teste-f2-regua-2-${sufixo}`;
    const desfecho = await executarJobComPosse(
      admin,
      worker,
      await reivindicar(criado!.id as string, worker),
    );
    expect(desfecho).toBe("reagendado");
    const { data: job } = await admin
      .from("job_queue")
      .select("whatsapp_account_id")
      .eq("id", criado!.id)
      .single();
    expect(job?.whatsapp_account_id).toBe(a.id);
    expect(fakeSentMessages().some((m) => m.accountId === b.id)).toBe(false);
  });

  /**
   * Consulta aguardando confirmacao com o toque de 3h ja enviado PELO NUMERO
   * `accountId`: a mensagem do toque mora na conversa daquele numero e a run
   * aponta para ela (cadence_run.message_id), como a regua deixa o mundo.
   */
  async function consultaTocada(clinicId: string, accountId: string) {
    const { data: profissional } = await admin
      .from("professional")
      .insert({ clinic_id: clinicId, name: "Dra. Número" })
      .select("id")
      .single()
      .throwOnError();
    const { data: procedimento } = await admin
      .from("procedure")
      .insert({
        clinic_id: clinicId,
        name: "Consulta",
        default_duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: vinculo } = await admin
      .from("service_link")
      .insert({
        clinic_id: clinicId,
        professional_id: profissional!.id,
        procedure_id: procedimento!.id,
        insurance_id: null,
        price_cents: 10000,
        covered_by_insurance: false,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const phone = telefone();
    const contactId = await contatoComConsentimento(clinicId, phone);
    const inicio = new Date(Date.now() + 3 * HORA);
    const { data: consulta } = await admin
      .from("appointment")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        professional_id: profissional!.id,
        service_link_id: vinculo!.id,
        starts_at: inicio.toISOString(),
        ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
        status: "aguardando_confirmacao",
      })
      .select("id")
      .single()
      .throwOnError();
    const conversationId = await conversaNoNumero(
      clinicId,
      contactId,
      accountId,
    );
    const { data: toque } = await admin
      .from("message")
      .insert({
        clinic_id: clinicId,
        conversation_id: conversationId,
        wa_message_id: `num2:${sufixo}:toque-${consulta!.id}`,
        direction: "saida",
        author: "sistema",
        content_type: "texto",
        body: "Toque de confirmação (teste)",
        delivery_status: "enviada",
        billable: false,
        cost_cents: 0,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: passo } = await admin
      .from("cadence_step")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("offset_minutes", -180)
      .single()
      .throwOnError();
    await admin
      .from("cadence_run")
      .insert({
        clinic_id: clinicId,
        cadence_step_id: passo!.id,
        contact_id: contactId,
        appointment_id: consulta!.id,
        scheduled_for: new Date(inicio.getTime() - 3 * HORA).toISOString(),
        sent_at: new Date().toISOString(),
        message_id: toque!.id,
      })
      .throwOnError();
    return { phone, contactId, appointmentId: consulta!.id as string };
  }

  it("o eco da resposta ao toque sai pelo número que recebeu a resposta", async () => {
    const { clinicId, numero } = await clinicaComNumero("eco-toque");
    const { phone, contactId, appointmentId } = await consultaTocada(
      clinicId,
      numero.id,
    );

    const { status, corpo } = await postar(
      caminhoDoWebhook(numero),
      recebida(phone, `num2:${sufixo}:eco-toque`, { body: "1" }),
    );
    expect(status).toBe(200);
    expect(corpo.inserted).toBe(true);

    const { data: consulta } = await admin
      .from("appointment")
      .select("status")
      .eq("id", appointmentId)
      .single()
      .throwOnError();
    expect(consulta!.status).toBe("confirmado_paciente");

    const { data: ecos } = await admin
      .from("job_queue")
      .select("whatsapp_account_id, payload")
      .eq("clinic_id", clinicId)
      .eq("kind", "enviar_mensagem_ativa")
      .contains("payload", {
        contact_id: contactId,
        resposta_ao_paciente: true,
      })
      .throwOnError();
    expect(ecos!.length).toBeGreaterThan(0);
    for (const eco of ecos!) {
      expect(eco.whatsapp_account_id).toBe(numero.id);
    }
  });

  // Ativa na Fase 3 (D4): com as automaticas fixas no numero B, o eco da
  // resposta que chegou pelo A sai pelo A, porque responde a uma mensagem
  // que o paciente mandou para o A.
  it.skip("modo fixo em outro número: o eco sai mesmo assim pelo número que recebeu", async () => {
    const { clinicId, numero: a } = await clinicaComNumero("eco-toque-2");
    const b = await criarNumeroDeTeste(admin, clinicId, { nome: "Segundo" });
    await admin
      .from("whatsapp_envio_automatico")
      .insert({ clinic_id: clinicId, modo: "fixo", conta_fixa_id: b.id })
      .throwOnError();
    const { phone, contactId } = await consultaTocada(clinicId, a.id);
    await postar(
      caminhoDoWebhook(a),
      recebida(phone, `num2:${sufixo}:eco-toque-2`, { body: "1" }),
    );
    const { data: ecos } = await admin
      .from("job_queue")
      .select("whatsapp_account_id")
      .eq("clinic_id", clinicId)
      .eq("kind", "enviar_mensagem_ativa")
      .contains("payload", {
        contact_id: contactId,
        resposta_ao_paciente: true,
      });
    expect(ecos?.length).toBeGreaterThan(0);
    for (const eco of ecos ?? []) {
      expect(eco.whatsapp_account_id).toBe(a.id);
    }
  });

  // Ativa na Fase 3 (D2): o "1" sem citacao so vale para o toque enviado
  // pelo MESMO numero. O toque saiu pelo A; o "1" que chega pelo B nao
  // confirma nada.
  it.skip("resposta curta pelo número B não confirma o toque enviado pelo A", async () => {
    const { clinicId, numero: a } = await clinicaComNumero("d2");
    const b = await criarNumeroDeTeste(admin, clinicId, { nome: "Segundo" });
    const { phone, appointmentId } = await consultaTocada(clinicId, a.id);
    await postar(
      caminhoDoWebhook(b),
      recebida(phone, `num2:${sufixo}:d2`, { body: "1" }),
    );
    const { data } = await admin
      .from("appointment")
      .select("status")
      .eq("id", appointmentId)
      .single();
    expect(data?.status).toBe("aguardando_confirmacao");
  });
});
