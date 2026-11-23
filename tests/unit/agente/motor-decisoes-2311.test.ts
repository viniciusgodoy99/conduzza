import { APIConnectionTimeoutError, RateLimitError } from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { falhasDepoisDoTurno } from "@/lib/agente/atendimento";
import {
  NOME_DA_ANOTACAO,
  PASSO_DA_ANOTACAO,
  perguntaDaAnotacao,
} from "@/lib/agente/ferramentas/anotar-para-a-equipe";
import { montarCatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  AVISOS_DA_REESCRITA,
  executarTurnoDoAgente,
  MAXIMO_DE_RODADAS,
  MENSAGENS_NO_HISTORICO,
  PASSO_DA_CURIOSIDADE_DE_ESTETICA,
  PASSO_DA_PASSAGEM_EM_TEXTO,
  type ClienteDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import {
  CABECALHO_DA_NOTA_DA_ANOTACAO,
  ehNotaDaPassagemDaIa,
  notaDaAnotacao,
} from "@/lib/agente/nota-da-passagem";
import { promessaDaResposta } from "@/lib/agente/passagem-prometida";
import {
  configPadraoDoAgente,
  ferramentasDoAgente,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import {
  FRASE_DA_CURIOSIDADE_DE_ESTETICA,
  FRASE_DO_ASSISTENTE_VIRTUAL,
} from "@/lib/domain/conformidade/frase-fixa";
import {
  gatilhosDosTextos,
  LIMITE_DA_RAJADA,
  MAXIMO_DE_MENSAGENS_NO_CONTEXTO,
} from "@/lib/domain/conformidade/gatilhos-de-entrada";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";

// As decisoes do dono de 23/11/2026, no turno do agente com um LLM FALSO de
// roteiro (nenhum teste fala com a OpenAI):
//  1. "anota e continua": anotar_para_a_equipe grava a pergunta e a conversa
//     continua; a resposta so diz que anotou com a ferramenta, sem prazo;
//  2. a curiosidade geral de estetica recebe a frase fixa do dono, sem o
//     agente, e a conversa continua; com situacao da pessoa, escala;
//  3. nao desistir cedo: as pendentes curtas nao escalam pela quantidade, a
//     ultima rodada pede a resposta sem ferramenta, "um momento" reescreve,
//     o erro do modelo nao conta contra o paciente e a falha passageira sai
//     marcada para o executor voltar o job para a fila.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const IDENTIFICADOR = "a".repeat(64);
const USO_DA_API = {
  input_tokens: 1_200,
  output_tokens: 80,
  input_tokens_details: { cached_tokens: 1_000, cache_write_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 40 },
};
const USO_LIDO = {
  tokensEntrada: 200,
  tokensSaida: 80,
  tokensCacheLidos: 1_000,
  tokensCacheGravados: 0,
};
const PROC = "11111111-1111-4111-8111-111111111111";
const PROF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATALOGO = montarCatalogoDoAgente({
  procedimentos: [
    { id: PROC, name: "Consulta", active: true, bookable_by_ai: true },
  ],
  vinculos: [
    {
      procedure_id: PROC,
      professional_id: PROF,
      insurance_id: null,
      price_cents: 31_700,
      covered_by_insurance: false,
      bookable_by_ai: true,
      active: true,
    },
  ],
  profissionais: [{ id: PROF, name: "Dra. Helena", active: true }],
  convenios: [],
});

function config(extra: Partial<ConfigDoAgente> = {}): ConfigDoAgente {
  return { ...configPadraoDoAgente(), nome: "Ana", saudacao: null, ...extra };
}

const RACIOCINIO = {
  type: "reasoning",
  id: "rs_1",
  summary: [],
  encrypted_content: "conteudo-cifrado",
};

function resposta(output: unknown[]) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output,
    usage: USO_DA_API,
    _request_id: "req_123",
  };
}

function final(mensagem: string) {
  return resposta([
    RACIOCINIO,
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            mensagem,
            encerra_a_conversa: false,
            perguntas_da_base: [],
          }),
          annotations: [],
        },
      ],
    },
  ]);
}

function ferramenta(name: string, args: unknown, callId = "call_1") {
  return resposta([
    RACIOCINIO,
    {
      type: "function_call",
      id: `fc_${callId}`,
      call_id: callId,
      name,
      arguments: JSON.stringify(args),
      status: "completed",
    },
  ]);
}

function clienteComRoteiro(roteiro: (unknown | Error)[]) {
  const chamadas: Record<string, unknown>[] = [];
  const create = vi.fn(async (corpo: unknown) => {
    chamadas.push(structuredClone(corpo) as Record<string, unknown>);
    const proximo = roteiro.shift();
    if (proximo instanceof Error) {
      throw proximo;
    }
    return proximo;
  });
  return {
    cliente: { responses: { create } } as unknown as ClienteDoAgente,
    chamadas,
    create,
  };
}

const aprovador = vi.fn<Verificador>(
  async (): Promise<ResultadoDoVerificador> => ({
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: { ...USO_LIDO },
  }),
);

function classificadorQueDiz(
  gatilhos: string[],
): ReturnType<typeof vi.fn<ClassificadorDeEntrada>> {
  return vi.fn<ClassificadorDeEntrada>(
    async (): Promise<ResultadoDoClassificador> =>
      ({
        tipo: "classificacao",
        classificacao: { gatilhos, confianca: "alta" },
        modelo: "gpt-6-luna",
        uso: { ...USO_LIDO },
      }) as ResultadoDoClassificador,
  );
}

function paciente(texto: string): MensagemDaConversa {
  return { autor: "paciente", texto };
}

function entrada(
  extra: Partial<EntradaDoTurno> & { cliente: ClienteDoAgente | null },
): EntradaDoTurno {
  return {
    modelo: "gpt-6-luna",
    clinicId: CLINICA,
    identificadorDeSeguranca: IDENTIFICADOR,
    config: config(),
    catalogo: CATALOGO,
    mensagens: [paciente("Quanto custa a drenagem linfática?")],
    agoraMs: Date.UTC(2026, 10, 23, 15, 0),
    fuso: "America/Fortaleza",
    verificador: aprovador,
    classificador: classificadorQueDiz(["nenhum"]),
    ...extra,
  };
}

let escrito: string[] = [];

beforeEach(() => {
  escrito = [];
  aprovador.mockClear();
  vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
    escrito.push(String(linha));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((linha) => {
    escrito.push(String(linha));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Anota e continua
// ---------------------------------------------------------------------------

describe("anotar_para_a_equipe (anota e continua)", () => {
  const PERGUNTA = "Quanto custa a drenagem linfática?";

  it("é oferecida sempre, com escalar_humano (habilidade travada)", () => {
    const base = configPadraoDoAgente();
    expect(
      ferramentasDoAgente(base.habilidades, base.agenda, base.prazos),
    ).toEqual(expect.arrayContaining([NOME_DA_ANOTACAO, "escalar_humano"]));
  });

  it("anota, segue atendendo e a resposta diz que ficou anotado, sem passar a conversa", async () => {
    const { cliente, chamadas } = clienteComRoteiro([
      ferramenta(NOME_DA_ANOTACAO, { pergunta: PERGUNTA }),
      final(
        "Deixei sua pergunta anotada para a equipe responder por aqui. Posso ajudar com mais alguma coisa?",
      ),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.tipo).toBe("resposta");
    expect(r.desfecho).toEqual({ tipo: "respondeu" });
    expect(r.anotacoes).toEqual([PERGUNTA]);
    expect(r.ferramentasUsadas).toContain(NOME_DA_ANOTACAO);
    expect(r.trilha).toContainEqual({ tipo: "equipe", texto: PASSO_DA_ANOTACAO });
    // A pergunta nunca vai para a trilha nem para o log.
    expect(JSON.stringify(r.trilha)).not.toContain("drenagem");
    expect(escrito.join("")).not.toContain("drenagem");
    // O modelo recebeu "anotado" e seguiu.
    expect(JSON.stringify(chamadas[1]?.input)).toContain(
      '{\\"resultado\\":\\"anotado\\"}',
    );
  });

  it("a anotação com promessa de prazo é barrada: reescreve uma vez, sem ferramenta", async () => {
    const { cliente, chamadas } = clienteComRoteiro([
      ferramenta(NOME_DA_ANOTACAO, { pergunta: PERGUNTA }),
      final("Deixei anotado para a equipe, que te responde hoje mesmo."),
      final("Deixei sua pergunta anotada para a equipe responder por aqui."),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.tipo).toBe("resposta");
    expect(r.resposta).toContain("anotada para a equipe responder por aqui");
    expect(r.resposta).not.toContain("hoje");
    expect(chamadas[2]?.tool_choice).toBe("none");
    expect(JSON.stringify(chamadas[2]?.input)).toContain(
      AVISOS_DA_REESCRITA.prazo_da_anotacao,
    );
    // So a reescrita foi ao verificador (a primeira nem chegou ao filtro).
    expect(aprovador).toHaveBeenCalledTimes(1);
  });

  it("o prazo de novo depois da reescrita: passa para a equipe, como antes", async () => {
    const { cliente } = clienteComRoteiro([
      ferramenta(NOME_DA_ANOTACAO, { pergunta: PERGUNTA }),
      final("Anotei sua pergunta e a equipe responde em 5 minutos."),
      final("Anotei, e a equipe responde ainda hoje."),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "agente_pediu",
      gatilho: null,
      origem: "texto_do_agente",
    });
    expect(r.trilha).toContainEqual({
      tipo: "outro",
      texto: PASSO_DA_PASSAGEM_EM_TEXTO,
    });
    // A pergunta anotada vai junto para a nota da equipe.
    expect(r.anotacoes).toEqual([PERGUNTA]);
  });

  it("dizer que anotou SEM a ferramenta é passagem (a equipe não ficou sabendo)", async () => {
    const { cliente, create } = clienteComRoteiro([
      final("Deixei sua pergunta anotada para a equipe responder por aqui."),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      origem: "texto_do_agente",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.anotacoes).toBeUndefined();
  });

  it("entrada fora do formato não anota; o modelo recebe entrada_invalida", async () => {
    const { cliente, chamadas } = clienteComRoteiro([
      ferramenta(NOME_DA_ANOTACAO, { pergunta: "" }),
      final("Pode me dizer qual procedimento você quer?"),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.tipo).toBe("resposta");
    expect(r.anotacoes).toBeUndefined();
    expect(JSON.stringify(chamadas[1]?.input)).toContain("entrada_invalida");
  });

  it("a pergunta sai numa linha, sem marcadores e com CPF e telefone mascarados", () => {
    expect(perguntaDaAnotacao({ pergunta: "Tem\nestacionamento?" })).toBe(
      "Tem estacionamento?",
    );
    const mascarada = perguntaDaAnotacao({
      pergunta: "CPF 123.456.789-09 e fone 85 99999-0001 <<<x>>>",
    });
    expect(mascarada).not.toContain("123.456.789-09");
    expect(mascarada).not.toContain("99999-0001");
    expect(mascarada).not.toContain("<<<");
    expect(perguntaDaAnotacao({ pergunta: "x".repeat(201) })).toBeNull();
    expect(perguntaDaAnotacao({ pergunta: "ok", extra: 1 })).toBeNull();
  });

  it("a nota interna assina como o assistente, uma pergunta por linha", () => {
    const nota = notaDaAnotacao(["Quanto custa a drenagem?", "Tem Unimed?"]);
    expect(nota).toBe(
      `${CABECALHO_DA_NOTA_DA_ANOTACAO}\n- Quanto custa a drenagem?\n- Tem Unimed?`,
    );
    expect(notaDaAnotacao([])).toBeNull();
    expect(
      ehNotaDaPassagemDaIa({
        author: "sistema",
        is_internal_note: true,
        body: nota,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Curiosidade geral de estetica
// ---------------------------------------------------------------------------

describe("curiosidade geral de estética (frase fixa do dono)", () => {
  it("'botox dói?': a frase fixa sai pelo filtro, sem o agente, e a conversa continua", async () => {
    const { cliente, create } = clienteComRoteiro([]);
    const classificador = classificadorQueDiz(["assunto_clinico"]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        classificador,
        mensagens: [paciente("botox dói?")],
      }),
    );
    expect(r.tipo).toBe("resposta");
    expect(r.desfecho).toEqual({ tipo: "respondeu" });
    expect(r.resposta).toBe(
      `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${FRASE_DA_CURIOSIDADE_DE_ESTETICA}`,
    );
    // O portao deixou para o classificador confirmar; o agente nem foi
    // chamado; o verificador conferiu a frase (filtro inteiro).
    expect(classificador).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(aprovador).toHaveBeenCalledTimes(1);
    expect(r.trilha).toContainEqual({
      tipo: "outro",
      texto: PASSO_DA_CURIOSIDADE_DE_ESTETICA,
    });
    expect(r.ferramentasUsadas).toEqual([]);
  });

  it("a próxima mensagem ('sim, quero marcar') segue o fluxo normal, com o agente", async () => {
    const { cliente, create } = clienteComRoteiro([
      final("Ótimo! Para qual dia você prefere?"),
    ]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        mensagens: [
          paciente("botox dói?"),
          {
            autor: "assistente",
            autoria: "ia",
            texto: FRASE_DA_CURIOSIDADE_DE_ESTETICA,
          },
          paciente("sim, quero marcar"),
        ],
      }),
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.tipo).toBe("resposta");
    expect(r.trilha).not.toContainEqual({
      tipo: "outro",
      texto: PASSO_DA_CURIOSIDADE_DE_ESTETICA,
    });
  });

  it("só o classificador aponta ('quanto tempo dura o preenchimento?'): a mesma frase", async () => {
    expect(gatilhosDosTextos(["quanto tempo dura o preenchimento?"])).toEqual(
      [],
    );
    const { cliente, create } = clienteComRoteiro([]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        classificador: classificadorQueDiz(["assunto_clinico"]),
        mensagens: [paciente("quanto tempo dura o preenchimento?")],
      }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(r.resposta).toContain(FRASE_DA_CURIOSIDADE_DE_ESTETICA);
  });

  it("com a situação da pessoa ('botox dói? to grávida'): escala, como hoje", async () => {
    const { cliente, create } = clienteComRoteiro([]);
    const classificador = classificadorQueDiz(["assunto_clinico"]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        classificador,
        mensagens: [paciente("botox dói? to grávida")],
      }),
    );
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({ tipo: "escalou", origem: "portao" });
    expect(classificador).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("o classificador aponta outro gatilho junto (menor de idade): o portão decide, como hoje", async () => {
    const { cliente, create } = clienteComRoteiro([]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        classificador: classificadorQueDiz(["sintoma", "menor_de_idade"]),
        mensagens: [paciente("botox dói?")],
      }),
    );
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "sintoma",
      gatilho: "sintoma",
      origem: "portao",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("o classificador que falha também devolve a decisão ao portão", async () => {
    const { cliente } = clienteComRoteiro([]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        classificador: vi.fn<ClassificadorDeEntrada>(async () => ({
          tipo: "falha",
          motivo: "timeout",
          modelo: null,
          uso: null,
          httpStatus: null,
        })),
        mensagens: [paciente("é seguro?")],
      }),
    );
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "assunto_clinico",
      origem: "portao",
    });
  });

  it("verificador fora do ar: a frase não sai (falha fechada, passageira)", async () => {
    const { cliente } = clienteComRoteiro([]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        classificador: classificadorQueDiz(["assunto_clinico"]),
        mensagens: [paciente("botox dói?")],
        verificador: async () => ({
          tipo: "falha",
          motivo: "timeout",
          modelo: null,
          uso: null,
          httpStatus: null,
        }),
      }),
    );
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({
      tipo: "bloqueou",
      categoria: "falha_verificador",
    });
    expect(r.passageira).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Nao desistir cedo
// ---------------------------------------------------------------------------

describe("não desistir cedo", () => {
  it("seis mensagens curtas não escalam pela quantidade; só o tamanho (ou o teto do histórico) escala", () => {
    const seis = [
      "oi",
      "bom dia",
      "queria saber",
      "o preço",
      "da limpeza de pele",
      "aceita unimed",
    ];
    expect(gatilhosDosTextos(seis)).toEqual([]);
    expect(MAXIMO_DE_MENSAGENS_NO_CONTEXTO).toBeLessThan(MENSAGENS_NO_HISTORICO);
    expect(
      gatilhosDosTextos(
        Array.from({ length: MAXIMO_DE_MENSAGENS_NO_CONTEXTO + 1 }, () => "oi"),
      ),
    ).toContain("mensagem_longa");
    expect(
      gatilhosDosTextos(["a".repeat(900), "b".repeat(900), "c".repeat(300)]),
    ).toContain("mensagem_longa");
    expect(LIMITE_DA_RAJADA).toBe(2000);
  });

  it("as seis curtas vão inteiras ao classificador e ao verificador", async () => {
    const seis = [
      "oi",
      "bom dia",
      "queria saber",
      "o preço",
      "da limpeza de pele",
      "aceita unimed",
    ];
    const classificador = classificadorQueDiz(["nenhum"]);
    const { cliente } = clienteComRoteiro([final("Posso te ajudar com isso!")]);
    const r = await executarTurnoDoAgente(
      entrada({ cliente, classificador, mensagens: seis.map(paciente) }),
    );
    expect(r.tipo).toBe("resposta");
    expect(classificador.mock.calls[0]?.[0].mensagens).toHaveLength(6);
    expect(aprovador.mock.calls[0]?.[0].mensagensDoPaciente).toHaveLength(6);
  });

  it("a última rodada pede a resposta sem ferramenta, em vez de esgotar", async () => {
    const roteiro: unknown[] = Array.from(
      { length: MAXIMO_DE_RODADAS - 1 },
      (_, i) =>
        ferramenta(
          "buscar_procedimento",
          { procedimento: "p1", convenio: null },
          `call_${i}`,
        ),
    );
    roteiro.push(final("A consulta custa R$ 317,00."));
    const { cliente, chamadas } = clienteComRoteiro(roteiro);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.tipo).toBe("resposta");
    expect(chamadas).toHaveLength(MAXIMO_DE_RODADAS);
    expect(chamadas.slice(0, -1).map((c) => c.tool_choice)).toEqual(
      Array.from({ length: MAXIMO_DE_RODADAS - 1 }, () => "auto"),
    );
    expect(chamadas[MAXIMO_DE_RODADAS - 1]?.tool_choice).toBe("none");
  });

  it("'Um momento, por favor.' ganha a reescrita única (como formato), sem passar", async () => {
    const { cliente, chamadas } = clienteComRoteiro([
      final("Um momento, por favor."),
      final("Temos sim, na rua ao lado."),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.tipo).toBe("resposta");
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]?.tool_choice).toBe("none");
    expect(JSON.stringify(chamadas[1]?.input)).toContain(
      AVISOS_DA_REESCRITA.promessa_de_retorno,
    );
  });

  it("'Vou verificar a agenda.' duas vezes: passa, como antes", async () => {
    const { cliente } = clienteComRoteiro([
      final("Vou verificar a agenda."),
      final("Vou verificar a agenda e já te retorno."),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      origem: "texto_do_agente",
    });
  });

  it("a promessa explícita de passar para a equipe continua passando na hora", async () => {
    const { cliente, create } = clienteComRoteiro([
      final("Vou passar sua conversa para a equipe."),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "agente_pediu",
      origem: "texto_do_agente",
    });
  });

  it("os dois pesos da promessa", () => {
    expect(promessaDaResposta("Um momento, por favor.")).toBe("retorno");
    expect(promessaDaResposta("Vou verificar a agenda.")).toBe("retorno");
    expect(promessaDaResposta("Já te retorno.")).toBe("retorno");
    expect(promessaDaResposta("Vou te transferir para um atendente.")).toBe(
      "passagem",
    );
    expect(promessaDaResposta("A equipe vai te responder em breve.")).toBe(
      "passagem",
    );
    const anotou = { usouFerramenta: true, acoes: [], anotouParaAEquipe: true };
    expect(
      promessaDaResposta(
        "Deixei sua pergunta anotada para a equipe responder por aqui.",
        anotou,
      ),
    ).toBeNull();
    expect(
      promessaDaResposta(
        "Anotei sua dúvida para a equipe, que vai te responder por aqui.",
        anotou,
      ),
    ).toBeNull();
    expect(
      promessaDaResposta(
        "Deixei anotado e a equipe te responde amanhã.",
        anotou,
      ),
    ).toBe("prazo_da_anotacao");
    // Outro canal nao e anotar: passa.
    expect(
      promessaDaResposta("Deixei anotado e a equipe vai te ligar.", anotou),
    ).toBe("passagem");
  });

  it("o erro do próprio modelo não conta contra o paciente (nem soma nem zera)", () => {
    expect(falhasDepoisDoTurno(0, ["codigo_invalido"])).toBe(0);
    expect(falhasDepoisDoTurno(1, ["entrada_invalida"])).toBe(1);
    expect(falhasDepoisDoTurno(1, ["sem_confirmacao_do_paciente"])).toBe(1);
    // O dado do paciente continua contando.
    expect(falhasDepoisDoTurno(1, ["cpf_invalido"])).toBe(2);
    expect(falhasDepoisDoTurno(1, ["codigo_invalido", "cpf_invalido"])).toBe(2);
  });

  it.each([
    [
      "429 de ritmo",
      new RateLimitError(
        429,
        { type: "rate_limit_error", code: "rate_limit_exceeded" },
        "x",
        new Headers(),
      ),
      "limite",
      true,
    ],
    ["timeout", new APIConnectionTimeoutError(), "timeout", true],
    [
      "429 de cota (não é passageira)",
      new RateLimitError(
        429,
        { type: "insufficient_quota", code: "credit_balance_exhausted" },
        "x",
        new Headers(),
      ),
      "cota",
      false,
    ],
  ])(
    "o agente com %s: falha fechada e marcada para a fila só quando passageira",
    async (_n, erro, motivo, passageira) => {
      const { cliente } = clienteComRoteiro([erro, erro]);
      const r = await executarTurnoDoAgente(entrada({ cliente }));
      expect(r.tipo).toBe("frase_fixa");
      expect(r.desfecho).toEqual({ tipo: "falhou", motivo });
      expect(r.passageira === true).toBe(passageira);
    },
  );

  it("o classificador incoerente ou em dúvida também é passageiro", async () => {
    const { cliente } = clienteComRoteiro([]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        classificador: vi.fn<ClassificadorDeEntrada>(
          async () =>
            ({
              tipo: "classificacao",
              classificacao: { gatilhos: ["nenhum"], confianca: "baixa" },
              modelo: "gpt-6-luna",
              uso: { ...USO_LIDO },
            }) as ResultadoDoClassificador,
        ),
      }),
    );
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "confianca_baixa" });
    expect(r.passageira).toBe(true);
  });
});
