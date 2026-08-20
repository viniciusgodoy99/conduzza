import { adminClient } from "../rls/stack";

// Dados de teste da suite de navegador. Antes a suite dependia do seed de
// demonstracao; como o banco agora e de operacao real e foi limpo, ela
// provisiona os proprios dados, roda, e apaga tudo no fim.
//
// Tudo que e criado aqui usa o prefixo e2e para o teardown reconhecer.

export const E2E_SENHA = "Conduzza!E2E2026";
export const E2E_PREFIXO = "e2e";

export type DadosE2E = {
  clinicId: string;
  clinicIdDesconectada: string;
  webhookSecret: string;
  emails: {
    admin: string;
    recepcao: string;
    gestor: string;
    leitura: string;
    duasClinicas: string;
    offline: string;
  };
  conversas: {
    comBloqueio: string;
    comNotaInterna: string;
    comAudio: string;
    comIa: string;
  };
  contatos: {
    comBloqueio: string;
    comNotaInterna: string;
    comAudio: string;
    comIa: string;
  };
};

const sufixo = "fixo";

function email(papel: string): string {
  return `${E2E_PREFIXO}-${papel}-${sufixo}@teste.dev`;
}

async function garantirUsuario(
  admin: ReturnType<typeof adminClient>,
  papel: string,
  nome: string,
): Promise<string> {
  const endereco = email(papel);
  const criado = await admin.auth.admin.createUser({
    email: endereco,
    password: E2E_SENHA,
    email_confirm: true,
    user_metadata: { name: nome },
  });
  if (criado.data.user) {
    return criado.data.user.id;
  }
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existente = data.users.find(
    (usuario) => usuario.email?.toLowerCase() === endereco.toLowerCase(),
  );
  if (!existente) {
    throw new Error(`Não foi possível criar nem localizar ${endereco}`);
  }
  await admin.auth.admin.updateUserById(existente.id, {
    password: E2E_SENHA,
    user_metadata: { name: nome },
  });
  return existente.id;
}

function minutosAtras(minutos: number): string {
  return new Date(Date.now() - minutos * 60_000).toISOString();
}

export async function provisionar(): Promise<DadosE2E> {
  const admin = adminClient();
  await limpar();

  const clinicasCriadas = (
    await admin
      .from("clinic")
      .insert([
        { name: "Clínica E2E", slug: `${E2E_PREFIXO}-principal-${sufixo}` },
        {
          name: "Espaço E2E Offline",
          slug: `${E2E_PREFIXO}-offline-${sufixo}`,
        },
      ])
      .select("id, slug")
      .throwOnError()
  ).data as { id: string; slug: string }[];
  const clinica = clinicasCriadas.find((linha) =>
    linha.slug.includes("principal"),
  )!;
  const clinicaDesconectada = clinicasCriadas.find((linha) =>
    linha.slug.includes("offline"),
  )!;

  await admin
    .from("clinic_branding")
    .insert([{ clinic_id: clinica.id }, { clinic_id: clinicaDesconectada.id }])
    .throwOnError();

  const papeis: [string, string, string][] = [
    ["admin", "Ana Admin", "admin"],
    ["recepcao", "Marina Recepção", "recepcao"],
    ["gestor", "Gustavo Gestor", "gestor"],
    ["leitura", "Lia Leitura", "leitura"],
  ];
  const ids: Record<string, string> = {};
  for (const [chave, nome, papel] of papeis) {
    const userId = await garantirUsuario(admin, chave, nome);
    ids[chave] = userId;
    await admin
      .from("clinic_member")
      .insert({
        clinic_id: clinica.id,
        user_id: userId,
        role: papel,
        status: "ativo",
      })
      .throwOnError();
  }

  // Pessoa que administra SO a clinica desconectada: exercita a faixa
  // vermelha de WhatsApp fora do ar sem cair na escolha de clinica.
  const offlineId = await garantirUsuario(admin, "offline", "Bruno Offline");
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicaDesconectada.id,
      user_id: offlineId,
      role: "admin",
      status: "ativo",
    })
    .throwOnError();

  // Pessoa com acesso a DUAS clinicas: exercita o seletor de clinica.
  const duasId = await garantirUsuario(admin, "duas", "Carla Duas Clínicas");
  await admin
    .from("clinic_member")
    .insert([
      {
        clinic_id: clinica.id,
        user_id: duasId,
        role: "admin",
        status: "ativo",
      },
      {
        clinic_id: clinicaDesconectada.id,
        user_id: duasId,
        role: "admin",
        status: "ativo",
      },
    ])
    .throwOnError();

  await admin
    .from("whatsapp_account")
    .insert([
      {
        clinic_id: clinica.id,
        provider: "fake",
        connection_status: "conectado",
        display_phone: "+55 84 90000-0001",
      },
      {
        clinic_id: clinicaDesconectada.id,
        provider: "fake",
        connection_status: "desconectado",
      },
    ])
    .throwOnError();
  const segredos = (
    await admin
      .from("whatsapp_account_secret")
      .insert([
        { clinic_id: clinica.id },
        { clinic_id: clinicaDesconectada.id },
      ])
      .select("clinic_id, webhook_secret")
      .throwOnError()
  ).data as { clinic_id: string; webhook_secret: string }[];
  const webhookSecret = segredos.find(
    (linha) => linha.clinic_id === clinica.id,
  )!.webhook_secret as string;

  const contatos = (
    await admin
      .from("contact")
      .insert([
        {
          clinic_id: clinica.id,
          phone_e164: "+5584970000001",
          name: "Patrícia Sintoma",
          kind: "lead",
        },
        {
          clinic_id: clinica.id,
          phone_e164: "+5584970000002",
          name: "Roberto Recibo",
          kind: "paciente",
        },
        {
          clinic_id: clinica.id,
          phone_e164: "+5584970000003",
          name: "Camila Áudio",
          kind: "paciente",
        },
        {
          clinic_id: clinica.id,
          phone_e164: "+5584970000004",
          name: "Juliana Dermato",
          kind: "lead",
        },
      ])
      .select("id, name")
      .throwOnError()
  ).data as { id: string; name: string }[];
  const porNome = (nome: string) =>
    contatos.find((contato) => contato.name === nome)!.id as string;

  const conversas = (
    await admin
      .from("conversation")
      .insert([
        {
          clinic_id: clinica.id,
          contact_id: porNome("Patrícia Sintoma"),
          status: "aguardando_humano",
          assignee_user_id: null,
          unread_count: 2,
          last_message_at: minutosAtras(10),
        },
        {
          clinic_id: clinica.id,
          contact_id: porNome("Roberto Recibo"),
          status: "em_atendimento",
          assignee_user_id: ids.recepcao,
          unread_count: 0,
          last_message_at: minutosAtras(20),
        },
        {
          clinic_id: clinica.id,
          contact_id: porNome("Camila Áudio"),
          status: "em_atendimento",
          assignee_user_id: ids.recepcao,
          unread_count: 0,
          last_message_at: minutosAtras(30),
        },
        {
          clinic_id: clinica.id,
          contact_id: porNome("Juliana Dermato"),
          status: "ia_atendendo",
          assignee_user_id: null,
          unread_count: 0,
          last_message_at: minutosAtras(40),
        },
      ])
      .select("id, contact_id")
      .throwOnError()
  ).data as { id: string; contact_id: string }[];
  const conversaDe = (nome: string) =>
    conversas.find((conversa) => conversa.contact_id === porNome(nome))!
      .id as string;

  await admin
    .from("message")
    .insert(
      [
        {
          conversa: "Patrícia Sintoma",
          wa: `${E2E_PREFIXO}:1`,
          direction: "entrada",
          author: "paciente",
          body: "Minha pele está ardendo muito depois do peeling, o que pode ser?",
          minutos: 11,
        },
        {
          conversa: "Patrícia Sintoma",
          wa: null,
          direction: "saida",
          author: "sistema",
          contentType: "evento",
          body: "A IA escalou para a recepção: paciente descreveu sintoma",
          minutos: 10,
        },
        {
          conversa: "Roberto Recibo",
          wa: `${E2E_PREFIXO}:2`,
          direction: "entrada",
          author: "paciente",
          body: "Preciso do recibo da consulta",
          minutos: 25,
        },
        {
          conversa: "Roberto Recibo",
          wa: null,
          direction: "saida",
          author: "usuario",
          autor: ids.recepcao,
          body: "Verificar com o financeiro se o recibo sai com o CNPJ novo",
          nota: true,
          minutos: 20,
        },
        {
          conversa: "Camila Áudio",
          wa: `${E2E_PREFIXO}:3`,
          direction: "entrada",
          author: "paciente",
          contentType: "audio",
          media: "seed://audio-indisponivel",
          transcript:
            "Oi, queria saber se pode adiantar minha consulta de quinta para amanhã, porque vou viajar na quarta à noite.",
          minutos: 30,
        },
        {
          conversa: "Juliana Dermato",
          wa: `${E2E_PREFIXO}:4`,
          direction: "entrada",
          author: "paciente",
          body: "Vocês atendem dermatologia?",
          minutos: 41,
        },
        {
          conversa: "Juliana Dermato",
          wa: `${E2E_PREFIXO}:5`,
          direction: "saida",
          author: "ia",
          body: "Atendemos sim! Quer ver os próximos horários?",
          minutos: 40,
        },
      ].map((linha) => ({
        clinic_id: clinica.id,
        conversation_id: conversaDe(linha.conversa),
        wa_message_id: linha.wa ?? null,
        direction: linha.direction,
        author: linha.author,
        author_user_id: linha.autor ?? null,
        content_type: linha.contentType ?? "texto",
        body: linha.body ?? null,
        media_url: linha.media ?? null,
        transcript: linha.transcript ?? null,
        is_internal_note: linha.nota ?? false,
        created_at: minutosAtras(linha.minutos),
      })),
    )
    .throwOnError();

  await admin
    .from("ai_decision_log")
    .insert({
      clinic_id: clinica.id,
      conversation_id: conversaDe("Patrícia Sintoma"),
      compliance_blocked: true,
      compliance_rule: "triagem",
      blocked_draft:
        "Parece reação normal do peeling. Pode passar uma pomada cicatrizante que melhora.",
      escalation_reason: "paciente descreveu sintoma",
    })
    .throwOnError();

  return {
    clinicId: clinica.id,
    clinicIdDesconectada: clinicaDesconectada.id,
    webhookSecret,
    emails: {
      admin: email("admin"),
      recepcao: email("recepcao"),
      gestor: email("gestor"),
      leitura: email("leitura"),
      duasClinicas: email("duas"),
      offline: email("offline"),
    },
    conversas: {
      comBloqueio: conversaDe("Patrícia Sintoma"),
      comNotaInterna: conversaDe("Roberto Recibo"),
      comAudio: conversaDe("Camila Áudio"),
      comIa: conversaDe("Juliana Dermato"),
    },
    contatos: {
      comBloqueio: porNome("Patrícia Sintoma"),
      comNotaInterna: porNome("Roberto Recibo"),
      comAudio: porNome("Camila Áudio"),
      comIa: porNome("Juliana Dermato"),
    },
  };
}

export async function limpar(): Promise<void> {
  const admin = adminClient();
  await admin.from("clinic").delete().like("slug", `${E2E_PREFIXO}-%`);
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const usuario of data?.users ?? []) {
    if ((usuario.email ?? "").startsWith(`${E2E_PREFIXO}-`)) {
      await admin.auth.admin.deleteUser(usuario.id);
    }
  }
}
