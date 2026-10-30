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

/** Todas as fontes de um sinal: a dele, as excecoes e o que as desfaz. */
function fontesDoSinal(sinal: SinalDeEmergencia): string[] {
  return [
    sinal.fonte,
    sinal.excecaoAntes,
    sinal.excecaoDepois,
    sinal.excecaoNaOracaoAnterior,
    sinal.excecaoNaMensagem,
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

  // Revisao de 30/10/2026: a excecao da mensagem le so a MESMA mensagem do
  // sinal, nunca a rajada inteira (na 2a revisao, o procedimento numa
  // mensagem apagava a boca torta da outra).
  it("a exceção da mensagem lê só a mensagem do sinal (o procedimento numa, a boca na outra: urgência)", () => {
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
    // Na mesma mensagem, o efeito do procedimento (D-51) segue sem a marca.
    expect(
      detectarUrgencia([
        "oi",
        "fiz botox semana passada e minha boca ficou torta",
      ]),
    ).toBeNull();
    // O sinal que atravessa as mensagens le todas as que ele toca.
    expect(
      detectarUrgencia(["fiz botox ontem e minha boca", "ficou torta"]),
    ).toBeNull();
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
    "vi uma reportagem sobre AVC hoje",
    "acho que vou ter um AVC de tanto estresse",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("a outra pessoa", () => {
  it.each([
    ["meu marido vai me matar", null],
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
    "minha mãe parou de respirar ano passado e faleceu",
    "uma vez ela tava morrendo de covid",
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
    // Quem esta ocupado, na mesma mensagem (antes ou depois).
    "Agora não consigo falar, me manda mensagem",
    "Não consigo falar, estou numa reunião",
    "Estou no trabalho, não consigo falar, pode mandar mensagem",
    "não consigo falar, te ligo mais tarde",
  ])("%s: a ligação, não a fala", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("o procedimento só na mesma mensagem, na primeira pessoa e recente", () => {
  it.each([
    "fiz botox e minha boca ficou torta",
    "minha boca ficou torta depois do botox",
    "fiz harmonização e meu rosto ficou torto",
    "Fiz preenchimento labial ontem. Hoje minha boca está torta.",
  ])("%s: efeito do procedimento (sintoma, sem a marca)", (texto) => {
    expect(urgente(texto)).toBeNull();
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
    "Estou com uma emergência, não vou poder ir",
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
  ])("%s: risco de vida", (texto) => {
    expect(urgente(texto)).toEqual({
      tipo: "risco_de_vida",
      sinal: "me_matar",
    });
  });

  it.each([
    "meu marido vai me matar",
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
    // A historia (so nos fisicos).
    "uma vez ela não acordou e levamos ao hospital",
    "ano passado ele tava morrendo",
    "uma vez ela apagou do nada no shopping",
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
    expect(versaoDoPortao()).toMatch(/^portao-[0-9a-f]{12}$/);
  });
});
