import { afterAll, describe, expect, it } from "vitest";

import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import { planejarCobrancaManual } from "@/lib/jobs/cobranca-manual";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";
import {
  criarNumeroDeTeste,
  type NumeroDeTeste,
  type OpcoesDoNumeroDeTeste,
} from "../rls/numeros";
import { adminClient } from "../rls/stack";

// ESPERA DO CANAL: com o WhatsApp da clinica fora do ar (numero desconectado
// ou clinica sem numero), o envio automatico espera a reconexao e sai quando
// a clinica reconecta (regra do dono, docs/07). Defeito corrigido: cada
// espera somava no teto de 20 devolucoes de reagendar_job e a confirmacao
// morria em cerca de 95 minutos como 'falhou' (a run fechava 'falha_envio'
// por fechar_runs_orfas); no envio ativo, 'desconectado' queimava tentativa
// e o envio morria em cerca de meia hora.
//
// Depende da migration 20260925141000_espera_do_canal.sql (aplicada depois
// da de contrato, 20260925140000).
//
// Clinicas e_de_teste (o motor de producao as ignora) e jobs com run_at no
// futuro: so o claim manual deste teste os executa. Provedor 'fake' sempre.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const AMANHA = () => new Date(Date.now() + 24 * HORA).toISOString();

let sequencia = 0;
function telefone(): string {
  sequencia += 1;
  return `+55849785${String(sequencia).padStart(5, "0")}`;
}

type Clinica = { clinicId: string; numero: NumeroDeTeste };

async function clinicaComNumero(
  nome: string,
  opcoes: OpcoesDoNumeroDeTeste = {},
): Promise<Clinica> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Espera do canal ${nome} ${sufixo}`,
      slug: `espera-canal-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  const numero = await criarNumeroDeTeste(admin, clinicId, opcoes);
  return { clinicId, numero };
}

async function contatoComConsentimento(clinicId: string): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: telefone(), name: "Paciente" })
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
  return contactId;
}

async function consultaAmanha(
  clinicId: string,
  contactId: string,
): Promise<string> {
  const { data: profissional } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dra. Espera" })
    .select("id")
    .single()
    .throwOnError();
  const { data: procedimento } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicId, name: "Consulta", default_duration_min: 30 })
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
  return consulta!.id as string;
}

/** O claim que o motor faria, so para este job (a linha que ele devolve). */
async function reivindicar(jobId: string, workerId: string): Promise<Job> {
  const { data: atual } = await admin
    .from("job_queue")
    .select("attempts")
    .eq("id", jobId)
    .single()
    .throwOnError();
  const { data } = await admin
    .from("job_queue")
    .update({
      status: "executando",
      locked_by: workerId,
      locked_at: new Date().toISOString(),
      attempts: (atual!.attempts as number) + 1,
    })
    .eq("id", jobId)
    .eq("status", "pendente")
    .select(
      "id, clinic_id, kind, payload, attempts, max_attempts, whatsapp_account_id, created_at",
    )
    .single()
    .throwOnError();
  return data as unknown as Job;
}

type LinhaDoJob = {
  status: string;
  attempts: number;
  devolucoes: number;
  ultimo_motivo_devolucao: string | null;
  last_error: string | null;
  run_at: string;
  payload: Record<string, unknown>;
};

async function linhaDoJob(jobId: string): Promise<LinhaDoJob> {
  const { data } = await admin
    .from("job_queue")
    .select(
      "status, attempts, devolucoes, ultimo_motivo_devolucao, last_error, run_at, payload",
    )
    .eq("id", jobId)
    .single()
    .throwOnError();
  return data as unknown as LinhaDoJob;
}

async function mudarConexao(
  accountId: string,
  status: "conectado" | "desconectado",
) {
  await admin
    .from("whatsapp_account")
    .update({ connection_status: status })
    .eq("id", accountId)
    .throwOnError();
}

async function envioAtivo(
  clinicId: string,
  contactId: string,
  campos: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await admin
    .from("job_queue")
    .insert({
      clinic_id: clinicId,
      kind: "enviar_mensagem_ativa",
      payload: { contact_id: contactId, body: "Mensagem automática (teste)" },
      run_at: AMANHA(),
      ...campos,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

/** Devolve o job pela funcao do banco, como o executor faz. */
async function devolver(jobId: string, workerId: string, motivo: string) {
  await reivindicar(jobId, workerId);
  const { data } = await admin
    .rpc("reagendar_job", {
      p_id: jobId,
      p_worker: workerId,
      p_run_at: AMANHA(),
      p_motivo: motivo,
    })
    .throwOnError();
  expect(data).toBe(true);
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("toque de confirmação com o número desconectado", () => {
  it("reivindicado 25 vezes seguidas continua pendente e não queima tentativa; ao reconectar, sai", async () => {
    const { clinicId, numero } = await clinicaComNumero("confirmacao");
    const contactId = await contatoComConsentimento(clinicId);
    const appointmentId = await consultaAmanha(clinicId, contactId);

    // Cobrar agora com o numero de pe (com ele fora do ar a tela recusa),
    // e o celular cai logo depois.
    const cobranca = await planejarCobrancaManual(admin, admin, {
      clinicId,
      timezone: "America/Fortaleza",
      appointmentIds: [appointmentId],
    });
    expect(cobranca).toMatchObject({ ok: true, enfileirados: 1 });
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id, payload")
      .eq("clinic_id", clinicId)
      .eq("kind", "executar_passo_de_regua")
      .throwOnError();
    expect(jobs).toHaveLength(1);
    const jobId = jobs![0]!.id as string;
    const runId = (jobs![0]!.payload as { cadence_run_id: string })
      .cadence_run_id;
    await mudarConexao(numero.id, "desconectado");

    resetFakeProvider();
    const worker = `teste-espera-canal-${sufixo}`;
    const esperasEmMinutos: number[] = [];
    for (let volta = 1; volta <= 25; volta += 1) {
      const job = await reivindicar(jobId, worker);
      const antes = Date.now();
      const desfecho = await executarJobComPosse(admin, worker, job);
      const depois = Date.now();
      expect(desfecho).toBe("reagendado");

      const linha = await linhaDoJob(jobId);
      // Antes da correcao, a 20a devolucao encerrava o job como 'falhou'.
      expect(linha.status).toBe("pendente");
      // O claim somou 1 e a espera devolveu: nenhuma tentativa gasta.
      expect(linha.attempts).toBe(0);
      expect(linha.last_error).toBeNull();
      expect(linha.devolucoes).toBe(volta);
      expect(linha.ultimo_motivo_devolucao).toBe("desconectado");
      expect(linha.payload.esperas_do_canal).toBe(volta);
      const runAt = new Date(linha.run_at).getTime();
      const espera = Math.min(5 * volta, 30) * MINUTO;
      expect(runAt).toBeGreaterThanOrEqual(antes + espera - 1_000);
      expect(runAt).toBeLessThanOrEqual(depois + espera + 1_000);
      esperasEmMinutos.push(Math.round((runAt - antes) / MINUTO));
    }
    expect(esperasEmMinutos.slice(0, 7)).toEqual([5, 10, 15, 20, 25, 30, 30]);

    // A run continua aberta e nada saiu enquanto o numero estava fora.
    const { data: aberta } = await admin
      .from("cadence_run")
      .select("sent_at, skipped_reason")
      .eq("id", runId)
      .single()
      .throwOnError();
    expect(aberta).toEqual({ sent_at: null, skipped_reason: null });
    expect(fakeSentMessages().filter((m) => m.clinicId === clinicId)).toEqual(
      [],
    );

    // A clinica reconecta: o proximo claim envia pelo MESMO numero.
    await mudarConexao(numero.id, "conectado");
    const desfecho = await executarJobComPosse(
      admin,
      worker,
      await reivindicar(jobId, worker),
    );
    expect(desfecho).toBe("concluido");
    expect((await linhaDoJob(jobId)).status).toBe("concluido");
    const { data: enviada } = await admin
      .from("cadence_run")
      .select("sent_at, skipped_reason")
      .eq("id", runId)
      .single()
      .throwOnError();
    expect(enviada!.sent_at).not.toBeNull();
    expect(enviada!.skipped_reason).toBeNull();
    const enviadas = fakeSentMessages().filter((m) => m.clinicId === clinicId);
    expect(enviadas.length).toBeGreaterThan(0);
    for (const mensagem of enviadas) {
      expect(mensagem.accountId).toBe(numero.id);
    }
    const { data: consulta } = await admin
      .from("appointment")
      .select("status")
      .eq("id", appointmentId)
      .single()
      .throwOnError();
    expect(consulta!.status).toBe("aguardando_confirmacao");
    // 25 voltas reais contra o banco (cerca de 1,3 s cada) passam do limite
    // padrao de 30 s.
  }, 120_000);
});

describe("envio ativo com o número desconectado", () => {
  it("espera sem queimar tentativa; passadas 12 horas do nascimento do job, desiste como 'desconectado'", async () => {
    const { clinicId } = await clinicaComNumero("envio", {
      connection_status: "desconectado",
    });
    const contactId = await contatoComConsentimento(clinicId);
    const worker = `teste-espera-canal-envio-${sufixo}`;

    const novo = await envioAtivo(clinicId, contactId);
    resetFakeProvider();
    expect(
      await executarJobComPosse(admin, worker, await reivindicar(novo, worker)),
    ).toBe("reagendado");
    const esperando = await linhaDoJob(novo);
    expect(esperando).toMatchObject({
      status: "pendente",
      attempts: 0,
      devolucoes: 1,
      ultimo_motivo_devolucao: "desconectado",
      last_error: null,
    });
    expect(esperando.payload.esperas_do_canal).toBe(1);

    const antigo = await envioAtivo(clinicId, contactId, {
      created_at: new Date(Date.now() - 13 * HORA).toISOString(),
    });
    expect(
      await executarJobComPosse(
        admin,
        worker,
        await reivindicar(antigo, worker),
      ),
    ).toBe("falhou");
    expect(await linhaDoJob(antigo)).toMatchObject({
      status: "falhou",
      last_error: "desconectado",
    });
    expect(fakeSentMessages().filter((m) => m.clinicId === clinicId)).toEqual(
      [],
    );
  });
});

describe("reagendar_job: o teto de 20 não conta as esperas do canal", () => {
  it("25 esperas do canal e depois 19 devoluções comuns seguem pendentes; a 20ª comum encerra", async () => {
    const { clinicId } = await clinicaComNumero("teto");
    const contactId = await contatoComConsentimento(clinicId);
    const jobId = await envioAtivo(clinicId, contactId);
    const worker = `teste-espera-canal-teto-${sufixo}`;

    for (let volta = 1; volta <= 25; volta += 1) {
      await devolver(
        jobId,
        worker,
        volta % 2 === 0 ? "sem_numero" : "desconectado",
      );
    }
    expect(await linhaDoJob(jobId)).toMatchObject({
      status: "pendente",
      devolucoes: 25,
    });

    // A reconexao costuma vir com a fila da clinica andando de uma vez:
    // canal ocupado logo depois de uma queda longa nao pode matar o job.
    for (let volta = 1; volta <= 19; volta += 1) {
      await devolver(jobId, worker, "canal_ocupado");
      expect((await linhaDoJob(jobId)).status).toBe("pendente");
    }
    await devolver(jobId, worker, "canal_ocupado");
    expect(await linhaDoJob(jobId)).toMatchObject({
      status: "falhou",
      last_error: "canal_ocupado",
      devolucoes: 45,
    });
  });

  it("sem espera do canal, o teto de 20 continua igual", async () => {
    const { clinicId } = await clinicaComNumero("teto-comum");
    const contactId = await contatoComConsentimento(clinicId);
    const jobId = await envioAtivo(clinicId, contactId);
    const worker = `teste-espera-canal-teto-comum-${sufixo}`;
    for (let volta = 1; volta <= 19; volta += 1) {
      await devolver(jobId, worker, "canal_ocupado");
    }
    expect((await linhaDoJob(jobId)).status).toBe("pendente");
    await devolver(jobId, worker, "canal_ocupado");
    const linha = await linhaDoJob(jobId);
    expect(linha).toMatchObject({
      status: "falhou",
      last_error: "canal_ocupado",
      devolucoes: 20,
    });
    expect(linha.payload.esperas_do_canal).toBeUndefined();
  });
});
