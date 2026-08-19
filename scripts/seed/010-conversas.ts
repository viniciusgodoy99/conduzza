import type { SupabaseClient } from "@supabase/supabase-js";

import { userIdByEmail } from "./lib";

// Incremento de conversas do seed (tarefa 1.1): contatos com e sem
// consentimento, 15 conversas nos 4 estados, mensagens pt-BR realistas,
// 1 bloqueio de conformidade, 1 audio com transcricao e notas internas.
// Idempotente: UUIDs fixos + upsert. Datas relativas ao momento do seed.

const VITALIS = "00000000-0000-4000-a000-000000000001";
const BELEZA = "00000000-0000-4000-a000-000000000002";

// Webhook secrets FIXOS de desenvolvimento: usados pelo simulador e pelos testes.
export const DEV_WEBHOOK_SECRET_VITALIS =
  "dev-secret-vitalis-nao-usar-em-producao";
export const DEV_WEBHOOK_SECRET_BELEZA =
  "dev-secret-beleza-nao-usar-em-producao";

function contactId(n: number): string {
  return `00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
}
function conversationId(n: number): string {
  return `00000000-0000-4000-c000-${String(n).padStart(12, "0")}`;
}
function messageId(conversation: number, index: number): string {
  return `00000000-0000-4000-d0${String(conversation).padStart(2, "0")}-${String(index).padStart(12, "0")}`;
}
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

type SeedContact = {
  n: number;
  name: string;
  phone: string;
  kind: "lead" | "paciente";
  funnel: string;
  consent: "formulario_site" | "anuncio_ctwa" | "recepcao" | "conversa" | null;
};

// 18 contatos da Vitalis: 16 com consentimento, 2 SEM (importados que nunca
// escreveram; exercitam o bloqueio de envio da 1.4).
const CONTACTS: SeedContact[] = [
  {
    n: 1,
    name: "Juliana Freitas",
    phone: "+5584991110001",
    kind: "lead",
    funnel: "novo",
    consent: "conversa",
  },
  {
    n: 2,
    name: "Roberto Lima",
    phone: "+5584991110002",
    kind: "paciente",
    funnel: "agendou",
    consent: "conversa",
  },
  {
    n: 3,
    name: "Fernanda Cardoso",
    phone: "+5584991110003",
    kind: "lead",
    funnel: "em_contato",
    consent: "anuncio_ctwa",
  },
  {
    n: 4,
    name: "Sérgio Menezes",
    phone: "+5584991110004",
    kind: "paciente",
    funnel: "compareceu",
    consent: "conversa",
  },
  {
    n: 5,
    name: "Patrícia Nogueira",
    phone: "+5584991110005",
    kind: "lead",
    funnel: "aguardando_resposta",
    consent: "conversa",
  },
  {
    n: 6,
    name: "Diego Fontes",
    phone: "+5584991110006",
    kind: "lead",
    funnel: "novo",
    consent: "conversa",
  },
  {
    n: 7,
    name: "Camila Duarte",
    phone: "+5584991110007",
    kind: "paciente",
    funnel: "agendou",
    consent: "formulario_site",
  },
  {
    n: 8,
    name: "Marcos Vinícius",
    phone: "+5584991110008",
    kind: "lead",
    funnel: "em_contato",
    consent: "conversa",
  },
  {
    n: 9,
    name: "Aline Barros",
    phone: "+5584991110009",
    kind: "paciente",
    funnel: "compareceu",
    consent: "recepcao",
  },
  {
    n: 10,
    name: "Tiago Siqueira",
    phone: "+5584991110010",
    kind: "lead",
    funnel: "novo",
    consent: "conversa",
  },
  {
    n: 11,
    name: "Renata Peixoto",
    phone: "+5584991110011",
    kind: "lead",
    funnel: "aguardando_resposta",
    consent: "conversa",
  },
  {
    n: 12,
    name: "Gustavo Aragão",
    phone: "+5584991110012",
    kind: "paciente",
    funnel: "agendou",
    consent: "conversa",
  },
  {
    n: 13,
    name: "Larissa Moura",
    phone: "+5584991110013",
    kind: "lead",
    funnel: "em_contato",
    consent: "anuncio_ctwa",
  },
  {
    n: 14,
    name: "Eduardo Ramos",
    phone: "+5584991110014",
    kind: "paciente",
    funnel: "compareceu",
    consent: "conversa",
  },
  {
    n: 15,
    name: "Beatriz Colares",
    phone: "+5584991110015",
    kind: "lead",
    funnel: "novo",
    consent: "conversa",
  },
  {
    n: 16,
    name: "Otávio Bezerra",
    phone: "+5584991110016",
    kind: "lead",
    funnel: "em_contato",
    consent: "conversa",
  },
  // sem consentimento (importados; nunca escreveram)
  {
    n: 17,
    name: "Vera Lúcia Pontes",
    phone: "+5584991110017",
    kind: "lead",
    funnel: "novo",
    consent: null,
  },
  {
    n: 18,
    name: "Haroldo Teixeira",
    phone: "+5584991110018",
    kind: "lead",
    funnel: "novo",
    consent: null,
  },
];

type Msg = {
  author: "paciente" | "ia" | "usuario" | "sistema";
  body: string;
  minutesBefore: number;
  contentType?: "texto" | "audio" | "evento";
  transcript?: string;
  internalNote?: boolean;
  byEmail?: string;
};

type Conv = {
  n: number;
  contact: number;
  status: "ia_atendendo" | "aguardando_humano" | "em_atendimento" | "resolvida";
  assigneeEmail?: string;
  unread: number;
  ageMinutes: number;
  tags?: string[];
  messages: Msg[];
};

const CONVERSATIONS: Conv[] = [
  // ia_atendendo (5)
  {
    n: 1,
    contact: 1,
    status: "ia_atendendo",
    unread: 0,
    ageMinutes: 12,
    messages: [
      {
        author: "paciente",
        body: "Oi, vocês atendem dermatologia?",
        minutesBefore: 12,
      },
      {
        author: "ia",
        body: "Olá, Juliana! Atendemos sim. A consulta dermatológica particular custa R$ 380 e dura 30 minutos. Quer ver os próximos horários?",
        minutesBefore: 11,
      },
      {
        author: "paciente",
        body: "Quero sim, de preferência de manhã",
        minutesBefore: 8,
      },
      {
        author: "ia",
        body: "Perfeito! Tenho quinta às 9h, sexta às 10h30 ou segunda às 8h. Qual prefere?",
        minutesBefore: 7,
      },
    ],
  },
  {
    n: 2,
    contact: 6,
    status: "ia_atendendo",
    unread: 0,
    ageMinutes: 25,
    messages: [
      {
        author: "paciente",
        body: "Boa tarde, qual o valor da limpeza de pele?",
        minutesBefore: 25,
      },
      {
        author: "ia",
        body: "Boa tarde, Diego! A limpeza de pele custa R$ 180 e dura 50 minutos. Posso ver um horário para você?",
        minutesBefore: 24,
      },
    ],
  },
  {
    n: 3,
    contact: 10,
    status: "ia_atendendo",
    unread: 0,
    ageMinutes: 40,
    messages: [
      { author: "paciente", body: "Vocês aceitam Unimed?", minutesBefore: 40 },
      {
        author: "ia",
        body: "Aceitamos sim, Tiago! A Unimed cobre consulta em dermatologia e endocrinologia aqui na clínica. Quer agendar?",
        minutesBefore: 39,
      },
      {
        author: "paciente",
        body: "Vou ver com minha esposa e retorno",
        minutesBefore: 35,
      },
      {
        author: "ia",
        body: "Combinado! Qualquer coisa é só chamar por aqui.",
        minutesBefore: 34,
      },
    ],
  },
  {
    n: 4,
    contact: 15,
    status: "ia_atendendo",
    unread: 0,
    ageMinutes: 55,
    messages: [
      {
        author: "paciente",
        body: "Onde fica a clínica? Tem estacionamento?",
        minutesBefore: 55,
      },
      {
        author: "ia",
        body: "Ficamos na Av. Prudente de Morais, 1200, Natal. Temos estacionamento próprio gratuito para pacientes.",
        minutesBefore: 54,
      },
    ],
  },
  {
    n: 5,
    contact: 16,
    status: "ia_atendendo",
    unread: 0,
    ageMinutes: 70,
    messages: [
      {
        author: "paciente",
        body: "Preciso remarcar minha avaliação de sexta",
        minutesBefore: 70,
      },
      {
        author: "ia",
        body: "Claro, Otávio! Sua avaliação está marcada para sexta às 14h. Tenho horário na segunda às 14h ou na terça às 9h30. Qual fica melhor?",
        minutesBefore: 69,
      },
      { author: "paciente", body: "Segunda às 14h", minutesBefore: 66 },
      {
        author: "ia",
        body: "Prontinho, remarcado para segunda às 14h! Você recebe a confirmação um dia antes.",
        minutesBefore: 65,
      },
      {
        author: "sistema",
        body: "Consulta remarcada para segunda às 14:00",
        minutesBefore: 65,
        contentType: "evento",
      },
    ],
  },
  // aguardando_humano (3), incluindo o bloqueio de conformidade
  {
    n: 6,
    contact: 5,
    status: "aguardando_humano",
    unread: 3,
    ageMinutes: 18,
    tags: ["urgente"],
    messages: [
      {
        author: "paciente",
        body: "Oi, fiz um peeling aí semana passada",
        minutesBefore: 18,
      },
      {
        author: "paciente",
        body: "Minha pele está ardendo muito e apareceram umas bolhas, o que pode ser?",
        minutesBefore: 17,
      },
      {
        author: "sistema",
        body: "A IA escalou para a recepção: paciente descreveu sintoma",
        minutesBefore: 16,
        contentType: "evento",
      },
      {
        author: "paciente",
        body: "Alguém pode me responder por favor?",
        minutesBefore: 5,
      },
    ],
  },
  {
    n: 7,
    contact: 8,
    status: "aguardando_humano",
    unread: 2,
    ageMinutes: 33,
    messages: [
      {
        author: "paciente",
        body: "Quero falar com uma atendente, não com robô",
        minutesBefore: 33,
      },
      {
        author: "sistema",
        body: "A IA escalou para a recepção: paciente pediu atendimento humano",
        minutesBefore: 32,
        contentType: "evento",
      },
      { author: "paciente", body: "Olá??", minutesBefore: 10 },
    ],
  },
  {
    n: 8,
    contact: 11,
    status: "aguardando_humano",
    unread: 1,
    ageMinutes: 47,
    messages: [
      {
        author: "paciente",
        body: "O valor que me passaram na recepção foi diferente do que a moça falou aqui",
        minutesBefore: 47,
      },
      {
        author: "sistema",
        body: "A IA escalou para a recepção: assunto envolve valor fora da tabela",
        minutesBefore: 46,
        contentType: "evento",
      },
    ],
  },
  // em_atendimento (4)
  {
    n: 9,
    contact: 2,
    status: "em_atendimento",
    assigneeEmail: "recepcao@vitalis.dev",
    unread: 0,
    ageMinutes: 9,
    messages: [
      {
        author: "paciente",
        body: "Bom dia! Preciso do recibo da consulta de ontem para o reembolso",
        minutesBefore: 90,
      },
      {
        author: "sistema",
        body: "Marina Rocha assumiu a conversa",
        minutesBefore: 85,
        contentType: "evento",
      },
      {
        author: "usuario",
        body: "Bom dia, Roberto! Claro, vou emitir e te envio aqui mesmo ainda hoje pela manhã.",
        minutesBefore: 80,
        byEmail: "recepcao@vitalis.dev",
      },
      {
        author: "usuario",
        body: "Verificar com o financeiro se o recibo sai com o CNPJ novo",
        minutesBefore: 79,
        internalNote: true,
        byEmail: "recepcao@vitalis.dev",
      },
      { author: "paciente", body: "Perfeito, obrigado!", minutesBefore: 9 },
    ],
  },
  {
    n: 10,
    contact: 7,
    status: "em_atendimento",
    assigneeEmail: "recepcao@vitalis.dev",
    unread: 0,
    ageMinutes: 22,
    messages: [
      {
        author: "paciente",
        body: "",
        minutesBefore: 30,
        contentType: "audio",
        transcript:
          "Oi, tudo bem? Queria saber se pode adiantar minha consulta de quinta para amanhã, porque vou viajar na quarta à noite. Se tiver qualquer horário amanhã de tarde fica ótimo.",
      },
      {
        author: "sistema",
        body: "Marina Rocha assumiu a conversa",
        minutesBefore: 28,
        contentType: "evento",
      },
      {
        author: "usuario",
        body: "Oi, Camila! Consigo sim: amanhã às 15h30 com a mesma profissional. Confirmo?",
        minutesBefore: 24,
        byEmail: "recepcao@vitalis.dev",
      },
      { author: "paciente", body: "Confirma por favor!", minutesBefore: 22 },
    ],
  },
  {
    n: 11,
    contact: 12,
    status: "em_atendimento",
    assigneeEmail: "gestor@vitalis.dev",
    unread: 0,
    ageMinutes: 60,
    messages: [
      {
        author: "paciente",
        body: "Vocês fazem pacote de 10 sessões de drenagem? Qual o valor?",
        minutesBefore: 75,
      },
      {
        author: "sistema",
        body: "Gustavo Gomes assumiu a conversa",
        minutesBefore: 70,
        contentType: "evento",
      },
      {
        author: "usuario",
        body: "Olá, Gustavo! Fazemos sim. Vou montar uma proposta com o valor do pacote e te envio aqui, pode ser?",
        minutesBefore: 64,
        byEmail: "gestor@vitalis.dev",
      },
      {
        author: "usuario",
        body: "Cliente veio da campanha de drenagem do Instagram, priorizar retorno",
        minutesBefore: 63,
        internalNote: true,
        byEmail: "gestor@vitalis.dev",
      },
      { author: "paciente", body: "Pode sim, aguardo", minutesBefore: 60 },
    ],
  },
  {
    n: 12,
    contact: 3,
    status: "em_atendimento",
    assigneeEmail: "admin@vitalis.dev",
    unread: 0,
    ageMinutes: 15,
    messages: [
      {
        author: "paciente",
        body: "A doutora atende criança de 8 anos?",
        minutesBefore: 45,
      },
      {
        author: "sistema",
        body: "A IA escalou para a recepção: atendimento envolve menor de idade",
        minutesBefore: 44,
        contentType: "evento",
      },
      {
        author: "sistema",
        body: "Ana Almeida assumiu a conversa",
        minutesBefore: 40,
        contentType: "evento",
      },
      {
        author: "usuario",
        body: "Olá, Fernanda! Atende sim, a partir de 6 anos, sempre com responsável presente. Quer que eu veja um horário?",
        minutesBefore: 35,
        byEmail: "admin@vitalis.dev",
      },
      { author: "paciente", body: "Quero, sábado tem?", minutesBefore: 15 },
    ],
  },
  // resolvida (3)
  {
    n: 13,
    contact: 4,
    status: "resolvida",
    unread: 0,
    ageMinutes: 1440,
    messages: [
      {
        author: "paciente",
        body: "Consulta confirmada para amanhã às 10h?",
        minutesBefore: 1500,
      },
      {
        author: "ia",
        body: "Confirmadíssima, Sérgio! Amanhã às 10h com a Dra. Helena. Chegando, é só se apresentar na recepção.",
        minutesBefore: 1499,
      },
      { author: "paciente", body: "Obrigado!", minutesBefore: 1495 },
      {
        author: "sistema",
        body: "Conversa resolvida",
        minutesBefore: 1440,
        contentType: "evento",
      },
    ],
  },
  {
    n: 14,
    contact: 9,
    status: "resolvida",
    unread: 0,
    ageMinutes: 2880,
    messages: [
      {
        author: "paciente",
        body: "Qual o preparo para o exame de sangue?",
        minutesBefore: 2940,
      },
      {
        author: "ia",
        body: "Olá, Aline! Jejum de 8 horas e pode beber água normalmente. Qualquer dúvida estou por aqui.",
        minutesBefore: 2939,
      },
      {
        author: "sistema",
        body: "Conversa resolvida",
        minutesBefore: 2880,
        contentType: "evento",
      },
    ],
  },
  {
    n: 15,
    contact: 14,
    status: "resolvida",
    unread: 0,
    ageMinutes: 4320,
    messages: [
      {
        author: "paciente",
        body: "Deu tudo certo com o reagendamento, obrigado pela atenção",
        minutesBefore: 4380,
      },
      {
        author: "usuario",
        body: "Nós que agradecemos, Eduardo! Até quinta.",
        minutesBefore: 4375,
        byEmail: "recepcao@vitalis.dev",
      },
      {
        author: "sistema",
        body: "Conversa resolvida",
        minutesBefore: 4320,
        contentType: "evento",
      },
    ],
  },
];

// A conversa 6 tem o bloqueio de conformidade registrado (a IA ia orientar
// clinicamente e o filtro barrou). O rascunho bloqueado fica para auditoria.
const COMPLIANCE_LOG_ID = "00000000-0000-4000-e000-000000000001";

export async function seedConversas(admin: SupabaseClient): Promise<string[]> {
  const log: string[] = [];

  const { error: contactError } = await admin.from("contact").upsert(
    CONTACTS.map((c) => ({
      id: contactId(c.n),
      clinic_id: VITALIS,
      phone_e164: c.phone,
      name: c.name,
      kind: c.kind,
      funnel_stage: c.funnel,
      last_contact_at: minutesAgo(30),
    })),
    { onConflict: "id" },
  );
  if (contactError) throw new Error(`contact: ${contactError.message}`);
  log.push(`${CONTACTS.length} contatos (2 sem autorização de mensagem)`);

  const consents = CONTACTS.filter((c) => c.consent !== null).map((c) => ({
    id: `00000000-0000-4000-b100-${String(c.n).padStart(12, "0")}`,
    clinic_id: VITALIS,
    contact_id: contactId(c.n),
    channel: "whatsapp",
    source: c.consent,
    evidence:
      c.consent === "conversa"
        ? "Primeira mensagem recebida do contato"
        : "Registrado no seed de desenvolvimento",
  }));
  const { error: consentError } = await admin
    .from("contact_consent")
    .upsert(consents, { onConflict: "id" });
  if (consentError) throw new Error(`contact_consent: ${consentError.message}`);
  log.push(`${consents.length} consentimentos ativos`);

  const emails = new Set<string>();
  for (const conv of CONVERSATIONS) {
    if (conv.assigneeEmail) emails.add(conv.assigneeEmail);
    for (const m of conv.messages) if (m.byEmail) emails.add(m.byEmail);
  }
  const userIds = new Map<string, string>();
  for (const email of emails) {
    userIds.set(email, await userIdByEmail(admin, email));
  }

  const { error: convError } = await admin.from("conversation").upsert(
    CONVERSATIONS.map((c) => ({
      id: conversationId(c.n),
      clinic_id: VITALIS,
      contact_id: contactId(c.contact),
      status: c.status,
      assignee_user_id: c.assigneeEmail
        ? (userIds.get(c.assigneeEmail) ?? null)
        : null,
      unread_count: c.unread,
      last_message_at: minutesAgo(c.ageMinutes),
      tags: c.tags ?? [],
      created_at: minutesAgo(c.ageMinutes + 120),
    })),
    { onConflict: "id" },
  );
  if (convError) throw new Error(`conversation: ${convError.message}`);
  log.push(`${CONVERSATIONS.length} conversas nos 4 estados`);

  const messages = CONVERSATIONS.flatMap((conv) =>
    conv.messages.map((m, index) => ({
      id: messageId(conv.n, index + 1),
      clinic_id: VITALIS,
      conversation_id: conversationId(conv.n),
      wa_message_id:
        m.author === "paciente" || m.author === "ia"
          ? `seed:vitalis:${conv.n}:${index + 1}`
          : null,
      direction: m.author === "paciente" ? "entrada" : "saida",
      author: m.author,
      author_user_id: m.byEmail ? (userIds.get(m.byEmail) ?? null) : null,
      content_type: m.contentType ?? "texto",
      body: m.body || null,
      media_url: m.contentType === "audio" ? "seed://audio-indisponivel" : null,
      transcript: m.transcript ?? null,
      is_internal_note: m.internalNote ?? false,
      billable: false,
      cost_cents: 0,
      delivery_status: m.author === "paciente" ? null : "entregue",
      created_at: minutesAgo(m.minutesBefore),
    })),
  );
  const { error: messageError } = await admin
    .from("message")
    .upsert(messages, { onConflict: "id" });
  if (messageError) throw new Error(`message: ${messageError.message}`);
  log.push(
    `${messages.length} mensagens (1 áudio com transcrição, 2 notas internas)`,
  );

  const { error: aiLogError } = await admin.from("ai_decision_log").upsert(
    [
      {
        id: COMPLIANCE_LOG_ID,
        clinic_id: VITALIS,
        conversation_id: conversationId(6),
        message_id: messageId(6, 3),
        tool_used: "escalar_humano",
        escalation_reason: "paciente descreveu sintoma pós-procedimento",
        compliance_blocked: true,
        compliance_rule: "triagem",
        blocked_draft:
          "Pelo que você descreveu, parece uma reação normal do peeling. Pode passar uma pomada cicatrizante e um anti-inflamatório leve que em dois dias melhora.",
        latency_ms: 1840,
      },
    ],
    { onConflict: "id" },
  );
  if (aiLogError) throw new Error(`ai_decision_log: ${aiLogError.message}`);
  log.push("1 bloqueio de conformidade registrado (triagem)");

  const { error: accountError } = await admin.from("whatsapp_account").upsert(
    [
      {
        clinic_id: VITALIS,
        provider: "fake",
        display_phone: "+55 84 98888-0001",
        connection_status: "conectado",
        connected_at: minutesAgo(60 * 24 * 3),
      },
      {
        clinic_id: BELEZA,
        provider: "fake",
        display_phone: "+55 84 98888-0002",
        connection_status: "desconectado",
        disconnected_at: minutesAgo(60 * 5),
      },
    ],
    { onConflict: "clinic_id" },
  );
  if (accountError)
    throw new Error(`whatsapp_account: ${accountError.message}`);

  const { error: secretError } = await admin
    .from("whatsapp_account_secret")
    .upsert(
      [
        { clinic_id: VITALIS, webhook_secret: DEV_WEBHOOK_SECRET_VITALIS },
        { clinic_id: BELEZA, webhook_secret: DEV_WEBHOOK_SECRET_BELEZA },
      ],
      { onConflict: "clinic_id" },
    );
  if (secretError)
    throw new Error(`whatsapp_account_secret: ${secretError.message}`);
  log.push("contas WhatsApp: Vitalis conectada, Beleza Pura desconectada");

  const { error: templateError } = await admin.from("message_template").upsert(
    [
      {
        id: "00000000-0000-4000-f000-000000000001",
        clinic_id: VITALIS,
        name: "confirmacao_consulta",
        category: "utility",
        body: "Olá {{nome}}! Sua consulta na {{clinica}} está marcada para {{data}} às {{hora}}. Podemos confirmar?",
        buttons: [
          { type: "reply", text: "Confirmar" },
          { type: "reply", text: "Remarcar" },
          { type: "reply", text: "Cancelar" },
        ],
        meta_status: "rascunho",
      },
      {
        id: "00000000-0000-4000-f000-000000000002",
        clinic_id: VITALIS,
        name: "lembrete_preparo",
        category: "utility",
        body: "Olá {{nome}}! Amanhã é o seu {{procedimento}}. Preparo: {{preparo}}. Qualquer dúvida, responda por aqui.",
        meta_status: "rascunho",
      },
    ],
    { onConflict: "id" },
  );
  if (templateError)
    throw new Error(`message_template: ${templateError.message}`);
  log.push("2 modelos de mensagem em rascunho");

  return log;
}
