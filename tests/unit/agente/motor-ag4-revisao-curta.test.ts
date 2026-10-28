import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  lerSaidaAntesDaRespostaDaIa,
  portaDaAgendaDoWhatsapp,
} from "@/lib/agente/agenda";
import {
  dadosVazios,
  estadoVazio,
  falhasDepoisDoTurno,
  FALHAS_QUE_O_AVANCO_NAO_APAGA,
  type EstadoDoAtendimento,
} from "@/lib/agente/atendimento";
import { criarAgendaDoTurno } from "@/lib/agente/ferramentas/agenda-do-turno";
import { MARCA_DO_NOME } from "@/lib/agente/historico";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";

import {
  C1,
  CATALOGO_DA_AG4,
  CenarioDaAg4,
  configDaAg4,
  consultasDoContato,
  ferramenta,
  final,
  saidas,
} from "./ag4-conversa";
import {
  consultaDoContato,
  mensagemNovaDoPaciente,
  perguntaRespondida,
  type MensagemNoBanco,
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

// Revisao curta das correcoes da AG4 (27/10/2026): os achados 1 a 9, em
// conversas de varias falas com o LLM FALSO sobre o contrato das RPCs em
// memoria, que espelha a revisao curta da frente de banco (contrato-mudancas
// R7 a R10: mensagem_nova_do_paciente, a validade e o consulta_mudou
// contados da pergunta respondida, a ancora forte tambem na marcacao da
// AG3). A conversa mora na tabela message do banco em memoria: o motor le a
// saida logo antes da resposta da pessoa como o banco. Nenhum teste fala com
// a OpenAI nem com o banco.

const T1_DE_QUINTA =
  "Confirma o cancelamento da sua consulta de quinta, 22/10 às 14:00?";
const T2_DE_QUINTA =
  "Tudo bem, sua consulta de 22/10 às 14:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.";
const T3_SEGUNDA =
  "Reservei segunda, 26/10 às 08:00, na unidade Aldeota, por 10 minutos. Confirma a remarcação da sua consulta de quinta, 22/10 às 14:00 para segunda, 26/10 às 08:00?";
const T4_SEGUNDA =
  "Pronto, pedi a remarcação para segunda, 26/10 às 08:00. Até a equipe aprovar, sua consulta de quinta, 22/10 às 14:00 continua marcada. A confirmação chega por aqui.";
const CONFIRMA_DA_AG3 =
  "Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?";

const LISTAR = () => ferramenta("consultar_minhas_consultas", {});
const BUSCA_DE_SEGUNDA = {
  consulta: "c1",
  a_partir_de: "2026-10-26",
  periodo: "manha",
  hora: null,
  unidade: null,
};
const SEM_DADOS = { nomeCompleto: false, nascimento: false, cpf: false };

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

/** As saidas gravadas na conversa (o que a pessoa recebeu). */
function enviadas(cenario: CenarioDaAg4): MensagemNoBanco[] {
  return cenario.noBanco.filter((m) => m.direcao === "saida");
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
async function ateAPerguntaDaRemarcacao(cenario: CenarioDaAg4, t3 = T3_SEGUNDA) {
  await cenario.fala({
    texto: "Quero remarcar a de quinta para a semana que vem, de manhã",
    roteiro: [
      LISTAR(),
      ferramenta("buscar_horario_para_remarcar", BUSCA_DE_SEGUNDA),
      final("Tenho segunda, 26/10 às 08:00 e terça, 27/10 às 08:00. Qual fica melhor?"),
    ],
  });
  const r = await cenario.fala({
    texto: "Segunda às 8",
    roteiro: [ferramenta("reservar_horario", { horario: "h1" })],
  });
  expect(r.resposta).toBe(t3);
}

/**
 * A marcacao da AG3 ja perguntada: a reserva viva de quarta, 21/10 as 14:00
 * (Dra. Ana, Centro, particular) e o "Confirma ...?" da IA depois dela. Sem
 * dado exigido (nada falta) e sem consulta do contato (nada de
 * ja_tem_consulta).
 */
function marcacaoJaPerguntada(): CenarioDaAg4 {
  const cenario = new CenarioDaAg4({
    config: configDaAg4({ dadosExigidos: SEM_DADOS }),
    opcoes: { exigidos: SEM_DADOS },
  });
  const holdId = randomUUID();
  cenario.banco.inserir("slot_hold", {
    id: holdId,
    clinic_id: CLINICA,
    professional_id: PROF.ana,
    conversation_id: CONVERSA,
    service_link_id: VINC.consultaAna,
    job_id: randomUUID(),
    unit_id: UNID.centro,
    starts_at: iso("2026-10-21", "14:00"),
    ends_at: iso("2026-10-21", "14:30"),
    expires_at: new Date(AGORA + 10 * 60_000).toISOString(),
    created_at: new Date(AGORA - 60_000).toISOString(),
    consumido_em: null,
  });
  const estado: EstadoDoAtendimento = {
    ...estadoVazio(),
    etapa: "aguardando_confirmacao",
    intencao: "agendar",
    slot_hold_id: holdId,
    professional_id: PROF.ana,
    unit_id: UNID.centro,
    particular: true,
  };
  cenario.atendimento = { estado, dados: dadosVazios() };
  cenario.daClinica(CONFIRMA_DA_AG3, "ia");
  return cenario;
}

describe("achado 1: a corrida do \"sim\" (mensagem_nova_do_paciente, R7)", () => {
  it("cancelar: a pessoa escreve de novo no meio do turno do \"Sim\": nada cancelado, nada enviado, nenhuma falha; o job seguinte le as duas", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    const doComeco = structuredClone(cenario.estado);
    const antes = enviadas(cenario).length;
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
      durante: (c) => {
        c.escreve("Não, espera, deixa como está");
      },
    });
    // O banco recusou (a RPC rodou uma vez): nada cancelado.
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    expect(c1.status).toBe("agendado");
    // Nada sai e a conversa NAO passa para a equipe: o desfecho e o "sem
    // mensagem" (o executor fecha o turno sem envio e conclui o job).
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "sem_mensagem" });
    expect(r.notaParaAEquipe).toBeNull();
    expect(enviadas(cenario)).toHaveLength(antes);
    expect(r.trilha.map((p) => p.texto).join("\n")).toContain(
      "Não cancelou a consulta de quinta, 22/10 às 14:00 (Consulta, Dra. Ana Lima): a pessoa mandou outra mensagem enquanto o assistente respondia. Nada foi enviado; a próxima resposta lê a mensagem nova.",
    );
    expect(r.trilha.map((p) => p.texto).join("\n")).not.toMatch(
      /Passou para a equipe/,
    );
    // O estado do comeco: o pedido armado, nenhuma falha.
    expect(r.atendimento?.estado).toEqual(doComeco);
    expect(cenario.estado).toMatchObject({
      etapa: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: C1,
      falhas_seguidas: 0,
    });
    // O job seguinte le as duas mensagens: a pergunta continua a ultima
    // saida antes da resposta (confere), e a resposta misturada nao e um
    // sim claro: a pergunta volta, nada cancelado.
    const r2 = await cenario.continua({
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    expect(r2.tipo).toBe("resposta");
    expect(r2.resposta).toBe(T1_DE_QUINTA);
    expect(c1.status).toBe("agendado");
    // Nenhum texto do paciente em log.
    expect(escrito.join("")).not.toMatch(/espera|deixa como/);
  });

  it("cancelar: com o job seguinte dizendo so \"sim\" de novo, cancela (a mensagem nova foi lida)", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
      durante: (c) => {
        c.escreve("Pode cancelar");
      },
    });
    expect(c1.status).toBe("agendado");
    const r = await cenario.continua({
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(r.resposta).toBe(T2_DE_QUINTA);
    expect(c1.status).toBe("cancelado_paciente");
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(2);
  });

  it("remarcar: a mensagem nova no meio do \"Confirmo\": nada pedido, nada enviado; a etapa e a reserva ficam e o job seguinte remarca", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    const doComeco = structuredClone(cenario.estado);
    const antes = enviadas(cenario).length;
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
      durante: (c) => {
        c.escreve("Obrigada!");
      },
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(
      cenario.banco.linhas("appointment").some((a) => a.remarcacao_de === C1),
    ).toBe(false);
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "sem_mensagem" });
    expect(enviadas(cenario)).toHaveLength(antes);
    expect(r.atendimento?.estado).toEqual(doComeco);
    expect(cenario.estado.etapa).toBe("aguardando_confirmacao");
    const r2 = await cenario.continua({ roteiro: [ferramenta("agendar", {})] });
    expect(r2.resposta).toBe(T4_SEGUNDA);
    expect(
      cenario.banco.linhas("appointment").some((a) => a.remarcacao_de === C1),
    ).toBe(true);
  });

  it("marcar (AG3, R9): a mensagem nova no meio do \"sim\": nada marcado, nada enviado; o job seguinte marca", async () => {
    const cenario = marcacaoJaPerguntada();
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {})],
      durante: (c) => {
        c.escreve("Obrigada!");
      },
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(cenario.banco.linhas("appointment")).toEqual([]);
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "sem_mensagem" });
    expect(cenario.estado).toMatchObject({
      etapa: "aguardando_confirmacao",
      falhas_seguidas: 0,
    });
    const r2 = await cenario.continua({
      roteiro: [ferramenta("agendar", {}), final("Pronto! Ficou pendente da aprovação da equipe.")],
    });
    expect(saidas(cenario.corpos.at(-1))[0]).toMatchObject({
      resultado: "marcado",
    });
    expect(r2.tipo).toBe("resposta");
    expect(cenario.banco.linhas("appointment")).toHaveLength(1);
  });

  it("o espelho de R7: as conferidas (a ultima e as depois da pergunta), a apagada lida e a apagada nao lida", () => {
    const pergunta: MensagemNoBanco = {
      id: "p",
      direcao: "saida",
      autor: "ia",
      em: 2_000,
    };
    const sim: MensagemNoBanco = {
      id: "s",
      direcao: "entrada",
      autor: "paciente",
      em: 3_000,
    };
    const outra: MensagemNoBanco = { ...sim, id: "o", em: 3_500 };
    expect(mensagemNovaDoPaciente([pergunta, sim], ["s"], pergunta)).toBe(false);
    // Chegou depois da leitura.
    expect(mensagemNovaDoPaciente([pergunta, sim, outra], ["s"], pergunta)).toBe(
      true,
    );
    // Depois da pergunta, mesmo nao sendo a ultima.
    expect(
      mensagemNovaDoPaciente([pergunta, outra, { ...sim, em: 4_000 }], ["s"], pergunta),
    ).toBe(true);
    // A apagada que o job leu (o paciente apagou o que o modelo leu).
    expect(
      mensagemNovaDoPaciente([pergunta, { ...sim, apagada: true }], ["s"], pergunta),
    ).toBe(true);
    // A apagada que o job nao leu nao conta.
    expect(
      mensagemNovaDoPaciente(
        [pergunta, sim, { ...outra, apagada: true }],
        ["s"],
        pergunta,
      ),
    ).toBe(false);
    // Sem as lidas, nao confere.
    expect(mensagemNovaDoPaciente([pergunta, sim, outra], undefined)).toBe(false);
    // A pergunta respondida: a ultima da IA, nao falhada, depois do piso e
    // antes da ultima do paciente.
    expect(perguntaRespondida([pergunta, sim], 1_000)).toEqual(pergunta);
    expect(perguntaRespondida([pergunta, sim], 2_500)).toBeNull();
    expect(
      perguntaRespondida([{ ...pergunta, falhou: true }, sim], 1_000),
    ).toBeNull();
  });
});

describe("achado 2: a pergunta conferida contra o corpo ORIGINAL (a mascara do nome)", () => {
  it("contato Domingo e a consulta de domingo: a T1 confere e o \"Sim\" cancela (antes ia a equipe a toa)", async () => {
    const cenario = new CenarioDaAg4({ nomeDoContato: "Domingo Alves" });
    const c = consultaDoContato({
      id: C1,
      inicio: iso("2026-10-25", "10:00"),
      fim: iso("2026-10-25", "10:30"),
      vinculo: VINC.consultaAna,
      profissional: PROF.ana,
      unidade: UNID.centro,
    });
    cenario.banco.inserir("appointment", c);
    const r1 = await cenario.fala({
      texto: "Quero cancelar minha consulta",
      roteiro: [LISTAR(), ferramenta("pedir_cancelamento", { consulta: "c1" })],
    });
    expect(r1.resposta).toContain(
      "Confirma o cancelamento da sua consulta de domingo, 25/10 às 10:00?",
    );
    // O historico do modelo mascara o primeiro nome do contato ("domingo"):
    // o texto mascarado nunca bate com a frase.
    expect(cenario.mensagens.at(-1)?.texto).toContain(
      `consulta de ${MARCA_DO_NOME}, 25/10`,
    );
    const r2 = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    expect(c.status).toBe("cancelado_paciente");
    expect(r2.resposta).toBe(
      "Tudo bem, sua consulta de 25/10 às 10:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.",
    );
  });

  it("unidade Vila Mariana e a contato Mariana: a T3 confere e o \"Confirmo\" remarca (antes, laco sem fim)", async () => {
    const catalogo = {
      ...CATALOGO_DA_AG4,
      unidades: (CATALOGO_DA_AG4.unidades ?? []).map((u) =>
        u.id === UNID.aldeota ? { ...u, nome: "Vila Mariana" } : u,
      ),
    };
    const cenario = new CenarioDaAg4({ catalogo, nomeDoContato: "Mariana Costa" });
    consultasDoContato(cenario.banco);
    const t3 =
      "Reservei segunda, 26/10 às 08:00, na unidade Vila Mariana, por 10 minutos. Confirma a remarcação da sua consulta de quinta, 22/10 às 14:00 para segunda, 26/10 às 08:00?";
    await ateAPerguntaDaRemarcacao(cenario, t3);
    expect(cenario.mensagens.at(-1)?.texto).toContain(
      `na unidade Vila ${MARCA_DO_NOME}`,
    );
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(r.resposta).toBe(T4_SEGUNDA);
    expect(cenario.estado.desfecho).toBe("remarcou");
  });

  it("a T3 que nunca confere: a recusa conta falha mesmo com o reservar de novo no mesmo turno; na segunda seguida, a equipe", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    for (const [i, esperado] of (["resposta", "frase_fixa"] as const).entries()) {
      cenario.daClinica(
        `Lembrete ${i + 1}: sua consulta é na quinta, 22/10 às 14:00. Responda SIM para confirmar.`,
      );
      const r = await cenario.fala({
        texto: "Confirmo",
        roteiro: [
          ferramenta("agendar", {}),
          ferramenta("reservar_horario", { horario: "h1" }),
        ],
      });
      expect(r.tipo, String(i)).toBe(esperado);
      if (esperado === "resposta") {
        expect(r.resposta).toBe(T3_SEGUNDA);
        expect(cenario.estado.falhas_seguidas).toBe(1);
      } else {
        expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
        expect(r.desfecho).toMatchObject({
          tipo: "escalou",
          motivo: "falhas_seguidas",
        });
      }
    }
    expect(cenario.estado.desfecho).toBe("passou_para_equipe");
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
  });

  it("o banco barra o \"Sim\" do cancelamento (sem_confirmacao_do_paciente) num turno que tambem listou as consultas: a pergunta volta e a falha fica", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    cenario.opcoes.forcar = { cancelar: "sem_confirmacao_do_paciente" };
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [LISTAR(), ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    expect(c1.status).toBe("agendado");
    expect(r.resposta).toBe(T1_DE_QUINTA);
    // "consultas" avanca, mas a recusa da pergunta fica (a segunda seguida
    // vai a equipe, nunca um laco).
    expect(cenario.estado.falhas_seguidas).toBe(1);
  });

  it("a falha que o avanco do mesmo turno nao apaga (a lista fechada)", () => {
    expect([...FALHAS_QUE_O_AVANCO_NAO_APAGA]).toEqual([
      "resposta_fora_da_pergunta",
    ]);
    expect(
      falhasDepoisDoTurno(0, ["sem_confirmacao_do_paciente", "reservado"]),
    ).toBe(0);
    expect(
      falhasDepoisDoTurno(0, [
        "sem_confirmacao_do_paciente",
        "resposta_fora_da_pergunta",
        "reservado",
      ]),
    ).toBe(1);
    expect(
      falhasDepoisDoTurno(1, ["resposta_fora_da_pergunta", "consultas"]),
    ).toBe(2);
  });
});

describe("achado 3: \"Ja aprovaram?\" com a remarcacao pendente", () => {
  it("a negacao da aprovacao e a pendencia passam; a aprovacao afirmada barra", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    const t4 = await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    expect(t4.resposta).toBe(T4_SEGUNDA);
    for (const resposta of [
      "Ainda não. A aprovação ainda não saiu.",
      "Ainda não tem a aprovação da equipe.",
      "Ainda não tem aprovação da equipe para a remarcação.",
      "Não, a aprovação não veio ainda.",
      "Ainda não há aprovação da equipe.",
      "Por enquanto não tem aprovação ainda.",
    ]) {
      const r = await cenario.fala({
        texto: "Já aprovaram?",
        roteiro: [final(resposta)],
      });
      expect(r.tipo, resposta).toBe("resposta");
      expect(r.resposta).toBe(resposta);
    }
    const barrada = await cenario.fala({
      texto: "Já aprovaram?",
      roteiro: [final("Sim, a aprovação já saiu.")],
    });
    expect(barrada.desfecho).toMatchObject({
      tipo: "bloqueou",
      categoria: "acao_nao_executada",
    });
  });
});

describe("achado 4: o id da consulta cancelada sai do estado quando o estado deixa o cancelamento", () => {
  it("depois de cancelar, \"quero marcar outra\": o id sai, e a nota da passagem nunca diz \"Consulta marcada pelo assistente\"", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    // O estado do cancelamento guarda a cancelada (o fato do turno seguinte).
    expect(cenario.estado).toMatchObject({
      appointment_id: C1,
      desfecho: "cancelou",
    });
    await cenario.fala({
      texto: "Quero marcar outra consulta, para o mês que vem",
      roteiro: [
        ferramenta("buscar_horario", {
          procedimento: "p1",
          profissional: null,
          convenio: null,
          a_partir_de: null,
          periodo: null,
          unidade: null,
          hora: null,
        }),
        final("Certo. Para quando você prefere a consulta nova?"),
      ],
    });
    expect(cenario.estado.intencao).toBe("agendar");
    expect(cenario.estado.appointment_id).toBeNull();
    const r = await cenario.fala({
      texto: "Prefiro falar com alguém",
      roteiro: [ferramenta("escalar_humano", { motivo: "pedido_humano" })],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.notaParaAEquipe).not.toContain("Consulta marcada pelo assistente");
    expect(r.notaParaAEquipe).not.toMatch(/[–—]/);
  });

  it("no proprio turno seguinte ao cancelamento, a passagem diz a cancelada (nunca \"marcada\")", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    const r = await cenario.fala({
      texto: "Quero marcar outra consulta",
      roteiro: [ferramenta("escalar_humano", { motivo: "agente_pediu" })],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.notaParaAEquipe).toContain(
      "Consulta cancelada pelo assistente nesta conversa: quinta, 22/10 às 14:00.",
    );
    expect(r.notaParaAEquipe).not.toContain("Consulta marcada pelo assistente");
  });
});

describe("achado 6: a T1 (e a T3) da mesma consulta com outro horario e consulta_mudou", () => {
  it("a recepcao muda o horario entre a T1 e o \"Sim\": sem falha e sem a trilha de outra mensagem; a pergunta volta com o horario novo e o \"Sim\" seguinte cancela (R8)", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    c1.starts_at = iso("2026-10-22", "15:00");
    c1.ends_at = iso("2026-10-22", "15:30");
    c1.remarcada_em = new Date(cenario.agora + 60_000).toISOString();
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
    expect(r.resposta).toBe(
      "Confirma o cancelamento da sua consulta de quinta, 22/10 às 15:00?",
    );
    const trilha = r.trilha.map((p) => p.texto).join("\n");
    expect(trilha).toContain(
      "A consulta do pedido de cancelamento mudou de horário depois da pergunta (nada foi cancelado): perguntou de novo se a pessoa confirma o cancelamento da consulta de quinta, 22/10 às 15:00 (Consulta, Dra. Ana Lima)",
    );
    expect(trilha).not.toContain("outra mensagem da clínica saiu no meio");
    expect(cenario.estado.falhas_seguidas).toBe(0);
    expect(blocoDoEstado(cenario.instrucoesDaChamada(2))).toContain(
      "Pedido de cancelar: a consulta mudou de horário depois da pergunta do cancelamento e agora é quinta, 22/10 às 15:00.",
    );
    // O banco conta o consulta_mudou do comeco do job da pergunta (R8): a
    // pergunta nova e de um job criado depois da mudanca.
    const r2 = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    expect(c1.status).toBe("cancelado_paciente");
    expect(r2.resposta).toBe(
      "Tudo bem, sua consulta de 22/10 às 15:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.",
    );
  });

  it("a recepcao muda o horario da antiga entre a T3 e o \"Confirmo\": consulta_mudou sem a RPC e sem falha; reservar de novo pergunta com o horario novo e remarca", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    c1.starts_at = iso("2026-10-22", "15:00");
    c1.ends_at = iso("2026-10-22", "15:30");
    c1.remarcada_em = new Date(cenario.agora + 60_000).toISOString();
    const t3Novo =
      "Reservei segunda, 26/10 às 08:00, na unidade Aldeota, por 10 minutos. Confirma a remarcação da sua consulta de quinta, 22/10 às 15:00 para segunda, 26/10 às 08:00?";
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        ferramenta("reservar_horario", { horario: "h1" }),
      ],
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({
      resultado: "consulta_mudou",
    });
    expect(r.resposta).toBe(t3Novo);
    expect(cenario.estado.falhas_seguidas).toBe(0);
    const r2 = await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    expect(r2.resposta).toBe(
      "Pronto, pedi a remarcação para segunda, 26/10 às 08:00. Até a equipe aprovar, sua consulta de quinta, 22/10 às 15:00 continua marcada. A confirmação chega por aqui.",
    );
  });
});

describe("achado 7: repetir o mesmo job depois de cancelar (a idempotencia)", () => {
  const armado = (): EstadoDoAtendimento => ({
    ...estadoVazio(),
    etapa: "cancelar",
    intencao: "cancelar",
    pedido_pendente: "cancelar",
    pedido_pendente_em: new Date(AGORA - 5 * 60_000).toISOString(),
    appointment_id: C1,
  });

  /** A agenda do turno do job JOB, com o estado lido e o "Sim". */
  function turnoDoJob(cenario: CenarioDaAg4, estado = armado()) {
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
        doPaciente: [{ mascarado: "Sim", original: "Sim" }],
        pendentes: [{ mascarado: "Sim", original: "Sim" }],
        antesDasPendentes: null,
      },
      agora: () => AGORA,
    });
  }

  /** A pergunta da IA e o "Sim" no banco (o job JOB leu o "Sim"). */
  function conversaComOSim(cenario: CenarioDaAg4) {
    cenario.atendimento = { estado: armado(), dados: dadosVazios() };
    cenario.soNoBanco("ia", { em: AGORA - 4 * 60_000, texto: T1_DE_QUINTA });
    cenario.lidasPorJob.set(JOB, [cenario.escreve("Sim", AGORA - 60_000)]);
  }

  it("o job cancela e cai antes de gravar o turno; a retomada le a consulta ja cancelada e deixa a RPC decidir: reutilizado e a T2", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    conversaComOSim(cenario);
    const primeiro = turnoDoJob(cenario);
    await primeiro.preparar();
    expect(await primeiro.executar("cancelar_consulta", {})).toMatchObject({
      tipo: "frase",
      resultado: "cancelada",
      texto: T2_DE_QUINTA,
    });
    expect(c1.status).toBe("cancelado_paciente");
    // A retomada: o mesmo job, o mesmo estado lido (nada foi gravado).
    const retomada = turnoDoJob(cenario);
    await retomada.preparar();
    // O bloco do modelo diz o pedido com o dia e a hora da pergunta (a
    // retomada chama cancelar_consulta de novo), e nunca e fato.
    expect(retomada.paraOModelo()?.pedidoDaConsulta).toMatchObject({
      acao: "cancelar",
      dia: "quinta, 22/10",
      hora: "14:00",
    });
    expect(retomada.fatosDoEstado()).toBeNull();
    const r = await retomada.executar("cancelar_consulta", {});
    expect(r).toMatchObject({
      tipo: "frase",
      resultado: "cancelada",
      texto: T2_DE_QUINTA,
    });
    expect(r.tipo === "frase" && r.passo).toBe(
      "Cancelou a consulta de quinta, 22/10 às 14:00 (Consulta, Dra. Ana Lima), a pedido da pessoa (a mesma resposta retomada: o cancelamento já estava feito)",
    );
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(2);
    expect(
      cenario.banco
        .linhas("appointment_status_history")
        .filter((h) => h.ia_job_id === JOB),
    ).toHaveLength(1);
    expect(
      retomada.fechar({ mensagemFinal: T2_DE_QUINTA, passou: false }).estado,
    ).toMatchObject({
      desfecho: "cancelou",
      appointment_id: C1,
      pedido_pendente: null,
      etapa: "informacao",
    });
  });

  it("outro cancelamento (a recepcao): a RPC diz consulta_encerrada, nada muda; sem o \"sim\" claro, nem a RPC", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    conversaComOSim(cenario);
    c1.status = "cancelado_clinica";
    const t = turnoDoJob(cenario);
    await t.preparar();
    const r = await t.executar("cancelar_consulta", {});
    expect(r).toMatchObject({ tipo: "saida", resultado: "consulta_encerrada" });
    expect(r.tipo === "saida" && r.passo).toBe(
      "Não cancelou a consulta de quinta, 22/10 às 14:00 (Consulta, Dra. Ana Lima): a consulta não está mais marcada (já passou, foi atendida ou cancelada)",
    );
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    // Com outra resposta da pessoa ("nao"), nem chega a RPC.
    const semSim = criarAgendaDoTurno({
      porta: portaDaAgendaDoWhatsapp(cenario.banco.cliente(), {
        clinicId: CLINICA,
        conversationId: CONVERSA,
        contactId: CONTATO,
        jobId: randomUUID(),
        agora: () => AGORA,
      }),
      catalogo: CATALOGO_DA_AG4,
      config: configDaAg4(),
      agoraMs: AGORA,
      fuso: FUSO,
      atendimento: { estado: armado(), dados: dadosVazios() },
      mensagens: {
        doPaciente: [{ mascarado: "Não", original: "Não" }],
        pendentes: [{ mascarado: "Não", original: "Não" }],
        antesDasPendentes: null,
      },
      agora: () => AGORA,
    });
    await semSim.preparar();
    expect(await semSim.executar("cancelar_consulta", {})).toMatchObject({
      tipo: "saida",
      resultado: "consulta_encerrada",
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
  });

  it("a trilha da consulta que nao foi lida diz \"a consulta do pedido\" (nunca \"a consulta de do pedido\")", async () => {
    const cenario = new CenarioDaAg4();
    conversaComOSim(cenario);
    // O pedido venceu e a consulta nao existe mais (nem foi lida).
    const t = turnoDoJob(cenario, {
      ...armado(),
      pedido_pendente_em: new Date(AGORA - 2 * 60 * 60_000).toISOString(),
    });
    await t.preparar();
    const r = await t.executar("cancelar_consulta", {});
    expect(r).toMatchObject({ tipo: "saida", resultado: "consulta_encerrada" });
    const passo = r.tipo === "saida" ? r.passo : "";
    expect(passo).toBe(
      "Não pediu para cancelar a consulta do pedido: a consulta não está mais marcada (já passou, foi atendida ou cancelada)",
    );
    expect(passo).not.toContain("de do pedido");
  });
});

describe("achado 8: a conferencia pela ordem real e pelas mesmas saidas que o banco conta", () => {
  it("o lembrete que saiu DEPOIS do \"Sim\" (e o historico poe antes dele) nao desfaz a pergunta: cancela", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    cenario.agora += 2 * 60_000;
    cenario.escreve("Sim");
    cenario.daClinica("Lembrete: sua consulta é na quinta, 22/10 às 14:00.");
    // O historico do WhatsApp poe as pendentes no FIM (lib/agente/
    // historico.ts): [..., T1, lembrete, Sim].
    const sim = cenario.mensagens.splice(-2, 1)[0]!;
    cenario.mensagens.push(sim);
    const r = await cenario.continua({
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    expect(c1.status).toBe("cancelado_paciente");
    expect(r.resposta).toBe(T2_DE_QUINTA);
  });

  it("a mensagem apagada da equipe entre a T1 e o \"Sim\" (o historico nao mostra, o banco conta): a pergunta volta, sem a RPC", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    cenario.soNoBanco("usuario", {
      apagada: true,
      texto: "Oi! Você confirma o retorno da sua mãe?",
    });
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
    expect(r.resposta).toBe(T1_DE_QUINTA);
    expect(cenario.estado.falhas_seguidas).toBe(1);
  });

  it("a T1 que nao foi entregue, a que saiu no mesmo instante de outra saida e a leitura que falha: nao conferem (a pergunta volta com uma falha, sem a RPC)", async () => {
    for (const caso of ["falhou", "empate", "leitura"] as const) {
      const cenario = new CenarioDaAg4();
      const { c1 } = consultasDoContato(cenario.banco);
      await pedirOCancelamento(cenario);
      const pergunta = cenario.banco
        .linhas("message")
        .filter((m) => m.author === "ia")
        .at(-1)!;
      if (caso === "falhou") {
        pergunta.delivery_status = "falhou";
      } else if (caso === "empate") {
        cenario.soNoBanco("sistema", {
          em: Date.parse(String(pergunta.created_at)),
        });
      } else {
        cenario.banco.comErro.add("message");
      }
      const r = await cenario.fala({
        texto: "Sim",
        roteiro: [ferramenta("cancelar_consulta", {})],
      });
      expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia"), caso).toEqual([]);
      expect(c1.status, caso).toBe("agendado");
      expect(r.resposta, caso).toBe(T1_DE_QUINTA);
      expect(cenario.estado.falhas_seguidas, caso).toBe(1);
      if (caso !== "empate") {
        expect(r.trilha.map((p) => p.texto).join("\n"), caso).toContain(
          "Não deu para conferir que a resposta da pessoa veio logo depois da pergunta do cancelamento",
        );
      }
    }
  });

  it("a leitura da porta (lerSaidaAntesDaRespostaDaIa): a ultima saida antes da ultima do paciente, com o corpo original; evento e nota nao contam; a apagada e a automatica contam", async () => {
    const cenario = new CenarioDaAg4({ nomeDoContato: "Domingo Alves" });
    const ids = {
      clinicId: CLINICA,
      conversationId: CONVERSA,
      contactId: CONTATO,
      jobId: JOB,
    };
    const ler = () => lerSaidaAntesDaRespostaDaIa(cenario.banco.cliente(), ids);
    // Sem mensagem do paciente: nada.
    expect(await ler()).toBeNull();
    const pergunta = "Confirma o cancelamento da sua consulta de domingo, 25/10 às 10:00?";
    cenario.soNoBanco("ia", { em: AGORA - 5_000, texto: pergunta });
    cenario.escreve("Sim", AGORA);
    // Depois da ultima do paciente nao conta; evento e nota nao contam.
    cenario.soNoBanco("sistema", { em: AGORA + 5_000 });
    cenario.banco.inserir(
      "message",
      {
        id: randomUUID(),
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        direction: "saida",
        author: "sistema",
        content_type: "evento",
        body: "A IA perguntou.",
        is_internal_note: false,
        created_at: new Date(AGORA - 2_000).toISOString(),
      },
      {
        id: randomUUID(),
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        direction: "saida",
        author: "usuario",
        content_type: "texto",
        body: "Nota interna.",
        is_internal_note: true,
        created_at: new Date(AGORA - 1_000).toISOString(),
      },
    );
    expect(await ler()).toEqual({
      autoria: "ia",
      texto: pergunta,
      falhou: false,
      empate: false,
      criadaEm: new Date(AGORA - 5_000).toISOString(),
      // Revisao da revisao final da AG4 (o toque atrasado): sem citacao.
      citaOutraMensagem: false,
    });
    // A apagada conta (o banco conta).
    cenario.soNoBanco("usuario", { em: AGORA - 3_000, apagada: true, texto: "Oi" });
    expect(await ler()).toMatchObject({ autoria: "usuario", texto: "Oi" });
    // Outra saida da IA no mesmo instante nao e empate; a do sistema e.
    cenario.soNoBanco("ia", { em: AGORA - 3_000, texto: "Oi de novo" });
    expect((await ler())?.empate).toBe(true);
    // A leitura que falha lanca (o turno nao confere).
    cenario.banco.comErro.add("message");
    await expect(ler()).rejects.toThrow();
  });
});

describe("achado 9: os testes que derrubam as mutacoes que sobreviveram", () => {
  it("a pergunta vencida no preparo NAO conta falha: duas seguidas nunca vao a equipe", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    for (let i = 0; i < 2; i += 1) {
      cenario.agora += 2 * 60 * 60_000;
      const r = await cenario.fala({
        texto: "Sim",
        roteiro: [ferramenta("cancelar_consulta", {})],
      });
      expect(r.tipo, String(i)).toBe("resposta");
      expect(r.resposta, String(i)).toBe(T1_DE_QUINTA);
      expect(r.trilha.map((p) => p.texto).join("\n"), String(i)).toContain(
        "A pergunta do cancelamento venceu (mais de 1 hora sem a resposta)",
      );
      expect(cenario.estado.falhas_seguidas, String(i)).toBe(0);
    }
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
  });

  it("a pergunta feita de novo aos 50 minutos vale pelo instante DELA (R8): o \"sim\" aos 75 minutos cancela", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    const doPedido = cenario.estado.pedido_pendente_em;
    cenario.agora += 48 * 60_000;
    const r = await cenario.fala({
      texto: "Sim, mas tem multa?",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(r.resposta).toBe(T1_DE_QUINTA);
    // O mesmo pedido, ainda valendo: o instante do pedido fica o de antes.
    expect(cenario.estado.pedido_pendente_em).toBe(doPedido);
    cenario.agora += 23 * 60_000;
    const r2 = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(r2.resposta).toBe(T2_DE_QUINTA);
    expect(c1.status).toBe("cancelado_paciente");
  });

  it("cancelar_consulta sem o preparo (a pergunta nao conferida): sem_pergunta_de_cancelamento, sem a RPC; com o preparo, cancela", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    const estado: EstadoDoAtendimento = {
      ...estadoVazio(),
      etapa: "cancelar",
      intencao: "cancelar",
      pedido_pendente: "cancelar",
      pedido_pendente_em: new Date(AGORA - 5 * 60_000).toISOString(),
      appointment_id: C1,
    };
    cenario.atendimento = { estado, dados: dadosVazios() };
    cenario.soNoBanco("ia", { em: AGORA - 4 * 60_000, texto: T1_DE_QUINTA });
    cenario.lidasPorJob.set(JOB, [cenario.escreve("Sim", AGORA - 60_000)]);
    const turno = () =>
      criarAgendaDoTurno({
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
          doPaciente: [{ mascarado: "Sim", original: "Sim" }],
          pendentes: [{ mascarado: "Sim", original: "Sim" }],
          antesDasPendentes: { autoria: "ia", texto: T1_DE_QUINTA },
        },
        agora: () => AGORA,
      });
    const semPreparo = turno();
    expect(await semPreparo.executar("cancelar_consulta", {})).toMatchObject({
      tipo: "saida",
      resultado: "sem_pergunta_de_cancelamento",
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
    const comPreparo = turno();
    await comPreparo.preparar();
    expect(await comPreparo.executar("cancelar_consulta", {})).toMatchObject({
      tipo: "frase",
      resultado: "cancelada",
    });
    expect(c1.status).toBe("cancelado_paciente");
  });

  it("o agendar da remarcacao sem o preparo (a T3 nao conferida): sem_confirmacao_do_paciente, sem a RPC", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    const t = criarAgendaDoTurno({
      porta: portaDaAgendaDoWhatsapp(cenario.banco.cliente(), {
        clinicId: CLINICA,
        conversationId: CONVERSA,
        contactId: CONTATO,
        jobId: JOB,
        agora: () => cenario.agora,
      }),
      catalogo: CATALOGO_DA_AG4,
      config: configDaAg4(),
      agoraMs: cenario.agora,
      fuso: FUSO,
      atendimento: cenario.atendimento,
      mensagens: {
        doPaciente: [{ mascarado: "Confirmo", original: "Confirmo" }],
        pendentes: [{ mascarado: "Confirmo", original: "Confirmo" }],
        antesDasPendentes: { autoria: "ia", texto: T3_SEGUNDA },
      },
      agora: () => cenario.agora,
    });
    expect(await t.executar("agendar", {})).toMatchObject({
      tipo: "saida",
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
  });
});

describe("a ancora forte na marcacao da AG3 (R9): \"pergunte de novo o Confirma\"", () => {
  it("um lembrete entre o \"Confirma ...?\" e o \"sim\": nada marcado, uma falha; o modelo pergunta de novo e o \"sim\" seguinte marca", async () => {
    const cenario = marcacaoJaPerguntada();
    cenario.daClinica("Lembrete: responda SIM para confirmar a sua presença.");
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {}), final(CONFIRMA_DA_AG3)],
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(cenario.banco.linhas("appointment")).toEqual([]);
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(r.resposta).toBe(CONFIRMA_DA_AG3);
    expect(cenario.estado).toMatchObject({
      etapa: "aguardando_confirmacao",
      falhas_seguidas: 1,
    });
    await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {}), final("Pronto! Ficou pendente da aprovação da equipe.")],
    });
    expect(cenario.banco.linhas("appointment")).toHaveLength(1);
    expect(cenario.estado.falhas_seguidas).toBe(0);
  });
});
