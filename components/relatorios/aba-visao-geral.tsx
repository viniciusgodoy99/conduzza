"use client";

import { CalendarCheck, Goal, UserPlus } from "lucide-react";
import { useState } from "react";

import { AgenteIaResumo } from "@/components/relatorios/agente-ia-resumo";
import { CampanhasSecao } from "@/components/relatorios/campanhas-secao";
import { CartaoTaxaDeConversao } from "@/components/relatorios/cartao-taxa-de-conversao";
import {
  CartaoCustoPorLead,
  CartaoFaturamento,
} from "@/components/relatorios/cartoes-de-valor";
import { ConfirmacaoResumo } from "@/components/relatorios/confirmacao-resumo";
import { DialogObjetivoDeConversao } from "@/components/relatorios/dialog-objetivo-de-conversao";
import { FunilComercial } from "@/components/relatorios/funil-comercial";
import { OrigemDosLeads } from "@/components/relatorios/origem-dos-leads";
import { SerieLeadsAgendadas } from "@/components/relatorios/serie-leads-agendadas";
import { CartaoDeMetrica } from "@/components/shared/cartao-de-metrica";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import type {
  AbaDeResultados,
  AgendaDoPeriodo,
  AtendimentoDoPeriodo,
  CampanhasDoPeriodo,
  FaturamentoDoPeriodo,
  FunilDoPeriodo,
  LinhaDeBase,
  ObjetivoDeConversao,
  Periodizado,
  PontoDaSerie,
} from "@/lib/queries/relatorios";

// Visao geral da Tela 11 (Fase 3, receita do prototipo com os desvios do
// docs/06): 5 cartoes (Leads recebidos, Consultas agendadas, Taxa de
// conversao em lime, Custo por lead, Faturamento estimado), a serie diaria,
// a origem em barras, o funil de coorte, o resumo da confirmacao, o agente
// de IA e as campanhas. A Taxa de conversao e o unico lime da aba (C17).
// Fase 4: Custo por lead e Campanhas leem campanhas_do_periodo (bloco com
// estado proprio de carregando e erro, como a serie e o faturamento).

export const DICA_SEM_PAPEL_DO_OBJETIVO =
  "Só administrador e gestor definem o objetivo de conversão.";

function tentarDeNovo(acao: () => void) {
  return (
    <Button variant="outline" className="h-10" onClick={acao}>
      Tentar de novo
    </Button>
  );
}

export function AbaVisaoGeral({
  funil,
  agenda,
  atendimento,
  serie,
  serieComErro,
  aoTentarSerieDeNovo,
  faturamento,
  faturamentoComErro,
  aoTentarFaturamentoDeNovo,
  campanhas,
  campanhasComErro,
  aoTentarCampanhasDeNovo,
  linhaDeBase,
  objetivo,
  podeVerValores,
  podeDefinirObjetivo,
  timezone,
  aoMudarObjetivo,
  irParaAba,
}: {
  funil: Periodizado<FunilDoPeriodo>;
  agenda: Periodizado<AgendaDoPeriodo>;
  atendimento: Periodizado<AtendimentoDoPeriodo>;
  /** undefined = carregando */
  serie: PontoDaSerie[] | undefined;
  serieComErro: boolean;
  aoTentarSerieDeNovo: () => void;
  /** undefined = carregando; null = sem permissao no banco */
  faturamento: Periodizado<FaturamentoDoPeriodo> | null | undefined;
  faturamentoComErro: boolean;
  aoTentarFaturamentoDeNovo: () => void;
  /** undefined = carregando (campanhas_do_periodo) */
  campanhas: Periodizado<CampanhasDoPeriodo> | undefined;
  campanhasComErro: boolean;
  aoTentarCampanhasDeNovo: () => void;
  linhaDeBase: LinhaDeBase;
  objetivo: ObjetivoDeConversao | undefined;
  podeVerValores: boolean;
  podeDefinirObjetivo: boolean;
  timezone: string;
  aoMudarObjetivo: () => Promise<unknown> | void;
  irParaAba: (aba: AbaDeResultados) => void;
}) {
  const [dialogAberto, setDialogAberto] = useState(false);
  const atual = funil.atual;
  const anterior = funil.anterior;
  const rotuloDoObjetivo = objetivo ? "Alterar objetivo" : "Definir objetivo";

  return (
    <div className="grid gap-4">
      <section
        aria-label="Indicadores do período"
        className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5"
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
        <CartaoDeMetrica
          rotulo="Consultas agendadas"
          icone={CalendarCheck}
          valor={atual.agendamentosCriados.toLocaleString("pt-BR")}
          variacao={
            anterior
              ? {
                  atual: atual.agendamentosCriados,
                  anterior: anterior.agendamentosCriados,
                  comparadoCom: "período anterior",
                }
              : null
          }
          rodape="criadas no período"
        />
        <CartaoTaxaDeConversao
          coorte={atual.coorte}
          objetivo={objetivo}
          acao={
            podeDefinirObjetivo ? (
              <Button
                variant="outline"
                className="h-10"
                onClick={() => setDialogAberto(true)}
              >
                <Goal aria-hidden />
                {rotuloDoObjetivo}
              </Button>
            ) : (
              <DisabledWithHint hint={DICA_SEM_PAPEL_DO_OBJETIVO}>
                <Button variant="outline" className="h-10" disabled>
                  <Goal aria-hidden />
                  {rotuloDoObjetivo}
                </Button>
              </DisabledWithHint>
            )
          }
        />
        <CartaoCustoPorLead
          podeVerValores={podeVerValores}
          campanhas={campanhas}
          timezone={timezone}
          erro={campanhasComErro}
          tentarDeNovo={tentarDeNovo(aoTentarCampanhasDeNovo)}
        />
        <CartaoFaturamento
          podeVerValores={podeVerValores}
          faturamento={faturamento}
          erro={faturamentoComErro}
          tentarDeNovo={tentarDeNovo(aoTentarFaturamentoDeNovo)}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <SerieLeadsAgendadas
          serie={serie}
          timezone={timezone}
          erro={serieComErro}
          tentarDeNovo={tentarDeNovo(aoTentarSerieDeNovo)}
        />
        <OrigemDosLeads funil={atual} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <FunilComercial coorte={atual.coorte} />
        <ConfirmacaoResumo
          agenda={agenda.atual}
          linhaDeBase={linhaDeBase}
          aoVerDetalhes={() => irParaAba("comercial")}
        />
        <AgenteIaResumo
          atendimento={atendimento.atual}
          aoVerDetalhes={() => irParaAba("ia")}
        />
      </div>

      <CampanhasSecao
        campanhas={campanhas}
        podeVerValores={podeVerValores}
        timezone={timezone}
        erro={campanhasComErro}
        tentarDeNovo={tentarDeNovo(aoTentarCampanhasDeNovo)}
      />

      {podeDefinirObjetivo ? (
        <DialogObjetivoDeConversao
          aberto={dialogAberto}
          onFechar={() => setDialogAberto(false)}
          objetivo={objetivo ?? null}
          aoMudar={aoMudarObjetivo}
        />
      ) : null}
    </div>
  );
}
