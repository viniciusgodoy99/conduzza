import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Fila por RAIA (contrato da Fase 3, migration 20260925140000; desenho em
// docs/07_multiplos_numeros_whatsapp.md, "Fila por raia"), contra o banco
// REAL. A raia de um job e o numero dele, ou a clinica quando o job nao tem
// numero. claim_jobs_por_clinica traz UM job por raia e trava a linha da
// raia: dois numeros da mesma clinica saem na MESMA chamada, dois jobs do
// mesmo numero nao.
//
// ESTE BANCO E O DE PRODUCAO. Reivindicar com clinicas reais no recorte tira
// da fila jobs de verdade (achado de 24/09, tests/integration/reguas-e-
// fila.test.ts). Por isso, aqui:
//   - todo job do teste nasce com run_at de um ano atras (prioridade 0): ele
//     ordena antes de qualquer job real, e p_max_clinicas e EXATAMENTE o
//     numero de raias que o teste espera, entao o LIMIT para antes de chegar
//     num job de verdade;
//   - se ainda assim vier job de fora (outra clinica), ele e devolvido na
//     hora com reagendar_job (mesmo run_at, sem queimar tentativa), e o
//     teste falha dizendo isso;
//   - todo job do teste termina cancelado, e nenhum e executado.
// Clinicas e_de_teste: o motor de producao nao as enxerga.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];
const KINDS_DE_ENVIO = ["enviar_mensagem_ativa", "executar_passo_de_regua"];
const DIA = 24 * 60 * 60 * 1000;

/** run_at bem no passado, com o desempate dentro do teste em segundos. */
function haUmAno(segundos = 0): string {
  return new Date(Date.now() - 365 * DIA + segundos * 1000).toISOString();
}

type JobReivindicado = {
  id: string;
  clinic_id: string;
  whatsapp_account_id: string | null;
  run_at: string;
  status: string;
  locked_by: string | null;
};

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Raia ${nome} ${sufixo}`,
      slug: `raia-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  return clinicId;
}

/** Clinica com dois numeros: o principal (A) e um comum (B). */
async function clinicaComDoisNumeros(
  nome: string,
): Promise<{ clinicId: string; a: string; b: string }> {
  const clinicId = await criarClinica(nome);
  const a = await criarNumeroDeTeste(admin, clinicId);
  const b = await criarNumeroDeTeste(admin, clinicId, { nome: "Segundo" });
  expect(a.principal).toBe(true);
  expect(b.principal).toBe(false);
  return { clinicId, a: a.id, b: b.id };
}

async function criarContato(clinicId: string, final: string): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `+55849785${final.padStart(5, "0")}`,
      name: "Paciente Raia",
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function enfileirar(
  clinicId: string,
  campos: {
    kind?: string;
    contactId?: string;
    numero?: string;
    runAt: string;
  },
): Promise<{ id: string; whatsapp_account_id: string | null }> {
  const { data } = await admin
    .from("job_queue")
    .insert({
      clinic_id: clinicId,
      kind: campos.kind ?? "enviar_mensagem_ativa",
      payload: campos.contactId
        ? { contact_id: campos.contactId, body: "Teste da fila por raia" }
        : {},
      run_at: campos.runAt,
      ...(campos.numero ? { whatsapp_account_id: campos.numero } : {}),
    })
    .select("id, whatsapp_account_id")
    .single()
    .throwOnError();
  return data as { id: string; whatsapp_account_id: string | null };
}

/**
 * Uma chamada do claim do motor. Devolve so os jobs das clinicas deste
 * teste; o que vier de fora volta para a fila na hora (e fica contado).
 */
async function reivindicar(
  worker: string,
  maxRaias: number,
  kinds: string[] = KINDS_DE_ENVIO,
): Promise<{ meus: JobReivindicado[]; deFora: number }> {
  const { data, error } = await admin.rpc("claim_jobs_por_clinica", {
    p_worker: worker,
    p_max_clinicas: maxRaias,
    p_kinds: kinds,
    p_incluir_teste: true,
  });
  expect(error).toBeNull();
  const todos = (data ?? []) as JobReivindicado[];
  const meus = todos.filter((job) => clinicasCriadas.includes(job.clinic_id));
  const deFora = todos.filter(
    (job) => !clinicasCriadas.includes(job.clinic_id),
  );
  for (const job of deFora) {
    await admin.rpc("reagendar_job", {
      p_id: job.id,
      p_worker: worker,
      p_run_at: job.run_at,
      p_motivo: "teste_da_fila_devolveu",
    });
  }
  return { meus, deFora: deFora.length };
}

async function statusDe(ids: string[]): Promise<Map<string, string>> {
  const { data } = await admin
    .from("job_queue")
    .select("id, status")
    .in("id", ids)
    .throwOnError();
  return new Map(
    (data ?? []).map((linha) => [linha.id as string, linha.status as string]),
  );
}

/** Nenhum job deste teste e executado: termina cancelado. */
async function encerrar(ids: string[]): Promise<void> {
  await admin
    .from("job_queue")
    .update({ status: "cancelado", locked_by: null, locked_at: null })
    .in("id", ids)
    .throwOnError();
}

beforeAll(async () => {
  // Sobra de uma execucao anterior que caiu no meio: os jobs dela teriam
  // run_at ainda mais antigo que os desta e passariam na frente.
  await admin
    .from("clinic")
    .delete()
    .like("slug", "raia-%")
    .eq("e_de_teste", true)
    .throwOnError();
});

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("claim por raia", () => {
  it("dois números da mesma clínica saem na mesma chamada; o segundo job do mesmo número espera", async () => {
    const { clinicId, a, b } = await clinicaComDoisNumeros("dois");
    const contato = await criarContato(clinicId, "1");
    // Os dois do A sao os mais antigos: um claim por clinica (ou por run_at)
    // traria A1 e A2. Por raia, vem A1 e B1.
    const a1 = await enfileirar(clinicId, {
      contactId: contato,
      numero: a,
      runAt: haUmAno(0),
    });
    const a2 = await enfileirar(clinicId, {
      contactId: contato,
      numero: a,
      runAt: haUmAno(1),
    });
    const b1 = await enfileirar(clinicId, {
      contactId: contato,
      numero: b,
      runAt: haUmAno(2),
    });

    const worker = `teste-raia-dois-${sufixo}`;
    const { meus, deFora } = await reivindicar(worker, 2);
    expect(deFora).toBe(0);
    expect(new Set(meus.map((job) => job.id))).toEqual(new Set([a1.id, b1.id]));
    for (const job of meus) {
      expect(job.status).toBe("executando");
      expect(job.locked_by).toBe(worker);
    }
    expect((await statusDe([a2.id])).get(a2.id)).toBe("pendente");

    // Na chamada seguinte, o A2 sai (o anti-ban e do slot do numero).
    const seguinte = await reivindicar(worker, 1);
    expect(seguinte.deFora).toBe(0);
    expect(seguinte.meus.map((job) => job.id)).toEqual([a2.id]);

    await encerrar([a1.id, a2.id, b1.id]);
  });

  it("job sem número corre na raia da clínica, na mesma chamada que o do número", async () => {
    const { clinicId, a } = await clinicaComDoisNumeros("sem-numero");
    const contato = await criarContato(clinicId, "2");
    // Oferta da lista de espera: kind que nao ganha numero no gatilho.
    const oferta = await enfileirar(clinicId, {
      kind: "oferecer_lista_espera",
      runAt: haUmAno(0),
    });
    expect(oferta.whatsapp_account_id).toBeNull();
    const envio = await enfileirar(clinicId, {
      contactId: contato,
      numero: a,
      runAt: haUmAno(1),
    });

    // Clinica sem numero nenhum: o envio fica sem numero e tambem vai pela
    // raia da clinica (numero_do_job diz 'sem_numero' na execucao).
    const semNumero = await criarClinica("sem-numero-z");
    const contatoZ = await criarContato(semNumero, "3");
    const envioZ = await enfileirar(semNumero, {
      contactId: contatoZ,
      runAt: haUmAno(2),
    });
    expect(envioZ.whatsapp_account_id).toBeNull();

    const worker = `teste-raia-clinica-${sufixo}`;
    const { meus, deFora } = await reivindicar(worker, 3, [
      ...KINDS_DE_ENVIO,
      "oferecer_lista_espera",
    ]);
    expect(deFora).toBe(0);
    expect(new Set(meus.map((job) => job.id))).toEqual(
      new Set([oferta.id, envio.id, envioZ.id]),
    );

    await encerrar([oferta.id, envio.id, envioZ.id]);
  });

  it("duas chamadas ao mesmo tempo nunca pegam o mesmo job nem duas vezes a mesma raia", async () => {
    const { clinicId, a, b } = await clinicaComDoisNumeros("corrida");
    const contato = await criarContato(clinicId, "4");
    const ids: string[] = [];
    for (const [indice, numero] of [a, a, b, b].entries()) {
      const job = await enfileirar(clinicId, {
        contactId: contato,
        numero,
        runAt: haUmAno(indice),
      });
      ids.push(job.id);
    }

    const [primeira, segunda] = await Promise.all([
      reivindicar(`teste-raia-corrida-1-${sufixo}`, 2),
      reivindicar(`teste-raia-corrida-2-${sufixo}`, 2),
    ]);
    const todos = [...primeira.meus, ...segunda.meus];
    // Nenhum job duas vezes.
    expect(new Set(todos.map((job) => job.id)).size).toBe(todos.length);
    // Em cada chamada, no maximo um job por numero.
    for (const chamada of [primeira.meus, segunda.meus]) {
      const raias = chamada.map((job) => job.whatsapp_account_id);
      expect(new Set(raias).size).toBe(raias.length);
    }
    // A primeira a travar os numeros leva um job de cada; a outra leva os
    // seguintes ou pula as raias travadas. Nunca menos que dois no total.
    expect(todos.length).toBeGreaterThanOrEqual(2);

    await encerrar(ids);
  });

  it("travado sem tentativa é enterrado; com tentativa, volta pela raia", async () => {
    const { clinicId, a, b } = await clinicaComDoisNumeros("lease");
    const contato = await criarContato(clinicId, "5");
    const vencido = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: travados } = await admin
      .from("job_queue")
      .insert([
        {
          clinic_id: clinicId,
          kind: "enviar_mensagem_ativa",
          payload: { contact_id: contato, body: "volta" },
          whatsapp_account_id: a,
          run_at: haUmAno(0),
          status: "executando",
          locked_by: "worker-morto",
          locked_at: vencido,
          attempts: 1,
          max_attempts: 8,
        },
        {
          clinic_id: clinicId,
          kind: "enviar_mensagem_ativa",
          payload: { contact_id: contato, body: "enterra" },
          whatsapp_account_id: b,
          run_at: haUmAno(1),
          status: "executando",
          locked_by: "worker-morto",
          locked_at: vencido,
          attempts: 8,
          max_attempts: 8,
        },
      ])
      .select("id, attempts")
      .throwOnError();
    const volta = travados!.find((job) => job.attempts === 1)!.id as string;
    const enterra = travados!.find((job) => job.attempts === 8)!.id as string;

    const worker = `teste-raia-lease-${sufixo}`;
    const { meus, deFora } = await reivindicar(worker, 1);
    expect(deFora).toBe(0);
    expect(meus.map((job) => job.id)).toEqual([volta]);

    const { data: depois } = await admin
      .from("job_queue")
      .select("id, status, last_error, attempts, locked_by")
      .in("id", [volta, enterra])
      .throwOnError();
    const linha = (id: string) => (depois ?? []).find((job) => job.id === id);
    expect(linha(volta)).toMatchObject({
      status: "executando",
      attempts: 2,
      locked_by: worker,
    });
    expect(linha(enterra)).toMatchObject({
      status: "falhou",
      last_error: "lease_expirado",
    });

    await encerrar([volta]);
  });
});
