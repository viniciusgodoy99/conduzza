import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { filtrarSaida } from "@/lib/domain/conformidade/filtro";
import type { TextoAprovado } from "@/lib/domain/conformidade/texto-aprovado";
import { CONTEXTO_PADRAO } from "@/tests/fixtures/ia/conformidade/casos";

// TextoAprovado so sai de filtrarSaida. Duas provas:
//  - de tipo: uma string crua nao e atribuivel (o @ts-expect-error abaixo
//    falha o typecheck se um dia passar a ser);
//  - de codigo: nenhum arquivo do app converte para TextoAprovado, exceto o
//    proprio filtro.

const RAIZ = process.cwd();
const PASTAS = ["app", "components", "lib", "scripts"];
const UNICO_PERMITIDO = "lib/domain/conformidade/filtro.ts";

function arquivos(pasta: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) {
      saida.push(...arquivos(caminho));
    } else if (/\.(ts|tsx|mts)$/.test(nome)) {
      saida.push(caminho);
    }
  }
  return saida;
}

describe("TextoAprovado", () => {
  it("string crua nao vira TextoAprovado sem o filtro", () => {
    // @ts-expect-error string crua do modelo nao pode ser enviada como aprovada
    const forjado: TextoAprovado = "Pode tomar dipirona";
    expect(typeof forjado).toBe("string");
  });

  it("so o filtro converte para TextoAprovado", () => {
    const conversao = /\bas\s+TextoAprovado\b|<TextoAprovado>/;
    const infratores: string[] = [];
    for (const pasta of PASTAS) {
      for (const arquivo of arquivos(join(RAIZ, pasta))) {
        const caminho = relative(RAIZ, arquivo);
        if (caminho === UNICO_PERMITIDO) {
          continue;
        }
        if (conversao.test(readFileSync(arquivo, "utf-8"))) {
          infratores.push(caminho);
        }
      }
    }
    expect(infratores).toEqual([]);
  });

  it("o filtro faz exatamente uma conversao, numa funcao nao exportada", () => {
    const fonte = readFileSync(join(RAIZ, UNICO_PERMITIDO), "utf-8");
    expect(fonte.match(/\bas TextoAprovado\b/g)).toHaveLength(1);
    expect(fonte).toMatch(/\nfunction aprovar\(texto: string\): TextoAprovado/);
    expect(fonte).not.toMatch(/export function aprovar/);
  });

  it("o texto aprovado e o rascunho, byte a byte", async () => {
    const rascunho = "  Tenho horário amanhã às 10h.\n";
    const decisao = await filtrarSaida({
      rascunho,
      contexto: CONTEXTO_PADRAO,
      verificador: async () => ({
        tipo: "veredicto",
        veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
        modelo: "x",
        uso: null,
      }),
    });
    expect(decisao.aprovado).toBe(true);
    if (decisao.aprovado) {
      const enviado: string = decisao.texto;
      expect(enviado).toBe(rascunho);
    }
  });
});
