"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Target } from "lucide-react";

import { Secao } from "@/components/relatorios/secao";
import { DataTable } from "@/components/shared/data-table";
import {
  montarCampanhas,
  type LinhaDeCampanhaDaTela,
} from "@/lib/domain/exportacao-de-resultados";
import type { FunilDoPeriodo } from "@/lib/queries/relatorios";

// Campanhas do periodo: leads, agendados e conversao (agendaram dividido por
// leads, a mesma regra da Taxa de conversao). Investimento e custo por lead
// entram na Fase 4, com a leitura do investimento na Meta; ate la a tabela
// nao finge essas colunas. So contagens, nunca nome de paciente: campanha
// com 1 lead ja seria identificacao indireta, entao nao ha detalhe nominal.

const COLUNAS: ColumnDef<LinhaDeCampanhaDaTela, unknown>[] = [
  { accessorKey: "rotulo", header: "Campanha" },
  { accessorKey: "leads", header: "Leads", meta: { align: "right" } },
  { accessorKey: "agendaram", header: "Agendados", meta: { align: "right" } },
  { accessorKey: "conversao", header: "Conversão", meta: { align: "right" } },
];

export function CampanhasSecao({
  funil,
  className,
}: {
  funil: FunilDoPeriodo;
  className?: string;
}) {
  return (
    <Secao
      titulo="Campanhas"
      icone={Target}
      meta="Investimento e custo por lead chegam com a leitura dos anúncios da Meta."
      semPadding
      className={className}
    >
      <DataTable
        variant="bare"
        columns={COLUNAS}
        data={montarCampanhas(funil)}
        emptyTitle="Nenhum lead no período"
        emptyDescription="As campanhas aparecem quando os primeiros contatos chegarem no período escolhido."
      />
    </Secao>
  );
}
