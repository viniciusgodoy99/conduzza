import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { MetricasDaEspera } from "@/lib/queries/espera";

// "Desempenho da lista" da Tela 10 (Fase 3): barra so com denominador
// honesto (preenchidas de resolvidas, aceite na 1a oferta), tempo medio
// como numero, receita so para admin e gestor (null do banco = visivel,
// desabilitada e com a dica), e os estados vazio, carregando e erro, em que
// o erro nunca vira zero.

vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

const {
  PainelMetricas,
  DICA_SEM_ACESSO_A_REAIS,
  rodapeDasVagas,
  receitaDaEspera,
  rodapeDoAceite,
  tempoLegivel,
} = await import("@/components/espera/painel-metricas");

const NBSP = " ";

const METRICAS: MetricasDaEspera = {
  vagasOferecidas: 34,
  vagasPreenchidas: 24,
  vagasEmAndamento: 2,
  vagasCanceladas: 1,
  vagasEsgotadas: 7,
  primeiraOndaBase: 25,
  primeiraOndaAceita: 17,
  tempoMedioMin: 160,
  receitaCents: 1_234_500,
  vagasComValor: 24,
  vagasCobertas: 0,
  vagasSemPreco: 0,
};

function html(
  metricas: MetricasDaEspera | undefined,
  extra: { falhou?: boolean; tentando?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <PainelMetricas
      metricas={metricas}
      mes="Outubro de 2026"
      falhou={extra.falhou ?? false}
      tentando={extra.tentando ?? false}
      aoTentarDeNovo={() => undefined}
    />,
  );
}

function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("PainelMetricas, com dados", () => {
  it("vagas preenchidas: barra de preenchidas sobre resolvidas, '24 de 31'", () => {
    const markup = html(METRICAS);
    expect(texto(markup)).toContain("Vagas preenchidas 24 de 31");
    expect(markup).toContain(
      'aria-label="24 de 31 vagas resolvidas foram preenchidas"',
    );
    expect(texto(markup)).toContain("2 em andamento, 1 cancelada");
    // Destaque so na primeira barra (um por bloco), o aceite e neutro.
    expect(markup.indexOf("var(--chart-bar)")).toBeLessThan(
      markup.indexOf("var(--chart-bar-muted)"),
    );
  });

  it("aceite na 1a oferta: percentual com 1 casa e quantos aceitaram", () => {
    const markup = html(METRICAS);
    expect(texto(markup)).toContain("Aceite na 1ª oferta 68,0%");
    expect(texto(markup)).toContain("17 aceitas, 8 sem aceite");
    expect(markup).toContain(
      'aria-label="68,0% aceitaram na primeira oferta, 17 de 25"',
    );
  });

  it("tempo medio e numero, sem barra (nao tem maximo honesto)", () => {
    const markup = html(METRICAS);
    expect(texto(markup)).toContain("Tempo médio até o encaixe 2 h 40 min");
    expect(markup.match(/role="img"/g)).toHaveLength(2);
    expect(markup).toContain("lucide-timer-reset");
  });

  it("receita para admin e gestor: o valor cheio em reais", () => {
    const markup = html(METRICAS);
    expect(texto(markup)).toContain("Receita associada R$");
    // O NBSP do Intl continua no markup (o texto() o troca por espaco).
    expect(markup).toContain(`R$${NBSP}12.345,00`);
  });

  it("receita null do banco: visivel, 'Sem acesso' com a dica e nenhum R$", () => {
    const markup = html({
      ...METRICAS,
      receitaCents: null,
      vagasComValor: null,
      vagasCobertas: null,
      vagasSemPreco: null,
    });
    expect(texto(markup)).toContain("Receita associada Sem acesso");
    expect(markup).toContain(`data-dica="${DICA_SEM_ACESSO_A_REAIS}"`);
    expect(markup).not.toContain("R$");
  });

  it("receita zero de quem pode ver e zero mesmo, nao 'Sem acesso'", () => {
    const markup = html({ ...METRICAS, receitaCents: 0 });
    expect(markup).toContain(`R$${NBSP}0,00`);
    expect(markup).not.toContain("Sem acesso");
  });

  it("vagas só de convênio sem valor ou sem preço: 'Sem preço para somar', nunca R$ 0,00", () => {
    const markup = html({
      ...METRICAS,
      receitaCents: 0,
      vagasComValor: 0,
      vagasCobertas: 20,
      vagasSemPreco: 4,
    });
    expect(texto(markup)).toContain("Receita associada Sem preço para somar");
    expect(texto(markup)).toContain("20 de convênio sem valor, 4 sem preço cadastrado");
    expect(markup).not.toContain("R$");
  });

  it("parte das vagas fora da soma: o valor e o rodapé com o que ficou fora", () => {
    const markup = html({
      ...METRICAS,
      vagasComValor: 21,
      vagasCobertas: 1,
      vagasSemPreco: 2,
    });
    expect(markup).toContain(`R$${NBSP}12.345,00`);
    expect(texto(markup)).toContain(
      "Fora da soma: 1 de convênio sem valor, 2 sem preço cadastrado",
    );
  });

  it("nenhuma vaga resolvida: texto no lugar da barra, nunca barra de zero", () => {
    const markup = html({
      ...METRICAS,
      vagasPreenchidas: 0,
      vagasEsgotadas: 0,
      vagasEmAndamento: 3,
      vagasCanceladas: 0,
      primeiraOndaBase: 0,
      primeiraOndaAceita: 0,
      tempoMedioMin: null,
    });
    expect(texto(markup)).toContain(
      "Vagas preenchidas Nenhuma vaga resolvida ainda",
    );
    expect(texto(markup)).toContain("3 em andamento");
    expect(texto(markup)).toContain("Aceite na 1ª oferta Sem dados");
    expect(texto(markup)).toContain("Sem vaga preenchida");
    expect(markup).not.toContain('role="img"');
  });

  it("nenhum travessao no texto", () => {
    expect(html(METRICAS)).not.toContain("—");
  });
});

describe("PainelMetricas, estados", () => {
  it("vazio: nenhuma vaga entrou na reoferta no mes", () => {
    const markup = html({
      ...METRICAS,
      vagasOferecidas: 0,
      vagasPreenchidas: 0,
      vagasEmAndamento: 0,
      vagasCanceladas: 0,
      vagasEsgotadas: 0,
      primeiraOndaBase: 0,
      primeiraOndaAceita: 0,
      tempoMedioMin: null,
      receitaCents: 0,
    });
    expect(texto(markup)).toContain("Nenhuma vaga na reoferta neste mês");
    expect(texto(markup)).toContain("Outubro de 2026");
  });

  it("carregando: esqueleto com aviso para o leitor de tela, nenhum numero", () => {
    const markup = html(undefined);
    expect(markup).toContain('aria-busy="true"');
    expect(texto(markup)).toContain("Carregando o desempenho da lista");
    expect(markup).not.toContain("cz-num");
  });

  it("erro sem dado nunca vira zero: mensagem e tentar de novo", () => {
    const markup = html(undefined, { falhou: true });
    expect(texto(markup)).toContain("Não foi possível carregar o desempenho");
    expect(texto(markup)).toContain("Tentar de novo");
    expect(markup).not.toContain("cz-num");
    expect(markup).not.toContain("R$");
    expect(markup).not.toContain("aria-busy");
  });

  it("tentando de novo: o botao desabilita e diz que esta tentando", () => {
    const markup = html(undefined, { falhou: true, tentando: true });
    expect(texto(markup)).toContain("Tentando...");
    expect(markup).toContain("disabled");
  });
});

describe("textos puros do painel", () => {
  it("receitaDaEspera", () => {
    expect(receitaDaEspera({ ...METRICAS, receitaCents: null })).toEqual({
      estado: "sem-acesso",
    });
    expect(
      receitaDaEspera({ ...METRICAS, receitaCents: 0, vagasComValor: 0, vagasCobertas: 24 }),
    ).toEqual({ estado: "sem-preco", fora: "24 de convênio sem valor" });
    expect(receitaDaEspera(METRICAS)).toEqual({
      estado: "valor",
      centavos: 1_234_500,
      fora: null,
    });
  });

  it("tempoLegivel", () => {
    expect(tempoLegivel(45)).toBe("45 min");
    expect(tempoLegivel(60)).toBe("1 h");
    expect(tempoLegivel(160)).toBe("2 h 40 min");
  });

  it("rodapeDasVagas so mostra o que for maior que zero", () => {
    expect(rodapeDasVagas(METRICAS)).toBe("2 em andamento, 1 cancelada");
    expect(
      rodapeDasVagas({ ...METRICAS, vagasEmAndamento: 0, vagasCanceladas: 3 }),
    ).toBe("3 canceladas");
    expect(
      rodapeDasVagas({ ...METRICAS, vagasEmAndamento: 0, vagasCanceladas: 0 }),
    ).toBeNull();
  });

  it("rodapeDoAceite", () => {
    expect(rodapeDoAceite(METRICAS)).toBe("17 aceitas, 8 sem aceite");
    expect(
      rodapeDoAceite({
        ...METRICAS,
        primeiraOndaBase: 1,
        primeiraOndaAceita: 1,
      }),
    ).toBe("1 aceita");
  });
});
