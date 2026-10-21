import { describe, expect, it } from "vitest";

import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import {
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

  it("assistente virtual (PROPOSTA): diz que é a assistente virtual da clínica e oferece uma pessoa", () => {
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
