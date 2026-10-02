"use client";

import { Funnel, Megaphone, UserPlus } from "lucide-react";

import { CampanhasSecao } from "@/components/relatorios/campanhas-secao";
import { CartaoCustoPorLead } from "@/components/relatorios/cartoes-de-valor";
import { ConversoesMetaSecao } from "@/components/relatorios/conversoes-meta-secao";
import { DetalheDaOrigem } from "@/components/relatorios/detalhe-da-origem";
import { OrigemDosLeads } from "@/components/relatorios/origem-dos-leads";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import type { DimensaoDaOrigem } from "@/lib/domain/exportacao-de-resultados";
import { formatarPercentual, percentualDe } from "@/lib/domain/formato-compacto";
import type { ConversoesResumo } from "@/lib/queries/conversoes-meta";
import type { FunilDoPeriodo, Periodizado } from "@/lib/queries/relatorios";

// Aba Marketing (Fase 3, recebe a antiga Origem): de qual canal e de qual
// campanha vem o lead, quanto dele tem origem identificada e quanto da coorte
// ja compareceu. Sem lime nesta aba: nenhum numero aqui e o destaque da tela.
// Taxas de coorte nao ganham variacao (a coorte anterior teve mais tempo
// para maturar). Sem drill-down nominal: so contagens.

export function AbaMarketing({
  funil,
  conversoes,
  timezone,
  podeVerValores,
  dimensao,
  aoMudarDimensao,
}: {
  funil: Periodizado<FunilDoPeriodo>;
  conversoes: ConversoesResumo;
  timezone: string;
  podeVerValores: boolean;
  /** Vive no pai: a exportacao da aba usa a MESMA dimensao da tabela. */
  dimensao: DimensaoDaOrigem;
  aoMudarDimensao: (dimensao: DimensaoDaOrigem) => void;
}) {
  const atual = funil.atual;
  const anterior = funil.anterior;
  const semCanal =
    atual.porCanal.find((linha) => linha.canal === null)?.leads ?? 0;
  const rastreados = atual.leads - semCanal;
  const comOrigem = percentualDe(rastreados, atual.leads);
  const paraComparecimento = percentualDe(
    atual.coorte.compareceram,
    atual.coorte.leads,
  );

  return (
    <div className="grid gap-4">
      <section
        aria-label="Indicadores do período"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <CartaoDeMetrica
          rotulo="Leads recebidos"
          icone={UserPlus}
          valor={atual.leads.toLocaleString("pt-BR")}
          variacao={
            anterior
              ? {
                  atual: atual.leads,
                  anterior: anterior.leads,
                  comparadoCom: "período anterior",
                }
              : null
          }
        />
        {comOrigem === null ? (
          <CartaoDeMetrica
            rotulo="Com origem identificada"
            icone={Megaphone}
            estado="vazio"
            texto="Sem leads no período"
          />
        ) : (
          <CartaoDeMetrica
            rotulo="Com origem identificada"
            icone={Megaphone}
            valor={formatarPercentual(comOrigem)}
            unidade="%"
            rodape={`${rastreados.toLocaleString("pt-BR")} de ${atual.leads.toLocaleString("pt-BR")} leads`}
          />
        )}
        {paraComparecimento === null ? (
          <CartaoDeMetrica
            rotulo="Lead para comparecimento"
            icone={Funnel}
            estado="vazio"
            texto="Sem leads no período"
          />
        ) : (
          <CartaoDeMetrica
            rotulo="Lead para comparecimento"
            icone={Funnel}
            valor={formatarPercentual(paraComparecimento)}
            unidade="%"
            rodape="dos leads do período; quem chegou há pouco ainda pode comparecer"
          />
        )}
        <CartaoCustoPorLead podeVerValores={podeVerValores} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <OrigemDosLeads funil={atual} />
        <CampanhasSecao funil={atual} />
      </div>

      <DetalheDaOrigem
        funil={atual}
        dimensao={dimensao}
        aoMudarDimensao={aoMudarDimensao}
      />

      <ConversoesMetaSecao
        conversoes={conversoes}
        timezone={timezone}
        podeVerValores={podeVerValores}
      />
    </div>
  );
}
