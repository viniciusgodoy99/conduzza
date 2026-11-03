import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import {
  LIMITE_DO_TEXTO_DO_PREPARO,
  normalizarTextoDoPreparo,
  textoDoPreparoValido,
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
  aprovadaParada: "Aprovada, sem envio",
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
  enviarParaORt: "Enviar para o RT aprovar",
  enviando: "Enviando...",
  cancelar: "Cancelar",
  descartar: "Descartar texto novo",
  descartando: "Descartando...",
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
  filtrarAguardando: "Mostrar só Aguardando o RT",
  mostrarTodos: "Mostrar todos os procedimentos",
  nenhumAguardando: "Nenhum procedimento espera a sua aprovação agora.",
  // O dialogo de aprovacao (desenho 5.2)
  comoRecebe: "Como o paciente recebe",
  oQueMudou: "O que mudou desde o texto em vigor",
  semTextoEmVigor: "Não há texto em vigor: o texto inteiro é novo.",
  mesmoTexto:
    "O texto é o mesmo que já foi aprovado. A aprovação passa a valer com o responsável técnico e o nome do procedimento de agora.",
  entrou: "Entrou",
  saiu: "Saiu",
  avisoRemedio:
    "Este texto cita remédio, dose ou jejum. Ao aprovar, você confirma que esta orientação vale para todo paciente deste procedimento, sem avaliação individual.",
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
} as const;

export function aprovarTitulo(procedimento: string): string {
  return `Aprovar orientação de preparo de ${procedimento}`;
}

/** "{n} de 3.500" (pontos de codigo do texto ja normalizado). */
export function contadorDoTexto(texto: string): string {
  const tamanho = Array.from(normalizarTextoDoPreparo(texto)).length;
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

/**
 * O problema do texto como o banco o guardaria (normalizado), ou null: o
 * espelho de preparo_texto_valido em frase de recepcao. As recusas de
 * conteudo (promessa, oferta casada, preco, link) sao do servidor
 * (problemasDoTextoDoPreparo) e chegam pela action.
 */
export function problemaNoTextoDoPreparo(texto: string): string | null {
  const normalizado = normalizarTextoDoPreparo(texto);
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
    return "Tire os caracteres invisíveis do texto (copie de novo, sem formatação).";
  }
  return null;
}

/**
 * A frase de cada categoria que problemasDoTextoDoPreparo RECUSA (D-80: o
 * remedio, a dose e o jejum so avisam; promessa, oferta casada, antes e
 * depois, preco e link nunca entram, nem aprovados pelo RT).
 */
const FRASE_DA_RECUSA: Record<string, string> = {
  promessa_resultado:
    "Tire a promessa de resultado: a orientação de preparo não pode prometer resultado (Resolução CFM 2.336/2023).",
  oferta_casada:
    "Tire a oferta de brinde ou de outro procedimento: a orientação de preparo não oferece nada junto (a palavra kit também conta como oferta).",
  antes_depois:
    "Tire a menção a antes e depois: a orientação de preparo não pode mostrar resultado (Resolução CFM 2.336/2023).",
  preco_nao_verificado:
    "Tire o valor e as condições de pagamento: o preço não vai na orientação de preparo.",
  formato_invalido:
    "Tire o link, o arroba e os caracteres fora do comum: o paciente recebe só o texto (escreva mcg no lugar de µg).",
};

const FRASE_DA_RECUSA_SEM_NOME = "Confira o texto da orientação de preparo.";

/** As frases das recusas, sem repetir, na ordem que vieram; null sem recusa. */
export function frasesDasRecusas(recusas: readonly string[]): string | null {
  if (recusas.length === 0) {
    return null;
  }
  const frases = [
    ...new Set(
      recusas.map((r) => FRASE_DA_RECUSA[r] ?? FRASE_DA_RECUSA_SEM_NOME),
    ),
  ];
  return frases.join(" ");
}

// ---------------------------------------------------------------------------
// Os erros das RPCs em frase de recepcao (contrato 4.6, "Traducao dos codigos")
// ---------------------------------------------------------------------------

export type AcaoDoPreparo =
  "salvar" | "aprovar" | "devolver" | "descartar" | "suspender";

/**
 * O que a tela faz com a recusa: "sem_permissao" (42501; no dialogo do RT
 * vira "Voce nao e mais o responsavel tecnico desta clinica.") e os codigos
 * de quem chegou depois (a tela recarrega o que mostra).
 */
export type CodigoDaRecusa =
  | "sem_permissao"
  | "texto_mudou"
  | "texto_igual_ao_em_vigor"
  | "nao_aguarda_aprovacao"
  | "nome_mudou"
  | "outra_aprovacao"
  | "sem_preparo_aprovado";

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
  nome_do_procedimento_invalido:
    "Confira o nome do procedimento antes de escrever a orientação de preparo.",
  comentario_invalido: "Escreva o que precisa mudar, em até 300 caracteres.",
};

const CODIGOS_DA_TELA: ReadonlySet<string> = new Set([
  "texto_mudou",
  "texto_igual_ao_em_vigor",
  "nao_aguarda_aprovacao",
  "nome_mudou",
  "outra_aprovacao",
  "sem_preparo_aprovado",
]);

/**
 * A recusa do banco (error.code e o SQLSTATE; error.message e o codigo de
 * negocio ou, no 42501, a frase pronta) em frase de recepcao. O texto_mudou
 * tem duas frases: quem salva chegou depois de outro Salvar; quem aprova leu
 * um texto que mudou. Sem traducao: a frase de sempre da acao.
 */
export function traduzirErroDoPreparo(
  acao: AcaoDoPreparo,
  erro: { code?: string | null; message?: string | null },
): RecusaDoPreparo {
  const mensagem = erro.message ?? "";
  if (erro.code === "42501") {
    return {
      ok: false,
      error: mensagem.trim() === "" ? erroDeSempre(acao) : mensagem,
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
  const frase = FRASE_DO_CODIGO[mensagem];
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
