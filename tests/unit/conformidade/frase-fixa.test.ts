import { describe, expect, it } from "vitest";

import { fatosVazios } from "@/lib/domain/conformidade/fatos-do-turno";
import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import {
  FRASE_DA_CURIOSIDADE_DE_ESTETICA,
  FRASE_DE_ESCALONAMENTO,
  FRASE_DO_ASSISTENTE_VIRTUAL,
  FRASE_FORA_DO_ASSUNTO,
} from "@/lib/domain/conformidade/frase-fixa";
import { prometePassagemParaAEquipe } from "@/lib/agente/passagem-prometida";

// A frase fixa e a resposta unica para qualquer bloqueio ou escalonamento.
// Mudar o texto e decisao do dono (plano, decisao 5): este teste trava o
// texto aprovado, e o outro garante que a propria frase nao cai no filtro.

describe("frase fixa de escalonamento", () => {
  it("e exatamente o texto aprovado", () => {
    expect(FRASE_DE_ESCALONAMENTO).toBe(
      "Recebi sua mensagem. Vou passar sua conversa para alguém da nossa equipe, que vai te responder por aqui assim que possível.",
    );
  });

  it("passa pelo filtro deterministico", () => {
    const resultado = avaliarRegras(FRASE_DE_ESCALONAMENTO, {
      precosDoTurno: [],
      nomesDoCatalogo: [],
      mensagensDoPaciente: [],
    });
    expect(resultado.achados).toEqual([]);
  });

  it("nao tem travessao nem marca de IA", () => {
    expect(FRASE_DE_ESCALONAMENTO).not.toMatch(/[\u2013\u2014]/);
    expect(FRASE_DE_ESCALONAMENTO.toLowerCase()).not.toMatch(
      /\bia\b|robo|assistente/,
    );
  });
});

// Onda 2 (item 5, P5a e P5c; P11a): as frases fixas que saem como RESPOSTA
// da IA. O texto e do dono; o modelo so escolhe a frase. Passam nas regras
// do filtro (e ainda vao ao verificador, como toda resposta) e nao revelam o
// sistema.
describe("frases fixas da resposta da IA (onda 2)", () => {
  it("fora do assunto: exatamente o texto proposto no contrato e aceito pelo dono", () => {
    expect(FRASE_FORA_DO_ASSUNTO).toBe(
      "Desculpe, por aqui eu só consigo ajudar com assuntos da clínica. Posso ajudar com alguma coisa sobre a clínica?",
    );
  });

  // Desde 09/11/2026 e a frase PADRAO: cada clinica pode escrever a sua na
  // aba Persona (tests/unit/agente/frase-do-assistente.test.ts).
  it("assistente virtual (a padrão): diz que é a assistente virtual da clínica e oferece uma pessoa", () => {
    expect(FRASE_DO_ASSISTENTE_VIRTUAL).toContain(
      "assistente virtual da clínica",
    );
    expect(FRASE_DO_ASSISTENTE_VIRTUAL).toContain("pessoa da equipe");
  });

  it("as duas passam nas regras do filtro, sem travessão e sem nada do sistema", () => {
    for (const frase of [FRASE_FORA_DO_ASSUNTO, FRASE_DO_ASSISTENTE_VIRTUAL]) {
      const resultado = avaliarRegras(frase, {
        precosDoTurno: [],
        nomesDoCatalogo: [],
        mensagensDoPaciente: [],
      });
      expect(resultado.achados, frase).toEqual([]);
      expect(frase).not.toMatch(/[\u2013\u2014]/);
      expect(frase.toLowerCase()).not.toMatch(
        /openai|gpt|modelo|ferramenta|instru|sistema|prompt|robo|\bia\b/,
      );
      // Nao e promessa de passagem: a conversa continua na IA.
      expect(prometePassagemParaAEquipe(frase), frase).toBe(false);
    }
  });

  it("nenhuma é a frase de escalonamento (o simulador e a contagem as distinguem)", () => {
    expect(FRASE_FORA_DO_ASSUNTO).not.toBe(FRASE_DE_ESCALONAMENTO);
    expect(FRASE_DO_ASSISTENTE_VIRTUAL).not.toBe(FRASE_DE_ESCALONAMENTO);
    expect(FRASE_DO_ASSISTENTE_VIRTUAL).not.toBe(FRASE_FORA_DO_ASSUNTO);
  });
});

// Decisao do dono de 23/11/2026: a frase da curiosidade geral de estetica.
// Texto do dono, palavra por palavra (sem aprovacao do RT); quem escolhe e o
// sistema, e ela sai pelo filtro inteiro como as frases da onda 2.
describe("frase da curiosidade geral de estética (23/11/2026)", () => {
  it("é exatamente o texto aprovado pelo dono, byte a byte", () => {
    expect(FRASE_DA_CURIOSIDADE_DE_ESTETICA).toBe(
      "Essa é uma dúvida que o profissional responde na avaliação, porque cada caso é visto pessoalmente. Quer marcar uma avaliação?",
    );
    expect(Buffer.from(FRASE_DA_CURIOSIDADE_DE_ESTETICA, "utf8").toString("hex")).toBe(
      Buffer.from(
        "Essa \u00e9 uma d\u00favida que o profissional responde na avalia\u00e7\u00e3o, porque cada caso \u00e9 visto pessoalmente. Quer marcar uma avalia\u00e7\u00e3o?",
        "utf8",
      ).toString("hex"),
    );
  });

  it("passa nas regras do filtro, sem travessão, sem nada do sistema e sem prometer passagem", () => {
    const resultado = avaliarRegras(FRASE_DA_CURIOSIDADE_DE_ESTETICA, {
      precosDoTurno: [],
      nomesDoCatalogo: [],
      mensagensDoPaciente: [],
    });
    expect(resultado.achados).toEqual([]);
    expect(FRASE_DA_CURIOSIDADE_DE_ESTETICA).not.toMatch(/[\u2013\u2014]/);
    expect(FRASE_DA_CURIOSIDADE_DE_ESTETICA.toLowerCase()).not.toMatch(
      /openai|gpt|modelo|ferramenta|instru|sistema|prompt|robo|\bia\b/,
    );
    expect(prometePassagemParaAEquipe(FRASE_DA_CURIOSIDADE_DE_ESTETICA)).toBe(
      false,
    );
    expect(FRASE_DA_CURIOSIDADE_DE_ESTETICA).not.toBe(FRASE_DE_ESCALONAMENTO);
  });
});

// A regra de contexto do filtro (o paciente falou de saude) nao barra a frase
// quando ela e a resposta a curiosidade geral, com os fatos do turno; barra
// qualquer outro texto, e a frase depois de outra pergunta clinica.
describe("a regra de contexto e a frase da curiosidade (23/11/2026)", () => {
  const AVISO = FRASE_DO_ASSISTENTE_VIRTUAL;
  const fatos = {
    ...fatosVazios(2026),
    textosColados: [AVISO, FRASE_DA_CURIOSIDADE_DE_ESTETICA],
  };
  const contexto = (mensagensDoPaciente: string[]) => ({
    precosDoTurno: [],
    nomesDoCatalogo: [],
    mensagensDoPaciente,
    fatos,
  });

  it("a frase (com o aviso colado) depois de 'botox dói?' passa nas regras", () => {
    expect(
      avaliarRegras(
        `${AVISO}\n\n${FRASE_DA_CURIOSIDADE_DE_ESTETICA}`,
        contexto(["botox dói?"]),
      ).achados,
    ).toEqual([]);
  });

  it("outro texto depois de 'botox dói?' continua barrado pelo contexto", () => {
    expect(
      avaliarRegras("Dói um pouco, mas é rápido.", contexto(["botox dói?"]))
        .achados.map((a) => a.regra),
    ).toContain("contexto:sintoma");
    expect(
      avaliarRegras(
        `${FRASE_DA_CURIOSIDADE_DE_ESTETICA}\n\nDói um pouco.`,
        contexto(["botox dói?"]),
      ).achados.map((a) => a.regra),
    ).toContain("contexto:sintoma");
  });

  it("a frase depois de uma pergunta com a situação da pessoa continua barrada", () => {
    expect(
      avaliarRegras(
        FRASE_DA_CURIOSIDADE_DE_ESTETICA,
        contexto(["fiz botox ontem e ta doendo"]),
      ).achados.length,
    ).toBeGreaterThan(0);
  });
});
