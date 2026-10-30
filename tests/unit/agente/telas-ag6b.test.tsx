import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  HABILIDADE_DO_ARQUIVO,
  HABILIDADE_DO_AUDIO,
  HABILIDADES_DO_AGENTE,
  habilidadesEfetivas,
  prazosPadrao,
  type AgendaDoAgente,
} from "@/lib/domain/agente/config";

import { DICA_RECEPCAO, ITEM_ATIVO, VERSAO_2 } from "./tela-fixtures";

// AG6b na Tela 6 (desenho da AG6b, secao 6; D-60, D-62 e D-95 pela
// recomendacao, pendentes do dono): as duas habilidades de midia na aba
// Habilidades ("Entender áudio" e "Ler imagem e documento"; titulo,
// descricao e nota da configuracao; desligadas por padrao; a nota embaixo
// da descricao, para todos os papeis), a recepcao vendo a chave desabilitada
// com a dica de sempre, o "o que mudou" pela lista de habilidades e a nota
// do simulador (audio, foto e documento so no WhatsApp). Tudo renderizado
// no servidor; nada aqui chama acao nem rede.

vi.mock("@/components/agente/acoes", () => ({
  acoesDoAgente: {
    salvarPersona: vi.fn(),
    salvarHabilidades: vi.fn(),
    salvarHorario: vi.fn(),
    salvarAgenda: vi.fn(),
    salvarPublico: vi.fn(),
    salvarDadosExigidos: vi.fn(),
    salvarPrazos: vi.fn(),
    salvarPassagem: vi.fn(),
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

const { AbaHabilidades, notaDaFaseDeTeste } =
  await import("@/components/agente/aba-habilidades");
const { PainelDoAgente } = await import("@/components/agente/painel-do-agente");
const { Simulador } = await import("@/components/agente/simulador");
const { HABILIDADES_DE_MIDIA, midiaLigadaNasHabilidades, TEXTOS_DA_MIDIA } =
  await import("@/components/agente/textos");
const { configDeTeste, dadosDeTeste } = await import("./tela-fixtures");

const AGENDA: AgendaDoAgente = { antecedenciaHoras: null, horizonteDias: null };

/** O que o desenho diz, letra por letra (a configuracao tem de bater). */
const DO_DESENHO = {
  ler_audio: {
    titulo: "Entender áudio",
    descricao:
      "Transcreve o áudio que a pessoa manda e responde por escrito. Áudio sem fala, longo demais ou que não deu para transcrever passa para a equipe.",
    nota: "A transcrição é feita pela OpenAI, nos EUA, com a chave do Conduzza, só nas conversas com o assistente. Por enquanto, só com os telefones da equipe que confirmaram o aviso de áudio, foto e documento.",
  },
  ler_imagem_e_documento: {
    titulo: "Ler imagem e documento",
    descricao:
      "Lê a foto ou o PDF de um pedido de exame ou procedimento e responde sobre os itens que a clínica faz. Resultado, laudo, receita, foto do corpo, carteirinha, guia e documento pessoal passam para a equipe.",
    nota: "A foto ou o PDF vai uma vez para a OpenAI, nos EUA, sem o nome do arquivo e sem a localização da foto. Por enquanto, só com os telefones da equipe que confirmaram o aviso de áudio, foto e documento.",
  },
} as const;

const MIDIA = Object.keys(DO_DESENHO) as (keyof typeof DO_DESENHO)[];

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function chaveDa(html: string, habilidade: string): string {
  const chaves = html.match(/<button[^>]*role="switch"[^>]*>/g) ?? [];
  const achada = chaves.find((tag) =>
    tag.includes(`aria-labelledby="agente-habilidade-${habilidade}"`),
  );
  if (!achada) {
    throw new Error(`chave de ${habilidade} nao encontrada`);
  }
  return achada;
}

function habilidades(
  props: Partial<Parameters<typeof AbaHabilidades>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <AbaHabilidades
        habilidades={habilidadesEfetivas({})}
        agenda={AGENDA}
        prazos={prazosPadrao()}
        podeEditar
        dica={null}
        pendente={false}
        ocupado={() => false}
        aoAlternar={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  );
}

function painel(
  dados = dadosDeTeste(),
  abaInicial: string | undefined = "habilidades",
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <PainelDoAgente dados={dados} abaInicial={abaInicial} />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------

describe("as duas habilidades de mídia", () => {
  it("a chave, o título, a descrição e a nota vêm da configuração, como o desenho; desligadas por padrão, sem dependência", () => {
    expect([...HABILIDADES_DE_MIDIA]).toEqual([
      HABILIDADE_DO_AUDIO,
      HABILIDADE_DO_ARQUIVO,
    ]);
    expect([...HABILIDADES_DE_MIDIA]).toEqual(MIDIA);
    for (const chave of MIDIA) {
      const definicao = HABILIDADES_DO_AGENTE.find((h) => h.chave === chave);
      expect(definicao, chave).toBeDefined();
      expect(definicao).toMatchObject({
        ...DO_DESENHO[chave],
        travada: false,
        padrao: false,
        precisaDaAgenda: false,
        precisaDaHabilidade: null,
        precisaDoPrazo: null,
        dicaDaDependencia: null,
      });
      expect(habilidadesEfetivas({})[chave]).toBe(false);
    }
  });

  it("na aba: o título, a descrição e a nota, com a chave desligada e o estado escrito", () => {
    const html = habilidades();
    const visivel = texto(html);
    for (const chave of MIDIA) {
      const { titulo, descricao, nota } = DO_DESENHO[chave];
      expect(visivel).toContain(titulo);
      expect(visivel).toContain(descricao);
      // Nota, nao status: so texto, sem chip nem cor propria, logo embaixo
      // da descricao e ligada ao id da habilidade.
      expect(html).toContain(
        `<span id="agente-habilidade-${chave}-fase-de-teste" class="text-xs text-text-secondary">${nota}</span>`,
      );
      expect(html.indexOf(descricao)).toBeLessThan(html.indexOf(nota));
      const tag = chaveDa(html, chave);
      expect(tag).toContain('aria-checked="false"');
      expect(tag).not.toMatch(/ disabled=""/);
    }
    expect(visivel).toContain("Desligada");
  });

  it("ligada no rascunho: a chave diz ligada", () => {
    const html = habilidades({
      habilidades: habilidadesEfetivas({
        ler_audio: true,
        ler_imagem_e_documento: true,
      }),
    });
    for (const chave of MIDIA) {
      expect(chaveDa(html, chave)).toContain('aria-checked="true"');
    }
  });

  it("a nota mora na configuração: notaDaFaseDeTeste só a devolve", () => {
    for (const chave of MIDIA) {
      expect(notaDaFaseDeTeste(chave)).toBe(DO_DESENHO[chave].nota);
    }
    // As de antes continuam como estavam.
    expect(notaDaFaseDeTeste("informar_preco_e_convenio")).toBeNull();
    expect(notaDaFaseDeTeste("passar_para_equipe")).toBeNull();
    expect(notaDaFaseDeTeste("nao_existe")).toBeNull();
  });

  it("recepção: visível e desabilitada, com a dica de sempre no cursor; a nota continua", () => {
    const html = habilidades({ podeEditar: false, dica: DICA_RECEPCAO });
    for (const chave of MIDIA) {
      expect(chaveDa(html, chave)).toMatch(/ disabled=""/);
      expect(html).toMatch(
        new RegExp(
          `<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*aria-labelledby="agente-habilidade-${chave}"`,
        ),
      );
      expect(texto(html)).toContain(DO_DESENHO[chave].nota);
    }
  });

  it("administrador e gestor (podeEditar): a chave liga e desliga, sem dica", () => {
    const html = habilidades();
    for (const chave of MIDIA) {
      expect(html).not.toMatch(
        new RegExp(
          `<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*aria-labelledby="agente-habilidade-${chave}"`,
        ),
      );
    }
  });

  // O painel inteiro (as abas e o simulador): com a maquina ocupada, passa
  // dos 5 s padrao.
  it(
    "o que mudou: a habilidade ligada no rascunho aparece pelo título",
    { timeout: 30_000 },
    () => {
      const publicada = {
        ...configDeTeste({ base: [ITEM_ATIVO] }),
        status: "publicada" as const,
      };
      const html = painel(
        dadosDeTeste({
          config: configDeTeste({
            base: [ITEM_ATIVO],
            habilidades: habilidadesEfetivas({ ler_audio: true }),
          }),
          publicada,
          versoes: [VERSAO_2],
        }),
        "versoes",
      );
      expect(texto(html)).toContain("Entender áudio: ligada");
      expect(texto(html)).not.toContain("Ler imagem e documento: ligada");
    },
  );

  it("sem travessão e com linguagem de recepcionista", () => {
    for (const chave of MIDIA) {
      for (const frase of Object.values(DO_DESENHO[chave])) {
        expect(frase).not.toMatch(/[—–]/);
        expect(frase).not.toMatch(
          /\b(handoff|tenant|opt-in|upload|whisper|transcribe|LLM)\b/i,
        );
      }
    }
    expect(TEXTOS_DA_MIDIA.simulador).not.toMatch(/[—–]/);
    expect(habilidades()).not.toMatch(/[—–]/);
  });
});

// ---------------------------------------------------------------------------
// A midia ligada (o simulador e o chip do telefone)
// ---------------------------------------------------------------------------

describe("mídia ligada nas habilidades", () => {
  it("qualquer uma das duas, em qualquer lista (rascunho ou publicada); só o verdadeiro vale", () => {
    expect(midiaLigadaNasHabilidades()).toBe(false);
    expect(midiaLigadaNasHabilidades(null, undefined)).toBe(false);
    expect(midiaLigadaNasHabilidades(habilidadesEfetivas({}))).toBe(false);
    expect(midiaLigadaNasHabilidades({ ler_audio: true })).toBe(true);
    expect(
      midiaLigadaNasHabilidades(null, { ler_imagem_e_documento: true }),
    ).toBe(true);
    expect(
      midiaLigadaNasHabilidades({ ler_audio: false }, { ler_audio: true }),
    ).toBe(true);
    // As outras habilidades nao contam.
    expect(midiaLigadaNasHabilidades({ agendar: true })).toBe(false);
  });
});

describe("a nota do simulador (D-62)", () => {
  it("o texto do desenho", () => {
    expect(TEXTOS_DA_MIDIA.simulador).toBe(
      "Áudio, foto e documento só no WhatsApp, com os telefones da equipe.",
    );
  });

  it(
    "com alguma habilidade de mídia ligada no rascunho: a nota no simulador, só texto",
    { timeout: 30_000 },
    () => {
      for (const habilidadesDoRascunho of [
        { ler_audio: true },
        { ler_imagem_e_documento: true },
      ]) {
        const html = painel(
          dadosDeTeste({
            config: configDeTeste({
              base: [ITEM_ATIVO],
              habilidades: habilidadesEfetivas(habilidadesDoRascunho),
            }),
          }),
        );
        expect(html).toContain(
          `<p data-nota-da-midia="true" class="text-[12.5px] text-text-secondary">${TEXTOS_DA_MIDIA.simulador}</p>`,
        );
      }
    },
  );

  it("sem mídia ligada no rascunho: sem a nota", { timeout: 30_000 }, () => {
    expect(painel()).not.toContain(TEXTOS_DA_MIDIA.simulador);
  });

  it("o simulador sozinho, sem a prop, não muda", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <Simulador
          nomeDoAssistente="Ana"
          podeUsar
          dica={null}
          motivo={null}
          aoSimular={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(html).not.toContain("data-nota-da-midia");
  });
});
