import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ClienteDoAgente, ResultadoDoTurno } from "@/lib/agente/laco";
import { PASSO_DO_PREPARO_FORA_DE_VIGOR } from "@/lib/agente/ferramentas/enviar-preparo";
import { versaoDoFiltroDoTurno } from "@/lib/agente/whatsapp";
import {
  configPadraoDoAgente,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import {
  sha256DoTexto,
  versaoDasRegras,
} from "@/lib/domain/conformidade/filtro";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import { mensagemDoPreparo } from "@/lib/domain/preparo";
import { versaoDaPoliticaDoClassificador } from "@/lib/integrations/llm/classificador-de-entrada";
import type { Job } from "@/lib/jobs/worker";

import {
  RT_DE_TESTE,
  TEXTO_DO_PREPARO_DE_TESTE,
} from "../../fixtures/ia/conformidade/casos";
import { BancoEmMemoria, type Linha } from "./banco-em-memoria";

// AG7: o executor do job 'responder_com_ia' com o turno do preparo (contrato,
// secao 3.1, EXEC), com banco em memoria, turno falso de roteiro e envio
// falso. O que se prova: ler_preparo_para_envio e aprovarParaEnvio ANTES da
// decisao; a decisao 'enviou_preparo' com a versao e o hash da mensagem do
// banco, gravada antes do envio; o turno 'decidido' com a saida 'preparo' e
// sem texto; o envio, a decisao ligada a mensagem e o turno 'enviado'; fora
// de vigor na hora, assunto_clinico e a frase (nunca atribui); o CZIA3 vira
// a frase pelo mesmo job; o CZIA2 passa sem frase; a retomada reconfere a
// decisao e a aprovacao antes de reenviar; o teto por hora conta o preparo;
// fraseJaSaiu so com o corpo da frase; a versao da variante do classificador
// em versao_filtro. Nenhum texto de preparo vai para o log.

const estado = vi.hoisted(() => ({ config: null as unknown }));

vi.mock("@/lib/agente/contexto", async () => {
  const real = await vi.importActual<typeof import("@/lib/agente/contexto")>(
    "@/lib/agente/contexto",
  );
  return {
    carregarConfigPublicada: async () => estado.config,
    carregarCatalogoDoAgente: async () => ({
      procedimentos: [],
      vinculos: [],
      convenios: [],
      conveniosDoCadastro: [],
    }),
    // A leitura de verdade (a RPC do banco em memoria e aprovarParaEnvio).
    lerPreparoParaEnvio: real.lerPreparoParaEnvio,
  };
});

const { executarRespostaComIa } = await import("@/lib/jobs/responder-com-ia");
type Dependencias = Parameters<typeof executarRespostaComIa>[2];

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const CONTATO = "c1000000-0000-4000-8000-000000000001";
const NUMERO = "a0000000-0000-4000-8000-000000000001";
const JOB = "10000000-0000-4000-8000-000000000001";
const EXECUTOR = "motor-ia:20000000-0000-4000-8000-000000000001";
const RESERVA = "30000000-0000-4000-8000-000000000001";
const VERSAO = "e7e70000-0000-4000-8000-000000000001";
const PROCEDIMENTO = "11111111-1111-4111-8111-111111111111";
const DECISAO = "d7d70000-0000-4000-8000-000000000001";
const TELEFONE = "+5584999990001";
const PERGUNTA = "Me manda a orientação de preparo da colonoscopia?";
// Terca, 13/10/2026, 12:00 em Fortaleza (15:00 UTC).
const AGORA = Date.UTC(2026, 9, 13, 15, 0);
const DESDE = "2026-10-13T14:58:00.000Z";
const CRIADO = "2026-10-13T14:59:00.000Z";

const MENSAGEM = mensagemDoPreparo({
  procedimento: "Colonoscopia",
  rt: RT_DE_TESTE,
  texto: TEXTO_DO_PREPARO_DE_TESTE,
});
const SHA = sha256DoTexto(MENSAGEM);
const VERSAO_DO_CLASSIFICADOR = versaoDaPoliticaDoClassificador({
  comPreparo: true,
});

const USO = {
  tokensEntrada: 1000,
  tokensSaida: 50,
  tokensCacheLidos: 200,
  tokensCacheGravados: 0,
};

const PASSO = {
  tipo: "cadastro" as const,
  texto:
    "Pediu a orientação de preparo de Colonoscopia: escolhida a versão 3 (código ABCD 1234), aprovada por Dra. Ana Souza em 27/10/2026.",
};

function preparo(): ResultadoDoTurno {
  return {
    tipo: "preparo",
    preparo: { procedimentoId: PROCEDIMENTO, versaoId: VERSAO, versao: 3 },
    resposta: null,
    rascunhoBloqueado: null,
    desfecho: {
      tipo: "enviou_preparo",
      versaoId: VERSAO,
      procedimentoId: PROCEDIMENTO,
    },
    trilha: [PASSO],
    uso: [
      { papel: "classificador", modelo: "gpt-6-luna", uso: USO },
      { papel: "agente", modelo: "gpt-6-luna-2026", uso: USO },
    ],
    versaoDoPrompt: "agente-teste",
    filtro: null,
    descartados: { instrucoes: false, itensDaBase: 0 },
    ferramentasUsadas: ["enviar_preparo"],
    versaoDoClassificador: VERSAO_DO_CLASSIFICADOR,
  };
}

/** O que ler_preparo_para_envio devolve com a versao em vigor. */
function lidoDoBanco(mensagem = MENSAGEM) {
  return {
    versao_id: VERSAO,
    procedure_id: PROCEDIMENTO,
    versao: 3,
    mensagem,
    sha256: sha256DoTexto(mensagem),
  };
}

function configPublicada(): ConfigDoAgente {
  const base = configPadraoDoAgente();
  return {
    ...base,
    status: "publicada",
    versao: 3,
    habilidades: { ...base.habilidades, enviar_preparo: true },
  };
}

let banco: BancoEmMemoria;
let tempo: number;
let passagens: string[];
let eventos: string[];
let logs: string[];
let lido: unknown;
let turno: ReturnType<typeof vi.fn<Dependencias["executarTurno"]>>;
let enviarResposta: ReturnType<typeof vi.fn<Dependencias["enviarResposta"]>>;
let enviarFrase: ReturnType<typeof vi.fn<Dependencias["enviarFrase"]>>;
let enviarPreparo: ReturnType<
  typeof vi.fn<NonNullable<Dependencias["enviarPreparo"]>>
>;
let decisoesNoEnvio: number[];

function job(extra: Partial<Job> = {}): Job {
  return {
    id: JOB,
    clinic_id: CLINICA,
    kind: "responder_com_ia",
    payload: { conversation_id: CONVERSA, ultima_mensagem_id: "m1" },
    attempts: 1,
    max_attempts: 3,
    whatsapp_account_id: NUMERO,
    created_at: CRIADO,
    ...extra,
  };
}

function conversa(): Linha {
  return banco.linhas("conversation")[0]!;
}

function montar() {
  banco = new BancoEmMemoria();
  tempo = AGORA;
  passagens = [];
  eventos = [];
  decisoesNoEnvio = [];
  lido = lidoDoBanco();
  estado.config = configPublicada();
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
  });
  banco.linhas("contact").push({
    id: CONTATO,
    clinic_id: CLINICA,
    phone_key: TELEFONE,
    name: "Maria Souza",
    birth_date: null,
  });
  banco.linhas("ia_janela_da_conversa").push({
    conversation_id: CONVERSA,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    phone_key: TELEFONE,
    desde: DESDE,
    aberta_por: "ingestao",
  });
  banco.linhas("message").push({
    id: "m1",
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    author: "paciente",
    direction: "entrada",
    content_type: "texto",
    body: PERGUNTA,
    media_url: null,
    deleted_at: null,
    is_internal_note: false,
    pelo_celular: false,
    created_at: "2026-10-13T14:58:30.000Z",
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
  banco.rpc("ia_pode_falar_com", () => ({ data: true, error: null }));
  banco.rpc("confirmar_posse_job", () => ({ data: true, error: null }));
  banco.rpc("consentimento_vigente", () => ({ data: true, error: null }));
  banco.rpc("reservar_gasto_da_ia", () => ({ data: RESERVA, error: null }));
  banco.rpc("acertar_gasto_da_ia", () => ({ data: null, error: null }));
  banco.rpc("ler_preparo_para_envio", () => ({ data: lido, error: null }));
  banco.rpc("passar_conversa_da_ia_para_equipe", (args) => {
    passagens.push(String(args.p_motivo));
    const c = conversa();
    if (c.status === "ia_atendendo") {
      c.status = "aguardando_humano";
      return { data: { passou: true, codigo: "passou" }, error: null };
    }
    return { data: { passou: false, codigo: "ja_fora_da_ia" }, error: null };
  });
  banco.rpc("gravar_evento_da_ia", (args) => {
    eventos.push(String(args.p_motivo));
    return { data: true, error: null };
  });
  banco.rpc("atribuir_conversa_passada_pela_ia", () => ({
    data: { codigo: "sem_passagem" },
    error: null,
  }));

  turno = vi.fn<Dependencias["executarTurno"]>(async () => preparo());
  enviarResposta = vi.fn<Dependencias["enviarResposta"]>(async () => ({
    ok: true,
    messageId: "msg-resposta",
  }));
  enviarFrase = vi.fn<Dependencias["enviarFrase"]>(async () => {
    decisoesNoEnvio.push(banco.linhas("ai_decision_log").length);
    return { ok: true, messageId: "msg-frase" };
  });
  enviarPreparo = vi.fn<NonNullable<Dependencias["enviarPreparo"]>>(
    async () => {
      decisoesNoEnvio.push(banco.linhas("ai_decision_log").length);
      return { ok: true, messageId: "msg-preparo" };
    },
  );
}

function deps(extra: Partial<Dependencias> = {}): Dependencias {
  return {
    admin: banco.cliente(),
    config: { ligado: true, clinicas: [CLINICA] },
    prazoFinalMs: AGORA + 55_000,
    agora: () => tempo,
    clienteDoAgente: () =>
      ({ responses: { create: vi.fn() } }) as unknown as ClienteDoAgente,
    modeloDoAgente: () => "gpt-6-luna",
    segredoDoIdentificador: () => "s".repeat(40),
    criarVerificador: () => async () => ({
      tipo: "falha",
      motivo: "sem_cliente",
      modelo: null,
      uso: null,
      httpStatus: null,
    }),
    criarClassificador: () => async () => ({
      tipo: "falha",
      motivo: "sem_cliente",
      modelo: null,
      uso: null,
      httpStatus: null,
    }),
    executarTurno: turno,
    enviarResposta,
    enviarFrase,
    enviarPreparo,
    ...extra,
  };
}

function rodar(extra: Partial<Dependencias> = {}, j: Job = job()) {
  return executarRespostaComIa(j, EXECUTOR, deps(extra));
}

function turnoGravado(): Linha | undefined {
  return banco.linhas("ai_turno").find((t) => t.job_id === JOB);
}

function decisoes(): Linha[] {
  return banco.linhas("ai_decision_log");
}

beforeEach(() => {
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
  // Nenhum texto do preparo, do paciente ou do contato no log.
  const tudo = logs.join("");
  for (const linha of TEXTO_DO_PREPARO_DE_TESTE.split("\n")) {
    expect(tudo).not.toContain(linha);
  }
  expect(tudo).not.toContain(PERGUNTA);
  expect(tudo).not.toContain(TELEFONE);
  expect(tudo).not.toContain("Maria");
});

describe("o turno do preparo", () => {
  it("a decisao enviou_preparo com a versao e o hash ANTES do envio, o turno decidido com a saida preparo e sem texto, o envio, a decisao ligada e o turno enviado", async () => {
    expect(await rodar()).toEqual({ ok: true });
    // A leitura da mensagem pronta: a versao do turno, fora do simulador.
    expect(banco.chamadasDe("ler_preparo_para_envio")).toEqual([
      { p_clinic_id: CLINICA, p_versao_id: VERSAO, p_simulador: false },
    ]);
    // A decisao, gravada antes do envio.
    expect(decisoesNoEnvio).toEqual([1]);
    expect(decisoes()).toHaveLength(1);
    expect(decisoes()[0]).toMatchObject({
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      desfecho: "enviou_preparo",
      preparo_versao_id: VERSAO,
      texto_sha256: SHA,
      aprovado: false,
      compliance_blocked: false,
      escalation_reason: null,
      motivo_da_falha: null,
      gatilho_entrada: null,
      compliance_rule: null,
      camada: null,
      tool_used: "enviar_preparo",
      config_version: 3,
      message_id: "msg-preparo",
      // A variante do classificador que rodou.
      versao_filtro: versaoDoFiltroDoTurno(
        versaoDasRegras(),
        VERSAO_DO_CLASSIFICADOR,
      ),
      context_read: { trilha: [PASSO] },
    });
    // O envio: so o preparo, palavra por palavra, pelo job.
    expect(enviarPreparo).toHaveBeenCalledTimes(1);
    const enviado = enviarPreparo.mock.calls[0]![1];
    expect(enviado).toMatchObject({
      clinicId: CLINICA,
      conversationId: CONVERSA,
      contactId: CONTATO,
      jobId: JOB,
      workerId: EXECUTOR,
      whatsappAccountId: NUMERO,
    });
    expect(enviado.preparo.mensagem).toBe(MENSAGEM);
    expect(enviado.preparo.sha256).toBe(SHA);
    expect(Object.isFrozen(enviado.preparo)).toBe(true);
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(passagens).toEqual([]);
    expect(turnoGravado()).toMatchObject({
      estado: "enviado",
      saida: "preparo",
      texto: null,
      texto_sha256: SHA,
    });
    expect(conversa().status).toBe("ia_atendendo");
  });

  it.each([
    ["fora de vigor (nulo)", null],
    [
      "fora do formato (outro hash)",
      { ...lidoDoBanco(), sha256: "0".repeat(64) },
    ],
    [
      "de outra versao",
      { ...lidoDoBanco(), versao_id: "e7e70000-0000-4000-8000-000000000009" },
    ],
  ])(
    "a leitura na hora %s: assunto_clinico (origem sistema), a frase; nada do preparo sai; nunca atribui",
    async (_n, leitura) => {
      lido = leitura;
      expect(await rodar()).toEqual({ ok: true });
      expect(enviarPreparo).not.toHaveBeenCalled();
      expect(decisoes()).toHaveLength(1);
      expect(decisoes()[0]).toMatchObject({
        desfecho: "escalou",
        escalation_reason: "assunto_clinico",
        texto_sha256: null,
        tool_used: "enviar_preparo",
      });
      // A coluna nova so vai na decisao do preparo (a linha antiga nem a
      // menciona: o codigo nunca a manda nula).
      expect(decisoes()[0]).not.toHaveProperty("preparo_versao_id");
      expect(
        (
          decisoes()[0]?.context_read as { trilha: { texto: string }[] }
        ).trilha.map((p) => p.texto),
      ).toEqual([
        PASSO.texto,
        PASSO_DO_PREPARO_FORA_DE_VIGOR,
        "Passou para a equipe: o assunto é clínico",
      ]);
      expect(passagens).toEqual(["assunto_clinico"]);
      expect(enviarFrase).toHaveBeenCalledTimes(1);
      // assunto_clinico nunca atribui (a chamada nem sai).
      expect(banco.chamadasDe("atribuir_conversa_passada_pela_ia")).toEqual([]);
      expect(turnoGravado()).toMatchObject({
        estado: "passou_para_equipe",
        saida: "frase",
      });
    },
  );

  it.each([
    [
      "promessa de resultado (o texto antigo copiado e aprovado)",
      "Venha sem maquiagem. Resultado garantido, você vai sair renovada!",
      "promessa_resultado",
    ],
    [
      "oferta casada",
      "Venha em jejum de 8 horas. Na compra do exame, o retorno sai de brinde.",
      "oferta_casada",
    ],
    [
      "oferta de outro procedimento (com desconto, a oferta vem primeiro)",
      "Venha em jejum de 8 horas. Aproveite e faça também a limpeza de pele com 20% de desconto.",
      "oferta_casada",
    ],
    [
      "preco (desconto)",
      "Venha em jejum de 8 horas. O exame tem 20% de desconto.",
      "preco_nao_verificado",
    ],
    [
      "normalizacao de sintoma",
      "Venha em jejum de 8 horas. Cólica leve é normal e passa sozinha.",
      "triagem",
    ],
    [
      "link",
      "Jejum de 8 horas. Veja o vídeo em https://exemplo.com/preparo antes do exame.",
      "formato_invalido",
    ],
  ])(
    "revisao da AG7 (CFM-2): o texto aprovado com %s nunca sai; o bloqueio da conformidade e a frase, sem o texto em log",
    async (_n, texto, categoria) => {
      lido = lidoDoBanco(
        mensagemDoPreparo({
          procedimento: "Colonoscopia",
          rt: RT_DE_TESTE,
          texto,
        }),
      );
      expect(await rodar()).toEqual({ ok: true });
      expect(enviarPreparo).not.toHaveBeenCalled();
      expect(decisoes()).toHaveLength(1);
      expect(decisoes()[0]).toMatchObject({
        desfecho: "bloqueou",
        compliance_blocked: true,
        compliance_rule: categoria,
        camada: "regra",
        escalation_reason: "conformidade",
        texto_sha256: null,
        tool_used: "enviar_preparo",
      });
      const trilha = (
        decisoes()[0]?.context_read as { trilha: { texto: string }[] }
      ).trilha.map((p) => p.texto);
      expect(trilha[0]).toBe(PASSO.texto);
      expect(trilha[1]).toMatch(
        /^A orientação de preparo aprovada tem o que nunca vai ao paciente \(.+\): nada foi enviado\.$/,
      );
      expect(trilha[2]).toBe(
        "Passou para a equipe: a resposta não passou na conformidade",
      );
      expect(passagens).toEqual(["conformidade"]);
      expect(enviarFrase).toHaveBeenCalledTimes(1);
      expect(turnoGravado()).toMatchObject({
        estado: "passou_para_equipe",
        saida: "frase",
        texto: null,
      });
      // O motivo no log, so as categorias (o texto nunca).
      const tudo = logs.join("");
      expect(tudo).toContain("ia_preparo_recusado");
      expect(tudo).toContain(categoria);
      for (const trecho of texto.split(". ")) {
        expect(tudo).not.toContain(trecho);
      }
      expect(JSON.stringify(decisoes())).not.toContain(texto.slice(0, 30));
    },
  );

  it("revisao da AG7 (MOTOR-7): o preparo que nao sai passa com a nota da AG3 do motivo da passagem", async () => {
    const notas = {
      assunto_clinico: "Nota da passagem: assunto clínico.",
      conformidade: "Nota da passagem: conformidade.",
    };
    turno.mockImplementation(async () => ({
      ...preparo(),
      notasSeOPreparoNaoSair: notas,
    }));
    const notasGravadas = () =>
      banco
        .linhas("message")
        .filter((m) => m.is_internal_note === true)
        .map((m) => m.body);

    // Fora de vigor: a nota do assunto clinico.
    lido = null;
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["assunto_clinico"]);
    expect(notasGravadas()).toEqual([notas.assunto_clinico]);

    // Com recusa: a da conformidade.
    montar();
    turno.mockImplementation(async () => ({
      ...preparo(),
      notasSeOPreparoNaoSair: notas,
    }));
    lido = lidoDoBanco(
      mensagemDoPreparo({
        procedimento: "Colonoscopia",
        rt: RT_DE_TESTE,
        texto: "Venha sem maquiagem. Resultado garantido!",
      }),
    );
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["conformidade"]);
    expect(notasGravadas()).toEqual([notas.conformidade]);

    // Enviado: nenhuma nota.
    montar();
    turno.mockImplementation(async () => ({
      ...preparo(),
      notasSeOPreparoNaoSair: notas,
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(notasGravadas()).toEqual([]);
  });

  it("erro da leitura: o job tenta de novo, nada decidido nem enviado", async () => {
    banco.rpc("ler_preparo_para_envio", () => ({
      data: null,
      error: { code: "57014" },
    }));
    expect(await rodar()).toEqual({ ok: false, erro: "leitura_falhou" });
    expect(decisoes()).toEqual([]);
    expect(enviarPreparo).not.toHaveBeenCalled();
    expect(enviarFrase).not.toHaveBeenCalled();
  });
});

describe("as recusas do envio do preparo", () => {
  it("frase_divergente (CZIA3): a saida vira a frase e a conversa passa com falha_tecnica; a frase sai no mesmo job", async () => {
    enviarPreparo.mockImplementation(async () => ({
      ok: false,
      reason: "falha_envio",
      code: "frase_divergente",
      message: "x",
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["falha_tecnica"]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    expect(enviarFrase.mock.calls[0]![1]).toMatchObject({ jobId: JOB });
    expect(turnoGravado()).toMatchObject({
      estado: "passou_para_equipe",
      saida: "frase",
      texto: null,
    });
  });

  it("ia_nao_liberada (CZIA2): a liberacao caiu, passa sem frase", async () => {
    enviarPreparo.mockImplementation(async () => ({
      ok: false,
      reason: "falha_envio",
      code: "ia_nao_liberada",
      message: "x",
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["liberacao_perdida"]);
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(turnoGravado()).toMatchObject({ estado: "sem_envio" });
  });

  it("slot adiado: o job volta quando o canal abre, com o turno decidido", async () => {
    enviarPreparo.mockImplementation(async () => ({
      ok: false,
      reason: "slot_adiado",
      code: "canal_ocupado",
      livreEm: "2026-10-13T15:00:30.000Z",
      message: "x",
    }));
    expect(await rodar()).toEqual({
      reagendar: "2026-10-13T15:00:30.000Z",
      motivo: "canal_ocupado",
    });
    expect(turnoGravado()).toMatchObject({
      estado: "decidido",
      saida: "preparo",
      decision_id: decisoes()[0]?.id,
    });
  });

  it("ja_enviado: a linha do job (a do preparo, 'sistema') saiu, e o turno fecha enviado", async () => {
    enviarPreparo.mockImplementation(async () => {
      banco.linhas("message").push({
        id: "msg-preparo",
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        job_id: JOB,
        author: "sistema",
        body: MENSAGEM,
        delivery_status: "enviada",
      });
      return {
        ok: false,
        reason: "ja_enviado",
        code: "ja_enviado",
        message: "x",
      };
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(turnoGravado()).toMatchObject({ estado: "enviado" });
    expect(passagens).toEqual([]);
  });
});

describe("a retomada do turno decidido com o preparo", () => {
  function decidido(extra: Linha = {}) {
    banco.linhas("ai_decision_log").push({
      id: DECISAO,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      desfecho: "enviou_preparo",
      aprovado: false,
      texto_sha256: SHA,
      preparo_versao_id: VERSAO,
      created_at: CRIADO,
      ...extra,
    });
    banco.linhas("ai_turno").push({
      job_id: JOB,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      estado: "decidido",
      reserva_id: null,
      reservas_perdidas: [],
      saida: "preparo",
      texto: null,
      texto_sha256: SHA,
      decision_id: DECISAO,
      mensagens_lidas: ["m1"],
    });
  }

  it("a mesma mensagem em vigor: reconfere e envia, sem chamar o modelo", async () => {
    decidido();
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(banco.chamadasDe("ler_preparo_para_envio")).toEqual([
      { p_clinic_id: CLINICA, p_versao_id: VERSAO, p_simulador: false },
    ]);
    expect(enviarPreparo).toHaveBeenCalledTimes(1);
    expect(enviarPreparo.mock.calls[0]![1].preparo.mensagem).toBe(MENSAGEM);
    expect(turnoGravado()).toMatchObject({ estado: "enviado" });
    expect(decisoes()[0]).toMatchObject({ message_id: "msg-preparo" });
  });

  it.each([
    ["fora de vigor (suspensa, RT trocado)", () => (lido = null)],
    [
      "a mensagem remontada mudou (o hash nao e o da decisao)",
      () => (lido = lidoDoBanco(`${MENSAGEM} `)),
    ],
    [
      "sem a decisao do preparo",
      () => banco.tabelas.set("ai_decision_log", []),
    ],
    [
      "a decisao sem a versao",
      () => {
        const d = banco.linhas("ai_decision_log")[0]!;
        d.preparo_versao_id = null;
      },
    ],
  ])("%s: passa sem frase, nada sai", async (_n, mudar) => {
    decidido();
    mudar();
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarPreparo).not.toHaveBeenCalled();
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(passagens).toEqual(["falha_tecnica"]);
    expect(turnoGravado()).toMatchObject({ estado: "passou_para_equipe" });
  });

  it("revisao da AG7 (CFM-2): a mesma mensagem da decisao (o mesmo hash), mas o texto tem recusa: passa sem frase, nada sai", async () => {
    const comRecusa = mensagemDoPreparo({
      procedimento: "Colonoscopia",
      rt: RT_DE_TESTE,
      texto: "Venha sem maquiagem. Resultado garantido!",
    });
    decidido({ texto_sha256: sha256DoTexto(comRecusa) });
    turnoGravado()!.texto_sha256 = sha256DoTexto(comRecusa);
    lido = lidoDoBanco(comRecusa);
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarPreparo).not.toHaveBeenCalled();
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(passagens).toEqual(["falha_tecnica"]);
    expect(turnoGravado()).toMatchObject({ estado: "passou_para_equipe" });
  });

  it("a linha do job reaproveitavel (falhou com codigo de retry) so sai depois da reconferencia", async () => {
    decidido();
    banco.linhas("message").push({
      id: "msg-preparo",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      author: "sistema",
      body: MENSAGEM,
      delivery_status: "falhou",
      error_code: "provider_indisponivel",
    });
    // Fora de vigor agora: o reenvio (um UPDATE que nao passa pelo gatilho)
    // nao acontece.
    lido = null;
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarPreparo).not.toHaveBeenCalled();
    expect(passagens).toEqual(["falha_tecnica"]);

    // Em vigor: reconferido, o envio reaproveita a linha.
    montar();
    decidido();
    banco.linhas("message").push({
      id: "msg-preparo",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      author: "sistema",
      body: MENSAGEM,
      delivery_status: "falhou",
      error_code: "provider_indisponivel",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(banco.chamadasDe("ler_preparo_para_envio")).toHaveLength(1);
    expect(enviarPreparo).toHaveBeenCalledTimes(1);
  });

  it("a linha do job que ja saiu: so fecha enviado, sem reler nem enviar", async () => {
    decidido();
    banco.linhas("message").push({
      id: "msg-preparo",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      author: "sistema",
      body: MENSAGEM,
      delivery_status: "entregue",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarPreparo).not.toHaveBeenCalled();
    expect(banco.chamadasDe("ler_preparo_para_envio")).toEqual([]);
    expect(turnoGravado()).toMatchObject({ estado: "enviado" });
  });
});

describe("o teto de respostas por hora conta o preparo", () => {
  it("uma resposta da IA e um envio do preparo na hora, com o teto 2: a terceira passa para a equipe sem modelo", async () => {
    banco.linhas("ia_liberacao")[0]!.teto_respostas_por_conversa_hora = 2;
    banco.linhas("message").push({
      id: "m0",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      author: "ia",
      direction: "saida",
      content_type: "texto",
      body: "Olá! Como posso ajudar?",
      created_at: "2026-10-13T14:30:00.000Z",
    });
    banco.linhas("ai_decision_log").push({
      id: "d-anterior",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: "10000000-0000-4000-8000-000000000009",
      desfecho: "enviou_preparo",
      preparo_versao_id: VERSAO,
      texto_sha256: SHA,
      created_at: "2026-10-13T14:40:00.000Z",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(passagens).toEqual(["teto_de_respostas"]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
  });

  it("o envio do preparo de outra conversa, ou de antes da hora, nao conta", async () => {
    banco.linhas("ia_liberacao")[0]!.teto_respostas_por_conversa_hora = 1;
    banco.linhas("ai_decision_log").push(
      {
        id: "d-outra",
        clinic_id: CLINICA,
        conversation_id: "c0000000-0000-4000-8000-000000000002",
        desfecho: "enviou_preparo",
        created_at: "2026-10-13T14:40:00.000Z",
      },
      {
        id: "d-antiga",
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        desfecho: "enviou_preparo",
        created_at: "2026-10-13T13:00:00.000Z",
      },
    );
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).toHaveBeenCalledTimes(1);
  });
});

describe("fraseJaSaiu confere o corpo da frase", () => {
  it("a linha 'sistema' do job com o corpo do preparo nao e a frase: fica o evento do aviso nao enviado", async () => {
    banco.linhas("ai_turno").push({
      job_id: JOB,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      estado: "passou_para_equipe",
      reserva_id: null,
      reservas_perdidas: [],
      saida: "frase",
      texto: null,
      texto_sha256: null,
      decision_id: null,
      mensagens_lidas: ["m1"],
    });
    banco.linhas("message").push({
      id: "msg-preparo",
      clinic_id: CLINICA,
      job_id: JOB,
      author: "sistema",
      body: MENSAGEM,
      delivery_status: "enviada",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(eventos).toEqual(["aviso_nao_enviado"]);
  });

  it("com o corpo da frase: so conclui", async () => {
    banco.linhas("ai_turno").push({
      job_id: JOB,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      estado: "passou_para_equipe",
      reserva_id: null,
      reservas_perdidas: [],
      saida: "frase",
      texto: null,
      texto_sha256: null,
      decision_id: null,
      mensagens_lidas: ["m1"],
    });
    banco.linhas("message").push({
      id: "msg-frase",
      clinic_id: CLINICA,
      job_id: JOB,
      author: "sistema",
      body: FRASE_DE_ESCALONAMENTO,
      delivery_status: "enviada",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(eventos).toEqual([]);
  });
});
