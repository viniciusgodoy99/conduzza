import { afterAll, describe, expect, it } from "vitest";

import { adminClient } from "../rls/stack";

// Registro de conversao no movimento do funil (migration 20260910110000),
// contra o banco REAL. O gatilho em contact e o unico escritor de
// conversion_event nesta fase: mover para etapa com evento configurado gera
// UMA linha 'registrado' (semantica Tintim), reentrar nao duplica, etapa sem
// evento nao gera nada, o valor segue value_source, e SEM envio_ativado
// nenhum job nasce. Cada cenario usa a propria clinica descartavel, que ja
// nasce com a jornada padrao semeada.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `ConvReg ${nome} ${sufixo}`,
      slug: `convreg-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  return clinicId;
}

async function configurarConversao(
  clinicId: string,
  chave: string,
  campos: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("funnel_stage_def")
    .update(campos)
    .eq("clinic_id", clinicId)
    .eq("chave", chave)
    .throwOnError();
}

async function criarContato(
  clinicId: string,
  telefone: string,
  extras: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Contato ConvReg",
      ...extras,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function mover(contactId: string, etapa: string): Promise<void> {
  await admin
    .from("contact")
    .update({ funnel_stage: etapa })
    .eq("id", contactId)
    .throwOnError();
}

async function eventosDe(clinicId: string) {
  const { data } = await admin
    .from("conversion_event")
    .select("stage_chave, event_name, value_cents, ctwa_clid, status")
    .eq("clinic_id", clinicId)
    .order("created_at")
    .throwOnError();
  return data ?? [];
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("registro de conversão no funil, contra o banco real", () => {
  it("mover para etapa com evento gera UMA linha registrada, com snapshot do ctwa", async () => {
    const clinicId = await criarClinica("uma");
    await configurarConversao(clinicId, "agendou", {
      meta_event_name: "Schedule",
      value_source: "fixo",
      value_cents: 15000,
    });
    const contato = await criarContato(clinicId, "+5584974300001", {
      ctwa_clid: `ctwa-${sufixo}`,
    });

    await mover(contato, "agendou");
    // Sai e volta: a semantica Tintim nao redispara.
    await mover(contato, "novo");
    await mover(contato, "agendou");

    const eventos = await eventosDe(clinicId);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toEqual({
      stage_chave: "agendou",
      event_name: "Schedule",
      value_cents: 15000,
      ctwa_clid: `ctwa-${sufixo}`,
      status: "registrado",
    });
  });

  it("etapa sem evento (ou com conversão pausada) não gera nada", async () => {
    const clinicId = await criarClinica("nada");
    await configurarConversao(clinicId, "compareceu", {
      meta_event_name: "Purchase",
      conversao_ativa: false,
    });
    const contato = await criarContato(clinicId, "+5584974300002");

    await mover(contato, "em_contato"); // etapa sem evento
    await mover(contato, "compareceu"); // evento pausado

    expect(await eventosDe(clinicId)).toHaveLength(0);
  });

  it("valor por service_link lê o preço do agendamento mais recente; sem preço fica nulo", async () => {
    const clinicId = await criarClinica("preco");
    await configurarConversao(clinicId, "compareceu", {
      meta_event_name: "Purchase",
      value_source: "service_link",
    });

    const { data: prof } = await admin
      .from("professional")
      .insert({ clinic_id: clinicId, name: "Dra. ConvReg" })
      .select("id")
      .single()
      .throwOnError();
    const { data: proc } = await admin
      .from("procedure")
      .insert({
        clinic_id: clinicId,
        name: "Sessao ConvReg",
        default_duration_min: 30,
      })
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
        price_cents: 32000,
        covered_by_insurance: false,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();

    const contato = await criarContato(clinicId, "+5584974300003");
    await admin
      .from("appointment")
      .insert({
        clinic_id: clinicId,
        contact_id: contato,
        professional_id: prof!.id,
        service_link_id: vinculo!.id,
        starts_at: "2026-11-12T10:00:00-03:00",
        ends_at: "2026-11-12T10:30:00-03:00",
      })
      .throwOnError();

    // O gatilho da agenda ja move para 'agendou'; empurra para 'compareceu',
    // a etapa mapeada, e o valor deve vir do vinculo do agendamento.
    await mover(contato, "compareceu");
    const eventos = await eventosDe(clinicId);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.value_cents).toBe(32000);

    // Contato sem agendamento nenhum: valor fica nulo, nao inventado.
    const semAgenda = await criarContato(clinicId, "+5584974300004");
    await mover(semAgenda, "compareceu");
    const todos = await eventosDe(clinicId);
    expect(todos).toHaveLength(2);
    expect(todos[1]!.value_cents).toBeNull();
  });

  it("sem envio_ativado nenhum job nasce, o evento fica só registrado", async () => {
    const clinicId = await criarClinica("semjob");
    await configurarConversao(clinicId, "agendou", {
      meta_event_name: "Schedule",
    });
    const contato = await criarContato(clinicId, "+5584974300005");
    await mover(contato, "agendou");

    expect((await eventosDe(clinicId))[0]!.status).toBe("registrado");
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(jobs).toHaveLength(0);
  });

  it("o embargo da D6 impede montar envio ligado, então o enfileiramento dorme", async () => {
    // O caminho "envio_ativado => evento nasce enfileirado + job" foi provado
    // verde em 09/09/2026 ANTES do embargo entrar (o gatilho v2 nao mudou).
    // Com o embargo, ligar o envio e IMPOSSIVEL ate a migration de liberacao
    // da decisao D6, e e exatamente isso que este teste prova; a prova do
    // enfileiramento volta junto com a liberacao.
    const clinicId = await criarClinica("comjob");
    await admin
      .from("meta_ads_account_secret")
      .insert({ clinic_id: clinicId, capi_access_token: "tok-integ" })
      .throwOnError();
    const { error } = await admin.from("meta_ads_account").insert({
      clinic_id: clinicId,
      pixel_id: "123123123123123",
      modo_user_data: "ctwa_apenas",
      envio_ativado: true,
    });
    expect(error?.message).toContain("decisão de privacidade pendente");

    await configurarConversao(clinicId, "agendou", {
      meta_event_name: "Schedule",
    });
    const contato = await criarContato(clinicId, "+5584974300006");
    await mover(contato, "agendou");

    const eventos = await eventosDe(clinicId);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.status).toBe("registrado");
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(jobs).toHaveLength(0);
  });
});
