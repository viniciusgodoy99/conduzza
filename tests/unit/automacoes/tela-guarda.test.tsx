import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionContext } from "@/lib/auth/active-clinic";
import type { AutomacaoDeFluxo } from "@/lib/domain/automacoes-de-fluxo";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import type { Role } from "@/lib/domain/permissions";

// A rota /automacoes depois do item 13 da onda 4 (decisoes do dono de
// 20/10/2026):
//   - a guarda de modulo no layout: profissional e leitura vao para o Inicio
//     (antes abriam a tela pela URL; so o menu escondia o item), recepcao,
//     administrador e gestor entram;
//   - a aba "Automações de fluxo" (?aba=fluxo), que saiu de Configuracoes,
//     so existe para administrador e gestor, decidido no servidor: para a
//     recepcao nada dela e lido, o cartao nao aparece e ?aba=fluxo cai na
//     Confirmacao, como aba desconhecida;
//   - o cartao da aba diz a situacao das regras em 3 camadas, e a leitura
//     que falha vira o erro da aba, sem derrubar a tela.
// Sessao, banco e Server Actions sao falsos: nada aqui toca rede.

vi.mock("server-only", () => ({}));

const sessao = vi.hoisted(() => ({
  atual: null as SessionContext | null,
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: () => Promise.resolve(sessao.atual),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/automacoes",
  useSearchParams: () => new URLSearchParams(),
}));

const banco = vi.hoisted(() => ({
  createClient: vi.fn(),
  fetchReguasDaClinica: vi.fn(),
  fetchVolumesDaEstimativa: vi.fn(),
  fetchReguasVinculadas: vi.fn(),
  fetchFollowups: vi.fn(),
  fetchJornada: vi.fn(),
  fetchNumerosDaClinica: vi.fn(),
  fetchAutomacoesDeFluxo: vi.fn(),
  fetchEtiquetasDeConversa: vi.fn(),
  fetchEtiquetasParaFiltro: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: banco.createClient }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/queries/confirmacoes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/confirmacoes")>()),
  fetchReguasDaClinica: banco.fetchReguasDaClinica,
}));
vi.mock("@/lib/queries/automacoes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/automacoes")>()),
  fetchVolumesDaEstimativa: banco.fetchVolumesDaEstimativa,
  fetchReguasVinculadas: banco.fetchReguasVinculadas,
  fetchFollowups: banco.fetchFollowups,
  fetchEtiquetasParaFiltro: banco.fetchEtiquetasParaFiltro,
}));
vi.mock("@/lib/queries/jornada", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/jornada")>()),
  fetchJornada: banco.fetchJornada,
}));
vi.mock("@/lib/queries/conversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/conversations")>()),
  fetchNumerosDaClinica: banco.fetchNumerosDaClinica,
}));
vi.mock("@/lib/queries/automacoes-de-fluxo", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/queries/automacoes-de-fluxo")
  >()),
  fetchAutomacoesDeFluxo: banco.fetchAutomacoesDeFluxo,
}));
vi.mock("@/lib/queries/etiquetas-de-conversa", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/queries/etiquetas-de-conversa")
  >()),
  fetchEtiquetasDeConversa: banco.fetchEtiquetasDeConversa,
}));
// As Server Actions das abas: aqui so a renderizacao importa.
vi.mock("@/app/(app)/automacoes/actions", () => ({
  salvarTextoDoPassoAction: vi.fn(),
  salvarAnexoDoPassoAction: vi.fn(),
  removerAnexoDoPassoAction: vi.fn(),
  criarReguaDeExcecaoAction: vi.fn(),
  salvarLimiarDaReforcadaAction: vi.fn(),
  excluirReguaAction: vi.fn(),
  criarPassoAction: vi.fn(),
  salvarEsperaDoPassoAction: vi.fn(),
  excluirPassoAction: vi.fn(),
  criarReguaDeFollowupAction: vi.fn(),
  editarParaQuemDaReguaAction: vi.fn(),
  ordenarReguasDeFollowupAction: vi.fn(),
  testarEnvioAction: vi.fn(),
  definirNumeroDasAutomaticasAction: vi.fn(),
}));
vi.mock("@/app/(app)/automacoes/fluxo-actions", () => ({
  salvarAutomacaoDeFluxoAction: vi.fn(),
  alternarAutomacaoDeFluxoAction: vi.fn(),
  excluirAutomacaoDeFluxoAction: vi.fn(),
  previaDaAutomacaoDeFluxoAction: vi.fn(),
  usoDasAutomacoesDeFluxoAction: vi.fn(),
  historicoDeAutomacoesDeFluxoAction: vi.fn(),
}));
vi.mock("@/app/(app)/confirmacoes/actions", () => ({
  salvarJanelaDaReguaAction: vi.fn(),
  alternarReguaAction: vi.fn(),
  cobrarAgoraAction: vi.fn(),
  manterHorarioAction: vi.fn(),
}));

const { default: AutomacoesLayout } =
  await import("@/app/(app)/automacoes/layout");
const { default: AutomacoesPage } = await import("@/app/(app)/automacoes/page");
const { default: CarregandoAutomacoes } =
  await import("@/app/(app)/automacoes/loading");
const { TooltipProvider } = await import("@/components/ui/tooltip");

const CLINICA = "c1111111-1111-4111-8111-111111111111";

function contexto(role: Role): SessionContext {
  return {
    userId: "33333333-3333-4333-8333-333333333333",
    userName: "Teste",
    userEmail: "teste@exemplo.com",
    memberships: [],
    active: {
      clinicId: CLINICA,
      clinicName: "Clínica Teste",
      slug: "teste",
      timezone: "America/Fortaleza",
      role,
      implementador: false,
      status: "ativo",
      productName: "Conduzza Clínicas",
      primaryColor: "#B2E54F",
      labels: null,
    },
    clinicaSuspensa: null,
    isProductAdmin: false,
    vinculoIndisponivel: false,
    marcaDeImplementadorIndisponivel: false,
  };
}

function etapa(
  chave: string,
  nome: string,
  papel: EtapaDaJornada["papel"],
  posicao: number,
): EtapaDaJornada {
  return {
    id: `id-${chave}`,
    chave,
    nome,
    posicao,
    tom: "neutral",
    icone: "circle",
    papel,
    descricao: null,
    termos_chave: [],
    termos_de_quem: "paciente",
    meta_event_name: null,
    conversao_ativa: false,
    is_sale: false,
    is_first_contact: false,
    value_source: null,
    value_cents: null,
  };
}

const JORNADA: EtapaDaJornada[] = [
  etapa("novo", "Novo", "entrada", 10),
  etapa("em_contato", "Em contato", null, 20),
  etapa("aguardando_resposta", "Aguardando resposta", null, 30),
  etapa("agendou", "Agendou", "agendou", 40),
  etapa("compareceu", "Compareceu", "compareceu", 50),
  etapa("perdido", "Perdido", "perdido", 60),
];

const MOVER = {
  posicao: 1,
  acao: "mover_etapa" as const,
  etapa_destino: "perdido",
  motivo_perda: "nao_respondeu" as const,
  etiqueta: null,
  atividade_titulo: null,
  atividade_prazo_dias: null,
  nota_texto: null,
};

const REGRA: Omit<AutomacaoDeFluxo, "id" | "nome" | "ativa"> = {
  gatilho: "sem_resposta_na_etapa",
  etapa: "aguardando_resposta",
  espera_minutos: 48 * 60,
  combinar: "todas",
  condicoes: [],
  acoes: [MOVER],
  vigente_desde: "2026-10-02T12:00:00Z",
  created_at: "2026-10-02T12:00:00Z",
  updated_at: "2026-10-02T12:00:00Z",
};

const AUTOMACOES: AutomacaoDeFluxo[] = [
  {
    ...REGRA,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    nome: "Sumiu vira Perdido",
    ativa: true,
  },
  {
    ...REGRA,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    nome: "Parado em contato",
    ativa: false,
    gatilho: "tempo_na_etapa",
    etapa: "em_contato",
    acoes: [
      { ...MOVER, etapa_destino: "aguardando_resposta", motivo_perda: null },
    ],
  },
];

/** O cliente de sessao falso: so a politica das automaticas, vazia. */
function clienteDaSessao() {
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [], error: null }),
      }),
    }),
  };
}

async function destinoDoLayout(): Promise<string> {
  try {
    await AutomacoesLayout({ children: "conteudo" as ReactNode });
    return "entrou";
  } catch (erro) {
    return erro instanceof Error ? erro.message : "erro";
  }
}

async function tela(aba?: string): Promise<string> {
  const elemento = (await AutomacoesPage({
    searchParams: Promise.resolve(aba ? { aba } : {}),
  })) as ReactElement;
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{elemento}</TooltipProvider>
    </QueryClientProvider>,
  );
}

type Cartao = { nome: string; selecionado: boolean };

/** Os cartoes seletores (role="tab"), na ordem, e qual esta selecionado. */
function cartoes(html: string): Cartao[] {
  return [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map(
    ([abertura]) => ({
      nome: /aria-label="([^"]*)"/.exec(abertura)?.[1] ?? "",
      selecionado: abertura.includes('aria-selected="true"'),
    }),
  );
}

/** O texto da situacao de um cartao (chip e nota), sem as tags. */
function situacaoDoCartao(html: string, chave: string): string {
  const inicio = html.indexOf(`id="automacoes-situacao-${chave}"`);
  expect(inicio, `situacao do cartao ${chave}`).toBeGreaterThan(-1);
  const fim = html.indexOf("</button>", inicio);
  return html
    .slice(inicio, fim)
    .replace(/^[^>]*>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  banco.createClient.mockResolvedValue(clienteDaSessao());
  banco.fetchReguasDaClinica.mockResolvedValue({
    confirmacao: null,
    pos_falta: null,
  });
  banco.fetchVolumesDaEstimativa.mockResolvedValue({
    consultas30d: 0,
    faltas30d: 0,
    precoCents: null,
  });
  banco.fetchReguasVinculadas.mockResolvedValue({
    reguas: [],
    opcoes: { medicos: [], especialidades: [], procedimentos: [] },
  });
  banco.fetchFollowups.mockResolvedValue({
    reguas: [],
    semReguaPorEtapa: {},
  });
  banco.fetchJornada.mockResolvedValue(JORNADA);
  banco.fetchNumerosDaClinica.mockResolvedValue([]);
  banco.fetchAutomacoesDeFluxo.mockResolvedValue(AUTOMACOES);
  banco.fetchEtiquetasDeConversa.mockResolvedValue([]);
  banco.fetchEtiquetasParaFiltro.mockResolvedValue([]);
});

describe("guarda de módulo da rota /automacoes", () => {
  it.each<[Role, string]>([
    ["admin", "entrou"],
    ["gestor", "entrou"],
    ["recepcao", "entrou"],
    ["profissional", "redirect:/inicio"],
    ["leitura", "redirect:/inicio"],
  ])("%s: %s", async (papel, esperado) => {
    sessao.atual = contexto(papel);
    expect(await destinoDoLayout()).toBe(esperado);
  });

  it("sem sessão vai para o login", async () => {
    sessao.atual = null;
    expect(await destinoDoLayout()).toBe("redirect:/login");
  });

  it("sem clínica ativa vai para o Início", async () => {
    sessao.atual = { ...contexto("admin"), active: null };
    expect(await destinoDoLayout()).toBe("redirect:/inicio");
  });
});

describe("aba Automações de fluxo: só administrador e gestor", () => {
  it.each<Role>(["admin", "gestor"])(
    "%s: o quinto cartão, no fim da fileira, e a aba abre pela URL",
    async (papel) => {
      sessao.atual = contexto(papel);
      const html = await tela("fluxo");
      expect(cartoes(html)).toEqual([
        { nome: "Confirmação", selecionado: false },
        { nome: "Pós falta", selecionado: false },
        { nome: "Follow-up de leads", selecionado: false },
        { nome: "Lista de espera", selecionado: false },
        { nome: "Automações de fluxo", selecionado: true },
      ]);
      // O conteudo da aba, com as regras lidas pela clinica da sessao.
      expect(html).toContain("Automações de fluxo da clínica");
      expect(html).toContain("Sumiu vira Perdido");
      expect(html).toContain("Nova automação");
      expect(html).toContain("Como as automações de fluxo funcionam");
      expect(banco.fetchAutomacoesDeFluxo).toHaveBeenCalledWith(
        expect.anything(),
        CLINICA,
      );
      expect(banco.fetchEtiquetasDeConversa).toHaveBeenCalledWith(
        expect.anything(),
        CLINICA,
      );
      // A grade cabe os cinco cartoes na tela larga.
      expect(html).toContain("xl:grid-cols-5");
      expect(html).toContain(
        "As mensagens que saem sozinhas e as regras que andam com o lead.",
      );
    },
  );

  it("recepção: o cartão não existe e nada da aba é lido", async () => {
    sessao.atual = contexto("recepcao");
    const html = await tela();
    expect(cartoes(html).map((cartao) => cartao.nome)).toEqual([
      "Confirmação",
      "Pós falta",
      "Follow-up de leads",
      "Lista de espera",
    ]);
    expect(html).not.toContain("Automações de fluxo");
    expect(html).toContain("xl:grid-cols-4");
    expect(html).not.toContain("xl:grid-cols-5");
    expect(banco.fetchAutomacoesDeFluxo).not.toHaveBeenCalled();
    expect(banco.fetchEtiquetasDeConversa).not.toHaveBeenCalled();
    // Nem as etiquetas em uso nos leads (so para quem edita um filtro).
    expect(banco.fetchEtiquetasParaFiltro).not.toHaveBeenCalled();
    // O cabecalho nao promete o que ela nao ve.
    expect(html).toContain(
      "As mensagens que saem sozinhas: o que dizem, quando saem e para quem.",
    );
    // O resto de Automacoes continua como era: visivel, so leitura (o botao
    // de criar fica desabilitado, dentro da dica).
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Nova régua vinculada/,
    );
  });

  it("recepção com ?aba=fluxo na URL cai na Confirmação, sem nada da aba", async () => {
    sessao.atual = contexto("recepcao");
    const html = await tela("fluxo");
    expect(cartoes(html).find((cartao) => cartao.selecionado)?.nome).toBe(
      "Confirmação",
    );
    expect(html).toContain(
      "Esta clínica ainda não tem a régua de confirmação configurada.",
    );
    expect(html).not.toContain("Automações de fluxo");
    expect(html).not.toContain("Sumiu vira Perdido");
    expect(html).not.toContain("Nova automação");
    expect(banco.fetchAutomacoesDeFluxo).not.toHaveBeenCalled();
    expect(banco.fetchEtiquetasDeConversa).not.toHaveBeenCalled();
  });

  it("aba desconhecida cai na Confirmação para todos", async () => {
    sessao.atual = contexto("admin");
    const html = await tela("nao-existe");
    expect(cartoes(html).find((cartao) => cartao.selecionado)?.nome).toBe(
      "Confirmação",
    );
  });
});

describe("cartão Automações de fluxo", () => {
  it("com regra ligada: Ligada, com quantas de quantas", async () => {
    sessao.atual = contexto("admin");
    const html = await tela();
    expect(situacaoDoCartao(html, "fluxo")).toBe("Ligada 1 de 2 ligadas");
  });

  it("todas desligadas: Desligada", async () => {
    sessao.atual = contexto("gestor");
    banco.fetchAutomacoesDeFluxo.mockResolvedValue(
      AUTOMACOES.map((regra) => ({ ...regra, ativa: false })),
    );
    const html = await tela();
    expect(situacaoDoCartao(html, "fluxo")).toBe("Desligada 0 de 2 ligadas");
  });

  it("uma regra só: concorda no singular", async () => {
    sessao.atual = contexto("admin");
    banco.fetchAutomacoesDeFluxo.mockResolvedValue([AUTOMACOES[0]]);
    const html = await tela();
    expect(situacaoDoCartao(html, "fluxo")).toBe("Ligada 1 de 1 ligada");
  });

  it("nenhuma regra: Nenhuma automação, neutro, e o vazio com exemplo", async () => {
    sessao.atual = contexto("admin");
    banco.fetchAutomacoesDeFluxo.mockResolvedValue([]);
    const html = await tela("fluxo");
    expect(situacaoDoCartao(html, "fluxo")).toBe("Nenhuma automação");
    expect(html).toContain("Nenhuma automação de fluxo ainda");
    expect(html).toContain("Criar a primeira");
  });

  it("leitura das regras que falha: o erro da aba, sem derrubar a tela", async () => {
    sessao.atual = contexto("admin");
    banco.fetchAutomacoesDeFluxo.mockRejectedValue(new Error("falhou"));
    const html = await tela("fluxo");
    expect(html).toContain("Não foi possível carregar as automações de fluxo");
    expect(html).not.toContain("Automações de fluxo da clínica");
    expect(situacaoDoCartao(html, "fluxo")).toBe("Não foi possível carregar");
    // Os outros cartoes continuam.
    expect(cartoes(html)).toHaveLength(5);
  });

  it("etiquetas que não carregam não derrubam a aba", async () => {
    sessao.atual = contexto("admin");
    banco.fetchEtiquetasDeConversa.mockRejectedValue(new Error("falhou"));
    const html = await tela("fluxo");
    expect(html).toContain("Automações de fluxo da clínica");
    expect(html).toContain("Sumiu vira Perdido");
  });

  it("sem travessão na tela, com a aba aberta", async () => {
    sessao.atual = contexto("admin");
    const html = await tela("fluxo");
    expect(html).not.toMatch(/[–—]/);
  });
});

// Decisao D3 do dono (21/10/2026): a etapa de papel 'aguardando' (o lead
// espera a resposta da equipe, migration 20261023100000) nao recebe regua de
// follow-up, como Perdido. A pagina monta a lista de etapas da aba Follow-up
// de leads; o seletor mora num dialogo fechado (fora do HTML estatico),
// entao a prova le a lista que a pagina entrega ao cliente.
describe("aba Follow-up de leads: a lista de etapas da régua", () => {
  function etapasDaRegua(elemento: ReactElement): unknown {
    const filhos = (elemento.props as { children?: unknown }).children;
    const cliente = (Array.isArray(filhos) ? filhos : [filhos]).find(
      (filho): filho is ReactElement<{ etapasParaFollowup: unknown }> =>
        typeof filho === "object" &&
        filho !== null &&
        "props" in filho &&
        typeof filho.props === "object" &&
        filho.props !== null &&
        "etapasParaFollowup" in filho.props,
    );
    expect(cliente, "o cliente da tela").toBeDefined();
    return cliente?.props.etapasParaFollowup;
  }

  it("sem Perdido e sem a etapa em que o lead espera a equipe", async () => {
    sessao.atual = contexto("admin");
    banco.fetchJornada.mockResolvedValue([
      etapa("novo", "Novo", "entrada", 10),
      etapa("aguardando_resposta", "Aguardando resposta", "aguardando", 20),
      etapa("em_contato", "Contato inicial", "em_contato", 30),
      etapa("follow_1", "Follow 1", null, 40),
      etapa("agendou", "Agendou", "agendou", 50),
      etapa("compareceu", "Compareceu", "compareceu", 60),
      etapa("perdido", "Perdido", "perdido", 70),
    ]);
    const elemento = (await AutomacoesPage({
      searchParams: Promise.resolve({ aba: "followup" }),
    })) as ReactElement;
    expect(etapasDaRegua(elemento)).toEqual([
      { chave: "novo", nome: "Novo" },
      { chave: "em_contato", nome: "Contato inicial" },
      { chave: "follow_1", nome: "Follow 1" },
      { chave: "agendou", nome: "Agendou" },
      { chave: "compareceu", nome: "Compareceu" },
    ]);
  });

  // Revisao de 21/10/2026: com o banco de antes da migration, a etapa ainda
  // sem papel ja sai da lista pela chave aguardando_resposta. Uma regua
  // criada ali no meio tempo faria a conferencia da migration parar.
  it("banco de antes da migration: Aguardando resposta sem papel também sai da lista", async () => {
    sessao.atual = contexto("gestor");
    const elemento = (await AutomacoesPage({
      searchParams: Promise.resolve({ aba: "followup" }),
    })) as ReactElement;
    expect(etapasDaRegua(elemento)).toEqual([
      { chave: "novo", nome: "Novo" },
      { chave: "em_contato", nome: "Em contato" },
      { chave: "agendou", nome: "Agendou" },
      { chave: "compareceu", nome: "Compareceu" },
    ]);
  });
});

describe("esqueleto de Automações", () => {
  it("desenha os cinco cartões seletores da fileira de administrador e gestor", () => {
    const html = renderToStaticMarkup(<CarregandoAutomacoes />);
    expect(html.match(/min-h-\[88px\]/g) ?? []).toHaveLength(5);
    expect(html).toContain("xl:grid-cols-5");
  });
});
