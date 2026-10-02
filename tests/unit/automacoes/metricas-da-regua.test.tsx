import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { MetricasDaRegua as Metricas } from "@/lib/queries/automacoes";

// Os 4 numeros da regua (Fase 3) no cartao de metrica unico, variante
// afundada de 24px: o nome do grupo e o rotulo, a nota de amostragem vira
// rodape so nos numeros que vem do detalhamento, e o esqueleto continua no
// container enquanto nao ha dado.

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const { MetricasDaRegua } =
  await import("@/components/automacoes/metricas-da-regua");

const CLINICA = "c1";
const REGUA = "r1";

function html(dados?: Metricas): string {
  const queryClient = new QueryClient();
  if (dados) {
    queryClient.setQueryData(["automacoes", CLINICA, "metricas", REGUA], dados);
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MetricasDaRegua clinicId={CLINICA} cadenceId={REGUA} />
    </QueryClientProvider>,
  );
}

const DADOS: Metricas = {
  enviadas30d: 1240,
  naFila: 3,
  puladasPorMotivo: [],
  entregues30d: 980,
  descadastros30d: 2,
  aproximado: false,
};

/** Markup de um cartao pelo rotulo. */
function cartao(markup: string, rotulo: string): string {
  const grupos = markup.split('<div role="group"').slice(1);
  const achado = grupos.find((grupo) => grupo.includes(`>${rotulo}<`));
  expect(achado, `cartao "${rotulo}"`).toBeDefined();
  return achado!;
}

describe("MetricasDaRegua", () => {
  it("4 cartoes afundados de 24px, com o numero em pt-BR", () => {
    const markup = html(DADOS);
    expect(markup.match(/role="group"/g)).toHaveLength(4);
    const enviadas = cartao(markup, "Enviadas");
    expect(enviadas).toContain("rounded-xl bg-surface-4");
    expect(enviadas).not.toContain("rounded-card");
    expect(enviadas).toContain("text-2xl");
    expect(enviadas).toContain(">1.240</span>");
    expect(cartao(markup, "Na fila")).toContain(">3</span>");
  });

  it("sem amostragem, nenhum rodape de amostra", () => {
    expect(html(DADOS)).not.toContain("toques mais recentes");
  });

  it("com amostragem, so Entregues e Descadastros levam a nota no rodape", () => {
    const markup = html({ ...DADOS, aproximado: true });
    expect(cartao(markup, "Entregues")).toContain("toques mais recentes");
    expect(cartao(markup, "Descadastros")).toContain("toques mais recentes");
    expect(cartao(markup, "Enviadas")).not.toContain("toques mais recentes");
    expect(cartao(markup, "Na fila")).not.toContain("toques mais recentes");
  });

  it("sem dado ainda: o esqueleto do container, nenhum numero", () => {
    const markup = html();
    expect(markup).not.toContain('role="group"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("cz-num");
  });
});
