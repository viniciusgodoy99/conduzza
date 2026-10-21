import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  isValidElement,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PainelEtiquetarLead as Painel } from "@/components/leads/etiquetar-lead";
import type {
  DialogoMoverParaEtapa as Dialogo,
  OpcoesDeEtapa as Opcoes,
} from "@/components/leads/mudar-etapa";
import type { ChipDeEtiqueta as Chip } from "@/components/shared/chip-de-etiqueta";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import { opcoesDeEtiqueta } from "@/lib/domain/etiquetas-do-lead";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import type {
  LeadDetalhe,
  LeadResumo,
  ReguaDaEtapa,
} from "@/lib/queries/leads";

// "Nao consigo alterar a etapa nem adicionar uma etiqueta por aqui, era pra
// eu conseguir" (pedido do dono em 20/10/2026, com o print da lista de
// Leads). Aqui, sem banco e sem navegador:
// - as regras de mudar a etapa, as MESMAS da barra em massa (Perdido pede o
//   motivo, etapa com regua confirma, sem regua move direto);
// - na linha da lista: o chip da etapa como botao com a lista das etapas, o
//   "+" de etiquetar, os dois desabilitados com a dica sem permissao, e o
//   controle que segura o clique para a gaveta nao abrir;
// - gravar com UM id, a lista mudando na hora e voltando so naquele lead se
//   o servidor recusar;
// - na gaveta: o mesmo seletor, o X em cada chip e o "+";
// - os dialogos de um lead so (motivo da perda e confirmacao da regua);
// - a barra em massa com os textos de antes.
// O projeto nao tem jsdom: a tela sai do HTML de renderToStaticMarkup, o
// clique e o onClick achado na arvore do componente sem hook, e as props que
// os componentes passam aos filhos sao guardadas para chamar o que eles
// chamariam.

type PropsDasOpcoes = Parameters<typeof Opcoes>[0];
type PropsDoDialogo = Parameters<typeof Dialogo>[0];
type PropsDoPainel = Parameters<typeof Painel>[0];
type PropsDoChip = Parameters<typeof Chip>[0];

const acoes = vi.hoisted(() => ({
  mudarEtapaAction: vi.fn(),
  etiquetarAction: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
// O que cada componente passou ao filho, no ultimo render.
const capturado = vi.hoisted(() => ({
  opcoes: [] as PropsDasOpcoes[],
  dialogos: [] as PropsDoDialogo[],
  paineis: [] as PropsDoPainel[],
  chips: [] as PropsDoChip[],
}));

function acoesFalsas(fixas: Record<string, unknown> = {}) {
  return new Proxy(fixas, {
    get: (alvo, chave) =>
      chave === "then" || typeof chave === "symbol"
        ? undefined
        : (alvo[chave] ?? vi.fn()),
    has: (_alvo, chave) => chave !== "then",
  });
}
vi.mock("@/app/(app)/leads/actions", () => acoesFalsas(acoes));
vi.mock("@/app/(app)/atividades/actions", () => acoesFalsas());
vi.mock("@/app/(app)/atendimento/actions", () => acoesFalsas());
vi.mock("@/app/(app)/atendimento/iniciar-conversa-actions", () =>
  acoesFalsas(),
);
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast }));
// A dica vira atributo, para o teste ler o porque do controle desabilitado.
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));
// O popover do Radix so desenha o conteudo aberto: aqui ele fica aberto.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => (
    <div data-parte="popover">{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: ComponentProps<"div">) => (
    <div data-parte="conteudo-do-popover">{children}</div>
  ),
}));
// Na tela, o popover da linha so monta no primeiro toque (o teste dele esta
// no fim deste arquivo); aqui ele ja esta aberto, para a lista das etapas e
// o painel aparecerem.
vi.mock("@/components/leads/popover-sob-demanda", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/leads/popover-sob-demanda")
    >();
  return {
    ...real,
    PopoverSobDemanda: ({
      gatilho,
      children,
    }: {
      gatilho: ReactNode;
      children: ReactNode;
    }) => (
      <div data-parte="popover">
        {gatilho}
        <div data-parte="conteudo-do-popover">{children}</div>
      </div>
    ),
  };
});
// Dialogo e gaveta renderizam no lugar (sem portal), so quando abertos.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-parte="dialogo">{children}</div> : null,
  DialogContent: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-parte="gaveta">{children}</div> : null,
  SheetContent: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  SheetHeader: ({ children }: ComponentProps<"div">) => (
    <div data-parte="cabecalho">{children}</div>
  ),
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetFooter: ({ children }: ComponentProps<"div">) => (
    <div data-parte="rodape">{children}</div>
  ),
}));
// A secao vizinha da gaveta tem os proprios testes.
vi.mock("@/components/atividades/secao-de-atividades", () => ({
  SecaoDeAtividades: () => null,
}));
vi.mock("@/components/leads/mudar-etapa", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/components/leads/mudar-etapa")>();
  return {
    ...real,
    OpcoesDeEtapa: (props: PropsDasOpcoes) => {
      capturado.opcoes.push(props);
      return real.OpcoesDeEtapa(props);
    },
    DialogoMoverParaEtapa: (props: PropsDoDialogo) => {
      capturado.dialogos.push(props);
      return real.DialogoMoverParaEtapa(props);
    },
  };
});
vi.mock("@/components/leads/etiquetar-lead", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/components/leads/etiquetar-lead")>();
  return {
    ...real,
    PainelEtiquetarLead: (props: PropsDoPainel) => {
      capturado.paineis.push(props);
      return real.PainelEtiquetarLead(props);
    },
  };
});
vi.mock("@/components/shared/chip-de-etiqueta", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/shared/chip-de-etiqueta")
    >();
  return {
    ...real,
    ChipDeEtiqueta: (props: PropsDoChip) => {
      capturado.chips.push(props);
      return real.ChipDeEtiqueta(props);
    },
  };
});

const { decidirMudancaDeEtapa, DialogoMoverParaEtapa, OpcoesDeEtapa } =
  await import("@/components/leads/mudar-etapa");
const { useMudarEtapaDoLead } =
  await import("@/components/leads/etapa-do-lead");
const { ControleDaLinha, ListaLeads } =
  await import("@/components/leads/lista-leads");
const { DrawerLead } = await import("@/components/leads/drawer-lead");
const { BarraAcoesMassa } =
  await import("@/components/leads/barra-acoes-massa");
const { leadsKeys } = await import("@/lib/queries/leads");

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const DICA = "Seu perfil não pode editar leads e pacientes";
const MARIA = "10000000-0000-4000-8000-000000000001";
const JOANA = "10000000-0000-4000-8000-000000000002";

function etapa(
  chave: string,
  nome: string,
  campos: Partial<EtapaDaJornada> = {},
): EtapaDaJornada {
  return {
    id: `e-${chave}`,
    chave,
    nome,
    posicao: 1,
    tom: "info",
    icone: "circle",
    papel: null,
    descricao: null,
    termos_chave: [],
    termos_de_quem: "paciente",
    meta_event_name: null,
    conversao_ativa: false,
    is_sale: false,
    is_first_contact: false,
    value_source: null,
    value_cents: null,
    ...campos,
  };
}

const NOVO = etapa("novo", "Novo", {
  papel: "entrada",
  icone: "badge-plus",
  is_first_contact: true,
});
const EM_CONTATO = etapa("em_contato", "Em contato", {
  posicao: 2,
  icone: "message-square-text",
});
const AVALIACAO = etapa("avaliacao", "Avaliação", {
  posicao: 3,
  tom: "warning",
  icone: "star",
});
// Perdido pelo PAPEL: a clinica renomeou a etapa.
const PERDIDO = etapa("perdido", "Não fechou", {
  posicao: 4,
  tom: "alert",
  icone: "user-round-x",
  papel: "perdido",
});
const JORNADA = [NOVO, EM_CONTATO, AVALIACAO, PERDIDO];
const REGUAS: ReguaDaEtapa[] = [
  { etapa: "avaliacao", nome: "Régua da avaliação" },
];

const CATALOGO: EtiquetaDeConversa[] = [
  { id: "t1", chave: "cliente", nome: "Cliente", tom: "info" },
  { id: "t2", chave: "urgente", nome: "Urgente", tom: "alert" },
];
const OPCOES = opcoesDeEtiqueta(CATALOGO, [{ tags: ["LEAD"] }]);

function lead(campos: Partial<LeadResumo> = {}): LeadResumo {
  return {
    id: MARIA,
    name: "Maria Lima",
    phone_e164: "+5585999990001",
    kind: "lead",
    funnel_stage: "novo",
    lost_reason: null,
    lost_reason_note: null,
    owner_user_id: null,
    tags: [],
    source_channel: null,
    source_campaign: null,
    source_origin: null,
    source_medium: null,
    source_method: null,
    source_ad_id: null,
    source_google_campaign_id: null,
    first_contact_at: "2026-10-01T12:00:00.000Z",
    last_contact_at: null,
    insurance: null,
    consent_ativo: true,
    anuncio_meta: { estado: "lida", anuncio: null },
    ...campos,
  };
}

const DETALHE: LeadDetalhe = {
  conversation_id: null,
  mensagens: [],
  campanha_nome: null,
  anuncio_meta: { estado: "lida", anuncio: null },
  anuncio_whatsapp: { estado: "lida", detalhes: null },
  atividades: null,
};

function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Os elementos da arvore (sem renderizar componentes): para achar o onClick. */
function elementos(no: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(no)) {
    return no.flatMap(elementos);
  }
  if (!isValidElement<Record<string, unknown>>(no)) {
    return [];
  }
  return [no, ...elementos(no.props.children as ReactNode)];
}

/** A etapa clicavel da lista, pelo nome escrito nela. */
function opcaoDaEtapa(
  arvore: ReactNode,
  nome: string,
): ReactElement<Record<string, unknown>> {
  const achada = elementos(arvore).find(
    (el) =>
      typeof el.props.onClick === "function" &&
      elementos(el.props.children as ReactNode).some(
        (filho) => filho.props.children === nome,
      ),
  );
  expect(achada, `etapa "${nome}"`).toBeDefined();
  return achada as ReactElement<Record<string, unknown>>;
}

/** O botao (com o involucro da dica, quando ha) pelo nome acessivel. */
function botaoPeloNome(markup: string, nome: string): string {
  const botoes =
    markup.match(/(<span data-dica="[^"]*">)?<button[^>]*>.*?<\/button>/g) ??
    [];
  const achado = botoes.find((botao) => botao.includes(`aria-label="${nome}"`));
  expect(achado, `botão "${nome}"`).toBeDefined();
  return achado ?? "";
}

function desabilitado(botao: string): boolean {
  return /<button[^>]*\sdisabled=""/.test(botao);
}

function dicaDe(botao: string): string | null {
  return /^<span data-dica="([^"]*)">/.exec(botao)?.[1] ?? null;
}

/** Cliente com a lista da clinica ja carregada, como a tela tem. */
function clienteCom(leads: LeadResumo[]): QueryClient {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  cliente.setQueryData(leadsKeys.lista(CLINICA), leads);
  for (const umLead of leads) {
    cliente.setQueryData(leadsKeys.detalhe(umLead.id), DETALHE);
  }
  return cliente;
}

function naCache(cliente: QueryClient, id: string): LeadResumo | undefined {
  return cliente
    .getQueryData<LeadResumo[]>(leadsKeys.lista(CLINICA))
    ?.find((umLead) => umLead.id === id);
}

function lista(
  leads: LeadResumo[],
  campos: Partial<ComponentProps<typeof ListaLeads>> = {},
  cliente: QueryClient = clienteCom(leads),
): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={cliente}>
      <ListaLeads
        clinicId={CLINICA}
        leads={leads}
        membros={{}}
        jornada={JORNADA}
        reguas={REGUAS}
        timezone="America/Fortaleza"
        podeEditar
        dica={DICA}
        etiquetasDaClinica={OPCOES}
        leituraDasEtiquetas="pronto"
        selecionados={new Set()}
        onSelecionar={() => undefined}
        onSelecionarTodos={() => undefined}
        onAbrirLead={() => undefined}
        {...campos}
      />
    </QueryClientProvider>,
  );
}

function gaveta(
  oLead: LeadResumo,
  campos: Partial<ComponentProps<typeof DrawerLead>> = {},
  cliente: QueryClient = clienteCom([oLead]),
): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={cliente}>
      <DrawerLead
        clinicId={CLINICA}
        lead={oLead}
        jornada={JORNADA}
        timezone="America/Fortaleza"
        membros={{}}
        podeEditar
        dica={DICA}
        podeAgendar
        dicaAgendar="Seu perfil não pode alterar a agenda"
        soAtribuidas={false}
        reguas={REGUAS}
        etiquetasDaClinica={OPCOES}
        leituraDasEtiquetas="pronto"
        onFechar={() => undefined}
        {...campos}
      />
    </QueryClientProvider>,
  );
}

function ultimo<T>(lista: T[], oQue: string): T {
  const achado = lista.at(-1);
  expect(achado, oQue).toBeDefined();
  return achado as T;
}

/** Uma promessa que o teste resolve quando quiser. */
function adiada<T>() {
  let resolver: (valor: T) => void = () => undefined;
  const promessa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

beforeEach(() => {
  acoes.mudarEtapaAction.mockReset();
  acoes.mudarEtapaAction.mockResolvedValue({ ok: true });
  acoes.etiquetarAction.mockReset();
  acoes.etiquetarAction.mockResolvedValue({ ok: true });
  toast.success.mockReset();
  toast.error.mockReset();
  toast.info.mockReset();
  capturado.opcoes = [];
  capturado.dialogos = [];
  capturado.paineis = [];
  capturado.chips = [];
});

describe("as regras de mudar a etapa, as mesmas da barra em massa", () => {
  it("Perdido, pelo papel e com outro nome, pede o motivo", () => {
    expect(decidirMudancaDeEtapa(PERDIDO, REGUAS)).toEqual({
      tipo: "pedir_motivo",
    });
    expect(decidirMudancaDeEtapa(PERDIDO, null)).toEqual({
      tipo: "pedir_motivo",
    });
  });

  it("etapa com régua de follow-up ligada confirma dizendo a régua", () => {
    expect(decidirMudancaDeEtapa(AVALIACAO, REGUAS)).toEqual({
      tipo: "confirmar",
      regua: "Régua da avaliação",
    });
  });

  it("sem conseguir ler as réguas, toda etapa confirma", () => {
    expect(decidirMudancaDeEtapa(EM_CONTATO, null)).toEqual({
      tipo: "confirmar",
      regua: null,
    });
  });

  it("sem régua, move direto", () => {
    expect(decidirMudancaDeEtapa(EM_CONTATO, REGUAS)).toEqual({
      tipo: "mover",
    });
    expect(decidirMudancaDeEtapa(EM_CONTATO, [])).toEqual({ tipo: "mover" });
  });
});

describe("a lista das etapas", () => {
  function opcoes(campos: Partial<PropsDasOpcoes> = {}): string {
    return renderToStaticMarkup(
      <OpcoesDeEtapa
        jornada={JORNADA}
        reguas={REGUAS}
        aoEscolher={() => undefined}
        {...campos}
      />,
    );
  }

  it("de um lead: ícone, nome e tom de cada etapa, a Régua e a atual marcada", () => {
    const html = opcoes({ etapaAtual: "novo" });
    expect(texto(html)).toContain("Novo Em contato Avaliação Régua");
    expect(html).toContain("de follow-up ligada: Régua da avaliação");
    expect(html).toContain("lucide-badge-plus");
    expect(html).toContain("color:var(--warning-text)");
    const atual = html.match(
      /<button[^>]*aria-current="true"[^>]*>.*?<\/button>/,
    );
    expect(atual?.[0]).toContain("Novo");
    expect(atual?.[0]).toContain("lucide-check");
    expect(html.match(/aria-current/g)).toHaveLength(1);
    expect(texto(html)).toContain(
      "Mover também pode disparar as automações de fluxo da etapa de destino.",
    );
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it("na barra em massa: nenhuma marcada e a nota fala de cada lead", () => {
    const html = opcoes();
    expect(html).not.toContain("aria-current");
    expect(html).not.toContain("lucide-check");
    expect(texto(html)).toContain(
      "Mover também pode disparar as automações de fluxo da etapa de destino, para cada lead.",
    );
  });

  it("tocar numa etapa entrega ela a quem abriu a lista", () => {
    const aoEscolher = vi.fn();
    const arvore = OpcoesDeEtapa({
      jornada: JORNADA,
      reguas: REGUAS,
      etapaAtual: "novo",
      aoEscolher,
    });
    (opcaoDaEtapa(arvore, "Não fechou").props.onClick as () => void)();
    (opcaoDaEtapa(arvore, "Avaliação").props.onClick as () => void)();
    expect(aoEscolher.mock.calls).toEqual([[PERDIDO], [AVALIACAO]]);
  });
});

describe("lista de Leads: a etapa na linha", () => {
  it("o chip da etapa é um botão com a seta, que diz de quem é e onde está", () => {
    const html = lista([lead()]);
    const botao = botaoPeloNome(
      html,
      "Mudar etapa de Maria Lima, agora em Novo",
    );
    expect(desabilitado(botao)).toBe(false);
    expect(dicaDe(botao)).toBeNull();
    // O chip de sempre (as 3 camadas) com a seta dentro, e o alvo de 40px.
    expect(botao).toContain('data-size="sm"');
    expect(botao).toContain("lucide-badge-plus");
    expect(texto(botao)).toBe("Novo");
    expect(botao).toContain("lucide-chevron-down");
    expect(botao).toContain("hit-40");
  });

  it("abre a lista das etapas da jornada com a atual marcada", () => {
    lista([lead({ funnel_stage: "em_contato" })]);
    const props = ultimo(capturado.opcoes, "a lista das etapas");
    expect(props.jornada).toEqual(JORNADA);
    expect(props.reguas).toEqual(REGUAS);
    expect(props.etapaAtual).toBe("em_contato");
  });

  it("o controle fica dentro do que segura o clique da linha", () => {
    const html = lista([lead()]);
    expect(html).toMatch(
      /<span data-controle-da-linha=""[^>]*>(<div data-parte="popover">)?<button[^>]*aria-label="Mudar etapa de Maria Lima, agora em Novo"/,
    );
  });

  it("escolher uma etapa sem régua grava com um id só e a lista muda na hora", async () => {
    const cliente = clienteCom([lead(), lead({ id: JOANA, name: "Joana" })]);
    lista([lead(), lead({ id: JOANA, name: "Joana" })], {}, cliente);
    // Duas linhas, duas listas: a primeira e a da Maria.
    const daMaria = capturado.opcoes[0] as PropsDasOpcoes;
    daMaria.aoEscolher(EM_CONTATO);
    expect(naCache(cliente, MARIA)?.funnel_stage).toBe("em_contato");
    expect(naCache(cliente, JOANA)?.funnel_stage).toBe("novo");
    expect(acoes.mudarEtapaAction).toHaveBeenCalledTimes(1);
    expect(acoes.mudarEtapaAction).toHaveBeenCalledWith({
      contact_ids: [MARIA],
      etapa: "em_contato",
    });
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Etapa alterada para Em contato.",
      ),
    );
  });

  it("se o servidor recusar, só aquele lead volta e o aviso diz o motivo", async () => {
    const resposta = adiada<{ ok: boolean; error?: string }>();
    acoes.mudarEtapaAction.mockReturnValue(resposta.promessa);
    const perdido = lead({
      funnel_stage: "perdido",
      lost_reason: "preco",
      lost_reason_note: null,
    });
    const cliente = clienteCom([perdido, lead({ id: JOANA, name: "Joana" })]);
    lista([perdido], {}, cliente);
    ultimo(capturado.opcoes, "a lista das etapas").aoEscolher(EM_CONTATO);
    expect(naCache(cliente, MARIA)).toMatchObject({
      funnel_stage: "em_contato",
      lost_reason: null,
    });
    // Enquanto isso, a Joana mudou por outro caminho (o tempo real).
    cliente.setQueryData<LeadResumo[]>(leadsKeys.lista(CLINICA), (atual) =>
      atual?.map((umLead) =>
        umLead.id === JOANA ? { ...umLead, funnel_stage: "avaliacao" } : umLead,
      ),
    );
    resposta.resolver({
      ok: false,
      error:
        "Esta etapa não existe mais na jornada da clínica. Recarregue a página.",
    });
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Esta etapa não existe mais na jornada da clínica. Recarregue a página.",
      ),
    );
    expect(naCache(cliente, MARIA)).toMatchObject({
      funnel_stage: "perdido",
      lost_reason: "preco",
    });
    expect(naCache(cliente, JOANA)?.funnel_stage).toBe("avaliacao");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("Perdido e etapa com régua não gravam direto", () => {
    lista([lead()]);
    const props = ultimo(capturado.opcoes, "a lista das etapas");
    props.aoEscolher(PERDIDO);
    props.aoEscolher(AVALIACAO);
    expect(acoes.mudarEtapaAction).not.toHaveBeenCalled();
  });

  it("escolher a etapa em que o lead já está não grava nada", () => {
    lista([lead()]);
    ultimo(capturado.opcoes, "a lista das etapas").aoEscolher(NOVO);
    expect(acoes.mudarEtapaAction).not.toHaveBeenCalled();
  });
});

describe("lista de Leads: etiquetas na linha", () => {
  it("o + de 40px fica ao lado dos chips, e sozinho quando não há etiqueta", () => {
    const comEtiqueta = lista([lead({ tags: ["Cliente"] })]);
    const mais = botaoPeloNome(comEtiqueta, "Etiquetar Maria Lima");
    expect(desabilitado(mais)).toBe(false);
    expect(mais).toContain('data-size="icon"');
    expect(mais).toContain("lucide-plus");
    expect(comEtiqueta).toContain("data-etiquetas-do-lead");
    expect(comEtiqueta).toMatch(
      /<span data-controle-da-linha=""[^>]*>(<div data-parte="popover">)?<button[^>]*aria-label="Etiquetar Maria Lima"/,
    );

    const semEtiqueta = lista([lead()]);
    expect(semEtiqueta).not.toContain("data-etiquetas-do-lead");
    botaoPeloNome(semEtiqueta, "Etiquetar Maria Lima");
  });

  it("sem nome, o + diz o telefone", () => {
    const html = lista([lead({ name: null })]);
    botaoPeloNome(html, "Etiquetar (85) 99999-0001");
    botaoPeloNome(html, "Mudar etapa de (85) 99999-0001, agora em Novo");
  });

  it("abre o mesmo painel para aquele lead, sem oferecer o que ele já tem", () => {
    const html = lista([lead({ tags: ["Cliente", "LEAD"] })]);
    const props = ultimo(capturado.paineis, "o painel de etiquetar");
    expect(props.alvo).toBe("lead");
    expect(props.opcoes).toEqual(OPCOES);
    expect(props.etiquetasDosSelecionados).toEqual(["Cliente", "LEAD"]);
    expect(texto(html)).toContain(
      "Etiquetas deste lead (toque no X para remover)",
    );
    const oferecidas = [
      ...html.matchAll(/aria-label="Adicionar etiqueta ([^"]+)"/g),
    ].map((casamento) => casamento[1]);
    expect(oferecidas).toEqual(["Urgente"]);
  });

  it("adicionar grava com um id, troca a outra grafia e aparece na hora", async () => {
    const cliente = clienteCom([lead({ tags: ["lead"] })]);
    lista([lead({ tags: ["lead"] })], {}, cliente);
    ultimo(capturado.paineis, "o painel").aoAdicionar("LEAD");
    expect(acoes.etiquetarAction).toHaveBeenCalledWith({
      contact_ids: [MARIA],
      adicionar: ["LEAD"],
      remover: ["lead"],
    });
    expect(naCache(cliente, MARIA)?.tags).toEqual(["LEAD"]);
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Etiqueta LEAD adicionada"),
    );
  });

  it("remover grava com um id", async () => {
    const cliente = clienteCom([lead({ tags: ["Cliente", "Urgente"] })]);
    lista([lead({ tags: ["Cliente", "Urgente"] })], {}, cliente);
    ultimo(capturado.paineis, "o painel").aoRemover("Cliente");
    expect(acoes.etiquetarAction).toHaveBeenCalledWith({
      contact_ids: [MARIA],
      adicionar: [],
      remover: ["Cliente"],
    });
    expect(naCache(cliente, MARIA)?.tags).toEqual(["Urgente"]);
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Etiqueta Cliente removida"),
    );
  });

  it("se o servidor recusar, desfaz só o que este pedido mudou e avisa", async () => {
    const resposta = adiada<{ ok: boolean; error?: string }>();
    acoes.etiquetarAction.mockReturnValue(resposta.promessa);
    const cliente = clienteCom([lead({ tags: ["Cliente"] })]);
    lista([lead({ tags: ["Cliente"] })], {}, cliente);
    ultimo(capturado.paineis, "o painel").aoAdicionar("Urgente");
    expect(naCache(cliente, MARIA)?.tags).toEqual(["Cliente", "Urgente"]);
    // Outra etiqueta entrou enquanto isso: ela fica.
    cliente.setQueryData<LeadResumo[]>(leadsKeys.lista(CLINICA), (atual) =>
      atual?.map((umLead) => ({ ...umLead, tags: [...umLead.tags, "VIP"] })),
    );
    resposta.resolver({
      ok: false,
      error: "Não foi possível etiquetar os contatos.",
    });
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Não foi possível etiquetar os contatos.",
      ),
    );
    expect(naCache(cliente, MARIA)?.tags).toEqual(["Cliente", "VIP"]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a etiqueta que o lead já tem não é gravada de novo", () => {
    lista([lead({ tags: ["Cliente"] })]);
    ultimo(capturado.paineis, "o painel").aoAdicionar("Cliente");
    expect(acoes.etiquetarAction).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Este lead já tem a etiqueta Cliente.",
    );
  });
});

describe("lista de Leads: sem permissão e sem abrir a gaveta", () => {
  it("profissional e leitura: etapa e + visíveis, desabilitados e com a dica", () => {
    const html = lista([lead({ tags: ["Cliente"] })], { podeEditar: false });
    const etapaDoLead = botaoPeloNome(
      html,
      "Mudar etapa de Maria Lima, agora em Novo",
    );
    expect(desabilitado(etapaDoLead)).toBe(true);
    expect(dicaDe(etapaDoLead)).toBe(DICA);
    // A etapa continua legivel: o chip inteiro, so a seta apagada.
    expect(texto(etapaDoLead)).toBe("Novo");
    const mais = botaoPeloNome(html, "Etiquetar Maria Lima");
    expect(desabilitado(mais)).toBe(true);
    expect(dicaDe(mais)).toBe(DICA);
    // Nada abre: nem a lista das etapas, nem o painel.
    expect(capturado.opcoes).toEqual([]);
    expect(capturado.paineis).toEqual([]);
  });

  it("o clique e o Enter ou Espaço no controle param nele e não abrem a gaveta", () => {
    const envoltorio = elementos(
      ControleDaLinha({ children: <button type="button">Etapa</button> }),
    )[0] as ReactElement<{
      onClick: (evento: { stopPropagation: () => void }) => void;
      onKeyDown: (evento: { key: string; stopPropagation: () => void }) => void;
    }>;
    const clique = { stopPropagation: vi.fn() };
    envoltorio.props.onClick(clique);
    expect(clique.stopPropagation).toHaveBeenCalledTimes(1);
    for (const tecla of ["Enter", " "]) {
      const evento = { key: tecla, stopPropagation: vi.fn() };
      envoltorio.props.onKeyDown(evento);
      expect(evento.stopPropagation, tecla).toHaveBeenCalledTimes(1);
    }
    // O Tab continua andando pela tela.
    const tab = { key: "Tab", stopPropagation: vi.fn() };
    envoltorio.props.onKeyDown(tab);
    expect(tab.stopPropagation).not.toHaveBeenCalled();
  });
});

describe("gaveta do lead", () => {
  it("o chip da etapa no cabeçalho é o mesmo seletor, e escolher grava com um id", () => {
    const html = gaveta(lead());
    const nome = "Mudar etapa de Maria Lima, agora em Novo";
    // No cabecalho, no lugar do chip de antes, antes da secao Dados.
    const posicao = html.indexOf(`aria-label="${nome}"`);
    expect(posicao).toBeGreaterThan(html.indexOf('data-parte="cabecalho"'));
    expect(posicao).toBeLessThan(html.indexOf(">Dados<"));
    const botao = botaoPeloNome(html, nome);
    expect(botao).toContain('data-size="md"');
    expect(botao).toContain("lucide-chevron-down");
    ultimo(capturado.opcoes, "a lista das etapas").aoEscolher(EM_CONTATO);
    expect(acoes.mudarEtapaAction).toHaveBeenCalledWith({
      contact_ids: [MARIA],
      etapa: "em_contato",
    });
  });

  it("Etiquetas do lead: o X em cada chip, com 40px de alvo, e o + com o painel", () => {
    const html = gaveta(lead({ tags: ["Cliente", "Urgente"] }));
    for (const nome of ["Cliente", "Urgente"]) {
      const x = botaoPeloNome(html, `Remover etiqueta ${nome}`);
      expect(desabilitado(x)).toBe(false);
      expect(x).toContain("hit-40");
    }
    const mais = botaoPeloNome(html, "Etiquetar Maria Lima");
    expect(mais).toContain('data-size="icon-sm"');
    expect(mais).toContain("hit-40");
    expect(ultimo(capturado.paineis, "o painel").alvo).toBe("lead");
  });

  it("o X do chip remove com um id", () => {
    gaveta(lead({ tags: ["Cliente", "Urgente"] }));
    const chip = capturado.chips.find(
      (props) => props.nome === "Cliente" && props.aoRemover,
    );
    expect(chip, "o chip Cliente com o X").toBeDefined();
    chip?.aoRemover?.();
    expect(acoes.etiquetarAction).toHaveBeenCalledWith({
      contact_ids: [MARIA],
      adicionar: [],
      remover: ["Cliente"],
    });
  });

  it("sem etiqueta: Nenhuma e o +", () => {
    const html = gaveta(lead());
    expect(texto(html)).toContain("Etiquetas do lead Nenhuma");
    botaoPeloNome(html, "Etiquetar Maria Lima");
  });

  it("sem permissão: seletor, X e + visíveis, desabilitados e com a dica", () => {
    const html = gaveta(lead({ tags: ["Cliente"] }), { podeEditar: false });
    for (const nome of [
      "Mudar etapa de Maria Lima, agora em Novo",
      "Etiquetar Maria Lima",
    ]) {
      const botao = botaoPeloNome(html, nome);
      expect(desabilitado(botao), nome).toBe(true);
      expect(dicaDe(botao), nome).toBe(DICA);
    }
    // O X aparece, desabilitado, dentro da dica que envolve o chip.
    expect(html).toMatch(
      new RegExp(
        `<span data-dica="${DICA}"><span data-tamanho="padrao"[^>]*>.*?<button[^>]*disabled=""[^>]*aria-label="Remover etiqueta Cliente"`,
      ),
    );
    expect(capturado.opcoes).toEqual([]);
    expect(capturado.paineis).toEqual([]);
  });

  it("nenhum travessão na gaveta nem na lista", () => {
    expect(gaveta(lead({ tags: ["Cliente"] }))).not.toMatch(/[\u2013\u2014]/);
    expect(lista([lead({ tags: ["Cliente"] })])).not.toMatch(/[\u2013\u2014]/);
  });
});

// O HTML do servidor nao renderiza de novo depois de um setState. Escolher a
// etapa DURANTE o render do proprio componente que guarda o estado e uma
// atualizacao de fase de render, que o React aplica antes de devolver o
// HTML: assim o dialogo que a escolha abre aparece.
function EscolheAoAbrir({
  oLead,
  destino,
  reguas,
}: {
  oLead: LeadResumo;
  destino: EtapaDaJornada;
  reguas: ReguaDaEtapa[] | null;
}) {
  const { escolher, dialogos } = useMudarEtapaDoLead({
    clinicId: CLINICA,
    reguas,
  });
  const [escolheu, setEscolheu] = useState(false);
  if (!escolheu) {
    setEscolheu(true);
    escolher(oLead, destino, null);
  }
  return <>{dialogos}</>;
}

function escolhendo(
  oLead: LeadResumo,
  destino: EtapaDaJornada,
  reguas: ReguaDaEtapa[] | null = REGUAS,
): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={clienteCom([oLead])}>
      <EscolheAoAbrir oLead={oLead} destino={destino} reguas={reguas} />
    </QueryClientProvider>,
  );
}

describe("as regras num lead só: os diálogos da linha e da gaveta", () => {
  it("Perdido abre o motivo da perda deste lead, sem gravar nada", () => {
    const html = escolhendo(lead(), PERDIDO);
    expect(texto(html)).toContain("Motivo da perda");
    expect(texto(html)).toContain("Escolha por que este lead não seguiu.");
    expect(texto(html)).not.toContain("Mover");
    expect(acoes.mudarEtapaAction).not.toHaveBeenCalled();
  });

  it("etapa com régua confirma antes, dizendo a régua e que o lead recebe", () => {
    const html = escolhendo(lead(), AVALIACAO);
    const lido = texto(html);
    expect(lido).toContain("Mover Maria Lima para Avaliação?");
    expect(lido).toContain(
      "A etapa Avaliação tem régua de follow-up ligada (Régua da avaliação).",
    );
    expect(lido).toContain(
      "Este lead tem autorização e vai receber as mensagens automáticas dela.",
    );
    expect(lido).toContain(
      "Se Avaliação tiver automação de fluxo ligada, ela também roda para este lead.",
    );
    expect(lido).toContain("Cancelar Mover lead");
    expect(lido).not.toContain("Motivo da perda");
    expect(html).not.toMatch(/[\u2013\u2014]/);
    expect(acoes.mudarEtapaAction).not.toHaveBeenCalled();

    // Confirmar grava com um id so.
    const dialogo = ultimo(capturado.dialogos, "a confirmação");
    expect(dialogo.confirmacao).toMatchObject({
      chave: "avaliacao",
      nome: "Avaliação",
      regua: "Régua da avaliação",
    });
    dialogo.aoConfirmar(
      dialogo.confirmacao as NonNullable<PropsDoDialogo["confirmacao"]>,
    );
    expect(acoes.mudarEtapaAction).toHaveBeenCalledWith({
      contact_ids: [MARIA],
      etapa: "avaliacao",
    });
  });

  it("sem autorização, diz que o lead não recebe nada", () => {
    const html = escolhendo(lead({ consent_ativo: false }), AVALIACAO);
    expect(texto(html)).toContain(
      "Este lead está sem autorização e não recebe nada por esta mudança.",
    );
  });

  it("sem conseguir ler as réguas, confirma dizendo que não deu para conferir", () => {
    const lido = texto(escolhendo(lead(), EM_CONTATO, null));
    expect(lido).toContain("Mover Maria Lima para Em contato?");
    expect(lido).toContain(
      "Não foi possível conferir se esta etapa tem régua de follow-up ligada.",
    );
    expect(lido).toContain(
      "Se tiver, este lead vai receber as mensagens automáticas dela, porque tem autorização.",
    );
  });
});

describe("barra em massa: Mudar etapa continua igual", () => {
  function confirmacao(regua: string | null): string {
    return renderToStaticMarkup(
      <DialogoMoverParaEtapa
        confirmacao={{ chave: "avaliacao", nome: "Avaliação", regua }}
        quem={{ tipo: "selecao", total: 3, recebem: 2 }}
        aoCancelar={() => undefined}
        aoConfirmar={() => undefined}
      />,
    );
  }

  it("a confirmação da seleção tem os textos de antes", () => {
    const lido = texto(confirmacao("Régua da avaliação"));
    expect(lido).toContain("Mover para Avaliação?");
    expect(lido).toContain(
      "A etapa Avaliação tem régua de follow-up ligada (Régua da avaliação).",
    );
    expect(lido).toContain(
      "2 leads com autorização vão receber as mensagens automáticas dela. Os outros 1 não recebem nada por esta mudança (estão sem autorização ou já estavam nesta etapa).",
    );
    expect(lido).toContain(
      "Se Avaliação tiver automação de fluxo ligada, ela também roda para cada lead movido.",
    );
    expect(lido).toContain("Cancelar Mover 3 leads");
    expect(texto(confirmacao(null))).toContain(
      "Se tiver, 2 leads com autorização vão receber as mensagens automáticas dela.",
    );
  });

  it("sem régua move a seleção inteira; Perdido e régua não gravam direto", async () => {
    const aoConcluir = vi.fn();
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <BarraAcoesMassa
          jornada={JORNADA}
          clinicId={CLINICA}
          selecionados={[lead(), lead({ id: JOANA, name: "Joana" })]}
          responsaveis={[]}
          reguas={REGUAS}
          podeEditar
          dica={DICA}
          onLimpar={() => undefined}
          aoConcluir={aoConcluir}
        />
      </QueryClientProvider>,
    );
    const props = ultimo(capturado.opcoes, "a lista da barra");
    expect(props.etapaAtual).toBeUndefined();
    props.aoEscolher(PERDIDO);
    props.aoEscolher(AVALIACAO);
    expect(acoes.mudarEtapaAction).not.toHaveBeenCalled();
    props.aoEscolher(EM_CONTATO);
    await vi.waitFor(() => expect(aoConcluir).toHaveBeenCalledWith([]));
    expect(acoes.mudarEtapaAction).toHaveBeenCalledWith({
      contact_ids: [MARIA, JOANA],
      etapa: "em_contato",
    });
    expect(toast.success).toHaveBeenCalledWith(
      "2 leads movidos para Em contato",
    );
  });
});

describe("o popover da linha só monta no primeiro toque", () => {
  // A lista tem ate 1000 linhas, cada uma com dois popovers: o do Radix so
  // monta quando a pessoa usa. O real, sem o atalho deste arquivo.
  async function real() {
    return vi.importActual<
      typeof import("@/components/leads/popover-sob-demanda")
    >("@/components/leads/popover-sob-demanda");
  }

  it("antes de abrir: só o botão, anunciado como quem abre um popover", async () => {
    const { PopoverSobDemanda } = await real();
    const html = renderToStaticMarkup(
      <PopoverSobDemanda
        aberto={false}
        aoMudar={() => undefined}
        gatilho={<button type="button">Novo</button>}
      >
        <p>Lista das etapas</p>
      </PopoverSobDemanda>,
    );
    expect(html).toBe(
      '<button type="button" aria-haspopup="dialog" aria-expanded="false">Novo</button>',
    );
  });

  it("o clique (ou o Enter e o Espaço do botão) abre, e o clique do botão continua", async () => {
    const { gatilhoAntesDeAbrir } = await real();
    const doBotao = vi.fn();
    const aoAbrir = vi.fn();
    const gatilho = gatilhoAntesDeAbrir(
      <button type="button" onClick={doBotao}>
        Novo
      </button>,
      aoAbrir,
    );
    const evento = { stopPropagation: vi.fn() };
    (gatilho.props.onClick as (e: unknown) => void)(evento);
    expect(doBotao).toHaveBeenCalledWith(evento);
    expect(aoAbrir).toHaveBeenCalledTimes(1);
  });

  it("aberto: o popover monta com o conteúdo", async () => {
    const { PopoverSobDemanda } = await real();
    const html = renderToStaticMarkup(
      <PopoverSobDemanda
        aberto
        aoMudar={() => undefined}
        gatilho={<button type="button">Novo</button>}
      >
        <p>Lista das etapas</p>
      </PopoverSobDemanda>,
    );
    expect(texto(html)).toBe("Novo Lista das etapas");
  });
});
