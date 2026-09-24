import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { executarJobComPosse } from "@/lib/jobs/worker";
import { adminClient } from "../rls/stack";

// Aviso de remarcacao contra o banco REAL (revisao adversarial da leva 1,
// achados R3, R5, R10 e R18). O texto do aviso sai da fila com data e hora
// congeladas; o worker reconfere a consulta na hora do envio e mata, SEM
// ENVIAR, o aviso que ficou velho: consulta cancelada, remarcada de novo,
// com outro profissional ou com o horario vencido.
//
// Clinica e_de_teste (o motor de producao a ignora) e jobs com run_at no
// futuro: so o claim manual deste teste os executa. O contato NAO tem
// autorizacao para receber mensagens: o controle positivo (aviso que ainda
// vale) passa pela guarda e para no consentimento, sem tocar no canal.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;

let clinicId = "";
let profA = "";
let profB = "";
let vinculoA = "";
let contato = "";
let contador = 0;

async function novaConsulta(
  inicio: Date,
  status = "agendado",
): Promise<string> {
  const { data } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicId,
      contact_id: contato,
      professional_id: profA,
      service_link_id: vinculoA,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
      status,
      oferecer_vaga_ao_cancelar: false,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

/** Enfileira o aviso como a Server Action faz e roda pelo caminho do motor. */
async function rodarAviso(payload: Record<string, unknown>) {
  const { data: job } = await admin
    .from("job_queue")
    .insert({
      clinic_id: clinicId,
      kind: "enviar_mensagem_ativa",
      payload: { contact_id: contato, body: "Aviso de teste", ...payload },
      run_at: new Date(Date.now() + DIA).toISOString(),
    })
    .select("id, max_attempts")
    .single()
    .throwOnError();
  contador += 1;
  const workerId = `aviso-remarcacao-${sufixo}-${contador}`;
  await admin
    .from("job_queue")
    .update({
      status: "executando",
      locked_by: workerId,
      locked_at: new Date().toISOString(),
      attempts: 1,
    })
    .eq("id", job!.id as string)
    .eq("status", "pendente")
    .throwOnError();
  const desfecho = await executarJobComPosse(admin, workerId, {
    id: job!.id as string,
    clinic_id: clinicId,
    kind: "enviar_mensagem_ativa",
    payload: { contact_id: contato, body: "Aviso de teste", ...payload },
    attempts: 1,
    max_attempts: job!.max_attempts as number,
  });
  const { data: depois } = await admin
    .from("job_queue")
    .select("status, last_error")
    .eq("id", job!.id as string)
    .single()
    .throwOnError();
  const { data: mensagens } = await admin
    .from("message")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("job_id", job!.id as string)
    .throwOnError();
  return {
    desfecho,
    status: depois!.status as string,
    lastError: depois!.last_error as string | null,
    mensagens: mensagens ?? [],
  };
}

beforeAll(async () => {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Aviso Remarcacao ${sufixo}`,
      slug: `aviso-rem-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  clinicId = clinica!.id as string;
  await admin
    .from("whatsapp_account")
    .insert({
      clinic_id: clinicId,
      provider: "fake",
      connection_status: "conectado",
    })
    .throwOnError();
  const { data: profs } = await admin
    .from("professional")
    .insert([
      { clinic_id: clinicId, name: "Dra. Aviso A" },
      { clinic_id: clinicId, name: "Dr. Aviso B" },
    ])
    .select("id, name")
    .throwOnError();
  profA = profs!.find((p) => (p.name as string).endsWith("A"))!.id as string;
  profB = profs!.find((p) => (p.name as string).endsWith("B"))!.id as string;
  const { data: proc } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicId, name: "Consulta Aviso" })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: profA,
      procedure_id: proc!.id,
      insurance_id: null,
      price_cents: 10000,
      covered_by_insurance: false,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  vinculoA = vinculo!.id as string;
  const { data: ct } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `+55849783${String(Date.now() % 100000).padStart(5, "0")}`,
      name: "Paciente Aviso",
    })
    .select("id")
    .single()
    .throwOnError();
  contato = ct!.id as string;
});

afterAll(async () => {
  if (clinicId) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("aviso de remarcação reconfere a consulta na hora do envio", () => {
  it("consulta cancelada depois do aviso: morre sem enviar", async () => {
    const inicio = new Date(Date.now() + 5 * DIA);
    const consulta = await novaConsulta(inicio, "cancelado_clinica");
    const r = await rodarAviso({
      appointment_id: consulta,
      starts_at: inicio.toISOString(),
      professional_id: profA,
    });
    expect(r.desfecho).toBe("falhou");
    expect(r.status).toBe("falhou");
    expect(r.lastError).toBe("aviso_desatualizado");
    expect(r.mensagens).toHaveLength(0);
  });

  it("consulta remarcada de novo para outro horário: o aviso antigo morre", async () => {
    const anunciado = new Date(Date.now() + 6 * DIA);
    const atual = new Date(anunciado.getTime() + 60 * MINUTO);
    const consulta = await novaConsulta(atual);
    const r = await rodarAviso({
      appointment_id: consulta,
      starts_at: anunciado.toISOString(),
      professional_id: profA,
    });
    expect(r.lastError).toBe("aviso_desatualizado");
    expect(r.status).toBe("falhou");
    expect(r.mensagens).toHaveLength(0);
  });

  it("consulta trocada de profissional: o aviso antigo morre", async () => {
    const inicio = new Date(Date.now() + 7 * DIA);
    const consulta = await novaConsulta(inicio);
    const r = await rodarAviso({
      appointment_id: consulta,
      starts_at: inicio.toISOString(),
      professional_id: profB,
    });
    expect(r.lastError).toBe("aviso_desatualizado");
    expect(r.mensagens).toHaveLength(0);
  });

  it("horário anunciado já passou (retry longo): morre sem enviar", async () => {
    const passado = new Date(Date.now() - 2 * 60 * MINUTO);
    const consulta = await novaConsulta(passado);
    const r = await rodarAviso({
      appointment_id: consulta,
      starts_at: passado.toISOString(),
      professional_id: profA,
    });
    expect(r.lastError).toBe("aviso_desatualizado");
    expect(r.mensagens).toHaveLength(0);
  });

  it("aviso que ainda vale passa pela guarda (e para na autorização, que este contato não tem)", async () => {
    const inicio = new Date(Date.now() + 8 * DIA);
    const consulta = await novaConsulta(inicio);
    const r = await rodarAviso({
      appointment_id: consulta,
      starts_at: inicio.toISOString(),
      professional_id: profA,
    });
    expect(r.lastError).toBe("sem_consentimento");
    expect(r.mensagens).toHaveLength(0);
  });
});
