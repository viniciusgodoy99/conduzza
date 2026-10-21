import { beforeEach, describe, expect, it, vi } from "vitest";

// As Server Actions do Painel geral (onda 1), com a sessao, o cliente do
// Supabase e o log trocados por dubles que guardam tudo. O que se prova:
//   - a guarda no servidor: sem sessao ou sem super admin, nada chega ao
//     banco (esconder a tela nao protege nada);
//   - o Zod estrito de cada entrada, com o motivo de 3 a 300 letras e as
//     faixas do teto; a producao do agente (onda 2) com o motivo
//     obrigatorio, e as chaves pendentes do banco em nomes;
//   - onda 2: registrar e revogar os requisitos da producao (o termo so
//     para a clinica; os outros para todas) e o interruptor geral, que saiu
//     da aba da clinica e nao depende da clinica ativa;
//   - cada acao vira a RPC do contrato, com a sessao e os parametros por
//     nome; a trilha e da RPC (a acao nao grava audit_log);
//   - o erro do banco vira texto de recepcao; o log leva so a clinica, o
//     tipo e o codigo (nunca o motivo);
//   - a reativacao devolve quantas mensagens vencidas foram canceladas.
// A autorizacao de verdade (42501 nas RPCs) esta nos testes de RLS e de
// integracao da frente de banco.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const USUARIO = "97777777-7777-4777-8777-777777777777";

const registro = vi.hoisted(() => ({
  comSessao: true,
  superAdmin: true,
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  respostas: new Map<string, { data: unknown; error: unknown }>(),
  tabelas: [] as string[],
  revalidados: [] as [string, string | undefined][],
  logs: [] as [string, unknown][],
}));

vi.mock("next/cache", () => ({
  revalidatePath: (caminho: string, tipo?: string) =>
    registro.revalidados.push([caminho, tipo]),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (nome: string, args: Record<string, unknown>) => {
      registro.rpcs.push({ nome, args });
      return registro.respostas.get(nome) ?? { data: null, error: null };
    },
    from: (tabela: string) => {
      registro.tabelas.push(tabela);
      throw new Error("as ações do painel só falam com o banco por RPC");
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("o painel nunca usa o cliente de serviço");
  },
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () =>
    registro.comSessao
      ? {
          userId: USUARIO,
          isProductAdmin: registro.superAdmin,
          active: null,
          memberships: [],
        }
      : null,
}));
vi.mock("@/lib/log", () => ({
  log: {
    info: (evento: string, campos: unknown) =>
      registro.logs.push([evento, campos]),
    warn: (evento: string, campos: unknown) =>
      registro.logs.push([evento, campos]),
    error: (evento: string, campos: unknown) =>
      registro.logs.push([evento, campos]),
  },
}));

import {
  definirAgenteDaClinicaAction,
  definirInterruptorGeralAction,
  definirTetoDaIaAction,
  reativarClinicaAction,
  registrarRequisitoDaProducaoAction,
  revogarRequisitoDaProducaoAction,
  suspenderClinicaAction,
} from "@/app/(app)/painel-geral/actions";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";

beforeEach(() => {
  registro.comSessao = true;
  registro.superAdmin = true;
  registro.rpcs = [];
  registro.respostas = new Map();
  registro.tabelas = [];
  registro.revalidados = [];
  registro.logs = [];
});

const MOTIVO = "Pagamento atrasado há 30 dias";
const REGISTRO = "e1111111-1111-4111-8111-111111111111";
/** O que toda acao que gravou revalida: o painel e a Tela 6 (onda 2). */
const REVALIDADOS_DO_PAINEL: [string, string | undefined][] = [
  ["/painel-geral", "layout"],
  ["/agente", undefined],
];

const validas = [
  () => suspenderClinicaAction({ clinicId: CLINICA, motivo: MOTIVO }),
  () => reativarClinicaAction({ clinicId: CLINICA, motivo: MOTIVO }),
  () => definirAgenteDaClinicaAction({ clinicId: CLINICA, estado: "teste" }),
  () =>
    definirTetoDaIaAction({
      clinicId: CLINICA,
      tetoDiarioCentavos: 500,
      respostasPorConversaHora: 20,
    }),
  () =>
    registrarRequisitoDaProducaoAction({
      clinicId: CLINICA,
      chave: "rodada_cfm",
      evidencia: "Rodada de 21/10",
    }),
  () =>
    revogarRequisitoDaProducaoAction({
      clinicId: CLINICA,
      id: REGISTRO,
      motivo: MOTIVO,
    }),
  () => definirInterruptorGeralAction({ ligado: true }),
] as const;

describe("guarda no servidor", () => {
  it("sem sessão: pede para entrar de novo, sem banco", async () => {
    registro.comSessao = false;
    for (const acao of validas) {
      expect(await acao()).toEqual({
        ok: false,
        error: TEXTOS_DO_PAINEL.sessaoExpirada,
      });
    }
    expect(registro.rpcs).toEqual([]);
  });

  it("quem não é da equipe Conduzza (qualquer papel na clínica): recusado, sem banco", async () => {
    registro.superAdmin = false;
    for (const acao of validas) {
      expect(await acao()).toEqual({
        ok: false,
        error: TEXTOS_DO_PAINEL.soEquipeConduzza,
      });
    }
    expect(registro.rpcs).toEqual([]);
    expect(registro.revalidados).toEqual([]);
  });
});

describe("entradas estritas", () => {
  it("formato fora do esperado: dados inválidos, sem banco", async () => {
    const invalidas = [
      () => suspenderClinicaAction({ clinicId: "x", motivo: MOTIVO }),
      () => suspenderClinicaAction({ clinicId: CLINICA }),
      () => suspenderClinicaAction("suspender"),
      () =>
        suspenderClinicaAction({ clinicId: CLINICA, motivo: MOTIVO, extra: 1 }),
      () => reativarClinicaAction({ clinicId: CLINICA, motivo: 42 }),
      () => definirAgenteDaClinicaAction({ clinicId: CLINICA, estado: "on" }),
      () =>
        definirAgenteDaClinicaAction({
          clinicId: CLINICA,
          estado: "teste",
          extra: true,
        }),
      () =>
        definirTetoDaIaAction({
          clinicId: CLINICA,
          tetoDiarioCentavos: "500",
          respostasPorConversaHora: 20,
        }),
      // so as chaves da equipe Conduzza se registram
      () =>
        registrarRequisitoDaProducaoAction({
          clinicId: CLINICA,
          chave: "versao_publicada",
          evidencia: "Rodada de 21/10",
        }),
      () =>
        registrarRequisitoDaProducaoAction({
          clinicId: "x",
          chave: "rodada_cfm",
          evidencia: "Rodada de 21/10",
        }),
      () =>
        revogarRequisitoDaProducaoAction({
          clinicId: CLINICA,
          id: "x",
          motivo: MOTIVO,
        }),
      () => definirInterruptorGeralAction({ ligado: "sim" }),
      () => definirInterruptorGeralAction({ ligado: true, clinicId: CLINICA }),
    ];
    for (const acao of invalidas) {
      expect(await acao()).toEqual({
        ok: false,
        error: TEXTOS_DO_PAINEL.dadosInvalidos,
      });
    }
    expect(registro.rpcs).toEqual([]);
  });

  it("motivo curto ou longo: o texto do campo, sem banco", async () => {
    expect(
      await suspenderClinicaAction({ clinicId: CLINICA, motivo: "  ok " }),
    ).toEqual({ ok: false, error: TEXTOS_DO_PAINEL.motivoCurto });
    expect(
      await reativarClinicaAction({
        clinicId: CLINICA,
        motivo: "x".repeat(301),
      }),
    ).toEqual({ ok: false, error: TEXTOS_DO_PAINEL.motivoLongo });
    expect(registro.rpcs).toEqual([]);
  });

  it("teto fora da faixa: o texto do campo, sem banco", async () => {
    expect(
      await definirTetoDaIaAction({
        clinicId: CLINICA,
        tetoDiarioCentavos: 100_001,
        respostasPorConversaHora: 20,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DO_PAINEL.tetoInvalido });
    expect(
      await definirTetoDaIaAction({
        clinicId: CLINICA,
        tetoDiarioCentavos: 500,
        respostasPorConversaHora: 201,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DO_PAINEL.respostasInvalidas });
    expect(registro.rpcs).toEqual([]);
  });

  it("produção do agente sem motivo (ou curto): o texto do campo, sem banco (onda 2)", async () => {
    expect(
      await definirAgenteDaClinicaAction({
        clinicId: CLINICA,
        estado: "producao",
      }),
    ).toEqual({ ok: false, error: TEXTOS_DO_PAINEL.motivoCurto });
    expect(
      await definirAgenteDaClinicaAction({
        clinicId: CLINICA,
        estado: "producao",
        motivo: " ok ",
      }),
    ).toEqual({ ok: false, error: TEXTOS_DO_PAINEL.motivoCurto });
    expect(registro.rpcs).toEqual([]);
  });

  it("evidência curta ou longa: o texto do campo, sem banco", async () => {
    for (const evidencia of ["ab", "x".repeat(501)]) {
      expect(
        await registrarRequisitoDaProducaoAction({
          clinicId: CLINICA,
          chave: "rodada_cfm",
          evidencia,
        }),
      ).toEqual({ ok: false, error: TEXTOS_DO_PAINEL.evidenciaInvalida });
    }
    expect(registro.rpcs).toEqual([]);
  });
});

describe("as RPCs do contrato", () => {
  it("suspender: suspender_clinica com o motivo sem as pontas", async () => {
    expect(
      await suspenderClinicaAction({
        clinicId: CLINICA,
        motivo: `  ${MOTIVO}  `,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "suspender_clinica",
        args: { p_clinic_id: CLINICA, p_motivo: MOTIVO },
      },
    ]);
    expect(registro.revalidados).toEqual(REVALIDADOS_DO_PAINEL);
    // A trilha e da RPC: a acao nao escreve em tabela nenhuma.
    expect(registro.tabelas).toEqual([]);
  });

  it("reativar: reativar_clinica e as mensagens vencidas que o banco cancelou", async () => {
    registro.respostas.set("reativar_clinica", {
      data: { jobs_vencidos: 3 },
      error: null,
    });
    expect(
      await reativarClinicaAction({ clinicId: CLINICA, motivo: MOTIVO }),
    ).toEqual({ ok: true, jobsVencidos: 3 });
    expect(registro.rpcs).toEqual([
      {
        nome: "reativar_clinica",
        args: { p_clinic_id: CLINICA, p_motivo: MOTIVO },
      },
    ]);
    registro.respostas.set("reativar_clinica", { data: null, error: null });
    expect(
      await reativarClinicaAction({ clinicId: CLINICA, motivo: MOTIVO }),
    ).toEqual({ ok: true });
  });

  it("agente: definir_agente_da_clinica, com o motivo padrão quando a tela não manda", async () => {
    expect(
      await definirAgenteDaClinicaAction({
        clinicId: CLINICA,
        estado: "teste",
        motivo: "Clínica entrou nos testes",
      }),
    ).toEqual({ ok: true });
    expect(
      await definirAgenteDaClinicaAction({
        clinicId: CLINICA,
        estado: "desligado",
      }),
    ).toEqual({ ok: true });
    expect(
      await definirAgenteDaClinicaAction({
        clinicId: CLINICA,
        estado: "desligado",
        motivo: "   ",
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs.map((r) => r.args)).toEqual([
      {
        p_clinic_id: CLINICA,
        p_estado: "teste",
        p_motivo: "Clínica entrou nos testes",
      },
      { p_clinic_id: CLINICA, p_estado: "desligado", p_motivo: "Painel geral" },
      { p_clinic_id: CLINICA, p_estado: "desligado", p_motivo: "Painel geral" },
    ]);
    expect(
      registro.rpcs.every((r) => r.nome === "definir_agente_da_clinica"),
    ).toBe(true);
    // O aviso de onde o assistente mora (Configuracoes) e a Tela 6.
    expect(registro.revalidados).toContainEqual(["/configuracoes", undefined]);
    expect(registro.revalidados).toContainEqual(["/agente", undefined]);
  });

  it("produção (onda 2): definir_agente_da_clinica com o motivo, sem as pontas", async () => {
    expect(
      await definirAgenteDaClinicaAction({
        clinicId: CLINICA,
        estado: "producao",
        motivo: "  Requisitos conferidos com o dono  ",
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_agente_da_clinica",
        args: {
          p_clinic_id: CLINICA,
          p_estado: "producao",
          p_motivo: "Requisitos conferidos com o dono",
        },
      },
    ]);
  });

  it("registrar: o termo vale só para a clínica; os outros, para todas (p_clinic_id nulo)", async () => {
    expect(
      await registrarRequisitoDaProducaoAction({
        clinicId: CLINICA,
        chave: "termo_da_clinica",
        evidencia: "  Termo assinado em 21/10, pasta da clínica  ",
      }),
    ).toEqual({ ok: true });
    expect(
      await registrarRequisitoDaProducaoAction({
        clinicId: CLINICA,
        chave: "contrato_openai",
        evidencia: "DPA assinado, pasta do contrato",
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "registrar_requisito_da_producao",
        args: {
          p_chave: "termo_da_clinica",
          p_clinic_id: CLINICA,
          p_evidencia: "Termo assinado em 21/10, pasta da clínica",
        },
      },
      {
        nome: "registrar_requisito_da_producao",
        args: {
          p_chave: "contrato_openai",
          p_clinic_id: null,
          p_evidencia: "DPA assinado, pasta do contrato",
        },
      },
    ]);
    expect(registro.tabelas).toEqual([]);
  });

  it("revogar: revogar_requisito_da_producao com o id e o motivo", async () => {
    expect(
      await revogarRequisitoDaProducaoAction({
        clinicId: CLINICA,
        id: REGISTRO,
        motivo: MOTIVO,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "revogar_requisito_da_producao",
        args: { p_id: REGISTRO, p_motivo: MOTIVO },
      },
    ]);
    expect(registro.revalidados).toEqual(REVALIDADOS_DO_PAINEL);
  });

  it("interruptor geral (onda 2, P8): definir_interruptor_da_ia, sem depender da clínica ativa", async () => {
    // a sessao do duble nem tem clinica ativa
    expect(await definirInterruptorGeralAction({ ligado: false })).toEqual({
      ok: true,
    });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_interruptor_da_ia",
        args: { p_ligado: false, p_motivo: "Painel geral" },
      },
    ]);
    expect(registro.revalidados).toEqual(REVALIDADOS_DO_PAINEL);
  });

  it("interruptor geral: 42501 é o texto da equipe Conduzza; outro erro, o genérico, com o log só do código", async () => {
    registro.respostas.set("definir_interruptor_da_ia", {
      data: null,
      error: { code: "42501" },
    });
    expect(await definirInterruptorGeralAction({ ligado: true })).toEqual({
      ok: false,
      error: TEXTOS_DO_PAINEL.soEquipeConduzza,
    });
    registro.respostas.set("definir_interruptor_da_ia", {
      data: null,
      error: { code: "XX000" },
    });
    expect(await definirInterruptorGeralAction({ ligado: true })).toEqual({
      ok: false,
      error: TEXTOS_DO_PAINEL.interruptorNaoAlterou,
    });
    expect(registro.logs.at(-1)).toEqual([
      "ia_interruptor_nao_alterado",
      { kind: "ligar", error_code: "XX000" },
    ]);
    expect(registro.revalidados).toEqual([]);
  });

  it("teto: definir_teto_da_ia em centavos e respostas por hora", async () => {
    expect(
      await definirTetoDaIaAction({
        clinicId: CLINICA,
        tetoDiarioCentavos: 1,
        respostasPorConversaHora: 200,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_teto_da_ia",
        args: {
          p_clinic_id: CLINICA,
          p_teto_diario_centavos_usd: 1,
          p_teto_respostas_por_conversa_hora: 200,
        },
      },
    ]);
  });
});

describe("erros do banco em texto de recepção", () => {
  it("as chaves da migration 20261021100000 viram texto de recepção", async () => {
    const casos: [
      () => Promise<unknown>,
      string,
      { code?: string; message?: string },
      string,
    ][] = [
      [
        validas[0],
        "suspender_clinica",
        {
          code: "42501",
          message:
            "Somente a equipe do Conduzza suspende a conta de uma clínica.",
        },
        TEXTOS_DO_PAINEL.soEquipeConduzza,
      ],
      [
        validas[2],
        "definir_agente_da_clinica",
        { code: "42501" },
        TEXTOS_DO_PAINEL.soEquipeConduzza,
      ],
      [
        validas[0],
        "suspender_clinica",
        { code: "P0002", message: "Clínica não encontrada." },
        TEXTOS_DO_PAINEL.clinicaNaoEncontrada,
      ],
      [
        validas[3],
        "definir_teto_da_ia",
        { code: "P0002" },
        TEXTOS_DO_PAINEL.clinicaNaoEncontrada,
      ],
      [
        validas[0],
        "suspender_clinica",
        { code: "P0001", message: "clinica_ja_suspensa" },
        TEXTOS_DO_PAINEL.jaSuspensa,
      ],
      [
        validas[1],
        "reativar_clinica",
        { code: "P0001", message: "clinica_nao_suspensa" },
        TEXTOS_DO_PAINEL.jaAtiva,
      ],
      [
        validas[1],
        "reativar_clinica",
        { code: "22023", message: "motivo_invalido" },
        TEXTOS_DO_PAINEL.motivoInvalido,
      ],
      [
        validas[2],
        "definir_agente_da_clinica",
        { code: "P0001", message: "clinica_de_teste" },
        TEXTOS_DO_PAINEL.agenteDeTesteRecusado,
      ],
      [
        validas[2],
        "definir_agente_da_clinica",
        { code: "P0001", message: "clinica_suspensa" },
        TEXTOS_DO_PAINEL.suspensaNaoLigaOAgente,
      ],
      [
        validas[2],
        "definir_agente_da_clinica",
        { code: "22023", message: "estado_invalido" },
        TEXTOS_DO_PAINEL.producaoRecusada,
      ],
      [
        validas[3],
        "definir_teto_da_ia",
        { code: "P0001", message: "sem_liberacao" },
        TEXTOS_DO_PAINEL.tetoSemLinha,
      ],
      [
        validas[3],
        "definir_teto_da_ia",
        { code: "P0001", message: "clinica_suspensa" },
        TEXTOS_DO_PAINEL.suspensaNaoMudaOTeto,
      ],
      [
        validas[3],
        "definir_teto_da_ia",
        { code: "22023", message: "teto_invalido" },
        TEXTOS_DO_PAINEL.tetoInvalido,
      ],
      [
        validas[3],
        "definir_teto_da_ia",
        { code: "22023", message: "respostas_invalidas" },
        TEXTOS_DO_PAINEL.respostasInvalidas,
      ],
      [
        validas[3],
        "definir_teto_da_ia",
        { code: "XX000" },
        TEXTOS_DO_PAINEL.naoMudouOTeto,
      ],
      [
        validas[2],
        "definir_agente_da_clinica",
        { code: "XX000" },
        TEXTOS_DO_PAINEL.naoMudouOAgente,
      ],
      [
        validas[1],
        "reativar_clinica",
        { code: "XX000" },
        TEXTOS_DO_PAINEL.naoReativou,
      ],
      [
        validas[0],
        "suspender_clinica",
        { code: "XX000", message: "constructor" },
        TEXTOS_DO_PAINEL.naoSuspendeu,
      ],
      // Onda 2: a producao com requisito faltando (as chaves no hint)
      [
        validas[2],
        "definir_agente_da_clinica",
        { code: "P0001", message: "requisitos_pendentes" },
        TEXTOS_DO_PAINEL.requisitosPendentesSemLista,
      ],
      [
        validas[4],
        "registrar_requisito_da_producao",
        { code: "22023", message: "evidencia_invalida" },
        TEXTOS_DO_PAINEL.evidenciaInvalida,
      ],
      [
        validas[4],
        "registrar_requisito_da_producao",
        { code: "42501" },
        TEXTOS_DO_PAINEL.soEquipeConduzza,
      ],
      [
        validas[4],
        "registrar_requisito_da_producao",
        { code: "XX000" },
        TEXTOS_DO_PAINEL.naoRegistrou,
      ],
      [
        validas[5],
        "revogar_requisito_da_producao",
        { code: "P0001", message: "requisito_ja_revogado" },
        TEXTOS_DO_PAINEL.requisitoJaRevogado,
      ],
      [
        validas[5],
        "revogar_requisito_da_producao",
        { code: "XX000" },
        TEXTOS_DO_PAINEL.naoRevogou,
      ],
      [
        validas[4],
        "registrar_requisito_da_producao",
        { code: "22023", message: "chave_invalida" },
        TEXTOS_DO_PAINEL.dadosInvalidos,
      ],
      [
        validas[4],
        "registrar_requisito_da_producao",
        { code: "22023", message: "requisito_por_clinica" },
        TEXTOS_DO_PAINEL.dadosInvalidos,
      ],
      [
        validas[4],
        "registrar_requisito_da_producao",
        { code: "P0002", message: "Clínica não encontrada." },
        TEXTOS_DO_PAINEL.clinicaNaoEncontrada,
      ],
      // Revogar: o P0002 e o registro que sumiu, nao a clinica.
      [
        validas[5],
        "revogar_requisito_da_producao",
        { code: "P0002", message: "Requisito não encontrado." },
        TEXTOS_DO_PAINEL.requisitoNaoEncontrado,
      ],
      [
        validas[5],
        "revogar_requisito_da_producao",
        { code: "22023", message: "motivo_invalido" },
        TEXTOS_DO_PAINEL.motivoInvalido,
      ],
    ];
    for (const [acao, rpc, erro, texto] of casos) {
      registro.respostas = new Map([[rpc, { data: null, error: erro }]]);
      expect(await acao(), `${rpc} ${erro.code} ${erro.message ?? ""}`).toEqual(
        {
          ok: false,
          error: texto,
        },
      );
    }
    expect(registro.revalidados).toEqual([]);
  });

  it("o log leva a clínica, o tipo e o código, nunca o motivo", async () => {
    registro.respostas.set("suspender_clinica", {
      data: null,
      error: { code: "XX000", message: "detalhe interno" },
    });
    await suspenderClinicaAction({ clinicId: CLINICA, motivo: MOTIVO });
    expect(registro.logs).toEqual([
      [
        "painel_geral_nao_alterou",
        { clinic_id: CLINICA, kind: "suspender", error_code: "XX000" },
      ],
    ]);
    expect(JSON.stringify(registro.logs)).not.toContain(MOTIVO);
  });
});

describe("onda 2: requisitos pendentes da produção em nomes", () => {
  it("o hint do banco vira a lista do que falta", async () => {
    registro.respostas.set("definir_agente_da_clinica", {
      data: null,
      error: {
        code: "P0001",
        message: "requisitos_pendentes",
        hint: "rodada_cfm,contrato_openai",
      },
    });
    expect(
      await definirAgenteDaClinicaAction({
        clinicId: CLINICA,
        estado: "producao",
        motivo: "Requisitos conferidos",
      }),
    ).toEqual({
      ok: false,
      error: TEXTOS_DO_PAINEL.requisitosPendentes(
        "Rodada paga de conferência do CFM; Contrato com a OpenAI para dado de saúde",
      ),
    });
  });
});
