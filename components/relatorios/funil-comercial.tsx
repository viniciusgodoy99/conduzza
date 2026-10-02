import { Funnel, Inbox } from "lucide-react";

import { Secao } from "@/components/relatorios/secao";
import { BarraDeProgresso } from "@/components/shared/barra-de-progresso";
import { EmptyState } from "@/components/shared/empty-state";
import { etapasDoFunilComercial } from "@/lib/domain/exportacao-de-resultados";
import type { FunilDoPeriodo } from "@/lib/queries/relatorios";

// Funil comercial (spec 10.4) da COORTE do periodo: dos leads que chegaram,
// quantos ja agendaram e quantos ja compareceram, com a taxa sobre a etapa
// anterior escrita ao lado. Nao usa as etapas da jornada: nao existe
// historico de etapa, so o retrato atual. Barras so no tom destaque (C12: a
// barra mede, nao julga).

export function FunilComercial({
  coorte,
  className,
}: {
  coorte: FunilDoPeriodo["coorte"];
  className?: string;
}) {
  const etapas = etapasDoFunilComercial(coorte);
  return (
    <Secao
      titulo="Funil comercial"
      icone={Funnel}
      meta="Dos leads que chegaram no período"
      className={className}
    >
      {coorte.leads === 0 ? (
        <EmptyState
          compact
          icon={Inbox}
          title="Nenhum lead chegou neste período"
        />
      ) : (
        etapas.map((etapa) => {
          const legenda = `${etapa.valor.toLocaleString("pt-BR")}${
            etapa.taxa ? ` (${etapa.taxa})` : ""
          }`;
          return (
            <BarraDeProgresso
              key={etapa.rotulo}
              rotulo={etapa.rotulo}
              legenda={legenda}
              valor={etapa.valor}
              maximo={coorte.leads}
              tom="destaque"
              ariaLabel={`${etapa.rotulo}: ${legenda}`}
            />
          );
        })
      )}
    </Secao>
  );
}
