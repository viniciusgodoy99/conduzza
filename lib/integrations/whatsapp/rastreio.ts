// Marca de rastreio dos envios feitos pelo sistema (track_source e track_id
// do uazapi). O provedor devolve as duas no evento "messages", entao o eco de
// uma mensagem nossa e reconhecido pela marca mesmo que o filtro wasSentByApi
// falhe. Sem isso, o eco seria gravado como mensagem enviada pelo celular e a
// conversa mostraria a mesma mensagem duas vezes.
//
// O track_id e o id da linha de message (uuid), nunca conteudo.

export const ORIGEM_DO_RASTREIO = "conduzza";
