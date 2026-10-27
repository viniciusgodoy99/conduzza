import { Inbox, Megaphone } from "lucide-react";

import { BarraHorizontal } from "@/components/relatorios/barra-horizontal";
import { Secao } from "@/components/relatorios/secao";
import { EmptyState } from "@/components/shared/empty-state";
import {
  hrefDaListaDeLeads,
  nomeDoLinkDaLista,
  type PeriodoDaLista,
} from "@/lib/domain/campanha-e-anuncio-do-lead";
import {
  linhasDaOrigem,
  percentualOuSemDados,
  plataformasDosAnuncios,
  textoDasPlataformas,
} from "@/lib/domain/exportacao-de-resultados";
import type {
  AnunciosDoPeriodo,
  FunilDoPeriodo,
} from "@/lib/queries/relatorios";

// Origem dos leads (Visao geral e Marketing): barras horizontais com o numero
// e a participacao escrita (" · 44,0%"), maior volume primeiro. E o
// substituto da rosca do prototipo, proibida (C12). "Sem atribuição" vai em
// tom neutro: e magnitude sem canal, nao um canal.
//
// Cada rotulo abre a lista de Leads com o MESMO periodo e os mesmos leads
// da barra (pedido do dono em 20/10/2026): origem=<canal> ou sem_atribuicao.
//
// Embaixo de Trafego pago, a divisao por plataforma dos leads de anuncio
// (pedido do dono em 26/10/2026: ver em Resultados o que o uazapi grava),
// quando os anuncios do periodo carregaram com a divisao.

export function OrigemDosLeads({
  funil,
  periodo,
  anuncios,
  className,
}: {
  funil: FunilDoPeriodo;
  /** O periodo da tela (dias civis da clinica): o mesmo vai para a lista. */
  periodo: PeriodoDaLista;
  /** anuncios_do_periodo; sem ele (ou sem a divisao), a linha nao aparece. */
  anuncios?: AnunciosDoPeriodo;
  className?: string;
}) {
  const linhas = linhasDaOrigem(funil);
  const plataformas = textoDasPlataformas(plataformasDosAnuncios(anuncios), {
    comContagem: true,
  });
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
        linhas.map((linha) => {
          const barra = (
            <BarraHorizontal
              key={linha.chave}
              rotulo={linha.rotulo}
              valor={linha.leads}
              maximo={maior}
              total={total}
              destaque={linha.destaque}
              link={{
                href: hrefDaListaDeLeads(periodo, linha.filtro),
                nome: nomeDoLinkDaLista(linha.rotulo, linha.leads),
              }}
            />
          );
          return linha.chave === "trafego_pago" && plataformas ? (
            <div key={linha.chave} className="grid gap-1">
              {barra}
              <p className="text-[13px] text-text-secondary">
                Dos leads de anúncio: {plataformas}
              </p>
            </div>
          ) : (
            barra
          );
        })
      )}
    </Secao>
  );
}
