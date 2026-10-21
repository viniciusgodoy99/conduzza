import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// "Resolver as conversas paradas" do Atendimento (onda 2, decisao P11b do
// dono, opcao a): a pessoa escolhe na hora ha quantos dias a conversa esta
// parada (7, 15, 30 ou 60, nenhuma marcada de antemao), ve quantas sao e
// confirma. O que se prova:
//   - as regras puras (o corte, o evento, os textos, sem travessao);
//   - a guarda da acao: sessao, so administrador e gestor, so clinica com o
//     agente habilitado; os dias so os do dono;
//   - a contagem e o resolver pela SESSAO, so das abertas com a equipe e
//     paradas desde o corte; o UPDATE repete as condicoes; o evento no fio
//     de cada uma; a trilha so com os dias e a quantidade; nada de paciente
//     no log;
//   - a tela: o botao visivel para todos, habilitado so para a chefia, e o
//     dialogo sem opcao marcada e com o Resolver preso ate contar.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const USUARIO = "97777777-7777-4777-8777-777777777777";
const AGORA = Date.parse("2026-10-21T12:00:00.000Z");

type Op = {
  tabela: string;
  tipo: "select" | "update" | "insert";
  dados?: unknown;
  colunas?: string;
  opcoes?: unknown;
  filtros: [string, string, unknown][];
  limite?: number;
};

const registro = vi.hoisted(() => ({
  sessao: null as null | {
    userId: string;
    active: { clinicId: string; role: string } | null;
  },
  habilitada: true,
  operacoes: [] as Op[],
  /** Os ids que a leitura das paradas devolve. */
  paradas: [] as string[],
  /** As contagens, na ordem das chamadas. */
  contagens: [] as number[],
  erroNaContagem: false,
  erroNaLeitura: false,
  erroNoUpdate: false,
  revalidados: [] as string[],
  logs: [] as [string, unknown][],
}));

vi.mock("next/cache", () => ({
  revalidatePath: (caminho: string) => registro.revalidados.push(caminho),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => registro.sessao,
}));
vi.mock("@/lib/queries/ia-liberacao", () => ({
  abaDaIaVisivel: async () => registro.habilitada,
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
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabela: string) => {
      const op: Op = { tabela, tipo: "select", filtros: [] };
      registro.operacoes.push(op);
      const responder = () => {
        if (op.tipo === "insert") {
          return { data: null, error: null };
        }
        if (op.tipo === "update") {
          if (registro.erroNoUpdate) {
            return { data: null, error: { code: "XX000" } };
          }
          const ids = (op.filtros.find(
            (f) => f[0] === "in" && f[1] === "id",
          )?.[2] ?? []) as string[];
          return { data: ids.map((id) => ({ id })), error: null };
        }
        if ((op.opcoes as { head?: boolean } | undefined)?.head) {
          return registro.erroNaContagem
            ? { count: null, error: { code: "XX000" } }
            : { count: registro.contagens.shift() ?? 0, error: null };
        }
        return registro.erroNaLeitura
          ? { data: null, error: { code: "XX000" } }
          : { data: registro.paradas.map((id) => ({ id })), error: null };
      };
      const cadeia = {
        select: (colunas: string, opcoes?: unknown) => {
          if (op.tipo === "select") {
            op.colunas = colunas;
            op.opcoes = opcoes;
          }
          return cadeia;
        },
        update: (dados: unknown) => {
          op.tipo = "update";
          op.dados = dados;
          return cadeia;
        },
        insert: async (dados: unknown) => {
          op.tipo = "insert";
          op.dados = dados;
          return responder();
        },
        eq: (coluna: string, valor: unknown) => {
          op.filtros.push(["eq", coluna, valor]);
          return cadeia;
        },
        in: (coluna: string, valor: unknown) => {
          op.filtros.push(["in", coluna, valor]);
          return cadeia;
        },
        lt: (coluna: string, valor: unknown) => {
          op.filtros.push(["lt", coluna, valor]);
          return cadeia;
        },
        order: (coluna: string, opcoes: unknown) => {
          op.filtros.push(["order", coluna, opcoes]);
          return cadeia;
        },
        limit: (n: number) => {
          op.limite = n;
          return cadeia;
        },
        then: (ok: (valor: unknown) => unknown) =>
          Promise.resolve(responder()).then(ok),
      };
      return cadeia;
    },
  }),
}));

// O dialogo do Radix so abre no clique: aqui ele renderiza sempre, para a
// tela de dentro ser conferida.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => (
    <div data-parte="dialog">{children}</div>
  ),
  DialogContent: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));

const acoes = await import("@/app/(app)/atendimento/conversas-paradas-actions");
const regras = await import("@/components/atendimento/conversas-paradas");
const { ResolverConversasParadas } =
  await import("@/components/atendimento/resolver-conversas-paradas");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { TooltipProvider } = await import("@/components/ui/tooltip");

function entrar(role: string) {
  registro.sessao = { userId: USUARIO, active: { clinicId: CLINICA, role } };
}

beforeEach(() => {
  entrar("admin");
  registro.habilitada = true;
  registro.operacoes = [];
  registro.paradas = [];
  registro.contagens = [];
  registro.erroNaContagem = false;
  registro.erroNaLeitura = false;
  registro.erroNoUpdate = false;
  registro.revalidados = [];
  registro.logs = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
});

describe("regras puras", () => {
  it("as opções são as do dono, e o corte é agora menos N dias", () => {
    expect([...regras.DIAS_PARADA]).toEqual([7, 15, 30, 60]);
    expect(regras.instanteDoCorte(30, AGORA)).toBe("2026-09-21T12:00:00.000Z");
    expect(regras.instanteDoCorte(7, AGORA)).toBe("2026-10-14T12:00:00.000Z");
  });

  it("os textos dizem quantas, no singular e no plural, sem travessão", () => {
    expect(regras.textoDaContagem(0, 30)).toBe(
      "Nenhuma conversa parada há mais de 30 dias.",
    );
    expect(regras.textoDaContagem(1, 7)).toBe(
      "1 conversa parada há mais de 7 dias vai ser resolvida.",
    );
    expect(regras.textoDaContagem(500, 60)).toBe(
      "500 conversas paradas há mais de 60 dias vão ser resolvidas.",
    );
    // Revisao da onda 2: a acao resolve no maximo 500 por vez (as mais
    // antigas). O dialogo diz isso ANTES de confirmar, e o botao mostra a
    // quantidade desta vez, com o separador de milhar.
    expect(regras.LOTE_DAS_PARADAS).toBe(500);
    expect(regras.textoDaContagem(1234, 60)).toBe(
      "1.234 conversas paradas há mais de 60 dias. Desta vez vão ser resolvidas as 500 mais antigas; para as outras 734, resolva de novo depois.",
    );
    expect(regras.textoDaContagem(501, 7)).toBe(
      "501 conversas paradas há mais de 7 dias. Desta vez vão ser resolvidas as 500 mais antigas; para a outra, resolva de novo depois.",
    );
    expect(regras.textoDoConfirmar(1)).toBe("Resolver 1 conversa");
    expect(regras.textoDoConfirmar(82)).toBe("Resolver 82 conversas");
    expect(regras.textoDoConfirmar(500)).toBe("Resolver 500 conversas");
    expect(regras.textoDoConfirmar(1243)).toBe("Resolver 500 conversas");
    expect(regras.textoDoFim(82, 0)).toBe("82 conversas resolvidas.");
    expect(regras.textoDoFim(500, 63)).toBe(
      "500 conversas resolvidas. Ainda há 63 conversas paradas: resolva de novo para terminar.",
    );
    expect(regras.eventoDaConversaParada(30)).toBe(
      "Conversa resolvida: estava parada há mais de 30 dias.",
    );
    for (const texto of [
      ...Object.values(regras.TEXTOS_DAS_PARADAS),
      regras.textoDaContagem(2, 15),
      regras.textoDaContagem(1243, 7),
      regras.textoDoFim(1, 1),
      regras.eventoDaConversaParada(60),
    ]) {
      expect(texto).not.toMatch(/[—–]/);
      expect(texto).not.toMatch(/\b(tenant|handoff|opt-in|batch|lote)\b/i);
    }
  });
});

describe("guarda das ações", () => {
  const chamadas = [
    () => acoes.contarConversasParadasAction({ dias: 30 }),
    () => acoes.resolverConversasParadasAction({ dias: 30 }),
  ];

  it("sem sessão, papel sem chefia ou clínica sem o agente: recusa sem banco", async () => {
    registro.sessao = null;
    for (const chamar of chamadas) {
      expect(await chamar()).toEqual({
        ok: false,
        error: "Sessão expirada. Entre de novo.",
      });
    }
    for (const papel of ["recepcao", "profissional", "leitura"]) {
      entrar(papel);
      for (const chamar of chamadas) {
        expect(await chamar()).toEqual({
          ok: false,
          error: regras.TEXTOS_DAS_PARADAS.semPermissao,
        });
      }
    }
    entrar("gestor");
    registro.habilitada = false;
    for (const chamar of chamadas) {
      expect(await chamar()).toEqual({
        ok: false,
        error: regras.TEXTOS_DAS_PARADAS.foraDoAgente,
      });
    }
    expect(registro.operacoes).toEqual([]);
  });

  it("os dias só os do dono: nada inventado chega ao banco", async () => {
    for (const entrada of [
      { dias: 10 },
      { dias: "30" },
      { dias: 30, extra: 1 },
      {},
      30,
    ]) {
      expect(await acoes.resolverConversasParadasAction(entrada)).toEqual({
        ok: false,
        error: regras.TEXTOS_DAS_PARADAS.dadosInvalidos,
      });
    }
    expect(registro.operacoes).toEqual([]);
  });
});

describe("contar e resolver", () => {
  it("contar: só as abertas com a equipe, paradas desde o corte, na clínica ativa", async () => {
    registro.contagens = [82];
    expect(await acoes.contarConversasParadasAction({ dias: 30 })).toEqual({
      ok: true,
      total: 82,
    });
    expect(registro.operacoes).toEqual([
      expect.objectContaining({
        tabela: "conversation",
        tipo: "select",
        opcoes: { count: "exact", head: true },
        filtros: [
          ["eq", "clinic_id", CLINICA],
          ["in", "status", ["aguardando_humano", "em_atendimento"]],
          ["lt", "last_message_at", "2026-09-21T12:00:00.000Z"],
        ],
      }),
    ]);
  });

  it("contagem que falha: o texto, e o log sem dado de paciente", async () => {
    registro.erroNaContagem = true;
    expect(await acoes.contarConversasParadasAction({ dias: 7 })).toEqual({
      ok: false,
      error: regras.TEXTOS_DAS_PARADAS.naoContou,
    });
    expect(registro.logs).toEqual([
      ["conversas_paradas_nao_contadas", { clinic_id: CLINICA }],
    ]);
  });

  it("resolver: o mesmo do Resolver, com as condições de novo no UPDATE, o evento em cada uma e a trilha só com números", async () => {
    registro.paradas = ["c1", "c2", "c3"];
    registro.contagens = [0];
    expect(await acoes.resolverConversasParadasAction({ dias: 30 })).toEqual({
      ok: true,
      total: 3,
      restam: 0,
    });
    const update = registro.operacoes.find((op) => op.tipo === "update");
    expect(update).toMatchObject({
      tabela: "conversation",
      dados: { status: "resolvida", awaiting_reply: false },
      filtros: [
        ["in", "id", ["c1", "c2", "c3"]],
        ["eq", "clinic_id", CLINICA],
        ["in", "status", ["aguardando_humano", "em_atendimento"]],
        ["lt", "last_message_at", "2026-09-21T12:00:00.000Z"],
      ],
    });
    const eventos = registro.operacoes.find(
      (op) => op.tipo === "insert" && op.tabela === "message",
    );
    expect(eventos?.dados).toEqual(
      ["c1", "c2", "c3"].map((conversationId) => ({
        clinic_id: CLINICA,
        conversation_id: conversationId,
        direction: "saida",
        author: "sistema",
        content_type: "evento",
        body: "Conversa resolvida: estava parada há mais de 30 dias.",
      })),
    );
    const trilha = registro.operacoes.find(
      (op) => op.tipo === "insert" && op.tabela === "audit_log",
    );
    expect(trilha?.dados).toEqual({
      clinic_id: CLINICA,
      user_id: USUARIO,
      action: "resolveu_conversas_paradas",
      entity: "conversation",
      entity_id: null,
      detalhes: { dias: 30, quantas: 3 },
    });
    expect(registro.revalidados).toEqual(["/atendimento"]);
    // a leitura das paradas: as mais antigas primeiro, no maximo 500
    const leitura = registro.operacoes.find(
      (op) => op.tipo === "select" && op.colunas === "id" && !op.opcoes,
    );
    expect(leitura?.limite).toBe(500);
  });

  it("mais de 100: em pedaços de 100; o que sobra volta em restam", async () => {
    registro.paradas = Array.from({ length: 250 }, (_, i) => `c${i}`);
    registro.contagens = [63];
    expect(await acoes.resolverConversasParadasAction({ dias: 60 })).toEqual({
      ok: true,
      total: 250,
      restam: 63,
    });
    const updates = registro.operacoes.filter((op) => op.tipo === "update");
    expect(
      updates.map(
        (op) =>
          (
            op.filtros.find(
              (f) => f[0] === "in" && f[1] === "id",
            )?.[2] as string[]
          ).length,
      ),
    ).toEqual([100, 100, 50]);
  });

  it("nenhuma parada: nada muda, sem evento nem trilha", async () => {
    registro.paradas = [];
    registro.contagens = [0];
    expect(await acoes.resolverConversasParadasAction({ dias: 15 })).toEqual({
      ok: true,
      total: 0,
      restam: 0,
    });
    expect(registro.operacoes.some((op) => op.tipo !== "select")).toBe(false);
    expect(registro.revalidados).toEqual([]);
  });

  it("o UPDATE falha: o texto, sem evento, e o log só com o código", async () => {
    registro.paradas = ["c1"];
    registro.erroNoUpdate = true;
    expect(await acoes.resolverConversasParadasAction({ dias: 7 })).toEqual({
      ok: false,
      error: regras.TEXTOS_DAS_PARADAS.naoResolveu,
    });
    expect(registro.operacoes.some((op) => op.tipo === "insert")).toBe(false);
    expect(JSON.stringify(registro.logs)).not.toContain("c1");
  });
});

describe("a tela", () => {
  function tela(podeResolver: boolean): string {
    return renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <ResolverConversasParadas
            clinicId={CLINICA}
            podeResolver={podeResolver}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
  }

  /** A tag de abertura do botao com aquele texto. */
  function aberturaDoBotao(html: string, texto: string): string {
    const indice = html.indexOf(`${texto}</button>`);
    expect(indice, `botão "${texto}"`).toBeGreaterThan(-1);
    const abertura = html.lastIndexOf("<button", indice);
    return html.slice(abertura, html.indexOf(">", abertura) + 1);
  }

  it("a chefia: o botão habilitado; o diálogo sem opção marcada e o Resolver preso até contar", () => {
    const html = tela(true);
    expect(aberturaDoBotao(html, "Resolver conversas paradas")).not.toContain(
      'disabled=""',
    );
    for (const dias of ["7", "15", "30", "60"]) {
      expect(html).toContain(`Mais de ${dias} dias`);
    }
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(4);
    for (const radio of radios) {
      expect(radio).not.toContain("checked");
    }
    expect(aberturaDoBotao(html, "Resolver")).toContain('disabled=""');
  });

  it("os outros papéis: o botão visível e preso, com a dica", () => {
    const html = tela(false);
    expect(aberturaDoBotao(html, "Resolver conversas paradas")).toContain(
      'disabled=""',
    );
    expect(html).toContain("cursor-not-allowed");
    expect(html).not.toMatch(/[—–]/);
  });
});
