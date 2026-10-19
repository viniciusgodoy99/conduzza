import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { MessageItem } from "@/lib/queries/conversations";

// A frase fixa que o contato recebe quando a IA passa a conversa para a
// equipe (revisao de producao de 19/10/2026, operacao.md 14). Ela sai com
// author 'sistema' pela linha do job da IA (enviarFraseFixaDaIa, com o corpo
// SEMPRE igual a FRASE_DE_ESCALONAMENTO; o gatilho de message confere o
// corpo). No fio ela aparecia na pele da atendente e sem linha de autor, e
// quem nao viu o evento achava que alguem da equipe tinha respondido. Agora
// e uma mensagem automatica do sistema: pele propria (neutra), linha
// "Aviso automático" com o icone de "passou para a equipe" e a explicacao
// para o leitor de tela. Modulo puro (o fio, a bolha e a citacao usam).

/** A linha de autor da frase fixa (e o autor da citacao dela). */
export const AUTOR_DO_AVISO_AUTOMATICO = "Aviso automático";

/** A explicacao da linha de autor: dica do mouse e leitor de tela. */
export const EXPLICACAO_DO_AVISO_AUTOMATICO =
  "Mensagem automática enviada ao contato quando a IA passa a conversa para a equipe.";

/**
 * A mensagem e a frase fixa da IA? Saida do sistema (author 'sistema'), em
 * texto, que nao e nota interna nem resposta automatica do app WhatsApp
 * Business (pelo_celular), com o corpo IGUAL a FRASE_DE_ESCALONAMENTO.
 *
 * O fio nao traz o job_id da mensagem (lib/queries/conversations.ts): o
 * corpo exato basta, porque so o envio da frase grava esse corpo como
 * 'sistema'. Quando o job_id vier junto, ele tambem conta: sem job, nao e a
 * frase da IA.
 */
export function ehAvisoAutomaticoDaIa(
  mensagem: Pick<MessageItem, "author" | "body" | "is_internal_note"> &
    Partial<Pick<MessageItem, "direction" | "content_type" | "pelo_celular">> & {
      job_id?: string | null;
    },
): boolean {
  return (
    mensagem.author === "sistema" &&
    mensagem.body === FRASE_DE_ESCALONAMENTO &&
    !mensagem.is_internal_note &&
    mensagem.pelo_celular !== true &&
    (mensagem.direction === undefined || mensagem.direction === "saida") &&
    (mensagem.content_type === undefined ||
      mensagem.content_type === "texto") &&
    mensagem.job_id !== null
  );
}
