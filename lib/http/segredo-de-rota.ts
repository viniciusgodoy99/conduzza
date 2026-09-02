import { timingSafeEqual } from "node:crypto";

// Comparacao de segredo em tempo constante, para as rotas que o mundo externo
// alcanca (webhook do WhatsApp e o tick do motor).
//
// A checagem de tamanho ANTES nao e otimizacao: timingSafeEqual LANCA quando
// os buffers tem tamanhos diferentes, e uma excecao nao tratada numa rota de
// webhook vira 500, que o provedor interpreta como "tente de novo" e reenvia
// em laco.
//
// Vale a pena existir como funcao de oito linhas em vez de copia em cada rota:
// duas copias divergentes de comparacao de segredo sao piores que uma so.
export function segredosConferem(esperado: string, recebido: string): boolean {
  if (esperado.length === 0 || recebido.length === 0) {
    return false;
  }
  const a = Buffer.from(esperado);
  const b = Buffer.from(recebido);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Le o segredo de `Authorization: Bearer <segredo>`, ou string vazia. */
export function bearerDoCabecalho(cabecalho: string | null): string {
  if (!cabecalho) {
    return "";
  }
  const prefixo = "Bearer ";
  return cabecalho.startsWith(prefixo) ? cabecalho.slice(prefixo.length) : "";
}
