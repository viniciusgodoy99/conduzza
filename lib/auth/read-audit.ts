import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

// Trilha de LEITURA de dado de paciente (regra 3.1 do CLAUDE.md: toda leitura
// de dado de paciente por usuario humano vai para audit_log). Duas
// granularidades: por ABERTURA DE TELA (agenda do dia, inbox, lista de leads),
// sem id, e por ABERTURA DE FICHA, com o id do contato lido. Nunca grava
// conteudo, so o que a LGPD pede: quem, quando, que superficie, de quem.
//
// O throttle (5 min) dedupica por usuario + entidade + ID: sem o id na chave,
// abrir trinta fichas seguidas gravaria uma linha so e a trilha nao diria de
// quem foi a leitura. Tela de lista nao tem id e segue deduplicada so por
// entidade, como antes.
//
// Na carga de pagina nao bloqueia a renderizacao (chamada sem await); na
// abertura de ficha e aguardada, para a linha existir antes de o dado sair do
// servidor. Um erro de auditoria nunca derruba a tela.
//
// Dois clientes de proposito, e a divisao importa:
// LEITURA de deduplicacao com SERVICE ROLE, porque a unica policy de select de
// audit_log e "admin e gestor leem a trilha". Com o cliente de sessao, recepcao,
// profissional e leitura recebiam zero linha SEM erro, o throttle nunca
// dedupicava e cada carga de tela gravava linha nova: a trilha inundava
// justamente para quem mais usa o sistema.
// ESCRITA com o cliente de SESSAO, porque a policy de insert exige
// user_id = auth.uid(). E isso que impede alguem de forjar trilha alheia, e
// service role no insert jogaria essa garantia fora.

const JANELA_MS = 5 * 60_000;

// Dedupe em MEMORIA na frente do SELECT: o deploy e um servidor Node
// persistente, entao o caso comum (a mesma pessoa reabrindo a mesma tela
// dentro da janela) resolve sem nenhuma ida ao banco, que e remoto e paga
// latencia em toda navegacao. O SELECT continua existindo para o primeiro
// acesso apos reinicio ou vindo de outro processo: linha repetida na trilha e
// ruido, linha ausente e furo de LGPD, e o mapa sozinho nao sobrevive a
// reinicio.
const vistoEmMemoria = new Map<string, number>();
const MAPA_MAX = 10_000;

function chaveDeDedupe(params: Params, entityId: string | null): string {
  return `${params.clinicId}|${params.userId}|${params.entity}|${entityId ?? ""}`;
}

type Params = {
  clinicId: string;
  userId: string;
  entity:
    | "agenda_dia"
    | "inbox"
    | "historico_agenda"
    | "leads"
    | "pacientes"
    | "ficha_paciente"
    | "confirmacoes"
    | "lista_espera"
    // Abertura de ARQUIVO de paciente (foto, audio, documento). Diferente das
    // demais: a trilha desta e BLOQUEANTE, ver auditarAberturaDeMidia.
    | "midia_conversa";
  entityId?: string | null;
};

let leitorDaTrilha: SupabaseClient | null = null;

function clienteDeDeduplicacao(): SupabaseClient {
  leitorDaTrilha ??= createAdminClient();
  return leitorDaTrilha;
}

// Na duvida devolve false e a linha e gravada: linha repetida na trilha e
// ruido, linha ausente e furo de LGPD.
async function jaRegistradoNaJanela(
  params: Params,
  entityId: string | null,
): Promise<boolean> {
  try {
    const desde = new Date(Date.now() - JANELA_MS).toISOString();
    let consulta = clienteDeDeduplicacao()
      .from("audit_log")
      .select("id")
      .eq("clinic_id", params.clinicId)
      .eq("user_id", params.userId)
      .eq("action", "leu")
      .eq("entity", params.entity)
      .gte("created_at", desde);
    // Com id, a janela e por ficha: a segunda ficha aberta no mesmo minuto
    // tem a propria linha. Sem id (telas de lista) fica como sempre foi.
    if (entityId !== null) {
      consulta = consulta.eq("entity_id", entityId);
    }
    const { data, error } = await consulta.limit(1);
    if (error) {
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function auditarLeituraDePaciente(
  supabase: SupabaseClient,
  params: Params,
): Promise<void> {
  try {
    // Nao repete a leitura do MESMO alvo pelo MESMO usuario dentro da janela:
    // a recepcao que troca de dia o tempo todo nao gera uma linha por clique.
    const entityId = params.entityId ?? null;
    const chave = chaveDeDedupe(params, entityId);
    const agora = Date.now();
    const visto = vistoEmMemoria.get(chave);
    if (visto !== undefined && agora - visto < JANELA_MS) {
      return;
    }
    // Acerto do SELECT NAO alimenta o mapa: a linha encontrada pode ser do
    // comeco da janela (gravada antes de um reinicio), e carimbar "agora"
    // esticaria a janela para quase o dobro, engolindo uma leitura que o
    // contrato (uma linha por 5 minutos) mandava registrar. O mapa so
    // aprende quando ESTE processo insere e sabe a hora exata da linha.
    if (await jaRegistradoNaJanela(params, entityId)) {
      return;
    }
    const { error } = await supabase.from("audit_log").insert({
      clinic_id: params.clinicId,
      user_id: params.userId,
      action: "leu",
      entity: params.entity,
      entity_id: entityId,
    });
    if (!error) {
      if (vistoEmMemoria.size >= MAPA_MAX) {
        // Poda simples quando o mapa cresce: solta as entradas vencidas.
        for (const [k, v] of vistoEmMemoria) {
          if (agora - v >= JANELA_MS) {
            vistoEmMemoria.delete(k);
          }
        }
      }
      vistoEmMemoria.set(chave, agora);
    }
  } catch {
    // Auditoria nunca derruba a tela; o proprio audit_log e best-effort aqui.
  }
}

/**
 * Trilha de abertura de ARQUIVO de paciente, BLOQUEANTE.
 *
 * Diferente de `auditarLeituraDePaciente`, que engole a falha porque auditoria
 * nunca deve derrubar uma tela: aqui a falha IMPEDE a entrega do arquivo.
 *
 * O motivo e a natureza do que sai. As telas mostram texto que a RLS ja
 * autorizou e que a trilha registra em granularidade de tela. Um arquivo e
 * outra coisa: e a foto do exame, o audio do paciente, o documento que ele
 * mandou. Entregar isso sem saber quem abriu e pior do que dizer "tente de
 * novo". Dado de saude sem trilha e o cenario que a regra 3.1 existe para
 * impedir.
 *
 * O clinic_id vem da MENSAGEM, nunca do cookie de clinica ativa: a RLS de
 * message autoriza qualquer clinica ativa do usuario, entao usar o cookie
 * gravaria a leitura na clinica errada.
 *
 * Devolve true quando a trilha existe (gravada agora ou ja registrada na
 * janela) e false quando nao foi possivel garantir.
 */
export async function auditarAberturaDeMidia(
  supabase: SupabaseClient,
  params: { clinicId: string; userId: string; messageId: string },
): Promise<boolean> {
  const alvo: Params = {
    clinicId: params.clinicId,
    userId: params.userId,
    entity: "midia_conversa",
    entityId: params.messageId,
  };
  try {
    const chave = chaveDeDedupe(alvo, params.messageId);
    const agora = Date.now();
    const visto = vistoEmMemoria.get(chave);
    if (visto !== undefined && agora - visto < JANELA_MS) {
      return true;
    }
    if (await jaRegistradoNaJanela(alvo, params.messageId)) {
      return true;
    }
    const { error } = await supabase.from("audit_log").insert({
      clinic_id: params.clinicId,
      user_id: params.userId,
      action: "leu",
      entity: "midia_conversa",
      entity_id: params.messageId,
    });
    if (error) {
      return false;
    }
    vistoEmMemoria.set(chave, agora);
    return true;
  } catch {
    return false;
  }
}
