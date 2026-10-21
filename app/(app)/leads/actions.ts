"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { SOURCE_CHANNELS } from "@/lib/domain/attribution";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import {
  chaveDeTelefone,
  MENSAGEM_TELEFONE_INVALIDO,
  mensagemDeTelefoneDuplicado,
  normalizarTelefone,
} from "@/lib/domain/telefone";
import {
  evidenciaDaDeclaracao,
  FONTE_DA_DECLARACAO,
  importarContatos,
} from "@/lib/integrations/importar-contatos";
import { fetchLeadDetalhe, type LeadDetalhe } from "@/lib/queries/leads";
import { createClient } from "@/lib/supabase/server";

// Server Actions das Telas de Leads (4.2 e 4.3). Escrita de lead e de
// consentimento segue a matriz do brief (admin, gestor e recepcao). As
// regras de origem (campaign_link) moram na aba "Origem dos leads" de
// Configuracoes desde a onda 5 (regras-de-origem-actions.ts). Toda
// entrada passa por Zod; cliente de SESSAO (RLS aplica); mutacao relevante
// vai para audit_log. As regras duras (perdido exige motivo, origem imutavel,
// reconsentimento exige evidencia) existem TAMBEM no banco: aqui a validacao
// so devolve mensagem melhor antes de bater na constraint.

export type LeadsActionResult = {
  ok: boolean;
  error?: string;
  id?: string;
  /**
   * Deu certo, mas com uma parte que ficou para depois (o Novo lead criado
   * sem a autorizacao declarada): a tela avisa em vez de comemorar.
   */
  aviso?: string;
};

const idSchema = z.uuid();
const nomeSchema = z.string().trim().min(2).max(120);
// Teto por chamada das acoes em massa. A tela divide selecoes maiores em
// lotes deste tamanho (components/leads/em-lotes.ts, LOTE_DE_ACOES), com
// progresso; se algo chegar acima dele, a mensagem diz o porque (achado 95).
const idsSchema = z.array(idSchema).min(1).max(100);
const MENSAGEM_LOTE_GRANDE = "Selecione até 100 leads por vez.";
const canalSchema = z.enum(SOURCE_CHANNELS);

/** Zod recusou por excesso de contatos numa chamada so. */
function passouDoLote(error: z.ZodError): boolean {
  return error.issues.some(
    (issue) => issue.code === "too_big" && issue.path[0] === "contact_ids",
  );
}

// Responsavel precisa ser membro ATIVO da clinica: uuid de fora, vinculo
// pendente ou funcionaria desativada nao vira dono de lead (achado 102).
async function ehMembroAtivo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  userId: string,
): Promise<boolean> {
  const { data: membro } = await supabase
    .from("clinic_member")
    .select("user_id")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .eq("status", "ativo")
    .maybeSingle();
  return membro !== null;
}

// A etapa e uma CHAVE da jornada da clinica (funnel_stage_def), nao mais um
// enum global: cada clinica tem as suas. O formato e validado aqui; a
// EXISTENCIA na jornada e validada pelo gatilho do banco, que recusa com
// 23514 (o mesmo contrato do check antigo). As quatro chaves de sistema
// ('novo', 'agendou', 'compareceu', 'perdido') existem em toda jornada, por
// garantia de gatilho, entao os literais delas continuam seguros.
const etapaSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_]+$/);

const motivoPerdaSchema = z.enum([
  "preco",
  "distancia",
  "horario",
  "nao_respondeu",
  "agendou_em_outro_lugar",
  "outro",
]);

/**
 * Declaracao de como a autorizacao para receber mensagens aconteceu: a da
 * importacao (o lote inteiro) e a do Novo lead (um contato), com as MESMAS
 * opcoes e a mesma regra ("outra" exige observacao). So a frase da recusa
 * muda, para falar de um contato ou de varios.
 */
function schemaDaDeclaracao(mensagemDaOutra: string) {
  return z
    .object({
      opcao: z.enum(["formulario_site", "anuncio_ctwa", "recepcao", "outra"]),
      observacao: z.string().trim().max(300).optional(),
    })
    .refine(
      (declaracao) =>
        declaracao.opcao !== "outra" ||
        (declaracao.observacao != null && declaracao.observacao.length >= 2),
      { message: mensagemDaOutra },
    );
}

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

/**
 * Metadados da acao em audit_log.detalhes (migration 20261020120000): so
 * contagens e escolhas da tela. NUNCA dado de paciente (nome, telefone,
 * texto, id de contato); o id do contato, quando ha um so, vai em entity_id.
 */
type DetalhesDaTrilha = Record<string, string | number | boolean | null>;

async function auditar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  userId: string,
  action: string,
  entity: string,
  entityId: string | null,
  detalhes?: DetalhesDaTrilha,
): Promise<void> {
  await supabase.from("audit_log").insert({
    clinic_id: clinicId,
    user_id: userId,
    action,
    entity,
    entity_id: entityId,
    ...(detalhes ? { detalhes } : {}),
  });
}

// ---------------------------------------------------------------------------
// Abertura da ficha de um contato: trilha antes do dado sair do servidor
// ---------------------------------------------------------------------------
// Regra 3.1: toda leitura de dado de paciente por humano vai para audit_log.
// O drawer NAO consulta o banco pelo navegador: pede o detalhe aqui, e a
// linha "leu ficha_paciente" com o id do contato e gravada ANTES de a
// conversa voltar para a tela. Sem isto, a trilha diria que alguem abriu a
// tela de Leads, nunca de quem foi a conversa que ele leu.
//
// Nao tem guard de escrita: ler a ficha e direito de qualquer papel (a RLS de
// contact, conversation e message recorta clinica e papel). O que muda aqui e
// que a leitura deixa rastro.
//
// As atividades do contato (contact_activity, o texto pode ser dado de saude)
// vem DENTRO do detalhe, e a trilha ganha tambem a linha "leu atividades" com
// o id do contato (a mesma entidade da tela Atividades e do painel da
// conversa). O drawer nunca le a tabela pelo navegador.

export type DetalheDoContatoResult =
  { ok: true; detalhe: LeadDetalhe } | { ok: false; error: string };

export async function abrirDetalheDoContatoAction(
  contactId: unknown,
): Promise<DetalheDoContatoResult> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: "Sessão expirada. Entre de novo." };
  }
  const parsed = idSchema.safeParse(contactId);
  if (!parsed.success) {
    return { ok: false, error: "Contato inválido." };
  }

  const clinicId = context.active.clinicId;
  const supabase = await createClient();
  await Promise.all([
    auditarLeituraDePaciente(supabase, {
      clinicId,
      userId: context.userId,
      entity: "ficha_paciente",
      entityId: parsed.data,
    }),
    auditarLeituraDePaciente(supabase, {
      clinicId,
      userId: context.userId,
      entity: "atividades",
      entityId: parsed.data,
    }),
  ]);

  try {
    const detalhe = await fetchLeadDetalhe(supabase, clinicId, parsed.data);
    if (!detalhe) {
      return { ok: false, error: "Contato não encontrado nesta clínica." };
    }
    return { ok: true, detalhe };
  } catch {
    return { ok: false, error: "Não foi possível carregar a conversa." };
  }
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
    if (passouDoLote(parsed.error)) {
      return { ok: false, error: MENSAGEM_LOTE_GRANDE };
    }
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
    // 23514 e o gatilho do banco recusando: etapa fora da jornada, ou perdido
    // sem motivo. A mensagem do gatilho ja vem em portugues.
    if (error?.code === "23514") {
      return {
        ok: false,
        error:
          "Esta etapa não existe mais na jornada da clínica. Recarregue a página.",
      };
    }
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

// ---------------------------------------------------------------------------
// Lead vira paciente sem consulta (decisao do dono em 20/10/2026)
// ---------------------------------------------------------------------------
// "Vira paciente, e eu preciso incluir várias pessoas aí": um contato (gaveta
// de Leads, painel do Atendimento) ou varios (acao em massa da lista, em
// lotes de 100) passam a kind 'paciente' e aparecem em Pacientes, sem
// consulta. Ate aqui so o gatilho converter_lead_em_paciente (consulta
// marcada) fazia isso. A sessao ja pode gravar kind (policy "recepcao e
// gestao editam contato"): nenhuma migration.
//
// - So quem ainda e lead muda: kind = 'lead' no MESMO update deixa quem ja e
//   paciente como esta, e a contagem diz quantos mudaram de fato.
// - A ETAPA NAO MUDA. Mover para Agendou ou Compareceu geraria conversao
//   falsa para a Meta (registrar_conversao_do_funil); o funil continua onde
//   o contato estava.
// - Sem caminho de volta: o dono nao pediu.
// - Efeitos que ja existem e continuam: automacao de fluxo so pega lead (o
//   executor cancela as pendentes com 'nao_e_lead'); a regua de follow-up
//   segue pela etapa.

const marcarComoPacienteSchema = z.object({ contact_ids: idsSchema });

export type MarcarComoPacienteResult =
  | {
      ok: true;
      /** Quantos eram lead e viraram paciente agora (os outros ja eram). */
      marcados: number;
    }
  | { ok: false; error: string };

export async function marcarComoPacienteAction(
  input: unknown,
): Promise<MarcarComoPacienteResult> {
  const guard = await requireLeadsWriter();
  if ("error" in guard) {
    return {
      ok: false,
      error: guard.error ?? "Seu perfil não pode editar leads e pacientes",
    };
  }
  const parsed = marcarComoPacienteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: passouDoLote(parsed.error)
        ? MENSAGEM_LOTE_GRANDE
        : "Contatos inválidos. Atualize a página e tente de novo.",
    };
  }

  const ids = parsed.data.contact_ids;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact")
    .update({ kind: "paciente" })
    .eq("clinic_id", guard.clinicId)
    .in("id", ids)
    .eq("kind", "lead")
    .select("id");
  if (error) {
    return { ok: false, error: "Não foi possível marcar como paciente." };
  }
  const marcados = (data ?? []).length;
  if (marcados > 0) {
    // Um contato so: o id vai em entity_id, como nas acoes da ficha. Em
    // massa, so a quantidade (as vizinhas gravam a acao sem o id).
    await auditar(
      supabase,
      guard.clinicId,
      guard.context.userId,
      "marcou_como_paciente",
      "contact",
      ids.length === 1 ? (ids[0] ?? null) : null,
      { quantidade: marcados },
    );
    revalidatePath("/leads");
    revalidatePath("/pacientes");
  }
  return { ok: true, marcados };
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
    return {
      ok: false,
      error: passouDoLote(parsed.error)
        ? MENSAGEM_LOTE_GRANDE
        : "Confira os campos informados.",
    };
  }

  const supabase = await createClient();
  if (
    parsed.data.owner_user_id !== null &&
    !(await ehMembroAtivo(supabase, guard.clinicId, parsed.data.owner_user_id))
  ) {
    return {
      ok: false,
      error: "Escolha um membro ativo da clínica como responsável.",
    };
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
    return {
      ok: false,
      error: passouDoLote(parsed.error)
        ? MENSAGEM_LOTE_GRANDE
        : "Confira as etiquetas informadas.",
    };
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

// Autorizacao OPCIONAL no Novo lead (decisao do dono em 20/10/2026, para a
// equipe poder iniciar a conversa pelo sistema): as opcoes e a regra da
// declaracao da importacao. Sem ela, o contato fica sem autorizacao, como
// sempre: cadastrar um lead NAO e autorizacao de disparo (regra 3.3).
const autorizacaoDoNovoLeadSchema = schemaDaDeclaracao(
  "Descreva como o contato autorizou receber mensagens.",
);

const criarLeadSchema = z.object({
  name: nomeSchema.optional(),
  // Texto como veio: a normalizacao unica (lib/domain/telefone.ts) roda aqui
  // no servidor, porque a do formulario nao protege nada.
  phone_e164: z.string().trim().min(1).max(40),
  source_channel: canalSchema.optional(),
  source_origin: z.string().trim().min(1).max(120).optional(),
  source_campaign: z.string().trim().min(1).max(120).optional(),
  owner_user_id: idSchema.optional(),
  insurance_id: idSchema.optional(),
  autorizacao: autorizacaoDoNovoLeadSchema.optional(),
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
    // A unica recusa com frase propria e a "outra" sem observacao.
    const refinado = parsed.error.issues.find((i) => i.code === "custom");
    return {
      ok: false,
      error: refinado?.message ?? "Confira os campos do lead.",
    };
  }

  const telefone = normalizarTelefone(parsed.data.phone_e164);
  if (!telefone) {
    return { ok: false, error: MENSAGEM_TELEFONE_INVALIDO };
  }

  const supabase = await createClient();
  // Mesma regra do reatribuir: o select da tela so oferece membro ativo, mas
  // o cliente nao e confiavel (achado 102).
  if (
    parsed.data.owner_user_id !== undefined &&
    !(await ehMembroAtivo(supabase, guard.clinicId, parsed.data.owner_user_id))
  ) {
    return {
      ok: false,
      error: "Escolha um membro ativo da clínica como responsável.",
    };
  }
  // Duplicado pela CHAVE do telefone: com e sem o nono digito sao a mesma
  // pessoa (o WhatsApp entrega sem, a recepcao digita com). O indice unico
  // de phone_key barra de qualquer jeito; conferir antes so da o nome.
  const { data: existente } = await supabase
    .from("contact")
    .select("id, name")
    .eq("clinic_id", guard.clinicId)
    .eq("phone_key", chaveDeTelefone(telefone))
    .maybeSingle();
  if (existente) {
    return { ok: false, error: mensagemDeTelefoneDuplicado(existente.name) };
  }
  // Origem so entra junto com o canal (method manual, capturada agora); o
  // trigger de origem imutavel preserva depois. Consentimento so com a
  // declaracao, logo abaixo: cadastrar lead nao e autorizacao de disparo
  // (regra 3.3).
  const { data, error } = await supabase
    .from("contact")
    .insert({
      clinic_id: guard.clinicId,
      phone_e164: telefone,
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

  // A autorizacao declarada vira a linha de contact_consent pelo mesmo
  // caminho da ficha (concederConsentimentoAction): fonte da opcao,
  // evidencia com o rotulo e a observacao (a mesma frase da importacao) e a
  // trilha 'concedeu_consentimento'. O contato acabou de nascer, entao nao
  // ha autorizacao vigente nem descadastro para conferir.
  const autorizacao = parsed.data.autorizacao;
  if (autorizacao) {
    const { error: erroDaAutorizacao } = await supabase
      .from("contact_consent")
      .insert({
        clinic_id: guard.clinicId,
        contact_id: data.id,
        channel: "whatsapp",
        source: FONTE_DA_DECLARACAO[autorizacao.opcao],
        evidence: evidenciaDaDeclaracao(autorizacao),
      });
    if (erroDaAutorizacao) {
      // O lead ja existe: dizer "nao foi possivel criar" levaria a criar de
      // novo e esbarrar no telefone repetido. Diz o que faltou e onde fazer.
      revalidatePath("/leads");
      return {
        ok: true,
        id: data.id,
        aviso:
          "O lead foi criado, mas a autorização não foi registrada. Registre na ficha do contato.",
      };
    }
    await auditar(
      supabase,
      guard.clinicId,
      guard.context.userId,
      "concedeu_consentimento",
      "contact",
      data.id,
    );
  }
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
// Importacao de planilha (Tela 4, tarefa 4.4)
// ---------------------------------------------------------------------------
// A action e casca fina: guard de escrita + Zod + auditoria. O miolo vive em
// lib/integrations/importar-contatos.ts (testado com o banco real em
// tests/integration/importacao.test.ts). Um lote por chamada, ate 500 linhas;
// quem divide a planilha e mostra o progresso e a tela.

const declaracaoDeConsentimentoSchema = schemaDaDeclaracao(
  "Descreva como os contatos autorizaram receber mensagens.",
);

const linhaImportadaSchema = z.object({
  name: z.string().trim().min(1).max(120).nullable(),
  phone_e164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  email: z.string().trim().min(3).max(160).nullable(),
  insurance_name: z.string().trim().min(1).max(120).nullable(),
  source_campaign: z.string().trim().min(1).max(120).nullable(),
});

// "Importar como" (decisao do dono em 20/10/2026: "pode ser manualmente ou
// via importação"): Leads, o padrao de sempre, ou Pacientes. Ausente vale
// Leads (a tela antiga, durante a publicacao, continua igual).
const importarContatosSchema = z.object({
  declaracao: declaracaoDeConsentimentoSchema,
  lote: z.array(linhaImportadaSchema).min(1).max(500),
  importar_como: z.enum(["leads", "pacientes"]).optional(),
});

export type ImportarContatosActionResult =
  | {
      ok: true;
      importados: number;
      atualizados: number;
      /** Ja existiam como lead e viraram paciente ("Importar como" Pacientes). */
      viraram_pacientes: number;
      /** Ja existiam como paciente e continuaram como estavam. */
      ja_eram_pacientes: number;
      mantidos_sem_autorizacao: number;
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

  const importarComo = parsed.data.importar_como ?? "leads";
  const supabase = await createClient();
  const resultado = await importarContatos(supabase, guard.clinicId, {
    declaracao: parsed.data.declaracao,
    lote: parsed.data.lote,
    importarComo,
  });
  if (!resultado.ok) {
    return resultado;
  }
  // Uma linha por lote, com a escolha e as contagens do lote (so numeros,
  // nunca dado de paciente).
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "importou_planilha",
    "contact",
    null,
    {
      importar_como: importarComo,
      importados: resultado.importados,
      atualizados: resultado.atualizados,
      viraram_pacientes: resultado.viraram_pacientes,
      ja_eram_pacientes: resultado.ja_eram_pacientes,
      mantidos_sem_autorizacao: resultado.mantidos_sem_autorizacao,
      pulados: resultado.pulados,
    },
  );
  revalidatePath("/leads");
  revalidatePath("/pacientes");
  return resultado;
}
