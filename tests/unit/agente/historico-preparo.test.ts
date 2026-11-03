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
  SUBSTITUTO_DO_TEXTO_DO_PREPARO,
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

  it("no simulador (autoria ia), o mesmo", () => {
    expect(
      mensagemParaOModelo(daClinica(MENSAGEM, "ia"), {
        textosDePreparo: TEXTOS,
      }),
    ).toBe(SUBSTITUTO);
    expect(
      historicoParaOModelo(
        [
          { autor: "paciente", texto: "Qual o preparo da colonoscopia?" },
          { autor: "assistente", autoria: "ia", texto: MENSAGEM },
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

  it("com o cabecalho mexido pela mascara do nome do contato: o rodape reconhece, sem o nome do procedimento", () => {
    const mascarada = mascararNome(MENSAGEM, "De Lima");
    expect(mascarada.startsWith("Orientação de preparo para ")).toBe(false);
    const lida = mensagemParaOModelo(daClinica(mascarada), {
      textosDePreparo: TEXTOS,
    });
    expect(lida).toBe(substitutoDaMensagemDoPreparo(""));
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
