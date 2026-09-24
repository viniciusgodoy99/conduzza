import { describe, expect, it } from "vitest";

import {
  ehRespostaDoMenuDeConfirmacao,
  interpretarResposta,
  qualPerguntaFoiRespondida,
  type ConsultaDoToque,
  type FatosDaResposta,
  type ToqueEnviado,
} from "@/lib/domain/resposta-paciente";
import { renderizarModelo } from "@/lib/domain/modelo-mensagem";
import {
  MENU_CONFIRMACAO,
  RESPOSTA_CANCELADA,
  RESPOSTA_CONFIRMADA,
  RESPOSTA_REMARCAR,
} from "@/lib/domain/textos-padrao";

// A decisao PURA de a que pergunta o paciente respondeu (revisao de
// liberacao de 24/09, achados 55, 60 e 61). Cada cenario aqui e um caso em
// que o interceptador antigo confirmava ou cancelava a consulta errada, ou
// mandava "esse horario nao esta mais disponivel" para quem confirmou.

const AGORA = new Date("2026-09-24T12:00:00Z").getTime();
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

function iso(deslocamentoMs: number): string {
  return new Date(AGORA + deslocamentoMs).toISOString();
}

function consulta(
  id: string,
  opcoes: Partial<ConsultaDoToque> = {},
): ConsultaDoToque {
  return {
    id,
    status: "aguardando_confirmacao",
    startsAt: iso(2 * DIA),
    remarcacaoPedidaEm: null,
    ...opcoes,
  };
}

function toque(
  runId: string,
  sentAtMs: number,
  alvo: ConsultaDoToque | null,
  kind: string | null = "confirmacao",
): ToqueEnviado {
  return { runId, kind, sentAt: iso(sentAtMs), consulta: alvo };
}

function fatos(parcial: Partial<FatosDaResposta> = {}): FatosDaResposta {
  return {
    agora: AGORA,
    conversaEmAtendimento: false,
    citacao: { tipo: "nenhuma" },
    toques: [],
    oferta: null,
    ultimaMensagemHumanaEm: null,
    ...parcial,
  };
}

describe("o eco ao paciente diz QUAL consulta", () => {
  it.each([
    ["confirmar", RESPOSTA_CONFIRMADA],
    ["cancelar", RESPOSTA_CANCELADA],
    ["remarcar", RESPOSTA_REMARCAR],
  ])("%s leva data e hora", (_, modelo) => {
    const texto = renderizarModelo(modelo, { data: "24/09", hora: "09:00" });
    expect(texto).toContain("24/09 às 09:00");
    expect(texto).not.toMatch(/\{\{|\}\}/);
    expect(texto).not.toMatch(/[–—]/);
  });
});

describe("o vocabulario do menu do toque", () => {
  it("reconhece os ids e rotulos dos botoes e os numeros da lista", () => {
    for (const opcao of MENU_CONFIRMACAO) {
      expect(ehRespostaDoMenuDeConfirmacao(opcao.id)).toBe(true);
      expect(ehRespostaDoMenuDeConfirmacao(opcao.text)).toBe(true);
    }
    for (const numero of ["1", "2", "3"]) {
      expect(ehRespostaDoMenuDeConfirmacao(numero)).toBe(true);
    }
  });

  it("nao engole o vocabulario da oferta", () => {
    for (const texto of ["SIM", "sim", "quero", "NÃO QUERO", "ok", null]) {
      expect(ehRespostaDoMenuDeConfirmacao(texto)).toBe(false);
    }
  });
});

describe("a que pergunta o paciente respondeu", () => {
  const a = consulta("consulta-a");

  it("toque unico, ninguem da clinica falou depois: vale o toque", () => {
    const decisao = qualPerguntaFoiRespondida(
      fatos({ toques: [toque("run-a", -2 * HORA, a)] }),
      "confirmar",
      "aceitar",
    );
    expect(decisao).toEqual({
      alvo: "toque",
      appointmentId: "consulta-a",
      startsAt: a.startsAt,
      intencao: "confirmar",
    });
  });

  // Achado 55: a recepcionista oferece "1) terca 2) quarta 3) quinta" e o
  // paciente responde "3". Antes, "3" cancelava a consulta original.
  it("a recepcao escreveu depois do toque: '3' e resposta a ela", () => {
    const decisao = qualPerguntaFoiRespondida(
      fatos({
        toques: [toque("run-a", -2 * HORA, a)],
        ultimaMensagemHumanaEm: iso(-30 * MINUTO),
      }),
      interpretarResposta("3"),
      "recusar",
    );
    expect(decisao).toEqual({ alvo: "nenhum", motivo: "clinica_falou_depois" });
  });

  it("mesmo citando o toque, mensagem da recepcao depois dele cala", () => {
    const decisao = qualPerguntaFoiRespondida(
      fatos({
        citacao: { tipo: "toque", toque: toque("run-a", -2 * HORA, a) },
        ultimaMensagemHumanaEm: iso(-30 * MINUTO),
      }),
      "cancelar",
      "recusar",
    );
    expect(decisao).toEqual({ alvo: "nenhum", motivo: "clinica_falou_depois" });
  });

  it("conversa assumida por alguem da clinica: ninguem interpreta", () => {
    const decisao = qualPerguntaFoiRespondida(
      fatos({
        conversaEmAtendimento: true,
        toques: [toque("run-a", -2 * HORA, a)],
      }),
      "confirmar",
      "aceitar",
    );
    expect(decisao).toEqual({
      alvo: "nenhum",
      motivo: "conversa_em_atendimento",
    });
  });

  // Achado 56: depois de "Remarcar" o paciente recebe "nossa recepcao vai
  // falar com voce" e responde "ok". Esse ok nao confirma o horario antigo.
  it("com remarcacao pedida, 'ok' nao confirma a consulta", () => {
    const pedida = consulta("consulta-a", { remarcacaoPedidaEm: iso(-HORA) });
    const decisao = qualPerguntaFoiRespondida(
      fatos({ toques: [toque("run-a", -2 * HORA, pedida)] }),
      interpretarResposta("ok"),
      "aceitar",
    );
    expect(decisao).toEqual({ alvo: "nenhum", motivo: "remarcacao_pedida" });
  });

  // Achado 61: consulta as 9h e exame as 10h, dois toques.
  describe("duas consultas com toque recente", () => {
    const nove = consulta("consulta-9h", { startsAt: iso(DIA - 3 * HORA) });
    const dez = consulta("consulta-10h", { startsAt: iso(DIA - 2 * HORA) });
    const toqueNove = toque("run-9h", -3 * HORA, nove);
    const toqueDez = toque("run-10h", -2 * HORA, dez);
    const base = fatos({ toques: [toqueDez, toqueNove] });

    it("sem citacao, nao escolhe: fica com a recepcao", () => {
      expect(
        qualPerguntaFoiRespondida(base, "cancelar", "recusar"),
      ).toEqual({ alvo: "nenhum", motivo: "mais_de_uma_consulta" });
      expect(
        qualPerguntaFoiRespondida(base, "confirmar", "aceitar"),
      ).toEqual({ alvo: "nenhum", motivo: "mais_de_uma_consulta" });
    });

    it("com citacao, vale a consulta do toque citado (nao o mais recente)", () => {
      const decisao = qualPerguntaFoiRespondida(
        { ...base, citacao: { tipo: "toque", toque: toqueNove } },
        "cancelar",
        "recusar",
      );
      expect(decisao).toEqual({
        alvo: "toque",
        appointmentId: "consulta-9h",
        startsAt: nove.startsAt,
        intencao: "cancelar",
      });
    });

    it("a outra ja confirmada nao torna 'Confirmar' ambiguo", () => {
      const noveConfirmada = { ...nove, status: "confirmado_paciente" };
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          toques: [toqueDez, toque("run-9h", -3 * HORA, noveConfirmada)],
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toMatchObject({
        alvo: "toque",
        appointmentId: "consulta-10h",
      });
    });

    it("mas 'Cancelar' continua ambiguo com a outra ainda de pe", () => {
      const noveConfirmada = { ...nove, status: "confirmado_paciente" };
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          toques: [toqueDez, toque("run-9h", -3 * HORA, noveConfirmada)],
        }),
        "cancelar",
        "recusar",
      );
      expect(decisao).toEqual({ alvo: "nenhum", motivo: "mais_de_uma_consulta" });
    });

    it("tres toques da MESMA consulta nao sao ambiguidade", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          toques: [
            toque("run-3h", -HORA, a),
            toque("run-24h", -DIA, a),
            toque("run-72h", -3 * DIA, a),
          ],
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toMatchObject({ alvo: "toque", appointmentId: a.id });
    });
  });

  // Achado 60: a oferta expirou, depois saiu o toque de 72h e o paciente
  // tocou "Confirmar". Antes: "esse horario nao esta mais disponivel".
  describe("oferta de espera contra toque de confirmacao", () => {
    it("toque mais recente que a oferta: a resposta e do toque", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          toques: [toque("run-a", -HORA, a)],
          oferta: { id: "oferta-1", enviadaEm: iso(-2 * HORA) },
        }),
        interpretarResposta("sim"),
        "aceitar",
      );
      expect(decisao).toMatchObject({ alvo: "toque", appointmentId: a.id });
    });

    it("oferta mais recente que o toque: o SIM e da oferta", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          toques: [toque("run-a", -3 * HORA, a)],
          oferta: { id: "oferta-1", enviadaEm: iso(-HORA) },
        }),
        interpretarResposta("SIM"),
        "aceitar",
      );
      expect(decisao).toEqual({ alvo: "oferta", offerId: "oferta-1" });
    });

    it("botao do menu depois da oferta nunca vale para ela", () => {
      // O interceptador zera a intencao de oferta quando o texto e do menu.
      const intencaoDeOferta = ehRespostaDoMenuDeConfirmacao("Confirmar")
        ? "nao_reconhecida"
        : "aceitar";
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          toques: [toque("run-a", -3 * HORA, a)],
          oferta: { id: "oferta-1", enviadaEm: iso(-HORA) },
        }),
        interpretarResposta("Confirmar"),
        intencaoDeOferta,
      );
      expect(decisao).toEqual({ alvo: "nenhum", motivo: "sem_intencao" });
    });

    it("oferta que ainda nao saiu nao e pergunta", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          toques: [toque("run-a", -3 * HORA, a)],
          oferta: { id: "oferta-1", enviadaEm: null },
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toMatchObject({ alvo: "toque", appointmentId: a.id });

      expect(
        qualPerguntaFoiRespondida(
          fatos({ oferta: { id: "oferta-1", enviadaEm: null } }),
          "confirmar",
          "aceitar",
        ),
      ).toEqual({ alvo: "nenhum", motivo: "sem_pergunta" });
    });

    it("citar a oferta decide por ela, mesmo com toque mais recente", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          citacao: { tipo: "oferta", offerId: "oferta-1" },
          toques: [toque("run-a", -10 * MINUTO, a)],
          oferta: { id: "oferta-1", enviadaEm: iso(-HORA) },
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toEqual({ alvo: "oferta", offerId: "oferta-1" });
    });

    it("recepcao escreveu depois da oferta: o SIM e para ela", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          oferta: { id: "oferta-1", enviadaEm: iso(-HORA) },
          ultimaMensagemHumanaEm: iso(-10 * MINUTO),
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toEqual({ alvo: "nenhum", motivo: "clinica_falou_depois" });
    });
  });

  it("citar outra mensagem (ou uma desconhecida) cala o interceptador", () => {
    const decisao = qualPerguntaFoiRespondida(
      fatos({
        citacao: { tipo: "outra" },
        toques: [toque("run-a", -HORA, a)],
      }),
      "confirmar",
      "aceitar",
    );
    expect(decisao).toEqual({ alvo: "nenhum", motivo: "citou_outra_mensagem" });
  });

  it("ultimo toque de outra regua: o 'sim' responde aquela pergunta", () => {
    const decisao = qualPerguntaFoiRespondida(
      fatos({
        toques: [
          toque("run-pos-falta", -HORA, null, "pos_falta"),
          toque("run-a", -DIA, a),
        ],
      }),
      "confirmar",
      "aceitar",
    );
    expect(decisao).toEqual({
      alvo: "nenhum",
      motivo: "outra_regua_mais_recente",
    });
  });

  it("citacao de toque de mais de sete dias nao vale", () => {
    const decisao = qualPerguntaFoiRespondida(
      fatos({
        citacao: {
          tipo: "toque",
          toque: toque("run-a", -8 * DIA, consulta("consulta-a", {
            startsAt: iso(DIA),
          })),
        },
      }),
      "confirmar",
      "aceitar",
    );
    expect(decisao).toEqual({ alvo: "nenhum", motivo: "toque_antigo" });
  });

  it("consulta que ja passou ou foi cancelada nao aceita resposta", () => {
    for (const alvo of [
      consulta("passada", { startsAt: iso(-HORA) }),
      consulta("cancelada", { status: "cancelado_clinica" }),
    ]) {
      expect(
        qualPerguntaFoiRespondida(
          fatos({ toques: [toque("run", -2 * HORA, alvo)] }),
          "cancelar",
          "recusar",
        ),
      ).toEqual({ alvo: "nenhum", motivo: "consulta_resolvida" });
    }
  });

  it("frase nao reconhecida nunca vira decisao", () => {
    expect(
      qualPerguntaFoiRespondida(
        fatos({ toques: [toque("run-a", -HORA, a)] }),
        "nao_reconhecida",
        "nao_reconhecida",
      ),
    ).toEqual({ alvo: "nenhum", motivo: "sem_intencao" });
  });

  it("sem toque, sem oferta e sem mensagem: ninguem perguntou nada", () => {
    expect(qualPerguntaFoiRespondida(fatos(), "confirmar", "aceitar")).toEqual({
      alvo: "nenhum",
      motivo: "sem_pergunta",
    });
  });
});
