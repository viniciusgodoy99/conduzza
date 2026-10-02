import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ContagensDoDia } from "@/components/confirmacoes/cartoes-do-dia";

// Os cinco cartoes do topo da Tela 2 (Fase 3, 02/10/2026) no cartao de
// metrica unico: os rotulos exatos (o e2e acha cada um por role=group), o
// destaque lime so em Confirmadas, o "Cobrar" secundario dentro de
// Aguardando com a mesma regra de permissao de antes, o rodape do motivo mais
// comum e o fim do cartao Recuperadas.

// A dica vira atributo, para o teste ler o porque do botao desabilitado.
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

const { CartoesDoDia } =
  await import("@/components/confirmacoes/cartoes-do-dia");

const BASE: ContagensDoDia = {
  total: 147,
  confirmadas: 128,
  aguardando: 12,
  canceladas: 6,
  cobraveis: 9,
  naoEnviadas: 1,
  motivos: { tipo: "unico", rotulo: "Sem autorização" },
};

function html(
  contagens: Partial<ContagensDoDia> = {},
  extra: { podeCobrar?: boolean; cobrando?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <CartoesDoDia
      contagens={{ ...BASE, ...contagens }}
      podeCobrar={extra.podeCobrar ?? true}
      dicaSemPermissao="Seu perfil não pode alterar confirmações"
      cobrando={extra.cobrando ?? false}
      onCobrarTodos={() => undefined}
    />,
  );
}

/** Trecho do markup do cartao (role=group) cujo rotulo e `rotulo`. */
function cartao(markup: string, rotulo: string): string {
  const grupos = markup.split('<div role="group"').slice(1);
  const achado = grupos.filter((grupo) =>
    new RegExp(`<span id="[^"]+"[^>]*>${rotulo}(<|$)`).test(grupo),
  );
  expect(achado, `cartão ${rotulo}`).toHaveLength(1);
  return achado[0] as string;
}

function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("CartoesDoDia", () => {
  it("cinco cartões, com os rótulos exatos e sem Recuperadas", () => {
    const markup = html();
    expect(markup.split('<div role="group"')).toHaveLength(6);
    for (const rotulo of [
      "Agendadas",
      "Confirmadas",
      "Aguardando",
      "Canceladas",
      "Não enviadas",
    ]) {
      cartao(markup, rotulo);
    }
    expect(markup).not.toContain("Recuperadas");
    expect(markup).not.toContain("Pendentes<");
    expect(texto(markup)).not.toMatch(/[–—]/);
  });

  it("Agendadas é o total; Confirmadas é o único destaque, com % do total", () => {
    const markup = html();
    expect(texto(cartao(markup, "Agendadas"))).toContain("147");
    const confirmadas = cartao(markup, "Confirmadas");
    expect(confirmadas).toContain("bg-primary");
    expect(texto(confirmadas)).toContain("128");
    expect(texto(confirmadas)).toContain("87,1% do total");
    // Um lime por grade: so o cartao Confirmadas.
    expect(markup.match(/bg-primary /g)).toHaveLength(1);
    expect(texto(cartao(markup, "Canceladas"))).toContain("4,1% do total");
  });

  it("dia sem consulta não inventa percentual", () => {
    const markup = html({
      total: 0,
      confirmadas: 0,
      aguardando: 0,
      canceladas: 0,
      cobraveis: 0,
      naoEnviadas: 0,
      motivos: { tipo: "nenhum" },
    });
    expect(markup).not.toContain("% do total");
    expect(markup).not.toContain("Motivo");
  });

  it("os cartões que são status têm ícone com a cor da família", () => {
    const markup = html();
    expect(cartao(markup, "Aguardando")).toContain("lucide-clock");
    expect(cartao(markup, "Canceladas")).toContain("lucide-circle-x");
    expect(cartao(markup, "Não enviadas")).toContain("lucide-mail-warning");
    expect(cartao(markup, "Agendadas")).toContain("lucide-calendar-days");
    // Destaque sem icone (C18).
    expect(cartao(markup, "Confirmadas")).not.toContain("<svg");
  });

  it("Não enviadas mostra o motivo mais comum no rodapé", () => {
    expect(texto(cartao(html(), "Não enviadas"))).toContain(
      "Motivo: Sem autorização",
    );
    expect(
      texto(
        cartao(
          html({
            naoEnviadas: 3,
            motivos: { tipo: "mais_comum", rotulo: "WhatsApp desconectado" },
          }),
          "Não enviadas",
        ),
      ),
    ).toContain("Mais comum: WhatsApp desconectado");
    expect(
      texto(
        cartao(
          html({ naoEnviadas: 2, motivos: { tipo: "variados" } }),
          "Não enviadas",
        ),
      ),
    ).toContain("Motivos variados");
  });
});

describe("Cobrar dentro de Aguardando", () => {
  it("secundário (outline), com o rótulo pela quantidade", () => {
    const aguardando = cartao(html(), "Aguardando");
    expect(aguardando).toContain("Cobrar todas as 9");
    expect(aguardando).toContain("border-border-strong");
    expect(aguardando).not.toContain("bg-primary");
    expect(aguardando).not.toContain('disabled=""');
    expect(cartao(html({ cobraveis: 1 }), "Aguardando")).toContain(
      "Cobrar a pendente",
    );
  });

  it("sem permissão: visível, desabilitado e com a dica do perfil", () => {
    const aguardando = cartao(html({}, { podeCobrar: false }), "Aguardando");
    expect(aguardando).toContain(
      'data-dica="Seu perfil não pode alterar confirmações"',
    );
    expect(aguardando).toContain('disabled=""');
  });

  it("nada para cobrar: a dica diz o porquê", () => {
    expect(
      cartao(html({ cobraveis: 0, aguardando: 0 }), "Aguardando"),
    ).toContain(
      'data-dica="Nenhuma consulta aguardando confirmação neste dia"',
    );
    const semAutorizacao = cartao(html({ cobraveis: 0 }), "Aguardando");
    expect(semAutorizacao).toContain("Nenhuma pendente pode ser cobrada agora");
    expect(semAutorizacao).toContain("Cobrar pendentes");
    expect(semAutorizacao).toContain('disabled=""');
  });

  it("enviando: desabilitado com Enviando...", () => {
    const aguardando = cartao(html({}, { cobrando: true }), "Aguardando");
    expect(aguardando).toContain("Enviando...");
    expect(aguardando).toContain('disabled=""');
  });
});
