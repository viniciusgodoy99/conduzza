import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A gaveta importa as Server Actions das secoes vizinhas (atividades, etapa,
// detalhe do contato); aqui so a linha de autor do resumo da conversa importa.
// Qualquer acao pedida vira um vi.fn().
function acoesFalsas() {
  return new Proxy(
    {},
    {
      get: (_alvo, chave) =>
        chave === "then" || typeof chave === "symbol" ? undefined : vi.fn(),
      has: (_alvo, chave) => chave !== "then",
    },
  );
}
vi.mock("@/app/(app)/leads/actions", () => acoesFalsas());
vi.mock("@/app/(app)/atividades/actions", () => acoesFalsas());
vi.mock("@/app/(app)/atendimento/actions", () => acoesFalsas());

import { AutorDaMensagemDoLead } from "@/components/leads/drawer-lead";
import type { MensagemDoLead } from "@/lib/queries/leads";

// Gaveta do lead, resumo da conversa (05/10/2026): a mensagem enviada direto
// pelo WhatsApp da clinica (pelo_celular) diz "Pelo WhatsApp" com o icone do
// aparelho, como a bolha do Atendimento. Antes ela sairia "Equipe" (a pessoa
// pelo celular, author 'usuario') ou "Sistema" (a resposta automatica do app,
// author 'sistema'), e a ultima se confundiria com a regua.

function autor(campos: Pick<MensagemDoLead, "author" | "pelo_celular">) {
  return renderToStaticMarkup(<AutorDaMensagemDoLead mensagem={campos} />);
}

describe("autor da mensagem na gaveta do lead", () => {
  it.each(["usuario", "sistema"] as const)(
    "pelo celular (author %s): Pelo WhatsApp com o ícone e a frase para o leitor de tela",
    (author) => {
      const html = autor({ author, pelo_celular: true });
      expect(html).toContain("Pelo WhatsApp");
      expect(html).toMatch(/<svg[^>]*lucide-smartphone/);
      expect(html).toContain(
        "Enviada direto pelo WhatsApp da clínica, fora do sistema",
      );
      expect(html).not.toContain("Equipe");
      expect(html).not.toContain("Sistema");
    },
  );

  it("sem pelo_celular, os rótulos de sempre", () => {
    expect(autor({ author: "usuario" })).toBe("<span>Equipe</span>");
    expect(autor({ author: "sistema", pelo_celular: false })).toBe(
      "<span>Sistema</span>",
    );
    expect(autor({ author: "paciente" })).toBe("<span>Paciente</span>");
    expect(autor({ author: "ia" })).toBe("<span>IA</span>");
  });
});
