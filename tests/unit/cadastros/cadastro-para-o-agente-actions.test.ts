import { beforeEach, describe, expect, it, vi } from "vitest";

import { MENSAGEM_CADASTRO_MUDOU } from "@/lib/domain/convenios-do-medico";

// Cadastro para o agente (AG1, migration 20261027100000) nas Server Actions
// de Cadastros, contra um cliente do Supabase dublado. O que interessa aqui:
//   - quem grava (administrador e gestor; leitura, recepcao e profissional
//     recebem a frase do papel antes de qualquer leitura);
//   - salvarUnidadeAction: o endereco de texto composto dos campos (sem o
//     CEP), o texto antigo mantido sem os campos, as colunas novas AUSENTES
//     quando o cliente antigo nao as manda, e os textos ao paciente
//     recusados pelas regras ANTES do banco;
//   - salvarRequisitosDoProcedimentoAction: a ORDEM (apagar so o que estava
//     na abertura, desativar antes de ativar, criar por ultimo), o
//     "cadastro mudou" sem gravar nada, as regras da lista antes do banco e
//     a traducao dos erros;
//   - a idade e a grade no salvarProfissionalAction e ia_pode_informar no
//     salvarProcedimentoAction.
// O comportamento do banco (CHECKs, RLS, gatilho) esta no ensaio e em
// tests/rls/cadastro-para-o-agente.test.ts.

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const PROCEDIMENTO = "3d3d3d3d-0000-4000-8000-000000000001";
const UNIDADE = "4e4e4e4e-0000-4000-8000-000000000001";
const UNIMED = "2c2c2c2c-0000-4000-8000-000000000001";
const R1 = "5f5f5f5f-0000-4000-8000-000000000001";
const R2 = "5f5f5f5f-0000-4000-8000-000000000002";
const R3 = "5f5f5f5f-0000-4000-8000-000000000003";
const OUTRA_PESSOA = "5f5f5f5f-0000-4000-8000-0000000000ff";
const NOVO = "6a6a6a6a-0000-4000-8000-000000000001";

type Linha = Record<string, unknown>;
type Erro = { code: string; message: string };

const estado = {
  eventos: [] as string[],
  tabelas: {} as Record<string, Linha[]>,
  updates: [] as { tabela: string; valores: Linha; filtros: Linha }[],
  inserts: [] as { tabela: string; valores: unknown }[],
  deletes: [] as { tabela: string; filtros: Linha; ids: unknown[] }[],
  erroNoUpdate: {} as Record<string, Erro>,
  erroNoInsert: {} as Record<string, Erro>,
  auditoria: [] as Linha[],
};

function consulta(tabela: string) {
  let operacao: "select" | "update" | "insert" | "delete" = "select";
  let valores: unknown = {};
  const filtros: [string, unknown][] = [];
  let ids: unknown[] = [];
  const doFiltro = () =>
    (estado.tabelas[tabela] ?? []).filter(
      (linha) =>
        filtros.every(([coluna, valor]) => linha[coluna] === valor) &&
        (ids.length === 0 || ids.includes(linha.id)),
    );
  const resolver = (): { data: Linha[] | null; error: Erro | null } => {
    if (operacao === "update") {
      estado.eventos.push(`update:${tabela}`);
      estado.updates.push({
        tabela,
        valores: valores as Linha,
        filtros: Object.fromEntries(filtros),
      });
      const erro = estado.erroNoUpdate[tabela];
      if (erro) {
        return { data: null, error: erro };
      }
      return { data: doFiltro().map((l) => ({ id: l.id })), error: null };
    }
    if (operacao === "insert") {
      if (tabela === "audit_log") {
        estado.auditoria.push(valores as Linha);
        estado.eventos.push(`audit:${String((valores as Linha).action)}`);
        return { data: null, error: null };
      }
      estado.eventos.push(`insert:${tabela}`);
      estado.inserts.push({ tabela, valores });
      const erro = estado.erroNoInsert[tabela];
      if (erro) {
        return { data: null, error: erro };
      }
      return { data: [{ id: NOVO }], error: null };
    }
    if (operacao === "delete") {
      estado.eventos.push(`delete:${tabela}`);
      estado.deletes.push({
        tabela,
        filtros: Object.fromEntries(filtros),
        ids,
      });
      return { data: null, error: null };
    }
    return { data: doFiltro(), error: null };
  };
  const api = {
    select: () => api,
    update: (linha: Linha) => {
      operacao = "update";
      valores = linha;
      return api;
    },
    insert: (linha: unknown) => {
      operacao = "insert";
      valores = linha;
      return api;
    },
    delete: () => {
      operacao = "delete";
      return api;
    },
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor]);
      return api;
    },
    in: (_coluna: string, lista: unknown[]) => {
      ids = lista;
      return api;
    },
    neq: () => api,
    not: () => api,
    gt: () => api,
    lt: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: async () => {
      const r = resolver();
      return { data: r.data?.[0] ?? null, error: r.error };
    },
    single: async () => {
      const r = resolver();
      return { data: r.data?.[0] ?? null, error: r.error };
    },
    then: <T>(
      resolverPromessa: (valor: ReturnType<typeof resolver>) => T,
      rejeitar?: (motivo: unknown) => T,
    ) => Promise.resolve(resolver()).then(resolverPromessa, rejeitar),
  };
  return api;
}

const cliente = {
  rpc: async () => ({ data: null, error: null }),
  from: (tabela: string) => consulta(tabela),
};

const sessao = {
  userId: "usuario-da-sessao",
  active: {
    clinicId: CLINICA,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "admin" as string,
    status: "ativo",
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cliente,
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const {
  salvarProcedimentoAction,
  salvarProfissionalAction,
  salvarRequisitosDoProcedimentoAction,
  salvarUnidadeAction,
} = await import("@/app/(app)/cadastros/actions");

function requisitoGravado(id: string, parcial: Linha = {}): Linha {
  return {
    id,
    clinic_id: CLINICA,
    procedure_id: PROCEDIMENTO,
    insurance_id: null,
    tipo: "pedido_medico",
    valor_inteiro: null,
    texto_ao_paciente: null,
    ativo: true,
    ...parcial,
  };
}

beforeEach(() => {
  estado.eventos = [];
  estado.tabelas = {
    unit: [{ id: UNIDADE, clinic_id: CLINICA }],
    procedure: [{ id: PROCEDIMENTO, clinic_id: CLINICA }],
    professional: [{ id: NOVO, clinic_id: CLINICA, active: true }],
    procedure_requirement: [],
  };
  estado.updates = [];
  estado.inserts = [];
  estado.deletes = [];
  estado.erroNoUpdate = {};
  estado.erroNoInsert = {};
  estado.auditoria = [];
  sessao.active.role = "admin";
});

const UNIDADE_NA_TELA = {
  id: UNIDADE,
  name: "Sede",
  phone: null,
  active: true,
  address: null,
  logradouro: "Rua das Flores",
  numero: "123",
  complemento: null,
  bairro: "Centro",
  cidade: "Fortaleza",
  uf: "CE",
  cep: "60000000",
  referencia: "Em frente à praça.",
  estacionamento: null,
  acessibilidade: null,
  link_do_mapa: "https://maps.app.goo.gl/abc",
  horario_de_funcionamento: { "1": [{ inicio: "08:00", fim: "12:00" }] },
  observacao_ao_paciente: null,
};

describe("salvarUnidadeAction", () => {
  it.each(["leitura", "recepcao", "profissional"])(
    "%s nao grava (a frase do papel, sem tocar no banco)",
    async (papel) => {
      sessao.active.role = papel;
      const resultado = await salvarUnidadeAction(UNIDADE_NA_TELA);
      expect(resultado).toEqual({
        ok: false,
        error: "Somente administradores e gestores alteram os cadastros.",
      });
      expect(estado.eventos).toEqual([]);
    },
  );

  it("compoe o endereco de texto dos campos, sem o CEP, e grava as colunas novas", async () => {
    sessao.active.role = "gestor";
    const resultado = await salvarUnidadeAction(UNIDADE_NA_TELA);
    expect(resultado).toEqual({ ok: true, id: UNIDADE });
    expect(estado.updates).toHaveLength(1);
    const valores = estado.updates[0]?.valores ?? {};
    expect(valores.address).toBe("Rua das Flores, 123, Centro, Fortaleza/CE");
    expect(valores.cep).toBe("60000000");
    expect(valores.horario_de_funcionamento).toEqual({
      "1": [{ inicio: "08:00", fim: "12:00" }],
    });
    expect(estado.updates[0]?.filtros).toEqual({
      clinic_id: CLINICA,
      id: UNIDADE,
    });
    expect(estado.eventos).toEqual(["update:unit", "audit:editou"]);
  });

  it("sem nenhum campo do endereco, fica o texto que veio (o endereco antigo)", async () => {
    await salvarUnidadeAction({
      ...UNIDADE_NA_TELA,
      address: "Rua Antiga, 10",
      logradouro: null,
      numero: null,
      bairro: null,
      cidade: null,
      uf: null,
    });
    expect(estado.updates[0]?.valores.address).toBe("Rua Antiga, 10");
  });

  it("o cliente antigo (sem as colunas novas) nao apaga nada", async () => {
    await salvarUnidadeAction({
      id: UNIDADE,
      name: "Sede",
      address: "Rua Antiga, 10",
      phone: null,
      active: true,
    });
    const valores = estado.updates[0]?.valores ?? {};
    expect(Object.keys(valores).sort()).toEqual(
      ["active", "address", "name", "phone"].sort(),
    );
  });

  it("texto ao paciente fora das regras e recusado antes do banco, com o campo", async () => {
    const resultado = await salvarUnidadeAction({
      ...UNIDADE_NA_TELA,
      estacionamento: "Reserve pelo 85 3333-4444",
    });
    expect(resultado.ok).toBe(false);
    expect(resultado.error).toMatch(/^Estacionamento: Tire o telefone/);
    expect(estado.eventos).toEqual([]);
  });

  it("o link, a UF e o horario fora da regra tem a frase do campo", async () => {
    expect(
      (
        await salvarUnidadeAction({
          ...UNIDADE_NA_TELA,
          link_do_mapa: "http://g.co",
        })
      ).error,
    ).toBe("Link do mapa: cole o endereço completo, começando com https://.");
    expect(
      (await salvarUnidadeAction({ ...UNIDADE_NA_TELA, uf: "XX" })).error,
    ).toBe("Escolha a UF da lista.");
    expect(
      (
        await salvarUnidadeAction({
          ...UNIDADE_NA_TELA,
          horario_de_funcionamento: {
            "1": [{ inicio: "12:00", fim: "08:00" }],
          },
        })
      ).error,
    ).toBe("Confira o horário de funcionamento.");
    expect(estado.eventos).toEqual([]);
  });

  it("cria a unidade nova com a clinica ativa", async () => {
    const { id: _id, ...nova } = UNIDADE_NA_TELA;
    void _id;
    const resultado = await salvarUnidadeAction(nova);
    expect(resultado).toEqual({ ok: true, id: NOVO });
    expect(estado.inserts[0]?.valores).toMatchObject({
      clinic_id: CLINICA,
      address: "Rua das Flores, 123, Centro, Fortaleza/CE",
    });
  });
});

describe("salvarRequisitosDoProcedimentoAction", () => {
  const item = (parcial: Linha = {}) => ({
    tipo: "pedido_medico",
    insurance_id: null,
    valor_inteiro: null,
    texto_ao_paciente: null,
    ativo: true,
    ...parcial,
  });

  it("leitura nao grava", async () => {
    sessao.active.role = "leitura";
    const resultado = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [item()],
      ids_na_abertura: [],
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Somente administradores e gestores alteram os cadastros.",
    });
    expect(estado.eventos).toEqual([]);
  });

  it("apaga so o que estava na abertura, desativa antes de ativar e cria por ultimo", async () => {
    estado.tabelas.procedure_requirement = [
      requisitoGravado(R1),
      requisitoGravado(R2, {
        tipo: "carteirinha",
        insurance_id: UNIMED,
        ativo: false,
      }),
      requisitoGravado(R3, { tipo: "acompanhante" }),
      // Criado por outra pessoa depois que o modal abriu: fica.
      requisitoGravado(OUTRA_PESSOA, { tipo: "exames_anteriores" }),
    ];
    const resultado = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [
        // R2 passa a ativo; R1 passa a inativo (o mesmo tipo do novo).
        item({
          id: R2,
          tipo: "carteirinha",
          insurance_id: UNIMED,
          ativo: true,
        }),
        item({ id: R1, ativo: false }),
        item({ tipo: "pedido_medico", texto_ao_paciente: "Traga o pedido." }),
      ],
      ids_na_abertura: [R1, R2, R3],
    });
    expect(resultado.ok).toBe(true);
    expect(estado.eventos).toEqual([
      "delete:procedure_requirement",
      "update:procedure_requirement",
      "update:procedure_requirement",
      "insert:procedure_requirement",
      "audit:editou_requisitos_do_procedimento",
    ]);
    expect(estado.deletes[0]?.ids).toEqual([R3]);
    expect(estado.deletes[0]?.filtros).toEqual({
      clinic_id: CLINICA,
      procedure_id: PROCEDIMENTO,
    });
    // O que fica inativo vai primeiro.
    expect(estado.updates.map((u) => u.filtros.id)).toEqual([R1, R2]);
    expect(estado.updates[0]?.valores.ativo).toBe(false);
    expect(estado.inserts[0]?.valores).toEqual([
      {
        clinic_id: CLINICA,
        procedure_id: PROCEDIMENTO,
        tipo: "pedido_medico",
        insurance_id: null,
        valor_inteiro: null,
        texto_ao_paciente: "Traga o pedido.",
        ativo: true,
      },
    ]);
    expect(estado.auditoria[0]).toMatchObject({
      action: "editou_requisitos_do_procedimento",
      entity: "procedure",
      entity_id: PROCEDIMENTO,
    });
  });

  it("sem mudanca, nada e gravado nem vai para a trilha", async () => {
    estado.tabelas.procedure_requirement = [requisitoGravado(R1)];
    const resultado = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [item({ id: R1 })],
      ids_na_abertura: [R1],
    });
    expect(resultado.ok).toBe(true);
    expect(estado.eventos).toEqual([]);
  });

  it("item que sumiu do banco no meio: cadastro mudou, nada gravado", async () => {
    estado.tabelas.procedure_requirement = [];
    const resultado = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [item({ id: R1 })],
      ids_na_abertura: [R1],
    });
    expect(resultado).toEqual({
      ok: false,
      code: "cadastro_mudou",
      error: MENSAGEM_CADASTRO_MUDOU,
    });
    expect(estado.eventos).toEqual([]);
  });

  it("procedimento de outra clinica (ou que nao existe): nao encontrado", async () => {
    estado.tabelas.procedure = [];
    const resultado = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [item()],
      ids_na_abertura: [],
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Procedimento não encontrado.",
    });
    expect(estado.eventos).toEqual([]);
  });

  it("as regras da lista antes do banco", async () => {
    const duplicado = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [item(), item()],
      ids_na_abertura: [],
    });
    expect(duplicado.ok).toBe(false);
    expect(!duplicado.ok && duplicado.error).toMatch(/aparece duas vezes/);
    const semMinutos = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [item({ tipo: "chegar_antes_minutos" })],
      ids_na_abertura: [],
    });
    expect(!semMinutos.ok && semMinutos.error).toBe(
      "Chegar antes do horário: use um número inteiro de 1 a 480 minutos.",
    );
    const comLink = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [
        item({ tipo: "outro", texto_ao_paciente: "Veja https://x.com" }),
      ],
      ids_na_abertura: [],
    });
    expect(!comLink.ok && comLink.error).toMatch(/^Outro: Tire o link/);
    expect(estado.eventos).toEqual([]);
  });

  it("o erro do banco vira frase de recepcionista", async () => {
    estado.erroNoInsert.procedure_requirement = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
    };
    const resultado = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [item()],
      ids_na_abertura: [],
    });
    expect(resultado).toEqual({
      ok: false,
      error:
        "Já existe um item ativo deste tipo para este convênio neste procedimento. Deixe um só ativo.",
    });
    estado.erroNoInsert.procedure_requirement = {
      code: "23503",
      message: "O convênio informado não pertence a esta clínica.",
    };
    const deOutra = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [item({ insurance_id: UNIMED })],
      ids_na_abertura: [],
    });
    expect(!deOutra.ok && deOutra.error).toBe(
      "Um convênio escolhido não é desta clínica.",
    );
  });
});

describe("salvarProfissionalAction e salvarProcedimentoAction (AG1)", () => {
  const PROFISSIONAL = {
    id: NOVO,
    name: "Dra. Ana Lima",
    council_type: "CRM",
    council_number: "1234",
    specialties: [],
    calendar_color: null,
    active: true,
  };

  it("grava a idade e a grade quando vem; ausente nao mexe", async () => {
    await salvarProfissionalAction({
      ...PROFISSIONAL,
      idade_minima: 18,
      idade_maxima: 65,
      grade_minutos: 30,
    });
    expect(estado.updates[0]?.valores).toMatchObject({
      idade_minima: 18,
      idade_maxima: 65,
      grade_minutos: 30,
    });
    estado.updates = [];
    await salvarProfissionalAction(PROFISSIONAL);
    expect("idade_minima" in (estado.updates[0]?.valores ?? {})).toBe(false);
    expect("grade_minutos" in (estado.updates[0]?.valores ?? {})).toBe(false);
  });

  it("recusa a idade minima acima da maxima e a grade fora da lista", async () => {
    const invertida = await salvarProfissionalAction({
      ...PROFISSIONAL,
      idade_minima: 30,
      idade_maxima: 20,
    });
    expect(invertida.ok).toBe(false);
    const grade = await salvarProfissionalAction({
      ...PROFISSIONAL,
      grade_minutos: 25,
    });
    expect(grade.ok).toBe(false);
    expect(estado.updates).toEqual([]);
  });

  it("ia_pode_informar vai com o procedimento quando vem", async () => {
    await salvarProcedimentoAction({
      id: PROCEDIMENTO,
      name: "Consulta",
      description: null,
      default_duration_min: 30,
      base_price_cents: 20000,
      requires_evaluation: false,
      prep_instructions: null,
      bookable_by_ai: false,
      ia_pode_informar: true,
      active: true,
    });
    expect(estado.updates[0]?.tabela).toBe("procedure");
    expect(estado.updates[0]?.valores.ia_pode_informar).toBe(true);
  });
});
