import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O Novo lead com a pergunta OPCIONAL da autorizacao para receber mensagens
// (decisao do dono em 20/10/2026): as mesmas opcoes da declaracao da
// importacao, "Não registrar agora" ja escolhido e a frase que diz o que
// acontece sem autorizacao. A regra ("Outra origem" exige observacao) e a
// gravacao estao em novo-lead-com-autorizacao.test.ts.
//
// O Select do Radix nao desenha as opcoes no HTML do servidor: aqui ele vira
// uma lista simples, para as opcoes aparecerem.

vi.mock("@/app/(app)/leads/actions", () => ({ criarLeadAction: vi.fn() }));
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
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, children }: { value?: string; children: ReactNode }) => (
    <div data-select="" data-valor={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ id, children }: { id?: string; children: ReactNode }) => (
    <button type="button" id={id}>
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
}));

const { ModalNovoLead } = await import("@/components/leads/modal-novo-lead");

function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function modal(): string {
  return renderToStaticMarkup(
    <ModalNovoLead
      aberto
      responsaveis={[]}
      onFechar={() => undefined}
      aoCriar={() => undefined}
    />,
  );
}

describe("Novo lead: a autorização para receber mensagens", () => {
  it("a pergunta é opcional e começa em Não registrar agora", () => {
    const html = modal();
    expect(texto(html)).toContain(
      "Autorização para receber mensagens (opcional)",
    );
    const select =
      /<div data-select="" data-valor="([^"]*)"><button type="button" id="lead-autorizacao"/.exec(
        html,
      );
    expect(select?.[1]).toBe("__sem__");
    expect(texto(html)).toContain(
      "Sem autorização registrada, a clínica não envia mensagens para este contato. Dá para registrar depois, na ficha.",
    );
  });

  it("as opções são as da declaração da importação", () => {
    const html = modal();
    // So a lista do select da autorizacao (Origem e Responsavel tambem tem
    // a opcao vazia).
    const lista =
      /<button type="button" id="lead-autorizacao">.*?<ul>(.*?)<\/ul>/.exec(
        html,
      )?.[1] ?? "";
    const opcoes = [
      ...lista.matchAll(/<li data-opcao="([^"]+)">([^<]*)<\/li>/g),
    ].map((achado) => [achado[1], achado[2]]);
    expect(opcoes).toEqual([
      ["__sem__", "Não registrar agora"],
      ["formulario_site", "Formulário do site"],
      ["anuncio_ctwa", "Anúncio com clique para o WhatsApp"],
      ["recepcao", "Cadastro presencial na recepção"],
      ["outra", "Outra origem (descreva)"],
    ]);
  });

  it("sem opção escolhida, não pede observação; nada com travessão", () => {
    const html = modal();
    expect(html).not.toContain("lead-autorizacao-observacao");
    expect(texto(html)).not.toMatch(/[\u2013\u2014]/);
  });
});
