import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarDays, Clock } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

// O cartao de metrica unico (Fase 3): as 3 camadas da variacao com a cor
// pela polaridade, o arredondamento antes do sentido, os estados que nunca
// viram zero, o destaque lime sem icone e com a variacao na pilula, e o DOM
// que os e2e usam (role="group" com o nome do rotulo; span do rotulo filho
// direto da raiz, com o icone dentro).

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

const { CartaoDeMetrica } =
  await import("@/components/shared/cartao-de-metrica");

type Props = Parameters<typeof CartaoDeMetrica>[0];

function html(props: Props): string {
  return renderToStaticMarkup(<CartaoDeMetrica {...props} />);
}

/** Texto visivel e falado, sem as tags. */
function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Trecho do markup do elemento com data-parte="variacao". */
function variacao(markup: string): string {
  const inicio = markup.indexOf('data-parte="variacao"');
  expect(inicio).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf("<span", inicio));
}

const VS = "período anterior";

describe("CartaoDeMetrica, valor e variação", () => {
  it("mostra +12,4% e diz a frase inteira em sr-only", () => {
    const markup = html({
      rotulo: "Leads recebidos",
      valor: "1.124",
      variacao: { atual: 1124, anterior: 1000, comparadoCom: VS },
    });
    expect(markup).toContain("+12,4%");
    expect(markup).toContain(
      '<span class="sr-only">subiu 12,4% vs. período anterior</span>',
    );
    const trecho = variacao(markup);
    expect(trecho).toContain("text-success-text");
    expect(trecho).toContain("lucide-trending-up");
    // a parte visivel e escondida do leitor (a frase sr-only e o que se le)
    expect(trecho).toMatch(/<span aria-hidden="true"[^>]*><svg/);
  });

  it("menor-melhor em queda é boa: verde com seta para baixo", () => {
    const trecho = variacao(
      html({
        rotulo: "Faltas",
        valor: "18",
        variacao: {
          atual: 18,
          anterior: 20,
          comparadoCom: VS,
          polaridade: "menor-melhor",
        },
      }),
    );
    expect(trecho).toContain("text-success-text");
    expect(trecho).toContain("lucide-trending-down");
    expect(trecho).toContain("-10,0%");
  });

  it("maior-melhor em queda é ruim: alert", () => {
    const trecho = variacao(
      html({
        rotulo: "Consultas agendadas",
        valor: "90",
        variacao: { atual: 90, anterior: 100, comparadoCom: VS },
      }),
    );
    expect(trecho).toContain("text-alert-text");
  });

  it("0,04% vira 0,0% estável, com Minus e cor neutra (nunca +0,0% verde)", () => {
    const markup = html({
      rotulo: "Leads recebidos",
      valor: "10.004",
      variacao: { atual: 10004, anterior: 10000, comparadoCom: VS },
    });
    const trecho = variacao(markup);
    expect(trecho).toContain("0,0%");
    expect(trecho).not.toContain("+0,0%");
    expect(trecho).toContain("lucide-minus");
    expect(trecho).toContain("text-neutral-text");
    expect(trecho).not.toContain("text-success-text");
    expect(markup).toContain("estável vs. período anterior");
  });

  it("base zero: sem seta e com 'sem base de comparação'", () => {
    const markup = html({
      rotulo: "Leads recebidos",
      valor: "4",
      variacao: { atual: 4, anterior: 0, comparadoCom: VS },
    });
    expect(markup).toContain("sem base de comparação (vs. período anterior)");
    expect(markup).not.toContain("lucide-trending");
    expect(markup).not.toContain('data-parte="variacao"');
  });

  it("formato absoluto mostra +34", () => {
    const markup = html({
      rotulo: "Pacientes ativos",
      valor: "1.248",
      variacao: {
        atual: 1248,
        anterior: 1214,
        comparadoCom: "30 dias atrás",
        formato: "absoluto",
      },
    });
    expect(variacao(markup)).toContain("+34");
    expect(markup).toContain("subiu 34 vs. 30 dias atrás");
    expect(markup).not.toContain("+34%");
  });

  it("sem variação não desenha linha nenhuma", () => {
    const markup = html({
      rotulo: "Novos no mês",
      valor: "86",
      variacao: null,
    });
    expect(markup).not.toContain('data-parte="variacao"');
    expect(markup).not.toContain("sem base");
  });

  it("valor no cz-num de 34px, unidade separada e linha que quebra", () => {
    const markup = html({
      rotulo: "Retorno em 90 dias",
      valor: "41,0",
      unidade: "%",
    });
    // leading-none sobrevive ao twMerge (vem depois do tamanho)
    expect(markup).toMatch(
      /class="cz-num[^"]*text-\[34px\] leading-none[^"]*">41,0</,
    );
    expect(markup).toMatch(/text-\[13px\][^"]*">%</);
    expect(markup).toContain("flex flex-wrap items-baseline");
  });

  it("reais acima de 9 caracteres descem para 28px (grade de 5 a 1366px)", () => {
    for (const valor of ["R$\u00a045,3\u00a0mil", "R$\u00a09.850,00", "R$\u00a0284\u00a0mil"]) {
      const markup = html({ rotulo: "Faturamento estimado", valor });
      expect(markup).toMatch(/cz-num[^"]*text-\[28px\] leading-none/);
      expect(markup).not.toContain("text-[34px]");
    }
    // contagem curta continua em 34px; o tamanho md nao muda
    expect(html({ rotulo: "Leads", valor: "1.248" })).toContain("text-[34px]");
    expect(
      html({ rotulo: "Enviados", variante: "afundado", tamanho: "md", valor: "R$\u00a045,3\u00a0mil" }),
    ).toMatch(/cz-num[^"]*text-2xl/);
  });

  it("valorFalado: o compacto fica visível e o cheio é o que se lê", () => {
    const markup = html({
      rotulo: "Faturamento estimado",
      valor: "R$ 284 mil",
      valorFalado: "R$ 284.000,00",
    });
    expect(markup).toMatch(
      /<span aria-hidden="true" class="cz-num[^"]*">R\$ 284 mil</,
    );
    expect(markup).toContain('<span class="sr-only">R$ 284.000,00</span>');
  });

  it("rodapé convive com a variação, e a ação entra no cartão", () => {
    const markup = html({
      rotulo: "Aguardando",
      icone: Clock,
      tom: "warning",
      valor: "19",
      rodape: "Último disparo 09:02",
      variacao: { atual: 19, anterior: 10, comparadoCom: VS },
      acao: <button type="button">Cobrar pendentes</button>,
    });
    expect(markup).toContain("Último disparo 09:02");
    expect(markup).toContain('data-parte="variacao"');
    expect(markup).toContain("Cobrar pendentes");
  });
});

describe("CartaoDeMetrica, DOM e acessibilidade", () => {
  it("role=group nomeado pelo eyebrow, que é filho direto com o ícone dentro", () => {
    const markup = html({
      rotulo: "Consultas hoje",
      icone: CalendarDays,
      valor: "147",
    });
    const raiz = markup.match(
      /^<div role="group" aria-labelledby="([^"]+)"[^>]*><span id="([^"]+)"[^>]*>Consultas hoje<svg[^>]*lucide-calendar-days[^>]*>/,
    );
    expect(raiz).not.toBeNull();
    expect(raiz?.[1]).toBe(raiz?.[2]);
  });

  it("ícone sem tom é secundário; com tom leva a cor do status", () => {
    expect(
      html({ rotulo: "Consultas hoje", icone: CalendarDays, valor: "1" }),
    ).toMatch(/lucide-calendar-days[^"]*text-text-secondary/);
    expect(
      html({ rotulo: "Aguardando", icone: Clock, tom: "warning", valor: "1" }),
    ).toContain("color:var(--warning-text)");
  });

  it("ids distintos para dois cartões na mesma árvore", () => {
    const markup = renderToStaticMarkup(
      <>
        <CartaoDeMetrica rotulo="A" valor="1" />
        <CartaoDeMetrica rotulo="B" valor="2" />
      </>,
    );
    const ids = [...markup.matchAll(/aria-labelledby="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe("CartaoDeMetrica, destaque", () => {
  const markup = html({
    destaque: true,
    rotulo: "Confirmadas",
    valor: "128",
    rodape: "87,2% do total",
    variacao: { atual: 1124, anterior: 1000, comparadoCom: VS },
  });

  it("lime cheio, sem sombra, texto em primary-foreground", () => {
    const abertura = markup.slice(0, markup.indexOf(">"));
    expect(abertura).toContain("bg-primary");
    expect(abertura).toContain("shadow-none");
    expect(abertura).not.toContain("shadow-sm");
    expect(markup).toMatch(/cz-eyebrow text-primary-foreground/);
    expect(markup).not.toContain("text-text-secondary");
    expect(markup).not.toContain("opacity");
  });

  it("eyebrow sem ícone", () => {
    expect(markup).toMatch(/<span id="[^"]+"[^>]*>Confirmadas<\/span>/);
  });

  it("variação na pílula bg-card com a cor da polaridade", () => {
    const trecho = variacao(markup);
    expect(trecho).toMatch(/text-success-text[^"]*h-6 rounded-full bg-card/);
  });
});

describe("CartaoDeMetrica, estados", () => {
  it("nao-medido: texto com dica, sem opacidade", () => {
    const markup = html({
      rotulo: "Resolvidas pela IA",
      estado: "nao-medido",
      dica: "Chega com o agente de IA.",
    });
    expect(markup).toContain('data-dica="Chega com o agente de IA."');
    expect(markup).toContain("Ainda não medido");
    expect(markup).not.toContain("opacity");
  });

  it("sem-acesso: 'Sem acesso' com dica e nenhum número no texto", () => {
    const markup = html({
      rotulo: "Faturamento estimado",
      estado: "sem-acesso",
      dica: "Só administrador e gestor veem valores em reais.",
    });
    expect(markup).toContain("Sem acesso");
    expect(markup).toContain(
      'data-dica="Só administrador e gestor veem valores em reais."',
    );
    expect(texto(markup)).not.toMatch(/\d/);
    expect(markup).not.toContain("cz-num");
  });

  it("vazio: 'Sem dados' escrito fora do cz-num", () => {
    const markup = html({ rotulo: "Taxa de conversão", estado: "vazio" });
    expect(markup).toContain("Sem dados");
    expect(markup).not.toContain("cz-num");
    expect(
      html({
        rotulo: "Tempo médio",
        estado: "vazio",
        texto: "Sem encaixe no mês",
      }),
    ).toContain("Sem encaixe no mês");
  });

  it("carregando: rótulo visível, esqueleto e aria-busy, sem número", () => {
    const markup = html({ rotulo: "Consultas hoje", estado: "carregando" });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Consultas hoje");
    expect(markup).toContain('data-slot="skeleton"');
    expect(texto(markup)).not.toMatch(/\d/);
  });

  it("afundado carregando: esqueleto em surface-5, visível sobre a surface-4", () => {
    const markup = html({
      rotulo: "Enviados",
      variante: "afundado",
      tamanho: "md",
      estado: "carregando",
    });
    expect(markup).toMatch(/data-slot="skeleton"[^>]*bg-surface-5|bg-surface-5[^>]*data-slot="skeleton"/);
    expect(markup).not.toMatch(/animate-pulse[^"]*bg-surface-4/);
  });

  it("erro no destaque: a pílula cresce com a mensagem (sem altura fixa)", () => {
    const markup = html({ rotulo: "Confirmadas", destaque: true, estado: "erro" });
    expect(markup).toContain("min-h-6 rounded-xl bg-card");
    expect(markup).not.toMatch(/text-alert-text[^"]*h-6 rounded-full/);
  });

  it("erro: texto de erro com OctagonAlert, nunca zero", () => {
    const markup = html({
      rotulo: "Consultas hoje",
      estado: "erro",
      tentarDeNovo: <button type="button">Tentar de novo</button>,
    });
    expect(markup).toContain("Não foi possível carregar");
    expect(markup).toContain("lucide-octagon-alert");
    expect(markup).toContain("text-alert-text");
    expect(markup).toContain("Tentar de novo");
    expect(texto(markup)).not.toMatch(/\d/);
  });
});

describe("CartaoDeMetrica, variantes", () => {
  it("afundado: sem borda e sem sombra, na superfície 4", () => {
    const markup = html({
      rotulo: "Enviados",
      variante: "afundado",
      tamanho: "md",
      valor: "1.240",
    });
    const abertura = markup.slice(0, markup.indexOf(">"));
    expect(abertura).toContain("rounded-xl bg-surface-4 p-3.5");
    expect(abertura).not.toContain("border");
    expect(abertura).not.toContain("shadow");
    expect(markup).toMatch(/cz-num[^"]*text-2xl/);
    expect(markup).not.toContain("text-[34px]");
  });

  it("cartão padrão: borda fina, sombra baixa e raio de cartão", () => {
    const abertura = html({ rotulo: "A", valor: "1" }).slice(0, 400);
    expect(abertura).toContain(
      "rounded-card border border-border bg-card p-4 shadow-sm",
    );
  });

  it("nenhum estado usa travessão", () => {
    const todos: Props[] = [
      {
        rotulo: "A",
        valor: "1",
        variacao: { atual: 1, anterior: 2, comparadoCom: VS },
      },
      { rotulo: "A", estado: "vazio" },
      { rotulo: "A", estado: "nao-medido", dica: "x" },
      { rotulo: "A", estado: "sem-acesso", dica: "x" },
      { rotulo: "A", estado: "carregando" },
      { rotulo: "A", estado: "erro" },
    ];
    for (const props of todos) {
      expect(html(props)).not.toMatch(/[\u2014\u2013]/);
    }
  });
});

// O contrato tambem vale no tipo (o typecheck roda sobre os testes): cada
// linha com @ts-expect-error tem de CONTINUAR sendo erro de tipo.
describe("CartaoDeMetrica, contrato no tipo", () => {
  it("recusa combinações que quebram as regras", () => {
    const aceitos: Props[] = [];
    const aceita = (props: Props) => aceitos.push(props);
    const A = { rotulo: "A" } as const;
    // @ts-expect-error destaque nao tem icone (C18)
    aceita({ ...A, destaque: true, icone: Clock, valor: "1" });
    // @ts-expect-error destaque nao tem tom
    aceita({ ...A, destaque: true, tom: "success", valor: "1" });
    // @ts-expect-error destaque nao e afundado
    aceita({ ...A, destaque: true, variante: "afundado", valor: "1" });
    // @ts-expect-error sem-acesso nunca recebe o valor
    aceita({ ...A, estado: "sem-acesso", dica: "x", valor: "1" });
    // @ts-expect-error nao-medido exige a dica
    aceita({ ...A, estado: "nao-medido" });
    // @ts-expect-error valor e obrigatorio no estado padrao
    aceita({ ...A });
    // o que vale continua valendo
    aceita({ ...A, destaque: true, valor: "1" });
    aceita({
      ...A,
      icone: Clock,
      tom: "warning",
      variante: "afundado",
      valor: "1",
    });
    expect(aceitos).toHaveLength(8);
  });
});
