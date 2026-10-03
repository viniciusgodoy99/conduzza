import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEXTOS_DA_LEITURA } from "@/components/configuracoes/investimento-meta";
import { textoDoProblemaDeLeitura } from "@/lib/domain/meta-anuncios";

// As Server Actions da leitura do investimento da Meta (Fase 4, critica
// 4.4), com a sessao, os dois clientes do Supabase, a integracao com a Meta
// e o log trocados por dubles que guardam tudo o que a action mandou. O que
// se prova aqui:
//   - a guarda: so administrador e gestor chegam ao banco e a Meta;
//   - o Zod do token (o mesmo formato que a integracao aceita, com trim);
//   - o token NUNCA aparece no resultado, na auditoria, no log nem na
//     situacao gravada; so vai para o segredo e para a chamada da Meta;
//   - a situacao gravada so leva as colunas permitidas (nunca
//     ad_account_id, lido_*, sincronizado_em, tentado_em, ultimo_diario_dia
//     nem atualizacao_pedida_em);
//   - salvar testa em seguida e salva mesmo se o teste falhar;
//   - o teste que deu certo pede a leitura com a origem 'configuracao';
//   - "Atualizar agora" passa pela funcao do banco e traduz cada codigo;
//   - a conta de anuncios e gravada sempre como act_<digitos>.
// O revoke do segredo, as policies e as funcoes de verdade estao nos testes
// de RLS e integracao da frente do banco.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";
const TOKEN = "EAAGtokendeleituradeteste1234567890abcdef";
const CONTA = "act_123456789";

type Erro = { code?: string; message?: string } | null;
type Resultado = { data: unknown; error: Erro };
type Chamada = {
  cliente: "sessao" | "admin";
  tabela: string;
  op: "select" | "insert" | "upsert" | "update";
  valores?: Record<string, unknown>;
  opcoes?: unknown;
  filtros: [string, unknown][];
};

const registro = vi.hoisted(() => ({
  papel: "admin" as string,
  comSessao: true,
  timezone: "America/Fortaleza",
  conta: "act_123456789" as string | null,
  token: null as string | null,
  erroDaLeituraDoSegredo: null as Erro,
  erroDaEscritaDoSegredo: null as Erro,
  erroDaSituacao: null as Erro,
  chamadas: [] as Chamada[],
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  respostaDoRpc: { data: { codigo: "enfileirado" }, error: null } as {
    data: unknown;
    error: Erro;
  },
  testes: [] as Record<string, unknown>[],
  respostaDoTeste: null as unknown,
  aoTestar: null as (() => void) | null,
  logs: [] as [string, unknown][],
}));

function resultadoPara(c: Chamada): Resultado {
  if (c.cliente === "sessao" && c.tabela === "meta_ads_account") {
    if (c.op === "select") {
      return {
        data: registro.conta === null ? null : { ad_account_id: registro.conta },
        error: null,
      };
    }
    return { data: null, error: null };
  }
  if (c.cliente === "admin" && c.tabela === "meta_ads_account_secret") {
    if (c.op === "select") {
      return registro.erroDaLeituraDoSegredo
        ? { data: null, error: registro.erroDaLeituraDoSegredo }
        : { data: { insights_access_token: registro.token }, error: null };
    }
    if (registro.erroDaEscritaDoSegredo) {
      return { data: null, error: registro.erroDaEscritaDoSegredo };
    }
    if (c.op === "upsert") {
      registro.token = String(c.valores?.insights_access_token ?? "");
    }
    if (c.op === "update") {
      registro.token = null;
    }
    return { data: null, error: null };
  }
  if (c.cliente === "admin" && c.tabela === "meta_gasto_leitura") {
    return { data: null, error: registro.erroDaSituacao };
  }
  return { data: null, error: null };
}

type Cadeia = {
  select: (colunas?: string) => Cadeia;
  eq: (coluna: string, valor: unknown) => Cadeia;
  not: (...args: unknown[]) => Cadeia;
  maybeSingle: () => Promise<Resultado>;
  then: <T>(
    ok: (r: Resultado) => T,
    falha?: (e: unknown) => T,
  ) => Promise<T>;
};

function tabela(cliente: Chamada["cliente"], nome: string) {
  const comecar = (
    op: Chamada["op"],
    valores?: Record<string, unknown>,
    opcoes?: unknown,
  ): Cadeia => {
    const chamada: Chamada = { cliente, tabela: nome, op, valores, opcoes, filtros: [] };
    const resolver = () => {
      registro.chamadas.push(chamada);
      return resultadoPara(chamada);
    };
    const cadeia: Cadeia = {
      select: () => cadeia,
      eq: (coluna, valor) => {
        chamada.filtros.push([coluna, valor]);
        return cadeia;
      },
      not: () => cadeia,
      maybeSingle: () => Promise.resolve(resolver()),
      then: (ok, falha) => Promise.resolve(resolver()).then(ok, falha),
    };
    return cadeia;
  };
  return {
    select: () => comecar("select"),
    insert: (valores: Record<string, unknown>) => comecar("insert", valores),
    upsert: (valores: Record<string, unknown>, opcoes?: unknown) =>
      comecar("upsert", valores, opcoes),
    update: (valores: Record<string, unknown>) => comecar("update", valores),
  };
}

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (nome: string) => tabela("sessao", nome),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (nome: string) => tabela("admin", nome),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      registro.rpcs.push({ nome, args });
      return registro.respostaDoRpc;
    },
  }),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () =>
    registro.comSessao
      ? {
          userId: USUARIO,
          active: {
            clinicId: CLINICA,
            role: registro.papel,
            status: "ativo",
            timezone: registro.timezone,
          },
        }
      : null,
}));
vi.mock("@/lib/integrations/meta/insights", () => ({
  testarLeituraDeAnuncios: async (config: Record<string, unknown>) => {
    registro.testes.push(config);
    registro.aoTestar?.();
    return registro.respostaDoTeste;
  },
}));
vi.mock("@/lib/log", () => ({
  log: {
    info: (evento: string, campos: unknown) => registro.logs.push([evento, campos]),
    warn: (evento: string, campos: unknown) => registro.logs.push([evento, campos]),
    error: (evento: string, campos: unknown) => registro.logs.push([evento, campos]),
  },
}));

const {
  salvarTokenDeLeituraMetaAction,
  testarLeituraMetaAction,
  removerTokenDeLeituraMetaAction,
} = await import("@/app/(app)/configuracoes/anuncios-meta-actions");
const { atualizarInvestimentoMetaAction } = await import(
  "@/lib/actions/investimento-meta"
);
const { salvarContaMetaAction } = await import("@/app/(app)/configuracoes/actions");

const SUCESSO = {
  ok: true,
  conta: {
    id: CONTA,
    nome: "Clínica Sorriso Ads",
    moeda: "BRL",
    fuso: "America/Fortaleza",
    status: 1,
    ativa: true,
  },
  temGastoEm30Dias: true,
};

const TOKEN_RECUSADO = {
  ok: false,
  problema: "token_invalido",
  acao: "pausar",
  tentarEmMs: null,
  codigoDaMeta: 190,
  subcodigoDaMeta: 463,
  http: 400,
};

const COLUNAS_PROIBIDAS = [
  "ad_account_id",
  "lido_desde",
  "lido_ate",
  "sincronizado_em",
  "tentado_em",
  "ultimo_diario_dia",
  "atualizacao_pedida_em",
];

function escritasDaSituacao(): Record<string, unknown>[] {
  return registro.chamadas
    .filter((c) => c.tabela === "meta_gasto_leitura" && c.op !== "select")
    .map((c) => c.valores ?? {});
}

function auditorias(): Record<string, unknown>[] {
  return registro.chamadas
    .filter((c) => c.tabela === "audit_log")
    .map((c) => c.valores ?? {});
}

/** Tudo o que nao pode carregar o token: resultado, auditoria, log, situacao. */
function semToken(resultado: unknown) {
  const expostos = JSON.stringify({
    resultado,
    auditorias: auditorias(),
    logs: registro.logs,
    situacao: escritasDaSituacao(),
    rpcs: registro.rpcs,
  });
  expect(expostos).not.toContain(TOKEN);
  expect(expostos).not.toContain(TOKEN.slice(4, 24));
}

beforeEach(() => {
  registro.papel = "admin";
  registro.comSessao = true;
  registro.timezone = "America/Fortaleza";
  registro.conta = CONTA;
  registro.token = null;
  registro.erroDaLeituraDoSegredo = null;
  registro.erroDaEscritaDoSegredo = null;
  registro.erroDaSituacao = null;
  registro.chamadas = [];
  registro.rpcs = [];
  registro.respostaDoRpc = { data: { codigo: "enfileirado" }, error: null };
  registro.testes = [];
  registro.respostaDoTeste = SUCESSO;
  registro.aoTestar = null;
  registro.logs = [];
});

describe("guarda de papel", () => {
  it.each(["recepcao", "profissional", "leitura"])(
    "%s não chega ao banco nem à Meta",
    async (papel) => {
      registro.papel = papel;
      registro.token = TOKEN;
      const resultados = [
        await salvarTokenDeLeituraMetaAction({ insights_access_token: TOKEN }),
        await testarLeituraMetaAction(),
        await removerTokenDeLeituraMetaAction(),
        await atualizarInvestimentoMetaAction(),
      ];
      for (const resultado of resultados) {
        expect(resultado).toMatchObject({
          ok: false,
          error: TEXTOS_DA_LEITURA.semPermissao,
        });
      }
      expect(registro.chamadas).toEqual([]);
      expect(registro.rpcs).toEqual([]);
      expect(registro.testes).toEqual([]);
    },
  );

  it("sessão expirada pede para entrar de novo", async () => {
    registro.comSessao = false;
    expect(await testarLeituraMetaAction()).toEqual({
      ok: false,
      error: TEXTOS_DA_LEITURA.sessaoExpirada,
    });
    expect(await atualizarInvestimentoMetaAction()).toEqual({
      ok: false,
      error: TEXTOS_DA_LEITURA.sessaoExpirada,
    });
    expect(registro.chamadas).toEqual([]);
  });

  it("gestor passa", async () => {
    registro.papel = "gestor";
    const resultado = await salvarTokenDeLeituraMetaAction({
      insights_access_token: TOKEN,
    });
    expect(resultado.ok).toBe(true);
  });
});

describe("salvar o token de leitura", () => {
  it.each([
    ["curto", "EAAcurto"],
    ["com espaço no meio", "EAAGtokende leituradeteste1234567890"],
    ["com acento", "EAAGtokendeleituráteste1234567890abc"],
    ["vazio", ""],
    ["número", 12345],
  ])("recusa token %s sem gravar nada", async (_caso, valor) => {
    const resultado = await salvarTokenDeLeituraMetaAction({
      insights_access_token: valor,
    });
    expect(resultado).toEqual({
      ok: false,
      error: TEXTOS_DA_LEITURA.tokenInvalido,
      tokenSalvo: false,
    });
    expect(registro.chamadas).toEqual([]);
    expect(registro.testes).toEqual([]);
  });

  it("aceita o token com espaço nas pontas e grava sem eles, só na coluna de leitura", async () => {
    await salvarTokenDeLeituraMetaAction({
      insights_access_token: `  ${TOKEN}\n`,
    });
    const escrita = registro.chamadas.find(
      (c) => c.tabela === "meta_ads_account_secret" && c.op === "upsert",
    );
    expect(escrita?.cliente).toBe("admin");
    // So a coluna do token de leitura: o token da CAPI fica como esta.
    expect(escrita?.valores).toEqual({
      clinic_id: CLINICA,
      insights_access_token: TOKEN,
    });
    expect(escrita?.opcoes).toEqual({ onConflict: "clinic_id" });
  });

  it("salva, tira a pausa, testa com a conta salva e pede a primeira leitura", async () => {
    const antes = Date.now();
    const resultado = await salvarTokenDeLeituraMetaAction({
      insights_access_token: TOKEN,
    });

    expect(resultado).toEqual({
      ok: true,
      conta: {
        nome: "Clínica Sorriso Ads",
        adAccountId: CONTA,
        moeda: "BRL",
        fuso: "America/Fortaleza",
        ativa: true,
      },
      temGasto: true,
      avisos: [],
      leituraPedida: true,
    });

    // A chamada da Meta: a conta e o token salvos, com o prazo da tela.
    expect(registro.testes).toHaveLength(1);
    const config = registro.testes[0]!;
    expect(config.adAccountId).toBe(CONTA);
    expect(config.accessToken).toBe(TOKEN);
    expect(config.timeoutMs).toBe(6_000);
    expect(config.maxRetries).toBe(1);
    expect(Number(config.prazoEm)).toBeGreaterThanOrEqual(antes + 15_000);
    expect(Number(config.prazoEm)).toBeLessThanOrEqual(Date.now() + 15_000);

    // Primeiro "nao testada" (tira a pausa), depois o resultado do teste.
    const [reinicio, situacao] = escritasDaSituacao();
    expect(reinicio).toEqual({
      clinic_id: CLINICA,
      situacao: "nao_testada",
      problema: null,
      codigo_da_meta: null,
    });
    expect(situacao).toMatchObject({
      clinic_id: CLINICA,
      situacao: "funcionando",
      problema: null,
      codigo_da_meta: null,
      nome_da_conta: "Clínica Sorriso Ads",
      moeda: "BRL",
      fuso_da_conta: "America/Fortaleza",
      conta_ativa: true,
    });
    expect(Number.isNaN(Date.parse(String(situacao?.testada_em)))).toBe(false);
    for (const escrita of escritasDaSituacao()) {
      for (const coluna of COLUNAS_PROIBIDAS) {
        expect(escrita).not.toHaveProperty(coluna);
      }
    }
    expect(
      registro.chamadas
        .filter((c) => c.tabela === "meta_gasto_leitura")
        .every((c) => c.cliente === "admin"),
    ).toBe(true);

    // A funcao do banco, pelo cliente de servico, com a origem certa e sem
    // o parametro dos testes de integracao.
    expect(registro.rpcs).toEqual([
      {
        nome: "enfileirar_sincronizacao_de_gasto_meta",
        args: { p_clinic_id: CLINICA, p_origem: "configuracao" },
      },
    ]);

    // Auditoria sem valor nenhum: quem, o que e a clinica.
    expect(auditorias()).toEqual([
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "atualizou_token_leitura_meta",
        entity: "meta_ads_account_secret",
        entity_id: CLINICA,
      },
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "testou_leitura_meta",
        entity: "meta_gasto_leitura",
        entity_id: CLINICA,
      },
    ]);
    semToken(resultado);
  });

  it("sem conta salva: guarda o token e não chama a Meta", async () => {
    registro.conta = null;
    const resultado = await salvarTokenDeLeituraMetaAction({
      insights_access_token: TOKEN,
    });
    expect(resultado).toEqual({
      ok: false,
      error: TEXTOS_DA_LEITURA.tokenSalvoSemConta,
      tokenSalvo: true,
    });
    expect(registro.token).toBe(TOKEN);
    expect(registro.testes).toEqual([]);
    expect(registro.rpcs).toEqual([]);
    semToken(resultado);
  });

  it("teste que falha: o token fica salvo e a situação grava o problema", async () => {
    registro.respostaDoTeste = TOKEN_RECUSADO;
    const resultado = await salvarTokenDeLeituraMetaAction({
      insights_access_token: TOKEN,
    });
    expect(resultado).toEqual({
      ok: false,
      error: textoDoProblemaDeLeitura("token_invalido", {
        adAccountId: CONTA,
        codigo: 190,
      }),
      problema: "token_invalido",
      tokenSalvo: true,
    });
    expect(registro.token).toBe(TOKEN);
    const situacao = escritasDaSituacao().at(-1);
    expect(situacao).toMatchObject({
      clinic_id: CLINICA,
      situacao: "com_problema",
      problema: "token_invalido",
      codigo_da_meta: 190,
    });
    expect(Object.keys(situacao ?? {}).sort()).toEqual(
      ["clinic_id", "codigo_da_meta", "problema", "situacao", "testada_em"].sort(),
    );
    // Teste que falhou nao pede leitura.
    expect(registro.rpcs).toEqual([]);
    semToken(resultado);
  });

  it("falha ao gravar o segredo: nada de teste e a tela diz que não salvou", async () => {
    registro.erroDaEscritaDoSegredo = { code: "XX000", message: "falhou" };
    const resultado = await salvarTokenDeLeituraMetaAction({
      insights_access_token: TOKEN,
    });
    expect(resultado).toEqual({
      ok: false,
      error: TEXTOS_DA_LEITURA.tokenNaoSalvo,
      tokenSalvo: false,
    });
    expect(registro.testes).toEqual([]);
    expect(auditorias()).toEqual([]);
    // O log leva so o codigo.
    expect(registro.logs).toEqual([
      [
        "leitura_meta_token_nao_salvo",
        { clinic_id: CLINICA, error_code: "XX000" },
      ],
    ]);
    semToken(resultado);
  });
});

describe("testar a leitura", () => {
  it("sem token salvo: não chama a Meta e diz o que falta", async () => {
    registro.token = null;
    expect(await testarLeituraMetaAction()).toEqual({
      ok: false,
      error: TEXTOS_DA_LEITURA.semConfiguracao,
    });
    expect(registro.testes).toEqual([]);
  });

  it("sem conta salva: idem", async () => {
    registro.token = TOKEN;
    registro.conta = null;
    expect(await testarLeituraMetaAction()).toEqual({
      ok: false,
      error: TEXTOS_DA_LEITURA.semConfiguracao,
    });
    expect(registro.testes).toEqual([]);
  });

  it("segredo ilegível: não testa", async () => {
    registro.token = TOKEN;
    registro.erroDaLeituraDoSegredo = { code: "42501" };
    expect(await testarLeituraMetaAction()).toEqual({
      ok: false,
      error: TEXTOS_DA_LEITURA.configuracaoIlegivel,
    });
    expect(registro.testes).toEqual([]);
  });

  it("lê o token pelo cliente de serviço e a conta pela sessão", async () => {
    registro.token = TOKEN;
    await testarLeituraMetaAction();
    const segredo = registro.chamadas.filter(
      (c) => c.tabela === "meta_ads_account_secret",
    );
    const conta = registro.chamadas.filter((c) => c.tabela === "meta_ads_account");
    expect(segredo.length).toBeGreaterThan(0);
    expect(segredo.every((c) => c.cliente === "admin")).toBe(true);
    expect(conta.length).toBeGreaterThan(0);
    expect(conta.every((c) => c.cliente === "sessao")).toBe(true);
    for (const c of [...segredo, ...conta]) {
      expect(c.filtros).toContainEqual(["clinic_id", CLINICA]);
    }
  });

  it("avisa moeda estrangeira, conta inativa e fuso com outro horário", async () => {
    registro.token = TOKEN;
    registro.respostaDoTeste = {
      ...SUCESSO,
      conta: {
        ...SUCESSO.conta,
        moeda: "USD",
        fuso: "America/Los_Angeles",
        status: 2,
        ativa: false,
      },
      temGastoEm30Dias: false,
    };
    const resultado = await testarLeituraMetaAction();
    expect(resultado).toMatchObject({
      ok: true,
      temGasto: false,
      avisos: ["outra_moeda", "conta_inativa", "outro_fuso"],
    });
  });

  it("fuso de outro nome com o mesmo horário não avisa", async () => {
    registro.token = TOKEN;
    registro.respostaDoTeste = {
      ...SUCESSO,
      conta: { ...SUCESSO.conta, fuso: "America/Sao_Paulo" },
    };
    const resultado = await testarLeituraMetaAction();
    expect(resultado).toMatchObject({ ok: true, avisos: [] });
  });

  it("conta ou token que mudou durante o teste: não grava o resultado", async () => {
    registro.token = TOKEN;
    registro.aoTestar = () => {
      registro.token = "EAAGoutrotokensalvonomeiodoteste0987654321";
    };
    const resultado = await testarLeituraMetaAction();
    expect(resultado).toEqual({
      ok: false,
      error: TEXTOS_DA_LEITURA.mudouDuranteOTeste,
    });
    expect(escritasDaSituacao()).toEqual([]);
    expect(registro.rpcs).toEqual([]);
    semToken(resultado);
  });

  it("situação que não grava: avisa em vez de dizer que funcionou", async () => {
    registro.token = TOKEN;
    registro.erroDaSituacao = { code: "23514" };
    const resultado = await testarLeituraMetaAction();
    expect(resultado).toEqual({
      ok: false,
      error: TEXTOS_DA_LEITURA.resultadoNaoGuardado,
    });
    expect(registro.rpcs).toEqual([]);
  });

  it("fila que falha não derruba o teste que deu certo", async () => {
    registro.token = TOKEN;
    registro.respostaDoRpc = { data: null, error: { code: "57014" } };
    const resultado = await testarLeituraMetaAction();
    expect(resultado).toMatchObject({ ok: true, leituraPedida: false });
    expect(registro.logs).toContainEqual([
      "leitura_meta_fila_falhou",
      { clinic_id: CLINICA, error_code: "57014" },
    ]);
  });
});

describe("remover o token de leitura", () => {
  it("zera só a coluna de leitura, pelo cliente de serviço, e audita", async () => {
    registro.token = TOKEN;
    const resultado = await removerTokenDeLeituraMetaAction();
    expect(resultado).toEqual({ ok: true });
    const escrita = registro.chamadas.find(
      (c) => c.tabela === "meta_ads_account_secret" && c.op === "update",
    );
    expect(escrita?.cliente).toBe("admin");
    expect(escrita?.valores).toEqual({ insights_access_token: null });
    expect(escrita?.filtros).toEqual([["clinic_id", CLINICA]]);
    // O investimento ja lido e a situacao ficam.
    expect(escritasDaSituacao()).toEqual([]);
    expect(auditorias()).toEqual([
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "removeu_token_leitura_meta",
        entity: "meta_ads_account_secret",
        entity_id: CLINICA,
      },
    ]);
  });

  it("falha ao remover vira mensagem de gente", async () => {
    registro.erroDaEscritaDoSegredo = { code: "XX000" };
    expect(await removerTokenDeLeituraMetaAction()).toEqual({
      ok: false,
      error: TEXTOS_DA_LEITURA.tokenNaoRemovido,
    });
    expect(auditorias()).toEqual([]);
  });
});

describe("Atualizar agora", () => {
  it.each(["enfileirado", "ja_na_fila"] as const)(
    "%s: pede pela função do banco e audita",
    async (codigo) => {
      registro.respostaDoRpc = { data: { codigo }, error: null };
      expect(await atualizarInvestimentoMetaAction()).toEqual({
        ok: true,
        codigo,
      });
      expect(registro.rpcs).toEqual([
        {
          nome: "enfileirar_sincronizacao_de_gasto_meta",
          args: { p_clinic_id: CLINICA, p_origem: "manual" },
        },
      ]);
      // Nenhum insert direto na fila.
      expect(registro.chamadas.some((c) => c.tabela === "job_queue")).toBe(false);
      expect(auditorias()).toEqual([
        {
          clinic_id: CLINICA,
          user_id: USUARIO,
          action: "pediu_atualizacao_do_investimento_meta",
          entity: "meta_gasto_leitura",
          entity_id: CLINICA,
        },
      ]);
    },
  );

  it("aguarde: diz há quantos minutos foi o pedido", async () => {
    // Pedido ha 3 minutos e 30 segundos: liberado daqui a 6 min 30 s.
    registro.respostaDoRpc = {
      data: {
        codigo: "aguarde",
        liberado_em: new Date(Date.now() + 6.5 * 60_000).toISOString(),
      },
      error: null,
    };
    expect(await atualizarInvestimentoMetaAction()).toEqual({
      ok: false,
      error:
        "O investimento foi atualizado há 3 minutos. Tente de novo daqui a pouco.",
    });
    expect(auditorias()).toEqual([]);
  });

  it("aguarde logo depois do pedido: há 1 minuto, no singular", async () => {
    registro.respostaDoRpc = {
      data: {
        codigo: "aguarde",
        liberado_em: new Date(Date.now() + 9.9 * 60_000).toISOString(),
      },
      error: null,
    };
    expect(await atualizarInvestimentoMetaAction()).toEqual({
      ok: false,
      error:
        "O investimento foi atualizado há 1 minuto. Tente de novo daqui a pouco.",
    });
  });

  it.each([
    ["sem_configuracao", TEXTOS_DA_LEITURA.semConfiguracao],
    ["pausada", TEXTOS_DA_LEITURA.pausada],
    ["clinica_de_teste", TEXTOS_DA_LEITURA.clinicaDeTeste],
    ["codigo_novo", TEXTOS_DA_LEITURA.atualizacaoNaoPedida],
  ])("%s vira o texto da tela", async (codigo, texto) => {
    registro.respostaDoRpc = { data: { codigo }, error: null };
    expect(await atualizarInvestimentoMetaAction()).toEqual({
      ok: false,
      error: texto,
    });
    expect(auditorias()).toEqual([]);
  });

  it("erro da função: mensagem genérica e só o código no log", async () => {
    registro.respostaDoRpc = {
      data: null,
      error: { code: "42501", message: "permission denied for function" },
    };
    expect(await atualizarInvestimentoMetaAction()).toEqual({
      ok: false,
      error: TEXTOS_DA_LEITURA.atualizacaoNaoPedida,
    });
    expect(registro.logs).toEqual([
      [
        "investimento_meta_pedido_falhou",
        { clinic_id: CLINICA, error_code: "42501" },
      ],
    ]);
  });
});

describe("conta de anúncios salva como act_", () => {
  function entrada(ad_account_id: string | null) {
    return {
      pixel_id: null,
      ad_account_id,
      whatsapp_business_account_id: null,
      test_event_code: null,
      send_unmatched: false,
      modo_user_data: null,
    };
  }

  function contaGravada(): unknown {
    return registro.chamadas.find(
      (c) => c.tabela === "meta_ads_account" && c.op === "upsert",
    )?.valores?.ad_account_id;
  }

  it.each([
    ["123456789", "act_123456789"],
    ["act_123456789", "act_123456789"],
    ["ACT_123456789", "act_123456789"],
    [" 123 456 789 ", "act_123456789"],
    [
      "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789&business_id=99",
      "act_123456789",
    ],
  ])("%s grava %s e devolve o valor normalizado", async (digitado, gravado) => {
    const resultado = await salvarContaMetaAction(entrada(digitado));
    expect(resultado).toEqual({ ok: true, adAccountId: gravado });
    expect(contaGravada()).toBe(gravado);
  });

  it.each([null, "", "   "])("%j vira conta vazia", async (digitado) => {
    const resultado = await salvarContaMetaAction(entrada(digitado));
    expect(resultado).toEqual({ ok: true, adAccountId: null });
    expect(contaGravada()).toBeNull();
  });

  it.each(["1234", "act_12ab5678", "conta da clínica", "act-123456789"])(
    "%s é recusado com a mensagem da conta, sem gravar",
    async (digitado) => {
      const resultado = await salvarContaMetaAction(entrada(digitado));
      expect(resultado).toEqual({
        ok: false,
        error: TEXTOS_DA_LEITURA.contaInvalida,
      });
      expect(
        registro.chamadas.some((c) => c.tabela === "meta_ads_account"),
      ).toBe(false);
    },
  );

  it("outro campo errado continua com a mensagem dos identificadores", async () => {
    const resultado = await salvarContaMetaAction({
      ...entrada("123456789"),
      pixel_id: "abc",
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Confira os campos: os identificadores da Meta são só números.",
    });
  });

  it("quem não gerencia não salva a conta", async () => {
    registro.papel = "recepcao";
    const resultado = await salvarContaMetaAction(entrada("123456789"));
    expect(resultado.ok).toBe(false);
    expect(registro.chamadas).toEqual([]);
  });
});

describe("textos das actions", () => {
  it("sem travessão", () => {
    for (const texto of Object.values(TEXTOS_DA_LEITURA)) {
      expect(texto).not.toMatch(/[–—]/);
    }
  });
});
