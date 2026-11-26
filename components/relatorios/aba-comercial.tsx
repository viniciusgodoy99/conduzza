"use client";

import { CartoesDaAgenda } from "@/components/relatorios/cartoes-da-agenda";
import {
  CartaoFaturamento,
  CartoesDeVendas,
} from "@/components/relatorios/cartoes-de-valor";
import { ConfirmacaoCompleta } from "@/components/relatorios/confirmacao-completa";
import { DetalheDaAgenda } from "@/components/relatorios/detalhe-da-agenda";
import { FunilComercial } from "@/components/relatorios/funil-comercial";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import { Button } from "@/components/ui/button";
import type { DimensaoDaAgenda } from "@/lib/domain/exportacao-de-resultados";
import { formatarReaisCompleto } from "@/lib/domain/formato-compacto";
import type {
  AgendaDoPeriodo,
  FaturamentoDoPeriodo,
  FunilDoPeriodo,
  LinhaDeBase,
  Periodizado,
  PivoDaRegua,
  VendasDoPeriodo,
} from "@/lib/queries/relatorios";

// Aba Comercial (Fase 3, recebe Agendamentos e Confirmacao): o movimento da
// agenda, o heroi Consultas recuperadas (o lime UNICO desta aba, C17; saiu
// do Inicio), o faturamento estimado detalhado (so admin e gestor), o funil
// de coorte, a Confirmacao completa com a linha de base e o pivo da regua
// (brief Tela 11) e o detalhe por profissional, procedimento ou situacao.
// Venda pela Jornada (23/11/2026): Vendas e Valor das vendas logo abaixo do
// faturamento, separados dele, no filtro de origem da tela.

function TextoDasRecuperadas({
  recuperadas,
  podeVerValores,
}: {
  recuperadas: AgendaDoPeriodo["recuperadas"];
  podeVerValores: boolean;
}) {
  if (recuperadas.total === 0) {
    return <>Vagas preenchidas pela lista de espera.</>;
  }
  // A receita so chega para admin e gestor (o banco devolve null para os
  // outros papeis): null e "sem acesso", e a frase simplesmente nao a cita.
  const comReceita = podeVerValores && recuperadas.receitaCents !== null;
  return (
    <>
      Vagas preenchidas pela lista de espera
      {comReceita ? (
        <>
          , com{" "}
          <span className="cz-num font-semibold">
            {formatarReaisCompleto(recuperadas.receitaCents ?? 0)}
          </span>{" "}
          em receita associada
          {recuperadas.semPreco > 0 ? (
            <>
              {" "}
              (<span className="cz-num">{recuperadas.semPreco}</span> sem preço
              cadastrado)
            </>
          ) : null}
        </>
      ) : null}
      .
    </>
  );
}

export function AbaComercial({
  funil,
  agenda,
  pivo,
  faturamento,
  faturamentoComErro,
  aoTentarFaturamentoDeNovo,
  vendas,
  vendasComErro,
  aoTentarVendasDeNovo,
  linhaDeBase,
  ehAdmin,
  podeVerValores,
  timezone,
  dimensao,
  aoMudarDimensao,
  aoMudarLinhaDeBase,
}: {
  funil: Periodizado<FunilDoPeriodo>;
  agenda: Periodizado<AgendaDoPeriodo>;
  pivo: PivoDaRegua;
  /** undefined = carregando; null = sem permissao no banco */
  faturamento: Periodizado<FaturamentoDoPeriodo> | null | undefined;
  faturamentoComErro: boolean;
  aoTentarFaturamentoDeNovo: () => void;
  /** vendas_do_periodo: undefined = carregando; null = sem permissao */
  vendas: VendasDoPeriodo | null | undefined;
  vendasComErro: boolean;
  aoTentarVendasDeNovo: () => void;
  linhaDeBase: LinhaDeBase;
  ehAdmin: boolean;
  podeVerValores: boolean;
  timezone: string;
  /** Vive no pai: a exportacao da aba usa a MESMA dimensao da tabela. */
  dimensao: DimensaoDaAgenda;
  aoMudarDimensao: (dimensao: DimensaoDaAgenda) => void;
  aoMudarLinhaDeBase: () => Promise<unknown> | void;
}) {
  const recuperadas = agenda.atual.recuperadas;
  const anterior = agenda.anterior;

  return (
    <div className="grid gap-4">
      <CartoesDaAgenda agenda={agenda} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <CartaoDeMetrica
          destaque
          rotulo="Consultas recuperadas"
          valor={recuperadas.total.toLocaleString("pt-BR")}
          variacao={
            anterior
              ? {
                  atual: recuperadas.total,
                  anterior: anterior.recuperadas.total,
                  comparadoCom: "período anterior",
                }
              : null
          }
        >
          <p className="max-w-[60ch] text-[13px] leading-[1.5] text-primary-foreground">
            <TextoDasRecuperadas
              recuperadas={recuperadas}
              podeVerValores={podeVerValores}
            />
          </p>
        </CartaoDeMetrica>
        <CartaoFaturamento
          detalhado
          podeVerValores={podeVerValores}
          faturamento={faturamento}
          erro={faturamentoComErro}
          tentarDeNovo={
            <Button
              variant="outline"
              className="h-10"
              onClick={aoTentarFaturamentoDeNovo}
            >
              Tentar de novo
            </Button>
          }
        />
      </div>

      <CartoesDeVendas
        podeVerValores={podeVerValores}
        vendas={vendas}
        erro={vendasComErro}
        tentarDeNovo={
          <Button
            variant="outline"
            className="h-10"
            onClick={aoTentarVendasDeNovo}
          >
            Tentar de novo
          </Button>
        }
      />

      <FunilComercial coorte={funil.atual.coorte} />

      <ConfirmacaoCompleta
        agenda={agenda.atual}
        pivo={pivo}
        linhaDeBase={linhaDeBase}
        ehAdmin={ehAdmin}
        timezone={timezone}
        aoMudarLinhaDeBase={aoMudarLinhaDeBase}
      />

      <DetalheDaAgenda
        agenda={agenda.atual}
        dimensao={dimensao}
        aoMudarDimensao={aoMudarDimensao}
      />
    </div>
  );
}
