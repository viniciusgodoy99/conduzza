import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

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
// [AG6b mídia] o calculo do servidor (lib/agente/midia-no-servidor.ts) e
// server-only.
vi.mock("server-only", () => ({}));

const { AbaHabilidades, descricaoDaChave, notaDaFaseDeTeste } =
  await import("@/components/agente/aba-habilidades");
const { CALIBRAGEM_DO_SERVIDOR, midiaNoServidor } =
  await import("@/lib/agente/midia-no-servidor");
// Revisao R3 de d1a15f6 (3): o plano do turno, para a dica bater com ele.
const { tokensDoArquivoNaReserva } = await import("@/lib/agente/midia");
const { PainelDoAgente } = await import("@/components/agente/painel-do-agente");
const { Simulador } = await import("@/components/agente/simulador");
const {
  dicaDaMidiaNoServidor,
  HABILIDADES_DE_MIDIA,
  midiaLigadaNasHabilidades,
  TEXTOS_DA_MIDIA,
} = await import("@/components/agente/textos");
const { configDeTeste, dadosDeTeste } = await import("./tela-fixtures");

const AGENDA: AgendaDoAgente = { antecedenciaHoras: null, horizonteDias: null };

/**
 * O que o desenho diz, letra por letra (a configuracao tem de bater). A
 * nota, desde a revisao das telas da AG6b (item 4): "os telefones
 * cadastrados na aba WhatsApp", e nao "da equipe" (o telefone de paciente
 * usado mesmo assim que confirmou o aviso novo tambem manda midia, D-95).
 */
const DO_DESENHO = {
  ler_audio: {
    titulo: "Entender áudio",
    descricao:
      "Transcreve o áudio que a pessoa manda e responde por escrito. Áudio sem fala, longo demais ou que não deu para transcrever passa para a equipe.",
    nota: "A transcrição é feita pela OpenAI, nos EUA, com a chave do Conduzza, só nas conversas com o assistente. Por enquanto, só com os telefones cadastrados na aba WhatsApp que confirmaram o aviso de áudio, foto e documento.",
  },
  ler_imagem_e_documento: {
    titulo: "Ler imagem e documento",
    descricao:
      "Lê a foto ou o PDF de um pedido de exame ou procedimento e responde sobre os itens que a clínica faz. Resultado, laudo, receita, foto do corpo, carteirinha, guia e documento pessoal passam para a equipe.",
    nota: "A foto ou o PDF vai uma vez para a OpenAI, nos EUA, sem o nome do arquivo e sem a localização da foto. Por enquanto, só com os telefones cadastrados na aba WhatsApp que confirmaram o aviso de áudio, foto e documento.",
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

// ---------------------------------------------------------------------------
// [AG6b mídia] Revisao das telas da AG6b
// ---------------------------------------------------------------------------

const SEM_A_PROVA = { audio: false, arquivo: false } as const;
const CALIBRADO = { audio: true, arquivo: true } as const;

/** O span da dica do servidor da habilidade, ou "" sem ele. */
function dicaDoServidorNa(html: string, chave: string): string {
  return (
    new RegExp(
      `<span id="agente-habilidade-${chave}-no-servidor"[^>]*>[^<]*</span>`,
    ).exec(html)?.[0] ?? ""
  );
}

describe("a nota diz quem manda mídia (item 4)", () => {
  it("os telefones cadastrados na aba WhatsApp, não só os da equipe (o de paciente usado mesmo assim também)", () => {
    for (const chave of MIDIA) {
      const nota = notaDaFaseDeTeste(chave) ?? "";
      expect(nota).toContain(
        "só com os telefones cadastrados na aba WhatsApp que confirmaram o aviso de áudio, foto e documento.",
      );
      expect(nota).not.toContain("telefones da equipe");
      expect(nota).not.toMatch(/[—–]/);
    }
  });
});

describe("a habilidade que o servidor ainda não deixa valer (item 3)", () => {
  it("o cálculo do servidor: só as constantes da calibragem; hoje, tudo vale", () => {
    // O estado de hoje (decisao do dono de 06/11/2026: a prova paga, D-100,
    // foi dispensada; os tetos sao os de lib/integrations/llm/leitor-de-midia.ts).
    expect(CALIBRAGEM_DO_SERVIDOR).toEqual({
      transcricaoCalibrada: true,
      tetoPorImagem: 10_000,
      tetoPorPagina: 12_000,
    });
    expect(midiaNoServidor()).toEqual(CALIBRADO);
    expect(
      midiaNoServidor({
        transcricaoCalibrada: false,
        tetoPorImagem: null,
        tetoPorPagina: null,
      }),
    ).toEqual(SEM_A_PROVA);
    // Cada uma pela sua constante.
    expect(
      midiaNoServidor({
        transcricaoCalibrada: true,
        tetoPorImagem: 1_600,
        tetoPorPagina: 2_000,
      }),
    ).toEqual(CALIBRADO);
    expect(
      midiaNoServidor({
        transcricaoCalibrada: true,
        tetoPorImagem: null,
        tetoPorPagina: null,
      }),
    ).toEqual({ audio: true, arquivo: false });
    // Revisao R3 de d1a15f6 (3): um teto so ja faz um tipo de arquivo sair
    // para a OpenAI (o plano libera cada tipo pelo seu teto). A dica "Ainda
    // nao esta valendo" (foto e documento vao para a equipe) prometeria mais
    // privacidade do que o servidor cumpre: com um teto, sem dica.
    for (const [tetoPorImagem, tetoPorPagina] of [
      [1_600, null],
      [null, 2_000],
    ] as const) {
      const noServidor = midiaNoServidor({
        transcricaoCalibrada: false,
        tetoPorImagem,
        tetoPorPagina,
      });
      expect(noServidor.arquivo).toBe(true);
      expect(dicaDaMidiaNoServidor(HABILIDADE_DO_ARQUIVO, noServidor)).toBeNull();
    }
  });

  it("a dica so aparece quando NADA de foto e documento sai pelo plano do turno (a tela nunca promete mais privacidade do que o servidor cumpre)", () => {
    for (const tetoPorImagem of [null, 1_600]) {
      for (const tetoPorPagina of [null, 2_000]) {
        const tetos = { imagem: tetoPorImagem, pagina: tetoPorPagina };
        // O que o plano do turno deixa ir ao leitor (lib/agente/midia.ts):
        // a foto pelo teto da imagem, o PDF pelo da pagina.
        const algumSai =
          tokensDoArquivoNaReserva("imagem", "image/jpeg", tetos) !== null ||
          tokensDoArquivoNaReserva("documento", "application/pdf", tetos) !==
            null;
        const dica = dicaDaMidiaNoServidor(
          HABILIDADE_DO_ARQUIVO,
          midiaNoServidor({
            transcricaoCalibrada: false,
            tetoPorImagem,
            tetoPorPagina,
          }),
        );
        expect(dica === null).toBe(algumSai);
      }
    }
  });

  it("a dica de cada habilidade de mídia; nada nas outras, nada sem a leitura", () => {
    expect(dicaDaMidiaNoServidor(HABILIDADE_DO_AUDIO, SEM_A_PROVA)).toBe(
      TEXTOS_DA_MIDIA.audioDesligado,
    );
    expect(dicaDaMidiaNoServidor(HABILIDADE_DO_ARQUIVO, SEM_A_PROVA)).toBe(
      TEXTOS_DA_MIDIA.arquivoDesligado,
    );
    expect(
      dicaDaMidiaNoServidor(HABILIDADE_DO_AUDIO, {
        audio: true,
        arquivo: false,
      }),
    ).toBeNull();
    expect(
      dicaDaMidiaNoServidor(HABILIDADE_DO_ARQUIVO, {
        audio: false,
        arquivo: true,
      }),
    ).toBeNull();
    for (const chave of MIDIA) {
      expect(dicaDaMidiaNoServidor(chave, CALIBRADO)).toBeNull();
      expect(dicaDaMidiaNoServidor(chave, undefined)).toBeNull();
      expect(dicaDaMidiaNoServidor(chave, null)).toBeNull();
    }
    expect(dicaDaMidiaNoServidor("agendar", SEM_A_PROVA)).toBeNull();
  });

  it("os textos: de recepcionista, sem travessão, sem jargão", () => {
    expect(TEXTOS_DA_MIDIA.audioDesligado).toBe(
      "Ainda não está valendo: a Conduzza desligou o áudio por enquanto. Até voltar, o áudio vai para a equipe.",
    );
    expect(TEXTOS_DA_MIDIA.arquivoDesligado).toBe(
      "Ainda não está valendo: a Conduzza desligou foto e documento por enquanto. Até voltar, foto e documento vão para a equipe.",
    );
    for (const frase of [
      TEXTOS_DA_MIDIA.audioDesligado,
      TEXTOS_DA_MIDIA.arquivoDesligado,
    ]) {
      expect(frase).not.toMatch(/[—–]/);
      expect(frase).not.toMatch(
        /\b(handoff|tenant|opt-in|upload|whisper|transcribe|LLM|token|servidor|calibra\w*|prova)\b/i,
      );
    }
  });

  it("na aba, sem a prova: a dica escrita embaixo da nota, ligada ou desligada, com a chave livre", () => {
    for (const ligadas of [false, true]) {
      const html = habilidades({
        habilidades: habilidadesEfetivas({
          ler_audio: ligadas,
          ler_imagem_e_documento: ligadas,
        }),
        midiaNoServidor: SEM_A_PROVA,
      });
      for (const [chave, dica] of [
        [HABILIDADE_DO_AUDIO, TEXTOS_DA_MIDIA.audioDesligado],
        [HABILIDADE_DO_ARQUIVO, TEXTOS_DA_MIDIA.arquivoDesligado],
      ] as const) {
        // A dica escrita (como a da dependencia: so texto, sem chip).
        expect(dicaDoServidorNa(html, chave)).toBe(
          `<span id="agente-habilidade-${chave}-no-servidor" class="text-xs font-semibold text-text-secondary">${dica}</span>`,
        );
        // Embaixo da nota.
        expect(html.indexOf(DO_DESENHO[chave].nota)).toBeLessThan(
          html.indexOf(dica),
        );
        // A chave continua livre (ligar so vale depois da prova; desligar
        // nunca trava) e diz o estado.
        const tag = chaveDa(html, chave);
        expect(tag).not.toMatch(/ disabled=""/);
        expect(tag).toContain(`aria-checked="${ligadas}"`);
      }
    }
  });

  it("calibrado, ou sem a leitura do servidor: sem a dica", () => {
    for (const props of [{ midiaNoServidor: CALIBRADO }, {}]) {
      const html = habilidades(props);
      for (const chave of MIDIA) {
        expect(dicaDoServidorNa(html, chave)).toBe("");
      }
      expect(html).not.toContain(TEXTOS_DA_MIDIA.audioDesligado);
      expect(html).not.toContain(TEXTOS_DA_MIDIA.arquivoDesligado);
    }
  });

  it("recepção: a dica continua, com a chave presa pela permissão", () => {
    const html = habilidades({
      podeEditar: false,
      dica: DICA_RECEPCAO,
      midiaNoServidor: SEM_A_PROVA,
    });
    for (const chave of MIDIA) {
      expect(chaveDa(html, chave)).toMatch(/ disabled=""/);
      expect(dicaDoServidorNa(html, chave)).not.toBe("");
    }
  });

  it(
    "o painel leva o que a página calculou até a aba",
    { timeout: 30_000 },
    () => {
      const comDica = painel(dadosDeTeste({ midiaNoServidor: SEM_A_PROVA }));
      expect(comDica).toContain(TEXTOS_DA_MIDIA.audioDesligado);
      expect(comDica).toContain(TEXTOS_DA_MIDIA.arquivoDesligado);
      const semDica = painel(dadosDeTeste({ midiaNoServidor: CALIBRADO }));
      expect(semDica).not.toContain(TEXTOS_DA_MIDIA.audioDesligado);
      expect(semDica).not.toContain(TEXTOS_DA_MIDIA.arquivoDesligado);
    },
  );

  it("o SDK nunca vai ao navegador: o cálculo é server-only e só a página da Tela 6 o usa", () => {
    const servidor = readFileSync("lib/agente/midia-no-servidor.ts", "utf8");
    expect(servidor.startsWith('import "server-only";')).toBe(true);
    // So as constantes: nenhuma chamada ao SDK, nenhum cliente.
    expect(servidor).not.toMatch(/from "openai"|transcreverAudio|lerArquivoComOModelo|criarClienteOpenAi/);
    const pagina = readFileSync("app/(app)/agente/page.tsx", "utf8");
    expect(pagina).toContain(
      'import { midiaNoServidor } from "@/lib/agente/midia-no-servidor";',
    );
    expect(pagina).toContain("midiaNoServidor: midiaNoServidor(),");
    expect(pagina).not.toMatch(/^"use client"/);
    // Nenhum outro arquivo de tela importa o calculo.
    const quemImporta: string[] = [];
    const varrer = (pasta: string) => {
      for (const nome of readdirSync(pasta)) {
        const caminho = path.join(pasta, nome);
        if (statSync(caminho).isDirectory()) {
          varrer(caminho);
        } else if (/\.(ts|tsx)$/.test(nome)) {
          if (
            readFileSync(caminho, "utf8").includes(
              "@/lib/agente/midia-no-servidor",
            )
          ) {
            quemImporta.push(caminho);
          }
        }
      }
    };
    varrer("app");
    varrer("components");
    expect(quemImporta).toEqual([path.join("app", "(app)", "agente", "page.tsx")]);
  });
});

describe("a descrição da chave (item 7)", () => {
  it("a nota da OpenAI entra no aria-describedby da chave; sem a prova, a dica do servidor também, na ordem da tela", () => {
    const calibrado = habilidades({ midiaNoServidor: CALIBRADO });
    const semAProva = habilidades({ midiaNoServidor: SEM_A_PROVA });
    for (const chave of MIDIA) {
      expect(chaveDa(calibrado, chave)).toContain(
        `aria-describedby="agente-habilidade-${chave}-fase-de-teste"`,
      );
      expect(chaveDa(semAProva, chave)).toContain(
        `aria-describedby="agente-habilidade-${chave}-fase-de-teste agente-habilidade-${chave}-no-servidor"`,
      );
      // Cada id da descricao existe uma vez na tela.
      for (const sufixo of ["fase-de-teste", "no-servidor"]) {
        expect(
          semAProva.match(
            new RegExp(`id="agente-habilidade-${chave}-${sufixo}"`, "g"),
          ),
        ).toHaveLength(1);
      }
    }
  });

  it("as outras notas também (cancelar, remarcar, confirmar presença, lista de espera); sem nota, sem descrição", () => {
    const html = habilidades();
    for (const chave of [
      "cancelar",
      "remarcar",
      "lista_de_espera",
      "confirmar_presenca",
    ]) {
      expect(chaveDa(html, chave)).toMatch(
        new RegExp(
          `aria-describedby="agente-habilidade-${chave}-fase-de-teste( [^"]+)?"`,
        ),
      );
    }
    // "Informar preço e convênio": sem nota, sem dica, sem descricao.
    expect(chaveDa(html, "informar_preco_e_convenio")).not.toContain(
      "aria-describedby",
    );
  });

  it("descricaoDaChave: os ids presentes, na ordem; nada, sem atributo", () => {
    expect(descricaoDaChave(["a", null, "c"])).toBe("a c");
    expect(descricaoDaChave([null, null])).toBeUndefined();
    expect(descricaoDaChave([])).toBeUndefined();
  });
});
