import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { diaCivil, instanteLocal, somarDias } from "@/lib/domain/horarios";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// "Manter o horario" (Confirmacoes) contra a remarcacao que a IA pede no
// meio (revisao das telas da AG4, achado 7; revisao curta, B4): a acao le a
// marca e a versao da consulta (updated_at, pelo supabase-js), confere que
// nao ha remarcacao da IA pendente e zera a marca com
// .eq("updated_at", lido). A prova de banco de que a versao lida protege:
// - com a antiga ja marcada ("Pediu para remarcar"), a versao lida, depois a
//   IA pede a remarcacao (agendar_pela_ia com p_remarcar: a marca fica, por
//   coalesce, mas o gatilho set_updated_at muda a versao): o update com a
//   versao lida nao acha a linha, a marca fica e a remarcacao pendente esta
//   la para a segunda volta da acao recusar;
// - o positivo: sem gravacao no meio, a mesma string (o updated_at como o
//   PostgREST devolve, com microssegundos e fuso) acha a linha e zera a
//   marca.
// A remarcacao e montada como nos testes da AG4 (o pedido armado, a reserva
// com p_remarcar, a pergunta, o "sim" e a linha do turno do job com as
// mensagens lidas, como o motor).
//
// CUIDADO, o banco e o da producao: a clinica e_de_teste com o slug
// manter-horario-int-*, apagada no afterAll (consultas, reservas, estado,
// trilha, jobs e mensagens vao em cascata; o beforeAll apaga a sobra de uma
// execucao que morreu ha mais de uma hora). A IA liberada so nela (fora da
// lista fechada: nao depende do interruptor, so atende em numero 'fake' e o
// motor da IA de producao nunca a reivindica; os jobs sao montados direto e
// nenhum executor roda aqui; nenhuma mensagem sai). O interruptor global
// NUNCA e tocado. Telefones ficticios. ESCRITO, AINDA NAO RODADO: grava no
// banco. Roda depois de aplicar a migration 20261028100000, com
// npm run test:integration -- manter-horario-concorrencia.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic
//    where slug like 'manter-horario-int-%' and e_de_teste;

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const FUSO = "America/Fortaleza";

type Resposta = {
  ok: boolean;
  motivo?: string;
  appointment_id?: string;
  hold_id?: string;
  remarcacao_de?: string;
};

let clinica = "";
let numero = "";
let profissional = "";
let vinculo = "";
let telefones = 0;

// Daqui a 5 dias, no fuso da clinica: fora do prazo de remarcar (48 h),
// dentro da antecedencia (2 h) e do horizonte (30 dias).
const dia = somarDias(diaCivil(FUSO, new Date()), 5);
const as = (hora: string, mais = 0): string =>
  instanteLocal(FUSO, somarDias(dia, mais), hora).toISOString();
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

async function inserir(
  tabela: string,
  linha: Record<string, unknown>,
): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/** Telefone liberado, contato e conversa NA IA pela ingestao (com a janela). */
async function conversaNaIa(): Promise<{ contato: string; conversa: string }> {
  telefones += 1;
  const n = telefones;
  const telefone = `+55843${digitos}${String(n).padStart(2, "0")}`;
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinica,
    p_telefone_e164: telefone,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_confirmou_aviso_da_openai: true,
  });
  const r = await rpcOk<{
    conversation_id: string | null;
    contact_id: string | null;
    ia_atendendo?: boolean;
  }>("ingest_inbound_message", {
    p_clinic_id: clinica,
    p_phone_e164: telefone,
    p_name: "Contato sintético",
    p_wa_message_id: `manter-horario-int:${sufixo}:${n}`,
    p_content_type: "texto",
    p_body: "Mensagem sintética",
    p_whatsapp_account_id: numero,
  });
  expect(r.ia_atendendo, "a conversa nasce na IA").toBe(true);
  return { contato: r.contact_id!, conversa: r.conversation_id! };
}

/** Um job da IA em execucao da conversa (como o claim deixaria). */
async function job(conversa: string): Promise<string> {
  return inserir("job_queue", {
    clinic_id: clinica,
    kind: "responder_com_ia",
    whatsapp_account_id: numero,
    payload: { conversation_id: conversa },
    status: "executando",
    locked_by: `manter-horario-int-${sufixo}`,
    locked_at: new Date().toISOString(),
    attempts: 1,
    max_attempts: 3,
  });
}

/**
 * O job leu a conversa, como o motor antes de chamar o modelo: as mensagens
 * do paciente (nao apagadas) vao para ai_turno.mensagens_lidas.
 */
async function leu(jobId: string, conversa: string): Promise<string> {
  const { data } = await admin
    .from("message")
    .select("id")
    .eq("conversation_id", conversa)
    .eq("direction", "entrada")
    .eq("author", "paciente")
    .is("deleted_at", null)
    .order("created_at")
    .throwOnError();
  await admin
    .from("ai_turno")
    .upsert(
      {
        job_id: jobId,
        clinic_id: clinica,
        conversation_id: conversa,
        estado: "reservado",
        mensagens_lidas: (data as { id: string }[]).map((m) => m.id),
      },
      { onConflict: "job_id" },
    )
    .throwOnError();
  return jobId;
}

async function mensagem(
  conversa: string,
  quem: "ia" | "paciente",
): Promise<void> {
  await admin
    .from("message")
    .insert({
      clinic_id: clinica,
      conversation_id: conversa,
      content_type: "texto",
      ...(quem === "ia"
        ? {
            direction: "saida",
            author: "ia",
            body: "Pergunta sintética da IA",
          }
        : {
            direction: "entrada",
            author: "paciente",
            body: "Mensagem sintética de confirmação",
          }),
    })
    .throwOnError();
}

/** A consulta da recepcao, de 30 minutos, ja com a marca "Pediu para remarcar". */
async function antigaMarcada(contato: string, inicio: string): Promise<string> {
  const id = await inserir("appointment", {
    clinic_id: clinica,
    contact_id: contato,
    professional_id: profissional,
    service_link_id: vinculo,
    starts_at: inicio,
    ends_at: meiaHoraDepois(inicio),
    status: "agendado",
    created_by: "usuario",
  });
  await admin
    .from("appointment")
    .update({ remarcacao_pedida_em: new Date().toISOString() })
    .eq("id", id)
    .throwOnError();
  return id;
}

/** A marca e a versao da consulta, como a acao le (pelo supabase-js). */
async function marcaEVersao(
  id: string,
): Promise<{ remarcacao_pedida_em: string | null; updated_at: string }> {
  const { data } = await admin
    .from("appointment")
    .select("remarcacao_pedida_em, updated_at")
    .eq("clinic_id", clinica)
    .eq("id", id)
    .single()
    .throwOnError();
  return data as { remarcacao_pedida_em: string | null; updated_at: string };
}

/** O update da acao: so zera a marca da versao lida. */
async function zerarMarca(id: string, lido: string): Promise<string[]> {
  const { data } = await admin
    .from("appointment")
    .update({ remarcacao_pedida_em: null })
    .eq("clinic_id", clinica)
    .eq("id", id)
    .eq("updated_at", lido)
    .not("remarcacao_pedida_em", "is", null)
    .select("id")
    .throwOnError();
  return (data as { id: string }[]).map((linha) => linha.id);
}

/** A IA pede a remarcacao da antiga, pelo caminho de verdade. */
async function iaPedeARemarcacao(
  conversa: string,
  antiga: string,
  novoInicio: string,
): Promise<Resposta> {
  const { data: linha } = await admin
    .from("ia_atendimento")
    .select("versao")
    .eq("conversation_id", conversa)
    .maybeSingle()
    .throwOnError();
  const gravado = await rpcOk<{ ok: boolean }>("gravar_atendimento_da_ia", {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_job_id: await job(conversa),
    p_versao: (linha as { versao: number } | null)?.versao ?? 0,
    p_estado: {
      etapa: "remarcar",
      intencao: "remarcar",
      procedure_id: null,
      professional_id: null,
      insurance_id: null,
      particular: null,
      unit_id: null,
      horarios_oferecidos: [],
      slot_hold_id: null,
      appointment_id: antiga,
      pedido_pendente: "remarcar",
      pedido_pendente_em: null,
      falhas_seguidas: 0,
      desfecho: null,
    },
  });
  expect(gravado, "armar o pedido de remarcar").toMatchObject({ ok: true });
  const reserva = await rpcOk<Resposta>("reservar_horario_da_ia", {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_service_link_id: vinculo,
    p_starts_at: novoInicio,
    p_job_id: await job(conversa),
    p_remarcar: antiga,
  });
  expect(reserva, "a reserva da remarcacao").toMatchObject({ ok: true });
  await mensagem(conversa, "ia");
  await mensagem(conversa, "paciente");
  return rpcOk<Resposta>("agendar_pela_ia", {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_job_id: await leu(await job(conversa), conversa),
    p_slot_hold_id: reserva.hold_id,
    p_remarcar: antiga,
  });
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "manter-horario-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinica = await inserir("clinic", {
    name: `Manter horário integração ${sufixo}`,
    slug: `manter-horario-int-${sufixo}`,
    e_de_teste: true,
    timezone: FUSO,
  });
  numero = (await criarNumeroDeTeste(admin, clinica, { nome: "Recepção" })).id;
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinica,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de integracao do Manter o horario (AG4)",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinica,
    p_whatsapp_account_id: numero,
    p_ativo: true,
  });
  await inserir("ai_agent_config", {
    clinic_id: clinica,
    version: 1,
    status: "publicada",
    skills: { agendar: true, cancelar: true, remarcar: true },
    agenda_antecedencia_horas: 2,
    agenda_horizonte_dias: 30,
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: false,
    cancelar_antecedencia_horas: 24,
    remarcar_antecedencia_horas: 48,
  });
  profissional = await inserir("professional", {
    clinic_id: clinica,
    name: "Dra. Manter",
  });
  const procedimento = await inserir("procedure", {
    clinic_id: clinica,
    name: "Consulta sintética",
    default_duration_min: 30,
  });
  vinculo = await inserir("service_link", {
    clinic_id: clinica,
    professional_id: profissional,
    procedure_id: procedimento,
    duration_min: 30,
    price_cents: 20000,
  });
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
}, 120_000);

afterAll(async () => {
  if (clinica) {
    const { error } = await admin.from("clinic").delete().eq("id", clinica);
    expect(error, "apagar a clinica do teste").toBeNull();
  }
}, 60_000);

describe("Manter o horário: a versão lida (updated_at) contra a remarcação da IA no meio", () => {
  it("a IA pede a remarcação depois da leitura: o update com a versão lida não acha a linha e a marca fica", async () => {
    const { contato, conversa } = await conversaNaIa();
    const antiga = await antigaMarcada(contato, as("09:00"));
    // 1. A acao le a marca e a versao (antes de conferir a remarcacao).
    const lida = await marcaEVersao(antiga);
    expect(lida.remarcacao_pedida_em).not.toBeNull();
    // 2. No meio, a IA pede a remarcacao (a marca fica, por coalesce; o
    // gatilho set_updated_at muda a versao).
    const remarcada = await iaPedeARemarcacao(conversa, antiga, as("09:00", 1));
    expect(remarcada).toMatchObject({ ok: true, remarcacao_de: antiga });
    const depois = await marcaEVersao(antiga);
    expect(depois.remarcacao_pedida_em).toBe(lida.remarcacao_pedida_em);
    expect(depois.updated_at).not.toBe(lida.updated_at);
    // 3. O update da acao com a versao lida: zero linhas, a marca fica.
    expect(await zerarMarca(antiga, lida.updated_at)).toEqual([]);
    expect((await marcaEVersao(antiga)).remarcacao_pedida_em).toBe(
      lida.remarcacao_pedida_em,
    );
    // 4. A segunda volta da acao ve a remarcacao da IA esperando a equipe
    // (e recusa sem zerar nada).
    const { data: pendentes } = await admin
      .from("appointment")
      .select("id")
      .eq("clinic_id", clinica)
      .eq("remarcacao_de", antiga)
      .eq("approval_status", "pendente")
      .not("status", "in", "(cancelado_paciente,cancelado_clinica)")
      .throwOnError();
    expect(pendentes).toEqual([{ id: remarcada.appointment_id }]);
  });

  it("o positivo: sem gravação no meio, a mesma string (como o PostgREST devolve) acha a linha e zera a marca", async () => {
    const { contato } = await conversaNaIa();
    const antiga = await antigaMarcada(contato, as("10:00"));
    const lida = await marcaEVersao(antiga);
    expect(lida.remarcacao_pedida_em).not.toBeNull();
    expect(await zerarMarca(antiga, lida.updated_at)).toEqual([antiga]);
    expect((await marcaEVersao(antiga)).remarcacao_pedida_em).toBeNull();
    // A versao mudou com o proprio update: a mesma string ja nao acha (e a
    // marca ja esta nula).
    expect(await zerarMarca(antiga, lida.updated_at)).toEqual([]);
  });
});
