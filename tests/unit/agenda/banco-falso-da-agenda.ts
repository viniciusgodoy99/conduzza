// Banco falso com a forma do cliente do Supabase, para as Server Actions da
// Agenda e das Confirmacoes (AG4: a remarcacao da IA). Tabelas em memoria;
// select, update e insert com os filtros que as acoes usam (eq, not in, not
// is null, is null), contagem (head: true), maybeSingle e o "then" da
// consulta. Registra cada operacao e cada RPC, na ordem, para os testes
// conferirem o que foi lido, gravado e chamado. Nada aqui e dado de
// paciente real.

export type Linha = Record<string, unknown>;

export type Operacao = {
  tabela: string;
  tipo: "select" | "insert" | "update";
  colunas?: string;
  contar?: boolean;
  dados?: unknown;
  filtros: [string, unknown][];
  /** .not(coluna, "in", "(a,b)"): a coluna fora da lista. */
  excluidos: [string, string[]][];
  /** .not(coluna, "is", null): a coluna preenchida. */
  preenchidos: string[];
  /** .is(coluna, null): a coluna vazia. */
  vazios: string[];
};

export type ErroDoBanco = {
  code?: string;
  message?: string;
  hint?: string;
  details?: string;
};

export type RespostaDoRpc = { data: unknown; error: ErroDoBanco | null };

export class BancoFalso {
  tabelas: Record<string, Linha[]> = {};
  operacoes: Operacao[] = [];
  rpcs: { nome: string; args: unknown }[] = [];
  /** A sequencia "tabela:tipo" e "rpc:nome", para conferir a ordem. */
  sequencia: string[] = [];
  /** Erro de leitura por tabela (o select devolve o erro). */
  errosNaLeitura: Record<string, ErroDoBanco> = {};
  /** Erro do proximo update por tabela. */
  errosNoUpdate: Record<string, ErroDoBanco> = {};
  respostasDosRpcs: Record<string, RespostaDoRpc | "lanca"> = {};

  linha(tabela: string, id: string): Linha {
    const achada = (this.tabelas[tabela] ?? []).find((l) => l.id === id);
    if (!achada) {
      throw new Error(`${tabela} ${id} nao existe`);
    }
    return achada;
  }

  doTipo(tabela: string, tipo: Operacao["tipo"]): Operacao[] {
    return this.operacoes.filter(
      (op) => op.tabela === tabela && op.tipo === tipo,
    );
  }

  /** O que foi gravado (tabela, tipo e dados), sem as leituras. */
  gravacoes(): { tabela: string; tipo: string; dados: unknown }[] {
    return this.operacoes
      .filter((op) => op.tipo !== "select")
      .map(({ tabela, tipo, dados }) => ({ tabela, tipo, dados }));
  }

  cliente() {
    const from = (tabela: string) => {
      const op: Operacao = {
        tabela,
        tipo: "select",
        filtros: [],
        excluidos: [],
        preenchidos: [],
        vazios: [],
      };
      const casa = (linha: Linha) =>
        op.filtros.every(([coluna, valor]) => linha[coluna] === valor) &&
        op.excluidos.every(
          ([coluna, lista]) => !lista.includes(String(linha[coluna])),
        ) &&
        op.preenchidos.every(
          (coluna) => linha[coluna] !== null && linha[coluna] !== undefined,
        ) &&
        op.vazios.every(
          (coluna) => linha[coluna] === null || linha[coluna] === undefined,
        );
      const executar = (): {
        data: unknown;
        error: unknown;
        count?: number;
      } => {
        this.operacoes.push(op);
        this.sequencia.push(`${tabela}:${op.tipo}`);
        const linhas = this.tabelas[tabela] ?? [];
        if (op.tipo === "select") {
          const erro = this.errosNaLeitura[tabela];
          if (erro) {
            return { data: null, error: erro };
          }
          const achadas = linhas.filter(casa).map((linha) => ({ ...linha }));
          if (op.contar) {
            return { data: null, count: achadas.length, error: null };
          }
          return { data: achadas, error: null };
        }
        if (op.tipo === "update") {
          const erro = this.errosNoUpdate[tabela];
          if (erro) {
            return { data: null, error: erro };
          }
          const alvos = linhas.filter(casa);
          for (const linha of alvos) {
            Object.assign(linha, op.dados);
          }
          return {
            data: alvos.map((linha) => ({ id: linha.id })),
            error: null,
          };
        }
        return { data: null, error: null };
      };
      const api = {
        select: (colunas: string, opcoes?: { head?: boolean }) => {
          if (op.tipo === "select") {
            op.colunas = colunas;
            op.contar = opcoes?.head === true;
          }
          return api;
        },
        update: (dados: unknown) => {
          op.tipo = "update";
          op.dados = dados;
          return api;
        },
        insert: (dados: unknown) => {
          op.tipo = "insert";
          op.dados = dados;
          return api;
        },
        eq: (coluna: string, valor: unknown) => {
          op.filtros.push([coluna, valor]);
          return api;
        },
        not: (coluna: string, operador: string, valor: unknown) => {
          if (operador === "in") {
            op.excluidos.push([
              coluna,
              String(valor)
                .replace(/^\(|\)$/g, "")
                .split(","),
            ]);
          } else if (operador === "is" && valor === null) {
            op.preenchidos.push(coluna);
          } else {
            throw new Error(`operador ${operador} sem dublê`);
          }
          return api;
        },
        is: (coluna: string, valor: unknown) => {
          if (valor !== null) {
            throw new Error("is so com null no dublê");
          }
          op.vazios.push(coluna);
          return api;
        },
        lt: () => api,
        gt: () => api,
        order: () => api,
        limit: () => api,
        maybeSingle: async () => {
          const { data, error } = executar();
          return {
            data: Array.isArray(data) ? (data[0] ?? null) : data,
            error,
          };
        },
        then: <T>(
          ok: (valor: { data: unknown; error: unknown; count?: number }) => T,
          falha?: (erro: unknown) => T,
        ) => Promise.resolve(executar()).then(ok, falha),
      };
      return api;
    };
    const rpc = async (nome: string, args: unknown) => {
      this.rpcs.push({ nome, args });
      this.sequencia.push(`rpc:${nome}`);
      const resposta = this.respostasDosRpcs[nome];
      if (resposta === "lanca") {
        throw new Error("rede");
      }
      return resposta ?? { data: null, error: null };
    };
    return { from, rpc };
  }
}
