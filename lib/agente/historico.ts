import type { SupabaseClient } from "@supabase/supabase-js";

import { ErroComCodigoDeJob } from "@/lib/jobs/erro-de-job";

import {
  MENSAGENS_NO_HISTORICO,
  type AutoriaDaClinica,
  type MensagemDaConversa,
} from "./laco";
import { MARCA_DO_NOME } from "./marca-do-nome";
import type { AberturaDaJanela } from "./whatsapp";

// Historico da conversa do WhatsApp para o turno da IA (E3), lido do banco
// pela service role com clinic_id explicito (o isolamento por clinica e no
// codigo aqui, como em contexto.ts).
//
// O que entra (plano do E3, secao 2.1, passo 7; contrato 3.4):
//  - so mensagens da JANELA (created_at >= ia_janela_da_conversa.desde): a IA
//    nunca le o que veio antes de a conversa entrar nela (nem o historico de
//    um paciente cujo telefone virou o da equipe). EXCECAO (revisao do E3,
//    concorrencia 5): janela aberta pela INGESTAO e de conversa que nasceu
//    naquela chamada, entao nao ha nada antes dela; o `desde` e o now() do
//    inicio da transacao que criou a conversa, e a mensagem de uma rajada
//    cuja transacao comecou um pouco antes fica com created_at < desde. Nesse
//    caso a conversa inteira entra (sem o filtro por desde). Na janela do
//    Devolver, na do horario (onda 2) e na de valor desconhecido o filtro
//    vale sempre (falha fechada);
//  - sem nota interna, sem evento, sem mensagem apagada e sem a resposta
//    automatica do app WhatsApp Business (pelo_celular com autor 'sistema'),
//    filtrados ANTES do limite de MENSAGENS_NO_HISTORICO;
//  - paciente vira "paciente"; ia, usuario e sistema viram "assistente"
//    (revisao da AG4: com a autoria real em `autoria`, que so o servidor le
//    e nunca vai a OpenAI);
//  - texto com media_url (video, localizacao e cartao chegam como texto) e
//    corpo vazio viram midia: o portao de entrada escala. Audio vai sem a
//    transcricao (escala como midia);
//  - o nome do contato (inteiro e o primeiro nome, sem diferenciar
//    maiusculas e acentos) vira MARCA_DO_NOME ("Fulano") em todas as
//    mensagens, no `texto`, que e o que vai a OpenAI. Palavra comum, SEM
//    colchete nem sinal de marcacao: o portao de entrada
//    (manipulacao/marcacao) e a regra de saida (formato_invalido/marcacao)
//    tratam "[", "]", "<", ">", "{", "}" como tentativa de mexer no
//    envelope. Com "[nome]", toda mensagem em que a pessoa escrevia o
//    proprio nome escalava como manipulacao, e o modelo repetindo o
//    marcador tinha a resposta barrada;
//  - a mensagem de texto do contato leva tambem o texto ORIGINAL
//    (textoOriginal), que so o portao de entrada deterministico le (laco.ts,
//    local e sem rede). Revisao de producao de 19/10/2026 (achado de
//    seguranca): com o portao no texto mascarado, uma contato chamada
//    Socorro que escrevia "socorro, me ajuda" chegava ao portao como
//    "Fulano, me ajuda" e nao escalava. O original nunca vai para a OpenAI
//    nem para log; as neutralizacoes do portao (Q4: "aqui e a Socorro")
//    valem nele.
//
// PENDENTE e a mensagem do paciente da janela que nenhum turno encerrado
// respondeu: o id nao esta em ai_turno.mensagens_lidas de um turno 'enviado'
// ou 'passou_para_equipe' da conversa, nem de OUTRO job 'decidido' (esse ja
// vai responder). Por id, nunca por horario. As pendentes vao para o FIM da
// lista, na ordem em que chegaram: assim mensagensPendentes do laco (as do
// paciente depois da ultima fala do assistente) enxerga exatamente esse
// conjunto, mesmo quando a resposta de um turno anterior saiu depois de uma
// mensagem nova.
//
// Revisao curta das correcoes da AG4 (achados 2 e 8): por isso (as
// pendentes no fim, sem as apagadas nem a resposta automatica, e o texto com
// a mascara do nome), a conferencia da pergunta do cancelamento e da
// remarcacao NAO usa a mensagem logo antes das pendentes daqui: ela le a
// saida logo antes da resposta da pessoa pela porta da agenda
// (lerSaidaAntesDaRespostaDaIa, lib/agente/agenda.ts), pela ordem real, com
// as mesmas saidas que o banco conta e o corpo original.
//
// Nada daqui vai para log.

export type EntradaDoHistorico = {
  clinicId: string;
  conversationId: string;
  /** ia_janela_da_conversa.desde (ISO). So mensagens com created_at >= desde. */
  desde: string;
  /**
   * ia_janela_da_conversa.aberta_por. So 'ingestao' (conversa nova, nada
   * antes dela) le a conversa inteira, sem o filtro por desde. 'devolver',
   * 'horario' (onda 2: a retomada no horario do assistente) e
   * 'desconhecida' (valor que o codigo nao conhece) leem so a partir do
   * desde: falha fechada.
   */
  abertaPor: AberturaDaJanela;
  /** contact.name, para mascarar por MARCA_DO_NOME. */
  nomeDoContato: string | null;
  /** O job que carrega: as lidas dele nao contam como respondidas (retomada). */
  jobId: string;
};

export type HistoricoDaConversa = {
  /** Ate MENSAGENS_NO_HISTORICO (20), ordem crescente, pendentes por ultimo. */
  mensagens: MensagemDaConversa[];
  /** Ids das pendentes, na ordem em que foram para `mensagens`. Vazio: nada a responder. */
  pendentes: string[];
  /**
   * Onda 2 (P11a): alguma resposta da IA (autor 'ia') no trecho lido da
   * janela. Falso: a proxima resposta e a primeira da IA nesta janela e leva
   * o aviso de assistente virtual. Fala da equipe ou do sistema nao conta
   * (o aviso e da IA). Lido das mesmas linhas do historico (as 20 mais
   * recentes): numa janela mais longa que isso, o aviso pode repetir, nunca
   * faltar.
   */
  iaRespondeuNaJanela: boolean;
};

// A marca do nome mora em ./marca-do-nome (o laco tira a marca da resposta
// do modelo sem importar este arquivo, que importa o laco).
export { MARCA_DO_NOME };

/** Estados de ai_turno que encerram as mensagens lidas (contrato 1.1). */
const ESTADOS_ENCERRADOS: ReadonlySet<string> = new Set([
  "enviado",
  "passou_para_equipe",
]);

type LinhaDaMensagem = {
  id: string;
  author: string;
  content_type: string;
  body: string | null;
  media_url: string | null;
  created_at: string;
};

type LinhaDoTurno = {
  job_id: string;
  estado: string;
  mensagens_lidas: string[] | null;
};

// ---------------------------------------------------------------------------
// Nome do contato
// ---------------------------------------------------------------------------

const LETRA_OU_DIGITO = /[\p{L}\p{N}]/u;

/** Minusculo e sem acento, caractere a caractere (com o mapa de volta). */
function normalizarComMapa(texto: string): { texto: string; origem: number[] } {
  let normal = "";
  const origem: number[] = [];
  let indice = 0;
  for (const caractere of texto) {
    const simples = caractere
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
    for (const parte of simples) {
      normal += parte;
      origem.push(indice);
    }
    indice += caractere.length;
  }
  return { texto: normal, origem };
}

function normalizar(texto: string): string {
  return normalizarComMapa(texto).texto;
}

/** O nome inteiro e o primeiro nome, normalizados, do maior para o menor. */
function formasDoNome(nome: string | null): string[] {
  const limpo = (nome ?? "").trim().replace(/\s+/g, " ");
  if (limpo === "") {
    return [];
  }
  const formas = new Set<string>();
  const inteiro = normalizar(limpo);
  const primeiro = normalizar(limpo.split(" ")[0] ?? "");
  // Uma letra so mascararia "a" e "e" em todo texto: fica de fora.
  for (const forma of [inteiro, primeiro]) {
    if (Array.from(forma).filter((c) => LETRA_OU_DIGITO.test(c)).length >= 2) {
      formas.add(forma);
    }
  }
  return [...formas].sort((a, b) => b.length - a.length);
}

/**
 * Troca o nome do contato (inteiro e o primeiro nome, palavra inteira, sem
 * diferenciar maiusculas e acentos) por MARCA_DO_NOME.
 */
export function mascararNome(texto: string, nome: string | null): string {
  const formas = formasDoNome(nome);
  if (formas.length === 0 || texto === "") {
    return texto;
  }
  const { texto: normal, origem } = normalizarComMapa(texto);
  const trechos: { inicio: number; fim: number }[] = [];
  const ocupado = new Array<boolean>(normal.length).fill(false);
  for (const forma of formas) {
    let de = 0;
    while (de <= normal.length - forma.length) {
      const achou = normal.indexOf(forma, de);
      if (achou < 0) {
        break;
      }
      const fim = achou + forma.length;
      const antes = achou > 0 ? normal[achou - 1] : "";
      const depois = fim < normal.length ? normal[fim] : "";
      const palavraInteira =
        !(antes && LETRA_OU_DIGITO.test(antes)) &&
        !(depois && LETRA_OU_DIGITO.test(depois));
      const livre = !ocupado.slice(achou, fim).some(Boolean);
      if (palavraInteira && livre) {
        for (let i = achou; i < fim; i += 1) {
          ocupado[i] = true;
        }
        const inicioOriginal = origem[achou] ?? 0;
        const ultimo = origem[fim - 1] ?? inicioOriginal;
        // O fim no original: o caractere inteiro do ultimo indice.
        const fimOriginal =
          ultimo + ((texto.codePointAt(ultimo) ?? 0) > 0xffff ? 2 : 1);
        trechos.push({ inicio: inicioOriginal, fim: fimOriginal });
      }
      de = achou + 1;
    }
  }
  if (trechos.length === 0) {
    return texto;
  }
  trechos.sort((a, b) => b.inicio - a.inicio);
  let saida = texto;
  for (const { inicio, fim } of trechos) {
    saida = `${saida.slice(0, inicio)}${MARCA_DO_NOME}${saida.slice(fim)}`;
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Mapeamento
// ---------------------------------------------------------------------------

/**
 * Uma linha de message como o laco a ve. Midia disfarcada de texto (video,
 * localizacao, cartao de contato com media_url ou corpo vazio) vira "midia".
 * O `texto` vai com o nome do contato mascarado (e o que a OpenAI le); a
 * mensagem de texto do contato leva tambem o `textoOriginal`, so para o
 * portao de entrada deterministico (local).
 */
export function mensagemDaLinha(
  linha: Pick<
    LinhaDaMensagem,
    "author" | "content_type" | "body" | "media_url"
  >,
  nomeDoContato: string | null,
): MensagemDaConversa {
  const autor = linha.author === "paciente" ? "paciente" : "assistente";
  // Revisao da AG4 (achado 1): a autoria real da fala da clinica (a IA, a
  // equipe ou o sistema), so para o servidor; valor desconhecido e nulo.
  const autoria: Pick<MensagemDaConversa, "autoria"> =
    autor === "paciente" ? {} : { autoria: autoriaDaClinica(linha.author) };
  const corpo = typeof linha.body === "string" ? linha.body : "";
  const ehTexto = linha.content_type === "texto";
  if (!ehTexto || linha.media_url !== null || corpo.trim() === "") {
    return {
      autor,
      ...autoria,
      texto: null,
      tipo: ehTexto ? "midia" : linha.content_type,
    };
  }
  const texto = mascararNome(corpo, nomeDoContato);
  return autor === "paciente"
    ? { autor, texto, tipo: "texto", textoOriginal: corpo }
    : { autor, ...autoria, texto, tipo: "texto" };
}

/** message.author da fala da clinica como a autoria do laco (ou nula). */
function autoriaDaClinica(author: string): AutoriaDaClinica | null {
  return author === "ia" || author === "usuario" || author === "sistema"
    ? author
    : null;
}

/**
 * Monta o historico a partir das linhas (ordem crescente) e dos ids ja
 * respondidos. PURO: o carregador e os testes usam o mesmo.
 */
export function montarHistorico(
  linhas: readonly LinhaDaMensagem[],
  respondidas: ReadonlySet<string>,
  nomeDoContato: string | null,
): HistoricoDaConversa {
  const ordenadas = [...linhas].sort((a, b) =>
    a.created_at === b.created_at
      ? a.id.localeCompare(b.id)
      : a.created_at.localeCompare(b.created_at),
  );
  const ehPendente = (linha: LinhaDaMensagem) =>
    linha.author === "paciente" && !respondidas.has(linha.id);
  const anteriores = ordenadas.filter((linha) => !ehPendente(linha));
  const pendentes = ordenadas.filter(ehPendente);
  const recorte = [...anteriores, ...pendentes].slice(-MENSAGENS_NO_HISTORICO);
  const idsNoRecorte = new Set(recorte.map((linha) => linha.id));
  return {
    mensagens: recorte.map((linha) => mensagemDaLinha(linha, nomeDoContato)),
    pendentes: pendentes
      .filter((linha) => idsNoRecorte.has(linha.id))
      .map((linha) => linha.id),
    iaRespondeuNaJanela: ordenadas.some((linha) => linha.author === "ia"),
  };
}

/** Os ids que os turnos encerrados (e os outros decididos) ja responderam. */
export function idsRespondidos(
  turnos: readonly LinhaDoTurno[],
  jobId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const turno of turnos) {
    const conta =
      ESTADOS_ENCERRADOS.has(turno.estado) ||
      (turno.estado === "decidido" && turno.job_id !== jobId);
    if (!conta) {
      continue;
    }
    for (const id of turno.mensagens_lidas ?? []) {
      ids.add(id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Carregador
// ---------------------------------------------------------------------------

/**
 * O historico da janela e as pendentes. Lanca ErroComCodigoDeJob
 * ("leitura_falhou") se qualquer leitura falhar: o job tenta de novo.
 */
export async function carregarHistoricoDaConversa(
  admin: SupabaseClient,
  entrada: EntradaDoHistorico,
): Promise<HistoricoDaConversa> {
  let consulta = admin
    .from("message")
    .select("id, author, content_type, body, media_url, created_at")
    .eq("clinic_id", entrada.clinicId)
    .eq("conversation_id", entrada.conversationId);
  if (entrada.abertaPor !== "ingestao") {
    consulta = consulta.gte("created_at", entrada.desde);
  }
  const [mensagens, turnos] = await Promise.all([
    consulta
      .is("deleted_at", null)
      .eq("is_internal_note", false)
      .neq("content_type", "evento")
      // A resposta automatica do app WhatsApp Business (saudacao, ausencia)
      // nao e fala da clinica: fica de fora.
      .or("pelo_celular.eq.false,author.neq.sistema")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MENSAGENS_NO_HISTORICO),
    admin
      .from("ai_turno")
      .select("job_id, estado, mensagens_lidas")
      .eq("clinic_id", entrada.clinicId)
      .eq("conversation_id", entrada.conversationId),
  ]);
  if (mensagens.error || turnos.error) {
    throw new ErroComCodigoDeJob("leitura_falhou");
  }
  return montarHistorico(
    (mensagens.data ?? []) as LinhaDaMensagem[],
    idsRespondidos((turnos.data ?? []) as LinhaDoTurno[], entrada.jobId),
    entrada.nomeDoContato,
  );
}
