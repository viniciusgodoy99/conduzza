import type { SupabaseClient } from "@supabase/supabase-js";

import { ErroComCodigoDeJob } from "@/lib/jobs/erro-de-job";

import {
  MENSAGENS_NO_HISTORICO,
  type AutoriaDaClinica,
  type MensagemDaConversa,
} from "./laco";
import { MARCA_DO_NOME, mascararNome } from "./marca-do-nome";
// [AG6b mídia] início
import { estadoDoArquivo, type MidiaDaConversa } from "./midia";
// [AG6b mídia] fim
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
//  - [AG7 preparo] a fala da clinica de texto leva tambem o corpo como saiu
//    (textoOriginalDaClinica, sem a mascara do nome; so o servidor le): o
//    laco troca nele o texto do preparo pelo marcador e so DEPOIS refaz a
//    mascara (revisao da AG7, CFM-1 e MOTOR-1). Com a troca no texto ja
//    mascarado, o nome do contato dentro do texto aprovado ("dieta liquida
//    clara" da Clara, "Dr. Joao", "Clinica Santa Maria") desfazia a
//    igualdade, e o toque da regua ia inteiro ao modelo;
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
//    valem nele;
//  - [AG6 urgência] a midia do contato com legenda (o body da imagem, do
//    documento ou do video; nunca do audio) leva a legenda ORIGINAL
//    (legendaOriginal), que so a urgencia le (revisao de 28/10/2026: "to com
//    dor no peito" escrito na foto). A midia continua indo aos modelos so
//    como o marcador; a legenda nunca vai para a OpenAI nem para log.
//
//  - [AG6b mídia] o audio, a imagem e o documento do contato levam a midia
//    (`midia`: o id da mensagem, o estado do arquivo, o media_mimetype, o
//    created_at e a legenda com o nome mascarado), que so o servidor le: o
//    plano do turno (lib/agente/midia.ts) decide se ela vai ao modelo
//    (transcricao ou leitor) e aplica a leitura ja gravada. O audio ja nao
//    "vai sem a transcricao": vai como "(áudio) ..." quando o turno o
//    transcreveu (a leitura em ia_leitura_da_midia).
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
// do modelo sem importar este arquivo, que importa o laco). [AG7 preparo] A
// mascara tambem (mascararNome): o laco a refaz na fala da clinica depois de
// trocar o texto do preparo pelo marcador (CFM-1).
export { MARCA_DO_NOME, mascararNome };

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
  // [AG6b mídia] AG6b: o tipo real do arquivo (o plano do turno le).
  media_mimetype?: string | null;
};

// [AG6b mídia] início
/** As midias que o turno pode ler (message.content_type). */
const MIDIAS_DO_PACIENTE: ReadonlySet<string> = new Set([
  "audio",
  "imagem",
  "documento",
]);
// [AG6b mídia] fim

type LinhaDoTurno = {
  job_id: string;
  estado: string;
  mensagens_lidas: string[] | null;
};

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
  > &
    // [AG6b mídia] o id, o instante e o mimetype (a midia do paciente).
    Partial<Pick<LinhaDaMensagem, "id" | "created_at" | "media_mimetype">>,
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
    // [AG6 urgência] início
    // A legenda do contato na midia (nunca no audio), so para a urgencia.
    const legenda: Pick<MensagemDaConversa, "legendaOriginal"> =
      autor === "paciente" &&
      linha.content_type !== "audio" &&
      corpo.trim() !== ""
        ? { legendaOriginal: corpo }
        : {};
    // [AG6 urgência] fim
    // [AG6b mídia] início
    // AG6b: o audio, a imagem e o documento do contato, com o que o plano do
    // turno precisa (so o servidor le).
    const midia: Pick<MensagemDaConversa, "midia"> =
      autor === "paciente" &&
      MIDIAS_DO_PACIENTE.has(linha.content_type) &&
      typeof linha.id === "string" &&
      typeof linha.created_at === "string"
        ? {
            midia: {
              messageId: linha.id,
              midia: linha.content_type as MidiaDaConversa["midia"],
              arquivo: estadoDoArquivo(linha.media_url),
              mediaUrl: linha.media_url,
              mimetype: linha.media_mimetype ?? null,
              criadaEm: linha.created_at,
              legenda:
                linha.content_type !== "audio" && corpo.trim() !== ""
                  ? mascararNome(corpo, nomeDoContato)
                  : null,
            },
          }
        : {};
    // [AG6b mídia] fim
    return {
      autor,
      ...autoria,
      texto: null,
      tipo: ehTexto ? "midia" : linha.content_type,
      ...legenda,
      // [AG6b mídia]
      ...midia,
    };
  }
  const texto = mascararNome(corpo, nomeDoContato);
  // [AG7 preparo] A fala da clinica leva tambem o corpo como saiu, SEM a
  // mascara (textoOriginalDaClinica): o laco troca o texto do preparo pelo
  // marcador NELE e so depois refaz a mascara (CFM-1). So o servidor le.
  return autor === "paciente"
    ? { autor, texto, tipo: "texto", textoOriginal: corpo }
    : {
        autor,
        ...autoria,
        texto,
        tipo: "texto",
        textoOriginalDaClinica: corpo,
      };
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
    // [AG6b mídia] media_mimetype: o plano da midia do turno.
    .select(
      "id, author, content_type, body, media_url, media_mimetype, created_at",
    )
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
