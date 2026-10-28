import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  lerSaidaAntesDaRespostaDaIa,
  respostaCitaOutraMensagem,
} from "@/lib/agente/agenda";
import {
  dadosVazios,
  estadoVazio,
  type EstadoDoAtendimento,
} from "@/lib/agente/atendimento";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";

import {
  C1,
  CenarioDaAg4,
  configDaAg4,
  consultasDoContato,
  ferramenta,
  final,
  saidas,
} from "./ag4-conversa";
import {
  AGORA,
  CLINICA,
  CONTATO,
  CONVERSA,
  iso,
  PROF,
  VINC,
} from "./agenda-fixtures";
import { UNID } from "./cadastro-fixtures";

// Revisao da revisao final da AG4 (27/10/2026), o toque atrasado: o
// interceptador ignora o toque num botao de mensagem antiga quando a IA
// falou depois dele (lib/domain/resposta-paciente.ts, clinica_falou_depois),
// e o texto do botao ("Cancelar", "Confirmar") chegava ao job da IA como se
// respondesse a pergunta logo antes: o "Cancelar" do lembrete da consulta X
// cancelava a consulta Y da T1, e o "Confirmar" de uma mensagem antiga
// marcava a consulta do "Confirma ...?" da AG3. Agora a resposta que cita
// (ou toca o botao de) OUTRA mensagem nao e o "sim": e a resposta fora da
// pergunta (a pergunta volta, conta falha). O banco ainda nao confere a
// citacao (limite conhecido, para a proxima migration): por isso o motor
// recusa ANTES da RPC. Nenhum teste fala com a OpenAI nem com o banco.

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
/** O lembrete da regua sobre a OUTRA consulta (C2), com os botoes. */
const LEMBRETE_DA_C2 =
  "Olá! Lembrete da sua consulta de terça, 27/10 às 09:00. Toque em Confirmar, Remarcar ou Cancelar.";
const PASSO =
  "a resposta da pessoa citou outra mensagem (um botão tocado ou a resposta a uma mensagem antiga), e não a pergunta de confirmação";

const LISTAR = () => ferramenta("consultar_minhas_consultas", {});
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
  // Nenhum texto do paciente nem da conversa em log.
  expect(escrito.join("")).not.toMatch(/Cancelar|Confirmar|Lembrete|Confirmo/);
});

/** O pedido de cancelar a consulta de quinta (C1): a pergunta T1. */
async function pedirOCancelamentoDaC1(cenario: CenarioDaAg4) {
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
      ferramenta("buscar_horario_para_remarcar", {
        consulta: "c1",
        a_partir_de: "2026-10-26",
        periodo: "manha",
        hora: null,
        unidade: null,
      }),
      final(
        "Tenho segunda, 26/10 às 08:00 e terça, 27/10 às 08:00. Qual fica melhor?",
      ),
    ],
  });
  const r = await cenario.fala({
    texto: "Segunda às 8",
    roteiro: [ferramenta("reservar_horario", { horario: "h1" })],
  });
  expect(r.resposta).toBe(T3_SEGUNDA);
}

/**
 * A marcacao da AG3 ja perguntada (a reserva viva de quarta, 21/10 as
 * 14:00, e o "Confirma ...?" da IA depois dela), com uma mensagem ANTIGA da
 * clinica antes da pergunta (a que a pessoa toca depois). Devolve o id da
 * antiga e o da pergunta.
 */
function marcacaoJaPerguntada(): {
  cenario: CenarioDaAg4;
  antiga: string;
  pergunta: string;
} {
  const cenario = new CenarioDaAg4({
    config: configDaAg4({ dadosExigidos: SEM_DADOS }),
    opcoes: { exigidos: SEM_DADOS },
  });
  const antiga = cenario.daClinica(
    "Olá! Sua avaliação foi registrada. Toque em Confirmar para receber novidades.",
  );
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
  const pergunta = cenario.daClinica(CONFIRMA_DA_AG3, "ia");
  return { cenario, antiga, pergunta };
}

describe("a citacao da resposta (respostaCitaOutraMensagem, pura)", () => {
  const pergunta = { id: "p1", waMessageId: "wa-p1" };

  it("sem citacao, ou citando a propria pergunta (pelo id ou pelo id do WhatsApp): responde a pergunta", () => {
    expect(respostaCitaOutraMensagem(pergunta, [])).toBe(false);
    expect(
      respostaCitaOutraMensagem(pergunta, [
        { reply_to_message_id: null, reply_to_wa_message_id: null },
        { reply_to_message_id: "", reply_to_wa_message_id: "  " },
      ]),
    ).toBe(false);
    expect(
      respostaCitaOutraMensagem(pergunta, [
        { reply_to_message_id: "p1", reply_to_wa_message_id: "wa-p1" },
      ]),
    ).toBe(false);
    // A citada que o banco nao vinculou, com o id do WhatsApp da pergunta.
    expect(
      respostaCitaOutraMensagem(pergunta, [
        { reply_to_message_id: null, reply_to_wa_message_id: "wa-p1" },
      ]),
    ).toBe(false);
  });

  it("citando outra mensagem (achada ou nao no banco), em qualquer das respostas: outra", () => {
    expect(
      respostaCitaOutraMensagem(pergunta, [{ reply_to_message_id: "x9" }]),
    ).toBe(true);
    expect(
      respostaCitaOutraMensagem(pergunta, [
        { reply_to_message_id: null, reply_to_wa_message_id: "wa-velha" },
      ]),
    ).toBe(true);
    expect(
      respostaCitaOutraMensagem(pergunta, [
        { reply_to_message_id: "p1" },
        { reply_to_message_id: "x9" },
      ]),
    ).toBe(true);
  });

  it("falha fechada: a pergunta sem id (ou sem o id do WhatsApp) nao confere citacao nenhuma", () => {
    expect(
      respostaCitaOutraMensagem({ id: null, waMessageId: "wa-p1" }, [
        { reply_to_message_id: "p1" },
      ]),
    ).toBe(true);
    expect(
      respostaCitaOutraMensagem({ id: "p1", waMessageId: null }, [
        { reply_to_wa_message_id: "wa-p1" },
      ]),
    ).toBe(true);
    // Sem citacao, a pergunta sem id nao muda nada.
    expect(
      respostaCitaOutraMensagem({ id: null, waMessageId: null }, [{}]),
    ).toBe(false);
  });
});

describe("a leitura da porta (lerSaidaAntesDaRespostaDaIa) com a citacao", () => {
  const ids = {
    clinicId: CLINICA,
    conversationId: CONVERSA,
    contactId: CONTATO,
    jobId: randomUUID(),
  };

  it("as respostas depois da pergunta: a que cita outra conta; a de antes da pergunta, a apagada e a que o job nao leu, nao", async () => {
    const cenario = new CenarioDaAg4();
    const lembrete = cenario.daClinica(LEMBRETE_DA_C2);
    // Antes da pergunta: a pessoa citou o lembrete (ja respondida).
    cenario.escreve("Essa aqui", undefined, { mensagem: lembrete });
    const pergunta = cenario.daClinica(T1_DE_QUINTA, "ia");
    const sim = cenario.escreve("Sim");
    const ler = (lidas?: readonly string[]) =>
      lerSaidaAntesDaRespostaDaIa(cenario.banco.cliente(), ids, lidas);
    expect(await ler()).toMatchObject({
      texto: T1_DE_QUINTA,
      citaOutraMensagem: false,
    });
    expect(await ler([sim])).toMatchObject({ citaOutraMensagem: false });

    // O toque no botao do lembrete DEPOIS da pergunta: cita outra.
    const toque = cenario.escreve("Cancelar", undefined, {
      mensagem: lembrete,
    });
    expect(await ler()).toMatchObject({ citaOutraMensagem: true });
    expect(await ler([sim, toque])).toMatchObject({ citaOutraMensagem: true });
    // O job que nao leu o toque (mensagem nova: o banco recusa) nao o conta.
    expect(await ler([sim])).toMatchObject({ citaOutraMensagem: false });
    // Sem lidas, nada a conferir.
    expect(await ler([])).toMatchObject({ citaOutraMensagem: false });
    // A apagada nao conta (o job nao le a apagada).
    cenario.apaga(toque);
    expect(await ler()).toMatchObject({ citaOutraMensagem: false });

    // Citando a propria pergunta: responde a ela.
    cenario.escreve("Sim, pode", undefined, { mensagem: pergunta });
    expect(await ler()).toMatchObject({ citaOutraMensagem: false });
  });

  it("a citacao que o banco nao vinculou vale so com o id do WhatsApp da pergunta", async () => {
    const cenario = new CenarioDaAg4();
    cenario.daClinica(T1_DE_QUINTA, "ia");
    const waDaPergunta = String(
      cenario.banco.linhas("message").at(-1)?.wa_message_id,
    );
    cenario.escreve("Sim", undefined, { doWhatsapp: waDaPergunta });
    const ler = () => lerSaidaAntesDaRespostaDaIa(cenario.banco.cliente(), ids);
    expect(await ler()).toMatchObject({ citaOutraMensagem: false });
    cenario.escreve("Cancelar", undefined, {
      doWhatsapp: "wa-de-uma-mensagem-antiga",
    });
    expect(await ler()).toMatchObject({ citaOutraMensagem: true });
  });

  it("LGPD: a leitura das respostas so pede as colunas da citacao (nenhum texto), pela clinica e pela conversa", async () => {
    const cenario = new CenarioDaAg4();
    cenario.daClinica(T1_DE_QUINTA, "ia");
    const sim = cenario.escreve("Sim");
    await lerSaidaAntesDaRespostaDaIa(cenario.banco.cliente(), ids, [sim]);
    const daCitacao = cenario.banco.leituras.filter(
      (l) => l.tabela === "message" && l.colunas.includes("reply_to"),
    );
    expect(daCitacao).toHaveLength(1);
    expect(daCitacao[0]?.colunas).toBe(
      "reply_to_message_id, reply_to_wa_message_id",
    );
    expect(daCitacao[0]?.filtros).toEqual(
      expect.arrayContaining([
        `eq:clinic_id=${CLINICA}`,
        `eq:conversation_id=${CONVERSA}`,
        "eq:direction=entrada",
        "eq:author=paciente",
        "is:deleted_at",
        "in:id",
      ]),
    );
  });

  it("a leitura das respostas que falha lanca (o turno nao confere)", async () => {
    const cenario = new CenarioDaAg4();
    cenario.daClinica(T1_DE_QUINTA, "ia");
    cenario.escreve("Sim");
    cenario.banco.comErro.add("message");
    await expect(
      lerSaidaAntesDaRespostaDaIa(cenario.banco.cliente(), ids),
    ).rejects.toThrow();
  });
});

describe('cancelar (T1): o botao de outra mensagem nao e o "sim"', () => {
  it('o "Cancelar" do lembrete da consulta de terca (C2) com a T1 da consulta de quinta (C1) pendente: nada cancelado, a T1 volta e conta falha; o segundo toque vai a equipe', async () => {
    const cenario = new CenarioDaAg4();
    const { c1, c2 } = consultasDoContato(cenario.banco);
    const lembrete = cenario.daClinica(LEMBRETE_DA_C2);
    await pedirOCancelamentoDaC1(cenario);
    const r = await cenario.fala({
      texto: "Cancelar",
      citacao: { mensagem: lembrete },
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    // O motor recusa antes da RPC (o banco ainda nao confere a citacao).
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
    expect(c2.status).toBe("agendado");
    expect(r.tipo).toBe("resposta");
    expect(r.resposta).toBe(T1_DE_QUINTA);
    expect(r.trilha.map((p) => p.texto).join("\n")).toContain(
      `Não cancelou: ${PASSO}; perguntou de novo se a pessoa confirma o cancelamento da consulta de quinta, 22/10 às 14:00 (Consulta, Dra. Ana Lima)`,
    );
    expect(cenario.estado).toMatchObject({
      etapa: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: C1,
      falhas_seguidas: 1,
    });

    // O segundo toque seguido no lembrete: a equipe, nada cancelado.
    const r2 = await cenario.fala({
      texto: "Cancelar",
      citacao: { mensagem: lembrete },
      roteiro: [LISTAR(), ferramenta("cancelar_consulta", {})],
    });
    expect(r2.tipo).toBe("frase_fixa");
    expect(r2.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r2.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "falhas_seguidas",
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
    expect(c2.status).toBe("agendado");
  });

  it('a citacao de uma mensagem que o banco nao achou (outro id do WhatsApp) tambem nao e o "sim"', async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamentoDaC1(cenario);
    const r = await cenario.fala({
      texto: "Sim",
      citacao: { doWhatsapp: "wa-de-uma-mensagem-de-antes-da-integracao" },
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
    expect(r.resposta).toBe(T1_DE_QUINTA);
    expect(cenario.estado.falhas_seguidas).toBe(1);
  });

  it('positivo: o "Sim" que cita a PROPRIA T1 (pelo id, ou so pelo id do WhatsApp dela) continua valendo: cancela', async () => {
    for (const comoCita of ["mensagem", "doWhatsapp"] as const) {
      const cenario = new CenarioDaAg4();
      const { c1 } = consultasDoContato(cenario.banco);
      cenario.daClinica(LEMBRETE_DA_C2);
      await pedirOCancelamentoDaC1(cenario);
      const t1 = cenario.ultimaResposta;
      expect(t1, comoCita).not.toBeNull();
      const r = await cenario.fala({
        texto: "Sim",
        citacao:
          comoCita === "mensagem"
            ? { mensagem: t1!.id }
            : { doWhatsapp: t1!.waMessageId },
        roteiro: [ferramenta("cancelar_consulta", {})],
      });
      expect(
        cenario.banco.chamadasDe("cancelar_consulta_pela_ia"),
        comoCita,
      ).toHaveLength(1);
      expect(c1.status, comoCita).toBe("cancelado_paciente");
      expect(r.resposta, comoCita).toBe(T2_DE_QUINTA);
    }
  });

  it('positivo: o "Sim" sem citacao continua valendo (a pergunta logo antes)', async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    cenario.daClinica(LEMBRETE_DA_C2);
    await pedirOCancelamentoDaC1(cenario);
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(c1.status).toBe("cancelado_paciente");
    expect(r.resposta).toBe(T2_DE_QUINTA);
  });
});

describe('marcar (o "Confirma ...?" da AG3): o botao de uma mensagem antiga nao e o "sim"', () => {
  it('o "Confirmar" de uma mensagem antiga com o "Confirma ...?" pendente: nada marcado, sem a RPC, uma falha; o modelo pergunta de novo e o "Confirmo" seguinte marca', async () => {
    const { cenario, antiga } = marcacaoJaPerguntada();
    const r = await cenario.fala({
      texto: "Confirmar",
      citacao: { mensagem: antiga },
      roteiro: [ferramenta("agendar", {}), final(CONFIRMA_DA_AG3)],
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(cenario.banco.linhas("appointment")).toEqual([]);
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(r.trilha.map((p) => p.texto).join("\n")).toContain(
      `Tentou marcar a consulta: ${PASSO}`,
    );
    expect(r.resposta).toBe(CONFIRMA_DA_AG3);
    expect(cenario.estado).toMatchObject({
      etapa: "aguardando_confirmacao",
      falhas_seguidas: 1,
    });

    const r2 = await cenario.fala({
      texto: "Confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        final("Pronto! Ficou pendente da aprovação da equipe."),
      ],
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(cenario.banco.linhas("appointment")).toHaveLength(1);
    expect(r2.tipo).toBe("resposta");
    expect(cenario.estado.falhas_seguidas).toBe(0);
  });

  it('positivo: o "Confirmo" que cita o proprio "Confirma ...?" marca', async () => {
    const { cenario, pergunta } = marcacaoJaPerguntada();
    await cenario.fala({
      texto: "Confirmo",
      citacao: { mensagem: pergunta },
      roteiro: [
        ferramenta("agendar", {}),
        final("Pronto! Ficou pendente da aprovação da equipe."),
      ],
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(cenario.banco.linhas("appointment")).toHaveLength(1);
  });

  it("falha fechada: sem conseguir ler a que mensagem a pessoa respondeu, nada marcado (sem a RPC), uma falha, e o modelo pergunta de novo", async () => {
    const { cenario } = marcacaoJaPerguntada();
    // A leitura da porta no preparo falha (so ela le a tabela message pelo
    // cliente; as RPCs em memoria leem a conversa direto).
    cenario.banco.comErro.add("message");
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {}), final(CONFIRMA_DA_AG3)],
    });
    cenario.banco.comErro.delete("message");
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(cenario.banco.linhas("appointment")).toEqual([]);
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(r.trilha.map((p) => p.texto).join("\n")).toContain(
      "Tentou marcar a consulta: não deu para conferir a que mensagem a pessoa respondeu (a conversa não foi lida)",
    );
    expect(r.resposta).toBe(CONFIRMA_DA_AG3);
    expect(cenario.estado.falhas_seguidas).toBe(1);
  });
});

describe('remarcar (T3): o botao de uma mensagem antiga nao e o "sim"', () => {
  it('o "Confirmar" de uma mensagem antiga com a T3 pendente: nada pedido, sem a RPC, uma falha; citando a propria T3, remarca', async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const antiga = cenario.daClinica(
      "Olá! Sua avaliação foi registrada. Toque em Confirmar para receber novidades.",
    );
    await ateAPerguntaDaRemarcacao(cenario);
    const r = await cenario.fala({
      texto: "Confirmar",
      citacao: { mensagem: antiga },
      roteiro: [
        ferramenta("agendar", {}),
        ferramenta("reservar_horario", { horario: "h1" }),
      ],
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(r.trilha.map((p) => p.texto).join("\n")).toContain(
      `Tentou marcar a consulta: ${PASSO}`,
    );
    // O modelo reservou de novo: a T3 volta.
    expect(r.resposta).toBe(T3_SEGUNDA);
    expect(cenario.estado.falhas_seguidas).toBe(1);

    const t3 = cenario.ultimaResposta;
    const r2 = await cenario.fala({
      texto: "Confirmo",
      citacao: { mensagem: t3!.id },
      roteiro: [ferramenta("agendar", {})],
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(r2.resposta).toBe(T4_SEGUNDA);
    expect(cenario.estado.desfecho).toBe("remarcou");
  });
});
