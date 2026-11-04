"use server";

import { revalidatePath } from "next/cache";

import {
  agenteDaClinicaSchema,
  contaDaClinicaSchema,
  escreverNotaSchema,
  ESCOPO_DO_REQUISITO,
  excluirNotaSchema,
  interruptorGeralSchema,
  MOTIVO_PADRAO_DO_AGENTE,
  registrarRequisitoSchema,
  requisitosDoHint,
  revogarRequisitoSchema,
  tetoDaIaSchema,
  TEXTOS_DO_PAINEL,
} from "@/components/painel-geral/painel-geral";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

// Acoes do Painel geral (onda 1, decisao do dono de 20/10/2026): suspender e
// reativar a conta de uma clinica, ligar o agente em teste ou desligar, e
// ajustar o teto de gasto da IA. So a equipe Conduzza (super admin).
//
// Onda 2 (item 11, decisoes P11a a P11e, e P8): a producao do agente (so a
// partir de Teste, com motivo obrigatorio e todos os requisitos cumpridos:
// o banco recusa com P0001 requisitos_pendentes e as chaves no hint),
// registrar e revogar os requisitos da equipe Conduzza (migration
// 20261022120000) e o interruptor geral, que saiu da aba da clinica e mora
// no topo da lista.
//
// Acompanhamento de cliente (26/10/2026): o "Liberar agente" (Teste) e o
// "Retirar agente" (Desligado) da linha da lista sao esta mesma
// definirAgenteDaClinicaAction, com o mesmo dialogo do detalhe; nenhuma
// acao nova. Desde a revisao do mesmo dia, ela manda tambem o estado que a
// tela mostrava (estadoVisto) e chama definir_agente_da_clinica_no_painel
// (migration 20261026100000), que confere se ele ainda e o de agora antes
// de chamar definir_agente_da_clinica: uma lista velha (outra aba) nao
// rebaixa mais a Producao para Teste nem passa por cima da escolha da
// clinica ("So simulador", desligado); recusa com agente_mudou.
//
// A AUTORIZACAO VIVE NO BANCO: cada acao e uma RPC do contrato da onda 1
// (migration 20261021100000_painel_geral.sql), chamada com a SESSAO, que
// recusa (42501) quem nao e is_product_admin() e grava a trilha (audit_log,
// com o motivo nos detalhes) na mesma transacao. A guarda daqui e a segunda
// camada (CLAUDE.md 3.4: esconder botao nao protege nada): sem sessao ou sem
// super admin, nada chega ao banco.
//
// Segunda leva (26/10/2026, escolha (6) do dono): escrever e excluir as
// notas internas da equipe Conduzza (escrever_nota_da_clinica e
// excluir_nota_da_clinica, da migration 20261026110000; a exclusao so da
// propria nota, conferida no banco: 42501 nota_de_outra_pessoa). O texto
// da nota nunca vai para log.
//
// Toda funcao exportada de um arquivo "use server" vira endpoint: cada uma
// confere por si (sessao, super admin e Zod estrito na entrada). Nada daqui
// vai para log alem do codigo do erro, da clinica e do tipo de acao: nunca
// o motivo nem a nota (texto livre).

export type ResultadoDoPainel =
  { ok: true; jobsVencidos?: number } | { ok: false; error: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;
type ErroDoBanco = { code?: string; message?: string; hint?: string } | null;

/** null: pode seguir. */
async function guarda(): Promise<{ error: string } | null> {
  const context = await getSessionContext();
  if (!context) {
    return { error: TEXTOS_DO_PAINEL.sessaoExpirada };
  }
  if (!context.isProductAdmin) {
    return { error: TEXTOS_DO_PAINEL.soEquipeConduzza };
  }
  return null;
}

/** As chaves que as RPCs da onda 1 levantam (a mensagem do erro). */
const TEXTO_DA_CHAVE = new Map<string, (kind: string) => string>([
  ["clinica_ja_suspensa", () => TEXTOS_DO_PAINEL.jaSuspensa],
  ["clinica_nao_suspensa", () => TEXTOS_DO_PAINEL.jaAtiva],
  ["clinica_de_teste", () => TEXTOS_DO_PAINEL.agenteDeTesteRecusado],
  // Ligar em teste a clinica suspensa, ou mudar o teto com a liberacao
  // ligada na clinica suspensa.
  [
    "clinica_suspensa",
    (kind) =>
      kind === "teto"
        ? TEXTOS_DO_PAINEL.suspensaNaoMudaOTeto
        : TEXTOS_DO_PAINEL.suspensaNaoLigaOAgente,
  ],
  ["sem_liberacao", () => TEXTOS_DO_PAINEL.tetoSemLinha],
  ["motivo_invalido", () => TEXTOS_DO_PAINEL.motivoInvalido],
  ["teto_invalido", () => TEXTOS_DO_PAINEL.tetoInvalido],
  ["respostas_invalidas", () => TEXTOS_DO_PAINEL.respostasInvalidas],
  // Antes da migration da producao, o banco so aceita desligado e teste.
  ["estado_invalido", () => TEXTOS_DO_PAINEL.producaoRecusada],
  // A tela mostrava um estado do agente que nao e mais o de agora
  // (definir_agente_da_clinica_no_painel): nada mudou.
  ["agente_mudou", () => TEXTOS_DO_PAINEL.agenteMudou],
  // O pedido e o estado que a tela ja mostrava: so com a tela mexida.
  ["mudanca_invalida", () => TEXTOS_DO_PAINEL.dadosInvalidos],
  ["evidencia_invalida", () => TEXTOS_DO_PAINEL.evidenciaInvalida],
  ["requisito_ja_revogado", () => TEXTOS_DO_PAINEL.requisitoJaRevogado],
  // A chave que o banco nao conhece e o termo sem clinica: a tela manda as
  // chaves e o escopo do contrato, entao so com a tela velha ou mexida.
  ["chave_invalida", () => TEXTOS_DO_PAINEL.dadosInvalidos],
  ["requisito_por_clinica", () => TEXTOS_DO_PAINEL.dadosInvalidos],
  // As notas (segunda leva): o texto fora da faixa (o Zod ja recusa antes)
  // e a nota de outra pessoa (so quem escreveu exclui).
  ["texto_invalido", () => TEXTOS_DO_PAINEL.notaInvalida],
  ["nota_invalida", () => TEXTOS_DO_PAINEL.notaInvalida],
  ["nota_de_outra_pessoa", () => TEXTOS_DO_PAINEL.soQuemEscreveuExclui],
]);

/**
 * O erro do banco em texto de recepcionista, conforme a acao (contrato na
 * migration 20261021100000): 42501 e a permissao (so a equipe Conduzza);
 * P0002, a clinica que nao existe mais; P0001 e 22023 trazem a chave na
 * mensagem (clinica_ja_suspensa, clinica_suspensa, teto_invalido...). O
 * resto, o texto generico da acao.
 */
function textoDoErro(kind: string, error: ErroDoBanco, outro: string): string {
  const codigo = error?.code;
  if (codigo === "42501") {
    // Excluir a nota: a guarda daqui ja conferiu a equipe Conduzza, entao a
    // recusa do banco e a nota de outra pessoa.
    return kind === "excluir_nota"
      ? TEXTOS_DO_PAINEL.soQuemEscreveuExclui
      : TEXTOS_DO_PAINEL.soEquipeConduzza;
  }
  if (codigo === "P0002") {
    // Revogar: o registro sumiu (P0002 de revogar_requisito_da_producao);
    // excluir a nota: a nota sumiu.
    if (kind === "revogar") {
      return TEXTOS_DO_PAINEL.requisitoNaoEncontrado;
    }
    return kind === "excluir_nota"
      ? TEXTOS_DO_PAINEL.notaNaoEncontrada
      : TEXTOS_DO_PAINEL.clinicaNaoEncontrada;
  }
  const chave = (error?.message ?? "").trim();
  // A producao com requisito faltando (onda 2): o banco manda as chaves no
  // hint; a tela diz quais, em nomes.
  if (chave === "requisitos_pendentes") {
    const faltam = requisitosDoHint(error?.hint);
    return faltam
      ? TEXTOS_DO_PAINEL.requisitosPendentes(faltam.join("; "))
      : TEXTOS_DO_PAINEL.requisitosPendentesSemLista;
  }
  const texto = TEXTO_DA_CHAVE.get(chave);
  return texto ? texto(kind) : outro;
}

function falhou(
  clinicId: string,
  kind: string,
  error: ErroDoBanco,
  texto: string,
): ResultadoDoPainel {
  log.warn("painel_geral_nao_alterou", {
    clinic_id: clinicId,
    kind,
    error_code: error?.code ?? null,
  });
  return { ok: false, error: textoDoErro(kind, error, texto) };
}

/**
 * A lista e o detalhe mostram o que mudou, e a aba WhatsApp da Tela 6 da
 * clinica tambem (o estado do agente e o modo aparecem la).
 */
function revalidarPainel() {
  revalidatePath("/painel-geral", "layout");
  revalidatePath("/agente");
}

/** O jobs_vencidos de reativar_clinica; formato estranho vira nulo. */
function jobsVencidosDoBanco(valor: unknown): number | undefined {
  if (typeof valor !== "object" || valor === null) {
    return undefined;
  }
  const n = (valor as { jobs_vencidos?: unknown }).jobs_vencidos;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Suspende a conta da clinica, mantendo os dados (decisao do dono de
 * 20/10/2026). O banco grava a suspensao, devolve as conversas do agente
 * para a equipe e grava a trilha com o motivo.
 */
export async function suspenderClinicaAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = contaDaClinicaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: textoDaEntrada(parsed.error.issues) };
  }
  const { clinicId, motivo } = parsed.data;
  const supabase: Supabase = await createClient();
  const { error } = await supabase.rpc("suspender_clinica", {
    p_clinic_id: clinicId,
    p_motivo: motivo,
  });
  if (error) {
    return falhou(clinicId, "suspender", error, TEXTOS_DO_PAINEL.naoSuspendeu);
  }
  revalidarPainel();
  return { ok: true };
}

/**
 * Reativa a conta. O banco apaga a suspensao, cancela as mensagens
 * automaticas que venceram durante ela (as futuras continuam) e devolve
 * quantas, que a tela conta no aviso.
 */
export async function reativarClinicaAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = contaDaClinicaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: textoDaEntrada(parsed.error.issues) };
  }
  const { clinicId, motivo } = parsed.data;
  const supabase: Supabase = await createClient();
  const { data, error } = await supabase.rpc("reativar_clinica", {
    p_clinic_id: clinicId,
    p_motivo: motivo,
  });
  if (error) {
    return falhou(clinicId, "reativar", error, TEXTOS_DO_PAINEL.naoReativou);
  }
  revalidarPainel();
  const jobsVencidos = jobsVencidosDoBanco(data);
  return jobsVencidos === undefined ? { ok: true } : { ok: true, jobsVencidos };
}

/**
 * Liga o agente da clinica em teste, em producao, ou desliga
 * (ia_clinica_habilitada, pela RPC). Producao (onda 2, item 11): motivo
 * obrigatorio (3 a 300, conferido aqui e no banco), so a partir de Teste e
 * com todos os requisitos cumpridos; o banco confere tudo de novo e recusa
 * com P0001 requisitos_pendentes (as chaves no hint). Antes da migration da
 * producao, o banco recusa o estado (22023 estado_invalido) e a tela diz
 * que a producao ainda nao esta liberada. De Producao para Teste, o banco
 * volta ao modo dos telefones da equipe e devolve as outras conversas para
 * a equipe, sem mensagem ao paciente.
 *
 * O estado que a tela mostrava (estadoVisto) vai junto: com as travas de
 * definir_agente_da_clinica, o banco confere se ele ainda e o de agora e,
 * se mudou, recusa sem mudar nada (P0001 agente_mudou; a tela pede para
 * recarregar). Pedir o mesmo estado que a tela mostrava o Zod ja recusa.
 */
export async function definirAgenteDaClinicaAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = agenteDaClinicaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: textoDaEntrada(parsed.error.issues) };
  }
  const { clinicId, estadoVisto, estado, motivo } = parsed.data;
  const supabase: Supabase = await createClient();
  const { error } = await supabase.rpc("definir_agente_da_clinica_no_painel", {
    p_clinic_id: clinicId,
    p_estado_visto: estadoVisto,
    p_estado: estado,
    p_motivo: motivo ? motivo : MOTIVO_PADRAO_DO_AGENTE,
  });
  if (error) {
    return falhou(clinicId, "agente", error, TEXTOS_DO_PAINEL.naoMudouOAgente);
  }
  revalidarPainel();
  // O aviso de onde o assistente mora (aba WhatsApp de Configuracoes)
  // aparece e some com o estado.
  revalidatePath("/configuracoes");
  return { ok: true };
}

/**
 * Registra um requisito da producao da equipe Conduzza (onda 2, item 11):
 * a chave, a evidencia (3 a 500, o que prova e onde esta guardado) e para
 * quem vale (o termo, so a clinica da tela; os outros, todas as clinicas,
 * ESCOPO_DO_REQUISITO). A RPC e so do super admin e grava a trilha
 * registrou_requisito_da_producao. Nada daqui vai para log alem do codigo
 * do erro, da clinica e do tipo (nunca a evidencia).
 */
export async function registrarRequisitoDaProducaoAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = registrarRequisitoSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: textoDaEntrada(parsed.error.issues) };
  }
  const { clinicId, chave, evidencia } = parsed.data;
  const supabase: Supabase = await createClient();
  const { error } = await supabase.rpc("registrar_requisito_da_producao", {
    p_chave: chave,
    p_clinic_id: ESCOPO_DO_REQUISITO[chave] === "clinica" ? clinicId : null,
    p_evidencia: evidencia,
  });
  if (error) {
    return falhou(clinicId, "requisito", error, TEXTOS_DO_PAINEL.naoRegistrou);
  }
  revalidarPainel();
  return { ok: true };
}

/**
 * Revoga um registro de requisito da producao (onda 2, item 11, P11c), com
 * o motivo obrigatorio (3 a 300). O banco grava a trilha
 * revogou_requisito_da_producao e, no requisito que vale para todas as
 * clinicas, devolve a Teste as que estao em producao (falha fechada).
 */
export async function revogarRequisitoDaProducaoAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = revogarRequisitoSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: textoDaEntrada(parsed.error.issues) };
  }
  const { clinicId, id, motivo } = parsed.data;
  const supabase: Supabase = await createClient();
  const { error } = await supabase.rpc("revogar_requisito_da_producao", {
    p_id: id,
    p_motivo: motivo,
  });
  if (error) {
    return falhou(clinicId, "revogar", error, TEXTOS_DO_PAINEL.naoRevogou);
  }
  revalidarPainel();
  return { ok: true };
}

/**
 * O interruptor geral (todas as clinicas), no topo do Painel geral desde a
 * onda 2 (P8; antes, na aba Agente de IA de Configuracoes). So o super
 * admin, aqui e no banco (definir_interruptor_da_ia). Desligar devolve
 * todas as conversas da IA para a equipe, sem enviar nada. Nao depende da
 * clinica ativa de quem chama.
 */
export async function definirInterruptorGeralAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = interruptorGeralSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS_DO_PAINEL.dadosInvalidos };
  }
  const supabase: Supabase = await createClient();
  const { error } = await supabase.rpc("definir_interruptor_da_ia", {
    p_ligado: parsed.data.ligado,
    p_motivo: MOTIVO_PADRAO_DO_AGENTE,
  });
  if (error) {
    log.warn("ia_interruptor_nao_alterado", {
      kind: parsed.data.ligado ? "ligar" : "desligar",
      error_code: error.code ?? null,
    });
    return {
      ok: false,
      error:
        error.code === "42501"
          ? TEXTOS_DO_PAINEL.soEquipeConduzza
          : TEXTOS_DO_PAINEL.interruptorNaoAlterou,
    };
  }
  revalidarPainel();
  return { ok: true };
}

/**
 * O teto diario (centavos de dolar, janela movel de 24 horas) e as
 * respostas por conversa por hora. A tela le os dolares e manda centavos.
 */
export async function definirTetoDaIaAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = tetoDaIaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: textoDaEntrada(parsed.error.issues) };
  }
  const { clinicId, tetoDiarioCentavos, respostasPorConversaHora } =
    parsed.data;
  const supabase: Supabase = await createClient();
  const { error } = await supabase.rpc("definir_teto_da_ia", {
    p_clinic_id: clinicId,
    p_teto_diario_centavos_usd: tetoDiarioCentavos,
    p_teto_respostas_por_conversa_hora: respostasPorConversaHora,
  });
  if (error) {
    return falhou(clinicId, "teto", error, TEXTOS_DO_PAINEL.naoMudouOTeto);
  }
  revalidarPainel();
  revalidatePath("/configuracoes");
  return { ok: true };
}

/**
 * Escreve uma nota interna da equipe Conduzza sobre a clinica (segunda
 * leva): o texto de 1 a 2.000 caracteres (conferido aqui e no banco). O
 * banco grava a nota com o autor e a data e a trilha. O texto nunca vai
 * para log.
 */
export async function escreverNotaDaClinicaAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = escreverNotaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: textoDaEntrada(parsed.error.issues) };
  }
  const { clinicId, texto } = parsed.data;
  const supabase: Supabase = await createClient();
  const { error } = await supabase.rpc("escrever_nota_da_clinica", {
    p_clinic_id: clinicId,
    p_texto: texto,
  });
  if (error) {
    return falhou(clinicId, "nota", error, TEXTOS_DO_PAINEL.naoSalvouANota);
  }
  revalidatePath("/painel-geral", "layout");
  return { ok: true };
}

/**
 * Exclui uma nota interna (segunda leva): so a propria, e o banco confere
 * (a nota de outra pessoa e recusada sem mudar nada). A exclusao fica no
 * historico da conta.
 */
export async function excluirNotaDaClinicaAction(
  entrada: unknown,
): Promise<ResultadoDoPainel> {
  const recusa = await guarda();
  if (recusa) {
    return { ok: false, error: recusa.error };
  }
  const parsed = excluirNotaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS_DO_PAINEL.dadosInvalidos };
  }
  const { clinicId, notaId } = parsed.data;
  const supabase: Supabase = await createClient();
  const { error } = await supabase.rpc("excluir_nota_da_clinica", {
    p_nota_id: notaId,
  });
  if (error) {
    return falhou(
      clinicId,
      "excluir_nota",
      error,
      TEXTOS_DO_PAINEL.naoExcluiuANota,
    );
  }
  revalidatePath("/painel-geral", "layout");
  return { ok: true };
}

/**
 * Os campos cujas mensagens do Zod sao textos nossos (painel-geral.ts): o
 * motivo, a evidencia, o teto e o texto da nota. Nos outros (a chave do requisito, o estado),
 * a mensagem padrao do Zod nao e de recepcao: "Dados inválidos".
 */
const CAMPOS_COM_TEXTO_PROPRIO = new Set([
  "motivo",
  "evidencia",
  "tetoDiarioCentavos",
  "respostasPorConversaHora",
  "texto",
]);

/**
 * O problema da entrada em texto de recepcao: a mensagem do campo quando o
 * Zod tem uma nossa (motivo curto, evidencia fora da faixa, teto fora da
 * faixa); tipo errado, campo a mais ou campo sem texto proprio, "Dados
 * inválidos".
 */
function textoDaEntrada(
  issues: readonly { code: string; path: PropertyKey[]; message: string }[],
): string {
  const problema = issues[0];
  if (
    problema &&
    problema.code !== "invalid_type" &&
    problema.code !== "unrecognized_keys" &&
    problema.path.length > 0 &&
    CAMPOS_COM_TEXTO_PROPRIO.has(String(problema.path[0]))
  ) {
    return problema.message;
  }
  return TEXTOS_DO_PAINEL.dadosInvalidos;
}
