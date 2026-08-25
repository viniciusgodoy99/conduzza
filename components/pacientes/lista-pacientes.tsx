"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

import { dataLocal } from "@/components/leads/rotulos";
import {
  BarraComparecimento,
  EtiquetasDoPaciente,
  plural,
  SemDado,
} from "@/components/pacientes/comum";
import { DataTable } from "@/components/shared/data-table";
import { etiquetasDoPaciente, indicadoresDe } from "@/lib/domain/pacientes-ui";
import type { PacienteResumo } from "@/lib/queries/pacientes";

// Lista da Tela 9: as 8 colunas do brief. Abaixo de 1024px a tabela perde as
// colunas de apoio (convenio, ultima consulta e saldo) em vez de rolar sem
// fim: o essencial e quem e a pessoa, quando ela volta e o que a agenda
// precisa saber dela.

export function ListaPacientes({
  pacientes,
  timezone,
  telaEstreita,
  agora,
  onAbrirFicha,
}: {
  pacientes: PacienteResumo[];
  timezone: string;
  telaEstreita: boolean;
  agora: Date;
  onAbrirFicha: (paciente: PacienteResumo) => void;
}) {
  const columns = useMemo<ColumnDef<PacienteResumo>[]>(() => {
    const nome: ColumnDef<PacienteResumo> = {
      accessorKey: "name",
      header: "Nome",
      cell: ({ row }) =>
        row.original.name ? (
          <span className="font-medium">{row.original.name}</span>
        ) : (
          <span className="text-text-tertiary">Sem nome</span>
        ),
    };
    const telefone: ColumnDef<PacienteResumo> = {
      accessorKey: "phone_e164",
      header: "Telefone",
      cell: ({ row }) => (
        <span className="font-mono text-[13px] whitespace-nowrap">
          {row.original.phone_e164}
        </span>
      ),
    };
    const convenio: ColumnDef<PacienteResumo> = {
      accessorKey: "insurance_name",
      header: "Convênio",
      cell: ({ row }) =>
        row.original.insurance_name ? (
          <span className="text-text-secondary">
            {row.original.insurance_name}
          </span>
        ) : (
          <span className="text-text-tertiary">Particular</span>
        ),
    };
    const ultima: ColumnDef<PacienteResumo> = {
      accessorKey: "ultima_consulta",
      header: "Última consulta",
      cell: ({ row }) =>
        row.original.ultima_consulta ? (
          <span className="font-mono text-[13px] whitespace-nowrap tabular-nums">
            {dataLocal(row.original.ultima_consulta, timezone)}
          </span>
        ) : (
          <SemDado leitura="Sem consulta registrada" />
        ),
    };
    const proxima: ColumnDef<PacienteResumo> = {
      accessorKey: "proxima_consulta",
      header: "Próxima",
      cell: ({ row }) =>
        row.original.proxima_consulta ? (
          <span className="font-mono text-[13px] whitespace-nowrap tabular-nums">
            {dataLocal(row.original.proxima_consulta, timezone)}
          </span>
        ) : (
          <span className="whitespace-nowrap text-text-tertiary">
            Sem marcação
          </span>
        ),
    };
    const comparecimento: ColumnDef<PacienteResumo> = {
      id: "comparecimento",
      header: "Comparecimento",
      cell: ({ row }) => (
        <BarraComparecimento
          taxa={indicadoresDe(row.original).taxaComparecimento}
        />
      ),
    };
    const pacote: ColumnDef<PacienteResumo> = {
      accessorKey: "saldo_sessoes",
      header: "Saldo de pacote",
      cell: ({ row }) =>
        row.original.saldo_sessoes > 0 ? (
          <span className="whitespace-nowrap">
            {row.original.saldo_sessoes}{" "}
            {plural(row.original.saldo_sessoes, "sessão", "sessões")}
          </span>
        ) : (
          <span className="text-text-tertiary">Sem pacote</span>
        ),
    };
    const etiquetas: ColumnDef<PacienteResumo> = {
      id: "etiquetas",
      header: "Etiquetas",
      cell: ({ row }) => (
        <EtiquetasDoPaciente
          etiquetas={etiquetasDoPaciente(row.original, agora)}
        />
      ),
    };

    if (telaEstreita) {
      return [nome, telefone, proxima, comparecimento, etiquetas];
    }
    return [
      nome,
      telefone,
      convenio,
      ultima,
      proxima,
      comparecimento,
      pacote,
      etiquetas,
    ];
  }, [timezone, telaEstreita, agora]);

  return (
    <DataTable
      columns={columns}
      data={pacientes}
      onRowClick={onAbrirFicha}
      className="text-sm"
    />
  );
}
