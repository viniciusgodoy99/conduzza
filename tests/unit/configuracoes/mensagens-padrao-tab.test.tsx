import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A aba importa as Server Actions; aqui so a renderizacao importa.
vi.mock("@/app/(app)/configuracoes/mensagens-padrao-actions", () => ({
  salvarMensagemPadraoAction: vi.fn(),
  reordenarMensagemPadraoAction: vi.fn(),
  excluirMensagemPadraoAction: vi.fn(),
}));

import { MensagensPadraoTab } from "@/components/configuracoes/mensagens-padrao-tab";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RespostaRapida } from "@/lib/domain/respostas-rapidas";

// Aba "Mensagens padrão" de Configuracoes: vazio, linha com o status em tres
// camadas (icone, rotulo e cor) e as acoes de quem nao gerencia visiveis e
// desabilitadas, com a dica.

const MENSAGENS: RespostaRapida[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    atalho: "endereco",
    titulo: "Endereço da clínica",
    corpo: "Rua A, 10, Centro.",
    ativo: true,
    posicao: 10,
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    atalho: "antiga",
    titulo: "Promoção antiga",
    corpo: "Texto antigo.",
    ativo: false,
    posicao: 20,
  },
];

/** Botao com aquele nome e desabilitado, em qualquer ordem de atributo. */
const desabilitado = (nome: string) =>
  new RegExp(`<button(?=[^>]*aria-label="${nome}")(?=[^>]*disabled="")[^>]*>`);

function aba(props: Partial<React.ComponentProps<typeof MensagensPadraoTab>>) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <MensagensPadraoTab
        mensagens={MENSAGENS}
        nomeDaClinica="Clínica Sorriso"
        podeGerenciar
        dica="Somente administradores e gestores alteram as configurações"
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("aba Mensagens padrão", () => {
  it("vazio explica o que é e como usar", () => {
    const html = aba({ mensagens: [] });
    expect(html).toContain("Nenhuma mensagem padrão ainda");
    expect(html).toContain("digite / na resposta ao paciente");
    expect(html).toContain("Nova mensagem");
  });

  it("cada linha: título, atalho, status em texto e o começo do texto", () => {
    const html = aba({});
    expect(html).toContain("Endereço da clínica");
    expect(html).toContain("/endereco");
    expect(html).toContain("Rua A, 10, Centro.");
    expect(html).toContain("Ativa");
    expect(html).toContain("Desativada");
    // Subir a primeira e descer a ultima nao fazem sentido.
    expect(html).toMatch(desabilitado("Subir Endereço da clínica"));
    expect(html).toMatch(desabilitado("Descer Promoção antiga"));
    expect(html).not.toMatch(desabilitado("Descer Endereço da clínica"));
  });

  it("quem não gerencia vê tudo desabilitado, com a dica alcançável", () => {
    const html = aba({ podeGerenciar: false });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Nova mensagem/);
    expect(html).toMatch(desabilitado("Editar Endereço da clínica"));
    expect(html).toMatch(desabilitado("Descer Endereço da clínica"));
    expect(html).toContain('tabindex="0"');
  });

  it("não tem travessão no texto", () => {
    expect(aba({})).not.toContain("\u2014");
    expect(aba({ mensagens: [] })).not.toContain("\u2014");
  });
});
