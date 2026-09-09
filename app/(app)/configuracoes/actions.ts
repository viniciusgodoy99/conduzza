"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { ICONES_DE_ETAPA } from "@/lib/domain/jornada";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import type { Role } from "@/lib/domain/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Acoes de equipe: liberar quem pediu entrada por codigo, recusar, mudar o
// papel de quem ja esta na clinica, tirar e devolver acesso, e gerir o codigo
// de acesso. Tudo com a sessao do usuario (RLS aplica) e com checagem
// explicita de papel: administrador e gestor gerenciam a equipe (decisao do
// dono em 25/08/2026), com o gestor barrado em tudo que envolve administrador.

export type TeamActionResult = { ok: boolean; error?: string };

const papelSchema = z.enum([
  "admin",
  "gestor",
  "recepcao",
  "profissional",
  "leitura",
]);

const alvoSchema = z.object({ user_id: z.uuid() });
const mudarPapelSchema = z.object({ user_id: z.uuid(), papel: papelSchema });

async function requireGestorOuAdmin() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  const { role } = context.active;
  if (!canEdit(role, "configuracoes")) {
    return {
      error:
        permissionHint(role, "configuracoes") ??
        "Somente administradores e gestores gerenciam a equipe.",
    };
  }
  return { context, clinicId: context.active.clinicId, role };
}

// Os gatilhos de clinic_member (migration 20260825160000) recusam em portugues
// e ja explicam o motivo. Repassar a mensagem do banco ajuda muito mais que um
// "algo deu errado" generico. Erro de policy nao vaza detalhe: vira permissao.
const RECUSAS_DO_BANCO = [
  "Somente um administrador",
  "A clínica precisa de pelo menos um administrador ativo.",
  "Você não pode alterar o próprio papel",
];

function mensagemDeErro(
  error: { code?: string; message?: string } | null,
  fallback: string,
): string {
  if (!error) {
    return fallback;
  }
  if (error.code === "42501") {
    return "Seu perfil não altera o acesso da equipe.";
  }
  const mensagem = error.message ?? "";
  if (RECUSAS_DO_BANCO.some((trecho) => mensagem.includes(trecho))) {
    return mensagem;
  }
  return fallback;
}

async function auditar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  userId: string,
  action: string,
  entityId: string,
): Promise<void> {
  await supabase.from("audit_log").insert({
    clinic_id: clinicId,
    user_id: userId,
    action,
    entity: "clinic_member",
    entity_id: entityId,
  });
}

type Alvo = { role: Role; status: "ativo" | "pendente" | "inativo" };

async function carregarAlvo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  userId: string,
): Promise<Alvo | null> {
  const { data } = await supabase
    .from("clinic_member")
    .select("role, status")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as Alvo | null) ?? null;
}

// Guarda de aplicacao rodada ANTES do banco. Os gatilhos recusam do mesmo
// jeito, mas aqui a recusa sai antes da escrita e com o nome da acao certa.
function barrarMexidaEmAdmin(
  quemChama: Role,
  papelDoAlvo: Role,
): string | null {
  if (quemChama === "admin") {
    return null;
  }
  if (papelDoAlvo === "admin") {
    return "Somente um administrador altera o acesso de outro administrador.";
  }
  return null;
}

export async function aprovarMembroAction(
  userId: string,
  papel: string,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedUser = z.uuid().safeParse(userId);
  const parsedPapel = papelSchema.safeParse(papel);
  if (!parsedUser.success || !parsedPapel.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  if (guard.role !== "admin" && parsedPapel.data === "admin") {
    return {
      ok: false,
      error: "Somente um administrador cria outro administrador.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinic_member")
    .update({ status: "ativo", role: parsedPapel.data })
    .eq("clinic_id", guard.clinicId)
    .eq("user_id", parsedUser.data)
    .eq("status", "pendente")
    .select("user_id");
  if (error) {
    return {
      ok: false,
      error: mensagemDeErro(error, "Não foi possível liberar o acesso."),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Este pedido já foi tratado." };
  }

  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "liberou_acesso",
    parsedUser.data,
  );
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function recusarMembroAction(
  userId: string,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedUser = z.uuid().safeParse(userId);
  if (!parsedUser.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinic_member")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("user_id", parsedUser.data)
    .eq("status", "pendente")
    .select("user_id");
  if (error) {
    return {
      ok: false,
      error: mensagemDeErro(error, "Não foi possível recusar o pedido."),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Este pedido já foi tratado." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "recusou_acesso",
    parsedUser.data,
  );
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function mudarPapelAction(
  input: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = mudarPapelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const { user_id: alvoId, papel } = parsed.data;
  if (alvoId === guard.context.userId) {
    return { ok: false, error: "Você não altera o próprio papel." };
  }

  const supabase = await createClient();
  const alvo = await carregarAlvo(supabase, guard.clinicId, alvoId);
  if (!alvo) {
    return { ok: false, error: "Esta pessoa não faz parte da equipe." };
  }
  const barrado = barrarMexidaEmAdmin(guard.role, alvo.role);
  if (barrado) {
    return { ok: false, error: barrado };
  }
  if (guard.role !== "admin" && papel === "admin") {
    return {
      ok: false,
      error: "Somente um administrador cria outro administrador.",
    };
  }
  if (alvo.role === papel) {
    return { ok: true };
  }

  // Update condicional pelo papel lido: se alguem mudou antes numa outra aba,
  // nenhuma linha volta e a tela avisa em vez de sobrescrever calada.
  const { data, error } = await supabase
    .from("clinic_member")
    .update({ role: papel })
    .eq("clinic_id", guard.clinicId)
    .eq("user_id", alvoId)
    .eq("role", alvo.role)
    .select("user_id");
  if (error) {
    return {
      ok: false,
      error: mensagemDeErro(error, "Não foi possível mudar o papel."),
    };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "O papel mudou em outro lugar. Recarregue a página.",
    };
  }

  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "mudou_papel",
    alvoId,
  );
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function desativarMembroAction(
  input: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = alvoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const alvoId = parsed.data.user_id;
  if (alvoId === guard.context.userId) {
    return { ok: false, error: "Você não tira o próprio acesso." };
  }

  const supabase = await createClient();
  const alvo = await carregarAlvo(supabase, guard.clinicId, alvoId);
  if (!alvo) {
    return { ok: false, error: "Esta pessoa não faz parte da equipe." };
  }
  const barrado = barrarMexidaEmAdmin(guard.role, alvo.role);
  if (barrado) {
    return { ok: false, error: barrado };
  }

  const { data, error } = await supabase
    .from("clinic_member")
    .update({ status: "inativo" })
    .eq("clinic_id", guard.clinicId)
    .eq("user_id", alvoId)
    .eq("status", "ativo")
    .select("user_id");
  if (error) {
    return {
      ok: false,
      error: mensagemDeErro(error, "Não foi possível tirar o acesso."),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Esta pessoa já está sem acesso." };
  }

  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "desativou_acesso",
    alvoId,
  );
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function reativarMembroAction(
  input: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = alvoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const alvoId = parsed.data.user_id;
  if (alvoId === guard.context.userId) {
    return { ok: false, error: "Você não altera o próprio acesso." };
  }

  const supabase = await createClient();
  const alvo = await carregarAlvo(supabase, guard.clinicId, alvoId);
  if (!alvo) {
    return { ok: false, error: "Esta pessoa não faz parte da equipe." };
  }
  const barrado = barrarMexidaEmAdmin(guard.role, alvo.role);
  if (barrado) {
    return { ok: false, error: barrado };
  }

  const { data, error } = await supabase
    .from("clinic_member")
    .update({ status: "ativo" })
    .eq("clinic_id", guard.clinicId)
    .eq("user_id", alvoId)
    .eq("status", "inativo")
    .select("user_id");
  if (error) {
    return {
      ok: false,
      error: mensagemDeErro(error, "Não foi possível devolver o acesso."),
    };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Esta pessoa já tem acesso." };
  }

  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "reativou_acesso",
    alvoId,
  );
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function gerarNovoCodigoAction(): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const supabase = await createClient();
  // Codigo e segredo de acesso: gerador criptografico (randomBytes), nunca
  // Math.random, que e previsivel. 10 caracteres de alfabeto sem ambiguidade.
  // O unique do banco confere; o valor antigo para de funcionar na hora, que
  // e o objetivo da rotacao. A tabela clinic_access_code e legivel e
  // atualizavel so por quem gerencia a clinica (policy propria).
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  const novo = Array.from(
    bytes,
    (byte) => alfabeto[byte % alfabeto.length],
  ).join("");
  const { error } = await supabase
    .from("clinic_access_code")
    .update({ code: novo })
    .eq("clinic_id", guard.clinicId);
  if (error) {
    return { ok: false, error: "Não foi possível gerar um código novo." };
  }
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function alternarCodigoAction(
  ativo: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.boolean().safeParse(ativo);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("clinic")
    .update({ allow_code_signup: parsed.data })
    .eq("id", guard.clinicId);
  if (error) {
    return {
      ok: false,
      error: "Não foi possível alterar a entrada por código.",
    };
  }
  revalidatePath("/configuracoes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Jornada da clinica (funnel_stage_def): as etapas do funil, configuraveis, no
// modelo da Jornada de Compra do Tintim, com a conversao da Meta morando NA
// etapa. As protecoes de estrutura (chave e papel imutaveis, etapa de sistema
// indelevel, etapa ocupada nao se exclui) sao GATILHOS no banco; estas actions
// so traduzem as recusas para a lingua de quem atende. Cliente de SESSAO
// sempre: quem autoriza e a policy.

const TONS_DE_ETAPA = [
  "neutral",
  "info",
  "warning",
  "success",
  "alert",
] as const;

// O catalogo de icones vem da fonte unica (lib/domain/jornada.ts): o que o
// app sabe desenhar e o que a action aceita, sem espelho para dessincronizar.
const NOMES_DE_ICONES = Object.keys(ICONES_DE_ETAPA) as [string, ...string[]];

const conversaoDaEtapaSchema = z
  .object({
    meta_event_name: z.string().trim().min(1).max(100).nullable(),
    conversao_ativa: z.boolean(),
    is_sale: z.boolean(),
    is_first_contact: z.boolean(),
    value_source: z.enum(["service_link", "fixo"]).nullable(),
    value_cents: z.number().int().min(0).max(100_000_000).nullable(),
  })
  .refine(
    (dados) => dados.value_source !== "fixo" || dados.value_cents !== null,
    { message: "Informe o valor em reais para usar valor fixo." },
  );

const etapaDaJornadaSchema = z.object({
  /** ausente = criar etapa nova; presente = editar a existente */
  chave: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,40}$/)
    .nullable(),
  nome: z.string().trim().min(2).max(60),
  tom: z.enum(TONS_DE_ETAPA),
  icone: z.enum(NOMES_DE_ICONES),
  // Termos que movem o lead para esta etapa sozinhos (fase 4). Mesmos limites
  // das palavras-chave de campanha, que sao o molde.
  termos_chave: z.array(z.string().trim().min(2).max(40)).max(20),
  conversao: conversaoDaEtapaSchema,
});

/** Nome vira chave: sem acento, minusculo, underscore. "Comprou pacote" -> comprou_pacote */
function chaveDoNome(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return base.length > 0 ? base : "etapa";
}

function traduzirRecusaDaJornada(message: string | undefined): string | null {
  const recusas = [
    "Etapa de sistema não pode ser excluída",
    "Mova os contatos desta etapa",
    "A chave de uma etapa não muda",
    "O papel de sistema de uma etapa não muda",
  ];
  if (!message) return null;
  return recusas.find((recusa) => message.includes(recusa)) ? message : null;
}

export async function salvarEtapaDaJornadaAction(
  entrada: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = etapaDaJornadaSchema.safeParse(entrada);
  if (!parsed.success) {
    const amigavel = parsed.error.issues.find(
      (issue) => issue.code === "custom",
    );
    return { ok: false, error: amigavel?.message ?? "Dados inválidos." };
  }
  const dados = parsed.data;
  const supabase = await createClient();

  const conversao = {
    meta_event_name: dados.conversao.meta_event_name,
    conversao_ativa: dados.conversao.conversao_ativa,
    is_sale: dados.conversao.is_sale,
    is_first_contact: dados.conversao.is_first_contact,
    value_source: dados.conversao.value_source,
    value_cents:
      dados.conversao.value_source === "fixo"
        ? dados.conversao.value_cents
        : null,
  };

  if (dados.chave) {
    const { data: linhas, error } = await supabase
      .from("funnel_stage_def")
      .update({
        nome: dados.nome,
        tom: dados.tom,
        icone: dados.icone,
        termos_chave: dados.termos_chave,
        ...conversao,
      })
      .eq("clinic_id", guard.clinicId)
      .eq("chave", dados.chave)
      .select("id");
    if (error || !linhas || linhas.length === 0) {
      return {
        ok: false,
        error:
          traduzirRecusaDaJornada(error?.message) ??
          "Não foi possível salvar a etapa.",
      };
    }
    await supabase.from("audit_log").insert({
      clinic_id: guard.clinicId,
      user_id: guard.context.userId,
      action: "editou_etapa_da_jornada",
      entity: "funnel_stage_def",
      entity_id: linhas[0]!.id,
    });
  } else {
    // Criar: a chave nasce do nome, com sufixo se ja existir; a posicao entra
    // no fim da jornada. Se a leitura das existentes falhar, PARA: seguir com
    // lista vazia inseriria posicao 10 empatada com a etapa de entrada.
    const { data: existentes, error: erroLeitura } = await supabase
      .from("funnel_stage_def")
      .select("chave, posicao")
      .eq("clinic_id", guard.clinicId);
    if (erroLeitura) {
      return {
        ok: false,
        error: "Não foi possível ler a jornada. Tente de novo.",
      };
    }
    const chaves = new Set((existentes ?? []).map((linha) => linha.chave));
    let chave = chaveDoNome(dados.nome);
    let sufixo = 2;
    while (chaves.has(chave)) {
      chave = `${chaveDoNome(dados.nome).slice(0, 28)}_${sufixo}`;
      sufixo += 1;
    }
    const maiorPosicao = Math.max(
      0,
      ...(existentes ?? []).map((linha) => linha.posicao as number),
    );
    const { data: nova, error } = await supabase
      .from("funnel_stage_def")
      .insert({
        clinic_id: guard.clinicId,
        chave,
        nome: dados.nome,
        posicao: maiorPosicao + 10,
        tom: dados.tom,
        icone: dados.icone,
        termos_chave: dados.termos_chave,
        ...conversao,
      })
      .select("id")
      .single();
    if (error || !nova) {
      return {
        ok: false,
        error: mensagemDeErro(error, "Não foi possível criar a etapa."),
      };
    }
    await supabase.from("audit_log").insert({
      clinic_id: guard.clinicId,
      user_id: guard.context.userId,
      action: "criou_etapa_da_jornada",
      entity: "funnel_stage_def",
      entity_id: nova.id,
    });
  }

  revalidatePath("/configuracoes");
  revalidatePath("/leads");
  return { ok: true };
}

export async function reordenarEtapaDaJornadaAction(
  chave: unknown,
  direcao: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedChave = z
    .string()
    .regex(/^[a-z0-9_]{1,40}$/)
    .safeParse(chave);
  const parsedDirecao = z.enum(["subir", "descer"]).safeParse(direcao);
  if (!parsedChave.success || !parsedDirecao.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  // A troca vive na RPC reordenar_etapa_da_jornada (migration 20260909150000):
  // transacao unica com FOR UPDATE e renumeracao completa. A primeira versao
  // fazia duas escritas soltas daqui e podia deixar duas etapas empatadas na
  // mesma posicao para sempre, o que desligava o avanco automatico do funil
  // (achado da revisao adversarial de 09/09/2026). SECURITY INVOKER: a RLS
  // continua decidindo quem reordena.
  const supabase = await createClient();
  const { data: etapaMovida, error } = await supabase.rpc(
    "reordenar_etapa_da_jornada",
    {
      p_clinic_id: guard.clinicId,
      p_chave: parsedChave.data,
      p_direcao: parsedDirecao.data,
    },
  );
  if (error || !etapaMovida) {
    return {
      ok: false,
      error: error?.message.includes("ponta da jornada")
        ? "A etapa já está na ponta da jornada."
        : "Não foi possível reordenar. Tente de novo.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "reordenou_etapa_da_jornada",
    entity: "funnel_stage_def",
    entity_id: etapaMovida as string,
  });

  revalidatePath("/configuracoes");
  revalidatePath("/leads");
  return { ok: true };
}

export async function excluirEtapaDaJornadaAction(
  chave: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z
    .string()
    .regex(/^[a-z0-9_]{1,40}$/)
    .safeParse(chave);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: removidas, error } = await supabase
    .from("funnel_stage_def")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("chave", parsed.data)
    .select("id");
  if (error || !removidas || removidas.length === 0) {
    return {
      ok: false,
      error:
        traduzirRecusaDaJornada(error?.message) ??
        "Não foi possível excluir a etapa.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "excluiu_etapa_da_jornada",
    entity: "funnel_stage_def",
    entity_id: removidas[0]!.id,
  });
  revalidatePath("/configuracoes");
  revalidatePath("/leads");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Anuncios da Meta (R6): a conta que recebera as conversoes de volta.
//
// A configuracao legivel (pixel, conta, WABA, codigo de teste) vive em
// meta_ads_account e a policy de gestao autoriza pela SESSAO. O token da
// CAPI vive em meta_ads_account_secret, que nao tem policy nenhuma: so o
// admin client escreve, DEPOIS do guard de papel, e o valor nunca volta ao
// navegador (write-only). Ligar o envio revalida tudo e enfileira os
// eventos registrados da janela de 7 dias da CAPI; os mais antigos sao
// descartados com codigo, nunca em silencio.

const contaMetaSchema = z.object({
  pixel_id: z
    .string()
    .trim()
    .regex(/^\d{5,20}$/)
    .nullable(),
  ad_account_id: z
    .string()
    .trim()
    .regex(/^(act_)?\d{5,20}$/)
    .nullable(),
  whatsapp_business_account_id: z
    .string()
    .trim()
    .regex(/^\d{5,20}$/)
    .nullable(),
  test_event_code: z.string().trim().min(1).max(40).nullable(),
  send_unmatched: z.boolean(),
  // O banco embarga qualquer valor aqui ate a decisao D6 (LGPD) do dono
  // (gatilho conferir_token_antes_de_ligar_envio); a tela ja explica.
  modo_user_data: z.enum(["ctwa_apenas", "telefone_hasheado"]).nullable(),
});

export async function salvarContaMetaAction(
  entrada: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = contaMetaSchema.safeParse(entrada);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos: os identificadores da Meta são só números.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("meta_ads_account")
    .upsert(
      { clinic_id: guard.clinicId, ...parsed.data },
      { onConflict: "clinic_id" },
    );
  if (error) {
    return {
      ok: false,
      error: error.message.includes("decisão de privacidade pendente")
        ? "A forma de envio dos dados ainda está em definição (decisão de privacidade pendente)."
        : mensagemDeErro(error, "Não foi possível salvar a conta."),
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "salvou_conta_meta",
    entity: "meta_ads_account",
    entity_id: guard.clinicId,
  });
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function salvarTokenMetaAction(
  entrada: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z
    .object({ capi_access_token: z.string().trim().min(20).max(500) })
    .safeParse(entrada);
  if (!parsed.success) {
    return {
      ok: false,
      error: "O token parece incompleto. Cole o valor inteiro, sem espaços.",
    };
  }

  // Tabela-secret nao tem policy: escrita SO pelo admin client, depois do
  // guard de papel acima (padrao whatsapp-connect).
  const admin = createAdminClient();
  const { error } = await admin
    .from("meta_ads_account_secret")
    .upsert(
      {
        clinic_id: guard.clinicId,
        capi_access_token: parsed.data.capi_access_token,
      },
      { onConflict: "clinic_id" },
    );
  if (error) {
    return { ok: false, error: "Não foi possível salvar o token." };
  }

  // Auditoria SEM o valor, obvio.
  const supabase = await createClient();
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "atualizou_token_meta",
    entity: "meta_ads_account_secret",
    entity_id: guard.clinicId,
  });
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function alternarEnvioMetaAction(
  entrada: unknown,
): Promise<TeamActionResult> {
  const guard = await requireGestorOuAdmin();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.object({ ligar: z.boolean() }).safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: linhas, error } = await supabase
    .from("meta_ads_account")
    .update({ envio_ativado: parsed.data.ligar })
    .eq("clinic_id", guard.clinicId)
    .select("clinic_id");
  if (error || !linhas || linhas.length === 0) {
    const recusa = error?.message.includes("cadastre o token")
      ? "Para ligar o envio, cadastre o token da API de conversões."
      : error?.message.includes("envio_exige_configuracao") ||
          error?.code === "23514"
        ? "Para ligar o envio, preencha o Pixel e escolha como enviar os dados."
        : "Não foi possível alterar o envio.";
    return { ok: false, error: recusa };
  }

  if (parsed.data.ligar) {
    // Backfill da janela da CAPI: eventos registrados dos ultimos 7 dias
    // entram na fila; os mais antigos sao descartados com codigo. Escrita de
    // sistema (conversion_event e job_queue nao tem policy de escrita).
    //
    // ORDEM IMPORTA (achado da revisao adversarial de 09/09/2026): o job
    // nasce ANTES de o status virar 'enfileirado'. Se o insert do job
    // falhar, o evento continua 'registrado' e o proximo religar o repesca;
    // 'enfileirado' sem job seria orfao para sempre. O job aceita evento
    // 'registrado' numa boa (ele so recusa 'enviado'/'descartado'/'falhou').
    const admin = createAdminClient();
    const corte = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { error: erroDescarte } = await admin
      .from("conversion_event")
      .update({ status: "descartado", erro: "fora_da_janela_capi" })
      .eq("clinic_id", guard.clinicId)
      .eq("status", "registrado")
      .lt("created_at", corte);
    const { data: recentes, error: erroLeitura } = await admin
      .from("conversion_event")
      .select("id")
      .eq("clinic_id", guard.clinicId)
      .eq("status", "registrado")
      .gte("created_at", corte)
      .limit(1000);
    if (erroDescarte || erroLeitura) {
      return {
        ok: false,
        error:
          "O envio ligou, mas os registros antigos não entraram na fila. Desligue e ligue de novo para tentar outra vez.",
      };
    }
    let falhas = 0;
    for (const evento of recentes ?? []) {
      const { error: erroJob } = await admin.from("job_queue").insert({
        clinic_id: guard.clinicId,
        kind: "enviar_conversao_meta",
        payload: { conversion_event_id: evento.id },
      });
      if (erroJob) {
        falhas += 1;
        continue;
      }
      await admin
        .from("conversion_event")
        .update({ status: "enfileirado" })
        .eq("id", evento.id)
        .eq("status", "registrado");
    }
    if (falhas > 0) {
      return {
        ok: false,
        error: `O envio ligou, mas ${falhas} ${falhas === 1 ? "registro antigo não entrou" : "registros antigos não entraram"} na fila. Desligue e ligue de novo para tentar outra vez.`,
      };
    }
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: parsed.data.ligar
      ? "ligou_envio_de_conversoes"
      : "desligou_envio_de_conversoes",
    entity: "meta_ads_account",
    entity_id: guard.clinicId,
  });
  revalidatePath("/configuracoes");
  revalidatePath("/relatorios");
  return { ok: true };
}
