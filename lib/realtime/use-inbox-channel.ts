"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assinaturaDaConexao,
  type LinhaDoNumero,
} from "@/lib/domain/conexao-dos-numeros";
import {
  conversationKeys,
  type ConversationListItem,
} from "@/lib/queries/conversations";

// Tempo real do Inbox (tarefa 1.7): postgres_changes em conversation, message
// e whatsapp_account, filtrado por clinica. A RLS aplica POR ASSINANTE nos
// eventos de INSERT/UPDATE (por isso a policy fina do papel profissional vive
// no banco); nao deletamos conversa nem mensagem, entao a limitacao de DELETE
// sem filtro nao nos alcanca.
//
// ESCALA: antes, toda mensagem invalidava a lista INTEIRA de conversas em
// cada aba aberta. Uma clinica movimentada com varios atendentes recarregava
// a lista dezenas de vezes por minuto, o que era a maior conta de banda e a
// maior fonte de travamento. Agora o evento de conversa atualiza SO aquela
// linha na lista (setQueryData), e o evento de mensagem so mexe no fio da
// conversa afetada. A invalidacao completa fica para os casos raros em que a
// linha nova nao esta na lista (conversa nova ou reaberta), que precisam do
// join de contato que o payload do evento nao traz.

type ConversationRow = {
  id: string;
  status: string;
  assignee_user_id: string | null;
  unread_count: number;
  awaiting_reply?: boolean;
  last_message_at: string | null;
  last_inbound_at: string | null;
  // Previa da ultima mensagem (gatilho no banco). Dado de paciente: chega
  // pelo mesmo filtro de RLS da linha e so vai para o cache da tela.
  last_preview?: string | null;
  last_preview_kind?: ConversationListItem["last_preview_kind"];
  // Quem escreveu a mensagem da previa (mesmo gatilho, migration
  // 20260925120000).
  last_preview_author?: ConversationListItem["last_preview_author"];
  last_preview_author_user_id?: string | null;
  tags: string[] | null;
  // Numero da conversa (docs/07). So muda de nulo para valor (adocao da
  // conversa orfa quando a clinica ganha o primeiro numero).
  whatsapp_account_id?: string | null;
};

/** undefined (evento sem a coluna) mantem o valor da tela; null e valor. */
function colunaOu<T>(novo: T | undefined, atual: T): T {
  return novo !== undefined ? novo : atual;
}

export function useInboxChannel(
  supabase: SupabaseClient,
  clinicId: string,
): void {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    const listKey = conversationKeys.list(clinicId);
    // O total de resolvidas (chip "Resolvida") mora fora da chave-mae da
    // lista; muda quando uma conversa e resolvida ou reaberta. Invalidar uma
    // consulta desligada (filtro fechado) nao custa nada.
    const invalidarTotalDeResolvidas = () =>
      void queryClient.invalidateQueries({
        queryKey: conversationKeys.totalResolvidas(clinicId),
      });

    const aplicarConversa = (row: ConversationRow) => {
      const atual =
        queryClient.getQueryData<ConversationListItem[]>(listKey) ?? [];
      const existente = atual.find((c) => c.id === row.id);

      // Conversa que saiu de andamento: remove da lista ativa.
      if (row.status === "resolvida") {
        if (existente) {
          queryClient.setQueryData<ConversationListItem[]>(
            listKey,
            atual.filter((c) => c.id !== row.id),
          );
        }
        // O arquivo de resolvidas (e a conversa aberta por link) so refaz a
        // busca se estiver na tela: invalidar uma consulta desligada nao
        // custa nada.
        void queryClient.invalidateQueries({
          queryKey: listKey,
          predicate: (query) => query.queryKey.length > listKey.length,
        });
        invalidarTotalDeResolvidas();
        return;
      }

      // Linha desconhecida (conversa nova ou reaberta): precisa do join de
      // contato, que o evento nao traz. Invalida uma vez, evento raro.
      if (!existente) {
        void queryClient.invalidateQueries({ queryKey: listKey });
        invalidarTotalDeResolvidas();
        return;
      }

      // Caso comum: mescla as colunas novas mantendo o contato ja carregado, e
      // reordena por last_inbound_at desc (ordem de recebimento).
      const atualizada: ConversationListItem = {
        ...existente,
        status: row.status as ConversationListItem["status"],
        assignee_user_id: row.assignee_user_id,
        unread_count: row.unread_count,
        // ?? em vez de atribuicao direta: se o evento vier sem a coluna, o
        // valor que ja esta na tela vale mais do que apagar o sinal de
        // espera e sumir com a conversa do contador.
        awaiting_reply: row.awaiting_reply ?? existente.awaiting_reply,
        last_message_at: row.last_message_at,
        last_inbound_at: row.last_inbound_at,
        // undefined (evento sem a coluna) mantem o que esta na tela; null e
        // valor de verdade (conversa sem mensagem visivel).
        last_preview: colunaOu(row.last_preview, existente.last_preview),
        last_preview_kind: colunaOu(
          row.last_preview_kind,
          existente.last_preview_kind,
        ),
        last_preview_author: colunaOu(
          row.last_preview_author,
          existente.last_preview_author,
        ),
        last_preview_author_user_id: colunaOu(
          row.last_preview_author_user_id,
          existente.last_preview_author_user_id,
        ),
        tags: row.tags ?? existente.tags,
        whatsapp_account_id: colunaOu(
          row.whatsapp_account_id,
          existente.whatsapp_account_id,
        ),
      };
      const proxima = atual
        .map((c) => (c.id === row.id ? atualizada : c))
        .sort((a, b) =>
          (b.last_inbound_at ?? "").localeCompare(a.last_inbound_at ?? ""),
        );
      queryClient.setQueryData<ConversationListItem[]>(listKey, proxima);
    };

    // Conexao dos numeros (docs/07, achado 6). Toda reserva de slot de envio
    // faz UPDATE em whatsapp_account, e antes cada UPDATE chamava
    // router.refresh(): cada mensagem enviada recarregava a pagina em todas
    // as abas abertas da clinica. Agora so recarrega quando o STATUS de algum
    // numero muda (ou ele e removido) em relacao ao que esta aba ja sabe. O
    // retrato de partida e lido quando o canal fica de pe (e de novo a cada
    // reconexao, que tambem recarrega se algo mudou durante a queda).
    const conexoes = new Map<string, string>();
    let retratoLido = false;
    let vivo = true;

    const lerRetratoDasConexoes = async () => {
      const { data, error } = await supabase
        .from("whatsapp_account")
        .select("id, connection_status, removido_em")
        .eq("clinic_id", clinicId);
      if (!vivo || error) {
        return;
      }
      let mudou = false;
      for (const linha of (data ?? []) as LinhaDoNumero[]) {
        const assinatura = assinaturaDaConexao(linha);
        if (!linha.id || assinatura === null) {
          continue;
        }
        if (retratoLido && conexoes.get(linha.id) !== assinatura) {
          mudou = true;
        }
        conexoes.set(linha.id, assinatura);
      }
      retratoLido = true;
      if (mudou) {
        router.refresh();
      }
    };

    const aplicarConexao = (linha: LinhaDoNumero) => {
      const assinatura = assinaturaDaConexao(linha);
      if (!linha.id || assinatura === null) {
        return;
      }
      const anterior = conexoes.get(linha.id);
      conexoes.set(linha.id, assinatura);
      // Numero que esta aba ainda nao conhecia: com o retrato lido, e numero
      // novo (recarrega); antes dele, nao ha com o que comparar.
      if (anterior === assinatura || (anterior === undefined && !retratoLido)) {
        return;
      }
      // O layout e a pagina sao renderizados no servidor (a faixa de
      // desconectado na primeira pintura, e se a clinica tem numero):
      // recarrega para acompanharem a conexao.
      router.refresh();
    };

    const channel = supabase
      .channel(`inbox:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const row = payload.new as ConversationRow | null;
          if (row?.id) {
            aplicarConversa(row);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          // So o fio da conversa afetada, nunca a lista. A conversa em si vem
          // pelo evento de conversation acima (a ingestao atualiza a linha).
          const conversationId = (
            payload.new as { conversation_id?: string } | null
          )?.conversation_id;
          if (conversationId) {
            void queryClient.invalidateQueries({
              queryKey: conversationKeys.messages(conversationId),
            });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "contact",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          // Etapa e nome do contato mudam FORA do Inbox (Kanban, termo-chave,
          // gatilhos da agenda, o proprio assumir): sem isto o seletor de
          // etapa do painel editava sobre um retrato velho (achado da
          // revisao de 19/09). So a lista e invalidada: o contato viaja
          // embutido nela.
          void queryClient.invalidateQueries({ queryKey: ["conversations"] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "whatsapp_account",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const linha = payload.new as LinhaDoNumero | null;
          if (linha) {
            aplicarConexao(linha);
          }
        },
      )
      .subscribe((status) => {
        // Catch-up: o que chegou entre a busca do servidor e o canal ficar de
        // pe (ou durante uma queda de conexao) nao gerou evento para esta
        // aba. Ao (re)conectar, refaz a lista e o fio aberto; sem isto, a
        // mensagem da janela do handshake so aparecia no proximo gatilho.
        if (status === "SUBSCRIBED") {
          void queryClient.invalidateQueries({
            queryKey: conversationKeys.list(clinicId),
          });
          invalidarTotalDeResolvidas();
          void queryClient.invalidateQueries({ queryKey: ["messages"] });
          void lerRetratoDasConexoes();
        }
      });

    return () => {
      vivo = false;
      void supabase.removeChannel(channel);
    };
  }, [supabase, clinicId, queryClient, router]);
}
