import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// As Server Actions do editor: aqui so a renderizacao importa.
vi.mock("@/app/(app)/automacoes/actions", () => ({
  salvarTextoDoPassoAction: vi.fn(),
  salvarAnexoDoPassoAction: vi.fn(),
  removerAnexoDoPassoAction: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import {
  AJUDA_DO_CAMPO_DO_PREPARO,
  EditorDePasso,
  valoresDeAmostra,
} from "@/components/automacoes/editor-de-passo";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PLACEHOLDERS } from "@/lib/domain/modelo-mensagem";
import type { PassoDaReguaDaTela } from "@/lib/queries/confirmacoes";

// AG7 em Automacoes (desenho da AG7, secao 5.5; contrato 3.3): no editor do
// passo da regua, logo depois dos chips dos campos e so quando a regua
// oferece o {{preparo}}, a linha que diz o que ele vira no envio: a
// orientacao aprovada pelo responsavel tecnico, e a linha some sem texto
// aprovado. A amostra e o "Testar envio" continuam com o preparo vazio
// (nenhum texto clinico no teste). Nada aqui chama acao nem rede.

const AJUDA =
  "{{preparo}}: a orientação de preparo aprovada pelo responsável técnico do procedimento. Sem texto aprovado, a linha some.";

const PASSO: PassoDaReguaDaTela = {
  id: "44444444-4444-4444-8444-444444444444",
  offset_minutes: -1440,
  fixed_body:
    "Oi, {{nome}}! Amanhã, {{data}} às {{hora}}, você tem {{procedimento}}.\n{{preparo}}\nPodemos confirmar sua presença?",
  media_path: null,
  media_type: null,
  media_mimetype: null,
  media_filename: null,
};

function editor(
  props: Partial<Parameters<typeof EditorDePasso>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <EditorDePasso
        passo={PASSO}
        rotulo="1 dia antes"
        nomeDaClinica="Clínica Exemplo"
        podeEditar
        dicaSemPermissao="Somente administradores e gestores alteram as automações"
        aoMudar={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  );
}

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

/** A linha da ajuda, ou "" sem ela. */
function ajudaNa(html: string): string {
  return /<p data-ajuda-do-preparo="true"[^>]*>.*?<\/p>/.exec(html)?.[0] ?? "";
}

describe("a ajuda do {{preparo}} no editor do passo", () => {
  it("o texto do desenho, com o campo destacado como os chips (fonte mono), sem cor nem ícone de status", () => {
    expect(`{{preparo}}${AJUDA_DO_CAMPO_DO_PREPARO}`).toBe(AJUDA);
    const linha = ajudaNa(editor());
    expect(linha).toBe(
      `<p data-ajuda-do-preparo="true" class="text-xs text-text-secondary"><code class="cz-num text-foreground">{{preparo}}</code>${AJUDA_DO_CAMPO_DO_PREPARO}</p>`,
    );
    expect(texto(linha)).toBe(AJUDA);
  });

  it("logo depois dos chips dos campos", () => {
    const html = editor();
    const chipDoPreparo = html.indexOf("{{preparo}}</button>");
    const ajuda = html.indexOf("data-ajuda-do-preparo");
    expect(chipDoPreparo).toBeGreaterThan(-1);
    expect(ajuda).toBeGreaterThan(chipDoPreparo);
    // Antes do anexo, que vem depois dos campos.
    expect(ajuda).toBeLessThan(html.indexOf("Anexo (foto, áudio ou arquivo)"));
  });

  it("só quando a régua oferece o campo: com a lista de todos (o padrão) e com uma lista que tem o preparo", () => {
    expect([...PLACEHOLDERS]).toContain("preparo");
    expect(ajudaNa(editor())).not.toBe("");
    expect(ajudaNa(editor({ placeholders: ["nome", "preparo"] }))).not.toBe("");
    // O follow-up de leads (components/automacoes/followup) so oferece nome
    // e clinica: sem a linha.
    const semPreparo = editor({ placeholders: ["nome", "clinica"] });
    expect(ajudaNa(semPreparo)).toBe("");
    expect(semPreparo).not.toContain(AJUDA_DO_CAMPO_DO_PREPARO);
  });

  it("vale também para quem só vê (é ajuda, não ação)", () => {
    expect(ajudaNa(editor({ podeEditar: false }))).not.toBe("");
  });

  it("a amostra e o Testar envio continuam com o preparo vazio: a prévia não leva texto clínico", () => {
    expect(valoresDeAmostra("Clínica Exemplo").preparo).toBe("");
    expect(readFileSync("app/(app)/automacoes/actions.ts", "utf8")).toMatch(
      /\n\s*preparo: "",\n/,
    );
    // Na previa, a linha do {{preparo}} some (a regra da linha vazia).
    const previa = editor().slice(editor().indexOf("Como o paciente vê"));
    expect(previa).not.toContain("{{preparo}}");
    expect(texto(previa)).toContain("Podemos confirmar sua presença?");
  });

  it("sem travessão", () => {
    expect(AJUDA).not.toMatch(/[—–]/);
    expect(editor()).not.toMatch(/[—–]/);
  });
});
