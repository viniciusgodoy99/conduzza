"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { diaCivil, limitesDoDia } from "@/lib/domain/horarios";
import {
  agendaKeys,
  fetchConsulta,
  type AgendaDia,
  type ConsultaDaAgenda,
  type HoldDaAgenda,
} from "@/lib/queries/agenda";
import { assinarComSessao } from "@/lib/realtime/assinar-com-sessao";

// Tempo real da Agenda: canal por clinica em appointment e slot_hold,
// filtrado por clinic_id. A RLS aplica POR ASSINANTE (o recorte do papel
// profissional vive na policy, entao o Dr. Joao nem recebe eventos da Dra.
// Ana). Licao de escala do Inbox: mesclar a LINHA afetada com setQueryData;
// invalidar a chave inteira so no caso raro de linha desconhecida.
//
// slot_hold: sem assinatura de DELETE (o filtro de coluna nao vale para
// DELETE no Supabase e vazaria evento entre clinicas). A expiracao do hold e
// timer no cliente sobre expires_at; a limpeza fisica e do worker.
//
// Reserva da IA (revisao da E4): INSERT e UPDATE. O UPDATE e o consumo pelo
// agendar_pela_ia (a reserva virou consulta: sai da tela na hora, em vez de
// ficar por baixo do bloco da consulta ate o vencimento original). A troca
// de reserva da conversa (reservar_horario_da_ia apaga a anterior) chega
// como o INSERT da nova: a anterior da MESMA conversa sai de todo dia em
// cache, sem assinar DELETE.

/**
 * As reservas de um dia em cache depois de um evento de reserva (INSERT ou
 * UPDATE). PURO. Sai a propria linha (vai de novo so se continua viva e e
 * deste dia), sai a vencida, e a reserva viva de uma conversa tira a
 * anterior da mesma conversa.
 */
export function reservasDepoisDoEvento(
  atuais: readonly HoldDaAgenda[],
  evento: HoldDaAgenda,
  e: { agoraMs: number; doDia: boolean },
): HoldDaAgenda[] {
  const viva = (h: HoldDaAgenda) =>
    (h.consumido_em ?? null) === null &&
    new Date(h.expires_at).getTime() > e.agoraMs;
  const conversa = evento.conversation_id ?? null;
  const eventoVivo = viva(evento);
  const ficam = atuais.filter(
    (h) =>
      h.id !== evento.id &&
      viva(h) &&
      !(eventoVivo && conversa !== null && h.conversation_id === conversa),
  );
  return eventoVivo && e.doDia ? [...ficam, evento] : ficam;
}

type AppointmentRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: ConsultaDaAgenda["status"];
  professional_id: string;
  approval_status: ConsultaDaAgenda["approval_status"];
  confirmation_channel: string | null;
  is_overbooking: boolean;
  send_confirmation: boolean;
  notes: string | null;
};

export function useAgendaChannel(
  supabase: SupabaseClient,
  clinicId: string,
  timezone: string,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const mesclarConsulta = async (row: AppointmentRow) => {
      const diaNovo = diaCivil(timezone, new Date(row.starts_at));
      const chaveNova = agendaKeys.dia(clinicId, diaNovo);

      // Remove a linha de qualquer dia em cache onde ela estiver (remarcacao
      // pode te-la movido de dia).
      const caches = queryClient.getQueriesData<AgendaDia>({
        queryKey: ["agenda", clinicId, "dia"],
      });
      let existente: ConsultaDaAgenda | null = null;
      for (const [chave, dados] of caches) {
        if (!dados) {
          continue;
        }
        const achada = dados.consultas.find((c) => c.id === row.id);
        if (achada) {
          existente = achada;
          const mesmaChave =
            JSON.stringify(chave) === JSON.stringify(chaveNova);
          if (!mesmaChave) {
            queryClient.setQueryData<AgendaDia>(chave, {
              ...dados,
              consultas: dados.consultas.filter((c) => c.id !== row.id),
            });
          }
        }
      }

      const dadosDoDia = queryClient.getQueryData<AgendaDia>(chaveNova);
      if (dadosDoDia) {
        if (existente) {
          // Caso comum: mescla as colunas mutaveis preservando os joins.
          const atualizada: ConsultaDaAgenda = {
            ...existente,
            starts_at: row.starts_at,
            ends_at: row.ends_at,
            status: row.status,
            professional_id: row.professional_id,
            approval_status: row.approval_status,
            confirmation_channel: row.confirmation_channel,
            is_overbooking: row.is_overbooking,
            send_confirmation: row.send_confirmation,
            notes: row.notes,
          };
          queryClient.setQueryData<AgendaDia>(chaveNova, {
            ...dadosDoDia,
            consultas: [
              ...dadosDoDia.consultas.filter((c) => c.id !== row.id),
              atualizada,
            ].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
          });
        } else {
          // Linha nova: o payload nao traz os joins; busca SO ela.
          const completa = await fetchConsulta(supabase, row.id);
          if (completa) {
            queryClient.setQueryData<AgendaDia>(chaveNova, (atual) =>
              atual
                ? {
                    ...atual,
                    consultas: [
                      ...atual.consultas.filter((c) => c.id !== row.id),
                      completa,
                    ].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
                  }
                : atual,
            );
          } else {
            void queryClient.invalidateQueries({ queryKey: chaveNova });
          }
        }
      }

      // Painel de pendencias: entra/sai conforme approval_status.
      void queryClient.invalidateQueries({
        queryKey: agendaKeys.pendencias(clinicId),
      });
      // Historico daquela consulta (sheet aberto acompanha).
      void queryClient.invalidateQueries({
        queryKey: agendaKeys.historico(row.id),
      });
    };

    const mesclarHold = (hold: HoldDaAgenda) => {
      const agoraMs = Date.now();
      const inicioDoHold = new Date(hold.starts_at).getTime();
      const fimDoHold = new Date(hold.ends_at).getTime();
      // Todo dia em cache: a reserva anterior da conversa pode ser de outro
      // dia, e a consumida sai de onde estiver. A reserva entra em todo dia
      // que ela toca (como fetchAgendaDia), no fuso da clinica.
      const caches = queryClient.getQueriesData<AgendaDia>({
        queryKey: ["agenda", clinicId, "dia"],
      });
      for (const [chave, dados] of caches) {
        const dia = chave[3];
        if (!dados || typeof dia !== "string") {
          continue;
        }
        const { inicio, fim } = limitesDoDia(timezone, dia);
        const holds = reservasDepoisDoEvento(dados.holds, hold, {
          agoraMs,
          doDia: inicioDoHold < fim.getTime() && fimDoHold > inicio.getTime(),
        });
        const mudou =
          holds.length !== dados.holds.length ||
          holds.some((h, i) => h !== dados.holds[i]);
        if (mudou) {
          queryClient.setQueryData<AgendaDia>(chave, { ...dados, holds });
        }
      }
    };

    const channel = supabase
      .channel(`agenda:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointment",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const row = payload.new as AppointmentRow | null;
          if (row?.id) {
            void mesclarConsulta(row);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "slot_hold",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const hold = payload.new as HoldDaAgenda | null;
          if (hold?.id) {
            mesclarHold(hold);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "slot_hold",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const hold = payload.new as HoldDaAgenda | null;
          if (hold?.id) {
            mesclarHold(hold);
          }
        },
      );
    const parar = assinarComSessao(supabase, channel, (status) => {
      // Catch-up: consulta marcada entre a busca do servidor e o canal
      // ficar de pe (ou durante uma queda) nao gerou evento para esta aba.
      // O prefixo cobre dia e pendencias; so as queries ativas refazem.
      if (status === "SUBSCRIBED") {
        void queryClient.invalidateQueries({
          queryKey: ["agenda", clinicId],
        });
      }
    });

    return parar;
  }, [supabase, clinicId, timezone, queryClient]);
}
