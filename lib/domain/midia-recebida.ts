// O arquivo de uma mensagem: em que pe ele esta, com que nome ele baixa e o
// que fazer quando o Storage recusa guardar.
//
// media_url passa por quatro formas, e so a coluna diz qual:
//
//   - URL do provedor (https://...) ou nula: o arquivo ainda nao esta com a
//     gente. O job baixar_midia pode estar rodando (ou nunca ter nascido).
//   - storage://midia-conversas/<clinica>/<mensagem>: pronto para servir.
//   - seed://...: dado de demonstracao, nunca tem arquivo.
//   - indisponivel://<motivo>: o job desistiu de vez. ESTADO FINAL.
//
// A sentinela vive em media_url, e nao numa coluna nova, porque o estado e do
// ARQUIVO e media_url ja e a coluna que diz onde o arquivo esta. Quem so
// conhece storage:// (a rota de midia, o apagamento) continua recusando tudo
// que nao comeca com storage://, sem mudar uma linha.
//
// Sem estado final a bolha dizia "Baixando o arquivo" para sempre, e a
// recepcao esperava um exame que nunca ia aparecer, sem saber que precisava
// pedir para o paciente mandar de novo.

export const PREFIXO_INDISPONIVEL = "indisponivel://";

/**
 * Quanto tempo uma midia sem arquivo ainda conta como "baixando".
 *
 * O backoff do job (30s, 60s, 120s, 240s, 480s) ja fez cinco tentativas
 * perto dos 15 minutos. Passou disso sem arquivo, a chance de chegar e pequena
 * e a recepcao precisa saber agora, nao daqui a uma hora. Tambem cobre a midia
 * que chegou sem URL (o job nem nasce) e o job que o lease enterrou sem passar
 * pelo worker (e nunca recebeu a sentinela).
 */
export const JANELA_DE_DOWNLOAD_MS = 15 * 60_000;

export type MotivoDeIndisponivel =
  | "grande_demais"
  | "storage_falhou"
  | "download_falhou"
  | "sem_url"
  | "desistiu";

const MOTIVOS: ReadonlySet<string> = new Set<MotivoDeIndisponivel>([
  "grande_demais",
  "storage_falhou",
  "download_falhou",
  "sem_url",
  "desistiu",
]);

export function marcaDeIndisponivel(motivo: MotivoDeIndisponivel): string {
  return `${PREFIXO_INDISPONIVEL}${motivo}`;
}

export type EstadoDaMidia =
  | { tipo: "pronta" }
  | { tipo: "demonstracao" }
  /** `venceEm` em ms epoch: quando vira indisponivel sem novidade do banco */
  | { tipo: "baixando"; venceEm: number }
  /** motivo nulo: venceu a janela sem o worker dizer por que */
  | { tipo: "indisponivel"; motivo: MotivoDeIndisponivel | null };

export function estadoDaMidia(
  mediaUrl: string | null,
  createdAt: string,
  agoraMs: number,
): EstadoDaMidia {
  if (mediaUrl?.startsWith("storage://")) {
    return { tipo: "pronta" };
  }
  if (mediaUrl?.startsWith("seed://")) {
    return { tipo: "demonstracao" };
  }
  if (mediaUrl?.startsWith(PREFIXO_INDISPONIVEL)) {
    const motivo = mediaUrl.slice(PREFIXO_INDISPONIVEL.length);
    return {
      tipo: "indisponivel",
      motivo: MOTIVOS.has(motivo) ? (motivo as MotivoDeIndisponivel) : null,
    };
  }
  const criadaEm = new Date(createdAt).getTime();
  const venceEm =
    (Number.isNaN(criadaEm) ? agoraMs : criadaEm) + JANELA_DE_DOWNLOAD_MS;
  if (agoraMs < venceEm) {
    return { tipo: "baixando", venceEm };
  }
  return { tipo: "indisponivel", motivo: null };
}

/**
 * Motivo que vai para a sentinela, a partir do codigo curto do job.
 *
 * Le o MESMO codigo que vai para job_queue.last_error, para as duas coisas
 * nunca contarem historias diferentes sobre a mesma falha.
 */
export function motivoDaDesistencia(erro: string): MotivoDeIndisponivel {
  if (
    erro === "download:uazapi_download_413" ||
    /^storage_falhou:413(:|$)/.test(erro) ||
    /:EntityTooLarge$/.test(erro)
  ) {
    return "grande_demais";
  }
  if (erro.startsWith("storage_falhou")) {
    return "storage_falhou";
  }
  if (erro.startsWith("download:")) {
    return "download_falhou";
  }
  return "desistiu";
}

// Status do Storage que dizem respeito ao ARQUIVO: repetir 8 vezes ao longo
// de uma hora nao muda o resultado. 401, 403 e 404 ficam de fora de proposito,
// porque falam do AMBIENTE (chave trocada, balde sumido): corrigido o
// ambiente, a proxima tentativa passa, e desistir na primeira condenaria toda
// midia da janela.
const HTTP_DEFINITIVOS = new Set([400, 413, 415, 422]);

/**
 * Traduz o erro do upload no Storage para o codigo curto do job.
 *
 * So CODIGOS saem daqui (status HTTP e o codigo de servico do Storage, como
 * EntityTooLarge), nunca a mensagem: last_error e log nao carregam texto que
 * possa ter vindo de conteudo.
 *
 * O status do CORPO (statusCode, texto) vem antes do status HTTP: versoes do
 * Storage respondem 400 no HTTP e poem o codigo real (413, 404) no corpo.
 */
export function classificarFalhaDeUpload(erro: unknown): {
  erro: string;
  definitivo: boolean;
} {
  const campos = (erro && typeof erro === "object" ? erro : {}) as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };
  const doCorpo =
    typeof campos.statusCode === "string" && /^\d{3}$/.test(campos.statusCode)
      ? Number(campos.statusCode)
      : null;
  const http =
    doCorpo ??
    (typeof campos.status === "number" && Number.isInteger(campos.status)
      ? campos.status
      : null);
  const codigo =
    typeof campos.code === "string" && /^[A-Za-z]{1,40}$/.test(campos.code)
      ? campos.code
      : null;
  const tamanho = http === 413 || codigo === "EntityTooLarge";
  return {
    erro: `storage_falhou:${http ?? "x"}${codigo ? `:${codigo}` : ""}`,
    definitivo: tamanho || (http !== null && HTTP_DEFINITIVOS.has(http)),
  };
}

/**
 * Mimetype limpo, ou nulo.
 *
 * O tipo vem do provedor e nao e confiavel: serve para ESCOLHER entre foto e
 * video na tela e para achar a extensao numa lista fechada, nunca para montar
 * cabecalho de resposta.
 */
export function normalizarMimetype(
  bruto: string | null | undefined,
): string | null {
  if (!bruto) {
    return null;
  }
  const base = (bruto.split(";")[0] ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,126}$/.test(base)
    ? base
    : null;
}

// Lista FECHADA. SVG e HTML ficam de fora de proposito: baixados com a
// extensao certa, abririam no navegador com script. Fora da lista, o arquivo
// baixa sem extensao, que e honesto: .pdf fixo fazia uma planilha abrir num
// leitor de PDF e dar erro. A lista so decide a extensao TIRADA DO TIPO: o
// nome original que o paciente mandou mantem a extensao que ja tiver.
const EXTENSOES: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/rtf": "rtf",
  "application/zip": "zip",
  "text/plain": "txt",
  "text/csv": "csv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
};

export function extensaoDoMimetype(
  mimetype: string | null | undefined,
): string | null {
  const limpo = normalizarMimetype(mimetype);
  return limpo ? (EXTENSOES[limpo] ?? null) : null;
}

const TAMANHO_MAXIMO_DO_NOME = 120;

// Controle (Cc) e FORMATACAO Unicode (Cf). Cf e o que importa aqui: inclui os
// controles bidirecionais (U+200E, U+200F, U+202A a U+202E, U+2066 a U+2069)
// e os invisiveis de largura zero. Um contato manda 'laudo<RLO>fdp.exe' e a
// tela desenha 'laudoexe.pdf': o cartao mostraria PDF e o download seria um
// executavel. Tirando o Cf, o nome aparece como e ('laudofdp.exe').
const CARACTERES_PROIBIDOS = /[\p{Cc}\p{Cf}\\/:*?"<>|]/gu;

/**
 * Nome de arquivo que pode ir para o Content-Disposition e para a tela.
 *
 * Tira separador de pasta, caractere proibido no Windows, controle e
 * caractere de formatacao invisivel (inclusive os bidirecionais); corta nomes
 * enormes preservando a extensao. Nome que sobra vazio vira nulo.
 *
 * Roda na LEITURA (tela e download), entao vale tambem para nome ja gravado.
 */
export function nomeSeguroDeArquivo(
  nome: string | null | undefined,
): string | null {
  if (!nome) {
    return null;
  }
  const limpo = nome
    .replace(CARACTERES_PROIBIDOS, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  if (!limpo) {
    return null;
  }
  if (limpo.length <= TAMANHO_MAXIMO_DO_NOME) {
    return limpo;
  }
  const extensao = /\.[A-Za-z0-9]{1,8}$/.exec(limpo)?.[0] ?? "";
  return `${limpo.slice(0, TAMANHO_MAXIMO_DO_NOME - extensao.length).trimEnd()}${extensao}`;
}

function temExtensao(nome: string): boolean {
  return /\.[A-Za-z0-9]{2,5}$/.test(nome);
}

export type ArquivoDaMensagem = {
  content_type: string;
  body: string | null;
  media_filename?: string | null;
  media_mimetype?: string | null;
  /** 'entrada' (do paciente) ou 'saida' (da clinica) */
  direction?: string | null;
};

/**
 * Nome do arquivo que ja veio do WhatsApp, quando ha.
 *
 * O body so conta como nome quando termina em extensao: e o dado antigo, de
 * antes de o nome ganhar coluna propria. Fora disso body e LEGENDA.
 */
export function nomeOriginalDoArquivo(
  mensagem: ArquivoDaMensagem,
): string | null {
  const proprio = nomeSeguroDeArquivo(mensagem.media_filename);
  if (proprio) {
    return proprio;
  }
  const doCorpo = nomeSeguroDeArquivo(mensagem.body);
  return doCorpo && temExtensao(doCorpo) ? doCorpo : null;
}

function rotuloDoArquivo(mensagem: ArquivoDaMensagem): string {
  if (mensagem.content_type === "documento") return "documento";
  if (mensagem.content_type === "imagem") return "foto";
  if (mensagem.content_type === "audio") return "audio";
  const tipo = normalizarMimetype(mensagem.media_mimetype) ?? "";
  if (tipo.startsWith("image/")) return "foto";
  if (tipo.startsWith("audio/")) return "audio";
  if (tipo.startsWith("video/")) return "video";
  return "arquivo";
}

/**
 * Extensao quando o tipo guardado nao diz nada (nulo ou fora da lista).
 *
 * - Foto: .jpg, porque o WhatsApp sempre recomprime foto em JPEG.
 * - Documento que a CLINICA enviou: .pdf. A linha de saida nasce sem
 *   media_mimetype (send.ts so repassa o tipo ao provedor), e o unico
 *   documento que sai e PDF: o anexo do Inbox (MIMES_ACEITOS em
 *   atendimento/actions.ts) e o do passo da regua (MIMES_DO_ANEXO em
 *   automacoes/actions.ts) so aceitam application/pdf. Sem isto o PDF enviado
 *   baixava como "conduzza-documento", sem extensao.
 * - Documento do PACIENTE sem tipo: nenhuma. Pode ser planilha, e .pdf fixo a
 *   faria abrir num leitor de PDF e dar erro.
 */
function extensaoDeReserva(mensagem: ArquivoDaMensagem): string | null {
  if (mensagem.content_type === "imagem") return "jpg";
  if (mensagem.content_type === "documento" && mensagem.direction === "saida") {
    return "pdf";
  }
  return null;
}

/**
 * Nome com que o arquivo chega ao computador de quem baixa.
 *
 * Ordem: o nome original (com a extensao do tipo real quando faltar), e
 * depois "conduzza-<tipo>" com a extensao do tipo real. Sem tipo que sirva,
 * vale a extensao de reserva (foto .jpg, PDF enviado pela clinica .pdf).
 */
export function nomeParaBaixar(mensagem: ArquivoDaMensagem): string {
  const extensao =
    extensaoDoMimetype(mensagem.media_mimetype) ??
    extensaoDeReserva(mensagem);
  const original = nomeOriginalDoArquivo(mensagem);
  if (original) {
    return temExtensao(original) || !extensao
      ? original
      : `${original}.${extensao}`;
  }
  const base = `conduzza-${rotuloDoArquivo(mensagem)}`;
  return extensao ? `${base}.${extensao}` : base;
}

/**
 * Como a bolha mostra uma midia que chegou como 'texto' (o enum do banco nao
 * preve video nem figurinha). O tipo REAL decide: figurinha e image/webp e vai
 * para <img>; um <video> apontando para webp nao toca nada. Sem tipo guardado
 * (dado antigo), fica o comportamento de antes, video.
 */
export function exibicaoDaMidiaDeTexto(
  mediaMimetype: string | null | undefined,
): "foto" | "audio" | "video" {
  const tipo = normalizarMimetype(mediaMimetype) ?? "";
  if (tipo.startsWith("image/")) return "foto";
  if (tipo.startsWith("audio/")) return "audio";
  return "video";
}
