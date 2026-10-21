import { beforeEach, describe, expect, it, vi } from "vitest";

// A sessao com a conta suspensa (onda 1, decisao do dono de 20/10/2026):
// a RLS de clinic deixa de mostrar a clinica suspensa a quem nao e super
// admin, entao o vinculo ATIVO volta sem a clinica no embed; o nome vem de
// minhas_clinicas_suspensas (so nesse caso: quem esta numa clinica normal
// nao paga ida nenhuma a mais). O vinculo vira status 'suspensa', nunca a
// clinica ativa, e clinicaSuspensa diz o que o layout avisa. O super admin
// le a clinica como qualquer outra e entra normalmente. Banco e cookies
// falsos: nada de rede.

vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({
  linhas: [] as unknown[],
  erroDosVinculos: null as unknown,
  superAdmin: false,
  cookie: undefined as string | undefined,
  suspensas: { data: [] as unknown, error: null as unknown },
  pendentes: { data: [] as unknown, error: null as unknown },
  rpcs: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === "conduzza-clinica-ativa" && estado.cookie !== undefined
        ? { name: nome, value: estado.cookie }
        : undefined,
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "u0000000-0000-4000-8000-000000000001",
            email: "ana@clinica.test",
            user_metadata: { name: "Ana" },
          },
        },
      }),
    },
    from: (tabela: string) => {
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        maybeSingle: async () =>
          tabela === "product_admin"
            ? {
                data: estado.superAdmin ? { user_id: "u" } : null,
                error: null,
              }
            : { data: null, error: null },
        then: (
          ok: (valor: { data: unknown; error: unknown }) => unknown,
          falha?: (erro: unknown) => unknown,
        ) =>
          Promise.resolve(
            tabela === "clinic_member"
              ? { data: estado.linhas, error: estado.erroDosVinculos }
              : { data: null, error: null },
          ).then(ok, falha),
      };
      return consulta;
    },
    rpc: async (nome: string) => {
      estado.rpcs.push(nome);
      if (nome === "minhas_clinicas_suspensas") {
        return estado.suspensas;
      }
      if (nome === "minhas_clinicas_pendentes") {
        return estado.pendentes;
      }
      return { data: null, error: null };
    },
  }),
}));

const { getSessionContext } = await import("@/lib/auth/active-clinic");

const ATIVA = "a1111111-1111-4111-8111-111111111111";
const OUTRA_ATIVA = "a2222222-2222-4222-8222-222222222222";
const SUSPENSA = "b3333333-3333-4333-8333-333333333333";
const PENDENTE = "c4444444-4444-4444-8444-444444444444";

/** Vinculo com a clinica visivel (a RLS mostra). */
function vinculoVisivel(clinicId: string, nome: string) {
  return {
    clinic_id: clinicId,
    role: "recepcao",
    status: "ativo",
    clinic: {
      id: clinicId,
      name: nome,
      slug: nome.toLowerCase(),
      timezone: "America/Fortaleza",
      clinic_branding: null,
    },
  };
}

/** Vinculo ativo numa clinica suspensa: a RLS esconde a clinica. */
function vinculoDaSuspensa(clinicId = SUSPENSA) {
  return { clinic_id: clinicId, role: "admin", status: "ativo", clinic: null };
}

function suspensasDoBanco(...ids: string[]) {
  return {
    data: ids.map((id) => ({
      clinic_id: id,
      nome: "Clínica Suspensa",
      suspensa_em: "2026-10-20T12:00:00Z",
    })),
    error: null,
  };
}

beforeEach(() => {
  estado.linhas = [];
  estado.erroDosVinculos = null;
  estado.superAdmin = false;
  estado.cookie = undefined;
  estado.suspensas = suspensasDoBanco(SUSPENSA);
  estado.pendentes = { data: [], error: null };
  estado.rpcs = [];
});

describe("sessão com a conta suspensa", () => {
  it("clínica normal: nenhuma ida a mais ao banco, nada a avisar", async () => {
    estado.linhas = [vinculoVisivel(ATIVA, "Clínica Ativa")];
    const sessao = await getSessionContext();
    expect(sessao?.active?.clinicId).toBe(ATIVA);
    expect(sessao?.clinicaSuspensa).toBeNull();
    expect(estado.rpcs).toEqual([]);
  });

  it("a única clínica está suspensa: o vínculo vira 'suspensa', nunca a ativa, e é o aviso", async () => {
    estado.linhas = [vinculoDaSuspensa()];
    const sessao = await getSessionContext();
    expect(estado.rpcs).toEqual(["minhas_clinicas_suspensas"]);
    expect(sessao?.active).toBeNull();
    expect(sessao?.clinicaSuspensa).toMatchObject({
      clinicId: SUSPENSA,
      clinicName: "Clínica Suspensa",
      status: "suspensa",
      role: "admin",
    });
    expect(sessao?.memberships.map((m) => m.status)).toEqual(["suspensa"]);
    expect(sessao?.vinculoIndisponivel).toBe(false);
  });

  it("escolheu a suspensa no cookie, mesmo com outra ativa: o aviso, e não a outra em silêncio", async () => {
    estado.linhas = [
      vinculoVisivel(ATIVA, "Clínica Ativa"),
      vinculoDaSuspensa(),
    ];
    estado.cookie = SUSPENSA;
    const sessao = await getSessionContext();
    expect(sessao?.active).toBeNull();
    expect(sessao?.clinicaSuspensa?.clinicId).toBe(SUSPENSA);
  });

  it("sem cookie, uma ativa e uma suspensa: entra na ativa, sem aviso", async () => {
    estado.linhas = [
      vinculoVisivel(ATIVA, "Clínica Ativa"),
      vinculoDaSuspensa(),
    ];
    const sessao = await getSessionContext();
    expect(sessao?.active?.clinicId).toBe(ATIVA);
    expect(sessao?.clinicaSuspensa).toBeNull();
  });

  it("cookie numa ativa: entra nela, mesmo tendo uma suspensa", async () => {
    estado.linhas = [
      vinculoVisivel(ATIVA, "Clínica Ativa"),
      vinculoVisivel(OUTRA_ATIVA, "Outra Ativa"),
      vinculoDaSuspensa(),
    ];
    estado.cookie = OUTRA_ATIVA;
    const sessao = await getSessionContext();
    expect(sessao?.active?.clinicId).toBe(OUTRA_ATIVA);
    expect(sessao?.clinicaSuspensa).toBeNull();
  });

  it("sem cookie e duas ativas: a escolha de clínica (a suspensa não entra nela)", async () => {
    estado.linhas = [
      vinculoVisivel(ATIVA, "Clínica Ativa"),
      vinculoVisivel(OUTRA_ATIVA, "Outra Ativa"),
      vinculoDaSuspensa(),
    ];
    const sessao = await getSessionContext();
    expect(sessao?.active).toBeNull();
    expect(sessao?.clinicaSuspensa).toBeNull();
    expect(
      sessao?.memberships
        .filter((m) => m.status === "ativo")
        .map((m) => m.clinicId),
    ).toEqual([ATIVA, OUTRA_ATIVA]);
  });

  it("pendente numa e suspensa noutra, sem nenhuma ativa: o aviso é o da suspensa", async () => {
    estado.linhas = [
      {
        clinic_id: PENDENTE,
        role: "recepcao",
        status: "pendente",
        clinic: null,
      },
      vinculoDaSuspensa(),
    ];
    estado.pendentes = {
      data: [{ clinic_id: PENDENTE, clinic_name: "Clínica Pendente" }],
      error: null,
    };
    const sessao = await getSessionContext();
    expect(sessao?.active).toBeNull();
    expect(sessao?.clinicaSuspensa?.clinicId).toBe(SUSPENSA);
    expect(sessao?.memberships.map((m) => m.status).sort()).toEqual([
      "pendente",
      "suspensa",
    ]);
  });

  it("o nome da suspensa não carregou: acesso que não carregou, nunca 'sem clínica'", async () => {
    estado.linhas = [vinculoDaSuspensa()];
    estado.suspensas = { data: null, error: { code: "57014" } };
    const sessao = await getSessionContext();
    expect(sessao?.vinculoIndisponivel).toBe(true);
    expect(sessao?.active).toBeNull();
  });

  it("super admin: lê a clínica suspensa como qualquer outra e entra normalmente", async () => {
    estado.superAdmin = true;
    // Para o super admin a RLS mostra a clinica (is_product_admin).
    estado.linhas = [vinculoVisivel(SUSPENSA, "Clínica Suspensa")];
    const sessao = await getSessionContext();
    expect(sessao?.isProductAdmin).toBe(true);
    expect(sessao?.active?.clinicId).toBe(SUSPENSA);
    expect(sessao?.clinicaSuspensa).toBeNull();
    expect(estado.rpcs).toEqual([]);
  });

  it("vínculo ativo sem clínica que não é suspensa (estado estranho): some, como antes", async () => {
    estado.linhas = [vinculoDaSuspensa(OUTRA_ATIVA)];
    estado.suspensas = suspensasDoBanco();
    const sessao = await getSessionContext();
    expect(sessao?.memberships).toEqual([]);
    expect(sessao?.clinicaSuspensa).toBeNull();
    expect(sessao?.active).toBeNull();
  });
});
