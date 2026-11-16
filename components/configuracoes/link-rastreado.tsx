"use client";

import { Check, Copy } from "lucide-react";
import { useId, useState } from "react";

import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  enderecoDoLinkRastreado,
  type ResumoDoLink,
} from "@/lib/domain/link-rastreado";
import { cn } from "@/lib/utils";

// Bloco "Link rastreado" da aba Origem dos leads (etapa 3a do plano de
// 16/11/2026, o link da bio com endereco proprio): o endereco do Conduzza da
// origem (<sistema>/l/<codigo publico>), "Copiar link" e a contagem de
// cliques e leads dos ultimos 30 dias. Fica acima do link direto do WhatsApp
// (LinkParaABio), que continua valendo. Copiar e so leitura: nao depende do
// papel. Quando nao da para copiar (origem desativada), o botao fica visivel
// e desabilitado, com o porque.

export const TEXTOS_DO_LINK_RASTREADO = {
  titulo: "Link rastreado",
  paraQueServe:
    "Use este na bio, no QR Code e nos anúncios: ele conta os cliques e guarda de onde a pessoa veio.",
  semEndereco:
    "Não foi possível montar o link: o endereço do sistema não está configurado.",
  copiar: "Copiar link rastreado",
  copiado: "Link copiado",
  naoCopiou: "Não foi possível copiar. Selecione o link e copie à mão.",
} as const;

/** "12 cliques e 3 leads nos últimos 30 dias", com singular e zero. */
export function textoDoResumoDoLink(resumo: ResumoDoLink): string {
  const cliques = `${resumo.cliques} ${resumo.cliques === 1 ? "clique" : "cliques"}`;
  const leads = `${resumo.leads} ${resumo.leads === 1 ? "lead" : "leads"}`;
  return `${cliques} e ${leads} nos últimos 30 dias`;
}

export function LinkRastreado({
  enderecoBase,
  codigoPublico,
  resumo,
  motivoSemCopiar = null,
  nomeDaOrigem,
  className,
}: {
  /** o dominio curto dos links ou o endereco do sistema; nulo: nao ha */
  enderecoBase: string | null;
  codigoPublico: string;
  /** nulo: a leitura da contagem falhou (o link aparece sem ela) */
  resumo: ResumoDoLink | null;
  /** Por que o link ainda nao pode ser copiado (nulo: pode). */
  motivoSemCopiar?: string | null;
  /** Para o nome acessivel do botao, na linha da lista. */
  nomeDaOrigem?: string;
  className?: string;
}) {
  const id = useId();
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const link = enderecoDoLinkRastreado(enderecoBase, codigoPublico);
  const deQuem = nomeDaOrigem ? ` de ${nomeDaOrigem}` : "";

  const copiar = async () => {
    if (!link) {
      return;
    }
    setErro(null);
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro(TEXTOS_DO_LINK_RASTREADO.naoCopiou);
    }
  };

  const botao = (
    <Button
      type="button"
      variant="outline"
      disabled={!link || motivoSemCopiar !== null}
      onClick={() => void copiar()}
      aria-label={`${copiado ? TEXTOS_DO_LINK_RASTREADO.copiado : TEXTOS_DO_LINK_RASTREADO.copiar}${deQuem}`}
    >
      {copiado ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copiado
        ? TEXTOS_DO_LINK_RASTREADO.copiado
        : TEXTOS_DO_LINK_RASTREADO.copiar}
    </Button>
  );

  return (
    <div
      className={cn("grid gap-2 rounded-xl bg-surface-4 p-3", className)}
      role="group"
      aria-labelledby={`${id}-titulo`}
    >
      <p
        id={`${id}-titulo`}
        className="text-xs font-semibold text-text-strong"
      >
        {TEXTOS_DO_LINK_RASTREADO.titulo}
      </p>
      {link === null ? (
        <p className="text-[12.5px] text-alert-text">
          {TEXTOS_DO_LINK_RASTREADO.semEndereco}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="cz-num min-w-0 flex-1 text-[12px] break-all text-foreground select-all">
              {link}
            </p>
            {motivoSemCopiar ? (
              <DisabledWithHint hint={motivoSemCopiar}>{botao}</DisabledWithHint>
            ) : (
              botao
            )}
          </div>
          <p className="text-[12px] text-text-secondary">
            {TEXTOS_DO_LINK_RASTREADO.paraQueServe}
          </p>
          {resumo ? (
            <p className="text-[12px] text-foreground">
              <span className="cz-num">{textoDoResumoDoLink(resumo)}</span>
            </p>
          ) : null}
          {erro ? (
            <p role="alert" className="text-[12.5px] text-alert-text">
              {erro}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
