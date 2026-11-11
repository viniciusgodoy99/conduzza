import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dadosVazios, estadoVazio } from "@/lib/agente/atendimento";
import { montarCatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  executarTurnoDoAgente,
  PASSO_DA_PASSAGEM_EM_TEXTO,
  type EntradaDoTurno,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import {
  AVISO_DO_RESTO_DO_PEDIDO,
  DESCRICOES_DO_ARQUIVO,
  PASSOS_DA_MIDIA,
} from "@/lib/agente/midia";
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

// A matriz de arquivos do dono de 06/11/2026 ("preciso que nem tudo vá para a
// equipe") no laco, com a porta e o LLM FALSOS e as regras do filtro DE VERDADE:
// cada linha da tabela, a resposta de cada uma passando pelo filtro, a passagem
// prometida que nao vira passagem forcada, o verificador que so ouve os itens
// achados, e o agente que nunca ve o arquivo, o numero nem o nome fora do
// Cadastro. Nenhum teste chama a OpenAI.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const HEMOGRAMA = "11111111-1111-4111-8111-111111111111";
const GLICEMIA = "22222222-2222-4222-8222-222222222222";
const PROF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UNIMED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
  convenios: [
    { id: UNIMED, name: "Unimed", plan_name: "Nacional", active: true, requires_card: true },
  ],
});
const codigoDe = (id: string) =>
  CATALOGO.procedimentos.find((p) => p.id === id)?.codigo ?? "?";

const PEDIDO = "pedido_de_exame_ou_procedimento" as const;
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

const verificador: Verificador = async (pedido): Promise<ResultadoDoVerificador> => {
  pedidosAoVerificador.push(pedido);
  return {
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: USO,
  };
};
const classificador: ClassificadorDeEntrada = async () => LIMPO;

beforeEach(() => {
  pedidosAoVerificador = [];
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function turno(
  resposta: string,
  mensagens: MensagemDaConversa[],
  extra: Partial<EntradaDoTurno> = {},
) {
  const agente = agenteQueResponde(resposta);
  const promessa = executarTurnoDoAgente({
    cliente: agente.cliente,
    modelo: "gpt-6-luna",
    clinicId: CLINICA,
    identificadorDeSeguranca: "a".repeat(64),
    config: config(),
    catalogo: CATALOGO,
    mensagens,
    agoraMs: Date.UTC(2026, 10, 6, 15, 0),
    fuso: "America/Fortaleza",
    verificador,
    classificador,
    primeiraRespostaDaIa: false,
    ...extra,
  });
  return { promessa, agente };
}

/** O texto da ultima mensagem que o agente leu. */
function ultimaNoAgente(agente: ReturnType<typeof agenteQueResponde>) {
  const input = agente.corpos[0]?.input as { role: string; content: string }[];
  return input.at(-1)?.content;
}

async function textoQueSaiu(
  resposta: string,
  leitura: Parameters<typeof lida>[0],
  extra: Partial<EntradaDoTurno> = {},
) {
  const { porta } = portaFalsa({ leitura: { [FOTO]: lida(leitura) } });
  const { promessa, agente } = turno(resposta, [fotoNoLaco()], { midia: porta, ...extra });
  const r = await promessa;
  return { r, agente };
}

describe("a matriz de arquivos: o pedido com parte fora do Cadastro", () => {
  const PARCIAL = { tipo: PEDIDO, procedimentos: [HEMOGRAMA], foraDoCadastro: 2 };

  it("segue com a IA: o agente fala so do que achou, e o sistema cola o aviso do resto", async () => {
    const { r, agente } = await textoQueSaiu(
      "No pedido que você mandou, vi Hemograma. É isso mesmo?",
      PARCIAL,
    );
    expect(r.desfecho).toEqual({ tipo: "respondeu" });
    expect(ultimaNoAgente(agente)).toBe(
      DESCRICOES_DO_ARQUIVO.pedidoParcial.replace("{}", `${codigoDe(HEMOGRAMA)} Hemograma`),
    );
    expect(String(r.resposta)).toBe(
      `No pedido que você mandou, vi Hemograma. É isso mesmo?\n\n${AVISO_DO_RESTO_DO_PEDIDO}`,
    );
    expect(r.trilha.map((p) => p.texto)).toContain(
      "Leu o arquivo que a pessoa mandou: pedido com 1 itens do Cadastro e 2 fora dele, que a equipe confere (nota na conversa).",
    );
  });

  it("o aviso do resto vai ao verificador no rascunho", async () => {
    await textoQueSaiu("No pedido que você mandou, vi Hemograma. É isso mesmo?", PARCIAL);
    // O aviso e texto colado pelo sistema, que o verificador recebe no rascunho.
    expect(pedidosAoVerificador[0]?.rascunho).toContain(AVISO_DO_RESTO_DO_PEDIDO);
  });

  it("com o pedido inteiro no Cadastro, nada de aviso nem de fato do resto", async () => {
    const { r } = await textoQueSaiu("No pedido que você mandou, vi Hemograma. É isso mesmo?", {
      tipo: PEDIDO,
      procedimentos: [HEMOGRAMA],
    });
    expect(String(r.resposta)).not.toContain(AVISO_DO_RESTO_DO_PEDIDO);
  });
});

describe("a matriz de arquivos: a carteirinha", () => {
  it("plano reconhecido: o agente le o nome do Cadastro, nunca o numero", async () => {
    const { r, agente } = await textoQueSaiu(
      "Obrigada! Recebi sua carteirinha do convênio Unimed Nacional. Como posso ajudar?",
      { tipo: "carteirinha", convenioId: UNIMED },
    );
    expect(r.desfecho).toEqual({ tipo: "respondeu" });
    expect(ultimaNoAgente(agente)).toBe("(a pessoa mandou a carteirinha do convênio Unimed Nacional)");
    expect(r.trilha.map((p) => p.texto)).toContain(PASSOS_DA_MIDIA.leuCarteirinha);
  });

  it("plano nao reconhecido: pergunta qual e, sem dizer que a clinica nao atende", async () => {
    const { r, agente } = await textoQueSaiu(
      "Recebi sua carteirinha, obrigada! Qual é o seu convênio?",
      { tipo: "carteirinha" },
    );
    expect(r.desfecho).toEqual({ tipo: "respondeu" });
    expect(ultimaNoAgente(agente)).toBe(DESCRICOES_DO_ARQUIVO.carteirinhaSemPlano);
    expect(ultimaNoAgente(agente)).toContain("sem dizer se a clínica atende ou não");
  });

  it("o convenio que saiu do Cadastro depois da leitura vira nao reconhecido", async () => {
    const { agente } = await textoQueSaiu("Qual é o seu convênio?", {
      tipo: "carteirinha",
      convenioId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(ultimaNoAgente(agente)).toBe(DESCRICOES_DO_ARQUIVO.carteirinhaSemPlano);
  });

  it("media tambem segue; baixa e a duvidosa, vai para a equipe", async () => {
    const media = await textoQueSaiu("Recebi sua carteirinha, obrigada!", {
      tipo: "carteirinha",
      confianca: "media",
      convenioId: UNIMED,
    });
    expect(media.r.desfecho).toEqual({ tipo: "respondeu" });
    const baixa = await textoQueSaiu("nao sai", { tipo: "carteirinha", confianca: "baixa" });
    expect(baixa.r.desfecho).toMatchObject({ motivo: "midia_nao_identificada", origem: "leitor" });
    expect(baixa.agente.create).not.toHaveBeenCalled();
  });
});

describe("a marcacao com a carteirinha lida no mesmo turno", () => {
  function comOAtendimento(leitura: ReturnType<typeof lida>) {
    const { porta } = portaFalsa({ leitura: { [FOTO]: leitura } });
    return turno("Recebi sua carteirinha, obrigada!", [fotoNoLaco()], {
      midia: porta,
      atendimento: {
        estado: { ...estadoVazio(), insurance_id: UNIMED },
        dados: { ...dadosVazios(), faltam: ["carteirinha"] },
      },
    });
  }
  const FALTA = "Dados que faltam para marcar: número da carteirinha.";

  it("a RPC disse que o cadastro ja tem, do convenio da consulta: o agente nao pede o numero", async () => {
    const { promessa, agente } = comOAtendimento({
      ...lida({ tipo: "carteirinha", convenioId: UNIMED }),
      carteirinhaNoCadastro: { convenioId: UNIMED },
    } as ReturnType<typeof lida>);
    await promessa;
    expect(JSON.stringify(agente.corpos[0])).not.toContain(FALTA);
  });

  it("o cadastro sem o numero (a confianca media, o plano diferente): continua pedindo", async () => {
    const { promessa, agente } = comOAtendimento(
      lida({ tipo: "carteirinha", confianca: "media", convenioId: UNIMED }),
    );
    await promessa;
    expect(JSON.stringify(agente.corpos[0])).toContain(FALTA);
  });

  it("o numero do cadastro e de outro convenio: continua pedindo", async () => {
    const { promessa, agente } = comOAtendimento({
      ...lida({ tipo: "carteirinha" }),
      carteirinhaNoCadastro: { convenioId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    } as ReturnType<typeof lida>);
    await promessa;
    expect(JSON.stringify(agente.corpos[0])).toContain(FALTA);
  });
});

describe("a matriz de arquivos: o documento pessoal", () => {
  it("segue: o arquivo fica para a equipe, e nada e extraido", async () => {
    const { r, agente } = await textoQueSaiu(
      "Recebi seu documento, ele fica guardado para a equipe. Como posso ajudar?",
      { tipo: "documento_de_identidade" },
    );
    expect(r.desfecho).toEqual({ tipo: "respondeu" });
    expect(ultimaNoAgente(agente)).toBe(DESCRICOES_DO_ARQUIVO.documento);
    expect(r.trilha.map((p) => p.texto)).toContain(PASSOS_DA_MIDIA.documentoGuardado);
  });

  it("baixa: equipe", async () => {
    const { r } = await textoQueSaiu("nao sai", {
      tipo: "documento_de_identidade",
      confianca: "baixa",
    });
    expect(r.desfecho).toMatchObject({ motivo: "midia_nao_identificada" });
  });
});

describe("a matriz de arquivos: o ilegivel", () => {
  const PEDE = "Não consegui ler o arquivo que você mandou. Pode mandar uma foto mais nítida?";

  it.each(["alta", "media", "baixa"] as const)(
    "a primeira vez da janela (confianca %s): pede uma foto mais nitida, sem dizer o que e",
    async (confianca) => {
      const { r, agente } = await textoQueSaiu(PEDE, { tipo: "ilegivel", confianca });
      expect(r.desfecho).toEqual({ tipo: "respondeu" });
      expect(String(r.resposta)).toBe(PEDE);
      expect(ultimaNoAgente(agente)).toBe(DESCRICOES_DO_ARQUIVO.ilegivel);
      expect(r.trilha.map((p) => p.texto)).toContain(PASSOS_DA_MIDIA.pediuFotoMelhor);
    },
  );

  it("de novo na mesma janela: a equipe, sem agente", async () => {
    const { r, agente } = await textoQueSaiu("nao sai", { tipo: "ilegivel" }, { ilegivelNaJanela: true });
    expect(r.desfecho).toMatchObject({ motivo: "midia_nao_identificada", origem: "leitor" });
    expect(agente.create).not.toHaveBeenCalled();
  });

  it("varios ilegiveis no mesmo turno contam como uma vez", async () => {
    const { porta, ler } = portaFalsa({
      leitura: {
        [FOTO]: lida({ tipo: "ilegivel" }),
        [FOTO_2]: lida({ tipo: "ilegivel" }),
      },
    });
    const { promessa, agente } = turno(PEDE, [fotoNoLaco(FOTO), fotoNoLaco(FOTO_2)], {
      midia: porta,
    });
    const r = await promessa;
    expect(ler).toHaveBeenCalledTimes(2);
    expect(r.desfecho).toEqual({ tipo: "respondeu" });
    expect(agente.create).toHaveBeenCalledTimes(1);
  });

  it("junto de um pedido parcial: o agente pede a foto e fala dos achados, e o aviso sai", async () => {
    const { porta } = portaFalsa({
      leitura: {
        [FOTO]: lida({ tipo: "ilegivel" }),
        [FOTO_2]: lida({ tipo: PEDIDO, procedimentos: [HEMOGRAMA], foraDoCadastro: 1 }),
      },
    });
    const { promessa } = turno(`${PEDE} No pedido que você mandou, vi Hemograma.`, [
      fotoNoLaco(FOTO),
      fotoNoLaco(FOTO_2),
    ], { midia: porta });
    const r = await promessa;
    expect(r.desfecho).toEqual({ tipo: "respondeu" });
    expect(String(r.resposta)).toContain(AVISO_DO_RESTO_DO_PEDIDO);
  });
});

describe("a matriz de arquivos: o outro", () => {
  it.each(["alta", "media"] as const)("confianca %s: pergunta como pode ajudar", async (confianca) => {
    const { r, agente } = await textoQueSaiu("Recebi o arquivo. Como posso ajudar?", {
      tipo: "outro",
      confianca,
    });
    expect(r.desfecho).toEqual({ tipo: "respondeu" });
    expect(ultimaNoAgente(agente)).toBe(DESCRICOES_DO_ARQUIVO.outro);
    expect(r.trilha.map((p) => p.texto)).toContain(PASSOS_DA_MIDIA.arquivoOutro);
  });

  it("baixa (a duvida sobre o arquivo): a equipe", async () => {
    const { r, agente } = await textoQueSaiu("nao sai", { tipo: "outro", confianca: "baixa" });
    expect(r.desfecho).toMatchObject({ motivo: "midia_nao_identificada" });
    expect(agente.create).not.toHaveBeenCalled();
  });
});

describe("a matriz de arquivos: o motivo mais forte da rajada (CLAUDE.md 3.2 nao muda)", () => {
  it.each([
    ["carteirinha", { tipo: "carteirinha" as const }],
    ["documento", { tipo: "documento_de_identidade" as const }],
    ["outro", { tipo: "outro" as const }],
    ["ilegivel", { tipo: "ilegivel" as const }],
    ["pedido parcial", { tipo: PEDIDO, procedimentos: [HEMOGRAMA], foraDoCadastro: 1 }],
  ])("%s com um laudo na mesma rajada: tudo com a equipe, como midia_clinica, sem agente", async (_rotulo, leitura) => {
    const { porta } = portaFalsa({
      leitura: {
        [FOTO]: lida(leitura),
        [FOTO_2]: lida({ tipo: "resultado_ou_laudo" }),
      },
    });
    const { promessa, agente } = turno("nao sai", [fotoNoLaco(FOTO), fotoNoLaco(FOTO_2)], {
      midia: porta,
    });
    const r = await promessa;
    expect(r.desfecho).toMatchObject({ tipo: "escalou", motivo: "midia_clinica", origem: "leitor" });
    expect(agente.create).not.toHaveBeenCalled();
  });

  it("o segundo ilegivel com uma guia: o documento vence", async () => {
    const { porta } = portaFalsa({
      leitura: {
        [FOTO]: lida({ tipo: "ilegivel" }),
        [FOTO_2]: lida({ tipo: "guia_ou_autorizacao" }),
      },
    });
    const { promessa } = turno("nao sai", [fotoNoLaco(FOTO), fotoNoLaco(FOTO_2)], {
      midia: porta,
      ilegivelNaJanela: true,
    });
    expect((await promessa).desfecho).toMatchObject({ motivo: "documento_do_paciente" });
  });
});

describe("a passagem prometida com o arquivo no turno", () => {
  it.each([
    ["documento", { tipo: "documento_de_identidade" as const }, "Recebi seu documento. A equipe vai ver seu documento quando precisar."],
    ["pedido", { tipo: PEDIDO, procedimentos: [HEMOGRAMA], foraDoCadastro: 1 }, "No pedido que você mandou, vi Hemograma. A equipe confere o resto."],
  ])("%s: 'a equipe confere' ou 'vai ver' nao vira passagem forcada", async (_rotulo, leitura, resposta) => {
    const { r, agente } = await textoQueSaiu(resposta, leitura);
    expect(agente.create).toHaveBeenCalledTimes(1);
    expect(r.desfecho).toEqual({ tipo: "respondeu" });
    expect(r.trilha.map((p) => p.texto)).not.toContain(PASSO_DA_PASSAGEM_EM_TEXTO);
  });

  it.each([
    ["Passei seu documento para a equipe."],
    ["Vou passar seu documento para a equipe."],
    ["A equipe vai te responder sobre seu documento."],
    ["A equipe confere o documento e te retorna."],
    ["Encaminhei sua conversa para a equipe por causa do documento."],
  ])("'%s' conta: nunca sai como resposta", async (resposta) => {
    const { r } = await textoQueSaiu(resposta, { tipo: "documento_de_identidade" });
    expect(r.trilha.map((p) => p.texto)).toContain(PASSO_DA_PASSAGEM_EM_TEXTO);
    expect(r.desfecho).toMatchObject({ tipo: "escalou" });
  });

  it("sem arquivo no turno, nada muda: a mesma frase de um turno sem documento", async () => {
    const agente = agenteQueResponde("A equipe confere o documento e te retorna.");
    const r = await executarTurnoDoAgente({
      cliente: agente.cliente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: "a".repeat(64),
      config: config(),
      catalogo: CATALOGO,
      mensagens: [{ autor: "paciente", tipo: "texto", texto: "oi" }],
      agoraMs: Date.UTC(2026, 10, 6, 15, 0),
      fuso: "America/Fortaleza",
      verificador,
      classificador,
    });
    expect(r.trilha.map((p) => p.texto)).toContain(PASSO_DA_PASSAGEM_EM_TEXTO);
  });
});
