import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizarContaDeAnuncios,
  PROBLEMAS_QUE_PAUSAM,
  type ProblemaDeLeitura,
} from "@/lib/domain/meta-anuncios";
import {
  ESPERA_DO_LIMITE_PADRAO_MS,
  paraGravarResolucao,
  RESOLVER_MAX_ANUNCIOS,
  RESOLVER_PRAZO_MS,
  resolverAnuncios,
  type FalhaDeLeitura,
} from "@/lib/integrations/meta/insights";
import { codigoDoErro } from "@/lib/jobs/erro-de-job";
import {
  ESPERA_MAXIMA_DO_LIMITE_MS,
  ESPERA_MINIMA_DO_LIMITE_MS,
  sha256DoToken,
} from "@/lib/jobs/gasto-meta";
import type { Job, ResultadoDeJob } from "@/lib/jobs/worker";
import { log } from "@/lib/log";

// Job resolver_anuncio_meta (origem real do lead de anuncio, 04/10/2026):
// pergunta a Meta, pelo id do anuncio que chegou no clique, de qual campanha
// e de qual conjunto ele e, e grava em meta_anuncio (origem 'consulta'). E a
// fonte unica do nome da campanha do lead de anuncio: o contato guarda so o
// source_ad_id, nunca o nome (D3 do dono).
//
// Fluxo de uma execucao:
//   1. le a conta e o token como o sincronizar_gasto_meta (cliente de
//      servico); sem configuracao, conclui; leitura pausada, conclui sem
//      chamar a Meta;
//   2. anuncios_meta_a_resolver (ate RESOLVER_MAX_ANUNCIOS, 20, devidos
//      agora);
//   3. resolverAnuncios na Meta (RESOLVER_PRAZO_MS, 15 s, e 8 s por
//      requisicao, tetos da propria integracao);
//   4. gravar_resolucao_de_anuncios_meta com o sha256 do token: a funcao
//      recusa (config_mudou) a escrita de quem leu com a conta ou o token que
//      a gestao acabou de trocar, e calcula as novas tentativas de cada
//      recusa (sem_entrega_ainda 1 h, 6 h, 24 h e depois diaria ate 7 dias;
//      resposta_invalida 24 h; inacessivel e outra_conta so com outra conta
//      ou outro token);
//   5. pergunta de novo o que ficou devido: ainda ha anuncio devido, volta
//      agora; ha nova tentativa marcada, volta nessa hora; senao, conclui.
//
// A volta e por reagendar_job, que nao queima tentativa mas conta no teto de
// 20 devolucoes. Passado o teto o job falha, e o proximo pedido (ingestao,
// fim do gasto ou teste de leitura) cria outro: nada se perde, porque o que
// esta pendente vive no banco (contato sem linha consultada no mapa), nao no
// job.
//
// SEGREDO: o token fica aqui e na chamada a Meta (cabecalho Authorization,
// dentro da integracao). No banco vai so o sha256. Log e last_error levam so
// codigos e contagens: nem token, nem id ou nome de anuncio, nem mensagem da
// Meta.

/** O resolver da integracao; injetavel nos testes. */
export type ResolverAnuncios = typeof resolverAnuncios;

export type DependenciasDaResolucao = {
  resolver?: ResolverAnuncios;
  fetchFn?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
};

const AD_ID = /^[0-9]{1,32}$/;

function eObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

type ListaDeAnuncios =
  | { codigo: "config_mudou" }
  | {
      codigo: "ok";
      adIds: string[];
      restantes: number;
      /** Exatamente como o banco devolveu (sem perder os microssegundos). */
      proximaTentativaEm: string | null;
    };

/**
 * Le o retorno de anuncios_meta_a_resolver. Fora do contrato devolve null:
 * e defeito nosso, e repetir nao conserta.
 */
export function lerListaDeAnuncios(data: unknown): ListaDeAnuncios | null {
  if (!eObjeto(data)) {
    return null;
  }
  if (data.codigo === "config_mudou") {
    return { codigo: "config_mudou" };
  }
  if (data.codigo !== "ok") {
    return null;
  }
  const ids = data.ad_ids;
  if (
    !Array.isArray(ids) ||
    !ids.every((id): id is string => typeof id === "string" && AD_ID.test(id))
  ) {
    return null;
  }
  const restantes = data.restantes;
  if (
    typeof restantes !== "number" ||
    !Number.isInteger(restantes) ||
    restantes < 0
  ) {
    return null;
  }
  const proxima = data.proxima_tentativa_em;
  if (proxima === null || proxima === undefined) {
    return { codigo: "ok", adIds: ids, restantes, proximaTentativaEm: null };
  }
  if (typeof proxima !== "string" || Number.isNaN(Date.parse(proxima))) {
    return null;
  }
  return { codigo: "ok", adIds: ids, restantes, proximaTentativaEm: proxima };
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor));
}

/** Codigo curto para last_error e log: o problema e o numero da Meta. */
function codigoDaFalha(f: FalhaDeLeitura): string {
  return f.codigoDaMeta !== null ? `${f.problema}:${f.codigoDaMeta}` : f.problema;
}

function lerPausa(situacao: unknown, problema: unknown): boolean {
  return (
    situacao === "com_problema" &&
    typeof problema === "string" &&
    PROBLEMAS_QUE_PAUSAM.has(problema as ProblemaDeLeitura)
  );
}

export async function executarResolucaoDeAnunciosMeta(
  admin: SupabaseClient,
  job: Job,
  workerId: string,
  deps: DependenciasDaResolucao = {},
): Promise<ResultadoDeJob> {
  const agora = deps.agora ?? Date.now;
  const resolver: ResolverAnuncios = deps.resolver ?? resolverAnuncios;
  const inicio = agora();

  // 1. Configuracao, como o gasto (o token so pelo cliente de servico).
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
      .select("situacao, problema")
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
    // A configuracao foi removida depois de enfileirar: nada a consultar.
    log.info("resolver_anuncio_meta_sem_configuracao", {
      clinic_id: job.clinic_id,
      job_id: job.id,
    });
    return { ok: true };
  }
  const adAccountId = normalizarContaDeAnuncios(contaSalva);
  if (adAccountId === null || adAccountId !== contaSalva) {
    // O CHECK ad_account_id_formato impede isto. Sem ele, a gravacao
    // acusaria config_mudou para sempre (a conta salva nunca bateria).
    return { ok: false, erro: "conta_fora_do_formato", definitivo: true };
  }
  if (lerPausa(leitura.data?.situacao, leitura.data?.problema)) {
    // Token, permissao ou conta recusados: a Meta recusaria de novo, e cada
    // erro gasta a cota da conta. Volta quando o teste der certo, um token
    // novo for salvo ou a conta mudar (o pedido desses caminhos cria outro).
    log.info("resolver_anuncio_meta_pausado", {
      clinic_id: job.clinic_id,
      job_id: job.id,
    });
    return { ok: true };
  }

  const tokenSha256 = sha256DoToken(token);
  const reagendarJa = (motivo: string): ResultadoDeJob => ({
    reagendar: new Date(agora()).toISOString(),
    motivo,
  });

  const listar = async (
    limite: number,
  ): Promise<{ lista: ListaDeAnuncios } | { falha: ResultadoDeJob }> => {
    const { data, error } = await admin.rpc("anuncios_meta_a_resolver", {
      p_clinic_id: job.clinic_id,
      p_ad_account_id: adAccountId,
      p_token_sha256: tokenSha256,
      p_limite: limite,
    });
    if (error) {
      return {
        falha: { ok: false, erro: `listar_anuncios_falhou:${codigoDoErro(error)}` },
      };
    }
    const lista = lerListaDeAnuncios(data);
    if (!lista) {
      return { falha: { ok: false, erro: "lista_invalida", definitivo: true } };
    }
    return { lista };
  };

  // 2. O que esta devido agora.
  const antes = await listar(RESOLVER_MAX_ANUNCIOS);
  if ("falha" in antes) {
    return antes.falha;
  }
  if (antes.lista.codigo === "config_mudou") {
    // A gestao trocou a conta ou o token depois da leitura acima: de novo,
    // ja, com a configuracao nova.
    return reagendarJa("config_mudou");
  }
  const pedidos = antes.lista.adIds;
  if (pedidos.length === 0) {
    if (antes.lista.proximaTentativaEm) {
      return {
        reagendar: antes.lista.proximaTentativaEm,
        motivo: "nova_tentativa",
      };
    }
    return { ok: true };
  }

  // 3. A Meta. O prazo conta do comeco do job; a integracao ainda limita a
  // 15 s do comeco dela e a 8 s por requisicao.
  const lido = await resolver(
    {
      adAccountId,
      accessToken: token,
      prazoEm: inicio + RESOLVER_PRAZO_MS,
      fetchFn: deps.fetchFn,
      agora,
      dormir: deps.dormir,
    },
    pedidos,
  );

  if (!lido.ok) {
    const erro = codigoDaFalha(lido);
    log.warn("resolver_anuncio_meta_falhou", {
      clinic_id: job.clinic_id,
      job_id: job.id,
      error_code: erro,
      http_status: lido.http,
      attempt: job.attempts,
      duration_ms: agora() - inicio,
    });

    switch (lido.acao) {
      case "reagendar":
        // Limite da Meta: nunca repetir agora ("pare de fazer chamadas").
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
      case "pausar": {
        // Token, permissao ou conta: a mesma pausa da leitura do gasto, pela
        // mesma funcao (que aceita a posse do job do resolvedor).
        const { data, error } = await admin.rpc(
          "registrar_falha_do_gasto_meta",
          {
            p_job_id: job.id,
            p_worker: workerId,
            p_clinic_id: job.clinic_id,
            p_ad_account_id: adAccountId,
            p_token_sha256: tokenSha256,
            p_problema: lido.problema,
            p_codigo: lido.codigoDaMeta,
          },
        );
        if (error) {
          return {
            ok: false,
            erro: `registrar_falha_falhou:${codigoDoErro(error)}`,
          };
        }
        if (data === "config_mudou") {
          // O problema era da configuracao velha: de novo, ja, com a nova.
          return reagendarJa("config_mudou");
        }
        if (data === "sem_posse") {
          return { ok: false, erro: "sem_posse" };
        }
        return { ok: false, erro, definitivo: true };
      }
      case "desistir":
        // Pedido recusado (versao, parametro, outro): repetir nao conserta.
        // Fica so no last_error. A situacao na tela (meta_gasto_leitura) e
        // da leitura do investimento, que esbarra no mesmo problema e grava
        // o dela; so a pausa (token, permissao, conta) e gravada daqui.
        return { ok: false, erro, definitivo: true };
      case "repetir":
        // Passageiro: o backoff do job tenta de novo, ate max_attempts.
        return { ok: false, erro };
    }
  }

  // 4. Gravacao, no formato da funcao do banco (mapeamento da integracao:
  // snake_case, codigo fora do inteiro gravavel vira null).
  const { p_resolvidos: resolvidos, p_recusas: recusas } =
    paraGravarResolucao(lido);
  if (resolvidos.length === 0 && recusas.length === 0) {
    // Nada terminou. A integracao ja devolve prazo_esgotado nesse caso; a
    // guarda fica porque voltar "agora" sem ter consultado nada seria um
    // laco gastando o teto de devolucoes: segue o backoff.
    return { ok: false, erro: "prazo_esgotado" };
  }

  const { data: desfecho, error: erroDaGravacao } = await admin.rpc(
    "gravar_resolucao_de_anuncios_meta",
    {
      p_job_id: job.id,
      p_worker: workerId,
      p_clinic_id: job.clinic_id,
      p_ad_account_id: adAccountId,
      p_token_sha256: tokenSha256,
      p_resolvidos: resolvidos,
      p_recusas: recusas,
    },
  );
  if (erroDaGravacao) {
    const codigo = codigoDoErro(erroDaGravacao);
    // 22023 e formato recusado pela funcao: defeito nosso, repetir nao
    // conserta. O resto (rede, tempo) e passageiro: consultar de novo e
    // seguro.
    return {
      ok: false,
      erro: `gravar_resolucao_falhou:${codigo}`,
      ...(codigo === "22023" ? { definitivo: true } : {}),
    };
  }
  switch (desfecho) {
    case "ok":
      break;
    case "config_mudou":
      // Nada foi gravado: de novo, ja, com a configuracao nova.
      return reagendarJa("config_mudou");
    case "sem_posse":
      return { ok: false, erro: "sem_posse" };
    default:
      return { ok: false, erro: "gravar_desfecho_desconhecido" };
  }

  log.info("resolver_anuncio_meta_gravado", {
    clinic_id: job.clinic_id,
    job_id: job.id,
    count: resolvidos.length,
    duration_ms: agora() - inicio,
  });
  if (recusas.length > 0) {
    log.info("resolver_anuncio_meta_recusados", {
      clinic_id: job.clinic_id,
      job_id: job.id,
      count: recusas.length,
    });
  }

  // 5. O que sobrou: a lista de novo, depois da gravacao (as recusas que
  // acabaram de entrar ja trazem a nova tentativa delas).
  const depois = await listar(1);
  if ("falha" in depois) {
    // A gravacao ficou; repetir so consulta o que ainda estiver pendente.
    return depois.falha;
  }
  if (depois.lista.codigo === "config_mudou") {
    return reagendarJa("config_mudou");
  }
  if (depois.lista.adIds.length > 0) {
    return reagendarJa("mais_anuncios");
  }
  if (depois.lista.proximaTentativaEm) {
    return {
      reagendar: depois.lista.proximaTentativaEm,
      motivo: "nova_tentativa",
    };
  }
  return { ok: true };
}
