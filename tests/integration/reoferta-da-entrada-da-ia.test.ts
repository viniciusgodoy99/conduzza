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

async function aceitar(oferta: string, contactId: string): Promise<{ ok: boolean; erro?: string; appointment_id?: string }> {
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
