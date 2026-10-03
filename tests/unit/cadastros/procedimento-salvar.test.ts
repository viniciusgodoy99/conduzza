import { describe, expect, it, vi } from "vitest";

// Convenio pelo profissional (decisao do dono em 02/10/2026), no modal do
// Procedimento: a ORDEM de gravacao do Salvar (critica §3.4) e os textos da
// tela. As actions sao dubladas (o comportamento delas e da RPC esta nos
// testes de integracao); aqui interessa o que a tela chama, em que ordem e
// com quais extras, e o que ela faz com cada resposta.
//   - editar: a sincronia vem ANTES da linha do procedimento, com confirmar
//     false; o aviso de consulta futura (D4) nao grava nada e o "Salvar
//     mesmo assim" refaz com confirmar true; CZ409 recarrega (D5);
//   - criar: a linha primeiro, depois a sincronia sem nada na abertura.

// A tela importa as Server Actions; o modulo real fala com o Supabase do
// servidor. O teste injeta as acoes em gravarProcedimento.
vi.mock("@/app/(app)/cadastros/actions", () => ({
  salvarProcedimentoAction: vi.fn(),
  sincronizarVinculosDoProcedimentoAction: vi.fn(),
}));

import type {
  CadastroActionResult,
  ResultadoDosVinculosDoProcedimento,
} from "@/app/(app)/cadastros/actions";
import {
  AJUDA_DE_QUEM_FAZ,
  AJUDA_DOS_CONVENIOS_QUE_COBREM,
  SO_PARTICULAR,
  VAZIO_DOS_CONVENIOS_QUE_COBREM,
  fraseDeQuemNaoAtende,
  fraseDoConvenioQueSai,
  gravarProcedimento,
  tituloDoAvisoDosVinculos,
  type AcoesDoSalvar,
  type PedidoDeSalvar,
} from "@/components/cadastros/procedimentos-tab";
import { MENSAGEM_CADASTRO_MUDOU } from "@/lib/domain/convenios-do-medico";
import {
  ajusteNovo,
  desmarcarPlano,
  linhasDosVinculos,
  precisaSincronizarVinculos,
  vinculosDasLinhas,
  type AberturaComPlanos,
  type PadraoDoProcedimento,
  type VinculoGravado,
} from "@/lib/domain/vinculos-do-procedimento";

const TRAVESSAO = /[–—]/u;

const PROC = "proc-endo";
const NOVO = "proc-novo";
const JOAO = "prof-joao";
const ANA = "prof-ana";
const UNIMED = "conv-unimed";
const BRADESCO = "conv-bradesco";
const ORDEM = [UNIMED, BRADESCO];

const ENDO: PadraoDoProcedimento = { basePriceCents: 40000, durationMin: 40 };

const NOMES = {
  profissional: (id: string) =>
    ({ [JOAO]: "Dr. João", [ANA]: "Dra. Ana" })[id] ?? "Profissional",
  convenio: (id: string | null) =>
    id === null
      ? "Particular"
      : ({ [UNIMED]: "Unimed", [BRADESCO]: "Bradesco Saúde" }[id] ??
        "Convênio"),
};

function vinculo(parcial: Partial<VinculoGravado>): VinculoGravado {
  return {
    professional_id: JOAO,
    procedure_id: PROC,
    insurance_id: null,
    price_cents: 40000,
    covered_by_insurance: false,
    duration_min: 40,
    active: true,
    ...parcial,
  };
}

// Abertura: Unimed cobre (gravado). Joao faz Particular e Unimed; Ana so
// Particular (a Unimed e a excecao dela).
const GRAVADOS: VinculoGravado[] = [
  vinculo({ professional_id: JOAO }),
  vinculo({
    professional_id: JOAO,
    insurance_id: UNIMED,
    price_cents: null,
    covered_by_insurance: true,
  }),
  vinculo({ professional_id: ANA }),
];
const LINHAS = linhasDosVinculos(GRAVADOS, PROC, ENDO, [JOAO, ANA], ORDEM);
const ABERTURA: AberturaComPlanos = {
  linhas: LINHAS,
  padrao: ENDO,
  iaPodeAgendar: true,
  planos: [UNIMED],
  planosGravados: [UNIMED],
};

const CAMPOS = {
  name: "Consulta endocrinologia",
  description: null,
  default_duration_min: 40,
  base_price_cents: 40000,
  requires_evaluation: false,
  prep_instructions: null,
  bookable_by_ai: true,
  active: true,
};

function pedido(parcial: Partial<PedidoDeSalvar> = {}): PedidoDeSalvar {
  const agora = parcial.agora ?? {
    linhas: LINHAS,
    padrao: ENDO,
    iaPodeAgendar: true,
    planos: [UNIMED],
  };
  const conferido = vinculosDasLinhas(agora.linhas, agora.padrao, NOMES, [
    ...agora.planos,
  ]);
  if (!conferido.ok) {
    throw new Error(conferido.erro);
  }
  return {
    id: PROC,
    campos: CAMPOS,
    vinculos: conferido.vinculos,
    agora,
    abertura: ABERTURA,
    confirmar: false,
    ...parcial,
  };
}

// Tirar a Unimed de "cobrem": Joao perde o vinculo Unimed.
const SEM_UNIMED = desmarcarPlano({ planos: [UNIMED], linhas: LINHAS }, UNIMED);
const AGORA_SEM_UNIMED = {
  linhas: SEM_UNIMED.linhas,
  padrao: ENDO,
  iaPodeAgendar: true,
  planos: SEM_UNIMED.planos,
};

type Chamada =
  | { acao: "salvarProcedimento"; input: unknown }
  | {
      acao: "sincronizar";
      procedureId: unknown;
      linhas: unknown;
      extras: unknown;
    };

function dublê(respostas: {
  salvar?: CadastroActionResult[];
  sincronizar?: ResultadoDosVinculosDoProcedimento[];
}) {
  const chamadas: Chamada[] = [];
  const salvar = [...(respostas.salvar ?? [])];
  const sincronizar = [...(respostas.sincronizar ?? [])];
  const acoes: AcoesDoSalvar = {
    salvarProcedimento: async (input) => {
      chamadas.push({ acao: "salvarProcedimento", input });
      const resposta = salvar.shift();
      if (!resposta) {
        throw new Error("salvarProcedimento chamado sem resposta prevista");
      }
      return resposta;
    },
    sincronizar: async (procedureId, linhas, extras) => {
      chamadas.push({ acao: "sincronizar", procedureId, linhas, extras });
      const resposta = sincronizar.shift();
      if (!resposta) {
        throw new Error("sincronizar chamado sem resposta prevista");
      }
      return resposta;
    },
  };
  return { acoes, chamadas };
}

const SINCRONIA_OK: ResultadoDosVinculosDoProcedimento = {
  ok: true,
  id: PROC,
  resumo: {
    criados: 0,
    reativados: 0,
    atualizados: 0,
    desativados: 1,
    consultasFuturas: 0,
    primeiraConsulta: null,
    planosEntram: [],
    planosSaem: [UNIMED],
  },
};

describe("Salvar do procedimento ao editar", () => {
  it("sem mudança em quem faz nem em cobrem: só a linha do procedimento", async () => {
    const { acoes, chamadas } = dublê({ salvar: [{ ok: true, id: PROC }] });
    const desfecho = await gravarProcedimento(pedido(), acoes);
    expect(chamadas).toEqual([
      { acao: "salvarProcedimento", input: { id: PROC, ...CAMPOS } },
    ]);
    expect(desfecho).toEqual({
      tipo: "salvo",
      id: PROC,
      criado: false,
      desativados: 0,
      consultasFuturas: 0,
    });
  });

  it("com mudança: a sincronia vem antes da linha, com a abertura crua e confirmar false", async () => {
    const { acoes, chamadas } = dublê({
      sincronizar: [SINCRONIA_OK],
      salvar: [{ ok: true, id: PROC }],
    });
    const desfecho = await gravarProcedimento(
      pedido({ agora: AGORA_SEM_UNIMED }),
      acoes,
    );
    expect(chamadas.map((c) => c.acao)).toEqual([
      "sincronizar",
      "salvarProcedimento",
    ]);
    const sincronia = chamadas[0];
    expect(sincronia).toMatchObject({
      acao: "sincronizar",
      procedureId: PROC,
      extras: {
        planos: [],
        vinculosNaAbertura: [
          { professional_id: JOAO, insurance_id: null },
          { professional_id: JOAO, insurance_id: UNIMED },
          { professional_id: ANA, insurance_id: null },
        ],
        planosNaAbertura: [UNIMED],
        confirmar: false,
      },
    });
    // Joao sai da Unimed: so os Particulares vao na lista.
    expect(
      (sincronia as { linhas: { insurance_id: string | null }[] }).linhas.map(
        (l) => l.insurance_id,
      ),
    ).toEqual([null, null]);
    expect(desfecho).toMatchObject({
      tipo: "salvo",
      criado: false,
      desativados: 1,
    });
  });

  it("consulta futura em combinação que sai: aviso, e nada mais é chamado (D4)", async () => {
    const { acoes, chamadas } = dublê({
      sincronizar: [
        {
          ok: false,
          code: "consultas_no_periodo",
          motivo: "vinculos",
          consultas: 2,
          primeiraConsulta: "2026-10-05T12:00:00.000Z",
        },
      ],
    });
    const desfecho = await gravarProcedimento(
      pedido({ agora: AGORA_SEM_UNIMED }),
      acoes,
    );
    expect(desfecho).toEqual({
      tipo: "aviso",
      consultas: 2,
      primeira: "2026-10-05T12:00:00.000Z",
    });
    expect(chamadas.map((c) => c.acao)).toEqual(["sincronizar"]);
  });

  it("Salvar mesmo assim reenvia com confirmar true e depois grava a linha", async () => {
    const { acoes, chamadas } = dublê({
      sincronizar: [
        {
          ...SINCRONIA_OK,
          resumo: { ...SINCRONIA_OK.resumo!, consultasFuturas: 2 },
        },
      ],
      salvar: [{ ok: true, id: PROC }],
    });
    const desfecho = await gravarProcedimento(
      pedido({ agora: AGORA_SEM_UNIMED, confirmar: true }),
      acoes,
    );
    expect(chamadas[0]).toMatchObject({ extras: { confirmar: true } });
    expect(chamadas[1]).toMatchObject({ acao: "salvarProcedimento" });
    expect(desfecho).toMatchObject({ tipo: "salvo", consultasFuturas: 2 });
  });

  it("aba parada (CZ409): erro do servidor, recarrega e não grava a linha (D5)", async () => {
    const { acoes, chamadas } = dublê({
      sincronizar: [
        { ok: false, code: "cadastro_mudou", error: MENSAGEM_CADASTRO_MUDOU },
      ],
    });
    const desfecho = await gravarProcedimento(
      pedido({ agora: AGORA_SEM_UNIMED }),
      acoes,
    );
    expect(desfecho).toEqual({
      tipo: "erro",
      erro: MENSAGEM_CADASTRO_MUDOU,
      recarregar: true,
    });
    expect(chamadas.map((c) => c.acao)).toEqual(["sincronizar"]);
  });

  it("qualquer erro da sincronia recarrega (o 23514 de quem não atende pede dados novos)", async () => {
    const erro =
      "Um profissional não atende um dos convênios marcados. Feche, abra de novo e salve.";
    const { acoes } = dublê({ sincronizar: [{ ok: false, error: erro }] });
    expect(
      await gravarProcedimento(pedido({ agora: AGORA_SEM_UNIMED }), acoes),
    ).toEqual({ tipo: "erro", erro, recarregar: true });
  });

  it("a linha falha depois da sincronia: diz o que foi salvo e devolve a abertura nova", async () => {
    const { acoes } = dublê({
      sincronizar: [SINCRONIA_OK],
      salvar: [{ ok: false, error: "Não foi possível salvar." }],
    });
    const desfecho = await gravarProcedimento(
      pedido({ agora: AGORA_SEM_UNIMED }),
      acoes,
    );
    expect(desfecho).toMatchObject({
      tipo: "erro",
      erro: "Quem faz e os convênios foram salvos, mas os dados do procedimento não. Clique em Salvar de novo.",
      recarregar: true,
    });
    if (desfecho.tipo !== "erro" || !desfecho.abertura) {
      throw new Error("esperava a abertura nova");
    }
    expect(desfecho.abertura.planosGravados).toEqual([]);
    expect(desfecho.abertura.linhas).toEqual(SEM_UNIMED.linhas);
    // O proximo Salvar, sem mexer em nada, nao reenvia a sincronia (a
    // abertura velha daria CZ409): so a linha do procedimento.
    expect(
      precisaSincronizarVinculos(desfecho.abertura, AGORA_SEM_UNIMED),
    ).toBe(false);
  });

  it("a linha falha por outro motivo depois da sincronia: o motivo vai junto", async () => {
    const { acoes } = dublê({
      sincronizar: [SINCRONIA_OK],
      salvar: [{ ok: false, error: "Confira os campos informados." }],
    });
    const desfecho = await gravarProcedimento(
      pedido({ agora: AGORA_SEM_UNIMED }),
      acoes,
    );
    expect(desfecho).toMatchObject({
      erro: "Quem faz e os convênios foram salvos, mas os dados do procedimento não. Confira os campos informados. Clique em Salvar de novo.",
    });
  });

  it("sem sincronia, a linha que falha devolve o erro dela e não recarrega", async () => {
    const { acoes } = dublê({
      salvar: [
        {
          ok: false,
          error: "Somente administradores e gestores alteram os cadastros.",
        },
      ],
    });
    expect(await gravarProcedimento(pedido(), acoes)).toEqual({
      tipo: "erro",
      erro: "Somente administradores e gestores alteram os cadastros.",
      recarregar: false,
    });
  });

  it("a chave da IA não chegou a quem faz (parcial): guarda o id e recarrega", async () => {
    const erro =
      "O procedimento foi salvo, mas a opção IA pode agendar não chegou a quem faz este procedimento. Clique em Salvar de novo.";
    const { acoes } = dublê({
      salvar: [{ ok: false, parcial: true, id: PROC, error: erro }],
    });
    expect(await gravarProcedimento(pedido(), acoes)).toEqual({
      tipo: "erro",
      erro,
      id: PROC,
      recarregar: true,
      abertura: undefined,
    });
  });

  it("parcial depois da sincronia: guarda o id e devolve a abertura nova (o próximo Salvar não duplica nem dá CZ409)", async () => {
    const erro =
      "O procedimento foi salvo, mas a opção IA pode agendar não chegou a quem faz este procedimento. Clique em Salvar de novo.";
    const { acoes } = dublê({
      sincronizar: [SINCRONIA_OK],
      salvar: [{ ok: false, parcial: true, id: PROC, error: erro }],
    });
    const desfecho = await gravarProcedimento(
      pedido({ agora: AGORA_SEM_UNIMED }),
      acoes,
    );
    // O parcial vem antes do !ok: sem isso, a tela leria "dados do
    // procedimento não foram salvos" e perderia o id.
    expect(desfecho).toMatchObject({
      tipo: "erro",
      erro,
      id: PROC,
      recarregar: true,
    });
    if (desfecho.tipo !== "erro" || !desfecho.abertura) {
      throw new Error("esperava a abertura nova");
    }
    expect(
      precisaSincronizarVinculos(desfecho.abertura, AGORA_SEM_UNIMED),
    ).toBe(false);
  });

  it("o procedimento criado cuja sincronia falhou: o próximo Salvar edita e sincroniza sem nada na abertura", async () => {
    const { acoes, chamadas } = dublê({
      sincronizar: [{ ...SINCRONIA_OK, id: NOVO }],
      salvar: [{ ok: true, id: NOVO }],
    });
    await gravarProcedimento(
      pedido({ id: NOVO, abertura: null, agora: AGORA_SEM_UNIMED }),
      acoes,
    );
    expect(chamadas.map((c) => c.acao)).toEqual([
      "sincronizar",
      "salvarProcedimento",
    ]);
    expect(chamadas[0]).toMatchObject({
      procedureId: NOVO,
      extras: { vinculosNaAbertura: [], planosNaAbertura: [] },
    });
  });
});

describe("Salvar do procedimento ao criar", () => {
  const AGORA_NOVO = {
    linhas: [
      {
        professionalId: JOAO,
        convenios: [ajusteNovo(null, ENDO), ajusteNovo(UNIMED, ENDO)],
      },
    ],
    padrao: ENDO,
    iaPodeAgendar: true,
    planos: [UNIMED],
  };

  it("a linha primeiro, depois a sincronia com o id novo e nada na abertura", async () => {
    const { acoes, chamadas } = dublê({
      salvar: [{ ok: true, id: NOVO }],
      sincronizar: [{ ...SINCRONIA_OK, id: NOVO }],
    });
    const desfecho = await gravarProcedimento(
      pedido({ id: undefined, abertura: null, agora: AGORA_NOVO }),
      acoes,
    );
    expect(chamadas.map((c) => c.acao)).toEqual([
      "salvarProcedimento",
      "sincronizar",
    ]);
    expect(chamadas[0]).toEqual({ acao: "salvarProcedimento", input: CAMPOS });
    expect(chamadas[1]).toMatchObject({
      procedureId: NOVO,
      extras: {
        planos: [UNIMED],
        vinculosNaAbertura: [],
        planosNaAbertura: [],
        confirmar: false,
      },
    });
    expect(desfecho).toMatchObject({ tipo: "salvo", id: NOVO, criado: true });
  });

  it("a sincronia falha: o procedimento existe, guarda o id e recarrega", async () => {
    const { acoes } = dublê({
      salvar: [{ ok: true, id: NOVO }],
      sincronizar: [
        { ok: false, error: "Um convênio desativado não pode ser marcado." },
      ],
    });
    expect(
      await gravarProcedimento(
        pedido({ id: undefined, abertura: null, agora: AGORA_NOVO }),
        acoes,
      ),
    ).toEqual({
      tipo: "erro",
      erro: "O procedimento foi salvo, mas quem faz e os convênios não. Um convênio desativado não pode ser marcado.",
      id: NOVO,
      recarregar: true,
    });
  });

  it("parcial na criação (defesa): guarda o id, recarrega e não sincroniza", async () => {
    // A action de hoje nao volta parcial ao criar; se voltar, a linha ja
    // existe e o proximo Salvar precisa edita-la, nunca criar outra igual.
    const erro =
      "O procedimento foi salvo pela metade. Clique em Salvar de novo.";
    const { acoes, chamadas } = dublê({
      salvar: [{ ok: false, parcial: true, id: NOVO, error: erro }],
    });
    expect(
      await gravarProcedimento(
        pedido({ id: undefined, abertura: null, agora: AGORA_NOVO }),
        acoes,
      ),
    ).toEqual({ tipo: "erro", erro, id: NOVO, recarregar: true });
    expect(chamadas.map((c) => c.acao)).toEqual(["salvarProcedimento"]);
  });

  it("o insert falha: nada de sincronia, sem id", async () => {
    const { acoes, chamadas } = dublê({
      salvar: [{ ok: false, error: "Não foi possível criar o registro." }],
    });
    expect(
      await gravarProcedimento(
        pedido({ id: undefined, abertura: null, agora: AGORA_NOVO }),
        acoes,
      ),
    ).toEqual({
      tipo: "erro",
      erro: "Não foi possível criar o registro.",
      recarregar: false,
    });
    expect(chamadas.map((c) => c.acao)).toEqual(["salvarProcedimento"]);
  });
});

describe("textos da tela do procedimento", () => {
  it("título do aviso de consultas, no singular e no plural", () => {
    expect(tituloDoAvisoDosVinculos(1)).toBe(
      "Há 1 consulta marcada em combinações de quem faz e convênio que saem deste procedimento. Remarque ou cancele, se for o caso.",
    );
    expect(tituloDoAvisoDosVinculos(3)).toContain("Há 3 consultas marcadas");
  });

  it("quem deixa de atender pelo convênio desmarcado em cobrem", () => {
    expect(fraseDoConvenioQueSai("Unimed", ["Dr. João"])).toBe(
      "Ao tirar Unimed, Dr. João deixa de atender por este convênio neste procedimento.",
    );
    expect(fraseDoConvenioQueSai("Unimed", ["Dr. João", "Dra. Ana"])).toBe(
      "Ao tirar Unimed, Dr. João e Dra. Ana deixam de atender por este convênio neste procedimento.",
    );
    expect(fraseDoConvenioQueSai("Unimed", [])).toBeNull();
  });

  it("convênio que cobre e o profissional não atende", () => {
    expect(fraseDeQuemNaoAtende("Dra. Ana", ["Bradesco Saúde", "Amil"])).toBe(
      "Dra. Ana não atende Bradesco Saúde e Amil no cadastro do profissional. Para incluir, marque em Convênios que atende, na aba Profissionais.",
    );
    expect(fraseDeQuemNaoAtende("Dra. Ana", [])).toBeNull();
  });

  it("nenhum texto fixo tem travessão", () => {
    for (const texto of [
      AJUDA_DE_QUEM_FAZ,
      AJUDA_DOS_CONVENIOS_QUE_COBREM,
      SO_PARTICULAR,
      VAZIO_DOS_CONVENIOS_QUE_COBREM,
      tituloDoAvisoDosVinculos(2),
      fraseDoConvenioQueSai("Unimed", ["Dr. João", "Dra. Ana"]) ?? "",
      fraseDeQuemNaoAtende("Dra. Ana", ["Bradesco Saúde"]) ?? "",
    ]) {
      expect(texto).not.toMatch(TRAVESSAO);
    }
  });
});
