import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { BellRing, LifeBuoy, Siren, UserRoundCheck } from "lucide-react";
import { describe, expect, it } from "vitest";

import * as status from "@/lib/design/status";

// Os icones da AG6a (desenho da AG6, secao 6, e docs/06 4.6; conferido em
// 28/10/2026 que nenhum dos tres era usado): a regra C18 e "um icone, um
// sentido, uma cor, em qualquer tela, dentro ou fora dos mapas".
// - BellRing, alert = SO a urgencia da conversa ("Urgente"): o chip do
//   cartao e do cabecalho, o chip de situacao "Urgentes", o aviso na tela e
//   o contador do menu em alerta. Nunca o Siren (o "Em risco" do Painel
//   geral).
// - LifeBuoy e UserRoundCheck: ladrilhos decorativos da Tela 6 (cartoes
//   "Urgência" e "Para quem vai a conversa"), neutros, nunca status.

const RAIZ = path.resolve(__dirname, "../../..");

function arquivosDeCodigo(pasta: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = path.join(pasta, nome);
    if (statSync(caminho).isDirectory()) {
      saida.push(...arquivosDeCodigo(caminho));
    } else if (/\.(ts|tsx)$/.test(nome)) {
      saida.push(caminho);
    }
  }
  return saida;
}

/** Arquivos que importam o icone do lucide-react, relativos a raiz. */
function quemImporta(icone: string): string[] {
  const importDoLucide = /import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g;
  return ["app", "components", "lib"]
    .flatMap((pasta) => arquivosDeCodigo(path.join(RAIZ, pasta)))
    .filter((arquivo) => {
      const codigo = readFileSync(arquivo, "utf8");
      return [...codigo.matchAll(importDoLucide)].some((casamento) =>
        (casamento[1] ?? "")
          // Os comentarios dentro do import (os blocos marcados) nao contam.
          .replace(/\/\/[^\n]*/g, "")
          .split(",")
          .map((parte) => parte.trim().replace(/^type\s+/, ""))
          .includes(icone),
      );
    })
    .map((arquivo) => path.relative(RAIZ, arquivo))
    .sort();
}

type Definicao = status.StatusDefinition;

function ehDefinicao(valor: unknown): valor is Definicao {
  return (
    typeof valor === "object" &&
    valor !== null &&
    "label" in valor &&
    "tone" in valor &&
    "icon" in valor
  );
}

/** Toda definicao de status exportada pelo mapa unico (soltas e em mapas). */
function definicoesDoMapa(): { nome: string; definicao: Definicao }[] {
  const saida: { nome: string; definicao: Definicao }[] = [];
  for (const [nome, valor] of Object.entries(status)) {
    if (ehDefinicao(valor)) {
      saida.push({ nome, definicao: valor });
    } else if (typeof valor === "object" && valor !== null) {
      for (const [chave, item] of Object.entries(valor)) {
        if (ehDefinicao(item)) {
          saida.push({ nome: `${nome}.${chave}`, definicao: item });
        }
      }
    }
  }
  return saida;
}

describe("o Urgente da AG6a", () => {
  it("é BellRing, alerta, com o rótulo escrito", () => {
    expect(status.URGENCIA_DA_CONVERSA).toEqual({
      label: "Urgente",
      tone: "alert",
      icon: BellRing,
    });
    expect(status.URGENCIA_DA_CONVERSA.icon).not.toBe(Siren);
  });

  it("no mapa único, o BellRing só aparece no Urgente (um sentido, uma cor)", () => {
    const comSino = definicoesDoMapa().filter(
      ({ definicao }) => definicao.icon === BellRing,
    );
    expect(comSino.map(({ nome }) => nome)).toEqual(["URGENCIA_DA_CONVERSA"]);
    for (const { definicao } of comSino) {
      expect(definicao.tone).toBe("alert");
    }
    // E o Urgente nao divide a forma com nenhum outro estado.
    const outrosIcones = new Set(
      definicoesDoMapa()
        .filter(({ nome }) => nome !== "URGENCIA_DA_CONVERSA")
        .map(({ definicao }) => definicao.icon),
    );
    expect(outrosIcones.has(BellRing)).toBe(false);
  });

  it("fora do mapa, o BellRing só no contador do menu e no aviso, sempre em alerta", () => {
    expect(quemImporta("BellRing")).toEqual([
      "components/shell/nav-badge.tsx",
      "components/shell/use-contadores-do-menu.ts",
      "lib/design/status.ts",
    ]);
    // O aviso na tela pinta o sino na cor do alerta.
    const vigia = readFileSync(
      path.join(RAIZ, "components/shell/use-contadores-do-menu.ts"),
      "utf8",
    );
    expect(vigia).toMatch(/createElement\(BellRing,\s*\{[^}]*text-alert-text/);
    // O contador so desenha o sino na variante de alerta.
    const pilula = readFileSync(
      path.join(RAIZ, "components/shell/nav-badge.tsx"),
      "utf8",
    );
    expect(pilula).toMatch(/const sino = emAlerta \?/);
  });

  it("o chip Urgentes da lista e o cartão da Tela 6 usam o mapa, não um ícone solto", () => {
    for (const arquivo of [
      "components/atendimento/conversation-list.tsx",
      "components/atendimento/conversation-card.tsx",
      "components/atendimento/thread.tsx",
      "components/agente/cartao-da-urgencia.tsx",
    ]) {
      const codigo = readFileSync(path.join(RAIZ, arquivo), "utf8");
      expect(codigo, arquivo).toContain("URGENCIA_DA_CONVERSA");
      expect(quemImporta("BellRing")).not.toContain(arquivo);
    }
  });
});

describe("os ladrilhos decorativos da AG6a", () => {
  it("LifeBuoy e UserRoundCheck só nos dois cartões novos da Tela 6", () => {
    expect(quemImporta("LifeBuoy")).toEqual([
      "components/agente/cartao-da-urgencia.tsx",
    ]);
    expect(quemImporta("UserRoundCheck")).toEqual([
      "components/agente/cartao-da-passagem.tsx",
    ]);
  });

  it("nunca viram status: nenhum mapa os usa", () => {
    const icones = new Set(
      definicoesDoMapa().map(({ definicao }) => definicao.icon),
    );
    expect(icones.has(LifeBuoy)).toBe(false);
    expect(icones.has(UserRoundCheck)).toBe(false);
  });

  it("o ladrilho é neutro (a cor do texto forte, nunca de família de status)", () => {
    const codigo = readFileSync(
      path.join(RAIZ, "components/agente/cartao-da-passagem.tsx"),
      "utf8",
    );
    const ladrilho =
      /export function LadrilhoDoCartao[\s\S]*?\n\}/.exec(codigo)?.[0] ?? "";
    expect(ladrilho).toContain("aria-hidden");
    expect(ladrilho).toContain("bg-surface-3");
    expect(ladrilho).toContain("text-text-strong");
    expect(ladrilho).not.toMatch(/(alert|warning|success|info|ai)-(text|bg)/);
  });
});
