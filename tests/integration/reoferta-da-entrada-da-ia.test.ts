import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { executarOfertaDeEspera } from "@/lib/jobs/lista-espera";
import type { Job } from "@/lib/jobs/worker";

import { adminClient } from "../rls/stack";

// AG5, D-37 (a confirmar com o dono): a reoferta e o aceite com a entrada da
// IA, contra o banco REAL. A entrada da IA guarda o pagamento (particular ou
// o convenio, estrito) e so vale para o vinculo que a IA marca (vinculo e
// procedimento com "IA pode agendar", convenio ativo); a regra vale no job
// que monta a onda (lib/domain/lista-espera.ts e lib/jobs/lista-espera.ts,
// em TypeScript) e no aceite (aceitar_oferta_de_espera, no banco), a mesma.
// E a PARIDADE: a entrada da equipe, sem pagamento declarado (todas as de
// hoje), segue exatamente a regra de antes (o convenio do contato, senao o
// particular, com qualquer vinculo ativo).
// - a onda no horario da Dra. Ana (vinculos da IA, particular e Unimed): a
//   da IA particular e a da equipe entram; o SIM da da IA marca pelo
//   particular mesmo com Unimed no cadastro;
// - a onda no horario do Dr. Bruno (o vinculo que a IA nao marca): so a da
//   equipe entra; o SIM da da IA, se viesse, seria sem_vinculo;
// - a da IA pela Unimed so casa o vinculo da Unimed;
// - a da IA removida pela recepcao depois da oferta: o SIM ainda marca pela
//   regra dela;
// - a paridade: a da equipe com Unimed no cadastro marca pela Unimed (como
//   antes), e pelo vinculo que a IA nao marca (como antes).
// A revisao de 28/10/2026:
// - R1, a segunda consulta: a da IA de quem ja tem consulta futura do mesmo
//   procedimento fica fora da onda (a da equipe na mesma situacao entra: a
//   paridade); a consulta marcada DEPOIS da onda faz o SIM da da IA ouvir
//   sem_vinculo (a oferta segue aberta, nenhuma segunda consulta); a da
//   equipe ganha a segunda, como antes;
// - R2, o lembrete da oferta (payload.lembrete_da_oferta) morre com a
//   oferta: pelo aceite, pelo encerrar_envios_da_oferta direto e pela
//   expiracao, inclusive o que voltou a pendente esperando o canal; o que
//   executa fica. Os lembretes sao montados com run_at daqui a um dia (o
//   motor de producao nao os pega antes do teste terminar).
// As entradas da IA sao gravadas direto pelo servidor (sem sessao: o gatilho
// deixa), como entrar_na_lista_de_espera_pela_ia grava; o caminho das duas
// fases e do outro arquivo (lista-de-espera-pela-ia.test.ts). O job roda
// pelo codigo de verdade (executarOfertaDeEspera), como o teste da 4.9.
//
// CUIDADO, o banco e o da producao: a clinica e_de_teste com o slug
// reoferta-ia-int-*, apagada no afterAll (fila, ofertas, consultas, jobs e
// mensagens em cascata; o beforeAll apaga a sobra de uma execucao que morreu
// ha mais de uma hora). Nenhuma mensagem sai (o numero e 'fake' e nenhum
// executor de envio roda aqui). ESCRITO, AINDA NAO RODADO: grava no banco.
// Roda depois de aplicar a migration e com o codigo da AG5, com
// npm run test:integration -- reoferta-da-entrada-da-ia.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic
//    where slug like 'reoferta-ia-int-%' and e_de_teste;

const admin = adminClient();
const sufixo = Date.now().toString(36);
const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;

let clinica = "";
let ana = "";
let bruno = "";
let limpeza = "";
let unimed = "";
let lAna = "";
let lAnaUnimed = "";
let lBruno = "";
let contador = 0;
let horas = 0;

async function inserir(tabela: string, linha: Record<string, unknown>): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/** Um contato com a autorizacao do WhatsApp (e o convenio no cadastro, se dado). */
async function contato(convenio: string | null = null): Promise<string> {
  contador += 1;
  const id = await inserir("contact", {
    clinic_id: clinica,
    phone_e164: `+55849783${String(contador).padStart(5, "0")}`,
    name: `Fila IA ${contador}`,
    insurance_id: convenio,
  });
  await admin
    .from("contact_consent")
    .insert({ clinic_id: clinica, contact_id: id, channel: "whatsapp", source: "recepcao" })
    .throwOnError();
  return id;
}

/** A entrada da IA, gravada pelo servidor como a fase 2 grava. */
async function entradaDaIa(
  contactId: string,
  pagamento: { particular: true } | { particular: false; convenio: string },
  criadaHaMinutos: number,
): Promise<string> {
  const conversa = await inserir("conversation", {
    clinic_id: clinica,
    contact_id: contactId,
    status: "resolvida",
    whatsapp_account_id: (
      (await admin.from("whatsapp_account").select("id").eq("clinic_id", clinica).single().throwOnError())
        .data as { id: string }
    ).id,
  });
  return inserir("waitlist", {
    clinic_id: clinica,
    contact_id: contactId,
    procedure_id: limpeza,
    origem: "ia",
    ia_job_id: crypto.randomUUID(),
    conversation_id: conversa,
    particular: pagamento.particular,
    insurance_id: pagamento.particular ? null : pagamento.convenio,
    created_at: new Date(Date.now() - criadaHaMinutos * MINUTO).toISOString(),
  });
}

async function entradaDaEquipe(contactId: string, criadaHaMinutos: number): Promise<string> {
  return inserir("waitlist", {
    clinic_id: clinica,
    contact_id: contactId,
    procedure_id: limpeza,
    created_at: new Date(Date.now() - criadaHaMinutos * MINUTO).toISOString(),
  });
}

/** A consulta que vaga (no vinculo dado, daqui a uns dias) e o cancelamento. */
async function vagarHorario(vinculo: string, profissional: string): Promise<void> {
  horas += 1;
  const quemCancelou = await contato();
  const inicio = new Date(Date.now() + 5 * DIA + horas * 60 * MINUTO);
  const consulta = await inserir("appointment", {
    clinic_id: clinica,
    contact_id: quemCancelou,
    professional_id: profissional,
    service_link_id: vinculo,
    starts_at: inicio.toISOString(),
    ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
  });
  await admin.from("appointment").update({ status: "cancelado_clinica" }).eq("id", consulta).throwOnError();
}

/** Roda o job de oferta mais recente pelo codigo de verdade; devolve a oferta. */
async function ondaMaisRecente(): Promise<{ id: string; offered_to: string[]; matched_waitlist_ids: string[] }> {
  const { data: jobs } = await admin
    .from("job_queue")
    .select("id, clinic_id, kind, payload, attempts, max_attempts")
    .eq("clinic_id", clinica)
    .eq("kind", "oferecer_lista_espera")
    .eq("status", "pendente")
    .order("created_at")
    .throwOnError();
  const job = (jobs ?? [])[(jobs ?? []).length - 1];
  expect(job, "o cancelamento enfileira a reoferta").toBeDefined();
  expect(await executarOfertaDeEspera(admin, job as unknown as Job)).toEqual({ ok: true });
  await admin
    .from("job_queue")
    .update({ status: "concluido", completed_at: new Date().toISOString() })
    .eq("id", (job as { id: string }).id);
  const { data: oferta } = await admin
    .from("waitlist_offer")
    .select("id, offered_to, matched_waitlist_ids")
    .eq("clinic_id", clinica)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  return oferta as { id: string; offered_to: string[]; matched_waitlist_ids: string[] };
}

/** A consulta que a pessoa ja tem (no vinculo dado, daqui a uns dias). */
async function consultaMarcada(contactId: string, vinculo: string, profissional: string): Promise<string> {
  horas += 1;
  const inicio = new Date(Date.now() + 6 * DIA + horas * 60 * MINUTO);
  return inserir("appointment", {
    clinic_id: clinica,
    contact_id: contactId,
    professional_id: profissional,
    service_link_id: vinculo,
    starts_at: inicio.toISOString(),
    ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
  });
}

/**
 * O lembrete da oferta como o interceptador o enfileira (enviar_mensagem_ativa
 * com payload.lembrete_da_oferta), com run_at daqui a um dia; "voltou" =
 * reivindicado e devolvido esperando o canal (reagendar_job, desconectado).
 */
async function lembrete(oferta: string, contactId: string, situacao: "pendente" | "voltou" | "executando"): Promise<string> {
  const id = await inserir("job_queue", {
    clinic_id: clinica,
    kind: "enviar_mensagem_ativa",
    payload: { contact_id: contactId, body: "Lembrete sintético", resposta_ao_paciente: true, lembrete_da_oferta: oferta },
    run_at: new Date(Date.now() + DIA).toISOString(),
    status: situacao === "pendente" ? "pendente" : "executando",
    locked_by: situacao === "pendente" ? null : `reoferta-ia-int-${sufixo}`,
    locked_at: situacao === "pendente" ? null : new Date().toISOString(),
    attempts: situacao === "pendente" ? 0 : 1,
  });
  if (situacao === "voltou") {
    const { data, error } = await admin.rpc("reagendar_job", {
      p_id: id,
      p_worker: `reoferta-ia-int-${sufixo}`,
      p_run_at: new Date(Date.now() + DIA).toISOString(),
      p_motivo: "desconectado",
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  }
  return id;
}

async function situacoes(ids: string[]): Promise<string[]> {
  const { data } = await admin.from("job_queue").select("id, status, last_error").in("id", ids).throwOnError();
  const porId = new Map(
    ((data ?? []) as { id: string; status: string; last_error: string | null }[]).map((j) => [
      j.id,
      `${j.status}:${j.last_error ?? "-"}`,
    ]),
  );
  return ids.map((id) => porId.get(id) ?? "sumiu");
}

async function aceitar(
  oferta: string,
  contactId: string,
): Promise<{ ok: boolean; erro?: string; motivo?: string; appointment_id?: string }> {
  const { data, error } = await admin.rpc("aceitar_oferta_de_espera", {
    p_clinic_id: clinica,
    p_offer_id: oferta,
    p_contact_id: contactId,
  });
  expect(error).toBeNull();
  return data as { ok: boolean; erro?: string; appointment_id?: string };
}

async function vinculoDaConsulta(id: string): Promise<string> {
  const { data } = await admin
    .from("appointment")
    .select("service_link_id, status, created_by")
    .eq("id", id)
    .single()
    .throwOnError();
  const consulta = data as { service_link_id: string; status: string; created_by: string };
  expect(consulta.status).toBe("agendado");
  expect(consulta.created_by).toBe("sistema");
  return consulta.service_link_id;
}

/** Desliga as entradas ativas (cada cenario comeca com a fila vazia). */
async function esvaziarFila(): Promise<void> {
  await admin.from("waitlist").update({ active: false }).eq("clinic_id", clinica).eq("active", true).throwOnError();
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "reoferta-ia-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
  clinica = await inserir("clinic", {
    name: `Reoferta IA ${sufixo}`,
    slug: `reoferta-ia-int-${sufixo}`,
    e_de_teste: true,
  });
  await admin
    .from("whatsapp_account")
    .insert({ clinic_id: clinica, provider: "fake", connection_status: "conectado" })
    .throwOnError();
  ana = await inserir("professional", { clinic_id: clinica, name: "Dra. Ana" });
  bruno = await inserir("professional", { clinic_id: clinica, name: "Dr. Bruno" });
  limpeza = await inserir("procedure", { clinic_id: clinica, name: "Limpeza", default_duration_min: 30 });
  unimed = await inserir("insurance", { clinic_id: clinica, name: "Unimed sintética" });
  lAna = await inserir("service_link", {
    clinic_id: clinica, professional_id: ana, procedure_id: limpeza, duration_min: 30, price_cents: 20000,
    bookable_by_ai: true,
  });
  lAnaUnimed = await inserir("service_link", {
    clinic_id: clinica, professional_id: ana, procedure_id: limpeza, insurance_id: unimed, duration_min: 30,
    covered_by_insurance: true, bookable_by_ai: true,
  });
  lBruno = await inserir("service_link", {
    clinic_id: clinica, professional_id: bruno, procedure_id: limpeza, duration_min: 30, price_cents: 20000,
    bookable_by_ai: false,
  });
  for (const profissional of [ana, bruno]) {
    await admin
      .from("professional_schedule")
      .insert(
        [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
          { clinic_id: clinica, professional_id: profissional, weekday, starts_at: "00:00", ends_at: "12:00" },
          { clinic_id: clinica, professional_id: profissional, weekday, starts_at: "12:00", ends_at: "00:00" },
        ]),
      )
      .throwOnError();
  }
}, 120_000);

afterAll(async () => {
  if (clinica) {
    const { error } = await admin.from("clinic").delete().eq("id", clinica);
    expect(error, "apagar a clinica do teste").toBeNull();
  }
}, 60_000);

describe("a onda e o aceite com a entrada da IA (D-37)", () => {
  it("no horario da Ana: as duas entram; o SIM da da IA marca pelo particular, mesmo com Unimed no cadastro", async () => {
    await esvaziarFila();
    const daIa = await contato(unimed);
    const daEquipe = await contato();
    const entrada = await entradaDaIa(daIa, { particular: true }, 30);
    await entradaDaEquipe(daEquipe, 20);
    await vagarHorario(lAna, ana);
    const oferta = await ondaMaisRecente();
    expect(oferta.offered_to).toEqual([daIa, daEquipe]);
    expect(oferta.matched_waitlist_ids[0]).toBe(entrada);
    const r = await aceitar(oferta.id, daIa);
    expect(r.ok).toBe(true);
    expect(await vinculoDaConsulta(r.appointment_id!)).toBe(lAna);
    const { data } = await admin.from("waitlist").select("active").eq("id", entrada).single().throwOnError();
    expect((data as { active: boolean }).active).toBe(false);
  });

  it("no horario do Bruno (o vinculo que a IA nao marca): so a da equipe entra", async () => {
    await esvaziarFila();
    const daIa = await contato();
    const daEquipe = await contato();
    await entradaDaIa(daIa, { particular: true }, 30);
    await entradaDaEquipe(daEquipe, 20);
    await vagarHorario(lBruno, bruno);
    const oferta = await ondaMaisRecente();
    expect(oferta.offered_to).toEqual([daEquipe]);
    const r = await aceitar(oferta.id, daEquipe);
    expect(r.ok).toBe(true);
    expect(await vinculoDaConsulta(r.appointment_id!)).toBe(lBruno);
  });

  it("a da IA pela Unimed so casa o vinculo da Unimed; o SIM marca pela Unimed", async () => {
    await esvaziarFila();
    const daIa = await contato();
    await entradaDaIa(daIa, { particular: false, convenio: unimed }, 30);
    await vagarHorario(lAna, ana);
    const oferta = await ondaMaisRecente();
    expect(oferta.offered_to).toEqual([daIa]);
    const r = await aceitar(oferta.id, daIa);
    expect(r.ok).toBe(true);
    expect(await vinculoDaConsulta(r.appointment_id!)).toBe(lAnaUnimed);
  });

  it("a da IA removida pela recepcao depois da oferta: o SIM ainda vale pela regra dela", async () => {
    await esvaziarFila();
    const daIa = await contato(unimed);
    const entrada = await entradaDaIa(daIa, { particular: true }, 30);
    await vagarHorario(lAna, ana);
    const oferta = await ondaMaisRecente();
    expect(oferta.offered_to).toEqual([daIa]);
    await admin.from("waitlist").update({ active: false }).eq("id", entrada).throwOnError();
    const r = await aceitar(oferta.id, daIa);
    expect(r.ok).toBe(true);
    expect(await vinculoDaConsulta(r.appointment_id!)).toBe(lAna);
  });

  it("a paridade: a da equipe com Unimed no cadastro marca pela Unimed, como antes", async () => {
    await esvaziarFila();
    const daEquipe = await contato(unimed);
    await entradaDaEquipe(daEquipe, 20);
    await vagarHorario(lAna, ana);
    const oferta = await ondaMaisRecente();
    expect(oferta.offered_to).toEqual([daEquipe]);
    const r = await aceitar(oferta.id, daEquipe);
    expect(r.ok).toBe(true);
    expect(await vinculoDaConsulta(r.appointment_id!)).toBe(lAnaUnimed);
  });
});

describe("a segunda consulta (revisão de 28/10/2026, R1)", () => {
  it("a da IA de quem já tem consulta futura do mesmo procedimento fica fora da onda; a da equipe na mesma situação entra", async () => {
    await esvaziarFila();
    const daIa = await contato();
    const daEquipe = await contato();
    await consultaMarcada(daIa, lBruno, bruno);
    await consultaMarcada(daEquipe, lBruno, bruno);
    await entradaDaIa(daIa, { particular: true }, 30);
    await entradaDaEquipe(daEquipe, 20);
    await vagarHorario(lAna, ana);
    const oferta = await ondaMaisRecente();
    expect(oferta.offered_to).toEqual([daEquipe]);
  });

  it("a consulta marcada depois da onda: o SIM da da IA ouve sem_vinculo, a oferta segue aberta, nada de segunda", async () => {
    await esvaziarFila();
    const daIa = await contato();
    const entrada = await entradaDaIa(daIa, { particular: true }, 30);
    await vagarHorario(lAna, ana);
    const oferta = await ondaMaisRecente();
    expect(oferta.offered_to).toEqual([daIa]);
    await consultaMarcada(daIa, lBruno, bruno);
    expect(await aceitar(oferta.id, daIa)).toEqual({ ok: false, erro: "sem_vinculo", motivo: "ja_tem_consulta" });
    const { data: depois } = await admin.from("waitlist_offer").select("status").eq("id", oferta.id).single().throwOnError();
    expect((depois as { status: string }).status).toBe("aberta");
    const { count } = await admin
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", daIa)
      .not("status", "in", "(cancelado_paciente,cancelado_clinica)")
      .throwOnError();
    expect(count).toBe(1);
    const { data: ativa } = await admin.from("waitlist").select("active").eq("id", entrada).single().throwOnError();
    expect((ativa as { active: boolean }).active).toBe(true);
  });

  it("a paridade: a da equipe com a consulta futura do mesmo procedimento ganha a segunda, como antes", async () => {
    await esvaziarFila();
    const daEquipe = await contato();
    await entradaDaEquipe(daEquipe, 20);
    await vagarHorario(lAna, ana);
    const oferta = await ondaMaisRecente();
    expect(oferta.offered_to).toEqual([daEquipe]);
    await consultaMarcada(daEquipe, lBruno, bruno);
    const r = await aceitar(oferta.id, daEquipe);
    expect(r.ok).toBe(true);
    expect(await vinculoDaConsulta(r.appointment_id!)).toBe(lAna);
  });
});

describe("o lembrete da oferta morre com a oferta (revisão de 28/10/2026, R2)", () => {
  it("pelo aceite: o pendente e o que voltou esperando o canal; o que executa fica", async () => {
    await esvaziarFila();
    const daEquipe = await contato();
    await entradaDaEquipe(daEquipe, 20);
    await vagarHorario(lAna, ana);
    const oferta = await ondaMaisRecente();
    const ids = [
      await lembrete(oferta.id, daEquipe, "pendente"),
      await lembrete(oferta.id, daEquipe, "voltou"),
      await lembrete(oferta.id, daEquipe, "executando"),
    ];
    expect(await situacoes(ids)).toEqual(["pendente:-", "pendente:-", "executando:-"]);
    expect((await aceitar(oferta.id, daEquipe)).ok).toBe(true);
    expect(await situacoes(ids)).toEqual(["cancelado:oferta_encerrada", "cancelado:oferta_encerrada", "executando:-"]);
  });

  it("pelo encerrar_envios_da_oferta direto: os da oferta morrem, o de outra oferta fica", async () => {
    await esvaziarFila();
    const a = await contato();
    const b = await contato();
    await entradaDaEquipe(a, 20);
    await vagarHorario(lAna, ana);
    const oferta = await ondaMaisRecente();
    await esvaziarFila();
    await entradaDaEquipe(b, 20);
    await vagarHorario(lAna, ana);
    const outra = await ondaMaisRecente();
    const daOferta = await lembrete(oferta.id, a, "voltou");
    const daOutra = await lembrete(outra.id, b, "pendente");
    const { data, error } = await admin.rpc("encerrar_envios_da_oferta", { p_clinic_id: clinica, p_offer_id: oferta.id });
    expect(error).toBeNull();
    expect(data).toBeGreaterThanOrEqual(1);
    expect(await situacoes([daOferta, daOutra])).toEqual(["cancelado:oferta_encerrada", "pendente:-"]);
  });

  it("pela expiração: a vencida fecha e o lembrete dela morre (o que voltou inclusive)", async () => {
    await esvaziarFila();
    const daEquipe = await contato();
    await entradaDaEquipe(daEquipe, 20);
    await vagarHorario(lAna, ana);
    const oferta = await ondaMaisRecente();
    const ids = [await lembrete(oferta.id, daEquipe, "pendente"), await lembrete(oferta.id, daEquipe, "voltou")];
    // A consulta da vaga pede "nao oferecer de novo": a onda seguinte que a
    // expiracao enfileira conclui sem efeito.
    const { data: daOferta } = await admin
      .from("waitlist_offer")
      .select("source_appointment_id")
      .eq("id", oferta.id)
      .single()
      .throwOnError();
    await admin
      .from("appointment")
      .update({ oferecer_vaga_ao_cancelar: false })
      .eq("id", (daOferta as { source_appointment_id: string }).source_appointment_id)
      .throwOnError();
    await admin
      .from("waitlist_offer")
      .update({ expires_at: new Date(Date.now() - MINUTO).toISOString() })
      .eq("id", oferta.id)
      .throwOnError();
    // O cron de producao roda a expiracao a cada minuto e pode chegar antes:
    // o efeito e o mesmo.
    const { error } = await admin.rpc("expirar_ofertas_de_espera");
    expect(error).toBeNull();
    const { data: depois } = await admin.from("waitlist_offer").select("status").eq("id", oferta.id).single().throwOnError();
    expect((depois as { status: string }).status).toBe("expirada");
    expect(await situacoes(ids)).toEqual(["cancelado:oferta_encerrada", "cancelado:oferta_encerrada"]);
  });
});
