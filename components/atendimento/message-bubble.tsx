"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AudioLines,
  CircleSlash,
  CornerUpLeft,
  FileText,
  Image as ImageIcon,
  Lock,
  MoreVertical,
  ShieldAlert,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CartaoDeDocumento } from "@/components/atendimento/media/cartao-de-documento";
import { impedimentoParaTodos } from "@/components/atendimento/dialogo-apagar";
import { CitacaoDaBolha } from "@/components/atendimento/citacao";
import { FotoDaConversa } from "@/components/atendimento/media/foto-da-conversa";
import { PlayerDeAudio } from "@/components/atendimento/media/player-de-audio";
import type {
  ComplianceDecision,
  MessageItem,
} from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Bolhas da conversa (handoff): paciente a esquerda (raio 4/14/14/14), IA e
// humano a direita (14/4/14/14), largura maxima 74%. A bolha da IA carrega
// rotulo textual e selo, nunca so cor. Nota interna em ambar com cadeado.

function hour(value: string): string {
  return format(new Date(value), "HH:mm", { locale: ptBR });
}

export function SystemEventCard({ message }: { message: MessageItem }) {
  return (
    <div className="flex justify-center">
      <span className="rounded-full bg-surface-3 px-3 py-1 text-[11.5px] text-text-secondary">
        {message.body} · {hour(message.created_at)}
      </span>
    </div>
  );
}

export function ComplianceBlockCard({
  decision,
}: {
  decision: ComplianceDecision;
}) {
  const RULE_LABEL: Record<string, string> = {
    triagem: "triagem de sintoma",
    promessa_resultado: "promessa de resultado",
    medicamento: "indicação de medicamento",
    oferta_casada: "oferta casada",
  };
  return (
    <div className="flex justify-center">
      <div className="grid max-w-md gap-2 rounded-lg border [border-color:var(--alert)] px-4 py-3 [background:var(--alert-bg)]">
        <p className="flex items-center gap-2 text-[12.5px] font-semibold [color:var(--alert-text)]">
          <ShieldAlert strokeWidth={1.5} className="size-4 shrink-0" />
          Resposta da IA bloqueada pela conformidade
        </p>
        <p className="text-[12.5px] text-text-secondary">
          Motivo:{" "}
          {RULE_LABEL[decision.compliance_rule ?? ""] ??
            "regra de conformidade"}
          . A conversa foi passada para a recepção.
        </p>
        {decision.blocked_draft ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-fit [color:var(--alert-text)]"
              >
                Ver o que a IA ia responder
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rascunho bloqueado</DialogTitle>
                <DialogDescription>
                  Registrado para auditoria. Este texto nunca foi enviado ao
                  paciente.
                </DialogDescription>
              </DialogHeader>
              <p className="rounded-lg bg-surface-3 p-3 text-sm">
                {decision.blocked_draft}
              </p>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}

function AudioBody({ message }: { message: MessageItem }) {
  const [expanded, setExpanded] = useState(false);
  const pronto = arquivoPronto(message);
  return (
    <div className="grid gap-1.5">
      {pronto ? (
        <PlayerDeAudio messageId={message.id} />
      ) : (
        <span className="flex items-center gap-1.5 text-[12.5px] text-text-secondary">
          <AudioLines strokeWidth={1.5} className="size-4" />
          Áudio{" "}
          {message.media_url?.startsWith("seed://")
            ? "(indisponível na demonstração)"
            : "(baixando)"}
        </span>
      )}
      {/* A legenda que a atendente escreveu junto com o audio: ela FOI para o
          paciente, entao precisa aparecer aqui tambem. */}
      {message.body ? (
        <p className="text-[13px] leading-[1.45] whitespace-pre-wrap">
          {message.body}
        </p>
      ) : null}
      {message.transcript ? (
        <div className="grid gap-1">
          <p
            className={cn(
              "text-[13px] leading-relaxed",
              !expanded && "line-clamp-2",
            )}
          >
            <span className="text-text-tertiary">Transcrição: </span>
            {message.transcript}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="w-fit text-[11.5px] text-text-secondary underline-offset-2 hover:underline"
          >
            {expanded ? "ver menos" : "ver mais"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A mensagem carrega arquivo?
 *
 * Precisa olhar `media_url` e nao so `content_type`, por um motivo concreto:
 * o parser de entrada mapeia VIDEO para 'texto' (lib/integrations/whatsapp/
 * inbound.ts nao tem caso para video, e o enum do banco tambem nao o preve).
 * Sem esta checagem, todo video recebido continuaria como bolha vazia, que e
 * exatamente o defeito que este componente esta corrigindo.
 */
function ehMidia(message: MessageItem): boolean {
  if (
    message.content_type === "imagem" ||
    message.content_type === "documento"
  ) {
    return true;
  }
  return message.content_type === "texto" && Boolean(message.media_url);
}

/**
 * O arquivo esta guardado e servivel?
 *
 * media_url passa por tres estados: a URL criptografada do provedor (assim que
 * a mensagem chega), `storage://...` (depois que o job de download rodou) e
 * `seed://...` (dado de demonstracao). So o segundo tem arquivo nosso para
 * entregar.
 */
function arquivoPronto(message: MessageItem): boolean {
  return message.media_url?.startsWith("storage://") ?? false;
}

function MidiaBody({ message }: { message: MessageItem }) {
  const demonstracao = message.media_url?.startsWith("seed://") ?? false;

  if (arquivoPronto(message)) {
    if (message.content_type === "documento") {
      return (
        <CartaoDeDocumento
          messageId={message.id}
          nomeDoArquivo={message.body}
        />
      );
    }
    // Video chega como content_type 'texto' com media_url, porque o enum do
    // banco nao preve 'video'. Sem este ramo, ele ficava para sempre em
    // "Baixando o arquivo" mesmo com o arquivo pronto no balde.
    if (message.content_type === "texto") {
      return (
        <div className="grid gap-1.5">
          <video
            src={`/api/atendimento/midia/${message.id}`}
            controls
            preload="metadata"
            className="max-h-[280px] w-[240px] rounded-md bg-surface-3"
          />
          {message.body ? (
            <p className="text-[13px] leading-[1.45] whitespace-pre-wrap">
              {message.body}
            </p>
          ) : null}
        </div>
      );
    }
    if (message.content_type === "imagem") {
      return (
        <div className="grid gap-1.5">
          <FotoDaConversa messageId={message.id} legenda={message.body} />
          {message.body ? (
            <p className="text-[13px] leading-[1.45] whitespace-pre-wrap">
              {message.body}
            </p>
          ) : null}
        </div>
      );
    }
  }

  const { Icone, rotulo } =
    message.content_type === "imagem"
      ? { Icone: ImageIcon, rotulo: "Foto recebida" }
      : message.content_type === "documento"
        ? { Icone: FileText, rotulo: "Documento recebido" }
        : { Icone: Video, rotulo: "Vídeo recebido" };

  return (
    <div className="grid gap-1">
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-secondary">
        <Icone strokeWidth={1.5} className="size-4 shrink-0" />
        {rotulo}
      </span>
      {message.body ? (
        <p className="text-[13px] leading-[1.45] whitespace-pre-wrap">
          {message.body}
        </p>
      ) : null}
      <span className="text-[11.5px] text-text-tertiary">
        {demonstracao ? "Indisponível na demonstração" : "Baixando o arquivo"}
      </span>
    </div>
  );
}

/**
 * A lapide de uma mensagem apagada.
 *
 * NUNCA some da conversa. Sumir por completo faria uma atendente conseguir
 * tirar uma mensagem da tela sem deixar rastro nenhum para a colega, e este e
 * um sistema onde varias pessoas atendem o mesmo paciente. O conteudo foi para
 * o cofre; o que fica aqui e o fato de que existiu e quem apagou.
 *
 * O escopo importa muito na redacao: "apagada so aqui" significa que o
 * paciente CONTINUA VENDO a mensagem no celular dele. Uma atendente que leia
 * "apagada" e conclua que sumiu de todo lugar pode escrever a proxima mensagem
 * contando com um contexto que o paciente nao tem.
 */
function Lapide({
  message,
  authorNames,
  viewerId,
}: {
  message: MessageItem;
  authorNames: Record<string, string>;
  viewerId: string;
}) {
  const soAqui = message.deleted_escopo === "local";
  // Nota interna nunca saiu da clínica, então "o paciente ainda vê" seria
  // exatamente o contrário da verdade sobre ela.
  const nota = message.is_internal_note;
  const quem =
    message.deleted_source === "paciente"
      ? "O paciente apagou"
      : message.deleted_by === viewerId
        ? "Você apagou"
        : message.deleted_by
          ? `${authorNames[message.deleted_by] ?? "A clínica"} apagou`
          : "A clínica apagou";
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-text-tertiary italic">
      <CircleSlash strokeWidth={1.5} className="size-4 shrink-0" />
      {soAqui && !nota
        ? `${quem} esta mensagem só aqui. O paciente ainda vê.`
        : nota
          ? `${quem} esta nota interna.`
          : `${quem} esta mensagem.`}
    </span>
  );
}

/** O menu de ações da bolha: responder e apagar. */
const MOTIVO_SEM_APAGAR =
  "Só quem escreveu a mensagem pode apagar. Um administrador ou gestor também pode.";

function AcoesDaBolha({
  podeResponder,
  podeApagar,
  motivoSemPermissao,
  onResponder,
  onApagar,
}: {
  podeResponder: boolean;
  podeApagar: boolean;
  motivoSemPermissao: string;
  onResponder: () => void;
  onApagar: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Ações da mensagem"
          // Aparece no toque desde sempre (celular nao tem passar o mouse) e
          // no computador quando o cursor ou o teclado chegam na bolha.
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full text-text-tertiary",
            "hover:bg-surface-3 hover:text-text-secondary",
            "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            "sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100",
            "data-[state=open]:opacity-100",
          )}
        >
          <MoreVertical strokeWidth={1.5} className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={onResponder} disabled={!podeResponder}>
          <CornerUpLeft strokeWidth={1.5} className="size-4" />
          Responder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onApagar} disabled={!podeApagar}>
          <Trash2 strokeWidth={1.5} className="size-4" />
          Apagar
        </DropdownMenuItem>
        {/* O motivo fica VISÍVEL no menu, e não num title.
            A regra 5 do CLAUDE.md pede ação desabilitada com dica, e o title
            não cumpria isso em lugar nenhum: o item desabilitado recebe
            pointer-events-none (o navegador nunca dispara o tooltip) e o Radix
            o tira da ordem de foco (o teclado nunca chega nele). O motivo era
            inalcançável para todo mundo. */}
        {!podeResponder || !podeApagar ? (
          <p className="border-t border-border px-2 pt-1.5 pb-1 text-[11.5px] leading-snug text-text-secondary">
            {!podeResponder ? motivoSemPermissao : MOTIVO_SEM_APAGAR}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MessageBubble({
  message,
  authorName,
  authorNames = {},
  contato = "Paciente",
  viewerId = "",
  podeEditar = false,
  podeResponder = false,
  ehChefia = false,
  onResponder,
  onApagar,
  onIrParaCitada,
  citadaEstaNaTela = false,
}: {
  message: MessageItem;
  authorName: string | null;
  authorNames?: Record<string, string>;
  /** nome do paciente, para nomear a citação de uma mensagem dele */
  contato?: string;
  viewerId?: string;
  /** o papel permite escrever (a matriz de papéis) */
  podeEditar?: boolean;
  /**
   * Dá para responder AGORA: o papel permite e a conversa é sua.
   *
   * Separado de podeEditar porque as duas ações têm donos diferentes. Apagar
   * é sobre a mensagem (quem escreveu, mais a chefia) e vale mesmo com a
   * conversa na mão de outra pessoa: uma mensagem errada precisa sair. Já
   * responder exige a posse, senão duas atendentes escrevem por cima uma da
   * outra.
   */
  podeResponder?: boolean;
  /** administrador ou gestor: apaga mensagem de qualquer pessoa */
  ehChefia?: boolean;
  onResponder?: (message: MessageItem) => void;
  onApagar?: (message: MessageItem) => void;
  onIrParaCitada?: (id: string) => void;
  /** a mensagem citada já está entre as carregadas no fio */
  citadaEstaNaTela?: boolean;
}) {
  if (message.content_type === "evento") {
    return <SystemEventCard message={message} />;
  }

  const fromPatient = message.direction === "entrada";
  const fromIa = message.author === "ia";
  const note = message.is_internal_note;
  const apagada = message.deleted_at !== null;

  // Apagada SÓ AQUI ainda pode ser tirada do celular do paciente.
  //
  // Sem isto, apagar "só aqui" por engano virava beco sem saída: a mensagem
  // seguia no celular do paciente e a tela não oferecia mais ação nenhuma para
  // tirá-la de lá, mesmo com as 60 horas inteiras pela frente.
  const podeAmpliar =
    apagada &&
    message.deleted_escopo === "local" &&
    impedimentoParaTodos(message) === null;

  // Espelha pode_apagar_mensagem no banco. Espelhar NAO e duplicar a regra: o
  // banco continua sendo quem decide, e esta copia existe só para a tela não
  // oferecer um botão que vai falhar. Se as duas divergirem, quem vale é o
  // banco, e o usuário vê a recusa em texto.
  const podeApagar =
    podeEditar &&
    (!apagada || podeAmpliar) &&
    (ehChefia ||
      (message.author_user_id !== null && message.author_user_id === viewerId));
  const mostrarAcoes =
    Boolean(onResponder && onApagar) && (!apagada || podeAmpliar);

  return (
    <div
      id={`mensagem-${message.id}`}
      className={cn(
        "group flex scroll-mt-4 items-center gap-1",
        fromPatient ? "justify-start" : "justify-end",
      )}
    >
      {/* O menu fica do lado de FORA da bolha, e no lado oposto ao dono da
          mensagem, para não cobrir o texto nem empurrar a hora. */}
      {!fromPatient && mostrarAcoes ? (
        <AcoesDaBolha
          podeResponder={podeResponder && !apagada}
          podeApagar={podeApagar}
          motivoSemPermissao={
            apagada
              ? "Mensagem apagada não pode ser citada."
              : podeEditar
                ? "Assuma a conversa antes de responder."
                : "Seu perfil pode acompanhar o atendimento, mas não responder."
          }
          onResponder={() => onResponder?.(message)}
          onApagar={() => onApagar?.(message)}
        />
      ) : null}

      <div
        className={cn(
          "grid max-w-[74%] gap-1 border px-3 py-2",
          fromPatient
            ? "border-border-strong rounded-[4px_14px_14px_14px] bg-card"
            : "rounded-[14px_4px_14px_14px]",
          !fromPatient &&
            !note &&
            (fromIa
              ? "[border-color:var(--ai)] [background:var(--ai-bg)]"
              : "border-transparent bg-surface-4"),
          note &&
            "[border-color:var(--warning)] [background:var(--warning-bg)]",
          // Mensagem apagada perde a cor de autoria: ela não é mais fala de
          // ninguém, é o registro de que houve uma.
          apagada && "border-border-strong border-dashed bg-transparent",
        )}
      >
        {fromIa && !apagada ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold [color:var(--ai-text)]">
            <Sparkles strokeWidth={1.5} className="size-3" />
            {authorName ?? "Assistente"}
            <span className="rounded-full px-1.5 py-px text-[9px] tracking-wide [color:var(--ai-bg)] uppercase [background:var(--ai)]">
              IA
            </span>
          </span>
        ) : null}
        {!fromPatient && !fromIa && authorName && !apagada ? (
          <span
            className={cn(
              "flex items-center gap-1 text-[11px] font-semibold",
              note ? "[color:var(--warning-text)]" : "text-text-secondary",
            )}
          >
            {note ? <Lock strokeWidth={1.5} className="size-3" /> : null}
            {authorName}
            {note ? " · Nota interna, o paciente não vê" : null}
          </span>
        ) : null}

        {apagada ? (
          <Lapide
            message={message}
            authorNames={authorNames}
            viewerId={viewerId}
          />
        ) : (
          <>
            <CitacaoDaBolha
              message={message}
              contato={contato}
              nomes={authorNames}
              aoIrParaCitada={onIrParaCitada}
              citadaEstaNaTela={citadaEstaNaTela}
            />
            {message.content_type === "audio" ? (
              <AudioBody message={message} />
            ) : ehMidia(message) ? (
              <MidiaBody message={message} />
            ) : (
              <p className="text-[13px] leading-[1.45] whitespace-pre-wrap">
                {message.body}
              </p>
            )}
          </>
        )}

        <span
          className={cn(
            "justify-self-end font-mono text-[10.5px] tabular-nums",
            "text-text-tertiary",
          )}
        >
          {hour(message.created_at)}
          {message.delivery_status === "falhou" && !apagada ? (
            <span className="[color:var(--alert-text)]"> · falhou</span>
          ) : null}
        </span>
      </div>

      {fromPatient && mostrarAcoes ? (
        <AcoesDaBolha
          podeResponder={podeResponder && !apagada}
          podeApagar={podeApagar}
          motivoSemPermissao={
            apagada
              ? "Mensagem apagada não pode ser citada."
              : podeEditar
                ? "Assuma a conversa antes de responder."
                : "Seu perfil pode acompanhar o atendimento, mas não responder."
          }
          onResponder={() => onResponder?.(message)}
          onApagar={() => onApagar?.(message)}
        />
      ) : null}
    </div>
  );
}
