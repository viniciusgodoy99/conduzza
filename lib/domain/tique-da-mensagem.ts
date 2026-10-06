// Tique de entrega da mensagem ENVIADA pela clinica, como no WhatsApp (pedido
// do dono em 06/10/2026): um tique enviada, dois tiques entregue, dois tiques
// azuis lida. O dado vem de message.delivery_status, que o webhook do uazapi
// atualiza (messages_update: Delivered vira entregue, Read vira lida). "Lida"
// so chega quando o paciente deixa a confirmacao de leitura ligada no
// WhatsApp; sem ela, a mensagem fica em entregue, como no proprio WhatsApp.
// PURO, zero I/O.
//
// O azul de "lida" e o mesmo icone de "entregue" em outra cor: excecao
// autorizada pelo dono a regra 5 do CLAUDE.md. A camada de texto ("Enviada",
// "Entregue", "Lida") vai na dica e no leitor de tela.

export type TiqueDaMensagem = "enviando" | "enviada" | "entregue" | "lida";

export const ROTULO_DO_TIQUE: Record<TiqueDaMensagem, string> = {
  enviando: "Enviando",
  enviada: "Enviada",
  entregue: "Entregue",
  lida: "Lida",
};

/**
 * O tique da bolha, ou null quando ela nao tem tique: mensagem do paciente,
 * nota interna, evento, mensagem apagada e a que falhou (essa tem o aviso
 * proprio "Não foi entregue").
 */
export function tiqueDaMensagem(mensagem: {
  direction: string;
  delivery_status: string | null;
  is_internal_note?: boolean | null;
  content_type?: string | null;
  deleted_at?: string | null;
}): TiqueDaMensagem | null {
  if (
    mensagem.direction !== "saida" ||
    mensagem.is_internal_note === true ||
    mensagem.content_type === "evento" ||
    mensagem.deleted_at
  ) {
    return null;
  }
  switch (mensagem.delivery_status) {
    case "enviando":
    case "enviada":
    case "entregue":
    case "lida":
      return mensagem.delivery_status;
    default:
      return null;
  }
}
