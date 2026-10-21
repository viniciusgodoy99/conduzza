import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PainelEtiquetarLead as Painel } from "@/components/leads/etiquetar-lead";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import {
  opcoesDeEtiqueta,
  tonsDasEtiquetas,
  type TonsDasEtiquetas,
} from "@/lib/domain/etiquetas-do-lead";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import type { LeadResumo } from "@/lib/queries/leads";

// "Coloco para adicionar uma tag. Nao ta adicionando nem aparecendo as que
// ja existem" (relato do dono em 20/10/2026). A etiqueta gravava, mas so a
// gaveta mostrava, e o popover so tinha o campo de texto. Aqui, na tela:
// - o popover "Etiquetar lead" com as etiquetas da clinica (cadastradas em
//   Configuracoes, com o tom delas, e as em uso nos leads, sem repetir), o
//   toque que adiciona com o nome certo, a grafia existente reaproveitada,
//   o vazio, o carregando e o erro;
// - a barra em massa mandando o etiquetar com a grafia certa;
// - a coluna Etiquetas da lista com 2 chips e "+N", no tom da cadastrada ou
//   neutro (o cartao do quadro fica com os 5 elementos do brief);
// - a tela de Leads com as cadastradas vindas do servidor, e sem elas.
// O projeto nao tem jsdom: a tela e lida pelo HTML de renderToStaticMarkup,
// e o clique e o onClick achado na arvore do componente sem hook.

type PropsDoPainel = Parameters<typeof Painel>[0];

const etiquetarAction = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
// As props que a barra passa ao popover, para chamar o que ele chamaria.
const painelDaBarra = vi.hoisted(() => ({
  props: null as PropsDoPainel | null,
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
vi.mock("@/app/(app)/leads/actions", () => acoesFalsas({ etiquetarAction }));
vi.mock("@/app/(app)/atividades/actions", () => acoesFalsas());
vi.mock("@/app/(app)/atendimento/actions", () => acoesFalsas());
vi.mock("@/app/(app)/atendimento/iniciar-conversa-actions", () =>
  acoesFalsas(),
);
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/realtime/use-leads-channel", () => ({
  useLeadsChannel: () => undefined,
}));
let parametrosDaUrl = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/leads",
  useSearchParams: () => new URLSearchParams(parametrosDaUrl),
}));
vi.mock("sonner", () => ({ toast }));
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
vi.mock("@/components/leads/etiquetar-lead", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/components/leads/etiquetar-lead")>();
  return {
    ...real,
    PainelEtiquetarLead: (props: PropsDoPainel) => {
      painelDaBarra.props = props;
      return real.PainelEtiquetarLead(props);
    },
  };
});

const { PainelEtiquetarLead } =
  await import("@/components/leads/etiquetar-lead");
const { BarraAcoesMassa } =
  await import("@/components/leads/barra-acoes-massa");
const { ListaLeads } = await import("@/components/leads/lista-leads");
const { LeadsClient } = await import("@/app/(app)/leads/leads-client");

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const DICA = "Seu perfil não pode editar leads e pacientes";
const MARIA = "10000000-0000-4000-8000-000000000001";
const JOANA = "10000000-0000-4000-8000-000000000002";

// O catalogo da Salud Care na producao.
const CATALOGO: EtiquetaDeConversa[] = [
  { id: "e1", chave: "cliente", nome: "Cliente", tom: "info" },
  { id: "e2", chave: "salud_care", nome: "SALUD CARE", tom: "success" },
  { id: "e3", chave: "urgente", nome: "Urgente", tom: "alert" },
];
const TONS: TonsDasEtiquetas = tonsDasEtiquetas(CATALOGO);

// "LEAD" em uso (a mais usada), "lead" e "cliente" com outra grafia.
const OPCOES = opcoesDeEtiqueta(CATALOGO, [
  { tags: ["LEAD", "cliente"] },
  { tags: ["LEAD"] },
  { tags: ["lead"] },
]);

const JORNADA: EtapaDaJornada[] = [
  {
    id: "e-novo",
    chave: "novo",
    nome: "Novo",
    posicao: 1,
    tom: "info",
    icone: "badge-plus",
    papel: "entrada",
    descricao: null,
    termos_chave: [],
    termos_de_quem: "paciente",
    meta_event_name: null,
    conversao_ativa: false,
    is_sale: false,
    is_first_contact: true,
    value_source: null,
    value_cents: null,
  },
];

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

/** O elemento clicavel pelo nome acessivel ou pelo texto. */
function alvo(
  arvore: ReactNode,
  rotulo: string,
): ReactElement<Record<string, unknown>> {
  const achado = elementos(arvore).find(
    (el) =>
      typeof el.props.onClick === "function" &&
      (el.props["aria-label"] === rotulo || el.props.children === rotulo),
  );
  expect(achado, `"${rotulo}"`).toBeDefined();
  return achado as ReactElement<Record<string, unknown>>;
}

function clicar(arvore: ReactNode, rotulo: string) {
  (alvo(arvore, rotulo).props.onClick as () => void)();
}

/** Os nomes das etiquetas oferecidas para adicionar, na ordem da tela. */
function oferecidas(html: string): string[] {
  return [...html.matchAll(/aria-label="Adicionar etiqueta ([^"]+)"/g)].map(
    (casamento) => casamento[1] ?? "",
  );
}

/** A cor do marcador da linha "Adicionar etiqueta {nome}". */
function corDaOferecida(html: string, nome: string): string | null {
  const linha = html.match(
    new RegExp(
      `<button[^>]*aria-label="Adicionar etiqueta ${nome}"[^>]*>.*?</button>`,
    ),
  )?.[0];
  return /background-color:([^";]+)/.exec(linha ?? "")?.[1] ?? null;
}

/** Os chips de etiqueta desenhados (nome e cor do marcador), em ordem. */
function chips(html: string): { nome: string; cor: string; tamanho: string }[] {
  return [
    ...html.matchAll(
      /<span data-tamanho="(compacto|padrao)"[^>]*title="([^"]*)"><span aria-hidden="true"[^>]*style="background:([^";]+)"/g,
    ),
  ].map((casamento) => ({
    tamanho: casamento[1] ?? "",
    nome: casamento[2] ?? "",
    cor: casamento[3] ?? "",
  }));
}

function propsDoPainel(campos: Partial<PropsDoPainel> = {}): PropsDoPainel {
  return {
    novaEtiqueta: "",
    aoDigitar: vi.fn(),
    opcoes: OPCOES,
    leitura: "pronto",
    aoTentarDeNovo: vi.fn(),
    etiquetasDosSelecionados: [],
    ocupado: false,
    aoAdicionar: vi.fn(),
    aoRemover: vi.fn(),
    ...campos,
  };
}

function painel(campos: Partial<PropsDoPainel> = {}): string {
  return renderToStaticMarkup(
    <PainelEtiquetarLead {...propsDoPainel(campos)} />,
  );
}

describe("popover Etiquetar lead", () => {
  it("oferece as etiquetas da clínica, cadastradas e em uso, sem repetir", () => {
    const html = painel();
    expect(texto(html)).toContain("Etiquetas da clínica");
    // "cliente" e "lead" sao a mesma etiqueta que "Cliente" e "LEAD": uma
    // vez so, e a cadastrada fica com a grafia dela.
    expect(oferecidas(html)).toEqual([
      "Cliente",
      "LEAD",
      "SALUD CARE",
      "Urgente",
    ]);
  });

  it("a cadastrada aparece no tom dela; a só em uso, neutra", () => {
    const html = painel();
    expect(corDaOferecida(html, "Cliente")).toBe("var(--info)");
    expect(corDaOferecida(html, "SALUD CARE")).toBe("var(--success)");
    expect(corDaOferecida(html, "Urgente")).toBe("var(--alert)");
    expect(corDaOferecida(html, "LEAD")).toBe("var(--neutral)");
  });

  it("um toque adiciona aos selecionados com o nome da etiqueta", () => {
    const aoAdicionar = vi.fn();
    const arvore = PainelEtiquetarLead(propsDoPainel({ aoAdicionar }));
    clicar(arvore, "Adicionar etiqueta Cliente");
    clicar(arvore, "Adicionar etiqueta LEAD");
    expect(aoAdicionar.mock.calls).toEqual([["Cliente"], ["LEAD"]]);
  });

  it("texto com outra grafia de uma etiqueta que já existe entra com a grafia dela", () => {
    const aoAdicionar = vi.fn();
    const campos = { novaEtiqueta: "lead", aoAdicionar };
    expect(texto(painel(campos))).toContain(
      "Esta etiqueta já existe como LEAD e entra com essa grafia.",
    );
    clicar(PainelEtiquetarLead(propsDoPainel(campos)), "Adicionar");
    expect(aoAdicionar).toHaveBeenCalledWith("LEAD");

    const comAcento = vi.fn();
    clicar(
      PainelEtiquetarLead(
        propsDoPainel({ novaEtiqueta: " urgênte ", aoAdicionar: comAcento }),
      ),
      "Adicionar",
    );
    expect(comAcento).toHaveBeenCalledWith("Urgente");
  });

  it("etiqueta nova entra como foi escrita, aparada, sem aviso", () => {
    const aoAdicionar = vi.fn();
    const campos = { novaEtiqueta: "  Retorno ", aoAdicionar };
    expect(texto(painel(campos))).not.toContain("já existe como");
    clicar(PainelEtiquetarLead(propsDoPainel(campos)), "Adicionar");
    expect(aoAdicionar).toHaveBeenCalledWith("Retorno");
  });

  it("campo vazio ou outra ação rodando: nada adiciona", () => {
    const vazio = PainelEtiquetarLead(propsDoPainel({ novaEtiqueta: "  " }));
    expect(alvo(vazio, "Adicionar").props.disabled).toBe(true);

    const ocupado = PainelEtiquetarLead(
      propsDoPainel({ novaEtiqueta: "LEAD", ocupado: true }),
    );
    expect(alvo(ocupado, "Adicionar").props.disabled).toBe(true);
    expect(alvo(ocupado, "Adicionar etiqueta Cliente").props.disabled).toBe(
      true,
    );
  });

  it("as etiquetas dos selecionados continuam com o X de remover", () => {
    const aoRemover = vi.fn();
    const campos = { etiquetasDosSelecionados: ["LEAD", "lead"], aoRemover };
    const html = painel(campos);
    expect(texto(html)).toContain(
      "Etiquetas do lead nos selecionados (toque no X para remover)",
    );
    clicar(PainelEtiquetarLead(propsDoPainel(campos)), "Remover etiqueta lead");
    expect(aoRemover).toHaveBeenCalledWith("lead");
  });

  it("vazio: a clínica ainda não tem etiquetas", () => {
    const html = painel({ opcoes: [] });
    expect(texto(html)).toContain(
      "A clínica ainda não tem etiquetas. Escreva uma acima para criar a primeira.",
    );
    expect(oferecidas(html)).toEqual([]);
  });

  it("carregando: avisa e já oferece as em uso", () => {
    const emUso = opcoesDeEtiqueta([], [{ tags: ["LEAD"] }]);
    const html = painel({ opcoes: emUso, leitura: "carregando" });
    expect(html).toMatch(
      /<p role="status"[^>]*>Carregando as etiquetas cadastradas\.<\/p>/,
    );
    expect(oferecidas(html)).toEqual(["LEAD"]);
    expect(texto(html)).not.toContain("ainda não tem etiquetas");
  });

  it("erro: diz que não carregou, fica com as em uso e oferece Tentar de novo", () => {
    const aoTentarDeNovo = vi.fn();
    const emUso = opcoesDeEtiqueta([], [{ tags: ["LEAD"] }]);
    const campos = { opcoes: emUso, leitura: "erro" as const, aoTentarDeNovo };
    const html = painel(campos);
    expect(texto(html)).toContain(
      "Não foi possível carregar as etiquetas cadastradas em Configurações. Aparecem só as que já estão nos leads.",
    );
    expect(oferecidas(html)).toEqual(["LEAD"]);
    clicar(PainelEtiquetarLead(propsDoPainel(campos)), "Tentar de novo");
    expect(aoTentarDeNovo).toHaveBeenCalledTimes(1);
  });

  it("nenhum travessão em nenhum estado", () => {
    for (const campos of [
      {},
      { novaEtiqueta: "lead" },
      { opcoes: [] },
      { leitura: "carregando" as const },
      { leitura: "erro" as const },
      { etiquetasDosSelecionados: ["LEAD"] },
    ]) {
      expect(painel(campos)).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("barra de ações em massa: Etiquetar lead", () => {
  beforeEach(() => {
    etiquetarAction.mockReset();
    etiquetarAction.mockResolvedValue({ ok: true });
    toast.success.mockReset();
    toast.error.mockReset();
    painelDaBarra.props = null;
  });

  const SELECIONADOS = [
    lead({ id: MARIA, tags: ["lead", "Cliente"] }),
    lead({ id: JOANA, name: "Joana Reis", tags: [] }),
  ];

  function barra(campos: Partial<ComponentProps<typeof BarraAcoesMassa>> = {}) {
    const aoConcluir = vi.fn();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <BarraAcoesMassa
          jornada={JORNADA}
          clinicId={CLINICA}
          selecionados={SELECIONADOS}
          responsaveis={[]}
          reguas={[]}
          podeEditar
          dica={DICA}
          etiquetasDaClinica={OPCOES}
          leituraDasEtiquetas="pronto"
          onLimpar={() => undefined}
          aoConcluir={aoConcluir}
          {...campos}
        />
      </QueryClientProvider>,
    );
    const props = painelDaBarra.props;
    expect(props, "o popover Etiquetar lead").not.toBeNull();
    return { html, aoConcluir, props: props as PropsDoPainel };
  }

  it("o popover recebe as etiquetas da clínica e as dos selecionados", () => {
    const { html, props } = barra();
    expect(props.opcoes).toEqual(OPCOES);
    expect(props.etiquetasDosSelecionados).toEqual(["Cliente", "lead"]);
    expect(oferecidas(html)).toEqual([
      "Cliente",
      "LEAD",
      "SALUD CARE",
      "Urgente",
    ]);
  });

  it("tocar em LEAD etiqueta os selecionados com LEAD e tira a outra grafia", async () => {
    const { props, aoConcluir } = barra();
    props.aoAdicionar("LEAD");
    await vi.waitFor(() => expect(aoConcluir).toHaveBeenCalled());
    expect(etiquetarAction).toHaveBeenCalledTimes(1);
    expect(etiquetarAction).toHaveBeenCalledWith({
      contact_ids: [MARIA, JOANA],
      adicionar: ["LEAD"],
      remover: ["lead"],
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Etiqueta LEAD adicionada em 2 leads",
    );
    expect(aoConcluir).toHaveBeenCalledWith([]);
  });

  it("etiqueta cadastrada vai com a grafia de Configurações", async () => {
    const { props, aoConcluir } = barra();
    props.aoAdicionar("Urgente");
    await vi.waitFor(() => expect(aoConcluir).toHaveBeenCalled());
    expect(etiquetarAction).toHaveBeenCalledWith({
      contact_ids: [MARIA, JOANA],
      adicionar: ["Urgente"],
      remover: [],
    });
  });

  it("o X tira só a etiqueta tocada", async () => {
    const { props, aoConcluir } = barra();
    props.aoRemover("lead");
    await vi.waitFor(() => expect(aoConcluir).toHaveBeenCalled());
    expect(etiquetarAction).toHaveBeenCalledWith({
      contact_ids: [MARIA, JOANA],
      adicionar: [],
      remover: ["lead"],
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Etiqueta lead removida de 2 leads",
    );
  });

  it("falha: diz o motivo e mantém a seleção", async () => {
    etiquetarAction.mockResolvedValue({
      ok: false,
      error: "Não foi possível etiquetar os contatos.",
    });
    const { props, aoConcluir } = barra();
    props.aoAdicionar("LEAD");
    await vi.waitFor(() => expect(aoConcluir).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível etiquetar os contatos.",
    );
    expect(aoConcluir).toHaveBeenCalledWith([MARIA, JOANA]);
  });

  it("sem a leitura das cadastradas, o popover avisa e o Tentar de novo chega até ele", () => {
    const aoTentarDeNovo = vi.fn();
    const { html, props } = barra({
      etiquetasDaClinica: opcoesDeEtiqueta([], [{ tags: ["LEAD"] }]),
      leituraDasEtiquetas: "erro",
      aoTentarDeNovoAsEtiquetas: aoTentarDeNovo,
    });
    expect(texto(html)).toContain(
      "Não foi possível carregar as etiquetas cadastradas em Configurações.",
    );
    expect(oferecidas(html)).toEqual(["LEAD"]);
    expect(props.aoTentarDeNovo).toBe(aoTentarDeNovo);
  });
});

describe("lista de Leads: coluna Etiquetas", () => {
  function lista(leads: LeadResumo[], tons: TonsDasEtiquetas = TONS): string {
    return renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ListaLeads
          clinicId={CLINICA}
          leads={leads}
          membros={{}}
          jornada={JORNADA}
          reguas={[]}
          timezone="America/Fortaleza"
          tonsDeEtiqueta={tons}
          podeEditar
          dica={DICA}
          selecionados={new Set()}
          onSelecionar={() => undefined}
          onSelecionarTodos={() => undefined}
          onAbrirLead={() => undefined}
        />
      </QueryClientProvider>,
    );
  }

  it("tem a coluna Etiquetas", () => {
    expect(lista([lead()])).toMatch(/<th[^>]*>(?:<[^>]+>)*Etiquetas</);
  });

  it("até 2 chips e +N, com a lista inteira no title e no nome acessível", () => {
    const html = lista([lead({ tags: ["urgente", "LEAD", "Cliente"] })]);
    expect(chips(html).map((chip) => chip.nome)).toEqual(["Cliente", "LEAD"]);
    expect(chips(html).every((chip) => chip.tamanho === "compacto")).toBe(true);
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>\+1<\/span>/);
    expect(html).toContain('<span class="sr-only">, mais urgente</span>');
    expect(html).toContain('title="Cliente, LEAD, urgente"');
  });

  it("o tom é o da cadastrada com o mesmo nome; sem ela, neutro", () => {
    const html = lista([lead({ tags: ["urgente", "LEAD"] })]);
    expect(chips(html)).toEqual([
      { tamanho: "compacto", nome: "LEAD", cor: "var(--neutral)" },
      { tamanho: "compacto", nome: "urgente", cor: "var(--alert)" },
    ]);
  });

  it("sem catálogo, tudo neutro; lead sem etiqueta fica sem chip", () => {
    const neutro = lista([lead({ tags: ["Cliente"] })], new Map());
    expect(chips(neutro)).toEqual([
      { tamanho: "compacto", nome: "Cliente", cor: "var(--neutral)" },
    ]);
    expect(lista([lead()])).not.toContain("data-etiquetas-do-lead");
  });
});

describe("tela de Leads", () => {
  function tela(etiquetasIniciais: EtiquetaDeConversa[] | null): string {
    parametrosDaUrl = "visao=lista";
    return renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <LeadsClient
          clinicId={CLINICA}
          timezone="America/Fortaleza"
          leadsIniciais={[lead({ tags: ["urgente"] })]}
          totalInicial={1}
          reguasIniciais={[]}
          mapaInicial={null}
          jornada={JORNADA}
          membros={{}}
          responsaveisAtivos={[]}
          podeEditar
          dica={DICA}
          podeExportar
          podeAgendar
          dicaAgendar="Seu perfil não pode alterar a agenda"
          soAtribuidas={false}
          etiquetasIniciais={etiquetasIniciais}
        />
      </QueryClientProvider>,
    );
  }

  it("as cadastradas vindas do servidor dão o tom dos chips", () => {
    expect(chips(tela(CATALOGO))).toEqual([
      { tamanho: "compacto", nome: "urgente", cor: "var(--alert)" },
    ]);
  });

  it("sem a leitura das cadastradas, a lista abre com os chips neutros", () => {
    const html = tela(null);
    expect(texto(html)).toContain("Maria Lima");
    expect(chips(html)).toEqual([
      { tamanho: "compacto", nome: "urgente", cor: "var(--neutral)" },
    ]);
  });
});
