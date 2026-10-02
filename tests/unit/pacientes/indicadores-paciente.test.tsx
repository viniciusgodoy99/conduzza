import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Os 3 cartoes da ficha migrados para o cartao de metrica unico (Fase 3)
// sem mudar o que o e2e de Pacientes le: o span do rotulo e filho DIRETO do
// cartao (o helper cartao() sobe um nivel a partir do texto exato do
// rotulo), e o texto do cartao contem "33%" colado.

vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

const { IndicadoresPaciente } =
  await import("@/components/pacientes/indicadores-paciente");

/** textContent de um trecho: as tags somem sem inserir espaco. */
function textContent(markup: string): string {
  return markup.replace(/<[^>]+>/g, "");
}

/** O pai do span com o texto exato do rotulo (o cartao() do e2e). */
function cartao(markup: string, rotulo: string): string {
  const grupos = markup.split('<div role="group"').slice(1);
  const achado = grupos.find((grupo) =>
    new RegExp(`^[^>]*><span id="[^"]+"[^>]*>${rotulo}<svg`).test(grupo),
  );
  expect(achado, `cartao "${rotulo}"`).toBeDefined();
  return achado!;
}

describe("IndicadoresPaciente", () => {
  it("mantem rotulos, valores e o DOM que o e2e usa", () => {
    const markup = renderToStaticMarkup(
      <IndicadoresPaciente
        indicadores={{
          totalConsultas: 3,
          faltas: 2,
          taxaComparecimento: 1 / 3,
        }}
      />,
    );
    expect(textContent(cartao(markup, "Total de consultas"))).toContain("3");
    expect(textContent(cartao(markup, "Faltas"))).toContain("2");
    const taxa = cartao(markup, "Taxa de comparecimento");
    expect(textContent(taxa)).toContain("33%");
    // A barra de comparecimento continua, com o rotulo acessivel.
    expect(taxa).toContain('aria-label="33% de comparecimento"');
  });

  it("sem consulta realizada a taxa nao existe: 'Ainda não medido' com a dica", () => {
    const markup = renderToStaticMarkup(
      <IndicadoresPaciente
        indicadores={{ totalConsultas: 0, faltas: 0, taxaComparecimento: null }}
      />,
    );
    const taxa = cartao(markup, "Taxa de comparecimento");
    expect(taxa).toContain('data-estado="nao-medido"');
    expect(taxa).toContain("Ainda não medido");
    expect(taxa).toContain("data-dica=");
    expect(textContent(taxa)).not.toContain("%");
  });

  it("profissional: o rotulo diz que e so a agenda dele", () => {
    const markup = renderToStaticMarkup(
      <IndicadoresPaciente
        indicadores={{ totalConsultas: 1, faltas: 0, taxaComparecimento: 1 }}
        soDaSuaAgenda
      />,
    );
    expect(textContent(cartao(markup, "Faltas na sua agenda"))).toContain("0");
    expect(
      textContent(cartao(markup, "Taxa de comparecimento na sua agenda")),
    ).toContain("100%");
  });

  it("sem lime: nenhum cartao em destaque na ficha", () => {
    const markup = renderToStaticMarkup(
      <IndicadoresPaciente
        indicadores={{
          totalConsultas: 3,
          faltas: 2,
          taxaComparecimento: 1 / 3,
        }}
      />,
    );
    expect(markup).not.toContain("bg-primary");
  });
});
