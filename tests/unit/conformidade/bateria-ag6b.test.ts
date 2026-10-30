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
import { filtrarSaida } from "@/lib/domain/conformidade/filtro";
import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import { detectarGatilhosDeEntrada } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";
import { contextoDo } from "@/tests/fixtures/ia/conformidade/casos";
import {
  CONTROLES_DA_MIDIA,
  ENTRADAS_POR_AUDIO,
  LEGENDAS_QUE_ESCALAM,
  SAIDAS_DA_MIDIA_QUE_BLOQUEIAM,
} from "@/tests/fixtures/ia/conformidade/casos-ag6b";

import {
  agenteQueResponde,
  AUDIO,
  audioNoLaco,
  FOTO,
  fotoNoLaco,
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
    ].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
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
