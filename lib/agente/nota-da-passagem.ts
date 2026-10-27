// A nota interna que a IA deixa para a equipe quando passa a conversa (AG3,
// item 8: notaDaPassagem, em lib/agente/atendimento.ts; gravada por
// anotarPassagemParaAEquipe, em lib/agente/whatsapp.ts). Modulo PURO e sem
// import: o Atendimento (no navegador) le daqui.
//
// D-20 (decisao do dono, 27/10/2026): no fio a nota aparecia assinada
// "Automação", porque e gravada como a nota de uma automacao de fluxo
// (author 'sistema', is_internal_note, sem pessoa). Agora ela assina
// "Assistente", com a autoria da IA. Sem mudar o banco: author 'ia' em nota
// interna o gatilho de message recusa (ia_sem_aprovacao) e message.job_id e
// unico (e da frase fixa do mesmo job). A nota da IA se reconhece pelo
// CABECALHO fixo, que so o sistema escreve, como a frase fixa se reconhece
// pelo corpo (components/atendimento/aviso-automatico.ts).

/** A primeira linha de toda nota da passagem da IA. */
export const CABECALHO_DA_NOTA_DA_PASSAGEM =
  "Resumo do assistente para a equipe (montado pelo sistema, sem dados do paciente).";

/** Quem assina a nota da passagem no fio (a mesma assinatura da IA). */
export const AUTOR_DA_NOTA_DA_PASSAGEM = "Assistente";

/**
 * A mensagem e a nota da passagem da IA? Nota interna do sistema (author
 * 'sistema', sem pessoa), em texto, que nao saiu pelo celular, com o corpo
 * que comeca pelo CABECALHO_DA_NOTA_DA_PASSAGEM (sozinho ou seguido de uma
 * quebra de linha). A nota de uma automacao de fluxo (o texto que a clinica
 * escreveu) continua "Automação".
 */
export function ehNotaDaPassagemDaIa(mensagem: {
  author: string;
  author_user_id?: string | null;
  is_internal_note: boolean;
  body?: string | null;
  direction?: string;
  content_type?: string;
  pelo_celular?: boolean;
}): boolean {
  const corpo = mensagem.body ?? null;
  return (
    mensagem.author === "sistema" &&
    mensagem.is_internal_note &&
    !mensagem.author_user_id &&
    mensagem.pelo_celular !== true &&
    (mensagem.direction === undefined || mensagem.direction === "saida") &&
    (mensagem.content_type === undefined ||
      mensagem.content_type === "texto") &&
    corpo !== null &&
    (corpo === CABECALHO_DA_NOTA_DA_PASSAGEM ||
      corpo.startsWith(`${CABECALHO_DA_NOTA_DA_PASSAGEM}\n`))
  );
}
