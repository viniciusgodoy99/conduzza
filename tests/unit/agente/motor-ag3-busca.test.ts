import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { portaDaAgendaDoWhatsapp } from "@/lib/agente/agenda";
import { criarAgendaDoTurno } from "@/lib/agente/ferramentas/agenda-do-turno";
import {
  horarioContinuaLivre,
  pedidoDaReconferencia,
} from "@/lib/agente/ferramentas/buscar-horario";
import type { CatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";

import { AgendaEmMemoria } from "./agenda-em-memoria";
import {
  AGENDA,
  AGORA,
  CLINICA,
  codigoDoProcedimento,
  codigoDoProfissional,
  configComAgenda,
  CONTATO,
  CONVERSA,
  FUSO,
  iso,
  JOB,
  PROC,
  PROF,
  VINC,
} from "./agenda-fixtures";
import { catalogoDoCadastro, linhasDoCadastro, UNID } from "./cadastro-fixtures";

// buscar_horario na AG3 (27/10/2026): a unidade (a jornada da unidade pedida
// e a sem unidade, que vale para todas; cada horario com a dele), a grade do
// profissional contada do inicio da jornada, a idade atendida contra o
// nascimento conhecido, a hora pedida (livre ou as mais proximas) e a
// reconferencia leve do horario oferecido antes. A Dra. Ana atende de manha
// na Aldeota (u1) e a tarde no Centro (u2); o Dr. Bruno, terca e quinta a
// tarde, sem unidade. Agora e terca, 20/10/2026, 09:00 em Fortaleza.
// Nenhum teste fala com o banco nem com a OpenAI.

const CATALOGO = catalogoDoCadastro();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const R_ANA = codigoDoProfissional(CATALOGO, PROF.ana);
const R_BRUNO = codigoDoProfissional(CATALOGO, PROF.bruno);

let banco: AgendaEmMemoria;

function bancoComUnidades(
  bruno: string | null = null,
): AgendaEmMemoria {
  const novo = new AgendaEmMemoria();
  let n = 0;
  const faixa = (
    professional_id: string,
    weekday: number,
    de: string,
    ate: string,
    unit_id: string | null,
  ) => ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    clinic_id: CLINICA,
    professional_id,
    weekday,
    starts_at: `${de}:00`,
    ends_at: `${ate}:00`,
    unit_id,
  });
  for (const dia of [1, 2, 3, 4, 5]) {
    novo.inserir(
      "professional_schedule",
      faixa(PROF.ana, dia, "08:00", "12:00", UNID.aldeota),
      faixa(PROF.ana, dia, "14:00", "18:00", UNID.centro),
    );
  }
  for (const dia of [2, 4]) {
    novo.inserir(
      "professional_schedule",
      faixa(PROF.bruno, dia, "13:00", "17:00", bruno),
    );
  }
  return novo;
}

beforeEach(() => {
  banco = bancoComUnidades();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Horario = {
  codigo: string;
  dia: string;
  hora: string;
  profissional: string;
  unidade: string | null;
  unidade_codigo?: string;
};

async function buscar(
  pedido: Record<string, unknown>,
  extra: { catalogo?: CatalogoDoAgente; nascimentos?: string[] } = {},
) {
  const turno = criarAgendaDoTurno({
    porta: portaDaAgendaDoWhatsapp(banco.cliente(), {
      clinicId: CLINICA,
      conversationId: CONVERSA,
      contactId: CONTATO,
      jobId: JOB,
      agora: () => AGORA,
    }),
    catalogo: extra.catalogo ?? CATALOGO,
    config: configComAgenda(),
    agoraMs: AGORA,
    fuso: FUSO,
    nascimentos: extra.nascimentos ?? [],
  });
  const r = await turno.executar("buscar_horario", {
    procedimento: P_CONSULTA,
    profissional: null,
    convenio: null,
    a_partir_de: null,
    periodo: null,
    unidade: null,
    hora: null,
    ...pedido,
  });
  if (r.tipo !== "saida") {
    throw new Error(`esperava saida, veio ${r.tipo}`);
  }
  return {
    ...r,
    json: JSON.parse(r.saida) as Record<string, unknown> & {
      horarios?: Horario[];
    },
  };
}

const linha = (h: Horario) =>
  `${h.dia} ${h.hora} ${h.profissional} ${h.unidade ?? "sem unidade"}`;

describe("a unidade do horário", () => {
  it("cada horário traz a unidade da faixa; a faixa sem unidade, numa clínica com mais de uma, vai sem", async () => {
    const r = await buscar({});
    expect(r.resultado).toBe("horarios");
    expect((r.json.horarios ?? []).map(linha)).toEqual([
      "terça, 20/10 11:30 Dra. Ana Lima Aldeota",
      "terça, 20/10 13:00 Dr. Bruno Costa sem unidade",
      "quarta, 21/10 08:00 Dra. Ana Lima Aldeota",
      "quarta, 21/10 14:00 Dra. Ana Lima Centro",
    ]);
    expect(r.json.horarios?.[0]).toMatchObject({
      unidade: "Aldeota",
      unidade_codigo: "u1",
    });
    expect(r.json.horarios?.[1]?.unidade_codigo).toBeUndefined();
    // Os fatos levam a unidade (o resumo do verificador tambem).
    expect(r.fatos?.horarios?.[0]).toEqual({
      dia: "terça, 20/10",
      hora: "11:30",
      unidade: "Aldeota",
    });
    expect(r.passo).toContain("terça, 20/10 às 11:30 (Dra. Ana Lima, Aldeota)");
    // A leitura da jornada traz a unidade (nunca dado de paciente).
    const jornada = banco.leituras.find(
      (l) => l.tabela === "professional_schedule",
    );
    expect(jornada?.colunas).toBe(
      "professional_id, weekday, starts_at, ends_at, unit_id",
    );
  });

  it("com a unidade pedida: a jornada dela e a sem unidade (que vale para todas)", async () => {
    const r = await buscar({ unidade: "u2" });
    expect((r.json.horarios ?? []).map(linha)).toEqual([
      "terça, 20/10 13:00 Dr. Bruno Costa Centro",
      "quarta, 21/10 14:00 Dra. Ana Lima Centro",
      "quinta, 22/10 13:00 Dr. Bruno Costa Centro",
      "sexta, 23/10 14:00 Dra. Ana Lima Centro",
    ]);
    expect(r.json.unidade).toBe("Centro");
    expect(r.passo).toContain("na unidade Centro");
  });

  it("unidade que não existe e profissional que não atende na unidade", async () => {
    const inexistente = await buscar({ unidade: "u9" });
    expect(inexistente.resultado).toBe("unidade_nao_encontrada");
    banco = bancoComUnidades(UNID.aldeota);
    const r = await buscar({ profissional: R_BRUNO, unidade: "u2" });
    expect(r.resultado).toBe("nao_atende_na_unidade");
    expect(r.json).toMatchObject({
      resultado: "nao_atende_na_unidade",
      profissional: "Dr. Bruno Costa",
      unidade: "Centro",
    });
  });

  it("na clínica de uma unidade só, a faixa sem unidade é dela", async () => {
    const umaUnidade = catalogoDoCadastro({
      unidades: linhasDoCadastro().unidades?.filter((u) => u.id === UNID.centro),
    });
    const r = await buscar(
      { profissional: codigoDoProfissional(umaUnidade, PROF.bruno) },
      { catalogo: umaUnidade },
    );
    expect(r.json.horarios?.[0]).toMatchObject({
      profissional: "Dr. Bruno Costa",
      unidade: "Centro",
      unidade_codigo: "u1",
    });
  });
});

describe("a grade do profissional", () => {
  it("os inícios na grade, contados do início da jornada (45 em 45 desde as 08:00)", async () => {
    const comGrade = catalogoDoCadastro({
      profissionais: linhasDoCadastro().profissionais.map((p) =>
        p.id === PROF.ana ? { ...p, grade_minutos: 45 } : p,
      ),
    });
    const naGrade = await buscar(
      { profissional: R_ANA, a_partir_de: "2026-10-21", hora: "08:45" },
      { catalogo: comGrade },
    );
    expect(naGrade.resultado).toBe("hora_pedida_livre");
    // 08:30 nao e inicio na grade de 45: os mais proximos que sao.
    const foraDaGrade = await buscar(
      { profissional: R_ANA, a_partir_de: "2026-10-21", hora: "08:30" },
      { catalogo: comGrade },
    );
    expect(foraDaGrade.resultado).toBe("hora_pedida_ocupada");
    expect((foraDaGrade.json.horarios ?? []).map((h) => h.hora)).toEqual([
      "08:00",
      "08:45",
      "09:30",
    ]);
    // Sem grade: a duracao (30 minutos), 08:30 esta na grade.
    const semGrade = await buscar({
      profissional: R_ANA,
      a_partir_de: "2026-10-21",
      hora: "08:30",
    });
    expect(semGrade.resultado).toBe("hora_pedida_livre");
  });
});

describe("a idade atendida", () => {
  it("com o nascimento conhecido, o profissional que não atende a idade fica de fora", async () => {
    // 16 anos: a Dra. Ana atende a partir de 12; o Dr. Bruno, de 18 a 65.
    const nascimentos = ["2010-05-01"];
    const todos = await buscar({ periodo: "tarde" }, { nascimentos });
    expect(
      (todos.json.horarios ?? []).every((h) => h.profissional === "Dra. Ana Lima"),
    ).toBe(true);
    const doBruno = await buscar({ profissional: R_BRUNO }, { nascimentos });
    expect(doBruno.resultado).toBe("idade_nao_atendida");
    // Nunca diz a idade nem o nascimento.
    expect(doBruno.saida).not.toMatch(/2010|16/);
    // Sem nascimento conhecido, ninguem fica de fora.
    const semNascimento = await buscar({ profissional: R_BRUNO });
    expect(semNascimento.resultado).toBe("horarios");
  });
});

describe("a hora pedida", () => {
  it("sem dia: o primeiro dia em que a hora está livre, com todos os profissionais nela", async () => {
    const r = await buscar({ hora: "15:00" });
    expect(r.resultado).toBe("hora_pedida_livre");
    expect((r.json.horarios ?? []).map(linha)).toEqual([
      "terça, 20/10 15:00 Dr. Bruno Costa sem unidade",
      "terça, 20/10 15:00 Dra. Ana Lima Centro",
    ]);
    expect(r.json.hora_pedida).toBe("15:00");
  });

  it("com o dia: ocupada, os mais próximos daquele dia; sem nenhum ali, o mais próximo de cada dia seguinte", async () => {
    banco.inserir("appointment", {
      id: "a1",
      clinic_id: CLINICA,
      professional_id: PROF.ana,
      starts_at: iso("2026-10-21", "15:00"),
      ends_at: iso("2026-10-21", "15:30"),
      status: "agendado",
    });
    const ocupada = await buscar({
      profissional: R_ANA,
      a_partir_de: "2026-10-21",
      hora: "15:00",
    });
    expect(ocupada.resultado).toBe("hora_pedida_ocupada");
    expect(ocupada.json).toMatchObject({
      hora_pedida: "15:00",
      dia_pedido: "quarta, 21/10",
    });
    // Os 3 mais proximos das 15:00 (14:30 e 15:30 a meia hora; 14:00 e
    // 16:00 a uma hora, o mais cedo primeiro), em ordem de tempo.
    expect((ocupada.json.horarios ?? []).map((h) => `${h.dia} ${h.hora}`)).toEqual([
      "quarta, 21/10 14:00",
      "quarta, 21/10 14:30",
      "quarta, 21/10 15:30",
    ]);
    // Sabado: a Dra. Ana nao atende; o mais proximo de cada dia seguinte.
    const sabado = await buscar({
      profissional: R_ANA,
      a_partir_de: "2026-10-24",
      hora: "10:00",
    });
    expect(sabado.resultado).toBe("hora_pedida_ocupada");
    expect((sabado.json.horarios ?? []).map((h) => `${h.dia} ${h.hora}`)).toEqual([
      "segunda, 26/10 10:00",
      "terça, 27/10 10:00",
      "quarta, 28/10 10:00",
    ]);
    // Hora fora do formato: entrada invalida.
    expect((await buscar({ hora: "15h" })).resultado).toBe("entrada_invalida");
  });
});

describe("a reconferência leve do horário oferecido antes", () => {
  it("livre agora, ou não (consulta, unidade inativa, antecedência)", async () => {
    const horario: {
      codigo: string;
      serviceLinkId: string;
      unidadeId: string | null;
      inicio: string;
      fim: string;
    } = {
      codigo: "h3",
      serviceLinkId: VINC.consultaAna,
      unidadeId: UNID.centro,
      inicio: iso("2026-10-21", "14:00"),
      fim: iso("2026-10-21", "14:30"),
    };
    const pedido = pedidoDaReconferencia(CATALOGO, [horario]);
    expect(pedido?.profissionais).toEqual([PROF.ana]);
    const porta = portaDaAgendaDoWhatsapp(banco.cliente(), {
      clinicId: CLINICA,
      conversationId: CONVERSA,
      contactId: CONTATO,
      jobId: JOB,
      agora: () => AGORA,
    });
    const conferir = async (h = horario) =>
      horarioContinuaLivre({
        catalogo: CATALOGO,
        agenda: await porta.carregar(pedidoDaReconferencia(CATALOGO, [h])!),
        config: AGENDA,
        horario: h,
        agoraMs: AGORA,
        fuso: FUSO,
      });
    expect(await conferir()).toBe(true);
    // Na Aldeota a Dra. Ana so atende de manha.
    expect(await conferir({ ...horario, unidadeId: UNID.aldeota })).toBe(false);
    // Unidade que nao esta entre as ativas.
    expect(await conferir({ ...horario, unidadeId: UNID.antiga })).toBe(false);
    // Dentro da antecedencia.
    expect(
      await conferir({
        ...horario,
        unidadeId: UNID.aldeota,
        inicio: iso("2026-10-20", "10:00"),
        fim: iso("2026-10-20", "10:30"),
      }),
    ).toBe(false);
    banco.inserir("appointment", {
      id: "a2",
      clinic_id: CLINICA,
      professional_id: PROF.ana,
      starts_at: iso("2026-10-21", "14:00"),
      ends_at: iso("2026-10-21", "14:30"),
      status: "agendado",
    });
    expect(await conferir()).toBe(false);
  });
});
