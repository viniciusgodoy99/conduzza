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

/** Todas as fontes de um sinal: a dele e as excecoes. */
function fontesDoSinal(sinal: SinalDeEmergencia): string[] {
  return [
    sinal.fonte,
    sinal.excecaoAntes,
    sinal.excecaoDepois,
    sinal.excecaoNaOracaoAnterior,
    sinal.excecaoNaMensagem,
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
    expect(FONTES_DA_URGENCIA.slice(SINAIS_DE_EMERGENCIA.length, -2)).toEqual(
      [...REGRAS_DE_LEITURA_DA_URGENCIA],
    );
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

  it("a exceção da mensagem inteira vale na junção (o procedimento numa, a boca na outra)", () => {
    expect(
      detectarUrgencia(["fiz botox semana passada", "e minha boca ficou torta"]),
    ).toBeNull();
    // Sozinha, a boca torta e o sinal.
    expect(detectarUrgencia(["e minha boca ficou torta"])?.sinal).toBe(
      "boca_torta",
    );
  });

  it("nulos e vazios no meio não quebram a junção", () => {
    expect(detectarUrgencia(["to com dor", null, "  ", "no peito"])?.sinal).toBe(
      "dor_no_peito",
    );
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
    expect(urgente("não seria melhor eu morrer?")?.sinal).toBe(
      "melhor_morrer",
    );
    expect(urgente("melhor eu morrer de vergonha")).toBeNull();
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
    expect(versaoDoPortao()).toMatch(/^portao-[0-9a-f]{12}$/);
  });
});
