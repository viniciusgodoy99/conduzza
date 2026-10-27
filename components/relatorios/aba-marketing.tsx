"use client";

import { Funnel, Megaphone, UserPlus } from "lucide-react";

import { CampanhasSecao } from "@/components/relatorios/campanhas-secao";
import { CartaoCustoPorLead } from "@/components/relatorios/cartoes-de-valor";
import { ConversoesMetaSecao } from "@/components/relatorios/conversoes-meta-secao";
import { DetalheDaOrigem } from "@/components/relatorios/detalhe-da-origem";
import { OrigemDosLeads } from "@/components/relatorios/origem-dos-leads";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import { Button } from "@/components/ui/button";
import type { PeriodoDaLista } from "@/lib/domain/campanha-e-anuncio-do-lead";
import type { DimensaoDaOrigem } from "@/lib/domain/exportacao-de-resultados";
import {
  formatarPercentual,
  percentualDe,
} from "@/lib/domain/formato-compacto";
import type { ConversoesResumo } from "@/lib/queries/conversoes-meta";
import type {
  AnunciosDoPeriodo,
  CampanhasDoPeriodo,
  FunilDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

// Aba Marketing (Fase 3, recebe a antiga Origem): de qual canal e de qual
// campanha vem o lead, quanto dele tem origem identificada e quanto da coorte
// ja compareceu. Sem lime nesta aba: nenhum numero aqui e o destaque da tela.
// Taxas de coorte nao ganham variacao (a coorte anterior teve mais tempo
// para maturar). Aqui so contagens, nenhum nome: o drill-down e a lista de
// Leads, outra tela, com a trilha de leitura dela.
// Fase 4: Custo por lead, Campanhas e o detalhe por campanha leem
// campanhas_do_periodo (uma verdade so: as mesmas linhas nos tres).
// O detalhe por anuncio (20/10/2026) le anuncios_do_periodo, que o pai busca
// sempre nesta aba desde 26/10/2026: sem campanha, o quadro Campanhas mostra
// os anuncios, e a Origem dos leads, a divisao por plataforma.
// Os rotulos da Origem dos leads e do Detalhe da origem abrem essa lista com
// o mesmo periodo e os mesmos leads da linha (pedido do dono em 20/10/2026).

function tentarDeNovo(acao: () => void) {
  return (
    <Button variant="outline" className="h-10" onClick={acao}>
      Tentar de novo
    </Button>
  );
}

export function AbaMarketing({
  funil,
  periodo,
  campanhas,
  campanhasComErro,
  aoTentarCampanhasDeNovo,
  anuncios,
  anunciosComErro = false,
  aoTentarAnunciosDeNovo,
  conversoes,
  timezone,
  podeVerValores,
  dimensao,
  aoMudarDimensao,
}: {
  funil: Periodizado<FunilDoPeriodo>;
  /** O periodo da tela (dias civis da clinica), para os links da lista. */
  periodo: PeriodoDaLista;
  /** undefined = carregando (campanhas_do_periodo) */
  campanhas: Periodizado<CampanhasDoPeriodo> | undefined;
  campanhasComErro: boolean;
  aoTentarCampanhasDeNovo: () => void;
  /** anuncios_do_periodo; undefined = carregando */
  anuncios?: AnunciosDoPeriodo;
  anunciosComErro?: boolean;
  aoTentarAnunciosDeNovo?: () => void;
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
        <CartaoCustoPorLead
          podeVerValores={podeVerValores}
          campanhas={campanhas}
          timezone={timezone}
          erro={campanhasComErro}
          tentarDeNovo={tentarDeNovo(aoTentarCampanhasDeNovo)}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <OrigemDosLeads funil={atual} periodo={periodo} anuncios={anuncios} />
        <CampanhasSecao
          campanhas={campanhas}
          podeVerValores={podeVerValores}
          timezone={timezone}
          erro={campanhasComErro}
          tentarDeNovo={tentarDeNovo(aoTentarCampanhasDeNovo)}
          anuncios={anuncios}
          anunciosPedidos
          anunciosComErro={anunciosComErro}
          periodo={periodo}
        />
      </div>

      <DetalheDaOrigem
        funil={atual}
        periodo={periodo}
        campanhas={campanhas?.atual}
        campanhasComErro={campanhasComErro}
        tentarCampanhasDeNovo={tentarDeNovo(aoTentarCampanhasDeNovo)}
        anuncios={anuncios}
        anunciosComErro={anunciosComErro}
        tentarAnunciosDeNovo={
          aoTentarAnunciosDeNovo
            ? tentarDeNovo(aoTentarAnunciosDeNovo)
            : undefined
        }
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
