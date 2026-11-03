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
  type AchadoDaRegra,
} from "@/lib/domain/conformidade/filtro-deterministico";
import { normalizarBase } from "@/lib/domain/conformidade/normalizar";
import { partesDaMensagemDoPreparo } from "@/lib/domain/preparo";

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
 *    oferta casada, antes e depois, preco ou link. Falha fechada.
 * O PreparoAprovado sai congelado.
 */
export function conferirParaEnvio(lido: unknown): ConferenciaDoEnvio {
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
  return {
    tipo: "pronto",
    preparo: marcar({ mensagem, sha256, versaoId, procedureId, versao }),
  };
}

// ---------------------------------------------------------------------------
// O texto que a clinica escreve (D-80)
// ---------------------------------------------------------------------------

export type ProblemasDoTextoDoPreparo = {
  /** O que o texto nunca pode ter, mesmo aprovado pelo RT. Vazia: salva. */
  recusas: readonly CategoriaDeConformidade[];
  /** O conteudo de um preparo: o RT aprova sabendo (o aviso do dialogo). */
  avisos: readonly CategoriaDeConformidade[];
};

/** Promessa, oferta casada e antes e depois: nunca, em texto nenhum. */
const CATEGORIAS_QUE_RECUSAM: ReadonlySet<CategoriaDeConformidade> = new Set([
  "promessa_resultado",
  "oferta_casada",
  "antes_depois",
]);

/** Orientacao, remedio, dose, triagem e diagnostico: so avisam (D-80). */
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
 * Os problemas do texto do preparo que a clinica escreve, pelas regras
 * deterministicas do filtro de saida (avaliarRegras) com o contexto VAZIO
 * (sem preco do turno, sem catalogo, sem mensagem de paciente, sem fatos):
 *  - recusa: promessa, oferta casada, antes e depois, valor em reais
 *    (preco_nao_verificado com dinheiro escrito, moeda estrangeira ou
 *    desconto) e o formato que engana ou leva para fora (link, arroba,
 *    invisivel, alfabeto estranho, marcas empilhadas);
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
  const { achados } = avaliarRegras(texto, {
    precosDoTurno: [],
    nomesDoCatalogo: [],
    mensagensDoPaciente: [],
  });
  const comDinheiro = DINHEIRO_ESCRITO.test(normalizarBase(texto));
  const recusas = new Set<CategoriaDeConformidade>();
  const avisos = new Set<CategoriaDeConformidade>();
  for (const achado of achados) {
    if (recusa(achado, comDinheiro)) {
      recusas.add(achado.categoria);
    } else if (CATEGORIAS_QUE_AVISAM.has(achado.categoria)) {
      avisos.add(achado.categoria);
    }
  }
  return {
    recusas: ordenarPorPrioridade(CATEGORIAS_DE_CONFORMIDADE, recusas),
    avisos: ordenarPorPrioridade(CATEGORIAS_DE_CONFORMIDADE, avisos),
  };
}
