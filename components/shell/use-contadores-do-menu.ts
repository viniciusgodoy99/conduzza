"use client";

import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";
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
  avisoDeUrgenciaDaLinha,
  destinoDoAbrir,
  pedirParaAbrirConversa,
  TEXTOS_DOS_AVISOS,
  vigiaDaAtribuicao,
  type AvisoDeUrgencia,
  type LinhaDaConversaNoEvento,
  type LinhaDaMarcaNoEvento,
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
// D-55 pela recomendacao, pendentes do dono; revisao da AG6a):
// - as conversas marcadas como urgentes (a marca aberta com a conversa em
//   "Aguardando você") entram na recontagem; com alguma, o contador do
//   Atendimento fica em alerta (rail.tsx). O primeiro numero sai daqui,
//   logo na montagem (o layout nao conta); falha deixa o tom de sempre
//   (null);
// - a marca (conversa_urgente) vem num CANAL PROPRIO (canaisDoMenu): o
//   servidor do tempo real cria as assinaturas de um canal numa transacao
//   so, e a tabela fora da publicacao (codigo no ar antes da migration
//   20261029120000, ou um rollback dela) desfazia o lote inteiro em
//   silencio: o menu perdia conversation e appointment;
// - o aviso na tela "Conversa urgente de {nome}." com "Abrir", em qualquer
//   tela, para quem ve a conversa (a RLS do tempo real recorta), uma vez
//   por marca;
// - o aviso "A IA passou para você a conversa de {nome}." com "Abrir" nasce
//   do evento de CONVERSATION que este canal ja recebe filtrado pela
//   clinica, quando a conversa entra em atendimento com quem olha
//   (vigiaDaAtribuicao: uma pergunta por entrada); o servidor confere o
//   ultimo evento do fio. O menu nao assina mais message: era sem filtro de
//   clinica, em todas as telas, e cada aba conferia a RLS de cada evento de
//   todas as clinicas.
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

/** Os nomes dos dois canais do menu (um por clinica). */
export const CANAIS_DO_MENU = {
  principal: (clinicId: string) => `contadores-do-menu:${clinicId}`,
  urgencia: (clinicId: string) => `contadores-do-menu-urgencia:${clinicId}`,
} as const;

/** Um evento do banco como o tempo real entrega (a linha inteira). */
export type EventoDoMenu = RealtimePostgresChangesPayload<
  Record<string, unknown>
>;

/** O que cada tabela dos canais do menu faz (reacoesDoMenu). */
export type ReacoesDoMenu = {
  conversa: (evento: EventoDoMenu) => void;
  agenda: (evento: EventoDoMenu) => void;
  marca: (evento: EventoDoMenu) => void;
};

/**
 * O que cada evento do menu faz, sem React (o hook so passa o que elas
 * chamam, e o teste alimenta eventos de verdade):
 * - conversation: a recontagem e, quando a conversa ENTRA em atendimento
 *   com quem olha (atribuicaoNova, o vigia da atribuicao: uma pergunta por
 *   entrada, nunca uma por evento), a pergunta ao servidor pelo aviso "A IA
 *   passou para você";
 * - appointment: so a recontagem;
 * - conversa_urgente: a recontagem e, com a marca aberta da clinica ativa,
 *   o aviso de urgencia (DELETE e a poda da marca encerrada: so a
 *   recontagem).
 * Nada do evento vai para log.
 */
export function reacoesDoMenu({
  clinicId,
  recontar,
  atribuicaoNova,
  avisarAtribuicao,
  avisarUrgencia,
}: {
  clinicId: string;
  /** A recontagem agrupada (agendarRecontagem). */
  recontar: () => void;
  atribuicaoNova: (
    linha: LinhaDaConversaNoEvento | null | undefined,
  ) => string | null;
  avisarAtribuicao: (conversationId: string) => void;
  avisarUrgencia: (aviso: AvisoDeUrgencia) => void;
}): ReacoesDoMenu {
  return {
    conversa: (evento) => {
      recontar();
      const conversationId = atribuicaoNova(
        evento.new as LinhaDaConversaNoEvento,
      );
      if (conversationId) {
        avisarAtribuicao(conversationId);
      }
    },
    agenda: () => {
      recontar();
    },
    marca: (evento) => {
      recontar();
      if (evento.eventType === "DELETE") {
        return;
      }
      const aviso = avisoDeUrgenciaDaLinha(
        evento.new as LinhaDaMarcaNoEvento,
        clinicId,
      );
      if (aviso) {
        avisarUrgencia(aviso);
      }
    },
  };
}

/**
 * Os canais do menu, filtrados pela clinica, so com o que o menu deste
 * papel mostra: o principal (conversation e appointment) e o da marca de
 * urgencia (conversa_urgente, so com o contador do Atendimento), separado
 * de proposito (ver o topo). Nenhuma assinatura de message. So monta: quem
 * chama entra em cada um com assinarComSessao. Nulo: nada a vigiar.
 */
export function canaisDoMenu(
  supabase: Pick<SupabaseClient, "channel">,
  clinicId: string,
  vigiar: { conversas: boolean; confirmacoes: boolean },
  reagir: ReacoesDoMenu,
): { principal: RealtimeChannel | null; urgencia: RealtimeChannel | null } {
  const filter = `clinic_id=eq.${clinicId}`;
  let principal: RealtimeChannel | null = null;
  if (vigiar.conversas || vigiar.confirmacoes) {
    principal = supabase.channel(CANAIS_DO_MENU.principal(clinicId));
    if (vigiar.conversas) {
      principal = principal.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation", filter },
        reagir.conversa,
      );
    }
    if (vigiar.confirmacoes) {
      principal = principal.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointment", filter },
        reagir.agenda,
      );
    }
  }
  // A marca nova, reaberta ou encerrada (DELETE e a poda da encerrada).
  const urgencia = vigiar.conversas
    ? supabase
        .channel(CANAIS_DO_MENU.urgencia(clinicId))
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "conversa_urgente", filter },
          reagir.marca,
        )
    : null;
  return { principal, urgencia };
}
// [AG6 urgência e passagem] fim

export function useContadoresDoMenu({
  clinicId,
  timezone,
  iniciais,
  // [AG6 passagem] início
  viewerId,
  // [AG6 passagem] fim
  vigiarConversas,
  vigiarConfirmacoes,
}: {
  clinicId: string;
  timezone: string;
  iniciais: ContadoresDoMenu;
  // [AG6 passagem] início
  /** Quem olha: o aviso da atribuicao so pergunta da conversa que vem a ela. */
  viewerId: string;
  // [AG6 passagem] fim
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

    // Uma vez por marca de urgencia, enquanto o vigia vive (troca de tela
    // nao zera: o shell continua montado).
    const avisados = new Set<string>();
    // Quando perguntar pela atribuicao: a conversa que entra em atendimento
    // com quem olha (uma pergunta por entrada, nunca por evento).
    const atribuicaoNova = vigiaDaAtribuicao({ clinicId, viewerId });

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

    const avisarAtribuicao = async (conversationId: string) => {
      const resultado = await lerAviso({ tipo: "atribuida", conversationId });
      // So com a confirmacao do servidor: a mesma entrada acontece quando a
      // propria pessoa assume a conversa.
      if (!ativo || !resultado.ok || !resultado.aviso) {
        return;
      }
      toast.info(TEXTOS_DOS_AVISOS.atribuida(resultado.aviso.contato), {
        id: `atribuida:${conversationId}`,
        duration: DURACAO_DO_AVISO_DE_ATRIBUICAO_MS,
        action: {
          label: TEXTOS_DOS_AVISOS.abrir,
          onClick: () => abrir(conversationId),
        },
        actionButtonStyle: ESTILO_DO_ABRIR,
        classNames: { actionButton: CLASSE_DO_ABRIR },
      });
    };

    const { principal, urgencia } = canaisDoMenu(
      supabase,
      clinicId,
      { conversas: vigiarConversas, confirmacoes: vigiarConfirmacoes },
      reacoesDoMenu({
        clinicId,
        recontar: agendarRecontagem,
        atribuicaoNova,
        avisarAtribuicao: (conversationId) => {
          void avisarAtribuicao(conversationId);
        },
        avisarUrgencia: (aviso) => {
          void avisarUrgencia(aviso);
        },
      }),
    );
    // [AG6 urgência e passagem] fim

    // O que mudou entre a contagem do servidor e o canal ficar de pe (ou
    // durante uma queda) nao gerou evento para esta aba: reconta ao
    // (re)conectar, em cada canal (as duas recontagens viram uma).
    const aoMudar = (status: string) => {
      if (status === "SUBSCRIBED") {
        agendarRecontagem();
      }
    };
    const parar = principal
      ? assinarComSessao(supabase, principal, aoMudar)
      : () => undefined;
    // [AG6 urgência] início
    const pararUrgencia = urgencia
      ? assinarComSessao(supabase, urgencia, aoMudar)
      : () => undefined;
    // [AG6 urgência] fim

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
      // [AG6 urgência] início
      pararUrgencia();
      // [AG6 urgência] fim
    };
  }, [
    clinicId,
    timezone,
    // [AG6 passagem] início
    viewerId,
    // [AG6 passagem] fim
    vigiarConversas,
    vigiarConfirmacoes,
    router,
  ]);

  return contadores;
}
