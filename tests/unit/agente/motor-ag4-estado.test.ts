import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { portaDaAgendaDoWhatsapp } from "@/lib/agente/agenda";
import {
  dadosVazios,
  estadoDoAtendimentoValido,
  estadoVazio,
  falhasDepoisDoTurno,
  notaDaPassagem,
  RESULTADOS_QUE_AVANCAM,
  RESULTADOS_QUE_SAO_FALHA,
  temAtendimentoParaContar,
  type EstadoDoAtendimento,
} from "@/lib/agente/atendimento";
import { gravarAtendimentoDaIa } from "@/lib/agente/atendimento-no-banco";
import {
  criarAgendaDoTurno,
  type AgendaDoTurno,
} from "@/lib/agente/ferramentas/agenda-do-turno";
import { CABECALHO_DA_NOTA_DA_PASSAGEM } from "@/lib/agente/nota-da-passagem";
import { linhasDoAtendimentoEmAndamento } from "@/lib/agente/prompt";

import {
  C1,
  CATALOGO_DA_AG4,
  CenarioDaAg4,
  configDaAg4,
  consultasDoContato,
  ferramenta,
} from "./ag4-conversa";
import { comOCarimboDoBanco, consultaDoContato } from "./ag4-contrato";
import {
  AGORA,
  CLINICA,
  CONTATO,
  CONVERSA,
  FUSO,
  iso,
  JOB,
  PROF,
  VINC,
} from "./agenda-fixtures";
import { UNID } from "./cadastro-fixtures";

// AG4: o estado entre os turnos (desenho, 4.2). As 14 chaves bastam: nas
// etapas cancelar e remarcar, appointment_id e a consulta em foco, o pedido
// diz a acao e o instante e do banco. A pergunta e armada pelo RESULTADO da
// ferramenta e desarma em qualquer outro turno; a reconferencia le a consulta
// em foco (nunca "marcada nesta conversa") e, depois de remarcar, a nova e a
// antiga. Nenhum teste fala com a OpenAI nem com o banco.

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const EM = "2026-10-20T11:50:00.000Z";

function estadoCom(parcial: Partial<EstadoDoAtendimento>): EstadoDoAtendimento {
  return { ...estadoVazio(), ...parcial };
}

/**
 * Revisao da AG4 (achado 1): a pergunta do cancelamento de quinta (T1), a
 * mensagem da IA logo antes da resposta da pessoa.
 */
const T1_DE_QUINTA: NonNullable<
  Parameters<typeof criarAgendaDoTurno>[0]["mensagens"]
>["antesDasPendentes"] = {
  autoria: "ia",
  texto: "Confirma o cancelamento da sua consulta de quinta, 22/10 às 14:00?",
};

/** Um turno direto sobre a agenda do turno (sem o modelo). */
function turno(
  cenario: CenarioDaAg4,
  estado: EstadoDoAtendimento,
  mensagens: string[] = [],
  antesDasPendentes: NonNullable<
    Parameters<typeof criarAgendaDoTurno>[0]["mensagens"]
  >["antesDasPendentes"] = null,
): AgendaDoTurno {
  return criarAgendaDoTurno({
    porta: portaDaAgendaDoWhatsapp(cenario.banco.cliente(), {
      clinicId: CLINICA,
      conversationId: CONVERSA,
      contactId: CONTATO,
      jobId: JOB,
      agora: () => AGORA,
    }),
    catalogo: CATALOGO_DA_AG4,
    config: configDaAg4(),
    agoraMs: AGORA,
    fuso: FUSO,
    atendimento: { estado, dados: dadosVazios() },
    mensagens: {
      doPaciente: mensagens.map((m) => ({ mascarado: m, original: m })),
      pendentes: mensagens.map((m) => ({ mascarado: m, original: m })),
      antesDasPendentes,
    },
    agora: () => AGORA,
  });
}

describe("a tabela do estado (desenho 4.2)", () => {
  it("a pergunta do cancelamento arma: etapa e pedido cancelar, o foco e um instante", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const t = turno(cenario, estadoVazio());
    await t.preparar();
    // Revisao da AG4 (achado 4): o codigo so vale com a lista do turno.
    await t.executar("consultar_minhas_consultas", {});
    const r = await t.executar("pedir_cancelamento", { consulta: "c1" });
    expect(r.tipo).toBe("frase");
    const { estado } = t.fechar({ mensagemFinal: "x", passou: false });
    expect(estado).toMatchObject({
      etapa: "cancelar",
      intencao: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: C1,
      pedido_pendente_em: new Date(AGORA).toISOString(),
    });
    expect(estadoDoAtendimentoValido(estado)).toBe(true);
  });

  it("qualquer outro turno desarma o pedido de cancelar (e a passagem também não o mantém)", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const armado = estadoCom({
      etapa: "cancelar",
      intencao: "cancelar",
      pedido_pendente: "cancelar",
      pedido_pendente_em: EM,
      appointment_id: C1,
    });
    for (const passou of [false, true]) {
      const t = turno(cenario, armado);
      await t.preparar();
      const { estado } = t.fechar({
        mensagemFinal: passou ? null : "Ok.",
        passou,
      });
      expect(estado, String(passou)).toMatchObject({
        etapa: "informacao",
        intencao: "cancelar",
        pedido_pendente: null,
        pedido_pendente_em: null,
        appointment_id: null,
      });
      expect(estadoDoAtendimentoValido(estado)).toBe(true);
    }
  });

  it("o foco da remarcação persiste entre os turnos, com o instante de antes", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const t1 = turno(cenario, estadoVazio());
    await t1.preparar();
    await t1.executar("consultar_minhas_consultas", {});
    await t1.executar("buscar_horario_para_remarcar", {
      consulta: "c1",
      a_partir_de: "2026-10-26",
      periodo: "manha",
      hora: null,
      unidade: null,
    });
    const depois = t1.fechar({
      mensagemFinal: "Tenho segunda.",
      passou: false,
    }).estado;
    expect(depois).toMatchObject({
      etapa: "oferta",
      intencao: "remarcar",
      pedido_pendente: "remarcar",
      appointment_id: C1,
      pedido_pendente_em: new Date(AGORA).toISOString(),
    });
    // Turno seguinte sem ferramenta: o foco fica, e o instante do banco
    // tambem (o mesmo pedido e o mesmo foco).
    const gravado = { ...depois, pedido_pendente_em: EM };
    const t2 = turno(cenario, gravado);
    await t2.preparar();
    const mantido = t2.fechar({
      mensagemFinal: "Qual prefere?",
      passou: false,
    }).estado;
    expect(mantido).toMatchObject({
      pedido_pendente: "remarcar",
      appointment_id: C1,
      pedido_pendente_em: EM,
      etapa: "oferta",
    });
  });

  it("na remarcação, a pergunta da própria IA não arma aguardando_confirmacao (só o T3)", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const t = turno(cenario, estadoVazio());
    await t.preparar();
    await t.executar("consultar_minhas_consultas", {});
    await t.executar("buscar_horario_para_remarcar", {
      consulta: "c1",
      a_partir_de: "2026-10-26",
      periodo: "manha",
      hora: null,
      unidade: null,
    });
    // Mesmo com uma reserva viva e a pergunta "Confirma ...?" no texto, sem
    // o resultado de reservar_horario no modo de remarcacao nao arma.
    const { estado } = t.fechar({
      mensagemFinal: "Confirma segunda, 26/10 às 08:00?",
      passou: false,
    });
    expect(estado.etapa).toBe("oferta");
  });

  it("o carimbo do banco: muda o pedido ou o foco, instante novo; os dois iguais, o de antes; sem pedido, nulo", () => {
    const antes = estadoCom({
      pedido_pendente: "cancelar",
      pedido_pendente_em: EM,
      appointment_id: C1,
    });
    const agora = AGORA + 60_000;
    expect(comOCarimboDoBanco(antes, antes, agora).pedido_pendente_em).toBe(EM);
    expect(
      comOCarimboDoBanco(
        antes,
        { ...antes, pedido_pendente: "remarcar" },
        agora,
      ).pedido_pendente_em,
    ).toBe(new Date(agora).toISOString());
    expect(
      comOCarimboDoBanco(
        antes,
        { ...antes, appointment_id: VINC.consultaAna },
        agora,
      ).pedido_pendente_em,
    ).toBe(new Date(agora).toISOString());
    expect(
      comOCarimboDoBanco(
        antes,
        { ...antes, pedido_pendente: null, appointment_id: null },
        agora,
      ).pedido_pendente_em,
    ).toBeNull();
  });

  it("o executor manda ao banco o estado com o pedido (o instante vai, e o banco carimba)", async () => {
    const chamadas: { funcao: string; args: Record<string, unknown> }[] = [];
    const admin = {
      rpc: async (funcao: string, args: Record<string, unknown>) => {
        chamadas.push({ funcao, args });
        return {
          data: { ok: true, versao: 4, reutilizado: false },
          error: null,
        };
      },
    };
    const estado = estadoCom({
      etapa: "cancelar",
      intencao: "cancelar",
      pedido_pendente: "cancelar",
      pedido_pendente_em: EM,
      appointment_id: C1,
    });
    const r = await gravarAtendimentoDaIa(
      admin as unknown as Parameters<typeof gravarAtendimentoDaIa>[0],
      {
        clinicId: CLINICA,
        conversationId: CONVERSA,
        jobId: JOB,
        versao: 3,
        estado,
      },
    );
    expect(r).toEqual({ tipo: "gravado", versao: 4, reutilizado: false });
    expect(chamadas[0]).toEqual({
      funcao: "gravar_atendimento_da_ia",
      args: {
        p_clinic_id: CLINICA,
        p_conversation_id: CONVERSA,
        p_job_id: JOB,
        p_versao: 3,
        p_estado: estado,
      },
    });
    expect(estadoDoAtendimentoValido(estado)).toBe(true);
  });
});

describe("a reconferência e os fatos do estado", () => {
  it("a consulta em foco é relida sem 'marcada nesta conversa', com o profissional; a cancelada no turno sai", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const armado = estadoCom({
      etapa: "cancelar",
      intencao: "cancelar",
      pedido_pendente: "cancelar",
      pedido_pendente_em: EM,
      appointment_id: C1,
    });
    cenario.atendimento = { estado: armado, dados: dadosVazios() };
    // A conversa como o banco guarda: a pergunta da IA depois do pedido e o
    // "sim" logo depois dela (a ancora forte).
    cenario.noBanco.push(
      { direcao: "saida", autor: "ia", em: Date.parse(EM) + 1_000 },
      { direcao: "entrada", autor: "paciente", em: AGORA - 1_000 },
    );
    const t = turno(cenario, armado, ["Sim"], T1_DE_QUINTA);
    await t.preparar();
    expect(t.fatosDoEstado()?.fatos).toEqual({
      consultaLida: true,
      consultasComHorario: [
        {
          dia: "quinta, 22/10",
          hora: "14:00",
          unidade: "Centro",
          profissional: "Dra. Ana Lima",
          marcadaNestaConversa: false,
        },
      ],
    });
    expect(JSON.parse(t.fatosDoEstado()?.saida ?? "{}")).toMatchObject({
      consulta_em_foco: { dia: "quinta, 22/10", hora: "14:00" },
    });
    // O bloco do modelo: o pedido so com o dia e a hora.
    const bloco = linhasDoAtendimentoEmAndamento(t.paraOModelo()!);
    expect(bloco).toEqual([
      "Passo: a pergunta do cancelamento já foi feita, esperando a resposta da pessoa.",
      "Pedido de cancelar a consulta de quinta, 22/10 às 14:00: a pergunta do cancelamento já foi feita.",
    ]);
    // O cancelamento do turno tira a consulta dos fatos do estado.
    const r = await t.executar("cancelar_consulta", {});
    expect(r.tipo).toBe("frase");
    expect(t.fatosDoEstado()).toBeNull();
  });

  it("a consulta em foco que não está mais de pé: o bloco manda consultar de novo", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    c1.status = "cancelado_clinica";
    const t = turno(
      cenario,
      estadoCom({
        etapa: "remarcar",
        intencao: "remarcar",
        pedido_pendente: "remarcar",
        pedido_pendente_em: EM,
        appointment_id: C1,
      }),
    );
    await t.preparar();
    expect(linhasDoAtendimentoEmAndamento(t.paraOModelo()!)).toContain(
      "A consulta do pedido não foi conferida agora: consulte consultar_minhas_consultas de novo antes de falar dela.",
    );
    // A busca com consulta null sem o foco relido: falha (sem consulta).
    const r = await t.executar("buscar_horario_para_remarcar", {
      consulta: null,
      a_partir_de: null,
      periodo: null,
      hora: null,
      unidade: null,
    });
    expect(r).toMatchObject({
      tipo: "saida",
      resultado: "sem_consulta_para_remarcar",
    });
  });

  it("depois de remarcar: a nova (remarcada nesta conversa, pendente) e a antiga relidas", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    const nova = consultaDoContato({
      inicio: iso("2026-10-26", "08:00"),
      fim: iso("2026-10-26", "08:30"),
      vinculo: VINC.consultaAna,
      profissional: PROF.ana,
      unidade: UNID.aldeota,
      aprovacao: "pendente",
      remarcacaoDe: C1,
      criadaPor: "ia",
    });
    cenario.banco.inserir("appointment", nova);
    const depois = estadoCom({
      etapa: "pos_marcacao",
      intencao: "remarcar",
      appointment_id: String(nova.id),
      desfecho: "remarcou",
    });
    const t = turno(cenario, depois);
    await t.preparar();
    expect(t.fatosDoEstado()?.fatos?.consultasComHorario).toEqual([
      {
        dia: "segunda, 26/10",
        hora: "08:00",
        unidade: "Aldeota",
        profissional: "Dra. Ana Lima",
        marcadaNestaConversa: false,
        remarcadaNestaConversa: true,
      },
      {
        dia: "quinta, 22/10",
        hora: "14:00",
        unidade: "Centro",
        profissional: "Dra. Ana Lima",
        marcadaNestaConversa: false,
      },
    ]);
    expect(linhasDoAtendimentoEmAndamento(t.paraOModelo()!)).toEqual([
      "Passo: remarcação pedida nesta conversa.",
      "Remarcação pedida nesta conversa: de quinta, 22/10 às 14:00 para segunda, 26/10 às 08:00, pendente da aprovação da equipe; a consulta de antes continua marcada até lá.",
    ]);
    // Aprovada: a antiga cancelada sai; a nova deixa de ser "remarcada" e,
    // revisao da AG4 (achado 7), passa a ser a remarcacao aprovada ("foi
    // remarcada" vale com o par dela, sem a pendencia).
    nova.approval_status = "aprovado";
    c1.status = "cancelado_paciente";
    const t2 = turno(cenario, depois);
    await t2.preparar();
    expect(t2.fatosDoEstado()?.fatos?.consultasComHorario).toEqual([
      {
        dia: "segunda, 26/10",
        hora: "08:00",
        unidade: "Aldeota",
        profissional: "Dra. Ana Lima",
        marcadaNestaConversa: false,
        remarcacaoAprovada: true,
      },
    ]);
    expect(linhasDoAtendimentoEmAndamento(t2.paraOModelo()!)).toContain(
      "Remarcação pedida nesta conversa: para segunda, 26/10 às 08:00, já aprovada pela equipe.",
    );
  });
});

describe("as falhas, os avanços e a nota da passagem", () => {
  it("as listas fechadas da AG4", () => {
    for (const falha of [
      "sem_pergunta_de_cancelamento",
      "sem_confirmacao_clara",
      "horario_fora_da_remarcacao",
      "sem_consulta_para_remarcar",
      "um_cancelamento_por_resposta",
    ]) {
      expect(RESULTADOS_QUE_SAO_FALHA.has(falha), falha).toBe(true);
    }
    for (const avanco of ["consultas", "cancelada", "remarcado"]) {
      expect(RESULTADOS_QUE_AVANCAM.has(avanco), avanco).toBe(true);
    }
    expect(falhasDepoisDoTurno(1, ["sem_confirmacao_clara"])).toBe(2);
    expect(falhasDepoisDoTurno(1, ["cancelada"])).toBe(0);
  });

  it("a nota do pedido de cancelar e de remarcar, com os nomes do servidor e sem travessão", () => {
    const estado = estadoCom({ intencao: "remarcar" });
    expect(temAtendimentoParaContar(estado, dadosVazios())).toBe(true);
    const nota = notaDaPassagem({
      estado,
      dados: dadosVazios(),
      procedimento: null,
      profissional: null,
      pagamento: null,
      unidade: null,
      preferencia: null,
      reserva: {
        dia: "segunda, 26/10",
        hora: "08:00",
        profissional: "Dra. Ana Lima",
        unidade: "Aldeota",
        viva: true,
      },
      oferecidos: [],
      parouEm: "o paciente pediu para falar com uma pessoa",
      pedidoDaConsulta: {
        acao: "remarcar",
        dia: "quinta, 22/10",
        hora: "14:00",
        procedimento: "Consulta",
        profissional: "Dra. Ana Lima",
      },
    });
    expect(nota).toBe(
      [
        CABECALHO_DA_NOTA_DA_PASSAGEM,
        "Pedido: remarcar a consulta de quinta, 22/10 às 14:00 (Consulta, Dra. Ana Lima).",
        "Horário reservado para a remarcação: segunda, 26/10 às 08:00, Dra. Ana Lima, unidade Aldeota (reserva de 10 minutos ainda valendo).",
        "Parou em: o paciente pediu para falar com uma pessoa.",
      ].join("\n"),
    );
    expect(nota).not.toMatch(/[–—]/);
    const remarcada = notaDaPassagem({
      estado: estadoCom({ intencao: "remarcar", etapa: "pos_marcacao" }),
      dados: dadosVazios(),
      procedimento: null,
      profissional: null,
      pagamento: null,
      unidade: null,
      preferencia: null,
      reserva: null,
      oferecidos: [],
      parouEm: "o assunto é clínico",
      remarcacao: {
        de: { dia: "quinta, 22/10", hora: "14:00" },
        para: { dia: "segunda, 26/10", hora: "08:00" },
      },
    });
    expect(remarcada).toContain(
      "Remarcação pedida pelo assistente nesta conversa, pendente da aprovação da equipe: de quinta, 22/10 às 14:00 para segunda, 26/10 às 08:00.",
    );
  });

  it("a passagem no meio da remarcação fecha o atendimento como passado para a equipe", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await cenario.fala({
      texto: "Quero remarcar a de quinta",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("buscar_horario_para_remarcar", {
          consulta: "c1",
          a_partir_de: "2026-10-26",
          periodo: "manha",
          hora: null,
          unidade: null,
        }),
        ferramenta("escalar_humano", { motivo: "pedido_humano" }),
      ],
    });
    expect(cenario.estado.desfecho).toBe("passou_para_equipe");
  });

  it("a nota da passagem no meio da remarcação: o pedido, os horários e onde parou", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const r = await cenario.fala({
      texto: "Quero remarcar a de quinta",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("buscar_horario_para_remarcar", {
          consulta: "c1",
          a_partir_de: "2026-10-26",
          periodo: "manha",
          hora: null,
          unidade: null,
        }),
        ferramenta("escalar_humano", { motivo: "pedido_humano" }),
      ],
    });
    expect(r.notaParaAEquipe).toBe(
      [
        CABECALHO_DA_NOTA_DA_PASSAGEM,
        "Pedido: remarcar a consulta de quinta, 22/10 às 14:00 (Consulta, Dra. Ana Lima).",
        "Horários oferecidos para a remarcação: segunda, 26/10 às 08:00, Dra. Ana Lima, unidade Aldeota; terça, 27/10 às 08:00, Dra. Ana Lima, unidade Aldeota; quarta, 28/10 às 08:00, Dra. Ana Lima, unidade Aldeota; quinta, 29/10 às 08:00, Dra. Ana Lima, unidade Aldeota.",
        "Parou em: o paciente pediu para falar com uma pessoa.",
      ].join("\n"),
    );
  });
});
