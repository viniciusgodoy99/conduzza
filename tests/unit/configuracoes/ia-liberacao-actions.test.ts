import { beforeEach, describe, expect, it, vi } from "vitest";

// As Server Actions da aba "Agente de IA" (Fase 3), com a sessao, o cliente
// do Supabase, as leituras e o log trocados por dubles que guardam tudo o
// que a action mandou. O que se prova aqui:
//   - a guarda: a aba so existe nas duas clinicas da fase controlada (a
//     mesma abaDaIaVisivel da pagina, de verdade) e so o administrador da
//     clinica ou o super admin chega ao banco; gestor, nao. O interruptor
//     geral, so o super admin;
//   - o Zod estrito de cada entrada;
//   - cada acao vira a RPC certa, com a sessao; "Conversar com a equipe"
//     exige numero e telefone; numero so conectado, e uma RPC so para
//     trocar (o banco desliga os outros na mesma transacao); numero e
//     telefone criam a linha desligada quando ela falta; o telefone vira
//     E.164 com o 55;
//   - telefone que ja e de um contato da clinica (pela chave canonica) so
//     entra com a confirmacao explicita: sem ela, o aviso com o nome e a
//     leitura na trilha, sem gravar;
//   - 42501 vira texto de permissao; telefone e nome nunca vao para log.
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
  numeros: { whatsappAccountId: string; ativo: boolean }[];
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
  papel: "admin" as string,
  superAdmin: false,
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  /** Erro por nome de RPC (a primeira chamada com aquele nome em diante). */
  errosDoRpc: new Map<string, { code?: string }>(),
  /** Erro so na chamada de numero com este id e este ativo. */
  erroNoNumero: null as null | { id: string; ativo: boolean; code: string },
  dados: null as unknown,
  dadosFalham: false,
  numeroDaClinica: null as null | { id: string; connectionStatus: string },
  /** O contato da clinica com o telefone consultado (nulo: nenhum). */
  contato: null as null | { id: string; name: string | null },
  contatoFalha: false,
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
        maybeSingle: async () =>
          registro.contatoFalha
            ? { data: null, error: { code: "XX000" } }
            : { data: registro.contato, error: null },
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
    fetchLiberacaoDaIa: async () => {
      if (registro.dadosFalham) {
        throw new Error("falhou");
      }
      return registro.dados;
    },
    fetchNumeroDaClinica: async () => registro.numeroDaClinica,
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
  alternarTelefoneDaIaAction,
  definirEscolhaDaIaAction,
  definirInterruptorGeralAction,
  escolherNumeroDaIaAction,
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
    numeros: [{ whatsappAccountId: NUMERO, ativo: true }],
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
  registro.papel = "admin";
  registro.superAdmin = false;
  registro.rpcs = [];
  registro.errosDoRpc = new Map();
  registro.erroNoNumero = null;
  registro.dados = dadosCompletos();
  registro.dadosFalham = false;
  registro.numeroDaClinica = { id: NUMERO, connectionStatus: "conectado" };
  registro.contato = null;
  registro.contatoFalha = false;
  registro.consultas = [];
  registro.auditorias = [];
  registro.revalidados = [];
  registro.logs = [];
});

const todasAsAcoes = [
  () => definirEscolhaDaIaAction({ escolha: "simulador" }),
  () => escolherNumeroDaIaAction({ whatsappAccountId: NUMERO, usar: true }),
  () => adicionarTelefoneDaIaAction({ rotulo: "Ana", telefone: "84999990002" }),
  () =>
    alternarTelefoneDaIaAction({ telefone: "+5584999990001", ligado: false }),
] as const;

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
      () => escolherNumeroDaIaAction({ whatsappAccountId: "x", usar: true }),
      () => escolherNumeroDaIaAction({ whatsappAccountId: NUMERO }),
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

  it("conversar com a equipe sem número, sem telefone ou com número que saiu: recusado", async () => {
    for (const dados of [
      dadosCompletos({ numeros: [] }),
      dadosCompletos({
        numeros: [{ whatsappAccountId: NUMERO, ativo: false }],
      }),
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

  it("leitura que falha: não liga a equipe às cegas", async () => {
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

describe("número do assistente", () => {
  it("usar com outro ligado: uma RPC só (o banco desliga os outros na mesma transação)", async () => {
    registro.dados = dadosCompletos({
      numeros: [{ whatsappAccountId: OUTRO_NUMERO, ativo: true }],
    });
    expect(
      await escolherNumeroDaIaAction({ whatsappAccountId: NUMERO, usar: true }),
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
    expect(registro.revalidados).toEqual(["/configuracoes"]);
  });

  it("se o banco recusa, nada muda na tela: o erro, sem revalidar", async () => {
    registro.erroNoNumero = { id: NUMERO, ativo: true, code: "23514" };
    expect(
      await escolherNumeroDaIaAction({ whatsappAccountId: NUMERO, usar: true }),
    ).toEqual({
      ok: false,
      error: "Este número foi removido da clínica. Recarregue a página.",
    });
    expect(registro.rpcs).toHaveLength(1);
    expect(registro.revalidados).toEqual([]);
  });

  it("sem a linha de liberação: cria desligada antes do número", async () => {
    registro.dados = dadosCompletos({ liberacao: null, numeros: [] });
    await escolherNumeroDaIaAction({ whatsappAccountId: NUMERO, usar: true });
    expect(registro.rpcs.map((r) => [r.nome, r.args.p_liberada])).toEqual([
      ["definir_liberacao_da_ia", false],
      ["definir_numero_da_ia", undefined],
    ]);
  });

  it("com a linha: nunca religa nem desliga a clínica", async () => {
    registro.dados = dadosCompletos({ numeros: [] });
    await escolherNumeroDaIaAction({ whatsappAccountId: NUMERO, usar: true });
    expect(registro.rpcs.map((r) => r.nome)).toEqual(["definir_numero_da_ia"]);
  });

  it("número desconectado ou fora da clínica: recusado sem banco", async () => {
    registro.numeroDaClinica = { id: NUMERO, connectionStatus: "desconectado" };
    expect(
      await escolherNumeroDaIaAction({ whatsappAccountId: NUMERO, usar: true }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.conecteAntes });
    registro.numeroDaClinica = {
      id: NUMERO,
      connectionStatus: "aguardando_qr",
    };
    expect(
      await escolherNumeroDaIaAction({ whatsappAccountId: NUMERO, usar: true }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.conecteAntes });
    registro.numeroDaClinica = null;
    const r = await escolherNumeroDaIaAction({
      whatsappAccountId: NUMERO,
      usar: true,
    });
    expect(r.ok).toBe(false);
    expect(registro.rpcs).toEqual([]);
  });

  it("parar de usar: uma RPC só, mesmo desconectado", async () => {
    registro.numeroDaClinica = { id: NUMERO, connectionStatus: "desconectado" };
    expect(
      await escolherNumeroDaIaAction({
        whatsappAccountId: NUMERO,
        usar: false,
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
  it("adicionar: E.164 com o 55, rótulo aparado, ligado", async () => {
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: "  Ana, recepção ",
        telefone: "(84) 99999-0002",
      }),
    ).toEqual({ ok: true });
    // conferiu antes se o telefone e de um contato da clinica (nao era)
    expect(registro.consultas).toEqual([
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
        },
      },
    ]);
  });

  it("adicionar sem a linha: cria desligada antes", async () => {
    registro.dados = dadosCompletos({ liberacao: null });
    await adicionarTelefoneDaIaAction({
      rotulo: "Ana",
      telefone: "84999990002",
    });
    expect(registro.rpcs.map((r) => r.nome)).toEqual([
      "definir_liberacao_da_ia",
      "definir_contato_liberado_da_ia",
    ]);
    expect(registro.rpcs[0]?.args).toMatchObject({ p_liberada: false });
  });

  it("telefone inválido ou rótulo vazio: a mensagem do campo, sem banco", async () => {
    expect(
      await adicionarTelefoneDaIaAction({ rotulo: "Ana", telefone: "123" }),
    ).toEqual({ ok: false, error: TEXTOS_DA_IA.telefoneInvalido });
    expect(
      await adicionarTelefoneDaIaAction({
        rotulo: " ",
        telefone: "84999990002",
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
      }),
    ).toEqual({ ok: true });
    expect(registro.consultas).toEqual([]);
    expect(registro.auditorias).toEqual([]);
    expect(registro.rpcs).toEqual([
      {
        nome: "definir_contato_liberado_da_ia",
        args: {
          p_clinic_id: TESTE123,
          p_telefone_e164: "+5584999990002",
          p_rotulo: "Ana, recepção",
          p_ativo: true,
        },
      },
    ]);
  });

  it("a conferência do contato falha: não grava às cegas", async () => {
    registro.contatoFalha = true;
    const r = await adicionarTelefoneDaIaAction({
      rotulo: "Ana",
      telefone: "84999990002",
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
