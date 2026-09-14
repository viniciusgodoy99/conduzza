import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  diaDaSemanaNoFuso,
  montarOnda,
  turnoDoInstante,
  REPOUSO_POS_OFERTA_MS,
  type EntradaDaFila,
} from "@/lib/domain/lista-espera";
import { renderizarModelo } from "@/lib/domain/modelo-mensagem";
import { OFERTA_DE_ESPERA } from "@/lib/domain/textos-padrao";
import { log } from "@/lib/log";
import type { Job, ResultadoDeJob } from "@/lib/jobs/worker";

// Job oferecer_lista_espera (tarefa 4.9): um horario vagou (gatilho de
// cancelamento) ou uma onda morreu sem vencedor (expiracao/recusa geral) e a
// PROXIMA onda precisa partir. Este job monta a onda (casamento de
// preferencias, exclusoes, consentimento) e entrega para a RPC atomica
// criar_oferta_de_espera, que grava a oferta e enfileira as mensagens numa
// transacao so. O envio em si sai pelo executor de envio ativo EXISTENTE,
// que reconfere consentimento e respeita o espacamento anti-ban.
//
// Guardas concluem {ok:true} SEM EFEITO de proposito: execucao tardia (motor
// parado, deploy) nao pode ofertar horario que ja passou nem duplicar onda.
//
// REGRA ABSOLUTA: nenhum dado de paciente em log; so ids.

const TETO_DE_CANDIDATOS = 30;

type Slot = {
  professionalId: string;
  startsAt: string;
  endsAt: string;
  sourceAppointmentId: string;
  contatoQueCancelou: string | null;
  procedimentoDoSlot: string | null;
};

async function carregarSlot(
  admin: SupabaseClient,
  clinicId: string,
  payload: Record<string, unknown>,
): Promise<Slot | null> {
  const carregarDoAppointment = async (appointmentId: string) => {
    const { data } = await admin
      .from("appointment")
      .select(
        "id, professional_id, contact_id, starts_at, ends_at, service_link:service_link_id ( procedure:procedure_id ( name ) )",
      )
      .eq("clinic_id", clinicId)
      .eq("id", appointmentId)
      .maybeSingle();
    if (!data) {
      return null;
    }
    const vinculo = Array.isArray(data.service_link)
      ? data.service_link[0]
      : data.service_link;
    const procedimento = vinculo
      ? Array.isArray(vinculo.procedure)
        ? vinculo.procedure[0]
        : vinculo.procedure
      : null;
    return {
      professionalId: data.professional_id as string,
      startsAt: data.starts_at as string,
      endsAt: data.ends_at as string,
      sourceAppointmentId: data.id as string,
      contatoQueCancelou: (data.contact_id as string | null) ?? null,
      procedimentoDoSlot:
        ((procedimento as { name?: string } | null)?.name as string) ?? null,
    };
  };

  if (typeof payload.appointment_id === "string") {
    return carregarDoAppointment(payload.appointment_id);
  }
  if (typeof payload.origem_offer_id === "string") {
    const { data: oferta } = await admin
      .from("waitlist_offer")
      .select("source_appointment_id")
      .eq("clinic_id", clinicId)
      .eq("id", payload.origem_offer_id)
      .maybeSingle();
    if (!oferta) {
      return null;
    }
    return carregarDoAppointment(oferta.source_appointment_id as string);
  }
  return null;
}

export async function executarOfertaDeEspera(
  admin: SupabaseClient,
  job: Job,
): Promise<ResultadoDeJob> {
  const slot = await carregarSlot(admin, job.clinic_id, job.payload);
  if (!slot) {
    return { ok: false, erro: "payload_invalido", definitivo: true };
  }

  const { data: clinica } = await admin
    .from("clinic")
    .select("name, timezone, waitlist_wave_size, waitlist_response_minutes")
    .eq("id", job.clinic_id)
    .maybeSingle();
  if (!clinica) {
    return { ok: false, erro: "clinica_inexistente", definitivo: true };
  }
  const timezone = clinica.timezone as string;
  const janelaMin = clinica.waitlist_response_minutes as number;
  const tamanhoDaOnda = clinica.waitlist_wave_size as number;

  // GUARDAS: tudo aqui conclui ok sem efeito.
  // A oferta precisa vencer ANTES do horario; slot mais perto que a janela
  // (ou no passado) nao tem o que prometer.
  const inicioDoSlot = new Date(slot.startsAt).getTime();
  if (inicioDoSlot <= Date.now() + janelaMin * 60_000) {
    return { ok: true };
  }
  // O horario continua livre? (a exclusion e por profissional; encaixe fora)
  const { data: ocupacoes } = await admin
    .from("appointment")
    .select("id")
    .eq("clinic_id", job.clinic_id)
    .eq("professional_id", slot.professionalId)
    .eq("is_overbooking", false)
    .not("status", "in", "(cancelado_paciente,cancelado_clinica)")
    .lt("starts_at", slot.endsAt)
    .gt("ends_at", slot.startsAt)
    .limit(1);
  if ((ocupacoes ?? []).length > 0) {
    return { ok: true };
  }
  // Ja existe onda aberta para este horario?
  const { data: abertaExistente } = await admin
    .from("waitlist_offer")
    .select("id")
    .eq("clinic_id", job.clinic_id)
    .eq("professional_id", slot.professionalId)
    .eq("slot_starts_at", slot.startsAt)
    .eq("status", "aberta")
    .limit(1);
  if ((abertaExistente ?? []).length > 0) {
    return { ok: true };
  }

  // EXCLUSOES.
  const excluir = new Set<string>();
  if (slot.contatoQueCancelou) {
    excluir.add(slot.contatoQueCancelou);
  }
  // Quem ja recebeu QUALQUER onda deste horario (inclusive quem recusou).
  const { data: ondasDoSlot } = await admin
    .from("waitlist_offer")
    .select("offered_to")
    .eq("clinic_id", job.clinic_id)
    .eq("source_appointment_id", slot.sourceAppointmentId);
  for (const onda of (ondasDoSlot ?? []) as { offered_to: string[] }[]) {
    for (const contato of onda.offered_to) {
      excluir.add(contato);
    }
  }
  // Um contato em NO MAXIMO uma oferta aberta (determinismo do SIM) e o
  // repouso de 2h entre ofertas de horarios diferentes.
  const desdeRepouso = new Date(
    Date.now() - REPOUSO_POS_OFERTA_MS,
  ).toISOString();
  const { data: outrasOndas } = await admin
    .from("waitlist_offer")
    .select("offered_to, status, created_at")
    .eq("clinic_id", job.clinic_id)
    .or(`status.eq.aberta,created_at.gte.${desdeRepouso}`);
  for (const onda of (outrasOndas ?? []) as { offered_to: string[] }[]) {
    for (const contato of onda.offered_to) {
      excluir.add(contato);
    }
  }
  // Quem ja tem consulta ATIVA em cima do horario oferecido nao precisa dele.
  const { data: conflitantes } = await admin
    .from("appointment")
    .select("contact_id")
    .eq("clinic_id", job.clinic_id)
    .not("status", "in", "(cancelado_paciente,cancelado_clinica)")
    .lt("starts_at", slot.endsAt)
    .gt("ends_at", slot.startsAt);
  for (const linha of (conflitantes ?? []) as { contact_id: string }[]) {
    excluir.add(linha.contact_id);
  }

  // A FILA e o casamento.
  const [{ data: fila }, { data: vinculos }] = await Promise.all([
    admin
      .from("waitlist")
      .select(
        "id, contact_id, procedure_id, professional_id, preferred_shifts, preferred_weekdays, priority, created_at",
      )
      .eq("clinic_id", job.clinic_id)
      .eq("active", true)
      .order("priority")
      .order("created_at")
      .limit(200),
    admin
      .from("service_link")
      .select("procedure_id, procedure:procedure_id ( name )")
      .eq("clinic_id", job.clinic_id)
      .eq("professional_id", slot.professionalId)
      .eq("active", true),
  ]);
  const procedimentosDoProfissional = new Set<string>();
  const nomeDoProcedimento = new Map<string, string>();
  for (const linha of (vinculos ?? []) as {
    procedure_id: string;
    procedure: { name: string }[] | { name: string } | null;
  }[]) {
    procedimentosDoProfissional.add(linha.procedure_id);
    const procedimento = Array.isArray(linha.procedure)
      ? linha.procedure[0]
      : linha.procedure;
    if (procedimento?.name) {
      nomeDoProcedimento.set(linha.procedure_id, procedimento.name);
    }
  }

  const entradas: EntradaDaFila[] = ((fila ?? []) as Record<string, unknown>[]).map(
    (linha) => ({
      id: linha.id as string,
      contactId: linha.contact_id as string,
      procedureId: (linha.procedure_id as string | null) ?? null,
      professionalId: (linha.professional_id as string | null) ?? null,
      preferredShifts: (linha.preferred_shifts as string[] | null) ?? [],
      preferredWeekdays: (linha.preferred_weekdays as number[] | null) ?? [],
      priority: linha.priority as number,
      createdAt: linha.created_at as string,
    }),
  );
  const inicio = new Date(slot.startsAt);
  const candidatos = montarOnda({
    entradas,
    slot: {
      professionalId: slot.professionalId,
      weekday: diaDaSemanaNoFuso(inicio, timezone),
      turno: turnoDoInstante(inicio, timezone),
    },
    procedimentosDoProfissional,
    excluirContatos: excluir,
    // Margem para o consentimento poder pular sem esvaziar a onda.
    tamanho: Math.min(TETO_DE_CANDIDATOS, tamanhoDaOnda + 10),
  });
  if (candidatos.length === 0) {
    return { ok: true };
  }

  // Consentimento por candidato ate encher a onda (o executor de envio
  // reconfere na hora do envio; aqui evita oferta gravada para quem nunca
  // poderia receber).
  const onda: EntradaDaFila[] = [];
  for (const candidato of candidatos) {
    if (onda.length >= tamanhoDaOnda) {
      break;
    }
    const { data: vigente } = await admin.rpc("consentimento_vigente", {
      p_clinic_id: job.clinic_id,
      p_contact_id: candidato.contactId,
      p_channel: "whatsapp",
    });
    if (vigente === true) {
      onda.push(candidato);
    }
  }
  if (onda.length === 0) {
    return { ok: true };
  }

  const { data: contatos } = await admin
    .from("contact")
    .select("id, name")
    .eq("clinic_id", job.clinic_id)
    .in(
      "id",
      onda.map((entrada) => entrada.contactId),
    );
  const nomePorContato = new Map(
    ((contatos ?? []) as { id: string; name: string | null }[]).map(
      (linha) => [linha.id, linha.name],
    ),
  );

  const { data: profissional } = await admin
    .from("professional")
    .select("name")
    .eq("id", slot.professionalId)
    .maybeSingle();
  const inicioLocal = new TZDate(inicio.getTime(), timezone);

  const destinatarios = onda.map((entrada) => ({
    contact_id: entrada.contactId,
    body: renderizarModelo(OFERTA_DE_ESPERA, {
      nome: nomePorContato.get(entrada.contactId) ?? null,
      clinica: clinica.name as string,
      procedimento:
        (entrada.procedureId
          ? nomeDoProcedimento.get(entrada.procedureId)
          : null) ??
        slot.procedimentoDoSlot ??
        "consulta",
      profissional: (profissional?.name as string | undefined) ?? null,
      data: format(inicioLocal, "dd/MM/yyyy", { locale: ptBR }),
      hora: format(inicioLocal, "HH:mm", { locale: ptBR }),
      prazo: String(janelaMin),
    }).trim(),
  }));

  const { data: offerId, error } = await admin.rpc("criar_oferta_de_espera", {
    p_clinic_id: job.clinic_id,
    p_source_appointment_id: slot.sourceAppointmentId,
    p_professional_id: slot.professionalId,
    p_slot_starts_at: slot.startsAt,
    p_slot_ends_at: slot.endsAt,
    p_expires_at: new Date(Date.now() + janelaMin * 60_000).toISOString(),
    p_destinatarios: destinatarios,
  });
  if (error) {
    log.error("oferta_de_espera_falhou", {
      clinic_id: job.clinic_id,
      appointment_id: slot.sourceAppointmentId,
      error_code: error.code ?? null,
    });
    return { ok: false, erro: "criar_oferta_falhou" };
  }
  // null = onda concorrente ja criou: trabalho feito do mesmo jeito.
  void offerId;
  return { ok: true };
}
