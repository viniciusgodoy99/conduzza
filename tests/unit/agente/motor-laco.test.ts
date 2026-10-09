import { APIConnectionError, BadRequestError } from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { montarCatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import { custoMaximoDaChamada, tokensNoMaximo } from "@/lib/agente/gasto";
import {
  comporResposta,
  custoMaximoDoTurno,
  executarTurnoDoAgente,
  historicoParaOModelo,
  MAX_TOKENS_DO_AGENTE,
  MAXIMO_DE_RODADAS,
  mensagensPendentes,
  PASSO_SEM_CONSULTA,
  type ClienteDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import { TEXTO_FIXO_DO_AGENTE, VERSAO_DO_PROMPT } from "@/lib/agente/prompt";
import {
  configPadraoDoAgente,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import { LIMITE_DO_RASCUNHO } from "@/lib/domain/conformidade/filtro-deterministico";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import {
  MAX_TOKENS_DO_CLASSIFICADOR,
  type ClassificadorDeEntrada,
  type ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";
import { MAX_TOKENS_DO_VERIFICADOR } from "@/lib/integrations/llm/verificador";

// O turno do agente (lib/agente/laco.ts) com um LLM FALSO de roteiro: cada
// chamada a responses.create devolve o proximo item do roteiro. Prova os
// parametros fixos (store false, raciocinio cifrado, cache por clinica,
// safety_identifier, sem previous_response_id), o laco com ferramenta, o
// escalonamento, a falha fechada, o teto de rodadas, a trava, a saudacao e o
// encerramento antes do filtro, e que nada do paciente vai para a trilha nem
// para o log. Nenhum teste fala com a OpenAI.

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
  return {
    ...configPadraoDoAgente(),
    nome: "Ana",
    saudacao: "Olá! Aqui é a Ana, da clínica.",
    encerramento: "Até breve!",
    base: [
      {
        id: "k1",
        pergunta: "Tem estacionamento?",
        resposta: "Sim, na rua ao lado.",
        ativo: true,
      },
    ],
    ...extra,
  };
}

// --- respostas da API ------------------------------------------------------

const RACIOCINIO = {
  type: "reasoning",
  id: "rs_1",
  summary: [],
  encrypted_content: "conteudo-cifrado",
};

function resposta(output: unknown[], extra: Record<string, unknown> = {}) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output,
    usage: USO_DA_API,
    _request_id: "req_123",
    ...extra,
  };
}

function mensagemComTexto(texto: string) {
  return {
    type: "message",
    id: "msg_1",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: texto, annotations: [] }],
  };
}

function final(
  mensagem: string,
  extra: { encerra?: boolean; perguntas?: string[] } = {},
) {
  return resposta([
    RACIOCINIO,
    mensagemComTexto(
      JSON.stringify({
        mensagem,
        encerra_a_conversa: extra.encerra ?? false,
        perguntas_da_base: extra.perguntas ?? [],
      }),
    ),
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

// --- falsos -----------------------------------------------------------------

type Passo = unknown | Error | (() => unknown);

function clienteComRoteiro(roteiro: Passo[]) {
  const chamadas: { corpo: Record<string, unknown>; opcoes: unknown }[] = [];
  const create = vi.fn(async (corpo: unknown, opcoes: unknown) => {
    chamadas.push({
      corpo: structuredClone(corpo) as Record<string, unknown>,
      opcoes,
    });
    const proximo = roteiro.shift();
    if (proximo instanceof Error) {
      throw proximo;
    }
    if (typeof proximo === "function") {
      return (proximo as () => unknown)();
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
  resultado: ResultadoDoClassificador,
): ReturnType<typeof vi.fn<ClassificadorDeEntrada>> {
  return vi.fn<ClassificadorDeEntrada>(async () => resultado);
}

const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: { ...USO_LIDO },
};

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
    mensagens: [paciente("Oi, vocês têm estacionamento?")],
    agoraMs: Date.UTC(2026, 9, 6, 20, 45),
    fuso: "America/Fortaleza",
    verificador: aprovador,
    classificador: classificadorQueDiz(LIMPO),
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

describe("executarTurnoDoAgente: resposta", () => {
  it("responde com o texto aprovado e os parâmetros fixos da chamada", async () => {
    const { cliente, chamadas } = clienteComRoteiro([
      final("Temos sim, na rua ao lado.", { perguntas: ["b1", "b9"] }),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));

    expect(r.tipo).toBe("resposta");
    expect(r.resposta).toBe(
      "Olá! Aqui é a Ana, da clínica.\n\nTemos sim, na rua ao lado.",
    );
    expect(r.desfecho).toEqual({ tipo: "respondeu" });
    expect(r.versaoDoPrompt).toBe(VERSAO_DO_PROMPT);
    expect(r.filtro?.aprovado).toBe(true);

    expect(chamadas).toHaveLength(1);
    const corpo = chamadas[0]?.corpo ?? {};
    expect(corpo).toMatchObject({
      model: "gpt-6-luna",
      reasoning: { effort: "low" },
      include: ["reasoning.encrypted_content"],
      store: false,
      service_tier: "default",
      tool_choice: "auto",
      parallel_tool_calls: false,
      prompt_cache_key: `conduzza:agente:${CLINICA}`,
      safety_identifier: IDENTIFICADOR,
    });
    for (const proibido of [
      "previous_response_id",
      "conversation",
      "background",
      "metadata",
      "prompt",
      "temperature",
    ]) {
      expect(corpo, proibido).not.toHaveProperty(proibido);
    }
    expect(String(corpo.instructions).startsWith(TEXTO_FIXO_DO_AGENTE)).toBe(
      true,
    );
    expect((corpo.tools as { name: string }[]).map((t) => t.name)).toEqual([
      "buscar_procedimento",
      "escalar_humano",
    ]);
    expect(
      (corpo.text as { format: { name: string; strict: boolean } }).format,
    ).toMatchObject({ name: "resposta_da_recepcao", strict: true });
    expect(corpo.input).toEqual([
      { role: "user", content: "Oi, vocês têm estacionamento?" },
    ]);

    expect(r.trilha.map((p) => p.texto)).toEqual([
      "A mensagem foi conferida antes de chegar ao assistente.",
      "Usou a pergunta da base: Tem estacionamento?",
      "A resposta passou na conformidade.",
    ]);
    expect(r.uso.map((u) => u.papel)).toEqual([
      "classificador",
      "agente",
      "verificador",
    ]);
    expect(r.uso[1]?.uso).toEqual(USO_LIDO);
  });

  it("consulta o preço e devolve à próxima rodada o raciocínio e a saída da ferramenta", async () => {
    const { cliente, chamadas } = clienteComRoteiro([
      ferramenta("buscar_procedimento", { procedimento: "p1", convenio: null }),
      final("A consulta com a Dra. Helena fica R$ 317,00."),
    ]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        config: config({ saudacao: null }),
        mensagens: [paciente("Quanto custa a consulta?")],
      }),
    );
    expect(r.tipo).toBe("resposta");
    expect(r.resposta).toBe("A consulta com a Dra. Helena fica R$ 317,00.");
    expect(chamadas).toHaveLength(2);
    const input = chamadas[1]?.corpo.input as Record<string, unknown>[];
    expect(input).toContainEqual(expect.objectContaining(RACIOCINIO));
    expect(input).toContainEqual(
      expect.objectContaining({ type: "function_call", call_id: "call_1" }),
    );
    const saida = input.find((i) => i.type === "function_call_output");
    expect(saida).toMatchObject({ call_id: "call_1" });
    expect(String(saida?.output)).toContain("R$ 317,00");
    expect(r.trilha.map((p) => [p.tipo, p.texto])).toContainEqual([
      "preco",
      "Consultou o preço de Consulta",
    ]);
    expect(r.uso.filter((u) => u.papel === "agente")).toHaveLength(2);
  });

  it("saudação só na primeira resposta; encerramento só quando a conversa termina", async () => {
    const { cliente } = clienteComRoteiro([
      final("Por nada, estamos à disposição.", { encerra: true }),
    ]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        mensagens: [
          paciente("Tem estacionamento?"),
          { autor: "assistente", texto: "Temos sim, na rua ao lado." },
          paciente("Obrigada!"),
        ],
      }),
    );
    expect(r.tipo).toBe("resposta");
    expect(r.resposta).toBe("Por nada, estamos à disposição.\n\nAté breve!");
  });
});

describe("executarTurnoDoAgente: bloqueio e escalonamento", () => {
  it("valor que não veio da ferramenta é bloqueado: frase fixa, sem chamar o verificador", async () => {
    const { cliente } = clienteComRoteiro([
      final("A consulta fica R$ 200,00."),
    ]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        config: config({ saudacao: null }),
        mensagens: [paciente("Quanto custa a consulta?")],
      }),
    );
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.desfecho).toMatchObject({
      tipo: "bloqueou",
      categoria: "preco_nao_verificado",
      camada: "regra",
    });
    expect(r.rascunhoBloqueado).toBe("A consulta fica R$ 200,00.");
    expect(aprovador).not.toHaveBeenCalled();
    expect(r.trilha.map((p) => [p.tipo, p.texto])).toContainEqual([
      "bloqueio",
      "A resposta foi bloqueada pela conformidade: preço fora do cadastro.",
    ]);
  });

  it("escalar_humano encerra na hora, sem outra rodada", async () => {
    const { cliente, create } = clienteComRoteiro([
      ferramenta("escalar_humano", { motivo: "agente_pediu" }),
      final("não deveria chegar aqui"),
    ]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        mensagens: [paciente("Queria marcar um horário para esta semana.")],
      }),
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "agente_pediu",
      gatilho: null,
      origem: "agente",
    });
    expect(r.trilha.at(-1)).toEqual({
      tipo: "equipe",
      texto: "Passou para a equipe: o assistente preferiu passar para a equipe",
    });
  });

  it("motivo fora da lista ainda escala (agente_pediu)", async () => {
    const { cliente } = clienteComRoteiro([
      ferramenta("escalar_humano", { motivo: "teto_atingido" }),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "agente_pediu",
    });
  });

  it("o portão determinístico escala sintoma sem chamar o classificador nem o modelo", async () => {
    const { cliente, create } = clienteComRoteiro([final("x")]);
    const classificador = classificadorQueDiz(LIMPO);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        classificador,
        mensagens: [
          paciente("Estou com dor de cabeça forte desde ontem. O que eu faço?"),
        ],
      }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(classificador).not.toHaveBeenCalled();
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "sintoma",
      gatilho: "sintoma",
      origem: "portao",
    });
    expect(r.uso).toEqual([]);
  });

  it("o classificador aponta um gatilho: escala antes do modelo", async () => {
    const { cliente, create } = clienteComRoteiro([final("x")]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        classificador: classificadorQueDiz({
          ...LIMPO,
          tipo: "classificacao",
          classificacao: { gatilhos: ["pedido_humano"], confianca: "alta" },
        }),
      }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "pedido_humano",
      origem: "classificador",
    });
    expect(r.uso.map((u) => u.papel)).toEqual(["classificador"]);
  });

  it("classificador com falha, incoerente ou em dúvida: falha fechada", async () => {
    const casos: [ResultadoDoClassificador, string][] = [
      [
        {
          tipo: "falha",
          motivo: "timeout",
          modelo: "gpt-6-luna",
          uso: null,
          httpStatus: null,
        },
        "timeout",
      ],
      [
        {
          ...LIMPO,
          tipo: "classificacao",
          classificacao: { gatilhos: ["nenhum"], confianca: "baixa" },
        },
        "confianca_baixa",
      ],
      [
        {
          ...LIMPO,
          tipo: "classificacao",
          classificacao: { gatilhos: [], confianca: "alta" },
        },
        "incoerente",
      ],
    ];
    for (const [resultado, motivo] of casos) {
      const { cliente, create } = clienteComRoteiro([final("x")]);
      const r = await executarTurnoDoAgente(
        entrada({ cliente, classificador: classificadorQueDiz(resultado) }),
      );
      expect(create, motivo).not.toHaveBeenCalled();
      expect(r.tipo).toBe("frase_fixa");
      expect(r.desfecho).toEqual({ tipo: "falhou", motivo });
    }
  });
});

describe("executarTurnoDoAgente: falha fechada do modelo", () => {
  const casos: [string, Passo, string][] = [
    [
      "erro de conexão",
      new APIConnectionError({ message: "eco: Meu CPF é 123.456.789-09" }),
      "conexao",
    ],
    [
      "resposta incompleta por tamanho",
      resposta([RACIOCINIO], {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      }),
      "max_tokens",
    ],
    [
      "recusa",
      resposta([
        {
          type: "message",
          role: "assistant",
          content: [{ type: "refusal", refusal: "não" }],
        },
      ]),
      "recusa",
    ],
    [
      "status falho",
      resposta([RACIOCINIO], { status: "failed" }),
      "parada_inesperada",
    ],
    [
      "item inesperado",
      resposta([{ type: "web_search_call", id: "ws_1" }]),
      "parada_inesperada",
    ],
    ["saída sem JSON", resposta([mensagemComTexto("Olá!")]), "saida_invalida"],
    [
      "JSON fora do formato",
      resposta([mensagemComTexto(JSON.stringify({ mensagem: "Oi" }))]),
      "saida_invalida",
    ],
    [
      "mensagem vazia",
      resposta([
        mensagemComTexto(
          JSON.stringify({
            mensagem: "  ",
            encerra_a_conversa: false,
            perguntas_da_base: [],
          }),
        ),
      ]),
      "saida_invalida",
    ],
    ["resposta nula", null, "saida_invalida"],
    [
      "ferramenta desconhecida",
      ferramenta("agendar", { dia: "amanhã" }),
      "ferramenta_invalida",
    ],
  ];

  it.each(casos)("%s vira frase fixa", async (_nome, passo, motivo) => {
    const { cliente } = clienteComRoteiro([passo]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo });
  });

  it("buscar_procedimento com a habilidade desligada não está nas ferramentas e é recusado", async () => {
    const base = config();
    const { cliente, chamadas } = clienteComRoteiro([
      ferramenta("buscar_procedimento", { procedimento: "p1", convenio: null }),
    ]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        config: config({
          habilidades: {
            ...base.habilidades,
            informar_preco_e_convenio: false,
          },
        }),
      }),
    );
    expect(
      (chamadas[0]?.corpo.tools as { name: string }[]).map((t) => t.name),
    ).toEqual(["escalar_humano"]);
    expect(r.desfecho).toEqual({
      tipo: "falhou",
      motivo: "ferramenta_invalida",
    });
  });

  it(`para depois de ${MAXIMO_DE_RODADAS} rodadas sem resposta final`, async () => {
    const roteiro = Array.from({ length: MAXIMO_DE_RODADAS + 2 }, (_, i) =>
      ferramenta(
        "buscar_procedimento",
        { procedimento: "p1", convenio: null },
        `call_${i}`,
      ),
    );
    const { cliente, create } = clienteComRoteiro(roteiro);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(create).toHaveBeenCalledTimes(MAXIMO_DE_RODADAS);
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "rodadas_esgotadas" });
  });

  it("trava conferida antes de cada rodada: desligou no meio, para sem chamar de novo", async () => {
    const { cliente, create } = clienteComRoteiro([
      ferramenta("buscar_procedimento", { procedimento: "p1", convenio: null }),
      final("não deveria chegar aqui"),
    ]);
    const respostas = [true, false];
    const conferirTrava = vi.fn(async () => respostas.shift() ?? false);
    const r = await executarTurnoDoAgente(entrada({ cliente, conferirTrava }));
    expect(conferirTrava).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.desfecho).toEqual({
      tipo: "falhou",
      motivo: "liberacao_suspensa",
    });
  });

  it("trava que lança também para", async () => {
    const { cliente, create } = clienteComRoteiro([final("x")]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        conferirTrava: async () => {
          throw new Error("rede");
        },
      }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(r.desfecho).toEqual({
      tipo: "falhou",
      motivo: "liberacao_suspensa",
    });
  });

  it("sem cliente, sem modelo ou com identificador fora do formato não chama ninguém", async () => {
    const classificador = classificadorQueDiz(LIMPO);
    for (const [extra, motivo] of [
      [{ semCliente: true }, "sem_cliente"],
      [{ modelo: null }, "modelo_invalido"],
      [{ identificadorDeSeguranca: "5585999998888" }, "sem_identificador"],
      [{ identificadorDeSeguranca: null }, "sem_identificador"],
    ] as const) {
      const { cliente, create } = clienteComRoteiro([final("x")]);
      const semCliente = "semCliente" in extra;
      const resto = "semCliente" in extra ? {} : extra;
      const r = await executarTurnoDoAgente(
        entrada({
          ...resto,
          cliente: semCliente ? null : cliente,
          classificador,
        }),
      );
      expect(create, motivo).not.toHaveBeenCalled();
      expect(r.desfecho).toEqual({ tipo: "falhou", motivo });
    }
    expect(classificador).not.toHaveBeenCalled();
  });

  it("sem tempo para a rodada: não chama o modelo", async () => {
    const { cliente, create } = clienteComRoteiro([final("x")]);
    const r = await executarTurnoDoAgente(entrada({ cliente, prazoMs: 5_000 }));
    expect(create).not.toHaveBeenCalled();
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "prazo" });
  });

  it("modelo que nunca responde é cortado pelo prazo", async () => {
    const { cliente } = clienteComRoteiro([() => new Promise(() => undefined)]);
    const r = await executarTurnoDoAgente(
      entrada({ cliente, prazoMs: 11_200 }),
    );
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "timeout" });
  }, 10_000);

  it("última mensagem que não é do paciente: nada a responder", async () => {
    const { cliente, create } = clienteComRoteiro([final("x")]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        mensagens: [paciente("Oi"), { autor: "assistente", texto: "Olá!" }],
      }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "sem_mensagem" });
  });
});

describe("dado do paciente", () => {
  it("vai minimizado ao modelo e nunca aparece na trilha nem no log", async () => {
    const segredo = "Meu CPF é 123.456.789-09, quanto custa a consulta?";
    const { cliente, chamadas } = clienteComRoteiro([
      new APIConnectionError({ message: `eco do servidor: ${segredo}` }),
    ]);
    const r = await executarTurnoDoAgente(
      entrada({ cliente, mensagens: [paciente(segredo)] }),
    );
    const input = JSON.stringify(chamadas[0]?.corpo.input);
    expect(input).toContain("[cpf]");
    expect(input).not.toContain("123.456.789-09");
    const tudo = `${JSON.stringify(r.trilha)}${escrito.join("")}`;
    expect(escrito.join("")).toContain("ia_agente_falhou");
    expect(tudo).not.toContain("123.456");
    expect(tudo).not.toContain("CPF");
    expect(tudo).not.toContain("quanto custa");
  });
});

describe("peças puras do laço", () => {
  it("mensagensPendentes: só as do paciente depois da última resposta", () => {
    const conversa: MensagemDaConversa[] = [
      paciente("a"),
      { autor: "assistente", texto: "b" },
      paciente("c"),
      paciente("d"),
    ];
    expect(mensagensPendentes(conversa).map((m) => m.texto)).toEqual([
      "c",
      "d",
    ]);
    expect(
      mensagensPendentes([...conversa, { autor: "assistente", texto: "e" }]),
    ).toEqual([]);
  });

  it("historicoParaOModelo: as 20 mais recentes, papéis certos e mídia sem conteúdo", () => {
    const conversa: MensagemDaConversa[] = Array.from({ length: 25 }, (_, i) =>
      i % 2 === 0 ? paciente(`p${i}`) : { autor: "assistente", texto: `a${i}` },
    );
    conversa.push({ autor: "paciente", texto: null, tipo: "imagem" });
    const historico = historicoParaOModelo(conversa) as {
      role: string;
      content: string;
    }[];
    expect(historico).toHaveLength(20);
    expect(historico.at(-1)).toEqual({
      role: "user",
      content: "(o paciente mandou um conteúdo que não é texto)",
    });
    expect(historico.at(-2)).toEqual({ role: "user", content: "p24" });
  });

  it("comporResposta tira o encerramento e depois a saudação quando passa do limite, nunca a resposta", () => {
    const saudacao = "S".repeat(200);
    const encerramento = "E".repeat(200);
    const curta = comporResposta({
      mensagem: "Oi",
      saudacao,
      encerramento,
      primeiraResposta: true,
      encerra: true,
    });
    expect(curta).toBe(`${saudacao}\n\nOi\n\n${encerramento}`);

    const media = "M".repeat(LIMITE_DO_RASCUNHO - 202);
    expect(
      comporResposta({
        mensagem: media,
        saudacao,
        encerramento,
        primeiraResposta: true,
        encerra: true,
      }),
    ).toBe(`${saudacao}\n\n${media}`);

    const longa = "L".repeat(LIMITE_DO_RASCUNHO - 10);
    expect(
      comporResposta({
        mensagem: longa,
        saudacao,
        encerramento,
        primeiraResposta: true,
        encerra: true,
      }),
    ).toBe(longa);

    expect(
      comporResposta({
        mensagem: "Oi",
        saudacao,
        encerramento,
        primeiraResposta: false,
        encerra: false,
      }),
    ).toBe("Oi");
  });
});

// ---------------------------------------------------------------------------
// Revisao adversarial de 06/10/2026
// ---------------------------------------------------------------------------

const PRECOS = [
  {
    modelo: "gpt-6-luna",
    entrada: 100_000,
    saida: 500_000,
    cacheLeitura: 10_000,
    cacheEscrita: 125_000,
  },
];

function respostaFinalEmJson(mensagem: string): string {
  return JSON.stringify({
    mensagem,
    encerra_a_conversa: false,
    perguntas_da_base: [],
  });
}

describe("revisão: a resposta é só a mensagem final (achado 22)", () => {
  it("comentário antes da final fica de fora; duas finais são saída inválida", async () => {
    const comentario = {
      ...mensagemComTexto("Vou conferir para você."),
      id: "msg_0",
      phase: "commentary",
    };
    const daFinal = {
      ...mensagemComTexto(respostaFinalEmJson("Temos sim, na rua ao lado.")),
      phase: "final_answer",
    };
    const { cliente } = clienteComRoteiro([
      resposta([RACIOCINIO, comentario, daFinal]),
    ]);
    const r = await executarTurnoDoAgente(
      entrada({ cliente, config: config({ saudacao: null }) }),
    );
    expect(r.tipo).toBe("resposta");
    expect(r.resposta).toBe("Temos sim, na rua ao lado.");

    const duas = clienteComRoteiro([
      resposta([
        mensagemComTexto(respostaFinalEmJson("Uma.")),
        mensagemComTexto(respostaFinalEmJson("Outra.")),
      ]),
    ]);
    const r2 = await executarTurnoDoAgente(entrada({ cliente: duas.cliente }));
    expect(r2.desfecho).toEqual({ tipo: "falhou", motivo: "saida_invalida" });

    const soComentario = clienteComRoteiro([resposta([comentario])]);
    const r3 = await executarTurnoDoAgente(
      entrada({ cliente: soComentario.cliente }),
    );
    expect(r3.desfecho).toEqual({ tipo: "falhou", motivo: "saida_invalida" });
  });
});

describe("revisão: trilha sem consulta (achado 33)", () => {
  it("sem preço nem base, diz que respondeu só com a configuração; com consulta, não", async () => {
    const { cliente } = clienteComRoteiro([
      final("Funcionamos de segunda a sexta."),
    ]);
    const r = await executarTurnoDoAgente(
      entrada({ cliente, config: config({ saudacao: null }) }),
    );
    expect(r.trilha.map((p) => p.texto)).toEqual([
      "A mensagem foi conferida antes de chegar ao assistente.",
      PASSO_SEM_CONSULTA,
      "A resposta passou na conformidade.",
    ]);

    const comPreco = clienteComRoteiro([
      ferramenta("buscar_procedimento", { procedimento: "p1", convenio: null }),
      final("A consulta fica R$ 317,00."),
    ]);
    const r2 = await executarTurnoDoAgente(
      entrada({
        cliente: comPreco.cliente,
        config: config({ saudacao: null }),
      }),
    );
    expect(r2.trilha.map((p) => p.texto)).not.toContain(PASSO_SEM_CONSULTA);
  });
});

describe("revisão: toda chamada que pode ter sido cobrada entra no gasto (achado 21)", () => {
  it("rodada do agente abortada, com erro de rede ou sem usage entra com a estimativa máxima", async () => {
    const semUsage = resposta([
      RACIOCINIO,
      mensagemComTexto(respostaFinalEmJson("Temos sim.")),
    ]);
    delete (semUsage as { usage?: unknown }).usage;
    for (const passo of [
      new APIConnectionError({ message: "rede" }),
      semUsage,
    ]) {
      const { cliente, chamadas } = clienteComRoteiro([passo]);
      const r = await executarTurnoDoAgente(entrada({ cliente }));
      const doAgente = r.uso.filter((u) => u.papel === "agente");
      expect(doAgente).toHaveLength(1);
      expect(doAgente[0]?.modelo).toBe("gpt-6-luna");
      expect(doAgente[0]?.uso.tokensSaida).toBe(MAX_TOKENS_DO_AGENTE);
      // A entrada estimada nunca fica abaixo dos bytes do que foi mandado.
      expect(doAgente[0]?.uso.tokensEntrada).toBeGreaterThanOrEqual(
        tokensNoMaximo(String(chamadas[0]?.corpo.instructions)),
      );
    }
  });

  it("recusa da API antes de processar (400) não entra", async () => {
    const { cliente } = clienteComRoteiro([
      new BadRequestError(
        400,
        { type: "invalid_request_error", message: "x" },
        "x",
        new Headers(),
      ),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.desfecho).toEqual({
      tipo: "falhou",
      motivo: "requisicao_invalida",
    });
    expect(r.uso.filter((u) => u.papel === "agente")).toEqual([]);
  });

  it("classificador e verificador sem usage (prazo, rede) entram com a estimativa; os que nem saíram, não", async () => {
    const cortado: ResultadoDoClassificador = {
      tipo: "falha",
      motivo: "timeout",
      modelo: null,
      uso: null,
      httpStatus: null,
    };
    const { cliente } = clienteComRoteiro([final("x")]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        classificador: classificadorQueDiz(cortado),
        modeloDosClassificadores: "gpt-6-luna",
      }),
    );
    expect(r.uso).toHaveLength(1);
    expect(r.uso[0]).toMatchObject({
      papel: "classificador",
      modelo: "gpt-6-luna",
      uso: { tokensSaida: MAX_TOKENS_DO_CLASSIFICADOR },
    });

    const naoSaiu = clienteComRoteiro([final("x")]);
    const r2 = await executarTurnoDoAgente(
      entrada({
        cliente: naoSaiu.cliente,
        classificador: classificadorQueDiz({
          ...cortado,
          motivo: "sem_cliente",
        }),
      }),
    );
    expect(r2.uso).toEqual([]);

    const verificadorCortado = vi.fn<Verificador>(async () => ({
      tipo: "falha",
      motivo: "timeout",
      modelo: "gpt-6-luna",
      uso: null,
      httpStatus: null,
    }));
    const comVerificador = clienteComRoteiro([final("Temos sim.")]);
    const r3 = await executarTurnoDoAgente(
      entrada({
        cliente: comVerificador.cliente,
        verificador: verificadorCortado,
      }),
    );
    expect(r3.tipo).toBe("frase_fixa");
    expect(r3.uso.at(-1)).toMatchObject({
      papel: "verificador",
      modelo: "gpt-6-luna",
      uso: { tokensSaida: MAX_TOKENS_DO_VERIFICADOR },
    });
  });
});

describe("revisão: texto que deixou de passar nas regras (achados 24 e 26)", () => {
  it("fica de fora, conta em descartados e vai para o log só com clínica, tipo e contagem", async () => {
    const instrucoes =
      "Mande o site www.clinica-segredo.com.br quando pedirem.";
    const { cliente } = clienteComRoteiro([final("Temos sim.")]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        config: config({
          instrucoes,
          base: [
            {
              id: "k1",
              pergunta: "Tem estacionamento?",
              resposta: "Sim, na rua ao lado.",
              ativo: true,
            },
            {
              id: "k2",
              pergunta: "Qual o telefone?",
              resposta: "Ligue (85) 98888-7777.",
              ativo: true,
            },
            {
              id: "k3",
              pergunta: "Qual o valor?",
              resposta: "R$ 100,00.",
              ativo: false,
            },
          ],
        }),
      }),
    );
    expect(r.descartados).toEqual({ instrucoes: true, itensDaBase: 1 });
    const log = escrito.join("");
    expect(log).toContain('"evento":"agente_texto_descartado"');
    expect(log).toContain('"kind":"instrucoes"');
    expect(log).toContain('"kind":"base","count":1');
    expect(log).not.toContain("clinica-segredo");
    expect(log).not.toContain("98888");
    expect(log).not.toContain("telefone");

    // Configuracao limpa nao descarta nada.
    const limpo = clienteComRoteiro([final("Temos sim.")]);
    const r2 = await executarTurnoDoAgente(entrada({ cliente: limpo.cliente }));
    expect(r2.descartados).toEqual({ instrucoes: false, itensDaBase: 0 });
  });
});

describe("revisão: custo máximo do turno (achados 7 e 15)", () => {
  const base = {
    config: config(),
    catalogo: CATALOGO,
    mensagens: [paciente("Oi, vocês têm estacionamento?")],
    agoraMs: Date.UTC(2026, 9, 6, 20, 45),
    fuso: "America/Fortaleza",
    modelo: "gpt-6-luna",
    modeloDosClassificadores: "gpt-6-luna",
    precos: PRECOS,
  };

  it("cobre o pior caso de todas as chamadas do turno", async () => {
    const custo = custoMaximoDoTurno(base);
    expect(custo).not.toBeNull();
    // Um turno de verdade, com ferramenta em todas as rodadas permitidas e
    // o uso que a API devolveu, custa menos que a reserva.
    const roteiro = Array.from({ length: MAXIMO_DE_RODADAS }, (_, i) =>
      ferramenta(
        "buscar_procedimento",
        { procedimento: "p1", convenio: null },
        `call_${i}`,
      ),
    );
    const { cliente } = clienteComRoteiro(roteiro);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    const real = r.uso.reduce(
      (soma, u) => soma + (custoMaximoDaChamada(u.uso, u.modelo, PRECOS) ?? 0),
      0,
    );
    expect(real).toBeGreaterThan(0);
    expect(custo ?? 0).toBeGreaterThan(real);
    // O teto de saida de todas as rodadas, no minimo.
    expect(custo ?? 0).toBeGreaterThanOrEqual(
      Math.ceil((MAXIMO_DE_RODADAS * MAX_TOKENS_DO_AGENTE * 500_000) / 1e6),
    );
  });

  it("cresce com a conversa e, sem preço, não reserva (falha fechada)", () => {
    const curta = custoMaximoDoTurno(base) ?? 0;
    const longa =
      custoMaximoDoTurno({
        ...base,
        mensagens: [
          paciente("x".repeat(900)),
          { autor: "assistente", texto: "y".repeat(500) },
          paciente("z".repeat(900)),
        ],
      }) ?? 0;
    expect(longa).toBeGreaterThan(curta);
    expect(custoMaximoDoTurno({ ...base, precos: [] })).toBeNull();
    // Modelo sem preco usa o maior de cada parte (conservador).
    expect(
      custoMaximoDoTurno({ ...base, modelo: "gpt-desconhecido" }),
    ).not.toBeNull();
  });
});
