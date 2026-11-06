import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  portaDaAgendaDoSimulador,
  portaDaAgendaDoWhatsapp,
} from "@/lib/agente/agenda";
import { dadosVazios, estadoVazio } from "@/lib/agente/atendimento";
import type { AtendimentoDoTurno } from "@/lib/agente/ferramentas/agenda-do-turno";
import type {
  CatalogoDoAgente,
  PreparoEmVigor,
} from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  citacaoDoProcedimento,
  decidirEnvioDoPreparo,
  FERRAMENTA_ENVIAR_PREPARO,
  NOME_DO_ENVIO_DO_PREPARO,
  PASSO_DO_PREPARO_FORA_DE_VIGOR,
  PASSO_DO_PROCEDIMENTO_NAO_CONFIRMADO,
  preparosEmVigorDaLeitura,
  textosDePreparoDaLeitura,
} from "@/lib/agente/ferramentas/enviar-preparo";
import { mascararNome } from "@/lib/agente/historico";
import { MARCA_DO_NOME } from "@/lib/agente/marca-do-nome";
import {
  comporResposta,
  executarTurnoDoAgente,
  PASSO_DO_PEDIDO_COM_SITUACAO_PESSOAL,
  type ClienteDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
  type ResultadoDoTurno,
} from "@/lib/agente/laco";
import { simularTurno } from "@/lib/agente/simulador";
import { ferramentaDoTurno } from "@/lib/agente/whatsapp";
import {
  motivoPodeAtribuir,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import { LIMITE_DO_RASCUNHO } from "@/lib/domain/conformidade/filtro-deterministico";
import {
  FRASE_DE_ESCALONAMENTO,
  FRASE_DO_ASSISTENTE_VIRTUAL,
} from "@/lib/domain/conformidade/frase-fixa";
import type {
  EntradaDoVerificador,
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import {
  codigoDoTexto,
  FRASE_DO_PREPARO_DEPOIS_DE_MARCAR,
  mensagemDoPreparo,
} from "@/lib/domain/preparo";
import {
  versaoDaPoliticaDoClassificador,
  VERSAO_DA_POLITICA_DO_CLASSIFICADOR,
  type ClassificadorDeEntrada,
  type ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";

import {
  FRASE_DO_PREPARO_SO_DO_TRECHO,
  RT_DE_TESTE,
  TEXTO_DO_PREPARO_DE_TESTE,
} from "../../fixtures/ia/conformidade/casos";
import { bancoDaAg3, rpcsDaAg3 } from "./ag3-contrato";
import {
  C1,
  CATALOGO_DA_AG4,
  CenarioDaAg4,
  configDaAg4,
  consultasDoContato,
} from "./ag4-conversa";
import { AgendaEmMemoria, type Linha } from "./agenda-em-memoria";
import {
  AGORA,
  bancoComJornadas,
  CLINICA,
  configComAgenda,
  CONTATO,
  CONVERSA,
  FUSO,
  PROC,
} from "./agenda-fixtures";
import {
  catalogoDoCadastro,
  linhasDoCadastro,
  PROC_AG2,
} from "./cadastro-fixtures";

// AG7 (03/11/2026): o turno com enviar_preparo, com o LLM FALSO de roteiro.
// O modelo so escolhe o procedimento; com versao em vigor, o turno termina
// SEM texto do modelo, sem filtro e sem verificador (o resultado "preparo":
// o executor manda a mensagem do sistema montada pelo banco). Sem versao em
// vigor, passa para a equipe (assunto_clinico); so com a equipe, a regra do
// procedimento. A ferramenta so vale sozinha no turno. A F2 entra depois da
// resposta que marcou um procedimento com texto em vigor (e nunca na
// remarcacao). O modelo que escreve preparo, parafraseia ou copia um trecho
// do texto da clinica e barrado. E NENHUM texto de preparo da clinica sai do
// servidor: nem no prompt, nem nas saidas das ferramentas, nem no historico
// que vai a OpenAI. Nenhum teste fala com a OpenAI.

const IDENTIFICADOR = "a".repeat(64);
const NOME_DO_CONTATO = "Maria Souza";
/** O prep_instructions antigo (o que a regua mandou antes da AG7). */
const PREP_ANTIGO = "Venha sem maquiagem e com o rosto limpo, por favor.";
const SHA_DO_TEXTO = sha256DoTexto(TEXTO_DO_PREPARO_DE_TESTE);
const VERSAO = {
  exame: "e7e70000-0000-4000-8000-000000000002",
  consulta: "e7e70000-0000-4000-8000-000000000001",
  botox: "e7e70000-0000-4000-8000-000000000004",
  implante: "e7e70000-0000-4000-8000-000000000005",
} as const;
const USO = {
  input_tokens: 1_000,
  output_tokens: 60,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 20 },
};
const USO_LIDO = {
  tokensEntrada: 1_000,
  tokensSaida: 60,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
};

function preparo(versaoId: string, versao: number): PreparoEmVigor {
  return {
    versaoId,
    versao,
    textoSha256: SHA_DO_TEXTO,
    rtNome: RT_DE_TESTE.nome,
    // 27/10/2026, 10:00 em Fortaleza.
    aprovadoEm: "2026-10-27T13:00:00.000Z",
  };
}

/** O catalogo do Cadastro com as orientacoes de preparo em vigor. */
function comPreparo(base: CatalogoDoAgente): CatalogoDoAgente {
  return {
    ...base,
    preparosEmVigor: new Map([
      [PROC.exame, preparo(VERSAO.exame, 3)],
      [PROC.consulta, preparo(VERSAO.consulta, 1)],
      [PROC_AG2.botox, preparo(VERSAO.botox, 1)],
      [PROC_AG2.implante, preparo(VERSAO.implante, 1)],
    ]),
    textosDePreparo: [TEXTO_DO_PREPARO_DE_TESTE, PREP_ANTIGO],
  };
}

const CATALOGO = comPreparo(catalogoDoCadastro());

/** O codigo (p1...) do procedimento, no indice ou fora dele. */
function codigo(id: string): string {
  const achado = [
    ...CATALOGO.procedimentos,
    ...(CATALOGO.procedimentosSoComAEquipe ?? []),
  ].find((p) => p.id === id);
  if (!achado) {
    throw new Error("procedimento fora do catalogo");
  }
  return achado.codigo;
}

const P_EXAME = codigo(PROC.exame);
const P_LIMPEZA = codigo(PROC.limpeza);
const P_CONSULTA = codigo(PROC.consulta);
const P_BOTOX = codigo(PROC_AG2.botox);
const P_IMPLANTE = codigo(PROC_AG2.implante);

/** A configuracao com a agenda e com (ou sem) a habilidade do preparo. */
function configComPreparo(
  ligada = true,
  base = configComAgenda(),
): ConfigDoAgente {
  return {
    ...base,
    habilidades: { ...base.habilidades, enviar_preparo: ligada },
  };
}

function resposta(output: unknown[]) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output,
    usage: USO,
    _request_id: "req_1",
  };
}

function chamada(name: string, args: unknown) {
  const callId = randomUUID();
  return {
    type: "function_call",
    id: `fc_${callId}`,
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
    status: "completed",
  };
}

function ferramenta(name: string, args: unknown) {
  return resposta([
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "x" },
    chamada(name, args),
  ]);
}

function final(mensagem: string) {
  return resposta([
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

type Corpo = {
  instructions: string;
  input: unknown[];
  tools: { name: string }[];
};

function clienteComRoteiro(roteiro: unknown[]) {
  const corpos: Corpo[] = [];
  const create = vi.fn(async (corpo: Corpo) => {
    corpos.push(JSON.parse(JSON.stringify(corpo)) as Corpo);
    return roteiro.shift();
  });
  return {
    cliente: { responses: { create } } as unknown as ClienteDoAgente,
    corpos,
    create,
  };
}

/** As saidas de ferramenta que voltaram ao modelo numa rodada. */
function saidas(corpo: Corpo | undefined): unknown[] {
  return (corpo?.input ?? [])
    .filter(
      (item): item is { type: string; output: string } =>
        typeof item === "object" &&
        item !== null &&
        (item as { type?: unknown }).type === "function_call_output",
    )
    .map((item) => JSON.parse(item.output) as unknown);
}

const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: { ...USO_LIDO },
};

let classificador: ReturnType<typeof vi.fn<ClassificadorDeEntrada>>;
let verificador: ReturnType<typeof vi.fn<Verificador>>;
let pedidosAoVerificador: EntradaDoVerificador[];
let banco: AgendaEmMemoria;
let escrito: string[];

function aprova(): Promise<ResultadoDoVerificador> {
  return Promise.resolve({
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: { ...USO_LIDO },
  });
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
    config: configComPreparo(),
    catalogo: CATALOGO,
    // Uma resposta do assistente ja saiu: sem saudacao e sem aviso.
    mensagens: [
      paciente("Oi"),
      { autor: "assistente", autoria: "ia", texto: "Olá! Como posso ajudar?" },
      // "exame" e gatilho do portao (assunto_clinico, D-81): o pedido que
      // chega ao modelo e o de forma geral.
      paciente("Me manda a orientação de preparo, por favor"),
    ],
    agoraMs: AGORA,
    fuso: FUSO,
    verificador,
    classificador,
    agenda: portaDaAgendaDoSimulador(banco.cliente(), {
      clinicId: CLINICA,
      agora: () => AGORA,
    }),
    ...extra,
  };
}

async function turno(roteiro: unknown[], extra: Partial<EntradaDoTurno> = {}) {
  const { cliente, corpos, create } = clienteComRoteiro(roteiro);
  const r = await executarTurnoDoAgente(entrada({ cliente, ...extra }));
  return { r, corpos, create };
}

/** As frases do texto de teste e o texto antigo (nada disso sai). */
const TRECHOS_DA_CLINICA = [
  ...TEXTO_DO_PREPARO_DE_TESTE.split("\n"),
  PREP_ANTIGO,
];

function semTextoDaClinica(rotulo: string, onde: unknown): void {
  const tudo = typeof onde === "string" ? onde : JSON.stringify(onde);
  for (const trecho of TRECHOS_DA_CLINICA) {
    expect(tudo, `${rotulo}: ${trecho.slice(0, 30)}`).not.toContain(trecho);
  }
}

beforeEach(() => {
  banco = bancoComJornadas();
  pedidosAoVerificador = [];
  classificador = vi.fn<ClassificadorDeEntrada>(async () => LIMPO);
  verificador = vi.fn<Verificador>(async (pedido) => {
    pedidosAoVerificador.push(pedido);
    return aprova();
  });
  escrito = [];
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
  // Nenhum texto de preparo da clinica em log.
  semTextoDaClinica("log", escrito.join(""));
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// A decisao (pura)
// ---------------------------------------------------------------------------

describe("decidirEnvioDoPreparo (pura)", () => {
  it("com versao em vigor: enviar, com o passo da trilha (versao, codigo, RT e data no fuso da clinica)", () => {
    const decisao = decidirEnvioDoPreparo(
      CATALOGO,
      { procedimento: P_EXAME },
      { sozinhaNoTurno: true, fuso: FUSO },
    );
    expect(decisao).toEqual({
      tipo: "enviar",
      procedimentoId: PROC.exame,
      versaoId: VERSAO.exame,
      versao: 3,
      introducao: null,
      passo: `Pediu a orientação de preparo de Exame: escolhida a versão 3 (código ${codigoDoTexto(SHA_DO_TEXTO)}), aprovada por Dra. Ana Souza em 27/10/2026.`,
    });
    // A data no fuso da clinica: 23:00 de 27/10 em Fortaleza e 28/10 em UTC.
    const tarde = decidirEnvioDoPreparo(
      {
        ...CATALOGO,
        preparosEmVigor: new Map([
          [
            PROC.exame,
            { ...preparo(VERSAO.exame, 3), aprovadoEm: "2026-10-28T02:00:00Z" },
          ],
        ]),
      },
      { procedimento: P_EXAME },
      { sozinhaNoTurno: true, fuso: FUSO },
    );
    expect(tarde.passo).toContain("em 27/10/2026.");
  });

  it("sem versao em vigor: passa com assunto_clinico; so com a equipe (sem informar): regra_do_procedimento, mesmo com texto", () => {
    expect(
      decidirEnvioDoPreparo(
        CATALOGO,
        { procedimento: P_LIMPEZA },
        { sozinhaNoTurno: true },
      ),
    ).toEqual({
      tipo: "passar",
      motivo: "assunto_clinico",
      passo:
        "Pediu a orientação de preparo de Limpeza de pele: o procedimento não tem orientação aprovada pelo responsável técnico.",
    });
    expect(
      decidirEnvioDoPreparo(
        CATALOGO,
        { procedimento: P_IMPLANTE },
        { sozinhaNoTurno: true },
      ),
    ).toEqual({
      tipo: "passar",
      motivo: "regra_do_procedimento",
      passo:
        "Pediu a orientação de preparo de Implante: só a equipe informa este procedimento.",
    });
    // So a equipe marca, mas deixa informar: o texto em vigor vai.
    expect(
      decidirEnvioDoPreparo(
        CATALOGO,
        { procedimento: P_BOTOX },
        { sozinhaNoTurno: true },
      ),
    ).toMatchObject({ tipo: "enviar", procedimentoId: PROC_AG2.botox });
  });

  it("entrada invalida, fora do catalogo e acompanhada: voltam ao modelo so com ok e o motivo", () => {
    const saida = (args: unknown, sozinha = true) => {
      const d = decidirEnvioDoPreparo(CATALOGO, args, {
        sozinhaNoTurno: sozinha,
      });
      expect(d.tipo).toBe("resultado");
      return d.tipo === "resultado" ? JSON.parse(d.saida) : null;
    };
    for (const invalida of [
      {},
      { procedimento: "" },
      { procedimento: "p1", extra: 1 },
      null,
      { procedimento: "p".repeat(65) },
    ]) {
      expect(saida(invalida)).toEqual({
        ok: false,
        motivo: "entrada_invalida",
      });
    }
    expect(saida({ procedimento: "p99" })).toEqual({
      ok: false,
      motivo: "procedimento_nao_encontrado",
    });
    expect(saida({ procedimento: P_EXAME }, false)).toEqual({
      ok: false,
      motivo: "vai_sozinha",
    });
  });

  it("a definicao para a OpenAI: strict, o codigo e a introducao (texto ou null), e a instrucao de ir sozinha", () => {
    expect(FERRAMENTA_ENVIAR_PREPARO).toMatchObject({
      type: "function",
      name: NOME_DO_ENVIO_DO_PREPARO,
      strict: true,
      parameters: {
        type: "object",
        required: ["procedimento", "introducao"],
        additionalProperties: false,
      },
    });
    expect(FERRAMENTA_ENVIAR_PREPARO.description).toContain(
      "Chame sozinha, sem outra ferramenta; depois de chamar, não escreva mais nada.",
    );
    expect(JSON.stringify(FERRAMENTA_ENVIAR_PREPARO)).not.toMatch(/[–—]/);
  });
});

describe("a leitura do catalogo", () => {
  const linha = (procedureId: string, extra: Record<string, unknown> = {}) => ({
    procedure_id: procedureId,
    versao_id: VERSAO.exame,
    versao: 3,
    texto_sha256: SHA_DO_TEXTO,
    rt_nome: "  Dra.   Ana Souza ",
    aprovado_em: "2026-10-27T13:00:00+00:00",
    ...extra,
  });
  const ativos = new Set([PROC.exame, PROC.consulta]);

  it("so os procedimentos ativos do catalogo; a linha fora do formato fica de fora e conta", () => {
    const lido = preparosEmVigorDaLeitura(
      [
        linha(PROC.exame),
        // inativo (Peeling): fica para a regua, nunca para a IA
        linha(PROC_AG2.peeling),
        linha(PROC.consulta, { texto_sha256: "x" }),
        "lixo",
      ],
      ativos,
    );
    expect(lido?.descartadas).toBe(2);
    expect([...(lido?.preparos.keys() ?? [])]).toEqual([PROC.exame]);
    expect(lido?.preparos.get(PROC.exame)).toEqual({
      versaoId: VERSAO.exame,
      versao: 3,
      textoSha256: SHA_DO_TEXTO,
      rtNome: "Dra. Ana Souza",
      aprovadoEm: "2026-10-27T13:00:00+00:00",
    });
    // Dois do mesmo procedimento: nenhum (falha fechada).
    expect(
      preparosEmVigorDaLeitura(
        [linha(PROC.exame), linha(PROC.exame, { versao: 4 })],
        ativos,
      )?.preparos.size,
    ).toBe(0);
    // Fora do formato inteiro: quem carrega lanca.
    expect(preparosEmVigorDaLeitura(null, ativos)).toBeNull();
    expect(preparosEmVigorDaLeitura({}, ativos)).toBeNull();
  });

  it("os textos: so uma lista de textos (sem os vazios); fora disso, null", () => {
    expect(textosDePreparoDaLeitura(["a b", " ", "a b", "c"])).toEqual([
      "a b",
      "c",
    ]);
    expect(textosDePreparoDaLeitura([])).toEqual([]);
    expect(textosDePreparoDaLeitura(null)).toBeNull();
    expect(textosDePreparoDaLeitura(["a", 1])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// O turno
// ---------------------------------------------------------------------------

describe("o turno com enviar_preparo", () => {
  it("com texto em vigor: o turno termina com o preparo, sem filtro, sem verificador e sem texto do modelo", async () => {
    // Revisao da AG7 (CFM-7): o pedido sem o nome ("exame" e gatilho do
    // portao) vale pelo procedimento da marcacao da conversa (o estado).
    const { r, create, corpos } = await turno(
      [ferramenta("enviar_preparo", { procedimento: P_EXAME })],
      {
        atendimento: {
          estado: { ...estadoVazio(), procedure_id: PROC.exame },
          dados: dadosVazios(),
        },
      },
    );
    expect(r.tipo).toBe("preparo");
    expect(r.desfecho).toEqual({
      tipo: "enviou_preparo",
      versaoId: VERSAO.exame,
      procedimentoId: PROC.exame,
    });
    if (r.tipo !== "preparo") {
      return;
    }
    expect(r.preparo).toEqual({
      procedimentoId: PROC.exame,
      versaoId: VERSAO.exame,
      versao: 3,
    });
    expect(r.resposta).toBeNull();
    expect(r.rascunhoBloqueado).toBeNull();
    expect(r.filtro).toBeNull();
    expect(verificador).not.toHaveBeenCalled();
    // Uma rodada so: o resto nao roda.
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.ferramentasUsadas).toEqual(["enviar_preparo"]);
    expect(ferramentaDoTurno(r)).toBe("enviar_preparo");
    expect(r.trilha).toContainEqual({
      tipo: "cadastro",
      texto: `Pediu a orientação de preparo de Exame: escolhida a versão 3 (código ${codigoDoTexto(SHA_DO_TEXTO)}), aprovada por Dra. Ana Souza em 27/10/2026.`,
    });
    // O classificador rodou a variante com o preparo, e a versao e a dela.
    expect(classificador).toHaveBeenCalledWith(
      expect.objectContaining({ comPreparo: true }),
    );
    expect(r.versaoDoClassificador).toBe(
      versaoDaPoliticaDoClassificador({ comPreparo: true }),
    );
    expect(r.versaoDoClassificador).not.toBe(
      VERSAO_DA_POLITICA_DO_CLASSIFICADOR,
    );
    // A ferramenta foi ao modelo, com a linha ligada do bloco <atendimento>.
    expect(corpos[0]?.tools.map((t) => t.name)).toContain("enviar_preparo");
    expect(corpos[0]?.instructions).toContain(
      "Enviar orientação de preparo: ligado.",
    );
    semTextoDaClinica("corpos", corpos);
  });

  it("sem texto em vigor: passa para a equipe com assunto_clinico, pela ferramenta; o motivo nunca atribui", async () => {
    const { r } = await turno([
      ferramenta("enviar_preparo", { procedimento: P_LIMPEZA }),
    ]);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "assunto_clinico",
      gatilho: null,
      origem: "ferramenta",
    });
    expect(r.trilha.map((p) => p.texto)).toContain(
      "Pediu a orientação de preparo de Limpeza de pele: o procedimento não tem orientação aprovada pelo responsável técnico.",
    );
    expect(motivoPodeAtribuir("assunto_clinico")).toBe(false);
    expect(verificador).not.toHaveBeenCalled();
  });

  it("so com a equipe: passa com regra_do_procedimento", async () => {
    const { r } = await turno([
      ferramenta("enviar_preparo", { procedimento: P_IMPLANTE }),
    ]);
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "regra_do_procedimento",
      gatilho: null,
      origem: "ferramenta",
    });
  });

  it("procedimento fora do catalogo: volta ao modelo, que pergunta", async () => {
    const { r, corpos } = await turno([
      ferramenta("enviar_preparo", { procedimento: "p99" }),
      final("Para qual procedimento você quer a orientação de preparo?"),
    ]);
    expect(saidas(corpos[1])).toEqual([
      { ok: false, motivo: "procedimento_nao_encontrado" },
    ]);
    expect(r.tipo).toBe("resposta");
    expect(r.resposta).toBe(
      "Para qual procedimento você quer a orientação de preparo?",
    );
  });

  it("habilidade desligada: a ferramenta nao vai ao modelo, a chamada e ferramenta_invalida e o classificador roda a politica de sempre", async () => {
    const { r, corpos } = await turno(
      [ferramenta("enviar_preparo", { procedimento: P_EXAME })],
      { config: configComPreparo(false) },
    );
    expect(corpos[0]?.tools.map((t) => t.name)).not.toContain("enviar_preparo");
    expect(corpos[0]?.instructions).toContain(
      'Enviar orientação de preparo: desligado. Se a pessoa pedir o preparo ou as orientações antes de um procedimento, passe para a equipe com o motivo "assunto_clinico".',
    );
    expect(r.desfecho).toEqual({
      tipo: "falhou",
      motivo: "ferramenta_invalida",
    });
    expect(classificador.mock.calls[0]?.[0]).not.toHaveProperty("comPreparo");
    expect(r.versaoDoClassificador).toBe(VERSAO_DA_POLITICA_DO_CLASSIFICADOR);
  });
});

describe("revisao da AG7 (CFM-6): o pedido do preparo junto de uma situacao da pessoa passa para a equipe antes do envio", () => {
  const comPendente = (texto: string) => ({
    mensagens: [
      paciente("Oi"),
      {
        autor: "assistente" as const,
        autoria: "ia" as const,
        texto: "Olá! Como posso ajudar?",
      },
      paciente(texto),
    ],
  });

  // As quatro do relatorio: passam no portao de entrada (D-81), e o modelo
  // escolhe enviar.
  it.each([
    "to com intestino preso, qual o preparo da colonoscopia?",
    "comi um pão agora, ainda dá pra fazer a colonoscopia amanhã?",
    "posso mascar chiclete no jejum?",
    "qual o preparo da colonoscopia pra minha mãe que tem 80 anos?",
  ])("%j: assunto_clinico pela ferramenta, nada sai", async (pedido) => {
    const { r } = await turno(
      [ferramenta("enviar_preparo", { procedimento: P_CONSULTA })],
      comPendente(pedido),
    );
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toEqual({
      tipo: "escalou",
      motivo: "assunto_clinico",
      gatilho: null,
      origem: "ferramenta",
    });
    expect(r.trilha.map((p) => p.texto)).toContain(
      PASSO_DO_PEDIDO_COM_SITUACAO_PESSOAL,
    );
    expect(verificador).not.toHaveBeenCalled();
  });

  it.each([
    "Me manda a orientação de preparo da consulta, por favor",
    "tenho consulta amanhã, qual o preparo?",
    "tô com consulta marcada amanhã, me manda o preparo",
    "tenho que fazer jejum pra consulta?",
  ])("%j: o pedido de sempre, o preparo sai", async (pedido) => {
    const { r } = await turno(
      [ferramenta("enviar_preparo", { procedimento: P_CONSULTA })],
      comPendente(pedido),
    );
    expect(r.tipo).toBe("preparo");
  });
});

describe("revisao da AG7 (CFM-7): o procedimento escolhido tem de ser o que a pessoa pediu", () => {
  const PROC_DOS_TESTES = [
    { codigo: "p1", id: "a1", nome: "Ultrassom de abdome total" },
    { codigo: "p2", id: "a2", nome: "Ultrassom de abdome superior" },
    { codigo: "p3", id: "a3", nome: "Colonoscopia" },
    { codigo: "p4", id: "a4", nome: "Consulta" },
  ];
  const catalogo = { procedimentos: PROC_DOS_TESTES };

  it("citacaoDoProcedimento: o nome inteiro, o comeco da palavra, o empate e o outro", () => {
    expect(
      citacaoDoProcedimento(catalogo, "a3", [
        "qual o preparo da colonoscopia?",
      ]),
    ).toBe("confirmado");
    expect(citacaoDoProcedimento(catalogo, "a3", ["preparo da colono"])).toBe(
      "confirmado",
    );
    expect(
      citacaoDoProcedimento(catalogo, "a1", [
        "qual o preparo do ultrassom de abdome total?",
      ]),
    ).toBe("confirmado");
    // O empate: o modelo nao escolhe por conta propria.
    for (const id of ["a1", "a2"]) {
      expect(
        citacaoDoProcedimento(catalogo, id, [
          "qual o preparo do ultrassom de abdome?",
        ]),
      ).toBe("outro");
    }
    // A pessoa citou outro.
    expect(
      citacaoDoProcedimento(catalogo, "a4", [
        "qual o preparo da colonoscopia?",
      ]),
    ).toBe("outro");
    // Nada citado.
    expect(
      citacaoDoProcedimento(catalogo, "a3", ["me manda o preparo, por favor"]),
    ).toBe("nenhum");
    expect(citacaoDoProcedimento(catalogo, "a3", [])).toBe("nenhum");
  });

  const comPendente = (texto: string) => ({
    mensagens: [
      paciente("Oi"),
      {
        autor: "assistente" as const,
        autoria: "ia" as const,
        texto: "Olá! Como posso ajudar?",
      },
      paciente(texto),
    ],
  });

  it("sem o nome, sem a marcacao e sem consulta: nada sai, e o modelo pergunta", async () => {
    const { r, corpos } = await turno(
      [
        ferramenta("enviar_preparo", { procedimento: P_CONSULTA }),
        final("Para qual procedimento você quer a orientação de preparo?"),
      ],
      comPendente("Me manda a orientação de preparo, por favor"),
    );
    expect(saidas(corpos[1])).toEqual([
      { ok: false, motivo: "procedimento_nao_confirmado" },
    ]);
    expect(r.tipo).toBe("resposta");
    expect(r.trilha.map((p) => p.texto)).toContain(
      PASSO_DO_PROCEDIMENTO_NAO_CONFIRMADO,
    );
    // A trilha nao diz que escolheu uma versao.
    expect(r.trilha.map((p) => p.texto).join(" ")).not.toContain("versão");
  });

  it("a pessoa citou outro procedimento: nada sai", async () => {
    const { r, corpos } = await turno(
      [
        ferramenta("enviar_preparo", { procedimento: P_CONSULTA }),
        final("De qual procedimento você quer a orientação de preparo?"),
      ],
      comPendente("qual o preparo do botox?"),
    );
    expect(saidas(corpos[1])).toEqual([
      { ok: false, motivo: "procedimento_nao_confirmado" },
    ]);
    expect(r.tipo).toBe("resposta");
  });

  it("o nome dito antes, na conversa: vale (a pendente nao cita nenhum)", async () => {
    const { r } = await turno(
      [ferramenta("enviar_preparo", { procedimento: P_CONSULTA })],
      {
        mensagens: [
          paciente("Quero marcar uma consulta"),
          {
            autor: "assistente",
            autoria: "ia",
            texto: "Claro! Tenho horário amanhã às 10h. Pode ser?",
          },
          paciente("Antes, me manda o preparo, por favor"),
        ],
      },
    );
    expect(r.tipo).toBe("preparo");
  });

  it("a consulta da pessoa: o unico procedimento com orientacao em vigor entre as consultas futuras dela vale; dois, nao", async () => {
    const vinculoDe = (id: string) => {
      const achado = CATALOGO.vinculos.find((v) => v.procedimentoId === id);
      if (!achado?.id) {
        throw new Error("sem vinculo");
      }
      return achado.id;
    };
    const consulta = (serviceLinkId: string) => ({
      id: randomUUID(),
      inicio: "2026-10-28T13:00:00.000Z",
      fim: "2026-10-28T13:30:00.000Z",
      status: "agendado",
      aprovacao: null,
      encaixe: false,
      serviceLinkId,
      profissionalId: randomUUID(),
      unidadeId: null,
      remarcacaoDe: null,
      temRemarcacaoPendente: false,
    });
    const comConsultas = (servicos: string[]) => ({
      ...comPendente("Me manda a orientação de preparo, por favor"),
      agenda: {
        ...portaDaAgendaDoSimulador(banco.cliente(), {
          clinicId: CLINICA,
          agora: () => AGORA,
        }),
        lerConsultasDoContato: async () => ({
          consultas: servicos.map(consulta),
          haMais: false,
        }),
      },
    });
    const uma = await turno(
      [ferramenta("enviar_preparo", { procedimento: P_CONSULTA })],
      comConsultas([vinculoDe(PROC.consulta)]),
    );
    expect(uma.r.tipo).toBe("preparo");
    const duas = await turno(
      [
        ferramenta("enviar_preparo", { procedimento: P_CONSULTA }),
        final("Para qual procedimento você quer a orientação de preparo?"),
      ],
      comConsultas([vinculoDe(PROC.consulta), vinculoDe(PROC.exame)]),
    );
    expect(duas.r.tipo).toBe("resposta");
  });
});

describe("a introducao da IA antes do bloco exato (decisao do dono de 06/11/2026)", () => {
  const CLARO = "Claro! Segue a orientação da clínica:";
  const NO_ESTADO = {
    atendimento: {
      estado: { ...estadoVazio(), procedure_id: PROC.exame },
      dados: dadosVazios(),
    },
  };
  const pedir = (introducao: unknown, extra: Partial<EntradaDoTurno> = {}) =>
    turno(
      [
        ferramenta("enviar_preparo", {
          procedimento: P_EXAME,
          introducao,
        }),
      ],
      { ...NO_ESTADO, ...extra },
    );
  const soOBloco = (r: ResultadoDoTurno) => {
    expect(r.tipo).toBe("preparo");
    if (r.tipo === "preparo") {
      expect(r.introducao).toBeNull();
    }
    expect(r.trilha.some((p) => p.tipo === "bloqueio")).toBe(true);
    // Barrada, o texto dela nunca vai para a trilha.
    expect(r.rascunhoBloqueado).toBeNull();
  };

  it("sem introducao (null, ausente, vazia ou fora do formato): o preparo de sempre, sem filtro nem verificador", async () => {
    for (const valor of [null, undefined, "   ", 12, { a: 1 }]) {
      verificador.mockClear();
      const { r } = await pedir(valor);
      expect(r.tipo).toBe("preparo");
      if (r.tipo === "preparo") {
        expect(r.introducao).toBeNull();
        expect(r.filtro).toBeNull();
      }
      expect(verificador).not.toHaveBeenCalled();
      expect(r.trilha.some((p) => p.tipo === "bloqueio")).toBe(false);
    }
  });

  it("aprovada pela regra propria e pelo filtro inteiro: vai no resultado, com o verificador contado", async () => {
    const { r, create } = await pedir(CLARO);
    expect(r.tipo).toBe("preparo");
    if (r.tipo !== "preparo") {
      return;
    }
    expect(r.introducao).toBe(CLARO);
    expect(r.filtro?.aprovado).toBe(true);
    expect(r.resposta).toBeNull();
    expect(pedidosAoVerificador.map((p) => p.rascunho)).toEqual([CLARO]);
    expect(r.uso.map((u) => u.papel)).toContain("verificador");
    expect(r.trilha).toContainEqual({
      tipo: "outro",
      texto: "A introdução da IA passou na conformidade.",
    });
    // O texto do preparo nao vai ao modelo nem ao verificador.
    expect(create).toHaveBeenCalledTimes(1);
    semTextoDaClinica("verificador", pedidosAoVerificador);
  });

  it.each([
    ["remedio", "Segue o bisacodil da clínica:"],
    ["dose", "Segue a dose de 5 mg:"],
    ["unidade", "São dois comprimidos:"],
    ["como tomar", "Tome assim:"],
    ["sintoma", "Se tiver cólica, segue:"],
    ["jejum", "O jejum é assim:"],
    ["duas linhas", "Claro!\nSegue:"],
    ["longa", "a".repeat(161)],
    ["remedio do texto aprovado, fora da lista", "Segue a sementes:"],
  ])(
    "SABOTAGEM: com %s, a regra propria barra sem chamar o verificador e sai so o bloco",
    async (_n, introducao) => {
      const catalogo = {
        ...CATALOGO,
        textosDePreparo: [
          ...(CATALOGO.textosDePreparo ?? []),
          "Remédios do preparo:\n\nSementes 5 mg: tomar 1.",
        ],
      };
      const { r } = await pedir(introducao, { catalogo });
      soOBloco(r);
      expect(verificador).not.toHaveBeenCalled();
      expect(JSON.stringify(r.trilha)).not.toContain(introducao);
    },
  );

  it("o filtro barra o que a regra propria deixa: copiar o texto, responder a pergunta, prometer", async () => {
    for (const introducao of [
      "Precisa sim, segue a orientação da clínica:",
      "Venha com um acompanhante maior de idade, porque você vai receber sedação.",
      "Fique tranquila, é garantido:",
    ]) {
      const { r } = await pedir(introducao);
      soOBloco(r);
      expect(verificador).not.toHaveBeenCalled();
    }
  });

  it("o verificador reprova, cai ou devolve fora do formato: sai so o bloco, com a trilha", async () => {
    const falhas: (() => Promise<ResultadoDoVerificador>)[] = [
      async () => ({
        tipo: "veredicto",
        veredicto: {
          aprovado: false,
          violacoes: [{ categoria: "orientacao_clinica", gravidade: "alta" }],
          confianca: "alta",
        },
        modelo: "gpt-6-luna",
        uso: { ...USO_LIDO },
      }),
      async () => {
        throw new Error("fora do ar");
      },
      async () => ({ tipo: "qualquer" }) as unknown as ResultadoDoVerificador,
    ];
    for (const falha of falhas) {
      verificador.mockImplementation(falha);
      const { r } = await pedir(CLARO);
      soOBloco(r);
      if (r.tipo === "preparo") {
        expect(r.filtro?.aprovado).toBe(false);
      }
    }
  });

  it("o dia da consulta: passa com a consulta da pessoa lida; sem ela, e barrado e sai so o bloco", async () => {
    // Terca, 27/10/2026, 08:00 em Fortaleza (AGORA e terca, 20/10/2026).
    const consulta = {
      id: randomUUID(),
      inicio: "2026-10-27T11:00:00.000Z",
      fim: "2026-10-27T11:30:00.000Z",
      status: "agendado",
      aprovacao: null,
      encaixe: false,
      serviceLinkId: randomUUID(),
      profissionalId: randomUUID(),
      unidadeId: null,
      remarcacaoDe: null,
      temRemarcacaoPendente: false,
    };
    const porta = (consultas: (typeof consulta)[]) => ({
      agenda: {
        ...portaDaAgendaDoSimulador(banco.cliente(), {
          clinicId: CLINICA,
          agora: () => AGORA,
        }),
        lerConsultasDoContato: async () => ({ consultas, haMais: false }),
      },
    });
    const DIA =
      "Claro! Como seu exame é na terça de manhã, segue a orientação da clínica:";
    const com = await pedir(DIA, porta([consulta]));
    expect(com.r.tipo === "preparo" && com.r.introducao).toBe(DIA);
    const outroDia = await pedir(
      "Claro! Como seu exame é na quinta de manhã, segue a orientação da clínica:",
      porta([consulta]),
    );
    soOBloco(outroDia.r);
    const sem = await pedir(DIA, porta([]));
    soOBloco(sem.r);
  });

  it("a leitura das consultas que falha nao derruba: sai so o bloco", async () => {
    const { r } = await pedir(
      "Claro! Como seu exame é na terça de manhã, segue a orientação da clínica:",
      {
        agenda: {
          ...portaDaAgendaDoSimulador(banco.cliente(), {
            clinicId: CLINICA,
            agora: () => AGORA,
          }),
          lerConsultasDoContato: async () => {
            throw new Error("fora do ar");
          },
        },
      },
    );
    soOBloco(r);
  });

  it("a marca do nome nunca vira vocativo na introducao", async () => {
    const { r } = await pedir(`Claro, ${MARCA_DO_NOME}! Segue a orientação da clínica:`);
    expect(r.tipo === "preparo" && r.introducao).not.toContain(MARCA_DO_NOME);
  });

  it("o historico: a mensagem com a introducao vira o substituto inteiro; nem o texto nem a introducao vao ao modelo", async () => {
    const corpo = `${CLARO}\n\n${mensagemDoPreparo({
      procedimento: "Exame",
      rt: RT_DE_TESTE,
      texto: TEXTO_DO_PREPARO_DE_TESTE,
    })}`;
    const { corpos } = await turno(
      [final("Claro, posso ajudar com mais alguma coisa?")],
      {
        mensagens: [
          paciente("Me manda a orientação de preparo, por favor"),
          { autor: "assistente", autoria: "sistema", texto: corpo },
          paciente("Obrigada! Vocês abrem sábado?"),
        ],
      },
    );
    semTextoDaClinica("corpos", corpos);
    const lido = JSON.stringify(corpos[0]?.input);
    expect(lido).toContain(
      "Mensagem do sistema: a orientação de preparo de Exame, aprovada pela clínica, foi enviada aqui.",
    );
    expect(lido).not.toContain(CLARO);
  });

  it("a mesma fala de outro autor nao vira 'aprovada'", async () => {
    const corpo = `${CLARO}\n\n${mensagemDoPreparo({
      procedimento: "Exame",
      rt: RT_DE_TESTE,
      texto: TEXTO_DO_PREPARO_DE_TESTE,
    })}`;
    const { corpos } = await turno(
      [final("Claro, posso ajudar com mais alguma coisa?")],
      {
        mensagens: [
          paciente("Oi"),
          { autor: "assistente", autoria: "ia", texto: corpo },
          paciente("Obrigada! Vocês abrem sábado?"),
        ],
      },
    );
    semTextoDaClinica("corpos", corpos);
    expect(JSON.stringify(corpos[0]?.input)).not.toContain("aprovada");
  });

  it("o pedido que vem com a pergunta fora do texto continua indo para a equipe, com ou sem introducao", async () => {
    const { r } = await turno(
      [
        ferramenta("enviar_preparo", {
          procedimento: P_EXAME,
          introducao: CLARO,
        }),
      ],
      {
        ...NO_ESTADO,
        mensagens: [paciente("Me manda o preparo, eu tomo remédio pra pressão")],
      },
    );
    expect(r.tipo).not.toBe("preparo");
    expect(r.desfecho).toMatchObject({ tipo: "escalou" });
  });
});

describe("enviar_preparo so vale sozinha no turno", () => {
  it("com outra chamada na mesma rodada: vai_sozinha, e a outra roda", async () => {
    const { r, corpos } = await turno([
      resposta([
        chamada("buscar_procedimento", {
          procedimento: P_EXAME,
          convenio: null,
        }),
        chamada("enviar_preparo", { procedimento: P_EXAME }),
      ]),
      final("Quer receber a orientação de preparo do exame?"),
    ]);
    const lidas = saidas(corpos[1]);
    expect(lidas).toHaveLength(2);
    expect(lidas[1]).toEqual({ ok: false, motivo: "vai_sozinha" });
    expect(r.tipo).toBe("resposta");
    expect(r.ferramentasUsadas).toEqual([
      "buscar_procedimento",
      "enviar_preparo",
    ]);
  });

  it("depois de uma consulta ou da agenda numa rodada anterior: vai_sozinha", async () => {
    for (const [nome, args] of [
      ["buscar_procedimento", { procedimento: P_EXAME, convenio: null }],
      ["consultar_unidades", { unidade: null }],
      [
        "buscar_horario",
        {
          procedimento: P_CONSULTA,
          profissional: null,
          convenio: null,
          a_partir_de: null,
          periodo: "tarde",
          unidade: null,
          hora: null,
        },
      ],
    ] as const) {
      const { r, corpos } = await turno([
        ferramenta(nome, args),
        ferramenta("enviar_preparo", { procedimento: P_EXAME }),
        final("Quer receber a orientação de preparo do exame?"),
      ]);
      expect(saidas(corpos[2]).at(-1), nome).toEqual({
        ok: false,
        motivo: "vai_sozinha",
      });
      expect(r.tipo, nome).toBe("resposta");
    }
  });

  it("escalar_humano junto: vence o escalar", async () => {
    const { r } = await turno([
      resposta([
        chamada("enviar_preparo", { procedimento: P_EXAME }),
        chamada("escalar_humano", { motivo: "pedido_humano" }),
      ]),
    ]);
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "pedido_humano",
      origem: "agente",
    });
  });

  it("a chamada de novo, depois de um pedido incompleto, ainda vale (nada rodou)", async () => {
    const { r, corpos } = await turno(
      [
        ferramenta("enviar_preparo", { procedimento: "" }),
        ferramenta("enviar_preparo", { procedimento: P_CONSULTA }),
      ],
      {
        mensagens: [
          paciente("Oi"),
          {
            autor: "assistente",
            autoria: "ia",
            texto: "Olá! Como posso ajudar?",
          },
          paciente("Me manda a orientação de preparo da consulta, por favor"),
        ],
      },
    );
    expect(saidas(corpos[1])).toEqual([
      { ok: false, motivo: "entrada_invalida" },
    ]);
    expect(r.tipo).toBe("preparo");
  });
});

describe("o modelo continua barrado ao escrever preparo", () => {
  it.each([
    ["inventado", "Precisa de jejum de 8 horas antes do exame."],
    ["copiado do texto aprovado", FRASE_DO_PREPARO_SO_DO_TRECHO],
    ["copiado do texto antigo", PREP_ANTIGO],
    ["anunciando sem a ferramenta", "Segue o preparo abaixo."],
  ])("%s: a regra barra, e a frase fixa sai", async (_n, texto) => {
    const { r } = await turno([final(texto)]);
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({
      tipo: "bloqueou",
      categoria: "orientacao_clinica",
      camada: "regra",
    });
    expect(verificador).not.toHaveBeenCalled();
  });

  it.each([
    "Precisa sim.",
    "Não precisa.",
    "Sim, 8 horas.",
    "Tem sim, é simples.",
  ])(
    "revisao da AG7 (CFM-5): a resposta curta %j a pergunta de jejum barra na regra, sem o verificador",
    async (resposta) => {
      const { r } = await turno([final(resposta)], {
        mensagens: [
          paciente("Oi"),
          {
            autor: "assistente",
            autoria: "ia",
            texto: "Olá! Como posso ajudar?",
          },
          paciente("precisa de jejum pra colonoscopia?"),
        ],
      });
      expect(r.tipo).toBe("frase_fixa");
      expect(r.desfecho).toMatchObject({
        tipo: "bloqueou",
        categoria: "orientacao_clinica",
        camada: "regra",
      });
      expect(verificador).not.toHaveBeenCalled();
    },
  );

  // Revisao curta da AG7 (CURTA-1): a regra so roda com a habilidade, e so
  // barra a frase que afirma ou nega o jejum ou o preparo.
  const pergunta = (texto: string): MensagemDaConversa[] => [
    paciente("Oi"),
    {
      autor: "assistente",
      autoria: "ia",
      texto: "Olá! Como posso ajudar?",
    },
    paciente(texto),
  ];

  it("revisao curta da AG7 (CURTA-1): sem a habilidade, a resposta curta nao para na regra (o verificador julga)", async () => {
    const { r } = await turno([final("Precisa sim.")], {
      config: configComPreparo(false),
      mensagens: pergunta("precisa de jejum pra colonoscopia?"),
    });
    expect(verificador).toHaveBeenCalledTimes(1);
    expect(r.tipo).toBe("resposta");
  });

  it.each([
    [
      "Li o preparo, tem estacionamento aí?",
      "Temos estacionamento conveniado ao lado da clínica.",
    ],
    ["qual o preparo?", "É para a colonoscopia ou para a endoscopia?"],
  ])(
    "revisao curta da AG7 (CURTA-1): com a habilidade, %j / %j passa pela regra",
    async (texto, resposta) => {
      const { r } = await turno([final(resposta)], {
        mensagens: pergunta(texto),
      });
      expect(verificador).toHaveBeenCalledTimes(1);
      expect(r.tipo).toBe("resposta");
    },
  );

  it("parafraseado (so o verificador pega): passa pelo verificador e e barrado", async () => {
    verificador.mockImplementation(async (pedido) => {
      pedidosAoVerificador.push(pedido);
      return {
        tipo: "veredicto",
        veredicto: {
          aprovado: false,
          violacoes: [{ categoria: "orientacao_clinica", gravidade: "alta" }],
          confianca: "alta",
        },
        modelo: "gpt-6-luna",
        uso: { ...USO_LIDO },
      };
    });
    // Revisao da AG7 (CFM-4): "so caldos" ja barra nas regras; a parafrase
    // que so o verificador pega e outra. E a pendente nao pede o preparo
    // (depois do pedido, a resposta sem a oferta ja barra na regra, CFM-5).
    const { r } = await turno(
      [final("Na véspera, capriche nos caldos e na gelatina.")],
      {
        mensagens: [
          paciente("Oi"),
          {
            autor: "assistente",
            autoria: "ia",
            texto: "Olá! Como posso ajudar?",
          },
          paciente("Vocês atendem aos sábados?"),
        ],
      },
    );
    expect(verificador).toHaveBeenCalledTimes(1);
    expect(r.desfecho).toMatchObject({ tipo: "bloqueou", camada: "modelo" });
  });
});

describe("nenhum texto de preparo da clinica sai do servidor", () => {
  it("nem no prompt, nem nas saidas das ferramentas, nem no historico, nem no classificador, nem no verificador", async () => {
    const mensagemDoSistema = mensagemDoPreparo({
      procedimento: "Exame",
      rt: RT_DE_TESTE,
      texto: TEXTO_DO_PREPARO_DE_TESTE,
    });
    const toqueDaRegua = `Oi! Amanhã, 21/10/2026 às 08:00, você tem Exame com a Dra. Ana Lima.\n${TEXTO_DO_PREPARO_DE_TESTE}\nPodemos confirmar sua presença?`;
    const toqueAntigo = `Oi! Amanhã você tem Consulta.\n${PREP_ANTIGO}\nPodemos confirmar sua presença?`;
    const historico: MensagemDaConversa[] = [
      paciente("Oi"),
      { autor: "assistente", autoria: "sistema", texto: toqueAntigo },
      { autor: "assistente", autoria: "sistema", texto: toqueDaRegua },
      paciente("Qual o preparo do exame?"),
      { autor: "assistente", autoria: "sistema", texto: mensagemDoSistema },
      paciente("Obrigada! E quanto custa a limpeza de pele?"),
    ];
    const { r, corpos } = await turno(
      [
        ferramenta("buscar_procedimento", {
          procedimento: P_LIMPEZA,
          convenio: null,
        }),
        final("A limpeza de pele custa R$ 120,00 no particular."),
      ],
      { mensagens: historico },
    );
    expect(r.tipo).toBe("resposta");
    // A OpenAI nunca viu o texto da clinica: as instrucoes, as ferramentas,
    // as saidas e o historico.
    semTextoDaClinica("corpos", corpos);
    const entrada0 = JSON.stringify(corpos[0]?.input);
    expect(entrada0).toContain(
      "Mensagem do sistema: a orientação de preparo de Exame, aprovada pela clínica, foi enviada aqui.",
    );
    expect(entrada0).toContain(
      "(o texto da orientação de preparo aprovada pela clínica estava aqui)",
    );
    // O resto do toque continua visivel (dia, hora e a pergunta).
    expect(entrada0).toContain("Podemos confirmar sua presença?");
    // O classificador e o verificador so leem a pendente do paciente.
    semTextoDaClinica("classificador", classificador.mock.calls);
    semTextoDaClinica("verificador", pedidosAoVerificador);
  });

  it("o cabecalho mascarado pelo nome do contato: o rodape ainda reconhece a mensagem", async () => {
    // A contato chamada "De Souza": a mascara troca o "de" do cabecalho.
    const mensagem = mensagemDoPreparo({
      procedimento: "Exame",
      rt: RT_DE_TESTE,
      texto: TEXTO_DO_PREPARO_DE_TESTE,
    });
    const mascarada = mascararNome(mensagem, "De Souza");
    expect(mascarada.startsWith("Orientação de preparo")).toBe(false);
    // Sem o corpo como saiu (quem montou a mensagem a mao): o rodape
    // reconhece, e o substituto nao diz "aprovada" (a mascara desmontou o
    // formato inteiro, que so a mensagem do sistema tem; CFM-10).
    const semOriginal = await turno([final("Posso ajudar em algo mais?")], {
      mensagens: [
        paciente("Qual o preparo?"),
        { autor: "assistente", autoria: "sistema", texto: mascarada },
        paciente("Obrigada"),
      ],
    });
    semTextoDaClinica("corpos", semOriginal.corpos);
    expect(JSON.stringify(semOriginal.corpos[0]?.input)).toContain(
      "Mensagem da clínica: uma orientação de preparo foi enviada aqui.",
    );
    // Com o corpo como saiu (o historico do WhatsApp, CFM-1): a troca vem
    // antes da mascara, e o substituto do sistema volta inteiro (texto fixo:
    // a mascara nao mexe nele).
    const comOriginal = await turno([final("Posso ajudar em algo mais?")], {
      nomeDoContato: "De Souza",
      mensagens: [
        paciente("Qual o preparo?"),
        {
          autor: "assistente",
          autoria: "sistema",
          texto: mascarada,
          textoOriginalDaClinica: mensagem,
        },
        paciente("Obrigada"),
      ],
    });
    semTextoDaClinica("corpos", comOriginal.corpos);
    expect(JSON.stringify(comOriginal.corpos[0]?.input)).toContain(
      "Mensagem do sistema: a orientação de preparo de Exame, aprovada pela clínica, foi enviada aqui.",
    );
  });
});

// ---------------------------------------------------------------------------
// A F2 (D-76) e o estado do atendimento
// ---------------------------------------------------------------------------

describe("a F2 depois de marcar", () => {
  it("compor: depois da mensagem e antes do encerramento; sai antes do ultimo recurso, e o ultimo recurso nunca a leva", () => {
    const curta = comporResposta({
      mensagem: "Pronto, ficou marcada.",
      saudacao: null,
      encerramento: "Até logo!",
      primeiraResposta: false,
      encerra: true,
      depoisDaMensagem: FRASE_DO_PREPARO_DEPOIS_DE_MARCAR,
    });
    expect(curta).toBe(
      `Pronto, ficou marcada.\n\n${FRASE_DO_PREPARO_DEPOIS_DE_MARCAR}\n\nAté logo!`,
    );
    // Acima de 700 com a F2: sai a F2, fica a mensagem.
    const longa = "Pronto, ficou marcada. ".repeat(27).trim();
    expect(Array.from(longa).length).toBeLessThanOrEqual(LIMITE_DO_RASCUNHO);
    const semF2 = comporResposta({
      mensagem: longa,
      saudacao: null,
      encerramento: null,
      primeiraResposta: false,
      encerra: false,
      depoisDaMensagem: FRASE_DO_PREPARO_DEPOIS_DE_MARCAR,
    });
    expect(semF2).toBe(longa);
    // Nada cabe: o ultimo recurso, sem a F2.
    const enorme = "x".repeat(LIMITE_DO_RASCUNHO + 10);
    expect(
      comporResposta({
        mensagem: enorme,
        saudacao: null,
        encerramento: null,
        primeiraResposta: false,
        encerra: false,
        depoisDaMensagem: FRASE_DO_PREPARO_DEPOIS_DE_MARCAR,
      }),
    ).toBe(enorme);
  });

  /** A conversa da AG3 (agenda-fixtures), ate marcar a Consulta (p1). */
  async function marcar(e: {
    catalogo: CatalogoDoAgente;
    config: ConfigDoAgente;
  }) {
    const banco3 = bancoDaAg3();
    let agora = AGORA;
    rpcsDaAg3(banco3, {
      catalogo: e.catalogo,
      exigidos: { nomeCompleto: true, nascimento: true, cpf: false },
      agora: () => agora,
    });
    let atendimento: AtendimentoDoTurno = {
      estado: estadoVazio(),
      dados: dadosVazios(["nome_completo", "data_nascimento"]),
    };
    const mensagens: MensagemDaConversa[] = [];
    const pedidos: EntradaDoVerificador[] = [];
    const falas: { texto: string; roteiro: unknown[] }[] = [
      {
        texto: "Quero marcar uma consulta à tarde, no particular",
        roteiro: [
          ferramenta("buscar_horario", {
            procedimento: P_CONSULTA,
            profissional: null,
            convenio: null,
            a_partir_de: null,
            periodo: "tarde",
            unidade: null,
            hora: null,
          }),
          final(
            "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?",
          ),
        ],
      },
      {
        texto: "Pode ser quarta às 14h",
        roteiro: [
          ferramenta("reservar_horario", { horario: "h2" }),
          final(
            "Reservei quarta, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.",
          ),
        ],
      },
      {
        texto: "Maria da Silva Souza, nascida em 12/03/1985",
        roteiro: [
          ferramenta("registrar_dados_do_paciente", {
            nome_completo: "Fulano da Silva Souza",
            data_nascimento: "1985-03-12",
            para_o_titular: true,
            campos_mascarados: [],
          }),
          final(
            "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?",
          ),
        ],
      },
      {
        texto: "Sim, confirmo",
        roteiro: [
          ferramenta("agendar", {}),
          final(
            "Pronto! Sua Consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe. A confirmação chega por aqui.",
          ),
        ],
      },
    ];
    let ultimo: ResultadoDoTurno | null = null;
    for (const [i, fala] of falas.entries()) {
      if (i > 0) {
        agora += 2 * 60_000;
      }
      mensagens.push({
        autor: "paciente",
        texto: mascararNome(fala.texto, NOME_DO_CONTATO),
        textoOriginal: fala.texto,
      });
      const momento = agora;
      const { cliente } = clienteComRoteiro(fala.roteiro);
      ultimo = await executarTurnoDoAgente({
        cliente,
        modelo: "gpt-6-luna",
        clinicId: CLINICA,
        identificadorDeSeguranca: IDENTIFICADOR,
        config: e.config,
        catalogo: e.catalogo,
        mensagens: [...mensagens],
        agoraMs: momento,
        fuso: FUSO,
        verificador: async (pedido) => {
          pedidos.push(pedido);
          return aprova();
        },
        classificador,
        agenda: portaDaAgendaDoWhatsapp(banco3.cliente(), {
          clinicId: CLINICA,
          conversationId: CONVERSA,
          contactId: CONTATO,
          jobId: randomUUID(),
          agora: () => momento,
        }),
        atendimento,
        agora: () => momento,
      });
      mensagens.push({
        autor: "assistente",
        autoria: "ia",
        texto: ultimo.resposta ?? "",
      });
      if (ultimo.atendimento) {
        atendimento = {
          estado: ultimo.atendimento.estado,
          dados: ultimo.atendimento.dados,
        };
      }
    }
    return { r: ultimo!, pedidos, banco3 };
  }

  it("o turno que marcou um procedimento com texto em vigor: a F2 depois da resposta, pelo filtro inteiro e nos colados dos fatos", async () => {
    const catalogo = comPreparo(catalogoDoCadastro());
    const { r, pedidos, banco3 } = await marcar({
      catalogo,
      config: configComPreparo(),
    });
    expect(banco3.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(r.tipo).toBe("resposta");
    expect(r.resposta).toBe(
      `Pronto! Sua Consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe. A confirmação chega por aqui.\n\n${FRASE_DO_PREPARO_DEPOIS_DE_MARCAR}`,
    );
    // O verificador leu a F2 no rascunho e a viu como texto colado pelo
    // sistema (nao e afirmacao da recepcionista).
    const ultimo = pedidos.at(-1);
    expect(ultimo?.rascunho).toContain(FRASE_DO_PREPARO_DEPOIS_DE_MARCAR);
    expect(ultimo?.resumoDosFatos).toContain(
      "Textos fixos da clínica colados pelo sistema nesta resposta",
    );
    expect(ultimo?.resumoDosFatos).toContain(FRASE_DO_PREPARO_DEPOIS_DE_MARCAR);
  });

  it("revisao da AG7 (MOTOR-3): a F2 que o modelo escreve sozinho (sem marcar) nao vai ao verificador como colada pelo sistema", async () => {
    const pedidos: EntradaDoVerificador[] = [];
    verificador.mockImplementation(async (pedido) => {
      pedidos.push(pedido);
      return {
        tipo: "veredicto",
        veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
        modelo: "gpt-6-luna",
        uso: { ...USO_LIDO },
      };
    });
    await turno(
      [
        final(
          `Atendemos de segunda a sexta. ${FRASE_DO_PREPARO_DEPOIS_DE_MARCAR}`,
        ),
      ],
      {
        mensagens: [
          paciente("Oi"),
          {
            autor: "assistente",
            autoria: "ia",
            texto: "Olá! Como posso ajudar?",
          },
          paciente("Vocês atendem aos sábados?"),
        ],
      },
    );
    const ultimo = pedidos.at(-1);
    expect(ultimo?.rascunho).toContain(FRASE_DO_PREPARO_DEPOIS_DE_MARCAR);
    // A secao dos textos colados nao a lista (so o rascunho a tem).
    expect(ultimo?.resumoDosFatos).toContain(
      "Textos fixos da clínica colados pelo sistema nesta resposta",
    );
    expect(ultimo?.resumoDosFatos ?? "").not.toContain(
      FRASE_DO_PREPARO_DEPOIS_DE_MARCAR,
    );
  });

  it("sem texto em vigor do procedimento marcado, ou com a habilidade desligada: sem a F2", async () => {
    const semTexto = await marcar({
      catalogo: {
        ...comPreparo(catalogoDoCadastro()),
        preparosEmVigor: new Map([[PROC.exame, preparo(VERSAO.exame, 3)]]),
      },
      config: configComPreparo(),
    });
    expect(semTexto.r.resposta).not.toContain(
      FRASE_DO_PREPARO_DEPOIS_DE_MARCAR,
    );
    const desligada = await marcar({
      catalogo: comPreparo(catalogoDoCadastro()),
      config: configComPreparo(false),
    });
    expect(desligada.r.tipo).toBe("resposta");
    expect(desligada.r.resposta).not.toContain(
      FRASE_DO_PREPARO_DEPOIS_DE_MARCAR,
    );
  });

  it("na remarcacao: sem a F2 (a frase fixa da remarcacao, como sempre)", async () => {
    const cenario = new CenarioDaAg4({
      config: configComPreparo(true, configDaAg4()),
      catalogo: comPreparo(CATALOGO_DA_AG4),
    });
    consultasDoContato(cenario.banco);
    await cenario.fala({
      texto: "Quero remarcar a de quinta para a semana que vem, de manhã",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("buscar_horario_para_remarcar", {
          consulta: "c1",
          a_partir_de: "2026-10-26",
          periodo: "manha",
          hora: null,
          unidade: null,
        }),
        final(
          "Tenho segunda, 26/10 às 08:00 e terça, 27/10 às 08:00, na unidade Aldeota. Qual fica melhor?",
        ),
      ],
    });
    await cenario.fala({
      texto: "Segunda às 8",
      roteiro: [ferramenta("reservar_horario", { horario: "h1" })],
    });
    const r3 = await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    expect(r3.tipo).toBe("resposta");
    expect(r3.resposta).toBe(
      "Pronto, pedi a remarcação para segunda, 26/10 às 08:00. Até a equipe aprovar, sua consulta de quinta, 22/10 às 14:00 continua marcada. A confirmação chega por aqui.",
    );
  });
});

describe("o estado do atendimento no turno do preparo", () => {
  it("fecha como informacao: o pedido de cancelar armado desarma, e o sim seguinte nao cancela", async () => {
    const cenario = new CenarioDaAg4({
      config: configComPreparo(true, configDaAg4()),
      catalogo: comPreparo(CATALOGO_DA_AG4),
    });
    const { c1 } = consultasDoContato(cenario.banco);
    await cenario.fala({
      texto: "Preciso cancelar minha consulta de quinta",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("pedir_cancelamento", { consulta: "c1" }),
      ],
    });
    expect(cenario.estado).toMatchObject({
      etapa: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: C1,
    });
    const r2 = await cenario.fala({
      texto: "Antes, qual o preparo da consulta?",
      roteiro: [
        ferramenta("enviar_preparo", {
          procedimento: codigo(PROC.consulta),
        }),
      ],
    });
    expect(r2.tipo).toBe("preparo");
    expect(r2.notaParaAEquipe ?? null).toBeNull();
    // Revisao da AG7 (MOTOR-7): a nota para quando o preparo nao sai, pelo
    // motivo da passagem (o executor so a usa nesse caso).
    if (r2.tipo === "preparo") {
      expect(r2.notasSeOPreparoNaoSair?.assunto_clinico).toEqual(
        expect.any(String),
      );
      expect(r2.notasSeOPreparoNaoSair?.conformidade).toEqual(
        expect.any(String),
      );
    }
    expect(cenario.estado).toMatchObject({
      etapa: "informacao",
      pedido_pendente: null,
      pedido_pendente_em: null,
    });
    expect(cenario.estado.desfecho).not.toBe("passou_para_equipe");
    // O "sim" depois do preparo nao e resposta a pergunta do cancelamento.
    await cenario.fala({
      texto: "Sim",
      roteiro: [
        ferramenta("cancelar_consulta", {}),
        final("Qual consulta você quer cancelar?"),
      ],
    });
    expect(cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c1.status).toBe("agendado");
  });
});

// ---------------------------------------------------------------------------
// O simulador da Tela 6 (o mesmo carregador, sobre o banco em memoria)
// ---------------------------------------------------------------------------

describe("o simulador com o preparo", () => {
  const USUARIO = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
  const AMBIENTE = {
    OPENAI_API_KEY: "sk-teste",
    VERCEL_ENV: "production",
    IA_SEGREDO_DO_IDENTIFICADOR: "s".repeat(40),
  };
  const PRECOS = [
    {
      modelo: "gpt-6-luna",
      entrada: 100_000,
      saida: 500_000,
      cacheLeitura: 10_000,
      cacheEscrita: 125_000,
    },
  ];
  const MENSAGEM = mensagemDoPreparo({
    procedimento: "Consulta",
    rt: RT_DE_TESTE,
    texto: TEXTO_DO_PREPARO_DE_TESTE,
  });

  function daClinica<T extends object>(linhas: readonly T[]): Linha[] {
    return linhas.map((linha, i) => ({
      id: `linha-${i}`,
      ...linha,
      clinic_id: CLINICA,
    }));
  }

  /** O Cadastro, o rascunho com a habilidade e as RPCs do preparo. */
  function bancoDoSimulador(mensagem: string | null): AgendaEmMemoria {
    const linhas = linhasDoCadastro();
    const b = new AgendaEmMemoria()
      .rpc("ia_clinicas_da_fase_controlada", () => ({
        data: [CLINICA],
        error: null,
      }))
      .rpc("ia_pode_simular", () => ({ data: true, error: null }))
      .rpc("reservar_gasto_da_ia", () => ({
        data: "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e",
        error: null,
      }))
      .rpc("acertar_gasto_da_ia", () => ({ data: null, error: null }))
      .rpc("preparos_em_vigor_da_clinica", () => ({
        data: [
          {
            procedure_id: PROC.consulta,
            versao_id: VERSAO.consulta,
            versao: 1,
            texto_sha256: SHA_DO_TEXTO,
            rt_nome: RT_DE_TESTE.nome,
            aprovado_em: "2026-10-19T13:00:00+00:00",
          },
        ],
        error: null,
      }))
      .rpc("textos_de_preparo_da_clinica", () => ({
        data: [TEXTO_DO_PREPARO_DE_TESTE],
        error: null,
      }))
      .rpc("ler_preparo_para_envio", () => ({
        data:
          mensagem === null
            ? null
            : {
                versao_id: VERSAO.consulta,
                procedure_id: PROC.consulta,
                versao: 1,
                mensagem,
                sha256: sha256DoTexto(mensagem),
              },
        error: null,
      }));
    b.inserir("procedure", ...daClinica(linhas.procedimentos));
    b.inserir("service_link", ...daClinica(linhas.vinculos));
    b.inserir("professional", ...daClinica(linhas.profissionais));
    b.inserir("insurance", ...daClinica(linhas.convenios));
    b.inserir("clinic", { id: CLINICA, name: "Clínica Bem Estar" });
    // O rascunho com a habilidade ligada (o simulador testa o RASCUNHO).
    b.inserir("ai_agent_config", {
      id: "cfg-rascunho",
      clinic_id: CLINICA,
      version: 2,
      status: "rascunho",
      skills: { enviar_preparo: true },
      updated_at: "2026-10-20T11:00:00.000Z",
    });
    return b;
  }

  async function simular(
    b: AgendaEmMemoria,
    mensagens: {
      autor: "paciente" | "assistente";
      texto: string;
      assinatura?: string | null;
    }[],
    roteiro: unknown[],
    estadoDoAtendimento: string | null = null,
  ) {
    const { cliente, corpos } = clienteComRoteiro(roteiro);
    const r = await simularTurno(
      {
        admin: b.cliente(),
        clinicId: CLINICA,
        userId: USUARIO,
        fuso: FUSO,
        mensagens,
        agoraMs: AGORA,
        estado: estadoDoAtendimento,
        env: AMBIENTE,
      },
      { cliente, verificador, classificador, precos: PRECOS },
    );
    return { r, corpos };
  }

  it("a introducao que o filtro aprovou aparece antes do bloco; a barrada, nao", async () => {
    const pedido = "Me manda a orientação de preparo da consulta, por favor";
    const com = await simular(
      bancoDoSimulador(MENSAGEM),
      [{ autor: "paciente", texto: pedido }],
      [
        ferramenta("enviar_preparo", {
          procedimento: P_CONSULTA,
          introducao: "Claro! Segue a orientação da clínica:",
        }),
      ],
    );
    expect(com.r.ok && com.r.tipo).toBe("preparo");
    expect(com.r.ok && com.r.resposta).toBe(
      `Claro! Segue a orientação da clínica:\n\n${MENSAGEM}`,
    );
    const barrada = await simular(
      bancoDoSimulador(MENSAGEM),
      [{ autor: "paciente", texto: pedido }],
      [
        ferramenta("enviar_preparo", {
          procedimento: P_CONSULTA,
          introducao: "Tome 2 comprimidos:",
        }),
      ],
    );
    expect(barrada.r.ok && barrada.r.resposta).toBe(MENSAGEM);
  });

  it("a mensagem montada pelo banco (o rascunho, p_simulador), com o tipo preparo; nada gravado; na rodada seguinte, o substituto", async () => {
    const b = bancoDoSimulador(MENSAGEM);
    const pedido = "Me manda a orientação de preparo da consulta, por favor";
    const { r } = await simular(
      b,
      [{ autor: "paciente", texto: pedido }],
      [ferramenta("enviar_preparo", { procedimento: P_CONSULTA })],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.tipo).toBe("preparo");
    expect(r.resposta).toBe(MENSAGEM);
    expect(b.chamadasDe("ler_preparo_para_envio")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_versao_id: VERSAO.consulta,
        p_simulador: true,
      },
    ]);
    expect(b.escritas).toEqual([]);
    expect(r.trilha.map((p) => p.texto)).toContain(
      `Pediu a orientação de preparo de Consulta: escolhida a versão 1 (código ${codigoDoTexto(SHA_DO_TEXTO)}), aprovada por Dra. Ana Souza em 19/10/2026.`,
    );

    // A rodada seguinte: a fala do assistente (o preparo, assinado) volta,
    // e o modelo le o substituto, nunca o texto.
    const seguinte = await simular(
      b,
      [
        { autor: "paciente", texto: pedido },
        { autor: "assistente", texto: r.resposta, assinatura: r.assinatura },
        { autor: "paciente", texto: "Obrigada! Vocês atendem aos sábados?" },
      ],
      [final("Atendemos de segunda a sexta.")],
      r.estado,
    );
    expect(seguinte.r.ok).toBe(true);
    semTextoDaClinica("rodada seguinte", seguinte.corpos);
    expect(JSON.stringify(seguinte.corpos[0]?.input)).toContain(
      "Mensagem do sistema: a orientação de preparo de Consulta, aprovada pela clínica, foi enviada aqui.",
    );
  });

  it("revisao da AG7 (MOTOR-6): a resposta depois do preparo leva o aviso de assistente virtual, como no WhatsApp (a mensagem do preparo e do sistema)", async () => {
    const b = bancoDoSimulador(MENSAGEM);
    const pedido = "Me manda a orientação de preparo da consulta, por favor";
    const { r } = await simular(
      b,
      [{ autor: "paciente", texto: pedido }],
      [ferramenta("enviar_preparo", { procedimento: P_CONSULTA })],
    );
    if (!r.ok) {
      throw new Error("o primeiro turno falhou");
    }
    const seguinte = await simular(
      b,
      [
        { autor: "paciente", texto: pedido },
        { autor: "assistente", texto: r.resposta, assinatura: r.assinatura },
        { autor: "paciente", texto: "Obrigada! Vocês atendem aos sábados?" },
      ],
      [final("Atendemos de segunda a sexta.")],
      r.estado,
    );
    expect(seguinte.r.ok).toBe(true);
    if (!seguinte.r.ok) {
      return;
    }
    expect(seguinte.r.resposta).toBe(
      `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\nAtendemos de segunda a sexta.`,
    );
    // Com uma resposta da IA antes, o aviso nao repete.
    const terceira = await simular(
      b,
      [
        { autor: "paciente", texto: pedido },
        { autor: "assistente", texto: r.resposta, assinatura: r.assinatura },
        { autor: "paciente", texto: "Obrigada! Vocês atendem aos sábados?" },
        {
          autor: "assistente",
          texto: seguinte.r.resposta,
          assinatura: seguinte.r.assinatura,
        },
        { autor: "paciente", texto: "E aos domingos?" },
      ],
      [final("Aos domingos não atendemos.")],
      seguinte.r.estado,
    );
    expect(terceira.r.ok).toBe(true);
    if (terceira.r.ok) {
      expect(terceira.r.resposta).toBe("Aos domingos não atendemos.");
    }
  });

  it("fora de vigor na hora: a passagem (a frase), como num turno de verdade", async () => {
    const b = bancoDoSimulador(null);
    const { r } = await simular(
      b,
      [
        {
          autor: "paciente",
          texto: "Me manda a orientação de preparo da consulta, por favor",
        },
      ],
      [ferramenta("enviar_preparo", { procedimento: P_CONSULTA })],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.trilha.map((p) => p.texto)).toEqual(
      expect.arrayContaining([
        PASSO_DO_PREPARO_FORA_DE_VIGOR,
        "Passou para a equipe: o assunto é clínico",
      ]),
    );
  });

  it("revisao da AG7 (CFM-2): o texto aprovado com recusa nao aparece; o bloqueio e a frase, como no WhatsApp", async () => {
    const b = bancoDoSimulador(
      mensagemDoPreparo({
        procedimento: "Consulta",
        rt: RT_DE_TESTE,
        texto:
          "Venha sem maquiagem. Resultado garantido, você vai sair renovada!",
      }),
    );
    const { r } = await simular(
      b,
      [
        {
          autor: "paciente",
          texto: "Me manda a orientação de preparo da consulta",
        },
      ],
      [ferramenta("enviar_preparo", { procedimento: P_CONSULTA })],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.trilha.map((p) => p.texto)).toEqual(
      expect.arrayContaining([
        "A orientação de preparo aprovada tem o que nunca vai ao paciente (promessa de resultado): nada foi enviado.",
        "Passou para a equipe: a resposta não passou na conformidade",
      ]),
    );
    expect(JSON.stringify(r)).not.toContain("Resultado garantido");
  });

  it("a leitura que falha: o simulador avisa, sem inventar", async () => {
    const b = bancoDoSimulador(MENSAGEM);
    b.rpc("ler_preparo_para_envio", () => ({
      data: null,
      error: { code: "57014" },
    }));
    const { r } = await simular(
      b,
      [
        {
          autor: "paciente",
          texto: "Me manda a orientação de preparo da consulta, por favor",
        },
      ],
      [ferramenta("enviar_preparo", { procedimento: P_CONSULTA })],
    );
    expect(r).toEqual({
      ok: false,
      error:
        "Não foi possível carregar a orientação de preparo. Tente de novo.",
    });
  });
});

// Decisao do dono de 06/11/2026 (opcao A; D-80): a pergunta do preparo e do
// remedio do exame chega ao agente so com a habilidade, e a saida e so o
// enviar_preparo. As camadas uma a uma; o portao, a CFM-6 e o filtro sem o laco
// estao em tests/unit/conformidade/portao-preparo-do-exame.test.ts.
describe("a pergunta do preparo e do remedio do exame, pelo laco", () => {
  const OLA = {
    autor: "assistente" as const,
    autoria: "ia" as const,
    texto: "Olá! Como posso ajudar?",
  };
  const PERGUNTAS = [
    "qual o preparo do exame?",
    "como é o preparo do exame?",
    "precisa de jejum pro exame?",
    "e o remédio do exame, como eu tomo?",
    "como eu tomo o remédio do exame?",
    "qual remédio eu tomo antes do exame?",
    "tem algum remédio para tomar antes do exame?",
    "como tomo o remédio do preparo?",
  ];
  const TRAVAS = [
    "posso tomar o remédio com leite?",
    "esqueci de tomar o remédio do exame",
    "tomei o remédio e passei mal",
    "qual remédio eu tomo pra dor?",
    "posso tomar dipirona antes do exame?",
    "tomo remédio de pressão, posso fazer o exame?",
    "preciso parar o remédio antes do exame?",
    "quanto de remédio eu tomo?",
    "sou diabética, qual o preparo do exame?",
    "to grávida, como é o preparo?",
    "me chamo Ana e to com dor, quanto custa o exame?",
  ];
  const semNomeNaConversa = (pergunta: string) => ({
    mensagens: [paciente("Oi"), OLA, paciente(pergunta)],
  });
  const comAConsultaNaConversa = (pergunta: string) => ({
    mensagens: [paciente("Quero marcar uma consulta"), OLA, paciente(pergunta)],
  });

  it.each(PERGUNTAS)(
    "%j, com o procedimento citado antes: o modelo so escolhe e o sistema manda o texto",
    async (pergunta) => {
      const { r, corpos } = await turno(
        [ferramenta("enviar_preparo", { procedimento: P_CONSULTA })],
        comAConsultaNaConversa(pergunta),
      );
      expect(r.tipo).toBe("preparo");
      expect(r.trilha.map((p) => p.texto)).not.toContain(
        PASSO_DO_PEDIDO_COM_SITUACAO_PESSOAL,
      );
      // A variante do classificador com a habilidade, e nenhum filtro: o texto
      // nao e do modelo.
      expect(classificador.mock.calls[0]?.[0]).toMatchObject({
        comPreparo: true,
      });
      expect(verificador).not.toHaveBeenCalled();
      semTextoDaClinica("corpo", corpos);
    },
  );

  it.each(PERGUNTAS)(
    "%j, sem nome e sem nada na conversa: nada sai, e o modelo pergunta qual e",
    async (pergunta) => {
      const { r, corpos } = await turno(
        [
          ferramenta("enviar_preparo", { procedimento: P_EXAME }),
          final("Qual é o exame?"),
        ],
        semNomeNaConversa(pergunta),
      );
      expect(saidas(corpos[1])).toEqual([
        { ok: false, motivo: "procedimento_nao_confirmado" },
      ]);
      expect(r.tipo).toBe("resposta");
      expect(r.resposta).toBe("Qual é o exame?");
      expect(r.trilha.map((p) => p.texto)).toContain(
        PASSO_DO_PROCEDIMENTO_NAO_CONFIRMADO,
      );
    },
  );

  it("com dois procedimentos citados na conversa: o modelo nao escolhe sozinho", async () => {
    const { r, corpos } = await turno(
      [
        ferramenta("enviar_preparo", { procedimento: P_CONSULTA }),
        final("Qual é o exame?"),
      ],
      {
        mensagens: [
          paciente("Quero marcar uma consulta e um botox"),
          OLA,
          paciente("como eu tomo o remédio do exame?"),
        ],
      },
    );
    expect(saidas(corpos[1])).toEqual([
      { ok: false, motivo: "procedimento_nao_confirmado" },
    ]);
    expect(r.tipo).toBe("resposta");
  });

  it("o procedimento da marcacao da conversa confirma, mesmo sem o nome", async () => {
    const { r } = await turno(
      [ferramenta("enviar_preparo", { procedimento: P_EXAME })],
      {
        ...semNomeNaConversa("como eu tomo o remédio do exame?"),
        atendimento: {
          estado: { ...estadoVazio(), procedure_id: PROC.exame },
          dados: dadosVazios(),
        },
      },
    );
    expect(r.tipo).toBe("preparo");
  });

  it("sem texto em vigor: vai para a equipe, sem o modelo escrever nada", async () => {
    const { r } = await turno(
      [ferramenta("enviar_preparo", { procedimento: P_LIMPEZA })],
      {
        mensagens: [
          paciente("Quero marcar uma limpeza de pele"),
          OLA,
          paciente("como eu tomo o remédio do exame?"),
        ],
      },
    );
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({
      tipo: "escalou",
      motivo: "assunto_clinico",
      origem: "ferramenta",
    });
  });

  it.each(PERGUNTAS)(
    "%j, sem a habilidade: o portao escala antes do modelo, como sempre",
    async (pergunta) => {
      const { r, create } = await turno([], {
        ...semNomeNaConversa(pergunta),
        config: configComPreparo(false),
      });
      expect(r.tipo).toBe("frase_fixa");
      expect(r.desfecho).toMatchObject({
        tipo: "escalou",
        motivo: "assunto_clinico",
        origem: "portao",
      });
      expect(create).not.toHaveBeenCalled();
      expect(classificador).not.toHaveBeenCalled();
    },
  );

  it.each(TRAVAS)(
    "%j, com a habilidade: escala no portao, sem modelo",
    async (pergunta) => {
      const { r, create } = await turno([], semNomeNaConversa(pergunta));
      expect(r.tipo).toBe("frase_fixa");
      expect(r.desfecho).toMatchObject({ tipo: "escalou", origem: "portao" });
      expect(create).not.toHaveBeenCalled();
      expect(classificador).not.toHaveBeenCalled();
    },
  );

  it.each([
    "Você toma com bastante água.",
    "É só tomar à noite.",
    "O remédio é tomado na véspera.",
    "Tome 1 comprimido às 18h.",
    "Sim, 2 comprimidos.",
    "Não precisa.",
    "Precisa de jejum de 8 horas.",
  ])(
    "%j: o modelo escreveu o preparo ou o remedio, a regra barra e vai para a equipe",
    async (rascunho) => {
      const { r } = await turno(
        [final(rascunho)],
        comAConsultaNaConversa("como eu tomo o remédio do exame?"),
      );
      expect(r.tipo).toBe("frase_fixa");
      expect(r.desfecho).toMatchObject({
        tipo: "bloqueou",
        categoria: "orientacao_clinica",
        camada: "regra",
      });
      expect(verificador).not.toHaveBeenCalled();
    },
  );

  it("a introducao com o remedio nao sai; o bloco exato sai sozinho", async () => {
    const { r } = await turno(
      [
        ferramenta("enviar_preparo", {
          procedimento: P_CONSULTA,
          introducao: "Claro! Tome o remédio à noite:",
        }),
      ],
      comAConsultaNaConversa("como eu tomo o remédio do exame?"),
    );
    expect(r.tipo).toBe("preparo");
    if (r.tipo === "preparo") {
      expect(r.introducao).toBeNull();
    }
  });

  it("o nome antes do pedido de recepcao chega ao modelo", async () => {
    const { r, create } = await turno(
      [final("Qual é o exame?")],
      semNomeNaConversa("oi, me chamo Ana, quanto custa o exame?"),
    );
    expect(create).toHaveBeenCalled();
    expect(r.tipo).toBe("resposta");
  });
});
