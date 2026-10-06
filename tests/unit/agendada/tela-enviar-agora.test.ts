import { describe, expect, it } from "vitest";

import {
  AVISO_DE_CONFERIR_A_LISTA,
  AVISO_DE_CONTINUA_AGENDADA,
  AVISO_DE_ENVIO_SEM_CONFIRMACAO,
  desfechoDaFalhaDeRede,
  desfechoDoEnviarAgora,
  planoDaDevolucao,
  type DevolucaoDoTexto,
} from "@/components/atendimento/agendadas/enviar-agora";
import {
  agendadasKeys,
  ERROS_DA_AGENDADA,
} from "@/lib/domain/mensagem-agendada";
import { chavesDaAgendadaNoEvento } from "@/lib/realtime/use-inbox-channel";

// O que a tela faz com cada resposta do "Enviar agora" (F1, F17 e F22 da
// revisao de 06/10/2026) e o que o tempo real rele das agendadas (F9 e F11).
// Puro: a lista e o InboxClient so executam o plano.

const TEXTO = "Oi, Maria! Seu retorno é amanhã às 9h.";
const CONVERSA = "55555555-5555-4555-8555-555555555555";
const OUTRA_CONVERSA = "56565656-5656-4565-8565-565656565656";
const CONTATO = "44444444-4444-4444-8444-444444444444";
const OUTRO_CONTATO = "45454545-4545-4454-8454-454545454545";
const CLINICA = "66666666-6666-4666-8666-666666666666";

describe("desfechoDoEnviarAgora (F1)", () => {
  it("saiu: a conversa por onde saiu", () => {
    expect(
      desfechoDoEnviarAgora({ ok: true, conversationId: CONVERSA }),
    ).toEqual({ tipo: "saiu", conversationId: CONVERSA });
  });

  it("certo que nada saiu: o texto volta para o campo", () => {
    expect(
      desfechoDoEnviarAgora({
        ok: false,
        error: ERROS_DA_AGENDADA.enviarAgoraFalhou,
        texto: TEXTO,
      }),
    ).toEqual({
      tipo: "devolver",
      devolucao: {
        texto: TEXTO,
        aviso: ERROS_DA_AGENDADA.enviarAgoraFalhou,
        certeza: "nao_saiu",
      },
    });
  });

  it("pode ter saido: NUNCA devolve o texto, nem se ele viesse junto", () => {
    const esperado = {
      tipo: "incerto",
      aviso: ERROS_DA_AGENDADA.enviarAgoraIncerto,
    };
    expect(
      desfechoDoEnviarAgora({
        ok: false,
        incerto: true,
        error: ERROS_DA_AGENDADA.enviarAgoraIncerto,
      }),
    ).toEqual(esperado);
    // Defesa: um servidor que mandasse os dois continua sem o texto.
    expect(
      desfechoDoEnviarAgora({
        ok: false,
        incerto: true,
        error: ERROS_DA_AGENDADA.enviarAgoraIncerto,
        texto: TEXTO,
      }),
    ).toEqual(esperado);
  });

  it("recusa antes de retirar: o aviso fica no dialogo", () => {
    for (const error of [
      ERROS_DA_AGENDADA.jaNaFila,
      ERROS_DA_AGENDADA.textoLongoParaEnviar(5000),
      "O número Recepção está desconectado. A mensagem continua agendada e espera a reconexão.",
    ]) {
      expect(desfechoDoEnviarAgora({ ok: false, error })).toEqual({
        tipo: "recusado",
        aviso: error,
      });
    }
    // Texto so de espacos nao e texto para devolver.
    expect(
      desfechoDoEnviarAgora({ ok: false, error: "x", texto: "  " }).tipo,
    ).toBe("recusado");
  });
});

describe("desfechoDaFalhaDeRede (F17): a lista rele antes de decidir", () => {
  it("fora da lista (retirada): o texto do item volta, sem confirmacao", () => {
    expect(
      desfechoDaFalhaDeRede({ releitura: { situacao: null }, texto: TEXTO }),
    ).toEqual({
      tipo: "devolver",
      devolucao: {
        texto: TEXTO,
        aviso:
          "Não foi possível confirmar o envio. Confira a conversa antes de mandar de novo.",
        certeza: "incerto",
      },
    });
  });

  it("sem conseguir reler: o texto tambem volta (nunca se perde)", () => {
    const desfecho = desfechoDaFalhaDeRede({ releitura: null, texto: TEXTO });
    expect(desfecho.tipo).toBe("devolver");
  });

  it("ainda agendada: nada mudou, e o texto NAO vai para o campo", () => {
    expect(
      desfechoDaFalhaDeRede({
        releitura: { situacao: "agendada" },
        texto: TEXTO,
      }),
    ).toEqual({ tipo: "recusado", aviso: AVISO_DE_CONTINUA_AGENDADA });
  });

  it("seguiu o proprio caminho (na fila, enviada): confere a lista", () => {
    for (const situacao of ["enviando", "enviada", "nao_enviada"] as const) {
      expect(
        desfechoDaFalhaDeRede({ releitura: { situacao }, texto: TEXTO }),
      ).toEqual({ tipo: "recusado", aviso: AVISO_DE_CONFERIR_A_LISTA });
    }
  });

  it("fora da lista e sem texto no item: so o aviso", () => {
    expect(
      desfechoDaFalhaDeRede({ releitura: { situacao: null }, texto: null }),
    ).toEqual({ tipo: "incerto", aviso: AVISO_DE_ENVIO_SEM_CONFIRMACAO });
  });
});

describe("planoDaDevolucao (F22): para onde vai o texto", () => {
  const naoSaiu: DevolucaoDoTexto = {
    texto: TEXTO,
    aviso: ERROS_DA_AGENDADA.enviarAgoraFalhou,
    certeza: "nao_saiu",
  };
  const incerto: DevolucaoDoTexto = {
    texto: TEXTO,
    aviso: AVISO_DE_ENVIO_SEM_CONFIRMACAO,
    certeza: "incerto",
  };

  it("mesma conversa, campo vazio: o texto vai para o campo", () => {
    expect(
      planoDaDevolucao({
        devolucao: naoSaiu,
        contato: "Maria Teste",
        mesmaConversa: true,
        rascunho: { texto: "  ", modo: "responder" },
      }),
    ).toEqual({
      tipo: "no_campo",
      texto: TEXTO,
      voltarParaResposta: false,
      aviso: ERROS_DA_AGENDADA.enviarAgoraFalhou,
      certeza: "nao_saiu",
    });
  });

  it("nota interna vazia: volta para a resposta ao paciente", () => {
    const plano = planoDaDevolucao({
      devolucao: incerto,
      contato: "Maria Teste",
      mesmaConversa: true,
      rascunho: { texto: "", modo: "nota" },
    });
    expect(plano).toMatchObject({
      tipo: "no_campo",
      voltarParaResposta: true,
      certeza: "incerto",
    });
  });

  it("resposta em andamento: o texto entra no fim", () => {
    expect(
      planoDaDevolucao({
        devolucao: naoSaiu,
        contato: "Maria Teste",
        mesmaConversa: true,
        rascunho: { texto: "Bom dia!", modo: "responder" },
      }),
    ).toMatchObject({ tipo: "no_campo", texto: `Bom dia!\n\n${TEXTO}` });
  });

  it("outra conversa: o aviso diz PARA QUEM era, e nao fala de outro texto", () => {
    const plano = planoDaDevolucao({
      devolucao: naoSaiu,
      contato: "Maria Teste",
      mesmaConversa: false,
      rascunho: { texto: "", modo: "responder" },
    });
    expect(plano).toEqual({
      tipo: "copiar",
      titulo: "A mensagem para Maria Teste não saiu e não está mais agendada.",
      descricao: "Copie a mensagem e cole na resposta para Maria Teste.",
      texto: TEXTO,
      certeza: "nao_saiu",
    });
  });

  it("outra conversa com o envio sem confirmacao: manda conferir antes", () => {
    const plano = planoDaDevolucao({
      devolucao: incerto,
      contato: "Maria Teste",
      mesmaConversa: false,
      rascunho: { texto: "rascunho de outro paciente", modo: "responder" },
    });
    expect(plano).toMatchObject({
      tipo: "copiar",
      titulo:
        "Não foi possível confirmar o envio da mensagem para Maria Teste.",
      descricao:
        "Confira a conversa de Maria Teste antes de mandar de novo. Se a mensagem não estiver lá, copie e cole na resposta para Maria Teste.",
    });
  });

  it("mesma conversa com nota em andamento: ha outro texto no campo", () => {
    const plano = planoDaDevolucao({
      devolucao: naoSaiu,
      contato: null,
      mesmaConversa: true,
      rascunho: { texto: "Paciente prefere manhã", modo: "nota" },
    });
    expect(plano).toEqual({
      tipo: "copiar",
      titulo: "A mensagem para o contato não saiu e não está mais agendada.",
      descricao:
        "Há outro texto no campo. Copie a mensagem e cole na resposta ao paciente.",
      texto: TEXTO,
      certeza: "nao_saiu",
    });
  });

  it("nenhum travessao nem meia-risca nos textos", () => {
    const textos = [
      AVISO_DE_ENVIO_SEM_CONFIRMACAO,
      AVISO_DE_CONTINUA_AGENDADA,
      AVISO_DE_CONFERIR_A_LISTA,
    ];
    for (const devolucao of [naoSaiu, incerto]) {
      for (const mesmaConversa of [true, false]) {
        const plano = planoDaDevolucao({
          devolucao,
          contato: "Maria",
          mesmaConversa,
          rascunho: { texto: "x", modo: "nota" },
        });
        if (plano.tipo === "copiar") {
          textos.push(plano.titulo, plano.descricao);
        }
      }
    }
    expect(textos.join(" ")).not.toMatch(/[—–]/);
  });
});

describe("chavesDaAgendadaNoEvento (F9 e F11): o que o canal rele", () => {
  const aberta = { conversationId: CONVERSA, contactId: CONTATO };

  it("evento de message da conversa aberta: a lista e a autoria do fio", () => {
    expect(
      chavesDaAgendadaNoEvento({
        clinicId: CLINICA,
        aberta,
        conversationId: CONVERSA,
      }),
    ).toEqual([
      agendadasKeys.doContato(CLINICA, CONTATO),
      agendadasKeys.doFio(CONVERSA),
    ]);
  });

  it("outra conversa do MESMO contato (outro numero): so a lista", () => {
    // Evento de conversation traz o contato.
    expect(
      chavesDaAgendadaNoEvento({
        clinicId: CLINICA,
        aberta,
        conversationId: OUTRA_CONVERSA,
        contactId: CONTATO,
      }),
    ).toEqual([agendadasKeys.doContato(CLINICA, CONTATO)]);
    // Evento de message nao traz: o cache da lista diz de quem e.
    expect(
      chavesDaAgendadaNoEvento({
        clinicId: CLINICA,
        aberta,
        conversationId: OUTRA_CONVERSA,
        contatoDaConversa: () => CONTATO,
      }),
    ).toEqual([agendadasKeys.doContato(CLINICA, CONTATO)]);
  });

  it("outro contato, conversa desconhecida ou nada aberto: nada", () => {
    expect(
      chavesDaAgendadaNoEvento({
        clinicId: CLINICA,
        aberta,
        conversationId: OUTRA_CONVERSA,
        contactId: OUTRO_CONTATO,
      }),
    ).toEqual([]);
    expect(
      chavesDaAgendadaNoEvento({
        clinicId: CLINICA,
        aberta,
        conversationId: OUTRA_CONVERSA,
        contatoDaConversa: () => null,
      }),
    ).toEqual([]);
    expect(
      chavesDaAgendadaNoEvento({
        clinicId: CLINICA,
        aberta: null,
        conversationId: CONVERSA,
      }),
    ).toEqual([]);
    expect(
      chavesDaAgendadaNoEvento({
        clinicId: CLINICA,
        aberta,
        conversationId: undefined,
      }),
    ).toEqual([]);
  });

  it("a chave do fio casa por prefixo com a da consulta (que leva a assinatura)", () => {
    const daConsulta = [...agendadasKeys.doFio(CONVERSA), "2:a:b"];
    const doCanal = agendadasKeys.doFio(CONVERSA);
    expect(daConsulta.slice(0, doCanal.length)).toEqual([...doCanal]);
  });
});
