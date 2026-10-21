import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Linguagem de recepcao no Painel geral (CLAUDE.md secao 5), como na aba
// Agente de IA (tests/unit/copy/jargao-da-aba-do-agente.test.ts): parte da
// copy mora no JSX dos dialogos, que a renderizacao estatica nao abre, entao
// o teste le os arquivos inteiros (comentarios inclusive: nenhum precisa
// desses termos). Travessao e meia-risca ficam de fora de tudo.

function arquivosDe(pasta: string): string[] {
  return readdirSync(pasta, { recursive: true, encoding: "utf-8" })
    .filter((nome) => /\.(ts|tsx)$/.test(nome))
    .map((nome) => join(pasta, nome));
}

const ARQUIVOS_DO_PAINEL = [
  ...arquivosDe("app/(app)/painel-geral"),
  ...arquivosDe("components/painel-geral"),
  "lib/queries/painel-geral.ts",
];

const JARGAO: readonly RegExp[] = [
  /janela de 24 horas/i,
  /ativ\w* (o (assistente|agente) )?no servidor/i,
  /\b(tenant|opt-in|handoff|kill switch)\b/i,
];

/** Os textos entre aspas duplas ou crases que viram tela (sem os imports). */
function textosDaTela(fonte: string): string[] {
  return [...fonte.matchAll(/"([^"\n]*[A-Za-zÀ-ú][^"\n]*)"|`([^`]*)`/g)]
    .map((m) => m[1] ?? m[2] ?? "")
    .filter((texto) => / /.test(texto) && !/^[@./]/.test(texto));
}

describe("copy do Painel geral", () => {
  it("os arquivos existem (a varredura não passa vazia)", () => {
    expect(ARQUIVOS_DO_PAINEL.length).toBeGreaterThanOrEqual(12);
    const textos = textosDaTela(
      readFileSync("components/painel-geral/painel-geral.ts", "utf-8"),
    );
    expect(textos).toContain("Somente a equipe Conduzza usa o painel geral.");
  });

  it("a regra pega o jargão (anti falso positivo)", () => {
    expect(textosDaTela('const x = "Só o super admin muda o teto.";')).toEqual([
      "Só o super admin muda o teto.",
    ]);
    expect(
      JARGAO.some((termo) => termo.test("A clínica é um tenant do sistema.")),
    ).toBe(true);
  });

  it.each(ARQUIVOS_DO_PAINEL)("%s fala como a recepção", (arquivo) => {
    const texto = readFileSync(arquivo, "utf-8");
    for (const termo of JARGAO) {
      expect(texto, `${arquivo}: ${termo}`).not.toMatch(termo);
    }
    expect(texto, arquivo).not.toMatch(/[—–]/);
  });

  it.each(ARQUIVOS_DO_PAINEL)(
    "%s: nada de super admin, RPC ou job no texto da tela",
    (arquivo) => {
      const fonte = readFileSync(arquivo, "utf-8");
      for (const texto of textosDaTela(fonte)) {
        // Classes do Tailwind e chaves de log nao sao tela.
        if (/^[a-z0-9:_[\]./-]+( [a-z0-9:_[\]&>.()%,'=/-]+)*$/.test(texto)) {
          continue;
        }
        expect(texto, `${arquivo}: ${texto}`).not.toMatch(
          /\b(super admin|RPC|jobs?|product_admin|clinic_id)\b/i,
        );
      }
    },
  );
});
