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

// Tokens do Conduzza Design System (docs/06, secao 4.3). Os valores vivem no
// app/globals.css; esta pagina so mostra, nos dois temas.
const SURFACE_TOKENS = [
  { name: "--background", label: "Fundo da aplicação (papel)" },
  { name: "--surface-1", label: "Superfície 1" },
  { name: "--surface-2", label: "Superfície 2 (card)" },
  { name: "--surface-subtle", label: "Superfície sutil (cabeçalho, rodapé)" },
  { name: "--surface-3", label: "Superfície 3 (hover)" },
  { name: "--surface-4", label: "Superfície 4 (afundado, trilho)" },
  { name: "--surface-5", label: "Superfície 5 (pressionado)" },
  { name: "--surface-6", label: "Superfície 6" },
  { name: "--border", label: "Fio de cartão e linha" },
  { name: "--border-strong", label: "Fio de botão, menu e tag" },
  { name: "--input", label: "Borda de campo e controle" },
  { name: "--inverse", label: "Invertido (botão sólido, dica)" },
  { name: "--sidebar", label: "Sidebar (fixa nos 2 temas)" },
];

const TEXT_TOKENS = [
  { name: "--text-strong", label: "Texto forte (títulos, números)" },
  { name: "--foreground", label: "Texto do corpo" },
  { name: "--text-secondary", label: "Texto secundário" },
  { name: "--text-tertiary", label: "Texto terciário" },
  { name: "--primary-text", label: "Lime como texto e link" },
];

const ACCENT_TOKENS = [
  { name: "--primary", label: "Preenchimento da marca (nunca texto)" },
  { name: "--primary-soft", label: "Selecionado e botão suave" },
  { name: "--primary-edge", label: "Indicador de seleção" },
  { name: "--focus", label: "Contorno de foco" },
  { name: "--chart-bar", label: "Barra de dado" },
  { name: "--chart-bar-muted", label: "Barra neutra" },
];

const SEMANTIC_TOKENS = [
  { name: "--ai", label: "IA (lime suave, reservado)" },
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
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-xs">
      <span
        className="size-9 shrink-0 rounded-md border border-border-strong"
        style={{ backgroundColor: `var(${name})` }}
      />
      <div className="grid min-w-0">
        <span className="text-[13px] font-semibold text-text-strong">
          {label}
        </span>
        <code className="cz-num text-xs text-text-tertiary">{name}</code>
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
      <h2 className="cz-eyebrow text-text-secondary">{title}</h2>
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

        <Section title="Acento lime">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {ACCENT_TOKENS.map((token) => (
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
          <div className="grid gap-3 rounded-card border border-border bg-card p-5 shadow-sm">
            <p className="cz-num text-[34px] leading-none font-semibold text-text-strong">
              R$ 12.480,00
            </p>
            <p className="text-[24px] leading-[1.2] font-bold tracking-[-0.02em] text-text-strong">
              Título de página, 24px
            </p>
            <p className="text-[19px] leading-[1.25] font-bold tracking-[-0.015em] text-text-strong">
              Título de modal e da barra superior, 19px
            </p>
            <p className="text-base leading-[1.3] font-bold tracking-[-0.01em] text-text-strong">
              Título de cartão, 16px
            </p>
            <p className="text-sm">
              Corpo de 14px com altura de linha 1,5, o tamanho padrão de leitura
              da interface.
            </p>
            <p className="text-xs font-semibold">Rótulo de campo, 12px</p>
            <p className="text-[11px] text-text-tertiary">
              Legenda e metadado, 11px
            </p>
            <p className="cz-eyebrow text-text-secondary">Eyebrow, 10px</p>
            <p className="cz-num text-sm">
              (84) 99104-0914 · 14:30 · R$ 400,00
            </p>
          </div>
        </Section>

        <Section title="Acento, seleção e foco">
          <div className="grid gap-3 rounded-card border border-border bg-card p-5 shadow-sm">
            <p className="text-sm">
              Link e ícone de destaque em{" "}
              <span className="font-semibold text-primary-text">
                lime como texto
              </span>
              , nunca no lime de preenchimento.
            </p>
            <div className="rounded-md border-l-2 border-l-primary-edge bg-primary-soft px-3 py-2.5 text-sm">
              Linha selecionada, com{" "}
              <span className="font-semibold text-primary-text">
                borda de indicador
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex h-10 items-center rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground">
                Preenchimento lime
              </span>
              <span className="inline-flex h-10 items-center rounded-lg bg-inverse px-3.5 text-sm font-semibold text-inverse-foreground">
                Invertido
              </span>
              <span className="inline-flex h-10 items-center rounded-lg border border-input bg-card px-3.5 text-sm outline-2 outline-offset-2 outline-focus outline-solid">
                Campo com foco
              </span>
            </div>
            <div className="grid gap-2 rounded-xl bg-background p-3">
              <p className="max-w-[80%] justify-self-start rounded-bubble border border-border bg-card px-3 py-2 text-sm">
                Mensagem do paciente
                <span className="block cz-num text-[11px] text-text-secondary">
                  14:30
                </span>
              </p>
              <p className="max-w-[80%] justify-self-end rounded-bubble bg-bubble-out px-3 py-2 text-sm text-bubble-out-foreground">
                Resposta da atendente
                <span className="block cz-num text-[11px] text-(--bubble-out-meta)">
                  14:31
                </span>
              </p>
              <p className="max-w-[80%] justify-self-end rounded-bubble border border-(--bubble-ai-border) bg-bubble-ai px-3 py-2 text-sm text-bubble-ai-foreground">
                Resposta da IA
                <span className="block cz-num text-[11px] text-(--bubble-ai-meta)">
                  14:32
                </span>
              </p>
            </div>
          </div>
        </Section>

        <Section title="Status de agendamento, os 10">
          <div className="flex flex-wrap gap-2 rounded-card border border-border bg-card p-5 shadow-sm">
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
          <div className="flex flex-wrap gap-2 rounded-card border border-border bg-card p-5 shadow-sm">
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
          <div className="grid gap-6 rounded-card border border-border bg-card p-5 shadow-sm">
            <ListSkeleton rows={3} />
            <TableSkeleton rows={2} columns={4} />
            <CardsSkeleton cards={4} />
          </div>
        </Section>

        <Section title="Tabela de dados">
          <DataTable columns={DEMO_COLUMNS} data={DEMO_ROWS} />
        </Section>

        <Section title="Botões">
          <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-card p-5 shadow-sm">
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
