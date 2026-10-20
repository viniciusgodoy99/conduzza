import {
  indiceDosProfissionais,
  montarCatalogoDoAgente,
  type CatalogoDoAgente,
} from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  configPadraoDoAgente,
  type AgendaDoAgente,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import { instanteLocal } from "@/lib/domain/horarios";

import { AgendaEmMemoria } from "./agenda-em-memoria";

// Clinica ficticia da agenda da IA (E4). Nenhum dado real: nomes, precos e
// convenios inventados. Agora e terca, 20/10/2026, 09:00 em Fortaleza
// (12:00 UTC). Jornadas: a Dra. Ana Lima de segunda a sexta, das 08:00 as
// 12:00 e das 14:00 as 18:00; o Dr. Bruno Costa terca e quinta, das 13:00 as
// 17:00.

export const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
export const CONVERSA = "c0000000-0000-4000-8000-000000000001";
export const OUTRA_CONVERSA = "c0000000-0000-4000-8000-000000000002";
export const CONTATO = "c1000000-0000-4000-8000-000000000001";
export const JOB = "10000000-0000-4000-8000-000000000001";
export const FUSO = "America/Fortaleza";
export const AGORA = Date.UTC(2026, 9, 20, 12, 0);

export const PROC = {
  consulta: "11111111-1111-4111-8111-111111111111",
  limpeza: "22222222-2222-4222-8222-222222222222",
  exame: "33333333-3333-4333-8333-333333333333",
} as const;
export const PROF = {
  ana: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  bruno: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
} as const;
export const CONV = {
  unimed: "c0c0c0c0-0000-4000-8000-000000000001",
  amil: "c0c0c0c0-0000-4000-8000-000000000002",
  bradescoTop: "c0c0c0c0-0000-4000-8000-000000000003",
  bradescoFlex: "c0c0c0c0-0000-4000-8000-000000000004",
  unimedFortaleza: "c0c0c0c0-0000-4000-8000-000000000005",
} as const;
export const VINC = {
  consultaAna: "5a000000-0000-4000-8000-000000000001",
  consultaBruno: "5a000000-0000-4000-8000-000000000002",
  consultaAnaUnimed: "5a000000-0000-4000-8000-000000000003",
  limpezaAna: "5a000000-0000-4000-8000-000000000004",
  exameBrunoAmil: "5a000000-0000-4000-8000-000000000005",
} as const;
export const SALA = "5a1a0000-0000-4000-8000-000000000001";

function vinculo(
  id: string,
  procedure_id: string,
  professional_id: string,
  insurance_id: string | null,
  price_cents: number | null,
  duration_min: number,
) {
  return {
    id,
    procedure_id,
    professional_id,
    insurance_id,
    price_cents,
    covered_by_insurance: insurance_id !== null,
    bookable_by_ai: true,
    active: true,
    duration_min,
  };
}

/**
 * O catalogo da clinica ficticia. `vinculosSoDaEquipe`: vinculos ativos sem
 * "IA pode agendar" (so ids), como o carregador le (correcao da E4, D14).
 * `vinculosExtras`: vinculos a mais com "IA pode agendar" (particular).
 */
export function catalogoDaAgenda(
  extra: {
    vinculosSoDaEquipe?: {
      procedure_id: string;
      professional_id: string;
      insurance_id: string | null;
    }[];
    vinculosExtras?: {
      id: string;
      procedure_id: string;
      professional_id: string;
      price_cents: number | null;
      duration_min: number;
    }[];
  } = {},
): CatalogoDoAgente {
  return montarCatalogoDoAgente({
    vinculosSoDaEquipe: extra.vinculosSoDaEquipe ?? [],
    procedimentos: [
      {
        id: PROC.consulta,
        name: "Consulta",
        active: true,
        bookable_by_ai: true,
      },
      {
        id: PROC.limpeza,
        name: "Limpeza de pele",
        active: true,
        bookable_by_ai: true,
        resource_id: SALA,
      },
      { id: PROC.exame, name: "Exame", active: true, bookable_by_ai: true },
    ],
    profissionais: [
      { id: PROF.ana, name: "Dra. Ana Lima", active: true },
      { id: PROF.bruno, name: "Dr. Bruno Costa", active: true },
    ],
    convenios: [
      { id: CONV.unimed, name: "Unimed", plan_name: "Nacional", active: true },
      { id: CONV.amil, name: "Amil", plan_name: null, active: true },
      {
        id: CONV.bradescoTop,
        name: "Bradesco Saúde",
        plan_name: "Top",
        active: true,
      },
      {
        id: CONV.bradescoFlex,
        name: "Bradesco Saúde",
        plan_name: "Flex",
        active: true,
      },
      {
        id: CONV.unimedFortaleza,
        name: "Unimed Fortaleza",
        plan_name: "Flex",
        active: true,
      },
    ],
    vinculos: [
      vinculo(VINC.consultaAna, PROC.consulta, PROF.ana, null, 30_000, 30),
      vinculo(VINC.consultaBruno, PROC.consulta, PROF.bruno, null, 28_000, 30),
      vinculo(
        VINC.consultaAnaUnimed,
        PROC.consulta,
        PROF.ana,
        CONV.unimed,
        null,
        30,
      ),
      vinculo(VINC.limpezaAna, PROC.limpeza, PROF.ana, null, 12_000, 60),
      vinculo(
        VINC.exameBrunoAmil,
        PROC.exame,
        PROF.bruno,
        CONV.amil,
        5_000,
        20,
      ),
      ...(extra.vinculosExtras ?? []).map((v) =>
        vinculo(
          v.id,
          v.procedure_id,
          v.professional_id,
          null,
          v.price_cents,
          v.duration_min,
        ),
      ),
    ],
  });
}

/** O codigo (p1...) do procedimento e o (r1...) do profissional. */
export function codigoDoProcedimento(
  catalogo: CatalogoDoAgente,
  id: string,
): string {
  const achado = catalogo.procedimentos.find((p) => p.id === id);
  if (!achado) {
    throw new Error("procedimento fora do catalogo");
  }
  return achado.codigo;
}

export function codigoDoProfissional(
  catalogo: CatalogoDoAgente,
  id: string,
): string {
  const achado = indiceDosProfissionais(catalogo).find((p) => p.id === id);
  if (!achado) {
    throw new Error("profissional fora do catalogo");
  }
  return achado.codigo;
}

export const AGENDA: AgendaDoAgente = {
  antecedenciaHoras: 2,
  horizonteDias: 14,
};

export function configComAgenda(
  extra: Partial<ConfigDoAgente> = {},
): ConfigDoAgente {
  const base = configPadraoDoAgente();
  return {
    ...base,
    nome: "Ana",
    habilidades: {
      ...base.habilidades,
      agendar: true,
      confirmar_presenca: true,
    },
    agenda: AGENDA,
    ...extra,
  };
}

/** O instante (ISO) de uma hora local de um dia, no fuso dado. */
export function iso(dia: string, hora: string, fuso: string = FUSO): string {
  return instanteLocal(fuso, dia, hora).toISOString();
}

/** As jornadas da clinica ficticia em professional_schedule. */
export function bancoComJornadas(): AgendaEmMemoria {
  const banco = new AgendaEmMemoria();
  let n = 0;
  const janela = (
    professional_id: string,
    weekday: number,
    de: string,
    ate: string,
  ) => ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    clinic_id: CLINICA,
    professional_id,
    weekday,
    starts_at: `${de}:00`,
    ends_at: `${ate}:00`,
    unit_id: null,
  });
  for (const dia of [1, 2, 3, 4, 5]) {
    banco.inserir(
      "professional_schedule",
      janela(PROF.ana, dia, "08:00", "12:00"),
      janela(PROF.ana, dia, "14:00", "18:00"),
    );
  }
  for (const dia of [2, 4]) {
    banco.inserir(
      "professional_schedule",
      janela(PROF.bruno, dia, "13:00", "17:00"),
    );
  }
  return banco;
}
