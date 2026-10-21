import { beforeEach, describe, expect, it, vi } from "vitest";

// Revisao da onda 5: normalizarTexto passou a tirar as marcas (\p{M}) e os
// invisiveis (\p{Cf}), e com eles o seletor de variacao U+FE0F e o U+20E3
// do emoji de tecla. Um termo-chave como o emoji de tecla do 1 (tres
// unidades, passa no min(2) do Zod) virava "1" e passaria a mover de etapa
// toda mensagem com o algarismo. O minimo de 2 vale agora tambem depois de
// normalizar, aqui na action (antes do banco, com mensagem de gente) e em
// etapaPorTermoChave (tests/unit/domain/normalizacao-sem-invisiveis.test.ts).
// Arquivo proprio, com o mesmo duble do cliente de
// etapa-da-jornada-action.test.ts.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";

const TECLA_1 = `1${String.fromCodePoint(0xfe0f)}${String.fromCodePoint(0x20e3)}`;

const registro = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
}));

type Resultado = { data: unknown; error: null };

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
    from: () => ({
      select: () => cadeia(() => ({ data: [], error: null })),
      update: (valores: Record<string, unknown>) => {
        registro.updates.push(valores);
        return cadeia(() => ({ data: [{ id: "etapa-1" }], error: null }));
      },
      insert: (valores: Record<string, unknown>) => {
        registro.inserts.push(valores);
        return cadeia(() => ({ data: { id: "etapa-nova" }, error: null }));
      },
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

const { salvarEtapaDaJornadaAction } =
  await import("@/app/(app)/configuracoes/actions");

function entrada(termos: string[]) {
  return {
    chave: "confirmou",
    nome: "Confirmou",
    tom: "info",
    icone: "message-square-text",
    descricao: null,
    termos_chave: termos,
    termos_de_quem: "qualquer",
    conversao: {
      meta_event_name: null,
      conversao_ativa: true,
      is_sale: false,
      is_first_contact: false,
      value_source: null,
      value_cents: null,
    },
  };
}

beforeEach(() => {
  registro.updates = [];
  registro.inserts = [];
});

describe("termo-chave curto demais depois de normalizar", () => {
  it("o emoji de tecla é recusado antes do banco, com mensagem de gente", async () => {
    // Passa no min(2) do texto cru: so a conta depois de normalizar pega.
    expect(TECLA_1.length).toBe(3);
    const resultado = await salvarEtapaDaJornadaAction(
      entrada(["ok", TECLA_1]),
    );
    expect(resultado).toEqual({
      ok: false,
      error:
        "Cada termo precisa de pelo menos 2 caracteres, sem contar acentos, marcas de emoji e caracteres invisíveis.",
    });
    expect(registro.updates).toEqual([]);
    expect(registro.inserts).toEqual([]);
  });

  it("letra com acento decomposto que sobra sozinha também é recusada", async () => {
    const resultado = await salvarEtapaDaJornadaAction(
      entrada([`e${String.fromCodePoint(0x301)}`]),
    );
    expect(resultado.ok).toBe(false);
    expect(registro.updates).toEqual([]);
  });

  it("termo de 2 caracteres depois de normalizar continua valendo", async () => {
    const resultado = await salvarEtapaDaJornadaAction(
      entrada(["ok", "sim", `${TECLA_1} confirmo`]),
    );
    expect(resultado).toEqual({ ok: true });
    expect(registro.updates[0]?.termos_chave).toEqual([
      "ok",
      "sim",
      `${TECLA_1} confirmo`,
    ]);
  });

  it("a mensagem não tem travessão", () => {
    expect(
      "Cada termo precisa de pelo menos 2 caracteres, sem contar acentos, marcas de emoji e caracteres invisíveis.",
    ).not.toMatch(/[\u2013\u2014]/);
  });
});
