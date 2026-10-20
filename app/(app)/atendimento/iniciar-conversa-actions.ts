"use server";

import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import {
  DICA_SEM_PERMISSAO_PARA_INICIAR,
  dicaParaIniciarConversa,
  MENSAGEM_CONVERSA_COM_OUTRA_PESSOA,
  MENSAGEM_SEM_AUTORIZACAO_PARA_INICIAR,
  MENSAGEM_SEM_NUMERO_PARA_INICIAR,
  mensagemDeNumeroDesconectado,
  numeroConectado,
  numeroPadraoParaIniciar,
  podeIniciarConversa,
  TEXTO_MAXIMO_DA_PRIMEIRA_MENSAGEM,
  type NumeroParaIniciar,
} from "@/lib/domain/iniciar-conversa";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { assumirConversaAction, enviarComoAtendente } from "./actions";

// "Iniciar conversa" (decisao do dono em 20/10/2026): a primeira mensagem
// para quem nunca escreveu, pela gaveta de Leads e pela ficha do paciente.
// Os botoes de criar contato continuam em Leads; aqui so nasce a conversa.
//
// A ORDEM e a garantia:
//   1. papel (Atendimento E Leads e pacientes editaveis) e Zod;
//   2. contato da clinica ativa e autorizacao VIGENTE (consentimento_vigente,
//      pela sessao), ANTES de qualquer escrita: sem ela, recusa com a frase
//      e NADA e gravado (nem conversa, nem tentativa na trilha);
//   3. o numero escolhido (ativo, desta clinica e conectado; sem escolha, o
//      principal, ou o primeiro conectado). Conferir a conexao aqui evita
//      abrir conversa que nao vai ter mensagem;
//   4. a conversa aberta DAQUELE numero (garantir_conversa_aberta, so
//      service role: acha a aberta ou abre uma, como o motor faz em
//      lib/jobs/worker.ts). Ja existindo, a mensagem cai nela; se ela esta
//      em atendimento com outra pessoa, recusa e devolve a conversa, em vez
//      de tirar o atendimento de um colega;
//   5. a conversa fica com quem iniciou pelo MESMO caminho do botao Assumir
//      (assumirConversaAction: evento na conversa, trilha e o lead novo
//      andando para "Em contato");
//   6. o envio pelo MESMO caminho da resposta digitada (enviarComoAtendente:
//      confere a autorizacao de novo, grava o custo e sai pelo numero da
//      conversa);
//   7. a trilha 'iniciou_conversa' (so ids, nunca telefone nem texto).
//
// Falha depois do passo 4 devolve o id da conversa: ela ja existe, e a tela
// oferece abri-la para tentar de novo pelo Atendimento.

const iniciarConversaSchema = z.object({
  contact_id: z.uuid(),
  whatsapp_account_id: z.uuid().optional(),
  texto: z.string().trim().min(1).max(TEXTO_MAXIMO_DA_PRIMEIRA_MENSAGEM),
});

export type IniciarConversaResult =
  | { ok: true; conversationId: string }
  | {
      ok: false;
      error: string;
      /** A conversa que ja existe (ou acabou de nascer): a tela leva ate ela. */
      conversationId?: string;
    };

export async function iniciarConversaAction(
  input: unknown,
): Promise<IniciarConversaResult> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: "Sessão expirada. Entre de novo." };
  }
  const { clinicId, role } = context.active;
  if (!podeIniciarConversa(role)) {
    return {
      ok: false,
      error: dicaParaIniciarConversa(role) ?? DICA_SEM_PERMISSAO_PARA_INICIAR,
    };
  }
  const parsed = iniciarConversaSchema.safeParse(input);
  if (!parsed.success) {
    const doTexto = parsed.error.issues.find(
      (issue) => issue.path[0] === "texto",
    );
    return {
      ok: false,
      error:
        doTexto?.code === "too_big"
          ? "A mensagem ficou longa demais."
          : doTexto
            ? "Escreva a mensagem antes de enviar."
            : "Confira os dados da conversa.",
    };
  }
  const { contact_id: contactId, texto } = parsed.data;
  const supabase = await createClient();

  // 2. Contato desta clinica e autorizacao vigente, com a SESSAO (a RLS
  // recorta; a funcao responde "sem" para clinica de fora).
  const { data: contato, error: erroDoContato } = await supabase
    .from("contact")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("id", contactId)
    .maybeSingle();
  if (erroDoContato) {
    return {
      ok: false,
      error: "Não foi possível conferir o contato. Tente de novo.",
    };
  }
  if (!contato) {
    return { ok: false, error: "Contato não encontrado nesta clínica." };
  }
  const { data: vigente, error: erroDaAutorizacao } = await supabase.rpc(
    "consentimento_vigente",
    {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
      p_channel: "whatsapp",
    },
  );
  if (erroDaAutorizacao) {
    return {
      ok: false,
      error: "Não foi possível conferir a autorização. Tente de novo.",
    };
  }
  if (vigente !== true) {
    return { ok: false, error: MENSAGEM_SEM_AUTORIZACAO_PARA_INICIAR };
  }

  // 3. O numero: so os ATIVOS desta clinica (removido nao e opcao de nada).
  const { data: numerosLidos, error: erroDosNumeros } = await supabase
    .from("whatsapp_account")
    .select("id, nome, connection_status, principal")
    .eq("clinic_id", clinicId)
    .is("removido_em", null)
    .order("principal", { ascending: false })
    .order("created_at", { ascending: true });
  if (erroDosNumeros) {
    return {
      ok: false,
      error: "Não foi possível conferir os números da clínica. Tente de novo.",
    };
  }
  const numeros = (numerosLidos ?? []) as NumeroParaIniciar[];
  if (numeros.length === 0) {
    return { ok: false, error: MENSAGEM_SEM_NUMERO_PARA_INICIAR };
  }
  const pedido = parsed.data.whatsapp_account_id;
  const numero = pedido
    ? (numeros.find((candidato) => candidato.id === pedido) ?? null)
    : numeroPadraoParaIniciar(numeros);
  if (!numero) {
    return {
      ok: false,
      error:
        "Este número não está mais ativo na clínica. Escolha outro número.",
    };
  }
  if (!numeroConectado(numero)) {
    return {
      ok: false,
      error: mensagemDeNumeroDesconectado(numero, numeros.length > 1),
    };
  }

  // 4. A conversa aberta deste numero (acha ou abre). So o service role
  // executa a funcao; tudo o que ela recebe ja foi conferido acima.
  const { data: garantida, error: erroDaConversa } =
    await createAdminClient().rpc("garantir_conversa_aberta", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
      p_whatsapp_account_id: numero.id,
    });
  if (erroDaConversa || typeof garantida !== "string") {
    return {
      ok: false,
      error: "Não foi possível abrir a conversa. Tente de novo.",
    };
  }
  const conversationId = garantida;

  // Ja em atendimento com um colega: nao tira a conversa dele.
  const { data: conversa } = await supabase
    .from("conversation")
    .select("status, assignee_user_id")
    .eq("clinic_id", clinicId)
    .eq("id", conversationId)
    .maybeSingle();
  const situacao = conversa as {
    status: string;
    assignee_user_id: string | null;
  } | null;
  if (
    situacao?.status === "em_atendimento" &&
    situacao.assignee_user_id !== null &&
    situacao.assignee_user_id !== context.userId
  ) {
    return {
      ok: false,
      error: MENSAGEM_CONVERSA_COM_OUTRA_PESSOA,
      conversationId,
    };
  }

  // 5. Com quem iniciou, pelo caminho do Assumir.
  const assumida = await assumirConversaAction(conversationId);
  if (!assumida.ok) {
    return {
      ok: false,
      error:
        assumida.error ??
        "Não foi possível ficar com a conversa. Tente de novo.",
      conversationId,
    };
  }

  // 6. A mensagem, pelo caminho da resposta digitada.
  const envio = await enviarComoAtendente(conversationId, texto);
  if (!envio.ok) {
    return {
      ok: false,
      error: envio.error ?? "A mensagem não saiu. Tente de novo pela conversa.",
      conversationId,
    };
  }

  // 7. Trilha: quem iniciou e qual conversa. Nunca o telefone nem o texto.
  await supabase.from("audit_log").insert({
    clinic_id: clinicId,
    user_id: context.userId,
    action: "iniciou_conversa",
    entity: "conversation",
    entity_id: conversationId,
  });
  return { ok: true, conversationId };
}
