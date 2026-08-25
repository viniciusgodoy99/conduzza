"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { gerarToken, SOURCE_CHANNELS } from "@/lib/domain/attribution";
import { diaCivil, somarDias } from "@/lib/domain/horarios";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { importarContatos } from "@/lib/integrations/importar-contatos";
import { createClient } from "@/lib/supabase/server";

// Server Actions das Telas de Leads (4.2 e 4.3). Escrita de lead e de
// consentimento segue a matriz do brief (admin, gestor e recepcao); campanha
// de atribuicao e so de administrador e gestor, como a policy do banco. Toda
// entrada passa por Zod; cliente de SESSAO (RLS aplica); mutacao relevante
// vai para audit_log. As regras duras (perdido exige motivo, origem imutavel,
// reconsentimento exige evidencia) existem TAMBEM no banco: aqui a validacao
// so devolve mensagem melhor antes de bater na constraint.

export type LeadsActionResult = {
  ok: boolean;
  error?: string;
  id?: string;
  token?: string;
};

const idSchema = z.uuid();
const nomeSchema = z.string().trim().min(2).max(120);
const idsSchema = z.array(idSchema).min(1).max(100);
const canalSchema = z.enum(SOURCE_CHANNELS);

const etapaSchema = z.enum([
  "novo",
  "em_contato",
  "aguardando_resposta",
  "agendou",
  "compareceu",
  "perdido",
]);

const motivoPerdaSchema = z.enum([
  "preco",
  "distancia",
  "horario",
  "nao_respondeu",
  "agendou_em_outro_lugar",
  "outro",
]);

async function requireLeadsWriter() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (!canEdit(context.active.role, "leads_pacientes")) {
    return {
      error:
        permissionHint(context.active.role, "leads_pacientes") ??
        "Seu perfil não pode editar leads e pacientes",
    };
  }
  return {
    context,
    clinicId: context.active.clinicId,
    timezone: context.active.timezone,
  };
}

// Campanha de atribuicao e configuracao de gestao, nao operacao de recepcao:
// guard proprio, espelhando a policy "gestao gerencia campanhas" do banco.
async function requireCampaignManager() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  const role = context.active.role;
  if (role !== "admin" && role !== "gestor") {
    return {
      error: "Somente administradores e gestores gerenciam campanhas" as const,
    };
  }
  return { context, clinicId: context.active.clinicId };
}

async function auditar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  userId: string,
  action: string,
  entity: string,
  entityId: string | null,
): Promise<void> {
  await supabase.from("audit_log").insert({
    clinic_id: clinicId,
    user_id: userId,
    action,
    entity,
    entity_id: entityId,
  });
}

// ---------------------------------------------------------------------------
// Funil (Kanban da 4.3)
// ---------------------------------------------------------------------------

const mudarEtapaSchema = z
  .object({
    contact_ids: idsSchema,
    etapa: etapaSchema,
    lost_reason: motivoPerdaSchema.optional(),
    lost_reason_note: z.string().trim().min(2).max(500).optional(),
  })
  .refine((dados) => dados.etapa !== "perdido" || dados.lost_reason != null, {
    message: "Mover para Perdido exige escolher o motivo da perda.",
  })
  .refine(
    (dados) => dados.lost_reason !== "outro" || dados.lost_reason_note != null,
    { message: "Motivo Outro exige descrever a perda." },
  );

export async function mudarEtapaAction(
  input: unknown,
): Promise<LeadsActionResult> {
  const guard = await requireLeadsWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = mudarEtapaSchema.safeParse(input);
  if (!parsed.success) {
    const refinado = parsed.error.issues.find((i) => i.code === "custom");
    return {
      ok: false,
      error: refinado?.message ?? "Confira os campos informados.",
    };
  }

  // Sair de perdido limpa o motivo no MESMO update, senao o check
  // contact_perdido_exige_motivo deixaria motivo orfao em etapa ativa.
  const campos =
    parsed.data.etapa === "perdido"
      ? {
          funnel_stage: "perdido",
          lost_reason: parsed.data.lost_reason,
          lost_reason_note: parsed.data.lost_reason_note ?? null,
        }
      : {
          funnel_stage: parsed.data.etapa,
          lost_reason: null,
          lost_reason_note: null,
        };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact")
    .update(campos)
    .eq("clinic_id", guard.clinicId)
    .in("id", parsed.data.contact_ids)
    .select("id");
  if (error || !data || data.length === 0) {
    return { ok: false, error: "Não foi possível mudar a etapa." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "mudou_etapa",
    "contact",
    null,
  );
  revalidatePath("/leads");
  return { ok: true };
}

const reatribuirSchema = z.object({
  contact_ids: idsSchema,
  owner_user_id: idSchema.nullable(),
});

export async function reatribuirAction(
  input: unknown,
): Promise<LeadsActionResult> {
  const guard = await requireLeadsWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = reatribuirSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos informados." };
  }

  const supabase = await createClient();
  // Responsavel precisa ser membro ATIVO da clinica: uuid de fora ou vinculo
  // pendente nao vira dono de lead.
  if (parsed.data.owner_user_id !== null) {
    const { data: membro } = await supabase
      .from("clinic_member")
      .select("user_id")
      .eq("clinic_id", guard.clinicId)
      .eq("user_id", parsed.data.owner_user_id)
      .eq("status", "ativo")
      .maybeSingle();
    if (!membro) {
      return {
        ok: false,
        error: "Escolha um membro ativo da clínica como responsável.",
      };
    }
  }

  const { data, error } = await supabase
    .from("contact")
    .update({ owner_user_id: parsed.data.owner_user_id })
    .eq("clinic_id", guard.clinicId)
    .in("id", parsed.data.contact_ids)
    .select("id");
  if (error || !data || data.length === 0) {
    return { ok: false, error: "Não foi possível reatribuir os contatos." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "reatribuiu",
    "contact",
    null,
  );
  revalidatePath("/leads");
  return { ok: true };
}

const etiquetaSchema = z.string().trim().min(1).max(40);

const etiquetarSchema = z.object({
  contact_ids: idsSchema,
  adicionar: z.array(etiquetaSchema).max(20),
  remover: z.array(etiquetaSchema).max(20),
});

export async function etiquetarAction(
  input: unknown,
): Promise<LeadsActionResult> {
  const guard = await requireLeadsWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = etiquetarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira as etiquetas informadas." };
  }

  const supabase = await createClient();
  // RPC porque array nao se edita bem via PostgREST e read-modify-write no
  // cliente teria corrida. security invoker: a RLS de contact manda.
  const { data, error } = await supabase.rpc("etiquetar_contatos", {
    p_clinic_id: guard.clinicId,
    p_contact_ids: parsed.data.contact_ids,
    p_adicionar: parsed.data.adicionar,
    p_remover: parsed.data.remover,
  });
  const alterados = (data ?? 0) as number;
  if (error || alterados === 0) {
    return { ok: false, error: "Não foi possível etiquetar os contatos." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "etiquetou",
    "contact",
    null,
  );
  revalidatePath("/leads");
  revalidatePath("/pacientes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Criacao manual de lead
// ---------------------------------------------------------------------------

const criarLeadSchema = z.object({
  name: nomeSchema.optional(),
  phone_e164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  source_channel: canalSchema.optional(),
  source_origin: z.string().trim().min(1).max(120).optional(),
  source_campaign: z.string().trim().min(1).max(120).optional(),
  owner_user_id: idSchema.optional(),
  insurance_id: idSchema.optional(),
});

export async function criarLeadAction(
  input: unknown,
): Promise<LeadsActionResult> {
  const guard = await requireLeadsWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = criarLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos do lead." };
  }

  const supabase = await createClient();
  // Origem so entra junto com o canal (method manual, capturada agora); o
  // trigger de origem imutavel preserva depois. NAO grava consentimento:
  // cadastrar lead nao e autorizacao de disparo (regra 3.3).
  const { data, error } = await supabase
    .from("contact")
    .insert({
      clinic_id: guard.clinicId,
      phone_e164: parsed.data.phone_e164,
      name: parsed.data.name ?? null,
      kind: "lead",
      funnel_stage: "novo",
      owner_user_id: parsed.data.owner_user_id ?? null,
      insurance_id: parsed.data.insurance_id ?? null,
      ...(parsed.data.source_channel
        ? {
            source_channel: parsed.data.source_channel,
            source_origin: parsed.data.source_origin ?? null,
            source_campaign: parsed.data.source_campaign ?? null,
            source_method: "manual",
            source_captured_at: new Date().toISOString(),
          }
        : {}),
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      return { ok: false, error: "Já existe um contato com este telefone." };
    }
    return { ok: false, error: "Não foi possível criar o lead." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "criou",
    "contact",
    data.id,
  );
  revalidatePath("/leads");
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Consentimento (autorizacao para receber mensagens)
// ---------------------------------------------------------------------------

const concederConsentimentoSchema = z.object({
  contact_id: idSchema,
  source: z.enum([
    "formulario_site",
    "anuncio_ctwa",
    "recepcao",
    "importacao_planilha",
    "conversa",
  ]),
  evidence: z.string().trim().min(2).max(500).optional(),
});

export async function concederConsentimentoAction(
  input: unknown,
): Promise<LeadsActionResult> {
  const guard = await requireLeadsWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = concederConsentimentoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos da autorização." };
  }

  const supabase = await createClient();
  // O contato precisa ser da clinica ativa (o trigger de coerencia no banco
  // confere de novo; aqui so devolve mensagem melhor).
  const { data: donoConsent } = await supabase
    .from("contact")
    .select("id")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.contact_id)
    .maybeSingle();
  if (!donoConsent) {
    return { ok: false, error: "Contato não encontrado nesta clínica." };
  }
  // Ja vigente: nao empilha linha nova, devolve ok.
  const { data: vigenteData } = await supabase.rpc("consentimento_vigente", {
    p_clinic_id: guard.clinicId,
    p_contact_id: parsed.data.contact_id,
    p_channel: "whatsapp",
  });
  if ((vigenteData ?? false) === true) {
    return { ok: true };
  }

  // Reconsentimento depois de revogacao exige evidencia (o gatilho
  // exigir_evidencia_de_reconsentimento confere de novo no banco).
  const { data: revogadas } = await supabase
    .from("contact_consent")
    .select("id")
    .eq("clinic_id", guard.clinicId)
    .eq("contact_id", parsed.data.contact_id)
    .eq("channel", "whatsapp")
    .not("revoked_at", "is", null)
    .limit(1);
  if (revogadas && revogadas.length > 0 && !parsed.data.evidence) {
    return {
      ok: false,
      error:
        "Este contato pediu para não receber mensagens. Registre como ele autorizou de novo.",
    };
  }

  const { error } = await supabase.from("contact_consent").insert({
    clinic_id: guard.clinicId,
    contact_id: parsed.data.contact_id,
    channel: "whatsapp",
    source: parsed.data.source,
    evidence: parsed.data.evidence ?? null,
  });
  if (error) {
    return { ok: false, error: "Não foi possível registrar a autorização." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "concedeu_consentimento",
    "contact",
    parsed.data.contact_id,
  );
  revalidatePath("/leads");
  revalidatePath("/pacientes");
  return { ok: true };
}

export async function revogarConsentimentoAction(
  input: unknown,
): Promise<LeadsActionResult> {
  const guard = await requireLeadsWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.object({ contact_id: idSchema }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Contato inválido." };
  }

  const supabase = await createClient();
  // Revoga toda linha ativa do par contato + whatsapp. Reativar depois so
  // com evidencia nova (regra 3.4: revogacao e definitiva).
  const { error } = await supabase
    .from("contact_consent")
    .update({ revoked_at: new Date().toISOString() })
    .eq("clinic_id", guard.clinicId)
    .eq("contact_id", parsed.data.contact_id)
    .eq("channel", "whatsapp")
    .is("revoked_at", null);
  if (error) {
    return { ok: false, error: "Não foi possível revogar a autorização." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "revogou_consentimento",
    "contact",
    parsed.data.contact_id,
  );
  revalidatePath("/leads");
  revalidatePath("/pacientes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Venda de pacote (saldo de sessoes)
// ---------------------------------------------------------------------------

const venderPacoteSchema = z.object({
  contact_id: idSchema,
  package_id: idSchema,
});

export async function venderPacoteAction(
  input: unknown,
): Promise<LeadsActionResult> {
  const guard = await requireLeadsWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = venderPacoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira o paciente e o pacote." };
  }

  const supabase = await createClient();
  // O contato precisa ser da clinica ativa (o trigger de coerencia no banco
  // confere de novo; aqui so devolve mensagem melhor).
  const { data: donoPacote } = await supabase
    .from("contact")
    .select("id")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.contact_id)
    .maybeSingle();
  if (!donoPacote) {
    return { ok: false, error: "Paciente não encontrado nesta clínica." };
  }
  const { data: pacoteRow } = await supabase
    .from("package")
    .select("sessions, validity_days")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.package_id)
    .maybeSingle();
  if (!pacoteRow) {
    return { ok: false, error: "Pacote não encontrado." };
  }
  const pacote = pacoteRow as { sessions: number; validity_days: number | null };

  // Validade em DIA CIVIL do fuso da clinica (regra 3.6): vendido hoje com 90
  // dias vence no dia local correto, nao no dia UTC.
  const expiraEm =
    pacote.validity_days !== null
      ? somarDias(diaCivil(guard.timezone, new Date()), pacote.validity_days)
      : null;

  const { data, error } = await supabase
    .from("package_balance")
    .insert({
      clinic_id: guard.clinicId,
      contact_id: parsed.data.contact_id,
      package_id: parsed.data.package_id,
      sessions_total: pacote.sessions,
      expires_at: expiraEm,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "Não foi possível registrar o pacote." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "vendeu_pacote",
    "package_balance",
    data.id,
  );
  revalidatePath("/leads");
  revalidatePath("/pacientes");
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Campanhas de atribuicao (campaign_link)
// ---------------------------------------------------------------------------

const campanhaSchema = z.object({
  id: idSchema.optional(),
  name: nomeSchema,
  channel: canalSchema,
  origin: z.string().trim().min(1).max(120).optional(),
  medium: z.string().trim().min(1).max(120).optional(),
  campaign: z.string().trim().min(1).max(120).optional(),
  default_message: z.string().trim().min(2).max(1000).optional(),
  keywords: z.array(z.string().trim().min(2).max(40)).max(20),
  com_token: z.boolean(),
});

export async function salvarCampanhaAction(
  input: unknown,
): Promise<LeadsActionResult> {
  const guard = await requireCampaignManager();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = campanhaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos da campanha." };
  }
  const supabase = await createClient();
  const campos = {
    name: parsed.data.name,
    channel: parsed.data.channel,
    origin: parsed.data.origin ?? null,
    medium: parsed.data.medium ?? null,
    campaign: parsed.data.campaign ?? null,
    default_message: parsed.data.default_message ?? null,
    keywords: parsed.data.keywords,
  };

  if (parsed.data.id) {
    // Edicao nao mexe no token: link ja impresso em anuncio nao pode mudar.
    const { data } = await supabase
      .from("campaign_link")
      .update(campos)
      .eq("clinic_id", guard.clinicId)
      .eq("id", parsed.data.id)
      .select("id");
    if (!data || data.length === 0) {
      return { ok: false, error: "Não foi possível salvar a campanha." };
    }
    await auditar(
      supabase,
      guard.clinicId,
      guard.context.userId,
      "editou",
      "campaign_link",
      parsed.data.id,
    );
    revalidatePath("/leads");
    return { ok: true, id: parsed.data.id };
  }

  if (!parsed.data.com_token) {
    const { data, error } = await supabase
      .from("campaign_link")
      .insert({ clinic_id: guard.clinicId, token: null, ...campos })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: "Não foi possível criar a campanha." };
    }
    await auditar(
      supabase,
      guard.clinicId,
      guard.context.userId,
      "criou",
      "campaign_link",
      data.id,
    );
    revalidatePath("/leads");
    return { ok: true, id: data.id };
  }

  // Token unico por clinica (indice em upper(token)): colisao 23505 re-tenta
  // com token novo ate 3 vezes.
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const token = gerarToken().toUpperCase();
    const { data, error } = await supabase
      .from("campaign_link")
      .insert({ clinic_id: guard.clinicId, token, ...campos })
      .select("id")
      .single();
    if (!error && data) {
      await auditar(
        supabase,
        guard.clinicId,
        guard.context.userId,
        "criou",
        "campaign_link",
        data.id,
      );
      revalidatePath("/leads");
      return { ok: true, id: data.id, token };
    }
    if (error && error.code !== "23505") {
      return { ok: false, error: "Não foi possível criar a campanha." };
    }
  }
  return {
    ok: false,
    error: "Não foi possível gerar um código único. Tente de novo.",
  };
}

export async function desativarCampanhaAction(
  input: unknown,
): Promise<LeadsActionResult> {
  const guard = await requireCampaignManager();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = z.object({ id: idSchema }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Campanha inválida." };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaign_link")
    .update({ active: false })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.id)
    .select("id");
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível desativar a campanha." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "desativou_campanha",
    "campaign_link",
    parsed.data.id,
  );
  revalidatePath("/leads");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Importacao de planilha (Tela 4, tarefa 4.4)
// ---------------------------------------------------------------------------
// A action e casca fina: guard de escrita + Zod + auditoria. O miolo vive em
// lib/integrations/importar-contatos.ts (testado com o banco real em
// tests/integration/importacao.test.ts). Um lote por chamada, ate 500 linhas;
// quem divide a planilha e mostra o progresso e a tela.

const declaracaoDeConsentimentoSchema = z
  .object({
    opcao: z.enum(["formulario_site", "anuncio_ctwa", "recepcao", "outra"]),
    observacao: z.string().trim().max(300).optional(),
  })
  .refine(
    (declaracao) =>
      declaracao.opcao !== "outra" ||
      (declaracao.observacao != null && declaracao.observacao.length >= 2),
    { message: "Descreva como os contatos autorizaram receber mensagens." },
  );

const linhaImportadaSchema = z.object({
  name: z.string().trim().min(1).max(120).nullable(),
  phone_e164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  email: z.string().trim().min(3).max(160).nullable(),
  insurance_name: z.string().trim().min(1).max(120).nullable(),
  source_campaign: z.string().trim().min(1).max(120).nullable(),
});

const importarContatosSchema = z.object({
  declaracao: declaracaoDeConsentimentoSchema,
  lote: z.array(linhaImportadaSchema).min(1).max(500),
});

export type ImportarContatosActionResult =
  | {
      ok: true;
      importados: number;
      atualizados: number;
      reautorizados: number;
      pulados: number;
    }
  | { ok: false; error?: string };

export async function importarContatosAction(
  input: unknown,
): Promise<ImportarContatosActionResult> {
  const guard = await requireLeadsWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = importarContatosSchema.safeParse(input);
  if (!parsed.success) {
    const refinado = parsed.error.issues.find((i) => i.code === "custom");
    return {
      ok: false,
      error: refinado?.message ?? "Confira os contatos do lote.",
    };
  }

  const supabase = await createClient();
  const resultado = await importarContatos(supabase, guard.clinicId, {
    declaracao: parsed.data.declaracao,
    lote: parsed.data.lote,
  });
  if (!resultado.ok) {
    return resultado;
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "importou_planilha",
    "contact",
    null,
  );
  revalidatePath("/leads");
  return resultado;
}
