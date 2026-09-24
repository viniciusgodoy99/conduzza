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
    horarioMudouEm: null,
    ...opcoes,
  };
}

/** Passo de 24h: o offset padrao dos toques daqui. */
const OFFSET = -1440;

/**
 * Toque automatico como a regua o deixa: vencido em starts_at + offset do
 * passo, ou seja, perguntando pelo horario que a consulta tinha no envio.
 */
function toque(
  runId: string,
  sentAtMs: number,
  alvo: ConsultaDoToque | null,
  kind: string | null = "confirmacao",
  opcoes: Partial<ToqueEnviado> = {},
): ToqueEnviado {
  return {
    runId,
    kind,
    sentAt: iso(sentAtMs),
    scheduledFor: alvo
      ? new Date(new Date(alvo.startsAt).getTime() + OFFSET * MINUTO).toISOString()
      : iso(sentAtMs),
    offsetMinutes: OFFSET,
    manual: false,
    skippedReason: null,
    consulta: alvo,
    ...opcoes,
  };
}

function fatos(parcial: Partial<FatosDaResposta> = {}): FatosDaResposta {
  return {
    agora: AGORA,
    conversaEmAtendimento: false,
    citacao: { tipo: "nenhuma" },
    toques: [],
    oferta: null,
    ultimaMensagemHumanaEm: null,
    avisosDeRemarcacao: [],
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

  // Revisao da leva 1 (R1): responder no Atendimento exige assumir, e nada
  // tira a conversa de em_atendimento sozinho. O status nao pode calar para
  // sempre o botao tocado num toque enviado depois de tudo.
  describe("conversa assumida por alguem da clinica", () => {
    const toqueA = toque("run-a", -2 * HORA, a);

    it("sem citacao, ninguem interpreta", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          conversaEmAtendimento: true,
          toques: [toqueA],
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toEqual({
        alvo: "nenhum",
        motivo: "conversa_em_atendimento",
      });
    });

    it("sem citacao, nem com a ultima mensagem de gente ANTES do toque", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          conversaEmAtendimento: true,
          toques: [toqueA],
          ultimaMensagemHumanaEm: iso(-3 * DIA),
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toEqual({
        alvo: "nenhum",
        motivo: "conversa_em_atendimento",
      });
    });

    it("assumida ha dias: o botao citado do toque mais recente vale", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          conversaEmAtendimento: true,
          citacao: { tipo: "toque", toque: toqueA },
          toques: [toqueA],
          ultimaMensagemHumanaEm: iso(-3 * DIA),
        }),
        interpretarResposta("Confirmar"),
        "nao_reconhecida",
      );
      expect(decisao).toEqual({
        alvo: "toque",
        appointmentId: a.id,
        startsAt: a.startsAt,
        intencao: "confirmar",
      });
    });

    it("assumida sem ninguem ter escrito: o botao citado vale", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          conversaEmAtendimento: true,
          citacao: { tipo: "toque", toque: toqueA },
          toques: [toqueA],
        }),
        "remarcar",
        "nao_reconhecida",
      );
      expect(decisao).toMatchObject({
        alvo: "toque",
        appointmentId: a.id,
        intencao: "remarcar",
      });
    });

    it("a recepcao escreveu depois do toque: nem o botao citado vale", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          conversaEmAtendimento: true,
          citacao: { tipo: "toque", toque: toqueA },
          toques: [toqueA],
          ultimaMensagemHumanaEm: iso(-30 * MINUTO),
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toEqual({
        alvo: "nenhum",
        motivo: "clinica_falou_depois",
      });
    });
  });

  // Revisao da leva 1 (R11 e R13): a consulta de terca 10h vai para sexta
  // 16h. O toque de terca continua na conversa, e a consulta voltou a
  // 'agendado'. Nada que responda a ele pode confirmar ou cancelar a sexta:
  // a remarcacao volta a pedir confirmacao, com toque novo.
  describe("toque do horario antigo, depois da remarcacao", () => {
    // O toque de 24h venceu e saiu ha 5 horas, para a consulta daqui a 19h.
    const antiga = consulta("consulta-a", { startsAt: iso(19 * HORA) });
    const toqueAntigo = toque("run-antigo", -5 * HORA, antiga);
    const movida: ConsultaDoToque = {
      ...antiga,
      status: "agendado",
      startsAt: iso(4 * DIA + 4 * HORA),
      horarioMudouEm: iso(-2 * HORA),
    };
    const velhoApontandoParaMovida: ToqueEnviado = {
      ...toqueAntigo,
      consulta: movida,
    };

    it.each([
      ["ok", "aceitar"],
      ["\u{1F44D}", "nao_reconhecida"],
      ["Não vou poder", "nao_reconhecida"],
      ["3", "nao_reconhecida"],
    ] as const)("sem citacao, '%s' fica com a recepcao", (texto, oferta) => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({ toques: [velhoApontandoParaMovida] }),
        interpretarResposta(texto),
        oferta,
      );
      expect(decisao).toEqual({ alvo: "nenhum", motivo: "consulta_remarcada" });
    });

    it.each(["Confirmar", "Cancelar", "Remarcar"])(
      "o botao velho citado ('%s') fica com a recepcao",
      (botao) => {
        const decisao = qualPerguntaFoiRespondida(
          fatos({
            citacao: { tipo: "toque", toque: velhoApontandoParaMovida },
            toques: [velhoApontandoParaMovida],
          }),
          interpretarResposta(botao),
          "nao_reconhecida",
        );
        expect(decisao).toEqual({
          alvo: "nenhum",
          motivo: "consulta_remarcada",
        });
      },
    );

    it("so a conta do passo ja basta (trilha nao lida ou fora da janela)", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          toques: [
            { ...toqueAntigo, consulta: { ...movida, horarioMudouEm: null } },
          ],
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toEqual({ alvo: "nenhum", motivo: "consulta_remarcada" });
    });

    it("run pulada como 'consulta_remarcada' nao vale", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          toques: [toque("run-a", -2 * HORA, a, "confirmacao", {
            skippedReason: "consulta_remarcada",
          })],
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toEqual({ alvo: "nenhum", motivo: "consulta_remarcada" });
    });

    it("consulta que foi e voltou ao horario do toque: a trilha fecha o toque", () => {
      const voltou = { ...antiga, status: "agendado", horarioMudouEm: iso(-HORA) };
      const decisao = qualPerguntaFoiRespondida(
        fatos({ toques: [{ ...toqueAntigo, consulta: voltou }] }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toEqual({ alvo: "nenhum", motivo: "consulta_remarcada" });
    });

    it("remarcada ANTES do toque: o toque ja perguntou pelo horario novo", () => {
      const remarcadaAntes = { ...movida, horarioMudouEm: iso(-10 * HORA) };
      const decisao = qualPerguntaFoiRespondida(
        fatos({ toques: [toque("run-novo", -2 * HORA, remarcadaAntes)] }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toMatchObject({
        alvo: "toque",
        appointmentId: movida.id,
        startsAt: movida.startsAt,
      });
    });

    it("a tolerancia e de 1 minuto, como no executor", () => {
      const base = toque("run-a", -2 * HORA, a);
      const deslocado = (ms: number): ToqueEnviado => ({
        ...base,
        scheduledFor: new Date(
          new Date(base.scheduledFor).getTime() + ms,
        ).toISOString(),
      });
      expect(
        qualPerguntaFoiRespondida(
          fatos({ toques: [deslocado(30_000)] }),
          "confirmar",
          "aceitar",
        ),
      ).toMatchObject({ alvo: "toque", appointmentId: a.id });
      expect(
        qualPerguntaFoiRespondida(
          fatos({ toques: [deslocado(2 * MINUTO)] }),
          "confirmar",
          "aceitar",
        ),
      ).toEqual({ alvo: "nenhum", motivo: "consulta_remarcada" });
    });

    describe("toque do 'Cobrar agora'", () => {
      // A run manual vence na hora do clique, fora da conta do passo.
      const manual = toque("run-manual", -2 * HORA, a, "confirmacao", {
        manual: true,
        scheduledFor: iso(-2 * HORA - MINUTO),
      });

      it("vale para o horario que a consulta tinha no envio", () => {
        expect(
          qualPerguntaFoiRespondida(
            fatos({ toques: [manual] }),
            "confirmar",
            "aceitar",
          ),
        ).toMatchObject({ alvo: "toque", appointmentId: a.id });
      });

      it("horario mudou depois do envio: fica com a recepcao", () => {
        const depois = {
          ...manual,
          consulta: { ...a, startsAt: iso(3 * DIA), horarioMudouEm: iso(-HORA) },
        };
        expect(
          qualPerguntaFoiRespondida(
            fatos({ citacao: { tipo: "toque", toque: depois }, toques: [depois] }),
            "cancelar",
            "recusar",
          ),
        ).toEqual({ alvo: "nenhum", motivo: "consulta_remarcada" });
      });

      it("o mesmo vencimento numa run automatica nao vale", () => {
        expect(
          qualPerguntaFoiRespondida(
            fatos({ toques: [{ ...manual, manual: false }] }),
            "confirmar",
            "aceitar",
          ),
        ).toEqual({ alvo: "nenhum", motivo: "consulta_remarcada" });
      });
    });
  });

  // Revisao da leva 1 (R11 e R13): "Sua consulta foi remarcada para sexta as
  // 16h, qualquer duvida e so responder aqui". O aviso nao pergunta nada e
  // encerra o contexto do toque de antes dele.
  describe("aviso de remarcacao", () => {
    it("depois do toque: 'ok' ou 'nao vou poder' fica com a recepcao", () => {
      for (const texto of ["ok", "Não vou poder", "1"]) {
        const decisao = qualPerguntaFoiRespondida(
          fatos({
            toques: [toque("run-a", -5 * HORA, a)],
            avisosDeRemarcacao: [
              { appointmentId: a.id, enviadoEm: iso(-HORA) },
            ],
          }),
          interpretarResposta(texto),
          "nao_reconhecida",
        );
        expect(decisao).toEqual({
          alvo: "nenhum",
          motivo: "aviso_de_remarcacao",
        });
      }
    });

    it("aviso de OUTRA consulta depois do toque tambem fecha a resposta sem citacao", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          toques: [toque("run-a", -5 * HORA, a)],
          avisosDeRemarcacao: [
            { appointmentId: "consulta-b", enviadoEm: iso(-HORA) },
          ],
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toEqual({ alvo: "nenhum", motivo: "aviso_de_remarcacao" });
    });

    it("mas o botao citado do toque de outra consulta ainda vale", () => {
      const toqueA = toque("run-a", -5 * HORA, a);
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          citacao: { tipo: "toque", toque: toqueA },
          toques: [toqueA],
          avisosDeRemarcacao: [
            { appointmentId: "consulta-b", enviadoEm: iso(-HORA) },
          ],
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toMatchObject({ alvo: "toque", appointmentId: a.id });
    });

    it("o botao citado do toque DESTA consulta, anterior ao aviso, nao vale", () => {
      const toqueA = toque("run-a", -5 * HORA, a);
      const decisao = qualPerguntaFoiRespondida(
        fatos({
          citacao: { tipo: "toque", toque: toqueA },
          toques: [toqueA],
          avisosDeRemarcacao: [{ appointmentId: a.id, enviadoEm: iso(-HORA) }],
        }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toEqual({ alvo: "nenhum", motivo: "consulta_remarcada" });
    });

    it("aviso que ainda nao saiu nao conta: so o que o paciente leu", () => {
      const decisao = qualPerguntaFoiRespondida(
        fatos({ toques: [toque("run-a", -5 * HORA, a)] }),
        "confirmar",
        "aceitar",
      );
      expect(decisao).toMatchObject({ alvo: "toque", appointmentId: a.id });
    });

    // Decisao do dono: remarcacao avisa o paciente e volta a pedir
    // confirmacao. O toque do horario novo sai depois do aviso e vale.
    it("o toque do horario novo, depois do aviso, volta a confirmar", () => {
      const antiga = consulta("consulta-a", { startsAt: iso(19 * HORA) });
      // Movida para daqui a 23h30: o toque de 24h do horario novo venceu e
      // saiu ha 30 minutos, depois do aviso.
      const movida: ConsultaDoToque = {
        ...antiga,
        status: "agendado",
        startsAt: iso(DIA - 30 * MINUTO),
        horarioMudouEm: iso(-3 * HORA),
      };
      const velho = { ...toque("run-velho", -5 * HORA, antiga), consulta: movida };
      const novo = toque("run-novo", -30 * MINUTO, movida);
      const avisos = [{ appointmentId: movida.id, enviadoEm: iso(-2 * HORA) }];

      expect(
        qualPerguntaFoiRespondida(
          fatos({ toques: [novo, velho], avisosDeRemarcacao: avisos }),
          interpretarResposta("ok"),
          "aceitar",
        ),
      ).toEqual({
        alvo: "toque",
        appointmentId: movida.id,
        startsAt: movida.startsAt,
        intencao: "confirmar",
      });
      expect(
        qualPerguntaFoiRespondida(
          fatos({
            citacao: { tipo: "toque", toque: novo },
            toques: [novo, velho],
            avisosDeRemarcacao: avisos,
          }),
          "cancelar",
          "recusar",
        ),
      ).toMatchObject({ alvo: "toque", appointmentId: movida.id });
      // O botao velho continua sem valer, mesmo com o toque novo na conversa.
      expect(
        qualPerguntaFoiRespondida(
          fatos({
            citacao: { tipo: "toque", toque: velho },
            toques: [novo, velho],
            avisosDeRemarcacao: avisos,
          }),
          "confirmar",
          "aceitar",
        ),
      ).toEqual({ alvo: "nenhum", motivo: "consulta_remarcada" });
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
