"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { TableProperties } from "lucide-react";
import type { ReactNode } from "react";

import { Secao } from "@/components/relatorios/secao";
import { Aviso } from "@/components/shared/aviso";
import { DataTable } from "@/components/shared/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  montarDetalheDeOrigem,
  type DimensaoDaOrigem,
  type LinhaDeOrigem,
} from "@/lib/domain/exportacao-de-resultados";
import type {
  CampanhasDoPeriodo,
  FunilDoPeriodo,
} from "@/lib/queries/relatorios";

// Detalhe da origem (Marketing, 10.7): por canal ou por campanha, com a
// dimensao trocavel por Select (C33). A dimensao vive no pai: a exportacao da
// aba usa a MESMA dimensao da tabela. "Comparecimento" = compareceram
// dividido por leads (a Conversao das campanhas e outra regra: agendaram).
// Fase 4: por campanha usa as MESMAS linhas da tabela Campanhas
// (campanhas_do_periodo, casamento so por id), mais "Sem campanha".

function celulaOpcional({ getValue }: { getValue: () => unknown }) {
  const valor = getValue() as number | null;
  return valor === null ? "" : valor;
}

const COLUNAS: ColumnDef<LinhaDeOrigem, unknown>[] = [
  { accessorKey: "rotulo", header: "Origem" },
  { accessorKey: "leads", header: "Leads", meta: { align: "right" } },
  {
    accessorKey: "agendaram",
    header: "Agendaram",
    meta: { align: "right" },
    cell: celulaOpcional,
  },
  {
    accessorKey: "compareceram",
    header: "Compareceram",
    meta: { align: "right" },
    cell: celulaOpcional,
  },
  {
    accessorKey: "comparecimento",
    header: "Comparecimento",
    meta: { align: "right" },
  },
];

export function DetalheDaOrigem({
  funil,
  campanhas,
  campanhasComErro = false,
  tentarCampanhasDeNovo,
  dimensao,
  aoMudarDimensao,
}: {
  funil: FunilDoPeriodo;
  /** Atual de campanhas_do_periodo; undefined = carregando */
  campanhas: CampanhasDoPeriodo | undefined;
  campanhasComErro?: boolean;
  tentarCampanhasDeNovo?: ReactNode;
  dimensao: DimensaoDaOrigem;
  aoMudarDimensao: (dimensao: DimensaoDaOrigem) => void;
}) {
  const porCampanhaComErro = dimensao === "campanha" && campanhasComErro;
  const linhas = porCampanhaComErro
    ? null
    : montarDetalheDeOrigem(funil, dimensao, campanhas);
  return (
    <Secao
      titulo="Detalhe da origem"
      icone={TableProperties}
      semPadding
      acao={
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-text-secondary">Dimensão</span>
          <Select
            value={dimensao}
            onValueChange={(valor) =>
              aoMudarDimensao(valor === "campanha" ? "campanha" : "canal")
            }
          >
            <SelectTrigger className="w-40" aria-label="Dimensão">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="canal">Canal</SelectItem>
              <SelectItem value="campanha">Campanha</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    >
      {porCampanhaComErro ? (
        <div className="p-4">
          <Aviso
            tom="alert"
            role="alert"
            titulo="Não foi possível carregar as campanhas."
            acao={tentarCampanhasDeNovo}
          >
            Tente de novo em instantes.
          </Aviso>
        </div>
      ) : (
        <DataTable
          variant="bare"
          columns={COLUNAS}
          data={linhas ?? []}
          isLoading={linhas === null}
          emptyTitle="Sem leads no período"
          emptyDescription="Os detalhes aparecem quando os primeiros contatos chegarem no período escolhido."
        />
      )}
    </Secao>
  );
}
