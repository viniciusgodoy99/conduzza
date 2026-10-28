import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  instanteExatoDoBanco,
  lerSaidaAntesDaRespostaDaIa,
} from "@/lib/agente/agenda";
import { estadoVazio, type EstadoDoAtendimento } from "@/lib/agente/atendimento";
import { idsRespondidos, montarHistorico } from "@/lib/agente/historico";

import { bancoDaAg3, type TurnoNoBanco } from "./ag3-contrato";
import {
  C1,
  CATALOGO_DA_AG4,
  CenarioDaAg4,
  consultasDoContato,
  ferramenta,
  NOME_DO_CONTATO,
} from "./ag4-conversa";
import {
  comOCarimboDoBanco,
  consultaDoContato,
  FOLGA_DA_MUDANCA_MS,
  mensagemNovaDoPaciente,
  perguntaRespondida,
  respondidasPelosTurnos,
  rpcsDaAg4,
  type MensagemNoBanco,
  type OpcoesDaAg4,
} from "./ag4-contrato";
import type { AgendaEmMemoria } from "./agenda-em-memoria";
import {
  AGORA,
  CLINICA,
  codigoDoProcedimento,
  CONTATO,
  CONVERSA,
  iso,
  JOB,
  PROC,
  PROF,
  VINC,
} from "./agenda-fixtures";
import { UNID } from "./cadastro-fixtures";

// Revisao final da AG4 (27/10/2026), o lado do motor e dos espelhos:
//  - M1 (o espelho, contrato-mudancas R12): a mensagem do paciente que um
//    turno 'enviado' ja leu nao e "nova" para o job seguinte, mesmo com a
//    resposta daquele turno gravada DEPOIS da mensagem seguinte. O cenario
//    da revisao com o montarHistorico e o idsRespondidos REAIS (o que o
//    executor carrega e grava em ai_turno.mensagens_lidas) e o espelho do
//    banco;
//  - R13/R15: a mensagem nova vem antes de faltam_dados, consulta_mudou e
//    pedido_vencido; R14: a folga de 5 segundos do consulta_mudou;
//  - B1: o turno parado pela mensagem nova nao grava o estado (o gravar
//    recarimbava o pedido vencido depois da pergunta);
//  - B4: o empate da saida antes da resposta pelo instante EXATO.
// Nenhum teste fala com a OpenAI nem com o banco.

const T1_DE_QUINTA =
  "Confirma o cancelamento da sua consulta de quinta, 22/10 às 14:00?";
const T2_DE_QUINTA =
  "Tudo bem, sua consulta de 22/10 às 14:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.";
const CONFIRMA_DA_AG3 =
  "Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?";
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
  // Nenhum texto do paciente em log.
  expect(escrito.join("")).not.toMatch(/presencial|Confirmo|CPF|529/);
});

// ---------------------------------------------------------------------------
// A conversa como o banco guarda, para o historico do motor e o espelho
// ---------------------------------------------------------------------------

type Fala = {
  id: string;
  autor: "paciente" | "ia";
  texto: string;
  /** created_at (ms). */
  em: number;
  /** message.job_id (a resposta da IA sai com o job do turno). */
  job?: string;
};

/** As linhas de message como o carregador do historico le. */
function linhasDoHistorico(falas: readonly Fala[]) {
  return falas.map((f) => ({
    id: f.id,
    author: f.autor,
    content_type: "texto",
    body: f.texto,
    media_url: null,
    created_at: new Date(f.em).toISOString(),
  }));
}

/** A mesma conversa como o espelho do banco confere. */
function noBanco(falas: readonly Fala[]): MensagemNoBanco[] {
  return falas.map((f) => ({
    id: f.id,
    direcao: f.autor === "paciente" ? "entrada" : "saida",
    autor: f.autor,
    em: f.em,
    ...(f.job === undefined ? {} : { job: f.job }),
  }));
}

/**
 * O banco do espelho com a reserva viva de quarta, 21/10 as 14:00 (Dra.
 * Ana, Centro, particular), criada em `reservaEm`, e as RPCs da AG4 sobre a
 * conversa, as lidas e os turnos dados.
 */
function bancoDaMarcacao(e: {
  falas: () => readonly Fala[];
  lidas: Map<string, string[]>;
  turnos: () => readonly TurnoNoBanco[];
  reservaEm: number;
  exigidos?: OpcoesDaAg4["exigidos"];
}): { banco: AgendaEmMemoria; holdId: string } {
  const banco = bancoDaAg3();
  const holdId = randomUUID();
  banco.inserir("slot_hold", {
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
    created_at: new Date(e.reservaEm).toISOString(),
    consumido_em: null,
  });
  rpcsDaAg4(banco, {
    catalogo: CATALOGO_DA_AG4,
    exigidos: e.exigidos ?? SEM_DADOS,
    agora: () => AGORA,
    estado: () => null,
    conversa: () => noBanco(e.falas()),
    lidas: (job) => e.lidas.get(job),
    turnos: e.turnos,
    cancelar: { ligada: true, prazoHoras: 24 },
    remarcar: { ligada: true, prazoHoras: 24 },
  });
  return { banco, holdId };
}

describe("M1 (o espelho, R12): a mensagem que um turno 'enviado' leu nao e nova", () => {
  const J0 = "a0000000-0000-4000-8000-000000000000";
  const J1 = "a0000000-0000-4000-8000-000000000001";
  const J2 = "a0000000-0000-4000-8000-000000000002";

  /**
   * O cenario da revisao: Q (o "Confirma ...?" da IA, depois da reserva);
   * A lida por J1, que respondeu R1; B lida por J2; R1 gravada DEPOIS de B
   * (a resposta de J1 saiu depois que a pessoa ja tinha mandado B).
   */
  function cenarioDaRevisao(textos: {
    q: string;
    a: string;
    b: string;
    r1: string;
  }) {
    const t0 = AGORA - 5 * 60_000;
    const falas: Fala[] = [
      { id: randomUUID(), autor: "paciente", texto: "Quero marcar com a Dra. Ana", em: t0 - 60_000 },
      { id: randomUUID(), autor: "ia", texto: textos.q, em: t0 + 1_000, job: J0 },
      { id: randomUUID(), autor: "paciente", texto: textos.a, em: t0 + 30_000 },
      { id: randomUUID(), autor: "paciente", texto: textos.b, em: t0 + 50_000 },
      { id: randomUUID(), autor: "ia", texto: textos.r1, em: t0 + 55_000, job: J1 },
    ];
    const [m0, , a, b] = falas;
    const lidas = new Map<string, string[]>([
      [J0, [m0!.id]],
      [J1, [a!.id]],
    ]);
    const turnos: TurnoNoBanco[] = [
      { job_id: J0, estado: "enviado", mensagens_lidas: [m0!.id] },
      { job_id: J1, estado: "enviado", mensagens_lidas: [a!.id] },
    ];
    return { t0, falas, lidas, turnos, a: a!, b: b! };
  }

  /**
   * O que o executor faz no comeco de J2: o historico (montarHistorico com
   * idsRespondidos dos turnos da conversa) e as pendentes, que viram as
   * lidas de J2 (ai_turno.mensagens_lidas, gravadas antes do modelo).
   */
  function leituraDoJ2(c: ReturnType<typeof cenarioDaRevisao>) {
    const historico = montarHistorico(
      linhasDoHistorico(c.falas),
      idsRespondidos(c.turnos, J2),
      NOME_DO_CONTATO,
    );
    c.lidas.set(J2, [...historico.pendentes]);
    c.turnos.push({
      job_id: J2,
      estado: "reservado",
      mensagens_lidas: [...historico.pendentes],
    });
    return historico;
  }

  it("Q; \"é presencial?\" (A) lida por J1 enviado; \"confirmo\" (B) lida por J2; R1 gravada depois de B: o agendar de J2 marca (nunca mensagem_nova_do_paciente)", async () => {
    const c = cenarioDaRevisao({
      q: CONFIRMA_DA_AG3,
      a: "É presencial?",
      b: "Confirmo",
      r1: `É presencial, sim. ${CONFIRMA_DA_AG3}`,
    });
    const historico = leituraDoJ2(c);
    // J2 le so B (A foi respondida por J1); B vai para o fim do historico,
    // depois de R1 (as pendentes por ultimo).
    expect(historico.pendentes).toEqual([c.b.id]);
    expect(historico.mensagens.at(-1)).toMatchObject({
      autor: "paciente",
      texto: "Confirmo",
    });
    expect(historico.mensagens.at(-2)).toMatchObject({ autoria: "ia" });

    const { banco, holdId } = bancoDaMarcacao({
      falas: () => c.falas,
      lidas: c.lidas,
      turnos: () => c.turnos,
      reservaEm: c.t0,
    });
    const r = await banco.cliente().rpc("agendar_pela_ia", {
      p_clinic_id: CLINICA,
      p_conversation_id: CONVERSA,
      p_job_id: J2,
      p_slot_hold_id: holdId,
    });
    expect(r.data).toMatchObject({ ok: true, reutilizado: false });
    expect(banco.linhas("appointment")).toHaveLength(1);

    // A regra de antes (so as lidas do job) recusava: A ficava "nova" para
    // J2 e o turno seguinte lia de novo so B, num laco.
    const conversa = noBanco(c.falas);
    const pergunta = perguntaRespondida(conversa, c.t0);
    expect(pergunta?.job).toBe(J0);
    expect(mensagemNovaDoPaciente(conversa, [c.b.id], pergunta)).toBe(true);
    expect(
      mensagemNovaDoPaciente(
        conversa,
        [c.b.id],
        pergunta,
        respondidasPelosTurnos({ turnos: () => c.turnos }, J2),
      ),
    ).toBe(false);
  });

  it.each([
    {
      caso: "o CPF na primeira (lida e registrada por J1), o \"pode marcar\" na segunda",
      a: "Meu CPF é 529.982.247-25",
      b: "Pode marcar",
      registraNo: "J1" as const,
    },
    {
      caso: "o \"confirmo\" na primeira, o CPF na segunda (registrado por J2)",
      a: "Confirmo",
      b: "529.982.247-25",
      registraNo: "J2" as const,
    },
  ])(
    "a variante do CPF em duas mensagens ($caso): o agendar de J2 marca",
    async ({ a, b, registraNo }) => {
      const c = cenarioDaRevisao({
        q: `${CONFIRMA_DA_AG3} Me envie também o seu CPF.`,
        a,
        b,
        r1: `Obrigada! ${CONFIRMA_DA_AG3}`,
      });
      const historico = leituraDoJ2(c);
      expect(historico.pendentes).toEqual([c.b.id]);
      const { banco, holdId } = bancoDaMarcacao({
        falas: () => c.falas,
        lidas: c.lidas,
        turnos: () => c.turnos,
        reservaEm: c.t0,
        exigidos: { nomeCompleto: false, nascimento: false, cpf: true },
      });
      const cliente = banco.cliente();
      const registrar = await cliente.rpc("registrar_dados_da_marcacao", {
        p_clinic_id: CLINICA,
        p_conversation_id: CONVERSA,
        p_job_id: registraNo === "J1" ? J1 : J2,
        p_cpf: "529.982.247-25",
      });
      expect(registrar.data).toMatchObject({ ok: true, faltam: [] });
      const r = await cliente.rpc("agendar_pela_ia", {
        p_clinic_id: CLINICA,
        p_conversation_id: CONVERSA,
        p_job_id: J2,
        p_slot_hold_id: holdId,
      });
      expect(r.data).toMatchObject({ ok: true });
    },
  );

  it("a mensagem que NENHUM turno leu continua nova; a de um turno sem_envio tambem (o job seguinte a rele)", async () => {
    const c = cenarioDaRevisao({
      q: CONFIRMA_DA_AG3,
      a: "É presencial?",
      b: "Confirmo",
      r1: `É presencial, sim. ${CONFIRMA_DA_AG3}`,
    });
    leituraDoJ2(c);
    // Uma terceira mensagem chega depois da leitura de J2.
    c.falas.push({
      id: randomUUID(),
      autor: "paciente",
      texto: "Obrigada!",
      em: c.t0 + 70_000,
    });
    const { banco, holdId } = bancoDaMarcacao({
      falas: () => c.falas,
      lidas: c.lidas,
      turnos: () => c.turnos,
      reservaEm: c.t0,
    });
    const r = await banco.cliente().rpc("agendar_pela_ia", {
      p_clinic_id: CLINICA,
      p_conversation_id: CONVERSA,
      p_job_id: J2,
      p_slot_hold_id: holdId,
    });
    expect(r.data).toEqual({ ok: false, motivo: "mensagem_nova_do_paciente" });

    // J1 parado sem envio: as lidas dele nao contam para o banco (nem para o
    // historico): J2 le A e B, e o agendar passa com as lidas do proprio job.
    const semEnvio = cenarioDaRevisao({
      q: CONFIRMA_DA_AG3,
      a: "É presencial?",
      b: "Confirmo",
      r1: CONFIRMA_DA_AG3,
    });
    semEnvio.turnos[1] = { ...semEnvio.turnos[1]!, estado: "sem_envio" };
    semEnvio.falas.pop();
    const historico = leituraDoJ2(semEnvio);
    expect(historico.pendentes).toEqual([semEnvio.a.id, semEnvio.b.id]);
    expect(
      mensagemNovaDoPaciente(
        noBanco(semEnvio.falas),
        [semEnvio.b.id],
        perguntaRespondida(noBanco(semEnvio.falas), semEnvio.t0),
        respondidasPelosTurnos({ turnos: () => semEnvio.turnos }, J2),
      ),
    ).toBe(true);
  });

  it("a apagada so conta com as lidas do PROPRIO job: a que um turno enviado leu e foi apagada nao e nova", () => {
    const pergunta: MensagemNoBanco = { id: "q", direcao: "saida", autor: "ia", em: 1_000 };
    const a: MensagemNoBanco = { id: "a", direcao: "entrada", autor: "paciente", em: 2_000 };
    const b: MensagemNoBanco = { ...a, id: "b", em: 3_000 };
    const respondidas = idsRespondidos(
      [{ job_id: J1, estado: "enviado", mensagens_lidas: ["a"] }],
      J2,
    );
    expect(
      mensagemNovaDoPaciente([pergunta, { ...a, apagada: true }, b], ["b"], pergunta, respondidas),
    ).toBe(false);
    // Lida pelo proprio job e apagada: nova (o modelo decidiu com ela).
    expect(
      mensagemNovaDoPaciente([pergunta, a, { ...b, apagada: true }], ["b"], pergunta, respondidas),
    ).toBe(true);
    // Lida so por um turno reservado de OUTRO job: nao conta.
    expect(
      mensagemNovaDoPaciente(
        [pergunta, a, b],
        ["b"],
        pergunta,
        idsRespondidos([{ job_id: J1, estado: "reservado", mensagens_lidas: ["a"] }], J2),
      ),
    ).toBe(true);
  });
});

describe("R13/R15 e R14: a ordem das recusas e a folga de 5 segundos (o espelho)", () => {
  const J = "b0000000-0000-4000-8000-000000000001";
  const DO_PEDIDO = "b0000000-0000-4000-8000-000000000002";

  function cancelamento(e: { perguntaHaMin: number; novaNaoLida: boolean }) {
    const banco = bancoDaAg3();
    const c1 = consultaDoContato({
      id: C1,
      inicio: iso("2026-10-22", "14:00"),
      fim: iso("2026-10-22", "14:30"),
      vinculo: VINC.consultaAna,
      profissional: PROF.ana,
      unidade: UNID.centro,
    });
    banco.inserir("appointment", c1);
    const pedidoEm = AGORA - (e.perguntaHaMin + 1) * 60_000;
    const estado: EstadoDoAtendimento = {
      ...estadoVazio(),
      etapa: "cancelar",
      intencao: "cancelar",
      pedido_pendente: "cancelar",
      pedido_pendente_em: new Date(pedidoEm).toISOString(),
      appointment_id: C1,
    };
    const conversa: MensagemNoBanco[] = [
      { id: "q", direcao: "saida", autor: "ia", em: AGORA - e.perguntaHaMin * 60_000, job: DO_PEDIDO },
      { id: "s", direcao: "entrada", autor: "paciente", em: AGORA - 30_000 },
      ...(e.novaNaoLida
        ? [{ id: "n", direcao: "entrada" as const, autor: "paciente" as const, em: AGORA - 5_000 }]
        : []),
    ];
    rpcsDaAg4(banco, {
      catalogo: CATALOGO_DA_AG4,
      exigidos: SEM_DADOS,
      agora: () => AGORA,
      estado: () => estado,
      conversa: () => conversa,
      lidas: () => ["s"],
      jobCriadoEm: (job) =>
        job === DO_PEDIDO ? AGORA - e.perguntaHaMin * 60_000 - 1_000 : undefined,
      cancelar: { ligada: true, prazoHoras: 24 },
      remarcar: { ligada: true, prazoHoras: 24 },
    });
    return { banco, c1 };
  }

  const cancelar = (banco: AgendaEmMemoria) =>
    banco.cliente().rpc("cancelar_consulta_pela_ia", {
      p_clinic_id: CLINICA,
      p_conversation_id: CONVERSA,
      p_job_id: J,
      p_appointment_id: C1,
    });

  it("cancelar: com a pergunta vencida E a mensagem nova, mensagem_nova_do_paciente (antes de pedido_vencido)", async () => {
    expect(
      (await cancelar(cancelamento({ perguntaHaMin: 70, novaNaoLida: true }).banco)).data,
    ).toEqual({ ok: false, motivo: "mensagem_nova_do_paciente" });
    expect(
      (await cancelar(cancelamento({ perguntaHaMin: 70, novaNaoLida: false }).banco)).data,
    ).toEqual({ ok: false, motivo: "pedido_vencido" });
  });

  it("cancelar: com a consulta mudada E a mensagem nova, mensagem_nova_do_paciente (antes de consulta_mudou); R14: 4 s antes da criacao do job da pergunta conta, 5 s e 6 s nao", async () => {
    const comNova = cancelamento({ perguntaHaMin: 10, novaNaoLida: true });
    comNova.c1.remarcada_em = new Date(AGORA - 60_000).toISOString();
    expect((await cancelar(comNova.banco)).data).toEqual({
      ok: false,
      motivo: "mensagem_nova_do_paciente",
    });
    const criacao = AGORA - 10 * 60_000 - 1_000;
    for (const [antes, motivo] of [
      [4_000, "consulta_mudou"],
      [FOLGA_DA_MUDANCA_MS, null],
      [6_000, null],
    ] as const) {
      const { banco, c1 } = cancelamento({ perguntaHaMin: 10, novaNaoLida: false });
      c1.remarcada_em = new Date(criacao - antes).toISOString();
      const r = await cancelar(banco);
      if (motivo === null) {
        expect(r.data, String(antes)).toMatchObject({ ok: true });
      } else {
        expect(r.data, String(antes)).toEqual({ ok: false, motivo });
      }
    }
  });

  it("agendar (AG3): com dado faltando E a mensagem nova, mensagem_nova_do_paciente (antes de faltam_dados)", async () => {
    const falas: Fala[] = [
      { id: "q", autor: "ia", texto: CONFIRMA_DA_AG3, em: AGORA - 60_000, job: J },
      { id: "s", autor: "paciente", texto: "Sim", em: AGORA - 30_000 },
      { id: "n", autor: "paciente", texto: "Obrigada", em: AGORA - 5_000 },
    ];
    const { banco, holdId } = bancoDaMarcacao({
      falas: () => falas,
      lidas: new Map([[JOB, ["s"]]]),
      turnos: () => [],
      reservaEm: AGORA - 2 * 60_000,
      exigidos: { nomeCompleto: true, nascimento: false, cpf: false },
    });
    const agendar = () =>
      banco.cliente().rpc("agendar_pela_ia", {
        p_clinic_id: CLINICA,
        p_conversation_id: CONVERSA,
        p_job_id: JOB,
        p_slot_hold_id: holdId,
      });
    expect((await agendar()).data).toEqual({
      ok: false,
      motivo: "mensagem_nova_do_paciente",
    });
    falas.pop();
    expect((await agendar()).data).toMatchObject({
      ok: false,
      motivo: "faltam_dados",
    });
  });
});

describe("B1: o turno parado pela mensagem nova nao grava o estado", () => {
  it("a pergunta feita de novo aos 50 minutos, o \"Sim\" aos 65 com a mensagem nova no meio: o pedido fica com o instante de antes e o job seguinte cancela (antes, o gravar recarimbava e vinha sem_confirmacao_do_paciente)", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    const primeira = await cenario.fala({
      texto: "Preciso cancelar minha consulta de quinta",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("pedir_cancelamento", { consulta: "c1" }),
      ],
    });
    expect(primeira.resposta).toContain(T1_DE_QUINTA);
    const doPedido = cenario.estado.pedido_pendente_em;
    cenario.agora += 48 * 60_000;
    const deNovo = await cenario.fala({
      texto: "Sim, mas tem multa?",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(deNovo.resposta).toBe(T1_DE_QUINTA);
    expect(cenario.estado.pedido_pendente_em).toBe(doPedido);

    cenario.agora += 13 * 60_000;
    const doComeco = structuredClone(cenario.estado);
    const parado = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
      durante: (c) => {
        c.escreve("Pode cancelar");
      },
    });
    expect(parado.mensagemNova).toBe(true);
    expect(parado.desfecho).toEqual({ tipo: "falhou", motivo: "sem_mensagem" });
    expect(c1.status).toBe("agendado");
    // O estado nao foi gravado: o pedido continua com o instante de antes.
    expect(cenario.estado).toEqual(doComeco);
    expect(cenario.estado.pedido_pendente_em).toBe(doPedido);
    // O que o gravar faria (o pedido tem mais de 60 minutos): recarimbava
    // depois da pergunta de novo, e o job seguinte nunca acharia a pergunta
    // depois do instante do pedido.
    expect(
      comOCarimboDoBanco(doComeco, doComeco, cenario.agora).pedido_pendente_em,
    ).not.toBe(doPedido);

    const seguinte = await cenario.continua({
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(seguinte.resposta).toBe(T2_DE_QUINTA);
    expect(c1.status).toBe("cancelado_paciente");
  });

  it("o que o turno parado ja tinha feito no banco fica coerente: a reserva nova do mesmo turno nao entra no estado (vence sozinha em 10 minutos) e nao vira consulta sem a pergunta dela; o job seguinte cancela", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await cenario.fala({
      texto: "Preciso cancelar minha consulta de quinta",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("pedir_cancelamento", { consulta: "c1" }),
      ],
    });
    const doComeco = structuredClone(cenario.estado);
    const parado = await cenario.fala({
      texto: "Sim",
      roteiro: [
        ferramenta("buscar_horario", {
          procedimento: codigoDoProcedimento(CATALOGO_DA_AG4, PROC.limpeza),
          profissional: null,
          convenio: null,
          a_partir_de: null,
          periodo: "tarde",
          unidade: null,
          hora: null,
        }),
        ferramenta("reservar_horario", { horario: "h1" }),
        ferramenta("cancelar_consulta", {}),
      ],
      durante: (c) => {
        c.escreve("Pode cancelar");
      },
    });
    expect(parado.mensagemNova).toBe(true);
    expect(parado.ferramentasUsadas).toEqual([
      "buscar_horario",
      "reservar_horario",
      "cancelar_consulta",
    ]);
    // A reserva do turno parado ficou no banco (pelo job dele), viva por 10
    // minutos; o estado e o do comeco, sem ela.
    const vivas = cenario.banco
      .linhas("slot_hold")
      .filter((h) => h.consumido_em === null);
    expect(vivas).toHaveLength(1);
    expect(cenario.estado).toEqual(doComeco);
    expect(cenario.estado.slot_hold_id).toBeNull();
    // O job seguinte le as duas mensagens e cancela; a reserva orfa nao vira
    // consulta (nenhuma pergunta "Confirma ...?" saiu para ela).
    const seguinte = await cenario.continua({
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(seguinte.resposta).toBe(T2_DE_QUINTA);
    expect(c1.status).toBe("cancelado_paciente");
    expect(cenario.banco.linhas("appointment")).toHaveLength(2);
    // Um agendar depois disso, sem a pergunta, nem chega ao banco.
    await cenario.fala({
      texto: "Pode marcar a limpeza",
      roteiro: [ferramenta("agendar", {})],
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(cenario.banco.linhas("appointment")).toHaveLength(2);
  });
});

describe("B4: o empate da saida antes da resposta pelo instante exato", () => {
  const ids = {
    clinicId: CLINICA,
    conversationId: CONVERSA,
    contactId: CONTATO,
    jobId: JOB,
  };

  function saida(autor: "ia" | "sistema", createdAt: string, texto: string) {
    return {
      id: randomUUID(),
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      direction: "saida",
      author: autor,
      content_type: "texto",
      body: texto,
      delivery_status: null,
      is_internal_note: false,
      deleted_at: null,
      created_at: createdAt,
    };
  }

  function bancoCom(...saidas: ReturnType<typeof saida>[]): AgendaEmMemoria {
    const banco = bancoDaAg3();
    banco.inserir("message", ...saidas, {
      id: randomUUID(),
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      direction: "entrada",
      author: "paciente",
      content_type: "texto",
      body: "Sim",
      is_internal_note: false,
      deleted_at: null,
      created_at: "2026-10-20T11:59:59.000001+00:00",
    });
    return banco;
  }

  it("o mesmo milissegundo com microssegundos diferentes nao e empate (o banco ordena); o mesmo instante e, em qualquer formato", async () => {
    const naoEmpata = bancoCom(
      saida("sistema", "2026-10-20T11:59:50.123456+00:00", "Lembrete"),
      saida("ia", "2026-10-20T11:59:50.123789+00:00", T1_DE_QUINTA),
    );
    expect(
      await lerSaidaAntesDaRespostaDaIa(naoEmpata.cliente(), ids),
    ).toMatchObject({ autoria: "ia", texto: T1_DE_QUINTA, empate: false });

    const empata = bancoCom(
      saida("sistema", "2026-10-20T11:59:50.1234+00:00", "Lembrete"),
      saida("ia", "2026-10-20T11:59:50.123400Z", T1_DE_QUINTA),
    );
    expect(
      await lerSaidaAntesDaRespostaDaIa(empata.cliente(), ids),
    ).toMatchObject({ autoria: "ia", empate: true });
  });

  it("instanteExatoDoBanco: o fuso, a fracao e o que nao e instante", () => {
    expect(instanteExatoDoBanco("2026-10-20T08:59:50.5-03:00")).toBe(
      instanteExatoDoBanco("2026-10-20T11:59:50.500000Z"),
    );
    expect(instanteExatoDoBanco("2026-10-20 11:59:50.000001+00")).toBe(
      instanteExatoDoBanco("2026-10-20T11:59:50.000001+0000"),
    );
    expect(instanteExatoDoBanco("2026-10-20T11:59:50.000001+00:00")).not.toBe(
      instanteExatoDoBanco("2026-10-20T11:59:50.000002+00:00"),
    );
    expect(instanteExatoDoBanco("ontem")).toBeNull();
    expect(instanteExatoDoBanco(null)).toBeNull();
  });
});
