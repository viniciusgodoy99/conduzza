import { Inbox, Megaphone } from "lucide-react";

import { BarraHorizontal } from "@/components/relatorios/barra-horizontal";
import { Secao } from "@/components/relatorios/secao";
import { EmptyState } from "@/components/shared/empty-state";
import {
  linhasDaOrigem,
  percentualOuSemDados,
} from "@/lib/domain/exportacao-de-resultados";
import type { FunilDoPeriodo } from "@/lib/queries/relatorios";

// Origem dos leads (Visao geral e Marketing): barras horizontais com o numero
// e a participacao escrita (" · 44,0%"), maior volume primeiro. E o
// substituto da rosca do prototipo, proibida (C12). "Sem atribuição" vai em
// tom neutro: e magnitude sem canal, nao um canal.

export function OrigemDosLeads({
  funil,
  className,
}: {
  funil: FunilDoPeriodo;
  className?: string;
}) {
  const linhas = linhasDaOrigem(funil);
  const maior = linhas.reduce((max, linha) => Math.max(max, linha.leads), 0);
  // Denominador da participacao de cada canal: a soma das proprias barras.
  const total = linhas.reduce((soma, linha) => soma + linha.leads, 0);
  const semCanal =
    funil.porCanal.find((linha) => linha.canal === null)?.leads ?? 0;

  return (
    <Secao
      titulo="Origem dos leads"
      icone={Megaphone}
      className={className}
      meta={
        funil.leads > 0 ? (
          <>
            <span className="cz-num">
              {percentualOuSemDados(funil.leads - semCanal, funil.leads)}
            </span>{" "}
            com origem identificada
          </>
        ) : null
      }
    >
      {linhas.length === 0 ? (
        <EmptyState
          compact
          icon={Inbox}
          title="Nenhum lead chegou neste período"
        />
      ) : (
        linhas.map((linha) => (
          <BarraHorizontal
            key={linha.chave}
            rotulo={linha.rotulo}
            valor={linha.leads}
            maximo={maior}
            total={total}
            destaque={linha.destaque}
          />
        ))
      )}
    </Secao>
  );
}
