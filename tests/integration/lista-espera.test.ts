import { afterAll, describe, expect, it } from "vitest";

import { interceptarRespostaDePaciente } from "@/lib/integrations/whatsapp/interceptar-resposta";
import { executarOfertaDeEspera } from "@/lib/jobs/lista-espera";
import type { Job } from "@/lib/jobs/worker";
import {
  RESPOSTA_OFERTA_PERDIDA,
  RESPOSTA_OFERTA_RECUSADA,
} from "@/lib/domain/textos-padrao";
import { adminClient } from "../rls/stack";

// Tarefa 4.9 contra o banco REAL: o aceite do backlog e literalmente o
// cenario 2 ("cancelar um agendamento dispara oferta e o segundo a responder
// recebe recusa educada, nao o horario"). Clinicas e_de_teste: o motor de
// producao as ignora; cada cenario executa o proprio job.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];
const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;

type Cenario = {
  clinicId: string;
  professionalId: string;
  procedureId: string;
  serviceLinkId: string;
};

async function montarCenario(nome: string): Promise<Cenario> {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Espera ${nome} ${sufixo}`,
      slug: `esperai-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = clinica!.id as string;
  clinicasCriadas.push(clinicId);
  await admin
    .from("whatsapp_account")
    .insert({
      clinic_id: clinicId,
      provider: "fake",
      connection_status: "conectado",
    })
    .throwOnError();
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dra. Espera" })
    .select("id")
    .single()
    .throwOnError();
  const { data: proc } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinicId,
      name: "Consulta Espera",
      default_duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: prof!.id,
      procedure_id: proc!.id,
      insurance_id: null,
      price_cents: 20000,
      covered_by_insurance: false,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  return {
    clinicId,
    professionalId: prof!.id as string,
    procedureId: proc!.id as string,
    serviceLinkId: vinculo!.id as string,
  };
}

let contador = 0;
async function contatoNaFila(
  cenario: Cenario,
  opts: { prioridade?: number; consentimento?: boolean } = {},
): Promise<string> {
  contador += 1;
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: cenario.clinicId,
      phone_e164: `+55849781${String(contador).padStart(5, "0")}`,
      name: `Fila ${contador}`,
    })
    .select("id")
    .single()
    .throwOnError();
  const contactId = data!.id as string;
  if (opts.consentimento !== false) {
    await admin
      .from("contact_consent")
      .insert({
        clinic_id: cenario.clinicId,
        contact_id: contactId,
        channel: "whatsapp",
        source: "recepcao",
      })
      .throwOnError();
  }
  await admin
    .from("waitlist")
    .insert({
      clinic_id: cenario.clinicId,
      contact_id: contactId,
      procedure_id: cenario.procedureId,
      priority: opts.prioridade ?? 0,
    })
    .throwOnError();
  return contactId;
}

/** Consulta futura (mais longe que a janela de 30 min) que vai ser cancelada. */
async function consultaParaCancelar(
  cenario: Cenario,
  emDias = 7,
): Promise<{ appointmentId: string; contactId: string; startsAt: Date }> {
  contador += 1;
  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: cenario.clinicId,
      phone_e164: `+55849782${String(contador).padStart(5, "0")}`,
      name: "Quem Cancelou",
    })
    .select("id")
    .single()
    .throwOnError();
  const startsAt = new Date(Date.now() + emDias * DIA);
  const { data } = await admin
    .from("appointment")
    .insert({
      clinic_id: cenario.clinicId,
      contact_id: contato!.id,
      professional_id: cenario.professionalId,
      service_link_id: cenario.serviceLinkId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 30 * MINUTO).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  return {
    appointmentId: data!.id as string,
    contactId: contato!.id as string,
    startsAt,
  };
}

async function cancelar(appointmentId: string): Promise<void> {
  await admin
    .from("appointment")
    .update({ status: "cancelado_clinica" })
    .eq("id", appointmentId)
    .throwOnError();
}

async function jobsDeOferta(clinicId: string) {
  const { data } = await admin
    .from("job_queue")
    .select("id, clinic_id, kind, payload, attempts, max_attempts, status")
    .eq("clinic_id", clinicId)
    .eq("kind", "oferecer_lista_espera")
    .order("created_at");
  return data ?? [];
}

async function executarUltimoJob(clinicId: string) {
  const jobs = await jobsDeOferta(clinicId);
  expect(jobs.length).toBeGreaterThan(0);
  const job = jobs[jobs.length - 1]!;
  const resultado = await executarOfertaDeEspera(
    admin,
    job as unknown as Job,
  );
  expect(resultado).toEqual({ ok: true });
  // Higiene: o job fica concluido para o motor real nao repeti-lo.
  await admin
    .from("job_queue")
    .update({ status: "concluido", completed_at: new Date().toISOString() })
    .eq("id", job.id as string);
}

async function ofertaAberta(clinicId: string) {
  const { data } = await admin
    .from("waitlist_offer")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function ecosDoContato(clinicId: string, contactId: string) {
  const { data } = await admin
    .from("job_queue")
    .select("payload")
    .eq("clinic_id", clinicId)
    .eq("kind", "enviar_mensagem_ativa")
    .contains("payload", { contact_id: contactId });
  return ((data ?? []) as { payload: { body?: string } }[]).map(
    (linha) => linha.payload.body ?? "",
  );
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("lista de espera de ponta a ponta, contra o banco real", () => {
  it("cancelar dispara o job; a onda respeita prioridade, tamanho e consentimento", async () => {
    const cenario = await montarCenario("onda");
    // Onda de 2 para a prova de corte.
    await admin
      .from("clinic")
      .update({ waitlist_wave_size: 2 })
      .eq("id", cenario.clinicId)
      .throwOnError();
    const vip = await contatoNaFila(cenario, { prioridade: -5 });
    const semConsent = await contatoNaFila(cenario, {
      prioridade: -10,
      consentimento: false,
    });
    const comum1 = await contatoNaFila(cenario);
    await contatoNaFila(cenario); // quarto, fica de fora do corte

    const { appointmentId } = await consultaParaCancelar(cenario);
    await cancelar(appointmentId);

    const jobs = await jobsDeOferta(cenario.clinicId);
    expect(jobs).toHaveLength(1);
    await executarUltimoJob(cenario.clinicId);

    const oferta = await ofertaAberta(cenario.clinicId);
    expect(oferta?.status).toBe("aberta");
    // Sem consentimento NAO entra, mesmo com a maior prioridade.
    expect(oferta!.offered_to).not.toContain(semConsent);
    expect(oferta!.offered_to).toEqual([vip, comum1]);

    // As mensagens da onda nasceram junto (uma por destinatario).
    const { data: envios } = await admin
      .from("job_queue")
      .select("id")
      .eq("clinic_id", cenario.clinicId)
      .eq("kind", "enviar_mensagem_ativa");
    expect(envios).toHaveLength(2);
  });

  it("ACEITE: o primeiro a responder leva; o segundo recebe recusa educada", async () => {
    const cenario = await montarCenario("aceite");
    const primeiro = await contatoNaFila(cenario);
    const segundo = await contatoNaFila(cenario);
    const { appointmentId, startsAt } = await consultaParaCancelar(cenario);
    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    const oferta = await ofertaAberta(cenario.clinicId);
    expect(oferta!.offered_to).toEqual([primeiro, segundo]);

    // As respostas chegam pelo caminho REAL (interceptador + RPC).
    const conversa = async (contactId: string) => {
      const { data } = await admin.rpc("garantir_conversa_aberta", {
        p_clinic_id: cenario.clinicId,
        p_contact_id: contactId,
      });
      return data as string;
    };
    await interceptarRespostaDePaciente(admin, {
      clinicId: cenario.clinicId,
      contactId: primeiro,
      conversationId: await conversa(primeiro),
      body: "SIM",
      contentType: "texto",
    });
    await interceptarRespostaDePaciente(admin, {
      clinicId: cenario.clinicId,
      contactId: segundo,
      conversationId: await conversa(segundo),
      body: "sim",
      contentType: "texto",
    });

    const depois = await ofertaAberta(cenario.clinicId);
    expect(depois!.status).toBe("preenchida");
    expect(depois!.responded_by).toBe(primeiro);
    expect(depois!.appointment_id).not.toBeNull();

    // O horario e do primeiro, de verdade (appointment agendado no slot).
    const { data: novo } = await admin
      .from("appointment")
      .select("contact_id, status, starts_at, created_by")
      .eq("id", depois!.appointment_id as string)
      .single();
    expect(novo!.contact_id).toBe(primeiro);
    expect(novo!.status).toBe("agendado");
    expect(new Date(novo!.starts_at as string).getTime()).toBe(
      startsAt.getTime(),
    );
    expect(novo!.created_by).toBe("sistema");

    // A recusa educada do segundo (o aceite literal da 4.9).
    const ecos = await ecosDoContato(cenario.clinicId, segundo);
    expect(ecos).toContain(RESPOSTA_OFERTA_PERDIDA);

    // O vencedor saiu da fila.
    const { data: filaDoPrimeiro } = await admin
      .from("waitlist")
      .select("active")
      .eq("clinic_id", cenario.clinicId)
      .eq("contact_id", primeiro)
      .single();
    expect(filaDoPrimeiro!.active).toBe(false);

    // O VENCEDOR repete "sim" (ou agradece com "ok"): NUNCA pode ouvir que
    // perdeu (correcao da revisao de 15/09). Nenhum eco de PERDIDA para ele.
    await interceptarRespostaDePaciente(admin, {
      clinicId: cenario.clinicId,
      contactId: primeiro,
      conversationId: await conversa(primeiro),
      body: "ok",
      contentType: "texto",
    });
    const ecosDoVencedor = await ecosDoContato(cenario.clinicId, primeiro);
    expect(ecosDoVencedor).not.toContain(RESPOSTA_OFERTA_PERDIDA);
  });

  it("corrida com marcação manual: o banco arbitra e a oferta morre honesta", async () => {
    const cenario = await montarCenario("corrida");
    const naFila = await contatoNaFila(cenario);
    const { appointmentId, startsAt } = await consultaParaCancelar(cenario);
    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    const oferta = await ofertaAberta(cenario.clinicId);

    // A recepcao marca outra pessoa NO MESMO horario antes da resposta.
    contador += 1;
    const { data: outro } = await admin
      .from("contact")
      .insert({
        clinic_id: cenario.clinicId,
        phone_e164: `+55849783${String(contador).padStart(5, "0")}`,
        name: "Marcado Na Mao",
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("appointment")
      .insert({
        clinic_id: cenario.clinicId,
        contact_id: outro!.id,
        professional_id: cenario.professionalId,
        service_link_id: cenario.serviceLinkId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 30 * MINUTO).toISOString(),
      })
      .throwOnError();

    const { data } = await admin.rpc("aceitar_oferta_de_espera", {
      p_clinic_id: cenario.clinicId,
      p_offer_id: oferta!.id as string,
      p_contact_id: naFila,
    });
    expect((data as { ok: boolean; erro?: string }).ok).toBe(false);
    expect((data as { erro?: string }).erro).toBe("horario_ocupado");
    const depois = await ofertaAberta(cenario.clinicId);
    expect(depois!.status).toBe("cancelada");
  });

  it("janela vencida expira e a próxima onda pega os seguintes, sem repetir ninguém", async () => {
    const cenario = await montarCenario("expira");
    await admin
      .from("clinic")
      .update({ waitlist_wave_size: 1 })
      .eq("id", cenario.clinicId)
      .throwOnError();
    const primeiro = await contatoNaFila(cenario, { prioridade: 0 });
    const seguinte = await contatoNaFila(cenario, { prioridade: 1 });
    const { appointmentId } = await consultaParaCancelar(cenario);
    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    const primeira = await ofertaAberta(cenario.clinicId);
    expect(primeira!.offered_to).toEqual([primeiro]);

    // Viagem no tempo: a janela venceu.
    await admin
      .from("waitlist_offer")
      .update({ expires_at: new Date(Date.now() - MINUTO).toISOString() })
      .eq("id", primeira!.id as string)
      .throwOnError();
    const { data: expiradas } = await admin.rpc("expirar_ofertas_de_espera");
    expect(expiradas).toBeGreaterThanOrEqual(1);

    await executarUltimoJob(cenario.clinicId);
    const segunda = await ofertaAberta(cenario.clinicId);
    expect(segunda!.status).toBe("aberta");
    expect(segunda!.offered_to).toEqual([seguinte]);

    // Fila esgotada: a proxima expiracao nao cria onda nova.
    await admin
      .from("waitlist_offer")
      .update({ expires_at: new Date(Date.now() - MINUTO).toISOString() })
      .eq("id", segunda!.id as string)
      .throwOnError();
    await admin.rpc("expirar_ofertas_de_espera");
    await executarUltimoJob(cenario.clinicId);
    const { data: abertas } = await admin
      .from("waitlist_offer")
      .select("id")
      .eq("clinic_id", cenario.clinicId)
      .eq("status", "aberta");
    expect(abertas).toHaveLength(0);
  });

  it("recusa de todos adianta a próxima onda; quem recusou continua na fila", async () => {
    const cenario = await montarCenario("recusa");
    await admin
      .from("clinic")
      .update({ waitlist_wave_size: 1 })
      .eq("id", cenario.clinicId)
      .throwOnError();
    const recusador = await contatoNaFila(cenario);
    const { appointmentId } = await consultaParaCancelar(cenario);
    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    const oferta = await ofertaAberta(cenario.clinicId);

    const { data: conversa } = await admin.rpc("garantir_conversa_aberta", {
      p_clinic_id: cenario.clinicId,
      p_contact_id: recusador,
    });
    await interceptarRespostaDePaciente(admin, {
      clinicId: cenario.clinicId,
      contactId: recusador,
      conversationId: conversa as string,
      body: "NÃO QUERO",
      contentType: "texto",
    });

    const depois = await ofertaAberta(cenario.clinicId);
    expect(depois!.status).toBe("expirada");
    expect(depois!.declined_by).toContain(recusador);
    const ecos = await ecosDoContato(cenario.clinicId, recusador);
    expect(ecos).toContain(RESPOSTA_OFERTA_RECUSADA);

    // Continua na fila para a proxima vaga.
    const { data: fila } = await admin
      .from("waitlist")
      .select("active")
      .eq("clinic_id", cenario.clinicId)
      .eq("contact_id", recusador)
      .single();
    expect(fila!.active).toBe(true);

    // A onda seguinte partiu, mas quem ja recebeu ESTE horario nao repete:
    // fila so com ele = nenhuma oferta nova.
    await executarUltimoJob(cenario.clinicId);
    const { data: abertas } = await admin
      .from("waitlist_offer")
      .select("id")
      .eq("clinic_id", cenario.clinicId)
      .eq("status", "aberta");
    expect(abertas).toHaveLength(0);
  });

  it("encaixe cancelado e clínica sem fila não enfileiram job", async () => {
    const cenario = await montarCenario("nada");
    // Sem fila ativa: cancelamento comum nao gera job.
    const { appointmentId } = await consultaParaCancelar(cenario);
    await cancelar(appointmentId);
    expect(await jobsDeOferta(cenario.clinicId)).toHaveLength(0);

    // Com fila, mas encaixe (overbooking): o WHEN do gatilho barra.
    await contatoNaFila(cenario);
    contador += 1;
    const { data: contato } = await admin
      .from("contact")
      .insert({
        clinic_id: cenario.clinicId,
        phone_e164: `+55849784${String(contador).padStart(5, "0")}`,
        name: "Encaixe",
      })
      .select("id")
      .single()
      .throwOnError();
    const inicio = new Date(Date.now() + 5 * DIA);
    const { data: encaixe } = await admin
      .from("appointment")
      .insert({
        clinic_id: cenario.clinicId,
        contact_id: contato!.id,
        professional_id: cenario.professionalId,
        service_link_id: cenario.serviceLinkId,
        starts_at: inicio.toISOString(),
        ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
        is_overbooking: true,
        approval_status: "aprovado",
      })
      .select("id")
      .single()
      .throwOnError();
    await cancelar(encaixe!.id as string);
    expect(await jobsDeOferta(cenario.clinicId)).toHaveLength(0);
  });
});
