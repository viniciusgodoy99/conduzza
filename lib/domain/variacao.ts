// Variacao de uma metrica contra uma base (periodo anterior, mesmo dia da
// semana passada, 30 dias atras). Modulo PURO de proposito: o cartao de
// metrica e Server Component, as abas de Resultados sao client, e as duas
// pontas precisam da mesma regra (funcao de modulo "use client" nao pode ser
// chamada em render de servidor, achado de 18/09/2026).
//
// Regras de honestidade que moram aqui, e nao em cada tela:
// - base zero (ou negativa) nao vira "+infinito por cento": e "sem base de
//   comparacao", sem seta;
// - o arredondamento vem ANTES de decidir o sentido: 0,04% e "0,0%", estavel,
//   neutro. Nunca "+0,0%" verde;
// - a cor diz o que e bom para a clinica (polaridade), nao a direcao: falta
//   e custo por lead sobem para PIOR;
// - sinal "+" e "-" ASCII (o "-" do Intl ja e ASCII; o travessao e proibido).

export type Polaridade = "maior-melhor" | "menor-melhor";

export type FormatoDaVariacao = "percentual" | "absoluto";

export type EntradaDaVariacao = {
  atual: number;
  anterior: number;
  /** O que "subir" significa para a clinica. Padrao "maior-melhor". */
  polaridade?: Polaridade;
  /**
   * Fim da frase falada, sem o "vs.": "período anterior", "mesmo dia da
   * semana passada", "30 dias atrás".
   */
  comparadoCom: string;
  /** "percentual" (padrao, 1 casa: "+12,4%") ou "absoluto" ("+34"). */
  formato?: FormatoDaVariacao;
};

export type SentidoDaVariacao = "subiu" | "caiu" | "estavel";

export type VariacaoDescrita =
  | {
      semBase: false;
      sentido: SentidoDaVariacao;
      /** Texto visivel: "+12,4%", "-6,1%", "0,0%", "+34", "0". */
      visivel: string;
      /** Frase para leitor de tela: "subiu 12,4% vs. período anterior". */
      falado: string;
      /** true = bom para a clinica, false = ruim, null = estavel. */
      boa: boolean | null;
    }
  | {
      semBase: true;
      /** "sem base de comparação (vs. período anterior)", visivel e falado. */
      texto: string;
    };

/**
 * Variacao percentual crua (sem arredondar). null quando a base e zero ou
 * negativa: "de 0 para 4" nao e "+infinito por cento".
 */
export function variacaoPercentual(
  atual: number,
  anterior: number,
): number | null {
  if (anterior <= 0) {
    return null;
  }
  return ((atual - anterior) / anterior) * 100;
}

// Meio para longe do zero, simetrico: -12,45 vira -12,5 como 12,45 vira 12,5
// (Math.round sozinho arredonda -12,45 para -12,4). O toPrecision tira o
// ruido binario (12,45 * 10 = 124,49999999999999) antes de arredondar.
function arredondarUmaCasa(valor: number): number {
  const dezenas = Number((Math.abs(valor) * 10).toPrecision(12));
  const arredondado = Math.round(dezenas) / 10;
  return valor < 0 ? -arredondado : arredondado;
}

function numeroPtBr(valor: number, formato: FormatoDaVariacao): string {
  return valor.toLocaleString(
    "pt-BR",
    formato === "percentual"
      ? { minimumFractionDigits: 1, maximumFractionDigits: 1 }
      : { maximumFractionDigits: 1 },
  );
}

export function descreverVariacao(
  entrada: EntradaDaVariacao,
): VariacaoDescrita {
  const {
    atual,
    anterior,
    polaridade = "maior-melhor",
    comparadoCom,
    formato = "percentual",
  } = entrada;

  if (!Number.isFinite(atual) || !Number.isFinite(anterior) || anterior <= 0) {
    return {
      semBase: true,
      texto: `sem base de comparação (vs. ${comparadoCom})`,
    };
  }

  const bruta =
    formato === "percentual"
      ? ((atual - anterior) / anterior) * 100
      : atual - anterior;
  const arredondada = arredondarUmaCasa(bruta);
  const sufixo = formato === "percentual" ? "%" : "";
  const modulo = `${numeroPtBr(Math.abs(arredondada), formato)}${sufixo}`;

  if (arredondada === 0) {
    return {
      semBase: false,
      sentido: "estavel",
      visivel: modulo,
      falado: `estável vs. ${comparadoCom}`,
      boa: null,
    };
  }

  const subiu = arredondada > 0;
  return {
    semBase: false,
    sentido: subiu ? "subiu" : "caiu",
    visivel: `${subiu ? "+" : "-"}${modulo}`,
    falado: `${subiu ? "subiu" : "caiu"} ${modulo} vs. ${comparadoCom}`,
    boa: subiu === (polaridade === "maior-melhor"),
  };
}
