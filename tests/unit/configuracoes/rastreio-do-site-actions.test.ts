import { beforeEach, describe, expect, it, vi } from "vitest";

// As Server Actions do rastreio do site (F1 do Google, aba Anuncios do
// Google), com a sessao, o cliente do Supabase e o log trocados por dubles
// que guardam tudo o que a action mandou. O que se prova aqui:
//   - a guarda: so administrador e gestor chegam ao banco;
//   - o Zod estrito da entrada ({ ligar: boolean }, nada mais);
//   - ligar e update; sem linha, insert so de clinic_id e ativo; 23505 no
//     insert (criacao simultanea) refaz o update; NUNCA upsert (o ON CONFLICT
//     do PostgREST grava clinic_id, que a sessao nao pode atualizar);
//   - desligar sem linha nao cria linha nem audita;
//   - trocar a chave vai pela funcao do banco, com a sessao, e so aceita a
//     chave no formato do banco;
//   - 42501 vira texto de permissao; a chave nunca vai para log nem para a
//     trilha.
// As policies, os grants e as funcoes de verdade estao nos testes de RLS e
// integracao da frente do banco (tests/rls/clique-do-site.test.ts e
// tests/integration/clique-do-site.test.ts).

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";
const CHAVE_NOVA = "0123456789abcdef0123";

type Erro = { code?: string; message?: string } | null;
type Resultado = { data: unknown; error: Erro };
type Chamada = {
  tabela: string;
  op: "select" | "insert" | "upsert" | "update";
  valores?: Record<string, unknown>;
  filtros: [string, unknown][];
  colunas?: string;
};

const registro = vi.hoisted(() => ({
  papel: "admin" as string,
  comSessao: true,
  chamadas: [] as Chamada[],
  /** Respostas do update, em ordem (a ultima repete). */
  respostasDoUpdate: [] as Resultado[],
  respostaDoInsert: { data: null, error: null } as Resultado,
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  respostaDoRpc: { data: "0123456789abcdef0123", error: null } as Resultado,
  revalidados: [] as string[],
  logs: [] as [string, unknown][],
}));

function resultadoPara(c: Chamada): Resultado {
  if (c.tabela === "rastreio_do_site" && c.op === "update") {
    const fila = registro.respostasDoUpdate;
    return (
      (fila.length > 1 ? fila.shift() : fila[0]) ?? {
        data: [],
        error: null,
      }
    );
  }
  if (c.tabela === "rastreio_do_site" && c.op === "insert") {
    return registro.respostaDoInsert;
  }
  return { data: null, error: null };
}

type Cadeia = {
  select: (colunas?: string) => Cadeia;
  eq: (coluna: string, valor: unknown) => Cadeia;
  then: <T>(ok: (r: Resultado) => T, falha?: (e: unknown) => T) => Promise<T>;
};

function tabela(nome: string) {
  const comecar = (
    op: Chamada["op"],
    valores?: Record<string, unknown>,
  ): Cadeia => {
    const chamada: Chamada = { tabela: nome, op, valores, filtros: [] };
    const cadeia: Cadeia = {
      select: (colunas) => {
        chamada.colunas = colunas;
        return cadeia;
      },
      eq: (coluna, valor) => {
        chamada.filtros.push([coluna, valor]);
        return cadeia;
      },
      then: (ok, falha) => {
        registro.chamadas.push(chamada);
        return Promise.resolve(resultadoPara(chamada)).then(ok, falha);
      },
    };
    return cadeia;
  };
  return {
    select: () => comecar("select"),
    insert: (valores: Record<string, unknown>) => comecar("insert", valores),
    upsert: (valores: Record<string, unknown>) => comecar("upsert", valores),
    update: (valores: Record<string, unknown>) => comecar("update", valores),
  };
}

vi.mock("next/cache", () => ({
  revalidatePath: (caminho: string) => registro.revalidados.push(caminho),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (nome: string) => tabela(nome),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      registro.rpcs.push({ nome, args });
      return registro.respostaDoRpc;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("o rastreio do site nunca usa o cliente de servico");
  },
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () =>
    registro.comSessao
      ? {
          userId: USUARIO,
          active: {
            clinicId: CLINICA,
            role: registro.papel,
            status: "ativo",
            timezone: "America/Fortaleza",
          },
        }
      : null,
}));
vi.mock("@/lib/log", () => ({
  log: {
    info: (evento: string, campos: unknown) =>
      registro.logs.push([evento, campos]),
    warn: (evento: string, campos: unknown) =>
      registro.logs.push([evento, campos]),
    error: (evento: string, campos: unknown) =>
      registro.logs.push([evento, campos]),
  },
}));

const { alternarRastreioDoSiteAction, trocarChaveDoRastreioAction } =
  await import("@/app/(app)/configuracoes/rastreio-do-site-actions");

function chamadasDoRastreio(): Chamada[] {
  return registro.chamadas.filter((c) => c.tabela === "rastreio_do_site");
}

function auditorias(): Record<string, unknown>[] {
  return registro.chamadas
    .filter((c) => c.tabela === "audit_log")
    .map((c) => c.valores ?? {});
}

beforeEach(() => {
  registro.papel = "admin";
  registro.comSessao = true;
  registro.chamadas = [];
  registro.respostasDoUpdate = [
    { data: [{ clinic_id: CLINICA }], error: null },
  ];
  registro.respostaDoInsert = { data: null, error: null };
  registro.rpcs = [];
  registro.respostaDoRpc = { data: CHAVE_NOVA, error: null };
  registro.revalidados = [];
  registro.logs = [];
});

describe("alternarRastreioDoSiteAction: guarda e entrada", () => {
  it.each(["recepcao", "profissional", "leitura"])(
    "o papel %s não chega ao banco",
    async (papel) => {
      registro.papel = papel;
      const r = await alternarRastreioDoSiteAction({ ligar: true });
      expect(r).toEqual({
        ok: false,
        error: "Somente administradores e gestores alteram as configurações",
      });
      expect(registro.chamadas).toEqual([]);
    },
  );

  it("sem sessão pede para entrar de novo", async () => {
    registro.comSessao = false;
    const r = await alternarRastreioDoSiteAction({ ligar: true });
    expect(r).toEqual({ ok: false, error: "Sessão expirada. Entre de novo." });
    expect(registro.chamadas).toEqual([]);
  });

  it.each([
    ["sem o campo", {}],
    ["texto no lugar de booleano", { ligar: "true" }],
    ["campo a mais (Zod estrito)", { ligar: true, chave: "abc" }],
    ["nulo", null],
    ["booleano solto", true],
  ])("entrada inválida (%s) não chega ao banco", async (_caso, entrada) => {
    const r = await alternarRastreioDoSiteAction(entrada);
    expect(r).toEqual({
      ok: false,
      error: "Dados inválidos. Recarregue a página e tente de novo.",
    });
    expect(registro.chamadas).toEqual([]);
  });

  it("o gestor também liga", async () => {
    registro.papel = "gestor";
    const r = await alternarRastreioDoSiteAction({ ligar: true });
    expect(r).toEqual({ ok: true });
  });
});

describe("alternarRastreioDoSiteAction: banco", () => {
  it("com linha: só o update de ativo, da clínica da sessão, com select para contar", async () => {
    const r = await alternarRastreioDoSiteAction({ ligar: true });
    expect(r).toEqual({ ok: true });
    expect(chamadasDoRastreio()).toEqual([
      {
        tabela: "rastreio_do_site",
        op: "update",
        valores: { ativo: true },
        filtros: [["clinic_id", CLINICA]],
        colunas: "clinic_id",
      },
    ]);
    expect(auditorias()).toEqual([
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "ligou_rastreio_do_site",
        entity: "rastreio_do_site",
        entity_id: CLINICA,
      },
    ]);
    expect(registro.revalidados).toEqual(["/configuracoes"]);
  });

  it("sem linha, ligar cria só com clinic_id e ativo (a chave nasce no banco)", async () => {
    registro.respostasDoUpdate = [{ data: [], error: null }];
    const r = await alternarRastreioDoSiteAction({ ligar: true });
    expect(r).toEqual({ ok: true });
    const [update, insert] = chamadasDoRastreio();
    expect(update?.op).toBe("update");
    expect(insert).toEqual({
      tabela: "rastreio_do_site",
      op: "insert",
      valores: { clinic_id: CLINICA, ativo: true },
      filtros: [],
    });
    expect(auditorias().map((a) => a.action)).toEqual([
      "ligou_rastreio_do_site",
    ]);
  });

  it("23505 no insert (criação simultânea) refaz o update", async () => {
    registro.respostasDoUpdate = [
      { data: [], error: null },
      { data: [{ clinic_id: CLINICA }], error: null },
    ];
    registro.respostaDoInsert = { data: null, error: { code: "23505" } };
    const r = await alternarRastreioDoSiteAction({ ligar: true });
    expect(r).toEqual({ ok: true });
    expect(chamadasDoRastreio().map((c) => c.op)).toEqual([
      "update",
      "insert",
      "update",
    ]);
    expect(auditorias()).toHaveLength(1);
  });

  it("23505 e o update de novo sem linha: falha, sem auditoria", async () => {
    registro.respostasDoUpdate = [{ data: [], error: null }];
    registro.respostaDoInsert = { data: null, error: { code: "23505" } };
    const r = await alternarRastreioDoSiteAction({ ligar: true });
    expect(r).toEqual({
      ok: false,
      error: "Não foi possível alterar o rastreio do site. Tente de novo.",
    });
    expect(auditorias()).toEqual([]);
    expect(registro.revalidados).toEqual([]);
  });

  it("nunca usa upsert, em nenhum caminho", async () => {
    registro.respostasDoUpdate = [{ data: [], error: null }];
    await alternarRastreioDoSiteAction({ ligar: true });
    await alternarRastreioDoSiteAction({ ligar: false });
    registro.respostaDoInsert = { data: null, error: { code: "23505" } };
    await alternarRastreioDoSiteAction({ ligar: true });
    expect(registro.chamadas.some((c) => c.op === "upsert")).toBe(false);
  });

  it("desligar sem linha não cria linha nem audita", async () => {
    registro.respostasDoUpdate = [{ data: [], error: null }];
    const r = await alternarRastreioDoSiteAction({ ligar: false });
    expect(r).toEqual({ ok: true });
    expect(chamadasDoRastreio().map((c) => c.op)).toEqual(["update"]);
    expect(auditorias()).toEqual([]);
  });

  it("desligar com linha audita o desligamento", async () => {
    const r = await alternarRastreioDoSiteAction({ ligar: false });
    expect(r).toEqual({ ok: true });
    expect(chamadasDoRastreio()[0]?.valores).toEqual({ ativo: false });
    expect(auditorias().map((a) => a.action)).toEqual([
      "desligou_rastreio_do_site",
    ]);
  });

  it("42501 no update vira texto de permissão; o log leva só o código", async () => {
    registro.respostasDoUpdate = [
      { data: null, error: { code: "42501", message: "permission denied" } },
    ];
    const r = await alternarRastreioDoSiteAction({ ligar: true });
    expect(r).toEqual({
      ok: false,
      error: "Seu perfil não altera o rastreio do site.",
    });
    expect(registro.logs).toEqual([
      [
        "rastreio_do_site_nao_alterado",
        { clinic_id: CLINICA, error_code: "42501" },
      ],
    ]);
    expect(auditorias()).toEqual([]);
  });

  it("42501 no insert (policy) também vira texto de permissão", async () => {
    registro.respostasDoUpdate = [{ data: [], error: null }];
    registro.respostaDoInsert = { data: null, error: { code: "42501" } };
    const r = await alternarRastreioDoSiteAction({ ligar: true });
    expect(r).toEqual({
      ok: false,
      error: "Seu perfil não altera o rastreio do site.",
    });
  });

  it("outro erro vira texto genérico", async () => {
    registro.respostasDoUpdate = [{ data: null, error: { code: "57014" } }];
    const r = await alternarRastreioDoSiteAction({ ligar: true });
    expect(r).toEqual({
      ok: false,
      error: "Não foi possível alterar o rastreio do site. Tente de novo.",
    });
  });
});

describe("trocarChaveDoRastreioAction", () => {
  it("chama a função do banco pela sessão, com a clínica da sessão", async () => {
    const r = await trocarChaveDoRastreioAction();
    expect(r).toEqual({ ok: true, chave: CHAVE_NOVA });
    expect(registro.rpcs).toEqual([
      { nome: "trocar_chave_do_rastreio", args: { p_clinic_id: CLINICA } },
    ]);
    expect(registro.revalidados).toEqual(["/configuracoes"]);
  });

  it("audita sem a chave", async () => {
    await trocarChaveDoRastreioAction();
    expect(auditorias()).toEqual([
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "trocou_chave_do_rastreio",
        entity: "rastreio_do_site",
        entity_id: CLINICA,
      },
    ]);
    expect(JSON.stringify(auditorias())).not.toContain(CHAVE_NOVA);
  });

  it.each(["recepcao", "profissional", "leitura"])(
    "o papel %s não chega ao banco",
    async (papel) => {
      registro.papel = papel;
      const r = await trocarChaveDoRastreioAction();
      expect(r.ok).toBe(false);
      expect(registro.rpcs).toEqual([]);
    },
  );

  it("42501 da função vira texto de permissão, e a chave atual continua", async () => {
    registro.respostaDoRpc = { data: null, error: { code: "42501" } };
    const r = await trocarChaveDoRastreioAction();
    expect(r).toEqual({
      ok: false,
      error:
        "Seu perfil não gera chave nova para o rastreio do site. A chave atual continua valendo.",
    });
    expect(auditorias()).toEqual([]);
    expect(registro.logs).toEqual([
      [
        "rastreio_do_site_chave_nao_trocada",
        { clinic_id: CLINICA, error_code: "42501" },
      ],
    ]);
  });

  it.each([
    ["maiúsculas", "0123456789ABCDEF0123"],
    ["curta", "0123456789abcdef"],
    ["número", 12345],
    ["nula", null],
  ])("resposta fora do formato do banco (%s) não vale", async (_caso, data) => {
    registro.respostaDoRpc = { data, error: null };
    const r = await trocarChaveDoRastreioAction();
    expect(r).toEqual({
      ok: false,
      error:
        "Não foi possível gerar a chave nova. A chave atual continua valendo.",
    });
    expect(auditorias()).toEqual([]);
    if (typeof data === "string") {
      expect(JSON.stringify(registro.logs)).not.toContain(data);
    }
  });
});
