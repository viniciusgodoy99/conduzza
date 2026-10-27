import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { portaDaAgendaDoWhatsapp } from "@/lib/agente/agenda";
import { dadosVazios, estadoVazio } from "@/lib/agente/atendimento";
import { criarAgendaDoTurno } from "@/lib/agente/ferramentas/agenda-do-turno";
import { TEXTO_FIXO_DO_AGENTE } from "@/lib/agente/prompt";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import { interpretarRespostaAoCancelamento } from "@/lib/domain/resposta-paciente";
import { POLITICA_DO_VERIFICADOR } from "@/lib/integrations/llm/verificador";

import {
  C1,
  C2,
  CATALOGO_DA_AG4,
  CenarioDaAg4,
  configDaAg4,
  consultasDoContato,
  ferramenta,
  final,
  saidas,
} from "./ag4-conversa";
import {
  ancoraForte,
  comOCarimboDoBanco,
  consultaDoContato,
} from "./ag4-contrato";
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

// Revisao independente da AG4 (27/10/2026): os achados 1 a 9, em conversas
// de varias falas com o LLM FALSO sobre o contrato das RPCs em memoria (que
// espelha a revisao da frente de banco: a ancora forte do "sim", o pedido
// que vence em 60 minutos, o carimbo novo do pedido vencido e a remarcacao
// sem ja_tem_consulta). Os cenarios R1 a R9 da revisao, invertidos: o que
// passava (ou falhava) agora e barrado (ou segue). Nenhum teste fala com a
// OpenAI nem com o banco.

const T1_DE_QUINTA =
  "Confirma o cancelamento da sua consulta de quinta, 22/10 às 14:00?";
const T3_SEGUNDA =
  "Reservei segunda, 26/10 às 08:00, na unidade Aldeota, por 10 minutos. Confirma a remarcação da sua consulta de quinta, 22/10 às 14:00 para segunda, 26/10 às 08:00?";
const T4_SEGUNDA =
  "Pronto, pedi a remarcação para segunda, 26/10 às 08:00. Até a equipe aprovar, sua consulta de quinta, 22/10 às 14:00 continua marcada. A confirmação chega por aqui.";

const LISTAR = () => ferramenta("consultar_minhas_consultas", {});
const BUSCA_DE_SEGUNDA = {
  consulta: "c1",
  a_partir_de: "2026-10-26",
  periodo: "manha",
  hora: null,
  unidade: null,
};

let escrito: string[] = [];

beforeEach(() => {
  escrito = [];
  vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
    escrito.push(String(linha));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((linha) => {
    escrito.push(String(linha));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** O bloco <atendimento_em_andamento> das instrucoes de uma chamada. */
function blocoDoEstado(instrucoes: string): string {
  return (
    instrucoes
      .split("\n<atendimento_em_andamento>\n")[1]
      ?.split("\n</atendimento_em_andamento>")[0] ?? ""
  );
}

/** O pedido de cancelar a consulta de quinta (C1): a pergunta T1. */
async function pedirOCancelamento(cenario: CenarioDaAg4) {
  const r = await cenario.fala({
    texto: "Preciso cancelar minha consulta de quinta",
    roteiro: [LISTAR(), ferramenta("pedir_cancelamento", { consulta: "c1" })],
  });
  expect(r.resposta).toContain(T1_DE_QUINTA);
  return r;
}

/** Ate a pergunta da remarcacao (T3) de segunda, 26/10 as 08:00. */
async function ateAPerguntaDaRemarcacao(cenario: CenarioDaAg4) {
  await cenario.fala({
    texto: "Quero remarcar a de quinta para a semana que vem, de manhã",
    roteiro: [
      LISTAR(),
      ferramenta("buscar_horario_para_remarcar", BUSCA_DE_SEGUNDA),
      final(
        "Tenho segunda, 26/10 às 08:00 e terça, 27/10 às 08:00, na unidade Aldeota. Qual fica melhor?",
      ),
    ],
  });
  const r = await cenario.fala({
    texto: "Segunda às 8",
    roteiro: [ferramenta("reservar_horario", { horario: "h1" })],
  });
  expect(r.resposta).toBe(T3_SEGUNDA);
}

describe("achado 1 (R1): o \"sim\" que responde a outra pergunta", () => {
  it("uma campanha entre a pergunta (T1) e o \"Sim\": nada cancelado, o sistema pergunta de novo; o sim seguinte cancela", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    const instanteDaPergunta = cenario.estado.pedido_pendente_em;
    // A campanha da clinica (autor sistema) pergunta outra coisa: vira
    // "assistente" no historico, mas a autoria real e do sistema.
    cenario.daClinica(
      "Temos novidades em limpeza de pele este mês. Quer receber a nossa agenda de promoções?",
    );
    const r2 = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    // O motor desfez o pedido no preparo: nenhuma RPC de cancelar.
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
    expect(r2.tipo).toBe("resposta");
    expect(r2.resposta).toBe(T1_DE_QUINTA);
    expect(r2.trilha.map((p) => p.texto)).toContain(
      "A resposta da pessoa não veio logo depois da pergunta do cancelamento (outra mensagem da clínica saiu no meio): perguntou de novo se a pessoa confirma o cancelamento da consulta de quinta, 22/10 às 14:00 (Consulta, Dra. Ana Lima)",
    );
    // O bloco do modelo disse que a pergunta nao valia mais.
    expect(blocoDoEstado(cenario.instrucoesDaChamada(2))).toContain(
      "Pedido de cancelar a consulta de quinta, 22/10 às 14:00: a pergunta do cancelamento não vale mais (passou do tempo, ou outra mensagem saiu depois dela). Nada foi cancelado: se a pessoa quiser cancelar, chame cancelar_consulta, e o sistema pergunta de novo.",
    );
    // O pedido re-armado (dentro dos 60 minutos, o instante de antes fica),
    // com uma falha contada (a pergunta que nunca confere nao repete sem
    // fim).
    expect(cenario.estado).toMatchObject({
      etapa: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: C1,
      pedido_pendente_em: instanteDaPergunta,
      falhas_seguidas: 1,
    });
    // Agora o "Sim" vem logo depois da pergunta: cancela.
    const r3 = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    expect(c1.status).toBe("cancelado_paciente");
    expect(r3.resposta).toContain("foi cancelada");
    // Nenhum texto do paciente em log.
    expect(escrito.join("")).not.toMatch(/Preciso cancelar|promoções/);
  });

  it("duas vezes seguidas sem a pergunta logo antes: a equipe (nunca pergunta sem fim)", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    for (const [i, esperado] of (["resposta", "frase_fixa"] as const).entries()) {
      cenario.daClinica(`Lembrete ${i + 1}: responda SIM para confirmar a sua presença.`);
      const r = await cenario.fala({
        texto: "Sim",
        roteiro: [ferramenta("cancelar_consulta", {})],
      });
      expect(r.tipo, String(i)).toBe(esperado);
    }
    expect(cenario.estado.desfecho).toBe("passou_para_equipe");
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
  });

  it("a mensagem da equipe no meio tambem desfaz (a autoria real, nao o papel do historico)", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    cenario.daClinica("Oi! Você confirma o retorno da sua mãe para sexta?", "usuario");
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
    expect(r.resposta).toBe(T1_DE_QUINTA);
  });

  it("a pergunta vencida (mais de 60 minutos): o motor desfaz, pergunta de novo, e o banco carimba o instante novo", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    const antes = cenario.estado.pedido_pendente_em;
    cenario.agora += 4 * 60 * 60_000;
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
    expect(r.resposta).toBe(T1_DE_QUINTA);
    expect(r.trilha.map((p) => p.texto).join("\n")).toContain(
      "A pergunta do cancelamento venceu (mais de 1 hora sem a resposta)",
    );
    // contrato-mudancas R4: o mesmo pedido e o mesmo foco, mas vencido: o
    // instante e o novo (o "sim" seguinte nao vence de novo).
    expect(cenario.estado.pedido_pendente).toBe("cancelar");
    expect(cenario.estado.pedido_pendente_em).not.toBe(antes);
    expect(cenario.estado.pedido_pendente_em).toBe(
      new Date(cenario.agora).toISOString(),
    );
    await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(c1.status).toBe("cancelado_paciente");
  });

  it("o banco recusa pedido_vencido ou sem_confirmacao_do_paciente: o sistema pergunta de novo (nunca a equipe, nunca falha)", async () => {
    for (const motivo of ["pedido_vencido", "sem_confirmacao_do_paciente"]) {
      const cenario = new CenarioDaAg4();
      const { c1 } = consultasDoContato(cenario.banco);
      await pedirOCancelamento(cenario);
      cenario.opcoes.forcar = { cancelar: motivo };
      const r = await cenario.fala({
        texto: "Sim",
        roteiro: [ferramenta("cancelar_consulta", {})],
      });
      expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia"), motivo).toHaveLength(1);
      expect(c1.status).toBe("agendado");
      expect(r.tipo, motivo).toBe("resposta");
      expect(r.resposta).toBe(T1_DE_QUINTA);
      expect(cenario.estado).toMatchObject({
        pedido_pendente: "cancelar",
        appointment_id: C1,
        // sem_confirmacao_do_paciente conta uma falha; pedido_vencido nao.
        falhas_seguidas: motivo === "pedido_vencido" ? 0 : 1,
      });
    }
  });

  it("a saida que o historico nao mostra (a resposta automatica do WhatsApp Business): o banco barra pela ancora, e o sistema pergunta de novo", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    // So no banco (o historico filtra a resposta automatica do app).
    cenario.noBanco.push({
      direcao: "saida",
      autor: "sistema",
      em: cenario.agora + 30_000,
    });
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    expect(c1.status).toBe("agendado");
    expect(r.resposta).toBe(T1_DE_QUINTA);
  });

  it("sem a mensagem de antes (ou com outro texto, ou sem autoria), cancelar_consulta nunca chama a RPC", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const armado = {
      ...estadoVazio(),
      etapa: "cancelar" as const,
      intencao: "cancelar" as const,
      pedido_pendente: "cancelar" as const,
      pedido_pendente_em: new Date(AGORA - 5 * 60_000).toISOString(),
      appointment_id: C1,
    };
    for (const antes of [
      null,
      { autoria: null, texto: T1_DE_QUINTA },
      { autoria: "sistema" as const, texto: T1_DE_QUINTA },
      {
        autoria: "ia" as const,
        texto: "Confirma o cancelamento da sua consulta de terça, 27/10 às 09:00?",
      },
    ]) {
      const t = criarAgendaDoTurno({
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
        atendimento: { estado: armado, dados: dadosVazios() },
        mensagens: {
          doPaciente: [{ mascarado: "Sim", original: "Sim" }],
          pendentes: [{ mascarado: "Sim", original: "Sim" }],
          antesDasPendentes: antes,
        },
        agora: () => AGORA,
      });
      await t.preparar();
      expect(t.paraOModelo()?.pedidoDaConsulta).toMatchObject({
        acao: "cancelar",
        desfeito: true,
      });
      const r = await t.executar("cancelar_consulta", {});
      expect(r).toMatchObject({ tipo: "frase", resultado: "pergunta_do_cancelamento" });
    }
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
  });

  it("na remarcacao: um lembrete entre a pergunta (T3) e o \"Confirmo\": nada pedido; o sistema pergunta de novo e o Confirmo seguinte remarca", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    cenario.daClinica(
      "Lembrete: sua consulta é na quinta, 22/10 às 14:00. Responda SIM para confirmar.",
    );
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        ferramenta("reservar_horario", { horario: "h1" }),
      ],
    });
    // O agendar recusou sem a RPC; reservar de novo fez a pergunta outra vez.
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(r.resposta).toBe(T3_SEGUNDA);
    expect(cenario.estado.etapa).toBe("aguardando_confirmacao");
    const r2 = await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    expect(r2.resposta).toBe(T4_SEGUNDA);
  });

  it("o banco barra o \"Confirmo\" da remarcacao com outra saida no meio (a ancora depois da reserva)", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    // So no banco: o historico nao mostra.
    cenario.noBanco.push({
      direcao: "saida",
      autor: "sistema",
      em: cenario.agora + 30_000,
    });
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        ferramenta("reservar_horario", { horario: "h1" }),
      ],
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(
      cenario.banco.linhas("appointment").some((a) => a.remarcacao_de === C1),
    ).toBe(false);
    expect(r.resposta).toBe(T3_SEGUNDA);
  });
});

describe("o contrato em memoria espelha a revisao da frente de banco (R2 a R4)", () => {
  it("a ancora forte: a ultima saida antes da ultima mensagem do paciente e da IA, nao falhada e depois do pedido", () => {
    const pedido = 1_000;
    const ia = { direcao: "saida" as const, autor: "ia" as const, em: 2_000 };
    const sim = { direcao: "entrada" as const, autor: "paciente" as const, em: 3_000 };
    expect(ancoraForte([ia, sim], pedido)).toBe(true);
    // Duas do paciente seguidas depois da pergunta passam.
    expect(ancoraForte([ia, sim, { ...sim, em: 3_500 }], pedido)).toBe(true);
    // O que chega depois da ultima do paciente nao conta.
    expect(
      ancoraForte([ia, sim, { direcao: "saida", autor: "sistema", em: 4_000 }], pedido),
    ).toBe(true);
    for (const meio of ["sistema", "usuario"] as const) {
      expect(
        ancoraForte([ia, { direcao: "saida", autor: meio, em: 2_500 }, sim], pedido),
        meio,
      ).toBe(false);
    }
    expect(ancoraForte([{ ...ia, falhou: true }, sim], pedido)).toBe(false);
    expect(ancoraForte([{ ...ia, em: 500 }, sim], pedido)).toBe(false);
    expect(ancoraForte([ia], pedido)).toBe(false);
    expect(ancoraForte([sim, ia], pedido)).toBe(false);
    expect(ancoraForte([ia, sim], null)).toBe(false);
  });

  it("o gravar carimba de novo o instante vencido (R4); dentro dos 60 minutos, o de antes fica", () => {
    const antes = {
      ...estadoVazio(),
      pedido_pendente: "cancelar" as const,
      pedido_pendente_em: new Date(AGORA).toISOString(),
      appointment_id: C1,
    };
    const daqui59 = AGORA + 59 * 60_000;
    expect(comOCarimboDoBanco(antes, antes, daqui59).pedido_pendente_em).toBe(
      antes.pedido_pendente_em,
    );
    const daqui60 = AGORA + 60 * 60_000;
    expect(comOCarimboDoBanco(antes, antes, daqui60).pedido_pendente_em).toBe(
      new Date(daqui60).toISOString(),
    );
  });
});

describe("achado 8 (R5): \"Sim?\" nao e sim", () => {
  it("a mensagem com ponto de interrogacao nunca e sim nem nao", () => {
    for (const texto of ["Sim?", "sim??", "Pode?", "Cancela?", "👍?", "Não?", "¿sim"]) {
      expect(interpretarRespostaAoCancelamento([texto]), texto).toBe(
        "nao_reconhecida",
      );
    }
    // Os de antes continuam.
    expect(interpretarRespostaAoCancelamento(["Sim"])).toBe("sim");
    expect(interpretarRespostaAoCancelamento(["Sim!"])).toBe("sim");
    expect(interpretarRespostaAoCancelamento(["sim, por favor"])).toBe("sim");
    expect(interpretarRespostaAoCancelamento(["não"])).toBe("nao");
    expect(interpretarRespostaAoCancelamento(["sim", "obrigada"])).toBe(
      "nao_reconhecida",
    );
  });

  it("na conversa: \"Sim?\" faz a pergunta voltar e nada e cancelado", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    const r = await cenario.fala({
      texto: "Sim?",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
    expect(r.resposta).toBe(T1_DE_QUINTA);
    expect(cenario.estado.falhas_seguidas).toBe(1);
  });
});

describe("achado 4 (R2): o codigo c1..c5 so vale com a lista desta resposta", () => {
  it("o codigo de outra resposta e codigo_invalido; listando de novo, o codigo novo aponta a consulta certa", async () => {
    const cenario = new CenarioDaAg4();
    const { c1, c2 } = consultasDoContato(cenario.banco);
    await cenario.fala({
      texto: "Quais consultas eu tenho?",
      roteiro: [
        LISTAR(),
        final(
          "Você tem duas: quinta, 22/10 às 14:00, e terça, 27/10 às 09:00, que ainda espera a aprovação da equipe.",
        ),
      ],
    });
    // Entre as mensagens, a recepcao marca outra antes (quarta, 21/10): a
    // lista muda e "c2" passaria a ser a de quinta.
    cenario.banco.inserir(
      "appointment",
      consultaDoContato({
        inicio: iso("2026-10-21", "15:00"),
        fim: iso("2026-10-21", "15:30"),
        vinculo: VINC.consultaAna,
        profissional: PROF.ana,
        unidade: UNID.centro,
      }),
    );
    const r2 = await cenario.fala({
      texto: "Cancela a de terça",
      roteiro: [
        ferramenta("pedir_cancelamento", { consulta: "c2" }),
        final("Vou conferir as suas consultas de novo."),
      ],
    });
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({
      resultado: "codigo_invalido",
    });
    expect(r2.resposta).not.toContain("Confirma o cancelamento");
    expect(cenario.estado.pedido_pendente).toBeNull();
    // A busca da remarcacao pelo codigo tambem.
    await cenario.fala({
      texto: "Quero remarcar a de terça",
      roteiro: [
        ferramenta("buscar_horario_para_remarcar", {
          ...BUSCA_DE_SEGUNDA,
          consulta: "c2",
        }),
        final("Vou conferir as suas consultas de novo."),
      ],
    });
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({
      resultado: "codigo_invalido",
    });
    expect(cenario.estado.pedido_pendente).toBeNull();
    // Com a lista desta resposta: c3 e a de terca.
    const r3 = await cenario.fala({
      texto: "Cancela a de terça",
      roteiro: [LISTAR(), ferramenta("pedir_cancelamento", { consulta: "c3" })],
    });
    expect(r3.resposta).toContain(
      "Confirma o cancelamento da sua consulta de terça, 27/10 às 09:00?",
    );
    expect(cenario.estado.appointment_id).toBe(C2);
    await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(c2.status).toBe("cancelado_paciente");
    expect(c1.status).toBe("agendado");
  });
});

describe("achado 5 (R3): a pendencia dita na frase, nunca a afirmativa nem a generica", () => {
  async function ateRemarcar(cenario: CenarioDaAg4) {
    consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    expect(r.resposta).toBe(T4_SEGUNDA);
    expect(cenario.estado.desfecho).toBe("remarcou");
  }

  it.each([
    "Sim! Sua consulta foi remarcada para segunda, 26/10 às 08:00. A aprovação já saiu.",
    "Sua consulta foi remarcada para segunda, 26/10 às 08:00. Qualquer pendência, é só me chamar.",
    "Sua consulta foi remarcada para segunda, 26/10 às 08:00 e já foi aprovada.",
    "Sua remarcação para segunda, 26/10 às 08:00 está pendente da aprovação da equipe. Na verdade a equipe já aprovou.",
    "Sua consulta foi remarcada para segunda, 26/10 às 08:00. Obrigada! A aprovação é rapidinha.",
  ])("barra: %s", async (texto) => {
    const cenario = new CenarioDaAg4();
    await ateRemarcar(cenario);
    const r = await cenario.fala({
      texto: "Já está remarcada?",
      roteiro: [final(texto)],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({
      tipo: "bloqueou",
      categoria: "acao_nao_executada",
      camada: "regra",
    });
  });

  it.each([
    "Sua consulta foi remarcada para segunda, 26/10 às 08:00, pendente da aprovação da equipe.",
    "Pedi a remarcação para segunda, 26/10 às 08:00. Ela fica pendente até a equipe aprovar.",
    "Sua remarcação para segunda, 26/10 às 08:00 ainda não foi aprovada: a consulta de quinta, 22/10 às 14:00 continua marcada até lá.",
  ])("passa: %s", async (texto) => {
    const cenario = new CenarioDaAg4();
    await ateRemarcar(cenario);
    const r = await cenario.fala({
      texto: "Já está remarcada?",
      roteiro: [final(texto)],
    });
    expect(r.tipo).toBe("resposta");
  });
});

describe("achado 2 (R4): a remarcacao sem ja_tem_consulta", () => {
  it("o caminho feliz remarca a de quinta com a de terca (mesmo procedimento, pendente) de pe: prova verdadeira", async () => {
    const cenario = new CenarioDaAg4();
    const { c1, c2 } = consultasDoContato(cenario.banco);
    expect(c1.service_link_id).toBe(c2.service_link_id);
    expect(c2.approval_status).toBe("pendente");
    await ateAPerguntaDaRemarcacao(cenario);
    expect(cenario.banco.chamadasDe("reservar_horario_da_ia")).toEqual([
      expect.objectContaining({ p_remarcar: C1 }),
    ]);
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    expect(r.resposta).toBe(T4_SEGUNDA);
    // O contrato da AG3 (sem p_remarcar) continua recusando ja_tem_consulta
    // do mesmo procedimento: so a remarcacao deixa de conferir.
    const { data } = await cenario.banco.cliente().rpc("reservar_horario_da_ia", {
      p_clinic_id: CLINICA,
      p_conversation_id: CONVERSA,
      p_service_link_id: VINC.consultaAna,
      p_starts_at: iso("2026-10-28", "08:00"),
      p_job_id: "20000000-0000-4000-8000-0000000000bb",
      p_unit_id: UNID.aldeota,
    });
    expect(data).toMatchObject({ ok: false, motivo: "ja_tem_consulta" });
  });

  it("ja_tem_consulta no reservar da remarcacao e fora do contrato: falha fechada, nunca \"voce ja tem consulta\"", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await cenario.fala({
      texto: "Quero remarcar a de quinta",
      roteiro: [
        LISTAR(),
        ferramenta("buscar_horario_para_remarcar", BUSCA_DE_SEGUNDA),
        final("Tenho segunda, 26/10 às 08:00. Pode ser?"),
      ],
    });
    cenario.opcoes.forcar = { reservar: "ja_tem_consulta" };
    const r = await cenario.fala({
      texto: "Pode",
      roteiro: [
        ferramenta("reservar_horario", { horario: "h1" }),
        final("Você já tem uma consulta marcada desse procedimento."),
      ],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.desfecho).toMatchObject({ tipo: "falhou" });
    expect(r.trilha.map((p) => p.texto)).toContain(
      "Não reservou segunda, 26/10 às 08:00 para a remarcação: o banco respondeu fora do contrato da remarcação.",
    );
  });

  it("o prompt nao manda dizer \"voce ja tem consulta\" no meio de uma remarcacao", () => {
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'Fora de uma remarcação, se reservar_horario ou agendar disser "ja_tem_consulta"',
    );
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "Na remarcação, a pessoa já tem a consulta que está sendo remarcada: nunca diga que ela já tem consulta marcada como motivo para não remarcar.",
    );
  });
});

describe("achado 3 (R9): buscar e reservar a remarcacao na mesma resposta", () => {
  it("sem a RPC: o horario vai a pessoa e a escolha vem numa mensagem nova", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const r = await cenario.fala({
      texto: "Quero remarcar a de quinta para segunda, 26/10, às 8h",
      roteiro: [
        LISTAR(),
        ferramenta("buscar_horario_para_remarcar", {
          consulta: "c1",
          a_partir_de: "2026-10-26",
          periodo: null,
          hora: "08:00",
          unidade: null,
        }),
        ferramenta("reservar_horario", { horario: "h1" }),
        final("Tenho segunda, 26/10 às 08:00 livre. Posso reservar para você?"),
      ],
    });
    expect(cenario.banco.chamadasDe("reservar_horario_da_ia")).toEqual([]);
    expect(saidas(cenario.corpos.at(-1)).at(-1)).toEqual({
      resultado: "oferecer_antes_de_reservar",
    });
    expect(r.tipo).toBe("resposta");
    expect(r.trilha.map((p) => p.texto)).toContain(
      "Tentou reservar segunda, 26/10 às 08:00 para a remarcação na mesma resposta da busca: o horário vai à pessoa primeiro",
    );
    expect(cenario.estado).toMatchObject({
      pedido_pendente: "remarcar",
      appointment_id: C1,
      etapa: "oferta",
      falhas_seguidas: 0,
    });
    // Na mensagem seguinte, o pedido ja esta gravado: a reserva sai (T3).
    const r2 = await cenario.fala({
      texto: "Pode",
      roteiro: [ferramenta("reservar_horario", { horario: "h1" })],
    });
    expect(r2.resposta).toBe(T3_SEGUNDA);
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      "nunca chame reservar_horario na mesma resposta de buscar_horario_para_remarcar",
    );
  });
});

describe("achado 6 (R8, D-13): reserva_diferente na remarcacao", () => {
  it("ao modelo, so o dia, a hora e (com duas unidades) a unidade; os nomes ficam na trilha", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    cenario.opcoes.forcar = { agendar: "reserva_diferente" };
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        ferramenta("reservar_horario", { horario: "h1" }),
      ],
    });
    const lidas = cenario.corpos.map((c) => saidas(c));
    expect(lidas.at(-1)?.[0]).toEqual({
      resultado: "reserva_diferente",
      horario_reservado: {
        dia: "segunda, 26/10",
        hora: "08:00",
        unidade: "Aldeota",
      },
    });
    expect(JSON.stringify(lidas)).not.toMatch(/Ana Lima|"procedimento"|"profissional"/);
    expect(r.trilha.map((p) => p.texto).join("\n")).toContain(
      "(o reservado é segunda, 26/10 às 08:00 (Consulta, Dra. Ana Lima), unidade Aldeota)",
    );
    // O modelo reserva de novo e o sistema pergunta outra vez.
    expect(r.resposta).toBe(T3_SEGUNDA);
  });
});

describe("achado 7 (R6): o cancelamento e a remarcacao aprovada no turno seguinte", () => {
  it("\"foi cancelada\" com o par da cancelada passa; com outro par, ou dando a cancelada por marcada, barra", async () => {
    for (const [texto, tipo] of [
      ["Sim, sua consulta de 22/10 às 14:00 foi cancelada.", "resposta"],
      ["Sim, a de quinta, 22/10 às 14:00 já foi cancelada. Quer marcar outro dia?", "resposta"],
      ["Sim, sua consulta de 27/10 às 09:00 foi cancelada.", "frase_fixa"],
      ["Sua consulta de quinta, 22/10 às 14:00 continua marcada.", "frase_fixa"],
    ] as const) {
      const cenario = new CenarioDaAg4();
      consultasDoContato(cenario.banco);
      await pedirOCancelamento(cenario);
      await cenario.fala({
        texto: "Sim",
        roteiro: [ferramenta("cancelar_consulta", {})],
      });
      const r = await cenario.fala({
        texto: "Então foi cancelada mesmo?",
        roteiro: [final(texto)],
      });
      expect(r.tipo, texto).toBe(tipo);
      // O bloco do modelo e o resumo do verificador dizem a cancelada.
      expect(blocoDoEstado(cenario.instrucoesDaChamada(3))).toContain(
        "Consulta cancelada nesta conversa: quinta, 22/10 às 14:00.",
      );
      if (tipo === "resposta") {
        expect(cenario.verificacao.pedidos.at(-1)?.resumoDosFatos).toContain(
          "Consultas que a assistente cancelou nesta conversa, relidas pelo sistema nesta resposta e ainda canceladas (dia e hora juntos):\n- quinta, 22/10 às 14:00, unidade Centro",
        );
      }
    }
  });

  it("a politica do verificador aceita a cancelada e a aprovada do resumo, so com o dia e a hora delas", () => {
    expect(POLITICA_DO_VERIFICADOR).toContain(
      "A consulta que o resumo traz como cancelada pela assistente nesta conversa pode ser dada como cancelada, e a remarcação que ele traz como já aprovada pela equipe pode ser dada como remarcada, só com o dia e a hora delas; dar uma delas como marcada ou de pé é acao_nao_executada.",
    );
    expect(POLITICA_DO_VERIFICADOR).not.toMatch(/[–—]/);
  });

  it("a passagem no turno seguinte: a nota diz a cancelada, nunca \"marcada nesta conversa\"", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    const r = await cenario.fala({
      texto: "Obrigada. Vocês atendem aos sábados?",
      roteiro: [ferramenta("escalar_humano", { motivo: "agente_pediu" })],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.notaParaAEquipe).toContain(
      "Consulta cancelada pelo assistente nesta conversa: quinta, 22/10 às 14:00.",
    );
    expect(r.notaParaAEquipe).not.toContain("Consulta marcada pelo assistente");
    expect(r.notaParaAEquipe).not.toMatch(/[–—]/);
  });

  it("a cancelada que voltou (a recepcao reativou) nao e mais fato", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    c1.status = "agendado";
    const r = await cenario.fala({
      texto: "Foi cancelada?",
      roteiro: [final("Sim, sua consulta de 22/10 às 14:00 foi cancelada.")],
    });
    expect(r.tipo).toBe("frase_fixa");
  });

  it("depois da aprovacao, \"foi remarcada\" passa com o par da nova (sem a pendencia); antes, so com ela", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    const antes = await cenario.fala({
      texto: "Já está remarcada?",
      roteiro: [final("Sua consulta foi remarcada para segunda, 26/10 às 08:00.")],
    });
    expect(antes.tipo).toBe("frase_fixa");
    // A equipe aprova (o gatilho cancela a antiga).
    const nova = cenario.banco
      .linhas("appointment")
      .find((a) => a.remarcacao_de === C1);
    expect(nova).toBeDefined();
    nova!.approval_status = "aprovado";
    c1.status = "cancelado_paciente";
    const r = await cenario.fala({
      texto: "E agora, já está remarcada?",
      roteiro: [final("Sim! Sua consulta foi remarcada para segunda, 26/10 às 08:00.")],
    });
    expect(r.tipo).toBe("resposta");
    expect(cenario.verificacao.pedidos.at(-1)?.resumoDosFatos).toContain(
      "segunda, 26/10 às 08:00, unidade Aldeota (remarcação pedida pela assistente nesta conversa, já aprovada pela equipe)",
    );
    const outro = await cenario.fala({
      texto: "Para que dia ficou?",
      roteiro: [final("Sua consulta foi remarcada para terça, 27/10 às 08:00.")],
    });
    expect(outro.tipo).toBe("frase_fixa");
  });
});

describe("achado 9: a busca da remarcacao com consulta null reconfere o foco", () => {
  async function comOFoco(cenario: CenarioDaAg4) {
    await cenario.fala({
      texto: "Quero remarcar a de quinta",
      roteiro: [
        LISTAR(),
        ferramenta("buscar_horario_para_remarcar", BUSCA_DE_SEGUNDA),
        final("Tenho segunda, 26/10 às 08:00. Pode ser?"),
      ],
    });
    expect(cenario.estado).toMatchObject({
      pedido_pendente: "remarcar",
      appointment_id: C1,
    });
  }
  const DE_NOVO = {
    consulta: null,
    a_partir_de: "2026-10-27",
    periodo: "manha",
    hora: null,
    unidade: null,
  };

  it("o prazo que passou entre as mensagens: fora_do_prazo, sem horario", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await comOFoco(cenario);
    // Quarta, 21/10 as 15:00: a de quinta 14:00 ficou a menos de 24 horas.
    cenario.agora = Date.parse("2026-10-21T18:00:00.000Z");
    const r = await cenario.fala({
      texto: "Tem na terça?",
      roteiro: [ferramenta("buscar_horario_para_remarcar", DE_NOVO)],
    });
    expect(r.desfecho).toMatchObject({
      motivo: "fora_do_prazo",
      origem: "ferramenta",
    });
    expect(r.notaParaAEquipe).toContain(
      "Parou em: o pedido ficou dentro do prazo da clínica para o assistente remarcar (24 horas).",
    );
  });

  it("outra conversa pediu a remarcacao dela: a equipe (remarcacao_pendente), sem horario", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await comOFoco(cenario);
    cenario.banco.inserir(
      "appointment",
      consultaDoContato({
        inicio: iso("2026-10-29", "15:00"),
        fim: iso("2026-10-29", "15:30"),
        vinculo: VINC.consultaAna,
        profissional: PROF.ana,
        aprovacao: "pendente",
        remarcacaoDe: C1,
        criadaPor: "ia",
      }),
    );
    const r = await cenario.fala({
      texto: "Tem na terça?",
      roteiro: [ferramenta("buscar_horario_para_remarcar", DE_NOVO)],
    });
    expect(r.desfecho).toMatchObject({ motivo: "pedido_de_agenda" });
    expect(r.notaParaAEquipe).toContain(
      "Parou em: a consulta já tem uma remarcação esperando a aprovação.",
    );
  });

  it("de pe e fora do prazo: a busca segue com o foco relido", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await comOFoco(cenario);
    const r = await cenario.fala({
      texto: "Tem na terça?",
      roteiro: [
        ferramenta("buscar_horario_para_remarcar", DE_NOVO),
        final("Tenho terça, 27/10 às 08:00. Pode ser?"),
      ],
    });
    expect(r.tipo).toBe("resposta");
    expect(saidas(cenario.corpos.at(-1))[0]).toMatchObject({
      resultado: "horarios",
      consulta: { dia: "quinta, 22/10", hora: "14:00" },
    });
  });
});
