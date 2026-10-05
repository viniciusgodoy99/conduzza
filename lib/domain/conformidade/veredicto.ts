// Contrato entre o filtro (dominio) e o verificador por modelo (integracao).
// O filtro recebe o verificador INJETADO: nos testes, um falso; em producao,
// o Haiku (lib/integrations/llm/verificador.ts). PURO.

import { z } from "zod";

import { CATEGORIAS_DO_VERIFICADOR } from "@/lib/domain/conformidade/categorias";

/**
 * Saida estruturada do verificador. Sem trecho de texto: so categoria,
 * gravidade e confianca (o que volta do modelo vai para log e banco, e
 * texto de paciente nao pode ir).
 */
export const EsquemaDoVeredicto = z
  .object({
    aprovado: z.boolean(),
    violacoes: z
      .array(
        z
          .object({
            categoria: z.enum(CATEGORIAS_DO_VERIFICADOR),
            gravidade: z.enum(["alta", "media"]),
          })
          .strict(),
      )
      .max(12),
    confianca: z.enum(["alta", "media", "baixa"]),
  })
  .strict();

export type Veredicto = z.infer<typeof EsquemaDoVeredicto>;

export type UsoDoLlm = {
  tokensEntrada: number;
  tokensSaida: number;
  tokensCacheLidos: number;
  tokensCacheGravados: number;
};

/**
 * Por que o verificador nao deu veredicto. Todos resultam em bloqueio
 * (falha fechada); o motivo existe so para log e para o desligamento
 * automatico por instabilidade.
 */
export const MOTIVOS_DA_FALHA = [
  "sem_cliente",
  "modelo_invalido",
  "prazo",
  "timeout",
  "conexao",
  "abortado",
  "limite",
  "sobrecarga",
  "servidor",
  "requisicao_invalida",
  "autenticacao",
  "permissao",
  "nao_encontrado",
  "outro_http",
  "recusa",
  "max_tokens",
  "parada_inesperada",
  "saida_invalida",
  "incoerente",
  "confianca_baixa",
  "contexto_truncado",
  "desconhecida",
] as const;

export type MotivoDaFalha = (typeof MOTIVOS_DA_FALHA)[number];

export function ehMotivoDaFalha(valor: unknown): valor is MotivoDaFalha {
  return (
    typeof valor === "string" &&
    (MOTIVOS_DA_FALHA as readonly string[]).includes(valor)
  );
}

export type ResultadoDoVerificador =
  | {
      tipo: "veredicto";
      veredicto: Veredicto;
      modelo: string;
      uso: UsoDoLlm | null;
    }
  | {
      tipo: "falha";
      motivo: MotivoDaFalha;
      modelo: string | null;
      uso: UsoDoLlm | null;
      httpStatus: number | null;
    };

export type EntradaDoVerificador = {
  rascunho: string;
  mensagensDoPaciente: readonly string[];
  /** Abortado quando o prazo do filtro estoura. */
  sinal: AbortSignal;
};

export type Verificador = (
  entrada: EntradaDoVerificador,
) => Promise<ResultadoDoVerificador>;
