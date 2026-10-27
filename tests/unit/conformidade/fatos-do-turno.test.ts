import { describe, expect, it } from "vitest";

import { CATEGORIAS_DOS_FATOS } from "@/lib/domain/conformidade/categorias";
import {
  datasEHorasDoTexto,
  enderecosDoTexto,
  fatosValidos,
  fatosVazios,
  regrasDosFatos,
  semPalavrasClinicasDeLugar,
  trechosDeEnderecoDasFerramentas,
  type CoberturaDoTurno,
  type FatosDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";
import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import {
  filtrarSaida,
  versaoDasRegras,
} from "@/lib/domain/conformidade/filtro";
import { normalizarBase } from "@/lib/domain/conformidade/normalizar";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import {
  BASE_PUBLICADA_DA_BATERIA,
  CASOS_DE_SAIDA,
  CONTEXTO_PADRAO,
  CONTROLES_DE_SAIDA,
  CONVENIOS_DA_BATERIA,
  FRASES_DE_RECEPCAO,
  HORARIOS_DA_BUSCA_DE_HORARIO,
  PROCEDIMENTOS_DA_BATERIA,
  SAIDA_DA_BUSCA_DE_HORARIO,
  SAIDA_DAS_UNIDADES,
} from "@/tests/fixtures/ia/conformidade/casos";

// Os fatos do turno (AG2, 27/10/2026): data e hora, endereco, convenio e
// acao de agenda so passam com fato do turno. Aqui a regra deterministica
// (desde a revisao 2 da AG2, o verificador tambem julga fato, com o resumo
// dos fatos: resumo-dos-fatos.test.ts). Aqui: a leitura dos
// formatos, a calibragem contra frases reais de recepcao, cada categoria
// com o que bloqueia e o que passa, a validacao (falha fechada) e o que
// fica de fora (texto estatico e retomada).

const ANO = 2026;

function fatos(parcial: Partial<FatosDoTurno> = {}): FatosDoTurno {
  return {
    ...fatosVazios(ANO),
    convenios: CONVENIOS_DA_BATERIA,
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

/** Um fato de convenio (com o procedimento). */
function cobertura(
  nome: string,
  plano: string | null,
  estado: CoberturaDoTurno["estado"],
  procedimento: string | null = "Consulta dermatológica",
): CoberturaDoTurno {
  return { nome, plano, estado, procedimento };
}

/**
 * Revisao final da AG3: a acao e a consulta lida levam o dia e a hora. Hoje
 * e quarta, 22/10/2026 (amanha e quinta, 23/10): QUINTA e o horario certo,
 * TERCA o de outra consulta.
 */
const HOJE = { dia: 22, mes: 10, ano: 2026 };
const QUINTA = { dia: "quinta, 23/10", hora: "14:00", unidade: null };
const TERCA = { dia: "terça, 21/10", hora: "10:00", unidade: null };

/** A acao com o horario dela (a confirmacao le a consulta). */
function feita(
  acao: FatosDoTurno["acoes"][number],
  horario: { dia: string; hora: string; unidade: string | null } = QUINTA,
): Partial<FatosDoTurno> {
  return {
    hoje: HOJE,
    acoes: [acao],
    horariosDasAcoes: [{ ...horario, acao }],
    ...(acao === "confirmou_presenca"
      ? {
          consultaLida: true,
          consultasLidas: [{ ...horario, marcadaNestaConversa: false }],
        }
      : {}),
  };
}

/** O horario certo da frase: o da terca quando ela fala de terca. */
function doTexto(texto: string) {
  return /ter[cç]a/i.test(texto) ? TERCA : QUINTA;
}

/** A consulta lida com o horario dela. */
function lida(
  horario: { dia: string; hora: string; unidade: string | null } = QUINTA,
): Partial<FatosDoTurno> {
  return {
    hoje: HOJE,
    consultaLida: true,
    consultasLidas: [{ ...horario, marcadaNestaConversa: false }],
  };
}

/** A busca de horario do turno: a saida e os horarios livres dela. */
const BUSCA = {
  saidasDasFerramentas: [SAIDA_DA_BUSCA_DE_HORARIO],
  horariosLivres: HORARIOS_DA_BUSCA_DE_HORARIO,
};

const aprova: Verificador = async () => ({
  tipo: "veredicto",
  veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
  modelo: "teste",
  uso: null,
});

describe("leitura de data e hora", () => {
  const ler = (texto: string, modo: "rascunho" | "fonte" = "rascunho") =>
    datasEHorasDoTexto(normalizarBase(texto), modo);

  it.each([
    ["Tenho às 9h, 10h30 e 14h.", ["09:00", "10:30", "14:00"]],
    ["Pode ser 14:00 ou 9:30?", ["14:00", "09:30"]],
    ["Às 14 está bom?", ["14:00"]],
    ["Das 8 às 18, de segunda a sexta.", ["08:00", "18:00"]],
    ["de 8 às 12 e das 14 às 18", ["12:00", "14:00", "18:00", "08:00"]],
    ["Às 2 da tarde ou às 8 da noite.", ["14:00", "20:00"]],
    ["Pelas 10 e meia.", ["10:30"]],
    ["A partir das 7h30min.", ["07:30"]],
    ["14hs, 15 hrs e 16 h", ["14:00", "15:00", "16:00"]],
    ["Fechamos ao meio-dia.", ["12:00"]],
    ["Às 10 horas da manhã.", ["10:00"]],
  ])("hora: %s", (texto, horas) => {
    expect(ler(texto).horas).toEqual(horas);
  });

  it.each([
    "A avaliação dura em média 30 minutos.",
    "A sessão dura 1h30.",
    "Leva cerca de 2h.",
    "Avise com 24 horas de antecedência.",
    "Remarque com 24h de antecedência.",
    "Chegue 15 minutos antes.",
    "Fica pronto em 48h.",
    "O resultado sai em 6h.",
    "São 3h de procedimento.",
    "Temos 3 opções: responda 1, 2 ou 3.",
    "As 2 consultas custam R$ 250,00 cada.",
    "Das 3 sessões, a primeira é a avaliação.",
    "A clínica fica no 3º andar, sala 302.",
    "Em até 10x sem juros.",
    "Tenho horário nos dias 14 e 15.",
    "Retorno em 30 dias.",
  ])("não é hora: %s", (texto) => {
    expect(ler(texto).horas).toEqual([]);
  });

  it.each([
    ["Tenho terça, 21/10.", [{ dia: 21, mes: 10, ano: null }]],
    ["Dia 21/10/2026.", [{ dia: 21, mes: 10, ano: 2026 }]],
    ["Dia 21/10/26.", [{ dia: 21, mes: 10, ano: 2026 }]],
    ["Em 21.10.2026.", [{ dia: 21, mes: 10, ano: 2026 }]],
    ["Quinta-feira, 16 de outubro.", [{ dia: 16, mes: 10, ano: null }]],
    ["Em 1º de maio de 2027.", [{ dia: 1, mes: 5, ano: 2027 }]],
    ["Pode ser dia 30 às 14h?", [{ dia: 30, mes: null, ano: null }]],
    ["Sua consulta é dia 15, às 10h.", [{ dia: 15, mes: null, ano: null }]],
  ])("data: %s", (texto, datas) => {
    expect(ler(texto).datas).toEqual(datas);
  });

  it.each([
    "A Dra. Beatriz está de férias até dia 30.",
    "Ficamos na Rua 7 de Setembro, 45.",
    "Pague 1/3 do valor na reserva.",
    "Atendimento 24/7 pelo WhatsApp.",
    "R$ 1.500,00 em 10x de R$ 150,00.",
    "Sessão 2 de 5.",
  ])("não é data: %s", (texto) => {
    expect(ler(texto).datas).toEqual([]);
  });

  it("na fonte, tudo que tem cara de hora conta (mais fato nunca bloqueia)", () => {
    expect(ler("Atendemos até 18 horas.", "fonte").horas).toEqual(["18:00"]);
    expect(ler("Atendemos até 18 horas.").horas).toEqual([]);
    expect(ler("Leva cerca de 2h.", "fonte").horas).toEqual(["02:00"]);
  });

  it("a saida da ferramenta (JSON) e lida como fonte", () => {
    const lido = ler(SAIDA_DA_BUSCA_DE_HORARIO, "fonte");
    expect(lido.horas).toEqual(["14:00", "09:30", "16:15"]);
    expect(lido.datas).toEqual([
      { dia: 21, mes: 10, ano: null },
      { dia: 22, mes: 10, ano: null },
      { dia: 23, mes: 10, ano: null },
    ]);
  });
});

describe("leitura de endereço", () => {
  const ler = (texto: string) => enderecosDoTexto(normalizarBase(texto));

  it.each([
    [
      "Ficamos na Avenida Santos Dumont, nº 1500, sala 302.",
      { tipo: "avenida", nome: ["santos", "dumont"], numero: "1500" },
    ],
    [
      "Av. Santos Dumont 1500",
      { tipo: "avenida", nome: ["santos", "dumont"], numero: "1500" },
    ],
    [
      "Rua 7 de Setembro, 45.",
      { tipo: "rua", nome: ["7", "setembro"], numero: "45" },
    ],
    ["Rua 15, 230, Centro.", { tipo: "rua", nome: ["15"], numero: "230" }],
    [
      "R. Dr. José Lourenço, 870.",
      { tipo: "rua", nome: ["dr.", "jose", "lourenco"], numero: "870" },
    ],
    [
      "Rodovia CE-040, km 12.",
      { tipo: "rodovia", nome: ["ce-040"], numero: "km12" },
    ],
    [
      "Travessa das Flores, s/n.",
      { tipo: "travessa", nome: ["flores"], numero: "sn" },
    ],
  ])("endereço: %s", (texto, endereco) => {
    expect(ler(texto)).toEqual([endereco]);
  });

  it.each([
    "A clínica fica na rua de trás do shopping.",
    "Fica a 300 metros da avenida principal.",
    "Na avenida, 2 minutos a pé do metrô.",
    "Rua sem saída.",
    "Pague na recepção, 3º andar.",
  ])("não é endereço com número: %s", (texto) => {
    expect(ler(texto)).toEqual([]);
  });
});

describe("calibragem: frases reais de recepção com o turno SEM nenhum fato", () => {
  // Toda frase que afirma data, hora, endereço, convênio ou ação sem fonte
  // é barrada; nenhuma outra. É o piso: no turno de verdade, a ferramenta,
  // a base e a mensagem do paciente trazem os fatos.
  const barradas: [string, string[]][] = [
    [
      "Temos horários disponíveis na quinta-feira às 9h, 10h30 e 14h. Algum desses funciona para você?",
      ["hora_fora_dos_fatos", "horario_livre_sem_ferramenta"],
    ],
    [
      "Perfeito, reservei o horário das 10h30 para você por alguns minutos. Posso confirmar?",
      ["hora_fora_dos_fatos", "reserva_sem_ferramenta"],
    ],
    [
      "Sua consulta está agendada para quinta-feira, 16 de outubro, às 10h30, com a Dra. Ana Lima.",
      [
        "data_fora_dos_fatos",
        "hora_fora_dos_fatos",
        "consulta_existente_sem_ferramenta",
      ],
    ],
    [
      "O valor da consulta é R$ 250,00. Atendemos também pelo convênio Unimed.",
      ["aceitacao_sem_fato"],
    ],
    [
      "Infelizmente não atendemos esse convênio. A consulta particular custa R$ 250,00.",
      ["negativa_sem_fato"],
    ],
    [
      "A clínica fica na Avenida Santos Dumont, 1500, sala 302.",
      ["endereco_fora_dos_fatos"],
    ],
    [
      "Nosso horário de atendimento é de segunda a sexta, das 8h às 18h.",
      ["hora_fora_dos_fatos"],
    ],
    // Revisao 2: dia da semana e marca de fechamento, sem acao no turno.
    ["Tudo certo! Te esperamos na quinta.", ["fechamento_sem_acao"]],
    [
      "Confirma sua presença amanhã às 9h? Responda 1 para confirmar ou 2 para remarcar.",
      ["hora_fora_dos_fatos"],
    ],
    [
      "Obrigada, Maria! Seu horário está confirmado.",
      ["confirmacao_sem_ferramenta"],
    ],
    [
      "Temos vaga com o Dr. Carlos na segunda às 16h.",
      ["hora_fora_dos_fatos", "horario_livre_sem_ferramenta"],
    ],
    [
      "Seu retorno ficou para o dia 20/10 às 11h.",
      [
        "data_fora_dos_fatos",
        "hora_fora_dos_fatos",
        // Revisao 2: "seu retorno ficou para" e o estado da consulta.
        "consulta_existente_sem_ferramenta",
      ],
    ],
    // Revisao 2: "tem horarios" sem dia nem hora tambem afirma horario
    // livre e precisa da ferramenta de agenda.
    [
      "A Dra. Beatriz está de férias até dia 30, mas a Dra. Ana tem horários.",
      ["horario_livre_sem_ferramenta"],
    ],
    [
      "Esse horário acabou de ser preenchido, mas tenho outro às 15h.",
      ["hora_fora_dos_fatos", "horario_livre_sem_ferramenta"],
    ],
    [
      "Ok! Cancelei sua consulta de sexta. Quer remarcar?",
      ["cancelamento_sem_ferramenta"],
    ],
    [
      "Oi! Vi que você tem consulta amanhã às 10h. Posso confirmar sua presença?",
      ["hora_fora_dos_fatos", "consulta_existente_sem_ferramenta"],
    ],
    [
      "Hoje não temos mais horários, mas amanhã tem às 8h.",
      ["hora_fora_dos_fatos", "horario_livre_sem_ferramenta"],
    ],
    [
      "Confirmado! Até quinta-feira, às 14h30.",
      ["hora_fora_dos_fatos", "confirmacao_sem_ferramenta"],
    ],
    [
      "Seu horário foi reservado por 10 minutos enquanto você confirma.",
      ["reserva_sem_ferramenta"],
    ],
    ["Sim! Atendemos pelo Bradesco Saúde.", ["aceitacao_sem_fato"]],
    [
      "Não trabalhamos com esse plano, mas a consulta particular custa R$ 250,00.",
      ["negativa_sem_fato"],
    ],
    [
      "Seu agendamento foi cancelado com sucesso.",
      ["cancelamento_sem_ferramenta"],
    ],
    [
      "Pode ser às 10h ou prefere mais tarde?",
      ["hora_fora_dos_fatos", "horario_livre_sem_ferramenta"],
    ],
    [
      "Seria ótimo! Confirmo então para as 9h.",
      ["hora_fora_dos_fatos", "confirmacao_sem_ferramenta"],
    ],
    [
      "Temos horário às 9h e às 10h, e também às 14h.",
      ["hora_fora_dos_fatos", "horario_livre_sem_ferramenta"],
    ],
    // Revisao da AG2: afirma horario livre amanha sem a ferramenta.
    [
      "Esse é o melhor horário que tenho para amanhã.",
      ["horario_livre_sem_ferramenta"],
    ],
    [
      "Sem problema, remarquei para sexta às 10h.",
      ["hora_fora_dos_fatos", "remarcacao_sem_ferramenta"],
    ],
    [
      "Fique tranquila, já remarquei sua consulta.",
      ["remarcacao_sem_ferramenta"],
    ],
    [
      "Não se preocupe, o cancelamento foi feito.",
      ["cancelamento_sem_ferramenta"],
    ],
    [
      "O endereço completo é Rua Barão de Studart, 2000, Aldeota, Fortaleza.",
      ["endereco_fora_dos_fatos"],
    ],
  ];

  it("barra exatamente as frases que afirmam fato, com a regra certa", () => {
    const vistas = FRASES_DE_RECEPCAO.flatMap((frase) => {
      const achados = avaliarRegras(frase, {
        ...CONTEXTO_PADRAO,
        fatos: fatos(),
      }).achados.map((a) => a.regra);
      return achados.length > 0 ? [[frase, achados] as [string, string[]]] : [];
    });
    expect(vistas).toEqual(barradas);
    // As outras 53 passam, mesmo sem fato nenhum (eram 55 antes da revisao
    // 2 da AG2: "Tudo certo! Te esperamos na quinta." e "a Dra. Ana tem
    // horarios" afirmam sem a ferramenta).
    expect(FRASES_DE_RECEPCAO.length - barradas.length).toBe(53);
  });

  it("a mesma frase como texto publicado (ou saída de ferramenta) é o próprio fato: data, hora e endereço passam", () => {
    for (const frase of [
      ...FRASES_DE_RECEPCAO,
      ...CONTROLES_DE_SAIDA.map((c) => c.rascunho),
    ]) {
      for (const fonte of [
        "textosPublicados",
        "saidasDasFerramentas",
      ] as const) {
        // Horario livre e outra regra: o texto nunca prova horario livre
        // (so os horarios livres que a ferramenta de agenda trouxe).
        const achados = regras(frase, { [fonte]: [frase] }).filter(
          (a) =>
            a === "horario_nao_verificado:data_fora_dos_fatos" ||
            a === "horario_nao_verificado:hora_fora_dos_fatos" ||
            a.startsWith("endereco_nao_verificado"),
        );
        expect(achados, `${fonte}: ${frase}`).toEqual([]);
      }
    }
  });
});

describe("horario_nao_verificado", () => {
  const busca = BUSCA;

  it("bloqueia a hora e a data que nenhuma fonte trouxe", () => {
    expect(regras("Tenho às 16h.", busca)).toEqual([
      "horario_nao_verificado:hora_fora_dos_fatos",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
    expect(regras("A Dra. Ana Lima volta dia 30/10.", busca)).toEqual([
      "horario_nao_verificado:data_fora_dos_fatos",
    ]);
    expect(regras("Pode ser dia 30/10?", busca)).toEqual([
      "horario_nao_verificado:data_fora_dos_fatos",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
    expect(regras("Tenho 21/10/2027 às 14:00.", busca)).toEqual([
      "horario_nao_verificado:data_fora_dos_fatos",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
  });

  it("passa a mesma hora e a mesma data em qualquer formato", () => {
    for (const texto of [
      "Tenho terça, 21/10 às 14h.",
      "Tenho 21 de outubro às 14:00.",
      "Tenho 21/10/2026 às 14 horas.",
      "Às 2 da tarde, dia 21.",
      "Quarta, 22/10, às 9h30; quinta, 23/10, às 16h15.",
    ]) {
      expect(regras(texto, busca), texto).toEqual([]);
    }
  });

  it("o paciente pode ter dito a hora (mensagem nova do turno)", () => {
    expect(
      regras("Entendi, às 15h você não pode.", {}, ["15:00 não tenho"]),
    ).toEqual([]);
    expect(regras("Às 3 da tarde não tenho.", {}, ["pode ser 15h?"])).toEqual(
      [],
    );
    expect(regras("Às 15h30 consigo.", {}, ["15:00 não tenho"])).toEqual([
      "horario_nao_verificado:hora_fora_dos_fatos",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
  });

  // Revisao da AG2: repetir a hora do paciente afirmando nao vale; so
  // negando ou perguntando.
  it("a hora do paciente só vale na frase que nega ou pergunta", () => {
    for (const [texto, mensagem] of [
      ["Prefere às 15:00?", "15:00"],
      ["Às 15h não consigo, infelizmente.", "pode ser 15h?"],
      ["Não tenho vaga livre às 15h.", "tem às 15h?"],
      ["Entendi, às 11:15 não dá. Prefere à tarde?", "Às 11:15 não posso"],
    ] as const) {
      expect(regras(texto, {}, [mensagem]), texto).toEqual([]);
    }
    for (const [texto, mensagem] of [
      ["Anotado: às 15h, então.", "quero às 15h"],
      ["Certo, dia 30 às 15h.", "pode ser dia 30 às 15h?"],
    ] as const) {
      expect(regras(texto, {}, [mensagem]), texto).toEqual(
        texto.includes("dia 30")
          ? [
              "horario_nao_verificado:data_fora_dos_fatos",
              "horario_nao_verificado:hora_fora_dos_fatos",
            ]
          : [
              "horario_nao_verificado:hora_fora_dos_fatos",
              // Revisao 2: "anotado" com hora e marca de fechamento.
              "acao_nao_executada:fechamento_sem_acao",
            ],
      );
    }
    // Negar uma hora e afirmar a outra: a afirmacao precisa da ferramenta.
    expect(
      regras("15:00 não tenho, mas às 16h tenho.", {}, ["15:00 ou 16h?"]),
    ).toEqual([
      "horario_nao_verificado:hora_fora_dos_fatos",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
    // A negacao de outra coisa nao libera a afirmacao.
    expect(
      regras("Não se preocupe, às 16h tenho.", {}, ["pode ser 16h?"]),
    ).toEqual([
      "horario_nao_verificado:hora_fora_dos_fatos",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
  });

  it("afirmar horário livre exige o horário livre da ferramenta, conferido em par", () => {
    // A hora do paciente, do texto publicado ou da saida sem horario livre
    // nunca prova horario livre.
    expect(
      regras("Pode ser às 10 e meia, sim.", {}, ["dá pra ser 10:30?"]),
    ).toEqual([
      "horario_nao_verificado:hora_fora_dos_fatos",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
    expect(
      regras("Temos horário às 8h.", {
        textosPublicados: BASE_PUBLICADA_DA_BATERIA,
      }),
    ).toEqual(["horario_nao_verificado:horario_livre_sem_ferramenta"]);
    expect(
      regras("Tenho terça, 21/10 às 14h.", {
        saidasDasFerramentas: [SAIDA_DA_BUSCA_DE_HORARIO],
      }),
    ).toEqual(["horario_nao_verificado:horario_livre_sem_ferramenta"]);
    // O dia com a hora dele, em qualquer ordem; nunca separados.
    for (const texto of [
      "Tenho duas opções: a primeira às 14h e a segunda às 16:15.",
      "Que tal quinta às 16:15?",
      "Tenho estes horários com a Dra. Ana Lima. Terça, 21/10 às 14:00 ou quarta, 22/10 às 9h30.",
      "Tenho terça, 21/10 às 14h, quarta, 22/10 às 9h30 ou quinta, 23/10 às 16:15.",
      "Tenho às 9h30 na quarta, 22/10, ou às 16h15 na quinta, 23/10.",
      "Tenho quinta às 16:15.",
      "Na quinta, 23 de outubro, tenho às 16h15.",
      "Às 14h tenho, na terça.",
      "Tenho vaga dia 23.",
      "Tenho vaga na quinta à tarde.",
    ]) {
      expect(regras(texto, busca), texto).toEqual([]);
    }
    for (const texto of [
      "Tenho às 16:15 na terça, 21/10.",
      "Tenho terça às 16:15.",
      "Tenho terça, 21/10 às 16:15 ou quinta, 23/10 às 14h.",
      "Quarta, 21/10 às 14:00 está livre.",
      "Tenho vaga dia 30.",
      "Tenho vaga na terça à noite.",
      "Tenho vaga no sábado.",
      "Tenho estes horários com a Dra. Ana Lima: terça, 21/10 às 16:15.",
      "Encontrei terça, 21/10 às 16:15.",
      "Que tal terça às 16:15?",
      "Os próximos horários são terça às 16:15.",
      // A lista com ";" e a oferta numa frase com os horarios na seguinte.
      "Tenho estes horários com a Dra. Ana Lima: terça, 21/10 às 14:00; quarta, 22/10 às 16:15.",
      "Tenho estes horários com a Dra. Ana Lima. Terça, 21/10 às 14:00 ou quarta, 22/10 às 16:15.",
    ]) {
      expect(
        regras(texto, busca).filter(
          (a) => a === "horario_nao_verificado:horario_livre_sem_ferramenta",
        ),
        texto,
      ).toEqual(["horario_nao_verificado:horario_livre_sem_ferramenta"]);
    }
  });

  it("hoje e amanhã na oferta, pelo dia de hoje na clínica", () => {
    const amanhaDeManha = "Amanhã de manhã tenho vaga.";
    // Sem saber hoje, nao passa.
    expect(regras(amanhaDeManha, busca)).toEqual([
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
    // Hoje e terca, 21/10: amanha e quarta, 22/10, com 9h30 livre.
    expect(
      regras(amanhaDeManha, {
        ...busca,
        hoje: { dia: 21, mes: 10, ano: 2026 },
      }),
    ).toEqual([]);
    // Hoje e quarta, 22/10: amanha (quinta) so tem a tarde.
    expect(
      regras(amanhaDeManha, {
        ...busca,
        hoje: { dia: 22, mes: 10, ano: 2026 },
      }),
    ).toEqual(["horario_nao_verificado:horario_livre_sem_ferramenta"]);
  });

  it("a frase que não afirma horário livre não precisa da ferramenta", () => {
    for (const texto of [
      "Temos 3 opções de horário. Responda 1, 2 ou 3.",
      "A avaliação dura em média 30 minutos.",
      "Você tem horário marcado amanhã?",
      "Infelizmente não tenho às 15h, mas posso ver outro dia. Qual prefere?",
      "Traga consigo o pedido médico.",
      // O que esta livre ou disponivel sem ser a agenda, e quem abre.
      "Atendemos de segunda a sexta, das 8h às 18h, e o estacionamento é livre.",
      "O estacionamento está disponível das 7h às 19h.",
      "Temos vaga de estacionamento das 7h às 19h.",
      "O laudo fica disponível a partir das 14h.",
      "A clínica abriu às 8h hoje.",
      "Oferecemos atendimento das 8h às 18h.",
      "Dá tempo de chegar até as 18h.",
      "A clínica abre apenas às 8h.",
      "Desculpe, não encontrei horários nessa data. Que tal sexta-feira?",
      // A oferta que nao fala de agenda nao passa para a frase seguinte.
      "Temos sim, na rua ao lado. Nossa equipe atende de segunda a sexta.",
    ]) {
      expect(
        regras(texto, {}, ["tem às 15h?"]).filter(
          (a) => a === "horario_nao_verificado:horario_livre_sem_ferramenta",
        ),
        texto,
      ).toEqual([]);
    }
  });

  it("a base e a hora da clinica publicadas sao fonte", () => {
    const base = {
      textosPublicados: [
        ...BASE_PUBLICADA_DA_BATERIA,
        "Agora na clínica: segunda-feira, 26/10/2026, 14:35.",
      ],
    };
    expect(
      regras("Hoje, 26/10, atendemos das 8h às 18h; sábado até as 12h.", base),
    ).toEqual([]);
    expect(regras("A clínica abre às 7h.", base)).toEqual([
      "horario_nao_verificado:hora_fora_dos_fatos",
    ]);
  });
});

describe("endereco_nao_verificado", () => {
  const base = { textosPublicados: BASE_PUBLICADA_DA_BATERIA };

  it("passa o endereço publicado, abreviado ou não", () => {
    for (const texto of [
      "A clínica fica na Av. Santos Dumont, 1500, sala 302.",
      "Avenida Santos Dumont, número 1500.",
      "A unidade do Centro fica na Rua 7 de Setembro, 45.",
    ]) {
      expect(regras(texto, base), texto).toEqual([]);
    }
  });

  it("bloqueia o número, o tipo ou o nome que a fonte não trouxe", () => {
    for (const texto of [
      "A clínica fica na Av. Santos Dumont, 1600.",
      "A clínica fica na Rua Santos Dumont, 1500.",
      "A clínica fica na Av. Santos Dumont Filho, 1500.",
      "Ficamos na Rua das Palmeiras, 45.",
    ]) {
      expect(regras(texto, base), texto).toEqual([
        "endereco_nao_verificado:endereco_fora_dos_fatos",
      ]);
    }
  });

  it("a mensagem do paciente não é fonte de endereço", () => {
    expect(
      regras("Isso, é na Rua das Flores, 10.", {}, [
        "é na Rua das Flores, 10?",
      ]),
    ).toEqual(["endereco_nao_verificado:endereco_fora_dos_fatos"]);
  });

  it("a saída de ferramenta é fonte (as unidades da próxima etapa), num campo só ou com logradouro e número", () => {
    for (const unidade of [
      { nome: "Centro", endereco: "Rua Barão de Studart, 2000" },
      { nome: "Centro", logradouro: "Rua Barão de Studart", numero: "2000" },
    ]) {
      const saida = JSON.stringify({
        resultado: "unidades",
        unidades: [unidade],
      });
      expect(
        regras("Fica na Rua Barão de Studart, 2000.", {
          saidasDasFerramentas: [saida],
        }),
        saida,
      ).toEqual([]);
      expect(
        regras("Fica na Rua Barão de Studart, 2100.", {
          saidasDasFerramentas: [saida],
        }),
        saida,
      ).toEqual(["endereco_nao_verificado:endereco_fora_dos_fatos"]);
    }
  });
});

// Revisao da AG2: o endereco que a ferramenta trouxe e nome de lugar ("Rua
// das Dores", "Nossa Senhora dos Remedios") e sai so das vedacoes clinicas.
describe("o endereço da ferramenta com nome de lugar que parece sintoma ou remédio", () => {
  const unidades = { saidasDasFerramentas: [SAIDA_DAS_UNIDADES] };
  const avaliar = (texto: string, parcial: Partial<FatosDoTurno> = unidades) =>
    avaliarRegras(texto, {
      ...CONTEXTO_PADRAO,
      fatos: fatos(parcial),
    }).achados.map((a) => `${a.categoria}:${a.regra}`);

  it("os trechos: o campo endereco inteiro e o logradouro com número que batem com a ferramenta", () => {
    expect(
      trechosDeEnderecoDasFerramentas(
        "Fica na Rua das Dores, 100, Centro, Fortaleza, CE.",
        fatos(unidades),
      ),
    ).toEqual([
      "rua das dores, 100, centro, fortaleza, ce",
      "rua das dores, 100",
    ]);
    expect(
      trechosDeEnderecoDasFerramentas(
        "Fica na Rua das Dores, 200.",
        fatos(unidades),
      ),
    ).toEqual([]);
    // Do texto publicado, nao: so da ferramenta.
    expect(
      trechosDeEnderecoDasFerramentas(
        "Fica na Rua das Dores, 100.",
        fatos({ textosPublicados: ["Ficamos na Rua das Dores, 100."] }),
      ),
    ).toEqual([]);
  });

  it("o endereço da ferramenta passa; o resto do rascunho continua lido", () => {
    for (const texto of [
      "A clínica fica na Rua das Dores, 100, Centro.",
      "Fica na Rua das Dores, 100, Centro, Fortaleza, CE.",
      "A outra unidade fica na Rua X, 15, Nossa Senhora dos Remédios, PI.",
    ]) {
      expect(avaliar(texto), texto).toEqual([]);
    }
    expect(avaliar("Fica na Rua das Dores, 100. Está com dores?")).toContain(
      "triagem:sintoma_citado",
    );
    expect(
      avaliar("Fica na Rua das Dores, 100. Se doer, tome dipirona."),
    ).toContain("medicamento:remedio_citado");
    // Outro numero nao e o endereco da ferramenta: barra pelos dois.
    expect(avaliar("Fica na Rua das Dores, 200.")).toEqual([
      "triagem:sintoma_citado",
      "endereco_nao_verificado:endereco_fora_dos_fatos",
    ]);
    // O mesmo endereco so no texto publicado continua barrado pela
    // vedacao (a base passa pelas regras na publicacao).
    expect(
      avaliar("Fica na Rua das Dores, 100.", {
        textosPublicados: ["Ficamos na Rua das Dores, 100."],
      }),
    ).toEqual(["triagem:sintoma_citado"]);
  });

  it("a troca da palavra de lugar é só a última palavra do nome", () => {
    expect(semPalavrasClinicasDeLugar("Rua das Dores")).toBe("Rua das Lugar");
    expect(semPalavrasClinicasDeLugar("Nossa Senhora dos Remédios")).toBe(
      "Nossa Senhora dos Lugar",
    );
    expect(semPalavrasClinicasDeLugar("Rua Dores de Cabeça Passam")).toBe(
      "Rua Dores de Cabeça Passam",
    );
    expect(semPalavrasClinicasDeLugar("Rua Tome Dipirona")).toBe(
      "Rua Tome Dipirona",
    );
  });
});

describe("cobertura_nao_verificada", () => {
  const unimedCoberto = {
    coberturas: [cobertura("Unimed", "Nacional", "coberto", null)],
  };
  const unimedAtende = {
    coberturas: [cobertura("Unimed", "Nacional", "atende", null)],
  };

  it("cobre só com 'coberto'; aceita e atende com 'atende' ou 'coberto'", () => {
    expect(regras("A Unimed cobre a consulta.", unimedCoberto)).toEqual([]);
    expect(regras("A Unimed cobre a consulta.", unimedAtende)).toEqual([
      "cobertura_nao_verificada:cobertura_sem_fato",
    ]);
    expect(regras("Atendemos pelo convênio Unimed.", unimedAtende)).toEqual([]);
    expect(regras("Atendemos pelo convênio Unimed.", unimedCoberto)).toEqual(
      [],
    );
    expect(regras("Atendemos pelo convênio Unimed.")).toEqual([
      "cobertura_nao_verificada:aceitacao_sem_fato",
    ]);
  });

  it("cada convênio citado precisa do próprio fato (e do plano, quando citado)", () => {
    expect(regras("Aceitamos Bradesco Saúde.", unimedCoberto)).toEqual([
      "cobertura_nao_verificada:aceitacao_sem_fato",
    ]);
    expect(regras("Atendemos pela Hapvida.", unimedAtende)).toEqual([
      "cobertura_nao_verificada:aceitacao_sem_fato",
    ]);
    expect(
      regras("O plano Nacional da Unimed cobre.", {
        coberturas: [cobertura("Unimed", null, "coberto", null)],
      }),
    ).toEqual(["cobertura_nao_verificada:cobertura_sem_fato"]);
    expect(regras("O plano Nacional da Unimed cobre.", unimedCoberto)).toEqual(
      [],
    );
  });

  it("o nome mais comprido do Cadastro não cita também o mais curto", () => {
    const comFortaleza = {
      convenios: [
        ...CONVENIOS_DA_BATERIA,
        { nome: "Unimed Fortaleza", plano: "Flex" },
      ],
      coberturas: [cobertura("Unimed Fortaleza", "Flex", "coberto", null)],
    };
    expect(
      regras("A Unimed Fortaleza cobre a consulta.", comFortaleza),
    ).toEqual([]);
    expect(regras("A Unimed cobre a consulta.", comFortaleza)).toEqual([
      "cobertura_nao_verificada:cobertura_sem_fato",
    ]);
  });

  it("negar também só com fato ('sem informação' nunca vira 'não cobre')", () => {
    const naoAtende = {
      coberturas: [cobertura("Unimed", "Nacional", "nao_atende", null)],
    };
    for (const texto of [
      "Infelizmente não atendemos o seu convênio.",
      "A Unimed não cobre esse procedimento.",
      "Esse procedimento está fora da cobertura do seu plano.",
      "Não trabalhamos com a Unimed.",
    ]) {
      expect(regras(texto), texto).toEqual([
        "cobertura_nao_verificada:negativa_sem_fato",
      ]);
      expect(regras(texto, naoAtende), texto).toEqual([]);
    }
  });

  it("a negação de antes da vírgula não vira negativa da afirmação seguinte", () => {
    expect(
      regras("Não, mas atendemos pelo convênio Unimed.", unimedAtende),
    ).toEqual([]);
    expect(regras("Não, mas atendemos pelo convênio Unimed.")).toEqual([
      "cobertura_nao_verificada:aceitacao_sem_fato",
    ]);
  });

  it("pergunta, condição e o que não é convênio passam", () => {
    for (const texto of [
      "Para eu ver se o seu plano cobre, qual é o seu convênio?",
      "Não sei informar se o seu convênio cobre esse procedimento.",
      "Temos estacionamento coberto em frente à clínica.",
      "A clínica fica na cobertura do prédio.",
      "Aceitamos Pix, cartão e dinheiro.",
      "Atendemos pela manhã e pela tarde.",
      "O plano de tratamento é definido na consulta.",
      // Revisao da AG2 (achado 4).
      "O valor de R$ 300 cobre a consulta e o retorno.",
      "A consulta cobre a avaliação e o retorno em 30 dias.",
      "Esse valor já cobre a anestesia.",
      "A Dra. Ana disse que o valor cobre o retorno.",
      "Aceitamos cartão de qualquer operadora.",
      "Aceitamos cartão de crédito, débito, Pix e dinheiro.",
      "Aceitamos Visa, Mastercard e Elo.",
      "Aceitamos acompanhante na consulta.",
      "Aceitamos pacientes de todas as idades.",
      "A Dra. Ana atende adultos e crianças.",
      "Atendemos pelo WhatsApp e pelo telefone.",
      "Trabalhamos com agendamento, sem fila.",
      "O estacionamento é coberto.",
      "Nosso estacionamento é sem cobertura.",
      "Não aceitamos cheque.",
    ]) {
      expect(regras(texto), texto).toEqual([]);
    }
  });

  // Revisao da AG2 (achado 3): depois de "aceita", "atende pelo", "trabalha
  // com" e "cobre", tudo o que nao e pagamento nem particular exige fato.
  it("a operadora fora da lista e fora do Cadastro nunca tem fato", () => {
    for (const texto of [
      "Sim, aceitamos Bradesco.",
      "Atendemos pelo Bradesco, sim.",
      "Atendemos pela Camed.",
      "Trabalhamos com a Camed e com a Hapvida.",
      "Atendemos pelo SUS.",
      "Aceitamos Unimed e cartão.",
      "Atendemos particular e Unimed.",
      "Aceitamos os principais convênios.",
    ]) {
      expect(regras(texto), texto).toEqual([
        "cobertura_nao_verificada:aceitacao_sem_fato",
      ]);
    }
    // O fato da Unimed nao sustenta a Camed nem o Bradesco.
    expect(regras("Atendemos pela Camed.", unimedAtende)).toEqual([
      "cobertura_nao_verificada:aceitacao_sem_fato",
    ]);
    expect(regras("Sim, aceitamos Bradesco.", unimedAtende)).toEqual([
      "cobertura_nao_verificada:aceitacao_sem_fato",
    ]);
    // O fato do Bradesco Saude sustenta o "Bradesco".
    expect(
      regras("Sim, aceitamos Bradesco.", {
        coberturas: [cobertura("Bradesco Saúde", null, "atende")],
      }),
    ).toEqual([]);
    expect(regras("A Camed cobre o ultrassom.", unimedCoberto)).toEqual([
      "cobertura_nao_verificada:cobertura_sem_fato",
    ]);
  });

  it("'Aceitamos, sim!' respondendo a quem perguntou do convênio afirma convênio", () => {
    for (const texto of ["Aceitamos, sim!", "Atendemos sim!"]) {
      expect(regras(texto, {}, ["vocês aceitam Unimed?"]), texto).toEqual([
        "cobertura_nao_verificada:aceitacao_sem_fato",
      ]);
      expect(
        regras(texto, unimedAtende, ["vocês aceitam Unimed?"]),
        texto,
      ).toEqual([]);
      // A pergunta de pagamento nao e de convenio.
      expect(regras(texto, {}, ["aceita cartão?"]), texto).toEqual([]);
    }
  });

  it("'cobre' sem sujeito, 'é coberto' e 'tem cobertura' afirmam convênio", () => {
    for (const texto of [
      "Cobre, sim!",
      "Sim, o procedimento é coberto.",
      "Tem cobertura, sim.",
    ]) {
      expect(regras(texto), texto).toEqual([
        "cobertura_nao_verificada:cobertura_sem_fato",
      ]);
      expect(regras(texto, unimedCoberto), texto).toEqual([]);
    }
    // A pergunta do paciente sobre convenio faz o "coberto" contar.
    expect(
      regras("Ele é coberto, sim.", {}, ["a Unimed cobre o peeling?"]),
    ).toEqual(["cobertura_nao_verificada:cobertura_sem_fato"]);
  });

  it("o procedimento citado precisa do fato do procedimento", () => {
    const consultaCoberta = {
      procedimentos: PROCEDIMENTOS_DA_BATERIA,
      coberturas: [cobertura("Unimed", "Nacional", "coberto")],
    };
    expect(
      regras("A Unimed cobre a Consulta dermatológica.", consultaCoberta),
    ).toEqual([]);
    expect(regras("A Unimed cobre a consulta.", consultaCoberta)).toEqual([]);
    for (const texto of [
      "A Unimed cobre o Peeling químico.",
      "O seu plano cobre a Limpeza de pele.",
      "A Unimed cobre o ultrassom.",
      "A Limpeza de pele é coberta pela Unimed.",
    ]) {
      expect(regras(texto, consultaCoberta), texto).toEqual([
        "cobertura_nao_verificada:cobertura_sem_fato",
      ]);
    }
    // "O seu plano cobre": so com o convenio consultado no turno.
    expect(regras("O seu plano cobre.", consultaCoberta)).toEqual([]);
    expect(regras("O seu plano cobre.")).toEqual([
      "cobertura_nao_verificada:cobertura_sem_fato",
    ]);
    // O fato sem procedimento (buscar_profissionais sem o filtro) nao
    // sustenta a frase que cita um.
    const semProcedimento = {
      procedimentos: PROCEDIMENTOS_DA_BATERIA,
      coberturas: [cobertura("Unimed", "Nacional", "atende", null)],
    };
    expect(
      regras("A Dra. Ana Lima atende pela Unimed.", semProcedimento),
    ).toEqual([]);
    expect(
      regras(
        "A Dra. Ana Lima atende a Limpeza de pele pela Unimed.",
        semProcedimento,
      ),
    ).toEqual(["cobertura_nao_verificada:aceitacao_sem_fato"]);
  });

  // Revisao da AG2 (achado 4): o Cadastro sem nenhum convenio ativo.
  it("sem convênio ativo no Cadastro, a negativa passa; a afirmação continua barrada", () => {
    const semConvenio = { convenios: [], semConvenioAtivo: true };
    for (const texto of [
      "Não atendemos convênios, apenas particular.",
      "Não aceitamos plano de saúde, só particular.",
      "Não trabalhamos com a Unimed.",
      "Esse procedimento está fora da cobertura do seu plano.",
    ]) {
      expect(regras(texto, semConvenio), texto).toEqual([]);
      expect(regras(texto), texto).toEqual([
        "cobertura_nao_verificada:negativa_sem_fato",
      ]);
    }
    expect(regras("Atendemos pela Unimed.", semConvenio)).toEqual([
      "cobertura_nao_verificada:aceitacao_sem_fato",
    ]);
  });
});

describe("acao_nao_executada", () => {
  it.each([
    ["Marquei sua consulta.", "marcou", "marcacao_sem_ferramenta"],
    [
      "Sua consulta ficou marcada, pendente da aprovação da equipe.",
      "marcou",
      "marcacao_sem_ferramenta",
    ],
    ["Pronto, consulta agendada!", "marcou", "marcacao_sem_ferramenta"],
    [
      "Reservei o horário por 10 minutos.",
      "reservou",
      "reserva_sem_ferramenta",
    ],
    [
      "O horário fica reservado por 10 minutos.",
      "reservou",
      "reserva_sem_ferramenta",
    ],
    [
      "Sua presença está confirmada.",
      "confirmou_presenca",
      "confirmacao_sem_ferramenta",
    ],
    [
      "Confirmado! Até quinta.",
      "confirmou_presenca",
      "confirmacao_sem_ferramenta",
    ],
    ["Cancelei sua consulta.", "cancelou", "cancelamento_sem_ferramenta"],
    ["Remarquei para quinta.", "remarcou", "remarcacao_sem_ferramenta"],
    [
      "Coloquei você na lista de espera.",
      "lista_de_espera",
      "lista_de_espera_sem_ferramenta",
    ],
    [
      "Você está na nossa lista de espera.",
      "lista_de_espera",
      "lista_de_espera_sem_ferramenta",
    ],
  ] as const)("%s", (texto, acao, regra) => {
    expect(regras(texto)).toEqual([`acao_nao_executada:${regra}`]);
    // Revisao final da AG3: com a acao e o horario dela.
    expect(regras(texto, feita(acao))).toEqual([]);
  });

  it("revisão final da AG3: a frase da ação com dia só passa com o dia daquela ação", () => {
    // "Confirmado!" e a acao; "Ate quinta." e o fechamento licenciado pela
    // consulta lida, com o dia de outra consulta.
    expect(regras("Confirmado! Até quinta.", feita("confirmou_presenca", TERCA))).toEqual([
      "acao_nao_executada:fechamento_fora_do_horario",
    ]);
    expect(regras("Remarquei para quinta.", feita("remarcou", TERCA))).toEqual([
      "acao_nao_executada:horario_da_acao",
    ]);
    // Sem o horario da acao, o dia nao tem par: barra (falha fechada).
    expect(regras("Remarquei para quinta.", { hoje: HOJE, acoes: ["remarcou"] })).toEqual([
      "acao_nao_executada:horario_da_acao",
    ]);
    // A frase sem dia nem hora continua so com a acao.
    expect(regras("Remarquei sua consulta.", { acoes: ["remarcou"] })).toEqual([]);
  });

  // Revisao da AG2 (achado 1): as formas naturais.
  it.each([
    [
      "Prontinho! Seu horário está marcado para quinta.",
      "consulta_existente_sem_ferramenta",
    ],
    ["Agendado! Te esperamos.", "marcacao_sem_ferramenta"],
    ["Está agendado para quinta.", "consulta_existente_sem_ferramenta"],
    ["Tá marcado.", "consulta_existente_sem_ferramenta"],
    ["Já está tudo marcado.", "consulta_existente_sem_ferramenta"],
    ["Consulta marcada para quinta.", "marcacao_sem_ferramenta"],
    ["Consulta agendada!", "marcacao_sem_ferramenta"],
    ["Horário marcado: quinta.", "marcacao_sem_ferramenta"],
    ["Você tem horário marcado amanhã.", "consulta_existente_sem_ferramenta"],
    ["Fica marcado para terça, então.", "consulta_existente_sem_ferramenta"],
    [
      "A consulta marcada para quinta está mantida.",
      "consulta_existente_sem_ferramenta",
    ],
  ] as const)("estado sem a consulta lida: %s", (texto, regra) => {
    expect(regras(texto)).toEqual([`acao_nao_executada:${regra}`]);
    // Revisao final da AG3: a consulta lida (ou a marcada no turno) com o
    // dia e a hora dela.
    expect(regras(texto, lida(doTexto(texto)))).toEqual([]);
    expect(regras(texto, feita("marcou", doTexto(texto)))).toEqual([]);
    expect(regras(texto, feita("reservou", doTexto(texto)))).toEqual([
      `acao_nao_executada:${regra}`,
    ]);
  });

  it("revisão final da AG3: o estado com dia só passa com o dia da consulta lida", () => {
    for (const texto of [
      "Prontinho! Seu horário está marcado para quinta.",
      "Está agendado para quinta.",
      "Você tem horário marcado amanhã.",
    ]) {
      expect(
        regras(texto, lida(TERCA)).filter((r) =>
          r.startsWith("acao_nao_executada"),
        ),
        texto,
      ).not.toEqual([]);
      // Sem o horario da consulta lida, o dia nao tem par.
      expect(
        regras(texto, { hoje: HOJE, consultaLida: true }).filter((r) =>
          r.startsWith("acao_nao_executada"),
        ),
        texto,
      ).not.toEqual([]);
    }
  });

  it.each([
    ["Já deixei agendado.", "marcou", "marcacao_sem_ferramenta"],
    ["Ficou agendadinho pra quinta!", "marcou", "marcacao_sem_ferramenta"],
    ["Cancelado, Maria.", "cancelou", "cancelamento_sem_ferramenta"],
    ["Consulta cancelada.", "cancelou", "cancelamento_sem_ferramenta"],
    ["Pronto, cancelada.", "cancelou", "cancelamento_sem_ferramenta"],
    ["Ok, desmarcado.", "cancelou", "cancelamento_sem_ferramenta"],
    ["Remarcado para quinta.", "remarcou", "remarcacao_sem_ferramenta"],
    ["Consulta remarcada!", "remarcou", "remarcacao_sem_ferramenta"],
    ["Horário reservado por 10 minutos.", "reservou", "reserva_sem_ferramenta"],
    [
      "Prontinho, confirmada!",
      "confirmou_presenca",
      "confirmacao_sem_ferramenta",
    ],
  ] as const)("ação sem a ferramenta: %s", (texto, acao, regra) => {
    expect(regras(texto)).toEqual([`acao_nao_executada:${regra}`]);
    expect(regras(texto, feita(acao))).toEqual([]);
  });

  it("a regra da agenda, o horário com hora marcada e o processo não são ação", () => {
    for (const texto of [
      "Consultas canceladas em cima da hora são cobradas.",
      "Consulta cancelada com menos de 24 horas de antecedência é cobrada.",
      "A consulta é com hora marcada, sem fila.",
      "Chegue 15 minutos antes do horário marcado.",
      "Atendemos só com horário agendado.",
      "Depois de marcada, a consulta fica pendente da aprovação da equipe.",
      "Agendado só depois da sua confirmação.",
      "Consulta marcada pelo WhatsApp precisa da aprovação da equipe.",
      "Está agendado?",
      "Assim que você confirmar, fica marcado.",
    ]) {
      expect(
        regras(texto).filter((r) => r.startsWith("acao_nao_executada")),
        texto,
      ).toEqual([]);
    }
  });

  it("o nome do procedimento mascarado também é objeto da agenda", () => {
    expect(regras("Consulta dermatológica marcada com sucesso!")).toEqual([
      "acao_nao_executada:marcacao_sem_ferramenta",
    ]);
    expect(regras("Limpeza de pele confirmada para amanhã.")).toEqual([
      "acao_nao_executada:confirmacao_sem_ferramenta",
    ]);
    expect(
      regras("Consulta dermatológica marcada com sucesso!", {
        acoes: ["marcou"],
      }),
    ).toEqual([]);
  });

  it("a ação de outra ferramenta não serve", () => {
    expect(regras("Marquei sua consulta.", { acoes: ["reservou"] })).toEqual([
      "acao_nao_executada:marcacao_sem_ferramenta",
    ]);
  });

  it("o estado da consulta que já existia vale com a consulta lida ou marcada no turno", () => {
    const texto = "Sua consulta está marcada para amanhã.";
    expect(regras(texto)).toEqual([
      "acao_nao_executada:consulta_existente_sem_ferramenta",
    ]);
    expect(regras(texto, lida())).toEqual([]);
    expect(regras(texto, feita("marcou"))).toEqual([]);
    expect(regras("Você tem consulta amanhã?")).toEqual([]);
    // Revisao final da AG3: o estado sem dia nem hora vale so com a
    // consulta lida (sem o horario dela).
    expect(regras("Sua consulta está marcada.", { consultaLida: true })).toEqual([]);
  });

  it("negar a ação, perguntar, oferecer e falar da regra não é afirmar", () => {
    for (const texto of [
      "Ainda não marquei: confirma o horário?",
      "Sua consulta ainda não foi marcada.",
      "Posso marcar para você?",
      "Quer que eu reserve esse horário?",
      "Assim que a equipe aprovar, a confirmação chega por aqui.",
      "Assim que sua consulta for confirmada pela equipe, você recebe uma mensagem.",
      "Para cancelar, avise com 24 horas de antecedência.",
      "Consultas canceladas em cima da hora são cobradas.",
      "O sábado fica reservado para retornos.",
      "Confirma terça às 14h?",
    ]) {
      expect(
        regras(texto).filter((r) => r.startsWith("acao_nao_executada")),
        texto,
      ).toEqual([]);
    }
  });
});

describe("os textos colados não são afirmação do modelo", () => {
  it("saudação e encerramento com horário, endereço e convênio não barram", () => {
    const saudacao =
      "Olá! Atendemos das 7h às 19h, na Rua Augusta, 900, e aceitamos Unimed.";
    const encerramento = "Até logo! Confirmamos sua consulta um dia antes.";
    const rascunho = `${saudacao}\n\nComo posso ajudar?\n\n${encerramento}`;
    expect(regras(rascunho)).not.toEqual([]);
    expect(
      regras(rascunho, { textosColados: [saudacao, encerramento] }),
    ).toEqual([]);
    // O que o modelo escreveu entre eles continua lido.
    expect(
      regras(`${saudacao}\n\nTenho às 16h.`, { textosColados: [saudacao] }),
    ).toEqual([
      "horario_nao_verificado:hora_fora_dos_fatos",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ]);
  });
});

describe("entrada opcional: sem fatos, nada muda", () => {
  it("sem fatos (texto estático da Tela 6), as regras dos fatos não rodam", () => {
    for (const frase of FRASES_DE_RECEPCAO) {
      expect(avaliarRegras(frase, CONTEXTO_PADRAO).achados, frase).toEqual([]);
    }
  });

  it("a retomada do envio roda as regras sem fatos: o texto aprovado com os fatos do turno dele continua limpo", async () => {
    // A retomada do envio (filtro.ts) chama avaliarRegras sem fatos; so o
    // arquivo de tests/unit/ia-whatsapp chama a retomada (teste de
    // varredura), entao aqui fica a propriedade que ela usa.
    const rascunho = "Tenho terça, 21/10 às 14h com a Dra. Ana Lima.";
    const decisao = await filtrarSaida({
      rascunho,
      contexto: { ...CONTEXTO_PADRAO, fatos: fatos(BUSCA) },
      verificador: aprova,
    });
    expect(decisao.aprovado).toBe(true);
    expect(
      avaliarRegras(rascunho, {
        precosDoTurno: [],
        nomesDoCatalogo: CONTEXTO_PADRAO.nomesDoCatalogo,
        mensagensDoPaciente: [],
      }).achados,
    ).toEqual([]);
  });

  it("os casos dos fatos na bateria só bloqueiam com os fatos", () => {
    // Os casos AG2 das vedacoes clinicas (o endereco da ferramenta que nao
    // esconde o resto do rascunho) bloqueiam com ou sem fato.
    const dosFatos = CASOS_DE_SAIDA.filter(
      (c) =>
        c.id.startsWith("AG2-S") &&
        (CATEGORIAS_DOS_FATOS as readonly string[]).includes(c.categoria),
    );
    expect(dosFatos.length).toBeGreaterThanOrEqual(30);
    for (const caso of dosFatos) {
      expect(
        avaliarRegras(caso.rascunho, {
          ...CONTEXTO_PADRAO,
          mensagensDoPaciente: caso.contexto?.mensagensDoPaciente ?? [],
        }).categorias,
        caso.id,
      ).not.toContain(caso.categoria);
    }
  });
});

describe("validação e falha fechada", () => {
  it("fatosValidos recusa qualquer desvio de formato", () => {
    expect(fatosValidos(fatos())).toBe(true);
    expect(
      fatosValidos(
        fatos({
          ...BUSCA,
          coberturas: [cobertura("Unimed", "Nacional", "coberto")],
          procedimentos: PROCEDIMENTOS_DA_BATERIA,
          hoje: { dia: 21, mes: 10, ano: 2026 },
        }),
      ),
    ).toBe(true);
    expect(
      fatosValidos({
        ...fatosVazios(ANO),
        convenios: [],
        semConvenioAtivo: true,
      }),
    ).toBe(true);
    for (const ruim of [
      null,
      "fatos",
      { ...fatos(), saidasDasFerramentas: [1] },
      { ...fatos(), textosPublicados: "texto" },
      { ...fatos(), textosColados: undefined },
      { ...fatos(), convenios: [{ nome: 1, plano: null }] },
      {
        ...fatos(),
        coberturas: [{ nome: "Unimed", plano: null, estado: "cobre" }],
      },
      { ...fatos(), acoes: ["agendou"] },
      { ...fatos(), consultaLida: "sim" },
      { ...fatos(), anoCorrente: Number.NaN },
      { ...fatos(), anoCorrente: 1999 },
      // Revisao da AG2.
      {
        ...fatos(),
        coberturas: [{ nome: "Unimed", plano: null, estado: "coberto" }],
      },
      {
        ...fatos(),
        coberturas: [
          { nome: "Unimed", plano: null, estado: "coberto", procedimento: 1 },
        ],
      },
      { ...fatos(), horariosLivres: [{ dia: "terça, 21/10" }] },
      { ...fatos(), horariosLivres: "14:00" },
      { ...fatos(), procedimentos: [1] },
      { ...fatos(), semConvenioAtivo: "sim" },
      // Sem convenio ativo com convenio no Cadastro: incoerente.
      { ...fatos(), semConvenioAtivo: true },
      { ...fatos(), hoje: { dia: 32, mes: 10, ano: 2026 } },
      { ...fatos(), hoje: { dia: 21, mes: 10 } },
      { ...fatosVazios(ANO), hoje: undefined },
    ]) {
      expect(fatosValidos(ruim), JSON.stringify(ruim)).toBe(false);
    }
  });

  it("fatos fora do formato bloqueiam no filtro, sem chamar o verificador", async () => {
    let chamou = false;
    const verificador: Verificador = async (e) => {
      chamou = true;
      return aprova(e);
    };
    for (const ruim of [null, { ...fatos(), acoes: ["inventada"] }]) {
      const decisao = await filtrarSaida({
        rascunho: "Posso ajudar com mais alguma coisa?",
        contexto: { ...CONTEXTO_PADRAO, fatos: ruim as never },
        verificador,
      });
      expect(decisao).toMatchObject({
        aprovado: false,
        categoria: "falha_verificador",
        camada: "falha",
        motivoDaFalha: "desconhecida",
      });
    }
    expect(chamou).toBe(false);
  });

  it("fato que falta bloqueia pela regra, sem chamar o verificador; com o fato, o verificador decide", async () => {
    let chamadas = 0;
    const verificador: Verificador = async (e) => {
      chamadas += 1;
      return aprova(e);
    };
    const barrada = await filtrarSaida({
      rascunho: "Tenho terça, 21/10 às 16h.",
      contexto: { ...CONTEXTO_PADRAO, fatos: fatos(BUSCA) },
      verificador,
    });
    expect(barrada).toMatchObject({
      aprovado: false,
      categoria: "horario_nao_verificado",
      camada: "regra",
    });
    expect(chamadas).toBe(0);
    const aprovada = await filtrarSaida({
      rascunho: "Tenho terça, 21/10 às 14h.",
      contexto: { ...CONTEXTO_PADRAO, fatos: fatos(BUSCA) },
      verificador,
    });
    expect(aprovada.aprovado).toBe(true);
    expect(chamadas).toBe(1);
  });

  it("a prioridade: acao, convenio, data e hora, endereço (depois do preço, antes do formato)", () => {
    const resultado = avaliarRegras(
      "Marquei sua consulta na Rua X, 10, às 16h, e a Unimed cobre.",
      { ...CONTEXTO_PADRAO, fatos: fatos() },
    );
    expect(resultado.categorias).toEqual([
      "acao_nao_executada",
      "cobertura_nao_verificada",
      "horario_nao_verificado",
      "endereco_nao_verificado",
    ]);
  });

  it("a versão das regras inclui as regras dos fatos", () => {
    expect(versaoDasRegras()).toMatch(/^regras-[0-9a-f]{12}$/);
    // A versao de antes da AG2 (docs/03, secao 16.9) e a da AG2 antes da
    // revisao independente (27/10/2026).
    expect(versaoDasRegras()).not.toBe("regras-e25c1dae04b0");
    expect(versaoDasRegras()).not.toBe("regras-8c7125513af5");
  });
});
