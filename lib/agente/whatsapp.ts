import type { SupabaseClient } from "@supabase/supabase-js";

import type { MotivoDoEventoDaIa } from "@/lib/domain/agente/config";
import type {
  DecisaoDoFiltro,
  DecisaoParaRetomar,
} from "@/lib/domain/conformidade/filtro";
import {
  versaoDasRegras,
  versaoDoPortao,
} from "@/lib/domain/conformidade/filtro";
import { correrComPrazo } from "@/lib/domain/conformidade/prazo";
import { VERSAO_DA_POLITICA_DO_CLASSIFICADOR } from "@/lib/integrations/llm/classificador-de-entrada";
import { VERSAO_DA_POLITICA } from "@/lib/integrations/llm/verificador";
import { ErroComCodigoDeJob } from "@/lib/jobs/erro-de-job";
import { log } from "@/lib/log";

import type { DesfechoDoTurno, PassoDoTurno } from "./laco";
import type { UsoDoModelo } from "./uso";

// As travas e a gravacao do turno da IA no WhatsApp (E3), pela service role
// e sempre com clinic_id explicito. O executor (lib/jobs/responder-com-ia.ts)
// usa isto; nada aqui chama modelo nem provedor.
//
//  - Janela da conversa (ia_janela_da_conversa): a IA so fala com a conversa
//    enquanto o contato e o telefone sao os de quando ela entrou na IA, e so
//    com job criado depois disso (contrato 1.3).
//  - ia_atende_no_whatsapp (com o teto de 24 h) e ia_pode_falar_com (sem o
//    teto): RPCs com prazo de 3 s, falha FECHADA (erro, prazo ou resposta
//    que nao e booleana = nao pode).
//  - ai_turno: o estado do turno por job (retomada sem chamar o modelo).
//  - ai_decision_log: a decisao, gravada ANTES de qualquer envio, NUNCA com
//    blocked_draft. O rascunho bloqueado vai para ai_rascunho_bloqueado.
//
// Log so com ids e codigos.

/** Prazo das travas do banco (o mesmo do simulador). */
export const PRAZO_DA_TRAVA_MS = 3_000;

// ---------------------------------------------------------------------------
// Janela da conversa
// ---------------------------------------------------------------------------

/**
 * Como a janela abriu (ia_janela_da_conversa.aberta_por): 'ingestao'
 * (conversa nova), 'devolver' (o Devolver da equipe) ou 'horario' (onda 2:
 * a conversa que esperou o horario do assistente e voltou para ele). Valor
 * que o codigo nao conhece vira 'desconhecida' (onda 2, contrato 4.1). So a
 * 'ingestao' le a conversa inteira; todas as outras, 'desconhecida'
 * inclusive, leem so a partir do `desde` (falha fechada: a IA nunca le o
 * que veio antes de a conversa entrar nela).
 */
export type AberturaDaJanela =
  "ingestao" | "devolver" | "horario" | "desconhecida";

/** aberta_por do banco para AberturaDaJanela; desconhecido nunca e 'ingestao'. */
export function aberturaDaJanela(valor: unknown): AberturaDaJanela {
  return valor === "ingestao" || valor === "devolver" || valor === "horario"
    ? valor
    : "desconhecida";
}

export type JanelaDaConversa = {
  conversationId: string;
  clinicId: string;
  contactId: string;
  phoneKey: string;
  desde: string;
  abertaPor: AberturaDaJanela;
};

type LinhaDaJanela = {
  conversation_id: string;
  clinic_id: string;
  contact_id: string;
  phone_key: string;
  desde: string;
  aberta_por: string;
};

/** A janela da conversa, ou null. Lanca ErroComCodigoDeJob na leitura que falha. */
export async function lerJanela(
  admin: SupabaseClient,
  clinicId: string,
  conversationId: string,
): Promise<JanelaDaConversa | null> {
  const { data, error } = await admin
    .from("ia_janela_da_conversa")
    .select(
      "conversation_id, clinic_id, contact_id, phone_key, desde, aberta_por",
    )
    .eq("clinic_id", clinicId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  const linha = data as LinhaDaJanela | null;
  if (!linha) {
    return null;
  }
  return {
    conversationId: linha.conversation_id,
    clinicId: linha.clinic_id,
    contactId: linha.contact_id,
    phoneKey: linha.phone_key,
    desde: linha.desde,
    abertaPor: aberturaDaJanela(linha.aberta_por),
  };
}

function instante(valor: string): number {
  const ms = new Date(valor).getTime();
  return Number.isNaN(ms) ? Number.NaN : ms;
}

/**
 * "A janela confere" (o mesmo criterio do banco): existe, o contato da
 * conversa e o da janela, o telefone ATUAL do contato e o da janela e, com
 * job, ele foi criado depois de a janela abrir. Data ilegivel: nao confere.
 */
export function janelaConfere(
  janela: JanelaDaConversa | null,
  atual: { contactId: string; phoneKey: string | null; jobCriadoEm?: string },
): boolean {
  if (janela === null) {
    return false;
  }
  if (janela.contactId !== atual.contactId) {
    return false;
  }
  if (atual.phoneKey === null || janela.phoneKey !== atual.phoneKey) {
    return false;
  }
  if (atual.jobCriadoEm !== undefined) {
    const criado = instante(atual.jobCriadoEm);
    const desde = instante(janela.desde);
    if (Number.isNaN(criado) || Number.isNaN(desde) || criado < desde) {
      return false;
    }
  }
  return true;
}

/**
 * D-A (revisao do E3): o job nasceu ANTES da janela atual (alguem assumiu e
 * devolveu a conversa depois dele). Job assim esta MORTO: nao envia, nao
 * passa a conversa, nao grava evento, nao religa "Aguardando voce" e nao
 * cancela os jobs da sessao nova. So conclui. Data ilegivel ou sem janela:
 * nao e "anterior" (as outras travas decidem).
 */
export function jobAnteriorAJanela(
  janela: JanelaDaConversa | null,
  jobCriadoEm: string | null | undefined,
): boolean {
  if (janela === null || typeof jobCriadoEm !== "string") {
    return false;
  }
  const criado = instante(jobCriadoEm);
  const desde = instante(janela.desde);
  return !Number.isNaN(criado) && !Number.isNaN(desde) && criado < desde;
}

// ---------------------------------------------------------------------------
// Travas do banco (service role)
// ---------------------------------------------------------------------------

type EntradaDaTrava = {
  clinicId: string;
  whatsappAccountId: string;
  telefone: string;
};

async function travaBooleana(
  admin: SupabaseClient,
  funcao: "ia_atende_no_whatsapp" | "ia_pode_falar_com",
  e: EntradaDaTrava,
): Promise<boolean> {
  const corrida = await correrComPrazo(async () => {
    const { data, error } = await admin.rpc(funcao, {
      p_clinic_id: e.clinicId,
      p_whatsapp_account_id: e.whatsappAccountId,
      p_telefone: e.telefone,
    });
    return !error && data === true;
  }, PRAZO_DA_TRAVA_MS);
  return corrida.tipo === "resultado" && corrida.valor;
}

/** ia_atende_no_whatsapp (com o teto de 24 h). Falha fechada. */
export async function iaAtendeNoWhatsapp(
  admin: SupabaseClient,
  e: EntradaDaTrava,
): Promise<boolean> {
  return travaBooleana(admin, "ia_atende_no_whatsapp", e);
}

/** ia_pode_falar_com (sem o teto: a reserva decide o teto). Falha fechada. */
export async function iaPodeFalarCom(
  admin: SupabaseClient,
  e: EntradaDaTrava,
): Promise<boolean> {
  return travaBooleana(admin, "ia_pode_falar_com", e);
}

/**
 * consentimento_vigente do contato no WhatsApp (o mesmo que o envio
 * confere). Lanca ErroComCodigoDeJob("leitura_falhou") quando a leitura
 * falha ou passa do prazo: sem resposta nao e revogacao (como em send.ts),
 * o job tenta de novo.
 */
export async function consentimentoVigente(
  admin: SupabaseClient,
  e: { clinicId: string; contactId: string },
): Promise<boolean> {
  const corrida = await correrComPrazo(async () => {
    const { data, error } = await admin.rpc("consentimento_vigente", {
      p_clinic_id: e.clinicId,
      p_contact_id: e.contactId,
      p_channel: "whatsapp",
    });
    if (error) {
      throw new Error("consentimento_nao_lido");
    }
    return data === true;
  }, PRAZO_DA_TRAVA_MS);
  if (corrida.tipo !== "resultado") {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  return corrida.valor;
}

/** confirmar_posse_job: renova o lease e confirma o dono. Falha fechada. */
export async function confirmarPosse(
  admin: SupabaseClient,
  jobId: string,
  workerId: string,
): Promise<boolean> {
  const corrida = await correrComPrazo(async () => {
    const { data, error } = await admin.rpc("confirmar_posse_job", {
      p_id: jobId,
      p_worker: workerId,
    });
    return !error && data === true;
  }, PRAZO_DA_TRAVA_MS);
  return corrida.tipo === "resultado" && corrida.valor;
}

/**
 * A trava entre rodadas do modelo (conferirTrava do laco): o job ainda e
 * deste executor, a conversa continua na IA sem responsavel e com o mesmo
 * contato, a janela confere com o telefone atual e a liberacao vale (sem o
 * teto). Qualquer erro: false.
 */
export async function conferirTravaDoWhatsapp(
  admin: SupabaseClient,
  e: {
    clinicId: string;
    conversationId: string;
    contactId: string;
    whatsappAccountId: string;
    jobId: string;
    workerId: string;
    jobCriadoEm: string;
  },
): Promise<boolean> {
  try {
    if (!(await confirmarPosse(admin, e.jobId, e.workerId))) {
      return false;
    }
    const [conversa, contato, janela] = await Promise.all([
      admin
        .from("conversation")
        .select("status, assignee_user_id, contact_id, whatsapp_account_id")
        .eq("clinic_id", e.clinicId)
        .eq("id", e.conversationId)
        .maybeSingle(),
      admin
        .from("contact")
        .select("phone_key")
        .eq("clinic_id", e.clinicId)
        .eq("id", e.contactId)
        .maybeSingle(),
      lerJanela(admin, e.clinicId, e.conversationId),
    ]);
    if (conversa.error || contato.error || !conversa.data || !contato.data) {
      return false;
    }
    const linha = conversa.data as {
      status: string;
      assignee_user_id: string | null;
      contact_id: string;
      whatsapp_account_id: string;
    };
    const phoneKey = (contato.data as { phone_key: string | null }).phone_key;
    if (
      linha.status !== "ia_atendendo" ||
      linha.assignee_user_id !== null ||
      linha.contact_id !== e.contactId ||
      linha.whatsapp_account_id !== e.whatsappAccountId ||
      !janelaConfere(janela, {
        contactId: e.contactId,
        phoneKey,
        jobCriadoEm: e.jobCriadoEm,
      }) ||
      phoneKey === null
    ) {
      return false;
    }
    return await iaPodeFalarCom(admin, {
      clinicId: e.clinicId,
      whatsappAccountId: e.whatsappAccountId,
      telefone: phoneKey,
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Conversa: passar para a equipe e eventos (RPCs do E3)
// ---------------------------------------------------------------------------

export type ResultadoDaPassagem =
  "passou" | "ja_fora_da_ia" | "job_antigo" | "sem_posse" | "erro";

/**
 * passar_conversa_da_ia_para_equipe: com a posse do job, a conversa vai para
 * "Aguardando voce" com o evento do motivo e o pendente cancelado. A frase
 * fixa so sai quando devolve "passou". "job_antigo" (D-A): o job e anterior
 * a janela atual e o banco nao mexeu em nada.
 */
export async function passarParaAEquipe(
  admin: SupabaseClient,
  e: {
    clinicId: string;
    jobId: string;
    workerId: string;
    motivo: MotivoDoEventoDaIa;
  },
): Promise<ResultadoDaPassagem> {
  try {
    const { data, error } = await admin.rpc(
      "passar_conversa_da_ia_para_equipe",
      { p_job_id: e.jobId, p_worker: e.workerId, p_motivo: e.motivo },
    );
    if (error) {
      log.warn("ia_passagem_falhou", {
        clinic_id: e.clinicId,
        job_id: e.jobId,
        status: e.motivo,
        error_code: (error as { code?: string }).code ?? null,
      });
      return "erro";
    }
    const resposta = data as { passou?: unknown; codigo?: unknown } | null;
    if (resposta?.passou === true) {
      return "passou";
    }
    if (resposta?.codigo === "sem_posse") {
      return "sem_posse";
    }
    return resposta?.codigo === "job_antigo" ? "job_antigo" : "ja_fora_da_ia";
  } catch {
    log.warn("ia_passagem_falhou", {
      clinic_id: e.clinicId,
      job_id: e.jobId,
      status: e.motivo,
      error_code: "excecao",
    });
    return "erro";
  }
}

/** gravar_evento_da_ia: so o evento, sem mexer no status. Nunca lanca. */
export async function gravarEventoDaIa(
  admin: SupabaseClient,
  e: {
    clinicId: string;
    jobId: string;
    workerId: string;
    motivo: MotivoDoEventoDaIa;
  },
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("gravar_evento_da_ia", {
      p_job_id: e.jobId,
      p_worker: e.workerId,
      p_motivo: e.motivo,
    });
    if (error) {
      log.warn("ia_evento_nao_gravado", {
        clinic_id: e.clinicId,
        job_id: e.jobId,
        status: e.motivo,
        error_code: (error as { code?: string }).code ?? null,
      });
      return false;
    }
    return data === true;
  } catch {
    return false;
  }
}

/**
 * tirar_conversa_da_ia_pelo_servidor sem job (sem p_job_id). Sem frase.
 * Nunca lanca. O fechamento do job que desistiu (lib/jobs/worker.ts) chama
 * a RPC direto com p_job_id (D-A, contrato 10.3), nao por aqui.
 */
export async function tirarConversaPeloServidor(
  admin: SupabaseClient,
  e: {
    clinicId: string;
    conversationId: string;
    motivo: "falha_tecnica" | "nao_individual";
  },
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc(
      "tirar_conversa_da_ia_pelo_servidor",
      {
        p_clinic_id: e.clinicId,
        p_conversation_id: e.conversationId,
        p_motivo: e.motivo,
      },
    );
    if (error) {
      log.warn("ia_conversa_nao_tirada", {
        clinic_id: e.clinicId,
        conversation_id: e.conversationId,
        status: e.motivo,
        error_code: (error as { code?: string }).code ?? null,
      });
      return false;
    }
    return data === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// ai_turno
// ---------------------------------------------------------------------------

export type EstadoDoTurno =
  "reservado" | "decidido" | "passou_para_equipe" | "enviado" | "sem_envio";

export type SaidaDoTurno = "resposta" | "frase" | "nenhuma";

export type TurnoDaIa = {
  jobId: string;
  clinicId: string;
  conversationId: string;
  estado: EstadoDoTurno;
  reservaId: string | null;
  reservasPerdidas: string[];
  saida: SaidaDoTurno | null;
  texto: string | null;
  textoSha256: string | null;
  decisionId: string | null;
  mensagensLidas: string[];
};

type LinhaDoTurno = {
  job_id: string;
  clinic_id: string;
  conversation_id: string;
  estado: string;
  reserva_id: string | null;
  reservas_perdidas: string[] | null;
  saida: string | null;
  texto: string | null;
  texto_sha256: string | null;
  decision_id: string | null;
  mensagens_lidas: string[] | null;
};

const ESTADOS: ReadonlySet<string> = new Set([
  "reservado",
  "decidido",
  "passou_para_equipe",
  "enviado",
  "sem_envio",
]);

/** O turno do job, ou null. Lanca ErroComCodigoDeJob na leitura que falha. */
export async function lerTurno(
  admin: SupabaseClient,
  clinicId: string,
  jobId: string,
): Promise<TurnoDaIa | null> {
  const { data, error } = await admin
    .from("ai_turno")
    .select(
      "job_id, clinic_id, conversation_id, estado, reserva_id, reservas_perdidas, saida, texto, texto_sha256, decision_id, mensagens_lidas",
    )
    .eq("clinic_id", clinicId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  const linha = data as LinhaDoTurno | null;
  if (!linha || !ESTADOS.has(linha.estado)) {
    return null;
  }
  const saida =
    linha.saida === "resposta" ||
    linha.saida === "frase" ||
    linha.saida === "nenhuma"
      ? linha.saida
      : null;
  return {
    jobId: linha.job_id,
    clinicId: linha.clinic_id,
    conversationId: linha.conversation_id,
    estado: linha.estado as EstadoDoTurno,
    reservaId: linha.reserva_id,
    reservasPerdidas: linha.reservas_perdidas ?? [],
    saida,
    texto: linha.texto,
    textoSha256: linha.texto_sha256,
    decisionId: linha.decision_id,
    mensagensLidas: linha.mensagens_lidas ?? [],
  };
}

/** Grava (ou regrava) o turno inteiro. Lanca ErroComCodigoDeJob se falhar. */
export async function salvarTurno(
  admin: SupabaseClient,
  turno: TurnoDaIa,
): Promise<void> {
  const { error } = await admin.from("ai_turno").upsert(
    {
      job_id: turno.jobId,
      clinic_id: turno.clinicId,
      conversation_id: turno.conversationId,
      estado: turno.estado,
      reserva_id: turno.reservaId,
      reservas_perdidas: turno.reservasPerdidas,
      saida: turno.saida,
      // O texto so vive enquanto o envio esta pendente (retencao, contrato 1.1).
      texto:
        turno.estado === "enviado" || turno.estado === "sem_envio"
          ? null
          : turno.texto,
      texto_sha256: turno.textoSha256,
      decision_id: turno.decisionId,
      mensagens_lidas: turno.mensagensLidas,
    },
    { onConflict: "job_id" },
  );
  if (error) {
    throw new ErroComCodigoDeJob("turno_nao_gravado");
  }
}

/**
 * Fecha o turno sem envio pendente ('enviado' ou 'sem_envio'): o texto sai
 * da linha. Nunca lanca (o envio ja aconteceu ou nao vai acontecer; a
 * varredura apaga o texto que sobrar em 1 hora).
 */
export async function fecharTurno(
  admin: SupabaseClient,
  e: {
    clinicId: string;
    jobId: string;
    estado: "enviado" | "sem_envio" | "passou_para_equipe";
  },
): Promise<void> {
  try {
    const { error } = await admin
      .from("ai_turno")
      .update(
        e.estado === "passou_para_equipe"
          ? { estado: e.estado }
          : { estado: e.estado, texto: null },
      )
      .eq("clinic_id", e.clinicId)
      .eq("job_id", e.jobId);
    if (error) {
      log.warn("ia_turno_nao_fechado", {
        clinic_id: e.clinicId,
        job_id: e.jobId,
        status: e.estado,
        error_code: (error as { code?: string }).code ?? null,
      });
    }
  } catch {
    log.warn("ia_turno_nao_fechado", {
      clinic_id: e.clinicId,
      job_id: e.jobId,
      status: e.estado,
      error_code: "excecao",
    });
  }
}

/**
 * O turno 'decidido' com a resposta recusada pelo gatilho de message
 * (ia_sem_aprovacao) passa a esperar a FRASE: o texto sai da linha e a
 * proxima tentativa (se a passagem falhar agora) passa e manda a frase em
 * vez de tentar a resposta de novo. Lanca ErroComCodigoDeJob se falhar.
 */
export async function trocarSaidaParaFrase(
  admin: SupabaseClient,
  e: { clinicId: string; jobId: string },
): Promise<void> {
  const { error } = await admin
    .from("ai_turno")
    .update({ saida: "frase", texto: null })
    .eq("clinic_id", e.clinicId)
    .eq("job_id", e.jobId)
    .eq("estado", "decidido");
  if (error) {
    throw new ErroComCodigoDeJob("turno_nao_gravado");
  }
}

// ---------------------------------------------------------------------------
// ai_decision_log e ai_rascunho_bloqueado
// ---------------------------------------------------------------------------

/**
 * A decisao do job para retomar o envio (retomarTextoAprovado): lida de
 * ai_decision_log pelo id, pela clinica e pelo JOB, nunca de ai_turno.
 * null: nao existe (ou e de outro job). Lanca ErroComCodigoDeJob na leitura
 * que falha.
 */
export async function lerDecisaoParaRetomar(
  admin: SupabaseClient,
  e: { clinicId: string; decisionId: string; jobId: string },
): Promise<DecisaoParaRetomar | null> {
  const { data, error } = await admin
    .from("ai_decision_log")
    .select("id, job_id, desfecho, aprovado, compliance_blocked, texto_sha256")
    .eq("clinic_id", e.clinicId)
    .eq("id", e.decisionId)
    .eq("job_id", e.jobId)
    .maybeSingle();
  if (error) {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  const linha = data as Record<string, unknown> | null;
  if (linha === null) {
    return null;
  }
  return {
    job_id: linha.job_id,
    desfecho: linha.desfecho,
    aprovado: linha.aprovado,
    compliance_blocked: linha.compliance_blocked,
    texto_sha256: linha.texto_sha256,
  };
}

export type DecisaoParaGravar = {
  clinicId: string;
  conversationId: string;
  jobId: string;
  desfecho: DesfechoDoTurno;
  /** filtro.sha256 (so respondeu). */
  textoSha256: string | null;
  filtro: DecisaoDoFiltro | null;
  trilha: readonly PassoDoTurno[];
  uso: readonly UsoDoModelo[];
  versaoDoPrompt: string | null;
  configVersion: number | null;
  latenciaMs: number | null;
  /**
   * As ferramentas que rodaram no turno (ResultadoDoTurno.ferramentasUsadas).
   * Ausente: so a trilha diz (decisao sem turno, ou de antes do E4).
   */
  ferramentasUsadas?: readonly string[];
};

/**
 * O tool_used de ai_decision_log (texto livre, uma ferramenta): a que mais
 * pesa no turno. Efeito na agenda primeiro (marcou, confirmou presenca,
 * reservou), depois a passagem pelo agente, depois as frases fixas (onda 2:
 * fora do assunto e "você é um robô?"; a contagem do fora do assunto na
 * janela le este campo), depois a consulta (horario, preco e, desde a AG2,
 * as do Cadastro: quem atende, o que o paciente precisa e as unidades). Sem
 * a lista, o preco sai da trilha, como antes do E4. AG4: cancelar_consulta
 * logo depois de agendar (efeito), pedir_cancelamento depois dos dados (so
 * arma a pergunta), e a busca da remarcacao e a lista das consultas com as
 * consultas.
 */
const PESO_DA_FERRAMENTA: readonly string[] = [
  "agendar",
  // AG4: cancelar grava (a consulta cancelada); o pedido arma a pergunta.
  "cancelar_consulta",
  "confirmar_presenca",
  "reservar_horario",
  // AG3: os dados para marcar gravam (dados_informados_na_marcacao).
  "registrar_dados_do_paciente",
  "pedir_cancelamento",
  "escalar_humano",
  "fora_do_assunto",
  "sou_assistente_virtual",
  // AG4: a busca da remarcacao e a lista das consultas da pessoa.
  "buscar_horario_para_remarcar",
  "buscar_horario",
  "consultar_minhas_consultas",
  // AG3: so sinais do cadastro da pessoa.
  "consultar_cadastro_do_contato",
  "buscar_procedimento",
  "buscar_profissionais",
  "consultar_requisitos",
  "consultar_unidades",
];

export function ferramentaDoTurno(d: {
  desfecho: DesfechoDoTurno;
  trilha: readonly PassoDoTurno[];
  ferramentasUsadas?: readonly string[];
}): string | null {
  const usadas = new Set(d.ferramentasUsadas ?? []);
  if (d.desfecho.tipo === "escalou" && d.desfecho.origem === "agente") {
    usadas.add("escalar_humano");
  }
  if (d.trilha.some((passo) => passo.tipo === "preco")) {
    usadas.add("buscar_procedimento");
  }
  return PESO_DA_FERRAMENTA.find((nome) => usadas.has(nome)) ?? null;
}

/**
 * O que vai em ai_decision_log.versao_filtro (revisao de producao de
 * 19/10/2026, Q12): a versao de cada camada da conformidade do turno, nesta
 * ordem e separadas por espaco: as regras de saida (regras-), o portao de
 * entrada (portao-), o texto do classificador (classificador-) e o do
 * verificador (verificador-). Cada uma muda sozinha quando a sua fonte muda,
 * entao da para separar as decisoes de antes e de depois de um ajuste. Sem
 * coluna nova: versao_filtro e texto livre. A versao do texto do agente
 * (com as frases do bloco <atendimento>) continua em versao_prompt.
 */
export function versaoDoFiltroDoTurno(regras: string = versaoDasRegras()): string {
  return [
    regras,
    versaoDoPortao(),
    VERSAO_DA_POLITICA_DO_CLASSIFICADOR,
    VERSAO_DA_POLITICA,
  ].join(" ");
}

/** Falhas que nao sao tecnicas: nao viram falha_tecnica (contrato 3.6). */
const FALHAS_SEM_ESCALONAMENTO: ReadonlySet<string> = new Set([
  "liberacao_suspensa",
  "sem_mensagem",
]);

/**
 * A linha de ai_decision_log do turno (mapa do contrato 3.6). PURA. Nunca
 * blocked_draft: o rascunho bloqueado vai para ai_rascunho_bloqueado.
 */
export function linhaDaDecisao(d: DecisaoParaGravar): Record<string, unknown> {
  const somar = (campo: "tokensEntrada" | "tokensSaida" | "tokensCacheLidos") =>
    d.uso.reduce((total, item) => {
      const valor = item.uso[campo];
      return (
        total + (Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 0)
      );
    }, 0);
  const agentes = d.uso.filter((item) => item.papel === "agente");
  const agenteModelo = agentes[agentes.length - 1]?.modelo ?? null;
  const desfecho = d.desfecho;
  const toolUsed = ferramentaDoTurno(d);

  const comum: Record<string, unknown> = {
    clinic_id: d.clinicId,
    conversation_id: d.conversationId,
    job_id: d.jobId,
    desfecho: desfecho.tipo,
    aprovado: false,
    compliance_blocked: false,
    texto_sha256: null,
    escalation_reason: null,
    motivo_da_falha: null,
    gatilho_entrada: null,
    compliance_rule: null,
    camada: null,
    config_version: d.configVersion,
    versao_prompt: d.versaoDoPrompt,
    versao_filtro: versaoDoFiltroDoTurno(
      d.filtro?.versaoDasRegras ?? versaoDasRegras(),
    ),
    agente_modelo: agenteModelo,
    verificador_modelo: d.filtro?.verificador?.modelo ?? null,
    tokens_entrada: somar("tokensEntrada"),
    tokens_saida: somar("tokensSaida"),
    tokens_cache: somar("tokensCacheLidos"),
    latency_ms:
      d.latenciaMs !== null && Number.isFinite(d.latenciaMs)
        ? Math.max(0, Math.round(d.latenciaMs))
        : null,
    tool_used: toolUsed,
    context_read: {
      trilha: d.trilha.map((p) => ({ tipo: p.tipo, texto: p.texto })),
    },
  };
  switch (desfecho.tipo) {
    case "respondeu":
      return { ...comum, aprovado: true, texto_sha256: d.textoSha256 };
    case "escalou":
      return {
        ...comum,
        escalation_reason: desfecho.motivo,
        gatilho_entrada: desfecho.gatilho,
      };
    case "bloqueou":
      return {
        ...comum,
        compliance_blocked: true,
        compliance_rule: desfecho.categoria,
        camada: desfecho.camada,
        escalation_reason: "conformidade",
        motivo_da_falha: desfecho.motivoDaFalha,
      };
    case "falhou":
      return {
        ...comum,
        escalation_reason: FALHAS_SEM_ESCALONAMENTO.has(desfecho.motivo)
          ? null
          : "falha_tecnica",
        motivo_da_falha: desfecho.motivo,
      };
  }
}

/** Grava a decisao e devolve o id. Lanca ErroComCodigoDeJob se falhar. */
export async function gravarDecisao(
  admin: SupabaseClient,
  d: DecisaoParaGravar,
): Promise<string> {
  const { data, error } = await admin
    .from("ai_decision_log")
    .insert(linhaDaDecisao(d))
    .select("id")
    .single();
  const id = (data as { id?: unknown } | null)?.id;
  if (error || typeof id !== "string") {
    log.warn("ia_decisao_nao_gravada", {
      clinic_id: d.clinicId,
      conversation_id: d.conversationId,
      job_id: d.jobId,
      error_code: (error as { code?: string } | null)?.code ?? null,
    });
    throw new ErroComCodigoDeJob("decisao_nao_gravada");
  }
  return id;
}

/**
 * AG3 (item 8): a nota interna da passagem, pelo MESMO caminho da nota da
 * automacao (motor_automacoes, acao nota_interna): message com
 * is_internal_note, autor 'sistema', saida, texto, sem cobranca e SEM job_id
 * (a guarda de message so deixa o job da IA gravar a resposta aprovada ou a
 * frase fixa). O texto vem so do estado e do Cadastro (notaDaPassagem), nunca
 * do modelo nem do paciente. Nunca lanca: e ajuda para a equipe, a passagem
 * ja aconteceu.
 */
export async function anotarPassagemParaAEquipe(
  admin: SupabaseClient,
  e: { clinicId: string; conversationId: string; jobId: string; texto: string },
): Promise<boolean> {
  if (e.texto.trim() === "") {
    return false;
  }
  try {
    const { error } = await admin.from("message").insert({
      clinic_id: e.clinicId,
      conversation_id: e.conversationId,
      direction: "saida",
      author: "sistema",
      content_type: "texto",
      body: e.texto,
      is_internal_note: true,
      billable: false,
      cost_cents: 0,
    });
    if (error) {
      log.warn("ia_nota_da_passagem_nao_gravada", {
        clinic_id: e.clinicId,
        conversation_id: e.conversationId,
        job_id: e.jobId,
        error_code: (error as { code?: string }).code ?? null,
      });
      return false;
    }
    return true;
  } catch {
    log.warn("ia_nota_da_passagem_nao_gravada", {
      clinic_id: e.clinicId,
      conversation_id: e.conversationId,
      job_id: e.jobId,
      error_code: "excecao",
    });
    return false;
  }
}

/** Liga a decisao a mensagem enviada. Nunca lanca. */
export async function ligarDecisaoAMensagem(
  admin: SupabaseClient,
  e: { clinicId: string; decisionId: string; messageId: string },
): Promise<void> {
  try {
    await admin
      .from("ai_decision_log")
      .update({ message_id: e.messageId })
      .eq("clinic_id", e.clinicId)
      .eq("id", e.decisionId);
  } catch {
    // A decisao continua ligada ao job (job_id); o message_id e conveniencia.
  }
}

/** Teto da coluna ai_rascunho_bloqueado.texto. */
const TAMANHO_MAXIMO_DO_RASCUNHO = 4_000;

/**
 * O rascunho que a conformidade barrou, no lugar restrito (so o super admin
 * le, por ler_rascunho_bloqueado). Nunca lanca: e auditoria, o turno segue.
 */
export async function gravarRascunhoBloqueado(
  admin: SupabaseClient,
  e: {
    clinicId: string;
    decisionId: string;
    conversationId: string;
    jobId: string;
    texto: string;
  },
): Promise<void> {
  const texto = Array.from(e.texto)
    .slice(0, TAMANHO_MAXIMO_DO_RASCUNHO)
    .join("");
  if (texto.trim() === "") {
    return;
  }
  try {
    const { error } = await admin.from("ai_rascunho_bloqueado").insert({
      clinic_id: e.clinicId,
      decision_id: e.decisionId,
      conversation_id: e.conversationId,
      job_id: e.jobId,
      texto,
    });
    if (error) {
      log.warn("ia_rascunho_nao_gravado", {
        clinic_id: e.clinicId,
        job_id: e.jobId,
        error_code: (error as { code?: string }).code ?? null,
      });
    }
  } catch {
    log.warn("ia_rascunho_nao_gravado", {
      clinic_id: e.clinicId,
      job_id: e.jobId,
      error_code: "excecao",
    });
  }
}

// ---------------------------------------------------------------------------
// Leituras do turno
// ---------------------------------------------------------------------------

/** A linha de message deste job (resposta ou frase), ou null. Lanca na falha. */
export async function lerMensagemDoJob(
  admin: SupabaseClient,
  clinicId: string,
  jobId: string,
): Promise<{
  id: string;
  author: string;
  deliveryStatus: string | null;
  errorCode: string | null;
} | null> {
  const { data, error } = await admin
    .from("message")
    .select("id, author, delivery_status, error_code")
    .eq("clinic_id", clinicId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  const linha = data as {
    id: string;
    author: string;
    delivery_status: string | null;
    error_code?: string | null;
  } | null;
  return linha
    ? {
        id: linha.id,
        author: linha.author,
        deliveryStatus: linha.delivery_status,
        errorCode: linha.error_code ?? null,
      }
    : null;
}

/** Recibos que provam que a mensagem saiu. */
export const RECIBOS_DE_ENVIADA: ReadonlySet<string> = new Set([
  "enviada",
  "entregue",
  "lida",
]);

/**
 * Quantas respostas da IA a conversa recebeu desde `desdeIso` (o teto por
 * conversa por hora). Lanca ErroComCodigoDeJob na leitura que falha.
 */
export async function respostasDaIaDesde(
  admin: SupabaseClient,
  e: { clinicId: string; conversationId: string; desdeIso: string },
): Promise<number> {
  const { count, error } = await admin
    .from("message")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", e.clinicId)
    .eq("conversation_id", e.conversationId)
    .eq("author", "ia")
    .gte("created_at", e.desdeIso);
  if (error || typeof count !== "number") {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  return count;
}

/**
 * Onda 2 (item 5, P5b): quantas vezes a IA ja respondeu fora do assunto na
 * janela da conversa: as decisoes 'respondeu' com tool_used fora_do_assunto
 * da conversa desde o `desde` da janela (a insistencia so conta dentro da
 * janela: depois de Assumir e Devolver, conta de novo). Lanca
 * ErroComCodigoDeJob na leitura que falha (o job tenta de novo).
 */
export async function foraDoAssuntoNaJanela(
  admin: SupabaseClient,
  e: { clinicId: string; conversationId: string; desdeIso: string },
): Promise<number> {
  const { count, error } = await admin
    .from("ai_decision_log")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", e.clinicId)
    .eq("conversation_id", e.conversationId)
    .eq("desfecho", "respondeu")
    .eq("tool_used", "fora_do_assunto")
    .gte("created_at", e.desdeIso);
  if (error || typeof count !== "number") {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  return count;
}

/**
 * ia_liberacao.teto_respostas_por_conversa_hora da clinica. Sem linha: a
 * liberacao sumiu (o executor ja confere a trava antes). Lanca na falha.
 */
export async function tetoDeRespostasPorHora(
  admin: SupabaseClient,
  clinicId: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from("ia_liberacao")
    .select("teto_respostas_por_conversa_hora")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  const valor = (data as { teto_respostas_por_conversa_hora?: unknown } | null)
    ?.teto_respostas_por_conversa_hora;
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}
