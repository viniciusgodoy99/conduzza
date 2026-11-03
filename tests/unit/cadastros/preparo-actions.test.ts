import { beforeEach, describe, expect, it, vi } from "vitest";

import { FRASES_SEM_PERMISSAO } from "@/components/cadastros/preparo-na-tela";

// As Server Actions da orientacao de preparo (AG7, frente T; contrato 4.6),
// contra um cliente do Supabase dublado. O que interessa aqui:
//   - a guarda de papel NA ACTION, antes da RPC (esconder botao nao protege
//     nada): escrever, descartar e suspender para administrador, gestor,
//     super admin e o RT vigente de qualquer papel; aprovar, aprovar de novo
//     e devolver SO para o RT vigente (nem o super admin, D-71);
//   - Zod na entrada, a clinica sempre a ativa, o procedimento ou a versao
//     de outra clinica recusados antes da RPC;
//   - o texto normalizado e recusado por problemasDoTextoDoPreparo antes da
//     RPC (promessa, oferta, antes e depois, preco e link), com remedio,
//     dose e jejum passando (D-80);
//   - a traducao dos codigos do banco;
//   - o "aprovar de novo" sem gravar nada quando o texto do banco nao e o
//     que o RT leu.
// O comportamento do banco (as RPCs, as travas, a trilha) esta em
// tests/rls/preparo-aprovado-pelo-rt.test.ts e tests/integration.

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const OUTRA_CLINICA = "0b0b0b0b-0000-4000-8000-00000000000b";
const PROC = "3d3d3d3d-0000-4000-8000-000000000001";
const PROC_DE_FORA = "3d3d3d3d-0000-4000-8000-000000000009";
const V1 = "5f5f5f5f-0000-4000-8000-000000000001";
const V2 = "5f5f5f5f-0000-4000-8000-000000000002";
const V_DE_FORA = "5f5f5f5f-0000-4000-8000-000000000009";
const NOVA = "5f5f5f5f-0000-4000-8000-000000000003";
const SHA_V1 = "a".repeat(64);
const SHA_V2 = "b".repeat(64);
const SHA_NOVA = "c".repeat(64);

type Linha = Record<string, unknown>;
type Erro = { code: string; message: string };

const estado = {
  tabelas: {} as Record<string, Linha[]>,
  rpcs: [] as { nome: string; args: Linha }[],
  souRt: false,
  respostas: {} as Record<string, { data: unknown; error: Erro | null }>,
};

function consulta(tabela: string) {
  const filtros: [string, unknown][] = [];
  const resolver = () => ({
    data: (estado.tabelas[tabela] ?? []).filter((linha) =>
      filtros.every(([coluna, valor]) => linha[coluna] === valor),
    ),
    error: null,
  });
  const api = {
    select: () => api,
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor]);
      return api;
    },
    order: () => api,
    maybeSingle: async () => {
      const r = resolver();
      return { data: r.data[0] ?? null, error: r.error };
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
    estado.rpcs.push({ nome, args });
    if (nome === "user_e_responsavel_tecnico") {
      return { data: estado.souRt, error: null };
    }
    return estado.respostas[nome] ?? { data: null, error: null };
  },
  from: (tabela: string) => consulta(tabela),
};

const sessao = {
  userId: "usuario-da-sessao",
  isProductAdmin: false,
  active: {
    clinicId: CLINICA,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "admin" as string,
    implementador: false,
    status: "ativo",
  } as Record<string, unknown> | null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cliente,
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const {
  aprovarDeNovoAction,
  aprovarPreparoAction,
  avisosDoPreparoAction,
  descartarPreparoAction,
  devolverPreparoAction,
  salvarPreparoAction,
  suspenderPreparoAction,
} = await import("@/app/(app)/cadastros/preparo-actions");

function papel(
  role: string,
  extras: { superAdmin?: boolean; rt?: boolean } = {},
) {
  (sessao.active as Record<string, unknown>).role = role;
  sessao.isProductAdmin = extras.superAdmin === true;
  estado.souRt = extras.rt === true;
}

/** As RPCs de escrita chamadas (sem a conferencia do RT). */
function escritas(): string[] {
  return estado.rpcs
    .map((r) => r.nome)
    .filter((nome) => nome !== "user_e_responsavel_tecnico");
}

beforeEach(() => {
  sessao.active = {
    clinicId: CLINICA,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "admin",
    implementador: false,
    status: "ativo",
  };
  sessao.isProductAdmin = false;
  estado.souRt = false;
  estado.rpcs = [];
  estado.respostas = {
    salvar_preparo_do_procedimento: {
      data: { versao_id: NOVA, versao: 3, texto_sha256: SHA_NOVA },
      error: null,
    },
  };
  estado.tabelas = {
    procedure: [
      { id: PROC, clinic_id: CLINICA },
      { id: PROC_DE_FORA, clinic_id: OUTRA_CLINICA },
    ],
    preparo_do_procedimento: [
      {
        id: V1,
        clinic_id: CLINICA,
        procedure_id: PROC,
        versao: 1,
        situacao: "aprovado",
        texto: "Jejum de 8 horas.",
        texto_sha256: SHA_V1,
      },
      {
        id: V2,
        clinic_id: CLINICA,
        procedure_id: PROC,
        versao: 2,
        situacao: "aguardando_rt",
        texto: "Tome 2 comprimidos de bisacodil às 18h.",
        texto_sha256: SHA_V2,
      },
      {
        id: V_DE_FORA,
        clinic_id: OUTRA_CLINICA,
        procedure_id: PROC_DE_FORA,
        versao: 1,
        situacao: "aguardando_rt",
        texto: "Jejum de 6 horas.",
        texto_sha256: SHA_V1,
      },
    ],
  };
});

const SALVAR = { procedureId: PROC, texto: "Jejum de 8 horas.", versaoLida: 2 };

describe("sessão e entrada", () => {
  it("sem clínica ativa: a sessão expirou, nada chega ao banco", async () => {
    sessao.active = null;
    for (const resultado of [
      await salvarPreparoAction(SALVAR),
      await aprovarPreparoAction({ versaoId: V2, textoSha256: SHA_V2 }),
      await descartarPreparoAction({ versaoId: V2 }),
      await suspenderPreparoAction({ procedureId: PROC }),
    ]) {
      expect(resultado).toEqual({
        ok: false,
        error: "Sessão expirada. Entre de novo.",
      });
    }
    expect(estado.rpcs).toEqual([]);
  });

  it("Zod recusa a entrada fora do formato antes de tudo", async () => {
    expect((await salvarPreparoAction({ ...SALVAR, versaoLida: -1 })).ok).toBe(
      false,
    );
    expect(
      (await salvarPreparoAction({ ...SALVAR, procedureId: "nao-e-uuid" })).ok,
    ).toBe(false);
    expect(
      (await aprovarPreparoAction({ versaoId: V2, textoSha256: "curto" })).ok,
    ).toBe(false);
    expect(escritas()).toEqual([]);
  });
});

describe("escrever (salvarPreparoAction)", () => {
  it.each(["admin", "gestor"])(
    "%s escreve sem precisar ser o RT",
    async (role) => {
      papel(role);
      expect((await salvarPreparoAction(SALVAR)).ok).toBe(true);
      expect(estado.rpcs.map((r) => r.nome)).toEqual([
        "salvar_preparo_do_procedimento",
      ]);
    },
  );

  it.each(["recepcao", "profissional", "leitura"])(
    "%s que não é o RT: a frase do banco, sem gravar",
    async (role) => {
      papel(role);
      expect(await salvarPreparoAction(SALVAR)).toEqual({
        ok: false,
        error: FRASES_SEM_PERMISSAO.escrever,
        code: "sem_permissao",
      });
      expect(escritas()).toEqual([]);
    },
  );

  it.each(["recepcao", "profissional", "leitura"])(
    "%s que é o RT vigente escreve (D-71)",
    async (role) => {
      papel(role, { rt: true });
      expect((await salvarPreparoAction(SALVAR)).ok).toBe(true);
      expect(escritas()).toEqual(["salvar_preparo_do_procedimento"]);
    },
  );

  it("a equipe Conduzza (super admin) escreve", async () => {
    papel("leitura", { superAdmin: true });
    expect((await salvarPreparoAction(SALVAR)).ok).toBe(true);
  });

  it("normaliza como o banco guarda (CRLF, NFC e as pontas) e devolve a versão nova", async () => {
    const resultado = await salvarPreparoAction({
      ...SALVAR,
      texto: "  Jejum de 8 horas.\r\nTome a\u0301gua à vontade.\r\n ",
    });
    expect(resultado).toEqual({
      ok: true,
      versao: { id: NOVA, versao: 3, textoSha256: SHA_NOVA },
    });
    expect(estado.rpcs.at(-1)).toEqual({
      nome: "salvar_preparo_do_procedimento",
      args: {
        p_procedure_id: PROC,
        p_texto: "Jejum de 8 horas.\nTome água à vontade.",
        p_versao_lida: 2,
      },
    });
  });

  it("remédio, dose e jejum passam (D-80): só avisam no diálogo do RT", async () => {
    const resultado = await salvarPreparoAction({
      ...SALVAR,
      texto:
        "Jejum de 8 horas. Tome 2 comprimidos de bisacodil às 18h do dia anterior.",
    });
    expect(resultado.ok).toBe(true);
  });

  it.each([
    ["Jejum de 8 horas. Resultado garantido.", "Tire a promessa de resultado"],
    ["Na compra do exame, a consulta é grátis.", "Tire a oferta de brinde"],
    ["Veja o antes e depois dos pacientes.", "antes e depois"],
    ["O exame custa R$ 250,00.", "Tire o valor"],
    ["Veja o vídeo em www.clinica.com.br.", "Tire o link"],
  ])("recusa antes da RPC: %s", async (texto, frase) => {
    const resultado = await salvarPreparoAction({ ...SALVAR, texto });
    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? "" : resultado.error).toContain(frase);
    expect(escritas()).toEqual([]);
  });

  it("o texto fora do CHECK é recusado em frase de recepção", async () => {
    expect(await salvarPreparoAction({ ...SALVAR, texto: "  " })).toEqual({
      ok: false,
      error: "Escreva a orientação de preparo.",
    });
    expect(
      await salvarPreparoAction({ ...SALVAR, texto: "a".repeat(3_501) }),
    ).toEqual({
      ok: false,
      error: "A orientação de preparo pode ter até 3.500 caracteres.",
    });
    expect(escritas()).toEqual([]);
  });

  it("procedimento de outra clínica não chega à RPC", async () => {
    expect(
      await salvarPreparoAction({ ...SALVAR, procedureId: PROC_DE_FORA }),
    ).toEqual({ ok: false, error: "Procedimento não encontrado." });
    expect(escritas()).toEqual([]);
  });

  it("os códigos do banco em frase de recepção", async () => {
    estado.respostas.salvar_preparo_do_procedimento = {
      data: null,
      error: { code: "P0001", message: "texto_mudou" },
    };
    expect(await salvarPreparoAction(SALVAR)).toEqual({
      ok: false,
      error: "Outra pessoa salvou um texto novo agora. Feche e abra de novo.",
      code: "texto_mudou",
    });
    estado.respostas.salvar_preparo_do_procedimento = {
      data: null,
      error: { code: "P0001", message: "texto_igual_ao_em_vigor" },
    };
    expect(await salvarPreparoAction(SALVAR)).toEqual({
      ok: false,
      error: "Este texto já é o que está valendo.",
      code: "texto_igual_ao_em_vigor",
    });
    estado.respostas.salvar_preparo_do_procedimento = {
      data: null,
      error: { code: "42501", message: FRASES_SEM_PERMISSAO.escrever },
    };
    expect(await salvarPreparoAction(SALVAR)).toEqual({
      ok: false,
      error: FRASES_SEM_PERMISSAO.escrever,
      code: "sem_permissao",
    });
  });
});

describe("aprovar e devolver (só o RT vigente)", () => {
  it.each([
    ["admin", false],
    ["gestor", false],
    ["leitura", true],
  ] as const)(
    "%s que não é o RT (super admin %s) não aprova",
    async (role, superAdmin) => {
      papel(role, { superAdmin });
      expect(
        await aprovarPreparoAction({ versaoId: V2, textoSha256: SHA_V2 }),
      ).toEqual({
        ok: false,
        error: FRASES_SEM_PERMISSAO.aprovar,
        code: "sem_permissao",
      });
      expect(
        await devolverPreparoAction({ versaoId: V2, comentario: "Troque." }),
      ).toEqual({
        ok: false,
        error: FRASES_SEM_PERMISSAO.aprovar,
        code: "sem_permissao",
      });
      expect(escritas()).toEqual([]);
    },
  );

  it("o RT de papel leitura aprova com o hash que leu", async () => {
    papel("leitura", { rt: true });
    expect(
      await aprovarPreparoAction({ versaoId: V2, textoSha256: SHA_V2 }),
    ).toEqual({ ok: true });
    expect(estado.rpcs.at(-1)).toEqual({
      nome: "aprovar_preparo_do_procedimento",
      args: { p_versao_id: V2, p_texto_sha256: SHA_V2 },
    });
  });

  it("versão de outra clínica não chega à RPC", async () => {
    papel("admin", { rt: true });
    expect(
      await aprovarPreparoAction({ versaoId: V_DE_FORA, textoSha256: SHA_V1 }),
    ).toEqual({
      ok: false,
      error: "Este texto não foi encontrado. Feche e abra de novo.",
    });
    expect(escritas()).toEqual([]);
  });

  it("quem chegou depois: nao_aguarda_aprovacao e o 42501 do RT que mudou", async () => {
    papel("admin", { rt: true });
    estado.respostas.aprovar_preparo_do_procedimento = {
      data: null,
      error: { code: "P0001", message: "nao_aguarda_aprovacao" },
    };
    expect(
      await aprovarPreparoAction({ versaoId: V2, textoSha256: SHA_V2 }),
    ).toEqual({
      ok: false,
      error:
        "Este texto não está mais esperando aprovação. Feche e abra de novo.",
      code: "nao_aguarda_aprovacao",
    });
    estado.respostas.aprovar_preparo_do_procedimento = {
      data: null,
      error: { code: "42501", message: FRASES_SEM_PERMISSAO.aprovar },
    };
    expect(
      await aprovarPreparoAction({ versaoId: V2, textoSha256: SHA_V2 }),
    ).toMatchObject({ ok: false, code: "sem_permissao" });
  });

  it("devolver exige o comentário (aparado, até 300)", async () => {
    papel("profissional", { rt: true });
    for (const comentario of ["   ", "a".repeat(301)]) {
      expect(await devolverPreparoAction({ versaoId: V2, comentario })).toEqual(
        {
          ok: false,
          error: "Escreva o que precisa mudar, em até 300 caracteres.",
        },
      );
    }
    expect(escritas()).toEqual([]);
    expect(
      await devolverPreparoAction({
        versaoId: V2,
        comentario: "  Troque o horário do laxante.  ",
      }),
    ).toEqual({ ok: true });
    expect(estado.rpcs.at(-1)).toEqual({
      nome: "devolver_preparo_do_procedimento",
      args: { p_versao_id: V2, p_comentario: "Troque o horário do laxante." },
    });
  });
});

describe("aprovar de novo", () => {
  const DE_NOVO = { procedureId: PROC, versaoLida: 2, textoSha256: SHA_V1 };

  it("só o RT vigente", async () => {
    papel("admin");
    expect(await aprovarDeNovoAction(DE_NOVO)).toEqual({
      ok: false,
      error: FRASES_SEM_PERMISSAO.aprovar,
      code: "sem_permissao",
    });
    expect(escritas()).toEqual([]);
  });

  it("salva o mesmo texto da última aprovada e aprova a versão nova, numa ação", async () => {
    papel("leitura", { rt: true });
    expect(await aprovarDeNovoAction(DE_NOVO)).toEqual({ ok: true });
    expect(
      estado.rpcs.filter((r) => r.nome !== "user_e_responsavel_tecnico"),
    ).toEqual([
      {
        nome: "salvar_preparo_do_procedimento",
        args: {
          p_procedure_id: PROC,
          p_texto: "Jejum de 8 horas.",
          p_versao_lida: 2,
        },
      },
      {
        nome: "aprovar_preparo_do_procedimento",
        args: { p_versao_id: NOVA, p_texto_sha256: SHA_NOVA },
      },
    ]);
  });

  it("o texto do banco não é o que o RT leu: nada é gravado", async () => {
    papel("leitura", { rt: true });
    expect(
      await aprovarDeNovoAction({ ...DE_NOVO, textoSha256: SHA_V2 }),
    ).toEqual({
      ok: false,
      error: "O texto mudou enquanto você lia. Feche e abra de novo.",
      code: "texto_mudou",
    });
    expect(escritas()).toEqual([]);
  });

  it("a aprovação falhou depois de salvar: o texto ficou aguardando o RT", async () => {
    papel("leitura", { rt: true });
    estado.respostas.aprovar_preparo_do_procedimento = {
      data: null,
      error: { code: "P0001", message: "outra_aprovacao" },
    };
    expect(await aprovarDeNovoAction(DE_NOVO)).toEqual({
      ok: false,
      error:
        "Outro texto foi aprovado agora. Feche e abra de novo. O texto ficou aguardando o RT.",
      code: "outra_aprovacao",
    });
  });
});

describe("descartar e suspender", () => {
  it("recepção, profissional e leitura que não são o RT recebem a frase do banco", async () => {
    for (const role of ["recepcao", "profissional", "leitura"]) {
      papel(role);
      expect(await descartarPreparoAction({ versaoId: V2 })).toEqual({
        ok: false,
        error: FRASES_SEM_PERMISSAO.descartar,
        code: "sem_permissao",
      });
      expect(await suspenderPreparoAction({ procedureId: PROC })).toEqual({
        ok: false,
        error: FRASES_SEM_PERMISSAO.suspender,
        code: "sem_permissao",
      });
    }
    expect(escritas()).toEqual([]);
  });

  it("administrador descarta e suspende; o RT de qualquer papel também", async () => {
    papel("gestor");
    expect(await descartarPreparoAction({ versaoId: V2 })).toEqual({
      ok: true,
    });
    papel("leitura", { rt: true });
    expect(await suspenderPreparoAction({ procedureId: PROC })).toEqual({
      ok: true,
    });
    expect(estado.rpcs.at(-1)).toEqual({
      nome: "suspender_preparo_do_procedimento",
      args: { p_procedure_id: PROC },
    });
  });

  it("suspender com motivo (até 300) e sem preparo aprovado", async () => {
    papel("admin");
    expect(
      await suspenderPreparoAction({
        procedureId: PROC,
        comentario: "a".repeat(301),
      }),
    ).toEqual({ ok: false, error: "Escreva o motivo em até 300 caracteres." });
    await suspenderPreparoAction({
      procedureId: PROC,
      comentario: " Revisar a dose. ",
    });
    expect(estado.rpcs.at(-1)?.args).toEqual({
      p_procedure_id: PROC,
      p_comentario: "Revisar a dose.",
    });
    estado.respostas.suspender_preparo_do_procedimento = {
      data: null,
      error: { code: "P0001", message: "sem_preparo_aprovado" },
    };
    expect(await suspenderPreparoAction({ procedureId: PROC })).toEqual({
      ok: false,
      error: "Não há orientação aprovada para suspender.",
      code: "sem_preparo_aprovado",
    });
  });
});

describe("os avisos do texto para o diálogo do RT", () => {
  it("remédio e dose viram aviso, calculados no servidor", async () => {
    const resultado = await avisosDoPreparoAction({ versaoId: V2 });
    expect(resultado.ok).toBe(true);
    expect(resultado.ok ? resultado.avisos : []).toEqual(
      expect.arrayContaining(["medicamento", "dosagem"]),
    );
  });

  it("jejum avisa como orientação; a versão de outra clínica não é lida", async () => {
    expect(await avisosDoPreparoAction({ versaoId: V1 })).toEqual({
      ok: true,
      avisos: ["orientacao_clinica"],
    });
    expect(await avisosDoPreparoAction({ versaoId: V_DE_FORA })).toEqual({
      ok: false,
      error: "Este texto não foi encontrado. Feche e abra de novo.",
    });
  });
});
