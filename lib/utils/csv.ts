// Geracao e download de CSV no padrao Excel pt-BR: separador ";" e BOM
// UTF-8 no inicio (sem o BOM o Excel abre acentos quebrados).

/** Escapa a celula quando contem ";", aspas ou quebra de linha. */
function escaparCelula(celula: string): string {
  if (/[";\n\r]/.test(celula)) {
    return `"${celula.replaceAll('"', '""')}"`;
  }
  return celula;
}

export function gerarCsv(linhas: string[][]): string {
  const corpo = linhas
    .map((linha) => linha.map(escaparCelula).join(";"))
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
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeDoArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
