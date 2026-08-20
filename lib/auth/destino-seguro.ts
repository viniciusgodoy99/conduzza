// Validacao do parametro `next` dos links de e-mail (confirmacao, convite,
// recuperacao de senha).
//
// DEFEITO REAL corrigido em 20/08/2026, reproduzido contra o servidor: a rota
// concatenava `next` direto na origem, entao next=@dominio.com produzia
// "http://origem@dominio.com/", que o navegador entende como o HOST
// dominio.com (a origem vira apenas userinfo). A vitima clicava no link
// legitimo de recuperacao, o token era consumido, e ela caia no site do
// atacante ja autenticada. Vetor classico de phishing.

export const DESTINO_PADRAO = "/inicio";

export function destinoSeguro(
  next: string | null | undefined,
  origin: string,
): string {
  if (!next) {
    return DESTINO_PADRAO;
  }
  // Barra dupla e contrabarra sao as formas de escapar da origem antes mesmo
  // de o parser de URL entrar em acao.
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return DESTINO_PADRAO;
  }
  try {
    const alvo = new URL(next, origin);
    if (alvo.origin !== new URL(origin).origin) {
      return DESTINO_PADRAO;
    }
    return `${alvo.pathname}${alvo.search}`;
  } catch {
    return DESTINO_PADRAO;
  }
}
