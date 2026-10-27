import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

// Banco em memoria com a forma do cliente do Supabase, para os testes de
// unidade da IA no WhatsApp (E3). Imita SO o que o executor, o envio e o
// carregador do historico usam: from (select, insert, update, upsert,
// delete, com eq, neq, is, not is, in, gte, gt, lt, lte, or simples, order
// e limit; maybeSingle, single e await direto, com count/head) e rpc por
// manipulador. Nada de rede, nada de banco. Os gatilhos e as RPCs de
// verdade sao provados nas suites de integracao e RLS (com o banco).

export type Linha = Record<string, unknown>;
export type Resposta = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count?: number | null;
};
type Filtro = (linha: Linha) => boolean;

export type ManipuladorDeRpc = (
  args: Record<string, unknown>,
) => Resposta | Promise<Resposta>;

/** O estado vazio do atendimento (ia_estado_do_atendimento com linha nula). */
export function estadoVazioDoBanco(): Linha {
  return {
    etapa: "informacao",
    intencao: null,
    procedure_id: null,
    professional_id: null,
    insurance_id: null,
    particular: null,
    unit_id: null,
    horarios_oferecidos: [],
    slot_hold_id: null,
    appointment_id: null,
    pedido_pendente: null,
    pedido_pendente_em: null,
    falhas_seguidas: 0,
    desfecho: null,
  };
}

export class BancoEmMemoria {
  readonly tabelas = new Map<string, Linha[]>();
  readonly manipuladores = new Map<string, ManipuladorDeRpc>([
    // A conta da clinica nao esta suspensa (onda 1): a funcao do banco
    // sempre devolve o booleano, e a trava final do envio FECHA
    // (leitura_falhou) com qualquer outra resposta. Quem testa a suspensao
    // registra o proprio manipulador (banco.rpc).
    ["clinica_esta_suspensa", () => ({ data: false, error: null })],
    // AG3: o estado do atendimento (o contrato de ler_atendimento_da_ia e
    // gravar_atendimento_da_ia, simplificado: a conversa na IA, a versao
    // otimista e a idempotencia por job). Quem testa a recusa registra o
    // proprio manipulador.
    ["ler_atendimento_da_ia", (args) => this.lerAtendimento(args)],
    ["gravar_atendimento_da_ia", (args) => this.gravarAtendimento(args)],
  ]);

  private conversaNaIa(args: Record<string, unknown>): boolean {
    const conversa = this.linhas("conversation").find(
      (c) => c.id === args.p_conversation_id && c.clinic_id === args.p_clinic_id,
    );
    return (
      conversa !== undefined &&
      conversa.status === "ia_atendendo" &&
      (conversa.assignee_user_id ?? null) === null
    );
  }

  private lerAtendimento(args: Record<string, unknown>): Resposta {
    if (!this.conversaNaIa(args)) {
      return { data: { ok: false, motivo: "fora_da_ia" }, error: null };
    }
    const linha = this.linhas("ia_atendimento").find(
      (l) => l.conversation_id === args.p_conversation_id,
    );
    let estado = estadoVazioDoBanco();
    let versao = 0;
    if (linha !== undefined && linha.job_id === args.p_job_id) {
      estado = (linha.anterior as Linha | null) ?? estadoVazioDoBanco();
      versao = Number(linha.versao) - 1;
    } else if (linha !== undefined) {
      estado = linha.estado as Linha;
      versao = Number(linha.versao);
    }
    return {
      data: {
        ok: true,
        versao,
        janela_desde: "2026-10-13T14:58:00+00:00",
        estado: structuredClone(estado),
        dados: {
          nome_completo: false,
          data_nascimento: false,
          cpf: false,
          carteirinha: false,
          para_o_titular: null,
          faltam: [],
        },
      },
      error: null,
    };
  }

  private gravarAtendimento(args: Record<string, unknown>): Resposta {
    if (!this.conversaNaIa(args)) {
      return { data: { ok: false, motivo: "fora_da_ia" }, error: null };
    }
    const linhas = this.linhas("ia_atendimento");
    const linha = linhas.find((l) => l.conversation_id === args.p_conversation_id);
    const estado = structuredClone(args.p_estado) as Linha;
    if (linha === undefined) {
      if (args.p_versao !== 0) {
        return { data: { ok: false, motivo: "estado_mudou" }, error: null };
      }
      linhas.push({
        conversation_id: args.p_conversation_id,
        job_id: args.p_job_id,
        versao: 1,
        estado,
        anterior: null,
      });
      return { data: { ok: true, versao: 1, reutilizado: false }, error: null };
    }
    if (linha.job_id === args.p_job_id) {
      if (args.p_versao !== Number(linha.versao) - 1) {
        return { data: { ok: false, motivo: "estado_mudou" }, error: null };
      }
      linha.estado = estado;
      return {
        data: { ok: true, versao: linha.versao, reutilizado: true },
        error: null,
      };
    }
    if (args.p_versao !== linha.versao) {
      return { data: { ok: false, motivo: "estado_mudou" }, error: null };
    }
    linha.anterior = linha.estado;
    linha.estado = estado;
    linha.job_id = args.p_job_id;
    linha.versao = Number(linha.versao) + 1;
    return {
      data: { ok: true, versao: linha.versao, reutilizado: false },
      error: null,
    };
  }
  readonly chamadas: { nome: string; args: Record<string, unknown> }[] = [];
  /** Cada operacao em tabela: [tabela, operacao, valores]. */
  readonly operacoes: {
    tabela: string;
    operacao: string;
    valores?: unknown;
  }[] = [];
  /** Erro forcado por "tabela:operacao" (select, insert, update, upsert, delete). */
  readonly erros = new Map<string, { code?: string; message?: string }>();
  /** Gatilho de INSERT: devolve o erro (como o PostgREST) ou null. */
  aoInserir: ((tabela: string, linha: Linha) => Resposta["error"]) | null =
    null;

  linhas(tabela: string): Linha[] {
    let linhas = this.tabelas.get(tabela);
    if (!linhas) {
      linhas = [];
      this.tabelas.set(tabela, linhas);
    }
    return linhas;
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
          return { data: null, error: null };
        }
        return manipulador(args);
      },
    } as unknown as SupabaseClient;
  }
}

function comparar(a: unknown, b: unknown): number {
  const x = String(a ?? "");
  const y = String(b ?? "");
  return x < y ? -1 : x > y ? 1 : 0;
}

/** "coluna.eq.valor,coluna.neq.valor" (o que o codigo usa no or). */
function filtroDoOr(expressao: string): Filtro {
  const partes = expressao.split(",").map((parte) => {
    const [coluna, operador, ...resto] = parte.split(".");
    const bruto = resto.join(".");
    const valor: unknown =
      bruto === "true" ? true : bruto === "false" ? false : bruto;
    return (linha: Linha) =>
      operador === "eq"
        ? linha[coluna ?? ""] === valor
        : operador === "neq"
          ? linha[coluna ?? ""] !== valor
          : false;
  });
  return (linha) => partes.some((parte) => parte(linha));
}

class Consulta implements PromiseLike<Resposta> {
  private operacao: "select" | "insert" | "update" | "upsert" | "delete" =
    "select";
  private valores: Linha | Linha[] | null = null;
  private readonly filtros: Filtro[] = [];
  private ordem: { coluna: string; ascendente: boolean }[] = [];
  private limite: number | null = null;
  private contar = false;
  private soCabeca = false;
  private devolver = false;

  constructor(
    private readonly banco: BancoEmMemoria,
    private readonly tabela: string,
  ) {}

  select(_colunas?: string, opcoes?: { count?: string; head?: boolean }): this {
    if (this.operacao !== "select") {
      this.devolver = true;
    }
    this.contar = opcoes?.count === "exact";
    this.soCabeca = opcoes?.head === true;
    return this;
  }
  insert(valores: Linha | Linha[]): this {
    this.operacao = "insert";
    this.valores = valores;
    return this;
  }
  update(valores: Linha): this {
    this.operacao = "update";
    this.valores = valores;
    return this;
  }
  upsert(valores: Linha | Linha[]): this {
    this.operacao = "upsert";
    this.valores = valores;
    return this;
  }
  delete(): this {
    this.operacao = "delete";
    return this;
  }
  eq(coluna: string, valor: unknown): this {
    this.filtros.push((linha) => linha[coluna] === valor);
    return this;
  }
  neq(coluna: string, valor: unknown): this {
    this.filtros.push((linha) => linha[coluna] !== valor);
    return this;
  }
  is(coluna: string, valor: unknown): this {
    this.filtros.push((linha) => (linha[coluna] ?? null) === valor);
    return this;
  }
  in(coluna: string, valores: unknown[]): this {
    this.filtros.push((linha) => valores.includes(linha[coluna]));
    return this;
  }
  gte(coluna: string, valor: unknown): this {
    this.filtros.push((linha) => comparar(linha[coluna], valor) >= 0);
    return this;
  }
  gt(coluna: string, valor: unknown): this {
    this.filtros.push((linha) => comparar(linha[coluna], valor) > 0);
    return this;
  }
  lte(coluna: string, valor: unknown): this {
    this.filtros.push((linha) => comparar(linha[coluna], valor) <= 0);
    return this;
  }
  lt(coluna: string, valor: unknown): this {
    this.filtros.push((linha) => comparar(linha[coluna], valor) < 0);
    return this;
  }
  or(expressao: string): this {
    this.filtros.push(filtroDoOr(expressao));
    return this;
  }
  /** So o "is" (not is null), o que o codigo usa. */
  not(coluna: string, operador: string, valor: unknown): this {
    if (operador === "is") {
      this.filtros.push((linha) => (linha[coluna] ?? null) !== valor);
    }
    return this;
  }
  order(coluna: string, opcoes?: { ascending?: boolean }): this {
    this.ordem.push({ coluna, ascendente: opcoes?.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.limite = n;
    return this;
  }

  async maybeSingle(): Promise<Resposta> {
    const r = this.executar();
    if (r.error) {
      return r;
    }
    const lista = Array.isArray(r.data) ? r.data : [];
    return { data: lista[0] ?? null, error: null };
  }
  async single(): Promise<Resposta> {
    const r = this.executar();
    if (r.error) {
      return r;
    }
    const lista = Array.isArray(r.data) ? r.data : [];
    return lista.length === 1
      ? { data: lista[0], error: null }
      : { data: null, error: { code: "PGRST116" } };
  }
  then<A = Resposta, B = never>(
    ok?: ((valor: Resposta) => A | PromiseLike<A>) | null,
    falha?: ((motivo: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.executar()).then(ok, falha);
  }

  private combinam(linha: Linha): boolean {
    return this.filtros.every((filtro) => filtro(linha));
  }

  private executar(): Resposta {
    const banco = this.banco;
    banco.operacoes.push({
      tabela: this.tabela,
      operacao: this.operacao,
      valores: this.valores ?? undefined,
    });
    const erro = banco.erros.get(`${this.tabela}:${this.operacao}`);
    if (erro) {
      return { data: null, error: erro };
    }
    const linhas = banco.linhas(this.tabela);
    if (this.operacao === "insert" || this.operacao === "upsert") {
      const novas = (
        Array.isArray(this.valores) ? this.valores : [this.valores ?? {}]
      ).map((valores) => ({ ...valores }));
      const gravadas: Linha[] = [];
      for (const nova of novas) {
        if (this.operacao === "upsert") {
          const chave = this.tabela === "ai_turno" ? "job_id" : "id";
          const existente = linhas.find((l) => l[chave] === nova[chave]);
          if (existente) {
            Object.assign(existente, nova);
            gravadas.push(existente);
            continue;
          }
        }
        const linha: Linha = {
          id: randomUUID(),
          created_at: new Date().toISOString(),
          ...nova,
        };
        const recusa = banco.aoInserir?.(this.tabela, linha) ?? null;
        if (recusa) {
          return { data: null, error: recusa };
        }
        linhas.push(linha);
        gravadas.push(linha);
      }
      return { data: this.devolver ? gravadas : null, error: null };
    }
    if (this.operacao === "update") {
      const alvo = linhas.filter((linha) => this.combinam(linha));
      for (const linha of alvo) {
        Object.assign(linha, this.valores);
      }
      return { data: this.devolver ? alvo : null, error: null };
    }
    if (this.operacao === "delete") {
      const restantes = linhas.filter((linha) => !this.combinam(linha));
      banco.tabelas.set(this.tabela, restantes);
      return { data: null, error: null };
    }
    let resultado = linhas.filter((linha) => this.combinam(linha));
    for (const { coluna, ascendente } of [...this.ordem].reverse()) {
      resultado = [...resultado].sort(
        (a, b) => comparar(a[coluna], b[coluna]) * (ascendente ? 1 : -1),
      );
    }
    const total = resultado.length;
    if (this.limite !== null) {
      resultado = resultado.slice(0, this.limite);
    }
    return {
      data: this.soCabeca ? null : resultado.map((linha) => ({ ...linha })),
      error: null,
      count: this.contar ? total : null,
    };
  }
}
