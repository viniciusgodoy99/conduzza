import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ATENDIMENTO,
  CONVERSOES,
  FATURAMENTO,
  FUNIL,
  agenda,
  campanhasPeriodizadas,
} from "./dados-de-exemplo";

// As 4 abas de Resultados renderizadas de verdade (sem banco): a regra dos
// valores em reais na TELA (recepcao ve o cartao, desabilitado e sem
// numero), o objetivo desabilitado com dica para quem nao administra, e o
// custo por mensagem so com canal oficial.

vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

// As Server Actions puxam sessao e cookies; aqui so precisam existir.
vi.mock("@/app/(app)/relatorios/actions", () => ({
  definirObjetivoDeConversaoAction: vi.fn(),
  removerObjetivoDeConversaoAction: vi.fn(),
  registrarLinhaDeBaseAction: vi.fn(),
  registrarExportacaoDeRelatorioAction: vi.fn(),
}));

const { AbaVisaoGeral } = await import(
  "@/components/relatorios/aba-visao-geral"
);
const { AbaComercial } = await import("@/components/relatorios/aba-comercial");
const { AbaMarketing } = await import("@/components/relatorios/aba-marketing");
const { AbaAgenteIa } = await import("@/components/relatorios/aba-agente-ia");

const TZ = "America/Fortaleza";
const nada = () => undefined;

/** Texto sem tags, com espacos (inclusive o NBSP do Intl) normalizados. */
function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function visaoGeral(podeVerValores: boolean): string {
  return renderToStaticMarkup(
    <AbaVisaoGeral
      funil={{ atual: FUNIL, anterior: FUNIL }}
      agenda={{ atual: agenda(podeVerValores ? 15_000 : null), anterior: null }}
      atendimento={{ atual: ATENDIMENTO, anterior: null }}
      serie={[
        { dia: "2026-09-01", leads: 10, agendadas: 4 },
        { dia: "2026-09-02", leads: 3, agendadas: 1 },
      ]}
      serieComErro={false}
      aoTentarSerieDeNovo={nada}
      faturamento={
        podeVerValores ? { atual: FATURAMENTO, anterior: FATURAMENTO } : null
      }
      faturamentoComErro={false}
      aoTentarFaturamentoDeNovo={nada}
      // Dado da GESTAO mesmo para a recepcao: a tela nao pode vazar nada.
      campanhas={campanhasPeriodizadas()}
      campanhasComErro={false}
      aoTentarCampanhasDeNovo={nada}
      linhaDeBase={null}
      objetivo={{ percentual: 60, atualizadoEm: "2026-10-02T12:00:00Z" }}
      podeVerValores={podeVerValores}
      podeDefinirObjetivo={podeVerValores}
      timezone={TZ}
      aoMudarObjetivo={nada}
      irParaAba={nada}
    />,
  );
}

describe("Visão geral", () => {
  it("admin vê os 5 cartões, o faturamento compacto e o objetivo", () => {
    const html = visaoGeral(true);
    const lido = texto(html);
    for (const rotulo of [
      "Leads recebidos",
      "Consultas agendadas",
      "Taxa de conversão",
      "Custo por lead",
      "Faturamento estimado",
    ]) {
      expect(lido).toContain(rotulo);
    }
    expect(lido).toContain("R$ 284 mil");
    // Valor cheio para o leitor de tela, com o NBSP do Intl no HTML.
    expect(html).toContain("R$\u00a0284.000,00");
    expect(lido).toContain("Objetivo: 60%");
    expect(lido).toContain("Alterar objetivo");
    // Um lime so na aba: a Taxa de conversao.
    expect(html.match(/bg-primary /g)?.length ?? 0).toBe(1);
  });

  it("admin vê o custo por lead e a tabela Campanhas com investimento (Fase 4)", () => {
    const html = visaoGeral(true);
    const lido = texto(html);
    expect(lido).toContain("R$ 30,00");
    expect(lido).toContain("R$ 4.860,00 em 162 leads de anúncio");
    expect(lido).toContain("Atualizado em 02/10 às 06:00");
    // Custo subiu de R$ 25,00 para R$ 30,00: e ruim (menor e melhor).
    expect(lido).toContain("subiu 20,0% vs. período anterior");
    expect(html).toMatch(/data-sentido="subiu"[^>]*text-alert-text/);
    for (const coluna of [
      "Campanha",
      "Investimento",
      "Leads",
      "Custo por lead",
      "Agendados",
      "Conversão",
    ]) {
      expect(html).toContain(`>${coluna}</th>`);
    }
    expect(lido).toContain("Fora da Meta");
    expect(lido).toContain("Sem leads");
    expect(lido).toContain("Investimento sem lead casado: R$ 500,00 em 1 campanha");
    expect(lido).toContain("Leads sem campanha: 150 de 486");
    expect(lido).toContain("Investimento atualizado em 02/10 às 06:00.");
    expect(lido).not.toContain("Investimento e custo por lead: só administrador e gestor.");
  });

  it("recepção vê Faturamento e Custo por lead sem acesso, sem nenhum R$", () => {
    const html = visaoGeral(false);
    expect(html).not.toContain("R$");
    expect(html.match(/Sem acesso/g)?.length).toBe(2);
    expect(html).toContain(
      'data-dica="Só administrador e gestor veem valores em reais."',
    );
    // O botao do objetivo existe, desabilitado, com a dica.
    expect(html).toMatch(
      /data-dica="Só administrador e gestor definem o objetivo de conversão\."><button[^>]*disabled/,
    );
    // Campanhas: as contagens sim, as colunas em reais nem no DOM, com a nota.
    expect(html).not.toContain(">Investimento</th>");
    expect(html).not.toContain(">Custo por lead</th>");
    expect(texto(html)).toContain(
      "Investimento e custo por lead: só administrador e gestor.",
    );
    expect(texto(html)).toContain("Leads sem campanha: 150 de 486");
    expect(texto(html)).not.toContain("Remarketing Botox");
    expect(texto(html)).not.toContain("Atualizado em");
  });

  it("série vazia no período vira texto, nunca eixo vazio", () => {
    const html = renderToStaticMarkup(
      <AbaVisaoGeral
        funil={{ atual: FUNIL, anterior: null }}
        agenda={{ atual: agenda(null), anterior: null }}
        atendimento={{ atual: ATENDIMENTO, anterior: null }}
        serie={[{ dia: "2026-09-01", leads: 0, agendadas: 0 }]}
        serieComErro={false}
        aoTentarSerieDeNovo={nada}
        faturamento={undefined}
        faturamentoComErro
        aoTentarFaturamentoDeNovo={nada}
        campanhas={undefined}
        campanhasComErro
        aoTentarCampanhasDeNovo={nada}
        linhaDeBase={null}
        objetivo={null}
        podeVerValores
        podeDefinirObjetivo
        timezone={TZ}
        aoMudarObjetivo={nada}
        irParaAba={nada}
      />,
    );
    expect(html).toContain('data-estado="vazio"');
    expect(texto(html)).toContain("Nenhum lead nem consulta agendada no período");
    // Erro do faturamento e erro escrito, nunca zero.
    expect(texto(html)).toContain("Não foi possível carregar");
    // Erro das campanhas: o cartao e a tabela dizem que falhou.
    expect(texto(html)).toContain("Não foi possível carregar as campanhas.");
    expect(html.match(/data-estado="erro"/g)?.length).toBe(2);
    expect(texto(html)).toContain("Definir objetivo");
  });
});

describe("Comercial", () => {
  function comercial(podeVerValores: boolean): string {
    return renderToStaticMarkup(
      <AbaComercial
        funil={{ atual: FUNIL, anterior: null }}
        agenda={{
          atual: agenda(podeVerValores ? 15_000 : null),
          anterior: agenda(podeVerValores ? 15_000 : null),
        }}
        pivo={null}
        faturamento={
          podeVerValores ? { atual: FATURAMENTO, anterior: null } : null
        }
        faturamentoComErro={false}
        aoTentarFaturamentoDeNovo={nada}
        linhaDeBase={null}
        ehAdmin={podeVerValores}
        podeVerValores={podeVerValores}
        timezone={TZ}
        dimensao="profissional"
        aoMudarDimensao={nada}
        aoMudarLinhaDeBase={nada}
      />,
    );
  }

  it("o herói Consultas recuperadas é o único lime, com a receita para admin", () => {
    const html = comercial(true);
    expect(html.match(/bg-primary /g)?.length ?? 0).toBe(1);
    const lido = texto(html);
    expect(lido).toContain("Consultas recuperadas");
    expect(lido).toContain("R$ 150,00 em receita associada");
    expect(lido).toContain("R$ 284.000,00");
    expect(lido).toContain("Contra a linha de base");
  });

  it("recepção não vê receita nem faturamento em reais", () => {
    const html = comercial(false);
    expect(html).not.toContain("R$");
    expect(texto(html)).toContain("Consultas recuperadas");
    expect(texto(html)).toContain("Sem acesso");
  });
});

describe("Marketing e Agente de IA", () => {
  it("recepção não vê o valor enviado à Meta nem o investimento", () => {
    const html = renderToStaticMarkup(
      <AbaMarketing
        funil={{ atual: FUNIL, anterior: null }}
        campanhas={campanhasPeriodizadas()}
        campanhasComErro={false}
        aoTentarCampanhasDeNovo={nada}
        conversoes={CONVERSOES}
        timezone={TZ}
        podeVerValores={false}
        dimensao="canal"
        aoMudarDimensao={nada}
      />,
    );
    expect(html).not.toContain("R$");
    expect(texto(html)).toContain("Com origem identificada");
    expect(html.match(/Sem acesso/g)?.length).toBe(1);
  });

  it("admin no Marketing: o detalhe por campanha usa as linhas da tabela Campanhas", () => {
    const html = renderToStaticMarkup(
      <AbaMarketing
        funil={{ atual: FUNIL, anterior: null }}
        campanhas={campanhasPeriodizadas()}
        campanhasComErro={false}
        aoTentarCampanhasDeNovo={nada}
        conversoes={CONVERSOES}
        timezone={TZ}
        podeVerValores
        dimensao="campanha"
        aoMudarDimensao={nada}
      />,
    );
    const lido = texto(html);
    expect(lido).toContain("R$ 30,00");
    expect(lido).toContain("Implante Dentário");
    expect(lido).toContain("Sem campanha");
  });

  it.each([true, false])(
    "leads sem nenhuma campanha (podeVerValores=%s): a tabela não diz que não houve lead",
    (podeVerValores) => {
      // Retrato de hoje em producao: nenhum contato com campanha e nenhuma
      // leitura da Meta ainda (investimento null deixa a tabela sem as
      // colunas em reais).
      const html = renderToStaticMarkup(
        <AbaMarketing
          funil={{ atual: FUNIL, anterior: null }}
          campanhas={campanhasPeriodizadas(null, {
            linhas: [],
            leadsCasados: 0,
            leadsDeAnuncio: 8,
            leadsDeAnuncioSemCampanha: 0,
            leadsSemCampanha: 486,
          })}
          campanhasComErro={false}
          aoTentarCampanhasDeNovo={nada}
          conversoes={CONVERSOES}
          timezone={TZ}
          podeVerValores={podeVerValores}
          dimensao="canal"
          aoMudarDimensao={nada}
        />,
      );
      const lido = texto(html);
      expect(lido).not.toContain("Nenhum lead no período");
      expect(lido).toContain("Nenhum lead com campanha no período");
      expect(lido).toContain(
        "Os leads deste período chegaram sem campanha reconhecida. A contagem está logo abaixo.",
      );
      expect(lido).toContain("Leads sem campanha: 486 de 486");
    },
  );

  it("nenhum lead no período: a tabela mantém Nenhum lead no período", () => {
    const html = renderToStaticMarkup(
      <AbaMarketing
        funil={{ atual: FUNIL, anterior: null }}
        campanhas={campanhasPeriodizadas(null, {
          leads: 0,
          leadsDeAnuncio: 0,
          leadsCasados: 0,
          leadsDeAnuncioSemCampanha: 0,
          leadsSemCampanha: 0,
          linhas: [],
        })}
        campanhasComErro={false}
        aoTentarCampanhasDeNovo={nada}
        conversoes={CONVERSOES}
        timezone={TZ}
        podeVerValores={false}
        dimensao="canal"
        aoMudarDimensao={nada}
      />,
    );
    const lido = texto(html);
    expect(lido).toContain("Nenhum lead no período");
    expect(lido).not.toContain("Nenhum lead com campanha no período");
  });

  it("admin com a leitura parada: Não medido nas células e até quando foi lido", () => {
    const html = renderToStaticMarkup(
      <AbaMarketing
        funil={{ atual: FUNIL, anterior: null }}
        campanhas={campanhasPeriodizadas({
          situacao: "com_problema",
          problema: "token_invalido",
          lidoAte: "2026-09-13",
          investimentoCents: 100_000,
        })}
        campanhasComErro={false}
        aoTentarCampanhasDeNovo={nada}
        conversoes={CONVERSOES}
        timezone={TZ}
        podeVerValores
        dimensao="canal"
        aoMudarDimensao={nada}
      />,
    );
    const lido = texto(html);
    expect(lido).toContain("Ainda não medido");
    expect(lido).toContain("Não medido");
    expect(lido).toContain("O investimento foi lido até 13/09/2026.");
    expect(lido).toContain("A última leitura do investimento teve problema.");
    // Nenhum valor da Meta em reais (nem R$ 0,00 por campanha).
    expect(lido).not.toContain("R$ 3.420,00");
    expect(lido).not.toContain("R$ 1.000,00");
    expect(lido).not.toContain("Sem investimento no período");
  });

  it("admin com a conta em outro fuso: o aviso na linha da tabela Campanhas", () => {
    const html = renderToStaticMarkup(
      <AbaMarketing
        funil={{ atual: FUNIL, anterior: null }}
        campanhas={campanhasPeriodizadas({ fusoDaConta: "Europe/Lisbon" })}
        campanhasComErro={false}
        aoTentarCampanhasDeNovo={nada}
        conversoes={CONVERSOES}
        timezone={TZ}
        podeVerValores
        dimensao="canal"
        aoMudarDimensao={nada}
      />,
    );
    expect(texto(html)).toContain(
      "Investimento atualizado em 02/10 às 06:00. Os dias do investimento seguem o fuso da conta de anúncios, diferente do fuso da clínica.",
    );
  });

  it("custo por mensagem só aparece com canal oficial", () => {
    const semOficial = renderToStaticMarkup(
      <AbaAgenteIa
        atendimento={{ atual: ATENDIMENTO, anterior: null }}
        canalOficial={false}
        podeVerValores
      />,
    );
    expect(texto(semOficial)).not.toContain("Custo do período");
    expect(texto(semOficial)).toContain("Ainda não medido");

    const comOficial = renderToStaticMarkup(
      <AbaAgenteIa
        atendimento={{ atual: ATENDIMENTO, anterior: null }}
        canalOficial
        podeVerValores={false}
      />,
    );
    expect(texto(comOficial)).toContain("Custo do período");
    expect(texto(comOficial)).toContain("Sem acesso");
  });
});
