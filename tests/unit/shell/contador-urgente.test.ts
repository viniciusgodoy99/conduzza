import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// AG6a no menu e nos avisos na tela (desenho da AG6, secoes 1.1, 1.3 e 6;
// D-53 e D-55 pela recomendacao, pendentes do dono; contrato da frente de
// banco, secoes 3 e 5):
// - a contagem das urgentes abertas (a marca aberta COM a conversa em
//   "Aguardando você", a RLS recorta) e o contador do Atendimento em
//   alerta, em 3 camadas (o sino com o numero de URGENTES, "N urgentes" no
//   nome do link e os tokens do alerta da sidebar, iguais nos dois temas);
//   sem a contagem, o tom de sempre;
// - os canais do menu: a marca num canal proprio, e nenhuma assinatura de
//   message (revisao da AG6a);
// - os avisos "Conversa urgente de {nome}." e "A IA passou para você a
//   conversa de {nome}.": quando o evento pede o aviso (a marca aberta; a
//   conversa que ENTRA em atendimento com quem olha) e o que a Server
//   Action confere de novo (pela sessao, com a trilha antes do nome e com o
//   id da conversa).
// Nada aqui chama a rede: o banco e um falso com a forma do cliente.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/app/(auth)/actions", () => ({
  signOutAction: vi.fn(),
  pickClinicAction: vi.fn(),
}));

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const OUTRA_CLINICA = "11111111-2222-4333-8444-555555555555";
const EU = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const OUTRA_PESSOA = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const MENSAGEM = "66666666-6666-4666-8666-666666666666";

type Consulta = {
  tabela: string;
  colunas: string | null;
  opcoes: unknown;
  filtros: [string, string, unknown][];
};

/** Um cliente falso que guarda o que foi pedido e devolve o combinado. */
function clienteFalso(
  responder: (consulta: Consulta) => {
    data?: unknown;
    error?: unknown;
    count?: number | null;
  },
) {
  const consultas: Consulta[] = [];
  const from = (tabela: string) => {
    const consulta: Consulta = {
      tabela,
      colunas: null,
      opcoes: null,
      filtros: [],
    };
    consultas.push(consulta);
    const resposta = () =>
      Promise.resolve({ data: null, error: null, ...responder(consulta) });
    const encadeia = {
      select: (colunas: string, opcoes?: unknown) => {
        consulta.colunas = colunas;
        consulta.opcoes = opcoes ?? null;
        return encadeia;
      },
      eq: (coluna: string, valor: unknown) => {
        consulta.filtros.push(["eq", coluna, valor]);
        return encadeia;
      },
      is: (coluna: string, valor: unknown) => {
        consulta.filtros.push(["is", coluna, valor]);
        return encadeia;
      },
      order: (coluna: string, opcoes: unknown) => {
        consulta.filtros.push(["order", coluna, opcoes]);
        return encadeia;
      },
      limit: (n: number) => {
        consulta.filtros.push(["limit", "", n]);
        return encadeia;
      },
      maybeSingle: resposta,
      then: (
        ok: (valor: unknown) => unknown,
        falha: (erro: unknown) => unknown,
      ) => resposta().then(ok, falha),
    };
    return encadeia;
  };
  return { cliente: { from }, consultas };
}

// ---------------------------------------------------------------------------
// A Server Action dos avisos, com a sessao e o banco falsos
// ---------------------------------------------------------------------------

let sessao: {
  userId: string;
  active: { clinicId: string; role: string } | null;
} | null = null;
let banco = clienteFalso(() => ({}));
const trilha = vi.fn<(...args: unknown[]) => Promise<undefined>>(
  async () => undefined,
);

vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => banco.cliente,
}));
vi.mock("@/lib/auth/read-audit", () => ({
  auditarLeituraDePaciente: (...args: unknown[]) => trilha(...args),
}));

const { contarConversasUrgentes } =
  await import("@/components/shell/contadores-do-menu");
const { NavBadge } = await import("@/components/shell/nav-badge");
const { alertaDoItem, ConteudoDaDica, numerosDaDica } =
  await import("@/components/shell/rail");
const avisos = await import("@/components/shell/avisos-da-conversa");
const { lerAvisoDaConversaAction } =
  await import("@/app/(app)/atendimento/avisos-actions");
const {
  CANAIS_DO_MENU,
  canaisDoMenu,
  CLASSE_DO_ABRIR,
  DURACAO_DO_AVISO_DE_URGENCIA_MS,
  ESTILO_DO_ABRIR,
  reacoesDoMenu,
} = await import("@/components/shell/use-contadores-do-menu");
type EventoDoMenu =
  import("@/components/shell/use-contadores-do-menu").EventoDoMenu;

beforeEach(() => {
  sessao = { userId: EU, active: { clinicId: CLINICA, role: "recepcao" } };
  trilha.mockClear();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

// ---------------------------------------------------------------------------
// A contagem
// ---------------------------------------------------------------------------

describe("a contagem das urgentes abertas", () => {
  it("conta a marca aberta com a conversa em Aguardando você, da clínica ativa, só a contagem (head)", async () => {
    const { cliente, consultas } = clienteFalso(() => ({ count: 2 }));
    expect(await contarConversasUrgentes(cliente as never, CLINICA)).toBe(2);
    expect(consultas).toEqual([
      {
        tabela: "conversa_urgente",
        // A conversa entra pela juncao interna: sem ela no status, a marca
        // nao conta (a mesma regra do chip da lista, urgenteAberta).
        colunas: "conversation_id, conversation!inner(status)",
        opcoes: { count: "exact", head: true },
        filtros: [
          ["eq", "clinic_id", CLINICA],
          ["is", "encerrada_em", null],
          ["eq", "conversation.status", "aguardando_humano"],
        ],
      },
    ]);
  });

  it("a marca presa (conversa fora de Aguardando você) não deixa o menu em alerta: a mesma regra da lista", async () => {
    const { urgenteAberta } = await import("@/lib/queries/conversations");
    // O banco so conta a marca aberta com a conversa em Aguardando você; a
    // lista so mostra o chip nesse mesmo caso.
    const marca = { desde: "2026-10-27T14:59:30.000Z" };
    expect(urgenteAberta({ status: "aguardando_humano", urgente: marca })).toBe(
      true,
    );
    for (const status of ["em_atendimento", "resolvida", "ia_atendendo"]) {
      expect(
        urgenteAberta({
          status: status as "em_atendimento",
          urgente: marca,
        }),
      ).toBe(false);
    }
  });

  it("sem contagem é zero; com erro é nulo (o tom de sempre)", async () => {
    expect(
      await contarConversasUrgentes(
        clienteFalso(() => ({ count: null })).cliente as never,
        CLINICA,
      ),
    ).toBe(0);
    expect(
      await contarConversasUrgentes(
        clienteFalso(() => ({ error: { code: "42P01" } })).cliente as never,
        CLINICA,
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// O contador em alerta
// ---------------------------------------------------------------------------

function pilula(props: Parameters<typeof NavBadge>[0]): string {
  return renderToStaticMarkup(createElement(NavBadge, props));
}

/**
 * As pilulas desenhadas (as duas variantes do menu: aberto e recolhido), com
 * o texto visivel de cada uma, o sino e a cor.
 */
function pilulas(html: string) {
  return [
    ...html.matchAll(
      /<span[^>]*data-pilula="(alerta|numero)"[^>]*class="([^"]*)"[^>]*>(.*?)<\/span>/g,
    ),
  ].map(([tag = "", tipo = "", classes = "", miolo = ""]) => ({
    tipo,
    recolhido: classes.includes("rail-aberto:hidden"),
    texto: miolo.replace(/<svg[\s\S]*?<\/svg>/g, "").trim(),
    sino: miolo.includes("lucide-bell-ring"),
    alerta: classes.includes("bg-(--sidebar-badge-alerta)"),
    lime: classes.includes("bg-sidebar-primary"),
    neutro: classes.includes("bg-(--sidebar-badge) "),
    tag,
  }));
}

describe("o contador do Atendimento em alerta", () => {
  it("só o item do Atendimento, e só com urgentes contadas", () => {
    expect(
      alertaDoItem("conversas", { conversas: 3, confirmacoes: 0, urgentes: 2 }),
    ).toEqual({ quantas: 2, descricao: "conversas urgentes" });
    expect(
      alertaDoItem("conversas", { conversas: 3, confirmacoes: 0, urgentes: 1 }),
    ).toEqual({ quantas: 1, descricao: "conversa urgente" });
    for (const urgentes of [0, null, undefined]) {
      expect(
        alertaDoItem("conversas", { conversas: 3, confirmacoes: 0, urgentes }),
      ).toBeNull();
    }
    expect(
      alertaDoItem("confirmacoes", {
        conversas: 3,
        confirmacoes: 4,
        urgentes: 2,
      }),
    ).toBeNull();
    expect(
      alertaDoItem(undefined, { conversas: 3, confirmacoes: 0, urgentes: 2 }),
    ).toBeNull();
  });

  it("em 3 camadas: o sino, o texto para o leitor de tela e a cor do alerta", () => {
    const html = pilula({
      count: 3,
      ativo: false,
      descricao: "conversas aguardando resposta",
      alerta: { quantas: 1, descricao: "conversa urgente" },
    });
    // As urgentes primeiro no nome do link.
    expect(html).toContain(
      ", 1 conversa urgente, 3 conversas aguardando resposta",
    );
    expect(html.match(/lucide-bell-ring/g)).toHaveLength(2);
    expect(html).toContain("bg-(--sidebar-badge-alerta)");
    expect(html).toContain("text-(--sidebar-badge-alerta-text)");
  });

  it("o sino leva o número de urgentes, nunca o de aguardando (revisão: sino 7 parecia 7 urgentes)", () => {
    const html = pilula({
      count: 7,
      ativo: false,
      descricao: "conversas aguardando resposta",
      alerta: { quantas: 2, descricao: "conversas urgentes" },
    });
    const desenhadas = pilulas(html);
    // Menu aberto: o alerta (sino e 2) e, separado, o 7 no tom de sempre.
    const abertas = desenhadas.filter((p) => !p.recolhido);
    expect(abertas.map((p) => [p.tipo, p.texto, p.sino])).toEqual([
      ["alerta", "2", true],
      ["numero", "7", false],
    ]);
    expect(abertas[0]?.alerta).toBe(true);
    expect(abertas[1]?.neutro).toBe(true);
    // Recolhido: uma pilula so, o alerta, com o numero de urgentes.
    const recolhidas = desenhadas.filter((p) => p.recolhido);
    expect(recolhidas.map((p) => [p.tipo, p.texto, p.sino])).toEqual([
      ["alerta", "2", true],
    ]);
    // Nenhuma pilula junta o sino com o 7.
    for (const desenhada of desenhadas) {
      expect(desenhada.sino && desenhada.texto === "7").toBe(false);
    }
  });

  it("o alerta vence o lime do item aberto (o número de aguardando fica lime, ao lado)", () => {
    const html = pilula({
      count: 3,
      ativo: true,
      descricao: "conversas aguardando resposta",
      alerta: { quantas: 2, descricao: "conversas urgentes" },
    });
    const desenhadas = pilulas(html);
    for (const desenhada of desenhadas.filter((p) => p.tipo === "alerta")) {
      expect(desenhada.alerta).toBe(true);
      expect(desenhada.lime).toBe(false);
    }
    expect(
      desenhadas.filter((p) => p.tipo === "numero").map((p) => p.lime),
    ).toEqual([true]);
    // Recolhido, o canto do icone e do alerta.
    expect(desenhadas.find((p) => p.recolhido)?.alerta).toBe(true);
  });

  it("acima de 99, o 99+ nas duas pílulas", () => {
    const desenhadas = pilulas(
      pilula({
        count: 250,
        ativo: false,
        descricao: "conversas aguardando resposta",
        alerta: { quantas: 120, descricao: "conversas urgentes" },
      }),
    );
    expect(desenhadas.map((p) => p.texto)).toEqual(["99+", "99+", "99+"]);
  });

  it("sem o alerta, o contador de sempre (neutro, ou lime no item aberto)", () => {
    const neutro = pilula({
      count: 3,
      ativo: false,
      descricao: "conversas aguardando resposta",
    });
    expect(neutro).toContain("bg-(--sidebar-badge)");
    expect(neutro).not.toContain("lucide-bell-ring");
    expect(neutro).toContain(", 3 conversas aguardando resposta");
    expect(
      pilula({ count: 3, ativo: true, descricao: "x", alerta: null }),
    ).toContain("bg-sidebar-primary");
    expect(pilula({ count: 0, ativo: false, descricao: "x" })).toBe("");
    expect(pilula({ count: null, ativo: false, descricao: "x" })).toBe("");
  });

  it("sem conversa aguardando contada, a pílula diz as urgentes (nunca um zero)", () => {
    const html = pilula({
      count: 0,
      ativo: false,
      descricao: "conversas aguardando resposta",
      alerta: { quantas: 1, descricao: "conversa urgente" },
    });
    expect(html).toContain(", 1 conversa urgente");
    expect(html).not.toContain("aguardando resposta");
    expect(html).toMatch(/<\/svg>1<\/span>/);
  });

  it("os tokens do alerta têm 4.5:1 e são iguais nos dois temas, como a sidebar", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const raiz = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    const valor = (nome: string): string | null =>
      new RegExp(`--${nome}:\\s*([^;]+);`).exec(raiz)?.[1]?.trim() ?? null;
    const resolver = (nome: string): string => {
      const bruto = valor(nome);
      const ref = bruto ? /^var\(--([\w-]+)\)$/.exec(bruto)?.[1] : null;
      return ref ? resolver(ref) : (bruto ?? "");
    };
    const fundo = resolver("sidebar-badge-alerta");
    const texto = resolver("sidebar-badge-alerta-text");
    expect(fundo).toMatch(/^#[0-9a-f]{6}$/i);
    expect(texto).toMatch(/^#[0-9a-f]{6}$/i);
    const luminancia = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [claro, escuro] = [luminancia(fundo), luminancia(texto)].sort(
      (a, b) => b - a,
    ) as [number, number];
    expect((claro + 0.05) / (escuro + 0.05)).toBeGreaterThanOrEqual(4.5);
    // So no bloco claro (a sidebar e definida so ali): o escuro nao muda.
    const fora = css.replace(/:root\s*\{[\s\S]*?\}/, "");
    expect(fora).not.toContain("--sidebar-badge-alerta");
  });
});

// ---------------------------------------------------------------------------
// A dica do item no menu recolhido (revisao curta da AG6a, achado 5)
// ---------------------------------------------------------------------------

describe("a dica do item no menu recolhido", () => {
  it("com urgentes, os dois números: as urgentes primeiro e as aguardando, como o leitor de tela ouve", () => {
    expect(
      numerosDaDica("conversas", {
        conversas: 7,
        confirmacoes: 0,
        urgentes: 2,
      }),
    ).toBe("2 conversas urgentes, 7 conversas aguardando resposta");
    expect(
      numerosDaDica("conversas", {
        conversas: 1,
        confirmacoes: 0,
        urgentes: 1,
      }),
    ).toBe("1 conversa urgente, 1 conversa aguardando resposta");
    // O mesmo texto do nome do link (a pilula sr-only).
    const html = pilula({
      count: 7,
      ativo: false,
      descricao: "conversas aguardando resposta",
      alerta: { quantas: 2, descricao: "conversas urgentes" },
    });
    expect(html).toContain(
      `, ${numerosDaDica("conversas", { conversas: 7, confirmacoes: 0, urgentes: 2 })}`,
    );
  });

  it("os números reais na dica (sem o 99+ da pílula), e sem aguardando contada, só as urgentes", () => {
    expect(
      numerosDaDica("conversas", {
        conversas: 250,
        confirmacoes: 0,
        urgentes: 120,
      }),
    ).toBe("120 conversas urgentes, 250 conversas aguardando resposta");
    expect(
      numerosDaDica("conversas", {
        conversas: 0,
        confirmacoes: 0,
        urgentes: 1,
      }),
    ).toBe("1 conversa urgente");
  });

  it("sem urgente, sem números na dica (a pílula do canto já mostra o número)", () => {
    for (const urgentes of [0, null, undefined]) {
      expect(
        numerosDaDica("conversas", { conversas: 7, confirmacoes: 3, urgentes }),
      ).toBeNull();
    }
    expect(
      numerosDaDica("confirmacoes", {
        conversas: 7,
        confirmacoes: 3,
        urgentes: 2,
      }),
    ).toBeNull();
    expect(
      numerosDaDica(undefined, { conversas: 7, confirmacoes: 3, urgentes: 2 }),
    ).toBeNull();
  });

  it("o conteúdo da dica: o rótulo e, com os números, uma segunda linha", () => {
    expect(
      renderToStaticMarkup(
        createElement(ConteudoDaDica, { rotulo: "Atendimento", numeros: null }),
      ),
    ).toBe("Atendimento");
    const comNumeros = renderToStaticMarkup(
      createElement(ConteudoDaDica, {
        rotulo: "Atendimento",
        numeros: "2 conversas urgentes, 7 conversas aguardando resposta",
      }),
    );
    expect(comNumeros).toBe(
      '<span class="grid gap-px"><span>Atendimento</span><span class="font-normal">2 conversas urgentes, 7 conversas aguardando resposta</span></span>',
    );
    expect(comNumeros).not.toMatch(/[—–]/);
  });

  it("o item do menu passa os números para a dica", () => {
    const rail = readFileSync(
      join(process.cwd(), "components/shell/rail.tsx"),
      "utf8",
    );
    expect(rail).toContain(
      "numerosNaDica={numerosDaDica(item.badge, contadores)}",
    );
    expect(rail).toMatch(
      /<TooltipContent side="right" sideOffset=\{8\}>[\s\S]*?<ConteudoDaDica rotulo=\{rotulo\} numeros=\{numerosNaDica\} \/>[\s\S]*?<\/TooltipContent>/,
    );
  });
});

// ---------------------------------------------------------------------------
// Os canais do menu (revisao da AG6a)
// ---------------------------------------------------------------------------

type Assinatura = {
  tipo: string;
  evento: string;
  tabela: string;
  filtro: string | undefined;
  reagir: (payload: unknown) => void;
};

/** Um cliente falso que so monta canais e guarda as assinaturas. */
function supabaseDeCanais() {
  const canais: { nome: string; assinaturas: Assinatura[] }[] = [];
  const supabase = {
    channel(nome: string) {
      const canal = {
        nome,
        assinaturas: [] as Assinatura[],
        on(
          tipo: string,
          cfg: { event: string; table: string; filter?: string },
          reagir: (payload: unknown) => void,
        ) {
          canal.assinaturas.push({
            tipo,
            evento: cfg.event,
            tabela: cfg.table,
            filtro: cfg.filter,
            reagir,
          });
          return canal;
        },
      };
      canais.push(canal);
      return canal;
    },
  };
  return { supabase, canais };
}

function reacoesFalsas() {
  return { conversa: vi.fn(), agenda: vi.fn(), marca: vi.fn() };
}

describe("os canais do menu", () => {
  it("a marca num canal próprio: a falha dela não derruba conversation e appointment", () => {
    const { supabase, canais } = supabaseDeCanais();
    const reagir = reacoesFalsas();
    const { principal, urgencia } = canaisDoMenu(
      supabase as never,
      CLINICA,
      { conversas: true, confirmacoes: true },
      reagir,
    );
    expect(principal).not.toBeNull();
    expect(urgencia).not.toBeNull();
    expect(canais.map((c) => c.nome)).toEqual([
      CANAIS_DO_MENU.principal(CLINICA),
      CANAIS_DO_MENU.urgencia(CLINICA),
    ]);
    expect(CANAIS_DO_MENU.principal(CLINICA)).not.toBe(
      CANAIS_DO_MENU.urgencia(CLINICA),
    );
    const [doMenu, daMarca] = canais;
    expect(
      doMenu?.assinaturas.map((a) => [a.tipo, a.evento, a.tabela, a.filtro]),
    ).toEqual([
      ["postgres_changes", "*", "conversation", `clinic_id=eq.${CLINICA}`],
      ["postgres_changes", "*", "appointment", `clinic_id=eq.${CLINICA}`],
    ]);
    expect(
      daMarca?.assinaturas.map((a) => [a.tipo, a.evento, a.tabela, a.filtro]),
    ).toEqual([
      ["postgres_changes", "*", "conversa_urgente", `clinic_id=eq.${CLINICA}`],
    ]);
  });

  it("nenhuma assinatura de message (antes: sem filtro de clínica, em todas as telas)", () => {
    const { supabase, canais } = supabaseDeCanais();
    canaisDoMenu(
      supabase as never,
      CLINICA,
      { conversas: true, confirmacoes: true },
      reacoesFalsas(),
    );
    const todas = canais.flatMap((c) => c.assinaturas);
    expect(todas.some((a) => a.tabela === "message")).toBe(false);
    // Toda assinatura do menu e filtrada pela clinica ativa.
    for (const assinatura of todas) {
      expect(assinatura.filtro).toBe(`clinic_id=eq.${CLINICA}`);
    }
    // E o vigia nao monta canal por fora desta funcao.
    const vigia = readFileSync(
      join(process.cwd(), "components/shell/use-contadores-do-menu.ts"),
      "utf8",
    );
    expect(vigia).not.toMatch(/table:\s*"message"/);
    expect(vigia.match(/\.channel\(/g)).toHaveLength(2);
  });

  it("só o que o menu do papel mostra: sem o Atendimento, sem a marca; sem as confirmações, sem appointment", () => {
    const soConfirmacoes = supabaseDeCanais();
    const so = canaisDoMenu(
      soConfirmacoes.supabase as never,
      CLINICA,
      { conversas: false, confirmacoes: true },
      reacoesFalsas(),
    );
    expect(so.urgencia).toBeNull();
    expect(
      soConfirmacoes.canais.map((c) => c.assinaturas.map((a) => a.tabela)),
    ).toEqual([["appointment"]]);

    const soConversas = supabaseDeCanais();
    canaisDoMenu(
      soConversas.supabase as never,
      CLINICA,
      { conversas: true, confirmacoes: false },
      reacoesFalsas(),
    );
    expect(
      soConversas.canais.map((c) => c.assinaturas.map((a) => a.tabela)),
    ).toEqual([["conversation"], ["conversa_urgente"]]);

    const nada = supabaseDeCanais();
    expect(
      canaisDoMenu(
        nada.supabase as never,
        CLINICA,
        { conversas: false, confirmacoes: false },
        reacoesFalsas(),
      ),
    ).toEqual({ principal: null, urgencia: null });
    expect(nada.canais).toEqual([]);
  });

  it("cada tabela chega na reação dela (a atribuição nasce do evento de conversation)", () => {
    const { supabase, canais } = supabaseDeCanais();
    const reagir = reacoesFalsas();
    canaisDoMenu(
      supabase as never,
      CLINICA,
      { conversas: true, confirmacoes: true },
      reagir,
    );
    const evento = { eventType: "UPDATE", new: { id: CONVERSA } };
    canais[0]?.assinaturas[0]?.reagir(evento);
    expect(reagir.conversa).toHaveBeenCalledWith(evento);
    canais[0]?.assinaturas[1]?.reagir(evento);
    expect(reagir.agenda).toHaveBeenCalledWith(evento);
    canais[1]?.assinaturas[0]?.reagir(evento);
    expect(reagir.marca).toHaveBeenCalledWith(evento);
  });

  it("o vigia liga a conversa ao aviso da atribuição pela pessoa da sessão", () => {
    const vigia = readFileSync(
      join(process.cwd(), "components/shell/use-contadores-do-menu.ts"),
      "utf8",
    );
    expect(vigia).toMatch(
      /vigiaDaAtribuicao\(\{\s*clinicId,\s*viewerId\s*\}\)/,
    );
    expect(vigia).toMatch(
      /lerAviso\(\{ tipo: "atribuida", conversationId \}\)/,
    );
    // Os canais recebem as reacoes testadas abaixo (reacoesDoMenu), com o
    // vigia desta pessoa e a recontagem agrupada.
    expect(vigia).toMatch(
      /canaisDoMenu\([\s\S]*?reacoesDoMenu\(\{[\s\S]*?recontar: agendarRecontagem,[\s\S]*?atribuicaoNova,/,
    );
    const shell = readFileSync(
      join(process.cwd(), "components/shell/app-shell.tsx"),
      "utf8",
    );
    expect(shell).toMatch(/useContadoresDoMenu\(\{[\s\S]*viewerId,/);
    const layout = readFileSync(
      join(process.cwd(), "app/(app)/layout.tsx"),
      "utf8",
    );
    expect(layout).toContain("viewerId={context.userId}");
  });
});

// ---------------------------------------------------------------------------
// O que cada evento do menu faz (revisao da AG6a, achado 2)
// ---------------------------------------------------------------------------

describe("o que cada evento do menu faz (reacoesDoMenu)", () => {
  /**
   * As reacoes com o vigia de verdade (desta pessoa, semeado sem nenhuma
   * conversa: nada estava com ela na montagem) e o resto espiado.
   */
  function montar(viewerId = EU) {
    const recontar = vi.fn();
    const avisarAtribuicao = vi.fn();
    const avisarUrgencia = vi.fn();
    const vigia = avisos.vigiaDaAtribuicao({ clinicId: CLINICA, viewerId });
    expect(vigia.semear([])).toEqual([]);
    const reagir = reacoesDoMenu({
      clinicId: CLINICA,
      recontar,
      atribuicaoNova: vigia,
      avisarAtribuicao,
      avisarUrgencia,
    });
    return { reagir, recontar, avisarAtribuicao, avisarUrgencia };
  }

  /** Um evento como o tempo real entrega (so o que as reacoes leem). */
  function evento(
    tabela: string,
    eventType: "INSERT" | "UPDATE" | "DELETE",
    linha: Record<string, unknown>,
  ): EventoDoMenu {
    return {
      schema: "public",
      table: tabela,
      commit_timestamp: "2026-10-27T15:00:00.000Z",
      errors: [],
      eventType,
      new: eventType === "DELETE" ? {} : linha,
      old: eventType === "DELETE" ? linha : {},
    } as unknown as EventoDoMenu;
  }

  const conversa = (campos: Record<string, unknown>) =>
    evento("conversation", "UPDATE", {
      id: CONVERSA,
      clinic_id: CLINICA,
      status: "ia_atendendo",
      assignee_user_id: null,
      unread_count: 0,
      ...campos,
    });

  it("a passagem da IA e a atribuição logo depois: uma pergunta só, e cada mensagem depois só reconta", () => {
    const { reagir, recontar, avisarAtribuicao } = montar();
    // A IA passa (a fila, sem responsavel): reconta, sem pergunta.
    reagir.conversa(conversa({ status: "aguardando_humano" }));
    expect(avisarAtribuicao).not.toHaveBeenCalled();
    // Logo depois da frase, a conversa fica comigo: a pergunta ao servidor.
    reagir.conversa(
      conversa({ status: "em_atendimento", assignee_user_id: EU }),
    );
    expect(avisarAtribuicao).toHaveBeenCalledTimes(1);
    expect(avisarAtribuicao).toHaveBeenCalledWith(CONVERSA);
    // Cada mensagem mexe na conversa: so recontagem, nenhuma pergunta nova.
    for (let i = 1; i <= 4; i += 1) {
      reagir.conversa(
        conversa({
          status: "em_atendimento",
          assignee_user_id: EU,
          unread_count: i,
        }),
      );
    }
    expect(avisarAtribuicao).toHaveBeenCalledTimes(1);
    expect(recontar).toHaveBeenCalledTimes(6);
  });

  it("a conversa que fica com outra pessoa, ou de outra clínica, nunca pergunta (mas reconta)", () => {
    const { reagir, recontar, avisarAtribuicao } = montar();
    reagir.conversa(
      conversa({ status: "em_atendimento", assignee_user_id: OUTRA_PESSOA }),
    );
    reagir.conversa(
      conversa({
        status: "em_atendimento",
        assignee_user_id: EU,
        clinic_id: OUTRA_CLINICA,
      }),
    );
    reagir.conversa(evento("conversation", "DELETE", { id: CONVERSA }));
    expect(avisarAtribuicao).not.toHaveBeenCalled();
    expect(recontar).toHaveBeenCalledTimes(3);
  });

  it("a marca aberta pede o aviso de urgência; a encerrada e a poda só recontam", () => {
    const { reagir, recontar, avisarUrgencia, avisarAtribuicao } = montar();
    const marca = {
      conversation_id: CONVERSA,
      clinic_id: CLINICA,
      desde: "2026-10-27T14:59:30.000Z",
      encerrada_em: null,
    };
    reagir.marca(evento("conversa_urgente", "INSERT", marca));
    expect(avisarUrgencia).toHaveBeenCalledTimes(1);
    expect(avisarUrgencia).toHaveBeenCalledWith({
      conversationId: CONVERSA,
      chave: `${CONVERSA}:${marca.desde}`,
    });
    reagir.marca(
      evento("conversa_urgente", "UPDATE", {
        ...marca,
        encerrada_em: "2026-10-27T15:01:00.000Z",
      }),
    );
    reagir.marca(evento("conversa_urgente", "DELETE", marca));
    reagir.marca(
      evento("conversa_urgente", "INSERT", {
        ...marca,
        clinic_id: OUTRA_CLINICA,
      }),
    );
    expect(avisarUrgencia).toHaveBeenCalledTimes(1);
    expect(recontar).toHaveBeenCalledTimes(4);
    // A marca nunca pergunta pela atribuicao.
    expect(avisarAtribuicao).not.toHaveBeenCalled();
  });

  it("o agendamento só reconta", () => {
    const { reagir, recontar, avisarAtribuicao, avisarUrgencia } = montar();
    reagir.agenda(
      evento("appointment", "UPDATE", { id: "a", clinic_id: CLINICA }),
    );
    expect(recontar).toHaveBeenCalledTimes(1);
    expect(avisarAtribuicao).not.toHaveBeenCalled();
    expect(avisarUrgencia).not.toHaveBeenCalled();
  });

  it("nos canais: o evento de conversation do canal principal chega ao vigia", () => {
    const { supabase, canais } = supabaseDeCanais();
    const { reagir, avisarAtribuicao } = montar();
    canaisDoMenu(
      supabase as never,
      CLINICA,
      { conversas: true, confirmacoes: true },
      reagir,
    );
    const daConversa = canais[0]?.assinaturas.find(
      (a) => a.tabela === "conversation",
    );
    daConversa?.reagir(
      conversa({ status: "em_atendimento", assignee_user_id: EU }),
    );
    expect(avisarAtribuicao).toHaveBeenCalledWith(CONVERSA);
  });
});

// ---------------------------------------------------------------------------
// Quando o evento pede o aviso
// ---------------------------------------------------------------------------

describe("quando o evento pede o aviso na tela", () => {
  const marca = {
    conversation_id: CONVERSA,
    clinic_id: CLINICA,
    desde: "2026-10-27T14:59:30.000Z",
    encerrada_em: null,
  };

  it("urgência: a marca aberta, da clínica ativa, uma vez por marca", () => {
    expect(avisos.avisoDeUrgenciaDaLinha(marca, CLINICA)).toEqual({
      conversationId: CONVERSA,
      chave: `${CONVERSA}:${marca.desde}`,
    });
    // A marca reaberta (outra passagem por urgencia) e outro aviso.
    expect(
      avisos.avisoDeUrgenciaDaLinha(
        { ...marca, desde: "2026-10-27T16:00:00.000Z" },
        CLINICA,
      )?.chave,
    ).not.toBe(`${CONVERSA}:${marca.desde}`);
    for (const outra of [
      { ...marca, encerrada_em: "2026-10-27T15:00:00.000Z" },
      { ...marca, clinic_id: OUTRA_CLINICA },
      { ...marca, desde: "ontem" },
      { clinic_id: CLINICA },
      null,
    ]) {
      expect(
        avisos.avisoDeUrgenciaDaLinha(outra, CLINICA),
        JSON.stringify(outra),
      ).toBeNull();
    }
  });

  it("urgência: o relógio do navegador não decide (a marca antiga ainda aberta avisa)", () => {
    expect(
      avisos.avisoDeUrgenciaDaLinha(
        { ...marca, desde: "2026-10-27T09:00:00.000Z" },
        CLINICA,
      ),
    ).not.toBeNull();
  });

  const evento = {
    body: "A conversa ficou com Ana Souza, responsável pelo lead.",
  };

  it("o texto da atribuição é o do banco, com e sem o nome", () => {
    expect(avisos.ehEventoDeAtribuicao(evento.body)).toBe(true);
    expect(
      avisos.ehEventoDeAtribuicao(
        "A conversa ficou com o responsável pelo lead.",
      ),
    ).toBe(true);
    for (const outro of [
      "Ana Souza assumiu a conversa",
      "A IA passou a conversa para a equipe: a pessoa descreveu algo que pode ser uma emergência.",
      "A conversa ficou com Ana\nSouza, responsável pelo lead.",
      `A conversa ficou com ${"A".repeat(81)}, responsável pelo lead.`,
      null,
      42,
    ]) {
      expect(avisos.ehEventoDeAtribuicao(outro), String(outro)).toBe(false);
    }
  });

  it("reconhece todo texto que o espelho do banco monta (com nome longo, acento e emoji)", async () => {
    const { textoDaAtribuicaoDaIa } =
      await import("@/lib/domain/agente/config");
    for (const nome of [
      "Ana",
      "Maria-Luísa D'Ávila",
      "  Ana\n Souza\t ",
      "Ana 🌷 Souza",
      "B".repeat(120),
      "😀".repeat(90),
      null,
      "",
    ]) {
      expect(
        avisos.ehEventoDeAtribuicao(textoDaAtribuicaoDaIa(nome)),
        String(nome),
      ).toBe(true);
    }
  });

  // A conversa como o evento de conversation entrega (o menu ja recebe,
  // filtrado pela clinica).
  const linha = (campos: Record<string, unknown> = {}) => ({
    id: CONVERSA,
    clinic_id: CLINICA,
    status: "em_atendimento",
    assignee_user_id: EU,
    ...campos,
  });

  /** O vigia desta pessoa, ja semeado (nada estava com ela na montagem). */
  function vigiaArmado(
    opcoes: Partial<Parameters<typeof avisos.vigiaDaAtribuicao>[0]> = {},
  ) {
    const vigia = avisos.vigiaDaAtribuicao({
      clinicId: CLINICA,
      viewerId: EU,
      ...opcoes,
    });
    vigia.semear([]);
    return vigia;
  }

  it("atribuição: pergunta quando a conversa da clínica ENTRA em atendimento comigo", () => {
    const vigia = vigiaArmado();
    // Na fila (a passagem da IA, antes da frase): nada.
    expect(
      vigia(linha({ status: "aguardando_humano", assignee_user_id: null })),
    ).toBeNull();
    // A atribuicao: entrou em atendimento comigo, uma pergunta.
    expect(vigia(linha())).toBe(CONVERSA);
  });

  it("atribuição: uma pergunta por entrada, nunca uma por evento (cada mensagem mexe na conversa)", () => {
    const vigia = vigiaArmado();
    expect(vigia(linha())).toBe(CONVERSA);
    for (let i = 0; i < 5; i += 1) {
      expect(vigia(linha({ unread_count: i }))).toBeNull();
    }
    // Saiu (devolvida para a IA) e voltou comigo: outra entrada.
    expect(
      vigia(linha({ status: "ia_atendendo", assignee_user_id: null })),
    ).toBeNull();
    expect(
      vigia(linha({ status: "aguardando_humano", assignee_user_id: null })),
    ).toBeNull();
    expect(vigia(linha())).toBe(CONVERSA);
    // Cada conversa conta a parte.
    const outra = "44444444-4444-4444-8444-444444444444";
    expect(vigia(linha({ id: outra }))).toBe(outra);
    expect(vigia(linha())).toBeNull();
  });

  it("atribuição: de outra pessoa, de outra clínica, fora de atendimento ou fora do formato, nunca", () => {
    const vigia = vigiaArmado();
    for (const outra of [
      linha({ assignee_user_id: OUTRA_PESSOA }),
      linha({ assignee_user_id: null }),
      linha({ status: "aguardando_humano" }),
      linha({ status: "resolvida" }),
      linha({ clinic_id: OUTRA_CLINICA }),
      linha({ id: 42 }),
      { clinic_id: CLINICA },
      null,
      undefined,
    ]) {
      expect(vigia(outra), JSON.stringify(outra)).toBeNull();
    }
    // A conversa de outra pessoa que passa para mim e uma entrada.
    expect(vigia(linha())).toBe(CONVERSA);
  });

  it("atribuição: o vigia esquece tudo no limite, e a próxima é só mais uma pergunta", () => {
    const vigia = vigiaArmado({ limite: 2 });
    expect(vigia(linha({ id: "a" }))).toBe("a");
    expect(vigia(linha({ id: "b" }))).toBe("b");
    // A terceira conversa enche o limite: o vigia esquece as outras.
    expect(vigia(linha({ id: "c" }))).toBe("c");
    expect(vigia(linha({ id: "c" }))).toBeNull();
    expect(vigia(linha({ id: "a" }))).toBe("a");
    expect(avisos.CONVERSAS_LEMBRADAS).toBeGreaterThanOrEqual(1_000);
  });

  // Revisao curta da AG6a, achado 2: o aviso se repetia depois de F5, numa
  // segunda aba, em outro aparelho e na troca de clinica, e cada conversa
  // atribuida fazia uma pergunta na fila de Server Actions.
  const OUTRA_CONVERSA = "44444444-4444-4444-8444-444444444444";
  const TERCEIRA = "55555555-5555-4555-8555-555555555555";

  it("semeado na montagem: a conversa que já estava comigo nunca pergunta (F5, segunda aba, outro aparelho)", () => {
    const vigia = avisos.vigiaDaAtribuicao({
      clinicId: CLINICA,
      viewerId: EU,
    });
    // A leitura da montagem: a conversa ja estava em atendimento comigo.
    expect(vigia.semear([CONVERSA])).toEqual([]);
    // Cada mensagem nela mexe na conversa: nenhuma pergunta, nunca.
    for (let i = 0; i < 4; i += 1) {
      expect(vigia(linha({ unread_count: i }))).toBeNull();
    }
    // A conversa que ENTRA em atendimento comigo depois da montagem
    // pergunta, uma vez.
    expect(vigia(linha({ id: OUTRA_CONVERSA }))).toBe(OUTRA_CONVERSA);
    expect(vigia(linha({ id: OUTRA_CONVERSA }))).toBeNull();
    // A que ja estava comigo, se sai e volta depois da montagem, e outra
    // entrada (devolvida para a IA e passada de novo).
    expect(
      vigia(linha({ status: "ia_atendendo", assignee_user_id: null })),
    ).toBeNull();
    expect(vigia(linha())).toBe(CONVERSA);
  });

  it("desarmado: nenhum evento pergunta antes da semente, e a semente devolve só as entradas que ela não conhece", () => {
    const vigia = avisos.vigiaDaAtribuicao({
      clinicId: CLINICA,
      viewerId: EU,
    });
    // Antes da semente, tres conversas entram comigo e uma delas sai.
    expect(vigia(linha())).toBeNull();
    expect(vigia(linha({ id: OUTRA_CONVERSA }))).toBeNull();
    expect(vigia(linha({ id: TERCEIRA }))).toBeNull();
    expect(
      vigia(
        linha({
          id: TERCEIRA,
          status: "aguardando_humano",
          assignee_user_id: null,
        }),
      ),
    ).toBeNull();
    // A semente conhece a CONVERSA (ja estava comigo na leitura): so a
    // OUTRA entrou depois da leitura, e ela pergunta agora.
    expect(vigia.semear([CONVERSA])).toEqual([OUTRA_CONVERSA]);
    // Daqui em diante, nenhuma das duas pergunta de novo.
    expect(vigia(linha())).toBeNull();
    expect(vigia(linha({ id: OUTRA_CONVERSA }))).toBeNull();
    // A que saiu antes da semente e volta agora e uma entrada.
    expect(vigia(linha({ id: TERCEIRA }))).toBe(TERCEIRA);
  });

  it("a semente só preenche o que o vigia não conhece: o evento que chegou antes vale mais que ela", () => {
    const vigia = avisos.vigiaDaAtribuicao({
      clinicId: CLINICA,
      viewerId: EU,
    });
    // O evento diz que a conversa saiu de mim; a leitura (de quando, nao se
    // sabe) ainda a via comigo.
    expect(
      vigia(linha({ status: "resolvida", assignee_user_id: EU })),
    ).toBeNull();
    expect(vigia.semear([CONVERSA])).toEqual([]);
    // Quando ela volta comigo, e uma entrada.
    expect(vigia(linha())).toBe(CONVERSA);
  });

  it("a semente que falhou (vazia) arma assim mesmo, e só a primeira semente vale", () => {
    const vigia = avisos.vigiaDaAtribuicao({
      clinicId: CLINICA,
      viewerId: EU,
    });
    expect(vigia(linha())).toBeNull();
    // A leitura falhou: o que esperava pergunta (o servidor confere).
    expect(vigia.semear([])).toEqual([CONVERSA]);
    expect(vigia(linha({ id: OUTRA_CONVERSA }))).toBe(OUTRA_CONVERSA);
    // Uma segunda semente nao desarma nem apaga nada.
    expect(vigia.semear([TERCEIRA])).toEqual([]);
    expect(vigia(linha({ id: TERCEIRA }))).toBe(TERCEIRA);
  });

  it("troca de clínica: o vigia da clínica nova, semeado com as dela, não pergunta pelas que já estavam comigo lá", () => {
    const daNova = avisos.vigiaDaAtribuicao({
      clinicId: OUTRA_CLINICA,
      viewerId: EU,
    });
    expect(daNova.semear([OUTRA_CONVERSA])).toEqual([]);
    expect(
      daNova(linha({ id: OUTRA_CONVERSA, clinic_id: OUTRA_CLINICA })),
    ).toBeNull();
    // Evento da clinica de antes nunca chega a ele.
    expect(daNova(linha())).toBeNull();
  });

  it("a leitura da semente: só os ids das conversas em atendimento comigo, da clínica ativa, pela sessão", async () => {
    const { conversasEmAtendimentoCom } =
      await import("@/components/shell/contadores-do-menu");
    const { cliente, consultas } = clienteFalso(() => ({
      data: [{ id: CONVERSA }, { id: OUTRA_CONVERSA }, { id: 42 }],
    }));
    expect(
      await conversasEmAtendimentoCom(cliente as never, CLINICA, EU),
    ).toEqual([CONVERSA, OUTRA_CONVERSA]);
    expect(consultas).toEqual([
      {
        tabela: "conversation",
        // So o id: nenhum dado de paciente (nem trilha a gravar).
        colunas: "id",
        opcoes: null,
        filtros: [
          ["eq", "clinic_id", CLINICA],
          ["eq", "status", "em_atendimento"],
          ["eq", "assignee_user_id", EU],
          ["limit", "", avisos.CONVERSAS_LEMBRADAS],
        ],
      },
    ]);
    // Sem nada: lista vazia; com erro: nulo (quem chama semeia vazio).
    expect(
      await conversasEmAtendimentoCom(
        clienteFalso(() => ({ data: null })).cliente as never,
        CLINICA,
        EU,
      ),
    ).toEqual([]);
    expect(
      await conversasEmAtendimentoCom(
        clienteFalso(() => ({ error: { code: "08006" } })).cliente as never,
        CLINICA,
        EU,
      ),
    ).toBeNull();
  });

  it("o menu semeia o vigia na montagem com a leitura, e pergunta só pelo que a semente devolve", () => {
    const vigia = readFileSync(
      join(process.cwd(), "components/shell/use-contadores-do-menu.ts"),
      "utf8",
    );
    expect(vigia).toMatch(
      /conversasEmAtendimentoCom\(supabase, clinicId, viewerId\)[\s\S]*?\.catch\(\(\) => null\)[\s\S]*?atribuicaoNova\.semear\(ids \?\? \[\]\)[\s\S]*?avisarAtribuicao\(conversationId\)/,
    );
    // So com o Atendimento no menu (o mesmo canal de conversation).
    expect(vigia).toMatch(
      /if \(vigiarConversas\) \{\s*void conversasEmAtendimentoCom\(/,
    );
    // A semente que chega depois de o vigia morrer (troca de clinica,
    // desmontagem) nao pergunta nada.
    expect(vigia).toMatch(
      /\.then\(\(ids\) => \{\s*if \(!ativo\) \{\s*return;\s*\}\s*for \(const conversationId of atribuicaoNova\.semear/,
    );
  });

  it("o Abrir: com o Atendimento aberto, pede pela janela; fora dele, vai pelo link", () => {
    expect(avisos.destinoDoAbrir("/atendimento", CONVERSA)).toEqual({
      tipo: "evento",
    });
    expect(avisos.destinoDoAbrir("/agenda", CONVERSA)).toEqual({
      tipo: "rota",
      href: `/atendimento?conversa=${CONVERSA}`,
    });
    expect(avisos.destinoDoAbrir("/atendimentos", CONVERSA).tipo).toBe("rota");
    const pedido = new Event(avisos.EVENTO_ABRIR_CONVERSA);
    Object.assign(pedido, { detail: { conversationId: CONVERSA } });
    expect(avisos.conversaDoPedido(pedido)).toBe(CONVERSA);
    expect(avisos.conversaDoPedido(new Event("x"))).toBeNull();
  });

  it("os textos dos avisos, sem travessão e com o Abrir de 40px", () => {
    expect(avisos.TEXTOS_DOS_AVISOS.urgente("Maria Silva")).toBe(
      "Conversa urgente de Maria Silva.",
    );
    expect(avisos.TEXTOS_DOS_AVISOS.atribuida("Maria Silva")).toBe(
      "A IA passou para você a conversa de Maria Silva.",
    );
    expect(avisos.TEXTOS_DOS_AVISOS.abrir).toBe("Abrir");
    for (const texto of [
      avisos.TEXTOS_DOS_AVISOS.urgente("X"),
      avisos.TEXTOS_DOS_AVISOS.urgenteSemNome,
      avisos.TEXTOS_DOS_AVISOS.atribuida("X"),
    ]) {
      expect(texto).not.toMatch(/[—–]/);
    }
    expect(ESTILO_DO_ABRIR.height).toBeGreaterThanOrEqual(40);
    // O anel de foco do DS vence o "outline: 0" do sonner (C5).
    expect(CLASSE_DO_ABRIR).toContain("focus-visible:outline-focus!");
    expect(CLASSE_DO_ABRIR).toContain("focus-visible:outline-2!");
    expect(DURACAO_DO_AVISO_DE_URGENCIA_MS).toBeGreaterThan(10_000);
  });
});

// ---------------------------------------------------------------------------
// A Server Action: confere de novo e grava a trilha antes do nome
// ---------------------------------------------------------------------------

type Respostas = {
  conversa?: unknown;
  erroDaConversa?: unknown;
  mensagem?: unknown;
  erroDaMensagem?: unknown;
  /** O perfil de quem pede (EU); sem a chave, o da Ana Souza. */
  perfil?: unknown;
  erroDoPerfil?: unknown;
};

/** O nome do perfil de quem pede nos testes (a sessao e a EU). */
const MEU_NOME = "Ana Souza";

function bancoCom(respostas: Respostas) {
  banco = clienteFalso((consulta) => {
    if (consulta.tabela === "conversation") {
      return respostas.erroDaConversa
        ? { error: respostas.erroDaConversa }
        : { data: respostas.conversa ?? null };
    }
    if (consulta.tabela === "message") {
      return respostas.erroDaMensagem
        ? { error: respostas.erroDaMensagem }
        : { data: respostas.mensagem ?? null };
    }
    if (consulta.tabela === "profile") {
      if (respostas.erroDoPerfil) {
        return { error: respostas.erroDoPerfil };
      }
      return {
        data: "perfil" in respostas ? respostas.perfil : { name: MEU_NOME },
      };
    }
    return { error: { code: "42P01" } };
  });
  return banco;
}

const CONTATO = { name: "Maria Silva", phone_e164: "+5585999990000" };

function urgente(campos: Record<string, unknown> = {}) {
  return {
    status: "aguardando_humano",
    assignee_user_id: null,
    contact: CONTATO,
    urgencia: { desde: "2026-10-27T14:59:30.000Z", encerrada_em: null },
    ...campos,
  };
}

describe("lerAvisoDaConversaAction (urgente)", () => {
  it("a marca aberta em Aguardando você: o nome, com a trilha antes", async () => {
    const { consultas } = bancoCom({ conversa: urgente() });
    expect(
      await lerAvisoDaConversaAction({
        tipo: "urgente",
        conversationId: CONVERSA,
      }),
    ).toEqual({ ok: true, aviso: { contato: "Maria Silva" } });
    expect(trilha).toHaveBeenCalledTimes(1);
    // A trilha com o id da conversa: a linha diz de quem foi a leitura.
    expect(trilha.mock.calls[0]?.[1]).toEqual({
      clinicId: CLINICA,
      userId: EU,
      entity: "inbox",
      entityId: CONVERSA,
    });
    // Pela sessao, presa a clinica ativa e a conversa pedida.
    expect(consultas[0]?.tabela).toBe("conversation");
    expect(consultas[0]?.filtros).toEqual([
      ["eq", "clinic_id", CLINICA],
      ["eq", "id", CONVERSA],
    ]);
    expect(consultas[0]?.colunas).toContain(
      "urgencia:conversa_urgente (desde, encerrada_em)",
    );
  });

  it("sem nome, o telefone formatado", async () => {
    bancoCom({ conversa: urgente({ contact: { ...CONTATO, name: " " } }) });
    expect(
      await lerAvisoDaConversaAction({
        tipo: "urgente",
        conversationId: CONVERSA,
      }),
    ).toEqual({ ok: true, aviso: { contato: "(85) 99999-0000" } });
  });

  it("alguém já pegou, a marca fechou ou a pessoa não vê: sem aviso e sem trilha", async () => {
    for (const conversa of [
      urgente({ status: "em_atendimento", assignee_user_id: OUTRA_PESSOA }),
      urgente({
        urgencia: {
          desde: "2026-10-27T14:59:30.000Z",
          encerrada_em: "2026-10-27T14:59:50.000Z",
        },
      }),
      urgente({ urgencia: null }),
      null,
    ]) {
      bancoCom({ conversa });
      expect(
        await lerAvisoDaConversaAction({
          tipo: "urgente",
          conversationId: CONVERSA,
        }),
      ).toEqual({ ok: true, aviso: null });
    }
    expect(trilha).not.toHaveBeenCalled();
  });

  it("sem sessão, entrada fora do formato ou leitura que falha: ok falso, sem trilha", async () => {
    bancoCom({ conversa: urgente() });
    sessao = null;
    expect(
      await lerAvisoDaConversaAction({
        tipo: "urgente",
        conversationId: CONVERSA,
      }),
    ).toEqual({ ok: false });
    sessao = { userId: EU, active: { clinicId: CLINICA, role: "recepcao" } };
    for (const entrada of [
      { tipo: "urgente", conversationId: "nao-e-uuid" },
      { tipo: "outro", conversationId: CONVERSA },
      { tipo: "urgente", conversationId: CONVERSA, extra: 1 },
      null,
    ]) {
      expect(await lerAvisoDaConversaAction(entrada)).toEqual({ ok: false });
    }
    bancoCom({ erroDaConversa: { code: "42P01" } });
    expect(
      await lerAvisoDaConversaAction({
        tipo: "urgente",
        conversationId: CONVERSA,
      }),
    ).toEqual({ ok: false });
    expect(trilha).not.toHaveBeenCalled();
  });
});

describe("lerAvisoDaConversaAction (atribuida)", () => {
  const minha = {
    status: "em_atendimento",
    assignee_user_id: EU,
    contact: CONTATO,
  };
  const evento = {
    author: "sistema",
    content_type: "evento",
    body: "A conversa ficou com Ana Souza, responsável pelo lead.",
    created_at: new Date(Date.now() - 2_000).toISOString(),
  };
  // Revisao da AG6a: o vigia pergunta pela conversa (o evento de
  // conversation), sem o id de mensagem nenhuma.
  const ENTRADA = { tipo: "atribuida", conversationId: CONVERSA } as const;

  it("a conversa ficou comigo e o último evento do fio é o da atribuição: o nome, com a trilha da conversa", async () => {
    const { consultas } = bancoCom({ conversa: minha, mensagem: evento });
    expect(await lerAvisoDaConversaAction(ENTRADA)).toEqual({
      ok: true,
      aviso: { contato: "Maria Silva" },
    });
    expect(trilha).toHaveBeenCalledTimes(1);
    expect(trilha.mock.calls[0]?.[1]).toEqual({
      clinicId: CLINICA,
      userId: EU,
      entity: "inbox",
      entityId: CONVERSA,
    });
    // A conversa sem o embutido da marca (a atribuicao nao precisa dela).
    const daConversa = consultas.find((c) => c.tabela === "conversation");
    expect(daConversa?.colunas).not.toContain("conversa_urgente");
    expect(daConversa?.filtros).toEqual([
      ["eq", "clinic_id", CLINICA],
      ["eq", "id", CONVERSA],
    ]);
    // O ULTIMO evento da conversa (o desempate pelo id), na clinica ativa.
    const daMensagem = consultas.find((c) => c.tabela === "message");
    expect(daMensagem?.colunas).toBe("author, content_type, body, created_at");
    expect(daMensagem?.filtros).toEqual([
      ["eq", "clinic_id", CLINICA],
      ["eq", "conversation_id", CONVERSA],
      ["eq", "content_type", "evento"],
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["limit", "", 1],
    ]);
    // O nome de quem pede: o proprio perfil, pela sessao (a policy deixa).
    const doPerfil = consultas.find((c) => c.tabela === "profile");
    expect(doPerfil?.colunas).toBe("name");
    expect(doPerfil?.filtros).toEqual([["eq", "user_id", EU]]);
  });

  it("o evento sem o nome (o genérico do banco) vale só para quem não tem nome no perfil", async () => {
    const generico = {
      ...evento,
      body: "A conversa ficou com o responsável pelo lead.",
    };
    // O banco escreve o generico com o perfil vazio ou ausente.
    for (const perfil of [{ name: "   " }, { name: "" }, null]) {
      bancoCom({ conversa: minha, mensagem: generico, perfil });
      expect(
        await lerAvisoDaConversaAction(ENTRADA),
        JSON.stringify(perfil),
      ).toEqual({ ok: true, aviso: { contato: "Maria Silva" } });
    }
    // Com nome no perfil, o generico foi de outra pessoa (sem nome).
    trilha.mockClear();
    bancoCom({ conversa: minha, mensagem: generico });
    expect(await lerAvisoDaConversaAction(ENTRADA)).toEqual({
      ok: true,
      aviso: null,
    });
    expect(trilha).not.toHaveBeenCalled();
  });

  // Revisao curta da AG6a, achado 3: Assumir e Transferir gravam o evento
  // deles DEPOIS do update. A IA atribuiu ao Bruno ha menos de 5 minutos, o
  // Bruno passa para a Ana: no instante entre o update e o evento do
  // Transferir, a conversa ja esta com a Ana e o ultimo evento do fio
  // ainda e a atribuicao ao Bruno.
  it("o Bruno passa para a Ana logo depois da atribuição da IA: a Ana não vê A IA passou para você", async () => {
    const aoBruno = {
      ...evento,
      body: "A conversa ficou com Bruno Lima, responsável pelo lead.",
    };
    // (O mesmo quando a Ana ASSUME a conversa que a IA tinha dado ao Bruno:
    // o servidor ve a mesma coisa.)
    bancoCom({ conversa: minha, mensagem: aoBruno });
    expect(await lerAvisoDaConversaAction(ENTRADA)).toEqual({
      ok: true,
      aviso: null,
    });
    expect(trilha).not.toHaveBeenCalled();
    // Quando o evento do Transferir chega, o ultimo ja e outro: sem aviso
    // tambem (o caso de sempre).
    bancoCom({
      conversa: minha,
      mensagem: {
        ...evento,
        body: "Bruno Lima passou a conversa para Ana Souza",
      },
    });
    expect(await lerAvisoDaConversaAction(ENTRADA)).toEqual({
      ok: true,
      aviso: null,
    });
    // E a Ana com nome parecido nao passa: o nome inteiro, como o banco
    // escreveu.
    for (const nome of ["Ana", "Ana Souza Lima", "ana souza"]) {
      bancoCom({ conversa: minha, mensagem: evento, perfil: { name: nome } });
      expect(await lerAvisoDaConversaAction(ENTRADA), nome).toEqual({
        ok: true,
        aviso: null,
      });
    }
    expect(trilha).not.toHaveBeenCalled();
  });

  it("o nome do perfil como o banco escreve: numa linha, sem as pontas e até 80 caracteres", async () => {
    const { textoDaAtribuicaoDaIa } =
      await import("@/lib/domain/agente/config");
    for (const nome of [
      "  Ana\n Souza\t ",
      "Maria-Luísa D'Ávila",
      "Ana 🌷 Souza",
      "B".repeat(120),
      "😀".repeat(90),
    ]) {
      trilha.mockClear();
      bancoCom({
        conversa: minha,
        mensagem: { ...evento, body: textoDaAtribuicaoDaIa(nome) },
        perfil: { name: nome },
      });
      expect(await lerAvisoDaConversaAction(ENTRADA), nome).toEqual({
        ok: true,
        aviso: { contato: "Maria Silva" },
      });
      expect(trilha).toHaveBeenCalledTimes(1);
    }
    // O corte e o do banco: 80 caracteres do nome, nem 79 nem 81.
    for (const tamanho of [79, 81]) {
      bancoCom({
        conversa: minha,
        mensagem: {
          ...evento,
          body: `A conversa ficou com ${"B".repeat(tamanho)}, responsável pelo lead.`,
        },
        perfil: { name: "B".repeat(120) },
      });
      expect(await lerAvisoDaConversaAction(ENTRADA), String(tamanho)).toEqual({
        ok: true,
        aviso: null,
      });
    }
  });

  it("os espaços que o Postgres não junta (o espaço sem quebra) não tiram o aviso de quem é", async () => {
    // O \s do Postgres nao pega o espaco sem quebra; o do JavaScript pega.
    // Os dois lados viram uma linha so antes de comparar.
    bancoCom({
      conversa: minha,
      mensagem: {
        ...evento,
        body: "A conversa ficou com Ana\u00a0Souza, responsável pelo lead.",
      },
      perfil: { name: "Ana\u00a0Souza" },
    });
    expect(await lerAvisoDaConversaAction(ENTRADA)).toEqual({
      ok: true,
      aviso: { contato: "Maria Silva" },
    });
  });

  it("a leitura do perfil que falha: ok falso, sem trilha e só o código no log", async () => {
    const saida = vi.mocked(process.stdout.write);
    saida.mockClear();
    bancoCom({
      conversa: minha,
      mensagem: evento,
      erroDoPerfil: { code: "42501", message: "Ana Souza sem permissão" },
    });
    expect(await lerAvisoDaConversaAction(ENTRADA)).toEqual({ ok: false });
    expect(trilha).not.toHaveBeenCalled();
    const linhas = saida.mock.calls.map(([linha]) => String(linha));
    expect(linhas).toHaveLength(1);
    const registro = JSON.parse(linhas[0] ?? "{}") as Record<string, unknown>;
    expect(registro).toMatchObject({
      evento: "aviso_da_conversa_nao_lido",
      clinic_id: CLINICA,
      kind: "atribuida",
      error_code: "42501",
    });
    expect(linhas[0]).not.toContain("Ana");
    expect(linhas[0]).not.toContain("Maria");
  });

  it("de outra pessoa, de outro evento, velho ou fora de atendimento: sem aviso", async () => {
    for (const [conversa, mensagem] of [
      [{ ...minha, assignee_user_id: OUTRA_PESSOA }, evento],
      [
        { ...minha, status: "aguardando_humano", assignee_user_id: null },
        evento,
      ],
      [minha, { ...evento, body: "Ana Souza assumiu a conversa" }],
      [minha, { ...evento, author: "usuario" }],
      [minha, { ...evento, content_type: "texto" }],
      [minha, { ...evento, created_at: "2026-10-01T10:00:00.000Z" }],
      [minha, null],
    ] as const) {
      bancoCom({ conversa, mensagem });
      expect(await lerAvisoDaConversaAction(ENTRADA)).toEqual({
        ok: true,
        aviso: null,
      });
    }
    expect(trilha).not.toHaveBeenCalled();
  });

  it("a janela de 5 minutos, pelo relógio do servidor contra o instante do banco", async () => {
    const agora = Date.parse("2026-10-27T15:00:00.000Z");
    const relogio = vi.spyOn(Date, "now").mockReturnValue(agora);
    try {
      const quando = (ms: number) => new Date(agora - ms).toISOString();
      bancoCom({
        conversa: minha,
        mensagem: {
          ...evento,
          created_at: quando(avisos.JANELA_DO_AVISO_MS - 1_000),
        },
      });
      expect(await lerAvisoDaConversaAction(ENTRADA)).toEqual({
        ok: true,
        aviso: { contato: "Maria Silva" },
      });
      bancoCom({
        conversa: minha,
        mensagem: {
          ...evento,
          created_at: quando(avisos.JANELA_DO_AVISO_MS + 1_000),
        },
      });
      expect(await lerAvisoDaConversaAction(ENTRADA)).toEqual({
        ok: true,
        aviso: null,
      });
      expect(trilha).toHaveBeenCalledTimes(1);
      expect(avisos.JANELA_DO_AVISO_MS).toBe(5 * 60_000);
    } finally {
      relogio.mockRestore();
    }
  });

  it("eu mesma assumi: o último evento é o assumiu, sem aviso e sem trilha", async () => {
    bancoCom({
      conversa: minha,
      mensagem: { ...evento, body: "Maria assumiu a conversa" },
    });
    expect(await lerAvisoDaConversaAction(ENTRADA)).toEqual({
      ok: true,
      aviso: null,
    });
    expect(trilha).not.toHaveBeenCalled();
  });

  it("entrada fora do formato (inclusive o id de mensagem de antes) ou leitura do fio que falha: ok falso, sem trilha", async () => {
    bancoCom({ conversa: minha, mensagem: evento });
    for (const entrada of [
      { tipo: "atribuida", conversationId: CONVERSA, messageId: MENSAGEM },
      { tipo: "atribuida", conversationId: "nao-e-uuid" },
      { tipo: "atribuida" },
    ]) {
      expect(await lerAvisoDaConversaAction(entrada)).toEqual({ ok: false });
    }
    bancoCom({ conversa: minha, erroDaMensagem: { code: "08006" } });
    expect(await lerAvisoDaConversaAction(ENTRADA)).toEqual({ ok: false });
    expect(trilha).not.toHaveBeenCalled();
  });
});
