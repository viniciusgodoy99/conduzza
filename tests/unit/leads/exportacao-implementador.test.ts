import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CABECALHO_DA_CLINICA_DA_TELA,
  DICA_EXPORTAR_LEADS,
  MENSAGEM_EXPORTACAO_ACESSO_INDISPONIVEL,
  podeExportarLeads,
} from "@/lib/domain/exportacao-de-leads";
import { ROLES } from "@/lib/domain/permissions";

import { SupabaseEmMemoria } from "./supabase-em-memoria";

// O Implementador nao exporta a planilha de leads (P18-6 do dono,
// 21/10/2026; onda 5, item 18): no banco ele e administrador, entao so a
// marca o separa, e nada no banco trava a exportacao. A tela deixa o botao
// visivel e desabilitado com a dica de sempre, e a rota recusa com 403. Sem
// conseguir ler a marca, o administrador recebe 503 (tentar de novo): o
// arquivo nunca sai na duvida.

type Contexto = {
  userId: string;
  active: {
    clinicId: string;
    role: string;
    implementador: boolean;
    timezone: string;
  } | null;
  vinculoIndisponivel: boolean;
  marcaDeImplementadorIndisponivel: boolean;
} | null;

let contexto: Contexto = null;
let banco: SupabaseEmMemoria;

vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => contexto,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => banco.comoCliente(),
}));

const { POST } = await import("@/app/api/leads/exportar/route");

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const EU = "a0000000-0000-4000-8000-000000000001";

function entrar(
  role: string,
  implementador: boolean,
  marcaIndisponivel = false,
) {
  contexto = {
    userId: EU,
    active: {
      clinicId: CLINICA,
      role,
      implementador,
      timezone: "America/Fortaleza",
    },
    vinculoIndisponivel: false,
    marcaDeImplementadorIndisponivel: marcaIndisponivel,
  };
}

function pedido(): NextRequest {
  return new NextRequest("https://app.conduzza.test/api/leads/exportar", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [CABECALHO_DA_CLINICA_DA_TELA]: CLINICA,
    },
    body: "{}",
  });
}

beforeEach(() => {
  banco = new SupabaseEmMemoria({
    contact: [],
    funnel_stage_def: [],
    meta_anuncio: [],
    anuncio_do_whatsapp: [],
    audit_log: [],
  });
  contexto = null;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quem exporta os leads", () => {
  it("o administrador e o gestor; o Implementador não", () => {
    expect(ROLES.filter((role) => podeExportarLeads(role))).toEqual([
      "admin",
      "gestor",
    ]);
    expect(podeExportarLeads("admin", true)).toBe(false);
    expect(podeExportarLeads("admin", false)).toBe(true);
    // A marca so vale com o vinculo admin.
    expect(podeExportarLeads("gestor", true)).toBe(true);
  });
});

describe("a rota confere a marca no servidor", () => {
  it("Implementador: 403 com a dica, sem ler o banco nem gravar trilha", async () => {
    entrar("admin", true);
    const resposta = await POST(pedido());
    expect(resposta.status).toBe(403);
    expect(((await resposta.json()) as { mensagem: string }).mensagem).toBe(
      DICA_EXPORTAR_LEADS,
    );
    expect(banco.consultas).toHaveLength(0);
    expect(banco.inserts).toHaveLength(0);
  });

  it("administrador com a marca que não carregou: 503, nunca o arquivo na dúvida", async () => {
    entrar("admin", false, true);
    const resposta = await POST(pedido());
    expect(resposta.status).toBe(503);
    expect(((await resposta.json()) as { mensagem: string }).mensagem).toBe(
      MENSAGEM_EXPORTACAO_ACESSO_INDISPONIVEL,
    );
    expect(banco.consultas).toHaveLength(0);
  });

  it("o gestor não depende da marca: segue (sem lead, 204)", async () => {
    entrar("gestor", false, true);
    const resposta = await POST(pedido());
    expect(resposta.status).toBe(204);
  });

  it("administrador pleno segue (sem lead, 204)", async () => {
    entrar("admin", false);
    const resposta = await POST(pedido());
    expect(resposta.status).toBe(204);
  });
});
