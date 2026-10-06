"use client";

import { CircleAlert, Pencil, Send, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { MarcadorDoNumero } from "@/components/shared/marcador-do-numero";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MENSAGEM_AGENDADA_STATUS } from "@/lib/design/status";
import {
  assinaturaDoItem,
  avisosDoItem,
  linhaDaAtividade,
  linhaDoEstadoDoItem,
  quandoEmTexto,
  rotuloDoDispensar,
  textoAcessivelDeQuando,
  textoDeQuandoSai,
  type Acao,
  type AcoesDoItem,
  type AgendadaDaLista,
  type ContextoDaListaDeAgendadas,
  type EstadoDoItemDaAgendada,
} from "@/lib/domain/mensagem-agendada";
import { cn } from "@/lib/utils";

// Um item da lista de mensagens agendadas (secao 4.4 do desenho, com A1 e
// A3 do desenho final). Status em 3 camadas pelo chip do mapa
// MENSAGEM_AGENDADA_STATUS; o texto em 2 linhas com "Ver tudo"; a linha de
// quando e de quem; a linha do estado; os avisos; e as acoes de 40px, que
// ficam visiveis e desabilitadas com a dica quando a pessoa nao pode usar.
// O nome acessivel de cada acao leva a data ("Editar a mensagem agendada
// para 08/10 às 11:00"): com varias na lista, "Editar" sozinho nao diz qual.
// O texto aberto ("Ver tudo") tem teto e rolagem propria: um texto de 4096
// caracteres nao empurra o "Ver menos" nem o compositor para fora da tela
// (achado 11 da revisao).

// Texto que provavelmente passa de 2 linhas, antes de medir (e no HTML do
// servidor, que nao mede nada).
const CARACTERES_DE_DUAS_LINHAS = 160;

function pareceLongo(texto: string): boolean {
  return (
    texto.length > CARACTERES_DE_DUAS_LINHAS ||
    (texto.match(/\n/g)?.length ?? 0) >= 2
  );
}

export type ItemDeAgendadaProps = {
  agendada: AgendadaDaLista;
  estado: EstadoDoItemDaAgendada;
  acoes: AcoesDoItem;
  contexto: ContextoDaListaDeAgendadas;
  agora: number;
  timezone: string;
  viewerId: string;
  nomes: Record<string, string>;
  /** Nome do contato (ou o telefone formatado) */
  contato: string | null;
  /** A clinica tem mais de um numero ativo: o item diz por qual sai */
  mostrarNumero: boolean;
  /** Uma acao deste item esta em curso */
  ocupado: boolean;
  aoEditar: () => void;
  aoExcluir: () => void;
  aoEnviarAgora: () => void;
  aoAgendarDeNovo: () => void;
  aoDispensar: () => void;
  aoVerNaConversa: () => void;
};

/** Botao de icone de 40px com dica; desabilitado, a dica diz por que. */
function BotaoDeIcone({
  acao,
  rotulo,
  dica,
  icone: Icone,
  aoClicar,
  ocupado,
}: {
  acao: Acao;
  rotulo: string;
  dica: string;
  icone: typeof Pencil;
  aoClicar: () => void;
  ocupado: boolean;
}) {
  if (!acao.visivel) {
    return null;
  }
  if (!acao.habilitada) {
    return (
      <DisabledWithHint hint={acao.dica ?? dica}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-text-secondary"
          aria-label={rotulo}
          disabled
        >
          <Icone aria-hidden className="size-[17px]" />
        </Button>
      </DisabledWithHint>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-text-secondary"
          aria-label={rotulo}
          disabled={ocupado}
          onClick={aoClicar}
        >
          <Icone aria-hidden className="size-[17px]" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{dica}</TooltipContent>
    </Tooltip>
  );
}

/** Botao de texto (sm, com area de toque de 40px pelo hit-40). */
function BotaoDeTexto({
  acao,
  rotulo,
  nomeAcessivel,
  aoClicar,
  ocupado,
}: {
  acao: Acao;
  rotulo: string;
  nomeAcessivel: string;
  aoClicar: () => void;
  ocupado: boolean;
}) {
  if (!acao.visivel) {
    return null;
  }
  const botao = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={nomeAcessivel}
      disabled={!acao.habilitada || ocupado}
      onClick={acao.habilitada ? aoClicar : undefined}
    >
      {rotulo}
    </Button>
  );
  return acao.habilitada ? (
    botao
  ) : (
    <DisabledWithHint hint={acao.dica ?? rotulo}>{botao}</DisabledWithHint>
  );
}

export function ItemDeAgendada({
  agendada: a,
  estado,
  acoes,
  contexto,
  agora,
  timezone,
  viewerId,
  nomes,
  contato,
  mostrarNumero,
  ocupado,
  aoEditar,
  aoExcluir,
  aoEnviarAgora,
  aoAgendarDeNovo,
  aoDispensar,
  aoVerNaConversa,
}: ItemDeAgendadaProps) {
  const definicao = MENSAGEM_AGENDADA_STATUS[estado];
  const numero = contexto.conexaoPorNumero[a.whatsappAccountId] ?? null;
  const assinatura = assinaturaDoItem(
    a,
    nomes,
    viewerId,
    contexto.membrosComEscrita,
  );
  const linhaDoEstado = linhaDoEstadoDoItem(a, estado, {
    ctx: contexto,
    agora,
    fuso: timezone,
    contato,
  });
  const atividade = linhaDaAtividade(a, estado, {
    nomes,
    viewerId,
    membrosComEscrita: contexto.membrosComEscrita,
  });
  const avisos = avisosDoItem(a, estado, {
    ctx: contexto,
    contato,
    agora,
    fuso: timezone,
  });
  // "hoje às 11:00", "08/10 às 11:00": entra no nome acessivel das acoes.
  const quando = quandoEmTexto(a.enviarEm, agora, timezone);

  const texto = a.texto?.trim() ? a.texto : null;
  const [inteiro, setInteiro] = useState(false);
  const [cortado, setCortado] = useState(() =>
    texto ? pareceLongo(texto) : false,
  );
  const textoRef = useRef<HTMLParagraphElement>(null);
  // Mede de verdade depois de montar: o "Ver tudo" so aparece quando o texto
  // passa das 2 linhas na largura atual.
  useLayoutEffect(() => {
    const elemento = textoRef.current;
    if (!elemento || inteiro) {
      return;
    }
    const medir = () =>
      setCortado(elemento.scrollHeight > elemento.clientHeight + 1);
    medir();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [texto, inteiro]);

  return (
    <li
      tabIndex={-1}
      data-agendada={a.id}
      data-estado={estado}
      className="grid gap-2 rounded-xl border border-border bg-card px-3 py-2.5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
    >
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <StatusChip size="sm" definition={definicao} />
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] text-text-secondary">
            {estado === "agendada" ? (
              <>
                <span
                  aria-hidden
                  className="cz-num font-semibold text-text-strong"
                >
                  {textoDeQuandoSai(a.enviarEm, agora, timezone)}
                </span>
                <span className="sr-only">
                  {textoAcessivelDeQuando(a.enviarEm, agora, timezone)}.
                </span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            <span className="min-w-0">{assinatura}</span>
            {mostrarNumero && numero ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex min-w-0 items-center gap-1">
                  <MarcadorDoNumero cor={numero.cor} />
                  <span className="min-w-0 truncate">
                    pelo número {numero.nome}
                  </span>
                </span>
              </>
            ) : null}
          </p>
        </div>

        {linhaDoEstado ? (
          <p className="text-[12.5px] leading-snug text-text-strong">
            {linhaDoEstado}
          </p>
        ) : null}

        {texto ? (
          <div className="grid gap-0.5">
            <p
              ref={textoRef}
              // Aberto, o texto rola sozinho: o foco pelo teclado precisa
              // alcancar a rolagem.
              tabIndex={inteiro ? 0 : undefined}
              className={cn(
                "text-[13px] leading-normal break-words whitespace-pre-wrap text-foreground",
                inteiro
                  ? "cz-scroll max-h-48 overflow-y-auto overscroll-contain rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                  : "line-clamp-2",
              )}
            >
              {texto}
            </p>
            {cortado || inteiro ? (
              <button
                type="button"
                aria-expanded={inteiro}
                onClick={() => setInteiro((atual) => !atual)}
                className="hit-40 relative w-fit rounded-sm text-[12px] font-semibold text-text-secondary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
              >
                {inteiro ? "Ver menos" : "Ver tudo"}
              </button>
            ) : null}
          </div>
        ) : null}

        {avisos.map((aviso) => (
          <p
            key={aviso.chave}
            className="flex items-start gap-1.5 text-[12.5px] leading-snug text-warning-text"
          >
            <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>{aviso.texto}</span>
          </p>
        ))}

        {atividade ? (
          <p className="text-[12.5px] leading-snug text-text-secondary">
            {atividade}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1 sm:justify-end">
        <BotaoDeIcone
          acao={acoes.editar}
          rotulo={`Editar a mensagem agendada para ${quando}`}
          dica="Editar"
          icone={Pencil}
          aoClicar={aoEditar}
          ocupado={ocupado}
        />
        <BotaoDeIcone
          acao={acoes.enviarAgora}
          rotulo={`Enviar agora a mensagem agendada para ${quando}`}
          dica="Enviar agora"
          icone={Send}
          aoClicar={aoEnviarAgora}
          ocupado={ocupado}
        />
        <BotaoDeIcone
          acao={acoes.excluir}
          rotulo={`Excluir a mensagem agendada para ${quando}`}
          dica="Excluir"
          icone={Trash2}
          aoClicar={aoExcluir}
          ocupado={ocupado}
        />
        <BotaoDeTexto
          acao={acoes.agendarDeNovo}
          rotulo="Agendar de novo"
          nomeAcessivel={`Agendar de novo a mensagem marcada para ${quando}`}
          aoClicar={aoAgendarDeNovo}
          ocupado={ocupado}
        />
        <BotaoDeTexto
          acao={acoes.dispensar}
          rotulo={rotuloDoDispensar(estado)}
          nomeAcessivel={`${rotuloDoDispensar(estado)} a mensagem marcada para ${quando}`}
          aoClicar={aoDispensar}
          ocupado={ocupado}
        />
        {estado === "enviada" && a.messageId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Ver na conversa a mensagem enviada ${quandoEmTexto(a.enviadaEm ?? a.enviarEm, agora, timezone)}`}
            onClick={aoVerNaConversa}
          >
            Ver na conversa
          </Button>
        ) : null}
      </div>
    </li>
  );
}
