import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A aba importa as Server Actions e o roteador; aqui so a renderizacao. A
// tela de Configuracoes puxa modulos de servidor pelas outras abas.
vi.mock("server-only", () => ({}));
vi.mock("@/app/(app)/configuracoes/regras-de-origem-actions", () => ({
  salvarRegraDeOrigemAction: vi.fn(),
  ativarRegraDeOrigemAction: vi.fn(),
  desativarRegraDeOrigemAction: vi.fn(),
  excluirRegraDeOrigemAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/configuracoes",
  useSearchParams: () => new URLSearchParams(),
}));

import { ConfiguracoesClient } from "@/app/(app)/configuracoes/configuracoes-client";
import { FormularioDaOrigem } from "@/components/configuracoes/dialogo-da-origem";
import { LinkParaABio } from "@/components/configuracoes/link-para-a-bio";
import {
  CarregandoOrigens,
  OrigemDosLeadsTab,
  TEXTOS_DA_ORIGEM,
  type DadosDasOrigens,
} from "@/components/configuracoes/origem-dos-leads-tab";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  NumeroParaOLink,
  RegraDeOrigem,
} from "@/lib/domain/regras-de-origem";

// Aba "Origem dos leads" de Configuracoes (onda 5, item 17; contrato A.3):
// os estados (erro com "Tentar de novo", vazio, carregando e a lista), o
// status em tres camadas (icone, rotulo e cor) sem icone novo, a frase do
// canal e o "Reconhece por", o link para a bio com o numero e o codigo, as
// acoes de quem nao gerencia visiveis e desabilitadas com a dica, o
// formulario (codigo so na criacao, aviso fixo das palavras-chave, avisos
// da mensagem) e nenhum travessao nem cor solta.

const DICA = "Somente administradores e gestores alteram as configurações";
const MENSAGEM =
  "Olá! Vi o perfil da clínica no Instagram e quero agendar uma avaliação.";

const BIO: RegraDeOrigem = {
  id: "11111111-1111-4111-8111-111111111111",
  nome: "Link da bio",
  codigo: "K7Q2MX",
  canal: "redes_sociais",
  origem: "Instagram",
  detalhe: "Bio",
  campanha: "Bio outubro",
  mensagem: MENSAGEM,
  palavrasChave: ["perfil", "bio do insta"],
  ativa: true,
};
const PARCEIRO: RegraDeOrigem = {
  id: "22222222-2222-4222-8222-222222222222",
  nome: "Parceiro academia",
  codigo: null,
  canal: "indicacao",
  origem: "Academia Forte",
  detalhe: null,
  campanha: null,
  mensagem: "Olá! A Academia Forte indicou a clínica e quero marcar.",
  palavrasChave: [],
  ativa: false,
};
const NUMEROS: NumeroParaOLink[] = [
  {
    id: "n1",
    nome: "Recepção",
    digitos: "5585999990000",
    telefone: "(85) 99999-0000",
  },
];

function dados(campos: Partial<DadosDasOrigens> = {}): DadosDasOrigens {
  return {
    regras: [BIO, PARCEIRO],
    numeros: NUMEROS,
    frasesDoSite: [],
    ...campos,
  };
}

function aba(dadosDaAba: DadosDasOrigens | null, podeGerenciar = true): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <OrigemDosLeadsTab
        dados={dadosDaAba}
        podeGerenciar={podeGerenciar}
        dica={DICA}
      />
    </TooltipProvider>,
  );
}

/** Botao com aquele nome acessivel e desabilitado, em qualquer ordem. */
const desabilitado = (nome: string) =>
  new RegExp(`<button(?=[^>]*aria-label="${nome}")(?=[^>]*disabled="")[^>]*>`);

/** O texto visivel, sem as marcas. */
function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("estados da aba", () => {
  it("erro: diz que não carregou e oferece Tentar de novo, sem derrubar a tela", () => {
    const html = aba(null);
    expect(html).toContain(TEXTOS_DA_ORIGEM.erroTitulo);
    expect(html).toContain("Tentar de novo");
    expect(html).not.toContain(TEXTOS_DA_ORIGEM.titulo);
  });

  it("vazio: explica e oferece Nova origem", () => {
    const html = aba(dados({ regras: [] }));
    expect(html).toContain("Nenhuma origem cadastrada");
    expect(html).toContain("Nova origem");
    expect(html).toContain(TEXTOS_DA_ORIGEM.testeTitulo);
  });

  it("carregando: esqueleto da lista, com o texto para o leitor de tela", () => {
    const html = renderToStaticMarkup(<CarregandoOrigens />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Carregando as origens");
    expect(html).toContain('data-slot="skeleton"');
  });
});

describe("a lista de origens", () => {
  const html = aba(dados());
  const visivel = texto(html);

  it("contador e quantas estão ativas", () => {
    expect(visivel).toContain("Origens cadastradas 2");
    expect(visivel).toContain("1 ativa, de até 50 por clínica.");
  });

  it("cada linha: nome, frase do canal, Reconhece por e campanha", () => {
    expect(visivel).toContain("Link da bio");
    expect(visivel).toContain("Redes sociais, Instagram (Bio)");
    expect(visivel).toContain(
      "Reconhece por: mensagem pronta, código #K7Q2MX, 2 palavras-chave",
    );
    expect(visivel).toContain("Campanha: Bio outubro");
    expect(visivel).toContain("Indicação, Academia Forte");
  });

  it("status em três camadas: ícone de forma distinta, rótulo e cor", () => {
    const chips = [
      ...html.matchAll(
        /<span data-size="sm"[^>]*style="([^"]*)"[^>]*>(.*?)<\/span><\/span>|<span data-size="sm"[^>]*style="([^"]*)"[^>]*>([\s\S]*?)<span>(Ativa|Desativada)<\/span>/g,
      ),
    ];
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(html).toMatch(/lucide-circle-check[\s\S]*?<span>Ativa<\/span>/);
    expect(html).toMatch(/lucide-circle-pause[\s\S]*?<span>Desativada<\/span>/);
    // Cor pelos tokens do tema (var(--...)), nunca hex solto.
    expect(html).toMatch(
      /style="color:var\(--[^)]+\);background-color:var\(--/,
    );
  });

  it("link para a bio: o número, o link wa.me com o código e Copiar link", () => {
    expect(html).toContain(
      `https://wa.me/5585999990000?text=${encodeURIComponent(`${MENSAGEM} [#K7Q2MX]`)}`,
    );
    expect(visivel).toContain("Recepção, (85) 99999-0000");
    expect(visivel).toContain(
      `Texto que aparece no WhatsApp: ${MENSAGEM} [#K7Q2MX]`,
    );
    expect(html).toMatch(/aria-label="Copiar link de Link da bio"/);
    expect(html).not.toMatch(desabilitado("Copiar link de Link da bio"));
  });

  it("origem desativada: Copiar link visível e desabilitado, com a dica", () => {
    expect(html).toMatch(desabilitado("Copiar link de Parceiro academia"));
  });

  it("as ações de quem gerencia", () => {
    expect(html).not.toMatch(desabilitado("Editar Link da bio"));
    expect(html).toContain('aria-label="Desativar Link da bio"');
    expect(html).toContain('aria-label="Ativar Parceiro academia"');
    expect(html).toContain('aria-label="Excluir Link da bio"');
  });

  it("Testar uma mensagem: o campo e a regra da primeira mensagem", () => {
    expect(visivel).toContain("Primeira mensagem do lead");
    expect(visivel).toContain(TEXTOS_DA_ORIGEM.testeRegra);
    expect(html).toContain('aria-live="polite"');
  });
});

describe("sem permissão e no limite", () => {
  it("quem não gerencia vê tudo desabilitado, com a dica alcançável", () => {
    const html = aba(dados(), false);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Nova origem/);
    expect(html).toMatch(desabilitado("Editar Link da bio"));
    expect(html).toMatch(desabilitado("Desativar Link da bio"));
    expect(html).toMatch(desabilitado("Ativar Parceiro academia"));
    expect(html).toMatch(desabilitado("Excluir Link da bio"));
    expect(html).toContain('tabindex="0"');
  });

  it("com 50 origens ativas, Nova origem e Ativar ficam desabilitados", () => {
    const ativas = Array.from({ length: 50 }, (_, i) => ({
      ...BIO,
      id: `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      nome: `Origem ${i}`,
    }));
    const html = aba(dados({ regras: [...ativas, PARCEIRO] }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Nova origem/);
    expect(html).toMatch(desabilitado("Ativar Parceiro academia"));
  });
});

describe("bloco do link sem número", () => {
  function bloco(numeros: NumeroParaOLink[] | null, mensagem: string | null) {
    return texto(
      renderToStaticMarkup(
        <TooltipProvider>
          <LinkParaABio numeros={numeros} mensagem={mensagem} codigo="K7Q2MX" />
        </TooltipProvider>,
      ),
    );
  }

  it("sem número conectado, explica onde conectar", () => {
    expect(bloco([], MENSAGEM)).toContain(
      "Conecte um número de WhatsApp na aba WhatsApp para montar o link.",
    );
  });

  it("leitura dos números que falhou", () => {
    expect(bloco(null, MENSAGEM)).toContain(
      "Não foi possível carregar os números de WhatsApp.",
    );
  });

  it("sem mensagem pronta, pede a mensagem", () => {
    expect(bloco(NUMEROS, null)).toContain(
      "Escreva a mensagem pronta para montar o link.",
    );
  });
});

describe("o formulário da origem", () => {
  function formulario(regra: RegraDeOrigem | null): string {
    return renderToStaticMarkup(
      <TooltipProvider>
        <FormularioDaOrigem
          regra={regra}
          numeros={NUMEROS}
          frasesDoSite={[]}
          aoFechar={() => undefined}
        />
      </TooltipProvider>,
    );
  }

  it("criação: os campos, o código ligado por padrão e copiar só depois de salvar", () => {
    const html = formulario(null);
    const visivel = texto(html);
    expect(visivel).toContain("Nome");
    expect(visivel).toContain("Canal");
    expect(visivel).toContain("Origem (opcional)");
    expect(visivel).toContain("Detalhe (opcional)");
    expect(visivel).toContain(
      "Aparece em Resultados, em Campanhas, como campanha fora da Meta.",
    );
    expect(visivel).toContain("Mensagem pronta do link");
    expect(visivel).toContain(
      "Copie exatamente o texto que aparece escrito no WhatsApp quando a pessoa toca no link.",
    );
    expect(visivel).toContain("Palavras-chave (opcional)");
    expect(visivel).toContain(
      "A palavra-chave vale para qualquer primeira mensagem que a tenha, e a origem gravada não muda depois. Evite palavras comuns como consulta ou agendar.",
    );
    expect(visivel).toContain("Pôr um código no link");
    expect(html).toMatch(/role="checkbox"[^>]*aria-checked="true"/);
    expect(visivel).toContain("Criar origem");
    expect(visivel).toContain("Escreva a mensagem pronta para montar o link.");
  });

  it("edição: o código não muda, o link aparece e a mensagem com # avisa", () => {
    const html = formulario({ ...BIO, mensagem: `${MENSAGEM} #agendar` });
    const visivel = texto(html);
    expect(visivel).toContain("Código do link: #K7Q2MX");
    expect(visivel).not.toContain("Pôr um código no link");
    expect(visivel).toContain(
      "O trecho #AGENDA da mensagem é lido como código.",
    );
    expect(visivel).toContain("Salvar origem");
    expect(html).toContain("https://wa.me/5585999990000?text=");
    // As palavras-chave da origem, cada uma com o botao de tirar (40px).
    expect(html).toContain('aria-label="Tirar a palavra-chave perfil"');
  });

  it("o contador da mensagem conta como o Zod e o banco: um emoji vale 1", () => {
    // Revisao da onda 5: o .length conta unidades UTF-16 (um emoji fora do
    // BMP vale 2), e o contador mostrava 15 numa mensagem que o minimo de 15
    // recusava.
    const dente = String.fromCodePoint(0x1f9b7);
    const mensagem = `Oi ${dente.repeat(4)} tudo bem por aqui`;
    expect(mensagem.length).toBe(29);
    const visivel = texto(formulario({ ...BIO, mensagem }));
    expect(visivel).toContain("25/1000");
    expect(visivel).not.toContain("29/1000");
  });
});

describe("a aba na tela de Configurações", () => {
  // As props por objeto: a da aba do agente muda de nome na onda 2
  // (agenteDeIa vira comAgenteDeIa), e esta prova nao depende dela.
  function tela(abaInicial: string, origens: DadosDasOrigens | null) {
    const props = {
      abaInicial,
      equipe: null,
      meuUserId: "u1",
      podeGerenciar: true,
      ehAdmin: true,
      dica: DICA,
      clinica: null,
      codigo: null,
      codigoAtivo: false,
      whatsapp: null,
      jornada: null,
      etiquetas: null,
      mensagens: null,
      origens,
      meta: null,
      google: null,
      agenteDeIa: null,
    } as unknown as React.ComponentProps<typeof ConfiguracoesClient>;
    return renderToStaticMarkup(
      <TooltipProvider>
        <ConfiguracoesClient {...props} />
      </TooltipProvider>,
    );
  }

  it("?aba=origem abre a aba, com a explicação e o contador", () => {
    const html = tela("origem", dados());
    const selecionada =
      /<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>(.*?)<\/button>/.exec(
        html,
      )?.[1] ?? "";
    expect(texto(selecionada).trim()).toMatch(/^Origem dos leads 2 2 origens$/);
    expect(html).toContain(
      "Quando o lead chega por um link da clínica (a bio do Instagram, o perfil no Google, um QR code, um parceiro)",
    );
  });

  it("a falha da aba não derruba a tela", () => {
    const html = tela("origem", null);
    expect(html).toContain(TEXTOS_DA_ORIGEM.erroTitulo);
    expect(html).toContain("Equipe e permissões");
  });
});

describe("cores e travessão", () => {
  it("nenhum travessão e nenhuma cor hex solta em estado nenhum", () => {
    const estados = [
      aba(null),
      aba(dados({ regras: [] })),
      aba(dados()),
      aba(dados(), false),
      aba(dados({ numeros: null })),
      renderToStaticMarkup(<CarregandoOrigens />),
    ];
    for (const html of estados) {
      expect(html).not.toMatch(/[\u2013\u2014]/);
      expect(html).not.toMatch(/(?:text|bg|border)-\[#/);
      expect(html).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});
