import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { mascararNome, montarHistorico } from "@/lib/agente/historico";
import {
  falaDaClinicaSemOPreparo,
  historicoParaOModelo,
  mensagemParaOModelo,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import {
  mensagemDoPreparo,
  RODAPE_DO_PREPARO,
  SUBSTITUTO_DA_FALA_SEM_A_MASCARA,
  SUBSTITUTO_DO_TEXTO_DO_PREPARO,
  substitutoDaFalaNoFormatoDoPreparo,
  substitutoDaMensagemDoPreparo,
} from "@/lib/domain/preparo";

import {
  RT_DE_TESTE,
  TEXTO_DO_PREPARO_DE_TESTE,
} from "../../fixtures/ia/conformidade/casos";

// AG7 (contrato, secao 0, item 9): o historico que vai ao modelo nunca leva
// o texto de preparo da clinica. Em mensagemParaOModelo (lib/agente/laco.ts),
// ANTES da minimizacao e do corte, na fala da clinica (de qualquer autoria):
// a mensagem do preparo inteira (a do sistema; no simulador, a da IA) vira o
// substituto, pelo cabecalho fixo ou, com a mascara do nome mexendo no
// cabecalho, pelo rodape fixo; todo trecho igual a um texto de preparo da
// clinica (o aprovado e o prep_instructions que a regua mandou antes da AG7)
// vira o marcador. A fala do paciente fica como esta. iaRespondeuNaJanela
// continua contando so o autor 'ia' (a mensagem do preparo nao leva o aviso
// de assistente virtual, D-77). Nenhum teste fala com a OpenAI.

const PREP_ANTIGO = "Venha sem maquiagem e com o rosto limpo, por favor.";
const TEXTOS = [TEXTO_DO_PREPARO_DE_TESTE, PREP_ANTIGO];
const MENSAGEM = mensagemDoPreparo({
  procedimento: "Colonoscopia",
  rt: RT_DE_TESTE,
  texto: TEXTO_DO_PREPARO_DE_TESTE,
});
const SUBSTITUTO = substitutoDaMensagemDoPreparo("Colonoscopia");
const RODAPE_SEM_MASCARA = `\n\n${RODAPE_DO_PREPARO}`;

function daClinica(
  texto: string,
  autoria: "ia" | "sistema" | "usuario" = "sistema",
): MensagemDaConversa {
  return { autor: "assistente", autoria, texto, tipo: "texto" };
}

describe("a mensagem do preparo no historico", () => {
  it("a do sistema vira o substituto com o procedimento; nada do texto, do RT nem do rodape vai ao modelo", () => {
    const lida = mensagemParaOModelo(daClinica(MENSAGEM), {
      textosDePreparo: TEXTOS,
    });
    expect(lida).toBe(
      "Mensagem do sistema: a orientação de preparo de Colonoscopia, aprovada pela clínica, foi enviada aqui.",
    );
    expect(lida).toBe(SUBSTITUTO);
    // Sem os textos (o catalogo sem nenhum): o cabecalho basta.
    expect(mensagemParaOModelo(daClinica(MENSAGEM))).toBe(SUBSTITUTO);
  });

  it("revisao da AG7 (CFM-10): no formato, mas de outra autoria (a IA, a equipe, desconhecida), o substituto nao diz aprovada", () => {
    const semAprovacao = substitutoDaFalaNoFormatoDoPreparo("Colonoscopia");
    expect(semAprovacao).toBe(
      "Mensagem da clínica: uma orientação de preparo de Colonoscopia foi enviada aqui.",
    );
    for (const autoria of ["ia", "usuario"] as const) {
      expect(
        mensagemParaOModelo(daClinica(MENSAGEM, autoria), {
          textosDePreparo: TEXTOS,
        }),
        autoria,
      ).toBe(semAprovacao);
    }
    expect(
      mensagemParaOModelo(
        { autor: "assistente", texto: MENSAGEM, tipo: "texto" },
        { textosDePreparo: TEXTOS },
      ),
    ).toBe(semAprovacao);
    // So o cabecalho (sem a linha do RT e o rodape): do sistema, tambem
    // sem "aprovada" (nao e a mensagem que o banco monta).
    const soOCabecalho = `Orientação de preparo para Colonoscopia\n${TEXTO_DO_PREPARO_DE_TESTE}`;
    expect(
      mensagemParaOModelo(daClinica(soOCabecalho), { textosDePreparo: TEXTOS }),
    ).toBe(semAprovacao);
    expect(
      mensagemParaOModelo(daClinica(soOCabecalho), { textosDePreparo: TEXTOS }),
    ).not.toContain("bisacodil");
  });

  it("no simulador, a mensagem do preparo (no formato inteiro) vem como do sistema: o mesmo substituto do WhatsApp", () => {
    expect(
      historicoParaOModelo(
        [
          { autor: "paciente", texto: "Qual o preparo da colonoscopia?" },
          { autor: "assistente", autoria: "sistema", texto: MENSAGEM },
          { autor: "paciente", texto: "Obrigada" },
        ],
        { textosDePreparo: TEXTOS },
      ),
    ).toEqual([
      { role: "user", content: "Qual o preparo da colonoscopia?" },
      { role: "assistant", content: SUBSTITUTO },
      { role: "user", content: "Obrigada" },
    ]);
  });

  it("com o cabecalho mexido pela mascara do nome do contato e sem o corpo como saiu: o rodape reconhece, sem aprovada e sem o texto", () => {
    const mascarada = mascararNome(MENSAGEM, "De Lima");
    expect(mascarada.startsWith("Orientação de preparo para ")).toBe(false);
    const lida = mensagemParaOModelo(daClinica(mascarada), {
      textosDePreparo: TEXTOS,
    });
    expect(lida).toBe(substitutoDaFalaNoFormatoDoPreparo(""));
    expect(lida).not.toContain("bisacodil");
  });
});

describe("o texto da clinica que a regua mandou", () => {
  it("o aprovado e o prep_instructions antigo viram o marcador; o resto do toque continua", () => {
    const toque = `Oi! Amanhã, 21/10/2026 às 08:00, você tem Colonoscopia com o Dr. Bruno.\n${TEXTO_DO_PREPARO_DE_TESTE}\nPodemos confirmar sua presença?`;
    expect(
      mensagemParaOModelo(daClinica(toque), { textosDePreparo: TEXTOS }),
    ).toBe(
      `Oi! Amanhã, 21/10/2026 às 08:00, você tem Colonoscopia com o Dr. Bruno.\n${SUBSTITUTO_DO_TEXTO_DO_PREPARO}\nPodemos confirmar sua presença?`,
    );
    const antigo = `Oi! Amanhã você tem Limpeza de pele.\n${PREP_ANTIGO}\nPodemos confirmar sua presença?`;
    expect(
      mensagemParaOModelo(daClinica(antigo), { textosDePreparo: TEXTOS }),
    ).toBe(
      `Oi! Amanhã você tem Limpeza de pele.\n${SUBSTITUTO_DO_TEXTO_DO_PREPARO}\nPodemos confirmar sua presença?`,
    );
    // Da equipe (autoria usuario), tambem: o texto colado pela recepcao.
    expect(
      mensagemParaOModelo(daClinica(PREP_ANTIGO, "usuario"), {
        textosDePreparo: TEXTOS,
      }),
    ).toBe(SUBSTITUTO_DO_TEXTO_DO_PREPARO);
  });

  it("a troca vem antes do corte de 1.000: o fim do toque longo continua", () => {
    const comeco = "Oi! Amanhã você tem Colonoscopia.";
    const fim = "Podemos confirmar sua presença?";
    const longo = `${comeco}\n${TEXTO_DO_PREPARO_DE_TESTE}\n${TEXTO_DO_PREPARO_DE_TESTE}\n${fim}`;
    expect(Array.from(longo).length).toBeGreaterThan(1_000);
    const lida = mensagemParaOModelo(daClinica(longo), {
      textosDePreparo: TEXTOS,
    });
    expect(lida).toContain(fim);
    expect(lida).not.toContain("bisacodil");
  });

  it("falaDaClinicaSemOPreparo sem textos e sem cabecalho: como esta", () => {
    expect(falaDaClinicaSemOPreparo("Olá! Como posso ajudar?", [])).toBe(
      "Olá! Como posso ajudar?",
    );
  });
});

describe("a fala do paciente fica como esta", () => {
  it("mesmo com um trecho do texto da clinica (a duvida dela vai inteira, para o portao e o classificador)", () => {
    const duvida = `Não entendi isso: ${PREP_ANTIGO}`;
    expect(
      mensagemParaOModelo(
        { autor: "paciente", texto: duvida },
        { textosDePreparo: TEXTOS },
      ),
    ).toBe(duvida);
  });
});

describe("iaRespondeuNaJanela nao conta o preparo (D-77)", () => {
  const linha = (id: string, author: string, body: string, minuto: number) => ({
    id,
    author,
    content_type: "texto",
    body,
    media_url: null,
    created_at: `2026-10-27T13:${String(minuto).padStart(2, "0")}:00.000Z`,
  });

  it("so a mensagem do preparo (sistema): a IA ainda nao respondeu na janela; com uma resposta da IA, respondeu", () => {
    const comPreparo = montarHistorico(
      [
        linha("m1", "paciente", "Qual o preparo da colonoscopia?", 0),
        linha("m2", "sistema", MENSAGEM, 1),
        linha("m3", "paciente", "Obrigada! Quanto custa?", 2),
      ],
      new Set(["m1"]),
      null,
    );
    expect(comPreparo.iaRespondeuNaJanela).toBe(false);
    expect(comPreparo.pendentes).toEqual(["m3"]);
    // A mensagem do preparo e fala da clinica com a autoria do sistema.
    expect(comPreparo.mensagens[1]).toMatchObject({
      autor: "assistente",
      autoria: "sistema",
    });
    const comResposta = montarHistorico(
      [
        linha("m1", "paciente", "Oi", 0),
        linha("m2", "ia", "Olá! Como posso ajudar?", 1),
        linha("m3", "paciente", "Qual o preparo?", 2),
      ],
      new Set(["m1"]),
      null,
    );
    expect(comResposta.iaRespondeuNaJanela).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Revisao da AG7 (CFM-1 e MOTOR-1): a troca vem ANTES da mascara do nome
// ---------------------------------------------------------------------------

// O historico do WhatsApp troca o nome do contato (inteiro e o primeiro nome)
// por "Fulano". Antes da revisao, a troca do texto da clinica casava com a
// fala JA mascarada: com o primeiro nome do contato como palavra do texto
// aprovado, o toque da regua deixava de casar e ia inteiro ao modelo. Agora o
// historico guarda o corpo como saiu (textoOriginalDaClinica), o laco troca
// nele e so depois refaz a mascara.

/** Minusculas, sem acento, o que nao e letra nem numero vira espaco. */
function normal(texto: string): string {
  return texto
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** As frases de um texto (por linha e por ponto), normalizadas. */
function frases(texto: string): string[] {
  return texto
    .split(/[.!?\n]+/u)
    .map(normal)
    .filter((frase) => frase.split(" ").length >= 3);
}

/**
 * Nenhuma frase do texto (nem com a mascara do nome aplicada) no que vai ao
 * modelo.
 */
function semNenhumaFrase(lido: string, texto: string, nome: string): void {
  const alvo = ` ${normal(lido)} `;
  for (const frase of [
    ...frases(texto),
    ...frases(mascararNome(texto, nome)),
  ]) {
    expect(alvo, frase).not.toContain(` ${frase} `);
  }
}

const COLONOSCOPIA_COM_CLARA = [
  "Na véspera, faça dieta líquida clara: água, chá e suco coado.",
  "Às 18h, tome 2 comprimidos de bisacodil 5 mg.",
  "Jejum de 8 horas antes do exame.",
].join("\n");
const ESTETICA_COM_SOL = [
  "Evite exposição ao sol por 15 dias antes do procedimento.",
  "Suspenda o uso de ácido retinoico 7 dias antes.",
].join("\n");
const COM_DR_JOAO = [
  "O Dr. João pede jejum de 12 horas antes do exame.",
  "Tome o manitol a 20% às 20h da véspera.",
].join("\n");
const COM_SANTA_MARIA = [
  "Chegue à Clínica Santa Maria 30 minutos antes.",
  "Jejum de 8 horas antes do exame, inclusive de água.",
  "Tome 2 comprimidos de bisacodil 5 mg às 18h.",
].join("\n");

/** O toque de 24 horas da regua com o texto aprovado no {{preparo}}. */
function toque(nome: string, texto: string): string {
  const primeiro = nome.split(" ")[0] ?? nome;
  return `Oi, ${primeiro}! Amanhã, 04/11/2026 às 08:00, você tem Colonoscopia com Dr. Bruno.\n${texto}\nPodemos confirmar sua presença?`;
}

/** O que o modelo le do toque, pelo caminho do WhatsApp (montarHistorico). */
function lidoPeloModelo(
  nome: string,
  corpo: string,
  textos: readonly string[],
  author = "sistema",
): string {
  const historico = montarHistorico(
    [
      {
        id: "r1",
        author,
        content_type: "texto",
        body: corpo,
        media_url: null,
        created_at: "2026-11-03T11:00:00.000Z",
      },
      {
        id: "m1",
        author: "paciente",
        content_type: "texto",
        body: "Oi, tudo bem?",
        media_url: null,
        created_at: "2026-11-03T12:00:00.000Z",
      },
    ],
    new Set(),
    nome,
  );
  const [daClinica] = historicoParaOModelo(historico.mensagens, {
    textosDePreparo: textos,
    nomeDoContato: nome,
  });
  return String((daClinica as { content: unknown }).content);
}

describe("revisao da AG7 (CFM-1): a troca do texto da clinica vem antes da mascara do nome", () => {
  it.each([
    ["Clara Souza", COLONOSCOPIA_COM_CLARA, ["dieta liquida", "bisacodil"]],
    ["Sol Andrade", ESTETICA_COM_SOL, ["exposicao", "retinoico"]],
    ["João Pereira", COM_DR_JOAO, ["12 horas", "manitol"]],
    ["Maria Lima", COM_SANTA_MARIA, ["santa", "bisacodil"]],
  ] as const)(
    "contato %s: o toque da regua vira o marcador, e o nome continua mascarado no resto",
    (nome, texto, palavras) => {
      // A colisao existe: a mascara mexe no texto aprovado.
      expect(mascararNome(texto, nome)).not.toBe(texto);
      const lido = lidoPeloModelo(nome, toque(nome, texto), [texto]);
      expect(lido).toBe(
        `Oi, Fulano! Amanhã, 04/11/2026 às 08:00, você tem Colonoscopia com Dr. Bruno.\n${SUBSTITUTO_DO_TEXTO_DO_PREPARO}\nPodemos confirmar sua presença?`,
      );
      for (const palavra of palavras) {
        expect(normal(lido)).not.toContain(palavra);
      }
      semNenhumaFrase(lido, texto, nome);
    },
  );

  it("o controle sem colisao (Maria Souza): o mesmo marcador", () => {
    const lido = lidoPeloModelo(
      "Maria Souza",
      toque("Maria Souza", COLONOSCOPIA_COM_CLARA),
      [COLONOSCOPIA_COM_CLARA],
    );
    expect(lido).toContain(SUBSTITUTO_DO_TEXTO_DO_PREPARO);
    semNenhumaFrase(lido, COLONOSCOPIA_COM_CLARA, "Maria Souza");
  });

  it("o texto antigo (prep_instructions) com o nome dentro: tambem vira o marcador", () => {
    const antigo = "Venha sem maquiagem, Clara, e com o rosto limpo.";
    const lido = lidoPeloModelo(
      "Clara",
      `Oi! Amanhã você tem Limpeza de pele.\n${antigo}\nPodemos confirmar?`,
      [COLONOSCOPIA_COM_CLARA, antigo],
    );
    expect(lido).toBe(
      `Oi! Amanhã você tem Limpeza de pele.\n${SUBSTITUTO_DO_TEXTO_DO_PREPARO}\nPodemos confirmar?`,
    );
  });

  it("a mensagem do sistema com a contato chamada Preparo (a mascara mexe no cabecalho E no rodape): o substituto do sistema, sem o texto", () => {
    const mensagem = mensagemDoPreparo({
      procedimento: "Colonoscopia",
      rt: RT_DE_TESTE,
      texto: COLONOSCOPIA_COM_CLARA,
    });
    const mascarada = mascararNome(mensagem, "Preparo Silva");
    // As duas ancoras caem na fala mascarada.
    expect(mascarada.startsWith("Orientação de preparo para ")).toBe(false);
    expect(mascarada.endsWith(RODAPE_SEM_MASCARA)).toBe(false);
    const lido = lidoPeloModelo("Preparo Silva", mensagem, [
      COLONOSCOPIA_COM_CLARA,
    ]);
    // O substituto e texto fixo do sistema: a mascara nao mexe nele.
    expect(lido).toBe(substitutoDaMensagemDoPreparo("Colonoscopia"));
    expect(normal(lido)).not.toContain("bisacodil");
    semNenhumaFrase(lido, COLONOSCOPIA_COM_CLARA, "Preparo Silva");
  });

  it("o marcador nunca e mascarado (a contato chamada Preparo), e o resto do nome que fica fora do texto continua mascarado", () => {
    const texto = "Na véspera, só líquidos claros e o laxante às 18h.";
    const lido = lidoPeloModelo(
      "Preparo Silva",
      `Oi, Preparo! Seu preparo:\n${texto}\nAté amanhã, Preparo Silva.`,
      [texto],
    );
    expect(lido).toBe(
      `Oi, Fulano! Seu Fulano:\n${SUBSTITUTO_DO_TEXTO_DO_PREPARO}\nAté amanhã, Fulano.`,
    );
    // O nome inteiro cortado pelo fim do texto da clinica: o pedaco de fora
    // (o sobrenome) continua mascarado.
    const comONome = "Traga o pedido médico assinado, Ana";
    const cortado = lidoPeloModelo(
      "Ana Beatriz",
      `${comONome} Beatriz, e venha em jejum.`,
      [comONome],
    );
    expect(cortado).toBe(
      `${SUBSTITUTO_DO_TEXTO_DO_PREPARO}${"Fulano"}, e venha em jejum.`,
    );
  });

  it("a fala da equipe (usuario) com o texto colado e o nome dentro: o marcador", () => {
    const lido = lidoPeloModelo(
      "Clara",
      `Clara, segue de novo:\n${COLONOSCOPIA_COM_CLARA}`,
      [COLONOSCOPIA_COM_CLARA],
      "usuario",
    );
    expect(lido).toBe(
      `Fulano, segue de novo:\n${SUBSTITUTO_DO_TEXTO_DO_PREPARO}`,
    );
  });

  it("sem o corpo como saiu (quem montou a mensagem a mao), com o nome: o texto mascarado tambem casa", () => {
    const mascarada = mascararNome(
      toque("Clara", COLONOSCOPIA_COM_CLARA),
      "Clara",
    );
    const lido = mensagemParaOModelo(daClinica(mascarada), {
      textosDePreparo: [COLONOSCOPIA_COM_CLARA],
      nomeDoContato: "Clara",
    });
    expect(lido).toContain(SUBSTITUTO_DO_TEXTO_DO_PREPARO);
    semNenhumaFrase(lido, COLONOSCOPIA_COM_CLARA, "Clara");
  });

  it("falha fechada: o corpo como saiu sem o nome do contato (quem chamou nao passou) vira o substituto inteiro; sem preparo, o mascarado de sempre", () => {
    const historico = montarHistorico(
      [
        {
          id: "r1",
          author: "sistema",
          content_type: "texto",
          body: toque("Clara", COLONOSCOPIA_COM_CLARA),
          media_url: null,
          created_at: "2026-11-03T11:00:00.000Z",
        },
        {
          id: "r2",
          author: "sistema",
          content_type: "texto",
          body: "Oi, Clara! Tudo certo para amanhã?",
          media_url: null,
          created_at: "2026-11-03T11:30:00.000Z",
        },
      ],
      new Set(),
      "Clara",
    );
    const [comPreparo, semPreparo] = historicoParaOModelo(historico.mensagens, {
      textosDePreparo: [COLONOSCOPIA_COM_CLARA],
    });
    expect((comPreparo as { content: unknown }).content).toBe(
      SUBSTITUTO_DA_FALA_SEM_A_MASCARA,
    );
    expect((semPreparo as { content: unknown }).content).toBe(
      "Oi, Fulano! Tudo certo para amanhã?",
    );
  });
});
