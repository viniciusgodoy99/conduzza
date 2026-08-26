import { afterAll, describe, expect, it } from "vitest";

import { minutosLocais, minutosParaHora } from "@/lib/domain/horarios";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import { processarLote } from "@/lib/jobs/worker";
import { adminClient } from "../rls/stack";

// "Cobrar agora" da Tela 2 (tarefa 4.7): o toque pedido POR UMA PESSOA usa a
// mesma máquina da régua automática, com a marca 'manual' no payload do job.
//
// O que este teste prova é justamente o que a marca muda: a régua DESLIGADA e
// a janela de envio FECHADA não seguram a recepção, que está trabalhando e
// pediu o toque. O que ela não muda (consentimento e condição de parada)
// também é conferido aqui.
//
// Toda clínica daqui nasce com whatsapp_account provider 'fake': o canal desta
// máquina é real (uazapi) e nenhum teste pode encostar nele.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

type Cenario = {
  clinicId: string;
  contactId: string;
  appointmentId: string;
  stepId: string;
  telefone: string;
};

/** Janela estreita que NÃO contém o instante de agora, no fuso da clínica. */
function janelaFechadaAgora(timezone: string) {
  const agora = minutosLocais(timezone, new Date());
  let inicio = agora + 120;
  let fim = inicio + 60;
  if (fim > 23 * 60 + 59) {
    fim = agora - 60;
    inicio = fim - 60;
  }
  return {
    send_window_start: minutosParaHora(inicio),
    send_window_end: minutosParaHora(fim),
    send_weekdays: [0, 1, 2, 3, 4, 5, 6],
  };
}

async function montarCenario(
  nome: string,
  telefone: string,
  opcoes: { consentimento?: "ativo" | "nenhum" } = {},
): Promise<Cenario> {
  const { consentimento = "ativo" } = opcoes;
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Cobrança ${nome} ${sufixo}`,
      slug: `cobranca-${nome}-${sufixo}`,
    })
    .select("id, timezone")
    .single()
    .throwOnError();
  const clinicId = clinica!.id as string;
  clinicasCriadas.push(clinicId);

  await admin
    .from("whatsapp_account")
    .insert({
      clinic_id: clinicId,
      provider: "fake",
      connection_status: "conectado",
    })
    .throwOnError();

  // A régua fica DESLIGADA de propósito, com a janela fechada agora: é o
  // estado real de uma clínica que ainda não automatizou nada.
  await admin
    .from("cadence")
    .update(janelaFechadaAgora(clinica!.timezone as string))
    .eq("clinic_id", clinicId)
    .eq("kind", "confirmacao")
    .throwOnError();

  const { data: profissional } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dr. Cobrança" })
    .select("id")
    .single()
    .throwOnError();
  const { data: procedimento } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicId, name: "Retorno", default_duration_min: 30 })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: profissional!.id,
      procedure_id: procedimento!.id,
      insurance_id: null,
      price_cents: 10000,
      covered_by_insurance: false,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();

  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Paciente Cobrança",
    })
    .select("id")
    .single()
    .throwOnError();
  const contactId = contato!.id as string;
  if (consentimento === "ativo") {
    await admin
      .from("contact_consent")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        channel: "whatsapp",
        source: "recepcao",
      })
      .throwOnError();
  }

  // Consulta amanhã: o passo escolhido pela ação seria o de 24 horas antes.
  const inicio = new Date(Date.now() + 20 * HORA);
  const { data: consulta } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      professional_id: profissional!.id,
      service_link_id: vinculo!.id,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();

  const { data: passo } = await admin
    .from("cadence_step")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("offset_minutes", -1440)
    .single()
    .throwOnError();

  return {
    clinicId,
    contactId,
    appointmentId: consulta!.id as string,
    stepId: passo!.id as string,
    telefone,
  };
}

/** Repete o que cobrarAgoraAction faz depois dos guards: run + job manual. */
async function cobrarAgora(cenario: Cenario): Promise<number> {
  const minutoAtual = new Date(
    Math.floor(Date.now() / 60_000) * 60_000,
  ).toISOString();
  const { data: criadas } = await admin
    .from("cadence_run")
    .upsert(
      [
        {
          clinic_id: cenario.clinicId,
          cadence_step_id: cenario.stepId,
          contact_id: cenario.contactId,
          appointment_id: cenario.appointmentId,
          scheduled_for: minutoAtual,
        },
      ],
      {
        onConflict: "cadence_step_id,contact_id,scheduled_for",
        ignoreDuplicates: true,
      },
    )
    .select("id")
    .throwOnError();
  const novas = (criadas ?? []) as { id: string }[];
  if (novas.length > 0) {
    await admin
      .from("job_queue")
      .insert(
        novas.map((run) => ({
          clinic_id: cenario.clinicId,
          kind: "executar_passo_de_regua",
          payload: { cadence_run_id: run.id, manual: true },
        })),
      )
      .throwOnError();
  }
  return novas.length;
}

async function processar(clinicId: string, worker: string): Promise<void> {
  // Um minuto atrás, não "agora": claim_jobs compara run_at com o now() do
  // banco, e o relógio desta máquina não precisa estar alinhado com ele.
  await admin
    .from("job_queue")
    .update({ run_at: new Date(Date.now() - MINUTO).toISOString() })
    .eq("clinic_id", clinicId)
    .eq("status", "pendente");
  await processarLote(admin, worker, { limite: 10 });
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("toque manual da Tela 2", () => {
  it("com a régua desligada e fora da janela, a cobrança sai mesmo assim", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("manual", "+5584963000001");

    expect(await cobrarAgora(cenario)).toBe(1);
    await processar(cenario.clinicId, "worker-cobranca");

    const enviadas = fakeSentMessages().filter(
      (m) => m.to === cenario.telefone,
    );
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]?.body).toContain("Paciente Cobrança");
    expect(enviadas[0]?.body).not.toContain("{{");
    expect(enviadas[0]?.menuOptions ?? []).toHaveLength(2);

    // A consulta entra em aguardando_confirmação, como no toque automático.
    const { data: consulta } = await admin
      .from("appointment")
      .select("status")
      .eq("id", cenario.appointmentId)
      .single();
    expect(consulta?.status).toBe("aguardando_confirmacao");

    const { data: runs } = await admin
      .from("cadence_run")
      .select("sent_at, skipped_reason, message_id")
      .eq("clinic_id", cenario.clinicId);
    expect(runs).toHaveLength(1);
    expect(runs?.[0]?.sent_at).not.toBeNull();
    expect(runs?.[0]?.message_id).not.toBeNull();
  });

  it("dois cliques no mesmo minuto viram UMA cobrança", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("duplo", "+5584963000002");

    expect(await cobrarAgora(cenario)).toBe(1);
    expect(await cobrarAgora(cenario)).toBe(0);

    const { data: runs } = await admin
      .from("cadence_run")
      .select("id")
      .eq("clinic_id", cenario.clinicId);
    expect(runs).toHaveLength(1);
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id")
      .eq("clinic_id", cenario.clinicId)
      .eq("kind", "executar_passo_de_regua");
    expect(jobs).toHaveLength(1);

    await admin
      .from("job_queue")
      .update({ status: "cancelado" })
      .eq("clinic_id", cenario.clinicId);
  });

  it("sem autorização o toque manual também não sai", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("semauth", "+5584963000003", {
      consentimento: "nenhum",
    });

    await cobrarAgora(cenario);
    await processar(cenario.clinicId, "worker-cobranca-semauth");

    expect(
      fakeSentMessages().filter((m) => m.to === cenario.telefone),
    ).toHaveLength(0);
    const { data: runs } = await admin
      .from("cadence_run")
      .select("skipped_reason")
      .eq("clinic_id", cenario.clinicId);
    expect(runs?.[0]?.skipped_reason).toBe("sem_consentimento");
  });

  it("consulta já cancelada: a condição de parada continua valendo", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("parada", "+5584963000004");
    await admin
      .from("appointment")
      .update({ status: "cancelado_paciente" })
      .eq("id", cenario.appointmentId)
      .throwOnError();

    await cobrarAgora(cenario);
    await processar(cenario.clinicId, "worker-cobranca-parada");

    expect(
      fakeSentMessages().filter((m) => m.to === cenario.telefone),
    ).toHaveLength(0);
    const { data: runs } = await admin
      .from("cadence_run")
      .select("skipped_reason")
      .eq("clinic_id", cenario.clinicId);
    expect(runs?.[0]?.skipped_reason).toBe("condicao_parada");
  });
});
