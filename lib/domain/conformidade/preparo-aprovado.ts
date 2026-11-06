// O preparo do procedimento aprovado pelo responsavel tecnico (RT), pronto
// para o envio (AG7; D-80, autorizada pelo dono em 03/11/2026). SERVIDOR:
// importa o filtro (node:crypto) e as regras deterministicas.
//
// Tres travas, no molde do TextoAprovado (texto-aprovado.ts):
//  1. o tipo marcado PreparoAprovado, que SO sai de aprovarParaEnvio: a
//     leitura de ler_preparo_para_envio (a mensagem que o banco montou da
//     versao em vigor e o sha256 que o banco calculou) conferida aqui;
//  2. a conferencia do sha256 logo antes do provedor (send.ts);
//  3. o gatilho de message, que remonta a mensagem da versao em vigor e
//     compara (migration 20261103100000).
// A mensagem do preparo NAO passa pelo filtro de saida (ele barraria o jejum
// de proposito) e nunca vira TextoAprovado: e texto do sistema, nao da IA. O
// teste tests/unit/conformidade/preparo-aprovado.test.ts varre o codigo e
// falha com conversao para PreparoAprovado fora daqui.
//
// Aqui tambem moram:
//  - problemasDoTextoDoPreparo: as regras do filtro sobre o texto que a
//    clinica escreve, para a Server Action (recusa antes da RPC) e para o
//    dialogo de aprovacao (o aviso de remedio, dose ou jejum). A tela recebe
//    o resultado pronto do servidor: o navegador nunca importa o filtro;
//  - a reexportacao de trechoDePreparoNaResposta (lib/domain/preparo.ts),
//    a regra que barra a resposta da IA que copia um trecho do texto da
//    clinica. Ela mora no modulo puro porque o filtro deterministico a chama,
//    e este arquivo importa o filtro (o ciclo de import ficaria fechado).

import {
  CATEGORIAS_DE_CONFORMIDADE,
  ordenarPorPrioridade,
  type CategoriaDeConformidade,
} from "@/lib/domain/conformidade/categorias";
import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import {
  avaliarRegras,
  FONTE_DO_QUE_A_INTRODUCAO_NAO_DIZ,
  type AchadoDaRegra,
} from "@/lib/domain/conformidade/filtro-deterministico";
import { normalizarBase } from "@/lib/domain/conformidade/normalizar";
import {
  conselhoDaLinhaDoRt,
  CONSELHOS_DE_REMEDIO_E_DOSE,
  corpoComIntroducao,
  frasesDoBanco,
  frasesParaORecorte,
  introducaoNoFormato,
  nomesDeRemedioDoTexto,
  normalizaSintoma,
  ofereceOutroProcedimento,
  partesDaMensagemDoPreparo,
  regexDoBanco,
  semOQueNaoERemedioNemDose,
  textoRecusadoPeloBanco,
} from "@/lib/domain/preparo";

export {
  TAMANHO_MINIMO_DO_TRECHO,
  trechoDePreparoNaResposta,
} from "@/lib/domain/preparo";

// ---------------------------------------------------------------------------
// O tipo marcado
// ---------------------------------------------------------------------------

declare const marcaDoPreparoAprovado: unique symbol;

export type PreparoAprovado = {
  readonly mensagem: string;
  readonly sha256: string;
  readonly versaoId: string;
  readonly procedureId: string;
  readonly versao: number;
  readonly [marcaDoPreparoAprovado]: "PreparoAprovado";
};

/** O teto de uma mensagem do WhatsApp (D-84: a do preparo fica abaixo). */
export const LIMITE_DA_MENSAGEM_DO_PREPARO = 4096;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;

type PreparoSemMarca = Omit<PreparoAprovado, typeof marcaDoPreparoAprovado>;

// A UNICA conversao para PreparoAprovado no codigo inteiro. Nao exportada.
function marcar(preparo: PreparoSemMarca): PreparoAprovado {
  return Object.freeze({ ...preparo }) as PreparoAprovado;
}

/**
 * O que a conferencia do envio decide (conferirParaEnvio):
 *  - pronto: o PreparoAprovado, congelado;
 *  - fora_do_formato: a leitura nao confere (campo, hash, tamanho, formato
 *    da mensagem); nada sai;
 *  - recusado: revisao da AG7 (CFM-2) o texto aprovado tem o que NUNCA pode
 *    ir ao paciente, nem aprovado pelo RT (promessa, oferta casada, antes e
 *    depois, preco, link: as recusas de problemasDoTextoDoPreparo). Nada
 *    sai; quem chama grava o motivo (as categorias, nunca o texto).
 */
export type ConferenciaDoEnvio =
  | { tipo: "pronto"; preparo: PreparoAprovado }
  | { tipo: "fora_do_formato" }
  | {
      tipo: "recusado";
      recusas: readonly CategoriaDeConformidade[];
      versaoId: string;
      procedureId: string;
    };

/**
 * A leitura de ler_preparo_para_envio ({versao_id, procedure_id, versao,
 * mensagem, sha256}) conferida, ou null (quem chama passa a conversa para a
 * equipe; nada sai). Recebe unknown de proposito: confere cada campo. A
 * mesma conferencia de conferirParaEnvio, sem dizer o motivo.
 */
export function aprovarParaEnvio(lido: unknown): PreparoAprovado | null {
  const conferido = conferirParaEnvio(lido);
  return conferido.tipo === "pronto" ? conferido.preparo : null;
}

/**
 * A conferencia da leitura de ler_preparo_para_envio, com o motivo:
 *  - versao_id e procedure_id sao uuid; versao e inteiro de 1 para cima;
 *  - sha256 tem 64 hexadecimais e e o sha256 do UTF-8 da mensagem (o mesmo
 *    calculo do banco, sha256DoTexto);
 *  - a mensagem tem de 1 a 4.096 caracteres e o formato da mensagem do
 *    preparo: comeca pelo cabecalho, tem a linha do RT, o texto e termina no
 *    rodape (partesDaMensagemDoPreparo);
 *  - revisao da AG7 (CFM-2): o TEXTO aprovado (o miolo da mensagem) nao tem
 *    recusa de problemasDoTextoDoPreparo. O banco so confere o formato; o
 *    texto que chegou aguardando o RT por outro caminho (a copia do texto
 *    antigo, a RPC chamada direto) e foi aprovado nunca sai com promessa,
 *    oferta casada, antes e depois, preco ou link. Falha fechada;
 *  - decisao do dono de 05/11/2026: o conselho da linha do RT aceita o texto
 *    (recusaPeloConselho).
 * O PreparoAprovado sai congelado.
 */
export function conferirParaEnvio(
  lido: unknown,
  /**
   * Decisao do dono de 06/11/2026: a introducao que vai antes do bloco (so por
   * comIntroducao). O bloco e conferido inteiro antes dela; a mensagem e o hash
   * do PreparoAprovado passam a ser os do corpo inteiro.
   */
  introducao: string | null = null,
): ConferenciaDoEnvio {
  const foraDoFormato: ConferenciaDoEnvio = { tipo: "fora_do_formato" };
  if (typeof lido !== "object" || lido === null || Array.isArray(lido)) {
    return foraDoFormato;
  }
  const campos = lido as Record<string, unknown>;
  const versaoId = campos.versao_id;
  const procedureId = campos.procedure_id;
  const versao = campos.versao;
  const mensagem = campos.mensagem;
  const sha256 = campos.sha256;
  if (
    typeof versaoId !== "string" ||
    !UUID.test(versaoId) ||
    typeof procedureId !== "string" ||
    !UUID.test(procedureId) ||
    typeof versao !== "number" ||
    !Number.isSafeInteger(versao) ||
    versao < 1 ||
    typeof sha256 !== "string" ||
    !SHA256_HEX.test(sha256) ||
    typeof mensagem !== "string"
  ) {
    return foraDoFormato;
  }
  const tamanho = Array.from(mensagem).length;
  if (tamanho < 1 || tamanho > LIMITE_DA_MENSAGEM_DO_PREPARO) {
    return foraDoFormato;
  }
  const partes = partesDaMensagemDoPreparo(mensagem);
  if (partes === null) {
    return foraDoFormato;
  }
  if (sha256DoTexto(mensagem) !== sha256) {
    return foraDoFormato;
  }
  const { recusas } = problemasDoTextoDoPreparo(partes.texto);
  if (recusas.length > 0) {
    return { tipo: "recusado", recusas, versaoId, procedureId };
  }
  const peloConselho = recusaPeloConselho(
    partes.texto,
    conselhoDaLinhaDoRt(partes.linhaDoRt),
  );
  if (peloConselho.length > 0) {
    return { tipo: "recusado", recusas: peloConselho, versaoId, procedureId };
  }
  const corpo =
    introducao === null ? mensagem : corpoComIntroducao(introducao, mensagem);
  if (
    introducao !== null &&
    (problemaDaIntroducao(introducao, [partes.texto]) !== null ||
      Array.from(corpo).length > LIMITE_DA_MENSAGEM_DO_PREPARO)
  ) {
    return foraDoFormato;
  }
  return {
    tipo: "pronto",
    preparo: marcar({
      mensagem: corpo,
      sha256: sha256DoTexto(corpo),
      versaoId,
      procedureId,
      versao,
    }),
  };
}

// ---------------------------------------------------------------------------
// A introducao da IA antes do bloco exato (decisao do dono de 06/11/2026, opcao
// A: "a IA escreve a conversa em volta e o sistema envia a orientacao exata")
// ---------------------------------------------------------------------------

/**
 * Por que a introducao nao sai: fora do formato (ou com o que o banco recusa
 * sozinho), com o que ela nunca diz, ou com o nome de um remedio do texto
 * aprovado.
 */
export type ProblemaDaIntroducao = "formato" | "conteudo" | "remedio_do_texto";

const QUE_A_INTRODUCAO_NAO_DIZ = regexDoBanco(
  FONTE_DO_QUE_A_INTRODUCAO_NAO_DIZ,
);

/**
 * A regra propria da introducao, que so bloqueia, por cima do filtro inteiro
 * (a IA nunca escreve remedio, dose nem como tomar: CLAUDE.md 3.2). O banco
 * confere o formato e o conteudo de novo (preparo_introducao_valida); os nomes
 * do texto aprovado ficam so aqui.
 */
export function problemaDaIntroducao(
  texto: string,
  textosDePreparo: readonly string[],
): ProblemaDaIntroducao | null {
  if (!introducaoNoFormato(texto) || textoRecusadoPeloBanco(texto)) {
    return "formato";
  }
  const base = frasesDoBanco(texto);
  if (QUE_A_INTRODUCAO_NAO_DIZ.test(base)) {
    return "conteudo";
  }
  const palavras = new Set(base.split(/[^\p{L}]+/u));
  return textosDePreparo.some((t) =>
    nomesDeRemedioDoTexto(t).some((nome) => palavras.has(nome)),
  )
    ? "remedio_do_texto"
    : null;
}

/**
 * O preparo com a introducao antes do bloco exato, ou null (quem chama manda so
 * o bloco, ou, na retomada, recusa): a mesma conferencia do envio no bloco e,
 * nela, a regra propria contra o texto deste bloco, o bloco ja com introducao e
 * a mensagem que passa de 4.096. O hash passa a ser o do corpo inteiro, que a
 * decisao grava e o gatilho de message confere, separando o bloco de novo.
 */
export function comIntroducao(
  preparo: PreparoAprovado,
  introducao: string,
): PreparoAprovado | null {
  const conferido = conferirParaEnvio(
    {
      versao_id: preparo.versaoId,
      procedure_id: preparo.procedureId,
      versao: preparo.versao,
      mensagem: preparo.mensagem,
      sha256: preparo.sha256,
    },
    introducao,
  );
  return conferido.tipo === "pronto" ? conferido.preparo : null;
}

// ---------------------------------------------------------------------------
// O texto que a clinica escreve (D-80)
// ---------------------------------------------------------------------------

export type ProblemasDoTextoDoPreparo = {
  /** O que o texto nunca pode ter, mesmo aprovado pelo RT. Vazia: salva. */
  recusas: readonly CategoriaDeConformidade[];
  /** O conteudo de um preparo: o RT aprova sabendo (o aviso do dialogo). */
  avisos: readonly CategoriaDeConformidade[];
  /**
   * Revisao da AG7 (TELA-8): o que tirar, para a tela dizer. Uma entrada por
   * recusa, na mesma ordem: a frase do texto (como a clinica escreveu,
   * aparada) que dispara a recusa sozinha; null quando so o texto inteiro a
   * dispara. E o texto da clinica, nao dado de paciente: vai a tela, nunca a
   * log.
   */
  trechosDasRecusas: readonly TrechoDaRecusa[];
};

/** A recusa e a frase do texto que a dispara (ou null). */
export type TrechoDaRecusa = {
  categoria: CategoriaDeConformidade;
  trecho: string | null;
};

/** Promessa, oferta casada e antes e depois: nunca, em texto nenhum. */
const CATEGORIAS_QUE_RECUSAM: ReadonlySet<CategoriaDeConformidade> = new Set([
  "promessa_resultado",
  "oferta_casada",
  "antes_depois",
]);

/**
 * Orientacao, remedio, dose, triagem e diagnostico so avisam (D-80), menos a
 * normalizacao de sintoma, que recusa como triagem (normalizaSintoma).
 */
const CATEGORIAS_QUE_AVISAM: ReadonlySet<CategoriaDeConformidade> = new Set([
  "triagem",
  "diagnostico",
  "orientacao_clinica",
  "medicamento",
  "dosagem",
]);

/**
 * As regras de formato que recusam: o link, o arroba e o texto escrito para
 * enganar (invisivel, alfabeto estranho, marcas empilhadas). O resto do
 * formato e sinal de texto escrito pelo modelo e nao vale para o texto da
 * clinica: "Siga as instrucoes abaixo" (fala_de_bastidor), "a) ... b) ..."
 * e a marcacao do WhatsApp. O tamanho (longo), o telefone da clinica
 * (dado_pessoal) e o emoji de remedio (emoji_clinico) ficam de fora como o
 * contrato manda.
 */
const FORMATO_QUE_RECUSA: ReadonlySet<string> = new Set([
  "url",
  "url_espacada",
  "arroba",
  "caractere_invisivel",
  "alfabeto_estranho",
  "marcas_empilhadas",
]);

/** O preco que recusa sempre: a moeda estrangeira e o desconto. */
const PRECO_QUE_RECUSA_SEMPRE: ReadonlySet<string> = new Set([
  "moeda_estrangeira",
  "desconto_ou_parcela",
]);

/** O numero lido como preco: recusa so com a moeda ou a palavra do preco. */
const PRECO_COM_A_MOEDA: ReadonlySet<string> = new Set([
  "valor_fora_do_turno",
  "valor_ilegivel",
]);

/**
 * O valor em reais escrito como dinheiro, na visao base (minusculas, sem
 * acento): "R$", "RS 50", "BRL", "reais", "50 real", ou a palavra que diz
 * preco. Sem isso, o numero que a regra do preco le ("um total de 4 litros")
 * e o percentual ("manitol a 20%", "soro a 0,9%") sao dose, nao dinheiro.
 */
const DINHEIRO_ESCRITO =
  /r ?\$|\brs ?\d|\bbrl\b|\breais\b|\d ?real\b|\b(?:custa|custam|custar|custo|preco|precos|valor|cobra|cobram|cobramos|cobrado|cobrada|pagar|pague|pagamento|investimento)\b/;

function recusa(achado: AchadoDaRegra, comDinheiro: boolean): boolean {
  if (CATEGORIAS_QUE_RECUSAM.has(achado.categoria)) {
    return true;
  }
  if (achado.categoria === "preco_nao_verificado") {
    return (
      PRECO_QUE_RECUSA_SEMPRE.has(achado.regra) ||
      (comDinheiro && PRECO_COM_A_MOEDA.has(achado.regra))
    );
  }
  if (achado.categoria === "formato_invalido") {
    return FORMATO_QUE_RECUSA.has(achado.regra);
  }
  return false;
}

/**
 * Revisao da AG7 (TELA-8): "Para garantir a qualidade do exame" e "o preparo
 * garante a nitidez das imagens" sao comuns no preparo e nao prometem
 * resultado do procedimento. So no texto da clinica, o verbo sai antes das
 * regras (a resposta do modelo continua barrada pelo "garant"); com
 * resultado, efeito, melhora ou sucesso na mesma frase, fica (e recusa).
 */
const GARANTIA_DA_QUALIDADE_DO_EXAME =
  /\bgarant\p{L}*(?=\s+(?:(?:a|uma|boa|melhor|maior|toda)\s+)?(?:qualidade|nitidez|precis[aã]o)\s+(?:d[oa]s?|n[oa]s?)\s+(?:exames?|imag(?:em|ens)|visualiza[cç](?:[aã]o|[õo]es)|laudos?)\b)(?![^.!?\n]*\b(?:resultados?|efeitos?|melhora|sucesso))/giu;

/** O texto com a garantia da qualidade do exame trocada (so para as regras). */
function semAGarantiaDoExame(texto: string): string {
  return texto.replace(GARANTIA_DA_QUALIDADE_DO_EXAME, "preservar");
}

/** As frases do texto da clinica (como escritas, aparadas), sem as vazias. */
function frasesDoTextoDaClinica(texto: string): string[] {
  return texto
    .split(/(?<=[.!?;:])\s+|\n+/u)
    .map((frase) => frase.trim())
    .filter((frase) => /[\p{L}\p{N}]/u.test(frase));
}

/**
 * Os problemas do texto do preparo que a clinica escreve, pelas regras
 * deterministicas do filtro de saida (avaliarRegras) com o contexto VAZIO
 * (sem preco do turno, sem catalogo, sem mensagem de paciente, sem fatos):
 *  - recusa: promessa, oferta casada, antes e depois, valor em reais
 *    (preco_nao_verificado com dinheiro escrito, moeda estrangeira ou
 *    desconto) e o formato que engana ou leva para fora (link, arroba,
 *    invisivel, alfabeto estranho, marcas empilhadas); e, por decisao do dono
 *    de 05/11/2026, a normalizacao de sintoma (triagem) e a oferta de outro
 *    procedimento (oferta_casada), as duas regras de lib/domain/preparo.ts,
 *    que o banco tem byte a byte;
 *  - avisa, sem recusar: orientacao, remedio, dose, triagem e diagnostico,
 *    que sao o conteudo de um preparo (D-80);
 *  - ignora o resto (o tamanho, o telefone da clinica, o emoji, a fala de
 *    bastidor e a marcacao).
 * As categorias saem sem repetir, na ordem de prioridade do filtro. A
 * validade do texto (tamanho, NFC, controle, invisivel, chaves) e outra
 * conferencia: textoDoPreparoValido (lib/domain/preparo.ts) e o CHECK.
 */
export function problemasDoTextoDoPreparo(
  texto: string,
): ProblemasDoTextoDoPreparo {
  const { recusas, avisos } = classificarOTexto(texto);
  if (recusas.length === 0) {
    return { recusas, avisos, trechosDasRecusas: [] };
  }
  // A frase que dispara cada recusa sozinha (cada frase avaliada uma vez).
  const recusasDaFrase = new Map<string, readonly CategoriaDeConformidade[]>();
  const frases = frasesDoTextoDaClinica(texto);
  const trechosDasRecusas = recusas.map((categoria): TrechoDaRecusa => {
    const frase = frases.find((f) => {
      let daFrase = recusasDaFrase.get(f);
      if (daFrase === undefined) {
        daFrase = classificarOTexto(f).recusas;
        recusasDaFrase.set(f, daFrase);
      }
      return daFrase.includes(categoria);
    });
    return { categoria, trecho: frase ?? null };
  });
  return { recusas, avisos, trechosDasRecusas };
}

/** As recusas e os avisos de um texto (o texto inteiro ou uma frase). */
function classificarOTexto(texto: string): {
  recusas: readonly CategoriaDeConformidade[];
  avisos: readonly CategoriaDeConformidade[];
} {
  const avaliado = semAGarantiaDoExame(texto);
  const { achados } = avaliarRegras(avaliado, {
    precosDoTurno: [],
    nomesDoCatalogo: [],
    mensagensDoPaciente: [],
  });
  const comDinheiro = DINHEIRO_ESCRITO.test(normalizarBase(avaliado));
  const recusas = new Set<CategoriaDeConformidade>();
  const avisos = new Set<CategoriaDeConformidade>();
  for (const achado of achados) {
    if (recusa(achado, comDinheiro)) {
      recusas.add(achado.categoria);
    } else if (CATEGORIAS_QUE_AVISAM.has(achado.categoria)) {
      avisos.add(achado.categoria);
    }
  }
  if (normalizaSintoma(texto)) {
    recusas.add("triagem");
    avisos.delete("triagem");
  }
  if (ofereceOutroProcedimento(texto)) {
    recusas.add("oferta_casada");
  }
  return {
    recusas: ordenarPorPrioridade(CATEGORIAS_DE_CONFORMIDADE, recusas),
    avisos: ordenarPorPrioridade(CATEGORIAS_DE_CONFORMIDADE, avisos),
  };
}

/**
 * O que barra o texto pelo conselho do RT (decisao do dono de 05/11/2026): o
 * remedio e a dose que o aviso do dialogo acusa, quando o conselho nao e CRM
 * nem CRO (null: sem conselho conhecido, nao aceita). Vazia: o conselho aceita.
 * Revisao final da AG7: o jejum, tomar agua, o frasco da coleta e informar os
 * medicamentos em uso nao sao remedio nem dose (semOQueNaoERemedioNemDose).
 * O banco tem a mesma regra, em menos visoes (preparo_conselho_recusa_texto).
 */
export function recusaPeloConselho(
  texto: string,
  conselho: string | null,
): readonly CategoriaDeConformidade[] {
  if (conselho !== null && CONSELHOS_DE_REMEDIO_E_DOSE.includes(conselho)) {
    return [];
  }
  return classificarOTexto(semOQueNaoERemedioNemDose(texto)).avisos.filter(
    (categoria) => categoria === "medicamento" || categoria === "dosagem",
  );
}

/**
 * A primeira frase do texto (como a clinica escreveu) que traz o remedio ou a
 * dose, para a recusa dizer o que tirar. null: so o texto inteiro dispara.
 */
export function trechoDoRemedioOuDose(texto: string): string | null {
  return (
    frasesParaORecorte(texto).find(
      (frase) => recusaPeloConselho(frase, null).length > 0,
    ) ?? null
  );
}
