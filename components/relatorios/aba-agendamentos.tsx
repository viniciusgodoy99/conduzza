"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { CartaoKpi } from "@/components/relatorios/cartao-kpi";
import { DataTable } from "@/components/shared/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { APPOINTMENT_STATUS } from "@/lib/design/status";
import type {
  AgendaDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

// Aba Agendamentos (Tela 11): o movimento da agenda no periodo. KPIs com
// delta e a tabela de detalhe com dimensao trocavel (10.7). "Realizados" =
// status compareceu; cancelamentos somam paciente e clinica (o detalhe por
// status separa os dois).

export type DimensaoDaAgenda = "profissional" | "procedimento" | "status";

type LinhaDetalhe = {
  rotulo: string;
  total: number;
  compareceu: number | null;
  faltou: number | null;
};

const COLUNAS: ColumnDef<LinhaDetalhe, unknown>[] = [
  { accessorKey: "rotulo", header: "Detalhe" },
  { accessorKey: "total", header: "Consultas", meta: { align: "right" } },
  {
    accessorKey: "compareceu",
    header: "Compareceram",
    meta: { align: "right" },
    cell: ({ getValue }) => {
      const valor = getValue<number | null>();
      return valor === null ? "" : valor;
    },
  },
  {
    accessorKey: "faltou",
    header: "Faltaram",
    meta: { align: "right" },
    cell: ({ getValue }) => {
      const valor = getValue<number | null>();
      return valor === null ? "" : valor;
    },
  },
];

export function montarDetalheDaAgenda(
  agenda: AgendaDoPeriodo,
  dimensao: DimensaoDaAgenda,
): LinhaDetalhe[] {
  if (dimensao === "profissional") {
    return agenda.porProfissional.map((linha) => ({
      rotulo: linha.nome,
      total: linha.total,
      compareceu: linha.compareceu,
      faltou: linha.faltou,
    }));
  }
  if (dimensao === "procedimento") {
    return agenda.porProcedimento.map((linha) => ({
      rotulo: linha.nome,
      total: linha.total,
      compareceu: linha.compareceu,
      faltou: linha.faltou,
    }));
  }
  // Por status: o proprio recorte E o status, entao as colunas de desfecho
  // ficam vazias em vez de repetir o numero (nao mentir por preenchimento).
  return (
    Object.entries(agenda.porStatus)
      .filter(([, total]) => total > 0)
      .map(([status, total]) => ({
        rotulo:
          APPOINTMENT_STATUS[status as keyof typeof APPOINTMENT_STATUS]
            ?.label ?? status,
        total,
        compareceu: null,
        faltou: null,
      }))
      // Maior volume primeiro, como as barras.
      .sort((a, b) => b.total - a.total)
  );
}

export function AbaAgendamentos({
  agenda,
  dimensao,
  aoMudarDimensao,
  rotuloProprio,
}: {
  agenda: Periodizado<AgendaDoPeriodo>;
  dimensao: DimensaoDaAgenda;
  aoMudarDimensao: (dimensao: DimensaoDaAgenda) => void;
  /** Preenchido na visao do profissional ("Seus atendimentos"). */
  rotuloProprio?: string;
}) {
  const atual = agenda.atual;
  const anterior = agenda.anterior;
  const cancelados =
    atual.porStatus.cancelado_paciente + atual.porStatus.cancelado_clinica;
  const canceladosAnterior = anterior
    ? anterior.porStatus.cancelado_paciente +
      anterior.porStatus.cancelado_clinica
    : null;

  return (
    <div className="grid gap-6">
      {rotuloProprio ? (
        <p className="text-sm text-text-secondary">{rotuloProprio}</p>
      ) : null}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CartaoKpi
          rotulo="Criados no período"
          valor={atual.criados.toLocaleString("pt-BR")}
          anterior={
            anterior
              ? { atual: atual.criados, anterior: anterior.criados }
              : null
          }
        />
        <CartaoKpi
          rotulo="Realizados"
          valor={atual.porStatus.compareceu.toLocaleString("pt-BR")}
          anterior={
            anterior
              ? {
                  atual: atual.porStatus.compareceu,
                  anterior: anterior.porStatus.compareceu,
                }
              : null
          }
        />
        <CartaoKpi
          rotulo="Faltas"
          valor={atual.porStatus.faltou.toLocaleString("pt-BR")}
          anterior={
            anterior
              ? {
                  atual: atual.porStatus.faltou,
                  anterior: anterior.porStatus.faltou,
                }
              : null
          }
        />
        <CartaoKpi
          rotulo="Cancelamentos"
          valor={cancelados.toLocaleString("pt-BR")}
          anterior={
            canceladosAnterior !== null
              ? { atual: cancelados, anterior: canceladosAnterior }
              : null
          }
        />
      </section>

      <section className="grid gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Detalhe</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary">Dimensão</span>
            <Select
              value={dimensao}
              onValueChange={(valor) =>
                aoMudarDimensao(valor as DimensaoDaAgenda)
              }
            >
              <SelectTrigger className="h-10 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="profissional">Profissional</SelectItem>
                <SelectItem value="procedimento">Procedimento</SelectItem>
                <SelectItem value="status">Situação</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DataTable
          columns={COLUNAS}
          data={montarDetalheDaAgenda(atual, dimensao)}
          emptyTitle="Sem consultas no período"
          emptyDescription="Os detalhes aparecem quando houver consultas com início no período escolhido."
        />
      </section>
    </div>
  );
}
