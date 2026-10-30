import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// A guarda dos CAMINHOS da OpenAI (AG6b, desenho 8.1; CLAUDE.md, secao 2):
// varre lib/ e app/ e so aceita
//  - audio.transcriptions (a EXCECAO do D-56) em
//    lib/integrations/llm/transcricao.ts;
//  - input_image e input_file (o arquivo embutido) em
//    lib/integrations/llm/leitor-de-midia.ts;
// e nenhum Files, Vector Stores, Conversations, Batch, Evals, audio.speech,
// audio.translations, Realtime ou previous_response_id em codigo. A
// UAZAPI_OPENAI_KEY nao aparece em lugar nenhum (D-94: a uazapi nunca
// transcreve). Comentarios nao contam (eles explicam as proibicoes), menos
// para a chave da uazapi, que nao pode nem ser citada.

const RAIZES = ["lib", "app", "scripts"];
const TRANSCRICAO = "lib/integrations/llm/transcricao.ts";
const LEITOR = "lib/integrations/llm/leitor-de-midia.ts";

function arquivos(pasta: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivos(caminho));
    } else if (/\.(ts|tsx|js|mjs)$/.test(nome)) {
      achados.push(caminho);
    }
  }
  return achados;
}

/** O codigo sem comentarios (de linha e de bloco). */
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((linha) => {
      // Comentario de linha fora de string (o suficiente para este codigo:
      // "//" so aparece em URL dentro de string, com ":" antes).
      const i = linha.search(/(^|[^:"'`])\/\//);
      return i < 0 ? linha : linha.slice(0, i + 1);
    })
    .join("\n");
}

const TODOS = RAIZES.flatMap(arquivos).sort();

function quemUsa(padrao: RegExp, { comComentarios = false } = {}): string[] {
  return TODOS.filter((arquivo) => {
    const fonte = readFileSync(arquivo, "utf-8");
    return padrao.test(comComentarios ? fonte : semComentarios(fonte));
  });
}

describe("a guarda dos caminhos da OpenAI", () => {
  it("varre os arquivos de lib/ e app/", () => {
    expect(TODOS.length).toBeGreaterThan(100);
    expect(TODOS).toContain(TRANSCRICAO);
    expect(TODOS).toContain(LEITOR);
  });

  it("audio.transcriptions so na transcricao (a excecao do D-56)", () => {
    expect(quemUsa(/audio\s*\.\s*transcriptions/)).toEqual([TRANSCRICAO]);
  });

  it("input_image e input_file so no leitor de midia", () => {
    expect(quemUsa(/["'`]input_image["'`]/)).toEqual([LEITOR]);
    expect(quemUsa(/["'`]input_file["'`]/)).toEqual([LEITOR]);
    // O audio nunca vai pela Responses API.
    expect(quemUsa(/["'`]input_audio["'`]/)).toEqual([]);
  });

  it.each([
    ["Files", /\.files\s*\.\s*(create|retrieve|list|content|delete|del|upload)\b/],
    ["file_id", /\bfile_id\s*:/],
    ["file_url", /\bfile_url\s*:/],
    ["Vector Stores", /vectorStores|vector_stores/],
    ["Conversations", /\.conversations\s*\./],
    ["Batch", /\.batches\s*\./],
    ["Evals", /\.evals\s*\./],
    ["audio.speech", /audio\s*\.\s*speech/],
    ["audio.translations", /audio\s*\.\s*translations/],
    // O Realtime da OpenAI (o do Supabase, supabase.realtime.setAuth, e outro).
    [
      "Realtime da OpenAI",
      /\.realtime\s*\.\s*(clientSecrets|sessions|calls|connect)|beta\s*\.\s*realtime|openai\/resources\/realtime/,
    ],
    ["previous_response_id", /previous_response_id/],
    ["Agents SDK", /@openai\/agents/],
  ])("nenhum %s em codigo", (_nome, padrao) => {
    expect(quemUsa(padrao)).toEqual([]);
  });

  it("a UAZAPI_OPENAI_KEY nao aparece em lugar nenhum (D-94)", () => {
    expect(quemUsa(/UAZAPI_OPENAI_KEY/, { comComentarios: true })).toEqual([]);
    expect(
      readFileSync(".env.example", "utf-8").includes("UAZAPI_OPENAI_KEY"),
    ).toBe(false);
    expect(
      readFileSync("scripts/ia/avaliar-conformidade.ts", "utf-8").includes(
        "UAZAPI_OPENAI_KEY",
      ),
    ).toBe(false);
  });

  it("o download da uazapi nunca pede transcricao nem manda chave da OpenAI", () => {
    const uazapi = semComentarios(
      readFileSync("lib/integrations/whatsapp/uazapi.ts", "utf-8"),
    );
    expect(uazapi).toContain("transcribe: false");
    expect(uazapi).not.toMatch(/transcribe:\s*(true|options|transcrever)/);
    expect(uazapi).not.toContain("openai_apikey");
  });
});
