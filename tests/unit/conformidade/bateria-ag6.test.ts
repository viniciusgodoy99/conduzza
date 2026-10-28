import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  executarTurnoDoAgente,
  PASSO_DA_URGENCIA,
  type ClienteDoAgente,
} from "@/lib/agente/laco";
import { configPadraoDoAgente } from "@/lib/domain/agente/config";
import {
  CATEGORIAS_DO_VERIFICADOR,
  type CategoriaDoVerificador,
} from "@/lib/domain/conformidade/categorias";
import { filtrarSaida } from "@/lib/domain/conformidade/filtro";
import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import { detectarGatilhosDeEntrada } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import {
  detectarUrgencia,
  SINAIS_DE_EMERGENCIA,
} from "@/lib/domain/conformidade/urgencia";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";
import { contextoDo } from "@/tests/fixtures/ia/conformidade/casos";
import {
  CASOS_DE_URGENCIA,
  CONTROLES_DA_SAIDA_DA_URGENCIA,
  CONTROLES_DA_URGENCIA,
  SAIDAS_DA_URGENCIA_QUE_BLOQUEIAM,
  TENTATIVAS_DE_TRIAGEM,
} from "@/tests/fixtures/ia/conformidade/casos-ag6";

// Bateria do CFM da AG6a (a urgencia; no prebuild): os sinais de emergencia
// da lista PROPOSTA ao RT (D-51) passam a conversa como urgencia nos dois
// sentidos (o portao deterministico e o laco com o LLM FALSO, sem modelo
// nenhum), a negacao e as excecoes nao viram urgencia, o pedido de avaliacao
// escala pelo gatilho de sempre e NADA disso vira orientacao ao paciente: o
// contato recebe so a frase de sempre, e a IA que escreve 192, SAMU,
// pronto-socorro ou orientacao continua barrada. Nenhum teste chama a
// OpenAI (o pacote e o stub e o fetch dos testes recusa o host).

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

function verificadorQueReprova(categoria: CategoriaDoVerificador) {
  return vi.fn<Verificador>(async () => ({
    tipo: "veredicto",
    veredicto: {
      aprovado: false,
      violacoes: [{ categoria, gravidade: "alta" }],
      confianca: "alta",
    },
    modelo: "gpt-6-luna",
    uso: USO,
  }));
}

describe("bateria AG6: os sinais de emergência", () => {
  it("cobre todos os sinais da lista, os dois tipos e as técnicas do desenho", () => {
    const sinais = new Set(
      CASOS_DE_URGENCIA.map((caso) => detectarUrgencia([caso.texto])?.sinal),
    );
    // Todo sinal tem pelo menos um caso que o dispara sozinho (o risco de
    // vida vence o fisico: o caso misto conta o risco).
    for (const sinal of SINAIS_DE_EMERGENCIA) {
      expect(sinais, sinal.nome).toContain(sinal.nome);
    }
    expect(new Set(CASOS_DE_URGENCIA.map((caso) => caso.tipo))).toEqual(
      new Set(["fisica", "risco_de_vida"]),
    );
    for (const tecnica of [
      "literal",
      "parafrase",
      "caixa_alta",
      "letra_dobrada",
    ]) {
      expect(
        CASOS_DE_URGENCIA.some((caso) => caso.tecnica === tecnica),
        tecnica,
      ).toBe(true);
    }
    const ids = [
      ...CASOS_DE_URGENCIA,
      ...CONTROLES_DA_URGENCIA,
      ...TENTATIVAS_DE_TRIAGEM,
      ...SAIDAS_DA_URGENCIA_QUE_BLOQUEIAM,
      ...CONTROLES_DA_SAIDA_DA_URGENCIA,
    ].map((caso) => caso.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(CASOS_DE_URGENCIA.map((caso) => [caso.id, caso] as const))(
    "%s é urgência do tipo certo e o primeiro gatilho do portão",
    (_id, caso) => {
      expect(detectarUrgencia([caso.texto])?.tipo).toBe(caso.tipo);
      expect(
        detectarGatilhosDeEntrada({
          mensagens: [{ tipo: "texto", texto: caso.texto }],
        })[0],
      ).toBe("urgencia");
    },
  );

  it.each(CONTROLES_DA_URGENCIA.map((caso) => [caso.id, caso] as const))(
    "controle %s não vira urgência",
    (_id, caso) => {
      expect(detectarUrgencia([caso.texto])).toBeNull();
      expect(
        detectarGatilhosDeEntrada({
          mensagens: [{ tipo: "texto", texto: caso.texto }],
        }),
      ).not.toContain("urgencia");
    },
  );

  it.each(TENTATIVAS_DE_TRIAGEM.map((caso) => [caso.id, caso] as const))(
    "triagem %s escala pelo gatilho de sempre, sem a marca",
    (_id, caso) => {
      const gatilhos = detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: caso.texto }],
      });
      expect(gatilhos).toContain(caso.gatilho);
      expect(gatilhos).not.toContain("urgencia");
    },
  );
});

describe("bateria AG6: nada vira orientação ao paciente (o laço com o LLM falso)", () => {
  const classificador = vi.fn<ClassificadorDeEntrada>(async () => ({
    tipo: "classificacao",
    classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: USO,
  }));

  it.each(CASOS_DE_URGENCIA.map((caso) => [caso.id, caso] as const))(
    "%s: a frase de sempre, sem chamar modelo nenhum",
    async (_id, caso) => {
      const create = vi.fn(async () => {
        throw new Error("o modelo nunca pode ser chamado na urgencia");
      });
      const verificador = verificadorQueSempreAprova();
      classificador.mockClear();
      const r = await executarTurnoDoAgente({
        cliente: { responses: { create } } as unknown as ClienteDoAgente,
        modelo: "gpt-6-luna",
        clinicId: "acd9c539-585e-4f2a-a195-712c70099564",
        identificadorDeSeguranca: "a".repeat(64),
        config: configPadraoDoAgente(),
        catalogo: {
          procedimentos: [],
          vinculos: [],
          convenios: [],
          conveniosDoCadastro: [],
        } as unknown as Parameters<typeof executarTurnoDoAgente>[0]["catalogo"],
        mensagens: [
          { autor: "paciente", texto: caso.texto, textoOriginal: caso.texto },
        ],
        agoraMs: Date.UTC(2026, 9, 27, 15, 0),
        fuso: "America/Fortaleza",
        verificador,
        classificador,
      });
      expect(r.tipo).toBe("frase_fixa");
      expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
      expect(r.desfecho).toEqual({
        tipo: "escalou",
        motivo: "urgencia",
        gatilho: "urgencia",
        origem: "portao",
      });
      expect(r.trilha.map((p) => p.texto)).toContain(PASSO_DA_URGENCIA);
      expect(r.uso).toEqual([]);
      expect(r.rascunhoBloqueado).toBeNull();
      expect(create).not.toHaveBeenCalled();
      expect(classificador).not.toHaveBeenCalled();
      expect(verificador).not.toHaveBeenCalled();
    },
  );
});

describe("bateria AG6: o que a IA nunca escreve sobre emergência", () => {
  const deterministicos = SAIDAS_DA_URGENCIA_QUE_BLOQUEIAM.filter(
    (caso) => !caso.soModelo,
  );
  const soModelo = SAIDAS_DA_URGENCIA_QUE_BLOQUEIAM.filter(
    (caso) => caso.soModelo,
  );

  it.each(deterministicos.map((caso) => [caso.id, caso] as const))(
    "%s bloqueia pela regra, sem chamar o verificador (o 192 escrito pela IA continua barrado)",
    async (_id, caso) => {
      expect(
        avaliarRegras(caso.rascunho, contextoDo(caso)).categorias,
      ).toContain(caso.categoria);
      const verificador = verificadorQueSempreAprova();
      const decisao = await filtrarSaida({
        rascunho: caso.rascunho,
        contexto: contextoDo(caso),
        verificador,
      });
      expect(decisao).toMatchObject({ aprovado: false, camada: "regra" });
      expect(verificador).not.toHaveBeenCalled();
    },
  );

  it.each(soModelo.map((caso) => [caso.id, caso] as const))(
    "%s: a regra não pega; o verificador bloqueia na camada do modelo",
    async (_id, caso) => {
      expect(avaliarRegras(caso.rascunho, contextoDo(caso)).categorias).toEqual(
        [],
      );
      const categoria = CATEGORIAS_DO_VERIFICADOR.find(
        (c) => c === caso.categoria,
      );
      expect(categoria).toBeDefined();
      const decisao = await filtrarSaida({
        rascunho: caso.rascunho,
        contexto: contextoDo(caso),
        verificador: verificadorQueReprova(categoria ?? "triagem"),
      });
      expect(decisao).toMatchObject({
        aprovado: false,
        camada: "modelo",
        categoria: caso.categoria,
      });
    },
  );

  it.each(
    CONTROLES_DA_SAIDA_DA_URGENCIA.map((caso) => [caso.id, caso] as const),
  )(
    "controle %s: a frase de sempre passa nas regras e no filtro",
    async (_id, caso) => {
      expect(avaliarRegras(caso.rascunho, contextoDo(caso)).achados).toEqual(
        [],
      );
      const decisao = await filtrarSaida({
        rascunho: caso.rascunho,
        contexto: contextoDo(caso),
        verificador: verificadorQueSempreAprova(),
      });
      expect(decisao.aprovado).toBe(true);
    },
  );

  it("a frase de sempre não cita o 192, o SAMU, o CVV, sintoma nem orientação", () => {
    expect(FRASE_DE_ESCALONAMENTO).not.toMatch(
      /192|188|samu|cvv|pronto|hospital|emerg|urg|respir|sintoma|grave|calma/i,
    );
    expect(FRASE_DE_ESCALONAMENTO).not.toMatch(/[–—]/);
  });
});
