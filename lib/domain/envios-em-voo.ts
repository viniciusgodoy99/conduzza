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
   * Distingue a linha nova da mensagem antiga de texto identico QUANDO ela ja
   * estava carregada. Nao basta sozinho: ver `apartirDe`.
   */
  idsAntes: ReadonlySet<string>;
  /**
   * created_at da mensagem mais recente do fio no instante do gesto.
   *
   * `idsAntes` e um retrato so das paginas CARREGADAS, e o fio pagina de 50 em
   * 50 para tras. Uma mensagem antiga identica que entrasse depois (por
   * "Carregar mensagens anteriores") ficava de fora do conjunto e era aceita
   * como prova de chegada: a bolha sumia com o envio ainda em voo e, se ele
   * tivesse falhado, o cartao "Nao enviada" sumia levando o texto junto.
   *
   * Este piso fecha isso. Os dois lados da comparacao sao carimbos do BANCO,
   * entao o relogio do navegador nao entra na conta em momento nenhum.
   *
   * Nulo significa que o fio ainda nao tinha carregado: nesse caso nao existe
   * piso confiavel e o casamento por conteudo e recusado por inteiro.
   */
  apartirDe: string | null;
  /**
   * Id real da linha, quando a Server Action ja respondeu.
   *
   * Encerra a conciliacao sem ambiguidade. O casamento por conteudo so existe
   * para a janela ANTES desta resposta, em que o tempo real ja entregou a
   * mensagem.
   */
  messageId?: string;
  estado: EstadoDoEnvio;
  erro?: string;
  /**
   * A resposta se perdeu, mas a mensagem pode ter saido.
   *
   * A linha nasce no banco ANTES da espera anti-ban, entao uma falha de rede na
   * VOLTA nao prova que nada foi enviado. Reenviar as cegas faria o paciente
   * receber duas vezes, e este canal e nao oficial: mensagem repetida e o tipo
   * de coisa que acelera banimento do numero.
   */
  incerto?: boolean;
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
  /**
   * A conversa a que `mensagens` pertence.
   *
   * OBRIGATORIO, e a razao e um defeito real: sem ele, um envio da conversa A
   * era consumido por uma mensagem QUALQUER da conversa B com o mesmo texto.
   * O `idsAntes` do envio foi montado com as mensagens da A, entao toda
   * mensagem da B conta como "nova" e casa. Mandar "ok" para a Maria e abrir a
   * conversa do Joao, que tem um "ok" meu de ontem, fazia a bolha da Maria
   * sumir com o envio ainda em voo; se ele tivesse falhado, o cartao "Nao
   * enviada" sumia junto e o texto se perdia em silencio, que e exatamente o
   * que aquele cartao existe para impedir.
   *
   * Envio de OUTRA conversa nunca e conciliado aqui: nao ha evidencia sobre
   * ele nesta tela, e ausencia de evidencia nao e evidencia de chegada.
   */
  conversationId: string | null,
): EnvioEmVoo[] {
  if (emVoo.length === 0) {
    return [];
  }
  const consumidas = new Set<string>();
  const pendentes: EnvioEmVoo[] = [];

  for (const envio of emVoo) {
    if (envio.conversationId !== conversationId) {
      pendentes.push(envio);
      continue;
    }

    // CAMINHO EXATO: a Server Action ja disse qual e a linha.
    if (envio.messageId) {
      const real = mensagens.find((m) => m.id === envio.messageId);
      if (real) {
        consumidas.add(real.id);
      } else {
        pendentes.push(envio);
      }
      continue;
    }

    // Sem piso nao ha casamento por conteudo: o fio nao estava carregado no
    // gesto, entao QUALQUER mensagem antiga passaria por nova. Espera a
    // resposta da acao, que traz o id.
    if (envio.apartirDe === null) {
      pendentes.push(envio);
      continue;
    }

    const casada = mensagens.find(
      (mensagem) =>
        !consumidas.has(mensagem.id) &&
        !envio.idsAntes.has(mensagem.id) &&
        // Carimbos do banco dos dois lados: nenhum relogio de navegador aqui.
        mensagem.created_at >= envio.apartirDe! &&
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
