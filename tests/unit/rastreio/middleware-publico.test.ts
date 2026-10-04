import { describe, expect, it } from "vitest";

import { config } from "@/middleware";

// O visitante do site da clinica nao tem sessao. Se o script ou a rota do
// aviso passassem pelo middleware, ele seria redirecionado para /login e o
// rastreio pararia calado (o script nem carregaria). O matcher e um padrao de
// path-to-regexp que, neste formato, e a propria expressao regular.

const matcher = config.matcher[0] ?? "";
const passaPeloMiddleware = (caminho: string): boolean =>
  new RegExp(`^${matcher}$`).test(caminho);

describe("matcher do middleware e o rastreio do site", () => {
  it("o script e a rota publica ficam fora", () => {
    expect(passaPeloMiddleware("/rastreio/v1.js")).toBe(false);
    expect(passaPeloMiddleware("/api/publico/clique")).toBe(false);
  });

  it("a rota das frases (GET pela chave) tambem fica fora", () => {
    expect(
      passaPeloMiddleware("/api/publico/rastreio/0123456789abcdef0123"),
    ).toBe(false);
  });

  it("o resto continua protegido", () => {
    expect(passaPeloMiddleware("/inicio")).toBe(true);
    expect(passaPeloMiddleware("/configuracoes")).toBe(true);
    expect(passaPeloMiddleware("/api/publicos")).toBe(true);
    expect(passaPeloMiddleware("/rastreio")).toBe(true);
  });

  it("as exclusoes de antes continuam", () => {
    expect(passaPeloMiddleware("/api/webhooks/whatsapp")).toBe(false);
    expect(passaPeloMiddleware("/api/atendimento/midia")).toBe(false);
    expect(passaPeloMiddleware("/brand/logo.svg")).toBe(false);
  });
});
