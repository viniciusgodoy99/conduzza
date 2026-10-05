// Portao de entrada deterministico: o que na mensagem do paciente escala a
// conversa ANTES de chamar o agente (plano de seguranca, secao 3). PURO.
//
// Por que antes: o filtro de saida nao enxerga o contexto ("pode sim" e
// inofensivo sozinho e orientacao clinica depois de "posso tomar
// dipirona?"), e uma mensagem de sintoma nunca pode disparar ferramenta com
// efeito colateral (reservar horario, agendar).
//
// Falso positivo aqui escala para a recepcao e tira da IA a conversa
// inteira (a regra de contexto do filtro de saida reusa este portao). Por
// isso os padroes pegam o obvio com precisao alta; parafrase e giria ficam
// para o classificador por modelo, que falha fechado (revisao de 05/10/2026).

import {
  GATILHOS_DE_ENTRADA,
  ordenarPorPrioridade,
  type GatilhoDeEntrada,
} from "@/lib/domain/conformidade/categorias";
import {
  frasesDasVisoes,
  neutralizador,
  sinaisDeOfuscacao,
  temLetraForaDoAlfabeto,
  visoesDoTexto,
} from "@/lib/domain/conformidade/normalizar";
import {
  IDADES_POR_EXTENSO,
  LEXICO_COMPACTO_DE_ENTRADA,
  NEUTRALIZACOES_DE_ENTRADA,
  PADROES_DE_ENTRADA,
} from "@/lib/domain/conformidade/padroes";

/** Texto acima disso escala (plano de seguranca, secao 3). */
export const LIMITE_DE_MENSAGEM = 1000;
/** Soma das mensagens ainda nao respondidas acima disso tambem escala. */
export const LIMITE_DA_RAJADA = 2000;
/**
 * Quantas mensagens do paciente os modelos (classificador e verificador)
 * enxergam. Mais do que isso ainda sem resposta escala como mensagem longa:
 * assim o corte das ultimas cinco nunca esconde dos modelos uma pergunta
 * clinica que ficou para tras ("da pra beber depois do botox?", "oi", "?",
 * "alo", "tem alguem?", "e ai"). O filtro de saida tambem bloqueia nesse
 * caso, como segunda trava.
 */
export const MAXIMO_DE_MENSAGENS_NO_CONTEXTO = 5;

export type MensagemDeEntrada = {
  /** message.content_type: so "texto" segue; qualquer outro e midia. */
  tipo: string;
  texto: string | null;
};

export type EntradaDoPortao = {
  /** A ultima mensagem do paciente e as anteriores ainda nao respondidas. */
  mensagens: readonly MensagemDeEntrada[];
  /** contact.birth_date (AAAA-MM-DD), lido no servidor. */
  dataDeNascimento?: string | null;
  /** Hoje no fuso da clinica (AAAA-MM-DD); exigido para usar a data acima. */
  hojeNaClinica?: string | null;
};

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Idade em anos completos entre duas datas AAAA-MM-DD; null se invalida. */
export function idadeEmAnos(nascimento: string, hoje: string): number | null {
  const n = DATA.exec(nascimento);
  const h = DATA.exec(hoje);
  if (!n || !h) {
    return null;
  }
  const [anoN, mesN, diaN] = [Number(n[1]), Number(n[2]), Number(n[3])];
  const [anoH, mesH, diaH] = [Number(h[1]), Number(h[2]), Number(h[3])];
  if (mesN < 1 || mesN > 12 || diaN < 1 || diaN > 31) {
    return null;
  }
  let idade = anoH - anoN;
  if (mesH < mesN || (mesH === mesN && diaH < diaN)) {
    idade -= 1;
  }
  return idade >= 0 ? idade : null;
}

// "tenho 16 anos", "ela tem 15 anos", "minha filha de 12 anos", "fiz
// dezessete anos". Sempre com "anos": "fiz 3 sessoes" nao e idade.
// Sem flag g: matchAll exige, entao cada chamada cria a sua copia.
const IDADE_DECLARADA =
  "\\b(?:tenho|tem|com|de|fiz|fez|completei|completou|completa|vou fazer|vai fazer|so tenho|i am|i'm|tengo)\\s+(\\d{1,2}|[a-z]+)\\s+(?:anos|aninhos|years|ano)\\b";
const IDADE_ROTULADA = "\\bidade:?\\s*(?:de\\s+)?(\\d{1,2})\\b";
const IDADE_EM_INGLES = "\\b(\\d{1,2}) ?(?:years? old|yo)\\b";

function idadesDeclaradas(texto: string): number[] {
  const idades: number[] = [];
  for (const fonte of [IDADE_DECLARADA, IDADE_ROTULADA, IDADE_EM_INGLES]) {
    for (const casamento of texto.matchAll(new RegExp(fonte, "g"))) {
      const bruto = casamento[1] ?? "";
      const numero = /^\d+$/.test(bruto)
        ? Number(bruto)
        : IDADES_POR_EXTENSO.get(bruto);
      if (numero !== undefined) {
        idades.push(numero);
      }
    }
  }
  return idades;
}

function idadeMenorDeclarada(texto: string): boolean {
  return idadesDeclaradas(texto).some((idade) => idade < 18);
}

function caixaAlta(bruto: string): boolean {
  const letras = bruto.match(/\p{L}/gu) ?? [];
  if (letras.length < 10) {
    return false;
  }
  const maiusculas = letras.filter(
    (letra) => letra !== letra.toLowerCase() && letra === letra.toUpperCase(),
  );
  return maiusculas.length / letras.length >= 0.8;
}

// "O laudo fica pronto quando?" e documento, nao assunto clinico.
const neutralizarEntrada = neutralizador(NEUTRALIZACOES_DE_ENTRADA);

function gatilhosDoTexto(bruto: string): Set<GatilhoDeEntrada> {
  const achados = new Set<GatilhoDeEntrada>();
  const visoes = visoesDoTexto(bruto, [], neutralizarEntrada);
  const frases = frasesDasVisoes(visoes);

  for (const padrao of PADROES_DE_ENTRADA) {
    if (frases.some((frase) => padrao.regex.test(frase))) {
      achados.add(padrao.gatilho);
    }
  }
  for (const { gatilho, termo } of LEXICO_COMPACTO_DE_ENTRADA) {
    if (
      visoes.compacto.includes(termo) ||
      visoes.compactoComL.includes(termo)
    ) {
      achados.add(gatilho);
    }
  }
  if (frases.some((frase) => idadeMenorDeclarada(frase))) {
    achados.add("menor_de_idade");
  }
  if (caixaAlta(bruto)) {
    achados.add("insatisfacao");
  }
  const sinais = sinaisDeOfuscacao(bruto);
  if (sinais.alfabetoEstranho || sinais.invisivel || sinais.marcasEmpilhadas) {
    achados.add("manipulacao");
  }
  // Letra fora de [a-z] depois da normalizacao (latim estendido que o mapa
  // de homoglifos nao cobre) e texto escrito para passar pelo filtro.
  // Letras soltas NAO contam aqui (revisao de precisao de 05/10/2026): "o q
  // e q eu levo?" e "p/ o q e a consulta?" sao abreviacao de WhatsApp. A
  // palavra espacada continua lida pelo sentido nas visoes ("t o  c o m  d o
  // r" escala como sintoma).
  if (temLetraForaDoAlfabeto(visoes.base)) {
    achados.add("manipulacao");
  }
  return achados;
}

/**
 * Os gatilhos presentes nas mensagens, em ordem de prioridade (o primeiro e
 * o motivo do escalonamento). Lista vazia = o portao deterministico deixa
 * passar (o classificador por modelo ainda decide).
 */
export function detectarGatilhosDeEntrada(
  entrada: EntradaDoPortao,
): GatilhoDeEntrada[] {
  const achados = new Set<GatilhoDeEntrada>();
  let total = 0;

  for (const mensagem of entrada.mensagens) {
    if (mensagem.tipo !== "texto") {
      // Audio (mesmo transcrito), imagem e documento nunca vao ao agente na
      // fase controlada: escala.
      achados.add("midia");
      continue;
    }
    const texto = mensagem.texto ?? "";
    const tamanho = Array.from(texto).length;
    total += tamanho;
    if (tamanho > LIMITE_DE_MENSAGEM) {
      achados.add("mensagem_longa");
    }
    for (const gatilho of gatilhosDoTexto(texto)) {
      achados.add(gatilho);
    }
  }
  if (total > LIMITE_DA_RAJADA) {
    achados.add("mensagem_longa");
  }
  if (entrada.mensagens.length > MAXIMO_DE_MENSAGENS_NO_CONTEXTO) {
    achados.add("mensagem_longa");
  }

  if (entrada.dataDeNascimento && entrada.hojeNaClinica) {
    const idade = idadeEmAnos(entrada.dataDeNascimento, entrada.hojeNaClinica);
    if (idade !== null && idade < 18) {
      achados.add("menor_de_idade");
    }
  }

  return ordenarPorPrioridade(GATILHOS_DE_ENTRADA, achados);
}

/** Atalho para o filtro de saida: gatilhos de um conjunto de textos. */
export function gatilhosDosTextos(
  textos: readonly string[],
): GatilhoDeEntrada[] {
  return detectarGatilhosDeEntrada({
    mensagens: textos.map((texto) => ({ tipo: "texto", texto })),
  });
}
