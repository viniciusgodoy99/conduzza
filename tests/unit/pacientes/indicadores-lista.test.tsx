import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { MetricasDePacientes } from "@/lib/domain/pacientes-ui";

// Os 4 cartoes do topo da lista de Pacientes (Fase 3) no cartao de metrica
// unico: o termo da clinica nos rotulos, o sufixo ", na sua agenda" do
// profissional, a variacao absoluta escondida com base zero, "Ainda não
// medido" no lugar de zero estrutural, o icone sem dono no "sem consulta"
// (nunca o MoonStar da etiqueta Inativo) e carregando e erro sem numero.

// A dica vira atributo, para o teste ler o porque do estado desabilitado.
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

const { IndicadoresDaLista } =
  await import("@/components/pacientes/indicadores-lista");

type Props = ComponentProps<typeof IndicadoresDaLista>;

const FORTALEZA = "America/Fortaleza";
// 02/10/2026, meio-dia em Fortaleza.
const agora = new Date("2026-10-02T15:00:00Z");

const METRICAS: MetricasDePacientes = {
  ativos: 1248,
  ativos_30d_atras: 1214,
  novos_no_mes: 86,
  retorno_base: 200,
  retorno_voltaram: 82,
  sem_contato_6m: 212,
  primeiro_comparecimento: "2024-01-10T13:00:00Z",
};

function html(parcial: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    <IndicadoresDaLista
      metricas={METRICAS}
      falhou={false}
      tentando={false}
      aoTentarDeNovo={() => undefined}
      agora={agora}
      timezone={FORTALEZA}
      termoPacientes="pacientes"
      termoConsulta="consulta"
      soDaSuaAgenda={false}
      {...parcial}
    />,
  );
}

/** Texto como o leitor de tela e o e2e leem, sem as tags. */
function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Markup de um cartao (do role=group ate o proximo). */
function cartao(markup: string, rotulo: string): string {
  const grupos = markup.split('<div role="group"').slice(1);
  const achado = grupos.find((grupo) => grupo.includes(`>${rotulo}<`));
  expect(achado, `cartao "${rotulo}"`).toBeDefined();
  return achado!;
}

describe("IndicadoresDaLista, com dados", () => {
  it("os 4 cartoes com o termo da clinica", () => {
    const markup = html({
      termoPacientes: "clientes",
      termoConsulta: "sessão",
      metricas: { ...METRICAS, retorno_base: 1, retorno_voltaram: 1 },
    });
    expect(markup.split('role="group"')).toHaveLength(5);
    expect(texto(cartao(markup, "Clientes ativos"))).toContain("1.248");
    expect(texto(cartao(markup, "Novos no mês"))).toContain(
      "Primeira sessão em outubro",
    );
    expect(texto(cartao(markup, "Retorno em 90 dias"))).toContain(
      "De 1 sessão",
    );
    expect(texto(cartao(markup, "Sem sessão há 6 meses"))).toContain("212");
  });

  it("pacientes ativos: variacao absoluta em pessoas vs. 30 dias atras", () => {
    const ativos = cartao(html(), "Pacientes ativos");
    expect(ativos).toContain('data-parte="variacao"');
    expect(ativos).toContain("+34");
    expect(ativos).toContain("subiu 34 vs. 30 dias atrás");
    expect(ativos).not.toContain("%");
    expect(texto(ativos)).toContain("Atendidos nos últimos 12 meses");
  });

  it("base zero esconde a variacao e o historico curto diz desde quando conta", () => {
    const ativos = cartao(
      html({
        metricas: {
          ...METRICAS,
          ativos: 1,
          ativos_30d_atras: 0,
          primeiro_comparecimento: "2026-09-10T13:00:00Z",
        },
      }),
      "Pacientes ativos",
    );
    expect(ativos).not.toContain('data-parte="variacao"');
    expect(ativos).not.toContain("sem base de comparação");
    expect(texto(ativos)).toContain("Contando desde 10/09/2026");
  });

  it("retorno em 90 dias: percentual com 1 casa, unidade separada e o tamanho da base", () => {
    const retorno = cartao(html(), "Retorno em 90 dias");
    expect(retorno).toContain(">41,0</span>");
    expect(retorno).toContain(">%</span>");
    expect(texto(retorno)).toContain("De 200 consultas");
  });

  it("retorno sem base: 'Ainda não medido' com a dica e o dia da primeira medida, nunca 0%", () => {
    const retorno = cartao(
      html({
        metricas: {
          ...METRICAS,
          retorno_base: 0,
          retorno_voltaram: 0,
          primeiro_comparecimento: "2026-09-10T13:00:00Z",
        },
      }),
      "Retorno em 90 dias",
    );
    expect(retorno).toContain('data-estado="nao-medido"');
    expect(retorno).toContain("Ainda não medido");
    expect(retorno).toMatch(/data-dica="Mede quantas consultas atendidas/);
    expect(texto(retorno)).toContain("Primeira medida em 10/12/2026");
    expect(retorno).not.toContain("0%");
  });

  it("sem consulta ha 6 meses: rodape do plano e icone sem dono (nao o MoonStar)", () => {
    const markup = html();
    const semConsulta = cartao(markup, "Sem consulta há 6 meses");
    expect(texto(semConsulta)).toContain(
      "Atendidos há mais de 6 meses, nada marcado",
    );
    expect(semConsulta).toContain("lucide-calendar-off");
    expect(markup).not.toContain("lucide-moon-star");
  });

  it("historico menor que 6 meses: 'Ainda não medido' com o dia em que comeca a contar", () => {
    const semConsulta = cartao(
      html({
        metricas: {
          ...METRICAS,
          sem_contato_6m: 0,
          primeiro_comparecimento: "2026-09-10T13:00:00Z",
        },
      }),
      "Sem consulta há 6 meses",
    );
    expect(semConsulta).toContain('data-estado="nao-medido"');
    expect(texto(semConsulta)).toContain("Começa a contar em 11/03/2027");
  });

  it("profissional: cada rodape diz que conta so a agenda dele", () => {
    const markup = html({ soDaSuaAgenda: true });
    expect(texto(cartao(markup, "Pacientes ativos"))).toContain(
      "Atendidos nos últimos 12 meses, na sua agenda",
    );
    expect(texto(cartao(markup, "Novos no mês"))).toContain(
      "Primeira consulta em outubro, na sua agenda",
    );
    expect(texto(cartao(markup, "Retorno em 90 dias"))).toContain(
      "De 200 consultas, na sua agenda",
    );
    expect(texto(cartao(markup, "Sem consulta há 6 meses"))).toContain(
      "nada marcado, na sua agenda",
    );
    // Os rodapes de "Ainda não medido" tambem: as datas saem so da agenda dele.
    const naoMedido = html({
      soDaSuaAgenda: true,
      metricas: {
        ...METRICAS,
        retorno_base: 0,
        retorno_voltaram: 0,
        sem_contato_6m: 0,
        primeiro_comparecimento: "2026-09-10T13:00:00Z",
      },
    });
    expect(texto(cartao(naoMedido, "Retorno em 90 dias"))).toContain(
      "Primeira medida em 10/12/2026, na sua agenda",
    );
    expect(texto(cartao(naoMedido, "Sem consulta há 6 meses"))).toContain(
      "Começa a contar em 11/03/2027, na sua agenda",
    );
  });

  it("nenhum travessao no texto", () => {
    expect(html()).not.toContain("—");
  });
});

describe("IndicadoresDaLista, sem dados", () => {
  it("carregando: os 4 cartoes com o rotulo e nenhum numero", () => {
    const markup = html({ metricas: undefined, falhou: false });
    expect(markup.match(/data-estado="carregando"/g)).toHaveLength(4);
    // Nenhum numero (os rotulos "90 dias" e "6 meses" tem digito, o valor
    // nao existe: nenhum span cz-num).
    expect(markup).not.toContain("cz-num");
    expect(texto(markup)).not.toMatch(/\b0\b/);
  });

  it("erro nunca vira zero: o estado de erro com o botao de tentar de novo", () => {
    const markup = html({ metricas: undefined, falhou: true });
    expect(markup.match(/data-estado="erro"/g)).toHaveLength(4);
    expect(texto(markup)).toContain("Não foi possível carregar");
    expect(texto(markup)).toContain("Tentar de novo");
    expect(markup).not.toContain("cz-num");
    expect(texto(markup)).not.toMatch(/\b0\b/);
  });

  it("tentando de novo: o botao fica desabilitado e diz que esta tentando", () => {
    const markup = html({ metricas: undefined, falhou: true, tentando: true });
    expect(texto(markup)).toContain("Tentando...");
    expect(markup).toContain("disabled");
  });
});
