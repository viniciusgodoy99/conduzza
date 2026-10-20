import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CABECALHO_DA_CLINICA_DA_TELA,
  DICA_EXPORTAR_LEADS,
  MENSAGEM_EXPORTACAO_ACESSO_INDISPONIVEL,
  MENSAGEM_EXPORTACAO_CLINICA_MUDOU,
  MENSAGEM_EXPORTACAO_FALHOU,
  MENSAGEM_EXPORTACAO_FILTROS_INVALIDOS,
  MENSAGEM_EXPORTACAO_SEM_CLINICA,
  MENSAGEM_EXPORTACAO_SESSAO_EXPIRADA,
  MENSAGEM_EXPORTACAO_TRILHA_FALHOU,
} from "@/lib/domain/exportacao-de-leads";
import type { Role } from "@/lib/domain/permissions";

import { SupabaseEmMemoria, type Linha } from "./supabase-em-memoria";

// A rota POST /api/leads/exportar: sessao obrigatoria, clinica ativa, o
// papel conferido NO SERVIDOR (recepcao, profissional e leitura recebem 403
// com a dica do dono; administrador e gestor recebem o CSV), o arquivo com
// BOM e nome no fuso da clinica, 204 sem lead, e o log sem dado de paciente.
// Vinculos que nao carregaram dao 503 (tentar de novo), e a clinica que a
// tela mostra (cabecalho) diferente da ativa da 409.

type Contexto = {
  userId: string;
  active: { clinicId: string; role: Role; timezone: string } | null;
  vinculoIndisponivel: boolean;
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
const OUTRA_CLINICA = "c2222222-2222-4222-8222-222222222222";
const EU = "a0000000-0000-4000-8000-000000000001";
const URL_DA_ROTA = "https://app.conduzza.test/api/leads/exportar";

const CONTATOS: Linha[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    clinic_id: CLINICA,
    name: "Joana Teixeira",
    phone_e164: "+5585999991234",
    kind: "paciente",
    funnel_stage: "agendou",
    lost_reason: null,
    lost_reason_note: null,
    owner_user_id: null,
    tags: ["vip"],
    source_channel: "indicacao",
    source_campaign: null,
    source_origin: null,
    source_medium: null,
    source_method: "manual",
    source_ad_id: null,
    source_google_campaign_id: null,
    first_contact_at: "2026-10-03T13:15:00.000000+00:00",
    last_contact_at: "2026-10-19T20:40:00.000000+00:00",
    insurance: null,
    contact_consent: [
      {
        channel: "whatsapp",
        granted_at: "2026-10-03T13:15:00+00:00",
        revoked_at: null,
      },
    ],
  },
];

function pedido(
  corpo: string | null,
  cabecalhos: Record<string, string> = {
    "content-type": "application/json",
    [CABECALHO_DA_CLINICA_DA_TELA]: CLINICA,
  },
): NextRequest {
  return new NextRequest(URL_DA_ROTA, {
    method: "POST",
    headers: cabecalhos,
    body: corpo,
  });
}

function entrar(role: Role) {
  contexto = {
    userId: EU,
    active: { clinicId: CLINICA, role, timezone: "America/Fortaleza" },
    vinculoIndisponivel: false,
  };
}

let escrito: string[] = [];

beforeEach(() => {
  banco = new SupabaseEmMemoria({
    contact: CONTATOS.map((linha) => structuredClone(linha)),
    funnel_stage_def: [
      { clinic_id: CLINICA, chave: "agendou", nome: "Agendou", posicao: 3 },
    ],
    meta_anuncio: [],
    anuncio_do_whatsapp: [],
    audit_log: [],
  });
  contexto = null;
  escrito = [];
  const guardar = (pedaco: string | Uint8Array) => {
    escrito.push(String(pedaco));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(guardar);
  vi.spyOn(process.stderr, "write").mockImplementation(guardar);
  // 01:30 UTC de 21/10 ainda e 20/10 em Fortaleza.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T01:30:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mensagemDe(resposta: Response): Promise<string> {
  const corpo = (await resposta.json()) as { mensagem: string };
  return corpo.mensagem;
}

describe("sessão e clínica", () => {
  it("sem sessão: 401", async () => {
    const resposta = await POST(pedido("{}"));
    expect(resposta.status).toBe(401);
    expect(await mensagemDe(resposta)).toBe(
      MENSAGEM_EXPORTACAO_SESSAO_EXPIRADA,
    );
    expect(banco.consultas).toHaveLength(0);
  });

  it("sem clínica ativa: 409", async () => {
    contexto = { userId: EU, active: null, vinculoIndisponivel: false };
    const resposta = await POST(pedido("{}"));
    expect(resposta.status).toBe(409);
    expect(await mensagemDe(resposta)).toBe(MENSAGEM_EXPORTACAO_SEM_CLINICA);
    expect(banco.consultas).toHaveLength(0);
  });

  it("vínculos que não carregaram: 503 para tentar de novo, nunca o escolha a clínica", async () => {
    contexto = { userId: EU, active: null, vinculoIndisponivel: true };
    const resposta = await POST(pedido("{}"));
    expect(resposta.status).toBe(503);
    expect(await mensagemDe(resposta)).toBe(
      MENSAGEM_EXPORTACAO_ACESSO_INDISPONIVEL,
    );
    expect(banco.consultas).toHaveLength(0);
  });

  it("a tela mostra outra clínica (troca em outra aba): 409 sem ler nem gravar", async () => {
    entrar("admin");
    const resposta = await POST(
      pedido("{}", {
        "content-type": "application/json",
        [CABECALHO_DA_CLINICA_DA_TELA]: OUTRA_CLINICA,
      }),
    );
    expect(resposta.status).toBe(409);
    expect(await mensagemDe(resposta)).toBe(MENSAGEM_EXPORTACAO_CLINICA_MUDOU);
    expect(banco.consultas).toHaveLength(0);
    expect(banco.inserts).toHaveLength(0);
  });

  it("pedido sem dizer a clínica da tela: 409", async () => {
    entrar("gestor");
    const resposta = await POST(
      pedido("{}", { "content-type": "application/json" }),
    );
    expect(resposta.status).toBe(409);
    expect(banco.consultas).toHaveLength(0);
  });

  it("a clínica da tela igual à ativa: segue para o arquivo", async () => {
    entrar("admin");
    const resposta = await POST(pedido("{}"));
    expect(resposta.status).toBe(200);
  });
});

describe("papel conferido no servidor", () => {
  for (const role of ["recepcao", "profissional", "leitura"] as const) {
    it(`${role}: 403 com a dica, sem ler o banco nem gravar trilha`, async () => {
      entrar(role);
      const resposta = await POST(pedido("{}"));
      expect(resposta.status).toBe(403);
      expect(await mensagemDe(resposta)).toBe(DICA_EXPORTAR_LEADS);
      expect(banco.consultas).toHaveLength(0);
      expect(banco.inserts).toHaveLength(0);
    });

    it(`${role}: a guarda vem antes até de corpo inválido`, async () => {
      entrar(role);
      const resposta = await POST(pedido("isto não é json"));
      expect(resposta.status).toBe(403);
    });
  }

  for (const role of ["admin", "gestor"] as const) {
    it(`${role}: 200 com o CSV (BOM, nome com o dia da clínica, sem cache)`, async () => {
      entrar(role);
      const resposta = await POST(pedido("{}"));
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("content-type")).toBe(
        "text/csv; charset=utf-8",
      );
      expect(resposta.headers.get("content-disposition")).toBe(
        'attachment; filename="leads-2026-10-20.csv"',
      );
      expect(resposta.headers.get("cache-control")).toBe("no-store");
      const bytes = new Uint8Array(await resposta.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const texto = new TextDecoder().decode(bytes.slice(3));
      expect(texto).toContain(
        "Joana Teixeira;(85) 99999-1234;Paciente;Agendou",
      );
      expect(texto).toContain("03/10/2026 10:15;19/10/2026 17:40;vip;Sim;");
      expect(banco.inserts).toHaveLength(1);
    });
  }
});

describe("outras respostas", () => {
  it("nenhum lead com esses filtros: 204 sem corpo e sem trilha", async () => {
    entrar("admin");
    const resposta = await POST(pedido(JSON.stringify({ etapa: "perdido" })));
    expect(resposta.status).toBe(204);
    expect(await resposta.text()).toBe("");
    expect(banco.inserts).toHaveLength(0);
  });

  it("corpo que não é JSON, ou sem o Content-Type de JSON: 400", async () => {
    entrar("admin");
    const quebrado = await POST(pedido("{etapa:"));
    expect(quebrado.status).toBe(400);
    expect(await mensagemDe(quebrado)).toBe(
      MENSAGEM_EXPORTACAO_FILTROS_INVALIDOS,
    );
    const formulario = await POST(
      pedido("etapa=novo", {
        "content-type": "application/x-www-form-urlencoded",
        [CABECALHO_DA_CLINICA_DA_TELA]: CLINICA,
      }),
    );
    expect(formulario.status).toBe(400);
    expect(banco.consultas).toHaveLength(0);
  });

  it("trilha que não grava: 503 e nada de arquivo", async () => {
    entrar("admin");
    banco.errosDeInsert.audit_log = [{ code: "42501", message: "negado" }];
    const resposta = await POST(pedido("{}"));
    expect(resposta.status).toBe(503);
    expect(resposta.headers.get("content-type")).toContain("application/json");
    expect(await mensagemDe(resposta)).toBe(MENSAGEM_EXPORTACAO_TRILHA_FALHOU);
  });

  it("leitura que falha: 500, com o código do PostgREST no log", async () => {
    entrar("gestor");
    banco.errosDeLeitura.contact = { code: "57014", message: "fora do ar" };
    const resposta = await POST(pedido("{}"));
    expect(resposta.status).toBe(500);
    expect(await mensagemDe(resposta)).toBe(MENSAGEM_EXPORTACAO_FALHOU);
    const log = escrito.join("");
    expect(log).toContain('"error_code":"57014"');
    expect(log).not.toContain("fora do ar");
  });

  it("leitura dos títulos dos anúncios que falha: 500 e nada de arquivo nem trilha", async () => {
    entrar("admin");
    banco.tabelas.contact?.push({
      ...structuredClone(CONTATOS[0]),
      id: "00000000-0000-4000-8000-000000000002",
      name: "Lead do anúncio",
      phone_e164: "+5585988887777",
      kind: "lead",
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_method: "anuncio_ctwa",
      source_ad_id: "120240624148610289",
    });
    banco.errosDeLeitura.anuncio_do_whatsapp = { message: "fora do ar" };
    const resposta = await POST(pedido("{}"));
    expect(resposta.status).toBe(500);
    expect(await mensagemDe(resposta)).toBe(MENSAGEM_EXPORTACAO_FALHOU);
    expect(banco.inserts).toHaveLength(0);
  });
});

describe("log sem dado de paciente", () => {
  it("o sucesso loga só ids e a contagem; a falha, só o passo", async () => {
    entrar("admin");
    await POST(pedido(JSON.stringify({ origem: "indicacao" })));
    banco.errosDeLeitura.contact = { message: "Joana Teixeira +5585999991234" };
    await POST(pedido("{}"));
    const log = escrito.join("");
    expect(log).toContain("leads_exportados");
    expect(log).toContain('"count":1');
    expect(log).toContain("exportacao_de_leads_falhou");
    for (const proibido of [
      "Joana",
      "Teixeira",
      "5585999991234",
      "99999-1234",
      "indicacao",
    ]) {
      expect(log).not.toContain(proibido);
    }
  });
});
