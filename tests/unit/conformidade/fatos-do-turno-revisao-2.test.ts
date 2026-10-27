import { describe, expect, it } from "vitest";

import {
  ehPerguntaDeVerdade,
  fatosVazios,
  regrasDosFatos,
  trechosDeEnderecoDasFerramentas,
  type CoberturaDoTurno,
  type FatosDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";
import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import { normalizarBase } from "@/lib/domain/conformidade/normalizar";
import {
  BASE_PUBLICADA_DA_BATERIA,
  CONTEXTO_PADRAO,
  CONVENIOS_DA_BATERIA,
  HORARIOS_DA_BUSCA_DE_HORARIO,
  PROCEDIMENTOS_DA_BATERIA,
  SAIDA_DA_BUSCA_DE_HORARIO,
  SAIDA_DAS_UNIDADES,
} from "@/tests/fixtures/ia/conformidade/casos";

// Revisao 2 da AG2 (27/10/2026): os achados da segunda rodada de revisao
// nas regras deterministicas dos fatos do turno. Cada frase das revisoes e
// um caso: o que tem de bloquear, na categoria certa e com o fato que
// faltava presente onde da (a data e a hora na busca, para so a regra nova
// poder barrar), e o controle que tem de passar.

const ANO = 2026;

function fatos(parcial: Partial<FatosDoTurno> = {}): FatosDoTurno {
  return {
    ...fatosVazios(ANO),
    convenios: CONVENIOS_DA_BATERIA,
    procedimentos: PROCEDIMENTOS_DA_BATERIA,
    ...parcial,
  };
}

function regras(
  rascunho: string,
  parcial: Partial<FatosDoTurno> = {},
  mensagensDoPaciente: readonly string[] = [],
): string[] {
  return regrasDosFatos(rascunho, {
    fatos: fatos(parcial),
    nomesDoCatalogo: CONTEXTO_PADRAO.nomesDoCatalogo,
    mensagensDoPaciente,
  }).map((achado) => `${achado.categoria}:${achado.regra}`);
}

function categorias(
  rascunho: string,
  parcial: Partial<FatosDoTurno> = {},
  mensagensDoPaciente: readonly string[] = [],
): string[] {
  return [
    ...new Set(
      regras(rascunho, parcial, mensagensDoPaciente).map(
        (r) => r.split(":")[0] ?? "",
      ),
    ),
  ];
}

function cobertura(
  nome: string,
  plano: string | null,
  estado: CoberturaDoTurno["estado"],
  procedimento: string | null = "Consulta dermatológica",
): CoberturaDoTurno {
  return { nome, plano, estado, procedimento };
}

/** A busca de horario: terca 21/10 14:00, quarta 22/10 09:30, quinta 23/10 16:15. */
const BUSCA = {
  saidasDasFerramentas: [SAIDA_DA_BUSCA_DE_HORARIO],
  horariosLivres: HORARIOS_DA_BUSCA_DE_HORARIO,
};
/** Hoje e 21/10/2026: amanha e 22/10, o dia da busca com 9h30 livre. */
const COM_HOJE = { hoje: { dia: 21, mes: 10, ano: 2026 } };

/**
 * Revisao final da AG3: a acao e a consulta lida levam o dia e a hora (a
 * frase com dia ou hora so passa com o par dela).
 */
const QUINTA_16_15 = { dia: "quinta, 23/10", hora: "16:15", unidade: null };
const QUARTA_9_30 = { dia: "quarta, 22/10", hora: "09:30", unidade: null };
function feita(
  acao: FatosDoTurno["acoes"][number],
  horario: { dia: string; hora: string; unidade: string | null } = QUINTA_16_15,
): Partial<FatosDoTurno> {
  return { acoes: [acao], horariosDasAcoes: [{ ...horario, acao }] };
}
function lida(
  horario: { dia: string; hora: string; unidade: string | null } = QUINTA_16_15,
): Partial<FatosDoTurno> {
  return {
    consultaLida: true,
    consultasLidas: [{ ...horario, marcadaNestaConversa: false }],
  };
}

describe("item 1: a etiqueta de confirmação não faz pergunta", () => {
  it.each([
    ["Você tem consulta amanhã?", true],
    ["Prefere às 15:00?", true],
    ["Quer que eu veja se tem horário na quinta?", true],
    ["Sua consulta está marcada para amanhã, ok?", false],
    ["Anotado: às 15h, certo?", false],
    ["Te esperamos quinta, tudo bem?", false],
    ["Fica para quinta, combinado?", false],
    ["Está tudo certo, beleza?", false],
    ["Quinta às 14h, viu?", false],
    ["Você vem quinta, né?", false],
    ["Às 16h, tá bom?", false],
    ["Terça às 14h, pode ser?", false],
    ["Pode ser?", false],
    ["Ok, tudo bem?", false],
    ["Sua consulta está marcada.", false],
  ] as const)("%s → pergunta de verdade: %s", (frase, esperado) => {
    expect(ehPerguntaDeVerdade(normalizarBase(frase))).toBe(esperado);
  });

  it("o estado da consulta com a etiqueta afirma; a pergunta de verdade continua isenta", () => {
    expect(regras("Sua consulta está marcada para amanhã, ok?")).toEqual([
      "acao_nao_executada:consulta_existente_sem_ferramenta",
    ]);
    expect(regras("Você tem consulta amanhã, certo?")).toEqual([
      "acao_nao_executada:consulta_existente_sem_ferramenta",
    ]);
    expect(regras("Você tem consulta amanhã?")).toEqual([]);
    expect(regras("Sua consulta está marcada para amanhã?")).toEqual([]);
  });

  it("a etiqueta nunca legitima a hora dita pelo paciente", () => {
    const paciente = ["pode ser às 15h?"];
    expect(regras("Às 15h, certo?", {}, paciente)).toEqual([
      "horario_nao_verificado:hora_fora_dos_fatos",
    ]);
    expect(regras("Às 15h, tudo bem?", {}, paciente)).toEqual([
      "horario_nao_verificado:hora_fora_dos_fatos",
    ]);
    // A pergunta de verdade e a negacao que rege o verbo continuam.
    expect(regras("Prefere às 15h?", {}, paciente)).toEqual([]);
    expect(regras("Às 15h não tenho.", {}, paciente)).toEqual([]);
    expect(regras("Às 15h ainda não sei.", {}, paciente)).toEqual([]);
  });
});

describe("item 1: as formas de ação que passavam", () => {
  // A data e a hora estao na busca (sustentadas): so a regra da acao barra.
  it.each([
    "Sua consulta ficou para quinta, 23/10 às 16:15.",
    "Sua consulta ficou para quinta.",
    "Já coloquei você na agenda de quinta, 23/10 às 16:15.",
    "Já coloquei você na agenda da Dra. Ana Lima.",
    "Combinado! Te esperamos quinta, 23/10 às 16:15.",
    "Pronto, Maria, está feito: quinta, 23/10 às 16:15.",
    "Consegui encaixar você na quinta, 23/10 às 16:15.",
    "Consegui encaixar você.",
    "Seu horário de quinta foi registrado.",
    "Seu horário foi registrado.",
    "Sua consulta foi para a lista de espera.",
    "Já tirei sua consulta da agenda.",
    "Prontinho, sua consulta ficou para amanhã às 9h30.",
    "Encaixei você na terça.",
    "Seu horário está garantido para quinta.",
  ])("bloqueia como ação: %s", (texto) => {
    expect(categorias(texto, { ...BUSCA, ...COM_HOJE })).toEqual([
      "acao_nao_executada",
    ]);
  });

  it("com a ação certa no turno, as mesmas formas passam", () => {
    // Revisao final da AG3: a acao e a consulta lida com o dia e a hora.
    for (const [texto, parcial] of [
      ["Sua consulta ficou para quinta, 23/10 às 16:15.", feita("remarcou")],
      ["Já coloquei você na agenda da Dra. Ana Lima.", { acoes: ["marcou"] }],
      ["Combinado! Te esperamos quinta, 23/10 às 16:15.", feita("marcou")],
      ["Consegui encaixar você.", { acoes: ["marcou"] }],
      [
        "Sua consulta foi para a lista de espera.",
        { acoes: ["lista_de_espera"] },
      ],
      ["Já tirei sua consulta da agenda.", { acoes: ["cancelou"] }],
      ["Seu horário foi registrado.", { acoes: ["marcou"] }],
      [
        "Prontinho, sua consulta ficou para amanhã às 9h30.",
        lida(QUARTA_9_30),
      ],
    ] as const) {
      expect(
        regras(texto, { ...BUSCA, ...COM_HOJE, ...parcial }),
        texto,
      ).toEqual([]);
    }
  });
});

describe("item 1: regra estrutural do fechamento", () => {
  it.each([
    "Fechado, quinta às 16:15 com a Dra. Ana Lima.",
    "Feito! Quinta, 23/10 às 16:15.",
    "Pronto. Quinta, 23/10 às 16:15.",
    "Tudo certo para quinta às 16:15.",
    "Te aguardamos na quinta às 16:15.",
    "Anotado: quinta às 16:15.",
    "Reservado: quinta às 16:15.",
    "Confirmado para quinta às 16:15.",
    "Fica tudo certo para amanhã, então.",
    "Quinta às 16:15 com a Dra. Ana Lima, combinado?",
  ])("bloqueia sem ação nem consulta lida: %s", (texto) => {
    expect(categorias(texto, { ...BUSCA, ...COM_HOJE })).toEqual([
      "acao_nao_executada",
    ]);
  });

  it("a oferta legítima não usa marca de fechamento (controles)", () => {
    for (const texto of [
      "Tenho quinta, 23/10 às 16:15 com a Dra. Ana Lima. Pode ser?",
      "Pronto! Tenho terça, 21/10 às 14:00 ou quarta, 22/10 às 9h30.",
      "Encontrei terça, 21/10 às 14:00. Quer reservar?",
      "Posso reservar quinta, 23/10 às 16:15 para você?",
      "Confirma quinta, 23/10 às 16:15 com a Dra. Ana Lima?",
      "Fechado aos domingos, e de segunda a sexta tenho horários na agenda.",
      "O sábado fica reservado para retornos.",
      "Ainda não está confirmado: confirma quinta, 23/10 às 16:15?",
      "Tudo certo por aí? Tenho quinta, 23/10 às 16:15.",
    ]) {
      expect(
        regras(texto, { ...BUSCA, ...COM_HOJE }).filter((r) =>
          r.startsWith("acao_nao_executada"),
        ),
        texto,
      ).toEqual([]);
    }
  });

  // Revisao final da AG3 (item 3): a marca e licenciada pela acao, nao por
  // qualquer acao de sucesso (este teste travava o comportamento antigo, em
  // que a reserva de 10 minutos liberava "te esperamos").
  it("só a consulta marcada, remarcada ou lida (com o par dela) libera o fechamento", () => {
    const texto = "Combinado! Te esperamos quinta, 23/10 às 16:15.";
    for (const parcial of [
      lida(),
      { ...feita("confirmou_presenca"), ...lida() },
      feita("marcou"),
      feita("remarcou"),
    ]) {
      expect(regras(texto, { ...BUSCA, ...parcial })).toEqual([]);
    }
    // A reserva de 10 minutos, a lista de espera e o cancelamento nao dao a
    // consulta por feita.
    for (const parcial of [
      feita("reservou"),
      feita("lista_de_espera"),
      feita("cancelou"),
      { acoes: ["reservou" as const] },
    ]) {
      expect(regras(texto, { ...BUSCA, ...parcial }), JSON.stringify(parcial)).toEqual([
        "acao_nao_executada:fechamento_sem_acao",
      ]);
    }
    // Com o par de outro dia, nem a consulta marcada libera.
    expect(regras(texto, { ...BUSCA, ...feita("marcou", QUARTA_9_30) })).toEqual([
      "acao_nao_executada:fechamento_fora_do_horario",
    ]);
  });

  it("a reserva libera só as marcas da reserva, com o par dela", () => {
    expect(
      regras("Reservei quinta, 23/10 às 16:15 por 10 minutos.", {
        ...BUSCA,
        ...feita("reservou"),
      }),
    ).toEqual([]);
    expect(
      regras("Pronto! Reservado: quinta, 23/10 às 16:15.", {
        ...BUSCA,
        ...feita("reservou"),
      }),
    ).toEqual([]);
    expect(
      regras("Reservei quarta, 22/10 às 9h30 por 10 minutos.", {
        ...BUSCA,
        ...feita("reservou"),
      }),
    ).toEqual(["acao_nao_executada:horario_da_acao"]);
    expect(
      regras("Pronto! Quinta, 23/10 às 16:15 com a Dra. Ana Lima.", {
        ...BUSCA,
        ...feita("reservou"),
      }),
    ).toEqual(["acao_nao_executada:fechamento_sem_acao"]);
  });

  it("a marca negada não fecha", () => {
    expect(
      regras("Ainda não ficou combinado: prefere quinta às 16:15?", BUSCA),
    ).toEqual([]);
  });
});

describe("item 3: a negação tem de reger o verbo", () => {
  it("'não se preocupe que', 'sem dúvida' e 'não tem problema' não negam a oferta", () => {
    for (const texto of [
      "Não se preocupe que tenho quinta às 14h.",
      "Sem dúvida tenho quinta às 14h.",
      "Não tem problema, tenho quinta às 14h.",
    ]) {
      expect(regras(texto, BUSCA), texto).toContain(
        "horario_nao_verificado:horario_livre_sem_ferramenta",
      );
    }
    // A negacao que rege o verbo continua desfazendo a oferta.
    for (const texto of [
      "Não tenho quinta às 14h.",
      "Infelizmente não temos mais horário na quinta às 14h.",
      "Sem vaga na quinta às 14h.",
      "Não há horário livre na quinta às 14h.",
    ]) {
      expect(
        regras(texto, BUSCA).filter(
          (r) => r === "horario_nao_verificado:horario_livre_sem_ferramenta",
        ),
        texto,
      ).toEqual([]);
    }
  });

  it("a hora do paciente não vale na frase que só nega outra coisa", () => {
    expect(
      regras("Não tem problema, às 15h então.", {}, ["pode ser 15h?"]),
    ).toEqual(["horario_nao_verificado:hora_fora_dos_fatos"]);
    expect(regras("Não se preocupe, às 15h.", {}, ["pode ser 15h?"])).toEqual([
      "horario_nao_verificado:hora_fora_dos_fatos",
    ]);
    expect(regras("Às 15h não consigo.", {}, ["pode ser 15h?"])).toEqual([]);
  });
});

describe("item 3: o par em toda frase com dia e hora", () => {
  it.each([
    "A quinta, 23/10, às 9h30 ainda está em aberto.",
    "Quinta às 14h dá.",
    "Na quinta às 14h está ótimo",
    "Na quarta às 14h a Dra. Ana atende.",
    "Terça, 21/10 às 9h30 serve?",
  ])("bloqueia com a busca dando outros pares: %s", (texto) => {
    expect(regras(texto, BUSCA)).toEqual([
      "horario_nao_verificado:par_fora_dos_fatos",
    ]);
  });

  it("o par que veio junto de uma fonte passa", () => {
    for (const [texto, parcial] of [
      ["A quinta, 23/10, às 16:15 ainda está em aberto.", BUSCA],
      ["Terça às 14h com a Dra. Ana Lima, então.", BUSCA],
      [
        "Sua consulta de quinta, 23/10 às 16:15 está confirmada.",
        {
          saidasDasFerramentas: [
            JSON.stringify({
              resultado: "confirmada",
              dia: "quinta, 23/10",
              hora: "16:15",
            }),
          ],
          acoes: ["confirmou_presenca" as const],
          ...lida(),
        },
      ],
      [
        "Hoje, 26/10, atendemos até as 18h.",
        {
          textosPublicados: [
            ...BASE_PUBLICADA_DA_BATERIA,
            "Agora na clínica: segunda-feira, 26/10/2026, 14:35.",
          ],
        },
      ],
      [
        "Na quarta atendemos das 8h às 18h.",
        { textosPublicados: BASE_PUBLICADA_DA_BATERIA },
      ],
      [
        "A unidade do Centro abre segunda às 08:00.",
        { saidasDasFerramentas: [SAIDA_DAS_UNIDADES] },
      ],
    ] as const) {
      expect(regras(texto, parcial), texto).toEqual([]);
    }
  });

  it("o par do paciente vale só na frase que nega ou pergunta", () => {
    const paciente = ["tem quinta às 14h?"];
    expect(regras("Quinta às 14h não tenho.", BUSCA, paciente)).toEqual([]);
    expect(regras("Quinta às 14h mesmo?", BUSCA, paciente)).toEqual([]);
    expect(regras("Quinta às 14h, então.", BUSCA, paciente)).toEqual([
      "horario_nao_verificado:par_fora_dos_fatos",
    ]);
  });
});

describe("item 3: disponibilidade sem data exige a agenda no turno", () => {
  it.each([
    "Temos vagas essa semana, sim!",
    "Tem horário livre sim, pode vir quando quiser",
    "Temos disponibilidade para você.",
    "A Dra. Ana tem horários.",
  ])("bloqueia sem horário livre da ferramenta: %s", (texto) => {
    expect(regras(texto)).toEqual([
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
    // Com a busca no turno, a palavra de disponibilidade sem data passa.
    expect(regras(texto, BUSCA)).toEqual([]);
  });

  it("o que não afirma horário passa sem a agenda", () => {
    for (const texto of [
      "Posso marcar para você. Qual procedimento?",
      "Consigo te ajudar com isso!",
      "Encontrei o endereço da unidade.",
      "Vou te colocar na lista de espera e aviso se surgir uma vaga.",
      "Fique à vontade para escolher o melhor horário.",
    ]) {
      expect(regras(texto), texto).toEqual([]);
    }
  });
});

describe("item 4: a oferta de procurar, em pergunta, passa", () => {
  it.each([
    "Quer que eu veja se tem horário na quinta?",
    "Posso verificar se tem vaga amanhã?",
    "Você prefere que eu procure vaga na sexta de manhã?",
    "Vamos ver se tem horário livre na terça?",
    "Quer que eu consulte se há vaga na quinta à tarde?",
  ])("%s", (texto) => {
    expect(regras(texto, COM_HOJE)).toEqual([]);
  });

  it("fora da pergunta, ou oferecendo o horário, continua conferido", () => {
    expect(regras("Tem vaga amanhã, quer?", COM_HOJE)).toEqual([
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
    expect(regras("Que tal quinta às 14h?", BUSCA)).toEqual([
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
  });
});

describe("item 2: o convênio citado afirmando exige o fato dele", () => {
  it.each([
    ["Temos convênio com a Unimed, sim!", []],
    ["Pode usar seu convênio Unimed, sim!", []],
    ["Unimed? Pode agendar normalmente pelo convênio!", []],
    ["Somos conveniados à Unimed.", []],
    ["A Unimed está entre os nossos convênios.", []],
    ["Sim, pode ser pelo convênio.", ["vocês atendem Unimed?"]],
    ["Pode sim, a Bradesco Saúde é parceira da clínica.", []],
    ["Trabalhamos em parceria com a Unimed.", []],
    ["Pode vir pelo seu plano, sem problema.", ["meu plano é Unimed"]],
  ] as const)("bloqueia sem fato: %s", (texto, paciente) => {
    expect(categorias(texto, {}, paciente)).toEqual([
      "cobertura_nao_verificada",
    ]);
  });

  it("com o fato do convênio citado, passa; o fato de outro não serve", () => {
    const unimed = { coberturas: [cobertura("Unimed", "Nacional", "atende")] };
    const bradesco = {
      coberturas: [cobertura("Bradesco Saúde", null, "atende")],
    };
    for (const texto of [
      "Temos convênio com a Unimed, sim!",
      "Somos conveniados à Unimed.",
      "A Unimed está entre os nossos convênios.",
    ]) {
      expect(regras(texto, unimed), texto).toEqual([]);
      expect(categorias(texto, bradesco), texto).toEqual([
        "cobertura_nao_verificada",
      ]);
    }
    // Sem nome na frase: o convenio que o paciente citou, ou o do resto do
    // rascunho.
    expect(
      regras("Sim, pode ser pelo convênio.", unimed, ["vocês atendem Unimed?"]),
    ).toEqual([]);
    expect(
      categorias("Sim, pode ser pelo convênio.", bradesco, [
        "vocês atendem Unimed?",
      ]),
    ).toEqual(["cobertura_nao_verificada"]);
    expect(
      categorias("Unimed? Pode agendar normalmente pelo convênio!", bradesco),
    ).toEqual(["cobertura_nao_verificada"]);
    expect(
      regras("Pode sim, a Bradesco Saúde é parceira da clínica.", bradesco),
    ).toEqual([]);
  });

  it("a negativa citada exige a negativa do fato (ou o Cadastro sem convênio)", () => {
    const texto = "A Unimed não está entre os nossos convênios.";
    expect(regras(texto)).toEqual([
      "cobertura_nao_verificada:negativa_sem_fato",
    ]);
    expect(
      regras(texto, {
        coberturas: [cobertura("Unimed", "Nacional", "atende")],
      }),
    ).toEqual(["cobertura_nao_verificada:negativa_sem_fato"]);
    expect(
      regras(texto, {
        coberturas: [cobertura("Unimed", "Nacional", "nao_atende")],
      }),
    ).toEqual([]);
    expect(regras(texto, { convenios: [], semConvenioAtivo: true })).toEqual(
      [],
    );
    // "Nao se preocupe" nao nega: e a afirmacao.
    expect(
      categorias("Não se preocupe que somos conveniados à Unimed.", {
        coberturas: [cobertura("Unimed", "Nacional", "nao_atende")],
      }),
    ).toEqual(["cobertura_nao_verificada"]);
  });

  it("pergunta, condição, pedido, documento e lugar conveniado não afirmam (controles)", () => {
    for (const [texto, paciente] of [
      ["Qual é o seu convênio?", []],
      ["Vai ser pelo convênio ou no particular?", []],
      ["Para eu ver se o seu plano cobre, qual é o seu convênio?", []],
      ["Me diga o nome do convênio e do plano.", []],
      ["Se for pelo convênio, me diga qual é o plano.", []],
      ["Não sei informar se o seu convênio cobre esse procedimento.", []],
      [
        "Para a Consulta, leve um documento com foto e a carteirinha do convênio.",
        ["vou pela Unimed"],
      ],
      ["Tenha a autorização prévia do convênio em mãos.", ["vou pela Unimed"]],
      ["Sim, temos estacionamento conveniado em frente à clínica.", []],
      ["Aceitamos cartão de qualquer operadora.", []],
      ["O plano de tratamento é definido na consulta.", []],
    ] as const) {
      expect(regras(texto, {}, paciente), texto).toEqual([]);
    }
  });

  it("a etiqueta de confirmação não protege a afirmação de convênio", () => {
    expect(categorias("Somos conveniados à Unimed, viu?")).toEqual([
      "cobertura_nao_verificada",
    ]);
  });
});

describe("item 2: o procedimento em 'coberto', 'cobertura' e 'aceita'", () => {
  const consulta = {
    coberturas: [cobertura("Unimed", "Nacional", "coberto")],
  };
  it.each([
    "A limpeza é coberta.",
    "A limpeza é coberta pela Unimed.",
    "O peeling é coberto, sim.",
    "Tem cobertura para a limpeza.",
    "A limpeza tem cobertura pela Unimed.",
    "Aceitamos Unimed para o peeling.",
    "Atendemos a limpeza pelo convênio Unimed.",
    "O ultrassom é coberto pela Unimed.",
  ])("com o fato só da consulta, bloqueia: %s", (texto) => {
    expect(categorias(texto, consulta)).toEqual(["cobertura_nao_verificada"]);
  });

  it("o procedimento do fato, ou nenhum citado, passa", () => {
    for (const texto of [
      "A consulta é coberta pela Unimed.",
      "A Consulta dermatológica é coberta pela Unimed.",
      "Sim, o procedimento é coberto.",
      "Tem cobertura, sim.",
      "Aceitamos Unimed, sim.",
      "Aceitamos Unimed na unidade Centro.",
      "Atendemos a Consulta dermatológica pelo convênio Unimed.",
    ]) {
      expect(regras(texto, consulta), texto).toEqual([]);
    }
  });
});

describe("item 2: 'seu plano' só com o fato do convênio que o paciente citou", () => {
  it("o fato de outro convênio não sustenta 'o seu plano'", () => {
    const bradesco = {
      coberturas: [cobertura("Bradesco Saúde", null, "coberto")],
    };
    const unimed = { coberturas: [cobertura("Unimed", "Nacional", "coberto")] };
    expect(
      regras("O seu plano cobre a consulta.", bradesco, ["e a Unimed?"]),
    ).toEqual(["cobertura_nao_verificada:cobertura_sem_fato"]);
    expect(
      regras("O seu plano cobre a consulta.", unimed, ["e a Unimed?"]),
    ).toEqual([]);
    // Dois convenios citados: o fato de cada um.
    expect(
      regras("Os seus planos cobrem a consulta.", unimed, [
        "tenho Unimed e Bradesco Saúde",
      ]),
    ).toEqual(["cobertura_nao_verificada:cobertura_sem_fato"]);
    expect(
      regras(
        "Os seus planos cobrem a consulta.",
        {
          coberturas: [
            cobertura("Unimed", "Nacional", "coberto"),
            cobertura("Bradesco Saúde", null, "coberto"),
          ],
        },
        ["tenho Unimed e Bradesco Saúde"],
      ),
    ).toEqual([]);
  });
});

describe("item 7: o bairro e a cidade da ferramenta são nome de lugar", () => {
  const unidades = { saidasDasFerramentas: [SAIDA_DAS_UNIDADES] };
  const avaliar = (texto: string, parcial: Partial<FatosDoTurno> = unidades) =>
    avaliarRegras(texto, {
      ...CONTEXTO_PADRAO,
      fatos: fatos(parcial),
    }).achados.map((a) => `${a.categoria}:${a.regra}`);

  it("as frases das revisões passam com consultar_unidades", () => {
    for (const texto of [
      "A unidade do interior fica na Rua X, 15, em Nossa Senhora dos Remédios.",
      "A outra unidade fica em Nossa Senhora dos Remédios (PI).",
      "A outra unidade fica na Rua X, 15, Nossa Senhora dos Remédios, PI.",
    ]) {
      expect(avaliar(texto), texto).toEqual([]);
    }
    expect(
      trechosDeEnderecoDasFerramentas(
        "A outra unidade fica em Nossa Senhora dos Remédios (PI).",
        fatos(unidades),
      ),
    ).toEqual(["nossa senhora dos remedios"]);
  });

  it("sem a ferramenta, e no resto do rascunho, as vedações continuam lendo", () => {
    expect(
      avaliar("A outra unidade fica em Nossa Senhora dos Remédios (PI).", {}),
    ).toContain("medicamento:classe_de_remedio");
    expect(
      avaliar("Fica em Nossa Senhora dos Remédios. Tome remédios para dor."),
    ).toEqual(expect.arrayContaining(["medicamento:classe_de_remedio"]));
  });

  it("uma palavra solta ou a palavra clínica no meio do nome nunca vira nome de lugar", () => {
    const saida = (bairro: string) =>
      JSON.stringify({
        resultado: "unidades",
        unidades: [
          {
            codigo: "u1",
            nome: "X",
            endereco: `Rua Y, 1, ${bairro}, Recife, PE`,
            bairro,
            cidade: "Recife",
          },
        ],
      });
    for (const bairro of ["Dores", "Remédios do Norte"]) {
      expect(
        trechosDeEnderecoDasFerramentas(
          `A unidade fica no bairro ${bairro}.`,
          fatos({ saidasDasFerramentas: [saida(bairro)] }),
        ),
        bairro,
      ).toEqual([]);
    }
  });
});

describe("calibragem da revisão 2: o que as regras novas não podem barrar", () => {
  const semHorario = {
    saidasDasFerramentas: [
      JSON.stringify({ resultado: "sem_horario", ate: "terça, 27/10" }),
    ],
  };

  it("a busca sem resultado, a pergunta indireta e o pedido do plano passam", () => {
    for (const [texto, parcial] of [
      ["Não encontrei vaga na quinta.", semHorario],
      [
        "Não encontrei horário livre na quinta de manhã. Quer que eu procure em outro dia?",
        semHorario,
      ],
      ["Infelizmente não há horário livre nesse período.", semHorario],
      ["Não sei se tem vaga amanhã.", COM_HOJE],
      ["Para convênio, preciso saber qual é o seu plano.", {}],
      [
        "Pronto! Seguem os horários: terça, 21/10 às 14:00 e quarta, 22/10 às 9h30.",
        BUSCA,
      ],
      [
        "Segue o endereço: Avenida Santos Dumont, nº 1500.",
        {
          textosPublicados: BASE_PUBLICADA_DA_BATERIA,
        },
      ],
      [
        "Os horários de funcionamento: segunda a sexta, das 8h às 18h.",
        { textosPublicados: BASE_PUBLICADA_DA_BATERIA },
      ],
      [
        "A consulta custa R$ 250,00 no particular. Se você tiver convênio, posso consultar se ele cobre.",
        {},
      ],
      ["Também posso consultar o seu convênio, se você tiver.", {}],
      ["Esse horário infelizmente já não está mais disponível.", {}],
      ["Olá! Como posso te ajudar hoje?", {}],
      ["Tudo certo! Qualquer dúvida, é só chamar.", {}],
      ["Aos domingos a clínica fica fechada.", {}],
    ] as const) {
      expect(regras(texto, parcial), texto).toEqual([]);
    }
    // A hora que a pessoa pediu e a busca nao achou, negada, passa.
    expect(
      regras("Às 15h não encontrei, mas tenho terça, 21/10 às 14:00.", BUSCA, [
        "pode ser 15h?",
      ]),
    ).toEqual([]);
  });

  it("os vizinhos que afirmam continuam barrados", () => {
    expect(
      regras("Seguem os horários: terça, 21/10 às 15:00.", BUSCA),
    ).toContain("horario_nao_verificado:horario_livre_sem_ferramenta");
    expect(regras("Se não me engano tenho vaga amanhã.", COM_HOJE)).toEqual([
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
    expect(
      categorias("Somos conveniados à Unimed, me diga o seu plano."),
    ).toEqual(["cobertura_nao_verificada"]);
  });

  it("falso positivo que fica (decisão do dono): a despedida com marca de fechamento e dia", () => {
    // "Combinado! Ate amanha!" sem acao no turno e lido como fechamento.
    expect(regras("Combinado! Até amanhã!")).toEqual([
      "acao_nao_executada:fechamento_sem_acao",
    ]);
  });
});
