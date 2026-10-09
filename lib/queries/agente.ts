import type { SupabaseClient } from "@supabase/supabase-js";

import {
  baseDoConhecimento,
  comMudancaDasInstrucoes,
  configDaLinha,
  configPadraoDoAgente,
  diferencasDoRascunho,
  type ConfigDoAgente,
  type ItemDaBase,
  type LinhaDaConfigDoAgente,
  type Mudanca,
} from "@/lib/domain/agente/config";
import { fetchProfileNames } from "@/lib/queries/profiles";

// Leitura da Tela 6 (Agente de IA) pela SESSAO: a RLS isola a clinica e a
// policy deixa ler membro ativo e super admin (migration 20261006150000).
// Colunas SEMPRE explicitas, nunca "*": a sessao nao tem grant na coluna
// instrucoes, e um select * daria 42501. As instrucoes so chegam ao super
// admin, pela RPC instrucoes_do_agente.
//
// Escrita nunca passa por aqui: e das Server Actions (app/(app)/agente/
// actions.ts). Nada daqui vai para log, e aqui nao ha dado de paciente: a
// base e a configuracao sao textos da clinica.
//
// Se as instrucoes mudaram (rascunho contra publicada, e versao contra
// versao) so o servidor sabe, pela service role (lib/agente/painel.ts); quem
// chama passa o sinal nas opcoes e a linha "Instruções da equipe Conduzza"
// entra sem conteudo (comMudancaDasInstrucoes).

/** Colunas da configuracao que a sessao le (todas menos instrucoes). */
export const COLUNAS_DA_CONFIG_DO_AGENTE =
  "id, version, status, agent_name, tone, use_emoji, greeting, closing, skills, operating_mode, fallback_minutes, operating_hours, conhecimento, published_at, published_by";

type LinhaDaSessao = LinhaDaConfigDoAgente & {
  id: string;
  conhecimento: unknown;
  published_at: string | null;
  published_by: string | null;
};

/** O PostgREST corta em max_rows sem erro: le por paginas. */
const PAGINA = 1000;

/**
 * A base viva (knowledge_item), com ativas e inativas, na ordem em que a
 * publicacao congela (criacao e id). Lanca se a leitura falhar.
 */
export async function fetchBaseDoAgente(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ItemDaBase[]> {
  const itens: ItemDaBase[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from("knowledge_item")
      .select("id, question, answer, active")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) {
      throw new Error("leitura da base do agente falhou");
    }
    const linhas = (data ?? []) as {
      id: string;
      question: string;
      answer: string;
      active: boolean;
    }[];
    for (const linha of linhas) {
      itens.push({
        id: linha.id,
        pergunta: linha.question,
        resposta: linha.answer,
        ativo: linha.active === true,
      });
    }
    if (linhas.length < PAGINA) {
      return itens;
    }
  }
}

export type DadosDaConfigDoAgente = {
  /**
   * O que a tela edita: o rascunho; sem rascunho, a ultima publicada (o que
   * garantir_rascunho_do_agente copiaria); sem nenhuma, os padroes. A base e
   * a viva. instrucoes so para o super admin (lerInstrucoes).
   */
  config: ConfigDoAgente;
  temRascunho: boolean;
  /** A ultima publicada, com a base congelada; nula se nunca publicou. */
  publicada: ConfigDoAgente | null;
  /**
   * O que o rascunho muda em relacao a publicada ("N alterações não
   * publicadas"). As instrucoes entram pelo sinal do servidor
   * (opcoes.instrucoesMudaram), nunca pela comparacao daqui: a sessao nao
   * le as da publicada.
   */
  mudancas: Mudanca[];
};

async function linhaDaConfig(
  supabase: SupabaseClient,
  clinicId: string,
  status: "rascunho" | "publicada",
): Promise<LinhaDaSessao | null> {
  const { data, error } = await supabase
    .from("ai_agent_config")
    .select(COLUNAS_DA_CONFIG_DO_AGENTE)
    .eq("clinic_id", clinicId)
    .eq("status", status)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error("leitura da configuracao do agente falhou");
  }
  return (data as LinhaDaSessao | null) ?? null;
}

/**
 * A configuracao da Tela 6. lerInstrucoes so para o super admin (a RPC
 * recusa os outros com 42501, e isso LANCA aqui).
 */
export async function fetchConfigDoAgente(
  supabase: SupabaseClient,
  clinicId: string,
  opcoes: {
    lerInstrucoes?: boolean;
    /** sinaisDasInstrucoes (lib/agente/painel.ts); null = nao conferido. */
    instrucoesMudaram?: boolean | null;
  } = {},
): Promise<DadosDaConfigDoAgente> {
  const [rascunho, publicadaLinha, base] = await Promise.all([
    linhaDaConfig(supabase, clinicId, "rascunho"),
    linhaDaConfig(supabase, clinicId, "publicada"),
    fetchBaseDoAgente(supabase, clinicId),
  ]);

  let instrucoes: string | null = null;
  if (opcoes.lerInstrucoes) {
    const { data, error } = await supabase.rpc("instrucoes_do_agente", {
      p_clinic_id: clinicId,
    });
    if (error) {
      throw new Error("leitura das instrucoes do agente falhou");
    }
    instrucoes = typeof data === "string" ? data : null;
  }

  const publicada =
    publicadaLinha === null
      ? null
      : configDaLinha(publicadaLinha, {
          base: baseDoConhecimento(publicadaLinha.conhecimento),
        });
  const origem = rascunho ?? publicadaLinha;
  const semInstrucoes: ConfigDoAgente =
    origem === null
      ? { ...configPadraoDoAgente(), base }
      : { ...configDaLinha(origem, { base }), status: "rascunho" };

  return {
    config: { ...semInstrucoes, instrucoes },
    temRascunho: rascunho !== null,
    publicada,
    mudancas: comMudancaDasInstrucoes(
      diferencasDoRascunho(semInstrucoes, publicada),
      opcoes.instrucoesMudaram ?? null,
    ),
  };
}

export type VersaoPublicadaDoAgente = {
  versao: number;
  /** ISO (timestamptz); a tela exibe no fuso da clinica. */
  publicadaEm: string;
  autorId: string | null;
  /** Nome de quem publicou; nulo quando nao se sabe (saiu da clinica). */
  autor: string | null;
  /** diferencasDoRascunho(esta, anterior); a primeira compara com o padrao. */
  mudancas: Mudanca[];
  /** A ultima publicada: a que o assistente usa. */
  emUso: boolean;
};

/** Quantas versoes a tela mostra (as mais novas). */
export const VERSOES_NA_TELA = 50;

/**
 * O historico das versoes publicadas, da mais nova para a mais antiga, com
 * o autor e o que cada uma mudou em relacao a anterior (pela base
 * congelada). Le uma a mais para a diferenca da mais antiga da lista.
 */
export async function fetchVersoesDoAgente(
  supabase: SupabaseClient,
  clinicId: string,
  opcoes: {
    /** sinaisDasInstrucoes (lib/agente/painel.ts); null = nao conferido. */
    versoesComInstrucoesMudadas?: readonly number[] | null;
  } = {},
): Promise<VersaoPublicadaDoAgente[]> {
  const { data, error } = await supabase
    .from("ai_agent_config")
    .select(COLUNAS_DA_CONFIG_DO_AGENTE)
    .eq("clinic_id", clinicId)
    .eq("status", "publicada")
    .order("version", { ascending: false })
    .limit(VERSOES_NA_TELA + 1);
  if (error) {
    throw new Error("leitura das versoes do agente falhou");
  }
  const linhas = (data ?? []) as LinhaDaSessao[];
  const configs = linhas.map((linha) =>
    configDaLinha(linha, { base: baseDoConhecimento(linha.conhecimento) }),
  );

  const ids = [
    ...new Set(
      linhas
        .map((linha) => linha.published_by)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  let nomes: Record<string, string> = {};
  try {
    nomes = await fetchProfileNames(supabase, ids);
  } catch {
    // Sem o nome a versao continua na lista: o autor fica "nao sabido".
    nomes = {};
  }

  return linhas.slice(0, VERSOES_NA_TELA).map((linha, indice) => {
    const config = configs[indice] as ConfigDoAgente;
    const anterior = configs[indice + 1] ?? null;
    return {
      versao: linha.version,
      publicadaEm: linha.published_at ?? "",
      autorId: linha.published_by,
      autor:
        linha.published_by === null
          ? null
          : (nomes[linha.published_by] ?? null),
      mudancas: comMudancaDasInstrucoes(
        diferencasDoRascunho(config, anterior),
        opcoes.versoesComInstrucoesMudadas
          ? opcoes.versoesComInstrucoesMudadas.includes(linha.version)
          : null,
      ),
      emUso: indice === 0,
    };
  });
}
