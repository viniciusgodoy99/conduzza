import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MENSAGEM_CADASTRO_MUDOU,
  MENSAGEM_CONVENIO_INATIVO,
} from "@/lib/domain/convenios-do-medico";

// Convenio pelo medico (decisao do dono em 02/10/2026) nas Server Actions de
// Cadastros, contra um cliente do Supabase dublado. O que interessa aqui e a
// ORDEM e o QUE a action manda para as RPCs:
//   - salvarProfissionalAction com insurance_ids (RPC
//     sincronizar_convenios_do_profissional antes do UPDATE da linha ao
//     editar; insert e depois a RPC confirmada ao criar);
//   - sincronizarVinculosDoProcedimentoAction com e sem `extras` (modo novo
//     e modo legado da RPC sincronizar_vinculos_do_procedimento);
//   - o UPDATE de alinhamento de "IA pode agendar" em salvarProcedimento
//     Action, que passou a conferir erro.
// E como a resposta do banco vira mensagem de recepcionista. O comportamento
// do banco esta em tests/integration/convenio-pelo-medico-rpc.test.ts; a
// action contra o banco real, em tests/integration/convenio-pelo-medico
// .test.ts.

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const JOAO = "1b1b1b1b-0000-4000-8000-000000000001";
const ANA = "1b1b1b1b-0000-4000-8000-000000000002";
const NOVO = "1b1b1b1b-0000-4000-8000-0000000000ff";
const UNIMED = "2c2c2c2c-0000-4000-8000-000000000001";
const BRADESCO = "2c2c2c2c-0000-4000-8000-000000000002";
const ENDO = "3d3d3d3d-0000-4000-8000-000000000001";
const NUTRO = "3d3d3d3d-0000-4000-8000-000000000002";
const PRIMEIRA = "2026-10-06T18:00:00+00:00";

const RPC_MEDICO = "sincronizar_convenios_do_profissional";
const RPC_PROCEDIMENTO = "sincronizar_vinculos_do_procedimento";

type Linha = Record<string, unknown>;
type Erro = { code: string; message: string };
type Resposta = { data: unknown; error: Erro | null };

const estado = {
  /** A ordem do que a action fez: rpc, insert, update e trilha */
  eventos: [] as string[],
  rpcs: [] as { fn: string; args: Linha }[],
  respostas: {} as Record<string, Resposta>,
  tabelas: {} as Record<string, Linha[]>,
  /** UPDATE que volta erro */
  erroNoUpdate: {} as Record<string, Erro>,
  /** UPDATE que nao acha a linha (RLS ou linha sumida) */
  updateSemLinha: {} as Record<string, boolean>,
  erroNoInsert: {} as Record<string, Erro>,
  updates: [] as { tabela: string; valores: Linha; filtros: Linha }[],
  auditoria: [] as Linha[],
};

function consulta(tabela: string) {
  let operacao: "select" | "update" | "insert" = "select";
  let valores: Linha = {};
  let contar = false;
  let limite: number | null = null;
  const filtros: [string, unknown][] = [];
  const doFiltro = () =>
    (estado.tabelas[tabela] ?? []).filter((linha) =>
      filtros.every(([coluna, valor]) => linha[coluna] === valor),
    );
  const resolver = (): {
    data: Linha[] | null;
    count?: number | null;
    error: Erro | null;
  } => {
    if (operacao === "update") {
      estado.eventos.push(`update:${tabela}`);
      estado.updates.push({
        tabela,
        valores,
        filtros: Object.fromEntries(filtros),
      });
      const erro = estado.erroNoUpdate[tabela];
      if (erro) {
        return { data: null, error: erro };
      }
      if (estado.updateSemLinha[tabela]) {
        return { data: [], error: null };
      }
      return { data: doFiltro().map((l) => ({ id: l.id })), error: null };
    }
    if (operacao === "insert") {
      if (tabela === "audit_log") {
        estado.auditoria.push(valores);
        estado.eventos.push(`audit:${String(valores.action)}`);
        return { data: null, error: null };
      }
      estado.eventos.push(`insert:${tabela}`);
      const erro = estado.erroNoInsert[tabela];
      if (erro) {
        return { data: null, error: erro };
      }
      return { data: [{ id: NOVO }], error: null };
    }
    const linhas = doFiltro();
    return {
      data: limite === null ? linhas : linhas.slice(0, limite),
      count: contar ? linhas.length : null,
      error: null,
    };
  };
  const api = {
    select: (_colunas?: string, opcoes?: { count?: string }) => {
      if (opcoes?.count) {
        contar = true;
      }
      return api;
    },
    update: (linha: Linha) => {
      operacao = "update";
      valores = linha;
      return api;
    },
    insert: (linha: Linha) => {
      operacao = "insert";
      valores = linha;
      return api;
    },
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor]);
      return api;
    },
    neq: () => api,
    in: () => api,
    not: () => api,
    gt: () => api,
    lt: () => api,
    order: () => api,
    limit: (n: number) => {
      limite = n;
      return api;
    },
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
  rpc: async (fn: string, args: Linha) => {
    estado.eventos.push(`rpc:${fn}`);
    estado.rpcs.push({ fn, args });
    return estado.respostas[fn] ?? { data: null, error: null };
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
  salvarProfissionalAction,
  salvarProcedimentoAction,
  sincronizarVinculosDoProcedimentoAction,
} = await import("@/app/(app)/cadastros/actions");

const JOAO_NA_TELA = {
  name: "Dr. João Pereira",
  council_type: "CRM",
  council_number: "1234",
  specialties: ["Endocrinologia"],
  calendar_color: null,
  active: true,
};

function retornoDoMedico(parcial: Linha = {}): Linha {
  return {
    aplicado: true,
    entram: [],
    saem: [],
    deixa_de_fazer: [],
    consultas_futuras: 0,
    primeira_consulta: null,
    vinculos_criados: 0,
    vinculos_reativados: 0,
    vinculos_desativados: 0,
    ...parcial,
  };
}

const SEM_MUDANCA = {
  entram: [],
  saem: [],
  deixaDeFazer: [],
  consultasFuturas: 0,
  primeiraConsulta: null,
};

beforeEach(() => {
  estado.eventos = [];
  estado.rpcs = [];
  estado.respostas = {};
  estado.tabelas = {
    professional: [{ id: JOAO, clinic_id: CLINICA, active: true }],
    procedure: [{ id: ENDO, clinic_id: CLINICA }],
    appointment: [],
  };
  estado.erroNoUpdate = {};
  estado.updateSemLinha = {};
  estado.erroNoInsert = {};
  estado.updates = [];
  estado.auditoria = [];
  sessao.active.role = "admin";
});

describe("salvarProfissionalAction ao editar: Convênios que atende", () => {
  it("sem insurance_ids não mexe nos convênios: nem chama a RPC", async () => {
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      id: JOAO,
    });
    expect(resultado).toEqual({ ok: true, id: JOAO });
    expect(estado.rpcs).toEqual([]);
    expect(estado.eventos).toEqual(["update:professional", "audit:editou"]);
  });

  it("com insurance_ids: a RPC vem ANTES da linha, com os pares crus da abertura e sem confirmar", async () => {
    estado.respostas[RPC_MEDICO] = {
      data: retornoDoMedico({
        entram: [{ insurance_id: BRADESCO, procedure_ids: [ENDO] }],
        vinculos_criados: 1,
      }),
      error: null,
    };
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      id: JOAO,
      insurance_ids: [UNIMED, BRADESCO],
      insurance_ids_na_abertura: [UNIMED],
    });

    expect(estado.rpcs).toEqual([
      {
        fn: RPC_MEDICO,
        args: {
          p_professional_id: JOAO,
          p_convenios: [UNIMED, BRADESCO],
          p_convenios_na_abertura: [UNIMED],
          p_confirmar: false,
        },
      },
    ]);
    expect(estado.eventos).toEqual([
      `rpc:${RPC_MEDICO}`,
      "audit:editou_convenios_do_profissional",
      "update:professional",
      "audit:editou",
    ]);
    // A linha nao leva os campos novos (insurance_ids nao e coluna).
    expect(estado.updates[0]?.valores).toEqual(JOAO_NA_TELA);
    expect(resultado).toEqual({
      ok: true,
      id: JOAO,
      convenios: {
        ...SEM_MUDANCA,
        entram: [{ insuranceId: BRADESCO, procedureIds: [ENDO] }],
      },
    });
    expect(estado.auditoria).toMatchObject([
      {
        clinic_id: CLINICA,
        action: "editou_convenios_do_profissional",
        entity: "professional",
        entity_id: JOAO,
      },
      { action: "editou", entity: "professional", entity_id: JOAO },
    ]);
  });

  it("lista vazia é a lista inteira (tira todos), não 'não mexe'", async () => {
    estado.respostas[RPC_MEDICO] = {
      data: retornoDoMedico({
        saem: [{ insurance_id: UNIMED, procedure_ids: [] }],
      }),
      error: null,
    };
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      id: JOAO,
      insurance_ids: [],
      insurance_ids_na_abertura: [UNIMED],
    });
    expect(estado.rpcs[0]?.args).toMatchObject({ p_convenios: [] });
    expect(resultado.ok).toBe(true);
    expect(resultado.convenios?.saem).toEqual([
      { insuranceId: UNIMED, procedureIds: [] },
    ]);
  });

  it("sem a abertura, a RPC vai sem conferência (null)", async () => {
    estado.respostas[RPC_MEDICO] = { data: retornoDoMedico(), error: null };
    await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      id: JOAO,
      insurance_ids: [UNIMED],
    });
    expect(estado.rpcs[0]?.args.p_convenios_na_abertura).toBeNull();
  });

  it("consulta futura no convênio que sai: NADA gravado, volta o aviso com motivo convenios (D4)", async () => {
    estado.respostas[RPC_MEDICO] = {
      data: retornoDoMedico({
        aplicado: false,
        saem: [{ insurance_id: UNIMED, procedure_ids: [ENDO] }],
        consultas_futuras: 2,
        primeira_consulta: PRIMEIRA,
      }),
      error: null,
    };
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      name: "Dr. João Pereira Filho",
      id: JOAO,
      insurance_ids: [],
      insurance_ids_na_abertura: [UNIMED],
    });
    expect(resultado).toEqual({
      ok: false,
      code: "consultas_no_periodo",
      motivo: "convenios",
      consultas: 2,
      primeiraConsulta: PRIMEIRA,
      convenios: {
        ...SEM_MUDANCA,
        saem: [{ insuranceId: UNIMED, procedureIds: [ENDO] }],
        consultasFuturas: 2,
        primeiraConsulta: PRIMEIRA,
      },
    });
    // Nem a linha (o nome novo) nem a trilha: nada antes da confirmacao.
    expect(estado.eventos).toEqual([`rpc:${RPC_MEDICO}`]);
    expect(estado.auditoria).toEqual([]);
  });

  it("deixa de fazer um procedimento, sem consulta, também pede confirmação (D3)", async () => {
    estado.respostas[RPC_MEDICO] = {
      data: retornoDoMedico({
        aplicado: false,
        saem: [{ insurance_id: UNIMED, procedure_ids: [NUTRO] }],
        deixa_de_fazer: [NUTRO],
      }),
      error: null,
    };
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      id: JOAO,
      insurance_ids: [],
      insurance_ids_na_abertura: [UNIMED],
    });
    expect(resultado).toMatchObject({
      ok: false,
      code: "consultas_no_periodo",
      motivo: "convenios",
      consultas: 0,
      convenios: { deixaDeFazer: [NUTRO] },
    });
    expect(estado.updates).toEqual([]);
  });

  it("com confirmar_convenios a RPC grava (p_confirmar) e a linha também", async () => {
    estado.respostas[RPC_MEDICO] = {
      data: retornoDoMedico({
        saem: [{ insurance_id: UNIMED, procedure_ids: [ENDO] }],
        consultas_futuras: 2,
        primeira_consulta: PRIMEIRA,
        vinculos_desativados: 1,
      }),
      error: null,
    };
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      id: JOAO,
      insurance_ids: [],
      insurance_ids_na_abertura: [UNIMED],
      confirmar_convenios: true,
    });
    expect(estado.rpcs[0]?.args.p_confirmar).toBe(true);
    expect(resultado).toMatchObject({
      ok: true,
      id: JOAO,
      convenios: { consultasFuturas: 2, primeiraConsulta: PRIMEIRA },
    });
    expect(estado.eventos).toContain("update:professional");
  });

  it("a desativação confere primeiro: com consulta futura, nem chega à RPC (motivo desativar)", async () => {
    estado.tabelas.appointment = [{ clinic_id: CLINICA, starts_at: PRIMEIRA }];
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      active: false,
      id: JOAO,
      insurance_ids: [],
      insurance_ids_na_abertura: [UNIMED],
    });
    expect(resultado).toEqual({
      ok: false,
      code: "consultas_no_periodo",
      motivo: "desativar",
      consultas: 1,
      primeiraConsulta: PRIMEIRA,
    });
    expect(estado.rpcs).toEqual([]);
    expect(estado.updates).toEqual([]);
  });

  it("desativação confirmada segue para a RPC dos convênios, que ainda pode pedir a confirmação dela", async () => {
    estado.tabelas.appointment = [{ clinic_id: CLINICA, starts_at: PRIMEIRA }];
    estado.respostas[RPC_MEDICO] = {
      data: retornoDoMedico({ aplicado: false, consultas_futuras: 1 }),
      error: null,
    };
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      active: false,
      id: JOAO,
      confirmar_consultas: true,
      insurance_ids: [],
      insurance_ids_na_abertura: [UNIMED],
    });
    expect(resultado).toMatchObject({
      code: "consultas_no_periodo",
      motivo: "convenios",
    });
    expect(estado.updates).toEqual([]);
  });

  it("aba parada (CZ409): code cadastro_mudou com a frase do D5, e nada gravado", async () => {
    estado.respostas[RPC_MEDICO] = {
      data: null,
      error: { code: "CZ409", message: MENSAGEM_CADASTRO_MUDOU },
    };
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      id: JOAO,
      insurance_ids: [UNIMED],
      insurance_ids_na_abertura: [],
    });
    expect(resultado).toEqual({
      ok: false,
      code: "cadastro_mudou",
      error:
        "O cadastro mudou enquanto você editava. Feche, abra de novo e salve.",
    });
    expect(estado.updates).toEqual([]);
    expect(estado.auditoria).toEqual([]);
  });

  it("os erros do banco viram a frase da recepção, nunca a mensagem crua", async () => {
    const casos: [string, string][] = [
      ["22023", MENSAGEM_CONVENIO_INATIVO],
      ["23503", "Um convênio escolhido não é desta clínica."],
      ["42501", "Somente administradores e gestores alteram os cadastros."],
      ["P0002", "Profissional não encontrado."],
      ["XX000", "Não foi possível salvar os convênios do profissional."],
    ];
    for (const [code, esperado] of casos) {
      estado.respostas[RPC_MEDICO] = {
        data: null,
        error: { code, message: `internal ${code} relation "x"` },
      };
      const resultado = await salvarProfissionalAction({
        ...JOAO_NA_TELA,
        id: JOAO,
        insurance_ids: [UNIMED],
        insurance_ids_na_abertura: [],
      });
      expect(resultado, code).toEqual({ ok: false, error: esperado });
    }
    expect(estado.updates).toEqual([]);
  });

  it("retorno da RPC fora do formato: erro, e a linha não é gravada", async () => {
    estado.respostas[RPC_MEDICO] = { data: { ok: 1 }, error: null };
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      id: JOAO,
      insurance_ids: [UNIMED],
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Não foi possível salvar os convênios do profissional.",
    });
    expect(estado.updates).toEqual([]);
  });

  it("a linha falha depois da RPC: parcial, com o id, o resumo e a trilha dos convênios", async () => {
    estado.respostas[RPC_MEDICO] = {
      data: retornoDoMedico({
        entram: [{ insurance_id: BRADESCO, procedure_ids: [ENDO] }],
      }),
      error: null,
    };
    estado.updateSemLinha.professional = true;
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      id: JOAO,
      insurance_ids: [UNIMED, BRADESCO],
      insurance_ids_na_abertura: [UNIMED],
    });
    expect(resultado).toEqual({
      ok: false,
      parcial: true,
      id: JOAO,
      error:
        "Os convênios foram salvos, mas os dados do profissional não. Clique em Salvar de novo.",
      convenios: {
        ...SEM_MUDANCA,
        entram: [{ insuranceId: BRADESCO, procedureIds: [ENDO] }],
      },
    });
    expect(estado.auditoria.map((a) => a.action)).toEqual([
      "editou_convenios_do_profissional",
    ]);
  });

  it("só a abertura, sem a lista nova, não faz nada nos convênios", async () => {
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      id: JOAO,
      insurance_ids_na_abertura: [UNIMED],
    });
    expect(resultado).toEqual({ ok: true, id: JOAO });
    expect(estado.rpcs).toEqual([]);
  });
});

describe("salvarProfissionalAction e a clínica ativa", () => {
  it("profissional de outra clínica (quem é membro das duas) não chega à RPC", async () => {
    estado.tabelas.professional = [
      {
        id: JOAO,
        clinic_id: "0a0a0a0a-0000-4000-8000-00000000000b",
        active: true,
      },
    ];
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      id: JOAO,
      insurance_ids: [UNIMED],
      insurance_ids_na_abertura: [],
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Profissional não encontrado.",
    });
    expect(estado.rpcs).toEqual([]);
    expect(estado.eventos).toEqual([]);
  });
});

describe("salvarProfissionalAction ao criar", () => {
  it("insert, trilha, depois a RPC confirmada e sem abertura (ele não faz procedimento nenhum)", async () => {
    estado.respostas[RPC_MEDICO] = {
      data: retornoDoMedico({
        entram: [
          { insurance_id: UNIMED, procedure_ids: [] },
          { insurance_id: BRADESCO, procedure_ids: [] },
        ],
      }),
      error: null,
    };
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      insurance_ids: [UNIMED, BRADESCO],
      insurance_ids_na_abertura: [],
    });
    expect(estado.eventos).toEqual([
      "insert:professional",
      "audit:criou",
      `rpc:${RPC_MEDICO}`,
      "audit:editou_convenios_do_profissional",
    ]);
    expect(estado.rpcs[0]?.args).toEqual({
      p_professional_id: NOVO,
      p_convenios: [UNIMED, BRADESCO],
      p_convenios_na_abertura: null,
      p_confirmar: true,
    });
    expect(resultado).toEqual({
      ok: true,
      id: NOVO,
      convenios: {
        ...SEM_MUDANCA,
        entram: [
          { insuranceId: UNIMED, procedureIds: [] },
          { insuranceId: BRADESCO, procedureIds: [] },
        ],
      },
    });
  });

  it("a RPC falha: parcial com o id (a tela guarda e o próximo Salvar edita o mesmo)", async () => {
    estado.respostas[RPC_MEDICO] = {
      data: null,
      error: { code: "22023", message: MENSAGEM_CONVENIO_INATIVO },
    };
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      insurance_ids: [UNIMED],
    });
    expect(resultado).toEqual({
      ok: false,
      parcial: true,
      id: NOVO,
      error:
        "O profissional foi criado, mas os convênios que ele atende não. Um convênio desativado não pode ser marcado.",
    });
  });

  it("sem convênio (lista vazia ou ausente) nem chama a RPC", async () => {
    for (const extra of [{}, { insurance_ids: [] }]) {
      estado.rpcs = [];
      const resultado = await salvarProfissionalAction({
        ...JOAO_NA_TELA,
        ...extra,
      });
      expect(resultado).toEqual({ ok: true, id: NOVO });
      expect(estado.rpcs).toEqual([]);
    }
  });

  it("insert que falha não chega à RPC", async () => {
    estado.erroNoInsert.professional = { code: "23514", message: "x" };
    const resultado = await salvarProfissionalAction({
      ...JOAO_NA_TELA,
      insurance_ids: [UNIMED],
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Não foi possível criar o profissional.",
    });
    expect(estado.rpcs).toEqual([]);
  });
});

describe("salvarProfissionalAction recusa antes do banco", () => {
  it("convênio repetido, id inválido ou lista grande demais", async () => {
    for (const insurance_ids of [
      [UNIMED, UNIMED],
      ["nao-e-uuid"],
      Array.from(
        { length: 201 },
        (_, n) => `2c2c2c2c-0000-4000-8000-${String(n).padStart(12, "0")}`,
      ),
    ]) {
      const resultado = await salvarProfissionalAction({
        ...JOAO_NA_TELA,
        id: JOAO,
        insurance_ids,
      });
      expect(resultado).toEqual({
        ok: false,
        error: "Confira os campos do profissional.",
      });
    }
    expect(estado.eventos).toEqual([]);
  });

  it("recepção e leitura não salvam, e nada vai ao banco", async () => {
    for (const papel of ["recepcao", "leitura", "profissional"]) {
      sessao.active.role = papel;
      const resultado = await salvarProfissionalAction({
        ...JOAO_NA_TELA,
        id: JOAO,
        insurance_ids: [UNIMED],
      });
      expect(resultado, papel).toEqual({
        ok: false,
        error: "Somente administradores e gestores alteram os cadastros.",
      });
    }
    expect(estado.eventos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lado do procedimento
// ---------------------------------------------------------------------------

function particular(professionalId: string, preco = 40000, duracao = 40) {
  return {
    professional_id: professionalId,
    insurance_id: null,
    price_cents: preco,
    covered_by_insurance: false,
    duration_min: duracao,
  };
}

function coberto(professionalId: string, insuranceId: string, duracao = 40) {
  return {
    professional_id: professionalId,
    insurance_id: insuranceId,
    price_cents: null,
    covered_by_insurance: true,
    duration_min: duracao,
  };
}

function retornoDoProcedimento(parcial: Linha = {}): Linha {
  return {
    aplicado: true,
    criados: 0,
    reativados: 0,
    atualizados: 0,
    desativados: 0,
    consultas_futuras: 0,
    primeira_consulta: null,
    planos_entram: [],
    planos_saem: [],
    ...parcial,
  };
}

const EXTRAS = {
  planos: [UNIMED],
  vinculosNaAbertura: [
    { professional_id: JOAO, insurance_id: null },
    { professional_id: JOAO, insurance_id: UNIMED },
  ],
  planosNaAbertura: [UNIMED],
  confirmar: false,
};

describe("sincronizarVinculosDoProcedimentoAction sem extras (modo legado)", () => {
  it("a chamada de sempre, com 2 argumentos, e o resumo de 5 chaves", async () => {
    estado.respostas[RPC_PROCEDIMENTO] = {
      data: {
        criados: 2,
        reativados: 0,
        atualizados: 1,
        desativados: 0,
        consultas_futuras: 0,
      },
      error: null,
    };
    const resultado = await sincronizarVinculosDoProcedimentoAction(ENDO, [
      particular(JOAO),
      coberto(JOAO, UNIMED),
    ]);
    expect(estado.rpcs).toEqual([
      {
        fn: RPC_PROCEDIMENTO,
        args: {
          p_procedure_id: ENDO,
          p_linhas: [particular(JOAO), coberto(JOAO, UNIMED)],
        },
      },
    ]);
    expect(resultado).toEqual({
      ok: true,
      id: ENDO,
      resumo: {
        criados: 2,
        reativados: 0,
        atualizados: 1,
        desativados: 0,
        consultasFuturas: 0,
      },
    });
    expect(estado.auditoria).toMatchObject([
      {
        action: "editou_vinculos_do_procedimento",
        entity: "procedure",
        entity_id: ENDO,
      },
    ]);
  });

  it("extras null também é o legado", async () => {
    estado.respostas[RPC_PROCEDIMENTO] = {
      data: retornoDoProcedimento(),
      error: null,
    };
    await sincronizarVinculosDoProcedimentoAction(
      ENDO,
      [particular(JOAO)],
      null,
    );
    expect(Object.keys(estado.rpcs[0]!.args).sort()).toEqual([
      "p_linhas",
      "p_procedure_id",
    ]);
  });

  it("no legado, 22023 continua a mensagem de preço e duração", async () => {
    estado.respostas[RPC_PROCEDIMENTO] = {
      data: null,
      error: { code: "22023", message: "Confira o preço e a duração." },
    };
    const resultado = await sincronizarVinculosDoProcedimentoAction(ENDO, [
      particular(JOAO),
    ]);
    expect(resultado).toEqual({
      ok: false,
      error: "Confira o preço e a duração de cada profissional e convênio.",
    });
  });
});

describe("sincronizarVinculosDoProcedimentoAction com extras (modo novo)", () => {
  it("manda os quatro parâmetros novos e devolve o resumo com os convênios que entram e saem", async () => {
    estado.respostas[RPC_PROCEDIMENTO] = {
      data: retornoDoProcedimento({
        criados: 1,
        planos_entram: [BRADESCO],
      }),
      error: null,
    };
    const resultado = await sincronizarVinculosDoProcedimentoAction(
      ENDO,
      [particular(JOAO), coberto(JOAO, UNIMED), coberto(JOAO, BRADESCO)],
      {
        ...EXTRAS,
        planos: [UNIMED, BRADESCO, UNIMED],
      },
    );
    expect(estado.rpcs).toEqual([
      {
        fn: RPC_PROCEDIMENTO,
        args: {
          p_procedure_id: ENDO,
          p_linhas: [
            particular(JOAO),
            coberto(JOAO, UNIMED),
            coberto(JOAO, BRADESCO),
          ],
          p_planos: [UNIMED, BRADESCO],
          p_vinculos_na_abertura: EXTRAS.vinculosNaAbertura,
          p_planos_na_abertura: [UNIMED],
          p_confirmar: false,
        },
      },
    ]);
    expect(resultado).toEqual({
      ok: true,
      id: ENDO,
      resumo: {
        criados: 1,
        reativados: 0,
        atualizados: 0,
        desativados: 0,
        consultasFuturas: 0,
        primeiraConsulta: null,
        planosEntram: [BRADESCO],
        planosSaem: [],
      },
    });
    expect(estado.auditoria).toHaveLength(1);
  });

  it("procedimento novo: abertura vazia, nenhum convênio cobre (o Botox)", async () => {
    estado.respostas[RPC_PROCEDIMENTO] = {
      data: retornoDoProcedimento({ criados: 1 }),
      error: null,
    };
    const resultado = await sincronizarVinculosDoProcedimentoAction(
      ENDO,
      [particular(ANA, 120000, 30)],
      {
        planos: [],
        vinculosNaAbertura: [],
        planosNaAbertura: [],
        confirmar: false,
      },
    );
    expect(resultado.ok).toBe(true);
    expect(estado.rpcs[0]?.args).toMatchObject({
      p_planos: [],
      p_vinculos_na_abertura: [],
      p_planos_na_abertura: [],
    });
  });

  it("consulta futura num vínculo que sai: aplicado false, NADA gravado, motivo vinculos (D4)", async () => {
    estado.respostas[RPC_PROCEDIMENTO] = {
      data: retornoDoProcedimento({
        aplicado: false,
        desativados: 1,
        consultas_futuras: 1,
        primeira_consulta: PRIMEIRA,
        planos_saem: [UNIMED],
      }),
      error: null,
    };
    const resultado = await sincronizarVinculosDoProcedimentoAction(
      ENDO,
      [particular(JOAO)],
      { ...EXTRAS, planos: [] },
    );
    expect(resultado).toEqual({
      ok: false,
      code: "consultas_no_periodo",
      motivo: "vinculos",
      consultas: 1,
      primeiraConsulta: PRIMEIRA,
      resumo: {
        criados: 0,
        reativados: 0,
        atualizados: 0,
        desativados: 1,
        consultasFuturas: 1,
        primeiraConsulta: PRIMEIRA,
        planosEntram: [],
        planosSaem: [UNIMED],
      },
    });
    expect(estado.auditoria).toEqual([]);
  });

  it("com extras.confirmar a RPC vai com p_confirmar e grava", async () => {
    estado.respostas[RPC_PROCEDIMENTO] = {
      data: retornoDoProcedimento({ desativados: 1, consultas_futuras: 1 }),
      error: null,
    };
    const resultado = await sincronizarVinculosDoProcedimentoAction(
      ENDO,
      [particular(JOAO)],
      { ...EXTRAS, planos: [], confirmar: true },
    );
    expect(estado.rpcs[0]?.args.p_confirmar).toBe(true);
    expect(resultado).toMatchObject({
      ok: true,
      resumo: { desativados: 1, consultasFuturas: 1 },
    });
  });

  it("convênio de linha fora dos que cobrem é recusado antes do banco, com a frase da regra", async () => {
    const resultado = await sincronizarVinculosDoProcedimentoAction(
      ENDO,
      [particular(JOAO), coberto(JOAO, BRADESCO)],
      EXTRAS,
    );
    expect(resultado).toEqual({
      ok: false,
      error:
        "Um convênio marcado para um profissional não está entre os convênios que cobrem este procedimento.",
    });
    expect(estado.rpcs).toEqual([]);
  });

  it("extras fora do formato é recusado antes do banco", async () => {
    for (const extras of [
      { ...EXTRAS, confirmar: "sim" },
      { ...EXTRAS, planos: ["nao-e-uuid"] },
      { planos: [UNIMED] },
      "cobre",
    ]) {
      const resultado = await sincronizarVinculosDoProcedimentoAction(
        ENDO,
        [particular(JOAO)],
        extras,
      );
      expect(resultado).toEqual({
        ok: false,
        error: "Confira os convênios que cobrem este procedimento.",
      });
    }
    expect(estado.rpcs).toEqual([]);
  });

  it("aba parada (CZ409): code cadastro_mudou, para a tela chamar aoMudar", async () => {
    estado.respostas[RPC_PROCEDIMENTO] = {
      data: null,
      error: { code: "CZ409", message: MENSAGEM_CADASTRO_MUDOU },
    };
    const resultado = await sincronizarVinculosDoProcedimentoAction(
      ENDO,
      [particular(JOAO), coberto(JOAO, UNIMED)],
      EXTRAS,
    );
    expect(resultado).toEqual({
      ok: false,
      code: "cadastro_mudou",
      error: MENSAGEM_CADASTRO_MUDOU,
    });
    expect(estado.auditoria).toEqual([]);
  });

  it("22023 no modo novo é o convênio desativado que entra", async () => {
    estado.respostas[RPC_PROCEDIMENTO] = {
      data: null,
      error: { code: "22023", message: MENSAGEM_CONVENIO_INATIVO },
    };
    const resultado = await sincronizarVinculosDoProcedimentoAction(
      ENDO,
      [particular(JOAO), coberto(JOAO, UNIMED)],
      EXTRAS,
    );
    expect(resultado).toEqual({ ok: false, error: MENSAGEM_CONVENIO_INATIVO });
  });

  it("23514 do banco vai como veio; o CHECK cru em inglês não", async () => {
    estado.respostas[RPC_PROCEDIMENTO] = {
      data: null,
      error: {
        code: "23514",
        message:
          "Um profissional não atende um dos convênios marcados. Feche, abra de novo e salve.",
      },
    };
    expect(
      await sincronizarVinculosDoProcedimentoAction(
        ENDO,
        [particular(JOAO), coberto(JOAO, UNIMED)],
        EXTRAS,
      ),
    ).toEqual({
      ok: false,
      error:
        "Um profissional não atende um dos convênios marcados. Feche, abra de novo e salve.",
    });

    estado.respostas[RPC_PROCEDIMENTO] = {
      data: null,
      error: {
        code: "23514",
        message:
          'new row for relation "service_link" violates check constraint "coberto_exige_convenio"',
      },
    };
    expect(
      await sincronizarVinculosDoProcedimentoAction(
        ENDO,
        [particular(JOAO), coberto(JOAO, UNIMED)],
        EXTRAS,
      ),
    ).toEqual({
      ok: false,
      error: "Não foi possível salvar quem faz e os convênios.",
    });
  });

  it("procedimento de outra clínica não chega à RPC", async () => {
    estado.tabelas.procedure = [];
    const resultado = await sincronizarVinculosDoProcedimentoAction(
      ENDO,
      [particular(JOAO)],
      EXTRAS,
    );
    expect(resultado).toEqual({
      ok: false,
      error: "Procedimento não encontrado.",
    });
    expect(estado.rpcs).toEqual([]);
  });

  it("recepção não grava, com ou sem extras", async () => {
    sessao.active.role = "recepcao";
    const resultado = await sincronizarVinculosDoProcedimentoAction(
      ENDO,
      [particular(JOAO)],
      EXTRAS,
    );
    expect(resultado).toEqual({
      ok: false,
      error: "Somente administradores e gestores alteram os cadastros.",
    });
    expect(estado.eventos).toEqual([]);
  });
});

describe("salvarProcedimentoAction: alinhamento de IA pode agendar", () => {
  const PROCEDIMENTO_NA_TELA = {
    id: ENDO,
    name: "Consulta endocrinologia",
    description: null,
    default_duration_min: 40,
    base_price_cents: 40000,
    requires_evaluation: false,
    prep_instructions: null,
    bookable_by_ai: false,
    active: true,
  };

  it("sem erro, como antes: a linha, a trilha e o alinhamento dos vínculos", async () => {
    const resultado = await salvarProcedimentoAction(PROCEDIMENTO_NA_TELA);
    expect(resultado).toEqual({ ok: true, id: ENDO });
    expect(estado.eventos).toEqual([
      "update:procedure",
      "audit:editou",
      "update:service_link",
    ]);
    expect(estado.updates[1]).toMatchObject({
      tabela: "service_link",
      valores: { bookable_by_ai: false },
      filtros: { procedure_id: ENDO },
    });
  });

  it("erro no alinhamento volta como gravação parcial, com o id", async () => {
    estado.erroNoUpdate.service_link = { code: "42501", message: "rls" };
    const resultado = await salvarProcedimentoAction(PROCEDIMENTO_NA_TELA);
    expect(resultado).toEqual({
      ok: false,
      parcial: true,
      id: ENDO,
      error:
        "O procedimento foi salvo, mas a opção IA pode agendar não chegou a quem faz este procedimento. Clique em Salvar de novo.",
    });
    expect(resultado.error).not.toMatch(/[–—]/);
  });

  it("ao criar não alinha nada: sem vínculo ainda, o retorno é ok com o id do insert", async () => {
    // Mesmo com o UPDATE de service_link quebrado, a criação não vira
    // parcial: a tela de hoje descartaria o id e o próximo Salvar duplicaria
    // o procedimento.
    estado.erroNoUpdate.service_link = { code: "08006", message: "rede" };
    const novo: Linha = { ...PROCEDIMENTO_NA_TELA };
    delete novo.id;
    const resultado = await salvarProcedimentoAction(novo);
    expect(resultado).toEqual({ ok: true, id: NOVO });
    expect(estado.eventos).toEqual(["insert:procedure", "audit:criou"]);
    expect(estado.eventos).not.toContain("update:service_link");
  });
});
