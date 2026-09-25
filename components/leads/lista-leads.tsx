"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import {
  dataLocal,
  rotuloDoCanal,
  tempoRelativo,
} from "@/components/leads/rotulos";
import { DataTable } from "@/components/shared/data-table";
import { StatusChip } from "@/components/shared/status-chip";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { CONSENT_STATUS, STATUS_TONE_VARS } from "@/lib/design/status";
import {
  definicaoDaEtapa,
  porChave,
  type EtapaDaJornada,
} from "@/lib/domain/jornada";
import { formatarTelefone } from "@/lib/domain/telefone";
import type { LeadResumo } from "@/lib/queries/leads";
import { cn } from "@/lib/utils";

// Visao em lista da Tela 4: tabela densa dentro de um Card, com cabecalho
// grudado e selecao multipla para as acoes em massa (docs/06 secao 5.4). A
// linha marcada ganha o selecionado do DS (lime suave e fio a esquerda). A
// autorizacao segue as 3 camadas (icone, rotulo, cor) do CONSENT_STATUS:
// nunca so cor.
//
// O NOME e um botao de verdade, do mesmo jeito que o cartao do Kanban: abaixo
// de 1024px a tela forca a lista, e sem ele o drawer so abriria com o mouse. O
// clique na linha continua valendo, e o botao segura o evento (o
// stopPropagation) para o drawer nao abrir duas vezes. Botao, e nao link,
// porque o drawer nao tem URL propria.

function Autorizacao({ autorizado }: { autorizado: boolean }) {
  const definicao = autorizado
    ? CONSENT_STATUS.autorizado
    : CONSENT_STATUS.sem_autorizacao;
  const Icone = definicao.icon;
  return (
    <span
      className="flex items-center gap-1.5 font-medium whitespace-nowrap"
      style={{ color: STATUS_TONE_VARS[definicao.tone].text }}
    >
      {Icone ? <Icone className="size-[15px] shrink-0" aria-hidden /> : null}
      {autorizado ? "Autorizado" : "Sem autorização"}
    </span>
  );
}

export function ListaLeads({
  leads,
  membros,
  jornada,
  timezone,
  selecionados,
  onSelecionar,
  onSelecionarTodos,
  onAbrirLead,
}: {
  leads: LeadResumo[];
  membros: Record<string, string>;
  jornada: EtapaDaJornada[];
  timezone: string;
  selecionados: ReadonlySet<string>;
  onSelecionar: (id: string, marcado: boolean) => void;
  onSelecionarTodos: (ids: string[], marcado: boolean) => void;
  onAbrirLead: (lead: LeadResumo) => void;
}) {
  const defs = useMemo(() => porChave(jornada), [jornada]);
  const columns = useMemo<ColumnDef<LeadResumo>[]>(() => {
    const marcadosNaTela = leads.filter((lead) =>
      selecionados.has(lead.id),
    ).length;
    const cabecalho: boolean | "indeterminate" =
      leads.length > 0 && marcadosNaTela === leads.length
        ? true
        : marcadosNaTela > 0
          ? "indeterminate"
          : false;
    return [
      {
        id: "selecao",
        header: () => (
          <span className="flex">
            <Checkbox
              aria-label="Selecionar todos os leads visíveis"
              checked={cabecalho}
              onCheckedChange={(v) =>
                onSelecionarTodos(
                  leads.map((lead) => lead.id),
                  // Indeterminado vira "marcar todos", como nos leitores de
                  // planilha: o proximo clique desmarca.
                  v === true || v === "indeterminate",
                )
              }
            />
          </span>
        ),
        cell: ({ row }) => (
          <span className="flex" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              aria-label={`Selecionar ${row.original.name ?? formatarTelefone(row.original.phone_e164)}`}
              checked={selecionados.has(row.original.id)}
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
              aria-label={`Abrir ${lead.name ?? `Sem nome, ${formatarTelefone(lead.phone_e164)}`}`}
              onClick={(evento) => {
                evento.stopPropagation();
                onAbrirLead(lead);
              }}
              className={cn(
                "flex h-10 max-w-[240px] min-w-0 items-center gap-2 rounded-md text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
                lead.name
                  ? "font-semibold text-text-strong"
                  : "text-text-secondary",
              )}
            >
              <ContactAvatar
                name={lead.name}
                phone={lead.phone_e164}
                size={24}
              />
              <span className="truncate">{lead.name ?? "Sem nome"}</span>
            </button>
          );
        },
      },
      {
        accessorKey: "phone_e164",
        header: "Telefone",
        cell: ({ row }) => (
          <span className="cz-num whitespace-nowrap">
            {formatarTelefone(row.original.phone_e164)}
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
        cell: ({ row }) => {
          // Etapa fora da jornada nao derruba a linha: mostra a chave crua,
          // que pelo menos diz a verdade (o banco impede o caso; isto cobre
          // cache velho na troca de jornada).
          const def = defs.get(row.original.funnel_stage);
          return def ? (
            <StatusChip size="sm" definition={definicaoDaEtapa(def)} />
          ) : (
            <span className="text-text-secondary">
              {row.original.funnel_stage}
            </span>
          );
        },
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
            <span className="whitespace-nowrap text-text-secondary">
              Sem contato
            </span>
          ),
      },
      {
        accessorKey: "first_contact_at",
        header: "Entrou em",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {dataLocal(row.original.first_contact_at, timezone)}
          </span>
        ),
      },
      {
        accessorKey: "consent_ativo",
        header: "Autorização",
        cell: ({ row }) => (
          <Autorizacao autorizado={row.original.consent_ativo} />
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
    defs,
  ]);

  return (
    <Card>
      <DataTable
        variant="bare"
        stickyHeader
        columns={columns}
        data={leads}
        onRowClick={onAbrirLead}
        isRowSelected={(lead) => selecionados.has(lead.id)}
        containerClassName="max-h-[min(720px,calc(100dvh-16rem))] cz-scroll"
      />
    </Card>
  );
}
