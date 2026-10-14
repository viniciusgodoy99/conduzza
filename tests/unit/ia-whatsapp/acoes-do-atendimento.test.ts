import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BancoEmMemoria } from "./banco-em-memoria";

// As acoes do Atendimento do E3: Devolver para a IA (a elegibilidade do
// botao e a devolucao), com o banco decidindo (ia_devolver_disponivel e
// devolver_para_ia, com a sessao), e a leitura do rascunho bloqueado, so
// para o super admin ate o dono decidir (D25). Erros do banco viram texto
// de recepcionista (contrato 4.4); nada vai a log alem de ids e codigos.

const TESTE123 = "acd9c539-585e-4f2a-a195-712c70099564";
const FORA_DA_LISTA = "682edca6-cc7d-4bb7-8db6-4c68e2510549";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const DECISAO = "d0000000-0000-4000-8000-000000000001";
const USUARIO = "97777777-7777-4777-8777-777777777777";

const estado = vi.hoisted(() => ({
  banco: null as unknown,
  admin: null as unknown,
  sessao: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    (estado.banco as { cliente: () => unknown }).cliente(),
}));
// A service role so le o motor da IA (situacao_da_ia_na_clinica.motor_parado:
// o B8 tira os detalhes da IA da sessao comum e a recepcao nao le a
// situacao); todo o resto e pela sessao.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    (estado.admin as { cliente: () => unknown }).cliente(),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => estado.sessao,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  devolverParaIaAction,
  elegibilidadeDoDevolverAction,
  lerRascunhoBloqueadoAction,
} = await import("@/app/(app)/atendimento/actions");

let banco: BancoEmMemoria;
let admin: BancoEmMemoria;
let motorParado: boolean | "erro";
let consentimento: boolean | "erro";

/** O ambiente da IA de pe (T1): producao, chave e segredo do identificador. */
function ambienteLigado() {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("OPENAI_API_KEY", "chave-de-mentira");
  vi.stubEnv("IA_SEGREDO_DO_IDENTIFICADOR", "s".repeat(40));
}

/** Expediente aberto o dia todo, todos os dias. */
function expedienteOTempoTodo() {
  const dia = { aberto: true, inicio: "00:00", fim: "23:59" };
  return {
    dom: dia,
    seg: dia,
    ter: dia,
    qua: dia,
    qui: dia,
    sex: dia,
    sab: dia,
  };
}

function sessao(
  extra: { papel?: string; clinica?: string; superAdmin?: boolean } = {},
) {
  return {
    userId: USUARIO,
    isProductAdmin: extra.superAdmin === true,
    active: {
      clinicId: extra.clinica ?? TESTE123,
      role: extra.papel ?? "recepcao",
      status: "ativo",
      timezone: "America/Fortaleza",
    },
  };
}

beforeEach(() => {
  banco = new BancoEmMemoria();
  estado.banco = banco;
  estado.sessao = sessao();
  banco.linhas("conversation").push({
    id: CONVERSA,
    clinic_id: TESTE123,
    contact_id: "contato",
    status: "em_atendimento",
    assignee_user_id: USUARIO,
    whatsapp_account_id: "numero",
  });
  // O que o executor exige e o banco nao ve (revisao do E3): o ambiente, o
  // motor, a versao publicada que atende agora e o numero conectado.
  ambienteLigado();
  banco.linhas("ai_agent_config").push({
    clinic_id: TESTE123,
    status: "publicada",
    version: 2,
    operating_mode: "24h",
    fallback_minutes: 5,
    operating_hours: {},
  });
  banco.linhas("whatsapp_account").push({
    id: "numero",
    clinic_id: TESTE123,
    connection_status: "conectado",
    removido_em: null,
  });
  admin = new BancoEmMemoria();
  estado.admin = admin;
  motorParado = false;
  admin.rpc("situacao_da_ia_na_clinica", () =>
    motorParado === "erro"
      ? { data: null, error: { code: "57014" } }
      : {
          data: { teto_atingido: false, motor_parado: motorParado },
          error: null,
        },
  );
  // A autorizacao do contato (consentimento_vigente) e o teto de respostas
  // da conversa, pela service role (conferencia N1 e N2 da revisao).
  consentimento = true;
  admin.rpc("consentimento_vigente", () =>
    consentimento === "erro"
      ? { data: null, error: { code: "57014" } }
      : { data: consentimento, error: null },
  );
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("elegibilidadeDoDevolverAction", () => {
  it("fora das duas clínicas: fora_da_fase sem ir ao banco", async () => {
    estado.sessao = sessao({ clinica: FORA_DA_LISTA });
    expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
      ok: true,
      pode: false,
      motivo: "fora_da_fase",
    });
    expect(banco.chamadas).toEqual([]);
  });

  it("pode: devolve pode; motivo do banco: devolve o motivo", async () => {
    banco.rpc("ia_devolver_disponivel", () => ({
      data: { pode: true, motivo: null },
      error: null,
    }));
    expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
      ok: true,
      pode: true,
    });
    expect(banco.chamadasDe("ia_devolver_disponivel")).toEqual([
      { p_conversation_id: CONVERSA },
    ]);
    for (const motivo of [
      "sem_permissao",
      "nao_e_sua",
      "pergunta_pendente",
      "assistente_desligado",
      "nao_liberada",
      "contato_de_paciente",
      "nao_disponivel",
    ]) {
      banco.rpc("ia_devolver_disponivel", () => ({
        data: { pode: false, motivo },
        error: null,
      }));
      expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
        ok: true,
        pode: false,
        motivo,
      });
    }
  });

  it("erro de leitura ou resposta estranha: o texto de conferir de novo", async () => {
    banco.rpc("ia_devolver_disponivel", () => ({
      data: null,
      error: { code: "P0002", message: "conversa_nao_encontrada" },
    }));
    expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
      ok: false,
      error: "Não foi possível conferir agora. Tente de novo.",
    });
    banco.rpc("ia_devolver_disponivel", () => ({
      data: { pode: false, motivo: "outro" },
      error: null,
    }));
    expect(await elegibilidadeDoDevolverAction(CONVERSA)).toMatchObject({
      ok: false,
    });
  });

  it("sem sessão e id inválido: recusa sem banco", async () => {
    expect(await elegibilidadeDoDevolverAction("nao-e-uuid")).toMatchObject({
      ok: false,
    });
    estado.sessao = null;
    expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
      ok: false,
      error: "Sessão expirada. Entre de novo.",
    });
    expect(banco.chamadas).toEqual([]);
  });
});

describe("devolverParaIaAction", () => {
  it("sucesso: uma RPC com a sessão, sem revalidar", async () => {
    banco.rpc("devolver_para_ia", () => ({ data: { ok: true }, error: null }));
    expect(await devolverParaIaAction(CONVERSA)).toEqual({ ok: true });
    expect(banco.chamadasDe("devolver_para_ia")).toEqual([
      { p_conversation_id: CONVERSA },
    ]);
    const { revalidatePath } = await import("next/cache");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [
      "42501",
      "sem_permissao",
      "Você não pode devolver esta conversa para a IA.",
    ],
    [
      "42501",
      "fora_da_fase",
      "Você não pode devolver esta conversa para a IA.",
    ],
    ["42501", "nao_liberada", "Esta conversa não pode voltar para a IA agora."],
    [
      "42501",
      "contato_de_paciente",
      "Esta conversa não pode voltar para a IA agora.",
    ],
    [
      "CZ409",
      "conversa_mudou",
      "A conversa mudou enquanto você devolvia. Atualize e tente de novo.",
    ],
    [
      "P0002",
      "conversa_nao_encontrada",
      "Conversa não encontrada. Atualize a lista.",
    ],
    [
      "XX000",
      "qualquer",
      "Não foi possível devolver a conversa para a IA. Tente de novo.",
    ],
  ])("erro %s %s: o texto de recepcionista", async (code, message, texto) => {
    banco.rpc("devolver_para_ia", () => ({
      data: null,
      error: { code, message },
    }));
    expect(await devolverParaIaAction(CONVERSA)).toEqual({
      ok: false,
      error: texto,
    });
  });

  it("papel leitura: recusado antes do banco", async () => {
    estado.sessao = sessao({ papel: "leitura" });
    const r = await devolverParaIaAction(CONVERSA);
    expect(r.ok).toBe(false);
    expect(banco.chamadasDe("devolver_para_ia")).toEqual([]);
  });
});

// Revisao do E3 (T1): o Devolver nao promete resposta quando o assistente
// nao responderia (ambiente, motor, horario agora, numero desconectado).
describe("Devolver só quando o assistente responderia", () => {
  function bancoDiz(pode = true) {
    banco.rpc("ia_devolver_disponivel", () => ({
      data: pode
        ? { pode: true, motivo: null }
        : { pode: false, motivo: "nao_e_sua" },
      error: null,
    }));
  }

  function publicada(campos: Record<string, unknown>) {
    Object.assign(banco.linhas("ai_agent_config")[0]!, campos);
  }

  it("tudo de pé: pode", async () => {
    bancoDiz();
    expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
      ok: true,
      pode: true,
    });
    expect(admin.chamadasDe("situacao_da_ia_na_clinica")).toEqual([
      { p_clinic_id: TESTE123 },
    ]);
  });

  it("o motivo do banco vem antes (nada a mais é lido)", async () => {
    bancoDiz(false);
    expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
      ok: true,
      pode: false,
      motivo: "nao_e_sua",
    });
    expect(admin.chamadas).toEqual([]);
  });

  it.each([
    [
      "sem o segredo do identificador (T1)",
      () => vi.stubEnv("IA_SEGREDO_DO_IDENTIFICADOR", ""),
    ],
    ["fora da produção", () => vi.stubEnv("VERCEL_ENV", "preview")],
    ["motor da IA parado", () => (motorParado = true)],
    [
      "modo de horário que não funciona no WhatsApp",
      () => publicada({ operating_mode: "fallback" }),
    ],
  ])(
    "assistente parado (%s): administrador vê o motivo, a recepção o genérico",
    async (_caso, parar) => {
      bancoDiz();
      parar();
      estado.sessao = sessao({ papel: "admin" });
      expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
        ok: true,
        pode: false,
        motivo: "assistente_parado",
      });
      estado.sessao = sessao({ papel: "recepcao" });
      expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
        ok: true,
        pode: false,
        motivo: "nao_disponivel",
      });
      estado.sessao = sessao({ papel: "recepcao", superAdmin: true });
      expect(await elegibilidadeDoDevolverAction(CONVERSA)).toMatchObject({
        motivo: "assistente_parado",
      });
    },
  );

  it("fora do horário escolhido agora (no fuso da clínica): fora_do_horario, para todos os papéis", async () => {
    bancoDiz();
    // Terca, 13/10/2026, 12:00 em Fortaleza; expediente o dia todo e o
    // assistente so fora do expediente.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T15:00:00.000Z"));
    publicada({
      operating_mode: "fora_expediente",
      operating_hours: expedienteOTempoTodo(),
    });
    for (const papel of ["admin", "recepcao"]) {
      estado.sessao = sessao({ papel });
      expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
        ok: true,
        pode: false,
        motivo: "fora_do_horario",
      });
    }
  });

  it.each([
    ["desconectado", { connection_status: "desconectado" }],
    ["removido", { removido_em: "2026-10-13T00:00:00.000Z" }],
  ])(
    "número %s: numero_desconectado, para todos os papéis",
    async (_caso, campos) => {
      bancoDiz();
      Object.assign(banco.linhas("whatsapp_account")[0]!, campos);
      for (const papel of ["admin", "recepcao"]) {
        estado.sessao = sessao({ papel });
        expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
          ok: true,
          pode: false,
          motivo: "numero_desconectado",
        });
      }
    },
  );

  it.each([
    ["o motor da IA", () => (motorParado = "erro")],
    [
      "a versão publicada",
      () => banco.erros.set("ai_agent_config:select", { code: "08006" }),
    ],
    [
      "o número",
      () => banco.erros.set("whatsapp_account:select", { code: "08006" }),
    ],
  ])(
    "leitura de %s que falha: não conferido (nunca habilita)",
    async (_caso, quebrar) => {
      bancoDiz();
      quebrar();
      expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
        ok: false,
        error: "Não foi possível conferir agora. Tente de novo.",
      });
    },
  );

  it("contato que revogou a autorização para receber mensagens: sem_autorizacao, para todos os papéis (o executor passaria sem responder)", async () => {
    bancoDiz();
    consentimento = false;
    for (const papel of ["admin", "recepcao"]) {
      estado.sessao = sessao({ papel });
      expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
        ok: true,
        pode: false,
        motivo: "sem_autorizacao",
      });
    }
    expect(admin.chamadasDe("consentimento_vigente")).toContainEqual({
      p_clinic_id: TESTE123,
      p_contact_id: "contato",
      p_channel: "whatsapp",
    });
    banco.rpc("devolver_para_ia", () => ({ data: { ok: true }, error: null }));
    expect(await devolverParaIaAction(CONVERSA)).toEqual({
      ok: false,
      error: "Esta conversa não pode voltar para a IA agora.",
    });
    expect(banco.chamadasDe("devolver_para_ia")).toEqual([]);
  });

  it("conversa no teto de respostas da IA na última hora: teto_de_respostas, para todos os papéis (o executor escalaria de novo)", async () => {
    bancoDiz();
    admin.linhas("ia_liberacao").push({
      clinic_id: TESTE123,
      teto_respostas_por_conversa_hora: 20,
    });
    const agora = Date.now();
    for (let i = 0; i < 20; i++) {
      admin.linhas("message").push({
        id: `ia-${i}`,
        clinic_id: TESTE123,
        conversation_id: CONVERSA,
        author: "ia",
        created_at: new Date(agora - (i + 1) * 60_000).toISOString(),
      });
    }
    for (const papel of ["admin", "recepcao"]) {
      estado.sessao = sessao({ papel });
      expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
        ok: true,
        pode: false,
        motivo: "teto_de_respostas",
      });
    }
    // Uma resposta saiu da janela de uma hora: abaixo do teto, pode.
    admin.linhas("message")[19]!.created_at = new Date(
      agora - 2 * 60 * 60_000,
    ).toISOString();
    expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
      ok: true,
      pode: true,
    });
  });

  it.each([
    ["a autorização do contato", () => (consentimento = "erro")],
    [
      "o teto de respostas",
      () => admin.erros.set("ia_liberacao:select", { code: "08006" }),
    ],
    [
      "as respostas da IA na conversa",
      () => {
        admin.linhas("ia_liberacao").push({
          clinic_id: TESTE123,
          teto_respostas_por_conversa_hora: 20,
        });
        admin.erros.set("message:select", { code: "08006" });
      },
    ],
  ])(
    "leitura de %s que falha: não conferido (nunca habilita)",
    async (_caso, quebrar) => {
      bancoDiz();
      quebrar();
      expect(await elegibilidadeDoDevolverAction(CONVERSA)).toEqual({
        ok: false,
        error: "Não foi possível conferir agora. Tente de novo.",
      });
    },
  );

  it("devolverParaIaAction faz a mesma conferência antes de gravar: parado recusa, não conferido pede de novo", async () => {
    banco.rpc("devolver_para_ia", () => ({ data: { ok: true }, error: null }));
    motorParado = true;
    expect(await devolverParaIaAction(CONVERSA)).toEqual({
      ok: false,
      error: "Esta conversa não pode voltar para a IA agora.",
    });
    motorParado = "erro";
    expect(await devolverParaIaAction(CONVERSA)).toEqual({
      ok: false,
      error: "Não foi possível conferir agora. Tente de novo.",
    });
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await devolverParaIaAction(CONVERSA)).toEqual({
      ok: false,
      error: "Esta conversa não pode voltar para a IA agora.",
    });
    expect(banco.chamadasDe("devolver_para_ia")).toEqual([]);
  });
});

describe("lerRascunhoBloqueadoAction", () => {
  it("quem não é super admin: a dica, sem banco (D25)", async () => {
    for (const papel of ["admin", "gestor", "recepcao"]) {
      estado.sessao = sessao({ papel });
      expect(await lerRascunhoBloqueadoAction(DECISAO)).toEqual({
        ok: false,
        error: "Só a equipe Conduzza vê o rascunho bloqueado.",
      });
    }
    expect(banco.chamadas).toEqual([]);
  });

  it("super admin: lê pela RPC; vazio quando a retenção apagou", async () => {
    estado.sessao = sessao({ superAdmin: true });
    banco.rpc("ler_rascunho_bloqueado", () => ({
      data: { texto: "rascunho" },
      error: null,
    }));
    expect(await lerRascunhoBloqueadoAction(DECISAO)).toEqual({
      ok: true,
      texto: "rascunho",
    });
    expect(banco.chamadasDe("ler_rascunho_bloqueado")).toEqual([
      { p_decision_id: DECISAO },
    ]);
    banco.rpc("ler_rascunho_bloqueado", () => ({
      data: { texto: null },
      error: null,
    }));
    expect(await lerRascunhoBloqueadoAction(DECISAO)).toEqual({
      ok: true,
      texto: null,
    });
  });

  it.each([
    ["42501", "Só a equipe Conduzza vê o rascunho bloqueado."],
    ["P0002", "Este registro não existe mais."],
    ["XX000", "Não foi possível carregar o rascunho. Tente de novo."],
  ])("erro %s: o texto certo", async (code, texto) => {
    estado.sessao = sessao({ superAdmin: true });
    banco.rpc("ler_rascunho_bloqueado", () => ({
      data: null,
      error: { code, message: "x" },
    }));
    expect(await lerRascunhoBloqueadoAction(DECISAO)).toEqual({
      ok: false,
      error: texto,
    });
  });
});
