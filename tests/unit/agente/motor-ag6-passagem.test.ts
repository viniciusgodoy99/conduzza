import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ClienteDoAgente, ResultadoDoTurno } from "@/lib/agente/laco";
import {
  atribuirConversaPassadaPelaIa,
  CODIGOS_DA_ATRIBUICAO,
  passarParaAEquipe,
} from "@/lib/agente/whatsapp";
import {
  configPadraoDoAgente,
  expedientePadrao,
  TEXTO_DO_EVENTO_DA_IA,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { DependenciasDoExecutorDaIa } from "@/lib/jobs/responder-com-ia";
import type { Job } from "@/lib/jobs/worker";

import { BancoEmMemoria, type Resposta } from "../ia-whatsapp/banco-em-memoria";
import { aprovarParaTeste } from "../ia-whatsapp/texto-aprovado-de-teste";
import {
  AGORA,
  ANA,
  bancoDaAg6,
  BIA,
  CLINICA,
  CODIGOS_DA_ATRIBUICAO_NO_BANCO,
  CONVERSA,
  conversaDoCenario,
  CRIADO,
  eventosDoFio,
  EXECUTOR,
  JOB,
  NOME_DO_CONTATO,
  NUMERO,
  OUTRA_CLINICA,
  PARA_O_RESPONSAVEL,
  TELEFONE,
} from "./ag6-contrato";

// AG6a, a ATRIBUICAO ao responsavel do lead (D-15 e D-55, PENDENTES,
// construidas com a recomendacao), na Revisao R1 do contrato do banco (28/10/
// 2026): a passagem (passar_conversa_da_ia_para_equipe) volta aos tres
// parametros e NUNCA atribui; a conversa que a IA passou COM a frase vai ao
// responsavel DEPOIS da tentativa da frase, pela RPC nova
// atribuir_conversa_passada_pela_ia, porque a guarda do envio
// (ia_pode_enviar_agora com 'frase') so deixa a frase sair com a conversa em
// "Aguardando você" sem responsavel. O motor chama so na passagem COM a
// frase que devolveu "passou" e com a regra "responsavel_do_lead" na versao
// publicada que ele leu; nunca na urgencia, no fora do horario, nas
// passagens sem frase nem no "ja_fora_da_ia". Revisao R2 do contrato do
// banco: nem no sintoma, no assunto clinico, na midia e na conformidade
// (onde cai a emergencia que a lista deterministica nao pega), e o banco
// recusa com mensagem_nova quando o paciente escreveu o que o job nao leu.
// O banco decide de novo. Erro da RPC: a fila, so o log com ids e o
// codigo. Nenhum teste chama a OpenAI.

const estado = vi.hoisted(() => ({
  config: null as unknown,
  falharALeitura: false,
  leituras: 0,
}));

vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigPublicada: async () => {
    estado.leituras += 1;
    if (estado.falharALeitura) {
      throw new Error("leitura do agente falhou");
    }
    return estado.config;
  },
  carregarCatalogoDoAgente: async () => ({
    procedimentos: [],
    vinculos: [],
    convenios: [],
    conveniosDoCadastro: [],
  }),
}));

const { executarRespostaComIa } = await import("@/lib/jobs/responder-com-ia");

const PERGUNTA = "Tem desconto se eu pagar à vista?";
const RESPOSTA = "A consulta custa R$ 150,00.";
const RESPOSTA_APROVADA = await aprovarParaTeste(RESPOSTA, [15_000]);
const ATRIBUIR = "atribuir_conversa_passada_pela_ia";

type EnvioDaFrase = Awaited<
  ReturnType<DependenciasDoExecutorDaIa["enviarFrase"]>
>;

let banco: BancoEmMemoria;
let marcas: {
  podeFalar: boolean[];
  consentimento: boolean;
  reservas: (string | null)[];
  eventos: string[];
  respostas: Record<string, unknown>[];
  atribuicoes: Record<string, unknown>[];
  ordem: string[];
};
let logs: string[];
/** O que cada tentativa da frase devolveu (o espelho da guarda do envio). */
let frases: EnvioDaFrase[];
let turno: ReturnType<
  typeof vi.fn<DependenciasDoExecutorDaIa["executarTurno"]>
>;
let enviarFrase: ReturnType<
  typeof vi.fn<DependenciasDoExecutorDaIa["enviarFrase"]>
>;
let enviarResposta: ReturnType<
  typeof vi.fn<DependenciasDoExecutorDaIa["enviarResposta"]>
>;

const COMUM = {
  trilha: [],
  uso: [],
  versaoDoPrompt: "agente-teste",
  descartados: { instrucoes: false, itensDaBase: 0 },
};

function frase(desfecho: ResultadoDoTurno["desfecho"]): ResultadoDoTurno {
  return {
    ...COMUM,
    tipo: "frase_fixa",
    resposta: FRASE_DE_ESCALONAMENTO,
    desfecho,
    filtro: null,
    rascunhoBloqueado: null,
  };
}

function respondeu(): ResultadoDoTurno {
  return {
    ...COMUM,
    tipo: "resposta",
    resposta: RESPOSTA_APROVADA,
    desfecho: { tipo: "respondeu" },
    filtro: {
      aprovado: true,
      texto: RESPOSTA_APROVADA,
      sha256: "0".repeat(64),
      versaoDasRegras: "regras-teste",
      verificador: { modelo: "gpt-6-luna", uso: null },
    },
    rascunhoBloqueado: null,
  };
}

const VALOR: ResultadoDoTurno["desfecho"] = {
  tipo: "escalou",
  motivo: "valor_fora_da_tabela",
  gatilho: "valor_fora_da_tabela",
  origem: "portao",
};

function configPublicada(extra: Partial<ConfigDoAgente> = {}): ConfigDoAgente {
  return {
    ...configPadraoDoAgente(),
    status: "publicada",
    versao: 3,
    ...extra,
  };
}

/**
 * O espelho da guarda do envio da frase (ia_pode_enviar_agora com 'frase',
 * migration 20261013100000): a frase so sai com a conversa em "Aguardando
 * você" e SEM responsavel; senao, fora_da_ia e nada sai.
 */
function guardaDaFrase(): EnvioDaFrase {
  const conversa = conversaDoCenario(banco);
  if (
    conversa.status !== "aguardando_humano" ||
    (conversa.assignee_user_id ?? null) !== null
  ) {
    return {
      ok: false,
      reason: "falha_envio",
      code: "fora_da_ia",
      message: "x",
    };
  }
  return { ok: true, messageId: "msg-frase" };
}

/**
 * O cenario: `motor` e a regra da versao que o executor le; `banco` a da
 * ultima publicada que a atribuicao confere.
 */
function montar(
  e: {
    motor?: "fila" | "responsavel_do_lead";
    banco?: "fila" | "responsavel_do_lead";
    resultado?: ResultadoDoTurno;
  } = {},
) {
  banco = new BancoEmMemoria();
  frases = [];
  marcas = {
    podeFalar: [],
    consentimento: true,
    reservas: [],
    eventos: [],
    respostas: [],
    atribuicoes: [],
    ordem: [],
  };
  estado.falharALeitura = false;
  estado.leituras = 0;
  estado.config = configPublicada(
    e.motor === "responsavel_do_lead" ? { regras: PARA_O_RESPONSAVEL } : {},
  );
  bancoDaAg6(banco, {
    texto: PERGUNTA,
    passagemPara: e.banco ?? e.motor ?? "fila",
    estado: marcas,
  });
  const resultado = e.resultado ?? frase(VALOR);
  turno = vi.fn<DependenciasDoExecutorDaIa["executarTurno"]>(
    async () => resultado,
  );
  enviarFrase = vi.fn<DependenciasDoExecutorDaIa["enviarFrase"]>(async () => {
    marcas.ordem.push("frase");
    const saida = guardaDaFrase();
    frases.push(saida);
    return saida;
  });
  enviarResposta = vi.fn<DependenciasDoExecutorDaIa["enviarResposta"]>(
    async () => ({ ok: true, messageId: "msg-1" }),
  );
}

function job(): Job {
  return {
    id: JOB,
    clinic_id: CLINICA,
    kind: "responder_com_ia",
    payload: { conversation_id: CONVERSA, ultima_mensagem_id: "m1" },
    attempts: 1,
    max_attempts: 3,
    whatsapp_account_id: NUMERO,
    created_at: CRIADO,
  };
}

function deps(
  extra: Partial<DependenciasDoExecutorDaIa> = {},
): DependenciasDoExecutorDaIa {
  return {
    admin: banco.cliente(),
    config: { ligado: true, clinicas: [CLINICA] },
    prazoFinalMs: AGORA + 55_000,
    agora: () => AGORA,
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

function rodar(extra: Partial<DependenciasDoExecutorDaIa> = {}) {
  return executarRespostaComIa(job(), EXECUTOR, deps(extra));
}

function passagens() {
  return banco.chamadasDe("passar_conversa_da_ia_para_equipe");
}

function atribuicoes() {
  return banco.chamadasDe(ATRIBUIR);
}

const EVENTO_DA_ANA = "A conversa ficou com Ana Lima, responsável pelo lead.";

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
  const tudo = logs.join("");
  expect(tudo).not.toContain(PERGUNTA);
  expect(tudo).not.toContain(TELEFONE);
  expect(tudo).not.toContain(NOME_DO_CONTATO);
  expect(tudo).not.toContain("Ana Lima");
  expect(tudo).not.toContain(ANA);
});

describe("passarParaAEquipe: a passagem de sempre (Revisão R1.1)", () => {
  function bancoQueResponde(data: unknown, erro: string | null = null) {
    const b = new BancoEmMemoria();
    b.rpc("passar_conversa_da_ia_para_equipe", () => ({
      data,
      error: erro === null ? null : { code: erro },
    }));
    return b;
  }
  const BASE = { clinicId: CLINICA, jobId: JOB, workerId: EXECUTOR };

  it("sempre os três parâmetros; a resposta sem a chave urgente lê falso", async () => {
    const b = bancoQueResponde({ passou: true, codigo: "passou" });
    expect(
      await passarParaAEquipe(b.cliente(), {
        ...BASE,
        motivo: "valor_fora_da_tabela",
      }),
    ).toEqual({ resultado: "passou", urgente: false });
    expect(b.chamadasDe("passar_conversa_da_ia_para_equipe")).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "valor_fora_da_tabela" },
    ]);
  });

  it("a urgência: o que o banco marcou, com o log só com códigos", async () => {
    const b = bancoQueResponde({
      passou: true,
      codigo: "passou",
      urgente: true,
    });
    expect(
      await passarParaAEquipe(b.cliente(), { ...BASE, motivo: "urgencia" }),
    ).toEqual({ resultado: "passou", urgente: true });
    expect(b.chamadasDe("passar_conversa_da_ia_para_equipe")).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "urgencia" },
    ]);
    expect(logs.join("")).toContain('"kind":"urgente"');
  });

  it.each([
    [{ passou: false, codigo: "sem_posse", urgente: false }, "sem_posse"],
    [{ passou: false, codigo: "job_antigo", urgente: false }, "job_antigo"],
    [
      { passou: false, codigo: "ja_fora_da_ia", urgente: false },
      "ja_fora_da_ia",
    ],
    [null, "ja_fora_da_ia"],
  ] as const)("recusa %j: %s, sem marca", async (data, resultado) => {
    const b = bancoQueResponde(data);
    expect(
      await passarParaAEquipe(b.cliente(), { ...BASE, motivo: "sintoma" }),
    ).toEqual({ resultado, urgente: false });
  });

  it("erro do banco e exceção: erro (o job tenta de novo)", async () => {
    const b = bancoQueResponde(null, "PGRST202");
    expect(
      await passarParaAEquipe(b.cliente(), { ...BASE, motivo: "sintoma" }),
    ).toEqual({ resultado: "erro", urgente: false });
    const lanca = new BancoEmMemoria();
    lanca.rpc("passar_conversa_da_ia_para_equipe", () => {
      throw new Error("rede");
    });
    expect(
      await passarParaAEquipe(lanca.cliente(), { ...BASE, motivo: "sintoma" }),
    ).toEqual({ resultado: "erro", urgente: false });
  });
});

describe("atribuirConversaPassadaPelaIa: a RPC nova (Revisão R1.2)", () => {
  const BASE = {
    clinicId: CLINICA,
    conversationId: CONVERSA,
    jobId: JOB,
    workerId: EXECUTOR,
  };

  function bancoQueResponde(responder: () => unknown) {
    const b = new BancoEmMemoria();
    b.rpc(ATRIBUIR, () => responder() as { data: unknown; error: null });
    return b;
  }

  it("os códigos do motor são os do contrato do banco, na mesma ordem", () => {
    expect([...CODIGOS_DA_ATRIBUICAO]).toEqual([
      ...CODIGOS_DA_ATRIBUICAO_NO_BANCO,
    ]);
  });

  it("chama só com o job e o executor (nada da conversa nem do paciente)", async () => {
    const b = bancoQueResponde(() => ({
      data: { atribuida: true, codigo: "atribuida" },
      error: null,
    }));
    expect(await atribuirConversaPassadaPelaIa(b.cliente(), BASE)).toEqual({
      tipo: "resposta",
      codigo: "atribuida",
    });
    expect(b.chamadasDe(ATRIBUIR)).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR },
    ]);
    const linha = logs.join("");
    expect(linha).toContain('"evento":"ia_atribuicao_da_ia"');
    expect(linha).toContain('"status":"atribuida"');
    expect(linha).toContain(`"job_id":"${JOB}"`);
  });

  it.each(CODIGOS_DA_ATRIBUICAO.filter((c) => c !== "atribuida"))(
    "a recusa %s: a fila, com o código no log",
    async (codigo) => {
      const b = bancoQueResponde(() => ({
        data: { atribuida: false, codigo },
        error: null,
      }));
      expect(await atribuirConversaPassadaPelaIa(b.cliente(), BASE)).toEqual({
        tipo: "resposta",
        codigo,
      });
      const linha = logs.join("");
      if (codigo === "erro") {
        expect(linha).toContain('"nivel":"warn"');
        expect(linha).toContain('"error_code":"erro"');
      } else {
        expect(linha).toContain(`"status":"${codigo}"`);
      }
    },
  );

  it.each(["PGRST202", "42501", "57014"])(
    "o erro HTTP %s (a função ausente antes da migration, a permissão, o corte): falha, só o código no log",
    async (codigo) => {
      const b = new BancoEmMemoria();
      b.rpc(ATRIBUIR, () => ({ data: null, error: { code: codigo } }));
      expect(await atribuirConversaPassadaPelaIa(b.cliente(), BASE)).toEqual({
        tipo: "falha",
        codigo,
      });
      expect(logs.join("")).toContain(`"error_code":"${codigo}"`);
    },
  );

  it("a exceção e o prazo: falha, nunca lança", async () => {
    const lanca = new BancoEmMemoria();
    lanca.rpc(ATRIBUIR, () => {
      throw new Error("rede");
    });
    expect(await atribuirConversaPassadaPelaIa(lanca.cliente(), BASE)).toEqual({
      tipo: "falha",
      codigo: "excecao",
    });
    const parado = new BancoEmMemoria();
    parado.rpc(ATRIBUIR, () => new Promise<Resposta>(() => undefined));
    expect(
      await atribuirConversaPassadaPelaIa(parado.cliente(), {
        ...BASE,
        prazoMs: 20,
      }),
    ).toEqual({ tipo: "falha", codigo: "prazo" });
  });

  it.each([
    [null],
    [{ atribuida: true }],
    [{ atribuida: "sim", codigo: "atribuida" }],
    [{ atribuida: true, codigo: "fora_da_fila" }],
    [{ atribuida: false, codigo: "atribuida" }],
    [{ atribuida: false, codigo: "inventado" }],
  ])("a resposta fora do formato %j: falha", async (data) => {
    const b = bancoQueResponde(() => ({ data, error: null }));
    expect(await atribuirConversaPassadaPelaIa(b.cliente(), BASE)).toEqual({
      tipo: "falha",
      codigo: "resposta_fora_do_formato",
    });
  });
});

describe("AG6a: a passagem COM a frase, e a atribuição DEPOIS da frase", () => {
  it("fila (o padrão): os três parâmetros, a frase e nenhuma atribuição", async () => {
    montar();
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "valor_fora_da_tabela" },
    ]);
    expect(atribuicoes()).toEqual([]);
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "aguardando_humano",
      assignee_user_id: null,
    });
    expect(eventosDoFio(banco)).toEqual([
      TEXTO_DO_EVENTO_DA_IA.valor_fora_da_tabela,
    ]);
    expect(frases).toEqual([{ ok: true, messageId: "msg-frase" }]);
  });

  it("responsável do lead: a frase SAI (a guarda vê a fila) e só DEPOIS a conversa fica com a Ana", async () => {
    montar({ motor: "responsavel_do_lead" });
    expect(await rodar()).toEqual({ ok: true });
    // A ORDEM: a passagem, a frase, a atribuicao.
    expect(marcas.ordem).toEqual(["passagem", "frase", "atribuicao:atribuida"]);
    // A frase saiu: a guarda viu a conversa na fila, sem responsavel.
    expect(frases).toEqual([{ ok: true, messageId: "msg-frase" }]);
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "valor_fora_da_tabela" },
    ]);
    expect(atribuicoes()).toEqual([{ p_job_id: JOB, p_worker: EXECUTOR }]);
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "em_atendimento",
      assignee_user_id: ANA,
    });
    expect(eventosDoFio(banco)).toEqual([
      TEXTO_DO_EVENTO_DA_IA.valor_fora_da_tabela,
      EVENTO_DA_ANA,
    ]);
    // Nada de "aviso nao enviado".
    expect(marcas.eventos).toEqual([]);
    expect(banco.linhas("conversa_urgente")).toEqual([]);
    expect(logs.join("")).toContain('"status":"atribuida"');
  });

  it("o achado que motivou a revisão: atribuída ANTES da frase, a guarda recusa e o contato fica sem aviso", async () => {
    // A passagem antiga (atribuia na mesma transacao): a guarda ve a
    // conversa com a Ana e recusa a frase. E o que a ordem nova evita.
    montar({ motor: "responsavel_do_lead" });
    const original = banco.manipuladores.get(
      "passar_conversa_da_ia_para_equipe",
    );
    banco.rpc("passar_conversa_da_ia_para_equipe", async (args) => {
      const r = await (original?.(args) ?? { data: null, error: null });
      Object.assign(conversaDoCenario(banco), {
        status: "em_atendimento",
        assignee_user_id: ANA,
      });
      return r;
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(frases).toEqual([
      { ok: false, reason: "falha_envio", code: "fora_da_ia", message: "x" },
    ]);
    expect(marcas.eventos).toEqual(["aviso_nao_enviado"]);
  });

  it.each<[string, ResultadoDoTurno["desfecho"]]>([
    [
      "o agente pediu",
      {
        tipo: "escalou",
        motivo: "pedido_de_agenda",
        gatilho: null,
        origem: "agente",
      },
    ],
    [
      "o pedido de falar com alguém",
      {
        tipo: "escalou",
        motivo: "pedido_humano",
        gatilho: "pedido_humano",
        origem: "portao",
      },
    ],
    ["falha técnica do turno", { tipo: "falhou", motivo: "desconhecida" }],
  ])("%s: a frase e depois a Ana", async (_nome, desfecho) => {
    montar({ motor: "responsavel_do_lead", resultado: frase(desfecho) });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()[0]).not.toHaveProperty("p_atribuir");
    expect(marcas.ordem).toEqual(["passagem", "frase", "atribuicao:atribuida"]);
    expect(conversaDoCenario(banco).assignee_user_id).toBe(ANA);
  });

  // Revisao R2 do contrato do banco (28/10/2026): onde cai a emergencia que
  // a lista deterministica nao pega (o sintoma, o assunto clinico, a midia,
  // a resposta que o filtro do CFM barrou), a conversa fica na fila de
  // todos, com a regra do responsavel ligada: o motor nem chama a
  // atribuicao (e o banco recusaria com motivo_nao_atribui).
  it.each<[string, ResultadoDoTurno["desfecho"], string]>([
    [
      "sintoma pelo portão",
      {
        tipo: "escalou",
        motivo: "sintoma",
        gatilho: "sintoma",
        origem: "portao",
      },
      "sintoma",
    ],
    [
      "sintoma pelo agente (escalar_humano)",
      {
        tipo: "escalou",
        motivo: "sintoma",
        gatilho: null,
        origem: "agente",
      },
      "sintoma",
    ],
    [
      "assunto clínico pelo classificador",
      {
        tipo: "escalou",
        motivo: "assunto_clinico",
        gatilho: "assunto_clinico",
        origem: "classificador",
      },
      "assunto_clinico",
    ],
    [
      "a mídia (o áudio, a foto, o documento)",
      {
        tipo: "escalou",
        motivo: "midia_nao_suportada",
        gatilho: "midia",
        origem: "portao",
      },
      "midia_nao_suportada",
    ],
    [
      "a conformidade bloqueou",
      {
        tipo: "bloqueou",
        categoria: "triagem",
        camada: "regra",
        motivoDaFalha: null,
      },
      "conformidade",
    ],
  ])(
    "%s (R2): a frase sai e a conversa fica na fila de todos, sem chamar a atribuição",
    async (_nome, desfecho, motivo) => {
      montar({ motor: "responsavel_do_lead", resultado: frase(desfecho) });
      expect(await rodar()).toEqual({ ok: true });
      expect(passagens()).toEqual([
        { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: motivo },
      ]);
      expect(marcas.ordem).toEqual(["passagem", "frase"]);
      expect(frases).toEqual([{ ok: true, messageId: "msg-frase" }]);
      expect(atribuicoes()).toEqual([]);
      expect(conversaDoCenario(banco)).toMatchObject({
        status: "aguardando_humano",
        assignee_user_id: null,
      });
      expect(eventosDoFio(banco)).not.toContain(EVENTO_DA_ANA);
    },
  );

  it("o banco recusa sozinho os motivos da R2 (motivo_nao_atribui), mesmo se o motor chamasse", async () => {
    for (const motivo of [
      "sintoma",
      "assunto_clinico",
      "midia_nao_suportada",
      "conformidade",
      "urgencia",
    ]) {
      montar({ motor: "responsavel_do_lead" });
      banco.linhas("ai_decision_log").push({
        id: "d-r2",
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        job_id: JOB,
        desfecho: motivo === "conformidade" ? "bloqueou" : "escalou",
        escalation_reason: motivo,
      });
      Object.assign(conversaDoCenario(banco), {
        status: "aguardando_humano",
        assignee_user_id: null,
      });
      expect(
        await atribuirConversaPassadaPelaIa(banco.cliente(), {
          clinicId: CLINICA,
          conversationId: CONVERSA,
          jobId: JOB,
          workerId: EXECUTOR,
        }),
        motivo,
      ).toEqual({ tipo: "resposta", codigo: "motivo_nao_atribui" });
      expect(conversaDoCenario(banco).assignee_user_id, motivo).toBeNull();
    }
  });

  it("o teto de respostas (escalarSemModelo): a frase e depois a Ana", async () => {
    montar({ motor: "responsavel_do_lead" });
    for (let i = 0; i < 20; i += 1) {
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
    banco
      .linhas("message")
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "teto_de_respostas" },
    ]);
    expect(marcas.ordem).toEqual(["passagem", "frase", "atribuicao:atribuida"]);
    expect(conversaDoCenario(banco).assignee_user_id).toBe(ANA);
  });

  it("o teto de gasto (escalarSemModelo): a frase e depois a Ana", async () => {
    montar({ motor: "responsavel_do_lead" });
    marcas.reservas = [null];
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "teto_atingido" },
    ]);
    expect(marcas.ordem).toEqual(["passagem", "frase", "atribuicao:atribuida"]);
  });

  it("a falha sem modelo (a exceção do turno, falharSemModelo): a frase e depois a Ana", async () => {
    montar({ motor: "responsavel_do_lead" });
    turno.mockImplementation(async () => {
      throw new Error("excecao inesperada do turno");
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "falha_tecnica" },
    ]);
    expect(marcas.ordem).toEqual(["passagem", "frase", "atribuicao:atribuida"]);
    expect(conversaDoCenario(banco).assignee_user_id).toBe(ANA);
  });

  it("a frase que não saiu (o número caiu no envio): o aviso não enviado e, depois, a Ana (R1.3)", async () => {
    montar({ motor: "responsavel_do_lead" });
    enviarFrase.mockImplementation(async () => {
      marcas.ordem.push("frase");
      return {
        ok: false,
        reason: "desconectado",
        code: "desconectado",
        message: "x",
      };
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(marcas.eventos).toEqual(["aviso_nao_enviado"]);
    expect(marcas.ordem).toEqual(["passagem", "frase", "atribuicao:atribuida"]);
    expect(conversaDoCenario(banco).assignee_user_id).toBe(ANA);
  });

  it("a urgência que o laço achou (a segunda trava): nunca chama a atribuição", async () => {
    montar({
      motor: "responsavel_do_lead",
      resultado: frase({
        tipo: "escalou",
        motivo: "urgencia",
        gatilho: "urgencia",
        origem: "portao",
      }),
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "urgencia" },
    ]);
    expect(atribuicoes()).toEqual([]);
    expect(frases).toEqual([{ ok: true, messageId: "msg-frase" }]);
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
    expect(banco.linhas("conversa_urgente")).toHaveLength(1);
  });

  it("a regra só no motor e o banco com a fila (a versão mudou depois da leitura): chama, e o banco deixa na fila", async () => {
    montar({ motor: "responsavel_do_lead", banco: "fila" });
    expect(await rodar()).toEqual({ ok: true });
    expect(marcas.ordem).toEqual([
      "passagem",
      "frase",
      "atribuicao:regra_fila",
    ]);
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "aguardando_humano",
      assignee_user_id: null,
    });
    expect(eventosDoFio(banco)).not.toContain(EVENTO_DA_ANA);
  });

  it("a regra só no banco e o motor com a fila: o motor nem chama (os dois têm de concordar)", async () => {
    montar({ motor: "fila", banco: "responsavel_do_lead" });
    expect(await rodar()).toEqual({ ok: true });
    expect(atribuicoes()).toEqual([]);
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
  });

  it.each(["PGRST202", "42501"])(
    "a atribuição com o erro %s: o job conclui igual, a conversa na fila, só o código no log",
    async (codigo) => {
      montar({ motor: "responsavel_do_lead" });
      banco.rpc(ATRIBUIR, () => ({ data: null, error: { code: codigo } }));
      expect(await rodar()).toEqual({ ok: true });
      expect(frases).toEqual([{ ok: true, messageId: "msg-frase" }]);
      expect(conversaDoCenario(banco)).toMatchObject({
        status: "aguardando_humano",
        assignee_user_id: null,
      });
      expect(logs.join("")).toContain(`"error_code":"${codigo}"`);
      expect(logs.join("")).toContain('"evento":"ia_atribuicao_falhou"');
    },
  );

  it("a atribuição que lança: o job conclui igual, a conversa na fila", async () => {
    montar({ motor: "responsavel_do_lead" });
    banco.rpc(ATRIBUIR, () => {
      throw new Error("rede");
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(frases).toEqual([{ ok: true, messageId: "msg-frase" }]);
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
  });

  it("sem tempo depois da frase: nem tenta, a fila com o log sem_tempo", async () => {
    montar({ motor: "responsavel_do_lead" });
    let agora = AGORA;
    enviarFrase.mockImplementation(async () => {
      marcas.ordem.push("frase");
      // A frase gastou quase todo o prazo da invocacao.
      agora = AGORA + 54_500;
      return guardaDaFrase();
    });
    expect(await rodar({ agora: () => agora })).toEqual({ ok: true });
    expect(atribuicoes()).toEqual([]);
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
    expect(logs.join("")).toContain('"error_code":"sem_tempo"');
  });
});

describe("AG6a: o banco decide quem recebe (o espelho do contrato R1.2)", () => {
  it.each<[string, string, () => void]>([
    [
      "responsável inativo",
      "responsavel_inapto",
      () => {
        const ana = banco
          .linhas("clinic_member")
          .find((m) => m.user_id === ANA);
        if (ana !== undefined) ana.status = "inativo";
      },
    ],
    [
      "responsável pendente",
      "responsavel_inapto",
      () => {
        const ana = banco
          .linhas("clinic_member")
          .find((m) => m.user_id === ANA);
        if (ana !== undefined) ana.status = "pendente";
      },
    ],
    [
      "responsável Somente leitura",
      "responsavel_inapto",
      () => {
        const ana = banco
          .linhas("clinic_member")
          .find((m) => m.user_id === ANA);
        if (ana !== undefined) ana.role = "leitura";
      },
    ],
    [
      "responsável de outra clínica",
      "responsavel_inapto",
      () => {
        const ana = banco
          .linhas("clinic_member")
          .find((m) => m.user_id === ANA);
        if (ana !== undefined) ana.clinic_id = OUTRA_CLINICA;
      },
    ],
    [
      "sem responsável",
      "sem_responsavel",
      () => {
        const contato = banco.linhas("contact")[0];
        if (contato !== undefined) contato.owner_user_id = null;
      },
    ],
    [
      "a marca de urgência aberta (de uma passagem anterior)",
      "urgente",
      () => {
        banco.linhas("conversa_urgente").push({
          conversation_id: CONVERSA,
          clinic_id: CLINICA,
          desde: "2026-10-13T14:00:00.000Z",
          job_id: "10000000-0000-4000-8000-000000000009",
          encerrada_em: null,
        });
      },
    ],
  ])("%s: a fila (%s)", async (_nome, codigo, mudar) => {
    montar({ motor: "responsavel_do_lead" });
    mudar();
    expect(await rodar()).toEqual({ ok: true });
    expect(frases).toEqual([{ ok: true, messageId: "msg-frase" }]);
    expect(marcas.atribuicoes).toEqual([{ atribuida: false, codigo }]);
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "aguardando_humano",
      assignee_user_id: null,
    });
  });

  it("o profissional responsável recebe (o recorte de Transferir)", async () => {
    montar({ motor: "responsavel_do_lead" });
    const ana = banco.linhas("clinic_member").find((m) => m.user_id === ANA);
    if (ana !== undefined) ana.role = "profissional";
    expect(await rodar()).toEqual({ ok: true });
    expect(conversaDoCenario(banco).assignee_user_id).toBe(ANA);
  });

  it("sem nome no perfil: o evento sem o nome", async () => {
    montar({ motor: "responsavel_do_lead" });
    banco.tabelas.set("profile", []);
    expect(await rodar()).toEqual({ ok: true });
    expect(eventosDoFio(banco)).toContain(
      "A conversa ficou com o responsável pelo lead.",
    );
  });

  it("alguém assumiu entre a frase e a atribuição: nunca rouba (fora_da_fila)", async () => {
    montar({ motor: "responsavel_do_lead" });
    enviarFrase.mockImplementation(async () => {
      marcas.ordem.push("frase");
      const saida = guardaDaFrase();
      // A Bia assume logo depois de a frase sair.
      Object.assign(conversaDoCenario(banco), {
        status: "em_atendimento",
        assignee_user_id: BIA,
      });
      return saida;
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(marcas.ordem).toEqual([
      "passagem",
      "frase",
      "atribuicao:fora_da_fila",
    ]);
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "em_atendimento",
      assignee_user_id: BIA,
    });
    expect(eventosDoFio(banco)).not.toContain(EVENTO_DA_ANA);
  });

  // Revisao R2.2 do contrato do banco: a mensagem do paciente que o job nao
  // leu (desde a criacao do job, fora de ai_turno.mensagens_lidas dele) deixa
  // a conversa na fila de todos (mensagem_nova), entre urgente e regra_fila.
  function mensagemDoPaciente(id: string, criadaEm: string, extra = {}) {
    banco.linhas("message").push({
      id,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      author: "paciente",
      direction: "entrada",
      content_type: "texto",
      body: "oi?",
      media_url: null,
      deleted_at: null,
      is_internal_note: false,
      pelo_celular: false,
      created_at: criadaEm,
      ...extra,
    });
  }

  it("o paciente escreveu entre a frase e a atribuição: a fila (mensagem_nova), só o código no log", async () => {
    montar({ motor: "responsavel_do_lead" });
    enviarFrase.mockImplementation(async () => {
      marcas.ordem.push("frase");
      const saida = guardaDaFrase();
      frases.push(saida);
      mensagemDoPaciente("m2", "2026-10-13T14:59:20.000Z");
      return saida;
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(marcas.ordem).toEqual([
      "passagem",
      "frase",
      "atribuicao:mensagem_nova",
    ]);
    expect(frases).toEqual([{ ok: true, messageId: "msg-frase" }]);
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "aguardando_humano",
      assignee_user_id: null,
    });
    expect(eventosDoFio(banco)).not.toContain(EVENTO_DA_ANA);
    const linha = logs.join("");
    expect(linha).toContain('"status":"mensagem_nova"');
    expect(linha).not.toContain("resposta_fora_do_formato");
    expect(linha).not.toContain("oi?");
  });

  it("a mensagem que chegou durante o turno (o modelo não a viu): a fila (mensagem_nova)", async () => {
    montar({ motor: "responsavel_do_lead" });
    turno.mockImplementation(async () => {
      mensagemDoPaciente("m2", "2026-10-13T14:59:05.000Z");
      return frase(VALOR);
    });
    expect(await rodar()).toEqual({ ok: true });
    // O turno gravou so o que leu (m1); m2 ficou fora das lidas.
    expect(
      banco.linhas("ai_turno").find((t) => t.job_id === JOB)?.mensagens_lidas,
    ).toEqual(["m1"]);
    expect(marcas.atribuicoes).toEqual([
      { atribuida: false, codigo: "mensagem_nova" },
    ]);
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
  });

  it("a mensagem que o job leu, a apagada, a de outra conversa e a de antes do job não contam: a Ana", async () => {
    montar({ motor: "responsavel_do_lead" });
    // Lida pelo job: chegou depois da criacao do job e antes da leitura.
    mensagemDoPaciente("m2", "2026-10-13T14:59:02.000Z");
    // Apagada, depois da criacao do job.
    mensagemDoPaciente("m3", "2026-10-13T14:59:03.000Z", {
      deleted_at: "2026-10-13T14:59:04.000Z",
    });
    // De outra conversa do mesmo contato.
    mensagemDoPaciente("m4", "2026-10-13T14:59:04.000Z", {
      conversation_id: "c0000000-0000-4000-8000-000000000099",
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(
      banco.linhas("ai_turno").find((t) => t.job_id === JOB)?.mensagens_lidas,
    ).toEqual(["m1", "m2"]);
    expect(marcas.ordem).toEqual(["passagem", "frase", "atribuicao:atribuida"]);
    expect(conversaDoCenario(banco).assignee_user_id).toBe(ANA);
  });

  it("a ordem das recusas: urgente antes de mensagem_nova, e mensagem_nova antes de regra_fila", async () => {
    montar({ motor: "responsavel_do_lead", banco: "fila" });
    enviarFrase.mockImplementation(async () => {
      marcas.ordem.push("frase");
      const saida = guardaDaFrase();
      frases.push(saida);
      mensagemDoPaciente("m2", "2026-10-13T14:59:20.000Z");
      return saida;
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(marcas.atribuicoes).toEqual([
      { atribuida: false, codigo: "mensagem_nova" },
    ]);

    montar({ motor: "responsavel_do_lead" });
    banco.linhas("conversa_urgente").push({
      conversation_id: CONVERSA,
      clinic_id: CLINICA,
      desde: "2026-10-13T14:00:00.000Z",
      job_id: "10000000-0000-4000-8000-000000000009",
      encerrada_em: null,
    });
    enviarFrase.mockImplementation(async () => {
      marcas.ordem.push("frase");
      const saida = guardaDaFrase();
      frases.push(saida);
      mensagemDoPaciente("m2", "2026-10-13T14:59:20.000Z");
      return saida;
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(marcas.atribuicoes).toEqual([
      { atribuida: false, codigo: "urgente" },
    ]);
  });

  it("a resposta aprovada que o banco recusou (ia_sem_aprovacao): a frase, e o banco não atribui (sem_passagem, R1.3)", async () => {
    montar({ motor: "responsavel_do_lead", resultado: respondeu() });
    enviarResposta.mockImplementation(async () => ({
      ok: false,
      reason: "falha_envio",
      code: "ia_sem_aprovacao",
      message: "x",
    }));
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "falha_tecnica" },
    ]);
    expect(frases).toEqual([{ ok: true, messageId: "msg-frase" }]);
    expect(marcas.ordem).toEqual([
      "passagem",
      "frase",
      "atribuicao:sem_passagem",
    ]);
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
  });
});

describe("AG6a: as passagens SEM frase, o ja_fora_da_ia e o job antigo nunca atribuem", () => {
  function semAtribuicao() {
    for (const chamada of passagens()) {
      expect(chamada).not.toHaveProperty("p_atribuir");
    }
    expect(atribuicoes()).toEqual([]);
    expect(conversaDoCenario(banco).assignee_user_id).not.toBe(ANA);
  }

  it("liberação perdida", async () => {
    montar({ motor: "responsavel_do_lead" });
    marcas.podeFalar = [false];
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "liberacao_perdida" },
    ]);
    semAtribuicao();
  });

  it("autorização revogada", async () => {
    montar({ motor: "responsavel_do_lead" });
    marcas.consentimento = false;
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()[0]).toMatchObject({ p_motivo: "sem_autorizacao" });
    semAtribuicao();
  });

  it("fora do horário (a retomada no horário só pega conversa sem responsável)", async () => {
    montar({ motor: "responsavel_do_lead" });
    // Terca 12:00, dentro do expediente: no modo "fora do expediente", a IA
    // nao atende agora.
    estado.config = configPublicada({
      regras: PARA_O_RESPONSAVEL,
      horario: {
        modo: "fora_expediente",
        minutosSemResposta: 5,
        expediente: expedientePadrao(),
      },
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()[0]).toMatchObject({ p_motivo: "fora_do_horario" });
    semAtribuicao();
  });

  it("modo de horário não suportado", async () => {
    montar({ motor: "responsavel_do_lead" });
    estado.config = configPublicada({
      regras: PARA_O_RESPONSAVEL,
      horario: {
        modo: "fallback",
        minutosSemResposta: 5,
        expediente: expedientePadrao(),
      },
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()[0]).toMatchObject({ p_motivo: "horario_nao_suportado" });
    semAtribuicao();
  });

  it("a liberação caiu no meio do turno (liberacao_suspensa)", async () => {
    montar({
      motor: "responsavel_do_lead",
      resultado: frase({ tipo: "falhou", motivo: "liberacao_suspensa" }),
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()[0]).toMatchObject({ p_motivo: "liberacao_perdida" });
    semAtribuicao();
    expect(enviarFrase).not.toHaveBeenCalled();
  });

  it.each<
    [
      string,
      Awaited<ReturnType<DependenciasDoExecutorDaIa["enviarResposta"]>>,
      string,
    ]
  >([
    [
      "a autorização revogada no envio",
      { ok: false, reason: "sem_consentimento", message: "x" },
      "sem_autorizacao",
    ],
    [
      "o número desconectado",
      { ok: false, reason: "desconectado", message: "x" },
      "numero_desconectado",
    ],
    [
      "o envio incerto",
      { ok: false, reason: "falha_envio", code: "timeout", message: "x" },
      "envio_incerto",
    ],
  ])("%s", async (_nome, falha, motivo) => {
    montar({ motor: "responsavel_do_lead", resultado: respondeu() });
    enviarResposta.mockImplementation(async () => falha);
    await rodar();
    expect(passagens()[0]).toMatchObject({ p_motivo: motivo });
    semAtribuicao();
  });

  it("alguém tirou a conversa da IA antes da passagem (ja_fora_da_ia): nem frase nem atribuição", async () => {
    montar({ motor: "responsavel_do_lead" });
    banco.aoInserir = (tabela) => {
      if (tabela === "ai_decision_log") {
        // Outro caminho (o desligar, a resposta pelo celular) tirou a
        // conversa da IA, para a fila, entre a decisao e a passagem.
        Object.assign(conversaDoCenario(banco), {
          status: "aguardando_humano",
          assignee_user_id: null,
        });
      }
      return null;
    };
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarFrase).not.toHaveBeenCalled();
    semAtribuicao();
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
  });
});

describe("AG6a: a retomada", () => {
  function decidido(motivo: string) {
    banco.linhas("ai_decision_log").push({
      id: "d1",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      desfecho: "escalou",
      escalation_reason: motivo,
    });
    banco.linhas("ai_turno").push({
      job_id: JOB,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      estado: "decidido",
      reserva_id: null,
      reservas_perdidas: [],
      saida: "frase",
      texto: null,
      texto_sha256: null,
      decision_id: "d1",
      mensagens_lidas: ["m1"],
    });
  }

  /** A tentativa anterior passou e caiu depois de fechar o turno. */
  function passouAntes(e: {
    motivo: string;
    saida: "frase" | "resposta";
    fraseSaiu: boolean;
  }) {
    banco.linhas("ai_decision_log").push({
      id: "d1",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      desfecho: e.saida === "frase" ? "escalou" : "respondeu",
      escalation_reason: e.saida === "frase" ? e.motivo : null,
    });
    banco.linhas("ai_turno").push({
      job_id: JOB,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      estado: "passou_para_equipe",
      reserva_id: null,
      reservas_perdidas: [],
      saida: e.saida,
      texto: null,
      texto_sha256: null,
      decision_id: "d1",
      mensagens_lidas: ["m1"],
    });
    Object.assign(conversaDoCenario(banco), {
      status: "aguardando_humano",
      assignee_user_id: null,
    });
    if (e.fraseSaiu) {
      banco.linhas("message").push({
        id: "msg-frase",
        clinic_id: CLINICA,
        conversation_id: CONVERSA,
        job_id: JOB,
        author: "sistema",
        direction: "saida",
        content_type: "texto",
        body: FRASE_DE_ESCALONAMENTO,
        delivery_status: "enviada",
        media_url: null,
        deleted_at: null,
        is_internal_note: false,
        pelo_celular: false,
        created_at: "2026-10-13T14:59:10.000Z",
      });
    }
  }

  it("em 'decidido' com a regra ligada: passa, a frase e depois a Ana (a regra lida uma vez, depois da frase)", async () => {
    montar({ motor: "responsavel_do_lead" });
    decidido("valor_fora_da_tabela");
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(estado.leituras).toBe(1);
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "valor_fora_da_tabela" },
    ]);
    expect(marcas.ordem).toEqual(["passagem", "frase", "atribuicao:atribuida"]);
    expect(conversaDoCenario(banco).assignee_user_id).toBe(ANA);
  });

  it("em 'decidido', a leitura da regra falhou: a fila (o lado seguro), a frase saiu", async () => {
    montar({ motor: "responsavel_do_lead" });
    decidido("valor_fora_da_tabela");
    estado.falharALeitura = true;
    expect(await rodar()).toEqual({ ok: true });
    expect(atribuicoes()).toEqual([]);
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
    expect(frases).toEqual([{ ok: true, messageId: "msg-frase" }]);
    expect(logs.join("")).toContain("ia_regra_da_passagem_nao_lida");
  });

  it("em 'decidido' com urgência: nem lê a regra, nunca atribui", async () => {
    montar({ motor: "responsavel_do_lead" });
    decidido("urgencia");
    expect(await rodar()).toEqual({ ok: true });
    expect(estado.leituras).toBe(0);
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "urgencia" },
    ]);
    expect(atribuicoes()).toEqual([]);
    expect(banco.linhas("conversa_urgente")).toHaveLength(1);
  });

  it("em 'decidido', a passagem da tentativa anterior já aconteceu (ja_fora_da_ia): o aviso, sem atribuição", async () => {
    montar({ motor: "responsavel_do_lead" });
    decidido("valor_fora_da_tabela");
    Object.assign(conversaDoCenario(banco), {
      status: "aguardando_humano",
      assignee_user_id: null,
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(marcas.eventos).toEqual(["aviso_nao_enviado"]);
    expect(atribuicoes()).toEqual([]);
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
  });

  it("em 'passou_para_equipe' com a frase que saiu: a atribuição que a tentativa anterior não fez", async () => {
    montar({ motor: "responsavel_do_lead" });
    passouAntes({
      motivo: "valor_fora_da_tabela",
      saida: "frase",
      fraseSaiu: true,
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()).toEqual([]);
    expect(enviarFrase).not.toHaveBeenCalled();
    expect(marcas.eventos).toEqual([]);
    expect(atribuicoes()).toEqual([{ p_job_id: JOB, p_worker: EXECUTOR }]);
    expect(conversaDoCenario(banco).assignee_user_id).toBe(ANA);
    expect(eventosDoFio(banco)).toEqual([EVENTO_DA_ANA]);
  });

  it("em 'passou_para_equipe' sem a frase deste job: o aviso não enviado e nada de atribuição", async () => {
    montar({ motor: "responsavel_do_lead" });
    passouAntes({
      motivo: "valor_fora_da_tabela",
      saida: "frase",
      fraseSaiu: false,
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(marcas.eventos).toEqual(["aviso_nao_enviado"]);
    expect(atribuicoes()).toEqual([]);
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
  });

  it("em 'passou_para_equipe' com a urgência: nunca atribui", async () => {
    montar({ motor: "responsavel_do_lead" });
    passouAntes({ motivo: "urgencia", saida: "frase", fraseSaiu: true });
    expect(await rodar()).toEqual({ ok: true });
    expect(atribuicoes()).toEqual([]);
    expect(estado.leituras).toBe(0);
  });

  it("em 'passou_para_equipe' com a saída 'resposta' (a retomada recusada, sem frase): nunca atribui", async () => {
    montar({ motor: "responsavel_do_lead" });
    passouAntes({
      motivo: "valor_fora_da_tabela",
      saida: "resposta",
      fraseSaiu: true,
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(atribuicoes()).toEqual([]);
  });

  it("em 'passou_para_equipe', o motivo não lido: a fila, só o log", async () => {
    montar({ motor: "responsavel_do_lead" });
    passouAntes({
      motivo: "valor_fora_da_tabela",
      saida: "frase",
      fraseSaiu: true,
    });
    banco.erros.set("ai_decision_log:select", { code: "57014" });
    expect(await rodar()).toEqual({ ok: true });
    expect(atribuicoes()).toEqual([]);
    expect(logs.join("")).toContain('"error_code":"motivo_nao_lido"');
  });
});
