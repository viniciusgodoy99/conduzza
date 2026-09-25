import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EsperandoPorNumero } from "@/lib/domain/conexao-dos-numeros";

// Quantas mensagens automaticas esperam por um numero desconectado (faixa do
// topo, docs/07 Fase 4). A fila (job_queue) so e legivel pelo administrador
// na RLS, e a faixa aparece para toda a equipe: por isso a contagem roda com
// o service role, SEMPRE presa a clinica da sessao (quem chama passa a
// clinica ativa conferida). Sai so um numero por numero de WhatsApp: nenhum
// conteudo, nenhum paciente.

/**
 * Os kinds que mandam mensagem pelo numero: os mesmos KINDS_DE_ENVIO do motor
 * (lib/jobs/motor.ts), que nao os exporta. Mudou la, muda aqui.
 */
export const KINDS_DE_ENVIO_AUTOMATICO = [
  "enviar_mensagem_ativa",
  "executar_passo_de_regua",
] as const;

/** Teto de numeros por consulta: a faixa nunca conta mais do que isto. */
export const MAX_NUMEROS_CONTADOS = 20;

/**
 * Conta, por numero, os envios automaticos PENDENTES que ja deveriam ter
 * saido: a hora chegou (run_at no passado) ou o motor ja tentou e devolveu
 * para a fila (attempts ou devolucoes acima de zero). Com o numero
 * desconectado, o toque de regua e o envio ativo do worker esperam a
 * reconexao: sao devolvidos em esperas crescentes de 5 ate 30 minutos, sem
 * gastar tentativa, entao o run_at fica sempre no futuro e eles entram por
 * devolucoes. A confirmacao marcada para a semana que vem nao "espera" a
 * reconexao e fica de fora.
 *
 * Uma contagem por numero (head, sem trazer linha), no indice
 * job_queue_numero_prioridade_idx. Falha de leitura de um numero: ele fica
 * fora do resultado, e a faixa nao afirma nada sobre ele.
 */
export async function contarMensagensEsperando(
  admin: SupabaseClient,
  clinicId: string,
  numeroIds: readonly string[],
  agora: Date = new Date(),
): Promise<EsperandoPorNumero> {
  const ids = [...new Set(numeroIds)].slice(0, MAX_NUMEROS_CONTADOS);
  const agoraIso = agora.toISOString();
  const contagens = await Promise.all(
    ids.map(async (id) => {
      const { count, error } = await admin
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("whatsapp_account_id", id)
        .eq("status", "pendente")
        .in("kind", [...KINDS_DE_ENVIO_AUTOMATICO])
        // Aspas no valor: a hora ISO tem ":" e ".", que a arvore logica do
        // PostgREST reserva.
        .or(`run_at.lte."${agoraIso}",attempts.gt.0,devolucoes.gt.0`);
      return error ? null : ([id, count ?? 0] as const);
    }),
  );
  const resultado: Record<string, number> = {};
  for (const contagem of contagens) {
    if (contagem) {
      resultado[contagem[0]] = contagem[1];
    }
  }
  return resultado;
}
