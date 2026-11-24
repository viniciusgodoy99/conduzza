// Passo a passo da aba "Anuncios e rastreio" de Configuracoes (decisao do
// dono de 17/11/2026: um lugar so para o que substitui o Tintim, com o que
// ja esta pronto e o que falta). As abas "Anuncios da Meta", "Anuncios do
// Google" e "Origem dos leads" viraram os passos desta aba.

export const CHAVES_DOS_PASSOS = [
  "conta",
  "token",
  // Conversoes por etapa (pedido do dono em 24/11/2026): o evento de cada
  // etapa saiu da aba Jornada e veio para ca, antes do envio que o usa.
  "conversoes",
  "envio",
  "investimento",
  "site",
  "origens",
] as const;

export type ChaveDoPasso = (typeof CHAVES_DOS_PASSOS)[number];

export type SituacaoDoPasso = "pronto" | "falta" | "desligado" | "indisponivel";

export type PassoDoRastreio = {
  chave: ChaveDoPasso;
  numero: number;
  titulo: string;
  /** Para que serve, numa frase. */
  paraQueServe: string;
  situacao: SituacaoDoPasso;
  /** Rotulo do chip quando o do mapa nao serve ("Ligado", "4 origens"). */
  rotulo: string | null;
  /** O que falta, em poucas palavras; nulo sem nada a dizer. */
  detalhe: string | null;
};

export type EstadoDoRastreio = {
  /** nulo: a leitura da conta da Meta falhou */
  meta: {
    temPixel: boolean;
    /** Conta do WhatsApp Business: sem ela a conversao do anuncio que abre o WhatsApp e descartada. */
    temWaba: boolean;
    temToken: boolean;
    /** Como os dados saem ja foi escolhido (sem isso o envio nao liga). */
    temModo: boolean;
    envioLigado: boolean;
    temContaDeAnuncios: boolean;
    temTokenDeLeitura: boolean;
    /** A leitura do investimento gravou um problema (token vencido, conta sem acesso). */
    leituraComProblema: boolean;
  } | null;
  /** nulo: a leitura do rastreio do site falhou */
  site: { ligado: boolean } | null;
  /** quantas origens cadastradas; nulo: a leitura falhou */
  origens: number | null;
  /** quantas etapas mandam conversao (evento escolhido e ativa); nulo: a leitura da jornada falhou */
  conversoes: number | null;
};

const TEXTOS: Record<ChaveDoPasso, { titulo: string; paraQueServe: string }> = {
  conta: {
    titulo: "Conta da Meta",
    paraQueServe:
      "Diz ao sistema qual é o Pixel, a conta de anúncios e a conta do WhatsApp da clínica na Meta.",
  },
  token: {
    titulo: "Token das conversões",
    paraQueServe:
      "É a chave que a Meta pede para aceitar as conversões que a clínica devolve.",
  },
  conversoes: {
    titulo: "Conversões por etapa",
    paraQueServe:
      "Escolhe o que a Meta recebe quando um contato chega em cada etapa, como Agendamento (Schedule) ou Compra (Purchase).",
  },
  envio: {
    titulo: "Envio das conversões",
    paraQueServe:
      "Liga a devolução das conversões, para a Meta saber qual anúncio trouxe quem agendou e compareceu.",
  },
  investimento: {
    titulo: "Investimento nos anúncios",
    paraQueServe:
      "Lê quanto foi gasto em cada campanha, para o custo por lead e o retorno em Resultados.",
  },
  site: {
    titulo: "Rastreio do site",
    paraQueServe:
      "Uma linha no site da clínica que marca de qual anúncio veio quem clicou no botão do WhatsApp.",
  },
  origens: {
    titulo: "Links e origens",
    paraQueServe:
      "Links rastreados e QR Code para a bio do Instagram, o perfil no Google, panfletos e parceiros.",
  },
};

type Situacao = Pick<PassoDoRastreio, "situacao" | "rotulo" | "detalhe">;

const PRONTO: Situacao = { situacao: "pronto", rotulo: null, detalhe: null };
const INDISPONIVEL: Situacao = {
  situacao: "indisponivel",
  rotulo: null,
  detalhe: "Recarregue a página.",
};

function falta(detalhe: string): Situacao {
  return { situacao: "falta", rotulo: null, detalhe };
}

function situacaoDoPasso(chave: ChaveDoPasso, estado: EstadoDoRastreio): Situacao {
  const { meta, site, origens, conversoes } = estado;
  switch (chave) {
    // "Pronto" so quando o passo funciona de verdade (revisao de 17/11/2026):
    // a tela verde com conversao descartada e pior que um "falta".
    case "conta":
      if (!meta) return INDISPONIVEL;
      if (!meta.temPixel) return falta("Falta o Pixel.");
      return meta.temWaba
        ? PRONTO
        : falta("Falta a conta do WhatsApp Business.");
    case "token":
      if (!meta) return INDISPONIVEL;
      return meta.temToken ? PRONTO : falta("Falta colar o token.");
    case "conversoes":
      if (conversoes === null) return INDISPONIVEL;
      return conversoes > 0
        ? {
            situacao: "pronto",
            rotulo: conversoes === 1 ? "1 etapa" : `${conversoes} etapas`,
            detalhe: null,
          }
        : falta("Nenhuma etapa manda conversão.");
    case "envio":
      if (!meta) return INDISPONIVEL;
      if (meta.envioLigado) {
        // Ligado sem etapa nenhuma nao manda nada: nunca "pronto" (24/11/2026).
        return conversoes === 0
          ? falta("Está ligado, mas nenhuma etapa manda conversão (passo 3).")
          : { situacao: "pronto", rotulo: "Ligado", detalhe: null };
      }
      return {
        situacao: "desligado",
        rotulo: null,
        detalhe: !(meta.temPixel && meta.temToken)
          ? "Precisa do Pixel e do token."
          : !meta.temModo
            ? "Falta escolher como enviar os dados."
            : conversoes === 0
              ? "Antes, escolha as etapas no passo 3."
              : "Pronto para ligar.",
      };
    case "investimento":
      if (!meta) return INDISPONIVEL;
      if (!meta.temTokenDeLeitura) return falta("Falta o token de leitura.");
      if (!meta.temContaDeAnuncios) {
        return falta("Falta a conta de anúncios, no passo 1.");
      }
      return meta.leituraComProblema
        ? falta("A leitura está com problema.")
        : PRONTO;
    case "site":
      if (!site) return INDISPONIVEL;
      return site.ligado
        ? { situacao: "pronto", rotulo: "Ligado", detalhe: null }
        : { situacao: "desligado", rotulo: null, detalhe: null };
    case "origens":
      if (origens === null) return INDISPONIVEL;
      return origens > 0
        ? {
            situacao: "pronto",
            rotulo: origens === 1 ? "1 origem" : `${origens} origens`,
            detalhe: null,
          }
        : falta("Nenhuma origem cadastrada.");
  }
}

export function passosDoRastreio(estado: EstadoDoRastreio): PassoDoRastreio[] {
  return CHAVES_DOS_PASSOS.map((chave, indice) => ({
    chave,
    numero: indice + 1,
    ...TEXTOS[chave],
    ...situacaoDoPasso(chave, estado),
  }));
}

/** "3 de 7 prontos": conta o que esta pronto ou ligado. */
export function prontosDoRastreio(passos: PassoDoRastreio[]): number {
  return passos.filter((passo) => passo.situacao === "pronto").length;
}

export function ehChaveDoPasso(valor: string | null | undefined): valor is ChaveDoPasso {
  return CHAVES_DOS_PASSOS.some((chave) => chave === valor);
}

/** As abas antigas, que viraram passos: os links guardados continuam valendo. */
const PASSOS_DA_ABA_ANTIGA: Record<string, readonly ChaveDoPasso[]> = {
  meta: ["conta", "token", "conversoes", "envio", "investimento"],
  google: ["site"],
  origem: ["origens"],
  // A aba "Conversoes" antiga foi absorvida pela Jornada em 09/09/2026; em
  // 24/11/2026 a conversao veio para este passo.
  conversoes: ["conversoes"],
};

export function ehAbaAntigaDoRastreio(aba: string | null | undefined): boolean {
  return (
    typeof aba === "string" &&
    Object.prototype.hasOwnProperty.call(PASSOS_DA_ABA_ANTIGA, aba)
  );
}

/**
 * Quais passos nascem abertos: o que o endereco pede (?passo=), os da aba
 * antiga (?aba=meta), ou o primeiro que falta fazer. Com tudo pronto, nenhum.
 */
export function passosAbertosDeInicio(
  passos: PassoDoRastreio[],
  passoDoEndereco: string | null | undefined,
  abaDoEndereco: string | null | undefined,
): ChaveDoPasso[] {
  if (ehChaveDoPasso(passoDoEndereco)) {
    return [passoDoEndereco];
  }
  if (typeof abaDoEndereco === "string" && ehAbaAntigaDoRastreio(abaDoEndereco)) {
    return [...PASSOS_DA_ABA_ANTIGA[abaDoEndereco]!];
  }
  const primeiro = passos.find((passo) => passo.situacao === "falta");
  return primeiro ? [primeiro.chave] : [];
}
