import { beforeEach, describe, expect, it, vi } from "vitest";

// A marca de Implementador na sessao (onda 5, item 18; contrato B.2): lida
// numa consulta PROPRIA (membro_implementador do usuario), nunca por embed
// na leitura dos vinculos, e tolerante: se a tabela ainda nao existir ou a
// leitura falhar, o rotulo cai em "Administrador" e a sessao segue. So a
// falha de verdade (nao a tabela ausente) acende marcaDeImplementadorIndis-
// ponivel, que a exportacao dos leads usa para recusar na duvida. Banco e
// cookies falsos: nada de rede.

vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({
  linhas: [] as unknown[],
  marcas: { data: [] as unknown, error: null as unknown },
  marcaLanca: false,
  selecoes: [] as { tabela: string; colunas: string }[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "u0000000-0000-4000-8000-000000000001",
            email: "tecnico@agencia.test",
            user_metadata: { name: "Técnico" },
          },
        },
      }),
    },
    from: (tabela: string) => {
      if (tabela === "membro_implementador" && estado.marcaLanca) {
        throw new Error("cliente quebrado ao montar a consulta");
      }
      const consulta = {
        select: (colunas: string) => {
          estado.selecoes.push({ tabela, colunas });
          return consulta;
        },
        eq: () => consulta,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (
          ok: (valor: { data: unknown; error: unknown }) => unknown,
          falha?: (erro: unknown) => unknown,
        ) =>
          Promise.resolve(
            tabela === "clinic_member"
              ? { data: estado.linhas, error: null }
              : tabela === "membro_implementador"
                ? estado.marcas
                : { data: null, error: null },
          ).then(ok, falha),
      };
      return consulta;
    },
    rpc: async () => ({ data: [], error: null }),
  }),
}));

const { getSessionContext } = await import("@/lib/auth/active-clinic");

const CLINICA = "a1111111-1111-4111-8111-111111111111";
const OUTRA = "a2222222-2222-4222-8222-222222222222";

function vinculo(clinicId: string, role: string) {
  return {
    clinic_id: clinicId,
    role,
    status: "ativo",
    clinic: {
      id: clinicId,
      name: `Clínica ${clinicId.slice(0, 2)}`,
      slug: clinicId.slice(0, 2),
      timezone: "America/Fortaleza",
      clinic_branding: null,
    },
  };
}

beforeEach(() => {
  estado.linhas = [vinculo(CLINICA, "admin")];
  estado.marcas = { data: [], error: null };
  estado.marcaLanca = false;
  estado.selecoes = [];
});

describe("a marca de Implementador na sessão", () => {
  it("vem numa consulta própria, nunca no embed dos vínculos", async () => {
    await getSessionContext();
    const vinculos = estado.selecoes.find(
      (selecao) => selecao.tabela === "clinic_member",
    );
    expect(vinculos?.colunas).not.toContain("membro_implementador");
    expect(
      estado.selecoes.some((selecao) => selecao.tabela === "membro_implementador"),
    ).toBe(true);
  });

  it("administrador marcado vira Implementador só na clínica da marca", async () => {
    estado.linhas = [vinculo(CLINICA, "admin"), vinculo(OUTRA, "admin")];
    estado.marcas = { data: [{ clinic_id: CLINICA }], error: null };
    const sessao = await getSessionContext();
    const porClinica = Object.fromEntries(
      (sessao?.memberships ?? []).map((m) => [m.clinicId, m.implementador]),
    );
    expect(porClinica).toEqual({ [CLINICA]: true, [OUTRA]: false });
    expect(sessao?.marcaDeImplementadorIndisponivel).toBe(false);
  });

  it("a marca só vale com o vínculo admin", async () => {
    estado.linhas = [vinculo(CLINICA, "gestor")];
    estado.marcas = { data: [{ clinic_id: CLINICA }], error: null };
    const sessao = await getSessionContext();
    expect(sessao?.active?.implementador).toBe(false);
  });

  it("leitura que falha: ninguém é Implementador e a sessão segue", async () => {
    estado.marcas = { data: null, error: { code: "XX000", message: "falhou" } };
    const sessao = await getSessionContext();
    expect(sessao?.active?.clinicId).toBe(CLINICA);
    expect(sessao?.active?.implementador).toBe(false);
    expect(sessao?.vinculoIndisponivel).toBe(false);
    expect(sessao?.marcaDeImplementadorIndisponivel).toBe(true);
  });

  it("cliente que lança ao montar a consulta também não derruba a sessão", async () => {
    estado.marcaLanca = true;
    const sessao = await getSessionContext();
    expect(sessao?.active?.clinicId).toBe(CLINICA);
    expect(sessao?.active?.implementador).toBe(false);
    expect(sessao?.marcaDeImplementadorIndisponivel).toBe(true);
  });

  it.each(["PGRST205", "42P01"])(
    "tabela ainda ausente (%s): ninguém tem marca, sem indisponibilidade",
    async (codigo) => {
      estado.marcas = { data: null, error: { code: codigo, message: "x" } };
      const sessao = await getSessionContext();
      expect(sessao?.active?.implementador).toBe(false);
      expect(sessao?.marcaDeImplementadorIndisponivel).toBe(false);
    },
  );
});
