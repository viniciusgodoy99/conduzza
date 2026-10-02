"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { TableProperties } from "lucide-react";

import { Secao } from "@/components/relatorios/secao";
import { DataTable } from "@/components/shared/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  montarDetalheDaAgenda,
  type DimensaoDaAgenda,
  type LinhaDaAgenda,
} from "@/lib/domain/exportacao-de-resultados";
import type { AgendaDoPeriodo } from "@/lib/queries/relatorios";

// Detalhe da agenda (Comercial e visao do profissional, 10.7): por
// profissional, procedimento ou situacao, com a dimensao trocavel por Select
// (C33). Na situacao, as colunas de desfecho ficam vazias em vez de repetir
// o numero.

function celulaOpcional({ getValue }: { getValue: () => unknown }) {
  const valor = getValue() as number | null;
  return valor === null ? "" : valor;
}

const COLUNAS: ColumnDef<LinhaDaAgenda, unknown>[] = [
  { accessorKey: "rotulo", header: "Detalhe" },
  { accessorKey: "total", header: "Consultas", meta: { align: "right" } },
  {
    accessorKey: "compareceu",
    header: "Compareceram",
    meta: { align: "right" },
    cell: celulaOpcional,
  },
  {
    accessorKey: "faltou",
    header: "Faltaram",
    meta: { align: "right" },
    cell: celulaOpcional,
  },
];

export function DetalheDaAgenda({
  agenda,
  dimensao,
  aoMudarDimensao,
}: {
  agenda: AgendaDoPeriodo;
  dimensao: DimensaoDaAgenda;
  aoMudarDimensao: (dimensao: DimensaoDaAgenda) => void;
}) {
  return (
    <Secao
      titulo="Detalhe da agenda"
      icone={TableProperties}
      semPadding
      acao={
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-text-secondary">Dimensão</span>
          <Select
            value={dimensao}
            onValueChange={(valor) => aoMudarDimensao(valor as DimensaoDaAgenda)}
          >
            <SelectTrigger className="w-44" aria-label="Dimensão">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="profissional">Profissional</SelectItem>
              <SelectItem value="procedimento">Procedimento</SelectItem>
              <SelectItem value="status">Situação</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    >
      <DataTable
        variant="bare"
        columns={COLUNAS}
        data={montarDetalheDaAgenda(agenda, dimensao)}
        emptyTitle="Sem consultas no período"
        emptyDescription="Os detalhes aparecem quando houver consultas com início no período escolhido."
      />
    </Secao>
  );
}
