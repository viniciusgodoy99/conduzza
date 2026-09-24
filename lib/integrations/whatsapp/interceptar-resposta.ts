import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  interpretarRespostaDeOferta,
  REPOUSO_POS_OFERTA_MS,
} from "@/lib/domain/lista-espera";
import { renderizarModelo } from "@/lib/domain/modelo-mensagem";
import {
  ehRespostaDoMenuDeConfirmacao,
  interpretarResposta,
  JANELA_DE_CONTEXTO_MS,
  qualPerguntaFoiRespondida,
  type Citacao,
  type FatosDaResposta,
  type OfertaPerguntada,
  type ToqueEnviado,
} from "@/lib/domain/resposta-paciente";
import {
  RESPOSTA_CANCELADA,
  RESPOSTA_CONFIRMADA,
  RESPOSTA_OFERTA_GANHOU,
  RESPOSTA_OFERTA_PERDIDA,
  RESPOSTA_OFERTA_RECUSADA,
  RESPOSTA_REMARCAR,
} from "@/lib/domain/textos-padrao";

// Interceptador da resposta do paciente ao toque de confirmacao (tarefa 4.7)
// e a oferta da lista de espera (4.9). Roda no webhook, DEPOIS de a mensagem
// estar salva, e e o que faz o status da agenda mudar sozinho quando alguem
// toca em "Confirmar".
//
// Quatro cuidados que sustentam o resto:
//
// 1. SO RESPONDE QUEM FOI PERGUNTADO, E PELA ULTIMA PERGUNTA. Os fatos do
//    banco (toques enviados, oferta enviada, a ultima mensagem de gente da
//    clinica, a citacao do WhatsApp, a conversa assumida por alguem) vao para
//    qualPerguntaFoiRespondida, que e pura e testada. Se a recepcao falou
//    depois do toque, se a conversa esta em atendimento, se ha duas consultas
//    perguntadas sem citacao, ninguem interpreta: a conversa ja esta
//    esperando a recepcao, e esse e o fail-safe (revisao de 24/09).
// 2. LEITURA CONSERVADORA. interpretarResposta so devolve intencao com frase
//    inteira reconhecida; qualquer sobra vira 'nao_reconhecida' e nada
//    acontece. Interpretar errado cancela a consulta de alguem.
// 3. QUEM DECIDE E O BANCO. As RPCs fazem update condicional no status atual,
//    entao resposta repetida (ou duas chegando juntas) muda uma vez so e o
//    segundo caminho recebe { ok: false, erro: 'ja_tratado' } sem efeito.
// 4. FATO QUE NAO DA PARA LER E DUVIDA. Erro de consulta ao banco no meio da
//    coleta nao vira "nao houve mensagem da recepcao": o interceptador se
//    cala e a recepcao decide.
//
// Regra 3.1 do CLAUDE.md: este arquivo nao loga nada. O corpo da mensagem do
// paciente entra aqui e nao sai em lugar nenhum.

// Teto de toques lidos por resposta: tres passos por consulta e um ou outro
// follow up cabem com folga numa semana.
const TOQUES_CONSIDERADOS = 20;

// Conversas do contato consideradas: a resolvida e reaberta vira outra linha,
// e o fio do WhatsApp continua sendo um so.
const CONVERSAS_CONSIDERADAS = 20;

export type EntradaDaResposta = {
  clinicId: string;
  contactId: string;
  conversationId: string;
  body: string | null;
  contentType: string;
  /**
   * wa_message_id da mensagem que o paciente citou (tocar num botao cita o
   * menu; "responder" cita a mensagem escolhida). Quando vem, ela decide a
   * que pergunta a resposta se refere.
   */
  quotedWaMessageId?: string | null;
};

/** O embed aninhado do PostgREST chega como objeto ou array, conforme o caso. */
function um<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

function kindDoToque(linha: unknown): string | null {
  const passo = um(
    (linha as { cadence_step?: unknown } | null)?.cadence_step as
      { cadence?: unknown } | { cadence?: unknown }[] | null,
  );
  const regua = um(
    (passo as { cadence?: unknown } | null)?.cadence as
      { kind?: string } | { kind?: string }[] | null,
  );
  return regua?.kind ?? null;
}

// O recorte por tipo de regua e feito AQUI, em codigo, sobre o embed lido:
// filtro de embed encadeado no PostgREST falha calado, o que significaria
// confirmar a consulta errada.
const SELECT_DO_TOQUE =
  "id, sent_at, cadence_step:cadence_step_id ( cadence:cadence_id ( kind ) ), appointment:appointment_id ( id, status, starts_at, remarcacao_pedida_em )";

type ConsultaDaLinha = {
  id: string;
  status: string;
  starts_at: string;
  remarcacao_pedida_em: string | null;
};

type LinhaDeToque = {
  id: string;
  sent_at: string | null;
  cadence_step: unknown;
  appointment: ConsultaDaLinha | ConsultaDaLinha[] | null;
};

function paraToque(linha: LinhaDeToque): ToqueEnviado | null {
  if (!linha.sent_at) {
    return null;
  }
  const consulta = um(linha.appointment);
  return {
    runId: linha.id,
    kind: kindDoToque(linha),
    sentAt: linha.sent_at,
    consulta: consulta
      ? {
          id: consulta.id,
          status: consulta.status,
          startsAt: consulta.starts_at,
          remarcacaoPedidaEm: consulta.remarcacao_pedida_em ?? null,
        }
      : null,
  };
}

/** Um toque pelo id da run, so se for DESTE contato. */
async function toquePorRun(
  admin: SupabaseClient,
  entrada: EntradaDaResposta,
  filtro: { coluna: "id" | "message_id"; valor: string },
): Promise<{ toque: ToqueEnviado | null; erro: boolean }> {
  const { data, error } = await admin
    .from("cadence_run")
    .select(SELECT_DO_TOQUE)
    .eq("clinic_id", entrada.clinicId)
    .eq("contact_id", entrada.contactId)
    .eq(filtro.coluna, filtro.valor)
    .limit(1)
    .maybeSingle();
  if (error) {
    return { toque: null, erro: true };
  }
  return {
    toque: data ? paraToque(data as unknown as LinhaDeToque) : null,
    erro: false,
  };
}

/**
 * O que a mensagem citada e. Null quando a leitura falhou (duvida).
 *
 * Contrato com a regua (lib/jobs/regua.ts): cadence_run.message_id aponta
 * para a mensagem do MENU; no toque com anexo o menu vai numa segunda
 * mensagem, e a MIDIA carrega o job_id do passo (payload.cadence_run_id).
 * Quando o menu nao sai, a run aponta para a midia. Os tres caminhos caem
 * aqui. A mensagem da oferta de espera nasce de um job enviar_mensagem_ativa
 * criado junto com a oferta (mesmo created_at, ou payload.offer_id).
 */
async function resolverCitacao(
  admin: SupabaseClient,
  entrada: EntradaDaResposta,
  conversaIds: string[],
): Promise<Citacao | null> {
  const citadaWaId = entrada.quotedWaMessageId;
  if (!citadaWaId) {
    return { tipo: "nenhuma" };
  }
  const { data: citada, error } = await admin
    .from("message")
    .select("id, job_id, direction")
    .eq("clinic_id", entrada.clinicId)
    .eq("wa_message_id", citadaWaId)
    .in("conversation_id", conversaIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return null;
  }
  if (!citada || citada.direction !== "saida") {
    return { tipo: "outra" };
  }

  const direto = await toquePorRun(admin, entrada, {
    coluna: "message_id",
    valor: citada.id as string,
  });
  if (direto.erro) {
    return null;
  }
  if (direto.toque) {
    return { tipo: "toque", toque: direto.toque };
  }

  const jobId = citada.job_id as string | null;
  if (!jobId) {
    return { tipo: "outra" };
  }
  const { data: job, error: erroJob } = await admin
    .from("job_queue")
    .select("kind, payload, created_at")
    .eq("clinic_id", entrada.clinicId)
    .eq("id", jobId)
    .maybeSingle();
  if (erroJob) {
    return null;
  }
  const payload = (job?.payload ?? {}) as Record<string, unknown>;

  if (
    job?.kind === "executar_passo_de_regua" &&
    typeof payload.cadence_run_id === "string"
  ) {
    const daMidia = await toquePorRun(admin, entrada, {
      coluna: "id",
      valor: payload.cadence_run_id,
    });
    if (daMidia.erro) {
      return null;
    }
    return daMidia.toque
      ? { tipo: "toque", toque: daMidia.toque }
      : { tipo: "outra" };
  }

  if (job?.kind === "enviar_mensagem_ativa") {
    const consulta = admin
      .from("waitlist_offer")
      .select("id")
      .eq("clinic_id", entrada.clinicId)
      .contains("offered_to", [entrada.contactId]);
    const { data: oferta, error: erroOferta } = await (
      typeof payload.offer_id === "string"
        ? consulta.eq("id", payload.offer_id)
        : consulta.eq("created_at", job.created_at as string)
    )
      .limit(1)
      .maybeSingle();
    if (erroOferta) {
      return null;
    }
    if (oferta) {
      return { tipo: "oferta", offerId: oferta.id as string };
    }
  }
  return { tipo: "outra" };
}

/**
 * Eco para o paciente pela fila (nunca envio direto no webhook): o worker
 * reconfere consentimento, respeita o espacamento anti-ban e grava o custo.
 */
async function responder(
  admin: SupabaseClient,
  entrada: EntradaDaResposta,
  body: string,
): Promise<void> {
  await admin.from("job_queue").insert({
    clinic_id: entrada.clinicId,
    kind: "enviar_mensagem_ativa",
    // resposta_ao_paciente: o eco responde a um toque do proprio paciente e
    // usa o espacamento curto do 1:1, nao o de massa (lib/jobs/worker.ts).
    payload: {
      contact_id: entrada.contactId,
      body,
      resposta_ao_paciente: true,
    },
  });
}

type OfertaDoContato = {
  id: string;
  status: string;
  expires_at: string;
  declined_by: string[];
  responded_by: string | null;
  created_at: string;
};

const SELECT_DA_OFERTA =
  "id, status, expires_at, declined_by, responded_by, created_at, updated_at";

/**
 * A oferta de espera mais recente que PERGUNTOU algo a este contato: aberta
 * (a pergunta esta de pe) ou encerrada ha pouco (o "SIM" atrasado merece a
 * recusa educada, nao o silencio de quem nunca foi perguntado).
 */
async function acharOfertaDoContato(
  admin: SupabaseClient,
  clinicId: string,
  contactId: string,
): Promise<{ oferta: OfertaDoContato | null; erro: boolean }> {
  const desde = new Date(Date.now() - REPOUSO_POS_OFERTA_MS).toISOString();
  // A janela do "respondeu tarde" e medida do ENCERRAMENTO (updated_at, que
  // o fechamento carimba), nao da criacao: com janela de resposta longa, a
  // oferta encerrada ha pouco ainda merece a recusa educada.
  const { data, error } = await admin
    .from("waitlist_offer")
    .select(SELECT_DA_OFERTA)
    .eq("clinic_id", clinicId)
    .contains("offered_to", [contactId])
    .or(`status.eq.aberta,updated_at.gte.${desde}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { oferta: (data as OfertaDoContato | null) ?? null, erro: !!error };
}

async function buscarOferta(
  admin: SupabaseClient,
  clinicId: string,
  offerId: string,
): Promise<OfertaDoContato | null> {
  const { data } = await admin
    .from("waitlist_offer")
    .select(SELECT_DA_OFERTA)
    .eq("clinic_id", clinicId)
    .eq("id", offerId)
    .maybeSingle();
  return (data as OfertaDoContato | null) ?? null;
}

/**
 * Quando a mensagem da oferta SAIU para este contato. A oferta nasce com as
 * mensagens na fila; enquanto a dele nao sai, a oferta nao e pergunta para
 * ele e nao pode capturar o "sim" que responde outra coisa.
 *
 * O job da mensagem e achado por payload.offer_id (quando o payload trouxer)
 * ou pelo created_at igual ao da oferta (criar_oferta_de_espera insere os
 * dois na mesma transacao, e now() e o instante da transacao). A mensagem
 * enviada carrega o job_id (send.ts). Sem job nenhum achado, o instante da
 * criacao da oferta vale como aproximacao, que e o comportamento anterior.
 */
async function envioDaOferta(
  admin: SupabaseClient,
  clinicId: string,
  contactId: string,
  oferta: OfertaDoContato,
): Promise<{ enviadaEm: string | null; erro: boolean }> {
  const { data: jobs, error } = await admin
    .from("job_queue")
    .select("id, payload, created_at")
    .eq("clinic_id", clinicId)
    .eq("kind", "enviar_mensagem_ativa")
    .eq("payload->>contact_id", contactId)
    .gte("created_at", oferta.created_at)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    return { enviadaEm: null, erro: true };
  }
  const daOferta = (
    (jobs ?? []) as {
      id: string;
      payload: Record<string, unknown> | null;
      created_at: string;
    }[]
  ).filter(
    (job) =>
      job.payload?.offer_id === oferta.id ||
      new Date(job.created_at).getTime() ===
        new Date(oferta.created_at).getTime(),
  );
  if (daOferta.length === 0) {
    return { enviadaEm: oferta.created_at, erro: false };
  }
  const { data: mensagens, error: erroMensagem } = await admin
    .from("message")
    .select("created_at, delivery_status")
    .eq("clinic_id", clinicId)
    .in(
      "job_id",
      daOferta.map((job) => job.id),
    )
    .order("created_at", { ascending: true });
  if (erroMensagem) {
    return { enviadaEm: null, erro: true };
  }
  const saiu = (
    (mensagens ?? []) as { created_at: string; delivery_status: string | null }[]
  ).find((m) => m.delivery_status !== "falhou");
  return { enviadaEm: saiu?.created_at ?? null, erro: false };
}

/**
 * Junta os fatos que qualPerguntaFoiRespondida precisa. Null quando alguma
 * leitura falhou: sem saber se a recepcao falou depois, nao se interpreta.
 */
async function reunirFatos(
  admin: SupabaseClient,
  entrada: EntradaDaResposta,
): Promise<{ fatos: FatosDaResposta; oferta: OfertaDoContato | null } | null> {
  const agora = Date.now();
  const { data: conversas, error: erroConversas } = await admin
    .from("conversation")
    .select("id, status")
    .eq("clinic_id", entrada.clinicId)
    .eq("contact_id", entrada.contactId)
    .order("created_at", { ascending: false })
    .limit(CONVERSAS_CONSIDERADAS);
  if (erroConversas) {
    return null;
  }
  const linhasDeConversa = (conversas ?? []) as { id: string; status: string }[];
  const conversaIds = [
    ...new Set([entrada.conversationId, ...linhasDeConversa.map((c) => c.id)]),
  ];
  const atual = linhasDeConversa.find((c) => c.id === entrada.conversationId);

  const desde = new Date(agora - JANELA_DE_CONTEXTO_MS).toISOString();
  const [toques, humana, achada, citacao] = await Promise.all([
    admin
      .from("cadence_run")
      .select(SELECT_DO_TOQUE)
      .eq("clinic_id", entrada.clinicId)
      .eq("contact_id", entrada.contactId)
      .not("sent_at", "is", null)
      .gte("sent_at", desde)
      .order("sent_at", { ascending: false })
      .limit(TOQUES_CONSIDERADOS),
    // Gente da clinica falando com o paciente. Nota interna nao chega a ele,
    // entao nao e pergunta. Evento e eco sao do sistema.
    admin
      .from("message")
      .select("created_at")
      .eq("clinic_id", entrada.clinicId)
      .in("conversation_id", conversaIds)
      .eq("direction", "saida")
      .in("author", ["usuario", "ia"])
      .eq("is_internal_note", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    acharOfertaDoContato(admin, entrada.clinicId, entrada.contactId),
    resolverCitacao(admin, entrada, conversaIds),
  ]);
  if (toques.error || humana.error || achada.erro || citacao === null) {
    return null;
  }

  let oferta: OfertaPerguntada | null = null;
  if (achada.oferta) {
    const envio = await envioDaOferta(
      admin,
      entrada.clinicId,
      entrada.contactId,
      achada.oferta,
    );
    if (envio.erro) {
      return null;
    }
    oferta = { id: achada.oferta.id, enviadaEm: envio.enviadaEm };
  }

  return {
    fatos: {
      agora,
      conversaEmAtendimento: atual?.status === "em_atendimento",
      citacao,
      toques: ((toques.data ?? []) as unknown as LinhaDeToque[])
        .map(paraToque)
        .filter((toque): toque is ToqueEnviado => toque !== null),
      oferta,
      ultimaMensagemHumanaEm:
        (humana.data?.created_at as string | undefined) ?? null,
    },
    oferta: achada.oferta,
  };
}

async function tirarDoContadorDeAtendimento(
  admin: SupabaseClient,
  entrada: EntradaDaResposta,
): Promise<void> {
  await admin
    .from("conversation")
    .update({ awaiting_reply: false })
    .eq("clinic_id", entrada.clinicId)
    .eq("id", entrada.conversationId);
}

async function tratarRespostaDeOferta(
  admin: SupabaseClient,
  entrada: EntradaDaResposta,
  oferta: OfertaDoContato,
  intencao: "aceitar" | "recusar",
): Promise<void> {
  const aberta =
    oferta.status === "aberta" &&
    new Date(oferta.expires_at).getTime() > Date.now() &&
    !oferta.declined_by.includes(entrada.contactId);

  if (!aberta) {
    // O VENCEDOR repetindo "sim" (ou agradecendo com "ok") nunca pode ouvir
    // que perdeu: o horario E dele. Silencio, e a recepcao ve a mensagem.
    if (oferta.responded_by === entrada.contactId) {
      return;
    }
    // Respondeu tarde querendo a vaga: recusa educada. So chega aqui quando
    // a oferta e a pergunta mais recente (ou a citada): com um toque de
    // confirmacao depois dela, o "Confirmar" e do toque, nunca desta recusa.
    if (intencao === "aceitar") {
      await responder(admin, entrada, RESPOSTA_OFERTA_PERDIDA);
      await tirarDoContadorDeAtendimento(admin, entrada);
    }
    return;
  }

  if (intencao === "recusar") {
    const { data, error } = await admin.rpc("recusar_oferta_de_espera", {
      p_clinic_id: entrada.clinicId,
      p_offer_id: oferta.id,
      p_contact_id: entrada.contactId,
    });
    if (error) {
      // Erro transitorio NAO vira desfecho: silencio, conversa continua
      // esperando gente (awaiting_reply fica de pe) e a recepcao ve o "nao".
      return;
    }
    if ((data as { ok?: boolean } | null)?.ok === true) {
      await responder(admin, entrada, RESPOSTA_OFERTA_RECUSADA);
    }
  } else {
    const { data, error } = await admin.rpc("aceitar_oferta_de_espera", {
      p_clinic_id: entrada.clinicId,
      p_offer_id: oferta.id,
      p_contact_id: entrada.contactId,
      p_conversation_id: entrada.conversationId,
    });
    if (error) {
      // Erro transitorio da RPC nao pode virar "PERDIDA" falsa com a oferta
      // ainda aberta: silencio, a pessoa segue elegivel e a recepcao ve o
      // "sim" na conversa (awaiting_reply fica de pe).
      return;
    }
    const resultado = data as {
      ok?: boolean;
      starts_at?: string;
      profissional?: string | null;
      timezone?: string;
    } | null;
    if (resultado?.ok === true && resultado.starts_at) {
      const inicio = new TZDate(
        new Date(resultado.starts_at).getTime(),
        resultado.timezone ?? "America/Fortaleza",
      );
      await responder(
        admin,
        entrada,
        renderizarModelo(RESPOSTA_OFERTA_GANHOU, {
          data: format(inicio, "dd/MM/yyyy", { locale: ptBR }),
          hora: format(inicio, "HH:mm", { locale: ptBR }),
          profissional: resultado.profissional ?? null,
        }),
      );
    } else {
      // ja_tratado: ANTES da recusa educada, confere se o "tratado" foi o
      // PROPRIO contato vencendo numa resposta anterior (corrida do sim
      // duplo): vencedor nunca ouve que perdeu.
      const { data: atual } = await admin
        .from("waitlist_offer")
        .select("responded_by")
        .eq("clinic_id", entrada.clinicId)
        .eq("id", oferta.id)
        .maybeSingle();
      if (atual?.responded_by === entrada.contactId) {
        return;
      }
      // O segundo a responder: a recusa educada do aceite da 4.9.
      await responder(admin, entrada, RESPOSTA_OFERTA_PERDIDA);
    }
  }

  await tirarDoContadorDeAtendimento(admin, entrada);
}

const RPC_DA_INTENCAO = {
  confirmar: "confirmar_pelo_paciente",
  cancelar: "cancelar_pelo_paciente",
  remarcar: "pedir_remarcacao_pelo_paciente",
} as const;

const ECO_DA_INTENCAO = {
  confirmar: RESPOSTA_CONFIRMADA,
  cancelar: RESPOSTA_CANCELADA,
  remarcar: RESPOSTA_REMARCAR,
} as const;

export async function interceptarRespostaDePaciente(
  admin: SupabaseClient,
  entrada: EntradaDaResposta,
): Promise<void> {
  // Audio, imagem e documento nao viram decisao automatica: quem le e a
  // recepcao. Botao interativo chega como texto (o id ou o rotulo).
  if (entrada.contentType !== "texto" || !entrada.body) {
    return;
  }

  // A leitura pura vem ANTES das consultas: mensagem comum ("bom dia") sai
  // daqui sem custo nenhum, e e a maioria esmagadora do trafego.
  const intencao = interpretarResposta(entrada.body);
  // O vocabulario do menu do toque ("Confirmar", "Cancelar", "1", "3") e do
  // toque: nunca aceita nem recusa uma oferta da lista de espera.
  const intencaoDeOferta = ehRespostaDoMenuDeConfirmacao(entrada.body)
    ? "nao_reconhecida"
    : interpretarRespostaDeOferta(entrada.body);
  if (intencao === "nao_reconhecida" && intencaoDeOferta === "nao_reconhecida") {
    return;
  }

  const coletado = await reunirFatos(admin, entrada);
  if (!coletado) {
    return;
  }
  const pergunta = qualPerguntaFoiRespondida(
    coletado.fatos,
    intencao,
    intencaoDeOferta,
  );

  if (pergunta.alvo === "nenhum") {
    // A conversa ja esta esperando a recepcao (a ingestao marcou), e e ela
    // quem le e decide.
    return;
  }

  if (pergunta.alvo === "oferta") {
    if (intencaoDeOferta === "nao_reconhecida") {
      return;
    }
    const oferta =
      coletado.oferta?.id === pergunta.offerId
        ? coletado.oferta
        : await buscarOferta(admin, entrada.clinicId, pergunta.offerId);
    if (oferta) {
      await tratarRespostaDeOferta(admin, entrada, oferta, intencaoDeOferta);
    }
    return;
  }

  const { data, error } = await admin.rpc(RPC_DA_INTENCAO[pergunta.intencao], {
    p_clinic_id: entrada.clinicId,
    p_appointment_id: pergunta.appointmentId,
    p_contact_id: entrada.contactId,
    p_conversation_id: entrada.conversationId,
  });
  if (error) {
    return;
  }
  // 'ja_tratado': alguem (ou a propria pessoa, duas vezes) chegou antes. Sem
  // eco, para o paciente nao receber dois agradecimentos pela mesma consulta.
  const resultado = data as {
    ok?: boolean;
    starts_at?: string;
    timezone?: string;
  } | null;
  if (resultado?.ok !== true) {
    return;
  }

  // O eco diz QUAL consulta: com duas no mesmo dia, "sua consulta foi
  // cancelada" nao conta ao paciente se o sistema entendeu a certa.
  const inicio = new TZDate(
    new Date(resultado.starts_at ?? pergunta.startsAt).getTime(),
    resultado.timezone ?? "America/Fortaleza",
  );
  await responder(
    admin,
    entrada,
    renderizarModelo(ECO_DA_INTENCAO[pergunta.intencao], {
      data: format(inicio, "dd/MM", { locale: ptBR }),
      hora: format(inicio, "HH:mm", { locale: ptBR }),
    }),
  );

  // Remarcar termina em "nossa recepcao vai falar com voce": alguem TEM de
  // agir, e a RPC deixou a conversa esperando a recepcao.
  if (pergunta.intencao === "remarcar") {
    return;
  }

  // O sistema resolveu sozinho: mudou o status da consulta e respondeu ao
  // paciente. Ninguem da clinica precisa fazer nada, entao a conversa sai do
  // contador de Atendimento. Sem isto, uma manha em que 30 pacientes tocam
  // "Confirmar" mostra badge 31 e enterra a unica conversa que precisa de
  // gente.
  await tirarDoContadorDeAtendimento(admin, entrada);

  // O cancelamento libera um horario, e a reoferta da lista de espera parte
  // SOZINHA: o gatilho oferecer_ao_cancelar (banco) enfileira o job quando o
  // status vira cancelado, cobrindo este caminho e todos os outros.
}
