// Renderizador PURO dos modelos de mensagem da regua (cadence_step.fixed_body
// e message_template.body). Sem I/O e sem LLM: o texto e fixo e a clinica ve
// exatamente o que o paciente vai receber.

/** As chaves que a regua sabe preencher. A UI mostra esta lista ao editar. */
export const PLACEHOLDERS = [
  "nome",
  "clinica",
  "data",
  "hora",
  "profissional",
  "procedimento",
  "preparo",
] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];

// Qualquer {{chave}}, inclusive com espaco em volta e com chave desconhecida.
const MARCADOR = /\{\{([^{}]*)\}\}/g;

// Sobra de chave: garante que nenhum "{{" chega ao paciente, mesmo quando o
// modelo tem marcador malformado (aberto e nao fechado).
const SOBRA_DE_CHAVE = /\{\{|\}\}/g;

// Pontuacao que, sozinha numa linha, nao carrega informacao nenhuma. Os
// tracos vao como escape para nao acender o teste de travessao da interface.
const PONTUACAO = new Set([
  ...".,;:!?()[]{}\"'`*_/\\|+=<>@#$%&~^-",
  "\u2010",
  "\u2011",
  "\u2012",
  "\u2013",
  "\u2014",
  "\u2015",
]);

function soEspacoOuPontuacao(linha: string): boolean {
  for (const caractere of linha) {
    if (caractere.trim() === "") {
      continue;
    }
    if (!PONTUACAO.has(caractere)) {
      return false;
    }
  }
  return true;
}

/**
 * Substitui {{chave}} pelo valor correspondente.
 *
 * Placeholder sem valor vira vazio, e a LINHA que sobrar so com espaco ou
 * pontuacao desaparece. E assim que a orientacao de preparo aparece somente
 * quando o procedimento tem preparo cadastrado: a linha "{{preparo}}" do
 * modelo de 24h some inteira, em vez de virar uma linha em branco no meio da
 * mensagem.
 *
 * Linha em branco que ja estava no modelo e mantida: e paragrafo escolhido
 * pela clinica, nao sobra de substituicao. So sai a linha que TINHA marcador.
 */
export function renderizarModelo(
  modelo: string,
  valores: Record<string, string | null | undefined>,
): string {
  const rendidas: string[] = [];

  for (const linha of modelo.split("\n")) {
    const tinhaMarcador = linha.includes("{{");
    const substituida = linha.replace(MARCADOR, (_todo, chave: string) => {
      const valor = valores[chave.trim()];
      return valor == null ? "" : valor;
    });
    const limpa = substituida.replace(SOBRA_DE_CHAVE, "");
    if (tinhaMarcador && soEspacoOuPontuacao(limpa)) {
      continue;
    }
    rendidas.push(limpa.replace(/[ \t]+$/, ""));
  }

  return rendidas.join("\n");
}
