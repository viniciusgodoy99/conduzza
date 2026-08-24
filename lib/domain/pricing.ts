import { formatarCentavos } from "@/lib/utils/moeda";

// Os TRES estados de preco de um vinculo (docs/04, nota da secao 2):
//   price_cents = 0                        -> "R$ 0,00" (gratuito de verdade)
//   covered_by_insurance e price nulo      -> "Coberto"  (rotulo, nunca moeda)
//   price_cents nulo sem cobertura         -> vazio      (nao informado)
// Confundir os tres faz a IA informar preco errado ao paciente. E o aceite
// da tarefa 2.2.

export type PrecoVinculo = {
  price_cents: number | null;
  covered_by_insurance: boolean;
};

export type ExibicaoDePreco =
  | { kind: "coberto"; text: "Coberto" }
  | { kind: "valor"; text: string }
  | { kind: "vazio"; text: "" };

export function exibirPrecoVinculo(vinculo: PrecoVinculo): ExibicaoDePreco {
  if (vinculo.covered_by_insurance && vinculo.price_cents === null) {
    return { kind: "coberto", text: "Coberto" };
  }
  if (vinculo.price_cents !== null) {
    return { kind: "valor", text: formatarCentavos(vinculo.price_cents) };
  }
  return { kind: "vazio", text: "" };
}
