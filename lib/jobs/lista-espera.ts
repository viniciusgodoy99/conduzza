import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  diaDaSemanaNoFuso,
  liberacaoPorContato,
  montarOnda,
  proximaEsperaPorReconexao,
  proximaTentativaDaVaga,
  temFolgaParaResponder,
  turnoDoInstante,
  vinculoDaEntrada,
  REPOUSO_POS_OFERTA_MS,
  type EntradaDaFila,
  type SlotVago,
  type VinculoDaVaga,
} from "@/lib/domain/lista-espera";
import { renderizarModelo } from "@/lib/domain/modelo-mensagem";
import { OFERTA_DE_ESPERA } from "@/lib/domain/textos-padrao";
import { log } from "@/lib/log";
import { contasDeEnvio } from "@/lib/jobs/numero-de-envio";
import type { Job, ResultadoDeJob } from "@/lib/jobs/worker";

// Job oferecer_lista_espera (tarefa 4.9): um horario vagou (gatilho de
// cancelamento) ou uma onda morreu sem vencedor (expiracao/recusa geral) e a
// PROXIMA onda precisa partir. Este job monta a onda (casamento de
// preferencias, exclusoes, consentimento) e entrega para a RPC atomica
// criar_oferta_de_espera, que grava a oferta e enfileira as mensagens numa
// transacao so. O envio em si sai pelo executor de envio ativo EXISTENTE,
// que reconfere consentimento e respeita o espacamento anti-ban, e que so
// envia enquanto a oferta vale (situacaoDoEnvioDeOferta, abaixo).
//
// Guardas concluem {ok:true} SEM EFEITO de proposito: execucao tardia (motor
// parado, deploy) nao pode ofertar horario que ja passou nem duplicar onda.
// A excecao e a vaga PRESA (quem serve esta em outra oferta, ou o WhatsApp
// caiu): ai o job volta mais tarde, ate o limite do horario menos a janela.
//
// REGRA ABSOLUTA: nenhum dado de paciente em log; so ids.

const TETO_DE_CANDIDATOS = 30;
/** A fila lida por vaga (a mesma ordem de chegada da tela). */
const TAMANHO_DA_FILA_LIDA = 500;
/** Motivo gravado em job_queue.ultimo_motivo_devolucao na espera. */
const MOTIVO_WHATSAPP_DESCONECTADO = "whatsapp_desconectado";
/** Chave do payload: quantas voltas a vaga ja deu esperando a reconexao. */
const CHAVE_DO_PASSO_DE_RECONEXAO = "passo_reconexao";

/**
 * WhatsApp fora do ar: a vaga espera a reconexao ate nao sobrar tempo util
 * para oferecer (proximaEsperaPorReconexao), em passos de 5 ate 30 minutos.
 *
 * A espera NAO passa por reagendar_job: la cada devolucao soma no teto de 20
 * (o sinal de "canal que nao abre" dos envios), e uma queda de sexta a noite
 * matava o job em cerca de 3 horas, com a vaga de segunda nunca oferecida e
 * ninguem avisado (revisao da leva 1, achado R2). Aqui o prazo e o proprio
 * horario: esta passagem conclui e deixa a CONTINUACAO na fila (mesmo payload,
 * passo + 1, contador de devolucoes zerado por ser linha nova). O
 * reagendamento por 'vaga_aguardando_outra_oferta' continua pelo caminho
 * comum. Se a continuacao nao puder ser gravada, a devolucao comum segura a
 * vaga (gasta o teto, mas nao perde a vaga agora).
 */
async function aguardarReconexao(
  admin: SupabaseClient,
  job: Job,
  limite: number,
): Promise<ResultadoDeJob> {
  const registrado = job.payload[CHAVE_DO_PASSO_DE_RECONEXAO];
  const passo =
    typeof registrado === "number" &&
    Number.isInteger(registrado) &&
    registrado >= 0
      ? registrado
      : 0;
  const quando = proximaEsperaPorReconexao({
    passo,
    agora: Date.now(),
    limite,
  });
  if (quando === null) {
    // Sem tempo util para oferecer: desistir e o desfecho certo.
    return { ok: true };
  }
  const runAt = new Date(quando).toISOString();
  const { error } = await admin.from("job_queue").insert({
    clinic_id: job.clinic_id,
    kind: "oferecer_lista_espera",
    payload: { ...job.payload, [CHAVE_DO_PASSO_DE_RECONEXAO]: passo + 1 },
    run_at: runAt,
    ultimo_motivo_devolucao: MOTIVO_WHATSAPP_DESCONECTADO,
  });
  if (error) {
    log.warn("oferta_de_espera_continuacao_falhou", {
      clinic_id: job.clinic_id,
      job_id: job.id,
      error_code: error.code ?? null,
    });
    return { reagendar: runAt, motivo: MOTIVO_WHATSAPP_DESCONECTADO };
  }
  return { ok: true };
}

type Slot = {
  professionalId: string;
  unitId: string | null;
  startsAt: string;
  endsAt: string;
  sourceAppointmentId: string;
  contatoQueCancelou: string | null;
  /** Nome do procedimento da consulta cancelada (texto da mensagem). */
  procedimentoDoSlot: string | null;
  /** Procedimento da consulta cancelada (entrada "qualquer procedimento"). */
  procedimentoDoSlotId: string | null;
  /** A recepcao pode ter escolhido NAO oferecer este horario ao cancelar. */
  oferecerVaga: boolean;
};

type MotivoDaVaga = { ok: true; motivo: string | null } | { ok: false };

/**
 * A regra unica "a vaga existe?" (vaga_de_espera_indisponivel no banco):
 * profissional ativo, sem bloqueio, dentro da jornada e sem consulta no
 * intervalo. A mesma funcao vale no aceite e no envio de cada mensagem.
 */
async function motivoDaVagaIndisponivel(
  admin: SupabaseClient,
  clinicId: string,
  vaga: {
    professionalId: string;
    startsAt: string;
    endsAt: string;
    unitId: string | null;
  },
): Promise<MotivoDaVaga> {
  const { data, error } = await admin.rpc("vaga_de_espera_indisponivel", {
    p_clinic_id: clinicId,
    p_professional_id: vaga.professionalId,
    p_starts_at: vaga.startsAt,
    p_ends_at: vaga.endsAt,
    p_unit_id: vaga.unitId,
  });
  if (error) {
    return { ok: false };
  }
  return { ok: true, motivo: typeof data === "string" ? data : null };
}

export type SituacaoDoEnvioDeOferta = "enviar" | "encerrada" | "leitura_falhou";

/**
 * A mensagem de uma onda ainda deve sair? Chamado pelo executor de envio
 * ativo quando o payload traz offer_id. So envia com a oferta ABERTA, o
 * contato sem ter recusado, metade da janela de resposta ainda pela frente e
 * a vaga livre. Isso cobre o retry de desconexao, o canal ocupado, a
 * reoferta cancelada pela recepcao e a vaga preenchida ou ocupada.
 */
export async function situacaoDoEnvioDeOferta(
  admin: SupabaseClient,
  clinicId: string,
  offerId: string,
  contactId: string,
  agora: number = Date.now(),
): Promise<SituacaoDoEnvioDeOferta> {
  const { data: oferta, error } = await admin
    .from("waitlist_offer")
    .select(
      "status, created_at, expires_at, declined_by, professional_id, slot_starts_at, slot_ends_at",
    )
    .eq("clinic_id", clinicId)
    .eq("id", offerId)
    .maybeSingle();
  if (error) {
    return "leitura_falhou";
  }
  if (!oferta || oferta.status !== "aberta") {
    return "encerrada";
  }
  if (((oferta.declined_by as string[] | null) ?? []).includes(contactId)) {
    return "encerrada";
  }
  if (
    !temFolgaParaResponder({
      criadaEm: oferta.created_at as string,
      venceEm: oferta.expires_at as string,
      agora,
    })
  ) {
    return "encerrada";
  }
  const vaga = await motivoDaVagaIndisponivel(admin, clinicId, {
    professionalId: oferta.professional_id as string,
    startsAt: oferta.slot_starts_at as string,
    endsAt: oferta.slot_ends_at as string,
    unitId: null,
  });
  if (!vaga.ok) {
    return "leitura_falhou";
  }
  return vaga.motivo ? "encerrada" : "enviar";
}

// Distinguir "nao existe" (definitivo) de "leitura falhou" (retry): erro
// engolido aqui virava fila vazia ou exclusao ausente em silencio (achado
// da revisao de 15/09).
type SlotCarregado =
  | { ok: true; slot: Slot | null }
  | { ok: false };

async function carregarSlot(
  admin: SupabaseClient,
  clinicId: string,
  payload: Record<string, unknown>,
): Promise<SlotCarregado> {
  const carregarDoAppointment = async (appointmentId: string) => {
    const { data, error } = await admin
      .from("appointment")
      .select(
        "id, professional_id, contact_id, unit_id, starts_at, ends_at, oferecer_vaga_ao_cancelar, service_link:service_link_id ( procedure_id, procedure:procedure_id ( name ) )",
      )
      .eq("clinic_id", clinicId)
      .eq("id", appointmentId)
      .maybeSingle();
    if (error) {
      return { ok: false as const };
    }
    if (!data) {
      return { ok: true as const, slot: null };
    }
    const vinculo = (
      Array.isArray(data.service_link) ? data.service_link[0] : data.service_link
    ) as
      | {
          procedure_id?: string | null;
          procedure?: { name?: string } | { name?: string }[] | null;
        }
      | null
      | undefined;
    const procedimento = vinculo
      ? Array.isArray(vinculo.procedure)
        ? vinculo.procedure[0]
        : vinculo.procedure
      : null;
    return {
      ok: true as const,
      slot: {
        professionalId: data.professional_id as string,
        unitId: (data.unit_id as string | null) ?? null,
        startsAt: data.starts_at as string,
        endsAt: data.ends_at as string,
        sourceAppointmentId: data.id as string,
        contatoQueCancelou: (data.contact_id as string | null) ?? null,
        procedimentoDoSlot: procedimento?.name ?? null,
        procedimentoDoSlotId: vinculo?.procedure_id ?? null,
        oferecerVaga: data.oferecer_vaga_ao_cancelar !== false,
      },
    };
  };

  if (typeof payload.appointment_id === "string") {
    return carregarDoAppointment(payload.appointment_id);
  }
  if (typeof payload.origem_offer_id === "string") {
    const { data: oferta, error } = await admin
      .from("waitlist_offer")
      .select("source_appointment_id")
      .eq("clinic_id", clinicId)
      .eq("id", payload.origem_offer_id)
      .maybeSingle();
    if (error) {
      return { ok: false };
    }
    if (!oferta) {
      return { ok: true, slot: null };
    }
    return carregarDoAppointment(oferta.source_appointment_id as string);
  }
  return { ok: true, slot: null };
}

export async function executarOfertaDeEspera(
  admin: SupabaseClient,
  job: Job,
): Promise<ResultadoDeJob> {
  const carregado = await carregarSlot(admin, job.clinic_id, job.payload);
  if (!carregado.ok) {
    // Leitura falhou: retry com backoff, nunca desfecho definitivo.
    return { ok: false, erro: "leitura_falhou" };
  }
  const slot = carregado.slot;
  if (!slot) {
    return { ok: false, erro: "payload_invalido", definitivo: true };
  }
  // A recepcao cancelou escolhendo "nao oferecer a lista de espera": vale
  // tambem para as ondas seguintes (expiracao e recusa geral voltam aqui).
  if (!slot.oferecerVaga) {
    return { ok: true };
  }

  const { data: clinica, error: erroClinica } = await admin
    .from("clinic")
    .select("name, timezone, waitlist_wave_size, waitlist_response_minutes")
    .eq("id", job.clinic_id)
    .maybeSingle();
  if (erroClinica) {
    return { ok: false, erro: "leitura_falhou" };
  }
  if (!clinica) {
    return { ok: false, erro: "clinica_inexistente", definitivo: true };
  }
  const timezone = clinica.timezone as string;
  const janelaMin = clinica.waitlist_response_minutes as number;
  const tamanhoDaOnda = clinica.waitlist_wave_size as number;

  // GUARDAS: tudo aqui conclui ok sem efeito.
  // A oferta precisa vencer ANTES do horario; slot mais perto que a janela
  // (ou no passado) nao tem o que prometer. O mesmo limite vale para voltar
  // mais tarde (vaga presa ou WhatsApp fora do ar).
  const inicioDoSlot = new Date(slot.startsAt).getTime();
  const limite = inicioDoSlot - janelaMin * 60_000;
  if (Date.now() >= limite) {
    return { ok: true };
  }
  // A vaga EXISTE? Bloqueio (ferias, doenca; qualquer um, porque a oferta
  // nunca e encaixe), profissional desativado, fora da jornada ou horario
  // ocupado (inclusive por encaixe): nada a oferecer.
  const vaga = await motivoDaVagaIndisponivel(admin, job.clinic_id, slot);
  if (!vaga.ok) {
    return { ok: false, erro: "leitura_falhou" };
  }
  if (vaga.motivo) {
    return { ok: true };
  }
  // Ja existe onda aberta para este horario?
  const { data: abertaExistente, error: erroAberta } = await admin
    .from("waitlist_offer")
    .select("id")
    .eq("clinic_id", job.clinic_id)
    .eq("professional_id", slot.professionalId)
    .eq("slot_starts_at", slot.startsAt)
    .eq("status", "aberta")
    .limit(1);
  if (erroAberta) {
    return { ok: false, erro: "leitura_falhou" };
  }
  if ((abertaExistente ?? []).length > 0) {
    return { ok: true };
  }
  // WhatsApp fora do ar: a oferta NAO nasce, porque o prazo de resposta
  // contaria com ninguem recebendo (e a onda queimaria a vez de quem nunca
  // viu a mensagem). A onda espera a reconexao, ate o limite, sem gastar o
  // teto de devolucoes da fila (aguardarReconexao).
  //
  // Aqui a conferencia e da CLINICA (nenhum numero ativo, ou nenhum
  // conectado), antes de todo o trabalho de montar a onda. O numero de CADA
  // candidato e conferido depois, na onda (decisao D7).
  const { data: numeros, error: erroNumeros } = await admin
    .from("whatsapp_account")
    .select("connection_status")
    .eq("clinic_id", job.clinic_id)
    .is("removido_em", null);
  if (erroNumeros) {
    return { ok: false, erro: "leitura_falhou" };
  }
  const numerosAtivos = (numeros ?? []) as { connection_status: string }[];
  if (numerosAtivos.length === 0) {
    return { ok: true };
  }
  if (!numerosAtivos.some((n) => n.connection_status === "conectado")) {
    return aguardarReconexao(admin, job, limite);
  }

  // EXCLUSOES PERMANENTES para esta vaga.
  const excluirPermanentes = new Set<string>();
  if (slot.contatoQueCancelou) {
    excluirPermanentes.add(slot.contatoQueCancelou);
  }
  // Quem ja recebeu QUALQUER onda deste horario (inclusive quem recusou).
  const { data: ondasDoSlot, error: erroOndas } = await admin
    .from("waitlist_offer")
    .select("offered_to")
    .eq("clinic_id", job.clinic_id)
    .eq("source_appointment_id", slot.sourceAppointmentId);
  if (erroOndas) {
    return { ok: false, erro: "leitura_falhou" };
  }
  for (const onda of (ondasDoSlot ?? []) as { offered_to: string[] }[]) {
    for (const contato of onda.offered_to) {
      excluirPermanentes.add(contato);
    }
  }
  // Quem ja tem consulta ATIVA em cima do horario oferecido nao precisa dele.
  const { data: conflitantes, error: erroConflitantes } = await admin
    .from("appointment")
    .select("contact_id")
    .eq("clinic_id", job.clinic_id)
    .not("status", "in", "(cancelado_paciente,cancelado_clinica)")
    .lt("starts_at", slot.endsAt)
    .gt("ends_at", slot.startsAt);
  if (erroConflitantes) {
    return { ok: false, erro: "leitura_falhou" };
  }
  for (const linha of (conflitantes ?? []) as { contact_id: string }[]) {
    excluirPermanentes.add(linha.contact_id);
  }

  // EXCLUSOES TEMPORARIAS: um contato em NO MAXIMO uma oferta aberta
  // (determinismo do SIM) e o repouso de 2h entre ofertas de horarios
  // diferentes. Guardam QUANDO cada um se libera: se a onda sair vazia so
  // por causa delas, a vaga espera em vez de sumir (achado 58).
  const desdeRepouso = new Date(
    Date.now() - REPOUSO_POS_OFERTA_MS,
  ).toISOString();
  const { data: outrasOndas, error: erroOutras } = await admin
    .from("waitlist_offer")
    .select("offered_to, status, created_at, expires_at")
    .eq("clinic_id", job.clinic_id)
    .or(`status.eq.aberta,created_at.gte.${desdeRepouso}`);
  if (erroOutras) {
    return { ok: false, erro: "leitura_falhou" };
  }
  const liberacao = liberacaoPorContato(
    (
      (outrasOndas ?? []) as {
        offered_to: string[];
        status: string;
        created_at: string;
        expires_at: string;
      }[]
    ).map((onda) => ({
      offeredTo: onda.offered_to,
      status: onda.status,
      createdAt: onda.created_at,
      expiresAt: onda.expires_at,
    })),
  );
  const excluir = new Set<string>([
    ...excluirPermanentes,
    ...liberacao.keys(),
  ]);

  // A FILA e o casamento. A fila vem na ordem de chegada (a ordem entre
  // grupos); a ordem dentro do grupo quem aplica e montarOnda.
  const [filaResult, vinculosResult] = await Promise.all([
    admin
      .from("waitlist")
      .select(
        "id, contact_id, procedure_id, professional_id, preferred_shifts, preferred_weekdays, priority, created_at, contact:contact_id ( insurance_id )",
      )
      .eq("clinic_id", job.clinic_id)
      .eq("active", true)
      .order("created_at")
      .order("id")
      .limit(TAMANHO_DA_FILA_LIDA),
    admin
      .from("service_link")
      .select(
        "id, procedure_id, insurance_id, duration_min, procedure:procedure_id ( name, resource_id, active )",
      )
      .eq("clinic_id", job.clinic_id)
      .eq("professional_id", slot.professionalId)
      .eq("active", true),
  ]);
  if (filaResult.error || vinculosResult.error) {
    return { ok: false, erro: "leitura_falhou" };
  }
  const vinculos: VinculoDaVaga[] = [];
  const nomeDoProcedimento = new Map<string, string>();
  for (const linha of (vinculosResult.data ?? []) as {
    id: string;
    procedure_id: string;
    insurance_id: string | null;
    duration_min: number;
    procedure:
      | { name: string; resource_id: string | null; active: boolean }[]
      | { name: string; resource_id: string | null; active: boolean }
      | null;
  }[]) {
    const procedimento = Array.isArray(linha.procedure)
      ? linha.procedure[0]
      : linha.procedure;
    if (!procedimento || procedimento.active === false) {
      continue;
    }
    vinculos.push({
      id: linha.id,
      procedureId: linha.procedure_id,
      insuranceId: linha.insurance_id ?? null,
      durationMin: linha.duration_min,
      resourceId: procedimento.resource_id ?? null,
    });
    nomeDoProcedimento.set(linha.procedure_id, procedimento.name);
  }

  // Sala ou equipamento que algum procedimento exige e que ja esta ocupado
  // neste horario (por QUALQUER profissional): quem precisa dele nao entra
  // na onda, senao o SIM bateria na exclusion de recurso.
  const recursosExigidos = [
    ...new Set(
      vinculos
        .map((vinculo) => vinculo.resourceId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const recursosOcupados = new Set<string>();
  if (recursosExigidos.length > 0) {
    const { data: usos, error: erroUsos } = await admin
      .from("appointment")
      .select("resource_id")
      .eq("clinic_id", job.clinic_id)
      .in("resource_id", recursosExigidos)
      .not("status", "in", "(cancelado_paciente,cancelado_clinica)")
      .lt("starts_at", slot.endsAt)
      .gt("ends_at", slot.startsAt);
    if (erroUsos) {
      return { ok: false, erro: "leitura_falhou" };
    }
    for (const uso of (usos ?? []) as { resource_id: string | null }[]) {
      if (uso.resource_id) {
        recursosOcupados.add(uso.resource_id);
      }
    }
  }

  const entradas: EntradaDaFila[] = (
    (filaResult.data ?? []) as Record<string, unknown>[]
  ).map((linha) => {
    const contato = (
      Array.isArray(linha.contact) ? linha.contact[0] : linha.contact
    ) as { insurance_id?: string | null } | null | undefined;
    return {
      id: linha.id as string,
      contactId: linha.contact_id as string,
      procedureId: (linha.procedure_id as string | null) ?? null,
      professionalId: (linha.professional_id as string | null) ?? null,
      preferredShifts: (linha.preferred_shifts as string[] | null) ?? [],
      preferredWeekdays: (linha.preferred_weekdays as number[] | null) ?? [],
      priority: linha.priority as number,
      createdAt: linha.created_at as string,
      insuranceId: contato?.insurance_id ?? null,
    };
  });
  const inicio = new Date(slot.startsAt);
  const slotVago: SlotVago = {
    professionalId: slot.professionalId,
    weekday: diaDaSemanaNoFuso(inicio, timezone),
    turno: turnoDoInstante(inicio, timezone),
    duracaoMin: Math.floor(
      (new Date(slot.endsAt).getTime() - inicio.getTime()) / 60_000,
    ),
    procedimentoDaVaga: slot.procedimentoDoSlotId,
  };
  const candidatos = montarOnda({
    entradas,
    slot: slotVago,
    vinculos,
    recursosOcupados,
    excluirContatos: excluir,
    // Margem para o consentimento poder pular sem esvaziar a onda.
    tamanho: Math.min(TETO_DE_CANDIDATOS, tamanhoDaOnda + 10),
  });

  // O NUMERO de cada candidato, numa leitura so, pela mesma regra do envio
  // (fixo, ultimo usado pelo paciente, principal). Quem esta num numero
  // DESCONECTADO fica fora DESTA onda sem entrar em offered_to (decisao D7):
  // o prazo de resposta correria com a mensagem parada, e a pessoa perderia a
  // vez sem nunca ter visto a pergunta. Na onda seguinte ela volta a contar.
  const contas = await contasDeEnvio(
    admin,
    job.clinic_id,
    candidatos.map((candidato) => candidato.contactId),
  );
  if (!contas) {
    return { ok: false, erro: "leitura_falhou" };
  }
  const numeroPorContato = new Map<string, string>();
  let foraPorNumeroDesconectado = 0;

  // Consentimento por candidato ate encher a onda (o executor de envio
  // reconfere na hora do envio; aqui evita oferta gravada para quem nunca
  // poderia receber).
  const onda: EntradaDaFila[] = [];
  for (const candidato of candidatos) {
    if (onda.length >= tamanhoDaOnda) {
      break;
    }
    const conta = contas.get(candidato.contactId);
    if (!conta?.whatsappAccountId) {
      // Nenhum numero ativo por onde oferecer (nao acontece com a clinica
      // tendo numero ativo, conferido acima: o principal cobre todo mundo).
      continue;
    }
    const { data: vigente, error: erroConsent } = await admin.rpc(
      "consentimento_vigente",
      {
        p_clinic_id: job.clinic_id,
        p_contact_id: candidato.contactId,
        p_channel: "whatsapp",
      },
    );
    if (erroConsent) {
      // Esta leitura DECIDE quem entra na onda: engolir o erro virava onda
      // vazia com job concluido "com sucesso", e o horario nunca era
      // oferecido a ninguem (achado da revisao de 15/09/2026).
      return { ok: false, erro: "leitura_falhou" };
    }
    if (vigente !== true) {
      continue;
    }
    // Depois do consentimento de proposito: so conta como "fora pela
    // desconexao" quem de fato receberia a oferta com o numero de pe.
    if (!conta.conectado) {
      foraPorNumeroDesconectado += 1;
      continue;
    }
    onda.push(candidato);
    numeroPorContato.set(candidato.contactId, conta.whatsappAccountId);
  }
  if (onda.length === 0) {
    // A onda saiu vazia SO porque o numero de quem serve esta fora do ar: a
    // vaga espera a reconexao, como quando a clinica inteira cai.
    if (foraPorNumeroDesconectado > 0) {
      return aguardarReconexao(admin, job, limite);
    }
    // Ninguem livre agora. Se quem serve para a vaga esta PRESO em outra
    // oferta (duas vagas na mesma manha) ou no repouso, a vaga espera essa
    // oferta fechar em vez de sumir sem aviso.
    const quando = proximaTentativaDaVaga({
      entradas,
      slot: slotVago,
      vinculos,
      recursosOcupados,
      excluirPermanentes,
      liberacao,
      agora: Date.now(),
      limite,
    });
    if (quando !== null) {
      return {
        reagendar: new Date(quando).toISOString(),
        motivo: "vaga_aguardando_outra_oferta",
      };
    }
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

  const destinatarios = onda.map((entrada) => {
    const nome = nomePorContato.get(entrada.contactId) ?? null;
    // Sem nome cadastrado, a saudacao nao pode sair quebrada ("Oi, !").
    const modelo = nome
      ? OFERTA_DE_ESPERA
      : OFERTA_DE_ESPERA.replace("Oi, {{nome}}!", "Olá!");
    return {
      contact_id: entrada.contactId,
      // A entrada que CASOU com a vaga viaja junto: o aceite usa este id em
      // vez de adivinhar de novo com regra diferente da do casamento.
      waitlist_id: entrada.id,
      // O numero conferido conectado acima: criar_oferta_de_espera carimba o
      // job da mensagem com ele (sem ele, o gatilho da fila resolveria de
      // novo pela mesma regra).
      whatsapp_account_id: numeroPorContato.get(entrada.contactId) ?? null,
      body: renderizarModelo(modelo, {
        nome,
        clinica: clinica.name as string,
        // O procedimento com que a pessoa SERIA agendada (o mesmo vinculo
        // que o aceite escolhe).
        procedimento:
          nomeDoProcedimento.get(
            vinculoDaEntrada(entrada, slotVago, vinculos)?.procedureId ?? "",
          ) ??
          slot.procedimentoDoSlot ??
          "consulta",
        profissional: (profissional?.name as string | undefined) ?? null,
        data: format(inicioLocal, "dd/MM/yyyy", { locale: ptBR }),
        hora: format(inicioLocal, "HH:mm", { locale: ptBR }),
        prazo: String(janelaMin),
      }).trim(),
    };
  });

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
