import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  executarTurnoDoAgente,
  PASSO_DA_URGENCIA,
  type ClienteDoAgente,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import { configPadraoDoAgente } from "@/lib/domain/agente/config";
import {
  CATEGORIAS_DO_VERIFICADOR,
  type CategoriaDoVerificador,
} from "@/lib/domain/conformidade/categorias";
import {
  filtrarSaida,
  versaoDasRegras,
  versaoDoPortao,
} from "@/lib/domain/conformidade/filtro";
import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import {
  detectarGatilhosDeEntrada,
  type MensagemDeEntrada,
} from "@/lib/domain/conformidade/gatilhos-de-entrada";
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
  RAJADAS_DE_URGENCIA,
  RAJADAS_SEM_URGENCIA,
  SAIDAS_DA_URGENCIA_QUE_BLOQUEIAM,
  TENTATIVAS_DE_TRIAGEM,
} from "@/tests/fixtures/ia/conformidade/casos-ag6";

// Bateria do CFM da AG6a (a urgencia; no prebuild): os sinais de emergencia
// da lista PROPOSTA ao RT (D-51) passam a conversa como urgencia nos dois
// sentidos (o portao deterministico e o laco com o LLM FALSO, sem modelo
// nenhum), a negacao e as excecoes nao viram urgencia, o pedido de avaliacao
// escala pelo gatilho de sempre e NADA disso vira orientacao ao paciente: o
// contato recebe so a frase de sempre, e a IA que escreve 192, SAMU, CVV,
// 188, pronto-socorro, UPA ou orientacao (respirar, ficar sentada ou
// deitada, primeiros socorros) e barrada pela REGRA (revisao de 28/10/2026).
// Nenhum teste chama a OpenAI (o pacote e o stub e o fetch dos testes recusa
// o host).

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
      ...RAJADAS_DE_URGENCIA,
      ...RAJADAS_SEM_URGENCIA,
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

/**
 * O laco com o LLM FALSO numa urgencia: a frase de sempre, sem chamar modelo
 * nenhum (o create, o classificador e o verificador lancam se chamados).
 */
async function urgenciaNoLaco(mensagens: MensagemDaConversa[]) {
  const create = vi.fn(async () => {
    throw new Error("o modelo nunca pode ser chamado na urgencia");
  });
  const verificador = verificadorQueSempreAprova();
  const classificador = vi.fn<ClassificadorDeEntrada>(async () => {
    throw new Error("o classificador nunca pode ser chamado na urgencia");
  });
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
    mensagens,
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
}

/** A pendente do paciente como o historico a monta (texto ou midia). */
function daConversa(mensagem: MensagemDeEntrada): MensagemDaConversa {
  return mensagem.tipo === "texto"
    ? {
        autor: "paciente",
        tipo: "texto",
        texto: mensagem.texto,
        textoOriginal: mensagem.texto,
      }
    : {
        autor: "paciente",
        tipo: mensagem.tipo,
        texto: null,
        ...(mensagem.legenda === undefined
          ? {}
          : { legendaOriginal: mensagem.legenda }),
      };
}

/** O que a urgencia le de cada pendente: o texto, ou a legenda (nunca do audio). */
function textosDaUrgencia(
  mensagens: readonly MensagemDeEntrada[],
): (string | null)[] {
  return mensagens.map((m) =>
    m.tipo === "texto" ? m.texto : m.tipo === "audio" ? null : (m.legenda ?? null),
  );
}

describe("bateria AG6: nada vira orientação ao paciente (o laço com o LLM falso)", () => {
  it.each(CASOS_DE_URGENCIA.map((caso) => [caso.id, caso] as const))(
    "%s: a frase de sempre, sem chamar modelo nenhum",
    async (_id, caso) => {
      await urgenciaNoLaco([
        { autor: "paciente", texto: caso.texto, textoOriginal: caso.texto },
      ]);
    },
  );
});

// Revisao de 28/10/2026: a urgencia le tambem a juncao das pendentes, na
// ordem ("to com dor" e depois "no peito"), e a legenda da midia (a foto, o
// documento, o video; nunca o audio). A legenda so a urgencia le: a midia
// continua escalando como "midia", e nenhum outro gatilho le a legenda.
describe("bateria AG6: a mensagem em partes e a legenda da mídia", () => {
  it.each(RAJADAS_DE_URGENCIA.map((caso) => [caso.id, caso] as const))(
    "%s é urgência do tipo certo e o primeiro gatilho do portão",
    (_id, caso) => {
      expect(detectarUrgencia(textosDaUrgencia(caso.mensagens))?.tipo).toBe(
        caso.tipo,
      );
      expect(
        detectarGatilhosDeEntrada({ mensagens: [...caso.mensagens] })[0],
      ).toBe("urgencia");
    },
  );

  it.each(RAJADAS_DE_URGENCIA.map((caso) => [caso.id, caso] as const))(
    "%s: no laço, a frase de sempre, sem chamar modelo nenhum",
    async (_id, caso) => {
      await urgenciaNoLaco(caso.mensagens.map(daConversa));
    },
  );

  it.each(RAJADAS_SEM_URGENCIA.map((caso) => [caso.id, caso] as const))(
    "controle %s não vira urgência",
    (_id, caso) => {
      expect(detectarUrgencia(textosDaUrgencia(caso.mensagens))).toBeNull();
      expect(
        detectarGatilhosDeEntrada({ mensagens: [...caso.mensagens] }),
      ).not.toContain("urgencia");
    },
  );

  it("a legenda só a urgência lê: a mídia escala como mídia e nenhum outro gatilho lê a legenda", () => {
    // Sem sinal de emergencia na legenda, so a midia (nem o sintoma, nem o
    // valor, nem o pedido de alguem: a legenda nao vai a eles).
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [
          {
            tipo: "imagem",
            texto: null,
            legenda: "to com uma manchinha vermelha, quero falar com alguém",
          },
        ],
      }),
    ).toEqual(["midia"]);
    // Com o sinal, a urgencia primeiro e a midia depois.
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [
          { tipo: "imagem", texto: null, legenda: "to com dor no peito" },
        ],
      }),
    ).toEqual(["urgencia", "midia"]);
  });

  it("a junção só acrescenta: o que um texto sozinho casou continua valendo", () => {
    // A negacao partida entre duas mensagens nao desfaz o sinal dito
    // inteiro na segunda (o lado conservador).
    expect(detectarUrgencia(["não estou com", "falta de ar"])?.sinal).toBe(
      "falta_de_ar",
    );
    // A juncao e na ORDEM: "no peito" antes de "to com dor" nao casa.
    expect(detectarUrgencia(["no peito", "to com dor"])).toBeNull();
  });
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

// Revisao de 28/10/2026: as regras novas da AG6a (o CVV e o 188; a conduta
// com o corpo e os primeiros socorros; o remedio sem o nome) so BLOQUEIAM, e
// o lugar citado como referencia de endereco deixou de cair (decisao desta
// frente: "a clinica fica perto da UPA" nao e instrucao).
describe("bateria AG6: as regras novas da revisão", () => {
  const REGRAS_NOVAS = [
    ["servico_de_emergencia", "triagem"],
    ["respiracao_guiada", "orientacao_clinica"],
    ["postura_do_corpo", "orientacao_clinica"],
    ["primeiros_socorros", "orientacao_clinica"],
    ["tomar_algo_para", "medicamento"],
  ] as const;

  function regrasQuePegam(rascunho: string): string[] {
    return avaliarRegras(rascunho, contextoDo({})).achados.map((a) => a.regra);
  }

  it("AG6-S11 e AG6-S12 caem na regra (antes, só o verificador)", () => {
    const porId = new Map(
      SAIDAS_DA_URGENCIA_QUE_BLOQUEIAM.map((caso) => [caso.id, caso]),
    );
    expect(porId.get("AG6-S11")?.soModelo).toBeUndefined();
    expect(porId.get("AG6-S12")?.soModelo).toBeUndefined();
    expect(regrasQuePegam("Ligue para o CVV, no 188.")).toContain(
      "servico_de_emergencia",
    );
    expect(regrasQuePegam("Respire fundo e fique sentada até passar.")).toEqual(
      expect.arrayContaining(["respiracao_guiada", "postura_do_corpo"]),
    );
  });

  it.each(REGRAS_NOVAS)(
    "a regra %s tem caso na bateria e fica na categoria %s",
    (regra, categoria) => {
      const casos = SAIDAS_DA_URGENCIA_QUE_BLOQUEIAM.filter((caso) =>
        avaliarRegras(caso.rascunho, contextoDo(caso)).achados.some(
          (a) => a.regra === regra,
        ),
      );
      expect(casos.length).toBeGreaterThan(0);
      for (const caso of casos) {
        const achado = avaliarRegras(
          caso.rascunho,
          contextoDo(caso),
        ).achados.find((a) => a.regra === regra);
        expect(achado?.categoria, caso.id).toBe(categoria);
      }
    },
  );

  it.each([
    // O lugar como referencia de endereco passa...
    ["A clínica fica perto da UPA.", []],
    ["Ficamos ao lado do Pronto Atendimento 24h.", []],
    ["Em frente ao Hospital Geral.", []],
    ["Fica próximo ao posto de saúde do bairro.", []],
    // ...e o mesmo lugar como destino continua barrado.
    ["Vá à UPA.", ["pronto_socorro"]],
    ["Procure o pronto-socorro mais perto.", ["pronto_socorro"]],
    ["Corra para perto do pronto-socorro.", ["pronto_socorro"]],
    ["A UPA fica ao lado, pode ir lá.", ["pronto_socorro"]],
    ["Ligue para o SAMU, que fica perto da clínica.", ["pronto_socorro"]],
    ["Fica ao lado da base do SAMU 192.", ["pronto_socorro"]],
    // A emergencia fica de fora da referencia (o lado conservador).
    ["Estamos perto da emergência, se precisar.", ["pronto_socorro"]],
  ] as const)("o lugar: %s", (rascunho, esperadas) => {
    const pegaram = regrasQuePegam(rascunho).filter(
      (regra) => regra === "pronto_socorro",
    );
    expect(pegaram).toEqual(esperadas);
  });

  it.each([
    "Ligue para o 188.",
    "Disque cento e oitenta e oito.",
    "Ligue agora pro um oito oito.",
    "Se precisar, a ligação para o 188 é gratuita.",
    "Pode telefonar para o 188 a qualquer hora.",
  ])("o 188 com quem liga: %s", (rascunho) => {
    expect(regrasQuePegam(rascunho)).toContain("servico_de_emergencia");
  });

  it.each([
    "Fica na Avenida Brasil, 188.",
    "Sala 188, no primeiro andar.",
    "Ligue para a recepção, ramal 188.",
    "O código da sua reserva é o 188.",
  ])("o 188 que não é o do CVV: %s", (rascunho) => {
    expect(regrasQuePegam(rascunho)).not.toContain("servico_de_emergencia");
  });

  // Revisao de 28/10/2026 (achado 6): a referencia de endereco so passa sem
  // a condicao na mesma frase; com ela, o lugar e destino.
  it.each([
    ["Qualquer coisa, estamos em frente ao Pronto-Socorro.", ["pronto_socorro"]],
    ["Ficamos ao lado da UPA, se precisar.", ["pronto_socorro"]],
    ["Caso precise, ficamos próximos ao Hospital São José.", ["pronto_socorro"]],
    ["Se piorar, a UPA fica ao lado.", ["pronto_socorro"]],
    ["Numa emergência, o hospital fica em frente.", ["pronto_socorro"]],
    // A condicao em outra frase (ou depois do ponto e virgula) nao conta.
    ["Estamos em frente ao Pronto-Socorro.", []],
    [
      "Ficamos em frente ao Hospital Geral; se precisar de algo, é só chamar.",
      [],
    ],
    [
      "Qualquer coisa, me chama aqui. A clínica fica em frente ao Hospital Geral.",
      [],
    ],
    // "Qualquer duvida" nao e condicao de socorro.
    ["Qualquer dúvida, estamos ao lado do Hospital São José.", []],
  ] as const)("o lugar com a condição: %s", (rascunho, esperadas) => {
    expect(
      regrasQuePegam(rascunho).filter((regra) => regra === "pronto_socorro"),
    ).toEqual(esperadas);
  });

  // Revisao de 28/10/2026 (achado 5): a recepcao passa; a conduta com o
  // corpo continua barrada.
  it.each([
    ["Ao chegar, sente-se e aguarde.", []],
    ["Sente-se na recepção e aguarde ser chamada.", []],
    ["Assim que chegar, fique sentada na sala de espera.", []],
    ["Chame alguém para ficar com você no dia, por causa da sedação.", []],
    ["Chame alguém para te levar e buscar no dia.", []],
    ["Sente-se e aguarde a equipe responder.", ["postura_do_corpo"]],
    ["Quando a equipe chegar, fique sentada.", ["postura_do_corpo"]],
    ["Ao chegar em casa, deite-se e descanse.", ["postura_do_corpo"]],
    [
      "Quando chegar em casa, fique deitada com a cabeça elevada.",
      ["postura_do_corpo"],
    ],
    ["Chame alguém para ficar com você.", ["primeiros_socorros"]],
    ["Não fique sozinha.", ["primeiros_socorros"]],
  ] as const)("a recepção e a conduta: %s", (rascunho, esperadas) => {
    expect(
      regrasQuePegam(rascunho).filter(
        (regra) =>
          regra === "postura_do_corpo" || regra === "primeiros_socorros",
      ),
    ).toEqual(esperadas);
  });

  it("nenhum controle da AG6 cai nas regras novas nem no lugar de referência", () => {
    const novas = new Set<string>(REGRAS_NOVAS.map(([regra]) => regra));
    for (const caso of CONTROLES_DA_SAIDA_DA_URGENCIA) {
      const regras = avaliarRegras(caso.rascunho, contextoDo(caso)).achados.map(
        (a) => a.regra,
      );
      expect(
        regras.filter((r) => novas.has(r) || r === "pronto_socorro"),
        caso.id,
      ).toEqual([]);
    }
  });
});

// Revisao de 28/10/2026: os falsos positivos viraram controles, as lacunas
// viraram sinais, a juncao e a legenda entraram na leitura e o filtro
// ganhou a recepcao e a condicao do lugar: a versao do portao e a das
// regras mudaram (o classificador, o verificador e o prompt nao).
describe("bateria AG6: as versões da revisão", () => {
  it("o portão e as regras mudaram desde a última versão conferida da AG6a (edd123c)", () => {
    expect(versaoDoPortao()).toMatch(/^portao-[0-9a-f]{12}$/);
    expect(versaoDasRegras()).toMatch(/^regras-[0-9a-f]{12}$/);
    expect(versaoDoPortao()).not.toBe("portao-1dd4b555a379");
    expect(versaoDasRegras()).not.toBe("regras-179cba548782");
  });
});
