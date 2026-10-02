import type { ReactNode } from "react";

import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import {
  taxaDeConversao,
  textoDoObjetivo,
} from "@/lib/domain/exportacao-de-resultados";
import { formatarPercentual } from "@/lib/domain/formato-compacto";
import type {
  FunilDoPeriodo,
  ObjetivoDeConversao,
} from "@/lib/queries/relatorios";

// Taxa de conversao da Visao geral: o lime da grade (destaque, um por tela,
// C17). E a COORTE do periodo (dos leads que chegaram, quantos ja agendaram),
// entao nao ganha variacao: a coorte anterior teve mais tempo para maturar e
// o delta seria enviesado. O rodape "Objetivo: X%" so existe quando a
// clinica definiu um objetivo; sem objetivo, some. A acao (definir ou alterar
// o objetivo, ou o botao desabilitado com dica) vem montada pela aba.

export function CartaoTaxaDeConversao({
  coorte,
  objetivo,
  acao,
  className,
}: {
  coorte: FunilDoPeriodo["coorte"];
  objetivo: ObjetivoDeConversao | undefined;
  acao?: ReactNode;
  className?: string;
}) {
  const taxa = taxaDeConversao(coorte);
  const rodape = textoDoObjetivo(objetivo);
  if (taxa === null) {
    return (
      <CartaoDeMetrica
        destaque
        rotulo="Taxa de conversão"
        estado="vazio"
        texto="Sem leads no período"
        rodape={rodape}
        acao={acao}
        className={className}
      />
    );
  }
  return (
    <CartaoDeMetrica
      destaque
      rotulo="Taxa de conversão"
      valor={formatarPercentual(taxa)}
      unidade="%"
      rodape={rodape}
      acao={acao}
      className={className}
    />
  );
}
