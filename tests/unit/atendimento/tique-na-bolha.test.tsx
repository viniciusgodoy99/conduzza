import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MessageBubble } from "@/components/atendimento/message-bubble";
import type { MessageItem } from "@/lib/queries/conversations";

// Tique de entrega na bolha enviada, como no WhatsApp (pedido do dono em
// 06/10/2026): um tique enviada, dois entregue, dois azuis lida, com o texto
// na dica e para o leitor de tela.

const ANA = "22222222-2222-4222-8222-222222222222";

function mensagem(campos: Partial<MessageItem> = {}): MessageItem {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    direction: "saida",
    author: "usuario",
    author_user_id: ANA,
    content_type: "texto",
    body: "Bom dia! Seu retorno é amanhã às 9h.",
    media_url: null,
    transcript: null,
    is_internal_note: false,
    delivery_status: "enviada",
    error_code: null,
    created_at: "2026-10-06T12:00:00.000Z",
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

function bolha(message: MessageItem): string {
  return renderToStaticMarkup(
    <MessageBubble
      message={message}
      authorName="Ana"
      authorNames={{ [ANA]: "Ana" }}
      timezone="America/Fortaleza"
    />,
  );
}

describe("tique na bolha enviada", () => {
  it("enviada: um tique, na cor de apoio, com o texto Enviada", () => {
    const html = bolha(mensagem());
    expect(html).toContain('data-tique="enviada"');
    expect(html).toContain("lucide-check ");
    expect(html).not.toContain("lucide-check-check");
    expect(html).toContain('title="Enviada"');
    expect(html).toContain(", Enviada");
    expect(html).not.toContain("--tique-lido");
  });

  it("entregue: dois tiques, ainda na cor de apoio", () => {
    const html = bolha(mensagem({ delivery_status: "entregue" }));
    expect(html).toContain('data-tique="entregue"');
    expect(html).toContain("lucide-check-check");
    expect(html).toContain('title="Entregue"');
    expect(html).not.toContain("--tique-lido");
  });

  it("lida: dois tiques azuis, e o texto Lida", () => {
    const html = bolha(mensagem({ delivery_status: "lida" }));
    expect(html).toContain('data-tique="lida"');
    expect(html).toContain("lucide-check-check");
    expect(html).toContain("text-(--tique-lido)");
    expect(html).toContain('title="Lida"');
    expect(html).toContain(", Lida");
  });

  it("mensagem do paciente e nota interna não têm tique", () => {
    expect(
      bolha(mensagem({ direction: "entrada", author: "paciente" })),
    ).not.toContain("data-tique");
    expect(bolha(mensagem({ is_internal_note: true }))).not.toContain(
      "data-tique",
    );
  });

  it("a que falhou não tem tique: tem o aviso Não foi entregue", () => {
    const html = bolha(mensagem({ delivery_status: "falhou" }));
    expect(html).not.toContain("data-tique");
    expect(html).toContain("Não foi entregue");
  });
});
