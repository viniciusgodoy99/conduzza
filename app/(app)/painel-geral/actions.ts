"use server";

import { revalidatePath } from "next/cache";

import {
  agenteDaClinicaSchema,
  contaDaClinicaSchema,
  tetoDaIaSchema,
  TEXTOS_DO_PAINEL,
} from "@/components/painel-geral/painel-geral";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

// Acoes do Painel geral (onda 1, decisao do dono de 20/10/2026): suspender e
// reativar a conta de uma clinica, ligar o agente em teste ou desligar, e
// ajustar o teto de gasto da IA. So a equipe Conduzza (super admin).
//
// A AUTORIZACAO VIVE NO BANCO: cada acao e uma RPC do contrato da onda 1
// (migration 20261021100000_painel_geral.sql), chamada com a SESSAO, que
// recusa (42501) quem nao e is_product_admin() e grava a trilha (audit_log,
// com o motivo nos detalhes) na mesma transacao. A guarda daqui e a segunda
// camada (CLAUDE.md 3.4: esconder botao nao protege nada): sem sessao ou sem
// super admin, nada chega ao banco.
//
// Toda funcao exportada de um arquivo "use server" vira endpoint: cada uma
// confere por si (sessao, super admin e Zod estrito na entrada). Nada daqui
// vai para log alem do codigo do erro, da clinica e do tipo de acao: nunca
// o motivo (texto livre).

export type ResultadoDoPainel =
  { ok: true; jobsVencidos?: number } | { ok: false; error: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;
type ErroDoBanco = { code?: string; message?: string } | null;

/** O motivo do agente quando a tela nao manda nenhum. */
const MOTIVO_PADRAO_DO_AGENTE = "Painel geral";

/** null: pode seguir. */
async function guarda(): Promise<{ error: string } | null> {
  const context = await getSessionContext();
  if (!context) {
    return { error: TEXTOS_DO_PAINEL.sessaoExpirada };
  }
  if (!context.isProductAdmin) {
    return { error: TEXTOS_DO_PAINEL.soEquipeConduzza };
  }
  return null;
}

/** As chaves que as RPCs da onda 1 levantam (a mensagem do erro). */
const TEXTO_DA_CHAVE = new Map<string, (kind: string) => string>([
  ["clinica_ja_suspensa", () => TEXTOS_DO_PAINEL.jaSuspensa],
  ["clinica_nao_suspensa", () => TEXTOS_DO_PAINEL.jaAtiva],
  ["clinica_de_teste", () => TEXTOS_DO_PAINEL.agenteDeTesteRecusado],
  // Ligar em teste a clinica suspensa, ou mudar o teto com a liberacao
  // ligada na clinica suspensa.
  [
    "clinica_suspensa",
    (kind) =>
      kind === "teto"
        ? TEXTOS_DO_PAINEL.suspensaNaoMudaOTeto
        : TEXTOS_DO_PAINEL.suspensaNaoLigaOAgente,
  ],
  ["sem_liberacao", () => TEXTOS_DO_PAINEL.tetoSemLinha],
  ["motivo_invalido", () => TEXTOS_DO_PAINEL.motivoInvalido],
  ["teto_invalido", () => TEXTOS_DO_PAINEL.tetoInvalido],
  ["respostas_invalidas", () => TEXTOS_DO_PAINEL.respostasInvalidas],
  ["estado_invalido", () => TEXTOS_DO_PAINEL.producaoRecusada],
]);

/**
 * O erro do banco em texto de recepcionista, conforme a acao (contrato na
 * migration 20261021100000): 42501 e a permissao (so a equipe Conduzza);
 * P0002, a clinica que nao existe mais; P0001 e 22023 trazem a chave na
 * mensagem (clinica_ja_suspensa, clinica_suspensa, teto_invalido...). O
 * resto, o texto generico da acao.
 */
function textoDoErro(kind: string, error: ErroDoBanco, outro: string): string {
  const codigo = error?.code;
  if (codigo === "42501") {
    return TEXTOS_DO_PAINEL.soEquipeConduzza;
  }
  if (codigo === "P0002") {
    return TEXTOS_DO_PAINEL.clinicaNaoEncontrada;
  }
  const texto = TEXTO_DA_CHAVE.get((error?.message ?? "").trim());
  return texto ? texto(kind) : outro;
}

function falhou(
  clinicId: string,
  kind: string,
  error: ErroDoBanco,
  texto: string,
): ResultadoDoPainel {
  log.warn("painel_geral_nao_alterou", {
    clinic_id: clinicId,
    kind,
    error_code: error?.code ?? null,
  });
  return { ok: false, error: textoDoErro(kind, error, texto) };
}

/** A lista e o detalhe mostram o que mudou (e a aba da clinica tambem). */
function revalidarPainel() {
  revalidatePath("/painel-geral", "layout");
}

/** O jobs_vencidos de reativar_clinica; formato estranho vira nulo. */
function jobsVencidosDoBanco(valor: unknown): number | undefined {
  if (typeof valor !== "object" || valor === null) {
    return undefined;
  }
  const n = (valor as { jobs_vencidos?: unknown }).jobs_vencidos;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Suspende a conta da clinica, mantendo os dados (decisao do dono de
 * 20/10/2026). O banco grava a suspensao, devolve as conversas do agente
 * para a equipe e grava a trilha com o motivo.
 */
export async function suspenderClinicaAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = contaDaClinicaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: textoDaEntrada(parsed.error.issues) };
  }
  const { clinicId, motivo } = parsed.data;
  const supabase: Supabase = await createClient();
  const { error } = await supabase.rpc("suspender_clinica", {
    p_clinic_id: clinicId,
    p_motivo: motivo,
  });
  if (error) {
    return falhou(clinicId, "suspender", error, TEXTOS_DO_PAINEL.naoSuspendeu);
  }
  revalidarPainel();
  return { ok: true };
}

/**
 * Reativa a conta. O banco apaga a suspensao, cancela as mensagens
 * automaticas que venceram durante ela (as futuras continuam) e devolve
 * quantas, que a tela conta no aviso.
 */
export async function reativarClinicaAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = contaDaClinicaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: textoDaEntrada(parsed.error.issues) };
  }
  const { clinicId, motivo } = parsed.data;
  const supabase: Supabase = await createClient();
  const { data, error } = await supabase.rpc("reativar_clinica", {
    p_clinic_id: clinicId,
    p_motivo: motivo,
  });
  if (error) {
    return falhou(clinicId, "reativar", error, TEXTOS_DO_PAINEL.naoReativou);
  }
  revalidarPainel();
  const jobsVencidos = jobsVencidosDoBanco(data);
  return jobsVencidos === undefined ? { ok: true } : { ok: true, jobsVencidos };
}

/**
 * Liga o agente da clinica em teste ou desliga (ia_clinica_habilitada, pela
 * RPC). Producao fica travada ate a onda 2: recusada aqui, antes do banco
 * (que tambem recusa: o CHECK so aceita desligado e teste).
 */
export async function definirAgenteDaClinicaAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = agenteDaClinicaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS_DO_PAINEL.dadosInvalidos };
  }
  const { clinicId, estado, motivo } = parsed.data;
  if (estado === "producao") {
    return { ok: false, error: TEXTOS_DO_PAINEL.producaoRecusada };
  }
  const supabase: Supabase = await createClient();
  const { error } = await supabase.rpc("definir_agente_da_clinica", {
    p_clinic_id: clinicId,
    p_estado: estado,
    p_motivo: motivo ? motivo : MOTIVO_PADRAO_DO_AGENTE,
  });
  if (error) {
    return falhou(clinicId, "agente", error, TEXTOS_DO_PAINEL.naoMudouOAgente);
  }
  revalidarPainel();
  // A aba Agente de IA de Configuracoes aparece e some com o estado.
  revalidatePath("/configuracoes");
  return { ok: true };
}

/**
 * O teto diario (centavos de dolar, janela movel de 24 horas) e as
 * respostas por conversa por hora. A tela le os dolares e manda centavos.
 */
export async function definirTetoDaIaAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = tetoDaIaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: textoDaEntrada(parsed.error.issues) };
  }
  const { clinicId, tetoDiarioCentavos, respostasPorConversaHora } =
    parsed.data;
  const supabase: Supabase = await createClient();
  const { error } = await supabase.rpc("definir_teto_da_ia", {
    p_clinic_id: clinicId,
    p_teto_diario_centavos_usd: tetoDiarioCentavos,
    p_teto_respostas_por_conversa_hora: respostasPorConversaHora,
  });
  if (error) {
    return falhou(clinicId, "teto", error, TEXTOS_DO_PAINEL.naoMudouOTeto);
  }
  revalidarPainel();
  revalidatePath("/configuracoes");
  return { ok: true };
}

/**
 * O problema da entrada em texto de recepcao: a mensagem do campo quando o
 * Zod tem uma (motivo curto, teto fora da faixa); tipo errado ou campo a
 * mais, "Dados inválidos".
 */
function textoDaEntrada(
  issues: readonly { code: string; path: PropertyKey[]; message: string }[],
): string {
  const problema = issues[0];
  if (
    problema &&
    problema.code !== "invalid_type" &&
    problema.code !== "unrecognized_keys" &&
    problema.path.length > 0 &&
    problema.path[0] !== "clinicId"
  ) {
    return problema.message;
  }
  return TEXTOS_DO_PAINEL.dadosInvalidos;
}
