import { SquareX } from "lucide-react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ATIVIDADE_STATUS } from "@/lib/design/status";
import type { AtividadeResumo } from "@/lib/queries/atividades";

// O menu da linha de atividade e a tabela de icones reservados (docs/06 4.6,
// conflito C18; CLAUDE.md secao 5: nunca o mesmo icone em cores diferentes).
// O SquareX e o icone da situacao Cancelada, sempre neutral; o item
// "Cancelar atividade" usa o mesmo icone, no mesmo sentido, e por isso
// tambem fica neutro: nunca a variante destructive, que pinta o svg de
// alerta. O menu do Radix abre num portal, que o render no servidor nao
// desenha: aqui ele vira marcacao simples, com a variante num atributo.

vi.mock("@/app/(app)/atividades/actions", () => ({
  conversaDoContatoAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    variant = "default",
    disabled = false,
  }: {
    children: ReactNode;
    variant?: "default" | "destructive";
    disabled?: boolean;
  }) => (
    <div
      role="menuitem"
      data-variant={variant}
      data-disabled={disabled ? "" : undefined}
    >
      {children}
    </div>
  ),
}));

const { LinhaDeAtividade } =
  await import("@/components/atividades/linha-de-atividade");

const EU = "00000000-0000-4000-8000-000000000001";
const CONTATO = "00000000-0000-4000-8000-0000000000aa";
const DICA = "Seu perfil não pode alterar atividades";

function atividade(parcial: Partial<AtividadeResumo> = {}): AtividadeResumo {
  return {
    id: "00000000-0000-4000-8000-00000000a001",
    contact_id: CONTATO,
    conversation_id: null,
    titulo: "Ligar para lembrar do retorno",
    detalhes: null,
    due_on: "2026-10-05",
    due_at: null,
    assignee_user_id: EU,
    status: "pendente",
    origem: "manual",
    created_by: EU,
    completed_at: null,
    completed_by: null,
    canceled_at: null,
    created_at: "2026-09-01T12:00:00.000Z",
    contato: { id: CONTATO, nome: "Maria Clara", telefone: "+5585999990000" },
    ...parcial,
  };
}

const ACOES = {
  concluir: vi.fn(),
  reabrir: vi.fn(),
  cancelar: vi.fn(),
  adiar: vi.fn(),
  editar: vi.fn(),
};

function renderizar(item: AtividadeResumo, podeEditar: boolean): string {
  return renderToStaticMarkup(
    <ul>
      <LinhaDeAtividade
        atividade={item}
        forma="lista"
        ocupada={false}
        acoes={ACOES}
        contexto={{
          agora: new Date("2026-10-02T18:00:00.000Z"),
          hoje: "2026-10-02",
          timezone: "America/Fortaleza",
          nomes: { [EU]: "Ana Recepção" },
          ativos: [EU],
          eu: EU,
          podeEditar,
          dica: DICA,
        }}
      />
    </ul>,
  );
}

/** Cada item do menu, com os atributos e o miolo. */
function itensDoMenu(markup: string): string[] {
  return markup.split('<div role="menuitem"').slice(1);
}

function itemCancelar(markup: string): string {
  const item = itensDoMenu(markup).find((trecho) =>
    trecho.includes("Cancelar atividade"),
  );
  expect(item).toBeDefined();
  return item ?? "";
}

describe("Menu da atividade e o SquareX reservado", () => {
  it("a situação Cancelada é o SquareX neutro", () => {
    expect(ATIVIDADE_STATUS.cancelada.icon).toBe(SquareX);
    expect(ATIVIDADE_STATUS.cancelada.tone).toBe("neutral");
  });

  it("Cancelar atividade usa o SquareX e fica neutro, nunca destructive", () => {
    const markup = renderizar(atividade(), true);
    const item = itemCancelar(markup);
    expect(item).toContain("lucide-square-x");
    expect(item).toMatch(/^ data-variant="default"/);
    // Nenhum item do menu da atividade pinta o icone de alerta.
    expect(markup).not.toContain('data-variant="destructive"');
  });

  it("sem permissão: o item fica visível, desabilitado, neutro e com o motivo", () => {
    const markup = renderizar(atividade(), false);
    const item = itemCancelar(markup);
    expect(item).toContain("lucide-square-x");
    expect(item).toMatch(/^ data-variant="default" data-disabled=""/);
    expect(item).toContain(DICA);
    expect(markup).not.toContain('data-variant="destructive"');
  });

  it("o chip Cancelada e o item do menu mostram o mesmo ícone", () => {
    const cancelada = renderizar(
      atividade({
        status: "cancelada",
        canceled_at: "2026-10-01T12:00:00.000Z",
      }),
      true,
    );
    // Cancelada nao tem o item (o menu oferece Reabrir), mas o chip tem o
    // SquareX: e o mesmo icone que o item da pendente, e os dois neutros.
    expect(cancelada).toContain("lucide-square-x");
    expect(cancelada).toContain("Cancelada");
    expect(cancelada).not.toContain("Cancelar atividade");
    expect(cancelada).not.toContain('data-variant="destructive"');
  });
});
