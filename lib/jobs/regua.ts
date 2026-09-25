import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  dentroDaJanela,
  passoCondizComAgenda,
  proximaAbertura,
  type JanelaDeEnvio,
} from "@/lib/domain/cadence";
import { renderizarModelo } from "@/lib/domain/modelo-mensagem";
import {
  CORPO_DO_MENU_APOS_MIDIA,
  MENU_CONFIRMACAO,
} from "@/lib/domain/textos-padrao";
import {
  decidirToqueDeConfirmacao,
  mudouDeDia,
} from "@/lib/domain/toque-atrasado";
import { getWhatsAppProvider } from "@/lib/integrations/whatsapp/provider";
import {
  falhaPermiteRetry,
  sendWhatsAppMedia,
  sendWhatsAppMenu,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";
import { log } from "@/lib/log";

import { espacamentoDeMassaMs } from "./espacamento";
import { numeroDoJob } from "./numero-de-envio";
import type { Job, ResultadoDeJob } from "./worker";

// Executor de UM toque de regua (Fase 4, tarefas 4.6 e 4.7). Roda os seis
// passos da secao 5 de docs/03, nesta ordem:
//
//   0. carrega a execucao (idempotente: run ja resolvida nao repete)
//   1. consentimento vigente?         nao -> pula e CONTA (nao e erro)
//   2. condicao de parada atingida?   sim -> cancela os passos seguintes
//   3. dentro da janela de envio?     nao -> reagenda (sem queimar tentativa)
//   4. janela de 24h                  (so no canal oficial)
//   5. teto de gasto                  (so no canal oficial)
//   6. envia, grava message e fecha a cadence_run
//
// A nao duplicacao NAO depende deste arquivo: ela vive no unique da tripla em
// cadence_run (planner) e no unique de message.job_id (envio). Aqui o cuidado
// e nunca deixar a run em estado ambiguo depois de um envio que saiu.
//
// TOQUE MANUAL (payload.manual, "Cobrar agora" da Tela 2): a recepcao pediu o
// toque AGORA, com nome e hora registrados na trilha. Tres passos deixam de
// valer, e so estes tres: a regua ligada (a clinica cobra na mao antes de
// automatizar), a janela de envio (a janela protege o paciente do disparo
// automatico as 23h, nao a recepcao que esta trabalhando) e a conferencia de
// remarcacao (a run manual nasce com scheduled_for = agora, nao em
// starts_at + offset). Consentimento, condicao de parada, espacamento, custo
// e idempotencia continuam valendo iguais.
//
// Regra 3.1 do CLAUDE.md: nada de dado de paciente em log nem em last_error.
// Este arquivo nao loga; devolve codigos curtos para o worker.

// MENU_CONFIRMACAO vive em lib/domain/textos-padrao.ts, ao lado do que o
// paciente le, e e FONTE UNICA. Existia uma copia aqui com DUAS opcoes
// enquanto o interpretador da resposta esperava TRES: quando o uazapi degrada
// o botao para texto numerado, o paciente que respondia "2" para cancelar era
// lido como "remarcar", a consulta nunca era cancelada e o horario nunca era
// liberado. A ordem desta lista e o contrato do numero: 1 confirmar,
// 2 remarcar, 3 cancelar, igual a lib/domain/resposta-paciente.ts.

// Consulta futura que ainda vale: e o que prova que o paciente ja remarcou
// depois da falta, e por isso a regua de recuperacao deve parar.
const STATUS_VIVOS = [
  "agendado",
  "aguardando_confirmacao",
  "confirmado_paciente",
  "confirmado_recepcao",
];

// Confirmar so faz sentido enquanto a consulta espera resposta. Confirmada,
// cancelada ou ja atendida, a regua para.
/**
 * Quanto esperar antes de tentar de novo quando o WhatsApp esta desconectado.
 * Cinco minutos: rapido o bastante para o toque sair logo depois de a recepcao
 * reconectar, devagar o bastante para nao martelar a fila enquanto o celular
 * esta fora do ar.
 */
const ESPERA_DE_RECONEXAO_MS = 5 * 60_000;

const STATUS_A_CONFIRMAR = ["agendado", "aguardando_confirmacao"];

type ReguaDaRun = {
  id: string;
  kind: string;
  active: boolean;
  send_window_start: string | null;
  send_window_end: string | null;
  send_weekdays: number[] | null;
  /** Chave da etapa da jornada; so em kind followup. */
  trigger_stage: string | null;
};

type LinhaDaRun = {
  id: string;
  clinic_id: string;
  contact_id: string;
  appointment_id: string | null;
  scheduled_for: string;
  sent_at: string | null;
  skipped_reason: string | null;
  cadence_step: {
    id: string;
    offset_minutes: number;
    fixed_body: string | null;
    media_path: string | null;
    media_type: "image" | "audio" | "document" | null;
    media_mimetype: string | null;
    media_filename: string | null;
    cadence: ReguaDaRun | null;
  } | null;
  contact: {
    name: string | null;
    funnel_stage: string;
    funnel_stage_changed_at: string;
    last_contact_at: string | null;
  } | null;
  clinic: { name: string; timezone: string } | null;
};

type LinhaDaConsulta = {
  id: string;
  status: string;
  starts_at: string;
  send_confirmation: boolean;
  /** O paciente pediu para remarcar (gravado pelo interceptador). */
  remarcacao_pedida_em: string | null;
  service_link: {
    procedure: { name: string; prep_instructions: string | null } | null;
  } | null;
  professional: { name: string } | null;
};

type MotivoDePulo =
  | "sem_consentimento"
  | "fora_janela"
  | "condicao_parada"
  | "falha_envio"
  | "desconectado"
  // Canal da clinica ocupado ate depois da hora da consulta: o toque perdeu o
  // sentido. So acontece com fila muito longa da mesma clinica.
  | "canal_ocupado"
  // O horario da consulta mudou depois do planejamento: este toque aponta
  // para o horario antigo. Antes era 'condicao_parada', que escondia o motivo.
  | "consulta_remarcada"
  // O paciente pediu para remarcar: perguntar se ele confirma a consulta que
  // quer trocar so confunde.
  | "remarcacao_pedida"
  // Empurrado para outro dia civil (janela, canal fora do ar) com um toque
  // seguinte da mesma regua que ainda sai antes da consulta.
  | "toque_atrasado"
  // O numero de WhatsApp do toque foi removido da clinica depois de o toque
  // ja ter gravado mensagem por ele: trocar de numero agora repetiria a
  // mensagem por outro (varios numeros por clinica, docs/07).
  | "numero_removido";

/** Fecha ESTA run, sem tocar em run ja enviada ou ja pulada. */
async function pularRun(
  admin: SupabaseClient,
  run: LinhaDaRun,
  motivo: MotivoDePulo,
): Promise<void> {
  const { error } = await admin
    .from("cadence_run")
    .update({ skipped_reason: motivo })
    .eq("id", run.id)
    .is("sent_at", null)
    .is("skipped_reason", null);
  if (error) {
    // Motivo que nao grava vira retry do job (o worker converte excecao em
    // falha com backoff), nunca silencio: foi silencio que escondeu por
    // semanas o 'canal_ocupado' fora do CHECK (corrigido na migration
    // 20260914150000).
    throw new Error(`pular_run_falhou: ${error.code ?? "desconhecido"}`);
  }
}

/**
 * "Cancela os passos seguintes" (docs/03 secao 5): um update em lote em todas
 * as runs ainda nao enviadas da MESMA consulta, esta inclusive. Sem isto o
 * paciente que cancelou continuaria recebendo os toques de 24h e de 3h.
 */
async function pararCadeia(
  admin: SupabaseClient,
  run: LinhaDaRun,
): Promise<void> {
  if (!run.appointment_id) {
    await pularRun(admin, run, "condicao_parada");
    return;
  }
  await admin
    .from("cadence_run")
    .update({ skipped_reason: "condicao_parada" })
    .eq("clinic_id", run.clinic_id)
    .eq("appointment_id", run.appointment_id)
    .is("sent_at", null)
    .is("skipped_reason", null);
}

/**
 * Para a cadeia de follow-up de UM contato numa regua: as runs pendentes dos
 * passos desta cadence morrem juntas. A pararCadeia de agenda filtra por
 * appointment_id, que aqui e nulo; o recorte do follow-up e contato+regua.
 */
async function pararCadeiaDeFollowup(
  admin: SupabaseClient,
  run: LinhaDaRun,
  cadenceId: string,
): Promise<void> {
  const { data: passos } = await admin
    .from("cadence_step")
    .select("id")
    .eq("clinic_id", run.clinic_id)
    .eq("cadence_id", cadenceId);
  const stepIds = (passos ?? []).map((passo) => passo.id as string);
  if (stepIds.length === 0) {
    await pularRun(admin, run, "condicao_parada");
    return;
  }
  await admin
    .from("cadence_run")
    .update({ skipped_reason: "condicao_parada" })
    .eq("clinic_id", run.clinic_id)
    .eq("contact_id", run.contact_id)
    .in("cadence_step_id", stepIds)
    .is("sent_at", null)
    .is("skipped_reason", null);
}

async function carregarConsulta(
  admin: SupabaseClient,
  clinicId: string,
  appointmentId: string | null,
): Promise<LinhaDaConsulta | null> {
  if (!appointmentId) {
    return null;
  }
  const { data } = await admin
    .from("appointment")
    .select(
      `id, status, starts_at, send_confirmation, remarcacao_pedida_em,
       service_link:service_link_id (
         procedure:procedure_id ( name, prep_instructions )
       ),
       professional:professional_id ( name )`,
    )
    .eq("clinic_id", clinicId)
    .eq("id", appointmentId)
    .maybeSingle();
  return (data as LinhaDaConsulta | null) ?? null;
}

/**
 * Os passos da MESMA regua, para decidir o toque atrasado. Leitura que falha
 * vira excecao (retry do job): decidir "nao ha passo seguinte" por erro de
 * rede mandaria o toque que deveria ter sido pulado.
 */
async function carregarPassosDaRegua(
  admin: SupabaseClient,
  clinicId: string,
  cadenceId: string,
): Promise<{ offsetMinutes: number }[]> {
  const { data, error } = await admin
    .from("cadence_step")
    .select("offset_minutes")
    .eq("clinic_id", clinicId)
    .eq("cadence_id", cadenceId);
  if (error) {
    throw new Error(`passos_da_regua_ilegiveis: ${error.code ?? "desconhecido"}`);
  }
  return ((data ?? []) as { offset_minutes: number }[]).map((passo) => ({
    offsetMinutes: passo.offset_minutes,
  }));
}

type ConferenciaDaConfirmacao =
  | { segue: true }
  | { segue: false; motivo: "consulta_remarcada" | "remarcacao_pedida" }
  | { segue: false; motivo: "parar_cadeia" };

/**
 * A consulta ainda pede ESTE toque de confirmacao? Roda duas vezes: na
 * condicao de parada e de novo com a consulta relida logo antes do envio,
 * porque a recepcao pode remarcar enquanto o anexo baixa.
 *
 * - Horario mudou (o vencimento da run nao bate com starts_at + offset, com a
 *   tolerancia de 1 minuto de passoCondizComAgenda): so ESTE toque morre
 *   ('consulta_remarcada'). A cadeia nao para, senao os toques que o planner
 *   materializou para o horario novo morreriam junto. A run manual nao passa
 *   por aqui: ela nasceu agora, ja com o horario que a tela mostrou.
 * - Consulta fora do jogo (cancelada, ja passou, confirmacao automatica
 *   desligada): a cadeia inteira para.
 * - Paciente pediu para remarcar: so este toque morre ('remarcacao_pedida'),
 *   inclusive o manual. Enquanto o pedido estiver aberto o planner nao cria
 *   toque novo; resolvido o pedido, os que couberem voltam a sair.
 */
function conferirConfirmacao(
  consulta: LinhaDaConsulta,
  entrada: {
    offsetMinutes: number;
    scheduledFor: string;
    manual: boolean;
    agora: Date;
  },
): ConferenciaDaConfirmacao {
  const remarcada =
    !entrada.manual &&
    !passoCondizComAgenda({
      startsAt: new Date(consulta.starts_at),
      offsetMinutes: entrada.offsetMinutes,
      scheduledFor: new Date(entrada.scheduledFor),
    });
  if (remarcada) {
    return { segue: false, motivo: "consulta_remarcada" };
  }
  const parou =
    !STATUS_A_CONFIRMAR.includes(consulta.status) ||
    new Date(consulta.starts_at).getTime() <= entrada.agora.getTime() ||
    !consulta.send_confirmation;
  if (parou) {
    return { segue: false, motivo: "parar_cadeia" };
  }
  if (consulta.remarcacao_pedida_em) {
    return { segue: false, motivo: "remarcacao_pedida" };
  }
  return { segue: true };
}

/**
 * O paciente ja remarcou depois da falta? O eixo do pos_falta e o instante em
 * que a falta foi marcada, entao so conta consulta futura CRIADA depois disso.
 */
async function remarcouDepoisDaFalta(
  admin: SupabaseClient,
  run: LinhaDaRun,
  consulta: LinhaDaConsulta,
): Promise<boolean> {
  const { data: marcacao } = await admin
    .from("appointment_status_history")
    .select("changed_at")
    .eq("clinic_id", run.clinic_id)
    .eq("appointment_id", consulta.id)
    .eq("status", "faltou")
    .order("changed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const desde =
    (marcacao?.changed_at as string | undefined) ?? run.scheduled_for;

  const { count } = await admin
    .from("appointment")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", run.clinic_id)
    .eq("contact_id", run.contact_id)
    .in("status", STATUS_VIVOS)
    .gt("starts_at", new Date().toISOString())
    .gt("created_at", desde);
  return (count ?? 0) > 0;
}

/** Follow-up nao tem consulta: so nome e clinica fazem sentido. */
function valoresDeFollowup(run: LinhaDaRun): Record<string, string | null> {
  return {
    nome: run.contact?.name ?? null,
    clinica: run.clinic?.name ?? null,
  };
}

function valoresDoModelo(
  run: LinhaDaRun,
  consulta: LinhaDaConsulta,
  timezone: string,
): Record<string, string | null> {
  // Data e hora SEMPRE no fuso da clinica (regra 3.6): o banco guarda UTC e o
  // paciente le o relogio dele.
  const inicio = new TZDate(new Date(consulta.starts_at).getTime(), timezone);
  const procedimento = consulta.service_link?.procedure ?? null;
  return {
    nome: run.contact?.name ?? null,
    clinica: run.clinic?.name ?? null,
    procedimento: procedimento?.name ?? null,
    profissional: consulta.professional?.name ?? null,
    data: format(inicio, "dd/MM/yyyy", { locale: ptBR }),
    hora: format(inicio, "HH:mm", { locale: ptBR }),
    preparo: procedimento?.prep_instructions ?? null,
  };
}

export async function executarPassoDeRegua(
  admin: SupabaseClient,
  job: Job,
  // Quem reivindicou o job: numero_do_job so responde ao dono da posse.
  workerId: string,
): Promise<ResultadoDeJob> {
  const runId = job.payload.cadence_run_id;
  if (typeof runId !== "string") {
    return { ok: false, erro: "payload_invalido", definitivo: true };
  }
  const manual = job.payload.manual === true;

  // 0. CARREGA. Uma consulta so traz passo, regua, contato e clinica.
  const { data: bruta } = await admin
    .from("cadence_run")
    .select(
      `id, clinic_id, contact_id, appointment_id, scheduled_for, sent_at,
       skipped_reason,
       cadence_step:cadence_step_id (
         id, offset_minutes, fixed_body,
         media_path, media_type, media_mimetype, media_filename,
         cadence:cadence_id (
           id, kind, active, send_window_start, send_window_end,
           send_weekdays, trigger_stage
         )
       ),
       contact:contact_id (
         name, funnel_stage, funnel_stage_changed_at, last_contact_at
       ),
       clinic:clinic_id ( name, timezone )`,
    )
    .eq("clinic_id", job.clinic_id)
    .eq("id", runId)
    .maybeSingle();

  const run = (bruta as LinhaDaRun | null) ?? null;
  const passo = run?.cadence_step ?? null;
  const regua = passo?.cadence ?? null;
  if (!run || !passo || !regua || !run.clinic) {
    return { ok: false, erro: "run_inexistente", definitivo: true };
  }

  // Idempotencia: run resolvida (enviada ou pulada) nao repete o toque.
  if (run.sent_at || run.skipped_reason) {
    return { ok: true };
  }
  if (
    regua.kind !== "confirmacao" &&
    regua.kind !== "pos_falta" &&
    regua.kind !== "followup"
  ) {
    // A 4.9 traz lista_espera; reativacao e futura. Falha fechada: nada sai.
    return { ok: false, erro: "regua_nao_suportada", definitivo: true };
  }
  // Regua desligada depois de o toque ter sido planejado: nada sai. No toque
  // manual quem pediu foi uma pessoa, entao a chave da automacao nao decide.
  if (!regua.active && !manual) {
    await pularRun(admin, run, "condicao_parada");
    return { ok: true };
  }

  const timezone = run.clinic.timezone;
  const agora = new Date();

  // 1. CONSENTIMENTO. Pula e CONTA: nao e erro do job, e escolha do paciente.
  const { data: vigente } = await admin.rpc("consentimento_vigente", {
    p_clinic_id: job.clinic_id,
    p_contact_id: run.contact_id,
    p_channel: "whatsapp",
  });
  if (vigente !== true) {
    await pularRun(admin, run, "sem_consentimento");
    await admin.from("audit_log").insert({
      clinic_id: job.clinic_id,
      user_id: null,
      action: "envio_bloqueado_sem_autorizacao",
      entity: "contact",
      entity_id: run.contact_id,
    });
    return { ok: true };
  }

  // 2. CONDICAO DE PARADA, por tipo de regua.
  //
  // FOLLOW-UP (spec 7.2): as paradas sao estruturais. Sair da etapa (agendou,
  // perdido, qualquer movimento) e responder (last_contact_at depois da
  // entrada na etapa) matam a cadeia inteira; reentrada na etapa torna SO
  // esta run obsoleta (as novas ja nasceram na ancora nova, como na
  // remarcacao de consulta).
  let consulta: LinhaDaConsulta | null = null;
  if (regua.kind === "followup") {
    const contato = run.contact;
    const respondeu =
      contato?.last_contact_at != null &&
      new Date(contato.last_contact_at).getTime() >
        new Date(contato.funnel_stage_changed_at).getTime();
    if (!contato || contato.funnel_stage !== regua.trigger_stage || respondeu) {
      await pararCadeiaDeFollowup(admin, run, regua.id);
      return { ok: true };
    }
    const obsoletaPorReentrada =
      !manual &&
      !passoCondizComAgenda({
        startsAt: new Date(contato.funnel_stage_changed_at),
        offsetMinutes: passo.offset_minutes,
        scheduledFor: new Date(run.scheduled_for),
      });
    if (obsoletaPorReentrada) {
      await pularRun(admin, run, "condicao_parada");
      return { ok: true };
    }
  } else {
    consulta = await carregarConsulta(admin, job.clinic_id, run.appointment_id);
    if (!consulta) {
      await pararCadeia(admin, run);
      return { ok: true };
    }
  }

  // Confirmacao: horario mudou, consulta fora do jogo ou pedido de
  // remarcacao (regras em conferirConfirmacao). Pos falta: a consulta deixou
  // de ser falta ou o paciente ja remarcou depois dela, e a cadeia para.
  if (consulta) {
    if (regua.kind === "confirmacao") {
      const conferencia = conferirConfirmacao(consulta, {
        offsetMinutes: passo.offset_minutes,
        scheduledFor: run.scheduled_for,
        manual,
        agora,
      });
      if (!conferencia.segue) {
        if (conferencia.motivo === "parar_cadeia") {
          await pararCadeia(admin, run);
        } else {
          await pularRun(admin, run, conferencia.motivo);
        }
        return { ok: true };
      }
    } else if (
      consulta.status !== "faltou" ||
      (await remarcouDepoisDaFalta(admin, run, consulta))
    ) {
      await pararCadeia(admin, run);
      return { ok: true };
    }
  }

  // 3. JANELA DE ENVIO, no fuso da clinica. Fora dela nao e falha, e "ainda
  // nao": reagendar_job devolve o job sem queimar tentativa.
  const janela: JanelaDeEnvio = {
    inicio: regua.send_window_start,
    fim: regua.send_window_end,
    diasDaSemana: regua.send_weekdays,
  };
  if (!manual && !dentroDaJanela(janela, agora, timezone)) {
    const abertura = proximaAbertura(janela, agora, timezone);
    if (!abertura) {
      // Janela incompleta ou incoerente: a regua nem deveria estar ativa
      // (check active_exige_janela). Falha fechada, nada sai.
      return { ok: false, erro: "janela_invalida", definitivo: true };
    }
    if (
      regua.kind === "confirmacao" &&
      consulta &&
      abertura.getTime() >= new Date(consulta.starts_at).getTime()
    ) {
      // A janela so reabre depois da consulta: o toque perdeu o sentido.
      await pularRun(admin, run, "fora_janela");
      return { ok: true };
    }
    // A abertura cai em OUTRO dia civil e um toque seguinte sai naquele mesmo
    // dia, antes da consulta: pular agora, em vez de devolver o job so para
    // pula-lo na abertura (a mesma regra roda de novo no envio, com o relogio
    // real).
    if (
      regua.kind === "confirmacao" &&
      consulta &&
      mudouDeDia({
        agora: abertura,
        scheduledFor: new Date(run.scheduled_for),
        timezone,
      })
    ) {
      const decisao = decidirToqueDeConfirmacao({
        agora: abertura,
        scheduledFor: new Date(run.scheduled_for),
        startsAt: new Date(consulta.starts_at),
        offsetDoToque: passo.offset_minutes,
        modelo: passo.fixed_body,
        passos: await carregarPassosDaRegua(admin, job.clinic_id, regua.id),
        janela,
        timezone,
        manual,
      });
      if (decisao.acao === "pular") {
        await pularRun(admin, run, "toque_atrasado");
        return { ok: true };
      }
    }
    return { reagendar: abertura.toISOString() };
  }

  // TOQUE ATRASADO. O toque de confirmacao pode sair num dia civil diferente
  // do vencimento (janela, WhatsApp fora do ar, fila): o "Amanhã" do texto de
  // 24h passaria a mentir, colado no "é hoje" do toque de 3h. Com toque
  // seguinte que sai no MESMO dia civil, antes da consulta, este e pulado;
  // sem, sai com o dia relativo corrigido (melhor avisar que nao avisar: um
  // toque seguinte que so sai num dia depois nao substitui o aviso de hoje).
  // Regras em lib/domain/toque-atrasado.ts.
  let modelo = passo.fixed_body;
  if (
    regua.kind === "confirmacao" &&
    consulta &&
    mudouDeDia({
      agora,
      scheduledFor: new Date(run.scheduled_for),
      timezone,
    })
  ) {
    const decisao = decidirToqueDeConfirmacao({
      agora,
      scheduledFor: new Date(run.scheduled_for),
      startsAt: new Date(consulta.starts_at),
      offsetDoToque: passo.offset_minutes,
      modelo: passo.fixed_body,
      passos: manual
        ? []
        : await carregarPassosDaRegua(admin, job.clinic_id, regua.id),
      janela,
      timezone,
      manual,
    });
    if (decisao.acao === "pular") {
      await pularRun(admin, run, "toque_atrasado");
      return { ok: true };
    }
    modelo = decisao.modelo;
  }

  // NUMERO do toque (varios numeros por clinica, docs/07). O planner carimbou
  // o job pela regra de conta_de_envio; numero_do_job confere a posse e a
  // remocao na hora de executar e recarimba se o numero saiu da clinica antes
  // de o toque gravar mensagem. Desconectado NAO e remocao: o numero continua
  // o mesmo e o toque espera a reconexao (abaixo), sem trocar de numero.
  const numero = await numeroDoJob(admin, job.id, workerId);
  if (numero.estado === "sem_posse") {
    // Outro executor assumiu o job (lease vencido): nada sai daqui.
    return { ok: false, erro: "sem_posse" };
  }
  if (numero.estado === "leitura_falhou") {
    return { ok: false, erro: "leitura_falhou" };
  }
  if (numero.estado === "numero_removido") {
    await pularRun(admin, run, "numero_removido");
    return { ok: false, erro: "numero_removido", definitivo: true };
  }
  // Sem numero ativo na clinica: o "sem conta" de antes. O provedor e o do
  // ambiente e o envio responde desconectado (espera a reconexao).
  const accountId = numero.estado === "ok" ? numero.whatsappAccountId : null;
  let nomeDoProvedor: string | null = null;
  if (accountId) {
    const { data: account, error: erroConta } = await admin
      .from("whatsapp_account")
      .select("provider")
      .eq("clinic_id", job.clinic_id)
      .eq("id", accountId)
      .maybeSingle();
    if (erroConta) {
      return { ok: false, erro: "leitura_falhou" };
    }
    nomeDoProvedor = (account?.provider as string | null | undefined) ?? null;
  }
  const provider = getWhatsAppProvider(nomeDoProvedor);

  // 4 e 5. JANELA DE 24H e TETO DE GASTO sao conceitos do canal OFICIAL da
  // Meta (CLAUDE.md 3.3). No uazapi e no fake nao existe janela de 24h,
  // template aprovado nem custo por mensagem (cost_cents 0, billable false),
  // entao nao ha o que conferir e este ramo nunca roda hoje.
  if (provider.isOfficialChannel) {
    // TODO(cloud_api): conferir a janela de 24h (texto livre ou template
    // aprovado) e o teto de gasto da clinica antes de enviar. Enquanto os
    // dois nao existirem, o toque NAO sai por este caminho.
    return { ok: false, erro: "canal_oficial_pendente", definitivo: true };
  }

  // 6. ENVIO. O conteudo do passo e texto e/ou anexo (decisao do dono em
  // 19/09/2026: pode ser so o audio). Sem nenhum dos dois, o toque e
  // definitivamente invalido.
  const body = modelo && modelo.trim()
    ? renderizarModelo(
        modelo,
        consulta
          ? valoresDoModelo(run, consulta, timezone)
          : valoresDeFollowup(run),
      ).trim()
    : "";
  if (!body && !passo.media_path) {
    return { ok: false, erro: "passo_sem_conteudo", definitivo: true };
  }

  // DEFESA DA REMARCACAO, com a consulta RELIDA. Entre a condicao de parada
  // e este ponto passaram consultas ao banco (e, no reagendamento, horas): a
  // recepcao pode ter remarcado, e o paciente pode ter pedido para remarcar.
  // Perguntar "podemos confirmar?" com o horario velho e o pior toque possivel.
  if (regua.kind === "confirmacao" && run.appointment_id) {
    const atual = await carregarConsulta(
      admin,
      job.clinic_id,
      run.appointment_id,
    );
    const conferencia = atual
      ? conferirConfirmacao(atual, {
          offsetMinutes: passo.offset_minutes,
          scheduledFor: run.scheduled_for,
          manual,
          agora: new Date(),
        })
      : ({ segue: false, motivo: "parar_cadeia" } as const);
    if (!conferencia.segue) {
      if (conferencia.motivo === "parar_cadeia") {
        await pararCadeia(admin, run);
      } else {
        await pularRun(admin, run, conferencia.motivo);
      }
      return { ok: true };
    }
  }

  // A conversa do NUMERO do toque (uma conversa por numero, decisao 1 do
  // dono). As duas mensagens do par (anexo e botoes, ou audio e texto) usam
  // esta mesma conversa, entao saem pelo mesmo numero.
  const { data: conversationId, error: erroConversa } = await admin.rpc(
    "garantir_conversa_aberta",
    {
      p_clinic_id: job.clinic_id,
      p_contact_id: run.contact_id,
      ...(accountId ? { p_whatsapp_account_id: accountId } : {}),
    },
  );
  if (erroConversa || typeof conversationId !== "string") {
    return { ok: false, erro: "conversa_indisponivel" };
  }

  const envio = {
    clinicId: job.clinic_id,
    conversationId,
    contactId: run.contact_id,
    // Assercao: a conversa e deste numero. Divergiu, nada sai (send.ts).
    whatsappAccountId: accountId,
    body,
    authorUserId: null,
    author: "sistema" as const,
    // Envio do motor: reserva no slot de MASSA, que a resposta digitada no
    // Inbox nunca espera (decisao do dono de 24/09/2026).
    envioAutomatico: true,
    espacamentoMs: espacamentoDeMassaMs(),
    // Teto CURTO: o piso do espacamento de massa e 10 segundos, entao quase
    // todo toque concorrente cai em adiamento e nao em espera. Esperar de
    // verdade nao cabe num ambiente sem servidor, e adiar nao custa nada.
    esperaMaximaMs: 3_000,
    // Chave de idempotencia: um retry encontra a message e nao reenvia.
    jobId: job.id,
  };

  let resultado;
  if (passo.media_path) {
    // O anexo VIVE em midia-de-regua; a mensagem nasce com uma COPIA em
    // midia-conversas/<clinic>/<message_id>, para a policy de leitura, a
    // rota de midia e o fluxo de apagar valerem sem excecao nova.
    const download = await admin.storage
      .from("midia-de-regua")
      .download(passo.media_path);
    if (download.error || !download.data) {
      // Transiente ate prova em contrario: storage fora do ar nao pode
      // matar o toque para sempre.
      return { ok: false, erro: "anexo_ilegivel" };
    }
    const bytes = Buffer.from(await download.data.arrayBuffer());

    // O CAMINHO DA COPIA SEGUE A LINHA message DONA DO ENVIO (achado da
    // revisao de 19/09): a linha nasce em send.ts ANTES do despacho, com
    // media_url apontando para a copia, e um retry REUSA a linha pela chave
    // do job sem nunca reescrever media_url. Se cada passagem inventasse um
    // uuid novo, a falha transitoria deixava a linha apontando para um
    // objeto de uma passagem e o objeto vivo em outra (balao que nunca
    // abre + orfao permanente). Reusar o id da linha existente faz o
    // upsert REGRAVAR exatamente o caminho que media_url ja referencia.
    const { data: linhaExistente } = await admin
      .from("message")
      .select("id")
      .eq("clinic_id", job.clinic_id)
      .eq("job_id", job.id)
      .maybeSingle();
    const messageId = (linhaExistente?.id as string | undefined) ?? crypto.randomUUID();
    const caminhoDaConversa = `${job.clinic_id}/${messageId}`;
    const upload = await admin.storage
      .from("midia-conversas")
      .upload(caminhoDaConversa, bytes, {
        contentType: passo.media_mimetype ?? "application/octet-stream",
        upsert: true,
        cacheControl: "0",
      });
    if (upload.error) {
      return { ok: false, erro: "copia_do_anexo_falhou" };
    }
    // AUDIO NAO MOSTRA LEGENDA no WhatsApp (achado da revisao de 24/09): o
    // texto do passo, com data e hora, ia como legenda e nunca chegava ao
    // paciente. Com audio, o audio sai SEM legenda e o texto vira mensagem
    // propria logo depois: na confirmacao, e o corpo dos botoes; nos demais
    // kinds, um texto simples. Foto e documento continuam com legenda.
    const audioComTexto = passo.media_type === "audio" && body.length > 0;
    const temSegundaMensagem = regua.kind === "confirmacao" || audioComTexto;
    resultado = await sendWhatsAppMedia(admin, {
      ...envio,
      body: audioComTexto ? "" : body,
      // Com segunda mensagem (os botoes da confirmacao ou o texto do audio),
      // o toque e UM par: a midia reserva um espacamento CURTO E FIXO abaixo
      // do teto de espera do proximo envio (3s), para o par sair na MESMA
      // passagem (o sorteio padrao de 1,5 a 4s separava o par em ~1/3 dos
      // envios, achado da revisao de 19/09); o espacamento de massa fica com
      // a ULTIMA mensagem do par. Sem segunda mensagem, a midia carrega a
      // massa.
      ...(temSegundaMensagem ? { espacamentoMs: 1_500 } : {}),
      messageId,
      midia: {
        tipo: passo.media_type ?? "document",
        base64: bytes.toString("base64"),
        mimetype: passo.media_mimetype ?? "application/octet-stream",
        nomeDoArquivo: passo.media_filename,
        caminhoNoStorage: caminhoDaConversa,
      },
    });
    if (!resultado.ok && resultado.reason !== "ja_enviado") {
      // So se remove copia que NENHUMA linha referencia. A falha pode ter
      // acontecido depois do insert (a linha ja aponta para o caminho, e o
      // retry vai regravar o MESMO caminho) ou antes (slot adiado,
      // desconectado): a consulta decide, nunca o palpite. Em 'ja_enviado'
      // o objeto regravado E o referenciado.
      const { data: aindaSemLinha } = await admin
        .from("message")
        .select("id")
        .eq("clinic_id", job.clinic_id)
        .eq("job_id", job.id)
        .maybeSingle();
      if (!aindaSemLinha) {
        await admin.storage.from("midia-conversas").remove([caminhoDaConversa]);
      }
    }
    if (
      (resultado.ok || resultado.reason === "ja_enviado") &&
      temSegundaMensagem
    ) {
      // Botao e midia nao viajam na mesma mensagem, e audio nao carrega
      // texto: a segunda mensagem sai SEM jobId (a chave de idempotencia
      // ficou na midia). Retry depois de segunda mensagem perdida reenvia so
      // ela; duplicata rara, aceita. Se o slot da clinica adiar a segunda, o
      // proprio adiamento reagenda o job e a midia nao repete (ja_enviado
      // pela chave do job).
      //
      // Nota assumida: linha de midia morta em 'enviando' (processo caiu
      // entre o registro e o envio) vira 'ja_enviado' no retry e a segunda
      // sai sem a midia ter saido; e a mesma perda menor e visivel do envio
      // de texto (send.ts registra), aceita la e aca.
      resultado =
        regua.kind === "confirmacao"
          ? await sendWhatsAppMenu(admin, {
              ...envio,
              jobId: undefined,
              // Com audio, o texto do passo (data e hora da consulta) e o
              // corpo dos botoes; a frase generica fica so para passo sem
              // texto ou com foto/documento, cujo texto ja foi na legenda.
              body: audioComTexto ? body : CORPO_DO_MENU_APOS_MIDIA,
              options: MENU_CONFIRMACAO,
            })
          : await sendWhatsAppText(admin, {
              ...envio,
              jobId: undefined,
              body,
            });
      if (!resultado.ok && resultado.reason !== "ja_enviado") {
        // A midia JA CHEGOU ao paciente e so a segunda mensagem falhou. Na
        // ultima tentativa do job (ou falha definitiva), fechar a run como
        // enviada apontando para a MENSAGEM DA MIDIA cega menos que deixa-la
        // pendente para sempre: o paciente recebeu o toque e ainda pode
        // responder por texto (o interceptador entende confirmo/cancelo sem
        // menu). Falha retentavel fora da ultima tentativa segue o fluxo
        // normal (o retry reenvia SO a segunda mensagem).
        const ultimaTentativa = job.attempts + 1 >= job.max_attempts;
        const definitiva =
          resultado.reason === "falha_envio" &&
          !falhaPermiteRetry(resultado.code);
        if (ultimaTentativa || definitiva) {
          const { data: mensagemDaMidia } = await admin
            .from("message")
            .select("id")
            .eq("clinic_id", job.clinic_id)
            .eq("job_id", job.id)
            .maybeSingle();
          await admin
            .from("cadence_run")
            .update({
              sent_at: new Date().toISOString(),
              message_id: (mensagemDaMidia?.id as string | undefined) ?? null,
            })
            .eq("id", run.id)
            .is("sent_at", null);
          if (regua.kind === "confirmacao" && run.appointment_id) {
            await admin.rpc("marcar_aguardando_confirmacao", {
              p_clinic_id: job.clinic_id,
              p_appointment_id: run.appointment_id,
            });
          }
          log.warn("menu_do_par_nao_saiu", {
            clinic_id: job.clinic_id,
            job_id: job.id,
          });
          return { ok: true };
        }
      }
    }
  } else {
    resultado =
      regua.kind === "confirmacao"
        ? await sendWhatsAppMenu(admin, { ...envio, options: MENU_CONFIRMACAO })
        : await sendWhatsAppText(admin, envio);
  }

  if (resultado.ok || resultado.reason === "ja_enviado") {
    let messageId: string | null = resultado.ok ? resultado.messageId : null;
    if (!messageId) {
      // 'ja_enviado': a mensagem saiu numa passagem anterior; recupera o id
      // pela chave do job para a run apontar para ela.
      const { data: existente } = await admin
        .from("message")
        .select("id")
        .eq("clinic_id", job.clinic_id)
        .eq("job_id", job.id)
        .maybeSingle();
      messageId = (existente?.id as string | undefined) ?? null;
    }
    await admin
      .from("cadence_run")
      .update({ sent_at: new Date().toISOString(), message_id: messageId })
      .eq("id", run.id)
      .is("sent_at", null);

    // A consulta entra em 'aguardando_confirmacao' (o mapa de status exige a
    // parada antes de 'confirmado_paciente'). Roda tambem no caminho
    // 'ja_enviado' para fechar a janela do processo que morreu entre o envio
    // e a mudanca de status. A RPC e condicional, entao repetir nao machuca.
    if (regua.kind === "confirmacao" && run.appointment_id) {
      await admin.rpc("marcar_aguardando_confirmacao", {
        p_clinic_id: job.clinic_id,
        p_appointment_id: run.appointment_id,
      });
    }
    return { ok: true };
  }

  if (resultado.reason === "sem_consentimento") {
    // Revogado durante a espera do slot: o descadastro vale na hora.
    await pularRun(admin, run, "sem_consentimento");
    return {
      ok: false,
      erro: resultado.code ?? "sem_consentimento",
      definitivo: true,
    };
  }

  // WhatsApp fora do ar nao e falha do toque, e "ainda nao": reagendar em vez
  // de falhar, do mesmo jeito que a janela de envio faz. Antes isto queimava
  // tentativa, e uma queda de celular de 20 minutos matava para sempre os
  // toques da manha inteira, sem reagendar nada quando a clinica reconectava e
  // sem contar em lugar nenhum o que deixou de sair.
  //
  // A desistencia e por PRAZO, nao por contagem: para a confirmacao, faz
  // sentido esperar enquanto a consulta nao chegou; depois dela o toque perdeu
  // o sentido. Para o pos falta, algumas horas.
  // Canal ocupado: devolve para quando o slot da clinica abre. Mesma regra de
  // prazo do desconectado, e pelo mesmo motivo: um toque de confirmacao que so
  // sairia depois da consulta perdeu o sentido, e ficar indo e voltando para
  // sempre esconderia o problema numa fila que parece saudavel.
  if (resultado.reason === "slot_adiado") {
    const consultaDaEspera = await carregarConsulta(
      admin,
      job.clinic_id,
      run.appointment_id,
    );
    const limite =
      regua.kind === "confirmacao" && consultaDaEspera
        ? new Date(consultaDaEspera.starts_at).getTime()
        : Date.now() + 12 * 60 * 60_000;
    const proxima = resultado.livreEm
      ? new Date(resultado.livreEm).getTime()
      : Date.now() + 20_000;
    if (proxima < limite) {
      return {
        reagendar: new Date(proxima).toISOString(),
        motivo: "canal_ocupado",
      };
    }
    await pularRun(admin, run, "canal_ocupado");
    return { ok: false, erro: "canal_ocupado", definitivo: true };
  }

  // Numero REMOVIDO entre numero_do_job e o envio: este envio nao gravou
  // nada. Volta ja para a fila: a proxima passagem pergunta de novo a
  // numero_do_job, que recarimba pelo numero que sobrou ou, se o par ja
  // gravou a midia por ele, pula a run com 'numero_removido'. Esperar os 5
  // minutos da reconexao nao faria sentido: removido nao reconecta.
  if (
    resultado.reason === "desconectado" &&
    resultado.code === "numero_removido"
  ) {
    return { reagendar: new Date().toISOString(), motivo: "numero_removido" };
  }

  if (resultado.reason === "desconectado") {
    const consultaDaEspera = await carregarConsulta(
      admin,
      job.clinic_id,
      run.appointment_id,
    );
    const limite =
      regua.kind === "confirmacao" && consultaDaEspera
        ? new Date(consultaDaEspera.starts_at).getTime()
        : Date.now() + 12 * 60 * 60_000;
    const proxima = Date.now() + ESPERA_DE_RECONEXAO_MS;
    if (proxima < limite) {
      return { reagendar: new Date(proxima).toISOString() };
    }
    await pularRun(admin, run, "desconectado");
    return { ok: false, erro: "desconectado", definitivo: true };
  }

  // So entra em retry o que COM CERTEZA nao chegou ao paciente. Na ultima
  // tentativa a run tambem fecha, para nao ficar pendurada para sempre.
  const podeRepetir = falhaPermiteRetry(resultado.code);
  if (!podeRepetir || job.attempts >= job.max_attempts) {
    await pularRun(admin, run, "falha_envio");
  }
  return {
    ok: false,
    erro: resultado.code ?? resultado.reason,
    definitivo: !podeRepetir,
  };
}
