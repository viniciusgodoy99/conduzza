import type { SupabaseClient } from "@supabase/supabase-js";

import { interpretarResposta } from "@/lib/domain/resposta-paciente";
import {
  RESPOSTA_CANCELADA,
  RESPOSTA_CONFIRMADA,
  RESPOSTA_REMARCAR,
} from "@/lib/domain/textos-padrao";

// Interceptador da resposta do paciente ao toque de confirmacao (tarefa 4.7).
// Roda no webhook, DEPOIS de a mensagem estar salva, e e o que faz o status da
// agenda mudar sozinho quando alguem toca em "Confirmar".
//
// Tres cuidados que sustentam o resto:
//
// 1. CONTEXTO OBRIGATORIO. So interpreta quem foi perguntado: precisa existir
//    um toque de confirmacao ENVIADO nos ultimos 7 dias para este contato,
//    apontando para uma consulta FUTURA e ainda em aberto. Sem contexto o
//    interceptador se cala e a conversa segue para a recepcao (que e o
//    fail-safe do fluxo, ja que a conversa nasce em 'aguardando_humano').
// 2. LEITURA CONSERVADORA. interpretarResposta so devolve intencao com frase
//    inteira reconhecida; qualquer sobra vira 'nao_reconhecida' e nada
//    acontece. Interpretar errado cancela a consulta de alguem.
// 3. QUEM DECIDE E O BANCO. As RPCs fazem update condicional no status atual,
//    entao resposta repetida (ou duas chegando juntas) muda uma vez so e o
//    segundo caminho recebe { ok: false, erro: 'ja_tratado' } sem efeito.
//
// Regra 3.1 do CLAUDE.md: este arquivo nao loga nada. O corpo da mensagem do
// paciente entra aqui e nao sai em lugar nenhum.

// Sete dias cobrem o toque de 72h com folga. Mais que isso e resposta a uma
// conversa velha, e o contexto deixa de ser confiavel.
const JANELA_DE_CONTEXTO_MS = 7 * 24 * 60 * 60 * 1000;

// Consulta que ainda espera (ou ja teve) resposta do paciente. Cancelada,
// atendida ou faltosa nao aceita confirmacao nem cancelamento pelo WhatsApp.
const STATUS_EM_ABERTO = [
  "agendado",
  "aguardando_confirmacao",
  "confirmado_paciente",
  "confirmado_recepcao",
];

// Teto de linhas lidas: a consulta certa e quase sempre a primeira, e o laco
// so existe para pular toque de consulta ja passada ou ja resolvida.
const TOQUES_CONSIDERADOS = 10;

type ConsultaDoToque = {
  id: string;
  status: string;
  starts_at: string;
};

type LinhaDeToque = {
  sent_at: string | null;
  appointment: ConsultaDoToque | ConsultaDoToque[] | null;
};

export type EntradaDaResposta = {
  clinicId: string;
  contactId: string;
  conversationId: string;
  body: string | null;
  contentType: string;
};

/**
 * A consulta a que esta resposta se refere, ou null quando o contato nao foi
 * perguntado. Tres passos curtos em vez de um filtro aninhado: o recorte por
 * regua de confirmacao vive em cadence, e filtro de embed encadeado no
 * PostgREST falha calado, o que aqui significaria confirmar a consulta errada.
 */
async function acharConsultaPerguntada(
  admin: SupabaseClient,
  clinicId: string,
  contactId: string,
): Promise<string | null> {
  const { data: reguas } = await admin
    .from("cadence")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("kind", "confirmacao");
  const reguaIds = ((reguas ?? []) as { id: string }[]).map((r) => r.id);
  if (reguaIds.length === 0) {
    return null;
  }

  const { data: passos } = await admin
    .from("cadence_step")
    .select("id")
    .eq("clinic_id", clinicId)
    .in("cadence_id", reguaIds);
  const passoIds = ((passos ?? []) as { id: string }[]).map((p) => p.id);
  if (passoIds.length === 0) {
    return null;
  }

  const desde = new Date(Date.now() - JANELA_DE_CONTEXTO_MS).toISOString();
  const { data: toques } = await admin
    .from("cadence_run")
    .select("sent_at, appointment:appointment_id ( id, status, starts_at )")
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .not("sent_at", "is", null)
    .gte("sent_at", desde)
    .in("cadence_step_id", passoIds)
    .order("sent_at", { ascending: false })
    .limit(TOQUES_CONSIDERADOS);

  const agora = Date.now();
  for (const linha of (toques ?? []) as LinhaDeToque[]) {
    const consulta = Array.isArray(linha.appointment)
      ? (linha.appointment[0] ?? null)
      : linha.appointment;
    if (!consulta) {
      continue;
    }
    if (!STATUS_EM_ABERTO.includes(consulta.status)) {
      continue;
    }
    if (new Date(consulta.starts_at).getTime() <= agora) {
      continue;
    }
    return consulta.id;
  }
  return null;
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
    payload: { contact_id: entrada.contactId, body },
  });
}

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
  if (intencao === "nao_reconhecida") {
    return;
  }

  const appointmentId = await acharConsultaPerguntada(
    admin,
    entrada.clinicId,
    entrada.contactId,
  );
  if (!appointmentId) {
    return;
  }

  if (intencao === "remarcar") {
    // Remarcar NAO muda status: horario novo e escolha humana, e a conversa
    // ja esta em 'aguardando_humano' esperando a recepcao.
    await responder(admin, entrada, RESPOSTA_REMARCAR);
    return;
  }

  const { data, error } = await admin.rpc(
    intencao === "confirmar"
      ? "confirmar_pelo_paciente"
      : "cancelar_pelo_paciente",
    {
      p_clinic_id: entrada.clinicId,
      p_appointment_id: appointmentId,
      p_contact_id: entrada.contactId,
      p_conversation_id: entrada.conversationId,
    },
  );
  if (error) {
    return;
  }
  // 'ja_tratado': alguem (ou a propria pessoa, duas vezes) chegou antes. Sem
  // eco, para o paciente nao receber dois agradecimentos pela mesma consulta.
  if ((data as { ok?: boolean } | null)?.ok !== true) {
    return;
  }

  await responder(
    admin,
    entrada,
    intencao === "confirmar" ? RESPOSTA_CONFIRMADA : RESPOSTA_CANCELADA,
  );

  // TODO(4.9): o cancelamento libera um horario e e aqui que a lista de espera
  // entra para reofertar. A reoferta nao existe ainda e nada e prometido ao
  // paciente sobre isso.
}
