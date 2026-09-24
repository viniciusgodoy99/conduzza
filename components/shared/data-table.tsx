"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { SearchX } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: TData) => void;
  /** Classe da casca (ou do bloco, na variante bare) */
  className?: string;
  /** "bare" tira a casca de cartao, para tabela que ja esta dentro de um Card */
  variant?: "default" | "bare";
  /**
   * Cabecalho grudado no topo enquanto as linhas rolam dentro da tabela. A
   * altura maxima padrao e 70vh; troque por containerClassName (ex.:
   * "max-h-[480px]").
   */
  stickyHeader?: boolean;
  /** Classe do conteiner de rolagem da tabela */
  containerClassName?: string;
  /** Marca a linha como selecionada (fundo lime suave e fio a esquerda) */
  isRowSelected?: (row: TData) => boolean;
  /** Linhas de 36px e texto de 12,5px, para tabela dentro de painel */
  dense?: boolean;
};

// Metadados de coluna lidos aqui. align "right" alinha cabecalho e celula;
// numeric aplica a fonte mono tabular (cz-num). Coluna alinhada a direita e
// numerica por padrao (brief secao 3.6), salvo numeric: false.
type MetaDaColuna = { align?: "right"; numeric?: boolean } | undefined;

function lerMeta(meta: unknown): { direita: boolean; numerica: boolean } {
  const lida = meta as MetaDaColuna;
  const direita = lida?.align === "right";
  return { direita, numerica: lida?.numeric ?? direita };
}

// Tabela generica sobre TanStack Table v8 com estados de carregando e vazio
// embutidos, na casca do DataTable do design system Conduzza (docs/06 secao
// 4.5): cartao de raio 16 com fio e sombra baixa, cabecalho sutil em caixa
// alta e linhas de 44px. Carregando e vazio aparecem dentro da mesma casca.
export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  emptyTitle = "Nada por aqui",
  emptyDescription,
  onRowClick,
  className,
  variant = "default",
  stickyHeader = false,
  containerClassName,
  isRowSelected,
  dense = false,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const casca = cn(
    variant === "default" &&
      "overflow-hidden rounded-card border border-border bg-card shadow-sm",
    className,
  );

  if (isLoading) {
    return (
      <TableSkeleton
        columns={columns.length}
        variant={variant}
        className={className}
      />
    );
  }

  if (data.length === 0) {
    return (
      <div className={casca}>
        <EmptyState
          icon={SearchX}
          title={emptyTitle}
          description={emptyDescription}
        />
      </div>
    );
  }

  return (
    <div className={casca}>
      <Table
        containerClassName={cn(
          stickyHeader && "max-h-[70vh]",
          containerClassName,
        )}
      >
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const { direita } = lerMeta(header.column.columnDef.meta);
                return (
                  <TableHead
                    key={header.id}
                    className={cn(dense && "px-3", direita && "text-right")}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => {
            const selecionada = isRowSelected?.(row.original) ?? false;
            return (
              <TableRow
                key={row.id}
                data-state={selecionada ? "selected" : undefined}
                aria-selected={isRowSelected ? selecionada : undefined}
                onClick={
                  onRowClick ? () => onRowClick(row.original) : undefined
                }
                className={cn(onRowClick && "cursor-pointer")}
              >
                {row.getVisibleCells().map((cell) => {
                  const { direita, numerica } = lerMeta(
                    cell.column.columnDef.meta,
                  );
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        dense && "h-9 px-3 text-[12.5px]",
                        direita && "text-right",
                        numerica && "cz-num",
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
