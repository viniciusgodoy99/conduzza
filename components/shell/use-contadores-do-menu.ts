"use client";

import { useEffect, useState } from "react";

import {
  contarConfirmacoesDeAmanha,
  contarConversasAguardando,
} from "@/components/shell/contadores-do-menu";
import type { ContadoresDoMenu } from "@/components/shell/tipos";
import { createClient } from "@/lib/supabase/client";

// Vigia dos contadores do menu (Atendimento e Confirmacoes) no CLIENTE, no
// mesmo padrao do MotorStatus e do WhatsappStatus. O layout da area logada e
// preservado em navegacao suave, entao a contagem feita no servidor so
// mudaria em carga dura: o paciente escrevia enquanto a recepcao estava na
// Agenda e o menu continuava em 0 ate alguem dar F5, justamente quando o
// contador existe para avisar (achado 106 da revisao).
//
// O servidor entrega o primeiro numero. Depois, duas fontes em camadas: o
// Realtime de conversation e appointment filtrado pela clinica dispara uma
// recontagem (agrupada, porque uma mensagem mexe na conversa varias vezes),
// e um polling de reserva de 60s cobre canal de Realtime que caiu e a virada
// do dia (o "amanha" das confirmacoes muda a meia-noite da clinica). A
// recontagem usa as MESMAS consultas do layout; a RLS recorta o papel.

const INTERVALO_MS = 60_000;
const AGRUPAR_EVENTOS_MS = 1_000;

export function useContadoresDoMenu({
  clinicId,
  timezone,
  iniciais,
  vigiarConversas,
  vigiarConfirmacoes,
}: {
  clinicId: string;
  timezone: string;
  iniciais: ContadoresDoMenu;
  /** So vigia o que aparece no menu deste papel. */
  vigiarConversas: boolean;
  vigiarConfirmacoes: boolean;
}): ContadoresDoMenu {
  const [base, setBase] = useState(iniciais);
  const [contadores, setContadores] = useState(iniciais);

  // Carga dura ou router.refresh() refazem o layout com um numero novo do
  // servidor: ele passa a valer (ajuste de estado na renderizacao, sem
  // efeito, como a documentacao do React recomenda).
  if (
    base.conversas !== iniciais.conversas ||
    base.confirmacoes !== iniciais.confirmacoes
  ) {
    setBase(iniciais);
    setContadores(iniciais);
  }

  useEffect(() => {
    if (!vigiarConversas && !vigiarConfirmacoes) {
      return;
    }
    const supabase = createClient();
    let ativo = true;
    let agendado: ReturnType<typeof setTimeout> | null = null;

    const recontar = async () => {
      const [conversas, confirmacoes] = await Promise.all([
        vigiarConversas ? contarConversasAguardando(supabase, clinicId) : null,
        vigiarConfirmacoes
          ? contarConfirmacoesDeAmanha(supabase, clinicId, timezone, new Date())
          : null,
      ]);
      if (!ativo) {
        return;
      }
      // Consulta que falhou mantem o numero anterior: sumir com o contador
      // por uma falha de rede seria dizer que ninguem esta esperando.
      setContadores((atual) => ({
        conversas: conversas ?? atual.conversas,
        confirmacoes: confirmacoes ?? atual.confirmacoes,
      }));
    };

    const agendarRecontagem = () => {
      if (agendado) {
        return;
      }
      agendado = setTimeout(() => {
        agendado = null;
        void recontar();
      }, AGRUPAR_EVENTOS_MS);
    };

    let canal = supabase.channel(`contadores-do-menu:${clinicId}`);
    if (vigiarConversas) {
      canal = canal.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation",
          filter: `clinic_id=eq.${clinicId}`,
        },
        agendarRecontagem,
      );
    }
    if (vigiarConfirmacoes) {
      canal = canal.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointment",
          filter: `clinic_id=eq.${clinicId}`,
        },
        agendarRecontagem,
      );
    }
    canal.subscribe((status) => {
      // O que mudou entre a contagem do servidor e o canal ficar de pe (ou
      // durante uma queda) nao gerou evento para esta aba: reconta ao
      // (re)conectar.
      if (status === "SUBSCRIBED") {
        agendarRecontagem();
      }
    });

    const timer = setInterval(() => {
      void recontar();
    }, INTERVALO_MS);

    return () => {
      ativo = false;
      clearInterval(timer);
      if (agendado) {
        clearTimeout(agendado);
      }
      void supabase.removeChannel(canal);
    };
  }, [clinicId, timezone, vigiarConversas, vigiarConfirmacoes]);

  return contadores;
}
