import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CONFIANCAS_DA_LEITURA,
  DECISAO_DO_TIPO_DO_LEITOR,
  LIMITE_DO_RESUMO_DA_LEITURA,
  MIDIAS_LIDAS,
  MOTIVOS_DA_LEITURA,
  RESUMO_DA_LEITURA,
  TIPOS_DE_MIDIA_LIDA,
  TIPOS_DO_LEITOR,
  type ConfiancaDaLeitura,
  type MidiaLida,
  type MotivoDaLeitura,
  type TipoDaMidiaLida,
  type TipoDoLeitor,
} from "@/lib/domain/agente/config";
import type {
  MotivoDaFalha,
  UsoDoLlm,
} from "@/lib/domain/conformidade/veredicto";
import {
  LIMITES_DA_MIDIA,
  mimetypeAceito,
  prepararMidia,
  VERSAO_DA_FIGURINHA,
} from "@/lib/domain/midia-para-o-modelo";
import {
  TETO_DE_TOKENS_POR_IMAGEM,
  TETO_DE_TOKENS_POR_PAGINA,
  VERSAO_DA_POLITICA_DO_LEITOR,
  type ArquivoParaOLeitor,
  type ItemDoCatalogoDaLeitura,
  type ResultadoDoLeitor,
} from "@/lib/integrations/llm/leitor-de-midia";
import type { ArquivoDoStorage } from "@/lib/integrations/storage/arquivo-para-a-ia";
import type { ResultadoDaTranscricaoNoModelo } from "@/lib/integrations/llm/transcricao";
import { log } from "@/lib/log";

import type { CatalogoDoAgente } from "./ferramentas/buscar-procedimento";
import { chamadaPodeTerSidoCobrada, usoEstimadoDoLeitor } from "./gasto";
import type { MensagemDaConversa } from "./laco";
import { USO_ZERADO, type UsoDoModelo } from "./uso";

// A midia do paciente no turno da IA (AG6b, desenho 5.1): o audio pela
// transcricao (lib/integrations/llm/transcricao.ts, a excecao do D-56) e a
// foto ou o PDF pelo leitor de midia (lib/integrations/llm/leitor-de-midia.ts).
//
// Este arquivo tem:
//  - o PLANO do turno (planejarMidiasDoTurno, puro): a situacao de cada
//    midia pendente do paciente (baixando, a transcrever, a ler, lida ou
//    fora) e o historico com as leituras ja gravadas aplicadas (o audio
//    transcrito vira "(áudio) ...", o pedido lido vira a descricao, a
//    figurinha vira "(a pessoa mandou uma figurinha)"; o arquivo nunca vai
//    de novo);
//  - a DECISAO pela leitura do arquivo (decidirPelaLeitura, pura: a tabela
//    1.2, sempre do servidor) e o resumo que a equipe ve;
//  - a PORTA da midia (PortaDaMidia): ler o arquivo do Storage, preparar
//    (lib/domain/midia-para-o-modelo.ts), chamar o modelo e gravar a leitura
//    (gravar_leitura_da_midia). portaDaMidiaDoWhatsapp a monta com as
//    integracoes INJETADAS (o executor passa as de verdade; os testes, as
//    falsas): este arquivo nao importa nada server-only e nunca fala com a
//    OpenAI nem com o Storage por conta propria;
//  - a leitura do motor (lerMidiasDoTurno): o portao do aviso
//    (midia_da_ia_liberada, D-95) e as leituras ja gravadas, pela service
//    role com clinic_id explicito (como o historico).
//
// Falha fechada em tudo: sem a funcao do banco (PGRST202), sem a leitura,
// sem o preco, sem a calibragem, sem o teto do leitor, tudo e "fora" e nada
// sai do servidor. Nada daqui vai para log alem de ids e codigos.

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** A situacao de uma midia pendente no turno (desenho 5.1, 7d). */
export const SITUACOES_DA_MIDIA = [
  "baixando",
  "a_transcrever",
  "a_ler",
  "lida",
  "fora",
] as const;
export type SituacaoDaMidia = (typeof SITUACOES_DA_MIDIA)[number];

/** A leitura ja gravada (ia_leitura_da_midia), como o motor le. */
export type LeituraGravada = {
  midia: MidiaLida;
  tipo: TipoDaMidiaLida;
  transcricao: string | null;
  segundos: number | null;
  /** Os ids do Cadastro (so no pedido). */
  procedimentos: string[];
  foraDoCadastro: number;
  confianca: ConfiancaDaLeitura | null;
  resumo: string | null;
};

/**
 * A midia de uma mensagem do PACIENTE (audio, imagem ou documento), so para
 * o servidor: nunca vai a OpenAI nem para log.
 */
export type MidiaDaConversa = {
  messageId: string;
  midia: MidiaLida;
  /** O arquivo: no Storage, ainda baixando, ou o download desistiu. */
  arquivo: "pronto" | "baixando" | "indisponivel";
  mediaUrl: string | null;
  mimetype: string | null;
  /** message.created_at (ISO): a espera do download conta daqui. */
  criadaEm: string;
  /** A legenda com o nome do contato mascarado (imagem e documento). */
  legenda: string | null;
  /** A situacao no turno (o plano preenche nas pendentes). */
  situacao?: SituacaoDaMidia;
  /** A leitura ja gravada (o plano preenche). */
  leitura?: LeituraGravada;
};

// ---------------------------------------------------------------------------
// Textos fixos (o que o modelo le e a trilha)
// ---------------------------------------------------------------------------

/** O que o agente le no lugar do audio transcrito (antes do texto). */
export const PREFIXO_DO_AUDIO = "(áudio)";

/** O que o agente le no lugar da figurinha. */
export const FRASE_DA_FIGURINHA = "(a pessoa mandou uma figurinha)";

/**
 * O que o agente le no lugar do pedido lido ("{}" e a lista "p3 Hemograma,
 * p7 Glicemia de jejum", com os codigos do bloco <procedimentos>).
 */
export const DESCRICAO_DO_PEDIDO =
  "(a pessoa mandou um pedido de exame ou procedimento com: {})";

/** Os passos da trilha ("Por que a IA respondeu isso"; nunca o conteudo). */
export const PASSOS_DA_MIDIA = {
  transcreveu: "Transcreveu o áudio que a pessoa mandou.",
  semFala: "Não deu para entender fala no áudio: passou para a equipe.",
  transcricaoFalhou: "A transcrição do áudio falhou: passou para a equipe.",
  leuPedido:
    "Leu o arquivo que a pessoa mandou: pedido com {} itens do Cadastro.",
  midiaClinica:
    "O arquivo que a pessoa mandou só a equipe pode avaliar: passou para a equipe.",
  documentoDoPaciente:
    "O arquivo é a carteirinha, uma guia ou um documento pessoal: passou para a equipe.",
  naoIdentificada: "O assistente não identificou o arquivo: passou para a equipe.",
  figurinha: "A pessoa mandou uma figurinha.",
  // Fora do desenho 5.5, mesmo tom: a leitura que falhou e o arquivo fora
  // dos limites (sem chamar modelo).
  leituraFalhou: "A leitura do arquivo falhou: passou para a equipe.",
  arquivoFora:
    "O arquivo que a pessoa mandou está fora do que o assistente lê: passou para a equipe.",
} as const;

/** O passo da trilha de cada motivo da leitura. */
export const PASSO_DO_MOTIVO_DA_LEITURA: Readonly<
  Record<MotivoDaLeitura, string>
> = {
  midia_clinica: PASSOS_DA_MIDIA.midiaClinica,
  documento_do_paciente: PASSOS_DA_MIDIA.documentoDoPaciente,
  midia_nao_identificada: PASSOS_DA_MIDIA.naoIdentificada,
};

/** Quanto o executor espera o download do arquivo (desenho 5.1, 7d). */
export const ESPERA_DO_DOWNLOAD_MS = 90_000;
/** De quanto em quanto o job volta enquanto espera. */
export const INTERVALO_DA_ESPERA_MS = 15_000;
/** Os segundos que a reserva conta para cada audio (o maximo aceito). */
export const SEGUNDOS_NA_RESERVA = LIMITES_DA_MIDIA.audio.maximoDeSegundos;
/** A transcricao conta como um texto deste tamanho nas estimativas. */
export const CARACTERES_DA_TRANSCRICAO_NA_RESERVA = 1000;

// ---------------------------------------------------------------------------
// O catalogo e a descricao do pedido
// ---------------------------------------------------------------------------

/**
 * A lista do Cadastro para o leitor: os procedimentos ativos com os codigos
 * do bloco <procedimentos> (os do indice e os que so a equipe marca).
 */
export function itensDoCatalogo(
  catalogo: Pick<CatalogoDoAgente, "procedimentos" | "procedimentosSoComAEquipe">,
): ItemDoCatalogoDaLeitura[] {
  return [
    ...catalogo.procedimentos,
    ...(catalogo.procedimentosSoComAEquipe ?? []),
  ].map((p) => ({ codigo: p.codigo, id: p.id, nome: p.nome }));
}

/** O nome do Cadastro numa linha, sem sinal de bloco. */
function nomeNumaLinha(nome: string): string {
  return nome
    .replace(/[\r\n\u2028\u2029\u0085\v\f]+/g, " ")
    .replace(/<{2,}|>{2,}/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "a, b e c". */
function emLista(itens: readonly string[]): string {
  if (itens.length <= 1) {
    return itens[0] ?? "";
  }
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** A descricao que o agente le ("p3 Hemograma, p7 Glicemia de jejum"). */
export function descricaoDoPedido(
  itens: readonly ItemDoCatalogoDaLeitura[],
): string {
  return DESCRICAO_DO_PEDIDO.replace("{}", () =>
    itens.map((i) => `${i.codigo} ${nomeNumaLinha(i.nome)}`).join(", "),
  );
}

/**
 * A maior descricao possivel com este catalogo (os 10 nomes mais longos):
 * a estimativa do gasto.
 */
export function descricaoMaxima(
  catalogo: readonly ItemDoCatalogoDaLeitura[],
): string {
  const maiores = [...catalogo]
    .sort(
      (a, b) =>
        Buffer.byteLength(`${b.codigo} ${b.nome}`) -
        Buffer.byteLength(`${a.codigo} ${a.nome}`),
    )
    .slice(0, 10);
  return descricaoDoPedido(maiores);
}

// ---------------------------------------------------------------------------
// A decisao pela leitura (a tabela 1.2) e o resumo
// ---------------------------------------------------------------------------

export type DecisaoDaLeitura =
  | {
      tipo: "segue";
      /** Os itens do Cadastro, na ordem do pedido. */
      itens: ItemDoCatalogoDaLeitura[];
      descricao: string;
    }
  | { tipo: "figurinha" }
  | { tipo: "escala"; motivo: MotivoDaLeitura };

/**
 * A decisao do SERVIDOR pela leitura do arquivo (desenho 1.2): o pedido com
 * 1 a 10 itens, todos no Cadastro de agora, nenhum fora e confianca alta ou
 * media segue com a IA; a figurinha com confianca alta ou media segue; o
 * resto passa para a equipe com o motivo da tabela. Nunca lanca.
 */
export function decidirPelaLeitura(
  leitura: Pick<
    LeituraGravada,
    "tipo" | "procedimentos" | "foraDoCadastro" | "confianca"
  >,
  catalogo: readonly ItemDoCatalogoDaLeitura[],
): DecisaoDaLeitura {
  const tipo = leitura.tipo;
  if (!(TIPOS_DO_LEITOR as readonly string[]).includes(tipo)) {
    return { tipo: "escala", motivo: "midia_nao_identificada" };
  }
  const confiavel =
    leitura.confianca === "alta" || leitura.confianca === "media";
  const decisao = DECISAO_DO_TIPO_DO_LEITOR[tipo as TipoDoLeitor];
  if (decisao !== "segue") {
    return { tipo: "escala", motivo: decisao };
  }
  if (tipo === "figurinha") {
    return confiavel
      ? { tipo: "figurinha" }
      : { tipo: "escala", motivo: "midia_nao_identificada" };
  }
  // O pedido.
  const porId = new Map(catalogo.map((c) => [c.id, c]));
  const itens = leitura.procedimentos.map((id) => porId.get(id));
  if (
    !confiavel ||
    leitura.foraDoCadastro !== 0 ||
    itens.length === 0 ||
    itens.length > 10 ||
    new Set(leitura.procedimentos).size !== leitura.procedimentos.length ||
    itens.some((item) => item === undefined)
  ) {
    return { tipo: "escala", motivo: "midia_nao_identificada" };
  }
  const achados = itens as ItemDoCatalogoDaLeitura[];
  return { tipo: "segue", itens: achados, descricao: descricaoDoPedido(achados) };
}

/** A prioridade entre os motivos (o clinico, o documento, o nao identificado). */
export function motivoMaisForte(
  motivos: readonly MotivoDaLeitura[],
): MotivoDaLeitura | null {
  return MOTIVOS_DA_LEITURA.find((m) => motivos.includes(m)) ?? null;
}

/**
 * O resumo que a equipe ve embaixo da foto ou do documento ("pedido com
 * Hemograma e Glicemia de jejum"), montado so com os nomes do Cadastro e os
 * textos fixos, ate 300 caracteres (acima: a contagem). A figurinha, de
 * qualquer confianca: nulo (o CHECK do banco; sem linha na bolha).
 */
export function resumoDaLeitura(
  leitura: Pick<
    LeituraGravada,
    "tipo" | "procedimentos" | "foraDoCadastro" | "confianca"
  >,
  catalogo: readonly ItemDoCatalogoDaLeitura[],
): string | null {
  const tipo = leitura.tipo;
  if (tipo === "pedido_de_exame_ou_procedimento") {
    if (leitura.confianca !== "alta" && leitura.confianca !== "media") {
      return RESUMO_DA_LEITURA.pedidoSemSeguranca;
    }
    if (leitura.foraDoCadastro > 0) {
      return RESUMO_DA_LEITURA.pedidoForaDoCadastro;
    }
    const porId = new Map(catalogo.map((c) => [c.id, c]));
    const nomes = leitura.procedimentos
      .map((id) => porId.get(id))
      .filter((c): c is ItemDoCatalogoDaLeitura => c !== undefined)
      .map((c) => nomeNumaLinha(c.nome));
    if (nomes.length === 0 || nomes.length !== leitura.procedimentos.length) {
      return RESUMO_DA_LEITURA.pedidoSemSeguranca;
    }
    const comNomes = RESUMO_DA_LEITURA.pedido.replace("{}", () =>
      emLista(nomes),
    );
    return Array.from(comNomes).length <= LIMITE_DO_RESUMO_DA_LEITURA
      ? comNomes
      : RESUMO_DA_LEITURA.pedidoComMuitosItens.replace("{}", () =>
          String(nomes.length),
        );
  }
  if (tipo === "figurinha") {
    return null;
  }
  if ((TIPOS_DO_LEITOR as readonly string[]).includes(tipo)) {
    return RESUMO_DA_LEITURA[tipo as Exclude<TipoDoLeitor, "pedido_de_exame_ou_procedimento" | "figurinha">];
  }
  return RESUMO_DA_LEITURA.outro;
}

// ---------------------------------------------------------------------------
// A leitura gravada vira mensagem (o historico e as pendentes)
// ---------------------------------------------------------------------------

/**
 * A mensagem do paciente com a leitura gravada aplicada: o audio transcrito
 * vira texto ("(áudio) ..." para o modelo; o texto original so para o
 * servidor), o pedido que segue vira texto com a descricao (a legenda e o
 * texto), a figurinha vira figurinha. O resto (sem fala, o arquivo clinico,
 * o documento, o nao identificado) continua midia: o marcador de sempre.
 */
export function mensagemComALeitura(
  mensagem: MensagemDaConversa,
  leitura: LeituraGravada,
  entrada: {
    catalogo: readonly ItemDoCatalogoDaLeitura[];
    mascarar: (texto: string) => string;
  },
): MensagemDaConversa {
  const midia = mensagem.midia;
  if (midia === undefined) {
    return mensagem;
  }
  const comLeitura: MensagemDaConversa = {
    ...mensagem,
    midia: { ...midia, situacao: "lida", leitura },
  };
  if (midia.midia === "audio") {
    if (leitura.tipo !== "transcricao" || leitura.transcricao === null) {
      return comLeitura;
    }
    return {
      ...comLeitura,
      tipo: "texto",
      origem: "audio",
      texto: entrada.mascarar(leitura.transcricao),
      textoOriginal: leitura.transcricao,
    };
  }
  const decisao = decidirPelaLeitura(leitura, entrada.catalogo);
  if (decisao.tipo === "figurinha") {
    return { ...comLeitura, tipo: "figurinha", texto: null };
  }
  if (decisao.tipo === "segue") {
    return {
      ...comLeitura,
      tipo: "texto",
      origem: "arquivo",
      texto: midia.legenda ?? "",
      textoOriginal: mensagem.legendaOriginal ?? "",
      arquivo: { descricao: decisao.descricao },
    };
  }
  return comLeitura;
}

/**
 * A mensagem pendente continua sem leitura de midia que valha (D-96): midia
 * sem leitura, "sem fala", ou conteudo que nao e texto (video, localizacao,
 * cartao). O arquivo lido (mesmo o clinico) e a figurinha contam como lidos.
 */
export function midiaNaoLida(mensagem: MensagemDaConversa): boolean {
  if (mensagem.autor !== "paciente") {
    return false;
  }
  const tipo = mensagem.tipo ?? "texto";
  if (tipo === "texto" || tipo === "figurinha") {
    return false;
  }
  const leitura = mensagem.midia?.leitura;
  return (
    mensagem.midia?.situacao !== "lida" ||
    leitura === undefined ||
    leitura.tipo === "sem_fala"
  );
}

// ---------------------------------------------------------------------------
// O plano do turno (7d)
// ---------------------------------------------------------------------------

export type EntradaDoPlano = {
  /** O historico do turno (as pendentes no fim), com `midia` nas do paciente. */
  mensagens: readonly MensagemDaConversa[];
  /** Os ids das pendentes (historico.pendentes). */
  pendentes: readonly string[];
  /** As habilidades na versao PUBLICADA. */
  habilidades: Readonly<Record<string, boolean>>;
  /** midia_da_ia_liberada (D-95): o telefone confirmou o aviso novo. */
  telefoneLiberado: boolean;
  /** As leituras ja gravadas, por message_id. null: a leitura falhou. */
  leituras: ReadonlyMap<string, LeituraGravada> | null;
  /** O modelo da transcricao vale e tem preco por minuto. */
  transcricaoComPreco: boolean;
  /** TRANSCRICAO_CALIBRADA (a prova paga). */
  transcricaoCalibrada: boolean;
  /** O leitor tem os tetos medidos, o modelo e o preco. */
  leitorPronto: boolean;
  catalogo: readonly ItemDoCatalogoDaLeitura[];
  /** Mascara o nome do contato (a transcricao lida). */
  mascarar: (texto: string) => string;
  agoraMs: number;
};

export type PlanoDaMidia = {
  /** O historico com as leituras aplicadas e a situacao nas pendentes. */
  mensagens: MensagemDaConversa[];
  /** Alguma pendente ainda baixando dentro da espera. */
  esperar: boolean;
  /** As pendentes que vao ao modelo. */
  aTranscrever: number;
  /** Os arquivos a ler (o pior caso de tokens de cada um, para a reserva). */
  aLer: { midia: MidiaLida; tokensDoArquivo: number }[];
  /** Alguma pendente do paciente continua sem leitura (D-96). */
  midiaNaoLida: boolean;
};

/** O arquivo da mensagem pela media_url. */
export function estadoDoArquivo(
  mediaUrl: string | null,
): MidiaDaConversa["arquivo"] {
  if (mediaUrl?.startsWith("storage://")) {
    return "pronto";
  }
  if (
    mediaUrl?.startsWith("indisponivel://") ||
    mediaUrl?.startsWith("seed://")
  ) {
    return "indisponivel";
  }
  return "baixando";
}

/** O pior caso de tokens do arquivo (imagem, ou PDF de 3 paginas). */
export function tokensDoArquivoNaReserva(
  midia: MidiaLida,
  mimetype: string | null,
  tetos: { imagem: number | null; pagina: number | null } = {
    imagem: TETO_DE_TOKENS_POR_IMAGEM,
    pagina: TETO_DE_TOKENS_POR_PAGINA,
  },
): number | null {
  if (midia === "audio") {
    return null;
  }
  const ehPdf = (mimetype ?? "").toLowerCase().startsWith("application/pdf");
  if (ehPdf) {
    return tetos.pagina === null
      ? null
      : tetos.pagina * LIMITES_DA_MIDIA.pdf.maximoDePaginas;
  }
  return tetos.imagem;
}

/**
 * O plano da midia do turno (desenho 5.1, 7d). PURO. Para cada midia
 * PENDENTE do paciente, uma situacao; para toda mensagem do recorte com
 * leitura gravada, a leitura aplicada (o arquivo nunca vai de novo). Fora:
 * a habilidade que nao vale na versao publicada, o telefone sem o aviso
 * novo, o tipo fora da lista pelo mimetype, mais de 3 no turno, sem preco
 * ou sem teto, a transcricao sem calibragem, o download que desistiu ou que
 * passou da espera, ou a leitura das leituras que falhou. O tamanho, a
 * duracao, as paginas e os primeiros bytes so a porta sabe, ao ler.
 */
export function planejarMidiasDoTurno(
  entrada: EntradaDoPlano,
  tetos?: { imagem: number | null; pagina: number | null },
): PlanoDaMidia {
  const pendentes = new Set(entrada.pendentes);
  let aTranscrever = 0;
  const aLer: PlanoDaMidia["aLer"] = [];
  let esperar = false;
  let contadas = 0;
  const mensagens = entrada.mensagens.map((mensagem): MensagemDaConversa => {
    const midia = mensagem.midia;
    if (midia === undefined || mensagem.autor !== "paciente") {
      return mensagem;
    }
    const pendente = pendentes.has(midia.messageId);
    const leitura = entrada.leituras?.get(midia.messageId);
    if (leitura !== undefined && leitura.midia === midia.midia) {
      return mensagemComALeitura(mensagem, leitura, entrada);
    }
    if (!pendente) {
      return mensagem;
    }
    const situacao = ((): SituacaoDaMidia => {
      if (entrada.leituras === null) {
        return "fora";
      }
      const habilidade =
        midia.midia === "audio"
          ? entrada.habilidades.ler_audio === true
          : entrada.habilidades.ler_imagem_e_documento === true;
      if (!habilidade || !entrada.telefoneLiberado) {
        return "fora";
      }
      if (midia.midia === "audio") {
        if (!entrada.transcricaoCalibrada || !entrada.transcricaoComPreco) {
          return "fora";
        }
      } else if (!entrada.leitorPronto) {
        return "fora";
      }
      contadas += 1;
      if (contadas > LIMITES_DA_MIDIA.porTurno) {
        return "fora";
      }
      if (midia.arquivo === "indisponivel") {
        return "fora";
      }
      if (midia.arquivo === "baixando") {
        const criada = Date.parse(midia.criadaEm);
        return Number.isFinite(criada) &&
          entrada.agoraMs - criada < ESPERA_DO_DOWNLOAD_MS
          ? "baixando"
          : "fora";
      }
      if (!mimetypeAceito(midia.midia, midia.mimetype)) {
        return "fora";
      }
      if (midia.midia === "audio") {
        return "a_transcrever";
      }
      return tokensDoArquivoNaReserva(midia.midia, midia.mimetype, tetos) ===
        null
        ? "fora"
        : "a_ler";
    })();
    if (situacao === "baixando") {
      esperar = true;
    } else if (situacao === "a_transcrever") {
      aTranscrever += 1;
    } else if (situacao === "a_ler") {
      aLer.push({
        midia: midia.midia,
        tokensDoArquivo:
          tokensDoArquivoNaReserva(midia.midia, midia.mimetype, tetos) ?? 0,
      });
    }
    return { ...mensagem, midia: { ...midia, situacao } };
  });
  return {
    mensagens,
    esperar,
    aTranscrever,
    aLer,
    midiaNaoLida: mensagens.some(
      (m) =>
        m.midia !== undefined &&
        pendentes.has(m.midia.messageId) &&
        midiaNaoLida(m),
    ),
  };
}

/** A midia que passou da espera (ou o portao ja escala): vira fora. */
export function semEspera(
  mensagens: readonly MensagemDaConversa[],
): MensagemDaConversa[] {
  return mensagens.map((m) =>
    m.midia?.situacao === "baixando"
      ? { ...m, midia: { ...m.midia, situacao: "fora" } }
      : m,
  );
}

/**
 * As mensagens como a estimativa do gasto as ve: cada audio a transcrever
 * como um texto de 1.000 caracteres (no pior caso de bytes), cada arquivo a
 * ler como a legenda com a maior descricao possivel.
 */
export function mensagensParaEstimativa(
  mensagens: readonly MensagemDaConversa[],
  catalogo: readonly ItemDoCatalogoDaLeitura[],
): MensagemDaConversa[] {
  const maxima = descricaoMaxima(catalogo);
  return mensagens.map((m): MensagemDaConversa => {
    const situacao = m.midia?.situacao;
    if (situacao === "a_transcrever") {
      // 4 bytes por caractere: o pior caso do UTF-8.
      const texto = "\u{1F5E3}".repeat(CARACTERES_DA_TRANSCRICAO_NA_RESERVA);
      return { ...m, tipo: "texto", origem: "audio", texto, textoOriginal: texto };
    }
    if (situacao === "a_ler") {
      return {
        ...m,
        tipo: "texto",
        origem: "arquivo",
        texto: m.midia?.legenda ?? "",
        textoOriginal: m.legendaOriginal ?? "",
        arquivo: { descricao: maxima },
      };
    }
    return m;
  });
}

// ---------------------------------------------------------------------------
// A porta da midia
// ---------------------------------------------------------------------------

/** A midia pendente que a porta le do Storage e prepara. */
export type MidiaParaPreparar = Pick<
  MidiaDaConversa,
  "messageId" | "midia" | "mediaUrl" | "mimetype"
>;

/** A midia lida e preparada (ou por que nao sai). */
export type MidiaPronta =
  | { tipo: "audio"; messageId: string; bytes: Uint8Array; segundos: number }
  | {
      tipo: "arquivo";
      messageId: string;
      midia: MidiaLida;
      arquivo: ArquivoParaOLeitor;
      /** As paginas do PDF (1 na imagem). */
      paginas: number;
    }
  | { tipo: "figurinha"; messageId: string; midia: MidiaLida }
  | { tipo: "fora"; messageId: string; motivo: string }
  | { tipo: "falhou"; messageId: string; codigo: string };

export type ResultadoDaTranscricao =
  | {
      tipo: "transcrita";
      /** O texto como o paciente falou (so o servidor). */
      texto: string;
      /** O texto com o nome do contato mascarado (o que os modelos leem). */
      textoParaOsModelos: string;
      leitura: LeituraGravada;
      uso: UsoDoModelo | null;
    }
  | { tipo: "sem_fala"; leitura: LeituraGravada; uso: UsoDoModelo | null }
  | { tipo: "falhou"; motivo: MotivoDaFalha; uso: UsoDoModelo | null }
  /** A gravacao recusou: a conversa saiu da IA (ou o job e antigo). */
  | { tipo: "fora_da_ia"; uso: UsoDoModelo | null };

export type ResultadoDaLeitura =
  | { tipo: "lido"; leitura: LeituraGravada; uso: UsoDoModelo | null }
  | { tipo: "falhou"; motivo: MotivoDaFalha; uso: UsoDoModelo | null }
  | { tipo: "fora_da_ia"; uso: UsoDoModelo | null };

/**
 * A porta da midia (contrato B2 interno): o laco so fala com o arquivo e com
 * os modelos de midia por aqui. O simulador passa null (D-62).
 */
export type PortaDaMidia = {
  /** Le do Storage e prepara (4.4) cada midia, sem modelo nenhum. */
  preparar(
    midias: readonly MidiaParaPreparar[],
    prazoMs: number,
  ): Promise<MidiaPronta[]>;
  /** Transcreve UM audio preparado e grava a leitura. */
  transcrever(
    audio: Extract<MidiaPronta, { tipo: "audio" }>,
    prazoMs: number,
  ): Promise<ResultadoDaTranscricao>;
  /** Le UM arquivo preparado (a figurinha, local) e grava a leitura. */
  ler(
    arquivo: Extract<MidiaPronta, { tipo: "arquivo" | "figurinha" }>,
    catalogo: readonly ItemDoCatalogoDaLeitura[],
    prazoMs: number,
  ): Promise<ResultadoDaLeitura>;
};

/** O que a porta do WhatsApp recebe do executor (as integracoes injetadas). */
export type DependenciasDaPortaDoWhatsapp = {
  clinicId: string;
  conversationId: string;
  jobId: string;
  workerId: string;
  /** Mascara o nome do contato (lib/agente/historico.ts, mascararNome). */
  mascarar: (texto: string) => string;
  /** lib/integrations/storage/arquivo-para-a-ia.ts, com o admin. */
  lerArquivo: (entrada: {
    messageId: string;
    mediaUrl: string | null;
    maximoDeBytes: number;
    prazoMs: number;
  }) => Promise<ArquivoDoStorage>;
  /** lib/integrations/llm/transcricao.ts (transcreverAudio, com o cliente). */
  transcrever: (entrada: {
    messageId: string;
    bytes: Uint8Array;
    segundosMedidos: number;
    prazoMs: number;
  }) => Promise<ResultadoDaTranscricaoNoModelo>;
  /** lib/integrations/llm/leitor-de-midia.ts (lerArquivoComOModelo). */
  lerComOModelo: (entrada: {
    messageId: string;
    midia: MidiaLida;
    arquivo: ArquivoParaOLeitor;
    catalogo: readonly ItemDoCatalogoDaLeitura[];
    prazoMs: number;
  }) => Promise<ResultadoDoLeitor>;
  /** VERSAO_DA_TRANSCRICAO (o modulo dela e server-only). */
  versaoDaTranscricao: string;
  /** O modelo do leitor, para estimar a chamada que falhou sem usage. */
  modeloDoLeitor: string;
};

/** A resposta de gravar_leitura_da_midia que o motor entende. */
type GravacaoDaLeitura =
  | { tipo: "gravada" }
  | { tipo: "reutilizada"; leitura: LeituraGravada }
  | { tipo: "fora_da_ia" }
  | { tipo: "recusada"; codigo: string };

/** Uma linha de leitura (do banco ou da RPC) no formato do motor, ou null. */
export function leituraDoBanco(valor: unknown): LeituraGravada | null {
  if (typeof valor !== "object" || valor === null) {
    return null;
  }
  const v = valor as Record<string, unknown>;
  const midia = v.midia;
  const tipo = v.tipo;
  if (
    typeof midia !== "string" ||
    !(MIDIAS_LIDAS as readonly string[]).includes(midia) ||
    typeof tipo !== "string" ||
    !(TIPOS_DE_MIDIA_LIDA as readonly string[]).includes(tipo)
  ) {
    return null;
  }
  const procedimentos = Array.isArray(v.procedimentos)
    ? v.procedimentos.filter((p): p is string => typeof p === "string")
    : [];
  const confianca =
    typeof v.confianca === "string" &&
    (CONFIANCAS_DA_LEITURA as readonly string[]).includes(v.confianca)
      ? (v.confianca as ConfiancaDaLeitura)
      : null;
  const segundos =
    typeof v.segundos_de_audio === "number" ? v.segundos_de_audio : null;
  const fora =
    typeof v.fora_do_cadastro === "number" && Number.isInteger(v.fora_do_cadastro)
      ? v.fora_do_cadastro
      : 0;
  const transcricao =
    typeof v.transcricao === "string" && v.transcricao !== ""
      ? v.transcricao
      : null;
  // Coerencia minima: a transcricao so no tipo transcricao; audio so com os
  // tipos do audio; arquivo so com os do leitor e com a confianca.
  const doAudio = tipo === "transcricao" || tipo === "sem_fala";
  if ((midia === "audio") !== doAudio) {
    return null;
  }
  if (tipo === "transcricao" && transcricao === null) {
    return null;
  }
  if (!doAudio && confianca === null) {
    return null;
  }
  return {
    midia: midia as MidiaLida,
    tipo: tipo as TipoDaMidiaLida,
    transcricao: tipo === "transcricao" ? transcricao : null,
    segundos,
    procedimentos,
    foraDoCadastro: fora,
    confianca: doAudio ? null : confianca,
    resumo: typeof v.resumo === "string" ? v.resumo : null,
  };
}

/** Os codigos de gravar_leitura_da_midia que dizem "a IA nao atende mais". */
const GRAVACAO_FORA_DA_IA: ReadonlySet<string> = new Set([
  "fora_da_ia",
  "job_antigo",
]);

async function gravarLeitura(
  admin: SupabaseClient,
  d: DependenciasDaPortaDoWhatsapp,
  e: {
    messageId: string;
    midia: MidiaLida;
    tipo: TipoDaMidiaLida;
    transcricao: string | null;
    segundos: number | null;
    procedimentos: string[];
    foraDoCadastro: number;
    confianca: ConfiancaDaLeitura | null;
    resumo: string | null;
    modelo: string;
    versao: string;
  },
): Promise<GravacaoDaLeitura> {
  try {
    const { data, error } = await admin.rpc("gravar_leitura_da_midia", {
      p_job_id: d.jobId,
      p_worker: d.workerId,
      p_message_id: e.messageId,
      p_midia: e.midia,
      p_tipo: e.tipo,
      p_transcricao: e.transcricao,
      p_segundos: e.segundos,
      p_procedimentos: e.procedimentos,
      p_fora_do_cadastro: e.foraDoCadastro,
      p_confianca: e.confianca,
      p_resumo: e.resumo,
      p_modelo: e.modelo,
      p_versao: e.versao,
    });
    if (error) {
      return {
        tipo: "recusada",
        codigo: (error as { code?: string }).code ?? "erro_do_banco",
      };
    }
    const r = data as {
      ok?: unknown;
      motivo?: unknown;
      reutilizado?: unknown;
      leitura?: unknown;
    } | null;
    if (r?.ok === true && r.reutilizado === false) {
      return { tipo: "gravada" };
    }
    if (r?.ok === true && r.reutilizado === true) {
      const leitura = leituraDoBanco(r.leitura);
      return leitura === null || leitura.midia !== e.midia
        ? { tipo: "recusada", codigo: "resposta_fora_do_formato" }
        : { tipo: "reutilizada", leitura };
    }
    const motivo = typeof r?.motivo === "string" ? r.motivo : "";
    if (r?.ok === false && GRAVACAO_FORA_DA_IA.has(motivo)) {
      return { tipo: "fora_da_ia" };
    }
    return {
      tipo: "recusada",
      codigo: r?.ok === false && /^[a-z_]{1,40}$/.test(motivo)
        ? motivo
        : "resposta_fora_do_formato",
    };
  } catch {
    return { tipo: "recusada", codigo: "excecao" };
  }
}

/**
 * A porta da midia do WhatsApp: as integracoes injetadas pelo executor e a
 * gravacao pela RPC, com a posse do job. Nunca lanca.
 */
export function portaDaMidiaDoWhatsapp(
  admin: SupabaseClient,
  d: DependenciasDaPortaDoWhatsapp,
): PortaDaMidia {
  const ids = (messageId: string) => ({
    clinic_id: d.clinicId,
    conversation_id: d.conversationId,
    job_id: d.jobId,
    message_id: messageId,
  });
  return {
    async preparar(midias, prazoMs) {
      return Promise.all(
        midias.map(async (m): Promise<MidiaPronta> => {
          try {
            const lido = await d.lerArquivo({
              messageId: m.messageId,
              mediaUrl: m.mediaUrl,
              maximoDeBytes:
                m.midia === "audio"
                  ? LIMITES_DA_MIDIA.audio.maximoDeBytes
                  : Math.max(
                      LIMITES_DA_MIDIA.imagem.maximoDeBytes,
                      LIMITES_DA_MIDIA.pdf.maximoDeBytes,
                    ),
              prazoMs,
            });
            if (lido.tipo === "grande_demais") {
              log.info("ia_midia_fora", {
                ...ids(m.messageId),
                kind: m.midia,
                error_code: "grande_demais",
              });
              return { tipo: "fora", messageId: m.messageId, motivo: "grande_demais" };
            }
            if (lido.tipo !== "ok") {
              const codigo = lido.tipo === "falhou" ? lido.codigo : lido.tipo;
              log.warn("ia_midia_nao_lida_do_storage", {
                ...ids(m.messageId),
                kind: m.midia,
                error_code: codigo,
              });
              return { tipo: "falhou", messageId: m.messageId, codigo };
            }
            const preparada = prepararMidia({
              midia: m.midia,
              bytes: lido.bytes,
              mimetype: m.mimetype,
            });
            if (preparada.tipo === "fora") {
              log.info("ia_midia_fora", {
                ...ids(m.messageId),
                kind: m.midia,
                error_code: preparada.motivo,
              });
              return {
                tipo: "fora",
                messageId: m.messageId,
                motivo: preparada.motivo,
              };
            }
            if (preparada.tipo === "audio") {
              return m.midia === "audio"
                ? {
                    tipo: "audio",
                    messageId: m.messageId,
                    bytes: preparada.bytes,
                    segundos: preparada.segundos,
                  }
                : { tipo: "fora", messageId: m.messageId, motivo: "formato" };
            }
            if (m.midia === "audio") {
              return { tipo: "fora", messageId: m.messageId, motivo: "formato" };
            }
            if (preparada.tipo === "figurinha") {
              return { tipo: "figurinha", messageId: m.messageId, midia: m.midia };
            }
            if (preparada.tipo === "pdf") {
              return {
                tipo: "arquivo",
                messageId: m.messageId,
                midia: m.midia,
                arquivo: { tipo: "pdf", bytes: preparada.bytes },
                paginas: preparada.paginas,
              };
            }
            return {
              tipo: "arquivo",
              messageId: m.messageId,
              midia: m.midia,
              arquivo: {
                tipo: "imagem",
                formato: preparada.formato,
                bytes: preparada.bytes,
              },
              paginas: 1,
            };
          } catch {
            return { tipo: "falhou", messageId: m.messageId, codigo: "excecao" };
          }
        }),
      );
    },

    async transcrever(audio, prazoMs) {
      const feito = await d.transcrever({
        messageId: audio.messageId,
        bytes: audio.bytes,
        segundosMedidos: audio.segundos,
        prazoMs,
      });
      const uso: UsoDoModelo | null =
        feito.uso === null
          ? null
          : {
              papel: "transcricao",
              modelo: feito.uso.modelo,
              uso: { ...USO_ZERADO },
              segundosDeAudio: feito.uso.segundos,
            };
      if (feito.tipo === "falhou") {
        return { tipo: "falhou", motivo: feito.motivo, uso };
      }
      const modelo = feito.uso?.modelo ?? "desconhecido";
      const leitura: LeituraGravada = {
        midia: "audio",
        tipo: feito.tipo === "transcrita" ? "transcricao" : "sem_fala",
        transcricao: feito.tipo === "transcrita" ? feito.texto : null,
        segundos: Math.min(150, Math.max(1, Math.ceil(feito.segundos))),
        procedimentos: [],
        foraDoCadastro: 0,
        confianca: null,
        resumo: null,
      };
      const gravada = await gravarLeitura(admin, d, {
        messageId: audio.messageId,
        midia: "audio",
        tipo: leitura.tipo,
        transcricao: leitura.transcricao,
        segundos: leitura.segundos,
        procedimentos: [],
        foraDoCadastro: 0,
        confianca: null,
        resumo: null,
        modelo,
        versao: d.versaoDaTranscricao,
      });
      if (gravada.tipo === "fora_da_ia") {
        return { tipo: "fora_da_ia", uso };
      }
      if (gravada.tipo === "recusada") {
        log.warn("ia_leitura_nao_gravada", {
          ...ids(audio.messageId),
          kind: "audio",
          error_code: gravada.codigo,
        });
        return { tipo: "falhou", motivo: "desconhecida", uso };
      }
      // A primeira leitura vale (o job repetido nunca regrava).
      const valendo = gravada.tipo === "reutilizada" ? gravada.leitura : leitura;
      if (valendo.tipo === "transcricao" && valendo.transcricao !== null) {
        return {
          tipo: "transcrita",
          texto: valendo.transcricao,
          textoParaOsModelos: d.mascarar(valendo.transcricao),
          leitura: valendo,
          uso,
        };
      }
      return { tipo: "sem_fala", leitura: valendo, uso };
    },

    async ler(arquivo, catalogo, prazoMs) {
      // A figurinha (D-98): local, sem modelo e sem custo.
      if (arquivo.tipo === "figurinha") {
        const leitura: LeituraGravada = {
          midia: arquivo.midia,
          tipo: "figurinha",
          transcricao: null,
          segundos: null,
          procedimentos: [],
          foraDoCadastro: 0,
          confianca: "alta",
          // O CHECK do banco: a figurinha nao tem resumo (sem linha na bolha).
          resumo: null,
        };
        const gravada = await gravarLeitura(admin, d, {
          ...leitura,
          messageId: arquivo.messageId,
          modelo: "local",
          versao: VERSAO_DA_FIGURINHA,
        });
        return resultadoDaGravacao(gravada, leitura, null, arquivo, ids);
      }
      const feito = await d.lerComOModelo({
        messageId: arquivo.messageId,
        midia: arquivo.midia,
        arquivo: arquivo.arquivo,
        catalogo,
        prazoMs,
      });
      const usoLido: UsoDoLlm | null =
        feito.uso ??
        (feito.tipo === "lido" || chamadaPodeTerSidoCobrada(feito.motivo)
          ? usoEstimadoDoLeitor({
              catalogo,
              tokensDoArquivo: tokensDoArquivoNaReserva(
                arquivo.midia,
                arquivo.arquivo.tipo === "pdf" ? "application/pdf" : "image/jpeg",
              ),
            })
          : null);
      const uso: UsoDoModelo | null =
        usoLido === null
          ? null
          : {
              papel: "leitor_de_midia",
              modelo: feito.modelo ?? d.modeloDoLeitor,
              uso: usoLido,
            };
      if (feito.tipo === "falha") {
        return { tipo: "falhou", motivo: feito.motivo, uso };
      }
      const leitura: LeituraGravada = {
        midia: arquivo.midia,
        tipo: feito.leitura.tipo,
        transcricao: null,
        segundos: null,
        procedimentos: feito.leitura.procedimentos,
        foraDoCadastro: feito.leitura.foraDoCadastro,
        confianca: feito.leitura.confianca,
        resumo: null,
      };
      leitura.resumo = resumoDaLeitura(leitura, catalogo);
      const gravada = await gravarLeitura(admin, d, {
        ...leitura,
        messageId: arquivo.messageId,
        modelo: feito.modelo,
        versao: VERSAO_DA_POLITICA_DO_LEITOR,
      });
      return resultadoDaGravacao(gravada, leitura, uso, arquivo, ids);
    },
  };
}

function resultadoDaGravacao(
  gravada: GravacaoDaLeitura,
  leitura: LeituraGravada,
  uso: UsoDoModelo | null,
  arquivo: { messageId: string; midia: MidiaLida },
  ids: (messageId: string) => Record<string, string>,
): ResultadoDaLeitura {
  if (gravada.tipo === "fora_da_ia") {
    return { tipo: "fora_da_ia", uso };
  }
  if (gravada.tipo === "recusada") {
    log.warn("ia_leitura_nao_gravada", {
      ...ids(arquivo.messageId),
      kind: arquivo.midia,
      error_code: gravada.codigo,
    });
    return { tipo: "falhou", motivo: "desconhecida", uso };
  }
  return {
    tipo: "lido",
    leitura: gravada.tipo === "reutilizada" ? gravada.leitura : leitura,
    uso,
  };
}

// ---------------------------------------------------------------------------
// A leitura do motor (7d): o portao do aviso e as leituras gravadas
// ---------------------------------------------------------------------------

/**
 * midia_da_ia_liberada (D-95): o telefone do contato confirmou o aviso novo
 * (versao 2). A funcao ausente (PGRST202, a migration nao aplicada), o erro
 * ou a resposta fora do formato: falso (nada sai). Nunca lanca.
 */
export async function telefoneLiberadoParaMidia(
  admin: SupabaseClient,
  entrada: { clinicId: string; telefone: string },
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("midia_da_ia_liberada", {
      p_clinic_id: entrada.clinicId,
      p_telefone: entrada.telefone,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * As leituras ja gravadas das midias do recorte (ia_leitura_da_midia por
 * message_id, da clinica e da conversa), pela service role. null em
 * qualquer erro (as pendentes ficam fora; as antigas, com o marcador).
 */
export async function lerLeiturasDoTurno(
  admin: SupabaseClient,
  entrada: { clinicId: string; conversationId: string; messageIds: string[] },
): Promise<Map<string, LeituraGravada> | null> {
  if (entrada.messageIds.length === 0) {
    return new Map();
  }
  try {
    const { data, error } = await admin
      .from("ia_leitura_da_midia")
      .select(
        "message_id, midia, tipo, transcricao, segundos_de_audio, procedimentos, fora_do_cadastro, confianca, resumo",
      )
      .eq("clinic_id", entrada.clinicId)
      .eq("conversation_id", entrada.conversationId)
      .in("message_id", entrada.messageIds);
    if (error) {
      return null;
    }
    const leituras = new Map<string, LeituraGravada>();
    for (const linha of (data ?? []) as Record<string, unknown>[]) {
      const leitura = leituraDoBanco(linha);
      if (typeof linha.message_id === "string" && leitura !== null) {
        leituras.set(linha.message_id, leitura);
      }
    }
    return leituras;
  } catch {
    return null;
  }
}
