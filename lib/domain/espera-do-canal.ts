// ESPERA DO CANAL: o WhatsApp da clinica esta fora do ar para um envio
// automatico (o numero dele desconectado, ou a clinica sem numero ativo). Nao
// e falha do envio, e "ainda nao": ele espera a reconexao e nunca troca de
// numero sozinho (regra do dono, docs/07). Logica PURA, zero I/O: quanto
// esperar entre uma volta e outra e ate quando vale esperar.
//
// Esperar o canal NAO e o "canal que nao abre" do teto de 20 devolucoes da
// fila (reagendar_job). Com o teto de 20, um celular caido matava a
// confirmacao em cerca de 95 minutos, e ela nao saia quando a clinica
// reconectava. A desistencia e por PRAZO FIXO (abaixo), e reagendar_job da a
// estas esperas um teto de seguranca proprio, bem maior (migration
// 20260925141000_espera_do_canal.sql). O banco tambem conta as esperas do job
// no payload (CHAVE_DAS_ESPERAS_DO_CANAL), e e essa contagem que faz a espera
// crescer de 5 ate 30 minutos.
//
// A lista de espera (lib/jobs/lista-espera.ts) usa a MESMA regra de passos
// (proximaEsperaPorReconexao), com o proprio contador no payload da
// continuacao.

import { dentroDaJanela, proximaAbertura, type JanelaDeEnvio } from "./cadence";

/** Espera pela reconexao do WhatsApp: cresce de 5 em 5 minutos por volta. */
export const PASSO_DA_ESPERA_POR_RECONEXAO_MS = 5 * 60_000;
/** Espera maxima entre uma volta e outra enquanto o WhatsApp segue fora. */
export const TETO_DA_ESPERA_POR_RECONEXAO_MS = 30 * 60_000;
/**
 * A ultima volta cai este tanto antes do limite, e espera menor que isto nao
 * vale uma volta: o relogio do banco (que libera o job) e o do executor (que
 * decide) podem divergir alguns segundos.
 */
export const FOLGA_DA_ULTIMA_VOLTA_MS = 60_000;

/**
 * WhatsApp fora do ar: quando a onda tenta de novo. O teto e de TEMPO, nao de
 * voltas: a vaga espera a reconexao enquanto ainda da para oferecer (limite =
 * inicio da vaga menos a janela de resposta), em passos crescentes de 5, 10,
 * 15... ate 30 minutos. Perto do limite, a ultima volta cai 1 minuto antes
 * dele, para uma reconexao de ultima hora ainda salvar a vaga. Devolve null
 * quando nao sobra tempo util (desistir). `passo` e quantas voltas ja foram
 * dadas esperando a reconexao (0 na primeira). Epoch em ms.
 */
export function proximaEsperaPorReconexao(params: {
  passo: number;
  agora: number;
  limite: number;
}): number | null {
  const passo =
    Number.isInteger(params.passo) && params.passo >= 0 ? params.passo : 0;
  const espera = Math.min(
    PASSO_DA_ESPERA_POR_RECONEXAO_MS * (passo + 1),
    TETO_DA_ESPERA_POR_RECONEXAO_MS,
  );
  const quando = Math.min(
    params.agora + espera,
    params.limite - FOLGA_DA_ULTIMA_VOLTA_MS,
  );
  return quando - params.agora >= FOLGA_DA_ULTIMA_VOLTA_MS ? quando : null;
}

/**
 * Os motivos de devolucao que sao ESPERA DO CANAL. Sao os mesmos que
 * reagendar_job reconhece para o teto de seguranca maior: mudou aqui, muda
 * la.
 */
export const MOTIVOS_DA_ESPERA_DO_CANAL = [
  "desconectado",
  "sem_numero",
] as const;

export type MotivoDaEsperaDoCanal = (typeof MOTIVOS_DA_ESPERA_DO_CANAL)[number];

/**
 * Chave do payload do job em que reagendar_job conta as esperas do canal ja
 * feitas. So o banco escreve; o executor so le.
 */
export const CHAVE_DAS_ESPERAS_DO_CANAL = "esperas_do_canal";

/**
 * Prazo da espera de quem nao tem consulta para balizar: 12 horas (na regua,
 * contadas da primeira abertura da janela a partir do vencimento).
 */
export const PRAZO_DA_ESPERA_SEM_CONSULTA_MS = 12 * 60 * 60_000;

/**
 * Quantas esperas do canal este job ja fez (0 na primeira). Valor fora do
 * contrato conta como a primeira: a espera volta a 5 minutos, nunca some.
 */
export function esperasDoCanalJaFeitas(
  payload: Record<string, unknown>,
): number {
  const registrado = payload[CHAVE_DAS_ESPERAS_DO_CANAL];
  return typeof registrado === "number" &&
    Number.isInteger(registrado) &&
    registrado >= 0
    ? registrado
    : 0;
}

function instante(valor: string | null | undefined): number | null {
  if (typeof valor !== "string") {
    return null;
  }
  const epoch = new Date(valor).getTime();
  return Number.isFinite(epoch) ? epoch : null;
}

/**
 * Ate quando o toque de regua espera o canal. Ancora FIXA, nunca o relogio da
 * espera (com "agora + 12h" o prazo andava junto e nunca chegava):
 * - confirmacao: ate a hora da consulta, porque depois dela o toque perdeu o
 *   sentido;
 * - as demais reguas (pos falta, follow-up) e a confirmacao sem consulta:
 *   12 horas depois da PRIMEIRA ABERTURA DA JANELA a partir do vencimento
 *   (scheduled_for). O vencimento cru nao serve: o planner grava
 *   starts_at + offset sem encaixar na janela, e o ramo da janela devolve o
 *   job para a abertura sem mudar scheduled_for. Um follow-up que vence as
 *   19h (janela das 8h as 18h) so pode sair as 8h do dia seguinte, ja 13h
 *   depois do vencimento: contado do vencimento, o prazo teria passado antes
 *   da primeira tentativa, e o toque morria na hora, sem esperar nada, na
 *   queda de celular mais comum (noite ou fim de semana).
 *
 * A ancora e o proprio vencimento quando ele ja cai dentro da janela, quando
 * o toque e manual (a janela nao vale para ele) ou quando a janela nao tem
 * abertura (janela invalida: a regua nem deveria estar ativa). Continua
 * sendo derivada so da run e da janela, nunca de Date.now().
 */
export function prazoDaEsperaNaRegua(params: {
  kind: string;
  inicioDaConsulta: string | null;
  scheduledFor: string;
  janela: JanelaDeEnvio;
  /** Fuso da clinica: a janela e "08:00 as 18:00 DELA" (CLAUDE.md 3.6). */
  timezone: string;
  /** Toque manual ("Cobrar agora"): a janela de envio nao vale para ele. */
  manual: boolean;
}): number {
  const consulta = instante(params.inicioDaConsulta);
  if (params.kind === "confirmacao" && consulta !== null) {
    return consulta;
  }
  const vencimento = instante(params.scheduledFor);
  if (vencimento === null) {
    // scheduled_for e NOT NULL no banco; ilegivel, nao ha o que esperar.
    return Number.NEGATIVE_INFINITY;
  }
  const venceu = new Date(vencimento);
  const ancora =
    params.manual || dentroDaJanela(params.janela, venceu, params.timezone)
      ? venceu
      : (proximaAbertura(params.janela, venceu, params.timezone) ?? venceu);
  return ancora.getTime() + PRAZO_DA_ESPERA_SEM_CONSULTA_MS;
}

/**
 * Ate quando o envio ativo (aviso de remarcacao, eco da resposta ao toque,
 * mensagem da oferta de espera) espera o canal:
 * - com consulta no payload: ate a hora da consulta;
 * - sem: 12 horas depois de o job nascer (job_queue.created_at, ancora fixa:
 *   run_at muda a cada devolucao).
 * O claim devolve a linha inteira da fila, entao created_at sempre vem. So o
 * job montado a mao sem ele (teste) cai em "agora + 12h", e o teto de
 * seguranca de reagendar_job continua valendo.
 */
export function prazoDaEsperaDoEnvioAtivo(params: {
  inicioDaConsulta: string | null;
  criadoEm: string | null | undefined;
  agora: number;
}): number {
  const consulta = instante(params.inicioDaConsulta);
  if (consulta !== null) {
    return consulta;
  }
  const criado = instante(params.criadoEm);
  return (criado ?? params.agora) + PRAZO_DA_ESPERA_SEM_CONSULTA_MS;
}

/**
 * A decisao da espera: devolver o job para a proxima volta (a data ISO e o
 * motivo que vao para reagendar_job) ou, sem tempo util antes do prazo, null
 * (desistir: quem chama encerra o envio como 'desconectado').
 */
export function decidirEsperaDoCanal(params: {
  motivo: MotivoDaEsperaDoCanal;
  payload: Record<string, unknown>;
  agora: number;
  prazo: number;
}): { reagendar: string; motivo: MotivoDaEsperaDoCanal } | null {
  const quando = proximaEsperaPorReconexao({
    passo: esperasDoCanalJaFeitas(params.payload),
    agora: params.agora,
    limite: params.prazo,
  });
  return quando === null
    ? null
    : { reagendar: new Date(quando).toISOString(), motivo: params.motivo };
}
