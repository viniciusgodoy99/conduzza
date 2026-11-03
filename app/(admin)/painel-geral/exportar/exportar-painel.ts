import type { SupabaseClient } from "@supabase/supabase-js";

import {
  detalhesDaTrilhaDoPainel,
  exportacaoDoPainelSchema,
  filtrosEOrdemDoPedido,
  linhasDaExportacaoDoPainel,
  MENSAGEM_EXPORTACAO_DO_PAINEL_FALHOU,
  MENSAGEM_EXPORTACAO_DO_PAINEL_FILTROS_INVALIDOS,
  MENSAGEM_EXPORTACAO_DO_PAINEL_TRILHA_FALHOU,
  nomeDoArquivoDoPainel,
} from "@/components/painel-geral/exportacao-do-painel";
import {
  filtrarClinicas,
  ordenarClinicas,
} from "@/components/painel-geral/painel-geral";
import {
  fetchPainelGeral,
  registrarExportacaoDoPainel,
  type TrilhaDaExportacaoDoPainel,
} from "@/lib/queries/painel-geral";
import { gerarCsv } from "@/lib/utils/csv";

// A exportacao da lista do Painel geral no SERVIDOR (segunda leva,
// 26/10/2026; escolha (7) do dono), no molde da exportacao dos leads
// (lib/queries/exportacao-de-leads.ts). Quem chama (a rota) ja conferiu a
// sessao e a equipe Conduzza; aqui, na ordem:
// 1. o corpo validado (Zod estrito: os filtros e a ordem da tela);
// 2. a lista lida de novo pela SESSAO (painel_cs_das_clinicas, que recusa
//    quem nao e da equipe Conduzza), com os MESMOS filtros e a MESMA ordem
//    da tela (filtrarClinicas e ordenarClinicas);
// 3. nenhuma clinica: "vazio", nada vai para a trilha;
// 4. o CSV inteiro montado;
// 5. a trilha (UMA linha em audit_log, com a quantidade, os filtros e a
//    ordem; da busca, so que havia uma); sem ela gravada, nada sai;
// 6. so entao o arquivo.
// Nada de dado de paciente: o arquivo so tem contagens de paciente.

export type ResultadoDaExportacaoDoPainel =
  | { tipo: "arquivo"; nome: string; conteudo: string; quantidade: number }
  | { tipo: "vazio" }
  | { tipo: "recusada"; status: 400; mensagem: string }
  | {
      tipo: "falhou";
      status: 500 | 503;
      mensagem: string;
      /** Para o log da rota: em que passo parou (nunca o dado). */
      motivo: "leitura" | "trilha";
    };

export async function exportarPainel({
  supabase,
  userId,
  entrada,
  agora,
}: {
  supabase: SupabaseClient;
  /** Quem exporta (a trilha e dela; a policy exige auth.uid()). */
  userId: string;
  /** O corpo da rota, ainda nao validado. */
  entrada: unknown;
  /** O dia do nome do arquivo. */
  agora: Date;
}): Promise<ResultadoDaExportacaoDoPainel> {
  const parsed = exportacaoDoPainelSchema.safeParse(entrada);
  if (!parsed.success) {
    return {
      tipo: "recusada",
      status: 400,
      mensagem: MENSAGEM_EXPORTACAO_DO_PAINEL_FILTROS_INVALIDOS,
    };
  }
  const { filtros, ordem } = filtrosEOrdemDoPedido(parsed.data);

  let conteudo: string;
  let quantidade: number;
  try {
    const painel = await fetchPainelGeral(supabase);
    const clinicas = ordenarClinicas(
      filtrarClinicas(painel.clinicas, filtros),
      ordem,
    );
    if (clinicas.length === 0) {
      return { tipo: "vazio" };
    }
    quantidade = clinicas.length;
    conteudo = gerarCsv(linhasDaExportacaoDoPainel(clinicas));
  } catch {
    return {
      tipo: "falhou",
      status: 500,
      mensagem: MENSAGEM_EXPORTACAO_DO_PAINEL_FALHOU,
      motivo: "leitura",
    };
  }

  const trilha = await registrarExportacaoDoPainel(supabase, {
    userId,
    detalhes: detalhesDaTrilhaDoPainel(quantidade, filtros, ordem),
  }).catch((): TrilhaDaExportacaoDoPainel => "falhou");
  if (trilha === "falhou") {
    return {
      tipo: "falhou",
      status: 503,
      mensagem: MENSAGEM_EXPORTACAO_DO_PAINEL_TRILHA_FALHOU,
      motivo: "trilha",
    };
  }

  return {
    tipo: "arquivo",
    nome: nomeDoArquivoDoPainel(agora),
    conteudo,
    quantidade,
  };
}
