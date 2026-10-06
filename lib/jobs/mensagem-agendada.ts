import type { SupabaseClient } from "@supabase/supabase-js";

import { decidirEsperaDoCanal } from "@/lib/domain/espera-do-canal";
import {
  decidirJanelaDaAgendada,
  FOLGA_DA_JANELA_MS,
  prazoDaEsperaDaAgendada,
  prazoEfetivoDaAgendada,
} from "@/lib/domain/mensagem-agendada";
import {
  falhaPermiteRetry,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";
import { log } from "@/lib/log";

import { codigoDoErro, ErroComCodigoDeJob } from "./erro-de-job";
import { espacamentoDeMassaMs } from "./espacamento";
import type { Job, ResultadoDeJob } from "./worker";

// Executor da MENSAGEM AGENDADA (kind 'enviar_mensagem_agendada', tabela
// mensagem_agendada da migration 20261006140000). A planejadora do motor
// (planejar_mensagens_agendadas) cria o job quando a hora chega, com payload
// so de ids (contact_id e mensagem_agendada_id: NUNCA o texto), e marca a
// agendada como 'enviando'. Este arquivo envia; quem fecha a agendada
// (enviada, nao enviada, nao confirmada) e a reconciliacao no banco
// (reconciliar_mensagem_agendada), que o worker chama depois de concluir ou
// falhar o job (fecharAgendadaDoJob) e o motor repete para o que escapar.
//
// A ORDEM e a defesa (desenho revisado 2.2, decisoes do dono de 06/10/2026):
//   0. payload com dois uuids, senao definitivo
//   1. IDEMPOTENCIA antes de tudo: a message deste job (unique de job_id).
//      Enviada nao repete; 'enviando' pode ter chegado e nunca repete
//      ('envio_incerto'); falha retentavel segue
//   2. a agendada ainda e DESTE job (excluida, revogada ou fechada nao sai)
//   3. prazo: enviar_em + 12 h, com 5 minutos de folga do relogio (ancora
//      fixa na hora marcada)
//   4. numero FIXO (o da agendada; nunca troca) e conectado, ANTES de
//      garantir a conversa: nenhuma conversa nasce com o numero caido. A
//      espera da reconexao vai ate o limite real (prazoEfetivoDaAgendada)
//   5. autorizacao vigente (regra 3.3)
//   6. madrugada (A2): a atrasada nao sai entre 21:00 e 08:00 no fuso da
//      clinica. Antes da conversa, pelo mesmo motivo do passo 4
//   7. a conversa aberta do contato NESTE numero (sem atribuir ninguem: a
//      conversa so fica com o assinante depois de sair, na reconciliacao)
//   8. envio pelo trilho automatico, em nome do assinante (A1), sem derrubar
//      o "Aguardando voce" e com o bloqueio na trilha sem pessoa
//
// O termo da jornada NAO anda (A4): a agendada foi escrita antes. O texto
// nunca vai para log nem para last_error: so codigos curtos saem daqui.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ehUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

/** Estados da message que provam que o envio saiu. */
const SAIU = new Set(["enviada", "entregue", "lida"]);

/** Fuso de quando a clinica nao tem um gravado (regra 3.6). */
const FUSO_PADRAO = "America/Fortaleza";

type MensagemDoJob = {
  delivery_status: string | null;
  error_code: string | null;
};

type AgendadaDoJob = {
  situacao: string;
  job_id: string | null;
  texto: string | null;
  enviar_em: string;
  criada_por: string;
  editada_por: string | null;
  whatsapp_account_id: string;
  contact_id: string;
  clinic: { timezone: string | null } | { timezone: string | null }[] | null;
};

function definitivo(erro: string): ResultadoDeJob {
  return { ok: false, erro, definitivo: true };
}

function fusoDa(agendada: AgendadaDoJob): string {
  const clinica = Array.isArray(agendada.clinic)
    ? (agendada.clinic[0] ?? null)
    : agendada.clinic;
  return clinica?.timezone?.trim() || FUSO_PADRAO;
}

/**
 * Numero caido: espera a reconexao DELE, em voltas de 5 ate 30 minutos sem
 * queimar tentativa, ate o limite REAL da agendada (prazoEfetivoDaAgendada:
 * o prazo de enviar_em + 12 h, ou as 21:00 antes dele quando dali em diante
 * ela cairia de madrugada). E o mesmo limite que a lista mostra em "Se o
 * numero nao reconectar ate...". Sem tempo util antes dele, desiste:
 * 'desconectado' quando o limite e o prazo ("o numero ficou desconectado
 * por mais de 12 horas"), 'madrugada' quando a faixa de silencio cortou
 * antes ("o envio atrasou e cairia de madrugada").
 */
function esperarONumero(
  job: Job,
  agora: number,
  agendada: Pick<AgendadaDoJob, "enviar_em">,
  fuso: string,
): ResultadoDeJob {
  const prazo = prazoDaEsperaDaAgendada(agendada.enviar_em);
  const limite = prazoEfetivoDaAgendada(agendada.enviar_em, fuso);
  return (
    decidirEsperaDoCanal({
      motivo: "desconectado",
      payload: job.payload,
      agora,
      prazo: limite,
    }) ?? definitivo(limite < prazo ? "madrugada" : "desconectado")
  );
}

export async function executarMensagemAgendada(
  admin: SupabaseClient,
  job: Job,
): Promise<ResultadoDeJob> {
  // 0. Payload: so ids. Fora do contrato, nada a fazer.
  const agendadaId = job.payload.mensagem_agendada_id;
  const contactId = job.payload.contact_id;
  if (!ehUuid(agendadaId) || !ehUuid(contactId)) {
    return definitivo("payload_invalido");
  }

  // 1. IDEMPOTENCIA, antes de qualquer outra leitura: se este job ja gravou
  // mensagem, um retry (lease vencido, queda no meio) esta rodando.
  const { data: anterior, error: erroAnterior } = await admin
    .from("message")
    .select("delivery_status, error_code")
    .eq("clinic_id", job.clinic_id)
    .eq("job_id", job.id)
    .maybeSingle();
  if (erroAnterior) {
    return { ok: false, erro: "leitura_falhou" };
  }
  if (anterior) {
    const mensagem = anterior as MensagemDoJob;
    if (mensagem.delivery_status && SAIU.has(mensagem.delivery_status)) {
      // Ja saiu: o job conclui e a reconciliacao fecha a agendada como
      // enviada, sem novo envio.
      return { ok: true };
    }
    if (mensagem.delivery_status === "falhou") {
      const codigo = mensagem.error_code ?? undefined;
      if (!falhaPermiteRetry(codigo)) {
        return definitivo(codigo ?? "falha_no_envio");
      }
      // Falha que COM CERTEZA nao chegou ao paciente: segue, e send.ts reusa
      // a mesma linha pela chave do job.
    } else {
      // 'enviando' (ou estado desconhecido): pode ter chegado ao paciente.
      // Nunca repete; a reconciliacao fecha como nao confirmada.
      return definitivo("envio_incerto");
    }
  }

  // 2. A agendada ainda e deste job. Excluida, revogada, encerrada pelo
  // remover_numero ou fechada por outro caminho: nada sai.
  const { data: lida, error: erroAgendada } = await admin
    .from("mensagem_agendada")
    .select(
      "situacao, job_id, texto, enviar_em, criada_por, editada_por, whatsapp_account_id, contact_id, clinic:clinic_id (timezone)",
    )
    .eq("clinic_id", job.clinic_id)
    .eq("id", agendadaId)
    .maybeSingle();
  if (erroAgendada) {
    return { ok: false, erro: "leitura_falhou" };
  }
  const agendada = lida as AgendadaDoJob | null;
  const texto = agendada?.texto;
  if (
    !agendada ||
    agendada.situacao !== "enviando" ||
    agendada.job_id !== job.id ||
    agendada.contact_id !== contactId ||
    typeof texto !== "string" ||
    !texto.trim()
  ) {
    return definitivo("agendada_encerrada");
  }

  // 3. Prazo: 12 horas depois da hora marcada, mais a folga do relogio
  // (FOLGA_DA_JANELA_MS: a agendada das 20:00 que esperou o 08:00, o
  // proprio prazo, acorda segundos depois dele e ainda sai). Ancora fixa: o
  // relogio do retry nunca empurra o prazo.
  const agora = Date.now();
  const prazo = prazoDaEsperaDaAgendada(agendada.enviar_em);
  if (agora > prazo + FOLGA_DA_JANELA_MS) {
    return definitivo("atrasou");
  }
  const fuso = fusoDa(agendada);

  // 4. Numero FIXO: o da agendada, que a planejadora carimbou no job. Nunca
  // troca de numero (este executor nao chama numero_do_job). Antes de
  // garantir a conversa: com o numero caido, nenhuma conversa nasce.
  const numeroId = agendada.whatsapp_account_id;
  if (job.whatsapp_account_id !== numeroId) {
    return definitivo("conta_divergente");
  }
  const { data: numero, error: erroNumero } = await admin
    .from("whatsapp_account")
    .select("connection_status, removido_em")
    .eq("clinic_id", job.clinic_id)
    .eq("id", numeroId)
    .maybeSingle();
  if (erroNumero) {
    return { ok: false, erro: "leitura_falhou" };
  }
  if (!numero || numero.removido_em) {
    return definitivo("numero_removido");
  }
  if (numero.connection_status !== "conectado") {
    return esperarONumero(job, agora, agendada, fuso);
  }

  // 5. Autorizacao vigente (regra 3.3). sendWhatsAppText reconfere na hora
  // do envio; esta leitura evita a conversa aberta para quem revogou.
  const { data: vigente, error: erroDoConsentimento } = await admin.rpc(
    "consentimento_vigente",
    {
      p_clinic_id: job.clinic_id,
      p_contact_id: contactId,
      p_channel: "whatsapp",
    },
  );
  if (erroDoConsentimento) {
    // Sem resposta nao e revogacao: retry, sem registrar um bloqueio que o
    // paciente nao pediu.
    throw new ErroComCodigoDeJob(
      `consentimento_ilegivel: ${codigoDoErro(erroDoConsentimento)}`,
    );
  }
  if (vigente !== true) {
    await admin.from("audit_log").insert({
      clinic_id: job.clinic_id,
      user_id: null,
      action: "envio_bloqueado_sem_autorizacao",
      entity: "contact",
      entity_id: contactId,
    });
    return definitivo("sem_consentimento");
  }

  // 6. Madrugada (A2): a ATRASADA (mais de 15 minutos depois da hora
  // marcada) nao chega entre 21:00 e 08:00 no fuso da clinica. Vale tambem
  // na volta da espera do numero e do slot adiado, porque todo retorno passa
  // por aqui. Antes da conversa: nenhuma conversa nasce as 3 da manha so
  // para esperar as 8.
  const janela = decidirJanelaDaAgendada({
    enviarEm: agendada.enviar_em,
    agora,
    fuso,
  });
  if (janela.acao === "desistir") {
    // 'atrasou' (passou do prazo) ou 'madrugada' (cairia na faixa de
    // silencio com o 08:00 seguinte depois do prazo).
    return definitivo(janela.motivo);
  }
  if (janela.acao === "esperar") {
    return { reagendar: janela.ate, motivo: "silencio_noturno" };
  }

  // 7. A conversa aberta do contato NESTE numero (uma conversa por numero).
  // Nenhuma atribuicao aqui: a conversa so fica com o assinante depois que a
  // mensagem sai, e so se ela estiver aguardando e sem atendente.
  const { data: conversationId, error: erroConversa } = await admin.rpc(
    "garantir_conversa_aberta",
    {
      p_clinic_id: job.clinic_id,
      p_contact_id: contactId,
      p_whatsapp_account_id: numeroId,
    },
  );
  if (erroConversa || typeof conversationId !== "string") {
    return { ok: false, erro: "conversa_indisponivel" };
  }

  // 8. Envio. Assina quem editou por ultimo, senao quem criou (A1). Trilho
  // automatico com o espacamento de massa (anti-ban) e teto curto de espera:
  // o canal ocupado devolve o job sem reservar nada.
  const resultado = await sendWhatsAppText(admin, {
    clinicId: job.clinic_id,
    conversationId,
    contactId,
    body: texto,
    authorUserId: agendada.editada_por ?? agendada.criada_por,
    author: "usuario",
    envioAutomatico: true,
    espacamentoMs: espacamentoDeMassaMs(),
    esperaMaximaMs: 3_000,
    jobId: job.id,
    // Assercao: a conversa e deste numero. Divergiu, nada sai (send.ts).
    whatsappAccountId: numeroId,
    manterAguardando: true,
    trilhaDoSistema: true,
  });

  if (resultado.ok) {
    return { ok: true };
  }
  // Numero removido entre a leitura e o envio: a agendada nunca troca de
  // numero, entao e definitivo (no envio ativo comum o retry recarimba).
  if (resultado.code === "numero_removido") {
    return definitivo("numero_removido");
  }
  // Canal ocupado: volta quando o canal abre, sem queimar tentativa.
  if (resultado.reason === "slot_adiado") {
    return {
      reagendar:
        resultado.livreEm ?? new Date(Date.now() + 20_000).toISOString(),
      motivo: "canal_ocupado",
    };
  }
  // Corrida com outra execucao do mesmo job: a reconciliacao le a message.
  if (resultado.reason === "ja_enviado") {
    return { ok: true };
  }
  if (resultado.reason === "sem_consentimento") {
    return definitivo(resultado.code ?? "sem_consentimento");
  }
  if (resultado.reason === "desconectado") {
    return esperarONumero(job, agora, agendada, fuso);
  }
  // So repete o que COM CERTEZA nao chegou ao paciente.
  return {
    ok: false,
    erro: resultado.code ?? resultado.reason,
    definitivo: !falhaPermiteRetry(resultado.code),
  };
}

/**
 * Fecha a agendada do job no banco (reconciliar_mensagem_agendada) logo
 * depois de concluir ou falhar o job, para a lista da conversa nao esperar a
 * proxima passagem do motor. NUNCA lanca: roda depois de o job ja estar
 * fechado, e uma excecao aqui viraria um segundo fechamento. O motor
 * (reconciliar_mensagens_agendadas) cobre o que escapar. Nao e chamado no
 * reagendado: a agendada continua 'enviando'.
 */
export async function fecharAgendadaDoJob(
  admin: SupabaseClient,
  job: Pick<Job, "id" | "clinic_id" | "payload">,
): Promise<void> {
  const agendadaId = job.payload.mensagem_agendada_id;
  if (!ehUuid(agendadaId)) {
    return;
  }
  try {
    const { error } = await admin.rpc("reconciliar_mensagem_agendada", {
      p_agendada_id: agendadaId,
    });
    if (error) {
      log.warn("agendada_fechamento_falhou", {
        job_id: job.id,
        clinic_id: job.clinic_id,
        error_code: codigoDoErro(error),
      });
    }
  } catch {
    log.warn("agendada_fechamento_falhou", {
      job_id: job.id,
      clinic_id: job.clinic_id,
      error_code: "excecao",
    });
  }
}
