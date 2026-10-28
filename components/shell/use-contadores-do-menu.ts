"use client";

import { BellRing } from "lucide-react";
import { useRouter } from "next/navigation";
import { createElement, useEffect, useState } from "react";
import { toast } from "sonner";

// [AG6 urgência e passagem] início
import {
  lerAvisoDaConversaAction,
  type ResultadoDoAviso,
} from "@/app/(app)/atendimento/avisos-actions";
import {
  avisoDeAtribuicaoDaLinha,
  avisoDeUrgenciaDaLinha,
  destinoDoAbrir,
  pedirParaAbrirConversa,
  TEXTOS_DOS_AVISOS,
  type AvisoDeAtribuicao,
  type AvisoDeUrgencia,
  type LinhaDaMarcaNoEvento,
  type LinhaDoEventoNoFio,
} from "@/components/shell/avisos-da-conversa";
// [AG6 urgência e passagem] fim
import {
  contarConfirmacoesDeAmanha,
  contarConversasAguardando,
  // [AG6 urgência] início
  contarConversasUrgentes,
  // [AG6 urgência] fim
} from "@/components/shell/contadores-do-menu";
import type { ContadoresDoMenu } from "@/components/shell/tipos";
import { createClient } from "@/lib/supabase/client";
import { assinarComSessao } from "@/lib/realtime/assinar-com-sessao";

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
//
// [AG6 urgência e passagem] início (desenho da AG6, secoes 1.1, 1.3 e 6; D-53 e
// D-55 pela recomendacao, pendentes do dono):
// - as conversas marcadas como urgentes (conversa_urgente aberta) entram na
//   recontagem e no canal; com alguma, o contador do Atendimento fica em
//   alerta (rail.tsx). O primeiro numero sai daqui, logo na montagem (o
//   layout nao conta); falha deixa o tom de sempre (null);
// - o aviso na tela "Conversa urgente de {nome}." com "Abrir", em qualquer
//   tela, para quem ve a conversa (a RLS do tempo real recorta), uma vez
//   por marca;
// - o aviso "A IA passou para você a conversa de {nome}." com "Abrir", do
//   evento da atribuicao no fio (o canal escuta so as mensagens de evento),
//   so para quem ficou com a conversa (o servidor confere).
// O nome vem da Server Action, que le pela sessao e grava a trilha
// (avisos-actions.ts); nada do evento vai para log.
// [AG6 urgência e passagem] fim

const INTERVALO_MS = 60_000;
const AGRUPAR_EVENTOS_MS = 1_000;

// [AG6 urgência e passagem] início
/** O aviso de urgencia fica mais tempo na tela que um aviso comum. */
export const DURACAO_DO_AVISO_DE_URGENCIA_MS = 60_000;
export const DURACAO_DO_AVISO_DE_ATRIBUICAO_MS = 15_000;

/**
 * O "Abrir" do aviso com o alvo de toque de 40px (C7): o botao do sonner
 * nasce com 24px e o estilo dele fica fora das camadas do Tailwind, entao o
 * tamanho vai pelo estilo do proprio aviso.
 */
export const ESTILO_DO_ABRIR = {
  height: 40,
  paddingLeft: 14,
  paddingRight: 14,
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
} as const;

/**
 * O foco do "Abrir" (C5): o sonner zera o contorno fora das camadas do
 * Tailwind, entao o anel de foco do DS leva "!" (no escopo cz-dark do
 * aviso, o --focus e o lime, visivel sobre a tinta).
 */
export const CLASSE_DO_ABRIR =
  "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-solid! focus-visible:outline-focus!";
// [AG6 urgência e passagem] fim

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
  // [AG6 urgência e passagem] início O "Abrir" dos avisos fora do Atendimento.
  const router = useRouter();
  // [AG6 urgência e passagem] fim

  // Carga dura ou router.refresh() refazem o layout com um numero novo do
  // servidor: ele passa a valer (ajuste de estado na renderizacao, sem
  // efeito, como a documentacao do React recomenda).
  if (
    base.conversas !== iniciais.conversas ||
    base.confirmacoes !== iniciais.confirmacoes
  ) {
    setBase(iniciais);
    // [AG6 urgência] início O layout nao conta as urgentes: a do vigia continua.
    setContadores((atual) => ({
      ...iniciais,
      urgentes: iniciais.urgentes ?? atual.urgentes ?? null,
    }));
    // [AG6 urgência] fim
  }

  useEffect(() => {
    if (!vigiarConversas && !vigiarConfirmacoes) {
      return;
    }
    const supabase = createClient();
    let ativo = true;
    let agendado: ReturnType<typeof setTimeout> | null = null;

    const recontar = async () => {
      const [conversas, confirmacoes, urgentes] = await Promise.all([
        vigiarConversas ? contarConversasAguardando(supabase, clinicId) : null,
        vigiarConfirmacoes
          ? contarConfirmacoesDeAmanha(supabase, clinicId, timezone, new Date())
          : null,
        // [AG6 urgência] início
        vigiarConversas ? contarConversasUrgentes(supabase, clinicId) : null,
        // [AG6 urgência] fim
      ]);
      if (!ativo) {
        return;
      }
      // Consulta que falhou mantem o numero anterior: sumir com o contador
      // por uma falha de rede seria dizer que ninguem esta esperando.
      setContadores((atual) => ({
        conversas: conversas ?? atual.conversas,
        confirmacoes: confirmacoes ?? atual.confirmacoes,
        // [AG6 urgência] início A excecao: a das urgentes que falhou volta ao tom
        // de sempre (null), para o alerta nunca ficar de uma contagem velha.
        urgentes,
        // [AG6 urgência] fim
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

    // [AG6 urgência e passagem] início
    // O primeiro numero das urgentes (o layout nao conta), sem esperar o
    // canal ficar de pe.
    if (vigiarConversas) {
      void contarConversasUrgentes(supabase, clinicId)
        .catch(() => null)
        .then((urgentes) => {
          if (ativo) {
            setContadores((atual) => ({ ...atual, urgentes }));
          }
        });
    }

    // Uma vez por marca de urgencia e por evento de atribuicao, enquanto o
    // vigia vive (troca de tela nao zera: o shell continua montado).
    const avisados = new Set<string>();

    const abrir = (conversationId: string) => {
      const destino = destinoDoAbrir(window.location.pathname, conversationId);
      if (destino.tipo === "evento") {
        pedirParaAbrirConversa(conversationId);
      } else {
        router.push(destino.href);
      }
    };

    const lerAviso = async (
      entrada: Parameters<typeof lerAvisoDaConversaAction>[0],
    ): Promise<ResultadoDoAviso> => {
      try {
        return await lerAvisoDaConversaAction(entrada);
      } catch {
        return { ok: false };
      }
    };

    const avisarUrgencia = async (aviso: AvisoDeUrgencia) => {
      if (avisados.has(aviso.chave)) {
        return;
      }
      avisados.add(aviso.chave);
      const resultado = await lerAviso({
        tipo: "urgente",
        conversationId: aviso.conversationId,
      });
      // Alguem ja pegou a conversa (ou ela saiu do alcance): sem aviso.
      if (!ativo || (resultado.ok && resultado.aviso === null)) {
        return;
      }
      // Sem o nome (a leitura falhou), o aviso sai assim mesmo: o evento
      // ja provou uma marca aberta que esta pessoa ve.
      const texto =
        resultado.ok && resultado.aviso
          ? TEXTOS_DOS_AVISOS.urgente(resultado.aviso.contato)
          : TEXTOS_DOS_AVISOS.urgenteSemNome;
      toast(texto, {
        id: `urgente:${aviso.conversationId}`,
        icon: createElement(BellRing, {
          "aria-hidden": true,
          className: "size-[17px] text-alert-text",
        }),
        duration: DURACAO_DO_AVISO_DE_URGENCIA_MS,
        action: {
          label: TEXTOS_DOS_AVISOS.abrir,
          onClick: () => abrir(aviso.conversationId),
        },
        actionButtonStyle: ESTILO_DO_ABRIR,
        classNames: { actionButton: CLASSE_DO_ABRIR },
      });
    };

    const avisarAtribuicao = async (aviso: AvisoDeAtribuicao) => {
      if (avisados.has(aviso.messageId)) {
        return;
      }
      avisados.add(aviso.messageId);
      const resultado = await lerAviso({
        tipo: "atribuida",
        conversationId: aviso.conversationId,
        messageId: aviso.messageId,
      });
      // So com a confirmacao do servidor: o evento chega tambem para quem
      // nao ficou com a conversa.
      if (!ativo || !resultado.ok || !resultado.aviso) {
        return;
      }
      toast.info(TEXTOS_DOS_AVISOS.atribuida(resultado.aviso.contato), {
        id: `atribuida:${aviso.conversationId}`,
        duration: DURACAO_DO_AVISO_DE_ATRIBUICAO_MS,
        action: {
          label: TEXTOS_DOS_AVISOS.abrir,
          onClick: () => abrir(aviso.conversationId),
        },
        actionButtonStyle: ESTILO_DO_ABRIR,
        classNames: { actionButton: CLASSE_DO_ABRIR },
      });
    };
    // [AG6 urgência e passagem] fim

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
      // [AG6 urgência e passagem] início
      // A marca de urgencia (INSERT, reaberta ou encerrada): a recontagem e,
      // com a marca aberta, o aviso. DELETE e a poda da marca encerrada.
      canal = canal.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversa_urgente",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          agendarRecontagem();
          if (payload.eventType === "DELETE") {
            return;
          }
          const aviso = avisoDeUrgenciaDaLinha(
            payload.new as LinhaDaMarcaNoEvento,
            clinicId,
          );
          if (aviso) {
            void avisarUrgencia(aviso);
          }
        },
      );
      // So as mensagens de EVENTO (o filtro do tempo real aceita uma
      // coluna; a clinica e conferida aqui): o evento da atribuicao ao
      // responsavel do lead. Nenhuma fala de paciente passa por este filtro.
      canal = canal.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message",
          filter: "content_type=eq.evento",
        },
        (payload) => {
          const aviso = avisoDeAtribuicaoDaLinha(
            payload.new as LinhaDoEventoNoFio,
            clinicId,
          );
          if (aviso) {
            void avisarAtribuicao(aviso);
          }
        },
      );
      // [AG6 urgência e passagem] fim
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
    const parar = assinarComSessao(supabase, canal, (status) => {
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
      parar();
    };
  }, [clinicId, timezone, vigiarConversas, vigiarConfirmacoes, router]);

  return contadores;
}
