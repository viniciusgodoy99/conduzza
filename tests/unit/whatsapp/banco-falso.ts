import { randomUUID } from "node:crypto";

import { vi } from "vitest";

// Banco em memoria com a forma do cliente do Supabase (from, select, eq,
// insert, update, upsert, rpc), para os testes de unidade das Server Actions
// de numero de WhatsApp. Imita SO o que essas acoes dependem do banco real,
// com as mensagens de erro que o PostgREST devolve:
//
//   - whatsapp_account: o gatilho antes_de_criar_numero (limite do plano,
//     23514, e principal automatico) e o nome unico entre os ativos
//     (whatsapp_account_nome_unico). O unique TEMPORARIO por clinica
//     (whatsapp_account_uma_por_clinica) saiu no contrato da Fase 3
//     (migration 20260925140000): fica desligado por padrao e so liga no
//     teste que simula o banco anterior ao contrato;
//   - whatsapp_account_secret: PK account_id (o unique temporario por
//     clinica segue a mesma chave) e webhook_secret com default;
//   - whatsapp_envio_automatico: PK clinic_id (upsert por ela).
//
// Filtros e ordem sao os usados pelas acoes (eq, neq, is, in, not is); a
// ordem e ignorada, porque as acoes nao dependem dela para decidir.

export type Linha = Record<string, unknown>;
export type ErroFalso = { code: string; message: string };
type Resultado = { data: unknown; error: ErroFalso | null };

let sequencia = 0;

function duplicada(restricao: string): ErroFalso {
  return {
    code: "23505",
    message: `duplicate key value violates unique constraint "${restricao}"`,
  };
}

export class BancoFalso {
  readonly tabelas = new Map<string, Linha[]>();
  /**
   * Unique temporario (clinic_id) das duas tabelas, que existiu da Fase 1A
   * ao contrato da Fase 3. Desligado: e o banco de hoje.
   */
  uniqueTemporario = false;
  /** clinic.limite_de_numeros por clinica; ausente = sem limite */
  readonly limites = new Map<string, number>();
  readonly rpc = vi.fn<
    (nome: string, args: Record<string, unknown>) => Promise<Resultado>
  >(async () => ({ data: null, error: null }));

  linhas(tabela: string): Linha[] {
    let linhas = this.tabelas.get(tabela);
    if (!linhas) {
      linhas = [];
      this.tabelas.set(tabela, linhas);
    }
    return linhas;
  }

  limpar(): void {
    this.tabelas.clear();
    this.uniqueTemporario = false;
    this.limites.clear();
    this.rpc.mockReset();
    this.rpc.mockImplementation(async () => ({ data: null, error: null }));
  }

  cliente() {
    return {
      from: (tabela: string) => new Consulta(this, tabela),
      rpc: (nome: string, args: Record<string, unknown>) =>
        this.rpc(nome, args),
    };
  }

  /** Numero pronto, gravado direto (sem as regras do insert). */
  numero(dados: Linha & { clinic_id: string }): Linha {
    sequencia += 1;
    const linha: Linha = {
      id: randomUUID(),
      nome: "Número principal",
      principal: true,
      provider: "fake",
      server_url: null,
      instance_id: null,
      display_phone: null,
      connection_status: "desconectado",
      connected_at: null,
      disconnected_at: null,
      unit_id: null,
      removido_em: null,
      created_at: new Date(Date.UTC(2026, 8, 1) + sequencia).toISOString(),
      ...dados,
    };
    this.linhas("whatsapp_account").push(linha);
    return linha;
  }

  /** Segredo pronto de um numero. */
  segredo(dados: Linha & { clinic_id: string; account_id: string }): Linha {
    const linha: Linha = {
      instance_token: null,
      qr_code: null,
      webhook_secret: `segredo-${randomUUID().slice(0, 8)}`,
      ...dados,
    };
    this.linhas("whatsapp_account_secret").push(linha);
    return linha;
  }

  inserir(
    tabela: string,
    entrada: Linha,
  ): { linha?: Linha; error?: ErroFalso } {
    const linhas = this.linhas(tabela);
    if (tabela === "whatsapp_account") {
      const clinicId = entrada.clinic_id as string;
      const ativos = linhas.filter(
        (linha) => linha.clinic_id === clinicId && linha.removido_em === null,
      );
      const limite = this.limites.get(clinicId);
      if (limite !== undefined && ativos.length >= limite) {
        return {
          error: {
            code: "23514",
            message: "Esta clínica atingiu o limite de números do plano.",
          },
        };
      }
      if (
        this.uniqueTemporario &&
        linhas.some((linha) => linha.clinic_id === clinicId)
      ) {
        return { error: duplicada("whatsapp_account_uma_por_clinica") };
      }
      const nome = (entrada.nome as string | undefined) ?? "Número principal";
      if (
        ativos.some(
          (linha) =>
            (linha.nome as string).toLowerCase() === nome.toLowerCase(),
        )
      ) {
        return { error: duplicada("whatsapp_account_nome_unico") };
      }
      sequencia += 1;
      const linha: Linha = {
        id: randomUUID(),
        server_url: null,
        instance_id: null,
        display_phone: null,
        connection_status: "desconectado",
        connected_at: null,
        disconnected_at: null,
        unit_id: null,
        removido_em: null,
        created_at: new Date(Date.UTC(2026, 8, 1) + sequencia).toISOString(),
        ...entrada,
        nome,
        principal: !ativos.some((outra) => outra.principal === true),
      };
      linhas.push(linha);
      return { linha };
    }
    if (tabela === "whatsapp_account_secret") {
      if (linhas.some((linha) => linha.account_id === entrada.account_id)) {
        return { error: duplicada("whatsapp_account_secret_pkey") };
      }
      if (
        this.uniqueTemporario &&
        linhas.some((linha) => linha.clinic_id === entrada.clinic_id)
      ) {
        return { error: duplicada("whatsapp_account_secret_uma_por_clinica") };
      }
      const linha: Linha = {
        instance_token: null,
        qr_code: null,
        webhook_secret: `segredo-${randomUUID().slice(0, 8)}`,
        ...entrada,
      };
      linhas.push(linha);
      return { linha };
    }
    const linha: Linha = { ...entrada };
    linhas.push(linha);
    return { linha };
  }
}

type Filtro = (linha: Linha) => boolean;

class Consulta implements PromiseLike<Resultado> {
  private readonly filtros: Filtro[] = [];
  private operacao: "select" | "insert" | "update" | "upsert" = "select";
  private valores: Linha = {};
  private conflito: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private devolverLinhas = false;
  private modo: "lista" | "um" | "talvez" = "lista";

  constructor(
    private readonly banco: BancoFalso,
    private readonly tabela: string,
  ) {}

  /** As colunas sao ignoradas: devolve a linha inteira. */
  select(): this {
    if (this.operacao !== "select") {
      this.devolverLinhas = true;
    }
    return this;
  }
  insert(valores: Linha): this {
    this.operacao = "insert";
    this.valores = valores;
    return this;
  }
  update(valores: Linha): this {
    this.operacao = "update";
    this.valores = valores;
    return this;
  }
  upsert(
    valores: Linha,
    opcoes: { onConflict?: string; ignoreDuplicates?: boolean } = {},
  ): this {
    this.operacao = "upsert";
    this.valores = valores;
    this.conflito = opcoes;
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
  is(coluna: string, valor: null): this {
    this.filtros.push((linha) => (linha[coluna] ?? null) === valor);
    return this;
  }
  in(coluna: string, valores: unknown[]): this {
    this.filtros.push((linha) => valores.includes(linha[coluna]));
    return this;
  }
  not(coluna: string, operador: string, valor: null): this {
    if (operador === "is") {
      this.filtros.push((linha) => (linha[coluna] ?? null) !== valor);
    }
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  maybeSingle(): this {
    this.modo = "talvez";
    return this;
  }
  single(): this {
    this.modo = "um";
    return this;
  }

  then<A = Resultado, B = never>(
    ok?: ((valor: Resultado) => A | PromiseLike<A>) | null,
    falha?: ((motivo: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.executar()).then(ok, falha);
  }

  private casam(): Linha[] {
    return this.banco
      .linhas(this.tabela)
      .filter((linha) => this.filtros.every((filtro) => filtro(linha)));
  }

  private formatar(guardadas: Linha[]): Resultado {
    // COPIAS, como o PostgREST: quem leu nao ve a linha mudar depois.
    const linhas = guardadas.map((linha) => ({ ...linha }));
    if (this.modo === "lista") {
      return { data: linhas, error: null };
    }
    if (linhas.length > 1) {
      return {
        data: null,
        error: { code: "PGRST116", message: "mais de uma linha" },
      };
    }
    if (linhas.length === 0 && this.modo === "um") {
      return { data: null, error: { code: "PGRST116", message: "nenhuma" } };
    }
    return { data: linhas[0] ?? null, error: null };
  }

  private executar(): Resultado {
    switch (this.operacao) {
      case "select":
        return this.formatar(this.casam());
      case "insert": {
        const { linha, error } = this.banco.inserir(this.tabela, this.valores);
        if (error) {
          return { data: null, error };
        }
        return this.devolverLinhas
          ? this.formatar([linha!])
          : { data: null, error: null };
      }
      case "update": {
        const linhas = this.casam();
        for (const linha of linhas) {
          Object.assign(linha, this.valores);
        }
        return this.devolverLinhas
          ? this.formatar(linhas)
          : { data: null, error: null };
      }
      case "upsert": {
        const coluna = this.conflito.onConflict ?? "id";
        const existente = this.banco
          .linhas(this.tabela)
          .find((linha) => linha[coluna] === this.valores[coluna]);
        if (existente) {
          if (!this.conflito.ignoreDuplicates) {
            Object.assign(existente, this.valores);
          }
          return this.devolverLinhas
            ? this.formatar(this.conflito.ignoreDuplicates ? [] : [existente])
            : { data: null, error: null };
        }
        const { linha, error } = this.banco.inserir(this.tabela, this.valores);
        if (error) {
          return { data: null, error };
        }
        return this.devolverLinhas
          ? this.formatar([linha!])
          : { data: null, error: null };
      }
    }
  }
}
