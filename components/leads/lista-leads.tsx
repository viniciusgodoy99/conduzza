"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { useMemo } from "react";

import {
  dataLocal,
  rotuloDoCanal,
  tempoRelativo,
} from "@/components/leads/rotulos";
import { DataTable } from "@/components/shared/data-table";
import { StatusChip } from "@/components/shared/status-chip";
import { Checkbox } from "@/components/ui/checkbox";
import { FUNNEL_STAGE } from "@/lib/design/status";
import type { LeadResumo } from "@/lib/queries/leads";
import { cn } from "@/lib/utils";

// Visao em lista da Tela 4: tabela densa com selecao multipla para as acoes
// em massa. Autorizacao segue as 3 camadas (icone, rotulo, cor), no padrao
// do chipAtivo: nunca so cor.
//
// O NOME e um botao de verdade, do mesmo jeito que o cartao do Kanban: abaixo
// de 1024px a tela forca a lista, e sem ele o drawer so abriria com o mouse. O
// clique na linha continua valendo, e o botao segura o evento (o
// stopPropagation) para o drawer nao abrir duas vezes. Botao, e nao link,
// porque o drawer nao tem URL propria.

export function ListaLeads({
  leads,
  membros,
  timezone,
  selecionados,
  onSelecionar,
  onSelecionarTodos,
  onAbrirLead,
}: {
  leads: LeadResumo[];
  membros: Record<string, string>;
  timezone: string;
  selecionados: string[];
  onSelecionar: (id: string, marcado: boolean) => void;
  onSelecionarTodos: (ids: string[], marcado: boolean) => void;
  onAbrirLead: (lead: LeadResumo) => void;
}) {
  const columns = useMemo<ColumnDef<LeadResumo>[]>(() => {
    const todosMarcados =
      leads.length > 0 && leads.every((lead) => selecionados.includes(lead.id));
    return [
      {
        id: "selecao",
        header: () => (
          <Checkbox
            aria-label="Selecionar todos os leads visíveis"
            checked={todosMarcados}
            onCheckedChange={(v) =>
              onSelecionarTodos(
                leads.map((lead) => lead.id),
                v === true,
              )
            }
          />
        ),
        cell: ({ row }) => (
          <span className="flex" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              aria-label={`Selecionar ${row.original.name ?? row.original.phone_e164}`}
              checked={selecionados.includes(row.original.id)}
              onCheckedChange={(v) => onSelecionar(row.original.id, v === true)}
            />
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: "Nome",
        cell: ({ row }) => {
          const lead = row.original;
          return (
            <button
              type="button"
              aria-label={`Abrir ${lead.name ?? `Sem nome, ${lead.phone_e164}`}`}
              onClick={(evento) => {
                evento.stopPropagation();
                onAbrirLead(lead);
              }}
              className={cn(
                "flex h-10 items-center rounded-md text-left underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                lead.name ? "font-medium" : "text-text-tertiary",
              )}
            >
              {lead.name ?? "Sem nome"}
            </button>
          );
        },
      },
      {
        accessorKey: "phone_e164",
        header: "Telefone",
        cell: ({ row }) => (
          <span className="font-mono text-[13px] whitespace-nowrap">
            {row.original.phone_e164}
          </span>
        ),
      },
      {
        accessorKey: "source_channel",
        header: "Origem",
        cell: ({ row }) => (
          <span className="text-text-secondary">
            {rotuloDoCanal(row.original.source_channel) ?? ""}
          </span>
        ),
      },
      {
        accessorKey: "source_campaign",
        header: "Campanha",
        cell: ({ row }) => (
          <span className="text-text-secondary">
            {row.original.source_campaign ?? ""}
          </span>
        ),
      },
      {
        accessorKey: "funnel_stage",
        header: "Etapa",
        cell: ({ row }) => (
          <StatusChip definition={FUNNEL_STAGE[row.original.funnel_stage]} />
        ),
      },
      {
        accessorKey: "owner_user_id",
        header: "Responsável",
        cell: ({ row }) => (
          <span className="text-text-secondary">
            {row.original.owner_user_id
              ? (membros[row.original.owner_user_id] ?? "")
              : ""}
          </span>
        ),
      },
      {
        accessorKey: "last_contact_at",
        header: "Último contato",
        cell: ({ row }) =>
          row.original.last_contact_at ? (
            <span className="whitespace-nowrap text-text-secondary">
              {tempoRelativo(row.original.last_contact_at)}
            </span>
          ) : (
            <span className="text-text-tertiary">Sem contato</span>
          ),
      },
      {
        accessorKey: "first_contact_at",
        header: "Entrou em",
        cell: ({ row }) => (
          <span className="font-mono text-[13px] whitespace-nowrap tabular-nums">
            {dataLocal(row.original.first_contact_at, timezone)}
          </span>
        ),
      },
      {
        accessorKey: "consent_ativo",
        header: "Autorização",
        cell: ({ row }) =>
          row.original.consent_ativo ? (
            <span className="flex items-center gap-1.5 whitespace-nowrap [color:var(--success-text)]">
              <ShieldCheck
                strokeWidth={1.5}
                className="size-4 shrink-0"
                aria-hidden
              />
              Autorizado
            </span>
          ) : (
            <span className="flex items-center gap-1.5 whitespace-nowrap text-text-tertiary">
              <ShieldOff
                strokeWidth={1.5}
                className="size-4 shrink-0"
                aria-hidden
              />
              Sem autorização
            </span>
          ),
      },
    ];
  }, [
    leads,
    membros,
    timezone,
    selecionados,
    onSelecionar,
    onSelecionarTodos,
    onAbrirLead,
  ]);

  return (
    <DataTable
      columns={columns}
      data={leads}
      onRowClick={onAbrirLead}
      className="text-sm"
    />
  );
}
