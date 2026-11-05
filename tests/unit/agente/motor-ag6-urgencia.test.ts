import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PASSO_DA_URGENCIA,
  type ClienteDoAgente,
  type ResultadoDoTurno,
} from "@/lib/agente/laco";
import {
  configPadraoDoAgente,
  TEXTO_DO_EVENTO_DA_IA,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { DependenciasDoExecutorDaIa } from "@/lib/jobs/responder-com-ia";
import type { Job } from "@/lib/jobs/worker";

import { BancoEmMemoria, type Linha } from "../ia-whatsapp/banco-em-memoria";
import {
  AGORA,
  ANA,
  bancoDaAg6,
  CLINICA,
  CONVERSA,
  conversaDoCenario,
  CRIADO,
  eventosDoFio,
  EXECUTOR,
  JOB,
  NOME_DO_CONTATO,
  NUMERO,
  PARA_O_RESPONSAVEL,
  TELEFONE,
} from "./ag6-contrato";

// AG6a, a URGENCIA no executor do WhatsApp (passo 7c; D-51 a D-54): o sinal
// de emergencia nos textos originais das pendentes passa a conversa ANTES do
// teto de respostas, da reserva do gasto e de qualquer modelo; a decisao
// (escalou, urgencia, gatilho urgencia, origem portao, sem uso) e gravada
// antes da passagem; a passagem NUNCA atribui e a atribuicao depois da
// frase nunca e chamada (mesmo com a regra do responsavel ligada; Revisao
// R1 do contrato do banco) e o banco marca a conversa; o contato recebe a
// frase de SEMPRE. A retomada passa do mesmo jeito. Nenhum teste chama a
// OpenAI (o turno e falso e, na urgencia, nunca e chamado).

const estado = vi.hoisted(() => ({ config: null as unknown }));

vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => estado.config,
  carregarCatalogoDoAgente: async () => ({
    procedimentos: [],
    vinculos: [],
    convenios: [],
    conveniosDoCadastro: [],
  }),
}));

const { executarRespostaComIa } = await import("@/lib/jobs/responder-com-ia");

const EMERGENCIA =
  "Fiz o preenchimento ontem e agora to com falta de ar e a garganta fechando.";

let banco: BancoEmMemoria;
let marcas: {
  podeFalar: boolean[];
  consentimento: boolean;
  reservas: (string | null)[];
  eventos: string[];
  respostas: Record<string, unknown>[];
};
let tempo: number;
let logs: string[];
let turno: ReturnType<
  typeof vi.fn<DependenciasDoExecutorDaIa["executarTurno"]>
>;
let enviarFrase: ReturnType<
  typeof vi.fn<DependenciasDoExecutorDaIa["enviarFrase"]>
>;
let enviarResposta: ReturnType<
  typeof vi.fn<DependenciasDoExecutorDaIa["enviarResposta"]>
>;
let decisoesNoEnvio: number[];

function configPublicada(extra: Partial<ConfigDoAgente> = {}): ConfigDoAgente {
  return {
    ...configPadraoDoAgente(),
    status: "publicada",
    versao: 3,
    ...extra,
  };
}

function montar(texto: string, extra: Partial<ConfigDoAgente> = {}) {
  banco = new BancoEmMemoria();
  tempo = AGORA;
  decisoesNoEnvio = [];
  marcas = {
    podeFalar: [],
    consentimento: true,
    reservas: [],
    eventos: [],
    respostas: [],
  };
  // A regra do responsavel LIGADA na versao do motor e na do banco: a
  // urgencia nunca atribui mesmo assim.
  estado.config = configPublicada({ regras: PARA_O_RESPONSAVEL, ...extra });
  bancoDaAg6(banco, {
    texto,
    passagemPara: "responsavel_do_lead",
    estado: marcas,
  });
  turno = vi.fn<DependenciasDoExecutorDaIa["executarTurno"]>(
    async (): Promise<ResultadoDoTurno> => {
      throw new Error("o turno nao pode rodar neste caso");
    },
  );
  enviarFrase = vi.fn<DependenciasDoExecutorDaIa["enviarFrase"]>(async () => {
    decisoesNoEnvio.push(banco.linhas("ai_decision_log").length);
    return { ok: true, messageId: "msg-frase" };
  });
  enviarResposta = vi.fn<DependenciasDoExecutorDaIa["enviarResposta"]>(
    async () => ({ ok: true, messageId: "msg-1" }),
  );
}

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

function deps(
  extra: Partial<DependenciasDoExecutorDaIa> = {},
): DependenciasDoExecutorDaIa {
  return {
    admin: banco.cliente(),
    config: { ligado: true, clinicas: [CLINICA] },
    prazoFinalMs: AGORA + 55_000,
    agora: () => tempo,
    clienteDoAgente: () =>
      ({ responses: { create: vi.fn() } }) as unknown as ClienteDoAgente,
    modeloDoAgente: () => "gpt-6-luna",
    segredoDoIdentificador: () => "s".repeat(40),
    criarVerificador: () => async () => {
      throw new Error("o verificador nunca e chamado na urgencia");
    },
    criarClassificador: () => async () => {
      throw new Error("o classificador nunca e chamado na urgencia");
    },
    executarTurno: turno,
    enviarResposta,
    enviarFrase,
    ...extra,
  };
}

function rodar(extra: Partial<DependenciasDoExecutorDaIa> = {}) {
  return executarRespostaComIa(job(), EXECUTOR, deps(extra));
}

function decisoes(): Linha[] {
  return banco.linhas("ai_decision_log");
}

function turnoGravado(): Linha | undefined {
  return banco.linhas("ai_turno").find((t) => t.job_id === JOB);
}

/** A urgencia aconteceu inteira, do jeito do desenho (1.1). */
function passouComoUrgencia() {
  expect(turno).not.toHaveBeenCalled();
  expect(banco.chamadasDe("reservar_gasto_da_ia")).toEqual([]);
  expect(banco.chamadasDe("acertar_gasto_da_ia")).toEqual([]);
  expect(decisoes()).toHaveLength(1);
  expect(decisoes()[0]).toMatchObject({
    desfecho: "escalou",
    escalation_reason: "urgencia",
    gatilho_entrada: "urgencia",
    aprovado: false,
    compliance_blocked: false,
    texto_sha256: null,
    tokens_entrada: 0,
    tokens_saida: 0,
    tool_used: null,
    config_version: 3,
  });
  const trilha = (
    decisoes()[0]?.context_read as { trilha: { texto: string }[] }
  ).trilha;
  expect(trilha.map((p) => p.texto)).toContain(PASSO_DA_URGENCIA);
  // A passagem SEM atribuir (so os tres parametros de sempre) e, mesmo com
  // a regra do responsavel ligada, nenhuma chamada da atribuicao depois da
  // frase (Revisao R1 do contrato do banco).
  expect(banco.chamadasDe("passar_conversa_da_ia_para_equipe")).toEqual([
    { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "urgencia" },
  ]);
  expect(banco.chamadasDe("atribuir_conversa_passada_pela_ia")).toEqual([]);
  // O banco marcou e nao atribuiu: a fila de todos.
  expect(conversaDoCenario(banco)).toMatchObject({
    status: "aguardando_humano",
    assignee_user_id: null,
  });
  expect(banco.linhas("conversa_urgente")).toMatchObject([
    {
      conversation_id: CONVERSA,
      clinic_id: CLINICA,
      job_id: JOB,
      encerrada_em: null,
    },
  ]);
  expect(eventosDoFio(banco)).toEqual([TEXTO_DO_EVENTO_DA_IA.urgencia]);
  // A frase de sempre, depois da decisao gravada.
  expect(enviarFrase).toHaveBeenCalledTimes(1);
  expect(decisoesNoEnvio).toEqual([1]);
  expect(turnoGravado()).toMatchObject({
    estado: "passou_para_equipe",
    saida: "frase",
    mensagens_lidas: ["m1"],
  });
}

beforeEach(() => {
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
  // Nenhum texto do paciente, nem o sinal, nem o nome no log.
  const tudo = logs.join("");
  expect(tudo).not.toContain("falta de ar");
  expect(tudo).not.toContain("garganta");
  expect(tudo).not.toContain("falta_de_ar");
  expect(tudo).not.toContain(TELEFONE);
  expect(tudo).not.toContain(NOME_DO_CONTATO);
  expect(tudo).not.toContain("Ana Lima");
});

describe("AG6a: a urgência no executor", () => {
  it("passa antes do teto e da reserva, sem modelo, com a decisão, a marca e a frase de sempre (nunca atribui)", async () => {
    montar(EMERGENCIA);
    expect(await rodar()).toEqual({ ok: true });
    passouComoUrgencia();
    // O que a frase leva: a de sempre (send.ts manda FRASE_DE_ESCALONAMENTO).
    expect(enviarFrase.mock.calls[0]?.[1]).toMatchObject({
      clinicId: CLINICA,
      conversationId: CONVERSA,
      jobId: JOB,
    });
    expect(enviarResposta).not.toHaveBeenCalled();
    expect(logs.join("")).toContain('"kind":"urgencia"');
  });

  it("com o teto de respostas da hora acabado: a urgência passa do mesmo jeito", async () => {
    montar(EMERGENCIA);
    for (let i = 0; i < 25; i += 1) {
      banco.linhas("message").push({
        id: `ia-${i}`,
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        author: "ia",
        direction: "saida",
        content_type: "texto",
        body: "Resposta antiga.",
        media_url: null,
        deleted_at: null,
        is_internal_note: false,
        pelo_celular: false,
        created_at: "2026-10-13T14:30:00.000Z",
      });
    }
    // As respostas antigas sao de antes desta mensagem: ela segue pendente
    // (a mensagem fica por ultimo).
    banco
      .linhas("message")
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    expect(await rodar()).toEqual({ ok: true });
    passouComoUrgencia();
  });

  it("com o teto de gasto do dia acabado: nem chega a reservar", async () => {
    montar(EMERGENCIA);
    marcas.reservas = [null];
    expect(await rodar()).toEqual({ ok: true });
    passouComoUrgencia();
  });

  it("sem a chave, o modelo ou o identificador: a urgência não depende de nada disso", async () => {
    montar(EMERGENCIA);
    expect(
      await rodar({
        clienteDoAgente: () => null,
        modeloDoAgente: () => null,
        segredoDoIdentificador: () => null,
      }),
    ).toEqual({ ok: true });
    passouComoUrgencia();
  });

  it("risco de vida: passa igual (a frase de sempre nesta rodada)", async () => {
    montar("não aguento mais, quero morrer");
    expect(await rodar()).toEqual({ ok: true });
    passouComoUrgencia();
  });

  it("a urgência numa pendente anterior da rajada: passa", async () => {
    montar(EMERGENCIA);
    banco.linhas("message").push({
      id: "m2",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      author: "paciente",
      direction: "entrada",
      content_type: "texto",
      body: "alguém aí?",
      media_url: null,
      deleted_at: null,
      is_internal_note: false,
      pelo_celular: false,
      created_at: "2026-10-13T14:58:40.000Z",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(decisoes()[0]).toMatchObject({ escalation_reason: "urgencia" });
    expect(turnoGravado()).toMatchObject({ mensagens_lidas: ["m1", "m2"] });
  });

  // Revisao de 28/10/2026: a juncao das pendentes, na ordem, e a legenda da
  // midia (nunca do audio).
  function pendente(id: string, criadaEm: string, extra: Partial<Linha>) {
    banco.linhas("message").push({
      id,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      author: "paciente",
      direction: "entrada",
      content_type: "texto",
      body: null,
      media_url: null,
      deleted_at: null,
      is_internal_note: false,
      pelo_celular: false,
      created_at: criadaEm,
      ...extra,
    });
  }

  it("a mensagem em partes (\"to com dor\" e depois \"no peito\"): a junção na ordem passa", async () => {
    montar("to com dor");
    pendente("m2", "2026-10-13T14:58:40.000Z", { body: "no peito" });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(decisoes()[0]).toMatchObject({ escalation_reason: "urgencia" });
    expect(turnoGravado()).toMatchObject({ mensagens_lidas: ["m1", "m2"] });
    expect(banco.linhas("conversa_urgente")).toHaveLength(1);
    expect(logs.join("")).not.toContain("peito");
  });

  it("a legenda da foto (\"to com dor no peito\"): passa, sem modelo", async () => {
    montar("ignorado");
    const m1 = banco.linhas("message").find((m) => m.id === "m1");
    Object.assign(m1 ?? {}, {
      content_type: "imagem",
      media_url: "clinica/midia/m1.jpg",
      body: "to com dor no peito",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(decisoes()[0]).toMatchObject({
      escalation_reason: "urgencia",
      gatilho_entrada: "urgencia",
    });
    expect(banco.linhas("conversa_urgente")).toHaveLength(1);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    expect(logs.join("")).not.toContain("peito");
  });

  it("a legenda do vídeo junto com o texto de antes (\"olha isso\" e \"ela desmaiou\"): passa", async () => {
    montar("olha isso");
    pendente("m2", "2026-10-13T14:58:40.000Z", {
      content_type: "video",
      media_url: "clinica/midia/m2.mp4",
      body: "ela desmaiou",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(decisoes()[0]).toMatchObject({ escalation_reason: "urgencia" });
  });

  it("o corpo do áudio nunca é lido pela urgência nesta rodada: o turno de sempre (que escala a mídia)", async () => {
    montar("ignorado");
    const m1 = banco.linhas("message").find((m) => m.id === "m1");
    Object.assign(m1 ?? {}, {
      content_type: "audio",
      media_url: "clinica/midia/m1.ogg",
      body: "to com falta de ar",
    });
    turno.mockImplementation(async () => ({
      tipo: "frase_fixa",
      resposta: FRASE_DE_ESCALONAMENTO,
      desfecho: {
        tipo: "escalou",
        motivo: "midia_nao_suportada",
        gatilho: "midia",
        origem: "portao",
      },
      trilha: [],
      uso: [],
      versaoDoPrompt: "agente-teste",
      filtro: null,
      descartados: { instrucoes: false, itensDaBase: 0 },
      rascunhoBloqueado: null,
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).toHaveBeenCalledTimes(1);
    // O laco recebe o audio sem legenda (so a urgencia leria a legenda).
    const mensagens = turno.mock.calls[0]?.[0].mensagens ?? [];
    expect(mensagens.at(-1)).toMatchObject({ tipo: "audio", texto: null });
    expect(mensagens.at(-1)).not.toHaveProperty("legendaOriginal");
    expect(banco.linhas("conversa_urgente")).toEqual([]);
  });

  it("o nome do contato mascarado não esconde o sinal (lê o texto original)", async () => {
    // O contato se chama "Falta Silva": a mascara do nome troca "falta" por
    // Fulano no texto da OpenAI; a urgencia le o texto original.
    montar("to com falta de ar");
    const contato = banco.linhas("contact")[0];
    if (contato !== undefined) {
      contato.name = "Falta Silva";
    }
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(decisoes()[0]).toMatchObject({ escalation_reason: "urgencia" });
  });
});

describe("AG6a: o que não é urgência segue o turno de sempre", () => {
  function respondeu(): ResultadoDoTurno {
    return {
      tipo: "frase_fixa",
      resposta: FRASE_DE_ESCALONAMENTO,
      desfecho: {
        tipo: "escalou",
        motivo: "sintoma",
        gatilho: "sintoma",
        origem: "portao",
      },
      trilha: [],
      uso: [],
      versaoDoPrompt: "agente-teste",
      filtro: null,
      descartados: { instrucoes: false, itensDaBase: 0 },
      rascunhoBloqueado: null,
    };
  }

  it.each([
    "não estou com falta de ar, só quero o preço",
    "Tem falta de ar condicionado na sala de espera?",
    "o SAMU fica perto daí?",
    "nunca tive convulsão, posso fazer botox?",
    // Revisao de 28/10/2026: os falsos positivos da estetica e da recepcao.
    // Revisao de 88e9560 (RR1): "fiz botox e minha boca ficou torta" e "meu
    // marido vai me matar" viraram urgencia pela politica das excecoes (so
    // prova positiva de que nao e emergencia); ficam o sorriso de sempre e a
    // figura do preco.
    "minha boca fica torta quando eu sorrio",
    "papada e rosto caindo, o que vocês fazem?",
    "surgiu uma emergência familiar, preciso cancelar",
    "tentei ligar várias vezes, não consigo falar.",
    "esse preço vai me matar",
    "já desmaiei tirando sangue",
    "minha mãe teve um AVC, ela pode fazer botox?",
  ])("%s: o turno roda (reserva e portão de sempre)", async (texto) => {
    montar(texto);
    turno.mockImplementation(async () => respondeu());
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).toHaveBeenCalledTimes(1);
    expect(banco.chamadasDe("reservar_gasto_da_ia")).toHaveLength(1);
    expect(banco.linhas("conversa_urgente")).toEqual([]);
  });

  it("a mensagem com o sinal que um turno já respondeu não conta de novo", async () => {
    montar(EMERGENCIA);
    // m1 ja foi respondida (turno enviado); a nova e de recepcao.
    banco.linhas("ai_turno").push({
      job_id: "10000000-0000-4000-8000-000000000009",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      estado: "enviado",
      mensagens_lidas: ["m1"],
    });
    banco.linhas("message").push(
      {
        id: "r1",
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        author: "sistema",
        direction: "saida",
        content_type: "texto",
        body: FRASE_DE_ESCALONAMENTO,
        media_url: null,
        deleted_at: null,
        is_internal_note: false,
        pelo_celular: false,
        created_at: "2026-10-13T14:58:35.000Z",
      },
      {
        id: "m3",
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        author: "paciente",
        direction: "entrada",
        content_type: "texto",
        body: "qual o endereço?",
        media_url: null,
        deleted_at: null,
        is_internal_note: false,
        pelo_celular: false,
        created_at: "2026-10-13T14:58:50.000Z",
      },
    );
    turno.mockImplementation(async () => respondeu());
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).toHaveBeenCalledTimes(1);
  });
});

describe("AG6a: a urgência na retomada e na corrida", () => {
  it("a passagem que falhou: a retomada em 'decidido' passa com urgencia, sem atribuir, e a frase sai uma vez", async () => {
    montar(EMERGENCIA);
    let falhas = 1;
    const original = banco.manipuladores.get(
      "passar_conversa_da_ia_para_equipe",
    );
    banco.rpc("passar_conversa_da_ia_para_equipe", (args) => {
      if (falhas > 0) {
        falhas -= 1;
        return { data: null, error: { code: "57014" } };
      }
      return original?.(args) ?? { data: null, error: null };
    });
    expect(await rodar()).toEqual({ ok: false, erro: "passagem_falhou" });
    expect(turnoGravado()).toMatchObject({
      estado: "decidido",
      saida: "frase",
    });
    expect(enviarFrase).not.toHaveBeenCalled();
    // A retomada: nada de turno, reserva ou decisao nova.
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(decisoes()).toHaveLength(1);
    expect(banco.chamadasDe("passar_conversa_da_ia_para_equipe")).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "urgencia" },
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "urgencia" },
    ]);
    expect(banco.linhas("conversa_urgente")).toHaveLength(1);
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
    expect(banco.chamadasDe("atribuir_conversa_passada_pela_ia")).toEqual([]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
  });

  // Revisao de 28/10/2026 (achado 7): a passagem por urgencia que voltou
  // SEM a marca (a gravacao em conversa_urgente falhou e virou WARNING no
  // banco) deixa o aviso no log, so com os ids e o codigo. A passagem vale:
  // a conversa na fila de todos, a frase de sempre, nenhuma atribuicao.
  function avisosSemMarca(): string[] {
    return logs
      .join("")
      .split("\n")
      .filter((linha) => linha.includes('"evento":"ia_urgencia_sem_marca"'));
  }

  it("a marca que não gravou (urgente falso): a passagem vale, a frase sai e o aviso fica no log, só com ids e o código", async () => {
    montar(EMERGENCIA);
    banco.rpc("passar_conversa_da_ia_para_equipe", () => {
      Object.assign(conversaDoCenario(banco), {
        status: "aguardando_humano",
        awaiting_reply: true,
      });
      return {
        data: { passou: true, codigo: "passou", urgente: false },
        error: null,
      };
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    expect(banco.chamadasDe("atribuir_conversa_passada_pela_ia")).toEqual([]);
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "aguardando_humano",
      assignee_user_id: null,
    });
    expect(turnoGravado()).toMatchObject({ estado: "passou_para_equipe" });
    const avisos = avisosSemMarca();
    expect(avisos).toHaveLength(1);
    expect(JSON.parse(avisos[0] ?? "{}")).toEqual({
      ts: expect.any(String),
      nivel: "warn",
      evento: "ia_urgencia_sem_marca",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      error_code: "marca_nao_gravada",
    });
  });

  it("a marca gravada (urgente verdadeiro): nenhum aviso", async () => {
    montar(EMERGENCIA);
    expect(await rodar()).toEqual({ ok: true });
    passouComoUrgencia();
    expect(avisosSemMarca()).toEqual([]);
  });

  it("a passagem recusada (ja_fora_da_ia) com urgente falso: nenhum aviso (não passou)", async () => {
    montar(EMERGENCIA);
    banco.rpc("passar_conversa_da_ia_para_equipe", () => ({
      data: { passou: false, codigo: "ja_fora_da_ia", urgente: false },
      error: null,
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(avisosSemMarca()).toEqual([]);
  });

  it("alguém assumiu entre a decisão e a passagem: nada sai e a conversa fica com quem assumiu", async () => {
    montar(EMERGENCIA);
    banco.aoInserir = (tabela) => {
      if (tabela === "ai_decision_log") {
        Object.assign(conversaDoCenario(banco), {
          status: "em_atendimento",
          assignee_user_id: ANA,
        });
      }
      return null;
    };
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(banco.linhas("conversa_urgente")).toEqual([]);
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "em_atendimento",
      assignee_user_id: ANA,
    });
  });
});
