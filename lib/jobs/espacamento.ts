// Espacamento anti-ban do disparo ATIVO (confirmacao de atendimento e toque de
// regua): a especificacao do canal nao oficial pede 10 a 30 segundos entre
// mensagens do mesmo numero. Fica num arquivo proprio porque dois executores
// da fila dependem do MESMO numero, e duas copias viram duas regras.
export function espacamentoDeMassaMs(): number {
  return 10_000 + Math.floor(Math.random() * 20_000);
}
