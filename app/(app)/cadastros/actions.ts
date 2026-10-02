"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import {
  ITENS_POR_PACOTE_MAX,
  NOME_DO_PACOTE_MAX,
  problemaNosItens,
  SESSOES_POR_ITEM_MAX,
} from "@/lib/domain/pacotes";
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
// Procedimentos, convenios, unidades, pacotes (recursos sairam da tela em
// 29/09/2026: continuam no banco, com a trava, sem action de escrita)
// ---------------------------------------------------------------------------

const procedimentoSchema = z.object({
  id: idSchema.optional(),
  name: nomeSchema,
  description: z.string().trim().max(2000).nullable(),
  default_duration_min: z.number().int().min(5).max(600),
  base_price_cents: centavosSchema,
  requires_evaluation: z.boolean(),
  prep_instructions: z.string().trim().max(4000).nullable(),
  // Recursos sairam da tela (decisao do dono em 29/09/2026), mas a coluna e
  // a trava do banco ficam: sem o campo no formulario, o update NAO toca
  // procedure.resource_id (a chave ausente fica fora do update), e o
  // procedimento que ja exigia uma sala continua exigindo.
  resource_id: idSchema.nullable().optional(),
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

const unidadeSchema = z.object({
  id: idSchema.optional(),
  name: nomeSchema,
  address: z.string().trim().max(300).nullable(),
  phone: z.string().trim().max(30).nullable(),
  active: z.boolean(),
});

// Pacote com varios procedimentos (migration 20260929120000): nome, os itens
// (procedimento e sessoes, cada procedimento uma vez), o preco que a clinica
// define e a validade do PACOTE. O preco avulso nao vem da tela: e calculado
// do preco base de cada procedimento (lib/domain/pacotes.ts).
const itemDoPacoteSchema = z.object({
  procedure_id: idSchema,
  sessions: z.number().int().min(1).max(SESSOES_POR_ITEM_MAX),
});

const pacoteSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(NOME_DO_PACOTE_MAX),
  itens: z.array(itemDoPacoteSchema).min(1).max(ITENS_POR_PACOTE_MAX),
  price_cents: z.number().int().min(0).max(100_000_000),
  validity_days: z.number().int().min(1).max(3650).nullable(),
  active: z.boolean(),
});

const MENSAGEM_PACOTE_VENDIDO_REMOVER =
  "Este pacote já foi vendido. Desative em vez de remover.";

// Erros da RPC salvar_pacote. 23514 (regra) e a mensagem em portugues do
// proprio banco, que a tela mostra como veio (ver mensagemDaRegra).
const MENSAGENS_DO_PACOTE: Record<string, string> = {
  "23503": "Um procedimento escolhido não é desta clínica.",
  "42501": "Somente administradores e gestores alteram os cadastros.",
  P0002: "Pacote não encontrado.",
  "22023": "Confira os procedimentos do pacote.",
  "23505": "O mesmo procedimento aparece duas vezes no pacote.",
};

/**
 * Mensagem de regra (23514) que o banco levanta ja em portugues. A mensagem
 * crua de CHECK do Postgres (em ingles, com nome de constraint) nunca vai
 * para a tela: vira o texto padrao.
 */
function mensagemDaRegra(
  error: { code?: string; message?: string },
  padrao: string,
): string {
  if (
    error.code === "23514" &&
    error.message &&
    !/violates|constraint|relation|row-level/i.test(error.message)
  ) {
    return error.message;
  }
  return MENSAGENS_DO_PACOTE[error.code ?? ""] ?? padrao;
}

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

// "IA pode agendar" tem uma fonte so: o vinculo segue a chave do
// procedimento. O modal so regrava os vinculos (RPC
// sincronizar_vinculos_do_procedimento) quando "Quem faz e convenios", o
// preco base, a duracao ou a chave mudaram em relacao a abertura; com o
// catalogo desatualizado (outro gestor mudou a chave no meio), a comparacao
// diria "nada mudou" e os vinculos ficariam com a chave antiga. Por isso o
// Salvar do procedimento alinha a chave dos vinculos aqui, sem criar nem
// desativar vinculo (a RLS de service_link vale: admin e gestor).
export async function salvarProcedimentoAction(
  input: unknown,
): Promise<CadastroActionResult> {
  const resultado = await salvarEntidade("procedure", procedimentoSchema, input);
  if (!resultado.ok || !resultado.id) {
    return resultado;
  }
  const parsed = procedimentoSchema.safeParse(input);
  if (parsed.success) {
    const supabase = await createClient();
    // Falha aqui nao desfaz o Salvar ja gravado: o proximo Salvar ou a
    // sincronizacao dos vinculos alinham de novo.
    await supabase
      .from("service_link")
      .update({ bookable_by_ai: parsed.data.bookable_by_ai })
      .eq("procedure_id", resultado.id)
      .neq("bookable_by_ai", parsed.data.bookable_by_ai);
  }
  return resultado;
}

export async function salvarConvenioAction(
  input: unknown,
): Promise<CadastroActionResult> {
  return salvarEntidade("insurance", convenioSchema, input);
}

export async function salvarUnidadeAction(
  input: unknown,
): Promise<CadastroActionResult> {
  return salvarEntidade("unit", unidadeSchema, input);
}

// Cria ou edita o pacote e os itens numa transacao so no banco (RPC
// salvar_pacote, SECURITY INVOKER: a RLS e o papel da sessao valem la
// dentro). Pacote ja vendido: nome, preco, validade e "a venda" mudam; os
// itens (procedimentos e sessoes) ficam congelados, porque a venda copiou os
// itens para o saldo do paciente e o pacote precisa continuar dizendo o que
// foi vendido. O banco recusa com 23514 (inclusive na corrida com uma venda
// feita no meio); mandar os MESMOS itens de sempre passa.
export async function salvarPacoteAction(
  input: unknown,
): Promise<CadastroActionResult> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = pacoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos do pacote." };
  }
  const { id, name, itens, price_cents, validity_days, active } = parsed.data;
  const problema = problemaNosItens(itens);
  if (problema) {
    return { ok: false, error: problema };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("salvar_pacote", {
    p_clinic_id: guard.clinicId,
    p_name: name,
    p_itens: itens,
    p_price_cents: price_cents,
    p_validity_days: validity_days,
    p_active: active,
    p_package_id: id ?? null,
  });
  if (error || typeof data !== "string") {
    return {
      ok: false,
      error: error
        ? mensagemDaRegra(error, "Não foi possível salvar o pacote.")
        : "Não foi possível salvar o pacote.",
    };
  }
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    id ? "editou" : "criou",
    "package",
    data,
  );
  revalidatePath("/cadastros");
  revalidatePath("/pacientes");
  return { ok: true, id: data };
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
// Vinculos dentro do Procedimento ("Quem faz e convenios")
// ---------------------------------------------------------------------------
// Desde 29/09/2026 o vinculo de tres pontas so e editado aqui: a aba Vinculos
// saiu de Cadastros, e com ela as actions de salvar, alternar IA, ativar e
// duplicar um vinculo solto.

// Uma linha por profissional e convenio, com o valor CONCRETO (o "padrao do
// procedimento" ja virou preco e duracao na tela, lib/domain/vinculos-do-
// procedimento.ts). bookable_by_ai nao vem daqui: segue o procedimento, e a
// RPC le a chave dele no banco.
const vinculoDoProcedimentoSchema = z
  .object({
    professional_id: idSchema,
    insurance_id: idSchema.nullable(),
    price_cents: centavosSchema,
    covered_by_insurance: z.boolean(),
    duration_min: z.number().int().min(5).max(600),
  })
  .refine((v) => !v.covered_by_insurance || v.insurance_id !== null);

export type ResultadoDosVinculosDoProcedimento = CadastroActionResult & {
  resumo?: {
    criados: number;
    reativados: number;
    atualizados: number;
    desativados: number;
    /** Consultas futuras que continuam marcadas nos vinculos que sairam */
    consultasFuturas: number;
  };
};

const MENSAGENS_DA_SINCRONIZACAO: Record<string, string> = {
  // Profissional ou convenio de outra clinica (gatilho de isolamento).
  "23503": "Um profissional ou convênio escolhido não é desta clínica.",
  "42501": "Somente administradores e gestores alteram os cadastros.",
  P0002: "Procedimento não encontrado.",
  "22023": "Confira o preço e a duração de cada profissional e convênio.",
  // Corrida com outra gravacao do mesmo vinculo por outro caminho.
  "23505":
    "Outra pessoa alterou estes vínculos agora. Feche, abra de novo e salve.",
};

// Grava de uma vez quem faz o procedimento e por quais convenios: cria,
// reativa e atualiza o que esta na lista e DESATIVA (nunca apaga) o que saiu,
// numa transacao so no banco (RPC sincronizar_vinculos_do_procedimento,
// SECURITY INVOKER: a RLS e o papel da sessao valem la dentro tambem).
export async function sincronizarVinculosDoProcedimentoAction(
  procedureId: unknown,
  linhas: unknown,
): Promise<ResultadoDosVinculosDoProcedimento> {
  const guard = await requireEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsedId = idSchema.safeParse(procedureId);
  const parsedLinhas = z
    .array(vinculoDoProcedimentoSchema)
    .max(500)
    .safeParse(linhas);
  if (!parsedId.success || !parsedLinhas.success) {
    return {
      ok: false,
      error: "Confira o preço e a duração de cada profissional e convênio.",
    };
  }
  const chaves = new Set(
    parsedLinhas.data.map(
      (linha) => `${linha.professional_id}:${linha.insurance_id ?? ""}`,
    ),
  );
  if (chaves.size !== parsedLinhas.data.length) {
    return {
      ok: false,
      error: "O mesmo profissional aparece duas vezes no mesmo convênio.",
    };
  }

  const supabase = await createClient();
  // So o procedimento da clinica ATIVA. A RLS deixa quem e membro de duas
  // clinicas enxergar o procedimento da outra, e a RPC aceitaria (o papel e
  // conferido na clinica do procedimento), mas a trilha abaixo iria para a
  // clinica ativa com o id de um procedimento que nao e dela.
  const { data: procedimento, error: erroDoProcedimento } = await supabase
    .from("procedure")
    .select("id")
    .eq("id", parsedId.data)
    .eq("clinic_id", guard.clinicId)
    .maybeSingle();
  if (erroDoProcedimento) {
    return {
      ok: false,
      error: "Não foi possível salvar quem faz e os convênios.",
    };
  }
  if (!procedimento) {
    return { ok: false, error: "Procedimento não encontrado." };
  }
  const { data, error } = await supabase.rpc(
    "sincronizar_vinculos_do_procedimento",
    {
      p_procedure_id: parsedId.data,
      p_linhas: parsedLinhas.data,
    },
  );
  if (error) {
    return {
      ok: false,
      error:
        MENSAGENS_DA_SINCRONIZACAO[error.code ?? ""] ??
        "Não foi possível salvar quem faz e os convênios.",
    };
  }
  const contagem = (data ?? {}) as Partial<
    Record<
      | "criados"
      | "reativados"
      | "atualizados"
      | "desativados"
      | "consultas_futuras",
      number
    >
  >;
  await auditar(
    supabase,
    guard.clinicId,
    guard.context.userId,
    "editou_vinculos_do_procedimento",
    "procedure",
    parsedId.data,
  );
  revalidatePath("/cadastros");
  return {
    ok: true,
    id: parsedId.data,
    resumo: {
      criados: contagem.criados ?? 0,
      reativados: contagem.reativados ?? 0,
      atualizados: contagem.atualizados ?? 0,
      desativados: contagem.desativados ?? 0,
      consultasFuturas: contagem.consultas_futuras ?? 0,
    },
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
  // O bloqueio e criado e removido pela Agenda (a aba de Cadastros saiu).
  revalidatePath("/agenda");
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
  revalidatePath("/agenda");
  revalidatePath("/cadastros");
  return { ok: true };
}
