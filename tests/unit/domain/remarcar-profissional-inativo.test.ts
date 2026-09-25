import { describe, expect, it } from "vitest";

import {
  atendeAConsulta,
  profissionaisParaRemarcar,
} from "@/components/agenda/remarcacao-comum";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import type { ConsultaDaAgenda } from "@/lib/queries/agenda";
import type { Catalogo, Profissional, Vinculo } from "@/lib/queries/catalogo";

// Achado L12 da revisao da leva 2: a Dra. Ana foi desativada e a coluna dela
// ainda aparece por causa de uma consulta. Remarcar essa consulta so trocando
// o dia deixava a consulta com ela, abrindo horario novo com quem nao atende
// mais. O proprio profissional inativo nao pode mais receber a consulta.

const PROCEDIMENTO = "proc-consulta";

function profissional(id: string, active: boolean): Profissional {
  return {
    id,
    name: id,
    photo_url: null,
    council_type: null,
    council_number: null,
    specialties: [],
    calendar_color: null,
    active,
  };
}

function vinculo(professionalId: string): Vinculo {
  return {
    id: `vinculo-${professionalId}`,
    professional_id: professionalId,
    procedure_id: PROCEDIMENTO,
    insurance_id: null,
    price_cents: 20_000,
    covered_by_insurance: false,
    duration_min: 30,
    bookable_by_ai: false,
    active: true,
  };
}

function contexto(profissionais: Profissional[]): ContextoAgenda {
  const catalogo: Catalogo = {
    profissionais,
    jornadas: [],
    bloqueios: [],
    recursos: [],
    procedimentos: [],
    convenios: [],
    vinculos: profissionais.map((p) => vinculo(p.id)),
    pacotes: [],
    unidades: [],
  };
  return {
    clinicId: "clinica",
    timezone: "America/Fortaleza",
    catalogo,
    podeEditar: true,
    dica: "",
    viewerId: "usuario",
    podeEditarCadastros: false,
    dicaCadastros: "",
    podeRegistrarAutorizacao: false,
    dicaAutorizacao: "",
  };
}

const CONSULTA: ConsultaDaAgenda = {
  id: "consulta",
  unit_id: null,
  contact_id: "contato",
  professional_id: "dra-ana",
  service_link_id: "vinculo-dra-ana",
  resource_id: null,
  starts_at: "2026-09-25T13:00:00.000Z",
  ends_at: "2026-09-25T13:30:00.000Z",
  status: "agendado",
  confirmation_channel: null,
  is_overbooking: false,
  created_by: "usuario",
  approval_status: null,
  send_confirmation: true,
  notes: null,
  contact: { id: "contato", name: "João", phone_e164: "+5585999990000" },
  service_link: {
    id: "vinculo-dra-ana",
    duration_min: 30,
    procedure: { id: PROCEDIMENTO, name: "Consulta" },
    insurance: null,
  },
};

describe("remarcar nunca mantém profissional inativo", () => {
  it("o próprio profissional ativo continua recebendo a consulta", () => {
    const ctx = contexto([profissional("dra-ana", true)]);
    expect(atendeAConsulta(ctx, CONSULTA, "dra-ana")).toBe(true);
  });

  it("o próprio profissional inativo não recebe mais a consulta", () => {
    const ctx = contexto([profissional("dra-ana", false)]);
    expect(atendeAConsulta(ctx, CONSULTA, "dra-ana")).toBe(false);
  });

  it("a lista do Remarcar oferece só os ativos com o mesmo vínculo", () => {
    const ctx = contexto([
      profissional("dra-ana", false),
      profissional("dr-bruno", true),
      profissional("dra-carla", false),
    ]);
    expect(profissionaisParaRemarcar(ctx, CONSULTA).map((p) => p.id)).toEqual([
      "dr-bruno",
    ]);
  });

  it("profissional fora do catálogo não recebe a consulta", () => {
    const ctx = contexto([profissional("dr-bruno", true)]);
    expect(atendeAConsulta(ctx, CONSULTA, "dra-ana")).toBe(false);
  });
});
