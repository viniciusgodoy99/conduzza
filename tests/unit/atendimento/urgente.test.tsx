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
  estadoVisualDaConversa,
  URGENCIA_DA_CONVERSA,
} from "@/lib/design/status";
import {
  aplicarMarcaNaLista,
  fetchConversationById,
  fetchConversations,
  marcaDeUrgenciaDaLinha,
  ordemDoAtendimento,
  urgenteAberta,
  type ConversationListItem,
} from "@/lib/queries/conversations";
import { marcaDepoisDoEvento } from "@/lib/realtime/use-inbox-channel";

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

function cartao(item: ConversationListItem, numero = false): string {
  return renderToStaticMarkup(
    <ConversationCard
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
    expect(html).toContain(`title="${DICA_DA_URGENCIA}"`);
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
      DICA_DA_URGENCIA,
      "Urgentes",
    ]) {
      expect(texto).not.toMatch(/[—–]/);
      expect(texto).not.toMatch(/\b(handoff|tenant|opt-in)\b/i);
    }
  });
});
