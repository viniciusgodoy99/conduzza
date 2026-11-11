import { describe, expect, it, vi } from "vitest";

import {
  fatosVazios,
  FONTES_DOS_FATOS,
  regrasDosFatos,
  type EntradaDaEsperaDoFato,
  type FatosDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";
import {
  filtrarSaida,
  versaoDasRegras,
} from "@/lib/domain/conformidade/filtro";
import { normalizarBase } from "@/lib/domain/conformidade/normalizar";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import {
  LEMBRETE_DA_OFERTA,
  textoDoLembreteDaOferta,
} from "@/lib/domain/lembrete-da-oferta";
import {
  COM_QUALQUER_PROFISSIONAL,
  DIA_NA_FRASE,
  NO_PARTICULAR,
  PERGUNTA_DA_LISTA_DE_ESPERA,
  PERIODO_NA_FRASE,
  perguntaDaListaDeEspera,
  PREFERENCIA_EM_QUALQUER,
  RESPOSTA_DA_LISTA_DE_ESPERA,
  respostaDaListaDeEspera,
  type PedidoDaEsperaEmTexto,
} from "@/lib/domain/textos-da-lista-de-espera";
import {
  CADASTRO_DA_AGENDA,
  CATALOGO_DA_AGENDA,
  CONTEXTO_PADRAO,
  CONVENIOS_DA_BATERIA,
  HORARIOS_DA_BUSCA_DE_HORARIO,
  PROCEDIMENTOS_DA_BATERIA,
  SAIDA_DA_BUSCA_DE_HORARIO,
  TERCA_COM_A_ANA,
} from "@/tests/fixtures/ia/conformidade/casos";

// Revisao 2 da AG5 (28/10/2026), os ultimos achados de conformidade da
// vaga_prometida e da espera_fora_da_entrada:
//  - achado 1 (regressao): a negacao da prioridade valia para qualquer "nao"
//    ou "sem" ate quatro palavras antes ("Sem duvida voce tera prioridade"
//    passava). Agora so a negacao que rege a prioridade, e ela substitui a
//    negacao geral (o duplo negativo "nao fica sem prioridade" promete);
//  - achado 2 (falsos positivos): o procedimento citado em parte pelas
//    palavras que a frase da lista diz por outro motivo (2a), a primeira da
//    agenda do dia (2b), a desistencia da propria pessoa (2c) e a reserva
//    que vale "ate la" (2d), cada um passando com os fatos certos e sem
//    abrir a promessa de verdade;
//  - achado 3: sem fato de horario no turno, "o horario e seu" barra com a
//    agenda na frase; com a marcacao, a reserva ou a busca, passa (AG3);
//  - achado 4: a acao de quem age pela clinica ("a recepcao marca para
//    voce") e o participio que abre ("se o horario for liberado").
// O verificador e um duble: nenhum teste chama a OpenAI.

const USO = {
  tokensEntrada: 900,
  tokensSaida: 30,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
};

function verificadorQueSempreAprova() {
  return vi.fn<Verificador>(async () => ({
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: USO,
  }));
}

function fatos(parcial: Partial<FatosDoTurno> = {}): FatosDoTurno {
  return {
    ...fatosVazios(2026),
    ...CADASTRO_DA_AGENDA,
    convenios: CONVENIOS_DA_BATERIA,
    procedimentos: PROCEDIMENTOS_DA_BATERIA,
    hoje: { dia: 20, mes: 10, ano: 2026 },
    ...parcial,
  };
}

const SAIDA_DA_MARCACAO = JSON.stringify({
  resultado: "marcado",
  pendente: true,
  dia: "terça, 21/10",
  hora: "14:00",
  profissional: "Dra. Ana Lima",
  procedimento: "Consulta dermatológica",
  unidade: "Centro",
});
const SAIDA_DA_RESERVA = JSON.stringify({
  resultado: "reservado",
  minutos: 10,
  dia: "terça, 21/10",
  hora: "14:00",
  profissional: "Dra. Ana Lima",
  procedimento: "Consulta dermatológica",
  unidade: "Centro",
});

/** agendar: terca, 21/10 as 14:00 com a Dra. Ana Lima. */
const MARCOU = fatos({
  saidasDasFerramentas: [SAIDA_DA_MARCACAO],
  acoes: ["marcou"],
  horariosDasAcoes: [{ ...TERCA_COM_A_ANA, acao: "marcou" }],
});
/** A busca e a reserva de terca, 21/10 as 14:00. */
const RESERVOU = fatos({
  saidasDasFerramentas: [SAIDA_DA_BUSCA_DE_HORARIO, SAIDA_DA_RESERVA],
  horariosLivres: HORARIOS_DA_BUSCA_DE_HORARIO,
  acoes: ["reservou"],
  horariosDasAcoes: [{ ...TERCA_COM_A_ANA, acao: "reservou" }],
});
/** So os horarios livres da busca. */
const BUSCOU = fatos({
  saidasDasFerramentas: [SAIDA_DA_BUSCA_DE_HORARIO],
  horariosLivres: HORARIOS_DA_BUSCA_DE_HORARIO,
});
/** A consulta da pessoa, lida no turno: amanha (quarta, 21/10) as 08:00. */
const CONSULTA_DE_AMANHA = fatos({
  saidasDasFerramentas: [
    JSON.stringify({
      resultado: "consultas",
      consultas: [
        {
          dia: "quarta, 21/10",
          hora: "08:00",
          profissional: "Dra. Ana Lima",
          procedimento: "Consulta dermatológica",
          unidade: "Centro",
        },
      ],
    }),
  ],
  consultaLida: true,
  consultasLidas: [
    {
      dia: "quarta, 21/10",
      hora: "08:00",
      unidade: "Centro",
      profissional: "Dra. Ana Lima",
      marcadaNestaConversa: false,
    },
  ],
});

const ENTRADA_DA_ANA: EntradaDaEsperaDoFato = {
  procedimento: "Limpeza de pele",
  profissional: "Dra. Ana Lima",
  turnos: ["manha"],
  dias: [1, 3],
  origem: "turno",
};
/** A entrada feita no turno (a acao e a entrada), com a lista ligada. */
const ENTROU = fatos({
  listaDeEsperaLigada: true,
  acoes: ["lista_de_espera"],
  entradasDaEspera: [ENTRADA_DA_ANA],
});
/** A consulta lida e a entrada que ja existia, com a lista ligada. */
const CONSULTA_E_LISTA = {
  ...CONSULTA_DE_AMANHA,
  listaDeEsperaLigada: true,
  entradasDaEspera: [{ ...ENTRADA_DA_ANA, origem: "existente" as const }],
};

const CATALOGO = [...CATALOGO_DA_AGENDA, "Dra. Bruna Reis"];

function regras(rascunho: string, f: FatosDoTurno): string[] {
  return regrasDosFatos(rascunho, {
    fatos: f,
    nomesDoCatalogo: CATALOGO,
    mensagensDoPaciente: [],
  }).map((a) => a.regra);
}

async function noFiltro(rascunho: string, f: FatosDoTurno) {
  const verificador = verificadorQueSempreAprova();
  const decisao = await filtrarSaida({
    rascunho,
    contexto: { ...CONTEXTO_PADRAO, nomesDoCatalogo: CATALOGO, fatos: f },
    verificador,
  });
  return { decisao, verificador };
}

/** Barra pela regra, no filtro inteiro, sem chamar o verificador. */
async function barraPelaRegra(rascunho: string, f: FatosDoTurno) {
  const { decisao, verificador } = await noFiltro(rascunho, f);
  expect(decisao, rascunho).toMatchObject({ aprovado: false, camada: "regra" });
  expect(verificador).not.toHaveBeenCalled();
}

/** Passa no filtro inteiro, byte a byte, com o verificador aprovando. */
async function passaNoFiltro(rascunho: string, f: FatosDoTurno) {
  expect(regras(rascunho, f), rascunho).toEqual([]);
  const { decisao, verificador } = await noFiltro(rascunho, f);
  expect(decisao, rascunho).toMatchObject({ aprovado: true });
  if (decisao.aprovado) {
    expect(decisao.texto).toBe(rascunho);
  }
  expect(verificador).toHaveBeenCalledTimes(1);
}

describe("achado 1: a negação que de fato rege a prioridade", () => {
  it.each([
    "Sem dúvida você terá prioridade na lista.",
    "Não tenha dúvida que terá prioridade na lista.",
    "Não se preocupe que terá prioridade na lista.",
    "Você não vai ficar sem prioridade na lista.",
  ])("a regressão volta a barrar: %s", async (texto) => {
    for (const f of [fatos(), ENTROU, MARCOU]) {
      expect(regras(texto, f), texto).toContain("vaga_prometida");
    }
    await barraPelaRegra(texto, ENTROU);
  });

  it("o duplo negativo e as falsas negações também prometem", () => {
    for (const texto of [
      "Você não fica sem prioridade na lista.",
      "Você nunca vai ficar sem prioridade na lista.",
      "Ninguém fica sem prioridade na lista.",
      "Fique tranquila, você não perde a prioridade na lista.",
      "Nem se preocupe que terá prioridade na lista.",
      "Sem dúvida nenhuma você tem prioridade na fila.",
      "Pode ficar tranquila que você não tem como perder a prioridade na lista.",
      "Não tem erro, você terá prioridade na lista.",
      "Nenhum problema: você terá prioridade na lista.",
      "Ninguém vai passar na sua frente, você tem prioridade na lista.",
      "Não se preocupe, você terá prioridade quando abrir um horário.",
    ]) {
      expect(regras(texto, ENTROU), texto).toContain("vaga_prometida");
    }
  });

  it("a negação que rege a prioridade não promete", async () => {
    await passaNoFiltro("Não existe ordem de prioridade na lista.", ENTROU);
    for (const texto of [
      "Não existe ordem de prioridade na lista.",
      "Não existe ordem de prioridade na lista: quando abre um horário, as pessoas da lista recebem a mensagem.",
      "A lista não funciona por prioridade.",
      "Não há prioridade na lista: quando abre um horário, todos recebem a mensagem.",
      "Na lista não tem prioridade.",
      "Na lista de espera, ninguém tem prioridade.",
      "Nenhuma pessoa da lista tem prioridade.",
      "Não existe nenhum tipo de prioridade na lista.",
      "Na lista não existe essa coisa de prioridade.",
      "Não posso te dar prioridade na lista.",
      "Não há como dar prioridade na lista.",
      "Você não terá prioridade na lista.",
      "Não vai ter prioridade na lista, mas você recebe a mensagem.",
      "Você não precisa de prioridade na lista.",
      "A lista não é por ordem de chegada nem por prioridade.",
      "É por ordem de chegada, não por prioridade, a lista.",
      "Não damos preferência ou prioridade na lista.",
      "Sem prioridade na fila: todos recebem a mensagem ao mesmo tempo.",
      "Nenhuma prioridade na lista: todos recebem juntos.",
      "Não sei se você terá prioridade na lista.",
      "Idosos e gestantes têm prioridade no atendimento.",
    ]) {
      expect(regras(texto, ENTROU), texto).not.toContain("vaga_prometida");
    }
  });
});

/**
 * Achado 2a: as palavras (de 4 letras ou mais) que as frases fixas da lista
 * dizem por outro motivo: as dos moldes T-E1, T-E2 e T-E4 e as dos pedacos
 * que os preenchem (o profissional, o pagamento e a preferencia).
 */
function palavrasDosTextosFixos(): string[] {
  const textos = [
    PERGUNTA_DA_LISTA_DE_ESPERA,
    RESPOSTA_DA_LISTA_DE_ESPERA,
    LEMBRETE_DA_OFERTA,
    COM_QUALQUER_PROFISSIONAL,
    NO_PARTICULAR,
    "pelo convênio",
    ...Object.values(PERIODO_NA_FRASE),
    ...DIA_NA_FRASE,
    ...Object.values(PREFERENCIA_EM_QUALQUER),
  ].map((texto) => texto.replace(/\{\{[^{}]*\}\}/g, " "));
  return [
    ...new Set(
      textos.flatMap((texto) =>
        normalizarBase(texto)
          .split(/[^a-z0-9]+/)
          .filter((p) => p.length >= 4 && !/^\d+$/.test(p)),
      ),
    ),
  ];
}

describe("achado 2a: o procedimento citado em parte não lê as palavras da própria lista", () => {
  /** Um procedimento do Cadastro com cada palavra dos textos fixos. */
  const palavras = palavrasDosTextosFixos();
  const comAsPalavras = (entrada: EntradaDaEsperaDoFato) =>
    fatos({
      listaDeEsperaLigada: true,
      acoes: ["lista_de_espera"],
      procedimentos: [
        ...PROCEDIMENTOS_DA_BATERIA,
        ...palavras.map((p) => `Protocolo ${p}`),
        "Consulta com profissional",
        "Avaliação pelo WhatsApp",
        "Pronto atendimento",
        "Massagem relaxante",
      ],
      entradasDaEspera: [entrada],
    });

  const PEDIDOS: readonly PedidoDaEsperaEmTexto[] = [
    {
      procedimento: "Limpeza de pele",
      profissional: null,
      convenio: null,
      turnos: ["manha"],
      dias: [1, 3],
    },
    {
      procedimento: "Limpeza de pele",
      profissional: "Dra. Ana Lima",
      convenio: "Unimed (Nacional)",
      turnos: [],
      dias: [],
    },
    {
      procedimento: "Limpeza de pele",
      profissional: null,
      convenio: "Bradesco Saúde",
      turnos: ["tarde", "noite"],
      dias: [0, 2, 4, 5, 6],
    },
    {
      procedimento: "Limpeza de pele",
      profissional: "Dra. Ana Lima",
      convenio: null,
      turnos: [],
      dias: [1, 2, 3, 4, 5],
    },
    {
      procedimento: "Limpeza de pele",
      profissional: null,
      convenio: null,
      turnos: ["manha"],
      dias: [],
    },
    {
      procedimento: "Limpeza de pele",
      profissional: null,
      convenio: null,
      turnos: [],
      dias: [6],
    },
  ];

  it("as palavras dos textos fixos existem (o teste lê os textos de verdade)", () => {
    for (const palavra of [
      "confirma",
      "entrada",
      "pronto",
      "entrou",
      "profissional",
      "whatsapp",
      "particular",
      "qualquer",
      "responda",
      "continua",
      "assunto",
    ]) {
      expect(palavras).toContain(palavra);
    }
  });

  it.each(PEDIDOS.map((p, i) => [i + 1, p] as const))(
    "T-E1, T-E2 e T-E4 com a entrada %i não leem palavra delas como outro procedimento",
    (_i, pedido) => {
      const entrada: EntradaDaEsperaDoFato = {
        procedimento: pedido.procedimento,
        profissional: pedido.profissional,
        turnos: [...pedido.turnos],
        dias: [...pedido.dias],
        origem: "turno",
      };
      const f = comAsPalavras(entrada);
      const lembrete = textoDoLembreteDaOferta({
        inicioDoHorario: "2026-11-03T12:00:00Z",
        venceEm: "2026-10-27T13:30:00Z",
        fuso: "America/Fortaleza",
      });
      for (const texto of [
        perguntaDaListaDeEspera(pedido),
        respostaDaListaDeEspera(pedido),
        lembrete,
      ]) {
        expect(regras(texto, f), texto).not.toContain("espera_fora_da_entrada");
      }
      // E o que a IA escreve com essas palavras.
      for (const texto of [
        "Pronto, você já está na lista de espera.",
        "Prontinho, você continua na lista de espera.",
        "Você está na lista de espera com qualquer profissional, e se abrir um horário você recebe uma mensagem pelo WhatsApp.",
      ]) {
        expect(regras(texto, f), texto).not.toContain("espera_fora_da_entrada");
      }
    },
  );

  it("a T-E2 com qualquer profissional passa no filtro inteiro com esse Cadastro", async () => {
    const pedido = PEDIDOS[0];
    if (pedido === undefined) {
      throw new Error("sem pedido");
    }
    await passaNoFiltro(
      respostaDaListaDeEspera(pedido),
      comAsPalavras({ ...ENTRADA_DA_ANA, profissional: null }),
    );
  });

  it("o procedimento de outro nome, inteiro ou em parte, continua barrando", () => {
    const f = comAsPalavras(ENTRADA_DA_ANA);
    for (const texto of [
      "Você está na lista de espera para a massagem.",
      "Você está na lista de espera para Avaliação pelo WhatsApp.",
      "Você está na lista de espera para Consulta com profissional.",
      "Você está na lista de espera para peeling.",
    ]) {
      expect(regras(texto, f), texto).toContain("espera_fora_da_entrada");
    }
  });
});

describe("achado 2b: a primeira da agenda do dia não é posição na fila", () => {
  it("com a consulta lida, passa no filtro inteiro", async () => {
    await passaNoFiltro(
      "Você será a primeira a ser atendida amanhã às 8h.",
      CONSULTA_DE_AMANHA,
    );
    for (const texto of [
      "Você será a primeira a ser atendida amanhã às 8h.",
      "Sua consulta é amanhã às 8h: você será a primeira a ser atendida do dia.",
      "Você é a primeira a ser atendida do dia.",
    ]) {
      expect(regras(texto, CONSULTA_DE_AMANHA), texto).toEqual([]);
      expect(regras(texto, CONSULTA_E_LISTA), texto).toEqual([]);
    }
  });

  it("a posição na fila continua barrando: sem dia nem hora, com a lista ou a abertura, ou sem fato de horário", () => {
    for (const [texto, f] of [
      ["Você é a próxima a ser chamada.", CONSULTA_DE_AMANHA],
      ["Você é a próxima a ser chamada.", ENTROU],
      ["Você vai ser a primeira a ser avisada.", ENTROU],
      [
        "Você será a primeira a ser chamada quando abrir um horário amanhã às 8h.",
        CONSULTA_DE_AMANHA,
      ],
      [
        "Na lista de espera, você será a primeira a ser chamada amanhã às 8h.",
        CONSULTA_E_LISTA,
      ],
      ["Você será a primeira a ser atendida amanhã às 8h.", ENTROU],
      ["Você será a primeira a ser atendida amanhã às 8h.", fatos()],
    ] as const) {
      expect(regras(texto, f), texto).toContain("vaga_prometida");
    }
  });
});

describe("achado 2c: a desistência da própria pessoa não abre horário", () => {
  it("passa no filtro inteiro, com a consulta lida e sem fato nenhum", async () => {
    const texto =
      "Não há multa por desistência; se quiser, eu marco outro horário para você.";
    await passaNoFiltro(texto, CONSULTA_DE_AMANHA);
    expect(regras(texto, fatos())).toEqual([]);
    for (const outro of [
      "A desistência não tem custo; se quiser, eu marco outro horário para você.",
      "Sua desistência não tem multa, e eu marco outro horário para você.",
      "Se você desistir, eu marco outro horário para você.",
      "Caso desista, eu marco outro horário para você.",
      "Se quiser desistir, eu marco outro horário para você.",
      "Não cobramos taxa de desistência, e eu marco outro horário para você.",
    ]) {
      expect(regras(outro, CONSULTA_DE_AMANHA), outro).toEqual([]);
    }
  });

  it("a desistência de outra pessoa continua sendo horário que vai abrir", () => {
    for (const [texto, f] of [
      ["Se houver desistência, a vaga é sua.", MARCOU],
      ["Se houver desistência, eu marco para você.", ENTROU],
      ["Se alguém desistir, eu marco para você.", ENTROU],
      ["Caso alguém desista, o horário é seu.", MARCOU],
      ["Se desistirem, o horário é seu.", MARCOU],
      ["Se a paciente desistir, o horário é seu.", MARCOU],
      ["Em caso de desistência, o horário é seu.", MARCOU],
      ["Havendo desistência, o horário é seu.", MARCOU],
      ["Quando tiver uma desistência, eu te encaixo.", ENTROU],
      // "por desistencia" sem a multa ou a taxa nao e da propria pessoa.
      ["Quando há vaga por desistência, ela é sua.", MARCOU],
    ] as const) {
      expect(regras(texto, f), texto).toContain("vaga_prometida");
    }
  });
});

describe("achado 2d: a reserva que vale até o horário voltar a ficar livre", () => {
  it("com a reserva, passa no filtro inteiro", async () => {
    await passaNoFiltro(
      "Reservei terça, 21/10 às 14:00. Se você não confirmar em 10 minutos, o horário volta a ficar livre; até lá, ele é seu.",
      RESERVOU,
    );
    for (const texto of [
      "Reservei terça, 21/10 às 14:00. Se você não confirmar em 10 minutos, o horário volta a ficar livre; ele é seu só até lá.",
      "Reservei terça, 21/10 às 14:00. Por enquanto, o horário é seu; se não confirmar em 10 minutos, ele volta a ficar livre.",
    ]) {
      expect(regras(texto, RESERVOU), texto).toEqual([]);
    }
  });

  it("sem o horário da pessoa, ou com a promessa de verdade, barra", () => {
    const ateLa =
      "Se você não confirmar, o horário volta a ficar livre; até lá, ele é seu.";
    for (const [texto, f] of [
      [ateLa, fatos()],
      [ateLa, BUSCOU],
      [ateLa, ENTROU],
      ["Se o horário de quarta ficar livre, ele é seu.", RESERVOU],
      ["Se o horário de quarta voltar a ficar livre, ele é seu.", RESERVOU],
      ["Quando abrir um horário, ele é seu por 30 minutos.", RESERVOU],
      [
        "Reservei terça, 21/10 às 14:00. Até lá, ele é seu, e se abrir outro horário, eu marco para você.",
        RESERVOU,
      ],
      // O "ate la" que e o prazo do cancelamento de outra pessoa: a posse
      // vem depois dele.
      ["Se alguém cancelar até lá, o horário é seu.", RESERVOU],
      ["Se alguém cancelar até lá, o horário é seu.", MARCOU],
    ] as const) {
      expect(regras(texto, f), texto).toContain("vaga_prometida");
    }
  });
});

describe("achado 3: o horário que 'é seu' sem fato de horário no turno", () => {
  it("sem busca, reserva, marcação nem consulta lida, barra com a agenda na frase", async () => {
    for (const texto of [
      "Sim! O horário é seu.",
      "Pode ficar tranquila, a vaga é sua.",
      "Sim, esse horário fica com você.",
    ]) {
      for (const f of [fatos(), ENTROU, fatos({ listaDeEsperaLigada: true })]) {
        expect(regras(texto, f), texto).toContain("vaga_prometida");
      }
    }
    await barraPelaRegra("Sim! O horário é seu.", ENTROU);
  });

  it("sem a agenda na frase, o pronome não promete", () => {
    for (const texto of [
      "Sim! Ele é seu.",
      "A escolha é sua.",
      "Ela é sua, a ficha de cadastro.",
    ]) {
      expect(regras(texto, fatos()), texto).not.toContain("vaga_prometida");
    }
  });

  it("os falsos positivos da AG3 não voltam: com a marcação, a reserva ou a busca, passa", async () => {
    for (const [texto, f] of [
      ["Sim! O horário é seu.", MARCOU],
      ["O horário é seu.", RESERVOU],
      ["O horário é seu.", BUSCOU],
      ["Sim! O horário é seu.", CONSULTA_DE_AMANHA],
      [
        "Pronto! Sua consulta ficou marcada para terça, 21/10 às 14:00. O horário é seu.",
        MARCOU,
      ],
      [
        "Reservei terça, 21/10 às 14:00. O horário fica com você por 10 minutos.",
        RESERVOU,
      ],
      ["Tenho terça, 21/10 às 14:00. Se quiser, o horário é seu.", BUSCOU],
    ] as const) {
      await passaNoFiltro(texto, f);
      await passaNoFiltro(texto, { ...f, listaDeEsperaLigada: true });
    }
  });

  it("'Logo logo abre' (sem dizer o que abre) a regra nao le", () => {
    // A clinica tambem "logo abre" ("esta fechada agora, mas logo abre, e ai
    // te passo os horarios"): a regra nao le o verbo sem o que abre. Era so
    // do modelo (AG5R2-S09); desde 11/11/2026 e risco aceito (docs/03, 41).
    expect(
      regras("Logo logo abre, pode deixar que te aviso do horário.", ENTROU),
    ).not.toContain("vaga_prometida");
  });
});

describe("achado 4: a ação de quem age pela clínica e o particípio que abre", () => {
  it("barram", () => {
    for (const [texto, f] of [
      ["Quando surgir um horário, a recepção marca para você.", ENTROU],
      ["Se o horário for liberado, eu marco para você.", ENTROU],
      ["Quando surgir um horário, a equipe te encaixa.", ENTROU],
      ["Se abrir um horário, eles vão te marcar.", ENTROU],
      ["Se abrir um horário, a recepção vai reservar para você.", ENTROU],
      ["Se abrir um horário, ele é marcado para você.", ENTROU],
      ["Se abrir um horário, você é encaixada automaticamente.", ENTROU],
      ["Quando for aberta uma vaga, eu marco para você.", ENTROU],
      ["Se a agenda de dezembro for aberta, eu marco para você.", ENTROU],
      ["Se o horário for liberado, ele é seu.", MARCOU],
      ["Quando surgir um horário, a recepção marca para você.", fatos()],
      ["Se o horário for liberado, eu marco para você.", MARCOU],
      // O profissional (o nome do Cadastro chega mascarado).
      ["Quando abrir um horário, a Dra. Ana Lima te encaixa.", ENTROU],
      ["Se abrir um horário, a doutora marca para você.", ENTROU],
      [
        "Se surgir um horário com a Dra. Ana Lima, ela reserva para você.",
        ENTROU,
      ],
    ] as const) {
      expect(regras(texto, f), texto).toContain("vaga_prometida");
    }
  });

  it("não barram: a negação, o aviso, quem responder primeiro, sem abertura e o estado", () => {
    for (const texto of [
      "Se abrir um horário, a equipe te avisa pelo WhatsApp.",
      "Se abrir um horário assim, a recepção não marca para você: você recebe uma mensagem pelo WhatsApp.",
      "Se abrir um horário, a equipe agenda com quem responder primeiro.",
      "Se abrir um horário, você não é encaixada: recebe uma mensagem pelo WhatsApp.",
      "Assim que você escolher, a equipe marca para você.",
      "A recepção marca para você.",
      "Se a agenda estiver aberta, a equipe te passa os horários.",
      "Se o resultado for liberado, eu te aviso.",
      "Se abrir um horário com a Dra. Ana Lima, você recebe uma mensagem pelo WhatsApp.",
      "Se abrir um horário, ela não te encaixa: você recebe uma mensagem pelo WhatsApp.",
      "A Dra. Ana Lima te encaixa.",
    ]) {
      expect(regras(texto, ENTROU), texto).not.toContain("vaga_prometida");
    }
  });
});

describe("versão das regras", () => {
  it("as regras novas entram na versão, e a versão mudou", () => {
    const fontes = FONTES_DOS_FATOS.join("\n");
    expect(fontes).toContain("vaga_prometida (revisao 2)");
    expect(fontes).toContain("sem fato de horario agenda");
    expect(fontes).toContain("ordem da agenda");
    expect(fontes).toContain("posse ate la");
    expect(fontes).toContain("whatsapp");
    expect(versaoDasRegras()).not.toBe("regras-436b8506c197");
  });
});
