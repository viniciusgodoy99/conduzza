"use client";

import {
  Ellipsis,
  MapPin,
  Pencil,
  Plug,
  RefreshCw,
  Star,
  Trash2,
  Unplug,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WHATSAPP_CONNECTION_STATUS } from "@/lib/design/status";

import { IdentidadeDoWhatsapp } from "./connect-client";
import {
  acaoDeConexao,
  dataNoFusoDaClinica,
  DICA_JA_E_PRINCIPAL,
  motivoParaMostrar,
  ROTULO_DA_ACAO,
  telefoneFormatado,
  type AcaoDeConexao,
  type NumeroDoWhatsapp,
} from "./numeros";

// Cartao de UM numero na aba de WhatsApp das Configuracoes (docs/07, Telas;
// kit ScreenConfig). Apresentacao pura: as acoes chegam por callback da
// lista-de-numeros.tsx, que fala com o servidor.
//
// - A situacao da conexao vai no StatusChip (icone, rotulo e cor, de
//   WHATSAPP_CONNECTION_STATUS), nunca num ponto colorido.
// - "Principal" e "Mensagens automáticas" sao etiquetas neutras (a Tag do
//   DS, com borda e sem cor de status): dizem o PAPEL do numero, nao um
//   estado, e por isso nao disputam a cor com a conexao.
// - Toda acao tem 40px. Sem permissao, fica visivel e desabilitada com a dica;
//   no menu, a dica vai escrita dentro do item (tooltip dentro de menu nao
//   abre em toque, e o Radix tira o item desabilitado da ordem de foco).
// - Desconectado porque a trava recusou o celular: o motivo vai escrito num
//   aviso embaixo do chip (o chip continua dizendo a situacao nas 3 camadas).
//   Antes ele so aparecia no dialogo, e recarregar a pagina o perdia.

const ICONE_DA_ACAO: Record<AcaoDeConexao, LucideIcon> = {
  conectar: Plug,
  reconectar: RefreshCw,
  continuar: Plug,
  desconectar: Unplug,
};

function Etiqueta({
  icone: Icone,
  children,
}: {
  icone: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-border-strong bg-card px-2 text-xs font-medium text-foreground">
      <Icone aria-hidden className="size-3.5 shrink-0 text-text-secondary" />
      {children}
    </span>
  );
}

/**
 * Item do menu do cartao. Com motivo, fica desabilitado e o motivo aparece
 * escrito embaixo do rotulo, em contraste cheio: so o rotulo esmaece.
 */
function ItemDoMenu({
  icone: Icone,
  rotulo,
  motivo,
  destrutivo = false,
  aoEscolher,
}: {
  icone: LucideIcon;
  rotulo: string;
  /** nulo: o item esta liberado */
  motivo: string | null;
  destrutivo?: boolean;
  aoEscolher: () => void;
}) {
  if (motivo === null) {
    return (
      <DropdownMenuItem
        variant={destrutivo ? "destructive" : "default"}
        onSelect={aoEscolher}
      >
        <Icone aria-hidden />
        {rotulo}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem
      disabled
      variant={destrutivo ? "destructive" : "default"}
      className="flex-col items-start justify-center gap-0.5 py-2 data-disabled:opacity-100"
    >
      <span className="inline-flex items-center gap-[9px] opacity-45">
        <Icone aria-hidden className="size-[15px]" />
        {rotulo}
      </span>
      <span className="text-xs font-normal text-text-secondary">{motivo}</span>
    </DropdownMenuItem>
  );
}

export type CartaoDoNumeroProps = {
  numero: NumeroDoWhatsapp;
  /** nome da unidade do numero, quando ele tem uma */
  unidade: string | null;
  /** e o numero fixo das mensagens automaticas (modo fixo da politica) */
  fixoDasAutomaticas: boolean;
  /** fuso da clinica, para a data "desde" */
  timezone: string;
  /** administrador ou gestor: conecta, renomeia, unidade e principal (D8) */
  podeGerenciar: boolean;
  /** dica de quem nao gerencia */
  dica: string;
  /** por que nao pode remover (nulo: pode); ver motivoParaNaoRemover */
  motivoParaNaoRemover: string | null;
  /** por que nao pode escolher a unidade (nulo: pode) */
  motivoParaNaoEscolherUnidade: string | null;
  /** uma acao deste numero esta em andamento */
  ocupado: boolean;
  aoConectar: () => void;
  aoDesconectar: () => void;
  aoRenomear: () => void;
  aoEscolherUnidade: () => void;
  aoTornarPrincipal: () => void;
  aoRemover: () => void;
};

export function CartaoDoNumero({
  numero,
  unidade,
  fixoDasAutomaticas,
  timezone,
  podeGerenciar,
  dica,
  motivoParaNaoRemover,
  motivoParaNaoEscolherUnidade,
  ocupado,
  aoConectar,
  aoDesconectar,
  aoRenomear,
  aoEscolherUnidade,
  aoTornarPrincipal,
  aoRemover,
}: CartaoDoNumeroProps) {
  const idDoNome = `numero-${numero.id}-nome`;
  const acao = acaoDeConexao(numero);
  const IconeDaAcao = ICONE_DA_ACAO[acao];
  const telefone = telefoneFormatado(numero.displayPhone);
  const desde =
    numero.status === "conectado" && numero.connectedAt
      ? dataNoFusoDaClinica(numero.connectedAt, timezone)
      : null;
  const motivo = motivoParaMostrar(numero);

  const botaoDeConexao = (
    <Button
      variant={acao === "desconectar" ? "destructive" : "outline"}
      className="w-full"
      onClick={acao === "desconectar" ? aoDesconectar : aoConectar}
      disabled={!podeGerenciar || ocupado}
    >
      <IconeDaAcao aria-hidden className="size-4" />
      {ROTULO_DA_ACAO[acao]}{" "}
      {/* Varios cartoes com o mesmo botao: o leitor de tela ouve de qual
          numero e. */}
      <span className="sr-only">{numero.nome}</span>
    </Button>
  );

  return (
    <article
      aria-labelledby={idDoNome}
      aria-busy={ocupado || undefined}
      className="flex h-full flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <IdentidadeDoWhatsapp />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2
            id={idDoNome}
            title={numero.nome}
            className="truncate text-base leading-[1.3] font-bold tracking-[-0.01em] text-text-strong"
          >
            {numero.nome}
          </h2>
          {unidade ? (
            <p className="truncate text-xs text-text-secondary">{unidade}</p>
          ) : null}
          <p className="text-xs text-text-secondary">
            {telefone ? (
              <span className="cz-num">{telefone}</span>
            ) : numero.status === "conectado" ? (
              "Telefone ainda não identificado"
            ) : (
              "Nenhum celular pareado"
            )}
            {desde ? (
              <>
                {" "}
                · desde <span className="cz-num">{desde}</span>
              </>
            ) : null}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-mt-1.5 -mr-1.5 text-text-secondary"
              aria-label={`Mais ações do número ${numero.nome}`}
              disabled={ocupado}
            >
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-72">
            <ItemDoMenu
              icone={Pencil}
              rotulo="Renomear"
              motivo={podeGerenciar ? null : dica}
              aoEscolher={aoRenomear}
            />
            <ItemDoMenu
              icone={MapPin}
              rotulo="Unidade"
              motivo={podeGerenciar ? motivoParaNaoEscolherUnidade : dica}
              aoEscolher={aoEscolherUnidade}
            />
            <ItemDoMenu
              icone={Star}
              rotulo="Tornar principal"
              motivo={
                !podeGerenciar
                  ? dica
                  : numero.principal
                    ? DICA_JA_E_PRINCIPAL
                    : null
              }
              aoEscolher={aoTornarPrincipal}
            />
            <DropdownMenuSeparator />
            <ItemDoMenu
              icone={Trash2}
              rotulo="Remover número"
              motivo={motivoParaNaoRemover}
              destrutivo
              aoEscolher={aoRemover}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip definition={WHATSAPP_CONNECTION_STATUS[numero.status]} />
        {numero.principal ? <Etiqueta icone={Star}>Principal</Etiqueta> : null}
        {fixoDasAutomaticas ? (
          <Etiqueta icone={Workflow}>Mensagens automáticas</Etiqueta>
        ) : null}
      </div>

      {motivo ? <Aviso tom="alert">{motivo}</Aviso> : null}

      <div className="mt-auto pt-1">
        {podeGerenciar ? (
          botaoDeConexao
        ) : (
          <DisabledWithHint hint={dica} className="w-full">
            {botaoDeConexao}
          </DisabledWithHint>
        )}
      </div>
    </article>
  );
}
