import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { portaDaAgendaDoWhatsapp } from "@/lib/agente/agenda";
import {
  perguntaConfirmaAReserva,
  perguntaSeConfirma,
  type ReservaPerguntada,
} from "@/lib/agente/atendimento";
import { lerNascimentoInformado } from "@/lib/agente/atendimento-no-banco";
import { montarFatosDoTurno } from "@/lib/agente/fatos";
import {
  criarAgendaDoTurno,
  type ResultadoDaFerramentaDeAgenda,
} from "@/lib/agente/ferramentas/agenda-do-turno";
import { fatosValidos } from "@/lib/domain/conformidade/fatos-do-turno";

import { bancoDaAg3, rpcsDaAg3 } from "./ag3-contrato";
import type { AgendaEmMemoria } from "./agenda-em-memoria";
import {
  AGORA,
  CLINICA,
  codigoDoProcedimento,
  configComAgenda,
  CONTATO,
  CONVERSA,
  FUSO,
  iso,
  PROC,
  PROF,
  VINC,
} from "./agenda-fixtures";
import { catalogoDoCadastro } from "./cadastro-fixtures";

// As pecas da revisao final da AG3 (27/10/2026): a pergunta "Confirma"
// contra a reserva viva (achado 1), o eco do pedido fora dos fatos fortes
// (achado 5), os fatos com o horario da acao e da consulta (achado 2) e o
// nascimento informado so da janela atual (achado 7). Nenhum teste fala com
// a OpenAI nem com o banco.

const CATALOGO = catalogoDoCadastro();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const OUTRO_CONTATO = "c1000000-0000-4000-8000-000000000009";

let banco: AgendaEmMemoria;

beforeEach(() => {
  banco = bancoDaAg3();
  rpcsDaAg3(banco, {
    catalogo: CATALOGO,
    exigidos: { nomeCompleto: true, nascimento: true, cpf: false },
    agora: () => AGORA,
  });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function turno() {
  return criarAgendaDoTurno({
    porta: portaDaAgendaDoWhatsapp(banco.cliente(), {
      clinicId: CLINICA,
      conversationId: CONVERSA,
      contactId: CONTATO,
      jobId: randomUUID(),
      agora: () => AGORA,
    }),
    catalogo: CATALOGO,
    config: configComAgenda(),
    agoraMs: AGORA,
    fuso: FUSO,
  });
}

function busca(extra: Record<string, unknown> = {}) {
  return {
    procedimento: P_CONSULTA,
    profissional: null,
    convenio: null,
    a_partir_de: null,
    periodo: null,
    unidade: null,
    hora: null,
    ...extra,
  };
}

function comoSaida(r: ResultadoDaFerramentaDeAgenda) {
  if (r.tipo !== "saida") {
    throw new Error(`esperava saida, veio ${r.tipo}`);
  }
  return r;
}

const RESERVA: ReservaPerguntada = {
  dia: "quarta, 21/10",
  hora: "14:00",
  profissional: "Dra. Ana Lima",
  unidade: "Centro",
  profissionais: ["Dra. Ana Lima", "Dr. Bruno Costa"],
  unidades: ["Centro", "Aldeota"],
};

describe("achado 1: a pergunta Confirma mostra a reserva viva", () => {
  it.each([
    "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?",
    "Confirma consulta de Consulta com Dra. Ana Lima, dia 21/10 às 14:00, na unidade Centro, no particular?",
    "Ótimo, confirma a consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima?",
    "Você confirma a consulta de quarta, 21/10 às 14:00?",
    "Então, a senhora confirma 21/10 às 14h com a Dra. Ana?",
    // Revisao curta (achado 8): a mensagem inteira conta; o resumo seguido
    // do "Confirma?" curto arma (antes nao armava, e a conversa entrava em
    // laco).
    "Sua consulta seria quarta, 21/10 às 14:00. Confirma?",
  ])("arma: %s", (texto) => {
    expect(perguntaConfirmaAReserva(texto, RESERVA)).toBe(true);
  });

  it.each([
    // Outro dia, outra hora, outro profissional, outra unidade.
    "Confirma a Consulta com o Dr. Bruno Costa na quinta, 22/10 às 13:00, no particular?",
    "Confirma quinta, 21/10 às 14:00?",
    "Confirma a consulta de quarta, 21/10 às 15:00?",
    "Confirma a consulta com a Dra. Maria na quarta, 21/10 às 14:00?",
    "Confirma quarta, 21/10 às 14:00 na unidade Aldeota?",
    // Dois pares na mesma pergunta.
    "Confirma a consulta de quarta, 21/10 às 14:00 ou quinta, 22/10 às 13:00?",
    // Sem o dd/mm ou sem a hora.
    "Confirma a consulta de quarta às 14:00?",
    "Confirma a consulta de quarta, 21/10?",
    // Nao e pergunta de confirmacao.
    "Posso marcar quarta, 21/10 às 14:00?",
  ])("não arma: %s", (texto) => {
    expect(perguntaConfirmaAReserva(texto, RESERVA)).toBe(false);
  });

  it("toda pergunta de confirmação da resposta tem de mostrar a reserva", () => {
    expect(
      perguntaConfirmaAReserva(
        "Confirma quarta, 21/10 às 14:00? Ou confirma quinta, 22/10 às 13:00?",
        RESERVA,
      ),
    ).toBe(false);
    // A reserva sem unidade: a pergunta que cita unidade nao arma.
    expect(
      perguntaConfirmaAReserva(
        "Confirma quarta, 21/10 às 14:00 na unidade Centro?",
        { ...RESERVA, unidade: null },
      ),
    ).toBe(false);
    expect(perguntaSeConfirma("Você confirma a consulta?")).toBe(true);
  });
});

describe("achado 5: o eco do pedido sai dos fatos fortes", () => {
  it("buscar_horario com a hora pedida ocupada: o modelo lê o eco; os fatos, não", async () => {
    for (const [id, prof, vinc] of [
      ["o1", PROF.ana, VINC.consultaAna],
      ["o2", PROF.bruno, VINC.consultaBruno],
    ] as const) {
      banco.inserir("appointment", {
        id,
        clinic_id: CLINICA,
        professional_id: prof,
        contact_id: OUTRO_CONTATO,
        service_link_id: vinc,
        starts_at: iso("2026-10-21", "15:00"),
        ends_at: iso("2026-10-21", "15:30"),
        status: "agendado",
      });
    }
    const r = comoSaida(
      await turno().executar(
        "buscar_horario",
        busca({ a_partir_de: "2026-10-21", hora: "15:00" }),
      ),
    );
    expect(JSON.parse(r.saida)).toMatchObject({
      resultado: "hora_pedida_ocupada",
      hora_pedida: "15:00",
      dia_pedido: "quarta, 21/10",
    });
    expect(r.fatos?.ecos).toEqual(["quarta, 21/10 às 15:00"]);
    const semEco = JSON.parse(r.fatos?.saidaSemEco ?? "{}") as Record<
      string,
      unknown
    >;
    expect(semEco).not.toHaveProperty("hora_pedida");
    expect(semEco).not.toHaveProperty("dia_pedido");
    expect(semEco.horarios).toEqual(JSON.parse(r.saida).horarios);
  });

  it("reservar_horario recusado pelo horário: o dia e a hora ao modelo, nos fatos só como eco", async () => {
    banco.inserir("appointment", {
      id: "outra",
      clinic_id: CLINICA,
      professional_id: PROF.ana,
      contact_id: OUTRO_CONTATO,
      service_link_id: VINC.consultaAna,
      starts_at: iso("2026-10-21", "14:00"),
      ends_at: iso("2026-10-21", "14:30"),
      status: "agendado",
    });
    const t = turno();
    await t.executar("buscar_horario", busca({ periodo: "tarde", a_partir_de: "2026-10-21" }));
    const oferta = t.paraOModelo();
    expect(oferta).toBeNull();
    // A busca nao oferece o horario ocupado; reservar um codigo de um
    // horario que ficou ocupado depois: o banco recusa.
    banco.tabelas.set("appointment", []);
    const t2 = turno();
    await t2.executar("buscar_horario", busca({ periodo: "tarde", a_partir_de: "2026-10-21" }));
    banco.inserir("appointment", {
      id: "outra",
      clinic_id: CLINICA,
      professional_id: PROF.ana,
      contact_id: OUTRO_CONTATO,
      service_link_id: VINC.consultaAna,
      starts_at: iso("2026-10-21", "14:00"),
      ends_at: iso("2026-10-21", "14:30"),
      status: "agendado",
    });
    const r = comoSaida(await t2.executar("reservar_horario", { horario: "h1" }));
    expect(JSON.parse(r.saida)).toEqual({
      resultado: "ocupado",
      dia: "quarta, 21/10",
      hora: "14:00",
    });
    expect(r.fatos).toEqual({
      ecos: ["quarta, 21/10 às 14:00"],
      saidaSemEco: JSON.stringify({ resultado: "ocupado" }),
    });
  });
});

describe("achado 2: os fatos montados levam o horário da ação e da consulta", () => {
  it("a ação com o horário, a consulta lida com o horário, o eco e a saída sem ele", () => {
    const fatos = montarFatosDoTurno({
      config: configComAgenda(),
      catalogo: CATALOGO,
      agoraTexto: "terça-feira, 20/10/2026, 09:00",
      agoraMs: AGORA,
      fuso: FUSO,
      ferramentas: [
        {
          saida: JSON.stringify({ resultado: "hora_pedida_ocupada", hora_pedida: "15:00" }),
          fatos: {
            ecos: ["15:00"],
            saidaSemEco: JSON.stringify({ resultado: "hora_pedida_ocupada" }),
          },
        },
        {
          saida: JSON.stringify({ resultado: "reservado", dia: "quarta, 21/10", hora: "14:00" }),
          fatos: {
            acao: "reservou",
            horarioDaAcao: { dia: "quarta, 21/10", hora: "14:00", unidade: "Centro" },
          },
        },
        {
          saida: JSON.stringify({ resultado: "ja_tem_consulta", dia: "terça, 27/10", hora: "10:00" }),
          fatos: {
            consultaLida: true,
            consultaComHorario: {
              dia: "terça, 27/10",
              hora: "10:00",
              unidade: null,
              marcadaNestaConversa: false,
            },
          },
        },
      ],
    });
    expect(fatos.horariosDasAcoes).toEqual([
      { dia: "quarta, 21/10", hora: "14:00", unidade: "Centro", acao: "reservou" },
    ]);
    expect(fatos.consultasLidas).toEqual([
      { dia: "terça, 27/10", hora: "10:00", unidade: null, marcadaNestaConversa: false },
    ]);
    expect(fatos.consultaLida).toBe(true);
    expect(fatos.ecosDoPedido).toEqual(["15:00"]);
    expect(fatos.saidasDasFerramentas[0]).toBe(
      JSON.stringify({ resultado: "hora_pedida_ocupada" }),
    );
    expect(fatosValidos(fatos)).toBe(true);
  });

  it("fatos incoerentes bloqueiam: o horário de uma ação que não aconteceu, a consulta com horário sem consulta lida", () => {
    const base = montarFatosDoTurno({
      config: configComAgenda(),
      catalogo: CATALOGO,
      agoraTexto: "terça-feira, 20/10/2026, 09:00",
      agoraMs: AGORA,
      fuso: FUSO,
      ferramentas: [],
    });
    expect(fatosValidos(base)).toBe(true);
    expect(
      fatosValidos({
        ...base,
        horariosDasAcoes: [
          { dia: "quarta, 21/10", hora: "14:00", unidade: null, acao: "marcou" },
        ],
      }),
    ).toBe(false);
    expect(
      fatosValidos({
        ...base,
        consultasLidas: [
          { dia: "quarta, 21/10", hora: "14:00", unidade: null, marcadaNestaConversa: true },
        ],
      }),
    ).toBe(false);
    expect(fatosValidos({ ...base, ecosDoPedido: [3] })).toBe(false);
  });
});

describe("achado 7: o nascimento informado é só o da janela atual", () => {
  it("a linha aberta de outra janela não vale", async () => {
    banco.inserir(
      "dados_informados_na_marcacao",
      {
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        contact_id: CONTATO,
        appointment_id: null,
        para_o_titular: true,
        data_nascimento: "1980-01-01",
        janela_desde: "2026-10-10T10:00:00+00:00",
      },
      {
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        contact_id: CONTATO,
        appointment_id: null,
        para_o_titular: true,
        data_nascimento: "1990-05-05",
        janela_desde: "2026-10-20T11:00:00+00:00",
      },
    );
    const ids = {
      clinicId: CLINICA,
      conversationId: CONVERSA,
      contactId: CONTATO,
    };
    expect(
      await lerNascimentoInformado(banco.cliente(), {
        ...ids,
        janelaDesde: "2026-10-20T11:00:00+00:00",
      }),
    ).toBe("1990-05-05");
    expect(
      await lerNascimentoInformado(banco.cliente(), {
        ...ids,
        janelaDesde: "2026-10-27T11:00:00+00:00",
      }),
    ).toBeNull();
    const leitura = banco.leituras.find(
      (l) => l.tabela === "dados_informados_na_marcacao",
    );
    expect(leitura?.filtros).toContain(
      "eq:janela_desde=2026-10-20T11:00:00+00:00",
    );
  });
});
