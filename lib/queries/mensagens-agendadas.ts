import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { corDoNumero } from "@/lib/domain/cor-do-numero";
import {
  ehMotivoDaAgendada,
  ehSituacaoDaAgendada,
  PERMANENCIA_DA_ENVIADA_MS,
  type AgendadaDaLista,
  type ConexaoDoNumeroDaAgendada,
  type ContextoDaListaDeAgendadas,
} from "@/lib/domain/mensagem-agendada";

// A lista de mensagens agendadas do CONTATO (todos os numeros), acima da caixa
// de escrever, com o que a tela precisa para decidir chip, linha e acoes.
//
// Pela SESSAO: a RLS de mensagem_agendada recorta (o profissional so ve a da
// conversa dele), e o filtro de clinica e so a clinica ativa. O texto e dado
// de paciente (regra 3.1): esta leitura roda SO no servidor, atras de quem
// grava a trilha de leitura (listarAgendadasAction, em
// app/(app)/atendimento/agendadas-actions.ts, com a entidade
// 'mensagem_agendada' e o id do contato). Erro de leitura LANCA, nunca vira
// lista vazia: "nenhuma agendada" e "nao deu para ler" sao estados diferentes
// na tela. Nada daqui vai para log.

export type ListaDeAgendadas = {
  itens: AgendadaDaLista[];
  contexto: ContextoDaListaDeAgendadas;
};

const SELECT_DA_AGENDADA =
  "id, contact_id, whatsapp_account_id, conversation_id, texto, enviar_em, situacao, motivo, criada_por, editada_por, enviada_em, message_id, dispensada_em, criada_em, editada_em";

/**
 * Teto de linhas. A lista ja e curta por construcao (10 ativas por contato,
 * as que nao sairam ate serem dispensadas ou retidas em 30 dias e as
 * enviadas das ultimas 24 horas); o teto so impede uma resposta sem fim.
 */
export const AGENDADAS_LIMIT = 100;

/** Papeis que escrevem (Somente leitura conta como "saiu da equipe", A1). */
const PAPEIS_COM_ESCRITA = ["admin", "gestor", "recepcao", "profissional"];

type LinhaDaAgendada = {
  id: string;
  contact_id: string;
  whatsapp_account_id: string;
  conversation_id: string | null;
  texto: string | null;
  enviar_em: string;
  situacao: string;
  motivo: string | null;
  criada_por: string;
  editada_por: string | null;
  enviada_em: string | null;
  message_id: string | null;
  dispensada_em: string | null;
  criada_em: string;
  editada_em: string | null;
};

function paraAgendadaDaLista(linha: LinhaDaAgendada): AgendadaDaLista | null {
  if (!ehSituacaoDaAgendada(linha.situacao)) {
    return null;
  }
  return {
    id: linha.id,
    contactId: linha.contact_id,
    whatsappAccountId: linha.whatsapp_account_id,
    conversationId: linha.conversation_id,
    texto: linha.texto,
    enviarEm: linha.enviar_em,
    situacao: linha.situacao,
    motivo: ehMotivoDaAgendada(linha.motivo) ? linha.motivo : null,
    criadaPor: linha.criada_por,
    editadaPor: linha.editada_por,
    enviadaEm: linha.enviada_em,
    messageId: linha.message_id,
    dispensadaEm: linha.dispensada_em,
    criadaEm: linha.criada_em,
    editadaEm: linha.editada_em,
  };
}

/**
 * As agendadas do contato que a lista mostra, na ordem de enviar_em:
 * - as que ainda vao sair (agendada e enviando);
 * - as que nao sairam e ninguem dispensou (nao_enviada e nao_confirmada);
 * - as enviadas nas ultimas 24 horas (com "Ver na conversa").
 *
 * Junto, o contexto calculado no servidor: por numero, a ultima entrada do
 * contato (o aviso "escreveu depois") e a conexao; e quem ainda escreve na
 * clinica (o "(sem acesso)" e a linha da atividade). Sem nenhuma agendada,
 * uma consulta so: o caso comum (conversa sem agendada) nao paga as outras.
 */
export async function fetchMensagensAgendadas(
  supabase: SupabaseClient,
  clinicId: string,
  contactId: string,
  agora: Date = new Date(),
): Promise<ListaDeAgendadas> {
  const desde = new Date(
    agora.getTime() - PERMANENCIA_DA_ENVIADA_MS,
  ).toISOString();
  const { data, error } = await supabase
    .from("mensagem_agendada")
    .select(SELECT_DA_AGENDADA)
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    // Aspas no valor: a hora ISO tem ":" e ".", que a arvore logica do
    // PostgREST reserva.
    .or(
      [
        "situacao.in.(agendada,enviando)",
        "and(situacao.in.(nao_enviada,nao_confirmada),dispensada_em.is.null)",
        `and(situacao.eq.enviada,enviada_em.gte."${desde}")`,
      ].join(","),
    )
    .order("enviar_em", { ascending: true })
    .order("criada_em", { ascending: true })
    .limit(AGENDADAS_LIMIT);
  if (error) {
    throw new Error(error.message);
  }
  const itens = ((data ?? []) as LinhaDaAgendada[])
    .map(paraAgendadaDaLista)
    .filter((item): item is AgendadaDaLista => item !== null);

  if (itens.length === 0) {
    return {
      itens,
      contexto: {
        ultimaEntradaPorNumero: {},
        conexaoPorNumero: {},
        membrosComEscrita: [],
      },
    };
  }

  const numeros = [...new Set(itens.map((item) => item.whatsappAccountId))];
  const [entradas, conexoes, membros] = await Promise.all([
    supabase
      .from("conversation")
      .select("whatsapp_account_id, last_inbound_at")
      .eq("clinic_id", clinicId)
      .eq("contact_id", contactId)
      .in("whatsapp_account_id", numeros),
    supabase
      .from("whatsapp_account")
      .select("id, nome, connection_status, removido_em, cor")
      .eq("clinic_id", clinicId)
      .in("id", numeros),
    supabase
      .from("clinic_member")
      .select("user_id")
      .eq("clinic_id", clinicId)
      .eq("status", "ativo")
      .in("role", PAPEIS_COM_ESCRITA),
  ]);
  if (entradas.error) {
    throw new Error(entradas.error.message);
  }
  if (conexoes.error) {
    throw new Error(conexoes.error.message);
  }
  if (membros.error) {
    throw new Error(membros.error.message);
  }

  // A ultima entrada por numero: a maior last_inbound_at entre as conversas
  // do contato naquele numero (a resolvida e a aberta). Numero sem entrada
  // fica com null.
  const ultimaEntradaPorNumero: Record<string, string | null> = {};
  for (const numero of numeros) {
    ultimaEntradaPorNumero[numero] = null;
  }
  for (const conversa of (entradas.data ?? []) as {
    whatsapp_account_id: string | null;
    last_inbound_at: string | null;
  }[]) {
    const numero = conversa.whatsapp_account_id;
    if (!numero || !conversa.last_inbound_at) {
      continue;
    }
    const atual = ultimaEntradaPorNumero[numero];
    if (
      !atual ||
      new Date(conversa.last_inbound_at).getTime() > new Date(atual).getTime()
    ) {
      ultimaEntradaPorNumero[numero] = conversa.last_inbound_at;
    }
  }

  const conexaoPorNumero: Record<string, ConexaoDoNumeroDaAgendada> = {};
  for (const numero of (conexoes.data ?? []) as {
    id: string;
    nome: string;
    connection_status: string;
    removido_em: string | null;
    cor: string | null;
  }[]) {
    conexaoPorNumero[numero.id] = {
      nome: numero.nome,
      conectado: numero.connection_status === "conectado",
      removido: numero.removido_em !== null,
      cor: numero.cor ? corDoNumero(numero.cor) : null,
    };
  }

  return {
    itens,
    contexto: {
      ultimaEntradaPorNumero,
      conexaoPorNumero,
      membrosComEscrita: ((membros.data ?? []) as { user_id: string }[]).map(
        (membro) => membro.user_id,
      ),
    },
  };
}
