import type { SupabaseClient } from "@supabase/supabase-js";

import {
  horarioDoBanco,
  type HorarioDeOperacao,
} from "@/lib/domain/agente/config";
import { CLINICAS_DA_FASE_CONTROLADA } from "@/lib/ia/liberacao";

// Leitura da aba "Agente de IA" de Configuracoes (Fase 3; decisao do dono em
// 05/10/2026): a liberacao da IA na clinica, os numeros ligados ao
// assistente (varios desde a decisao do dono de 19/10/2026, migration
// 20261019110000), os telefones da equipe e o estado do interruptor geral.
// Contrato do banco na migration
// 20261006120000_ia_liberacao_pela_tela.sql: administrador ou
// gestor ATIVO da propria clinica le as tres tabelas da liberacao quando ela
// esta na lista fechada (ou e e_de_teste, nas suites); o interruptor geral chega so como
// booleano (ia_interruptor_ligado). A escrita nunca passa por aqui: e das
// Server Actions da aba, pelas RPCs definir_*_da_ia.
//
// Os telefones sao da EQUIPE (quem conversa com a IA nesta fase), nao de
// paciente: nao entram na trilha de leitura. Nada daqui vai para log.

/**
 * A aba so existe nas clinicas da fase controlada (teste123 e Conduzza
 * Teste). Decisao do SERVIDOR (pagina e Server Actions), pela constante
 * espelho de ia_clinicas_da_fase_controlada(). Clinica e_de_teste das suites
 * nao entra: o banco aceita a escrita dela so para os testes.
 */
export function abaDaIaVisivel(clinicId: string): boolean {
  return CLINICAS_DA_FASE_CONTROLADA.includes(clinicId.trim().toLowerCase());
}

/** O modo gravado em ia_liberacao (check do banco). */
export type ModoDaIa = "simulador" | "contatos";

export type LiberacaoDaClinica = {
  liberada: boolean;
  modo: ModoDaIa;
  /** T7: a pausa da clinica (a tela de pausar vem no E5). */
  pausadaPelaClinica: boolean;
  /** Teto das ultimas 24 horas, em centavos de dolar. */
  tetoDiarioCentavosUsd: number;
};

/** Uma linha de ia_contato_liberado (telefone da equipe). */
export type TelefoneDaIa = {
  id: string;
  /** A chave canonica gravada pelo banco (E.164 com o nono digito). */
  telefone: string;
  rotulo: string | null;
  ativo: boolean;
};

/**
 * O que a aba precisa para dizer a verdade sobre o WhatsApp (E3), sem ler
 * ia_uso nem numero de outra clinica: situacao_da_ia_na_clinica (banco, com
 * o motor da IA desde a revisao do E3) e o horario da versao PUBLICADA.
 */
export type SituacaoDaIa = {
  /** situacao_da_ia_na_clinica.teto_atingido */
  tetoAtingido: boolean;
  /** Maior versao publicada, ou null (nunca publicou). */
  versaoPublicada: number | null;
  /**
   * Ids de ia_contato_liberado que nunca acionam o assistente: numero de
   * WhatsApp do Conduzza, ou contato com sinal de paciente sem o "forcar"
   * (D-B), inclusive o forcado depois de desligado (o gatilho zera o
   * forcado; so volta pelo formulario de adicionar com o forcar).
   */
  telefonesInvalidos: string[];
  /**
   * Ids de ia_contato_liberado cujo contato revogou a autorizacao para
   * receber mensagens: o executor passa a conversa sem responder
   * (sem_autorizacao), entao tambem nao acionam o assistente.
   */
  telefonesSemAutorizacao: string[];
  /**
   * Ids de ia_contato_liberado ativos com conversa aberta com a equipe em
   * algum dos numeros ligados (nao removidos) da clinica.
   */
  telefonesComConversaAberta: string[];
  /** O horario da versao PUBLICADA (horarioDoBanco de config.ts), ou null sem versao. */
  horarioPublicado: HorarioDeOperacao | null;
  /**
   * situacao_da_ia_na_clinica.motor_parado (contrato 10.3, B8): o motor da IA
   * nao esta agendado ou tem resposta devida ha mais de 60 s. Leitura
   * OBRIGATORIA: se falhar, fetchLiberacaoDaIa lanca e a aba mostra o erro,
   * nunca o verde. (saude_do_motor nao serve mais: a sessao comum recebe
   * ia = null.)
   */
  motorParado: boolean;
};

export type DadosDaIa = {
  /** Nula: a clinica nunca ganhou linha de liberacao (nunca foi ligada). */
  liberacao: LiberacaoDaClinica | null;
  /**
   * Os ids dos numeros de WhatsApp LIGADOS ao assistente nesta clinica
   * (ia_numero_liberado.ativo), na ordem de criacao da linha (a tela mostra
   * na ordem da lista de numeros). Varios ao mesmo tempo desde a decisao do
   * dono de 19/10/2026. Pode
   * trazer numero removido da clinica (o banco nao desliga ao remover; as
   * funcoes de decisao conferem removido_em na hora): a aba so conta os que
   * ainda estao na lista de numeros ativos.
   */
  numerosLigados: string[];
  telefones: TelefoneDaIa[];
  interruptorLigado: boolean;
  situacao: SituacaoDaIa;
};

type LinhaDaLiberacao = {
  liberada: boolean;
  modo: string;
  pausada_pela_clinica: boolean;
  teto_diario_centavos_usd: number;
};

type LinhaDoNumero = { whatsapp_account_id: string };

type LinhaDoTelefone = {
  id: string;
  phone_key: string;
  rotulo: string | null;
  ativo: boolean;
};

function modoDaLinha(modo: string): ModoDaIa {
  if (modo === "simulador" || modo === "contatos") {
    return modo;
  }
  // O check do banco so aceita os dois; outro valor e banco e codigo
  // desencontrados, e a aba mostra o erro em vez de adivinhar.
  throw new Error("modo da liberacao desconhecido");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function listaDeIds(valor: unknown): string[] {
  if (!Array.isArray(valor)) {
    throw new Error("situacao da IA ilegivel");
  }
  return valor.filter(
    (id): id is string => typeof id === "string" && UUID.test(id),
  );
}

/** O jsonb de situacao_da_ia_na_clinica. Formato estranho: lanca. */
export function lerSituacaoDoBanco(
  valor: unknown,
): Omit<SituacaoDaIa, "horarioPublicado"> {
  if (typeof valor !== "object" || valor === null) {
    throw new Error("situacao da IA ilegivel");
  }
  const s = valor as Record<string, unknown>;
  const versao = s.versao_publicada;
  if (
    typeof s.teto_atingido !== "boolean" ||
    typeof s.motor_parado !== "boolean"
  ) {
    throw new Error("situacao da IA ilegivel");
  }
  if (
    versao !== null &&
    (typeof versao !== "number" || !Number.isInteger(versao))
  ) {
    throw new Error("situacao da IA ilegivel");
  }
  return {
    tetoAtingido: s.teto_atingido,
    versaoPublicada: versao,
    telefonesInvalidos: listaDeIds(s.telefones_invalidos),
    telefonesSemAutorizacao: listaDeIds(s.telefones_sem_autorizacao),
    telefonesComConversaAberta: listaDeIds(s.telefones_com_conversa_aberta),
    motorParado: s.motor_parado,
  };
}

/**
 * Só a chave motor_parado de situacao_da_ia_na_clinica (o Devolver le pela
 * service role). null quando nao da para afirmar nada: quem chama trata
 * como "nao conferido", nunca como motor de pe.
 */
export function motorParadoDaSituacao(valor: unknown): boolean | null {
  if (typeof valor !== "object" || valor === null) {
    return null;
  }
  const parado = (valor as { motor_parado?: unknown }).motor_parado;
  return typeof parado === "boolean" ? parado : null;
}

type LinhaDoHorario = {
  operating_mode: string;
  fallback_minutes: number | null;
  operating_hours: unknown;
};

/**
 * Tudo o que a aba le, de uma vez. Qualquer leitura obrigatoria que falha
 * lanca: a pagina mostra o erro da aba, nunca uma clinica "desligada" que
 * nao e, nem um verde que nao foi conferido. O motor da IA vem de
 * situacao_da_ia_na_clinica (obrigatoria), entao nao existe mais o "motor
 * que nao deu para ler" tratado como motor de pe.
 */
export async function fetchLiberacaoDaIa(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<DadosDaIa> {
  const [liberacao, numeros, telefones, interruptor, situacao, publicada] =
    await Promise.all([
      supabase
        .from("ia_liberacao")
        .select(
          "liberada, modo, pausada_pela_clinica, teto_diario_centavos_usd",
        )
        .eq("clinic_id", clinicId)
        .maybeSingle(),
      supabase
        .from("ia_numero_liberado")
        .select("whatsapp_account_id")
        .eq("clinic_id", clinicId)
        .eq("ativo", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("ia_contato_liberado")
        .select("id, phone_key, rotulo, ativo")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: true }),
      supabase.rpc("ia_interruptor_ligado"),
      supabase.rpc("situacao_da_ia_na_clinica", { p_clinic_id: clinicId }),
      supabase
        .from("ai_agent_config")
        .select("operating_mode, fallback_minutes, operating_hours")
        .eq("clinic_id", clinicId)
        .eq("status", "publicada")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  if (
    liberacao.error ||
    numeros.error ||
    telefones.error ||
    interruptor.error ||
    situacao.error ||
    publicada.error
  ) {
    throw new Error("leitura da liberacao da IA falhou");
  }
  if (typeof interruptor.data !== "boolean") {
    throw new Error("estado do interruptor geral ilegivel");
  }
  const lidaDaSituacao = lerSituacaoDoBanco(situacao.data);
  const linhaDoHorario = publicada.data as LinhaDoHorario | null;

  const linha = liberacao.data as LinhaDaLiberacao | null;
  return {
    liberacao: linha
      ? {
          liberada: linha.liberada,
          modo: modoDaLinha(linha.modo),
          pausadaPelaClinica: linha.pausada_pela_clinica,
          tetoDiarioCentavosUsd: linha.teto_diario_centavos_usd,
        }
      : null,
    numerosLigados: ((numeros.data ?? []) as LinhaDoNumero[]).map(
      (numero) => numero.whatsapp_account_id,
    ),
    telefones: ((telefones.data ?? []) as LinhaDoTelefone[]).map(
      (telefone) => ({
        id: telefone.id,
        telefone: telefone.phone_key,
        rotulo: telefone.rotulo,
        ativo: telefone.ativo,
      }),
    ),
    interruptorLigado: interruptor.data,
    situacao: {
      ...lidaDaSituacao,
      horarioPublicado: linhaDoHorario ? horarioDoBanco(linhaDoHorario) : null,
    },
  };
}

/**
 * Um numero ATIVO (nao removido) desta clinica, com a situacao da conexao
 * crua; nulo quando nao existe, e removido ou e de outra clinica. Para a
 * acao de ligar um numero ao assistente e para conferir, antes de
 * "Conversar com a equipe", que algum numero ligado ainda e da clinica (a
 * RLS de whatsapp_account recorta por clinica; o filtro por clinic_id e a
 * segunda camada).
 */
export async function fetchNumeroDaClinica(
  supabase: SupabaseClient,
  clinicId: string,
  whatsappAccountId: string,
): Promise<{ id: string; connectionStatus: string | null } | null> {
  const { data, error } = await supabase
    .from("whatsapp_account")
    .select("id, connection_status")
    .eq("id", whatsappAccountId)
    .eq("clinic_id", clinicId)
    .is("removido_em", null)
    .maybeSingle();
  if (error) {
    throw new Error("leitura do numero falhou");
  }
  const linha = data as { id: string; connection_status: string | null } | null;
  return linha
    ? { id: linha.id, connectionStatus: linha.connection_status }
    : null;
}
