import { describe, expect, it } from "vitest";

import {
  ROTULO_DO_TIQUE,
  tiqueDaMensagem,
} from "@/lib/domain/tique-da-mensagem";

// Tique de entrega como no WhatsApp (pedido do dono em 06/10/2026).

const saida = {
  direction: "saida",
  delivery_status: "enviada",
  is_internal_note: false,
  content_type: "texto",
  deleted_at: null,
};

describe("tique da mensagem enviada", () => {
  it("um tique enviada, dois entregue, dois azuis lida", () => {
    expect(tiqueDaMensagem(saida)).toBe("enviada");
    expect(tiqueDaMensagem({ ...saida, delivery_status: "entregue" })).toBe(
      "entregue",
    );
    expect(tiqueDaMensagem({ ...saida, delivery_status: "lida" })).toBe("lida");
    expect(tiqueDaMensagem({ ...saida, delivery_status: "enviando" })).toBe(
      "enviando",
    );
  });

  it("sem tique: paciente, nota, evento, apagada, falhou e situação desconhecida", () => {
    expect(tiqueDaMensagem({ ...saida, direction: "entrada" })).toBeNull();
    expect(tiqueDaMensagem({ ...saida, is_internal_note: true })).toBeNull();
    expect(tiqueDaMensagem({ ...saida, content_type: "evento" })).toBeNull();
    expect(
      tiqueDaMensagem({ ...saida, deleted_at: "2026-10-06T12:00:00.000Z" }),
    ).toBeNull();
    expect(tiqueDaMensagem({ ...saida, delivery_status: "falhou" })).toBeNull();
    expect(tiqueDaMensagem({ ...saida, delivery_status: null })).toBeNull();
  });

  it("o texto do tique, para a dica e o leitor de tela, sem travessão", () => {
    expect(ROTULO_DO_TIQUE).toEqual({
      enviando: "Enviando",
      enviada: "Enviada",
      entregue: "Entregue",
      lida: "Lida",
    });
  });
});
