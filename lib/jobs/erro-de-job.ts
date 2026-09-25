/**
 * Excecao de job com um codigo de diagnostico SEGURO (`slug: codigo_do_banco`),
 * escrito por quem lanca e nunca montado com dado de paciente (regra 3.1).
 * executarJobComPosse grava so esse codigo em job_queue.last_error e no log
 * 'job_falhou'; qualquer outra excecao continua virando 'excecao_no_worker',
 * para texto livre nunca sair do processo.
 */
export class ErroComCodigoDeJob extends Error {
  constructor(readonly codigo: string) {
    super(codigo);
    this.name = "ErroComCodigoDeJob";
  }
}

/**
 * Codigo do erro do PostgREST para a mensagem, sem nada alem dele. Codigo
 * vazio e o que o postgrest-js devolve quando nem houve resposta (rede caiu,
 * fetch abortado): fica separado do "desconhecido" (resposta sem codigo).
 */
export function codigoDoErro(erro: { code?: string | null }): string {
  if (erro.code === "") {
    return "sem_resposta";
  }
  return erro.code ?? "desconhecido";
}
