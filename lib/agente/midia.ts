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
import { correrComPrazo } from "@/lib/domain/conformidade/prazo";
import {
  detectarUrgencia,
  type TipoDeUrgencia,
} from "@/lib/domain/conformidade/urgencia";
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
  FOLGA_DO_CORTE_DO_LEITOR_MS,
  MAXIMO_DE_CHAMADAS_DO_LEITOR,
  MAXIMO_DE_CODIGOS_NO_ESQUEMA,
  TETO_DE_TOKENS_POR_IMAGEM,
  TETO_DE_TOKENS_POR_PAGINA,
  VERSAO_DA_POLITICA_DO_LEITOR,
  type ArquivoParaOLeitor,
  type ItemDoCatalogoDaLeitura,
  type ResultadoDoLeitor,
} from "@/lib/integrations/llm/leitor-de-midia";
import { TENTATIVAS_EXTRAS } from "@/lib/integrations/llm/openai";
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
//
// Revisao da AG6b (30/10/2026, frente do motor):
//  - PRAZO: cada passo da porta (o preparo de cada midia, a transcricao e a
//    leitura de cada arquivo) tem corte duro (correrComPrazo) no prazo que
//    o laco deu, e o sinal do corte (junto com o do laco, se houver) vai as
//    integracoes. O Storage nunca recebe mais que PRAZO_MAXIMO_DO_STORAGE_MS.
//    A chamada cortada que pode ter sido cobrada entra com a estimativa.
//    Depois do corte, nada mais e feito (nem preparo, nem gravacao);
//  - LGPD: a leitura ja gravada so vale com a habilidade da midia ligada na
//    versao publicada E o telefone com o aviso novo (D-95). Sem eles, a
//    midia e tratada como nao lida (a transcricao antiga nunca vai ao
//    modelo como texto);
//  - o Cadastro acima de MAXIMO_DE_CODIGOS_NO_ESQUEMA deixa o arquivo fora
//    ja no plano, sem chamada (o motivo de sempre da midia nao lida);
//  - a gravacao recusada com job_antigo (D-A) volta como job_antigo, nunca
//    como a conversa fora da IA: o executor so conclui o job.
//
// Revisao da AG6b (30/10/2026, a juncao entre o leitor, a transcricao e o
// motor):
//  - OS CORTES EM ORDEM: a integracao do modelo (a transcricao e o leitor)
//    corta em prazo + a folga dela. A porta passa um prazo que poe esse
//    corte MARGEM_ENTRE_OS_CORTES_MS ANTES do corte da porta
//    (prazoParaAIntegracao): o resultado da integracao, com o uso e as
//    tentativasSemUso (a nova tentativa dela), sempre chega a porta. A porta
//    so corta a integracao que nao respeita nada, e ai estima o pior caso
//    (MAXIMO_DE_CHAMADAS_* chamadas, cada uma no pior caso);
//  - o GASTO da nova tentativa: o uso da ultima chamada e o pior caso de cada
//    chamada anterior sem resposta (a duracao medida, no audio; o teto do
//    arquivo, no leitor).
//
// Segunda rodada da revisao (R2 e R3 de d1a15f6):
//  - a URGENCIA lida pela transcricao no texto inteiro do audio, inclusive
//    o descartado pelas travas (R2, M3): a porta repassa so o tipo
//    (`urgencia` na transcrita e no sem fala), e o laco passa a conversa
//    como urgente. O texto descartado nunca chega aqui;
//  - a GRAVACAO da leitura tem uma fatia propria do prazo da porta
//    (RESERVA_DA_GRAVACAO_DA_LEITURA_MS, R3 1), descontada do prazo da
//    integracao: a integracao que responde no limite dela ainda deixa a RPC
//    gravar antes do corte da porta.
//
// Terceira rodada (revisao RR2 de 88e9560, a urgencia do audio em todos os
// caminhos):
//  - a urgencia que a transcricao leu vai tambem na FALHA que vem depois
//    dela (a gravacao da leitura recusada, o corte durante a RPC, o sinal
//    abortado): o laco passa a conversa como urgente (medio 2);
//  - a leitura NAO e gravada quando a urgencia veio so do texto descartado
//    (o sem fala urgente, ou a transcricao cujo texto mantido nao tem a
//    urgencia): o job repetido (a excecao antes do 'decidido', a posse
//    perdida, a invocacao que morreu) transcreve de novo e acha a urgencia
//    de novo. Com a urgencia no texto mantido, grava como sempre: o portao
//    do job repetido a acha no texto relido (medio 3; urgenciaDaTranscricao).

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
/**
 * O maximo que a porta pede ao Storage por arquivo (o mesmo valor de
 * PRAZO_DO_ARQUIVO_NO_STORAGE_MS, de lib/integrations/storage/arquivo-para-
 * a-ia.ts, que e server-only e nao entra aqui), por menor que seja o resto
 * do prazo da midia. PROPOSTA, sem medir (a prova paga, D-100, foi dispensada pelo dono em 06/11/2026).
 */
export const PRAZO_MAXIMO_DO_STORAGE_MS = 8_000;
/**
 * Revisao da AG6b (a juncao): o corte duro da integracao do modelo (prazo +
 * a folga dela) cai esta margem ANTES do corte da porta. A margem cobre o
 * relogio e a volta do resultado; sem ela, os dois cortes caiam no mesmo
 * instante (ou o da porta antes), e o resultado da integracao se perdia com
 * as tentativasSemUso (a porta estimava uma chamada, podendo ter sido duas).
 */
export const MARGEM_ENTRE_OS_CORTES_MS = 500;
/**
 * O que a porta e a reserva do laco sabem da transcricao, cujo modulo
 * (lib/integrations/llm/transcricao.ts) e server-only e nao entra aqui (como
 * PRAZO_MAXIMO_DO_STORAGE_MS): os mesmos valores de
 * FOLGA_DO_CORTE_DA_TRANSCRICAO_MS (o corte duro e o prazo mais isto) e de
 * MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO (a primeira e UMA nova tentativa, o pior
 * caso de um audio). Um teste confere que sao iguais
 * (tests/unit/conformidade/transcricao.test.ts).
 */
export const FOLGA_DO_CORTE_DA_TRANSCRICAO_NA_PORTA_MS = 500;
export const MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA = 1 + TENTATIVAS_EXTRAS;
/**
 * Revisao R3 de d1a15f6 (1): a fatia do prazo da porta que fica para a
 * gravacao da leitura (gravar_leitura_da_midia, que trava a mensagem e a
 * conversa), descontada do prazo da integracao. Antes, a integracao que
 * respondia no limite dela deixava so a margem (uns 1 s) para a RPC: a RPC
 * mais lenta que isso gravava DEPOIS do corte da porta, e a bolha mostrava a
 * leitura numa conversa cuja trilha dizia que a midia falhou. Com a fatia, a
 * RPC tem a margem e a fatia (2 s) ate o corte da porta. PROPOSTA, sem medir
 * (a prova paga, D-100, foi dispensada pelo dono em 06/11/2026), como os prazos da midia. A RPC que passa disso
 * (trava longa no banco) ainda pode gravar depois do corte: o corte e do
 * cliente, e a RPC que ja saiu nao volta.
 */
export const RESERVA_DA_GRAVACAO_DA_LEITURA_MS = 1_500;

/**
 * O prazo que a porta passa a integracao do modelo (a transcricao ou o
 * leitor), dado o prazo da porta e a folga do corte duro da integracao: o
 * corte da integracao (o prazo que ela recebe mais a folga dela) cai
 * MARGEM_ENTRE_OS_CORTES_MS mais RESERVA_DA_GRAVACAO_DA_LEITURA_MS antes do
 * corte da porta (a volta do resultado e a gravacao da leitura). Pode dar
 * menos que o minimo de uma chamada: a integracao entao nao chama nada
 * ("prazo", sem custo).
 */
export function prazoParaAIntegracao(
  prazoDaPortaMs: number,
  folgaDoCorteDaIntegracaoMs: number,
): number {
  return (
    prazoDaPortaMs -
    folgaDoCorteDaIntegracaoMs -
    MARGEM_ENTRE_OS_CORTES_MS -
    RESERVA_DA_GRAVACAO_DA_LEITURA_MS
  );
}

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
  /**
   * As habilidades na versao PUBLICADA. Valem tambem para a leitura ja
   * gravada (revisao da AG6b): com a habilidade da midia desligada, a
   * transcricao e a leitura antigas nao vao mais aos modelos.
   */
  habilidades: Readonly<Record<string, boolean>>;
  /**
   * midia_da_ia_liberada (D-95): o telefone confirmou o aviso novo. Vale
   * tambem para a leitura ja gravada (o telefone que voltou ao aviso versao
   * 1 nao manda mais a transcricao antiga aos modelos).
   */
  telefoneLiberado: boolean;
  /** As leituras ja gravadas, por message_id. null: a leitura falhou. */
  leituras: ReadonlyMap<string, LeituraGravada> | null;
  /** O modelo da transcricao vale e tem preco por minuto. */
  transcricaoComPreco: boolean;
  /** TRANSCRICAO_CALIBRADA. */
  transcricaoCalibrada: boolean;
  /** O leitor tem os tetos medidos, o modelo e o preco. */
  leitorPronto: boolean;
  /**
   * A lista do Cadastro do leitor (itensDoCatalogo). Acima de
   * MAXIMO_DE_CODIGOS_NO_ESQUEMA, todo arquivo fica fora (o leitor falharia
   * de qualquer jeito: o enum do esquema da saida nao cabe).
   */
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
 * A midia pode ir aos modelos neste turno (D-95): a habilidade dela ligada
 * na versao PUBLICADA e o telefone com o aviso novo. Vale para a midia a
 * ler E para a leitura ja gravada (revisao da AG6b, LGPD): sem isto, a
 * transcricao e o pedido lidos antes nunca vao aos modelos como texto.
 */
export function midiaLiberadaNoTurno(
  midia: MidiaLida,
  entrada: Pick<EntradaDoPlano, "habilidades" | "telefoneLiberado">,
): boolean {
  const habilidade =
    midia === "audio"
      ? entrada.habilidades.ler_audio === true
      : entrada.habilidades.ler_imagem_e_documento === true;
  return habilidade && entrada.telefoneLiberado;
}

/**
 * O plano da midia do turno (desenho 5.1, 7d). PURO. Para cada midia
 * PENDENTE do paciente, uma situacao; para toda mensagem do recorte com
 * leitura gravada, a leitura aplicada (o arquivo nunca vai de novo), SO com
 * a habilidade e o telefone valendo agora (midiaLiberadaNoTurno; sem eles,
 * a midia com leitura e tratada como a sem leitura: a antiga fica com o
 * marcador de sempre e a pendente fica fora). Fora: a habilidade que nao
 * vale na versao publicada, o telefone sem o aviso novo, o tipo fora da
 * lista pelo mimetype, mais de 3 no turno, sem preco ou sem teto, o
 * Cadastro grande demais para o leitor, a transcricao sem calibragem, o
 * download que desistiu ou que passou da espera, ou a leitura das leituras
 * que falhou. O tamanho, a duracao, as paginas e os primeiros bytes so a
 * porta sabe, ao ler.
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
    // Revisao da AG6b (LGPD): a habilidade e o telefone ANTES de
    // reaproveitar a leitura gravada.
    const liberada = midiaLiberadaNoTurno(midia.midia, entrada);
    const leitura = entrada.leituras?.get(midia.messageId);
    if (liberada && leitura !== undefined && leitura.midia === midia.midia) {
      return mensagemComALeitura(mensagem, leitura, entrada);
    }
    if (!pendente) {
      return mensagem;
    }
    const situacao = ((): SituacaoDaMidia => {
      if (entrada.leituras === null) {
        return "fora";
      }
      if (!liberada) {
        return "fora";
      }
      if (midia.midia === "audio") {
        if (!entrada.transcricaoCalibrada || !entrada.transcricaoComPreco) {
          return "fora";
        }
      } else if (
        !entrada.leitorPronto ||
        // Revisao da AG6b: o Cadastro que nao cabe no esquema do leitor.
        entrada.catalogo.length > MAXIMO_DE_CODIGOS_NO_ESQUEMA
      ) {
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
      /**
       * A leitura gravada (ou a reaproveitada). RR2 de 88e9560 (medio 3):
       * com a urgencia so no texto descartado, a leitura NAO foi gravada (o
       * job repetido transcreve de novo); o laco passa a conversa como
       * urgente do mesmo jeito.
       */
      leitura: LeituraGravada;
      uso: UsoDoModelo | null;
      /**
       * Revisao R2 de d1a15f6 (M3): o tipo da urgencia que a transcricao
       * leu no texto inteiro do audio, inclusive o que as travas
       * descartaram (o segmento urgente no ruido), ou null. So o tipo.
       * RR2 de 88e9560: tambem a do texto mantido (urgenciaDaTranscricao).
       */
      urgencia: TipoDeUrgencia | null;
    }
  | {
      tipo: "sem_fala";
      /** Como na transcrita: sem gravar quando ha urgencia (medio 3). */
      leitura: LeituraGravada;
      uso: UsoDoModelo | null;
      /**
       * Revisao R2 de d1a15f6 (M3): o tipo da urgencia no texto descartado
       * ("Quero morrer." curto e incerto, "Socorro..." no ruido), ou null.
       * O laco passa a conversa como urgente; o texto nunca chega aqui.
       */
      urgencia: TipoDeUrgencia | null;
    }
  | {
      tipo: "falhou";
      motivo: MotivoDaFalha;
      uso: UsoDoModelo | null;
      /**
       * RR2 de 88e9560 (medio 2): a urgencia que a transcricao JA tinha
       * lido quando o resto falhou (a gravacao da leitura recusada, o corte
       * da porta durante a RPC, o sinal abortado depois da transcricao). O
       * laco passa a conversa como urgente: a urgencia vence a falha
       * tecnica. Ausente quando a transcricao nao chegou a ser feita (ou
       * nao leu urgencia). So o tipo.
       */
      urgencia?: TipoDeUrgencia;
    }
  /** A gravacao recusou: a conversa saiu da IA (alguem assumiu). */
  | { tipo: "fora_da_ia"; uso: UsoDoModelo | null }
  /**
   * A gravacao recusou com job_antigo (D-A: o job e de antes da janela
   * atual; alguem assumiu e devolveu depois dele). O executor so conclui o
   * job: sem passagem, sem evento, sem frase e sem envio.
   */
  | { tipo: "job_antigo"; uso: UsoDoModelo | null };

export type ResultadoDaLeitura =
  | { tipo: "lido"; leitura: LeituraGravada; uso: UsoDoModelo | null }
  | { tipo: "falhou"; motivo: MotivoDaFalha; uso: UsoDoModelo | null }
  | { tipo: "fora_da_ia"; uso: UsoDoModelo | null }
  /** D-A, como na transcricao. */
  | { tipo: "job_antigo"; uso: UsoDoModelo | null };

/**
 * A porta da midia (contrato B2 interno): o laco so fala com o arquivo e com
 * os modelos de midia por aqui. O simulador passa null (D-62).
 *
 * Revisao da AG6b (prazo): cada metodo volta ate `prazoMs` (o corte duro e
 * da porta; o laco corta de novo com uma folga, para a porta que nao
 * cumprir) e repassa o `sinal` de quem chama (o corte do laco) as
 * integracoes. O sinal abortado e o prazo vencido sao a mesma coisa: nada
 * mais sai depois deles.
 */
export type PortaDaMidia = {
  /** Le do Storage e prepara (4.4) cada midia, sem modelo nenhum. */
  preparar(
    midias: readonly MidiaParaPreparar[],
    prazoMs: number,
    sinal?: AbortSignal,
  ): Promise<MidiaPronta[]>;
  /** Transcreve UM audio preparado e grava a leitura. */
  transcrever(
    audio: Extract<MidiaPronta, { tipo: "audio" }>,
    prazoMs: number,
    sinal?: AbortSignal,
  ): Promise<ResultadoDaTranscricao>;
  /** Le UM arquivo preparado (a figurinha, local) e grava a leitura. */
  ler(
    arquivo: Extract<MidiaPronta, { tipo: "arquivo" | "figurinha" }>,
    catalogo: readonly ItemDoCatalogoDaLeitura[],
    prazoMs: number,
    sinal?: AbortSignal,
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
  /**
   * lib/integrations/storage/arquivo-para-a-ia.ts, com o admin. `prazoMs`
   * nunca passa de PRAZO_MAXIMO_DO_STORAGE_MS; `sinal` aborta no corte.
   */
  lerArquivo: (entrada: {
    messageId: string;
    mediaUrl: string | null;
    maximoDeBytes: number;
    prazoMs: number;
    sinal?: AbortSignal;
  }) => Promise<ArquivoDoStorage>;
  /**
   * lib/integrations/llm/transcricao.ts (transcreverAudio, com o cliente).
   * `prazoMs` ja e o da integracao (prazoParaAIntegracao: o corte duro dela
   * cai antes do da porta, com a margem e a fatia da gravacao da leitura);
   * `sinal` aborta no corte da porta ou do laco, e a integracao termina na
   * hora. O resultado traz `urgencia` (so o tipo) quando o texto inteiro do
   * audio, inclusive o descartado, tem urgencia (revisao R2 de d1a15f6).
   */
  transcrever: (entrada: {
    messageId: string;
    bytes: Uint8Array;
    segundosMedidos: number;
    prazoMs: number;
    sinal?: AbortSignal;
  }) => Promise<ResultadoDaTranscricaoNoModelo>;
  /**
   * lib/integrations/llm/leitor-de-midia.ts (lerArquivoComOModelo). O prazo
   * e o sinal como na transcricao.
   */
  lerComOModelo: (entrada: {
    messageId: string;
    midia: MidiaLida;
    arquivo: ArquivoParaOLeitor;
    catalogo: readonly ItemDoCatalogoDaLeitura[];
    prazoMs: number;
    sinal?: AbortSignal;
  }) => Promise<ResultadoDoLeitor>;
  /** VERSAO_DA_TRANSCRICAO (o modulo dela e server-only). */
  versaoDaTranscricao: string;
  /** O modelo do leitor, para estimar a chamada que falhou sem usage. */
  modeloDoLeitor: string;
  /**
   * O modelo da transcricao, para estimar a chamada cortada (sem resposta).
   * Ausente ou nulo: "desconhecido" (o maior preco por minuto da tabela, o
   * lado seguro do teto).
   */
  modeloDaTranscricao?: string | null;
  /**
   * Os tetos de tokens do leitor (os da reserva do turno), para estimar a
   * chamada cortada. Ausentes: TETO_DE_TOKENS_POR_IMAGEM e _POR_PAGINA.
   */
  tetosDoLeitor?: { imagem: number | null; pagina: number | null };
};

/** A resposta de gravar_leitura_da_midia que o motor entende. */
type GravacaoDaLeitura =
  | { tipo: "gravada" }
  | { tipo: "reutilizada"; leitura: LeituraGravada }
  | { tipo: "fora_da_ia" }
  | { tipo: "job_antigo" }
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

/**
 * Os codigos de gravar_leitura_da_midia que dizem "a IA nao atende mais"
 * (alguem assumiu, resolveu, ou a conversa ja passou). O job_antigo (D-A)
 * tem o proprio braco: o job esta morto e so conclui.
 */
const GRAVACAO_FORA_DA_IA: ReadonlySet<string> = new Set(["fora_da_ia"]);

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
    if (r?.ok === false && motivo === "job_antigo") {
      return { tipo: "job_antigo" };
    }
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
 * O sinal que vai as integracoes: aborta no corte da porta OU no de quem
 * chama (o laco), o que vier primeiro.
 */
function sinalDoCorte(
  corte: AbortSignal,
  deQuemChama: AbortSignal | undefined,
): AbortSignal {
  return deQuemChama === undefined
    ? corte
    : AbortSignal.any([corte, deQuemChama]);
}

/**
 * As chamadas ANTERIORES a ultima que a integracao fez, que falharam sem
 * resposta e podem ter sido cobradas (`tentativasSemUso` do leitor e da
 * transcricao: a nova tentativa delas). Pelos tipos das integracoes
 * (renomear o campo quebra aqui), mas sem confiar no valor: ausente ou
 * estranho, 0; nunca mais que as chamadas que a integracao pode fazer antes
 * da ultima.
 */
function tentativasSemUsoDe(
  feito: ResultadoDoLeitor | ResultadoDaTranscricaoNoModelo,
  maximoDeChamadas: number,
): number {
  const valor: unknown = feito.tentativasSemUso;
  return typeof valor === "number" && Number.isInteger(valor) && valor > 0
    ? Math.min(valor, Math.max(0, maximoDeChamadas - 1))
    : 0;
}

/** O pior caso de `vezes` chamadas iguais (os tokens somados). */
function usoRepetido(uso: UsoDoLlm, vezes: number): UsoDoLlm | null {
  return somarUsos(Array.from({ length: Math.max(0, vezes) }, () => uso));
}

/** As chamadas de uma leitura numa linha so (os tokens somados). */
function somarUsos(usos: readonly (UsoDoLlm | null)[]): UsoDoLlm | null {
  const presentes = usos.filter((u): u is UsoDoLlm => u !== null);
  if (presentes.length === 0) {
    return null;
  }
  return presentes.reduce((a, b) => ({
    tokensEntrada: a.tokensEntrada + b.tokensEntrada,
    tokensSaida: a.tokensSaida + b.tokensSaida,
    tokensCacheLidos: a.tokensCacheLidos + b.tokensCacheLidos,
    tokensCacheGravados: a.tokensCacheGravados + b.tokensCacheGravados,
  }));
}

/**
 * RR2 de 88e9560 (medio 2 e 3): a urgencia que ESTA transcricao leu, e se
 * ela esta no texto MANTIDO (o que a leitura grava e o portao do job
 * repetido rele como texto; o portao le cada mensagem sozinha com o mesmo
 * detectarUrgencia, e a juncao com as outras so acrescenta).
 *  - `tipo`: a da integracao (o texto inteiro, inclusive o descartado) ou,
 *    sem ela, a do texto mantido (a excecao lida num segmento descartado
 *    pode apagar no texto inteiro o sinal que o mantido tem: "fiz botox e"
 *    no ruido, "minha boca ficou torta" na fala);
 *  - `soNoDescartado`: ha urgencia e o texto mantido nao a tem (o sem fala
 *    nao tem texto mantido). Ai a leitura NAO e gravada: gravada, o job
 *    repetido le a transcricao (ou o sem fala) sem a urgencia e nao
 *    transcreve de novo; sem ela, transcreve de novo e acha de novo (o
 *    custo e uma transcricao a mais, so neste caso raro).
 * Local (a lista deterministica), sem rede. So o tipo sai daqui.
 */
export function urgenciaDaTranscricao(
  feito: Extract<
    ResultadoDaTranscricaoNoModelo,
    { tipo: "transcrita" | "sem_fala" }
  >,
): { tipo: TipoDeUrgencia | null; soNoDescartado: boolean } {
  const noTextoMantido =
    feito.tipo === "transcrita"
      ? (detectarUrgencia([feito.texto])?.tipo ?? null)
      : null;
  const tipo = feito.urgencia ?? noTextoMantido;
  return { tipo, soNoDescartado: tipo !== null && noTextoMantido === null };
}

/**
 * O uso da transcricao como ia_uso le (o papel, tokens 0, os segundos): o
 * da ultima chamada (a integracao ja estima a que falhou e pode ter sido
 * cobrada) mais o pior caso de cada chamada anterior sem resposta
 * (`tentativasSemUso`), a duracao medida no preparo.
 */
function usoDaTranscricaoNoModelo(
  feito: ResultadoDaTranscricaoNoModelo,
  estimativa: { modelo: string; segundosPorChamada: number },
): UsoDoModelo | null {
  const anteriores =
    tentativasSemUsoDe(feito, MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA) *
    estimativa.segundosPorChamada;
  if (feito.uso === null && anteriores === 0) {
    return null;
  }
  return {
    papel: "transcricao",
    modelo: feito.uso?.modelo ?? estimativa.modelo,
    uso: { ...USO_ZERADO },
    segundosDeAudio: (feito.uso?.segundos ?? 0) + anteriores,
  };
}

/**
 * A porta da midia do WhatsApp: as integracoes injetadas pelo executor e a
 * gravacao pela RPC, com a posse do job. Nunca lanca.
 *
 * Revisao da AG6b (prazo): o preparo de CADA midia, a transcricao e a
 * leitura correm com corte duro (correrComPrazo) em `prazoMs`, e o sinal do
 * corte (junto com o de quem chama) vai as integracoes. O Storage recebe no
 * maximo PRAZO_MAXIMO_DO_STORAGE_MS. A transcricao e o leitor recebem
 * prazoParaAIntegracao (o corte duro deles cai MARGEM_ENTRE_OS_CORTES_MS e
 * RESERVA_DA_GRAVACAO_DA_LEITURA_MS antes do desta porta), entao o
 * resultado deles, com o uso e as tentativasSemUso, sempre chega, e a
 * gravacao da leitura cabe antes do corte. Cortada mesmo assim (a
 * integracao que nao respeita nada), a chamada ao modelo entra com o uso
 * que ela devolveu (se voltou) ou com o pior caso (MAXIMO_DE_CHAMADAS_*
 * chamadas, cada uma no pior caso), e nada mais e feito depois do corte
 * (nem o preparo, nem a gravacao da leitura).
 *
 * RR2 de 88e9560: a urgencia que a transcricao leu volta em TODO resultado
 * que vem depois dela, inclusive a falha (a gravacao recusada, o corte
 * durante a RPC); e a leitura com a urgencia so no texto descartado nao e
 * gravada (urgenciaDaTranscricao).
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
  /** O log do corte: so os ids, a midia e o codigo. */
  const logDoCorte = (
    messageId: string,
    midia: MidiaLida,
    corrida: { tipo: "prazo" | "erro" | "resultado" },
  ) =>
    log.warn("ia_midia_cortada", {
      ...ids(messageId),
      kind: midia,
      error_code: corrida.tipo === "erro" ? "excecao" : "prazo",
    });
  /** O modelo da transcricao para a estimativa (sem ele, o maior preco). */
  const modeloDaEstimativa = () =>
    d.modeloDaTranscricao?.trim() || "desconhecido";
  /** Uma chamada da transcricao no pior caso: os segundos medidos. */
  const segundosDeUmaChamada = (
    audio: Extract<MidiaPronta, { tipo: "audio" }>,
  ) => Math.max(1, Math.ceil(audio.segundos));
  /**
   * A transcricao que a porta cortou sem resposta (a integracao que nao
   * respeita nada): o pior caso, MAXIMO_DE_CHAMADAS chamadas pelos segundos
   * medidos no preparo (nao se sabe quantas sairam).
   */
  const usoEstimadoDaTranscricao = (
    audio: Extract<MidiaPronta, { tipo: "audio" }>,
  ): UsoDoModelo => ({
    papel: "transcricao",
    modelo: modeloDaEstimativa(),
    uso: { ...USO_ZERADO },
    segundosDeAudio:
      MAXIMO_DE_CHAMADAS_DA_TRANSCRICAO_NA_PORTA * segundosDeUmaChamada(audio),
  });
  /** Uma chamada do leitor no pior caso: o teto do arquivo (a reserva). */
  const usoEstimadoDaLeitura = (
    arquivo: Extract<MidiaPronta, { tipo: "arquivo" }>,
    catalogo: readonly ItemDoCatalogoDaLeitura[],
  ): UsoDoLlm | null =>
    usoEstimadoDoLeitor({
      catalogo,
      tokensDoArquivo: tokensDoArquivoNaReserva(
        arquivo.midia,
        arquivo.arquivo.tipo === "pdf" ? "application/pdf" : "image/jpeg",
        d.tetosDoLeitor ?? {
          imagem: TETO_DE_TOKENS_POR_IMAGEM,
          pagina: TETO_DE_TOKENS_POR_PAGINA,
        },
      ),
    });

  /** Le UMA midia do Storage e a prepara (4.4). Para no sinal. */
  const lerEPreparar = async (
    m: MidiaParaPreparar,
    prazoMs: number,
    sinal: AbortSignal,
  ): Promise<MidiaPronta> => {
    if (sinal.aborted) {
      return { tipo: "falhou", messageId: m.messageId, codigo: "prazo" };
    }
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
      // Revisao da AG6b: o Storage nunca recebe o prazo inteiro da midia.
      prazoMs: Math.min(PRAZO_MAXIMO_DO_STORAGE_MS, prazoMs),
      sinal,
    });
    if (sinal.aborted) {
      // O corte ja respondeu: o preparo nao roda depois dele.
      return { tipo: "falhou", messageId: m.messageId, codigo: "prazo" };
    }
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
  };

  return {
    async preparar(midias, prazoMs, sinal) {
      return Promise.all(
        midias.map(async (m): Promise<MidiaPronta> => {
          // O corte duro de cada midia (o Storage e o preparo): a excecao
          // e o prazo viram "falhou" (falha fechada, a conversa passa).
          const corrida = await correrComPrazo(
            (corte) => lerEPreparar(m, prazoMs, sinalDoCorte(corte, sinal)),
            prazoMs,
          );
          if (corrida.tipo === "resultado") {
            return corrida.valor;
          }
          logDoCorte(m.messageId, m.midia, corrida);
          return {
            tipo: "falhou",
            messageId: m.messageId,
            codigo: corrida.tipo === "erro" ? "excecao" : "prazo",
          };
        }),
      );
    },

    async transcrever(audio, prazoMs, sinal) {
      if (sinal?.aborted === true) {
        // Nada saiu: sem uso.
        return { tipo: "falhou", motivo: "timeout", uso: null };
      }
      // O uso da chamada assim que ela volta (undefined: nao voltou).
      let usoDaChamada: UsoDoModelo | null | undefined;
      // RR2 de 88e9560 (medio 2): a urgencia que a transcricao leu, assim
      // que ela volta. Vai tambem na falha que vem DEPOIS da transcricao (a
      // gravacao recusada, o corte da porta durante a RPC, o sinal
      // abortado): a emergencia dita no audio nunca vira so falha tecnica.
      let urgenciaDaChamada: TipoDeUrgencia | null = null;
      const comAUrgencia = (): { urgencia?: TipoDeUrgencia } =>
        urgenciaDaChamada === null ? {} : { urgencia: urgenciaDaChamada };
      const corrida = await correrComPrazo(
        async (corte): Promise<ResultadoDaTranscricao | null> => {
          const sinalDaChamada = sinalDoCorte(corte, sinal);
          const feito = await d.transcrever({
            messageId: audio.messageId,
            bytes: audio.bytes,
            segundosMedidos: audio.segundos,
            // O corte duro da transcricao cai antes do desta porta: o
            // resultado (com as tentativas sem uso) sempre volta.
            prazoMs: prazoParaAIntegracao(
              prazoMs,
              FOLGA_DO_CORTE_DA_TRANSCRICAO_NA_PORTA_MS,
            ),
            sinal: sinalDaChamada,
          });
          const uso = usoDaTranscricaoNoModelo(feito, {
            modelo: modeloDaEstimativa(),
            segundosPorChamada: segundosDeUmaChamada(audio),
          });
          usoDaChamada = uso;
          if (feito.tipo === "falhou") {
            return { tipo: "falhou", motivo: feito.motivo, uso };
          }
          const urgencia = urgenciaDaTranscricao(feito);
          urgenciaDaChamada = urgencia.tipo;
          if (sinalDaChamada.aborted) {
            // O corte ja respondeu (com a urgencia acima, se ja tinha
            // voltado): a leitura nao e gravada depois dele.
            return null;
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
          if (urgencia.soNoDescartado) {
            // RR2 de 88e9560 (medio 3): a urgencia veio so do texto
            // descartado. A leitura NAO e gravada (nenhuma coluna guarda a
            // urgencia): o job repetido transcreve de novo e acha de novo. O
            // laco passa a conversa como urgente; a bolha fica sem a linha
            // da leitura (a equipe ouve o audio). Nada disto vai para log
            // (a urgencia e dado de saude).
            return feito.tipo === "transcrita"
              ? {
                  tipo: "transcrita",
                  texto: feito.texto,
                  textoParaOsModelos: d.mascarar(feito.texto),
                  leitura,
                  uso,
                  urgencia: urgencia.tipo,
                }
              : { tipo: "sem_fala", leitura, uso, urgencia: urgencia.tipo };
          }
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
          if (gravada.tipo === "job_antigo") {
            return { tipo: "job_antigo", uso };
          }
          if (gravada.tipo === "fora_da_ia") {
            return { tipo: "fora_da_ia", uso };
          }
          if (gravada.tipo === "recusada") {
            log.warn("ia_leitura_nao_gravada", {
              ...ids(audio.messageId),
              kind: "audio",
              error_code: gravada.codigo,
            });
            // RR2 de 88e9560 (medio 2): a urgencia ja lida vai junto.
            return {
              tipo: "falhou",
              motivo: "desconhecida",
              uso,
              ...comAUrgencia(),
            };
          }
          // A primeira leitura vale (o job repetido nunca regrava).
          const valendo =
            gravada.tipo === "reutilizada" ? gravada.leitura : leitura;
          // Revisao R2 de d1a15f6 (M3): a urgencia que ESTA chamada leu no
          // texto inteiro do audio (so o tipo), qualquer que seja a leitura
          // que vale: ela so acrescenta a marca de urgente.
          if (valendo.tipo === "transcricao" && valendo.transcricao !== null) {
            return {
              tipo: "transcrita",
              texto: valendo.transcricao,
              textoParaOsModelos: d.mascarar(valendo.transcricao),
              leitura: valendo,
              uso,
              urgencia: urgencia.tipo,
            };
          }
          return {
            tipo: "sem_fala",
            leitura: valendo,
            uso,
            urgencia: urgencia.tipo,
          };
        },
        prazoMs,
      );
      if (corrida.tipo === "resultado" && corrida.valor !== null) {
        return corrida.valor;
      }
      logDoCorte(audio.messageId, "audio", corrida);
      return {
        tipo: "falhou",
        motivo: corrida.tipo === "erro" ? "desconhecida" : "timeout",
        // A chamada saiu e pode ter sido cobrada: o uso que voltou (com as
        // tentativas sem uso), ou o pior caso pelos segundos medidos (a
        // integracao que nao respeitou o proprio corte).
        uso:
          usoDaChamada !== undefined
            ? usoDaChamada
            : usoEstimadoDaTranscricao(audio),
        // RR2 de 88e9560 (medio 2): a transcricao voltou antes do corte (o
        // corte caiu na gravacao da leitura, ou o sinal abortou depois
        // dela): a urgencia que ela leu vai junto.
        ...comAUrgencia(),
      };
    },

    async ler(arquivo, catalogo, prazoMs, sinal) {
      if (sinal?.aborted === true) {
        return { tipo: "falhou", motivo: "timeout", uso: null };
      }
      let usoDaChamada: UsoDoModelo | null | undefined;
      const corrida = await correrComPrazo(
        async (corte): Promise<ResultadoDaLeitura | null> => {
          const sinalDaChamada = sinalDoCorte(corte, sinal);
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
              // O CHECK do banco: a figurinha nao tem resumo (sem linha na
              // bolha).
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
            // O corte duro do leitor cai antes do desta porta: o resultado
            // (com as tentativas sem uso) sempre volta.
            prazoMs: prazoParaAIntegracao(prazoMs, FOLGA_DO_CORTE_DO_LEITOR_MS),
            sinal: sinalDaChamada,
          });
          // A ultima chamada (o uso que voltou, ou o pior caso se ela pode ter
          // sido cobrada) e, pelo leitor com a nova tentativa, o pior caso de
          // cada chamada anterior que saiu sem resposta.
          const estimado = usoEstimadoDaLeitura(arquivo, catalogo);
          const usoLido: UsoDoLlm | null = somarUsos([
            feito.uso ??
              (feito.tipo === "lido" || chamadaPodeTerSidoCobrada(feito.motivo)
                ? estimado
                : null),
            estimado === null
              ? null
              : usoRepetido(
                  estimado,
                  tentativasSemUsoDe(feito, MAXIMO_DE_CHAMADAS_DO_LEITOR),
                ),
          ]);
          const uso: UsoDoModelo | null =
            usoLido === null
              ? null
              : {
                  papel: "leitor_de_midia",
                  modelo: feito.modelo ?? d.modeloDoLeitor,
                  uso: usoLido,
                };
          usoDaChamada = uso;
          if (feito.tipo === "falha") {
            return { tipo: "falhou", motivo: feito.motivo, uso };
          }
          if (sinalDaChamada.aborted) {
            // O corte ja respondeu: a leitura nao e gravada depois dele.
            return null;
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
        prazoMs,
      );
      if (corrida.tipo === "resultado" && corrida.valor !== null) {
        return corrida.valor;
      }
      logDoCorte(arquivo.messageId, arquivo.midia, corrida);
      let uso: UsoDoModelo | null = null;
      if (usoDaChamada !== undefined) {
        uso = usoDaChamada;
      } else if (arquivo.tipo === "arquivo") {
        // O leitor nao respeitou o proprio corte (que cai antes deste): nao
        // se sabe quantas chamadas sairam. O pior caso, MAXIMO_DE_CHAMADAS_
        // DO_LEITOR chamadas, cada uma com o teto do arquivo.
        const estimado = usoEstimadoDaLeitura(arquivo, catalogo);
        const piorCaso =
          estimado === null
            ? null
            : usoRepetido(estimado, MAXIMO_DE_CHAMADAS_DO_LEITOR);
        uso =
          piorCaso === null
            ? null
            : { papel: "leitor_de_midia", modelo: d.modeloDoLeitor, uso: piorCaso };
      }
      return {
        tipo: "falhou",
        motivo: corrida.tipo === "erro" ? "desconhecida" : "timeout",
        uso,
      };
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
  if (gravada.tipo === "job_antigo") {
    return { tipo: "job_antigo", uso };
  }
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
