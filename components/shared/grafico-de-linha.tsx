import { cn } from "@/lib/utils";

// Linha com marcadores (o unico grafico de serie no tempo que o brief e a C12
// permitem; coluna vertical, rosca e barra empilhada sao proibidas). SVG
// proprio, sem biblioteca: o package.json nao tem biblioteca de grafico e
// nao vai ganhar uma por um grafico so. Server Component.
//
// Regras:
// - ate 2 series, e a identidade nunca e so cor: a 1a e linha cheia com
//   marcador REDONDO em --chart-bar, a 2a e TRACEJADA com marcador QUADRADO
//   em --chart-bar-muted, e a legenda escreve o nome de cada uma;
// - cores so por token (os dois passam 3:1 sobre o card e o trilho nos dois
//   temas, teste de contraste); texto nunca na cor da serie;
// - responsivo sem JS: as linhas e as grades sao SVG com viewBox esticado
//   (preserveAspectRatio="none" e vector-effect para o traco ficar com 2px),
//   e o que nao pode deformar (marcador, texto dos eixos) e HTML posicionado
//   em porcentagem, entao circulo continua circulo em qualquer largura;
// - acessivel: role="img" com um aria-label que resume (periodo, total e
//   pico de cada serie) e uma tabela sr-only com todos os pontos; a dica
//   nativa (title) de cada dia mostra os valores ao passar o mouse;
// - sem dados (nenhum ponto, ou tudo zero): texto escrito, nunca eixo vazio.

export type SerieDoGrafico = {
  /** Nome na legenda, no resumo falado e no cabecalho da tabela. */
  nome: string;
  /**
   * Um valor por rotulo do eixo X, na mesma ordem e no mesmo tamanho de
   * `rotulos`. Contagem: dia sem movimento entra como 0.
   */
  valores: readonly number[];
};

export type GraficoDeLinhaProps = {
  /** Nome do grafico: abre o aria-label e e o caption da tabela sr-only. */
  titulo: string;
  /** Rotulo curto de cada ponto no eixo X, ate 5 caracteres ("01/09"). */
  rotulos: readonly string[];
  /**
   * Rotulo por extenso para leitor de tela, tabela e dica ("1 de setembro").
   * Padrao: os proprios rotulos.
   */
  rotulosFalados?: readonly string[];
  /**
   * 1 ou 2 series. 1a: linha cheia, marcador redondo, --chart-bar.
   * 2a: linha tracejada, marcador quadrado, --chart-bar-muted.
   */
  series: readonly [SerieDoGrafico] | readonly [SerieDoGrafico, SerieDoGrafico];
  /** Cabecalho da 1a coluna da tabela sr-only. Padrao "Dia". */
  rotuloDoEixoX?: string;
  /** Altura da area de plotagem em px. Padrao 200. */
  altura?: number;
  /** Texto do estado sem dados. Padrao "Sem dados no período". */
  textoVazio?: string;
  className?: string;
};

const ESTILO_DA_SERIE = [
  { cor: "var(--chart-bar)", tracejado: undefined, forma: "circulo" },
  { cor: "var(--chart-bar-muted)", tracejado: "6 4", forma: "quadrado" },
] as const;

function numero(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

/**
 * Escala do eixo Y: topo e passo "redondos" (1, 2, 5 vezes 10^n), de 3 a 5
 * marcas a partir do zero. Contagem nunca ganha marca fracionaria.
 */
export function escalaDoEixoY(maximo: number): {
  topo: number;
  marcas: number[];
} {
  if (!(maximo > 0)) {
    return { topo: 1, marcas: [0, 1] };
  }
  const bruto = maximo / 4;
  const ordem = 10 ** Math.floor(Math.log10(bruto));
  const normalizado = bruto / ordem;
  const redondo =
    normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 5 ? 5 : 10;
  const passo = Math.max(1, redondo * ordem);
  const topo = Math.ceil(maximo / passo) * passo;
  const marcas: number[] = [];
  for (let marca = 0; marca <= topo; marca += passo) {
    marcas.push(marca);
  }
  return { topo, marcas };
}

/**
 * Indices com rotulo no eixo X: ate `maximo` rotulos espalhados por igual,
 * sempre com o primeiro e o ultimo dia.
 */
export function indicesDoEixoX(total: number, maximo = 7): number[] {
  if (total <= 0) {
    return [];
  }
  const quantos = Math.min(maximo, total);
  if (quantos === 1) {
    return [0];
  }
  const indices = new Set<number>();
  for (let posicao = 0; posicao < quantos; posicao += 1) {
    indices.add(Math.round((posicao * (total - 1)) / (quantos - 1)));
  }
  return [...indices];
}

function resumoDaSerie(
  serie: SerieDoGrafico,
  quantos: number,
  falados: readonly string[],
): string {
  let total = 0;
  let pico = 0;
  let indiceDoPico = -1;
  for (let indice = 0; indice < quantos; indice += 1) {
    const valor = serie.valores[indice] ?? 0;
    total += valor;
    if (valor > pico) {
      pico = valor;
      indiceDoPico = indice;
    }
  }
  if (indiceDoPico < 0) {
    return `${serie.nome}: 0 no total.`;
  }
  return `${serie.nome}: ${numero(total)} no total, pico de ${numero(pico)} em ${falados[indiceDoPico] ?? ""}.`;
}

export function GraficoDeLinha({
  titulo,
  rotulos,
  rotulosFalados,
  series,
  rotuloDoEixoX = "Dia",
  altura = 200,
  textoVazio = "Sem dados no período",
  className,
}: GraficoDeLinhaProps) {
  const quantos = Math.min(
    rotulos.length,
    ...series.map((serie) => serie.valores.length),
  );
  const falados = rotulos.map(
    (rotulo, indice) => rotulosFalados?.[indice] ?? rotulo,
  );
  const maximo = Math.max(
    0,
    ...series.flatMap((serie) => serie.valores.slice(0, quantos)),
  );

  if (quantos === 0 || maximo <= 0) {
    return (
      <p
        data-estado="vazio"
        className={cn(
          "flex items-center justify-center rounded-xl bg-surface-4 px-4 text-center text-sm text-text-secondary",
          className,
        )}
        style={{ minHeight: altura }}
      >
        {textoVazio}
      </p>
    );
  }

  const { topo, marcas } = escalaDoEixoY(maximo);
  const xDe = (indice: number) =>
    quantos === 1 ? 50 : (indice / (quantos - 1)) * 100;
  const yDe = (valor: number) => 100 - (valor / topo) * 100;
  const indices = Array.from({ length: quantos }, (_, indice) => indice);
  const indicesX = indicesDoEixoX(quantos);
  const larguraDoEixoY = Math.max(...marcas.map((m) => numero(m).length));
  const denso = quantos > 45;
  const larguraDaColuna = quantos === 1 ? 100 : 100 / (quantos - 1);

  const periodo =
    quantos === 1
      ? `em ${falados[0] ?? ""}`
      : `de ${falados[0] ?? ""} a ${falados[quantos - 1] ?? ""}`;
  const resumo = [
    `${titulo}, ${periodo}.`,
    ...series.map((serie) => resumoDaSerie(serie, quantos, falados)),
  ].join(" ");

  return (
    <figure className={cn("m-0 grid gap-3", className)}>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-foreground">
        {series.map((serie, indiceDaSerie) => {
          const estilo = ESTILO_DA_SERIE[indiceDaSerie] ?? ESTILO_DA_SERIE[0];
          return (
            <li
              key={indiceDaSerie}
              data-legenda={estilo.forma}
              className="inline-flex items-center gap-2"
            >
              <svg
                aria-hidden
                width="28"
                height="12"
                viewBox="0 0 28 12"
                className="shrink-0"
              >
                <line
                  x1="1"
                  y1="6"
                  x2="27"
                  y2="6"
                  stroke={estilo.cor}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={estilo.tracejado}
                />
                {estilo.forma === "circulo" ? (
                  <>
                    <circle cx="14" cy="6" r="6" fill="var(--card)" />
                    <circle cx="14" cy="6" r="4" fill={estilo.cor} />
                  </>
                ) : (
                  <>
                    <rect
                      x="8"
                      y="0"
                      width="12"
                      height="12"
                      rx="2"
                      fill="var(--card)"
                    />
                    <rect
                      x="10"
                      y="2"
                      width="8"
                      height="8"
                      rx="1"
                      fill={estilo.cor}
                    />
                  </>
                )}
              </svg>
              {serie.nome}
            </li>
          );
        })}
      </ul>

      <div role="img" aria-label={resumo} className="grid gap-1.5 pt-1.5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
          <div
            className="relative cz-num text-[11px] leading-none text-text-secondary"
            style={{ height: altura, width: `${larguraDoEixoY}ch` }}
          >
            {marcas.map((marca) => (
              <span
                key={marca}
                className="absolute right-0 -translate-y-1/2"
                style={{ top: `${yDe(marca)}%` }}
              >
                {numero(marca)}
              </span>
            ))}
          </div>
          <div className="relative mx-1.5" style={{ height: altura }}>
            <svg
              aria-hidden
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 size-full overflow-visible"
            >
              {marcas.map((marca) => (
                <line
                  key={marca}
                  x1="0"
                  x2="100"
                  y1={yDe(marca)}
                  y2={yDe(marca)}
                  stroke={
                    marca === 0 ? "var(--border-strong)" : "var(--border)"
                  }
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {series.map((serie, indiceDaSerie) => {
                const estilo =
                  ESTILO_DA_SERIE[indiceDaSerie] ?? ESTILO_DA_SERIE[0];
                return (
                  <polyline
                    key={indiceDaSerie}
                    data-serie={indiceDaSerie}
                    points={indices
                      .map(
                        (indice) =>
                          `${xDe(indice)},${yDe(serie.valores[indice] ?? 0)}`,
                      )
                      .join(" ")}
                    fill="none"
                    stroke={estilo.cor}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={estilo.tracejado}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
            {/* Quadrado antes do circulo e MAIOR que ele: no empate o
                circulo (com o anel) fica por cima e as quinas do quadrado
                aparecem em volta, entao as duas formas continuam visiveis. */}
            {series
              .map((serie, indiceDaSerie) => ({ serie, indiceDaSerie }))
              .reverse()
              .map(({ serie, indiceDaSerie }) => {
                const estilo =
                  ESTILO_DA_SERIE[indiceDaSerie] ?? ESTILO_DA_SERIE[0];
                return indices.map((indice) => (
                  <span
                    key={`${indiceDaSerie}-${indice}`}
                    aria-hidden
                    data-marcador={estilo.forma}
                    className={cn(
                      "absolute -translate-x-1/2 -translate-y-1/2 ring-2 ring-card",
                      estilo.forma === "circulo"
                        ? cn("rounded-full", denso ? "size-1.5" : "size-2")
                        : cn("rounded-[1px]", denso ? "size-2.5" : "size-3"),
                    )}
                    style={{
                      left: `${xDe(indice)}%`,
                      top: `${yDe(serie.valores[indice] ?? 0)}%`,
                      background: estilo.cor,
                    }}
                  />
                ));
              })}
            {/* Coluna invisivel por dia: dica nativa com os valores e a linha
                de mira no hover (so CSS, sem JS no cliente). */}
            {indices.map((indice) => {
              const inicio = Math.max(0, xDe(indice) - larguraDaColuna / 2);
              const fim = Math.min(100, xDe(indice) + larguraDaColuna / 2);
              const dica = `${falados[indice] ?? ""}: ${series
                .map(
                  (serie) =>
                    `${serie.nome} ${numero(serie.valores[indice] ?? 0)}`,
                )
                .join(", ")}`;
              return (
                <div
                  key={indice}
                  title={dica}
                  className="group absolute inset-y-0"
                  style={{ left: `${inicio}%`, width: `${fim - inicio}%` }}
                >
                  <span
                    className="absolute inset-y-0 w-px bg-border-strong opacity-0 group-hover:opacity-100"
                    style={{
                      left: `${((xDe(indice) - inicio) / (fim - inicio || 1)) * 100}%`,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
          <span style={{ width: `${larguraDoEixoY}ch` }} />
          <div className="relative mx-1.5 h-4 cz-num text-[11px] leading-4 text-text-secondary">
            {indicesX.map((indice, posicao) => (
              <span
                key={indice}
                className={cn(
                  "absolute top-0 whitespace-nowrap",
                  quantos === 1
                    ? "-translate-x-1/2"
                    : indice === 0
                      ? "translate-x-0"
                      : indice === quantos - 1
                        ? "-translate-x-full"
                        : "-translate-x-1/2",
                  // Abaixo de lg so metade dos rotulos cabe sem encostar.
                  indicesX.length > 6 && posicao % 2 === 1 && "max-lg:hidden",
                )}
                style={{ left: `${xDe(indice)}%` }}
              >
                {rotulos[indice]}
              </span>
            ))}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>{titulo}</caption>
        <thead>
          <tr>
            <th scope="col">{rotuloDoEixoX}</th>
            {series.map((serie, indiceDaSerie) => (
              <th key={indiceDaSerie} scope="col">
                {serie.nome}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {indices.map((indice) => (
            <tr key={indice}>
              <th scope="row">{falados[indice]}</th>
              {series.map((serie, indiceDaSerie) => (
                <td key={indiceDaSerie}>
                  {numero(serie.valores[indice] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
