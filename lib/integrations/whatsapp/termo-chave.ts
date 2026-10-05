import type { SupabaseClient } from "@supabase/supabase-js";

import {
  etapaPorTermoChave,
  type PapelDeEtapa,
  type QuemEscreveu,
  type TermosDeQuem,
} from "@/lib/domain/jornada";
import { log } from "@/lib/log";

// TERMO-CHAVE da jornada: um texto da conversa contendo um termo de etapa
// move o contato para ela. A decisao (quem escreveu, mais longo vence, so para
// frente, nunca sai de nem entra em perda) e pura em lib/domain/jornada.ts;
// aqui e a leitura da jornada mais o update guardado pela etapa atual, para
// dois textos simultaneos nao se atropelarem.
//
// Tres portas chamam, cada uma dizendo de que lado veio o texto:
// - ingest.ts, mensagem RECEBIDA do paciente: 'paciente';
// - atendimento/actions.ts, texto enviado pela atendente pelo sistema:
//   'clinica' (depois do envio, sem segurar a resposta da action);
// - webhook, eco do celular conectado (fromMe): 'clinica'.
// Cada porta evita passar o mesmo texto duas vezes: a ingestao so com
// mensagem inserida (reentrega volta inserted=false), o envio so depois de
// sair, o eco so quando saiu do celular ha pouco (ecoContaParaTermo em
// inbound.ts) e com a marca nova por wa_message_id (marcar_eco_para_termo).
// Desde 05/10/2026 o eco tambem vira linha de mensagem (pelo_celular), mas a
// garantia do termo continua sendo a marca, como antes. E uma segunda
// passada do mesmo texto quase nunca muda nada: o contato ja esta na etapa
// do termo e "so para frente" nao o move de novo (so moveria se alguem o
// tivesse voltado a mao no meio tempo).
//
// Melhor esforco: falha vira log so com ids. REGRA ABSOLUTA: nenhum texto de
// conversa em log nem na trilha (regra 3.1), nem qual termo casou.

/**
 * A trilha de cada lado. A do paciente e o nome de sempre (a trilha que ja
 * existia continua casando); a da clinica leva o sufixo, e quem filtra por
 * prefixo pega as duas. O audit_log nao tem coluna de detalhe, entao a
 * origem vive no nome da acao.
 */
export const TRILHA_DO_TERMO: Record<QuemEscreveu, string> = {
  paciente: "termo_chave_moveu_etapa",
  clinica: "termo_chave_moveu_etapa_clinica",
};

type LinhaDaEtapa = {
  chave: string;
  posicao: number;
  papel: PapelDeEtapa | null;
  termos_chave: string[];
  termos_de_quem: TermosDeQuem;
};

/**
 * Tenta mover o contato pelo termo escrito em `corpo`.
 *
 * `admin` e o cliente de servico: o profissional pode responder a conversa,
 * mas a policy de contact nao o deixa escrever, e o movimento e automacao do
 * sistema (como o Assumir), auditada em nome de quem escreveu quando ha uma
 * pessoa (`userId`) e com user_id nulo quando nao ha (paciente, celular).
 *
 * Devolve a chave da etapa de destino quando moveu, ou null (sem termo, sem
 * etapa que aceite este lado, outra mensagem moveu antes, falha).
 */
export async function tentarMoverPorTermo(
  admin: SupabaseClient,
  params: {
    clinicId: string;
    contactId: string;
    corpo: string;
    quemEscreveu: QuemEscreveu;
    userId: string | null;
  },
): Promise<string | null> {
  const { clinicId, contactId, corpo, quemEscreveu, userId } = params;
  const [jornadaResult, contatoResult] = await Promise.all([
    admin
      .from("funnel_stage_def")
      .select("chave, posicao, papel, termos_chave, termos_de_quem")
      .eq("clinic_id", clinicId),
    admin
      .from("contact")
      .select("funnel_stage")
      .eq("clinic_id", clinicId)
      .eq("id", contactId)
      .maybeSingle(),
  ]);
  if (jornadaResult.error || contatoResult.error) {
    log.error("termo_chave_ler_jornada_falhou", {
      clinic_id: clinicId,
      contact_id: contactId,
      kind: quemEscreveu,
      error_code:
        jornadaResult.error?.code ?? contatoResult.error?.code ?? null,
    });
    return null;
  }
  // Contato que sumiu no meio do caminho (apagamento LGPD, por exemplo) nao
  // e falha: nao ha o que mover.
  const contato = contatoResult.data as { funnel_stage: string } | null;
  if (!contato) {
    return null;
  }

  const etapaAtual = contato.funnel_stage;
  const destino = etapaPorTermoChave(
    corpo,
    etapaAtual,
    (jornadaResult.data ?? []) as LinhaDaEtapa[],
    quemEscreveu,
  );
  if (!destino) {
    return null;
  }

  // Guardado pela etapa de origem: se outro texto (ou uma pessoa) moveu o
  // contato no meio tempo, este update afeta zero linhas e nada de errado
  // acontece.
  const { data: movidas, error: erroMover } = await admin
    .from("contact")
    .update({ funnel_stage: destino.chave })
    .eq("clinic_id", clinicId)
    .eq("id", contactId)
    .eq("funnel_stage", etapaAtual)
    .select("id");
  if (erroMover) {
    log.error("termo_chave_mover_falhou", {
      clinic_id: clinicId,
      contact_id: contactId,
      kind: quemEscreveu,
      error_code: erroMover.code ?? null,
    });
    return null;
  }
  if (!movidas || movidas.length === 0) {
    return null;
  }

  // Trilha do movimento: registra que um termo de tal lado moveu o contato,
  // nunca qual termo nem o texto (regra 3.1).
  const { error: erroTrilha } = await admin.from("audit_log").insert({
    clinic_id: clinicId,
    user_id: userId,
    action: TRILHA_DO_TERMO[quemEscreveu],
    entity: "contact",
    entity_id: contactId,
  });
  if (erroTrilha) {
    log.error("termo_chave_trilha_falhou", {
      clinic_id: clinicId,
      contact_id: contactId,
      kind: quemEscreveu,
      error_code: erroTrilha.code ?? null,
    });
  }
  return destino.chave;
}
