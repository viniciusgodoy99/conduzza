// A PROVA PAGA da midia da AG6b (desenho 4.6; D-100): mede, com material SO
// SINTETICO, se o leitor de midia (gpt-6-luna) le imagem e PDF com store
// false, raciocinio "none", temperature 0 e saida estruturada; o acerto dos
// 10 tipos e dos codigos; os tokens por imagem e por pagina (os tetos da
// reserva do gasto); o tempo; e, na transcricao (whisper-1, verbose_json),
// os campos, as metricas dos segmentos no silencio, no ruido e na musica
// (as travas da saida), as frases-fantasma, o usage.seconds, o tempo em 15,
// 60 e 120 s e a taxa do MP3 que a uazapi gera.
//
// SO RODA COM O OK DO DONO. Gasta dinheiro de verdade, com teto duro:
//
//   OPENAI_API_KEY_AVALIACAO=sk-... npx tsx --conditions=react-server \
//     scripts/ia/prova-da-midia.ts --com-o-ok-do-dono \
//     --material <pasta> --orcamento-usd 3 \
//     --preco-entrada-usd-mtok 0.1 --preco-saida-usd-mtok 0.5 \
//     --preco-audio-usd-min 0.006
//
// - A chave vem SO do ambiente da linha de comando, do projeto "avaliacao"
//   da OpenAI (a da D34: limite rigido de gasto, expiracao curta, revogar ao
//   terminar). Nunca a de producao (OPENAI_API_KEY), nunca no .env.local,
//   nunca com VERCEL_ENV=production, e so com --com-o-ok-do-dono.
// - "--conditions=react-server": a transcricao e server-only (o marcador do
//   Next); a condicao faz o import valer fora do Next.
// - Os precos vem por parametro, conferidos na pagina oficial no dia
//   (developers.openai.com/api/docs/pricing; preco nao mora no codigo). Com
//   eles, o script estima o pior caso de cada chamada ANTES de fazer e para
//   quando a proxima estouraria o orcamento.
// - MATERIAL SO SINTETICO, nunca de paciente (desenho 4.6): pedidos medicos
//   montados com nome, medico e CRM inventados (digitado e "a mao"),
//   fotografados com a localizacao desligada, um deles girado; dois
//   resultados, uma receita, uma carteirinha e um documento de modelo
//   inventados; duas fotos genericas; uma figurinha; uma foto borrada; PDFs
//   de 1, 3 e 4 paginas; audios gerados no computador (voz sintetica em
//   portugues) com roteiro; silencio de 5 e 30 s, ruido e musica; e um audio
//   de teste mandado por um telefone da equipe (com o aceite da pessoa) para
//   medir o MP3 da uazapi. A pasta tem um manifesto.json:
//     {
//       "arquivos": [
//         { "arquivo": "pedido-digitado.jpg", "mimetype": "image/jpeg",
//           "midia": "imagem", "tipo": "pedido_de_exame_ou_procedimento",
//           "itens": ["Hemograma", "Glicemia de jejum"], "fora": 0 },
//         ...
//       ],
//       "audios": [
//         { "arquivo": "preco.mp3", "roteiro": "fala", "esperado": "transcricao" },
//         { "arquivo": "silencio-30s.mp3", "roteiro": "silencio", "esperado": "sem_fala" },
//         ...
//       ],
//       "catalogo": ["Hemograma", "Glicemia de jejum", "Limpeza de pele", ...]
//     }
// - O RELATORIO tem so numeros e acertos (o material e sintetico, mas mesmo
//   assim: nenhuma transcricao, nenhum texto do modelo; o nome do arquivo
//   so como hash). Vai para docs/avaliacoes/ia/ (ou --saida).
//
// O que o relatorio responde (para o commit pequeno das constantes medidas,
// desenho 9): TRANSCRICAO_CALIBRADA, os limites das travas (no_speech_prob,
// avg_logprob, compression_ratio) e as frases-fantasma vistas; os prazos
// (PRAZO_DA_TRANSCRICAO_MS, PRAZO_DO_LEITOR_MS, o prazo minimo do turno com
// midia); TETO_DE_TOKENS_POR_IMAGEM e TETO_DE_TOKENS_POR_PAGINA; e se o
// gpt-6-luna le imagem e PDF (se nao ler, "Ler imagem e documento" nao liga
// e outro modelo volta ao dono).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  duracaoDoMp3,
  prepararMidia,
  semEtiquetasId3,
} from "../../lib/domain/midia-para-o-modelo";
import {
  avaliarTranscricao,
  segmentoEmSilencio,
} from "../../lib/domain/conformidade/qualidade-da-transcricao";
import { chamadaPodeTerSidoCobrada } from "../../lib/agente/gasto";
import { criarClienteOpenAi } from "../../lib/integrations/llm/openai";
import {
  lerArquivoComOModelo,
  MAX_TOKENS_DO_LEITOR,
  MAXIMO_DE_CHAMADAS_DO_LEITOR,
  montarEnvelopeDaLeitura,
  POLITICA_DO_LEITOR,
  VERSAO_DA_POLITICA_DO_LEITOR,
  type ArquivoParaOLeitor,
  type ClienteDoLeitor,
  type ItemDoCatalogoDaLeitura,
} from "../../lib/integrations/llm/leitor-de-midia";
import {
  MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO,
  transcreverAudio,
  VERSAO_DA_TRANSCRICAO,
} from "../../lib/integrations/llm/transcricao";
import { modeloDoVerificador } from "../../lib/integrations/llm/verificador";
import type { TipoDoLeitor } from "../../lib/domain/agente/config";

const TETO_DO_ORCAMENTO_USD = 20;
/** Prazos generosos na prova (a prova mede o tempo; o motor corta). */
const PRAZO_DA_PROVA_MS = 60_000;

// ---------------------------------------------------------------------------
// Parametros e travas
// ---------------------------------------------------------------------------

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function numeroPositivo(nome: string, obrigatorio: boolean): number | undefined {
  const bruto = argumento(nome);
  if (bruto === undefined) {
    if (obrigatorio) {
      throw new Error(`Faltou ${nome}.`);
    }
    return undefined;
  }
  const valor = Number(bruto.replace(",", "."));
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error(`${nome} precisa ser um numero maior que zero.`);
  }
  return valor;
}

function lerParametros() {
  if (!process.argv.includes("--com-o-ok-do-dono")) {
    throw new Error(
      "A prova paga da midia so roda com o ok do dono (D-100): passe --com-o-ok-do-dono.",
    );
  }
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("A prova da midia nao roda em producao.");
  }
  const chave = process.env.OPENAI_API_KEY_AVALIACAO?.trim();
  if (!chave) {
    throw new Error(
      "Defina OPENAI_API_KEY_AVALIACAO na linha de comando (chave do projeto avaliacao da OpenAI).",
    );
  }
  if (chave === process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      "A chave de avaliacao e igual a OPENAI_API_KEY: use a chave do projeto avaliacao.",
    );
  }
  const orcamentoUsd = numeroPositivo("--orcamento-usd", true) ?? 0;
  if (orcamentoUsd > TETO_DO_ORCAMENTO_USD) {
    throw new Error(`--orcamento-usd acima de US$ ${TETO_DO_ORCAMENTO_USD}: confira o valor.`);
  }
  const material = argumento("--material");
  if (!material || !existsSync(join(material, "manifesto.json"))) {
    throw new Error("Passe --material com a pasta do material sintetico e o manifesto.json.");
  }
  const modelo = modeloDoVerificador(process.env);
  if (modelo === null) {
    throw new Error("IA_MODELO_VERIFICADOR fora da lista fechada.");
  }
  return {
    chave,
    orcamentoUsd,
    material,
    modelo,
    precoEntrada: numeroPositivo("--preco-entrada-usd-mtok", true) ?? 0,
    precoSaida: numeroPositivo("--preco-saida-usd-mtok", true) ?? 0,
    precoAudioPorMinuto: numeroPositivo("--preco-audio-usd-min", true) ?? 0,
    pasta: argumento("--saida") ?? join("docs", "avaliacoes", "ia"),
  };
}

// ---------------------------------------------------------------------------
// O orcamento (o pior caso antes de cada chamada)
// ---------------------------------------------------------------------------

class OrcamentoEsgotado extends Error {}

function criarOrcamento(p: ReturnType<typeof lerParametros>) {
  let gastoUsd = 0;
  // Pessimista: um token por byte do arquivo em base64 e da politica.
  const piorDeUmaLeitura = (bytesDoArquivo: number) => {
    const entrada = Math.ceil((bytesDoArquivo * 4) / 3) + POLITICA_DO_LEITOR.length;
    return (entrada * p.precoEntrada + MAX_TOKENS_DO_LEITOR * p.precoSaida) / 1e6;
  };
  return {
    // A reserva conta o pior caso de TODAS as chamadas que a integracao pode
    // fazer (a nova tentativa propria do leitor e da transcricao), como a
    // reserva do motor (custoMaximoDoTurno).
    reservarLeitura(bytesDoArquivo: number) {
      const pior = piorDeUmaLeitura(bytesDoArquivo) * MAXIMO_DE_CHAMADAS_DO_LEITOR;
      if (gastoUsd + pior > p.orcamentoUsd) {
        throw new OrcamentoEsgotado();
      }
    },
    registrarLeitura(entrada: number, saida: number) {
      gastoUsd += (entrada * p.precoEntrada + saida * p.precoSaida) / 1e6;
    },
    /** A chamada sem o uso de volta que pode ter sido cobrada: o pior caso. */
    registrarLeituraNoPiorCaso(bytesDoArquivo: number) {
      gastoUsd += piorDeUmaLeitura(bytesDoArquivo);
    },
    reservarAudio(segundos: number) {
      const pior =
        (Math.ceil(segundos) / 60) * p.precoAudioPorMinuto * MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO;
      if (gastoUsd + pior > p.orcamentoUsd) {
        throw new OrcamentoEsgotado();
      }
    },
    registrarAudio(segundos: number) {
      gastoUsd += (Math.ceil(segundos) / 60) * p.precoAudioPorMinuto;
    },
    get gastoUsd() {
      return gastoUsd;
    },
  };
}

// ---------------------------------------------------------------------------
// O material
// ---------------------------------------------------------------------------

type ArquivoDoManifesto = {
  arquivo: string;
  mimetype: string;
  midia: "imagem" | "documento";
  tipo: TipoDoLeitor;
  /** Os nomes do Cadastro que o pedido tem (so no pedido). */
  itens?: string[];
  fora?: number;
};

type AudioDoManifesto = {
  arquivo: string;
  roteiro: "fala" | "silencio" | "ruido" | "musica" | "uazapi";
  esperado: "transcricao" | "sem_fala";
};

type Manifesto = {
  arquivos: ArquivoDoManifesto[];
  audios: AudioDoManifesto[];
  catalogo: string[];
};

function hash(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex").slice(0, 12);
}

/** As estatisticas de uma lista de numeros (so os numeros vao ao relatorio). */
function estatisticas(valores: readonly number[]) {
  if (valores.length === 0) {
    return null;
  }
  const ordenados = [...valores].sort((a, b) => a - b);
  const em = (q: number) => ordenados[Math.min(ordenados.length - 1, Math.floor(q * ordenados.length))];
  return {
    n: valores.length,
    min: ordenados[0],
    p50: em(0.5),
    p90: em(0.9),
    max: ordenados[ordenados.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Execucao
// ---------------------------------------------------------------------------

async function main() {
  const p = lerParametros();
  const manifesto = JSON.parse(
    readFileSync(join(p.material, "manifesto.json"), "utf-8"),
  ) as Manifesto;
  const orcamento = criarOrcamento(p);
  const cliente = criarClienteOpenAi({ apiKey: p.chave, timeoutMs: PRAZO_DA_PROVA_MS });
  const catalogo: ItemDoCatalogoDaLeitura[] = manifesto.catalogo.map((nome, i) => ({
    codigo: `p${i + 1}`,
    id: `id-${i + 1}`,
    nome,
  }));
  const idPorNome = new Map(catalogo.map((c) => [c.nome, c.id]));
  // Um HMAC qualquer no formato (a prova nao tem contato).
  const identificador = createHash("sha256").update("prova-da-midia").digest("hex");

  // (a) a (d): o leitor de midia.
  const leituras: {
    arquivo: string;
    midia: string;
    esperado: TipoDoLeitor;
    lido: string;
    acertouTipo: boolean;
    acertouItens: boolean | null;
    tokensDeEntrada: number | null;
    tokensDoArquivo: number | null;
    paginas: number | null;
    ms: number;
  }[] = [];
  const envelopeEmTokens = Math.ceil(
    (POLITICA_DO_LEITOR.length +
      montarEnvelopeDaLeitura({ catalogo, nonce: "0".repeat(24) }).length) /
      2,
  );
  for (const a of manifesto.arquivos) {
    const bytes = new Uint8Array(readFileSync(join(p.material, a.arquivo)));
    const preparada = prepararMidia({ midia: a.midia, bytes, mimetype: a.mimetype });
    if (preparada.tipo === "figurinha" || preparada.tipo === "fora" || preparada.tipo === "audio") {
      leituras.push({
        arquivo: hash(a.arquivo),
        midia: a.midia,
        esperado: a.tipo,
        lido: preparada.tipo === "fora" ? `fora:${preparada.motivo}` : preparada.tipo,
        acertouTipo: preparada.tipo === "figurinha" && a.tipo === "figurinha",
        acertouItens: null,
        tokensDeEntrada: null,
        tokensDoArquivo: null,
        paginas: null,
        ms: 0,
      });
      continue;
    }
    const arquivo: ArquivoParaOLeitor =
      preparada.tipo === "pdf"
        ? { tipo: "pdf", bytes: preparada.bytes }
        : { tipo: "imagem", formato: preparada.formato, bytes: preparada.bytes };
    try {
      orcamento.reservarLeitura(arquivo.bytes.length);
    } catch (erro) {
      if (erro instanceof OrcamentoEsgotado) {
        break;
      }
      throw erro;
    }
    const inicio = Date.now();
    const r = await lerArquivoComOModelo({
      cliente: cliente as unknown as ClienteDoLeitor,
      modelo: p.modelo,
      identificadorDeSeguranca: identificador,
      arquivo,
      catalogo,
      prazoMs: PRAZO_DA_PROVA_MS,
      ids: {
        clinicId: "prova",
        conversationId: "prova",
        jobId: "prova",
        messageId: hash(a.arquivo),
        midia: a.midia,
      },
    });
    const ms = Date.now() - inicio;
    const entrada =
      r.uso === null
        ? null
        : r.uso.tokensEntrada + r.uso.tokensCacheLidos + r.uso.tokensCacheGravados;
    if (r.uso !== null) {
      orcamento.registrarLeitura(entrada ?? 0, r.uso.tokensSaida);
    } else if (r.tipo === "lido" || chamadaPodeTerSidoCobrada(r.motivo)) {
      orcamento.registrarLeituraNoPiorCaso(arquivo.bytes.length);
    }
    // As chamadas anteriores a ultima que falharam sem resposta (a nova
    // tentativa do leitor): o pior caso de cada uma.
    for (let i = 0; i < (r.tentativasSemUso ?? 0); i += 1) {
      orcamento.registrarLeituraNoPiorCaso(arquivo.bytes.length);
    }
    const esperados = (a.itens ?? []).map((nome) => idPorNome.get(nome) ?? "?").sort();
    leituras.push({
      arquivo: hash(a.arquivo),
      midia: a.midia,
      esperado: a.tipo,
      lido: r.tipo === "lido" ? r.leitura.tipo : `falha:${r.motivo}`,
      acertouTipo: r.tipo === "lido" && r.leitura.tipo === a.tipo,
      acertouItens:
        a.tipo === "pedido_de_exame_ou_procedimento" && r.tipo === "lido"
          ? JSON.stringify([...r.leitura.procedimentos].sort()) === JSON.stringify(esperados) &&
            r.leitura.foraDoCadastro === (a.fora ?? 0)
          : null,
      tokensDeEntrada: entrada,
      tokensDoArquivo: entrada === null ? null : Math.max(0, entrada - envelopeEmTokens),
      paginas: preparada.tipo === "pdf" ? preparada.paginas : null,
      ms,
    });
  }

  // (e) e (f): a transcricao e o MP3 da uazapi.
  const audios: {
    arquivo: string;
    roteiro: string;
    esperado: string;
    resultado: string;
    acertou: boolean;
    segundosMedidos: number | null;
    usageSeconds: number | null;
    duration: number | null;
    kbps: number | null;
    segmentos: { noSpeech: number; avgLogprob: number; compression: number; silencio: boolean }[];
    semFalaPeloTexto: boolean;
    ms: number;
  }[] = [];
  for (const a of manifesto.audios) {
    const bytes = new Uint8Array(readFileSync(join(p.material, a.arquivo)));
    const limpos = semEtiquetasId3(bytes);
    const medida = duracaoDoMp3(limpos);
    const kbps =
      medida === null || medida.segundos <= 0
        ? null
        : Math.round((limpos.length * 8) / medida.segundos / 1000);
    if (medida === null) {
      audios.push({
        arquivo: hash(a.arquivo),
        roteiro: a.roteiro,
        esperado: a.esperado,
        resultado: "fora:sem_quadros",
        acertou: false,
        segundosMedidos: null,
        usageSeconds: null,
        duration: null,
        kbps,
        segmentos: [],
        semFalaPeloTexto: false,
        ms: 0,
      });
      continue;
    }
    try {
      orcamento.reservarAudio(medida.segundos);
    } catch (erro) {
      if (erro instanceof OrcamentoEsgotado) {
        break;
      }
      throw erro;
    }
    const inicio = Date.now();
    // Pela integracao do motor (a UNICA chamada da transcricao no codigo),
    // com a medida dos segmentos so para a prova.
    let medidaDaApi: Parameters<NonNullable<Parameters<typeof transcreverAudio>[0]["medir"]>>[0] | null =
      null;
    const feita = await transcreverAudio({
      cliente,
      modelo: "whisper-1",
      bytes: limpos,
      segundosMedidos: medida.segundos,
      prazoMs: PRAZO_DA_PROVA_MS,
      ids: { clinicId: "prova", conversationId: "prova", jobId: "prova", messageId: hash(a.arquivo) },
      medir: (m) => {
        medidaDaApi = m;
      },
    });
    const ms = Date.now() - inicio;
    const lida = medidaDaApi as Parameters<NonNullable<Parameters<typeof transcreverAudio>[0]["medir"]>>[0] | null;
    const segmentos = lida?.segmentos ?? [];
    orcamento.registrarAudio(feita.uso?.segundos ?? medida.segundos);
    // As tentativas anteriores a ultima que falharam sem resposta: a duracao
    // medida de cada uma (o pior caso).
    for (let i = 0; i < (feita.tentativasSemUso ?? 0); i += 1) {
      orcamento.registrarAudio(medida.segundos);
    }
    const resposta = { duration: lida?.duration, usage: { seconds: lida?.usageSeconds ?? undefined } };
    // So as metricas (um texto neutro no lugar de cada segmento falado):
    // separa o "sem fala" das travas de metrica (silencio, repeticao,
    // confianca) do "sem fala" pelo texto (frase-fantasma, vazio, longo).
    // O texto neutro tem o MESMO numero de palavras do segmento (no minimo
    // uma): a trava da resposta curta (curta_incerta) olha as metricas E o
    // tamanho, e com um "x" so ela marcaria toda resposta como curta.
    const pelasMetricas =
      feita.tipo === "falhou"
        ? null
        : avaliarTranscricao({
            segmentos: segmentos.map((sg) => ({
              ...sg,
              text: segmentoEmSilencio({ ...sg, text: "" })
                ? ""
                : Array.from({ length: Math.max(1, sg.palavras) }, () => "x").join(" "),
            })),
          });
    audios.push({
      arquivo: hash(a.arquivo),
      roteiro: a.roteiro,
      esperado: a.esperado,
      // O resultado da integracao (as travas de verdade); a avaliacao sem o
      // texto so separa o motivo do "sem fala" (silencio, repeticao,
      // confianca) para a calibragem.
      resultado:
        feita.tipo === "falhou"
          ? `falhou:${feita.motivo}`
          : feita.tipo === "transcrita"
            ? "transcricao"
            : `sem_fala:${pelasMetricas?.tipo === "sem_fala" ? pelasMetricas.motivo : "pelo_texto"}`,
      acertou: (feita.tipo === "transcrita" ? "transcricao" : "sem_fala") === a.esperado,
      segundosMedidos: Math.round(medida.segundos * 10) / 10,
      usageSeconds: resposta.usage?.seconds ?? null,
      duration: resposta.duration ?? null,
      kbps,
      segmentos: segmentos.map((sg) => ({
        noSpeech: sg.no_speech_prob,
        avgLogprob: sg.avg_logprob,
        compression: sg.compression_ratio,
        silencio: segmentoEmSilencio({ ...sg, text: "" }),
      })),
      // O "sem fala" que as metricas deixavam passar e o texto barrou (a
      // frase-fantasma, o vazio, o longo; o texto nunca vai ao relatorio).
      semFalaPeloTexto:
        feita.tipo === "sem_fala" && pelasMetricas?.tipo === "transcrita",
      ms,
    });
  }

  const porPagina = leituras
    .filter((l) => l.paginas !== null && l.tokensDoArquivo !== null)
    .map((l) => Math.ceil((l.tokensDoArquivo ?? 0) / (l.paginas ?? 1)));
  const porImagem = leituras
    .filter((l) => l.paginas === null && l.tokensDoArquivo !== null)
    .map((l) => l.tokensDoArquivo ?? 0);
  const relatorio = {
    data: new Date().toISOString(),
    versoes: { leitor: VERSAO_DA_POLITICA_DO_LEITOR, transcricao: VERSAO_DA_TRANSCRICAO },
    modelo: p.modelo,
    gastoUsd: Math.round(orcamento.gastoUsd * 10_000) / 10_000,
    leitor: {
      acertoDoTipo: `${leituras.filter((l) => l.acertouTipo).length}/${leituras.length}`,
      acertoDosItens: `${leituras.filter((l) => l.acertouItens === true).length}/${
        leituras.filter((l) => l.acertouItens !== null).length
      }`,
      tokensPorImagem: estatisticas(porImagem),
      tokensPorPagina: estatisticas(porPagina),
      ms: estatisticas(leituras.filter((l) => l.ms > 0).map((l) => l.ms)),
      linhas: leituras,
    },
    transcricao: {
      acerto: `${audios.filter((a) => a.acertou).length}/${audios.length}`,
      ms: estatisticas(audios.filter((a) => a.ms > 0).map((a) => a.ms)),
      kbpsDaUazapi: audios.filter((a) => a.roteiro === "uazapi").map((a) => a.kbps),
      linhas: audios,
    },
  };
  mkdirSync(p.pasta, { recursive: true });
  const destino = join(p.pasta, `prova-da-midia-${relatorio.data.slice(0, 10)}.json`);
  writeFileSync(destino, `${JSON.stringify(relatorio, null, 2)}\n`);
  process.stdout.write(`Relatorio: ${destino} (gasto US$ ${relatorio.gastoUsd}).\n`);
}

main().catch((erro: unknown) => {
  // Nunca a mensagem do SDK (pode ecoar conteudo): so o nome do erro.
  process.stderr.write(
    `A prova parou: ${erro instanceof Error ? erro.name : "erro"}${
      erro instanceof Error && !/openai/i.test(erro.constructor.name) ? `: ${erro.message}` : ""
    }\n`,
  );
  process.exitCode = 1;
});
