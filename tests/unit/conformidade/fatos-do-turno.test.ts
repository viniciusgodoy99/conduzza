import { describe, expect, it } from "vitest";

import {
  datasEHorasDoTexto,
  enderecosDoTexto,
  fatosValidos,
  fatosVazios,
  regrasDosFatos,
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
  SAIDA_DA_BUSCA_DE_HORARIO,
} from "@/tests/fixtures/ia/conformidade/casos";

// Os fatos do turno (AG2, 27/10/2026): data e hora, endereco, convenio e
// acao de agenda so passam com fato do turno. So a regra deterministica
// olha fato (o verificador nunca julga, como o preco). Aqui: a leitura dos
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
      ["hora_fora_dos_fatos"],
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
    [
      "Confirma sua presença amanhã às 9h? Responda 1 para confirmar ou 2 para remarcar.",
      ["hora_fora_dos_fatos"],
    ],
    [
      "Obrigada, Maria! Seu horário está confirmado.",
      ["confirmacao_sem_ferramenta"],
    ],
    ["Temos vaga com o Dr. Carlos na segunda às 16h.", ["hora_fora_dos_fatos"]],
    [
      "Seu retorno ficou para o dia 20/10 às 11h.",
      ["data_fora_dos_fatos", "hora_fora_dos_fatos"],
    ],
    [
      "Esse horário acabou de ser preenchido, mas tenho outro às 15h.",
      ["hora_fora_dos_fatos"],
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
      ["hora_fora_dos_fatos"],
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
    ["Pode ser às 10h ou prefere mais tarde?", ["hora_fora_dos_fatos"]],
    [
      "Seria ótimo! Confirmo então para as 9h.",
      ["hora_fora_dos_fatos", "confirmacao_sem_ferramenta"],
    ],
    ["Temos horário às 9h e às 10h, e também às 14h.", ["hora_fora_dos_fatos"]],
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
    // As outras 56 passam, mesmo sem fato nenhum.
    expect(FRASES_DE_RECEPCAO.length - barradas.length).toBe(56);
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
        const achados = regras(frase, { [fonte]: [frase] }).filter(
          (a) =>
            a.startsWith("horario_nao_verificado") ||
            a.startsWith("endereco_nao_verificado"),
        );
        expect(achados, `${fonte}: ${frase}`).toEqual([]);
      }
    }
  });
});

describe("horario_nao_verificado", () => {
  const busca = { saidasDasFerramentas: [SAIDA_DA_BUSCA_DE_HORARIO] };

  it("bloqueia a hora e a data que nenhuma fonte trouxe", () => {
    expect(regras("Tenho às 16h.", busca)).toEqual([
      "horario_nao_verificado:hora_fora_dos_fatos",
    ]);
    expect(regras("Pode ser dia 30/10?", busca)).toEqual([
      "horario_nao_verificado:data_fora_dos_fatos",
    ]);
    expect(regras("Tenho 21/10/2027 às 14:00.", busca)).toEqual([
      "horario_nao_verificado:data_fora_dos_fatos",
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
    ]);
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

describe("cobertura_nao_verificada", () => {
  const unimedCoberto = {
    coberturas: [
      { nome: "Unimed", plano: "Nacional", estado: "coberto" as const },
    ],
  };
  const unimedAtende = {
    coberturas: [
      { nome: "Unimed", plano: "Nacional", estado: "atende" as const },
    ],
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
        coberturas: [{ nome: "Unimed", plano: null, estado: "coberto" }],
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
      coberturas: [
        { nome: "Unimed Fortaleza", plano: "Flex", estado: "coberto" as const },
      ],
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
      coberturas: [
        { nome: "Unimed", plano: "Nacional", estado: "nao_atende" as const },
      ],
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
    ]) {
      expect(regras(texto), texto).toEqual([]);
    }
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
    expect(regras(texto, { acoes: [acao] })).toEqual([]);
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
    expect(regras(texto, { consultaLida: true })).toEqual([]);
    expect(regras(texto, { acoes: ["marcou"] })).toEqual([]);
    expect(regras("Você tem consulta amanhã?")).toEqual([]);
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
    ).toEqual(["horario_nao_verificado:hora_fora_dos_fatos"]);
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
      contexto: {
        ...CONTEXTO_PADRAO,
        fatos: fatos({ saidasDasFerramentas: [SAIDA_DA_BUSCA_DE_HORARIO] }),
      },
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
    const dosFatos = CASOS_DE_SAIDA.filter((c) => c.id.startsWith("AG2-S"));
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
      contexto: {
        ...CONTEXTO_PADRAO,
        fatos: fatos({ saidasDasFerramentas: [SAIDA_DA_BUSCA_DE_HORARIO] }),
      },
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
      contexto: {
        ...CONTEXTO_PADRAO,
        fatos: fatos({ saidasDasFerramentas: [SAIDA_DA_BUSCA_DE_HORARIO] }),
      },
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
    // A versao de antes da AG2 (docs/03, secao 16.9).
    expect(versaoDasRegras()).not.toBe("regras-e25c1dae04b0");
  });
});
