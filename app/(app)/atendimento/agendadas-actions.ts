"use server";

import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import {
  DICAS_DA_AGENDADA,
  ERROS_DA_AGENDADA,
  problemaNoTexto,
  tamanhoDoTexto,
  TEXTO_MAXIMO_DA_AGENDADA,
  validarQuando,
} from "@/lib/domain/mensagem-agendada";
import { canEdit, canView, permissionHint } from "@/lib/domain/permissions";
import {
  fetchMensagensAgendadas,
  type ListaDeAgendadas,
} from "@/lib/queries/mensagens-agendadas";
import { createClient } from "@/lib/supabase/server";

import { enviarComoAtendente, type InboxActionResult } from "./actions";

// Server Actions da MENSAGEM AGENDADA na conversa (tabela mensagem_agendada,
// migration 20261006140000; desenho revisado secao 3 e decisoes do dono de
// 06/10/2026).
//
// Quem agenda e quem pode responder (canEdit 'atendimento'), na conversa que
// esta em atendimento com ele. Quem escreve e VE a agendada (a RLS recorta:
// o profissional so a da conversa dele) edita, exclui e dispensa (A1: quem
// edita passa a assinar). O banco confere tudo de novo no gatilho
// proteger_mensagem_agendada e carimba autoria e datas: daqui so saem texto,
// hora, a exclusao e o dispensar.
//
// Toda entrada passa por Zod; cliente de SESSAO (a RLS aplica) com o filtro
// da clinica ativa; toda mutacao vai para audit_log com a entidade
// 'mensagem_agendada' e o id, NUNCA com o texto (dado de paciente, regra
// 3.1). A leitura da lista grava a trilha de leitura com o id do contato.

export type AgendadaActionResult = { ok: true } | { ok: false; error: string };

export type AgendarMensagemResult =
  | {
      ok: true;
      /** O instante gravado (ISO): o da linha, mesmo no duplo envio. */
      enviarEm: string;
    }
  | { ok: false; error: string };

export type EnviarAgendadaAgoraResult =
  | { ok: true; messageId?: string; conversationId: string }
  | {
      ok: false;
      error: string;
      /**
       * O texto da agendada, quando ela ja foi retirada e e CERTO que nada
       * saiu: a tela devolve ao campo para a atendente nao perder o que
       * escreveu. Nunca vem junto com `incerto`.
       */
      texto?: string;
      /**
       * A agendada ja foi retirada e a mensagem PODE ter chegado ao paciente
       * (envio incerto, resposta do provedor, excecao). Sem o texto: a tela
       * avisa para conferir a conversa e recarrega o fio e a lista, e nunca
       * oferece o mesmo texto para mandar de novo.
       */
      incerto?: true;
    };

export type CancelarAgendadasDaPessoaResult =
  { ok: true; canceladas: number } | { ok: false; error: string };

export type ListarAgendadasResult =
  ({ ok: true } & ListaDeAgendadas) | { ok: false; error: string };

const SESSAO_EXPIRADA = "Sessão expirada. Entre de novo.";
const ASSUMA_A_CONVERSA = "Assuma a conversa antes de agendar.";
const CONVERSA_INDISPONIVEL =
  "Esta conversa não está mais disponível para você.";
const EDICAO_FALHOU =
  "Não foi possível salvar a mudança. O texto continua aqui.";
const EXCLUSAO_FALHOU =
  "Não foi possível excluir a mensagem agendada. Tente de novo.";
const DISPENSA_FALHOU = "Não foi possível esconder a mensagem. Tente de novo.";
const ENVIAR_AGORA_FALHOU = "Não foi possível enviar agora. Tente de novo.";
const LISTA_FALHOU = "Não foi possível carregar as mensagens agendadas.";
const CANCELAMENTO_FALHOU =
  "Não foi possível cancelar as mensagens agendadas desta pessoa. Tente de novo.";

/**
 * As recusas do gatilho proteger_mensagem_agendada, que ja explicam o motivo
 * em portugues e sao textos FIXOS (nenhum dado de paciente): repassadas como
 * vieram. Qualquer outra mensagem do banco nunca chega a tela.
 */
const RECUSAS_DO_GATILHO = new Set([
  "Escreva a mensagem (até 4096 caracteres).",
  "Essa hora já passou. Escolha outra.",
  "Mais de 1 ano à frente não dá para agendar.",
  "O número desta conversa foi removido. Não dá para agendar por ele.",
  "Assuma a conversa antes de agendar.",
  "Este contato não autorizou receber mensagens. Registre a autorização na ficha antes de agendar.",
  "Este contato já tem muitas mensagens agendadas. Exclua uma antes de agendar outra.",
  "Só o texto, a hora, a exclusão e o dispensar mudam por aqui.",
  "Faça uma mudança de cada vez.",
  "Só dá para excluir uma mensagem agendada ou na fila para sair.",
  "Esta mensagem já começou a sair e não dá mais para excluir. Confira a conversa.",
  "Só uma mensagem que não saiu pode ser dispensada.",
  "Esta mensagem já começou a sair e a mudança não foi salva. Confira a conversa.",
]);

type ErroDoBanco = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
} | null;

/** A frase da tela para um erro do banco: a recusa fixa do gatilho, ou o padrao. */
function mensagemDoErro(erro: ErroDoBanco, padrao: string): string {
  const texto = erro?.message?.trim() ?? "";
  if (RECUSAS_DO_GATILHO.has(texto)) {
    return texto;
  }
  // A policy recusou (sem o gatilho ter dito por que): quem nao escreve.
  if (erro?.code === "42501") {
    return DICAS_DA_AGENDADA.soAcompanha;
  }
  return padrao;
}

type QuemResponde = {
  clinicId: string;
  timezone: string;
  userId: string;
};
type Recusa = { error: string };

/**
 * Quem responde no Atendimento (Somente leitura acompanha, sem responder). A
 * checagem existe aqui E na policy (user_can_write), porque esconder botao
 * nao protege nada.
 */
async function exigirQuemResponde(): Promise<QuemResponde | Recusa> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: SESSAO_EXPIRADA };
  }
  if (!canEdit(context.active.role, "atendimento")) {
    return { error: DICAS_DA_AGENDADA.soAcompanha };
  }
  return {
    clinicId: context.active.clinicId,
    timezone: context.active.timezone,
    userId: context.userId,
  };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function auditar(
  supabase: Supabase,
  quem: QuemResponde,
  action:
    | "agendou_mensagem"
    | "editou_mensagem_agendada"
    | "excluiu_mensagem_agendada"
    | "dispensou_mensagem_agendada"
    // O desfecho do "Enviar agora", depois de a RPC retirar a agendada (ela
    // grava 'retirou_agendada_para_enviar_agora'): saiu, certo que nao
    // saiu, ou pode ter saido.
    | "enviou_agora_mensagem_agendada"
    | "enviar_agora_nao_saiu"
    | "enviar_agora_incerto",
  entityId: string,
): Promise<void> {
  await supabase.from("audit_log").insert({
    clinic_id: quem.clinicId,
    user_id: quem.userId,
    action,
    entity: "mensagem_agendada",
    entity_id: entityId,
  });
}

/** O que ainda resta de uma agendada, para explicar um UPDATE que nao pegou. */
async function situacaoAtual(
  supabase: Supabase,
  clinicId: string,
  id: string,
): Promise<{ situacao: string; dispensada_em: string | null } | null> {
  const { data } = await supabase
    .from("mensagem_agendada")
    .select("situacao, dispensada_em")
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .maybeSingle();
  return (
    (data as { situacao: string; dispensada_em: string | null } | null) ?? null
  );
}

// Texto, data e hora chegam crus: a regra (tamanho em unidades UTF-16, a
// regua do envio 1:1; formato, hora passada e teto de 1 ano no dia civil da
// clinica) e a do dominio, a MESMA do dialogo; o gatilho confere de novo,
// com o CHECK (mais frouxo, em pontos de codigo). Os tetos de tamanho aqui
// so barram entrada absurda.
const quandoSchema = {
  texto: z.string().max(40_000),
  data: z.string().max(20),
  hora: z.string().max(10),
};

const agendarSchema = z.object({
  /** Gerado pelo dialogo na abertura: o duplo envio cai na mesma linha. */
  id: z.uuid(),
  conversationId: z.uuid(),
  ...quandoSchema,
  /** "Agendar de novo": a nao enviada que esta substitui (e dispensada). */
  substitui: z.uuid().nullish(),
});

const editarSchema = z.object({ id: z.uuid(), ...quandoSchema });
const alvoSchema = z.object({ id: z.uuid() });
const pessoaSchema = z.object({ userId: z.uuid() });
const contatoSchema = z.object({ contactId: z.uuid() });

type ConversaDoAgendamento = {
  id: string;
  contact_id: string;
  status: string;
  assignee_user_id: string | null;
  whatsapp_account_id: string | null;
};

// ---------------------------------------------------------------------------
// Leitura (com trilha)
// ---------------------------------------------------------------------------

/**
 * A lista das agendadas do contato (todos os numeros), para a lista acima da
 * caixa de escrever. A trilha leva o id do CONTATO e termina antes de o texto
 * sair do servidor. Toda a equipe ve (Somente leitura inclusive); a RLS
 * recorta o profissional.
 */
export async function listarAgendadasAction(
  input: unknown,
): Promise<ListarAgendadasResult> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: SESSAO_EXPIRADA };
  }
  if (!canView(context.active.role, "atendimento")) {
    return { ok: false, error: LISTA_FALHOU };
  }
  const parsed = contatoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: LISTA_FALHOU };
  }
  const clinicId = context.active.clinicId;
  const supabase = await createClient();
  try {
    const [lista] = await Promise.all([
      fetchMensagensAgendadas(supabase, clinicId, parsed.data.contactId),
      auditarLeituraDePaciente(supabase, {
        clinicId,
        userId: context.userId,
        entity: "mensagem_agendada",
        entityId: parsed.data.contactId,
      }),
    ]);
    return { ok: true, ...lista };
  } catch {
    return { ok: false, error: LISTA_FALHOU };
  }
}

// ---------------------------------------------------------------------------
// Mutacoes
// ---------------------------------------------------------------------------

/**
 * Agenda uma mensagem na conversa aberta (em atendimento com quem agenda).
 * Contato e numero vem da CONVERSA, nunca do cliente. O id vem do dialogo:
 * o duplo envio (ou a resposta perdida no caminho) relê a linha e devolve
 * ok, sem agendar duas vezes.
 */
export async function agendarMensagemAction(
  input: unknown,
): Promise<AgendarMensagemResult> {
  const guard = await exigirQuemResponde();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = agendarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: ERROS_DA_AGENDADA.naoAgendou };
  }
  const dados = parsed.data;
  const problema = problemaNoTexto(dados.texto);
  if (problema) {
    return { ok: false, error: problema };
  }
  const texto = dados.texto.trim();
  const quando = validarQuando({
    data: dados.data,
    hora: dados.hora,
    agora: Date.now(),
    fuso: guard.timezone,
  });
  if (!quando.ok) {
    return { ok: false, error: quando.erro };
  }

  const supabase = await createClient();
  // A mesma regra do sendMessageAction: so quem esta com a conversa agenda.
  const { data: lida, error: erroConversa } = await supabase
    .from("conversation")
    .select("id, contact_id, status, assignee_user_id, whatsapp_account_id")
    .eq("clinic_id", guard.clinicId)
    .eq("id", dados.conversationId)
    .maybeSingle();
  if (erroConversa) {
    return { ok: false, error: ERROS_DA_AGENDADA.naoAgendou };
  }
  const conversa = lida as ConversaDoAgendamento | null;
  if (!conversa) {
    return { ok: false, error: CONVERSA_INDISPONIVEL };
  }
  if (
    conversa.status !== "em_atendimento" ||
    conversa.assignee_user_id !== guard.userId
  ) {
    return { ok: false, error: ASSUMA_A_CONVERSA };
  }
  if (!conversa.whatsapp_account_id) {
    // Conversa sem numero so existe em clinica sem numero nenhum: nao ha por
    // onde a mensagem sair.
    return { ok: false, error: ERROS_DA_AGENDADA.naoAgendou };
  }

  // Autoria, situacao e carimbos: o gatilho preenche com a sessao.
  const { error } = await supabase.from("mensagem_agendada").insert({
    id: dados.id,
    clinic_id: guard.clinicId,
    contact_id: conversa.contact_id,
    whatsapp_account_id: conversa.whatsapp_account_id,
    conversation_id: conversa.id,
    texto,
    enviar_em: quando.enviarEm,
  });
  if (error) {
    if (error.code === "23505") {
      const onde = `${error.message ?? ""} ${error.details ?? ""}`;
      if (onde.includes("mensagem_agendada_sem_duplicata")) {
        return { ok: false, error: ERROS_DA_AGENDADA.duplicada };
      }
      // O mesmo id: o duplo envio do dialogo. Vale se a linha e de quem
      // agenda e do mesmo contato; senao, erro sem dizer o que existe.
      const { data: existente } = await supabase
        .from("mensagem_agendada")
        .select("criada_por, contact_id, enviar_em")
        .eq("clinic_id", guard.clinicId)
        .eq("id", dados.id)
        .maybeSingle();
      const linha = existente as {
        criada_por: string;
        contact_id: string;
        enviar_em: string;
      } | null;
      if (
        linha &&
        linha.criada_por === guard.userId &&
        linha.contact_id === conversa.contact_id
      ) {
        return { ok: true, enviarEm: linha.enviar_em };
      }
      return { ok: false, error: ERROS_DA_AGENDADA.naoAgendou };
    }
    return {
      ok: false,
      error: mensagemDoErro(error, ERROS_DA_AGENDADA.naoAgendou),
    };
  }
  await auditar(supabase, guard, "agendou_mensagem", dados.id);

  // "Agendar de novo": so depois do sucesso a nao enviada antiga sai da
  // lista. Falhar aqui nao desfaz o agendamento: ela continua visivel com o
  // proprio Dispensar.
  if (dados.substitui && dados.substitui !== dados.id) {
    const { data: dispensadas } = await supabase
      .from("mensagem_agendada")
      .update({ dispensada_em: new Date().toISOString() })
      .eq("clinic_id", guard.clinicId)
      .eq("id", dados.substitui)
      .eq("contact_id", conversa.contact_id)
      .in("situacao", ["nao_enviada", "nao_confirmada"])
      .is("dispensada_em", null)
      .select("id");
    if (dispensadas && dispensadas.length > 0) {
      await auditar(
        supabase,
        guard,
        "dispensou_mensagem_agendada",
        dados.substitui,
      );
    }
  }
  return { ok: true, enviarEm: quando.enviarEm };
}

/**
 * Muda texto, data e hora de uma agendada que ainda nao comecou a sair. A1:
 * qualquer pessoa que escreve e ve a agendada edita, e passa a assinar.
 */
export async function editarAgendadaAction(
  input: unknown,
): Promise<AgendadaActionResult> {
  const guard = await exigirQuemResponde();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = editarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: EDICAO_FALHOU };
  }
  const dados = parsed.data;
  const problema = problemaNoTexto(dados.texto);
  if (problema) {
    return { ok: false, error: problema };
  }
  const quando = validarQuando({
    data: dados.data,
    hora: dados.hora,
    agora: Date.now(),
    fuso: guard.timezone,
  });
  if (!quando.ok) {
    return { ok: false, error: quando.erro };
  }

  const supabase = await createClient();
  // Guardado pela situacao: se a planejadora pegou a agendada no meio do
  // caminho, zero linhas voltam e nada muda.
  const { data, error } = await supabase
    .from("mensagem_agendada")
    .update({ texto: dados.texto.trim(), enviar_em: quando.enviarEm })
    .eq("clinic_id", guard.clinicId)
    .eq("id", dados.id)
    .eq("situacao", "agendada")
    .select("id");
  if (error) {
    return { ok: false, error: mensagemDoErro(error, EDICAO_FALHOU) };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: ERROS_DA_AGENDADA.edicaoPerdeuACorrida };
  }
  await auditar(supabase, guard, "editou_mensagem_agendada", dados.id);
  return { ok: true };
}

/**
 * Exclui (cancela) uma agendada que ainda vai sair, inclusive a que esta na
 * fila: o gatilho cancela o job junto, atomico com o claim. A que ja comecou
 * a sair nao exclui mais (CZ409). Excluir de novo o que ja saiu da lista e
 * ok, sem trilha nova.
 */
export async function excluirAgendadaAction(
  input: unknown,
): Promise<AgendadaActionResult> {
  const guard = await exigirQuemResponde();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = alvoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: ERROS_DA_AGENDADA.naoDisponivel };
  }
  const id = parsed.data.id;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mensagem_agendada")
    .update({ situacao: "cancelada" })
    .eq("clinic_id", guard.clinicId)
    .eq("id", id)
    .in("situacao", ["agendada", "enviando"])
    .select("id");
  if (error) {
    if (error.code === "CZ409") {
      return { ok: false, error: ERROS_DA_AGENDADA.exclusaoPerdeuACorrida };
    }
    return { ok: false, error: mensagemDoErro(error, EXCLUSAO_FALHOU) };
  }
  if (!data || data.length === 0) {
    const atual = await situacaoAtual(supabase, guard.clinicId, id);
    if (!atual) {
      return { ok: false, error: ERROS_DA_AGENDADA.naoDisponivel };
    }
    if (atual.situacao === "cancelada") {
      return { ok: true };
    }
    return { ok: false, error: ERROS_DA_AGENDADA.exclusaoPerdeuACorrida };
  }
  await auditar(supabase, guard, "excluiu_mensagem_agendada", id);
  return { ok: true };
}

/**
 * Tira da lista a que nao saiu (Nao enviada: "Dispensar"; Envio nao
 * confirmado: "Entendi, esconder"). O texto e apagado junto, no gatilho.
 * Idempotente: dispensar de novo e ok.
 */
export async function dispensarAgendadaAction(
  input: unknown,
): Promise<AgendadaActionResult> {
  const guard = await exigirQuemResponde();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = alvoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: ERROS_DA_AGENDADA.naoDisponivel };
  }
  const id = parsed.data.id;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mensagem_agendada")
    .update({ dispensada_em: new Date().toISOString() })
    .eq("clinic_id", guard.clinicId)
    .eq("id", id)
    .in("situacao", ["nao_enviada", "nao_confirmada"])
    .is("dispensada_em", null)
    .select("id");
  if (error) {
    return { ok: false, error: mensagemDoErro(error, DISPENSA_FALHOU) };
  }
  if (!data || data.length === 0) {
    const atual = await situacaoAtual(supabase, guard.clinicId, id);
    if (atual?.dispensada_em) {
      return { ok: true };
    }
    return { ok: false, error: ERROS_DA_AGENDADA.naoDisponivel };
  }
  await auditar(supabase, guard, "dispensou_mensagem_agendada", id);
  return { ok: true };
}

/**
 * "Enviar agora": retira a agendada (tirar_agendada_para_enviar_agora, que
 * exige quem escreve e esta COM a conversa do numero dela, e grava a trilha
 * 'retirou_agendada_para_enviar_agora') e envia o texto pelo trilho 1:1, em
 * nome de quem clicou, como uma resposta digitada (enviarComoAtendente: o
 * termo da jornada anda, A4). Retirar ANTES de enviar: o pior caso e nada
 * sair, nunca o paciente receber em dobro.
 *
 * Depois de retirar, o desfecho vai para a trilha (sem o texto) e a tela
 * recebe uma de tres respostas:
 * - saiu: ok;
 * - e CERTO que nada saiu (recusa antes do canal, ou falha que send.ts
 *   garante sem envio): o texto volta, para a atendente nao perder o que
 *   escreveu;
 * - PODE ter saido (envio incerto, resposta do provedor, excecao): `incerto`
 *   e SEM o texto. Devolver o texto aqui levava a mandar duas vezes (achado
 *   1 da revisao).
 */
export async function enviarAgendadaAgoraAction(
  input: unknown,
): Promise<EnviarAgendadaAgoraResult> {
  const guard = await exigirQuemResponde();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = alvoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: ERROS_DA_AGENDADA.naoDisponivel };
  }
  const id = parsed.data.id;
  const supabase = await createClient();

  // O tamanho ANTES de retirar, com a mesma regua do envio 1:1 (unidades
  // UTF-16): um texto que o 1:1 recusaria nao pode custar a agendada. Lido
  // pela sessao (a RLS recorta); o texto nao sai daqui. Sem leitura, nada
  // muda: a atendente tenta de novo.
  const { data: lida, error: erroDaLeitura } = await supabase
    .from("mensagem_agendada")
    .select("texto, whatsapp_account_id")
    .eq("clinic_id", guard.clinicId)
    .eq("id", id)
    .maybeSingle();
  if (erroDaLeitura) {
    return { ok: false, error: ENVIAR_AGORA_FALHOU };
  }
  const atual = lida as {
    texto: string | null;
    whatsapp_account_id: string | null;
  } | null;
  if (typeof atual?.texto === "string") {
    const tamanho = tamanhoDoTexto(atual.texto.trim());
    if (tamanho > TEXTO_MAXIMO_DA_AGENDADA) {
      return {
        ok: false,
        error: ERROS_DA_AGENDADA.textoLongoParaEnviar(tamanho),
      };
    }
  }
  // O numero DA AGENDADA desconectado: o envio 1:1 recusaria depois de
  // retirar, e a agendada, que espera a reconexao sozinha, deixaria de
  // existir. A mesma regra do botao (acoesDoItem), conferida aqui porque
  // botao desabilitado nao protege nada. Sem leitura, segue: o envio confere
  // de novo e, desconectado, devolve o texto.
  if (atual?.whatsapp_account_id) {
    const { data: numero } = await supabase
      .from("whatsapp_account")
      .select("nome, connection_status, removido_em")
      .eq("clinic_id", guard.clinicId)
      .eq("id", atual.whatsapp_account_id)
      .maybeSingle();
    const conexao = numero as {
      nome: string | null;
      connection_status: string | null;
      removido_em: string | null;
    } | null;
    if (
      conexao &&
      !conexao.removido_em &&
      conexao.connection_status !== "conectado"
    ) {
      return {
        ok: false,
        error: DICAS_DA_AGENDADA.enviarAgoraNumeroDesconectado(
          conexao.nome?.trim() || null,
        ),
      };
    }
  }

  const { data, error } = await supabase.rpc(
    "tirar_agendada_para_enviar_agora",
    { p_id: id },
  );
  if (error) {
    return { ok: false, error: ENVIAR_AGORA_FALHOU };
  }
  const resposta = data as {
    estado?: unknown;
    texto?: unknown;
    conversation_id?: unknown;
  } | null;
  switch (resposta?.estado) {
    case "ok":
      break;
    case "ja_saindo":
      return { ok: false, error: ERROS_DA_AGENDADA.jaNaFila };
    case "assuma_a_conversa":
      return { ok: false, error: DICAS_DA_AGENDADA.enviarAgoraAssuma };
    default:
      return { ok: false, error: ERROS_DA_AGENDADA.naoDisponivel };
  }
  const texto = typeof resposta.texto === "string" ? resposta.texto : null;
  const conversationId =
    typeof resposta.conversation_id === "string"
      ? resposta.conversation_id
      : null;
  if (!texto || !conversationId) {
    // Retirada, mas sem o que enviar: nada saiu.
    await auditar(supabase, guard, "enviar_agora_nao_saiu", id);
    return {
      ok: false,
      error: ERROS_DA_AGENDADA.enviarAgoraFalhou,
      ...(texto ? { texto } : {}),
    };
  }
  // Excecao e estado desconhecido: pode ter sido depois de o provedor
  // enviar. Conta como incerto.
  const envio = await enviarComoAtendente(conversationId, texto).catch(
    () => null,
  );
  if (envio?.ok) {
    await auditar(supabase, guard, "enviou_agora_mensagem_agendada", id);
    return {
      ok: true,
      conversationId,
      ...(envio.messageId ? { messageId: envio.messageId } : {}),
    };
  }
  if (envio !== null && nadaSaiu(envio)) {
    await auditar(supabase, guard, "enviar_agora_nao_saiu", id);
    return { ok: false, error: ERROS_DA_AGENDADA.enviarAgoraFalhou, texto };
  }
  await auditar(supabase, guard, "enviar_agora_incerto", id);
  return {
    ok: false,
    incerto: true,
    error: ERROS_DA_AGENDADA.enviarAgoraIncerto,
  };
}

/**
 * A falha do enviarComoAtendente garante que nada chegou ao paciente?
 * - veio do canal (traz o codigo): vale a classificacao de send.ts
 *   (naoSaiu, envioCertamenteNaoSaiu);
 * - nao veio do canal (sem codigo): foi recusada antes (validacao, sessao,
 *   posse da conversa), e nada foi enviado.
 */
function nadaSaiu(envio: InboxActionResult): boolean {
  if (envio.codigo !== undefined) {
    return envio.naoSaiu === true;
  }
  return true;
}

/**
 * Configuracoes > Equipe (A5): ao tirar o acesso ou trocar para Somente
 * leitura, quem gerencia a equipe pode cancelar as agendadas que a pessoa
 * ASSINA (quem editou por ultimo, senao quem criou). So as que ainda nao
 * comecaram a sair; a sessao de quem gerencia escreve, e a RLS e o gatilho
 * deixam excluir. Uma linha de trilha por agendada cancelada.
 */
export async function cancelarAgendadasDaPessoaAction(
  input: unknown,
): Promise<CancelarAgendadasDaPessoaResult> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: SESSAO_EXPIRADA };
  }
  const { role } = context.active;
  if (!canEdit(role, "configuracoes")) {
    return {
      ok: false,
      error:
        permissionHint(role, "configuracoes") ??
        "Somente administradores e gestores gerenciam a equipe.",
    };
  }
  const parsed = pessoaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: CANCELAMENTO_FALHOU };
  }
  const pessoa = parsed.data.userId;
  const quem: QuemResponde = {
    clinicId: context.active.clinicId,
    timezone: context.active.timezone,
    userId: context.userId,
  };
  const supabase = await createClient();
  // Assinante = coalesce(editada_por, criada_por): editou por ultimo, ou
  // criou e ninguem editou. O uuid ja passou pelo Zod.
  const { data, error } = await supabase
    .from("mensagem_agendada")
    .update({ situacao: "cancelada" })
    .eq("clinic_id", quem.clinicId)
    .eq("situacao", "agendada")
    .or(
      `editada_por.eq.${pessoa},and(editada_por.is.null,criada_por.eq.${pessoa})`,
    )
    .select("id");
  if (error) {
    return { ok: false, error: CANCELAMENTO_FALHOU };
  }
  const ids = ((data ?? []) as { id: string }[]).map((linha) => linha.id);
  if (ids.length > 0) {
    await supabase.from("audit_log").insert(
      ids.map((id) => ({
        clinic_id: quem.clinicId,
        user_id: quem.userId,
        action: "excluiu_mensagem_agendada",
        entity: "mensagem_agendada",
        entity_id: id,
      })),
    );
  }
  return { ok: true, canceladas: ids.length };
}
