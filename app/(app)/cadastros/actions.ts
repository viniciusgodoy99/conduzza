"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit } from "@/lib/domain/permissions";
import { createClient } from "@/lib/supabase/server";

// Server Actions da Tela 8 (Cadastros). Escrita e SO de administrador e
// gestor (matriz do brief secao 5; a RLS do banco confere de novo). Toda
// entrada passa por Zod; cliente de SESSAO (RLS aplica); mutacao relevante
// vai para audit_log; exclusao e sempre suave (active = false), porque
// apagar de verdade quebraria agendamentos historicos por FK.

export type CadastroActionResult = {
  ok: boolean;
  error?: string;
  id?: string;
  // code 'consultas_no_periodo': nada foi gravado; ha consultas marcadas no
  // periodo afetado e a tela precisa pedir confirmacao explicita (achado 37).
  code?: "consultas_no_periodo";
  consultas?: number;
  primeiraConsulta?: string | null;
};

// Consultas nao canceladas dos profissionais que ainda nao terminaram e
// cruzam o periodo [inicio, fim). "Ainda nao terminaram" usa o instante
// atual (comparacao de instantes em UTC, sem dia civil envolvido). Erro de
// leitura volta como erro: nunca "zero consultas" falso.
async function contarConsultasNoPeriodo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  professionalIds: string[],
  inicio: string | null,
  fim: string | null,
): Promise<{ total: number; primeira: string | null } | null> {
  const agora = new Date().toISOString();
  const inicioEfetivo =
    inicio !== null && new Date(inicio) > new Date(agora) ? inicio : agora;
  let consulta = supabase
    .from("appointment")
    .select("starts_at", { count: "exact" })
    .eq("clinic_id", clinicId)
    .in("professional_id", professionalIds)
    .not("status", "in", "(cancelado_paciente,cancelado_clinica)")
    .gt("ends_at", inicioEfetivo);
  if (fim !== null) {
    consulta = consulta.lt("starts_at", fim);
  }
  const { data, count, error } = await consulta
    .order("starts_at", { ascending: true })
    .limit(1);
  if (error) {
    return null;
  }
  const primeira = (data?.[0]?.starts_at as string | undefined) ?? null;
  return { total: count ?? 0, primeira };
}

async function requireEditor() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (!canEdit(context.active.role, "cadastros")) {
    return {
      error:
        "Somente administradores e gestores alteram os cadastros." as const,
    };
  }
  return { context, clinicId: context.active.clinicId };
}

const idSchema = z.uuid();
const nomeSchema = z.string().trim().min(2).max(120);
const centavosSchema = z.number().int().min(0).max(100_000_000).nullable();

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
// Profissionais e jornada
// ---------------------------------------------------------------------------

const profissionalSchema = z.object({
  id: idSchema.optional(),
  name: nomeSchema,
  // Conselho de classe em campo LIVRE (spec 3.1): CRM, CRO, CREFITO, CRBM,
  // CRN ou vazio para esteticista. Nunca dropdown fechado.
  council_type: z.string().trim().max(20).nullable(),
  council_number: z.string().trim().max(30).nullable(),
  specialties: z.array(z.string().trim().min(2).max(60)).max(20),
  calendar_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  active: z.boolean(),
  // Desativar com consultas futuras so passa com confirmacao explicita.
  confirmar_consultas: z.boolean().optional(),
});

export async function salvarProfissionalAction(
  input: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = profissionalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos do profissional." };
  }
  const supabase = await createClient();
  const { id, confirmar_consultas, ...campos } = parsed.data;

  if (id) {
    // Desativar tira a coluna do profissional da Agenda, mas nao desmarca
    // nada: as consultas futuras continuam valendo e os lembretes saem.
    // Avisar antes (achado 37; decisao: so avisar e pedir confirmacao).
    if (!campos.active && confirmar_consultas !== true) {
      const { data: atual } = await supabase
        .from("professional")
        .select("active")
        .eq("clinic_id", guard.clinicId)
        .eq("id", id)
        .maybeSingle();
      if (atual?.active === true) {
        const futuras = await contarConsultasNoPeriodo(
          supabase,
          guard.clinicId,
          [id],
          null,
          null,
        );
        if (futuras === null) {
          return {
            ok: false,
            error:
              "Não foi possível conferir as consultas marcadas. Tente de novo.",
          };
        }
        if (futuras.total > 0) {
          return {
            ok: false,
            code: "consultas_no_periodo",
            consultas: futuras.total,
            primeiraConsulta: futuras.primeira,
          };
        }
      }
    }
    const { data } = await supabase
      .from("professional")
      .update(campos)
      .eq("clinic_id", guard.clinicId)
      .eq("id", id)
      .select("id");
    if (!data || data.length === 0) {
      return { ok: false, error: "Não foi possível salvar o profissional." };
    }
    await auditar(
      supabase,
      guard.clinicId,
      guard.context.userId,
      "editou",
      "professional",
      id,
    );
    revalidatePath("/cadastros");
    return { ok: true, id };
  }

  const { data, error } = await supabase
    .from("professional")
    .insert({ clinic_id: guard.clinicId, ...campos })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "Não foi possível criar o profissional." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "criou",
    "professional",
    data.id,
  );
  revalidatePath("/cadastros");
  return { ok: true, id: data.id };
}

const faixaSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  starts_at: z.string().regex(/^\d{2}:\d{2}$/),
  ends_at: z.string().regex(/^\d{2}:\d{2}$/),
  unit_id: idSchema.nullable(),
});

// Substitui a jornada INTEIRA do profissional de uma vez: a grade da tela
// edita o conjunto (almoco = duas faixas no mesmo dia), e reconciliar faixa
// a faixa criaria estados intermediarios invalidos.
export async function salvarJornadaAction(
  professionalId: unknown,
  faixas: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedId = idSchema.safeParse(professionalId);
  const parsedFaixas = z.array(faixaSchema).max(40).safeParse(faixas);
  if (!parsedId.success || !parsedFaixas.success) {
    return { ok: false, error: "Confira os horários informados." };
  }
  for (const faixa of parsedFaixas.data) {
    if (faixa.starts_at === faixa.ends_at) {
      return {
        ok: false,
        error: "Uma faixa não pode começar e terminar no mesmo horário.",
      };
    }
  }

  const supabase = await createClient();
  // Substituicao ATOMICA (delete + insert numa transacao no banco): sem isto,
  // uma falha no insert depois do delete deixava o profissional sem jornada.
  const { error } = await supabase.rpc("substituir_jornada", {
    p_clinic_id: guard.clinicId,
    p_professional_id: parsedId.data,
    p_faixas: parsedFaixas.data.map((faixa) => ({
      weekday: faixa.weekday,
      starts_at: faixa.starts_at,
      ends_at: faixa.ends_at,
      unit_id: faixa.unit_id,
    })),
  });
  if (error) {
    return { ok: false, error: "Não foi possível salvar a jornada." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "editou",
    "professional_schedule",
    parsedId.data,
  );
  revalidatePath("/cadastros");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Procedimentos, convenios, recursos, unidades, pacotes
// ---------------------------------------------------------------------------

const procedimentoSchema = z.object({
  id: idSchema.optional(),
  name: nomeSchema,
  description: z.string().trim().max(2000).nullable(),
  default_duration_min: z.number().int().min(5).max(600),
  base_price_cents: centavosSchema,
  requires_evaluation: z.boolean(),
  prep_instructions: z.string().trim().max(4000).nullable(),
  resource_id: idSchema.nullable(),
  bookable_by_ai: z.boolean(),
  active: z.boolean(),
});

const convenioSchema = z.object({
  id: idSchema.optional(),
  name: nomeSchema,
  plan_name: z.string().trim().max(120).nullable(),
  requires_card: z.boolean(),
  notes: z.string().trim().max(2000).nullable(),
  active: z.boolean(),
});

const recursoSchema = z.object({
  id: idSchema.optional(),
  name: nomeSchema,
  kind: z.enum(["sala", "cabine", "equipamento"]),
  unit_id: idSchema.nullable(),
  active: z.boolean(),
});

const unidadeSchema = z.object({
  id: idSchema.optional(),
  name: nomeSchema,
  address: z.string().trim().max(300).nullable(),
  phone: z.string().trim().max(30).nullable(),
  active: z.boolean(),
});

const pacoteSchema = z.object({
  id: idSchema.optional(),
  procedure_id: idSchema,
  sessions: z.number().int().min(1).max(200),
  price_cents: z.number().int().min(0).max(100_000_000),
  validity_days: z.number().int().min(1).max(3650).nullable(),
  active: z.boolean(),
});

const MENSAGEM_PACOTE_VENDIDO_PROCEDIMENTO =
  "Este pacote já foi vendido, então o procedimento não muda. Para outro procedimento, crie um pacote novo.";
const MENSAGEM_PACOTE_VENDIDO_REMOVER =
  "Este pacote já foi vendido. Desative em vez de remover.";

async function vendasDoPacote(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  packageId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from("package_balance")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("package_id", packageId);
  if (error) {
    return null;
  }
  return count ?? 0;
}

async function salvarEntidade(
  tabela: string,
  schema: z.ZodType<Record<string, unknown>>,
  input: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos informados." };
  }
  const supabase = await createClient();
  const { id, ...campos } = parsed.data as { id?: string } & Record<
    string,
    unknown
  >;

  if (id) {
    const { data } = await supabase
      .from(tabela)
      .update(campos)
      .eq("clinic_id", guard.clinicId)
      .eq("id", id)
      .select("id");
    if (!data || data.length === 0) {
      return { ok: false, error: "Não foi possível salvar." };
    }
    await auditar(
      supabase,
      guard.clinicId,
      guard.context.userId,
      "editou",
      tabela,
      id,
    );
    revalidatePath("/cadastros");
    return { ok: true, id };
  }

  const { data, error } = await supabase
    .from(tabela)
    .insert({ clinic_id: guard.clinicId, ...campos })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "Não foi possível criar o registro." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "criou",
    tabela,
    data.id,
  );
  revalidatePath("/cadastros");
  return { ok: true, id: data.id };
}

export async function salvarProcedimentoAction(
  input: unknown,
): Promise<CadastroActionResult> {
  return salvarEntidade("procedure", procedimentoSchema, input);
}

export async function salvarConvenioAction(
  input: unknown,
): Promise<CadastroActionResult> {
  return salvarEntidade("insurance", convenioSchema, input);
}

export async function salvarRecursoAction(
  input: unknown,
): Promise<CadastroActionResult> {
  return salvarEntidade("resource", recursoSchema, input);
}

export async function salvarUnidadeAction(
  input: unknown,
): Promise<CadastroActionResult> {
  return salvarEntidade("unit", unidadeSchema, input);
}

export async function salvarPacoteAction(
  input: unknown,
): Promise<CadastroActionResult> {
  // Procedimento congelado depois da primeira venda (achado 35): o debito
  // automatico casa o saldo pelo procedimento do pacote, e troca-lo mudaria
  // o saldo de quem ja pagou. O gatilho exigir_cadastro_da_mesma_clinica
  // recusa no banco (23514, inclusive na corrida com uma venda feita entre a
  // conferencia abaixo e o update); aqui so antecipa a mensagem.
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = pacoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos do pacote." };
  }
  const supabase = await createClient();
  const { id, ...campos } = parsed.data;

  if (!id) {
    return salvarEntidade("package", pacoteSchema, input);
  }

  const { data: atual } = await supabase
    .from("package")
    .select("procedure_id")
    .eq("clinic_id", guard.clinicId)
    .eq("id", id)
    .maybeSingle();
  if (!atual) {
    return { ok: false, error: "Pacote não encontrado." };
  }
  if (atual.procedure_id !== campos.procedure_id) {
    const vendas = await vendasDoPacote(supabase, guard.clinicId, id);
    if (vendas === null) {
      return {
        ok: false,
        error:
          "Não foi possível conferir as vendas deste pacote. Tente de novo.",
      };
    }
    if (vendas > 0) {
      return { ok: false, error: MENSAGEM_PACOTE_VENDIDO_PROCEDIMENTO };
    }
  }
  const { data, error } = await supabase
    .from("package")
    .update(campos)
    .eq("clinic_id", guard.clinicId)
    .eq("id", id)
    .select("id");
  if (error || !data || data.length === 0) {
    return {
      ok: false,
      error:
        error?.code === "23514"
          ? MENSAGEM_PACOTE_VENDIDO_PROCEDIMENTO
          : "Não foi possível salvar o pacote.",
    };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "editou",
    "package",
    id,
  );
  revalidatePath("/cadastros");
  return { ok: true, id };
}

// Desativar tira o pacote da venda na ficha do paciente; os saldos ja
// vendidos continuam valendo e sendo debitados.
export async function alternarPacoteAtivoAction(
  id: unknown,
  ativo: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedId = idSchema.safeParse(id);
  const parsedAtivo = z.boolean().safeParse(ativo);
  if (!parsedId.success || !parsedAtivo.success) {
    return { ok: false, error: "Pacote inválido." };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("package")
    .update({ active: parsedAtivo.data })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsedId.data)
    .select("id");
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: parsedAtivo.data
        ? "Não foi possível reativar o pacote."
        : "Não foi possível desativar o pacote.",
    };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    parsedAtivo.data ? "reativou" : "desativou",
    "package",
    parsedId.data,
  );
  revalidatePath("/cadastros");
  return { ok: true, id: parsedId.data };
}

export async function excluirPacoteAction(
  id: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Registro inválido." };
  }
  const supabase = await createClient();
  // Delete real so para pacote que nunca foi vendido. Com venda, a FK de
  // package_balance (NO ACTION) recusa, e o caminho e desativar.
  const vendas = await vendasDoPacote(supabase, guard.clinicId, parsed.data);
  if (vendas === null) {
    return {
      ok: false,
      error: "Não foi possível conferir as vendas deste pacote. Tente de novo.",
    };
  }
  if (vendas > 0) {
    return { ok: false, error: MENSAGEM_PACOTE_VENDIDO_REMOVER };
  }
  const { error } = await supabase
    .from("package")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23503"
          ? MENSAGEM_PACOTE_VENDIDO_REMOVER
          : "Não foi possível remover o pacote.",
    };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "excluiu",
    "package",
    parsed.data,
  );
  revalidatePath("/cadastros");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Vinculos (a matriz de tres pontas)
// ---------------------------------------------------------------------------

const vinculoSchema = z.object({
  id: idSchema.optional(),
  professional_id: idSchema,
  procedure_id: idSchema,
  insurance_id: idSchema.nullable(),
  // Os TRES estados de preco: valor em centavos, coberto (null + covered),
  // ou nao informado (null sem covered).
  price_cents: centavosSchema,
  covered_by_insurance: z.boolean(),
  duration_min: z.number().int().min(5).max(600),
  bookable_by_ai: z.boolean(),
  active: z.boolean(),
});

export async function salvarVinculoAction(
  input: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = vinculoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos do vínculo." };
  }
  if (parsed.data.covered_by_insurance && parsed.data.insurance_id === null) {
    return {
      ok: false,
      error: "Cobertura de convênio exige escolher o convênio.",
    };
  }
  const supabase = await createClient();
  const { id, ...campos } = parsed.data;

  if (id) {
    const { data } = await supabase
      .from("service_link")
      .update(campos)
      .eq("clinic_id", guard.clinicId)
      .eq("id", id)
      .select("id");
    if (!data || data.length === 0) {
      return { ok: false, error: "Não foi possível salvar o vínculo." };
    }
    await auditar(
      supabase,
      guard.clinicId,
      guard.context.userId,
      "editou",
      "service_link",
      id,
    );
    revalidatePath("/cadastros");
    return { ok: true, id };
  }

  const { data, error } = await supabase
    .from("service_link")
    .insert({ clinic_id: guard.clinicId, ...campos })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error:
          "Este profissional já tem vínculo para este procedimento neste convênio. Se ele estiver inativo, reative na lista.",
      };
    }
    return { ok: false, error: "Não foi possível criar o vínculo." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "criou",
    "service_link",
    data.id,
  );
  revalidatePath("/cadastros");
  return { ok: true, id: data.id };
}

export async function alternarVinculoIaAction(
  id: unknown,
  bookable: boolean,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Vínculo inválido." };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("service_link")
    .update({ bookable_by_ai: bookable === true })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data)
    .select("id");
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível alterar a chave da IA." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "editou",
    "service_link",
    parsed.data,
  );
  revalidatePath("/cadastros");
  return { ok: true };
}

// Desativar/Reativar vinculo (achado 33). Suave: appointment.service_link_id
// e FK NO ACTION, e as consultas antigas continuam apontando para ele. O
// vinculo inativo sai do modal de agendamento e da reoferta da lista de
// espera, que ja filtram service_link.active.
export async function alternarVinculoAtivoAction(
  id: unknown,
  ativo: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedId = idSchema.safeParse(id);
  const parsedAtivo = z.boolean().safeParse(ativo);
  if (!parsedId.success || !parsedAtivo.success) {
    return { ok: false, error: "Vínculo inválido." };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("service_link")
    .update({ active: parsedAtivo.data })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsedId.data)
    .select("id");
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: parsedAtivo.data
        ? "Não foi possível reativar o vínculo."
        : "Não foi possível desativar o vínculo.",
    };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    parsedAtivo.data ? "reativou" : "desativou",
    "service_link",
    parsedId.data,
  );
  revalidatePath("/cadastros");
  return { ok: true, id: parsedId.data };
}

export async function duplicarVinculosAction(
  vinculoIds: unknown,
  professionalDestinoId: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedIds = z.array(idSchema).min(1).max(100).safeParse(vinculoIds);
  const parsedDestino = idSchema.safeParse(professionalDestinoId);
  if (!parsedIds.success || !parsedDestino.success) {
    return { ok: false, error: "Escolha os vínculos e o profissional." };
  }

  const supabase = await createClient();
  const { data: origem } = await supabase
    .from("service_link")
    .select(
      "procedure_id, insurance_id, price_cents, covered_by_insurance, duration_min, bookable_by_ai, active",
    )
    .eq("clinic_id", guard.clinicId)
    .in("id", parsedIds.data);
  if (!origem || origem.length === 0) {
    return { ok: false, error: "Vínculos não encontrados." };
  }

  // Copia um a um para tolerar duplicata (unique de tres pontas) e reportar
  // "3 copiados, 1 já existia" em vez de falhar tudo.
  let copiados = 0;
  let existentes = 0;
  for (const vinculo of origem) {
    const { error } = await supabase.from("service_link").insert({
      clinic_id: guard.clinicId,
      professional_id: parsedDestino.data,
      ...vinculo,
    });
    if (!error) {
      copiados++;
    } else if (error.code === "23505") {
      existentes++;
    } else {
      return { ok: false, error: "Não foi possível duplicar os vínculos." };
    }
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "criou",
    "service_link",
    parsedDestino.data,
  );
  revalidatePath("/cadastros");
  return {
    ok: true,
    error:
      existentes > 0
        ? `${copiados} copiado${copiados === 1 ? "" : "s"}, ${existentes} já existia${existentes === 1 ? "" : "m"}.`
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Bloqueios (pontuais, criacao em lote conforme spec 3.9)
// ---------------------------------------------------------------------------

const bloqueioLoteSchema = z.object({
  professional_ids: z.array(idSchema).min(1).max(50),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(2).max(200),
  blocks_overbooking: z.boolean(),
  // Bloqueio sobre consultas ja marcadas so passa com confirmacao explicita.
  confirmar_consultas: z.boolean().optional(),
});

export async function criarBloqueiosEmLoteAction(
  input: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = bloqueioLoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira o período e o motivo do bloqueio." };
  }
  if (new Date(parsed.data.ends_at) <= new Date(parsed.data.starts_at)) {
    return {
      ok: false,
      error: "O fim do bloqueio precisa ser depois do início.",
    };
  }

  const supabase = await createClient();
  // O bloqueio tira os horarios da oferta, mas nao desmarca o que ja estava
  // marcado: as consultas continuam valendo e a regua pede confirmacao ao
  // paciente. Avisar antes (achado 37; decisao: so avisar e pedir
  // confirmacao, a recepcao remarca ou cancela pela Agenda).
  if (parsed.data.confirmar_consultas !== true) {
    const noPeriodo = await contarConsultasNoPeriodo(
      supabase,
      guard.clinicId,
      parsed.data.professional_ids,
      parsed.data.starts_at,
      parsed.data.ends_at,
    );
    if (noPeriodo === null) {
      return {
        ok: false,
        error:
          "Não foi possível conferir as consultas marcadas. Tente de novo.",
      };
    }
    if (noPeriodo.total > 0) {
      return {
        ok: false,
        code: "consultas_no_periodo",
        consultas: noPeriodo.total,
        primeiraConsulta: noPeriodo.primeira,
      };
    }
  }
  const { error } = await supabase.from("professional_block").insert(
    parsed.data.professional_ids.map((professionalId) => ({
      clinic_id: guard.clinicId,
      professional_id: professionalId,
      starts_at: parsed.data.starts_at,
      ends_at: parsed.data.ends_at,
      reason: parsed.data.reason,
      blocks_overbooking: parsed.data.blocks_overbooking,
    })),
  );
  if (error) {
    return { ok: false, error: "Não foi possível criar os bloqueios." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "criou",
    "professional_block",
    null,
  );
  revalidatePath("/cadastros");
  return { ok: true };
}

export async function excluirBloqueioAction(
  id: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Bloqueio inválido." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("professional_block")
    .delete()
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data);
  if (error) {
    return { ok: false, error: "Não foi possível remover o bloqueio." };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "excluiu",
    "professional_block",
    parsed.data,
  );
  revalidatePath("/cadastros");
  return { ok: true };
}
