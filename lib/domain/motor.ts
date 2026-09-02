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
