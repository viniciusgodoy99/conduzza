import { beforeEach, describe, expect, it, vi } from "vitest";

// As acoes de numero e de telefone da aba WhatsApp da Tela 6 (ate a onda 2,
// a aba Agente de IA de Configuracoes) chamadas pelo Painel geral (onda 1):
// a entrada traz o clinicId da tela. O que se prova:
//   - so a equipe Conduzza passa (o administrador da clinica ativa, nao), e
//     sem precisar de clinica ativa nem de ser membro da clinica;
//   - clinicId que nao e uuid: dados invalidos; clinica sem o agente em
//     teste (a lista do banco): recusada antes do banco, com a dica;
//   - o "Ligar" do numero confere a conexao pelo proprio painel (nunca pela
//     leitura de whatsapp_account, que e so de membro), e cada RPC vai com
//     a clinica do painel;
//   - o telefone novo pede sempre a confirmacao de que e da equipe e NUNCA
//     le os contatos da clinica (nenhum dado de paciente no painel, nada na
//     trilha de leitura);
//   - a acao revalida o painel e a Tela 6 (onda 2), e nao Configuracoes;
//   - a escolha do modo e a pausa continuam so da aba (a entrada estrita
//     recusa o clinicId); o interruptor geral mora no Painel geral desde a
//     onda 2 (tests/unit/painel-geral/acoes-do-painel.test.ts);
//   - onda 2: excluir telefone tambem pelo painel, com o clinicId da tela.
// A aba de Configuracoes (sem clinicId) esta em
// tests/unit/agente/whatsapp/whatsapp-actions.test.ts.

const ATIVA = "acd9c539-585e-4f2a-a195-712c70099564";
const DO_PAINEL = "f0c115dd-e98c-4767-a1bb-93d517844852";
const USUARIO = "97777777-7777-4777-8777-777777777777";
const NUMERO = "a1111111-1111-4111-8111-111111111111";

const registro = vi.hoisted(() => ({
  comSessao: true,
  semClinicaAtiva: false,
  papel: "admin" as string,
  superAdmin: true,
  habilitadas: new Set<string>(),
  conferidas: [] as string[],
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  errosDoRpc: new Map<string, { code?: string; message?: string }>(),
  consultas: [] as { tabela: string; filtros: [string, unknown][] }[],
  linhaDoTelefone: { id: "t1" } as null | { id: string },
  dados: null as unknown,
  numeroDoPainel: null as null | { id: string; conexao: string },
  painelFalha: false,
  leiturasDoPainel: [] as [string, string][],
  numerosDaSessao: 0,
  auditorias: [] as unknown[],
  revalidados: [] as [string, string | undefined][],
  logs: [] as [string, unknown][],
}));

vi.mock("next/cache", () => ({
  revalidatePath: (caminho: string, tipo?: string) =>
    registro.revalidados.push([caminho, tipo]),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabela: string) => {
      const consulta = { tabela, filtros: [] as [string, unknown][] };
      registro.consultas.push(consulta);
      const cadeia = {
        select: () => cadeia,
        eq: (coluna: string, valor: unknown) => {
          consulta.filtros.push([coluna, valor]);
          return cadeia;
        },
        maybeSingle: async () => ({
          data:
            tabela === "ia_contato_liberado" ? registro.linhaDoTelefone : null,
          error: null,
        }),
      };
      return cadeia;
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      registro.rpcs.push({ nome, args });
      const erro = registro.errosDoRpc.get(nome) ?? null;
      return { data: erro ? null : true, error: erro };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("as ações do agente nunca usam o cliente de serviço");
  },
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () =>
    registro.comSessao
      ? {
          userId: USUARIO,
          isProductAdmin: registro.superAdmin,
          active: registro.semClinicaAtiva
            ? null
            : {
                clinicId: ATIVA,
                role: registro.papel,
                status: "ativo",
                timezone: "America/Fortaleza",
              },
        }
      : null,
}));
vi.mock("@/lib/queries/ia-liberacao", async (original) => {
  const real = await original<typeof import("@/lib/queries/ia-liberacao")>();
  return {
    ...real,
    abaDaIaVisivel: (clinicId: string) => {
      registro.conferidas.push(clinicId);
      return Promise.resolve(registro.habilitadas.has(clinicId));
    },
    fetchLiberacaoDaIa: async () => registro.dados,
    // A leitura da sessao (whatsapp_account, so de membro): o painel nunca
    // pode depender dela.
    fetchNumeroDaClinica: async () => {
      registro.numerosDaSessao += 1;
      return null;
    },
  };
});
vi.mock("@/lib/queries/painel-geral", async (original) => {
  const real = await original<typeof import("@/lib/queries/painel-geral")>();
  return {
    ...real,
    fetchNumeroDaClinicaNoPainel: async (
      _supabase: unknown,
      clinicId: string,
      whatsappAccountId: string,
    ) => {
      registro.leiturasDoPainel.push([clinicId, whatsappAccountId]);
      if (registro.painelFalha) {
        throw new Error("falhou");
      }
      return registro.numeroDoPainel
        ? {
            id: registro.numeroDoPainel.id,
            nome: "Recepção",
            final: "0000",
            conexao: registro.numeroDoPainel.conexao,
            iaLigada: false,
          }
        : null;
    },
  };
});
vi.mock("@/lib/auth/read-audit", () => ({
  auditarLeituraDePaciente: async (_supabase: unknown, params: unknown) => {
    registro.auditorias.push(params);
  },
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
  adicionarTelefoneDaIaAction,
  alternarNumeroDaIaAction,
  alternarTelefoneDaIaAction,
  definirEscolhaDaIaAction,
  definirPausaDaIaAction,
  excluirTelefoneDaIaAction,
} from "@/app/(app)/agente/whatsapp-actions";
import { TEXTOS_DA_IA } from "@/components/agente/whatsapp/agente-de-ia";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";

function dados(liberacao: boolean) {
  return {
    liberacao: liberacao
      ? {
          liberada: true,
          modo: "contatos",
          pausadaPelaClinica: false,
          tetoDiarioCentavosUsd: 500,
        }
      : null,
    numerosLigados: [],
    telefones: [],
    interruptorLigado: true,
  };
}

beforeEach(() => {
  registro.comSessao = true;
  registro.semClinicaAtiva = false;
  registro.papel = "admin";
  registro.superAdmin = true;
  registro.habilitadas = new Set([ATIVA, DO_PAINEL]);
  registro.conferidas = [];
  registro.rpcs = [];
  registro.errosDoRpc = new Map();
  registro.consultas = [];
  registro.linhaDoTelefone = { id: "t1" };
  registro.dados = dados(true);
  registro.numeroDoPainel = { id: NUMERO, conexao: "conectado" };
  registro.painelFalha = false;
  registro.leiturasDoPainel = [];
  registro.numerosDaSessao = 0;
  registro.auditorias = [];
  registro.revalidados = [];
  registro.logs = [];
});

const NOVO = {
  rotulo: "Ana, recepção",
  telefone: "84999990002",
  confirmarAvisoDaOpenai: true,
} as const;

const acoesDoPainel = [
  () =>
    alternarNumeroDaIaAction({
      clinicId: DO_PAINEL,
      whatsappAccountId: NUMERO,
      ligado: true,
    }),
  () =>
    adicionarTelefoneDaIaAction({
      ...NOVO,
      confirmarContato: true,
      clinicId: DO_PAINEL,
    }),
  () =>
    alternarTelefoneDaIaAction({
      clinicId: DO_PAINEL,
      telefone: "+5584999990001",
      ligado: false,
    }),
] as const;

describe("guarda do painel", () => {
  it("só a equipe Conduzza: o administrador da clínica ativa é recusado, sem banco", async () => {
    registro.superAdmin = false;
    for (const acao of acoesDoPainel) {
      expect(await acao()).toEqual({
        ok: false,
        error: TEXTOS_DO_PAINEL.soEquipeConduzzaNoAgente,
      });
    }
    expect(registro.rpcs).toEqual([]);
    expect(registro.consultas).toEqual([]);
    expect(registro.conferidas).toEqual([]);
  });

  it("sem sessão: pede para entrar de novo", async () => {
    registro.comSessao = false;
    for (const acao of acoesDoPainel) {
      expect(await acao()).toEqual({
        ok: false,
        error: "Sessão expirada. Entre de novo.",
      });
    }
    expect(registro.rpcs).toEqual([]);
  });

  it("clinicId que não é uuid: dados inválidos, sem banco", async () => {
    expect(
      await alternarNumeroDaIaAction({
        clinicId: "teste123",
        whatsappAccountId: NUMERO,
        ligado: false,
      }),
    ).toEqual({
      ok: false,
      error: "Dados inválidos. Recarregue a página e tente de novo.",
    });
    expect(registro.rpcs).toEqual([]);
    expect(registro.conferidas).toEqual([]);
  });

  it("clínica fora da lista do banco (agente desligado ou conta suspensa): recusada, sem banco", async () => {
    registro.habilitadas = new Set([ATIVA]);
    for (const acao of acoesDoPainel) {
      expect(await acao()).toEqual({
        ok: false,
        error: TEXTOS_DO_PAINEL.soComAgenteEmTeste,
      });
    }
    expect(registro.rpcs).toEqual([]);
    expect(registro.conferidas).toEqual(Array(3).fill(DO_PAINEL));
  });

  it("não precisa de clínica ativa nem de papel na clínica do painel", async () => {
    registro.semClinicaAtiva = true;
    expect(
      await alternarTelefoneDaIaAction({
        clinicId: DO_PAINEL,
        telefone: "+5584999990001",
        ligado: false,
      }),
    ).toEqual({ ok: true });
    registro.semClinicaAtiva = false;
    registro.papel = "leitura";
    expect(
      await alternarTelefoneDaIaAction({
        clinicId: DO_PAINEL,
        telefone: "+5584999990001",
        ligado: false,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs.map((r) => r.args.p_clinic_id)).toEqual([
      DO_PAINEL,
      DO_PAINEL,
    ]);
  });

  it("a escolha do modo e a pausa não aceitam a clínica do painel", async () => {
    expect(
      await definirEscolhaDaIaAction({
        escolha: "desligado",
        clinicId: DO_PAINEL,
      }),
    ).toEqual({
      ok: false,
      error: "Dados inválidos. Recarregue a página e tente de novo.",
    });
    expect(
      await definirPausaDaIaAction({
        pausada: true,
        clinicId: DO_PAINEL,
      }),
    ).toEqual({
      ok: false,
      error: "Dados inválidos. Recarregue a página e tente de novo.",
    });
    expect(registro.rpcs).toEqual([]);
  });

  it("excluir telefone pelo painel (onda 2, item 9): a RPC com a clínica do painel", async () => {
    const TELEFONE = "d1111111-1111-4111-8111-111111111111";
    expect(
      await excluirTelefoneDaIaAction({ clinicId: DO_PAINEL, id: TELEFONE }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "excluir_contato_liberado_da_ia",
        args: { p_clinic_id: DO_PAINEL, p_contato_liberado_id: TELEFONE },
      },
    ]);
    // o administrador da clinica ativa nao exclui pelo painel
    registro.rpcs = [];
    registro.superAdmin = false;
    expect(
      await excluirTelefoneDaIaAction({ clinicId: DO_PAINEL, id: TELEFONE }),
    ).toEqual({ ok: false, error: TEXTOS_DO_PAINEL.soEquipeConduzzaNoAgente });
    expect(registro.rpcs).toEqual([]);
  });
});

describe("números pelo painel", () => {
  it("ligar: a conexão vem do painel, e a RPC vai com a clínica do painel", async () => {
    expect(await acoesDoPainel[0]()).toEqual({ ok: true });
    expect(registro.leiturasDoPainel).toEqual([[DO_PAINEL, NUMERO]]);
    expect(registro.numerosDaSessao).toBe(0);
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_numero_da_ia",
        args: {
          p_clinic_id: DO_PAINEL,
          p_whatsapp_account_id: NUMERO,
          p_ativo: true,
        },
      },
    ]);
    expect(registro.revalidados).toEqual([
      ["/agente", undefined],
      ["/painel-geral", "layout"],
    ]);
  });

  it("ligar número desconectado, de fora da clínica ou com o painel fora do ar: recusado, sem RPC", async () => {
    registro.numeroDoPainel = { id: NUMERO, conexao: "desconectado" };
    expect(await acoesDoPainel[0]()).toEqual({
      ok: false,
      error: TEXTOS_DA_IA.conecteAntes,
    });
    registro.numeroDoPainel = null;
    expect(await acoesDoPainel[0]()).toEqual({
      ok: false,
      error:
        "Este número não está mais entre os números da clínica. Recarregue a página.",
    });
    registro.painelFalha = true;
    expect(await acoesDoPainel[0]()).toEqual({
      ok: false,
      error:
        "Não foi possível conferir a configuração do assistente. Recarregue a página e tente de novo.",
    });
    expect(registro.rpcs).toEqual([]);
  });

  it("ligar sem a linha de liberação: cria a linha desligada com o motivo do painel", async () => {
    registro.dados = dados(false);
    expect(await acoesDoPainel[0]()).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_liberacao_da_ia",
        args: {
          p_clinic_id: DO_PAINEL,
          p_liberada: false,
          p_motivo: "Painel geral",
        },
      },
      {
        nome: "definir_numero_da_ia",
        args: {
          p_clinic_id: DO_PAINEL,
          p_whatsapp_account_id: NUMERO,
          p_ativo: true,
        },
      },
    ]);
  });

  it("desligar: só a RPC, sem conferir a conexão", async () => {
    expect(
      await alternarNumeroDaIaAction({
        clinicId: DO_PAINEL,
        whatsappAccountId: NUMERO,
        ligado: false,
      }),
    ).toEqual({ ok: true });
    expect(registro.leiturasDoPainel).toEqual([]);
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_numero_da_ia",
        args: {
          p_clinic_id: DO_PAINEL,
          p_whatsapp_account_id: NUMERO,
          p_ativo: false,
        },
      },
    ]);
  });

  it("42501 do banco no painel: o texto da equipe Conduzza, nunca o do administrador", async () => {
    registro.errosDoRpc.set("definir_numero_da_ia", { code: "42501" });
    expect(
      await alternarNumeroDaIaAction({
        clinicId: DO_PAINEL,
        whatsappAccountId: NUMERO,
        ligado: false,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DO_PAINEL.soEquipeConduzzaNoAgente });
    expect(registro.logs).toEqual([
      [
        "ia_liberacao_nao_alterada",
        { clinic_id: DO_PAINEL, kind: "numero_desligar", error_code: "42501" },
      ],
    ]);
  });
});

describe("telefones pelo painel", () => {
  it("telefone novo sem a confirmação de que é da equipe: pede a confirmação, sem ler contato e sem banco", async () => {
    const r = await adicionarTelefoneDaIaAction({
      ...NOVO,
      clinicId: DO_PAINEL,
    });
    expect(r).toEqual({
      ok: false,
      error: TEXTOS_DO_PAINEL.confirmeQueEDaEquipe,
      pedeConfirmacao: true,
    });
    expect(registro.consultas).toEqual([]);
    expect(registro.auditorias).toEqual([]);
    expect(registro.rpcs).toEqual([]);
  });

  it("com a confirmação: grava na clínica do painel sem consultar os contatos dela", async () => {
    expect(await acoesDoPainel[1]()).toEqual({ ok: true });
    expect(registro.consultas.map((c) => c.tabela)).not.toContain("contact");
    expect(registro.auditorias).toEqual([]);
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_contato_liberado_da_ia",
        args: {
          p_clinic_id: DO_PAINEL,
          p_telefone_e164: "+5584999990002",
          p_rotulo: "Ana, recepção",
          p_ativo: true,
          p_forcar_contato_existente: false,
          p_confirmou_aviso_da_openai: true,
        },
      },
    ]);
    expect(registro.revalidados).toEqual([
      ["/agente", undefined],
      ["/painel-geral", "layout"],
    ]);
  });

  it("telefone de paciente: o banco recusa e a equipe Conduzza recebe o forçar", async () => {
    registro.errosDoRpc.set("definir_contato_liberado_da_ia", {
      code: "23514",
      message: "contato_de_paciente",
    });
    expect(await acoesDoPainel[1]()).toEqual({
      ok: false,
      error: TEXTOS_DA_IA.contatoDePaciente,
      pedeForcar: true,
    });
  });

  it("ligar de novo: confere a lista da clínica do painel", async () => {
    expect(
      await alternarTelefoneDaIaAction({
        clinicId: DO_PAINEL,
        telefone: "+5584999990001",
        ligado: true,
      }),
    ).toEqual({ ok: true });
    expect(registro.consultas).toEqual([
      {
        tabela: "ia_contato_liberado",
        filtros: [
          ["clinic_id", DO_PAINEL],
          ["phone_key", "+5584999990001"],
        ],
      },
    ]);
    registro.linhaDoTelefone = null;
    expect(
      await alternarTelefoneDaIaAction({
        clinicId: DO_PAINEL,
        telefone: "+5584999990001",
        ligado: true,
      }),
    ).toEqual({
      ok: false,
      error:
        "Este telefone não está na lista da equipe. Adicione o telefone pelo formulário.",
    });
  });
});
