import { z } from "zod";

// Arquivo de conversoes para o Google Ads (etapa 6A do plano de 16/11/2026,
// "Rastreio completo"). Regras PURAS, zero I/O.
//
// O formato segue a pagina oficial do Google "Import conversions from ad
// clicks into Google Ads using files (legacy)" e a do Data Manager "Prepare
// your data for import", lidas em 16/11/2026:
// - colunas "Google Click ID", "Conversion Name", "Conversion Time",
//   "Conversion Value", "Conversion Currency" e "Order ID" (as tres ultimas
//   opcionais);
// - a hora com o fuso em cada linha, no formato "yyyy-MM-dd HH:mm:ss+z"
//   (ex.: 2026-11-16 14:30:00-0300), que dispensa a linha "Parameters" e
//   deixa a primeira linha do arquivo ser o cabecalho (o Data Manager exige);
// - separado por VIRGULA e sem BOM: e arquivo para a maquina do Google, nao
//   para o Excel em portugues (por isso nao usa lib/utils/csv.ts);
// - so o GCLID: o arquivo do Google nao tem coluna para gbraid e wbraid (o
//   clique de iPhone), que so vao pelo envio automatico (etapa 6B).
//
// "Conversion Name" e a CHAVE da etapa do funil (ex.: compareceu): e estavel
// (renomear a etapa na tela nao quebra a importacao) e so tem letra
// minuscula, numero e sublinhado. No Google Ads a clinica cria uma acao de
// conversao de importacao de cliques com esse mesmo nome.
//
// A primeira subida de verdade (por uma agencia, numa conta real) ainda
// precisa confirmar o formato: esta descrito aqui o que as paginas dizem.

export const CABECALHO_DO_GOOGLE = [
  "Google Click ID",
  "Conversion Name",
  "Conversion Time",
  "Conversion Value",
  "Conversion Currency",
  "Order ID",
] as const;

const conversaoSchema = z.object({
  gclid: z.string().regex(/^[A-Za-z0-9._~+/=-]{1,512}$/),
  etapa: z.string().min(1),
  convertido_em: z.string().min(1),
  valor_cents: z.number().int().nonnegative().nullable(),
  moeda: z.string().nullable(),
  evento_id: z.string().min(1),
});

const retornoSchema = z.object({
  linhas: z.array(conversaoSchema),
  sem_gclid: z.number().int().nonnegative(),
});

/** Uma conversao como conversoes_para_o_google devolve. */
export type ConversaoParaOGoogle = z.infer<typeof conversaoSchema>;

/** O retorno do banco ja conferido; fora do contrato, null. */
export function lerConversoesParaOGoogle(
  retorno: unknown,
): { linhas: ConversaoParaOGoogle[]; semGclid: number } | null {
  const lido = retornoSchema.safeParse(retorno);
  return lido.success
    ? { linhas: lido.data.linhas, semGclid: lido.data.sem_gclid }
    : null;
}

/**
 * A hora no fuso da clinica, com o deslocamento: "2026-11-16 14:30:00-0300".
 * E o formato "yyyy-MM-dd HH:mm:ss+z" do Google. Null com data invalida.
 */
export function horarioParaOGoogle(iso: string, timezone: string): string | null {
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) {
    return null;
  }
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instante)
      .map((parte) => [parte.type, parte.value]),
  );
  const local = Date.UTC(
    Number(partes.year),
    Number(partes.month) - 1,
    Number(partes.day),
    Number(partes.hour),
    Number(partes.minute),
    Number(partes.second),
  );
  const minutos = Math.round(
    (local - Math.floor(instante.getTime() / 1000) * 1000) / 60_000,
  );
  const sinal = minutos < 0 ? "-" : "+";
  const absoluto = Math.abs(minutos);
  const deslocamento = `${String(Math.floor(absoluto / 60)).padStart(2, "0")}${String(absoluto % 60).padStart(2, "0")}`;
  return `${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}:${partes.second}${sinal}${deslocamento}`;
}

/** O nome da conversao no arquivo: a chave da etapa, so com o que e seguro. */
export function nomeDaConversaoNoGoogle(etapa: string): string {
  return etapa.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * As linhas do arquivo (cabecalho e uma por conversao). Valor em reais com
 * ponto ("250.00") e a moeda so quando ha valor; sem valor, as duas celulas
 * ficam vazias e o Google usa o valor padrao da acao de conversao. Conversao
 * com hora ilegivel fica de fora.
 */
export function linhasDoArquivoDoGoogle(
  conversoes: readonly ConversaoParaOGoogle[],
  timezone: string,
): string[][] {
  const linhas: string[][] = [[...CABECALHO_DO_GOOGLE]];
  for (const conversao of conversoes) {
    const hora = horarioParaOGoogle(conversao.convertido_em, timezone);
    if (!hora) {
      continue;
    }
    const temValor = conversao.valor_cents !== null;
    linhas.push([
      conversao.gclid,
      nomeDaConversaoNoGoogle(conversao.etapa),
      hora,
      temValor ? ((conversao.valor_cents ?? 0) / 100).toFixed(2) : "",
      temValor ? (conversao.moeda ?? "BRL") : "",
      conversao.evento_id,
    ]);
  }
  return linhas;
}

/** CSV do Google: virgula, aspas so quando preciso, CRLF e sem BOM. */
export function gerarCsvDoGoogle(linhas: readonly (readonly string[])[]): string {
  return linhas
    .map((linha) =>
      linha
        .map((celula) =>
          /[",\n\r]/.test(celula) ? `"${celula.replaceAll('"', '""')}"` : celula,
        )
        .join(","),
    )
    .join("\r\n");
}

/** "conversoes-google-2026-11-01-a-2026-11-16.csv" */
export function nomeDoArquivoDoGoogle(diaDe: string, diaAte: string): string {
  return `conversoes-google-${diaDe}-a-${diaAte}.csv`;
}

export const TEXTOS_DAS_CONVERSOES_DO_GOOGLE = {
  item: "Conversões para o Google Ads (CSV)",
  semPermissao: "Só administrador e gestor exportam as conversões para o Google.",
  vazio:
    "Nenhuma conversão de anúncio do Google neste período. Elas aparecem quando um lead que veio do Google pelo site ou pelo link rastreado avança numa etapa com conversão ligada.",
  falhou: "Não foi possível montar o arquivo. Tente de novo.",
} as const;

/** O que a tela diz depois de baixar: quantas foram e quantas ficaram de fora. */
export function resumoDaExportacaoParaOGoogle(
  exportadas: number,
  semGclid: number,
): string {
  const foram = `${exportadas} ${exportadas === 1 ? "conversão exportada" : "conversões exportadas"}.`;
  if (semGclid === 0) {
    return foram;
  }
  const fora =
    semGclid === 1
      ? "1 ficou de fora: clique de iPhone, sem o identificador que o arquivo do Google aceita."
      : `${semGclid} ficaram de fora: cliques de iPhone, sem o identificador que o arquivo do Google aceita.`;
  return `${foram} ${fora}`;
}
