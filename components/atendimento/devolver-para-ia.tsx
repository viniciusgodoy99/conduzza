"use client";

import { useQuery } from "@tanstack/react-query";
import { RotateCcw, Undo2 } from "lucide-react";

import {
  elegibilidadeDoDevolverAction,
  type ElegibilidadeDoDevolver,
  type MotivoDoDevolver,
} from "@/app/(app)/atendimento/actions";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ConversationListItem } from "@/lib/queries/conversations";
import { devolverKeys } from "@/lib/realtime/use-inbox-channel";

// "Devolver para a IA" no cabecalho do fio (E3, 13/10/2026). O botao so
// existe na conversa "minha" e so habilita quando o SERVIDOR diz que pode
// (ia_devolver_disponivel, pela action): clinica da fase controlada, quem
// pede escreve e atende a conversa, o assistente esta ligado e o telefone e
// da equipe (nunca de paciente), a ultima mensagem do contato ja foi
// respondida (conferida so DEPOIS da liberacao desde a revisao de producao
// de 19/10/2026: conversa de paciente nunca mostra a dica da pergunta
// pendente), e o assistente responderia AGORA (horario publicado, numero
// conectado, ambiente e motor; achado T1 da revisao: antes o botao
// habilitava e a confirmacao prometia resposta com a aba dizendo "Ligado,
// mas parado"). Fora das duas clinicas a tela nem pergunta: a dica e a de
// sempre ("Chega com o agente de IA"), e o e2e le esse texto.
//
// Cada motivo tem a sua dica, em linguagem de recepcionista. A recepcao, o
// profissional e a leitura recebem do servidor a dica generica
// (nao_disponivel), que nao revela a lista de telefones da equipe (docs/04
// 17.11). Enquanto confere, o botao fica desabilitado com "Conferindo...";
// se a conferencia falha, desabilitado com o erro e, ao lado, "Tentar de
// novo", que refaz a conferencia (achado T5 da revisao: sem ele, o erro
// mandava tentar de novo sem ter como). Clicar no Devolver pede confirmacao.

export const TEXTOS_DO_DEVOLVER = {
  rotulo: "Devolver para a IA",
  conferindo: "Conferindo...",
  erroAoConferir: "Não foi possível conferir agora. Tente de novo.",
  tentarDeNovo: "Tentar de novo",
  dicaTentarDeNovo: "Confere de novo se esta conversa pode voltar para a IA.",
  dicaQuandoPode: "A IA volta a responder esta conversa",
  confirmarTitulo: "Devolver para a IA?",
  confirmarTexto:
    "A IA volta a responder esta conversa a partir da próxima mensagem do contato. O que foi conversado antes não vai para a IA.",
  devolver: "Devolver",
  devolvendo: "Devolvendo...",
  cancelar: "Cancelar",
  sucesso: "Conversa devolvida para a IA.",
  dicas: {
    fora_da_fase:
      "Chega com o agente de IA. Até lá, use Resolver quando terminar o atendimento.",
    pergunta_pendente: "Responda o paciente antes de devolver para a IA.",
    assistente_desligado:
      "O assistente está desligado ou sem versão publicada. Veja em Configurações, Agente de IA.",
    nao_liberada:
      "Este telefone ou este número não está liberado para o assistente.",
    contato_de_paciente:
      "Este contato é paciente da clínica. A IA só conversa com telefones da equipe.",
    nao_disponivel: "Esta conversa não pode voltar para a IA.",
    // Achado T1 da revisao (S11 no servidor): o banco diz que pode, mas o
    // assistente nao responderia agora. Horario e numero valem para todos
    // os papeis (nao revelam lista nenhuma); "parado" (ambiente, motor ou
    // modo de horario que nao funciona no WhatsApp) so chega a quem
    // configura: os outros papeis recebem nao_disponivel.
    assistente_parado:
      "O assistente está parado agora. Veja em Configurações, Agente de IA.",
    fora_do_horario: "Agora está fora do horário escolhido para o assistente.",
    numero_desconectado: "O número desta conversa está desconectado.",
    // Conferencia da revisao (N1 e N2): o executor passaria a conversa de
    // volta sem responder. Valem para todos os papeis.
    sem_autorizacao: "Este contato não autorizou receber mensagens.",
    teto_de_respostas:
      "Esta conversa chegou ao limite de respostas da IA na última hora. Tente mais tarde.",
  } satisfies Record<
    Exclude<MotivoDoDevolver, "sem_permissao" | "nao_e_sua">,
    string
  >,
} as const;

/** O que o botao mostra. */
export type EstadoDoDevolver =
  | { tipo: "conferindo" }
  | { tipo: "erro" }
  | { tipo: "pode" }
  | { tipo: "nao_pode"; dica: string };

/** A leitura da elegibilidade, como o TanStack Query entrega. */
export type LeituraDaElegibilidade =
  | { status: "pending" }
  | { status: "error" }
  | { status: "success"; data: ElegibilidadeDoDevolver };

/**
 * A dica de cada motivo do servidor. `sem_permissao` usa a dica de
 * permissao de hoje (quem so acompanha); `nao_e_sua` so chega numa corrida
 * (a tela ainda achava a conversa "minha") e cai na generica.
 */
export function dicaDoMotivo(
  motivo: MotivoDoDevolver,
  dicaSemPermissao: string,
): string {
  switch (motivo) {
    case "sem_permissao":
      return dicaSemPermissao;
    case "nao_e_sua":
      return TEXTOS_DO_DEVOLVER.dicas.nao_disponivel;
    default:
      return TEXTOS_DO_DEVOLVER.dicas[motivo];
  }
}

/**
 * O estado do botao, puro (o teste cobre cada motivo). A ordem: fora das
 * duas clinicas, a dica de sempre sem perguntar ao servidor; sem escrita, a
 * dica de permissao; depois o que o servidor disse.
 */
export function estadoDoDevolver(entrada: {
  iaNaFase: boolean;
  podeEditar: boolean;
  dicaSemPermissao: string;
  leitura: LeituraDaElegibilidade;
}): EstadoDoDevolver {
  const { iaNaFase, podeEditar, dicaSemPermissao, leitura } = entrada;
  if (!iaNaFase) {
    return { tipo: "nao_pode", dica: TEXTOS_DO_DEVOLVER.dicas.fora_da_fase };
  }
  if (!podeEditar) {
    return { tipo: "nao_pode", dica: dicaSemPermissao };
  }
  if (leitura.status === "pending") {
    return { tipo: "conferindo" };
  }
  if (leitura.status === "error" || !leitura.data.ok) {
    return { tipo: "erro" };
  }
  if (leitura.data.pode) {
    return { tipo: "pode" };
  }
  return {
    tipo: "nao_pode",
    dica: dicaDoMotivo(leitura.data.motivo, dicaSemPermissao),
  };
}

/** O que o TanStack Query sabe da consulta, no recorte que a tela usa. */
export type ConsultaDaElegibilidade = {
  isError: boolean;
  isFetching: boolean;
  data: ElegibilidadeDoDevolver | undefined;
};

/**
 * A leitura que o botao mostra, pura (o teste cobre). Enquanto a consulta
 * refaz depois de um erro (o "Tentar de novo"), o botao volta a
 * "Conferindo...": o erro antigo nao fica na tela como se fosse a resposta
 * nova. Uma resposta boa que se atualiza no fundo (tempo real) continua na
 * tela ate a nova chegar.
 */
export function leituraDaConsulta(
  consulta: ConsultaDaElegibilidade,
): LeituraDaElegibilidade {
  const falhou =
    consulta.isError || (consulta.data !== undefined && !consulta.data.ok);
  if (falhou && consulta.isFetching) {
    return { status: "pending" };
  }
  if (consulta.isError) {
    return { status: "error" };
  }
  if (consulta.data === undefined) {
    return { status: "pending" };
  }
  return { status: "success", data: consulta.data };
}

/**
 * Le a elegibilidade no servidor, so dentro da fase, com escrita e na
 * conversa "minha". A chave leva status, responsavel e "Aguardando voce":
 * quando o tempo real muda qualquer um deles, a conferencia refaz sozinha.
 * `tentarDeNovo` refaz a consulta na hora (o botao do estado de erro).
 */
export function useElegibilidadeDoDevolver(params: {
  conversation: ConversationListItem;
  iaNaFase: boolean;
  podeEditar: boolean;
  minha: boolean;
}): { leitura: LeituraDaElegibilidade; tentarDeNovo: () => void } {
  const { conversation, iaNaFase, podeEditar, minha } = params;
  const query = useQuery({
    queryKey: [
      ...devolverKeys.daConversa(conversation.id),
      conversation.status,
      conversation.assignee_user_id,
      conversation.awaiting_reply,
    ],
    queryFn: () => elegibilidadeDoDevolverAction(conversation.id),
    enabled: iaNaFase && podeEditar && minha,
    staleTime: 15_000,
    retry: 1,
  });
  const { refetch } = query;
  return {
    leitura: leituraDaConsulta({
      isError: query.isError,
      isFetching: query.isFetching,
      data: query.data,
    }),
    tentarDeNovo: () => {
      void refetch();
    },
  };
}

// Mesmas classes de recolhimento do cabecalho (acoes-da-conversa.tsx).
const ROTULO_RECOLHIVEL = "@max-[759px]/fio:sr-only";
const BOTAO_RECOLHIVEL = "@max-[759px]/fio:w-10 @max-[759px]/fio:px-0";

/**
 * O botao em cada estado. Fora da conferencia o nome e "Devolver para a IA"
 * (o e2e procura por ele); enquanto o servidor responde, o texto visivel e
 * "Conferindo...", e o leitor de tela ouve tambem de que botao se trata.
 * No erro, o Devolver fica desabilitado com a dica e, ao lado, "Tentar de
 * novo" refaz a conferencia (aoTentarDeNovo).
 */
export function BotaoDevolverParaIa({
  estado,
  emCurso,
  ocupado,
  aoClicar,
  aoTentarDeNovo,
}: {
  estado: EstadoDoDevolver;
  /** a devolucao esta rodando */
  emCurso: boolean;
  /** outra acao do cabecalho esta rodando */
  ocupado: boolean;
  aoClicar: () => void;
  /** refaz a conferencia (so aparece no estado de erro) */
  aoTentarDeNovo: () => void;
}) {
  const habilitado = estado.tipo === "pode" && !ocupado;
  const textoVisivel = emCurso
    ? TEXTOS_DO_DEVOLVER.devolvendo
    : estado.tipo === "conferindo"
      ? TEXTOS_DO_DEVOLVER.conferindo
      : TEXTOS_DO_DEVOLVER.rotulo;
  const botao = (
    <Button
      variant="ghost"
      className={BOTAO_RECOLHIVEL}
      disabled={!habilitado}
      aria-busy={estado.tipo === "conferindo" || emCurso || undefined}
      onClick={aoClicar}
    >
      <Undo2 aria-hidden />
      <span className={ROTULO_RECOLHIVEL}>{textoVisivel}</span>
      {textoVisivel !== TEXTOS_DO_DEVOLVER.rotulo ? (
        <span className="sr-only"> ({TEXTOS_DO_DEVOLVER.rotulo})</span>
      ) : null}
    </Button>
  );
  if (estado.tipo === "pode") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{botao}</TooltipTrigger>
        <TooltipContent>{TEXTOS_DO_DEVOLVER.dicaQuandoPode}</TooltipContent>
      </Tooltip>
    );
  }
  if (estado.tipo === "erro") {
    return (
      <>
        <DisabledWithHint hint={TEXTOS_DO_DEVOLVER.erroAoConferir}>
          {botao}
        </DisabledWithHint>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className={BOTAO_RECOLHIVEL}
              disabled={ocupado}
              onClick={aoTentarDeNovo}
            >
              <RotateCcw aria-hidden />
              <span className={ROTULO_RECOLHIVEL}>
                {TEXTOS_DO_DEVOLVER.tentarDeNovo}
              </span>
              <span className="sr-only"> ({TEXTOS_DO_DEVOLVER.rotulo})</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{TEXTOS_DO_DEVOLVER.dicaTentarDeNovo}</TooltipContent>
        </Tooltip>
      </>
    );
  }
  const dica =
    estado.tipo === "nao_pode" ? estado.dica : TEXTOS_DO_DEVOLVER.conferindo;
  return <DisabledWithHint hint={dica}>{botao}</DisabledWithHint>;
}

/** O miolo da confirmacao (separado do Dialog para o teste estatico). */
export function ConfirmacaoDoDevolver({
  pendente,
  aoConfirmar,
  aoCancelar,
}: {
  pendente: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{TEXTOS_DO_DEVOLVER.confirmarTitulo}</DialogTitle>
        <DialogDescription>
          {TEXTOS_DO_DEVOLVER.confirmarTexto}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" disabled={pendente} onClick={aoCancelar}>
          {TEXTOS_DO_DEVOLVER.cancelar}
        </Button>
        <Button
          disabled={pendente}
          aria-busy={pendente || undefined}
          onClick={aoConfirmar}
        >
          <Undo2 aria-hidden />
          {pendente
            ? TEXTOS_DO_DEVOLVER.devolvendo
            : TEXTOS_DO_DEVOLVER.devolver}
        </Button>
      </DialogFooter>
    </>
  );
}

export function DialogoDoDevolver({
  aberto,
  pendente,
  aoConfirmar,
  aoFechar,
}: {
  aberto: boolean;
  pendente: boolean;
  aoConfirmar: () => void;
  aoFechar: () => void;
}) {
  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => (!abrir && !pendente ? aoFechar() : null)}
    >
      <DialogContent className="sm:max-w-[480px]">
        <ConfirmacaoDoDevolver
          pendente={pendente}
          aoConfirmar={aoConfirmar}
          aoCancelar={aoFechar}
        />
      </DialogContent>
    </Dialog>
  );
}
