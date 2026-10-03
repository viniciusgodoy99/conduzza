import { beforeEach, describe, expect, it, vi } from "vitest";

// As actions de etapa da Jornada com os campos de 02/10/2026 ("quem escreve
// o termo" e a descricao do Kanban), com a sessao e o cliente do Supabase
// trocados por dubles que guardam o que a action mandou gravar. O que se
// prova aqui:
//   - termos_de_quem e descricao chegam ao update e ao insert;
//   - descricao vazia ou so de espacos vai como null (o check do banco
//     recusa string vazia) e espacos sao colapsados;
//   - descricao acima de 140 e quem escreve fora do catalogo sao recusados
//     antes do banco, com mensagem de gente para a descricao;
//   - a recusa da etapa com regua de follow-up vira mensagem que diz o que
//     fazer (antes caia no generico);
//   - etapa e etiqueta usadas por automacao de fluxo: a recusa vem pelo hint
//     que o banco devolve (etapa_usada_por_automacao e
//     etiqueta_usada_por_automacao) e vira mensagem que diz onde resolver.
// A RLS e os checks de verdade estao em tests/rls/crm-leva-a.test.ts.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";

type ErroFalso = { message: string; code?: string; hint?: string };
type Resultado = { data: unknown; error: ErroFalso | null };

const registro = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  inserts: [] as { tabela: string; valores: Record<string, unknown> }[],
  erroDoDelete: null as ErroFalso | null,
}));

function cadeia(resultado: () => Resultado) {
  const alvo: Record<string, unknown> = {};
  for (const metodo of ["eq", "select", "order"]) {
    alvo[metodo] = () => alvo;
  }
  alvo.single = () => Promise.resolve(resultado());
  alvo.then = (ok: (valor: Resultado) => unknown) =>
    Promise.resolve(resultado()).then(ok);
  return alvo;
}

function cliente() {
  return {
    from: (tabela: string) => ({
      select: () =>
        cadeia(() => ({
          data: [
            { chave: "novo", posicao: 10 },
            { chave: "perdido", posicao: 60 },
          ],
          error: null,
        })),
      update: (valores: Record<string, unknown>) => {
        registro.updates.push(valores);
        return cadeia(() => ({ data: [{ id: "etapa-1" }], error: null }));
      },
      insert: (valores: Record<string, unknown>) => {
        registro.inserts.push({ tabela, valores });
        return cadeia(() => ({ data: { id: "etapa-nova" }, error: null }));
      },
      delete: () =>
        cadeia(() =>
          registro.erroDoDelete
            ? { data: null, error: registro.erroDoDelete }
            : { data: [{ id: "etapa-1" }], error: null },
        ),
    }),
  };
}

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cliente(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => cliente() }));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => ({
    userId: USUARIO,
    active: { clinicId: CLINICA, role: "gestor", status: "ativo" },
  }),
}));

const {
  salvarEtapaDaJornadaAction,
  excluirEtapaDaJornadaAction,
  excluirEtiquetaDeConversaAction,
} = await import("@/app/(app)/configuracoes/actions");
const { RECUSA_DA_ETAPA_USADA, RECUSA_DA_ETIQUETA_USADA } =
  await import("@/lib/domain/automacoes-de-fluxo");

function entrada(campos: Record<string, unknown> = {}) {
  return {
    chave: "em_contato",
    nome: "Em contato",
    tom: "info",
    icone: "message-square-text",
    descricao: null,
    termos_chave: ["seja bem-vinda"],
    termos_de_quem: "clinica",
    conversao: {
      meta_event_name: null,
      conversao_ativa: true,
      is_sale: false,
      is_first_contact: false,
      value_source: null,
      value_cents: null,
    },
    ...campos,
  };
}

beforeEach(() => {
  registro.updates = [];
  registro.inserts = [];
  registro.erroDoDelete = null;
});

describe("salvarEtapaDaJornadaAction: quem escreve e descrição", () => {
  it("editar grava quem escreve o termo e a descrição normalizada", async () => {
    const resultado = await salvarEtapaDaJornadaAction(
      entrada({ descricao: "  Recebeu as boas-vindas\n da recepção  " }),
    );

    expect(resultado).toEqual({ ok: true });
    expect(registro.updates).toHaveLength(1);
    expect(registro.updates[0]).toMatchObject({
      termos_de_quem: "clinica",
      descricao: "Recebeu as boas-vindas da recepção",
      termos_chave: ["seja bem-vinda"],
    });
  });

  it("descrição vazia ou só de espaços vai como null, nunca string vazia", async () => {
    for (const vazia of ["", "   ", "\n\t", null]) {
      registro.updates = [];
      const resultado = await salvarEtapaDaJornadaAction(
        entrada({ descricao: vazia }),
      );
      expect(resultado).toEqual({ ok: true });
      expect(registro.updates[0]!.descricao).toBeNull();
    }
  });

  it("criar etapa também grava os dois campos", async () => {
    const resultado = await salvarEtapaDaJornadaAction(
      entrada({
        chave: null,
        nome: "Boas-vindas",
        termos_de_quem: "qualquer",
        descricao: "Lead que recebeu a mensagem de boas-vindas",
      }),
    );

    expect(resultado).toEqual({ ok: true });
    const etapa = registro.inserts.find(
      (insert) => insert.tabela === "funnel_stage_def",
    );
    expect(etapa?.valores).toMatchObject({
      clinic_id: CLINICA,
      chave: "boas_vindas",
      termos_de_quem: "qualquer",
      descricao: "Lead que recebeu a mensagem de boas-vindas",
    });
  });

  it("descrição acima de 140 é recusada antes do banco, com mensagem de gente", async () => {
    const resultado = await salvarEtapaDaJornadaAction(
      entrada({ descricao: "a".repeat(141) }),
    );

    expect(resultado).toEqual({
      ok: false,
      error: "A descrição da etapa cabe em até 140 caracteres.",
    });
    expect(registro.updates).toEqual([]);
  });

  it("140 depois de colapsar os espaços passa", async () => {
    const resultado = await salvarEtapaDaJornadaAction(
      entrada({ descricao: `  ${"a".repeat(70)}     ${"b".repeat(69)}  ` }),
    );
    expect(resultado).toEqual({ ok: true });
    expect((registro.updates[0]!.descricao as string).length).toBe(140);
  });

  it("quem escreve fora do catálogo ou ausente é recusado", async () => {
    expect(
      await salvarEtapaDaJornadaAction(entrada({ termos_de_quem: "todos" })),
    ).toEqual({ ok: false, error: "Dados inválidos." });
    expect(
      await salvarEtapaDaJornadaAction(entrada({ termos_de_quem: undefined })),
    ).toEqual({ ok: false, error: "Dados inválidos." });
    expect(registro.updates).toEqual([]);
  });
});

describe("excluirEtapaDaJornadaAction: recusas do banco", () => {
  it("etapa com régua de follow-up: diz o que fazer, não o genérico", async () => {
    registro.erroDoDelete = {
      message: "Exclua a régua de follow-up desta etapa antes de excluí-la.",
    };

    expect(await excluirEtapaDaJornadaAction("em_contato")).toEqual({
      ok: false,
      error:
        "Esta etapa tem uma régua de follow-up. Exclua a régua em Automações antes de excluir a etapa.",
    });
  });

  it("recusa sem tradução continua no genérico", async () => {
    registro.erroDoDelete = { message: "erro qualquer do banco" };

    expect(await excluirEtapaDaJornadaAction("em_contato")).toEqual({
      ok: false,
      error: "Não foi possível excluir a etapa.",
    });
  });
});

describe("etapa e etiqueta usadas por automação de fluxo", () => {
  // O que o banco devolve (proteger_jornada e proteger_etiqueta_de_conversa,
  // migration 20261002130000): P0001 com o hint.
  const recusaDaEtapa: ErroFalso = {
    code: "P0001",
    message:
      "Esta etapa é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etapa.",
    hint: "etapa_usada_por_automacao",
  };
  const recusaDaEtiqueta: ErroFalso = {
    code: "P0001",
    message:
      "Esta etiqueta é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etiqueta.",
    hint: "etiqueta_usada_por_automacao",
  };

  it("excluir etapa usada: diz que é a automação e onde resolver", async () => {
    registro.erroDoDelete = recusaDaEtapa;
    const resultado = await excluirEtapaDaJornadaAction("em_contato");
    expect(resultado).toEqual({ ok: false, error: RECUSA_DA_ETAPA_USADA });
    expect(resultado.error).toContain("aba Automações de fluxo");
  });

  it("vale pelo código do banco, mesmo com outra mensagem", async () => {
    registro.erroDoDelete = {
      code: "P0001",
      message: "texto que mudou",
      hint: "etapa_usada_por_automacao",
    };
    expect(await excluirEtapaDaJornadaAction("em_contato")).toEqual({
      ok: false,
      error: RECUSA_DA_ETAPA_USADA,
    });
  });

  it("vale pela mensagem quando o hint não chega", async () => {
    registro.erroDoDelete = { message: recusaDaEtapa.message };
    expect(await excluirEtapaDaJornadaAction("em_contato")).toEqual({
      ok: false,
      error: RECUSA_DA_ETAPA_USADA,
    });
  });

  it("excluir etiqueta usada: diz que é a automação e onde resolver", async () => {
    registro.erroDoDelete = recusaDaEtiqueta;
    const resultado = await excluirEtiquetaDeConversaAction("retorno");
    expect(resultado).toEqual({ ok: false, error: RECUSA_DA_ETIQUETA_USADA });
    expect(resultado.error).toContain("aba Automações de fluxo");
  });

  it("etiqueta pelo código do banco, mesmo com outra mensagem", async () => {
    registro.erroDoDelete = {
      code: "P0001",
      message: "texto que mudou",
      hint: "etiqueta_usada_por_automacao",
    };
    expect(await excluirEtiquetaDeConversaAction("retorno")).toEqual({
      ok: false,
      error: RECUSA_DA_ETIQUETA_USADA,
    });
  });

  it("outra recusa da etiqueta continua no genérico", async () => {
    registro.erroDoDelete = { code: "42501", message: "permission denied" };
    expect(await excluirEtiquetaDeConversaAction("retorno")).toEqual({
      ok: false,
      error: "Não foi possível excluir a etiqueta.",
    });
  });

  it("a hint da etiqueta não vira a mensagem da etapa (e vice-versa)", async () => {
    registro.erroDoDelete = recusaDaEtiqueta;
    expect((await excluirEtapaDaJornadaAction("em_contato")).error).not.toBe(
      RECUSA_DA_ETAPA_USADA,
    );
    registro.erroDoDelete = recusaDaEtapa;
    expect((await excluirEtiquetaDeConversaAction("retorno")).error).toBe(
      "Não foi possível excluir a etiqueta.",
    );
  });
});
