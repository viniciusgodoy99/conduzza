"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  carregarCatalogoDoAgente,
  carregarConfigDoRascunho,
} from "@/lib/agente/contexto";
import type { PassoDoTurno } from "@/lib/agente/laco";
import { agoraNaClinica, previaDoPrompt } from "@/lib/agente/prompt";
import { simularTurno } from "@/lib/agente/simulador";
import { getSessionContext } from "@/lib/auth/active-clinic";
import {
  diferencasDoRascunho,
  habilidadesSchema,
  horarioParaOBanco,
  horarioSchema,
  instrucoesSchema,
  itemDaBaseSchema,
  LIMITES_DO_AGENTE,
  personaParaOBanco,
  personaSchema,
  problemaNoTextoDoAgente,
  problemasDaPublicacao,
  problemasParaQuemPublica,
  ROTULO_DO_CAMPO_DE_TEXTO,
  textoDoProblemaDaPublicacao,
  type CampoDeTextoDoAgente,
  type ProblemaDaPublicacao,
} from "@/lib/domain/agente/config";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { log } from "@/lib/log";
import { abaDaIaVisivel } from "@/lib/queries/ia-liberacao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Server Actions da Tela 6 (Agente de IA), especificacao de 06/10/2026,
// secao 3. Contrato do banco na migration 20261006150000_tela_do_agente.sql.
//
// Guarda em TODA acao (toda funcao exportada de um arquivo "use server" vira
// endpoint): sessao, clinica da fase controlada (abaDaIaVisivel, a mesma
// decisao da pagina) e papel (administrador ou gestor, ou o super admin).
// O banco confere de novo: RLS, o gatilho agente_so_na_fase_controlada e as
// guardas das RPCs (CLAUDE.md 3.4: esconder botao nao protege nada).
//
// Escrita:
//  - configuracao: pela SESSAO, sempre no rascunho, que
//    garantir_rascunho_do_agente cria quando falta (versao calculada no
//    banco); instrucoes so pela RPC do super admin;
//  - base viva (knowledge_item): pela sessao; editar a base tambem garante o
//    rascunho (a mudanca so vale ao publicar);
//  - publicar: o filtro do CFM roda AQUI em tudo que a versao leva (nome,
//    saudacao, encerramento, instrucoes e cada pergunta e resposta ativa) e
//    so depois a RPC publicar_agente, que e SO da service role, recebe o
//    autor da sessao e o instante do que foi conferido (p_conferido_em: se
//    o rascunho ou a base mudou depois, ela recusa com CZ409). Problema nas
//    instrucoes so aparece com o tipo para o super admin;
//  - texto da clinica passa por problemaNoTextoDoAgente ao salvar (a tela
//    ja confere antes; aqui e a segunda vez, porque o cliente nao e
//    confiavel).
// Trilha: audit_log sem texto nenhum (so a acao, a entidade e o id); as
// RPCs gravam a propria. Log so com clinica, tipo da acao e codigo do erro.

export type ResultadoDoAgente = { ok: true } | { ok: false; error: string };

export type ResultadoDoItemDaBase =
  { ok: true; id: string } | { ok: false; error: string };

export type ResultadoDaPublicacaoDoAgente =
  | { ok: true; versao: number }
  | { ok: false; error: string; problemas?: ProblemaDaPublicacao[] };

export type ResultadoDaSimulacaoDoAgente =
  | {
      ok: true;
      resposta: string;
      tipo: "resposta" | "frase_fixa";
      trilha: PassoDoTurno[];
      /** O que o filtro barrou: so para o super admin (nulo para os outros). */
      rascunhoBloqueado: string | null;
      /**
       * A assinatura desta resposta: a tela guarda e manda de volta na fala
       * do assistente ({ autor: "assistente", texto, assinatura }).
       */
      assinatura: string;
    }
  | { ok: false; error: string };

export type ResultadoDaPrevia =
  { ok: true; texto: string } | { ok: false; error: string };

const TEXTOS = {
  sessaoExpirada: "Sessão expirada. Entre de novo.",
  foraDaFase: "O assistente de IA ainda não está disponível nesta clínica.",
  semPermissao: "Somente administradores e gestores alteram o agente de IA",
  soEquipeConduzza:
    "Somente a equipe Conduzza mexe nas instruções do assistente.",
  dadosInvalidos: "Dados inválidos. Recarregue a página e tente de novo.",
  naoSalvou: "Não foi possível salvar. Tente de novo.",
  corrida:
    "O agente de IA foi alterado ao mesmo tempo por outra pessoa. Recarregue a página e tente de novo.",
  publicadaNaoMuda:
    "Esta versão já foi publicada e não muda. Recarregue a página.",
  tamanho: "Algum texto passou do tamanho permitido.",
  itemSumiu: "Esta pergunta não existe mais. Recarregue a página.",
  baseCheia: `A base já tem ${LIMITES_DO_AGENTE.itensDaBase} perguntas ativas. Desative ou exclua uma antes de ativar outra.`,
  semAlteracoes: "Não há alterações para publicar.",
  versaoNaoEncontrada: "Versão não encontrada. Recarregue a página.",
  naoPublicou: "Não foi possível publicar. Tente de novo.",
  naoRestaurou: "Não foi possível restaurar esta versão. Tente de novo.",
  naoLeu:
    "Não foi possível carregar a configuração do assistente. Recarregue a página e tente de novo.",
  naoSimulou: "Não foi possível testar agora. Tente de novo.",
  ultimaDoPaciente: "A última mensagem do teste precisa ser do paciente.",
  mudouAoPublicar:
    "O agente mudou enquanto você publicava. Confira e publique de novo.",
} as const;

const PAGINA_DO_AGENTE = "/agente";

/** Os cenarios do simulador (components/agente/textos.ts; teste confere). */
const CENARIOS = ["preco", "agendar", "sintoma", "irritado"] as const;

/** Teto de uma fala no simulador (o portao escala acima de 1.000). */
const CARACTERES_POR_FALA = 4000;
/** Teto de falas por rodada do simulador. */
const FALAS_POR_RODADA = 40;

const idSchema = z.object({ id: z.uuid() }).strict();
const ativarSchema = z.object({ id: z.uuid(), ativo: z.boolean() }).strict();
const versaoSchema = z
  .object({ versao: z.number().int().positive().max(1_000_000) })
  .strict();
const simulacaoSchema = z
  .object({
    mensagens: z
      .array(
        z
          .object({
            autor: z.enum(["paciente", "assistente"]),
            texto: z.string().trim().min(1).max(CARACTERES_POR_FALA),
            /** A do servidor, nas falas do assistente (lib/agente/assinatura). */
            assinatura: z.string().max(100).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(FALAS_POR_RODADA),
    cenario: z.enum(CENARIOS).nullable().optional(),
  })
  .strict();

type Quem = {
  userId: string;
  clinicId: string;
  timezone: string;
  superAdmin: boolean;
};

/**
 * Sessao, clinica da fase controlada e quem configura: administrador ou
 * gestor da clinica ativa, ou o super admin. Recepcao recebe a dica de
 * permissao; profissional e leitura nem chegam a tela (guarda da rota).
 */
async function exigirQuemConfigura(): Promise<Quem | { error: string }> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: TEXTOS.sessaoExpirada };
  }
  const { clinicId, role, timezone } = context.active;
  if (!abaDaIaVisivel(clinicId)) {
    return { error: TEXTOS.foraDaFase };
  }
  if (!context.isProductAdmin && !canEdit(role, "agente")) {
    return { error: permissionHint(role, "agente") ?? TEXTOS.semPermissao };
  }
  return {
    userId: context.userId,
    clinicId,
    timezone,
    superAdmin: context.isProductAdmin,
  };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;
type ErroDoBanco = { code?: string } | null;

/** O codigo do banco em texto de recepcionista. */
function textoDoErro(error: ErroDoBanco, outro: string): string {
  switch (error?.code) {
    case "42501":
      return TEXTOS.semPermissao;
    case "P0001":
      return TEXTOS.publicadaNaoMuda;
    case "CZ409":
    case "23505":
      return TEXTOS.corrida;
    case "23514":
      return TEXTOS.tamanho;
    default:
      return outro;
  }
}

function falhou(
  quem: Quem,
  kind: string,
  error: ErroDoBanco,
  outro: string,
): { ok: false; error: string } {
  log.warn("agente_config_nao_alterada", {
    clinic_id: quem.clinicId,
    kind,
    error_code: error?.code ?? null,
  });
  return { ok: false, error: textoDoErro(error, outro) };
}

/** A mensagem do zod quando e uma das nossas; senao, dados invalidos. */
function erroDaEntrada(erro: z.ZodError): string {
  const problema = erro.issues[0];
  return problema &&
    problema.code !== "invalid_type" &&
    problema.path.length > 0
    ? problema.message
    : TEXTOS.dadosInvalidos;
}

/** O primeiro problema do filtro entre os campos, com o rotulo do campo. */
function problemaNosCampos(
  campos: readonly [string | null, CampoDeTextoDoAgente][],
): string | null {
  for (const [texto, campo] of campos) {
    if (texto === null) {
      continue;
    }
    const mensagem = problemaNoTextoDoAgente(texto, campo);
    if (mensagem !== null) {
      return `${ROTULO_DO_CAMPO_DE_TEXTO[campo]}. ${mensagem}`;
    }
  }
  return null;
}

async function auditar(
  supabase: Supabase,
  quem: Quem,
  action: string,
  entity: "ai_agent_config" | "knowledge_item",
  entityId: string | null,
): Promise<void> {
  try {
    const { error } = await supabase.from("audit_log").insert({
      clinic_id: quem.clinicId,
      user_id: quem.userId,
      action,
      entity,
      entity_id: entityId,
    });
    if (error) {
      log.warn("agente_trilha_nao_gravada", {
        clinic_id: quem.clinicId,
        kind: action,
        error_code: error.code ?? null,
      });
    }
  } catch {
    log.warn("agente_trilha_nao_gravada", {
      clinic_id: quem.clinicId,
      kind: action,
      error_code: "desconhecida",
    });
  }
}

/** O rascunho da clinica (cria a partir da publicada quando falta). */
async function garantirRascunho(
  supabase: Supabase,
  clinicId: string,
): Promise<{ id: string } | { erro: ErroDoBanco }> {
  const { data, error } = await supabase.rpc("garantir_rascunho_do_agente", {
    p_clinic_id: clinicId,
  });
  if (error || typeof data !== "string") {
    return { erro: error ?? null };
  }
  return { id: data };
}

/**
 * Depois de escrever na base viva, garante o rascunho DE NOVO. Se alguem
 * publicou entre o garantir de antes e a escrita, ela caiu numa base sem
 * rascunho e nao contaria como alteracao ("sem rascunho", nada a publicar);
 * o garantir de agora cria o rascunho (copia da publicada) e a mudanca
 * passa a contar. Idempotente. Falha so vira log: a escrita ja aconteceu.
 */
async function garantirRascunhoDepoisDaBase(
  supabase: Supabase,
  quem: Quem,
  kind: string,
): Promise<void> {
  const rascunho = await garantirRascunho(supabase, quem.clinicId);
  if ("erro" in rascunho) {
    log.warn("agente_rascunho_depois_da_base", {
      clinic_id: quem.clinicId,
      kind,
      error_code: rascunho.erro?.code ?? null,
    });
  }
}

/** UPDATE no rascunho pela sessao; zero linhas = alguem publicou antes. */
async function gravarNoRascunho(
  supabase: Supabase,
  quem: Quem,
  kind: string,
  campos: Record<string, unknown>,
): Promise<ResultadoDoAgente> {
  const rascunho = await garantirRascunho(supabase, quem.clinicId);
  if ("erro" in rascunho) {
    return falhou(quem, `${kind}_rascunho`, rascunho.erro, TEXTOS.naoSalvou);
  }
  const { data, error } = await supabase
    .from("ai_agent_config")
    .update(campos)
    .eq("id", rascunho.id)
    .eq("clinic_id", quem.clinicId)
    .eq("status", "rascunho")
    .select("id");
  if (error) {
    return falhou(quem, kind, error, TEXTOS.naoSalvou);
  }
  if (!Array.isArray(data) || data.length === 0) {
    return falhou(quem, kind, null, TEXTOS.corrida);
  }
  await auditar(
    supabase,
    quem,
    `editou_${kind}_do_agente`,
    "ai_agent_config",
    rascunho.id,
  );
  revalidatePath(PAGINA_DO_AGENTE);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Persona, habilidades e horario
// ---------------------------------------------------------------------------

/** Nome, tom, emoji, saudacao e encerramento do rascunho. */
export async function salvarPersonaAction(
  entrada: unknown,
): Promise<ResultadoDoAgente> {
  const quem = await exigirQuemConfigura();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  const parsed = personaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: erroDaEntrada(parsed.error) };
  }
  const persona = parsed.data;
  const problema = problemaNosCampos([
    [persona.nome, "nome"],
    [persona.saudacao, "saudacao"],
    [persona.encerramento, "encerramento"],
  ]);
  if (problema !== null) {
    return { ok: false, error: problema };
  }
  const supabase = await createClient();
  return gravarNoRascunho(
    supabase,
    quem,
    "persona",
    personaParaOBanco(persona),
  );
}

/**
 * Habilidades do rascunho. Junta com o `skills` gravado: chave que esta
 * leva nao conhece (as de agenda do E4) nao se perde.
 */
export async function salvarHabilidadesAction(
  entrada: unknown,
): Promise<ResultadoDoAgente> {
  const quem = await exigirQuemConfigura();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  const parsed = habilidadesSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: erroDaEntrada(parsed.error) };
  }
  const supabase = await createClient();
  const rascunho = await garantirRascunho(supabase, quem.clinicId);
  if ("erro" in rascunho) {
    return falhou(
      quem,
      "habilidades_rascunho",
      rascunho.erro,
      TEXTOS.naoSalvou,
    );
  }
  const { data: atual, error: erroDaLeitura } = await supabase
    .from("ai_agent_config")
    .select("skills")
    .eq("id", rascunho.id)
    .eq("clinic_id", quem.clinicId)
    .maybeSingle();
  if (erroDaLeitura) {
    return falhou(quem, "habilidades_leitura", erroDaLeitura, TEXTOS.naoSalvou);
  }
  const gravado = (atual as { skills?: unknown } | null)?.skills;
  const existente =
    typeof gravado === "object" && gravado !== null && !Array.isArray(gravado)
      ? (gravado as Record<string, unknown>)
      : {};
  return gravarNoRascunho(supabase, quem, "habilidades", {
    skills: { ...existente, ...parsed.data },
  });
}

/** Modo de operacao, minutos de espera e expediente por dia do rascunho. */
export async function salvarHorarioAction(
  entrada: unknown,
): Promise<ResultadoDoAgente> {
  const quem = await exigirQuemConfigura();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  const parsed = horarioSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: erroDaEntrada(parsed.error) };
  }
  const supabase = await createClient();
  return gravarNoRascunho(
    supabase,
    quem,
    "horario",
    horarioParaOBanco(parsed.data),
  );
}

// ---------------------------------------------------------------------------
// Base de conhecimento (knowledge_item, a base viva)
// ---------------------------------------------------------------------------

/** Perguntas ativas da clinica, fora a de `exceto`. null = leitura falhou. */
async function ativasNaBase(
  supabase: Supabase,
  clinicId: string,
  exceto: string | null,
): Promise<number | null> {
  let consulta = supabase
    .from("knowledge_item")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("active", true);
  if (exceto !== null) {
    consulta = consulta.neq("id", exceto);
  }
  const { count, error } = await consulta;
  return error || typeof count !== "number" ? null : count;
}

/** Cria (id nulo) ou edita uma pergunta e resposta da base. */
export async function salvarItemDaBaseAction(
  entrada: unknown,
): Promise<ResultadoDoItemDaBase> {
  const quem = await exigirQuemConfigura();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  const parsed = itemDaBaseSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: erroDaEntrada(parsed.error) };
  }
  const item = parsed.data;
  const problema = problemaNosCampos([
    [item.pergunta, "pergunta"],
    [item.resposta, "resposta"],
  ]);
  if (problema !== null) {
    return { ok: false, error: problema };
  }
  const supabase = await createClient();
  if (item.ativo) {
    const ativas = await ativasNaBase(supabase, quem.clinicId, item.id);
    if (ativas === null) {
      return falhou(quem, "base_contagem", null, TEXTOS.naoSalvou);
    }
    if (ativas >= LIMITES_DO_AGENTE.itensDaBase) {
      return { ok: false, error: TEXTOS.baseCheia };
    }
  }
  const rascunho = await garantirRascunho(supabase, quem.clinicId);
  if ("erro" in rascunho) {
    return falhou(quem, "base_rascunho", rascunho.erro, TEXTOS.naoSalvou);
  }

  if (item.id === null) {
    const { data, error } = await supabase
      .from("knowledge_item")
      .insert({
        clinic_id: quem.clinicId,
        question: item.pergunta,
        answer: item.resposta,
        source: "manual",
        active: item.ativo,
      })
      .select("id")
      .single();
    const id = (data as { id?: unknown } | null)?.id;
    if (error || typeof id !== "string") {
      return falhou(quem, "base_criar", error, TEXTOS.naoSalvou);
    }
    await garantirRascunhoDepoisDaBase(supabase, quem, "base_criar");
    await auditar(supabase, quem, "criou_item_da_base", "knowledge_item", id);
    revalidatePath(PAGINA_DO_AGENTE);
    return { ok: true, id };
  }

  const { data, error } = await supabase
    .from("knowledge_item")
    .update({
      question: item.pergunta,
      answer: item.resposta,
      active: item.ativo,
    })
    .eq("id", item.id)
    .eq("clinic_id", quem.clinicId)
    .select("id");
  if (error) {
    return falhou(quem, "base_editar", error, TEXTOS.naoSalvou);
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, error: TEXTOS.itemSumiu };
  }
  await garantirRascunhoDepoisDaBase(supabase, quem, "base_editar");
  await auditar(
    supabase,
    quem,
    "editou_item_da_base",
    "knowledge_item",
    item.id,
  );
  revalidatePath(PAGINA_DO_AGENTE);
  return { ok: true, id: item.id };
}

/**
 * Ativa ou desativa uma pergunta. Ativar confere o texto no filtro de novo
 * (pode ter sido gravado antes de uma regra nova) e o teto de ativas.
 */
export async function ativarItemDaBaseAction(
  entrada: unknown,
): Promise<ResultadoDoAgente> {
  const quem = await exigirQuemConfigura();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  const parsed = ativarSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS.dadosInvalidos };
  }
  const { id, ativo } = parsed.data;
  const supabase = await createClient();

  if (ativo) {
    const { data: atual, error: erroDaLeitura } = await supabase
      .from("knowledge_item")
      .select("question, answer")
      .eq("id", id)
      .eq("clinic_id", quem.clinicId)
      .maybeSingle();
    if (erroDaLeitura) {
      return falhou(quem, "base_ler", erroDaLeitura, TEXTOS.naoSalvou);
    }
    const linha = atual as { question?: unknown; answer?: unknown } | null;
    if (
      linha === null ||
      typeof linha.question !== "string" ||
      typeof linha.answer !== "string"
    ) {
      return { ok: false, error: TEXTOS.itemSumiu };
    }
    const problema = problemaNosCampos([
      [linha.question, "pergunta"],
      [linha.answer, "resposta"],
    ]);
    if (problema !== null) {
      return { ok: false, error: problema };
    }
    const ativas = await ativasNaBase(supabase, quem.clinicId, id);
    if (ativas === null) {
      return falhou(quem, "base_contagem", null, TEXTOS.naoSalvou);
    }
    if (ativas >= LIMITES_DO_AGENTE.itensDaBase) {
      return { ok: false, error: TEXTOS.baseCheia };
    }
  }

  const rascunho = await garantirRascunho(supabase, quem.clinicId);
  if ("erro" in rascunho) {
    return falhou(quem, "base_rascunho", rascunho.erro, TEXTOS.naoSalvou);
  }
  const { data, error } = await supabase
    .from("knowledge_item")
    .update({ active: ativo })
    .eq("id", id)
    .eq("clinic_id", quem.clinicId)
    .select("id");
  if (error) {
    return falhou(quem, "base_ativar", error, TEXTOS.naoSalvou);
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, error: TEXTOS.itemSumiu };
  }
  await garantirRascunhoDepoisDaBase(supabase, quem, "base_ativar");
  await auditar(
    supabase,
    quem,
    ativo ? "ativou_item_da_base" : "desativou_item_da_base",
    "knowledge_item",
    id,
  );
  revalidatePath(PAGINA_DO_AGENTE);
  return { ok: true };
}

/** Exclui uma pergunta da base viva (a publicada guarda a dela). */
export async function excluirItemDaBaseAction(
  entrada: unknown,
): Promise<ResultadoDoAgente> {
  const quem = await exigirQuemConfigura();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  const parsed = idSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS.dadosInvalidos };
  }
  const supabase = await createClient();
  const rascunho = await garantirRascunho(supabase, quem.clinicId);
  if ("erro" in rascunho) {
    return falhou(quem, "base_rascunho", rascunho.erro, TEXTOS.naoSalvou);
  }
  const { data, error } = await supabase
    .from("knowledge_item")
    .delete()
    .eq("id", parsed.data.id)
    .eq("clinic_id", quem.clinicId)
    .select("id");
  if (error) {
    return falhou(quem, "base_excluir", error, TEXTOS.naoSalvou);
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, error: TEXTOS.itemSumiu };
  }
  await garantirRascunhoDepoisDaBase(supabase, quem, "base_excluir");
  await auditar(
    supabase,
    quem,
    "excluiu_item_da_base",
    "knowledge_item",
    parsed.data.id,
  );
  revalidatePath(PAGINA_DO_AGENTE);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Instrucoes do assistente (so a equipe Conduzza)
// ---------------------------------------------------------------------------

/** Grava as instrucoes no rascunho pela RPC (que grava a trilha). */
export async function salvarInstrucoesAction(
  entrada: unknown,
): Promise<ResultadoDoAgente> {
  const quem = await exigirQuemConfigura();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  if (!quem.superAdmin) {
    return { ok: false, error: TEXTOS.soEquipeConduzza };
  }
  const parsed = instrucoesSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: erroDaEntrada(parsed.error) };
  }
  const { instrucoes } = parsed.data;
  const problema = problemaNosCampos([[instrucoes, "instrucoes"]]);
  if (problema !== null) {
    return { ok: false, error: problema };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("definir_instrucoes_do_agente", {
    p_clinic_id: quem.clinicId,
    p_instrucoes: instrucoes,
  });
  if (error) {
    return falhou(
      quem,
      "instrucoes",
      error,
      error.code === "42501" ? TEXTOS.soEquipeConduzza : TEXTOS.naoSalvou,
    );
  }
  revalidatePath(PAGINA_DO_AGENTE);
  return { ok: true };
}

/** A "Prévia do prompt" do rascunho (so super admin, somente leitura). */
export async function previaDoPromptAction(): Promise<ResultadoDaPrevia> {
  const quem = await exigirQuemConfigura();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  if (!quem.superAdmin) {
    return { ok: false, error: TEXTOS.soEquipeConduzza };
  }
  try {
    const admin = createAdminClient();
    const [contexto, catalogo] = await Promise.all([
      carregarConfigDoRascunho(admin, quem.clinicId),
      carregarCatalogoDoAgente(admin, quem.clinicId),
    ]);
    return {
      ok: true,
      texto: previaDoPrompt({
        config: contexto.config,
        catalogo,
        agoraTexto: agoraNaClinica(Date.now(), quem.timezone),
      }),
    };
  } catch {
    log.warn("agente_previa_falhou", { clinic_id: quem.clinicId });
    return { ok: false, error: TEXTOS.naoLeu };
  }
}

// ---------------------------------------------------------------------------
// Publicar e restaurar
// ---------------------------------------------------------------------------

/**
 * Publica o rascunho. O filtro do CFM roda aqui, sobre o que a versao vai
 * levar (lido pela service role, instrucoes inclusive), e so entao a RPC
 * publicar_agente (so service role) congela a base e carimba o autor da
 * sessao. Qualquer problema recusa a publicacao inteira.
 *
 * A RPC recebe o maior updated_at do que foi conferido (rascunho e base) e
 * recusa com CZ409 se algo mudou depois: o que congela e o que o filtro
 * viu. Problema nas instrucoes chega a administrador e gestor so como
 * "precisam de ajuste" (sem o tipo, que revelaria o conteudo); ao super
 * admin, exato.
 */
export async function publicarAgenteAction(): Promise<ResultadoDaPublicacaoDoAgente> {
  const quem = await exigirQuemConfigura();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  let admin: ReturnType<typeof createAdminClient>;
  let contexto: Awaited<ReturnType<typeof carregarConfigDoRascunho>>;
  try {
    admin = createAdminClient();
    contexto = await carregarConfigDoRascunho(admin, quem.clinicId);
  } catch {
    log.warn("agente_publicar_sem_leitura", { clinic_id: quem.clinicId });
    return { ok: false, error: TEXTOS.naoLeu };
  }
  if (contexto.rascunhoId === null) {
    return { ok: false, error: TEXTOS.semAlteracoes };
  }
  if (contexto.conferidoEm === null) {
    log.warn("agente_publicar_sem_leitura", { clinic_id: quem.clinicId });
    return { ok: false, error: TEXTOS.naoLeu };
  }

  const todos = problemasDaPublicacao(contexto.config);
  if (!quem.superAdmin && todos.some((p) => p.campo === "instrucoes")) {
    // A equipe Conduzza precisa saber: quem publica nao tem como corrigir.
    log.warn("agente_instrucoes_barram_publicacao", {
      clinic_id: quem.clinicId,
      kind: "instrucoes",
    });
  }
  const problemas = problemasParaQuemPublica(todos, quem.superAdmin);
  const primeiro = problemas[0];
  if (primeiro !== undefined) {
    return {
      ok: false,
      error: textoDoProblemaDaPublicacao(primeiro),
      problemas,
    };
  }
  if (
    contexto.publicada !== null &&
    diferencasDoRascunho(contexto.config, contexto.publicada).length === 0
  ) {
    return { ok: false, error: TEXTOS.semAlteracoes };
  }
  const ativas = contexto.config.base.filter((item) => item.ativo).length;
  if (ativas > LIMITES_DO_AGENTE.itensDaBase) {
    return {
      ok: false,
      error: `A base tem mais de ${LIMITES_DO_AGENTE.itensDaBase} perguntas ativas. Desative ou exclua algumas antes de publicar.`,
    };
  }

  const { data, error } = await admin.rpc("publicar_agente", {
    p_clinic_id: quem.clinicId,
    p_autor: quem.userId,
    p_conferido_em: contexto.conferidoEm,
  });
  if (error) {
    if (error.code === "P0002") {
      return { ok: false, error: TEXTOS.semAlteracoes };
    }
    if (error.code === "CZ409") {
      log.warn("agente_config_nao_alterada", {
        clinic_id: quem.clinicId,
        kind: "publicar",
        error_code: error.code,
      });
      return { ok: false, error: TEXTOS.mudouAoPublicar };
    }
    if (error.code === "22023") {
      return {
        ok: false,
        error: `A base tem mais de ${LIMITES_DO_AGENTE.itensDaBase} perguntas ativas. Desative ou exclua algumas antes de publicar.`,
      };
    }
    return falhou(quem, "publicar", error, TEXTOS.naoPublicou);
  }
  const versao = (data as { versao?: unknown } | null)?.versao;
  if (typeof versao !== "number") {
    return falhou(quem, "publicar_resposta", null, TEXTOS.naoPublicou);
  }
  log.info("agente_publicado", {
    clinic_id: quem.clinicId,
    count: ativas,
  });
  revalidatePath(PAGINA_DO_AGENTE);
  return { ok: true, versao };
}

/**
 * O rascunho volta a ser uma versao publicada (campos, instrucoes e a base
 * congelada dela; as perguntas fora dela ficam desativadas). Nao publica: a
 * pessoa confere e publica. A RPC grava a propria trilha (no rascunho); esta
 * acao grava tambem qual versao voltou (versao_restaurada_do_agente, com o
 * id da linha publicada), sem texto.
 */
export async function restaurarVersaoAction(
  entrada: unknown,
): Promise<ResultadoDoAgente> {
  const quem = await exigirQuemConfigura();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  const parsed = versaoSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS.dadosInvalidos };
  }
  const supabase = await createClient();
  // O id da versao, para a trilha (a sessao le id e version da publicada).
  const { data: daVersao } = await supabase
    .from("ai_agent_config")
    .select("id")
    .eq("clinic_id", quem.clinicId)
    .eq("status", "publicada")
    .eq("version", parsed.data.versao)
    .maybeSingle();
  const idDaVersao = (daVersao as { id?: unknown } | null)?.id;
  const { error } = await supabase.rpc("restaurar_versao_do_agente", {
    p_clinic_id: quem.clinicId,
    p_versao: parsed.data.versao,
  });
  if (error) {
    return falhou(
      quem,
      "restaurar",
      error,
      error.code === "P0002" ? TEXTOS.versaoNaoEncontrada : TEXTOS.naoRestaurou,
    );
  }
  await auditar(
    supabase,
    quem,
    "versao_restaurada_do_agente",
    "ai_agent_config",
    typeof idDaVersao === "string" ? idDaVersao : null,
  );
  revalidatePath(PAGINA_DO_AGENTE);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Simulador
// ---------------------------------------------------------------------------

/**
 * Uma rodada do simulador sobre o RASCUNHO (lib/agente/simulador.ts). Nada
 * e enviado a paciente nem gravado em conversa; so o gasto (ia_uso) e a
 * trilha da acao, sem texto. O historico vem do navegador e so roda com a
 * assinatura da ultima resposta conferida (lib/agente/assinatura.ts).
 */
export async function simularAction(
  entrada: unknown,
): Promise<ResultadoDaSimulacaoDoAgente> {
  const quem = await exigirQuemConfigura();
  if ("error" in quem) {
    return { ok: false, error: quem.error };
  }
  const parsed = simulacaoSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS.dadosInvalidos };
  }
  const { mensagens } = parsed.data;
  if (mensagens[mensagens.length - 1]?.autor !== "paciente") {
    return { ok: false, error: TEXTOS.ultimaDoPaciente };
  }
  try {
    const resultado = await simularTurno({
      admin: createAdminClient(),
      clinicId: quem.clinicId,
      userId: quem.userId,
      fuso: quem.timezone,
      mensagens,
      agoraMs: Date.now(),
      superAdmin: quem.superAdmin,
    });
    if (!resultado.ok) {
      return resultado;
    }
    const supabase = await createClient();
    await auditar(supabase, quem, "simulou_agente", "ai_agent_config", null);
    return {
      ok: true,
      resposta: resultado.resposta,
      tipo: resultado.tipo,
      trilha: resultado.trilha,
      // O texto barrado so para a equipe Conduzza (decisao 1 do dono: as
      // instrucoes, que o modelo pode repetir, so ela le).
      rascunhoBloqueado: quem.superAdmin ? resultado.rascunhoBloqueado : null,
      assinatura: resultado.assinatura,
    };
  } catch {
    log.warn("ia_simulador_falhou", { clinic_id: quem.clinicId });
    return { ok: false, error: TEXTOS.naoSimulou };
  }
}
