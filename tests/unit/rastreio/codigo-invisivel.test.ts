import { describe, expect, it } from "vitest";

import { extrairToken, normalizarTexto, TOKEN_ALPHABET } from "@/lib/domain/attribution";
import {
  codificarCodigoInvisivel,
  mensagemComCodigoInvisivel,
  separarCodigoInvisivel,
} from "@/lib/domain/codigo-invisivel";
import {
  destinoDoCliqueDoLink,
  lerRespostaDoCliqueDoLink,
  CODIGO_INVISIVEL_LIGADO,
  usarCodigoInvisivel,
} from "@/lib/domain/link-rastreado";

// Codigo do clique em caracteres invisiveis (etapa 3c do plano de
// 16/11/2026). Regras puras: ida e volta de todo codigo, o lugar na mensagem
// (depois da primeira palavra, nunca no fim), o que NAO pode virar codigo e o
// destino do link com e sem a chave.

const MENSAGEM = "Olá! Vi o perfil da clínica e quero agendar uma avaliação.";
const INVISIVEL = /[​‌‍⁠]/g;

describe("codificar e separar", () => {
  it("todo símbolo do alfabeto vai e volta, em qualquer posição", () => {
    for (let i = 0; i < TOKEN_ALPHABET.length; i += 1) {
      const codigo = Array.from(
        { length: 6 },
        (_, posicao) => TOKEN_ALPHABET[(i + posicao * 7) % TOKEN_ALPHABET.length],
      ).join("");
      const invisivel = codificarCodigoInvisivel(codigo);
      expect(invisivel).toHaveLength(15);
      expect(invisivel?.replace(INVISIVEL, "")).toBe("");
      expect(separarCodigoInvisivel(`Olá${invisivel} mundo`)).toEqual({
        texto: "Olá mundo",
        codigo,
      });
    }
  });

  it("minúsculas valem; código fora do alfabeto ou do tamanho não codifica", () => {
    expect(codificarCodigoInvisivel("k7q2mx")).toBe(
      codificarCodigoInvisivel("K7Q2MX"),
    );
    for (const ruim of ["K7Q2M", "K7Q2MXA", "K7Q2M0", "K7Q2ML", ""]) {
      expect(codificarCodigoInvisivel(ruim)).toBeNull();
    }
  });

  it("a mensagem fica igual para quem lê, com o código depois da primeira palavra", () => {
    const escondida = mensagemComCodigoInvisivel(MENSAGEM, "K7Q2MX")!;
    expect(escondida.replace(INVISIVEL, "")).toBe(MENSAGEM);
    expect(escondida.startsWith(`Olá!${codificarCodigoInvisivel("K7Q2MX")} Vi`)).toBe(
      true,
    );
    // Nada de codigo a vista, e a mensagem pronta cadastrada ainda casa.
    expect(extrairToken(escondida)).toBeNull();
    expect(normalizarTexto(escondida)).toBe(normalizarTexto(MENSAGEM));
    expect(separarCodigoInvisivel(escondida)).toEqual({
      texto: MENSAGEM,
      codigo: "K7Q2MX",
    });
  });

  it("mensagem de uma palavra só não esconde (no fim o WhatsApp corta os invisíveis)", () => {
    expect(mensagemComCodigoInvisivel("Olá!", "K7Q2MX")).toBeNull();
    expect(mensagemComCodigoInvisivel("  Olá!  ", "K7Q2MX")).toBeNull();
    expect(mensagemComCodigoInvisivel(MENSAGEM, "K7Q2M0")).toBeNull();
  });

  it("o que não é código fica como veio: emoji composto, outra ferramenta, sequência cortada", () => {
    const familia = "Oi 👨‍👩‍👧 tudo bem?";
    expect(separarCodigoInvisivel(familia)).toEqual({
      texto: familia,
      codigo: null,
    });
    // Texto de outra ferramenta, com dezenas de invisiveis seguidos.
    const outra = `Olá${"​‌".repeat(40)} quero agendar`;
    expect(separarCodigoInvisivel(outra)).toEqual({ texto: outra, codigo: null });
    // Sequencia cortada pelo caminho (14) ou com um a mais (16).
    const inteiro = codificarCodigoInvisivel("K7Q2MX")!;
    for (const sequencia of [inteiro.slice(1), `${inteiro}​`]) {
      const texto = `Olá${sequencia} mundo`;
      expect(separarCodigoInvisivel(texto)).toEqual({ texto, codigo: null });
    }
    expect(separarCodigoInvisivel(null)).toEqual({ texto: null, codigo: null });
    expect(separarCodigoInvisivel("Olá mundo")).toEqual({
      texto: "Olá mundo",
      codigo: null,
    });
  });

  it("15 invisíveis que não formam um código do alfabeto não viram código", () => {
    // 11111 em todo simbolo: indice 31, fora do alfabeto de 31 simbolos.
    const texto = `Olá${"⁠".repeat(15)} mundo`;
    expect(separarCodigoInvisivel(texto)).toEqual({ texto, codigo: null });
  });
});

describe("o destino do link", () => {
  const resposta = lerRespostaDoCliqueDoLink({
    resultado: "ok",
    digitos: "5585999990000",
    mensagem: MENSAGEM,
    codigo_fixo: "F7X2AB",
    numero: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    codigo: "K7Q2MX",
  })!;
  const textoDe = (destino: string | null) =>
    new URL(destino ?? "").searchParams.get("text") ?? "";

  it("desligado, o código vai à vista; ligado, vai escondido e a mensagem não muda para quem lê", () => {
    expect(textoDe(destinoDoCliqueDoLink(resposta))).toBe(
      `${MENSAGEM} [#K7Q2MX]`,
    );
    const escondido = textoDe(
      destinoDoCliqueDoLink(resposta, { codigoInvisivel: true }),
    );
    expect(escondido).not.toContain("[#");
    expect(separarCodigoInvisivel(escondido)).toEqual({
      texto: MENSAGEM,
      codigo: "K7Q2MX",
    });
  });

  it("mensagem de uma palavra só, ou clique não gravado: o código à vista mesmo com a chave ligada", () => {
    const curta = lerRespostaDoCliqueDoLink({
      resultado: "ok",
      digitos: "5585999990000",
      mensagem: "Olá!",
      codigo_fixo: null,
      numero: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      codigo: "K7Q2MX",
    })!;
    expect(textoDe(destinoDoCliqueDoLink(curta, { codigoInvisivel: true }))).toBe(
      "Olá! [#K7Q2MX]",
    );
    const limite = lerRespostaDoCliqueDoLink({
      resultado: "limite",
      digitos: "5585999990000",
      mensagem: MENSAGEM,
      codigo_fixo: "F7X2AB",
      numero: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    })!;
    expect(
      textoDe(destinoDoCliqueDoLink(limite, { codigoInvisivel: true })),
    ).toBe(`${MENSAGEM} [#F7X2AB]`);
  });

  it("a chave: ligada no código ou o parâmetro do teste em 1", () => {
    expect(usarCodigoInvisivel(false, null)).toBe(false);
    expect(usarCodigoInvisivel(false, "0")).toBe(false);
    expect(usarCodigoInvisivel(false, "sim")).toBe(false);
    expect(usarCodigoInvisivel(true, null)).toBe(true);
    expect(usarCodigoInvisivel(false, "1")).toBe(true);
    // Desligado ate o teste com celular real (decisao do plano de 16/11/2026).
    expect(CODIGO_INVISIVEL_LIGADO).toBe(false);
  });
});
