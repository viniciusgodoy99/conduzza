import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { Hourglass, ScanText } from "lucide-react";
import { describe, expect, it } from "vitest";

import * as daAba from "@/components/agente/whatsapp/agente-de-ia";
import * as status from "@/lib/design/status";

// Os icones da AG6b (desenho da AG6b, secao 6, e docs/06 4.6): a regra C18
// e "um icone, um sentido, uma cor, em qualquer tela, dentro ou fora dos
// mapas".
// - ScanText, tom ia = SO a linha "Lido pelo assistente" embaixo da foto e
//   do documento do paciente no Atendimento (dono novo e unico, conferido
//   em 30/10/2026 que ninguem usava). Nao e status: nenhum mapa o usa.
// - O chip "Sem áudio, foto e documento" do telefone da equipe reaproveita o
//   Hourglass warning (pendencia), o mesmo par do "Não aciona o assistente":
//   nenhum icone novo, nenhuma cor nova.

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

/** Toda definicao de status exportada por um modulo (soltas e em mapas). */
function definicoesDe(
  modulo: Record<string, unknown>,
): { nome: string; definicao: Definicao }[] {
  const saida: { nome: string; definicao: Definicao }[] = [];
  for (const [nome, valor] of Object.entries(modulo)) {
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

const ARQUIVO_DA_LEITURA =
  "components/atendimento/media/leitura-do-assistente.tsx";

describe("o ScanText da AG6b", () => {
  // Varre app, components e lib inteiros: com a maquina ocupada, passa dos
  // 5 s padrao.
  it(
    "só a linha Lido pelo assistente importa o ScanText",
    { timeout: 30_000 },
    () => {
      expect(quemImporta("ScanText")).toEqual([ARQUIVO_DA_LEITURA]);
    },
  );

  it("sempre no tom ia, e só na linha do arquivo lido (nunca no áudio)", () => {
    const codigo = readFileSync(path.join(RAIZ, ARQUIVO_DA_LEITURA), "utf8");
    const usos = [...codigo.matchAll(/<ScanText[^>]*\/>/g)].map((u) => u[0]);
    expect(usos).toHaveLength(1);
    for (const uso of usos) {
      expect(uso).toContain("aria-hidden");
      expect(uso).toContain("text-ai-text");
      expect(uso).not.toMatch(/(alert|warning|success|info|neutral)-text/);
    }
    // A linha com o icone e a do "lido"; a transcricao e o indisponivel nao
    // tem icone.
    const linhaDoLido =
      /data-leitura="lido"[\s\S]*?<\/p>/.exec(codigo)?.[0] ?? "";
    expect(linhaDoLido).toContain("<ScanText");
  });

  it("não é status: nenhum mapa do produto usa o ScanText", () => {
    const todas = [
      ...definicoesDe(status as Record<string, unknown>),
      ...definicoesDe(daAba as Record<string, unknown>),
    ];
    expect(todas.length).toBeGreaterThan(20);
    expect(todas.some(({ definicao }) => definicao.icon === ScanText)).toBe(
      false,
    );
  });
});

describe("o chip Sem áudio, foto e documento", () => {
  it("reaproveita o Hourglass em aviso; o Hourglass é sempre aviso em todo mapa", () => {
    expect(daAba.TELEFONE_SEM_MIDIA_STATUS.icon).toBe(Hourglass);
    expect(daAba.TELEFONE_SEM_MIDIA_STATUS.tone).toBe("warning");
    const comAmpulheta = [
      ...definicoesDe(status as Record<string, unknown>),
      ...definicoesDe(daAba as Record<string, unknown>),
    ].filter(({ definicao }) => definicao.icon === Hourglass);
    expect(comAmpulheta.map(({ nome }) => nome)).toContain(
      "TELEFONE_SEM_MIDIA_STATUS",
    );
    for (const { nome, definicao } of comAmpulheta) {
      expect(definicao.tone, nome).toBe("warning");
    }
  });

  it("nunca o triângulo (só do Faltou) nem o relógio (só do Aguardando)", () => {
    expect(daAba.TELEFONE_SEM_MIDIA_STATUS.icon).not.toBe(
      status.APPOINTMENT_STATUS.faltou.icon,
    );
    expect(daAba.TELEFONE_SEM_MIDIA_STATUS.label).toBe(
      "Sem áudio, foto e documento",
    );
  });
});
