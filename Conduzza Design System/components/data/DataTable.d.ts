import * as React from 'react';

export interface Column<T = any> {
  key: string;
  header: string;
  /** Renders the cell; falls back to row[key]. */
  render?: (row: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
  /** Applies mono + tabular numerals. Use for every figure, date and phone number. */
  numeric?: boolean;
  muted?: boolean;
  strong?: boolean;
  wrap?: boolean;
}

/**
 * Dense record table — Pacientes, Leads (lista), Confirmações, Lista de espera.
 */
export interface DataTableProps<T = any> extends React.HTMLAttributes<HTMLDivElement> {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  /** Array of selected row ids. */
  selected?: string[];
  onSelect?: (id: string) => void;
  /** Tighter row height for long lists. */
  dense?: boolean;
  empty?: React.ReactNode;
}

export function DataTable(props: DataTableProps): JSX.Element;
