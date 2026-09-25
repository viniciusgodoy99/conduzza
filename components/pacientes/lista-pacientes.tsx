"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useMemo } from "react";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { dataLocal } from "@/components/leads/rotulos";
import {
  BarraComparecimento,
  EtiquetasDoPaciente,
  plural,
  SemDado,
} from "@/components/pacientes/comum";
import { DataTable } from "@/components/shared/data-table";
import { etiquetasDoPaciente, indicadoresDe } from "@/lib/domain/pacientes-ui";
import { formatarTelefone } from "@/lib/domain/telefone";
import type { PacienteResumo } from "@/lib/queries/pacientes";
import { cn } from "@/lib/utils";

// Lista da Tela 9: as 8 colunas do brief. Abaixo de 1024px a tabela perde as
// colunas de apoio (convenio, ultima consulta e saldo) em vez de rolar sem
// fim: o essencial e quem e a pessoa, quando ela volta e o que a agenda
// precisa saber dela.
//
// O NOME e um link de verdade para a ficha: e o unico caminho que existe por
// teclado e por leitor de tela, e ainda da abrir em outra aba. O clique na
// linha continua valendo para o mouse, e o link segura o evento (o
// stopPropagation) para a navegacao acontecer uma vez so.

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
      cell: ({ row }) => {
        const paciente = row.original;
        return (
          <Link
            href={`/pacientes/${paciente.contact_id}`}
            // Um link POR LINHA da tabela: com prefetch, cada linha que entra
            // no viewport viraria um request de servidor (middleware + render
            // da ficha ate o loading.tsx). A ficha carrega no clique.
            prefetch={false}
            aria-label={`Abrir a ficha de ${paciente.name ?? `Sem nome, ${paciente.phone_e164}`}`}
            onClick={(evento) => evento.stopPropagation()}
            className={cn(
              "flex h-10 max-w-[260px] min-w-0 items-center gap-2 rounded-md underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
              paciente.name
                ? "font-semibold text-text-strong"
                : "text-text-secondary",
            )}
          >
            <ContactAvatar
              name={paciente.name}
              phone={paciente.phone_e164}
              size={24}
            />
            <span className="truncate">{paciente.name ?? "Sem nome"}</span>
          </Link>
        );
      },
    };
    const telefone: ColumnDef<PacienteResumo> = {
      accessorKey: "phone_e164",
      header: "Telefone",
      meta: { numeric: true },
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-text-secondary">
          {formatarTelefone(row.original.phone_e164)}
        </span>
      ),
    };
    const convenio: ColumnDef<PacienteResumo> = {
      accessorKey: "insurance_name",
      header: "Convênio",
      cell: ({ row }) =>
        row.original.insurance_name ? (
          <span>{row.original.insurance_name}</span>
        ) : (
          <span className="text-text-secondary">Particular</span>
        ),
    };
    const ultima: ColumnDef<PacienteResumo> = {
      accessorKey: "ultima_consulta",
      header: "Última consulta",
      meta: { align: "right", numeric: false },
      cell: ({ row }) =>
        row.original.ultima_consulta ? (
          <span className="cz-num whitespace-nowrap">
            {dataLocal(row.original.ultima_consulta, timezone)}
          </span>
        ) : (
          <SemDado texto="Nenhuma ainda" className="whitespace-nowrap" />
        ),
    };
    const proxima: ColumnDef<PacienteResumo> = {
      accessorKey: "proxima_consulta",
      header: "Próxima",
      meta: { align: "right", numeric: false },
      cell: ({ row }) =>
        row.original.proxima_consulta ? (
          <span className="cz-num whitespace-nowrap text-text-strong">
            {dataLocal(row.original.proxima_consulta, timezone)}
          </span>
        ) : (
          <span className="whitespace-nowrap text-text-secondary">
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
            <span className="cz-num">{row.original.saldo_sessoes}</span>{" "}
            {plural(row.original.saldo_sessoes, "sessão", "sessões")}
          </span>
        ) : (
          <span className="whitespace-nowrap text-text-secondary">
            Sem pacote
          </span>
        ),
    };
    const etiquetas: ColumnDef<PacienteResumo> = {
      id: "etiquetas",
      header: "Sinais automáticos",
      cell: ({ row }) => {
        const sinais = etiquetasDoPaciente(row.original, agora);
        // Campo vazio em texto (receita 4.7), nunca celula em branco.
        return sinais.length > 0 ? (
          <EtiquetasDoPaciente etiquetas={sinais} tamanho="sm" />
        ) : (
          <SemDado texto="Nenhum" />
        );
      },
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

  // Sem casca propria: a tabela mora dentro do cartao da tela, com o
  // cabecalho grudado enquanto as linhas rolam.
  return (
    <DataTable
      columns={columns}
      data={pacientes}
      onRowClick={onAbrirFicha}
      variant="bare"
      stickyHeader
      containerClassName="cz-scroll max-h-[min(720px,calc(100dvh-16rem))]"
    />
  );
}
