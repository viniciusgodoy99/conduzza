// Saúde do motor de automação, como regra pura.
//
// Fica fora do layout porque a decisão é a parte que importa e a que erra: o
// layout só desenha. Sem pg_cron neste projeto, um único processo executa tudo
// que é automático, e quando ele morre a tela ficava idêntica à de uma clínica
// saudável. Este é o cálculo que tira esse silêncio.

/**
 * Quanto tempo sem batida antes de avisar. O worker bate a cada 30 segundos,
 * então três minutos são seis batidas perdidas: não alarma por uma
 * reinicialização rápida e avisa muito antes de a clínica perder o toque do
 * dia.
 */
export const TOLERANCIA_DE_BATIDA_MS = 3 * 60_000;

/**
 * O motor está parado? Batida nenhuma conta como parado: ou o worker nunca
 * subiu, ou está fora do ar desde antes de existir o carimbo. Nos dois casos
 * nada automático acontece, que é o que a clínica precisa saber.
 */
export function motorParado(
  ultimaBatida: string | null | undefined,
  agora: Date,
): boolean {
  if (!ultimaBatida) {
    return true;
  }
  const batida = new Date(ultimaBatida).getTime();
  if (Number.isNaN(batida)) {
    return true;
  }
  return agora.getTime() - batida > TOLERANCIA_DE_BATIDA_MS;
}
