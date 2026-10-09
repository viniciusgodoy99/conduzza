import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mesmasInstrucoes } from "@/lib/domain/agente/config";
import { VERSOES_NA_TELA } from "@/lib/queries/agente";
import { createAdminClient } from "@/lib/supabase/admin";

import { carregarCatalogoDoAgente, carregarConfigDoRascunho } from "./contexto";
import { agoraNaClinica, previaDoPrompt } from "./prompt";

// O que a pagina da Tela 6 so consegue saber pelo cliente de SERVICE ROLE
// (revisao de 06/10/2026, achados 16, 25, 28, 35 e 38), sem nunca entregar o
// texto das instrucoes a quem nao e super admin:
//  - instrucoesMudaram: o rascunho muda as instrucoes em relacao a ultima
//    publicada? Vale para TODOS que configuram: a linha "Instruções da
//    equipe Conduzza" entra na contagem, no publicar e na proxima versao
//    (comMudancaDasInstrucoes), sem conteudo;
//  - versoesComInstrucoesMudadas: as versoes publicadas que mudaram as
//    instrucoes em relacao a anterior (o "o que mudou" das Versões);
//  - previa: a "Prévia do prompt", so para o super admin.
// Cada parte tem a propria leitura e o proprio erro: falha ao ler o
// catalogo nao derruba a conferencia das instrucoes (e vice-versa), e o que
// falhou volta null (a tela nao inventa a linha das instrucoes).
// Isolamento por clinica AQUI: toda consulta leva o clinic_id da sessao.

export type ExtrasDoPainel = {
  /** null = nao deu para conferir. */
  instrucoesMudaram: boolean | null;
  /** null = nao deu para conferir. */
  versoesComInstrucoesMudadas: number[] | null;
  /** So para o super admin; null para os outros ou quando falhou. */
  previa: string | null;
};

type LinhaDasInstrucoes = { version: number; instrucoes: string | null };

/** Os dois sinais das instrucoes. Lanca se a leitura falhar. */
export async function sinaisDasInstrucoes(
  admin: SupabaseClient,
  clinicId: string,
): Promise<{
  instrucoesMudaram: boolean;
  versoesComInstrucoesMudadas: number[];
}> {
  const [rascunho, publicadas] = await Promise.all([
    admin
      .from("ai_agent_config")
      .select("version, instrucoes")
      .eq("clinic_id", clinicId)
      .eq("status", "rascunho")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("ai_agent_config")
      .select("version, instrucoes")
      .eq("clinic_id", clinicId)
      .eq("status", "publicada")
      .order("version", { ascending: false })
      .limit(VERSOES_NA_TELA + 1),
  ]);
  if (rascunho.error || publicadas.error) {
    throw new Error("leitura das instrucoes do agente falhou");
  }
  const linhaDoRascunho = rascunho.data as LinhaDasInstrucoes | null;
  const linhas = (publicadas.data ?? []) as LinhaDasInstrucoes[];
  const ultima = linhas[0] ?? null;
  // A mais antiga lida so serve de "anterior" quando ha mais versoes que a
  // tela mostra; sem anterior, a versao compara com o padrao (sem
  // instrucoes), como diferencasDoRascunho.
  const versoesComInstrucoesMudadas = linhas
    .slice(0, VERSOES_NA_TELA)
    .filter(
      (linha, indice) =>
        !mesmasInstrucoes(linha.instrucoes, linhas[indice + 1]?.instrucoes),
    )
    .map((linha) => linha.version);
  return {
    instrucoesMudaram:
      linhaDoRascunho !== null &&
      !mesmasInstrucoes(linhaDoRascunho.instrucoes, ultima?.instrucoes),
    versoesComInstrucoesMudadas,
  };
}

/**
 * Tudo que a pagina precisa da service role, cada parte com o seu erro.
 * Nunca lanca.
 */
export async function extrasDoPainel(
  admin: SupabaseClient,
  entrada: {
    clinicId: string;
    timezone: string;
    superAdmin: boolean;
    agoraMs: number;
  },
): Promise<ExtrasDoPainel> {
  const [sinais, previa] = await Promise.all([
    sinaisDasInstrucoes(admin, entrada.clinicId).catch(() => null),
    entrada.superAdmin
      ? Promise.all([
          carregarConfigDoRascunho(admin, entrada.clinicId),
          carregarCatalogoDoAgente(admin, entrada.clinicId),
        ])
          .then(([motor, catalogo]) =>
            previaDoPrompt({
              config: motor.config,
              catalogo,
              agoraTexto: agoraNaClinica(entrada.agoraMs, entrada.timezone),
            }),
          )
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  return {
    instrucoesMudaram: sinais?.instrucoesMudaram ?? null,
    versoesComInstrucoesMudadas: sinais?.versoesComInstrucoesMudadas ?? null,
    previa,
  };
}

const SEM_EXTRAS: ExtrasDoPainel = {
  instrucoesMudaram: null,
  versoesComInstrucoesMudadas: null,
  previa: null,
};

/**
 * O mesmo, criando o cliente de service role (o que a pagina chama). Sem a
 * chave de servico no ambiente, tudo volta null. Nunca lanca.
 */
export async function carregarExtrasDoPainel(entrada: {
  clinicId: string;
  timezone: string;
  superAdmin: boolean;
  agoraMs: number;
}): Promise<ExtrasDoPainel> {
  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return SEM_EXTRAS;
  }
  return extrasDoPainel(admin, entrada);
}
