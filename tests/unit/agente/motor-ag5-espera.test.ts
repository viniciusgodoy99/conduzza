import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  FRASE_DE_ESCALONAMENTO,
  FRASE_DO_ASSISTENTE_VIRTUAL,
} from "@/lib/domain/conformidade/frase-fixa";

import {
  busca,
  CenarioDaAg5,
  R_ANA,
  R_BRUNO,
  T_E1_ANA_NOITE_SEG_QUA,
  T_E2_ANA_NOITE_SEG_QUA,
} from "./ag5-conversa";
import { consultaDoContato } from "./ag4-contrato";
import { ferramenta, final, saidas } from "./ag4-conversa";
import { CONTATO, CONVERSA, iso, PROC, PROF, VINC } from "./agenda-fixtures";

// AG5: a IA coloca o paciente na lista de espera (D-11), em conversas de
// varias falas com o LLM falso sobre o contrato das RPCs em memoria. Duas
// fases, como cancelar na AG4: pedir_lista_de_espera (o procedimento, o
// profissional e o pagamento do ESTADO, a ultima busca; a preferencia que a
// pessoa disse) grava o pedido e o SISTEMA pergunta (T-E1); numa mensagem
// nova, com um "sim" da lista fechada propria, entrar_na_lista_de_espera
// chama a RPC e o sistema responde (T-E2). Nenhum teste fala com a OpenAI
// nem com o banco.

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

/** A busca a noite com a Dra. Ana (ninguem atende a noite): sem_horario. */
async function semHorarioANoite(cenario: CenarioDaAg5) {
  return cenario.fala({
    texto: "Queria limpeza de pele com a Dra. Ana, só à noite.",
    roteiro: [
      ferramenta("buscar_horario", busca({ profissional: R_ANA, periodo: "noite" })),
      final(
        "Não tenho horário à noite com a Dra. Ana Lima. Posso procurar de manhã ou à tarde, ou colocar você na lista de espera para à noite. O que prefere?",
      ),
    ],
  });
}

/** O pedido da lista: a noite, as segundas e as quartas (a T-E1). */
async function pedirALista(cenario: CenarioDaAg5) {
  return cenario.fala({
    texto: "Lista de espera. Segunda ou quarta.",
    roteiro: [
      ferramenta("pedir_lista_de_espera", {
        periodos: ["noite"],
        dias: ["segunda", "quarta"],
      }),
    ],
  });
}

describe("lista de espera: o caminho feliz", () => {
  it("sem horário, a pergunta fixa (T-E1) grava o pedido; o sim entra na fila e o sistema responde (T-E2)", async () => {
    const cenario = new CenarioDaAg5();
    const r0 = await semHorarioANoite(cenario);
    expect(r0.tipo).toBe("resposta");
    expect(saidas(cenario.corpos[1])[0]).toMatchObject({
      resultado: "sem_horario",
    });

    const r1 = await pedirALista(cenario);
    expect(r1.tipo).toBe("resposta");
    expect(r1.resposta).toBe(T_E1_ANA_NOITE_SEG_QUA);
    // O pedido vem do ESTADO (a ultima busca), nunca do texto do modelo.
    expect(
      cenario.banco.chamadasDe("pedir_lista_de_espera_pela_ia"),
    ).toEqual([
      expect.objectContaining({
        p_procedure_id: PROC.limpeza,
        p_professional_id: PROF.ana,
        p_insurance_id: null,
        p_particular: true,
        p_turnos: ["noite"],
        p_dias: [1, 3],
        p_job_id: cenario.jobs[1],
      }),
    ]);
    expect(cenario.pedidos).toHaveLength(1);
    expect(cenario.fila).toEqual([]);
    expect(r1.trilha.map((p) => p.texto)).toContain(
      "Perguntou se a pessoa confirma a entrada na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas",
    );
    // O estado do atendimento nao ganha chave nem etapa nova.
    expect(cenario.estado.etapa).not.toBe("aguardando_confirmacao");
    expect(cenario.estado.pedido_pendente).toBeNull();

    const r2 = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r2.tipo).toBe("resposta");
    expect(r2.resposta).toBe(T_E2_ANA_NOITE_SEG_QUA);
    expect(
      cenario.banco.chamadasDe("entrar_na_lista_de_espera_pela_ia"),
    ).toEqual([
      expect.objectContaining({
        p_conversation_id: CONVERSA,
        p_job_id: cenario.jobs[2],
      }),
    ]);
    expect(cenario.fila).toEqual([
      expect.objectContaining({
        contact_id: CONTATO,
        procedure_id: PROC.limpeza,
        professional_id: PROF.ana,
        origem: "ia",
        ia_job_id: cenario.jobs[2],
        conversation_id: CONVERSA,
        particular: true,
        insurance_id: null,
        preferred_shifts: ["noite"],
        preferred_weekdays: [1, 3],
      }),
    ]);
    expect(cenario.pedidos[0]).toMatchObject({
      consumido_em: expect.any(String),
      job_id_da_entrada: cenario.jobs[2],
    });
    expect(cenario.eventos).toContain(
      "A IA colocou o paciente na lista de espera: Limpeza de pele, Dra. Ana Lima, particular. Preferência: noite; segunda e quarta.",
    );
    expect(r2.trilha.map((p) => p.texto)).toContain(
      "Colocou a pessoa na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas",
    );
    expect(r2.ferramentasUsadas).toEqual(["entrar_na_lista_de_espera"]);
    expect(cenario.estado.falhas_seguidas).toBe(0);
    // Nada de texto do paciente em log.
    expect(escrito.join("")).not.toMatch(/Segunda ou quarta|Sim/);
  });
});

/** O pedido feito e a T-E1 no ar (sem horario a noite; segunda e quarta). */
async function comAPergunta(cenario: CenarioDaAg5) {
  await semHorarioANoite(cenario);
  const r = await pedirALista(cenario);
  expect(r.resposta).toBe(T_E1_ANA_NOITE_SEG_QUA);
  return r;
}

describe("quando a IA oferece a lista (desenho 1.1)", () => {
  it("o pedido direto com horário que sirva: a busca vem antes e o horário é oferecido primeiro", async () => {
    const cenario = new CenarioDaAg5();
    const r1 = await cenario.fala({
      texto: "Me coloca na lista de espera da limpeza de pele.",
      roteiro: [
        ferramenta("buscar_horario", busca()),
        final(
          "Tenho terça, 20/10 às 14:00 com a Dra. Ana Lima. Quer este, ou prefere a lista de espera para outro dia?",
        ),
      ],
    });
    expect(r1.tipo).toBe("resposta");
    expect(saidas(cenario.corpos[1])[0]).toMatchObject({ resultado: "horarios" });
    const r2 = await cenario.fala({
      texto: "Prefiro a lista, de manhã às sextas.",
      roteiro: [
        ferramenta("pedir_lista_de_espera", {
          periodos: ["manha"],
          dias: ["sexta"],
        }),
      ],
    });
    // A busca foi sem profissional: qualquer profissional.
    expect(r2.resposta).toBe(
      "Confirma a sua entrada na lista de espera para Limpeza de pele, com qualquer profissional, no particular, de manhã, às sextas? Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp para ficar com ele.",
    );
    expect(cenario.banco.chamadasDe("pedir_lista_de_espera_pela_ia")).toEqual([
      expect.objectContaining({ p_professional_id: null, p_dias: [5] }),
    ]);
  });

  it("o pedido direto sem horário: busca e pede na mesma resposta; tudo serve vira qualquer", async () => {
    const cenario = new CenarioDaAg5();
    const r = await cenario.fala({
      texto: "Quero entrar na lista de espera da limpeza com a Dra. Ana, à noite.",
      roteiro: [
        ferramenta("buscar_horario", busca({ profissional: R_ANA, periodo: "noite" })),
        ferramenta("pedir_lista_de_espera", {
          periodos: ["noite"],
          dias: [
            "domingo",
            "segunda",
            "terca",
            "quarta",
            "quinta",
            "sexta",
            "sabado",
          ],
        }),
      ],
    });
    // Os sete dias viram "qualquer" (o banco normaliza; a T-E1 usa o dele).
    expect(r.resposta).toBe(
      `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\nConfirma a sua entrada na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, em qualquer dia? Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp para ficar com ele.`,
    );
    expect(cenario.pedidos[0]).toMatchObject({
      preferred_shifts: ["noite"],
      preferred_weekdays: [],
    });
  });

  it("sem a busca antes (procedimento ou pagamento vazios): sem_busca_antes ao modelo, conta falha, nada no banco", async () => {
    const cenario = new CenarioDaAg5();
    const r = await cenario.fala({
      texto: "Me coloca na lista de espera.",
      roteiro: [
        ferramenta("pedir_lista_de_espera", { periodos: [], dias: [] }),
        final("Claro! Qual procedimento você quer fazer?"),
      ],
    });
    expect(r.tipo).toBe("resposta");
    expect(saidas(cenario.corpos[1])[0]).toEqual({ resultado: "sem_busca_antes" });
    expect(cenario.banco.chamadasDe("pedir_lista_de_espera_pela_ia")).toEqual([]);
    expect(cenario.estado.falhas_seguidas).toBe(1);
  });

  it("entrada fora do formato (dia repetido): entrada_invalida, sem RPC", async () => {
    const cenario = new CenarioDaAg5();
    await semHorarioANoite(cenario);
    const r = await cenario.fala({
      texto: "Lista, segunda.",
      roteiro: [
        ferramenta("pedir_lista_de_espera", {
          periodos: ["noite"],
          dias: ["segunda", "segunda"],
        }),
        final("Que dias da semana servem para você?"),
      ],
    });
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({ resultado: "entrada_invalida" });
    expect(cenario.banco.chamadasDe("pedir_lista_de_espera_pela_ia")).toEqual([]);
    expect(r.tipo).toBe("resposta");
  });
});

describe("a resposta à pergunta (desenho 1.3)", () => {
  it('"Não, deixa": o modelo diz que não colocou; nada entra na fila e o pedido fica sem consumo', async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    const r = await cenario.fala({
      texto: "Não, deixa",
      roteiro: [
        ferramenta("entrar_na_lista_de_espera", {}),
        final("Tudo bem, não coloquei você na lista."),
      ],
    });
    expect(r.tipo).toBe("resposta");
    expect(r.resposta).toBe("Tudo bem, não coloquei você na lista.");
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({ resultado: "paciente_nao_quis" });
    expect(cenario.banco.chamadasDe("entrar_na_lista_de_espera_pela_ia")).toEqual([]);
    expect(cenario.fila).toEqual([]);
    expect(cenario.pedidos[0]).toMatchObject({ consumido_em: null });
    expect(cenario.estado.falhas_seguidas).toBe(0);
  });

  it('"Sim, mas demora?" não é um sim claro: a T-E1 volta (re-ancorada neste job) e conta falha; na segunda, a equipe', async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    const r1 = await cenario.fala({
      texto: "Sim, mas demora?",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r1.tipo).toBe("resposta");
    expect(r1.resposta).toBe(T_E1_ANA_NOITE_SEG_QUA);
    expect(cenario.banco.chamadasDe("entrar_na_lista_de_espera_pela_ia")).toEqual([]);
    // A pergunta de novo grava um pedido novo com o job deste turno.
    expect(cenario.banco.chamadasDe("pedir_lista_de_espera_pela_ia").at(-1)).toMatchObject({
      p_job_id: cenario.jobs[2],
    });
    expect(cenario.pedidos.filter((p) => p.consumido_em === null)).toEqual([
      expect.objectContaining({ job_id: cenario.jobs[2] }),
    ]);
    expect(cenario.estado.falhas_seguidas).toBe(1);
    expect(r1.trilha.map((p) => p.texto)).toContain(
      "A resposta não foi um sim claro: perguntou de novo se a pessoa confirma a entrada na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas",
    );
    const r2 = await cenario.fala({
      texto: "acho que sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r2.tipo).toBe("frase_fixa");
    expect(r2.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r2.desfecho).toMatchObject({ tipo: "escalou", motivo: "falhas_seguidas" });
    expect(cenario.fila).toEqual([]);
    // A nota da passagem conta o pedido e onde parou.
    expect(r2.notaParaAEquipe).toContain(
      "Pedido: entrar na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas.",
    );
    expect(r2.notaParaAEquipe).toContain(
      "A pergunta da lista de espera foi feita; a pessoa ainda não confirmou.",
    );
    expect(r2.notaParaAEquipe).toContain(
      "Parou em: a resposta do paciente à pergunta da lista de espera não ficou clara.",
    );
  });

  it('o "cancela" da lista do cancelamento nunca é o sim da lista de espera', async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    const r = await cenario.fala({
      texto: "Pode cancelar",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r.resposta).toBe(T_E1_ANA_NOITE_SEG_QUA);
    expect(cenario.banco.chamadasDe("entrar_na_lista_de_espera_pela_ia")).toEqual([]);
  });

  it("a pergunta venceu (mais de 60 minutos): pergunta de novo sem falha; o sim seguinte entra", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    cenario.agora += 61 * 60_000;
    const r1 = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r1.resposta).toBe(T_E1_ANA_NOITE_SEG_QUA);
    expect(cenario.banco.chamadasDe("entrar_na_lista_de_espera_pela_ia")).toEqual([]);
    expect(cenario.estado.falhas_seguidas).toBe(0);
    expect(r1.trilha.map((p) => p.texto)).toContain(
      "A pergunta da lista de espera venceu (mais de 1 hora sem a resposta): perguntou de novo se a pessoa confirma a entrada na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas",
    );
    const r2 = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r2.resposta).toBe(T_E2_ANA_NOITE_SEG_QUA);
    expect(cenario.fila).toHaveLength(1);
  });

  it("outra mensagem da clínica saiu no meio: a T-E1 volta e conta falha (o sim pode ser de outra pergunta)", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    cenario.daClinica("Lembrete: amanhã tem campanha de limpeza de pele.", "sistema");
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r.resposta).toBe(T_E1_ANA_NOITE_SEG_QUA);
    expect(cenario.banco.chamadasDe("entrar_na_lista_de_espera_pela_ia")).toEqual([]);
    expect(cenario.estado.falhas_seguidas).toBe(1);
    // Depois da pergunta de novo, o sim entra (o avanco zera).
    const r2 = await cenario.fala({
      texto: "Sim, pode colocar",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r2.resposta).toBe(T_E2_ANA_NOITE_SEG_QUA);
    expect(cenario.estado.falhas_seguidas).toBe(0);
  });

  it("a resposta que cita outra mensagem (o botão de uma mensagem antiga) nunca é o sim", async () => {
    const cenario = new CenarioDaAg5();
    const antiga = cenario.daClinica("Responda 1 para confirmar sua consulta.", "sistema");
    await comAPergunta(cenario);
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
      citacao: { mensagem: antiga },
    });
    expect(r.resposta).toBe(T_E1_ANA_NOITE_SEG_QUA);
    expect(cenario.banco.chamadasDe("entrar_na_lista_de_espera_pela_ia")).toEqual([]);
    expect(cenario.estado.falhas_seguidas).toBe(1);
  });

  it("a pessoa escreveu de novo no meio do turno (mensagem_nova_do_paciente): nada sai, sem falha, e o próximo lê", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    const antes = cenario.estado;
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
      durante: (c) => {
        c.escreve("Espera, à tarde também serve");
      },
    });
    expect(r.mensagemNova).toBe(true);
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "sem_mensagem" });
    expect(cenario.banco.chamadasDe("entrar_na_lista_de_espera_pela_ia")).toHaveLength(1);
    expect(cenario.fila).toEqual([]);
    expect(cenario.estado).toEqual(antes);
    // O job seguinte le as duas mensagens; o modelo pede de novo com a tarde.
    const r2 = await cenario.continua({
      roteiro: [
        ferramenta("pedir_lista_de_espera", {
          periodos: ["tarde", "noite"],
          dias: ["segunda", "quarta"],
        }),
      ],
    });
    expect(r2.resposta).toBe(
      "Confirma a sua entrada na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à tarde ou à noite, às segundas e às quartas? Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp para ficar com ele.",
    );
  });

  it("entrar sem a pergunta feita numa mensagem anterior: sem_pergunta_de_espera (falha), e pedir no mesmo turno pergunta", async () => {
    const cenario = new CenarioDaAg5();
    await semHorarioANoite(cenario);
    const r = await cenario.fala({
      texto: "Sim, pode me colocar na lista, segunda.",
      roteiro: [
        ferramenta("entrar_na_lista_de_espera", {}),
        ferramenta("pedir_lista_de_espera", { periodos: ["noite"], dias: ["segunda"] }),
      ],
    });
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({
      resultado: "sem_pergunta_de_espera",
    });
    expect(r.resposta).toBe(
      "Confirma a sua entrada na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas? Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp para ficar com ele.",
    );
    expect(cenario.banco.chamadasDe("entrar_na_lista_de_espera_pela_ia")).toEqual([]);
    expect(cenario.fila).toEqual([]);
  });

  it("dois pedidos na mesma resposta: o segundo é recusado (um_pedido_de_espera_por_resposta)", async () => {
    const cenario = new CenarioDaAg5();
    await semHorarioANoite(cenario);
    cenario.marcas.forcar = { pedir: "ja_na_lista" };
    await cenario.fala({
      texto: "Lista, segunda.",
      roteiro: [
        ferramenta("pedir_lista_de_espera", { periodos: ["noite"], dias: ["segunda"] }),
        ferramenta("pedir_lista_de_espera", { periodos: ["noite"], dias: ["quarta"] }),
        final("Você já está na lista de espera para isso."),
      ],
    });
    expect(cenario.banco.chamadasDe("pedir_lista_de_espera_pela_ia")).toHaveLength(1);
    expect(saidas(cenario.corpos.at(-1)).at(-1)).toEqual({
      resultado: "um_pedido_de_espera_por_resposta",
    });
  });
});

describe("as recusas do banco (desenho 1.5)", () => {
  it("ja_na_lista: ao modelo com a preferência da entrada que já existe; a frase passa com o fato", async () => {
    const cenario = new CenarioDaAg5();
    cenario.banco.inserir("waitlist", {
      id: "e1e1e1e1-0000-4000-8000-000000000001",
      clinic_id: "acd9c539-585e-4f2a-a195-712c70099564",
      contact_id: CONTATO,
      procedure_id: PROC.limpeza,
      professional_id: PROF.ana,
      preferred_shifts: ["manha"],
      preferred_weekdays: [2],
      active: true,
      origem: "equipe",
    });
    await semHorarioANoite(cenario);
    const r = await cenario.fala({
      texto: "Lista, segunda ou quarta.",
      roteiro: [
        ferramenta("pedir_lista_de_espera", {
          periodos: ["noite"],
          dias: ["segunda", "quarta"],
        }),
        final(
          "Você já está na lista de espera para a Limpeza de pele com a Dra. Ana Lima, de manhã, às terças. Quer falar com a equipe para mudar?",
        ),
      ],
    });
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({
      resultado: "ja_na_lista",
      preferencia: "de manhã, às terças",
    });
    expect(r.tipo).toBe("resposta");
    expect(cenario.pedidos).toEqual([]);
  });

  it("ja_na_lista com outra preferência dita pelo modelo: o filtro barra (espera_fora_da_entrada)", async () => {
    const cenario = new CenarioDaAg5();
    cenario.banco.inserir("waitlist", {
      id: "e1e1e1e1-0000-4000-8000-000000000001",
      clinic_id: "acd9c539-585e-4f2a-a195-712c70099564",
      contact_id: CONTATO,
      procedure_id: PROC.limpeza,
      professional_id: PROF.ana,
      preferred_shifts: ["manha"],
      preferred_weekdays: [2],
      active: true,
      origem: "equipe",
    });
    await semHorarioANoite(cenario);
    const r = await cenario.fala({
      texto: "Lista, segunda ou quarta.",
      roteiro: [
        ferramenta("pedir_lista_de_espera", {
          periodos: ["noite"],
          dias: ["segunda", "quarta"],
        }),
        final("Você já está na lista de espera à noite, às segundas."),
      ],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({ tipo: "bloqueou", camada: "regra" });
  });

  it("ja_tem_consulta (D-41): ao modelo só o dia e a hora da consulta que a pessoa já tem", async () => {
    const cenario = new CenarioDaAg5();
    cenario.banco.inserir(
      "appointment",
      consultaDoContato({
        inicio: iso("2026-10-29", "10:00"),
        fim: iso("2026-10-29", "11:00"),
        vinculo: VINC.limpezaAna,
        profissional: PROF.ana,
      }),
    );
    await semHorarioANoite(cenario);
    const r = await cenario.fala({
      texto: "Lista, segunda ou quarta.",
      roteiro: [
        ferramenta("pedir_lista_de_espera", {
          periodos: ["noite"],
          dias: ["segunda", "quarta"],
        }),
        final(
          "Você já tem uma consulta de limpeza de pele marcada para quinta, 29/10 às 10:00. Quer falar com a equipe sobre ela?",
        ),
      ],
    });
    expect(saidas(cenario.corpos.at(-1))[0]).toEqual({
      resultado: "ja_tem_consulta",
      dia: "quinta, 29/10",
      hora: "10:00",
    });
    expect(r.tipo).toBe("resposta");
    expect(cenario.pedidos).toEqual([]);
  });

  it.each([
    ["só com a equipe", { forcar: { pedir: "so_com_a_equipe" } }, "pedido_de_agenda", "o procedimento, o profissional ou o convênio do pedido só é marcado pela equipe"],
    ["sem autorização para mensagens", { autorizado: false }, "pedido_de_agenda", "o contato não tem autorização para receber mensagens"],
    ["a habilidade desligada no meio", { ligada: false }, "pedido_de_agenda", "a lista de espera não está ligada na versão publicada"],
    ["consulta para outra pessoa (D-8)", { paraOutraPessoa: true }, "consulta_para_outra_pessoa", "a consulta é para outra pessoa"],
    ["menor de idade (D-8)", { menorDeIdade: true }, "menor_de_idade", "o paciente é menor de idade"],
  ] as const)("%s: passa para a equipe com o motivo certo e a nota", async (_nome, marcas, motivo, parouEm) => {
    const cenario = new CenarioDaAg5();
    await semHorarioANoite(cenario);
    Object.assign(cenario.marcas, marcas);
    const r = await pedirALista(cenario);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.desfecho).toMatchObject({ tipo: "escalou", motivo, origem: "ferramenta" });
    expect(cenario.pedidos).toEqual([]);
    expect(r.notaParaAEquipe).toContain(`Parou em: ${parouEm}.`);
  });

  it("mais de uma unidade ativa (D-38): passa para a equipe sem chamar o banco", async () => {
    const { catalogoDoCadastro } = await import("./cadastro-fixtures");
    const { CATALOGO_DA_AG5 } = await import("./ag5-conversa");
    const cenario = new CenarioDaAg5({
      catalogo: { ...CATALOGO_DA_AG5, unidades: catalogoDoCadastro().unidades },
    });
    await semHorarioANoite(cenario);
    const r = await pedirALista(cenario);
    expect(r.desfecho).toMatchObject({ tipo: "escalou", motivo: "pedido_de_agenda" });
    expect(cenario.banco.chamadasDe("pedir_lista_de_espera_pela_ia")).toEqual([]);
    expect(r.notaParaAEquipe).toContain(
      "Parou em: a clínica tem mais de uma unidade, e a lista de espera ainda não guarda a unidade.",
    );
  });

  it("ia_desligada: o turno para como a trava (sem frase)", async () => {
    const cenario = new CenarioDaAg5();
    await semHorarioANoite(cenario);
    cenario.marcas.iaAtendendo = false;
    const r = await pedirALista(cenario);
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "liberacao_suspensa" });
  });

  it("erro do banco (22023), resposta fora do formato e motivo desconhecido: falha fechada", async () => {
    for (const forcado of ["22023", "fora_do_formato", "motivo_que_nao_existe"]) {
      const cenario = new CenarioDaAg5();
      await semHorarioANoite(cenario);
      cenario.marcas.forcar = { pedir: forcado };
      const r = await pedirALista(cenario);
      expect(r.desfecho, forcado).toEqual({ tipo: "falhou", motivo: "desconhecida" });
      expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    }
  });

  it("na fase 2: pedido_vencido do banco pergunta de novo sem falha; sem_confirmacao_do_paciente, com falha", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    cenario.marcas.forcar = { entrar: "pedido_vencido" };
    const r1 = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r1.resposta).toBe(T_E1_ANA_NOITE_SEG_QUA);
    expect(cenario.estado.falhas_seguidas).toBe(0);
    cenario.marcas.forcar = { entrar: "sem_confirmacao_do_paciente" };
    const r2 = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r2.resposta).toBe(T_E1_ANA_NOITE_SEG_QUA);
    expect(cenario.estado.falhas_seguidas).toBe(1);
    expect(cenario.fila).toEqual([]);
  });

  it("na fase 2: sem_pedido_de_espera depois de o preparo ler o pedido é falha fechada", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    cenario.marcas.forcar = { entrar: "sem_pedido_de_espera" };
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "desconhecida" });
  });
});

describe("o que a IA nunca faz (desenho 1.4)", () => {
  it("encaixe: a oferta de encaixe sem horário livre é barrada pelo filtro", async () => {
    const cenario = new CenarioDaAg5();
    const r = await cenario.fala({
      texto: "Queria limpeza de pele com a Dra. Ana à noite, hoje.",
      roteiro: [
        ferramenta("buscar_horario", busca({ profissional: R_ANA, periodo: "noite" })),
        final("Não tenho horário à noite. Posso tentar um encaixe."),
      ],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({ tipo: "bloqueou" });
  });

  it.each([
    "Você é a primeira da fila.",
    "Logo abre um horário para você.",
    "Assim que abrir uma vaga, ela é sua.",
  ])("prometer vaga, prazo ou posição é barrado, mesmo depois de entrar na lista: %s", async (promessa) => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(cenario.fila).toHaveLength(1);
    const r = await cenario.fala({
      texto: "Obrigada! Demora muito?",
      roteiro: [final(promessa)],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({
      tipo: "bloqueou",
      categoria: "horario_nao_verificado",
      camada: "regra",
    });
  });

  it("depois de entrar, dizer só que a mensagem chega se abrir um horário passa (a exceção estreita)", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    const r = await cenario.fala({
      texto: "Obrigada! Demora muito?",
      roteiro: [
        final(
          "Não dá para dizer quando abre um horário. Se abrir uma vaga à noite, você recebe uma mensagem pelo WhatsApp.",
        ),
      ],
    });
    expect(r.tipo).toBe("resposta");
  });

  it('"coloquei você na lista" sem a ferramenta é barrado', async () => {
    const cenario = new CenarioDaAg5();
    await semHorarioANoite(cenario);
    const r = await cenario.fala({
      texto: "Pode me colocar na lista, segunda.",
      roteiro: [final("Pronto, coloquei você na lista de espera.")],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({
      tipo: "bloqueou",
      categoria: "acao_nao_executada",
    });
  });

  it("a mensagem automática da oferta no histórico: o SIM a ela nunca entra pela IA", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    // A oferta da reoferta (sistema) saiu depois da T-E1, e o SIM chegou a IA.
    cenario.daClinica(
      "Abriu um horário na segunda, 26/10 às 19:00 com a Dra. Ana Lima. Para ficar com ele, responda SIM até as 10:30.",
      "sistema",
    );
    const r = await cenario.fala({
      texto: "SIM",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    // A T-E1 nao e mais a saida logo antes do SIM: a pergunta volta e conta
    // falha; nada entra na fila.
    expect(r.resposta).toBe(T_E1_ANA_NOITE_SEG_QUA);
    expect(cenario.banco.chamadasDe("entrar_na_lista_de_espera_pela_ia")).toEqual([]);
    expect(cenario.fila).toEqual([]);
    expect(cenario.estado.falhas_seguidas).toBe(1);
  });
});

describe("o profissional do pedido vem da busca", () => {
  it("a busca com o Dr. Bruno: a T-E1 cita o Dr. Bruno; trocar o profissional é buscar de novo", async () => {
    const cenario = new CenarioDaAg5();
    await cenario.fala({
      texto: "Consulta com o Dr. Bruno de manhã.",
      roteiro: [
        ferramenta("buscar_horario", {
          ...busca({ profissional: R_BRUNO, periodo: "manha" }),
          procedimento: (await import("./ag5-conversa")).P_CONSULTA,
        }),
        final(
          "Não tenho horário de manhã com o Dr. Bruno Costa. Posso procurar à tarde, ou colocar você na lista de espera para de manhã. O que prefere?",
        ),
      ],
    });
    const r = await cenario.fala({
      texto: "Lista, qualquer dia de manhã.",
      roteiro: [ferramenta("pedir_lista_de_espera", { periodos: ["manha"], dias: [] })],
    });
    expect(r.resposta).toBe(
      "Confirma a sua entrada na lista de espera para Consulta, com Dr. Bruno Costa, no particular, de manhã, em qualquer dia? Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp para ficar com ele.",
    );
    expect(cenario.banco.chamadasDe("pedir_lista_de_espera_pela_ia")).toEqual([
      expect.objectContaining({
        p_procedure_id: PROC.consulta,
        p_professional_id: PROF.bruno,
      }),
    ]);
  });
});

describe("o horário perdido (desenho 1.1.3)", () => {
  it("a reserva recusada porque o horário deixou de estar livre e a busca de novo sem horário: a lista é oferecida com o pedido da última busca", async () => {
    const cenario = new CenarioDaAg5();
    const r1 = await cenario.fala({
      texto: "Queria limpeza de pele com a Dra. Ana, quarta à tarde.",
      roteiro: [
        ferramenta(
          "buscar_horario",
          busca({ profissional: R_ANA, periodo: "tarde", a_partir_de: "2026-10-21" }),
        ),
        final("Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima. Pode ser?"),
      ],
    });
    expect(r1.tipo).toBe("resposta");
    const oferecido = saidas(cenario.corpos[1])[0] as {
      horarios?: { codigo: string; dia: string; hora: string }[];
    };
    const h = oferecido.horarios?.find((x) => x.dia === "quarta, 21/10" && x.hora === "14:00");
    expect(h).toBeDefined();
    // A recepcao marcou outra pessoa no mesmo horario, entre as mensagens.
    cenario.banco.inserir(
      "appointment",
      consultaDoContato({
        inicio: iso("2026-10-21", "14:00"),
        fim: iso("2026-10-21", "15:00"),
        vinculo: VINC.limpezaAna,
        profissional: PROF.ana,
      }),
    );
    const outra = cenario.banco.linhas("appointment").at(-1)!;
    outra.contact_id = "c1000000-0000-4000-8000-000000000099";
    const r2 = await cenario.fala({
      texto: "Pode ser",
      roteiro: [
        ferramenta("reservar_horario", { horario: h!.codigo }),
        ferramenta("buscar_horario", busca({ profissional: R_ANA, periodo: "noite" })),
        final(
          "Esse horário não está mais disponível e não tenho horário à noite com a Dra. Ana Lima. Posso procurar outro dia, ou colocar você na lista de espera. O que prefere?",
        ),
      ],
    });
    expect(r2.tipo).toBe("resposta");
    const r3 = await cenario.fala({
      texto: "Lista de espera, quarta à tarde.",
      roteiro: [
        ferramenta("pedir_lista_de_espera", { periodos: ["tarde"], dias: ["quarta"] }),
      ],
    });
    expect(r3.resposta).toBe(
      "Confirma a sua entrada na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à tarde, às quartas? Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp para ficar com ele.",
    );
  });
});

describe("a passagem pelo portão com a lista em andamento", () => {
  it("a nota conta o pedido e a pergunta sem a confirmação, mesmo antes do preparo", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    const r = await cenario.fala({
      texto: "Quero falar com uma pessoa",
      roteiro: [ferramenta("escalar_humano", { motivo: "pedido_humano" })],
    });
    expect(r.desfecho).toMatchObject({ tipo: "escalou", motivo: "pedido_humano" });
    expect(r.notaParaAEquipe).toContain(
      "Pedido: entrar na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas.",
    );
    expect(r.notaParaAEquipe).toContain(
      "A pergunta da lista de espera foi feita; a pessoa ainda não confirmou.",
    );
  });
});
