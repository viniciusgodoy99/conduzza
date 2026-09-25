import { afterAll, describe, expect, it } from "vitest";

import { importarContatos } from "@/lib/integrations/importar-contatos";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp/send";
import { executarPassoDeRegua } from "@/lib/jobs/regua";
import type { Job } from "@/lib/jobs/worker";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Revisao de liberacao de 24/09/2026, grupo reguas-e-fila, contra o banco
// REAL (migration 20260924101000_reguas_e_fila.sql):
//
//   - importacao nao inscreve no follow-up; mudar a etapa depois inscreve, e o
//     job de follow-up nasce com prioridade 1;
//   - pedido de remarcacao segura o toque de confirmacao (planner e executor);
//   - os dois trilhos do slot anti-ban: a resposta 1:1 nao espera a fila das
//     mensagens automaticas, e a massa continua espacada.
//
// A ordem do claim por prioridade (claim_jobs_por_clinica) foi provada no
// ensaio da migration, numa transacao desfeita. Ela NAO tem teste aqui de
// proposito: este banco e o de producao, e reivindicar com clinicas reais no
// recorte tiraria da fila jobs de verdade por 180 segundos.
//
// Clinicas e_de_teste: o motor de producao as ignora; cada cenario executa o
// proprio job. Canal fake.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];
/** O numero de WhatsApp (whatsapp_account.id) de cada clinica criada aqui. */
const numeroDaClinica = new Map<string, string>();
const MINUTO = 60_000;
const HORA = 60 * MINUTO;

const JANELA_ABERTA = {
  send_window_start: "00:00",
  send_window_end: "23:59",
  send_weekdays: [0, 1, 2, 3, 4, 5, 6],
};

async function montarClinica(nome: string): Promise<string> {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Fila ${nome} ${sufixo}`,
      slug: `fila-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = clinica!.id as string;
  clinicasCriadas.push(clinicId);
  const numero = await criarNumeroDeTeste(admin, clinicId);
  numeroDaClinica.set(clinicId, numero.id);
  return clinicId;
}

async function reguaDeFollowupNoNovo(clinicId: string): Promise<void> {
  const { data: regua } = await admin
    .from("cadence")
    .insert({
      clinic_id: clinicId,
      kind: "followup",
      name: `Follow-up novo ${sufixo}`,
      trigger_stage: "novo",
      active: true,
      ...JANELA_ABERTA,
    })
    .select("id")
    .single()
    .throwOnError();
  await admin
    .from("cadence_step")
    .insert({
      clinic_id: clinicId,
      cadence_id: regua!.id as string,
      offset_minutes: 60,
      fixed_body: "Oi, {{nome}}! Podemos ajudar?",
    })
    .throwOnError();
}

async function planejar(): Promise<void> {
  const { error } = await admin.rpc("planejar_reguas");
  expect(error).toBeNull();
}

async function runsDoContato(clinicId: string, contactId: string) {
  const { data } = await admin
    .from("cadence_run")
    .select("id, sent_at, skipped_reason")
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId);
  return data ?? [];
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("importação não entra no follow-up", () => {
  it("o lead importado fica fora da régua da etapa em que nasceu; mudar a etapa depois inscreve", async () => {
    const clinicId = await montarClinica("importa");
    await reguaDeFollowupNoNovo(clinicId);

    const resultado = await importarContatos(admin, clinicId, {
      declaracao: { opcao: "recepcao" },
      lote: [
        {
          name: "Lead Planilha",
          phone_e164: "+5584977300001",
          email: null,
          insurance_name: null,
          source_campaign: null,
        },
      ],
    });
    expect(resultado.ok).toBe(true);

    const { data: contato } = await admin
      .from("contact")
      .select("id, criado_por_importacao, funnel_stage, created_at")
      .eq("clinic_id", clinicId)
      .single()
      .throwOnError();
    expect(contato!.criado_por_importacao).toBe(true);
    expect(contato!.funnel_stage).toBe("novo");
    const contactId = contato!.id as string;

    // Viagem no tempo: nasceu ha 60 minutos, com o relogio da etapa IGUAL ao
    // nascimento (e o que o insert grava). O passo de 60 min venceu agora.
    const umaHoraAtras = new Date(Date.now() - 60 * MINUTO).toISOString();
    await admin
      .from("contact")
      .update({ created_at: umaHoraAtras, funnel_stage_changed_at: umaHoraAtras })
      .eq("id", contactId)
      .throwOnError();
    await planejar();
    expect(await runsDoContato(clinicId, contactId)).toHaveLength(0);

    // Alguem muda a etapa (ato explicito): o relogio anda e o contato entra.
    const duasHorasAtras = new Date(Date.now() - 2 * HORA).toISOString();
    await admin
      .from("contact")
      .update({ created_at: duasHorasAtras, funnel_stage_changed_at: umaHoraAtras })
      .eq("id", contactId)
      .throwOnError();
    await planejar();
    const runs = await runsDoContato(clinicId, contactId);
    expect(runs).toHaveLength(1);

    const { data: jobs } = await admin
      .from("job_queue")
      .select("prioridade")
      .eq("clinic_id", clinicId)
      .eq("kind", "executar_passo_de_regua")
      .contains("payload", { cadence_run_id: runs[0]!.id });
    expect(jobs).toEqual([{ prioridade: 1 }]);
  });

  it("contato criado fora da importação continua entrando pela etapa em que nasceu", async () => {
    const clinicId = await montarClinica("manual");
    await reguaDeFollowupNoNovo(clinicId);
    const { data } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicId,
        phone_e164: "+5584977300002",
        name: "Lead Recepção",
      })
      .select("id")
      .single()
      .throwOnError();
    const contactId = data!.id as string;
    await admin
      .from("contact_consent")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        channel: "whatsapp",
        source: "recepcao",
      })
      .throwOnError();
    const umaHoraAtras = new Date(Date.now() - 60 * MINUTO).toISOString();
    await admin
      .from("contact")
      .update({ created_at: umaHoraAtras, funnel_stage_changed_at: umaHoraAtras })
      .eq("id", contactId)
      .throwOnError();
    await planejar();
    expect(await runsDoContato(clinicId, contactId)).toHaveLength(1);
  });
});

describe("pedido de remarcação segura o toque de confirmação", () => {
  async function consultaComRegua(clinicId: string, telefone: string) {
    const { data: contato } = await admin
      .from("contact")
      .insert({ clinic_id: clinicId, phone_e164: telefone, name: "Paciente" })
      .select("id")
      .single()
      .throwOnError();
    const contactId = contato!.id as string;
    await admin
      .from("contact_consent")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        channel: "whatsapp",
        source: "recepcao",
      })
      .throwOnError();
    const { data: prof } = await admin
      .from("professional")
      .insert({ clinic_id: clinicId, name: "Dra. Fila" })
      .select("id")
      .single()
      .throwOnError();
    const { data: proc } = await admin
      .from("procedure")
      .insert({ clinic_id: clinicId, name: "Avaliação", default_duration_min: 30 })
      .select("id")
      .single()
      .throwOnError();
    const { data: vinculo } = await admin
      .from("service_link")
      .insert({
        clinic_id: clinicId,
        professional_id: prof!.id,
        procedure_id: proc!.id,
        insurance_id: null,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("cadence")
      .update({ active: true, ...JANELA_ABERTA })
      .eq("clinic_id", clinicId)
      .eq("kind", "confirmacao")
      .throwOnError();
    // 3h10 a frente: o passo de 3h vence em 10 minutos.
    const inicio = new Date(Date.now() + 3 * HORA + 10 * MINUTO);
    const { data: consulta } = await admin
      .from("appointment")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        professional_id: prof!.id,
        service_link_id: vinculo!.id,
        starts_at: inicio.toISOString(),
        ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
        remarcacao_pedida_em: new Date().toISOString(),
      })
      .select("id")
      .single()
      .throwOnError();
    return { contactId, appointmentId: consulta!.id as string };
  }

  it("o planner não cria toque enquanto o pedido está aberto; o executor pula o que já existia", async () => {
    const clinicId = await montarClinica("remarca");
    const { contactId, appointmentId } = await consultaComRegua(
      clinicId,
      "+5584977300003",
    );

    await planejar();
    expect(await runsDoContato(clinicId, contactId)).toHaveLength(0);

    // Pedido resolvido: o toque volta a ser planejado.
    await admin
      .from("appointment")
      .update({ remarcacao_pedida_em: null })
      .eq("id", appointmentId)
      .throwOnError();
    await planejar();
    const runs = await runsDoContato(clinicId, contactId);
    expect(runs).toHaveLength(1);

    // O paciente pede de novo ANTES de o toque sair: o executor pula.
    await admin
      .from("appointment")
      .update({ remarcacao_pedida_em: new Date().toISOString() })
      .eq("id", appointmentId)
      .throwOnError();
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id, clinic_id, kind, payload, attempts, max_attempts")
      .eq("clinic_id", clinicId)
      .eq("kind", "executar_passo_de_regua")
      .contains("payload", { cadence_run_id: runs[0]!.id });
    // Varios numeros por clinica (docs/07, Fase 2): o executor pergunta ao
    // banco por qual numero o toque sai, e o banco so responde a quem tem a
    // posse do job. O claim e o do motor, so deste job.
    const worker = `teste-fila-remarca-${sufixo}`;
    await admin
      .from("job_queue")
      .update({
        status: "executando",
        locked_by: worker,
        locked_at: new Date().toISOString(),
      })
      .eq("id", jobs![0]!.id as string)
      .throwOnError();
    const resultado = await executarPassoDeRegua(
      admin,
      jobs![0] as unknown as Job,
      worker,
    );
    expect(resultado).toEqual({ ok: true });
    const [run] = await runsDoContato(clinicId, contactId);
    expect(run!.sent_at).toBeNull();
    expect(run!.skipped_reason).toBe("remarcacao_pedida");

    const { count } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("direction", "saida");
    expect(count).toBe(0);
  });
});

describe("dois trilhos no slot anti-ban", () => {
  it("a resposta 1:1 não espera a fila das mensagens automáticas", async () => {
    const clinicId = await montarClinica("trilhos");
    const contatos: string[] = [];
    for (const telefone of ["+5584977300004", "+5584977300005"]) {
      const { data } = await admin
        .from("contact")
        .insert({ clinic_id: clinicId, phone_e164: telefone, name: "Contato" })
        .select("id")
        .single()
        .throwOnError();
      const contactId = data!.id as string;
      await admin
        .from("contact_consent")
        .insert({
          clinic_id: clinicId,
          contact_id: contactId,
          channel: "whatsapp",
          source: "recepcao",
        })
        .throwOnError();
      contatos.push(contactId);
    }
    const conversas: string[] = [];
    for (const contactId of contatos) {
      const { data } = await admin.rpc("garantir_conversa_aberta", {
        p_clinic_id: clinicId,
        p_contact_id: contactId,
      });
      conversas.push(data as string);
    }

    // 1. Envio automatico: reserva o slot de massa por 20 segundos.
    const automatico = await sendWhatsAppText(admin, {
      clinicId,
      conversationId: conversas[0]!,
      contactId: contatos[0]!,
      body: "Mensagem automática",
      authorUserId: null,
      author: "sistema",
      envioAutomatico: true,
      espacamentoMs: 20_000,
      esperaMaximaMs: 3_000,
    });
    expect(automatico.ok).toBe(true);

    // 2. Outro automatico logo em seguida: adiado para o slot de massa.
    const segundo = await sendWhatsAppText(admin, {
      clinicId,
      conversationId: conversas[1]!,
      contactId: contatos[1]!,
      body: "Outra automática",
      authorUserId: null,
      author: "sistema",
      envioAutomatico: true,
      espacamentoMs: 20_000,
      esperaMaximaMs: 3_000,
    });
    expect(segundo.ok).toBe(false);
    if (!segundo.ok) {
      expect(segundo.reason).toBe("slot_adiado");
    }

    // 3. A resposta 1:1 (trilho da recepcao, sem envioAutomatico) sai: espera
    // so o intervalo curto do ultimo envio real, nunca os 20 segundos.
    const inicio = Date.now();
    const humano = await sendWhatsAppText(admin, {
      clinicId,
      conversationId: conversas[1]!,
      contactId: contatos[1]!,
      body: "Resposta da recepção",
      authorUserId: null,
      author: "sistema",
    });
    expect(humano.ok).toBe(true);
    expect(Date.now() - inicio).toBeLessThan(8_000);

    // O slot anti-ban e do NUMERO (varios numeros por clinica, docs/07).
    const { data: conta } = await admin
      .from("whatsapp_account")
      .select("next_send_at, next_bulk_send_at")
      .eq("id", numeroDaClinica.get(clinicId)!)
      .single()
      .throwOnError();
    // O slot de massa continua la na frente; o 1:1 nao o empurrou nem o usou.
    expect(
      new Date(conta!.next_bulk_send_at as string).getTime() - Date.now(),
    ).toBeGreaterThan(8_000);
    expect(
      new Date(conta!.next_send_at as string).getTime() - Date.now(),
    ).toBeLessThan(8_000);
  });
});
