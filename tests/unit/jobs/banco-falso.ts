import type { SupabaseClient } from "@supabase/supabase-js";

// Cliente Supabase de mentira para os testes de unidade dos executores da
// fila (regua e envio ativo). Cada `from(tabela)` grava a cadeia de metodos
// chamada e responde pelo manipulador da tabela; cada `rpc` grava nome e
// argumentos e responde pelo manipulador da funcao. `storage.from(bucket)`
// grava bucket, metodo e argumentos de download, upload e remove. Sem
// manipulador, a resposta e { data: null, error: null }. Nada de rede, nada
// de banco.

export type Resposta = { data: unknown; error: unknown };

export type ChamadaDeStorage = {
  bucket: string;
  metodo: "download" | "upload" | "remove";
  args: unknown[];
};

export type ChamadaDeTabela = {
  tabela: string;
  metodos: { metodo: string; args: unknown[] }[];
};

export type ChamadaDeRpc = { nome: string; args: Record<string, unknown> };

const METODOS_ENCADEADOS = [
  "select",
  "eq",
  "is",
  "in",
  "gt",
  "order",
  "limit",
  "update",
  "insert",
  "upsert",
  "delete",
];

export function bancoFalso(opcoes: {
  tabelas?: Record<string, (chamada: ChamadaDeTabela) => Resposta>;
  rpcs?: Record<string, (args: Record<string, unknown>) => Resposta>;
  storage?: (chamada: ChamadaDeStorage) => Resposta;
}) {
  const tabelas: ChamadaDeTabela[] = [];
  const rpcs: ChamadaDeRpc[] = [];
  const storage: ChamadaDeStorage[] = [];
  const cliente = {
    storage: {
      from(bucket: string) {
        const metodo =
          (nome: ChamadaDeStorage["metodo"]) =>
          async (...args: unknown[]): Promise<Resposta> => {
            const chamada: ChamadaDeStorage = { bucket, metodo: nome, args };
            storage.push(chamada);
            return opcoes.storage?.(chamada) ?? { data: null, error: null };
          };
        return {
          download: metodo("download"),
          upload: metodo("upload"),
          remove: metodo("remove"),
        };
      },
    },
    from(tabela: string) {
      const chamada: ChamadaDeTabela = { tabela, metodos: [] };
      tabelas.push(chamada);
      const responder = (): Resposta =>
        opcoes.tabelas?.[tabela]?.(chamada) ?? { data: null, error: null };
      const consulta: Record<string, unknown> = {};
      for (const metodo of METODOS_ENCADEADOS) {
        consulta[metodo] = (...args: unknown[]) => {
          chamada.metodos.push({ metodo, args });
          return consulta;
        };
      }
      consulta.maybeSingle = async () => responder();
      consulta.single = async () => responder();
      consulta.then = (
        resolver: (valor: Resposta) => unknown,
        rejeitar?: (motivo: unknown) => unknown,
      ) => Promise.resolve(responder()).then(resolver, rejeitar);
      return consulta;
    },
    async rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args });
      return opcoes.rpcs?.[nome]?.(args) ?? { data: null, error: null };
    },
  };
  return {
    admin: cliente as unknown as SupabaseClient,
    tabelas,
    rpcs,
    /** As chamadas ao Storage, na ordem. */
    storage,
    /** As chamadas de uma RPC, na ordem. */
    chamadasDe(nome: string): Record<string, unknown>[] {
      return rpcs.filter((r) => r.nome === nome).map((r) => r.args);
    },
    /** Os updates gravados numa tabela (o primeiro argumento de cada um). */
    updatesEm(tabela: string): unknown[] {
      return tabelas
        .filter((c) => c.tabela === tabela)
        .flatMap((c) => c.metodos.filter((m) => m.metodo === "update"))
        .map((m) => m.args[0]);
    },
  };
}

/** A chamada foi um update (e nao a leitura da mesma tabela)? */
export function eUpdate(chamada: ChamadaDeTabela): boolean {
  return chamada.metodos.some((m) => m.metodo === "update");
}
