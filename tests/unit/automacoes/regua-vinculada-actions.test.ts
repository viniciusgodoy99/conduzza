import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { chaveDeEspecialidade } from "@/components/automacoes/vinculo-da-regua";

// Reguas vinculadas (decisao do dono em 29/09/2026) nas Server Actions da
// Tela 7, contra um banco em memoria com a forma do cliente do Supabase:
//   - criarReguaDeExcecaoAction aceita o tipo (confirmacao ou pos_falta) e o
//     vinculo (medico, especialidade, procedimento; reforcada so na
//     confirmacao), copia janela e passos da GERAL daquele tipo, nasce
//     desligada, com o nome "Confirmação: Dra. Helena" / "Pós-falta: ...", e
//     o 23505 do indice unico vira mensagem clara;
//   - a GERAL e a que nao tem procedure_id, professional_id nem specialty e
//     nao e reforcada: uma vinculada por medico (tambem sem procedimento) nao
//     pode ser confundida com ela;
//   - excluirReguaAction libera a vinculada de pos-falta e protege a geral
//     de cada tipo; e recusa excluir vinculada que enviou toque nos ultimos
//     30 minutos (o cascade apagaria a prova que a trava do planner usa).

const CLINICA_A = "0a0a0a0a-0000-4000-8000-00000000000a";
const CLINICA_B = "0b0b0b0b-0000-4000-8000-00000000000b";

type Linha = Record<string, unknown>;
type Erro = { code: string; message: string };
type Resultado = { data: unknown; error: Erro | null };

const ZERO = "00000000-0000-0000-0000-000000000000";

class Banco {
  readonly tabelas = new Map<string, Linha[]>();

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
  }

  cliente() {
    return { from: (tabela: string) => new Consulta(this, tabela) };
  }

  /** O indice unico cadence_configuracao_unica da migration da frente. */
  private chaveDaRegua(linha: Linha): string | null {
    if (linha.kind === "followup") {
      return null;
    }
    return [
      linha.clinic_id,
      linha.kind,
      linha.procedure_id ?? ZERO,
      linha.professional_id ?? ZERO,
      typeof linha.specialty === "string"
        ? chaveDeEspecialidade(linha.specialty)
        : "",
      Boolean(linha.for_no_show_history),
    ].join("|");
  }

  inserir(tabela: string, entrada: Linha): { linha?: Linha; error?: Erro } {
    const linha: Linha = { id: randomUUID(), ...entrada };
    if (tabela === "cadence") {
      const chave = this.chaveDaRegua(linha);
      if (
        chave !== null &&
        this.linhas("cadence").some(
          (outra) => this.chaveDaRegua(outra) === chave,
        )
      ) {
        return {
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "cadence_configuracao_unica"',
          },
        };
      }
    }
    this.linhas(tabela).push(linha);
    return { linha };
  }
}

type Filtro = (linha: Linha) => boolean;

class Consulta implements PromiseLike<Resultado> {
  private readonly filtros: Filtro[] = [];
  private operacao: "select" | "insert" | "update" | "delete" = "select";
  private valores: Linha | Linha[] = {};
  private devolverLinhas = false;
  private modo: "lista" | "um" | "talvez" = "lista";

  constructor(
    private readonly banco: Banco,
    private readonly tabela: string,
  ) {}

  select(): this {
    if (this.operacao !== "select") {
      this.devolverLinhas = true;
    }
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
  delete(): this {
    this.operacao = "delete";
    return this;
  }
  eq(coluna: string, valor: unknown): this {
    this.filtros.push((linha) => linha[coluna] === valor);
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
  /** Texto ISO de instante (sent_at): a ordem do texto e a do tempo. */
  gt(coluna: string, valor: string): this {
    this.filtros.push(
      (linha) => typeof linha[coluna] === "string" && linha[coluna] > valor,
    );
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

  private formatar(linhas: Linha[]): Resultado {
    const copias = linhas.map((linha) => ({ ...linha }));
    if (this.modo === "lista") {
      return { data: copias, error: null };
    }
    if (copias.length > 1) {
      return {
        data: null,
        error: { code: "PGRST116", message: "mais de uma linha" },
      };
    }
    if (copias.length === 0 && this.modo === "um") {
      return { data: null, error: { code: "PGRST116", message: "nenhuma" } };
    }
    return { data: copias[0] ?? null, error: null };
  }

  private executar(): Resultado {
    switch (this.operacao) {
      case "select":
        return this.formatar(this.casam());
      case "insert": {
        // Lote atomico, como o PostgREST: falhou um, nao entra nenhum.
        const entradas = Array.isArray(this.valores)
          ? this.valores
          : [this.valores];
        const inseridas: Linha[] = [];
        for (const entrada of entradas) {
          const { linha, error } = this.banco.inserir(this.tabela, entrada);
          if (error) {
            const todas = this.banco.linhas(this.tabela);
            for (const feita of inseridas) {
              todas.splice(todas.indexOf(feita), 1);
            }
            return { data: null, error };
          }
          inseridas.push(linha!);
        }
        return this.devolverLinhas
          ? this.formatar(inseridas)
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
      case "delete": {
        const linhas = this.casam();
        const todas = this.banco.linhas(this.tabela);
        for (const linha of linhas) {
          todas.splice(todas.indexOf(linha), 1);
        }
        return this.devolverLinhas
          ? this.formatar(linhas)
          : { data: null, error: null };
      }
    }
  }
}

const banco = new Banco();
const sessao = {
  userId: "usuario-da-sessao",
  active: {
    clinicId: CLINICA_A,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "gestor" as string,
    status: "ativo",
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => banco.cliente(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    ...banco.cliente(),
    storage: {
      from: () => ({
        download: async () => ({ data: null, error: null }),
        upload: async () => ({ data: null, error: null }),
        remove: async () => ({ data: null, error: null }),
      }),
    },
  }),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { criarReguaDeExcecaoAction, excluirReguaAction } =
  await import("@/app/(app)/automacoes/actions");

const JANELA = {
  send_window_start: "08:00",
  send_window_end: "20:00",
  send_weekdays: [1, 2, 3, 4, 5],
};

/** A geral de um tipo, com passos, como o seed da clinica nova. */
function geral(
  kind: "confirmacao" | "pos_falta",
  clinicId = CLINICA_A,
  offsets: number[] = kind === "confirmacao" ? [-1440, -180] : [0, 2880],
): Linha {
  const regua: Linha = {
    id: randomUUID(),
    clinic_id: clinicId,
    kind,
    name: kind === "confirmacao" ? "Confirmação de consulta" : "Recuperação",
    procedure_id: null,
    professional_id: null,
    specialty: null,
    for_no_show_history: false,
    no_show_threshold: 2,
    active: true,
    ...JANELA,
  };
  banco.linhas("cadence").push(regua);
  for (const offset of offsets) {
    banco.linhas("cadence_step").push({
      id: randomUUID(),
      clinic_id: clinicId,
      cadence_id: regua.id,
      offset_minutes: offset,
      fixed_body: `Texto ${offset}`,
      media_path: null,
      media_type: null,
      media_mimetype: null,
      media_filename: null,
    });
  }
  return regua;
}

function profissional(campos: Linha): Linha {
  const linha: Linha = {
    id: randomUUID(),
    clinic_id: CLINICA_A,
    active: true,
    specialties: [],
    ...campos,
  };
  banco.linhas("professional").push(linha);
  return linha;
}

function procedimento(campos: Linha): Linha {
  const linha: Linha = {
    id: randomUUID(),
    clinic_id: CLINICA_A,
    active: true,
    ...campos,
  };
  banco.linhas("procedure").push(linha);
  return linha;
}

function reguasCriadas(): Linha[] {
  return banco
    .linhas("cadence")
    .filter(
      (regua) =>
        regua.procedure_id != null ||
        regua.professional_id != null ||
        regua.specialty != null ||
        regua.for_no_show_history === true,
    );
}

beforeEach(() => {
  banco.limpar();
  sessao.active.role = "gestor";
});

describe("criarReguaDeExcecaoAction", () => {
  it("cria a régua de confirmação de um médico, desligada, copiando a geral", async () => {
    const confirmacao = geral("confirmacao");
    geral("pos_falta");
    const helena = profissional({
      name: "Dra. Helena",
      specialties: ["Dermatologia"],
    });

    const resultado = await criarReguaDeExcecaoAction({
      kind: "confirmacao",
      base: "medico",
      professional_id: helena.id,
    });

    expect(resultado).toEqual({ ok: true });
    const [nova] = reguasCriadas();
    expect(nova).toMatchObject({
      clinic_id: CLINICA_A,
      kind: "confirmacao",
      name: "Confirmação: Dra. Helena",
      professional_id: helena.id,
      procedure_id: null,
      specialty: null,
      for_no_show_history: false,
      active: false,
      ...JANELA,
    });
    const passos = banco
      .linhas("cadence_step")
      .filter((passo) => passo.cadence_id === nova!.id)
      .map((passo) => [passo.offset_minutes, passo.fixed_body]);
    expect(passos).toEqual([
      [-1440, "Texto -1440"],
      [-180, "Texto -180"],
    ]);
    expect(confirmacao.active).toBe(true);
    expect(banco.linhas("audit_log")).toEqual([
      expect.objectContaining({
        clinic_id: CLINICA_A,
        entity: "cadence",
        entity_id: nova!.id,
      }),
    ]);
  });

  it("a geral é a sem vínculo nenhum: a vinculada por médico não a substitui", async () => {
    geral("confirmacao");
    const helena = profissional({ name: "Dra. Helena" });
    const joao = profissional({ name: "Dr. João" });

    // A primeira vinculada tambem tem procedure_id nulo e nao e reforcada:
    // com o filtro antigo, a segunda criacao acharia duas "gerais".
    expect(
      await criarReguaDeExcecaoAction({
        kind: "confirmacao",
        base: "medico",
        professional_id: helena.id,
      }),
    ).toEqual({ ok: true });
    expect(
      await criarReguaDeExcecaoAction({
        kind: "confirmacao",
        base: "medico",
        professional_id: joao.id,
      }),
    ).toEqual({ ok: true });
    expect(reguasCriadas().map((regua) => regua.name)).toEqual([
      "Confirmação: Dra. Helena",
      "Confirmação: Dr. João",
    ]);
  });

  it("cria a régua de pós-falta de uma especialidade com o rótulo da lista", async () => {
    geral("confirmacao");
    const posFalta = geral("pos_falta");
    profissional({ name: "Dra. Helena", specialties: ["Dermatologia"] });
    profissional({ name: "Dra. Bia", specialties: ["Dermatologia"] });
    profissional({ name: "Dr. Caio", specialties: ["dermatologia "] });

    const resultado = await criarReguaDeExcecaoAction({
      kind: "pos_falta",
      base: "especialidade",
      specialty: "  DERMATOLOGIA ",
    });

    expect(resultado).toEqual({ ok: true });
    const [nova] = reguasCriadas();
    expect(nova).toMatchObject({
      kind: "pos_falta",
      name: "Pós-falta: Dermatologia",
      specialty: "Dermatologia",
      professional_id: null,
      procedure_id: null,
      active: false,
    });
    const offsets = banco
      .linhas("cadence_step")
      .filter((passo) => passo.cadence_id === nova!.id)
      .map((passo) => passo.offset_minutes);
    expect(offsets).toEqual([0, 2880]);
    expect(posFalta.active).toBe(true);
  });

  it("cria a régua de um procedimento ativo", async () => {
    geral("confirmacao");
    const colono = procedimento({ name: "Colonoscopia" });

    const resultado = await criarReguaDeExcecaoAction({
      kind: "confirmacao",
      base: "procedimento",
      procedure_id: colono.id,
    });

    expect(resultado).toEqual({ ok: true });
    expect(reguasCriadas()[0]).toMatchObject({
      name: "Confirmação: Colonoscopia",
      procedure_id: colono.id,
    });
  });

  it("recusa especialidade que nenhum profissional ativo tem", async () => {
    geral("confirmacao");
    profissional({
      name: "Dr. Antigo",
      specialties: ["Cardiologia"],
      active: false,
    });

    const resultado = await criarReguaDeExcecaoAction({
      kind: "confirmacao",
      base: "especialidade",
      specialty: "Cardiologia",
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toContain("Nenhum profissional ativo");
    expect(reguasCriadas()).toEqual([]);
  });

  it("recusa médico inativo ou de outra clínica", async () => {
    geral("confirmacao");
    const inativo = profissional({ name: "Dr. Saiu", active: false });
    const deOutra = profissional({ name: "Dr. B", clinic_id: CLINICA_B });

    for (const medico of [inativo, deOutra]) {
      const resultado = await criarReguaDeExcecaoAction({
        kind: "confirmacao",
        base: "medico",
        professional_id: medico.id,
      });
      expect(resultado.ok).toBe(false);
      expect(resultado.error).toContain("Médico não encontrado");
    }
    expect(reguasCriadas()).toEqual([]);
  });

  it("régua repetida vira mensagem clara (23505)", async () => {
    geral("confirmacao");
    geral("pos_falta");
    const helena = profissional({
      name: "Dra. Helena",
      specialties: ["Dermatologia"],
    });
    const entrada = {
      kind: "pos_falta",
      base: "medico",
      professional_id: helena.id,
    };
    expect(await criarReguaDeExcecaoAction(entrada)).toEqual({ ok: true });

    expect(await criarReguaDeExcecaoAction(entrada)).toEqual({
      ok: false,
      error: "Já existe uma régua de pós-falta para este médico.",
    });
    // O mesmo medico na CONFIRMACAO e outra regua.
    expect(
      await criarReguaDeExcecaoAction({ ...entrada, kind: "confirmacao" }),
    ).toEqual({ ok: true });

    expect(
      await criarReguaDeExcecaoAction({
        kind: "confirmacao",
        base: "especialidade",
        specialty: "Dermatologia",
      }),
    ).toEqual({ ok: true });
    expect(
      await criarReguaDeExcecaoAction({
        kind: "confirmacao",
        base: "especialidade",
        specialty: "dermatologia",
      }),
    ).toEqual({
      ok: false,
      error: "Já existe uma régua de confirmação para esta especialidade.",
    });
  });

  it("a reforçada só existe na confirmação", async () => {
    geral("confirmacao");
    geral("pos_falta");

    expect(
      await criarReguaDeExcecaoAction({
        kind: "pos_falta",
        base: "reforcada",
        no_show_threshold: 2,
      }),
    ).toEqual({ ok: false, error: "Dados inválidos." });
    expect(
      await criarReguaDeExcecaoAction({
        kind: "confirmacao",
        base: "reforcada",
        no_show_threshold: 3,
      }),
    ).toEqual({ ok: true });
    expect(reguasCriadas()[0]).toMatchObject({
      kind: "confirmacao",
      name: "Confirmação reforçada",
      for_no_show_history: true,
      no_show_threshold: 3,
    });
  });

  it("sem a geral do tipo, não cria", async () => {
    geral("confirmacao");
    geral("pos_falta", CLINICA_B);
    const helena = profissional({ name: "Dra. Helena" });

    const resultado = await criarReguaDeExcecaoAction({
      kind: "pos_falta",
      base: "medico",
      professional_id: helena.id,
    });

    expect(resultado).toEqual({
      ok: false,
      error:
        "A clínica ainda não tem a régua geral de recuperação depois da falta.",
    });
  });

  it("recepção não cria régua", async () => {
    geral("confirmacao");
    const helena = profissional({ name: "Dra. Helena" });
    sessao.active.role = "recepcao";

    const resultado = await criarReguaDeExcecaoAction({
      kind: "confirmacao",
      base: "medico",
      professional_id: helena.id,
    });

    expect(resultado.ok).toBe(false);
    expect(reguasCriadas()).toEqual([]);
  });

  it("tipo fora de confirmação e pós-falta é recusado", async () => {
    geral("confirmacao");
    const helena = profissional({ name: "Dra. Helena" });

    expect(
      await criarReguaDeExcecaoAction({
        kind: "followup",
        base: "medico",
        professional_id: helena.id,
      }),
    ).toEqual({ ok: false, error: "Dados inválidos." });
  });
});

describe("excluirReguaAction", () => {
  it("exclui a vinculada de pós-falta", async () => {
    geral("pos_falta");
    const helena = profissional({ name: "Dra. Helena" });
    await criarReguaDeExcecaoAction({
      kind: "pos_falta",
      base: "medico",
      professional_id: helena.id,
    });
    const [vinculada] = reguasCriadas();

    const resultado = await excluirReguaAction({ cadence_id: vinculada!.id });

    expect(resultado).toEqual({ ok: true });
    expect(reguasCriadas()).toEqual([]);
  });

  it("protege a geral de confirmação e a de pós-falta", async () => {
    const confirmacao = geral("confirmacao");
    const posFalta = geral("pos_falta");

    expect(await excluirReguaAction({ cadence_id: confirmacao.id })).toEqual({
      ok: false,
      error:
        "A régua geral de confirmação não pode ser excluída. Desligue o interruptor para pausar.",
    });
    expect(await excluirReguaAction({ cadence_id: posFalta.id })).toEqual({
      ok: false,
      error:
        "A régua geral de recuperação não pode ser excluída. Desligue o interruptor para pausar.",
    });
    expect(banco.linhas("cadence")).toHaveLength(2);
  });

  it("não exclui régua de outra clínica", async () => {
    geral("confirmacao");
    const deOutra = geral("pos_falta", CLINICA_B);
    const vinculadaDeOutra: Linha = {
      ...deOutra,
      id: randomUUID(),
      name: "Pós-falta: Dr. B",
      professional_id: randomUUID(),
    };
    banco.linhas("cadence").push(vinculadaDeOutra);

    expect(
      await excluirReguaAction({ cadence_id: vinculadaDeOutra.id }),
    ).toEqual({ ok: false, error: "Régua não encontrada." });
    expect(banco.linhas("cadence")).toContain(vinculadaDeOutra);
  });

  /** Uma run da vinculada, enviada `minutos` atras (null: ainda nao saiu). */
  function runDaVinculada(vinculadaId: string, minutos: number | null): void {
    const passo = banco
      .linhas("cadence_step")
      .find((linha) => linha.cadence_id === vinculadaId);
    banco.linhas("cadence_run").push({
      id: randomUUID(),
      clinic_id: CLINICA_A,
      cadence_step_id: passo!.id,
      sent_at:
        minutos === null
          ? null
          : new Date(Date.now() - minutos * 60_000).toISOString(),
    });
  }

  async function vinculadaDaHelena(
    kind: "confirmacao" | "pos_falta",
  ): Promise<Linha> {
    geral(kind);
    const helena = profissional({ name: "Dra. Helena" });
    await criarReguaDeExcecaoAction({
      kind,
      base: "medico",
      professional_id: helena.id,
    });
    return reguasCriadas()[0]!;
  }

  it.each(["confirmacao", "pos_falta"] as const)(
    "recusa excluir a vinculada de %s que enviou toque há menos de 30 minutos",
    async (kind) => {
      const vinculada = await vinculadaDaHelena(kind);
      runDaVinculada(vinculada.id as string, 45);
      runDaVinculada(vinculada.id as string, 10);

      expect(await excluirReguaAction({ cadence_id: vinculada.id })).toEqual({
        ok: false,
        error:
          "Esta régua enviou mensagens há pouco. Desligue agora e exclua daqui a 30 minutos.",
      });
      expect(reguasCriadas()).toEqual([vinculada]);
    },
  );

  it("exclui quando o último toque saiu há mais de 30 minutos, ou ainda não saiu", async () => {
    const vinculada = await vinculadaDaHelena("confirmacao");
    runDaVinculada(vinculada.id as string, 31);
    runDaVinculada(vinculada.id as string, null);

    expect(await excluirReguaAction({ cadence_id: vinculada.id })).toEqual({
      ok: true,
    });
    expect(reguasCriadas()).toEqual([]);
  });

  it("toque recente de OUTRA régua não segura a exclusão", async () => {
    const vinculada = await vinculadaDaHelena("pos_falta");
    const [daGeral] = banco
      .linhas("cadence")
      .filter((regua) => regua.id !== vinculada.id);
    runDaVinculada(daGeral!.id as string, 5);

    expect(await excluirReguaAction({ cadence_id: vinculada.id })).toEqual({
      ok: true,
    });
  });
});
