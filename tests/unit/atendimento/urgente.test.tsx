import { readFileSync } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/atendimento/actions", () => ({
  assumirConversaAction: vi.fn(),
  reabrirConversaAction: vi.fn(),
  resolverConversaAction: vi.fn(),
  transferirConversaAction: vi.fn(),
  devolverParaIaAction: vi.fn(),
  elegibilidadeDoDevolverAction: vi.fn(),
  lerRascunhoBloqueadoAction: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import {
  ConversationCard,
  etiquetasNaLinha,
} from "@/components/atendimento/conversation-card";
import {
  casaSituacaoDaLista,
  ConversationList,
} from "@/components/atendimento/conversation-list";
import { ChipDaUrgencia, Thread } from "@/components/atendimento/thread";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DICA_DA_URGENCIA,
  dicaDaUrgencia,
  estadoVisualDaConversa,
  URGENCIA_DA_CONVERSA,
} from "@/lib/design/status";
import {
  aplicarMarcaNaLista,
  aplicarMarcasNaLista,
  fetchConversationById,
  fetchConversations,
  fetchMarcasAbertas,
  fetchResolvedConversations,
  MARCAS_ABERTAS_LIMIT,
  marcaDeUrgenciaDaLinha,
  marcaForaDoBanco,
  ordemDoAtendimento,
  urgenteAberta,
  type ConversationListItem,
} from "@/lib/queries/conversations";
import {
  CANAIS_DO_INBOX,
  canaisDoInbox,
  marcaDepoisDoEvento,
} from "@/lib/realtime/use-inbox-channel";

// AG6a no Atendimento (desenho da AG6, secoes 1.1 e 6; D-53 pela
// recomendacao, pendente do dono; contrato da frente de banco, secao 3): a
// marca de urgencia vem embutida na lista (conversa_urgente, so o instante),
// a urgente aberta sobe para o topo (entre elas pela chegada), o chip
// "Urgente" (BellRing, alerta) no cartao e no cabecalho com a dica, o chip de
// situacao "Urgentes" com a contagem, e a marca sai quando a conversa deixa
// "Aguardando você" (o gatilho do banco fecha na mesma transacao). Sem
// navegador: a marcacao da primeira carga e as regras puras.

const EU = "11111111-1111-4111-8111-111111111111";
const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";

function conversa(
  id: string,
  nome: string,
  campos: Partial<ConversationListItem> = {},
): ConversationListItem {
  return {
    id,
    status: "aguardando_humano",
    assignee_user_id: null,
    unread_count: 0,
    awaiting_reply: true,
    last_message_at: "2026-10-27T14:30:00.000Z",
    last_inbound_at: "2026-10-27T14:30:00.000Z",
    last_preview: "Oi",
    last_preview_kind: "texto",
    last_preview_author: "paciente",
    last_preview_author_user_id: null,
    tags: [],
    whatsapp_account_id: null,
    contact: {
      id: `contato-${id}`,
      name: nome,
      phone_e164: "+5585999990000",
      kind: "lead",
      funnel_stage: "novo",
      source_channel: null,
      source_campaign: null,
      first_contact_at: null,
    },
    urgente: null,
    ...campos,
  };
}

const MARCA_CEDO = { desde: "2026-10-27T10:00:00.000Z" };
const MARCA_TARDE = { desde: "2026-10-27T11:00:00.000Z" };

function lista(conversations: ConversationListItem[]): string {
  return renderToStaticMarkup(
    <ConversationList
      nomesDeEtapa={{ novo: "Novo" }}
      etiquetas={[]}
      conversations={conversations}
      viewerId={EU}
      authorNames={{}}
      timezone="America/Fortaleza"
      agoraInicial={Date.parse("2026-10-27T15:00:00.000Z")}
      selectedId={null}
      onSelect={() => undefined}
    />,
  );
}

function cartao(
  item: ConversationListItem,
  numero = false,
  podeAssumir?: boolean,
): string {
  return renderToStaticMarkup(
    <ConversationCard
      {...(podeAssumir === undefined ? {} : { podeAssumir })}
      conversation={item}
      estado={estadoVisualDaConversa(item, { viewerId: EU, authorNames: {} })}
      reserva="Lead · Novo"
      etiquetas={[
        { chave: "a", nome: "Botox", tom: "neutral" },
        { chave: "b", nome: "Retorno", tom: "neutral" },
      ]}
      selected={false}
      viewerId={EU}
      timezone="America/Fortaleza"
      agora={Date.parse("2026-10-27T15:00:00.000Z")}
      onSelect={() => undefined}
      numero={
        numero
          ? { estado: "removido", numero: { id: "n1", nome: "Recepção" } }
          : null
      }
    />,
  );
}

function fio(item: ConversationListItem): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <Thread
          conversation={item}
          messages={[]}
          decisions={[]}
          isLoading={false}
          authorNames={{}}
          onBack={() => undefined}
          onToggleContext={() => undefined}
          footer={null}
          clinicId={CLINICA}
          viewerId={EU}
          viewerRole="recepcao"
          podeEditar
          ehChefia={false}
          onResponder={() => undefined}
          onApagar={() => undefined}
          emVoo={[]}
          aoTentarDeNovo={() => undefined}
          aoDescartarEnvio={() => undefined}
          aoIrParaConversa={() => undefined}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** Os nomes dos cartoes da lista, na ordem da tela. */
function nomesNaOrdem(html: string, nomes: readonly string[]): string[] {
  return nomes
    .map((nome) => ({ nome, onde: html.indexOf(`>${nome}<`) }))
    .filter((item) => item.onde > -1)
    .sort((a, b) => a.onde - b.onde)
    .map((item) => item.nome);
}

/** O texto (rotulo e contagem) dos chips de situacao. */
function chipsDeSituacao(html: string): string[] {
  const inicio = html.indexOf('aria-label="Filtrar por situação"');
  const grupo = html.slice(inicio, html.indexOf("</div>", inicio));
  return [...grupo.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(
    ([, miolo = ""]) => miolo.replace(/<[^>]+>/g, "").trim(),
  );
}

describe("a marca de urgência que vem do banco", () => {
  it("a marca aberta vira o instante; a encerrada e a fora do formato, nula", () => {
    expect(
      marcaDeUrgenciaDaLinha({ desde: MARCA_CEDO.desde, encerrada_em: null }),
    ).toEqual(MARCA_CEDO);
    // O PostgREST pode devolver o embutido como lista de um item.
    expect(
      marcaDeUrgenciaDaLinha([{ desde: MARCA_CEDO.desde, encerrada_em: null }]),
    ).toEqual(MARCA_CEDO);
    expect(
      marcaDeUrgenciaDaLinha({
        desde: MARCA_CEDO.desde,
        encerrada_em: "2026-10-27T10:05:00.000Z",
      }),
    ).toBeNull();
    expect(marcaDeUrgenciaDaLinha(null)).toBeNull();
    expect(marcaDeUrgenciaDaLinha([])).toBeNull();
    expect(marcaDeUrgenciaDaLinha({ desde: "ontem" })).toBeNull();
    expect(marcaDeUrgenciaDaLinha({ encerrada_em: null })).toBeNull();
  });

  it("a lista pede a marca embutida e a entrega como `urgente`, sem o cru", async () => {
    const pedidos: string[] = [];
    const linhas = [
      {
        ...conversa("1", "Maria Silva"),
        urgente: undefined,
        urgencia: { desde: MARCA_CEDO.desde, encerrada_em: null },
      },
      {
        ...conversa("2", "João Lima"),
        urgente: undefined,
        urgencia: null,
      },
    ];
    const consulta = {
      select(colunas: string) {
        pedidos.push(colunas);
        return consulta;
      },
      eq: () => consulta,
      neq: () => consulta,
      order: () => consulta,
      limit: async () => ({ data: linhas, error: null }),
      maybeSingle: async () => ({ data: linhas[0], error: null }),
    };
    const supabase = { from: () => consulta } as never;
    const resultado = await fetchConversations(supabase, CLINICA);
    expect(pedidos.length).toBeGreaterThan(0);
    for (const colunas of pedidos) {
      expect(colunas).toContain(
        "urgencia:conversa_urgente (desde, encerrada_em)",
      );
    }
    const maria = resultado.find((c) => c.id === "1");
    expect(maria?.urgente).toEqual(MARCA_CEDO);
    expect(maria).not.toHaveProperty("urgencia");
    expect(resultado.find((c) => c.id === "2")?.urgente).toBeNull();
    // A urgente vem primeiro desde a busca.
    expect(resultado[0]?.id).toBe("1");

    const doLink = await fetchConversationById(supabase, CLINICA, "1");
    expect(doLink?.urgente).toEqual(MARCA_CEDO);
  });
});

// ---------------------------------------------------------------------------
// O codigo no ar antes da migration (revisao da AG6a, achado 1)
// ---------------------------------------------------------------------------

/**
 * Um cliente falso que responde cada busca pelo select pedido: com a marca
 * embutida, `comMarca`; sem ela, `semMarca`. Guarda os selects, na ordem.
 */
function bancoDaLista(respostas: {
  comMarca: { data?: unknown; error?: unknown };
  semMarca: { data?: unknown; error?: unknown };
}) {
  const pedidos: string[] = [];
  const supabase = {
    from: (tabela: string) => {
      let colunas = "";
      const resposta = () => {
        const escolhida = colunas.includes("conversa_urgente")
          ? respostas.comMarca
          : respostas.semMarca;
        return Promise.resolve({ data: null, error: null, ...escolhida });
      };
      const consulta = {
        select(pedidas: string) {
          colunas = pedidas;
          pedidos.push(`${tabela}: ${pedidas}`);
          return consulta;
        },
        eq: () => consulta,
        neq: () => consulta,
        is: () => consulta,
        order: () => consulta,
        limit: () => consulta,
        maybeSingle: resposta,
        then: (
          ok: (valor: unknown) => unknown,
          falha: (erro: unknown) => unknown,
        ) => resposta().then(ok, falha),
      };
      return consulta;
    },
  };
  return { supabase: supabase as never, pedidos };
}

const SEM_A_TABELA = {
  code: "PGRST200",
  message:
    "Could not find a relationship between 'conversation' and 'conversa_urgente' in the schema cache",
};

describe("a lista antes da migration (o embutido da marca sem a tabela)", () => {
  const linhas = [
    { ...conversa("1", "Maria Silva"), urgente: undefined },
    { ...conversa("2", "João Lima"), urgente: undefined },
  ];

  it("PGRST200 ou 42P01: refaz sem o embutido e o Atendimento abre sem a marca", async () => {
    for (const erro of [SEM_A_TABELA, { code: "42P01", message: "x" }]) {
      const { supabase, pedidos } = bancoDaLista({
        comMarca: { error: erro },
        semMarca: { data: linhas },
      });
      const resultado = await fetchConversations(supabase, CLINICA);
      expect(resultado.map((c) => c.id).sort()).toEqual(["1", "2"]);
      for (const item of resultado) {
        expect(item.urgente).toBeNull();
        expect(item).not.toHaveProperty("urgencia");
      }
      // As duas buscas (recentes e esperando), cada uma com a volta.
      expect(
        pedidos.filter((p) => p.includes("conversa_urgente")),
      ).toHaveLength(2);
      expect(
        pedidos.filter((p) => !p.includes("conversa_urgente")),
      ).toHaveLength(2);
      // A volta e o select de antes, inteiro (o contato embutido continua).
      for (const pedido of pedidos.filter(
        (p) => !p.includes("conversa_urgente"),
      )) {
        expect(pedido).toContain("contact:contact_id (");
        expect(pedido).toContain("whatsapp_account_id");
      }
    }
  });

  it("o arquivo de resolvidas e a conversa do link também voltam sem a marca", async () => {
    const arquivo = bancoDaLista({
      comMarca: { error: SEM_A_TABELA },
      semMarca: {
        data: [{ ...linhas[0], status: "resolvida" }],
      },
    });
    const resolvidas = await fetchResolvedConversations(
      arquivo.supabase,
      CLINICA,
    );
    expect(resolvidas.map((c) => [c.id, c.urgente])).toEqual([["1", null]]);
    expect(arquivo.pedidos).toHaveLength(2);

    const link = bancoDaLista({
      comMarca: { error: SEM_A_TABELA },
      semMarca: { data: linhas[1] },
    });
    const doLink = await fetchConversationById(link.supabase, CLINICA, "2");
    expect(doLink?.id).toBe("2");
    expect(doLink?.urgente).toBeNull();
    expect(link.pedidos).toHaveLength(2);
  });

  it("com a tabela, uma busca só por lista, sem volta", async () => {
    const { supabase, pedidos } = bancoDaLista({
      comMarca: {
        data: [
          {
            ...linhas[0],
            urgencia: { desde: MARCA_CEDO.desde, encerrada_em: null },
          },
        ],
      },
      semMarca: { error: { code: "XX000", message: "nao devia" } },
    });
    const resultado = await fetchConversations(supabase, CLINICA);
    expect(resultado[0]?.urgente).toEqual(MARCA_CEDO);
    expect(pedidos.every((p) => p.includes("conversa_urgente"))).toBe(true);
    expect(pedidos).toHaveLength(2);
  });

  it("qualquer outro erro continua sendo erro (sem volta), e a volta que falha também", async () => {
    const outro = bancoDaLista({
      comMarca: { error: { code: "42501", message: "sem permissao" } },
      semMarca: { data: linhas },
    });
    await expect(fetchConversations(outro.supabase, CLINICA)).rejects.toThrow(
      "sem permissao",
    );
    expect(outro.pedidos.every((p) => p.includes("conversa_urgente"))).toBe(
      true,
    );

    const volta = bancoDaLista({
      comMarca: { error: SEM_A_TABELA },
      semMarca: { error: { code: "08006", message: "caiu" } },
    });
    await expect(fetchConversations(volta.supabase, CLINICA)).rejects.toThrow(
      "caiu",
    );
  });

  it("só os códigos da tabela ausente contam como embutido fora do banco", () => {
    expect(marcaForaDoBanco({ code: "PGRST200" })).toBe(true);
    expect(marcaForaDoBanco({ code: "42P01" })).toBe(true);
    for (const outro of [
      { code: "PGRST201" },
      { code: "42501" },
      { code: "PGRST116" },
      { code: null },
      null,
      undefined,
    ]) {
      expect(marcaForaDoBanco(outro), JSON.stringify(outro)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// O tempo real em dois canais (revisao da AG6a, achado 1)
// ---------------------------------------------------------------------------

type Assinatura = {
  evento: string;
  tabela: string;
  filtro: string | undefined;
  reagir: (payload: unknown) => void;
};

function supabaseDeCanais() {
  const canais: { nome: string; assinaturas: Assinatura[] }[] = [];
  const supabase = {
    channel(nome: string) {
      const canal = {
        nome,
        assinaturas: [] as Assinatura[],
        on(
          _tipo: string,
          cfg: { event: string; table: string; filter?: string },
          reagir: (payload: unknown) => void,
        ) {
          canal.assinaturas.push({
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

describe("o tempo real do Atendimento em dois canais", () => {
  const reacoes = () => ({
    conversa: vi.fn(),
    mensagem: vi.fn(),
    contato: vi.fn(),
    numero: vi.fn(),
    marca: vi.fn(),
  });

  it("a marca num canal próprio: o principal fica com as quatro tabelas de antes", () => {
    const { supabase, canais } = supabaseDeCanais();
    canaisDoInbox(supabase as never, CLINICA, reacoes());
    expect(canais.map((c) => c.nome)).toEqual([
      CANAIS_DO_INBOX.principal(CLINICA),
      CANAIS_DO_INBOX.urgencia(CLINICA),
    ]);
    expect(CANAIS_DO_INBOX.principal(CLINICA)).toBe(`inbox:${CLINICA}`);
    const [principal, daMarca] = canais;
    expect(
      principal?.assinaturas.map((a) => [a.evento, a.tabela, a.filtro]),
    ).toEqual([
      ["*", "conversation", `clinic_id=eq.${CLINICA}`],
      ["*", "message", `clinic_id=eq.${CLINICA}`],
      ["UPDATE", "contact", `clinic_id=eq.${CLINICA}`],
      ["*", "whatsapp_account", `clinic_id=eq.${CLINICA}`],
    ]);
    expect(
      daMarca?.assinaturas.map((a) => [a.evento, a.tabela, a.filtro]),
    ).toEqual([["*", "conversa_urgente", `clinic_id=eq.${CLINICA}`]]);
  });

  it("cada tabela chega na reação dela", () => {
    const { supabase, canais } = supabaseDeCanais();
    const reagir = reacoes();
    canaisDoInbox(supabase as never, CLINICA, reagir);
    const evento = { eventType: "INSERT", new: { id: "x" } };
    const [principal, daMarca] = canais;
    principal?.assinaturas.forEach((a) => a.reagir(evento));
    daMarca?.assinaturas.forEach((a) => a.reagir(evento));
    for (const reacao of Object.values(reagir)) {
      expect(reacao).toHaveBeenCalledTimes(1);
      expect(reacao).toHaveBeenCalledWith(evento);
    }
  });

  it("o hook entra nos dois canais, cada um por si, e só pelo canaisDoInbox", () => {
    const fonte = readFileSync("lib/realtime/use-inbox-channel.ts", "utf8");
    expect(fonte.match(/assinarComSessao\(/g)).toHaveLength(2);
    expect(fonte).toMatch(/assinarComSessao\(supabase, principal,/);
    expect(fonte).toMatch(/assinarComSessao\(supabase, urgencia,/);
    expect(fonte.match(/\.channel\(/g)).toHaveLength(2);
    // Ao assinar a marca, as marcas abertas entram como eventos.
    expect(fonte).toMatch(/fetchMarcasAbertas\(supabase, clinicId\)/);
  });
});

describe("as marcas abertas lidas ao assinar o canal da marca", () => {
  it("a consulta: só as abertas da clínica, só ids e instantes", async () => {
    const pedidos: unknown[][] = [];
    const consulta = {
      select: (colunas: string) => {
        pedidos.push(["select", colunas]);
        return consulta;
      },
      eq: (coluna: string, valor: unknown) => {
        pedidos.push(["eq", coluna, valor]);
        return consulta;
      },
      is: (coluna: string, valor: unknown) => {
        pedidos.push(["is", coluna, valor]);
        return consulta;
      },
      limit: async (n: number) => {
        pedidos.push(["limit", n]);
        return {
          data: [
            {
              conversation_id: "1",
              desde: MARCA_CEDO.desde,
              encerrada_em: null,
            },
          ],
          error: null,
        };
      },
    };
    const tabelas: string[] = [];
    const marcas = await fetchMarcasAbertas(
      {
        from: (tabela: string) => {
          tabelas.push(tabela);
          return consulta;
        },
      } as never,
      CLINICA,
    );
    expect(tabelas).toEqual(["conversa_urgente"]);
    expect(pedidos).toEqual([
      ["select", "conversation_id, desde, encerrada_em"],
      ["eq", "clinic_id", CLINICA],
      ["is", "encerrada_em", null],
      ["limit", MARCAS_ABERTAS_LIMIT],
    ]);
    expect(marcas).toEqual([
      { conversation_id: "1", desde: MARCA_CEDO.desde, encerrada_em: null },
    ]);
  });

  it("sem a tabela (antes da migration), lança: o canal ignora", async () => {
    const consulta = {
      select: () => consulta,
      eq: () => consulta,
      is: () => consulta,
      limit: async () => ({
        data: null,
        error: { code: "PGRST205", message: "sem a tabela" },
      }),
    };
    await expect(
      fetchMarcasAbertas({ from: () => consulta } as never, CLINICA),
    ).rejects.toThrow("sem a tabela");
  });

  it("as abertas entram na lista; a que não veio não é apagada; nada muda, a mesma lista", () => {
    const maria = conversa("1", "Maria", {
      last_message_at: "2026-10-27T09:00:00.000Z",
    });
    const joao = conversa("2", "João", {
      last_message_at: "2026-10-27T14:00:00.000Z",
    });
    const ana = conversa("3", "Ana", {
      last_message_at: "2026-10-27T13:00:00.000Z",
      urgente: MARCA_TARDE,
    });
    const antes = [ana, joao, maria];
    const depois = aplicarMarcasNaLista(antes, [
      { conversation_id: "1", desde: MARCA_CEDO.desde, encerrada_em: null },
    ]);
    // Maria sobe (a mais antiga entre as urgentes); Ana continua marcada.
    expect(depois.map((c) => c.id)).toEqual(["1", "3", "2"]);
    expect(depois.find((c) => c.id === "3")?.urgente).toEqual(MARCA_TARDE);
    expect(aplicarMarcasNaLista(depois, [])).toBe(depois);
    // A leitura mais velha que o evento da conversa: quem ja saiu da fila
    // (alguem assumiu) nao ganha a marca velha.
    const assumida = { ...joao, status: "em_atendimento" as const };
    expect(
      aplicarMarcasNaLista(
        [assumida],
        [{ conversation_id: "2", desde: MARCA_CEDO.desde, encerrada_em: null }],
      ),
    ).toEqual([assumida]);
    expect(
      aplicarMarcasNaLista(depois, [
        { conversation_id: "1", desde: MARCA_CEDO.desde, encerrada_em: null },
      ]),
    ).toBe(depois);
  });
});

describe("a conversa urgente agora", () => {
  it("é a marca aberta com a conversa em Aguardando você", () => {
    expect(urgenteAberta(conversa("1", "A", { urgente: MARCA_CEDO }))).toBe(
      true,
    );
    expect(urgenteAberta(conversa("1", "A"))).toBe(false);
    expect(
      urgenteAberta({ status: "aguardando_humano" } as ConversationListItem),
    ).toBe(false);
    // Assumida, transferida ou resolvida: o gatilho fecha a marca; uma marca
    // velha no cache nunca marca a conversa que alguém já pegou.
    for (const status of ["em_atendimento", "resolvida", "ia_atendendo"]) {
      expect(
        urgenteAberta(
          conversa("1", "A", {
            status: status as ConversationListItem["status"],
            urgente: MARCA_CEDO,
          }),
        ),
      ).toBe(false);
    }
  });

  it("o evento da conversa tira a marca fora de Aguardando você", () => {
    expect(marcaDepoisDoEvento("aguardando_humano", MARCA_CEDO)).toEqual(
      MARCA_CEDO,
    );
    expect(marcaDepoisDoEvento("aguardando_humano", undefined)).toBeNull();
    for (const status of ["em_atendimento", "resolvida", "ia_atendendo"]) {
      expect(marcaDepoisDoEvento(status, MARCA_CEDO)).toBeNull();
    }
  });
});

describe("a ordem da lista (D-53)", () => {
  const recente = conversa("1", "Recente", {
    last_message_at: "2026-10-27T14:59:00.000Z",
  });
  const antiga = conversa("2", "Antiga", {
    last_message_at: "2026-10-27T09:00:00.000Z",
  });
  const urgenteTarde = conversa("3", "Urgente tarde", {
    last_message_at: "2026-10-27T11:00:00.000Z",
    urgente: MARCA_TARDE,
  });
  const urgenteCedo = conversa("4", "Urgente cedo", {
    last_message_at: "2026-10-27T10:00:00.000Z",
    urgente: MARCA_CEDO,
  });
  const assumida = conversa("5", "Assumida", {
    status: "em_atendimento",
    assignee_user_id: EU,
    last_message_at: "2026-10-27T08:00:00.000Z",
    urgente: MARCA_CEDO,
  });

  it("as urgentes abertas primeiro, entre elas pela chegada; depois a recência", () => {
    const ordem = [recente, antiga, urgenteTarde, assumida, urgenteCedo]
      .sort(ordemDoAtendimento)
      .map((c) => c.contact.name);
    expect(ordem).toEqual([
      "Urgente cedo",
      "Urgente tarde",
      "Recente",
      "Antiga",
      "Assumida",
    ]);
  });

  it("a tela desenha na mesma ordem, com o chip Urgentes contando as abertas", () => {
    const html = lista([recente, antiga, urgenteTarde, assumida, urgenteCedo]);
    expect(
      nomesNaOrdem(html, [
        "Recente",
        "Antiga",
        "Urgente tarde",
        "Urgente cedo",
        "Assumida",
      ]),
    ).toEqual([
      "Urgente cedo",
      "Urgente tarde",
      "Recente",
      "Antiga",
      "Assumida",
    ]);
    const chips = chipsDeSituacao(html);
    expect(chips[0]).toBe("Urgentes 2");
  });

  it("sem urgente aberta, o chip Urgentes não aparece e a ordem é a de sempre", () => {
    const html = lista([antiga, recente, assumida]);
    expect(chipsDeSituacao(html).some((c) => c.startsWith("Urgentes"))).toBe(
      false,
    );
    expect(nomesNaOrdem(html, ["Antiga", "Recente", "Assumida"])).toEqual([
      "Recente",
      "Antiga",
      "Assumida",
    ]);
  });

  it("o chip Urgentes conta e filtra o mesmo conjunto", () => {
    const agora = Date.parse("2026-10-27T15:00:00.000Z");
    const todas = [recente, antiga, urgenteTarde, assumida, urgenteCedo];
    expect(
      todas
        .filter((c) => casaSituacaoDaLista(c, "urgentes", agora))
        .map((c) => c.id),
    ).toEqual(["3", "4"]);
    // Os outros chips seguem a regra de sempre.
    expect(
      todas
        .filter((c) => casaSituacaoDaLista(c, "em_atendimento", agora))
        .map((c) => c.id),
    ).toEqual(["5"]);
  });

  it("o chip Urgentes leva a forma e o tom do Urgente, com o rótulo escrito", () => {
    const html = lista([urgenteCedo]);
    const inicio = html.indexOf('aria-label="Filtrar por situação"');
    const botao = html.slice(inicio).match(/<button[^>]*>.*?<\/button>/)?.[0];
    expect(botao).toContain("lucide-bell-ring");
    expect(botao).toContain("Urgentes");
    expect(botao).toContain("hit-40");
    expect(botao).toContain("var(--alert-text)");
  });
});

describe("o tempo real da marca", () => {
  const maria = conversa("1", "Maria", {
    last_message_at: "2026-10-27T09:00:00.000Z",
  });
  const joao = conversa("2", "João", {
    last_message_at: "2026-10-27T14:00:00.000Z",
  });

  it("a marca nova sobe a conversa para o topo", () => {
    const antes = [joao, maria];
    const depois = aplicarMarcaNaLista(antes, {
      conversation_id: "1",
      desde: MARCA_CEDO.desde,
      encerrada_em: null,
    });
    expect(depois.map((c) => c.id)).toEqual(["1", "2"]);
    expect(depois[0]?.urgente).toEqual(MARCA_CEDO);
    expect(antes[1]?.urgente).toBeNull();
  });

  it("a marca encerrada tira o chip e volta a ordem de sempre", () => {
    const marcada = [{ ...maria, urgente: MARCA_CEDO }, joao];
    const depois = aplicarMarcaNaLista(marcada, {
      conversation_id: "1",
      desde: MARCA_CEDO.desde,
      encerrada_em: "2026-10-27T10:05:00.000Z",
    });
    expect(depois.map((c) => c.id)).toEqual(["2", "1"]);
    expect(depois.find((c) => c.id === "1")?.urgente).toBeNull();
  });

  it("nada muda: a mesma lista (o cache não redesenha)", () => {
    const marcada = [{ ...maria, urgente: MARCA_CEDO }, joao];
    expect(
      aplicarMarcaNaLista(marcada, {
        conversation_id: "1",
        desde: MARCA_CEDO.desde,
        encerrada_em: null,
      }),
    ).toBe(marcada);
    expect(
      aplicarMarcaNaLista(marcada, {
        conversation_id: "outra",
        desde: MARCA_CEDO.desde,
        encerrada_em: null,
      }),
    ).toBe(marcada);
    expect(aplicarMarcaNaLista(marcada, {})).toBe(marcada);
  });
});

describe("o chip Urgente no cartão", () => {
  it("abre a linha 3, antes do estado, com a dica e a forma do sino", () => {
    const html = cartao(conversa("1", "Maria", { urgente: MARCA_CEDO }));
    expect(html).toContain(`title="${DICA_DA_URGENCIA.podeAssumir}"`);
    const urgente = html.indexOf(">Urgente<");
    const estado = html.indexOf(">Aguardando você<");
    expect(urgente).toBeGreaterThan(-1);
    expect(estado).toBeGreaterThan(urgente);
    expect(html).toContain("lucide-bell-ring");
    // A cor do alerta (par validado pelo teste de contraste).
    expect(html).toContain("color:var(--alert-text)");
  });

  it("não aparece sem a marca, nem com a conversa já assumida", () => {
    expect(cartao(conversa("1", "Maria"))).not.toContain(">Urgente<");
    expect(
      cartao(
        conversa("1", "Maria", {
          status: "em_atendimento",
          assignee_user_id: EU,
          urgente: MARCA_CEDO,
        }),
      ),
    ).not.toContain(">Urgente<");
  });

  it("a dica chega ao leitor de tela como a descrição do cartão, não só pelo title", () => {
    const html = cartao(conversa("1", "Maria", { urgente: MARCA_CEDO }));
    // O botao do cartao aponta para a dica escondida (nada focavel cabe
    // dentro de um botao).
    const id = /<button[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    const escondida = new RegExp(
      `<span id="${id}" hidden="">([^<]*)</span>`,
    ).exec(html)?.[1];
    expect(escondida).toBe(DICA_DA_URGENCIA.podeAssumir);
    // Sem a marca, sem descricao nenhuma.
    expect(cartao(conversa("1", "Maria"))).not.toContain("aria-describedby");
  });

  it("a dica certa por papel: o Somente leitura não é mandado assumir", () => {
    const html = cartao(
      conversa("1", "Maria", { urgente: MARCA_CEDO }),
      false,
      false,
    );
    expect(html).not.toContain("Assuma para atender");
    expect(html).toContain(`title="${DICA_DA_URGENCIA.soAcompanha}"`);
    expect(html).toContain(`hidden="">${DICA_DA_URGENCIA.soAcompanha}<`);
    expect(dicaDaUrgencia(true)).toBe(DICA_DA_URGENCIA.podeAssumir);
    expect(dicaDaUrgencia(false)).toBe(DICA_DA_URGENCIA.soAcompanha);
    expect(DICA_DA_URGENCIA.podeAssumir).toContain("Assuma para atender.");
    expect(DICA_DA_URGENCIA.soAcompanha).not.toMatch(/assum/i);
  });

  it("a lista passa o papel para o cartão (o Inbox manda o canEdit do Atendimento)", () => {
    const html = renderToStaticMarkup(
      <ConversationList
        nomesDeEtapa={{ novo: "Novo" }}
        etiquetas={[]}
        conversations={[conversa("1", "Maria", { urgente: MARCA_CEDO })]}
        viewerId={EU}
        authorNames={{}}
        timezone="America/Fortaleza"
        agoraInicial={Date.parse("2026-10-27T15:00:00.000Z")}
        selectedId={null}
        onSelect={() => undefined}
        podeAssumir={false}
      />,
    );
    expect(html).toContain(DICA_DA_URGENCIA.soAcompanha);
    expect(html).not.toContain("Assuma para atender");
    const inbox = readFileSync(
      "app/(app)/atendimento/inbox-client.tsx",
      "utf8",
    );
    expect(inbox).toContain("podeAssumir={podeEditar}");
    expect(inbox).toMatch(
      /const podeEditar = canEdit\(viewerRole, "atendimento"\);/,
    );
  });

  it("a linha cede uma etiqueta para o chip (o resto vira o +N)", () => {
    expect(etiquetasNaLinha(false, false)).toBe(2);
    expect(etiquetasNaLinha(true, false)).toBe(1);
    expect(etiquetasNaLinha(false, true)).toBe(1);
    expect(etiquetasNaLinha(true, true)).toBe(0);
    const html = cartao(conversa("1", "Maria", { urgente: MARCA_CEDO }));
    expect(html).toContain(">Botox<");
    expect(html).not.toContain(">Retorno<");
    expect(html).toContain("+1");
  });
});

describe("o chip Urgente no cabeçalho do fio", () => {
  it("aparece com a dica focável, antes do estado", () => {
    const html = fio(conversa("1", "Maria Silva", { urgente: MARCA_CEDO }));
    const cabecalho = html.slice(0, html.indexOf("</header>"));
    expect(cabecalho).toContain(">Urgente<");
    expect(cabecalho).toContain('tabindex="0"');
    expect(cabecalho).toContain("hit-40");
    expect(cabecalho.indexOf(">Urgente<")).toBeLessThan(
      cabecalho.indexOf(">Aguardando você<"),
    );
  });

  it("some quando a conversa sai de Aguardando você", () => {
    const html = fio(
      conversa("1", "Maria Silva", {
        status: "em_atendimento",
        assignee_user_id: EU,
        urgente: MARCA_CEDO,
      }),
    );
    expect(html.slice(0, html.indexOf("</header>"))).not.toContain(">Urgente<");
  });

  it("o chip é o do mapa: Urgente, alerta, BellRing", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ChipDaUrgencia />
      </TooltipProvider>,
    );
    expect(html).toContain(URGENCIA_DA_CONVERSA.label);
    expect(html).toContain("lucide-bell-ring");
  });
});

describe("textos da urgência no Atendimento", () => {
  it("sem travessão e com linguagem de recepcionista", () => {
    for (const texto of [
      URGENCIA_DA_CONVERSA.label,
      DICA_DA_URGENCIA.podeAssumir,
      DICA_DA_URGENCIA.soAcompanha,
      "Urgentes",
    ]) {
      expect(texto).not.toMatch(/[—–]/);
      expect(texto).not.toMatch(/\b(handoff|tenant|opt-in)\b/i);
    }
  });
});
