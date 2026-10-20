import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { diaCivil, instanteLocal, somarDias } from "@/lib/domain/horarios";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// E4, a IA marca consulta pelo WhatsApp (migration 20261020130000_ia_agenda),
// contra o banco REAL, pelo cliente de servico (o servidor, como o motor da
// IA chama). O que o ensaio nao prova, porque roda numa transacao so: as
// chamadas em transacoes separadas, no banco de verdade.
//
// LIMITE (revisao da E4): os casos "ao mesmo tempo" disparam as RPCs por
// HTTP (Promise.all) e NAO forcam a sobreposicao dentro do Postgres: se o
// PostgREST executar as duas em sequencia (a RPC leva milissegundos), o
// resultado esperado sai igual sem trava nenhuma. Eles provam o resultado
// final no banco real, nao a trava. A prova deterministica das travas (uma
// conexao segura a transacao aberta e a outra TEM de esperar) e
// scripts/dev/prova-e4-concorrencia-local.mjs, no Postgres LOCAL descartavel
// (nunca na producao): pega a falta da trava do profissional, da conversa e
// do recurso.
// - duas (e cinco) conversas reservando o mesmo horario ao mesmo tempo:
//   fica UMA reserva; as outras recebem reservado_por_outra_conversa;
// - a recepcao marcando por cima da reserva (o servidor da Agenda nao olha
//   reserva, risco aceito): o agendar da IA da conflito e nada grava; e os
//   dois AO MESMO TEMPO no mesmo horario terminam com UMA consulta (a
//   exclusion constraint: a IA recebe conflito, ou a recepcao recebe 23P01);
// - reserva vencida nao marca (reserva_vencida, ou reserva_inexistente se a
//   manutencao do motor, a cada minuto, ja a apagou);
// - repetir o job nao duplica: o reservar e o agendar com o mesmo job, ao
//   mesmo tempo, devolvem a mesma reserva e a mesma consulta (uma delas
//   reutilizada) e gravam uma so;
// - uma reserva por conversa: dois turnos da mesma conversa ao mesmo tempo
//   deixam uma reserva viva, no mesmo profissional e em dois profissionais
//   (a trava da conversa; a do profissional nao basta);
// - (revisao da E4) a confirmacao vale so DEPOIS da pergunta da IA: a
//   mensagem do paciente que chegou entre a reserva e a pergunta nao marca;
// - (revisao da E4) a reserva protege o recurso do procedimento: a outra
//   conversa, em outro profissional que usa a mesma sala, recebe
//   reservado_por_outra_conversa.
//
// ESCRITO NA E4 E NAO RODADO por quem escreveu: grava no banco. Quem roda e
// o coordenador, DEPOIS de aplicar a migration, com npm run test:integration.
//
// CUIDADO, o banco e o da producao: clinica e_de_teste (fora da lista
// fechada: nao depende do interruptor, so atende em numero 'fake' e o motor
// da IA de producao nunca a reivindica), apagada no afterAll (a conversa
// leva as reservas junto, on delete cascade). O interruptor global NUNCA e
// tocado. Nada usa a id da salud-care, da teste123 nem da Conduzza Teste.
// Nenhuma mensagem sai (numero fake e nenhum executor roda aqui). Telefones
// ficticios.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic
//    where slug like 'ia-agenda-concorrencia-%' and e_de_teste;

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const FUSO = "America/Fortaleza";
const clinicas: string[] = [];

type Reserva = {
  ok: boolean;
  motivo?: string;
  hold_id?: string;
  starts_at?: string;
  ends_at?: string;
  expires_at?: string;
  reutilizado?: boolean;
};

type Marcacao = {
  ok: boolean;
  motivo?: string;
  appointment_id?: string;
  starts_at?: string;
  ends_at?: string;
  reutilizado?: boolean;
};

type Conversa = { conversa: string; contato: string };

let clinica = "";
let numero = "";
let profissional = "";
let vinculo = "";
let vinculoDoSegundo = "";
let vinculoDaSala = "";
let vinculoDaSalaDoSegundo = "";
let contatoDaRecepcao = "";
let telefones = 0;

// Daqui a 3 dias, no fuso da clinica: dentro da antecedencia (2 h) e do
// horizonte (30 dias). A jornada cobre o dia todo, todos os dias da semana.
const dia = somarDias(diaCivil(FUSO, new Date()), 3);
const as = (hora: string): string =>
  instanteLocal(FUSO, dia, hora).toISOString();
const meiaHoraDepois = (inicio: string): string =>
  new Date(Date.parse(inicio) + 30 * 60_000).toISOString();

async function rpcOk<T>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
}

/** Telefone da equipe liberado, contato e conversa NA IA (pelo servidor). */
async function novaConversa(): Promise<Conversa> {
  telefones += 1;
  const telefone = `+55849${digitos}${String(telefones).padStart(2, "0")}`;
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinica,
    p_telefone_e164: telefone,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_confirmou_aviso_da_openai: true,
  });
  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinica,
      phone_e164: telefone,
      name: `Contato sintético ${telefones}`,
    })
    .select("id")
    .single()
    .throwOnError();
  const contatoId = (contato as { id: string }).id;
  const { data: conversa } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinica,
      contact_id: contatoId,
      status: "ia_atendendo",
      whatsapp_account_id: numero,
    })
    .select("id")
    .single()
    .throwOnError();
  return { conversa: (conversa as { id: string }).id, contato: contatoId };
}

async function reservar(
  conversa: string,
  inicio: string,
  job: string = crypto.randomUUID(),
  vinculoDaReserva: string = vinculo,
): Promise<Reserva> {
  return rpcOk<Reserva>("reservar_horario_da_ia", {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_service_link_id: vinculoDaReserva,
    p_starts_at: inicio,
    p_job_id: job,
  });
}

async function agendar(
  conversa: string,
  job: string = crypto.randomUUID(),
): Promise<Marcacao> {
  return rpcOk<Marcacao>("agendar_pela_ia", {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_job_id: job,
  });
}

/**
 * Uma mensagem da conversa: do paciente (entrada) ou a resposta da IA
 * (saida, sem job: a clinica e_de_teste aceita, como as fixtures).
 */
async function mensagem(
  conversa: string,
  autor: "paciente" | "ia",
): Promise<void> {
  await admin
    .from("message")
    .insert({
      clinic_id: clinica,
      conversation_id: conversa,
      direction: autor === "paciente" ? "entrada" : "saida",
      author: autor,
      content_type: "texto",
      body:
        autor === "paciente"
          ? "Mensagem sintética de confirmação"
          : "Pergunta sintética da IA",
    })
    .throwOnError();
}

/**
 * A confirmacao do paciente: a pergunta da IA DEPOIS da reserva e a
 * mensagem DELE depois da pergunta (revisao da E4: e o que o agendar exige).
 */
async function mensagemDoPaciente(conversa: string): Promise<void> {
  await mensagem(conversa, "ia");
  await mensagem(conversa, "paciente");
}

/** Consultas nao canceladas do profissional que comecam no horario. */
async function consultasNoHorario(
  inicio: string,
): Promise<{ id: string; created_by: string }[]> {
  const { data } = await admin
    .from("appointment")
    .select("id, created_by")
    .eq("clinic_id", clinica)
    .eq("professional_id", profissional)
    .eq("starts_at", inicio)
    .not("status", "in", "(cancelado_paciente,cancelado_clinica)")
    .throwOnError();
  return data as { id: string; created_by: string }[];
}

/** Reservas vivas (nao consumidas, nao vencidas) do profissional no horario. */
async function reservasVivasNoHorario(inicio: string): Promise<number> {
  const { count } = await admin
    .from("slot_hold")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinica)
    .eq("professional_id", profissional)
    .eq("starts_at", inicio)
    .is("consumido_em", null)
    .gt("expires_at", new Date().toISOString())
    .throwOnError();
  return count ?? 0;
}

async function consultaDaRecepcao(inicio: string) {
  return admin
    .from("appointment")
    .insert({
      clinic_id: clinica,
      contact_id: contatoDaRecepcao,
      professional_id: profissional,
      service_link_id: vinculo,
      starts_at: inicio,
      ends_at: meiaHoraDepois(inicio),
      status: "agendado",
      created_by: "usuario",
    })
    .select("id");
}

beforeAll(async () => {
  const { data: criada } = await admin
    .from("clinic")
    .insert({
      name: `IA agenda concorrência ${sufixo}`,
      slug: `ia-agenda-concorrencia-${sufixo}`,
      e_de_teste: true,
      timezone: FUSO,
    })
    .select("id")
    .single()
    .throwOnError();
  clinica = (criada as { id: string }).id;
  clinicas.push(clinica);
  numero = (await criarNumeroDeTeste(admin, clinica, { nome: "Recepção" })).id;

  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinica,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de integracao da E4",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinica,
    p_whatsapp_account_id: numero,
    p_ativo: true,
  });
  // A versao publicada em uso: Agendar ligada, 2 h de antecedencia e 30 dias.
  await admin
    .from("ai_agent_config")
    .insert({
      clinic_id: clinica,
      version: 1,
      status: "publicada",
      skills: { agendar: true },
      agenda_antecedencia_horas: 2,
      agenda_horizonte_dias: 30,
    })
    .throwOnError();

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinica, name: "Dra. Concorrência" })
    .select("id")
    .single()
    .throwOnError();
  profissional = (prof as { id: string }).id;
  const { data: proc } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinica,
      name: "Consulta sintética",
      default_duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: link } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinica,
      professional_id: profissional,
      procedure_id: (proc as { id: string }).id,
      duration_min: 30,
      price_cents: 20000,
    })
    .select("id")
    .single()
    .throwOnError();
  vinculo = (link as { id: string }).id;
  await admin
    .from("professional_schedule")
    .insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        clinic_id: clinica,
        professional_id: profissional,
        weekday,
        starts_at: "07:00",
        ends_at: "20:00",
      })),
    )
    .throwOnError();

  // Um segundo profissional: a mesma conversa em dois profissionais so fica
  // com uma reserva pela trava da CONVERSA (a do profissional nao basta).
  const { data: segundo } = await admin
    .from("professional")
    .insert({ clinic_id: clinica, name: "Dr. Segundo" })
    .select("id")
    .single()
    .throwOnError();
  const segundoId = (segundo as { id: string }).id;
  const { data: linkDoSegundo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinica,
      professional_id: segundoId,
      procedure_id: (proc as { id: string }).id,
      duration_min: 30,
      price_cents: 20000,
    })
    .select("id")
    .single()
    .throwOnError();
  vinculoDoSegundo = (linkDoSegundo as { id: string }).id;
  await admin
    .from("professional_schedule")
    .insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        clinic_id: clinica,
        professional_id: segundoId,
        weekday,
        starts_at: "07:00",
        ends_at: "20:00",
      })),
    )
    .throwOnError();

  // Revisao da E4: um procedimento que usa uma sala, nos dois profissionais
  // (a reserva protege o recurso).
  const { data: sala } = await admin
    .from("resource")
    .insert({ clinic_id: clinica, name: "Sala sintética", kind: "sala" })
    .select("id")
    .single()
    .throwOnError();
  const { data: procDaSala } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinica,
      name: "Procedimento sintético da sala",
      default_duration_min: 30,
      resource_id: (sala as { id: string }).id,
    })
    .select("id")
    .single()
    .throwOnError();
  const vinculoNaSala = async (quem: string): Promise<string> => {
    const { data: link } = await admin
      .from("service_link")
      .insert({
        clinic_id: clinica,
        professional_id: quem,
        procedure_id: (procDaSala as { id: string }).id,
        duration_min: 30,
        price_cents: 20000,
      })
      .select("id")
      .single()
      .throwOnError();
    return (link as { id: string }).id;
  };
  vinculoDaSala = await vinculoNaSala(profissional);
  vinculoDaSalaDoSegundo = await vinculoNaSala(segundoId);

  const { data: paciente } = await admin
    .from("contact")
    .insert({
      clinic_id: clinica,
      phone_e164: `+55848${digitos}99`,
      name: "Paciente sintético da recepção",
      kind: "paciente",
    })
    .select("id")
    .single()
    .throwOnError();
  contatoDaRecepcao = (paciente as { id: string }).id;
});

afterAll(async () => {
  if (clinicas.length > 0) {
    await admin.from("clinic").delete().in("id", clinicas);
  }
});

describe("duas conversas, o mesmo horário", () => {
  it("ao mesmo tempo: uma reserva ganha, a outra recebe reservado_por_outra_conversa", async () => {
    const [a, b] = await Promise.all([novaConversa(), novaConversa()]);
    const inicio = as("09:00");
    const resultados = await Promise.all([
      reservar(a.conversa, inicio),
      reservar(b.conversa, inicio),
    ]);
    const ganhou = resultados.filter((r) => r.ok);
    const perdeu = resultados.filter((r) => !r.ok);
    expect(ganhou).toHaveLength(1);
    expect(perdeu).toHaveLength(1);
    expect(perdeu[0]!.motivo).toBe("reservado_por_outra_conversa");
    expect(Date.parse(ganhou[0]!.starts_at!)).toBe(Date.parse(inicio));
    // Anti falso positivo: exatamente UMA reserva viva no horario.
    expect(await reservasVivasNoHorario(inicio)).toBe(1);
  });

  it("cinco conversas ao mesmo tempo no mesmo horário: uma reserva só", async () => {
    const conversas = await Promise.all(
      Array.from({ length: 5 }, () => novaConversa()),
    );
    const inicio = as("09:30");
    const resultados = await Promise.all(
      conversas.map((c) => reservar(c.conversa, inicio)),
    );
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    for (const recusada of resultados.filter((r) => !r.ok)) {
      expect(recusada.motivo).toBe("reservado_por_outra_conversa");
    }
    expect(await reservasVivasNoHorario(inicio)).toBe(1);
  });
});

describe("a recepção marca durante a reserva", () => {
  it("consulta da recepção por cima da reserva: o agendar da IA dá conflito e nada grava", async () => {
    const c = await novaConversa();
    const inicio = as("10:00");
    const reserva = await reservar(c.conversa, inicio);
    expect(reserva.ok).toBe(true);
    // O servidor da Agenda nao olha a reserva (risco aceito): a recepcao marca.
    const { error } = await consultaDaRecepcao(inicio);
    expect(error).toBeNull();
    await mensagemDoPaciente(c.conversa);

    const marcacao = await agendar(c.conversa);
    expect(marcacao).toEqual({ ok: false, motivo: "conflito" });
    const consultas = await consultasNoHorario(inicio);
    expect(consultas.map((linha) => linha.created_by)).toEqual(["usuario"]);
    const { data: hold } = await admin
      .from("slot_hold")
      .select("consumido_em, appointment_id")
      .eq("id", reserva.hold_id!)
      .single()
      .throwOnError();
    expect(hold).toEqual({ consumido_em: null, appointment_id: null });
    const { count: eventos } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", c.conversa)
      .eq("content_type", "evento")
      .throwOnError();
    expect(eventos).toBe(0);
  });

  it("ao mesmo tempo, a IA e a recepção no mesmo horário: uma consulta só", async () => {
    const c = await novaConversa();
    const inicio = as("11:00");
    expect((await reservar(c.conversa, inicio)).ok).toBe(true);
    await mensagemDoPaciente(c.conversa);

    const [ia, recepcao] = await Promise.all([
      agendar(c.conversa),
      consultaDaRecepcao(inicio),
    ]);
    const consultas = await consultasNoHorario(inicio);
    expect(consultas).toHaveLength(1);
    if (ia.ok) {
      // A IA gravou primeiro: a recepcao bateu na exclusion constraint.
      expect(recepcao.error?.code).toBe("23P01");
      expect(consultas[0]!.created_by).toBe("ia");
    } else {
      expect(ia.motivo).toBe("conflito");
      expect(recepcao.error).toBeNull();
      expect(consultas[0]!.created_by).toBe("usuario");
    }
  });
});

describe("reserva vencida", () => {
  it("não marca", async () => {
    const c = await novaConversa();
    const inicio = as("13:00");
    const reserva = await reservar(c.conversa, inicio);
    expect(reserva.ok).toBe(true);
    await admin
      .from("slot_hold")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", reserva.hold_id!)
      .throwOnError();
    await mensagemDoPaciente(c.conversa);

    const marcacao = await agendar(c.conversa);
    expect(marcacao.ok).toBe(false);
    // A manutencao do motor (a cada minuto) pode ter apagado a vencida.
    expect(["reserva_vencida", "reserva_inexistente"]).toContain(
      marcacao.motivo,
    );
    expect(await consultasNoHorario(inicio)).toEqual([]);
  });
});

describe("repetir o job não duplica", () => {
  let conversa: Conversa;
  let consulta = "";
  const jobDoAgendar = crypto.randomUUID();
  const inicio = as("14:00");

  it("o reservar com o mesmo job, ao mesmo tempo: a mesma reserva", async () => {
    conversa = await novaConversa();
    const job = crypto.randomUUID();
    const [a, b] = await Promise.all([
      reservar(conversa.conversa, inicio, job),
      reservar(conversa.conversa, inicio, job),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.hold_id).toBe(b.hold_id);
    expect([a.reutilizado, b.reutilizado].sort()).toEqual([false, true]);
    const { count } = await admin
      .from("slot_hold")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job)
      .throwOnError();
    expect(count).toBe(1);
  });

  it("o agendar com o mesmo job, ao mesmo tempo: a mesma consulta, pendente", async () => {
    await mensagemDoPaciente(conversa.conversa);
    const [a, b] = await Promise.all([
      agendar(conversa.conversa, jobDoAgendar),
      agendar(conversa.conversa, jobDoAgendar),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.appointment_id).toBe(b.appointment_id);
    expect([a.reutilizado, b.reutilizado].sort()).toEqual([false, true]);
    consulta = a.appointment_id!;

    const consultas = await consultasNoHorario(inicio);
    expect(consultas).toEqual([{ id: consulta, created_by: "ia" }]);
    const { data: linha } = await admin
      .from("appointment")
      .select(
        "status, approval_status, send_confirmation, oferecer_vaga_ao_cancelar, is_overbooking, contact_id",
      )
      .eq("id", consulta)
      .single()
      .throwOnError();
    expect(linha).toEqual({
      status: "agendado",
      approval_status: "pendente",
      send_confirmation: false,
      oferecer_vaga_ao_cancelar: false,
      is_overbooking: false,
      contact_id: conversa.contato,
    });
    const { count: eventos } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversa.conversa)
      .eq("content_type", "evento")
      .like("body", "A IA marcou %")
      .throwOnError();
    expect(eventos).toBe(1);
  });

  it("o job repetido depois de marcar devolve a mesma consulta; job novo sem reserva viva não marca", async () => {
    const deNovo = await agendar(conversa.conversa, jobDoAgendar);
    expect(deNovo).toMatchObject({
      ok: true,
      appointment_id: consulta,
      reutilizado: true,
    });
    const outroJob = await agendar(conversa.conversa);
    expect(outroJob).toEqual({ ok: false, motivo: "reserva_inexistente" });
    expect(await consultasNoHorario(inicio)).toHaveLength(1);
  });
});

describe("uma reserva por conversa", () => {
  it("dois turnos da mesma conversa ao mesmo tempo, horários diferentes: fica uma reserva viva", async () => {
    const c = await novaConversa();
    const [a, b] = await Promise.all([
      reservar(c.conversa, as("15:00")),
      reservar(c.conversa, as("15:30")),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const { data: vivas } = await admin
      .from("slot_hold")
      .select("id")
      .eq("conversation_id", c.conversa)
      .is("consumido_em", null)
      .throwOnError();
    expect(vivas).toHaveLength(1);
    expect([a.hold_id, b.hold_id]).toContain(
      (vivas as { id: string }[])[0]!.id,
    );
  });

  it("a mesma conversa em dois profissionais ao mesmo tempo: fica uma reserva viva", async () => {
    const c = await novaConversa();
    const inicio = as("16:00");
    const [a, b] = await Promise.all([
      reservar(c.conversa, inicio, crypto.randomUUID(), vinculo),
      reservar(c.conversa, inicio, crypto.randomUUID(), vinculoDoSegundo),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const { data: vivas } = await admin
      .from("slot_hold")
      .select("id")
      .eq("conversation_id", c.conversa)
      .is("consumido_em", null)
      .throwOnError();
    expect(vivas).toHaveLength(1);
  });
});

describe("a confirmação vale depois da pergunta da IA (revisão da E4)", () => {
  it("a mensagem do paciente entre a reserva e a pergunta não marca; a de depois marca", async () => {
    const c = await novaConversa();
    const inicio = as("17:00");
    expect((await reservar(c.conversa, inicio)).ok).toBe(true);
    // Chegou enquanto a IA ainda escrevia a pergunta.
    await mensagem(c.conversa, "paciente");
    await mensagem(c.conversa, "ia");
    expect(await agendar(c.conversa)).toEqual({
      ok: false,
      motivo: "sem_confirmacao_do_paciente",
    });
    expect(await consultasNoHorario(inicio)).toEqual([]);
    // A resposta dele depois da pergunta.
    await mensagem(c.conversa, "paciente");
    const marcou = await agendar(c.conversa);
    expect(marcou.ok).toBe(true);
    expect(
      (await consultasNoHorario(inicio)).map((linha) => linha.created_by),
    ).toEqual(["ia"]);
  });
});

describe("a reserva protege o recurso do procedimento (revisão da E4)", () => {
  it("outra conversa, em outro profissional que usa a mesma sala, não reserva o horário", async () => {
    const [a, b] = await Promise.all([novaConversa(), novaConversa()]);
    const inicio = as("18:00");
    expect(
      (await reservar(a.conversa, inicio, crypto.randomUUID(), vinculoDaSala))
        .ok,
    ).toBe(true);
    expect(
      await reservar(
        b.conversa,
        inicio,
        crypto.randomUUID(),
        vinculoDaSalaDoSegundo,
      ),
    ).toEqual({ ok: false, motivo: "reservado_por_outra_conversa" });
    // Encostada (18:30), a sala esta livre.
    expect(
      (
        await reservar(
          b.conversa,
          as("18:30"),
          crypto.randomUUID(),
          vinculoDaSalaDoSegundo,
        )
      ).ok,
    ).toBe(true);
  });
});
