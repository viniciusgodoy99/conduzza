import { describe, expect, it } from "vitest";

import {
  agruparAtividades,
  atalhosDePrazo,
  contarPendencias,
  criarAtividadeSchema,
  editarAtividadeSchema,
  ehAtrasada,
  ehDiaValido,
  ehParaHoje,
  filtrarAtividades,
  formularioDeAtividadeSchema,
  grupoDePrazo,
  hojeNaClinica,
  lerFiltrosDeAtividades,
  mensagemDoErroDeAtividade,
  prazoAdiado,
  prazoParaGravar,
  problemaNoPrazoNovo,
  situacaoDaAtividade,
  textoDoPrazo,
  type FiltrosDeAtividades,
  type StatusDaAtividade,
} from "@/lib/domain/atividades";
import { lerContagemDeAtividades } from "@/lib/queries/atividades";

// Atividades (contact_activity): o predicado de atrasada e de "para hoje" e o
// ESPELHO do SQL de contagem_de_atividades (atrasada = coalesce(due_at <
// now(), due_on < hoje); hoje = due_on = hoje e nao atrasada), sempre com o
// "hoje" no fuso da clinica (regra 3.6). Aqui tambem: agrupamento, filtros
// da URL, texto do prazo, Zod e traducao dos erros do banco.

const FORTALEZA = "America/Fortaleza"; // UTC-3, sem horario de verao
const SAO_PAULO = "America/Sao_Paulo";

// 02/10/2026 as 15:00 em Fortaleza = 18:00 UTC.
const AGORA = new Date("2026-10-02T18:00:00.000Z");
const HOJE = "2026-10-02";
const EU = "00000000-0000-4000-8000-000000000001";
const OUTRA = "00000000-0000-4000-8000-000000000002";
const CONTATO_A = "00000000-0000-4000-8000-0000000000aa";
const CONTATO_B = "00000000-0000-4000-8000-0000000000bb";

let seq = 0;
function atividade(
  parcial: Partial<{
    status: StatusDaAtividade;
    due_on: string;
    due_at: string | null;
    assignee_user_id: string | null;
    contact_id: string;
    titulo: string;
    completed_at: string | null;
    nome: string | null;
    telefone: string;
  }> = {},
) {
  seq += 1;
  return {
    id: `id-${String(seq).padStart(3, "0")}`,
    created_at: `2026-09-01T00:00:${String(seq % 60).padStart(2, "0")}.000Z`,
    status: parcial.status ?? ("pendente" as StatusDaAtividade),
    due_on: parcial.due_on ?? HOJE,
    due_at: parcial.due_at ?? null,
    assignee_user_id:
      parcial.assignee_user_id === undefined ? EU : parcial.assignee_user_id,
    contact_id: parcial.contact_id ?? CONTATO_A,
    titulo: parcial.titulo ?? "Ligar para lembrar do retorno",
    completed_at: parcial.completed_at ?? null,
    contato: {
      nome: parcial.nome === undefined ? "Maria Clara" : parcial.nome,
      telefone: parcial.telefone ?? "+5585999990000",
    },
  };
}

describe("predicado de atrasada e de hoje (espelho do SQL)", () => {
  it("sem hora: atrasada só quando o dia já passou na clínica", () => {
    expect(ehAtrasada(atividade({ due_on: "2026-10-01" }), AGORA, HOJE)).toBe(
      true,
    );
    expect(ehAtrasada(atividade({ due_on: HOJE }), AGORA, HOJE)).toBe(false);
    expect(ehParaHoje(atividade({ due_on: HOJE }), AGORA, HOJE)).toBe(true);
  });

  it("com hora: a de hoje cuja hora passou é atrasada, e não é de hoje", () => {
    // 14:00 em Fortaleza = 17:00 UTC, antes das 15:00 locais.
    const passou = atividade({
      due_on: HOJE,
      due_at: "2026-10-02T17:00:00.000Z",
    });
    expect(ehAtrasada(passou, AGORA, HOJE)).toBe(true);
    expect(ehParaHoje(passou, AGORA, HOJE)).toBe(false);
    // 16:00 local ainda por vir.
    const vem = atividade({ due_on: HOJE, due_at: "2026-10-02T19:00:00.000Z" });
    expect(ehAtrasada(vem, AGORA, HOJE)).toBe(false);
    expect(ehParaHoje(vem, AGORA, HOJE)).toBe(true);
  });

  it("com hora, o instante manda (coalesce do SQL), não o dia", () => {
    // Dia ja passado mas hora no futuro (fuso trocado depois): nao atrasada.
    const estranha = atividade({
      due_on: "2026-10-01",
      due_at: "2026-10-02T20:00:00.000Z",
    });
    expect(ehAtrasada(estranha, AGORA, HOJE)).toBe(false);
  });

  it("só pendente conta", () => {
    for (const status of ["concluida", "cancelada"] as const) {
      const a = atividade({ status, due_on: "2026-09-01" });
      expect(ehAtrasada(a, AGORA, HOJE)).toBe(false);
      expect(ehParaHoje(atividade({ status }), AGORA, HOJE)).toBe(false);
    }
  });

  it("hoje é o dia civil da clínica, não o do UTC", () => {
    // 01:30 UTC de 03/10 ainda e 22:30 de 02/10 em Fortaleza.
    const tarde = new Date("2026-10-03T01:30:00.000Z");
    expect(hojeNaClinica(FORTALEZA, tarde)).toBe("2026-10-02");
    expect(hojeNaClinica("UTC", tarde)).toBe("2026-10-03");
  });

  it("contarPendencias não soma a mesma atividade nas duas", () => {
    const lista = [
      atividade({ due_on: "2026-09-30" }),
      atividade({ due_on: HOJE, due_at: "2026-10-02T17:00:00.000Z" }),
      atividade({ due_on: HOJE }),
      atividade({ due_on: "2026-10-05" }),
      atividade({ due_on: "2026-09-30", status: "concluida" }),
    ];
    expect(contarPendencias(lista, AGORA, HOJE)).toEqual({
      atrasadas: 2,
      hoje: 1,
    });
  });

  it("situacao para o chip", () => {
    expect(
      situacaoDaAtividade(atividade({ due_on: "2026-09-30" }), AGORA, HOJE),
    ).toBe("atrasada");
    expect(situacaoDaAtividade(atividade({}), AGORA, HOJE)).toBe("hoje");
    expect(
      situacaoDaAtividade(atividade({ due_on: "2026-10-09" }), AGORA, HOJE),
    ).toBe("pendente");
    expect(
      situacaoDaAtividade(atividade({ status: "concluida" }), AGORA, HOJE),
    ).toBe("concluida");
    expect(
      situacaoDaAtividade(atividade({ status: "cancelada" }), AGORA, HOJE),
    ).toBe("cancelada");
  });
});

describe("agrupamento por prazo", () => {
  it("Atrasadas, Hoje, Amanhã, Próximos 7 dias e Depois", () => {
    expect(grupoDePrazo(atividade({ due_on: "2026-09-29" }), AGORA, HOJE)).toBe(
      "atrasadas",
    );
    expect(grupoDePrazo(atividade({ due_on: HOJE }), AGORA, HOJE)).toBe("hoje");
    expect(grupoDePrazo(atividade({ due_on: "2026-10-03" }), AGORA, HOJE)).toBe(
      "amanha",
    );
    expect(grupoDePrazo(atividade({ due_on: "2026-10-09" }), AGORA, HOJE)).toBe(
      "proximos_7_dias",
    );
    expect(grupoDePrazo(atividade({ due_on: "2026-10-10" }), AGORA, HOJE)).toBe(
      "depois",
    );
    expect(
      grupoDePrazo(atividade({ status: "concluida" }), AGORA, HOJE),
    ).toBeNull();
  });

  it("grupos na ordem da tela, sem vazio, e por prazo dentro do grupo", () => {
    const semHora = atividade({ due_on: HOJE, titulo: "sem hora" });
    const comHora = atividade({
      due_on: HOJE,
      due_at: "2026-10-02T21:00:00.000Z",
      titulo: "com hora",
    });
    const depois = atividade({ due_on: "2026-12-01" });
    const atrasada = atividade({ due_on: "2026-09-10" });
    const grupos = agruparAtividades(
      [semHora, depois, comHora, atrasada],
      AGORA,
      HOJE,
    );
    expect(grupos.map((g) => g.chave)).toEqual(["atrasadas", "hoje", "depois"]);
    expect(grupos[1]!.itens.map((a) => a.titulo)).toEqual([
      "com hora",
      "sem hora",
    ]);
  });

  it("concluídas num grupo só, da mais recente para a mais antiga", () => {
    const velha = atividade({
      status: "concluida",
      completed_at: "2026-09-20T12:00:00.000Z",
    });
    const nova = atividade({
      status: "concluida",
      completed_at: "2026-10-01T12:00:00.000Z",
    });
    const grupos = agruparAtividades([velha, nova], AGORA, HOJE);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.chave).toBe("concluidas");
    expect(grupos[0]!.itens.map((a) => a.id)).toEqual([nova.id, velha.id]);
  });
});

describe("filtros da tela", () => {
  const padrao: FiltrosDeAtividades = {
    quem: "minhas",
    situacao: "pendentes",
    responsavel: null,
    busca: "",
    contato: null,
  };

  it("lê a URL e cai no padrão com valor desconhecido", () => {
    const params = new URLSearchParams(
      "quem=todas&filtro=atrasadas&resp=sem&busca=maria&contato=" + CONTATO_A,
    );
    expect(lerFiltrosDeAtividades(params)).toEqual({
      quem: "todas",
      situacao: "atrasadas",
      responsavel: "sem",
      busca: "maria",
      contato: CONTATO_A,
    });
    expect(
      lerFiltrosDeAtividades(
        new URLSearchParams("quem=x&filtro=y&resp=z&contato=nao-e-uuid"),
      ),
    ).toEqual(padrao);
  });

  it("Minhas é o responsável igual a quem usa", () => {
    const minha = atividade({});
    const dela = atividade({ assignee_user_id: OUTRA });
    const sem = atividade({ assignee_user_id: null });
    const contexto = { eu: EU, agora: AGORA, hoje: HOJE };
    expect(filtrarAtividades([minha, dela, sem], padrao, contexto)).toEqual([
      minha,
    ]);
    expect(
      filtrarAtividades(
        [minha, dela, sem],
        { ...padrao, quem: "todas" },
        contexto,
      ),
    ).toHaveLength(3);
    expect(
      filtrarAtividades(
        [minha, dela, sem],
        { ...padrao, quem: "todas", responsavel: "sem" },
        contexto,
      ),
    ).toEqual([sem]);
    expect(
      filtrarAtividades(
        [minha, dela, sem],
        { ...padrao, quem: "todas", responsavel: OUTRA },
        contexto,
      ),
    ).toEqual([dela]);
  });

  it("situações: atrasadas, hoje, próximas e concluídas", () => {
    const atrasada = atividade({ due_on: "2026-09-30" });
    const hoje = atividade({ due_on: HOJE });
    const proxima = atividade({ due_on: "2026-10-04" });
    const feita = atividade({ status: "concluida" });
    const cancelada = atividade({ status: "cancelada" });
    const lista = [atrasada, hoje, proxima, feita, cancelada];
    const contexto = { eu: EU, agora: AGORA, hoje: HOJE };
    const com = (situacao: FiltrosDeAtividades["situacao"]) =>
      filtrarAtividades(lista, { ...padrao, situacao }, contexto);
    expect(com("pendentes")).toEqual([atrasada, hoje, proxima]);
    expect(com("atrasadas")).toEqual([atrasada]);
    expect(com("hoje")).toEqual([hoje]);
    expect(com("proximas")).toEqual([proxima]);
    expect(com("concluidas")).toEqual([feita]);
  });

  it("busca por nome sem acento, pedaço de telefone ou texto, e por contato", () => {
    const maria = atividade({ nome: "Márcia Souza", contact_id: CONTATO_A });
    const joao = atividade({
      nome: null,
      telefone: "+5585988887777",
      contact_id: CONTATO_B,
      titulo: "Enviar orçamento",
    });
    const contexto = { eu: EU, agora: AGORA, hoje: HOJE };
    const buscar = (busca: string) =>
      filtrarAtividades([maria, joao], { ...padrao, busca }, contexto);
    expect(buscar("marcia")).toEqual([maria]);
    expect(buscar("8888-7777")).toEqual([joao]);
    expect(buscar("orcamento")).toEqual([joao]);
    expect(buscar("12")).toEqual([]);
    expect(
      filtrarAtividades(
        [maria, joao],
        { ...padrao, contato: CONTATO_B },
        contexto,
      ),
    ).toEqual([joao]);
  });
});

describe("prazo no fuso da clínica", () => {
  it("texto: Hoje, Amanhã, Ontem, dd/mm e o ano quando muda", () => {
    expect(textoDoPrazo({ due_on: HOJE, due_at: null }, HOJE, FORTALEZA)).toBe(
      "Hoje",
    );
    expect(
      textoDoPrazo(
        { due_on: HOJE, due_at: "2026-10-02T17:00:00.000Z" },
        HOJE,
        FORTALEZA,
      ),
    ).toBe("Hoje, 14:00");
    expect(
      textoDoPrazo({ due_on: "2026-10-03", due_at: null }, HOJE, FORTALEZA),
    ).toBe("Amanhã");
    expect(
      textoDoPrazo({ due_on: "2026-10-01", due_at: null }, HOJE, FORTALEZA),
    ).toBe("Ontem");
    expect(
      textoDoPrazo({ due_on: "2026-12-01", due_at: null }, HOJE, FORTALEZA),
    ).toBe("01/12");
    expect(
      textoDoPrazo({ due_on: "2027-01-15", due_at: null }, HOJE, FORTALEZA),
    ).toBe("15/01/2027");
  });

  it("atalhos contam de hoje na clínica", () => {
    expect(atalhosDePrazo(HOJE).map((a) => [a.rotulo, a.dia])).toEqual([
      ["Amanhã", "2026-10-03"],
      ["Em 7 dias", "2026-10-09"],
      ["Em 30 dias", "2026-11-01"],
    ]);
  });

  it("gravar: sem hora só o dia; com hora o instante UTC da hora local", () => {
    expect(prazoParaGravar(FORTALEZA, "2026-12-01", null)).toEqual({
      due_on: "2026-12-01",
      due_at: null,
    });
    expect(prazoParaGravar(FORTALEZA, "2026-12-01", "14:30")).toEqual({
      due_on: "2026-12-01",
      due_at: "2026-12-01T17:30:00.000Z",
    });
  });

  it("adiar conta de hoje e mantém a hora local", () => {
    expect(prazoAdiado({ due_at: null }, 7, HOJE, FORTALEZA)).toEqual({
      due_on: "2026-10-09",
    });
    expect(
      prazoAdiado({ due_at: "2026-09-20T12:15:00.000Z" }, 1, HOJE, FORTALEZA),
    ).toEqual({ due_on: "2026-10-03", due_at: "2026-10-03T12:15:00.000Z" });
  });

  it("prazo novo: nunca no passado, nem hora de hoje que já foi", () => {
    expect(problemaNoPrazoNovo("2026-10-01", null, AGORA, FORTALEZA)).toBe(
      "Escolha hoje ou um dia depois.",
    );
    expect(problemaNoPrazoNovo(HOJE, "14:00", AGORA, FORTALEZA)).toContain(
      "já passou",
    );
    expect(problemaNoPrazoNovo(HOJE, "16:00", AGORA, FORTALEZA)).toBeNull();
    expect(problemaNoPrazoNovo(HOJE, null, AGORA, FORTALEZA)).toBeNull();
    // Em Sao Paulo, a mesma hora UTC e outro relogio (UTC-3 tambem em 2026).
    expect(problemaNoPrazoNovo(HOJE, "16:00", AGORA, SAO_PAULO)).toBeNull();
  });
});

describe("validação (Zod)", () => {
  const base = {
    contact_id: CONTATO_A,
    titulo: "  Ligar  ",
    detalhes: "   ",
    dia: "2026-12-01",
    hora: null,
    assignee_user_id: EU,
  };

  it("apara o título, e detalhes em branco viram null", () => {
    const resultado = criarAtividadeSchema.parse(base);
    expect(resultado.titulo).toBe("Ligar");
    expect(resultado.detalhes).toBeNull();
    expect(resultado.hora).toBeNull();
  });

  it("recusa título curto, dia que não existe e hora fora do formato", () => {
    expect(
      criarAtividadeSchema.safeParse({ ...base, titulo: " a " }).success,
    ).toBe(false);
    expect(
      criarAtividadeSchema.safeParse({ ...base, dia: "2026-02-31" }).success,
    ).toBe(false);
    expect(
      criarAtividadeSchema.safeParse({ ...base, hora: "25:00" }).success,
    ).toBe(false);
    expect(
      criarAtividadeSchema.safeParse({ ...base, titulo: "x".repeat(121) })
        .success,
    ).toBe(false);
    expect(
      criarAtividadeSchema.safeParse({ ...base, contact_id: "abc" }).success,
    ).toBe(false);
  });

  it("não aceita status, origem nem autoria vindos do cliente", () => {
    const resultado = criarAtividadeSchema.parse({
      ...base,
      status: "concluida",
      origem: "automacao",
      created_by: OUTRA,
    });
    expect(resultado).not.toHaveProperty("status");
    expect(resultado).not.toHaveProperty("origem");
    expect(resultado).not.toHaveProperty("created_by");
  });

  it("edição e formulário", () => {
    expect(
      editarAtividadeSchema.safeParse({ ...base, id: CONTATO_B }).success,
    ).toBe(true);
    expect(
      formularioDeAtividadeSchema.safeParse({
        titulo: "Ligar",
        detalhes: "",
        dia: "2026-12-01",
        hora: "",
        responsavel: "__sem__",
      }).success,
    ).toBe(true);
    expect(ehDiaValido("2028-02-29")).toBe(true);
    expect(ehDiaValido("2027-02-29")).toBe(false);
  });
});

describe("erros do banco em linguagem de recepção", () => {
  it("traduz pelo código", () => {
    const padrao = "Não foi possível salvar.";
    expect(mensagemDoErroDeAtividade({ code: "42501" }, padrao)).toBe(
      "Seu perfil não pode alterar atividades.",
    );
    expect(mensagemDoErroDeAtividade({ code: "P0001" }, padrao)).toBe(
      "Contato não encontrado nesta clínica.",
    );
    expect(
      mensagemDoErroDeAtividade(
        {
          code: "23514",
          message:
            "O responsável precisa ser alguém ativo da equipe desta clínica.",
        },
        padrao,
      ),
    ).toContain("responsável");
    expect(
      mensagemDoErroDeAtividade(
        { code: "23514", message: "A conversa informada não é deste contato." },
        padrao,
      ),
    ).toBe("A conversa escolhida não é deste contato.");
    expect(
      mensagemDoErroDeAtividade(
        { code: "23514", message: "violates check constraint" },
        padrao,
      ),
    ).toBe("Confira os campos e tente de novo.");
    expect(mensagemDoErroDeAtividade({ code: "XX000" }, padrao)).toBe(padrao);
    expect(mensagemDoErroDeAtividade(null, padrao)).toBe(padrao);
  });
});

describe("contagem_de_atividades", () => {
  it("aceita os quatro inteiros", () => {
    expect(
      lerContagemDeAtividades({
        atrasadas: 3,
        hoje: 5,
        minhas_atrasadas: 1,
        minhas_hoje: 2,
      }),
    ).toEqual({ atrasadas: 3, hoje: 5, minhas_atrasadas: 1, minhas_hoje: 2 });
  });

  it("resposta fora do formato lança, nunca vira zero", () => {
    expect(() => lerContagemDeAtividades(null)).toThrow();
    expect(() =>
      lerContagemDeAtividades({ atrasadas: 1, hoje: 2, minhas_atrasadas: 0 }),
    ).toThrow();
    expect(() =>
      lerContagemDeAtividades({
        atrasadas: "1",
        hoje: 2,
        minhas_atrasadas: 0,
        minhas_hoje: 0,
      }),
    ).toThrow();
  });
});
