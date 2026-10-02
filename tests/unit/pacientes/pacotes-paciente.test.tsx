import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Saldo de pacote na ficha (pacote com varios procedimentos, pedido do dono
// em 29/09/2026): um cartao por VENDA, com o nome do pacote, a validade da
// venda e uma barra por PROCEDIMENTO, cujo rotulo acessivel diz de qual
// procedimento e. Os dialogos do Radix renderizam em portal, que nao existe
// no servidor: fechados, aqui eles nao renderizam nada.

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-parte="dialog">{children}</div> : null,
  DialogContent: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));

// A dica vira atributo, para o teste ler o porque do botao desabilitado.
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

vi.mock("@/app/(app)/pacientes/actions", () => ({
  venderPacoteAction: vi.fn(),
  ajustarSaldoDePacoteAction: vi.fn(),
  cancelarVendaDePacoteAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { PacotesPaciente } =
  await import("@/components/pacientes/pacotes-paciente");

const HOJE = "2026-09-29";

const VENDA = {
  id: "venda-1",
  package_id: "pacote-1",
  package_name: "Harmonização",
  expires_at: "2026-12-31",
  created_at: "2026-09-01T12:00:00Z",
  itens: [
    {
      id: "item-botox",
      procedure_id: "botox",
      procedure_name: "Botox",
      sessions_total: 2,
      sessions_used: 1,
    },
    {
      id: "item-facelift",
      procedure_id: "facelift",
      procedure_name: "Facelift",
      sessions_total: 1,
      sessions_used: 0,
    },
  ],
};

function render(
  props: Partial<ComponentProps<typeof PacotesPaciente>> = {},
): string {
  return renderToStaticMarkup(
    <PacotesPaciente
      contactId="contato-1"
      pacotes={[VENDA]}
      pacotesDoCatalogo={[]}
      pacotesCadastrados={1}
      saldosQueJaDescontaram={[]}
      hojeNaClinica={HOJE}
      podeEditar
      dica="Seu perfil não pode editar leads e pacientes"
      podeCancelarVenda
      dicaCancelarVenda="Só administrador e gestor cancelam venda de pacote"
      {...props}
    />,
  );
}

describe("cartão da venda de pacote na ficha", () => {
  it("um cartão por venda, com o nome do pacote e o que resta na venda", () => {
    const html = render();
    expect(html).toContain(">Harmonização</h3>");
    expect(html).toContain("2 sessões restantes");
    expect(html).toContain("Vale até ");
    expect(html).toContain("31/12/2026");
  });

  it("uma barra por procedimento, e cada barra diz de qual procedimento é", () => {
    const html = render();
    expect(html).toContain('aria-label="Procedimentos de Harmonização"');
    expect(html).toContain('aria-label="Botox: 1 de 2 sessões usadas"');
    expect(html).toContain('aria-label="Facelift: 0 de 1 sessão usada"');
    expect(html.match(/role="img"/g)).toHaveLength(2);
  });

  it("venda vencida: zero restante e as barras dizem que venceu", () => {
    const html = render({
      pacotes: [{ ...VENDA, expires_at: "2026-09-01" }],
    });
    expect(html).toContain("Venceu em ");
    expect(html).toContain("0 sessões restantes");
    expect(html).toContain(
      'aria-label="Botox: pacote vencido, sem sessões para usar"',
    );
  });

  it("venda que já descontou: Cancelar venda visível, desabilitado, com o porquê", () => {
    const html = render({ saldosQueJaDescontaram: ["venda-1"] });
    expect(html).toContain(
      'data-dica="Esta venda já descontou sessão de consulta. Para corrigir, use Ajustar saldo."',
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Cancelar venda/u);
  });

  it("sem venda, o bloco diz isso em texto", () => {
    expect(render({ pacotes: [] })).toContain(
      "Nenhum pacote vendido para este paciente.",
    );
  });
});
