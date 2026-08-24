import type { SupabaseClient } from "@supabase/supabase-js";

// Provisiona o catalogo e a agenda de demonstracao para UMA clinica: o caso
// canonico do Dr. Joao da spec (3.5) mais uma dermatologista, convenios,
// vinculos com os tres estados de preco, jornadas, bloqueio, consultas nos
// status principais e um encaixe da IA pendente (exercita o painel).
// Usado por criar-clinica-teste --com-demonstracao e pelos seeds guardados.

export async function provisionarDemonstracaoClinica(
  admin: SupabaseClient,
  clinicId: string,
): Promise<string[]> {
  const feito: string[] = [];

  const { data: unidade } = await admin
    .from("unit")
    .insert({ clinic_id: clinicId, name: "Unidade Centro" })
    .select("id")
    .single()
    .throwOnError();
  feito.push("1 unidade");

  const { data: profs } = await admin
    .from("professional")
    .insert([
      {
        clinic_id: clinicId,
        name: "Dr. João Pereira",
        council_type: "CRM",
        council_number: "12345",
        specialties: ["Endocrinologia", "Nutrologia"],
        calendar_color: "#2563EB",
      },
      {
        clinic_id: clinicId,
        name: "Dra. Ana Costa",
        council_type: "CRM",
        council_number: "67890",
        specialties: ["Dermatologia"],
        calendar_color: "#15803D",
      },
      {
        clinic_id: clinicId,
        name: "Carla Mendes",
        council_type: null,
        council_number: null,
        specialties: ["Estética facial"],
        calendar_color: "#B45309",
      },
    ])
    .select("id, name")
    .throwOnError();
  const joao = profs!.find((p) => p.name.includes("João"))!.id as string;
  const ana = profs!.find((p) => p.name.includes("Ana"))!.id as string;
  const carla = profs!.find((p) => p.name.includes("Carla"))!.id as string;
  feito.push("3 profissionais (2 CRM, 1 esteticista sem conselho)");

  // Jornada: seg a sex com almoco = DUAS faixas por dia.
  const faixas = [];
  for (const professionalId of [joao, ana, carla]) {
    for (let weekday = 1; weekday <= 5; weekday++) {
      faixas.push(
        {
          clinic_id: clinicId,
          professional_id: professionalId,
          unit_id: unidade!.id,
          weekday,
          starts_at: "08:00",
          ends_at: "12:00",
        },
        {
          clinic_id: clinicId,
          professional_id: professionalId,
          unit_id: unidade!.id,
          weekday,
          starts_at: "14:00",
          ends_at: "18:00",
        },
      );
    }
  }
  await admin.from("professional_schedule").insert(faixas).throwOnError();
  feito.push("jornadas seg a sex com almoço em duas faixas");

  const { data: laser } = await admin
    .from("resource")
    .insert({
      clinic_id: clinicId,
      unit_id: unidade!.id,
      name: "Laser Lavieen",
      kind: "equipamento",
    })
    .select("id")
    .single()
    .throwOnError();

  const { data: procs } = await admin
    .from("procedure")
    .insert([
      {
        clinic_id: clinicId,
        name: "Consulta endocrinologia",
        default_duration_min: 40,
        base_price_cents: 40000,
      },
      {
        clinic_id: clinicId,
        name: "Consulta nutrologia",
        default_duration_min: 60,
        base_price_cents: 50000,
      },
      {
        clinic_id: clinicId,
        name: "Consulta dermatologia",
        default_duration_min: 30,
        base_price_cents: 35000,
      },
      {
        clinic_id: clinicId,
        name: "Sessão de laser",
        default_duration_min: 45,
        base_price_cents: 25000,
        resource_id: laser!.id,
        prep_instructions:
          "Vir sem maquiagem e sem exposição ao sol nas 48h anteriores.",
      },
      {
        clinic_id: clinicId,
        name: "Avaliação estética",
        default_duration_min: 20,
        base_price_cents: 0,
      },
    ])
    .select("id, name")
    .throwOnError();
  const procEndo = procs!.find((p) => p.name.includes("endocrino"))!
    .id as string;
  const procNutro = procs!.find((p) => p.name.includes("nutro"))!.id as string;
  const procDermato = procs!.find((p) => p.name.includes("dermato"))!
    .id as string;
  const procLaser = procs!.find((p) => p.name.includes("laser"))!.id as string;
  const procAvaliacao = procs!.find((p) => p.name.includes("Avaliação"))!
    .id as string;
  feito.push("5 procedimentos (1 com preparo e recurso)");

  const { data: convs } = await admin
    .from("insurance")
    .insert([
      { clinic_id: clinicId, name: "Unimed" },
      { clinic_id: clinicId, name: "Bradesco Saúde" },
    ])
    .select("id, name")
    .throwOnError();
  const unimed = convs!.find((c) => c.name === "Unimed")!.id as string;
  const bradesco = convs!.find((c) => c.name.includes("Bradesco"))!
    .id as string;

  // O caso canonico do Dr. Joao (spec 3.5): endocrino particular 400/40min,
  // atende Unimed e Bradesco (coberto); nutro particular 500/60min, SO
  // particular. Mais dermato da Ana e laser da Carla, e um zero de verdade.
  await admin
    .from("service_link")
    .insert([
      {
        clinic_id: clinicId,
        professional_id: joao,
        procedure_id: procEndo,
        insurance_id: null,
        price_cents: 40000,
        covered_by_insurance: false,
        duration_min: 40,
      },
      {
        clinic_id: clinicId,
        professional_id: joao,
        procedure_id: procEndo,
        insurance_id: unimed,
        price_cents: null,
        covered_by_insurance: true,
        duration_min: 40,
      },
      {
        clinic_id: clinicId,
        professional_id: joao,
        procedure_id: procEndo,
        insurance_id: bradesco,
        price_cents: null,
        covered_by_insurance: true,
        duration_min: 40,
      },
      {
        clinic_id: clinicId,
        professional_id: joao,
        procedure_id: procNutro,
        insurance_id: null,
        price_cents: 50000,
        covered_by_insurance: false,
        duration_min: 60,
      },
      {
        clinic_id: clinicId,
        professional_id: ana,
        procedure_id: procDermato,
        insurance_id: null,
        price_cents: 35000,
        covered_by_insurance: false,
        duration_min: 30,
      },
      {
        clinic_id: clinicId,
        professional_id: ana,
        procedure_id: procDermato,
        insurance_id: unimed,
        price_cents: null,
        covered_by_insurance: true,
        duration_min: 30,
      },
      {
        clinic_id: clinicId,
        professional_id: carla,
        procedure_id: procLaser,
        insurance_id: null,
        price_cents: 25000,
        covered_by_insurance: false,
        duration_min: 45,
      },
      {
        clinic_id: clinicId,
        professional_id: carla,
        procedure_id: procAvaliacao,
        insurance_id: null,
        price_cents: 0,
        covered_by_insurance: false,
        duration_min: 20,
      },
    ])
    .throwOnError();
  feito.push("matriz de vínculos (o caso do Dr. João, com Coberto e R$ 0,00)");

  await admin
    .from("package")
    .insert({
      clinic_id: clinicId,
      procedure_id: procLaser,
      sessions: 10,
      price_cents: 200000,
      validity_days: 180,
    })
    .throwOnError();
  feito.push("1 pacote de 10 sessões");

  // Contatos e consultas de amanha (dia util seguinte), nos status
  // principais, mais um encaixe da IA pendente.
  const amanha = proximoDiaUtil();
  const { data: contatos } = await admin
    .from("contact")
    .insert([
      {
        clinic_id: clinicId,
        phone_e164: "+5584960010001",
        name: "Marina Souza",
        kind: "paciente",
      },
      {
        clinic_id: clinicId,
        phone_e164: "+5584960010002",
        name: "Pedro Lima",
        kind: "paciente",
      },
      {
        clinic_id: clinicId,
        phone_e164: "+5584960010003",
        name: "Julia Nunes",
        kind: "lead",
      },
      {
        clinic_id: clinicId,
        phone_e164: "+5584960010004",
        name: "Rafael Torres",
        kind: "paciente",
      },
    ])
    .select("id, name")
    .throwOnError();
  const porNome = (nome: string) =>
    contatos!.find((c) => (c.name as string).includes(nome))!.id as string;

  const { data: vinculos } = await admin
    .from("service_link")
    .select("id, professional_id, procedure_id, insurance_id")
    .eq("clinic_id", clinicId);
  const vinculoDe = (prof: string, proc: string, conv: string | null) =>
    vinculos!.find(
      (v) =>
        v.professional_id === prof &&
        v.procedure_id === proc &&
        v.insurance_id === conv,
    )!.id as string;

  // Insercao em lote no PostgREST exige as MESMAS colunas em todas as
  // linhas (coluna ausente vira NULL, nao o default do banco).
  const consulta = (
    contato: string,
    prof: string,
    vinculo: string,
    hora: string,
    duracaoMin: number,
    extras: Record<string, unknown> = {},
  ) => ({
    clinic_id: clinicId,
    contact_id: contato,
    professional_id: prof,
    service_link_id: vinculo,
    starts_at: `${amanha}T${hora}:00-03:00`,
    ends_at: `${amanha}T${somaMinutos(hora, duracaoMin)}:00-03:00`,
    status: "agendado",
    confirmation_channel: null,
    is_overbooking: false,
    created_by: "usuario",
    approval_status: null,
    ...extras,
  });

  await admin
    .from("appointment")
    .insert([
      consulta(
        porNome("Marina"),
        joao,
        vinculoDe(joao, procEndo, unimed),
        "08:00",
        40,
        {
          status: "confirmado_paciente",
          confirmation_channel: "whatsapp",
        },
      ),
      consulta(
        porNome("Pedro"),
        joao,
        vinculoDe(joao, procNutro, null),
        "09:00",
        60,
        {
          status: "aguardando_confirmacao",
        },
      ),
      consulta(
        porNome("Julia"),
        ana,
        vinculoDe(ana, procDermato, unimed),
        "08:30",
        30,
        {
          status: "agendado",
        },
      ),
      consulta(
        porNome("Rafael"),
        ana,
        vinculoDe(ana, procDermato, null),
        "10:00",
        30,
        {
          status: "confirmado_recepcao",
          confirmation_channel: "telefone",
        },
      ),
      consulta(
        porNome("Julia"),
        joao,
        vinculoDe(joao, procEndo, null),
        "09:30",
        40,
        {
          is_overbooking: true,
          created_by: "ia",
          approval_status: "pendente",
        },
      ),
    ])
    .throwOnError();
  feito.push(
    `consultas de demonstração em ${amanha} (com encaixe da IA pendente)`,
  );

  await admin
    .from("professional_block")
    .insert({
      clinic_id: clinicId,
      professional_id: carla,
      starts_at: `${amanha}T08:00:00-03:00`,
      ends_at: `${amanha}T12:00:00-03:00`,
      reason: "Congresso de estética",
      blocks_overbooking: true,
    })
    .throwOnError();
  feito.push("1 bloqueio (hachura na agenda)");

  await admin
    .from("slot_hold")
    .insert({
      clinic_id: clinicId,
      professional_id: ana,
      contact_id: porNome("Julia"),
      starts_at: `${amanha}T11:00:00-03:00`,
      ends_at: `${amanha}T11:30:00-03:00`,
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      created_by: "ia",
    })
    .throwOnError();
  feito.push("1 reserva da IA (hold com contador)");

  return feito;
}

function proximoDiaUtil(): string {
  const data = new Date();
  do {
    data.setDate(data.getDate() + 1);
  } while (data.getDay() === 0 || data.getDay() === 6);
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function somaMinutos(hora: string, minutos: number): string {
  const [h, m] = hora.split(":").map(Number);
  const total = h! * 60 + m! + minutos;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
