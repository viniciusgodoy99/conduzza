import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// E4, a IA marca consulta pelo WhatsApp (migration 20261020130000_ia_agenda),
// pela API com JWT real de cada papel. O que esta em jogo:
//   - ai_agent_config.agenda_antecedencia_horas e agenda_horizonte_dias tem
//     a permissao por coluna de skills: todo membro ativo da clinica le;
//     administrador e gestor gravam no rascunho; recepcao, profissional,
//     leitura e a outra clinica nao gravam (zero linhas); o CHECK de faixa
//     vale para a sessao (23514); anon nao le (42501); a versao publicada
//     nao muda pela sessao;
//   - slot_hold: as colunas novas (vinculo, conversa, job, consumo, consulta,
//     job do agendar) seguem a RLS da tabela: a clinica le as dela, o
//     profissional so as da propria agenda, a outra clinica e anon nada; a
//     sessao nao consome nem reaponta reserva (sem policy de update) e nao
//     cria reserva com vinculo, conversa ou consulta de outra clinica (o
//     gatilho de clinica, 23503) nem reserva da IA sem job (23514);
//   - reservar_horario_da_ia e agendar_pela_ia: 42501 para toda sessao e
//     para anon; o servidor chama (resposta de negocio, nao erro);
//   - devolver_conversa_da_consulta_recusada: quem escreve na clinica
//     (recepcao, administrador, o profissional na propria agenda) e o
//     servidor devolvem a conversa e gravam o evento; anon, leitura, o
//     profissional de outra agenda e a outra clinica recebem 42501 e nada
//     muda; a clinica A nao devolve a consulta da B.
//   - onda 2 (migration 20261022100000, M1): a consulta pendente nao
//     converte o lead; aprovar pela sessao (recepcao) converte; recusar nao;
//     a sessao nao muda o status de uma pendente para confirmar, chegar,
//     atender, compareceu ou falta (23514 consulta_pendente), cancelar
//     passa; a B nao le nem aprova a consulta da A. ESCRITO NA ONDA 2 E NAO
//     RODADO por quem escreveu: roda depois de aplicar a migration.
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// ESCRITO NA E4 E NAO RODADO por quem escreveu: grava no banco. Quem roda e
// o coordenador, DEPOIS de aplicar a migration, com npm run test:rls.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste, apagadas no
// afterAll, sem liberacao da IA (nenhuma conversa e atendida; as conversas
// "na IA" sao so linhas). Nada usa a id da salud-care, da teste123 nem da
// Conduzza Teste. Telefones ficticios.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic where slug like 'ia-agenda-rls-%' and e_de_teste;
// e os usuarios sinteticos (auth.users com email like
// 'ia-agenda-rls-%@teste.dev'), pelo painel do Supabase ou pela API de
// administracao, como o afterAll faz.

const PERMISSAO_NEGADA = "42501";
const FORA_DA_FAIXA = "23514";
const DE_OUTRA_CLINICA = "23503";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = "IaAgendaRls!2026";
const EVENTO_DA_RECUSA =
  "A equipe recusou a consulta marcada pela IA. Avise o paciente.";

const COLUNAS_DA_AGENDA =
  "id, agenda_antecedencia_horas, agenda_horizonte_dias";
const COLUNAS_DA_RESERVA =
  "id, professional_id, service_link_id, conversation_id, job_id, consumido_em, appointment_id, job_id_do_agendar";

const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();
const email = (apelido: string) =>
  `ia-agenda-rls-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;

const MEMBROS_ATIVOS_DA_A = [
  "admin-a",
  "gestor-a",
  "recepcao-a",
  "profissional-a",
  "leitura-a",
] as const;
const TODAS_AS_SESSOES = [...MEMBROS_ATIVOS_DA_A, "admin-b"] as const;

let clinicaA = "";
let clinicaB = "";
let numeroA = "";
let numeroB = "";
let p1 = "";
let p2 = "";
let pb = "";
let l1 = "";
let l2 = "";
let lb = "";
let rascunhoA = "";
let publicadaB = "";
let conversaA1 = "";
let conversaA2 = "";
let conversaB = "";
let contatoA1 = "";
let contatoA2 = "";
let contatoB = "";
let reservaA1 = "";
let reservaA2 = "";
let reservaB = "";
let consultaA1 = "";
let consultaA2 = "";
let consultaB = "";

// Amanha, 09:00 em Fortaleza (UTC-3): so precisa ser um horario valido.
const amanha = new Date(Date.now() + 24 * 60 * 60_000)
  .toISOString()
  .slice(0, 10);
const inicio = new Date(`${amanha}T09:00:00-03:00`).toISOString();
const fim = new Date(`${amanha}T09:30:00-03:00`).toISOString();

async function criarPessoa(
  apelido: string,
  clinicId: string,
  role: string,
  professionalId: string | null = null,
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(apelido),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: apelido },
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuário"}`);
  }
  ids.set(apelido, data.user.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status: "ativo",
      professional_id: professionalId,
    })
    .throwOnError();
  const cliente = anonClient();
  const { error: erroLogin } = await cliente.auth.signInWithPassword({
    email: email(apelido),
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login ${apelido}: ${erroLogin.message}`);
  }
  clientes.set(apelido, cliente);
}

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `IA agenda RLS ${nome} ${sufixo}`,
      slug: `ia-agenda-rls-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
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

/** Contato e conversa "na IA" (so a linha; a clinica nao e liberada). */
async function contatoEConversa(
  clinicId: string,
  numero: string,
  final: string,
): Promise<{ contato: string; conversa: string }> {
  const contato = await inserir("contact", {
    clinic_id: clinicId,
    phone_e164: `+55849${digitos}${final}`,
    name: `Contato sintético ${final}`,
  });
  const conversa = await inserir("conversation", {
    clinic_id: clinicId,
    contact_id: contato,
    status: "ia_atendendo",
    whatsapp_account_id: numero,
  });
  return { contato, conversa };
}

/** Consulta recusada que a IA marcou, com a reserva consumida que a liga a conversa. */
async function consultaRecusadaDaIa(params: {
  clinicId: string;
  profissional: string;
  vinculo: string;
  contato: string;
  conversa: string;
}): Promise<string> {
  const consulta = await inserir("appointment", {
    clinic_id: params.clinicId,
    contact_id: params.contato,
    professional_id: params.profissional,
    service_link_id: params.vinculo,
    starts_at: inicio,
    ends_at: fim,
    status: "cancelado_clinica",
    created_by: "ia",
    approval_status: "recusado",
    send_confirmation: false,
    oferecer_vaga_ao_cancelar: false,
  });
  await inserir("slot_hold", {
    clinic_id: params.clinicId,
    professional_id: params.profissional,
    contact_id: params.contato,
    service_link_id: params.vinculo,
    conversation_id: params.conversa,
    job_id: crypto.randomUUID(),
    job_id_do_agendar: crypto.randomUUID(),
    consumido_em: new Date().toISOString(),
    appointment_id: consulta,
    starts_at: inicio,
    ends_at: fim,
    expires_at: new Date().toISOString(),
    created_by: "ia",
  });
  return consulta;
}

async function estadoDaConversa(
  conversa: string,
): Promise<{ status: string; awaiting_reply: boolean; eventos: string[] }> {
  const [{ data: linha }, { data: eventos }] = await Promise.all([
    admin
      .from("conversation")
      .select("status, awaiting_reply")
      .eq("id", conversa)
      .single()
      .throwOnError(),
    admin
      .from("message")
      .select("body")
      .eq("conversation_id", conversa)
      .eq("content_type", "evento")
      .order("created_at")
      .throwOnError(),
  ]);
  const { status, awaiting_reply } = linha as {
    status: string;
    awaiting_reply: boolean;
  };
  return {
    status,
    awaiting_reply,
    eventos: (eventos as { body: string }[]).map((m) => m.body),
  };
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  numeroA = (await criarNumeroDeTeste(admin, clinicaA, { nome: "Recepção" }))
    .id;
  numeroB = (await criarNumeroDeTeste(admin, clinicaB, { nome: "Recepção" }))
    .id;

  p1 = await inserir("professional", { clinic_id: clinicaA, name: "Dra. Um" });
  p2 = await inserir("professional", { clinic_id: clinicaA, name: "Dr. Dois" });
  pb = await inserir("professional", { clinic_id: clinicaB, name: "Dra. B" });
  const xa = await inserir("procedure", {
    clinic_id: clinicaA,
    name: "Consulta A",
  });
  const xb = await inserir("procedure", {
    clinic_id: clinicaB,
    name: "Consulta B",
  });
  l1 = await inserir("service_link", {
    clinic_id: clinicaA,
    professional_id: p1,
    procedure_id: xa,
    duration_min: 30,
  });
  l2 = await inserir("service_link", {
    clinic_id: clinicaA,
    professional_id: p2,
    procedure_id: xa,
    duration_min: 30,
  });
  lb = await inserir("service_link", {
    clinic_id: clinicaB,
    professional_id: pb,
    procedure_id: xb,
    duration_min: 30,
  });

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("profissional-a", clinicaA, "profissional", p1);
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa("admin-b", clinicaB, "admin");

  ({ contato: contatoA1, conversa: conversaA1 } = await contatoEConversa(
    clinicaA,
    numeroA,
    "01",
  ));
  ({ contato: contatoA2, conversa: conversaA2 } = await contatoEConversa(
    clinicaA,
    numeroA,
    "02",
  ));
  ({ contato: contatoB, conversa: conversaB } = await contatoEConversa(
    clinicaB,
    numeroB,
    "03",
  ));

  // O rascunho da A pela RPC de sempre (o servidor) e uma versao publicada
  // da B, ja com a antecedencia e o horizonte.
  const { data: rascunho, error } = await admin.rpc(
    "garantir_rascunho_do_agente",
    {
      p_clinic_id: clinicaA,
    },
  );
  expect(error).toBeNull();
  rascunhoA = rascunho as string;
  publicadaB = await inserir("ai_agent_config", {
    clinic_id: clinicaB,
    version: 1,
    status: "publicada",
    skills: { agendar: true },
    agenda_antecedencia_horas: 2,
    agenda_horizonte_dias: 30,
  });

  // Reservas da IA vivas (P1 e P2 na A, PB na B). Uma hora de validade, e
  // nao os 10 minutos da RPC: a suite cria usuarios antes e a manutencao do
  // motor apaga a reserva vencida.
  const reserva = (
    clinicId: string,
    profissional: string,
    vinculo: string,
    conversa: string,
    contato: string,
  ) =>
    inserir("slot_hold", {
      clinic_id: clinicId,
      professional_id: profissional,
      contact_id: contato,
      service_link_id: vinculo,
      conversation_id: conversa,
      job_id: crypto.randomUUID(),
      starts_at: inicio,
      ends_at: fim,
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      created_by: "ia",
    });
  reservaA1 = await reserva(clinicaA, p1, l1, conversaA1, contatoA1);
  reservaA2 = await reserva(clinicaA, p2, l2, conversaA2, contatoA2);
  reservaB = await reserva(clinicaB, pb, lb, conversaB, contatoB);

  // Consultas recusadas da IA (com a reserva consumida que as liga a conversa).
  consultaA1 = await consultaRecusadaDaIa({
    clinicId: clinicaA,
    profissional: p1,
    vinculo: l1,
    contato: contatoA1,
    conversa: conversaA1,
  });
  consultaA2 = await consultaRecusadaDaIa({
    clinicId: clinicaA,
    profissional: p2,
    vinculo: l2,
    contato: contatoA2,
    conversa: conversaA2,
  });
  consultaB = await consultaRecusadaDaIa({
    clinicId: clinicaB,
    profissional: pb,
    vinculo: lb,
    contato: contatoB,
    conversa: conversaB,
  });
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (let pagina = 1; pagina <= 10; pagina++) {
    const { data } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    const usuarios = data?.users ?? [];
    for (const usuario of usuarios) {
      if (usuario.email?.includes(`-${sufixo}@teste.dev`)) {
        await admin.auth.admin.deleteUser(usuario.id);
      }
    }
    if (usuarios.length < 200) {
      break;
    }
  }
});

describe("ai_agent_config: antecedência e horizonte por papel", () => {
  it("todo membro ativo da A lê as duas colunas; a B não lê a da A; anon não lê", async () => {
    for (const quem of MEMBROS_ATIVOS_DA_A) {
      const { data, error } = await como(quem)
        .from("ai_agent_config")
        .select(COLUNAS_DA_AGENDA)
        .eq("id", rascunhoA);
      expect(error, quem).toBeNull();
      expect(data, quem).toEqual([
        {
          id: rascunhoA,
          agenda_antecedencia_horas: null,
          agenda_horizonte_dias: null,
        },
      ]);
    }
    const { data: daB, error: erroDaB } = await como("admin-b")
      .from("ai_agent_config")
      .select(COLUNAS_DA_AGENDA)
      .eq("clinic_id", clinicaA);
    expect(erroDaB).toBeNull();
    expect(daB).toEqual([]);
    // Positivo: a B le a dela.
    const { data: propria } = await como("admin-b")
      .from("ai_agent_config")
      .select(COLUNAS_DA_AGENDA)
      .eq("id", publicadaB);
    expect(propria).toEqual([
      {
        id: publicadaB,
        agenda_antecedencia_horas: 2,
        agenda_horizonte_dias: 30,
      },
    ]);

    const { error: erroAnon } = await anonClient()
      .from("ai_agent_config")
      .select(COLUNAS_DA_AGENDA)
      .eq("id", rascunhoA);
    expect(erroAnon?.code).toBe(PERMISSAO_NEGADA);
  });

  it("administrador e gestor gravam as duas no rascunho; recepção, profissional, leitura e a B não", async () => {
    const { data: doAdmin, error } = await como("admin-a")
      .from("ai_agent_config")
      .update({ agenda_antecedencia_horas: 2, agenda_horizonte_dias: 30 })
      .eq("id", rascunhoA)
      .select("agenda_antecedencia_horas, agenda_horizonte_dias");
    expect(error).toBeNull();
    expect(doAdmin).toEqual([
      { agenda_antecedencia_horas: 2, agenda_horizonte_dias: 30 },
    ]);
    const { data: doGestor } = await como("gestor-a")
      .from("ai_agent_config")
      .update({ agenda_antecedencia_horas: 4 })
      .eq("id", rascunhoA)
      .select("agenda_antecedencia_horas, agenda_horizonte_dias");
    expect(doGestor).toEqual([
      { agenda_antecedencia_horas: 4, agenda_horizonte_dias: 30 },
    ]);

    for (const quem of [
      "recepcao-a",
      "profissional-a",
      "leitura-a",
      "admin-b",
    ] as const) {
      const { data, error: erro } = await como(quem)
        .from("ai_agent_config")
        .update({ agenda_antecedencia_horas: 99, agenda_horizonte_dias: 99 })
        .eq("id", rascunhoA)
        .select("id");
      // Sem permissao, a RLS esconde a linha: zero linhas (ou 42501).
      if (erro) {
        expect(erro.code, quem).toBe(PERMISSAO_NEGADA);
      } else {
        expect(data, quem).toEqual([]);
      }
    }
    const { data: depois } = await admin
      .from("ai_agent_config")
      .select("agenda_antecedencia_horas, agenda_horizonte_dias")
      .eq("id", rascunhoA)
      .single()
      .throwOnError();
    expect(depois).toEqual({
      agenda_antecedencia_horas: 4,
      agenda_horizonte_dias: 30,
    });
  });

  it("o CHECK de faixa vale para a sessão (23514)", async () => {
    for (const valores of [
      { agenda_antecedencia_horas: 721 },
      { agenda_antecedencia_horas: -1 },
      { agenda_horizonte_dias: 0 },
      { agenda_horizonte_dias: 366 },
    ]) {
      const { error } = await como("admin-a")
        .from("ai_agent_config")
        .update(valores)
        .eq("id", rascunhoA);
      expect(error?.code, JSON.stringify(valores)).toBe(FORA_DA_FAIXA);
    }
  });

  it("a versão publicada não muda pela sessão, nem do administrador dela", async () => {
    const { data, error } = await como("admin-b")
      .from("ai_agent_config")
      .update({ agenda_horizonte_dias: 90 })
      .eq("id", publicadaB)
      .select("id");
    if (error) {
      expect(error.code).toBe(PERMISSAO_NEGADA);
    } else {
      expect(data).toEqual([]);
    }
    const { data: depois } = await admin
      .from("ai_agent_config")
      .select("agenda_horizonte_dias")
      .eq("id", publicadaB)
      .single()
      .throwOnError();
    expect(depois).toEqual({ agenda_horizonte_dias: 30 });
  });
});

describe("slot_hold: as colunas novas por papel", () => {
  it("a A lê as reservas dela com as colunas novas; o profissional só as da própria agenda", async () => {
    for (const quem of [
      "admin-a",
      "gestor-a",
      "recepcao-a",
      "leitura-a",
    ] as const) {
      const { data, error } = await como(quem)
        .from("slot_hold")
        .select(COLUNAS_DA_RESERVA)
        .eq("clinic_id", clinicaA)
        .is("consumido_em", null)
        .order("id");
      expect(error, quem).toBeNull();
      const linhas = data as {
        id: string;
        conversation_id: string;
        service_link_id: string;
      }[];
      expect(linhas.map((l) => l.id).sort(), quem).toEqual(
        [reservaA1, reservaA2].sort(),
      );
      const a1 = linhas.find((l) => l.id === reservaA1)!;
      expect(a1.conversation_id, quem).toBe(conversaA1);
      expect(a1.service_link_id, quem).toBe(l1);
    }
    const { data: doProfissional } = await como("profissional-a")
      .from("slot_hold")
      .select(COLUNAS_DA_RESERVA)
      .eq("clinic_id", clinicaA);
    const agenda = doProfissional as {
      id: string;
      professional_id: string;
      appointment_id: string | null;
    }[];
    expect(agenda.length).toBeGreaterThan(0);
    expect(agenda.every((l) => l.professional_id === p1)).toBe(true);
    expect(agenda.map((l) => l.id)).toContain(reservaA1);
    expect(agenda.map((l) => l.appointment_id)).toContain(consultaA1);
  });

  it("a B não vê as reservas da A, a A não vê as da B, e anon não vê nada", async () => {
    const { data: daBNaA } = await como("admin-b")
      .from("slot_hold")
      .select(COLUNAS_DA_RESERVA)
      .eq("clinic_id", clinicaA);
    expect(daBNaA).toEqual([]);
    const { data: daANaB } = await como("admin-a")
      .from("slot_hold")
      .select(COLUNAS_DA_RESERVA)
      .eq("clinic_id", clinicaB);
    expect(daANaB).toEqual([]);
    // Positivo: a B ve a dela.
    const { data: propria } = await como("admin-b")
      .from("slot_hold")
      .select("id")
      .eq("id", reservaB);
    expect(propria).toEqual([{ id: reservaB }]);

    const { data: doAnon, error } = await anonClient()
      .from("slot_hold")
      .select(COLUNAS_DA_RESERVA)
      .in("clinic_id", [clinicaA, clinicaB]);
    if (error) {
      expect(error.code).toBe(PERMISSAO_NEGADA);
    } else {
      expect(doAnon).toEqual([]);
    }
  });

  it("a sessão não consome nem reaponta reserva (sem policy de update)", async () => {
    const { data, error } = await como("recepcao-a")
      .from("slot_hold")
      .update({
        consumido_em: new Date().toISOString(),
        conversation_id: conversaA2,
        job_id_do_agendar: crypto.randomUUID(),
      })
      .eq("id", reservaA1)
      .select("id");
    if (error) {
      expect(error.code).toBe(PERMISSAO_NEGADA);
    } else {
      expect(data).toEqual([]);
    }
    const { data: depois } = await admin
      .from("slot_hold")
      .select("consumido_em, conversation_id, job_id_do_agendar")
      .eq("id", reservaA1)
      .single()
      .throwOnError();
    expect(depois).toEqual({
      consumido_em: null,
      conversation_id: conversaA1,
      job_id_do_agendar: null,
    });
  });

  it("a sessão não cria reserva com vínculo, conversa ou consulta de outra clínica, nem reserva da IA sem job", async () => {
    const base = {
      clinic_id: clinicaA,
      professional_id: p1,
      starts_at: inicio,
      ends_at: fim,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      created_by: "usuario",
    };
    for (const [caso, extra] of [
      ["vínculo da B", { service_link_id: lb }],
      ["vínculo de outro profissional", { service_link_id: l2 }],
      ["conversa da B", { conversation_id: conversaB }],
      [
        "consulta da B",
        { appointment_id: consultaB, consumido_em: new Date().toISOString() },
      ],
    ] as const) {
      const { error } = await como("recepcao-a")
        .from("slot_hold")
        .insert({ ...base, ...extra });
      expect(error?.code, caso).toBe(DE_OUTRA_CLINICA);
    }
    const { error: semJob } = await como("recepcao-a")
      .from("slot_hold")
      .insert({
        ...base,
        created_by: "ia",
        service_link_id: l1,
        conversation_id: conversaA1,
      });
    expect(semJob?.code).toBe(FORA_DA_FAIXA);
    // Positivo: a reserva da recepcao, da propria clinica, entra.
    const { error: valida } = await como("recepcao-a")
      .from("slot_hold")
      .insert({ ...base, service_link_id: l1 });
    expect(valida).toBeNull();
  });
});

describe("reservar_horario_da_ia e agendar_pela_ia: só o servidor", () => {
  const argsDoReservar = () => ({
    p_clinic_id: clinicaA,
    p_conversation_id: conversaA1,
    p_service_link_id: l1,
    p_starts_at: inicio,
    p_job_id: crypto.randomUUID(),
  });
  const argsDoAgendar = () => ({
    p_clinic_id: clinicaA,
    p_conversation_id: conversaA1,
    p_job_id: crypto.randomUUID(),
  });

  it("nenhuma sessão nem anon chama (42501)", async () => {
    const sessoes: [string, SupabaseClient][] = [
      ...TODAS_AS_SESSOES.map(
        (quem) => [quem, como(quem)] as [string, SupabaseClient],
      ),
      ["anon", anonClient()],
    ];
    for (const [quem, cliente] of sessoes) {
      const reservar = await cliente.rpc(
        "reservar_horario_da_ia",
        argsDoReservar(),
      );
      expect(reservar.error?.code, `${quem} reservar`).toBe(PERMISSAO_NEGADA);
      const agendar = await cliente.rpc("agendar_pela_ia", argsDoAgendar());
      expect(agendar.error?.code, `${quem} agendar`).toBe(PERMISSAO_NEGADA);
    }
    const { count } = await admin
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA)
      .neq("status", "cancelado_clinica")
      .throwOnError();
    expect(count).toBe(0);
  });

  it("o servidor chama: resposta de negócio, nunca erro de permissão", async () => {
    // A clinica de teste nao tem a IA liberada: as duas dizem ia_desligada.
    const reservar = await admin.rpc(
      "reservar_horario_da_ia",
      argsDoReservar(),
    );
    expect(reservar.error).toBeNull();
    expect(reservar.data).toEqual({ ok: false, motivo: "ia_desligada" });
    const agendar = await admin.rpc("agendar_pela_ia", argsDoAgendar());
    expect(agendar.error).toBeNull();
    expect(agendar.data).toEqual({ ok: false, motivo: "ia_desligada" });
    // Anti falso positivo: o servidor nao marcou nada.
    const { count } = await admin
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA)
      .eq("created_by", "ia")
      .eq("approval_status", "pendente")
      .throwOnError();
    expect(count).toBe(0);
  });
});

describe("devolver_conversa_da_consulta_recusada: quem escreve na clínica", () => {
  const devolver = (
    cliente: SupabaseClient,
    clinicId: string,
    consulta: string,
  ) =>
    cliente.rpc("devolver_conversa_da_consulta_recusada", {
      p_clinic_id: clinicId,
      p_appointment_id: consulta,
    });

  it("anon, leitura, o profissional de outra agenda e a clínica B: 42501, e nada muda", async () => {
    const negados: [string, SupabaseClient, string][] = [
      ["anon", anonClient(), consultaA1],
      ["leitura-a", como("leitura-a"), consultaA1],
      ["profissional-a na agenda do P2", como("profissional-a"), consultaA2],
      ["admin-b", como("admin-b"), consultaA1],
    ];
    for (const [quem, cliente, consulta] of negados) {
      const { error } = await devolver(cliente, clinicaA, consulta);
      expect(error?.code, quem).toBe(PERMISSAO_NEGADA);
    }
    for (const conversa of [conversaA1, conversaA2]) {
      expect(await estadoDaConversa(conversa)).toEqual({
        status: "ia_atendendo",
        awaiting_reply: false,
        eventos: [],
      });
    }
  });

  it("a recepção devolve: a conversa vai para a equipe com Aguardando você e o evento", async () => {
    const { data, error } = await devolver(
      como("recepcao-a"),
      clinicaA,
      consultaA1,
    );
    expect(error).toBeNull();
    expect(data).toBe(true);
    expect(await estadoDaConversa(conversaA1)).toEqual({
      status: "aguardando_humano",
      awaiting_reply: true,
      eventos: [EVENTO_DA_RECUSA],
    });
  });

  it("o profissional na própria agenda e o servidor também devolvem", async () => {
    const doProfissional = await devolver(
      como("profissional-a"),
      clinicaA,
      consultaA1,
    );
    expect(doProfissional.error).toBeNull();
    expect(doProfissional.data).toBe(true);
    const doServidor = await devolver(admin, clinicaA, consultaA2);
    expect(doServidor.error).toBeNull();
    expect(doServidor.data).toBe(true);
    expect(await estadoDaConversa(conversaA2)).toEqual({
      status: "aguardando_humano",
      awaiting_reply: true,
      eventos: [EVENTO_DA_RECUSA],
    });
  });

  it("a clínica A não devolve a consulta da B; a B devolve a dela", async () => {
    const comOIdDaB = await devolver(como("admin-a"), clinicaB, consultaB);
    expect(comOIdDaB.error?.code).toBe(PERMISSAO_NEGADA);
    const comOIdDaA = await devolver(como("admin-a"), clinicaA, consultaB);
    expect(comOIdDaA.error).toBeNull();
    expect(comOIdDaA.data).toBe(false);
    expect((await estadoDaConversa(conversaB)).eventos).toEqual([]);

    const daPropriaB = await devolver(como("admin-b"), clinicaB, consultaB);
    expect(daPropriaB.error).toBeNull();
    expect(daPropriaB.data).toBe(true);
    expect(await estadoDaConversa(conversaB)).toEqual({
      status: "aguardando_humano",
      awaiting_reply: true,
      eventos: [EVENTO_DA_RECUSA],
    });
  });
});

describe("onda 2 (M1): conversao so na aprovacao", () => {
  // Depois de amanha, a tarde, na agenda do Dr. Dois (fora dos horarios
  // dos outros testes): cada consulta num horario proprio.
  const depois = new Date(Date.now() + 2 * 24 * 60 * 60_000)
    .toISOString()
    .slice(0, 10);
  const horario = (hora: string) => ({
    starts_at: new Date(`${depois}T${hora}:00-03:00`).toISOString(),
    ends_at: new Date(`${depois}T${hora}:30-03:00`).toISOString(),
  });

  async function contatoLead(final: string): Promise<string> {
    return inserir("contact", {
      clinic_id: clinicaA,
      phone_e164: `+55849${digitos}${final}`,
      name: `Contato sintético ${final}`,
    });
  }

  async function pendente(contato: string, hora: string): Promise<string> {
    return inserir("appointment", {
      clinic_id: clinicaA,
      contact_id: contato,
      professional_id: p2,
      service_link_id: l2,
      ...horario(hora),
      status: "agendado",
      created_by: "ia",
      approval_status: "pendente",
      send_confirmation: false,
    });
  }

  async function kindDe(contato: string): Promise<string> {
    const { data } = await admin
      .from("contact")
      .select("kind")
      .eq("id", contato)
      .single()
      .throwOnError();
    return (data as { kind: string }).kind;
  }

  it("a pendente nao converte; aprovar pela recepcao converte; recusar nao", async () => {
    const aprova = await contatoLead("21");
    const consultaAprova = await pendente(aprova, "13:00");
    expect(await kindDe(aprova)).toBe("lead");
    const { data: aprovada, error } = await como("recepcao-a")
      .from("appointment")
      .update({ approval_status: "aprovado", send_confirmation: true })
      .eq("id", consultaAprova)
      .select("id");
    expect(error).toBeNull();
    expect(aprovada).toEqual([{ id: consultaAprova }]);
    expect(await kindDe(aprova)).toBe("paciente");

    const recusa = await contatoLead("22");
    const consultaRecusa = await pendente(recusa, "14:00");
    const { data: recusada, error: erroRecusa } = await como("recepcao-a")
      .from("appointment")
      .update({
        approval_status: "recusado",
        status: "cancelado_clinica",
        oferecer_vaga_ao_cancelar: false,
      })
      .eq("id", consultaRecusa)
      .select("id");
    expect(erroRecusa).toBeNull();
    expect(recusada).toEqual([{ id: consultaRecusa }]);
    expect(await kindDe(recusa)).toBe("lead");
  });

  it("a sessao nao muda o status da pendente (23514 consulta_pendente); cancelar passa", async () => {
    const contato = await contatoLead("23");
    const consulta = await pendente(contato, "15:00");
    for (const status of [
      "confirmado_recepcao",
      "na_recepcao",
      "compareceu",
      "faltou",
    ]) {
      const { error } = await como("recepcao-a")
        .from("appointment")
        .update({ status })
        .eq("id", consulta);
      expect(error?.code, status).toBe(FORA_DA_FAIXA);
      expect(error?.message, status).toBe("consulta_pendente");
    }
    const { data: lida } = await admin
      .from("appointment")
      .select("status, approval_status")
      .eq("id", consulta)
      .single()
      .throwOnError();
    expect(lida).toEqual({ status: "agendado", approval_status: "pendente" });
    expect(await kindDe(contato)).toBe("lead");
    const { data: cancelada, error } = await como("recepcao-a")
      .from("appointment")
      .update({ status: "cancelado_clinica", oferecer_vaga_ao_cancelar: false })
      .eq("id", consulta)
      .select("id");
    expect(error).toBeNull();
    expect(cancelada).toEqual([{ id: consulta }]);
    expect(await kindDe(contato)).toBe("lead");
  });

  it("a B nao le nem aprova a consulta da A; nada converte", async () => {
    const contato = await contatoLead("24");
    const consulta = await pendente(contato, "16:00");
    const { data: lida } = await como("admin-b")
      .from("appointment")
      .select("id")
      .eq("id", consulta);
    expect(lida).toEqual([]);
    const { data: aprovada } = await como("admin-b")
      .from("appointment")
      .update({ approval_status: "aprovado" })
      .eq("id", consulta)
      .select("id");
    expect(aprovada ?? []).toEqual([]);
    const { data: pelaLeitura } = await como("leitura-a")
      .from("appointment")
      .update({ approval_status: "aprovado" })
      .eq("id", consulta)
      .select("id");
    expect(pelaLeitura ?? []).toEqual([]);
    expect(await kindDe(contato)).toBe("lead");
    // contraprova: a A le a propria
    const { data: daA } = await como("recepcao-a")
      .from("appointment")
      .select("id")
      .eq("id", consulta);
    expect(daA).toEqual([{ id: consulta }]);
  });
});
