"use client";

import { CalendarPlus, Inbox } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import {
  CardsSkeleton,
  ListSkeleton,
  TableSkeleton,
} from "@/components/shared/loading-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { StatusChip } from "@/components/shared/status-chip";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  APPOINTMENT_STATUS,
  CONVERSATION_STATUS,
  type AppointmentStatus,
  type ConversationStatus,
} from "@/lib/design/status";

const SURFACE_TOKENS = [
  { name: "--background", label: "Fundo da aplicação" },
  { name: "--surface-1", label: "Superfície 1" },
  { name: "--surface-2", label: "Superfície 2 (card)" },
  { name: "--surface-3", label: "Superfície 3" },
  { name: "--surface-4", label: "Superfície 4" },
  { name: "--surface-5", label: "Superfície 5 (seleção)" },
  { name: "--surface-6", label: "Superfície 6" },
  { name: "--border", label: "Divisor decorativo" },
  { name: "--input", label: "Borda de campo e controle" },
  { name: "--sidebar", label: "Sidebar (fixa nos 2 temas)" },
];

const TEXT_TOKENS = [
  { name: "--foreground", label: "Texto primário" },
  { name: "--text-secondary", label: "Texto secundário" },
  { name: "--text-tertiary", label: "Texto terciário" },
];

const SEMANTIC_TOKENS = [
  { name: "--primary", label: "Ação primária (lime da marca)" },
  { name: "--ai", label: "IA (violeta, reservado)" },
  { name: "--info", label: "Informativo (azul)" },
  { name: "--success", label: "Confirmado (verde)" },
  { name: "--warning", label: "Atenção (âmbar)" },
  { name: "--alert", label: "Falta e erro (vermelho)" },
  { name: "--neutral", label: "Neutro" },
];

type DemoRow = { item: string; quantidade: number; valor: string };

const DEMO_ROWS: DemoRow[] = [
  { item: "Consultas do dia", quantidade: 18, valor: "R$ 4.320,00" },
  { item: "Confirmações pendentes", quantidade: 6, valor: "R$ 1.440,00" },
  { item: "Horários reofertados", quantidade: 3, valor: "R$ 720,00" },
];

const DEMO_COLUMNS: ColumnDef<DemoRow, unknown>[] = [
  { accessorKey: "item", header: "Item" },
  {
    accessorKey: "quantidade",
    header: "Quantidade",
    meta: { align: "right" },
  },
  { accessorKey: "valor", header: "Valor", meta: { align: "right" } },
];

function Swatch({ name, label }: { name: string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <span
        className="size-9 shrink-0 rounded-md border"
        style={{ backgroundColor: `var(${name})` }}
      />
      <div className="grid">
        <span className="text-sm font-medium">{label}</span>
        <code className="font-mono text-xs text-text-tertiary">{name}</code>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <h2 className="text-[10.5px] font-semibold tracking-[0.08em] text-text-secondary uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function TokensView() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto grid max-w-5xl gap-10 p-8">
        <PageHeader
          title="Design system"
          description="Paleta, tipografia, chips de status e componentes compartilhados, nos dois temas"
        >
          <ThemeToggle />
        </PageHeader>

        <Section title="Superfícies">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {SURFACE_TOKENS.map((token) => (
              <Swatch key={token.name} {...token} />
            ))}
          </div>
        </Section>

        <Section title="Texto">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {TEXT_TOKENS.map((token) => (
              <Swatch key={token.name} {...token} />
            ))}
          </div>
        </Section>

        <Section title="Cores semânticas">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {SEMANTIC_TOKENS.map((token) => (
              <Swatch key={token.name} {...token} />
            ))}
          </div>
        </Section>

        <Section title="Tipografia">
          <div className="grid gap-3 rounded-lg border bg-card p-5">
            <p className="text-4xl font-bold tracking-tight tabular-nums">
              R$ 12.480,00
            </p>
            <p className="text-[22px] font-semibold">Título de página, 22px</p>
            <p className="text-[15px] font-semibold">Título de card, 15px</p>
            <p className="text-sm">
              Corpo de 14px com altura de linha 1.5, o tamanho padrão de leitura
              da interface.
            </p>
            <p className="text-xs font-medium">Rótulo e metadado, 12px</p>
            <p className="text-[11px] font-medium tracking-[0.04em] text-text-tertiary uppercase">
              Micro, timestamp, 11px
            </p>
            <p className="font-mono text-sm tabular-nums">
              (84) 99104-0914 · 14:30 · R$ 400,00
            </p>
          </div>
        </Section>

        <Section title="Status de agendamento, os 10">
          <div className="flex flex-wrap gap-2 rounded-lg border p-5">
            {(Object.keys(APPOINTMENT_STATUS) as AppointmentStatus[]).map(
              (status) => (
                <StatusChip
                  key={status}
                  definition={APPOINTMENT_STATUS[status]}
                />
              ),
            )}
          </div>
        </Section>

        <Section title="Status de conversa, os 4">
          <div className="flex flex-wrap gap-2 rounded-lg border p-5">
            {(Object.keys(CONVERSATION_STATUS) as ConversationStatus[]).map(
              (status) =>
                status === "em_atendimento" ? (
                  <StatusChip
                    key={status}
                    definition={CONVERSATION_STATUS[status]}
                    label="Marina"
                    avatarInitials="MA"
                  />
                ) : (
                  <StatusChip
                    key={status}
                    definition={CONVERSATION_STATUS[status]}
                  />
                ),
            )}
          </div>
        </Section>

        <Section title="Estados vazios">
          <div className="grid gap-4 lg:grid-cols-2">
            <EmptyState
              icon={CalendarPlus}
              title="Nenhuma consulta agendada"
              description="Quando a primeira consulta for marcada, ela aparece aqui."
              action={{ label: "Agendar consulta" }}
            />
            <EmptyState
              icon={Inbox}
              title="Nenhum resultado com esses filtros"
              description="Ajuste os filtros ou limpe tudo para ver a lista completa."
              onClearFilters={() => undefined}
            />
          </div>
        </Section>

        <Section title="Esqueletos de carregamento">
          <div className="grid gap-6 rounded-lg border p-5">
            <ListSkeleton rows={3} />
            <TableSkeleton rows={2} columns={4} />
            <CardsSkeleton cards={4} />
          </div>
        </Section>

        <Section title="Tabela de dados">
          <DataTable columns={DEMO_COLUMNS} data={DEMO_ROWS} />
        </Section>

        <Section title="Botões">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-5">
            <Button>Ação principal</Button>
            <Button variant="secondary">Secundária</Button>
            <Button variant="outline">Contorno</Button>
            <Button variant="ghost">Fantasma</Button>
            <Button variant="destructive">Destrutiva</Button>
            <Button disabled>Desabilitada</Button>
          </div>
        </Section>
      </div>
    </main>
  );
}
