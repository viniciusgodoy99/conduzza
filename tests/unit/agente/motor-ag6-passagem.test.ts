import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ClienteDoAgente, ResultadoDoTurno } from "@/lib/agente/laco";
import { passarParaAEquipe } from "@/lib/agente/whatsapp";
import {
  configPadraoDoAgente,
  expedientePadrao,
  TEXTO_DO_EVENTO_DA_IA,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { DependenciasDoExecutorDaIa } from "@/lib/jobs/responder-com-ia";
import type { Job } from "@/lib/jobs/worker";

import { BancoEmMemoria } from "../ia-whatsapp/banco-em-memoria";
import { aprovarParaTeste } from "../ia-whatsapp/texto-aprovado-de-teste";
import {
  AGORA,
  ANA,
  bancoDaAg6,
  BIA,
  CLINICA,
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
// construidas com a recomendacao): o motor pede (p_atribuir) so na passagem
// COM a frase (passarEAvisar: o turno que escalou, bloqueou ou falhou, os
// tetos e a falha sem modelo) e so com a regra "responsavel_do_lead" na
// versao publicada que ele leu; nunca na urgencia, no fora do horario nem nas
// passagens sem frase. O banco decide de novo (a ultima publicada, o
// responsavel ativo com papel que atende, nunca rouba). A retomada le a
// regra na hora; leitura que falha e a fila. O retorno novo da passagem:
// {resultado, atribuida, urgente}. Nenhum teste chama a OpenAI.

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

let banco: BancoEmMemoria;
let marcas: {
  podeFalar: boolean[];
  consentimento: boolean;
  reservas: (string | null)[];
  eventos: string[];
  respostas: Record<string, unknown>[];
};
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
 * O cenario: `motor` e a regra da versao que o executor le; `banco` a da
 * ultima publicada que a passagem confere.
 */
function montar(
  e: {
    motor?: "fila" | "responsavel_do_lead";
    banco?: "fila" | "responsavel_do_lead";
    resultado?: ResultadoDoTurno;
  } = {},
) {
  banco = new BancoEmMemoria();
  marcas = {
    podeFalar: [],
    consentimento: true,
    reservas: [],
    eventos: [],
    respostas: [],
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
  enviarFrase = vi.fn<DependenciasDoExecutorDaIa["enviarFrase"]>(async () => ({
    ok: true,
    messageId: "msg-frase",
  }));
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
});

describe("passarParaAEquipe: o pedido e o retorno novo", () => {
  function bancoQueResponde(data: unknown, erro: string | null = null) {
    const b = new BancoEmMemoria();
    b.rpc("passar_conversa_da_ia_para_equipe", () => ({
      data,
      error: erro === null ? null : { code: erro },
    }));
    return b;
  }
  const BASE = { clinicId: CLINICA, jobId: JOB, workerId: EXECUTOR };

  it("sem pedir: os três parâmetros de antes; a resposta de antes da migration lê os dois falsos", async () => {
    const b = bancoQueResponde({ passou: true, codigo: "passou" });
    expect(
      await passarParaAEquipe(b.cliente(), {
        ...BASE,
        motivo: "valor_fora_da_tabela",
      }),
    ).toEqual({ resultado: "passou", atribuida: false, urgente: false });
    expect(b.chamadasDe("passar_conversa_da_ia_para_equipe")).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "valor_fora_da_tabela" },
    ]);
  });

  it("pedindo: p_atribuir e o que o banco fez", async () => {
    const b = bancoQueResponde({
      passou: true,
      codigo: "passou",
      urgente: false,
      atribuida: true,
    });
    expect(
      await passarParaAEquipe(b.cliente(), {
        ...BASE,
        motivo: "valor_fora_da_tabela",
        atribuir: true,
      }),
    ).toEqual({ resultado: "passou", atribuida: true, urgente: false });
    expect(b.chamadasDe("passar_conversa_da_ia_para_equipe")).toEqual([
      {
        p_job_id: JOB,
        p_worker: EXECUTOR,
        p_motivo: "valor_fora_da_tabela",
        p_atribuir: true,
      },
    ]);
    expect(logs.join("")).toContain('"kind":"atribuida"');
  });

  it.each(["urgencia", "fora_do_horario"] as const)(
    "%s nunca leva p_atribuir, mesmo pedido",
    async (motivo) => {
      const b = bancoQueResponde({
        passou: true,
        codigo: "passou",
        urgente: motivo === "urgencia",
        atribuida: false,
      });
      expect(
        await passarParaAEquipe(b.cliente(), {
          ...BASE,
          motivo,
          atribuir: true,
        }),
      ).toEqual({
        resultado: "passou",
        atribuida: false,
        urgente: motivo === "urgencia",
      });
      expect(b.chamadasDe("passar_conversa_da_ia_para_equipe")).toEqual([
        { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: motivo },
      ]);
    },
  );

  it.each([
    [
      { passou: false, codigo: "sem_posse", urgente: false, atribuida: false },
      "sem_posse",
    ],
    [
      { passou: false, codigo: "job_antigo", urgente: false, atribuida: false },
      "job_antigo",
    ],
    [
      {
        passou: false,
        codigo: "ja_fora_da_ia",
        urgente: false,
        atribuida: false,
      },
      "ja_fora_da_ia",
    ],
    [null, "ja_fora_da_ia"],
  ] as const)(
    "recusa %j: %s, sem marca nem atribuição",
    async (data, resultado) => {
      const b = bancoQueResponde(data);
      expect(
        await passarParaAEquipe(b.cliente(), {
          ...BASE,
          motivo: "sintoma",
          atribuir: true,
        }),
      ).toEqual({ resultado, atribuida: false, urgente: false });
    },
  );

  it("erro do banco e exceção: erro (o job tenta de novo)", async () => {
    const b = bancoQueResponde(null, "PGRST202");
    expect(
      await passarParaAEquipe(b.cliente(), { ...BASE, motivo: "sintoma" }),
    ).toEqual({ resultado: "erro", atribuida: false, urgente: false });
    const lanca = new BancoEmMemoria();
    lanca.rpc("passar_conversa_da_ia_para_equipe", () => {
      throw new Error("rede");
    });
    expect(
      await passarParaAEquipe(lanca.cliente(), { ...BASE, motivo: "sintoma" }),
    ).toEqual({ resultado: "erro", atribuida: false, urgente: false });
  });

  it("o banco atribuiu sem o pedido (nunca deveria): fica o aviso no log, só com códigos", async () => {
    const b = bancoQueResponde({
      passou: true,
      codigo: "passou",
      urgente: false,
      atribuida: true,
    });
    expect(
      await passarParaAEquipe(b.cliente(), { ...BASE, motivo: "sintoma" }),
    ).toEqual({ resultado: "passou", atribuida: true, urgente: false });
    expect(logs.join("")).toContain("ia_passagem_incoerente");
  });
});

describe("AG6a: a passagem COM a frase pede a atribuição só com a regra ligada", () => {
  it("fila (o padrão): os três parâmetros de antes e a conversa na fila", async () => {
    montar();
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "valor_fora_da_tabela" },
    ]);
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "aguardando_humano",
      assignee_user_id: null,
    });
    expect(eventosDoFio(banco)).toEqual([
      TEXTO_DO_EVENTO_DA_IA.valor_fora_da_tabela,
    ]);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
  });

  it("responsável do lead: a conversa fica com a Ana, com o evento do nome (D-55)", async () => {
    montar({ motor: "responsavel_do_lead" });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()).toEqual([
      {
        p_job_id: JOB,
        p_worker: EXECUTOR,
        p_motivo: "valor_fora_da_tabela",
        p_atribuir: true,
      },
    ]);
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "em_atendimento",
      assignee_user_id: ANA,
    });
    expect(eventosDoFio(banco)).toEqual([
      TEXTO_DO_EVENTO_DA_IA.valor_fora_da_tabela,
      EVENTO_DA_ANA,
    ]);
    expect(banco.linhas("conversa_urgente")).toEqual([]);
    // A frase e tentada como em toda passagem com frase (a guarda do envio
    // de verdade e do banco; ver o relatorio da AG6a).
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    expect(logs.join("")).toContain('"kind":"atribuida"');
  });

  it.each<[string, ResultadoDoTurno["desfecho"]]>([
    [
      "sintoma pelo portão",
      {
        tipo: "escalou",
        motivo: "sintoma",
        gatilho: "sintoma",
        origem: "portao",
      },
    ],
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
      "a conformidade bloqueou",
      {
        tipo: "bloqueou",
        categoria: "triagem",
        camada: "regra",
        motivoDaFalha: null,
      },
    ],
    ["falha técnica do turno", { tipo: "falhou", motivo: "desconhecida" }],
  ])("%s: pede (é passagem com a frase)", async (_nome, desfecho) => {
    montar({ motor: "responsavel_do_lead", resultado: frase(desfecho) });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()[0]).toMatchObject({ p_atribuir: true });
    expect(conversaDoCenario(banco).assignee_user_id).toBe(ANA);
  });

  it("o teto de respostas (escalarSemModelo): pede", async () => {
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
      {
        p_job_id: JOB,
        p_worker: EXECUTOR,
        p_motivo: "teto_de_respostas",
        p_atribuir: true,
      },
    ]);
    expect(conversaDoCenario(banco).assignee_user_id).toBe(ANA);
  });

  it("o teto de gasto (escalarSemModelo): pede", async () => {
    montar({ motor: "responsavel_do_lead" });
    marcas.reservas = [null];
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()).toEqual([
      {
        p_job_id: JOB,
        p_worker: EXECUTOR,
        p_motivo: "teto_atingido",
        p_atribuir: true,
      },
    ]);
  });

  it("a falha sem modelo (a exceção do turno, falharSemModelo): pede", async () => {
    montar({ motor: "responsavel_do_lead" });
    turno.mockImplementation(async () => {
      throw new Error("excecao inesperada do turno");
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()).toEqual([
      {
        p_job_id: JOB,
        p_worker: EXECUTOR,
        p_motivo: "falha_tecnica",
        p_atribuir: true,
      },
    ]);
    expect(conversaDoCenario(banco).assignee_user_id).toBe(ANA);
  });

  it("a urgência que o laço achou (a segunda trava): nunca pede", async () => {
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
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
    expect(banco.linhas("conversa_urgente")).toHaveLength(1);
  });

  it("a regra só no motor e o banco com a fila (a versão mudou depois da leitura): a fila", async () => {
    montar({ motor: "responsavel_do_lead", banco: "fila" });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()[0]).toMatchObject({ p_atribuir: true });
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "aguardando_humano",
      assignee_user_id: null,
    });
    expect(eventosDoFio(banco)).not.toContain(EVENTO_DA_ANA);
  });

  it("a regra só no banco e o motor com a fila: não pede (os dois têm de concordar)", async () => {
    montar({ motor: "fila", banco: "responsavel_do_lead" });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()[0]).not.toHaveProperty("p_atribuir");
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
  });
});

describe("AG6a: o banco decide quem recebe (o espelho do contrato)", () => {
  it.each<[string, () => void]>([
    [
      "responsável inativo",
      () => {
        const ana = banco
          .linhas("clinic_member")
          .find((m) => m.user_id === ANA);
        if (ana !== undefined) ana.status = "inativo";
      },
    ],
    [
      "responsável pendente",
      () => {
        const ana = banco
          .linhas("clinic_member")
          .find((m) => m.user_id === ANA);
        if (ana !== undefined) ana.status = "pendente";
      },
    ],
    [
      "responsável Somente leitura",
      () => {
        const ana = banco
          .linhas("clinic_member")
          .find((m) => m.user_id === ANA);
        if (ana !== undefined) ana.role = "leitura";
      },
    ],
    [
      "responsável de outra clínica",
      () => {
        const ana = banco
          .linhas("clinic_member")
          .find((m) => m.user_id === ANA);
        if (ana !== undefined) ana.clinic_id = OUTRA_CLINICA;
      },
    ],
    [
      "sem responsável",
      () => {
        const contato = banco.linhas("contact")[0];
        if (contato !== undefined) contato.owner_user_id = null;
      },
    ],
  ])("%s: a fila", async (_nome, mudar) => {
    montar({ motor: "responsavel_do_lead" });
    mudar();
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()[0]).toMatchObject({ p_atribuir: true });
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "aguardando_humano",
      assignee_user_id: null,
    });
    expect(marcas.respostas).toEqual([
      { passou: true, codigo: "passou", urgente: false, atribuida: false },
    ]);
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

  it("alguém assumiu no meio: nunca rouba", async () => {
    montar({ motor: "responsavel_do_lead" });
    const original = banco.manipuladores.get(
      "passar_conversa_da_ia_para_equipe",
    );
    banco.rpc("passar_conversa_da_ia_para_equipe", async (args) => {
      // A Bia assume no instante entre a passagem e a atribuicao: o espelho
      // roda a passagem e, antes do update condicional, a conversa ja e dela.
      const conversa = conversaDoCenario(banco);
      const resposta = await (original?.({ ...args, p_atribuir: false }) ?? {
        data: null,
        error: null,
      });
      Object.assign(conversa, {
        status: "em_atendimento",
        assignee_user_id: BIA,
      });
      return resposta;
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(conversaDoCenario(banco)).toMatchObject({
      status: "em_atendimento",
      assignee_user_id: BIA,
    });
    expect(eventosDoFio(banco)).not.toContain(EVENTO_DA_ANA);
  });
});

describe("AG6a: as passagens SEM frase nunca pedem", () => {
  function semPedido() {
    for (const chamada of passagens()) {
      expect(chamada).not.toHaveProperty("p_atribuir");
    }
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
  }

  it("liberação perdida", async () => {
    montar({ motor: "responsavel_do_lead" });
    marcas.podeFalar = [false];
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "liberacao_perdida" },
    ]);
    semPedido();
  });

  it("autorização revogada", async () => {
    montar({ motor: "responsavel_do_lead" });
    marcas.consentimento = false;
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()[0]).toMatchObject({ p_motivo: "sem_autorizacao" });
    semPedido();
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
    semPedido();
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
    semPedido();
  });

  it("a liberação caiu no meio do turno (liberacao_suspensa)", async () => {
    montar({
      motor: "responsavel_do_lead",
      resultado: frase({ tipo: "falhou", motivo: "liberacao_suspensa" }),
    });
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()[0]).toMatchObject({ p_motivo: "liberacao_perdida" });
    semPedido();
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
    semPedido();
  });
});

describe("AG6a: a retomada lê a regra na hora", () => {
  function decidido(motivo: string) {
    banco.linhas("ai_decision_log").push({
      id: "d1",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
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

  it("com a regra ligada na publicada: pede, e a conversa fica com a Ana", async () => {
    montar({ motor: "responsavel_do_lead" });
    decidido("valor_fora_da_tabela");
    expect(await rodar()).toEqual({ ok: true });
    expect(turno).not.toHaveBeenCalled();
    expect(estado.leituras).toBe(1);
    expect(passagens()).toEqual([
      {
        p_job_id: JOB,
        p_worker: EXECUTOR,
        p_motivo: "valor_fora_da_tabela",
        p_atribuir: true,
      },
    ]);
    expect(conversaDoCenario(banco).assignee_user_id).toBe(ANA);
    expect(enviarFrase).toHaveBeenCalledTimes(1);
  });

  it("a leitura da regra falhou: a fila (o lado seguro), a passagem e a frase seguem", async () => {
    montar({ motor: "responsavel_do_lead" });
    decidido("valor_fora_da_tabela");
    estado.falharALeitura = true;
    expect(await rodar()).toEqual({ ok: true });
    expect(passagens()[0]).not.toHaveProperty("p_atribuir");
    expect(conversaDoCenario(banco).assignee_user_id).toBeNull();
    expect(enviarFrase).toHaveBeenCalledTimes(1);
    expect(logs.join("")).toContain("ia_regra_da_passagem_nao_lida");
  });

  it("a retomada da urgência nem lê a regra (nunca atribui)", async () => {
    montar({ motor: "responsavel_do_lead" });
    decidido("urgencia");
    expect(await rodar()).toEqual({ ok: true });
    expect(estado.leituras).toBe(0);
    expect(passagens()).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR, p_motivo: "urgencia" },
    ]);
    expect(banco.linhas("conversa_urgente")).toHaveLength(1);
  });
});
