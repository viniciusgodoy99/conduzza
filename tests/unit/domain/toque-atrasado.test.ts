import { describe, expect, it } from "vitest";

import type { JanelaDeEnvio } from "@/lib/domain/cadence";
import { diaCivil } from "@/lib/domain/horarios";
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
  existePassoPosteriorNoMesmoDia,
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

  it("o de 72h empurrado para outro dia cede ao de 24h que sai no MESMO dia, antes da consulta", () => {
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

describe("existePassoPosteriorNoMesmoDia", () => {
  it("passo seguinte cuja janela so abre depois da consulta nao conta", () => {
    // Segunda 07:00: o de 3h vence 04:00 e so abriria 08:00, depois da consulta.
    const consulta = new Date("2026-09-21T10:00:00.000Z");
    expect(
      existePassoPosteriorNoMesmoDia({
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
      existePassoPosteriorNoMesmoDia({
        passos: [{ offsetMinutes: -4320 }, { offsetMinutes: -1440 }],
        offsetDoToque: -1440,
        startsAt: consulta,
        agora: new Date("2026-09-21T11:00:00.000Z"),
        janela: SEG_A_SAB,
        timezone: FORTALEZA,
      }),
    ).toBe(false);
  });

  it("passo seguinte que sai antes da consulta, mas num DIA DEPOIS, nao cobre", () => {
    // Consulta terca 18:30. O de 72h sairia segunda 08:00; o de 3h so sai
    // terca 15:30. Sem o de 72h, segunda fica sem aviso nenhum.
    const consulta = new Date("2026-09-22T21:30:00.000Z");
    expect(
      existePassoPosteriorNoMesmoDia({
        passos: [{ offsetMinutes: -4320 }, { offsetMinutes: -180 }],
        offsetDoToque: -4320,
        startsAt: consulta,
        agora: new Date("2026-09-21T11:00:00.000Z"),
        janela: SEG_A_SAB,
        timezone: FORTALEZA,
      }),
    ).toBe(false);
  });

  it("passo seguinte empurrado para a mesma abertura cobre", () => {
    // Consulta segunda 09:00: o de 3h vence 06:00 e sai 08:00, o mesmo dia
    // em que o de 24h atrasado sairia.
    const consulta = new Date("2026-09-21T12:00:00.000Z");
    expect(
      existePassoPosteriorNoMesmoDia({
        passos: PASSOS_PADRAO,
        offsetDoToque: -1440,
        startsAt: consulta,
        agora: new Date("2026-09-21T11:00:00.000Z"),
        janela: SEG_A_SAB,
        timezone: FORTALEZA,
      }),
    ).toBe(true);
  });
});

// A regua inteira, como o executor (lib/jobs/regua.ts) a roda: cada toque
// vence em starts_at + offset, sai na proxima abertura da janela (ou quando o
// WhatsApp volta), e a decisao roda com o relogio daquele instante. Abertura
// na hora da consulta ou depois e 'fora_janela' (regua.ts pula antes de
// decidir). Achado R[0] da revisao da leva 1: o toque atrasado de 72h nao
// pode ceder a passos que tambem cedem, nem a um passo de outro dia.
const TEXTO_DO_PASSO = new Map<number, string>([
  [-4320, CONFIRMACAO_72H],
  [-1440, CONFIRMACAO_24H],
  [-180, CONFIRMACAO_3H],
]);

type Desfecho =
  | { offset: number; acao: "enviar"; saida: string; modelo: string | null }
  | { offset: number; acao: "pular" | "fora_janela" };

function simularRegua(entrada: {
  startsAt: Date;
  janela: JanelaDeEnvio;
  passos: readonly { offsetMinutes: number }[];
  canalVoltaEm?: Date;
}): Desfecho[] {
  return entrada.passos.map(({ offsetMinutes }): Desfecho => {
    const venceEm = vencimento(entrada.startsAt, offsetMinutes);
    const pronto =
      entrada.canalVoltaEm &&
      entrada.canalVoltaEm.getTime() > venceEm.getTime()
        ? entrada.canalVoltaEm
        : venceEm;
    const agora = proximaAbertura(entrada.janela, pronto, FORTALEZA);
    if (!agora || agora.getTime() >= entrada.startsAt.getTime()) {
      return { offset: offsetMinutes, acao: "fora_janela" };
    }
    const decisao = decidirToqueDeConfirmacao({
      agora,
      scheduledFor: venceEm,
      startsAt: entrada.startsAt,
      offsetDoToque: offsetMinutes,
      modelo: TEXTO_DO_PASSO.get(offsetMinutes) ?? null,
      passos: entrada.passos,
      janela: entrada.janela,
      timezone: FORTALEZA,
      manual: false,
    });
    return decisao.acao === "enviar"
      ? {
          offset: offsetMinutes,
          acao: "enviar",
          saida: agora.toISOString(),
          modelo: decisao.modelo,
        }
      : { offset: offsetMinutes, acao: "pular" };
  });
}

function textoDe(desfecho: Desfecho | undefined, data: string, hora: string) {
  if (!desfecho || desfecho.acao !== "enviar" || !desfecho.modelo) {
    return "";
  }
  return renderizarModelo(desfecho.modelo, {
    nome: "Maria",
    clinica: "Clínica Sol",
    data,
    hora,
    procedimento: "Consulta",
    profissional: "Dra. Ana",
    preparo: null,
  });
}

describe("a regua 72h, 24h e 3h inteira com toque atrasado", () => {
  it("consulta terca 18:30, depois do fim da janela (seg a sab, 08 as 18): o de 72h SAI segunda, o de 24h cede ao de 3h", () => {
    const consulta = new Date("2026-09-22T21:30:00.000Z");
    const desfechos = simularRegua({
      startsAt: consulta,
      janela: SEG_A_SAB,
      passos: PASSOS_PADRAO,
    });
    expect(desfechos).toEqual([
      {
        offset: -4320,
        acao: "enviar",
        saida: "2026-09-21T11:00:00.000Z", // seg 08:00 (venceu sab 18:30)
        modelo: CONFIRMACAO_72H,
      },
      { offset: -1440, acao: "pular" }, // cairia terca 08:00
      {
        offset: -180,
        acao: "enviar",
        saida: "2026-09-22T18:30:00.000Z", // terca 15:30
        modelo: CONFIRMACAO_3H,
      },
    ]);
    // O texto de 72h traz a data por extenso: continua certo na segunda.
    expect(textoDe(desfechos[0], "22/09/2026", "18:30")).toContain(
      "está marcada para 22/09/2026 às 18:30",
    );
  });

  it("consulta segunda 18:30: o de 72h cai no sabado (nenhum outro sai no sabado) e sai; o de 24h cede ao de 3h de segunda", () => {
    const consulta = new Date("2026-09-21T21:30:00.000Z");
    expect(
      simularRegua({ startsAt: consulta, janela: SEG_A_SAB, passos: PASSOS_PADRAO }),
    ).toEqual([
      {
        offset: -4320,
        acao: "enviar",
        saida: "2026-09-19T11:00:00.000Z", // sab 08:00 (venceu sex 18:30)
        modelo: CONFIRMACAO_72H,
      },
      { offset: -1440, acao: "pular" }, // cairia seg 08:00
      {
        offset: -180,
        acao: "enviar",
        saida: "2026-09-21T18:30:00.000Z", // seg 15:30
        modelo: CONFIRMACAO_3H,
      },
    ]);
  });

  it("consulta segunda cedo (09:00): o de 72h sai na sexta no horario, o de 24h cede ao de 3h das 08:00", () => {
    const consulta = new Date("2026-09-21T12:00:00.000Z");
    expect(
      simularRegua({ startsAt: consulta, janela: SEG_A_SAB, passos: PASSOS_PADRAO }),
    ).toEqual([
      {
        offset: -4320,
        acao: "enviar",
        saida: "2026-09-18T12:00:00.000Z", // sex 09:00
        modelo: CONFIRMACAO_72H,
      },
      { offset: -1440, acao: "pular" },
      {
        offset: -180,
        acao: "enviar",
        saida: "2026-09-21T11:00:00.000Z", // seg 08:00 (venceu 06:00)
        modelo: CONFIRMACAO_3H,
      },
    ]);
  });

  it("consulta segunda antes de a janela abrir (07:00): 24h e 3h ficam fora, o de 72h nao e pulado por eles", () => {
    const consulta = new Date("2026-09-21T10:00:00.000Z");
    expect(
      simularRegua({ startsAt: consulta, janela: SEG_A_SAB, passos: PASSOS_PADRAO }),
    ).toEqual([
      {
        offset: -4320,
        acao: "enviar",
        saida: "2026-09-18T11:00:00.000Z", // sex 08:00 (venceu 07:00)
        modelo: CONFIRMACAO_72H,
      },
      { offset: -1440, acao: "fora_janela" },
      { offset: -180, acao: "fora_janela" },
    ]);
  });

  it("janela de todos os dias, 08:00 as 20:30, consulta quarta 21:00: o paciente recebe o de 72h e o de 3h, nao so o de 3h", () => {
    const TODO_DIA: JanelaDeEnvio = {
      inicio: "08:00",
      fim: "20:30",
      diasDaSemana: [0, 1, 2, 3, 4, 5, 6],
    };
    const consulta = new Date("2026-09-24T00:00:00.000Z"); // qua 23/09 21:00
    expect(
      simularRegua({ startsAt: consulta, janela: TODO_DIA, passos: PASSOS_PADRAO }),
    ).toEqual([
      {
        offset: -4320,
        acao: "enviar",
        saida: "2026-09-21T11:00:00.000Z", // seg 08:00 (venceu dom 21:00)
        modelo: CONFIRMACAO_72H,
      },
      { offset: -1440, acao: "pular" }, // cairia qua 08:00
      {
        offset: -180,
        acao: "enviar",
        saida: "2026-09-23T21:00:00.000Z", // qua 18:00
        modelo: CONFIRMACAO_3H,
      },
    ]);
  });

  it("WhatsApp fora do ar ate segunda 08:00, consulta segunda 09:00: os tres caem na mesma abertura e so o de 3h sai", () => {
    const consulta = new Date("2026-09-21T12:00:00.000Z");
    expect(
      simularRegua({
        startsAt: consulta,
        janela: SEG_A_SAB,
        passos: PASSOS_PADRAO,
        canalVoltaEm: new Date("2026-09-21T11:00:00.000Z"),
      }),
    ).toEqual([
      { offset: -4320, acao: "pular" },
      { offset: -1440, acao: "pular" },
      {
        offset: -180,
        acao: "enviar",
        saida: "2026-09-21T11:00:00.000Z",
        modelo: CONFIRMACAO_3H,
      },
    ]);
  });

  it("cascata sem o de 3h: o de 72h cede ao de 24h do mesmo dia, e o de 24h sai com 'Hoje' em vez de ser pulado tambem", () => {
    const consulta = new Date("2026-09-21T12:00:00.000Z"); // seg 09:00
    const desfechos = simularRegua({
      startsAt: consulta,
      janela: SEG_A_SAB,
      passos: [{ offsetMinutes: -4320 }, { offsetMinutes: -1440 }],
      canalVoltaEm: new Date("2026-09-21T11:00:00.000Z"),
    });
    expect(desfechos.map((d) => d.acao)).toEqual(["pular", "enviar"]);
    const texto = textoDe(desfechos[1], "21/09/2026", "09:00");
    expect(texto).not.toMatch(/amanh/i);
    expect(texto.startsWith("Oi, Maria! Hoje, 21/09/2026 às 09:00")).toBe(true);
  });

  it("varredura: toda consulta com passo a tempo recebe toque, um por dia, e cada dia com passo a tempo tem aviso", () => {
    // Toda hora cheia de domingo 20/09 a domingo 27/09, janela seg a sab 08
    // as 18. Tres garantias da regra: (1) se algum passo abre antes da
    // consulta, pelo menos um sai; (2) nunca saem dois toques no mesmo dia
    // civil; (3) todo dia civil em que algum passo sairia a tempo recebe um
    // toque (um toque so cede a outro do mesmo dia).
    for (let dia = 20; dia <= 27; dia++) {
      for (let hora = 0; hora < 24; hora++) {
        const consulta = new Date(Date.UTC(2026, 8, dia, hora + 3));
        const desfechos = simularRegua({
          startsAt: consulta,
          janela: SEG_A_SAB,
          passos: PASSOS_PADRAO,
        });
        const diasComToque = desfechos.flatMap((d) =>
          d.acao === "enviar" ? [diaCivil(FORTALEZA, new Date(d.saida))] : [],
        );
        const diasATempo = new Set(
          PASSOS_PADRAO.flatMap(({ offsetMinutes }) => {
            const abertura = proximaAbertura(
              SEG_A_SAB,
              vencimento(consulta, offsetMinutes),
              FORTALEZA,
            );
            return abertura && abertura.getTime() < consulta.getTime()
              ? [diaCivil(FORTALEZA, abertura)]
              : [];
          }),
        );
        expect(diasComToque.length > 0).toBe(diasATempo.size > 0);
        expect(new Set(diasComToque).size).toBe(diasComToque.length);
        expect(new Set(diasComToque)).toEqual(diasATempo);
      }
    }
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
