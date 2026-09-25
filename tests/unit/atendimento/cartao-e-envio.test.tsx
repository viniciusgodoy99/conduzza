import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BolhaEmVoo } from "@/components/atendimento/bolha-em-voo";
import {
  ConversationCard,
  prefixoDaPrevia,
  rotuloDaHora,
} from "@/components/atendimento/conversation-card";
import { estadoVisualDaConversa } from "@/lib/design/status";
import type { EnvioEmVoo } from "@/lib/domain/envios-em-voo";
import type { ConversationListItem } from "@/lib/queries/conversations";

// Revisao da leva 2, grupo atendimento:
// - L2: a previa do cartao diz quem escreveu ("Voce:", "Clinica:", "IA:") e
//   a hora diz de que mensagem e; previa longa nao empurra a hora para fora.
// - L18: a bolha de envio em voo nao usa icone reservado (Clock e do status
//   Aguardando; TriangleAlert e do status Faltou).

const EU = "11111111-1111-4111-8111-111111111111";
const COLEGA = "22222222-2222-4222-8222-222222222222";

function conversa(
  campos: Partial<ConversationListItem> = {},
): ConversationListItem {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    status: "em_atendimento",
    assignee_user_id: EU,
    unread_count: 0,
    awaiting_reply: false,
    last_message_at: "2026-09-24T14:30:00.000Z",
    last_inbound_at: "2026-09-24T12:10:00.000Z",
    last_preview: "Custa R$ 200.",
    last_preview_kind: "texto",
    last_preview_author: "usuario",
    last_preview_author_user_id: EU,
    tags: [],
    contact: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Maria Teste",
      phone_e164: "+5584999990000",
      kind: "paciente",
      funnel_stage: "novo",
      source_channel: null,
      source_campaign: null,
      first_contact_at: null,
    },
    ...campos,
  };
}

describe("prefixo de autoria da prévia (L2)", () => {
  it("resposta de quem olha sai como Você", () => {
    expect(prefixoDaPrevia(conversa(), EU)).toBe("Você:");
  });

  it("resposta de outra pessoa da equipe sai como Clínica", () => {
    expect(
      prefixoDaPrevia(conversa({ last_preview_author_user_id: COLEGA }), EU),
    ).toBe("Clínica:");
  });

  it("envio automático sai como Clínica, e a IA como IA", () => {
    expect(
      prefixoDaPrevia(
        conversa({
          last_preview_author: "sistema",
          last_preview_author_user_id: null,
        }),
        EU,
      ),
    ).toBe("Clínica:");
    expect(
      prefixoDaPrevia(
        conversa({
          last_preview_author: "ia",
          last_preview_author_user_id: null,
        }),
        EU,
      ),
    ).toBe("IA:");
  });

  it("fala do paciente, ou conversa sem mensagem visível, sem prefixo", () => {
    expect(
      prefixoDaPrevia(
        conversa({
          last_preview_author: "paciente",
          last_preview_author_user_id: null,
        }),
        EU,
      ),
    ).toBeNull();
    expect(
      prefixoDaPrevia(
        conversa({
          last_preview: null,
          last_preview_kind: null,
          last_preview_author: null,
          last_preview_author_user_id: null,
        }),
        EU,
      ),
    ).toBeNull();
  });
});

describe("rótulo da hora do cartão (L2)", () => {
  it("diz que a hora é da última fala do paciente", () => {
    expect(rotuloDaHora(conversa(), "09:10")).toBe(
      "Última mensagem do paciente às 09:10",
    );
    expect(rotuloDaHora(conversa(), "12/09")).toBe(
      "Última mensagem do paciente em 12/09",
    );
  });

  it("sem fala do paciente, é a última mensagem da conversa", () => {
    expect(rotuloDaHora(conversa({ last_inbound_at: null }), "09:10")).toBe(
      "Última mensagem às 09:10",
    );
  });
});

function cartao(item: ConversationListItem): string {
  return renderToStaticMarkup(
    <ConversationCard
      conversation={item}
      estado={estadoVisualDaConversa(item, {
        viewerId: EU,
        authorNames: { [EU]: "Eu Mesma", [COLEGA]: "Colega" },
      })}
      reserva="Paciente · Novo contato"
      etiquetas={[]}
      selected={false}
      viewerId={EU}
      timezone="America/Fortaleza"
      agora={Date.parse("2026-09-24T15:00:00.000Z")}
      onSelect={() => undefined}
    />,
  );
}

describe("cartão da conversa (L2 e ajuste da captura)", () => {
  it("mostra o prefixo em texto antes da prévia", () => {
    const html = cartao(conversa());
    expect(html).toContain("Você:");
    expect(html.indexOf("Você:")).toBeLessThan(html.indexOf("Custa R$ 200."));
  });

  it("a hora vem com o rótulo acessível de que mensagem ela é", () => {
    const html = cartao(conversa());
    // 12:10Z e 09:10 em Fortaleza (UTC-3), hoje.
    expect(html).toContain(">09:10<");
    expect(html).toContain("Última mensagem do paciente às 09:10");
  });

  it("a coluna do texto é limitada: prévia longa trunca e a hora fica", () => {
    const html = cartao(conversa({ last_preview: "x".repeat(120) }));
    expect(html).toContain("grid-cols-[minmax(0,1fr)]");
    expect(html).toContain("09:10");
  });
});

function envio(campos: Partial<EnvioEmVoo> = {}): EnvioEmVoo {
  return {
    chave: "k1",
    conversationId: "33333333-3333-4333-8333-333333333333",
    corpo: "Já te atendo por aqui!",
    ehNota: false,
    citandoId: null,
    idsAntes: new Set(),
    apartirDe: "",
    estado: "enviando",
    ...campos,
  };
}

function bolha(e: EnvioEmVoo): string {
  return renderToStaticMarkup(
    <BolhaEmVoo
      envio={e}
      aoTentarDeNovo={() => undefined}
      aoDescartar={() => undefined}
    />,
  );
}

describe("bolha de envio em voo (L18)", () => {
  it("enviando usa SendHorizonal, nunca o Clock do status Aguardando", () => {
    const html = bolha(envio());
    expect(html).toMatch(/lucide-send-horizontal/);
    expect(html).not.toMatch(/lucide-clock/);
    expect(html).toContain("enviando");
    expect(html).toContain("rounded-bubble");
  });

  it("falha usa OctagonAlert em alerta, nunca o TriangleAlert de Faltou", () => {
    const html = bolha(envio({ estado: "falhou", erro: "Sem conexão." }));
    expect(html).toMatch(/lucide-octagon-alert/);
    expect(html).not.toMatch(/lucide-triangle-alert/);
    expect(html).toContain("Não enviada");
    expect(html).toContain("text-alert-text");
  });
});
