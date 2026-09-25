"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import {
  Ban,
  FileText,
  Image as ImageIcon,
  Mic,
  Video,
  type LucideIcon,
} from "lucide-react";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { SeloDoNumero } from "@/components/atendimento/selo-do-numero";
import { ChipDeEtiqueta } from "@/components/shared/chip-de-etiqueta";
import { StatusChip } from "@/components/shared/status-chip";
import type { EstadoVisualDaConversa } from "@/lib/design/status";
import type { ChipDeEtiquetaDados } from "@/lib/domain/etiquetas-de-conversa";
import { diaCivil } from "@/lib/domain/horarios";
import type { NumeroDaConversa } from "@/lib/domain/numeros-do-inbox";
import { formatarTelefone } from "@/lib/domain/telefone";
import type {
  ConversationListItem,
  TipoDaPrevia,
} from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";

// Cartao de conversa da lista (design system Conduzza, docs/06 secao 5.3):
// linha 1 nome e hora, linha 2 previa da ultima mensagem e nao lidas, linha 3
// estado (quem atende), o numero da clinica (so com mais de um, docs/07) e
// etiquetas compactas. Selecionado em lime suave com a borda de 2px a
// esquerda; sem ponto vermelho, sem selo de canal.

/**
 * Hora do cartao NO FUSO DA CLINICA (regra 3.6): "HH:mm" quando e hoje la,
 * "dd/MM" nos outros dias. Um navegador em outro fuso ve a mesma hora que a
 * recepcao.
 */
export function horaDoCartao(
  valor: string | null,
  timezone: string,
  agora: number,
): string {
  if (!valor) {
    return "";
  }
  const quando = new Date(valor);
  if (Number.isNaN(quando.getTime())) {
    return "";
  }
  const local = new TZDate(quando.getTime(), timezone);
  const hoje =
    diaCivil(timezone, quando) === diaCivil(timezone, new Date(agora));
  return format(local, hoje ? "HH:mm" : "dd/MM");
}

// Midia na previa: icone de forma e rotulo escrito (o texto e a legenda,
// quando houver; senao o nome do tipo).
const MIDIA: Partial<
  Record<TipoDaPrevia, { icone: LucideIcon; rotulo: string }>
> = {
  imagem: { icone: ImageIcon, rotulo: "Foto" },
  video: { icone: Video, rotulo: "Vídeo" },
  audio: { icone: Mic, rotulo: "Áudio" },
  documento: { icone: FileText, rotulo: "Documento" },
};

/**
 * Quem escreveu a mensagem da previa, quando NAO foi o paciente (achado L2 da
 * revisao da leva 2). Sem isto, a resposta da clinica aparecia no cartao como
 * se fosse a fala do paciente. "Voce:" so quando a pessoa da equipe que
 * escreveu e quem esta olhando; qualquer outra pessoa da equipe, e o envio
 * automatico, viram "Clinica:". Sem mensagem visivel (reserva), sem prefixo.
 */
export function prefixoDaPrevia(
  conversation: Pick<
    ConversationListItem,
    "last_preview_kind" | "last_preview_author" | "last_preview_author_user_id"
  >,
  viewerId: string,
): string | null {
  if (!conversation.last_preview_kind) {
    return null;
  }
  switch (conversation.last_preview_author) {
    case "usuario":
      return conversation.last_preview_author_user_id === viewerId
        ? "Você:"
        : "Clínica:";
    case "sistema":
      return "Clínica:";
    case "ia":
      return "IA:";
    default:
      return null;
  }
}

/**
 * Rotulo acessivel (e dica) da hora do cartao. A hora e a da ultima fala do
 * PACIENTE, que e a chave de ordenacao da lista; quando a previa e de outra
 * pessoa, o prefixo da previa ja diz isso, e a dica deixa claro de que
 * mensagem e a hora.
 */
export function rotuloDaHora(
  conversation: Pick<ConversationListItem, "last_inbound_at">,
  hora: string,
): string {
  const quando = hora.includes("/") ? `em ${hora}` : `às ${hora}`;
  return conversation.last_inbound_at
    ? `Última mensagem do paciente ${quando}`
    : `Última mensagem ${quando}`;
}

function Previa({
  conversation,
  reserva,
}: {
  conversation: ConversationListItem;
  reserva: string;
}) {
  const tipo = conversation.last_preview_kind;
  const texto = conversation.last_preview;
  if (tipo === "apagada") {
    return (
      <>
        <Ban aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate italic">Mensagem apagada</span>
      </>
    );
  }
  const midia = tipo ? MIDIA[tipo] : undefined;
  if (midia) {
    const Icone = midia.icone;
    return (
      <>
        <Icone aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {texto ? (
            <>
              <span className="sr-only">{midia.rotulo}: </span>
              {texto}
            </>
          ) : (
            midia.rotulo
          )}
        </span>
      </>
    );
  }
  return <span className="min-w-0 truncate">{texto ?? reserva}</span>;
}

export function ConversationCard({
  conversation,
  estado,
  reserva,
  etiquetas,
  selected,
  viewerId,
  timezone,
  agora,
  onSelect,
  numero = null,
}: {
  conversation: ConversationListItem;
  /** estadoVisualDaConversa: o MESMO helper do cabecalho do fio */
  estado: EstadoVisualDaConversa;
  /**
   * O numero da clinica desta conversa, quando a tela deve mostrar
   * (numeroParaMostrar): mais de um numero ativo, ou numero removido.
   */
  numero?: NumeroDaConversa | null;
  /** "Paciente · Etapa", quando nao ha previa de mensagem */
  reserva: string;
  /** Ja resolvidas e ordenadas pela lista. */
  etiquetas: ChipDeEtiquetaDados[];
  selected: boolean;
  /** Quem olha: a previa escrita por esta pessoa sai com "Voce:" */
  viewerId: string;
  timezone: string;
  agora: number;
  onSelect: () => void;
}) {
  const naoLidas = conversation.unread_count;
  const prefixo = prefixoDaPrevia(conversation, viewerId);
  // Com o selo do numero na linha 3, cabe uma etiqueta so antes do "+N".
  const etiquetasVisiveis = numero ? 1 : 2;
  // A hora exibida e a MESMA que ordena a lista. Mostrar a atividade e
  // ordenar pelo recebimento faria a coluna parecer embaralhada; o prefixo
  // da previa e o rotulo da hora dizem de que mensagem e cada uma.
  const hora = horaDoCartao(
    conversation.last_inbound_at ?? conversation.last_message_at,
    timezone,
    agora,
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "grid w-full grid-cols-[auto_minmax(0,1fr)] gap-2.5 border-b border-l-2 border-b-border px-3.5 py-[11px] text-left cz-transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
        selected
          ? "border-l-primary-edge bg-primary-soft"
          : "border-l-transparent bg-card hover:bg-surface-subtle",
      )}
    >
      <ContactAvatar
        name={conversation.contact.name}
        phone={conversation.contact.phone_e164}
        size={36}
      />
      {/* grid-cols-[minmax(0,1fr)]: sem a trilha limitada, a coluna crescia
          ate a largura da previa inteira (ate 120 caracteres) e empurrava a
          hora para fora do cartao. Cada linha tambem leva min-w-0. */}
      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-[3px]">
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13.5px] text-text-strong",
              naoLidas > 0 ? "font-bold" : "font-semibold",
              // Sem nome, o telefone ocupa o lugar do nome: numero em mono.
              !conversation.contact.name && "cz-num",
            )}
          >
            {conversation.contact.name ??
              formatarTelefone(conversation.contact.phone_e164)}
          </span>
          {hora ? (
            <span
              className="shrink-0 cz-num text-[11px] text-text-tertiary"
              title={rotuloDaHora(conversation, hora)}
            >
              <span aria-hidden>{hora}</span>
              <span className="sr-only">
                {`, ${rotuloDaHora(conversation, hora)}`}
              </span>
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="flex min-w-0 flex-1 items-center gap-1 text-[12.5px] text-text-secondary">
            {prefixo ? (
              // Quem escreveu, em texto (nunca so cor): a resposta da clinica
              // nao passa por fala do paciente.
              <span className="shrink-0 font-semibold text-text-tertiary">
                {prefixo}
              </span>
            ) : null}
            <Previa conversation={conversation} reserva={reserva} />
          </span>
          {naoLidas > 0 ? (
            // Tinta, e nao lime: a tela so tem um preenchimento lime no
            // corpo (a acao principal), e cada cartao com nao lida seria
            // mais um.
            <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-inverse px-[5px] cz-num text-[10.5px] font-bold text-inverse-foreground">
              {naoLidas}
              <span className="sr-only"> não lidas</span>
            </span>
          ) : null}
        </span>
        <span className="mt-px flex min-w-0 items-center gap-[5px] overflow-hidden">
          <StatusChip
            size="sm"
            definition={estado.definition}
            label={estado.label}
            avatarInitials={estado.avatarInitials}
            className="shrink-0"
          />
          {numero ? (
            <SeloDoNumero numero={numero} className="max-w-[112px]" />
          ) : null}
          {etiquetas.slice(0, etiquetasVisiveis).map((etiqueta) => (
            <ChipDeEtiqueta
              key={etiqueta.chave}
              nome={etiqueta.nome}
              tom={etiqueta.tom}
              tamanho="compacto"
              className="max-w-[92px]"
            />
          ))}
          {etiquetas.length > etiquetasVisiveis ? (
            <>
              <span
                aria-hidden
                className="inline-flex h-[18px] shrink-0 items-center rounded-[4px] bg-surface-4 px-1.5 cz-num text-[10.5px] font-medium text-foreground"
              >
                +{etiquetas.length - etiquetasVisiveis}
              </span>
              {/* O "+2" visual nao e acessivel sozinho (e title nao funciona
                  em toque): o leitor de tela ouve o nome das que sobraram. */}
              <span className="sr-only">
                , mais{" "}
                {etiquetas
                  .slice(etiquetasVisiveis)
                  .map((e) => e.nome)
                  .join(", ")}
              </span>
            </>
          ) : null}
        </span>
      </span>
    </button>
  );
}
