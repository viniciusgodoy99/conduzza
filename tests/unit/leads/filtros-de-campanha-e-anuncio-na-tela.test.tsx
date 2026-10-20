import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ANUNCIO_NAO_IDENTIFICADO,
  ORIGEM_SEM_ATRIBUICAO,
  ROTULO_SEM_ATRIBUICAO,
  type MapaDeAtribuicaoLido,
} from "@/lib/domain/campanha-e-anuncio-do-lead";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import type { ValoresDosFiltrosDeLeads } from "@/lib/domain/leads-ui";
import { leadsKeys, type LeadResumo } from "@/lib/queries/leads";

// A barra da Tela 4 com Campanha e Anúncio (pedido do dono em 20/10/2026) e
// a contagem ao lado dela, renderizadas de verdade (sem banco): a ordem dos
// filtros, as opcoes que o pai manda (com "Sem atribuição" na Origem), o
// filtro de campanha desabilitado com a dica sem o mapa, e a lista aberta
// pela URL de Resultados com os mesmos leads e a contagem na regiao viva,
// inclusive o carregando e o erro do mapa.
//
// O Select do Radix nao desenha as opcoes no HTML do servidor (a lista so
// existe aberta): aqui ele vira uma lista simples, para as opcoes aparecerem.

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    disabled,
    children,
  }: {
    value?: string;
    disabled?: boolean;
    children: ReactNode;
  }) => (
    <div
      data-select=""
      data-valor={value}
      data-desabilitado={disabled ? "sim" : undefined}
    >
      {children}
    </div>
  ),
  SelectTrigger: ({
    children,
    "aria-label": rotulo,
  }: {
    children: ReactNode;
    "aria-label"?: string;
  }) => (
    <button type="button" aria-label={rotulo}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder}</span>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <li data-opcao={value}>{children}</li>
  ),
  SelectGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectLabel: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectSeparator: () => null,
  SelectScrollUpButton: () => null,
  SelectScrollDownButton: () => null,
}));

vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

let parametrosDaUrl = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/leads",
  useSearchParams: () => new URLSearchParams(parametrosDaUrl),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/realtime/use-leads-channel", () => ({
  useLeadsChannel: () => undefined,
}));
vi.mock("@/app/(app)/leads/actions", () => ({
  mudarEtapaAction: vi.fn(),
  etiquetarAction: vi.fn(),
  reatribuirAction: vi.fn(),
  criarLeadAction: vi.fn(),
  abrirDetalheDoContatoAction: vi.fn(),
  importarContatosAction: vi.fn(),
}));
vi.mock("@/app/(app)/atividades/actions", () => ({
  equipeDaAtividadeAction: vi.fn(),
  conversaDoContatoAction: vi.fn(),
  atividadesDoContatoAction: vi.fn(),
  criarAtividadeAction: vi.fn(),
  editarAtividadeAction: vi.fn(),
  adiarAtividadeAction: vi.fn(),
  cancelarAtividadeAction: vi.fn(),
  concluirAtividadeAction: vi.fn(),
  reabrirAtividadeAction: vi.fn(),
}));

const { FiltrosLeads } = await import("@/components/leads/filtros-leads");
const { LeadsClient } = await import("@/app/(app)/leads/leads-client");

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const AD_1 = "120240000000000001";
const CAMPANHA_1 = "900000000000000001";
const CAMPANHA_FORA = "900000000000000777";

const VAZIOS: ValoresDosFiltrosDeLeads = {
  etapa: "",
  origem: "",
  campanha: "",
  anuncio: "",
  resp: "",
  de: "",
  ate: "",
};

function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Os aria-label dos gatilhos de filtro, na ordem da barra. */
function filtrosEmOrdem(html: string): string[] {
  return [...html.matchAll(/<button type="button" aria-label="([^"]+)"/g)].map(
    (achado) => achado[1] ?? "",
  );
}

/** As opcoes (valor e rotulo) do select com o aria-label pedido. */
function opcoesDo(html: string, rotulo: string): [string, string][] {
  const inicio = html.indexOf(`aria-label="${rotulo}"`);
  expect(inicio).toBeGreaterThan(-1);
  const fim = html.indexOf("</ul>", inicio);
  return [
    ...html
      .slice(inicio, fim)
      .matchAll(/<li data-opcao="([^"]*)">([^<]*)<\/li>/g),
  ].map((achado) => [achado[1] ?? "", achado[2] ?? ""]);
}

/** O texto da regiao viva da contagem. */
function contagem(html: string): string | null {
  const achado = /<p aria-live="polite" aria-atomic="true"[^>]*>([^<]*)<\/p>/.exec(
    html,
  );
  return achado ? (achado[1] ?? "") : null;
}

describe("a barra de filtros", () => {
  function barra(
    valores: Partial<ValoresDosFiltrosDeLeads> = {},
    extra: { dicaDaCampanha?: string | null } = {},
  ): string {
    return renderToStaticMarkup(
      <FiltrosLeads
        valores={{ ...VAZIOS, ...valores }}
        responsaveis={[{ id: "u1", nome: "Ana" }]}
        jornada={[]}
        opcoesDeCampanha={[
          { value: `meta:${CAMPANHA_1}`, label: "Botox Outubro" },
          { value: "texto:Promo", label: "Promo" },
          { value: "sem", label: "Sem campanha" },
        ]}
        dicaDaCampanha={extra.dicaDaCampanha ?? null}
        opcoesDeAnuncio={[
          { value: AD_1, label: "Botox com 20% de desconto" },
          { value: ANUNCIO_NAO_IDENTIFICADO, label: "Anúncio não identificado" },
          { value: "sem", label: "Sem anúncio da Meta" },
        ]}
        resumo={<p aria-live="polite">16 leads</p>}
        aoMudar={() => undefined}
        aoLimpar={() => undefined}
      />,
    );
  }

  it("Campanha e Anúncio logo depois de Origem", () => {
    expect(filtrosEmOrdem(barra())).toEqual([
      "Etapa",
      "Origem",
      "Campanha",
      "Anúncio",
      "Responsável",
    ]);
  });

  it("a Origem termina em Sem atribuição", () => {
    const origem = opcoesDo(barra(), "Origem");
    // "Origem" (todas), os 8 canais e o canal vazio.
    expect(origem).toHaveLength(10);
    expect(origem[0]).toEqual(["__todos__", "Origem"]);
    expect(origem[1]).toEqual(["trafego_pago", "Tráfego pago"]);
    expect(origem.at(-1)).toEqual([ORIGEM_SEM_ATRIBUICAO, ROTULO_SEM_ATRIBUICAO]);
  });

  it("as opções de campanha e anúncio na ordem que o pai manda, e o valor da URL marcado", () => {
    const html = barra({ campanha: `meta:${CAMPANHA_1}`, anuncio: AD_1 });
    expect(opcoesDo(html, "Campanha").map(([valor]) => valor)).toEqual([
      "__todos__",
      `meta:${CAMPANHA_1}`,
      "texto:Promo",
      "sem",
    ]);
    expect(opcoesDo(html, "Anúncio").map(([, rotulo]) => rotulo)).toEqual([
      "Anúncio",
      "Botox com 20% de desconto",
      "Anúncio não identificado",
      "Sem anúncio da Meta",
    ]);
    expect(html).toContain(`data-valor="meta:${CAMPANHA_1}"`);
    expect(html).toContain(`data-valor="${AD_1}"`);
  });

  it("sem o mapa, a campanha fica visível, desabilitada e com a dica", () => {
    const html = barra({}, { dicaDaCampanha: "Carregando as campanhas." });
    expect(html).toMatch(
      /data-dica="Carregando as campanhas\."><div data-select="" data-valor="__todos__" data-desabilitado="sim"><button type="button" aria-label="Campanha"/,
    );
    // Os outros filtros continuam.
    expect(html.match(/data-desabilitado="sim"/g)).toHaveLength(1);
  });

  it("Limpar filtros aparece com só a campanha ou só o anúncio", () => {
    expect(texto(barra())).not.toContain("Limpar filtros");
    expect(texto(barra({ campanha: "sem" }))).toContain("Limpar filtros");
    expect(texto(barra({ anuncio: AD_1 }))).toContain("Limpar filtros");
  });

  it("a contagem fecha a barra", () => {
    const html = barra();
    expect(html.lastIndexOf("16 leads")).toBeGreaterThan(html.indexOf("Entrou até"));
  });
});

// ---------------------------------------------------------------------------
// A tela inteira, aberta pela URL de Resultados
// ---------------------------------------------------------------------------

const JORNADA: EtapaDaJornada[] = [
  {
    id: "e1",
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

let numero = 0;

function lead(nome: string, campos: Partial<LeadResumo> = {}): LeadResumo {
  numero += 1;
  return {
    id: `00000000-0000-4000-8000-${String(numero).padStart(12, "0")}`,
    name: nome,
    phone_e164: `+55859990${String(numero).padStart(5, "0")}`,
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
    source_campaign_id: null,
    source_adset_id: null,
    com_ctwa_clid: false,
    first_contact_at: "2026-10-05T12:00:00.000Z",
    last_contact_at: null,
    insurance: null,
    consent_ativo: false,
    anuncio_meta: { estado: "lida", anuncio: null },
    ...campos,
  };
}

const MAPA: MapaDeAtribuicaoLido = {
  anuncios: [
    {
      ad_id: AD_1,
      campaign_id: CAMPANHA_1,
      campaign_name: "Botox Outubro",
      ad_name: null,
      ultimo_dia_com_entrega: "2026-10-10",
      atualizado_em: "2026-10-10T12:00:00+00:00",
    },
  ],
  titulos: [{ ad_id: AD_1, titulo: "Botox com 20% de desconto" }],
};

const LEADS: LeadResumo[] = [
  lead("Maria do anuncio", {
    source_channel: "trafego_pago",
    source_ad_id: AD_1,
    com_ctwa_clid: true,
  }),
  lead("Joana do anuncio com espaco", {
    source_channel: "trafego_pago",
    source_ad_id: ` ${AD_1}`,
  }),
  lead("Paula so do clique", { com_ctwa_clid: true }),
  lead("Rita da promo", { source_channel: "indicacao", source_campaign: "Promo" }),
  lead("Clara de setembro", {
    source_ad_id: AD_1,
    first_contact_at: "2026-09-20T12:00:00.000Z",
  }),
];

function tela(
  url: string,
  opcoes: {
    leads?: LeadResumo[];
    mapa?: MapaDeAtribuicaoLido | null;
    total?: number;
    queryClient?: QueryClient;
  } = {},
): string {
  parametrosDaUrl = url;
  return renderToStaticMarkup(
    <QueryClientProvider client={opcoes.queryClient ?? new QueryClient()}>
      <LeadsClient
        clinicId={CLINICA}
        timezone="America/Fortaleza"
        leadsIniciais={opcoes.leads ?? LEADS}
        totalInicial={opcoes.total ?? (opcoes.leads ?? LEADS).length}
        reguasIniciais={[]}
        mapaInicial={opcoes.mapa === undefined ? MAPA : opcoes.mapa}
        jornada={JORNADA}
        membros={{}}
        responsaveisAtivos={[]}
        podeEditar
        dica="Seu perfil não pode editar leads e pacientes"
        podeExportar
        podeAgendar
        dicaAgendar="Seu perfil não pode alterar a agenda"
        soAtribuidas={false}
      />
    </QueryClientProvider>,
  );
}

const DE_RESULTADOS = "visao=lista&de=2026-10-01&ate=2026-10-31";

describe("a lista aberta por Resultados", () => {
  it("campanha da Meta: os mesmos leads e a contagem na região viva", () => {
    const html = tela(
      `${DE_RESULTADOS}&campanha=${encodeURIComponent(`meta:${CAMPANHA_1}`)}`,
    );
    expect(contagem(html)).toBe("1 lead");
    const lido = texto(html);
    expect(lido).toContain("Maria do anuncio");
    expect(lido).not.toContain("Joana do anuncio com espaco");
    expect(lido).not.toContain("Clara de setembro");
  });

  it("anúncio: o id aparado junta os dois; não identificado e Sem atribuição", () => {
    expect(contagem(tela(`${DE_RESULTADOS}&anuncio=${AD_1}`))).toBe("2 leads");
    expect(
      contagem(tela(`${DE_RESULTADOS}&anuncio=${ANUNCIO_NAO_IDENTIFICADO}`)),
    ).toBe("1 lead");
    expect(
      contagem(tela(`${DE_RESULTADOS}&origem=${ORIGEM_SEM_ATRIBUICAO}`)),
    ).toBe("1 lead");
  });

  it("sem filtro, todos os carregados", () => {
    expect(contagem(tela("visao=lista"))).toBe("5 leads");
  });

  it("nenhum lead com o filtro: o vazio de filtro e Nenhum lead na contagem", () => {
    const html = tela(
      `${DE_RESULTADOS}&campanha=${encodeURIComponent(`meta:${CAMPANHA_FORA}`)}`,
    );
    expect(contagem(html)).toBe("Nenhum lead");
    expect(texto(html)).toContain("Nenhum lead com esses filtros");
    // A campanha da URL aparece, para o filtro ativo ficar visível.
    expect(opcoesDo(html, "Campanha")).toContainEqual([
      `meta:${CAMPANHA_FORA}`,
      `Campanha ${CAMPANHA_FORA}`,
    ]);
  });

  it("as opções vêm de todos os carregados, não só dos filtrados", () => {
    const html = tela(`${DE_RESULTADOS}&anuncio=${AD_1}`);
    expect(opcoesDo(html, "Campanha").map(([, rotulo]) => rotulo)).toEqual([
      "Campanha",
      "Botox Outubro",
      "Promo",
      "Sem campanha",
    ]);
    expect(opcoesDo(html, "Anúncio").map(([, rotulo]) => rotulo)).toEqual([
      "Anúncio",
      "Botox com 20% de desconto",
      "Anúncio não identificado",
      "Sem anúncio da Meta",
    ]);
  });

  it("com o teto cortando a lista, a contagem diz que é entre os carregados", () => {
    const muitos = Array.from({ length: 1000 }, (_, indice) =>
      lead(`Lead ${indice}`),
    );
    const html = tela("visao=kanban", { leads: muitos, total: 1200 });
    expect(contagem(html)).toBe("1.000 leads entre os 1.000 carregados");
  });
});

describe("o mapa da clínica que não chegou", () => {
  it("carregando com a campanha filtrada: esqueleto, contagem vazia e o filtro desabilitado", () => {
    const html = tela(
      `${DE_RESULTADOS}&campanha=${encodeURIComponent(`meta:${CAMPANHA_1}`)}`,
      { mapa: null },
    );
    expect(contagem(html)).toBe("");
    expect(texto(html)).not.toContain("Maria do anuncio");
    expect(texto(html)).not.toContain("Nenhum lead com esses filtros");
    expect(html).toContain('data-dica="Carregando as campanhas."');
  });

  async function clienteComErroNoMapa(): Promise<QueryClient> {
    // Sem tentar de novo ao montar: o HTML do servidor mostra o erro que
    // o navegador mostraria depois das tentativas.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    });
    await queryClient.prefetchQuery({
      queryKey: leadsKeys.mapa(CLINICA),
      queryFn: async () => {
        throw new Error("caiu");
      },
    });
    return queryClient;
  }

  it("erro com a campanha filtrada: o erro no lugar da lista, com Tentar de novo e Limpar filtros", async () => {
    const html = tela(
      `${DE_RESULTADOS}&campanha=${encodeURIComponent(`meta:${CAMPANHA_1}`)}`,
      { mapa: null, queryClient: await clienteComErroNoMapa() },
    );
    const lido = texto(html);
    expect(lido).toContain("Não foi possível filtrar por campanha");
    expect(lido).toContain("Tentar de novo");
    expect(lido).toContain("Limpar filtros");
    expect(lido).not.toContain("Maria do anuncio");
    expect(contagem(html)).toBe("");
    expect(html).toContain(
      'data-dica="Não foi possível carregar as campanhas. Tente de novo."',
    );
  });

  it("erro sem a campanha filtrada: a lista segue e o aviso explica o filtro de fora", async () => {
    const html = tela(`${DE_RESULTADOS}&anuncio=${AD_1}`, {
      mapa: null,
      queryClient: await clienteComErroNoMapa(),
    });
    const lido = texto(html);
    expect(lido).toContain(
      "Não foi possível carregar as campanhas. O filtro de campanha fica indisponível até carregar.",
    );
    expect(lido).toContain("Maria do anuncio");
    expect(contagem(html)).toBe("2 leads");
  });

  it("nenhum travessão na tela", () => {
    expect(tela(DE_RESULTADOS)).not.toMatch(/[–—]/);
  });
});
