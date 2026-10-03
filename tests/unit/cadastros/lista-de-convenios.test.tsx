import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Lista de marcar convenios dos modais de Cadastros (convenio pelo medico,
// decisao do dono em 02/10/2026): fieldset com legend, linhas de 40px,
// inativo so no fim e com o selo em 3 camadas, nota ligada a caixa, vazio em
// texto (D6) e, para quem so le, a lista visivel, desabilitada e com a dica
// do papel. A legenda pode ficar so para o leitor de tela (Ver detalhes do
// Profissional, onde o rotulo ja esta a vista).

// O Tooltip do Radix pede provedor; aqui a dica vira um atributo conferivel.
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

const { ListaDeConvenios } =
  await import("@/components/cadastros/lista-de-convenios");

const OPCOES: ComponentProps<typeof ListaDeConvenios>["opcoes"] = [
  { id: "conv-amil", nome: "Amil", plano: null, inativo: false },
  { id: "conv-sulamerica", nome: "SulAmérica", plano: null, inativo: true },
  {
    id: "conv-unimed",
    nome: "Unimed",
    plano: "Nacional",
    inativo: false,
    nota: "Marcado porque já está em uso em um procedimento deste profissional.",
  },
];

function render(
  props: Partial<ComponentProps<typeof ListaDeConvenios>> = {},
): string {
  return renderToStaticMarkup(
    <ListaDeConvenios
      legenda="Convênios que atende"
      opcoes={OPCOES}
      marcados={new Set(["conv-unimed", "conv-sulamerica"])}
      aoMudar={() => undefined}
      vazio="Nenhum convênio ativo."
      {...props}
    />,
  );
}

describe("ListaDeConvenios", () => {
  it("é um grupo com legenda visível e a ajuda ligada por aria-describedby", () => {
    const html = render({ ajuda: "O Particular vale sempre." });
    expect(html).toMatch(/^<fieldset/);
    expect(html).toMatch(
      /<legend class="mb-1\.5 text-xs font-semibold text-foreground">Convênios que atende<\/legend>/,
    );
    const ajuda =
      /<div id="([^"]+)" class="text-xs text-text-secondary">O Particular vale sempre\.<\/div>/.exec(
        html,
      );
    expect(ajuda).not.toBeNull();
    expect(html).toContain(`aria-describedby="${ajuda?.[1]}"`);
  });

  it("legendaOculta deixa a legenda só para o leitor de tela", () => {
    const html = render({ legendaOculta: true });
    expect(html).toMatch(
      /<legend class="[^"]*\bsr-only\b[^"]*">Convênios que atende<\/legend>/,
    );
  });

  it("linhas de 40px, ativos antes e o inativo no fim com o selo", () => {
    const html = render();
    expect(html.match(/class="flex min-h-10 /g)).toHaveLength(3);
    const amil = html.indexOf("Amil");
    const unimed = html.indexOf("Unimed");
    const sulamerica = html.indexOf("SulAmérica");
    expect(amil).toBeLessThan(unimed);
    expect(unimed).toBeLessThan(sulamerica);
    // Selo em 3 camadas (icone, rotulo e cor), so no inativo.
    expect(html.match(/Inativo/g)).toHaveLength(1);
    expect(html.indexOf("Inativo")).toBeGreaterThan(sulamerica);
    // O plano vem depois do nome.
    expect(html).toContain(
      'Unimed<span class="text-text-secondary"> · Nacional</span>',
    );
  });

  it("marca o que está no conjunto e liga a nota à caixa", () => {
    const html = render();
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="false"/g)).toHaveLength(1);
    const nota =
      /<p id="([^"]+)" class="[^"]*">Marcado porque já está em uso/.exec(html);
    expect(nota).not.toBeNull();
    expect(html).toContain(`aria-describedby="${nota?.[1]}"`);
  });

  it("sem opção, mostra só o texto do vazio (D6), sem caixa nem atalho", () => {
    const html = render({ opcoes: [] });
    expect(html).toContain("Nenhum convênio ativo.");
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<button");
  });

  it("quem só lê vê a lista desabilitada, com a dica do papel", () => {
    const html = render({
      podeEditar: false,
      dica: "Somente administradores e gestores alteram os cadastros.",
    });
    expect(html).toContain(
      'data-dica="Somente administradores e gestores alteram os cadastros."',
    );
    expect(html.match(/role="checkbox"[^>]*disabled=""/g)).toHaveLength(3);
    expect(html).toContain("cursor-not-allowed");
    expect(html).not.toContain("hover:bg-surface-3");
  });

  it("quem edita não tem dica nem caixa desabilitada", () => {
    const html = render();
    expect(html).not.toContain("data-dica");
    expect(html).not.toContain('disabled=""');
  });
});
