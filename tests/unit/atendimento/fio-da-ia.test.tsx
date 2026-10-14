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

import { semAtendente } from "@/components/atendimento/conversation-list";
import { SystemEventCard } from "@/components/atendimento/message-bubble";
import { Thread } from "@/components/atendimento/thread";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TEXTO_DO_EVENTO_DA_IA } from "@/lib/domain/agente/config";
import { can, ROLES } from "@/lib/domain/permissions";
import type {
  ComplianceDecision,
  ConversationListItem,
  MessageItem,
} from "@/lib/queries/conversations";
import { chavesDoFioNoEvento } from "@/lib/realtime/use-inbox-channel";

// O fio da conversa com a IA (E3): os eventos novos saem pelo cartao de
// evento que ja existe; as decisoes da IA que nao carregaram viram aviso de
// erro (nunca um fio sem o bloqueio); o tempo real rele as decisoes e o
// Devolver; e "Sem atendente" deixa de contar a conversa da IA (D27).

const EU = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "33333333-3333-4333-8333-333333333333";

function conversa(
  campos: Partial<ConversationListItem> = {},
): ConversationListItem {
  return {
    id: CONVERSA,
    status: "aguardando_humano",
    assignee_user_id: null,
    unread_count: 0,
    awaiting_reply: true,
    last_message_at: "2026-10-13T14:30:00.000Z",
    last_inbound_at: "2026-10-13T14:10:00.000Z",
    last_preview: null,
    last_preview_kind: null,
    last_preview_author: null,
    last_preview_author_user_id: null,
    tags: [],
    whatsapp_account_id: null,
    contact: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Telefone da equipe",
      phone_e164: "+5584999990001",
      kind: "lead",
      funnel_stage: "novo",
      source_channel: null,
      source_campaign: null,
      first_contact_at: null,
    },
    ...campos,
  };
}

function evento(body: string): MessageItem {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    conversation_id: CONVERSA,
    direction: "saida",
    author: "sistema",
    author_user_id: null,
    content_type: "evento",
    body,
    media_url: null,
    transcript: null,
    is_internal_note: false,
    delivery_status: null,
    error_code: null,
    created_at: "2026-10-13T15:00:00.000Z",
    deleted_at: null,
    deleted_by: null,
    deleted_source: null,
    deleted_escopo: null,
    reply_to_message_id: null,
    reply_to_wa_message_id: null,
    reply_to: null,
  };
}

function fio(
  props: Partial<React.ComponentProps<typeof Thread>> = {},
  decisoes: ComplianceDecision[] = [],
): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <Thread
          conversation={conversa()}
          messages={[]}
          decisions={decisoes}
          isLoading={false}
          authorNames={{}}
          onBack={() => undefined}
          onToggleContext={() => undefined}
          footer={null}
          clinicId="acd9c539-585e-4f2a-a195-712c70099564"
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
          {...props}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("eventos da IA no fio", () => {
  it("saem pelo cartão de evento, com o texto gravado pelo banco", () => {
    for (const texto of [
      "A IA passou a conversa para a equipe: o paciente descreveu um sintoma.",
      "Alguém respondeu pelo celular. A IA parou de responder nesta conversa.",
      "O assistente foi desligado. A conversa voltou para a equipe.",
      "Chegou uma mensagem de grupo ou de status. A conversa voltou para a equipe.",
      "O aviso automático ao contato não foi enviado.",
      "Vinicius devolveu a conversa para a IA",
    ]) {
      const html = renderToStaticMarkup(
        <SystemEventCard
          message={evento(texto)}
          timezone="America/Fortaleza"
        />,
      );
      expect(html).toContain(texto);
      expect(html).toContain("12:00");
    }
  });
});

// Achado T6 da revisao do E3: o evento e gravado uma vez e todo papel le o
// fio, inclusive recepcao, profissional e leitura, que nao abrem
// Configuracoes. Nenhum evento da IA manda a pessoa para uma tela que ela
// nao abre; o "parada" diz so o que aconteceu.
describe("eventos da IA servem a todos os papéis (T6)", () => {
  it("o evento parada, palavra por palavra, sem mandar para Configurações", () => {
    const texto =
      "O assistente não atendeu esta mensagem: ele está parado nesta clínica.";
    expect(TEXTO_DO_EVENTO_DA_IA.parada).toBe(texto);
    const html = renderToStaticMarkup(
      <SystemEventCard
        message={evento(TEXTO_DO_EVENTO_DA_IA.parada)}
        timezone="America/Fortaleza"
      />,
    );
    expect(html).toContain(texto);
    expect(html).not.toContain("Configurações");
  });

  it("nenhum evento da IA aponta tela de configuração (papéis sem acesso leem o fio)", () => {
    // os papeis que leem o Atendimento e nao abrem Configuracoes existem
    const semConfiguracoes = ROLES.filter(
      (papel) =>
        can(papel, "atendimento") !== "nada" &&
        can(papel, "configuracoes") === "nada",
    );
    expect(semConfiguracoes.length).toBeGreaterThan(0);
    for (const [motivo, texto] of Object.entries(TEXTO_DO_EVENTO_DA_IA)) {
      expect(texto, motivo).not.toMatch(/Configura[çc][õo]es/);
      expect(texto, motivo).not.toMatch(/\bVeja\b/);
      expect(texto, motivo).not.toMatch(/[—–]/);
    }
  });
});

describe("decisões da IA no fio", () => {
  it("leitura que falhou: o aviso de erro, com Tentar de novo", () => {
    const html = fio({
      erroNasDecisoes: true,
      aoRecarregarDecisoes: () => undefined,
    });
    expect(html).toContain("Não foi possível carregar o registro da IA.");
    expect(html).toContain("Tentar de novo</button>");
  });

  it("sem erro: nada de aviso", () => {
    expect(fio()).not.toContain("Não foi possível carregar o registro da IA.");
  });

  it("o cartão de bloqueio segue o papel: desabilitado por padrão, aberto ao super admin", () => {
    const decisao: ComplianceDecision = {
      id: "55555555-5555-4555-8555-555555555555",
      message_id: null,
      compliance_rule: "medicamento",
      escalation_reason: "conformidade",
      created_at: "2026-10-13T15:00:00.000Z",
    };
    const botao = (html: string) => {
      const indice = html.indexOf("Ver o que a IA ia responder</button>");
      const inicio = html.lastIndexOf("<button", indice);
      return html.slice(inicio, html.indexOf(">", inicio) + 1);
    };
    expect(botao(fio({}, [decisao]))).toContain('disabled=""');
    expect(botao(fio({ podeVerRascunho: true }, [decisao]))).not.toContain(
      'disabled=""',
    );
  });
});

describe("tempo real do fio", () => {
  it("evento de mensagem: o fio, as decisões e o Devolver da conversa", () => {
    expect(chavesDoFioNoEvento(CONVERSA, "message")).toEqual([
      ["messages", CONVERSA],
      ["decisions", CONVERSA],
      ["devolver-para-ia", CONVERSA],
    ]);
  });

  it("evento de conversa: as decisões e o Devolver (o fio vem pela mensagem)", () => {
    expect(chavesDoFioNoEvento(CONVERSA, "conversation")).toEqual([
      ["decisions", CONVERSA],
      ["devolver-para-ia", CONVERSA],
    ]);
  });
});

describe("Sem atendente sem a IA (D27)", () => {
  it("a conversa da IA não conta; a sem responsável conta; resolvida e com alguém, não", () => {
    expect(
      semAtendente(
        conversa({ status: "ia_atendendo", assignee_user_id: null }),
      ),
    ).toBe(false);
    expect(
      semAtendente(
        conversa({ status: "aguardando_humano", assignee_user_id: null }),
      ),
    ).toBe(true);
    expect(
      semAtendente(conversa({ status: "resolvida", assignee_user_id: null })),
    ).toBe(false);
    expect(
      semAtendente(
        conversa({ status: "em_atendimento", assignee_user_id: EU }),
      ),
    ).toBe(false);
  });
});
