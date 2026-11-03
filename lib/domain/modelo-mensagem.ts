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

// Marca provisoria do lugar onde {{nome}} saiu vazio. Caractere de uso
// privado: nao existe em texto digitado e nunca chega ao paciente (a limpeza
// abaixo tira todas).
const NOME_VAZIO = "";

function capitalizarInicio(linha: string): string {
  const inicio = linha.search(/\S/u);
  if (inicio < 0) {
    return linha;
  }
  return (
    linha.slice(0, inicio) +
    linha.charAt(inicio).toLocaleUpperCase("pt-BR") +
    linha.slice(inicio + 1)
  );
}

/**
 * Tira o vocativo que sobra quando o paciente nao tem nome cadastrado.
 *
 * Sem isto, "Olá, {{nome}}! Aqui é da..." saia "Olá, ! Aqui é da..." e o
 * toque de 3h comecava com ", sua consulta é hoje". Contato sem nome e comum
 * (quem chega pelo WhatsApp sem nome de perfil), entao a limpeza vive no
 * renderizador e vale para os textos padrao E para os editados pela clinica.
 * O texto em si continua sendo o que a clinica escreveu: so a pontuacao que
 * cercava o nome some.
 */
function limparVocativoSemNome(linha: string): string {
  if (!linha.includes(NOME_VAZIO)) {
    return linha;
  }
  let saida = linha;
  let tirouDoComeco = false;
  // "{{nome}}, sua consulta" vira "Sua consulta".
  saida = saida.replace(
    /^([ \t]*)[ \t]*[,;:!?.]?[ \t]*/u,
    (_todo, recuo: string) => {
      tirouDoComeco = true;
      return recuo;
    },
  );
  // "Olá, {{nome}}, tudo bem?" vira "Olá, tudo bem?".
  saida = saida.replace(/[ \t]*,[ \t]*[ \t]*,/gu, ",");
  // "Olá, {{nome}}!" vira "Olá!"; "Oi {{nome}}." vira "Oi.".
  saida = saida.replace(/[ \t]*,?[ \t]*[ \t]*([!?.;:])/gu, "$1");
  // "Oi {{nome}}, tudo bem?" vira "Oi, tudo bem?".
  saida = saida.replace(/[ \t]*[ \t]*,/gu, ",");
  // "Até logo, {{nome}}" vira "Até logo".
  saida = saida.replace(/[ \t]*,?[ \t]*[ \t]*$/u, "");
  // No meio da frase, sem pontuacao: some sem deixar espaco duplo.
  saida = saida.replace(/[ \t]+[ \t]+/gu, " ");
  saida = saida.replace(//gu, "");
  return tirouDoComeco ? capitalizarInicio(saida) : saida;
}

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
 *
 * {{nome}} vazio (ou so espaco) leva junto o vocativo que o cercava: "Olá,
 * {{nome}}!" vira "Olá!" e "{{nome}}, sua consulta" vira "Sua consulta".
 */
export function renderizarModelo(
  modelo: string,
  valores: Record<string, string | null | undefined>,
): string {
  const rendidas: string[] = [];

  for (const linha of modelo.split("\n")) {
    const tinhaMarcador = linha.includes("{{");
    const substituida = linha.replace(MARCADOR, (_todo, chave: string) => {
      const nomeDaChave = chave.trim();
      const valor = valores[nomeDaChave];
      if (nomeDaChave === "nome" && (valor == null || valor.trim() === "")) {
        return NOME_VAZIO;
      }
      return valor == null ? "" : valor;
    });
    const limpa = limparVocativoSemNome(
      substituida.replace(SOBRA_DE_CHAVE, ""),
    );
    if (tinhaMarcador && soEspacoOuPontuacao(limpa)) {
      continue;
    }
    rendidas.push(limpa.replace(/[ \t]+$/, ""));
  }

  return rendidas.join("\n");
}

// [AG7 preparo] início
// ---------------------------------------------------------------------------
// O {{preparo}} sem texto aprovado (AG7, revisao curta: CURTA-4)
// ---------------------------------------------------------------------------

/**
 * AG7 (D-74): o modelo do passo usa {{preparo}}? A mesma leitura do
 * renderizador: {{chave}} com a chave aparada.
 */
export function modeloPedePreparo(modelo: string | null): boolean {
  if (!modelo) {
    return false;
  }
  for (const achado of modelo.matchAll(MARCADOR)) {
    if ((achado[1] ?? "").trim() === "preparo") {
      return true;
    }
  }
  return false;
}

// O que so apresenta o preparo: a palavra dele (sem acento, minusculas).
const PALAVRA_DO_PREPARO =
  /\b(?:preparo|preparos|preparacao|orientacao|orientacoes|instrucao|instrucoes)\b/;
// Os parenteses, colchetes e aspas que ficam vazios quando o campo sai.
const PAR_VAZIO = /\(\s*\)|\[\s*\]|"\s*"|\u201c\s*\u201d/g;

function semAcentoEMinusculo(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * O pedaco (uma frase da linha do campo, ou a linha logo antes) so
 * apresenta o preparo? Vazio ou so pontuacao depois de o campo sair, ou a
 * palavra do preparo sem outro campo e sem pergunta ("Preparo:", "Siga o
 * preparo abaixo:", "Lembre do preparo ()."). "Confirma amanha as
 * {{hora}}?" e "Podemos confirmar o preparo?" nao.
 */
function soApresentaOPreparo(pedaco: string): boolean {
  const limpo = pedaco.replace(PAR_VAZIO, "");
  if (soEspacoOuPontuacao(limpo)) {
    return true;
  }
  if (limpo.includes("{{") || /\?\s*$/.test(limpo)) {
    return false;
  }
  return PALAVRA_DO_PREPARO.test(semAcentoEMinusculo(limpo));
}

/**
 * A linha logo antes da linha do campo que saiu, quando ela termina em dois
 * pontos e so o apresentava: com a palavra do preparo ("Siga o preparo
 * abaixo:") ou curta, sem outro campo ("Siga:", "Antes de vir:").
 */
function linhaQueApresentaOPreparo(linha: string): boolean {
  const aparada = linha.trim();
  if (!aparada.endsWith(":") || aparada.includes("{{")) {
    return false;
  }
  return (
    soApresentaOPreparo(aparada) ||
    aparada.split(/\s+/u).filter((palavra) => /\p{L}/u.test(palavra)).length <=
      3
  );
}

/**
 * AG7, revisao curta (CURTA-4): o modelo do passo para o toque SEM texto de
 * preparo em vigor, e para a previa e o teste do editor (que nunca levam
 * texto clinico). O campo {{preparo}} sai, e com ele so o que apenas o
 * apresentava:
 *  - na linha do campo, a frase que fica vazia ou que so fala do preparo
 *    ("Preparo: {{preparo}}", "Siga o preparo abaixo: {{preparo}}"). As
 *    outras frases da linha ficam: "Confirma amanha as {{hora}}?
 *    {{preparo}}" vira "Confirma amanha as {{hora}}?";
 *  - a linha antes da linha do campo que saiu inteira (passando por cima da
 *    linha em branco), quando ela termina em dois pontos e so apresentava o
 *    preparo ("Siga o preparo abaixo:", "Siga:"). "Seguem os dados da sua
 *    consulta:" fica.
 * O resto fica como a clinica escreveu. Pode nao sobrar nada: a regua nao
 * manda o toque vazio (o motivo fica gravado), e o editor avisa.
 */
export function modeloSemOPreparo(modelo: string): string {
  const linhas = modelo.split("\n");
  const saida: (string | null)[] = linhas.map((linha) => {
    if (!modeloPedePreparo(linha)) {
      return linha;
    }
    const semOCampo = linha.replace(MARCADOR, (todo, chave: string) =>
      chave.trim() === "preparo" ? "" : todo,
    );
    const ficam = semOCampo
      .split(/(?<=[.!?:])[ \t]+/u)
      .filter((pedaco) => !soApresentaOPreparo(pedaco));
    return ficam.length === 0 ? null : ficam.join(" ");
  });
  linhas.forEach((linha, i) => {
    if (saida[i] !== null || !modeloPedePreparo(linha)) {
      return;
    }
    for (let j = i - 1; j >= 0; j -= 1) {
      const anterior = saida[j];
      if (anterior === null || anterior === undefined) {
        return;
      }
      if (anterior.trim() === "") {
        continue;
      }
      if (linhaQueApresentaOPreparo(anterior)) {
        saida[j] = null;
        continue;
      }
      return;
    }
  });
  return saida.filter((linha): linha is string => linha !== null).join("\n");
}
// [AG7 preparo] fim
