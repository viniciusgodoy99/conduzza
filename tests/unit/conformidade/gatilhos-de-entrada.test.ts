import { describe, expect, it } from "vitest";

import { GATILHOS_DO_CLASSIFICADOR } from "@/lib/domain/conformidade/categorias";
import {
  detectarGatilhosDeEntrada,
  FONTES_DO_PORTAO_EM_CODIGO,
  idadeEmAnos,
  LIMITE_DE_MENSAGEM,
  MAXIMO_DE_MENSAGENS_NO_CONTEXTO,
  pedidoDeConsultaParaOutraPessoa,
} from "@/lib/domain/conformidade/gatilhos-de-entrada";
import {
  CASOS_DE_ENTRADA,
  CONTROLES_DE_ENTRADA,
} from "@/tests/fixtures/ia/conformidade/casos";

// O portao de entrada escala ANTES do agente. Cada caso da bateria que nao
// e "so do modelo" tem de disparar o gatilho esperado, e mensagem normal de
// recepcao nao pode disparar nada.

const deterministicos = CASOS_DE_ENTRADA.filter((caso) => !caso.soModelo);
const soModelo = CASOS_DE_ENTRADA.filter((caso) => caso.soModelo);

describe("bateria: mensagens que tem de escalar", () => {
  it("tem pelo menos 15 casos e ids unicos", () => {
    expect(deterministicos.length).toBeGreaterThanOrEqual(15);
    const ids = CASOS_DE_ENTRADA.map((caso) => caso.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(deterministicos.map((caso) => [caso.id, caso] as const))(
    "%s dispara o gatilho esperado",
    (_id, caso) => {
      const gatilhos = detectarGatilhosDeEntrada({
        mensagens: caso.mensagens,
        dataDeNascimento: caso.dataDeNascimento,
        hojeNaClinica: caso.hojeNaClinica,
      });
      expect(gatilhos).toContain(caso.gatilho);
    },
  );
});

describe("casos que so o classificador pega (o portao deixa de proposito)", () => {
  it.each(soModelo.map((caso) => [caso.id, caso] as const))(
    "%s: o classificador sabe apontar o gatilho e o portao nao aponta",
    (_id, caso) => {
      expect(
        GATILHOS_DO_CLASSIFICADOR.find((g) => g === caso.gatilho),
      ).toBeDefined();
      expect(
        detectarGatilhosDeEntrada({ mensagens: caso.mensagens }),
      ).not.toContain(caso.gatilho);
    },
  );
});

describe("bateria: mensagens normais que nao escalam", () => {
  it.each(CONTROLES_DE_ENTRADA.map((caso) => [caso.id, caso] as const))(
    "%s passa pelo portao",
    (_id, caso) => {
      expect(detectarGatilhosDeEntrada({ mensagens: caso.mensagens })).toEqual(
        [],
      );
    },
  );
});

describe("regras do portao", () => {
  it("qualquer midia escala, mesmo audio com transcricao", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "audio", texto: "quero marcar uma consulta" }],
      }),
    ).toEqual(["midia"]);
  });

  it("mensagem no limite passa; acima escala", () => {
    const noLimite = "a".repeat(LIMITE_DE_MENSAGEM);
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: noLimite }],
      }),
    ).not.toContain("mensagem_longa");
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: `${noLimite}a` }],
      }),
    ).toContain("mensagem_longa");
  });

  it("mais de cinco mensagens sem resposta escala (os modelos so veem cinco)", () => {
    expect(MAXIMO_DE_MENSAGENS_NO_CONTEXTO).toBe(5);
    const mensagens = (n: number) =>
      Array.from({ length: n }, () => ({ tipo: "texto", texto: "oi" }));
    expect(detectarGatilhosDeEntrada({ mensagens: mensagens(5) })).toEqual([]);
    expect(detectarGatilhosDeEntrada({ mensagens: mensagens(6) })).toEqual([
      "mensagem_longa",
    ]);
  });

  it("gatilhos em ordem de prioridade (sintoma primeiro)", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: "tem desconto? estou com febre" }],
      }),
    ).toEqual(["sintoma", "valor_fora_da_tabela"]);
  });

  it("idade por data de nascimento no fuso da clinica", () => {
    expect(idadeEmAnos("2008-10-06", "2026-10-05")).toBe(17);
    expect(idadeEmAnos("2008-10-05", "2026-10-05")).toBe(18);
    expect(idadeEmAnos("data", "2026-10-05")).toBeNull();
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: "quero marcar" }],
        dataDeNascimento: "2008-10-05",
        hojeNaClinica: "2026-10-05",
      }),
    ).toEqual([]);
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: "quero marcar" }],
        dataDeNascimento: "2008-10-06",
        hojeNaClinica: "2026-10-05",
      }),
    ).toEqual(["menor_de_idade"]);
  });

  it("sem o dia de hoje, a data de nascimento nao e usada (nunca chuta o fuso)", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: "quero marcar" }],
        dataDeNascimento: "2015-01-01",
      }),
    ).toEqual([]);
  });

  it("idade declarada so conta com 'anos'", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    expect(de("tenho 17 anos")).toEqual(["menor_de_idade"]);
    expect(de("tenho 18 anos")).toEqual([]);
    expect(de("fiz 3 sessões")).toEqual([]);
    expect(de("fiz uma limpeza semana passada")).toEqual([]);
  });

  it("caixa alta longa e demora reclamada escalam como insatisfacao", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    expect(de("NINGUEM ME AVISOU DO HORARIO")).toContain("insatisfacao");
    expect(de("Que demora!!!")).toContain("insatisfacao");
    expect(de("OK")).toEqual([]);
  });

  // Revisao de producao de 19/10/2026 (decisao do dono, Q1 e Q2).
  it("pontuacao repetida sozinha nao escala; caixa alta so com 5 palavras e sem pergunta", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    for (const texto of [
      "Oi!!!",
      "Obrigada!!!",
      "Oi????",
      "Quanto custa????",
    ]) {
      expect(de(texto), texto).toEqual([]);
    }
    // Quatro palavras, ou cinco com pergunta (inclusive a de largura cheia).
    expect(de("QUANTO CUSTA A CONSULTA")).toEqual([]);
    expect(de("QUANTO CUSTA A LIMPEZA DE PELE?")).toEqual([]);
    expect(de("QUANTO CUSTA A LIMPEZA DE PELE？")).toEqual([]);
    // Cinco palavras sem pergunta: continua grito.
    expect(de("QUANTO CUSTA A LIMPEZA DE PELE")).toEqual(["insatisfacao"]);
    // Pontuacao nao conta como palavra.
    expect(de("OI BOA TARDE !!! !!")).toEqual([]);
  });

  // Q4: nome de quem se apresenta.
  it("nome de quem se apresenta nao e sintoma; o pedido de socorro continua", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    expect(de("Aqui é a Socorro")).toEqual([]);
    expect(de("sou a Dores")).toEqual([]);
    expect(de("Socorro")).toEqual(["sintoma"]);
    expect(de("socorro, me ajuda")).toEqual(["sintoma"]);
    expect(de("me chamo Socorro e estou com dor")).toEqual(["sintoma"]);
  });

  it("texto com letra de outro alfabeto ou invisivel e tentativa de manipulacao", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    expect(de("quero marcar \u0441onsulta")).toContain("manipulacao");
    expect(de("quero mar\u200bcar")).toContain("manipulacao");
  });

  it("letra fora de [a-z] e manipulacao; letras soltas nao (abreviacao de WhatsApp)", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    expect(de("quero m\u0250rcar")).toContain("manipulacao");
    expect(de("q u e r o  m a r c a r")).toEqual([]);
    expect(de("o q e q eu preciso levar?")).toEqual([]);
    expect(de("p/ o q e a consulta?")).toEqual([]);
    expect(de("quero marcar às 9 e 30")).toEqual([]);
  });

  it("e-mail com sublinhado nao e identificador de codigo", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    expect(de("meu email e joao_pedro_lima@gmail.com")).toEqual([]);
    expect(de("chama a tool_use_id agora")).toContain("manipulacao");
  });

  it("sinal de urgencia inequivoco escala; o mesmo verbo fora do corpo nao", () => {
    const de = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    for (const texto of [
      "minha boca ta formigando",
      "a palpebra caiu depois do botox",
      "to sem folego",
      "meu coracao ta disparado",
      "to vendo tudo embacado",
      "meu braco ficou fraco",
      "tô muito mal",
    ]) {
      expect(de(texto), texto).toContain("sintoma");
    }
    for (const texto of [
      "o alarme do carro disparou",
      "a foto ficou embacada, mando outra",
      "to meio sem tempo essa semana",
    ]) {
      expect(de(texto), texto).toEqual([]);
    }
  });

  it("palavra espacada com espaco duplo entre as palavras ainda e lida", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [
          { tipo: "texto", texto: "t o  c o m  d o r  n o  p e i t o" },
        ],
      }),
    ).toContain("sintoma");
  });
});

// Revisao final da AG3 (achado 15, D-8): o pedido de consulta para outra
// pessoa adulta passa para a equipe pelo portao (o laco escala com o motivo
// consulta_para_outra_pessoa, sem gatilho). Filho e filha seguem pela regra
// do menor.
describe("a consulta para outra pessoa adulta", () => {
  it.each([
    "Quero marcar uma consulta para minha mãe",
    "Tem horário pro meu pai amanhã?",
    "Gostaria de agendar para o meu marido, por favor",
    "Quero marcar pra minha esposa",
    "Vocês têm vaga para a minha sogra na sexta?",
    "Queria uma avaliação pra minha avó",
    "Minha mãe quer marcar uma consulta",
    "Meu marido precisa de uma consulta com a dermatologista",
    "É para minha esposa",
    "Seria pro meu pai",
    "Na verdade, é para o meu irmão",
  ])("%s", (texto) => {
    expect(pedidoDeConsultaParaOutraPessoa([texto])).toBe(true);
  });

  it.each([
    "Quero marcar uma consulta para meu filho",
    "É pra minha filha",
    "Posso levar minha mãe na consulta?",
    "Minha mãe que me indicou vocês, quero marcar uma consulta",
    "Quero marcar uma consulta para mim",
    "Tem estacionamento? Meu pai vai me levar",
    "Minha mãe vai me acompanhar na consulta",
    "Comprei um presente para minha mãe",
  ])("não é: %s", (texto) => {
    expect(pedidoDeConsultaParaOutraPessoa([texto])).toBe(false);
  });

  it("nenhum controle de entrada da bateria vira consulta para outra pessoa", () => {
    for (const caso of CONTROLES_DE_ENTRADA) {
      expect(
        pedidoDeConsultaParaOutraPessoa(caso.mensagens.map((m) => m.texto)),
        caso.id,
      ).toBe(false);
    }
  });

  it("mídia não conta, e as regras entram na versão do portão", () => {
    expect(pedidoDeConsultaParaOutraPessoa([null])).toBe(false);
    expect(
      FONTES_DO_PORTAO_EM_CODIGO.some((fonte) =>
        fonte.includes("outra pessoa adulta"),
      ),
    ).toBe(true);
  });
});

// Revisao curta das correcoes da AG3 (achado 9): o portao exige a intencao
// de marcar para a outra pessoa (ela como paciente) e trata a negacao.
describe("a consulta para outra pessoa: só com a pessoa como paciente", () => {
  it.each([
    "A consulta é para mim, não para minha mãe.",
    "Não é para minha mãe, é para mim.",
    "Meu marido vai passar aí para pagar a consulta.",
    "Preciso de um horário que dê para minha mãe me levar.",
    "Quero marcar consulta, mas só posso no horário que der pro meu chefe me liberar.",
    "Quero marcar um horário para minha mãe poder me acompanhar.",
    "Quero marcar consulta pra minha mãe me levar depois.",
    "Quero um horário bom para minha mãe também, ela vai comigo.",
    "Quero marcar uma consulta pra mim. Minha mãe já é paciente de vocês.",
    "Tem horário depois das 18h? Antes disso eu cuido da minha mãe e não dá pra mim.",
    "Quero agendar, meu marido vai me acompanhar na consulta.",
    "Minha esposa quer saber o preço da consulta.",
  ])("não escala: %s", (texto) => {
    expect(pedidoDeConsultaParaOutraPessoa([texto])).toBe(false);
  });

  it.each([
    "Quero marcar uma consulta para minha mãe e outra para mim.",
    "Quero agendar uma consulta para mim e para minha mãe.",
    "Quero marcar para minha mãe consultar com a Dra. Ana.",
    "Quero marcar para minha mãe ser atendida pela Dra. Ana.",
    "A consulta é pro meu marido.",
    "Não, é para minha mãe.",
    "É minha mãe que quer marcar uma consulta.",
    "Meu marido vai passar por uma consulta, vocês têm horário?",
    "Minha mãe vai passar com a dermatologista.",
    "Quero marcar consulta pra mamãe",
    "Tem horário pro papai amanhã?",
  ])("escala: %s", (texto) => {
    expect(pedidoDeConsultaParaOutraPessoa([texto])).toBe(true);
  });

  it("as regras novas entram na versão do portão", () => {
    expect(
      FONTES_DO_PORTAO_EM_CODIGO.some((fonte) =>
        fonte.includes("so com a intencao de marcar para ela"),
      ),
    ).toBe(true);
  });
});
