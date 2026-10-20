import type { SupabaseClient } from "@supabase/supabase-js";

// Um PostgREST de mentira, em memoria, para os testes da exportacao de
// leads: guarda as tabelas, aplica os filtros que o construtor do
// supabase-js monta (eq, gt, gte, lt, lte, in), a ordem, o limite e a
// contagem exata, e registra cada consulta e cada insert. Compara instantes
// como o Postgres: com MICROSSEGUNDOS (o timestamptz que a API devolve), e
// nao com os milissegundos do JavaScript; e isso que deixa o teste pegar a
// diferenca entre o recorte no banco e o filtrarLeads da tela.

export type Linha = Record<string, unknown>;

export type ErroDoBanco = { code?: string; message: string };

type Filtro = {
  operador: "eq" | "gt" | "gte" | "lt" | "lte" | "in";
  coluna: string;
  valor: unknown;
};

export type ConsultaRegistrada = {
  tabela: string;
  colunas: string | null;
  contar: boolean;
  filtros: Filtro[];
  ordem: { coluna: string; ascendente: boolean }[];
  limite: number | null;
};

const INSTANTE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;

/** Instante ISO em microssegundos (BigInt), como o Postgres compara. */
export function microssegundos(iso: string): bigint | null {
  const partes = INSTANTE.exec(iso);
  if (!partes) {
    return null;
  }
  const [, base, fracao = "", fuso] = partes;
  const ms = Date.parse(`${base}${fuso === "Z" ? "Z" : fuso}`);
  if (Number.isNaN(ms)) {
    return null;
  }
  return BigInt(ms) * BigInt(1000) + BigInt(fracao.padEnd(6, "0"));
}

function comparar(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (typeof a === "string" && typeof b === "string") {
    const ma = microssegundos(a);
    const mb = microssegundos(b);
    if (ma !== null && mb !== null) {
      return ma < mb ? -1 : ma > mb ? 1 : 0;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function passa(linha: Linha, filtro: Filtro): boolean {
  const valor = linha[filtro.coluna];
  if (filtro.operador === "in") {
    return (filtro.valor as unknown[]).some(
      (item) =>
        valor !== null && valor !== undefined && comparar(valor, item) === 0,
    );
  }
  // NULL nunca passa em comparacao (como no SQL).
  if (valor === null || valor === undefined) {
    return false;
  }
  const c = comparar(valor, filtro.valor);
  switch (filtro.operador) {
    case "eq":
      return c === 0;
    case "gt":
      return c > 0;
    case "gte":
      return c >= 0;
    case "lt":
      return c < 0;
    case "lte":
      return c <= 0;
  }
}

type Resultado = {
  data: unknown;
  error: ErroDoBanco | null;
  count: number | null;
};

class Consulta implements PromiseLike<Resultado> {
  private registro: ConsultaRegistrada;
  private insercao: Linha | null = null;
  private unica = false;

  constructor(
    private readonly banco: SupabaseEmMemoria,
    tabela: string,
  ) {
    this.registro = {
      tabela,
      colunas: null,
      contar: false,
      filtros: [],
      ordem: [],
      limite: null,
    };
  }

  select(colunas?: string, opcoes?: { count?: string }): this {
    this.registro.colunas = colunas ?? "*";
    this.registro.contar = opcoes?.count === "exact";
    return this;
  }

  insert(linha: Linha): this {
    this.insercao = linha;
    return this;
  }

  private filtro(operador: Filtro["operador"], coluna: string, valor: unknown) {
    this.registro.filtros.push({ operador, coluna, valor });
    return this;
  }

  eq(coluna: string, valor: unknown): this {
    return this.filtro("eq", coluna, valor);
  }
  gt(coluna: string, valor: unknown): this {
    return this.filtro("gt", coluna, valor);
  }
  gte(coluna: string, valor: unknown): this {
    return this.filtro("gte", coluna, valor);
  }
  lt(coluna: string, valor: unknown): this {
    return this.filtro("lt", coluna, valor);
  }
  lte(coluna: string, valor: unknown): this {
    return this.filtro("lte", coluna, valor);
  }
  in(coluna: string, valores: unknown[]): this {
    return this.filtro("in", coluna, valores);
  }

  order(coluna: string, opcoes?: { ascending?: boolean }): this {
    this.registro.ordem.push({
      coluna,
      ascendente: opcoes?.ascending ?? true,
    });
    return this;
  }

  limit(n: number): this {
    this.registro.limite = n;
    return this;
  }

  maybeSingle(): this {
    this.unica = true;
    return this;
  }

  private executar(): Resultado {
    const { tabela } = this.registro;
    if (this.insercao) {
      this.banco.inserts.push({ tabela, linha: this.insercao });
      const erro = this.banco.proximoErroDeInsert(tabela);
      return { data: null, error: erro, count: null };
    }
    this.banco.consultas.push(this.registro);
    const erro = this.banco.errosDeLeitura[tabela];
    if (erro) {
      return { data: null, error: erro, count: null };
    }
    let linhas = (this.banco.tabelas[tabela] ?? []).filter((linha) =>
      this.registro.filtros.every((filtro) => passa(linha, filtro)),
    );
    const count = this.registro.contar
      ? (this.banco.contagemForcada ?? linhas.length)
      : null;
    if (this.registro.ordem.length > 0) {
      linhas = [...linhas].sort((a, b) => {
        for (const { coluna, ascendente } of this.registro.ordem) {
          const c = comparar(a[coluna], b[coluna]);
          if (c !== 0) {
            return ascendente ? c : -c;
          }
        }
        return 0;
      });
    }
    if (this.registro.limite !== null) {
      linhas = linhas.slice(0, this.registro.limite);
    }
    // O "Max rows" do PostgREST corta toda resposta, peca o que pedir.
    if (this.banco.maxLinhasPorResposta !== null) {
      linhas = linhas.slice(0, this.banco.maxLinhasPorResposta);
    }
    // Copia: quem le nao mexe na tabela.
    const copia = linhas.map((linha) => structuredClone(linha));
    if (this.unica) {
      return { data: copia[0] ?? null, error: null, count };
    }
    return { data: copia, error: null, count };
  }

  then<R1 = Resultado, R2 = never>(
    aoCumprir?: ((valor: Resultado) => R1 | PromiseLike<R1>) | null,
    aoRejeitar?: ((motivo: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.executar())
      .then(aoCumprir, aoRejeitar);
  }
}

export class SupabaseEmMemoria {
  readonly consultas: ConsultaRegistrada[] = [];
  readonly inserts: { tabela: string; linha: Linha }[] = [];
  /** Erro de leitura por tabela (a consulta inteira falha). */
  errosDeLeitura: Partial<Record<string, ErroDoBanco>> = {};
  /** Erros dos proximos inserts, por tabela, na ordem. */
  errosDeInsert: Partial<Record<string, (ErroDoBanco | null)[]>> = {};
  /** Contagem que a primeira pagina devolve (o teto, sem 20 mil linhas). */
  contagemForcada: number | null = null;
  /** O "Max rows" do projeto: nenhuma resposta passa disso. */
  maxLinhasPorResposta: number | null = null;

  constructor(readonly tabelas: Record<string, Linha[]> = {}) {}

  from(tabela: string): Consulta {
    return new Consulta(this, tabela);
  }

  proximoErroDeInsert(tabela: string): ErroDoBanco | null {
    const fila = this.errosDeInsert[tabela];
    return fila && fila.length > 0 ? (fila.shift() ?? null) : null;
  }

  /** O fake no tipo que as funcoes de lib/queries esperam. */
  comoCliente(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }

  consultasDe(tabela: string): ConsultaRegistrada[] {
    return this.consultas.filter((consulta) => consulta.tabela === tabela);
  }
}
