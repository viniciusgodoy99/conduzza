import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { montarCatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  executarTurnoDoAgente,
  PASSO_DA_URGENCIA,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import { NUNCA_DA_MIDIA, TEXTO_FIXO_DO_AGENTE } from "@/lib/agente/prompt";
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
import { detectarGatilhosDeEntrada } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";
import {
  contextoDo,
  type CasoDeControle,
  type CasoDeSaida,
} from "@/tests/fixtures/ia/conformidade/casos";
import {
  BARRADOS_DE_PROPOSITO_NA_REVISAO_FINAL,
  CONTEXTO_DO_EXAME_DA_REVISAO_R2,
  CONTROLES_DA_MIDIA,
  CONTROLES_DA_REVISAO_FINAL,
  CONTROLES_DA_TRIAGEM_DA_REVISAO_R2,
  CONTROLES_DO_RESULTADO,
  CONTROLES_DO_RESULTADO_DA_REVISAO_R2,
  ENTRADAS_POR_AUDIO,
  FALAS_DO_PEDIDO_QUE_ESCALAM,
  LEGENDAS_DO_PEDIDO_QUE_ESCALAM,
  LEGENDAS_QUE_ESCALAM,
  LEGENDAS_QUE_PASSAM,
  LUGAR_SEM_A_FERRAMENTA_QUE_BLOQUEIA,
  PONTO_DE_REFERENCIA_COM_A_FERRAMENTA_QUE_BLOQUEIA,
  RASCUNHOS_DO_LUGAR_DA_REVISAO_R2,
  SAIDAS_DA_MIDIA_QUE_BLOQUEIAM,
  SAIDAS_DA_TRIAGEM_DA_REVISAO_R2,
  SAIDAS_DO_LUGAR_QUE_BLOQUEIAM,
  SAIDAS_DO_PONTO_DE_REFERENCIA_QUE_BLOQUEIAM,
  SAIDAS_DO_RESULTADO_DA_REVISAO_R2,
  SONDAS_DO_EXAME_DA_REVISAO_R2,
  TELEFONE_COM_O_188,
} from "@/tests/fixtures/ia/conformidade/casos-ag6b";

import {
  agenteQueResponde,
  AUDIO,
  audioNoLaco,
  FOTO,
  fotoNoLaco,
  lida,
  portaFalsa,
  transcrita,
} from "../agente/ag6b-contrato";

// Bateria do CFM da AG6b (no prebuild; desenho 8.2): a IA nunca interpreta
// exame, laudo, receita, foto do corpo nem o que a pessoa falou no audio.
//  - o audio que traz sintoma, duvida clinica, remedio, resultado,
//    urgencia ou menor de idade escala como o escrito (o laco com a porta e
//    o LLM FALSOS: o agente nunca e chamado);
//  - a legenda que pede avaliacao escala ANTES do leitor (o arquivo nunca
//    sai);
//  - o rascunho que interpreta o arquivo ou o audio bloqueia (pela regra, ou
//    pelo verificador quando a regra nao pega: soModelo, a D34 mede);
//  - a recepcao com o pedido e com o audio passa (os controles).
// A IA nunca recebe o arquivo (guarda-openai-midia.test.ts) e nunca pede
// foto, audio, documento ou arquivo (o "Nunca" do texto fixo). Nenhum teste
// chama a OpenAI.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const PROC = "11111111-1111-4111-8111-111111111111";
const PROF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATALOGO = montarCatalogoDoAgente({
  procedimentos: [{ id: PROC, name: "Hemograma", active: true, bookable_by_ai: true }],
  vinculos: [
    {
      procedure_id: PROC,
      professional_id: PROF,
      insurance_id: null,
      price_cents: 4_000,
      covered_by_insurance: false,
      bookable_by_ai: true,
      active: true,
    },
  ],
  profissionais: [{ id: PROF, name: "Dra. Helena", active: true }],
  convenios: [],
});
const USO = { tokensEntrada: 600, tokensSaida: 10, tokensCacheLidos: 0, tokensCacheGravados: 0 };

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

function classificadorQueDiz(
  gatilho: "nenhum" | "assunto_clinico",
): ReturnType<typeof vi.fn<ClassificadorDeEntrada>> {
  const resultado: ResultadoDoClassificador = {
    tipo: "classificacao",
    classificacao: { gatilhos: [gatilho], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: USO,
  };
  return vi.fn<ClassificadorDeEntrada>(async () => resultado);
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function turnoComMidia(
  mensagens: MensagemDaConversa[],
  porta: ReturnType<typeof portaFalsa>["porta"],
  classificador: ClassificadorDeEntrada = classificadorQueDiz("nenhum"),
) {
  const agente = agenteQueResponde("Claro, posso ajudar.");
  const base = configPadraoDoAgente();
  const r = await executarTurnoDoAgente({
    cliente: agente.cliente,
    modelo: "gpt-6-luna",
    clinicId: CLINICA,
    identificadorDeSeguranca: "a".repeat(64),
    config: {
      ...base,
      habilidades: { ...base.habilidades, ler_audio: true, ler_imagem_e_documento: true },
    },
    catalogo: CATALOGO,
    mensagens,
    agoraMs: Date.UTC(2026, 9, 30, 15, 0),
    fuso: "America/Fortaleza",
    verificador: verificadorQueSempreAprova(),
    classificador,
    midia: porta,
  });
  return { r, agente };
}

describe("bateria AG6b: os ids e a cobertura", () => {
  it("ids unicos; cada grupo do desenho tem caso", () => {
    const ids = [
      ...ENTRADAS_POR_AUDIO,
      ...LEGENDAS_QUE_ESCALAM,
      ...SAIDAS_DA_MIDIA_QUE_BLOQUEIAM,
      ...CONTROLES_DA_MIDIA,
      ...LEGENDAS_QUE_PASSAM,
      ...LEGENDAS_DO_PEDIDO_QUE_ESCALAM,
      ...FALAS_DO_PEDIDO_QUE_ESCALAM,
      ...SONDAS_DO_EXAME_DA_REVISAO_R2,
      ...CONTEXTO_DO_EXAME_DA_REVISAO_R2,
      ...SAIDAS_DO_LUGAR_QUE_BLOQUEIAM,
      ...LUGAR_SEM_A_FERRAMENTA_QUE_BLOQUEIA,
      ...RASCUNHOS_DO_LUGAR_DA_REVISAO_R2,
      ...PONTO_DE_REFERENCIA_COM_A_FERRAMENTA_QUE_BLOQUEIA,
      ...SAIDAS_DO_PONTO_DE_REFERENCIA_QUE_BLOQUEIAM,
      ...CONTROLES_DO_RESULTADO,
      ...SAIDAS_DO_RESULTADO_DA_REVISAO_R2,
      ...CONTROLES_DO_RESULTADO_DA_REVISAO_R2,
      ...SAIDAS_DA_TRIAGEM_DA_REVISAO_R2,
      ...CONTROLES_DA_TRIAGEM_DA_REVISAO_R2,
      ...CONTROLES_DA_REVISAO_FINAL,
      ...BARRADOS_DE_PROPOSITO_NA_REVISAO_FINAL,
    ].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Revisao R2 de d1a15f6: os numeros da revisao.
    expect(RASCUNHOS_DO_LUGAR_DA_REVISAO_R2).toHaveLength(32);
    expect(SONDAS_DO_EXAME_DA_REVISAO_R2).toHaveLength(27);
    expect(CONTEXTO_DO_EXAME_DA_REVISAO_R2).toHaveLength(7);
    expect(ENTRADAS_POR_AUDIO.map((c) => c.gatilho)).toEqual(
      expect.arrayContaining(["sintoma", "assunto_clinico", "urgencia", "menor_de_idade"]),
    );
    expect(SAIDAS_DA_MIDIA_QUE_BLOQUEIAM.length).toBeGreaterThanOrEqual(10);
    expect(CONTROLES_DA_MIDIA.length).toBeGreaterThanOrEqual(5);
  });
});

describe("bateria AG6b: o que a pessoa fala no audio escala como o escrito", () => {
  it.each(ENTRADAS_POR_AUDIO.map((c) => [c.id, c] as const))(
    "%s: o portao acha o gatilho na transcricao",
    (_id, caso) => {
      expect(
        detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto: caso.fala }] })[0],
      ).toBe(caso.gatilho);
    },
  );

  it.each(ENTRADAS_POR_AUDIO.map((c) => [c.id, c] as const))(
    "%s: no laco, a frase de sempre; o agente nunca e chamado",
    async (_id, caso) => {
      const { porta, transcrever } = portaFalsa({
        transcricao: { [AUDIO]: transcrita(caso.fala) },
      });
      const { r, agente } = await turnoComMidia([audioNoLaco()], porta);
      expect(transcrever).toHaveBeenCalledTimes(1);
      expect(r.tipo).toBe("frase_fixa");
      expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
      expect(r.desfecho).toMatchObject({ tipo: "escalou", origem: "portao" });
      if (caso.gatilho === "urgencia") {
        expect(r.desfecho).toMatchObject({ motivo: "urgencia" });
        expect(r.trilha.map((p) => p.texto)).toContain(PASSO_DA_URGENCIA);
      }
      expect(agente.create).not.toHaveBeenCalled();
    },
  );
});

describe("bateria AG6b: a legenda que pede avaliacao escala antes do leitor", () => {
  it.each(LEGENDAS_QUE_ESCALAM.map((c) => [c.id, c] as const))(
    "%s: o arquivo nunca sai",
    async (_id, caso) => {
      const portao = detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: caso.legenda }],
      });
      if (caso.soModelo) {
        expect(portao).toEqual([]);
      } else {
        expect(portao[0]).toBe(caso.gatilho);
      }
      const { porta, preparar, ler } = portaFalsa();
      const { r, agente } = await turnoComMidia(
        [fotoNoLaco(FOTO, caso.legenda)],
        porta,
        classificadorQueDiz(caso.soModelo ? "assunto_clinico" : "nenhum"),
      );
      expect(r.desfecho).toMatchObject({
        tipo: "escalou",
        motivo: caso.gatilho,
        origem: caso.soModelo ? "classificador" : "portao",
      });
      expect(preparar).not.toHaveBeenCalled();
      expect(ler).not.toHaveBeenCalled();
      expect(agente.create).not.toHaveBeenCalled();
    },
  );
});

describe("bateria AG6b: a IA nunca interpreta o arquivo nem o audio", () => {
  const deterministicos = SAIDAS_DA_MIDIA_QUE_BLOQUEIAM.filter((c) => !c.soModelo);
  const soModelo = SAIDAS_DA_MIDIA_QUE_BLOQUEIAM.filter((c) => c.soModelo);

  it.each(deterministicos.map((c) => [c.id, c] as const))(
    "%s bloqueia pela regra, sem chamar o verificador",
    async (_id, caso) => {
      expect(avaliarRegras(caso.rascunho, contextoDo(caso)).categorias).toContain(
        caso.categoria,
      );
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

  it.each(soModelo.map((c) => [c.id, c] as const))(
    "%s: a regra nao pega; o verificador bloqueia na camada do modelo",
    async (_id, caso) => {
      expect(avaliarRegras(caso.rascunho, contextoDo(caso)).categorias).toEqual([]);
      const categoria = CATEGORIAS_DO_VERIFICADOR.find((c) => c === caso.categoria);
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

  it.each(CONTROLES_DA_MIDIA.map((c) => [c.id, c] as const))(
    "controle %s: a recepcao com o pedido e o audio passa nas regras e no filtro",
    async (_id, caso) => {
      expect(avaliarRegras(caso.rascunho, contextoDo(caso)).achados).toEqual([]);
      const decisao = await filtrarSaida({
        rascunho: caso.rascunho,
        contexto: contextoDo(caso),
        verificador: verificadorQueSempreAprova(),
      });
      expect(decisao.aprovado).toBe(true);
    },
  );

  it("a IA nunca pede foto, audio, documento ou arquivo (o 'Nunca' do texto fixo)", () => {
    expect(TEXTO_FIXO_DO_AGENTE).toContain(NUNCA_DA_MIDIA);
    expect(NUNCA_DA_MIDIA).toBe("- peça foto, áudio, documento ou arquivo;");
  });
});

// ---------------------------------------------------------------------------
// 3a rodada da AG6b (revisao de 6eae43d, 30/10/2026)
// ---------------------------------------------------------------------------

describe("bateria AG6b: a legenda do pedido que já passava chega ao leitor", () => {
  it.each(LEGENDAS_QUE_PASSAM.map((c) => [c.id, c] as const))(
    "%s: o portao deixa passar",
    (_id, caso) => {
      expect(
        detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto: caso.texto }] }),
      ).toEqual([]);
    },
  );

  it.each(LEGENDAS_QUE_PASSAM.map((c) => [c.id, c] as const))(
    "%s: no laco, a foto vai ao leitor e o agente responde",
    async (_id, caso) => {
      const { porta, preparar, ler } = portaFalsa({
        leitura: {
          [FOTO]: lida({ tipo: "pedido_de_exame_ou_procedimento", procedimentos: [PROC] }),
        },
      });
      const { r, agente } = await turnoComMidia([fotoNoLaco(FOTO, caso.texto)], porta);
      expect(preparar).toHaveBeenCalledTimes(1);
      expect(ler).toHaveBeenCalledTimes(1);
      expect(agente.create).toHaveBeenCalled();
      expect(r.tipo).toBe("resposta");
    },
  );

});

// Revisao R2 de d1a15f6 (M1): as trocas do exame na legenda da 3a rodada
// (item 6) foram desfeitas. A legenda e a fala do pedido com o demonstrativo,
// a marcacao, o convenio, o pedido ou so o exame escalam antes do leitor,
// como no main; a troca na recepcao e PROPOSTA para o dono e para a D34.
describe("bateria AG6b (revisão R2): o exame na legenda volta a escalar (M1)", () => {
  it.each(LEGENDAS_DO_PEDIDO_QUE_ESCALAM.map((c) => [c.id, c] as const))(
    "%s: o portao escala com o assunto clinico e o arquivo nunca sai",
    async (_id, caso) => {
      expect(
        detectarGatilhosDeEntrada({
          mensagens: [{ tipo: "texto", texto: caso.texto }],
        })[0],
      ).toBe("assunto_clinico");
      const { porta, preparar, ler } = portaFalsa();
      const { r, agente } = await turnoComMidia([fotoNoLaco(FOTO, caso.texto)], porta);
      expect(r.desfecho).toMatchObject({
        tipo: "escalou",
        motivo: "assunto_clinico",
        origem: "portao",
      });
      expect(preparar).not.toHaveBeenCalled();
      expect(ler).not.toHaveBeenCalled();
      expect(agente.create).not.toHaveBeenCalled();
    },
  );

  it.each(FALAS_DO_PEDIDO_QUE_ESCALAM.map((c) => [c.id, c] as const))(
    "%s: a fala sobre o pedido escala como o escrito; o agente nunca e chamado",
    async (_id, caso) => {
      expect(
        detectarGatilhosDeEntrada({
          mensagens: [{ tipo: "texto", texto: caso.texto }],
        })[0],
      ).toBe("assunto_clinico");
      const { porta, transcrever } = portaFalsa({
        transcricao: { [AUDIO]: transcrita(caso.texto) },
      });
      const { r, agente } = await turnoComMidia([audioNoLaco()], porta);
      expect(transcrever).toHaveBeenCalledTimes(1);
      expect(r.tipo).toBe("frase_fixa");
      expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
      expect(r.desfecho).toMatchObject({ tipo: "escalou", origem: "portao" });
      expect(agente.create).not.toHaveBeenCalled();
    },
  );

  it.each(SONDAS_DO_EXAME_DA_REVISAO_R2.map((c) => [c.id, c] as const))(
    "%s: a sonda clinica do revisor escala (como no main)",
    (_id, caso) => {
      expect(
        detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto: caso.texto }] }),
      ).toContain("assunto_clinico");
    },
  );

  it.each(CONTEXTO_DO_EXAME_DA_REVISAO_R2.map((c) => [c.id, c] as const))(
    "%s: o contexto clinico do paciente barra o rascunho (como no main)",
    async (_id, caso) => {
      const resultado = avaliarRegras(caso.rascunho, contextoDo(caso));
      expect(resultado.categorias).toContain("orientacao_clinica");
      expect(resultado.achados.map((a) => a.regra)).toContain(
        "contexto:assunto_clinico",
      );
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

  it("a pergunta de preco com o artigo continua passando, e a finalidade a mantem clinica", () => {
    const portao = (texto: string) =>
      detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });
    expect(portao("quanto custa o exame?")).toEqual([]);
    expect(portao("pra que serve o exame? quanto custa?")[0]).toBe(
      "assunto_clinico",
    );
  });
});

describe("bateria AG6b (3a rodada): o resultado comentado pela IA tem regra", () => {
  const DO_RESULTADO = new Set([
    "AG6B-S02",
    "AG6B-S03",
    "AG6B-S11",
    "AG6B-S12",
    "AG6B-S13",
    "AG6B-S14",
    "AG6B-S15",
    "AG6B-S16",
    "AG6B-S17",
    "AG6B-S18",
  ]);

  it.each(
    SAIDAS_DA_MIDIA_QUE_BLOQUEIAM.filter((c) => DO_RESULTADO.has(c.id)).map(
      (c) => [c.id, c] as const,
    ),
  )("%s: a regra do resultado comentado pega", (_id, caso) => {
    const regras = avaliarRegras(caso.rascunho, contextoDo(caso)).achados.map(
      (a) => a.regra,
    );
    expect(regras).toContain(
      caso.categoria === "diagnostico"
        ? "resultado_de_exame_alterado"
        : "resultado_de_exame_normal",
    );
  });

  it.each(CONTROLES_DO_RESULTADO.map((c) => [c.id, c] as const))(
    "controle %s: o que a IA pode dizer do exame passa nas regras e no filtro",
    async (_id, caso) => {
      expect(avaliarRegras(caso.rascunho, contextoDo(caso)).achados).toEqual([]);
      const decisao = await filtrarSaida({
        rascunho: caso.rascunho,
        contexto: contextoDo(caso),
        verificador: verificadorQueSempreAprova(),
      });
      expect(decisao.aprovado).toBe(true);
    },
  );
});

describe("bateria AG6b (3a rodada): a ida ao lugar em qualquer ponto do rascunho (M5)", () => {
  it.each(SAIDAS_DO_LUGAR_QUE_BLOQUEIAM.map((c) => [c.id, c] as const))(
    "%s: pronto_socorro barra pela regra, sem chamar o verificador",
    async (_id, caso) => {
      const resultado = avaliarRegras(caso.rascunho, contextoDo(caso));
      expect(resultado.categorias).toContain(caso.categoria);
      expect(resultado.achados.map((a) => a.regra)).toContain("pronto_socorro");
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

});

// ---------------------------------------------------------------------------
// Revisao R2 de d1a15f6 (30/10/2026)
// ---------------------------------------------------------------------------

/** Barra pela regra, na categoria do caso, sem chamar o verificador. */
async function barraPelaRegra(caso: CasoDeSaida, regra?: string) {
  const resultado = avaliarRegras(caso.rascunho, contextoDo(caso));
  expect(resultado.categorias).toContain(caso.categoria);
  if (regra !== undefined) {
    expect(resultado.achados.map((a) => a.regra)).toContain(regra);
  }
  const verificador = verificadorQueSempreAprova();
  const decisao = await filtrarSaida({
    rascunho: caso.rascunho,
    contexto: contextoDo(caso),
    verificador,
  });
  expect(decisao).toMatchObject({ aprovado: false, camada: "regra" });
  expect(verificador).not.toHaveBeenCalled();
}

/** Passa nas regras (nenhum achado) e no filtro, com o verificador que aprova. */
async function passaNasRegras(caso: CasoDeControle) {
  expect(avaliarRegras(caso.rascunho, contextoDo(caso)).achados).toEqual([]);
  const decisao = await filtrarSaida({
    rascunho: caso.rascunho,
    contexto: contextoDo(caso),
    verificador: verificadorQueSempreAprova(),
  });
  expect(decisao.aprovado).toBe(true);
}

// A2: a troca larga do ponto de referencia saiu (revisao R2) e, na revisao
// final de 31/10/2026, a mascara do ponto de referencia da ferramenta
// tambem: qualquer mencao a UPA, ao pronto-socorro, ao SAMU ou ao hospital
// como destino barra como no main, com ou sem consultar_unidades no turno.
// Liberar a referencia perto de UPA e PROPOSTA para o dono.
describe("bateria AG6b (revisão final): o lugar como no main, com ou sem a ferramenta (A2)", () => {
  it.each(RASCUNHOS_DO_LUGAR_DA_REVISAO_R2.map((c) => [c.id, c] as const))(
    "%s: o rascunho do revisor barra (pronto_socorro), como no main",
    async (_id, caso) => {
      await barraPelaRegra(caso, "pronto_socorro");
    },
  );

  it.each(LUGAR_SEM_A_FERRAMENTA_QUE_BLOQUEIA.map((c) => [c.id, c] as const))(
    "%s: o lugar citado sem a ferramenta no turno barra (o antigo controle)",
    async (_id, caso) => {
      await barraPelaRegra(caso, "pronto_socorro");
    },
  );

  it.each(
    PONTO_DE_REFERENCIA_COM_A_FERRAMENTA_QUE_BLOQUEIA.map(
      (c) => [c.id, c] as const,
    ),
  )(
    "%s: com o ponto de referencia da ferramenta no turno, barra como no main",
    async (_id, caso) => {
      await barraPelaRegra(
        caso,
        caso.categoria === "triagem" ? "pronto_socorro" : undefined,
      );
    },
  );

  it.each(
    SAIDAS_DO_PONTO_DE_REFERENCIA_QUE_BLOQUEIAM.map((c) => [c.id, c] as const),
  )(
    "%s: sem a ferramenta, outro texto, outra mencao ou o nome solto barram",
    async (_id, caso) => {
      await barraPelaRegra(caso, "pronto_socorro");
    },
  );
});

// M6: o resultado comentado que so o verificador barrava.
describe("bateria AG6b (revisão R2): o resultado do exame comentado (M6)", () => {
  it.each(SAIDAS_DO_RESULTADO_DA_REVISAO_R2.map((c) => [c.id, c] as const))(
    "%s: a regra do resultado comentado pega",
    async (_id, caso) => {
      await barraPelaRegra(
        caso,
        caso.categoria === "diagnostico"
          ? "resultado_de_exame_alterado"
          : "resultado_de_exame_normal",
      );
    },
  );

  it.each(CONTROLES_DO_RESULTADO_DA_REVISAO_R2.map((c) => [c.id, c] as const))(
    "controle %s: o que a IA pode dizer do exame passa",
    async (_id, caso) => {
      await passaNasRegras(caso);
    },
  );
});

// B1: a triagem que passava pelas regras (tambem no main).
describe("bateria AG6b (revisão R2): a triagem que passava também no main (B1)", () => {
  it.each(SAIDAS_DA_TRIAGEM_DA_REVISAO_R2.map((c) => [c.id, c] as const))(
    "%s: barra pela regra",
    async (_id, caso) => {
      await barraPelaRegra(caso);
    },
  );

  it.each(CONTROLES_DA_TRIAGEM_DA_REVISAO_R2.map((c) => [c.id, c] as const))(
    "controle %s: a recepcao passa",
    async (_id, caso) => {
      await passaNasRegras(caso);
    },
  );

  it("o 188 dentro do telefone barra so como dado pessoal, nunca como emergencia", () => {
    const resultado = avaliarRegras(TELEFONE_COM_O_188, contextoDo({}));
    expect(resultado.categorias).toEqual(["formato_invalido"]);
    expect(resultado.achados.map((a) => a.regra)).toEqual(["dado_pessoal"]);
  });
});

// Revisao final de 31/10/2026: os alarmes falsos das regras novas de saida
// passam, e o que fica barrado de proposito continua barrado.
describe("bateria AG6b (revisão final): os alarmes falsos das regras novas", () => {
  it.each(CONTROLES_DA_REVISAO_FINAL.map((c) => [c.id, c] as const))(
    "controle %s: a recepcao passa",
    async (_id, caso) => {
      await passaNasRegras(caso);
    },
  );

  it.each(
    BARRADOS_DE_PROPOSITO_NA_REVISAO_FINAL.map((c) => [c.id, c] as const),
  )("%s: fica barrado de proposito", async (_id, caso) => {
    await barraPelaRegra(caso);
  });
});

// As versoes conferidas na revisao de 6eae43d, na revisao R2 de d1a15f6 e
// na revisao final (88e9560) ficaram para tras: o portao mudou (as trocas do
// exame da 3a rodada desfeitas, o "que vem" do tempo, a guarda lida em
// codigo) e as regras tambem (a troca larga do lugar e a mascara do ponto de
// referencia sairam, o resultado comentado e a triagem sem os alarmes
// falsos, a saida cedo do rascunho longo).
describe("bateria AG6b: as versões da revisão final", () => {
  it("o portão e as regras mudaram desde as revisões de 6eae43d, de d1a15f6 e de 88e9560", () => {
    expect(versaoDoPortao()).toMatch(/^portao-[0-9a-f]{12}$/);
    expect(versaoDasRegras()).toMatch(/^regras-[0-9a-f]{12}$/);
    expect(versaoDoPortao()).not.toBe("portao-d2a3ee0b28c5");
    expect(versaoDasRegras()).not.toBe("regras-ed143ad51147");
    expect(versaoDoPortao()).not.toBe("portao-04348f7f6108");
    expect(versaoDasRegras()).not.toBe("regras-866a8602fec2");
    expect(versaoDoPortao()).not.toBe("portao-0f66fa91734d");
    expect(versaoDasRegras()).not.toBe("regras-86ba99a67793");
  });
});
