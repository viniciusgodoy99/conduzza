import { describe, expect, it } from "vitest";

import {
  fatosValidos,
  fatosVazios,
  FONTES_DOS_FATOS,
  regrasDosFatos,
  type CoberturaDoTurno,
  type FatosDoTurno,
  type HorarioDoFato,
} from "@/lib/domain/conformidade/fatos-do-turno";
import { versaoDasRegras } from "@/lib/domain/conformidade/filtro";
import { resumirFatosDoTurno } from "@/lib/domain/conformidade/resumo-dos-fatos";
import {
  CADASTRO_DA_AGENDA,
  CATALOGO_DA_AGENDA,
  CONVENIOS_DA_BATERIA,
  HORARIOS_DA_BUSCA_DE_HORARIO,
  PROCEDIMENTOS_DA_BATERIA,
  SAIDA_DA_BUSCA_DE_HORARIO,
  TERCA_COM_A_ANA,
} from "@/tests/fixtures/ia/conformidade/casos";

// Revisao curta das correcoes da AG3 (27/10/2026): os achados 3, 4, 5, 6, 7
// e 14 nas regras deterministicas dos fatos do turno. Cada caso diz a regra
// que barra (ou que nenhuma barra), com os fatos que faltavam presentes onde
// da, para so a regra nova poder barrar. A bateria (casos.ts, AG3C-*) traz
// os mesmos achados pela categoria; o portao (achado 9) esta em
// gatilhos-de-entrada.test.ts.

const ANO = 2026;

function fatos(parcial: Partial<FatosDoTurno> = {}): FatosDoTurno {
  return {
    ...fatosVazios(ANO),
    convenios: CONVENIOS_DA_BATERIA,
    procedimentos: PROCEDIMENTOS_DA_BATERIA,
    ...CADASTRO_DA_AGENDA,
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
    nomesDoCatalogo: CATALOGO_DA_AGENDA,
    mensagensDoPaciente,
  }).map((achado) => `${achado.categoria}:${achado.regra}`);
}

function cobertura(
  nome: string,
  plano: string | null,
  estado: CoberturaDoTurno["estado"],
): CoberturaDoTurno {
  return { nome, plano, estado, procedimento: "Consulta dermatológica" };
}

/** A busca: terca 21/10 14:00, quarta 22/10 09:30, quinta 23/10 16:15. */
const BUSCA = {
  saidasDasFerramentas: [SAIDA_DA_BUSCA_DE_HORARIO],
  horariosLivres: HORARIOS_DA_BUSCA_DE_HORARIO,
};
/** A busca com a hora pedida (quarta 22/10 15:00) ocupada: o eco. */
const ECO = { ...BUSCA, ecosDoPedido: ["quarta, 22/10 às 15:00"] };
const QUINTA: HorarioDoFato = {
  dia: "quinta, 23/10",
  hora: "16:15",
  unidade: null,
  profissional: "Dr. Bruno Costa",
};
function feita(
  acao: FatosDoTurno["acoes"][number],
  horario: HorarioDoFato = TERCA_COM_A_ANA,
): Partial<FatosDoTurno> {
  return { ...BUSCA, acoes: [acao], horariosDasAcoes: [{ ...horario, acao }] };
}
const RESERVOU = feita("reservou");
const MARCOU = feita("marcou");
/** A consulta de quinta 16:15 relida do estado e a reserva nova de terca. */
const RELIDA_QUINTA_E_RESERVOU_TERCA: Partial<FatosDoTurno> = {
  ...RESERVOU,
  consultaLida: true,
  consultasLidas: [{ ...QUINTA, marcadaNestaConversa: true }],
};

describe("achado 3: o eco na frase que diz que o horário não está livre", () => {
  it.each([
    "Quarta, 22/10 às 15:00 já está ocupado.",
    "Às 15:00 de quarta já foi preenchido, mas tenho quarta, 22/10 às 9h30.",
    "O horário de quarta, 22/10 às 15:00 está indisponível.",
    "Quarta às 15:00 a agenda está cheia.",
    "Quarta, 22/10 às 15:00 está lotado.",
    "Quarta, 22/10 às 15:00 esgotou.",
    "Às 15:00 já tem paciente.",
    "A Dra. Ana Lima já está com paciente às 15:00.",
    "Você pediu quarta às 15:00, certo? Esse já foi.",
    "Você pediu quarta, 22/10 às 15:00, mas esse horário já foi preenchido.",
    "Quarta, 22/10 às 15:00 já foi marcado por outra pessoa.",
    "Quarta, 22/10 às 15:00 está reservado para outro paciente.",
    "Quarta, 22/10 às 15:00 já foi agendado por outro paciente, mas tenho quarta, 22/10 às 9h30.",
    "Quarta, 22/10 às 15:00 não deu: outra pessoa marcou antes.",
  ])("passa: %s", (rascunho) => {
    expect(regras(rascunho, ECO)).toEqual([]);
  });

  it.each([
    // O duplo negativo e o "vagou" afirmam que esta livre: so a ferramenta.
    [
      "Quarta, 22/10 às 15:00 não está ocupado.",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ],
    [
      "Quarta, 22/10 às 15:00 não está mais lotado.",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ],
    [
      "Quarta, 22/10 às 15:00 vagou!",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ],
    // "Tenho esse horario" e oferta.
    [
      "Você pediu quarta, 22/10 às 15:00 e tenho esse horário.",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ],
    [
      "Você pediu quarta, 22/10 às 15:00 e está livre.",
      "horario_nao_verificado:horario_livre_sem_ferramenta",
    ],
    // A etiqueta sozinha continua sem legitimar o eco.
    [
      "Anotado: quarta, 22/10 às 15:00, certo?",
      "horario_nao_verificado:hora_fora_dos_fatos",
    ],
    // O "ja foi" da consulta da pessoa nao diz que o horario esta ocupado.
    [
      "Sua consulta de quarta, 22/10 às 15:00 já foi.",
      "horario_nao_verificado:hora_fora_dos_fatos",
    ],
    // A afirmacao com o eco continua barrada.
    [
      "A Dra. Ana Lima atende quarta, 22/10 às 15:00.",
      "horario_nao_verificado:hora_fora_dos_fatos",
    ],
  ])("barra: %s", (rascunho, regra) => {
    expect(regras(rascunho, ECO)).toContain(regra);
  });

  it("o horário de outra pessoa não é a ação da assistente", () => {
    expect(
      regras("Esse horário já foi marcado por outra pessoa.", BUSCA),
    ).toEqual([]);
    expect(regras("Esse horário já foi marcado.", BUSCA)).toContain(
      "acao_nao_executada:marcacao_sem_ferramenta",
    );
    expect(
      regras("Esse horário está reservado para outro paciente.", BUSCA),
    ).toEqual([]);
    expect(regras("Esse horário está reservado para você.", BUSCA)).toContain(
      "acao_nao_executada:reserva_sem_ferramenta",
    );
  });
});

describe("achado 4: o par permitido depende do tipo da marca", () => {
  it.each([
    "Reservei terça, 21/10 às 14:00 para a limpeza, por 10 minutos. Te esperamos terça, 21/10 às 14:00!",
    "Combinado! Sua limpeza ficou para terça, 21/10 às 14:00.",
    "Pronto! Limpeza marcada para terça, 21/10 às 14:00.",
    "Nos vemos terça, 21/10 às 14:00!",
    "Seu horário é terça, 21/10 às 14:00.",
  ])(
    "a consulta relida de quinta não libera a marca para a reserva de terça: %s",
    (rascunho) => {
      expect(regras(rascunho, RELIDA_QUINTA_E_RESERVOU_TERCA)).toContain(
        "acao_nao_executada:fechamento_fora_do_horario",
      );
    },
  );

  it.each([
    "Reservei terça, 21/10 às 14:00 para a limpeza, por 10 minutos.",
    "Seu horário é terça, 21/10 às 14:00, reservado por 10 minutos.",
    "Sua consulta de quinta, 23/10 às 16:15 continua marcada. Te esperamos!",
    "Reservei terça, 21/10 às 14:00 para a limpeza, e sua consulta de quinta, 23/10 às 16:15 continua marcada.",
  ])("cada marca com o par dela passa: %s", (rascunho) => {
    expect(regras(rascunho, RELIDA_QUINTA_E_RESERVOU_TERCA)).toEqual([]);
  });

  it("a frase curta depois da reserva também marca a frase", () => {
    expect(
      regras("Reservei terça, 21/10 às 14:00. Te esperamos!", RESERVOU),
    ).toContain("acao_nao_executada:fechamento_sem_acao");
    expect(
      regras(
        "Marquei sua consulta para terça, 21/10 às 14:00. Te esperamos!",
        MARCOU,
      ),
    ).toEqual([]);
    expect(
      regras(
        "Reservei terça, 21/10 às 14:00 por 10 minutos. Combinado!",
        RESERVOU,
      ),
    ).toEqual([]);
  });
});

describe("achado 5: o profissional e a unidade da ação", () => {
  it.each([
    [
      "Perfeito! Sua consulta está marcada com o Dr. Bruno Costa na terça, 21/10 às 14:00.",
      MARCOU,
      "profissional_fora_da_acao",
    ],
    [
      "Pronto! Sua consulta ficou marcada para terça, 21/10 às 14:00 com o Dr. Bruno.",
      MARCOU,
      "profissional_fora_da_acao",
    ],
    [
      "Pronto! Sua consulta ficou marcada para terça, 21/10 às 14:00 com o Dr. Costa.",
      MARCOU,
      "profissional_fora_da_acao",
    ],
    [
      "Te esperamos terça, 21/10 às 14:00 com a Dra. Maria das Dores!",
      MARCOU,
      "profissional_fora_da_acao",
    ],
    [
      "Reservei terça, 21/10 às 14:00 com o Dr. Bruno Costa.",
      RESERVOU,
      "profissional_fora_da_acao",
    ],
    [
      "Perfeito! Sua consulta está marcada para terça, 21/10 às 14:00 na unidade Aldeota.",
      MARCOU,
      "unidade_fora_da_acao",
    ],
    [
      "Reservei terça, 21/10 às 14:00 na unidade da Aldeota.",
      RESERVOU,
      "unidade_fora_da_acao",
    ],
    [
      "Sim! Sua consulta está marcada para terça, 21/10 às 14:00, na unidade Aldeota.",
      {
        consultaLida: true,
        consultasLidas: [
          {
            dia: "terça, 21/10",
            hora: "14:00",
            unidade: "Centro",
            marcadaNestaConversa: true,
          },
        ],
      },
      "unidade_fora_da_acao",
    ],
    [
      "Sua consulta: terça, 21/10 às 14:00 com o Dr. Bruno Costa.",
      MARCOU,
      "profissional_fora_da_acao",
    ],
  ] as const)("barra: %s", (rascunho, parcial, regra) => {
    expect(regras(rascunho, parcial)).toContain(`acao_nao_executada:${regra}`);
  });

  it.each([
    // O profissional e a unidade da acao: inteiros, com o titulo e uma
    // palavra do nome, e a unidade com "do".
    [
      "Pronto! Sua consulta ficou marcada para terça, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro.",
      MARCOU,
    ],
    [
      "Pronto! Sua consulta ficou marcada para terça, 21/10 às 14:00 com a Dra. Ana.",
      MARCOU,
    ],
    [
      "Reservei terça, 21/10 às 14:00 com a Dra. Lima, na unidade do Centro.",
      RESERVOU,
    ],
    [
      "Agendado com a Dra. Ana Lima: terça, 21/10 às 14:00, pendente da aprovação da equipe.",
      MARCOU,
    ],
    // O outro profissional e a outra unidade negados, ou em outra frase.
    [
      "Reservei terça, 21/10 às 14:00 com a Dra. Ana Lima, já que o Dr. Bruno Costa não tinha horário.",
      RESERVOU,
    ],
    [
      "Reservei terça, 21/10 às 14:00 na unidade Centro (a unidade Aldeota não tinha vaga).",
      RESERVOU,
    ],
    [
      "Marquei sua consulta para terça, 21/10 às 14:00. Se precisar, o Dr. Bruno Costa também atende às quintas.",
      MARCOU,
    ],
    // O primeiro nome sem titulo pode ser o da pessoa.
    [
      "Pronto, Bruno! Sua consulta ficou marcada para terça, 21/10 às 14:00 com a Dra. Ana Lima.",
      MARCOU,
    ],
    // O titulo do nome de rua nao e profissional.
    [
      "Marquei sua consulta para terça, 21/10 às 14:00, na Rua Dr. Bruno Lopes.",
      MARCOU,
    ],
    // O nome solto da unidade pode ser o bairro.
    [
      "Marquei sua consulta para terça, 21/10 às 14:00, na unidade Centro, perto da Aldeota.",
      MARCOU,
    ],
  ] as const)("passa: %s", (rascunho, parcial) => {
    expect(
      regras(rascunho, parcial).filter((r) => /fora_da_acao/.test(r)),
    ).toEqual([]);
  });

  it("sem o profissional ou a unidade no fato, não barra (não se sabe)", () => {
    const semProfissional = feita("marcou", {
      dia: "terça, 21/10",
      hora: "14:00",
      unidade: null,
    });
    expect(
      regras(
        "Sua consulta ficou marcada para terça, 21/10 às 14:00 com o Dr. Bruno Costa, na unidade Aldeota.",
        semProfissional,
      ),
    ).toEqual([]);
  });

  it("sem o Cadastro nos fatos, só os nomes das próprias ações contam", () => {
    const semCadastro = { ...MARCOU, profissionais: [], unidades: [] };
    expect(
      regras(
        "Sua consulta ficou marcada para terça, 21/10 às 14:00 com o Dr. Bruno Costa.",
        semCadastro,
      ),
    ).toEqual([]);
    expect(
      regras(
        "Sua consulta ficou marcada para terça, 21/10 às 14:00 com a Dra. Ana Lima.",
        semCadastro,
      ),
    ).toEqual([]);
  });

  it("com o par de outra ação, vale o profissional dela", () => {
    const duas: Partial<FatosDoTurno> = {
      ...BUSCA,
      acoes: ["reservou"],
      horariosDasAcoes: [{ ...TERCA_COM_A_ANA, acao: "reservou" }],
      consultaLida: true,
      consultasLidas: [{ ...QUINTA, marcadaNestaConversa: true }],
    };
    expect(
      regras(
        "Sua consulta de quinta, 23/10 às 16:15 com o Dr. Bruno Costa continua marcada.",
        duas,
      ),
    ).toEqual([]);
    expect(
      regras(
        "Sua consulta de quinta, 23/10 às 16:15 com a Dra. Ana Lima continua marcada.",
        duas,
      ),
    ).toContain("acao_nao_executada:profissional_fora_da_acao");
  });
});

describe("achado 6: as formas que passavam", () => {
  /** So a reserva viva do estado (terca 14:00). */
  const SO_A_RESERVA = RESERVOU;
  it.each([
    "Obrigada! Pode vir terça, 21/10 às 14:00.",
    "Obrigada! É só comparecer terça, 21/10 às 14:00.",
    "Obrigada! A Dra. Ana Lima te recebe terça, 21/10 às 14:00.",
    "Obrigada! A Dra. Ana Lima vai te atender terça, 21/10 às 14:00.",
    "Obrigada! Você será atendida terça, 21/10 às 14:00.",
    "Obrigada! Terça, 21/10 às 14:00 já está no seu nome.",
    "Obrigada! Está tudo ok para terça, 21/10 às 14:00.",
    "Obrigada! Já deixei tudo pronto para terça, 21/10 às 14:00.",
    "Obrigada! Sua vaga de terça, 21/10 às 14:00 está assegurada.",
    "Sua consulta: terça, 21/10 às 14:00 com a Dra. Ana Lima.",
  ])("com só a reserva, barra: %s", (rascunho) => {
    expect(regras(rascunho, SO_A_RESERVA)).toContain(
      "acao_nao_executada:fechamento_sem_acao",
    );
  });

  it("o superlativo é o participio", () => {
    expect(
      regras(
        "Obrigada! Terça, 21/10 às 14:00 está confirmadíssimo.",
        SO_A_RESERVA,
      ),
    ).toContain("acao_nao_executada:confirmacao_sem_ferramenta");
  });

  it.each([
    "Obrigada! Pode vir terça, 21/10 às 14:00.",
    "Obrigada! A Dra. Ana Lima te recebe terça, 21/10 às 14:00.",
    "Sua consulta: terça, 21/10 às 14:00 com a Dra. Ana Lima.",
    "Terça, 21/10 às 14:00 já está no seu nome.",
  ])("com a consulta marcada no turno, passa: %s", (rascunho) => {
    expect(regras(rascunho, MARCOU)).toEqual([]);
  });

  it.each([
    "Já deixei separado terça, 21/10 às 14:00 para você.",
    "Separei terça, 21/10 às 14:00 para você.",
    "Guardei terça, 21/10 às 14:00 para você.",
    "Bloqueei terça, 21/10 às 14:00 para você.",
    "Bloqueei a agenda da Dra. Ana Lima para você.",
    "Consegui separar terça, 21/10 às 14:00 para você.",
  ])("sem reserva, barra como reserva: %s", (rascunho) => {
    expect(regras(rascunho, BUSCA)).toContain(
      "acao_nao_executada:reserva_sem_ferramenta",
    );
  });

  it("o procedimento dito em parte, com o participio no começo da frase", () => {
    expect(
      regras("Limpeza marcada para terça, 21/10 às 14:00.", SO_A_RESERVA),
    ).toEqual(["acao_nao_executada:marcacao_sem_ferramenta"]);
    expect(
      regras(
        "Limpeza marcada para terça, 21/10 às 14:00.",
        RELIDA_QUINTA_E_RESERVOU_TERCA,
      ),
    ).toEqual(["acao_nao_executada:horario_da_consulta"]);
    expect(
      regras("Limpeza marcada para terça, 21/10 às 14:00.", MARCOU),
    ).toEqual([]);
    expect(
      regras("Nada marcado ainda para terça, 21/10 às 14:00.", BUSCA),
    ).toEqual([]);
    expect(regras("Exame marcado para amanhã? Me avise.", BUSCA)).toEqual([]);
  });

  it("deixei no seu nome, sem reserva, barra", () => {
    expect(
      regras("Deixei terça, 21/10 às 14:00 no seu nome.", BUSCA),
    ).toContain("acao_nao_executada:fechamento_sem_acao");
  });

  it.each([
    // O que se guarda e nao e horario.
    "Guardei seu contato e aviso se abrir vaga na terça, 21/10 às 14:00.",
    "Separei as informações sobre a consulta de terça, 21/10 às 14:00.",
    "Bloqueei o número que te mandou mensagem.",
    "Guardei seus dados.",
    // A oferta, a condicao, o funcionamento e a proposta perguntada.
    "A Dra. Ana Lima te atende terça, 21/10 às 14:00 ou quinta, 23/10 às 16:15.",
    "Se preferir, a Dra. Ana Lima te atende terça, 21/10 às 14:00.",
    "Assim que você confirmar, a Dra. Ana Lima te recebe terça, 21/10 às 14:00.",
    "A Dra. Ana Lima te atende terça, 21/10 às 14:00. Pode ser?",
    "A Dra. Ana Lima te atende terça, 21/10 às 14:00, pode ser?",
    "Você pode vir terça, 21/10 às 14:00?",
    "Tudo pronto para sua consulta de terça, 21/10 às 14:00?",
    "Sua consulta: terça, 21/10 às 14:00 com a Dra. Ana Lima. Confirma?",
  ])("sem ação, passa: %s", (rascunho) => {
    expect(regras(rascunho, BUSCA)).toEqual([]);
  });

  it("o funcionamento com a clínica que atende não é compromisso", () => {
    expect(
      regras("A clínica te atende de segunda a sexta, das 8h às 18h.", {
        textosPublicados: [
          "Atendemos de segunda a sexta, das 8h às 18h, e aos sábados das 8h às 12h.",
        ],
      }),
    ).toEqual([]);
    expect(
      regras("Pode vir a partir das 8h.", {
        textosPublicados: ["Abrimos às 8h."],
      }),
    ).toEqual([]);
  });
});

describe("achado 7: a interjeição só diz certo; o verbo diz o que foi feito", () => {
  it.each([
    "Combinado! Reservei terça, 21/10 às 14:00 por 10 minutos.",
    "Feito! Reservei terça, 21/10 às 14:00 por 10 minutos.",
    "Ótimo, tudo certo! Reservei terça, 21/10 às 14:00 por 10 minutos.",
    "Tudo certo! Reservei terça, 21/10 às 14:00.",
    "Combinado, reservei terça, 21/10 às 14:00 por 10 minutos.",
    "Reservei terça, 21/10 às 14:00 por 10 minutos, tudo certo!",
    "Fechado! Seu horário é terça, 21/10 às 14:00, reservado por 10 minutos.",
  ])("com a reserva e o par dela, passa: %s", (rascunho) => {
    expect(regras(rascunho, RESERVOU)).toEqual([]);
  });

  it.each([
    [
      "Combinado! Reservei quinta, 23/10 às 16:15 por 10 minutos.",
      "acao_nao_executada:horario_da_acao",
    ],
    [
      "Combinado! Terça, 21/10 às 14:00.",
      "acao_nao_executada:fechamento_sem_acao",
    ],
    ["Feito: terça, 21/10 às 14:00.", "acao_nao_executada:fechamento_sem_acao"],
    [
      "Combinado! Te esperamos terça, 21/10 às 14:00.",
      "acao_nao_executada:fechamento_sem_acao",
    ],
    [
      "Está tudo certo! Reservei terça, 21/10 às 14:00.",
      "acao_nao_executada:fechamento_sem_acao",
    ],
    [
      "Tudo certo para terça, 21/10 às 14:00.",
      "acao_nao_executada:fechamento_sem_acao",
    ],
  ])("sem o verbo ou com outro par, barra: %s", (rascunho, regra) => {
    expect(regras(rascunho, RESERVOU)).toContain(regra);
  });

  it("decisão: a hora de chegada inventada continua barrando no turno do agendar", () => {
    expect(
      regras(
        "Sua consulta de terça, 21/10 às 14:00 está marcada, chegue às 13:45.",
        MARCOU,
      ),
    ).toEqual(
      expect.arrayContaining(["horario_nao_verificado:hora_fora_dos_fatos"]),
    );
  });
});

describe("achado 14: 'plano' seguido de verbo não é convênio", () => {
  it.each([
    ["Aceitamos sim!", "Meu plano era ir hoje à tarde, vocês aceitam cartão?"],
    [
      "Aceitamos sim, Pix e cartão.",
      "O plano é passar aí amanhã. Aceitam pix?",
    ],
    ["Aceitamos sim!", "Tenho plano de ir amanhã cedo, aceitam cartão?"],
    ["Aceitamos sim!", "Meu plano seria vir de manhã, aceitam débito?"],
  ])("passa: %s (paciente: %s)", (rascunho, mensagem) => {
    expect(regras(rascunho, {}, [mensagem])).toEqual([]);
  });

  it.each([
    ["Aceitamos sim!", "Meu plano é a Hapvida, vocês aceitam?"],
    ["Aceitamos sim!", "Meu plano é familiar, vocês aceitam?"],
    ["Aceitamos sim!", "Meu plano era o Vida Mais, vocês aceitam?"],
    ["Aceitamos sim!", "Meu plano de saúde é Humana, aceitam?"],
  ])("continua barrando: %s (paciente: %s)", (rascunho, mensagem) => {
    expect(
      regras(rascunho, { coberturas: [cobertura("Unimed", null, "atende")] }, [
        mensagem,
      ]).some((r) => r.startsWith("cobertura_nao_verificada:")),
    ).toBe(true);
  });

  it("no rascunho, o plano de fazer algo também não é convênio", () => {
    expect(
      regras("Seu plano de vir hoje cedo é ótimo, aceitamos cartão.", {}),
    ).toEqual([]);
    expect(regras("Atendemos plano e particular.", {})).toContain(
      "cobertura_nao_verificada:aceitacao_sem_fato",
    );
  });
});

describe("os fatos novos: validação, resumo sem o profissional e versão", () => {
  it("o profissional do fato e os nomes do Cadastro são opcionais, mas no formato", () => {
    const base = fatos();
    expect(fatosValidos(base)).toBe(true);
    const semCadastro: Partial<FatosDoTurno> = { ...base };
    delete semCadastro.profissionais;
    delete semCadastro.unidades;
    expect("profissionais" in semCadastro).toBe(false);
    expect(fatosValidos(semCadastro)).toBe(true);
    expect(fatosValidos({ ...base, profissionais: ["Dra. Ana", 3] })).toBe(
      false,
    );
    expect(fatosValidos({ ...base, unidades: "Centro" })).toBe(false);
    const comAcao = fatos(MARCOU);
    expect(fatosValidos(comAcao)).toBe(true);
    expect(
      fatosValidos({
        ...comAcao,
        horariosDasAcoes: [
          { ...TERCA_COM_A_ANA, profissional: 7, acao: "marcou" },
        ],
      }),
    ).toBe(false);
    expect(
      fatosValidos({
        ...comAcao,
        horariosDasAcoes: [
          { ...TERCA_COM_A_ANA, profissional: null, acao: "marcou" },
        ],
      }),
    ).toBe(true);
  });

  it("o resumo do verificador nunca leva o profissional da ação nem da consulta", () => {
    const resumo = resumirFatosDoTurno(
      fatos({
        ...MARCOU,
        consultaLida: true,
        consultasLidas: [{ ...QUINTA, marcadaNestaConversa: false }],
      }),
      "Oi",
    );
    expect(resumo.ok).toBe(true);
    if (resumo.ok) {
      expect(resumo.texto).toContain("terça, 21/10 às 14:00, unidade Centro");
      expect(resumo.texto).not.toMatch(/Ana Lima|Bruno Costa|Maria das Dores/);
    }
  });

  it("as regras novas entram na versão das regras", () => {
    expect(
      FONTES_DOS_FATOS.some((f) => f.includes("profissional e unidade")),
    ).toBe(true);
    expect(
      FONTES_DOS_FATOS.some((f) => f.includes("fechamento por tipo")),
    ).toBe(true);
    // A versao de antes da revisao curta das correcoes.
    expect(versaoDasRegras()).not.toBe("regras-fb2192cf74a2");
  });
});
