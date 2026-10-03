import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { InvestimentoDoPeriodo } from "@/lib/queries/relatorios";

import { campanhasPeriodizadas } from "./dados-de-exemplo";

// O cartao Custo por lead de verdade (sem banco), em cada estado do contrato
// da Fase 4: o texto, a dica do "Ainda não medido", o rodape e nenhum numero
// em reais para quem nao e admin nem gestor.

vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

const { CartaoCustoPorLead } = await import(
  "@/components/relatorios/cartoes-de-valor"
);

const TZ = "America/Fortaleza";

function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cartao(
  investimento: Partial<InvestimentoDoPeriodo> | null = {},
  extra: Parameters<typeof campanhasPeriodizadas>[1] = {},
  podeVerValores = true,
): string {
  return renderToStaticMarkup(
    <CartaoCustoPorLead
      podeVerValores={podeVerValores}
      campanhas={campanhasPeriodizadas(investimento, extra)}
      timezone={TZ}
    />,
  );
}

describe("CartaoCustoPorLead", () => {
  it("recepção: Sem acesso, com a dica, sem nenhum R$ mesmo com o dado chegando", () => {
    const html = cartao({}, {}, false);
    expect(html).not.toContain("R$");
    expect(texto(html)).toContain("Sem acesso");
    expect(html).toContain(
      'data-dica="Só administrador e gestor veem valores em reais."',
    );
    expect(texto(html)).not.toContain("Atualizado em");
  });

  it("gestão que o banco tratou como sem acesso: Sem acesso, nunca zero", () => {
    const html = cartao(null);
    expect(texto(html)).toContain("Sem acesso");
    expect(html).not.toContain("R$");
  });

  it("sem leitura configurada: Ainda não medido, com a dica de onde ligar", () => {
    const html = cartao({ configurada: false, lidoDesde: null, sincronizadoEm: null });
    expect(html).toContain('data-estado="nao-medido"');
    expect(texto(html)).toContain("Ainda não medido");
    expect(html).toContain(
      'data-dica="Ligue a leitura do investimento em Configurações, aba Anúncios da Meta."',
    );
  });

  it("antes da primeira leitura: Ainda não medido, a leitura não terminou", () => {
    const html = cartao({ situacao: "nao_testada", lidoDesde: null, lidoAte: null, sincronizadoEm: null });
    expect(texto(html)).toContain("Ainda não medido");
    expect(html).toContain(
      'data-dica="A primeira leitura do investimento ainda não terminou."',
    );
  });

  it("período antes da leitura: Ainda não medido, com o dia a partir do qual é lido", () => {
    const html = cartao({ lidoDesde: "2026-09-04" });
    expect(texto(html)).toContain("Ainda não medido");
    expect(html).toContain(
      'data-dica="O investimento é lido a partir de 04/09/2026."',
    );
    expect(html).not.toContain("R$");
  });

  it("leitura parada em 13/09: Ainda não medido com a data, sem número nem variação", () => {
    const html = cartao({
      situacao: "com_problema",
      problema: "token_invalido",
      lidoAte: "2026-09-13",
      investimentoCents: 100_000,
    });
    expect(html).toContain('data-estado="nao-medido"');
    expect(texto(html)).toContain("Ainda não medido");
    expect(html).toContain(
      'data-dica="O investimento foi lido até 13/09/2026. A leitura do investimento está com problema. Veja o motivo em Configurações, aba Anúncios da Meta."',
    );
    expect(html).not.toContain("R$");
    expect(html).not.toContain('data-parte="variacao"');
    expect(texto(html)).not.toContain("Sem investimento no período");
  });

  it("conta em outro fuso: a linha de aviso no rodapé, junto do número", () => {
    const html = cartao({ fusoDaConta: "America/New_York" });
    const lido = texto(html);
    expect(lido).toContain("R$ 30,00");
    expect(lido).toContain(
      "Os dias do investimento seguem o fuso da conta de anúncios, diferente do fuso da clínica.",
    );
  });

  it("conta em São Paulo (mesmo deslocamento de Fortaleza): sem aviso de fuso", () => {
    expect(texto(cartao())).not.toContain("fuso da conta");
  });

  it("outra moeda: Conta em outra moeda, sem número", () => {
    const html = cartao({ moeda: "USD", outraMoeda: true });
    expect(html).toContain('data-estado="vazio"');
    expect(texto(html)).toContain("Conta em outra moeda");
    expect(html).not.toContain("R$");
  });

  it("sem gasto: Sem investimento no período, com o Atualizado em", () => {
    const html = cartao({ investimentoCents: 0 });
    expect(texto(html)).toContain("Sem investimento no período");
    expect(texto(html)).toContain("Atualizado em 02/10 às 06:00");
    expect(html).not.toContain("R$");
  });

  it("sem lead de anúncio: Nenhum lead de anúncio, com o investimento escrito", () => {
    const html = cartao({}, { leadsDeAnuncio: 0, leadsCasados: 0 });
    expect(texto(html)).toContain("Nenhum lead de anúncio");
    expect(texto(html)).toContain("R$ 4.860,00 investidos no período");
  });

  it("com valor: o número, o rodapé e a variação pela polaridade", () => {
    const html = cartao();
    expect(html).toContain('data-estado="valor"');
    const lido = texto(html);
    expect(lido).toContain("R$ 30,00");
    expect(lido).toContain("R$ 4.860,00 em 162 leads de anúncio");
    expect(lido).toContain("Atualizado em 02/10 às 06:00");
    // R$ 25,00 para R$ 30,00: subiu, e custo subir e ruim.
    expect(html).toMatch(/data-sentido="subiu"[^>]*text-alert-text/);
  });

  it("sem variação quando o período anterior começa antes da leitura", () => {
    const html = cartao({ lidoDesde: "2026-08-20" });
    // O atual esta coberto (20/08 <= 03/09); o anterior (04/08) nao.
    expect(texto(html)).toContain("R$ 30,00");
    expect(html).not.toContain('data-parte="variacao"');
  });

  it("carregando e erro", () => {
    const carregando = renderToStaticMarkup(
      <CartaoCustoPorLead podeVerValores campanhas={undefined} timezone={TZ} />,
    );
    expect(carregando).toContain('data-estado="carregando"');
    const erro = renderToStaticMarkup(
      <CartaoCustoPorLead
        podeVerValores
        campanhas={undefined}
        timezone={TZ}
        erro
        tentarDeNovo={<button type="button">Tentar de novo</button>}
      />,
    );
    expect(erro).toContain('data-estado="erro"');
    expect(texto(erro)).toContain("Não foi possível carregar");
    expect(texto(erro)).toContain("Tentar de novo");
  });
});
