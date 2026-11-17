import { beforeEach, describe, expect, it, vi } from "vitest";

// salvarNumerosDoLinkAction (etapa 3b do plano de 16/11/2026: rodizio entre
// numeros do link rastreado), com a sessao e o cliente do Supabase trocados
// por dubles que guardam tudo o que a action mandou. O que se prova aqui:
//   - a guarda vem ANTES de qualquer leitura ou escrita: so administrador e
//     gestor chegam ao banco;
//   - o Zod recusa peso fora de 1 a 10, numero repetido e id que nao e id;
//   - a action tira os que sairam, muda so o peso que mudou e inclui os
//     novos, sempre com a clinica da SESSAO (nunca a do pedido);
//   - o 23503 (numero de outra clinica ou removido) vira frase de recepcao;
//   - a trilha leva so quem, o que e qual origem.
// As policies, os grants por coluna e a FK composta de verdade estao nos
// testes de RLS.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";
const ORIGEM = "b0000000-0000-4000-8000-00000000000b";
const N1 = "a1111111-1111-4111-8111-111111111111";
const N2 = "a2222222-2222-4222-8222-222222222222";
const N3 = "a3333333-3333-4333-8333-333333333333";

type Resultado = { data: unknown; error: { code?: string } | null };
type Chamada = {
  tabela: string;
  op: "select" | "insert" | "update" | "delete";
  valores?: unknown;
  filtros: [string, unknown][];
};

const registro = vi.hoisted(() => ({
  papel: "admin" as string,
  comSessao: true,
  chamadas: [] as Chamada[],
  origemExiste: true,
  atuais: [] as { whatsapp_account_id: string; peso: number }[],
  erroDoInsert: null as { code?: string } | null,
  revalidados: [] as string[],
}));

function resultadoPara(chamada: Chamada): Resultado {
  if (chamada.tabela === "campaign_link" && chamada.op === "select") {
    return {
      data: registro.origemExiste ? { id: ORIGEM } : null,
      error: null,
    };
  }
  if (chamada.tabela === "campaign_link" && chamada.op === "update") {
    return {
      data: registro.origemExiste ? [{ id: ORIGEM }] : [],
      error: null,
    };
  }
  if (chamada.tabela === "campaign_link_numero") {
    if (chamada.op === "select") {
      return { data: registro.atuais, error: null };
    }
    if (chamada.op === "insert") {
      return { data: null, error: registro.erroDoInsert };
    }
  }
  return { data: null, error: null };
}

function tabela(nome: string) {
  const comecar = (op: Chamada["op"], valores?: unknown) => {
    const chamada: Chamada = { tabela: nome, op, valores, filtros: [] };
    const responder = () => {
      registro.chamadas.push(chamada);
      return Promise.resolve(resultadoPara(chamada));
    };
    const cadeia = {
      select: () => cadeia,
      eq: (coluna: string, valor: unknown) => {
        chamada.filtros.push([coluna, valor]);
        return cadeia;
      },
      in: (coluna: string, valor: unknown) => {
        chamada.filtros.push([coluna, valor]);
        return cadeia;
      },
      maybeSingle: responder,
      then: <T>(ok: (r: Resultado) => T, falha?: (e: unknown) => T) =>
        responder().then(ok, falha),
    };
    return cadeia;
  };
  return {
    select: () => comecar("select"),
    insert: (valores: unknown) => comecar("insert", valores),
    update: (valores: unknown) => comecar("update", valores),
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
            implementador: false,
            status: "ativo",
            timezone: "America/Fortaleza",
          },
        }
      : null,
}));

const { definirAvisoDaMetaNoLinkAction, salvarNumerosDoLinkAction } =
  await import("@/app/(app)/configuracoes/regras-de-origem-actions");

const escritas = () =>
  registro.chamadas.filter((chamada) => chamada.op !== "select");

beforeEach(() => {
  registro.papel = "admin";
  registro.comSessao = true;
  registro.chamadas = [];
  registro.origemExiste = true;
  registro.atuais = [];
  registro.erroDoInsert = null;
  registro.revalidados = [];
});

describe("salvarNumerosDoLinkAction", () => {
  it("sem sessão ou sem papel de gestão: recusa antes de tocar no banco", async () => {
    registro.comSessao = false;
    expect(
      await salvarNumerosDoLinkAction({ id: ORIGEM, numeros: [] }),
    ).toMatchObject({ ok: false });
    registro.comSessao = true;
    for (const papel of ["recepcao", "leitura", "profissional"]) {
      registro.papel = papel;
      const resultado = await salvarNumerosDoLinkAction({
        id: ORIGEM,
        numeros: [{ id: N1, peso: 1 }],
      });
      expect(resultado.ok).toBe(false);
    }
    expect(registro.chamadas).toEqual([]);
  });

  it("entrada fora do formato: peso fora de 1 a 10, número repetido, id que não é id", async () => {
    for (const entrada of [
      { id: ORIGEM, numeros: [{ id: N1, peso: 0 }] },
      { id: ORIGEM, numeros: [{ id: N1, peso: 11 }] },
      { id: ORIGEM, numeros: [{ id: N1, peso: 1.5 }] },
      {
        id: ORIGEM,
        numeros: [
          { id: N1, peso: 1 },
          { id: N1, peso: 2 },
        ],
      },
      { id: ORIGEM, numeros: [{ id: "nao-e-id", peso: 1 }] },
      { id: "nao-e-id", numeros: [] },
      null,
    ]) {
      const resultado = await salvarNumerosDoLinkAction(entrada);
      expect(resultado).toEqual({
        ok: false,
        error: "Confira os números escolhidos e os pesos (de 1 a 10).",
      });
    }
    expect(registro.chamadas).toEqual([]);
  });

  it("origem que não existe mais (ou de outra clínica): não escreve nada", async () => {
    registro.origemExiste = false;
    const resultado = await salvarNumerosDoLinkAction({
      id: ORIGEM,
      numeros: [{ id: N1, peso: 1 }],
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Esta origem não existe mais. Recarregue a página.",
    });
    expect(escritas()).toEqual([]);
    // A origem e procurada na clinica da SESSAO.
    expect(registro.chamadas[0]?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", ORIGEM],
    ]);
  });

  it("tira quem saiu, muda só o peso que mudou e inclui o novo, com a clínica da sessão; grava a trilha", async () => {
    registro.atuais = [
      { whatsapp_account_id: N1, peso: 1 },
      { whatsapp_account_id: N2, peso: 2 },
      { whatsapp_account_id: N3, peso: 3 },
    ];
    const resultado = await salvarNumerosDoLinkAction({
      id: ORIGEM,
      numeros: [
        { id: N1, peso: 1 }, // igual: nenhuma escrita
        { id: N2, peso: 5 }, // peso mudou
        // N3 saiu
      ],
    });
    expect(resultado).toEqual({ ok: true });
    const feitas = escritas();
    expect(feitas.map((c) => [c.tabela, c.op])).toEqual([
      ["campaign_link_numero", "delete"],
      ["campaign_link_numero", "update"],
      ["audit_log", "insert"],
    ]);
    expect(feitas[0]?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["campaign_link_id", ORIGEM],
      ["whatsapp_account_id", [N3]],
    ]);
    expect(feitas[1]).toMatchObject({
      valores: { peso: 5 },
      filtros: [
        ["clinic_id", CLINICA],
        ["campaign_link_id", ORIGEM],
        ["whatsapp_account_id", N2],
      ],
    });
    expect(feitas[2]?.valores).toEqual({
      clinic_id: CLINICA,
      user_id: USUARIO,
      action: "definiu_numeros_do_link",
      entity: "campaign_link",
      entity_id: ORIGEM,
    });
    expect(registro.revalidados).toContain("/configuracoes");
  });

  it("número novo entra com o peso e a clínica da sessão; lista vazia volta ao número principal", async () => {
    expect(
      await salvarNumerosDoLinkAction({
        id: ORIGEM,
        numeros: [
          { id: N1, peso: 2 },
          { id: N2, peso: 1 },
        ],
      }),
    ).toEqual({ ok: true });
    expect(escritas()[0]).toMatchObject({
      tabela: "campaign_link_numero",
      op: "insert",
      valores: [
        {
          clinic_id: CLINICA,
          campaign_link_id: ORIGEM,
          whatsapp_account_id: N1,
          peso: 2,
        },
        {
          clinic_id: CLINICA,
          campaign_link_id: ORIGEM,
          whatsapp_account_id: N2,
          peso: 1,
        },
      ],
    });

    registro.chamadas = [];
    registro.atuais = [{ whatsapp_account_id: N1, peso: 2 }];
    expect(
      await salvarNumerosDoLinkAction({ id: ORIGEM, numeros: [] }),
    ).toEqual({ ok: true });
    expect(escritas().map((c) => c.op)).toEqual(["delete", "insert"]);
    expect(escritas()[1]?.tabela).toBe("audit_log");
  });

  it("número de outra clínica ou removido (23503): frase de recepção, sem trilha", async () => {
    registro.erroDoInsert = { code: "23503" };
    const resultado = await salvarNumerosDoLinkAction({
      id: ORIGEM,
      numeros: [{ id: N1, peso: 1 }],
    });
    expect(resultado).toEqual({
      ok: false,
      error:
        "Um dos números não existe mais nesta clínica. Recarregue a página.",
    });
    expect(escritas().some((c) => c.tabela === "audit_log")).toBe(false);
  });
});

// Etapa 3e: a chave "Avisar a Meta no clique" da origem.
describe("definirAvisoDaMetaNoLinkAction", () => {
  it("sem papel de gestão ou com entrada inválida: nada chega ao banco", async () => {
    registro.papel = "recepcao";
    expect(
      (await definirAvisoDaMetaNoLinkAction({ id: ORIGEM, ligado: true })).ok,
    ).toBe(false);
    registro.papel = "admin";
    for (const entrada of [
      { id: "nao-e-id", ligado: true },
      { id: ORIGEM, ligado: "sim" },
      { id: ORIGEM },
      null,
    ]) {
      expect((await definirAvisoDaMetaNoLinkAction(entrada)).ok).toBe(false);
    }
    expect(registro.chamadas).toEqual([]);
  });

  it("liga e desliga só a chave, na clínica da sessão, e grava a trilha", async () => {
    for (const ligado of [true, false]) {
      registro.chamadas = [];
      expect(
        await definirAvisoDaMetaNoLinkAction({ id: ORIGEM, ligado }),
      ).toEqual({ ok: true });
      const feitas = escritas();
      expect(feitas[0]).toMatchObject({
        tabela: "campaign_link",
        op: "update",
        valores: { avisar_meta_no_clique: ligado },
        filtros: [
          ["clinic_id", CLINICA],
          ["id", ORIGEM],
        ],
      });
      expect(feitas[1]?.valores).toMatchObject({
        action: ligado
          ? "ligou_aviso_da_meta_no_link"
          : "desligou_aviso_da_meta_no_link",
        entity_id: ORIGEM,
      });
    }
  });

  it("origem que não existe mais: avisa e não grava trilha", async () => {
    registro.origemExiste = false;
    expect(
      await definirAvisoDaMetaNoLinkAction({ id: ORIGEM, ligado: true }),
    ).toEqual({
      ok: false,
      error: "Esta origem não existe mais. Recarregue a página.",
    });
    expect(escritas().some((c) => c.tabela === "audit_log")).toBe(false);
  });
});
