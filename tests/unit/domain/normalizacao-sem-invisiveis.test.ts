import { describe, expect, it } from "vitest";

import {
  atribuirOrigem,
  normalizarTexto,
  reconhecerOrigem,
  type CampaignRule,
} from "@/lib/domain/attribution";
import { etapaPorTermoChave, type TermosDeQuem } from "@/lib/domain/jornada";
import {
  filtrarRespostas,
  type RespostaRapida,
} from "@/lib/domain/respostas-rapidas";

// Onda 5, item 17 (contrato A.2 e A.4): normalizarTexto passa a tirar as
// marcas combinantes (\p{M}) e os caracteres invisiveis de formatacao
// (\p{Cf}). O texto pronto do link de outra ferramenta chegou na producao com
// 263 a 267 invisiveis no meio (7 leads da Salud Care), e sem isso a mensagem
// pronta cadastrada nunca casaria. A normalizacao serve tambem ao termo-chave
// da jornada e a busca das mensagens padrao: as duas ganham o mesmo
// comportamento, sem regressao.
//
// Os invisiveis sao montados por String.fromCodePoint: nenhum fica escrito
// cru neste arquivo.

const c = (codigo: number) => String.fromCodePoint(codigo);

const LARGURA_ZERO = c(0x200b);
const NAO_JUNTA = c(0x200c);
const JUNTA = c(0x200d);
const JUNCAO_DE_PALAVRA = c(0x2060);
const BOM = c(0xfeff);
const SEPARADOR_MONGOL = c(0x180e);
const BIDI = [
  0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067,
  0x2068, 0x2069,
].map(c);
const SELETOR_DE_VARIACAO = c(0xfe0f);
const INVISIVEIS = [
  LARGURA_ZERO,
  NAO_JUNTA,
  JUNTA,
  JUNCAO_DE_PALAVRA,
  BOM,
  SEPARADOR_MONGOL,
];

/** Um bloco de `n` invisiveis, girando entre os seis vistos na producao. */
function blocoInvisivel(n: number): string {
  return Array.from(
    { length: n },
    (_, i) => INVISIVEIS[i % INVISIVEIS.length],
  ).join("");
}

describe("normalizarTexto sem caracteres invisíveis", () => {
  it.each([
    ["largura zero (U+200B)", LARGURA_ZERO],
    ["não junta (U+200C)", NAO_JUNTA],
    ["junta (U+200D)", JUNTA],
    ["junção de palavra (U+2060)", JUNCAO_DE_PALAVRA],
    ["marca de ordem de bytes (U+FEFF)", BOM],
    ["separador mongol (U+180E)", SEPARADOR_MONGOL],
  ])("tira %s do meio da palavra", (_nome, invisivel) => {
    expect(normalizarTexto(`ago${invisivel}ra`)).toBe("agora");
  });

  it("tira os controles bidirecionais", () => {
    for (const bidi of BIDI) {
      expect(normalizarTexto(`${bidi}Olá${bidi} mundo${bidi}`)).toBe(
        "ola mundo",
      );
    }
  });

  it("tira o seletor de variação do emoji e continua tirando acentos", () => {
    const coracao = `${c(0x2764)}${SELETOR_DE_VARIACAO}`;
    expect(normalizarTexto(`Promoção ${coracao}`)).toBe(
      `promocao ${c(0x2764)}`,
    );
    expect(normalizarTexto("ÇÃO é Ü")).toBe("cao e u");
  });

  it("bloco invisível entre espaços vira um espaço só; colado, junta as letras", () => {
    expect(normalizarTexto(`quero ${blocoInvisivel(265)} agendar`)).toBe(
      "quero agendar",
    );
    expect(normalizarTexto(`que${blocoInvisivel(12)}ro`)).toBe("quero");
  });

  it("texto só de invisíveis fica vazio", () => {
    expect(normalizarTexto(blocoInvisivel(40))).toBe("");
  });

  it("o que já funcionava continua igual", () => {
    expect(normalizarTexto("  Promoção   de  LIMPEZA\n hoje ")).toBe(
      "promocao de limpeza hoje",
    );
  });
});

// O texto pronto do link de outra ferramenta, sintetico: cerca de 400
// caracteres, 265 invisiveis num bloco no meio (o codigo da ferramenta
// escondido), como os 7 leads da Salud Care (nenhum texto real aqui).
const COMECO =
  "Olá! Vim pelo link do perfil da clínica no Instagram e gostaria de";
const FIM = "saber mais sobre a avaliação e os horários disponíveis.";
const TEXTO_DO_LINK = `${COMECO} ${blocoInvisivel(265)} ${FIM}`;

function regra(parcial: Partial<CampaignRule> & { id: string }): CampaignRule {
  return {
    token: null,
    channel: "redes_sociais",
    origin: "Instagram",
    medium: "Bio",
    campaign: null,
    defaultMessage: null,
    keywords: [],
    ...parcial,
  };
}

describe("atribuirOrigem com o texto pronto cheio de invisíveis", () => {
  it("o texto sintético tem o tamanho dos da produção", () => {
    expect(TEXTO_DO_LINK.length).toBeGreaterThanOrEqual(380);
    expect(TEXTO_DO_LINK.length).toBeLessThanOrEqual(420);
  });

  it("a mensagem pronta cadastrada sem os invisíveis casa", () => {
    const regras = [regra({ id: "bio", defaultMessage: `${COMECO} ${FIM}` })];
    expect(atribuirOrigem(TEXTO_DO_LINK, regras)).toEqual({
      channel: "redes_sociais",
      origin: "Instagram",
      medium: "Bio",
      campaign: null,
      method: "mensagem_padrao",
    });
  });

  it("a mensagem pronta copiada COM os invisíveis também casa", () => {
    const regras = [regra({ id: "bio", defaultMessage: TEXTO_DO_LINK })];
    expect(atribuirOrigem(`${COMECO} ${FIM}`, regras)?.method).toBe(
      "mensagem_padrao",
    );
  });

  it("a palavra-chave que atravessa o bloco invisível casa", () => {
    const corpo = `Quero agen${blocoInvisivel(265)}dar pelo perfil`;
    const regras = [regra({ id: "k", keywords: ["agendar"] })];
    expect(atribuirOrigem(corpo, regras)?.method).toBe("palavra_chave");
  });

  it("texto editado pelo paciente continua sem casar", () => {
    const regras = [regra({ id: "bio", defaultMessage: `${COMECO} ${FIM}` })];
    expect(
      atribuirOrigem(`${COMECO} ${blocoInvisivel(265)} quero preço`, regras),
    ).toBeNull();
  });
});

describe("reconhecerOrigem: a mesma decisão, com a regra que venceu", () => {
  const regras = [
    regra({ id: "codigo", token: "K7Q2MX", channel: "indicacao" }),
    regra({ id: "mensagem", defaultMessage: `${COMECO} ${FIM}` }),
    regra({ id: "palavra", keywords: ["avaliação"] }),
  ];

  it("diz a regra e o jeito, na precedência de sempre", () => {
    expect(reconhecerOrigem(`${TEXTO_DO_LINK} [#K7Q2MX]`, regras)).toEqual({
      regra: regras[0],
      method: "link_token",
    });
    expect(reconhecerOrigem(TEXTO_DO_LINK, regras)?.regra.id).toBe("mensagem");
    expect(
      reconhecerOrigem("quero uma avaliacao amanha", regras)?.regra.id,
    ).toBe("palavra");
    expect(reconhecerOrigem("bom dia", regras)).toBeNull();
  });

  it("atribuirOrigem devolve os campos da mesma regra", () => {
    const corpo = "quero uma avaliacao amanha";
    const reconhecimento = reconhecerOrigem(corpo, regras);
    expect(atribuirOrigem(corpo, regras)).toEqual({
      channel: reconhecimento?.regra.channel,
      origin: reconhecimento?.regra.origin,
      medium: reconhecimento?.regra.medium,
      campaign: reconhecimento?.regra.campaign,
      method: reconhecimento?.method,
    });
  });
});

describe("termo-chave da jornada (mesma normalização, sem regressão)", () => {
  type Etapa = {
    chave: string;
    posicao: number;
    papel: "entrada" | "agendou" | "compareceu" | "perdido" | null;
    termos_chave: string[];
    termos_de_quem: TermosDeQuem;
  };
  const jornada: Etapa[] = [
    {
      chave: "novo",
      posicao: 10,
      papel: "entrada",
      termos_chave: [],
      termos_de_quem: "paciente",
    },
    {
      chave: "orcamento",
      posicao: 20,
      papel: null,
      termos_chave: ["quanto custa"],
      termos_de_quem: "paciente",
    },
  ];

  it("o termo com invisível no meio do texto do paciente passa a casar", () => {
    const corpo = `Oi, quanto${LARGURA_ZERO}${JUNTA}custa?`;
    // Sem espaco entre as palavras, colado pelo invisivel: nao e o termo.
    expect(etapaPorTermoChave(corpo, "novo", jornada, "paciente")).toBeNull();
    const comEspaco = `Oi, quanto ${BOM}custa?`;
    expect(
      etapaPorTermoChave(comEspaco, "novo", jornada, "paciente")?.chave,
    ).toBe("orcamento");
    const noMeio = `Oi, quan${blocoInvisivel(30)}to custa?`;
    expect(etapaPorTermoChave(noMeio, "novo", jornada, "paciente")?.chave).toBe(
      "orcamento",
    );
  });

  it("o que ja casava continua casando, e o que nao casava continua de fora", () => {
    expect(
      etapaPorTermoChave(
        "Quanto custa a consulta?",
        "novo",
        jornada,
        "paciente",
      )?.chave,
    ).toBe("orcamento");
    expect(
      etapaPorTermoChave("Bom dia", "novo", jornada, "paciente"),
    ).toBeNull();
  });

  // Revisao da onda 5: tirar \p{M} tira tambem o seletor U+FE0F e o
  // U+20E3 do emoji de tecla. O termo da tecla do 1 vira "1" e casaria toda
  // mensagem com o algarismo; termo com menos de 2 caracteres depois de
  // normalizar nao casa nada (o Zod da action tambem o recusa).
  it("o emoji de tecla vira um algarismo só e não move ninguém", () => {
    const TECLA_1 = `1${SELETOR_DE_VARIACAO}${c(0x20e3)}`;
    expect(normalizarTexto(TECLA_1)).toBe("1");
    const comTecla: Etapa[] = [
      jornada[0]!,
      {
        chave: "confirmou",
        posicao: 20,
        papel: null,
        termos_chave: [TECLA_1, `e${c(0x301)}`],
        termos_de_quem: "qualquer",
      },
    ];
    expect(
      etapaPorTermoChave(
        "Sua consulta e dia 21/10 as 15h, valor R$ 150.",
        "novo",
        comTecla,
        "paciente",
      ),
    ).toBeNull();
    expect(
      etapaPorTermoChave(
        `Responda ${TECLA_1} para confirmar`,
        "novo",
        comTecla,
        "paciente",
      ),
    ).toBeNull();
    expect(
      etapaPorTermoChave("Pode ser", "novo", comTecla, "paciente"),
    ).toBeNull();
    // Contraprova: termo de 2 caracteres depois de normalizar vale.
    const comOk: Etapa[] = [
      jornada[0]!,
      { ...comTecla[1]!, termos_chave: [TECLA_1, "ok"] },
    ];
    expect(
      etapaPorTermoChave("Ok, confirmado", "novo", comOk, "paciente")?.chave,
    ).toBe("confirmou");
  });
});

describe("busca das mensagens padrão (mesma normalização, sem regressão)", () => {
  const lista: RespostaRapida[] = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      atalho: "endereco",
      titulo: "Endereço da clínica",
      corpo: "Rua A, 10.",
      ativo: true,
      posicao: 10,
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      atalho: "preco",
      titulo: "Preço da avaliação",
      corpo: "R$ 100.",
      ativo: true,
      posicao: 20,
    },
  ];

  it("termo colado com invisível acha a mensagem", () => {
    expect(
      filtrarRespostas(lista, `ende${LARGURA_ZERO}reco`).map(
        (item) => item.atalho,
      ),
    ).toEqual(["endereco"]);
  });

  it("acento e caixa continuam indiferentes", () => {
    expect(filtrarRespostas(lista, "PREÇO").map((item) => item.atalho)).toEqual(
      ["preco"],
    );
    expect(
      filtrarRespostas(lista, "avaliacao").map((item) => item.atalho),
    ).toEqual(["preco"]);
  });
});
