"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Megaphone } from "lucide-react";

import { rotuloDoCanal } from "@/components/leads/rotulos";
import { BarraHorizontal } from "@/components/relatorios/barra-horizontal";
import { CartaoKpi } from "@/components/relatorios/cartao-kpi";
import { ConversoesMetaSecao } from "@/components/relatorios/conversoes-meta-secao";
import { DataTable } from "@/components/shared/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ConversoesResumo } from "@/lib/queries/conversoes-meta";
import type { FunilDoPeriodo, Periodizado } from "@/lib/queries/relatorios";

// Aba Origem (Tela 11): de qual canal e de qual campanha vem o paciente que
// comparece. KPIs com delta contra o periodo anterior, barras por canal e a
// tabela de detalhe com dimensao trocavel (10.7). Sem drill-down nominal:
// campanha com 1 lead ja seria identificacao indireta, entao a tabela so
// mostra contagens.

export function pctSeguro(parte: number, todo: number): string {
  if (todo <= 0) {
    // Zero medido e ausencia de base sao coisas diferentes: "0%" com
    // denominador vazio seria numero inventado.
    return "sem dados";
  }
  return `${Math.round((parte / todo) * 100)}%`;
}

type LinhaDetalhe = {
  rotulo: string;
  leads: number;
  agendaram: number;
  compareceram: number;
  conversao: string;
};

const COLUNAS: ColumnDef<LinhaDetalhe, unknown>[] = [
  { accessorKey: "rotulo", header: "Origem" },
  { accessorKey: "leads", header: "Leads", meta: { align: "right" } },
  { accessorKey: "agendaram", header: "Agendaram", meta: { align: "right" } },
  {
    accessorKey: "compareceram",
    header: "Compareceram",
    meta: { align: "right" },
  },
  { accessorKey: "conversao", header: "Conversão", meta: { align: "right" } },
];

export function montarDetalheDeOrigem(
  funil: FunilDoPeriodo,
  dimensao: "canal" | "campanha",
): LinhaDetalhe[] {
  if (dimensao === "canal") {
    return funil.porCanal.map((linha) => ({
      rotulo: rotuloDoCanal(linha.canal) ?? "Sem atribuição",
      leads: linha.leads,
      agendaram: linha.agendaram,
      compareceram: linha.compareceram,
      conversao: pctSeguro(linha.compareceram, linha.leads),
    }));
  }
  return funil.porCampanha.map((linha) => ({
    // Nome legivel quando o link/palavra-chave gravou; senao o id numerico
    // da campanha na Meta (CTWA cru); senao "Sem atribuição".
    rotulo:
      linha.campanha ??
      (linha.campanhaId ? `Campanha ${linha.campanhaId}` : "Sem atribuição"),
    leads: linha.leads,
    agendaram: linha.agendaram,
    compareceram: linha.compareceram,
    conversao: pctSeguro(linha.compareceram, linha.leads),
  }));
}

export function AbaOrigem({
  funil,
  conversoes,
  timezone,
  dimensao,
  aoMudarDimensao,
}: {
  funil: Periodizado<FunilDoPeriodo>;
  conversoes: ConversoesResumo;
  timezone: string;
  /** Vive no pai: a exportacao da aba usa a MESMA dimensao da tabela. */
  dimensao: "canal" | "campanha";
  aoMudarDimensao: (dimensao: "canal" | "campanha") => void;
}) {
  const atual = funil.atual;
  const anterior = funil.anterior;
  const naoRastreados =
    atual.porCanal.find((linha) => linha.canal === null)?.leads ?? 0;
  const rastreados = atual.leads - naoRastreados;
  const maiorCanal = atual.porCanal.reduce(
    (max, canal) => Math.max(max, canal.leads),
    0,
  );

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CartaoKpi
          rotulo="Leads no período"
          valor={atual.leads.toLocaleString("pt-BR")}
          anterior={
            anterior ? { atual: atual.leads, anterior: anterior.leads } : null
          }
        />
        <CartaoKpi
          rotulo="Agendamentos criados"
          valor={atual.agendamentosCriados.toLocaleString("pt-BR")}
          anterior={
            anterior
              ? {
                  atual: atual.agendamentosCriados,
                  anterior: anterior.agendamentosCriados,
                }
              : null
          }
        />
        <CartaoKpi
          rotulo="Comparecimentos"
          valor={atual.comparecimentos.toLocaleString("pt-BR")}
          anterior={
            anterior
              ? {
                  atual: atual.comparecimentos,
                  anterior: anterior.comparecimentos,
                }
              : null
          }
        />
        <CartaoKpi
          rotulo="Lead para comparecimento"
          valor={pctSeguro(atual.coorte.compareceram, atual.coorte.leads)}
          // Coortes de maturidade diferente: a anterior teve mais tempo para
          // maturar, o delta seria enviesado para baixo. Sem seta.
          notaSemDelta="coorte do período, ainda em maturação"
        />
      </section>

      <section className="grid gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Megaphone className="size-4 text-text-secondary" />
          <h2 className="text-[15px] font-semibold">Leads por canal</h2>
          <span className="text-sm text-text-tertiary">
            {pctSeguro(rastreados, atual.leads)} com origem identificada
          </span>
        </div>
        {atual.porCanal.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Nenhum lead chegou neste período.
          </p>
        ) : (
          <div className="grid gap-2">
            {atual.porCanal.map((canal) => (
              <BarraHorizontal
                key={canal.canal ?? "sem_atribuicao"}
                rotulo={rotuloDoCanal(canal.canal) ?? "Sem atribuição"}
                valor={canal.leads}
                maximo={maiorCanal}
                destaque={canal.canal !== null}
              />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Detalhe</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary">Dimensão</span>
            <Select
              value={dimensao}
              onValueChange={(valor) =>
                aoMudarDimensao(valor === "campanha" ? "campanha" : "canal")
              }
            >
              <SelectTrigger className="h-10 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="canal">Canal</SelectItem>
                <SelectItem value="campanha">Campanha</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DataTable
          columns={COLUNAS}
          data={montarDetalheDeOrigem(atual, dimensao)}
          emptyTitle="Sem leads no período"
          emptyDescription="Os detalhes aparecem quando os primeiros contatos chegarem no período escolhido."
        />
      </section>

      <ConversoesMetaSecao conversoes={conversoes} timezone={timezone} />
    </div>
  );
}
