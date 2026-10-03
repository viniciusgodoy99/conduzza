import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { diaCivil, diasEntre } from "@/lib/domain/horarios";
import {
  DIAS_DA_LEITURA_DIARIA,
  DIAS_DA_PRIMEIRA_LEITURA,
  normalizarContaDeAnuncios,
} from "@/lib/domain/meta-anuncios";
import {
  ESPERA_DO_LIMITE_PADRAO_MS,
  lerGastoParaSincronizar,
  type FalhaDeLeitura,
} from "@/lib/integrations/meta/insights";
import { codigoDoErro } from "@/lib/jobs/erro-de-job";
import type { Job, ResultadoDeJob } from "@/lib/jobs/worker";
import { log } from "@/lib/log";

// Job sincronizar_gasto_meta (Fase 4): le o investimento da conta de anuncios
// da clinica na Meta e regrava a janela no banco (meta_gasto_diario,
// meta_gasto_conta_diario, meta_anuncio e a situacao em meta_gasto_leitura).
//
// O job e IDEMPOTENTE: so le na Meta e substitui a janela inteira numa
// transacao (regravar_gasto_meta). Repetir e sempre seguro.
//
// SEGREDO (C14): o token de leitura e lido aqui pelo cliente de servico e
// nunca sai daqui. Nenhuma funcao do banco devolve o token; as funcoes de
// gravacao recebem so o sha256 dele, para recusar ("config_mudou") a escrita
// de um job que leu com a conta ou o token que a gestao acabou de trocar.
// Nada de token, URL ou mensagem da Meta em log ou em last_error: so codigos.

// D4 do dono: as constantes vivem no dominio puro (a tela pode importar sem
// puxar node:crypto) e sao reexportadas aqui, junto de quem as usa.
export { DIAS_DA_LEITURA_DIARIA, DIAS_DA_PRIMEIRA_LEITURA };
/**
 * Prazo da leitura na Meta. Com as RPCs de configuracao e de regravacao fica
 * abaixo do CUSTO_ESTIMADO_MS de 40 s do motor, do orcamento de 45 s da
 * passagem e do maxDuration de 60 s da rota.
 */
export const PRAZO_DA_LEITURA_MS = 35_000;
/** O limite da Meta devolve o job entre 5 e 60 minutos depois. */
export const ESPERA_MINIMA_DO_LIMITE_MS = 5 * 60_000;
export const ESPERA_MAXIMA_DO_LIMITE_MS = 60 * 60_000;

/** sha256 hex do token, o mesmo que o banco calcula para conferir. */
export function sha256DoToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

type LeituraAnterior = {
  ad_account_id: string | null;
  lido_desde: string | null;
  lido_ate: string | null;
  fuso_da_conta: string | null;
};

/**
 * Quantos dias ler (D4): a primeira leitura, a troca de conta e a volta
 * depois de um buraco maior que a janela diaria (leitura pausada por token
 * vencido, por exemplo) leem DIAS_DA_PRIMEIRA_LEITURA; o resto,
 * DIAS_DA_LEITURA_DIARIA. Sem o caso do buraco, a cobertura recomecaria do
 * zero (a regravacao zera lido_desde quando a janela nao encosta na
 * anterior) e a comparacao com o periodo anterior sumiria.
 */
export function diasDaLeitura(
  leitura: LeituraAnterior | null,
  adAccountId: string,
  agoraMs: number,
): number {
  if (
    !leitura ||
    !leitura.lido_desde ||
    !leitura.lido_ate ||
    leitura.ad_account_id !== adAccountId
  ) {
    return DIAS_DA_PRIMEIRA_LEITURA;
  }
  if (leitura.fuso_da_conta) {
    try {
      const hoje = diaCivil(leitura.fuso_da_conta, new Date(agoraMs));
      if (diasEntre(leitura.lido_ate, hoje) > DIAS_DA_LEITURA_DIARIA) {
        return DIAS_DA_PRIMEIRA_LEITURA;
      }
    } catch {
      // Fuso ilegivel: fica a janela diaria.
    }
  }
  return DIAS_DA_LEITURA_DIARIA;
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor));
}

/** Codigo curto para last_error e log: o problema e o numero da Meta. */
function codigoDaFalha(f: FalhaDeLeitura): string {
  return f.codigoDaMeta !== null ? `${f.problema}:${f.codigoDaMeta}` : f.problema;
}

export async function executarSincronizacaoDeGastoMeta(
  admin: SupabaseClient,
  job: Job,
  workerId: string,
  deps: {
    fetchFn?: typeof fetch;
    agora?: () => number;
    dormir?: (ms: number) => Promise<void>;
  } = {},
): Promise<ResultadoDeJob> {
  const agora = deps.agora ?? Date.now;
  const inicio = agora();

  const [conta, segredo, leitura] = await Promise.all([
    admin
      .from("meta_ads_account")
      .select("ad_account_id")
      .eq("clinic_id", job.clinic_id)
      .maybeSingle(),
    admin
      .from("meta_ads_account_secret")
      .select("insights_access_token")
      .eq("clinic_id", job.clinic_id)
      .maybeSingle(),
    admin
      .from("meta_gasto_leitura")
      .select("ad_account_id, lido_desde, lido_ate, fuso_da_conta")
      .eq("clinic_id", job.clinic_id)
      .maybeSingle(),
  ]);
  const erroDeLeitura = conta.error ?? segredo.error ?? leitura.error;
  if (erroDeLeitura) {
    // Leitura que falhou NUNCA vira "sem configuracao": e retry.
    return {
      ok: false,
      erro: `config_ilegivel:${codigoDoErro(erroDeLeitura)}`,
    };
  }

  const contaSalva =
    typeof conta.data?.ad_account_id === "string"
      ? conta.data.ad_account_id
      : null;
  const token =
    typeof segredo.data?.insights_access_token === "string"
      ? segredo.data.insights_access_token
      : null;
  if (!contaSalva || !token) {
    // A configuracao foi removida depois de enfileirar: nada a ler.
    log.info("gasto_meta_sem_configuracao", {
      clinic_id: job.clinic_id,
      job_id: job.id,
    });
    return { ok: true };
  }
  const adAccountId = normalizarContaDeAnuncios(contaSalva);
  if (adAccountId !== contaSalva) {
    // O CHECK ad_account_id_formato impede isto. Sem ele, a regravacao
    // acusaria config_mudou para sempre (a conta salva nunca bateria).
    return { ok: false, erro: "conta_fora_do_formato", definitivo: true };
  }

  const tokenSha256 = sha256DoToken(token);
  const dias = diasDaLeitura(
    (leitura.data as LeituraAnterior | null) ?? null,
    adAccountId,
    inicio,
  );

  const lido = await lerGastoParaSincronizar(
    {
      adAccountId,
      accessToken: token,
      prazoEm: inicio + PRAZO_DA_LEITURA_MS,
      fetchFn: deps.fetchFn,
      agora,
      dormir: deps.dormir,
    },
    { dias, agoraMs: inicio },
  );

  const reagendarJa = (): ResultadoDeJob => ({
    reagendar: new Date(agora()).toISOString(),
    motivo: "config_mudou",
  });

  if (!lido.ok) {
    const erro = codigoDaFalha(lido);
    log.warn("gasto_meta_leitura_falhou", {
      clinic_id: job.clinic_id,
      job_id: job.id,
      error_code: erro,
      http_status: lido.http,
      attempt: job.attempts,
      duration_ms: agora() - inicio,
    });

    const registrar = async (definitivo: boolean): Promise<ResultadoDeJob> => {
      const { data, error } = await admin.rpc("registrar_falha_do_gasto_meta", {
        p_job_id: job.id,
        p_worker: workerId,
        p_clinic_id: job.clinic_id,
        p_ad_account_id: adAccountId,
        p_token_sha256: tokenSha256,
        p_problema: lido.problema,
        p_codigo: lido.codigoDaMeta,
      });
      if (error) {
        return {
          ok: false,
          erro: `registrar_falha_falhou:${codigoDoErro(error)}`,
        };
      }
      if (data === "config_mudou") {
        // A gestao trocou a conta ou o token durante a leitura: o problema
        // era da configuracao velha. Le de novo ja, com a nova.
        return reagendarJa();
      }
      if (data === "sem_posse") {
        return { ok: false, erro: "sem_posse" };
      }
      return { ok: false, erro, definitivo };
    };

    switch (lido.acao) {
      case "reagendar":
        // Limite da Meta: nunca repetir agora ("pare de fazer chamadas").
        // reagendar_job nao queima tentativa; o teto de 20 devolucoes vale.
        return {
          reagendar: new Date(
            agora() +
              limitar(
                lido.tentarEmMs ?? ESPERA_DO_LIMITE_PADRAO_MS,
                ESPERA_MINIMA_DO_LIMITE_MS,
                ESPERA_MAXIMA_DO_LIMITE_MS,
              ),
          ).toISOString(),
          motivo: "limite_da_meta",
        };
      case "pausar":
      case "desistir":
        return registrar(true);
      case "repetir":
        // attempts ja vem incrementado pelo claim: na ULTIMA tentativa o
        // problema fica gravado para a tela; antes, so o backoff.
        if (job.attempts >= job.max_attempts) {
          return registrar(true);
        }
        return { ok: false, erro };
    }
  }

  // Deduplicacao defensiva: (dia, anuncio) e dia repetidos dariam 23505 na
  // regravacao e travariam o job para sempre. A ultima linha vence.
  const porAnuncio = new Map(
    lido.porAnuncio.map((l) => [`${l.dia}|${l.adId}`, l] as const),
  );
  const daConta = new Map(lido.daConta.map((l) => [l.dia, l] as const));

  const { data: desfecho, error: erroDaGravacao } = await admin.rpc(
    "regravar_gasto_meta",
    {
      p_job_id: job.id,
      p_worker: workerId,
      p_clinic_id: job.clinic_id,
      p_ad_account_id: adAccountId,
      p_token_sha256: tokenSha256,
      p_desde: lido.periodo.de,
      p_ate: lido.periodo.ate,
      p_moeda: lido.conta.moeda,
      p_fuso: lido.conta.fuso,
      // O tipo gerado exige texto; vazio vira null no banco.
      p_nome_da_conta: lido.conta.nome ?? "",
      p_conta_ativa: lido.conta.ativa,
      p_por_anuncio: [...porAnuncio.values()].map((l) => ({
        dia: l.dia,
        ad_id: l.adId,
        adset_id: l.adsetId,
        campaign_id: l.campaignId,
        campaign_name: l.campaignName,
        spend_cents: l.spendCents,
      })),
      p_da_conta: [...daConta.values()].map((l) => ({
        dia: l.dia,
        spend_cents: l.spendCents,
      })),
    },
  );
  if (erroDaGravacao) {
    // O job e idempotente: o backoff repete a leitura e a gravacao.
    return {
      ok: false,
      erro: `gravar_gasto_falhou:${codigoDoErro(erroDaGravacao)}`,
    };
  }
  switch (desfecho) {
    case "ok":
      log.info("gasto_meta_sincronizado", {
        clinic_id: job.clinic_id,
        job_id: job.id,
        count: porAnuncio.size,
        duration_ms: agora() - inicio,
      });
      return { ok: true };
    case "config_mudou":
      return reagendarJa();
    case "sem_posse":
      return { ok: false, erro: "sem_posse" };
    case "janela_invalida":
      // Defeito nosso (a janela sai de janelaNoFusoDaConta): repetir nao
      // conserta.
      return { ok: false, erro: "janela_invalida", definitivo: true };
    default:
      return { ok: false, erro: "regravar_desfecho_desconhecido" };
  }
}
