import { describe, expect, it } from "vitest";

import {
  casaEtiquetas,
  etiquetasDaConversa,
  porChaveDeEtiqueta,
  type EtiquetaDeConversa,
} from "@/lib/domain/etiquetas-de-conversa";

// A logica pura das etiquetas de conversa: a regra do filtro (marcar varias
// SOMA) e a resolucao chave para nome e cor, que e o que impede a tela de
// mostrar chave crua ou, pior, esconder que a conversa tem etiqueta.

const CATALOGO: EtiquetaDeConversa[] = [
  { id: "1", chave: "urgente", nome: "Urgente", tom: "alert" },
  { id: "2", chave: "orcamento_enviado", nome: "Orçamento enviado", tom: "info" },
  { id: "3", chave: "aguardando", nome: "Água quente", tom: "warning" },
];

describe("casaEtiquetas", () => {
  it("sem escolha, passa tudo", () => {
    expect(casaEtiquetas([], [])).toBe(true);
    expect(casaEtiquetas(["urgente"], [])).toBe(true);
  });

  it("marcar duas SOMA: basta ter uma delas", () => {
    expect(casaEtiquetas(["urgente"], ["urgente", "orcamento_enviado"])).toBe(
      true,
    );
    expect(
      casaEtiquetas(["orcamento_enviado"], ["urgente", "orcamento_enviado"]),
    ).toBe(true);
  });

  it("conversa sem etiqueta não casa quando há escolha", () => {
    expect(casaEtiquetas([], ["urgente"])).toBe(false);
  });

  it("escolha de chave que não existe não derruba nem casa por engano", () => {
    expect(casaEtiquetas(["urgente"], ["fantasma"])).toBe(false);
  });
});

describe("etiquetasDaConversa", () => {
  const porChave = porChaveDeEtiqueta(CATALOGO);

  it("resolve nome e cor a partir da chave", () => {
    const resolvidas = etiquetasDaConversa(["urgente"], porChave);
    expect(resolvidas).toEqual([
      { chave: "urgente", nome: "Urgente", tom: "alert" },
    ]);
  });

  it("ordena por nome respeitando acento do português", () => {
    const resolvidas = etiquetasDaConversa(
      ["urgente", "orcamento_enviado", "aguardando"],
      porChave,
    );
    // "Água quente" vem antes de "Orçamento enviado" em pt-BR, apesar do Á.
    expect(resolvidas.map((e) => e.nome)).toEqual([
      "Água quente",
      "Orçamento enviado",
      "Urgente",
    ]);
  });

  it("chave fora do catálogo (cache velho) vira nome cru em tom neutro, nunca some", () => {
    const resolvidas = etiquetasDaConversa(["fantasma"], porChave);
    expect(resolvidas).toEqual([
      { chave: "fantasma", nome: "fantasma", tom: "neutral" },
    ]);
  });

  it("conversa sem etiqueta devolve lista vazia", () => {
    expect(etiquetasDaConversa([], porChave)).toEqual([]);
  });
});
