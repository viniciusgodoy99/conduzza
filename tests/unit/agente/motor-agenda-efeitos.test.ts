import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  portaDaAgendaDoSimulador,
  portaDaAgendaDoWhatsapp,
} from "@/lib/agente/agenda";
import {
  entradaDoAgendarSchema,
  FERRAMENTA_AGENDAR,
  lerRespostaDoAgendar,
  MOTIVOS_DO_AGENDAR,
} from "@/lib/agente/ferramentas/agendar";
import {
  criarAgendaDoTurno,
  ROTULO_DO_MOTIVO_DA_AGENDA,
  type AgendaDoTurno,
  type PortaDaAgenda,
  type ResultadoDaFerramentaDeAgenda,
} from "@/lib/agente/ferramentas/agenda-do-turno";
import {
  consultaQueAguardaConfirmacao,
  entradaDaConfirmacaoSchema,
  FERRAMENTA_CONFIRMAR_PRESENCA,
} from "@/lib/agente/ferramentas/confirmar-presenca";
import {
  entradaDaReservaSchema,
  FERRAMENTA_RESERVAR_HORARIO,
  lerRespostaDaReserva,
  MOTIVOS_DA_CONFERENCIA,
  MOTIVOS_DA_RESERVA,
} from "@/lib/agente/ferramentas/reservar-horario";
import { ferramentaDoTurno } from "@/lib/agente/whatsapp";

import type { AgendaEmMemoria, Linha } from "./agenda-em-memoria";
import {
  AGORA,
  bancoComJornadas,
  catalogoDaAgenda,
  CLINICA,
  codigoDoProcedimento,
  configComAgenda,
  CONTATO,
  CONVERSA,
  FUSO,
  iso,
  JOB,
  PROC,
  VINC,
} from "./agenda-fixtures";

// reservar_horario, agendar e confirmar_presenca (E4) pelo executor do turno
// (ferramentas/agenda-do-turno.ts) e pelas RPCs de verdade do lado do codigo
// (lib/agente/agenda.ts), contra um banco em memoria que imita o CONTRATO das
// RPCs (idempotencia pelo job_id inclusive). Cada motivo vira a saida certa
// para o modelo; "ia_desligada" para o turno; erro e resposta fora do
// formato falham fechado; uma reserva, uma marcacao e uma confirmacao por
// turno; o simulador nao grava nada.

const CATALOGO = catalogoDaAgenda();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const DURACAO: Record<string, number> = Object.fromEntries(
  CATALOGO.vinculos.map((v) => [v.id, v.duracaoMin]),
);

let banco: AgendaEmMemoria;

/**
 * As RPCs do contrato (1.3 e 1.4) em memoria: a reserva e a consulta sao
 * idempotentes pelo job_id. `recusar` forca um motivo.
 */
function rpcsDoContrato(
  opcoes: {
    recusarReserva?: string | null;
    recusarAgendar?: string | null;
  } = {},
) {
  banco.rpc("reservar_horario_da_ia", (args) => {
    const jaTem = banco
      .linhas("slot_hold")
      .find((h) => h.job_id === args.p_job_id);
    if (jaTem) {
      return {
        data: {
          ok: true,
          hold_id: jaTem.id,
          starts_at: jaTem.starts_at,
          ends_at: jaTem.ends_at,
          expires_at: jaTem.expires_at,
          reutilizado: true,
        },
        error: null,
      };
    }
    if (opcoes.recusarReserva) {
      return {
        data: { ok: false, motivo: opcoes.recusarReserva },
        error: null,
      };
    }
    const inicio = String(args.p_starts_at);
    const fim = new Date(
      Date.parse(inicio) +
        (DURACAO[String(args.p_service_link_id)] ?? 30) * 60_000,
    ).toISOString();
    const hold: Linha = {
      id: randomUUID(),
      clinic_id: args.p_clinic_id,
      conversation_id: args.p_conversation_id,
      service_link_id: args.p_service_link_id,
      job_id: args.p_job_id,
      starts_at: inicio,
      ends_at: fim,
      expires_at: new Date(AGORA + 10 * 60_000).toISOString(),
      consumido_em: null,
    };
    banco.inserir("slot_hold", hold);
    return {
      data: {
        ok: true,
        hold_id: hold.id,
        starts_at: inicio,
        ends_at: fim,
        expires_at: hold.expires_at,
        reutilizado: false,
      },
      error: null,
    };
  });
  banco.rpc("agendar_pela_ia", (args) => {
    const consumida = banco
      .linhas("slot_hold")
      .find((h) => h.job_id_do_agendar === args.p_job_id);
    if (consumida) {
      return {
        data: {
          ok: true,
          appointment_id: consumida.appointment_id,
          starts_at: consumida.starts_at,
          ends_at: consumida.ends_at,
          reutilizado: true,
        },
        error: null,
      };
    }
    if (opcoes.recusarAgendar) {
      return {
        data: { ok: false, motivo: opcoes.recusarAgendar },
        error: null,
      };
    }
    const viva = banco
      .linhas("slot_hold")
      .find(
        (h) =>
          h.conversation_id === args.p_conversation_id &&
          h.consumido_em === null,
      );
    if (!viva) {
      return {
        data: { ok: false, motivo: "reserva_inexistente" },
        error: null,
      };
    }
    const consulta: Linha = {
      id: randomUUID(),
      clinic_id: args.p_clinic_id,
      contact_id: CONTATO,
      service_link_id: viva.service_link_id,
      starts_at: viva.starts_at,
      ends_at: viva.ends_at,
      status: "agendado",
      created_by: "ia",
      approval_status: "pendente",
    };
    banco.inserir("appointment", consulta);
    Object.assign(viva, {
      consumido_em: new Date(AGORA).toISOString(),
      appointment_id: consulta.id,
      job_id_do_agendar: args.p_job_id,
    });
    return {
      data: {
        ok: true,
        appointment_id: consulta.id,
        starts_at: consulta.starts_at,
        ends_at: consulta.ends_at,
        reutilizado: false,
      },
      error: null,
    };
  });
}

function portaDoWhatsapp(jobId = JOB): PortaDaAgenda {
  return portaDaAgendaDoWhatsapp(banco.cliente(), {
    clinicId: CLINICA,
    conversationId: CONVERSA,
    contactId: CONTATO,
    jobId,
    agora: () => AGORA,
  });
}

function turnoCom(porta: PortaDaAgenda | null): AgendaDoTurno {
  return criarAgendaDoTurno({
    porta,
    catalogo: CATALOGO,
    config: configComAgenda(),
    agoraMs: AGORA,
    fuso: FUSO,
  });
}

function json(r: ResultadoDaFerramentaDeAgenda): Record<string, unknown> {
  expect(r.tipo).toBe("saida");
  return r.tipo === "saida"
    ? (JSON.parse(r.saida) as Record<string, unknown>)
    : {};
}

const BUSCA_DA_ANA = {
  procedimento: P_CONSULTA,
  profissional: null,
  convenio: null,
  a_partir_de: null,
  periodo: "manha",
};

beforeEach(() => {
  banco = bancoComJornadas();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("definições das ferramentas de efeito", () => {
  it("são strict e batem com o Zod, sem travessão", () => {
    for (const [ferramenta, schema] of [
      [FERRAMENTA_RESERVAR_HORARIO, entradaDaReservaSchema],
      [FERRAMENTA_AGENDAR, entradaDoAgendarSchema],
      [FERRAMENTA_CONFIRMAR_PRESENCA, entradaDaConfirmacaoSchema],
    ] as const) {
      const parametros = ferramenta.parameters as {
        properties: Record<string, unknown>;
        required: string[];
        additionalProperties: boolean;
      };
      expect(ferramenta.strict).toBe(true);
      expect(parametros.additionalProperties).toBe(false);
      expect(Object.keys(parametros.properties).sort()).toEqual(
        Object.keys(schema.shape).sort(),
      );
      expect([...parametros.required].sort()).toEqual(
        Object.keys(parametros.properties).sort(),
      );
      expect(JSON.stringify(ferramenta)).not.toMatch(/[–—]/);
    }
    for (const texto of Object.values(ROTULO_DO_MOTIVO_DA_AGENDA)) {
      expect(texto).not.toMatch(/[–—]/);
    }
  });

  it("a resposta da RPC é lida sem confiar no formato", () => {
    expect(
      lerRespostaDaReserva({
        ok: true,
        hold_id: "x",
        starts_at: "2026-10-20T14:15:00Z",
        ends_at: "2026-10-20T14:45:00Z",
        expires_at: "2026-10-20T12:10:00Z",
        reutilizado: false,
      }),
    ).toMatchObject({ ok: true, reutilizado: false, serviceLinkId: null });
    // AG3: o id da reserva e a unidade voltam (o estado guarda).
    expect(
      lerRespostaDaReserva({
        ok: true,
        hold_id: "h",
        starts_at: "2026-10-20T14:15:00Z",
        ends_at: "2026-10-20T14:45:00Z",
        expires_at: "2026-10-20T12:10:00Z",
        reutilizado: false,
        unit_id: "u",
      }),
    ).toMatchObject({ ok: true, holdId: "h", unitId: "u" });
    for (const motivo of MOTIVOS_DA_CONFERENCIA) {
      expect(lerRespostaDaReserva({ ok: false, motivo })).toEqual({
        ok: false,
        motivo,
      });
    }
    // Revisao final da AG3: ja_tem_consulta traz a consulta que ja existe
    // (o id e o inicio, nulos quando a RPC nao trouxe).
    expect(MOTIVOS_DA_RESERVA).toContain("ja_tem_consulta");
    expect(
      lerRespostaDaReserva({
        ok: false,
        motivo: "ja_tem_consulta",
        appointment_id: "a1",
        starts_at: "2026-10-27T13:00:00Z",
      }),
    ).toEqual({
      ok: false,
      motivo: "ja_tem_consulta",
      appointmentId: "a1",
      inicio: "2026-10-27T13:00:00Z",
    });
    expect(
      lerRespostaDaReserva({ ok: false, motivo: "ja_tem_consulta" }),
    ).toEqual({
      ok: false,
      motivo: "ja_tem_consulta",
      appointmentId: null,
      inicio: null,
    });
    for (const ruim of [
      null,
      [],
      "ok",
      { ok: true },
      { ok: true, starts_at: "ontem", ends_at: "hoje" },
      { ok: false, motivo: "motivo_novo" },
      { ok: "true" },
    ]) {
      expect(lerRespostaDaReserva(ruim), JSON.stringify(ruim)).toBeNull();
    }
    expect(
      lerRespostaDoAgendar({ ok: true, appointment_id: "a", starts_at: "x" }),
    ).toMatchObject({ ok: true, inicio: null });
    for (const motivo of MOTIVOS_DO_AGENDAR.filter(
      (m) => m !== "ja_tem_consulta" && m !== "faltam_dados",
    )) {
      expect(lerRespostaDoAgendar({ ok: false, motivo })).toEqual({
        ok: false,
        motivo,
      });
    }
    // AG3: ja_tem_consulta traz a consulta que existe; faltam_dados, a
    // lista (sem ela, ninguem sabe o que pedir: fora do formato).
    expect(
      lerRespostaDoAgendar({
        ok: false,
        motivo: "ja_tem_consulta",
        appointment_id: "a1",
      }),
    ).toEqual({ ok: false, motivo: "ja_tem_consulta", appointmentId: "a1" });
    expect(
      lerRespostaDoAgendar({ ok: false, motivo: "ja_tem_consulta" }),
    ).toEqual({ ok: false, motivo: "ja_tem_consulta", appointmentId: null });
    expect(
      lerRespostaDoAgendar({
        ok: false,
        motivo: "faltam_dados",
        faltam: ["nome_completo", "cpf"],
      }),
    ).toEqual({
      ok: false,
      motivo: "faltam_dados",
      faltam: ["nome_completo", "cpf"],
    });
    for (const faltam of [undefined, [], ["rg"], "cpf"]) {
      expect(
        lerRespostaDoAgendar({ ok: false, motivo: "faltam_dados", faltam }),
        JSON.stringify(faltam),
      ).toBeNull();
    }
    expect(
      lerRespostaDoAgendar({ ok: true, appointment_id: "a2" }),
    ).toMatchObject({ ok: true, appointmentId: "a2" });
    expect(lerRespostaDoAgendar({ ok: true })).toBeNull();
    expect(lerRespostaDoAgendar({ ok: false, motivo: "outro" })).toBeNull();
  });
});

// A migration e da frente de banco desta leva: sem ela no disco, o
// cruzamento fica pulado (e aparece como pulado na saida).
const MIGRATION_DA_AGENDA = "supabase/migrations/20261020130000_ia_agenda.sql";

describe("espelho dos motivos das RPCs", () => {
  it.skipIf(!existsSync(MIGRATION_DA_AGENDA))(
    "todo motivo que a migration devolve e conhecido do codigo (senao a resposta seria fora do formato)",
    () => {
      const sql = readFileSync(MIGRATION_DA_AGENDA, "utf-8");
      const daConferencia = new Set(
        [...sql.matchAll(/o_motivo := '([a-z_]+)'/g)].map((m) => m[1]),
      );
      const devolvidos = new Set([
        ...daConferencia,
        ...[...sql.matchAll(/'motivo', '([a-z_]+)'/g)].map((m) => m[1]),
        ...[...sql.matchAll(/then '([a-z_]+)' else v_conf\.o_motivo/g)].map(
          (m) => m[1],
        ),
      ]);
      expect(daConferencia.size).toBeGreaterThan(0);
      for (const motivo of daConferencia) {
        expect(MOTIVOS_DA_RESERVA as readonly string[], motivo).toContain(
          motivo,
        );
      }
      for (const motivo of devolvidos) {
        expect(MOTIVOS_DO_AGENDAR as readonly string[], motivo).toContain(
          motivo,
        );
      }
    },
  );
});

describe("reservar_horario", () => {
  it("reserva o horário do código pela RPC, com o job do turno, e diz dia, hora e nomes", async () => {
    rpcsDoContrato();
    const turno = turnoCom(portaDoWhatsapp());
    const busca = json(await turno.executar("buscar_horario", BUSCA_DA_ANA));
    expect((busca.horarios as { codigo: string }[])[1]?.codigo).toBe("h2");
    const r = await turno.executar("reservar_horario", { horario: "H2" });
    // AG3: a unidade do horario (sem unidade cadastrada, nula) e se e
    // particular ou pelo convenio, para a pergunta "Confirma ...?".
    expect(json(r)).toEqual({
      resultado: "reservado",
      minutos: 10,
      dia: "quarta, 21/10",
      hora: "08:00",
      profissional: "Dra. Ana Lima",
      procedimento: "Consulta",
      unidade: null,
      pagamento: "particular",
    });
    expect(banco.chamadasDe("reservar_horario_da_ia")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_conversation_id: CONVERSA,
        p_service_link_id: VINC.consultaAna,
        p_starts_at: iso("2026-10-21", "08:00"),
        p_job_id: JOB,
        p_unit_id: null,
      },
    ]);
    expect(r.tipo === "saida" && r.passo).toBe(
      "Reservou quarta, 21/10 às 08:00 (Consulta, Dra. Ana Lima) por 10 minutos",
    );
  });

  it("código que a busca deste turno não trouxe não chega à RPC", async () => {
    rpcsDoContrato();
    const turno = turnoCom(portaDoWhatsapp());
    expect(
      json(await turno.executar("reservar_horario", { horario: "h1" })),
    ).toEqual({ resultado: "codigo_invalido" });
    expect(
      json(await turno.executar("reservar_horario", { hora: "h1" })),
    ).toEqual({ resultado: "entrada_invalida" });
    expect(banco.chamadasDe("reservar_horario_da_ia")).toEqual([]);
  });

  it("uma reserva por turno: a segunda é recusada sem chamar a RPC", async () => {
    rpcsDoContrato();
    const turno = turnoCom(portaDoWhatsapp());
    await turno.executar("buscar_horario", BUSCA_DA_ANA);
    await turno.executar("reservar_horario", { horario: "h1" });
    const segunda = await turno.executar("reservar_horario", { horario: "h2" });
    expect(json(segunda)).toEqual({ resultado: "uma_reserva_por_resposta" });
    expect(banco.chamadasDe("reservar_horario_da_ia")).toHaveLength(1);
    expect(banco.linhas("slot_hold")).toHaveLength(1);
  });

  it.each(MOTIVOS_DA_CONFERENCIA.filter((m) => m !== "ia_desligada"))(
    "motivo %s vira a saída do modelo, com o dia e a hora pedidos",
    async (motivo) => {
      rpcsDoContrato({ recusarReserva: motivo });
      const turno = turnoCom(portaDoWhatsapp());
      await turno.executar("buscar_horario", BUSCA_DA_ANA);
      const r = await turno.executar("reservar_horario", { horario: "h1" });
      expect(json(r)).toEqual({
        resultado: motivo,
        dia: "terça, 20/10",
        hora: "11:30",
      });
      expect(r.tipo === "saida" && r.passo).toBe(
        `Tentou reservar terça, 20/10 às 11:30: ${ROTULO_DO_MOTIVO_DA_AGENDA[motivo]}`,
      );
    },
  );

  it("ia_desligada para o turno (a liberação caiu)", async () => {
    rpcsDoContrato({ recusarReserva: "ia_desligada" });
    const turno = turnoCom(portaDoWhatsapp());
    await turno.executar("buscar_horario", BUSCA_DA_ANA);
    const r = await turno.executar("reservar_horario", { horario: "h1" });
    expect(r.tipo).toBe("liberacao_suspensa");
  });

  it("erro, prazo ou resposta fora do formato falham fechado", async () => {
    for (const resposta of [
      { data: null, error: { code: "57014" } },
      {
        data: { ok: false, motivo: "motivo_que_ninguem_conhece" },
        error: null,
      },
      { data: { ok: true }, error: null },
    ]) {
      banco = bancoComJornadas();
      banco.rpc("reservar_horario_da_ia", () => resposta);
      const turno = turnoCom(portaDoWhatsapp());
      await turno.executar("buscar_horario", BUSCA_DA_ANA);
      const r = await turno.executar("reservar_horario", { horario: "h1" });
      expect(r.tipo, JSON.stringify(resposta)).toBe("falha");
    }
  });

  it("repetir o job devolve a mesma reserva, com os nomes do vínculo DELA", async () => {
    rpcsDoContrato();
    const primeira = turnoCom(portaDoWhatsapp());
    await primeira.executar("buscar_horario", BUSCA_DA_ANA);
    await primeira.executar("reservar_horario", { horario: "h1" });
    // A mesma tentativa de novo (o job voltou para a fila), e o modelo
    // escolheu outro horario: a RPC devolve a reserva que o job ja tinha.
    const repetida = turnoCom(portaDoWhatsapp());
    await repetida.executar("buscar_horario", BUSCA_DA_ANA);
    const r = await repetida.executar("reservar_horario", { horario: "h2" });
    expect(json(r)).toEqual({
      resultado: "reservado",
      minutos: 10,
      dia: "terça, 20/10",
      hora: "11:30",
      profissional: "Dra. Ana Lima",
      procedimento: "Consulta",
      unidade: null,
      pagamento: "particular",
    });
    expect(banco.linhas("slot_hold")).toHaveLength(1);
    // O vinculo da reserva reaproveitada foi lido do banco.
    expect(
      banco.leituras.some(
        (l) => l.tabela === "slot_hold" && l.colunas === "service_link_id",
      ),
    ).toBe(true);
  });
});

describe("agendar", () => {
  async function reservarNumTurno(jobId: string) {
    const turno = turnoCom(portaDoWhatsapp(jobId));
    await turno.executar("buscar_horario", BUSCA_DA_ANA);
    await turno.executar("reservar_horario", { horario: "h1" });
  }

  it("marca a consulta pendente da reserva viva da conversa, com o job do turno", async () => {
    rpcsDoContrato();
    await reservarNumTurno("20000000-0000-4000-8000-000000000001");
    const turno = turnoCom(portaDoWhatsapp());
    const r = await turno.executar("agendar", {});
    expect(json(r)).toEqual({
      resultado: "marcado",
      pendente: true,
      dia: "terça, 20/10",
      hora: "11:30",
      profissional: "Dra. Ana Lima",
      procedimento: "Consulta",
    });
    expect(banco.chamadasDe("agendar_pela_ia")).toEqual([
      { p_clinic_id: CLINICA, p_conversation_id: CONVERSA, p_job_id: JOB },
    ]);
    expect(r.tipo === "saida" && r.passo).toBe(
      "Marcou a consulta de terça, 20/10 às 11:30 (Consulta, Dra. Ana Lima), pendente de aprovação da equipe",
    );
  });

  it("no turno que tentou reservar (mesmo sem conseguir), sem_confirmacao_do_paciente sem chamar a RPC", async () => {
    // A reserva viva de um turno anterior e de outro horario: marcar agora
    // usaria ela.
    rpcsDoContrato();
    await reservarNumTurno("20000000-0000-4000-8000-000000000001");
    banco.rpc("reservar_horario_da_ia", () => ({
      data: { ok: false, motivo: "ocupado" },
      error: null,
    }));
    const turno = turnoCom(portaDoWhatsapp());
    await turno.executar("buscar_horario", BUSCA_DA_ANA);
    expect(
      json(await turno.executar("reservar_horario", { horario: "h2" })),
    ).toMatchObject({ resultado: "ocupado" });
    expect(json(await turno.executar("agendar", {}))).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(banco.chamadasDe("agendar_pela_ia")).toEqual([]);
  });

  // Revisao da E4: a trava so armava com codigo valido. Um reservar com
  // codigo que a busca do turno nao trouxe (ou fora do formato) deixava o
  // agendar seguinte ir a RPC e marcar a reserva viva de um turno anterior,
  // enquanto a pessoa escolhia outro horario.
  it.each([
    [
      "código que a busca do turno não trouxe",
      { horario: "h2" },
      "codigo_invalido",
    ],
    ["pedido fora do formato", { hora: "h1" }, "entrada_invalida"],
  ])(
    "reservar com %s também é o turno da escolha: agendar não chega à RPC",
    async (_caso, argumentos, resultado) => {
      rpcsDoContrato();
      await reservarNumTurno("20000000-0000-4000-8000-000000000001");
      const turno = turnoCom(portaDoWhatsapp());
      expect(
        json(await turno.executar("reservar_horario", argumentos)),
      ).toEqual({ resultado });
      expect(json(await turno.executar("agendar", {}))).toEqual({
        resultado: "sem_confirmacao_do_paciente",
      });
      expect(banco.chamadasDe("agendar_pela_ia")).toEqual([]);
      expect(banco.linhas("appointment")).toEqual([]);
    },
  );

  it("no mesmo turno da reserva, sem_confirmacao_do_paciente sem chamar a RPC", async () => {
    rpcsDoContrato();
    const turno = turnoCom(portaDoWhatsapp());
    await turno.executar("buscar_horario", BUSCA_DA_ANA);
    await turno.executar("reservar_horario", { horario: "h1" });
    expect(json(await turno.executar("agendar", {}))).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(banco.chamadasDe("agendar_pela_ia")).toEqual([]);
  });

  it("uma marcação por turno, e repetir o job devolve a MESMA consulta", async () => {
    rpcsDoContrato();
    await reservarNumTurno("20000000-0000-4000-8000-000000000001");
    const turno = turnoCom(portaDoWhatsapp());
    await turno.executar("agendar", {});
    expect(json(await turno.executar("agendar", {}))).toEqual({
      resultado: "uma_marcacao_por_resposta",
    });
    const repetido = turnoCom(portaDoWhatsapp());
    expect(json(await repetido.executar("agendar", {}))).toMatchObject({
      resultado: "marcado",
      pendente: true,
      hora: "11:30",
    });
    expect(banco.chamadasDe("agendar_pela_ia")).toHaveLength(2);
    expect(banco.linhas("appointment")).toHaveLength(1);
  });

  // AG3: as quatro recusas novas tem saida propria (abaixo); revisao final
  // da AG3, reserva_diferente tambem (le a reserva viva).
  const RECUSAS_DA_AG3: readonly string[] = [
    "consulta_para_outra_pessoa",
    "menor_de_idade",
    "ja_tem_consulta",
    "faltam_dados",
    "reserva_diferente",
  ];
  it.each(
    MOTIVOS_DO_AGENDAR.filter(
      (m) => m !== "ia_desligada" && !RECUSAS_DA_AG3.includes(m),
    ),
  )("motivo %s vira a saída do modelo", async (motivo) => {
    rpcsDoContrato({ recusarAgendar: motivo });
    const turno = turnoCom(portaDoWhatsapp());
    const r = await turno.executar("agendar", {});
    expect(json(r)).toEqual({ resultado: motivo });
    expect(r.tipo === "saida" && r.passo).toBe(
      `Tentou marcar a consulta: ${ROTULO_DO_MOTIVO_DA_AGENDA[motivo]}`,
    );
  });

  it.each(["consulta_para_outra_pessoa", "menor_de_idade"] as const)(
    "AG3: %s passa a conversa para a equipe (D-8), com o motivo do banco",
    async (motivo) => {
      rpcsDoContrato({ recusarAgendar: motivo });
      const r = await turnoCom(portaDoWhatsapp()).executar("agendar", {});
      expect(r).toEqual({
        tipo: "passar",
        motivo,
        resultado: motivo,
        passo: `Não marcou a consulta: ${ROTULO_DO_MOTIVO_DA_AGENDA[motivo]}`,
      });
    },
  );

  it("AG3: ja_tem_consulta diz só o dia e a hora da consulta que já existe", async () => {
    const existente = {
      id: "ab000000-0000-4000-8000-000000000001",
      clinic_id: CLINICA,
      contact_id: CONTATO,
      professional_id: "x",
      service_link_id: VINC.consultaBruno,
      status: "agendado",
      approval_status: "aprovado",
      starts_at: iso("2026-10-27", "10:00"),
      ends_at: iso("2026-10-27", "10:30"),
    };
    banco.inserir("appointment", existente);
    banco.rpc("agendar_pela_ia", () => ({
      data: {
        ok: false,
        motivo: "ja_tem_consulta",
        appointment_id: existente.id,
      },
      error: null,
    }));
    const r = await turnoCom(portaDoWhatsapp()).executar("agendar", {});
    expect(json(r)).toEqual({
      resultado: "ja_tem_consulta",
      dia: "terça, 27/10",
      hora: "10:00",
    });
    // Nada de profissional, procedimento nem id ao modelo.
    expect(r.tipo === "saida" && r.saida).not.toMatch(/Bruno|Consulta|ab000000/);
    // Revisao final da AG3: a consulta lida com o dia e a hora dela (e a
    // unidade, nula aqui).
    expect(r.tipo === "saida" && r.fatos).toEqual({
      consultaLida: true,
      consultaComHorario: {
        dia: "terça, 27/10",
        hora: "10:00",
        unidade: null,
        marcadaNestaConversa: false,
      },
    });
    // A leitura da consulta: do contato da conversa, so o inicio, o estado
    // e a unidade.
    const leitura = banco.leituras.find((l) => l.tabela === "appointment");
    expect(leitura?.colunas).toBe("starts_at, status, approval_status, unit_id");
    expect(leitura?.filtros).toEqual(
      expect.arrayContaining([
        `eq:clinic_id=${CLINICA}`,
        `eq:contact_id=${CONTATO}`,
      ]),
    );
  });

  it("AG3: faltam_dados diz o que falta (a lista do banco)", async () => {
    banco.rpc("agendar_pela_ia", () => ({
      data: { ok: false, motivo: "faltam_dados", faltam: ["data_nascimento"] },
      error: null,
    }));
    const r = await turnoCom(portaDoWhatsapp()).executar("agendar", {});
    expect(json(r)).toEqual({
      resultado: "faltam_dados",
      faltam: ["data_nascimento"],
    });
    expect(r.tipo === "saida" && r.passo).toBe(
      "Não marcou: falta a data de nascimento",
    );
  });

  it("ia_desligada para o turno; erro falha fechado", async () => {
    rpcsDoContrato({ recusarAgendar: "ia_desligada" });
    expect(
      (await turnoCom(portaDoWhatsapp()).executar("agendar", {})).tipo,
    ).toBe("liberacao_suspensa");
    banco = bancoComJornadas();
    banco.rpc("agendar_pela_ia", () => ({
      data: null,
      error: { code: "XX000" },
    }));
    expect(
      (await turnoCom(portaDoWhatsapp()).executar("agendar", {})).tipo,
    ).toBe("falha");
    expect((await turnoCom(null).executar("agendar", {})).tipo).toBe("falha");
  });

  it("argumento a mais é entrada inválida", async () => {
    rpcsDoContrato();
    expect(
      json(await turnoCom(portaDoWhatsapp()).executar("agendar", { dia: "x" })),
    ).toEqual({ resultado: "entrada_invalida" });
    expect(banco.chamadasDe("agendar_pela_ia")).toEqual([]);
  });
});

describe("confirmar_presenca", () => {
  function consulta(extra: Partial<Linha>): Linha {
    return {
      id: randomUUID(),
      clinic_id: CLINICA,
      contact_id: CONTATO,
      professional_id: "x",
      service_link_id: VINC.consultaAna,
      status: "agendado",
      approval_status: null,
      starts_at: iso("2026-10-22", "10:00"),
      ends_at: iso("2026-10-22", "10:30"),
      ...extra,
    };
  }

  function rpcDeConfirmar(resposta?: unknown) {
    banco.rpc("confirmar_pelo_paciente", (args) => ({
      data: resposta ?? {
        ok: true,
        starts_at: banco
          .linhas("appointment")
          .find((c) => c.id === args.p_appointment_id)?.starts_at,
        timezone: FUSO,
      },
      error: null,
    }));
  }

  // Revisao da E4: com um horario reservado nesta conversa esperando a
  // confirmacao, o "confirmo" da pessoa e do horario reservado (agendar).
  // confirmar_presenca ali gravaria a confirmacao em OUTRA consulta dela.
  function reservaDaConversa(extra: Partial<Linha>): Linha {
    return {
      id: randomUUID(),
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      service_link_id: VINC.consultaAna,
      starts_at: iso("2026-10-23", "10:00"),
      ends_at: iso("2026-10-23", "10:30"),
      expires_at: new Date(AGORA + 5 * 60_000).toISOString(),
      consumido_em: null,
      ...extra,
    };
  }

  it("com um horário reservado nesta conversa, não confirma outra consulta: reserva_em_andamento, sem RPC", async () => {
    banco.inserir("appointment", consulta({}));
    banco.inserir("slot_hold", reservaDaConversa({}));
    rpcDeConfirmar();
    const r = await turnoCom(portaDoWhatsapp()).executar(
      "confirmar_presenca",
      {},
    );
    expect(json(r)).toEqual({ resultado: "reserva_em_andamento" });
    expect(r.tipo === "saida" && r.passo).toBe(
      "Não confirmou presença: há um horário reservado nesta conversa esperando a confirmação",
    );
    expect(banco.chamadasDe("confirmar_pelo_paciente")).toEqual([]);
    const daReserva = banco.leituras.find((l) => l.tabela === "slot_hold");
    expect(daReserva?.filtros).toEqual(
      expect.arrayContaining([
        `eq:clinic_id=${CLINICA}`,
        `eq:conversation_id=${CONVERSA}`,
        "is:consumido_em",
        `gt:expires_at=${new Date(AGORA).toISOString()}`,
      ]),
    );
  });

  it("a reserva consumida, vencida ou de outra conversa não impede a confirmação", async () => {
    banco.inserir("appointment", consulta({}));
    banco.inserir(
      "slot_hold",
      reservaDaConversa({ consumido_em: new Date(AGORA).toISOString() }),
      reservaDaConversa({
        expires_at: new Date(AGORA - 60_000).toISOString(),
      }),
      reservaDaConversa({
        conversation_id: "c0000000-0000-4000-8000-000000000009",
      }),
    );
    rpcDeConfirmar();
    const r = await turnoCom(portaDoWhatsapp()).executar(
      "confirmar_presenca",
      {},
    );
    expect(json(r)).toMatchObject({ resultado: "confirmada" });
    expect(banco.chamadasDe("confirmar_pelo_paciente")).toHaveLength(1);
  });

  it("uma consulta aguardando: confirma pela RPC, com a conversa (evento)", async () => {
    const minha = consulta({});
    banco.inserir("appointment", minha);
    rpcDeConfirmar();
    const r = await turnoCom(portaDoWhatsapp()).executar(
      "confirmar_presenca",
      {},
    );
    // LGPD (revisao da E4): a consulta pode ter sido marcada pela recepcao,
    // fora da conversa. Ao modelo vao so o dia e a hora; procedimento e
    // profissional ficam so na trilha da tela.
    expect(json(r)).toEqual({
      resultado: "confirmada",
      dia: "quinta, 22/10",
      hora: "10:00",
    });
    expect(r.tipo === "saida" && r.saida).not.toMatch(/Consulta|Ana Lima/);
    expect(r.tipo === "saida" && r.passo).toBe(
      "Confirmou a presença na consulta de quinta, 22/10 às 10:00 (Consulta, Dra. Ana Lima)",
    );
    expect(banco.chamadasDe("confirmar_pelo_paciente")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_appointment_id: minha.id,
        p_contact_id: CONTATO,
        p_conversation_id: CONVERSA,
      },
    ]);
  });

  it("consulta da IA pendente da equipe, passada ou de outro contato não conta", async () => {
    banco.inserir(
      "appointment",
      consulta({ approval_status: "pendente" }),
      consulta({ starts_at: iso("2026-10-19", "10:00") }),
      consulta({ contact_id: "c1000000-0000-4000-8000-000000000009" }),
      consulta({ status: "confirmado_paciente" }),
    );
    rpcDeConfirmar();
    const r = await turnoCom(portaDoWhatsapp()).executar(
      "confirmar_presenca",
      {},
    );
    expect(json(r)).toEqual({ resultado: "sem_consulta" });
    expect(banco.chamadasDe("confirmar_pelo_paciente")).toEqual([]);
    expect(
      consultaQueAguardaConfirmacao(
        {
          status: "aguardando_confirmacao",
          starts_at: iso("2026-10-22", "10:00"),
          approval_status: "aprovado",
        },
        AGORA,
      ),
    ).toBe(true);
  });

  it("mais de uma: o modelo passa para a equipe", async () => {
    banco.inserir(
      "appointment",
      consulta({}),
      consulta({
        starts_at: iso("2026-10-23", "10:00"),
        status: "aguardando_confirmacao",
      }),
    );
    rpcDeConfirmar();
    const r = await turnoCom(portaDoWhatsapp()).executar(
      "confirmar_presenca",
      {},
    );
    expect(json(r)).toEqual({ resultado: "mais_de_uma" });
    expect(banco.chamadasDe("confirmar_pelo_paciente")).toEqual([]);
  });

  it("a consulta mudou no meio (ja_tratado) é sem_consulta; uma confirmação por turno; erro falha", async () => {
    banco.inserir("appointment", consulta({}));
    rpcDeConfirmar({ ok: false, erro: "ja_tratado" });
    const turno = turnoCom(portaDoWhatsapp());
    expect(json(await turno.executar("confirmar_presenca", {}))).toEqual({
      resultado: "sem_consulta",
    });
    expect(json(await turno.executar("confirmar_presenca", {}))).toEqual({
      resultado: "uma_confirmacao_por_resposta",
    });
    banco.comErro.add("appointment");
    expect(
      (await turnoCom(portaDoWhatsapp()).executar("confirmar_presenca", {}))
        .tipo,
    ).toBe("falha");
  });
});

describe("simulador: a Agenda de verdade para buscar, nada gravado", () => {
  it("reservar, agendar e confirmar não chamam RPC nem escrevem", async () => {
    rpcsDoContrato();
    const porta = portaDaAgendaDoSimulador(banco.cliente(), {
      clinicId: CLINICA,
      agora: () => AGORA,
    });
    expect(porta.simulada).toBe(true);
    const turno = turnoCom(porta);
    await turno.executar("buscar_horario", BUSCA_DA_ANA);
    const reserva = await turno.executar("reservar_horario", { horario: "h1" });
    expect(json(reserva)).toMatchObject({
      resultado: "reservado",
      hora: "11:30",
      profissional: "Dra. Ana Lima",
    });
    expect(reserva.tipo === "saida" && reserva.passo).toBe(
      "Reservaria terça, 20/10 às 11:30 (Consulta, Dra. Ana Lima) por 10 minutos. No simulador, nada foi gravado.",
    );
    const outroTurno = turnoCom(porta);
    const marcado = await outroTurno.executar("agendar", {});
    expect(json(marcado)).toEqual({ resultado: "marcado", pendente: true });
    expect(marcado.tipo === "saida" && marcado.passo).toContain(
      "No simulador, nada foi gravado.",
    );
    expect(json(await outroTurno.executar("confirmar_presenca", {}))).toEqual({
      resultado: "confirmada",
    });
    expect(banco.chamadas).toEqual([]);
    expect(banco.escritas).toEqual([]);
    expect(banco.linhas("slot_hold")).toEqual([]);
    expect(banco.leituras.length).toBeGreaterThan(0);
    // Sem conversa, toda reserva viva conta: a leitura nao exclui nenhuma.
    expect(
      banco.leituras.every((l) => !l.filtros.some((f) => f.includes(CONVERSA))),
    ).toBe(true);
  });
});

describe("tool_used do log", () => {
  const trilha = [{ tipo: "agenda" as const, texto: "x" }];
  it("o efeito na agenda pesa mais que a passagem e a consulta", () => {
    expect(
      ferramentaDoTurno({
        desfecho: { tipo: "respondeu" },
        trilha,
        ferramentasUsadas: [
          "buscar_procedimento",
          "buscar_horario",
          "reservar_horario",
        ],
      }),
    ).toBe("reservar_horario");
    expect(
      ferramentaDoTurno({
        desfecho: {
          tipo: "escalou",
          motivo: "agente_pediu",
          gatilho: null,
          origem: "agente",
        },
        trilha,
        ferramentasUsadas: ["agendar"],
      }),
    ).toBe("agendar");
    expect(
      ferramentaDoTurno({
        desfecho: {
          tipo: "escalou",
          motivo: "agente_pediu",
          gatilho: null,
          origem: "agente",
        },
        trilha,
        ferramentasUsadas: ["buscar_horario"],
      }),
    ).toBe("escalar_humano");
    expect(
      ferramentaDoTurno({
        desfecho: { tipo: "respondeu" },
        trilha: [{ tipo: "preco", texto: "x" }],
      }),
    ).toBe("buscar_procedimento");
    expect(
      ferramentaDoTurno({ desfecho: { tipo: "respondeu" }, trilha: [] }),
    ).toBeNull();
    expect(
      ferramentaDoTurno({
        desfecho: { tipo: "respondeu" },
        trilha,
        ferramentasUsadas: ["confirmar_presenca", "buscar_horario"],
      }),
    ).toBe("confirmar_presenca");
  });
});
