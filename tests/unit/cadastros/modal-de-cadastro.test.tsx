import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Modal central de cadastro (decisao do dono de 29/09/2026: sai o painel
// lateral, entra o modal no centro em todos os cadastros). O Dialog do Radix
// renderiza num portal, que nao existe no servidor; aqui ele vira marcacao
// simples para conferir a montagem: larguras 520 e 640, so o corpo rola,
// aviso e erro fixos acima do rodape, rodape so quando ha acao.

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-parte="dialog">{children}</div> : null,
  DialogContent: ({ className, children, ...resto }: ComponentProps<"div">) => (
    <div
      data-parte="conteudo"
      className={className}
      data-sem-descricao={
        "aria-describedby" in resto && resto["aria-describedby"] === undefined
          ? "sim"
          : "nao"
      }
    >
      {children}
    </div>
  ),
  DialogHeader: ({ className, children }: ComponentProps<"div">) => (
    <div data-parte="cabecalho" className={className}>
      {children}
    </div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p data-parte="descricao">{children}</p>
  ),
  DialogFooter: ({ className, children }: ComponentProps<"div">) => (
    <div data-parte="rodape" className={className}>
      {children}
    </div>
  ),
}));

import {
  LARGURA_DO_MODAL,
  PainelDeCadastro,
} from "@/components/cadastros/comum";
import { cn } from "@/lib/utils";

function render(
  props: Partial<ComponentProps<typeof PainelDeCadastro>> = {},
): string {
  return renderToStaticMarkup(
    <PainelDeCadastro
      aberto
      aoMudarAberto={() => undefined}
      titulo="Novo convênio"
      {...props}
    >
      <p>corpo do formulario</p>
    </PainelDeCadastro>,
  );
}

function classesDe(html: string, parte: string): string[] {
  const achado = new RegExp(`data-parte="${parte}" class="([^"]*)"`).exec(html);
  return achado?.[1]?.split(" ") ?? [];
}

describe("PainelDeCadastro como modal central", () => {
  it("fechado nao renderiza nada", () => {
    expect(render({ aberto: false })).toBe("");
  });

  it("normal tem 520px e larga tem 640px", () => {
    const normal = classesDe(render(), "conteudo");
    expect(normal).toContain(LARGURA_DO_MODAL.normal);
    expect(normal).not.toContain(LARGURA_DO_MODAL.larga);
    expect(LARGURA_DO_MODAL.normal).toBe("sm:max-w-[520px]");

    const larga = classesDe(render({ larga: true }), "conteudo");
    expect(larga).toContain(LARGURA_DO_MODAL.larga);
    expect(larga).not.toContain(LARGURA_DO_MODAL.normal);
    expect(LARGURA_DO_MODAL.larga).toBe("sm:max-w-[640px]");
  });

  it("o modal nao rola inteiro: cabecalho e rodape ficam, o corpo rola", () => {
    const html = render({ rodape: <button>Salvar</button> });
    const conteudo = classesDe(html, "conteudo");
    expect(conteudo).toEqual(
      expect.arrayContaining(["flex", "flex-col", "overflow-hidden", "p-0"]),
    );
    expect(classesDe(html, "cabecalho")).toContain("shrink-0");
    expect(classesDe(html, "rodape")).toContain("shrink-0");
    expect(html).toMatch(
      /class="[^"]*min-h-0[^"]*overflow-y-auto[^"]*"><p>corpo do formulario<\/p>/,
    );
  });

  it("titulo sempre; descricao so quando existe, sem apontar para o vazio", () => {
    const sem = render();
    expect(sem).toContain("<h2>Novo convênio</h2>");
    expect(sem).not.toContain('data-parte="descricao"');
    expect(sem).toContain('data-sem-descricao="sim"');

    const com = render({ descricao: "Planos que a clínica atende" });
    expect(com).toContain(
      '<p data-parte="descricao">Planos que a clínica atende</p>',
    );
    expect(com).toContain('data-sem-descricao="nao"');
  });

  it("aviso e erro ficam fora do corpo, logo acima do rodape", () => {
    const html = render({
      aviso: <p>pergunta de confirmacao</p>,
      erro: "Não foi possível salvar o convênio.",
      rodape: <button>Salvar</button>,
    });
    const corpo = html.indexOf("corpo do formulario");
    const aviso = html.indexOf("pergunta de confirmacao");
    const erro = html.indexOf("Não foi possível salvar o convênio.");
    const rodape = html.indexOf('data-parte="rodape"');
    expect(corpo).toBeGreaterThan(-1);
    expect(aviso).toBeGreaterThan(corpo);
    expect(erro).toBeGreaterThan(aviso);
    expect(rodape).toBeGreaterThan(erro);
    // O erro interrompe (role alert), nunca so cor.
    expect(html).toMatch(/role="alert"[^>]*>[\s\S]*Não foi possível salvar/);
  });

  it("sem rodape (modo so leitura) nao ha barra de Salvar", () => {
    const html = render();
    expect(html).not.toContain('data-parte="rodape"');
    expect(html).not.toContain('role="alert"');
  });
});

// As classes do modal passam pelo cn por cima das do Dialog padrao. Se o
// merge mantivesse as duas, o modal voltaria a rolar inteiro (grid com
// overflow-y-auto) ou o rodape sairia deslocado (margem negativa do rodape
// padrao, que conta com o padding de 20px que o modal de cadastro tira).
describe("merge de classes do modal de cadastro", () => {
  it("o layout em coluna vence o grid que rola do Dialog padrao", () => {
    const classes = cn(
      "grid max-h-[86vh] gap-4 overflow-y-auto p-5 sm:max-w-[480px]",
      "flex flex-col gap-0 overflow-hidden p-0",
      LARGURA_DO_MODAL.normal,
    ).split(" ");
    expect(classes).toEqual(
      expect.arrayContaining([
        "max-h-[86vh]",
        "flex",
        "flex-col",
        "gap-0",
        "overflow-hidden",
        "p-0",
        "sm:max-w-[520px]",
      ]),
    );
    for (const perdida of [
      "grid",
      "gap-4",
      "overflow-y-auto",
      "p-5",
      "sm:max-w-[480px]",
    ]) {
      expect(classes).not.toContain(perdida);
    }
  });

  it("o rodape perde a margem negativa do Dialog padrao", () => {
    const classes = cn("-mx-5 -mb-5 px-5 py-3.5", "m-0 shrink-0").split(" ");
    expect(classes).not.toContain("-mx-5");
    expect(classes).not.toContain("-mb-5");
    expect(classes).toEqual(expect.arrayContaining(["m-0", "px-5", "py-3.5"]));
  });
});
