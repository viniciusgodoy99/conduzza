import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  acoesDoItem,
  agendadasKeys,
  assinanteDaAgendada,
  assinaturaDoItem,
  atalhosDeData,
  autoriaDaBolha,
  avisosDoItem,
  dataMaximaDaAgendada,
  decidirJanelaDaAgendada,
  descricaoDaEdicao,
  descricaoDoAgendamento,
  DICAS_DA_AGENDADA,
  ehMotivoDaAgendada,
  ehSituacaoDaAgendada,
  ERROS_DA_AGENDADA,
  estadoDoItem,
  ficaSempreAVista,
  FOLGA_DA_JANELA_MS,
  HORIZONTE_EM_MESES,
  limitesDaData,
  linhaDaAtividade,
  linhaDoEstadoDoItem,
  MOTIVOS_DA_AGENDADA,
  PRAZO_DA_AGENDADA_MS,
  prazoDaEsperaDaAgendada,
  prazoEfetivoDaAgendada,
  problemaNoTexto,
  quandoEmTexto,
  resumoDaLista,
  rotuloDoDispensar,
  SILENCIO_FIM_HORA,
  SILENCIO_INICIO_HORA,
  SITUACOES_DA_AGENDADA,
  tamanhoDoTexto,
  TETO_DE_AGENDADAS_POR_CONTATO,
  TEXTO_MAXIMO_DA_AGENDADA,
  textoAcessivelDeQuando,
  textoDaPreviaDoAgendamento,
  textoDeQuandoSai,
  textoDoMotivo,
  textoDoSucessoDoAgendamento,
  TOLERANCIA_DE_ATRASO_MS,
  validarQuando,
  type AgendadaDaLista,
  type ContextoDaListaDeAgendadas,
  type ContextoDasAcoesDaAgendada,
  type EstadoDoItemDaAgendada,
} from "@/lib/domain/mensagem-agendada";

// Mensagem agendada, dominio puro: datas no fuso da clinica (regra 3.6), a
// regra da madrugada (A2), o estado e as acoes do item com as dicas (A1), os
// textos do motivo e da atividade (A3). Nenhum relogio: "agora" e o fuso
// entram por parametro.

const FORTALEZA = "America/Fortaleza"; // UTC-3, sem horario de verao
const TOQUIO = "Asia/Tokyo"; // UTC+9

// 06/10/2026 (terca) as 15:00 em Fortaleza = 18:00 UTC.
const AGORA = Date.parse("2026-10-06T18:00:00.000Z");
const MIN = 60_000;
const HORA = 60 * MIN;

const ANA = "00000000-0000-4000-8000-0000000000a1";
const BRUNO = "00000000-0000-4000-8000-0000000000b2";
const CARLA = "00000000-0000-4000-8000-0000000000c3";
const NUMERO_1 = "00000000-0000-4000-8000-000000000101";
const NUMERO_2 = "00000000-0000-4000-8000-000000000102";
const NOMES: Record<string, string> = {
  [ANA]: "Ana Souza",
  [BRUNO]: "Bruno Lima",
  [CARLA]: "Carla Dias",
};

function agendada(campos: Partial<AgendadaDaLista> = {}): AgendadaDaLista {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    contactId: "00000000-0000-4000-8000-000000000002",
    whatsappAccountId: NUMERO_1,
    conversationId: "00000000-0000-4000-8000-000000000003",
    texto: "Bom dia! Passando para lembrar do retorno.",
    enviarEm: "2026-10-07T12:00:00.000Z", // amanha 09:00
    situacao: "agendada",
    motivo: null,
    criadaPor: ANA,
    editadaPor: null,
    enviadaEm: null,
    messageId: null,
    dispensadaEm: null,
    criadaEm: "2026-10-06T13:00:00.000Z", // hoje 10:00
    editadaEm: null,
    ...campos,
  };
}

function contexto(
  campos: Partial<ContextoDaListaDeAgendadas> = {},
): ContextoDaListaDeAgendadas {
  return {
    ultimaEntradaPorNumero: { [NUMERO_1]: null },
    conexaoPorNumero: {
      [NUMERO_1]: {
        nome: "Recepção",
        conectado: true,
        removido: false,
        cor: "azul",
      },
    },
    membrosComEscrita: [ANA, BRUNO],
    ...campos,
  };
}

function desconectado(removido = false): ContextoDaListaDeAgendadas {
  return contexto({
    conexaoPorNumero: {
      [NUMERO_1]: { nome: "Recepção", conectado: false, removido, cor: "azul" },
    },
  });
}

// ---------------------------------------------------------------------------

describe("listas fechadas e constantes", () => {
  it("situações e motivos são os do desenho, na ordem", () => {
    expect(SITUACOES_DA_AGENDADA).toEqual([
      "agendada",
      "enviando",
      "enviada",
      "nao_enviada",
      "nao_confirmada",
      "cancelada",
    ]);
    expect(MOTIVOS_DA_AGENDADA).toEqual([
      "sem_autorizacao",
      "numero_removido",
      "numero_desconectado",
      "atrasou",
      "madrugada",
      "canal_ocupado",
      "falha_no_envio",
      "envio_incerto",
      "enviada_agora",
    ]);
    expect(ehSituacaoDaAgendada("enviando")).toBe(true);
    expect(ehSituacaoDaAgendada("pendente")).toBe(false);
    expect(ehMotivoDaAgendada("atrasou")).toBe(true);
    expect(ehMotivoDaAgendada("desconectado")).toBe(false);
    expect(ehMotivoDaAgendada(null)).toBe(false);
  });

  it("constantes do contrato", () => {
    expect(TEXTO_MAXIMO_DA_AGENDADA).toBe(4096);
    expect(TETO_DE_AGENDADAS_POR_CONTATO).toBe(10);
    expect(HORIZONTE_EM_MESES).toBe(12);
    expect(SILENCIO_INICIO_HORA).toBe(21);
    expect(SILENCIO_FIM_HORA).toBe(8);
    expect(TOLERANCIA_DE_ATRASO_MS).toBe(15 * MIN);
    expect(PRAZO_DA_AGENDADA_MS).toBe(12 * HORA);
    expect(FOLGA_DA_JANELA_MS).toBe(5 * MIN);
  });

  it("chave do TanStack Query por contato", () => {
    expect(agendadasKeys.doContato("c1", "p1")).toEqual([
      "agendadas",
      "c1",
      "p1",
    ]);
  });

  it("chave do TanStack Query da autoria no fio, por conversa (F11)", () => {
    expect(agendadasKeys.doFio("conversa-1")).toEqual([
      "agendadas-do-fio",
      "conversa-1",
    ]);
  });

  it("assinante é quem editou por último, senão quem criou (A1)", () => {
    expect(assinanteDaAgendada(agendada())).toBe(ANA);
    expect(assinanteDaAgendada(agendada({ editadaPor: BRUNO }))).toBe(BRUNO);
  });
});

// ---------------------------------------------------------------------------

describe("validarQuando (fuso da clínica, teto de 12 meses)", () => {
  const base = { agora: AGORA, fuso: FORTALEZA };

  it("formatos: sem data, data inexistente, sem hora, hora fora do formato", () => {
    expect(validarQuando({ ...base, data: "", hora: "10:00" })).toEqual({
      ok: false,
      erro: "Escolha a data.",
    });
    for (const data of ["2026-02-30", "06/10/2026", "2026-10-6"]) {
      expect(validarQuando({ ...base, data, hora: "10:00" })).toEqual({
        ok: false,
        erro: "Escolha a data.",
      });
    }
    expect(validarQuando({ ...base, data: "2026-10-07", hora: "" })).toEqual({
      ok: false,
      erro: "Escolha a hora.",
    });
    for (const hora of ["9:00", "24:00", "10:60", "10h00", "10:00:00"]) {
      expect(validarQuando({ ...base, data: "2026-10-07", hora })).toEqual({
        ok: false,
        erro: "Escolha a hora.",
      });
    }
  });

  it("hora que já passou (inclusive agora em ponto e ontem)", () => {
    const passou = { ok: false, erro: "Essa hora já passou. Escolha outra." };
    expect(
      validarQuando({ ...base, data: "2026-10-06", hora: "15:00" }),
    ).toEqual(passou);
    expect(
      validarQuando({ ...base, data: "2026-10-06", hora: "09:00" }),
    ).toEqual(passou);
    expect(
      validarQuando({ ...base, data: "2026-10-05", hora: "23:00" }),
    ).toEqual(passou);
  });

  it("um minuto à frente vale e vira o instante UTC do fuso da clínica", () => {
    expect(
      validarQuando({ ...base, data: "2026-10-06", hora: "15:01" }),
    ).toEqual({ ok: true, enviarEm: "2026-10-06T18:01:00.000Z" });
    expect(
      validarQuando({ ...base, data: " 2026-10-07 ", hora: " 09:00 " }),
    ).toEqual({ ok: true, enviarEm: "2026-10-07T12:00:00.000Z" });
  });

  it("o dia do teto vale inteiro; o dia seguinte é recusado com a data máxima", () => {
    expect(
      validarQuando({ ...base, data: "2027-10-06", hora: "23:59" }),
    ).toEqual({ ok: true, enviarEm: "2027-10-07T02:59:00.000Z" });
    expect(
      validarQuando({ ...base, data: "2027-10-07", hora: "00:00" }),
    ).toEqual({
      ok: false,
      erro: "Escolha uma data até 06/10/2027. Mais de 1 ano à frente não dá para agendar.",
    });
  });

  it("teto pelo dia civil da clínica, não pelo UTC", () => {
    // 22:30 do dia 06 em Fortaleza ja e dia 07 em UTC.
    const noite = Date.parse("2026-10-07T01:30:00.000Z");
    expect(
      validarQuando({
        data: "2027-10-07",
        hora: "08:00",
        agora: noite,
        fuso: FORTALEZA,
      }),
    ).toMatchObject({ ok: false });
    expect(
      validarQuando({
        data: "2027-10-07",
        hora: "08:00",
        agora: noite,
        fuso: "UTC",
      }),
    ).toMatchObject({ ok: true });
  });

  it("a mesma data e hora mudam de instante com o fuso", () => {
    const noite = Date.parse("2026-10-07T01:30:00.000Z"); // 22:30 em Fortaleza
    expect(
      validarQuando({
        data: "2026-10-06",
        hora: "23:00",
        agora: noite,
        fuso: FORTALEZA,
      }),
    ).toEqual({ ok: true, enviarEm: "2026-10-07T02:00:00.000Z" });
    expect(
      validarQuando({
        data: "2026-10-06",
        hora: "23:00",
        agora: noite,
        fuso: "UTC",
      }),
    ).toEqual({ ok: false, erro: "Essa hora já passou. Escolha outra." });
  });

  it("29/02/2028: o teto é 28/02/2029", () => {
    const bissexto = Date.parse("2028-02-29T15:00:00.000Z"); // 12:00 local
    expect(dataMaximaDaAgendada("2028-02-29")).toBe("2029-02-28");
    expect(
      validarQuando({
        data: "2029-02-28",
        hora: "18:00",
        agora: bissexto,
        fuso: FORTALEZA,
      }),
    ).toMatchObject({ ok: true });
    expect(
      validarQuando({
        data: "2029-03-01",
        hora: "08:00",
        agora: bissexto,
        fuso: FORTALEZA,
      }),
    ).toEqual({
      ok: false,
      erro: "Escolha uma data até 28/02/2029. Mais de 1 ano à frente não dá para agendar.",
    });
  });

  it("limites do campo Data", () => {
    expect(limitesDaData("2026-10-06")).toEqual({
      min: "2026-10-06",
      max: "2027-10-06",
    });
  });
});

describe("texto da mensagem", () => {
  it("vazio, só espaços, no limite e acima do limite", () => {
    expect(problemaNoTexto("")).toBe("Escreva a mensagem.");
    expect(problemaNoTexto("   \n ")).toBe("Escreva a mensagem.");
    expect(problemaNoTexto("Oi")).toBeNull();
    expect(problemaNoTexto("a".repeat(4096))).toBeNull();
    expect(problemaNoTexto(`  ${"a".repeat(4096)}  `)).toBeNull();
    expect(problemaNoTexto("a".repeat(4097))).toBe(
      "A mensagem tem 4097 caracteres e o limite é 4096. Encurte antes de agendar.",
    );
  });

  it("conta em unidades UTF-16, a régua do envio 1:1 (emoji é 2) (F16)", () => {
    expect(tamanhoDoTexto("ok 👍")).toBe(5);
    expect(problemaNoTexto("👍".repeat(2048))).toBeNull();
    // 2049 emojis: 2049 para o Postgres, 4098 para o envio 1:1. Agendar
    // isso deixava o "Enviar agora" recusar depois de retirar.
    expect(problemaNoTexto("👍".repeat(2049))).toBe(
      "A mensagem tem 4098 caracteres e o limite é 4096. Encurte antes de agendar.",
    );
    // A mesma regua do bodySchema do sendMessageAction (.max conta .length).
    const corpo = "👍".repeat(2049);
    expect(corpo.length > TEXTO_MAXIMO_DA_AGENDADA).toBe(
      problemaNoTexto(corpo) !== null,
    );
  });
});

describe("atalhos de data", () => {
  it("dias e meses a partir de hoje na clínica", () => {
    expect(atalhosDeData("2026-10-06")).toEqual([
      { rotulo: "Amanhã", data: "2026-10-07" },
      { rotulo: "Em 7 dias", data: "2026-10-13" },
      { rotulo: "Em 30 dias", data: "2026-11-05" },
      { rotulo: "Em 3 meses", data: "2027-01-06" },
      { rotulo: "Em 6 meses", data: "2027-04-06" },
    ]);
  });

  it("os meses prendem no fim do mês", () => {
    const atalhos = atalhosDeData("2026-08-31");
    expect(atalhos[3]).toEqual({ rotulo: "Em 3 meses", data: "2026-11-30" });
    expect(atalhos[4]).toEqual({ rotulo: "Em 6 meses", data: "2027-02-28" });
  });
});

// ---------------------------------------------------------------------------

describe("textoDeQuandoSai e companhia", () => {
  it("hoje, amanhã, dd/MM e dd/MM/aaaa", () => {
    expect(textoDeQuandoSai("2026-10-06T18:30:00.000Z", AGORA, FORTALEZA)).toBe(
      "Sai hoje às 15:30",
    );
    expect(textoDeQuandoSai("2026-10-07T12:00:00.000Z", AGORA, FORTALEZA)).toBe(
      "Sai amanhã às 09:00",
    );
    expect(textoDeQuandoSai("2026-10-08T14:00:00.000Z", AGORA, FORTALEZA)).toBe(
      "Sai em 08/10 às 11:00",
    );
    expect(textoDeQuandoSai("2027-01-06T12:00:00.000Z", AGORA, FORTALEZA)).toBe(
      "Sai em 06/01/2027 às 09:00",
    );
  });

  it("o dia é o da clínica, não o UTC", () => {
    // 02:30 UTC do dia 07 = 23:30 do dia 06 em Fortaleza.
    expect(textoDeQuandoSai("2026-10-07T02:30:00.000Z", AGORA, FORTALEZA)).toBe(
      "Sai hoje às 23:30",
    );
    expect(textoDeQuandoSai("2026-10-07T02:30:00.000Z", AGORA, "UTC")).toBe(
      "Sai amanhã às 02:30",
    );
  });

  it("dia que já passou sai com a data, nunca ontem", () => {
    expect(textoDeQuandoSai("2026-10-05T12:00:00.000Z", AGORA, FORTALEZA)).toBe(
      "Sai em 05/10 às 09:00",
    );
  });

  it("quandoEmTexto: ontem, e o 'em' só quando pedido", () => {
    expect(quandoEmTexto("2026-10-05T12:00:00.000Z", AGORA, FORTALEZA)).toBe(
      "ontem às 09:00",
    );
    expect(quandoEmTexto("2026-10-08T14:00:00.000Z", AGORA, FORTALEZA)).toBe(
      "08/10 às 11:00",
    );
    expect(
      quandoEmTexto("2026-10-08T14:00:00.000Z", AGORA, FORTALEZA, {
        comEm: true,
      }),
    ).toBe("em 08/10 às 11:00");
    expect(
      quandoEmTexto("2026-10-06T14:00:00.000Z", AGORA, FORTALEZA, {
        comEm: true,
      }),
    ).toBe("hoje às 11:00");
  });

  it("leitor de tela: dia da semana por extenso, com o ano só quando muda", () => {
    expect(
      textoAcessivelDeQuando("2027-01-06T12:00:00.000Z", AGORA, FORTALEZA),
    ).toBe("Sai na quarta, 6 de janeiro de 2027, às 09:00");
    expect(
      textoAcessivelDeQuando("2026-10-10T12:00:00.000Z", AGORA, FORTALEZA),
    ).toBe("Sai no sábado, 10 de outubro, às 09:00");
  });

  it("prévia e sucesso do diálogo, sempre com o ano", () => {
    expect(
      textoDaPreviaDoAgendamento("2027-01-06T12:00:00.000Z", FORTALEZA),
    ).toBe(
      "Sai quarta, 06/01/2027, às 09:00, horário da clínica (pode levar alguns minutos).",
    );
    expect(
      textoDoSucessoDoAgendamento("2027-01-06T12:00:00.000Z", FORTALEZA),
    ).toBe("Mensagem agendada para 06/01/2027 às 09:00.");
  });
});

// ---------------------------------------------------------------------------

describe("prazoDaEsperaDaAgendada", () => {
  it("é a hora marcada mais 12 horas, em ms", () => {
    expect(prazoDaEsperaDaAgendada("2026-10-06T18:00:00.000Z")).toBe(
      Date.parse("2026-10-07T06:00:00.000Z"),
    );
  });

  it("data ilegível não tem o que esperar", () => {
    expect(prazoDaEsperaDaAgendada("ontem")).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("prazoEfetivoDaAgendada (F4: até quando ainda sai, com a madrugada)", () => {
  const efetivo = (enviarEm: string, fuso = FORTALEZA) =>
    new Date(prazoEfetivoDaAgendada(enviarEm, fuso)).toISOString();

  it("marcada entre 09:00 e 20:00: a faixa das 21:00 corta o prazo", () => {
    // 14:00 local: prazo 02:00, mas das 21:00 em diante a atrasada nao sai
    expect(efetivo("2026-10-06T17:00:00.000Z")).toBe(
      "2026-10-07T00:00:00.000Z",
    );
    // 09:00 local: o prazo e as 21:00, o mesmo instante
    expect(efetivo("2026-10-06T12:00:00.000Z")).toBe(
      "2026-10-07T00:00:00.000Z",
    );
    // 19:59 local: o 08:00 passa do prazo (07:59)
    expect(efetivo("2026-10-06T22:59:00.000Z")).toBe(
      "2026-10-07T00:00:00.000Z",
    );
  });

  it("marcada a partir das 20:00: o 08:00 cabe no prazo e ela espera; o limite é o prazo", () => {
    // 20:00 local: o 08:00 seguinte e o proprio prazo
    expect(efetivo("2026-10-06T23:00:00.000Z")).toBe(
      "2026-10-07T11:00:00.000Z",
    );
    // 22:00 local
    expect(efetivo("2026-10-07T01:00:00.000Z")).toBe(
      "2026-10-07T13:00:00.000Z",
    );
    // 03:00 local: o atraso cai na faixa da madrugada, que acaba as 08:00
    expect(efetivo("2026-10-06T06:00:00.000Z")).toBe(
      "2026-10-06T18:00:00.000Z",
    );
    // 08:30 local: prazo 20:30, antes da faixa
    expect(efetivo("2026-10-06T11:30:00.000Z")).toBe(
      "2026-10-06T23:30:00.000Z",
    );
  });

  it("bate com decidirJanelaDaAgendada: até o limite sai (ou espera), depois dele nada sai", () => {
    const marcadas = [
      "2026-10-06T12:00:00.000Z",
      "2026-10-06T17:00:00.000Z",
      "2026-10-06T22:30:00.000Z",
      "2026-10-06T23:00:00.000Z",
      "2026-10-07T02:00:00.000Z",
      "2026-10-06T06:00:00.000Z",
    ];
    for (const enviarEm of marcadas) {
      const limite = prazoEfetivoDaAgendada(enviarEm, FORTALEZA);
      const antes = decidirJanelaDaAgendada({
        enviarEm,
        agora: limite - MIN,
        fuso: FORTALEZA,
      });
      expect(antes.acao, enviarEm).not.toBe("desistir");
      const depois = decidirJanelaDaAgendada({
        enviarEm,
        agora: limite + FOLGA_DA_JANELA_MS + MIN,
        fuso: FORTALEZA,
      });
      expect(depois.acao, enviarEm).toBe("desistir");
    }
  });

  it("o fuso é o da clínica, e data ilegível não tem limite", () => {
    // 12:00 UTC = 21:00 em Toquio: marcada na faixa, espera as 08:00
    expect(efetivo("2026-10-06T12:00:00.000Z", TOQUIO)).toBe(
      "2026-10-07T00:00:00.000Z",
    );
    expect(prazoEfetivoDaAgendada("ontem", FORTALEZA)).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });
});

describe("decidirJanelaDaAgendada (A2, madrugada)", () => {
  const decidir = (enviarEm: string, agora: string, fuso = FORTALEZA) =>
    decidirJanelaDaAgendada({ enviarEm, agora: Date.parse(agora), fuso });

  it("no horário: sai, mesmo marcada dentro da faixa (22:00)", () => {
    expect(
      decidir("2026-10-06T18:00:00.000Z", "2026-10-06T18:00:00.000Z"),
    ).toEqual({ acao: "enviar" });
    // 22:00 local, 10 minutos depois
    expect(
      decidir("2026-10-07T01:00:00.000Z", "2026-10-07T01:10:00.000Z"),
    ).toEqual({ acao: "enviar" });
    // 15 minutos em ponto ainda nao e atraso
    expect(
      decidir("2026-10-07T01:00:00.000Z", "2026-10-07T01:15:00.000Z"),
    ).toEqual({ acao: "enviar" });
  });

  it("atrasada fora da faixa: sai", () => {
    expect(
      decidir("2026-10-06T18:00:00.000Z", "2026-10-06T18:16:00.000Z"),
    ).toEqual({ acao: "enviar" });
    // 08:00 em ponto ja e fora da faixa
    expect(
      decidir("2026-10-07T01:00:00.000Z", "2026-10-07T11:00:00.000Z"),
    ).toEqual({ acao: "enviar" });
    // 20:59 local, ainda fora
    expect(
      decidir("2026-10-06T22:00:00.000Z", "2026-10-06T23:59:00.000Z"),
    ).toEqual({ acao: "enviar" });
  });

  it("atrasada na faixa antes da meia-noite: espera as 08:00 do dia seguinte", () => {
    // marcada 20:30, agora 21:00 (30 min de atraso); prazo 08:30 do dia 07
    expect(
      decidir("2026-10-06T23:30:00.000Z", "2026-10-07T00:00:00.000Z"),
    ).toEqual({ acao: "esperar", ate: "2026-10-07T11:00:00.000Z" });
  });

  it("atrasada na faixa depois da meia-noite: espera as 08:00 do mesmo dia", () => {
    // marcada 23:00 do dia 06, agora 01:00 do dia 07; prazo 11:00 do dia 07
    expect(
      decidir("2026-10-07T02:00:00.000Z", "2026-10-07T04:00:00.000Z"),
    ).toEqual({ acao: "esperar", ate: "2026-10-07T11:00:00.000Z" });
  });

  it("o 08:00 depois do prazo: desiste com 'madrugada', não 'atrasou' (F4)", () => {
    // marcada 18:00, agora 21:30 (atrasada); 08:00 do dia 07 passa das 06:00
    expect(
      decidir("2026-10-06T21:00:00.000Z", "2026-10-07T00:30:00.000Z"),
    ).toEqual({ acao: "desistir", motivo: "madrugada" });
  });

  it("marcada 20:00 e atrasada: espera o 08:00, que é o próprio prazo, e sai na volta (F4)", () => {
    // marcada 20:00, agora 21:30: o 08:00 do dia 07 e enviar_em + 12 h
    expect(
      decidir("2026-10-06T23:00:00.000Z", "2026-10-07T00:30:00.000Z"),
    ).toEqual({ acao: "esperar", ate: "2026-10-07T11:00:00.000Z" });
    // a volta do motor: 08:00:20, segundos depois do prazo, ainda sai
    expect(
      decidir("2026-10-06T23:00:00.000Z", "2026-10-07T11:00:20.000Z"),
    ).toEqual({ acao: "enviar" });
    // ate o fim da folga de 5 minutos
    expect(
      decidir("2026-10-06T23:00:00.000Z", "2026-10-07T11:05:00.000Z"),
    ).toEqual({ acao: "enviar" });
    expect(
      decidir("2026-10-06T23:00:00.000Z", "2026-10-07T11:05:01.000Z"),
    ).toEqual({ acao: "desistir", motivo: "atrasou" });
  });

  it("passou de 12 horas e da folga: desiste com 'atrasou', mesmo fora da faixa", () => {
    // marcada 00:00 local, agora 12:05:01 local
    expect(
      decidir("2026-10-06T03:00:00.000Z", "2026-10-06T15:05:01.000Z"),
    ).toEqual({ acao: "desistir", motivo: "atrasou" });
    expect(decidir("ilegivel", "2026-10-06T15:01:00.000Z")).toEqual({
      acao: "desistir",
      motivo: "atrasou",
    });
  });

  it("na faixa depois do prazo (dentro da folga): 'atrasou'", () => {
    // marcada 09:00, prazo 21:00; agora 21:02 (faixa, 08:00 depois do prazo)
    expect(
      decidir("2026-10-06T12:00:00.000Z", "2026-10-07T00:02:00.000Z"),
    ).toEqual({ acao: "desistir", motivo: "atrasou" });
  });

  it("a faixa é a do fuso da clínica", () => {
    // 12:30 UTC = 21:30 em Toquio (faixa) e 09:30 em Fortaleza (fora)
    const enviarEm = "2026-10-06T12:00:00.000Z";
    const agora = "2026-10-06T12:30:00.000Z";
    expect(decidir(enviarEm, agora, TOQUIO)).toEqual({
      acao: "esperar",
      ate: "2026-10-06T23:00:00.000Z",
    });
    expect(decidir(enviarEm, agora, FORTALEZA)).toEqual({ acao: "enviar" });
  });
});

// ---------------------------------------------------------------------------

describe("estadoDoItem", () => {
  const estado = (
    campos: Partial<AgendadaDaLista>,
    ctx = contexto(),
    agora = AGORA,
  ) => estadoDoItem(agendada(campos), ctx, agora, FORTALEZA);

  it("cancelada e dispensada não aparecem", () => {
    expect(estado({ situacao: "cancelada" })).toBeNull();
    expect(
      estado({
        situacao: "nao_enviada",
        motivo: "atrasou",
        dispensadaEm: "2026-10-06T17:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("agendada no futuro, inclusive com o número desconectado", () => {
    expect(estado({})).toBe("agendada");
    expect(estado({}, desconectado())).toBe("agendada");
  });

  it("enviando, ou agendada cuja hora passou, é na fila", () => {
    expect(
      estado({ situacao: "enviando", enviarEm: "2026-10-06T17:59:00.000Z" }),
    ).toBe("na_fila");
    expect(
      estado({ situacao: "agendada", enviarEm: "2026-10-06T17:59:00.000Z" }),
    ).toBe("na_fila");
  });

  it("número desconectado na fila: esperando o número", () => {
    expect(
      estado(
        { situacao: "enviando", enviarEm: "2026-10-06T17:00:00.000Z" },
        desconectado(),
      ),
    ).toBe("esperando_numero");
  });

  it("número removido não reconecta: continua na fila", () => {
    expect(
      estado(
        { situacao: "enviando", enviarEm: "2026-10-06T17:00:00.000Z" },
        desconectado(true),
      ),
    ).toBe("na_fila");
  });

  it("número fora do contexto: na fila", () => {
    expect(
      estado(
        { situacao: "enviando", enviarEm: "2026-10-06T17:00:00.000Z" },
        contexto({ conexaoPorNumero: {} }),
      ),
    ).toBe("na_fila");
  });

  it("atrasada na madrugada: silêncio noturno; desconectada vence", () => {
    const noite = Date.parse("2026-10-07T00:00:00.000Z"); // 21:00
    const campos: Partial<AgendadaDaLista> = {
      situacao: "enviando",
      enviarEm: "2026-10-06T23:30:00.000Z", // 20:30
    };
    expect(estado(campos, contexto(), noite)).toBe("silencio_noturno");
    expect(estado(campos, desconectado(), noite)).toBe("esperando_numero");
  });

  it("enviada fica 24 horas; nao_enviada e nao_confirmada aparecem", () => {
    expect(
      estado({ situacao: "enviada", enviadaEm: "2026-10-06T12:02:00.000Z" }),
    ).toBe("enviada");
    expect(
      estado({ situacao: "enviada", enviadaEm: "2026-10-05T17:00:00.000Z" }),
    ).toBeNull();
    expect(estado({ situacao: "nao_enviada", motivo: "atrasou" })).toBe(
      "nao_enviada",
    );
    expect(
      estado({ situacao: "nao_confirmada", motivo: "envio_incerto" }),
    ).toBe("nao_confirmada");
  });

  const TODOS = [
    "agendada",
    "na_fila",
    "esperando_numero",
    "silencio_noturno",
    "enviada",
    "nao_enviada",
    "nao_confirmada",
  ] as const;

  it("ficam sempre à vista: não enviada, não confirmada e esperando o número", () => {
    const vistos = TODOS.filter((e) =>
      ficaSempreAVista(e, agendada(), contexto()),
    );
    expect(vistos).toEqual([
      "esperando_numero",
      "nao_enviada",
      "nao_confirmada",
    ]);
  });

  it("e a que ainda vai sair com o aviso '{Contato} escreveu depois' (F6)", () => {
    // O paciente escreveu as 11:00, depois de agendada (10:00).
    const ctx = contexto({
      ultimaEntradaPorNumero: { [NUMERO_1]: "2026-10-06T14:00:00.000Z" },
    });
    const vistos = TODOS.filter((e) => ficaSempreAVista(e, agendada(), ctx));
    expect(vistos).toEqual([
      "agendada",
      "na_fila",
      "esperando_numero",
      "silencio_noturno",
      "nao_enviada",
      "nao_confirmada",
    ]);
    // Editada depois da entrada: o aviso some, e ela volta para o resumo.
    expect(
      ficaSempreAVista(
        "agendada",
        agendada({ editadaPor: BRUNO, editadaEm: "2026-10-06T15:00:00.000Z" }),
        ctx,
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("acoesDoItem (A1 e as dicas)", () => {
  const SO = "Seu perfil acompanha o atendimento, sem responder.";
  const comigo: Omit<ContextoDasAcoesDaAgendada, "estado"> = {
    viewerId: BRUNO,
    podeEscrever: true,
    conversaComigo: true,
    statusDaConversa: "em_atendimento",
    nomeDoResponsavel: "Bruno Lima",
    conexaoPorNumero: contexto().conexaoPorNumero,
  };
  const acoes = (
    estado: EstadoDoItemDaAgendada,
    extra: Partial<ContextoDasAcoesDaAgendada> = {},
    campos: Partial<AgendadaDaLista> = {},
  ) => acoesDoItem(agendada(campos), { ...comigo, estado, ...extra });
  const oculta = { visivel: false, habilitada: false, dica: null };
  const livre = { visivel: true, habilitada: true, dica: null };
  const travada = (dica: string) => ({
    visivel: true,
    habilitada: false,
    dica,
  });

  it("SO_ACOMPANHA é o mesmo texto do compositor", () => {
    const codigo = readFileSync(
      path.resolve(
        __dirname,
        "../../../components/atendimento/acoes-da-conversa.tsx",
      ),
      "utf8",
    );
    const casamento = codigo.match(/export const SO_ACOMPANHA =\s*"([^"]+)"/);
    expect(casamento?.[1]).toBe(DICAS_DA_AGENDADA.soAcompanha);
    expect(DICAS_DA_AGENDADA.soAcompanha).toBe(SO);
  });

  it("agendada: quem escreve edita e exclui mesmo sem ter agendado; enviar agora com a conversa", () => {
    // Bruno ve a agendada da Ana: A1 tirou o "so quem agendou".
    expect(acoes("agendada")).toEqual({
      editar: livre,
      excluir: livre,
      enviarAgora: livre,
      agendarDeNovo: oculta,
      dispensar: oculta,
    });
  });

  it("Somente leitura vê tudo desabilitado com SO_ACOMPANHA", () => {
    const r = acoes("agendada", { podeEscrever: false, conversaComigo: true });
    expect(r.editar).toEqual(travada(SO));
    expect(r.excluir).toEqual(travada(SO));
    expect(r.enviarAgora).toEqual(travada(SO));
  });

  it("enviar agora sem a conversa: a dica muda com o status", () => {
    const sem = { conversaComigo: false };
    expect(
      acoes("agendada", { ...sem, statusDaConversa: "resolvida" }).enviarAgora,
    ).toEqual(
      travada(
        "Para enviar agora, use Reabrir e responder, no topo da conversa.",
      ),
    );
    expect(
      acoes("agendada", { ...sem, statusDaConversa: "aguardando_humano" })
        .enviarAgora,
    ).toEqual(travada("Para enviar agora, assuma a conversa."));
    expect(
      acoes("agendada", { ...sem, statusDaConversa: null }).enviarAgora,
    ).toEqual(travada("Para enviar agora, assuma a conversa."));
    expect(
      acoes("agendada", { ...sem, statusDaConversa: "ia_atendendo" })
        .enviarAgora,
    ).toEqual(
      travada("A IA está atendendo. Para enviar agora, assuma a conversa."),
    );
    expect(
      acoes("agendada", {
        ...sem,
        statusDaConversa: "em_atendimento",
        nomeDoResponsavel: "Carla Dias",
      }).enviarAgora,
    ).toEqual(
      travada(
        "Carla Dias está atendendo. Para enviar agora, use Assumir do colega, no topo da conversa.",
      ),
    );
    expect(
      acoes("agendada", {
        ...sem,
        statusDaConversa: "em_atendimento",
        nomeDoResponsavel: null,
      }).enviarAgora,
    ).toEqual(
      travada(
        "Outra pessoa está atendendo. Para enviar agora, use Assumir do colega, no topo da conversa.",
      ),
    );
    // Editar nao depende da conversa (A1)
    expect(
      acoes("agendada", { ...sem, statusDaConversa: "resolvida" }).editar,
    ).toEqual(livre);
  });

  it("enviar agora pela conversa de outro número fica desabilitado", () => {
    expect(
      acoes("agendada", {
        numeroDaConversa: NUMERO_2,
        nomeDoNumeroDaAgendada: "Recepção",
      }).enviarAgora,
    ).toEqual(
      travada(
        "Esta mensagem sai pelo número Recepção. Para enviar agora, abra a conversa desse número.",
      ),
    );
    expect(
      acoes("agendada", { numeroDaConversa: NUMERO_2 }).enviarAgora,
    ).toEqual(
      travada(
        "Esta mensagem sai por outro número. Para enviar agora, abra a conversa desse número.",
      ),
    );
    expect(
      acoes("agendada", { numeroDaConversa: NUMERO_1 }).enviarAgora,
    ).toEqual(livre);
    // Nulo e "nao sei": vale o contrato basico (conversa e status).
    expect(acoes("agendada", { numeroDaConversa: null }).enviarAgora).toEqual(
      livre,
    );
  });

  it("enviar agora com o número da agendada desconectado: desabilitado, ela espera a reconexão (F7)", () => {
    const caido = desconectado().conexaoPorNumero;
    expect(acoes("agendada", { conexaoPorNumero: caido }).enviarAgora).toEqual(
      travada(
        "O número Recepção está desconectado. A mensagem continua agendada e espera a reconexão.",
      ),
    );
    // Vale mesmo sem a conversa comigo: assumir nao resolveria.
    expect(
      acoes("agendada", {
        conexaoPorNumero: caido,
        conversaComigo: false,
        statusDaConversa: "aguardando_humano",
      }).enviarAgora,
    ).toEqual(
      travada(
        "O número Recepção está desconectado. A mensagem continua agendada e espera a reconexão.",
      ),
    );
    // Sem nome
    expect(
      acoes("agendada", {
        conexaoPorNumero: {
          [NUMERO_1]: {
            nome: " ",
            conectado: false,
            removido: false,
            cor: null,
          },
        },
      }).enviarAgora,
    ).toEqual(
      travada(
        "O número está desconectado. A mensagem continua agendada e espera a reconexão.",
      ),
    );
    // Somente leitura continua com a dica do perfil.
    expect(
      acoes("agendada", { conexaoPorNumero: caido, podeEscrever: false })
        .enviarAgora,
    ).toEqual(travada(SO));
    // Numero fora do mapa: nada trava por ele.
    expect(acoes("agendada", { conexaoPorNumero: {} }).enviarAgora).toEqual(
      livre,
    );
    // Editar e excluir continuam livres.
    expect(acoes("agendada", { conexaoPorNumero: caido }).editar).toEqual(
      livre,
    );
  });

  it.each(["na_fila", "silencio_noturno", "esperando_numero"] as const)(
    "%s: editar travado com a dica da fila, excluir livre, sem enviar agora",
    (estado) => {
      const r = acoes(estado);
      expect(r.editar).toEqual(
        travada(
          "Esta mensagem já está na fila para sair e não dá mais para mudar. Você ainda pode excluir.",
        ),
      );
      expect(r.excluir).toEqual(livre);
      expect(r.enviarAgora).toEqual(oculta);
      expect(r.agendarDeNovo).toEqual(oculta);
      expect(r.dispensar).toEqual(oculta);
      const leitura = acoes(estado, { podeEscrever: false });
      expect(leitura.editar).toEqual(travada(SO));
      expect(leitura.excluir).toEqual(travada(SO));
    },
  );

  it("enviada: nenhuma ação (o Ver na conversa é da tela)", () => {
    expect(acoes("enviada")).toEqual({
      editar: oculta,
      excluir: oculta,
      enviarAgora: oculta,
      agendarDeNovo: oculta,
      dispensar: oculta,
    });
  });

  it("não enviada: agendar de novo exige a conversa comigo; dispensar para quem escreve", () => {
    const r = acoes("nao_enviada");
    expect(r.agendarDeNovo).toEqual(livre);
    expect(r.dispensar).toEqual(livre);
    expect(r.editar).toEqual(oculta);
    expect(r.excluir).toEqual(oculta);
    expect(r.enviarAgora).toEqual(oculta);
    expect(
      acoes("nao_enviada", { conversaComigo: false }).agendarDeNovo,
    ).toEqual(travada("Para agendar de novo, assuma a conversa."));
    const leitura = acoes("nao_enviada", { podeEscrever: false });
    expect(leitura.agendarDeNovo).toEqual(travada(SO));
    expect(leitura.dispensar).toEqual(travada(SO));
    expect(rotuloDoDispensar("nao_enviada")).toBe("Dispensar");
  });

  it("não enviada na conversa de um número removido: agendar de novo manda para outro número (F19)", () => {
    const removido = desconectado(true).conexaoPorNumero;
    const r = acoes("nao_enviada", {
      conexaoPorNumero: removido,
      numeroDaConversa: NUMERO_1,
    });
    expect(r.agendarDeNovo).toEqual(
      travada(
        "O número Recepção foi removido. Para agendar de novo, use a conversa de outro número.",
      ),
    );
    // Mesmo sem a conversa comigo: assumir nao resolveria.
    expect(
      acoes("nao_enviada", {
        conexaoPorNumero: removido,
        numeroDaConversa: NUMERO_1,
        conversaComigo: false,
      }).agendarDeNovo,
    ).toEqual(
      travada(
        "O número Recepção foi removido. Para agendar de novo, use a conversa de outro número.",
      ),
    );
    // O dispensar continua livre.
    expect(r.dispensar).toEqual(livre);
    // Na conversa de outro numero (ativo), agendar de novo funciona.
    expect(
      acoes("nao_enviada", {
        conexaoPorNumero: {
          ...removido,
          [NUMERO_2]: {
            nome: "Centro",
            conectado: true,
            removido: false,
            cor: null,
          },
        },
        numeroDaConversa: NUMERO_2,
      }).agendarDeNovo,
    ).toEqual(livre);
    // Sem o numero da conversa, vale o contrato basico.
    expect(
      acoes("nao_enviada", { conexaoPorNumero: removido }).agendarDeNovo,
    ).toEqual(livre);
    // Somente leitura continua com a dica do perfil.
    expect(
      acoes("nao_enviada", {
        conexaoPorNumero: removido,
        numeroDaConversa: NUMERO_1,
        podeEscrever: false,
      }).agendarDeNovo,
    ).toEqual(travada(SO));
  });

  it("envio não confirmado: só Entendi, esconder", () => {
    const r = acoes("nao_confirmada");
    expect(r.dispensar).toEqual(livre);
    expect(r.agendarDeNovo).toEqual(oculta);
    expect(r.editar).toEqual(oculta);
    expect(r.excluir).toEqual(oculta);
    expect(r.enviarAgora).toEqual(oculta);
    expect(rotuloDoDispensar("nao_confirmada")).toBe("Entendi, esconder");
  });

  it("nenhuma dica diz 'só quem agendou' (A1)", () => {
    const textos = Object.values(DICAS_DA_AGENDADA).map((d) =>
      typeof d === "function" ? d("Ana") : d,
    );
    for (const texto of textos) {
      expect(texto).not.toMatch(/só quem agendou/i);
    }
  });
});

// ---------------------------------------------------------------------------

describe("textoDoMotivo", () => {
  const nomes = { contato: "Maria Clara", numero: "Recepção" };

  it("cada motivo em linguagem de recepção", () => {
    const esperado: Record<(typeof MOTIVOS_DA_AGENDADA)[number], string> = {
      sem_autorizacao: "Maria Clara não autoriza receber mensagens",
      numero_removido: "o número Recepção foi removido da clínica",
      numero_desconectado:
        "o número Recepção ficou desconectado por mais de 12 horas",
      atrasou: "o envio atrasou mais de 12 horas",
      madrugada: "o envio atrasou e cairia de madrugada",
      canal_ocupado:
        "o número ficou ocupado com outros envios por tempo demais",
      falha_no_envio: "erro do sistema no envio",
      envio_incerto: "erro do sistema no envio",
      enviada_agora: "erro do sistema no envio",
    };
    for (const motivo of MOTIVOS_DA_AGENDADA) {
      expect(textoDoMotivo(motivo, nomes)).toBe(esperado[motivo]);
    }
  });

  it("código desconhecido ou nulo nunca aparece cru", () => {
    expect(textoDoMotivo("lease_expirado", nomes)).toBe(
      "erro do sistema no envio",
    );
    expect(textoDoMotivo(null, nomes)).toBe("erro do sistema no envio");
    for (const motivo of [...MOTIVOS_DA_AGENDADA, "x_y", null]) {
      expect(textoDoMotivo(motivo, nomes)).not.toMatch(/_/);
    }
  });

  it("sem nome do contato ou do número", () => {
    const vazio = { contato: null, numero: "  " };
    expect(textoDoMotivo("sem_autorizacao", vazio)).toBe(
      "o contato não autoriza receber mensagens",
    );
    expect(textoDoMotivo("numero_removido", vazio)).toBe(
      "o número foi removido da clínica",
    );
  });
});

describe("linhas do item", () => {
  const params = {
    ctx: contexto(),
    agora: AGORA,
    fuso: FORTALEZA,
    contato: "Maria Clara",
  };

  it("uma linha por estado", () => {
    const naFila = agendada({
      situacao: "enviando",
      enviarEm: "2026-10-06T14:00:00.000Z", // hoje 11:00
    });
    expect(linhaDoEstadoDoItem(agendada(), "agendada", params)).toBeNull();
    expect(linhaDoEstadoDoItem(naFila, "na_fila", params)).toBe(
      "Marcada para hoje às 11:00. Pode levar alguns minutos.",
    );
    // Marcada 11:00: o prazo cru seria 23:00, mas das 21:00 em diante a
    // atrasada nao sai e o 08:00 passa do prazo (F4).
    expect(linhaDoEstadoDoItem(naFila, "esperando_numero", params)).toBe(
      "Marcada para hoje às 11:00. Se o número Recepção não reconectar até hoje às 21:00, a mensagem não sai.",
    );
    expect(linhaDoEstadoDoItem(naFila, "silencio_noturno", params)).toBe(
      "Atrasou e vai sair às 08:00, para não chegar de madrugada.",
    );
    expect(
      linhaDoEstadoDoItem(
        agendada({
          situacao: "enviada",
          enviadaEm: "2026-10-06T12:02:00.000Z",
        }),
        "enviada",
        params,
      ),
    ).toBe("Enviada hoje às 09:02");
    expect(
      linhaDoEstadoDoItem(
        agendada({
          situacao: "enviada",
          enviadaEm: "2026-10-04T12:02:00.000Z",
        }),
        "enviada",
        params,
      ),
    ).toBe("Enviada em 04/10 às 09:02");
    expect(
      linhaDoEstadoDoItem(
        agendada({ situacao: "nao_enviada", motivo: "numero_desconectado" }),
        "nao_enviada",
        params,
      ),
    ).toBe(
      "Não enviada: o número Recepção ficou desconectado por mais de 12 horas.",
    );
    expect(
      linhaDoEstadoDoItem(
        agendada({ situacao: "nao_confirmada", motivo: "envio_incerto" }),
        "nao_confirmada",
        params,
      ),
    ).toBe(
      "A mensagem pode ter chegado ao paciente. Confira a conversa antes de mandar de novo.",
    );
  });

  it("o prazo do número desconectado é o efetivo: 21:00 para a das 16:00, amanhã para a das 20:30 (F4)", () => {
    const tarde = agendada({
      situacao: "enviando",
      enviarEm: "2026-10-06T19:00:00.000Z", // hoje 16:00
    });
    expect(
      linhaDoEstadoDoItem(tarde, "esperando_numero", {
        ...params,
        agora: Date.parse("2026-10-06T19:30:00.000Z"),
      }),
    ).toBe(
      "Marcada para hoje às 16:00. Se o número Recepção não reconectar até hoje às 21:00, a mensagem não sai.",
    );
    const noite = agendada({
      situacao: "enviando",
      enviarEm: "2026-10-06T23:30:00.000Z", // hoje 20:30
    });
    expect(
      linhaDoEstadoDoItem(noite, "esperando_numero", {
        ...params,
        agora: Date.parse("2026-10-06T23:50:00.000Z"),
      }),
    ).toBe(
      "Marcada para hoje às 20:30. Se o número Recepção não reconectar até amanhã às 08:30, a mensagem não sai.",
    );
  });

  it("não enviada por madrugada tem o texto próprio (F4)", () => {
    expect(
      linhaDoEstadoDoItem(
        agendada({ situacao: "nao_enviada", motivo: "madrugada" }),
        "nao_enviada",
        params,
      ),
    ).toBe("Não enviada: o envio atrasou e cairia de madrugada.");
  });

  it("A3: a atividade é do assinante ativo, senão da equipe", () => {
    const membros = { nomes: NOMES, membrosComEscrita: [ANA, BRUNO] };
    expect(
      linhaDaAtividade(agendada(), "nao_enviada", {
        ...membros,
        viewerId: BRUNO,
      }),
    ).toBe("Uma atividade foi criada para Ana Souza conferir.");
    expect(
      linhaDaAtividade(agendada(), "nao_enviada", {
        ...membros,
        viewerId: ANA,
      }),
    ).toBe("Uma atividade foi criada para você conferir.");
    expect(
      linhaDaAtividade(agendada({ editadaPor: BRUNO }), "nao_enviada", {
        ...membros,
        viewerId: ANA,
      }),
    ).toBe("Uma atividade foi criada para Bruno Lima conferir.");
    expect(
      linhaDaAtividade(agendada({ criadaPor: CARLA }), "nao_enviada", {
        ...membros,
        viewerId: ANA,
      }),
    ).toBe("Uma atividade foi criada para a equipe conferir.");
    expect(
      linhaDaAtividade(agendada(), "nao_confirmada", {
        ...membros,
        viewerId: ANA,
      }),
    ).toBeNull();
  });
});

describe("assinatura, bolha e diálogos (A1)", () => {
  it("Agendada por, com você e editada por", () => {
    expect(assinaturaDoItem(agendada(), NOMES, BRUNO)).toBe(
      "Agendada por Ana Souza",
    );
    expect(assinaturaDoItem(agendada(), NOMES, ANA)).toBe("Agendada por você");
    expect(assinaturaDoItem(agendada({ editadaPor: ANA }), NOMES, BRUNO)).toBe(
      "Agendada por Ana Souza",
    );
    expect(
      assinaturaDoItem(agendada({ editadaPor: BRUNO }), NOMES, CARLA),
    ).toBe("Agendada por Ana Souza, editada por Bruno Lima");
    expect(
      assinaturaDoItem(agendada({ editadaPor: BRUNO }), NOMES, BRUNO),
    ).toBe("Agendada por Ana Souza, editada por você");
  });

  it("assinante fora da equipe ganha (sem acesso); nome ausente vira Pessoa da equipe", () => {
    const membros = [BRUNO];
    expect(assinaturaDoItem(agendada(), NOMES, BRUNO, membros)).toBe(
      "Agendada por Ana Souza (sem acesso)",
    );
    // Quem criou saiu, mas quem assina e o Bruno
    expect(
      assinaturaDoItem(agendada({ editadaPor: BRUNO }), NOMES, CARLA, membros),
    ).toBe("Agendada por Ana Souza, editada por Bruno Lima");
    expect(assinaturaDoItem(agendada(), {}, BRUNO)).toBe(
      "Agendada por Pessoa da equipe",
    );
  });

  it("bolha: linha e leitor de tela", () => {
    expect(autoriaDaBolha({ criadaPor: ANA, editadaPor: null }, NOMES)).toEqual(
      {
        linha: "Ana Souza · Mensagem agendada",
        acessivel:
          "Mensagem agendada por Ana Souza, enviada sozinha na hora marcada.",
      },
    );
    expect(
      autoriaDaBolha({ criadaPor: ANA, editadaPor: BRUNO }, NOMES),
    ).toEqual({
      linha: "Bruno Lima · Mensagem agendada (criada por Ana Souza)",
      acessivel:
        "Mensagem agendada por Ana Souza, editada por Bruno Lima, enviada sozinha na hora marcada.",
    });
  });

  it("descrição da edição avisa quando passa a sair em seu nome", () => {
    expect(descricaoDaEdicao(agendada(), ANA)).toBe(
      "Mude o texto, a data ou a hora. A mensagem continua marcada.",
    );
    expect(descricaoDaEdicao(agendada(), BRUNO)).toBe(
      "Mude o texto, a data ou a hora. A mensagem continua marcada e passa a sair em seu nome.",
    );
    expect(descricaoDaEdicao(agendada({ editadaPor: BRUNO }), BRUNO)).toBe(
      "Mude o texto, a data ou a hora. A mensagem continua marcada.",
    );
  });

  it("descrição do agendamento, com o número quando a clínica tem mais de um", () => {
    expect(descricaoDoAgendamento(null)).toBe(
      "Sai sozinha na data e hora escolhidas, em seu nome, pelo WhatsApp da clínica.",
    );
    expect(descricaoDoAgendamento("Recepção")).toBe(
      "Sai sozinha na data e hora escolhidas, em seu nome, pelo número Recepção.",
    );
  });
});

describe("avisos do item e resumo da lista", () => {
  it("o paciente escreveu depois de agendada (ou da última edição)", () => {
    const ctx = contexto({
      ultimaEntradaPorNumero: { [NUMERO_1]: "2026-10-06T14:00:00.000Z" },
    });
    expect(
      avisosDoItem(agendada(), "agendada", {
        ctx,
        contato: "Maria Clara",
        agora: AGORA,
        fuso: FORTALEZA,
      }),
    ).toEqual([
      {
        chave: "escreveu_depois",
        texto:
          "Maria Clara escreveu depois que esta mensagem foi agendada. Confira se ela ainda faz sentido.",
      },
    ]);
    expect(
      avisosDoItem(agendada(), "na_fila", {
        ctx,
        contato: null,
        agora: AGORA,
        fuso: FORTALEZA,
      })[0]?.texto,
    ).toBe(
      "O contato escreveu depois que esta mensagem foi agendada. Confira se ela ainda faz sentido.",
    );
    // editada depois da entrada: o aviso some
    expect(
      avisosDoItem(
        agendada({ editadaPor: BRUNO, editadaEm: "2026-10-06T15:00:00.000Z" }),
        "agendada",
        { ctx, contato: "Maria Clara", agora: AGORA, fuso: FORTALEZA },
      ),
    ).toEqual([]);
    // entrada antes de criada, ou em outro numero: nada
    expect(
      avisosDoItem(
        agendada({ criadaEm: "2026-10-06T14:30:00.000Z" }),
        "agendada",
        {
          ctx,
          contato: "Maria Clara",
          agora: AGORA,
          fuso: FORTALEZA,
        },
      ),
    ).toEqual([]);
    expect(
      avisosDoItem(agendada({ whatsappAccountId: NUMERO_2 }), "agendada", {
        ctx,
        contato: "Maria Clara",
        agora: AGORA,
        fuso: FORTALEZA,
      }),
    ).toEqual([]);
    // depois de sair, nao avisa
    expect(
      avisosDoItem(agendada(), "nao_enviada", {
        ctx,
        contato: "Maria Clara",
        agora: AGORA,
        fuso: FORTALEZA,
      }),
    ).toEqual([]);
  });

  it("agendada com o número desconectado avisa até quando ele pode reconectar (F4)", () => {
    // Marcada amanha 09:00: o limite e amanha as 21:00.
    expect(
      avisosDoItem(agendada(), "agendada", {
        ctx: desconectado(),
        contato: "Maria Clara",
        agora: AGORA,
        fuso: FORTALEZA,
      }),
    ).toEqual([
      {
        chave: "numero_desconectado",
        texto:
          "O número Recepção está desconectado. Se não reconectar até amanhã às 21:00, a mensagem não sai.",
      },
    ]);
    // Marcada amanha 20:00: o limite e depois de amanha as 08:00.
    expect(
      avisosDoItem(
        agendada({ enviarEm: "2026-10-07T23:00:00.000Z" }),
        "agendada",
        {
          ctx: desconectado(),
          contato: "Maria Clara",
          agora: AGORA,
          fuso: FORTALEZA,
        },
      )[0]?.texto,
    ).toBe(
      "O número Recepção está desconectado. Se não reconectar até 08/10 às 08:00, a mensagem não sai.",
    );
  });

  it("resumo com a próxima que ainda vai sair", () => {
    expect(
      resumoDaLista(
        [
          { enviarEm: "2026-10-08T14:00:00.000Z", estado: "agendada" },
          { enviarEm: "2026-10-07T12:00:00.000Z", estado: "agendada" },
          { enviarEm: "2026-10-01T12:00:00.000Z", estado: "nao_enviada" },
        ],
        AGORA,
        FORTALEZA,
      ),
    ).toBe("3 mensagens agendadas. A próxima sai amanhã às 09:00.");
    expect(
      resumoDaLista(
        [
          { enviarEm: "2026-10-08T14:00:00.000Z", estado: "agendada" },
          { enviarEm: "2026-10-09T14:00:00.000Z", estado: "agendada" },
        ],
        AGORA,
        FORTALEZA,
      ),
    ).toBe("2 mensagens agendadas. A próxima sai em 08/10 às 11:00.");
    expect(
      resumoDaLista(
        [
          { enviarEm: "2026-10-01T12:00:00.000Z", estado: "nao_enviada" },
          { enviarEm: "2026-10-02T12:00:00.000Z", estado: "enviada" },
        ],
        AGORA,
        FORTALEZA,
      ),
    ).toBe("2 mensagens agendadas.");
  });
});

// ---------------------------------------------------------------------------

describe("nenhum travessão nos textos", () => {
  it("dicas, erros e todos os textos gerados", () => {
    const fixos = (mapa: Record<string, unknown>): string[] =>
      Object.values(mapa).filter((v): v is string => typeof v === "string");
    const textos: string[] = [
      ...fixos(DICAS_DA_AGENDADA),
      DICAS_DA_AGENDADA.enviarAgoraComColega("Carla Dias"),
      DICAS_DA_AGENDADA.enviarAgoraOutroNumero("Recepção"),
      DICAS_DA_AGENDADA.enviarAgoraOutroNumero(null),
      DICAS_DA_AGENDADA.enviarAgoraNumeroDesconectado("Recepção"),
      DICAS_DA_AGENDADA.enviarAgoraNumeroDesconectado(null),
      DICAS_DA_AGENDADA.agendarDeNovoNumeroRemovido("Recepção"),
      DICAS_DA_AGENDADA.agendarDeNovoNumeroRemovido(null),
      ...fixos(ERROS_DA_AGENDADA),
      ERROS_DA_AGENDADA.textoLongo(4097),
      ERROS_DA_AGENDADA.textoLongoParaEnviar(4097),
      ...avisosDoItem(agendada(), "agendada", {
        ctx: desconectado(),
        contato: "Maria",
        agora: AGORA,
        fuso: FORTALEZA,
      }).map((aviso) => aviso.texto),
      ERROS_DA_AGENDADA.depoisDoTeto("06/10/2027"),
      ...MOTIVOS_DA_AGENDADA.map((m) =>
        textoDoMotivo(m, { contato: "Maria", numero: "Recepção" }),
      ),
      textoDeQuandoSai("2027-01-06T12:00:00.000Z", AGORA, FORTALEZA),
      textoAcessivelDeQuando("2027-01-06T12:00:00.000Z", AGORA, FORTALEZA),
      textoDaPreviaDoAgendamento("2027-01-06T12:00:00.000Z", FORTALEZA),
      textoDoSucessoDoAgendamento("2027-01-06T12:00:00.000Z", FORTALEZA),
      descricaoDoAgendamento("Recepção"),
      descricaoDaEdicao(agendada(), BRUNO),
      assinaturaDoItem(agendada({ editadaPor: BRUNO }), NOMES, CARLA, [ANA]),
      ...Object.values(
        autoriaDaBolha({ criadaPor: ANA, editadaPor: BRUNO }, NOMES),
      ),
      ...atalhosDeData("2026-10-06").map((a) => a.rotulo),
      rotuloDoDispensar("nao_confirmada"),
    ];
    const estados: EstadoDoItemDaAgendada[] = [
      "agendada",
      "na_fila",
      "esperando_numero",
      "silencio_noturno",
      "enviada",
      "nao_enviada",
      "nao_confirmada",
    ];
    for (const estado of estados) {
      textos.push(
        linhaDoEstadoDoItem(agendada({ motivo: "atrasou" }), estado, {
          ctx: contexto(),
          agora: AGORA,
          fuso: FORTALEZA,
          contato: "Maria",
        }) ?? "",
      );
    }
    for (const texto of textos) {
      expect(texto).not.toMatch(/[—–]/);
    }
  });

  it("o arquivo do domínio não tem travessão", () => {
    const codigo = readFileSync(
      path.resolve(__dirname, "../../../lib/domain/mensagem-agendada.ts"),
      "utf8",
    );
    expect(codigo).not.toMatch(/[—–]/);
  });
});
