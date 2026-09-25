import { z } from "zod";

// Aba "Clinica" das Configuracoes (achado 123 da revisao de liberacao): nome
// e fuso horario da clinica. Modulo puro, sem "use client": a mesma lista e o
// mesmo schema servem a tela e a Server Action, sem espelho para
// dessincronizar.
//
// Os fusos sao os IANA do Brasil (tzdata, zone1970.tab), com as UFs que cada
// um cobre. Lista FECHADA: fuso livre deixaria gravar "UTC" ou um fuso de
// outro pais, e a regua, a agenda e o corte de hoje e amanha passariam a
// andar nele. O deslocamento em relacao a UTC nao fica escrito aqui: a tela
// calcula na hora, para nao mentir se o horario de verao voltar.

export const FUSOS_DO_BRASIL = [
  { valor: "America/Noronha", rotulo: "Fernando de Noronha" },
  { valor: "America/Belem", rotulo: "Pará (leste) e Amapá" },
  {
    valor: "America/Fortaleza",
    rotulo: "Ceará, Rio Grande do Norte, Paraíba, Piauí e Maranhão",
  },
  { valor: "America/Recife", rotulo: "Pernambuco" },
  { valor: "America/Araguaina", rotulo: "Tocantins" },
  { valor: "America/Maceio", rotulo: "Alagoas e Sergipe" },
  { valor: "America/Bahia", rotulo: "Bahia" },
  {
    valor: "America/Sao_Paulo",
    rotulo: "Sul, Sudeste, Goiás e Distrito Federal",
  },
  { valor: "America/Campo_Grande", rotulo: "Mato Grosso do Sul" },
  { valor: "America/Cuiaba", rotulo: "Mato Grosso" },
  { valor: "America/Santarem", rotulo: "Pará (oeste)" },
  { valor: "America/Porto_Velho", rotulo: "Rondônia" },
  { valor: "America/Boa_Vista", rotulo: "Roraima" },
  { valor: "America/Manaus", rotulo: "Amazonas (leste)" },
  { valor: "America/Eirunepe", rotulo: "Amazonas (oeste)" },
  { valor: "America/Rio_Branco", rotulo: "Acre" },
] as const;

export type FusoDoBrasil = (typeof FUSOS_DO_BRASIL)[number]["valor"];

const VALORES_DE_FUSO = FUSOS_DO_BRASIL.map((fuso) => fuso.valor) as [
  FusoDoBrasil,
  ...FusoDoBrasil[],
];

export function ehFusoDoBrasil(valor: string): valor is FusoDoBrasil {
  return (VALORES_DE_FUSO as readonly string[]).includes(valor);
}

export const dadosDaClinicaSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "O nome precisa de pelo menos 2 letras.")
    .max(80, "Use no máximo 80 caracteres."),
  timezone: z.enum(VALORES_DE_FUSO, {
    error: "Escolha um fuso horário da lista.",
  }),
});

export type DadosDaClinica = z.infer<typeof dadosDaClinicaSchema>;
