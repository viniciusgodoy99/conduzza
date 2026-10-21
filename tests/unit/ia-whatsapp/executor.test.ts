import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ClienteDoAgente, ResultadoDoTurno } from "@/lib/agente/laco";
import {
  configPadraoDoAgente,
  expedientePadrao,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import { versaoDoFiltroDoTurno } from "@/lib/agente/whatsapp";
import {
  sha256DoTexto,
  versaoDoPortao,
} from "@/lib/domain/conformidade/filtro";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { TextoAprovado } from "@/lib/domain/conformidade/texto-aprovado";
import { VERSAO_DA_POLITICA_DO_CLASSIFICADOR } from "@/lib/integrations/llm/classificador-de-entrada";
import { VERSAO_DA_POLITICA } from "@/lib/integrations/llm/verificador";
import type { SendTextResult } from "@/lib/integrations/whatsapp/send";
import type { Job } from "@/lib/jobs/worker";

import { BancoEmMemoria, type Linha } from "./banco-em-memoria";
import { aprovarParaTeste } from "./texto-aprovado-de-teste";

// O executor do job 'responder_com_ia' (E3), linha a linha da tabela de
// desfechos (plano 5.3, contrato 3.6), com banco em memoria, turno falso
// de roteiro e envio falso. Prova tambem: ai_decision_log antes de qualquer
// envio e nunca com blocked_draft; o rascunho bloqueado no lugar restrito;
// liberacao_suspensa nao envia nada; a retomada nao chama o modelo; reserva
// nova na retomada de 'reservado'; incluirClinicasDeTeste lanca em producao;
// nenhum texto vai para o log. Nenhum teste chama a OpenAI.

const estado = vi.hoisted(() => ({
  config: null as unknown,
}));

vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => estado.config,
  carregarCatalogoDoAgente: async () => ({
    procedimentos: [],
    vinculos: [],
    convenios: [],
    conveniosDoCadastro: [],
  }),
}));

const { executarRespostaComIa, RESERVA_DAS_GRAVACOES_MS, RESERVA_DO_ENVIO_MS } =
  await import("@/lib/jobs/responder-com-ia");
type Dependencias = Parameters<typeof executarRespostaComIa>[2];

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const CONTATO = "c1000000-0000-4000-8000-000000000001";
const OUTRO_CONTATO = "c1000000-0000-4000-8000-000000000002";
const NUMERO = "a0000000-0000-4000-8000-000000000001";
const JOB = "10000000-0000-4000-8000-000000000001";
const EXECUTOR = "motor-ia:20000000-0000-4000-8000-000000000001";
const RESERVA = "30000000-0000-4000-8000-000000000001";
const RESERVA_ANTIGA = "30000000-0000-4000-8000-000000000009";
const TELEFONE = "+5584999990001";
const PERGUNTA_DO_PACIENTE = "Quanto custa a consulta, doutora?";
const RESPOSTA = "A consulta custa R$ 150,00.";
const RASCUNHO_BARRADO = "Pode tomar um analgésico que passa.";
// Terca, 13/10/2026, 12:00 em Fortaleza (15:00 UTC).
const AGORA = Date.UTC(2026, 9, 13, 15, 0);
const DESDE = "2026-10-13T14:58:00.000Z";
const CRIADO = "2026-10-13T14:59:00.000Z";

// TextoAprovado pelo proprio filtro de saida, com o preco que a busca teria
// devolvido (nunca pela retomada: so o executor a chama).
const RESPOSTA_APROVADA: TextoAprovado = await aprovarParaTeste(
  RESPOSTA,
  [15_000],
);

const USO = {
  tokensEntrada: 1000,
  tokensSaida: 50,
  tokensCacheLidos: 200,
  tokensCacheGravados: 0,
};

const COMUM = {
  trilha: [{ tipo: "preco" as const, texto: "Consultou o preço de Consulta." }],
  uso: [
    { papel: "classificador" as const, modelo: "gpt-6-luna", uso: USO },
    { papel: "agente" as const, modelo: "gpt-6-luna-2026", uso: USO },
  ],
  versaoDoPrompt: "agente-teste",
  descartados: { instrucoes: false, itensDaBase: 0 },
};

function respondeu(): ResultadoDoTurno {
  const t = RESPOSTA_APROVADA;
  return {
    ...COMUM,
    tipo: "resposta",
    resposta: t,
    desfecho: { tipo: "respondeu" },
    filtro: {
      aprovado: true,
      texto: t,
      sha256: sha256DoTexto(RESPOSTA),
      versaoDasRegras: "regras-teste",
      verificador: { modelo: "gpt-6-luna", uso: USO },
    },
    rascunhoBloqueado: null,
  };
}

function frase(
  desfecho: ResultadoDoTurno["desfecho"],
  rascunhoBloqueado: string | null = null,
): ResultadoDoTurno {
  return {
    ...COMUM,
    tipo: "frase_fixa",
    resposta: FRASE_DE_ESCALONAMENTO,
    desfecho,
    filtro: null,
    rascunhoBloqueado,
  };
}

function configPublicada(extra: Partial<ConfigDoAgente> = {}): ConfigDoAgente {
  return {
    ...configPadraoDoAgente(),
    status: "publicada",
    versao: 3,
    ...extra,
  };
}

let banco: BancoEmMemoria;
let tempo: number;
let podeFalar: boolean[];
let consentimento: boolean | "erro";
let reservas: (string | null | "erro")[];
let passagens: string[];
let eventos: string[];
let logs: string[];
let turno: ReturnType<typeof vi.fn<Dependencias["executarTurno"]>>;
let enviarResposta: ReturnType<typeof vi.fn<Dependencias["enviarResposta"]>>;
let enviarFrase: ReturnType<typeof vi.fn<Dependencias["enviarFrase"]>>;
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
  podeFalar = [];
  consentimento = true;
  reservas = [];
  passagens = [];
  eventos = [];
  decisoesNoEnvio = [];
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
    body: PERGUNTA_DO_PACIENTE,
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

  banco.rpc("ia_pode_falar_com", () => ({
    data: podeFalar.length > 0 ? podeFalar.shift() : true,
    error: null,
  }));
  banco.rpc("confirmar_posse_job", () => ({ data: true, error: null }));
  banco.rpc("consentimento_vigente", () =>
    consentimento === "erro"
      ? { data: null, error: { code: "57014" } }
      : { data: consentimento, error: null },
  );
  banco.rpc("reservar_gasto_da_ia", () => {
    const proxima = reservas.length > 0 ? reservas.shift() : RESERVA;
    return proxima === "erro"
      ? { data: null, error: { code: "57014" } }
      : { data: proxima ?? null, error: null };
  });
  banco.rpc("acertar_gasto_da_ia", () => ({ data: null, error: null }));
  banco.rpc("passar_conversa_da_ia_para_equipe", (args) => {
    passagens.push(String(args.p_motivo));
    const c = conversa();
    if (c.status === "ia_atendendo") {
      c.status = "aguardando_humano";
      c.awaiting_reply = true;
      return { data: { passou: true, codigo: "passou" }, error: null };
    }
    return { data: { passou: false, codigo: "ja_fora_da_ia" }, error: null };
  });
  banco.rpc("gravar_evento_da_ia", (args) => {
    eventos.push(String(args.p_motivo));
    return { data: true, error: null };
  });

  turno = vi.fn<Dependencias["executarTurno"]>(async () => respondeu());
  enviarResposta = vi.fn<Dependencias["enviarResposta"]>(async () => {
    decisoesNoEnvio.push(banco.linhas("ai_decision_log").length);
    return { ok: true, messageId: "msg-1" };
  });
  enviarFrase = vi.fn<Dependencias["enviarFrase"]>(async () => {
    decisoesNoEnvio.push(banco.linhas("ai_decision_log").length);
    return { ok: true, messageId: "msg-frase" };
  });
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
  vi.unstubAllEnvs();
  // Nenhum texto do paciente, da resposta ou do rascunho no log.
  const tudo = logs.join("");
  expect(tudo).not.toContain(PERGUNTA_DO_PACIENTE);
  expect(tudo).not.toContain(RESPOSTA);
  expect(tudo).not.toContain(RASCUNHO_BARRADO);
  expect(tudo).not.toContain(TELEFONE);
  expect(tudo).not.toContain("Maria");
});

describe("fora do ambiente ou da lista", () => {
  it("sem T1: falha definitiva, nada é lido nem tocado", async () => {
    expect(await rodar({ config: { ligado: false, clinicas: [] } })).toEqual({
      ok: false,
      erro: "ia_fora_do_ambiente",
      definitivo: true,
    });
    expect(banco.operacoes).toEqual([]);
    expect(banco.chamadas).toEqual([]);
  });

  it("clínica fora da lista (T2): o mesmo", async () => {
    const outra = "682edca6-cc7d-4bb7-8db6-4c68e2510549";
    expect(await rodar({}, job({ clinic_id: outra }))).toMatchObject({
      ok: false,
      erro: "ia_fora_do_ambiente",
      definitivo: true,
    });
    expect(banco.chamadas).toEqual([]);
  });

  it("clínica de teste sem a flag: fora; com a flag fora da produção: roda", async () => {
    banco.linhas("clinic")[0]!.e_de_teste = true;
    expect(await rodar()).toMatchObject({ erro: "ia_fora_do_ambiente" });
    expect(turno).not.toHaveBeenCalled();
    expect(await rodar({ incluirClinicasDeTeste: true })).toEqual({ ok: true });
    expect(turno).toHaveBeenCalledTimes(1);
  });

  it("incluirClinicasDeTeste lança com VERCEL_ENV=production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(rodar({ incluirClinicasDeTeste: true })).rejects.toThrow();
    expect(banco.chamadas).toEqual([]);
  });
});

describe("antes do modelo", () => {
  it("conversa fora de ia_atendendo ou com responsável: conclui, intocada", async () => {
    conversa().status = "em_atendimento";
    expect(await rodar()).toEqual({ ok: true });
    conversa().status = "ia_atendendo";
    conversa().assignee_user_id = "u1";
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual([]);
    expect(turno).not.toHaveBeenCalled();
    expect(turnoGravado()).toBeUndefined();
  });

  it.each([
    ["contato trocado", () => (conversa().contact_id = OUTRO_CONTATO)],
    [
      "telefone do contato trocado",
      () => (banco.linhas("contact")[0]!.phone_key = "+5584999990002"),
    ],
    ["sem janela", () => banco.tabelas.set("ia_janela_da_conversa", [])],
  ])(
    "janela não confere (%s): passa para a equipe, sem frase",
    async (_n, mudar) => {
      if (_n === "contato trocado") {
        banco.linhas("contact").push({
          id: OUTRO_CONTATO,
          clinic_id: CLINICA,
          phone_key: TELEFONE,
          name: null,
          birth_date: null,
        });
      }
      mudar();
      expect(await rodar()).toEqual({ ok: true });
      expect(passagens).toEqual(["liberacao_perdida"]);
      expect(turno).not.toHaveBeenCalled();
      expect(enviarFrase).not.toHaveBeenCalled();
      expect(decisoes()).toEqual([]);
    },
  );

  it("job criado antes de a janela abrir (Assumir e Devolver): está morto, só conclui (D-A)", async () => {
    // Revisao do E3, D-A: nada de passagem (a sessao nova continua na IA),
    // evento, frase ou modelo.
    expect(
      await rodar({}, job({ created_at: "2026-10-13T14:57:00.000Z" })),
    ).toEqual({
      ok: true,
    });
    expect(passagens).toEqual([]);
    expect(eventos).toEqual([]);
    expect(turno).not.toHaveBeenCalled();
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(conversa().status).toBe("ia_atendendo");
    expect(banco.chamadasDe("passar_conversa_da_ia_para_equipe")).toEqual([]);
  });

  it("ia_pode_falar_com falso: passa para a equipe, sem frase", async () => {
    podeFalar = [false];
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["liberacao_perdida"]);
    expect(turno).not.toHaveBeenCalled();
    expect(enviarFrase).not.toHaveBeenCalled();
  });

  it("sem versão publicada: passa com o evento próprio", async () => {
    estado.config = null;
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["sem_versao_publicada"]);
    expect(turno).not.toHaveBeenCalled();
  });

  it("modo de horário 'fallback': horario_nao_suportado", async () => {
    estado.config = configPublicada({
      horario: {
        modo: "fallback",
        minutosSemResposta: 5,
        expediente: expedientePadrao(),
      },
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["horario_nao_suportado"]);
  });

  it("fora do horário escolhido: fora_do_horario", async () => {
    estado.config = configPublicada({
      horario: {
        modo: "fora_expediente",
        minutosSemResposta: 5,
        expediente: expedientePadrao(),
      },
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["fora_do_horario"]);
    expect(turno).not.toHaveBeenCalled();
  });

  it("sem pendente (por id): conclui sem modelo e sem tocar a conversa", async () => {
    banco.linhas("ai_turno").push({
      job_id: "outro-job",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      estado: "enviado",
      mensagens_lidas: ["m1"],
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(passagens).toEqual([]);
    expect(banco.chamadasDe("reservar_gasto_da_ia")).toEqual([]);
  });

  it("erro de leitura antes do modelo: falha com retry, nada tocado", async () => {
    banco.erros.set("conversation:select", { code: "08006" });
    expect(await rodar()).toEqual({ ok: false, erro: "leitura_falhou" });
    expect(passagens).toEqual([]);
    expect(turno).not.toHaveBeenCalled();
  });

  it("teto de respostas da conversa na hora: decisão, passagem e frase, sem modelo", async () => {
    banco.linhas("ia_liberacao")[0]!.teto_respostas_por_conversa_hora = 2;
    for (const id of ["r1", "r2"]) {
      banco.linhas("message").push({
        id,
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        author: "ia",
        created_at: "2026-10-13T14:30:00.000Z",
      });
    }
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(banco.chamadasDe("reservar_gasto_da_ia")).toEqual([]);
    expect(decisoes()).toHaveLength(1);
    expect(decisoes()[0]).toMatchObject({
      desfecho: "escalou",
      escalation_reason: "teto_de_respostas",
      aprovado: false,
      // Sem filtro no turno, a versao das regras e a do codigo de agora,
      // com o portao, o classificador e o verificador (Q12).
      versao_filtro: versaoDoFiltroDoTurno(),
    });
    expect(String(decisoes()[0]?.versao_filtro)).toMatch(
      /^regras-[0-9a-f]{12} portao-[0-9a-f]{12} classificador-[0-9a-f]{12} verificador-[0-9a-f]{12}$/,
    );
    expect(passagens).toEqual(["teto_de_respostas"]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    expect(decisoesNoEnvio).toEqual([1]);
    expect(turnoGravado()).toMatchObject({ estado: "passou_para_equipe" });
  });

  it("reserva nula com a liberação de pé: teto_atingido com a frase", async () => {
    reservas = [null];
    podeFalar = [true, true];
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(decisoes()[0]).toMatchObject({
      desfecho: "escalou",
      escalation_reason: "teto_atingido",
    });
    expect(passagens).toEqual(["teto_atingido"]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
  });

  it("reserva nula com a liberação caída: passa sem frase e sem decisão", async () => {
    reservas = [null];
    podeFalar = [true, false];
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["liberacao_perdida"]);
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(decisoes()).toEqual([]);
  });

  it("reserva que não dá para conferir: retry, sem modelo", async () => {
    reservas = ["erro"];
    expect(await rodar()).toEqual({ ok: false, erro: "reserva_falhou" });
    expect(turno).not.toHaveBeenCalled();
  });
});

describe("o turno e a saída", () => {
  it("respondeu: decisão antes do envio, aprovada com o hash, sem blocked_draft; turno enviado sem texto", async () => {
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).toHaveBeenCalledTimes(1);
    const entrada = turno.mock.calls[0]![0];
    expect(entrada.mensagens.map((m) => m.texto)).toEqual([
      PERGUNTA_DO_PACIENTE,
    ]);
    expect(entrada.config.versao).toBe(3);
    expect(entrada.identificadorDeSeguranca).toMatch(/^[0-9a-f]{64}$/);
    expect(entrada.prazoMs).toBeLessThanOrEqual(55_000 - RESERVA_DO_ENVIO_MS);
    expect(decisoesNoEnvio).toEqual([1]);
    const [decisao] = decisoes();
    expect(decisao).toMatchObject({
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      desfecho: "respondeu",
      aprovado: true,
      compliance_blocked: false,
      texto_sha256: sha256DoTexto(RESPOSTA),
      escalation_reason: null,
      config_version: 3,
      versao_prompt: "agente-teste",
      // Q12 (revisao de producao de 19/10/2026): as regras de saida do
      // filtro do turno, o portao, o classificador e o verificador.
      versao_filtro: versaoDoFiltroDoTurno("regras-teste"),
      agente_modelo: "gpt-6-luna-2026",
      verificador_modelo: "gpt-6-luna",
      tokens_entrada: 2000,
      tokens_saida: 100,
      tokens_cache: 400,
      tool_used: "buscar_procedimento",
      message_id: "msg-1",
    });
    expect(decisao).not.toHaveProperty("blocked_draft");
    expect(String(decisao?.versao_filtro).split(" ")).toEqual([
      "regras-teste",
      versaoDoPortao(),
      VERSAO_DA_POLITICA_DO_CLASSIFICADOR,
      VERSAO_DA_POLITICA,
    ]);
    expect(enviarResposta.mock.calls[0]![1]).toEqual({
      clinicId: CLINICA,
      conversationId: CONVERSA,
      contactId: CONTATO,
      jobId: JOB,
      workerId: EXECUTOR,
      whatsappAccountId: NUMERO,
      texto: RESPOSTA,
    });
    expect(turnoGravado()).toMatchObject({
      estado: "enviado",
      texto: null,
      mensagens_lidas: ["m1"],
      reserva_id: RESERVA,
      texto_sha256: sha256DoTexto(RESPOSTA),
    });
    // O gasto acertado com a conversa e o job em cada linha.
    const [acerto] = banco.chamadasDe("acertar_gasto_da_ia");
    expect(acerto?.p_reserva).toBe(RESERVA);
    for (const linha of acerto?.p_linhas as Linha[]) {
      expect(linha).toMatchObject({
        conversation_id: CONVERSA,
        job_id: JOB,
        origem: "whatsapp",
      });
    }
    expect(banco.chamadasDe("reservar_gasto_da_ia")[0]).toMatchObject({
      p_clinic_id: CLINICA,
      p_origem: "whatsapp",
    });
    expect(passagens).toEqual([]);
  });

  it("a trava entre rodadas confere posse, conversa, janela e liberação", async () => {
    await rodar();
    const conferir = turno.mock.calls[0]![0].conferirTrava!;
    expect(await conferir()).toBe(true);
    conversa().status = "em_atendimento";
    expect(await conferir()).toBe(false);
    conversa().status = "ia_atendendo";
    banco.linhas("contact")[0]!.phone_key = "+5584999990002";
    expect(await conferir()).toBe(false);
    banco.linhas("contact")[0]!.phone_key = TELEFONE;
    podeFalar = [false];
    expect(await conferir()).toBe(false);
    banco.rpc("confirmar_posse_job", () => ({ data: false, error: null }));
    expect(await conferir()).toBe(false);
  });

  it("escalou: decisão com o motivo, passagem com o mesmo motivo e a frase", async () => {
    turno.mockResolvedValue(
      frase({
        tipo: "escalou",
        motivo: "pedido_de_agenda",
        gatilho: null,
        origem: "agente",
      }),
    );
    expect(await rodar()).toEqual({ ok: true });
    expect(decisoes()[0]).toMatchObject({
      desfecho: "escalou",
      escalation_reason: "pedido_de_agenda",
      tool_used: "escalar_humano",
      aprovado: false,
    });
    expect(passagens).toEqual(["pedido_de_agenda"]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(decisoesNoEnvio).toEqual([1]);
    expect(turnoGravado()).toMatchObject({
      estado: "passou_para_equipe",
      saida: "frase",
    });
  });

  // Q5 (revisao de producao de 19/10/2026): a resposta que prometia passar
  // para a equipe vira passagem de verdade, com a frase fixa. tool_used nao
  // diz escalar_humano (o modelo nao chamou a ferramenta).
  it("escalou pela resposta que prometia passar: passagem, frase e tool_used da busca", async () => {
    turno.mockResolvedValue(
      frase({
        tipo: "escalou",
        motivo: "agente_pediu",
        gatilho: null,
        origem: "texto_do_agente",
      }),
    );
    expect(await rodar()).toEqual({ ok: true });
    expect(decisoes()[0]).toMatchObject({
      desfecho: "escalou",
      escalation_reason: "agente_pediu",
      tool_used: "buscar_procedimento",
      aprovado: false,
    });
    expect(passagens).toEqual(["agente_pediu"]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    expect(enviarResposta).not.toHaveBeenCalled();
  });

  it("bloqueou: rascunho só em ai_rascunho_bloqueado, nunca na decisão", async () => {
    turno.mockResolvedValue(
      frase(
        {
          tipo: "bloqueou",
          categoria: "medicamento",
          camada: "regra",
          motivoDaFalha: null,
        },
        RASCUNHO_BARRADO,
      ),
    );
    expect(await rodar()).toEqual({ ok: true });
    const [decisao] = decisoes();
    expect(decisao).toMatchObject({
      desfecho: "bloqueou",
      compliance_blocked: true,
      compliance_rule: "medicamento",
      camada: "regra",
      escalation_reason: "conformidade",
    });
    expect(decisao).not.toHaveProperty("blocked_draft");
    expect(JSON.stringify(decisao)).not.toContain(RASCUNHO_BARRADO);
    expect(banco.linhas("ai_rascunho_bloqueado")).toEqual([
      expect.objectContaining({
        clinic_id: CLINICA,
        decision_id: decisao!.id,
        conversation_id: CONVERSA,
        job_id: JOB,
        texto: RASCUNHO_BARRADO,
      }),
    ]);
    expect(passagens).toEqual(["conformidade"]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
  });

  it("falhou por técnica: falha_tecnica com o motivo da falha, e a frase", async () => {
    turno.mockResolvedValue(frase({ tipo: "falhou", motivo: "timeout" }));
    expect(await rodar()).toEqual({ ok: true });
    expect(decisoes()[0]).toMatchObject({
      desfecho: "falhou",
      escalation_reason: "falha_tecnica",
      motivo_da_falha: "timeout",
    });
    expect(passagens).toEqual(["falha_tecnica"]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
  });

  it("liberacao_suspensa: nada é enviado; passa se ainda estiver na IA", async () => {
    turno.mockResolvedValue(
      frase({ tipo: "falhou", motivo: "liberacao_suspensa" }),
    );
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(decisoes()[0]).toMatchObject({
      desfecho: "falhou",
      escalation_reason: null,
      motivo_da_falha: "liberacao_suspensa",
    });
    expect(passagens).toEqual(["liberacao_perdida"]);
    expect(turnoGravado()).toMatchObject({
      estado: "sem_envio",
      saida: "nenhuma",
    });
  });

  it("sem_mensagem: nada é enviado e a conversa fica intocada", async () => {
    turno.mockResolvedValue(frase({ tipo: "falhou", motivo: "sem_mensagem" }));
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(passagens).toEqual([]);
    expect(conversa().status).toBe("ia_atendendo");
  });

  it.each([
    [
      {
        ok: false,
        reason: "slot_adiado",
        code: "canal_ocupado",
        livreEm: "x",
        message: "m",
      },
    ],
    [
      {
        ok: false,
        reason: "falha_envio",
        code: "provider_indisponivel",
        message: "m",
      },
    ],
  ] as [SendTextResult][])(
    "a frase não sai (%#): evento do aviso, conclui e nunca reagenda",
    async (falha) => {
      turno.mockResolvedValue(frase({ tipo: "falhou", motivo: "timeout" }));
      enviarFrase.mockResolvedValue(falha);
      expect(await rodar()).toEqual({ ok: true });
      expect(enviarFrase).toHaveBeenCalledTimes(1);
      expect(eventos).toEqual(["aviso_nao_enviado"]);
    },
  );

  it("alguém assumiu antes da passagem: nenhuma frase", async () => {
    turno.mockImplementation(async () => {
      conversa().status = "em_atendimento";
      return frase({
        tipo: "escalou",
        motivo: "sintoma",
        gatilho: "sintoma",
        origem: "portao",
      });
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarFrase).not.toHaveBeenCalled();
  });

  it("sem tempo para enviar (menos de 14 s): reagenda retomar_envio com o texto no turno", async () => {
    turno.mockImplementation(async () => {
      tempo += 45_000;
      return respondeu();
    });
    expect(await rodar()).toEqual({
      reagendar: new Date(AGORA + 45_000).toISOString(),
      motivo: "retomar_envio",
    });
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(turnoGravado()).toMatchObject({
      estado: "decidido",
      saida: "resposta",
      texto: RESPOSTA,
    });
  });

  it("prazo da invocação curto demais para o turno: volta para a fila sem tocar em nada", async () => {
    expect(await rodar({ prazoFinalMs: AGORA + 30_000 })).toEqual({
      reagendar: new Date(AGORA).toISOString(),
      motivo: "orcamento_da_passagem",
    });
    expect(turno).not.toHaveBeenCalled();
    expect(banco.chamadasDe("reservar_gasto_da_ia")).toEqual([]);
  });
});

describe("resultado do envio da resposta", () => {
  it("slot adiado: reagenda para quando o canal abre", async () => {
    enviarResposta.mockResolvedValue({
      ok: false,
      reason: "slot_adiado",
      code: "canal_ocupado",
      livreEm: "2026-10-13T15:00:20.000Z",
      message: "m",
    });
    expect(await rodar()).toEqual({
      reagendar: "2026-10-13T15:00:20.000Z",
      motivo: "canal_ocupado",
    });
    expect(turnoGravado()).toMatchObject({ estado: "decidido" });
  });

  it.each([
    [
      { ok: false, reason: "desconectado", code: "desconectado", message: "m" },
      "desconectado",
    ],
    [
      {
        ok: false,
        reason: "desconectado",
        code: "numero_removido",
        message: "m",
      },
      "numero_removido",
    ],
  ] as [SendTextResult, string][])(
    "número fora (%#): sem_envio, passa e falha definitivo",
    async (falha, codigo) => {
      enviarResposta.mockResolvedValue(falha);
      expect(await rodar()).toEqual({
        ok: false,
        erro: codigo,
        definitivo: true,
      });
      expect(passagens).toEqual(["numero_desconectado"]);
      expect(turnoGravado()).toMatchObject({
        estado: "sem_envio",
        texto: null,
      });
    },
  );

  it("envio incerto: sem_envio, evento próprio e nunca repete", async () => {
    enviarResposta.mockResolvedValue({
      ok: false,
      reason: "falha_envio",
      code: "envio_incerto",
      message: "m",
    });
    expect(await rodar()).toEqual({
      ok: false,
      erro: "envio_incerto",
      definitivo: true,
    });
    expect(passagens).toEqual(["envio_incerto"]);
    expect(turnoGravado()).toMatchObject({ estado: "sem_envio", texto: null });
  });

  it("falha que com certeza não saiu e pode repetir: retry", async () => {
    enviarResposta.mockResolvedValue({
      ok: false,
      reason: "falha_envio",
      code: "provider_indisponivel",
      message: "m",
    });
    expect(await rodar()).toEqual({ ok: false, erro: "provider_indisponivel" });
    expect(passagens).toEqual([]);
  });

  it("guarda recusou por fora_da_ia: conclui sem passar de novo", async () => {
    enviarResposta.mockResolvedValue({
      ok: false,
      reason: "falha_envio",
      code: "fora_da_ia",
      message: "m",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual([]);
    expect(turnoGravado()).toMatchObject({ estado: "sem_envio", texto: null });
  });

  it("guarda recusou por janela ou liberação: passa sem frase", async () => {
    enviarResposta.mockResolvedValue({
      ok: false,
      reason: "falha_envio",
      code: "ia_nao_liberada",
      message: "m",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["liberacao_perdida"]);
    expect(enviarFrase).not.toHaveBeenCalled();
  });

  it("ja_enviado com a linha do job enviada: turno enviado e conclui", async () => {
    banco.linhas("message").push({
      id: "msg-ja",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      author: "ia",
      delivery_status: "entregue",
    });
    enviarResposta.mockResolvedValue({
      ok: false,
      reason: "ja_enviado",
      code: "ja_enviado",
      message: "m",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(turnoGravado()).toMatchObject({ estado: "enviado", texto: null });
  });
});

/** A decisao APROVADA do job, como o executor grava (o hash da resposta). */
function decisaoAprovadaDoJob(id: string, texto = RESPOSTA, extra: Linha = {}) {
  banco.linhas("ai_decision_log").push({
    id,
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    job_id: JOB,
    desfecho: "respondeu",
    aprovado: true,
    compliance_blocked: false,
    texto_sha256: sha256DoTexto(texto),
    escalation_reason: null,
    ...extra,
  });
}

describe("retomadas", () => {
  function turnoExistente(campos: Linha) {
    banco.linhas("ai_turno").push({
      job_id: JOB,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      reserva_id: null,
      reservas_perdidas: [],
      saida: null,
      texto: null,
      texto_sha256: null,
      decision_id: null,
      mensagens_lidas: ["m1"],
      ...campos,
    });
  }

  it("decidido com resposta: envia o texto aprovado sem chamar o modelo", async () => {
    decisaoAprovadaDoJob("d-1");
    turnoExistente({
      estado: "decidido",
      saida: "resposta",
      texto: RESPOSTA,
      texto_sha256: sha256DoTexto(RESPOSTA),
      decision_id: "d-1",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(banco.chamadasDe("reservar_gasto_da_ia")).toEqual([]);
    expect(enviarResposta.mock.calls[0]![1].texto).toBe(RESPOSTA);
    expect(turnoGravado()).toMatchObject({ estado: "enviado", texto: null });
  });

  it("decidido com a resposta já enviada por uma tentativa cortada: fecha como enviado, sem reenviar", async () => {
    turnoExistente({
      estado: "decidido",
      saida: "resposta",
      texto: RESPOSTA,
      texto_sha256: sha256DoTexto(RESPOSTA),
    });
    banco.linhas("message").push({
      id: "msg-ja",
      clinic_id: CLINICA,
      job_id: JOB,
      author: "ia",
      delivery_status: "enviada",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(turnoGravado()).toMatchObject({ estado: "enviado", texto: null });
  });

  it("decidido com a linha do job 'enviando' (pode ter saído): envio incerto, nunca repete", async () => {
    turnoExistente({
      estado: "decidido",
      saida: "resposta",
      texto: RESPOSTA,
      texto_sha256: sha256DoTexto(RESPOSTA),
    });
    banco.linhas("message").push({
      id: "msg-talvez",
      clinic_id: CLINICA,
      job_id: JOB,
      author: "ia",
      delivery_status: "enviando",
    });
    expect(await rodar()).toEqual({
      ok: false,
      erro: "envio_incerto",
      definitivo: true,
    });
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(passagens).toEqual(["envio_incerto"]);
  });

  it("decidido com a linha 'falhou' por código de retry: reenvia o texto aprovado (o envio reaproveita a linha)", async () => {
    decisaoAprovadaDoJob("d-1");
    turnoExistente({
      estado: "decidido",
      saida: "resposta",
      texto: RESPOSTA,
      texto_sha256: sha256DoTexto(RESPOSTA),
      decision_id: "d-1",
    });
    banco.linhas("message").push({
      id: "msg-falhou",
      clinic_id: CLINICA,
      job_id: JOB,
      author: "ia",
      delivery_status: "falhou",
      error_code: "provider_indisponivel",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(enviarResposta.mock.calls[0]![1].texto).toBe(RESPOSTA);
    expect(passagens).toEqual([]);
    expect(turnoGravado()).toMatchObject({ estado: "enviado", texto: null });
  });

  it("decidido com a linha 'falhou' por recusa definitiva: não reenvia e passa (falha técnica)", async () => {
    turnoExistente({
      estado: "decidido",
      saida: "resposta",
      texto: RESPOSTA,
      texto_sha256: sha256DoTexto(RESPOSTA),
    });
    banco.linhas("message").push({
      id: "msg-recusada",
      clinic_id: CLINICA,
      job_id: JOB,
      author: "ia",
      delivery_status: "falhou",
      error_code: "conta_divergente",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(passagens).toEqual(["falha_tecnica"]);
  });

  it("decidido com hash que não bate: passa (falha técnica), sem frase e sem envio", async () => {
    turnoExistente({
      estado: "decidido",
      saida: "resposta",
      texto: RESPOSTA,
      texto_sha256: sha256DoTexto("outro texto"),
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(passagens).toEqual(["falha_tecnica"]);
    expect(turnoGravado()).toMatchObject({
      estado: "passou_para_equipe",
      texto: null,
    });
  });

  it("decidido com frase: passa com o motivo da decisão e manda a frase, sem modelo", async () => {
    banco.linhas("ai_decision_log").push({
      id: "d-2",
      clinic_id: CLINICA,
      escalation_reason: "sintoma",
    });
    turnoExistente({ estado: "decidido", saida: "frase", decision_id: "d-2" });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(passagens).toEqual(["sintoma"]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
  });

  it("passou_para_equipe: não passa de novo; sem a frase enviada, grava o evento", async () => {
    turnoExistente({ estado: "passou_para_equipe", saida: "frase" });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual([]);
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(eventos).toEqual(["aviso_nao_enviado"]);
  });

  it("passou_para_equipe com a frase já enviada: só conclui", async () => {
    turnoExistente({ estado: "passou_para_equipe", saida: "frase" });
    banco.linhas("message").push({
      id: "msg-frase",
      clinic_id: CLINICA,
      job_id: JOB,
      author: "sistema",
      delivery_status: "enviada",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(eventos).toEqual([]);
  });

  it("reservado: reserva NOVA, a antiga vai para reservas_perdidas e nunca é acertada", async () => {
    turnoExistente({ estado: "reservado", reserva_id: RESERVA_ANTIGA });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).toHaveBeenCalledTimes(1);
    expect(banco.chamadasDe("reservar_gasto_da_ia")).toHaveLength(1);
    expect(
      banco.chamadasDe("acertar_gasto_da_ia").map((a) => a.p_reserva),
    ).toEqual([RESERVA]);
    expect(turnoGravado()).toMatchObject({
      reserva_id: RESERVA,
      reservas_perdidas: [RESERVA_ANTIGA],
    });
  });

  it.each(["enviado", "sem_envio"])(
    "%s: conclui sem nada",
    async (estadoDoTurno) => {
      turnoExistente({ estado: estadoDoTurno });
      expect(await rodar()).toEqual({ ok: true });
      expect(turno).not.toHaveBeenCalled();
      expect(enviarResposta).not.toHaveBeenCalled();
      expect(passagens).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// Revisao adversarial do E3 (13/10/2026): cada achado do executor com o
// teste que falhava antes da correcao.
// ---------------------------------------------------------------------------

function turnoDoJob(campos: Linha) {
  banco.linhas("ai_turno").push({
    job_id: JOB,
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    reserva_id: null,
    reservas_perdidas: [],
    saida: null,
    texto: null,
    texto_sha256: null,
    decision_id: null,
    mensagens_lidas: ["m1"],
    ...campos,
  });
}

/** O Devolver abriu uma janela nova DEPOIS do job (Assumir e Devolver). */
function devolverDepoisDoJob() {
  const janela = banco.linhas("ia_janela_da_conversa")[0]!;
  janela.desde = "2026-10-13T15:00:10.000Z";
  janela.aberta_por = "devolver";
  conversa().status = "ia_atendendo";
  conversa().assignee_user_id = null;
}

/** passar_conversa_da_ia_para_equipe que falha na 1a chamada e depois passa. */
function passagemQueFalhaUmaVez() {
  let primeira = true;
  banco.rpc("passar_conversa_da_ia_para_equipe", (args) => {
    passagens.push(String(args.p_motivo));
    if (primeira) {
      primeira = false;
      return { data: null, error: { code: "57014" } };
    }
    const c = conversa();
    if (c.status === "ia_atendendo") {
      c.status = "aguardando_humano";
      c.awaiting_reply = true;
      return { data: { passou: true, codigo: "passou" }, error: null };
    }
    return { data: { passou: false, codigo: "ja_fora_da_ia" }, error: null };
  });
}

describe("revisão: retomada só com a decisão aprovada do job (achado 3)", () => {
  const FORJADO = "Esse tratamento resolve o seu problema em poucas sessões.";

  it("texto de ai_turno trocado com o hash recalculado na mesma linha: não envia, passa (falha técnica)", async () => {
    decisaoAprovadaDoJob("d-1");
    turnoDoJob({
      estado: "decidido",
      saida: "resposta",
      texto: FORJADO,
      texto_sha256: sha256DoTexto(FORJADO),
      decision_id: "d-1",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(passagens).toEqual(["falha_tecnica"]);
    expect(turnoGravado()).toMatchObject({
      estado: "passou_para_equipe",
      texto: null,
    });
  });

  it.each([
    ["de outro job", { job_id: "10000000-0000-4000-8000-000000000009" }],
    ["não aprovada", { aprovado: false, desfecho: "escalou" }],
    ["bloqueada", { compliance_blocked: true }],
  ])("decisão %s: não envia o texto do turno", async (_caso, extra) => {
    decisaoAprovadaDoJob("d-1", RESPOSTA, extra);
    turnoDoJob({
      estado: "decidido",
      saida: "resposta",
      texto: RESPOSTA,
      texto_sha256: sha256DoTexto(RESPOSTA),
      decision_id: "d-1",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(passagens).toEqual(["falha_tecnica"]);
  });

  it("sem decision_id no turno: não retoma", async () => {
    turnoDoJob({
      estado: "decidido",
      saida: "resposta",
      texto: RESPOSTA,
      texto_sha256: sha256DoTexto(RESPOSTA),
      decision_id: null,
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarResposta).not.toHaveBeenCalled();
  });

  it("a leitura da decisão que falha: retry, nada enviado nem passado", async () => {
    decisaoAprovadaDoJob("d-1");
    turnoDoJob({
      estado: "decidido",
      saida: "resposta",
      texto: RESPOSTA,
      texto_sha256: sha256DoTexto(RESPOSTA),
      decision_id: "d-1",
    });
    banco.erros.set("ai_decision_log:select", { code: "08006" });
    expect(await rodar()).toEqual({ ok: false, erro: "leitura_falhou" });
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(passagens).toEqual([]);
  });
});

describe("revisão: erro na passagem não é engolido (achado 4)", () => {
  it("ia_sem_aprovacao com a passagem falhando: retry; a retentativa passa e manda a frase", async () => {
    enviarResposta.mockResolvedValue({
      ok: false,
      reason: "falha_envio",
      code: "ia_sem_aprovacao",
      message: "m",
    });
    passagemQueFalhaUmaVez();
    expect(await rodar()).toEqual({ ok: false, erro: "passagem_falhou" });
    // O turno espera a frase (nunca a resposta de novo), sem o texto.
    expect(turnoGravado()).toMatchObject({
      estado: "decidido",
      saida: "frase",
      texto: null,
    });
    expect(conversa().status).toBe("ia_atendendo");

    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["falha_tecnica", "falha_tecnica"]);
    expect(conversa().status).toBe("aguardando_humano");
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    expect(enviarResposta).toHaveBeenCalledTimes(1);
    expect(turno).toHaveBeenCalledTimes(1);
    expect(turnoGravado()).toMatchObject({ estado: "passou_para_equipe" });
  });

  it("guarda recusou (janela_invalida) com a passagem falhando: retry; a retentativa passa sem frase", async () => {
    enviarResposta.mockResolvedValue({
      ok: false,
      reason: "falha_envio",
      code: "janela_invalida",
      message: "m",
    });
    passagemQueFalhaUmaVez();
    expect(await rodar()).toEqual({ ok: false, erro: "passagem_falhou" });
    expect(turnoGravado()).toMatchObject({ estado: "decidido" });
    expect(conversa().status).toBe("ia_atendendo");

    decisaoAprovadaDoJob(String(turnoGravado()!.decision_id));
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["liberacao_perdida", "liberacao_perdida"]);
    expect(conversa().status).toBe("aguardando_humano");
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(turnoGravado()).toMatchObject({ estado: "sem_envio", texto: null });
  });

  it("liberacao_suspensa com a passagem falhando: retry; a retentativa passa sem chamar o modelo", async () => {
    turno.mockResolvedValue(
      frase({ tipo: "falhou", motivo: "liberacao_suspensa" }),
    );
    passagemQueFalhaUmaVez();
    expect(await rodar()).toEqual({ ok: false, erro: "passagem_falhou" });
    expect(turnoGravado()).toMatchObject({
      estado: "decidido",
      saida: "nenhuma",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).toHaveBeenCalledTimes(1);
    expect(passagens).toEqual(["liberacao_perdida", "liberacao_perdida"]);
    expect(conversa().status).toBe("aguardando_humano");
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(turnoGravado()).toMatchObject({ estado: "sem_envio" });
  });

  it("retomada recusada com a passagem falhando: retry, o turno não vira passou_para_equipe", async () => {
    turnoDoJob({
      estado: "decidido",
      saida: "resposta",
      texto: RESPOSTA,
      texto_sha256: sha256DoTexto("outro texto"),
    });
    banco.rpc("passar_conversa_da_ia_para_equipe", (args) => {
      passagens.push(String(args.p_motivo));
      return { data: null, error: { code: "57014" } };
    });
    expect(await rodar()).toEqual({ ok: false, erro: "passagem_falhou" });
    expect(turnoGravado()).toMatchObject({ estado: "decidido" });
    expect(conversa().status).toBe("ia_atendendo");
  });

  it.each([
    [
      "desconectado",
      { ok: false, reason: "desconectado", code: "desconectado", message: "m" },
    ],
    [
      "envio incerto",
      { ok: false, reason: "falha_envio", code: "envio_incerto", message: "m" },
    ],
  ] as [string, SendTextResult][])(
    "%s com a passagem falhando: retry em vez de falha definitiva com a conversa na IA",
    async (_caso, falha) => {
      enviarResposta.mockResolvedValue(falha);
      banco.rpc("passar_conversa_da_ia_para_equipe", () => ({
        data: null,
        error: { code: "57014" },
      }));
      expect(await rodar()).toEqual({ ok: false, erro: "passagem_falhou" });
      expect(turnoGravado()).toMatchObject({ estado: "decidido" });
    },
  );
});

describe("revisão: o turno que chega ao prazo ainda manda a frase (achado 5)", () => {
  it("verificador lento até o fim do prazo e 100 ms por ida ao banco: passa e manda a frase", async () => {
    turno.mockImplementation(async (entrada) => {
      // O turno usa o prazo inteiro (bloqueio por timeout no fim).
      tempo += entrada.prazoMs ?? 0;
      return frase({
        tipo: "bloqueou",
        categoria: "falha_verificador",
        camada: "falha",
        motivoDaFalha: "timeout",
      });
    });
    const original = banco.cliente();
    let idas = 0;
    const lento = {
      from: (tabela: string) => {
        idas += 1;
        tempo += 100;
        return original.from(tabela);
      },
      rpc: (nome: string, args: Record<string, unknown>) => {
        idas += 1;
        tempo += 100;
        return original.rpc(nome, args);
      },
    } as unknown as typeof original;
    expect(await rodar({ admin: lento })).toEqual({ ok: true });
    expect(turno.mock.calls[0]![0].prazoMs).toBeLessThanOrEqual(
      55_000 - RESERVA_DO_ENVIO_MS - RESERVA_DAS_GRAVACOES_MS,
    );
    expect(passagens).toEqual(["conformidade"]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual([]);
    expect(idas).toBeGreaterThan(10);
  });
});

describe("revisão: autorização revogada antes do modelo (achado 6)", () => {
  it("telefone da equipe que revogou: nada vai ao modelo, passa sem frase e sem decisão", async () => {
    consentimento = false;
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(banco.chamadasDe("reservar_gasto_da_ia")).toEqual([]);
    expect(passagens).toEqual(["sem_autorizacao"]);
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(decisoes()).toEqual([]);
    expect(banco.chamadasDe("consentimento_vigente")).toEqual([
      { p_clinic_id: CLINICA, p_contact_id: CONTATO, p_channel: "whatsapp" },
    ]);
  });

  it("autorização que não dá para conferir: retry, nada tocado (sem resposta não é revogação)", async () => {
    consentimento = "erro";
    expect(await rodar()).toEqual({ ok: false, erro: "leitura_falhou" });
    expect(turno).not.toHaveBeenCalled();
    expect(passagens).toEqual([]);
  });

  it("revogou durante o turno (o envio recusa por autorização): passa sem frase, não como falha técnica", async () => {
    enviarResposta.mockResolvedValue({
      ok: false,
      reason: "sem_consentimento",
      code: "sem_consentimento_no_envio",
      message: "m",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual(["sem_autorizacao"]);
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(turnoGravado()).toMatchObject({ estado: "sem_envio", texto: null });
  });
});

describe("revisão: retomada da frase com a passagem já gravada (achado 7)", () => {
  beforeEach(() => {
    banco.linhas("ai_decision_log").push({
      id: "d-2",
      clinic_id: CLINICA,
      job_id: JOB,
      escalation_reason: "sintoma",
    });
    turnoDoJob({ estado: "decidido", saida: "frase", decision_id: "d-2" });
    // A tentativa anterior gravou a passagem e caiu antes de fechar o turno.
    conversa().status = "aguardando_humano";
  });

  it("a frase não saiu: grava o evento do aviso, sem mandar a frase", async () => {
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(eventos).toEqual(["aviso_nao_enviado"]);
    expect(turnoGravado()).toMatchObject({ estado: "passou_para_equipe" });
  });

  it("a frase já tinha saído: só conclui", async () => {
    banco.linhas("message").push({
      id: "msg-frase",
      clinic_id: CLINICA,
      job_id: JOB,
      author: "sistema",
      delivery_status: "enviada",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(eventos).toEqual([]);
  });
});

describe("revisão: a reserva nunca fica órfã (achado 8)", () => {
  it("o turno não grava depois da reserva: a reserva é solta (acerto sem uso) e o job volta", async () => {
    banco.erros.set("ai_turno:upsert", { code: "08006" });
    expect(await rodar()).toEqual({ ok: false, erro: "turno_nao_gravado" });
    expect(turno).not.toHaveBeenCalled();
    expect(banco.chamadasDe("acertar_gasto_da_ia")).toEqual([
      { p_reserva: RESERVA, p_linhas: [] },
    ]);
  });
});

describe("revisão: job anterior à janela só conclui (D-A, achado 2)", () => {
  it("Devolver durante o turno (a trava entre rodadas reprova): nada passa, a sessão nova continua na IA", async () => {
    turno.mockImplementation(async (entrada) => {
      devolverDepoisDoJob();
      expect(await entrada.conferirTrava!()).toBe(false);
      return frase({ tipo: "falhou", motivo: "liberacao_suspensa" });
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual([]);
    expect(eventos).toEqual([]);
    expect(conversa().status).toBe("ia_atendendo");
    expect(turnoGravado()).toMatchObject({ estado: "sem_envio" });
  });

  it("Devolver durante o envio (a guarda recusa a janela): nada passa", async () => {
    enviarResposta.mockImplementation(async () => {
      devolverDepoisDoJob();
      return {
        ok: false,
        reason: "falha_envio",
        code: "janela_invalida",
        message: "m",
      };
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual([]);
    expect(conversa().status).toBe("ia_atendendo");
    expect(turnoGravado()).toMatchObject({ estado: "sem_envio", texto: null });
  });

  it("escalou com o Devolver no meio: nem passagem nem frase na sessão nova", async () => {
    turno.mockImplementation(async () => {
      devolverDepoisDoJob();
      return frase({
        tipo: "escalou",
        motivo: "sintoma",
        gatilho: "sintoma",
        origem: "portao",
      });
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens).toEqual([]);
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
    expect(conversa().status).toBe("ia_atendendo");
  });

  // Conferencia da revisao (executor N3): nos ramos que falhavam definitivo
  // (numero fora, envio incerto ou falha que nao repete, linha do job que
  // ficou 'enviando'), o job anterior a janela atual so conclui: nunca vira
  // 'falhou' nem passa pelo fechamento do worker.
  it.each([
    [
      "número desconectado",
      { ok: false, reason: "desconectado", code: "desconectado", message: "m" },
    ],
    [
      "sem número",
      { ok: false, reason: "falha_envio", code: "sem_numero", message: "m" },
    ],
    [
      "envio incerto",
      { ok: false, reason: "falha_envio", code: "envio_incerto", message: "m" },
    ],
    [
      "falha do provedor que não repete",
      {
        ok: false,
        reason: "falha_envio",
        code: "provider_recusou",
        message: "m",
      },
    ],
  ] as [string, SendTextResult][])(
    "Devolver durante o envio e %s: conclui (D-A), sem passagem e com a sessão nova na IA",
    async (_caso, falha) => {
      enviarResposta.mockImplementation(async () => {
        devolverDepoisDoJob();
        return falha;
      });
      expect(await rodar()).toEqual({ ok: true });
      expect(passagens).toEqual([]);
      expect(enviarFrase).not.toHaveBeenCalled();
      expect(eventos).toEqual([]);
      expect(conversa().status).toBe("ia_atendendo");
      expect(turnoGravado()).toMatchObject({ estado: "sem_envio" });
    },
  );

  it.each([
    ["linha do job que ficou enviando", "enviando", null],
    ["linha do job que falhou com envio incerto", "falhou", "envio_incerto"],
  ])(
    "Devolver durante o envio e ja_enviado com a %s: conclui (D-A)",
    async (_caso, status, codigo) => {
      banco.linhas("message").push({
        id: "msg-ja",
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        job_id: JOB,
        author: "ia",
        delivery_status: status,
        error_code: codigo,
      });
      enviarResposta.mockImplementation(async () => {
        devolverDepoisDoJob();
        return {
          ok: false,
          reason: "ja_enviado",
          code: "ja_enviado",
          message: "m",
        };
      });
      expect(await rodar()).toEqual({ ok: true });
      expect(passagens).toEqual([]);
      expect(conversa().status).toBe("ia_atendendo");
      expect(turnoGravado()).toMatchObject({ estado: "sem_envio" });
    },
  );

  it("o banco diz job_antigo (corrida com o Devolver): sem frase, sem evento, turno sem_envio", async () => {
    turno.mockResolvedValue(frase({ tipo: "falhou", motivo: "timeout" }));
    banco.rpc("passar_conversa_da_ia_para_equipe", (args) => {
      passagens.push(String(args.p_motivo));
      return { data: { passou: false, codigo: "job_antigo" }, error: null };
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
    expect(turnoGravado()).toMatchObject({ estado: "sem_envio" });
  });

  it.each([
    ["decidido com resposta", { estado: "decidido", saida: "resposta" }],
    ["decidido com frase", { estado: "decidido", saida: "frase" }],
    ["passou_para_equipe", { estado: "passou_para_equipe", saida: "frase" }],
    ["reservado", { estado: "reservado", saida: null }],
  ] as [string, { estado: string; saida: string | null }][])(
    "retomada de job antigo (%s, lease vencido depois do Devolver): nada é enviado, passado nem registrado",
    async (_caso, campos) => {
      decisaoAprovadaDoJob("d-1");
      turnoDoJob({
        texto: campos.saida === "resposta" ? RESPOSTA : null,
        texto_sha256:
          campos.saida === "resposta" ? sha256DoTexto(RESPOSTA) : null,
        decision_id: "d-1",
        ...campos,
      });
      devolverDepoisDoJob();
      expect(await rodar()).toEqual({ ok: true });
      expect(enviarResposta).not.toHaveBeenCalled();
      expect(enviarFrase).not.toHaveBeenCalled();
      expect(turno).not.toHaveBeenCalled();
      expect(passagens).toEqual([]);
      expect(eventos).toEqual([]);
      expect(conversa().status).toBe("ia_atendendo");
      expect(turnoGravado()!.texto ?? null).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// Onda 2: fora do assunto (item 5, P5b), tipo do contato (item 4) e o aviso
// de assistente virtual (P11a)
// ---------------------------------------------------------------------------

function decisaoNaConversa(campos: Linha): void {
  banco.linhas("ai_decision_log").push({
    clinic_id: CLINICA,
    conversation_id: CONVERSA,
    desfecho: "respondeu",
    tool_used: "fora_do_assunto",
    created_at: "2026-10-13T14:59:30.000Z",
    ...campos,
  });
}

describe("onda 2: o que o executor passa ao turno", () => {
  it("o tipo do contato, quantas vezes a IA já respondeu fora do assunto na janela e se ela já respondeu", async () => {
    banco.linhas("contact")[0]!.kind = "paciente";
    // Conta: 'respondeu' com fora_do_assunto da conversa, desde a janela.
    decisaoNaConversa({ id: "d-conta" });
    // Nao contam: antes da janela, escalou, outra ferramenta, outra conversa.
    decisaoNaConversa({
      id: "d-antes",
      created_at: "2026-10-13T14:00:00.000Z",
    });
    decisaoNaConversa({ id: "d-escalou", desfecho: "escalou" });
    decisaoNaConversa({ id: "d-preco", tool_used: "buscar_procedimento" });
    decisaoNaConversa({
      id: "d-outra",
      conversation_id: "c0000000-0000-4000-8000-000000000009",
    });
    expect(await rodar()).toEqual({ ok: true });
    const entrada = turno.mock.calls[0]![0];
    expect(entrada.contato).toBe("paciente");
    expect(entrada.foraDoAssuntoNaJanela).toBe(1);
    // Nenhuma resposta da IA na janela: a proxima leva o aviso.
    expect(entrada.primeiraRespostaDaIa).toBe(true);
  });

  it("kind lead vai como lead; ausente ou desconhecido, sem tipo (sem a linha)", async () => {
    banco.linhas("contact")[0]!.kind = "lead";
    await rodar();
    expect(turno.mock.calls[0]![0].contato).toBe("lead");

    montar();
    banco.linhas("contact")[0]!.kind = "cliente";
    await rodar();
    expect(turno.mock.calls[0]![0].contato).toBeNull();
  });

  it("resposta da IA na janela: a próxima não leva o aviso de novo", async () => {
    banco.linhas("message").unshift({
      id: "m0",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      author: "ia",
      direction: "saida",
      content_type: "texto",
      body: "Olá! Como posso ajudar?",
      media_url: null,
      deleted_at: null,
      is_internal_note: false,
      pelo_celular: false,
      created_at: "2026-10-13T14:58:10.000Z",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno.mock.calls[0]![0].primeiraRespostaDaIa).toBe(false);
  });

  it("a contagem que não deu para ler: o job tenta de novo, sem chamar o modelo", async () => {
    banco.erros.set("ai_decision_log:select", { code: "57014" });
    expect(await rodar()).toEqual({ ok: false, erro: "leitura_falhou" });
    expect(turno).not.toHaveBeenCalled();
    expect(passagens).toEqual([]);
  });
});

describe("onda 2: a decisão do fora do assunto", () => {
  it("respondeu pela frase fixa: a decisão grava tool_used fora_do_assunto (é o que a contagem lê)", async () => {
    turno.mockResolvedValue({
      ...respondeu(),
      ferramentasUsadas: ["fora_do_assunto"],
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(decisoes()[0]).toMatchObject({
      desfecho: "respondeu",
      tool_used: "fora_do_assunto",
      aprovado: true,
      escalation_reason: null,
    });
    expect(enviarResposta).toHaveBeenCalledTimes(1);
  });

  it("insistiu (P5b): passa para a equipe com o motivo fora_do_assunto e a frase de escalonamento", async () => {
    turno.mockResolvedValue({
      ...frase({
        tipo: "escalou",
        motivo: "fora_do_assunto",
        gatilho: null,
        origem: "insistencia",
      }),
      ferramentasUsadas: ["fora_do_assunto"],
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(decisoes()[0]).toMatchObject({
      desfecho: "escalou",
      escalation_reason: "fora_do_assunto",
      // Nao foi o modelo que chamou escalar_humano: a ferramenta que rodou.
      tool_used: "fora_do_assunto",
    });
    expect(passagens).toEqual(["fora_do_assunto"]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    expect(enviarResposta).not.toHaveBeenCalled();
  });
});
