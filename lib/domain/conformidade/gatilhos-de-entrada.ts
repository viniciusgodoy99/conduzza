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
  normalizarBase,
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

// Caixa alta como grito (insatisfacao). Revisao de producao de 19/10/2026
// (Q2, decisao do dono): so com 5 palavras ou mais e sem "?". "OI BOA TARDE"
// e "QUANTO CUSTA A CONSULTA?" sao recepcao (paciente mais velho escreve
// assim); "QUERO SABER O QUE ACONTECEU COM MEU HORARIO" continua escalando.
const MINIMO_DE_LETRAS_DA_CAIXA_ALTA = 10;
const PROPORCAO_DA_CAIXA_ALTA = 0.8;
const MINIMO_DE_PALAVRAS_DA_CAIXA_ALTA = 5;
/** Interrogacao comum, de largura cheia e a invertida. */
const INTERROGACAO = /[?\uff1f\u00bf]/u;

function caixaAlta(bruto: string): boolean {
  const letras = bruto.match(/\p{L}/gu) ?? [];
  if (letras.length < MINIMO_DE_LETRAS_DA_CAIXA_ALTA) {
    return false;
  }
  if (INTERROGACAO.test(bruto)) {
    return false;
  }
  const palavras = bruto.split(/\s+/u).filter((parte) => /\p{L}/u.test(parte));
  if (palavras.length < MINIMO_DE_PALAVRAS_DA_CAIXA_ALTA) {
    return false;
  }
  const maiusculas = letras.filter(
    (letra) => letra !== letra.toLowerCase() && letra === letra.toUpperCase(),
  );
  return maiusculas.length / letras.length >= PROPORCAO_DA_CAIXA_ALTA;
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

// ---------------------------------------------------------------------------
// Revisao final da AG3 (achado 15, D-8): a consulta para outra pessoa adulta
// ---------------------------------------------------------------------------
//
// A consulta para outra pessoa passa para a equipe (D-8). O modelo ja passa
// quando percebe (registrar_dados_do_paciente com para_o_titular false), mas
// o pedido obvio ("quero marcar para minha mae", "tem horario pro meu
// pai?", "e para o meu marido") nao precisa chegar a ele: o portao passa
// antes, com o motivo consulta_para_outra_pessoa. Filho, filha, neto,
// sobrinho e enteado ficam de fora: seguem pela regra do menor de idade
// (a idade, quando dita, ou o nascimento informado). Sem gatilho novo no
// banco (o CHECK de gatilho_entrada nao muda): o laco escala com o motivo e
// sem gatilho.

/** Os parentes e as pessoas adultas da consulta para outra pessoa. */
const PESSOA_ADULTA =
  "(?:mae|mamae|pai|papai|marido|esposo|esposa|mulher|companheir[oa]|namorad[oa]|noiv[oa]|avo|avos|vovo|vovos|sogr[oa]|irma|irmao|irmas|irmaos|tia|tio|tias|tios|prima|primo|cunhad[oa]|genro|nora|madrasta|padrasto|amig[oa]|vizinh[oa]|chefe|patrao|patroa|colega|funcionari[oa]|empregad[oa]|cuidador|cuidadora)";
/**
 * Revisao curta das correcoes da AG3 (achado 9): o parente dito sem o
 * possessivo ("pra mamae", "pro papai", "para a vovo").
 */
const PESSOA_SEM_POSSESSIVO = "(?:mamae|papai|vovo|vovos)";
/** "minha", "o meu", "nossa". */
const DE_QUEM = "(?:(?:a|o|as|os)\\s+)?(?:minha|meu|minhas|meus|nossa|nosso)";
/** "para", "pra", "pro", "p/". */
const PARA_QUEM = "(?:para|pra|pro|pros|pras|p\\/)";
/** O que diz que e marcacao ("marcar", "consulta", "horario"). */
const PEDIDO_DE_AGENDA =
  /\b(?:marcar|marca|marque|agendar|agenda|agende|agendamento|marcacao|consulta|consultas|horario|horarios|vaga|vagas|encaixe|encaixar|atendimento|avaliacao|retorno|sessao|procedimento)\b/;
/** "para minha mae", "pro meu pai", "pra minha esposa", "pra mamae". */
const PARA_A_PESSOA = new RegExp(
  `\\b${PARA_QUEM}\\s+(?:${DE_QUEM}\\s+${PESSOA_ADULTA}|(?:(?:a|o)\\s+)?${PESSOA_SEM_POSSESSIVO})\\b`,
  "g",
);
/**
 * Revisao curta das correcoes da AG3 (achado 9): o "para a pessoa" que nao
 * pede a consulta para ela.
 *  - negado: "e para mim, nao para minha mae", "nao e pro meu marido";
 */
const NEGACAO_ANTES_DA_PESSOA =
  /\b(?:nao|nem|nunca)\s+(?:(?:e|eh|sera|seria|vai ser|era|foi|so|e so)\s+)?$/;
/**
 *  - a pessoa como quem faz outra coisa ("um horario que de para minha mae
 *    me levar", "pro meu chefe me liberar", "pro meu marido poder vir"): o
 *    pronome ou o verbo logo depois dela. "Para minha mae consultar" e
 *    "para minha mae fazer a limpeza" continuam sendo para ela;
 */
const OUTRA_COISA_DEPOIS_DA_PESSOA =
  /^\s+(?:(?:me|te|nos|lhe|comigo|conosco)\b|(?:levar|trazer|acompanhar|buscar|ir|vir|poder|conseguir|dirigir|ficar|cuidar|pagar|liberar|deixar|ajudar|esperar|aguardar|chegar|sair|saber|ver|olhar|entrar|estacionar|lembrar|avisar|resolver|decidir|escolher|trabalhar|almocar|dormir|viajar|voltar|participar|assistir|estar)\b)/;
/**
 *  - o horario que serve para a pessoa ("um horario bom para minha mae",
 *    "que de pra minha esposa", "melhor pro meu marido"): fica para o
 *    modelo, que passa para a equipe quando a consulta e dela.
 */
const CONVENIENCIA_ANTES_DA_PESSOA =
  /\b(?:bom|boa|bons|boas|melhor|melhores|conveniente|facil|tranquilo|tranquila|ruim|dificil|possivel|viavel|complicado|complicada|de|der|da|daria|desse|dar|serve|servir)\s+(?:(?:certo|tambem|mais)\s+)?$/;
/** "minha mae quer marcar", "e minha mae que precisa de uma consulta". */
const A_PESSOA_QUER = new RegExp(
  `\\b${DE_QUEM}\\s+${PESSOA_ADULTA}\\s+(?:que\\s+)?(?:quer|queria|gostaria|precisa|precisaria|vai|iria|deseja|desejaria)\\s+(?:de\\s+)?(?:marcar|agendar|consultar|uma consulta|um horario|um atendimento|uma avaliacao|ser atendid[oa]|passar\\s+(?:por|em)\\s+(?:uma\\s+)?(?:consulta|avaliacao|atendimento)|passar\\s+com\\s+(?:a|o)\\s+(?:dra?|doutora?|medic[oa]|\\S+ista)\\b)`,
);
/** A resposta curta: "e para minha mae", "seria pro meu pai". */
const RESPOSTA_PARA_A_PESSOA = new RegExp(
  `^(?:(?:sim|nao|e|eh|seria|sera|vai ser|na verdade|ah)\\s*,?\\s+)+${PARA_QUEM}\\s+(?:${DE_QUEM}\\s+${PESSOA_ADULTA}|(?:(?:a|o)\\s+)?${PESSOA_SEM_POSSESSIVO})\\b`,
);
/** "Nao e para minha mae": a resposta curta negada (sem a virgula). */
const RESPOSTA_NEGADA =
  /^\s*(?:nao|nem)\s+(?:e|eh|seria|sera|vai ser|era|foi)\b/;

// AG4 (27/10/2026): cancelar e remarcar a consulta de outra pessoa adulta
// tambem passa para a equipe antes do modelo (D-8): "cancela a consulta da
// minha mae", "quero remarcar o horario do meu pai", "cancela a da minha
// mae", "minha mae precisa cancelar" e "minha mae tem consulta amanha e nao
// vai poder ir, quero cancelar". "Da minha mae" so conta COLADO na consulta
// (ou no verbo, com o artigo): "preciso cancelar por causa da minha mae" e
// "quero remarcar, tenho que cuidar da minha mae" sao da propria pessoa.
// Filho e filha seguem fora (a regra do menor).

/** O que diz que e cancelar ou remarcar. */
const PEDIDO_DE_CANCELAR_OU_REMARCAR =
  /\b(?:cancelar|cancela|cancele|cancelamento|desmarcar|desmarca|desmarque|remarcar|remarca|remarque|remarcacao|reagendar|reagenda|reagendamento|adiar|mudar\s+(?:o|a)\s+(?:horario|consulta|data|dia))\b/;
/** "da minha mae", "do meu pai", "dos meus pais". */
const DA_PESSOA = `(?:da|do|das|dos)\\s+(?:minha|meu|minhas|meus|nossa|nosso)\\s+${PESSOA_ADULTA}`;
/**
 * A consulta colada na pessoa: "a consulta da minha mae", "o horario marcado
 * do meu pai", "a consulta de amanha da minha mae", "o retorno do dia 29 do
 * meu marido".
 */
const CONSULTA_DA_PESSOA = new RegExp(
  "\\b(?:consulta|consultas|horario|horarios|agendamento|agendamentos|marcacao|retorno|sessao|sessoes|atendimento|avaliacao|procedimento|encaixe)" +
    "(?:\\s+(?:marcad[oa]s?|agendad[oa]s?))?" +
    "(?:\\s+(?:de|do|da|para|pra|pro)\\s+(?:hoje|amanha|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|semana que vem|(?:dia\\s+)?\\d{1,2}(?:\\/\\d{1,2})?))?" +
    `\\s+${DA_PESSOA}\\b`,
  "g",
);
/** O verbo com o artigo, sem o nome da consulta: "cancela a da minha mae". */
const ACAO_NA_DA_PESSOA = new RegExp(
  `\\b(?:cancelar|cancela|cancele|desmarcar|desmarca|desmarque|remarcar|remarca|remarque|reagendar|reagenda|reagende|adiar|mudar)\\s+(?:a|o|as|os)\\s+${DA_PESSOA}\\b`,
  "g",
);
/** "minha mae precisa cancelar", "meu pai quer remarcar a consulta". */
const A_PESSOA_QUER_CANCELAR_OU_REMARCAR = new RegExp(
  `\\b${DE_QUEM}\\s+${PESSOA_ADULTA}\\s+(?:que\\s+)?(?:quer|queria|gostaria|precisa|precisaria|vai|deseja|desejaria|tem que|teria que)\\s+(?:de\\s+)?(?:cancelar|desmarcar|remarcar|reagendar|adiar|mudar\\s+(?:o|a)\\s+(?:horario|consulta|data|dia))\\b`,
);
/**
 * "minha mae tem consulta amanha" (com o pedido de cancelar ou remarcar na
 * mesma mensagem, em qualquer frase dela).
 */
const A_PESSOA_TEM_CONSULTA = new RegExp(
  `\\b${DE_QUEM}\\s+${PESSOA_ADULTA}\\s+(?:tem|tinha|ta com|esta com)\\s+(?:uma\\s+|um\\s+)?(?:consulta|horario|retorno|sessao|avaliacao|atendimento|procedimento)\\b`,
);
/** A negacao antes da consulta citada: "nao e a consulta da minha mae". */
const NEGACAO_ANTES_DA_CONSULTA =
  /\b(?:nao|nem|nunca)\s+(?:(?:e|eh|sera|seria|vai ser|era|foi|so|e so)\s+)?(?:(?:a|o|as|os)\s+)?$/;

/**
 * AG4: a frase cita a consulta (ou o horario) DA pessoa adulta, colada nela
 * ("a consulta da minha mae", "cancela a da minha mae"), fora da negacao
 * ("nao e a consulta do meu pai").
 */
function citaAConsultaDaPessoa(frase: string): boolean {
  for (const padrao of [CONSULTA_DA_PESSOA, ACAO_NA_DA_PESSOA]) {
    for (const m of frase.matchAll(padrao)) {
      const inicio = m.index ?? 0;
      const antes = frase.slice(Math.max(0, inicio - 40), inicio);
      if (NEGACAO_ANTES_DA_CONSULTA.test(antes)) {
        continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * Revisao curta das correcoes da AG3 (achado 9): a frase pede a consulta para
 * a pessoa (o "para minha mae" que nao e negado, nao e a pessoa fazendo
 * outra coisa e nao e o horario que serve para ela).
 */
function pedeParaAPessoa(frase: string): boolean {
  for (const m of frase.matchAll(PARA_A_PESSOA)) {
    const inicio = m.index ?? 0;
    const fim = inicio + m[0].length;
    const antes = frase.slice(Math.max(0, inicio - 40), inicio);
    if (
      NEGACAO_ANTES_DA_PESSOA.test(antes) ||
      CONVENIENCIA_ANTES_DA_PESSOA.test(antes) ||
      OUTRA_COISA_DEPOIS_DA_PESSOA.test(frase.slice(fim, fim + 40))
    ) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * O pedido de consulta para outra pessoa adulta numa das mensagens: a frase
 * com o pedido de agenda e "para minha mae" (ou "pro meu pai", "para o meu
 * marido", "pra minha esposa", "pra mamae"...), "minha mae quer marcar" e a
 * resposta curta ("e para minha mae"). Filho e filha nao (a regra do
 * menor). Revisao curta das correcoes da AG3 (achado 9): a pessoa tem de ser
 * a paciente; "a consulta e para mim, nao para minha mae", "meu marido vai
 * passar ai para pagar", "um horario que de para minha mae me levar" e "pro
 * meu chefe me liberar" nao sao.
 */
export function pedidoDeConsultaParaOutraPessoa(
  textos: readonly (string | null)[],
): boolean {
  const normalizados = textos
    .filter((texto): texto is string => texto !== null)
    .map((texto) => normalizarBase(texto));
  return (
    normalizados.some((texto) =>
      texto
        .split(/[.!?\n]+/)
        .map((frase) => frase.trim())
        .some(
          (frase) =>
            (PEDIDO_DE_AGENDA.test(frase) && pedeParaAPessoa(frase)) ||
            A_PESSOA_QUER.test(frase) ||
            (RESPOSTA_PARA_A_PESSOA.test(frase) &&
              !RESPOSTA_NEGADA.test(frase)) ||
            // AG4: cancelar ou remarcar a consulta da pessoa adulta.
            citaAConsultaDaPessoa(frase) ||
            A_PESSOA_QUER_CANCELAR_OU_REMARCAR.test(frase),
        ),
    ) || aPessoaTemConsultaECancela(normalizados)
  );
}

/**
 * AG4: "minha mae tem consulta amanha e nao vai poder ir, quero cancelar"
 * (a consulta da pessoa e o pedido de cancelar ou remarcar nas mensagens do
 * mesmo turno, na mesma frase ou nao).
 */
function aPessoaTemConsultaECancela(normalizados: readonly string[]): boolean {
  return (
    normalizados.some((texto) => A_PESSOA_TEM_CONSULTA.test(texto)) &&
    normalizados.some((texto) => PEDIDO_DE_CANCELAR_OU_REMARCAR.test(texto))
  );
}

/**
 * As regras do portao que vivem em codigo (idade declarada, caixa alta,
 * limites e, revisao final da AG3, a consulta para outra pessoa adulta),
 * para a versao do portao (versaoDoPortao, filtro.ts) mudar quando elas
 * mudarem. Os padroes, as trocas e o lexico vem de padroes.ts. Sem hash
 * aqui: este modulo tambem roda no navegador.
 */
export const FONTES_DO_PORTAO_EM_CODIGO: readonly string[] = [
  IDADE_DECLARADA,
  IDADE_ROTULADA,
  IDADE_EM_INGLES,
  `caixa alta: ${MINIMO_DE_LETRAS_DA_CAIXA_ALTA} letras, ${PROPORCAO_DA_CAIXA_ALTA}, ${MINIMO_DE_PALAVRAS_DA_CAIXA_ALTA} palavras, sem ${INTERROGACAO.source}`,
  `limites: ${LIMITE_DE_MENSAGEM}, ${LIMITE_DA_RAJADA}, ${MAXIMO_DE_MENSAGENS_NO_CONTEXTO}`,
  "midia escala",
  // Revisao final da AG3 (D-8): a consulta para outra pessoa adulta.
  PEDIDO_DE_AGENDA.source,
  PARA_A_PESSOA.source,
  A_PESSOA_QUER.source,
  RESPOSTA_PARA_A_PESSOA.source,
  "outra pessoa adulta: consulta_para_outra_pessoa, sem gatilho; filho e filha pela regra do menor",
  // Revisao curta das correcoes da AG3 (achado 9): a pessoa tem de ser a
  // paciente (a negacao, a pessoa fazendo outra coisa e o horario que serve
  // para ela nao contam).
  PESSOA_SEM_POSSESSIVO,
  NEGACAO_ANTES_DA_PESSOA.source,
  OUTRA_COISA_DEPOIS_DA_PESSOA.source,
  CONVENIENCIA_ANTES_DA_PESSOA.source,
  RESPOSTA_NEGADA.source,
  "outra pessoa adulta: so com a intencao de marcar para ela",
  // AG4: cancelar e remarcar a consulta de outra pessoa adulta.
  PEDIDO_DE_CANCELAR_OU_REMARCAR.source,
  CONSULTA_DA_PESSOA.source,
  ACAO_NA_DA_PESSOA.source,
  A_PESSOA_QUER_CANCELAR_OU_REMARCAR.source,
  A_PESSOA_TEM_CONSULTA.source,
  NEGACAO_ANTES_DA_CONSULTA.source,
  "outra pessoa adulta: a consulta dela (colada: a consulta da minha mae, cancela a da minha mae), a pessoa que quer cancelar ou remarcar e a que tem consulta com o pedido de cancelar nas mensagens do turno, fora da negacao",
];

/** Atalho para o filtro de saida: gatilhos de um conjunto de textos. */
export function gatilhosDosTextos(
  textos: readonly string[],
): GatilhoDeEntrada[] {
  return detectarGatilhosDeEntrada({
    mensagens: textos.map((texto) => ({ tipo: "texto", texto })),
  });
}
