// O que uma falha do envio (send.ts) diz sobre o paciente: recebeu ou nao.
// Modulo PURO, sem I/O, separado de send.ts para quem so precisa decidir
// (as Server Actions e os testes) nao carregar o provedor junto. send.ts
// reexporta tudo daqui: o lugar da lista continua sendo "a do envio".

/**
 * Codigos de falha em que o provedor COM CERTEZA nao chegou a enviar: o
 * retry e seguro. O unico ambiguo e 'envio_incerto' (a mensagem pode ter
 * chegado e so a resposta se perdido): esse NUNCA entra em retry automatico.
 *
 * A MESMA lista vive no SQL da mensagem agendada (migration
 * 20261006140000: o job 'enviando' com message 'falhou' por um destes
 * codigos ainda pode ser cancelado). Um teste de unidade cruza as duas:
 * mudou aqui, muda la.
 */
export const FALHAS_SEM_ENVIO = [
  "slot_indisponivel",
  "leitura_falhou",
  "canal_ocupado",
  "sem_consentimento_no_envio",
  "sem_instancia",
  "configuracao_ausente",
  "provider_indisponivel",
] as const;

const CONJUNTO_SEM_ENVIO: ReadonlySet<string> = new Set(FALHAS_SEM_ENVIO);

export function falhaPermiteRetry(code: string | undefined | null): boolean {
  return typeof code === "string" && CONJUNTO_SEM_ENVIO.has(code);
}

/**
 * Codigos que send.ts devolve ANTES de chamar o provedor e que nao sao
 * retry automatico (repetir daria o mesmo resultado): nada saiu, com
 * certeza. 'registro_falhou' e a linha de message que nao nasceu (ou nao
 * virou 'enviando'): o provedor nao foi chamado.
 */
const RECUSAS_ANTES_DO_PROVEDOR: ReadonlySet<string> = new Set([
  "conversa_inexistente",
  "conta_divergente",
  "contato_inexistente",
  "registro_falhou",
]);

/**
 * A falha do envio garante que NADA chegou ao paciente? So entao quem chama
 * pode oferecer o mesmo texto para mandar de novo (o "Enviar agora" da
 * mensagem agendada devolve o texto ao campo).
 *
 * Certo que nao saiu: sem autorizacao (antes do envio ou na reconferencia),
 * numero desconectado ou removido, canal ocupado (nada reservado), as
 * recusas antes do provedor e os codigos de FALHAS_SEM_ENVIO. Qualquer
 * outra coisa (envio_incerto, resposta do provedor como uazapi_500,
 * 'ja_enviado', codigo desconhecido) PODE ter chegado.
 */
export function envioCertamenteNaoSaiu(falha: {
  reason: string;
  code?: string;
}): boolean {
  switch (falha.reason) {
    case "sem_consentimento":
    case "desconectado":
    case "slot_adiado":
      return true;
    case "falha_envio":
      return (
        falhaPermiteRetry(falha.code) ||
        (typeof falha.code === "string" &&
          RECUSAS_ANTES_DO_PROVEDOR.has(falha.code))
      );
    default:
      return false;
  }
}
