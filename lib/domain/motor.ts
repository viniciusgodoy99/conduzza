// Saúde do motor de automação, como regra pura.
//
// Fica fora do layout porque a decisão é a parte que importa e a que erra: o
// layout só desenha. Quando o motor morre, a tela ficava idêntica à de uma
// clínica saudável (a régua aparecia "ligada", as consultas apareciam
// "pendentes") e a clínica só descobria pelo paciente que faltou. Este é o
// cálculo que tira esse silêncio.

/**
 * Quanto tempo sem batida antes de avisar.
 *
 * O motor tem dois papéis com cadências diferentes: a fila bate a cada 20
 * segundos e o planner a cada 60. Três minutos são nove batidas perdidas da
 * fila e três do planner, calibrado pelo mais lento: não alarma por uma
 * oscilação de rede e avisa muito antes de a clínica perder o toque do dia.
 */
export const TOLERANCIA_DE_BATIDA_MS = 3 * 60_000;

/** Um dos dois executores, como o banco devolve em saude_do_motor(). */
export type BatidaDoMotor = {
  batida_em: string | null;
  ultimo_lote?: number | null;
  ultimo_erro?: string | null;
} | null;

export type SaudeDoMotor = {
  /** quem executa a fila (a rota chamada pelo agendador) */
  fila: BatidaDoMotor;
  /** quem planeja as réguas e faz a manutenção (dentro do banco) */
  planner: BatidaDoMotor;
  /** tarefas pendentes há mais de 5 minutos */
  atrasados?: number | null;
};

/**
 * A batida está velha demais? Batida nenhuma conta como velha: ou o executor
 * nunca subiu, ou está fora do ar desde antes de existir o carimbo.
 */
export function batidaVencida(
  batida: BatidaDoMotor,
  agora: Date,
): boolean {
  const carimbo = batida?.batida_em;
  if (!carimbo) {
    return true;
  }
  const instante = new Date(carimbo).getTime();
  if (Number.isNaN(instante)) {
    return true;
  }
  return agora.getTime() - instante > TOLERANCIA_DE_BATIDA_MS;
}

/**
 * O motor está parado?
 *
 * Exige OS DOIS papéis vivos, e isso não é rigor gratuito: o planner roda
 * dentro do banco e a fila roda numa rota HTTP. Se a leitura fosse "a batida
 * mais recente de qualquer um", o planner vivo esconderia a rota morta e a
 * clínica veria tudo verde com nenhuma mensagem saindo, que é exatamente o
 * silêncio que esta regra existe para acabar.
 */
export function motorParado(saude: SaudeDoMotor | null, agora: Date): boolean {
  if (!saude) {
    return true;
  }
  return batidaVencida(saude.fila, agora) || batidaVencida(saude.planner, agora);
}

/**
 * A fila está acumulando? Complementa a batida: o motor pode estar vivo (a
 * corrente inteira responde) e mesmo assim nada sair, por exemplo com o
 * provedor de WhatsApp fora do ar. A batida prova a corrente; isto prova o
 * trabalho.
 */
export function filaAtrasada(atrasados: number | null | undefined): boolean {
  return (atrasados ?? 0) > 0;
}

/** Por que o monitor externo deve disparar o alerta. */
export type AlertaDoMotor =
  | "fila_parada"
  | "planner_parado"
  | "fila_atrasada"
  | "planner_com_erro";

/**
 * Tudo o que justifica acordar o dono do produto, para o monitor externo
 * (rota /api/webhooks/saude). Lista vazia quer dizer saudavel.
 *
 * E mais rigorosa que a faixa da tela de proposito. A faixa fala com a
 * recepcionista e so aparece quando o motor PAROU, porque ela nao tem o que
 * fazer com "a fila atrasou". O monitor fala com quem conserta, e precisa
 * pegar tambem o modo de falha que a faixa nao ve: a corrente viva (as duas
 * batidas em dia) e o trabalho parado, seja a fila acumulando, seja o planner
 * errando a cada minuto sem nunca planejar uma regua.
 *
 * O erro do planner e o da ULTIMA passagem: motor_manutencao() grava null
 * quando a passagem sai limpa, entao um soluco isolado some no minuto
 * seguinte.
 */
export function alertasDoMotor(
  saude: SaudeDoMotor | null,
  agora: Date,
): AlertaDoMotor[] {
  const alertas: AlertaDoMotor[] = [];
  if (batidaVencida(saude?.fila ?? null, agora)) {
    alertas.push("fila_parada");
  }
  if (batidaVencida(saude?.planner ?? null, agora)) {
    alertas.push("planner_parado");
  }
  if (filaAtrasada(saude?.atrasados)) {
    alertas.push("fila_atrasada");
  }
  if (saude?.planner?.ultimo_erro) {
    alertas.push("planner_com_erro");
  }
  return alertas;
}
