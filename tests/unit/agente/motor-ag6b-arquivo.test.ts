import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { montarCatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  executarTurnoDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import {
  FRASE_DA_FIGURINHA,
  PASSO_DO_MOTIVO_DA_LEITURA,
  PASSOS_DA_MIDIA,
} from "@/lib/agente/midia";
import { FRASES_DO_ATENDIMENTO, montarInstrucoes } from "@/lib/agente/prompt";
import {
  configPadraoDoAgente,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import type {
  EntradaDoVerificador,
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";

import {
  agenteQueResponde,
  FOTO,
  FOTO_2,
  fotoNoLaco,
  lida,
  portaFalsa,
} from "./ag6b-contrato";

// AG6b, a FOTO e o DOCUMENTO no laco (desenho 5.1, 3b; tabela 1.2; D-14,
// D-58 e D-98) com a porta FALSA e o LLM FALSO: a legenda que escala antes
// do leitor (o arquivo nunca sai), cada tipo e o motivo da passagem, a
// prioridade, a figurinha local, o agente que ve so a descricao (nunca o
// arquivo), os fatos do verificador e a falha fechada. Nenhum teste chama a
// OpenAI.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const HEMOGRAMA = "11111111-1111-4111-8111-111111111111";
const GLICEMIA = "22222222-2222-4222-8222-222222222222";
const PROF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATALOGO = montarCatalogoDoAgente({
  procedimentos: [
    { id: HEMOGRAMA, name: "Hemograma", active: true, bookable_by_ai: true },
    { id: GLICEMIA, name: "Glicemia de jejum", active: true, bookable_by_ai: true },
  ],
  vinculos: [HEMOGRAMA, GLICEMIA].map((procedure_id) => ({
    procedure_id,
    professional_id: PROF,
    insurance_id: null,
    price_cents: 4_000,
    covered_by_insurance: false,
    bookable_by_ai: true,
    active: true,
  })),
  profissionais: [{ id: PROF, name: "Dra. Helena", active: true }],
  convenios: [],
});
const codigoDe = (id: string) =>
  CATALOGO.procedimentos.find((p) => p.id === id)?.codigo ?? "?";

const USO = { tokensEntrada: 600, tokensSaida: 10, tokensCacheLidos: 0, tokensCacheGravados: 0 };
const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: USO,
};

function config(): ConfigDoAgente {
  const base = configPadraoDoAgente();
  return {
    ...base,
    habilidades: { ...base.habilidades, ler_imagem_e_documento: true },
  };
}

let pedidosAoVerificador: EntradaDoVerificador[] = [];
let textosAoClassificador: (readonly string[])[] = [];
let escrito: string[] = [];

const verificador: Verificador = async (pedido): Promise<ResultadoDoVerificador> => {
  pedidosAoVerificador.push(pedido);
  return {
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: USO,
  };
};
const classificador: ClassificadorDeEntrada = async ({ mensagens }) => {
  textosAoClassificador.push(mensagens);
  return LIMPO;
};

beforeEach(() => {
  pedidosAoVerificador = [];
  textosAoClassificador = [];
  escrito = [];
  vi.spyOn(process.stdout, "write").mockImplementation((t) => {
    escrito.push(String(t));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((t) => {
    escrito.push(String(t));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function turno(mensagens: MensagemDaConversa[], extra: Partial<EntradaDoTurno> = {}) {
  const agente = agenteQueResponde(
    "No pedido que você mandou, vi Hemograma e Glicemia de jejum. É isso mesmo?",
  );
  const promessa = executarTurnoDoAgente({
    cliente: agente.cliente,
    modelo: "gpt-6-luna",
    clinicId: CLINICA,
    identificadorDeSeguranca: "a".repeat(64),
    config: config(),
    catalogo: CATALOGO,
    mensagens,
    agoraMs: Date.UTC(2026, 9, 30, 15, 0),
    fuso: "America/Fortaleza",
    verificador,
    classificador,
    ...extra,
  });
  return { promessa, agente };
}

const PEDIDO_OK = lida({
  tipo: "pedido_de_exame_ou_procedimento",
  procedimentos: [HEMOGRAMA, GLICEMIA],
});

describe("o pedido de exame com os itens no Cadastro (o caminho feliz)", () => {
  it("o agente ve so a descricao com os codigos e a legenda; nunca o arquivo", async () => {
    const { porta, ler } = portaFalsa({ leitura: { [FOTO]: PEDIDO_OK } });
    const { promessa, agente } = turno([fotoNoLaco(FOTO, "quanto fica?")], { midia: porta });
    const r = await promessa;
    expect(r.tipo).toBe("resposta");
    expect(ler).toHaveBeenCalledTimes(1);
    // O leitor recebeu a lista do Cadastro com os codigos do turno.
    const catalogoDoLeitor = ler.mock.calls[0]?.[1];
    expect(catalogoDoLeitor).toEqual(
      CATALOGO.procedimentos.map((p) => ({ codigo: p.codigo, id: p.id, nome: p.nome })),
    );
    const input = agente.corpos[0]?.input as { role: string; content: string }[];
    expect(input.at(-1)?.content).toBe(
      `(a pessoa mandou um pedido de exame ou procedimento com: ${codigoDe(HEMOGRAMA)} Hemograma, ${codigoDe(GLICEMIA)} Glicemia de jejum) quanto fica?`,
    );
    const corpo = JSON.stringify(agente.corpos);
    expect(corpo).not.toMatch(/input_image|input_file|input_audio|data:image|base64/);
    // O classificador leu a legenda (antes do leitor).
    expect(textosAoClassificador).toEqual([["quanto fica?"]]);
    // O verificador recebe o fato do pedido (so nomes do Cadastro).
    expect(pedidosAoVerificador[0]?.resumoDosFatos).toContain(
      "A pessoa mandou um pedido com: Hemograma, Glicemia de jejum.",
    );
    expect(r.trilha.map((p) => p.texto)).toContain(
      "Leu o arquivo que a pessoa mandou: pedido com 2 itens do Cadastro.",
    );
    expect(r.uso.some((u) => u.papel === "leitor_de_midia")).toBe(true);
    expect(r.midiaNaoLida).toBeUndefined();
  });

  it("sem legenda, so a descricao", async () => {
    const { porta } = portaFalsa({ leitura: { [FOTO]: PEDIDO_OK } });
    const { promessa, agente } = turno([fotoNoLaco(FOTO, null)], { midia: porta });
    await promessa;
    const input = agente.corpos[0]?.input as { content: string }[];
    expect(input.at(-1)?.content).toBe(
      `(a pessoa mandou um pedido de exame ou procedimento com: ${codigoDe(HEMOGRAMA)} Hemograma, ${codigoDe(GLICEMIA)} Glicemia de jejum)`,
    );
  });

  it("o prompt com o arquivo: confirmar os itens antes do valor, nunca 'pela foto'", () => {
    const instrucoes = montarInstrucoes({
      config: config(),
      catalogo: CATALOGO,
      agoraTexto: "quinta-feira, 30/10/2026, 12:00",
    });
    expect(instrucoes).toContain(FRASES_DO_ATENDIMENTO.arquivoLigado);
    expect(FRASES_DO_ATENDIMENTO.arquivoLigado).toContain(
      'nunca "pela foto" nem "pela imagem"',
    );
    expect(FRASES_DO_ATENDIMENTO.arquivoLigado).toContain(
      "Antes de falar de valor, confirme os itens com a pessoa.",
    );
  });
});

describe("a legenda que escala ANTES do leitor (o arquivo nunca sai)", () => {
  it.each([
    ["isso é normal?", "assunto_clinico"],
    ["o que significa esse resultado?", "assunto_clinico"],
    ["to com dor no peito", "urgencia"],
    ["quero falar com uma pessoa", "pedido_humano"],
  ])("'%s' na legenda: %s, sem preparar nem ler", async (legenda, motivo) => {
    const { porta, preparar, ler } = portaFalsa();
    const { promessa, agente } = turno([fotoNoLaco(FOTO, legenda)], { midia: porta });
    const r = await promessa;
    expect(r.desfecho).toMatchObject({ tipo: "escalou", motivo });
    expect(preparar).not.toHaveBeenCalled();
    expect(ler).not.toHaveBeenCalled();
    expect(agente.create).not.toHaveBeenCalled();
  });

  it("o classificador que escala pela legenda: o leitor nunca e chamado", async () => {
    const { porta, ler } = portaFalsa();
    const { promessa } = turno([fotoNoLaco(FOTO, "pode ver se tá tudo bem?")], {
      midia: porta,
      classificador: async () => ({
        tipo: "classificacao",
        classificacao: { gatilhos: ["assunto_clinico"], confianca: "alta" },
        modelo: "gpt-6-luna",
        uso: USO,
      }),
    });
    const r = await promessa;
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "assunto_clinico",
      origem: "classificador",
    });
    expect(ler).not.toHaveBeenCalled();
  });
});

describe("cada tipo e o motivo da passagem (tabela 1.2)", () => {
  it.each([
    ["resultado_ou_laudo", "midia_clinica"],
    ["receita", "midia_clinica"],
    ["foto_do_corpo", "midia_clinica"],
    ["carteirinha", "documento_do_paciente"],
    ["guia_ou_autorizacao", "documento_do_paciente"],
    ["documento_de_identidade", "documento_do_paciente"],
    ["outro", "midia_nao_identificada"],
    ["ilegivel", "midia_nao_identificada"],
  ] as const)("%s: %s, origem leitor, sem agente", async (tipo, motivo) => {
    const { porta } = portaFalsa({ leitura: { [FOTO]: lida({ tipo }) } });
    const { promessa, agente } = turno([fotoNoLaco()], { midia: porta });
    const r = await promessa;
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo,
      gatilho: null,
      origem: "leitor",
    });
    expect(r.trilha.map((p) => p.texto)).toContain(PASSO_DO_MOTIVO_DA_LEITURA[motivo]);
    expect(agente.create).not.toHaveBeenCalled();
    // O arquivo foi lido: nao conta como midia nao lida (D-96).
    expect(r.midiaNaoLida).toBeUndefined();
    // O tipo nunca vai para log.
    expect(escrito.join("")).not.toContain(tipo);
  });

  it("o pedido com item fora do Cadastro ou lido sem seguranca: nao identificada", async () => {
    for (const leitura of [
      lida({ tipo: "pedido_de_exame_ou_procedimento", procedimentos: [HEMOGRAMA], foraDoCadastro: 1 }),
      lida({
        tipo: "pedido_de_exame_ou_procedimento",
        procedimentos: [HEMOGRAMA],
        confianca: "baixa",
      }),
    ]) {
      const { porta } = portaFalsa({ leitura: { [FOTO]: leitura } });
      const { promessa, agente } = turno([fotoNoLaco()], { midia: porta });
      const r = await promessa;
      expect(r.desfecho).toMatchObject({ motivo: "midia_nao_identificada", origem: "leitor" });
      expect(agente.create).not.toHaveBeenCalled();
    }
  });

  it("a prioridade com dois arquivos: o clinico vence o documento", async () => {
    const { porta, ler } = portaFalsa({
      leitura: {
        [FOTO]: lida({ tipo: "carteirinha" }),
        [FOTO_2]: lida({ tipo: "receita" }),
      },
    });
    const { promessa } = turno([fotoNoLaco(FOTO), fotoNoLaco(FOTO_2)], { midia: porta });
    const r = await promessa;
    expect(ler).toHaveBeenCalledTimes(2);
    expect(r.desfecho).toMatchObject({ motivo: "midia_clinica", origem: "leitor" });
  });

  it("o documento vence o nao identificado; o pedido junto nao segue", async () => {
    const { porta } = portaFalsa({
      leitura: {
        [FOTO]: lida({ tipo: "ilegivel" }),
        [FOTO_2]: lida({ tipo: "guia_ou_autorizacao" }),
      },
    });
    const { promessa } = turno([fotoNoLaco(FOTO), fotoNoLaco(FOTO_2)], { midia: porta });
    expect((await promessa).desfecho).toMatchObject({ motivo: "documento_do_paciente" });
  });
});

describe("a figurinha (D-98)", () => {
  it("a figurinha do WhatsApp e lida no servidor; o agente ve so a frase", async () => {
    const { porta, ler } = portaFalsa({ preparo: { [FOTO]: "figurinha" } });
    const { promessa, agente } = turno(
      [{ autor: "paciente", texto: "oi" }, fotoNoLaco(FOTO)],
      { midia: porta },
    );
    const r = await promessa;
    expect(r.tipo).toBe("resposta");
    expect(ler).toHaveBeenCalledTimes(1);
    expect(ler.mock.calls[0]?.[0]).toMatchObject({ tipo: "figurinha" });
    // Sem modelo: sem uso do leitor.
    expect(r.uso.some((u) => u.papel === "leitor_de_midia")).toBe(false);
    const input = agente.corpos[0]?.input as { content: string }[];
    expect(input.at(-1)?.content).toBe(FRASE_DA_FIGURINHA);
    expect(r.trilha.map((p) => p.texto)).toContain(PASSOS_DA_MIDIA.figurinha);
  });

  it("a figurinha que o leitor leu com confianca baixa vai para a equipe", async () => {
    const { porta } = portaFalsa({
      leitura: { [FOTO]: lida({ tipo: "figurinha", confianca: "baixa" }) },
    });
    const { promessa } = turno([fotoNoLaco()], { midia: porta });
    expect((await promessa).desfecho).toMatchObject({ motivo: "midia_nao_identificada" });
  });

  it("a figurinha ja lida (o historico) nao escala no portao e nao tem texto", async () => {
    const { porta, preparar } = portaFalsa();
    const { promessa, agente } = turno(
      [
        {
          autor: "paciente",
          tipo: "figurinha",
          texto: null,
        },
      ],
      { midia: porta },
    );
    const r = await promessa;
    expect(r.tipo).toBe("resposta");
    expect(preparar).not.toHaveBeenCalled();
    const input = agente.corpos[0]?.input as { content: string }[];
    expect(input.at(-1)?.content).toBe(FRASE_DA_FIGURINHA);
  });
});

describe("fora da regra e falha fechada", () => {
  it("o arquivo fora dos limites (PDF de 4 paginas, cifrado, grande): midia_nao_suportada, sem leitor", async () => {
    const { porta, ler } = portaFalsa({ preparo: { [FOTO]: "fora" } });
    const { promessa } = turno([fotoNoLaco()], { midia: porta });
    const r = await promessa;
    expect(ler).not.toHaveBeenCalled();
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "midia_nao_suportada",
      gatilho: "midia",
      origem: "portao",
    });
    expect(r.trilha.map((p) => p.texto)).toContain(PASSOS_DA_MIDIA.arquivoFora);
    expect(r.midiaNaoLida).toBe(true);
  });

  it("o leitor que falha (erro, prazo, saida invalida, gravar recusado): falha tecnica, com o uso", async () => {
    const { porta } = portaFalsa({
      leitura: {
        [FOTO]: {
          tipo: "falhou",
          motivo: "saida_invalida",
          uso: {
            papel: "leitor_de_midia",
            modelo: "gpt-6-luna",
            uso: { tokensEntrada: 1, tokensSaida: 1, tokensCacheLidos: 0, tokensCacheGravados: 0 },
          },
        },
      },
    });
    const { promessa, agente } = turno([fotoNoLaco()], { midia: porta });
    const r = await promessa;
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "saida_invalida" });
    expect(r.trilha.map((p) => p.texto)).toContain(PASSOS_DA_MIDIA.leituraFalhou);
    expect(r.uso.some((u) => u.papel === "leitor_de_midia")).toBe(true);
    expect(r.midiaNaoLida).toBe(true);
    expect(agente.create).not.toHaveBeenCalled();
  });

  it("alguem assumiu durante a leitura: termina sem envio", async () => {
    const { porta } = portaFalsa({ leitura: { [FOTO]: { tipo: "fora_da_ia", uso: null } } });
    const { promessa } = turno([fotoNoLaco()], { midia: porta });
    expect((await promessa).desfecho).toEqual({ tipo: "falhou", motivo: "liberacao_suspensa" });
  });

  it("a gravacao com job_antigo (D-A, revisao): o turno marca jobAntigo, sem o agente", async () => {
    const { porta } = portaFalsa({ leitura: { [FOTO]: { tipo: "job_antigo", uso: null } } });
    const { promessa, agente } = turno([fotoNoLaco()], { midia: porta });
    const r = await promessa;
    expect(r.jobAntigo).toBe(true);
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "liberacao_suspensa" });
    expect(agente.create).not.toHaveBeenCalled();
  });

  it("sem porta (o simulador): o arquivo passa como midia", async () => {
    const { promessa } = turno([fotoNoLaco()], { midia: null });
    expect((await promessa).desfecho).toMatchObject({ motivo: "midia_nao_suportada" });
  });

  it("o arquivo fora do plano (sem teto medido, habilidade, telefone): escala no 1a, sem preparar", async () => {
    const { porta, preparar } = portaFalsa();
    const { promessa } = turno([fotoNoLaco(FOTO, "quanto fica?", "fora")], { midia: porta });
    const r = await promessa;
    expect(r.desfecho).toMatchObject({ motivo: "midia_nao_suportada", gatilho: "midia" });
    expect(preparar).not.toHaveBeenCalled();
  });
});
