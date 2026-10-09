import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { DadosDoPainel } from "@/components/agente/tipos";
import {
  configPadraoDoAgente,
  TEXTO_DA_CONFORMIDADE,
} from "@/lib/domain/agente/config";

import {
  configDeTeste,
  dadosDeTeste,
  DICA_RECEPCAO,
  ITEM_ATIVO,
  VERSAO_1,
  VERSAO_2,
} from "./tela-fixtures";

// Painel da Tela 6 (Agente de IA) renderizado no servidor: as abas, o rodape
// de publicacao, o unico lime, a recepcao desabilitada com dica, a aba das
// instrucoes so para o super admin e as chaves travadas da conformidade
// (C24). As abas ficam montadas (forceMount), entao o HTML estatico traz
// todas elas, com a ativa marcada.

vi.mock("@/components/agente/acoes", () => ({
  acoesDoAgente: {
    salvarPersona: vi.fn(),
    salvarHabilidades: vi.fn(),
    salvarHorario: vi.fn(),
    salvarItemDaBase: vi.fn(),
    ativarItemDaBase: vi.fn(),
    excluirItemDaBase: vi.fn(),
    salvarInstrucoes: vi.fn(),
    publicar: vi.fn(),
    restaurarVersao: vi.fn(),
    simular: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { NaoSalvosNoPublicar, PainelDoAgente } =
  await import("@/components/agente/painel-do-agente");

function render(dados: DadosDoPainel, abaInicial?: string): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <PainelDoAgente dados={dados} abaInicial={abaInicial} />
    </TooltipProvider>,
  );
}

/** O texto visivel (sem as tags), para procurar copia. */
function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** As tags de um papel (role="tab", role="switch"...). */
function tags(html: string, papel: string): string[] {
  return html.match(new RegExp(`<[^>]*role="${papel}"[^>]*>`, "g")) ?? [];
}

function abaSelecionada(html: string): string | null {
  const tab = tags(html, "tab").find((tag) =>
    tag.includes('aria-selected="true"'),
  );
  return tab?.match(/id="[^"]*-trigger-([a-z]+)"/)?.[1] ?? null;
}

describe("abas", () => {
  it("administrador ve as 5 abas, sem a das instruções", () => {
    const html = render(dadosDeTeste());
    expect(tags(html, "tab")).toHaveLength(5);
    const visivel = texto(html);
    for (const rotulo of [
      "Persona",
      "Habilidades",
      "Conhecimento",
      "Regras e limites",
      "Versões",
    ]) {
      expect(visivel).toContain(rotulo);
    }
    expect(visivel).not.toContain("Instruções do assistente");
    expect(visivel).not.toMatch(/prompt/i);
  });

  it("o contador do Conhecimento tem o número por extenso para o leitor", () => {
    const html = render(dadosDeTeste());
    expect(html).toContain('<span class="sr-only">2 perguntas</span>');
  });

  it("a aba vem da URL; a das instruções cai na Persona para quem não é super admin", () => {
    expect(abaSelecionada(render(dadosDeTeste(), "regras"))).toBe("regras");
    expect(abaSelecionada(render(dadosDeTeste(), "instrucoes"))).toBe(
      "persona",
    );
    expect(abaSelecionada(render(dadosDeTeste(), "qualquer"))).toBe("persona");
  });

  it("super admin ve as instruções e a prévia do prompt", () => {
    const html = render(
      dadosDeTeste({
        superAdmin: true,
        config: configDeTeste({ instrucoes: "Fale do horário estendido." }),
        previaDoPrompt: "Você é a recepcionista virtual.",
      }),
      "instrucoes",
    );
    expect(tags(html, "tab")).toHaveLength(6);
    expect(abaSelecionada(html)).toBe("instrucoes");
    const visivel = texto(html);
    expect(visivel).toContain("Instruções do assistente");
    expect(visivel).toContain("Prévia do prompt");
    expect(visivel).toContain("Você é a recepcionista virtual.");
    expect(visivel).toContain("Fale do horário estendido.");
    expect(visivel).toContain("/2000");
  });

  it("super admin sem a prévia ve o erro, não um bloco vazio", () => {
    const html = render(
      dadosDeTeste({ superAdmin: true, previaDoPrompt: null }),
      "instrucoes",
    );
    expect(texto(html)).toContain("A prévia não carregou");
  });
});

describe("rodapé de publicação", () => {
  it("conta as alterações e diz que ainda não publicou", () => {
    // nome, saudação e a pergunta ativa (a desativada nao conta)
    const visivel = texto(render(dadosDeTeste()));
    expect(visivel).toContain("3 alterações não publicadas");
    expect(visivel).toContain("O assistente ainda não foi publicado.");
  });

  it("mostra a última publicada com a data no fuso da clínica", () => {
    const config = configDeTeste({ base: [ITEM_ATIVO] });
    const visivel = texto(
      render(
        dadosDeTeste({
          config,
          publicada: { ...config, status: "publicada" },
          base: [ITEM_ATIVO],
          versoes: [VERSAO_2, VERSAO_1],
        }),
      ),
    );
    expect(visivel).toContain("Nenhuma alteração para publicar");
    expect(visivel).toContain(
      "Última publicada: versão 2, em 06/10/2026 às 14:05.",
    );
    expect(visivel).not.toContain("Em uso");
  });

  it("versões que não carregaram: o número da publicada, nunca 'não foi publicado' (achado 29)", () => {
    const config = configDeTeste({ base: [ITEM_ATIVO] });
    const visivel = texto(
      render(
        dadosDeTeste({
          config,
          publicada: { ...config, status: "publicada", versao: 3 },
          base: [ITEM_ATIVO],
          versoes: null,
        }),
      ),
    );
    expect(visivel).toContain("Última publicada: versão 3.");
    expect(visivel).not.toContain("O assistente ainda não foi publicado.");
    expect(visivel).toContain("Não foi possível carregar as versões");
  });

  it("o rodapé fica no pé da área de conteúdo nas abas curtas (mt-auto, achado 32)", () => {
    const html = render(dadosDeTeste());
    const rodape = html.match(/<footer[^>]*>/)?.[0] ?? "";
    expect(rodape).toContain("sticky");
    expect(rodape).toContain("mt-auto");
    // a raiz do painel cresce para ocupar a casca
    expect(html).toMatch(/^<div class="flex flex-1 flex-col gap-4"/);
  });

  it("Publicar alterações é o único lime da tela, em h-11", () => {
    const html = render(dadosDeTeste());
    const lime = html.match(/<button[^>]*data-variant="default"[^>]*>/g) ?? [];
    expect(lime).toHaveLength(1);
    expect(lime[0]).toContain('data-size="lg"');
    expect(html).toMatch(
      /data-variant="default"[^>]*>(?:(?!<\/button>).)*Publicar alterações/,
    );
  });

  it("sem nada para publicar, o botão fica desabilitado com a dica", () => {
    const config = configDeTeste({ base: [ITEM_ATIVO] });
    const html = render(
      dadosDeTeste({
        config,
        publicada: { ...config, status: "publicada" },
        base: [ITEM_ATIVO],
      }),
    );
    const botao = html.match(/<button[^>]*data-variant="default"[^>]*>/)?.[0];
    expect(botao).toMatch(/ disabled=""/);
  });

  it("sem rascunho salvo, não há o que publicar (nem a primeira versão)", () => {
    const html = render(dadosDeTeste({ temRascunho: false }));
    expect(texto(html)).toContain("Nenhuma alteração para publicar");
    const botao = html.match(/<button[^>]*data-variant="default"[^>]*>/)?.[0];
    expect(botao).toMatch(/ disabled=""/);
  });

  it("sem a leitura da base, não publica (e diz por quê na aba)", () => {
    const html = render(dadosDeTeste({ base: null }));
    const botao = html.match(/<button[^>]*data-variant="default"[^>]*>/)?.[0];
    expect(botao).toMatch(/ disabled=""/);
    expect(texto(html)).toContain("Não foi possível carregar as perguntas");
  });
});

describe("instruções da equipe Conduzza nas alterações (S5, achados 16, 35 e 38)", () => {
  const config = configDeTeste({ base: [ITEM_ATIVO] });
  const semMudanca = {
    config,
    publicada: { ...config, status: "publicada" as const },
    base: [ITEM_ATIVO],
    versoes: [VERSAO_2, VERSAO_1],
  };

  it("o gestor vê a linha quando o servidor diz que mudaram, sem o texto", () => {
    const html = render(
      dadosDeTeste({ ...semMudanca, instrucoesMudaram: true }),
      "versoes",
    );
    const visivel = texto(html);
    expect(visivel).toContain("1 alteração não publicada");
    // na Proxima versao das Versões
    expect(visivel).toMatch(/Próxima versão .*Instruções da equipe Conduzza/);
    // e o Publicar libera: ha o que publicar
    const botao = html.match(/<button[^>]*data-variant="default"[^>]*>/)?.[0];
    expect(botao).toBeDefined();
    expect(botao).not.toMatch(/ disabled=""/);
  });

  it("o servidor não conferiu (null): a linha não é inventada", () => {
    const visivel = texto(
      render(
        dadosDeTeste({ ...semMudanca, instrucoesMudaram: null }),
        "versoes",
      ),
    );
    expect(visivel).toContain("Nenhuma alteração para publicar");
    expect(visivel).not.toContain("Instruções da equipe Conduzza");
  });

  it("super admin: instruções lidas e publicada sem o texto não criam alteração fantasma", () => {
    // A publicada chega sem as instrucoes (a sessao nao le a coluna); o
    // servidor disse que nao mudaram.
    const visivel = texto(
      render(
        dadosDeTeste({
          ...semMudanca,
          superAdmin: true,
          config: { ...config, instrucoes: "Fale do horário estendido." },
          instrucoesMudaram: false,
        }),
      ),
    );
    expect(visivel).toContain("Nenhuma alteração para publicar");
    expect(visivel).not.toContain("Instruções da equipe Conduzza");
  });

  it("primeira publicação com o servidor sem conferir: ainda há o que publicar", () => {
    const visivel = texto(
      render(
        dadosDeTeste({
          config: configDeTeste({
            ...configPadraoDoAgente(),
            instrucoes: "Fale do horário estendido.",
          }),
          base: [],
          superAdmin: true,
          instrucoesMudaram: null,
        }),
      ),
    );
    expect(visivel).toContain("1 alteração não publicada");
  });
});

describe("edição não salva no publicar (achado 27)", () => {
  function renderAviso(abas: string[]): string {
    return renderToStaticMarkup(
      <TooltipProvider>
        <NaoSalvosNoPublicar
          abas={abas}
          pendente={false}
          aoDescartar={vi.fn()}
        />
      </TooltipProvider>,
    );
  }

  it("lista as abas com o que não foi salvo e oferece descartar", () => {
    const html = renderAviso(["Persona", "Regras e limites"]);
    const visivel = texto(html);
    expect(html).toContain('data-tom="warning"');
    expect(visivel).toContain("Há alterações que não foram salvas");
    // ponto e virgula: "Persona e Regras e limites" parecia uma aba so
    expect(visivel).toContain("Em Persona; Regras e limites.");
    expect(visivel).toContain("A publicação leva só o que está salvo");
    expect(visivel).toContain("Descartar o que não foi salvo");
    expect(visivel).not.toMatch(/[\u2014\u2013]/);
  });

  it("sem nada pendente, nada aparece", () => {
    expect(renderAviso([])).toBe("");
  });
});

describe("recepção", () => {
  const html = render(
    dadosDeTeste({ podeEditar: false, dicaSemPermissao: DICA_RECEPCAO }),
  );
  const visivel = texto(html);

  it("ve o aviso de só leitura com a dica", () => {
    expect(visivel).toContain(
      "Você vê a configuração do assistente sem alterar. Somente administradores e gestores alteram o agente de IA.",
    );
  });

  it("os botões de salvar e publicar ficam visíveis e desabilitados", () => {
    for (const rotulo of [
      "Salvar persona",
      "Salvar horário",
      "Publicar alterações",
    ]) {
      expect(visivel).toContain(rotulo);
      const botao = html.match(
        new RegExp(`<button[^>]*>(?:(?!</button>).)*${rotulo}`),
      )?.[0];
      expect(botao, rotulo).toMatch(/<button[^>]*disabled=""/);
    }
  });

  it("a chave livre de habilidade fica desabilitada; os formulários, travados", () => {
    const livre = tags(html, "switch").filter(
      (tag) => !tag.includes('aria-disabled="true"'),
    );
    expect(livre).toHaveLength(1);
    expect(livre[0]).toContain('disabled=""');
    expect(html).toMatch(/<fieldset disabled=""/);
  });

  it("o simulador fica desabilitado, com a mensagem visível", () => {
    expect(html).toMatch(
      /<textarea[^>]*id="agente-simulador-mensagem"[^>]*disabled=""/,
    );
  });
});

describe("travas da Conformidade e dos gatilhos (C24)", () => {
  const html = render(dadosDeTeste());
  const travadas = tags(html, "switch").filter((tag) =>
    tag.includes('aria-disabled="true"'),
  );

  it("as 8 travas, os 6 gatilhos e as 2 habilidades obrigatórias ficam ligadas", () => {
    expect(travadas).toHaveLength(8 + 6 + 2);
    for (const tag of travadas) {
      expect(tag).toContain('aria-checked="true"');
      // a pele de ligada mesmo com o data-state da dica por cima
      expect(tag).toContain('data-checked=""');
      // opacidade cheia: sem o disabled do Radix (data-disabled = 45%)
      expect(tag).not.toMatch(/ disabled=""/);
      expect(tag).not.toMatch(/ data-disabled=""/);
    }
  });

  it("a caixa âmbar tem o texto do brief e a dica da trava", () => {
    const visivel = texto(html);
    expect(visivel).toContain(TEXTO_DA_CONFORMIDADE.texto);
    expect(html).toMatch(
      /data-tom="warning"[^>]*>(?:(?!<\/section>).)*Conformidade/,
    );
    expect(visivel).toContain("Obrigatória, não pode ser desligada");
    for (const { rotulo } of TEXTO_DA_CONFORMIDADE.travas) {
      expect(visivel).toContain(rotulo);
    }
  });

  it("a habilidade livre (preço e convênio) é uma chave que liga e desliga", () => {
    const livre = tags(html, "switch").filter(
      (tag) => !tag.includes('aria-disabled="true"'),
    );
    expect(livre).toHaveLength(1);
    expect(livre[0]).toContain('aria-checked="true"');
    expect(livre[0]).toContain('data-state="checked"');
    expect(livre[0]).not.toMatch(/ disabled=""/);
    expect(texto(html)).toContain("Informar preço e convênio");
  });
});

describe("copia da tela", () => {
  it("sem travessão e sem jargão, para quem configura e para a recepção", () => {
    for (const dados of [
      dadosDeTeste(),
      dadosDeTeste({ podeEditar: false, dicaSemPermissao: DICA_RECEPCAO }),
      dadosDeTeste({ versoes: [VERSAO_2, VERSAO_1] }),
    ]) {
      const visivel = texto(render(dados));
      expect(visivel).not.toMatch(/[\u2014\u2013]/);
      expect(visivel).not.toMatch(
        /\b(prompt|token|LLM|skill|tenant|handoff|opt-in)\b/i,
      );
    }
  });
});
