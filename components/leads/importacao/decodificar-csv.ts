// Leitura do arquivo da importacao em texto (achado 101 da revisao). O Excel
// em portugues salva "CSV (separado por virgulas)" em Windows-1252, e ler
// como UTF-8 trocava "João" por "Jo�o" sem aviso; o nome ia para o banco
// assim e o {{nome}} das reguas mandava a palavra quebrada ao paciente.
//
// Regra: tenta UTF-8 estrito (fatal); se algum byte nao for UTF-8 valido, o
// arquivo foi salvo em outra codificacao e e lido de novo como Windows-1252,
// que cobre o Excel do Windows em pt-BR. A tela avisa quando isso acontece.
// O BOM do UTF-8 sai aqui (TextDecoder) e de novo no parseCsv, sem dano.

export type CsvDecodificado = {
  texto: string;
  /** true quando o arquivo nao era UTF-8 e foi lido como Windows-1252 */
  recodificado: boolean;
};

export function decodificarCsv(
  bytes: ArrayBuffer | Uint8Array,
): CsvDecodificado {
  try {
    return {
      texto: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      recodificado: false,
    };
  } catch {
    return {
      texto: new TextDecoder("windows-1252").decode(bytes),
      recodificado: true,
    };
  }
}
