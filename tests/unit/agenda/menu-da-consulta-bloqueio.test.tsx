import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Revisao de 02/10/2026 (agenda-bloqueio 2): o bloqueio criado "mesmo assim"
// por cima de uma consulta fica coberto pelo bloco dela (z-[3] sobre a faixa
// em z-[1]) e nao dava para clicar na faixa para remover. Sem dar altura
// minima a faixa (mentiria a duracao e tomaria o clique do vao vizinho), o
// menu da consulta ganha a secao "Horario bloqueado": motivo com o Ban,
// periodo, encaixe e o mesmo "Remover bloqueio" da faixa, item de 40px,
// desabilitado com a dica para quem nao e admin nem gestor. O menu do Radix
// renderiza num portal so quando abre; aqui ele vira marcacao simples.

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => (
    <div role="group">{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div data-parte="rotulo">{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    disabled,
    className,
    variant,
    "aria-describedby": descrito,
  }: {
    children: ReactNode;
    disabled?: boolean;
    className?: string;
    variant?: string;
    "aria-describedby"?: string;
  }) => (
    <div
      role="menuitem"
      aria-disabled={disabled ? "true" : undefined}
      aria-describedby={descrito}
      className={className}
      data-variant={variant}
    >
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open ? <div data-parte="dialog">{children}</div> : null,
  DialogContent: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));

vi.mock("@/app/(app)/agenda/actions", () => ({
  aprovarEncaixeAction: vi.fn(),
  mudarStatusAction: vi.fn(),
  recusarEncaixeAction: vi.fn(),
  remarcarAgendamentoAction: vi.fn(),
}));
vi.mock("@/app/(app)/cadastros/actions", () => ({
  excluirBloqueioAction: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/components/agenda/status-history-sheet", () => ({
  StatusHistorySheet: () => null,
}));

const { AppointmentMenu } =
  await import("@/components/agenda/appointment-menu");
const { DICA_REMOVER_SEM_PERMISSAO } =
  await import("@/components/agenda/bloqueio-comum");

type Contexto = ComponentProps<typeof AppointmentMenu>["contexto"];
type Consulta = ComponentProps<typeof AppointmentMenu>["consulta"];
type Bloqueio = ComponentProps<typeof AppointmentMenu>["bloqueios"][number];

const TZ = "America/Fortaleza";
const JOAO = "1b1b1b1b-0000-4000-8000-000000000001";

function contexto(podeEditarCadastros: boolean): Contexto {
  return {
    clinicId: "0a0a0a0a-0000-4000-8000-00000000000a",
    timezone: TZ,
    catalogo: {
      profissionais: [
        {
          id: JOAO,
          name: "Dr. João Pereira",
          photo_url: null,
          council_type: null,
          council_number: null,
          specialties: [],
          calendar_color: null,
          active: true,
        },
      ],
      jornadas: [],
      recursos: [],
      procedimentos: [],
      convenios: [],
      vinculos: [],
      pacotes: [],
      unidades: [],
    },
    podeEditar: true,
    dica: "Seu perfil não pode alterar a agenda",
    viewerId: "usuario",
    podeEditarCadastros,
    dicaCadastros: "Somente administradores e gestores alteram cadastros",
    podeRegistrarAutorizacao: true,
    dicaAutorizacao: "",
  };
}

// 06/10/2026, 15:00 às 15:30 em Fortaleza (UTC-3).
const CONSULTA: Consulta = {
  id: "c0c0c0c0-0000-4000-8000-000000000001",
  unit_id: null,
  contact_id: "3d3d3d3d-0000-4000-8000-000000000001",
  professional_id: JOAO,
  service_link_id: "2c2c2c2c-0000-4000-8000-000000000001",
  resource_id: null,
  starts_at: "2026-10-06T18:00:00.000Z",
  ends_at: "2026-10-06T18:30:00.000Z",
  status: "agendado",
  confirmation_channel: null,
  is_overbooking: false,
  created_by: "usuario",
  approval_status: null,
  send_confirmation: true,
  notes: null,
  contact: { id: "c1", name: "Maria Souza", phone_e164: "+5585999990000" },
  service_link: {
    id: "2c2c2c2c-0000-4000-8000-000000000001",
    duration_min: 30,
    procedure: { id: "p1", name: "Consulta" },
    insurance: null,
  },
} as Consulta;

const REUNIAO: Bloqueio = {
  id: "b0b0b0b0-0000-4000-8000-000000000001",
  professional_id: JOAO,
  starts_at: "2026-10-06T18:00:00.000Z",
  ends_at: "2026-10-06T18:30:00.000Z",
  reason: "Reunião da equipe",
  blocks_overbooking: true,
};

function render(bloqueios: Bloqueio[], podeEditarCadastros = true): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AppointmentMenu
        contexto={contexto(podeEditarCadastros)}
        consulta={CONSULTA}
        bloqueios={bloqueios}
      >
        <button type="button">Maria Souza</button>
      </AppointmentMenu>
    </QueryClientProvider>,
  );
}

/** O item do menu cujo texto termina no rótulo dado, como marcação. */
function item(html: string, rotulo: string): string {
  const achado = new RegExp(
    `<div role="menuitem"[^>]*>(?:(?!</div>).)*${rotulo}</span></div>`,
  ).exec(html);
  if (!achado) {
    throw new Error(`item ${rotulo} não encontrado`);
  }
  return achado[0];
}

describe("AppointmentMenu com bloqueio por cima da consulta", () => {
  it("sem bloqueio cruzando, não mostra a seção", () => {
    const html = render([]);
    expect(html).not.toContain("Horário bloqueado");
    expect(html).not.toContain("Remover bloqueio");
  });

  it("mostra motivo, período, encaixe e o remover com 40px", () => {
    const html = render([REUNIAO]);
    expect(html).toContain("Horário bloqueado");
    expect(html).toContain("Reunião da equipe");
    expect(html).toContain("Dr. João Pereira");
    expect(html).toContain("06/10, das 15:00 às 15:30");
    expect(html).toContain("Impede encaixe");
    const remover = item(html, "Remover bloqueio");
    expect(remover).toContain("h-10");
    expect(remover).toContain('data-variant="destructive"');
    expect(remover).not.toContain("aria-disabled");
    expect(html).not.toContain(DICA_REMOVER_SEM_PERMISSAO);
  });

  it("o motivo vem com o ícone, nunca só cor", () => {
    const html = render([REUNIAO]);
    expect(html).toMatch(
      /<svg[^>]*lucide-ban[^>]*>(?:(?!<\/svg>).)*<\/svg><span[^>]*>Reunião da equipe<\/span>/,
    );
  });

  it("o item diz qual bloqueio sai (descrito pelo resumo)", () => {
    const html = render([REUNIAO]);
    const descrito = /aria-describedby="([^"]+)"/.exec(
      item(html, "Remover bloqueio"),
    )?.[1];
    expect(descrito).toBeTruthy();
    const resumo = new RegExp(
      `<div id="${descrito}"[^>]*>(?:(?!</div>).)*Reunião da equipe`,
    );
    expect(html).toMatch(resumo);
  });

  it("quem não é admin nem gestor vê o remover desabilitado, com a dica em aria-describedby", () => {
    const html = render([REUNIAO], false);
    const remover = item(html, "Remover bloqueio");
    expect(remover).toContain('aria-disabled="true"');
    const ids = /aria-describedby="([^"]+)"/.exec(remover)?.[1]?.split(" ");
    expect(ids).toHaveLength(2);
    const idDica = ids?.[1] ?? "";
    expect(html).toContain(
      `<p id="${idDica}" class="max-w-64 px-[9px] pb-1.5 text-xs whitespace-normal text-text-secondary">${DICA_REMOVER_SEM_PERMISSAO}</p>`,
    );
  });

  it("dois bloqueios cruzando: um remover para cada", () => {
    const html = render([
      REUNIAO,
      {
        ...REUNIAO,
        id: "b0b0b0b0-0000-4000-8000-000000000002",
        reason: "Curso",
        starts_at: "2026-10-06T17:00:00.000Z",
        ends_at: "2026-10-06T21:00:00.000Z",
        blocks_overbooking: false,
      },
    ]);
    expect(html.match(/Remover bloqueio/g)).toHaveLength(2);
    expect(html).toContain("Curso");
    expect(html).toContain("06/10, das 14:00 às 18:00");
    expect(html).toContain("Permite encaixe");
  });

  it("nenhum travessão no texto da seção", () => {
    const html = render([REUNIAO], false);
    const secao = html.slice(
      html.indexOf("Horário bloqueado"),
      html.indexOf(DICA_REMOVER_SEM_PERMISSAO) +
        DICA_REMOVER_SEM_PERMISSAO.length,
    );
    expect(secao).not.toMatch(/[–—]/);
  });
});
