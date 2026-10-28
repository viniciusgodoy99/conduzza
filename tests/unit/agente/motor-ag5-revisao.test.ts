import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";

import {
  busca,
  CenarioDaAg5,
  P_CONSULTA,
  R_ANA,
  R_BRUNO,
  T_E1_ANA_NOITE_SEG_QUA,
  T_E2_ANA_NOITE_SEG_QUA,
} from "./ag5-conversa";
import { ferramenta, final, saidas } from "./ag4-conversa";
import { CLINICA, CONTATO, CONVERSA, PROC, PROF } from "./agenda-fixtures";

// Revisao independente da AG5 (28/10/2026), achado 3: a nota da passagem
// so diz "Pedido: entrar na lista de espera ..." quando a lista e o pedido
// VIVO do turno (a ultima ferramenta de agenda do turno foi uma das duas da
// lista, ou o turno nao chamou ferramenta de agenda e a resposta da pessoa
// veio logo depois da T-E1 ou da T-E2). A entrada de um turno anterior nao
// esconde a marcacao que veio depois dela (a reserva, os dados). Nenhum
// teste fala com a OpenAI.

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PEDIDO_DA_ENTRADA =
  "Pedido: entrar na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas.";

async function comAPergunta(cenario: CenarioDaAg5) {
  await cenario.fala({
    texto: "Queria limpeza de pele com a Dra. Ana, só à noite.",
    roteiro: [
      ferramenta("buscar_horario", busca({ profissional: R_ANA, periodo: "noite" })),
      final(
        "Não tenho horário à noite com a Dra. Ana Lima. Posso procurar de manhã ou à tarde, ou colocar você na lista de espera para à noite. O que prefere?",
      ),
    ],
  });
  const r = await cenario.fala({
    texto: "Lista de espera. Segunda ou quarta.",
    roteiro: [
      ferramenta("pedir_lista_de_espera", {
        periodos: ["noite"],
        dias: ["segunda", "quarta"],
      }),
    ],
  });
  expect(r.resposta).toBe(T_E1_ANA_NOITE_SEG_QUA);
}

async function naLista(cenario: CenarioDaAg5) {
  await comAPergunta(cenario);
  const r = await cenario.fala({
    texto: "Sim",
    roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
  });
  expect(r.resposta).toBe(T_E2_ANA_NOITE_SEG_QUA);
}

/**
 * Depois da entrada, a pessoa marca OUTRO procedimento: busca a consulta
 * com o Dr. Bruno na quinta a tarde e reserva quinta, 22/10 as 13:00.
 */
async function reservaDepoisDaEntrada(cenario: CenarioDaAg5) {
  await naLista(cenario);
  const r1 = await cenario.fala({
    texto: "Também quero marcar uma consulta com o Dr. Bruno, quinta à tarde.",
    roteiro: [
      ferramenta(
        "buscar_horario",
        busca({
          procedimento: P_CONSULTA,
          profissional: R_BRUNO,
          periodo: "tarde",
          a_partir_de: "2026-10-22",
        }),
      ),
      final("Tenho quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Pode ser?"),
    ],
  });
  expect(r1.tipo).toBe("resposta");
  const oferecido = saidas(cenario.corpos.at(-1))[0] as {
    horarios?: { codigo: string; dia: string; hora: string }[];
  };
  const h = oferecido.horarios?.find(
    (x) => x.dia === "quinta, 22/10" && x.hora === "13:00",
  );
  expect(h).toBeDefined();
  const r2 = await cenario.fala({
    texto: "Pode ser",
    roteiro: [
      ferramenta("reservar_horario", { horario: h!.codigo }),
      final(
        "Reservei quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual é o seu nome completo?",
      ),
    ],
  });
  expect(r2.tipo).toBe("resposta");
  expect(cenario.estado.slot_hold_id).not.toBeNull();
}

/** Depois da entrada, outro procedimento: a consulta com o Dr. Bruno, a noite (sem horario). */
async function consultaANoiteComOBruno(cenario: CenarioDaAg5) {
  const r = await cenario.fala({
    texto: "E uma consulta com o Dr. Bruno, à noite?",
    roteiro: [
      ferramenta(
        "buscar_horario",
        busca({ procedimento: P_CONSULTA, profissional: R_BRUNO, periodo: "noite" }),
      ),
      final(
        "Não tenho horário à noite com o Dr. Bruno Costa. Posso procurar à tarde, ou colocar você na lista de espera. O que prefere?",
      ),
    ],
  });
  expect(r.tipo).toBe("resposta");
}

describe("revisão da AG5 (achado 3): a nota só conta a lista quando ela é o pedido vivo do turno", () => {
  it("a entrada de antes não esconde a reserva de outra marcação: a nota de sempre (pela ferramenta, depois do preparo)", async () => {
    const cenario = new CenarioDaAg5();
    await reservaDepoisDaEntrada(cenario);
    const r = await cenario.fala({
      texto: "Antes de mandar o nome, tenho uma dúvida sobre a forma de pagamento.",
      roteiro: [ferramenta("escalar_humano", { motivo: "agente_pediu" })],
    });
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "agente_pediu",
      origem: "agente",
    });
    const nota = r.notaParaAEquipe ?? "";
    expect(nota).not.toContain("lista de espera");
    expect(nota).toContain("Pedido: marcar Consulta, com Dr. Bruno Costa, particular");
    expect(nota).toContain(
      "Horário reservado: quinta, 22/10 às 13:00, Dr. Bruno Costa (reserva de 10 minutos ainda valendo).",
    );
    expect(nota).toContain(
      "Dados para marcar: faltam o nome completo e a data de nascimento.",
    );
  });

  it("a entrada de antes não esconde a reserva: a nota de sempre (pelo portão, antes do preparo)", async () => {
    const cenario = new CenarioDaAg5();
    await reservaDepoisDaEntrada(cenario);
    const r = await cenario.fala({
      texto: "Estou com muita dor de cabeça desde ontem",
      roteiro: [final("não deveria ser chamado")],
    });
    expect(r.desfecho).toMatchObject({ tipo: "escalou", origem: "portao" });
    // Pelo portao o preparo nao roda (a reserva nao e relida, como antes da
    // AG5): a nota de sempre, com o pedido da marcacao e os dados.
    const nota = r.notaParaAEquipe ?? "";
    expect(nota).not.toContain("lista de espera");
    expect(nota).toContain("Pedido: marcar Consulta, com Dr. Bruno Costa, particular");
    expect(nota).toContain(
      "Dados para marcar: faltam o nome completo e a data de nascimento.",
    );
  });

  it("logo depois da T-E2, a nota conta a entrada (pelo portão também)", async () => {
    const cenario = new CenarioDaAg5();
    await naLista(cenario);
    const r = await cenario.fala({
      texto: "Estou com muita dor de cabeça desde ontem",
      roteiro: [final("não deveria ser chamado")],
    });
    expect(r.desfecho).toMatchObject({ tipo: "escalou", origem: "portao" });
    expect(r.notaParaAEquipe).toContain(PEDIDO_DA_ENTRADA);
    expect(r.notaParaAEquipe).toContain(
      "Entrou na lista de espera pelo assistente nesta conversa.",
    );
  });

  it("logo depois da T-E1, a nota conta a pergunta (pelo portão, pelo histórico)", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    const r = await cenario.fala({
      texto: "Estou com muita dor de cabeça desde ontem",
      roteiro: [final("não deveria ser chamado")],
    });
    expect(r.desfecho).toMatchObject({ tipo: "escalou", origem: "portao" });
    expect(r.notaParaAEquipe).toContain(PEDIDO_DA_ENTRADA);
    expect(r.notaParaAEquipe).toContain(
      "A pergunta da lista de espera foi feita; a pessoa ainda não confirmou.",
    );
  });

  it("com a conversa seguindo depois da T-E2 (outra resposta da IA no meio), a passagem sem ferramenta de agenda é a nota de sempre", async () => {
    const cenario = new CenarioDaAg5();
    await naLista(cenario);
    await cenario.fala({
      texto: "Obrigada! Vocês abrem no sábado?",
      roteiro: [final("Posso ajudar com mais alguma coisa sobre a clínica?")],
    });
    const r = await cenario.fala({
      texto: "Quero falar com uma pessoa",
      roteiro: [ferramenta("escalar_humano", { motivo: "pedido_humano" })],
    });
    expect(r.desfecho).toMatchObject({ tipo: "escalou", motivo: "pedido_humano" });
    expect(r.notaParaAEquipe ?? "").not.toContain("Pedido: entrar na lista de espera");
  });

  it("o pedido novo recusado depois de uma entrada: a nota conta o pedido novo, nunca a entrada antiga", async () => {
    const cenario = new CenarioDaAg5();
    await naLista(cenario);
    await consultaANoiteComOBruno(cenario);
    cenario.marcas.forcar = { pedir: "so_com_a_equipe" };
    const r = await cenario.fala({
      texto: "Lista de espera, às sextas.",
      roteiro: [
        ferramenta("pedir_lista_de_espera", { periodos: ["noite"], dias: ["sexta"] }),
      ],
    });
    expect(r.desfecho).toMatchObject({ tipo: "escalou", motivo: "pedido_de_agenda" });
    const nota = r.notaParaAEquipe ?? "";
    expect(nota).toContain(
      "Pedido: entrar na lista de espera para Consulta, com Dr. Bruno Costa, no particular, à noite, às sextas.",
    );
    expect(nota).toContain("Não entrou na lista de espera.");
    expect(nota).toContain(
      "Parou em: o procedimento, o profissional ou o convênio do pedido só é marcado pela equipe.",
    );
    expect(nota).not.toContain(PEDIDO_DA_ENTRADA);
  });

  it("a pergunta nova depois de uma entrada: a nota conta a pergunta nova (o pedido vivo vem antes da entrada relida)", async () => {
    const cenario = new CenarioDaAg5();
    await naLista(cenario);
    await consultaANoiteComOBruno(cenario);
    const r1 = await cenario.fala({
      texto: "Lista de espera, às sextas.",
      roteiro: [
        ferramenta("pedir_lista_de_espera", { periodos: ["noite"], dias: ["sexta"] }),
      ],
    });
    expect(r1.resposta).toBe(
      "Confirma a sua entrada na lista de espera para Consulta, com Dr. Bruno Costa, no particular, à noite, às sextas? Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp para ficar com ele.",
    );
    const r2 = await cenario.fala({
      texto: "Estou com muita dor de cabeça desde ontem",
      roteiro: [final("não deveria ser chamado")],
    });
    expect(r2.desfecho).toMatchObject({ tipo: "escalou", origem: "portao" });
    const nota = r2.notaParaAEquipe ?? "";
    expect(nota).toContain(
      "Pedido: entrar na lista de espera para Consulta, com Dr. Bruno Costa, no particular, à noite, às sextas.",
    );
    expect(nota).toContain(
      "A pergunta da lista de espera foi feita; a pessoa ainda não confirmou.",
    );
    expect(nota).not.toContain(PEDIDO_DA_ENTRADA);
  });
});

// Revisao da AG5, o contrato da frente de banco (secao "Revisao"):
//  - C1: ja_na_lista vale para qualquer entrada ATIVA do mesmo procedimento
//    (de outro profissional, de qualquer um) ou de qualquer procedimento, e
//    a `entrada` traz o procedimento dela. O fato e a trilha dizem a entrada
//    que JA existe, nunca o profissional do pedido; ao modelo, como antes,
//    so a preferencia;
//  - C4: o mesmo job de novo com a entrada dele fora da fila devolve
//    sem_pedido_de_espera, que o motor ja trata como falha fechada.
describe("revisão da AG5 (contrato C1): a entrada que já existe é a dela, nunca a do pedido", () => {
  const ENTRADA = "e1e1e1e1-0000-4000-8000-000000000001";

  /** Uma entrada da recepcao que ja existe para o contato. */
  function naFila(
    cenario: CenarioDaAg5,
    entrada: { procedure_id: string | null; professional_id: string | null },
  ) {
    cenario.banco.inserir("waitlist", {
      id: ENTRADA,
      clinic_id: CLINICA,
      contact_id: CONTATO,
      ...entrada,
      preferred_shifts: ["manha"],
      preferred_weekdays: [2],
      active: true,
      origem: "equipe",
    });
  }

  async function pedeALista(cenario: CenarioDaAg5, final_: string) {
    await cenario.fala({
      texto: "Queria limpeza de pele com a Dra. Ana, só à noite.",
      roteiro: [
        ferramenta("buscar_horario", busca({ profissional: R_ANA, periodo: "noite" })),
        final(
          "Não tenho horário à noite com a Dra. Ana Lima. Posso procurar de manhã ou à tarde, ou colocar você na lista de espera para à noite. O que prefere?",
        ),
      ],
    });
    return cenario.fala({
      texto: "Lista, segunda ou quarta.",
      roteiro: [
        ferramenta("pedir_lista_de_espera", {
          periodos: ["noite"],
          dias: ["segunda", "quarta"],
        }),
        final(final_),
      ],
    });
  }

  it("a entrada de outro profissional: ao modelo só a preferência; a frase com o profissional do pedido barra; a frase do procedimento passa", async () => {
    const barrada = new CenarioDaAg5();
    naFila(barrada, { procedure_id: PROC.limpeza, professional_id: PROF.bruno });
    const r1 = await pedeALista(
      barrada,
      "Você já está na lista de espera da limpeza de pele com a Dra. Ana Lima, de manhã, às terças.",
    );
    expect(saidas(barrada.corpos.at(-1))[0]).toEqual({
      resultado: "ja_na_lista",
      preferencia: "de manhã, às terças",
    });
    expect(r1.tipo).toBe("frase_fixa");
    expect(r1.desfecho).toMatchObject({ tipo: "bloqueou", camada: "regra" });
    expect(r1.trilha.map((p) => p.texto)).toContain(
      "Não pediu a lista de espera: a pessoa já está na lista de espera para esse pedido (Limpeza de pele, com Dr. Bruno Costa, de manhã, às terças)",
    );
    expect(barrada.pedidos).toEqual([]);

    const certa = new CenarioDaAg5();
    naFila(certa, { procedure_id: PROC.limpeza, professional_id: PROF.bruno });
    const r2 = await pedeALista(
      certa,
      "Você já está na lista de espera para esse procedimento, de manhã, às terças.",
    );
    expect(r2.tipo).toBe("resposta");
    expect(certa.fila).toHaveLength(1);
  });

  it("a entrada de qualquer profissional: nenhum nome passa (sem cair no profissional do pedido)", async () => {
    const cenario = new CenarioDaAg5();
    naFila(cenario, { procedure_id: PROC.limpeza, professional_id: null });
    const r = await pedeALista(
      cenario,
      "Você já está na lista de espera com a Dra. Ana Lima, de manhã, às terças.",
    );
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({ tipo: "bloqueou", camada: "regra" });
    expect(r.trilha.map((p) => p.texto)).toContain(
      "Não pediu a lista de espera: a pessoa já está na lista de espera para esse pedido (Limpeza de pele, com qualquer profissional, de manhã, às terças)",
    );
  });

  it("a entrada de qualquer procedimento: a trilha diz qualquer procedimento, e a frase da lista passa", async () => {
    const cenario = new CenarioDaAg5();
    naFila(cenario, { procedure_id: null, professional_id: null });
    const r = await pedeALista(
      cenario,
      "Você já está na lista de espera, de manhã, às terças.",
    );
    expect(r.tipo).toBe("resposta");
    expect(r.trilha.map((p) => p.texto)).toContain(
      "Não pediu a lista de espera: a pessoa já está na lista de espera para esse pedido (qualquer procedimento, com qualquer profissional, de manhã, às terças)",
    );
  });

  it("a leitura defensiva da entrada: o procedimento é texto, nulo ou ausente; outro tipo é fora do formato", async () => {
    const { lerRespostaDoPedidoDeEspera } = await import(
      "@/lib/agente/ferramentas/lista-de-espera"
    );
    const base = { ok: false, motivo: "ja_na_lista" };
    const entrada = { profissional: "Dr. Bruno Costa", turnos: ["manha"], dias: [2] };
    expect(
      lerRespostaDoPedidoDeEspera({
        ...base,
        entrada: { ...entrada, procedimento: "Limpeza de pele" },
      }),
    ).toEqual({
      ...base,
      entrada: { ...entrada, procedimento: "Limpeza de pele" },
    });
    expect(
      lerRespostaDoPedidoDeEspera({ ...base, entrada: { ...entrada, procedimento: null } }),
    ).toEqual({ ...base, entrada: { ...entrada, procedimento: null } });
    expect(lerRespostaDoPedidoDeEspera({ ...base, entrada })).toEqual({
      ...base,
      entrada,
    });
    expect(
      lerRespostaDoPedidoDeEspera({ ...base, entrada: { ...entrada, procedimento: 7 } }),
    ).toEqual({ ...base, entrada: null });
  });
});

describe("revisão da AG5 (contrato C4): o mesmo job com a entrada fora da fila", () => {
  it("o contrato devolve sem_pedido_de_espera, e o motor falha fechado sem a T-E2", async () => {
    const cenario = new CenarioDaAg5();
    await naLista(cenario);
    const entrada = cenario.fila[0]!;
    // A recepcao removeu a entrada entre as tentativas do mesmo job.
    entrada.active = false;
    const rpc = cenario.banco.manipuladores.get("entrar_na_lista_de_espera_pela_ia")!;
    const repetido = await rpc({
      p_clinic_id: CLINICA,
      p_conversation_id: CONVERSA,
      p_job_id: entrada.ia_job_id,
    });
    expect(repetido.data).toEqual({ ok: false, motivo: "sem_pedido_de_espera" });
    const { lerRespostaDaEntradaNaEspera } = await import(
      "@/lib/agente/ferramentas/lista-de-espera"
    );
    expect(lerRespostaDaEntradaNaEspera(repetido.data)).toEqual({
      ok: false,
      motivo: "sem_pedido_de_espera",
    });
  });

  it("sem_pedido_de_espera na fase 2: falha fechada (a frase fixa da equipe, nunca a T-E2), nada entra, e a trilha diz o porquê", async () => {
    const cenario = new CenarioDaAg5();
    await comAPergunta(cenario);
    cenario.marcas.forcar = { entrar: "sem_pedido_de_espera" };
    const r = await cenario.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "desconhecida" });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(cenario.fila).toEqual([]);
    expect(r.trilha.map((p) => p.texto)).toContain(
      "Não colocou na lista de espera: não havia pedido de lista de espera para cumprir nesta conversa (ou a entrada desta resposta já saiu da lista).",
    );
  });
});
