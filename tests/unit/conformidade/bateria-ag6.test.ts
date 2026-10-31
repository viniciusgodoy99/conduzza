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
  FALSOS_POSITIVOS_ACEITOS,
  FALSOS_POSITIVOS_QUE_FICAM,
  MATRIZES_DA_URGENCIA,
  MATRIZES_DO_RR1,
  NAO_REGRESSAO_DA_URGENCIA,
  RAJADAS_DE_URGENCIA,
  RAJADAS_SEM_URGENCIA,
  SAIDAS_DA_URGENCIA_QUE_BLOQUEIAM,
  TENTATIVAS_DE_TRIAGEM,
  VIRARAM_URGENCIA_NA_RR1,
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
      ...NAO_REGRESSAO_DA_URGENCIA,
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

// Revisao de 30/10/2026 (a regra da rodada): NENHUMA emergencia que a
// edd123c pegava fica de fora. A lista (casos-ag6.ts) copia a bateria
// urgente da edd123c, todas as frases da revisao e toda frase das baterias
// que o detector da edd123c marcava; cada uma continua urgencia do mesmo
// tipo, menos as da lista EXPLICITA de falsos positivos aceitos, cada um com
// a area (estetica ou recepcao) e o motivo.
describe("bateria AG6: a não regressão (nenhuma emergência da edd123c fica de fora)", () => {
  const aceitos = new Map(FALSOS_POSITIVOS_ACEITOS.map((f) => [f.id, f]));
  const daRevisao = NAO_REGRESSAO_DA_URGENCIA.filter(
    (frase) => frase.origem === "revisão de 30/10/2026",
  );

  it("a lista é honesta: cada falso positivo aceito aponta para uma frase dela, com a área e o motivo, e a bateria urgente da edd123c está inteira", () => {
    const ids = new Set(NAO_REGRESSAO_DA_URGENCIA.map((frase) => frase.id));
    expect(aceitos.size).toBe(FALSOS_POSITIVOS_ACEITOS.length);
    for (const falso of FALSOS_POSITIVOS_ACEITOS) {
      expect(ids, falso.id).toContain(falso.id);
      // Revisao de 6eae43d: a area "clinica" (a dor do corpo como figura e a
      // condicao contada).
      expect(["estetica", "recepcao", "clinica"], falso.id).toContain(
        falso.area,
      );
      expect(falso.motivo.trim().length, falso.id).toBeGreaterThan(10);
      expect(falso.motivo, falso.id).not.toMatch(/[–—]/);
    }
    // A bateria urgente da edd123c (AG6-U01 a AG6-U54), inteira e sem
    // nenhuma frase aceita como falso positivo.
    const daEdd = NAO_REGRESSAO_DA_URGENCIA.filter((frase) =>
      frase.origem.startsWith("edd123c "),
    );
    expect(daEdd).toHaveLength(54);
    for (const frase of daEdd) {
      expect(aceitos.has(frase.id), frase.id).toBe(false);
    }
    // Todas as frases do paciente da revisao (achados 1, 2, 5 e 6; as do
    // filtro, 3 e 4, estao nas saidas AG6-S75 a AG6-S89).
    expect(daRevisao).toHaveLength(39);
  });

  it.each(
    NAO_REGRESSAO_DA_URGENCIA.filter((frase) => !aceitos.has(frase.id)).map(
      (frase) => [frase.id, frase] as const,
    ),
  )(
    "%s continua urgência do mesmo tipo e o primeiro gatilho do portão",
    (_id, frase) => {
      expect(detectarUrgencia(frase.textos)?.tipo).toBe(frase.tipo);
      expect(
        detectarGatilhosDeEntrada({
          mensagens: frase.textos.map((texto) => ({ tipo: "texto", texto })),
        })[0],
      ).toBe("urgencia");
    },
  );

  it.each(FALSOS_POSITIVOS_ACEITOS.map((falso) => [falso.id, falso] as const))(
    "%s é falso positivo aceito: não é urgência",
    (id, falso) => {
      const frase = NAO_REGRESSAO_DA_URGENCIA.find((f) => f.id === id);
      expect(frase, falso.motivo).toBeDefined();
      expect(detectarUrgencia(frase?.textos ?? [])).toBeNull();
    },
  );

  it.each(
    FALSOS_POSITIVOS_QUE_FICAM.map((falso) => [falso.id, falso] as const),
  )(
    "%s é falso positivo que FICA como urgência (o lado seguro)",
    (id, falso) => {
      const caso = CASOS_DE_URGENCIA.find((c) => c.id === id);
      expect(caso, falso.motivo).toBeDefined();
      expect(detectarUrgencia([caso?.texto ?? ""])).not.toBeNull();
    },
  );
});

// Revisao de 6eae43d (a correcao da lista de urgencia, sobre a revisao de
// motor e conformidade): A1, as lacunas que atravessavam o portao inteiro
// (o risco de vida, a visao, o AVC, o envenenamento), agora sinais, cada um
// com a frase na nao regressao e os controles; M1, o procedimento com a boca
// ou o rosto torto E outro sinal de AVC, que a edd123c marcava; M2, os
// falsos positivos da estetica, da dor, da pergunta e da agenda, que a
// edd123c marcava e entram na lista de aceitos.
describe("bateria AG6: a revisão de 6eae43d (A1, M1 e M2)", () => {
  const aceitos = new Set(FALSOS_POSITIVOS_ACEITOS.map((f) => f.id));
  const daRevisao = (parte: string) =>
    NAO_REGRESSAO_DA_URGENCIA.filter(
      (frase) => frase.origem === `revisão de 6eae43d (${parte})`,
    );

  it("A1: cada sinal novo tem frase na não regressão, e nenhuma delas é falso positivo aceito", () => {
    const sinais = new Set(
      daRevisao("A1").map((frase) => detectarUrgencia(frase.textos)?.sinal),
    );
    for (const sinal of [
      "enforcar",
      "pular_ou_se_jogar",
      "remedio_demais",
      "cortar_os_pulsos",
      "automutilacao",
      "carta_de_despedida",
      "sem_motivo_pra_viver",
      "nao_ter_nascido",
      "perdendo_a_visao",
      "nao_enxerga",
      "nao_respira",
      "nao_responde",
      "familia_nao_responde",
      "nao_mexe_o_braco",
      "braco_ou_perna_fraco",
      "dor_que_vai_pro_braco",
      "engoliu_veneno",
    ]) {
      expect(sinais, sinal).toContain(sinal);
      expect(
        SINAIS_DE_EMERGENCIA.some((s) => s.nome === sinal),
        sinal,
      ).toBe(true);
    }
    // As 20 frases do pedido e as tres do que faltava (a familia, a visao
    // e a vista que escurece ao levantar).
    expect(daRevisao("A1")).toHaveLength(23);
    for (const frase of daRevisao("A1")) {
      expect(aceitos.has(frase.id), frase.id).toBe(false);
    }
  });

  it("M1: o procedimento com a boca ou o rosto torto e outro sinal de AVC continua urgência (nenhuma aceita)", () => {
    expect(daRevisao("M1")).toHaveLength(11);
    for (const frase of daRevisao("M1")) {
      expect(aceitos.has(frase.id), frase.id).toBe(false);
      expect(detectarUrgencia(frase.textos)?.sinal, frase.id).toMatch(
        /^(?:boca_torta|rosto_torto)$/,
      );
    }
  });

  it("os três sinais do pedido do coordenador (overdose, ferimento grave e a complicação do preenchimento) têm frases na não regressão, nenhuma aceita", () => {
    const frases = daRevisao("coordenador");
    expect(frases).toHaveLength(17);
    const sinais = new Set(
      frases.map((frase) => detectarUrgencia(frase.textos)?.sinal),
    );
    for (const sinal of [
      "overdose",
      "ferimento_grave",
      "oclusao_do_preenchimento",
    ]) {
      expect(sinais, sinal).toContain(sinal);
    }
    for (const frase of frases) {
      expect(aceitos.has(frase.id), frase.id).toBe(false);
    }
  });

  it("M2: toda frase que a edd123c marcava e deixou de marcar está nos aceitos, com a área e o motivo", () => {
    expect(daRevisao("M2")).toHaveLength(19);
    // Revisao RR1 (a politica nova das excecoes): seis voltaram a ser
    // urgencia (o "ta", o "entortou", o "hoje" e a agenda em outra frase) e
    // sairam dos aceitos.
    const viraramNaRR1 = new Set([
      "AG6-NR240",
      "AG6-NR241",
      "AG6-NR256",
      "AG6-NR257",
      "AG6-NR289",
      "AG6-NR291",
    ]);
    for (const frase of [
      ...daRevisao("M2"),
      ...daRevisao("corpus do revisor"),
    ]) {
      if (viraramNaRR1.has(frase.id)) {
        expect(aceitos.has(frase.id), frase.id).toBe(false);
        expect(detectarUrgencia(frase.textos)?.tipo, frase.id).toBe(frase.tipo);
        continue;
      }
      expect(aceitos.has(frase.id), frase.id).toBe(true);
      expect(detectarUrgencia(frase.textos), frase.id).toBeNull();
    }
  });
});

// Revisao R2 de d1a15f6 (a segunda rodada da correcao da lista): A1, a
// excecao estetica so com o objeto e nunca com o agora, o lado, a queda ou a
// terceira pessoa; A3, as grafias do risco de vida e os sinais novos para o
// RT; M2, o preenchimento antigo, a mancha sozinha e a historia de outra
// pessoa; M4, a ameaca de verdade; M5, o recipiente nos dois generos. A trava
// compara a frase exata: por isso as matrizes geradas (casos-ag6.ts,
// MATRIZES_DA_URGENCIA; urgencia-matrizes.test.ts) e as frases do revisor.
describe("bateria AG6: a revisão R2 de d1a15f6 (A1, A3, M2, M4 e M5)", () => {
  const aceitos = new Set(FALSOS_POSITIVOS_ACEITOS.map((f) => f.id));
  const daR2 = NAO_REGRESSAO_DA_URGENCIA.filter((frase) =>
    frase.origem.startsWith("revisão R2 de d1a15f6"),
  );

  it("toda frase do revisor que a edd123c marcava está na não regressão; só os alarmes falsos dele deixam de ser urgência, cada um com a área e o motivo", () => {
    expect(daR2).toHaveLength(111);
    const aceitasDaR2 = daR2.filter((frase) => aceitos.has(frase.id));
    // Revisao RR1: 7 das 31 aceitas voltaram a ser urgencia (AG6-NR360,
    // NR366, NR409, NR412, NR413, NR416 e NR420: a agenda em outra frase, a
    // terceira pessoa, o "ta" e o procedimento, que deixou de ser excecao).
    expect(aceitasDaR2).toHaveLength(24);
    for (const frase of aceitasDaR2) {
      expect(detectarUrgencia(frase.textos), frase.id).toBeNull();
    }
    for (const frase of daR2.filter((f) => !aceitos.has(f.id))) {
      expect(detectarUrgencia(frase.textos)?.tipo, frase.id).toBe(frase.tipo);
    }
  });

  it("A1: o rosto da outra pessoa voltou a ser urgência (o AG6-NR305 saiu dos aceitos)", () => {
    expect(aceitos.has("AG6-NR305")).toBe(false);
    const frase = NAO_REGRESSAO_DA_URGENCIA.find((f) => f.id === "AG6-NR305");
    expect(detectarUrgencia(frase?.textos ?? [])?.sinal).toBe(
      "rosto_caido_de_outra_pessoa",
    );
  });

  it("A3: cada sinal novo tem caso na bateria e é o tipo esperado", () => {
    const sinais = new Map(
      CASOS_DE_URGENCIA.map((caso) => [
        detectarUrgencia([caso.texto])?.sinal,
        caso.tipo,
      ]),
    );
    for (const [sinal, tipo] of [
      ["engasgo", "fisica"],
      ["pilha_engolida", "fisica"],
      ["atropelado", "fisica"],
      ["picada_de_animal", "fisica"],
      ["gas_inalado", "fisica"],
      ["vazamento_de_gas", "fisica"],
      ["gestante_sangrando", "fisica"],
      ["bebe_parou_de_mexer", "fisica"],
      ["vomito_com_sangue", "fisica"],
      ["labios_roxos", "fisica"],
      ["confusao_mental", "fisica"],
      ["mancha_depois_do_preenchimento", "fisica"],
      ["morrer_seria_alivio", "risco_de_vida"],
      ["sumir", "risco_de_vida"],
      ["melhor_sem_mim", "risco_de_vida"],
      ["corda", "risco_de_vida"],
      ["ameaca_de_morte", "risco_de_vida"],
    ] as const) {
      expect(sinais.get(sinal), sinal).toBe(tipo);
    }
  });

  it("as matrizes geradas entram na bateria (e na prova de honestidade)", () => {
    const frases = Object.values(MATRIZES_DA_URGENCIA).flat();
    expect(frases.length).toBeGreaterThanOrEqual(700);
    expect(MATRIZES_DA_URGENCIA.boca_e_rosto_x_final_generico).toHaveLength(
      100,
    );
  });
});

// Revisao RR1 (a politica nova das excecoes, decisao do coordenador): a
// excecao so vale com a PROVA POSITIVA (o estado de sempre, a pergunta pura,
// a figura com o objeto dito, a agenda sem sintoma), so na oracao ou na
// frase do sinal, e qualquer marca de relato atual ou de evento recente a
// desfaz (o tempo recente, a terceira pessoa, o pedido de ajuda, o relato
// que retoma o sinal, a mudanca e o estado de agora). As matrizes do revisor
// (MATRIZES_DO_RR1) estao em urgencia-matrizes.test.ts.
describe("bateria AG6: a revisão RR1 (a política nova das exceções)", () => {
  const aceitos = new Set(FALSOS_POSITIVOS_ACEITOS.map((f) => f.id));
  const daRR1 = NAO_REGRESSAO_DA_URGENCIA.filter(
    (frase) => frase.origem === "revisão RR1",
  );

  it("toda frase do revisor que a edd123c marcava está na não regressão; só as de prova positiva deixam de ser urgência, cada uma com a área e o motivo", () => {
    expect(daRR1).toHaveLength(140);
    const aceitas = daRR1.filter((frase) => aceitos.has(frase.id));
    expect(aceitas).toHaveLength(27);
    for (const frase of aceitas) {
      expect(detectarUrgencia(frase.textos), frase.id).toBeNull();
    }
    for (const frase of daRR1.filter((f) => !aceitos.has(f.id))) {
      expect(detectarUrgencia(frase.textos)?.tipo, frase.id).toBe(frase.tipo);
    }
  });

  it("os 29 aceitos de antes que voltaram a ser urgência saíram da lista, e cada um é urgência do tipo da edd123c", () => {
    const sairam = [
      "AG6-NR074",
      "AG6-NR077",
      "AG6-NR126",
      "AG6-NR127",
      "AG6-NR135",
      "AG6-NR147",
      "AG6-NR161",
      "AG6-NR162",
      "AG6-NR163",
      "AG6-NR172",
      "AG6-NR240",
      "AG6-NR241",
      "AG6-NR256",
      "AG6-NR257",
      "AG6-NR258",
      "AG6-NR259",
      "AG6-NR289",
      "AG6-NR291",
      "AG6-NR302",
      "AG6-NR303",
      "AG6-NR304",
      "AG6-NR314",
      "AG6-NR360",
      "AG6-NR366",
      "AG6-NR409",
      "AG6-NR412",
      "AG6-NR413",
      "AG6-NR416",
      "AG6-NR420",
    ];
    expect(new Set(sairam).size).toBe(29);
    for (const id of sairam) {
      expect(aceitos.has(id), id).toBe(false);
      const frase = NAO_REGRESSAO_DA_URGENCIA.find((f) => f.id === id);
      expect(frase, id).toBeDefined();
      expect(detectarUrgencia(frase?.textos ?? [])?.tipo, id).toBe(frase?.tipo);
    }
  });

  it.each(
    VIRARAM_URGENCIA_NA_RR1.map((caso) => [caso.id, caso.antes, caso] as const),
  )("%s (antes %s) virou urgência, com o motivo", (_id, _antes, caso) => {
    expect(detectarUrgencia(caso.textos)).not.toBeNull();
    expect(
      detectarGatilhosDeEntrada({
        mensagens: caso.textos.map((texto) => ({ tipo: "texto", texto })),
      })[0],
    ).toBe("urgencia");
    expect(caso.motivo.trim().length).toBeGreaterThan(10);
    expect(caso.motivo).not.toMatch(/[–—]/);
  });

  it("as seis emergências que não escalavam por nada são urgência, e os sinais novos têm caso na bateria", () => {
    const seis = MATRIZES_DO_RR1.seis_que_nao_escalavam ?? [];
    expect(seis).toHaveLength(6);
    for (const textos of seis) {
      expect(detectarUrgencia(textos), textos.join(" ")).not.toBeNull();
    }
    const sinais = new Map(
      CASOS_DE_URGENCIA.map((caso) => [
        detectarUrgencia([caso.texto])?.sinal,
        caso.tipo,
      ]),
    );
    for (const sinal of ["tomar_veneno", "ultimo_dia"]) {
      expect(sinais.get(sinal), sinal).toBe("risco_de_vida");
    }
  });
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
    m.tipo === "texto"
      ? m.texto
      : m.tipo === "audio"
        ? null
        : (m.legenda ?? null),
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
// o lugar citado como referencia de endereco so passa com o texto exato do
// ponto de referencia que a ferramenta trouxe no turno (revisao de d1a15f6,
// A2; o caso com a ferramenta esta na bateria-ag6b). Sem ele, barra como no
// main.
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
    // Sem a ferramenta no turno, o lugar como referencia barra como no main
    // (revisao de d1a15f6, A2)...
    ["A clínica fica perto da UPA.", ["pronto_socorro"]],
    ["Ficamos ao lado do Pronto Atendimento 24h.", ["pronto_socorro"]],
    ["Em frente ao Hospital Geral.", ["pronto_socorro"]],
    ["Fica próximo ao posto de saúde do bairro.", ["pronto_socorro"]],
    // ...e o lugar como destino tambem.
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
    [
      "Qualquer coisa, estamos em frente ao Pronto-Socorro.",
      ["pronto_socorro"],
    ],
    ["Ficamos ao lado da UPA, se precisar.", ["pronto_socorro"]],
    [
      "Caso precise, ficamos próximos ao Hospital São José.",
      ["pronto_socorro"],
    ],
    ["Se piorar, a UPA fica ao lado.", ["pronto_socorro"]],
    ["Numa emergência, o hospital fica em frente.", ["pronto_socorro"]],
    // Sem a ferramenta, a condicao em outra frase tambem barra (revisao de
    // d1a15f6, A2: como no main).
    ["Estamos em frente ao Pronto-Socorro.", ["pronto_socorro"]],
    [
      "Ficamos em frente ao Hospital Geral; se precisar de algo, é só chamar.",
      ["pronto_socorro"],
    ],
    [
      "Qualquer coisa, me chama aqui. A clínica fica em frente ao Hospital Geral.",
      ["pronto_socorro"],
    ],
    // "Qualquer duvida" nao e condicao de socorro.
    ["Qualquer dúvida, estamos ao lado do Hospital São José.", []],
    // Revisao de 30/10/2026 (achado 4): a ida ao lugar depois dele, ate o
    // ponto, tambem o torna destino (o main barra todas).
    ["Ficamos ao lado da UPA, vá direto para lá.", ["pronto_socorro"]],
    ["Estamos em frente ao hospital, corra para lá.", ["pronto_socorro"]],
    ["Ficamos perto da UPA, pode ir lá agora.", ["pronto_socorro"]],
    ["Fica perto do pronto-socorro, vá lá.", ["pronto_socorro"]],
    [
      "A clínica fica em frente ao Pronto-Socorro Municipal, procure-o.",
      ["pronto_socorro"],
    ],
    ["Ficamos ao lado da UPA, lá eles te atendem.", ["pronto_socorro"]],
    // O "vai" de futuro, o "segue" do endereco, o "procure a recepcao" e a
    // ida em outra frase nao tornam o lugar destino.
    ["Ficamos ao lado do Hospital São José, você vai ver a placa azul.", []],
    ["Ficamos ao lado do Hospital Geral, segue a localização.", []],
    [
      "A clínica fica em frente ao Hospital Geral, procure a recepção no térreo.",
      ["pronto_socorro"],
    ],
    ["Ficamos ao lado do Hospital Geral. Pode vir de ônibus até lá.", []],
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
    // Revisao de 30/10/2026 (achado 3): as excecoes da recepcao so valem
    // para ficar sentada e para o "sente-se"; o resto barra como na edd123c.
    ["Fique deitada e aguarde o atendimento.", ["postura_do_corpo"]],
    ["Fique de lado e aguarde o atendimento.", ["postura_do_corpo"]],
    ["Mantenha-se deitada e aguarde o atendimento.", ["postura_do_corpo"]],
    ["Quando chegar, fique deitada.", ["postura_do_corpo"]],
    ["Ao entrar, fique de costas.", ["postura_do_corpo"]],
    ["Quando chegar, fique imóvel.", ["postura_do_corpo"]],
    ["Ao chegar, deita-se e aguarde o atendimento.", ["postura_do_corpo"]],
    ["Fique deitada na recepção.", ["postura_do_corpo"]],
    ["Não fique sozinha depois do procedimento.", ["primeiros_socorros"]],
    ["Fique sentada e aguarde o atendimento.", []],
    ["Quando chegar, fique sentada que já te chamamos.", []],
    ["Não fique sozinha no dia do procedimento: venha acompanhada.", []],
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

  // Revisao de 30/10/2026: a lista de urgencia e o lexico do sintoma mudaram
  // (o portao) e a postura, os primeiros socorros e o lugar de referencia
  // tambem (as regras). As versoes da 2a revisao (2ca2097) ficaram para tras.
  it("o portão e as regras mudaram desde a 2a revisão (2ca2097)", () => {
    expect(versaoDoPortao()).not.toBe("portao-39dcded69204");
    expect(versaoDasRegras()).not.toBe("regras-342236c82294");
  });

  // Revisao R2 de d1a15f6: a lista de urgencia mudou (A1, A3, M2, M4, M5 e
  // a leitura linear, B5): a versao do portao da d1a15f6 ficou para tras.
  it("o portão mudou desde a d1a15f6 (revisão R2)", () => {
    expect(versaoDoPortao()).not.toBe("portao-04348f7f6108");
  });

  // Revisao RR1: a lista de urgencia mudou (a politica nova das excecoes, os
  // sinais novos e os alargados): a versao do portao da 88e9560 ficou para
  // tras.
  it("o portão mudou desde a 88e9560 (revisão RR1)", () => {
    expect(versaoDoPortao()).not.toBe("portao-4e98a801c92c");
  });
});
