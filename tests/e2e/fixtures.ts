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
  /** Fase 2: catalogo e agenda da Clinica E2E */
  agenda: {
    diaISO: string;
    profJoaoId: string;
    profAnaId: string;
    consultaAgendadaId: string;
    consultaConfirmadaWhatsId: string;
    encaixePendenteId: string;
  };
  /** Fase 4: leads do funil (Tela 4) com origem, perda e autorizacao variadas */
  leads: {
    comOrigemId: string;
    semOrigemId: string;
    perdidoId: string;
    semAutorizacaoId: string;
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
  if (!(await limpar())) {
    throw new Error(
      "As clínicas de teste da execução anterior continuam no banco, então os slugs e2e- estão ocupados. " +
        "Causa: o gatilho exigir_admin_ativo (migration 20260825160000) recusa o cascade que tira o último " +
        "administrador ativo, e nenhuma clínica sai do banco. Aplique a migration " +
        "20260825170000_apagar_clinica.sql e rode de novo.",
    );
  }

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

  // -------------------------------------------------------------------------
  // Fase 2: catalogo (caso do Dr. Joao) e agenda no DIA DO TESTE
  // -------------------------------------------------------------------------
  const { data: unidadeE2e } = await admin
    .from("unit")
    .insert({ clinic_id: clinica.id, name: "Unidade E2E" })
    .select("id")
    .single()
    .throwOnError();
  const { data: profsE2e } = await admin
    .from("professional")
    .insert([
      {
        clinic_id: clinica.id,
        name: "Dr. João Pereira",
        council_type: "CRM",
        council_number: "12345",
        specialties: ["Endocrinologia", "Nutrologia"],
      },
      {
        clinic_id: clinica.id,
        name: "Dra. Ana Costa",
        council_type: "CRM",
        council_number: "67890",
        specialties: ["Dermatologia"],
      },
    ])
    .select("id, name")
    .throwOnError();
  const profJoaoId = profsE2e!.find((p) => p.name.includes("João"))!
    .id as string;
  const profAnaId = profsE2e!.find((p) => p.name.includes("Ana"))!.id as string;

  // Jornada cobrindo TODOS os dias (o teste roda em qualquer dia da semana).
  const faixasE2e = [];
  for (const professionalId of [profJoaoId, profAnaId]) {
    for (let weekday = 0; weekday <= 6; weekday++) {
      faixasE2e.push({
        clinic_id: clinica.id,
        professional_id: professionalId,
        unit_id: unidadeE2e!.id,
        weekday,
        starts_at: "07:00",
        ends_at: "20:00",
      });
    }
  }
  await admin.from("professional_schedule").insert(faixasE2e).throwOnError();

  const { data: procsE2e } = await admin
    .from("procedure")
    .insert([
      {
        clinic_id: clinica.id,
        name: "Consulta endocrinologia",
        default_duration_min: 40,
        base_price_cents: 40000,
      },
      {
        clinic_id: clinica.id,
        name: "Consulta dermatologia",
        default_duration_min: 30,
        base_price_cents: 35000,
      },
      {
        clinic_id: clinica.id,
        name: "Avaliação gratuita",
        default_duration_min: 20,
        base_price_cents: 0,
      },
    ])
    .select("id, name")
    .throwOnError();
  const procEndoId = procsE2e!.find((p) => p.name.includes("endocrino"))!
    .id as string;
  const procDermatoId = procsE2e!.find((p) => p.name.includes("dermato"))!
    .id as string;
  const procGratisId = procsE2e!.find((p) => p.name.includes("gratuita"))!
    .id as string;

  const { data: convsE2e } = await admin
    .from("insurance")
    .insert([
      { clinic_id: clinica.id, name: "Unimed" },
      { clinic_id: clinica.id, name: "Bradesco Saúde" },
    ])
    .select("id, name")
    .throwOnError();
  const unimedId = convsE2e!.find((c) => c.name === "Unimed")!.id as string;

  const { data: vinculosE2e } = await admin
    .from("service_link")
    .insert([
      {
        clinic_id: clinica.id,
        professional_id: profJoaoId,
        procedure_id: procEndoId,
        insurance_id: null,
        price_cents: 40000,
        covered_by_insurance: false,
        duration_min: 40,
      },
      {
        clinic_id: clinica.id,
        professional_id: profJoaoId,
        procedure_id: procEndoId,
        insurance_id: unimedId,
        price_cents: null,
        covered_by_insurance: true,
        duration_min: 40,
      },
      {
        clinic_id: clinica.id,
        professional_id: profJoaoId,
        procedure_id: procGratisId,
        insurance_id: null,
        price_cents: 0,
        covered_by_insurance: false,
        duration_min: 20,
      },
      {
        clinic_id: clinica.id,
        professional_id: profAnaId,
        procedure_id: procDermatoId,
        insurance_id: null,
        price_cents: 35000,
        covered_by_insurance: false,
        duration_min: 30,
      },
      {
        clinic_id: clinica.id,
        professional_id: profAnaId,
        procedure_id: procDermatoId,
        insurance_id: unimedId,
        price_cents: null,
        covered_by_insurance: true,
        duration_min: 30,
      },
    ])
    .select("id, professional_id, procedure_id, insurance_id")
    .throwOnError();
  const vinculoEndoParticular = vinculosE2e!.find(
    (v) =>
      v.professional_id === profJoaoId &&
      v.insurance_id === null &&
      v.procedure_id === procEndoId,
  )!.id as string;
  const vinculoDermatoUnimed = vinculosE2e!.find(
    (v) => v.professional_id === profAnaId && v.insurance_id === unimedId,
  )!.id as string;

  // Consultas no DIA DO TESTE (hoje, fuso da clinica default America/Fortaleza),
  // em horarios fixos que nao colidem com o clique dos testes.
  const hoje = new Date();
  const diaISO = [
    hoje.getFullYear(),
    String(hoje.getMonth() + 1).padStart(2, "0"),
    String(hoje.getDate()).padStart(2, "0"),
  ].join("-");
  const consultaBase = {
    clinic_id: clinica.id,
    status: "agendado",
    confirmation_channel: null,
    is_overbooking: false,
    created_by: "usuario",
    approval_status: null,
  };
  const { data: consultasE2e } = await admin
    .from("appointment")
    .insert([
      {
        ...consultaBase,
        contact_id: contatos.find((c) => c.name === "Roberto Recibo")!.id,
        professional_id: profJoaoId,
        service_link_id: vinculoEndoParticular,
        starts_at: `${diaISO}T08:00:00-03:00`,
        ends_at: `${diaISO}T08:40:00-03:00`,
      },
      {
        ...consultaBase,
        contact_id: contatos.find((c) => c.name === "Camila Áudio")!.id,
        professional_id: profAnaId,
        service_link_id: vinculoDermatoUnimed,
        starts_at: `${diaISO}T09:00:00-03:00`,
        ends_at: `${diaISO}T09:30:00-03:00`,
        status: "confirmado_paciente",
        confirmation_channel: "whatsapp",
      },
      {
        ...consultaBase,
        contact_id: contatos.find((c) => c.name === "Juliana Dermato")!.id,
        professional_id: profAnaId,
        service_link_id: vinculoDermatoUnimed,
        starts_at: `${diaISO}T10:00:00-03:00`,
        ends_at: `${diaISO}T10:30:00-03:00`,
        is_overbooking: true,
        created_by: "ia",
        approval_status: "pendente",
      },
    ])
    .select("id, status, approval_status")
    .throwOnError();
  const consultaAgendadaId = consultasE2e!.find(
    (c) => c.status === "agendado" && !c.approval_status,
  )!.id as string;
  const consultaConfirmadaWhatsId = consultasE2e!.find(
    (c) => c.status === "confirmado_paciente",
  )!.id as string;
  const encaixePendenteId = consultasE2e!.find(
    (c) => c.approval_status === "pendente",
  )!.id as string;

  await admin
    .from("professional_block")
    .insert({
      clinic_id: clinica.id,
      professional_id: profJoaoId,
      starts_at: `${diaISO}T12:00:00-03:00`,
      ends_at: `${diaISO}T13:00:00-03:00`,
      reason: "Almoço estendido",
      blocks_overbooking: true,
    })
    .throwOnError();
  await admin
    .from("slot_hold")
    .insert({
      clinic_id: clinica.id,
      professional_id: profAnaId,
      contact_id: contatos.find((c) => c.name === "Juliana Dermato")!.id,
      starts_at: `${diaISO}T11:00:00-03:00`,
      ends_at: `${diaISO}T11:30:00-03:00`,
      expires_at: new Date(Date.now() + 8 * 60_000).toISOString(),
      created_by: "ia",
    })
    .throwOnError();

  // -------------------------------------------------------------------------
  // Fase 4: leads do funil (Tela 4). Quatro cartoes com etapa, origem,
  // recencia e autorizacao variadas para os aceites da 4.3:
  // - com origem: novo, trafego pago, campanha, autorizado, contato ha 1h
  // - sem origem e SEM nome: em contato, so telefone, contato ha 12h
  // - perdido: motivo "preco" (check do banco exige), autorizado, ha 3 dias
  // - sem autorizacao: aguardando resposta, sem NENHUMA linha de consent,
  //   nunca contatado (last_contact_at null)
  // -------------------------------------------------------------------------
  const leadsE2e = (
    await admin
      .from("contact")
      .insert([
        {
          clinic_id: clinica.id,
          phone_e164: "+5584970000021",
          name: "Otávio Origem",
          kind: "lead",
          funnel_stage: "novo",
          source_channel: "trafego_pago",
          source_campaign: "Campanha E2E",
          source_captured_at: minutosAtras(60),
          source_method: "manual",
          last_contact_at: minutosAtras(60),
        },
        {
          clinic_id: clinica.id,
          phone_e164: "+5584970000022",
          name: null,
          kind: "lead",
          funnel_stage: "em_contato",
          last_contact_at: minutosAtras(12 * 60),
        },
        {
          clinic_id: clinica.id,
          phone_e164: "+5584970000023",
          name: "Larissa Perdida",
          kind: "lead",
          funnel_stage: "perdido",
          lost_reason: "preco",
          last_contact_at: minutosAtras(3 * 24 * 60),
        },
        {
          clinic_id: clinica.id,
          phone_e164: "+5584970000024",
          name: "Sandro Silêncio",
          kind: "lead",
          funnel_stage: "aguardando_resposta",
          last_contact_at: null,
        },
      ])
      .select("id, phone_e164")
      .throwOnError()
  ).data as { id: string; phone_e164: string }[];
  const leadPorFone = (fone: string) =>
    leadsE2e.find((lead) => lead.phone_e164 === fone)!.id as string;
  const leadComOrigemId = leadPorFone("+5584970000021");
  const leadSemOrigemId = leadPorFone("+5584970000022");
  const leadPerdidoId = leadPorFone("+5584970000023");
  const leadSemAutorizacaoId = leadPorFone("+5584970000024");

  // Autorizacao ativa so para o lead com origem e o perdido. O de
  // aguardando_resposta fica sem linha nenhuma, de proposito.
  await admin
    .from("contact_consent")
    .insert([
      {
        clinic_id: clinica.id,
        contact_id: leadComOrigemId,
        source: "recepcao",
        evidence: "Autorização registrada no cadastro E2E",
      },
      {
        clinic_id: clinica.id,
        contact_id: leadPerdidoId,
        source: "recepcao",
        evidence: "Autorização registrada no cadastro E2E",
      },
    ])
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
    agenda: {
      diaISO,
      profJoaoId,
      profAnaId,
      consultaAgendadaId,
      consultaConfirmadaWhatsId,
      encaixePendenteId,
    },
    leads: {
      comOrigemId: leadComOrigemId,
      semOrigemId: leadSemOrigemId,
      perdidoId: leadPerdidoId,
      semAutorizacaoId: leadSemAutorizacaoId,
    },
  };
}

// Devolve false quando as clinicas de teste sobreviveram. O teardown ignora o
// retorno (nao adianta derrubar uma execucao que ja terminou), mas o
// provisionamento da execucao seguinte para com uma mensagem que explica o
// motivo, em vez do "duplicate key" cru do slug repetido.
export async function limpar(): Promise<boolean> {
  const admin = adminClient();
  const { error } = await admin
    .from("clinic")
    .delete()
    .like("slug", `${E2E_PREFIXO}-%`);
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const usuario of data?.users ?? []) {
    if ((usuario.email ?? "").startsWith(`${E2E_PREFIXO}-`)) {
      await admin.auth.admin.deleteUser(usuario.id);
    }
  }
  return !error;
}
