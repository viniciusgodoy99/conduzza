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
import type { MenuOption } from "@/lib/integrations/whatsapp/provider";
import { getWhatsAppProvider } from "@/lib/integrations/whatsapp/provider";
import {
  falhaPermiteRetry,
  sendWhatsAppMenu,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";
import { espacamentoDeMassaMs } from "./espacamento";
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

/**
 * Botoes da confirmacao (spec 4.7). Os ids sao o contrato com o webhook: e
 * por eles que a resposta do paciente vira confirmar_pelo_paciente ou
 * cancelar_pelo_paciente. O fallback em texto numerado e do provider.
 */
export const MENU_CONFIRMACAO: MenuOption[] = [
  { id: "confirmar", text: "Confirmar presença" },
  { id: "cancelar", text: "Preciso cancelar" },
];

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
const STATUS_A_CONFIRMAR = ["agendado", "aguardando_confirmacao"];

type ReguaDaRun = {
  id: string;
  kind: string;
  active: boolean;
  send_window_start: string | null;
  send_window_end: string | null;
  send_weekdays: number[] | null;
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
    cadence: ReguaDaRun | null;
  } | null;
  contact: { name: string | null } | null;
  clinic: { name: string; timezone: string } | null;
};

type LinhaDaConsulta = {
  id: string;
  status: string;
  starts_at: string;
  send_confirmation: boolean;
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
  | "desconectado";

/** Fecha ESTA run, sem tocar em run ja enviada ou ja pulada. */
async function pularRun(
  admin: SupabaseClient,
  run: LinhaDaRun,
  motivo: MotivoDePulo,
): Promise<void> {
  await admin
    .from("cadence_run")
    .update({ skipped_reason: motivo })
    .eq("id", run.id)
    .is("sent_at", null)
    .is("skipped_reason", null);
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
      `id, status, starts_at, send_confirmation,
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
         cadence:cadence_id (
           id, kind, active, send_window_start, send_window_end, send_weekdays
         )
       ),
       contact:contact_id ( name ),
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
  if (regua.kind !== "confirmacao" && regua.kind !== "pos_falta") {
    // Fase 4.8 e 4.9 trazem os outros tipos. Falha fechada: nada sai.
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

  // 2. CONDICAO DE PARADA.
  const consulta = await carregarConsulta(
    admin,
    job.clinic_id,
    run.appointment_id,
  );
  if (!consulta) {
    await pararCadeia(admin, run);
    return { ok: true };
  }

  const parou =
    regua.kind === "confirmacao"
      ? !STATUS_A_CONFIRMAR.includes(consulta.status) ||
        new Date(consulta.starts_at).getTime() <= agora.getTime() ||
        !consulta.send_confirmation ||
        // Consulta remarcada: o toque velho aponta para o horario antigo. A
        // run manual nao passa por aqui: ela nasceu agora, ja com o horario
        // que a tela mostrou.
        (!manual &&
          !passoCondizComAgenda({
            startsAt: new Date(consulta.starts_at),
            offsetMinutes: passo.offset_minutes,
            scheduledFor: new Date(run.scheduled_for),
          }))
      : consulta.status !== "faltou" ||
        (await remarcouDepoisDaFalta(admin, run, consulta));
  if (parou) {
    await pararCadeia(admin, run);
    return { ok: true };
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
      abertura.getTime() >= new Date(consulta.starts_at).getTime()
    ) {
      // A janela so reabre depois da consulta: o toque perdeu o sentido.
      await pularRun(admin, run, "fora_janela");
      return { ok: true };
    }
    return { reagendar: abertura.toISOString() };
  }

  const { data: account } = await admin
    .from("whatsapp_account")
    .select("provider")
    .eq("clinic_id", job.clinic_id)
    .maybeSingle();
  const provider = getWhatsAppProvider(account?.provider);

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

  // 6. ENVIO.
  const modelo = passo.fixed_body;
  if (!modelo || !modelo.trim()) {
    return { ok: false, erro: "passo_sem_texto", definitivo: true };
  }
  const body = renderizarModelo(
    modelo,
    valoresDoModelo(run, consulta, timezone),
  ).trim();
  if (!body) {
    return { ok: false, erro: "mensagem_vazia", definitivo: true };
  }

  const { data: conversationId, error: erroConversa } = await admin.rpc(
    "garantir_conversa_aberta",
    { p_clinic_id: job.clinic_id, p_contact_id: run.contact_id },
  );
  if (erroConversa || typeof conversationId !== "string") {
    return { ok: false, erro: "conversa_indisponivel" };
  }

  const envio = {
    clinicId: job.clinic_id,
    conversationId,
    contactId: run.contact_id,
    body,
    authorUserId: null,
    author: "sistema" as const,
    espacamentoMs: espacamentoDeMassaMs(),
    // A espera pelo slot E o trabalho do worker; o teto so protege o lease.
    esperaMaximaMs: 35_000,
    // Chave de idempotencia: um retry encontra a message e nao reenvia.
    jobId: job.id,
  };
  const resultado =
    regua.kind === "confirmacao"
      ? await sendWhatsAppMenu(admin, { ...envio, options: MENU_CONFIRMACAO })
      : await sendWhatsAppText(admin, envio);

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

  // So entra em retry o que COM CERTEZA nao chegou ao paciente. Na ultima
  // tentativa a run tambem fecha, para nao ficar pendurada para sempre.
  const podeRepetir =
    resultado.reason === "desconectado" || falhaPermiteRetry(resultado.code);
  if (!podeRepetir || job.attempts >= job.max_attempts) {
    await pularRun(
      admin,
      run,
      resultado.reason === "desconectado" ? "desconectado" : "falha_envio",
    );
  }
  return {
    ok: false,
    erro: resultado.code ?? resultado.reason,
    definitivo: !podeRepetir,
  };
}
