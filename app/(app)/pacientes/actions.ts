"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { diaCivil, somarDias } from "@/lib/domain/horarios";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import {
  chaveDeTelefone,
  MENSAGEM_TELEFONE_INVALIDO,
  mensagemDeTelefoneDuplicado,
  normalizarTelefone,
} from "@/lib/domain/telefone";
import { createClient } from "@/lib/supabase/server";

// Server Actions da ficha do paciente (Tela 9, tarefa 4.5): editar o cadastro
// e o saldo de pacote (vender, ajustar e cancelar a venda). Consentimento e
// etiqueta ja existem em app/(app)/leads/actions.ts e sao IMPORTADAS pela
// ficha, nao reescritas: a regra de revogacao definitiva e a de evidencia de
// reconsentimento moram num lugar so. Guard, Zod, cliente de SESSAO (a RLS
// manda) e audit_log seguem o molde de requireLeadsWriter.

export type PacientesActionResult = { ok: boolean; error?: string };

const idSchema = z.uuid();
const diaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function requirePacientesWriter() {
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
    role: context.active.role,
  };
}

/**
 * Mensagem do banco que pode ir para a tela: as funcoes e gatilhos do saldo
 * de pacote levantam o motivo ja em portugues. Mensagem crua do Postgres (em
 * ingles, com nome de tabela e de constraint) nunca vai: vira o texto padrao.
 */
function mensagemDoBanco(
  error: { code?: string; message?: string } | null,
  padrao: string,
): string {
  const codigosComMotivo = ["23514", "23503", "P0002", "42501"];
  if (
    error?.code &&
    codigosComMotivo.includes(error.code) &&
    error.message &&
    !/violates|permission denied|row-level|relation|constraint/i.test(
      error.message,
    )
  ) {
    return error.message;
  }
  return padrao;
}

// Campo anulavel: null LIMPA, texto troca. O formulario da ficha manda todos
// os campos a cada salvamento, entao nao existe caso de campo ausente.
const atualizarPacienteSchema = z.object({
  contact_id: idSchema,
  name: z.string().trim().min(2).max(120).nullable(),
  // Texto como veio: a normalizacao unica (lib/domain/telefone.ts) roda na
  // action, porque a do formulario nao protege nada.
  phone_e164: z.string().trim().min(1).max(40),
  email: z.email().max(160).nullable(),
  // So digitos: a mascara e da tela, o banco guarda o numero limpo.
  cpf: z
    .string()
    .regex(/^\d{11}$/)
    .nullable(),
  birth_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  insurance_id: idSchema.nullable(),
  insurance_card: z.string().trim().min(1).max(60).nullable(),
  notes: z.string().trim().max(2000).nullable(),
});

export async function atualizarPacienteAction(
  input: unknown,
): Promise<PacientesActionResult> {
  const guard = await requirePacientesWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = atualizarPacienteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos do cadastro." };
  }
  const dados = parsed.data;
  const telefoneDigitado = normalizarTelefone(dados.phone_e164);
  if (!telefoneDigitado) {
    return { ok: false, error: MENSAGEM_TELEFONE_INVALIDO };
  }

  const supabase = await createClient();
  // O contato precisa ser da clinica ativa. A RLS ja recorta, mas sem esta
  // conferencia um id de fora voltaria "não foi possível salvar" sem dizer
  // por que.
  const { data: dono } = await supabase
    .from("contact")
    .select("id, phone_e164")
    .eq("clinic_id", guard.clinicId)
    .eq("id", dados.contact_id)
    .maybeSingle();
  if (!dono) {
    return { ok: false, error: "Paciente não encontrado nesta clínica." };
  }
  // Mesma chave que o numero gravado (a recepcao so acrescentou ou tirou o
  // nono digito): mantem o GRAVADO, que e a forma que o WhatsApp entregou e
  // com certeza recebe mensagem. Trocar pela digitada nao muda a pessoa, so
  // arrisca o envio.
  const chaveNova = chaveDeTelefone(telefoneDigitado);
  const telefone =
    chaveDeTelefone(dono.phone_e164 as string) === chaveNova
      ? (dono.phone_e164 as string)
      : telefoneDigitado;
  // Numero de OUTRA pessoa (pela chave, com ou sem o nono digito): recusa
  // dizendo quem, em vez de juntar dois pacientes num telefone so.
  const { data: outro } = await supabase
    .from("contact")
    .select("id, name")
    .eq("clinic_id", guard.clinicId)
    .eq("phone_key", chaveNova)
    .neq("id", dados.contact_id)
    .maybeSingle();
  if (outro) {
    return { ok: false, error: mensagemDeTelefoneDuplicado(outro.name) };
  }
  // Convenio de OUTRA clinica nao entra: a chave estrangeira aponta para
  // insurance sem olhar clinica, entao a checagem tem que ser explicita.
  if (dados.insurance_id !== null) {
    const { data: convenio } = await supabase
      .from("insurance")
      .select("id")
      .eq("clinic_id", guard.clinicId)
      .eq("id", dados.insurance_id)
      .maybeSingle();
    if (!convenio) {
      return { ok: false, error: "Convênio não encontrado nesta clínica." };
    }
  }

  const { data, error } = await supabase
    .from("contact")
    .update({
      name: dados.name,
      phone_e164: telefone,
      email: dados.email,
      cpf: dados.cpf,
      birth_date: dados.birth_date,
      insurance_id: dados.insurance_id,
      insurance_card: dados.insurance_card,
      notes: dados.notes,
    })
    .eq("clinic_id", guard.clinicId)
    .eq("id", dados.contact_id)
    .select("id");
  if (error || !data || data.length === 0) {
    if (error?.code === "23505") {
      return { ok: false, error: "Já existe um contato com este telefone." };
    }
    return { ok: false, error: "Não foi possível salvar o cadastro." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "editou",
    entity: "contact",
    entity_id: dados.contact_id,
  });
  revalidatePath("/pacientes");
  revalidatePath(`/pacientes/${dados.contact_id}`);
  revalidatePath("/leads");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Saldo de pacote (achado 71 da revisao de liberacao)
// ---------------------------------------------------------------------------

// Venda. Alem da venda de hoje, cobre o pacote EM ANDAMENTO de quem chega ao
// sistema no meio de um pacote comprado antes: sessoes ja usadas e a data em
// que o pacote comecou (a validade conta dali). Sem isso o saldo nascia
// errado desde o primeiro dia.
const venderPacoteSchema = z.object({
  contact_id: idSchema,
  package_id: idSchema,
  sessions_used: z.number().int().min(0).max(1000).default(0),
  inicio: diaSchema.optional(),
});

export async function venderPacoteAction(
  input: unknown,
): Promise<PacientesActionResult> {
  const guard = await requirePacientesWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = venderPacoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira o pacote, as sessões e a data." };
  }
  const dados = parsed.data;

  const supabase = await createClient();
  // O contato precisa ser da clinica ativa (o gatilho de coerencia confere de
  // novo; aqui so devolve mensagem melhor).
  const { data: dono } = await supabase
    .from("contact")
    .select("id")
    .eq("clinic_id", guard.clinicId)
    .eq("id", dados.contact_id)
    .maybeSingle();
  if (!dono) {
    return { ok: false, error: "Paciente não encontrado nesta clínica." };
  }
  const { data: pacoteRow } = await supabase
    .from("package")
    .select("sessions, validity_days, active")
    .eq("clinic_id", guard.clinicId)
    .eq("id", dados.package_id)
    .maybeSingle();
  if (!pacoteRow) {
    return { ok: false, error: "Pacote não encontrado." };
  }
  const pacote = pacoteRow as {
    sessions: number;
    validity_days: number | null;
    active: boolean;
  };
  if (!pacote.active) {
    return {
      ok: false,
      error: "Este pacote está desativado e não pode ser vendido.",
    };
  }
  if (dados.sessions_used >= pacote.sessions) {
    return {
      ok: false,
      error: `As sessões já usadas precisam ser menos que as ${pacote.sessions} do pacote.`,
    };
  }

  // Dia civil do fuso da clinica (regra 3.6): vendido hoje com 90 dias vence
  // no dia local correto, nao no dia UTC do servidor.
  const hoje = diaCivil(guard.timezone, new Date());
  const inicio = dados.inicio ?? hoje;
  if (inicio > hoje) {
    return {
      ok: false,
      error: "A data de início não pode ser depois de hoje.",
    };
  }
  const expiraEm =
    pacote.validity_days !== null
      ? somarDias(inicio, pacote.validity_days)
      : null;
  if (expiraEm !== null && expiraEm < hoje) {
    return {
      ok: false,
      error:
        "Com essa data de início o pacote já teria vencido. Confira a data.",
    };
  }

  const { data, error } = await supabase
    .from("package_balance")
    .insert({
      clinic_id: guard.clinicId,
      contact_id: dados.contact_id,
      package_id: dados.package_id,
      sessions_total: pacote.sessions,
      sessions_used: dados.sessions_used,
      expires_at: expiraEm,
    })
    .select("id")
    .single();
  if (error || !data) {
    // 23514 do gatilho de coerencia: pacote desativado entre abrir a janela e
    // confirmar. A mensagem do gatilho ja e a que a recepcao entende.
    return {
      ok: false,
      error: mensagemDoBanco(error, "Não foi possível registrar o pacote."),
    };
  }
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "vendeu_pacote",
    entity: "package_balance",
    entity_id: data.id as string,
  });
  revalidatePath("/pacientes");
  revalidatePath(`/pacientes/${dados.contact_id}`);
  revalidatePath("/leads");
  return { ok: true };
}

// Motivo: obrigatorio e guardado (package_balance_adjustment), nao so pedido
// na tela.
const motivoSchema = z.string().trim().min(3).max(500);

/** Saldo da clinica ativa; o contato serve para recarregar a ficha certa. */
async function saldoDaClinica(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  balanceId: string,
): Promise<{ id: string; contact_id: string } | null> {
  const { data } = await supabase
    .from("package_balance")
    .select("id, contact_id")
    .eq("clinic_id", clinicId)
    .eq("id", balanceId)
    .maybeSingle();
  return (data as { id: string; contact_id: string } | null) ?? null;
}

const ajustarSaldoSchema = z.object({
  balance_id: idSchema,
  sessions_used: z.number().int().min(0).max(1000),
  /** null = o pacote nao vence */
  expires_at: diaSchema.nullable(),
  motivo: motivoSchema,
});

// Ajuste: sessoes usadas (0 ate o total) e validade. Papel: admin, gestor e
// recepcao, igual a policy "recepcao e gestao ajustam saldo". A funcao do
// banco muda o saldo e grava o historico com o motivo na mesma transacao.
export async function ajustarSaldoDePacoteAction(
  input: unknown,
): Promise<PacientesActionResult> {
  const guard = await requirePacientesWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = ajustarSaldoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira as sessões usadas, a validade e o motivo.",
    };
  }
  const dados = parsed.data;

  const supabase = await createClient();
  const saldo = await saldoDaClinica(
    supabase,
    guard.clinicId,
    dados.balance_id,
  );
  if (!saldo) {
    return {
      ok: false,
      error: "Saldo de pacote não encontrado nesta clínica.",
    };
  }

  const { error } = await supabase.rpc("ajustar_saldo_de_pacote", {
    p_balance_id: dados.balance_id,
    p_sessions_used: dados.sessions_used,
    p_expires_at: dados.expires_at,
    p_reason: dados.motivo,
  });
  if (error) {
    return {
      ok: false,
      error: mensagemDoBanco(error, "Não foi possível ajustar o saldo."),
    };
  }
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "ajustou_saldo_de_pacote",
    entity: "package_balance",
    entity_id: dados.balance_id,
  });
  revalidatePath("/pacientes");
  revalidatePath(`/pacientes/${saldo.contact_id}`);
  return { ok: true };
}

const cancelarVendaSchema = z.object({
  balance_id: idSchema,
  motivo: motivoSchema,
});

// Nao exportada: arquivo "use server" so exporta funcao assincrona. A ficha
// repete a mesma frase na dica do botao desabilitado.
const DICA_CANCELAR_VENDA =
  "Só administrador e gestor cancelam venda de pacote";

// Cancelamento: so admin e gestor, igual a policy "gestao remove saldo". Venda
// que ja descontou sessao de consulta nao se cancela (a consulta guarda o
// saldo que descontou); o banco recusa com a orientacao de ajustar.
export async function cancelarVendaDePacoteAction(
  input: unknown,
): Promise<PacientesActionResult> {
  const guard = await requirePacientesWriter();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  if (guard.role !== "admin" && guard.role !== "gestor") {
    return { ok: false, error: DICA_CANCELAR_VENDA };
  }
  const parsed = cancelarVendaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Escreva o motivo do cancelamento." };
  }
  const dados = parsed.data;

  const supabase = await createClient();
  const saldo = await saldoDaClinica(
    supabase,
    guard.clinicId,
    dados.balance_id,
  );
  if (!saldo) {
    return {
      ok: false,
      error: "Saldo de pacote não encontrado nesta clínica.",
    };
  }

  const { error } = await supabase.rpc("cancelar_venda_de_pacote", {
    p_balance_id: dados.balance_id,
    p_reason: dados.motivo,
  });
  if (error) {
    return {
      ok: false,
      error: mensagemDoBanco(error, "Não foi possível cancelar a venda."),
    };
  }
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "cancelou_venda_de_pacote",
    entity: "package_balance",
    entity_id: dados.balance_id,
  });
  revalidatePath("/pacientes");
  revalidatePath(`/pacientes/${saldo.contact_id}`);
  revalidatePath("/leads");
  return { ok: true };
}
