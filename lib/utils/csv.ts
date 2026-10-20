// Geracao e download de CSV no padrao Excel pt-BR: separador ";" e BOM
// UTF-8 no inicio (sem o BOM o Excel abre acentos quebrados).

// Celula de texto que a planilha leria como formula (injecao de formula no
// CSV): comeca com =, +, -, @, tabulacao ou CR. Vale para TODA exportacao,
// porque o texto pode ser de terceiro: o titulo do anuncio vem da mensagem,
// o nome do paciente vem do WhatsApp.
const INICIO_DE_FORMULA = /^[=+\-@\t\r]/;
// Numero e percentual (com sinal, separadores e o "%") nao sao texto: nao
// viram formula e ficam como estao ("-5", "12,5%", o telefone "+5585...").
const NUMERO_OU_PERCENTUAL = /^[+-]?\d[\d.,]*%?$/;

/**
 * Celula de texto que comeca como formula ganha um apostrofo na frente (a
 * recomendacao da OWASP): a planilha mostra o texto, nunca o executa.
 */
export function neutralizarFormula(celula: string): string {
  return INICIO_DE_FORMULA.test(celula) && !NUMERO_OU_PERCENTUAL.test(celula)
    ? `'${celula}`
    : celula;
}

/** Escapa a celula quando contem ";", aspas ou quebra de linha. */
function escaparCelula(celula: string): string {
  if (/[";\n\r]/.test(celula)) {
    return `"${celula.replaceAll('"', '""')}"`;
  }
  return celula;
}

/**
 * O CSV das linhas: cada celula neutralizada (formula vira texto) e depois
 * escapada. Toda exportacao do sistema passa por aqui (Resultados, Agenda e
 * as linhas recusadas da importacao).
 */
export function gerarCsv(linhas: string[][]): string {
  const corpo = linhas
    .map((linha) =>
      linha
        .map((celula) => escaparCelula(neutralizarFormula(celula)))
        .join(";"),
    )
    .join("\r\n");
  return "\uFEFF" + corpo;
}

export type CsvLido = { delimitador: ";" | ","; linhas: string[][] };

/**
 * Le um CSV no dialeto Excel pt-BR (e no americano): remove BOM, detecta o
 * delimitador pela primeira linha (contagem fora de aspas), respeita aspas
 * duplas escapadas ("") e quebra de linha DENTRO de celula. Alvo: planilhas
 * de ate poucos milhares de linhas, tudo em memoria (importacao da Tela 4).
 */
export function parseCsv(texto: string): CsvLido {
  const semBom = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const delimitador = detectarDelimitador(semBom);

  const linhas: string[][] = [];
  let linha: string[] = [];
  let celula = "";
  let entreAspas = false;

  for (let i = 0; i < semBom.length; i += 1) {
    const ch = semBom[i];
    if (entreAspas) {
      if (ch === '"') {
        if (semBom[i + 1] === '"') {
          celula += '"';
          i += 1;
        } else {
          entreAspas = false;
        }
      } else {
        celula += ch;
      }
      continue;
    }
    if (ch === '"') {
      entreAspas = true;
    } else if (ch === delimitador) {
      linha.push(celula);
      celula = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && semBom[i + 1] === "\n") {
        i += 1;
      }
      linha.push(celula);
      celula = "";
      linhas.push(linha);
      linha = [];
    } else {
      celula += ch;
    }
  }
  if (celula !== "" || linha.length > 0) {
    linha.push(celula);
    linhas.push(linha);
  }

  // Linhas totalmente vazias (rodape de planilha) saem.
  return {
    delimitador,
    linhas: linhas.filter((l) => l.some((c) => c.trim() !== "")),
  };
}

function detectarDelimitador(texto: string): ";" | "," {
  let pontoEVirgula = 0;
  let virgula = 0;
  let entreAspas = false;
  for (const ch of texto) {
    if (ch === '"') {
      entreAspas = !entreAspas;
    } else if (!entreAspas) {
      if (ch === ";") pontoEVirgula += 1;
      else if (ch === ",") virgula += 1;
      else if (ch === "\n") break;
    }
  }
  return virgula > pontoEVirgula ? "," : ";";
}

/** Baixa o conteudo como arquivo. So roda no browser; fora dele, nao faz nada. */
export function baixarCsv(nomeDoArquivo: string, conteudo: string): void {
  if (typeof document === "undefined") {
    return;
  }
  baixarArquivo(
    nomeDoArquivo,
    new Blob([conteudo], { type: "text/csv;charset=utf-8" }),
  );
}

/**
 * Baixa um arquivo que ja chegou pronto (o CSV dos leads, gerado no
 * servidor). Pelo Blob da resposta, e nao pelo texto: o text() da resposta
 * tira o BOM, e sem ele o Excel abre os acentos quebrados.
 */
export function baixarArquivo(nomeDoArquivo: string, arquivo: Blob): void {
  if (typeof document === "undefined") {
    return;
  }
  const url = URL.createObjectURL(arquivo);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeDoArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revogar logo depois do click interrompe o download em alguns Safari: o
  // endereco do Blob fica valido mais um pouco (o mesmo prazo do FileSaver).
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}
