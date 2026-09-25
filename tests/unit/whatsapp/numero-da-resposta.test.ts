import { describe, expect, it } from "vitest";

import {
  numeroQueRecebeu,
  valeParaONumero,
} from "@/lib/integrations/whatsapp/interceptar-resposta";

// O recorte por numero da resposta do paciente (decisao D2 do desenho de
// varios numeros, docs/07): um "sim" dito ao numero B nao confirma o toque
// que saiu pelo numero A.

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("numeroQueRecebeu", () => {
  it("um so basta: o do webhook ou o da conversa", () => {
    expect(numeroQueRecebeu(A, null)).toBe(A);
    expect(numeroQueRecebeu(undefined, A)).toBe(A);
    expect(numeroQueRecebeu(A, A)).toBe(A);
  });

  it("nenhum dos dois (clinica sem numero): sem recorte", () => {
    expect(numeroQueRecebeu(null, null)).toBeNull();
    expect(numeroQueRecebeu(undefined, undefined)).toBeNull();
  });

  it("os dois diferentes e duvida", () => {
    expect(numeroQueRecebeu(A, B)).toBe("divergente");
  });
});

describe("valeParaONumero", () => {
  const soEste = { numero: A, outrosNumeros: false };
  const comOutro = { numero: A, outrosNumeros: true };

  it("mensagem do mesmo numero vale", () => {
    expect(valeParaONumero(A, soEste)).toBe(true);
    expect(valeParaONumero(A, comOutro)).toBe(true);
  });

  it("mensagem de outro numero nunca vale", () => {
    expect(valeParaONumero(B, soEste)).toBe(false);
    expect(valeParaONumero(B, comOutro)).toBe(false);
  });

  it("numero desconhecido vale so sem outro numero na historia do contato", () => {
    // Um numero so (o caso de hoje): tudo o que ele recebeu saiu por este.
    expect(valeParaONumero(null, soEste)).toBe(true);
    // Com conversa em outro numero, a duvida fica com a recepcao.
    expect(valeParaONumero(null, comOutro)).toBe(false);
  });

  it("clinica sem numero: sem recorte, como antes", () => {
    const semNumero = { numero: null, outrosNumeros: false };
    expect(valeParaONumero(null, semNumero)).toBe(true);
    expect(valeParaONumero(B, semNumero)).toBe(true);
  });
});
