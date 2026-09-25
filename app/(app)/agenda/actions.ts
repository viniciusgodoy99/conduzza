"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { getSessionContext } from "@/lib/auth/active-clinic";
import type { AppointmentStatus } from "@/lib/design/status";
import {
  comparecimentoLiberado,
  DICA_COMPARECEU_ANTES_DO_DIA,
  DICA_FALTA_ANTES_DO_HORARIO,
  DICA_REMARCAR_ENCERRADA,
  eCancelamento,
  exigeCanal,
  faltaLiberada,
  MENSAGEM_PROFISSIONAL_INATIVO,
  podeRemarcar,
  podeTransicionar,
  statusAposRemarcar,
} from "@/lib/domain/appointment-status";
import { diaCivil } from "@/lib/domain/horarios";
import { renderizarModelo } from "@/lib/domain/modelo-mensagem";
import {
  cabeNaJornada,
  colideComBloqueio,
  MENSAGEM_SEM_VINCULO,
  vinculoEquivalente,
} from "@/lib/domain/remarcacao";
import { AVISO_REMARCACAO } from "@/lib/domain/textos-padrao";
import { canEdit } from "@/lib/domain/permissions";
import {
  chaveDeTelefone,
  MENSAGEM_TELEFONE_INVALIDO,
  normalizarTelefone,
} from "@/lib/domain/telefone";
import {
  contasDeEnvio,
  fraseDeNumerosDesconectados,
  nomesParaATela,
} from "@/lib/jobs/numero-de-envio";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Server Actions da Agenda (Tela 3). Guard: canEdit(role, "agenda"); o papel
// 'profissional' so age na propria agenda (a RLS confere de novo, na policy).
// Regras duras: conflito de horario e a exclusion constraint (23P01, nunca
// checagem de codigo); 'faltou' so por acao explicita; toda mudanca de
// status grava a linha do historico com autoria e canal.

export type AgendaActionResult = {
  ok: boolean;
  error?: string;
  code?:
    | "conflito"
    | "conflito_recurso"
    | "ja_tratado"
    // Remarcar: situacao final, sem vinculo no profissional de destino,
    // fora da jornada ou em cima de bloqueio. Os tres ultimos a tela corrige
    // escolhendo outro horario ou profissional, com o dialogo aberto.
    | "situacao_final"
    | "sem_vinculo"
    | "fora_da_jornada"
    | "bloqueado"
    // Mudar situacao: falta antes do horario da consulta, e Compareceu
    // antes do dia dela.
    | "falta_antes_do_horario"
    | "comparecimento_antes_do_dia";
  id?: string;
  /**
   * A acao deu certo, mas algo que a recepcao pediu junto nao aconteceu (ex.:
   * o aviso de remarcacao nao saiu porque o paciente nao autorizou). A tela
   * mostra como aviso, nunca como sucesso silencioso.
   */
  aviso?: string;
  /**
   * Cadastro rapido: o telefone ja era de um contato (casado pela chave, com
   * ou sem o nono digito) e o id devolvido e o DELE. `nome` e `telefone` sao
   * os desse cadastro (o nome digitado so entra quando ele estava sem nome):
   * a tela mostra estes, nunca o que foi digitado, e avisa a recepcao.
   */
  existente?: boolean;
  nome?: string | null;
  telefone?: string;
};

const idSchema = z.uuid();
const instanteSchema = z.iso.datetime({ offset: true });

const EXCLUSION_VIOLATION = "23P01";

async function requireAgendaEditor() {
  const context = await getSessionContext();
  if (!context?.active) {
    return { error: "Sessão expirada. Entre de novo." as const };
  }
  if (!canEdit(context.active.role, "agenda")) {
    return { error: "Seu perfil não pode alterar a agenda." as const };
  }
  return {
    context,
    clinicId: context.active.clinicId,
    clinicName: context.active.clinicName,
    timezone: context.active.timezone,
  };
}

async function registrarHistorico(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  appointmentId: string,
  status: AppointmentStatus,
  userId: string,
): Promise<void> {
  await supabase.from("appointment_status_history").insert({
    clinic_id: clinicId,
    appointment_id: appointmentId,
    status,
    changed_by: "usuario",
    changed_by_user_id: userId,
  });
}

// ---------------------------------------------------------------------------
// Paciente rapido (o "criar ali mesmo" do modal)
// ---------------------------------------------------------------------------

const pacienteRapidoSchema = z.object({
  name: z.string().trim().min(2).max(120),
  // Texto como veio (pode ser colado do WhatsApp Web, "+55 85 99999-0000"):
  // quem decide se e telefone e a normalizacao unica, logo abaixo.
  phone: z.string().trim().min(1).max(40),
});

export async function criarPacienteRapidoAction(
  input: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = pacienteRapidoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Informe nome e telefone com DDD." };
  }
  // Normalizacao UNICA de telefone (lib/domain/telefone.ts). Antes o "+" era
  // arrancado no cliente e o servidor punha +55 na frente de novo: colar
  // "+55 85 99999-0000" gravava +555585999990000, numero que nao existe.
  const telefone = normalizarTelefone(parsed.data.phone);
  if (!telefone) {
    return { ok: false, error: MENSAGEM_TELEFONE_INVALIDO };
  }

  const supabase = await createClient();
  // Casamento pela CHAVE: com e sem o nono digito sao a mesma pessoa (o
  // WhatsApp entrega sem, a recepcao digita com).
  const buscarExistente = async () =>
    await supabase
      .from("contact")
      .select("id, name, phone_e164")
      .eq("clinic_id", guard.clinicId)
      .eq("phone_key", chaveDeTelefone(telefone))
      .maybeSingle();

  // O telefone ja tem cadastro: a consulta fica NELE, com o nome DELE (a tela
  // diz isso e nunca mostra o nome digitado como se fosse o do cadastro).
  // Cadastro sem nome (contato do WhatsApp que chegou sem pushname) ganha o
  // nome digitado, com update guardado por name is null: nunca sobrescreve um
  // nome que alguem ja deu (achado R6).
  const usarExistente = async (existente: {
    id: string;
    name: string | null;
    phone_e164: string;
  }): Promise<AgendaActionResult> => {
    let nome = existente.name ?? null;
    if (nome === null) {
      const { data: nomeado } = await supabase
        .from("contact")
        .update({ name: parsed.data.name })
        .eq("clinic_id", guard.clinicId)
        .eq("id", existente.id)
        .is("name", null)
        .select("name");
      if (nomeado && nomeado.length > 0) {
        nome = (nomeado[0]?.name as string | null | undefined) ?? null;
        await supabase.from("audit_log").insert({
          clinic_id: guard.clinicId,
          user_id: guard.context.userId,
          action: "editou",
          entity: "contact",
          entity_id: existente.id,
        });
      }
    }
    return {
      ok: true,
      id: existente.id,
      existente: true,
      nome,
      telefone: existente.phone_e164,
    };
  };

  const { data: existente } = await buscarExistente();
  if (existente) {
    return await usarExistente(existente);
  }
  const { data, error } = await supabase
    .from("contact")
    .insert({
      clinic_id: guard.clinicId,
      name: parsed.data.name,
      phone_e164: telefone,
      kind: "paciente",
    })
    .select("id")
    .single();
  if (error || !data) {
    // Corrida: outra pessoa (ou o WhatsApp) criou o mesmo numero entre a
    // busca e o insert. O indice unico da chave barrou; devolve o que ficou.
    if (error?.code === "23505") {
      const { data: criadoAgora } = await buscarExistente();
      if (criadoAgora) {
        return await usarExistente(criadoAgora);
      }
    }
    return { ok: false, error: "Não foi possível criar o cadastro." };
  }
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "criou",
    entity: "contact",
    entity_id: data.id,
  });
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Criar agendamento (modal, tarefa 2.6)
// ---------------------------------------------------------------------------

const criarSchema = z.object({
  contact_id: idSchema,
  professional_id: idSchema,
  service_link_id: idSchema,
  unit_id: idSchema.nullable(),
  // resource_id vem do cliente por conveniencia, mas o servidor confia SO no
  // recurso do procedimento (resolvido abaixo).
  resource_id: idSchema.nullable(),
  starts_at: instanteSchema,
  is_overbooking: z.boolean(),
  send_confirmation: z.boolean(),
  notes: z.string().trim().max(2000).nullable(),
});

// A mensagem certa para cada trava: a exclusion do PROFISSIONAL e a do RECURSO
// tem o mesmo codigo (23P01), mas o usuario precisa saber qual foi para
// decidir (encaixe resolve conflito de profissional, nunca de recurso).
function mensagemDeConflito(mensagemDoBanco: string | undefined): {
  code: "conflito" | "conflito_recurso";
  error: string;
} {
  if ((mensagemDoBanco ?? "").includes("sem_sobreposicao_recurso")) {
    return {
      code: "conflito_recurso",
      error:
        "O recurso deste procedimento (sala ou equipamento) está ocupado neste horário. Escolha outro horário.",
    };
  }
  return {
    code: "conflito",
    error:
      "Este horário acabou de ser ocupado. Escolha outro ou marque como encaixe.",
  };
}

export async function criarAgendamentoAction(
  input: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = criarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira os campos do agendamento." };
  }

  const supabase = await createClient();

  // O SERVIDOR nao confia na duracao nem no recurso do cliente: le o vinculo e
  // o procedimento e recalcula. Sem isto, um payload forjado (ends_at curto)
  // furaria a exclusion constraint, que so avalia o range declarado.
  const { data: vinculo } = await supabase
    .from("service_link")
    .select("duration_min, procedure:procedure_id (resource_id)")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.service_link_id)
    .maybeSingle();
  if (!vinculo) {
    return { ok: false, error: "Vínculo de atendimento inválido." };
  }
  const procedure = Array.isArray(vinculo.procedure)
    ? vinculo.procedure[0]
    : vinculo.procedure;
  const resourceId = (procedure?.resource_id as string | null) ?? null;
  const ends_at = new Date(
    new Date(parsed.data.starts_at).getTime() +
      (vinculo.duration_min as number) * 60_000,
  ).toISOString();

  // Encaixe sob bloqueio que impede encaixe: recusar antes do insert (o
  // bloqueio nao e constraint; e regra de negocio do blocks_overbooking).
  if (parsed.data.is_overbooking) {
    const { data: bloqueios } = await supabase
      .from("professional_block")
      .select("id")
      .eq("clinic_id", guard.clinicId)
      .eq("professional_id", parsed.data.professional_id)
      .eq("blocks_overbooking", true)
      .lt("starts_at", ends_at)
      .gt("ends_at", parsed.data.starts_at)
      .limit(1);
    if (bloqueios && bloqueios.length > 0) {
      return {
        ok: false,
        error: "Este período está bloqueado sem permissão de encaixe.",
      };
    }
  }

  const { data, error } = await supabase
    .from("appointment")
    .insert({
      clinic_id: guard.clinicId,
      contact_id: parsed.data.contact_id,
      professional_id: parsed.data.professional_id,
      service_link_id: parsed.data.service_link_id,
      unit_id: parsed.data.unit_id,
      resource_id: resourceId,
      starts_at: parsed.data.starts_at,
      ends_at,
      is_overbooking: parsed.data.is_overbooking,
      send_confirmation: parsed.data.send_confirmation,
      notes: parsed.data.notes,
      status: "agendado",
      created_by: "usuario",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === EXCLUSION_VIOLATION) {
      return { ok: false, ...mensagemDeConflito(error.message) };
    }
    return { ok: false, error: "Não foi possível marcar a consulta." };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "criou",
    entity: "appointment",
    entity_id: data.id,
  });
  revalidatePath("/agenda");
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Remarcar (arrastar e soltar ou menu)
// ---------------------------------------------------------------------------

const remarcarSchema = z.object({
  id: idSchema,
  starts_at_esperado: instanteSchema,
  novo_starts_at: instanteSchema,
  novo_professional_id: idSchema,
  avisar_paciente: z.boolean(),
});

// Violacao de check do Postgres: aqui so chega pelo gatilho
// preparar_remarcacao (consulta encerrada) ou impedir_falta_antes_do_horario.
const CHECK_VIOLATION = "23514";

const AVISO_SEM_AUTORIZACAO =
  "O paciente não autorizou receber mensagens. Avise por telefone.";
const AVISO_CANAL_FORA =
  "O WhatsApp da clínica está desconectado, então o aviso não saiu. Avise o paciente por telefone.";
const AVISO_NAO_ENFILEIRADO =
  "Não foi possível enviar o aviso ao paciente. Avise por telefone.";

type ConsultaParaRemarcar = {
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  professional_id: string;
  contact_id: string;
  service_link_id: string;
  is_overbooking: boolean;
  service_link:
    | { procedure_id: string; insurance_id: string | null }
    | { procedure_id: string; insurance_id: string | null }[]
    | null;
};

type VinculoDoBanco = {
  id: string;
  professional_id: string;
  procedure_id: string;
  insurance_id: string | null;
  duration_min: number;
  active: boolean;
};

/**
 * Aviso de remarcacao pelo WhatsApp (decisao do dono em 24/09/2026). Sai pelo
 * job enviar_mensagem_ativa, o mesmo caminho dos retornos automaticos: o
 * worker reconfere a autorizacao na hora do envio, respeita o espacamento
 * anti-ban e grava o custo. Aqui a autorizacao e conferida ANTES de enfileirar
 * para a recepcao saber na hora que precisa ligar. Devolve o aviso para a
 * tela quando nada foi enfileirado; undefined quando o envio esta a caminho.
 */
async function enfileirarAvisoDeRemarcacao(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    clinicId: string;
    clinicName: string;
    timezone: string;
    userId: string;
    appointmentId: string;
    contactId: string;
    professionalId: string;
    inicio: Date;
  },
): Promise<string | undefined> {
  // Horario novo no passado (correcao de registro): nao ha o que avisar.
  if (params.inicio.getTime() <= Date.now()) {
    return "O novo horário já passou, então nenhum aviso foi enviado ao paciente.";
  }
  const { data: autorizado, error: erroAutorizacao } = await supabase.rpc(
    "consentimento_vigente",
    {
      p_clinic_id: params.clinicId,
      p_contact_id: params.contactId,
      p_channel: "whatsapp",
    },
  );
  if (erroAutorizacao) {
    return AVISO_NAO_ENFILEIRADO;
  }
  if (autorizado !== true) {
    return AVISO_SEM_AUTORIZACAO;
  }

  // Canal fora do ar: dizer a verdade na hora do clique, como o "Cobrar
  // agora". Enfileirar aqui deixaria a recepcao achando que o paciente soube.
  // O canal e o NUMERO pelo qual o aviso sairia (varios numeros por clinica,
  // docs/07): o ultimo em que o paciente escreveu, ou o principal. O aviso
  // nomeia o numero quando a clinica tem mais de um, para a recepcao saber
  // qual reconectar; com um so, a frase e a de sempre.
  const [contas, ativos] = await Promise.all([
    contasDeEnvio(supabase, params.clinicId, [params.contactId]),
    supabase
      .from("whatsapp_account")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", params.clinicId)
      .is("removido_em", null),
  ]);
  if (!contas || ativos.error) {
    return AVISO_NAO_ENFILEIRADO;
  }
  const conta = contas.get(params.contactId);
  if (!conta?.whatsappAccountId || !conta.conectado) {
    const frase = fraseDeNumerosDesconectados(
      nomesParaATela([conta?.nome ?? null], ativos.count ?? 0),
    );
    return frase
      ? `${frase}, então o aviso não saiu. Avise o paciente por telefone.`
      : AVISO_CANAL_FORA;
  }

  const { data: contato } = await supabase
    .from("contact")
    .select("name")
    .eq("clinic_id", params.clinicId)
    .eq("id", params.contactId)
    .maybeSingle();

  // Data e hora no fuso da clinica (regra 3.6): o banco guarda UTC.
  const inicioLocal = new TZDate(params.inicio.getTime(), params.timezone);
  const body = renderizarModelo(AVISO_REMARCACAO, {
    nome: (contato?.name as string | null | undefined) ?? null,
    clinica: params.clinicName,
    data: format(inicioLocal, "dd/MM/yyyy", { locale: ptBR }),
    hora: format(inicioLocal, "HH:mm", { locale: ptBR }),
  }).trim();

  // job_queue nao tem policy de escrita (quem grava e o sistema). O service
  // role entra SO aqui, depois de a sessao ter movido a consulta pela RLS.
  // O payload leva o instante e o profissional que o texto anuncia: o worker
  // (executarEnvioAtivo) reconfere a consulta na hora do envio e mata o aviso
  // que ficou velho (remarcada de novo, cancelada, encerrada ou vencida). O
  // job leva o numero conferido conectado acima; numero_do_job o confirma na
  // execucao.
  const admin = createAdminClient();
  const { error: erroJob } = await admin.from("job_queue").insert({
    clinic_id: params.clinicId,
    kind: "enviar_mensagem_ativa",
    payload: {
      contact_id: params.contactId,
      body,
      appointment_id: params.appointmentId,
      starts_at: params.inicio.toISOString(),
      professional_id: params.professionalId,
    },
    whatsapp_account_id: conta.whatsappAccountId,
  });
  if (erroJob) {
    return AVISO_NAO_ENFILEIRADO;
  }
  await supabase.from("audit_log").insert({
    clinic_id: params.clinicId,
    user_id: params.userId,
    action: "enfileirou_aviso_de_remarcacao",
    entity: "appointment",
    entity_id: params.appointmentId,
  });
  return undefined;
}

export async function remarcarAgendamentoAction(
  input: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = remarcarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira o novo horário." };
  }
  const { id, novo_professional_id } = parsed.data;

  const supabase = await createClient();
  // A DURACAO nao vem do cliente: le a consulta e o vinculo e recalcula,
  // senao o range que a exclusion constraint avalia poderia ser forjado.
  const { data: bruta } = await supabase
    .from("appointment")
    .select(
      "starts_at, ends_at, status, professional_id, contact_id, service_link_id, is_overbooking, service_link:service_link_id (procedure_id, insurance_id)",
    )
    .eq("clinic_id", guard.clinicId)
    .eq("id", id)
    .maybeSingle();
  if (!bruta) {
    return { ok: false, error: "Consulta não encontrada." };
  }
  const atual = bruta as unknown as ConsultaParaRemarcar;

  // Situacao final nao se move (achado 78): a falta fica no dia em que
  // aconteceu e o horario novo nao nasce preso numa situacao final. O
  // gatilho preparar_remarcacao recusa de novo no banco.
  if (!podeRemarcar(atual.status)) {
    return {
      ok: false,
      code: "situacao_final",
      error: DICA_REMARCAR_ENCERRADA,
    };
  }

  const vinculoAtual = Array.isArray(atual.service_link)
    ? (atual.service_link[0] ?? null)
    : atual.service_link;
  const trocouProfissional = novo_professional_id !== atual.professional_id;

  // Profissional novo: o vinculo dele para o MESMO procedimento e convenio
  // (achado 85). Sem isto a consulta ficava com o profissional novo e a
  // duracao, o preco e o convenio do antigo.
  let serviceLinkId = atual.service_link_id;
  let duracaoMs =
    new Date(atual.ends_at).getTime() - new Date(atual.starts_at).getTime();

  // Profissional de destino ATIVO sempre, mesmo sem trocar (achado L12):
  // mover a consulta de um profissional desativado para outro dia ou horario
  // abre horario novo com quem nao atende mais, e a regua ainda pediria
  // confirmacao ao paciente para ele.
  const { data: profissional, error: erroProfissional } = await supabase
    .from("professional")
    .select("active")
    .eq("clinic_id", guard.clinicId)
    .eq("id", novo_professional_id)
    .maybeSingle();
  if (erroProfissional) {
    return { ok: false, error: "Não foi possível remarcar." };
  }
  if (!profissional || profissional.active !== true) {
    return {
      ok: false,
      code: "sem_vinculo",
      error: MENSAGEM_PROFISSIONAL_INATIVO,
    };
  }

  if (trocouProfissional) {
    if (!vinculoAtual) {
      return { ok: false, code: "sem_vinculo", error: MENSAGEM_SEM_VINCULO };
    }
    const { data: candidatos, error: erroVinculos } = await supabase
      .from("service_link")
      .select(
        "id, professional_id, procedure_id, insurance_id, duration_min, active",
      )
      .eq("clinic_id", guard.clinicId)
      .eq("professional_id", novo_professional_id)
      .eq("procedure_id", vinculoAtual.procedure_id)
      .eq("active", true);
    if (erroVinculos) {
      return { ok: false, error: "Não foi possível remarcar." };
    }
    const vinculo = vinculoEquivalente((candidatos ?? []) as VinculoDoBanco[], {
      professionalId: novo_professional_id,
      procedureId: vinculoAtual.procedure_id,
      insuranceId: vinculoAtual.insurance_id,
    });
    if (!vinculo) {
      return { ok: false, code: "sem_vinculo", error: MENSAGEM_SEM_VINCULO };
    }
    serviceLinkId = vinculo.id;
    duracaoMs = vinculo.duration_min * 60_000;
  }

  const novoInicio = new Date(parsed.data.novo_starts_at);
  const novoFim = new Date(novoInicio.getTime() + duracaoMs);

  // Bloqueio e jornada do profissional de DESTINO (achado 85). Encaixe (a
  // flag que a consulta ja carrega) passa por cima da jornada e do bloqueio
  // comum, mas nunca do bloqueio que impede encaixe, como na criacao.
  const [
    { data: bloqueios, error: erroBloqueios },
    { data: jornada, error: erroJornada },
  ] = await Promise.all([
    supabase
      .from("professional_block")
      .select("starts_at, ends_at, blocks_overbooking")
      .eq("clinic_id", guard.clinicId)
      .eq("professional_id", novo_professional_id)
      .lt("starts_at", novoFim.toISOString())
      .gt("ends_at", novoInicio.toISOString()),
    supabase
      .from("professional_schedule")
      .select("weekday, starts_at, ends_at")
      .eq("clinic_id", guard.clinicId)
      .eq("professional_id", novo_professional_id),
  ]);
  if (erroBloqueios || erroJornada) {
    return {
      ok: false,
      error:
        "Não foi possível conferir a agenda do profissional. Tente de novo.",
    };
  }
  const bloqueiosQueValem = (
    (bloqueios ?? []) as {
      starts_at: string;
      ends_at: string;
      blocks_overbooking: boolean;
    }[]
  ).filter((b) => !atual.is_overbooking || b.blocks_overbooking);
  if (colideComBloqueio(bloqueiosQueValem, novoInicio, novoFim)) {
    return {
      ok: false,
      code: "bloqueado",
      error: atual.is_overbooking
        ? "Este período está bloqueado sem permissão de encaixe."
        : "Este horário está bloqueado na agenda do profissional. Escolha outro horário.",
    };
  }
  if (
    !atual.is_overbooking &&
    !cabeNaJornada({
      timezone: guard.timezone,
      jornada: (
        (jornada ?? []) as {
          weekday: number;
          starts_at: string;
          ends_at: string;
        }[]
      ).map((j) => ({
        weekday: j.weekday,
        startsAt: j.starts_at,
        endsAt: j.ends_at,
      })),
      inicio: novoInicio,
      fim: novoFim,
    })
  ) {
    return {
      ok: false,
      code: "fora_da_jornada",
      error:
        "Este horário está fora da jornada do profissional. Escolha outro horário.",
    };
  }

  // Quem confirmou confirmou o HORARIO ANTIGO (decisao do dono em
  // 24/09/2026): a consulta volta para Agendado e a regua pede confirmacao
  // de novo no horario novo. Paciente ja na clinica (Na recepcao, Em
  // atendimento) so fica como esta numa troca no mesmo dia civil da clinica;
  // para outro dia volta para Agendado (achado R4). O gatilho
  // preparar_remarcacao faz o mesmo no banco; aqui fica explicito.
  const mesmoDia =
    diaCivil(guard.timezone, new Date(atual.starts_at)) ===
    diaCivil(guard.timezone, novoInicio);
  const novoStatus = statusAposRemarcar(atual.status, { mesmoDia });

  // Update condicional no horario, no profissional e na situacao que o
  // servidor leu: se alguem mexeu antes, zero linhas voltam e a tela avisa
  // em vez de sobrescrever. O historico (linha de remarcacao com o antes e o
  // depois) e os toques pendentes do horario antigo sao do gatilho
  // registrar_remarcacao.
  const { data, error } = await supabase
    .from("appointment")
    .update({
      starts_at: novoInicio.toISOString(),
      ends_at: novoFim.toISOString(),
      professional_id: novo_professional_id,
      service_link_id: serviceLinkId,
      ...(novoStatus !== atual.status
        ? {
            status: novoStatus,
            confirmed_by_user_id: null,
            confirmation_channel: null,
          }
        : {}),
    })
    .eq("clinic_id", guard.clinicId)
    .eq("id", id)
    .eq("starts_at", parsed.data.starts_at_esperado)
    .eq("professional_id", atual.professional_id)
    .eq("status", atual.status)
    .select("id");
  if (error) {
    if (error.code === EXCLUSION_VIOLATION) {
      const conflito = mensagemDeConflito(error.message);
      return conflito.code === "conflito_recurso"
        ? { ok: false, ...conflito }
        : {
            ok: false,
            code: "conflito",
            error: "O horário de destino está ocupado.",
          };
    }
    if (error.code === CHECK_VIOLATION) {
      return {
        ok: false,
        code: "situacao_final",
        error: DICA_REMARCAR_ENCERRADA,
      };
    }
    return { ok: false, error: "Não foi possível remarcar." };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: "ja_tratado",
      error: "Alguém já mexeu neste agendamento. Atualize a agenda.",
    };
  }

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "remarcou",
    entity: "appointment",
    entity_id: id,
  });

  const aviso = parsed.data.avisar_paciente
    ? await enfileirarAvisoDeRemarcacao(supabase, {
        clinicId: guard.clinicId,
        clinicName: guard.clinicName,
        timezone: guard.timezone,
        userId: guard.context.userId,
        appointmentId: id,
        contactId: atual.contact_id,
        professionalId: novo_professional_id,
        inicio: novoInicio,
      })
    : undefined;

  revalidatePath("/agenda");
  return aviso ? { ok: true, aviso } : { ok: true };
}

// ---------------------------------------------------------------------------
// Ciclo de status (tarefa 2.7)
// ---------------------------------------------------------------------------

const statusSchema = z.enum([
  "agendado",
  "aguardando_confirmacao",
  "confirmado_paciente",
  "confirmado_recepcao",
  "na_recepcao",
  "em_atendimento",
  "compareceu",
  "cancelado_paciente",
  "cancelado_clinica",
  "faltou",
]);

const mudarStatusSchema = z.object({
  id: idSchema,
  status_atual: statusSchema,
  novo_status: statusSchema,
  canal: z.enum(["whatsapp", "telefone", "presencial"]).nullable(),
  // So nos cancelamentos: a escolha do dialogo "Oferecer este horario a lista
  // de espera". Ausente vale true (o padrao da coluna e o comportamento de
  // antes para quem chama sem dialogo).
  oferecer_vaga: z.boolean().optional(),
});

export async function mudarStatusAction(
  input: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = mudarStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Mudança de situação inválida." };
  }
  const { id, status_atual, novo_status, canal, oferecer_vaga } = parsed.data;

  if (!podeTransicionar(status_atual, novo_status)) {
    return {
      ok: false,
      error: "Essa mudança de situação não é permitida daqui.",
    };
  }
  if (exigeCanal(novo_status) && !canal) {
    return { ok: false, error: "Informe como a confirmação chegou." };
  }

  const supabase = await createClient();

  // Falta so a partir do horario da consulta (achado 81). O horario vem do
  // BANCO, nunca da tela. O gatilho impedir_falta_antes_do_horario recusa de
  // novo, para qualquer caminho.
  // Compareceu so a partir do DIA da consulta no fuso da clinica (achado
  // L11): e situacao final e o gatilho consumir_sessao_de_pacote desconta
  // sessao. Consulta de amanha marcada por engano nao tinha volta.
  if (novo_status === "faltou" || novo_status === "compareceu") {
    const { data: consulta } = await supabase
      .from("appointment")
      .select("starts_at")
      .eq("clinic_id", guard.clinicId)
      .eq("id", id)
      .maybeSingle();
    if (!consulta) {
      return { ok: false, error: "Consulta não encontrada." };
    }
    const agora = new Date();
    if (
      novo_status === "faltou" &&
      !faltaLiberada(consulta.starts_at as string, agora)
    ) {
      return {
        ok: false,
        code: "falta_antes_do_horario",
        error: DICA_FALTA_ANTES_DO_HORARIO,
      };
    }
    if (
      novo_status === "compareceu" &&
      !comparecimentoLiberado(
        guard.timezone,
        consulta.starts_at as string,
        agora,
      )
    ) {
      return {
        ok: false,
        code: "comparecimento_antes_do_dia",
        error: DICA_COMPARECEU_ANTES_DO_DIA,
      };
    }
  }

  // Condicional no status que a tela viu: corrida perde educadamente.
  const { data, error } = await supabase
    .from("appointment")
    .update({
      status: novo_status,
      ...(novo_status === "confirmado_recepcao"
        ? {
            confirmed_by_user_id: guard.context.userId,
            confirmation_channel: canal,
          }
        : {}),
      // Vai no MESMO update do status: o gatilho de reoferta le a escolha na
      // linha nova (contrato com o grupo lista-de-espera).
      ...(eCancelamento(novo_status)
        ? { oferecer_vaga_ao_cancelar: oferecer_vaga ?? true }
        : {}),
    })
    .eq("clinic_id", guard.clinicId)
    .eq("id", id)
    .eq("status", status_atual)
    .select("id");
  if (error) {
    if (error.code === CHECK_VIOLATION && novo_status === "faltou") {
      return {
        ok: false,
        code: "falta_antes_do_horario",
        error: DICA_FALTA_ANTES_DO_HORARIO,
      };
    }
    return { ok: false, error: "Não foi possível mudar a situação." };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: "ja_tratado",
      error: "A situação desta consulta já mudou. Atualize a agenda.",
    };
  }

  await registrarHistorico(
    supabase,
    guard.clinicId,
    id,
    novo_status,
    guard.context.userId,
  );

  // Falta e SEMPRE explicita e alimenta o contador do paciente (etiqueta de
  // risco e regua reforcada). Quem soma e o gatilho contar_falta, na mesma
  // transacao do update acima: nada a chamar daqui (achados 133 e 7).

  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "mudou_status",
    entity: "appointment",
    entity_id: id,
  });
  revalidatePath("/agenda");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Encaixe da IA: aprovar e recusar (painel "Pendente de voce")
// ---------------------------------------------------------------------------

export async function aprovarEncaixeAction(
  id: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Encaixe inválido." };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointment")
    .update({ approval_status: "aprovado" })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data)
    .eq("approval_status", "pendente")
    .select("id");
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: "ja_tratado",
      error: "Este encaixe já foi tratado.",
    };
  }
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "aprovou_encaixe",
    entity: "appointment",
    entity_id: parsed.data,
  });
  revalidatePath("/agenda");
  return { ok: true };
}

export async function recusarEncaixeAction(
  id: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Encaixe inválido." };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointment")
    .update({ approval_status: "recusado", status: "cancelado_clinica" })
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data)
    .eq("approval_status", "pendente")
    .select("id");
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: "ja_tratado",
      error: "Este encaixe já foi tratado.",
    };
  }
  await registrarHistorico(
    supabase,
    guard.clinicId,
    parsed.data,
    "cancelado_clinica",
    guard.context.userId,
  );
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: "recusou_encaixe",
    entity: "appointment",
    entity_id: parsed.data,
  });
  revalidatePath("/agenda");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Exportacao e impressao: trilha antes do dado sair da tela (LGPD)
// ---------------------------------------------------------------------------

export async function registrarExportacaoAction(
  diaISO: unknown,
  formato: unknown,
): Promise<{ ok: boolean }> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false };
  }
  const parsedDia = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .safeParse(diaISO);
  const parsedFormato = z.enum(["impressao", "csv"]).safeParse(formato);
  if (!parsedDia.success || !parsedFormato.success) {
    return { ok: false };
  }
  const supabase = await createClient();
  // A trilha vai ANTES de o dado sair da tela (regra 3.1): a exportacao so
  // acontece se este insert gravar.
  const { error } = await supabase.from("audit_log").insert({
    clinic_id: context.active.clinicId,
    user_id: context.userId,
    action: parsedFormato.data === "csv" ? "exportou" : "imprimiu",
    entity: "agenda_dia",
    entity_id: null,
  });
  return { ok: !error };
}
