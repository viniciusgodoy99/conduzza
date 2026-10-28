import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { lerConsultasDoContatoDaIa } from "@/lib/agente/agenda";
import {
  conferirConsultaDaIa,
  consultaListavel,
  emOrdem,
  limiteDaSaidaDasMinhasConsultas,
  MAXIMO_DE_CONSULTAS_NA_LISTA,
  situacaoDaConsulta,
  type ConsultaDoContato,
} from "@/lib/agente/ferramentas/minhas-consultas";

import {
  C1,
  CATALOGO_DA_AG4,
  CenarioDaAg4,
  consultasDoContato,
  ferramenta,
  final,
  saidas,
} from "./ag4-conversa";
import { consultaDoContato } from "./ag4-contrato";
import {
  AGORA,
  CLINICA,
  CONTATO,
  CONVERSA,
  iso,
  JOB,
  PROF,
  VINC,
} from "./agenda-fixtures";
import { UNID, VINC_AG2 } from "./cadastro-fixtures";

// AG4: consultar_minhas_consultas (as consultas futuras do contato, so dia,
// hora e situacao ao modelo; D-13) e o espelho em TS de
// conferir_consulta_da_ia (a ordem do banco). Nenhum teste fala com a OpenAI
// nem com o banco.

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const IDS = {
  clinicId: CLINICA,
  conversationId: CONVERSA,
  contactId: CONTATO,
  jobId: JOB,
};

function consulta(extra: Partial<ConsultaDoContato> = {}): ConsultaDoContato {
  return {
    id: C1,
    inicio: iso("2026-10-22", "14:00"),
    fim: iso("2026-10-22", "14:30"),
    status: "agendado",
    aprovacao: null,
    encaixe: false,
    serviceLinkId: VINC.consultaAna,
    profissionalId: PROF.ana,
    unidadeId: UNID.centro,
    remarcacaoDe: null,
    temRemarcacaoPendente: false,
    ...extra,
  };
}

describe("a lista: só o dia, a hora e a situação", () => {
  it("as próximas consultas do contato, na ordem, com o código e a situação; nada mais ao modelo", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const r = await cenario.fala({
      texto: "Tenho consulta marcada?",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        final(
          "Você tem duas: quinta, 22/10 às 14:00, e terça, 27/10 às 09:00, que ainda espera a aprovação da equipe. Posso ajudar com alguma?",
        ),
      ],
    });
    expect(r.tipo).toBe("resposta");
    expect(saidas(cenario.corpos[1])[0]).toEqual({
      resultado: "consultas",
      consultas: [
        {
          codigo: "c1",
          dia: "quinta, 22/10",
          hora: "14:00",
          situacao: "marcada",
        },
        {
          codigo: "c2",
          dia: "terça, 27/10",
          hora: "09:00",
          situacao: "aguardando_aprovacao",
        },
      ],
      ha_mais: false,
    });
    // A trilha (tela, nunca a OpenAI) tem os nomes do Cadastro.
    expect(r.trilha.map((p) => p.texto)).toContain(
      "Leu as consultas do paciente: quinta, 22/10 às 14:00 (Consulta, Dra. Ana Lima), marcada; terça, 27/10 às 09:00 (Consulta, Dra. Ana Lima), esperando a aprovação da equipe",
    );
    // O resumo do verificador: dia, hora e unidade; nunca o profissional.
    const resumo = cenario.verificacao.pedidos[0]?.resumoDosFatos ?? "";
    expect(resumo).toContain("quinta, 22/10 às 14:00, unidade Centro");
    expect(resumo).toContain("terça, 27/10 às 09:00, unidade Aldeota");
    expect(resumo).not.toMatch(/Ana|Consulta,/);
    // A consulta lida nao muda o pedido nem a etapa.
    expect(cenario.estado.pedido_pendente).toBeNull();
  });

  it("o profissional relido chega aos fatos: outro profissional na frase barra", async () => {
    for (const [texto, tipo] of [
      [
        "Sua consulta com o Dr. Bruno Costa de quinta, 22/10 às 14:00 continua marcada.",
        "frase_fixa",
      ],
      ["Sua consulta de quinta, 22/10 às 14:00 continua marcada.", "resposta"],
    ] as const) {
      const cenario = new CenarioDaAg4();
      consultasDoContato(cenario.banco);
      const r = await cenario.fala({
        texto: "Minha consulta de quinta continua?",
        roteiro: [ferramenta("consultar_minhas_consultas", {}), final(texto)],
      });
      expect(r.tipo, texto).toBe(tipo);
    }
  });

  it("sem consulta futura: sem_consultas", async () => {
    const cenario = new CenarioDaAg4();
    await cenario.fala({
      texto: "Tenho consulta?",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        final("Não encontrei consulta marcada. Quer marcar uma?"),
      ],
    });
    expect(saidas(cenario.corpos[1])[0]).toEqual({
      resultado: "sem_consultas",
    });
  });

  it("a leitura que falha é falha fechada (a frase fixa e a equipe)", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    cenario.banco.comErro.add("appointment");
    const r = await cenario.fala({
      texto: "Tenho consulta?",
      roteiro: [ferramenta("consultar_minhas_consultas", {})],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "desconhecida" });
  });
});

describe("a leitura do servidor (lerConsultasDoContatoDaIa)", () => {
  it("só futuras, nas quatro situações antes do atendimento, sem recusadas; até 5, com ha_mais; as remarcações ligadas", async () => {
    const cenario = new CenarioDaAg4();
    const banco = cenario.banco;
    const dia = (n: number) =>
      iso(`2026-10-${String(21 + n).padStart(2, "0")}`, "10:00");
    const fim = (n: number) =>
      iso(`2026-10-${String(21 + n).padStart(2, "0")}`, "10:30");
    const ids: string[] = [];
    for (let n = 0; n < 7; n += 1) {
      const linha = consultaDoContato({
        inicio: dia(n),
        fim: fim(n),
        vinculo: VINC.consultaAna,
        profissional: PROF.ana,
        status: n === 1 ? "confirmado_paciente" : "agendado",
      });
      ids.push(String(linha.id));
      banco.inserir("appointment", linha);
    }
    // Fora da lista: passada, cancelada, recusada, com falta e de outro contato.
    banco.inserir(
      "appointment",
      consultaDoContato({
        inicio: iso("2026-10-19", "10:00"),
        fim: iso("2026-10-19", "10:30"),
        vinculo: VINC.consultaAna,
        profissional: PROF.ana,
      }),
      consultaDoContato({
        inicio: iso("2026-10-21", "08:00"),
        fim: iso("2026-10-21", "08:30"),
        vinculo: VINC.consultaAna,
        profissional: PROF.ana,
        status: "cancelado_paciente",
      }),
      consultaDoContato({
        inicio: iso("2026-10-21", "09:00"),
        fim: iso("2026-10-21", "09:30"),
        vinculo: VINC.consultaAna,
        profissional: PROF.ana,
        status: "cancelado_clinica",
        aprovacao: "recusado",
      }),
      consultaDoContato({
        inicio: iso("2026-10-21", "11:00"),
        fim: iso("2026-10-21", "11:30"),
        vinculo: VINC.consultaAna,
        profissional: PROF.ana,
        status: "faltou",
      }),
      {
        ...consultaDoContato({
          inicio: iso("2026-10-21", "12:00"),
          fim: iso("2026-10-21", "12:30"),
          vinculo: VINC.consultaAna,
          profissional: PROF.ana,
        }),
        contact_id: "outro",
      },
    );
    // Uma remarcacao pendente ligada a segunda consulta (fora das 5? nao: a
    // nova e a 8a pelo inicio).
    banco.inserir(
      "appointment",
      consultaDoContato({
        inicio: iso("2026-11-02", "10:00"),
        fim: iso("2026-11-02", "10:30"),
        vinculo: VINC.consultaAna,
        profissional: PROF.ana,
        aprovacao: "pendente",
        remarcacaoDe: ids[1],
      }),
    );
    const lida = await lerConsultasDoContatoDaIa(banco.cliente(), IDS, AGORA);
    expect(lida.consultas.map((c) => c.id)).toEqual(
      ids.slice(0, MAXIMO_DE_CONSULTAS_NA_LISTA),
    );
    expect(lida.haMais).toBe(true);
    expect(lida.consultas[1]).toMatchObject({
      status: "confirmado_paciente",
      temRemarcacaoPendente: true,
    });
    expect(situacaoDaConsulta(lida.consultas[1]!)).toBe("remarcacao_pedida");
    // A leitura: so as colunas da conferencia, do contato da conversa.
    const leituras = banco.leituras.filter((l) => l.tabela === "appointment");
    expect(leituras[0]?.colunas).toBe(
      "id, starts_at, ends_at, status, approval_status, is_overbooking, service_link_id, professional_id, unit_id, remarcacao_de",
    );
    expect(leituras[0]?.filtros).toEqual(
      expect.arrayContaining([
        `eq:clinic_id=${CLINICA}`,
        `eq:contact_id=${CONTATO}`,
      ]),
    );
    expect(leituras[1]?.filtros).toEqual(
      expect.arrayContaining([
        `eq:clinic_id=${CLINICA}`,
        `eq:contact_id=${CONTATO}`,
        "eq:approval_status=pendente",
      ]),
    );
    expect(leituras.map((l) => l.colunas).join(" ")).not.toMatch(
      /notes|name|phone/,
    );
  });
});

describe("as situações e o espelho de conferir_consulta_da_ia", () => {
  it("a situação de cada consulta", () => {
    expect(situacaoDaConsulta(consulta())).toBe("marcada");
    expect(
      situacaoDaConsulta(consulta({ status: "aguardando_confirmacao" })),
    ).toBe("marcada");
    expect(
      situacaoDaConsulta(consulta({ status: "confirmado_recepcao" })),
    ).toBe("confirmada");
    expect(situacaoDaConsulta(consulta({ aprovacao: "pendente" }))).toBe(
      "aguardando_aprovacao",
    );
    expect(
      situacaoDaConsulta(
        consulta({ aprovacao: "pendente", remarcacaoDe: "x" }),
      ),
    ).toBe("remarcacao_aguardando_aprovacao");
    expect(situacaoDaConsulta(consulta({ temRemarcacaoPendente: true }))).toBe(
      "remarcacao_pedida",
    );
  });

  it("a ordem do banco: nao encontrada, encerrada, encaixe, só com a equipe, pendente (remarcar), remarcação pendente, prazo", () => {
    const conferir = (
      c: ConsultaDoContato | null,
      acao: "cancelar" | "remarcar" = "cancelar",
      prazoHoras: number | null = 24,
    ) =>
      conferirConsultaDaIa({
        consulta: c,
        acao,
        prazoHoras,
        agoraMs: AGORA,
        catalogo: CATALOGO_DA_AG4,
      });
    expect(conferir(consulta())).toBeNull();
    expect(conferir(null)).toBe("consulta_nao_encontrada");
    expect(conferir(consulta({ status: "compareceu" }))).toBe(
      "consulta_encerrada",
    );
    expect(conferir(consulta({ inicio: iso("2026-10-19", "14:00") }))).toBe(
      "consulta_encerrada",
    );
    expect(conferir(consulta({ aprovacao: "recusado" }))).toBe(
      "consulta_encerrada",
    );
    // O encaixe vem antes do resto (mesmo encerrada? nao: encerrada antes).
    expect(conferir(consulta({ encaixe: true, aprovacao: "pendente" }))).toBe(
      "encaixe",
    );
    expect(conferir(consulta({ serviceLinkId: VINC_AG2.botoxAna }))).toBe(
      "so_com_a_equipe",
    );
    expect(conferir(consulta({ profissionalId: PROF.bruno }))).toBe(
      "so_com_a_equipe",
    );
    // Pendente da equipe: so na remarcacao (D-26); cancelar pode.
    expect(conferir(consulta({ aprovacao: "pendente" }), "remarcar")).toBe(
      "pendente_da_equipe",
    );
    expect(
      conferir(consulta({ aprovacao: "pendente" }), "cancelar"),
    ).toBeNull();
    // E uma remarcacao pendente, ou tem uma.
    expect(
      conferir(
        consulta({ aprovacao: "pendente", remarcacaoDe: "x" }),
        "cancelar",
      ),
    ).toBe("remarcacao_pendente");
    expect(
      conferir(consulta({ temRemarcacaoPendente: true }), "remarcar"),
    ).toBe("remarcacao_pendente");
    // O prazo: a IA age se inicio >= agora + prazo. Quinta 14:00 esta a 53h.
    expect(conferir(consulta(), "cancelar", 53)).toBeNull();
    expect(conferir(consulta(), "cancelar", 54)).toBe("fora_do_prazo");
    expect(conferir(consulta(), "remarcar", 0)).toBeNull();
    // Prazo nao preenchido: falha fechada.
    expect(conferir(consulta(), "cancelar", null)).toBe("fora_do_prazo");
  });

  it("a lista: futura, numa das quatro situações e não recusada; na ordem do início e do id", () => {
    expect(consultaListavel(consulta(), AGORA)).toBe(true);
    expect(consultaListavel(consulta({ status: "faltou" }), AGORA)).toBe(false);
    expect(consultaListavel(consulta({ aprovacao: "recusado" }), AGORA)).toBe(
      false,
    );
    expect(
      emOrdem([
        consulta({ id: "b", inicio: iso("2026-10-23", "10:00") }),
        consulta({ id: "c", inicio: iso("2026-10-22", "10:00") }),
        consulta({ id: "a", inicio: iso("2026-10-23", "10:00") }),
      ]).map((c) => c.id),
    ).toEqual(["c", "a", "b"]);
  });

  it("o teto da saída cobre cinco consultas (a reserva do gasto)", () => {
    const maior = JSON.stringify({
      resultado: "consultas",
      consultas: Array.from({ length: 5 }, (_, i) => ({
        codigo: `c${i + 1}`,
        dia: "sábado, 31/12/2027",
        hora: "23:59",
        situacao: "remarcacao_aguardando_aprovacao",
      })),
      ha_mais: true,
    });
    expect(Buffer.byteLength(maior, "utf8")).toBeLessThanOrEqual(
      limiteDaSaidaDasMinhasConsultas(),
    );
  });
});
