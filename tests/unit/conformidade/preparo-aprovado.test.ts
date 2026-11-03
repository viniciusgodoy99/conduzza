import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { fatosVazios } from "@/lib/domain/conformidade/fatos-do-turno";
import { filtrarSaida, sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import {
  aprovarParaEnvio,
  conferirParaEnvio,
  LIMITE_DA_MENSAGEM_DO_PREPARO,
  problemasDoTextoDoPreparo,
  TAMANHO_MINIMO_DO_TRECHO,
  trechoDePreparoNaResposta,
  type PreparoAprovado,
} from "@/lib/domain/conformidade/preparo-aprovado";
import type { TextoAprovado } from "@/lib/domain/conformidade/texto-aprovado";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import {
  CABECALHO_DO_PREPARO,
  mensagemDoPreparo,
  RODAPE_DO_PREPARO,
  trechoDePreparoNaResposta as trechoDoModuloPuro,
} from "@/lib/domain/preparo";
import {
  CONTEXTO_PADRAO,
  FRASE_DO_PREPARO_SO_DO_TRECHO,
  MENSAGEM_DO_PREPARO_DE_TESTE,
  RT_DE_TESTE,
  TEXTO_DO_PREPARO_DE_TESTE,
} from "@/tests/fixtures/ia/conformidade/casos";

// AG7 (03/11/2026; D-80): o preparo aprovado pelo RT so sai pela mensagem do
// SISTEMA, conferida por hash; a IA continua barrada ao escrever qualquer
// preparo. Este arquivo prova as tres coisas que moram em
// lib/domain/conformidade/preparo-aprovado.ts:
//  - o tipo marcado PreparoAprovado so sai de aprovarParaEnvio (varredura e
//    tipo), e nao se mistura com o TextoAprovado da IA;
//  - aprovarParaEnvio confere o hash e o formato da mensagem do banco;
//  - trechoDePreparoNaResposta e problemasDoTextoDoPreparo.
// E, no fim, que so a mensagem do sistema leva remedio, dose e jejum: a
// mesma mensagem como rascunho do modelo e barrada pelo filtro.

const c = (...codigos: number[]) => String.fromCodePoint(...codigos);

const VERSAO_ID = "0b9d6a51-3c1e-4c3f-9d0e-2a7f5b8c1d42";
const PROCEDURE_ID = "5e2f8c31-7a4b-4e6d-8f1a-9c0b3d2e4f15";

function lido(mensagem: string, extra: Record<string, unknown> = {}) {
  return {
    versao_id: VERSAO_ID,
    procedure_id: PROCEDURE_ID,
    versao: 3,
    mensagem,
    sha256: sha256DoTexto(mensagem),
    ...extra,
  };
}

const LIDO = lido(MENSAGEM_DO_PREPARO_DE_TESTE);

function verificadorQueSempreAprova() {
  return vi.fn<Verificador>(async () => ({
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: null,
  }));
}

// ---------------------------------------------------------------------------
// A marca
// ---------------------------------------------------------------------------

const RAIZ = process.cwd();
const PASTAS = ["app", "components", "lib", "scripts"];
const UNICO_PERMITIDO = "lib/domain/conformidade/preparo-aprovado.ts";

function arquivos(pasta: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) {
      saida.push(...arquivos(caminho));
    } else if (/\.(ts|tsx|mts)$/.test(nome)) {
      saida.push(caminho);
    }
  }
  return saida;
}

describe("PreparoAprovado: a marca so sai de aprovarParaEnvio", () => {
  it("um objeto cru nao vira PreparoAprovado", () => {
    // @ts-expect-error objeto cru (sem a marca) nao pode ser enviado como preparo
    const forjado: PreparoAprovado = {
      mensagem: MENSAGEM_DO_PREPARO_DE_TESTE,
      sha256: sha256DoTexto(MENSAGEM_DO_PREPARO_DE_TESTE),
      versaoId: VERSAO_ID,
      procedureId: PROCEDURE_ID,
      versao: 3,
    };
    expect(forjado.versao).toBe(3);
  });

  it("PreparoAprovado nao e TextoAprovado, e vice-versa", async () => {
    const preparo = aprovarParaEnvio(LIDO);
    expect(preparo).not.toBeNull();
    const decisao = await filtrarSaida({
      rascunho: "Tenho horário amanhã às 10h. Pode ser?",
      contexto: CONTEXTO_PADRAO,
      verificador: verificadorQueSempreAprova(),
    });
    expect(decisao.aprovado).toBe(true);
    if (preparo === null || !decisao.aprovado) {
      return;
    }
    // @ts-expect-error o preparo do sistema nao e texto da IA
    const comoTexto: TextoAprovado = preparo;
    // @ts-expect-error a mensagem do preparo tambem nao (e string comum)
    const mensagemComoTexto: TextoAprovado = preparo.mensagem;
    // @ts-expect-error o texto aprovado pelo filtro nao vira preparo
    const comoPreparo: PreparoAprovado = decisao.texto;
    expect(typeof comoTexto).toBe("object");
    expect(typeof mensagemComoTexto).toBe("string");
    expect(typeof comoPreparo).toBe("string");
  });

  it("nenhum arquivo converte para PreparoAprovado fora de preparo-aprovado.ts", () => {
    const conversao = /\bas\s+PreparoAprovado\b|<PreparoAprovado>/;
    const infratores: string[] = [];
    for (const pasta of PASTAS) {
      for (const arquivo of arquivos(join(RAIZ, pasta))) {
        const caminho = relative(RAIZ, arquivo);
        if (caminho === UNICO_PERMITIDO) {
          continue;
        }
        if (conversao.test(readFileSync(arquivo, "utf-8"))) {
          infratores.push(caminho);
        }
      }
    }
    expect(infratores).toEqual([]);
  });

  it("preparo-aprovado.ts faz exatamente uma conversao, numa funcao nao exportada, e nenhuma para TextoAprovado", () => {
    const fonte = readFileSync(join(RAIZ, UNICO_PERMITIDO), "utf-8");
    expect(fonte.match(/\bas\s+PreparoAprovado\b/g)).toHaveLength(1);
    expect(fonte).toMatch(
      /\nfunction marcar\(preparo: PreparoSemMarca\): PreparoAprovado \{\n {2}return Object\.freeze\(\{ \.\.\.preparo \}\) as PreparoAprovado;\n\}/,
    );
    expect(fonte).not.toMatch(/export function marcar/);
    expect(fonte).not.toMatch(/<PreparoAprovado>/);
    expect(fonte).not.toMatch(/\bas\s+TextoAprovado\b|<TextoAprovado>/);
    // So conferirParaEnvio chama a conversao (aprovarParaEnvio a usa).
    expect(fonte.match(/\bmarcar\(/g)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Revisao da AG7 (CFM-2): a conferencia do envio reconfere as recusas
// ---------------------------------------------------------------------------

describe("conferirParaEnvio: o texto aprovado com recusa nunca vira PreparoAprovado", () => {
  function comTexto(texto: string, rt = RT_DE_TESTE) {
    return lido(mensagemDoPreparo({ procedimento: "Colonoscopia", rt, texto }));
  }

  it.each([
    [
      "Venha sem maquiagem. Resultado garantido, você vai sair renovada!",
      ["promessa_resultado"],
    ],
    [
      "Jejum de 8 horas. Na compra do exame, o retorno sai de brinde.",
      ["oferta_casada"],
    ],
    [
      "Venha em jejum de 8 horas. Aproveite e faça também a limpeza de pele com 20% de desconto.",
      ["preco_nao_verificado"],
    ],
    [
      "Jejum de 8 horas. Veja o vídeo em https://exemplo.com/preparo.",
      ["formato_invalido"],
    ],
    ["Veja as fotos de antes e depois das nossas pacientes.", ["antes_depois"]],
  ])(
    "%j: recusado %j, com os ids; aprovarParaEnvio da nulo",
    (texto, recusas) => {
      const leitura = comTexto(texto);
      expect(conferirParaEnvio(leitura)).toEqual({
        tipo: "recusado",
        recusas,
        versaoId: VERSAO_ID,
        procedureId: PROCEDURE_ID,
      });
      expect(aprovarParaEnvio(leitura)).toBeNull();
    },
  );

  it("o remedio, a dose e o jejum so avisam (D-80): o texto de teste sai", () => {
    const conferido = conferirParaEnvio(LIDO);
    expect(conferido.tipo).toBe("pronto");
    expect(
      problemasDoTextoDoPreparo(TEXTO_DO_PREPARO_DE_TESTE).avisos,
    ).not.toEqual([]);
  });

  it("so o texto aprovado e conferido: o cabecalho e a linha do RT (o nome do cadastro) nao", () => {
    const comNomeDeRisco = comTexto("Jejum de 8 horas antes do exame.", {
      ...RT_DE_TESTE,
      nome: "Dra. Ana Garantia",
    });
    expect(conferirParaEnvio(comNomeDeRisco).tipo).toBe("pronto");
  });

  it("fora do formato continua fora do formato (antes das recusas)", () => {
    expect(conferirParaEnvio({ ...LIDO, sha256: "0".repeat(64) })).toEqual({
      tipo: "fora_do_formato",
    });
    expect(conferirParaEnvio(null)).toEqual({ tipo: "fora_do_formato" });
  });
});

// ---------------------------------------------------------------------------
// aprovarParaEnvio
// ---------------------------------------------------------------------------

describe("aprovarParaEnvio: a leitura do banco conferida por hash", () => {
  // O prebuild roda esta pasta, nao tests/unit/domain: o literal do
  // contrato (secao 1.4) tambem e conferido aqui.
  it("a mensagem do sistema de teste e a do contrato, byte a byte", () => {
    expect(
      mensagemDoPreparo({
        procedimento: "Colonoscopia",
        rt: RT_DE_TESTE,
        texto: "Jejum de 8 horas.",
      }),
    ).toBe(
      "Orientação de preparo para Colonoscopia\nResponsável técnico da clínica: Dra. Ana Souza (CRM-CE 12345)\n\nJejum de 8 horas.\n\nSe tiver qualquer dúvida sobre o preparo, responda por aqui que a equipe da clínica te ajuda.",
    );
    expect(MENSAGEM_DO_PREPARO_DE_TESTE.startsWith(CABECALHO_DO_PREPARO)).toBe(
      true,
    );
    expect(
      MENSAGEM_DO_PREPARO_DE_TESTE.endsWith(`\n\n${RODAPE_DO_PREPARO}`),
    ).toBe(true);
  });

  it("a mensagem do banco com o hash certo vira PreparoAprovado, congelado e byte a byte", () => {
    const preparo = aprovarParaEnvio(LIDO);
    expect(preparo).toEqual({
      mensagem: MENSAGEM_DO_PREPARO_DE_TESTE,
      sha256: sha256DoTexto(MENSAGEM_DO_PREPARO_DE_TESTE),
      versaoId: VERSAO_ID,
      procedureId: PROCEDURE_ID,
      versao: 3,
    });
    expect(Object.isFrozen(preparo)).toBe(true);
    // Campo a mais na leitura nao entra.
    expect(aprovarParaEnvio({ ...LIDO, texto: "outro" })).toEqual(preparo);
  });

  it("hash errado da nulo (o texto mudou, um caractere a mais ou a menos)", () => {
    const outro = sha256DoTexto(`${MENSAGEM_DO_PREPARO_DE_TESTE} `);
    expect(aprovarParaEnvio({ ...LIDO, sha256: outro })).toBeNull();
    expect(
      aprovarParaEnvio({
        ...LIDO,
        mensagem: MENSAGEM_DO_PREPARO_DE_TESTE.replace("8 horas", "6 horas"),
      }),
    ).toBeNull();
    expect(
      aprovarParaEnvio({
        ...LIDO,
        mensagem: MENSAGEM_DO_PREPARO_DE_TESTE.replace("Jejum", "Jeju"),
      }),
    ).toBeNull();
    expect(
      aprovarParaEnvio({
        ...LIDO,
        mensagem: `${MENSAGEM_DO_PREPARO_DE_TESTE}!`,
      }),
    ).toBeNull();
  });

  it("hash fora do formato da nulo, mesmo que seja o da mensagem", () => {
    const certo = sha256DoTexto(MENSAGEM_DO_PREPARO_DE_TESTE);
    for (const sha256 of [
      certo.toUpperCase(),
      certo.slice(0, 63),
      `${certo}0`,
      ` ${certo}`,
      "",
      null,
      42,
    ]) {
      expect(aprovarParaEnvio({ ...LIDO, sha256 }), String(sha256)).toBeNull();
    }
  });

  it("sem o cabecalho, sem o rodape ou sem o texto da nulo, mesmo com o hash recalculado", () => {
    for (const mensagem of [
      MENSAGEM_DO_PREPARO_DE_TESTE.replace(CABECALHO_DO_PREPARO, ""),
      MENSAGEM_DO_PREPARO_DE_TESTE.replace(`\n\n${RODAPE_DO_PREPARO}`, ""),
      `${MENSAGEM_DO_PREPARO_DE_TESTE}\nObrigada!`,
      TEXTO_DO_PREPARO_DE_TESTE,
      mensagemDoPreparo({
        procedimento: "Colonoscopia",
        rt: RT_DE_TESTE,
        texto: "  ",
      }),
      "",
    ]) {
      expect(aprovarParaEnvio(lido(mensagem)), mensagem.slice(0, 40)).toBe(
        null,
      );
    }
  });

  it("os ids e a versao no formato", () => {
    for (const desvio of [
      { versao_id: "v1" },
      { versao_id: `${VERSAO_ID}0` },
      { versao_id: null },
      { procedure_id: "p1" },
      { procedure_id: undefined },
      { versao: 0 },
      { versao: -1 },
      { versao: 1.5 },
      { versao: "3" },
      { versao: Number.NaN },
      { versao: null },
      { mensagem: 42 },
      { mensagem: null },
    ]) {
      expect(
        aprovarParaEnvio({ ...LIDO, ...desvio }),
        JSON.stringify(desvio),
      ).toBeNull();
    }
    for (const qualquer of [null, undefined, "x", 42, [], [LIDO], true]) {
      expect(aprovarParaEnvio(qualquer), String(qualquer)).toBeNull();
    }
  });

  it("de 1 a 4.096 caracteres (o limite do WhatsApp)", () => {
    expect(LIMITE_DA_MENSAGEM_DO_PREPARO).toBe(4096);
    const base = mensagemDoPreparo({
      procedimento: "Colonoscopia",
      rt: RT_DE_TESTE,
      texto: "",
    });
    const noLimite = mensagemDoPreparo({
      procedimento: "Colonoscopia",
      rt: RT_DE_TESTE,
      texto: "J".repeat(4096 - Array.from(base).length),
    });
    expect(Array.from(noLimite)).toHaveLength(4096);
    expect(aprovarParaEnvio(lido(noLimite))).not.toBeNull();
    const acima = noLimite.replace("JJ", "JJJ");
    expect(Array.from(acima)).toHaveLength(4097);
    expect(aprovarParaEnvio(lido(acima))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// trechoDePreparoNaResposta
// ---------------------------------------------------------------------------

describe("trechoDePreparoNaResposta: a IA copiando o texto da clinica", () => {
  const TEXTOS = [TEXTO_DO_PREPARO_DE_TESTE];

  it("e a regra do modulo puro, reexportada (o filtro chama a mesma)", () => {
    expect(trechoDePreparoNaResposta).toBe(trechoDoModuloPuro);
    expect(TAMANHO_MINIMO_DO_TRECHO).toBe(25);
  });

  it("acusa a frase exata, com acento e caixa trocados, sem a pontuacao e dentro de outra resposta", () => {
    for (const rascunho of [
      FRASE_DO_PREPARO_SO_DO_TRECHO,
      "VENHA COM UM ACOMPANHANTE MAIOR DE IDADE PORQUE VOCE VAI RECEBER SEDACAO",
      "venha com um acompanhante maior de idade porque voce vai receber sedacao",
      `Claro! ${FRASE_DO_PREPARO_SO_DO_TRECHO} Mais alguma dúvida?`,
      "Às 18h da véspera tome 2 comprimidos de bisacodil 5 mg com um copo de água",
    ]) {
      expect(trechoDePreparoNaResposta(rascunho, TEXTOS), rascunho).toBe(true);
    }
  });

  it("acusa o texto inteiro, inclusive o de frases curtas", () => {
    expect(trechoDePreparoNaResposta(TEXTO_DO_PREPARO_DE_TESTE, TEXTOS)).toBe(
      true,
    );
    const curtas = "Jejum de 8h. Sem café. Venha cedo.";
    expect(trechoDePreparoNaResposta("Jejum de 8h.", [curtas])).toBe(false);
    expect(trechoDePreparoNaResposta(`Olha só: ${curtas}`, [curtas])).toBe(
      true,
    );
  });

  it("nao acusa a frase curta comum nem o requisito administrativo com outras palavras", () => {
    for (const rascunho of [
      "Jejum de 8 horas.",
      "Venha com um acompanhante.",
      "Para a colonoscopia, venha com acompanhante e traga o pedido médico.",
      "Para qual procedimento você quer a orientação de preparo?",
      // A frase cortada no meio da palavra nao e a frase.
      "Venha com um acompanhante maior de idade, porque você vai receber sedaçãozinha.",
      "",
      "   ",
    ]) {
      expect(trechoDePreparoNaResposta(rascunho, TEXTOS), rascunho).toBe(false);
    }
    expect(trechoDePreparoNaResposta(FRASE_DO_PREPARO_SO_DO_TRECHO, [])).toBe(
      false,
    );
  });

  it("a frase conta com 25 caracteres normalizados, nao com 24", () => {
    const vinteECinco = "abcde fghij klmno pqrst u";
    const vinteEQuatro = "abcde fghij klmno pqrstu";
    expect(Array.from(vinteECinco)).toHaveLength(25);
    expect(Array.from(vinteEQuatro)).toHaveLength(24);
    expect(
      trechoDePreparoNaResposta(`Oi. ${vinteECinco}. Tchau.`, [
        `${vinteECinco}. Outra coisa curta.`,
      ]),
    ).toBe(true);
    expect(
      trechoDePreparoNaResposta(`Oi. ${vinteEQuatro}. Tchau.`, [
        `${vinteEQuatro}. Outra.`,
      ]),
    ).toBe(false);
  });

  it("entrada que nao e texto: nao acusa (quem valida a lista e o filtro)", () => {
    expect(trechoDePreparoNaResposta(null as unknown as string, TEXTOS)).toBe(
      false,
    );
    expect(
      trechoDePreparoNaResposta(
        FRASE_DO_PREPARO_SO_DO_TRECHO,
        null as unknown as string[],
      ),
    ).toBe(false);
    expect(
      trechoDePreparoNaResposta(FRASE_DO_PREPARO_SO_DO_TRECHO, [
        42 as unknown as string,
        TEXTO_DO_PREPARO_DE_TESTE,
      ]),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// problemasDoTextoDoPreparo (D-80)
// ---------------------------------------------------------------------------

/** Um preparo de colonoscopia de verdade (sintetico), com o que nao recusa. */
const PREPARO_REALISTA = [
  "Siga as instruções abaixo para a colonoscopia.",
  "Dois dias antes: dieta sem resíduos (evite frutas com casca, verduras, grãos e sementes).",
  "Às 18h da véspera, tome 2 comprimidos de bisacodil 5 mg com um copo de água.",
  "Às 20h, dissolva o manitol 20% em 500 ml de suco de laranja coado e beba em até 1 hora. Beba um total de 4 litros de líquidos claros.",
  "Jejum absoluto de 8 horas antes do exame, inclusive de água.",
  "Se usa remédio para pressão, tome normalmente com um gole de água. Suspenda anticoagulantes 7 dias antes, conforme orientação do seu médico.",
  "Venha com um acompanhante maior de idade. Traga documento com foto, a carteirinha do convênio e o pedido médico.",
  "Em caso de dúvida, ligue (85) 3333-4444.",
].join("\n");

describe("problemasDoTextoDoPreparo: o texto que a clinica escreve", () => {
  it("so avisa remedio, dose, jejum e cuidados: e o conteudo de um preparo (D-80)", () => {
    expect(problemasDoTextoDoPreparo(TEXTO_DO_PREPARO_DE_TESTE)).toEqual({
      recusas: [],
      avisos: ["orientacao_clinica", "medicamento", "dosagem"],
    });
    expect(problemasDoTextoDoPreparo("Jejum de 8 horas.")).toEqual({
      recusas: [],
      avisos: ["orientacao_clinica"],
    });
    expect(
      problemasDoTextoDoPreparo(
        "Cuidados antes do exame: evite sol e não use maquiagem.",
      ),
    ).toEqual({ recusas: [], avisos: ["orientacao_clinica"] });
    expect(
      problemasDoTextoDoPreparo("Pacientes diabéticos: tragam o glicosímetro."),
    ).toEqual({ recusas: [], avisos: ["diagnostico"] });
  });

  it("o preparo realista passa: instrucoes, percentual, litros, telefone e tamanho nao recusam", () => {
    const { recusas, avisos } = problemasDoTextoDoPreparo(PREPARO_REALISTA);
    expect(recusas).toEqual([]);
    expect(avisos).toEqual(["orientacao_clinica", "medicamento", "dosagem"]);
    expect(Array.from(PREPARO_REALISTA).length).toBeGreaterThan(700);
    for (const texto of [
      "Siga estas instruções e as diretrizes da clínica.",
      "Soro fisiológico a 0,9% para a limpeza.",
      "Beba um total de 4 litros.",
      "Dúvidas: (85) 99999-0000.",
      `Tome o comprimido ${c(0x1f48a)} às 18h.`,
      "Use roupa confortável.\n".repeat(150).trim(),
    ]) {
      expect(
        problemasDoTextoDoPreparo(texto).recusas,
        texto.slice(0, 40),
      ).toEqual([]);
    }
  });

  it("recusa promessa, oferta casada e antes e depois", () => {
    expect(
      problemasDoTextoDoPreparo("Jejum de 8 horas. Resultado garantido.")
        .recusas,
    ).toEqual(["promessa_resultado"]);
    expect(
      problemasDoTextoDoPreparo("Na compra do exame, a consulta é grátis.")
        .recusas,
    ).toEqual(["oferta_casada"]);
    expect(
      problemasDoTextoDoPreparo("Veja o antes e depois dos pacientes.").recusas,
    ).toEqual(["antes_depois"]);
  });

  it("recusa o valor em reais, a moeda estrangeira e o desconto", () => {
    for (const texto of [
      "O exame custa R$ 250,00.",
      "O exame sai por 250 reais.",
      "O exame custa 250.",
      "O exame custa US$ 50.",
      "Com 10% de desconto no exame.",
    ]) {
      expect(problemasDoTextoDoPreparo(texto).recusas, texto).toContain(
        "preco_nao_verificado",
      );
    }
  });

  it("recusa o link, o arroba e o texto escrito para enganar", () => {
    for (const texto of [
      "Veja o vídeo em www.clinica.com.br.",
      "Mais dicas em https://clinica.com.br/preparo",
      "Siga @clinicadasaude para mais dicas.",
      `Jejum de 8 ho${c(0x200b)}ras.`,
      `J${c(0x435)}jum de 8 horas.`,
      `Jeju${c(0x6d, 0x301, 0x302, 0x303)} de 8 horas.`,
    ]) {
      expect(problemasDoTextoDoPreparo(texto).recusas, texto).toEqual([
        "formato_invalido",
      ]);
    }
  });

  it("as categorias saem sem repetir, na ordem de prioridade", () => {
    const { recusas, avisos } = problemasDoTextoDoPreparo(
      "Garantido! Na compra do pacote, a sessão é grátis. Tome 2 comprimidos de dipirona. Veja em www.clinica.com.br.",
    );
    expect(recusas).toEqual([
      "promessa_resultado",
      "oferta_casada",
      "formato_invalido",
    ]);
    expect(avisos).toEqual(["medicamento", "dosagem"]);
  });
});

// ---------------------------------------------------------------------------
// So a mensagem do sistema leva remedio, dose e jejum
// ---------------------------------------------------------------------------

describe("so a mensagem do sistema leva remedio, dose e jejum", () => {
  it("a mensagem do sistema como rascunho do modelo e barrada pela regra, sem chamar o verificador", async () => {
    for (const contexto of [
      { ...CONTEXTO_PADRAO, textosDePreparo: [TEXTO_DO_PREPARO_DE_TESTE] },
      CONTEXTO_PADRAO,
    ]) {
      const verificador = verificadorQueSempreAprova();
      const decisao = await filtrarSaida({
        rascunho: MENSAGEM_DO_PREPARO_DE_TESTE,
        contexto,
        verificador,
      });
      expect(decisao).toMatchObject({
        aprovado: false,
        categoria: "orientacao_clinica",
        camada: "regra",
      });
      expect(verificador).not.toHaveBeenCalled();
    }
  });

  it("no turno de verdade (com os fatos), a mensagem longa barra antes", async () => {
    const verificador = verificadorQueSempreAprova();
    const decisao = await filtrarSaida({
      rascunho: MENSAGEM_DO_PREPARO_DE_TESTE,
      contexto: {
        ...CONTEXTO_PADRAO,
        fatos: fatosVazios(2026),
        textosDePreparo: [TEXTO_DO_PREPARO_DE_TESTE],
      },
      verificador,
    });
    expect(decisao).toMatchObject({
      aprovado: false,
      categoria: "formato_invalido",
      camada: "regra",
    });
    expect(verificador).not.toHaveBeenCalled();
  });

  it("cada frase do texto de teste escrita pelo modelo tambem e barrada", async () => {
    for (const frase of TEXTO_DO_PREPARO_DE_TESTE.split("\n")) {
      const decisao = await filtrarSaida({
        rascunho: frase,
        contexto: {
          ...CONTEXTO_PADRAO,
          textosDePreparo: [TEXTO_DO_PREPARO_DE_TESTE],
        },
        verificador: verificadorQueSempreAprova(),
      });
      expect(decisao.aprovado, frase).toBe(false);
    }
  });

  it("a mesma mensagem, lida do banco com o hash certo, vira PreparoAprovado (e so por aprovarParaEnvio)", () => {
    const preparo = aprovarParaEnvio(LIDO);
    expect(preparo?.mensagem).toBe(MENSAGEM_DO_PREPARO_DE_TESTE);
    expect(preparo?.mensagem).toContain("bisacodil");
    expect(preparo?.mensagem).toContain("Jejum de 8 horas");
  });
});
