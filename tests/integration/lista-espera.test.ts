import { afterAll, describe, expect, it } from "vitest";

import {
  interceptarRespostaDePaciente as interceptarDeVerdade,
  type EntradaDaResposta,
} from "@/lib/integrations/whatsapp/interceptar-resposta";
import {
  executarOfertaDeEspera,
  situacaoDoEnvioDeOferta,
} from "@/lib/jobs/lista-espera";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";
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

/**
 * O paciente responde a oferta que RECEBEU. O interceptador so trata como
 * pergunta a oferta cuja mensagem de fato saiu para o contato (message com o
 * job_id do envio, como send.ts grava; revisao de 24/09, achado 60), e o
 * motor de producao ignora clinicas de teste. Entao, antes de cada resposta,
 * a mensagem da oferta deste contato "sai": so ela, so dele, sem tocar no
 * canal e sem mexer no status do job.
 */
async function interceptarRespostaDePaciente(
  cliente: typeof admin,
  entrada: EntradaDaResposta,
): Promise<void> {
  const { data: ofertas } = await admin
    .from("waitlist_offer")
    .select("id, created_at")
    .eq("clinic_id", entrada.clinicId)
    .contains("offered_to", [entrada.contactId]);
  const ids = new Set((ofertas ?? []).map((o) => o.id as string));
  const criadas = new Set(
    (ofertas ?? []).map((o) => new Date(o.created_at as string).getTime()),
  );
  const { data: envios } = await admin
    .from("job_queue")
    .select("id, payload, created_at")
    .eq("clinic_id", entrada.clinicId)
    .eq("kind", "enviar_mensagem_ativa")
    .eq("payload->>contact_id", entrada.contactId);
  for (const envio of (envios ?? []) as {
    id: string;
    payload: { offer_id?: string };
    created_at: string;
  }[]) {
    const daOferta =
      (envio.payload.offer_id !== undefined && ids.has(envio.payload.offer_id)) ||
      criadas.has(new Date(envio.created_at).getTime());
    if (!daOferta) {
      continue;
    }
    const { data: jaSaiu } = await admin
      .from("message")
      .select("id")
      .eq("clinic_id", entrada.clinicId)
      .eq("job_id", envio.id)
      .maybeSingle();
    if (jaSaiu) {
      continue;
    }
    await admin
      .from("message")
      .insert({
        clinic_id: entrada.clinicId,
        conversation_id: entrada.conversationId,
        direction: "saida",
        author: "sistema",
        content_type: "texto",
        body: "Mensagem da oferta (simulada no teste)",
        job_id: envio.id,
        delivery_status: "enviada",
        billable: false,
        cost_cents: 0,
      })
      .throwOnError();
  }
  await interceptarDeVerdade(cliente, entrada);
}

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
  // Jornada de 24h em todos os dias (duas janelas encostadas, a segunda
  // vira o dia): a vaga so e oferecida DENTRO da jornada, e os cenarios
  // caem em qualquer hora do relogio.
  await admin
    .from("professional_schedule")
    .insert(
      [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
        {
          clinic_id: clinicId,
          professional_id: prof!.id,
          weekday,
          starts_at: "00:00",
          ends_at: "12:00",
        },
        {
          clinic_id: clinicId,
          professional_id: prof!.id,
          weekday,
          starts_at: "12:00",
          ends_at: "00:00",
        },
      ]),
    )
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
  opts: {
    prioridade?: number;
    consentimento?: boolean;
    convenio?: string;
    /** undefined = o procedimento do cenario; null = qualquer procedimento. */
    procedimento?: string | null;
  } = {},
): Promise<string> {
  contador += 1;
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: cenario.clinicId,
      phone_e164: `+55849781${String(contador).padStart(5, "0")}`,
      name: `Fila ${contador}`,
      insurance_id: opts.convenio ?? null,
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
      procedure_id:
        opts.procedimento === undefined
          ? cenario.procedureId
          : opts.procedimento,
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

/** Executa o job de oferta mais recente e devolve o resultado cru. */
async function executarUltimoJobCru(clinicId: string) {
  const jobs = await jobsDeOferta(clinicId);
  expect(jobs.length).toBeGreaterThan(0);
  const job = jobs[jobs.length - 1]!;
  const resultado = await executarOfertaDeEspera(
    admin,
    job as unknown as Job,
  );
  // Higiene: o job fica concluido para o motor real nao repeti-lo.
  await admin
    .from("job_queue")
    .update({ status: "concluido", completed_at: new Date().toISOString() })
    .eq("id", job.id as string);
  return resultado;
}

async function executarUltimoJob(clinicId: string) {
  expect(await executarUltimoJobCru(clinicId)).toEqual({ ok: true });
}

async function enviosDaOferta(clinicId: string, offerId: string) {
  const { data } = await admin
    .from("job_queue")
    .select("id, status, last_error, payload")
    .eq("clinic_id", clinicId)
    .eq("kind", "enviar_mensagem_ativa")
    .contains("payload", { offer_id: offerId });
  return data ?? [];
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

async function mudarConexao(
  clinicId: string,
  status: "conectado" | "desconectado",
): Promise<void> {
  await admin
    .from("whatsapp_account")
    .update({ connection_status: status })
    .eq("clinic_id", clinicId)
    .throwOnError();
}

/** Jobs de oferta ainda na fila (o motor de producao ignora clinica de teste). */
async function pendentesDeOferta(clinicId: string) {
  const { data } = await admin
    .from("job_queue")
    .select(
      "id, clinic_id, kind, payload, attempts, max_attempts, status, run_at, devolucoes, ultimo_motivo_devolucao",
    )
    .eq("clinic_id", clinicId)
    .eq("kind", "oferecer_lista_espera")
    .eq("status", "pendente")
    .order("created_at")
    .throwOnError();
  return data ?? [];
}

/**
 * Uma volta pelo caminho REAL do motor, so para este job: o claim (que o
 * teste faz na mao, porque claim_jobs pegaria jobs de outras clinicas) e
 * depois executarJobComPosse, que confere a posse e fecha no banco com
 * concluir_job, reagendar_job ou falhar_job. A hora do run_at e ignorada de
 * proposito: cada volta simula a passagem do tempo.
 */
async function rodarPeloMotor(
  linha: Awaited<ReturnType<typeof pendentesDeOferta>>[number],
  workerId: string,
) {
  const attempts = (linha.attempts as number) + 1;
  await admin
    .from("job_queue")
    .update({
      status: "executando",
      locked_by: workerId,
      locked_at: new Date().toISOString(),
      attempts,
    })
    .eq("id", linha.id as string)
    .eq("status", "pendente")
    .throwOnError();
  return executarJobComPosse(admin, workerId, {
    id: linha.id as string,
    clinic_id: linha.clinic_id as string,
    kind: "oferecer_lista_espera",
    payload: linha.payload as Record<string, unknown>,
    attempts,
    max_attempts: linha.max_attempts as number,
  });
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

  it("contato com duas entradas: o aceite usa a que CASOU, não a mais antiga", async () => {
    const cenario = await montarCenario("duasentradas");
    // Segundo procedimento e vinculo, ambos atendidos pelo profissional.
    const { data: proc2 } = await admin
      .from("procedure")
      .insert({
        clinic_id: cenario.clinicId,
        name: "Avaliação Espera",
        default_duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: vinculo2 } = await admin
      .from("service_link")
      .insert({
        clinic_id: cenario.clinicId,
        professional_id: cenario.professionalId,
        procedure_id: proc2!.id,
        insurance_id: null,
        price_cents: 5000,
        covered_by_insurance: false,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();

    contador += 1;
    const { data: contato } = await admin
      .from("contact")
      .insert({
        clinic_id: cenario.clinicId,
        phone_e164: `+55849785${String(contador).padStart(5, "0")}`,
        name: "Dois Pedidos",
      })
      .select("id")
      .single()
      .throwOnError();
    const contactId = contato!.id as string;
    await admin
      .from("contact_consent")
      .insert({
        clinic_id: cenario.clinicId,
        contact_id: contactId,
        channel: "whatsapp",
        source: "recepcao",
      })
      .throwOnError();

    // A vaga vai cair num horário específico; a entrada ANTIGA (proc 1) só
    // aceita um turno que NÃO é o da vaga, então ela é excluída da onda.
    const { appointmentId, startsAt } = await consultaParaCancelar(cenario);
    const horaLocal = new Date(startsAt).getUTCHours();
    // Fortaleza é UTC-3: turno da vaga no fuso da clínica.
    const horaClinica = (horaLocal - 3 + 24) % 24;
    const turnoDaVaga =
      horaClinica < 12 ? "manha" : horaClinica < 18 ? "tarde" : "noite";
    const turnoOposto = turnoDaVaga === "manha" ? "noite" : "manha";

    await admin
      .from("waitlist")
      .insert({
        clinic_id: cenario.clinicId,
        contact_id: contactId,
        procedure_id: cenario.procedureId,
        preferred_shifts: [turnoOposto],
        priority: 10,
      })
      .throwOnError();
    await admin
      .from("waitlist")
      .insert({
        clinic_id: cenario.clinicId,
        contact_id: contactId,
        procedure_id: proc2!.id,
        priority: 20,
      })
      .throwOnError();

    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    const oferta = await ofertaAberta(cenario.clinicId);
    expect(oferta!.offered_to).toEqual([contactId]);
    expect(oferta!.matched_waitlist_ids).toHaveLength(1);

    const { data } = await admin.rpc("aceitar_oferta_de_espera", {
      p_clinic_id: cenario.clinicId,
      p_offer_id: oferta!.id as string,
      p_contact_id: contactId,
    });
    expect((data as { ok: boolean }).ok).toBe(true);

    // O appointment usa o vínculo do procedimento que CASOU (o segundo),
    // não o da entrada mais antiga que foi excluída pelo turno.
    const { data: nova } = await admin
      .from("appointment")
      .select("service_link_id")
      .eq("contact_id", contactId)
      .eq("status", "agendado")
      .single();
    expect(nova!.service_link_id).toBe(vinculo2!.id);

    // E a fila baixa a entrada certa: a que casou sai, a outra continua.
    const { data: fila } = await admin
      .from("waitlist")
      .select("procedure_id, active")
      .eq("clinic_id", cenario.clinicId)
      .eq("contact_id", contactId);
    const casou = fila!.find((linha) => linha.procedure_id === proc2!.id);
    const outra = fila!.find(
      (linha) => linha.procedure_id === cenario.procedureId,
    );
    expect(casou!.active).toBe(false);
    expect(outra!.active).toBe(true);
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
    // O cron de producao roda expirar_ofertas_de_espera a cada minuto e pode
    // chegar antes: o que se afirma e o ESTADO (a oferta expirou), nunca a
    // contagem devolvida por ESTA chamada.
    await admin.rpc("expirar_ofertas_de_espera");
    const { data: venceu } = await admin
      .from("waitlist_offer")
      .select("status")
      .eq("id", primeira!.id as string)
      .single();
    expect(venceu!.status).toBe("expirada");

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

// Revisao de liberacao (24/09/2026), migration 20260924104000.
describe("a vaga precisa existir (bloqueio, profissional, jornada, escolha da recepção)", () => {
  async function semOfertaNenhuma(clinicId: string) {
    const { data } = await admin
      .from("waitlist_offer")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(data ?? []).toHaveLength(0);
  }

  it("bloqueio (férias) sobre o horário: nenhuma oferta, com ou sem encaixe permitido", async () => {
    const cenario = await montarCenario("bloqueio");
    await contatoNaFila(cenario);
    const { appointmentId, startsAt } = await consultaParaCancelar(cenario);
    await admin
      .from("professional_block")
      .insert({
        clinic_id: cenario.clinicId,
        professional_id: cenario.professionalId,
        starts_at: new Date(startsAt.getTime() - DIA).toISOString(),
        ends_at: new Date(startsAt.getTime() + DIA).toISOString(),
        reason: "Férias",
        // Bloqueio que ACEITA encaixe tambem conta: a oferta nunca e encaixe.
        blocks_overbooking: false,
      })
      .throwOnError();
    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    await semOfertaNenhuma(cenario.clinicId);
  });

  it("profissional desativado: nenhuma oferta", async () => {
    const cenario = await montarCenario("inativo");
    await contatoNaFila(cenario);
    const { appointmentId } = await consultaParaCancelar(cenario);
    await admin
      .from("professional")
      .update({ active: false })
      .eq("id", cenario.professionalId)
      .throwOnError();
    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    await semOfertaNenhuma(cenario.clinicId);
  });

  it("horário fora da jornada: nenhuma oferta", async () => {
    const cenario = await montarCenario("jornada");
    await contatoNaFila(cenario);
    const { appointmentId, startsAt } = await consultaParaCancelar(cenario);
    // Jornada so no dia da semana SEGUINTE ao da vaga (fuso da clinica).
    const diaDaVaga = new Date(startsAt.getTime() - 3 * 60 * MINUTO).getUTCDay();
    await admin
      .from("professional_schedule")
      .delete()
      .eq("professional_id", cenario.professionalId)
      .neq("weekday", (diaDaVaga + 1) % 7)
      .throwOnError();
    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    await semOfertaNenhuma(cenario.clinicId);
  });

  it("recepção cancelou escolhendo não oferecer: nem job nasce", async () => {
    const cenario = await montarCenario("naooferecer");
    await contatoNaFila(cenario);
    const { appointmentId } = await consultaParaCancelar(cenario);
    await admin
      .from("appointment")
      .update({ status: "cancelado_clinica", oferecer_vaga_ao_cancelar: false })
      .eq("id", appointmentId)
      .throwOnError();
    expect(await jobsDeOferta(cenario.clinicId)).toHaveLength(0);
  });

  it("bloqueio criado DEPOIS da onda: o SIM é recusado e a oferta morre com os envios", async () => {
    const cenario = await montarCenario("bloqueiodepois");
    const naFila = await contatoNaFila(cenario);
    const { appointmentId, startsAt } = await consultaParaCancelar(cenario);
    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    const oferta = await ofertaAberta(cenario.clinicId);
    expect(oferta!.status).toBe("aberta");

    await admin
      .from("professional_block")
      .insert({
        clinic_id: cenario.clinicId,
        professional_id: cenario.professionalId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 60 * MINUTO).toISOString(),
        reason: "Médica doente",
      })
      .throwOnError();
    const { data } = await admin.rpc("aceitar_oferta_de_espera", {
      p_clinic_id: cenario.clinicId,
      p_offer_id: oferta!.id as string,
      p_contact_id: naFila,
    });
    expect((data as { ok: boolean }).ok).toBe(false);
    expect((data as { erro?: string }).erro).toBe("horario_ocupado");
    const depois = await ofertaAberta(cenario.clinicId);
    expect(depois!.status).toBe("cancelada");
    // Nenhuma consulta nasceu dentro do bloqueio.
    const { data: consultas } = await admin
      .from("appointment")
      .select("id")
      .eq("clinic_id", cenario.clinicId)
      .eq("contact_id", naFila);
    expect(consultas ?? []).toHaveLength(0);
    // Os envios que ainda estavam na fila morreram junto.
    for (const envio of await enviosDaOferta(
      cenario.clinicId,
      oferta!.id as string,
    )) {
      expect(["cancelado", "concluido", "falhou"]).toContain(envio.status);
    }
  });
});

describe("o aceite casa o vínculo certo", () => {
  it("convênio do contato, fim pela duração do vínculo e recurso do procedimento", async () => {
    const cenario = await montarCenario("convenio");
    const { data: convenio } = await admin
      .from("insurance")
      .insert({ clinic_id: cenario.clinicId, name: "Plano Teste" })
      .select("id")
      .single()
      .throwOnError();
    const { data: sala } = await admin
      .from("resource")
      .insert({ clinic_id: cenario.clinicId, name: "Sala 1", kind: "sala" })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("procedure")
      .update({ resource_id: sala!.id })
      .eq("id", cenario.procedureId)
      .throwOnError();
    const { data: vinculoConvenio } = await admin
      .from("service_link")
      .insert({
        clinic_id: cenario.clinicId,
        professional_id: cenario.professionalId,
        procedure_id: cenario.procedureId,
        insurance_id: convenio!.id,
        price_cents: 8000,
        covered_by_insurance: true,
        duration_min: 20,
      })
      .select("id")
      .single()
      .throwOnError();

    const conveniado = await contatoNaFila(cenario, {
      convenio: convenio!.id as string,
      // "Qualquer procedimento": herda o PROCEDIMENTO da vaga, nunca o
      // vinculo particular de quem cancelou.
      procedimento: null,
    });
    const { appointmentId, startsAt } = await consultaParaCancelar(cenario);
    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    const oferta = await ofertaAberta(cenario.clinicId);
    expect(oferta!.offered_to).toEqual([conveniado]);

    const { data } = await admin.rpc("aceitar_oferta_de_espera", {
      p_clinic_id: cenario.clinicId,
      p_offer_id: oferta!.id as string,
      p_contact_id: conveniado,
    });
    expect((data as { ok: boolean }).ok).toBe(true);
    const { data: nova } = await admin
      .from("appointment")
      .select("service_link_id, starts_at, ends_at, resource_id")
      .eq("id", (data as { appointment_id: string }).appointment_id)
      .single();
    expect(nova!.service_link_id).toBe(vinculoConvenio!.id);
    expect(new Date(nova!.starts_at as string).getTime()).toBe(
      startsAt.getTime(),
    );
    expect(new Date(nova!.ends_at as string).getTime()).toBe(
      startsAt.getTime() + 20 * MINUTO,
    );
    expect(nova!.resource_id).toBe(sala!.id);
  });

  it("procedimento que não cabe na vaga fica de fora da onda", async () => {
    const cenario = await montarCenario("naocabe");
    const { data: longo } = await admin
      .from("procedure")
      .insert({
        clinic_id: cenario.clinicId,
        name: "Consulta Longa",
        default_duration_min: 60,
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("service_link")
      .insert({
        clinic_id: cenario.clinicId,
        professional_id: cenario.professionalId,
        procedure_id: longo!.id,
        insurance_id: null,
        price_cents: 30000,
        covered_by_insurance: false,
        duration_min: 60,
      })
      .throwOnError();
    await contatoNaFila(cenario, { procedimento: longo!.id as string });
    const { appointmentId } = await consultaParaCancelar(cenario);
    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    expect(await ofertaAberta(cenario.clinicId)).toBeNull();
  });
});

describe("envio amarrado à oferta", () => {
  it("cada mensagem da onda leva o offer_id; oferta encerrada não envia", async () => {
    const cenario = await montarCenario("amarrado");
    const naFila = await contatoNaFila(cenario);
    const { appointmentId } = await consultaParaCancelar(cenario);
    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    const oferta = await ofertaAberta(cenario.clinicId);
    const offerId = oferta!.id as string;

    const envios = await enviosDaOferta(cenario.clinicId, offerId);
    expect(envios).toHaveLength(1);
    expect(
      await situacaoDoEnvioDeOferta(admin, cenario.clinicId, offerId, naFila),
    ).toBe("enviar");

    // Sem folga: faltando menos da metade da janela, a mensagem nao sai.
    const agora = Date.now();
    await admin
      .from("waitlist_offer")
      .update({
        created_at: new Date(agora - 60 * MINUTO).toISOString(),
        expires_at: new Date(agora + 10 * MINUTO).toISOString(),
      })
      .eq("id", offerId)
      .throwOnError();
    expect(
      await situacaoDoEnvioDeOferta(admin, cenario.clinicId, offerId, naFila),
    ).toBe("encerrada");

    // Cancelada (o que a RPC da tela faz, pelo motor): status e fila.
    await admin
      .from("waitlist_offer")
      .update({ status: "cancelada" })
      .eq("id", offerId)
      .throwOnError();
    await admin.rpc("encerrar_envios_da_oferta", {
      p_clinic_id: cenario.clinicId,
      p_offer_id: offerId,
    });
    expect(
      await situacaoDoEnvioDeOferta(admin, cenario.clinicId, offerId, naFila),
    ).toBe("encerrada");
    const depois = await enviosDaOferta(cenario.clinicId, offerId);
    expect(depois.every((envio) => envio.status !== "pendente")).toBe(true);
  });

  it("WhatsApp desconectado: a oferta não nasce e a vaga volta depois, numa continuação", async () => {
    const cenario = await montarCenario("desconectado");
    await contatoNaFila(cenario);
    await mudarConexao(cenario.clinicId, "desconectado");
    const { appointmentId } = await consultaParaCancelar(cenario);
    await cancelar(appointmentId);
    const [original] = await pendentesDeOferta(cenario.clinicId);
    const antes = Date.now();
    const resultado = await executarOfertaDeEspera(
      admin,
      original as unknown as Job,
    );
    // A passagem conclui: a espera nao gasta o teto de devolucoes da fila.
    expect(resultado).toEqual({ ok: true });
    expect(await ofertaAberta(cenario.clinicId)).toBeNull();

    const continuacoes = (await pendentesDeOferta(cenario.clinicId)).filter(
      (job) => job.id !== original!.id,
    );
    expect(continuacoes).toHaveLength(1);
    const continuacao = continuacoes[0]!;
    expect(continuacao.payload).toEqual({
      appointment_id: appointmentId,
      passo_reconexao: 1,
    });
    expect(continuacao.devolucoes).toBe(0);
    expect(continuacao.ultimo_motivo_devolucao).toBe("whatsapp_desconectado");
    // Primeira volta: 5 minutos.
    const espera = new Date(continuacao.run_at as string).getTime() - antes;
    expect(espera).toBeGreaterThanOrEqual(5 * MINUTO - 5_000);
    expect(espera).toBeLessThanOrEqual(5 * MINUTO + 60_000);
  });

  it("queda longa: mais de 20 voltas pelo motor sem o job morrer, e a oferta nasce quando o WhatsApp volta", async () => {
    // Revisao da leva 1, achado R2: cada volta passava por reagendar_job, que
    // mata o job na 20a devolucao (cerca de 3 horas de queda), e a vaga
    // nunca era oferecida. Aqui cada volta passa pelo caminho REAL do motor
    // (posse, execucao, concluir/reagendar/falhar no banco).
    const cenario = await montarCenario("quedalonga");
    const naFila = await contatoNaFila(cenario);
    await mudarConexao(cenario.clinicId, "desconectado");
    const { appointmentId, startsAt } = await consultaParaCancelar(cenario, 3);
    await cancelar(appointmentId);
    const limite = startsAt.getTime() - 30 * MINUTO;

    const workerId = `teste-queda-${sufixo}`;
    const VOLTAS = 25;
    for (let volta = 0; volta < VOLTAS; volta += 1) {
      const pendentes = await pendentesDeOferta(cenario.clinicId);
      expect(pendentes).toHaveLength(1);
      expect(await rodarPeloMotor(pendentes[0]!, workerId)).toBe("concluido");
    }

    const { data: falhos } = await admin
      .from("job_queue")
      .select("id")
      .eq("clinic_id", cenario.clinicId)
      .eq("kind", "oferecer_lista_espera")
      .in("status", ["falhou", "executando"])
      .throwOnError();
    expect(falhos).toHaveLength(0);
    expect(await ofertaAberta(cenario.clinicId)).toBeNull();

    const pendentes = await pendentesDeOferta(cenario.clinicId);
    expect(pendentes).toHaveLength(1);
    const continuacao = pendentes[0]!;
    expect(continuacao.payload).toEqual({
      appointment_id: appointmentId,
      passo_reconexao: VOLTAS,
    });
    expect(continuacao.devolucoes).toBe(0);
    // Passo alto: a espera parou no teto de 30 minutos, antes do limite.
    const runAt = new Date(continuacao.run_at as string).getTime();
    expect(runAt).toBeGreaterThan(Date.now() + 25 * MINUTO);
    expect(runAt).toBeLessThan(limite);

    // O WhatsApp volta: a proxima volta oferece a vaga e a corrente termina.
    await mudarConexao(cenario.clinicId, "conectado");
    expect(await rodarPeloMotor(continuacao, workerId)).toBe("concluido");
    const oferta = await ofertaAberta(cenario.clinicId);
    expect(oferta?.status).toBe("aberta");
    expect(oferta!.offered_to).toEqual([naFila]);
    expect(await pendentesDeOferta(cenario.clinicId)).toHaveLength(0);
    // Mais de 20 voltas reais pelo motor, cada uma perto de 1 s contra o banco.
  }, 120_000);

  it("WhatsApp desconectado sem tempo útil antes do limite: desiste sem continuação", async () => {
    const cenario = await montarCenario("semtempo");
    await contatoNaFila(cenario);
    await mudarConexao(cenario.clinicId, "desconectado");
    // Inicio daqui a 30 min e 40 s: o limite (inicio menos a janela de 30
    // min) fica a 40 s, menos que a folga da ultima volta.
    const { appointmentId } = await consultaParaCancelar(
      cenario,
      (30 * MINUTO + 40_000) / DIA,
    );
    await cancelar(appointmentId);
    const [original] = await pendentesDeOferta(cenario.clinicId);
    expect(
      await executarOfertaDeEspera(admin, original as unknown as Job),
    ).toEqual({ ok: true });
    const continuacoes = (await pendentesDeOferta(cenario.clinicId)).filter(
      (job) => job.id !== original!.id,
    );
    expect(continuacoes).toHaveLength(0);
    expect(await ofertaAberta(cenario.clinicId)).toBeNull();
  });
});

describe("segunda vaga ao mesmo tempo", () => {
  it("quem serve está preso na primeira oferta: a segunda vaga espera em vez de sumir", async () => {
    const cenario = await montarCenario("segundavaga");
    const unico = await contatoNaFila(cenario, { procedimento: null });
    const primeira = await consultaParaCancelar(cenario, 7);
    const segunda = await consultaParaCancelar(cenario, 8);
    await cancelar(primeira.appointmentId);
    await cancelar(segunda.appointmentId);

    const jobs = await jobsDeOferta(cenario.clinicId);
    expect(jobs).toHaveLength(2);
    // A primeira vaga vira oferta para o unico da fila.
    const r1 = await executarOfertaDeEspera(admin, jobs[0] as unknown as Job);
    expect(r1).toEqual({ ok: true });
    const oferta = await ofertaAberta(cenario.clinicId);
    expect(oferta!.offered_to).toEqual([unico]);

    // A segunda nao tem ninguem LIVRE, mas tem alguem preso: volta depois.
    const r2 = await executarOfertaDeEspera(admin, jobs[1] as unknown as Job);
    expect(r2).toMatchObject({ motivo: "vaga_aguardando_outra_oferta" });
    const quando = new Date((r2 as { reagendar: string }).reagendar).getTime();
    expect(quando).toBeGreaterThan(Date.now());
    expect(quando).toBeLessThan(segunda.startsAt.getTime());

    for (const job of jobs) {
      await admin
        .from("job_queue")
        .update({ status: "concluido", completed_at: new Date().toISOString() })
        .eq("id", job.id as string);
    }
  });
});

describe("ordem entre grupos", () => {
  it("reordenar um grupo não passa o grupo inteiro na frente de quem espera há mais tempo", async () => {
    const cenario = await montarCenario("grupos");
    await admin
      .from("clinic")
      .update({ waitlist_wave_size: 1 })
      .eq("id", cenario.clinicId)
      .throwOnError();
    // Chega primeiro, no grupo "qualquer procedimento".
    const antiga = await contatoNaFila(cenario, {
      procedimento: null,
      prioridade: 1000000,
    });
    // Chega depois, no grupo do procedimento, e a recepcao "reordena"
    // (prioridade baixa, como mover_na_lista_de_espera deixa).
    const reordenada = await contatoNaFila(cenario, { prioridade: 10 });
    const { appointmentId } = await consultaParaCancelar(cenario);
    await cancelar(appointmentId);
    await executarUltimoJob(cenario.clinicId);
    const oferta = await ofertaAberta(cenario.clinicId);
    expect(oferta!.offered_to).toEqual([antiga]);
    expect(oferta!.offered_to).not.toContain(reordenada);
  });
});
