import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BancoFalso } from "../whatsapp/banco-falso";

// Configuracoes le a lista das clinicas com o agente habilitado (onda 1:
// ia_clinicas_da_fase_controlada pela service role) JUNTO com o lote
// principal de leituras, e nao antes dele: esperar a lista somava uma ida ao
// banco em serie a toda carga da tela, em qualquer clinica. A liberacao da
// aba Agente de IA encadeia na lista (so e lida quando a aba existe).
// Banco em memoria: nada de rede.

const CLINICA_A = "0a0a0a0a-0000-4000-8000-00000000000a";

const banco = new BancoFalso();
const sessao = {
  userId: "usuario-da-sessao",
  userName: "Pessoa da sessão",
  isProductAdmin: false,
  active: {
    clinicId: CLINICA_A,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "admin" as string,
    status: "ativo",
  },
};

/** Tabelas lidas por cada cliente ("admin:audit_log", "sessao:clinic"...). */
const leituras: string[] = [];
function clienteRegistrado(quem: "admin" | "sessao") {
  const base = banco.cliente();
  return {
    ...base,
    from: (tabela: string) => {
      leituras.push(`${quem}:${tabela}`);
      return base.from(tabela);
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => clienteRegistrado("admin"),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => clienteRegistrado("sessao"),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Map([
      ["origin", "https://app.exemplo.test"],
      ["host", "app.exemplo.test"],
    ]),
}));

const { default: ConfiguracoesPage } =
  await import("@/app/(app)/configuracoes/page");

type RespostaDoBanco = {
  data: unknown;
  error: { code: string; message: string } | null;
};

/** A lista da IA so responde quando o teste mandar. */
function listaPendente(): (resposta: RespostaDoBanco) => void {
  let responder: (resposta: RespostaDoBanco) => void = () => undefined;
  const pendente = new Promise<RespostaDoBanco>((resolve) => {
    responder = resolve;
  });
  banco.rpc.mockImplementation(async (nome: string) =>
    nome === "ia_clinicas_da_fase_controlada"
      ? pendente
      : { data: null, error: null },
  );
  return (resposta) => responder(resposta);
}

/** Deixa correr tudo o que nao depende da lista pendente. */
async function deixarCorrer(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  banco.limpar();
  leituras.length = 0;
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("WHATSAPP_PROVIDER", "");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Configurações: a lista da IA corre junto com o lote principal", () => {
  it("com a lista ainda pendente, as leituras da tela já foram pedidas", async () => {
    const responder = listaPendente();
    const pagina = ConfiguracoesPage({ searchParams: Promise.resolve({}) });
    await deixarCorrer();

    expect(banco.rpc).toHaveBeenCalledWith(
      "ia_clinicas_da_fase_controlada",
      undefined,
    );
    // O lote principal saiu sem esperar a lista (antes, nada daqui era
    // pedido ate a lista responder).
    for (const tabela of [
      "sessao:clinic_member",
      "sessao:professional",
      "sessao:whatsapp_account",
      "sessao:meta_ads_account",
    ]) {
      expect(leituras, tabela).toContain(tabela);
    }
    // A liberacao da aba depende da lista: ainda nao foi lida.
    expect(leituras).not.toContain("sessao:ia_liberacao");

    responder({ data: [CLINICA_A], error: null });
    await pagina;
    // Com a clinica na lista, a aba existe e a liberacao e lida.
    expect(leituras).toContain("sessao:ia_liberacao");
  });

  it("clínica fora da lista: a liberação da aba nem é lida", async () => {
    const responder = listaPendente();
    const pagina = ConfiguracoesPage({ searchParams: Promise.resolve({}) });
    responder({ data: [], error: null });
    await pagina;
    expect(leituras).toContain("sessao:clinic_member");
    expect(leituras).not.toContain("sessao:ia_liberacao");
  });

  it("lista que não deu para ler: a tela carrega, sem a aba (falha fechada)", async () => {
    const responder = listaPendente();
    const pagina = ConfiguracoesPage({ searchParams: Promise.resolve({}) });
    responder({ data: null, error: { code: "57014", message: "tempo" } });
    await expect(pagina).resolves.toBeTruthy();
    expect(leituras).not.toContain("sessao:ia_liberacao");
  });
});
