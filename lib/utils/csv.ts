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
