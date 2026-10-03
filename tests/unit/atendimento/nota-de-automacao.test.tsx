import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O fio importa as acoes do cabecalho (Server Actions); aqui so o rotulo e a
// bolha importam.
vi.mock("@/app/(app)/atendimento/actions", () => ({
  assumirConversaAction: vi.fn(),
  reabrirConversaAction: vi.fn(),
  resolverConversaAction: vi.fn(),
  transferirConversaAction: vi.fn(),
}));

import { MessageBubble } from "@/components/atendimento/message-bubble";
import {
  AUTOR_DA_AUTOMACAO,
  autorDaBolha,
} from "@/components/atendimento/thread";
import type { MessageItem } from "@/lib/queries/conversations";

// A nota interna que uma automacao de fluxo deixa na conversa (docs/04 secao
// 12.8: author 'sistema', sem author_user_id) aparecia so com a pele ambar,
// sem a linha de autor, porque o fio so assinava mensagem de pessoa ou da IA.
// Agora ela sai assinada "Automação", com o cadeado e "Nota interna, o
// paciente não vê": icone, texto e cor.

const ANA = "22222222-2222-4222-8222-222222222222";
const NOMES = { [ANA]: "Ana Recepção" };

function mensagem(campos: Partial<MessageItem> = {}): MessageItem {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    direction: "saida",
    author: "sistema",
    author_user_id: null,
    content_type: "texto",
    body: "Lead entrou em Avaliação marcada.",
    media_url: null,
    transcript: null,
    is_internal_note: true,
    delivery_status: null,
    error_code: null,
    created_at: "2026-10-02T13:00:00.000Z",
    deleted_at: null,
    deleted_by: null,
    deleted_source: null,
    deleted_escopo: null,
    reply_to_message_id: null,
    reply_to_wa_message_id: null,
    reply_to: null,
    ...campos,
  };
}

describe("autor da bolha", () => {
  it("nota interna sem pessoa (a da automação) assina Automação", () => {
    expect(autorDaBolha(mensagem(), NOMES)).toBe(AUTOR_DA_AUTOMACAO);
    expect(AUTOR_DA_AUTOMACAO).toBe("Automação");
  });

  it("mensagem automática ao paciente (régua, confirmação) segue sem linha", () => {
    expect(
      autorDaBolha(mensagem({ is_internal_note: false }), NOMES),
    ).toBeNull();
  });

  it("pessoa e IA continuam como antes", () => {
    expect(
      autorDaBolha(mensagem({ author: "usuario", author_user_id: ANA }), NOMES),
    ).toBe("Ana Recepção");
    expect(
      autorDaBolha(
        mensagem({
          author: "usuario",
          author_user_id: "33333333-3333-4333-8333-333333333333",
        }),
        NOMES,
      ),
    ).toBeNull();
    expect(
      autorDaBolha(mensagem({ author: "ia", is_internal_note: false }), NOMES),
    ).toBe("Assistente");
  });
});

describe("bolha da nota de automação", () => {
  const html = renderToStaticMarkup(
    <MessageBubble
      message={mensagem()}
      authorName={autorDaBolha(mensagem(), NOMES)}
      authorNames={NOMES}
    />,
  );

  it("linha de autor em texto: Automação · Nota interna, o paciente não vê", () => {
    expect(html).toContain("Automação");
    expect(html).toContain(" · Nota interna, o paciente não vê");
  });

  it("com o cadeado da nota, não só a cor", () => {
    // A linha de autor vem antes da bolha e tem o icone (svg) dentro dela.
    const linha = html.slice(0, html.indexOf("data-bolha"));
    expect(linha).toMatch(/text-warning-text[^>]*>\s*<svg[^>]*lucide-lock/);
  });
});
