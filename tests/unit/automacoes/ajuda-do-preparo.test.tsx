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
  AVISO_DO_PREPARO_SOZINHO,
  EditorDePasso,
  NOTA_DO_PREPARO_NA_PREVIA,
  previaDoPasso,
  valoresDeAmostra,
} from "@/components/automacoes/editor-de-passo";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  modeloSemOPreparo,
  PLACEHOLDERS,
  renderizarModelo,
} from "@/lib/domain/modelo-mensagem";
import type { PassoDaReguaDaTela } from "@/lib/queries/confirmacoes";

// AG7 em Automacoes (desenho da AG7, secao 5.5; contrato 3.3): no editor do
// passo da regua, logo depois dos chips dos campos e so quando a regua
// oferece o {{preparo}}, a linha que diz o que ele vira no envio: a
// orientacao aprovada pelo responsavel tecnico, e, sem texto aprovado, o que
// sai (revisao curta, CURTA-4: o campo e a frase que so o apresenta; a
// mensagem que fica vazia nao sai). A amostra e o "Testar envio" continuam
// com o preparo vazio (nenhum texto clinico no teste), e a previa mostra o
// toque como a regua o manda sem texto aprovado. Nada aqui chama acao nem
// rede.

const AJUDA =
  "{{preparo}}: a orientação de preparo aprovada pelo responsável técnico do procedimento. Sem texto aprovado, saem o campo e a frase que só o apresenta (como “Siga o preparo:”), e o resto da mensagem sai como está. A mensagem que ficar vazia não sai.";

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
    expect(NOTA_DO_PREPARO_NA_PREVIA).not.toMatch(/[—–]/);
    expect(AVISO_DO_PREPARO_SOZINHO).not.toMatch(/[—–]/);
  });
});

// Revisao curta da AG7 (CURTA-4): a previa mostrava o campo vazio e a linha
// que o apresentava ("Siga o preparo abaixo:"), e a regua tirava a linha
// inteira. Agora as duas usam modeloSemOPreparo: a previa e o toque sem
// texto aprovado.
describe("revisao curta da AG7 (CURTA-4): a prévia mostra o que a régua manda sem texto aprovado", () => {
  function previaNa(html: string): string {
    return texto(html.slice(html.indexOf("Como o paciente vê")));
  }

  it.each([
    "Oi, {{nome}}! Confirma {{procedimento}} amanhã às {{hora}}? {{preparo}}",
    "Sua consulta é amanhã, {{data}} às {{hora}}. {{preparo}}\nPodemos confirmar sua presença?",
    "Olá {{nome}}, seguem os dados da sua consulta de amanhã:\n{{preparo}}\nData: {{data}} às {{hora}}.",
    "Oi, {{nome}}!\nSiga o preparo abaixo:\n{{preparo}}\nPodemos confirmar sua presença?",
  ])("%j: a prévia é a função da régua com a amostra", (modelo) => {
    const esperado = renderizarModelo(
      modeloSemOPreparo(modelo),
      valoresDeAmostra("Clínica Exemplo"),
    );
    expect(previaDoPasso(modelo, "Clínica Exemplo")).toBe(esperado);
    expect(esperado).not.toContain("preparo abaixo");
    const html = editor({ passo: { ...PASSO, fixed_body: modelo } });
    for (const linha of esperado.split("\n")) {
      expect(previaNa(html)).toContain(linha);
    }
    expect(previaNa(html)).not.toContain("Siga o preparo");
    expect(previaNa(html)).toContain(NOTA_DO_PREPARO_NA_PREVIA);
  });

  it("o passo só com o {{preparo}}: a prévia avisa que a mensagem não sai", () => {
    for (const modelo of [
      "{{preparo}}",
      "Siga o preparo abaixo:\n{{preparo}}",
    ]) {
      expect(previaDoPasso(modelo, "Clínica Exemplo")).toBe("");
      const html = editor({ passo: { ...PASSO, fixed_body: modelo } });
      expect(html).toContain("data-aviso-do-preparo");
      expect(texto(html)).toContain(AVISO_DO_PREPARO_SOZINHO);
    }
    // Com o resto da mensagem, sem o aviso.
    expect(editor()).not.toContain("data-aviso-do-preparo");
  });

  it("sem o {{preparo}} no texto, nem a nota nem o aviso", () => {
    const html = editor({
      passo: { ...PASSO, fixed_body: "Oi, {{nome}}! Podemos confirmar?" },
    });
    expect(html).not.toContain(NOTA_DO_PREPARO_NA_PREVIA);
    expect(html).not.toContain("data-aviso-do-preparo");
  });
});
