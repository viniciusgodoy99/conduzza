import { describe, expect, it } from "vitest";

import {
  calcularVersaoDoPortao,
  fontesDoPortao,
  versaoDoPortao,
} from "@/lib/domain/conformidade/filtro";
import { detectarGatilhosDeEntrada } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import {
  detectarUrgencia,
  FONTES_DA_URGENCIA,
  REGRAS_DE_LEITURA_DA_URGENCIA,
  SINAIS_DE_EMERGENCIA,
  TIPOS_DE_URGENCIA,
  type SinalDeEmergencia,
} from "@/lib/domain/conformidade/urgencia";

/**
 * Todas as fontes de um sinal: a dele, as excecoes (as de contexto e as
 * figuras, revisao RR1), o que ele exige e o que desfaz as excecoes.
 */
function fontesDoSinal(sinal: SinalDeEmergencia): string[] {
  return [
    sinal.fonte,
    sinal.excecaoAntes,
    sinal.excecaoDepois,
    sinal.figuraAntes,
    sinal.figuraDepois,
    sinal.excecaoNaOracaoAnterior,
    sinal.excecaoNaFrase,
    sinal.requer,
    sinal.semExcecaoCom,
  ].filter((fonte): fonte is string => fonte !== undefined);
}

// A urgencia da AG6a (lib/domain/conformidade/urgencia.ts; D-51 e D-52): a
// lista curta e deterministica de sinais de emergencia, com a negacao e as
// excecoes. So PASSA a conversa (marcada como Urgente, com a frase de
// sempre); nunca vira texto ao paciente. Os casos de cada sinal estao na
// bateria (bateria-ag6.test.ts); aqui, as regras de leitura.

const urgente = (texto: string) => detectarUrgencia([texto]);

describe("a lista", () => {
  it("cada sinal tem nome único, tipo da lista e fonte que compila", () => {
    const nomes = SINAIS_DE_EMERGENCIA.map((sinal) => sinal.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const sinal of SINAIS_DE_EMERGENCIA) {
      expect(TIPOS_DE_URGENCIA).toContain(sinal.tipo);
      expect(() => new RegExp(sinal.fonte, "g")).not.toThrow();
      for (const fonte of fontesDoSinal(sinal)) {
        expect(() => new RegExp(fonte), sinal.nome).not.toThrow();
      }
    }
    expect(SINAIS_DE_EMERGENCIA.some((s) => s.tipo === "risco_de_vida")).toBe(
      true,
    );
  });

  it("as fontes não têm letra dobrada (o texto é lido sem letra repetida)", () => {
    // Fora os escapes ("\\b", "\\s", "\\S", "\\w"), nenhuma letra repetida
    // nas fontes e em TODAS as excecoes (antes, depois, na oracao anterior,
    // na mensagem) e nas regras de leitura: "morrer" na fonte nunca casaria
    // com o texto lido como "morer". O nome do sinal nao e casado com texto.
    const fontes = [
      ...SINAIS_DE_EMERGENCIA.flatMap(fontesDoSinal),
      // A negacao, a enfase, a historia, o agora, o fim da oracao e o sinal
      // que traz a propria negacao.
      ...REGRAS_DE_LEITURA_DA_URGENCIA,
    ];
    expect(FONTES_DA_URGENCIA.slice(SINAIS_DE_EMERGENCIA.length, -2)).toEqual([
      ...REGRAS_DE_LEITURA_DA_URGENCIA,
    ]);
    for (const fonte of fontes) {
      const semEscapes = fonte.replace(/\\[a-zA-Z]/g, " ");
      expect(semEscapes, fonte).not.toMatch(/([a-z])\1/);
    }
  });

  it("cada exceção entra na versão do portão (mudar uma exceção muda a fonte)", () => {
    for (const [i, sinal] of SINAIS_DE_EMERGENCIA.entries()) {
      for (const fonte of fontesDoSinal(sinal)) {
        expect(FONTES_DA_URGENCIA[i], sinal.nome).toContain(fonte);
      }
    }
  });
});

describe("a leitura", () => {
  it("caixa alta, acento e letra dobrada não importam", () => {
    expect(urgente("FALTA DE AR")?.sinal).toBe("falta_de_ar");
    expect(urgente("faltaaaa de arrrr")?.sinal).toBe("falta_de_ar");
    expect(urgente("Emergência")?.sinal).toBe("emergencia");
    expect(urgente("CONVULSÃO")?.sinal).toBe("convulsao");
    expect(urgente("quero morreeeer")?.sinal).toBe("quero_morrer");
  });

  it("homóglifo e hífen no meio da palavra (as visões do portão)", () => {
    expect(urgente("falta de аr")?.sinal).toBe("falta_de_ar");
    expect(urgente("convul-\nsão")?.sinal).toBe("convulsao");
  });

  it("nulo, vazio e só espaço: nada", () => {
    expect(detectarUrgencia([])).toBeNull();
    expect(detectarUrgencia([null, undefined, "", "   "])).toBeNull();
  });

  it("vários textos: basta um; o risco de vida vence o físico", () => {
    expect(detectarUrgencia(["oi", "to com falta de ar"])).toEqual({
      tipo: "fisica",
      sinal: "falta_de_ar",
    });
    expect(
      detectarUrgencia([
        "to com falta de ar",
        "não aguento mais, quero morrer",
      ]),
    ).toEqual({ tipo: "risco_de_vida", sinal: "quero_morrer" });
    expect(urgente("to com dor no peito e quero morrer")?.tipo).toBe(
      "risco_de_vida",
    );
  });
});

describe("a negação", () => {
  it.each([
    "não estou com falta de ar",
    "nao tenho falta de ar",
    "nunca tive convulsão",
    "não é emergência",
    "não é uma emergência",
    "não se trata de uma emergência",
    "sem dor no peito",
    "não sinto nenhuma dor no peito",
    "nenhuma falta de ar",
    "nem falta de ar",
    "jamais pensei em suicídio",
    "não estou sem ar",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it.each([
    // A palavra de outro tipo no meio desfaz a negacao.
    ["nao aguento mais quero morrer", "quero_morrer"],
    ["não sei se é falta de ar ou ansiedade", "falta_de_ar"],
    // A negacao em outra oracao nao vale.
    ["Não. Estou com falta de ar", "falta_de_ar"],
    ["não, estou com falta de ar", "falta_de_ar"],
    ["não estou bem, mas acho que é falta de ar", "falta_de_ar"],
    ["sem febre, mas com falta de ar", "falta_de_ar"],
    // O sinal que ja traz a negacao: o "nao" antes e enfase.
    ["não, não consigo respirar", "nao_consigo_respirar"],
    ["nao nao consigo respirar", "nao_consigo_respirar"],
    ["não quero mais viver", "nao_quero_mais_viver"],
    ["não para de sangrar", "nao_para_de_sangrar"],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });
});

describe("as exceções", () => {
  it.each([
    ["Tem falta de ar condicionado na sala de espera?", "o ar condicionado"],
    ["vocês estão sem ar-condicionado?", "o ar condicionado com hífen"],
    ["tá sem ar aí?", "a pergunta sobre o lugar"],
    ["a sala fica sem ar?", "o lugar"],
    ["qual o contato de emergência?", "nome de uma coisa"],
    ["onde fica a saída de emergência?", "nome de uma coisa"],
    ["em caso de emergência, ligo pra quem?", "a hipótese"],
    ["tenho histórico de convulsão", "o histórico"],
    ["já tive convulsão quando criança", "o histórico"],
    ["tomo remédio pra convulsão", "o remédio"],
    ["não consigo falar com a recepção", "o telefone"],
    ["liguei e não consigo falar", "a ligação"],
    ["não consigo falar agora", "o tempo"],
    ["quero morrer de rir", "o exagero"],
    ["vou me matar de estudar", "o exagero"],
    ["o SAMU fica perto daí?", "o SAMU sem o pedido"],
    ["meu tio chama Samuel", "o nome"],
    ["Apaguei a mensagem sem querer", "apagar"],
    ["tem horário de urgência amanhã?", "urgência de agenda"],
  ])("%s: não é urgência (%s)", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it('o "ai" de dor não é o lugar', () => {
    expect(urgente("ai, to sem ar")?.sinal).toBe("sem_ar");
    expect(urgente("ai to sem ar")?.sinal).toBe("sem_ar");
  });

  it("os nomes de pessoa (as trocas do portão) não viram sinal", () => {
    expect(urgente("Maria do Socorro aqui")).toBeNull();
    expect(urgente("Maria das Dores, quero marcar")).toBeNull();
    expect(urgente("aqui é a Dores")).toBeNull();
    // O nome nao esconde o sinal dito depois dele.
    expect(urgente("aqui é a Dores, to com dor no peito")?.sinal).toBe(
      "dor_no_peito",
    );
  });

  it("D-51: pálpebra caída, febre, inchaço da boca e secreção não são urgência (são sintoma)", () => {
    for (const texto of [
      "minha pálpebra caiu depois do botox",
      "estou com febre",
      "a boca inchou depois do preenchimento",
      "está saindo secreção",
      "to com uma manchinha vermelha desde ontem",
    ]) {
      expect(urgente(texto), texto).toBeNull();
      expect(
        detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] }),
        texto,
      ).toEqual(["sintoma"]);
    }
  });
});

describe("no portão de entrada", () => {
  it("urgencia é o primeiro gatilho, mesmo com sintoma, menor e mídia juntos", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [
          { tipo: "imagem", texto: null },
          { tipo: "texto", texto: "minha filha de 12 anos desmaiou" },
        ],
      }),
    ).toEqual(["urgencia", "sintoma", "menor_de_idade", "midia"]);
  });

  it("a mídia não é lida (o áudio sem transcrição, a imagem): só o texto", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "audio", texto: "to com falta de ar" }],
      }),
    ).toEqual(["midia"]);
  });

  it("a mensagem longa com o sinal ainda é urgência", () => {
    const longa = `${"bom dia ".repeat(200)} to com falta de ar`;
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: longa }],
      }),
    ).toEqual(["urgencia", "sintoma", "mensagem_longa"]);
  });
});

// Revisao de 28/10/2026 (a segunda revisao da AG6a): as regras de leitura
// novas. Os casos de cada sinal estao na bateria; aqui, cada regra.
describe("a junção das pendentes (na ordem)", () => {
  it.each([
    [["to com dor", "no peito"], "dor_no_peito"],
    [["oi", "to com falta", "de ar"], "falta_de_ar"],
    [["minha mãe", "teve um AVC", "agora"], "avc"],
    [["não aguento mais", "quero", "morrer"], "quero_morrer"],
  ] as const)("%j: urgência (%s)", (textos, sinal) => {
    expect(detectarUrgencia(textos)?.sinal).toBe(sinal);
  });

  it("na ordem: a junção ao contrário não casa", () => {
    expect(detectarUrgencia(["no peito", "to com dor"])).toBeNull();
  });

  // Revisao de 30/10/2026: a excecao le so a MESMA mensagem do sinal, nunca
  // a rajada inteira (na 2a revisao, o procedimento numa mensagem apagava a
  // boca torta da outra). Revisao RR1: so a FRASE do sinal, dentro da
  // mensagem; e o procedimento feito deixou de ser excecao.
  it("a exceção lê só a frase do sinal (o pedido numa mensagem ou frase, a boca na outra: urgência)", () => {
    expect(
      detectarUrgencia(["fiz botox semana passada", "e minha boca ficou torta"])
        ?.sinal,
    ).toBe("boca_torta");
    expect(
      detectarUrgencia([
        "quanto fica com o botox?",
        "minha mãe acordou com a boca torta agora",
      ])?.sinal,
    ).toBe("boca_torta");
    expect(
      detectarUrgencia(["quero fazer preenchimento", "tenho a boca torta"])
        ?.sinal,
    ).toBe("boca_torta");
    expect(
      urgente("quero fazer preenchimento. Tenho a boca torta")?.sinal,
    ).toBe("boca_torta");
    // Na mesma frase, o pedido com o objeto e sem marca nenhuma de agora.
    expect(urgente("quero fazer preenchimento, tenho a boca torta")).toBeNull();
    // Revisao RR1: o efeito do procedimento na mesma mensagem (antes sem a
    // marca) e urgencia; o sinal que atravessa as mensagens le todas.
    expect(
      detectarUrgencia([
        "oi",
        "fiz botox semana passada e minha boca ficou torta",
      ])?.sinal,
    ).toBe("boca_torta");
    expect(
      detectarUrgencia(["fiz botox ontem e minha boca", "ficou torta"])?.sinal,
    ).toBe("boca_torta");
  });

  it("o que desfaz a exceção lê a rajada inteira (só devolve a urgência)", () => {
    expect(
      detectarUrgencia(["acordei", "e tentei ligar, não consigo falar"])?.sinal,
    ).toBe("nao_consigo_falar");
    expect(
      detectarUrgencia([
        "fiz harmonização e meu rosto ficou torto",
        "de um lado",
      ])?.sinal,
    ).toBe("rosto_torto");
    expect(
      detectarUrgencia(["é uma emergência, cancela", "tudo e me ajuda"])?.sinal,
    ).toBe("emergencia");
    // Sem o que desfaz, a excecao continua lida so na mensagem do sinal.
    expect(
      detectarUrgencia(["oi", "tentei ligar várias vezes, não consigo falar."]),
    ).toBeNull();
  });

  it("nulos e vazios no meio não quebram a junção", () => {
    expect(
      detectarUrgencia(["to com dor", null, "  ", "no peito"])?.sinal,
    ).toBe("dor_no_peito");
  });
});

describe("o nunca enfático", () => {
  it.each([
    "nunca senti uma dor tão forte no peito",
    "nunca tive tanta falta de ar",
    "nunca tive falta de ar assim",
    "jamais senti tanta dor no peito",
  ])("%s: urgência (a ênfase, não a negação)", (texto) => {
    expect(urgente(texto)?.tipo).toBe("fisica");
  });

  it.each([
    "nunca tive falta de ar",
    "não tenho tanta falta de ar",
    "nunca senti dor no peito",
  ])("%s: a negação de sempre", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("a história contada (o antecedente, só nos sinais físicos)", () => {
  it.each([
    "já desmaiei tirando sangue",
    "já tive choque anafilático",
    "às vezes falta de ar",
    "quando eu era criança tive convulsão",
    "uma vez desmaiei no dentista",
    "hoje faz um ano que desmaiei",
    "faz um ano que tive falta de ar",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it.each([
    ["já desmaiei duas vezes hoje", "desmaio"],
    ["mais uma vez desmaiei", "desmaio"],
    ["às vezes tenho vontade de morrer", "quero_morrer"],
    ["já pensei em suicídio", "suicidio"],
  ])("%s: urgência (%s; o agora, ou o risco de vida)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });
});

describe("a oração anterior (o telefone antes do não consigo falar)", () => {
  it.each([
    "tentei ligar várias vezes, não consigo falar.",
    "a recepção não atende, não consigo falar",
    "o telefone só dá ocupado, não consigo falar",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it.each([
    ["acordei assim, não consigo falar", "nao_consigo_falar"],
    // A outra pessoa: quem liga e descobre que ela nao fala e o sinal.
    ["liguei pra minha mãe, ela não consegue falar", "nao_consegue_falar"],
    // O telefone na oracao SEGUINTE nao desfaz (pode ser o pedido de ajuda).
    ["não consigo falar, ligo pra quem?", "nao_consigo_falar"],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });
});

describe("a negação no meio do sinal", () => {
  it.each([
    "minha língua não está inchada",
    "a língua dela não inchou",
    "minha boca não ficou torta",
    "meu rosto não está torto",
    "a garganta não está fechando",
    "o lado do corpo não ficou dormente",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it.each([
    ["minha língua tá inchada", "garganta_ou_lingua_inchada"],
    ["a boca dela ficou torta", "boca_torta"],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });
});

describe("o evento grave só com o agora ou a suspeita", () => {
  it.each([
    ["acho que to tendo um infarto", "infarto"],
    ["meu pai infartou agora", "infarto"],
    ["agora há pouco ela teve um AVC", "avc"],
    ["teve um derrame hoje de manhã", "avc"],
    ["socorro meu pai infartou", "infarto"],
    ["ela teve uma parada cardíaca agora", "parada_cardiaca"],
    ["ela teve uma hemorragia agora", "hemorragia"],
    ["ela teve um AVC há pouco", "avc"],
    ["parece que ela teve um derrame", "avc"],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });

  it.each([
    "minha mãe teve um AVC",
    "meu pai infartou",
    "parada cardíaca",
    "minha mãe teve um AVC e agora está bem, pode fazer botox?",
    "teve AVC ano passado e hoje quer fazer botox",
    "pessoas que tiveram AVC hoje em dia podem fazer preenchimento?",
    "hoje faz um ano que tive AVC, posso fazer botox?",
    "hoje queria saber se quem já teve AVC pode fazer botox",
    "minha mãe não teve AVC agora",
    "botox pode causar AVC?",
    "teve um derrame no olho hoje",
    // O recente que nao e o agora, e a informacao.
    "minha mãe teve um AVC agora em setembro",
    "meu marido teve um infarto há pouco tempo, ele pode fazer harmonização?",
    // Revisao RR1: sem o "hoje" (com ele, a reportagem e urgencia: o tempo
    // recente desfaz qualquer excecao; no bloco da RR1, no fim).
    "vi uma reportagem sobre AVC",
    "acho que vou ter um AVC de tanto estresse",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("a outra pessoa", () => {
  it.each([
    // Revisao RR1: a figura so com o objeto dito ("o preco", "a dieta");
    // "meu marido vai me matar", sem objeto, e a ameaca (urgencia).
    ["meu marido vai me matar", "me_matar"],
    ["esse preço vai me matar", null],
    ["essa dieta tá me matando", null],
    ["meu ex quer me matar", "me_matar"],
    ["eu vou me matar", "me_matar"],
    ["minha filha disse que vai se matar", "se_matar"],
    ["meu filho falou que vai acabar com tudo", "acabar_com_tudo"],
    ["isso vai acabar com tudo", null],
    ["ela diz que seria melhor ela morrer", "melhor_morrer"],
  ])("%s: %s", (texto, sinal) => {
    expect(urgente(texto)?.sinal ?? null).toBe(sinal);
  });

  it("a pergunta retórica com o não é o sinal, nunca a negação dele", () => {
    expect(urgente("não seria melhor eu morrer?")?.sinal).toBe("melhor_morrer");
    expect(urgente("melhor eu morrer de vergonha")).toBeNull();
  });
});

// Revisao de 30/10/2026 (revisao curta de edd123c..2ca2097): cada regra
// nova. Os casos de cada sinal estao na bateria (bateria-ag6.test.ts), com a
// nao regressao.
describe("o antecedente só vale quando governa o sinal", () => {
  it.each([
    // A oracao quebra tambem no " e ": a historia fica na primeira parte.
    ["já tive infarto e tô com dor no peito", "dor_no_peito"],
    ["ano passado tive infarto e tô com dor no peito", "dor_no_peito"],
    ["já tive convulsão e ela tá convulsionando", "convulsao"],
    ["minha mãe já teve AVC e tá com a boca torta", "boca_torta"],
    ["já desmaiei antes e tô sem ar", "sem_ar"],
    // "Uma vez" depois do sinal e a contagem, nao a historia.
    ["desmaiou uma vez e não acordou mais", "desmaio"],
    ["desmaiei uma vez no dentista", "desmaio"],
    // O presente na parte do sinal e a retomada depois desfazem.
    ["às vezes tô com falta de ar", "falta_de_ar"],
    ["já tive falta de ar e continua", "falta_de_ar"],
    // O agora na oracao seguinte: com o "mas", ou com o estado de agora.
    ["já tive dor no peito, mas agora tá muito forte", "dor_no_peito"],
    ["já tive dor no peito, agora tá muito forte", "dor_no_peito"],
    ["já tive dor no peito. Hoje voltou", "dor_no_peito"],
    ["já tive dor no peito, mas agora tá bem forte", "dor_no_peito"],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });

  it.each([
    "já tive choque anafilático e tô com medo de fazer botox",
    "Já tive falta de ar ano passado. Hoje estou bem, posso fazer botox?",
    "já desmaiei tirando sangue. Hoje quero marcar o exame, posso ir acompanhada?",
    "já tive dor no peito, mas agora estou bem",
    // Revisao RR1: a historia da terceira pessoa ("minha mae parou de
    // respirar ano passado") virou urgencia (a terceira pessoa desfaz
    // qualquer excecao; no bloco da RR1, no fim). A da propria pessoa fica.
    "uma vez eu apaguei no shopping",
  ])("%s: a história continua história", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it.each([
    ["já perdi muito sangue", "muito_sangue"],
    ["às vezes sangro muito, agora tô sangrando muito", "sangrando_muito"],
    ["já tive que chamar o SAMU pra ela", "chamar_o_socorro"],
    ["uma vez chamei a ambulância", "chamar_o_socorro"],
  ])("%s: nunca no socorro nem no sangramento (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });

  it("os sinais sem antecedente são os do socorro e do sangramento", () => {
    expect(
      SINAIS_DE_EMERGENCIA.filter((s) => s.semAntecedente === true)
        .map((s) => s.nome)
        .sort(),
    ).toEqual(
      [
        "chamar_o_socorro",
        // Revisao R2 de d1a15f6: a gestante que sangra.
        "gestante_sangrando",
        "hemorragia",
        "muito_sangue",
        "nao_para_de_sangrar",
        "sangrando_muito",
      ].sort(),
    );
  });
});

describe("o telefone só desfaz com a clínica como alvo", () => {
  it.each([
    [
      "liguei pro meu marido, não consigo mexer o braço e não consigo falar direito",
      "nao_fala_direito",
    ],
    [
      "acordei e tentei ligar pra minha filha, não consigo falar direito",
      "nao_fala_direito",
    ],
    ["liguei pro meu marido e não consigo falar direito", "nao_fala_direito"],
    ["o telefone tá ruim, não consigo falar direito", "nao_fala_direito"],
    // A pessoa nomeada, o comeco de repente e a queixa do corpo desfazem.
    ["liguei pro meu marido, não consigo falar", "nao_consigo_falar"],
    ["liguei pra ela e não consigo falar", "nao_consigo_falar"],
    ["acordei e tentei ligar, não consigo falar", "nao_consigo_falar"],
    [
      "não consigo falar, tô no trabalho e meu braço tá dormente",
      "nao_consigo_falar",
    ],
    // Sem "alguem" na excecao: o pedido de ajuda e o sinal.
    ["alguém me ajuda não consigo falar", "nao_consigo_falar"],
    // A outra pessoa: o telefone nunca desfaz.
    ["liguei e ela não consegue falar", "nao_consegue_falar"],
    ["liguei pra minha mãe e ela não consegue falar", "nao_consegue_falar"],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });

  it.each([
    "tentei ligar várias vezes, não consigo falar.",
    "a recepção não atende, não consigo falar",
    "liguei e não consigo falar",
    // Quem esta ocupado, na mesma frase (antes ou depois). Revisao RR1: com
    // o "agora" e urgencia (o tempo recente desfaz qualquer excecao).
    "não consigo falar no momento, me manda mensagem",
    "Não consigo falar, estou numa reunião",
    "Estou no trabalho, não consigo falar, pode mandar mensagem",
    "não consigo falar, te ligo mais tarde",
  ])("%s: a ligação, não a fala", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

// Revisao RR1: o procedimento feito deixou de ser excecao (nao e prova
// positiva de que nao e emergencia): o efeito dele, antes "sintoma" sem a
// marca, e urgencia. So o sorriso de sempre continua estetica.
describe("o procedimento feito nunca apaga a boca ou o rosto torto (revisão RR1)", () => {
  it.each([
    ["fiz botox e minha boca ficou torta", "boca_torta"],
    ["minha boca ficou torta depois do botox", "boca_torta"],
    ["fiz harmonização e meu rosto ficou torto", "rosto_torto"],
    [
      "Fiz preenchimento labial ontem. Hoje minha boca está torta.",
      "boca_torta",
    ],
    // Sem marca nenhuma de agora: o procedimento sozinho nao e excecao.
    ["o botox deixou minha boca torta", "boca_torta"],
    ["o preenchimento deixou meu rosto torto", "rosto_torto"],
    ["minha boca torta por causa do botox, isso passa?", "boca_torta"],
    ["e normal a boca ficar torta depois do botox?", "boca_torta"],
    // O sorriso de sempre com o "ontem" e o agora.
    ["fiz botox ontem e minha boca fica torta quando sorrio", "boca_torta"],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });

  it("o sorriso de sempre, mesmo depois do botox, continua estética", () => {
    expect(
      urgente("depois do botox minha boca fica torta quando sorrio"),
    ).toBeNull();
  });

  it.each([
    // O antigo, a terceira pessoa, a pergunta ("com o botox"), o de repente
    // e o acordar, e o que nunca se apaga no rosto.
    [
      "fiz botox há 2 anos e hoje meu rosto caiu de um lado",
      "rosto_caido_de_um_lado",
    ],
    ["fiz preenchimento há 3 meses e minha boca ficou torta", "boca_torta"],
    ["minha mãe fez botox e a boca dela ficou torta", "boca_torta"],
    ["quanto fica com o botox? minha boca ficou torta", "boca_torta"],
    [
      "fiz botox semana passada e de repente minha boca ficou torta",
      "boca_torta",
    ],
    ["fiz botox ontem e acordei com a boca torta", "boca_torta"],
    ["fiz harmonização e meu rosto ficou torto de um lado", "rosto_torto"],
    ["fiz botox e metade do rosto caiu", "rosto_caido_de_um_lado"],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });
});

describe("o estado permanente e o nariz com a rinoplastia (estética)", () => {
  it.each([
    "Meu rosto é torto, quero harmonização facial",
    "O lado direito do meu rosto é mais caído, quero corrigir",
    "Minha boca é torta, dá pra corrigir com preenchimento?",
    "Tenho a boca torta de nascença",
    "sempre tive a boca torta",
    "tenho o rosto torto de nascença",
    "Tenho dificuldade para respirar pelo nariz, quero fazer rinoplastia",
    "não consigo respirar pelo nariz, quero fazer rinoplastia",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it.each([
    // O estado de agora ("ta", "ficou") e o de repente continuam.
    ["meu rosto tá mais caído de um lado", "rosto_caido_de_um_lado"],
    ["a boca dela ficou torta do nada", "boca_torta"],
    [
      "sempre tive a boca torta, mas de repente ela entortou mais",
      "boca_torta",
    ],
    // O nariz sozinho, ou com a boca, continua (o lado conservador).
    ["não consigo respirar pelo nariz", "nao_consigo_respirar"],
    [
      "fiz rinoplastia ontem e não consigo respirar pelo nariz nem pela boca",
      "nao_consigo_respirar",
    ],
    ["minha boca caiu de um lado", "boca_torta"],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });
});

describe("a emergência da agenda do paciente (recepção)", () => {
  it.each([
    "Tenho uma emergência, preciso remarcar",
    // Revisao RR1: "estou com uma emergencia" e o estado de agora (urgencia,
    // no bloco da RR1, no fim).
    "Por motivo de emergência preciso cancelar",
    "preciso desmarcar, é uma emergência",
    "Vocês fazem atendimento de urgência e emergência?",
    "vocês têm pronto atendimento de emergência?",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it.each([
    // O pedido de ajuda na mesma mensagem desfaz; a agenda em outra
    // mensagem nao conta (cada mensagem e lida sozinha).
    [["é uma emergência, cancela tudo e me ajuda"]],
    [["socorro, tenho uma emergência, preciso remarcar"]],
    [["tenho uma emergência", "preciso remarcar"]],
    [["tenho uma emergência, preciso de ajuda"]],
  ])("%j: urgência", (textos) => {
    expect(detectarUrgencia(textos)?.sinal).toBe("emergencia");
  });
});

describe("o me matar: o eu, o sofrimento e o pronome continuam", () => {
  it.each([
    "hoje à noite eu ia me matar",
    "ontem à noite eu quase ia me matar",
    "se não fosse a minha filha eu ia me matar",
    "se não fosse a minha filha ia me matar",
    "se não fosse meu marido ia me matar",
    "essa tristeza tá me matando",
    "essa depressão vai me matar",
    "a vida tá me matando",
    "isso vai me matar",
    "minha mãe vai me matar",
    // Revisao RR1: a figura so com o objeto dito ("o preco", "a dieta"); o
    // marido, sem objeto, e a ameaca.
    "meu marido vai me matar",
  ])("%s: risco de vida", (texto) => {
    expect(urgente(texto)).toEqual({
      tipo: "risco_de_vida",
      sinal: "me_matar",
    });
  });

  it.each([
    "esse preço vai me matar",
    "essa dieta tá me matando",
    "esse trabalho vai me matar",
    "vocês vão me matar com esse preço",
    "vou me matar na academia pra ficar em forma",
  ])("%s: o exagero com sujeito concreto", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("as lacunas novas, com a negação, o antecedente e a terceira pessoa", () => {
  it.each([
    [
      "queria dormir e não acordar mais",
      "risco_de_vida",
      "dormir_e_nao_acordar",
    ],
    [
      "ela disse que queria dormir e não acordar mais",
      "risco_de_vida",
      "dormir_e_nao_acordar",
    ],
    // O risco de vida nunca tem antecedente.
    [
      "às vezes queria dormir e não acordar mais",
      "risco_de_vida",
      "dormir_e_nao_acordar",
    ],
    ["quero dormir pra sempre", "risco_de_vida", "dormir_e_nao_acordar"],
    ["não vejo mais sentido na vida", "risco_de_vida", "sem_sentido_na_vida"],
    [
      "não, não vejo mais sentido na vida",
      "risco_de_vida",
      "sem_sentido_na_vida",
    ],
    [
      "ela diz que não vê mais sentido na vida",
      "risco_de_vida",
      "sem_sentido_na_vida",
    ],
    ["vou me cortar", "risco_de_vida", "me_cortar"],
    ["tô me cortando de novo", "risco_de_vida", "me_cortar"],
    ["ela disse que vai se cortar", "risco_de_vida", "se_cortar"],
    ["ela não acorda", "fisica", "nao_acorda"],
    ["meu pai não acorda", "fisica", "nao_acorda"],
    ["ele não reage", "fisica", "nao_acorda"],
    ["ele tá morrendo", "fisica", "morrendo"],
    ["minha mãe está morrendo", "fisica", "morrendo"],
    ["ela apagou do nada", "fisica", "apagou"],
    ["meu pai apagou", "fisica", "apagou"],
    ["tou cum falta di ar", "fisica", "falta_de_ar"],
    ["ela tá cum falta di ar", "fisica", "falta_de_ar"],
  ] as const)("%s: %s (%s)", (texto, tipo, sinal) => {
    expect(urgente(texto)).toEqual({ tipo, sinal });
  });

  it.each([
    // A negacao.
    "não quero dormir e não acordar mais",
    "nunca pensei em me cortar",
    "ele não tá morrendo",
    "ela não apagou",
    "não tou cum falta di ar",
    // A historia (so nos fisicos). Revisao RR1: so a da propria pessoa (a da
    // terceira pessoa, "uma vez ela nao acordou", e urgencia, no fim).
    "uma vez eu não acordei e me levaram ao hospital",
    "ano passado eu tava morrendo de covid",
    "ano passado eu apaguei no shopping",
    "já tive falta di ar",
    // O que nao e o sinal.
    "tenho medo de dormir e não acordar na anestesia",
    "pode me cortar o cabelo?",
    "na lipo, vão me cortar onde?",
    "o médico vai me cortar muito?",
    "já me cortei com papel",
    "minha filha não acorda cedo, tem horário à tarde?",
    "minha pele não reage bem ao ácido",
    "to morrendo de rir",
    "to morrendo de vontade de fazer botox",
    "meu celular tá morrendo, depois te respondo",
    "Apaguei a mensagem sem querer",
    "ela apagou a foto",
    "apaguei de sono ontem",
    "eu vejo sentido na vida, só queria remarcar",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("a rede do sintoma no portão (me matando, caiu)", () => {
  const gatilhos = (texto: string) =>
    detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });

  it.each([
    "essa dieta tá me matando",
    "o rosto dela caiu",
    "meu rosto caiu",
    "caiu um lado do rosto",
    "minha mãe caiu e bateu a cabeça",
    "a sobrancelha caiu depois do botox",
    "a pressão dela caiu",
  ])("%s: escala como sintoma", (texto) => {
    expect(gatilhos(texto)).toContain("sintoma");
  });

  it.each([
    "o pix caiu?",
    "a ligação caiu, pode me chamar de novo?",
    "caiu na caixa postal",
    "o pagamento já caiu na conta de vocês?",
  ])("%s: o caiu da recepção não escala", (texto) => {
    expect(gatilhos(texto)).toEqual([]);
  });
});

describe("a versão do portão", () => {
  it("as fontes da urgência entram na versão do portão", () => {
    expect(fontesDoPortao().urgencia).toEqual(FONTES_DA_URGENCIA);
    expect(versaoDoPortao()).toBe(calcularVersaoDoPortao(fontesDoPortao()));
    // Mudar um sinal muda a versao.
    const outra = calcularVersaoDoPortao({
      ...fontesDoPortao(),
      urgencia: [...FONTES_DA_URGENCIA, "um sinal a mais"],
    });
    expect(outra).not.toBe(versaoDoPortao());
    // A versao de antes da AG6a (no ar desde a AG4) e a da ultima versao
    // conferida da AG6a (edd123c), antes da segunda revisao.
    expect(versaoDoPortao()).not.toBe("portao-7dc20c87b04a");
    expect(versaoDoPortao()).not.toBe("portao-1dd4b555a379");
    // A da 2a revisao (2ca2097), antes da revisao de 30/10/2026.
    expect(versaoDoPortao()).not.toBe("portao-39dcded69204");
    // A da 6eae43d, antes da correcao da lista (A1, M1 e M2).
    expect(versaoDoPortao()).not.toBe("portao-d2a3ee0b28c5");
    // A da d1a15f6, antes da revisao R2 (A1, A3, M2, M4, M5 e B5).
    expect(versaoDoPortao()).not.toBe("portao-04348f7f6108");
    expect(versaoDoPortao()).toMatch(/^portao-[0-9a-f]{12}$/);
  });
});

// Revisao de 6eae43d (a correcao da lista, sobre a revisao de motor e
// conformidade): os sinais novos (A1), o outro sinal de AVC que desfaz o
// procedimento e a estetica (M1) e as excecoes da estetica, da dor, da
// pergunta e da agenda (M2). Os casos tambem estao na bateria (CASOS, os
// CONTROLES e a NAO_REGRESSAO de bateria-ag6.test.ts); aqui, cada regra.
describe("os sinais novos de risco de vida (A1)", () => {
  it.each([
    ["Vou me enforcar hoje.", "enforcar"],
    ["VOU ME ENFORCAR", "enforcar"],
    ["ela tentou se enforcar", "enforcar"],
    ["Vou me jogar do prédio.", "pular_ou_se_jogar"],
    ["vou pular da ponte", "pular_ou_se_jogar"],
    ["minha filha disse que vai se jogar da janela", "pular_ou_se_jogar"],
    ["pensei em me jogar na frente de um carro", "pular_ou_se_jogar"],
    ["Tomei 20 comprimidos de rivotril.", "remedio_demais"],
    ["Tomei a cartela inteira de remédio pra dormir.", "remedio_demais"],
    ["tomei uns 15 comprimidos", "remedio_demais"],
    ["Eu tomei todos os comprimidos da cartela.", "remedio_demais"],
    ["ela tomou remédio demais", "remedio_demais"],
    ["vou tomar todos os meus remédios de uma vez", "remedio_demais"],
    // O "de uma vez" desfaz o tratamento de sempre.
    [
      "tomei todos os remédios que a doutora passou de uma vez",
      "remedio_demais",
    ],
    ["cortei os pulsos", "cortar_os_pulsos"],
    ["to me automutilando", "automutilacao"],
    ["minha filha se automutila", "automutilacao"],
    ["escrevi uma carta de despedida", "carta_de_despedida"],
    ["deixei um bilhete de despedida", "carta_de_despedida"],
    ["Não vejo mais motivo pra viver.", "sem_motivo_pra_viver"],
    ["não, não tenho motivo pra viver", "sem_motivo_pra_viver"],
    ["que motivo eu tenho pra viver?", "sem_motivo_pra_viver"],
    ["queria não ter nascido", "nao_ter_nascido"],
    ["eu não devia ter nascido", "nao_ter_nascido"],
    ["pra que eu nasci?", "nao_ter_nascido"],
  ])("%s: risco de vida (%s)", (texto, sinal) => {
    expect(urgente(texto)).toEqual({ tipo: "risco_de_vida", sinal });
  });

  it.each([
    "vou enforcar a sexta-feira e emendar o feriado",
    "quero pular o almoço",
    "vou me jogar nessa promoção de botox",
    "tomei 2 comprimidos de dipirona ontem, posso fazer o procedimento?",
    "a cartela do anticoncepcional acabou",
    "tomei todos os remédios que a doutora passou, posso tirar os pontos?",
    "tomei 3 comprimidos por dia de antibiótico, já posso fazer o laser?",
    "tomei 10 gotas de rivotril pra dormir, posso ir dirigindo?",
    "posso tomar 3 comprimidos de dipirona?",
    "não tomei 20 comprimidos",
    "cortei o dedo cozinhando, posso fazer a unha?",
    "vou fazer uma despedida de solteira, tem horário pra maquiagem?",
    "meus filhos são meu motivo pra viver",
    "queria ter nascido com o nariz menor kkk",
    "por que nasci com esse nariz?",
    "nunca pensei em me enforcar",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("os sinais físicos novos (A1)", () => {
  it.each([
    ["minha mãe tá roxa e não respira", "nao_respira"],
    ["ele ficou sem respirar", "nao_respira"],
    ["Minha mãe caiu e não tá respondendo.", "nao_responde"],
    ["ela tá roxa e não responde", "nao_responde"],
    ["ele não responde a nada", "nao_responde"],
    ["meu pai não está respondendo", "familia_nao_responde"],
    // O socorro devolve a urgencia mesmo com o assunto da recepcao.
    ["meu pai não está respondendo, liguei pro SAMU", "familia_nao_responde"],
    ["a boca do meu pai ficou torta", "boca_torta"],
    ["o rosto da minha mãe ficou torto de repente", "rosto_torto"],
    ["o rosto dela caiu", "rosto_caido_de_outra_pessoa"],
    ["não consigo mexer o braço direito", "nao_mexe_o_braco"],
    ["minha mãe não consegue mexer a perna", "nao_mexe_o_braco"],
    ["não sinto meu braço esquerdo", "nao_mexe_o_braco"],
    [
      "meu braço e minha perna do lado direito ficaram fracos de repente",
      "braco_ou_perna_fraco",
    ],
    ["de repente meu braço ficou sem força", "braco_ou_perna_fraco"],
    ["minha perna ficou dormente do nada", "braco_ou_perna_fraco"],
    ["tô com uma pressão no peito", "dor_no_peito"],
    ["sinto um peso no peito", "dor_no_peito"],
    ["coração apertado e uma dor que vai pro braço", "dor_que_vai_pro_braco"],
    ["uma dor que desce pro braço esquerdo", "dor_que_vai_pro_braco"],
    ["engoli um produto de limpeza", "engoliu_veneno"],
    ["minha filha bebeu água sanitária", "engoliu_veneno"],
    ["tomei veneno", "engoliu_veneno"],
  ])("%s: física (%s)", (texto, sinal) => {
    expect(urgente(texto)).toEqual({ tipo: "fisica", sinal });
  });

  it.each([
    "meu filho não respira pelo nariz, tem otorrino?",
    "fiquei sem respirar de tanto rir",
    "a clínica não está respondendo",
    "minha filha não está respondendo minhas mensagens",
    "vou confirmar com minha mãe, ela não está respondendo",
    // Revisao RR1: "minha mae nao responde, depois eu te aviso" e urgencia
    // (a terceira pessoa desfaz o "depois"; no fim). As mensagens, nao.
    "minha mãe não responde as mensagens, depois eu te aviso",
    "a ligação caiu e a moça não tá respondendo",
    "não consigo mexer a testa depois do botox, é normal?",
    "não consigo levantar o braço de dor no ombro",
    "acordei com o braço dormente",
    "tenho uma dor no ombro que desce pro braço, vocês têm ortopedista?",
    "dor nas costas que desce pra perna",
    "minha pressão subiu, posso fazer botox?",
    "tirei um peso do peito depois que conversei com a doutora",
    "tomei sol depois do ácido, é normal arder?",
    "tomei refrigerante, que é veneno",
    "comprei veneno de rato pra casa",
    // O "caindo" de outra pessoa e a flacidez. Revisao R2 de d1a15f6 (A1):
    // "o rosto dela caiu muito com a idade, vocês fazem fios?" voltou a ser
    // urgencia (a terceira pessoa nunca e estetica; urgencia-r2.test.ts).
    "o rosto da minha mãe tá caindo, vocês fazem lifting?",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("a visão (A1)", () => {
  it.each([
    [
      "Fiz preenchimento há 1 hora e estou perdendo a visão.",
      "perdendo_a_visao",
    ],
    [
      "Depois do preenchimento no nariz, minha vista escureceu.",
      "perdendo_a_visao",
    ],
    ["fiquei cega de um olho depois do preenchimento", "perdendo_a_visao"],
    ["escureceu minha vista", "perdendo_a_visao"],
    // A decisao desta revisao (o lado seguro): a vista que escurece ao
    // levantar fica urgencia (FALSOS_POSITIVOS_QUE_FICAM).
    ["a vista escureceu quando levantei rápido", "perdendo_a_visao"],
    ["não estou enxergando de um olho", "nao_enxerga"],
    ["não enxergo nada", "nao_enxerga"],
    ["não tô enxergando o lado esquerdo", "nao_enxerga"],
    // O procedimento feito desfaz o oculos e o grau.
    ["fiz botox e não tô enxergando direito sem os óculos", "nao_enxerga"],
  ])("%s: física (%s)", (texto, sinal) => {
    expect(urgente(texto)).toEqual({ tipo: "fisica", sinal });
  });

  it.each([
    "não estou enxergando bem de longe, vocês têm oftalmologista?",
    "estou perdendo a visão de perto, preciso de óculos?",
    "tenho medo de perder a visão com o preenchimento",
    "é verdade que preenchimento pode deixar cego?",
    "sou cega de um olho, posso fazer botox?",
    "não tô enxergando o link do pagamento",
    "não estou enxergando a diferença depois do botox",
    "minha pele escureceu depois do laser",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("o outro sinal de AVC desfaz o procedimento e a estética (M1)", () => {
  it.each([
    [
      "fiz botox ontem e agora minha boca ficou torta e meu braço tá dormente",
      "boca_torta",
    ],
    [
      "Fiz botox ontem. Agora minha boca ficou torta e meu braço está fraco.",
      "boca_torta",
    ],
    [
      "fiz preenchimento hoje e minha boca entortou, meu braço esquerdo tá formigando",
      "boca_torta",
    ],
    [
      "fiz harmonização ontem, meu rosto ficou torto e minha fala tá estranha",
      "rosto_torto",
    ],
    [
      "fiz botox e minha boca ficou torta e tô com muita dor de cabeça",
      "boca_torta",
    ],
    [
      "minha boca fica torta quando eu sorrio e meu braço tá fraco",
      "boca_torta",
    ],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });

  it("na rajada: o outro sinal em outra mensagem desfaz (lê a rajada inteira)", () => {
    expect(
      detectarUrgencia([
        "fiz botox ontem e minha boca ficou torta",
        "meu braço tá dormente",
      ])?.sinal,
    ).toBe("boca_torta");
    // Revisao R2 de d1a15f6 (A3): "a fala ta estranha" virou sinal proprio
    // (fala_enrolada); o formigamento da mao continua so desfazendo.
    expect(
      detectarUrgencia([
        "fiz harmonização e meu rosto ficou torto",
        "e minha mão tá formigando",
      ])?.sinal,
    ).toBe("rosto_torto");
  });

  it("revisão RR1: com o procedimento feito, a boca dormente e torta é urgência (o procedimento não é exceção)", () => {
    expect(
      urgente("fiz preenchimento e minha boca ficou torta e dormente")?.sinal,
    ).toBe("boca_torta");
    expect(
      detectarUrgencia([
        "fiz botox ontem e minha boca ficou torta",
        "e o lábio tá dormente",
      ])?.sinal,
    ).toBe("boca_torta");
  });
});

describe("a exceção estética da boca e do rosto: o pedido, a idade e o sorriso (M2)", () => {
  // Revisao R2 de d1a15f6 (A1): so com o OBJETO estetico ou o sorriso de
  // sempre, nunca com o agora, o lado, a queda ou a terceira pessoa ("minha
  // boca ta caindo de um lado com a idade" voltou a ser urgencia, abaixo).
  it.each([
    "minha boca fica torta quando eu sorrio",
    "tenho o rosto torto e queria harmonizar",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it.each([
    // Revisao RR1: o "ta" (o estado de agora) e o "entortou" (a mudanca)
    // desfazem o pedido com o objeto.
    ["minha boca tá meio torta, quero fazer preenchimento", "boca_torta"],
    [
      "o lado esquerdo do meu rosto tá mais caído, quero fazer fios",
      "rosto_caido_de_um_lado",
    ],
    [
      "minha boca entortou um pouco com o tempo, preenchimento resolve?",
      "boca_torta",
    ],
    // O "de repente" desfaz; "mais caido" sozinho nao e estetica.
    [
      "minha boca ficou torta de repente, quero fazer preenchimento",
      "boca_torta",
    ],
    ["o lado esquerdo do meu rosto tá mais caído", "rosto_caido_de_um_lado"],
    ["meu rosto tá mais caído de um lado", "rosto_caido_de_um_lado"],
    // O procedimento ja feito nunca e o pedido ("fiz botox", o efeito).
    [
      "fiz botox e metade do rosto caiu, dá pra corrigir?",
      "rosto_caido_de_um_lado",
    ],
    // A consulta nao e o pedido de procedimento.
    ["a boca do meu pai ficou torta, quero uma consulta", "boca_torta"],
    // Revisao R2 de d1a15f6 (A1): o lado nunca e estetica (antes AG6-C192).
    [
      "minha boca tá caindo de um lado com a idade, o que vocês indicam?",
      "boca_torta",
    ],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });
});

describe("a pergunta sobre o efeito, só nos sinais físicos (M2)", () => {
  it.each([
    "botox dá falta de ar?",
    "esse procedimento é perigoso? pode dar falta de ar?",
    "preenchimento pode causar falta de ar?",
    "botox causa convulsão?",
    "tem risco de dar falta de ar na anestesia?",
    "a anestesia pode me dar falta de ar?",
    "posso ter convulsão com a anestesia?",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it.each([
    // O relato presente nunca e a pergunta.
    ["botox dá falta de ar? tô com falta de ar agora", "falta_de_ar"],
    ["tô com falta de ar, botox dá falta de ar?", "falta_de_ar"],
    // "Me da" e o relato; "e normal" pode ser quem esta sentindo.
    ["me dá falta de ar, o que eu faço?", "falta_de_ar"],
    ["é normal dar falta de ar depois do botox?", "falta_de_ar"],
    // Sem o "?" nao e a pergunta.
    ["botox dá falta de ar", "falta_de_ar"],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });

  it("o risco de vida não tem a exceção da pergunta", () => {
    expect(urgente("isso dá vontade de morrer?")?.tipo).toBe("risco_de_vida");
  });
});

describe("a falta de ar do esforço de sempre (M2)", () => {
  it.each([
    "tenho falta de ar quando subo escada, posso fazer lipo?",
    "fico sem fôlego quando subo escada, posso fazer a lipo?",
    "fico sem ar quando corro",
  ])("%s: não é urgência (escala como sintoma)", (texto) => {
    expect(urgente(texto)).toBeNull();
    expect(
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] }),
    ).toContain("sintoma");
  });

  it("o agora na mesma oração continua urgente", () => {
    expect(
      urgente("tô com falta de ar agora, quando subo escada piora")?.sinal,
    ).toBe("falta_de_ar");
  });
});

describe("o me matando e o morrendo da estética e da dor (M2)", () => {
  it.each([
    "essas rugas estão me matando, quanto é o botox?",
    "essa papada tá me matando kkk",
    "essa flacidez tá me matando",
    "esse cabelo tá me matando",
    "essa dor nas costas tá me matando, tem horário com o ortopedista?",
    "essa dor nas minhas costas tá me matando",
    "minhas costas tão me matando",
    "rugas tão me matando",
    "essa enxaqueca tá me matando",
    "essa cólica tá me matando",
    "tô morrendo de dor nas costas",
    "tô morrendo de cólica",
    "meu cabelo tá morrendo",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it.each([
    "essa dor nas costas tá me matando, tem horário com o ortopedista?",
    "minhas costas tão me matando",
    "essa enxaqueca tá me matando",
    "essa cólica tá me matando",
    "tô morrendo de dor nas costas",
    "tô morrendo de cólica",
  ])("%s: a dor forte continua escalando como sintoma pelo portão", (texto) => {
    const gatilhos = detectarGatilhosDeEntrada({
      mensagens: [{ tipo: "texto", texto }],
    });
    expect(gatilhos).toContain("sintoma");
    expect(gatilhos).not.toContain("urgencia");
  });

  it.each([
    // O pronome, o sofrimento e a dor emocional continuam (na duvida,
    // urgente); o "pelo" de "pelo jeito" nao e o pelo do corpo.
    "isso tá me matando",
    "essa ansiedade tá me matando",
    "essa dor na alma tá me matando",
    "a dor dessa perda tá me matando",
    "a saudade tá me matando",
    "pelo jeito isso vai me matar",
    // O "morrer de dor" do risco de vida nao tem a excecao (so o
    // "morrendo", fisico).
    "quero morrer de dor",
  ])("%s: risco de vida", (texto) => {
    expect(urgente(texto)?.tipo).toBe("risco_de_vida");
  });

  it.each([
    ["essa dor no peito tá me matando", "dor_no_peito"],
    ["tô morrendo de dor no peito", "dor_no_peito"],
  ])("%s: a dor no peito continua física (%s)", (texto, sinal) => {
    expect(urgente(texto)).toEqual({ tipo: "fisica", sinal });
  });
});

describe("a emergência com o pedido de horário (M2)", () => {
  it.each(["tenho uma emergência estética kkk"])(
    "%s: não é urgência",
    (texto) => {
      expect(urgente(texto)).toBeNull();
    },
  );

  it.each([
    "é uma emergência, me ajuda, preciso de um horário agora",
    "é uma emergência, preciso de atendimento",
  ])(
    "%s: urgência (o pedido de ajuda e o atendimento não são a agenda)",
    (texto) => {
      expect(urgente(texto)?.sinal).toBe("emergencia");
    },
  );

  it.each([
    "Oi, é uma emergência! Preciso de um horário pra amanhã, tenho casamento.",
    "tenho uma emergência estética, preciso de um horário hoje",
    "é uma emergência, preciso encaixar hoje",
  ])(
    "%s: urgência (revisão RR1: a agenda só na frase do sinal, e o hoje desfaz)",
    (texto) => {
      expect(urgente(texto)?.sinal).toBe("emergencia");
    },
  );
});

// Revisao de 6eae43d (pedido do coordenador): a overdose (risco de vida), o
// ferimento grave e a complicacao do preenchimento ja feito (a oclusao
// vascular, a emergencia tipica da clinica de estetica). Os casos tambem
// estao na bateria (CASOS, CONTROLES, RAJADAS e a NAO_REGRESSAO).
describe("a overdose (risco de vida)", () => {
  it.each([
    "tomei uma overdose",
    "overdose de remédio",
    "ela teve uma overdose",
    "acho que é overdose",
    "OVERDOSE",
    // O risco de vida nao tem antecedente nem a excecao da vitamina dita.
    "já tive overdose",
    "tomei uma overdose de vitamina D",
    // Falar sobre (sem a reportagem, o video, a aula) pode ser a ideia.
    "minha filha anda falando sobre overdose",
  ])("%s: risco de vida", (texto) => {
    expect(urgente(texto)).toEqual({
      tipo: "risco_de_vida",
      sinal: "overdose",
    });
  });

  it.each([
    "o que é overdose de vitamina?",
    "existe overdose de botox?",
    "dá pra ter overdose de colágeno?",
    "vi uma reportagem sobre overdose",
    "essa foto é uma overdose de fofura",
    "uma overdose de amor kkk",
    "não foi overdose",
  ])("%s: não é urgência (a informação, a figura ou a negação)", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("o ferimento grave (físico)", () => {
  it.each([
    "levei um tiro",
    "fui baleado",
    "fui baleada",
    "fui esfaqueado",
    "levei uma facada",
    "meu filho levou um tiro",
    "meu marido levou uma facada",
    "ele levou três tiros",
    "atiraram no meu irmão",
    "deram uma facada nele",
    "minha filha foi atingida por bala perdida",
    "levei um tiro no pé",
    "acabou de levar um tiro",
    // O laser na mensagem nao apaga o tiro de verdade (sem os disparos
    // contados).
    "Meu filho levou um tiro, preciso cancelar a sessão de laser dele",
  ])("%s: física", (texto) => {
    expect(urgente(texto)).toEqual({
      tipo: "fisica",
      sinal: "ferimento_grave",
    });
  });

  it.each([
    "foi tiro e queda",
    "isso foi um tiro no pé",
    "dei um tiro no pé com esse corte de cabelo",
    "esse preço é uma facada",
    "levei uma facada nesse orçamento",
    "me meteram uma facada no preço da consulta",
    "levei 300 tiros de laser na axila",
    "levei uns 500 tiros na depilação, é normal arder?",
    "já levei um tiro na perna, posso fazer lipo?",
    "faço aula de tiro",
    "comprei uma bala de goma",
  ])("%s: não é urgência (a figura, o laser ou a história)", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("a complicação do preenchimento feito (a oclusão vascular)", () => {
  it.each([
    "fiz preenchimento ontem e minha visão tá embaçada",
    "fiz harmonização e estou vendo embaçado",
    "depois do preenchimento no nariz minha visão ficou turva",
    "fiz bioestimulador e tô enxergando duplo",
    "fiz preenchimento labial e o lábio ficou branco",
    "depois do preenchimento a pele ficou esbranquiçada",
    "fiz preenchimento no bigode chinês e a pele tá pálida",
    "fiz preenchimento e a pele tá rendilhada",
    "fiz preenchimento ontem e hoje o lábio tá roxo e frio",
    "fiz preenchimento ontem, tá roxo e espalhando",
    "depois do preenchimento ficou um roxo que tá aumentando",
    "fiz preenchimento e tô com uma dor muito forte no lábio",
    "fiz fios ontem e a dor só piora",
    "Meu lábio ficou roxo e muito dolorido depois do preenchimento.",
    "minha mãe fez preenchimento e o lábio dela tá branco",
    // A pergunta sobre o efeito nao apaga (semPergunta).
    "fiz preenchimento ontem, pode dar visão embaçada?",
  ])("%s: física", (texto) => {
    expect(urgente(texto)).toEqual({
      tipo: "fisica",
      sinal: "oclusao_do_preenchimento",
    });
  });

  // Revisao R2 de d1a15f6 (M2): a mancha sozinha so conta com o
  // preenchimento recente dito (sinal proprio).
  it("fiz a boca ontem e ela tá toda manchada: física (a mancha do preenchimento recente)", () => {
    expect(urgente("fiz a boca ontem e ela tá toda manchada")).toEqual({
      tipo: "fisica",
      sinal: "mancha_depois_do_preenchimento",
    });
  });

  it("o procedimento feito em outra mensagem da rajada também vale", () => {
    expect(
      detectarUrgencia([
        "fiz preenchimento labial hoje",
        "o lábio ficou branco",
      ])?.sinal,
    ).toBe("oclusao_do_preenchimento");
    expect(
      detectarUrgencia([
        "vou fazer preenchimento amanhã",
        "minha visão tá embaçada",
      ]),
    ).toBeNull();
  });

  it.each([
    // O roxo sozinho e o hematoma; o inchaco e a dor leve.
    "fiquei com um roxinho depois do preenchimento, é normal?",
    "ficou roxo onde furou",
    "fiz preenchimento e ficou roxo onde furou",
    "fiz preenchimento ontem e hoje o lábio tá inchado e roxinho, é normal?",
    "ficou um pouco inchado depois do preenchimento",
    "fiz preenchimento e tá um pouco dolorido, é normal?",
    // Sem o procedimento feito: nenhum, ou so pedido.
    "visão embaçada, vocês têm oftalmologista?",
    "quero preencher o lábio, ele é muito pálido",
    "vou fazer preenchimento amanhã, pode dar visão embaçada?",
    // A negacao e o que nao e a pele.
    "fiz preenchimento, o roxo não está espalhando",
    "fiz preenchimento, a dor não está piorando",
    "fiz preenchimento e meus dentes estão brancos",
    "meu fio de cabelo tá branco",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it("só a complicação do preenchimento não tem a exceção da pergunta", () => {
    expect(
      SINAIS_DE_EMERGENCIA.filter((s) => s.semPergunta === true).map(
        (s) => s.nome,
      ),
    ).toEqual([
      "oclusao_do_preenchimento",
      // Revisao R2 de d1a15f6 (M2): a mancha do preenchimento recente.
      "mancha_depois_do_preenchimento",
    ]);
  });
});
