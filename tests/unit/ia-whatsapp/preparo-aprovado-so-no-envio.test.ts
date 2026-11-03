import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({
  config: null as unknown,
  catalogo: null as unknown,
}));

vi.mock("@/lib/agente/contexto", async () => {
  const real = await vi.importActual<typeof import("@/lib/agente/contexto")>(
    "@/lib/agente/contexto",
  );
  return {
    carregarConfigPublicada: async () => estado.config,
    carregarCatalogoDoAgente: async () => estado.catalogo,
    // A leitura de verdade: a RPC do banco em memoria e aprovarParaEnvio.
    lerPreparoParaEnvio: real.lerPreparoParaEnvio,
  };
});

import {
  montarCatalogoDoAgente,
  type CatalogoDoAgente,
} from "@/lib/agente/ferramentas/buscar-procedimento";
import { mascararNome } from "@/lib/agente/historico";
import { executarTurnoDoAgente, type ClienteDoAgente } from "@/lib/agente/laco";
import { configPadraoDoAgente } from "@/lib/domain/agente/config";
import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import {
  FRASE_DE_ESCALONAMENTO,
  FRASE_DO_ASSISTENTE_VIRTUAL,
} from "@/lib/domain/conformidade/frase-fixa";
import { mensagemDoPreparo } from "@/lib/domain/preparo";
import {
  criarClassificadorDeEntrada,
  POLITICA_DO_CLASSIFICADOR_COM_PREPARO,
} from "@/lib/integrations/llm/classificador-de-entrada";
import { criarVerificador } from "@/lib/integrations/llm/verificador";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  enviarFraseFixaDaIa,
  enviarPreparoAprovadoDaIa,
  enviarRespostaDaIa,
} from "@/lib/integrations/whatsapp/send";
import type { DependenciasDoExecutorDaIa } from "@/lib/jobs/responder-com-ia";

import {
  RT_DE_TESTE,
  TEXTO_DO_PREPARO_DE_TESTE,
} from "../../fixtures/ia/conformidade/casos";
import { BancoEmMemoria, type Linha } from "./banco-em-memoria";

const { executarRespostaComIa } = await import("@/lib/jobs/responder-com-ia");

// AG7, a varredura (contrato, secao 7.3; D-80): o texto do preparo aprovado
// pelo RT SO aparece no envio (a mensagem do sistema que sai pelo provedor).
// Nunca no que vai a OpenAI (o prompt, as ferramentas, as saidas delas, o
// historico, o classificador e o verificador), nunca no log, nunca na
// decisao nem no turno gravados. O executor, o laco, o classificador, o
// verificador e o envio sao os de VERDADE, sobre uma OpenAI falsa que guarda
// o corpo de toda chamada e o provedor 'fake'; o banco e em memoria, com o
// gatilho de message emulado na regra que importa aqui. A conversa tem o
// toque da regua de antes com o texto aprovado e o texto antigo
// (prep_instructions), e uma mensagem do preparo enviada antes. Nada vai a
// rede.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const CONTATO = "c1000000-0000-4000-8000-000000000001";
const NUMERO = "a0000000-0000-4000-8000-000000000001";
const JOB = "10000000-0000-4000-8000-000000000001";
const JOB_SEGUINTE = "10000000-0000-4000-8000-000000000002";
const JOB_ANTIGO = "10000000-0000-4000-8000-000000000000";
const EXECUTOR = "motor-ia:20000000-0000-4000-8000-000000000001";
const TELEFONE = "+5584999990001";
const PROCEDIMENTO = "11111111-1111-4111-8111-111111111111";
const PROFISSIONAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VINCULO = "56565656-0000-4000-8000-000000000001";
const VERSAO = "e7e70000-0000-4000-8000-000000000001";
const AGORA = Date.UTC(2026, 9, 13, 15, 0);

const PREP_ANTIGO = "Venha sem maquiagem e com o rosto limpo, por favor.";
const MENSAGEM = mensagemDoPreparo({
  procedimento: "Colonoscopia",
  rt: RT_DE_TESTE,
  texto: TEXTO_DO_PREPARO_DE_TESTE,
});
/** Cada frase do texto aprovado e o texto antigo: nada disso sai. */
const TRECHOS = [...TEXTO_DO_PREPARO_DE_TESTE.split("\n"), PREP_ANTIGO];

const USO_DA_API = {
  input_tokens: 1_200,
  output_tokens: 80,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 10 },
};

function respostaDoAgente(output: unknown[]) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    usage: USO_DA_API,
    output,
  };
}

function enviarPreparoPeloModelo() {
  return respostaDoAgente([
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "x" },
    {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "enviar_preparo",
      arguments: JSON.stringify({ procedimento: "p1" }),
      status: "completed",
    },
  ]);
}

function respostaFinal(mensagem: string) {
  return respostaDoAgente([
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

/** A resposta do responses.parse (classificador e verificador). */
function respostaLida(lido: unknown) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          { type: "output_text", text: JSON.stringify(lido), annotations: [] },
        ],
      },
    ],
    output_parsed: lido,
    usage: USO_DA_API,
  };
}

/** A OpenAI falsa: guarda o corpo de toda chamada (agente, classificador e verificador). */
function openAiFalsa(roteiroDoAgente: unknown[]) {
  const corpos: Record<string, unknown>[] = [];
  const create = vi.fn(async (corpo: Record<string, unknown>) => {
    corpos.push(structuredClone(corpo));
    return roteiroDoAgente.shift();
  });
  const parse = vi.fn(async (corpo: Record<string, unknown>) => {
    corpos.push(structuredClone(corpo));
    const formato = (corpo.text as { format?: { name?: unknown } } | undefined)
      ?.format?.name;
    return respostaLida(
      formato === "classificacao_de_entrada"
        ? { gatilhos: ["nenhum"], confianca: "alta" }
        : { aprovado: true, violacoes: [], confianca: "alta" },
    );
  });
  return {
    cliente: { responses: { create, parse } } as unknown as ClienteDoAgente,
    corpos,
    create,
    parse,
  };
}

function catalogo(): CatalogoDoAgente {
  const base = montarCatalogoDoAgente({
    procedimentos: [
      {
        id: PROCEDIMENTO,
        name: "Colonoscopia",
        active: true,
        bookable_by_ai: true,
      },
    ],
    vinculos: [
      {
        id: VINCULO,
        procedure_id: PROCEDIMENTO,
        professional_id: PROFISSIONAL,
        insurance_id: null,
        price_cents: 90_000,
        covered_by_insurance: false,
        bookable_by_ai: true,
        active: true,
        duration_min: 40,
      },
    ],
    profissionais: [
      { id: PROFISSIONAL, name: "Dr. Bruno Costa", active: true },
    ],
    convenios: [],
  });
  return {
    ...base,
    preparosEmVigor: new Map([
      [
        PROCEDIMENTO,
        {
          versaoId: VERSAO,
          versao: 3,
          textoSha256: sha256DoTexto(TEXTO_DO_PREPARO_DE_TESTE),
          rtNome: RT_DE_TESTE.nome,
          aprovadoEm: "2026-10-12T13:00:00.000Z",
        },
      ],
    ]),
    textosDePreparo: [TEXTO_DO_PREPARO_DE_TESTE, PREP_ANTIGO],
  };
}

let banco: BancoEmMemoria;
let logs: string[];

function mensagemNoBanco(
  id: string,
  campos: Partial<Linha> & { author: string; body: string; created_at: string },
): Linha {
  return {
    id,
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    direction: campos.author === "paciente" ? "entrada" : "saida",
    content_type: "texto",
    media_url: null,
    deleted_at: null,
    is_internal_note: false,
    pelo_celular: false,
    ...campos,
  };
}

function montar() {
  banco = new BancoEmMemoria();
  estado.config = {
    ...configPadraoDoAgente(),
    status: "publicada",
    versao: 7,
    habilidades: {
      ...configPadraoDoAgente().habilidades,
      enviar_preparo: true,
    },
  };
  estado.catalogo = catalogo();
  banco.linhas("clinic").push({
    id: CLINICA,
    timezone: "America/Fortaleza",
    e_de_teste: false,
  });
  banco.linhas("conversation").push({
    id: CONVERSA,
    clinic_id: CLINICA,
    status: "ia_atendendo",
    assignee_user_id: null,
    contact_id: CONTATO,
    whatsapp_account_id: NUMERO,
    awaiting_reply: true,
    numero: {
      id: NUMERO,
      provider: "fake",
      server_url: null,
      instance_id: "fake-a0000000",
      nome: "Recepção",
      connection_status: "conectado",
      removido_em: null,
    },
  });
  banco.linhas("contact").push({
    id: CONTATO,
    clinic_id: CLINICA,
    phone_key: TELEFONE,
    phone_e164: TELEFONE,
    name: "Maria Souza",
    birth_date: null,
  });
  banco.linhas("whatsapp_account_secret").push({
    clinic_id: CLINICA,
    account_id: NUMERO,
    instance_token: "token",
  });
  banco.linhas("ia_janela_da_conversa").push({
    conversation_id: CONVERSA,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    phone_key: TELEFONE,
    desde: "2026-10-12T10:00:00.000Z",
    aberta_por: "ingestao",
  });
  // A conversa de antes: o toque da regua com o texto antigo e com o texto
  // aprovado, um pedido do preparo ja respondido pelo sistema, e o pedido
  // de agora.
  banco.linhas("message").push(
    mensagemNoBanco("r1", {
      author: "sistema",
      body: `Oi! Amanhã você tem Colonoscopia.\n${PREP_ANTIGO}\nPodemos confirmar sua presença?`,
      created_at: "2026-10-12T11:00:00.000Z",
    }),
    mensagemNoBanco("r2", {
      author: "sistema",
      body: `Oi! Amanhã, 13/10/2026 às 16:00, você tem Colonoscopia.\n${TEXTO_DO_PREPARO_DE_TESTE}\nPodemos confirmar sua presença?`,
      created_at: "2026-10-12T12:00:00.000Z",
    }),
    mensagemNoBanco("m0", {
      author: "paciente",
      body: "Qual o preparo da colonoscopia?",
      created_at: "2026-10-12T13:00:00.000Z",
    }),
    mensagemNoBanco("p0", {
      author: "sistema",
      body: MENSAGEM,
      job_id: JOB_ANTIGO,
      delivery_status: "enviada",
      created_at: "2026-10-12T13:00:20.000Z",
    }),
    mensagemNoBanco("m1", {
      author: "paciente",
      body: "Pode me mandar a orientação de preparo de novo, por favor?",
      created_at: "2026-10-13T14:58:30.000Z",
    }),
  );
  banco.linhas("ai_turno").push({
    job_id: JOB_ANTIGO,
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    estado: "enviado",
    saida: "preparo",
    texto: null,
    mensagens_lidas: ["m0"],
  });
  banco.linhas("ia_liberacao").push({
    clinic_id: CLINICA,
    teto_respostas_por_conversa_hora: 20,
  });
  banco.linhas("llm_preco").push({
    modelo: "gpt-6-luna",
    entrada_microdolar_por_milhao: 1_000_000,
    saida_microdolar_por_milhao: 4_000_000,
    cache_leitura_microdolar_por_milhao: 100_000,
    cache_escrita_microdolar_por_milhao: 0,
  });
  for (const nome of [
    "ia_pode_falar_com",
    "confirmar_posse_job",
    "consentimento_vigente",
    "ia_marcar_respondida",
  ]) {
    banco.rpc(nome, () => ({ data: true, error: null }));
  }
  banco.rpc("ia_pode_enviar_agora", () => ({ data: "ok", error: null }));
  banco.rpc("reservar_slot_envio_v2", () => ({
    data: { estado: "ok", espera_ms: 0 },
    error: null,
  }));
  banco.rpc("reservar_gasto_da_ia", () => ({
    data: "30000000-0000-4000-8000-000000000001",
    error: null,
  }));
  banco.rpc("acertar_gasto_da_ia", () => ({ data: null, error: null }));
  banco.rpc("ler_preparo_para_envio", (args) =>
    args.p_versao_id === VERSAO
      ? {
          data: {
            versao_id: VERSAO,
            procedure_id: PROCEDIMENTO,
            versao: 3,
            mensagem: MENSAGEM,
            sha256: sha256DoTexto(MENSAGEM),
          },
          error: null,
        }
      : { data: null, error: null },
  );
  // O gatilho de message, na regra que importa aqui: a resposta 'ia' so com
  // a decisao aprovada do mesmo job e hash; a linha 'sistema' do job da IA,
  // a frase fixa ou a mensagem do preparo com a decisao enviou_preparo do
  // mesmo job, o mesmo hash e a versao.
  banco.aoInserir = (tabela, linha: Linha) => {
    if (tabela !== "message" || typeof linha.job_id !== "string") {
      return null;
    }
    const sha = sha256DoTexto(String(linha.body));
    const decisoes = banco
      .linhas("ai_decision_log")
      .filter((d) => d.job_id === linha.job_id);
    if (linha.author === "ia") {
      return decisoes.some((d) => d.aprovado === true && d.texto_sha256 === sha)
        ? null
        : { code: "CZIA1", message: "ia_sem_aprovacao" };
    }
    if (linha.body === FRASE_DE_ESCALONAMENTO) {
      return null;
    }
    return linha.body === MENSAGEM &&
      decisoes.some(
        (d) =>
          d.desfecho === "enviou_preparo" &&
          d.texto_sha256 === sha &&
          d.preparo_versao_id === VERSAO,
      )
      ? null
      : { code: "CZIA3", message: "frase_divergente" };
  };
}

function dependencias(
  openAi: ReturnType<typeof openAiFalsa>,
): DependenciasDoExecutorDaIa {
  return {
    admin: banco.cliente(),
    config: { ligado: true, clinicas: [CLINICA] },
    prazoFinalMs: AGORA + 55_000,
    agora: () => AGORA,
    clienteDoAgente: () => openAi.cliente,
    modeloDoAgente: () => "gpt-6-luna",
    segredoDoIdentificador: () => "s".repeat(40),
    criarVerificador: (identificador) =>
      criarVerificador({
        cliente: openAi.cliente,
        modelo: "gpt-6-luna",
        identificadorDeSeguranca: identificador,
      }),
    criarClassificador: (identificador) =>
      criarClassificadorDeEntrada({
        cliente: openAi.cliente,
        modelo: "gpt-6-luna",
        identificadorDeSeguranca: identificador,
      }),
    executarTurno: executarTurnoDoAgente,
    enviarResposta: enviarRespostaDaIa,
    enviarFrase: enviarFraseFixaDaIa,
    enviarPreparo: enviarPreparoAprovadoDaIa,
  };
}

function rodar(jobId: string, ultima: string, roteiro: unknown[]) {
  const openAi = openAiFalsa(roteiro);
  return executarRespostaComIa(
    {
      id: jobId,
      clinic_id: CLINICA,
      kind: "responder_com_ia",
      payload: { conversation_id: CONVERSA, ultima_mensagem_id: ultima },
      attempts: 1,
      max_attempts: 3,
      whatsapp_account_id: NUMERO,
      created_at: "2026-10-13T14:59:00.000Z",
    },
    EXECUTOR,
    dependencias(openAi),
  ).then((resultado) => ({ resultado, openAi }));
}

/** Nada do texto da clinica em `onde` (texto ou qualquer objeto). */
function semOTexto(rotulo: string, onde: unknown) {
  const tudo = typeof onde === "string" ? onde : JSON.stringify(onde);
  for (const trecho of TRECHOS) {
    expect(tudo, `${rotulo}: ${trecho.slice(0, 40)}`).not.toContain(trecho);
  }
}

beforeEach(() => {
  resetFakeProvider();
  montar();
  logs = [];
  const capturar = (linha: string | Uint8Array): boolean => {
    logs.push(String(linha));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o texto do preparo aprovado so aparece no envio", () => {
  it("o turno do preparo: sai palavra por palavra pelo provedor; a OpenAI, o log, a decisao e o turno nunca o veem", async () => {
    const { resultado, openAi } = await rodar(JOB, "m1", [
      enviarPreparoPeloModelo(),
    ]);
    expect(resultado).toEqual({ ok: true });

    // 1. O envio: a mensagem do sistema inteira, uma vez, pelo provedor.
    expect(fakeSentMessages().map((m) => [m.to, m.body])).toEqual([
      [TELEFONE, MENSAGEM],
    ]);
    const enviada = banco.linhas("message").find((m) => m.job_id === JOB);
    expect(enviada).toMatchObject({
      author: "sistema",
      body: MENSAGEM,
      delivery_status: "enviada",
      cost_cents: 0,
      billable: false,
    });

    // 2. A OpenAI: o agente (o prompt, as ferramentas e o historico) e o
    // classificador (com a variante do preparo). O verificador nem e
    // chamado no turno do preparo.
    expect(openAi.create).toHaveBeenCalledTimes(1);
    expect(openAi.parse).toHaveBeenCalledTimes(1);
    expect(
      openAi.corpos.some(
        (c) => c.instructions === POLITICA_DO_CLASSIFICADOR_COM_PREPARO,
      ),
    ).toBe(true);
    semOTexto("o que foi a OpenAI", openAi.corpos);
    const historico = JSON.stringify(
      openAi.corpos.find((c) => Array.isArray(c.tools))?.input,
    );
    expect(historico).toContain(
      "Mensagem do sistema: a orientação de preparo de Colonoscopia, aprovada pela clínica, foi enviada aqui.",
    );
    expect(historico).toContain(
      "(o texto da orientação de preparo aprovada pela clínica estava aqui)",
    );

    // 3. O que fica gravado: so o hash e a versao.
    semOTexto("ai_decision_log", banco.linhas("ai_decision_log"));
    expect(banco.linhas("ai_decision_log")[0]).toMatchObject({
      desfecho: "enviou_preparo",
      preparo_versao_id: VERSAO,
      texto_sha256: sha256DoTexto(MENSAGEM),
    });
    semOTexto("ai_turno", banco.linhas("ai_turno"));
    expect(
      banco.linhas("ai_turno").find((t) => t.job_id === JOB),
    ).toMatchObject({ estado: "enviado", saida: "preparo", texto: null });

    // 4. O log.
    semOTexto("log", logs.join(""));
  });

  it("o turno seguinte, com a resposta do modelo: o historico, o classificador e o verificador sem o texto; a resposta leva o aviso de assistente virtual", async () => {
    await rodar(JOB, "m1", [enviarPreparoPeloModelo()]);
    resetFakeProvider();
    banco.linhas("message").push(
      mensagemNoBanco("m2", {
        author: "paciente",
        body: "Obrigada! Vocês atendem aos sábados?",
        created_at: "2026-10-13T14:59:30.000Z",
      }),
    );
    const doModelo = "Atendemos de segunda a sexta.";
    const { resultado, openAi } = await rodar(JOB_SEGUINTE, "m2", [
      respostaFinal(doModelo),
    ]);
    expect(resultado).toEqual({ ok: true });
    // O classificador, o agente e o verificador foram chamados.
    expect(openAi.create).toHaveBeenCalledTimes(1);
    expect(openAi.parse).toHaveBeenCalledTimes(2);
    semOTexto("o que foi a OpenAI", openAi.corpos);
    // D-77: a mensagem do preparo e do sistema; a primeira resposta da IA
    // na janela leva o aviso.
    expect(fakeSentMessages().map((m) => m.body)).toEqual([
      `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${doModelo}`,
    ]);
    semOTexto("log", logs.join(""));
  });
});

// ---------------------------------------------------------------------------
// Revisao da AG7 (CFM-1 e MOTOR-1): a varredura com o nome do contato
// dentro dos textos de preparo da clinica
// ---------------------------------------------------------------------------

/** Minusculas, sem acento, o que nao e letra nem numero vira espaco. */
function normalizado(texto: string): string {
  return texto
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * As frases de um texto de preparo (por linha, ponto e dois pontos) com tres
 * palavras ou mais, normalizadas, como sairam e com a mascara do nome.
 */
function frasesDoTexto(texto: string, nome: string): string[] {
  const doTexto = (t: string) =>
    t
      .split(/[.!?:\n]+/u)
      .map(normalizado)
      .filter((frase) => frase.split(" ").length >= 3);
  return [
    ...new Set([...doTexto(texto), ...doTexto(mascararNome(texto, nome))]),
  ];
}

describe("revisao da AG7 (CFM-1): nenhum texto de preparo da clinica vai a OpenAI, nem com o nome do contato dentro dele", () => {
  const CASOS = [
    {
      nome: "Clara Souza",
      textos: [
        "Na véspera, faça dieta líquida clara: água, chá e suco coado.\nÀs 18h, tome 2 comprimidos de bisacodil 5 mg.\nJejum de 8 horas antes do exame.",
        "Venha sem maquiagem, Clara, e com o rosto limpo.",
      ],
    },
    {
      nome: "Sol Andrade",
      textos: [
        "Evite exposição ao sol por 15 dias antes do procedimento.\nSuspenda o uso de ácido retinoico 7 dias antes.",
      ],
    },
    {
      nome: "João Pereira",
      textos: [
        "O Dr. João pede jejum de 12 horas antes do exame.\nTome o manitol a 20% às 20h da véspera.",
      ],
    },
    {
      nome: "Maria Lima",
      textos: [
        "Chegue à Clínica Santa Maria 30 minutos antes.\nJejum de 8 horas antes do exame, inclusive de água.\nTome 2 comprimidos de bisacodil 5 mg às 18h.",
      ],
    },
    {
      // A contato que derruba as duas ancoras da mensagem do sistema.
      nome: "Preparo Silva",
      textos: [
        "Na véspera, só líquidos claros.\nTome 2 comprimidos de bisacodil 5 mg às 18h.",
      ],
    },
  ] as const;

  it.each(CASOS)(
    "contato $nome: o toque da regua, a mensagem do sistema e o texto antigo no historico; a OpenAI le so os marcadores",
    async ({ nome, textos }) => {
      const [aprovado] = textos;
      const primeiro = nome.split(" ")[0] ?? nome;
      const mensagemDoSistema = mensagemDoPreparo({
        procedimento: "Colonoscopia",
        rt: RT_DE_TESTE,
        texto: aprovado,
      });
      const contato = banco
        .linhas("contact")
        .find((linha) => linha.id === CONTATO);
      if (contato === undefined) {
        throw new Error("contato");
      }
      contato.name = nome;
      estado.catalogo = { ...catalogo(), textosDePreparo: [...textos] };
      const mensagens = banco.linhas("message");
      for (const linha of mensagens) {
        if (linha.id === "r1") {
          linha.body = `Oi, ${primeiro}! Amanhã você tem Colonoscopia.\n${textos[1] ?? aprovado}\nPodemos confirmar sua presença?`;
        }
        if (linha.id === "r2") {
          linha.body = `Oi, ${primeiro}! Amanhã, 13/10/2026 às 16:00, você tem Colonoscopia.\n${aprovado}\nPodemos confirmar sua presença?`;
        }
        if (linha.id === "p0") {
          linha.body = mensagemDoSistema;
        }
      }
      const doModelo = "Atendemos de segunda a sexta.";
      const { resultado, openAi } = await rodar(JOB, "m1", [
        respostaFinal(doModelo),
      ]);
      expect(resultado).toEqual({ ok: true });
      // O classificador, o agente e o verificador foram chamados.
      expect(openAi.create).toHaveBeenCalledTimes(1);
      expect(openAi.parse).toHaveBeenCalledTimes(2);

      const tudo = ` ${normalizado(JSON.stringify(openAi.corpos))} `;
      for (const texto of textos) {
        for (const frase of frasesDoTexto(texto, nome)) {
          expect(tudo, `${nome}: ${frase}`).not.toContain(` ${frase} `);
        }
      }
      for (const palavra of ["bisacodil", "manitol", "retinoico"]) {
        expect(tudo).not.toContain(palavra);
      }
      // O historico tem os marcadores e o nome continua mascarado.
      const historico = JSON.stringify(
        openAi.corpos.find((c) => Array.isArray(c.tools))?.input,
      );
      expect(historico).toContain(
        "(o texto da orientação de preparo aprovada pela clínica estava aqui)",
      );
      expect(historico).toContain("aprovada pela clínica, foi enviada aqui.");
      expect(historico).not.toContain(primeiro);
      semOTexto("log", logs.join(""));
    },
  );
});
