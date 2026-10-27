import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  FRASE_DE_ESCALONAMENTO,
  FRASE_DO_ASSISTENTE_VIRTUAL,
} from "@/lib/domain/conformidade/frase-fixa";

import {
  C1,
  C2,
  CenarioDaAg4,
  configDaAg4,
  consultasDoContato,
  ferramenta,
  final,
  saidas,
} from "./ag4-conversa";
import { consultaDoContato } from "./ag4-contrato";
import { iso, PROF, VINC } from "./agenda-fixtures";
import { UNID, VINC_AG2 } from "./cadastro-fixtures";

// AG4: cancelar pela IA (D-9), em conversas de varias falas com o LLM falso
// sobre o contrato das RPCs em memoria. Duas fases: pedir_cancelamento
// confere a consulta e o SISTEMA pergunta (T1); numa mensagem nova, com um
// "sim" claro (lista fechada, D-30), cancelar_consulta chama a RPC e o
// sistema responde com o texto do botao (T2). A pergunta e armada pelo
// resultado da ferramenta e desarma em qualquer outro turno. Nenhum teste
// fala com a OpenAI nem com o banco.

const T1_DE_QUINTA =
  "Confirma o cancelamento da sua consulta de quinta, 22/10 às 14:00?";
const T2_DE_QUINTA =
  "Tudo bem, sua consulta de 22/10 às 14:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.";

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

/** O pedido de cancelar a consulta de quinta (C1): a pergunta T1. */
async function pedirOCancelamento(cenario: CenarioDaAg4) {
  return cenario.fala({
    texto: "Preciso cancelar minha consulta de quinta",
    roteiro: [
      ferramenta("consultar_minhas_consultas", {}),
      ferramenta("pedir_cancelamento", { consulta: "c1" }),
    ],
  });
}

describe("cancelar: o caminho feliz", () => {
  it("a pergunta fixa (T1) arma o pedido; o sim claro cancela pela RPC e responde com o texto do botão (T2)", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    const r1 = await pedirOCancelamento(cenario);

    // A lista vai ao modelo so com dia, hora e situacao (D-13).
    const lista = saidas(cenario.corpos[1])[0];
    expect(lista).toEqual({
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
    // Nenhuma saida de ferramenta leva o profissional, a unidade ou o id.
    const oQueAsFerramentasDisseram = JSON.stringify(
      cenario.corpos.map((corpo) => saidas(corpo)),
    );
    expect(oQueAsFerramentasDisseram).not.toMatch(
      /Ana Lima|Consulta"|c1c1c1c1|Centro|Aldeota/,
    );

    // O sistema escreve a pergunta (T1), com o aviso da primeira resposta.
    expect(r1.tipo).toBe("resposta");
    expect(r1.resposta).toBe(
      `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${T1_DE_QUINTA}`,
    );
    // O modelo so foi chamado duas vezes: a frase fixa encerra o turno.
    expect(cenario.corpos).toHaveLength(2);
    expect(r1.ferramentasUsadas).toEqual([
      "consultar_minhas_consultas",
      "pedir_cancelamento",
    ]);
    expect(r1.trilha.map((p) => p.texto)).toContain(
      "Perguntou se a pessoa confirma o cancelamento da consulta de quinta, 22/10 às 14:00 (Consulta, Dra. Ana Lima)",
    );
    // O filtro inteiro rodou, com a consulta lida no resumo dos fatos.
    expect(cenario.verificacao.pedidos).toHaveLength(1);
    expect(cenario.verificacao.pedidos[0]?.resumoDosFatos).toContain(
      "quinta, 22/10 às 14:00, unidade Centro",
    );
    expect(cenario.verificacao.pedidos[0]?.resumoDosFatos).not.toContain("Ana");
    // O pedido armado no estado, com o instante do banco.
    expect(cenario.estado).toMatchObject({
      etapa: "cancelar",
      intencao: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: C1,
      pedido_pendente_em: new Date(cenario.agora).toISOString(),
    });
    // Nada cancelado ainda.
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");

    const r2 = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(r2.tipo).toBe("resposta");
    expect(r2.resposta).toBe(T2_DE_QUINTA);
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([
      expect.objectContaining({
        p_appointment_id: C1,
        p_job_id: cenario.jobs[1],
      }),
    ]);
    expect(c1.status).toBe("cancelado_paciente");
    expect(cenario.banco.linhas("appointment_status_history")).toEqual([
      expect.objectContaining({
        appointment_id: C1,
        changed_by: "ia",
        ia_job_id: cenario.jobs[1],
      }),
    ]);
    expect(r2.trilha.map((p) => p.texto)).toContain(
      "Cancelou a consulta de quinta, 22/10 às 14:00 (Consulta, Dra. Ana Lima), a pedido da pessoa",
    );
    // O resumo do verificador diz a acao com o horario dela.
    expect(cenario.verificacao.pedidos[1]?.resumoDosFatos).toContain(
      "cancelou a consulta de quinta, 22/10 às 14:00, unidade Centro",
    );
    expect(cenario.estado).toMatchObject({
      etapa: "informacao",
      intencao: "cancelar",
      pedido_pendente: null,
      pedido_pendente_em: null,
      appointment_id: null,
      desfecho: "cancelou",
      falhas_seguidas: 0,
    });
    // Nenhum texto do paciente em log.
    expect(escrito.join("")).not.toMatch(/Preciso cancelar|quinta/);
  });

  it("cancela também a consulta pendente que a IA marcou (C2)", async () => {
    const cenario = new CenarioDaAg4();
    const { c2 } = consultasDoContato(cenario.banco);
    const r1 = await cenario.fala({
      texto: "Quero cancelar a de terça",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("pedir_cancelamento", { consulta: "c2" }),
      ],
    });
    expect(r1.resposta).toContain(
      "Confirma o cancelamento da sua consulta de terça, 27/10 às 09:00?",
    );
    await cenario.fala({
      texto: "Pode cancelar",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(c2.status).toBe("cancelado_paciente");
  });
});

describe("cancelar: as variações", () => {
  it('"Não, deixa": sem ferramenta, a consulta continua marcada e o pedido desarma', async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    const r2 = await cenario.fala({
      texto: "Não, deixa",
      roteiro: [
        final(
          "Tudo bem, sua consulta de quinta, 22/10 às 14:00 continua marcada.",
        ),
      ],
    });
    // A consulta em foco foi relida no turno: "continua marcada" passa.
    expect(r2.tipo).toBe("resposta");
    expect(r2.resposta).toBe(
      "Tudo bem, sua consulta de quinta, 22/10 às 14:00 continua marcada.",
    );
    // O bloco do estado disse o pedido so com o dia e a hora.
    expect(cenario.instrucoesDaChamada(2)).toContain(
      "Pedido de cancelar a consulta de quinta, 22/10 às 14:00: a pergunta do cancelamento já foi feita.",
    );
    expect(cenario.estado).toMatchObject({
      etapa: "informacao",
      pedido_pendente: null,
      pedido_pendente_em: null,
      appointment_id: null,
    });
    expect(c1.status).toBe("agendado");
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
  });

  it('"Não" com cancelar_consulta: nada cancelado, o modelo diz que continua marcada', async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    const r2 = await cenario.fala({
      texto: "não quero cancelar",
      roteiro: [
        ferramenta("cancelar_consulta", {}),
        final(
          "Combinado, sua consulta de quinta, 22/10 às 14:00 continua marcada.",
        ),
      ],
    });
    expect(saidas(cenario.corpos[3])[0]).toEqual({
      resultado: "paciente_nao_confirmou",
    });
    expect(r2.tipo).toBe("resposta");
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(cenario.estado.pedido_pendente).toBeNull();
  });

  it('"Sim, mas tem multa?": a pergunta fixa volta e conta uma falha; na segunda seguida, a equipe', async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    const instante = cenario.estado.pedido_pendente_em;

    const r2 = await cenario.fala({
      texto: "Sim, mas tem multa?",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(r2.tipo).toBe("resposta");
    expect(r2.resposta).toBe(T1_DE_QUINTA);
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    // A pergunta de novo, o mesmo pedido: o banco mantem o instante.
    expect(cenario.estado).toMatchObject({
      etapa: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: C1,
      pedido_pendente_em: instante,
      falhas_seguidas: 1,
    });

    const r3 = await cenario.fala({
      texto: "Acho que sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    expect(r3.tipo).toBe("frase_fixa");
    expect(r3.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r3.desfecho).toEqual({
      tipo: "escalou",
      motivo: "falhas_seguidas",
      gatilho: null,
      origem: "sistema",
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
  });

  it("cancelar_consulta sem a pergunta feita antes é recusado (falha), sem RPC", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const r = await cenario.fala({
      texto: "Cancela minha consulta de quinta",
      roteiro: [
        ferramenta("cancelar_consulta", {}),
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("pedir_cancelamento", { consulta: "c1" }),
      ],
    });
    expect(saidas(cenario.corpos[1])[0]).toEqual({
      resultado: "sem_pergunta_de_cancelamento",
    });
    expect(r.resposta).toContain(T1_DE_QUINTA);
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
  });

  it("a pergunta é armada pelo resultado da ferramenta, nunca pela expressão do modelo", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    // O modelo escreve a pergunta ele mesmo: nada armado.
    const r1 = await cenario.fala({
      texto: "Quero cancelar a de quinta",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        final(T1_DE_QUINTA),
      ],
    });
    expect(r1.tipo).toBe("resposta");
    expect(cenario.estado.pedido_pendente).toBeNull();
    expect(cenario.estado.etapa).not.toBe("cancelar");
    // O "sim" seguinte nao cancela.
    await cenario.fala({
      texto: "Sim",
      roteiro: [
        ferramenta("cancelar_consulta", {}),
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("pedir_cancelamento", { consulta: "c1" }),
      ],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(cenario.estado.pedido_pendente).toBe("cancelar");
  });

  it("o pedido vale só para a resposta seguinte: outro assunto no meio desarma", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    await cenario.fala({
      texto: "Vocês atendem sábado?",
      roteiro: [final("Atendemos de segunda a sexta.")],
    });
    expect(cenario.estado.pedido_pendente).toBeNull();
    await cenario.fala({
      texto: "Sim",
      roteiro: [
        ferramenta("cancelar_consulta", {}),
        final("Quer cancelar qual consulta?"),
      ],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
  });

  it("código que a lista não trouxe: codigo_invalido (falha)", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const r = await cenario.fala({
      texto: "Cancela a minha consulta",
      roteiro: [
        ferramenta("pedir_cancelamento", { consulta: "c9" }),
        final("Qual consulta você quer cancelar, a de quinta ou a de terça?"),
      ],
    });
    expect(saidas(cenario.corpos[1])[0]).toEqual({
      resultado: "codigo_invalido",
    });
    expect(r.atendimento?.estado.falhas_seguidas).toBe(1);
    expect(cenario.estado.pedido_pendente).toBeNull();
  });
});

describe("cancelar: o que fica com a equipe", () => {
  it("dentro do prazo da clínica: fora_do_prazo, com a nota do pedido e do prazo", async () => {
    const cenario = new CenarioDaAg4({
      config: configDaAg4({ prazos: { cancelarHoras: 72, remarcarHoras: 24 } }),
    });
    consultasDoContato(cenario.banco);
    const r = await pedirOCancelamento(cenario);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "fora_do_prazo",
      gatilho: null,
      origem: "ferramenta",
    });
    expect(r.notaParaAEquipe).toContain(
      "Pedido: cancelar a consulta de quinta, 22/10 às 14:00 (Consulta, Dra. Ana Lima).",
    );
    expect(r.notaParaAEquipe).toContain(
      "Parou em: o pedido ficou dentro do prazo da clínica para o assistente cancelar (72 horas).",
    );
    expect(r.notaParaAEquipe).not.toMatch(/[–—]/);
    expect(r.trilha.map((p) => p.texto)).toContain(
      "Passou para a equipe: o pedido de cancelar ou remarcar ficou dentro do prazo da clínica",
    );
  });

  it("encaixe e procedimento só com a equipe: pedido_de_agenda", async () => {
    for (const extra of [
      { encaixe: true, vinculo: VINC.consultaAna },
      { encaixe: false, vinculo: VINC_AG2.botoxAna },
    ]) {
      const cenario = new CenarioDaAg4();
      cenario.banco.inserir(
        "appointment",
        consultaDoContato({
          id: C1,
          inicio: iso("2026-10-22", "14:00"),
          fim: iso("2026-10-22", "14:30"),
          vinculo: extra.vinculo,
          profissional: PROF.ana,
          unidade: UNID.centro,
          encaixe: extra.encaixe,
        }),
      );
      const r = await pedirOCancelamento(cenario);
      expect(r.tipo, JSON.stringify(extra)).toBe("frase_fixa");
      expect(r.desfecho).toMatchObject({
        tipo: "escalou",
        motivo: "pedido_de_agenda",
        origem: "ferramenta",
      });
      expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    }
  });

  it("a consulta com remarcação pendente fica com a equipe (e a lista diz isso)", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    cenario.banco.inserir(
      "appointment",
      consultaDoContato({
        inicio: iso("2026-10-29", "15:00"),
        fim: iso("2026-10-29", "15:30"),
        vinculo: VINC.consultaAna,
        profissional: PROF.ana,
        unidade: UNID.centro,
        aprovacao: "pendente",
        remarcacaoDe: C1,
        criadaPor: "ia",
      }),
    );
    const r = await pedirOCancelamento(cenario);
    expect(
      (saidas(cenario.corpos[1])[0]?.consultas as { situacao: string }[]).map(
        (c) => c.situacao,
      ),
    ).toEqual([
      "remarcacao_pedida",
      "aguardando_aprovacao",
      "remarcacao_aguardando_aprovacao",
    ]);
    expect(r.desfecho).toMatchObject({ motivo: "pedido_de_agenda" });
  });

  it("as recusas do banco: consulta_mudou vai ao modelo e desarma; fora_do_prazo e ia_desligada", async () => {
    // A recepcao remarcou a consulta depois da pergunta.
    const mudou = new CenarioDaAg4();
    const { c1 } = consultasDoContato(mudou.banco);
    await pedirOCancelamento(mudou);
    c1.remarcada_em = new Date(mudou.agora + 60_000).toISOString();
    const r = await mudou.fala({
      texto: "Sim",
      roteiro: [
        ferramenta("cancelar_consulta", {}),
        final(
          "A sua consulta mudou. Quer que eu veja as suas consultas de novo?",
        ),
      ],
    });
    expect(saidas(mudou.corpos[3])[0]).toEqual({ resultado: "consulta_mudou" });
    expect(r.tipo).toBe("resposta");
    expect(mudou.estado.pedido_pendente).toBeNull();
    expect(c1.status).toBe("agendado");

    for (const [motivo, desfecho] of [
      ["fora_do_prazo", { tipo: "escalou", motivo: "fora_do_prazo" }],
      ["encaixe", { tipo: "escalou", motivo: "pedido_de_agenda" }],
      ["ia_desligada", { tipo: "falhou", motivo: "liberacao_suspensa" }],
      [
        "sem_pedido_de_cancelamento",
        { tipo: "falhou", motivo: "desconhecida" },
      ],
    ] as const) {
      const cenario = new CenarioDaAg4();
      consultasDoContato(cenario.banco);
      await pedirOCancelamento(cenario);
      cenario.opcoes.forcar = { cancelar: motivo };
      const recusado = await cenario.fala({
        texto: "Sim",
        roteiro: [ferramenta("cancelar_consulta", {})],
      });
      expect(recusado.tipo, motivo).toBe("frase_fixa");
      expect(recusado.desfecho, motivo).toMatchObject(desfecho);
    }
  });

  it("a habilidade desligada: sem as ferramentas de cancelar no modelo", async () => {
    const cenario = new CenarioDaAg4({
      config: configDaAg4({
        prazos: { cancelarHoras: null, remarcarHoras: 24 },
      }),
    });
    consultasDoContato(cenario.banco);
    await cenario.fala({
      texto: "Quero cancelar",
      roteiro: [final("Certo. Você quer cancelar a consulta de quando?")],
    });
    const nomes = (cenario.corpos[0]?.tools as { name: string }[]).map(
      (f) => f.name,
    );
    expect(nomes).not.toContain("pedir_cancelamento");
    expect(nomes).not.toContain("cancelar_consulta");
    // remarcar segue (o prazo de remarcar esta preenchido).
    expect(nomes).toContain("buscar_horario_para_remarcar");
    expect(cenario.instrucoesDaChamada(0)).toContain(
      'Cancelar consulta: desligado. Se o paciente quiser cancelar uma consulta, passe para a equipe com o motivo "pedido_de_agenda".',
    );
  });
});

describe("cancelar: a idempotência pelo job", () => {
  it("o mesmo job devolve o cancelamento que ele já fez (reutilizado)", async () => {
    const { cancelarConsultaPelaIa } = await import("@/lib/agente/agenda");
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await pedirOCancelamento(cenario);
    const ids = {
      clinicId: "acd9c539-585e-4f2a-a195-712c70099564",
      conversationId: "c0000000-0000-4000-8000-000000000001",
      contactId: "c1000000-0000-4000-8000-000000000001",
      jobId: "10000000-0000-4000-8000-0000000000aa",
    };
    const primeira = await cancelarConsultaPelaIa(
      cenario.banco.cliente(),
      ids,
      C1,
    );
    const segunda = await cancelarConsultaPelaIa(
      cenario.banco.cliente(),
      ids,
      C1,
    );
    expect(primeira).toMatchObject({ ok: true, reutilizado: false });
    expect(segunda).toMatchObject({ ok: true, reutilizado: true });
    expect(
      cenario.banco
        .linhas("appointment_status_history")
        .filter((h) => h.appointment_id === C1),
    ).toHaveLength(1);
    // De outra consulta com o mesmo job: erro (falha fechada).
    await expect(
      cancelarConsultaPelaIa(cenario.banco.cliente(), ids, C2),
    ).rejects.toThrow();
  });
});
