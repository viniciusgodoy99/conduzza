import { describe, expect, it } from "vitest";

import {
  autoria,
  definicaoDoSinal,
  descreverTendencia,
  descricaoDoEvento,
  descricoesDoHistorico,
  detalheDoSinal,
  dolaresPrecisos,
  dolaresPrecisosParaPlanilha,
  ehOrdemPadrao,
  escreverNotaSchema,
  excluirNotaSchema,
  filtrarClinicas,
  filtrosAtivos,
  FILTROS_PADRAO,
  GASTO_STATUS,
  lerFiltrosDoPainel,
  lerOrdemDaLista,
  MOTIVO_PADRAO_DO_AGENTE,
  notaValida,
  OPCOES_DA_SAUDE,
  ORDEM_PADRAO,
  ordenarClinicas,
  passosDaImplantacao,
  PRIMEIRO_SENTIDO,
  proximaOrdem,
  rotuloDoSinal,
  semUsoDeIa,
  SINAL_STATUS,
  TETO_DE_IA_ATINGIDO_STATUS,
  textoDaImplantacao,
  textoDasChamadas,
  TEXTOS_DO_PAINEL,
  type OrdemDaLista,
} from "@/components/painel-geral/painel-geral";
import type {
  ClinicaNoPainel,
  EventoDaConta,
  SinalNoPainel,
} from "@/lib/queries/painel-geral";

// As regras da segunda leva do Painel geral (pedido do dono de 26/10/2026,
// depois de ver o painel de CS no ar), puras: o gasto com a precisao real
// e as chamadas ("Esse gasto de IA ta certo?": o mes inteiro custou US$
// 0,001 e o cartao dizia US$ 0,00), os rotulos e o que o banco contou de
// cada sinal de alerta, os passos da implantacao, a tendencia com a direcao
// do banco, o filtro de saude, a ordem por coluna (com a URL), as entradas
// das notas e o historico da conta em texto de recepcao. Nenhum texto com
// travessao.

const ID_A = "a1111111-1111-4111-8111-111111111111";
const ID_B = "b2222222-2222-4222-8222-222222222222";
const ID_C = "c3333333-3333-4333-8333-333333333333";
const PESSOA = "d4444444-4444-4444-8444-444444444444";
const FUSO = "America/Fortaleza";

const PASSOS = [
  "whatsapp_conectado",
  "equipe_com_duas_pessoas",
  "procedimentos_cadastrados",
  "profissionais_cadastrados",
  "regua_de_confirmacao_ligada",
  "anuncios_conectados",
] as const;

function implantacao(
  feitos: readonly boolean[],
  quantidades: readonly number[] = [],
  anuncios = { meta: false, google: false },
): ClinicaNoPainel["implantacao"] {
  const passos = PASSOS.map((chave, indice) => ({
    chave,
    feito: feitos[indice] ?? false,
    quantidade: quantidades[indice] ?? (feitos[indice] ? 1 : 0),
  }));
  return {
    feitos: passos.filter((passo) => passo.feito).length,
    total: passos.length,
    passos,
    anuncios,
  };
}

function clinica(campos: Partial<ClinicaNoPainel> = {}): ClinicaNoPainel {
  return {
    id: ID_A,
    nome: "Clínica Aurora",
    criadaEm: "2026-09-01T12:00:00.000Z",
    fuso: FUSO,
    emUso: true,
    ultimoAcesso: {
      em: "2026-10-20T13:00:00.000Z",
      userId: PESSOA,
      nome: "Ana Souza",
      email: "ana@aurora.com.br",
      papel: "admin",
      implementador: false,
      equipeConduzza: false,
    },
    membrosAtivos: 3,
    membrosPendentes: 0,
    membrosEquipeConduzza: 0,
    pessoas: [],
    numerosTotal: 1,
    numerosConectados: 1,
    numeros: [],
    contatos: 10,
    leads30Dias: 14,
    conversas30Dias: 40,
    ultimaMensagemEm: null,
    suspensao: null,
    agente: {
      estado: "teste",
      modo: "contatos",
      liberada: true,
      pausadaPelaClinica: false,
      telefonesLigados: 1,
    },
    gasto: {
      ultimas24hCentavos: 0,
      mesCentavos: 0,
      ultimas24hSemSimuladorCentavos: 0,
      mesSemSimuladorCentavos: 0,
      ultimas24hMicrodolares: 0,
      mesMicrodolares: 1000,
      ultimas24hSemSimuladorMicrodolares: 0,
      mesSemSimuladorMicrodolares: 0,
      ultimas24hChamadas: 0,
      mesChamadas: 7,
      ultimas24hSemSimuladorChamadas: 0,
      mesSemSimuladorChamadas: 0,
    },
    tetoDiarioCentavos: 500,
    saude: "saudavel",
    sinais: [],
    implantacao: implantacao([true, true, true, false, false, false]),
    tendencia: {
      leads: {
        atual: 14,
        anterior: 10,
        variacaoPercentual: 40,
        direcao: "subindo",
      },
      conversas: {
        atual: 40,
        anterior: 41,
        variacaoPercentual: -2,
        direcao: "estavel",
      },
    },
    ultimaNotaEm: null,
    ...campos,
  };
}

function sinal(
  chave: SinalNoPainel["chave"],
  campos: Partial<SinalNoPainel> = {},
): SinalNoPainel {
  return {
    chave,
    nivel:
      chave === "conta_suspensa" ||
      chave === "sem_uso" ||
      chave === "whatsapp_desconectado"
        ? "em_risco"
        : "atencao",
    quantidade: null,
    desde: null,
    ...campos,
  };
}

describe("gasto de IA com a precisão real (pedido do dono)", () => {
  it("abaixo de 1 centavo, todas as casas que o valor tem; nunca US$ 0,00 quando houve gasto", () => {
    expect(dolaresPrecisos(1000)).toBe("US$ 0,001");
    expect(dolaresPrecisos(1500)).toBe("US$ 0,0015");
    expect(dolaresPrecisos(1)).toBe("US$ 0,000001");
    expect(dolaresPrecisos(9999)).toBe("US$ 0,009999");
    for (const microdolares of [1, 10, 999, 5000, 9999]) {
      expect(dolaresPrecisos(microdolares)).not.toBe("US$ 0,00");
    }
  });

  it("de 1 centavo para cima, as 2 casas de sempre (arredondado como o banco); zero é US$ 0,00", () => {
    expect(dolaresPrecisos(0)).toBe("US$ 0,00");
    expect(dolaresPrecisos(10_000)).toBe("US$ 0,01");
    expect(dolaresPrecisos(15_000)).toBe("US$ 0,02");
    expect(dolaresPrecisos(3_100_400)).toBe("US$ 3,10");
    expect(dolaresPrecisos(12_345_678_900)).toBe("US$ 12.345,68");
  });

  it("para a planilha, sem o US$", () => {
    expect(dolaresPrecisosParaPlanilha(1000)).toBe("0,001");
    expect(dolaresPrecisosParaPlanilha(3_100_400)).toBe("3,10");
    expect(dolaresPrecisosParaPlanilha(0)).toBe("0,00");
  });

  it("as chamadas, no singular e no plural", () => {
    expect(textoDasChamadas(0)).toBe("Nenhuma chamada");
    expect(textoDasChamadas(1)).toBe("1 chamada");
    expect(textoDasChamadas(7)).toBe("7 chamadas");
    expect(textoDasChamadas(1234)).toBe("1.234 chamadas");
  });

  it("Sem uso de IA: só sem agente liberado, sem gasto e sem chamada no mês", () => {
    const desligado = clinica({
      agente: { ...clinica().agente, estado: "desligado" },
    });
    const semGasto = {
      ...clinica().gasto,
      mesMicrodolares: 0,
      mesChamadas: 0,
    };
    expect(semUsoDeIa({ ...desligado, gasto: semGasto })).toBe(true);
    // Com gasto (o simulador, antes de desligar), mostra o gasto.
    expect(semUsoDeIa(desligado)).toBe(false);
    expect(
      semUsoDeIa({ ...desligado, gasto: { ...semGasto, mesChamadas: 1 } }),
    ).toBe(false);
    // Liberado, sem gasto: mostra o zero e as chamadas.
    expect(semUsoDeIa(clinica({ gasto: semGasto }))).toBe(false);
  });
});

describe("sinais de alerta: o rótulo da linha e o que o banco contou", () => {
  it("o rótulo leva a contagem quando ajuda", () => {
    expect(rotuloDoSinal(sinal("conta_suspensa"))).toBe("Conta suspensa");
    expect(rotuloDoSinal(sinal("sem_uso"))).toBe("Sem uso há 30 dias");
    expect(
      rotuloDoSinal(sinal("whatsapp_desconectado", { quantidade: 2 })),
    ).toBe("WhatsApp desconectado");
    expect(rotuloDoSinal(sinal("sem_numero_de_whatsapp"))).toBe(
      "Sem número de WhatsApp",
    );
    expect(
      rotuloDoSinal(sinal("pedido_de_entrada_esperando", { quantidade: 1 })),
    ).toBe("Pedido de entrada esperando");
    expect(
      rotuloDoSinal(sinal("pedido_de_entrada_esperando", { quantidade: 3 })),
    ).toBe("3 pedidos de entrada esperando");
    expect(rotuloDoSinal(sinal("falhas_de_envio", { quantidade: 1 }))).toBe(
      "1 falha de envio",
    );
    expect(rotuloDoSinal(sinal("falhas_de_envio", { quantidade: 1200 }))).toBe(
      "1.200 falhas de envio",
    );
    expect(
      rotuloDoSinal(sinal("perto_do_teto_da_ia", { quantidade: 85 })),
    ).toBe("Perto do teto de IA");
  });

  it("o detalhe: desde quando (no fuso da clínica), quantos e quanto do teto", () => {
    // 13:05 UTC = 10:05 em Fortaleza
    const quando = "2026-10-20T13:05:00.000Z";
    expect(
      detalheDoSinal(sinal("conta_suspensa", { desde: quando }), FUSO),
    ).toBe("Suspensa desde 20/10/2026, 10:05.");
    expect(detalheDoSinal(sinal("sem_uso", { desde: quando }), FUSO)).toBe(
      "Último acesso da equipe em 20/10/2026, 10:05.",
    );
    expect(detalheDoSinal(sinal("sem_uso"), FUSO)).toBe(
      "Ninguém da equipe entrou ainda.",
    );
    expect(
      detalheDoSinal(
        sinal("whatsapp_desconectado", { quantidade: 2, desde: quando }),
        FUSO,
      ),
    ).toBe(
      "Os 2 números estão sem conexão. A desconexão mais recente foi em 20/10/2026, 10:05.",
    );
    expect(
      detalheDoSinal(sinal("whatsapp_desconectado", { quantidade: 1 }), FUSO),
    ).toBe("O número está sem conexão.");
    expect(detalheDoSinal(sinal("sem_numero_de_whatsapp"), FUSO)).toContain(
      "aba WhatsApp de Configurações",
    );
    expect(
      detalheDoSinal(
        sinal("pedido_de_entrada_esperando", { quantidade: 2, desde: quando }),
        FUSO,
      ),
    ).toBe(
      "2 pedidos esperando há mais de 2 dias. O mais antigo é de 20/10/2026.",
    );
    expect(
      detalheDoSinal(
        sinal("falhas_de_envio", { quantidade: 1, desde: quando }),
        FUSO,
      ),
    ).toBe(
      "1 mensagem não saiu nos últimos 7 dias. A primeira falha foi em 20/10/2026, 10:05.",
    );
    expect(
      detalheDoSinal(sinal("perto_do_teto_da_ia", { quantidade: 85 }), FUSO),
    ).toBe("85% do teto diário gasto nas últimas 24 horas.");
    expect(
      detalheDoSinal(sinal("perto_do_teto_da_ia", { quantidade: 120 }), FUSO),
    ).toContain("O agente para de responder");
  });
});

describe("terceira leva (decisões do dono de 26/10/2026): a clínica nova sem acesso e o teto atingido", () => {
  it("Ainda sem acesso: o rótulo e, no detalhe, a criação e o dia em que a clínica passa para Em risco", () => {
    expect(rotuloDoSinal(sinal("ainda_sem_acesso"))).toBe("Ainda sem acesso");
    expect(definicaoDoSinal(sinal("ainda_sem_acesso"))).toBe(
      SINAL_STATUS.ainda_sem_acesso,
    );
    // 13:05 UTC = 10:05 em Fortaleza; 30 dias depois, 19/11/2026
    expect(
      detalheDoSinal(
        sinal("ainda_sem_acesso", { desde: "2026-10-20T13:05:00.000Z" }),
        FUSO,
      ),
    ).toBe(
      "Ninguém da equipe entrou desde a criação, em 20/10/2026. Se ninguém entrar até 19/11/2026, a clínica passa para Em risco.",
    );
    // 02:30 UTC ainda e o dia anterior em Fortaleza (23:30): o dia e o da
    // clinica, nas duas datas
    expect(
      detalheDoSinal(
        sinal("ainda_sem_acesso", { desde: "2026-10-21T02:30:00.000Z" }),
        FUSO,
      ),
    ).toBe(
      "Ninguém da equipe entrou desde a criação, em 20/10/2026. Se ninguém entrar até 19/11/2026, a clínica passa para Em risco.",
    );
    expect(detalheDoSinal(sinal("ainda_sem_acesso"), FUSO)).toBe(
      "Ninguém da equipe entrou ainda.",
    );
  });

  it("Teto de IA atingido a partir de 100%: o rótulo e a cara do Teto atingido do cartão de gasto", () => {
    const perto = sinal("perto_do_teto_da_ia", { quantidade: 99 });
    expect(rotuloDoSinal(perto)).toBe("Perto do teto de IA");
    expect(definicaoDoSinal(perto)).toBe(SINAL_STATUS.perto_do_teto_da_ia);
    for (const quantidade of [100, 250]) {
      const atingido = sinal("perto_do_teto_da_ia", { quantidade });
      expect(rotuloDoSinal(atingido)).toBe("Teto de IA atingido");
      expect(definicaoDoSinal(atingido)).toBe(TETO_DE_IA_ATINGIDO_STATUS);
    }
    expect(TETO_DE_IA_ATINGIDO_STATUS).toEqual({
      label: "Teto de IA atingido",
      tone: GASTO_STATUS.atingido.tone,
      icon: GASTO_STATUS.atingido.icon,
    });
    // Os outros sinais nao mudam de cara com a quantidade.
    expect(
      definicaoDoSinal(sinal("falhas_de_envio", { quantidade: 500 })),
    ).toBe(SINAL_STATUS.falhas_de_envio);
  });
});

describe("implantação: os seis passos do banco, com o nome e o que ele contou", () => {
  it("na ordem do banco, feito ou não, com o detalhe", () => {
    const passos = passosDaImplantacao(
      clinica({
        implantacao: implantacao(
          [true, true, true, false, true, true],
          [2, 1, 12, 0, 1, 1],
          { meta: true, google: false },
        ),
      }),
    );
    expect(passos.map((passo) => [passo.rotulo, passo.feito])).toEqual([
      ["Número de WhatsApp conectado", true],
      ["Equipe com 2 ou mais pessoas ativas", true],
      ["Procedimentos cadastrados", true],
      ["Profissionais cadastrados", false],
      ["Régua de confirmação ligada", true],
      ["Anúncios conectados (Meta ou rastreio do Google)", true],
    ]);
    expect(passos.map((passo) => passo.detalhe)).toEqual([
      "2 números conectados.",
      "1 pessoa ativa.",
      "12 procedimentos ativos.",
      "Nenhum profissional ativo.",
      "1 régua de confirmação ligada.",
      "Meta ligada. Rastreio do Google desligado.",
    ]);
  });

  it("N de 6 passos", () => {
    expect(textoDaImplantacao(4, 6)).toBe("4 de 6 passos");
    expect(textoDaImplantacao(0, 6)).toBe("0 de 6 passos");
  });
});

describe("tendência: a direção do banco, com a seta e o texto", () => {
  it("subindo, caindo, estável e sem base", () => {
    expect(
      descreverTendencia({
        atual: 14,
        anterior: 10,
        variacaoPercentual: 40,
        direcao: "subindo",
      }),
    ).toEqual({
      direcao: "subindo",
      visivel: "+40%",
      falado: "subindo 40% vs. 30 dias anteriores",
      boa: true,
    });
    expect(
      descreverTendencia({
        atual: 5,
        anterior: 10,
        variacaoPercentual: -50,
        direcao: "caindo",
      }),
    ).toMatchObject({
      visivel: "-50%",
      falado: "caindo 50% vs. 30 dias anteriores",
      boa: false,
    });
    // A faixa do estavel e do banco: +5% e estavel, sem seta para cima.
    expect(
      descreverTendencia({
        atual: 21,
        anterior: 20,
        variacaoPercentual: 5,
        direcao: "estavel",
      }),
    ).toEqual({
      direcao: "estavel",
      visivel: "Estável",
      falado: "estável, +5% vs. 30 dias anteriores",
      boa: null,
    });
    expect(
      descreverTendencia({
        atual: 3,
        anterior: 0,
        variacaoPercentual: null,
        direcao: "sem_base",
      }),
    ).toMatchObject({ visivel: "Sem base", boa: null });
    expect(
      descreverTendencia({
        atual: 1200,
        anterior: 100,
        variacaoPercentual: 1100,
        direcao: "subindo",
      }).visivel,
    ).toBe("+1.100%");
  });
});

describe("filtro de saúde e ordem por coluna", () => {
  const lista = [
    clinica({
      id: ID_A,
      nome: "Clínica Zélia",
      saude: "atencao",
      sinais: [sinal("falhas_de_envio", { quantidade: 2 })],
      leads30Dias: 5,
      conversas30Dias: 50,
      implantacao: implantacao([true, true, true, true, true, false]),
      gasto: { ...clinica().gasto, mesMicrodolares: 20_000, mesChamadas: 9 },
    }),
    clinica({
      id: ID_B,
      nome: "Odonto Árvore",
      emUso: false,
      ultimoAcesso: null,
      saude: "em_risco",
      sinais: [sinal("sem_uso"), sinal("sem_numero_de_whatsapp")],
      leads30Dias: 0,
      conversas30Dias: 0,
      implantacao: implantacao([false, false, false, false, false, false]),
      gasto: { ...clinica().gasto, mesMicrodolares: 0, mesChamadas: 0 },
    }),
    clinica({
      id: ID_C,
      nome: "Estética Bela",
      ultimoAcesso: { ...clinica().ultimoAcesso!, em: "2026-10-25T09:00:00Z" },
      saude: "saudavel",
      leads30Dias: 30,
      conversas30Dias: 10,
      implantacao: implantacao([true, true, true, false, false, false]),
      gasto: { ...clinica().gasto, mesMicrodolares: 1000, mesChamadas: 7 },
    }),
  ];

  const ordem = (o: OrdemDaLista) =>
    ordenarClinicas(lista, o).map((c) => c.nome);

  it("o filtro de saúde: na URL, nas opções e pelo valor do banco", () => {
    expect(OPCOES_DA_SAUDE.map((o) => o.label)).toEqual([
      "Todas",
      "Saudável",
      "Atenção",
      "Em risco",
    ]);
    expect(
      lerFiltrosDoPainel(new URLSearchParams({ saude: "em_risco" })).saude,
    ).toBe("em_risco");
    expect(
      lerFiltrosDoPainel(new URLSearchParams({ saude: "otima" })).saude,
    ).toBe("todas");
    const ids = (saude: (typeof FILTROS_PADRAO)["saude"]) =>
      filtrarClinicas(lista, { ...FILTROS_PADRAO, saude }).map((c) => c.id);
    expect(ids("em_risco")).toEqual([ID_B]);
    expect(ids("atencao")).toEqual([ID_A]);
    expect(ids("saudavel")).toEqual([ID_C]);
    expect(filtrosAtivos({ ...FILTROS_PADRAO, saude: "atencao" })).toBe(true);
  });

  it("a ordem da URL; coluna desconhecida vira a padrão; sem sentido, o do primeiro clique", () => {
    const params = (valores: Record<string, string>) =>
      new URLSearchParams(valores);
    expect(lerOrdemDaLista(params({}))).toEqual(ORDEM_PADRAO);
    expect(lerOrdemDaLista(params({ ordem: "saude", sentido: "asc" }))).toEqual(
      { coluna: "saude", sentido: "asc" },
    );
    expect(lerOrdemDaLista(params({ ordem: "implantacao" }))).toEqual({
      coluna: "implantacao",
      sentido: "asc",
    });
    expect(lerOrdemDaLista(params({ ordem: "nome", sentido: "asc" }))).toEqual(
      ORDEM_PADRAO,
    );
    expect(
      lerOrdemDaLista(params({ ordem: "ia", sentido: "de lado" })),
    ).toEqual({ coluna: "ia", sentido: "desc" });
    expect(ehOrdemPadrao(ORDEM_PADRAO)).toBe(true);
    expect(ehOrdemPadrao({ coluna: "ultimo_acesso", sentido: "asc" })).toBe(
      false,
    );
  });

  it("o clique: outra coluna começa no sentido mais útil; a mesma inverte", () => {
    expect(PRIMEIRO_SENTIDO).toEqual({
      ultimo_acesso: "desc",
      saude: "desc",
      ia: "desc",
      leads: "desc",
      conversas: "desc",
      implantacao: "asc",
    });
    expect(proximaOrdem(ORDEM_PADRAO, "saude")).toEqual({
      coluna: "saude",
      sentido: "desc",
    });
    expect(proximaOrdem({ coluna: "saude", sentido: "desc" }, "saude")).toEqual(
      { coluna: "saude", sentido: "asc" },
    );
    expect(proximaOrdem(ORDEM_PADRAO, "ultimo_acesso")).toEqual({
      coluna: "ultimo_acesso",
      sentido: "asc",
    });
  });

  it("cada coluna ordena pelo seu valor; empate, a ordem do banco", () => {
    expect(ordem(ORDEM_PADRAO)).toEqual([
      "Estética Bela",
      "Clínica Zélia",
      "Odonto Árvore",
    ]);
    // Do mais antigo para o mais recente: quem nunca entrou primeiro.
    expect(ordem({ coluna: "ultimo_acesso", sentido: "asc" })).toEqual([
      "Odonto Árvore",
      "Clínica Zélia",
      "Estética Bela",
    ]);
    expect(ordem({ coluna: "saude", sentido: "desc" })).toEqual([
      "Odonto Árvore",
      "Clínica Zélia",
      "Estética Bela",
    ]);
    expect(ordem({ coluna: "ia", sentido: "desc" })).toEqual([
      "Clínica Zélia",
      "Estética Bela",
      "Odonto Árvore",
    ]);
    expect(ordem({ coluna: "leads", sentido: "desc" })).toEqual([
      "Estética Bela",
      "Clínica Zélia",
      "Odonto Árvore",
    ]);
    expect(ordem({ coluna: "conversas", sentido: "asc" })).toEqual([
      "Odonto Árvore",
      "Estética Bela",
      "Clínica Zélia",
    ]);
    expect(ordem({ coluna: "implantacao", sentido: "asc" })).toEqual([
      "Odonto Árvore",
      "Estética Bela",
      "Clínica Zélia",
    ]);
    // A lista recebida nao muda (copia).
    expect(lista.map((c) => c.nome)).toEqual([
      "Clínica Zélia",
      "Odonto Árvore",
      "Estética Bela",
    ]);
    // Empate: a ordem do banco (o acesso mais recente primeiro).
    const empatadas = [
      clinica({ id: ID_A, nome: "A", leads30Dias: 1 }),
      clinica({
        id: ID_B,
        nome: "B",
        leads30Dias: 1,
        ultimoAcesso: {
          ...clinica().ultimoAcesso!,
          em: "2026-10-26T09:00:00Z",
        },
      }),
    ];
    expect(
      ordenarClinicas(empatadas, { coluna: "leads", sentido: "desc" }).map(
        (c) => c.nome,
      ),
    ).toEqual(["B", "A"]);
  });
});

describe("notas internas: as entradas das ações", () => {
  const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
  const NOTA = "e1111111-1111-4111-8111-111111111111";

  it("o texto de 1 a 2.000 caracteres depois do trim, entrada estrita", () => {
    expect(notaValida("")).toBe(false);
    expect(notaValida("   \n ")).toBe(false);
    expect(notaValida("a")).toBe(true);
    expect(notaValida("x".repeat(2000))).toBe(true);
    expect(notaValida("x".repeat(2001))).toBe(false);
    expect(
      escreverNotaSchema.safeParse({ clinicId: CLINICA, texto: " Ok " }).data,
    ).toEqual({ clinicId: CLINICA, texto: "Ok" });
    expect(
      escreverNotaSchema.safeParse({
        clinicId: CLINICA,
        texto: "Ok",
        autor: PESSOA,
      }).success,
    ).toBe(false);
    expect(
      escreverNotaSchema.safeParse({ clinicId: "x", texto: "Ok" }).success,
    ).toBe(false);
    expect(
      excluirNotaSchema.safeParse({ clinicId: CLINICA, notaId: NOTA }).success,
    ).toBe(true);
    expect(
      excluirNotaSchema.safeParse({ clinicId: CLINICA, notaId: "1" }).success,
    ).toBe(false);
  });
});

describe("histórico da conta em texto de recepção", () => {
  const VAZIOS: EventoDaConta["detalhes"] = {
    estado: null,
    motivo: null,
    chave: null,
    substituiu: null,
    tetoDiarioCentavos: null,
    tetoRespostasPorConversaHora: null,
    tetoDiarioAntesCentavos: null,
    tetoRespostasAntesPorConversaHora: null,
    jobsVencidos: null,
    clinicasDeVoltaAoTeste: null,
    notaEscritaEm: null,
  };
  const evento = (
    acao: EventoDaConta["acao"],
    detalhes: Partial<EventoDaConta["detalhes"]> = {},
  ) => descricaoDoEvento({ acao, detalhes: { ...VAZIOS, ...detalhes } }, FUSO);

  it("a conta: suspensa e reativada, com o motivo e as mensagens vencidas", () => {
    expect(
      evento("suspendeu_clinica", { motivo: "Pagamento atrasado" }),
    ).toEqual({
      titulo: "Conta suspensa",
      linhas: ["Motivo: Pagamento atrasado"],
    });
    expect(
      evento("reativou_clinica", { motivo: "Pago", jobsVencidos: 3 }),
    ).toEqual({
      titulo: "Conta reativada",
      linhas: [
        "Motivo: Pago",
        "3 mensagens automáticas vencidas foram canceladas.",
      ],
    });
    expect(evento("reativou_clinica", { jobsVencidos: 0 })).toEqual({
      titulo: "Conta reativada",
      linhas: [],
    });
  });

  it("o agente: liberado, ligado em produção e retirado; o motivo padrão do painel não se repete", () => {
    // Teste sem saber de onde veio: neutro (a trilha so guarda o destino).
    expect(evento("mudou_agente_da_clinica", { estado: "teste" })).toEqual({
      titulo: "Agente passou para Teste",
      linhas: [],
    });
    // De Desligado: liberado; da Producao: voltou.
    expect(
      descricaoDoEvento(
        {
          acao: "mudou_agente_da_clinica",
          detalhes: { ...VAZIOS, estado: "teste" },
        },
        FUSO,
        "desligado",
      ),
    ).toEqual({ titulo: "Agente liberado em Teste", linhas: [] });
    expect(
      descricaoDoEvento(
        {
          acao: "mudou_agente_da_clinica",
          detalhes: {
            ...VAZIOS,
            estado: "teste",
            motivo: MOTIVO_PADRAO_DO_AGENTE,
          },
        },
        FUSO,
        "producao",
      ),
    ).toEqual({ titulo: "Agente voltou para Teste", linhas: [] });
    expect(
      evento("mudou_agente_da_clinica", {
        estado: "producao",
        motivo: "Requisitos cumpridos",
      }),
    ).toEqual({
      titulo: "Agente ligado em Produção",
      linhas: ["Motivo: Requisitos cumpridos"],
    });
    expect(
      evento("mudou_agente_da_clinica", {
        estado: "desligado",
        motivo: MOTIVO_PADRAO_DO_AGENTE,
      }),
    ).toEqual({ titulo: "Agente retirado", linhas: [] });
    expect(evento("mudou_agente_da_clinica")).toEqual({
      titulo: "Agente da clínica mudou",
      linhas: [],
    });
  });

  it("a volta automática para Teste pela revogação de um requisito: 'voltou', com o nome do requisito, nunca a chave (revisão de 26/10/2026)", () => {
    // O motivo que revogar_requisito_da_producao grava (lido na producao
    // com fndef.js): o prefixo e a CHAVE do requisito.
    const volta = evento("mudou_agente_da_clinica", {
      estado: "teste",
      motivo: "Requisito da produção revogado: termo_da_clinica",
    });
    expect(volta).toEqual({
      titulo: "Agente voltou para Teste",
      linhas: [
        "Motivo: Requisito da produção revogado: Termo da clínica com a IA e a OpenAI",
      ],
    });
    expect(volta.titulo).not.toContain("liberado");
    expect(volta.linhas.join(" ")).not.toContain("termo_da_clinica");
    // Chave que a tela nao conhece: o nome neutro, nunca a chave crua.
    expect(
      evento("mudou_agente_da_clinica", {
        estado: "teste",
        motivo: "Requisito da produção revogado: requisito_novo",
      }).linhas,
    ).toEqual([
      "Motivo: Requisito da produção revogado: Outro requisito do banco",
    ]);
    // O motivo escrito pela equipe com o mesmo comeco, mas que nao e chave,
    // sai como foi escrito.
    expect(
      evento("mudou_agente_da_clinica", {
        estado: "desligado",
        motivo: "Requisito da produção revogado: termo vencido em 10/10",
      }).linhas,
    ).toEqual([
      "Motivo: Requisito da produção revogado: termo vencido em 10/10",
    ]);
  });

  it("o histórico inteiro: a direção de cada mudança do agente vem da mudança anterior na lista (o mais novo primeiro)", () => {
    const agente = (estado: string, motivo: string | null = null) => ({
      acao: "mudou_agente_da_clinica" as const,
      detalhes: { ...VAZIOS, estado, motivo },
    });
    const nota = { acao: "escreveu_nota_interna" as const, detalhes: VAZIOS };
    const lista = [
      agente("teste"), // da producao, pelo seletor: voltou
      nota,
      agente("producao", "Requisitos cumpridos"),
      agente("teste"), // do desligado: liberado
      agente("desligado"),
      agente("teste"), // o mais antigo da lista: neutro
    ];
    const descricoes = descricoesDoHistorico(lista, FUSO);
    expect(descricoes.map((d) => d.evento)).toEqual(lista);
    expect(descricoes.map((d) => d.descricao.titulo)).toEqual([
      "Agente voltou para Teste",
      "Nota escrita",
      "Agente ligado em Produção",
      "Agente liberado em Teste",
      "Agente retirado",
      "Agente passou para Teste",
    ]);
    expect(descricoesDoHistorico([], FUSO)).toEqual([]);
  });

  it("o teto, de antes para depois", () => {
    expect(
      evento("mudou_teto_da_ia", {
        tetoDiarioCentavos: 750,
        tetoDiarioAntesCentavos: 500,
        tetoRespostasPorConversaHora: 30,
        tetoRespostasAntesPorConversaHora: 30,
      }),
    ).toEqual({
      titulo: "Teto de IA mudou",
      linhas: [
        "Teto a cada 24 horas: de US$ 5,00 para US$ 7,50.",
        "Respostas por conversa em 1 hora: 30.",
      ],
    });
  });

  it("os requisitos da produção e as notas", () => {
    expect(
      evento("registrou_requisito_da_producao", {
        chave: "termo_da_clinica",
        substituiu: true,
      }),
    ).toEqual({
      titulo: "Requisito da produção registrado",
      linhas: [
        "Termo da clínica com a IA e a OpenAI.",
        "Substituiu o registro anterior.",
      ],
    });
    expect(
      evento("revogou_requisito_da_producao", {
        chave: "termo_da_clinica",
        motivo: "Termo vencido",
        clinicasDeVoltaAoTeste: 1,
      }),
    ).toEqual({
      titulo: "Requisito da produção revogado",
      linhas: [
        "Termo da clínica com a IA e a OpenAI.",
        "Motivo: Termo vencido",
        "1 clínica voltou para Teste.",
      ],
    });
    expect(evento("escreveu_nota_interna")).toEqual({
      titulo: "Nota escrita",
      linhas: [],
    });
    // 13:05 UTC = 10:05 em Fortaleza
    expect(
      evento("excluiu_nota_interna", {
        notaEscritaEm: "2026-10-20T13:05:00.000Z",
      }),
    ).toEqual({
      titulo: "Nota excluída",
      linhas: ["A nota tinha sido escrita em 20/10/2026, 10:05."],
    });
  });

  it("quem fez: o nome com a marca da equipe Conduzza; sem pessoa, o sistema", () => {
    expect(
      autoria({
        userId: PESSOA,
        nome: "Vinicius Rodrigues",
        email: "v@conduzza.com",
        equipeConduzza: true,
      }),
    ).toBe("por Vinicius Rodrigues (equipe Conduzza)");
    expect(
      autoria({
        userId: PESSOA,
        nome: null,
        email: "ana@aurora.com.br",
        equipeConduzza: false,
      }),
    ).toBe("por ana@aurora.com.br");
    expect(autoria(null)).toBe("pelo sistema");
  });
});

describe("os textos da segunda leva", () => {
  it("nenhum travessão, e o aviso de dado de paciente nas notas", () => {
    for (const [chave, valor] of Object.entries(TEXTOS_DO_PAINEL)) {
      const texto =
        typeof valor === "function"
          ? String((valor as (...partes: string[]) => string)("X", "Y"))
          : String(valor);
      expect(texto, chave).not.toMatch(/[—–]/);
    }
    expect(TEXTOS_DO_PAINEL.naoEscrevaDadoDePaciente).toBe(
      "Não escreva dado de paciente aqui.",
    );
    expect(TEXTOS_DO_PAINEL.semUsoDeIa).toBe("Sem uso de IA");
  });
});
