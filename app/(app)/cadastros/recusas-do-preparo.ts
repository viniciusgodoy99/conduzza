import { frasesDasRecusas } from "@/components/cadastros/preparo-na-tela";
import { problemasDoTextoDoPreparo } from "@/lib/domain/conformidade/preparo-aprovado";

// As regras de hoje sobre o texto do preparo, ditas em frase de recepcao (AG7;
// revisao curta, CURTA-5). SERVIDOR: problemasDoTextoDoPreparo importa o
// filtro de conformidade (node:crypto), que o navegador nunca carrega; como
// preparo-aprovado.ts, so o servidor importa daqui. As Server Actions
// do preparo (preparo-actions.ts) recusam com estas frases antes da RPC, e a
// pagina e a action das recusas marcam o texto ja aprovado que as regras de
// hoje nao deixam sair (a secao mostra "Aprovada, sem envio").

/**
 * As recusas de hoje no texto (problemasDoTextoDoPreparo: promessa, oferta
 * casada, antes e depois, preco e link) em frase que diz o que tirar e ONDE
 * (TELA-8): cada categoria recusada aponta a primeira frase do texto que a
 * dispara sozinha (trechosDasRecusas, calculado no servidor). A categoria
 * que so o texto inteiro acusa fica com a frase sem trecho. Null: o texto
 * passa (remedio, dose e jejum so avisam, D-80).
 */
export function recusaDoTextoDoPreparo(texto: string): string | null {
  const { recusas, trechosDasRecusas } = problemasDoTextoDoPreparo(texto);
  if (recusas.length === 0) {
    return null;
  }
  const trechos: Record<string, string> = {};
  for (const { categoria, trecho } of trechosDasRecusas) {
    if (trecho !== null && !Object.hasOwn(trechos, categoria)) {
      trechos[categoria] = trecho;
    }
  }
  return frasesDasRecusas(recusas, trechos);
}

// As recusas ja conferidas, pelo texto (a versao e imutavel, e as regras so
// mudam com o deploy): a pagina e a action conferem os mesmos textos a cada
// carga. Com teto, para nao crescer sem fim no servidor.
const RECUSAS_CONFERIDAS = new Map<string, string | null>();
const TETO_DAS_RECUSAS_CONFERIDAS = 2_000;

function recusaConferida(texto: string): string | null {
  const pronta = RECUSAS_CONFERIDAS.get(texto);
  if (pronta !== undefined) {
    return pronta;
  }
  const frase = recusaDoTextoDoPreparo(texto);
  if (RECUSAS_CONFERIDAS.size >= TETO_DAS_RECUSAS_CONFERIDAS) {
    RECUSAS_CONFERIDAS.clear();
  }
  RECUSAS_CONFERIDAS.set(texto, frase);
  return frase;
}

/** As situacoes de quem ja foi aprovado e pode voltar a sair. */
const SITUACOES_APROVADAS: ReadonlySet<string> = new Set([
  "aprovado",
  "suspenso",
]);

/**
 * Revisao curta da AG7 (CURTA-5): das versoes aprovadas e suspensas com o
 * texto lido, as que as regras de hoje recusam, com a frase da recusa (o id
 * da versao para a frase). O envio confere as mesmas regras e nao as deixa
 * sair (conferirParaEnvio e a regua); a tela diz isso, em vez de
 * "Aprovada". A versao sem o texto lido fica de fora (a tela ja mostra o
 * erro do texto).
 */
export function recusasDasVersoesAprovadas(
  versoes: readonly { id: string; situacao: string; texto: string | null }[],
): Record<string, string> {
  const recusas: Record<string, string> = {};
  for (const versao of versoes) {
    if (!SITUACOES_APROVADAS.has(versao.situacao) || versao.texto === null) {
      continue;
    }
    const frase = recusaConferida(versao.texto);
    if (frase !== null) {
      recusas[versao.id] = frase;
    }
  }
  return recusas;
}
