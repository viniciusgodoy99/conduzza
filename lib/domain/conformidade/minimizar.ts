// Minimizacao do texto antes de ir a um modelo de linguagem (LGPD, plano de
// seguranca secao 4). PURO, zero I/O.
//
// Troca por marcador o que identifica a pessoa e nao ajuda a responder:
// e-mail, CPF, CNPJ, CEP, telefone e qualquer sequencia longa de digitos
// (carteirinha do convenio, RG, cartao). Data e hora ficam: "dia 14/10 as
// 10h30" e justamente o que a recepcao precisa entender.
//
// O filtro de saida usa a MESMA funcao para achar dado pessoal no rascunho:
// se minimizar muda o texto, o rascunho tem dado que nao pode sair.

const MARCADORES = {
  email: "[email]",
  cpf: "[cpf]",
  cnpj: "[cnpj]",
  cep: "[cep]",
  telefone: "[telefone]",
  numero: "[numero]",
} as const;

// Uma regex so, com as alternativas em ORDEM de prioridade: em cada posicao
// a primeira que casa vence. Data e hora vem antes do telefone e da sequencia
// longa, para "05/10/2026" e "10:30" nunca virarem numero.
const PADRAO = new RegExp(
  [
    // e-mail
    "(?<email>[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)+)",
    // data (dd/mm, dd/mm/aa, dd/mm/aaaa, com barra, ponto ou hifen)
    "(?<data>(?<![\\p{N}])\\d{1,2}[/.-]\\d{1,2}(?:[/.-](?:\\d{4}|\\d{2}))?(?![\\p{N}]))",
    // hora (10:30, 10h, 10h30)
    "(?<hora>(?<![\\p{N}])\\d{1,2}(?::\\d{2}|h\\d{0,2})(?![\\p{N}]))",
    // CNPJ formatado
    "(?<cnpj>(?<![\\p{N}])\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}(?![\\p{N}]))",
    // CPF formatado ou corrido
    "(?<cpf>(?<![\\p{N}])\\d{3}\\.\\d{3}\\.\\d{3}-?\\d{2}(?![\\p{N}]))",
    // CEP formatado (60000-000 ou 60.000-000)
    "(?<cep>(?<![\\p{N}])\\d{2}\\.?\\d{3}-\\d{3}(?![\\p{N}]))",
    // telefone brasileiro: +55, DDD entre parenteses, 8 ou 9 digitos
    "(?<telefone>(?:\\+?\\s?55[\\s.-]?)?(?:\\(\\s?\\d{2}\\s?\\)|(?<![\\p{N}])\\d{2})?[\\s.-]?(?<![\\p{N}])9?\\s?\\d{4}[\\s.-]?\\d{4}(?![\\p{N}]))",
    // qualquer sequencia de 8 ou mais digitos, com separador simples
    "(?<numero>(?<![\\p{N}])\\+?\\d(?:[\\s./-]?\\d){7,}(?![\\p{N}]))",
  ].join("|"),
  "giu",
);

type Grupos = Partial<
  Record<keyof typeof MARCADORES | "data" | "hora", string>
>;

/**
 * Texto com e-mail, CPF, CNPJ, CEP, telefone e sequencias longas de digitos
 * trocados por marcadores. Datas e horas preservadas.
 */
export function minimizarParaLlm(texto: string): string {
  return texto.replace(PADRAO, (trecho: string, ...args: unknown[]) => {
    const grupos = args[args.length - 1] as Grupos;
    if (grupos.data !== undefined || grupos.hora !== undefined) {
      return trecho;
    }
    for (const chave of Object.keys(MARCADORES) as Array<
      keyof typeof MARCADORES
    >) {
      if (grupos[chave] !== undefined) {
        // Preserva o espaco que o padrao do telefone pode ter engolido no
        // comeco, para a frase nao colar no marcador.
        const espaco = /^\s/.test(trecho) ? " " : "";
        return `${espaco}${MARCADORES[chave]}`;
      }
    }
    return trecho;
  });
}

/** Verdadeiro quando o texto tem algum dado que minimizarParaLlm trocaria. */
export function temDadoPessoal(texto: string): boolean {
  return minimizarParaLlm(texto) !== texto;
}
