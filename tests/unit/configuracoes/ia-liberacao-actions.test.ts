import { beforeEach, describe, expect, it, vi } from "vitest";

// As Server Actions da aba "Agente de IA" (Fase 3), com a sessao, o cliente
// do Supabase, as leituras e o log trocados por dubles que guardam tudo o
// que a action mandou. O que se prova aqui:
//   - a guarda: a aba so existe nas clinicas com o agente habilitado
//     (abaDaIaVisivel, a lista do banco desde a onda 1; aqui um duble que
//     devolve a Promise, e a guarda tem de AGUARDAR: sem o await a Promise e
//     sempre verdadeira e nada era barrado) e so o administrador da clinica
//     ou o super admin chega ao banco; gestor, nao. O interruptor geral, so
//     o super admin;
//   - o Zod estrito de cada entrada;
//   - cada acao vira a RPC certa, com a sessao; "Conversar com a equipe"
//     exige ao menos um numero ligado (ainda da clinica) e um telefone;
//     cada numero liga e desliga sozinho (decisao do dono de 19/10/2026:
//     varios numeros ligados ao mesmo tempo), uma RPC so, sem tocar nos
//     outros; ligar so numero conectado; numero e telefone criam a linha
//     desligada quando ela falta; o telefone vira E.164 com o 55;
//   - telefone que ja e de um contato da clinica (pela chave canonica) so
//     entra com a confirmacao explicita: sem ela, o aviso com o nome e a
//     leitura na trilha, sem gravar;
//   - 42501 vira texto de permissao; telefone e nome nunca vao para log;
//   - E3: ligar o atendimento pelo WhatsApp (modo equipe e ligar numero) e
//     so do super admin; o administrador recebe soEquipeConduzzaLiga sem
//     banco e continua desligando. O telefone novo exige a confirmacao do
//     aviso da OpenAI, que vai para audit_log; a recusa do banco por numero
//     da plataforma ou telefone de paciente vira o texto certo, e so o super
//     admin recebe pedeForcar;
//   - decisao do dono de 19/10/2026: o administrador da clinica adiciona e
//     liga de novo telefone da equipe (com a confirmacao da OpenAI na trilha
//     no nome dele); o forcar de quem nao e super admin para antes do banco
//     (soEquipeConduzzaForca), sem ler o contato; 42501 do banco no telefone
//     vira o texto de permissao.
// A autorizacao de verdade (guarda no banco, policies) esta em
// tests/rls/ia-liberacao.test.ts e tests/integration/ia-liberacao.test.ts.

const TESTE123 = "acd9c539-585e-4f2a-a195-712c70099564";
const FORA_DA_LISTA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";
const NUMERO = "a1111111-1111-4111-8111-111111111111";
const OUTRO_NUMERO = "b2222222-2222-4222-8222-222222222222";

type DadosFalsos = {
  liberacao: {
    liberada: boolean;
    modo: "simulador" | "contatos";
    pausadaPelaClinica: boolean;
    tetoDiarioCentavosUsd: number;
  } | null;
  /** Os ids dos numeros ligados (varios desde 19/10/2026). */
  numerosLigados: string[];
  telefones: {
    id: string;
    telefone: string;
    rotulo: string | null;
    ativo: boolean;
  }[];
  interruptorLigado: boolean;
};

const registro = vi.hoisted(() => ({
  comSessao: true,
  clinica: "acd9c539-585e-4f2a-a195-712c70099564",
  /**
   * As clinicas com o agente habilitado (a lista do banco que
   * abaDaIaVisivel le desde a onda 1). Vazia: a aba nao existe em nenhuma.
   */
  habilitadas: new Set<string>(["acd9c539-585e-4f2a-a195-712c70099564"]),
  /** Cada clinica que a guarda conferiu na lista, na ordem. */
  conferidas: [] as string[],
  papel: "admin" as string,
  superAdmin: false,
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  /** Erro por nome de RPC (a primeira chamada com aquele nome em diante). */
  errosDoRpc: new Map<string, { code?: string; message?: string }>(),
  /** Erro so na chamada de numero com este id e este ativo. */
  erroNoNumero: null as null | { id: string; ativo: boolean; code: string },
  dados: null as unknown,
  dadosFalham: false,
  numeroDaClinica: null as null | { id: string; connectionStatus: string },
  /**
   * Quando definido, a leitura do numero da clinica responde por id (nulo:
   * removido ou de outra clinica); sem ele, numeroDaClinica para todos.
   */
  numerosPorId: null as null | Map<
    string,
    { id: string; connectionStatus: string }
  >,
  /** O contato da clinica com o telefone consultado (nulo: nenhum). */
  contato: null as null | { id: string; name: string | null },
  contatoFalha: false,
  /**
   * A linha de ia_contato_liberado do telefone (o "Ligar de novo" confere
   * que ele esta na lista). Nula: fora da lista.
   */
  linhaDoTelefone: { id: "t-novo" } as null | { id: string },
  linhaDoTelefoneFalha: false,
  /** INSERTs diretos (audit_log), com a tabela. */
  inseridos: [] as { tabela: string; valores: unknown }[],
  /** Cada consulta direta a uma tabela: a tabela e os filtros eq. */
  consultas: [] as { tabela: string; filtros: [string, unknown][] }[],
  auditorias: [] as unknown[],
  revalidados: [] as string[],
  logs: [] as [string, unknown][],
}));

vi.mock("next/cache", () => ({
  revalidatePath: (caminho: string) => registro.revalidados.push(caminho),
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
        maybeSingle: async () => {
          if (tabela === "ia_contato_liberado") {
            return registro.linhaDoTelefoneFalha
              ? { data: null, error: { code: "XX000" } }
              : { data: registro.linhaDoTelefone, error: null };
          }
          return registro.contatoFalha
            ? { data: null, error: { code: "XX000" } }
            : { data: registro.contato, error: null };
        },
        insert: async (valores: unknown) => {
          registro.inseridos.push({ tabela, valores });
          return { data: null, error: null };
        },
      };
      return cadeia;
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      registro.rpcs.push({ nome, args });
      const e = registro.erroNoNumero;
      if (
        nome === "definir_numero_da_ia" &&
        e &&
        args.p_whatsapp_account_id === e.id &&
        args.p_ativo === e.ativo
      ) {
        return { data: null, error: { code: e.code } };
      }
      const erro = registro.errosDoRpc.get(nome) ?? null;
      return { data: erro ? null : true, error: erro };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("a aba do agente nunca usa o cliente de servico");
  },
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () =>
    registro.comSessao
      ? {
          userId: USUARIO,
          isProductAdmin: registro.superAdmin,
          active: {
            clinicId: registro.clinica,
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
    // A lista do banco nas maos do teste, como a funcao de verdade: uma
    // Promise (a leitura e assincrona desde a onda 1).
    abaDaIaVisivel: (clinicId: string) => {
      registro.conferidas.push(clinicId);
      return Promise.resolve(registro.habilitadas.has(clinicId));
    },
    fetchLiberacaoDaIa: async () => {
      if (registro.dadosFalham) {
        throw new Error("falhou");
      }
      return registro.dados;
    },
    fetchNumeroDaClinica: async (
      _supabase: unknown,
      _clinicId: string,
      whatsappAccountId: string,
    ) =>
      registro.numerosPorId
        ? (registro.numerosPorId.get(whatsappAccountId) ?? null)
        : registro.numeroDaClinica,
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
  definirInterruptorGeralAction,
} from "@/app/(app)/configuracoes/ia-liberacao-actions";
import {
  avisoDeContatoDaClinica,
  TEXTOS_DA_IA,
} from "@/components/configuracoes/agente-de-ia";

function dadosCompletos(campos: Partial<DadosFalsos> = {}): DadosFalsos {
  return {
    liberacao: {
      liberada: false,
      modo: "simulador",
      pausadaPelaClinica: false,
      tetoDiarioCentavosUsd: 500,
    },
    numerosLigados: [NUMERO],
    telefones: [
      { id: "t1", telefone: "+5584999990001", rotulo: "Equipe", ativo: true },
    ],
    interruptorLigado: false,
    ...campos,
  };
}

beforeEach(() => {
  registro.comSessao = true;
  registro.clinica = TESTE123;
  registro.habilitadas = new Set([TESTE123]);
  registro.conferidas = [];
  registro.papel = "admin";
  registro.superAdmin = false;
  registro.rpcs = [];
  registro.errosDoRpc = new Map();
  registro.erroNoNumero = null;
  registro.dados = dadosCompletos();
  registro.dadosFalham = false;
  registro.numeroDaClinica = { id: NUMERO, connectionStatus: "conectado" };
  registro.numerosPorId = null;
  registro.contato = null;
  registro.contatoFalha = false;
  registro.linhaDoTelefone = { id: "t-novo" };
  registro.linhaDoTelefoneFalha = false;
  registro.inseridos = [];
  registro.consultas = [];
  registro.auditorias = [];
  registro.revalidados = [];
  registro.logs = [];
});

const todasAsAcoes = [
  () => definirEscolhaDaIaAction({ escolha: "simulador" }),
  () => alternarNumeroDaIaAction({ whatsappAccountId: NUMERO, ligado: true }),
  () =>
    adicionarTelefoneDaIaAction({
      rotulo: "Ana",
      telefone: "84999990002",
      confirmarAvisoDaOpenai: true,
    }),
  () =>
    alternarTelefoneDaIaAction({ telefone: "+5584999990001", ligado: false }),
] as const;

/** So as consultas a contact (a conferencia do contato da clinica). */
function consultasDoContato() {
  return registro.consultas.filter((c) => c.tabela === "contact");
}

describe("guarda", () => {
  it("sem sessão: pede para entrar de novo, sem banco", async () => {
    registro.comSessao = false;
    for (const acao of [
      ...todasAsAcoes,
      () => definirInterruptorGeralAction({ ligado: false }),
    ]) {
      expect(await acao()).toEqual({
        ok: false,
        error: "Sessão expirada. Entre de novo.",
      });
    }
    expect(registro.rpcs).toEqual([]);
  });

  it("clínica fora da fase controlada: recusada antes do banco, até para o super admin", async () => {
    registro.clinica = FORA_DA_LISTA;
    registro.superAdmin = true;
    for (const acao of [
      ...todasAsAcoes,
      () => definirInterruptorGeralAction({ ligado: false }),
    ]) {
      const r = await acao();
      expect(r.ok).toBe(false);
      expect(r).toEqual({
        ok: false,
        error: "O assistente de IA ainda não está disponível nesta clínica.",
      });
    }
    expect(registro.rpcs).toEqual([]);
  });

  it("a lista do banco diz não (Promise resolvida em false): toda ação recusa, sem banco, até na teste123 e para o super admin", async () => {
    // Sem o await na guarda, a Promise devolvida era verdadeira e esta
    // clinica passava direto para as RPCs.
    registro.habilitadas = new Set();
    registro.superAdmin = true;
    for (const acao of [
      ...todasAsAcoes,
      () => definirInterruptorGeralAction({ ligado: true }),
    ]) {
      expect(await acao()).toEqual({
        ok: false,
        error: "O assistente de IA ainda não está disponível nesta clínica.",
      });
    }
    expect(registro.rpcs).toEqual([]);
    expect(registro.consultas).toEqual([]);
    expect(registro.revalidados).toEqual([]);
    // Cada acao conferiu a clinica ATIVA na lista, uma vez.
    expect(registro.conferidas).toEqual(Array(5).fill(TESTE123));
  });

  it("gestor (e os demais papéis) não altera: a dica do administrador", async () => {
    for (const papel of ["gestor", "recepcao", "profissional", "leitura"]) {
      registro.papel = papel;
      for (const acao of todasAsAcoes) {
        expect(await acao()).toEqual({
          ok: false,
          error: TEXTOS_DA_IA.semPermissao,
        });
      }
    }
    expect(registro.rpcs).toEqual([]);
  });

  it("super admin com outro papel na clínica altera", async () => {
    registro.papel = "gestor";
    registro.superAdmin = true;
    expect(await definirEscolhaDaIaAction({ escolha: "simulador" })).toEqual({
      ok: true,
    });
    expect(registro.rpcs.map((r) => r.nome)).toEqual([
      "definir_liberacao_da_ia",
    ]);
  });

  it("interruptor geral: só o super admin, nem o administrador da clínica", async () => {
    expect(await definirInterruptorGeralAction({ ligado: true })).toEqual({
      ok: false,
      error: "Somente a equipe Conduzza liga e desliga o interruptor geral.",
    });
    expect(registro.rpcs).toEqual([]);
    registro.superAdmin = true;
    expect(await definirInterruptorGeralAction({ ligado: true })).toEqual({
      ok: true,
    });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_interruptor_da_ia",
        args: { p_ligado: true, p_motivo: "Configurações, aba Agente de IA" },
      },
    ]);
    expect(registro.revalidados).toEqual(["/configuracoes"]);
  });

  it("interruptor geral: 42501 do banco vira o texto do super admin", async () => {
    registro.superAdmin = true;
    registro.errosDoRpc.set("definir_interruptor_da_ia", { code: "42501" });
    expect(await definirInterruptorGeralAction({ ligado: false })).toEqual({
      ok: false,
      error: "Somente a equipe Conduzza liga e desliga o interruptor geral.",
    });
  });
});

describe("entradas estritas", () => {
  it("formato fora do esperado: dados inválidos, sem banco", async () => {
    const invalidas = [
      () => definirEscolhaDaIaAction({ escolha: "numero_inteiro" }),
      () => definirEscolhaDaIaAction({ escolha: "simulador", extra: 1 }),
      () => definirEscolhaDaIaAction("simulador"),
      () => alternarNumeroDaIaAction({ whatsappAccountId: "x", ligado: true }),
      () => alternarNumeroDaIaAction({ whatsappAccountId: NUMERO }),
      // o nome antigo do campo (ate 19/10/2026) nao passa mais
      () => alternarNumeroDaIaAction({ whatsappAccountId: NUMERO, usar: true }),
      () =>
        alternarTelefoneDaIaAction({ telefone: "84999990001", ligado: true }),
      () =>
        alternarTelefoneDaIaAction({
          telefone: "+5584999990001",
          ligado: true,
          rotulo: "x",
        }),
      () => adicionarTelefoneDaIaAction({ rotulo: 1, telefone: 2 }),
      () =>
        adicionarTelefoneDaIaAction({
          rotulo: "Ana",
          telefone: "84999990002",
          confirmarContato: "sim",
          confirmarAvisoDaOpenai: true,
        }),
    ];
    for (const acao of invalidas) {
      expect(await acao()).toEqual({
        ok: false,
        error: "Dados inválidos. Recarregue a página e tente de novo.",
      });
    }
    registro.superAdmin = true;
    expect(await definirInterruptorGeralAction({ ligado: "sim" })).toEqual({
      ok: false,
      error: "Dados inválidos. Recarregue a página e tente de novo.",
    });
    expect(registro.rpcs).toEqual([]);
  });
});

describe("ligar e desligar na clínica", () => {
  it("desligar: libera falso, sem mexer no modo", async () => {
    expect(await definirEscolhaDaIaAction({ escolha: "desligado" })).toEqual({
      ok: true,
    });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_liberacao_da_ia",
        args: {
          p_clinic_id: TESTE123,
          p_liberada: false,
          p_motivo: "Configurações, aba Agente de IA",
        },
      },
    ]);
    expect(registro.revalidados).toEqual(["/configuracoes"]);
  });

  it("só simulador: modo simulador", async () => {
    await definirEscolhaDaIaAction({ escolha: "simulador" });
    expect(registro.rpcs[0]?.args).toMatchObject({
      p_liberada: true,
      p_modo: "simulador",
    });
  });

  it("conversar com a equipe: modo contatos, com número e telefone conferidos", async () => {
    registro.superAdmin = true;
    expect(await definirEscolhaDaIaAction({ escolha: "equipe" })).toEqual({
      ok: true,
    });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_liberacao_da_ia",
        args: {
          p_clinic_id: TESTE123,
          p_liberada: true,
          p_modo: "contatos",
          p_motivo: "Configurações, aba Agente de IA",
        },
      },
    ]);
  });

  it("conversar com a equipe sem número ligado, sem telefone ou com número que saiu: recusado", async () => {
    registro.superAdmin = true;
    for (const dados of [
      dadosCompletos({ numerosLigados: [] }),
      dadosCompletos({ telefones: [] }),
      dadosCompletos({
        telefones: [
          { id: "t1", telefone: "+5584999990001", rotulo: null, ativo: false },
        ],
      }),
    ]) {
      registro.dados = dados;
      expect(await definirEscolhaDaIaAction({ escolha: "equipe" })).toEqual({
        ok: false,
        error: TEXTOS_DA_IA.faltaParaAEquipe,
      });
    }
    registro.dados = dadosCompletos();
    registro.numeroDaClinica = null;
    expect(await definirEscolhaDaIaAction({ escolha: "equipe" })).toEqual({
      ok: false,
      error: TEXTOS_DA_IA.faltaParaAEquipe,
    });
    expect(registro.rpcs).toEqual([]);
  });

  it("conversar com a equipe com dois ligados, um removido e outro ativo: liga (basta um)", async () => {
    registro.superAdmin = true;
    registro.dados = dadosCompletos({ numerosLigados: [OUTRO_NUMERO, NUMERO] });
    registro.numerosPorId = new Map([
      [NUMERO, { id: NUMERO, connectionStatus: "desconectado" }],
    ]);
    expect(await definirEscolhaDaIaAction({ escolha: "equipe" })).toEqual({
      ok: true,
    });
    expect(registro.rpcs.map((r) => r.nome)).toEqual([
      "definir_liberacao_da_ia",
    ]);
    // os dois ligados removidos: falta o numero
    registro.rpcs = [];
    registro.numerosPorId = new Map();
    expect(await definirEscolhaDaIaAction({ escolha: "equipe" })).toEqual({
      ok: false,
      error: TEXTOS_DA_IA.faltaParaAEquipe,
    });
    expect(registro.rpcs).toEqual([]);
  });

  it("leitura que falha: não liga a equipe às cegas", async () => {
    registro.superAdmin = true;
    registro.dadosFalham = true;
    const r = await definirEscolhaDaIaAction({ escolha: "equipe" });
    expect(r.ok).toBe(false);
    expect(registro.rpcs).toEqual([]);
  });

  it("42501 do banco: texto de permissão, e o log só com código", async () => {
    registro.errosDoRpc.set("definir_liberacao_da_ia", { code: "42501" });
    expect(await definirEscolhaDaIaAction({ escolha: "simulador" })).toEqual({
      ok: false,
      error: TEXTOS_DA_IA.semPermissao,
    });
    expect(registro.logs).toEqual([
      [
        "ia_liberacao_nao_alterada",
        {
          clinic_id: TESTE123,
          kind: "escolha_simulador",
          error_code: "42501",
        },
      ],
    ]);
    expect(registro.revalidados).toEqual([]);
  });
});

describe("números do assistente (vários desde 19/10/2026)", () => {
  beforeEach(() => {
    registro.superAdmin = true;
  });

  it("ligar com outro já ligado: uma RPC só, deste número (o outro continua ligado)", async () => {
    registro.dados = dadosCompletos({ numerosLigados: [OUTRO_NUMERO] });
    expect(
      await alternarNumeroDaIaAction({
        whatsappAccountId: NUMERO,
        ligado: true,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_numero_da_ia",
        args: {
          p_clinic_id: TESTE123,
          p_whatsapp_account_id: NUMERO,
          p_ativo: true,
        },
      },
    ]);
    // nenhuma chamada para o outro numero (nem desligar, nem religar)
    expect(
      registro.rpcs.some((r) => r.args.p_whatsapp_account_id === OUTRO_NUMERO),
    ).toBe(false);
    expect(registro.revalidados).toEqual(["/configuracoes"]);
  });

  it("desligar um com outro ligado: uma RPC só, deste número", async () => {
    registro.dados = dadosCompletos({ numerosLigados: [NUMERO, OUTRO_NUMERO] });
    expect(
      await alternarNumeroDaIaAction({
        whatsappAccountId: OUTRO_NUMERO,
        ligado: false,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_numero_da_ia",
        args: {
          p_clinic_id: TESTE123,
          p_whatsapp_account_id: OUTRO_NUMERO,
          p_ativo: false,
        },
      },
    ]);
  });

  it("erro do banco ao ligar: o log só com o código e o tipo numero_ligar, nunca o telefone", async () => {
    registro.errosDoRpc.set("definir_numero_da_ia", { code: "XX000" });
    expect(
      await alternarNumeroDaIaAction({
        whatsappAccountId: NUMERO,
        ligado: true,
      }),
    ).toEqual({
      ok: false,
      error: "Não foi possível alterar o assistente de IA. Tente de novo.",
    });
    expect(registro.logs).toEqual([
      [
        "ia_liberacao_nao_alterada",
        { clinic_id: TESTE123, kind: "numero_ligar", error_code: "XX000" },
      ],
    ]);
  });

  it("se o banco recusa, nada muda na tela: o erro, sem revalidar", async () => {
    registro.erroNoNumero = { id: NUMERO, ativo: true, code: "23514" };
    expect(
      await alternarNumeroDaIaAction({
        whatsappAccountId: NUMERO,
        ligado: true,
      }),
    ).toEqual({
      ok: false,
      error: "Este número foi removido da clínica. Recarregue a página.",
    });
    expect(registro.rpcs).toHaveLength(1);
    expect(registro.revalidados).toEqual([]);
  });

  it("sem a linha de liberação: cria desligada antes do número", async () => {
    registro.dados = dadosCompletos({ liberacao: null, numerosLigados: [] });
    await alternarNumeroDaIaAction({ whatsappAccountId: NUMERO, ligado: true });
    expect(registro.rpcs.map((r) => [r.nome, r.args.p_liberada])).toEqual([
      ["definir_liberacao_da_ia", false],
      ["definir_numero_da_ia", undefined],
    ]);
  });

  it("com a linha: nunca religa nem desliga a clínica", async () => {
    registro.dados = dadosCompletos({ numerosLigados: [] });
    await alternarNumeroDaIaAction({ whatsappAccountId: NUMERO, ligado: true });
    expect(registro.rpcs.map((r) => r.nome)).toEqual(["definir_numero_da_ia"]);
  });

  it("número desconectado ou fora da clínica: recusado sem banco", async () => {
    registro.numeroDaClinica = { id: NUMERO, connectionStatus: "desconectado" };
    expect(
      await alternarNumeroDaIaAction({
        whatsappAccountId: NUMERO,
        ligado: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.conecteAntes });
    registro.numeroDaClinica = {
      id: NUMERO,
      connectionStatus: "aguardando_qr",
    };
    expect(
      await alternarNumeroDaIaAction({
        whatsappAccountId: NUMERO,
        ligado: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.conecteAntes });
    registro.numeroDaClinica = null;
    const r = await alternarNumeroDaIaAction({
      whatsappAccountId: NUMERO,
      ligado: true,
    });
    expect(r.ok).toBe(false);
    expect(registro.rpcs).toEqual([]);
  });

  it("desligar: uma RPC só, mesmo desconectado", async () => {
    registro.numeroDaClinica = { id: NUMERO, connectionStatus: "desconectado" };
    expect(
      await alternarNumeroDaIaAction({
        whatsappAccountId: NUMERO,
        ligado: false,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_numero_da_ia",
        args: {
          p_clinic_id: TESTE123,
          p_whatsapp_account_id: NUMERO,
          p_ativo: false,
        },
      },
    ]);
  });
});

describe("telefones da equipe", () => {
  beforeEach(() => {
    registro.superAdmin = true;
  });

  it("adicionar: E.164 com o 55, rótulo aparado, ligado", async () => {
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "  Ana, recepção ",
        telefone: "(84) 99999-0002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: true });
    // conferiu antes se o telefone e de um contato da clinica (nao era)
    expect(consultasDoContato()).toEqual([
      {
        tabela: "contact",
        filtros: [
          ["clinic_id", TESTE123],
          ["phone_key", "+5584999990002"],
        ],
      },
    ]);
    expect(registro.auditorias).toEqual([]);
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_contato_liberado_da_ia",
        args: {
          p_clinic_id: TESTE123,
          p_telefone_e164: "+5584999990002",
          p_rotulo: "Ana, recepção",
          p_ativo: true,
          p_forcar_contato_existente: false,
          p_confirmou_aviso_da_openai: true,
        },
      },
    ]);
  });

  it("adicionar sem a linha: cria desligada antes", async () => {
    registro.dados = dadosCompletos({ liberacao: null });
    await adicionarTelefoneDaIaAction({
      rotulo: "Ana",
      telefone: "84999990002",
      confirmarAvisoDaOpenai: true,
    });
    expect(registro.rpcs.map((r) => r.nome)).toEqual([
      "definir_liberacao_da_ia",
      "definir_contato_liberado_da_ia",
    ]);
    expect(registro.rpcs[0]?.args).toMatchObject({ p_liberada: false });
  });

  it("telefone inválido ou rótulo vazio: a mensagem do campo, sem banco", async () => {
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "123",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.telefoneInvalido });
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: " ",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.rotuloVazio });
    expect(registro.rpcs).toEqual([]);
  });

  it("telefone de um contato da clínica: o aviso com o nome, sem gravar; a leitura vai para a trilha", async () => {
    registro.contato = { id: "c-maria", name: "Maria Souza" };
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "(84) 99999-0002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({
      ok: false,
      error:
        "Este telefone já é de um contato da clínica (Maria Souza). Só confirme se for de alguém da equipe.",
      pedeConfirmacao: true,
    });
    expect(registro.rpcs).toEqual([]);
    expect(registro.revalidados).toEqual([]);
    expect(registro.auditorias).toEqual([
      {
        clinicId: TESTE123,
        userId: USUARIO,
        entity: "ficha_paciente",
        entityId: "c-maria",
      },
    ]);
    const tudo = JSON.stringify(registro.logs);
    expect(tudo).not.toContain("Maria");
    expect(tudo).not.toContain("99999");
  });

  it("a busca é pela chave: sem o nono dígito acha o mesmo contato; confirmação falsa não vale", async () => {
    registro.contato = { id: "c-sem-nome", name: null };
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "+558499990002",
        confirmarContato: false,
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({
      ok: false,
      error: avisoDeContatoDaClinica(null),
      pedeConfirmacao: true,
    });
    expect(registro.consultas[0]?.filtros).toContainEqual([
      "phone_key",
      "+5584999990002",
    ]);
    expect(registro.rpcs).toEqual([]);
  });

  it("com a confirmação marcada: grava, sem consultar o contato de novo", async () => {
    registro.contato = { id: "c-maria", name: "Maria Souza" };
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana, recepção",
        telefone: "84999990002",
        confirmarContato: true,
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: true });
    expect(consultasDoContato()).toEqual([]);
    expect(registro.auditorias).toEqual([]);
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_contato_liberado_da_ia",
        args: {
          p_clinic_id: TESTE123,
          p_telefone_e164: "+5584999990002",
          p_rotulo: "Ana, recepção",
          p_ativo: true,
          p_forcar_contato_existente: false,
          p_confirmou_aviso_da_openai: true,
        },
      },
    ]);
  });

  it("a conferência do contato falha: não grava às cegas", async () => {
    registro.contatoFalha = true;
    const r = await adicionarTelefoneDaIaAction({
      rotulo: "Ana",
      telefone: "84999990002",
      confirmarAvisoDaOpenai: true,
    });
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("pedeConfirmacao");
    expect(registro.rpcs).toEqual([]);
  });

  it("desligar e religar: rótulo vazio mantém o gravado", async () => {
    await alternarTelefoneDaIaAction({
      telefone: "+5584999990001",
      ligado: false,
    });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_contato_liberado_da_ia",
        args: {
          p_clinic_id: TESTE123,
          p_telefone_e164: "+5584999990001",
          p_rotulo: "",
          p_ativo: false,
        },
      },
    ]);
  });

  it("erro do banco: nunca o telefone nem o rótulo no log", async () => {
    registro.errosDoRpc.set("definir_contato_liberado_da_ia", {
      code: "22023",
    });
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana, recepção",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.telefoneInvalido });
    const tudo = JSON.stringify(registro.logs);
    expect(tudo).not.toContain("99999");
    expect(tudo).not.toContain("Ana");
    expect(registro.logs).toEqual([
      [
        "ia_liberacao_nao_alterada",
        {
          clinic_id: TESTE123,
          kind: "telefone_adicionar",
          error_code: "22023",
        },
      ],
    ]);
  });
});

describe("E3: ligar o modo e o número é só da equipe Conduzza", () => {
  const ligarOAtendimento = [
    () => definirEscolhaDaIaAction({ escolha: "equipe" }),
    () => alternarNumeroDaIaAction({ whatsappAccountId: NUMERO, ligado: true }),
  ] as const;
  const ligarTudo = [
    ...ligarOAtendimento,
    () =>
      adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
      }),
    () =>
      alternarTelefoneDaIaAction({ telefone: "+5584999990001", ligado: true }),
  ] as const;

  it("administrador da clínica: modo equipe e número com a dica da equipe Conduzza, sem banco", async () => {
    for (const acao of ligarOAtendimento) {
      expect(await acao()).toEqual({
        ok: false,
        error: TEXTOS_DA_IA.soEquipeConduzzaLiga,
      });
    }
    expect(registro.rpcs).toEqual([]);
    expect(registro.revalidados).toEqual([]);
  });

  it("administrador desliga: modo, número e telefone", async () => {
    expect(await definirEscolhaDaIaAction({ escolha: "desligado" })).toEqual({
      ok: true,
    });
    expect(
      await alternarNumeroDaIaAction({
        whatsappAccountId: NUMERO,
        ligado: false,
      }),
    ).toEqual({ ok: true });
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+5584999990001",
        ligado: false,
      }),
    ).toEqual({ ok: true });
    expect(
      registro.rpcs.map((r) => [r.nome, r.args.p_ativo ?? r.args.p_liberada]),
    ).toEqual([
      ["definir_liberacao_da_ia", false],
      ["definir_numero_da_ia", false],
      ["definir_contato_liberado_da_ia", false],
    ]);
  });

  it("super admin liga modo, número e telefone", async () => {
    registro.superAdmin = true;
    for (const acao of ligarTudo) {
      expect(await acao()).toEqual({ ok: true });
    }
  });

  it("42501 do banco ao ligar o modo ou o número vira a dica da equipe Conduzza", async () => {
    registro.superAdmin = true;
    registro.errosDoRpc.set("definir_liberacao_da_ia", {
      code: "42501",
      message: "Somente a equipe do Conduzza libera a IA.",
    });
    registro.errosDoRpc.set("definir_numero_da_ia", {
      code: "42501",
      message: "Somente a equipe do Conduzza libera a IA.",
    });
    for (const acao of ligarOAtendimento) {
      expect(await acao()).toEqual({
        ok: false,
        error: TEXTOS_DA_IA.soEquipeConduzzaLiga,
      });
    }
    // Desligar recusado continua com o texto de permissao.
    expect(
      await alternarNumeroDaIaAction({
        whatsappAccountId: NUMERO,
        ligado: false,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.semPermissao });
  });

  it("42501 do banco no telefone (adicionar, ligar ou desligar): o texto de permissão", async () => {
    registro.errosDoRpc.set("definir_contato_liberado_da_ia", {
      code: "42501",
      message:
        "Somente o administrador da clínica ou a equipe do Conduzza libera a IA.",
    });
    for (const acao of [
      () =>
        adicionarTelefoneDaIaAction({
          rotulo: "Ana",
          telefone: "84999990002",
          confirmarAvisoDaOpenai: true,
        }),
      () =>
        alternarTelefoneDaIaAction({
          telefone: "+5584999990001",
          ligado: true,
        }),
      () =>
        alternarTelefoneDaIaAction({
          telefone: "+5584999990001",
          ligado: false,
        }),
    ]) {
      expect(await acao()).toEqual({
        ok: false,
        error: TEXTOS_DA_IA.semPermissao,
      });
    }
    // sem gravacao: nem a confirmacao da OpenAI vai para a trilha
    expect(registro.inseridos).toEqual([]);
    expect(registro.revalidados).toEqual([]);
  });
});

describe("telefone da equipe pelo administrador (decisão do dono de 19/10/2026)", () => {
  it("adiciona: a RPC com a sessão, sem o forçar, com a confirmação da OpenAI para o banco gravar a trilha", async () => {
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana, recepção",
        telefone: "(84) 99999-0002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_contato_liberado_da_ia",
        args: {
          p_clinic_id: TESTE123,
          p_telefone_e164: "+5584999990002",
          p_rotulo: "Ana, recepção",
          p_ativo: true,
          p_forcar_contato_existente: false,
          p_confirmou_aviso_da_openai: true,
        },
      },
    ]);
    // A trilha da confirmacao e do banco, na mesma transacao (migration
    // 20261019120000): a action nao grava audit_log nenhum.
    expect(registro.inseridos).toEqual([]);
    expect(registro.revalidados).toEqual(["/configuracoes"]);
  });

  it("sem a confirmação do aviso da OpenAI: o texto do campo, sem banco", async () => {
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: false,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.avisoDaOpenaiObrigatorio });
    expect(registro.rpcs).toEqual([]);
    expect(registro.inseridos).toEqual([]);
  });

  it("liga de novo: a RPC com a sessão, ligado, sem o forçar e com o rótulo gravado", async () => {
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+5584999990001",
        ligado: true,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_contato_liberado_da_ia",
        args: {
          p_clinic_id: TESTE123,
          p_telefone_e164: "+5584999990001",
          p_rotulo: "",
          p_ativo: true,
        },
      },
    ]);
    expect(registro.revalidados).toEqual(["/configuracoes"]);
  });

  it("o forçar de quem não é super admin para antes do banco, sem ler o contato", async () => {
    registro.contato = { id: "c-maria", name: "Maria Souza" };
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
        forcarContatoDePaciente: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.soEquipeConduzzaForca });
    expect(registro.rpcs).toEqual([]);
    expect(registro.consultas).toEqual([]);
    expect(registro.auditorias).toEqual([]);
    expect(registro.inseridos).toEqual([]);
    // o forcar desmarcado segue o caminho normal
    registro.contato = null;
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
        forcarContatoDePaciente: false,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs.at(-1)?.args).toMatchObject({
      p_forcar_contato_existente: false,
    });
  });

  it("telefone de paciente: o texto, sem a opção de forçar", async () => {
    registro.errosDoRpc.set("definir_contato_liberado_da_ia", {
      code: "23514",
      message: "contato_de_paciente",
    });
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarContato: true,
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.contatoDePaciente });
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+5584999990001",
        ligado: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.contatoDePaciente });
    expect(registro.inseridos).toEqual([]);
  });

  it("número de WhatsApp do Conduzza: o texto, nada na trilha", async () => {
    registro.errosDoRpc.set("definir_contato_liberado_da_ia", {
      code: "23514",
      message: "telefone_invalido_para_equipe",
    });
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.telefoneDaPlataforma });
    expect(registro.inseridos).toEqual([]);
  });

  it("telefone de um contato da clínica: o aviso com o nome e a leitura na trilha, como para o super admin", async () => {
    registro.contato = { id: "c-maria", name: "Maria Souza" };
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({
      ok: false,
      error: avisoDeContatoDaClinica("Maria Souza"),
      pedeConfirmacao: true,
    });
    expect(registro.rpcs).toEqual([]);
    expect(registro.auditorias).toEqual([
      {
        clinicId: TESTE123,
        userId: USUARIO,
        entity: "ficha_paciente",
        entityId: "c-maria",
      },
    ]);
  });

  it("gestor e os demais papéis continuam sem adicionar e sem ligar", async () => {
    for (const papel of ["gestor", "recepcao", "profissional", "leitura"]) {
      registro.papel = papel;
      expect(
        await alternarTelefoneDaIaAction({
          telefone: "+5584999990001",
          ligado: true,
        }),
      ).toEqual({ ok: false, error: TEXTOS_DA_IA.semPermissao });
      expect(
        await adicionarTelefoneDaIaAction({
          rotulo: "Ana",
          telefone: "84999990002",
          confirmarAvisoDaOpenai: true,
        }),
      ).toEqual({ ok: false, error: TEXTOS_DA_IA.semPermissao });
    }
    expect(registro.rpcs).toEqual([]);
    expect(registro.consultas).toEqual([]);
  });
});

describe("E3: telefone novo da equipe", () => {
  beforeEach(() => {
    registro.superAdmin = true;
  });

  it("sem a confirmação do aviso da OpenAI: o texto do campo, sem banco", async () => {
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: false,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.avisoDaOpenaiObrigatorio });
    expect(registro.rpcs).toEqual([]);
  });

  it("gravou: a confirmação vai ao banco, que grava a trilha; a action não relê a linha nem grava audit_log", async () => {
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs.at(-1)?.args).toMatchObject({
      p_confirmou_aviso_da_openai: true,
    });
    expect(
      registro.consultas.filter((c) => c.tabela === "ia_contato_liberado"),
    ).toEqual([]);
    expect(registro.inseridos).toEqual([]);
  });

  it("o banco recusou o número da plataforma: o texto genérico, nada na trilha", async () => {
    registro.errosDoRpc.set("definir_contato_liberado_da_ia", {
      code: "23514",
      message: "telefone_invalido_para_equipe",
    });
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.telefoneDaPlataforma });
    expect(registro.inseridos).toEqual([]);
  });

  it("telefone de paciente: o texto, com pedeForcar só para o super admin", async () => {
    registro.errosDoRpc.set("definir_contato_liberado_da_ia", {
      code: "23514",
      message: "contato_de_paciente",
    });
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({
      ok: false,
      error: TEXTOS_DA_IA.contatoDePaciente,
      pedeForcar: true,
    });
    // Ligar um telefone que ja esta na lista: o texto, sem a opcao.
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+5584999990001",
        ligado: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.contatoDePaciente });
  });

  it("forçar: vai ao banco por nome de parâmetro", async () => {
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
        forcarContatoDePaciente: true,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs.at(-1)).toEqual({
      nome: "definir_contato_liberado_da_ia",
      args: {
        p_clinic_id: TESTE123,
        p_telefone_e164: "+5584999990002",
        p_rotulo: "Ana",
        p_ativo: true,
        p_forcar_contato_existente: true,
        p_confirmou_aviso_da_openai: true,
      },
    });
  });
});

// Revisao de producao de 19/10/2026 (mudancas-1910.md A2; migration
// 20261019120000): telefone novo so entra pelo formulario de adicionar, com
// a confirmacao do aviso da OpenAI no banco; o "Ligar de novo" so vale para
// telefone que ja esta na lista.
describe("confirmação da OpenAI no banco e Ligar de novo só da lista (19/10/2026)", () => {
  it("ligar telefone fora da lista: recusado antes do banco, com o texto do formulário", async () => {
    registro.linhaDoTelefone = null;
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+5584999990009",
        ligado: true,
      }),
    ).toEqual({
      ok: false,
      error:
        "Este telefone não está na lista da equipe. Adicione o telefone pelo formulário.",
    });
    expect(registro.rpcs).toEqual([]);
    expect(registro.revalidados).toEqual([]);
    // a conferencia e pela chave canonica, na clinica ativa
    expect(
      registro.consultas.find((c) => c.tabela === "ia_contato_liberado")
        ?.filtros,
    ).toEqual([
      ["clinic_id", TESTE123],
      ["phone_key", "+5584999990009"],
    ]);
  });

  it("a conferência da lista pela chave: sem o nono dígito acha a mesma linha", async () => {
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+558499990001",
        ligado: true,
      }),
    ).toEqual({ ok: true });
    expect(
      registro.consultas.find((c) => c.tabela === "ia_contato_liberado")
        ?.filtros,
    ).toContainEqual(["phone_key", "+5584999990001"]);
    expect(registro.rpcs).toHaveLength(1);
  });

  it("a leitura da lista falhou: não liga às cegas", async () => {
    registro.linhaDoTelefoneFalha = true;
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+5584999990001",
        ligado: true,
      }),
    ).toEqual({
      ok: false,
      error:
        "Não foi possível conferir a configuração do assistente. Recarregue a página e tente de novo.",
    });
    expect(registro.rpcs).toEqual([]);
  });

  it("desligar vai direto ao banco (que não cria linha para telefone fora da lista)", async () => {
    registro.linhaDoTelefone = null;
    expect(
      await alternarTelefoneDaIaAction({
        telefone: "+5584999990009",
        ligado: false,
      }),
    ).toEqual({ ok: true });
    expect(
      registro.consultas.filter((c) => c.tabela === "ia_contato_liberado"),
    ).toEqual([]);
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_contato_liberado_da_ia",
        args: {
          p_clinic_id: TESTE123,
          p_telefone_e164: "+5584999990009",
          p_rotulo: "",
          p_ativo: false,
        },
      },
    ]);
  });

  it("o Ligar de novo nunca manda a confirmação (ela é do formulário de adicionar)", async () => {
    await alternarTelefoneDaIaAction({
      telefone: "+5584999990001",
      ligado: true,
    });
    expect(registro.rpcs.at(-1)?.args).not.toHaveProperty(
      "p_confirmou_aviso_da_openai",
    );
  });

  it("o banco recusa telefone novo sem a confirmação: o texto do campo, nada na trilha", async () => {
    registro.errosDoRpc.set("definir_contato_liberado_da_ia", {
      code: "23514",
      message: "aviso_da_openai_nao_confirmado",
    });
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.avisoDaOpenaiObrigatorio });
    expect(registro.inseridos).toEqual([]);
    expect(registro.logs).toEqual([
      [
        "ia_liberacao_nao_alterada",
        {
          clinic_id: TESTE123,
          kind: "telefone_adicionar",
          error_code: "23514",
        },
      ],
    ]);
  });

  it("o super admin também manda a confirmação, e a action nunca grava a trilha sozinha", async () => {
    registro.superAdmin = true;
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "Ana",
        telefone: "84999990002",
        confirmarAvisoDaOpenai: true,
      }),
    ).toEqual({ ok: true });
    expect(registro.rpcs.at(-1)?.args).toMatchObject({
      p_ativo: true,
      p_confirmou_aviso_da_openai: true,
    });
    expect(registro.inseridos).toEqual([]);
  });
});
