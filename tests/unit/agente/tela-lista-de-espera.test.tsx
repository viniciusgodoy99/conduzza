import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DICA_DA_LISTA_DE_ESPERA_INCOMPLETA,
  HABILIDADES_DO_AGENTE,
  habilidadesEfetivas,
  prazosPadrao,
  type AgendaDoAgente,
} from "@/lib/domain/agente/config";

import { DICA_RECEPCAO, ITEM_ATIVO, VERSAO_2 } from "./tela-fixtures";

// AG5 na Tela 6 (desenho, secao 6; decisoes D-36, D-39 e D-45 pela
// recomendacao, pendentes do dono): a habilidade "Lista de espera" na aba
// Habilidades (titulo, descricao e dica da configuracao; desligada por
// padrao; so com "Agendar consulta" valendo, desabilitada com a dica escrita
// e no cursor; a dica de permissao vence), a nota propria da fase de teste
// (o SIM a oferta marca na hora), o cabecalho das habilidades (so o encaixe
// continua com a equipe), o "o que mudou" pela lista de habilidades, nenhum
// campo novo em Regras e limites e o cenario do simulador. Tudo renderizado
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

const {
  AbaHabilidades,
  HABILIDADES_SO_COM_TELEFONE_DA_CONDUZZA,
  notaDaFaseDeTeste,
} = await import("@/components/agente/aba-habilidades");
const { PainelDoAgente } = await import("@/components/agente/painel-do-agente");
const { CENARIOS_DO_SIMULADOR, ehCenario, TEXTOS_DO_AGENTE } =
  await import("@/components/agente/textos");
const { configDeTeste, dadosDeTeste } = await import("./tela-fixtures");

const AGENDA: AgendaDoAgente = { antecedenciaHoras: 2, horizonteDias: 30 };
const SEM_AGENDA: AgendaDoAgente = {
  antecedenciaHoras: null,
  horizonteDias: null,
};
const LISTA = "lista_de_espera";

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
        agenda={SEM_AGENDA}
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

describe("a habilidade Lista de espera", () => {
  const definicao = HABILIDADES_DO_AGENTE.find((h) => h.chave === LISTA);

  it("a chave, o título, a descrição e a dica vêm da configuração; desligada por padrão", () => {
    expect(definicao).toBeDefined();
    expect(definicao?.titulo).toBe("Lista de espera");
    expect(definicao?.padrao).toBe(false);
    expect(definicao?.travada).toBe(false);
    expect(definicao?.precisaDaHabilidade).toBe("agendar");
    expect(definicao?.dicaDaDependencia).toBe(
      DICA_DA_LISTA_DE_ESPERA_INCOMPLETA,
    );
    expect(DICA_DA_LISTA_DE_ESPERA_INCOMPLETA).toBe(
      "Ligue Agendar consulta para usar a lista de espera.",
    );
    expect(definicao?.descricao).toBe(
      "Coloca o paciente na lista de espera quando não há horário que sirva, com a confirmação dele numa mensagem nova. Quando um horário assim vagar, a oferta sai pela reoferta automática da Lista de espera.",
    );

    const html = habilidades();
    const visivel = texto(html);
    expect(visivel).toContain("Lista de espera");
    expect(visivel).toContain(definicao?.descricao ?? "");
    expect(chaveDa(html, LISTA)).toContain('aria-checked="false"');
    // Depois de Remarcar consulta e antes de Confirmar presença.
    const remarcar = html.indexOf('id="agente-habilidade-remarcar"');
    const lista = html.indexOf(`id="agente-habilidade-${LISTA}"`);
    const confirmar = html.indexOf('id="agente-habilidade-confirmar_presenca"');
    expect(remarcar).toBeGreaterThan(-1);
    expect(lista).toBeGreaterThan(remarcar);
    expect(confirmar).toBeGreaterThan(lista);
  });

  it("sem Agendar consulta valendo: desabilitada, com a dica escrita (ligada à chave) e no cursor", () => {
    // Sem a agenda, e com a agenda completa mas Agendar desligada.
    for (const props of [
      { agenda: SEM_AGENDA },
      { agenda: AGENDA },
      {
        agenda: SEM_AGENDA,
        habilidades: habilidadesEfetivas({ agendar: true }),
      },
    ]) {
      const html = habilidades(props);
      const tag = chaveDa(html, LISTA);
      expect(tag).toMatch(/ disabled=""/);
      // [AG6b mídia] Desde a revisao das telas da AG6b (item 7), a nota
      // tambem descreve a chave, na ordem da tela: a nota, depois a dica.
      expect(tag).toContain(
        `aria-describedby="agente-habilidade-${LISTA}-fase-de-teste agente-habilidade-${LISTA}-agenda"`,
      );
      expect(html).toContain(
        `<span id="agente-habilidade-${LISTA}-agenda" class="text-xs font-semibold text-text-secondary">${DICA_DA_LISTA_DE_ESPERA_INCOMPLETA}</span>`,
      );
      expect(html).toMatch(
        new RegExp(
          `<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*aria-labelledby="agente-habilidade-${LISTA}"`,
        ),
      );
    }
  });

  it("com Agendar consulta valendo: a chave liga e desliga, sem a dica", () => {
    const html = habilidades({
      agenda: AGENDA,
      habilidades: habilidadesEfetivas({ agendar: true }),
    });
    const tag = chaveDa(html, LISTA);
    expect(tag).not.toMatch(/ disabled=""/);
    // [AG6b mídia] So a nota descreve a chave (revisao das telas da AG6b,
    // item 7); a dica da dependencia nao.
    expect(tag).toContain(
      `aria-describedby="agente-habilidade-${LISTA}-fase-de-teste"`,
    );
    expect(texto(html)).not.toContain(DICA_DA_LISTA_DE_ESPERA_INCOMPLETA);

    const ligada = habilidades({
      agenda: AGENDA,
      habilidades: habilidadesEfetivas({ agendar: true, [LISTA]: true }),
    });
    expect(chaveDa(ligada, LISTA)).toContain('aria-checked="true"');
  });

  it("ligada no rascunho, mas sem Agendar valendo: a tela diz Desligada (falha fechada)", () => {
    const html = habilidades({
      agenda: AGENDA,
      habilidades: { ...habilidadesEfetivas({}), [LISTA]: true },
    });
    expect(chaveDa(html, LISTA)).toContain('aria-checked="false"');
  });

  it("recepção: desabilitada com a dica de permissão, que vence a da dependência", () => {
    const html = habilidades({
      podeEditar: false,
      dica: DICA_RECEPCAO,
      agenda: AGENDA,
      habilidades: habilidadesEfetivas({ agendar: true }),
    });
    expect(chaveDa(html, LISTA)).toMatch(/ disabled=""/);
    expect(html).toMatch(
      new RegExp(
        `<span tabindex="0"[^>]*cursor-not-allowed[^>]*><button[^>]*aria-labelledby="agente-habilidade-${LISTA}"`,
      ),
    );
  });
});

describe("a nota da fase de teste", () => {
  it("a Lista de espera leva a nota própria: o SIM à oferta marca a consulta na hora", () => {
    expect(TEXTOS_DO_AGENTE.listaDeEsperaNaFaseDeTeste).toBe(
      "Nesta fase de teste, o SIM à oferta da lista de espera marca a consulta na hora: o contato vira paciente, e um telefone comum deixa de acionar o assistente.",
    );
    const html = habilidades();
    expect(html).toContain(
      `<span id="agente-habilidade-${LISTA}-fase-de-teste" class="text-xs text-text-secondary">${TEXTOS_DO_AGENTE.listaDeEsperaNaFaseDeTeste}</span>`,
    );
  });

  it("as outras continuam com a nota do telefone; as sem nota continuam sem", () => {
    expect(notaDaFaseDeTeste(LISTA)).toBe(
      TEXTOS_DO_AGENTE.listaDeEsperaNaFaseDeTeste,
    );
    expect(HABILIDADES_SO_COM_TELEFONE_DA_CONDUZZA.has(LISTA)).toBe(false);
    for (const chave of ["cancelar", "remarcar", "confirmar_presenca"]) {
      expect(notaDaFaseDeTeste(chave), chave).toBe(
        TEXTOS_DO_AGENTE.habilidadeNaFaseDeTeste,
      );
    }
    for (const chave of [
      "responder_duvidas",
      "informar_preco_e_convenio",
      "agendar",
      "passar_para_equipe",
    ]) {
      expect(notaDaFaseDeTeste(chave), chave).toBeNull();
    }
    const html = habilidades();
    // [AG6b mídia] início
    // AG6b: "Entender áudio" e "Ler imagem e documento" tambem levam nota
    // (a da configuracao, tests/unit/agente/telas-ag6b.test.tsx): 4 + 2. As
    // notas escritas (o span com o id; o id tambem vai na descricao da
    // chave desde a revisao das telas da AG6b).
    expect(html.match(/<span id="[^"]*-fase-de-teste"/g)).toHaveLength(6);
    // [AG6b mídia] fim
  });

  it("é nota, não status: só texto, sem chip nem cor própria", () => {
    const html = habilidades();
    const nota = html.match(
      new RegExp(`<span id="agente-habilidade-${LISTA}-fase-de-teste"[^>]*>`),
    )?.[0];
    expect(nota).toBe(
      `<span id="agente-habilidade-${LISTA}-fase-de-teste" class="text-xs text-text-secondary">`,
    );
  });
});

describe("o cabeçalho das habilidades", () => {
  it("só o encaixe continua com a equipe", () => {
    expect(TEXTOS_DO_AGENTE.habilidadesDescricao).toBe(
      "O que o assistente pode fazer na conversa. Encaixe continua com a equipe.",
    );
    expect(texto(habilidades())).not.toContain("Lista de espera e encaixe");
  });
});

describe("no painel", () => {
  it("a aba Habilidades mostra a chave com a agenda e as habilidades do rascunho", () => {
    const html = painel(
      dadosDeTeste({
        config: configDeTeste({
          agenda: AGENDA,
          habilidades: habilidadesEfetivas({ agendar: true, [LISTA]: true }),
        }),
      }),
    );
    expect(chaveDa(html, LISTA)).toContain('aria-checked="true"');
    expect(chaveDa(html, LISTA)).not.toMatch(/ disabled=""/);
  });

  it("o que mudou sai da lista de habilidades: Lista de espera ligada conta uma vez", () => {
    const publicada = {
      ...configDeTeste({
        base: [ITEM_ATIVO],
        agenda: AGENDA,
        habilidades: habilidadesEfetivas({ agendar: true }),
      }),
      status: "publicada" as const,
    };
    const html = painel(
      dadosDeTeste({
        config: configDeTeste({
          base: [ITEM_ATIVO],
          agenda: AGENDA,
          habilidades: habilidadesEfetivas({ agendar: true, [LISTA]: true }),
        }),
        publicada,
        base: [ITEM_ATIVO],
        versoes: [VERSAO_2],
      }),
      "versoes",
    );
    const visivel = texto(html);
    expect(visivel).toContain("Lista de espera: ligada");
    expect(visivel).toContain("1 alteração não publicada");
  });

  it("nenhum campo novo em Regras e limites", () => {
    const html = painel(dadosDeTeste(), "regras");
    const rotulos = (
      html.match(/<label[^>]*>(?:(?!<\/label>).)*<\/label>/g) ?? []
    )
      .map(texto)
      .join(" | ");
    // Os campos de sempre estao la (a leitura nao e vazia)...
    expect(rotulos).toContain(TEXTOS_DO_AGENTE.antecedencia);
    // ...e nenhum e da lista de espera.
    expect(rotulos).not.toMatch(/lista de espera/i);
  });
});

describe("o simulador", () => {
  it("o cenário Paciente querendo lista de espera, sem dado pessoal", () => {
    const cenario = CENARIOS_DO_SIMULADOR.find((c) => c.chave === LISTA);
    expect(cenario).toEqual({
      chave: LISTA,
      rotulo: "Paciente querendo lista de espera",
      mensagem:
        "Oi, queria entrar na lista de espera para um horário de manhã.",
    });
    expect(ehCenario(LISTA)).toBe(true);
    // O ultimo da lista, depois de cancelar e remarcar (AG4).
    expect(CENARIOS_DO_SIMULADOR.at(-1)?.chave).toBe(LISTA);
    expect(cenario?.mensagem).not.toMatch(/\d{4,}|@/);
    // "vaga" e palavra que o filtro le como horario livre: fora do exemplo.
    expect(cenario?.mensagem).not.toMatch(/\bvaga\b/i);
  });

  it("a descrição diz que a lista de espera no simulador não grava nada", () => {
    expect(TEXTOS_DO_AGENTE.simuladorDescricao).toContain(
      "reservar, marcar, cancelar, remarcar e colocar na lista de espera aqui não gravam nada",
    );
  });
});

describe("cópia", () => {
  it("sem travessão e sem jargão", () => {
    const T = TEXTOS_DO_AGENTE;
    const lista = HABILIDADES_DO_AGENTE.find((h) => h.chave === LISTA);
    const amostras: [string, string][] = [
      ["listaDeEsperaNaFaseDeTeste", T.listaDeEsperaNaFaseDeTeste],
      ["habilidadesDescricao", T.habilidadesDescricao],
      ["simuladorDescricao", T.simuladorDescricao],
      ["dica", DICA_DA_LISTA_DE_ESPERA_INCOMPLETA],
      ["titulo", lista?.titulo ?? ""],
      ["descricao", lista?.descricao ?? ""],
      ["habilidades", texto(habilidades())],
      ...CENARIOS_DO_SIMULADOR.flatMap((c): [string, string][] => [
        [`${c.chave}.rotulo`, c.rotulo],
        [`${c.chave}.mensagem`, c.mensagem],
      ]),
    ];
    for (const [chave, amostra] of amostras) {
      expect(amostra, chave).not.toMatch(/[—–]/);
      expect(amostra, chave).not.toMatch(
        /\b(prompt|token|LLM|skill|tenant|handoff|opt-in|slot|hold|waitlist)\b/i,
      );
    }
  });
});
