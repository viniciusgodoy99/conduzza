import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  entradasDaFila,
  executarOfertaDeEspera,
  vinculosDaVaga,
} from "@/lib/jobs/lista-espera";
import type { Job } from "@/lib/jobs/worker";

// AG5 (D-37, a confirmar): o job oferecer_lista_espera le a origem e o
// pagamento declarado da entrada e o "IA pode agendar" do vinculo, do
// procedimento e o convenio ativo do vinculo, e casa a entrada da IA so com
// o vinculo que a IA marca (o mesmo do aceite). Sem rede e sem banco: um
// cliente falso que responde por tabela e pela lista de colunas pedida.

const CLINICA = "clinica-1";
const PROFISSIONAL = "prof-1";
const PROCEDIMENTO = "proc-1";
const AGORA = Date.now();
const INICIO = new Date(AGORA + 3 * 24 * 3_600_000).toISOString();
const FIM = new Date(AGORA + 3 * 24 * 3_600_000 + 30 * 60_000).toISOString();

describe("vinculosDaVaga", () => {
  it("daIa só com o vínculo e o procedimento da IA e o convênio ativo", () => {
    const vinculos = vinculosDaVaga([
      {
        id: "a",
        procedure_id: PROCEDIMENTO,
        insurance_id: null,
        duration_min: 30,
        bookable_by_ai: true,
        procedure: { name: "Limpeza", resource_id: null, active: true, bookable_by_ai: true },
        insurance: null,
      },
      {
        id: "b",
        procedure_id: PROCEDIMENTO,
        insurance_id: "unimed",
        duration_min: 30,
        bookable_by_ai: true,
        procedure: [{ name: "Limpeza", resource_id: null, active: true, bookable_by_ai: true }],
        insurance: [{ active: false }],
      },
      {
        id: "c",
        procedure_id: PROCEDIMENTO,
        insurance_id: "bradesco",
        duration_min: 30,
        bookable_by_ai: false,
        procedure: { name: "Limpeza", resource_id: "sala", active: true, bookable_by_ai: true },
        insurance: { active: true },
      },
      {
        id: "d",
        procedure_id: "proc-2",
        insurance_id: null,
        duration_min: 30,
        bookable_by_ai: true,
        procedure: { name: "Outro", resource_id: null, active: true },
      },
      {
        id: "e",
        procedure_id: "proc-3",
        insurance_id: null,
        duration_min: 30,
        bookable_by_ai: true,
        procedure: { name: "Inativo", resource_id: null, active: false, bookable_by_ai: true },
      },
    ]);
    expect(vinculos.map((v) => [v.id, v.daIa, v.insuranceId, v.resourceId])).toEqual([
      ["a", true, null, null],
      ["b", false, "unimed", null],
      ["c", false, "bradesco", "sala"],
      ["d", false, null, null],
    ]);
    expect(vinculos[0]?.nomeDoProcedimento).toBe("Limpeza");
  });
});

describe("entradasDaFila", () => {
  it("as de antes (sem as colunas novas) leem como equipe, sem pagamento", () => {
    const [e] = entradasDaFila([
      {
        id: "w1",
        contact_id: "k1",
        procedure_id: PROCEDIMENTO,
        professional_id: null,
        preferred_shifts: ["manha"],
        preferred_weekdays: [1],
        priority: 10,
        created_at: "2026-10-27T12:00:00Z",
        contact: { insurance_id: "unimed" },
      },
    ]);
    expect(e).toMatchObject({
      origem: "equipe",
      particularDeclarado: null,
      insuranceIdDeclarado: null,
      insuranceId: "unimed",
    });
  });

  it("a da IA traz a origem e o pagamento declarado", () => {
    const [particular, convenio] = entradasDaFila([
      {
        id: "w1",
        contact_id: "k1",
        procedure_id: PROCEDIMENTO,
        professional_id: null,
        preferred_shifts: [],
        preferred_weekdays: [],
        priority: 1_000_000,
        created_at: "2026-10-27T12:00:00Z",
        origem: "ia",
        particular: true,
        insurance_id: null,
        contact: [{ insurance_id: "unimed" }],
      },
      {
        id: "w2",
        contact_id: "k2",
        procedure_id: PROCEDIMENTO,
        professional_id: PROFISSIONAL,
        preferred_shifts: [],
        preferred_weekdays: [],
        priority: 1_000_000,
        created_at: "2026-10-27T12:00:00Z",
        origem: "ia",
        particular: false,
        insurance_id: "bradesco",
        contact: null,
      },
    ]);
    expect(particular).toMatchObject({
      origem: "ia",
      particularDeclarado: true,
      insuranceIdDeclarado: null,
      insuranceId: "unimed",
    });
    expect(convenio).toMatchObject({
      origem: "ia",
      particularDeclarado: false,
      insuranceIdDeclarado: "bradesco",
      insuranceId: null,
    });
  });
});

// ---------------------------------------------------------------------------
// O job inteiro, com o cliente falso
// ---------------------------------------------------------------------------

type Chamada = { tabela: string; select: string };

function clienteFalso(opcoes: {
  fila: Record<string, unknown>[];
  vinculos: Record<string, unknown>[];
}) {
  const chamadas: Chamada[] = [];
  const rpcs: { nome: string; args: Record<string, unknown> }[] = [];
  const responder = (tabela: string, select: string): { data: unknown; error: null } => {
    switch (tabela) {
      case "appointment":
        if (select.startsWith("id, professional_id")) {
          return {
            data: {
              id: "consulta-cancelada",
              professional_id: PROFISSIONAL,
              contact_id: "quem-cancelou",
              unit_id: null,
              starts_at: INICIO,
              ends_at: FIM,
              oferecer_vaga_ao_cancelar: true,
              service_link: { procedure_id: PROCEDIMENTO, procedure: { name: "Limpeza" } },
            },
            error: null,
          };
        }
        return { data: [], error: null };
      case "clinic":
        return {
          data: {
            name: "Clínica",
            timezone: "America/Fortaleza",
            waitlist_wave_size: 5,
            waitlist_response_minutes: 30,
          },
          error: null,
        };
      case "waitlist_offer":
        return { data: [], error: null };
      case "whatsapp_account":
        return { data: [{ connection_status: "conectado" }], error: null };
      case "waitlist":
        return { data: opcoes.fila, error: null };
      case "service_link":
        return { data: opcoes.vinculos, error: null };
      case "contact":
        return { data: [], error: null };
      case "professional":
        return { data: { name: "Dra. Ana" }, error: null };
      default:
        return { data: null, error: null };
    }
  };
  const cliente = {
    from(tabela: string) {
      let select = "";
      const consulta: Record<string, unknown> = {};
      for (const metodo of ["eq", "neq", "is", "not", "in", "gt", "gte", "lt", "lte", "or", "order", "limit"]) {
        consulta[metodo] = () => consulta;
      }
      consulta.select = (colunas: string) => {
        select = colunas;
        chamadas.push({ tabela, select });
        return consulta;
      };
      consulta.maybeSingle = async () => responder(tabela, select);
      consulta.single = async () => responder(tabela, select);
      consulta.then = (resolver: (valor: unknown) => unknown, rejeitar?: (motivo: unknown) => unknown) =>
        Promise.resolve(responder(tabela, select)).then(resolver, rejeitar);
      return consulta;
    },
    async rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args });
      if (nome === "vaga_de_espera_indisponivel") {
        return { data: null, error: null };
      }
      if (nome === "contas_de_envio") {
        return {
          data: (args.p_contact_ids as string[]).map((contato) => ({
            contact_id: contato,
            whatsapp_account_id: "numero-1",
            nome: "Principal",
            connection_status: "conectado",
          })),
          error: null,
        };
      }
      if (nome === "consentimento_vigente") {
        return { data: true, error: null };
      }
      if (nome === "criar_oferta_de_espera") {
        return { data: "oferta-1", error: null };
      }
      return { data: null, error: null };
    },
  };
  return { admin: cliente as unknown as SupabaseClient, chamadas, rpcs };
}

function linhaDaFila(parcial: Record<string, unknown>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    contact_id: crypto.randomUUID(),
    procedure_id: PROCEDIMENTO,
    professional_id: null,
    preferred_shifts: [],
    preferred_weekdays: [],
    priority: 1_000_000,
    created_at: "2026-10-27T12:00:00Z",
    origem: "equipe",
    insurance_id: null,
    particular: null,
    contact: { insurance_id: null },
    ...parcial,
  };
}

function linhaDoVinculo(parcial: Record<string, unknown>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    procedure_id: PROCEDIMENTO,
    insurance_id: null,
    duration_min: 30,
    bookable_by_ai: true,
    procedure: { name: "Limpeza", resource_id: null, active: true, bookable_by_ai: true },
    insurance: null,
    ...parcial,
  };
}

const JOB: Job = {
  id: "job-oferta",
  clinic_id: CLINICA,
  kind: "oferecer_lista_espera",
  payload: { appointment_id: "consulta-cancelada" },
  attempts: 1,
  max_attempts: 5,
  whatsapp_account_id: null,
};

describe("executarOfertaDeEspera com a entrada da IA", () => {
  it("lê a origem e o pagamento da fila e o IA pode agendar e o convênio do vínculo", async () => {
    const b = clienteFalso({ fila: [], vinculos: [] });
    await executarOfertaDeEspera(b.admin, JOB);
    const fila = b.chamadas.find((c) => c.tabela === "waitlist")?.select ?? "";
    const vinculos = b.chamadas.find((c) => c.tabela === "service_link")?.select ?? "";
    expect(fila).toContain("origem, insurance_id, particular");
    expect(vinculos).toContain("bookable_by_ai");
    expect(vinculos).toContain("procedure:procedure_id ( name, resource_id, active, bookable_by_ai )");
    expect(vinculos).toContain("insurance:insurance_id ( active )");
  });

  it("o vínculo que a IA não marca: a da IA fica fora da onda, a da equipe entra", async () => {
    const daIa = linhaDaFila({ origem: "ia", particular: true, created_at: "2026-10-27T11:00:00Z" });
    const daEquipe = linhaDaFila({});
    const b = clienteFalso({
      fila: [daIa, daEquipe],
      vinculos: [linhaDoVinculo({ bookable_by_ai: false })],
    });
    expect(await executarOfertaDeEspera(b.admin, JOB)).toEqual({ ok: true });
    const criar = b.rpcs.find((r) => r.nome === "criar_oferta_de_espera");
    const destinatarios = criar?.args.p_destinatarios as { waitlist_id: string }[];
    expect(destinatarios.map((d) => d.waitlist_id)).toEqual([daEquipe.id]);
  });

  it("com o vínculo da IA, as duas entram, pela ordem de chegada", async () => {
    const daIa = linhaDaFila({ origem: "ia", particular: true, created_at: "2026-10-27T11:00:00Z" });
    const daEquipe = linhaDaFila({});
    const b = clienteFalso({ fila: [daIa, daEquipe], vinculos: [linhaDoVinculo({})] });
    expect(await executarOfertaDeEspera(b.admin, JOB)).toEqual({ ok: true });
    const criar = b.rpcs.find((r) => r.nome === "criar_oferta_de_espera");
    const destinatarios = criar?.args.p_destinatarios as { waitlist_id: string }[];
    expect(destinatarios.map((d) => d.waitlist_id)).toEqual([daIa.id, daEquipe.id]);
  });

  it("a da IA pela Unimed com só o particular: fora (não vira particular); a vaga não espera por ela", async () => {
    const daIa = linhaDaFila({ origem: "ia", particular: false, insurance_id: "unimed" });
    const b = clienteFalso({ fila: [daIa], vinculos: [linhaDoVinculo({})] });
    expect(await executarOfertaDeEspera(b.admin, JOB)).toEqual({ ok: true });
    expect(b.rpcs.some((r) => r.nome === "criar_oferta_de_espera")).toBe(false);
  });

  it("a da IA pela Unimed com o vínculo da Unimed ativo da IA: entra", async () => {
    const daIa = linhaDaFila({ origem: "ia", particular: false, insurance_id: "unimed" });
    const b = clienteFalso({
      fila: [daIa],
      vinculos: [
        linhaDoVinculo({}),
        linhaDoVinculo({ insurance_id: "unimed", insurance: { active: true } }),
      ],
    });
    expect(await executarOfertaDeEspera(b.admin, JOB)).toEqual({ ok: true });
    const criar = b.rpcs.find((r) => r.nome === "criar_oferta_de_espera");
    const destinatarios = criar?.args.p_destinatarios as { waitlist_id: string }[];
    expect(destinatarios.map((d) => d.waitlist_id)).toEqual([daIa.id]);
  });

  it("o convênio do vínculo inativo: a da IA pela Unimed fica fora", async () => {
    const daIa = linhaDaFila({ origem: "ia", particular: false, insurance_id: "unimed" });
    const b = clienteFalso({
      fila: [daIa],
      vinculos: [linhaDoVinculo({ insurance_id: "unimed", insurance: { active: false } })],
    });
    expect(await executarOfertaDeEspera(b.admin, JOB)).toEqual({ ok: true });
    expect(b.rpcs.some((r) => r.nome === "criar_oferta_de_espera")).toBe(false);
  });
});
