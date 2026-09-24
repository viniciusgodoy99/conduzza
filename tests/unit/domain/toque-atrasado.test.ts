import { describe, expect, it } from "vitest";

import type { JanelaDeEnvio } from "@/lib/domain/cadence";
import { renderizarModelo } from "@/lib/domain/modelo-mensagem";
import {
  CONFIRMACAO_24H,
  CONFIRMACAO_3H,
  CONFIRMACAO_72H,
} from "@/lib/domain/textos-padrao";
import {
  corrigirDiaRelativo,
  decidirToqueDeConfirmacao,
  diaDoPasso,
  existePassoPosteriorATempo,
  mudouDeDia,
} from "@/lib/domain/toque-atrasado";
import { proximaAbertura } from "@/lib/domain/cadence";

const FORTALEZA = "America/Fortaleza"; // UTC-3 fixo

// O cenario do achado: segunda a sabado, 08:00 as 18:00.
const SEG_A_SAB: JanelaDeEnvio = {
  inicio: "08:00",
  fim: "18:00",
  diasDaSemana: [1, 2, 3, 4, 5, 6],
};

const PASSOS_PADRAO = [
  { offsetMinutes: -4320 },
  { offsetMinutes: -1440 },
  { offsetMinutes: -180 },
];

const MINUTO = 60_000;

function vencimento(startsAt: Date, offsetMinutes: number): Date {
  return new Date(startsAt.getTime() + offsetMinutes * MINUTO);
}

describe("toque de confirmacao atrasado (janela seg a sab, 08 as 18)", () => {
  // Segunda, 21/09/2026, 09:00 em Fortaleza.
  const consultaSegunda = new Date("2026-09-21T12:00:00.000Z");

  it("o toque de 24h vence no domingo e so abriria segunda 08:00: e pulado, o de 3h cobre", () => {
    const venceEm = vencimento(consultaSegunda, -1440); // domingo 09:00
    const abertura = proximaAbertura(SEG_A_SAB, venceEm, FORTALEZA);
    expect(abertura?.toISOString()).toBe("2026-09-21T11:00:00.000Z"); // seg 08:00
    expect(
      mudouDeDia({ agora: abertura!, scheduledFor: venceEm, timezone: FORTALEZA }),
    ).toBe(true);

    const decisao = decidirToqueDeConfirmacao({
      agora: abertura!,
      scheduledFor: venceEm,
      startsAt: consultaSegunda,
      offsetDoToque: -1440,
      modelo: CONFIRMACAO_24H,
      passos: PASSOS_PADRAO,
      janela: SEG_A_SAB,
      timezone: FORTALEZA,
      manual: false,
    });
    expect(decisao).toEqual({ acao: "pular" });
  });

  it("o de 3h, empurrado das 06:00 para as 08:00 do MESMO dia, sai com o texto dele", () => {
    const venceEm = vencimento(consultaSegunda, -180); // seg 06:00
    const abertura = proximaAbertura(SEG_A_SAB, venceEm, FORTALEZA)!;
    const decisao = decidirToqueDeConfirmacao({
      agora: abertura,
      scheduledFor: venceEm,
      startsAt: consultaSegunda,
      offsetDoToque: -180,
      modelo: CONFIRMACAO_3H,
      passos: PASSOS_PADRAO,
      janela: SEG_A_SAB,
      timezone: FORTALEZA,
      manual: false,
    });
    expect(decisao).toEqual({ acao: "enviar", modelo: CONFIRMACAO_3H });
  });

  it("sem passo seguinte, o toque atrasado SAI, mas nunca com 'Amanhã' falso", () => {
    const venceEm = vencimento(consultaSegunda, -1440);
    const abertura = proximaAbertura(SEG_A_SAB, venceEm, FORTALEZA)!;
    const decisao = decidirToqueDeConfirmacao({
      agora: abertura,
      scheduledFor: venceEm,
      startsAt: consultaSegunda,
      offsetDoToque: -1440,
      modelo: CONFIRMACAO_24H,
      passos: [{ offsetMinutes: -4320 }, { offsetMinutes: -1440 }],
      janela: SEG_A_SAB,
      timezone: FORTALEZA,
      manual: false,
    });
    expect(decisao.acao).toBe("enviar");
    const modelo = decisao.acao === "enviar" ? decisao.modelo! : "";
    const texto = renderizarModelo(modelo, {
      nome: "Maria",
      data: "21/09/2026",
      hora: "09:00",
      procedimento: "Consulta",
      profissional: "Dra. Ana",
    });
    expect(texto).not.toMatch(/amanh/i);
    expect(texto.startsWith("Oi, Maria! Hoje, 21/09/2026 às 09:00")).toBe(true);
  });

  it("consulta depois do fim da janela: o 24h de segunda 18:30 cai terca 08:00 e o de 3h cobre", () => {
    // Terca, 22/09/2026, 18:30 em Fortaleza.
    const consultaTerca = new Date("2026-09-22T21:30:00.000Z");
    const venceEm = vencimento(consultaTerca, -1440); // seg 18:30
    const abertura = proximaAbertura(SEG_A_SAB, venceEm, FORTALEZA)!;
    expect(abertura.toISOString()).toBe("2026-09-22T11:00:00.000Z");
    expect(
      decidirToqueDeConfirmacao({
        agora: abertura,
        scheduledFor: venceEm,
        startsAt: consultaTerca,
        offsetDoToque: -1440,
        modelo: CONFIRMACAO_24H,
        passos: PASSOS_PADRAO,
        janela: SEG_A_SAB,
        timezone: FORTALEZA,
        manual: false,
      }),
    ).toEqual({ acao: "pular" });
  });

  it("atraso dentro do MESMO dia nao muda nada: 'Amanhã' continua verdade", () => {
    // Terca 07:30: o 24h vence segunda 07:30 e sai segunda 08:00.
    const consulta = new Date("2026-09-22T10:30:00.000Z");
    const venceEm = vencimento(consulta, -1440);
    const abertura = proximaAbertura(SEG_A_SAB, venceEm, FORTALEZA)!;
    expect(
      decidirToqueDeConfirmacao({
        agora: abertura,
        scheduledFor: venceEm,
        startsAt: consulta,
        offsetDoToque: -1440,
        modelo: CONFIRMACAO_24H,
        passos: PASSOS_PADRAO,
        janela: SEG_A_SAB,
        timezone: FORTALEZA,
        manual: false,
      }),
    ).toEqual({ acao: "enviar", modelo: CONFIRMACAO_24H });
  });

  it("o de 72h empurrado para outro dia tambem cede ao de 24h que sai antes da consulta", () => {
    // Terca 22/09 09:00; o de 72h vence sabado 19/09 09:00 (dentro) e o
    // canal fica fora do ar ate segunda 08:00.
    const consulta = new Date("2026-09-22T12:00:00.000Z");
    const venceEm = vencimento(consulta, -4320);
    const agora = new Date("2026-09-21T11:00:00.000Z");
    expect(
      decidirToqueDeConfirmacao({
        agora,
        scheduledFor: venceEm,
        startsAt: consulta,
        offsetDoToque: -4320,
        modelo: CONFIRMACAO_72H,
        passos: PASSOS_PADRAO,
        janela: SEG_A_SAB,
        timezone: FORTALEZA,
        manual: false,
      }),
    ).toEqual({ acao: "pular" });
  });

  it("toque manual nunca e pulado, mas o dia relativo e corrigido se atravessou a meia-noite", () => {
    const consulta = new Date("2026-09-22T12:00:00.000Z"); // terca 09:00
    const pedidoEm = new Date("2026-09-22T02:50:00.000Z"); // seg 23:50
    const saiuEm = new Date("2026-09-22T03:10:00.000Z"); // terca 00:10
    const decisao = decidirToqueDeConfirmacao({
      agora: saiuEm,
      scheduledFor: pedidoEm,
      startsAt: consulta,
      offsetDoToque: -1440,
      modelo: CONFIRMACAO_24H,
      passos: [],
      janela: SEG_A_SAB,
      timezone: FORTALEZA,
      manual: true,
    });
    expect(decisao.acao).toBe("enviar");
    expect(decisao.acao === "enviar" ? decisao.modelo : "").toContain(
      "Hoje, {{data}}",
    );
  });
});

describe("existePassoPosteriorATempo", () => {
  it("passo seguinte cuja janela so abre depois da consulta nao conta", () => {
    // Segunda 07:00: o de 3h vence 04:00 e so abriria 08:00, depois da consulta.
    const consulta = new Date("2026-09-21T10:00:00.000Z");
    expect(
      existePassoPosteriorATempo({
        passos: PASSOS_PADRAO,
        offsetDoToque: -1440,
        startsAt: consulta,
        agora: new Date("2026-09-20T11:00:00.000Z"),
        janela: SEG_A_SAB,
        timezone: FORTALEZA,
      }),
    ).toBe(false);
  });

  it("so conta passo MAIS PERTO da consulta, nunca o anterior", () => {
    const consulta = new Date("2026-09-21T12:00:00.000Z");
    expect(
      existePassoPosteriorATempo({
        passos: [{ offsetMinutes: -4320 }, { offsetMinutes: -1440 }],
        offsetDoToque: -1440,
        startsAt: consulta,
        agora: new Date("2026-09-21T11:00:00.000Z"),
        janela: SEG_A_SAB,
        timezone: FORTALEZA,
      }),
    ).toBe(false);
  });
});

describe("corrigirDiaRelativo", () => {
  it("troca 'Amanhã' por 'Hoje' mantendo a caixa", () => {
    expect(
      corrigirDiaRelativo("Oi! Amanhã você vem. Até amanhã.", {
        diaDoPasso: 1,
        diasAteAConsulta: 0,
      }),
    ).toBe("Oi! Hoje você vem. Até hoje.");
  });

  it("aceita 'amanha' sem acento e nao mexe em palavra que so contem o trecho", () => {
    expect(
      corrigirDiaRelativo("Te vejo amanha. Amanhecer.", {
        diaDoPasso: 1,
        diasAteAConsulta: 0,
      }),
    ).toBe("Te vejo hoje. Amanhecer.");
  });

  it("'depois de amanhã' vira 'amanhã' no passo de dois dias", () => {
    expect(
      corrigirDiaRelativo("Depois de amanhã é sua consulta.", {
        diaDoPasso: 2,
        diasAteAConsulta: 1,
      }),
    ).toBe("Amanhã é sua consulta.");
  });

  it("no passo de um dia, 'depois de amanhã' fica intacto", () => {
    expect(
      corrigirDiaRelativo("Amanhã ou depois de amanhã.", {
        diaDoPasso: 1,
        diasAteAConsulta: 0,
      }),
    ).toBe("Hoje ou depois de amanhã.");
  });

  it("texto com data por extenso nao muda", () => {
    expect(
      corrigirDiaRelativo(CONFIRMACAO_72H, { diaDoPasso: 3, diasAteAConsulta: 2 }),
    ).toBe(CONFIRMACAO_72H);
  });

  it("o dia de cada passo padrao", () => {
    expect(diaDoPasso(-4320)).toBe(3);
    expect(diaDoPasso(-1440)).toBe(1);
    expect(diaDoPasso(-180)).toBe(0);
  });
});
