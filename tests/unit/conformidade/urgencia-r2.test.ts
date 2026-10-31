import { describe, expect, it } from "vitest";

import {
  detectarUrgencia,
  type TipoDeUrgencia,
} from "@/lib/domain/conformidade/urgencia";

// Revisao R2 de d1a15f6 (a segunda rodada da correcao da lista de urgencia):
// A1, a excecao estetica so com o objeto; A3, as grafias do risco de vida e
// os sinais novos para o RT (D-51), com os controles; M2, a oclusao do
// preenchimento; M4, a ameaca de verdade e as regras que generalizavam; M5,
// o recipiente nos dois generos; e os alarmes falsos que sairam pelo lado
// seguro. As matrizes geradas estao em urgencia-matrizes.test.ts; a nao
// regressao, em bateria-ag6.test.ts.

const urgente = (texto: string) => detectarUrgencia([texto]);

describe("A1: a exceção estética só com o objeto, nunca com o agora, o lado, a queda ou a terceira pessoa", () => {
  it.each([
    // O verbo generico sem o objeto (a matriz s4 do revisor).
    "minha boca ficou torta agora, quero tratar",
    "minha mae ta com a boca torta, queria fazer uma avaliacao hoje",
    "meu rosto ta torto, vou fazer uma consulta",
    "minha boca ta torta do lado esquerdo, quero fazer uma consulta",
    "a boca da minha vo entortou, tem como resolver hoje?",
    "o rosto da minha mae caiu, da pra tratar?",
    // O objeto com a terceira pessoa, o agora, o lado ou a queda.
    "a boca da minha mãe ficou torta, quero fazer preenchimento",
    "minha boca ficou torta agora, quero botox",
    "minha boca caiu de um lado, dá pra corrigir com botox?",
    "acordei com a boca torta, quanto custa o botox?",
    "o rosto dela caiu muito com a idade, vocês fazem fios?",
    "a boca dela entortou com a idade?",
    // O sorriso so no estado de sempre ("fica"), nunca na mudanca.
    "minha boca ficou torta quando eu sorrio",
    // A negacao do pedido.
    "minha boca ficou torta, não quero fazer botox",
  ])("%s: urgência", (texto) => {
    expect(urgente(texto)?.tipo).toBe("fisica");
  });

  it.each([
    "tenho o rosto torto e queria harmonizar",
    "minha boca fica torta quando eu sorrio",
  ])("%s: não é urgência (o objeto estético, sem a guarda)", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  // Revisao RR1 (a politica nova das excecoes): o "ta" e o "esta" (o estado
  // de agora) e o "entortou" (a mudanca), na oracao do sinal, desfazem o
  // pedido com o objeto; o pedido em outra oracao nao alcanca o sinal.
  it.each([
    "minha boca tá meio torta, quero fazer preenchimento",
    "o lado esquerdo do meu rosto tá mais caído, quero fazer fios",
    "minha boca entortou um pouco com o tempo, preenchimento resolve?",
    "minha boca tá torta no sorriso, dá pra corrigir com botox?",
    "quanto custa a harmonizacao? meu rosto ta torto de tanto dormir de lado kkk",
  ])(
    "%s: urgência (revisão RR1: o estado de agora e a mudança desfazem)",
    (texto) => {
      expect(urgente(texto)?.tipo).toBe("fisica");
    },
  );
});

describe("A3: as grafias do risco de vida", () => {
  it.each([
    "vou me mata",
    "vou me matá",
    "to pensando em me mata",
    "minha filha disse q vai se mata",
    "quero morre",
    "queria morre dormindo",
    "kero morrer",
    "qro morrer",
    "n quero mais viver",
    "ñ aguento mais viver",
    "naum quero mais viver",
    "vou tira minha vida",
    "vou pula da ponte",
    "vou me joga da janela",
    "vou acaba com tudo",
    "nao vale a pena viver",
    "morrer seria um alivio",
    "eu só queria sumir, acabar com tudo isso",
    "nao aguento mais essa vida",
    "nao tenho mais forcas pra viver",
    "eu nao quero mais acordar",
    "queria deitar e nao acordar nunca mais",
    "seria melhor pra todo mundo se eu nao existisse",
    "fiz uns cortes no braco ontem a noite de proposito",
  ])("%s: risco de vida", (texto) => {
    expect(urgente(texto)?.tipo).toBe("risco_de_vida");
  });

  it.each([
    "ela me mata de rir",
    "isso me mata de vergonha",
    "esse calor me mata",
    "não quero acordar cedo amanhã",
    "nao quero acordar ela",
    "nao vejo a hora de fazer o procedimento",
    "queria sumir de vergonha kkk",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("A3: os sinais novos para o RT, com os controles", () => {
  it.each<[string, string, TipoDeUrgencia]>([
    // O preenchimento: a giria, o acido, a necrose e a visao.
    ["fiz labial e ta tudo branco", "oclusao_do_preenchimento", "fisica"],
    [
      "fiz um labial ontem e o labio ta palido e frio",
      "oclusao_do_preenchimento",
      "fisica",
    ],
    [
      "coloquei acido no labio e ta branco",
      "oclusao_do_preenchimento",
      "fisica",
    ],
    [
      "fiz preenchimento no nariz ontem e a ponta ta ficando escura",
      "oclusao_do_preenchimento",
      "fisica",
    ],
    [
      "fiz preenchimento no nariz e a ponta ta acinzentada",
      "oclusao_do_preenchimento",
      "fisica",
    ],
    [
      "fiz preenchimento na olheira e de repente nao enxergo do olho direito",
      "nao_enxerga",
      "fisica",
    ],
    [
      "fiz preenchimento e nao vejo nada do olho direito",
      "nao_enxerga",
      "fisica",
    ],
    ["fiz preenchimento e to vendo tudo preto", "perdendo_a_visao", "fisica"],
    // O AVC.
    [
      "meu avo nao ta conseguindo falar nem mexer o lado direito",
      "nao_consegue_falar",
      "fisica",
    ],
    ["meu pai n consegue falar", "nao_consegue_falar", "fisica"],
    ["acho q é avc", "avc", "fisica"],
    ["minha vo ta com a fala embolada", "fala_enrolada", "fisica"],
    [
      "meu pai ta com o rosto paralisado de um lado",
      "rosto_caido_de_um_lado",
      "fisica",
    ],
    // A convulsao.
    ["meu filho teve uma convulção", "convulsao", "fisica"],
    ["ele ta convulsionano", "convulsao", "fisica"],
    ["minha filha ta tendo um ataque epileptico", "convulsao", "fisica"],
    // Os sinais novos.
    ["ta engasgado e roxo", "engasgo", "fisica"],
    ["meu filho ta engasgando", "engasgo", "fisica"],
    [
      "Meu filho engoliu uma bateria dessas de relógio.",
      "pilha_engolida",
      "fisica",
    ],
    ["meu vizinho foi atropelado", "atropelado", "fisica"],
    ["fui picado por cobra", "picada_de_animal", "fisica"],
    ["uma aranha mordeu meu filho", "picada_de_animal", "fisica"],
    ["inalei muito gas de cozinha", "gas_inalado", "fisica"],
    ["tem um vazamento de gas aqui e minha mae desmaiou", "desmaio", "fisica"],
    ["o gas ta vazando e to com dor de cabeca", "vazamento_de_gas", "fisica"],
    [
      "to de 8 meses e to com muita dor na barriga e sangrando",
      "gestante_sangrando",
      "fisica",
    ],
    ["to gravida e o bebe parou de mexer", "bebe_parou_de_mexer", "fisica"],
    ["nao sinto mais o bebe mexer", "bebe_parou_de_mexer", "fisica"],
    ["meu pai ta tossindo sangue", "vomito_com_sangue", "fisica"],
    ["meu bebe ta com os labios roxos", "labios_roxos", "fisica"],
    ["ficou confuso do nada", "confusao_mental", "fisica"],
    [
      "Moça, minha vó caiu no banheiro e não tá conseguindo levantar e tá meio confusa.",
      "confusao_mental",
      "fisica",
    ],
    ["tô com uma corda aqui pra acabar com tudo", "corda", "risco_de_vida"],
    ["todo mundo ficaria melhor sem mim", "melhor_sem_mim", "risco_de_vida"],
    [
      "o namorado da minha filha disse que vai matar ela",
      "ameaca_de_morte",
      "risco_de_vida",
    ],
  ])("%s: %s", (texto, sinal, tipo) => {
    expect(urgente(texto)).toEqual({ tipo, sinal });
  });

  it("o engasgo com o que vem com ele também é urgência (o primeiro sinal da lista vence)", () => {
    expect(urgente("engasgou e nao respira")?.tipo).toBe("fisica");
  });

  it("a rajada: o procedimento numa mensagem e o lábio branco na outra", () => {
    expect(
      detectarUrgencia(["fiz labial", "o labio ficou branco"])?.sinal,
    ).toBe("oclusao_do_preenchimento");
    expect(detectarUrgencia(["meu filho", "engoliu", "uma pilha"])?.sinal).toBe(
      "pilha_engolida",
    );
    expect(
      detectarUrgencia(["oi", "minha mae", "caiu", "ta sem responder"])?.sinal,
    ).toBe("nao_responde");
    expect(
      detectarUrgencia(["to grávida de 30 semanas", "to sangrando"])?.sinal,
    ).toBe("gestante_sangrando");
  });

  it.each([
    "engasguei com a água kkk",
    "ele engasgou mas já tá bem",
    "tenho medo de engasgar na anestesia",
    "a pilha do controle acabou",
    "o celular engoliu a bateria kkk",
    "quase fui atropelada kkk",
    "fui atropelado ano passado e fiquei com uma cicatriz, vocês tratam?",
    "fui picada por mosquito e coçou muito",
    "vi uma cobra no quintal",
    "fiz escleroterapia nas aranhas vasculares",
    "já fui picada por escorpião uma vez",
    "o gás acabou, vou trocar o botijão",
    "o botijão tá vazando, já chamei o técnico",
    "tô grávida, posso fazer botox?",
    "fiz exame de sangue, tô grávida de 3 meses",
    "na minha primeira gravidez tive sangramento, posso fazer limpeza de pele?",
    "o bebê dormiu e parou de chorar",
    "vomitei ontem, posso fazer o procedimento amanhã?",
    "meu batom roxo acabou",
    "meus lábios ficam roxos de frio",
    "fiz preenchimento e o lábio ficou roxinho onde furou",
    "fiquei confusa com os preços",
    "tô confusa, qual o horário?",
    "o fim de semana seria um alívio",
    "vou sumir do mapa esse fim de semana",
    "eles ficaram melhor sem o filtro",
    "comprei uma corda pra pular na academia",
    "ela disse que vai matar a saudade da clínica",
    "meu filho matou aula hoje",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("M2: a oclusão do preenchimento (o antigo, a mancha sozinha, a história de outra pessoa)", () => {
  it.each([
    "fiz harmonizacao ha 2 anos, minha pele ta manchada, voces fazem peeling?",
    "ja fiz preenchimento labial, minha boca é muito branquinha, tem como dar cor?",
    "fiz preenchimento ano passado, agora quero tratar as manchas, minha pele ta muito manchada",
    "ja fiz harmonizacao e agora quero tratar o melasma, a pele ta muito manchada",
    "fiz fios ha 1 ano, voces fazem laser? minha pele ta manchada do sol",
    "fiz preenchimento mes passado e amei, agora quero botox, meu rosto ta muito manchado de sol",
    "fiz preenchimento ha 6 meses e to com o rosto todo manchado de melasma",
    "fiz bioestimulador ano passado e quero fazer de novo, minha pele ta muito flacida e manchada",
    "a pele dela é escura, preenchimento resolve?",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it.each([
    // O relato presente de outra pessoa conta.
    "minha amiga fez preenchimento ontem e o labio ta branco",
    // O antigo com o agora.
    "fiz harmonizacao ha 2 anos e hoje o labio ficou branco",
    // A historia com o relato da propria pessoa.
    "vi no instagram que preenchimento deixa a pele branca, fiz ontem e a minha ta branca, é isso?",
    // O "e" de "roxo e frio" (a guarda do "e" so nas duas primeiras
    // palavras).
    "fiz labial ontem e o labio ta roxo e frio",
    // A mancha com o preenchimento recente.
    "fiz a boca ontem e ela tá toda manchada",
    // Revisao RR1: a historia de outra pessoa com o "ficou" (a mudanca) na
    // oracao do sinal e o relato (a pergunta nao e pura).
    "conheço uma moça que ficou cega depois de preenchimento, isso é comum?",
  ])("%s: urgência", (texto) => {
    expect(urgente(texto)?.tipo).toBe("fisica");
  });
});

describe("M4: a ameaça de verdade desfaz o sujeito concreto", () => {
  it.each([
    "meu marido disse que vai me matar",
    "meu marido vai me matar, ele ta com uma faca",
    "meu namorado falou que vai me matar hoje",
    "meu marido ameacou me matar",
    "meu marido ta me batendo e vai me matar",
    "meu marido vai me matar de pancada",
    // Revisao RR1: a terceira pessoa (o marido) desfaz o exagero; a figura
    // so vale com o objeto dito ("essa conta").
    "meu marido vai me matar se eu gastar mais",
    "meu marido vai me matar",
  ])("%s: risco de vida", (texto) => {
    expect(urgente(texto)?.tipo).toBe("risco_de_vida");
  });

  it.each(["essa conta vai me matar kkk"])(
    "%s: não é urgência (o exagero)",
    (texto) => {
      expect(urgente(texto)).toBeNull();
    },
  );

  it.each([
    // As regras que generalizavam (variantes geradas de cada excecao).
    ["bateu o nariz e nao respira", "nao_respira"],
    ["meu celular ta morrendo e minha mae ta morrendo", "morrendo"],
    ["to na sala de espera e to sem ar", "sem_ar"],
    ["meu pai tem historico de avc e acho que ta tendo outro avc agora", "avc"],
    ["uso oculos e perdi a visao do olho direito", "perdendo_a_visao"],
    ["uso oculos e minha vista ficou toda preta", "perdendo_a_visao"],
    // Revisao RR1: o nariz entupido de outra pessoa nao apaga o "nao
    // respira" (a terceira pessoa e o "ta" desfazem).
    ["o nariz dele ta entupido e ele nao respira", "nao_respira"],
  ])("%s: urgência (%s)", (texto, sinal) => {
    expect(urgente(texto)?.sinal).toBe(sinal);
  });

  it.each([
    "meu nariz não está respirando direito",
    "sou cega de um olho, posso fazer botox?",
    "a sala ta sem ar condicionado",
    "a sala de espera tava sem ar, morri de calor",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("M5: o recipiente nos dois gêneros", () => {
  it.each([
    "tomei um vidro de remedio",
    "Então, eu tomei um vidro inteiro de remédio pra dormir.",
    "engoli um vidro de rivotril",
    "tomei um frasco inteiro de dipirona",
    "tomei o vidro inteiro de dipirona",
    "tomei a caixa inteira",
    "meu filho tomou o xarope inteiro",
    "meu filho tomou os remedios da vo tudo",
    "ja separei os comprimidos pra tomar tudo de uma vez",
    "tomei 20 comprimidos que a doutora passou",
  ])("%s: risco de vida", (texto) => {
    expect(urgente(texto)?.tipo).toBe("risco_de_vida");
  });

  it.each([
    "tomei o pote inteiro de sorvete",
    "tomei todos os remedios que a doutora passou",
    "a cartela do anticoncepcional acabou",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });
});

describe("os alarmes falsos que saíram pelo lado seguro", () => {
  it.each([
    // A pergunta sobre o efeito com "pode deixar".
    "botox pode deixar a boca torta?",
    // A hipotese.
    "tenho pavor de ficar com a boca torta, o botox pode fazer isso?",
    "e se eu tiver uma reação alergica forte no procedimento, voces tem estrutura?",
    // A figura do preco e do riso.
    "o preço me deixou sem ar kkkk",
    "esse orçamento me deixou sem ar",
    "fiquei sem folego com o preço kkk",
    "fiquei sem ar quando vi o resultado do botox, ficou lindo",
    "gente to morrendo com esse preço",
    "amei o resultado, to morrendo kkkkk",
    "to morrendo aqui de ansiedade pro procedimento amanha",
    "quase desmaiei quando vi a conta kkk",
    // A pergunta do servico. Revisao RR1: a agenda em OUTRA frase ("pode
    // marcar um encaixe? e uma emergencia") nao alcanca o sinal (urgencia).
    "vcs atendem pelo convenio em caso de urgencia e emergencia?",
  ])("%s: não é urgência", (texto) => {
    expect(urgente(texto)).toBeNull();
  });

  it.each([
    // O relato de agora desfaz a pergunta e a hipotese.
    "botox pode dar falta de ar? to sentindo agora",
    "fiz botox ontem, pode dar falta de ar?",
    "tenho medo de ter falta de ar, me ajuda",
    // A piora e o pedido de ajuda desfazem a figura.
    "o preco me deixou sem ar e de repente piorou",
    "quase desmaiei e to tonta",
    // A agenda com quem passa mal.
    "tenho uma emergencia, minha mae ta passando mal, preciso remarcar",
    // Revisao RR1: a agenda so na frase do sinal.
    "pode marcar um encaixe? é uma emergencia, tenho formatura sabado",
  ])("%s: urgência", (texto) => {
    expect(urgente(texto)).not.toBeNull();
  });
});
