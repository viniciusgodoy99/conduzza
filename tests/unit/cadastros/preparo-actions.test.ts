import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRASE_DA_EQUIPE_CONDUZZA,
  FRASES_SEM_PERMISSAO,
  TEXTOS_DO_PREPARO as T,
} from "@/components/cadastros/preparo-na-tela";

// As Server Actions da orientacao de preparo (AG7, frente T; contrato 4.6),
// contra um cliente do Supabase dublado. O que interessa aqui:
//   - a guarda de papel NA ACTION, antes da RPC (esconder botao nao protege
//     nada): escrever, descartar e suspender para administrador, gestor,
//     super admin e o RT vigente de qualquer papel; aprovar, aprovar de novo
//     e devolver SO para o RT vigente, nunca para o super admin, nem quando
//     ele e o RT designado (D-71; revisao das telas, TELA-9);
//   - Zod na entrada, a clinica sempre a ativa, o procedimento ou a versao
//     de outra clinica recusados antes da RPC;
//   - o texto preparado (a tabulacao vira espaco) e recusado por
//     problemasDoTextoDoPreparo antes da RPC (promessa, oferta, antes e
//     depois, preco e link), com a frase que aponta o trecho (TELA-8), e
//     remedio, dose e jejum passando (D-80);
//   - a traducao dos codigos do banco (o 42501 tecnico nunca chega cru);
//   - o aprovar conferindo o texto de novo pelas regras de hoje (CFM-2);
//   - o "aprovar de novo" sem gravar nada quando ha texto novo esperando o
//     RT (TELA-1), quando o texto do banco nao e o que o RT leu, quando o
//     nome do procedimento nao e o da previa (TELA-11) ou quando as regras
//     recusam o texto; e sem aprovar a versao nova que nao e o texto lido;
//   - o fechamento entre as frentes: o texto_recusado do banco (22023 no
//     salvar, P0001 no aprovar) vira a frase que diz o que tirar (as regras
//     de hoje; senao, o espelho da funcao do banco, com o trecho; senao, as
//     quatro coisas que o banco recusa), nunca "Nao foi possivel...".
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
const V_ANTIGO = "5f5f5f5f-0000-4000-8000-000000000004";
const SHA_ANTIGO = "d".repeat(64);

type Linha = Record<string, unknown>;
type Erro = { code: string; message: string };

// As regras de hoje (problemasDoTextoDoPreparo) de verdade, salvo quando o
// teste simula a divergencia: o banco recusou o que elas deixaram passar.
const regras = vi.hoisted(() => ({ semRecusas: false }));
vi.mock(
  "@/lib/domain/conformidade/preparo-aprovado",
  async (importOriginal) => {
    const real =
      await importOriginal<
        typeof import("@/lib/domain/conformidade/preparo-aprovado")
      >();
    return {
      ...real,
      problemasDoTextoDoPreparo: (texto: string) =>
        regras.semRecusas
          ? { recusas: [], avisos: [], trechosDasRecusas: [] }
          : real.problemasDoTextoDoPreparo(texto),
    };
  },
);

const estado = {
  tabelas: {} as Record<string, Linha[]>,
  rpcs: [] as { nome: string; args: Linha }[],
  souRt: false,
  respostas: {} as Record<string, { data: unknown; error: Erro | null }>,
};

function consulta(tabela: string) {
  const filtros: ((linha: Linha) => boolean)[] = [];
  const resolver = () => ({
    data: (estado.tabelas[tabela] ?? []).filter((linha) =>
      filtros.every((filtro) => filtro(linha)),
    ),
    error: null,
  });
  const api = {
    select: () => api,
    eq: (coluna: string, valor: unknown) => {
      filtros.push((linha) => linha[coluna] === valor);
      return api;
    },
    in: (coluna: string, valores: readonly unknown[]) => {
      filtros.push((linha) => valores.includes(linha[coluna]));
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
  recusasDosPreparosAction,
  salvarPreparoAction,
  suspenderPreparoAction,
} = await import("@/app/(app)/cadastros/preparo-actions");
const { recusasDasVersoesAprovadas } =
  await import("@/app/(app)/cadastros/recusas-do-preparo");

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
  regras.semRecusas = false;
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
      { id: PROC, clinic_id: CLINICA, name: "Colonoscopia" },
      { id: PROC_DE_FORA, clinic_id: OUTRA_CLINICA, name: "Endoscopia" },
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

  it("a tabulação da lista colada do Word vira espaço antes do banco (TELA-8)", async () => {
    const resultado = await salvarPreparoAction({
      ...SALVAR,
      texto: "1.\tJejum de 8 horas.\n2.\tTraga o pedido médico.",
    });
    expect(resultado.ok).toBe(true);
    expect(estado.rpcs.at(-1)?.args).toMatchObject({
      p_texto: "1. Jejum de 8 horas.\n2. Traga o pedido médico.",
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
    ["Jejum de 8 horas. Resultado garantido.", "a promessa de resultado"],
    ["Na compra do exame, a consulta é grátis.", "a oferta de brinde"],
    ["Veja o antes e depois dos pacientes.", "antes e depois"],
    ["O exame custa R$ 250,00.", "o valor e as condições de pagamento"],
    ["Veja o vídeo em www.clinica.com.br.", "o link"],
  ])("recusa antes da RPC: %s", async (texto, frase) => {
    const resultado = await salvarPreparoAction({ ...SALVAR, texto });
    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? "" : resultado.error).toContain(frase);
    expect(resultado.ok ? undefined : resultado.code).toBe("texto_recusado");
    expect(escritas()).toEqual([]);
  });

  it("a recusa aponta o trecho em que a regra achou o problema (TELA-8)", async () => {
    const resultado = await salvarPreparoAction({
      ...SALVAR,
      texto:
        "Jejum de 8 horas antes do exame.\nTraga o pedido médico.\nResultado garantido em 24 horas.",
    });
    expect(resultado).toEqual({
      ok: false,
      error:
        "No trecho “Resultado garantido em 24 horas.”, tire a promessa de resultado (palavras como garantir, 100%, sem dor ou definitivo): a orientação de preparo não pode prometer resultado (Resolução CFM 2.336/2023).",
      code: "texto_recusado",
    });
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

  it("o banco recusa o conteúdo (22023 texto_recusado): a frase diz o que tirar, nunca o erro de sempre", async () => {
    // Uma divergencia: as regras de hoje deixaram passar, o banco recusou.
    regras.semRecusas = true;
    estado.respostas.salvar_preparo_do_procedimento = {
      data: null,
      error: { code: "22023", message: "texto_recusado" },
    };
    // O espelho da funcao do banco acha o link e a frase em que ele esta.
    expect(
      await salvarPreparoAction({
        ...SALVAR,
        texto: "Jejum de 8 horas.\nVeja o vídeo em clinica.com.br.",
      }),
    ).toEqual({
      ok: false,
      error:
        "No trecho “Veja o vídeo em clinica.com.br.”, tire o link (o endereço de site, como www ou .com.br): o paciente recebe só o texto.",
      code: "texto_recusado",
    });
    // O invisivel: a linha e as palavras de antes.
    expect(
      await salvarPreparoAction({
        ...SALVAR,
        texto: "Jejum de 8 horas.\nTraga o pedido\u2066 médico.",
      }),
    ).toEqual({
      ok: false,
      error:
        "Tire o caractere invisível da linha 2, logo depois de “Traga o pedido”: apague e escreva de novo esse pedaço.",
      code: "texto_recusado",
    });
    // Nem as regras nem o espelho acham: as quatro coisas que o banco recusa.
    expect(await salvarPreparoAction(SALVAR)).toEqual({
      ok: false,
      error: T.textoRecusadoPeloBanco,
      code: "texto_recusado",
    });
    for (const chamada of estado.rpcs) {
      expect(chamada.nome).not.toBe("aprovar_preparo_do_procedimento");
    }
  });

  it("o banco recusa o arroba e o emoji de tecla: o trecho e o emoji, cada um uma vez", async () => {
    regras.semRecusas = true;
    estado.respostas.salvar_preparo_do_procedimento = {
      data: null,
      error: { code: "22023", message: "texto_recusado" },
    };
    expect(
      await salvarPreparoAction({
        ...SALVAR,
        texto:
          "Siga @clinica.ensaio para mais dicas.\nTome 1\ufe0f\u20e3 comprimido.",
      }),
    ).toEqual({
      ok: false,
      error:
        "No trecho “Siga @clinica.ensaio para mais dicas.”, tire o arroba (como @clinica): o paciente recebe só o texto. Tire o emoji 1\ufe0f\u20e3: ele leva um caractere invisível, que não pode ir na orientação de preparo.",
      code: "texto_recusado",
    });
  });

  it("o 42501 técnico do Postgres nunca chega à tela (TELA-10)", async () => {
    estado.respostas.salvar_preparo_do_procedimento = {
      data: null,
      error: {
        code: "42501",
        message:
          "permission denied for function salvar_preparo_do_procedimento",
      },
    };
    expect(await salvarPreparoAction(SALVAR)).toEqual({
      ok: false,
      error: FRASES_SEM_PERMISSAO.escrever,
      code: "sem_permissao",
    });
  });
});

describe("aprovar e devolver (só o RT vigente)", () => {
  it.each(["admin", "gestor", "leitura"])(
    "%s que não é o RT não aprova nem devolve",
    async (role) => {
      papel(role);
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

  it.each([
    ["que não é o RT", false],
    ["designado RT", true],
  ] as const)(
    "a equipe Conduzza %s não aprova, não devolve nem aprova de novo (TELA-9)",
    async (_quem, rt) => {
      papel("admin", { superAdmin: true, rt });
      const recusa = {
        ok: false,
        error: FRASE_DA_EQUIPE_CONDUZZA,
        code: "sem_permissao",
      };
      expect(
        await aprovarPreparoAction({ versaoId: V2, textoSha256: SHA_V2 }),
      ).toEqual(recusa);
      expect(
        await devolverPreparoAction({ versaoId: V2, comentario: "Troque." }),
      ).toEqual(recusa);
      expect(
        await aprovarDeNovoAction({
          procedureId: PROC,
          versaoLida: 2,
          textoSha256: SHA_V1,
          nomeLido: "Colonoscopia",
        }),
      ).toEqual(recusa);
      // Recusa antes de tudo: nem a conferencia do RT chega ao banco.
      expect(estado.rpcs).toEqual([]);
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
      code: "versao_inexistente",
    });
    expect(escritas()).toEqual([]);
  });

  it("o hash que o RT leu não é o da versão: nada chega à RPC", async () => {
    papel("profissional", { rt: true });
    expect(
      await aprovarPreparoAction({ versaoId: V2, textoSha256: SHA_V1 }),
    ).toEqual({
      ok: false,
      error: "O texto mudou enquanto você lia. Feche e abra de novo.",
      code: "texto_mudou",
    });
    expect(escritas()).toEqual([]);
  });

  it("o texto que as regras de hoje recusam não é aprovado, e a frase diz o que tirar (CFM-2)", async () => {
    // O texto antigo copiado pela migration (D-83) ou salvo direto pela RPC
    // nunca passou pelo Salvar da tela.
    estado.tabelas.preparo_do_procedimento?.push({
      id: V_ANTIGO,
      clinic_id: CLINICA,
      procedure_id: PROC,
      versao: 3,
      situacao: "aguardando_rt",
      texto:
        "Venha sem maquiagem. Resultado garantido, você vai sair renovada!",
      texto_sha256: SHA_ANTIGO,
    });
    papel("leitura", { rt: true });
    const resultado = await aprovarPreparoAction({
      versaoId: V_ANTIGO,
      textoSha256: SHA_ANTIGO,
    });
    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? undefined : resultado.code).toBe("texto_recusado");
    expect(resultado.ok ? "" : resultado.error).toMatch(
      /^Este texto não pode ser aprovado\. No trecho “Resultado garantido, você vai sair renovada!”, tire a promessa de resultado/,
    );
    expect(escritas()).toEqual([]);
  });

  it("o banco recusa o conteúdo ao aprovar (P0001 texto_recusado): não aprovado, e a frase diz o que tirar", async () => {
    regras.semRecusas = true;
    estado.tabelas.preparo_do_procedimento?.push({
      id: V_ANTIGO,
      clinic_id: CLINICA,
      procedure_id: PROC,
      versao: 3,
      situacao: "aguardando_rt",
      texto: "Jejum de 8 horas. Traga R$ 50,00 para o estacionamento.",
      texto_sha256: SHA_ANTIGO,
    });
    estado.respostas.aprovar_preparo_do_procedimento = {
      data: null,
      error: { code: "P0001", message: "texto_recusado" },
    };
    papel("leitura", { rt: true });
    expect(
      await aprovarPreparoAction({
        versaoId: V_ANTIGO,
        textoSha256: SHA_ANTIGO,
      }),
    ).toEqual({
      ok: false,
      error:
        "Este texto não pode ser aprovado. No trecho “Traga R$ 50,00 para o estacionamento.”, tire o valor em reais: o preço não vai na orientação de preparo.",
      code: "texto_recusado",
    });
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
  const DE_NOVO = {
    procedureId: PROC,
    versaoLida: 2,
    textoSha256: SHA_V1,
    nomeLido: "Colonoscopia",
  };

  /** Sem texto aguardando: a v2 foi descartada, e a v1 parou de valer. */
  function semAguardando() {
    const v2 = estado.tabelas.preparo_do_procedimento?.find((v) => v.id === V2);
    if (v2) {
      v2.situacao = "descartado";
    }
    // O mesmo texto da v1 salvo de novo tem o mesmo hash.
    estado.respostas.salvar_preparo_do_procedimento = {
      data: { versao_id: NOVA, versao: 3, texto_sha256: SHA_V1 },
      error: null,
    };
  }

  it("só o RT vigente", async () => {
    papel("admin");
    expect(await aprovarDeNovoAction(DE_NOVO)).toEqual({
      ok: false,
      error: FRASES_SEM_PERMISSAO.aprovar,
      code: "sem_permissao",
    });
    expect(escritas()).toEqual([]);
  });

  it("com texto novo esperando o RT, recusa e não salva nada: salvar o texto antigo descartaria o novo (TELA-1)", async () => {
    papel("leitura", { rt: true });
    expect(await aprovarDeNovoAction(DE_NOVO)).toEqual({
      ok: false,
      error:
        "Há um texto novo esperando a sua aprovação. Feche e abra de novo para revisar o texto novo.",
      code: "texto_novo_aguardando",
    });
    expect(escritas()).toEqual([]);
  });

  it("salva o mesmo texto da última aprovada e aprova a versão nova, numa ação", async () => {
    semAguardando();
    papel("leitura", { rt: true });
    expect(await aprovarDeNovoAction(DE_NOVO)).toEqual({ ok: true });
    expect(escritas()).toEqual([
      "salvar_preparo_do_procedimento",
      "aprovar_preparo_do_procedimento",
    ]);
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
        args: { p_versao_id: NOVA, p_texto_sha256: SHA_V1 },
      },
    ]);
  });

  it("o banco recusa o conteúdo no salvar do aprovar de novo: nada aprovado, e a frase é a do aprovar", async () => {
    semAguardando();
    regras.semRecusas = true;
    estado.respostas.salvar_preparo_do_procedimento = {
      data: null,
      error: { code: "22023", message: "texto_recusado" },
    };
    papel("leitura", { rt: true });
    expect(await aprovarDeNovoAction(DE_NOVO)).toEqual({
      ok: false,
      error: `${T.naoPodeSerAprovado} ${T.textoRecusadoPeloBanco}`,
      code: "texto_recusado",
    });
    expect(escritas()).toEqual(["salvar_preparo_do_procedimento"]);
  });

  it("o texto do banco não é o que o RT leu: nada é gravado", async () => {
    semAguardando();
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

  it("o nome do procedimento não é o que a prévia mostrou: nada é gravado (TELA-11)", async () => {
    semAguardando();
    papel("leitura", { rt: true });
    expect(
      await aprovarDeNovoAction({ ...DE_NOVO, nomeLido: "Colono" }),
    ).toEqual({
      ok: false,
      error:
        "O nome do procedimento mudou enquanto você lia. Feche e abra de novo.",
      code: "nome_mudou",
    });
    expect(escritas()).toEqual([]);
  });

  it("procedimento de outra clínica: nada é gravado", async () => {
    semAguardando();
    papel("leitura", { rt: true });
    expect(
      await aprovarDeNovoAction({ ...DE_NOVO, procedureId: PROC_DE_FORA }),
    ).toEqual({ ok: false, error: "Procedimento não encontrado." });
    expect(escritas()).toEqual([]);
  });

  it("o texto aprovado antes que as regras de hoje recusam não é aprovado de novo (CFM-2)", async () => {
    semAguardando();
    const v1 = estado.tabelas.preparo_do_procedimento?.find((v) => v.id === V1);
    if (v1) {
      v1.texto = "Jejum de 8 horas. O exame custa R$ 250,00.";
    }
    papel("leitura", { rt: true });
    const resultado = await aprovarDeNovoAction(DE_NOVO);
    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? undefined : resultado.code).toBe("texto_recusado");
    expect(resultado.ok ? "" : resultado.error).toMatch(
      /^Este texto não pode ser aprovado\. No trecho “O exame custa R\$ 250,00\.”, tire o valor/,
    );
    expect(escritas()).toEqual([]);
  });

  it("a versão nova não é o texto lido (o hash): fica aguardando, sem aprovar", async () => {
    semAguardando();
    estado.respostas.salvar_preparo_do_procedimento = {
      data: { versao_id: NOVA, versao: 3, texto_sha256: SHA_NOVA },
      error: null,
    };
    papel("leitura", { rt: true });
    expect(await aprovarDeNovoAction(DE_NOVO)).toEqual({
      ok: false,
      error:
        "Não foi possível aprovar agora. O texto ficou aguardando o RT: feche e use Revisar e aprovar.",
      code: "ficou_aguardando",
    });
    expect(escritas()).toEqual(["salvar_preparo_do_procedimento"]);
  });

  it("a aprovação falhou depois de salvar: o texto ficou aguardando o RT", async () => {
    semAguardando();
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
    estado.respostas.aprovar_preparo_do_procedimento = {
      data: null,
      error: { code: "XX000", message: "qualquer coisa" },
    };
    expect(await aprovarDeNovoAction(DE_NOVO)).toEqual({
      ok: false,
      error: T.ficouAguardandoSemAprovar,
      code: "ficou_aguardando",
    });
  });

  it("sem o nome lido (a tela antiga), o Zod recusa antes de tudo", async () => {
    semAguardando();
    papel("leitura", { rt: true });
    expect(
      await aprovarDeNovoAction({
        procedureId: PROC,
        versaoLida: 2,
        textoSha256: SHA_V1,
      }),
    ).toEqual({
      ok: false,
      error: "Não foi possível aprovar agora. Tente de novo.",
    });
    expect(estado.rpcs).toEqual([]);
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
      recusa: null,
    });
    expect(await avisosDoPreparoAction({ versaoId: V_DE_FORA })).toEqual({
      ok: false,
      error: "Este texto não foi encontrado. Feche e abra de novo.",
    });
  });

  it("o texto que as regras de hoje recusam vem com a frase do que tirar (CFM-2)", async () => {
    estado.tabelas.preparo_do_procedimento?.push({
      id: V_ANTIGO,
      clinic_id: CLINICA,
      procedure_id: PROC,
      versao: 3,
      situacao: "aguardando_rt",
      texto: "Jejum de 8 horas. Veja o antes e depois no nosso Instagram.",
      texto_sha256: SHA_ANTIGO,
    });
    const resultado = await avisosDoPreparoAction({ versaoId: V_ANTIGO });
    expect(resultado.ok).toBe(true);
    expect(resultado.ok ? resultado.recusa : null).toMatch(
      /^No trecho “Veja o antes e depois no nosso Instagram\.”, tire a menção a antes e depois/,
    );
    expect(escritas()).toEqual([]);
  });
});

// Revisao curta da AG7 (CURTA-5): o texto aprovado que as regras de hoje
// recusam parava de sair em silencio, e a tela continuava "Aprovada". A
// action devolve, das versoes aprovadas e suspensas da clinica ativa, a frase
// da recusa; a secao mostra "Aprovada, sem envio" com ela.
describe("revisao curta da AG7 (CURTA-5): o texto aprovado que as regras de hoje recusam", () => {
  const PROMESSA =
    "Venha sem maquiagem. Resultado garantido, você vai sair renovada!";

  it("a action devolve so as aprovadas e suspensas da clinica ativa que as regras recusam, com a frase", async () => {
    const V3 = "5f5f5f5f-0000-4000-8000-000000000005";
    const V4 = "5f5f5f5f-0000-4000-8000-000000000006";
    const tabela = estado.tabelas.preparo_do_procedimento ?? [];
    tabela.push(
      {
        id: V3,
        clinic_id: CLINICA,
        procedure_id: PROC,
        versao: 3,
        situacao: "suspenso",
        texto: PROMESSA,
        texto_sha256: SHA_NOVA,
      },
      {
        id: V4,
        clinic_id: CLINICA,
        procedure_id: PROC,
        versao: 4,
        situacao: "aguardando_rt",
        texto: PROMESSA,
        texto_sha256: SHA_NOVA,
      },
      {
        id: V_ANTIGO,
        clinic_id: OUTRA_CLINICA,
        procedure_id: PROC_DE_FORA,
        versao: 2,
        situacao: "aprovado",
        texto: PROMESSA,
        texto_sha256: SHA_ANTIGO,
      },
    );
    const resultado = await recusasDosPreparosAction();
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) {
      return;
    }
    // V1 (jejum) passa, V4 espera o RT, V_ANTIGO e de outra clinica.
    expect(Object.keys(resultado.recusas)).toEqual([V3]);
    expect(resultado.recusas[V3]).toContain("tire a promessa de resultado");
    expect(resultado.recusas[V3]).toContain("Resultado garantido");
    // Nada e gravado.
    expect(escritas()).toEqual([]);
  });

  it("sem clinica ativa: a sessao expirou", async () => {
    sessao.active = null;
    expect(await recusasDosPreparosAction()).toEqual({
      ok: false,
      error: "Sessão expirada. Entre de novo.",
    });
  });

  it("recusasDasVersoesAprovadas: o texto sem leitura e a versao que nao foi aprovada ficam de fora", () => {
    expect(
      recusasDasVersoesAprovadas([
        { id: "a", situacao: "aprovado", texto: PROMESSA },
        { id: "b", situacao: "aprovado", texto: "Jejum de 8 horas." },
        { id: "c", situacao: "aprovado", texto: null },
        { id: "d", situacao: "devolvido", texto: PROMESSA },
        { id: "e", situacao: "suspenso", texto: "Veja em https://exemplo.com" },
      ]),
    ).toEqual({
      a: expect.stringContaining("promessa de resultado"),
      e: expect.stringContaining("link"),
    });
  });
});

// Revisao curta da AG7 (CURTA-6): o nome do procedimento com invisivel ou
// marca de direcao (colado de outro lugar) passa no Cadastros, e o banco o
// recusa no salvar do preparo (22023 nome_do_procedimento_invalido) com a
// frase que nao dizia o que tirar.
describe("revisao curta da AG7 (CURTA-6): o nome do procedimento com caractere invisível", () => {
  const FRASE =
    "Tire o caractere invisível do nome do procedimento, logo depois de “Colonoscopia”: apague e escreva de novo esse pedaço do nome, salve o procedimento e envie o texto de novo.";

  function nomeComInvisivel() {
    const procedimento = estado.tabelas.procedure?.find((p) => p.id === PROC);
    if (procedimento) {
      procedimento.name = "Colonoscopia\u200e";
    }
  }

  it("o salvar diz o que tirar, antes da RPC", async () => {
    nomeComInvisivel();
    expect(await salvarPreparoAction(SALVAR)).toEqual({
      ok: false,
      error: FRASE,
    });
    expect(escritas()).toEqual([]);
  });

  it("o nome_do_procedimento_invalido do banco no aprovar de novo vira a mesma frase", async () => {
    nomeComInvisivel();
    papel("profissional", { rt: true });
    const v2 = estado.tabelas.preparo_do_procedimento?.find((v) => v.id === V2);
    if (v2) {
      v2.situacao = "descartado";
    }
    estado.respostas.salvar_preparo_do_procedimento = {
      data: null,
      error: { code: "22023", message: "nome_do_procedimento_invalido" },
    };
    expect(
      await aprovarDeNovoAction({
        procedureId: PROC,
        versaoLida: 2,
        textoSha256: SHA_V1,
        nomeLido: "Colonoscopia\u200e",
      }),
    ).toEqual({ ok: false, error: FRASE });
  });

  it("o nome sem invisivel que o banco recusa continua com a frase de sempre", async () => {
    estado.respostas.salvar_preparo_do_procedimento = {
      data: null,
      error: { code: "22023", message: "nome_do_procedimento_invalido" },
    };
    expect(await salvarPreparoAction(SALVAR)).toEqual({
      ok: false,
      error:
        "Confira o nome do procedimento antes de escrever a orientação de preparo.",
    });
  });
});
