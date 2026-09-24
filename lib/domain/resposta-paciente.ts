// Leitura PURA da resposta do paciente ao toque de confirmacao (tarefa 4.7).
//
// O paciente pode ter recebido BOTAO interativo ou o texto numerado: o uazapi
// degrada sozinho quando o botao falha, e a clinica nao controla isso. Entao
// as duas formas valem: o rotulo do botao ("Confirmar"), o id dele
// ("confirmar") e o numero da lista ("1").
//
// A regra e SER CONSERVADOR. Nao interpretar e barato: a conversa ja nasce
// em 'aguardando_humano' e a recepcao assume. Interpretar errado cancela a
// consulta de alguem. Por isso a comparacao e por frase inteira, nunca por
// "contem": "11" e "10" NAO sao confirmacao (o paciente que digita 11 quis
// dizer outra coisa, talvez a hora), "nao vou poder confirmar" nao vira
// confirmacao so por conter a palavra, e qualquer sobra cai em
// 'nao_reconhecida'.

import { passoCondizComAgenda } from "./cadence";

export type IntencaoDoPaciente =
  "confirmar" | "remarcar" | "cancelar" | "nao_reconhecida";

// Joinha e sinais de certo. Sozinhos valem confirmacao; acompanhados de texto,
// quem decide e o texto.
const EMOJIS_DE_CONFIRMACAO = [
  "\u{1F44D}", // joinha
  "\u{1F44C}", // sinal de ok
  "✅", // certo em quadro verde
  "✔", // certo pesado
  "☑", // caixa marcada
];

// Seletores de variacao e tom de pele acompanham o emoji e nao mudam o
// sentido: saem antes da comparacao.
const MODIFICADORES = /[\u{FE0E}\u{FE0F}\u{1F3FB}-\u{1F3FF}]/gu;

const CONFIRMAR = new Set([
  "1",
  "confirmar",
  "confirmo",
  "confirmado",
  "confirmada",
  "confirmar presenca",
  "sim",
  "sim confirmo",
  "sim confirmado",
  "ok",
  "okay",
  "pode ser",
  "sim pode ser",
  "esta confirmado",
  "estara confirmado",
  "vou",
  "vou sim",
  "estarei la",
]);

const REMARCAR = new Set([
  "2",
  "remarcar",
  "remarca",
  "quero remarcar",
  "preciso remarcar",
  "reagendar",
  "quero reagendar",
  "mudar",
  "mudar horario",
  "mudar o horario",
  "mudar de horario",
]);

const CANCELAR = new Set([
  "3",
  "cancelar",
  "cancela",
  "cancelado",
  "quero cancelar",
  "preciso cancelar",
  "desmarcar",
  "desmarca",
  "quero desmarcar",
  "nao vou",
  "nao vou poder ir",
  "nao vou poder",
  "nao posso ir",
]);

/**
 * Normaliza para comparacao: sem espaco nas pontas, sem maiuscula, sem
 * acento, sem pontuacao e com espaco unico entre palavras.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Le a intencao do paciente. Devolve 'nao_reconhecida' em qualquer duvida:
 * o fail-safe do fluxo e a recepcao assumir a conversa.
 */
export function interpretarResposta(body: string | null): IntencaoDoPaciente {
  if (!body) {
    return "nao_reconhecida";
  }

  const semModificadores = body.replace(MODIFICADORES, "");
  let restante = semModificadores;
  let temEmojiDeConfirmacao = false;
  for (const emoji of EMOJIS_DE_CONFIRMACAO) {
    if (restante.includes(emoji)) {
      temEmojiDeConfirmacao = true;
      restante = restante.split(emoji).join(" ");
    }
  }

  const texto = normalizar(restante);
  if (texto.length === 0) {
    return temEmojiDeConfirmacao ? "confirmar" : "nao_reconhecida";
  }
  if (CONFIRMAR.has(texto)) {
    return "confirmar";
  }
  if (REMARCAR.has(texto)) {
    return "remarcar";
  }
  if (CANCELAR.has(texto)) {
    return "cancelar";
  }
  return "nao_reconhecida";
}

// ---------------------------------------------------------------------------
// A QUE PERGUNTA o paciente respondeu (revisao de liberacao de 24/09).
//
// Ler "ok" como confirmacao so e seguro quando o "ok" responde ao toque. O
// paciente pode estar respondendo a recepcao ("posso marcar quinta as 9h?"),
// a uma oferta da lista de espera, ao toque de OUTRA consulta, ou a qualquer
// coisa que o sistema nao ve. A decisao abaixo e PURA: o interceptador junta
// os fatos do banco e ela escolhe um alvo, ou nenhum. Nenhum e sempre seguro:
// a conversa ja esta esperando a recepcao.
// ---------------------------------------------------------------------------

/**
 * O menu do toque de confirmacao: os ids dos botoes (que chegam como texto
 * quando o paciente toca) e os numeros da lista que o uazapi usa quando o
 * botao degrada. Essas respostas pertencem ao toque e NUNCA valem como
 * resposta a oferta da lista de espera, que pede "SIM" ou "NAO QUERO".
 */
const VOCABULARIO_DO_MENU = new Set(["1", "2", "3", "confirmar", "remarcar", "cancelar"]);

export function ehRespostaDoMenuDeConfirmacao(body: string | null): boolean {
  if (!body) {
    return false;
  }
  return VOCABULARIO_DO_MENU.has(normalizar(body));
}

/** Sete dias cobrem o toque de 72h com folga; mais que isso e conversa velha. */
export const JANELA_DE_CONTEXTO_MS = 7 * 24 * 60 * 60 * 1000;

/** Consulta que ainda aceita resposta do paciente pelo WhatsApp. */
const STATUS_EM_ABERTO = new Set([
  "agendado",
  "aguardando_confirmacao",
  "confirmado_paciente",
  "confirmado_recepcao",
]);

/** So estas ainda podem ser CONFIRMADAS (as outras ja estao confirmadas). */
const STATUS_A_CONFIRMAR = new Set(["agendado", "aguardando_confirmacao"]);

export type ConsultaDoToque = {
  id: string;
  status: string;
  startsAt: string;
  /** Marca do pedido de remarcacao: o contexto desta consulta esta fechado. */
  remarcacaoPedidaEm: string | null;
  /**
   * A ultima vez que o HORARIO desta consulta mudou (linha kind='remarcacao'
   * da trilha com starts_at diferente). Null quando nao mudou na janela.
   */
  horarioMudouEm: string | null;
};

/** Um toque de regua que saiu para o contato (cadence_run com sent_at). */
export type ToqueEnviado = {
  runId: string;
  /** kind da regua: 'confirmacao', 'pos_falta', 'followup'... */
  kind: string | null;
  sentAt: string;
  /** Vencimento da run. Na regua automatica, starts_at + offset do passo. */
  scheduledFor: string;
  /** offset_minutes do passo; null quando a leitura nao trouxe o passo. */
  offsetMinutes: number | null;
  /**
   * Toque do "Cobrar agora" (payload.manual do job): a run nasce com
   * scheduled_for = agora, entao a conta do passo nao diz nada sobre o
   * horario que ele perguntou.
   */
  manual: boolean;
  /** cadence_run.skipped_reason ('consulta_remarcada': o executor a venceu). */
  skippedReason: string | null;
  consulta: ConsultaDoToque | null;
};

/**
 * Aviso de remarcacao que SAIU para o contato: mensagem automatica, sem
 * pergunta, que diz o horario novo e convida a responder.
 */
export type AvisoDeRemarcacao = {
  appointmentId: string;
  enviadoEm: string;
};

/** A oferta da lista de espera mais recente que perguntou algo ao contato. */
export type OfertaPerguntada = {
  id: string;
  /**
   * Quando a mensagem da oferta saiu para ESTE contato. Null quando ela ainda
   * esta na fila (ou falhou): oferta que o paciente nao recebeu nao e
   * pergunta, e nao pode capturar o "sim" dele.
   */
  enviadaEm: string | null;
};

/** O que a citacao do WhatsApp (responder a uma mensagem) aponta. */
export type Citacao =
  | { tipo: "nenhuma" }
  | { tipo: "toque"; toque: ToqueEnviado }
  | { tipo: "oferta"; offerId: string }
  /** Citou outra mensagem, ou uma que o sistema nao conhece. */
  | { tipo: "outra" };

export type FatosDaResposta = {
  agora: number;
  /**
   * Alguem da clinica assumiu a conversa (conversation.status). So cala a
   * resposta SEM citacao: o status nao diz QUANDO a conversa foi assumida, e
   * nada tira a conversa dele sozinho. O botao tocado num toque mais recente
   * que qualquer mensagem de gente prova a que pergunta o paciente respondeu.
   */
  conversaEmAtendimento: boolean;
  citacao: Citacao;
  /**
   * Toques enviados ao contato na janela de contexto, de QUALQUER regua, do
   * mais recente para o mais antigo.
   */
  toques: ToqueEnviado[];
  oferta: OfertaPerguntada | null;
  /**
   * A mensagem mais recente que ALGUEM da clinica mandou ao paciente (autor
   * usuario ou ia, fora nota interna). Depois dela, "ok" e resposta a ela.
   */
  ultimaMensagemHumanaEm: string | null;
  /**
   * Avisos de remarcacao enviados ao contato na janela de contexto, em
   * qualquer ordem. Nao perguntam nada, mas encerram o contexto dos toques
   * de antes deles.
   */
  avisosDeRemarcacao: AvisoDeRemarcacao[];
};

export type MotivoDeSilencio =
  | "sem_intencao"
  | "citou_outra_mensagem"
  | "sem_pergunta"
  | "clinica_falou_depois"
  | "outra_regua_mais_recente"
  | "conversa_em_atendimento"
  | "toque_antigo"
  | "consulta_resolvida"
  | "consulta_remarcada"
  | "aviso_de_remarcacao"
  | "remarcacao_pedida"
  | "mais_de_uma_consulta";

export type PerguntaRespondida =
  | { alvo: "nenhum"; motivo: MotivoDeSilencio }
  | { alvo: "oferta"; offerId: string }
  | {
      alvo: "toque";
      appointmentId: string;
      startsAt: string;
      intencao: Exclude<IntencaoDoPaciente, "nao_reconhecida">;
    };

function instante(iso: string | null): number {
  return iso ? new Date(iso).getTime() : Number.NEGATIVE_INFINITY;
}

function consultaAceitaResposta(
  consulta: ConsultaDoToque,
  agora: number,
): boolean {
  return (
    STATUS_EM_ABERTO.has(consulta.status) &&
    new Date(consulta.startsAt).getTime() > agora
  );
}

/**
 * O toque ainda pergunta pelo horario ATUAL da consulta? O "Confirmar" de
 * "terca as 10h" nunca confirma a sexta as 16h para onde a consulta foi, e o
 * "Cancelar" dele nunca cancela a sexta: a remarcacao volta a pedir
 * confirmacao com toque novo (decisao do dono), e a resposta ao toque velho
 * fica com a recepcao.
 *
 * - Run pulada como 'consulta_remarcada': o executor ja a deu por vencida.
 * - Toque automatico: o vencimento menos o offset do passo tem de bater com
 *   o starts_at atual, com a tolerancia de 1 minuto do executor
 *   (passoCondizComAgenda). O manual nasce com scheduled_for = agora e fica
 *   fora desta conta.
 * - Qualquer toque: o horario nao pode ter mudado DEPOIS do envio. Cobre o
 *   manual e a consulta que foi para sexta e voltou para terca.
 * - Aviso de remarcacao DESTA consulta enviado depois do toque: o contexto
 *   do toque acabou ali, mesmo com o botao velho citado.
 */
function toqueValeParaOHorarioAtual(
  fatos: FatosDaResposta,
  toque: ToqueEnviado,
  consulta: ConsultaDoToque,
): boolean {
  if (toque.skippedReason === "consulta_remarcada") {
    return false;
  }
  if (!toque.manual) {
    if (toque.offsetMinutes === null) {
      return false;
    }
    const condiz = passoCondizComAgenda({
      startsAt: new Date(consulta.startsAt),
      offsetMinutes: toque.offsetMinutes,
      scheduledFor: new Date(toque.scheduledFor),
    });
    if (!condiz) {
      return false;
    }
  }
  const enviadoEm = instante(toque.sentAt);
  if (instante(consulta.horarioMudouEm) > enviadoEm) {
    return false;
  }
  return !fatos.avisosDeRemarcacao.some(
    (aviso) =>
      aviso.appointmentId === consulta.id &&
      instante(aviso.enviadoEm) > enviadoEm,
  );
}

function avaliarToque(
  fatos: FatosDaResposta,
  toque: ToqueEnviado,
  intencao: IntencaoDoPaciente,
  citado: boolean,
): PerguntaRespondida {
  if (intencao === "nao_reconhecida") {
    return { alvo: "nenhum", motivo: "sem_intencao" };
  }
  // Alguem da clinica esta conduzindo: "1" pode ser a opcao 1 que a
  // recepcionista ofereceu, "ok" pode ser o aceite de outro horario. O botao
  // CITADO de um toque fala por si: se nenhuma mensagem de gente veio depois
  // dele (a regra logo abaixo), o paciente respondeu ao toque, e a conversa
  // assumida ha dias nao pode calar a confirmacao para sempre.
  if (fatos.conversaEmAtendimento && !citado) {
    return { alvo: "nenhum", motivo: "conversa_em_atendimento" };
  }
  if (instante(fatos.ultimaMensagemHumanaEm) > instante(toque.sentAt)) {
    return { alvo: "nenhum", motivo: "clinica_falou_depois" };
  }
  if (fatos.agora - instante(toque.sentAt) > JANELA_DE_CONTEXTO_MS) {
    return { alvo: "nenhum", motivo: "toque_antigo" };
  }
  const consulta = toque.consulta;
  if (!consulta || !consultaAceitaResposta(consulta, fatos.agora)) {
    return { alvo: "nenhum", motivo: "consulta_resolvida" };
  }
  if (!toqueValeParaOHorarioAtual(fatos, toque, consulta)) {
    return { alvo: "nenhum", motivo: "consulta_remarcada" };
  }
  // Depois de "Remarcar" a conversa e da recepcao: o "ok" que o paciente
  // manda para "nossa recepcao vai falar com voce" nao confirma nada.
  if (consulta.remarcacaoPedidaEm) {
    return { alvo: "nenhum", motivo: "remarcacao_pedida" };
  }
  if (!citado) {
    // Sem citacao, duas consultas com toque recente sao duas perguntas de pe:
    // escolher uma e apostar. Para confirmar so conta quem ainda pode ser
    // confirmada; para cancelar ou remarcar, qualquer uma em aberto.
    const podeSerAlvo = (outra: ConsultaDoToque) =>
      consultaAceitaResposta(outra, fatos.agora) &&
      (intencao !== "confirmar" || STATUS_A_CONFIRMAR.has(outra.status));
    const outras = new Set(
      fatos.toques
        .filter(
          (t) =>
            t.kind === "confirmacao" &&
            t.consulta !== null &&
            t.consulta.id !== consulta.id &&
            fatos.agora - instante(t.sentAt) <= JANELA_DE_CONTEXTO_MS &&
            podeSerAlvo(t.consulta),
        )
        .map((t) => t.consulta?.id),
    );
    if (outras.size > 0) {
      return { alvo: "nenhum", motivo: "mais_de_uma_consulta" };
    }
  }
  return {
    alvo: "toque",
    appointmentId: consulta.id,
    startsAt: consulta.startsAt,
    intencao,
  };
}

/**
 * Decide a que pergunta a resposta se refere.
 *
 * Com CITACAO (o paciente tocou num botao ou respondeu a uma mensagem), a
 * citacao manda: vale o toque ou a oferta citada, e qualquer outra mensagem
 * citada cala o interceptador.
 *
 * Sem citacao, vale a pergunta MAIS RECENTE de fato enviada ao contato: o
 * ultimo toque de regua, a mensagem da oferta (so se ja saiu) ou a ultima
 * mensagem de alguem da clinica. Se a mais recente foi de gente, ninguem
 * interpreta. Empate com mensagem de gente conta como gente. O aviso de
 * remarcacao entra na disputa como fala da clinica: o "ok" ou o "nao vou
 * poder" depois dele responde a ELE, e quem le e a recepcao.
 */
export function qualPerguntaFoiRespondida(
  fatos: FatosDaResposta,
  intencao: IntencaoDoPaciente,
  intencaoDeOferta: "aceitar" | "recusar" | "nao_reconhecida",
): PerguntaRespondida {
  const { citacao } = fatos;
  if (citacao.tipo === "outra") {
    return { alvo: "nenhum", motivo: "citou_outra_mensagem" };
  }
  if (citacao.tipo === "oferta") {
    return intencaoDeOferta === "nao_reconhecida"
      ? { alvo: "nenhum", motivo: "sem_intencao" }
      : { alvo: "oferta", offerId: citacao.offerId };
  }
  if (citacao.tipo === "toque") {
    if (citacao.toque.kind !== "confirmacao") {
      return { alvo: "nenhum", motivo: "outra_regua_mais_recente" };
    }
    return avaliarToque(fatos, citacao.toque, intencao, true);
  }

  const ultimoToque = fatos.toques[0] ?? null;
  const tToque = instante(ultimoToque?.sentAt ?? null);
  const tOferta = instante(fatos.oferta?.enviadaEm ?? null);
  const tHumano = instante(fatos.ultimaMensagemHumanaEm);
  const tAviso = Math.max(
    Number.NEGATIVE_INFINITY,
    ...fatos.avisosDeRemarcacao.map((aviso) => instante(aviso.enviadoEm)),
  );
  const maisRecente = Math.max(tToque, tOferta, tHumano, tAviso);

  if (maisRecente === Number.NEGATIVE_INFINITY) {
    return { alvo: "nenhum", motivo: "sem_pergunta" };
  }
  if (tHumano === maisRecente) {
    return { alvo: "nenhum", motivo: "clinica_falou_depois" };
  }
  // "Sua consulta foi remarcada para sexta as 16h, qualquer duvida e so
  // responder": nao pergunta nada, e o toque de antes dele perguntou por
  // outro horario. Empate com toque ou oferta conta como aviso.
  if (tAviso === maisRecente) {
    return { alvo: "nenhum", motivo: "aviso_de_remarcacao" };
  }
  if (fatos.oferta && tOferta === maisRecente) {
    return intencaoDeOferta === "nao_reconhecida"
      ? { alvo: "nenhum", motivo: "sem_intencao" }
      : { alvo: "oferta", offerId: fatos.oferta.id };
  }
  if (!ultimoToque) {
    return { alvo: "nenhum", motivo: "sem_pergunta" };
  }
  // O ultimo toque foi de outra regua (recuperacao depois da falta, follow
  // up): o "sim" responde AQUELA pergunta, nunca confirma outra consulta.
  if (ultimoToque.kind !== "confirmacao") {
    return { alvo: "nenhum", motivo: "outra_regua_mais_recente" };
  }
  return avaliarToque(fatos, ultimoToque, intencao, false);
}
