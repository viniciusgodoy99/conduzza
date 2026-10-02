import { describe, expect, it } from "vitest";

import type { SaldoParaComparecimento } from "@/lib/domain/appointment-status";
import { descontoDoPacote, precoAvulsoDoPacote } from "@/lib/domain/pacotes";
import {
  adicionarItem,
  fraseDoDescontoAoComparecer,
  fraseDoQueSobra,
  itensDasLinhas,
  itensDoAjuste,
  itensParaCalcular,
  lerSessoes,
  linhasDoPacote,
  percentualDoDesconto,
  removerItem,
  resumoDosItens,
  sobraDepoisDoDesconto,
  textoDoDesconto,
  trocarSessoes,
  usadasParaVender,
  vendasQueJaDescontaram,
  type LinhaDoItem,
} from "@/lib/domain/pacotes-ui";

// Telas do pacote com varios procedimentos (pedido do dono em 29/09/2026). O
// exemplo do dono: Botox 2 sessoes + Facelift 1 sessao, com preco do pacote
// menor que o avulso. Aqui mora o que a tela calcula e monta antes de ir ao
// banco: as linhas do formulario, o preco avulso ao vivo, o desconto, a
// venda em andamento, o ajuste por item e a frase do Compareceu.

const PROCEDIMENTOS = [
  { id: "botox", name: "Botox", base_price_cents: 100_000 },
  { id: "facelift", name: "Facelift", base_price_cents: 500_000 },
  { id: "avaliacao", name: "Avaliação", base_price_cents: null },
];

const nomeDe = (id: string): string =>
  PROCEDIMENTOS.find((p) => p.id === id)?.name ?? "Procedimento removido";

describe("linhas de Procedimentos do pacote", () => {
  it("abre o pacote gravado com as sessões em texto, na ordem dos itens", () => {
    expect(
      linhasDoPacote([
        { procedure_id: "botox", sessions: 2 },
        { procedure_id: "facelift", sessions: 1 },
      ]),
    ).toEqual([
      { procedure_id: "botox", sessions: "2" },
      { procedure_id: "facelift", sessions: "1" },
    ]);
  });

  it("adicionar põe o procedimento no fim com 1 sessão", () => {
    const linhas = adicionarItem([], "botox");
    expect(linhas).toEqual([{ procedure_id: "botox", sessions: "1" }]);
    expect(adicionarItem(linhas, "facelift")).toEqual([
      { procedure_id: "botox", sessions: "1" },
      { procedure_id: "facelift", sessions: "1" },
    ]);
  });

  it("o mesmo procedimento entra uma vez só, e escolha vazia não muda nada", () => {
    const linhas: LinhaDoItem[] = [{ procedure_id: "botox", sessions: "2" }];
    expect(adicionarItem(linhas, "botox")).toEqual(linhas);
    expect(adicionarItem(linhas, "")).toEqual(linhas);
  });

  it("remover e trocar sessões não mexem nas outras linhas nem na lista original", () => {
    const linhas: LinhaDoItem[] = [
      { procedure_id: "botox", sessions: "2" },
      { procedure_id: "facelift", sessions: "1" },
    ];
    expect(removerItem(linhas, "botox")).toEqual([
      { procedure_id: "facelift", sessions: "1" },
    ]);
    expect(trocarSessoes(linhas, "facelift", "3")).toEqual([
      { procedure_id: "botox", sessions: "2" },
      { procedure_id: "facelift", sessions: "3" },
    ]);
    expect(linhas).toEqual([
      { procedure_id: "botox", sessions: "2" },
      { procedure_id: "facelift", sessions: "1" },
    ]);
  });

  it("sessões digitadas valem de 1 a 200, inteiras", () => {
    expect(lerSessoes("2")).toBe(2);
    expect(lerSessoes(" 10 ")).toBe(10);
    expect(lerSessoes("200")).toBe(200);
    for (const invalido of ["", "0", "201", "1.5", "1,5", "-1", "dois"]) {
      expect(lerSessoes(invalido)).toBeNull();
    }
  });

  it("as linhas viram os itens que a Server Action grava", () => {
    expect(
      itensDasLinhas(
        [
          { procedure_id: "botox", sessions: "2" },
          { procedure_id: "facelift", sessions: " 1 " },
        ],
        nomeDe,
      ),
    ).toEqual({
      ok: true,
      itens: [
        { procedure_id: "botox", sessions: 2 },
        { procedure_id: "facelift", sessions: 1 },
      ],
    });
  });

  it("sessão inválida devolve a mensagem nomeando o procedimento", () => {
    expect(
      itensDasLinhas(
        [
          { procedure_id: "botox", sessions: "2" },
          { procedure_id: "facelift", sessions: "0" },
        ],
        nomeDe,
      ),
    ).toEqual({ ok: false, erro: "As sessões de Facelift vão de 1 a 200." });
  });

  it("lista vazia ou com procedimento repetido é recusada antes do banco", () => {
    expect(itensDasLinhas([], nomeDe)).toEqual({
      ok: false,
      erro: "Escolha ao menos um procedimento para o pacote.",
    });
    expect(
      itensDasLinhas(
        [
          { procedure_id: "botox", sessions: "2" },
          { procedure_id: "botox", sessions: "1" },
        ],
        nomeDe,
      ),
    ).toEqual({
      ok: false,
      erro: "O mesmo procedimento aparece duas vezes no pacote.",
    });
  });

  it("resumo da tabela: Botox 2x + Facelift 1x", () => {
    expect(
      resumoDosItens(
        [
          { procedure_id: "botox", sessions: 2 },
          { procedure_id: "facelift", sessions: 1 },
        ],
        nomeDe,
      ),
    ).toBe("Botox 2x + Facelift 1x");
  });
});

describe("preço avulso ao vivo no formulário", () => {
  it("Botox 2 + Facelift 1 soma R$ 7.000,00", () => {
    const itens = itensParaCalcular([
      { procedure_id: "botox", sessions: "2" },
      { procedure_id: "facelift", sessions: "1" },
    ]);
    expect(itens).not.toBeNull();
    expect(precoAvulsoDoPacote(itens!, PROCEDIMENTOS)).toEqual({
      centavos: 700_000,
      itensSemPreco: 0,
    });
  });

  it("muda na hora em que as sessões mudam", () => {
    const itens = itensParaCalcular([
      { procedure_id: "botox", sessions: "3" },
      { procedure_id: "facelift", sessions: "1" },
    ]);
    expect(precoAvulsoDoPacote(itens!, PROCEDIMENTOS).centavos).toBe(800_000);
  });

  it("não calcula com sessão inválida nem com a lista vazia (a soma mentiria)", () => {
    expect(
      itensParaCalcular([
        { procedure_id: "botox", sessions: "" },
        { procedure_id: "facelift", sessions: "1" },
      ]),
    ).toBeNull();
    expect(itensParaCalcular([])).toBeNull();
  });

  it("procedimento sem preço base deixa a soma incompleta e sem desconto", () => {
    const avulso = precoAvulsoDoPacote(
      itensParaCalcular([
        { procedure_id: "botox", sessions: "2" },
        { procedure_id: "avaliacao", sessions: "1" },
      ])!,
      PROCEDIMENTOS,
    );
    expect(avulso).toEqual({ centavos: 200_000, itensSemPreco: 1 });
    expect(descontoDoPacote(150_000, avulso)).toBeNull();
  });
});

describe("desconto do pacote em texto", () => {
  const avulso = { centavos: 700_000, itensSemPreco: 0 };

  it("preço do pacote menor que o avulso: desconto em porcentagem", () => {
    const desconto = descontoDoPacote(600_000, avulso)!;
    expect(desconto.centavos).toBe(100_000);
    expect(textoDoDesconto(desconto)).toBe("14,3% de desconto");
    expect(textoDoDesconto(descontoDoPacote(560_000, avulso)!)).toBe(
      "20% de desconto",
    );
  });

  it("preço do pacote maior que o avulso aparece como acréscimo", () => {
    expect(textoDoDesconto(descontoDoPacote(735_000, avulso)!)).toBe(
      "5% acima do avulso",
    );
  });

  it("preço igual ao avulso diz que é o mesmo valor", () => {
    expect(textoDoDesconto(descontoDoPacote(700_000, avulso)!)).toBe(
      "Mesmo valor do avulso",
    );
  });

  it("diferença pequena não vira 0%", () => {
    const desconto = descontoDoPacote(699_999, avulso)!;
    expect(percentualDoDesconto(desconto)).toBe("menos de 0,1%");
    expect(textoDoDesconto(desconto)).toBe("menos de 0,1% de desconto");
  });
});

describe("venda de pacote em andamento", () => {
  const itens = [
    { procedure_id: "botox", nome: "Botox", sessions: 2 },
    { procedure_id: "facelift", nome: "Facelift", sessions: 1 },
  ];

  it("manda só os procedimentos com sessão já usada; campo vazio conta 0", () => {
    expect(usadasParaVender(itens, { botox: "1", facelift: "" })).toEqual({
      ok: true,
      usadas: [{ procedure_id: "botox", sessions_used: 1 }],
    });
    expect(usadasParaVender(itens, {})).toEqual({ ok: true, usadas: [] });
  });

  it("um procedimento pode estar todo usado se sobrar sessão em outro", () => {
    expect(usadasParaVender(itens, { botox: "2", facelift: "0" })).toEqual({
      ok: true,
      usadas: [{ procedure_id: "botox", sessions_used: 2 }],
    });
  });

  it("acima das sessões do procedimento é recusado, nomeando o procedimento", () => {
    expect(usadasParaVender(itens, { facelift: "2" })).toEqual({
      ok: false,
      erro: "As sessões já usadas de Facelift vão de 0 a 1.",
    });
    expect(usadasParaVender(itens, { botox: "1,5" })).toEqual({
      ok: false,
      erro: "As sessões já usadas de Botox vão de 0 a 2.",
    });
  });

  it("sem sobrar nenhuma sessão no pacote, a venda é recusada", () => {
    expect(usadasParaVender(itens, { botox: "2", facelift: "1" })).toEqual({
      ok: false,
      erro: "Com essas sessões já usadas não sobra nenhuma para descontar. Confira as sessões.",
    });
  });
});

describe("ajuste do saldo por procedimento", () => {
  const itens = [
    {
      id: "item-botox",
      procedure_name: "Botox",
      sessions_total: 2,
      sessions_used: 1,
    },
    {
      id: "item-facelift",
      procedure_name: "Facelift",
      sessions_total: 1,
      sessions_used: 0,
    },
  ];

  it("devolve só os itens que mudaram", () => {
    expect(
      itensDoAjuste(itens, { "item-botox": "0", "item-facelift": "0" }),
    ).toEqual({
      ok: true,
      itens: [{ item_id: "item-botox", sessions_used: 0 }],
    });
  });

  it("sem mudança nos itens a lista vai vazia (ajuste só da validade)", () => {
    expect(itensDoAjuste(itens, {})).toEqual({ ok: true, itens: [] });
    expect(
      itensDoAjuste(itens, { "item-botox": "1", "item-facelift": "0" }),
    ).toEqual({ ok: true, itens: [] });
  });

  it("fora de 0 até o total do item é recusado, nomeando o procedimento", () => {
    expect(itensDoAjuste(itens, { "item-facelift": "2" })).toEqual({
      ok: false,
      erro: "As sessões usadas de Facelift vão de 0 a 1.",
    });
    expect(itensDoAjuste(itens, { "item-botox": "" })).toEqual({
      ok: false,
      erro: "As sessões usadas de Botox vão de 0 a 2.",
    });
  });
});

describe("vendas que já descontaram (não se cancelam)", () => {
  const vendas = [
    { id: "venda-1", itens: [{ id: "item-1a" }, { id: "item-1b" }] },
    { id: "venda-2", itens: [{ id: "item-2a" }] },
    { id: "venda-3", itens: [{ id: "item-3a" }] },
  ];

  it("pela venda e pelo item, sem repetir", () => {
    expect(
      vendasQueJaDescontaram(
        [
          { package_balance_id: "venda-1", package_balance_item_id: "item-1a" },
          { package_balance_id: "venda-1", package_balance_item_id: "item-1b" },
          // Consulta que aponta so o item: a venda vem pelo item.
          { package_balance_id: null, package_balance_item_id: "item-2a" },
          { package_balance_id: null, package_balance_item_id: null },
          // Item de venda que a ficha nao enxerga nao inventa venda.
          { package_balance_id: null, package_balance_item_id: "sumiu" },
        ],
        vendas,
      ).sort(),
    ).toEqual(["venda-1", "venda-2"]);
  });
});

describe("frase do Compareceu", () => {
  const botox: SaldoParaComparecimento = {
    id: "item-botox",
    package_balance_id: "venda-1",
    package_name: "Harmonização",
    procedure_id: "botox",
    procedure_name: "Botox",
    sessions_total: 3,
    sessions_used: 1,
    expires_at: null,
    created_at: "2026-09-01T12:00:00Z",
  };

  it("nomeia procedimento e pacote, com o estado depois de marcar", () => {
    expect(fraseDoDescontoAoComparecer(botox, "Consulta")).toBe(
      "Desconta 1 sessão de Botox do pacote Harmonização (2 de 3 usadas).",
    );
    expect(fraseDoQueSobra(botox, "Consulta")).toBe(
      "Depois de marcar, sobra 1 sessão de Botox neste pacote.",
    );
  });

  it("sem nome no item usa o procedimento da consulta; sem nome de pacote, só 'do pacote'", () => {
    expect(
      fraseDoDescontoAoComparecer(
        { ...botox, procedure_name: null, package_name: null },
        "Toxina botulínica",
      ),
    ).toBe("Desconta 1 sessão de Toxina botulínica do pacote (2 de 3 usadas).");
  });

  it("singular com 1 sessão e o fim do saldo do procedimento", () => {
    const unica = { ...botox, sessions_total: 1, sessions_used: 0 };
    expect(fraseDoDescontoAoComparecer(unica, "Consulta")).toBe(
      "Desconta 1 sessão de Botox do pacote Harmonização (1 de 1 usada).",
    );
    expect(sobraDepoisDoDesconto(unica)).toBe(0);
    expect(fraseDoQueSobra(unica, "Consulta")).toBe(
      "Depois de marcar, acabam as sessões de Botox deste pacote.",
    );
    expect(
      fraseDoQueSobra({ ...botox, sessions_total: 5, sessions_used: 1 }, "X"),
    ).toBe("Depois de marcar, sobram 3 sessões de Botox neste pacote.");
  });
});

describe("texto sem travessão", () => {
  it("nenhuma mensagem das telas de pacote tem travessão", () => {
    const mensagens = [
      itensDasLinhas([{ procedure_id: "botox", sessions: "0" }], nomeDe),
      usadasParaVender([{ procedure_id: "a", nome: "A", sessions: 1 }], {
        a: "1",
      }),
      itensDoAjuste(
        [
          {
            id: "i",
            procedure_name: null,
            sessions_total: 1,
            sessions_used: 0,
          },
        ],
        { i: "9" },
      ),
    ].map((resultado) => (resultado.ok ? "" : resultado.erro));
    for (const texto of mensagens) {
      expect(texto).not.toMatch(/[–—]/u);
    }
  });
});
