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
  DICA_CONSULTA_PENDENTE,
  DICA_FALTA_ANTES_DO_HORARIO,
  DICA_REMARCAR_ENCERRADA,
  eCancelamento,
  exigeCanal,
  faltaLiberada,
  MENSAGEM_PROFISSIONAL_INATIVO,
  PENDENCIA_CANCELADA,
  podeRemarcar,
  podeTransicionar,
  STATUS_DE_CANCELAMENTO,
  statusAposRemarcar,
} from "@/lib/domain/appointment-status";
import { diaCivil } from "@/lib/domain/horarios";
import { renderizarModelo } from "@/lib/domain/modelo-mensagem";
import {
  cabeNaJornada,
  MENSAGEM_SEM_CONFERIR_AGENDA,
  MENSAGEM_SEM_VINCULO,
  recusaPorBloqueio,
  vinculoEquivalente,
} from "@/lib/domain/remarcacao";
import { AVISO_REMARCACAO } from "@/lib/domain/textos-padrao";
import { canEdit } from "@/lib/domain/permissions";
import {
  chaveDeTelefone,
  MENSAGEM_TELEFONE_INVALIDO,
  normalizarTelefone,
} from "@/lib/domain/telefone";
import type { TipoDeEnvio } from "@/lib/domain/tipo-de-envio";
import {
  contasDeEnvio,
  fraseDeNumerosDesconectados,
  nomesParaATela,
} from "@/lib/jobs/numero-de-envio";
import { log } from "@/lib/log";
import { ehConsultaDaIa } from "@/lib/queries/agenda";
import {
  lerDadosInformadosNaMarcacao,
  type DadosInformadosNaMarcacao,
} from "@/lib/queries/dados-da-marcacao";
import { fetchProfileNames } from "@/lib/queries/profiles";
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
    // Remarcar: situacao final, sem vinculo no profissional de destino ou
    // fora da jornada. Os dois ultimos (e o "bloqueado", abaixo) a tela
    // corrige escolhendo outro horario ou profissional, com o dialogo aberto.
    | "situacao_final"
    | "sem_vinculo"
    | "fora_da_jornada"
    // Marcar e remarcar: em cima de bloqueio do profissional (consulta comum
    // em qualquer bloqueio; encaixe so no que impede encaixe). No modal da
    // consulta nova, a tela refaz o dia em cache para o bloqueio aparecer e
    // sair dos horarios livres.
    | "bloqueado"
    // Mudar situacao: falta antes do horario da consulta, e Compareceu
    // antes do dia dela.
    | "falta_antes_do_horario"
    | "comparecimento_antes_do_dia"
    // Mudar situacao de consulta que ainda espera aprovacao (onda 2, item
    // 10): so aprovar, recusar ou cancelar.
    | "consulta_pendente";
  id?: string;
  /**
   * A acao deu certo, mas algo que a recepcao pediu junto nao aconteceu (ex.:
   * o aviso de remarcacao nao saiu porque o paciente nao autorizou). A tela
   * mostra como aviso, nunca como sucesso silencioso.
   */
  aviso?: string;
  /**
   * Cancelar pela Agenda uma pendencia da IA (criada pela IA e ainda
   * pendente: a consulta que ela marcou ou o encaixe) conta como recusar
   * (decisao do dono de 20/10/2026). A acao diz qual foi recusada, para a
   * tela dizer o mesmo que o Recusar ("Consulta recusada. Avise o paciente
   * pelo Atendimento."), e nao a situacao escolhida no menu.
   */
  recusada?: "consulta_da_ia" | "encaixe";
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

// Vinculo desativado depois que a tela carregou o catalogo (D8). Nao
// exportada: arquivo "use server" so exporta funcao assincrona.
const MENSAGEM_VINCULO_SAIU_DA_AGENDA =
  "Este profissional não atende mais este procedimento por este convênio. A lista já foi atualizada: escolha de novo.";

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
    .select("duration_min, active, procedure:procedure_id (resource_id)")
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data.service_link_id)
    .maybeSingle();
  if (!vinculo) {
    return { ok: false, error: "Vínculo de atendimento inválido." };
  }
  // Consulta NOVA so em vinculo ativo (D8, convenio pelo medico, 02/10/2026).
  // O catalogo da Agenda fica ate 5 minutos em cache, e o vinculo pode ter
  // sido desativado nesse meio por outra tela (desmarcar o convenio no
  // cadastro do profissional ou no Procedimento). So a criacao recusa: a
  // remarcacao com o mesmo profissional mantem o vinculo da consulta ja
  // marcada (critica §3.5), e a troca de profissional ja exige vinculo ativo.
  if (vinculo.active !== true) {
    return {
      ok: false,
      code: "sem_vinculo",
      error: MENSAGEM_VINCULO_SAIU_DA_AGENDA,
    };
  }
  const procedure = Array.isArray(vinculo.procedure)
    ? vinculo.procedure[0]
    : vinculo.procedure;
  const resourceId = (procedure?.resource_id as string | null) ?? null;
  const ends_at = new Date(
    new Date(parsed.data.starts_at).getTime() +
      (vinculo.duration_min as number) * 60_000,
  ).toISOString();

  // Bloqueio do profissional: recusar antes do insert (o bloqueio nao e
  // constraint; e regra de negocio). TODA consulta confere, como na
  // remarcacao: a comum nao entra em bloqueio nenhum e o encaixe so nao
  // entra no que impede encaixe. A tela pode estar com a agenda em cache (o
  // bloqueio nao tem tempo real), entao a palavra final e daqui. Erro na
  // leitura recusa: nunca grava sem conferir.
  const { data: bloqueios, error: erroBloqueios } = await supabase
    .from("professional_block")
    .select("starts_at, ends_at, blocks_overbooking")
    .eq("clinic_id", guard.clinicId)
    .eq("professional_id", parsed.data.professional_id)
    .lt("starts_at", ends_at)
    .gt("ends_at", parsed.data.starts_at);
  if (erroBloqueios) {
    return { ok: false, error: MENSAGEM_SEM_CONFERIR_AGENDA };
  }
  const recusa = recusaPorBloqueio(
    (bloqueios ?? []) as {
      starts_at: string;
      ends_at: string;
      blocks_overbooking: boolean;
    }[],
    {
      inicio: new Date(parsed.data.starts_at),
      fim: new Date(ends_at),
      encaixe: parsed.data.is_overbooking,
    },
  );
  if (recusa) {
    return { ok: false, code: "bloqueado", error: recusa };
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
  // docs/07): o fixo do tipo 'aviso_remarcacao', senao o ultimo em que o
  // paciente escreveu, senao o principal. O aviso nomeia o numero quando a
  // clinica tem mais de um, para a recepcao saber qual reconectar; com um so,
  // a frase e a de sempre.
  const [contas, ativos] = await Promise.all([
    contasDeEnvio(
      supabase,
      params.clinicId,
      [params.contactId],
      "aviso_remarcacao",
    ),
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
  // execucao. tipo_de_envio diz ao banco qual escolha de numero vale quando
  // ele precisar recarimbar o job (numero removido, escolha trocada).
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
      tipo_de_envio: "aviso_remarcacao" satisfies TipoDeEnvio,
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
    return { ok: false, error: MENSAGEM_SEM_CONFERIR_AGENDA };
  }
  const recusa = recusaPorBloqueio(
    (bloqueios ?? []) as {
      starts_at: string;
      ends_at: string;
      blocks_overbooking: boolean;
    }[],
    { inicio: novoInicio, fim: novoFim, encaixe: atual.is_overbooking },
  );
  if (recusa) {
    return { ok: false, code: "bloqueado", error: recusa };
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

  // Cancelar uma pendencia da IA (created_by 'ia' e ainda pendente) conta
  // como recusar (decisao do dono de 20/10/2026): o resultado e o do Recusar
  // (gravarRecusa: recusada, cancelada pela clinica, na consulta da IA sem
  // oferecer o horario a lista de espera, historico e trilha da recusa) e,
  // na consulta da IA, a conversa volta para a equipe. Sem isso a consulta
  // cancelada continuava em "Pendente de voce" e a conversa, com a IA. A
  // pendencia e lida do BANCO, nunca da tela; o status que a tela viu vai
  // no filtro do update, como em toda mudanca de situacao.
  if (eCancelamento(novo_status)) {
    const lida = await lerPendencia(supabase, guard.clinicId, id);
    if ("erro" in lida) {
      return { ok: false, error: TEXTOS_DA_PENDENCIA.semConferir };
    }
    if (lida.pendencia !== null && lida.pendencia.created_by === "ia") {
      const daIa = ehConsultaDaIa(lida.pendencia);
      const resultado = await gravarRecusa(
        supabase,
        guard,
        id,
        daIa,
        status_atual,
      );
      return resultado.ok
        ? { ...resultado, recusada: daIa ? "consulta_da_ia" : "encaixe" }
        : resultado;
    }
  } else {
    // Onda 2 (item 10, decisoes do dono P10a e P10b): a consulta que ainda
    // espera aprovacao (qualquer pendente, nao so a da IA) so aprova, recusa
    // ou cancela. Confirmar, mandar para a recepcao, Compareceu e Falta
    // esperam a aprovacao: sem isto, Compareceu numa pendente avancava o
    // funil antes da aprovacao. A pendencia e lida do BANCO, nunca da tela;
    // o gatilho do banco recusa de novo (23514 consulta_pendente, abaixo).
    const lida = await lerPendencia(supabase, guard.clinicId, id);
    if ("erro" in lida) {
      return { ok: false, error: TEXTOS_DA_PENDENCIA.semConferir };
    }
    if (lida.pendencia !== null) {
      return {
        ok: false,
        code: "consulta_pendente",
        error: DICA_CONSULTA_PENDENTE,
      };
    }
  }

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
    // A consulta virou pendente entre a leitura e o update (ou outro
    // caminho): o gatilho do banco recusa com 23514 consulta_pendente, que
    // vem antes da falta (a falta numa pendente tambem da 23514).
    if (
      error.code === CHECK_VIOLATION &&
      (error.message ?? "").includes("consulta_pendente")
    ) {
      return {
        ok: false,
        code: "consulta_pendente",
        error: DICA_CONSULTA_PENDENTE,
      };
    }
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
// Pendente de voce: aprovar e recusar (painel e menu da consulta)
// ---------------------------------------------------------------------------
//
// Duas pendencias passam por aqui: o encaixe da IA (de sempre) e, desde o E4
// (20/10/2026), a consulta que a IA marcou pelo WhatsApp (ehConsultaDaIa:
// created_by 'ia' e sem encaixe), que nasce 'pendente' (D12) com a
// confirmacao automatica desligada (send_confirmation false). Decisoes do
// dono de 20/10/2026:
// - a regua de confirmacao so comeca depois que a equipe aprova: aprovar a
//   consulta da IA volta send_confirmation para true NO MESMO update (o
//   planejador da regua le a coluna a cada rodada). No mesmo update,
//   oferecer_vaga_ao_cancelar volta ao padrao da coluna (true): o false com
//   que a IA marca existe so para a recusa (que o grava de novo); a
//   consulta aprovada e uma consulta como as outras, e o paciente que
//   cancela pela regua libera o horario para a lista de espera (revisao da
//   E4: sem isto, o gatilho oferecer_ao_cancelar pulava para sempre);
// - recusar devolve a conversa para a equipe: depois da recusa (cancelado
//   pela clinica, sem oferecer o horario a lista de espera), a RPC
//   devolver_conversa_da_consulta_recusada poe a conversa em "Aguardando
//   voce" e grava o evento para a equipe avisar o paciente. Erro nela NAO
//   desfaz a recusa: a acao volta ok com o aviso, e o log leva so ids e o
//   codigo do erro;
// - cancelar pelo menu a pendencia da IA (a consulta ou o encaixe) conta
//   como recusar: mudarStatusAction grava a mesma recusa (gravarRecusa).
// O tipo e lido do BANCO (nunca da tela) e repetido no filtro do update: a
// corrida perde educadamente ("ja foi tratada").

/** O filtro do PostgREST: a situacao e um dos cancelamentos. */
const FILTRO_DE_CANCELAMENTO = `(${STATUS_DE_CANCELAMENTO.join(",")})`;

type PendenciaLida = {
  created_by: string;
  is_overbooking: boolean;
  /**
   * A situacao da consulta. A pendente cancelada (o paciente cancelou pelo
   * WhatsApp; continua 'pendente') conta como recusada: aprovar e recusar
   * respondem que ela ja foi cancelada (revisao da onda 2).
   */
  cancelada: boolean;
};

const TEXTOS_DA_PENDENCIA = {
  invalida: "Consulta inválida.",
  semConferir: "Não foi possível conferir esta consulta. Tente de novo.",
  consultaTratada: "Esta consulta já foi tratada.",
  encaixeTratado: "Este encaixe já foi tratado.",
  naoAprovou: "Não foi possível aprovar. Tente de novo.",
  naoRecusou: "Não foi possível recusar. Tente de novo.",
  conversaNaoDevolvida:
    "A consulta foi recusada, mas a conversa não voltou para a equipe. Abra a conversa no Atendimento e avise o paciente.",
  conversaNaoEncontrada:
    "A consulta foi recusada, mas a conversa do paciente não foi encontrada. Avise o paciente pelo Atendimento.",
} as const;

/** A pendencia como esta no banco; null quando nao esta mais pendente. */
async function lerPendencia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  id: string,
): Promise<{ pendencia: PendenciaLida | null } | { erro: true }> {
  const { data, error } = await supabase
    .from("appointment")
    .select("created_by, is_overbooking, status")
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .eq("approval_status", "pendente")
    .maybeSingle();
  if (error) {
    return { erro: true };
  }
  const linha = data as {
    created_by?: unknown;
    is_overbooking?: unknown;
    status?: unknown;
  } | null;
  return {
    pendencia: linha
      ? {
          created_by: String(linha.created_by ?? ""),
          is_overbooking: linha.is_overbooking === true,
          cancelada: STATUS_DE_CANCELAMENTO.some(
            (status) => status === linha.status,
          ),
        }
      : null,
  };
}

export async function aprovarEncaixeAction(
  id: unknown,
): Promise<AgendaActionResult> {
  const guard = await requireAgendaEditor();
  if ("error" in guard) {
    return { ok: false, error: guard.error };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS_DA_PENDENCIA.invalida };
  }
  const supabase = await createClient();
  const lida = await lerPendencia(supabase, guard.clinicId, parsed.data);
  if ("erro" in lida) {
    return { ok: false, error: TEXTOS_DA_PENDENCIA.semConferir };
  }
  if (lida.pendencia === null) {
    return {
      ok: false,
      code: "ja_tratado",
      error: TEXTOS_DA_PENDENCIA.consultaTratada,
    };
  }
  // A pendente cancelada (pelo paciente, no WhatsApp) conta como recusada
  // (revisao da onda 2): aprovar uma consulta cancelada converteria o lead
  // e avancaria o funil. O banco tambem nao converte nesse caso.
  if (lida.pendencia.cancelada) {
    return { ok: false, code: "ja_tratado", error: PENDENCIA_CANCELADA };
  }
  const daIa = ehConsultaDaIa(lida.pendencia);

  let aprovar = supabase
    .from("appointment")
    .update(
      daIa
        ? {
            approval_status: "aprovado",
            send_confirmation: true,
            oferecer_vaga_ao_cancelar: true,
          }
        : { approval_status: "aprovado" },
    )
    .eq("clinic_id", guard.clinicId)
    .eq("id", parsed.data)
    .eq("approval_status", "pendente")
    // A corrida com o cancelamento pelo paciente perde educadamente.
    .not("status", "in", FILTRO_DE_CANCELAMENTO);
  if (daIa) {
    aprovar = aprovar.eq("created_by", "ia").eq("is_overbooking", false);
  }
  const { data, error } = await aprovar.select("id");
  if (error) {
    return { ok: false, error: TEXTOS_DA_PENDENCIA.naoAprovou };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: "ja_tratado",
      error: daIa
        ? TEXTOS_DA_PENDENCIA.consultaTratada
        : TEXTOS_DA_PENDENCIA.encaixeTratado,
    };
  }
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: daIa ? "aprovou_consulta_da_ia" : "aprovou_encaixe",
    entity: "appointment",
    entity_id: parsed.data,
  });
  revalidatePath("/agenda");
  return { ok: true };
}

/**
 * Depois da recusa da consulta da IA: a conversa volta para a equipe pela
 * RPC (que acha a conversa pela reserva da IA). Nunca lanca e nunca desfaz
 * a recusa: o que nao deu certo volta como aviso para a tela.
 */
async function devolverConversaDaRecusada(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  userId: string,
  appointmentId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc(
      "devolver_conversa_da_consulta_recusada",
      { p_clinic_id: clinicId, p_appointment_id: appointmentId },
    );
    if (error) {
      log.warn("agenda_conversa_nao_devolvida", {
        clinic_id: clinicId,
        user_id: userId,
        error_code: error.code ?? null,
      });
      return TEXTOS_DA_PENDENCIA.conversaNaoDevolvida;
    }
    if (data !== true) {
      log.warn("agenda_recusa_sem_conversa", {
        clinic_id: clinicId,
        user_id: userId,
      });
      return TEXTOS_DA_PENDENCIA.conversaNaoEncontrada;
    }
    return null;
  } catch {
    log.warn("agenda_conversa_nao_devolvida", {
      clinic_id: clinicId,
      user_id: userId,
      error_code: "excecao",
    });
    return TEXTOS_DA_PENDENCIA.conversaNaoDevolvida;
  }
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
    return { ok: false, error: TEXTOS_DA_PENDENCIA.invalida };
  }
  const supabase = await createClient();
  const lida = await lerPendencia(supabase, guard.clinicId, parsed.data);
  if ("erro" in lida) {
    return { ok: false, error: TEXTOS_DA_PENDENCIA.semConferir };
  }
  if (lida.pendencia === null) {
    return {
      ok: false,
      code: "ja_tratado",
      error: TEXTOS_DA_PENDENCIA.consultaTratada,
    };
  }
  // A pendente cancelada ja conta como recusada: recusar de novo trocaria
  // o "cancelado pelo paciente" por "cancelado pela clinica".
  if (lida.pendencia.cancelada) {
    return { ok: false, code: "ja_tratado", error: PENDENCIA_CANCELADA };
  }
  return gravarRecusa(
    supabase,
    guard,
    parsed.data,
    ehConsultaDaIa(lida.pendencia),
  );
}

/**
 * A recusa gravada, a mesma no Recusar (painel e menu) e no Cancelar da
 * pendencia da IA pelo menu (mudarStatusAction): o update condicional, o
 * historico, a trilha e, so na consulta da IA, a conversa devolvida para a
 * equipe DEPOIS da recusa. `statusAtual` (o do Cancelar, que a tela viu)
 * entra no filtro do update: a corrida perde educadamente.
 */
async function gravarRecusa(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guard: { clinicId: string; context: { userId: string } },
  id: string,
  daIa: boolean,
  statusAtual?: AppointmentStatus,
): Promise<AgendaActionResult> {
  // A consulta da IA ja nasce sem oferecer o horario a lista de espera; vai
  // de novo no MESMO update (o gatilho da reoferta le a linha nova).
  let recusar = supabase
    .from("appointment")
    .update(
      daIa
        ? {
            approval_status: "recusado",
            status: "cancelado_clinica",
            oferecer_vaga_ao_cancelar: false,
          }
        : { approval_status: "recusado", status: "cancelado_clinica" },
    )
    .eq("clinic_id", guard.clinicId)
    .eq("id", id)
    .eq("approval_status", "pendente")
    .not("status", "in", FILTRO_DE_CANCELAMENTO);
  if (daIa) {
    recusar = recusar.eq("created_by", "ia").eq("is_overbooking", false);
  }
  if (statusAtual !== undefined) {
    recusar = recusar.eq("status", statusAtual);
  }
  const { data, error } = await recusar.select("id");
  if (error) {
    return { ok: false, error: TEXTOS_DA_PENDENCIA.naoRecusou };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: "ja_tratado",
      error: daIa
        ? TEXTOS_DA_PENDENCIA.consultaTratada
        : TEXTOS_DA_PENDENCIA.encaixeTratado,
    };
  }
  await registrarHistorico(
    supabase,
    guard.clinicId,
    id,
    "cancelado_clinica",
    guard.context.userId,
  );
  await supabase.from("audit_log").insert({
    clinic_id: guard.clinicId,
    user_id: guard.context.userId,
    action: daIa ? "recusou_consulta_da_ia" : "recusou_encaixe",
    entity: "appointment",
    entity_id: id,
  });
  const aviso = daIa
    ? await devolverConversaDaRecusada(
        supabase,
        guard.clinicId,
        guard.context.userId,
        id,
      )
    : null;
  revalidatePath("/agenda");
  return aviso ? { ok: true, aviso } : { ok: true };
}

// ---------------------------------------------------------------------------
// Dados informados pelo paciente (AG3): o "Ver dados informados"
// ---------------------------------------------------------------------------
//
// AG3 (decisao D-7 do dono, padrao recomendado): o que o paciente informou a
// IA para marcar (nome completo, nascimento, CPF e carteirinha) fica a parte
// e so entra no cadastro do contato quando a equipe APROVA a consulta, e so
// nos campos vazios (o gatilho do banco). Quem aprova confere antes, pelo
// "Ver dados informados" do painel "Pendente de voce" e do menu da consulta.
//
// A leitura e pela SESSAO, pela RPC ler_dados_informados_na_marcacao (a
// unica leitura humana da tabela), que confere de novo o papel (quem escreve
// na clinica; o profissional so na propria agenda) e grava a trilha
// leu_dados_da_marcacao quando ha dado, sem o conteudo. Por isso a tela so
// chama sob demanda, no clique. Aqui: a guarda de sempre da Agenda (o papel
// leitura nem chega ao banco), o id pelo Zod e o nome de quem aprovou (a
// tela nunca recebe o id). Log so com ids e o codigo do erro; o conteudo
// nunca sai daqui a nao ser para a tela de quem pode ler.

/** O que a tela mostra: a linha lida, com o nome de quem aplicou. */
export type DadosInformadosDaConsulta = Omit<
  DadosInformadosNaMarcacao,
  "aplicadoPorId"
> & {
  /**
   * Quem aprovou a consulta e, com isso, aplicou os dados ao cadastro: o
   * nome, ou nulo quando o nome nao pode ser lido. Nulo inteiro quando o
   * banco nao guardou ninguem (ainda nao aplicado, ou aplicado sem sessao).
   */
  aplicadoPor: { nome: string | null } | null;
};

export type ResultadoDosDadosInformados =
  | { ok: true; dados: DadosInformadosDaConsulta | null }
  | { ok: false; error: string };

const TEXTOS_DOS_DADOS_INFORMADOS = {
  sessaoExpirada: "Sessão expirada. Entre de novo.",
  semPermissao: "Seu perfil não vê os dados que o paciente informou.",
  invalida: "Consulta inválida.",
  naoEncontrada: "Esta consulta não está mais na agenda. Atualize a página.",
  naoLeu: "Não foi possível carregar os dados. Tente de novo.",
} as const;

export async function lerDadosInformadosAction(
  id: unknown,
): Promise<ResultadoDosDadosInformados> {
  const context = await getSessionContext();
  if (!context?.active) {
    return { ok: false, error: TEXTOS_DOS_DADOS_INFORMADOS.sessaoExpirada };
  }
  // Quem aprova (a Agenda com escrita): o papel leitura nao le, nem pela
  // RPC (user_can_write).
  if (!canEdit(context.active.role, "agenda")) {
    return { ok: false, error: TEXTOS_DOS_DADOS_INFORMADOS.semPermissao };
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: TEXTOS_DOS_DADOS_INFORMADOS.invalida };
  }
  const clinicId = context.active.clinicId;
  const supabase = await createClient();
  const lido = await lerDadosInformadosNaMarcacao(
    supabase,
    clinicId,
    parsed.data,
  );
  if (!lido.ok) {
    log.warn("agenda_dados_informados_nao_lidos", {
      clinic_id: clinicId,
      user_id: context.userId,
      error_code: lido.codigo,
    });
    return {
      ok: false,
      error:
        lido.codigo === "42501"
          ? TEXTOS_DOS_DADOS_INFORMADOS.semPermissao
          : lido.codigo === "P0002"
            ? TEXTOS_DOS_DADOS_INFORMADOS.naoEncontrada
            : TEXTOS_DOS_DADOS_INFORMADOS.naoLeu,
    };
  }
  if (lido.dados === null) {
    return { ok: true, dados: null };
  }
  const { aplicadoPorId, ...dados } = lido.dados;
  let aplicadoPor: DadosInformadosDaConsulta["aplicadoPor"] = null;
  if (aplicadoPorId !== null) {
    let nome: string | null = null;
    try {
      nome =
        (await fetchProfileNames(supabase, [aplicadoPorId]))[aplicadoPorId] ??
        null;
    } catch {
      // Sem o nome os dados continuam na tela: "por alguém da equipe".
      nome = null;
    }
    aplicadoPor = { nome };
  }
  return { ok: true, dados: { ...dados, aplicadoPor } };
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
