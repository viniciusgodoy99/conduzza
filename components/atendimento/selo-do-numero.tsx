import { Smartphone } from "lucide-react";

import { StatusChip } from "@/components/shared/status-chip";
import {
  WHATSAPP_CONNECTION_STATUS,
  type WhatsAppConnectionStatus,
} from "@/lib/design/status";
import { COR_DO_NUMERO_VARS } from "@/lib/domain/cor-do-numero";
import {
  telefoneDoNumero,
  type NumeroDaConversa,
} from "@/lib/domain/numeros-do-inbox";
import { cn } from "@/lib/utils";

// De qual numero da clinica e a conversa (docs/07, decisao 1 do dono: uma
// conversa por numero, e o cartao e o cabecalho mostram o numero). So aparece
// com mais de um numero ativo, ou quando o numero foi removido: quem decide e
// numeroParaMostrar (lib/domain/numeros-do-inbox.ts).
//
// E uma ETIQUETA de origem, nao um status: fundo de cartao, fio e tinta
// neutros, com o icone de celular. O estado da conexao, quando importa, vem
// no ConexaoDoNumero, com as 3 camadas do mapa WHATSAPP_CONNECTION_STATUS.
//
// Cor do numero (pedido do dono em 06/10/2026, whatsapp_account.cor): um
// filete na borda esquerda do selo, um marcador quadrado ao lado do nome e a
// faixa no topo da conversa. A cor so identifica; quem diz qual numero e o
// nome, sempre escrito, e o icone de celular continua neutro (docs/06). O
// numero removido perde a cor (fio neutro).

export function SeloDoNumero({
  numero,
  comTelefone = false,
  className,
}: {
  numero: NumeroDaConversa;
  /** Mostra o telefone pareado depois do nome (cabecalho do fio) */
  comTelefone?: boolean;
  className?: string;
}) {
  const { nome } = numero.numero;
  const removido = numero.estado === "removido";
  const telefone =
    comTelefone && numero.estado === "ativo"
      ? telefoneDoNumero(numero.numero.display_phone)
      : null;
  const titulo = removido
    ? `Número ${nome}, removido da clínica`
    : telefone
      ? `Número ${nome}, ${telefone}`
      : `Número ${nome}`;
  const cor = numero.estado === "ativo" ? numero.numero.cor : null;
  return (
    <span
      title={titulo}
      data-cor={cor ?? "nenhuma"}
      className={cn(
        "inline-flex h-[18px] max-w-full min-w-0 shrink items-center gap-1 overflow-hidden rounded-[4px] border border-l-[3px] border-border bg-card px-1.5 text-[11px] font-medium whitespace-nowrap text-foreground",
        className,
      )}
      style={
        cor ? { borderLeftColor: COR_DO_NUMERO_VARS[cor].marcador } : undefined
      }
    >
      <Smartphone aria-hidden className="size-3 shrink-0 text-text-secondary" />
      <span className="sr-only">Número da clínica: </span>
      <span className="min-w-0 truncate">{nome}</span>
      {removido ? (
        <>
          {" "}
          <span className="shrink-0 text-text-secondary">(removido)</span>
        </>
      ) : null}
      {telefone ? (
        <span
          // O nome do numero vale mais que o telefone: com o fio abaixo de
          // 760px (1366 e 1600 com o painel do contato aberto), o telefone
          // sai da vista e continua para o leitor de tela (sr-only), na dica
          // (title) e em Configuracoes.
          className="min-w-0 truncate cz-num text-text-secondary @max-[759px]/fio:sr-only"
        >
          <span className="sr-only">, </span>
          {telefone}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A faixa no topo da conversa (pedido do dono em 06/10/2026): de qual numero
 * da clinica e esta conversa, com a cor, o nome e o telefone, para a
 * recepcao nao responder achando que esta no numero de outra medica. Larga,
 * logo abaixo do cabecalho, e com a conexao quando o numero esta fora. Some
 * nas mesmas condicoes do selo (numeroParaMostrar).
 */
export function FaixaDoNumero({ numero }: { numero: NumeroDaConversa }) {
  const { nome } = numero.numero;
  const ativo = numero.estado === "ativo" ? numero.numero : null;
  const telefone = ativo ? telefoneDoNumero(ativo.display_phone) : null;
  const cor = ativo ? COR_DO_NUMERO_VARS[ativo.cor] : null;
  return (
    <div
      data-slot="faixa-do-numero"
      data-cor={ativo?.cor ?? "nenhuma"}
      className={cn(
        "flex min-h-9 shrink-0 items-center gap-2 border-b border-l-4 border-border px-4 py-1.5 text-[12.5px] text-foreground",
        cor ? undefined : "border-l-border-strong bg-surface-subtle",
      )}
      style={
        cor
          ? { background: cor.fundo, borderLeftColor: cor.marcador }
          : undefined
      }
    >
      <Smartphone
        aria-hidden
        className="size-3.5 shrink-0 text-text-secondary"
      />
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="min-w-0">
          {ativo ? "Conversa pelo número " : "Conversa do número "}
          <strong className="font-bold text-text-strong">{nome}</strong>
          {ativo ? null : (
            <span className="text-text-secondary"> (removido da clínica)</span>
          )}
        </span>
        {telefone ? (
          <span className="cz-num text-text-secondary">
            <span className="sr-only">, telefone </span>
            {telefone}
          </span>
        ) : null}
      </p>
      <ConexaoDoNumero numero={numero} className="ml-auto" />
    </div>
  );
}

function ehStatusConhecido(status: string): status is WhatsAppConnectionStatus {
  return Object.prototype.hasOwnProperty.call(
    WHATSAPP_CONNECTION_STATUS,
    status,
  );
}

/**
 * A conexao do numero, so quando ele NAO esta conectado (conectado e o normal
 * e nao merece chip). Icone, rotulo e cor do mapa WHATSAPP_CONNECTION_STATUS,
 * os mesmos de Configuracoes.
 */
export function ConexaoDoNumero({
  numero,
  className,
}: {
  numero: NumeroDaConversa;
  className?: string;
}) {
  if (numero.estado !== "ativo") {
    return null;
  }
  const status = numero.numero.connection_status;
  if (status === "conectado" || !ehStatusConhecido(status)) {
    return null;
  }
  return (
    <StatusChip
      size="sm"
      definition={WHATSAPP_CONNECTION_STATUS[status]}
      className={cn("shrink-0", className)}
    />
  );
}
