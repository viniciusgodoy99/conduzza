"use client";

import {
  AudioLines,
  FileText,
  Image as ImageIcon,
  Lock,
  Video,
} from "lucide-react";

import type { MessageItem, QuotedMessage } from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// A previa da mensagem citada, no padrao do WhatsApp: uma faixa com barra
// colorida a esquerda, o nome de quem escreveu e um resumo de uma linha.
//
// O MESMO componente aparece em dois lugares, e isso e deliberado: dentro da
// bolha (mostrando o que aquela mensagem respondeu) e acima do compositor
// (mostrando o que voce esta prestes a responder). Se fossem dois desenhos
// diferentes, a pessoa nao reconheceria que e a mesma coisa.

/** Como uma mensagem se resume a uma linha, quando citada. */
export function resumoDaCitacao(
  mensagem: Pick<QuotedMessage, "content_type" | "body" | "deleted_at">,
): { rotulo: string; Icone: typeof ImageIcon | null } {
  if (mensagem.deleted_at) {
    return { rotulo: "Mensagem apagada", Icone: null };
  }
  const corpo = mensagem.body?.trim();
  switch (mensagem.content_type) {
    case "imagem":
      return { rotulo: corpo || "Foto", Icone: ImageIcon };
    case "audio":
      return { rotulo: corpo || "Áudio", Icone: AudioLines };
    case "documento":
      return { rotulo: corpo || "Documento", Icone: FileText };
    default:
      // Video chega como 'texto' com arquivo, porque o enum do banco nao o
      // preve. Sem este caso, um video citado apareceria como linha vazia.
      return corpo
        ? { rotulo: corpo, Icone: null }
        : { rotulo: "Vídeo", Icone: Video };
  }
}

/** Quem escreveu a citada, do jeito que a recepção fala. */
export function autorDaCitacao(
  mensagem: Pick<QuotedMessage, "author" | "author_user_id">,
  contato: string,
  nomes: Record<string, string>,
): string {
  if (mensagem.author === "paciente") {
    return contato;
  }
  if (mensagem.author === "ia") {
    return "Assistente";
  }
  if (mensagem.author_user_id) {
    // Nome genérico, e não "Você", quando o mapa não tem a pessoa. O mapa vem
    // do servidor e não é atualizado numa aba aberta, então uma colega
    // aprovada depois de a tela carregar cairia aqui: a citação da mensagem
    // DELA apareceria assinada como se fosse sua.
    return nomes[mensagem.author_user_id] ?? "Atendente";
  }
  return "Sistema";
}

export function BlocoDeCitacao({
  autor,
  mensagem,
  aoClicar,
  className,
}: {
  autor: string;
  mensagem: Pick<
    QuotedMessage,
    "content_type" | "body" | "deleted_at" | "is_internal_note"
  >;
  /** presente quando dá para rolar até o original */
  aoClicar?: () => void;
  className?: string;
}) {
  const { rotulo, Icone } = resumoDaCitacao(mensagem);
  const Container = aoClicar ? "button" : "div";
  // Cores proprias, e nao herdadas da bolha: a faixa tem fundo afundado e
  // aparece dentro de qualquer pele (inclusive a de tinta da IA) e acima do
  // compositor. Texto forte e secundario sobre surface-4 passam AA nos dois
  // temas; a cor de apoio da bolha nao passaria sobre esse fundo.
  return (
    <Container
      type={aoClicar ? "button" : undefined}
      onClick={aoClicar}
      className={cn(
        "grid w-full min-w-0 gap-0.5 rounded-md border-l-[3px] border-l-primary-edge bg-surface-4 py-1 pr-2 pl-2 text-left",
        mensagem.is_internal_note && "border-l-(--warning-text)",
        aoClicar &&
          "cursor-pointer cz-transition hover:bg-surface-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
        className,
      )}
    >
      <span className="flex items-center gap-1 text-[11px] font-semibold text-text-strong">
        {mensagem.is_internal_note ? (
          <Lock aria-hidden className="size-3 shrink-0" />
        ) : null}
        {autor}
      </span>
      <span className="flex min-w-0 items-center gap-1 text-xs text-text-secondary">
        {Icone ? <Icone aria-hidden className="size-3 shrink-0" /> : null}
        <span className="truncate">{rotulo}</span>
      </span>
    </Container>
  );
}

/**
 * A citada existe no WhatsApp, mas nunca virou linha nossa.
 *
 * Acontece de verdade: o paciente responde a uma mensagem anterior a conexao
 * da clinica, ou a uma que o webhook perdeu. Mostrar a faixa vazia seria
 * mentir por omissao, e nao mostrar nada apagaria o fato de que ele respondeu
 * a alguma coisa.
 */
export function CitacaoForaDoHistorico({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md border-l-[3px] border-l-border-heavy bg-surface-4 py-1 pr-2 pl-2",
        className,
      )}
    >
      <span className="text-xs text-text-secondary">
        Respondendo a uma mensagem que não está neste histórico
      </span>
    </div>
  );
}

/** A citação de uma mensagem, quando houver alguma. */
export function CitacaoDaBolha({
  message,
  contato,
  nomes,
  aoIrParaCitada,
  citadaEstaNaTela = false,
}: {
  message: MessageItem;
  contato: string;
  nomes: Record<string, string>;
  aoIrParaCitada?: (id: string) => void;
  /**
   * A mensagem citada está entre as que já foram carregadas?
   *
   * O fio pagina de 50 em 50, e citar algo de semanas atrás é comum. Sem esta
   * conferência o bloco virava um botão com aparência e realce de clicável que
   * não fazia absolutamente nada: rolar até a citada só funciona se a bolha
   * existir no documento. Promessa que a tela não cumpre é pior que ausência
   * de promessa.
   */
  citadaEstaNaTela?: boolean;
}) {
  if (message.reply_to) {
    const citada = message.reply_to;
    return (
      <BlocoDeCitacao
        autor={autorDaCitacao(citada, contato, nomes)}
        mensagem={citada}
        aoClicar={
          aoIrParaCitada && citadaEstaNaTela
            ? () => aoIrParaCitada(citada.id)
            : undefined
        }
        className="mb-0.5"
      />
    );
  }
  if (message.reply_to_wa_message_id) {
    return <CitacaoForaDoHistorico className="mb-0.5" />;
  }
  return null;
}
