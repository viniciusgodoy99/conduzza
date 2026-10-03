"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  avisosDaConta,
  TEXTOS_DA_LEITURA,
  TOKEN_DE_LEITURA_VALIDO,
  type AvisoDaLeitura,
} from "@/components/configuracoes/investimento-meta";
import { getSessionContext } from "@/lib/auth/active-clinic";
import {
  normalizarContaDeAnuncios,
  textoDoProblemaDeLeitura,
  type AdAccountId,
  type ProblemaDeLeitura,
} from "@/lib/domain/meta-anuncios";
import { canEdit } from "@/lib/domain/permissions";
import { testarLeituraDeAnuncios } from "@/lib/integrations/meta/insights";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Leitura do investimento da Meta (Fase 4, critica 4.4): salvar, testar e
// remover o token de leitura de anuncios.
//
// O TOKEN E WRITE-ONLY. Ele vive em meta_ads_account_secret.
// insights_access_token, que a sessao nem alcanca (revoke all de anon e
// authenticated, migration 20261003100000). So o cliente de servico le e
// escreve, DEPOIS da guarda de papel abaixo, e nenhum retorno daqui carrega
// o valor: nem o resultado, nem a auditoria, nem o log.
//
// A situacao da leitura (meta_gasto_leitura) tambem e escrita so pelo
// sistema. Daqui saem apenas: situacao, problema, codigo_da_meta,
// nome_da_conta, moeda, fuso_da_conta, conta_ativa e testada_em. NUNCA
// ad_account_id, lido_*, sincronizado_em, tentado_em, ultimo_diario_dia nem
// atualizacao_pedida_em: sao do job e das funcoes do banco.
//
// Guarda local (e nao a de actions.ts): toda funcao exportada de um arquivo
// "use server" vira endpoint, entao cada uma confere o papel por si.

export type ResultadoDoTesteDeLeitura =
  | {
      ok: true;
      conta: {
        nome: string | null;
        adAccountId: string;
        moeda: string;
        fuso: string;
        ativa: boolean;
      };
      temGasto: boolean;
      avisos: AvisoDaLeitura[];
      /** A primeira leitura (ou a releitura) do investimento entrou na fila. */
      leituraPedida: boolean;
    }
  | {
      ok: false;
      error: string;
      /** So no salvar: o token ficou gravado mesmo com o teste falhando. */
      tokenSalvo?: boolean;
      /** O problema da Meta, quando o teste chegou a falar com ela. */
      problema?: ProblemaDeLeitura;
    };

type Guarda = { userId: string; clinicId: string; timezone: string };

async function requireGestorOuAdmin(): Promise<Guarda | { error: string }> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: TEXTOS_DA_LEITURA.sessaoExpirada };
  }
  if (!canEdit(context.active.role, "configuracoes")) {
    return { error: TEXTOS_DA_LEITURA.semPermissao };
  }
  return {
    userId: context.userId,
    clinicId: context.active.clinicId,
    timezone: context.active.timezone,
  };
}

async function auditar(guard: Guarda, action: string, entity: string) {
  // Sem o valor do token, sem a conta: so quem, o que e de qual clinica.
  const supabase = await createClient();
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.userId,
    action,
    entity,
    entity_id: guard.clinicId,
  });
}

function revalidar() {
  revalidatePath("/configuracoes");
  revalidatePath("/relatorios");
}

const tokenSchema = z.object({
  insights_access_token: z.string().trim().regex(TOKEN_DE_LEITURA_VALIDO),
});

type Configuracao =
  | { ok: true; adAccountId: AdAccountId | null; token: string | null }
  | { ok: false };

/**
 * A conta pela SESSAO (a policy de meta_ads_account e da gestao) e o token
 * pelo cliente de servico (a sessao nao alcanca o segredo). O token so fica
 * na memoria do servidor durante o teste.
 */
async function lerConfiguracao(clinicId: string): Promise<Configuracao> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const [conta, segredo] = await Promise.all([
    supabase
      .from("meta_ads_account")
      .select("ad_account_id")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    admin
      .from("meta_ads_account_secret")
      .select("insights_access_token")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
  ]);
  if (conta.error || segredo.error) {
    return { ok: false };
  }
  const bruta = (conta.data as { ad_account_id: string | null } | null)
    ?.ad_account_id;
  const token = (segredo.data as { insights_access_token: string | null } | null)
    ?.insights_access_token;
  return {
    ok: true,
    adAccountId: bruta ? normalizarContaDeAnuncios(bruta) : null,
    token: token ?? null,
  };
}

/**
 * Testa a leitura com a conta e o token salvos (os que o job vai usar),
 * grava a situacao e, quando deu certo, pede a leitura do investimento.
 */
async function testarEGravar(
  guard: Guarda,
  adAccountId: AdAccountId,
  token: string,
  extra: { tokenSalvo?: boolean } = {},
): Promise<ResultadoDoTesteDeLeitura> {
  let resultado: Awaited<ReturnType<typeof testarLeituraDeAnuncios>>;
  try {
    resultado = await testarLeituraDeAnuncios({
      adAccountId,
      accessToken: token,
      // Pior caso perto de 15 s, dentro do maxDuration 30 da pagina.
      prazoEm: Date.now() + 15_000,
      timeoutMs: 6_000,
      maxRetries: 1,
    });
  } catch {
    return { ok: false, error: TEXTOS_DA_LEITURA.testeFalhou, ...extra };
  }

  // A conta ou o token mudou enquanto a Meta respondia (outra aba, outra
  // pessoa da gestao): o resultado nao vale para a configuracao de agora.
  const depois = await lerConfiguracao(guard.clinicId);
  if (!depois.ok) {
    return { ok: false, error: TEXTOS_DA_LEITURA.configuracaoIlegivel, ...extra };
  }
  if (depois.adAccountId !== adAccountId || depois.token !== token) {
    return { ok: false, error: TEXTOS_DA_LEITURA.mudouDuranteOTeste, ...extra };
  }

  const admin = createAdminClient();
  const agora = new Date().toISOString();

  if (!resultado.ok) {
    const { error } = await admin.from("meta_gasto_leitura").upsert(
      {
        clinic_id: guard.clinicId,
        situacao: "com_problema",
        problema: resultado.problema,
        codigo_da_meta: resultado.codigoDaMeta,
        testada_em: agora,
      },
      { onConflict: "clinic_id" },
    );
    if (error) {
      log.warn("leitura_meta_situacao_nao_gravada", {
        clinic_id: guard.clinicId,
        error_code: error.code,
      });
    }
    return {
      ok: false,
      error: textoDoProblemaDeLeitura(resultado.problema, {
        adAccountId,
        codigo: resultado.codigoDaMeta,
      }),
      problema: resultado.problema,
      ...extra,
    };
  }

  const { conta } = resultado;
  const { error: erroDaSituacao } = await admin
    .from("meta_gasto_leitura")
    .upsert(
      {
        clinic_id: guard.clinicId,
        situacao: "funcionando",
        problema: null,
        codigo_da_meta: null,
        nome_da_conta: conta.nome,
        moeda: conta.moeda,
        fuso_da_conta: conta.fuso,
        conta_ativa: conta.ativa,
        testada_em: agora,
      },
      { onConflict: "clinic_id" },
    );
  if (erroDaSituacao) {
    log.warn("leitura_meta_situacao_nao_gravada", {
      clinic_id: guard.clinicId,
      error_code: erroDaSituacao.code,
    });
    return { ok: false, error: TEXTOS_DA_LEITURA.resultadoNaoGuardado, ...extra };
  }

  // A primeira leitura (ou a releitura com a configuracao nova). A origem
  // 'configuracao' passa pela pausa; a funcao recusa clinica de teste e
  // deduplica com o job que ja estiver na fila.
  const { data: fila, error: erroDaFila } = await admin.rpc(
    "enfileirar_sincronizacao_de_gasto_meta",
    { p_clinic_id: guard.clinicId, p_origem: "configuracao" },
  );
  const codigo = (fila as { codigo?: unknown } | null)?.codigo;
  if (erroDaFila) {
    log.warn("leitura_meta_fila_falhou", {
      clinic_id: guard.clinicId,
      error_code: erroDaFila.code,
    });
  }

  return {
    ok: true,
    conta: {
      nome: conta.nome,
      adAccountId,
      moeda: conta.moeda,
      fuso: conta.fuso,
      ativa: conta.ativa,
    },
    temGasto: resultado.temGastoEm30Dias,
    avisos: avisosDaConta(
      { moeda: conta.moeda, fuso: conta.fuso, ativa: conta.ativa },
      guard.timezone,
      Date.now(),
    ),
    leituraPedida: codigo === "enfileirado" || codigo === "ja_na_fila",
  };
}

/**
 * "Salvar token": grava o token e testa em seguida. Salva mesmo se o teste
 * falhar (a Meta pode estar fora do ar); a tela mostra o problema.
 */
export async function salvarTokenDeLeituraMetaAction(
  entrada: unknown,
): Promise<ResultadoDoTesteDeLeitura> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error, tokenSalvo: false };
  }
  const parsed = tokenSchema.safeParse(entrada);
  if (!parsed.success) {
    return {
      ok: false,
      error: TEXTOS_DA_LEITURA.tokenInvalido,
      tokenSalvo: false,
    };
  }
  const token = parsed.data.insights_access_token;

  // O upsert so altera as colunas enviadas: o token da CAPI fica.
  const admin = createAdminClient();
  const { error } = await admin
    .from("meta_ads_account_secret")
    .upsert(
      { clinic_id: guard.clinicId, insights_access_token: token },
      { onConflict: "clinic_id" },
    );
  if (error) {
    log.warn("leitura_meta_token_nao_salvo", {
      clinic_id: guard.clinicId,
      error_code: error.code,
    });
    return {
      ok: false,
      error: TEXTOS_DA_LEITURA.tokenNaoSalvo,
      tokenSalvo: false,
    };
  }

  // Token novo tira a pausa (C13): a leitura volta a "nao testada" ate o
  // teste abaixo dizer como esta.
  const { error: erroDaSituacao } = await admin
    .from("meta_gasto_leitura")
    .upsert(
      {
        clinic_id: guard.clinicId,
        situacao: "nao_testada",
        problema: null,
        codigo_da_meta: null,
      },
      { onConflict: "clinic_id" },
    );
  if (erroDaSituacao) {
    log.warn("leitura_meta_situacao_nao_gravada", {
      clinic_id: guard.clinicId,
      error_code: erroDaSituacao.code,
    });
  }

  await auditar(guard, "atualizou_token_leitura_meta", "meta_ads_account_secret");

  const configuracao = await lerConfiguracao(guard.clinicId);
  if (!configuracao.ok) {
    revalidar();
    return {
      ok: false,
      error: TEXTOS_DA_LEITURA.configuracaoIlegivel,
      tokenSalvo: true,
    };
  }
  if (!configuracao.adAccountId) {
    revalidar();
    return {
      ok: false,
      error: TEXTOS_DA_LEITURA.tokenSalvoSemConta,
      tokenSalvo: true,
    };
  }

  const resultado = await testarEGravar(guard, configuracao.adAccountId, token, {
    tokenSalvo: true,
  });
  await auditar(guard, "testou_leitura_meta", "meta_gasto_leitura");
  revalidar();
  return resultado;
}

/** "Testar leitura": a conta e o token SALVOS, que sao os que o job usa. */
export async function testarLeituraMetaAction(): Promise<ResultadoDoTesteDeLeitura> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const configuracao = await lerConfiguracao(guard.clinicId);
  if (!configuracao.ok) {
    return { ok: false, error: TEXTOS_DA_LEITURA.configuracaoIlegivel };
  }
  if (!configuracao.adAccountId || !configuracao.token) {
    return { ok: false, error: TEXTOS_DA_LEITURA.semConfiguracao };
  }

  const resultado = await testarEGravar(
    guard,
    configuracao.adAccountId,
    configuracao.token,
  );
  await auditar(guard, "testou_leitura_meta", "meta_gasto_leitura");
  revalidar();
  return resultado;
}

/**
 * "Remover token": zera so a coluna do token de leitura (o da CAPI fica). O
 * investimento ja lido continua guardado; sem token, o diario e o "Atualizar
 * agora" param (a funcao do banco devolve sem_configuracao) e o job que
 * estiver na fila termina sem ler.
 */
export async function removerTokenDeLeituraMetaAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("meta_ads_account_secret")
    .update({ insights_access_token: null })
    .eq("clinic_id", guard.clinicId);
  if (error) {
    log.warn("leitura_meta_token_nao_removido", {
      clinic_id: guard.clinicId,
      error_code: error.code,
    });
    return { ok: false, error: TEXTOS_DA_LEITURA.tokenNaoRemovido };
  }
  await auditar(guard, "removeu_token_leitura_meta", "meta_ads_account_secret");
  revalidar();
  return { ok: true };
}
