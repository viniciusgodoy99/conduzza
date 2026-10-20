import type { SupabaseClient } from "@supabase/supabase-js";

// Banco em memoria com a forma do cliente do Supabase, so para os testes da
// agenda da IA (E4): o carregador (lib/agente/agenda.ts) e as RPCs. Imita o
// que o carregador usa: from(tabela).select(colunas) com eq, in, not(col,
// "in", "(a,b)"), lt, gt, is, or ("col.is.null,col.eq.valor"), order, range
// e limit; maybeSingle e await direto; e rpc por manipulador. Guarda cada
// leitura (tabela, colunas e filtros) e QUALQUER escrita, para os testes
// provarem que a leitura nao pede dado de paciente e que o simulador nao
// grava nada. Nada de rede, nada de banco: as RPCs de verdade sao provadas
// nas suites de RLS e de integracao.

export type Linha = Record<string, unknown>;
type Filtro = (linha: Linha) => boolean;
type Resposta = { data: unknown; error: { code?: string } | null };

export type Leitura = {
  tabela: string;
  colunas: string;
  /** "eq:clinic_id=..." , "in:professional_id", "not:status", ... */
  filtros: string[];
};

export type ManipuladorDeRpc = (
  args: Record<string, unknown>,
) => Resposta | Promise<Resposta>;

function comparar(a: unknown, b: unknown): number {
  const x = String(a ?? "");
  const y = String(b ?? "");
  return x < y ? -1 : x > y ? 1 : 0;
}

export class AgendaEmMemoria {
  readonly tabelas = new Map<string, Linha[]>();
  readonly manipuladores = new Map<string, ManipuladorDeRpc>();
  readonly leituras: Leitura[] = [];
  readonly chamadas: { nome: string; args: Record<string, unknown> }[] = [];
  readonly escritas: { tabela: string; operacao: string }[] = [];
  /** Tabela cuja leitura volta com erro. */
  readonly comErro = new Set<string>();

  linhas(tabela: string): Linha[] {
    let linhas = this.tabelas.get(tabela);
    if (!linhas) {
      linhas = [];
      this.tabelas.set(tabela, linhas);
    }
    return linhas;
  }

  inserir(tabela: string, ...linhas: Linha[]): this {
    this.linhas(tabela).push(...linhas);
    return this;
  }

  rpc(nome: string, manipulador: ManipuladorDeRpc): this {
    this.manipuladores.set(nome, manipulador);
    return this;
  }

  chamadasDe(nome: string): Record<string, unknown>[] {
    return this.chamadas.filter((c) => c.nome === nome).map((c) => c.args);
  }

  cliente(): SupabaseClient {
    return {
      from: (tabela: string) => new Consulta(this, tabela),
      rpc: async (nome: string, args: Record<string, unknown> = {}) => {
        this.chamadas.push({ nome, args });
        const manipulador = this.manipuladores.get(nome);
        if (!manipulador) {
          return { data: null, error: { code: "42883" } };
        }
        return manipulador(args);
      },
    } as unknown as SupabaseClient;
  }
}

function filtroDoOr(expressao: string): Filtro {
  const partes = expressao.split(",").map((parte) => {
    const [coluna = "", operador, ...resto] = parte.split(".");
    const valor = resto.join(".");
    return (linha: Linha) =>
      operador === "is" && valor === "null"
        ? (linha[coluna] ?? null) === null
        : operador === "eq"
          ? linha[coluna] === valor
          : false;
  });
  return (linha) => partes.some((parte) => parte(linha));
}

class Consulta implements PromiseLike<Resposta> {
  private colunas = "";
  private readonly filtros: Filtro[] = [];
  private readonly descricao: string[] = [];
  private ordem: { coluna: string; ascendente: boolean }[] = [];
  private de = 0;
  private ate = Number.POSITIVE_INFINITY;

  constructor(
    private readonly banco: AgendaEmMemoria,
    private readonly tabela: string,
  ) {}

  select(colunas = "*"): this {
    this.colunas = colunas;
    return this;
  }
  insert(): this {
    this.banco.escritas.push({ tabela: this.tabela, operacao: "insert" });
    return this;
  }
  update(): this {
    this.banco.escritas.push({ tabela: this.tabela, operacao: "update" });
    return this;
  }
  upsert(): this {
    this.banco.escritas.push({ tabela: this.tabela, operacao: "upsert" });
    return this;
  }
  delete(): this {
    this.banco.escritas.push({ tabela: this.tabela, operacao: "delete" });
    return this;
  }
  eq(coluna: string, valor: unknown): this {
    this.descricao.push(`eq:${coluna}=${String(valor)}`);
    this.filtros.push((linha) => linha[coluna] === valor);
    return this;
  }
  in(coluna: string, valores: unknown[]): this {
    this.descricao.push(`in:${coluna}`);
    this.filtros.push((linha) => valores.includes(linha[coluna]));
    return this;
  }
  not(coluna: string, operador: string, valor: string): this {
    this.descricao.push(`not:${coluna}`);
    const lista =
      operador === "in" ? valor.replace(/^\(|\)$/g, "").split(",") : [valor];
    this.filtros.push((linha) => !lista.includes(String(linha[coluna])));
    return this;
  }
  lt(coluna: string, valor: unknown): this {
    this.descricao.push(`lt:${coluna}`);
    this.filtros.push((linha) => comparar(linha[coluna], valor) < 0);
    return this;
  }
  gt(coluna: string, valor: unknown): this {
    this.descricao.push(`gt:${coluna}=${String(valor)}`);
    this.filtros.push((linha) => comparar(linha[coluna], valor) > 0);
    return this;
  }
  is(coluna: string, valor: unknown): this {
    this.descricao.push(`is:${coluna}`);
    this.filtros.push((linha) => (linha[coluna] ?? null) === valor);
    return this;
  }
  or(expressao: string): this {
    this.descricao.push(`or:${expressao}`);
    this.filtros.push(filtroDoOr(expressao));
    return this;
  }
  order(coluna: string, opcoes?: { ascending?: boolean }): this {
    this.ordem.push({ coluna, ascendente: opcoes?.ascending !== false });
    return this;
  }
  range(de: number, ate: number): this {
    this.de = de;
    this.ate = ate;
    return this;
  }
  limit(n: number): this {
    this.ate = this.de + n - 1;
    return this;
  }
  async maybeSingle(): Promise<Resposta> {
    const r = this.executar();
    const lista = Array.isArray(r.data) ? r.data : [];
    return r.error ? r : { data: lista[0] ?? null, error: null };
  }
  then<A = Resposta, B = never>(
    ok?: ((valor: Resposta) => A | PromiseLike<A>) | null,
    falha?: ((motivo: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.executar()).then(ok, falha);
  }

  private executar(): Resposta {
    this.banco.leituras.push({
      tabela: this.tabela,
      colunas: this.colunas,
      filtros: [...this.descricao],
    });
    if (this.banco.comErro.has(this.tabela)) {
      return { data: null, error: { code: "57014" } };
    }
    let resultado = this.banco
      .linhas(this.tabela)
      .filter((linha) => this.filtros.every((filtro) => filtro(linha)));
    for (const { coluna, ascendente } of [...this.ordem].reverse()) {
      resultado = [...resultado].sort(
        (a, b) => comparar(a[coluna], b[coluna]) * (ascendente ? 1 : -1),
      );
    }
    const colunas =
      this.colunas === "*" || this.colunas === ""
        ? null
        : this.colunas.split(",").map((c) => c.trim());
    return {
      data: resultado
        .slice(this.de, this.ate + 1)
        .map((linha) =>
          colunas === null
            ? { ...linha }
            : Object.fromEntries(colunas.map((c) => [c, linha[c] ?? null])),
        ),
      error: null,
    };
  }
}
