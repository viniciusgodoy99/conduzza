import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import {
  controleNoNome,
  invisivelNoNome,
  LIMITE_DO_TEXTO_DO_PREPARO,
  nomeDoPreparoValido,
  normalizarTextoDoPreparo,
  textoDoPreparoValido,
  type ConteudoRecusadoPeloBanco,
  type SituacaoDoPreparo,
} from "@/lib/domain/preparo";

// Textos e regras de tela da orientacao de preparo aprovada pelo responsavel
// tecnico (AG7, frente T; desenho 5.1, 5.2 e 5.6; contrato 4.6). Modulo PURO
// e sem "use client": as Server Actions (app/(app)/cadastros/
// preparo-actions.ts) e as telas (preparo-do-procedimento.tsx e
// aprovar-preparo-dialog.tsx) leem daqui, para a dica da acao desabilitada e
// a recusa da action dizerem sempre a mesma frase. Nunca importa o filtro de
// conformidade: as recusas e os avisos do texto (problemasDoTextoDoPreparo)
// sao calculados no servidor e chegam prontos.

// ---------------------------------------------------------------------------
// As frases 42501 (exatas, as mesmas das RPCs; contrato 1.4)
// ---------------------------------------------------------------------------

export const FRASES_SEM_PERMISSAO = {
  escrever:
    "Somente administradores, gestores ou o responsável técnico escrevem a orientação de preparo.",
  aprovar:
    "Só o responsável técnico da clínica aprova a orientação de preparo.",
  descartar:
    "Somente administradores, gestores ou o responsável técnico descartam o texto novo da orientação de preparo.",
  suspender:
    "Somente administradores, gestores ou o responsável técnico suspendem o envio da orientação de preparo.",
} as const;

/**
 * A equipe Conduzza (super admin) escreve, descarta e suspende, mas nunca
 * aprova nem devolve, nem quando tambem e o RT designado (D-71; revisao das
 * telas, TELA-9): a dica dos botoes de aprovar e a recusa da action.
 */
export const FRASE_DA_EQUIPE_CONDUZZA =
  "A equipe Conduzza não aprova a orientação de preparo. Só o responsável técnico da clínica aprova.";

/** As frases 42501 que as RPCs mandam, para conferir a que chega do banco. */
const FRASES_42501_DO_BANCO: ReadonlySet<string> = new Set([
  ...Object.values(FRASES_SEM_PERMISSAO),
  FRASE_DA_EQUIPE_CONDUZZA,
]);

// ---------------------------------------------------------------------------
// Os textos da secao e do dialogo
// ---------------------------------------------------------------------------

export const TEXTOS_DO_PREPARO = {
  titulo: "Orientação de preparo",
  ajuda:
    "Enviada ao paciente pela régua de confirmação e pelo assistente exatamente como o responsável técnico aprovou. Só o texto aprovado sai.",
  procedimentoNovo:
    "Salve o procedimento antes de escrever a orientação de preparo.",
  carregando: "Carregando a orientação de preparo...",
  erroAoCarregar: "Não foi possível carregar a orientação de preparo.",
  tentarDeNovo: "Tentar de novo",
  semRt:
    "A clínica não tem responsável técnico ativo. Nenhuma orientação de preparo é enviada.",
  semRtLink: "Definir em Configurações, Equipe",
  semRtSemLink:
    "Quem define é o administrador da clínica, em Configurações, Equipe.",
  semOrientacao:
    "Nenhuma orientação de preparo escrita para este procedimento.",
  emVigor: "Em vigor",
  aguardando: "Texto novo aguardando o RT",
  /** O texto antigo copiado pela migration (D-83), que ninguem escreveu agora. */
  aguardandoTextoAntigo: "Texto do cadastro aguardando o RT",
  aprovadaParada: "Aprovada, sem envio",
  // Revisao curta (CURTA-5): o texto aprovado que as regras de hoje nao
  // deixam sair. O que fazer: escrever de novo e pedir nova aprovacao.
  recusadaPelasRegras:
    "As regras de hoje não deixam este texto sair, e ele não está sendo enviado.",
  escrevaDeNovo:
    "Escreva um texto novo, sem isso, para o responsável técnico aprovar.",
  dicaDoTextoRecusado:
    "As regras de hoje não deixam este texto sair. Escreva um texto novo para o responsável técnico aprovar.",
  suspensa: "Envio suspenso",
  enquantoComVigor:
    "Enquanto o RT não aprova, o texto em vigor continua sendo enviado.",
  enquantoSemVigor: "Enquanto o RT não aprova, nada é enviado.",
  rtMudou:
    "Esta orientação foi aprovada por outro responsável técnico e não está sendo enviada. O responsável técnico de agora precisa aprovar de novo.",
  rtSemAcesso:
    "O responsável técnico está sem acesso ativo, e esta orientação não está sendo enviada.",
  nomeMudou:
    "O nome do procedimento mudou depois da aprovação, e esta orientação não está sendo enviada. O responsável técnico precisa aprovar de novo.",
  escrever: "Escrever orientação",
  escreverNovo: "Escrever texto novo",
  campo: "Texto da orientação de preparo",
  // A ajuda do editor (fechamento entre as frentes da AG7): o que e recusado
  // antes de chegar ao RT e o que so vira aviso para ele conferir (D-80).
  ajudaDoEditorRecusa:
    "Não pode ter link, arroba, valor ou condição de pagamento, promessa de resultado, brinde ou oferta de outro procedimento, frase dizendo que um sintoma é normal ou passa sozinho, nem antes e depois de pacientes.",
  ajudaDoEditorAviso:
    "Pode ter remédio, dose e jejum: antes de aprovar, o responsável técnico vê um aviso para conferir. Nome de remédio e instrução de dose, só com responsável técnico de CRM ou CRO; jejum, água e pedir para informar os medicamentos em uso valem para todos.",
  enviarParaORt: "Enviar para o RT aprovar",
  enviando: "Enviando...",
  cancelar: "Cancelar",
  descartar: "Descartar texto novo",
  descartarTextoAntigo: "Descartar este texto",
  descartando: "Descartando...",
  // A confirmacao do descarte (revisao das telas, TELA-5): grava na hora e
  // o texto sai da tela.
  descartarTitulo: "Descartar o texto novo?",
  descartarTituloTextoAntigo: "Descartar este texto?",
  descartarCorpo: "Ele não vai para o responsável técnico e sai desta tela.",
  descartarCorpoDoRt:
    "Ele não vai para o responsável técnico e sai desta tela. Para pedir uma mudança a quem escreveu, use Devolver, em Revisar e aprovar.",
  descartarConfirmar: "Descartar texto",
  // O texto digitado e nao enviado (revisao das telas, TELA-4): nunca se
  // perde em silencio.
  rascunhoTitulo: "Descartar o que foi digitado?",
  rascunhoAoCancelar:
    "O texto da orientação de preparo ainda não foi enviado para o responsável técnico. Se você cancelar, ele se perde.",
  rascunhoAoFechar:
    "O texto da orientação de preparo ainda não foi enviado para o responsável técnico. Se você fechar, ele se perde.",
  rascunhoAoSalvar:
    "O texto da orientação de preparo ainda não foi enviado para o responsável técnico. O Salvar grava o procedimento, mas não esse texto: para guardar o texto, use antes Enviar para o RT aprovar.",
  continuarEditando: "Continuar editando",
  descartarOTexto: "Descartar o texto",
  descartarEFechar: "Descartar e fechar",
  salvarSemOTexto: "Salvar sem o texto",
  // Outra pessoa salvou enquanto o editor estava aberto (TELA-3): o texto
  // digitado fica, e o texto novo aparece acima antes do proximo envio.
  outraPessoaSalvou:
    "Outra pessoa salvou um texto novo enquanto você escrevia, e ele aparece acima. Leia antes de enviar o seu de novo.",
  outraPessoaSalvouAguardando:
    "Outra pessoa salvou um texto novo enquanto você escrevia, e ele aparece acima, aguardando o RT. Leia antes de enviar o seu de novo: o seu toma o lugar dele.",
  // O texto aguardando escrito com o nome antigo do procedimento (TELA-6):
  // a aprovacao prende o nome, entao ele precisa ser enviado de novo.
  nomeMudouNoAguardando:
    "O nome do procedimento mudou depois que este texto foi escrito. Envie o texto de novo para o responsável técnico aprovar.",
  dicaDoNomeMudou: "Envie o texto de novo com o nome novo antes de aprovar.",
  enviarDeNovo: "Enviar de novo com o nome novo",
  revisar: "Revisar e aprovar",
  aprovarDeNovo: "Aprovar de novo",
  suspender: "Suspender o envio",
  verVersoes: "Ver versões",
  esconderVersoes: "Esconder versões",
  versoesTitulo: "Versões",
  enviado: "Texto enviado para o responsável técnico aprovar.",
  descartado: "Texto novo descartado.",
  suspenso: "Envio da orientação de preparo suspenso.",
  suspenderTitulo: "Suspender o envio da orientação de preparo?",
  suspenderCorpo:
    "A régua deixa de mandar o preparo deste procedimento e o assistente passa a pergunta para a equipe, até o responsável técnico aprovar de novo.",
  voltar: "Voltar",
  suspenderConfirmar: "Suspender envio",
  suspendendo: "Suspendendo...",
  avisoDoNome:
    "Mudar o nome tira a aprovação da orientação de preparo: o responsável técnico precisa aprovar de novo.",
  avisoDoNomeAguardando:
    "Com o nome novo, o texto que espera o responsável técnico precisa ser enviado de novo.",
  filtrarAguardando: "Mostrar só os que esperam sua aprovação",
  mostrarTodos: "Mostrar todos os procedimentos",
  nenhumAguardando: "Nenhum procedimento espera a sua aprovação agora.",
  textoIndisponivel: "Não foi possível carregar este texto.",
  // O dialogo de aprovacao (desenho 5.2)
  comoRecebe: "Como o paciente recebe",
  oQueMudou: "O que mudou desde o texto em vigor",
  oQueMudouDesdeOUltimo: "O que mudou desde o último texto aprovado",
  semTextoEmVigor: "Não há texto em vigor: o texto inteiro é novo.",
  mesmoTexto:
    "O texto é o mesmo que já foi aprovado. A aprovação passa a valer com o responsável técnico e o nome do procedimento de agora.",
  entrou: "Entrou",
  saiu: "Saiu",
  avisoRemedio:
    "Este texto cita remédio, dose ou jejum. Ao aprovar, você confirma que esta orientação vale para todo paciente deste procedimento, sem avaliação individual.",
  avisoDoQueOTextoTem: "Confira o que este texto tem:",
  avisoAoAprovar:
    "Ao aprovar, você confirma que esta orientação vale para todo paciente deste procedimento, sem avaliação individual.",
  conferindo: "Conferindo o texto...",
  caixa:
    "Li o texto inteiro e aprovo esta orientação de preparo como responsável técnico da clínica.",
  marqueACaixa: "Marque a caixa para confirmar que leu o texto inteiro.",
  devolver: "Devolver",
  devolvendo: "Devolvendo...",
  devolverTexto: "Devolver texto",
  comentario: "O que precisa mudar? Até 300 caracteres, sem dados de paciente.",
  aprovar: "Aprovar",
  aprovando: "Aprovando...",
  aprovado:
    "Orientação aprovada. A régua e o assistente passam a enviar este texto.",
  devolvido: "Texto devolvido com o seu comentário.",
  naoEMaisORt: "Você não é mais o responsável técnico desta clínica.",
  rtMudouAoLer:
    "O responsável técnico da clínica mudou enquanto você lia. Feche e abra de novo.",
  // As recusas do "Aprovar de novo" e do aprovar (TELA-1, TELA-11 e CFM-2)
  textoNovoAguardando:
    "Há um texto novo esperando a sua aprovação. Feche e abra de novo para revisar o texto novo.",
  nomeMudouAoLer:
    "O nome do procedimento mudou enquanto você lia. Feche e abra de novo.",
  ficouAguardando: "O texto ficou aguardando o RT.",
  ficouAguardandoSemAprovar:
    "Não foi possível aprovar agora. O texto ficou aguardando o RT: feche e use Revisar e aprovar.",
  naoPodeSerAprovado: "Este texto não pode ser aprovado.",
  // O banco recusou o conteudo (texto_recusado) e o espelho dele
  // (conteudoRecusadoPeloBanco) nao achou o que: as coisas que ele recusa.
  textoRecusadoPeloBanco:
    "Tire do texto o link, o arroba, o valor em reais, os caracteres invisíveis, a frase que diz que um sintoma é normal e a oferta de outro procedimento: a orientação de preparo não pode ter nenhum deles.",
  conselhoNaoAceita:
    "Este texto cita remédio ou dose, e só responsável técnico de CRM ou CRO pode salvar ou aprovar texto assim. Tire o remédio e a dose do texto ou peça ao administrador para definir um responsável técnico de CRM ou CRO.",
} as const;

/**
 * O que o texto tem, em frase de recepcao, para o aviso do dialogo do RT (cada
 * categoria nomeada, sem repetir: triagem e diagnostico sao "fala de sintoma").
 * A categoria desconhecida nao some: vira a frase geral.
 */
const ROTULO_DO_AVISO: Readonly<Record<string, string>> = {
  medicamento: "cita remédio",
  dosagem: "cita dose",
  triagem: "fala de sintoma",
  diagnostico: "fala de sintoma",
  orientacao_clinica: "cita jejum ou outro cuidado",
};

export function rotulosDosAvisos(avisos: readonly string[]): string[] {
  return [
    ...new Set(
      avisos.map((categoria) =>
        Object.hasOwn(ROTULO_DO_AVISO, categoria)
          ? (ROTULO_DO_AVISO[categoria] as string)
          : "tem conteúdo clínico",
      ),
    ),
  ];
}

export function aprovarTitulo(procedimento: string): string {
  return `Aprovar orientação de preparo de ${procedimento}`;
}

/**
 * O texto como vai para a action e para o banco (TELA-8): a tabulacao (o
 * recuo da tecla Tab, que a lista numerada colada do Word traz, como em
 * "1.<Tab>Jejum de 8 horas.") vira espaco, e depois a normalizacao do banco
 * (normalizarTextoDoPreparo: CR para LF, NFC e as pontas). O banco continua
 * recusando a tabulacao crua; ela so nunca chega la.
 */
export function prepararTextoDoPreparo(texto: string): string {
  return normalizarTextoDoPreparo(texto.replace(/\t/g, " "));
}

/** "{n} de 3.500" (pontos de codigo do texto como vai para o banco). */
export function contadorDoTexto(texto: string): string {
  const tamanho = Array.from(prepararTextoDoPreparo(texto)).length;
  return `${tamanho.toLocaleString("pt-BR")} de ${LIMITE_DO_TEXTO_DO_PREPARO.toLocaleString("pt-BR")}`;
}

/** A faixa do RT no topo da aba Procedimentos. */
export function faixaDoRt(quantos: number): string {
  return quantos === 1
    ? "Há 1 orientação de preparo esperando sua aprovação."
    : `Há ${quantos} orientações de preparo esperando sua aprovação.`;
}

/** "Dra. Ana Souza (CRM-CE 12345)": o registro como a mensagem mostra. */
export function registroDoRt(rt: {
  nome: string;
  conselho: string;
  uf: string;
  numero: string;
}): string {
  return `${rt.nome} (${rt.conselho}-${rt.uf} ${rt.numero})`;
}

/** "27/10/2026" no fuso da clinica (regra 3.6). Vazio quando nao le. */
export function dataNoFuso(iso: string, timezone: string): string {
  const instante = new Date(iso).getTime();
  if (Number.isNaN(instante)) {
    return "";
  }
  return format(new TZDate(instante, timezone), "dd/MM/yyyy", { locale: ptBR });
}

/** "27/10/2026 às 14:32" no fuso da clinica (regra 3.6). */
export function dataEHoraNoFuso(iso: string, timezone: string): string {
  const instante = new Date(iso).getTime();
  if (Number.isNaN(instante)) {
    return "";
  }
  return format(new TZDate(instante, timezone), "dd/MM/yyyy 'às' HH:mm", {
    locale: ptBR,
  });
}

export function aprovadaPor(
  registro: string,
  quando: string,
  codigo: string,
): string {
  return `Aprovada por ${registro} em ${quando}. Código do texto: ${codigo}.`;
}

export function escritoPor(nome: string, quando: string): string {
  return `Escrito por ${nome} em ${quando}.`;
}

export function textoAntigo(quando: string): string {
  return `Texto que já estava no cadastro do procedimento, copiado em ${quando} para o responsável técnico revisar.`;
}

export function devolvidoPeloRt(quando: string, comentario: string): string {
  return `O responsável técnico devolveu o texto de ${quando}: ${comentario}`;
}

export function suspensoDesde(quando: string): string {
  return `O envio está suspenso desde ${quando}. Para voltar a enviar, o responsável técnico aprova de novo.`;
}

/** Quem escreveu, aprovou ou encerrou, sem o nome lido (saiu da clinica). */
export const PESSOA_SEM_NOME = "uma pessoa da equipe";

/** A situacao de cada versao na lista "Ver versoes" (texto, sem cor). */
export const ROTULO_DA_SITUACAO: Record<SituacaoDoPreparo, string> = {
  aguardando_rt: "Aguardando o RT",
  aprovado: "Aprovada",
  devolvido: "Devolvida pelo RT",
  descartado: "Descartada",
  substituido: "Substituída por outra aprovada",
  suspenso: "Envio suspenso",
};

// ---------------------------------------------------------------------------
// A conferencia do texto antes da RPC (a mesma no navegador e na action)
// ---------------------------------------------------------------------------

const MAXIMO_DO_TRECHO = 60;

/**
 * O trecho do texto entre aspas, curto: os brancos viram um espaco so, e o
 * que passa de 60 caracteres corta na ultima palavra inteira, com "...".
 */
export function citarTrecho(trecho: string): string {
  const limpo = trecho.replace(/\s+/gu, " ").trim();
  const pontos = Array.from(limpo);
  if (pontos.length <= MAXIMO_DO_TRECHO) {
    return `“${limpo}”`;
  }
  const corte = pontos.slice(0, MAXIMO_DO_TRECHO).join("");
  const espaco = corte.lastIndexOf(" ");
  const curto = espaco > MAXIMO_DO_TRECHO / 2 ? corte.slice(0, espaco) : corte;
  return `“${curto.replace(/[\s.,;:!?]+$/u, "")}...”`;
}

/**
 * As frases de um texto da clinica, na ordem: o corte e no fim de frase
 * (ponto, exclamacao, interrogacao, ponto e virgula, dois pontos ou
 * reticencias seguidos de branco) e na quebra de linha. "18:00" e "0,9" nao
 * cortam. E so para a tela apontar o trecho de uma recusa.
 */
export function frasesDoTexto(texto: string): string[] {
  return texto
    .split(/(?<=[.!?;:…])\s+|\n+/u)
    .map((frase) => frase.trim())
    .filter((frase) => frase !== "");
}

// Os caracteres que o CHECK recusa alem das chaves: o controle (menos o
// "\n") e os invisiveis. ESPELHO de CONTROLE_NO_TEXTO e INVISIVEL_NO_TEXTO
// (lib/domain/preparo.ts, privados la), so para a frase dizer ONDE esta o
// caractere: quem decide se o texto vale e textoDoPreparoValido, e sem achar
// o caractere aqui a frase e a geral.
const CARACTERE_RECUSADO =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]/u;

// O emoji com juncao (a medica: U+1F469, U+200D e U+2695): uma figura so na
// tela, que leva o U+200D, um dos invisiveis que o banco recusa.
const EMOJI_COM_JUNCAO =
  /\p{Extended_Pictographic}[\ufe0f\u{1f3fb}-\u{1f3ff}]?(?:\u200d\p{Extended_Pictographic}[\ufe0f\u{1f3fb}-\u{1f3ff}]?)+/u;

const FRASE_DO_INVISIVEL =
  "Tire os caracteres invisíveis do texto (copie de novo, sem formatação).";

/**
 * A frase do caractere que o banco recusa, dizendo qual e onde (TELA-8): o
 * emoji com juncao pelo proprio emoji; os outros pela linha e pelas palavras
 * que vem logo antes (o invisivel nao aparece na tela). Sem achar, a frase
 * geral.
 */
export function fraseDoCaractereRecusado(texto: string): string {
  const emoji = EMOJI_COM_JUNCAO.exec(texto);
  if (emoji) {
    return fraseDoEmoji(emoji[0]);
  }
  const achado = CARACTERE_RECUSADO.exec(texto);
  if (!achado) {
    return FRASE_DO_INVISIVEL;
  }
  return fraseDaLinhaDoCaractere(texto, achado.index);
}

function fraseDoEmoji(emoji: string): string {
  return `Tire o emoji ${emoji}: ele leva um caractere invisível, que não pode ir na orientação de preparo.`;
}

/** A linha e as palavras logo antes da posicao (o invisivel nao aparece). */
function fraseDaLinhaDoCaractere(texto: string, posicao: number): string {
  const antes = texto.slice(0, posicao);
  const linha = antes.split("\n").length;
  const palavras = antes
    .slice(antes.lastIndexOf("\n") + 1)
    .split(/\s+/u)
    .filter((palavra) => palavra !== "")
    .slice(-4)
    .join(" ");
  return palavras === ""
    ? `Tire o caractere invisível do começo da linha ${linha}: apague e escreva de novo o começo dessa linha.`
    : `Tire o caractere invisível da linha ${linha}, logo depois de ${citarTrecho(palavras)}: apague e escreva de novo esse pedaço.`;
}

/**
 * O emoji (o agrupamento que a pessoa ve) que leva o caractere da posicao,
 * ou null: o emoji de tecla ("1" com o seletor de variacao e a moldura) e
 * um so desenho na tela, e a pessoa acha o emoji, nao o invisivel.
 */
function emojiDaPosicao(texto: string, posicao: number): string | null {
  if (typeof Intl === "undefined" || !("Segmenter" in Intl)) {
    return null;
  }
  const segmentador = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
  for (const { segment, index } of segmentador.segment(texto)) {
    if (posicao >= index && posicao < index + segment.length) {
      return Array.from(segment).length > 1 &&
        /\p{Extended_Pictographic}|\u20e3/u.test(segment)
        ? segment
        : null;
    }
  }
  return null;
}

/**
 * Revisao curta da AG7 (CURTA-6): o nome do procedimento ou do RT com um
 * caractere invisivel ou uma marca de direcao (o que preparo_nome_valido
 * recusa; comum no nome colado de um site), em frase que diz o que tirar e
 * onde: o emoji que leva o invisivel pelo proprio emoji; o resto pelas
 * palavras logo antes (o invisivel nao aparece na tela). null: o nome nao
 * tem nenhum. `de`: o nome do procedimento no envio do texto ao RT
 * ("procedimento"), o do RT ("rt") ou o do procedimento no proprio Salvar
 * de Cadastros ("cadastro", a sobra da revisao curta).
 */
export function fraseDoNomeComInvisivel(
  nome: string,
  de: "procedimento" | "rt" | "cadastro",
): string | null {
  const achado = invisivelNoNome(nome);
  if (achado === null) {
    return null;
  }
  const doNome = de === "rt" ? "do nome" : "do nome do procedimento";
  const depois =
    de === "procedimento"
      ? ", salve o procedimento e envie o texto de novo."
      : de === "cadastro"
        ? " e salve de novo."
        : ".";
  const emoji = emojiDaPosicao(nome, achado.posicao);
  if (emoji) {
    return `Tire o emoji ${emoji} ${doNome}: ele leva um caractere invisível, que não pode ir na mensagem ao paciente. Apague o emoji${depois}`;
  }
  const palavras = nome
    .slice(0, achado.posicao)
    .split(/\s+/u)
    .filter((palavra) => palavra !== "")
    .slice(-4)
    .join(" ");
  return palavras === ""
    ? `Tire o caractere invisível do começo ${doNome}: apague e escreva de novo o começo do nome${depois}`
    : `Tire o caractere invisível ${doNome}, logo depois de ${citarTrecho(palavras)}: apague e escreva de novo esse pedaço do nome${depois}`;
}

/**
 * O nome do procedimento com a tabulacao ou outro caractere de controle
 * colado de outro lugar (o resto do que preparo_nome_valido recusa; o
 * formulario ja tira a quebra de linha).
 */
export const FRASE_DO_NOME_COM_CONTROLE =
  "O nome do procedimento tem uma tabulação ou outro caractere colado de outro lugar. Apague o nome, escreva de novo e salve.";

/**
 * Revisao curta da AG7 (a sobra da CURTA-6): o nome no Salvar do
 * procedimento em Cadastros (a tela, antes de gravar qualquer coisa, e a
 * action salvarProcedimentoAction, de novo). O nome vai no cabecalho da
 * orientacao de preparo e nas mensagens ao paciente, e o banco o recusa no
 * preparo (preparo_nome_valido: invisivel, marca de direcao e controle):
 * sem conferir aqui, o procedimento era salvo e o texto dele nunca chegava
 * ao RT. O espelho nomeDoPreparoValido decide; a frase diz o que tirar (o
 * invisivel pelas palavras logo antes ou pelo emoji que o leva). null: o
 * nome vale para o preparo (o tamanho e as pontas sao do formulario e do
 * Zod, que conferem antes).
 */
export function problemaNoNomeDoProcedimento(nome: string): string | null {
  if (nomeDoPreparoValido(nome)) {
    return null;
  }
  const invisivel = fraseDoNomeComInvisivel(nome, "cadastro");
  if (invisivel !== null) {
    return invisivel;
  }
  return controleNoNome(nome) ? FRASE_DO_NOME_COM_CONTROLE : null;
}

/**
 * O conteudo que o banco recusa (preparo_texto_recusado, pelo espelho
 * conteudoRecusadoPeloBanco) em frase de recepcao, dizendo o que tirar e
 * onde: o link, o valor em reais e o arroba pelo trecho; o invisivel pela
 * linha e pelas palavras de antes (ou pelo emoji que o leva). Null: nada.
 */
const FRASE_DO_CONTEUDO_RECUSADO = {
  link: "tire o link (o endereço de site, como www ou .com.br): o paciente recebe só o texto.",
  valor_em_reais:
    "tire o valor em reais: o preço não vai na orientação de preparo.",
  arroba: "tire o arroba (como @clinica): o paciente recebe só o texto.",
  sintoma_normalizado:
    "tire a avaliação de sintoma (dizer que um sintoma é normal, esperado ou passa sozinho): a orientação de preparo não avalia sintomas (Resolução CFM 2.314/2022).",
  oferta_de_outro_procedimento:
    "tire a oferta de outro procedimento: a orientação de preparo não oferece nada junto.",
} as const;

/** Revisao final da AG7: a recusa pelo conselho, com o trecho que barrou. */
export function fraseDoConselho(trecho: string | null): string {
  return trecho === null
    ? TEXTOS_DO_PREPARO.conselhoNaoAceita
    : `${TEXTOS_DO_PREPARO.conselhoNaoAceita} O trecho que barrou: ${citarTrecho(trecho)}.`;
}

export function frasesDoConteudoRecusado(
  texto: string,
  itens: readonly ConteudoRecusadoPeloBanco[],
): string | null {
  if (itens.length === 0) {
    return null;
  }
  const frases = itens.map((item) => {
    if (item.causa === "invisivel") {
      const emoji = emojiDaPosicao(texto, item.posicao);
      return emoji
        ? fraseDoEmoji(emoji)
        : fraseDaLinhaDoCaractere(texto, item.posicao);
    }
    const base = FRASE_DO_CONTEUDO_RECUSADO[item.causa];
    return item.trecho
      ? `No trecho ${citarTrecho(item.trecho)}, ${base}`
      : base.charAt(0).toLocaleUpperCase("pt-BR") + base.slice(1);
  });
  return [...new Set(frases)].join(" ");
}

/**
 * O problema do texto como o banco o guardaria (prepararTextoDoPreparo), ou
 * null: o espelho de preparo_texto_valido em frase de recepcao, dizendo o
 * que tirar. As recusas de conteudo (promessa, oferta casada, preco, link)
 * sao do servidor (problemasDoTextoDoPreparo) e chegam pela action.
 */
export function problemaNoTextoDoPreparo(texto: string): string | null {
  const normalizado = prepararTextoDoPreparo(texto);
  if (normalizado === "") {
    return "Escreva a orientação de preparo.";
  }
  if (Array.from(normalizado).length > LIMITE_DO_TEXTO_DO_PREPARO) {
    return "A orientação de preparo pode ter até 3.500 caracteres.";
  }
  if (normalizado.includes("{{") || normalizado.includes("}}")) {
    return "Tire as chaves {{ e }} do texto: elas não podem ir na orientação de preparo.";
  }
  if (!textoDoPreparoValido(normalizado)) {
    return fraseDoCaractereRecusado(normalizado);
  }
  return null;
}

/**
 * A frase de cada categoria que problemasDoTextoDoPreparo RECUSA (D-80: o
 * remedio, a dose e o jejum so avisam; promessa, oferta casada, antes e
 * depois, preco e link nunca entram, nem aprovados pelo RT), com exemplos
 * do que conta, para quem escreve achar o que tirar. Da triagem, a
 * normalizacao de sintoma recusa desde 05/11/2026; o diagnostico so avisa, e a
 * frase dele existe para o dia em que recusar (CFM-3).
 */
const FRASE_DA_RECUSA: Record<string, string> = {
  promessa_resultado:
    "Tire a promessa de resultado (palavras como garantir, 100%, sem dor ou definitivo): a orientação de preparo não pode prometer resultado (Resolução CFM 2.336/2023).",
  oferta_casada:
    "Tire a oferta de brinde ou de outro procedimento (palavras como grátis, brinde, pacote, combo, promoção ou kit, ou frases como aproveite e faça também): a orientação de preparo não oferece nada junto.",
  antes_depois:
    "Tire a menção a antes e depois (fotos, vídeos ou depoimentos de pacientes): a orientação de preparo não pode mostrar resultado (Resolução CFM 2.336/2023).",
  preco_nao_verificado:
    "Tire o valor e as condições de pagamento (R$, desconto ou parcelas): o preço não vai na orientação de preparo.",
  formato_invalido:
    "Tire o link, o arroba e os caracteres fora do comum: o paciente recebe só o texto (escreva mcg no lugar de µg).",
  triagem:
    "Tire a avaliação de sintoma (dizer se um sintoma é normal, esperado, grave ou passa sozinho): a orientação de preparo não avalia sintomas (Resolução CFM 2.314/2022).",
  diagnostico:
    "Tire o diagnóstico (dizer o que a pessoa tem ou pode ter): a orientação de preparo não faz diagnóstico.",
};

const FRASE_DA_RECUSA_SEM_NOME = "Confira o texto da orientação de preparo.";

function comMinusculaNoComeco(frase: string): string {
  return frase.charAt(0).toLocaleLowerCase("pt-BR") + frase.slice(1);
}

/**
 * As frases das recusas, sem repetir, na ordem que vieram; null sem recusa.
 * Com o trecho em que cada recusa foi achada (a action confere frase a
 * frase, no servidor), a frase diz onde: "No trecho “...”, tire ...".
 */
export function frasesDasRecusas(
  recusas: readonly string[],
  trechos: Readonly<Record<string, string>> = {},
): string | null {
  if (recusas.length === 0) {
    return null;
  }
  const frases = recusas.map((categoria) => {
    const base = Object.hasOwn(FRASE_DA_RECUSA, categoria)
      ? (FRASE_DA_RECUSA[categoria] ?? FRASE_DA_RECUSA_SEM_NOME)
      : FRASE_DA_RECUSA_SEM_NOME;
    const trecho = Object.hasOwn(trechos, categoria)
      ? trechos[categoria]
      : undefined;
    return trecho
      ? `No trecho ${citarTrecho(trecho)}, ${comMinusculaNoComeco(base)}`
      : base;
  });
  return [...new Set(frases)].join(" ");
}

// ---------------------------------------------------------------------------
// Os erros das RPCs em frase de recepcao (contrato 4.6, "Traducao dos codigos")
// ---------------------------------------------------------------------------

export type AcaoDoPreparo =
  "salvar" | "aprovar" | "devolver" | "descartar" | "suspender";

/**
 * O que a tela faz com a recusa: "sem_permissao" (42501; no dialogo do RT
 * vira "Voce nao e mais o responsavel tecnico desta clinica."), os codigos
 * de quem chegou depois (a tela recarrega o que mostra) e os da propria
 * action: "texto_novo_aguardando" (o "Aprovar de novo" com texto novo
 * esperando o RT), "ficou_aguardando" (o "Aprovar de novo" salvou e nao
 * aprovou), "texto_recusado" (as regras de hoje recusam o texto, ou o banco
 * recusou o conteudo: o codigo texto_recusado das RPCs de salvar e de
 * aprovar) e "versao_inexistente" (a versao sumiu ou e de outra clinica).
 */
export type CodigoDaRecusa =
  | "sem_permissao"
  | "texto_mudou"
  | "texto_igual_ao_em_vigor"
  | "nao_aguarda_aprovacao"
  | "nome_mudou"
  | "outra_aprovacao"
  | "sem_preparo_aprovado"
  | "versao_inexistente"
  | "texto_novo_aguardando"
  | "ficou_aguardando"
  | "texto_recusado"
  | "conselho_nao_aceita_remedio_ou_dose";

export type RecusaDoPreparo = {
  ok: false;
  error: string;
  code?: CodigoDaRecusa;
};

const ERRO_DE_SEMPRE: Record<AcaoDoPreparo, string> = {
  salvar: "Não foi possível salvar agora. Tente de novo.",
  aprovar: "Não foi possível aprovar agora. Tente de novo.",
  devolver: "Não foi possível devolver agora. Tente de novo.",
  descartar: "Não foi possível descartar agora. Tente de novo.",
  suspender: "Não foi possível suspender agora. Tente de novo.",
};

export function erroDeSempre(acao: AcaoDoPreparo): string {
  return ERRO_DE_SEMPRE[acao];
}

const FRASE_DO_CODIGO: Record<string, string> = {
  texto_igual_ao_em_vigor: "Este texto já é o que está valendo.",
  nao_aguarda_aprovacao:
    "Este texto não está mais esperando aprovação. Feche e abra de novo.",
  nome_mudou:
    "O nome do procedimento mudou. Salve o texto de novo para o responsável técnico aprovar.",
  outra_aprovacao: "Outro texto foi aprovado agora. Feche e abra de novo.",
  sem_preparo_aprovado: "Não há orientação aprovada para suspender.",
  procedimento_inexistente: "Procedimento não encontrado.",
  versao_inexistente: "Este texto não foi encontrado. Feche e abra de novo.",
  texto_invalido: "Confira o texto da orientação de preparo.",
  // Sem o texto na mao (a action troca pela frase com o trecho antes daqui).
  texto_recusado: TEXTOS_DO_PREPARO.textoRecusadoPeloBanco,
  nome_do_procedimento_invalido:
    "Confira o nome do procedimento antes de escrever a orientação de preparo.",
  comentario_invalido: "Escreva o que precisa mudar, em até 300 caracteres.",
  conselho_nao_aceita_remedio_ou_dose: TEXTOS_DO_PREPARO.conselhoNaoAceita,
};

const CODIGOS_DA_TELA: ReadonlySet<string> = new Set([
  "texto_mudou",
  "texto_igual_ao_em_vigor",
  "nao_aguarda_aprovacao",
  "nome_mudou",
  "outra_aprovacao",
  "sem_preparo_aprovado",
  "versao_inexistente",
  "texto_recusado",
  "conselho_nao_aceita_remedio_ou_dose",
]);

/** A frase 42501 de cada acao: a que a RPC dela manda. */
const FRASE_42501_DA_ACAO: Record<AcaoDoPreparo, string> = {
  salvar: FRASES_SEM_PERMISSAO.escrever,
  aprovar: FRASES_SEM_PERMISSAO.aprovar,
  devolver: FRASES_SEM_PERMISSAO.aprovar,
  descartar: FRASES_SEM_PERMISSAO.descartar,
  suspender: FRASES_SEM_PERMISSAO.suspender,
};

/**
 * A recusa do banco (error.code e o SQLSTATE; error.message e o codigo de
 * negocio ou, no 42501, a frase pronta) em frase de recepcao. O texto_mudou
 * tem duas frases: quem salva chegou depois de outro Salvar; quem aprova leu
 * um texto que mudou. O 42501 so mostra a frase do banco quando ela e uma
 * das quatro das RPCs (TELA-10): o texto tecnico do Postgres ("permission
 * denied for function ...", o grant que faltou) vira a frase da acao. Sem
 * traducao: a frase de sempre da acao.
 */
export function traduzirErroDoPreparo(
  acao: AcaoDoPreparo,
  erro: { code?: string | null; message?: string | null },
): RecusaDoPreparo {
  const mensagem = erro.message ?? "";
  if (erro.code === "42501") {
    return {
      ok: false,
      error: FRASES_42501_DO_BANCO.has(mensagem)
        ? mensagem
        : FRASE_42501_DA_ACAO[acao],
      code: "sem_permissao",
    };
  }
  if (mensagem === "texto_mudou") {
    return {
      ok: false,
      error:
        acao === "salvar"
          ? "Outra pessoa salvou um texto novo agora. Feche e abra de novo."
          : "O texto mudou enquanto você lia. Feche e abra de novo.",
      code: "texto_mudou",
    };
  }
  // O codigo vem do banco: so a chave propria do mapa conta (nunca o
  // prototipo, como "constructor").
  const frase = Object.hasOwn(FRASE_DO_CODIGO, mensagem)
    ? FRASE_DO_CODIGO[mensagem]
    : undefined;
  if (frase !== undefined && (erro.code === "P0001" || erro.code === "22023")) {
    return CODIGOS_DA_TELA.has(mensagem)
      ? { ok: false, error: frase, code: mensagem as CodigoDaRecusa }
      : { ok: false, error: frase };
  }
  return { ok: false, error: erroDeSempre(acao) };
}

// ---------------------------------------------------------------------------
// A diferenca entre o texto em vigor e o novo (o dialogo de aprovacao)
// ---------------------------------------------------------------------------

export type LinhaDaDiferenca = {
  tipo: "igual" | "entrou" | "saiu";
  texto: string;
};

/**
 * A diferenca linha a linha (a maior subsequencia comum): o que saiu do texto
 * em vigor e o que entrou no novo, na ordem do texto. Conteudo, nao status:
 * a tela mostra "Entrou" e "Saiu" em texto, sem icone colorido.
 */
export function diferencaDasLinhas(
  antigo: string,
  novo: string,
): LinhaDaDiferenca[] {
  const a = antigo.split("\n");
  const b = novo.split("\n");
  const largura = b.length + 1;
  // tabela[i * largura + j]: o tamanho da subsequencia comum de a[i..] e b[j..]
  const tabela = new Array<number>((a.length + 1) * largura).fill(0);
  const em = (i: number, j: number): number => tabela[i * largura + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      tabela[i * largura + j] =
        a[i] === b[j]
          ? em(i + 1, j + 1) + 1
          : Math.max(em(i + 1, j), em(i, j + 1));
    }
  }
  const linhas: LinhaDaDiferenca[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const daqui = a[i] ?? "";
    const dali = b[j] ?? "";
    if (daqui === dali) {
      linhas.push({ tipo: "igual", texto: daqui });
      i += 1;
      j += 1;
    } else if (em(i + 1, j) >= em(i, j + 1)) {
      linhas.push({ tipo: "saiu", texto: daqui });
      i += 1;
    } else {
      linhas.push({ tipo: "entrou", texto: dali });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) {
    linhas.push({ tipo: "saiu", texto: a[i] ?? "" });
  }
  for (; j < b.length; j += 1) {
    linhas.push({ tipo: "entrou", texto: b[j] ?? "" });
  }
  return linhas;
}
