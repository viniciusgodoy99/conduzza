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
//   - salvarRequisitosDoProcedimentoAction: a lista INTEIRA numa chamada so
//     da RPC salvar_requisitos_do_procedimento (a troca de tipo entre dois
//     ativos inclusive), nenhuma escrita da action fora dela (uma falha da
//     RPC e o fim: nada gravado pela action, nem a trilha, que e da RPC), a
//     frase certa para cada SQLSTATE (CZ409 vira "cadastro_mudou"), as
//     regras da lista e o procedimento da clinica ativa antes do banco;
//   - a idade e a grade no salvarProfissionalAction e ia_pode_informar no
//     salvarProcedimentoAction.
// O comportamento do banco (CHECKs, RLS, gatilho, e a RPC: a troca sem bater
// no indice, a atomicidade, o CZ409, a trilha) esta no ensaio e em
// tests/rls/ e tests/integration/cadastro-para-o-agente.test.ts.

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const PROCEDIMENTO = "3d3d3d3d-0000-4000-8000-000000000001";
const UNIDADE = "4e4e4e4e-0000-4000-8000-000000000001";
const UNIMED = "2c2c2c2c-0000-4000-8000-000000000001";
const R1 = "5f5f5f5f-0000-4000-8000-000000000001";
const R2 = "5f5f5f5f-0000-4000-8000-000000000002";
const R3 = "5f5f5f5f-0000-4000-8000-000000000003";
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
  rpcs: [] as { nome: string; args: Linha }[],
  respostaDaRpc: { data: null, error: null } as {
    data: unknown;
    error: Erro | null;
  },
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
  rpc: async (nome: string, args: Linha) => {
    estado.eventos.push(`rpc:${nome}`);
    estado.rpcs.push({ nome, args });
    return estado.respostaDaRpc;
  },
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
  estado.rpcs = [];
  estado.respostaDaRpc = { data: null, error: null };
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
  const RPC = "rpc:salvar_requisitos_do_procedimento";
  const ESCRITAS = ["insert:", "update:", "delete:", "audit:"];
  const escritasDaAction = () =>
    estado.eventos.filter((e) => ESCRITAS.some((x) => e.startsWith(x)));

  it("leitura nao grava (a frase do papel, sem chamar a RPC)", async () => {
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

  it("a troca de tipo entre dois ativos salva: a lista inteira vai numa chamada so", async () => {
    // A carteirinha vira documento com foto e B o inverso: em escritas
    // separadas, a primeira bateria no indice unico (23505); a RPC desativa
    // antes, numa transacao so (provado no ensaio e no teste de integracao).
    const depois = [
      requisitoGravado(R1, { tipo: "documento_com_foto" }),
      requisitoGravado(R2, { tipo: "carteirinha" }),
      requisitoGravado(NOVO, {
        tipo: "chegar_antes_minutos",
        valor_inteiro: 15,
      }),
    ].map(({ clinic_id: _c, ...r }) => {
      void _c;
      return r;
    });
    estado.respostaDaRpc = {
      data: { apagados: 1, alterados: 2, criados: 1, requisitos: depois },
      error: null,
    };
    const resultado = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [
        item({ id: R1, tipo: "documento_com_foto" }),
        item({ id: R2, tipo: "carteirinha" }),
        item({ tipo: "chegar_antes_minutos", valor_inteiro: 15 }),
      ],
      ids_na_abertura: [R1, R2, R3],
    });
    expect(resultado).toEqual({ ok: true, requisitos: depois });
    expect(estado.eventos).toEqual([RPC]);
    expect(estado.rpcs).toEqual([
      {
        nome: "salvar_requisitos_do_procedimento",
        args: {
          p_procedure_id: PROCEDIMENTO,
          p_itens: [
            {
              id: R1,
              tipo: "documento_com_foto",
              insurance_id: null,
              valor_inteiro: null,
              texto_ao_paciente: null,
              ativo: true,
            },
            {
              id: R2,
              tipo: "carteirinha",
              insurance_id: null,
              valor_inteiro: null,
              texto_ao_paciente: null,
              ativo: true,
            },
            // O novo vai sem a chave id (a RPC cria).
            {
              tipo: "chegar_antes_minutos",
              insurance_id: null,
              valor_inteiro: 15,
              texto_ao_paciente: null,
              ativo: true,
            },
          ],
          // So o que estava na abertura pode ser apagado (o que outra pessoa
          // criou no meio fica: a RPC confere).
          p_ids_na_abertura: [R1, R2, R3],
        },
      },
    ]);
    expect(Object.keys((estado.rpcs[0]?.args.p_itens as Linha[])[2] ?? {}))
      .not.toContain("id");
  });

  it("falha no meio nao deixa nada gravado: o erro da RPC e o fim, sem escrita da action nem trilha", async () => {
    // O convenio de outra clinica no terceiro item: no banco, o gatilho
    // recusa (23503) depois de a RPC ja ter mudado os dois primeiros, e a
    // transacao inteira volta. Aqui: a action nao tenta mais nada.
    estado.respostaDaRpc = {
      data: null,
      error: {
        code: "23503",
        message: "O convênio informado não pertence a esta clínica.",
      },
    };
    const resultado = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [
        item({ id: R1, texto_ao_paciente: "Traga o pedido." }),
        item({ tipo: "carteirinha" }),
        item({ tipo: "autorizacao_previa", insurance_id: UNIMED }),
      ],
      ids_na_abertura: [R1, R2],
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Um convênio escolhido não é desta clínica.",
    });
    expect(estado.eventos).toEqual([RPC]);
    expect(escritasDaAction()).toEqual([]);
    expect(estado.auditoria).toEqual([]);
  });

  it.each([
    [
      "23505",
      "Já existe um item ativo deste tipo para este convênio neste procedimento. Deixe um só ativo.",
    ],
    ["23503", "Um convênio escolhido não é desta clínica."],
    [
      "23514",
      "Confira o que o paciente precisa: um item ficou fora das regras.",
    ],
    ["22023", "Confira o que o paciente precisa."],
    ["42501", "Somente administradores e gestores alteram os cadastros."],
    ["P0002", "Procedimento não encontrado."],
    ["XX000", "Não foi possível salvar o que o paciente precisa."],
  ])("o SQLSTATE %s da RPC vira a frase certa, nada gravado", async (codigo, frase) => {
    estado.respostaDaRpc = {
      data: null,
      error: { code: codigo, message: "mensagem do banco" },
    };
    const resultado = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [item()],
      ids_na_abertura: [],
    });
    expect(resultado).toEqual({ ok: false, error: frase });
    expect(escritasDaAction()).toEqual([]);
  });

  it("CZ409 (o cadastro mudou desde que o modal abriu): cadastro_mudou, nada gravado", async () => {
    estado.respostaDaRpc = {
      data: null,
      error: { code: "CZ409", message: MENSAGEM_CADASTRO_MUDOU },
    };
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
    expect(escritasDaAction()).toEqual([]);
  });

  it("sem mudanca: a RPC devolve zero e a lista; a action nao escreve nada", async () => {
    const lista = [requisitoGravado(R1)].map(({ clinic_id: _c, ...r }) => {
      void _c;
      return r;
    });
    estado.respostaDaRpc = {
      data: { apagados: 0, alterados: 0, criados: 0, requisitos: lista },
      error: null,
    };
    const resultado = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [item({ id: R1 })],
      ids_na_abertura: [R1],
    });
    expect(resultado).toEqual({ ok: true, requisitos: lista });
    expect(estado.eventos).toEqual([RPC]);
  });

  it("resposta fora do formato: gravou, sem a lista (a tela recarrega o catalogo)", async () => {
    estado.respostaDaRpc = { data: { inesperado: true }, error: null };
    const resultado = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [item()],
      ids_na_abertura: [],
    });
    expect(resultado).toEqual({ ok: true, requisitos: null });
  });

  it("procedimento de outra clinica (ou que nao existe): nao encontrado, sem chamar a RPC", async () => {
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

  it("as regras da lista antes do banco (sem chamar a RPC)", async () => {
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
    // A troca entre dois ativos NAO e duplicado: a lista final tem um de
    // cada.
    estado.respostaDaRpc = {
      data: { apagados: 0, alterados: 2, criados: 0, requisitos: [] },
      error: null,
    };
    const troca = await salvarRequisitosDoProcedimentoAction({
      procedure_id: PROCEDIMENTO,
      requisitos: [
        item({ id: R1, tipo: "carteirinha", insurance_id: UNIMED }),
        item({ id: R2, tipo: "carteirinha", insurance_id: null }),
      ],
      ids_na_abertura: [R1, R2],
    });
    expect(troca.ok).toBe(true);
    expect(estado.eventos).toEqual([RPC]);
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
