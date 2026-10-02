import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ATENDIMENTO,
  CONVERSOES,
  FATURAMENTO,
  FUNIL,
  agenda,
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
  it("recepção não vê o valor enviado à Meta", () => {
    const html = renderToStaticMarkup(
      <AbaMarketing
        funil={{ atual: FUNIL, anterior: null }}
        conversoes={CONVERSOES}
        timezone={TZ}
        podeVerValores={false}
        dimensao="canal"
        aoMudarDimensao={nada}
      />,
    );
    expect(html).not.toContain("R$");
    expect(texto(html)).toContain("Com origem identificada");
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
