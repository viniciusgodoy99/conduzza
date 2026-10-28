import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// AG6a no menu e nos avisos na tela (desenho da AG6, secoes 1.1, 1.3 e 6;
// D-53 e D-55 pela recomendacao, pendentes do dono; contrato da frente de
// banco, secoes 3 e 5):
// - a contagem das urgentes abertas (conversa_urgente, a RLS recorta) e o
//   contador do Atendimento em alerta, em 3 camadas (o sino, "N urgentes"
//   no nome do link e os tokens do alerta da sidebar, iguais nos dois
//   temas); sem a contagem, o tom de sempre;
// - os avisos "Conversa urgente de {nome}." e "A IA passou para você a
//   conversa de {nome}.": quando o evento pede o aviso e o que a Server
//   Action confere de novo (pela sessao, com a trilha antes do nome).
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
const { alertaDoItem } = await import("@/components/shell/rail");
const avisos = await import("@/components/shell/avisos-da-conversa");
const { lerAvisoDaConversaAction } =
  await import("@/app/(app)/atendimento/avisos-actions");
const { CLASSE_DO_ABRIR, DURACAO_DO_AVISO_DE_URGENCIA_MS, ESTILO_DO_ABRIR } =
  await import("@/components/shell/use-contadores-do-menu");

beforeEach(() => {
  sessao = { userId: EU, active: { clinicId: CLINICA, role: "recepcao" } };
  trilha.mockClear();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

// ---------------------------------------------------------------------------
// A contagem
// ---------------------------------------------------------------------------

describe("a contagem das urgentes abertas", () => {
  it("conta a marca aberta da clínica ativa, só a contagem (head)", async () => {
    const { cliente, consultas } = clienteFalso(() => ({ count: 2 }));
    expect(await contarConversasUrgentes(cliente as never, CLINICA)).toBe(2);
    expect(consultas).toEqual([
      {
        tabela: "conversa_urgente",
        colunas: "conversation_id",
        opcoes: { count: "exact", head: true },
        filtros: [
          ["eq", "clinic_id", CLINICA],
          ["is", "encerrada_em", null],
        ],
      },
    ]);
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
    expect(html).toContain(
      ", 3 conversas aguardando resposta, 1 conversa urgente",
    );
    expect(html.match(/lucide-bell-ring/g)).toHaveLength(2);
    expect(html).toContain("bg-(--sidebar-badge-alerta)");
    expect(html).toContain("text-(--sidebar-badge-alerta-text)");
    expect(html).not.toContain("bg-(--sidebar-badge) ");
  });

  it("o alerta vence o lime do item aberto", () => {
    const html = pilula({
      count: 3,
      ativo: true,
      descricao: "conversas aguardando resposta",
      alerta: { quantas: 2, descricao: "conversas urgentes" },
    });
    expect(html).toContain("bg-(--sidebar-badge-alerta)");
    expect(html).not.toContain("bg-sidebar-primary");
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
    id: MENSAGEM,
    conversation_id: CONVERSA,
    clinic_id: CLINICA,
    author: "sistema",
    content_type: "evento",
    body: "A conversa ficou com Ana Souza, responsável pelo lead.",
    created_at: "2026-10-27T14:59:58.000Z",
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

  it("atribuição: o evento do sistema, da clínica ativa (a idade o servidor confere)", () => {
    expect(avisos.avisoDeAtribuicaoDaLinha(evento, CLINICA)).toEqual({
      conversationId: CONVERSA,
      messageId: MENSAGEM,
    });
    for (const outro of [
      { ...evento, clinic_id: OUTRA_CLINICA },
      { ...evento, author: "usuario" },
      { ...evento, content_type: "texto" },
      { ...evento, body: "Ana Souza assumiu a conversa" },
      { ...evento, id: undefined },
      { ...evento, conversation_id: 42 },
      null,
    ]) {
      expect(avisos.avisoDeAtribuicaoDaLinha(outro, CLINICA)).toBeNull();
    }
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
};

function bancoCom(respostas: Respostas) {
  banco = clienteFalso((consulta) => {
    if (consulta.tabela === "conversation") {
      return respostas.erroDaConversa
        ? { error: respostas.erroDaConversa }
        : { data: respostas.conversa ?? null };
    }
    if (consulta.tabela === "message") {
      return { data: respostas.mensagem ?? null };
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
    expect(trilha.mock.calls[0]?.[1]).toEqual({
      clinicId: CLINICA,
      userId: EU,
      entity: "inbox",
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
  const minha = urgente({
    status: "em_atendimento",
    assignee_user_id: EU,
    urgencia: null,
  });
  const evento = {
    author: "sistema",
    content_type: "evento",
    body: "A conversa ficou com Ana Souza, responsável pelo lead.",
    created_at: new Date(Date.now() - 2_000).toISOString(),
  };
  const ENTRADA = {
    tipo: "atribuida",
    conversationId: CONVERSA,
    messageId: MENSAGEM,
  } as const;

  it("a conversa ficou comigo pelo evento da atribuição: o nome", async () => {
    const { consultas } = bancoCom({ conversa: minha, mensagem: evento });
    expect(await lerAvisoDaConversaAction(ENTRADA)).toEqual({
      ok: true,
      aviso: { contato: "Maria Silva" },
    });
    expect(trilha).toHaveBeenCalledTimes(1);
    const daMensagem = consultas.find((c) => c.tabela === "message");
    expect(daMensagem?.filtros).toEqual([
      ["eq", "id", MENSAGEM],
      ["eq", "conversation_id", CONVERSA],
    ]);
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

  it("a atribuição exige o id da mensagem", async () => {
    bancoCom({ conversa: minha, mensagem: evento });
    expect(
      await lerAvisoDaConversaAction({
        tipo: "atribuida",
        conversationId: CONVERSA,
      }),
    ).toEqual({ ok: false });
  });
});
