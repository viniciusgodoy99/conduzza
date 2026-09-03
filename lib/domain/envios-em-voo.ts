import type { MessageItem } from "@/lib/queries/conversations";

// Mensagens que a atendente ja mandou e que ainda nao viraram linha no banco.
//
// POR QUE ISSO EXISTE. A linha de message nasce no banco ANTES da espera
// anti-ban de 1,5 a 4 segundos (send.ts), entao a bolha real ja esta a caminho
// da tela enquanto a Server Action ainda dorme. O que travava era a interface:
// o texto so era limpo quando a acao inteira voltava. Limpar na hora resolve a
// fluidez, mas abre uma janela em que a caixa esta vazia e nada apareceu ainda.
// Estes envios preenchem essa janela.
//
// POR QUE FORA DO CACHE DO TANSTACK. O cache do fio e a verdade do servidor e e
// substituido inteiro a cada refetch. Uma bolha otimista guardada la seria
// apagada por qualquer invalidacao (piscada) ou sobreviveria ao refetch ao lado
// da linha real (duplicata). Aqui, invalidacao nenhuma a alcanca, e a
// reconciliacao vira explicita e testavel.

export type EstadoDoEnvio = "enviando" | "falhou";

export type EnvioEmVoo = {
  /** identidade so para o React; nao tem significado no banco */
  chave: string;
  /**
   * A conversa para onde este texto vai, capturada NO GESTO.
   *
   * Nunca releia a conversa selecionada quando a acao voltar. Este componente
   * ja produziu um defeito grave exatamente assim: o anexo sobrevivia a troca
   * de conversa e a foto de um paciente podia sair para outro.
   */
  conversationId: string;
  /** o corpo APARADO, que e o que o servidor grava (bodySchema tem .trim()) */
  corpo: string;
  /**
   * Nota interna ou resposta ao paciente, capturado NO GESTO.
   *
   * Mesma razao do conversationId, e a licao do segundo defeito grave: o plano
   * era derivado e podia trocar por baixo, fazendo uma nota interna sair pelo
   * WhatsApp do paciente.
   */
  ehNota: boolean;
  citandoId: string | null;
  /**
   * Ids que ja estavam na tela quando este envio nasceu.
   *
   * E o que distingue a linha nova da mensagem antiga de texto identico. Usar
   * horario aqui seria bug silencioso: o created_at vem do relogio do banco e o
   * navegador tem outro.
   */
  idsAntes: ReadonlySet<string>;
  estado: EstadoDoEnvio;
  erro?: string;
};

/**
 * Quais envios ainda NAO tem linha correspondente na conversa.
 *
 * O casamento e por CONTEUDO, e nao por id, porque o id de uma mensagem e
 * decidido pelo banco: deixar o navegador escolher a chave primaria de uma
 * linha de dado de saude seria pior que o problema que isso resolve (essa
 * chave e tambem o caminho do arquivo no balde de midia).
 *
 * A atribuicao e UM PARA UM. Sem isso, mandar "ok" duas vezes seguidas faria a
 * primeira linha real casar com os dois envios, e as duas bolhas sumiriam
 * juntas deixando uma so na tela.
 *
 * Envio que FALHOU tambem participa: quando o provedor recusa depois do insert,
 * a linha real existe com delivery_status 'falhou' e a bolha ja mostra isso.
 * Sem incluir os falhados, o erro apareceria em duplicata.
 */
export function conciliarEnvios(
  mensagens: readonly MessageItem[],
  emVoo: readonly EnvioEmVoo[],
  viewerId: string,
): EnvioEmVoo[] {
  if (emVoo.length === 0) {
    return [];
  }
  const consumidas = new Set<string>();
  const pendentes: EnvioEmVoo[] = [];

  for (const envio of emVoo) {
    const casada = mensagens.find(
      (mensagem) =>
        !consumidas.has(mensagem.id) &&
        !envio.idsAntes.has(mensagem.id) &&
        mensagem.direction === "saida" &&
        mensagem.author_user_id === viewerId &&
        mensagem.is_internal_note === envio.ehNota &&
        mensagem.deleted_at === null &&
        (mensagem.body ?? "").trim() === envio.corpo,
    );
    if (casada) {
      consumidas.add(casada.id);
    } else {
      pendentes.push(envio);
    }
  }

  return pendentes;
}

/** Os envios em voo de UMA conversa, na ordem em que foram feitos. */
export function enviosDaConversa(
  emVoo: readonly EnvioEmVoo[],
  conversationId: string,
): EnvioEmVoo[] {
  return emVoo.filter((envio) => envio.conversationId === conversationId);
}
