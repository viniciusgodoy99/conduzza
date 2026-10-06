import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AgendadaDoFio,
  AgendadasDoFio,
} from "@/lib/domain/mensagem-agendada";

// Quais mensagens do fio sairam de uma mensagem agendada, e quem assina
// (bolha "{Ana} · Mensagem agendada"). Chave do TanStack Query:
// agendadasKeys.doFio(conversationId), no dominio.
//
// Consulta SEPARADA do fio, de proposito (achado 16 da revisao): embutida no
// select das mensagens, uma tabela que falte (deploy antes da migration,
// rollback) ou um embed recusado pelo PostgREST derrubava o fio de TODAS as
// conversas. Aqui, qualquer erro vira mapa vazio: some so a marca da bolha,
// que volta a ser a de uma resposta comum.
//
// Pela SESSAO (roda no navegador, como o fio): a RLS de mensagem_agendada
// recorta (o profissional so ve a da conversa dele). So ids: o texto da
// agendada nunca vem para o fio (depois de sair, ele vive em message). Nada
// daqui vai para log.

/** Ids por consulta: o filtro in.(...) vai na URL. */
const LOTE = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LinhaDoFio = {
  message_id: string | null;
  criada_por: string | null;
  editada_por: string | null;
};

/**
 * Por message_id, a agendada de onde a mensagem saiu (quem criou e quem
 * editou por ultimo). So entram ids de mensagem validos: a bolha otimista
 * (id provisorio) nao pode derrubar a consulta inteira com um uuid
 * invalido. Erro de leitura, de rede ou da tabela: mapa vazio.
 */
export async function fetchAgendadasDoFio(
  supabase: SupabaseClient,
  clinicId: string,
  messageIds: readonly string[],
): Promise<AgendadasDoFio> {
  const ids = [...new Set(messageIds.filter((id) => UUID.test(id)))];
  if (ids.length === 0) {
    return {};
  }
  const lotes: string[][] = [];
  for (let inicio = 0; inicio < ids.length; inicio += LOTE) {
    lotes.push(ids.slice(inicio, inicio + LOTE));
  }
  try {
    const respostas = await Promise.all(
      lotes.map((lote) =>
        supabase
          .from("mensagem_agendada")
          .select("message_id, criada_por, editada_por")
          .eq("clinic_id", clinicId)
          .in("message_id", lote),
      ),
    );
    const mapa: AgendadasDoFio = {};
    for (const { data, error } of respostas) {
      if (error) {
        return {};
      }
      for (const linha of (data ?? []) as LinhaDoFio[]) {
        if (!linha.message_id || !linha.criada_por) {
          continue;
        }
        const agendada: AgendadaDoFio = {
          criadaPor: linha.criada_por,
          editadaPor: linha.editada_por ?? null,
        };
        mapa[linha.message_id] = agendada;
      }
    }
    return mapa;
  } catch {
    return {};
  }
}
