/**
 * Pausa de `ms` milissegundos.
 *
 * Modulo proprio de proposito: quem espera dentro de uma requisicao (a rota
 * do webhook, na nova tentativa da saudacao para paciente novo) importa
 * daqui, e o teste troca esta funcao por uma que nao espera (vi.mock), sem
 * relogio falso e sem teste lento.
 */
export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
