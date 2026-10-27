import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  carregarAgendaDaIa,
  portaDaAgendaDoWhatsapp,
} from "@/lib/agente/agenda";
import {
  criarAgendaDoTurno,
  type PortaDaAgenda,
} from "@/lib/agente/ferramentas/agenda-do-turno";
import { MINUTOS_DA_RESERVA } from "@/lib/agente/ferramentas/reservar-horario";
import { PRAZO_DO_TURNO_MS } from "@/lib/agente/laco";
import {
  AGENDA_VAZIA,
  diaEHora,
  entradaDaBuscaDeHorarioSchema,
  escolherHorarios,
  FERRAMENTA_BUSCAR_HORARIO,
  FOLGA_DA_ANTECEDENCIA_MS,
  fusoDaAgenda,
  planejarBuscaDeHorario,
} from "@/lib/agente/ferramentas/buscar-horario";
import { agendaPadrao } from "@/lib/domain/agente/config";

import type { AgendaEmMemoria } from "./agenda-em-memoria";
import {
  AGENDA,
  AGORA,
  bancoComJornadas,
  catalogoDaAgenda,
  CLINICA,
  codigoDoProcedimento,
  codigoDoProfissional,
  configComAgenda,
  CONTATO,
  CONV,
  CONVERSA,
  FUSO,
  iso,
  JOB,
  OUTRA_CONVERSA,
  PROC,
  PROF,
  SALA,
  VINC,
} from "./agenda-fixtures";

// buscar_horario (E4) de ponta a ponta sobre um banco em memoria: o
// carregador (lib/agente/agenda.ts) le jornada, bloqueio, consulta, reserva
// viva de outra conversa e recurso, sempre com o clinic_id e sem nenhuma
// coluna de paciente; a busca (ferramentas/buscar-horario.ts) escolhe os 3
// primeiros horarios livres no fuso da clinica, da antecedencia ao
// horizonte. Nenhum teste fala com o banco nem com a OpenAI.

const CATALOGO = catalogoDaAgenda();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const P_LIMPEZA = codigoDoProcedimento(CATALOGO, PROC.limpeza);
const P_EXAME = codigoDoProcedimento(CATALOGO, PROC.exame);
const R_ANA = codigoDoProfissional(CATALOGO, PROF.ana);
const R_BRUNO = codigoDoProfissional(CATALOGO, PROF.bruno);

type Pedido = {
  procedimento?: string;
  profissional?: string | null;
  convenio?: string | null;
  a_partir_de?: string | null;
  periodo?: "manha" | "tarde" | "noite" | null;
};

function argumentos(pedido: Pedido = {}) {
  return {
    procedimento: pedido.procedimento ?? P_CONSULTA,
    profissional: pedido.profissional ?? null,
    convenio: pedido.convenio ?? null,
    a_partir_de: pedido.a_partir_de ?? null,
    periodo: pedido.periodo ?? null,
  };
}

let banco: AgendaEmMemoria;

beforeEach(() => {
  banco = bancoComJornadas();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function porta(
  extra: { fuso?: string; conversa?: string } = {},
): PortaDaAgenda {
  return portaDaAgendaDoWhatsapp(banco.cliente(), {
    clinicId: CLINICA,
    conversationId: extra.conversa ?? CONVERSA,
    contactId: CONTATO,
    jobId: JOB,
    agora: () => AGORA,
  });
}

async function buscar(
  pedido: Pedido = {},
  extra: {
    fuso?: string;
    agenda?: typeof AGENDA;
    agoraMs?: number;
    precoLigado?: boolean;
    catalogo?: typeof CATALOGO;
  } = {},
) {
  const config = configComAgenda({ agenda: extra.agenda ?? AGENDA });
  if (extra.precoLigado === false) {
    config.habilidades = {
      ...config.habilidades,
      informar_preco_e_convenio: false,
    };
  }
  const turno = criarAgendaDoTurno({
    porta: porta(),
    catalogo: extra.catalogo ?? CATALOGO,
    config,
    agoraMs: extra.agoraMs ?? AGORA,
    fuso: extra.fuso ?? FUSO,
  });
  const r = await turno.executar("buscar_horario", argumentos(pedido));
  if (r.tipo !== "saida") {
    throw new Error(`esperava saida, veio ${r.tipo}`);
  }
  return {
    ...r,
    json: JSON.parse(r.saida) as Record<string, unknown> & {
      horarios?: {
        codigo: string;
        dia: string;
        hora: string;
        profissional: string;
        procedimento: string;
        duracao_min: number;
      }[];
    },
  };
}

function horas(r: Awaited<ReturnType<typeof buscar>>): string[] {
  return (r.json.horarios ?? []).map(
    (h) => `${h.dia} ${h.hora} ${h.profissional}`,
  );
}

describe("definição de buscar_horario", () => {
  it("é strict, exige todas as propriedades e bate com o Zod", () => {
    const parametros = FERRAMENTA_BUSCAR_HORARIO.parameters as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(FERRAMENTA_BUSCAR_HORARIO.strict).toBe(true);
    expect(parametros.additionalProperties).toBe(false);
    expect(Object.keys(parametros.properties).sort()).toEqual(
      Object.keys(entradaDaBuscaDeHorarioSchema.shape).sort(),
    );
    expect([...parametros.required].sort()).toEqual(
      Object.keys(parametros.properties).sort(),
    );
    expect(JSON.stringify(FERRAMENTA_BUSCAR_HORARIO)).not.toMatch(/[–—]/);
  });
});

describe("carregador: só horários, sempre com a clínica", () => {
  it("toda leitura leva o clinic_id e nenhuma pede coluna de paciente", async () => {
    await buscar();
    expect(banco.leituras.length).toBeGreaterThan(0);
    for (const leitura of banco.leituras) {
      expect(leitura.filtros, leitura.tabela).toContain(
        `eq:clinic_id=${CLINICA}`,
      );
      expect(leitura.colunas, leitura.tabela).not.toMatch(
        /contact|name|phone|notes|nome|telefone|\*/,
      );
    }
    const tabelas = new Set(banco.leituras.map((l) => l.tabela));
    expect(tabelas).toEqual(
      new Set([
        "professional_schedule",
        "professional_block",
        "appointment",
        "slot_hold",
      ]),
    );
    // A reserva viva: vencimento no futuro e nao consumida.
    const reservas = banco.leituras.find((l) => l.tabela === "slot_hold");
    expect(reservas?.filtros).toContain(
      `gt:expires_at=${new Date(AGORA).toISOString()}`,
    );
    expect(reservas?.filtros).toContain("is:consumido_em");
    // Consulta cancelada nao ocupa.
    const consultas = banco.leituras.find((l) => l.tabela === "appointment");
    expect(consultas?.filtros).toContain("not:status");
    expect(banco.escritas).toEqual([]);
    expect(banco.chamadas).toEqual([]);
  });

  it("leitura que falha lança (o turno falha fechado)", async () => {
    banco.comErro.add("professional_block");
    await expect(
      carregarAgendaDaIa(banco.cliente(), {
        clinicId: CLINICA,
        conversationId: CONVERSA,
        pedido: {
          profissionais: [PROF.ana],
          recursos: [],
          inicio: new Date(AGORA),
          fim: new Date(AGORA + 86_400_000),
        },
        agoraMs: AGORA,
      }),
    ).rejects.toThrow();
  });

  it("dado de outra clínica não entra", async () => {
    banco.inserir("appointment", {
      id: "ap-outra",
      clinic_id: "00000000-0000-4000-8000-0000000000ff",
      professional_id: PROF.ana,
      starts_at: iso("2026-10-20", "11:00"),
      ends_at: iso("2026-10-20", "12:00"),
      status: "agendado",
    });
    const r = await buscar({ profissional: R_ANA });
    expect(horas(r)[0]).toBe("terça, 20/10 11:15 Dra. Ana Lima");
  });
});

describe("buscar_horario: os 3 primeiros horários livres", () => {
  it("da antecedência em diante, em ordem de tempo, com códigos h1, h2, h3", async () => {
    const r = await buscar();
    expect(r.resultado).toBe("horarios");
    // Agora 09:00; antecedencia de 2 h e a folga de 5 min: 11:05, grade de
    // 15 min. A Dra. Ana fecha a manha as 12:00; o Dr. Bruno abre as 13:00.
    expect(horas(r)).toEqual([
      "terça, 20/10 11:15 Dra. Ana Lima",
      "terça, 20/10 11:30 Dra. Ana Lima",
      "terça, 20/10 13:00 Dr. Bruno Costa",
    ]);
    expect(r.json.horarios?.map((h) => h.codigo)).toEqual(["h1", "h2", "h3"]);
    expect(r.json.horarios?.[0]).toEqual({
      codigo: "h1",
      dia: "terça, 20/10",
      hora: "11:15",
      profissional: "Dra. Ana Lima",
      procedimento: "Consulta",
      duracao_min: 30,
    });
    expect(r.json.convenio).toBe("particular");
    // Nada de id no que vai ao modelo.
    expect(r.saida).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(r.passo).toContain("Consultou a agenda de Consulta, no particular");
    expect(r.passo).not.toMatch(/[–—]/);
  });

  // Revisao da E4: o agendar confere a antecedencia de novo na hora da
  // marcacao, ate 10 minutos depois da reserva. Com a folga de 5 minutos, o
  // primeiro horario oferecido podia ficar dentro da antecedencia antes de a
  // reserva vencer (a pessoa confirmava e o agendar dizia
  // antes_da_antecedencia).
  it("todo horário oferecido continua fora da antecedência até a reserva vencer", async () => {
    expect(FOLGA_DA_ANTECEDENCIA_MS).toBeGreaterThanOrEqual(
      MINUTOS_DA_RESERVA * 60_000 + PRAZO_DO_TURNO_MS,
    );
    for (let minutos = 0; minutos < 30; minutos += 1) {
      const agoraMs = AGORA + minutos * 60_000;
      const r = await buscar({ profissional: R_ANA }, { agoraMs });
      // O ultimo instante em que o agendar pode rodar: a reserva feita no
      // fim do turno (o prazo inteiro) mais os 10 minutos dela.
      const ultimaMarcacao =
        agoraMs + PRAZO_DO_TURNO_MS + MINUTOS_DA_RESERVA * 60_000;
      for (const h of r.json.horarios ?? []) {
        const inicio = Date.parse(
          iso(`2026-${h.dia.slice(-2)}-${h.dia.slice(-5, -3)}`, h.hora),
        );
        expect(
          inicio,
          `agora + ${minutos} min: ${h.dia} ${h.hora}`,
        ).toBeGreaterThanOrEqual(
          ultimaMarcacao + (AGENDA.antecedenciaHoras ?? 0) * 60 * 60_000,
        );
      }
    }
  });

  it("respeita a jornada: profissional, dia da semana e período", async () => {
    const tarde = await buscar({ periodo: "tarde" });
    expect(horas(tarde)).toEqual([
      "terça, 20/10 13:00 Dr. Bruno Costa",
      "terça, 20/10 13:15 Dr. Bruno Costa",
      "terça, 20/10 13:30 Dr. Bruno Costa",
    ]);
    // O Dr. Bruno so atende terca e quinta: a partir de quarta, quinta.
    const bruno = await buscar({
      profissional: R_BRUNO,
      a_partir_de: "2026-10-21",
    });
    expect(horas(bruno)[0]).toBe("quinta, 22/10 13:00 Dr. Bruno Costa");
    const noite = await buscar({ periodo: "noite" });
    expect(noite.resultado).toBe("sem_horario");
    expect(noite.json.ate).toBe("terça, 03/11");
  });

  it("bloqueio, consulta (encaixe inclusive) e reserva viva de outra conversa ocupam; a desta conversa e a cancelada não", async () => {
    banco.inserir("professional_block", {
      id: "b1",
      clinic_id: CLINICA,
      professional_id: PROF.ana,
      starts_at: iso("2026-10-20", "11:00"),
      ends_at: iso("2026-10-20", "12:00"),
    });
    banco.inserir(
      "appointment",
      {
        id: "a1",
        clinic_id: CLINICA,
        professional_id: PROF.ana,
        starts_at: iso("2026-10-20", "14:00"),
        ends_at: iso("2026-10-20", "14:30"),
        status: "agendado",
        is_overbooking: true,
      },
      {
        id: "a2",
        clinic_id: CLINICA,
        professional_id: PROF.ana,
        starts_at: iso("2026-10-20", "14:30"),
        ends_at: iso("2026-10-20", "15:00"),
        status: "cancelado_paciente",
      },
    );
    banco.inserir(
      "slot_hold",
      {
        id: "h1",
        clinic_id: CLINICA,
        professional_id: PROF.ana,
        conversation_id: OUTRA_CONVERSA,
        starts_at: iso("2026-10-20", "14:30"),
        ends_at: iso("2026-10-20", "15:00"),
        expires_at: new Date(AGORA + 5 * 60_000).toISOString(),
        consumido_em: null,
      },
      {
        // Reserva desta conversa: a RPC troca, entao nao ocupa.
        id: "h2",
        clinic_id: CLINICA,
        professional_id: PROF.ana,
        conversation_id: CONVERSA,
        starts_at: iso("2026-10-20", "15:00"),
        ends_at: iso("2026-10-20", "15:30"),
        expires_at: new Date(AGORA + 5 * 60_000).toISOString(),
        consumido_em: null,
      },
      {
        // Vencida: nao ocupa.
        id: "h3",
        clinic_id: CLINICA,
        professional_id: PROF.ana,
        conversation_id: OUTRA_CONVERSA,
        starts_at: iso("2026-10-20", "15:30"),
        ends_at: iso("2026-10-20", "16:00"),
        expires_at: new Date(AGORA - 60_000).toISOString(),
        consumido_em: null,
      },
      {
        // Consumida (virou consulta): nao conta como reserva.
        id: "h4",
        clinic_id: CLINICA,
        professional_id: PROF.ana,
        conversation_id: OUTRA_CONVERSA,
        starts_at: iso("2026-10-20", "16:00"),
        ends_at: iso("2026-10-20", "16:30"),
        expires_at: new Date(AGORA + 5 * 60_000).toISOString(),
        consumido_em: new Date(AGORA - 60_000).toISOString(),
      },
    );
    const r = await buscar({ profissional: R_ANA });
    expect(horas(r)).toEqual([
      "terça, 20/10 15:00 Dra. Ana Lima",
      "terça, 20/10 15:15 Dra. Ana Lima",
      "terça, 20/10 15:30 Dra. Ana Lima",
    ]);
  });

  it("recurso do procedimento ocupado por qualquer profissional", async () => {
    banco.inserir("appointment", {
      id: "a-sala",
      clinic_id: CLINICA,
      professional_id: PROF.bruno,
      resource_id: SALA,
      starts_at: iso("2026-10-20", "14:00"),
      ends_at: iso("2026-10-20", "15:00"),
      status: "confirmado_paciente",
    });
    const r = await buscar({ procedimento: P_LIMPEZA });
    // 60 min: a manha (11:15 + 60 > 12:00) nao cabe; a sala esta ocupada
    // das 14:00 as 15:00.
    expect(horas(r)).toEqual([
      "terça, 20/10 15:00 Dra. Ana Lima",
      "terça, 20/10 15:15 Dra. Ana Lima",
      "terça, 20/10 15:30 Dra. Ana Lima",
    ]);
    expect(r.json.horarios?.[0]?.duracao_min).toBe(60);
    expect(
      banco.leituras.some((l) => l.filtros.includes("in:resource_id")),
    ).toBe(true);
  });

  // Revisao da E4: a reserva viva de OUTRA conversa num vinculo de outro
  // profissional que usa a mesma sala ocupa a sala (a RPC confere o mesmo);
  // a desta conversa nao.
  it("reserva viva de outra conversa no mesmo recurso, por outro profissional, ocupa a sala", async () => {
    const LIMPEZA_BRUNO = "5a000000-0000-4000-8000-000000000006";
    const comSalaDoBruno = catalogoDaAgenda({
      vinculosExtras: [
        {
          id: LIMPEZA_BRUNO,
          procedure_id: PROC.limpeza,
          professional_id: PROF.bruno,
          price_cents: 12_000,
          duration_min: 60,
        },
      ],
    });
    const reservaDaSala = (conversa: string) => ({
      id: `h-sala-${conversa}`,
      clinic_id: CLINICA,
      professional_id: PROF.bruno,
      service_link_id: LIMPEZA_BRUNO,
      conversation_id: conversa,
      starts_at: iso("2026-10-20", "14:00"),
      ends_at: iso("2026-10-20", "15:00"),
      expires_at: new Date(AGORA + 5 * 60_000).toISOString(),
      consumido_em: null,
    });
    const P_LIMPEZA_AQUI = codigoDoProcedimento(comSalaDoBruno, PROC.limpeza);
    const R_ANA_AQUI = codigoDoProfissional(comSalaDoBruno, PROF.ana);
    banco.inserir("slot_hold", reservaDaSala(OUTRA_CONVERSA));
    const ocupada = await buscar(
      { procedimento: P_LIMPEZA_AQUI, profissional: R_ANA_AQUI },
      { catalogo: comSalaDoBruno },
    );
    // A Dra. Ana estaria livre as 14:00; a sala esta reservada ate as 15:00.
    expect(horas(ocupada)).toEqual([
      "terça, 20/10 15:00 Dra. Ana Lima",
      "terça, 20/10 15:15 Dra. Ana Lima",
      "terça, 20/10 15:30 Dra. Ana Lima",
    ]);
    const daSala = banco.leituras.filter(
      (l) =>
        l.tabela === "slot_hold" && l.filtros.includes("in:service_link_id"),
    );
    expect(daSala).toHaveLength(1);
    expect(daSala[0]?.filtros).toContain(`eq:clinic_id=${CLINICA}`);
    expect(daSala[0]?.filtros).toContain("is:consumido_em");
    expect(daSala[0]?.colunas).toBe(
      "service_link_id, conversation_id, starts_at, ends_at",
    );

    // A reserva da sala e desta conversa: nao ocupa.
    banco = bancoComJornadas();
    banco.inserir("slot_hold", reservaDaSala(CONVERSA));
    const livre = await buscar(
      { procedimento: P_LIMPEZA_AQUI, profissional: R_ANA_AQUI },
      { catalogo: comSalaDoBruno },
    );
    expect(horas(livre)[0]).toBe("terça, 20/10 14:00 Dra. Ana Lima");
  });

  it("no fuso da clínica, nunca em UTC", async () => {
    // As mesmas jornadas (hora local) em Manaus (UTC-4): agora sao 08:00.
    const r = await buscar({ profissional: R_ANA }, { fuso: "America/Manaus" });
    expect(horas(r)[0]).toBe("terça, 20/10 10:15 Dra. Ana Lima");
    expect(fusoDaAgenda("Fuso/Inexistente")).toBe(FUSO);
    expect(diaEHora(new Date(iso("2027-01-05", "08:00")), FUSO, AGORA)).toEqual(
      { dia: "terça, 05/01/2027", hora: "08:00" },
    );
  });

  it("antecedência e horizonte da configuração publicada", async () => {
    const semAntecedencia = await buscar(
      { profissional: R_ANA },
      { agenda: { antecedenciaHoras: 0, horizonteDias: 14 } },
    );
    expect(horas(semAntecedencia)[0]).toBe("terça, 20/10 09:15 Dra. Ana Lima");
    const umDia = await buscar(
      { profissional: R_ANA },
      { agenda: { antecedenciaHoras: 24, horizonteDias: 14 } },
    );
    expect(horas(umDia)[0]).toBe("quarta, 21/10 09:15 Dra. Ana Lima");
    // Horizonte de 1 dia com 24 h de antecedencia: nada cabe.
    const fechado = await buscar(
      { profissional: R_ANA },
      { agenda: { antecedenciaHoras: 24, horizonteDias: 1 } },
    );
    expect(fechado.resultado).toBe("sem_horario");
    // O dia pedido passa do horizonte.
    const longe = await buscar({ a_partir_de: "2026-12-01" });
    expect(longe.resultado).toBe("sem_horario");
    expect(longe.json.ate).toBe("terça, 03/11");
    expect(longe.passo).toContain("passa do horizonte");
    // O ultimo inicio e agora mais o horizonte: nada depois disso.
    const ultimo = await buscar(
      { profissional: R_ANA, a_partir_de: "2026-11-03" },
      { agenda: { antecedenciaHoras: 0, horizonteDias: 14 } },
    );
    expect(horas(ultimo)).toEqual([
      "terça, 03/11 08:00 Dra. Ana Lima",
      "terça, 03/11 08:15 Dra. Ana Lima",
      "terça, 03/11 08:30 Dra. Ana Lima",
    ]);
    const passou = await buscar(
      { profissional: R_ANA, a_partir_de: "2026-11-03", periodo: "tarde" },
      { agenda: { antecedenciaHoras: 0, horizonteDias: 14 } },
    );
    expect(passou.resultado).toBe("sem_horario");
  });

  it("o horário oferecido volta na busca do dia e do período dele (o modelo reserva pelo código da própria resposta)", async () => {
    const primeira = await buscar();
    const terceiro = primeira.json.horarios?.[2];
    expect(terceiro?.profissional).toBe("Dr. Bruno Costa");
    const deNovo = await buscar({
      profissional: R_BRUNO,
      a_partir_de: "2026-10-20",
      periodo: "tarde",
    });
    expect(deNovo.json.horarios?.[0]).toMatchObject({
      dia: terceiro?.dia,
      hora: terceiro?.hora,
      profissional: terceiro?.profissional,
    });
  });

  it("a segunda busca do turno continua a numeração (h4, h5...)", async () => {
    const turno = criarAgendaDoTurno({
      porta: porta(),
      catalogo: CATALOGO,
      config: configComAgenda(),
      agoraMs: AGORA,
      fuso: FUSO,
    });
    await turno.executar("buscar_horario", argumentos());
    const segunda = await turno.executar(
      "buscar_horario",
      argumentos({ a_partir_de: "2026-10-22" }),
    );
    expect(segunda.tipo).toBe("saida");
    const json = JSON.parse(
      segunda.tipo === "saida" ? segunda.saida : "{}",
    ) as { horarios: { codigo: string }[] };
    expect(json.horarios.map((h) => h.codigo)).toEqual(["h4", "h5", "h6"]);
  });
});

describe("buscar_horario: procedimento, profissional e convênio", () => {
  it("entrada fora do formato e data que não existe", async () => {
    for (const ruim of [
      {},
      { ...argumentos(), extra: 1 },
      { ...argumentos(), periodo: "madrugada" },
      { ...argumentos(), a_partir_de: "21/10/2026" },
      { ...argumentos(), a_partir_de: "2026-02-30" },
    ]) {
      const turno = criarAgendaDoTurno({
        porta: porta(),
        catalogo: CATALOGO,
        config: configComAgenda(),
        agoraMs: AGORA,
        fuso: FUSO,
      });
      const r = await turno.executar("buscar_horario", ruim);
      expect(r.tipo === "saida" && r.resultado, JSON.stringify(ruim)).toBe(
        "entrada_invalida",
      );
    }
  });

  it("agenda sem antecedência ou horizonte não busca (falha fechada)", async () => {
    const r = await buscar({}, { agenda: agendaPadrao() as typeof AGENDA });
    expect(r.resultado).toBe("agenda_nao_configurada");
    expect(banco.leituras).toEqual([]);
  });

  it("procedimento fora do índice, profissional desconhecido ou sem vínculo", async () => {
    expect((await buscar({ procedimento: "p99" })).resultado).toBe(
      "procedimento_nao_agendavel",
    );
    expect((await buscar({ profissional: "r9" })).resultado).toBe(
      "profissional_nao_encontrado",
    );
    // O Dr. Bruno nao faz Limpeza de pele pela IA.
    const semVinculo = await buscar({
      procedimento: P_LIMPEZA,
      profissional: R_BRUNO,
    });
    expect(semVinculo.resultado).toBe("procedimento_nao_agendavel");
    expect(semVinculo.json.profissional).toBe("Dr. Bruno Costa");
    // Exame so tem vinculo de convenio: no particular nao marca.
    expect((await buscar({ procedimento: P_EXAME })).resultado).toBe(
      "procedimento_nao_agendavel",
    );
    expect(banco.leituras).toEqual([]);
  });

  it("convênio identificado com vínculo: os horários dele", async () => {
    const r = await buscar({ convenio: "Unimed Nacional" });
    expect(r.resultado).toBe("horarios");
    expect(r.json.convenio).toBe("Unimed (Nacional)");
    // So a Dra. Ana atende Consulta pela Unimed.
    expect(new Set(r.json.horarios?.map((h) => h.profissional))).toEqual(
      new Set(["Dra. Ana Lima"]),
    );
    expect(r.passo).toContain("pelo convênio Unimed (Nacional)");
  });

  it("D14: convênio que o profissional não atende avisa e traz o particular do Cadastro", async () => {
    const r = await buscar({ convenio: "Amil" });
    expect(r.resultado).toBe("convenio_nao_atendido");
    expect(r.json).toMatchObject({
      procedimento: "Consulta",
      convenio: "Amil",
      atende_particular: true,
    });
    expect(r.json.particular).toEqual([
      {
        profissional: "Dr. Bruno Costa",
        situacao: "valor",
        valor: "R$ 280,00",
      },
      { profissional: "Dra. Ana Lima", situacao: "valor", valor: "R$ 300,00" },
    ]);
    // O valor entra no filtro do turno (so o que veio do Cadastro).
    expect([...r.precos].sort()).toEqual([28_000, 30_000]);
    // Com o profissional pedido, so o particular dele.
    const doBruno = await buscar({
      convenio: "Unimed Nacional",
      profissional: R_BRUNO,
    });
    expect(doBruno.resultado).toBe("convenio_nao_atendido");
    expect(doBruno.json.profissional).toBe("Dr. Bruno Costa");
    expect(doBruno.json.particular).toEqual([
      {
        profissional: "Dr. Bruno Costa",
        situacao: "valor",
        valor: "R$ 280,00",
      },
    ]);
    // Sem a habilidade de preco, sem valor: so que o particular existe.
    const semPreco = await buscar({ convenio: "Amil" }, { precoLigado: false });
    expect(semPreco.json.atende_particular).toBe(true);
    expect(semPreco.json).not.toHaveProperty("particular");
    expect(semPreco.precos).toEqual([]);
    // Sem particular no procedimento: o modelo passa para a equipe.
    const exame = await buscar({
      procedimento: P_EXAME,
      convenio: "Unimed Nacional",
    });
    expect(exame.resultado).toBe("convenio_nao_atendido");
    expect(exame.json.atende_particular).toBe(false);
    expect(exame.json).not.toHaveProperty("particular");
    expect(banco.leituras).toEqual([]);
  });

  // Revisao da E4 (D14): o catalogo do agente so traz vinculo com "IA pode
  // agendar". O vinculo ATIVO do convenio que a IA nao marca existe: o
  // profissional atende, so a equipe marca. Nunca "nao atende" nem o
  // particular empurrado com valor.
  it("D14: vínculo ativo do convênio que a IA não marca não é 'não atende': passa para a equipe, sem valor", async () => {
    const comAmilDaAna = catalogoDaAgenda({
      vinculosSoDaEquipe: [
        {
          procedure_id: PROC.consulta,
          professional_id: PROF.ana,
          insurance_id: CONV.amil,
        },
      ],
    });
    const r = await buscar({ convenio: "Amil" }, { catalogo: comAmilDaAna });
    expect(r.resultado).toBe("convenio_so_com_a_equipe");
    expect(r.json).toEqual({
      resultado: "convenio_so_com_a_equipe",
      procedimento: "Consulta",
      convenio: "Amil",
    });
    expect(r.saida).not.toMatch(/R\$/);
    expect(r.precos).toEqual([]);
    expect(r.passo).toBe(
      "Consultou a agenda de Consulta: o convênio Amil é atendido, mas só a equipe marca por ele",
    );
    // Com a Dra. Ana pedida, o mesmo; com o Dr. Bruno, que nao tem vinculo
    // nenhum da Amil na Consulta, continua o D14.
    expect(
      (
        await buscar(
          { convenio: "Amil", profissional: R_ANA },
          { catalogo: comAmilDaAna },
        )
      ).json,
    ).toMatchObject({
      resultado: "convenio_so_com_a_equipe",
      profissional: "Dra. Ana Lima",
    });
    expect(
      (
        await buscar(
          { convenio: "Amil", profissional: R_BRUNO },
          { catalogo: comAmilDaAna },
        )
      ).resultado,
    ).toBe("convenio_nao_atendido");
    expect(banco.leituras).toEqual([]);
  });

  it("D14: o vínculo só da equipe vale com convênio, de procedimento do índice, profissional e convênio ativos", () => {
    const catalogo = catalogoDaAgenda({
      vinculosSoDaEquipe: [
        // Particular: nao e convenio.
        {
          procedure_id: PROC.consulta,
          professional_id: PROF.ana,
          insurance_id: null,
        },
        // Profissional que nao esta no cadastro ativo.
        {
          procedure_id: PROC.consulta,
          professional_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          insurance_id: CONV.amil,
        },
        // Convenio que nao esta ativo no cadastro.
        {
          procedure_id: PROC.consulta,
          professional_id: PROF.ana,
          insurance_id: "c0c0c0c0-0000-4000-8000-0000000000ff",
        },
        // Procedimento fora do indice.
        {
          procedure_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          professional_id: PROF.ana,
          insurance_id: CONV.amil,
        },
        // O que vale.
        {
          procedure_id: PROC.limpeza,
          professional_id: PROF.ana,
          insurance_id: CONV.amil,
        },
      ],
    });
    expect(catalogo.conveniosSoComAEquipe).toEqual([
      {
        procedimentoId: PROC.limpeza,
        profissionalId: PROF.ana,
        convenioId: CONV.amil,
      },
    ]);
    // O vinculo so da equipe nao entra no que o agente informa (vinculos,
    // indice e convenios aceitos ficam como sem ele).
    const semEle = catalogoDaAgenda();
    expect(catalogo.vinculos).toEqual(semEle.vinculos);
    expect(catalogo.procedimentos).toEqual(semEle.procedimentos);
    expect(catalogo.convenios).toEqual(semEle.convenios);
    expect(semEle.conveniosSoComAEquipe).toEqual([]);
  });

  it("dúvida sobre o convênio volta como opções, sem valor, pela regra de buscar_procedimento", async () => {
    const plano = await buscar({ convenio: "Bradesco Saúde" });
    expect(plano.resultado).toBe("plano_nao_informado");
    expect(plano.json.planos_da_operadora).toEqual([
      {
        convenio: "Bradesco Saúde (Flex)",
        chamar_com: "Bradesco Saúde (Flex)",
      },
      { convenio: "Bradesco Saúde (Top)", chamar_com: "Bradesco Saúde (Top)" },
    ]);
    const duvida = await buscar({ convenio: "Unimed" });
    expect(duvida.resultado).toBe("convenio_nao_confirmado");
    expect(duvida.passo).toContain("parecidos no Cadastro");
    expect((await buscar({ convenio: "Golden Cross" })).resultado).toBe(
      "convenio_nao_encontrado",
    );
    expect((await buscar({ convenio: "tenho plano" })).resultado).toBe(
      "convenio_nao_informado",
    );
    for (const r of [plano, duvida]) {
      expect(r.saida).not.toMatch(/R\$/);
      expect(r.precos).toEqual([]);
    }
    // "particular" dito com palavras e o particular.
    expect((await buscar({ convenio: "no particular" })).resultado).toBe(
      "horarios",
    );
  });

  it("a trilha nunca cita o que o modelo mandou como convênio", async () => {
    const r = await buscar({ convenio: "Plano Secreto Xpto" });
    expect(r.passo).not.toContain("Xpto");
    expect(r.saida).not.toContain("Xpto");
  });
});

describe("escolherHorarios puro", () => {
  // AG2 (27/10/2026): sem jornada de nenhum profissional do pedido, a
  // agenda nao esta cadastrada (antes saia "sem horario", e o modelo
  // oferecia outro dia de uma agenda que nao existe).
  it("sem jornada de ninguém, agenda não cadastrada; com jornada e tudo ocupado, sem horário", () => {
    const plano = planejarBuscaDeHorario({
      catalogo: CATALOGO,
      agenda: AGENDA,
      argumentos: argumentos(),
      agoraMs: AGORA,
      fuso: FUSO,
      informarValor: true,
    });
    expect(plano.tipo).toBe("plano");
    if (plano.tipo !== "plano") {
      return;
    }
    expect(plano.pedido.profissionais.sort()).toEqual(
      [PROF.ana, PROF.bruno].sort(),
    );
    expect(plano.plano.vinculos.map((v) => v.id).sort()).toEqual(
      [VINC.consultaAna, VINC.consultaBruno].sort(),
    );
    const r = escolherHorarios(plano.plano, AGENDA_VAZIA, 1);
    expect(r.resultado).toBe("agenda_nao_cadastrada");
    expect(r.horarios).toEqual([]);
    expect(JSON.parse(r.saida)).toEqual({
      resultado: "agenda_nao_cadastrada",
      procedimento: "Consulta",
      convenio: "particular",
    });
    expect(r.passo).toBe(
      "Consultou a agenda de Consulta, no particular: a agenda de quem faz este procedimento não está cadastrada",
    );

    // Um dos dois com jornada basta para nao ser "agenda nao cadastrada":
    // com o horizonte inteiro bloqueado, e "sem horario".
    const tudoBloqueado = {
      ...AGENDA_VAZIA,
      jornadas: new Map([
        [
          PROF.ana,
          [1, 2, 3, 4, 5].map((weekday) => ({
            weekday,
            startsAt: "08:00:00",
            endsAt: "18:00:00",
          })),
        ],
      ]),
      bloqueios: new Map([
        [
          PROF.ana,
          [
            {
              startsAt: new Date(AGORA - 24 * 60 * 60_000),
              endsAt: new Date(AGORA + 60 * 24 * 60 * 60_000),
            },
          ],
        ],
      ]),
    };
    const semHorario = escolherHorarios(plano.plano, tudoBloqueado, 1);
    expect(semHorario.resultado).toBe("sem_horario");
    expect(semHorario.horarios).toEqual([]);
  });

  it("o profissional pedido sem jornada: agenda não cadastrada, com o nome dele na trilha", () => {
    const plano = planejarBuscaDeHorario({
      catalogo: CATALOGO,
      agenda: AGENDA,
      argumentos: argumentos({ profissional: R_BRUNO }),
      agoraMs: AGORA,
      fuso: FUSO,
      informarValor: true,
    });
    if (plano.tipo !== "plano") {
      throw new Error("esperava o plano");
    }
    const soDaAna = {
      ...AGENDA_VAZIA,
      jornadas: new Map([
        [PROF.ana, [{ weekday: 2, startsAt: "08:00:00", endsAt: "12:00:00" }]],
      ]),
    };
    const r = escolherHorarios(plano.plano, soDaAna, 1);
    expect(r.resultado).toBe("agenda_nao_cadastrada");
    expect(JSON.parse(r.saida)).toEqual({
      resultado: "agenda_nao_cadastrada",
      procedimento: "Consulta",
      convenio: "particular",
      profissional: "Dr. Bruno Costa",
    });
    expect(r.passo).toBe(
      "Consultou a agenda de Consulta com Dr. Bruno Costa, no particular: a agenda deste profissional não está cadastrada",
    );
  });
});
