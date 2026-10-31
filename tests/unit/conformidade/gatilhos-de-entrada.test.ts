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

// AG4 (27/10/2026): cancelar e remarcar a consulta de outra pessoa adulta
// passa para a equipe antes do modelo (D-8). "Da minha mae" so conta colado
// na consulta (ou no verbo, com o artigo): o motivo que cita a pessoa
// ("por causa da minha mae") e da propria consulta.
describe("cancelar ou remarcar a consulta de outra pessoa adulta", () => {
  it.each([
    "Quero cancelar a consulta da minha mãe.",
    "Preciso remarcar o horário do meu pai.",
    "Cancela a da minha mãe, por favor.",
    "Dá pra desmarcar a consulta de amanhã do meu marido?",
    "Quero remarcar o retorno do dia 29 da minha esposa.",
    "A consulta marcada da minha sogra, dá pra cancelar?",
    "Minha mãe precisa cancelar a consulta.",
    "Meu pai quer remarcar.",
    "Minha mãe tem consulta amanhã e não vai poder ir. Quero cancelar.",
    "Meu marido tem uma consulta na quinta, dá pra remarcar?",
  ])("escala: %s", (texto) => {
    expect(pedidoDeConsultaParaOutraPessoa([texto])).toBe(true);
  });

  it.each([
    "Quero cancelar minha consulta.",
    "Preciso cancelar por causa da minha mãe.",
    "Quero remarcar, tenho que cuidar da minha mãe nesse dia.",
    "Vou ter que desmarcar, vou levar meu pai no aeroporto.",
    "Minha mãe está internada, preciso cancelar a minha consulta.",
    "Minha mãe tem consulta amanhã, ela já confirmou.",
    "Não é a consulta da minha mãe, é a minha.",
    "Não cancela a do meu pai, só a minha.",
    "Quero remarcar para sexta.",
  ])("não escala: %s", (texto) => {
    expect(pedidoDeConsultaParaOutraPessoa([texto])).toBe(false);
  });

  it("a pessoa que tem consulta e o pedido em mensagens do mesmo turno", () => {
    expect(
      pedidoDeConsultaParaOutraPessoa([
        "Minha mãe tem consulta amanhã com vocês",
        null,
        "quero cancelar",
      ]),
    ).toBe(true);
    expect(
      pedidoDeConsultaParaOutraPessoa([
        "Minha mãe tem consulta amanhã com vocês",
        "ela já confirmou",
      ]),
    ).toBe(false);
  });

  it("as regras novas entram na versão do portão", () => {
    expect(
      FONTES_DO_PORTAO_EM_CODIGO.some((fonte) =>
        fonte.includes("colada: a consulta da minha mae"),
      ),
    ).toBe(true);
  });
});

// [AG6 urgência] início
// AG6a (D-51 e D-52): o sinal de emergencia (urgencia.ts) e o primeiro
// gatilho do portao. Os casos de cada sinal estao em bateria-ag6.test.ts.
describe("AG6a: a urgência no portão", () => {
  it("vem antes do sintoma e de todos os outros gatilhos", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [
          { tipo: "texto", texto: "estou com dor no peito, o que pode ser" },
        ],
      }),
    ).toEqual(["urgencia", "sintoma", "assunto_clinico"]);
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [
          { tipo: "texto", texto: "quero falar com um atendente" },
          { tipo: "texto", texto: "e a garganta ta fechando" },
        ],
      })[0],
    ).toBe("urgencia");
  });

  it("os casos de sintoma da bateria de sempre continuam com o sintoma (a urgência só vem antes)", () => {
    for (const caso of deterministicos.filter((c) => c.gatilho === "sintoma")) {
      const gatilhos = detectarGatilhosDeEntrada({ mensagens: caso.mensagens });
      expect(gatilhos, caso.id).toContain("sintoma");
    }
  });

  it("nenhum controle de entrada da bateria de sempre vira urgência", () => {
    for (const caso of CONTROLES_DE_ENTRADA) {
      expect(
        detectarGatilhosDeEntrada({ mensagens: caso.mensagens }),
        caso.id,
      ).not.toContain("urgencia");
    }
  });

  it("áudio, mesmo transcrito com um sinal, continua mídia nesta rodada", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "audio", texto: "socorro, to com falta de ar" }],
      }),
    ).toEqual(["midia"]);
  });

  it("o nascimento de menor não esconde a urgência", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: "ela desmaiou" }],
        dataDeNascimento: "2015-01-01",
        hojeNaClinica: "2026-10-28",
      }),
    ).toEqual(["urgencia", "sintoma", "menor_de_idade"]);
  });
});
// [AG6 urgência] fim

// [AG6b mídia] início
// AG6b (D-98): a figurinha reconhecida (no servidor ou pelo leitor) nao
// escala como midia e nao tem texto; o audio a transcrever chega ao portao
// como texto vazio (conta no numero de mensagens) e o arquivo a ler, como a
// legenda (quem monta e o laco).
describe("AG6b: a figurinha e a mídia a ler no portão", () => {
  it("a figurinha nao escala; o resto da midia continua escalando", () => {
    expect(
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "figurinha", texto: null }] }),
    ).toEqual([]);
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [
          { tipo: "figurinha", texto: null },
          { tipo: "audio", texto: null },
        ],
      }),
    ).toEqual(["midia"]);
  });

  it("o texto vazio do audio a transcrever conta no numero de mensagens", () => {
    const seis = Array.from({ length: 6 }, () => ({ tipo: "texto", texto: "" }));
    expect(detectarGatilhosDeEntrada({ mensagens: seis })).toEqual(["mensagem_longa"]);
  });
});

// 3a rodada da AG6b (revisao de 6eae43d, item 6): o exame na legenda do
// pedido. A bateria (bateria-ag6b.test.ts) tem as legendas da revisao; aqui
// ficam as bordas de cada troca.
//
// Revisao R2 de d1a15f6 (M1): as trocas do item 6 (o demonstrativo, a
// marcacao, o convenio, o pedido e so o exame) foram DESFEITAS e o portao
// voltou ao da 6eae43d: elas abriam o conteudo clinico em volta ("minha
// glicose ta alterada, quanto custa esses exames?"). As bordas abaixo agora
// escalam; a troca na recepcao e PROPOSTA para o dono e para a D34. A guarda
// da finalidade e do preparo ficou (so deixa a troca de preco mais estrita).
describe("AG6b (3a rodada, desfeita na revisão R2): o exame na legenda do pedido", () => {
  const portao = (texto: string) =>
    detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });

  it.each([
    "esse",
    "esses",
    "este",
    "estes",
    "desse",
    "desses",
    "deste",
    "destes",
    "nesse",
    "nesses",
  ])(
    "o demonstrativo %s antes do exame, na pergunta de preco, escala (R2)",
    (d) => {
      expect(portao(`quanto custa ${d} exames?`)).toEqual(["assunto_clinico"]);
      expect(portao(`qual o valor ${d} exame?`)).toEqual(["assunto_clinico"]);
    },
  );

  it.each([
    "quero marcar esses exames",
    "dá pra agendar os exames pra sexta?",
    "preciso marcar esses exames",
    "quero remarcar o exame de amanhã",
    "pode cancelar o exame de sábado?",
    "tem horário pra fazer esses exames amanhã?",
    "vocês conseguem realizar esses dois exames no mesmo dia?",
    "orçamento desses exames por favor",
    "tem vaga pros exames na quinta?",
    "aceita unimed pra esses exames?",
    "a unimed cobre esses exames?",
    "o convênio autoriza esse exame?",
    "segue o pedido de exames",
    "o pedido médico dos exames está aqui",
    "exames",
    "Exame.",
    "seguem os exames",
    "esses exames aqui",
    "quero marcar um exame de sangue",
    "tem horário pra que dia pra fazer esses exames?",
  ])("a recepcao do exame escala (R2, proposta): %s", (texto) => {
    expect(portao(texto)).toEqual(["assunto_clinico"]);
  });

  it.each([
    "quanto custa o exame?",
    "qual o preço do exame?",
    "qual o valor dos exames?",
    "vocês fazem o exame?",
    "exame de vista, quanto custa?",
    "quanto custa o exame de sangue?",
    "o médico pediu esses exames, quanto fica?",
    "o resultado do exame vem por e-mail?",
  ])(
    "R2: a troca da 6eae43d continua (o artigo e a pergunta de preco): %s",
    (texto) => {
      expect(portao(texto)).toEqual([]);
    },
  );

  it.each([
    "pra que serve o exame? quanto custa?",
    "quanto custa o exame? pra que serve?",
    "quanto custa o exame? precisa de jejum?",
    "quero marcar esses exames pra semana que vem",
    "Quero marcar esses exames pra semana que vem.",
    "quero marcar o exame no mes que vem",
  ])(
    'R2: a guarda da finalidade e o "que vem" do tempo escalam: %s',
    (texto) => {
      expect(portao(texto)[0]).toBe("assunto_clinico");
    },
  );

  it.each([
    // A finalidade, o preparo e o que ele detecta, em qualquer ponto.
    ["pra que serve esse exame?", "assunto_clinico"],
    ["para que serve esses exames? quanto custa?", "assunto_clinico"],
    ["o que é esse exame?", "assunto_clinico"],
    ["o que faz esse exame?", "assunto_clinico"],
    ["esse exame detecta o quê? quero marcar", "assunto_clinico"],
    ["por que o médico pediu esses exames? quanto fica?", "assunto_clinico"],
    ["precisa de jejum pra fazer esse exame?", "assunto_clinico"],
    ["quero marcar esses exames, precisa de jejum?", "assunto_clinico"],
    ["como é o preparo desses exames? quanto custa?", "assunto_clinico"],
    // A necessidade e a permissao de fazer.
    ["preciso fazer esse exame?", "assunto_clinico"],
    ["devo fazer esses exames?", "assunto_clinico"],
    ["tenho que fazer esse exame mesmo?", "assunto_clinico"],
    ["posso fazer esse exame?", "assunto_clinico"],
    // O resultado e o desfecho.
    ["quero marcar esses exames pra ver o resultado", "assunto_clinico"],
    ["quanto custa esse exame? o meu deu alterado", "assunto_clinico"],
    ["quero marcar o exame depois do procedimento", "assunto_clinico"],
    ["meus exames", "assunto_clinico"],
    ["meu exame veio com glicemia alta", "assunto_clinico"],
    ["esse exame deu alterado, é grave?", "sintoma"],
  ] as const)("o exame clinico continua escalando: %s", (texto, gatilho) => {
    expect(portao(texto)[0]).toBe(gatilho);
  });
});
// [AG6b mídia] fim
