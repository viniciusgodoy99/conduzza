// Nomenclatura parametrizavel do white-label (docs/03 secao 8): os 4 termos
// centrais vem de clinic_branding.labels (jsonb) e toda string de interface
// que os use passa por t(). Trocar de nicho e configuracao, nunca reescrita.
// Modulo puro, sem I/O.

export type LabelKey =
  "profissional" | "procedimento" | "paciente" | "consulta";

export type Labels = Record<LabelKey, string>;

// Identico ao default do jsonb em docs/04.
export const DEFAULT_LABELS: Labels = {
  profissional: "profissional",
  procedimento: "procedimento",
  paciente: "paciente",
  consulta: "consulta",
};

// Plural pt-BR simplificado: cobre os padroes dos termos deste dominio.
// Excecoes explicitas tem precedencia; o resto segue as regras gerais.
const PLURAL_EXCEPTIONS: Record<string, string> = {
  // exemplos de nichos ja previstos
  cidadão: "cidadãos",
};

export function pluralize(word: string): string {
  const exception = PLURAL_EXCEPTIONS[word.toLowerCase()];
  if (exception) {
    return matchCase(word, exception);
  }
  const lower = word.toLowerCase();
  if (lower.endsWith("ão")) {
    return matchCase(word, `${lower.slice(0, -2)}ões`);
  }
  if (lower.endsWith("m")) {
    return matchCase(word, `${lower.slice(0, -1)}ns`);
  }
  if (lower.endsWith("al") || lower.endsWith("el") || lower.endsWith("ol")) {
    return matchCase(word, `${lower.slice(0, -1)}is`);
  }
  if (lower.endsWith("il")) {
    return matchCase(word, `${lower.slice(0, -2)}is`);
  }
  if (lower.endsWith("r") || lower.endsWith("s") || lower.endsWith("z")) {
    return matchCase(word, `${lower}es`);
  }
  return matchCase(word, `${lower}s`);
}

function matchCase(original: string, plural: string): string {
  if (original[0] && original[0] === original[0].toUpperCase()) {
    return capitalize(plural);
  }
  return plural;
}

function capitalize(word: string): string {
  return (word[0]?.toUpperCase() ?? "") + word.slice(1);
}

export type TranslateOptions = {
  plural?: boolean;
  capitalize?: boolean;
};

export type Translate = (key: LabelKey, options?: TranslateOptions) => string;

// Cria o t() a partir dos labels da clinica, com fallback aos padroes quando
// a chave faltar no jsonb.
export function createT(labels: Partial<Labels> | null | undefined): Translate {
  return (key, options = {}) => {
    let word = labels?.[key]?.trim() || DEFAULT_LABELS[key];
    if (options.plural) {
      word = pluralize(word);
    }
    if (options.capitalize) {
      word = capitalize(word);
    }
    return word;
  };
}
