import { beforeEach, describe, expect, it, vi } from "vitest";

// As Server Actions da aba "Origem dos leads" (onda 5, item 17; contrato
// A.2), com a sessao e o cliente do Supabase trocados por dubles que guardam
// tudo o que a action mandou. O que se prova aqui:
//   - a guarda vem ANTES de qualquer escrita (e de qualquer leitura): so
//     quem tem "tudo" em Configuracoes (administrador e gestor; o
//     Implementador entra como administrador) chega ao banco;
//   - o Zod e o mesmo do formulario, com o campo do problema;
//   - o codigo nasce na criacao, no alfabeto, em maiusculas, e o 23505
//     sorteia outro; a edicao nunca manda token nem active;
//   - mensagem pronta igual a de outra origem ativa recusa; palavra-chave
//     repetida so avisa; ate 50 ativas;
//   - o 23514 do banco vira texto de recepcao no campo certo;
//   - a trilha leva so quem, o que e qual linha: nunca a mensagem nem as
//     palavras-chave.
// As policies, os CHECKs e o gatilho do limite de verdade estao nos testes
// de RLS e integracao da frente do banco.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";
const NOVA = "a0000000-0000-4000-8000-00000000000a";
const EXISTENTE = "b0000000-0000-4000-8000-00000000000b";
const OUTRA = "c0000000-0000-4000-8000-00000000000c";

const MENSAGEM =
  "Olá! Vi o perfil da clínica no Instagram e quero agendar uma avaliação.";

type Erro = { code?: string; message?: string } | null;
type Resultado = { data: unknown; error: Erro };
type Chamada = {
  tabela: string;
  op: "select" | "insert" | "update" | "delete";
  valores?: Record<string, unknown>;
  filtros: [string, unknown][];
};
type Linha = Record<string, unknown>;

const registro = vi.hoisted(() => ({
  papel: "admin" as string,
  implementador: false,
  comSessao: true,
  chamadas: [] as Chamada[],
  origens: [] as Record<string, unknown>[],
  erroDaLeitura: null as { code?: string; message?: string } | null,
  respostasDoInsert: [] as { data: unknown; error: unknown }[],
  respostaDaEscrita: null as { data: unknown; error: unknown } | null,
  revalidados: [] as string[],
}));

function resultadoPara(chamada: Chamada): Resultado {
  if (chamada.tabela !== "campaign_link") {
    return { data: null, error: null };
  }
  if (chamada.op === "select") {
    return registro.erroDaLeitura
      ? { data: null, error: registro.erroDaLeitura }
      : { data: registro.origens, error: null };
  }
  if (chamada.op === "insert") {
    return (
      (registro.respostasDoInsert.shift() as Resultado | undefined) ?? {
        data: { id: NOVA },
        error: null,
      }
    );
  }
  return (
    (registro.respostaDaEscrita as Resultado | null) ?? {
      data: [{ id: EXISTENTE }],
      error: null,
    }
  );
}

type Cadeia = {
  select: (colunas?: string) => Cadeia;
  eq: (coluna: string, valor: unknown) => Cadeia;
  order: () => Cadeia;
  single: () => Promise<Resultado>;
  then: <T>(ok: (r: Resultado) => T, falha?: (e: unknown) => T) => Promise<T>;
};

function tabela(nome: string) {
  const comecar = (op: Chamada["op"], valores?: Record<string, unknown>) => {
    const chamada: Chamada = { tabela: nome, op, valores, filtros: [] };
    const responder = () => {
      registro.chamadas.push(chamada);
      return Promise.resolve(resultadoPara(chamada));
    };
    const cadeia: Cadeia = {
      select: () => cadeia,
      eq: (coluna, valor) => {
        chamada.filtros.push([coluna, valor]);
        return cadeia;
      },
      order: () => cadeia,
      single: responder,
      then: (ok, falha) => responder().then(ok, falha),
    };
    return cadeia;
  };
  return {
    select: () => comecar("select"),
    insert: (valores: Record<string, unknown>) => comecar("insert", valores),
    update: (valores: Record<string, unknown>) => comecar("update", valores),
    delete: () => comecar("delete"),
  };
}

vi.mock("next/cache", () => ({
  revalidatePath: (caminho: string) => registro.revalidados.push(caminho),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (nome: string) => tabela(nome) }),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () =>
    registro.comSessao
      ? {
          userId: USUARIO,
          active: {
            clinicId: CLINICA,
            role: registro.papel,
            implementador: registro.implementador,
            status: "ativo",
            timezone: "America/Fortaleza",
          },
        }
      : null,
}));

const {
  ativarRegraDeOrigemAction,
  desativarRegraDeOrigemAction,
  excluirRegraDeOrigemAction,
  salvarRegraDeOrigemAction,
} = await import("@/app/(app)/configuracoes/regras-de-origem-actions");
const { ERRO_DA_MENSAGEM_CURTA, recusaDoLimite } = await import(
  "@/lib/domain/regras-de-origem"
);

function linha(campos: Linha = {}): Linha {
  return {
    id: EXISTENTE,
    name: "Link da bio",
    token: "K7Q2MX",
    channel: "redes_sociais",
    origin: "Instagram",
    medium: "Bio",
    campaign: null,
    default_message: MENSAGEM,
    keywords: [],
    active: true,
    created_at: "2026-10-21T12:00:00Z",
    ...campos,
  };
}

function entrada(campos: Record<string, unknown> = {}) {
  return {
    nome: "QR da recepção",
    canal: "offline",
    origem: "QR code",
    detalhe: "Recepção",
    campanha: "",
    mensagem: "Olá! Escaneei o QR code da recepção e quero marcar um horário.",
    palavras_chave: [],
    com_codigo: true,
    ...campos,
  };
}

const escritas = () =>
  registro.chamadas.filter(
    (chamada) => chamada.tabela === "campaign_link" && chamada.op !== "select",
  );
const trilha = () =>
  registro.chamadas
    .filter((chamada) => chamada.tabela === "audit_log")
    .map((chamada) => chamada.valores);

beforeEach(() => {
  registro.papel = "admin";
  registro.implementador = false;
  registro.comSessao = true;
  registro.chamadas = [];
  registro.origens = [];
  registro.erroDaLeitura = null;
  registro.respostasDoInsert = [];
  registro.respostaDaEscrita = null;
  registro.revalidados = [];
});

describe("a guarda vem antes de tudo", () => {
  it.each(["recepcao", "profissional", "leitura"])(
    "%s recebe a dica e nada vai ao banco",
    async (papel) => {
      registro.papel = papel;
      const acoes = [
        () => salvarRegraDeOrigemAction(entrada()),
        () => ativarRegraDeOrigemAction({ id: EXISTENTE }),
        () => desativarRegraDeOrigemAction({ id: EXISTENTE }),
        () => excluirRegraDeOrigemAction({ id: EXISTENTE }),
      ];
      for (const acao of acoes) {
        const resultado = await acao();
        expect(resultado).toEqual({
          ok: false,
          error: "Somente administradores e gestores alteram as configurações",
        });
      }
      expect(registro.chamadas).toEqual([]);
    },
  );

  it("sem sessão, pede para entrar de novo", async () => {
    registro.comSessao = false;
    expect(await salvarRegraDeOrigemAction(entrada())).toEqual({
      ok: false,
      error: "Sessão expirada. Entre de novo.",
    });
    expect(registro.chamadas).toEqual([]);
  });

  it.each([
    ["gestor", false],
    ["admin", true],
  ])("%s (Implementador: %s) cadastra", async (papel, implementador) => {
    registro.papel = papel;
    registro.implementador = implementador;
    expect((await salvarRegraDeOrigemAction(entrada())).ok).toBe(true);
  });
});

describe("criar", () => {
  it("com código: no alfabeto, em maiúsculas, gravado com a origem", async () => {
    const resultado = await salvarRegraDeOrigemAction(entrada());
    expect(resultado).toMatchObject({ ok: true, id: NOVA });
    const [insert] = escritas();
    expect(insert?.op).toBe("insert");
    const token = insert?.valores?.token as string;
    expect(token).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(resultado.ok && resultado.codigo).toBe(token);
    expect(insert?.valores).toMatchObject({
      clinic_id: CLINICA,
      name: "QR da recepção",
      channel: "offline",
      origin: "QR code",
      medium: "Recepção",
      campaign: null,
      keywords: [],
    });
    expect(insert?.valores).not.toHaveProperty("active");
    expect(registro.revalidados).toEqual(["/configuracoes", "/leads"]);
  });

  it("sem código: token nulo", async () => {
    await salvarRegraDeOrigemAction(entrada({ com_codigo: false }));
    expect(escritas()[0]?.valores?.token).toBeNull();
  });

  it("código repetido (23505) sorteia outro, até 3 vezes", async () => {
    registro.respostasDoInsert = [
      { data: null, error: { code: "23505", message: "duplicate key" } },
    ];
    const resultado = await salvarRegraDeOrigemAction(entrada());
    expect(resultado.ok).toBe(true);
    expect(escritas().filter((chamada) => chamada.op === "insert")).toHaveLength(2);

    registro.chamadas = [];
    registro.respostasDoInsert = Array.from({ length: 3 }, () => ({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    }));
    expect(await salvarRegraDeOrigemAction(entrada())).toEqual({
      ok: false,
      error: "Não foi possível gerar um código único. Tente de novo.",
    });
    expect(trilha()).toEqual([]);
  });

  it("a trilha leva só quem, o que e qual linha", async () => {
    await salvarRegraDeOrigemAction(
      entrada({ palavras_chave: ["recepção", "escaneei"] }),
    );
    expect(trilha()).toEqual([
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "criou_regra_de_origem",
        entity: "campaign_link",
        entity_id: NOVA,
      },
    ]);
    expect(JSON.stringify(trilha())).not.toContain("Escaneei");
    expect(JSON.stringify(trilha())).not.toContain("escaneei");
  });

  it("Zod recusa no campo certo, antes do banco", async () => {
    const resultado = await salvarRegraDeOrigemAction(
      entrada({ mensagem: "Bom dia" }),
    );
    expect(resultado).toEqual({
      ok: false,
      error: ERRO_DA_MENSAGEM_CURTA,
      campo: "mensagem",
    });
    expect(registro.chamadas).toEqual([]);
  });

  it("o 23514 do banco vira texto de recepção no campo certo", async () => {
    registro.respostasDoInsert = [
      {
        data: null,
        error: {
          code: "23514",
          message:
            'new row for relation "campaign_link" violates check constraint "campaign_link_palavras_no_formato"',
        },
      },
    ];
    const resultado = await salvarRegraDeOrigemAction(entrada());
    expect(resultado).toMatchObject({ ok: false, campo: "palavras_chave" });
    expect(resultado.ok ? "" : resultado.error).not.toContain("campaign_link");
  });

  it("o limite do banco (P0001) vira a frase do limite", async () => {
    registro.respostasDoInsert = [
      { data: null, error: { code: "P0001", message: "limite_de_origens_ativas" } },
    ];
    expect(await salvarRegraDeOrigemAction(entrada())).toEqual({
      ok: false,
      error: recusaDoLimite("criar"),
    });
  });

  it("mensagem pronta igual à de outra origem ativa recusa, sem gravar", async () => {
    registro.origens = [linha({ name: "Link da bio" })];
    const resultado = await salvarRegraDeOrigemAction(
      entrada({
        mensagem:
          "ola!  vi o perfil da CLINICA no instagram e quero agendar uma avaliacao.",
      }),
    );
    expect(resultado).toEqual({
      ok: false,
      error: "Esta mensagem já reconhece a origem Link da bio.",
      campo: "mensagem",
    });
    expect(escritas()).toEqual([]);
  });

  it("a mesma mensagem numa origem desativada não impede", async () => {
    registro.origens = [linha({ active: false })];
    expect(
      (await salvarRegraDeOrigemAction(entrada({ mensagem: MENSAGEM }))).ok,
    ).toBe(true);
  });

  it("palavra-chave repetida em outra origem ativa só avisa", async () => {
    registro.origens = [linha({ keywords: ["Recepção"] })];
    const resultado = await salvarRegraDeOrigemAction(
      entrada({ palavras_chave: ["recepcao"] }),
    );
    expect(resultado).toMatchObject({
      ok: true,
      aviso:
        "A palavra-chave recepcao também está na origem Link da bio. Vale a palavra mais longa e, no empate, a origem cadastrada primeiro.",
    });
  });

  it("com 50 origens ativas, recusa antes de gravar (P17-8)", async () => {
    registro.origens = Array.from({ length: 50 }, (_, i) =>
      linha({
        id: `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        default_message: `Mensagem pronta numero ${i} do link`,
      }),
    );
    expect(await salvarRegraDeOrigemAction(entrada())).toEqual({
      ok: false,
      error: recusaDoLimite("criar"),
    });
    expect(escritas()).toEqual([]);
  });

  it("leitura das origens que falha para a action, sem gravar", async () => {
    registro.erroDaLeitura = { code: "XX000", message: "falhou" };
    expect(await salvarRegraDeOrigemAction(entrada())).toEqual({
      ok: false,
      error: "Não foi possível conferir as origens cadastradas. Tente de novo.",
    });
    expect(escritas()).toEqual([]);
  });
});

describe("editar", () => {
  it("só o conteúdo: nunca o código nem a situação", async () => {
    registro.origens = [linha()];
    const resultado = await salvarRegraDeOrigemAction(
      entrada({ id: EXISTENTE, com_codigo: false }),
    );
    expect(resultado).toEqual({ ok: true, id: EXISTENTE });
    const [update] = escritas();
    expect(update?.op).toBe("update");
    expect(update?.valores).not.toHaveProperty("token");
    expect(update?.valores).not.toHaveProperty("active");
    expect(update?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", EXISTENTE],
    ]);
    expect(trilha()[0]).toMatchObject({
      action: "editou_regra_de_origem",
      entity_id: EXISTENTE,
    });
  });

  it("vale o código do banco: com código, pode ficar sem mensagem e sem palavra", async () => {
    registro.origens = [linha()];
    expect(
      (
        await salvarRegraDeOrigemAction(
          entrada({ id: EXISTENTE, mensagem: "", com_codigo: true }),
        )
      ).ok,
    ).toBe(true);

    registro.origens = [linha({ token: null })];
    expect(
      await salvarRegraDeOrigemAction(
        entrada({ id: EXISTENTE, mensagem: "", com_codigo: true }),
      ),
    ).toMatchObject({ ok: false, campo: "mensagem" });
  });

  it("a própria mensagem não conta como conflito", async () => {
    registro.origens = [linha()];
    expect(
      (
        await salvarRegraDeOrigemAction(
          entrada({ id: EXISTENTE, mensagem: MENSAGEM }),
        )
      ).ok,
    ).toBe(true);
  });

  it("origem que não existe mais", async () => {
    registro.origens = [];
    expect(
      await salvarRegraDeOrigemAction(entrada({ id: EXISTENTE })),
    ).toEqual({
      ok: false,
      error: "Esta origem não existe mais. Recarregue a página.",
    });
    expect(escritas()).toEqual([]);
  });
});

describe("ativar, desativar e excluir", () => {
  it("ativar: confere a mensagem de outra ativa e o limite, depois grava", async () => {
    registro.origens = [
      linha({ id: OUTRA, name: "QR antigo" }),
      linha({ active: false }),
    ];
    expect(await ativarRegraDeOrigemAction({ id: EXISTENTE })).toEqual({
      ok: false,
      error:
        "Esta mensagem já reconhece a origem QR antigo. Desative a outra antes de ativar esta.",
    });
    expect(escritas()).toEqual([]);

    registro.origens = [
      linha({ id: OUTRA, default_message: "Outra mensagem pronta do link aqui" }),
      linha({ active: false }),
    ];
    expect(await ativarRegraDeOrigemAction({ id: EXISTENTE })).toEqual({
      ok: true,
      id: EXISTENTE,
    });
    const [update] = escritas();
    expect(update?.valores).toEqual({ active: true });
    expect(update?.filtros).toContainEqual(["active", false]);
    expect(trilha()[0]).toMatchObject({ action: "ativou_regra_de_origem" });
  });

  it("ativar com 50 ativas recusa", async () => {
    registro.origens = [
      ...Array.from({ length: 50 }, (_, i) =>
        linha({
          id: `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          default_message: `Mensagem pronta numero ${i} do link`,
        }),
      ),
      linha({ active: false }),
    ];
    expect(await ativarRegraDeOrigemAction({ id: EXISTENTE })).toEqual({
      ok: false,
      error: recusaDoLimite("ativar"),
    });
  });

  it("desativar grava active falso e a trilha", async () => {
    expect(await desativarRegraDeOrigemAction({ id: EXISTENTE })).toEqual({
      ok: true,
      id: EXISTENTE,
    });
    expect(escritas()[0]).toMatchObject({
      op: "update",
      valores: { active: false },
    });
    expect(trilha()[0]).toMatchObject({ action: "desativou_regra_de_origem" });
  });

  it("excluir apaga a linha e grava a trilha; id inválido nem chega ao banco", async () => {
    expect(await excluirRegraDeOrigemAction({ id: EXISTENTE })).toEqual({
      ok: true,
      id: EXISTENTE,
    });
    expect(escritas()[0]?.op).toBe("delete");
    expect(trilha()[0]).toMatchObject({
      action: "excluiu_regra_de_origem",
      entity: "campaign_link",
      entity_id: EXISTENTE,
    });

    registro.chamadas = [];
    expect(await excluirRegraDeOrigemAction({ id: "x" })).toEqual({
      ok: false,
      error: "Origem inválida.",
    });
    expect(registro.chamadas).toEqual([]);
  });

  it("nenhuma linha devolvida: a origem sumiu ou ja estava assim", async () => {
    registro.respostaDaEscrita = { data: [], error: null };
    expect(await excluirRegraDeOrigemAction({ id: EXISTENTE })).toEqual({
      ok: false,
      error: "Esta origem não existe mais. Recarregue a página.",
    });
    expect(await desativarRegraDeOrigemAction({ id: EXISTENTE })).toEqual({
      ok: false,
      error: "Esta origem já estava desativada. Recarregue a página.",
    });
    expect(trilha()).toEqual([]);
  });
});
