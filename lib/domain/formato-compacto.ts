import { formatarCentavos } from "@/lib/utils/moeda";

// Numeros de cartao de metrica em pt-BR (brief secao 3.7). Modulo PURO: serve
// ao Server Component do cartao, as abas client e ao CSV.
//
// Reais compactos: com 5 cartoes a 1366px, "R$ 284.000,00" em mono de 34px
// estoura o cartao (cerca de 195px uteis; o cartao ainda desce para 28px
// acima de 9 caracteres, porque 11 caracteres a 34px tambem nao cabem).
// Abaixo de 10 mil o valor vai
// cheio ("R$ 9.850,00"); de 10 mil para cima vai em "mil", "mi" e "bi", com
// no maximo 1 casa ("R$ 12,5 mil", "R$ 284 mil", "R$ 1,2 mi"). Nunca "k".
// O valor cheio continua existindo para o rotulo acessivel e para o CSV
// (formatarReaisCompleto). Sem travessao em lugar nenhum.
//
// O espaco depois de "R$" e o NBSP (U+00A0) do Intl, igual ao
// formatarCentavos: o "R$" nunca fica sozinho no fim da linha.

const NBSP = "\u00a0";

const ESCALAS = [
  { divisor: 1_000_000_000, sufixo: "bi" },
  { divisor: 1_000_000, sufixo: "mi" },
  { divisor: 1_000, sufixo: "mil" },
] as const;

/** Valor cheio em reais, para o rotulo acessivel e o CSV: "R$ 284.000,00". */
export function formatarReaisCompleto(centavos: number): string {
  return formatarCentavos(centavos);
}

/**
 * Reais compactos: "R$ 9.850,00" (abaixo de 10 mil, cheio), "R$ 12,5 mil",
 * "R$ 284 mil", "R$ 1,2 mi", "R$ 3 bi". Uma casa so abaixo de 100 da escala
 * ("R$ 12,5 mil", mas "R$ 284 mil"); casa zero nao aparece ("R$ 12 mil").
 * Negativo leva "-" ASCII na frente ("-R$ 12 mil").
 */
export function formatarReaisCompacto(centavos: number): string {
  const reais = Math.abs(centavos) / 100;
  const sinal = centavos < 0 ? "-" : "";
  if (reais < 10_000) {
    return formatarCentavos(centavos);
  }
  for (let indice = 0; indice < ESCALAS.length; indice += 1) {
    const escala = ESCALAS[indice];
    if (!escala || reais < escala.divisor) {
      continue;
    }
    const naEscala = reais / escala.divisor;
    const casas = naEscala < 100 ? 1 : 0;
    const fator = 10 ** casas;
    const arredondado =
      Math.round(Number((naEscala * fator).toPrecision(12))) / fator;
    // 999.960 reais arredondam para "1.000 mil": sobe para "1 mi".
    const acima = ESCALAS[indice - 1];
    if (arredondado >= 1000 && acima) {
      return `${sinal}R$${NBSP}${(arredondado / 1000).toLocaleString("pt-BR", {
        maximumFractionDigits: 1,
      })}${NBSP}${acima.sufixo}`;
    }
    return `${sinal}R$${NBSP}${arredondado.toLocaleString("pt-BR", {
      maximumFractionDigits: casas,
    })}${NBSP}${escala.sufixo}`;
  }
  return formatarCentavos(centavos);
}

/**
 * Percentual com 1 casa, sem o simbolo (o cartao mostra "%" como unidade):
 * 64.24 -> "64,2"; 64 -> "64,0". Para a razao de duas contagens use
 * percentualDe, que devolve null sem denominador (taxa sem base nao e 0%).
 */
export function formatarPercentual(percentual: number): string {
  return percentual.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** parte / total * 100; null quando total e zero ou negativo. */
export function percentualDe(parte: number, total: number): number | null {
  if (!(total > 0)) {
    return null;
  }
  return (parte / total) * 100;
}
