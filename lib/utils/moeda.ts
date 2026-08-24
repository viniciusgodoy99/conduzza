// Formatacao de moeda em centavos, pt-BR. Fonte mono tabular fica no
// componente; aqui e so o texto.

const formatador = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatarCentavos(cents: number): string {
  return formatador.format(cents / 100);
}
