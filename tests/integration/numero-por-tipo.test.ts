import { afterAll, describe, expect, it } from "vitest";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Numero das mensagens automaticas POR TIPO (decisao do dono de 29/09/2026,
// migration 20260929130000_numero_por_tipo.sql, docs/07) contra o banco
// REAL. Cada tipo (confirmacao, pos_falta, followup, lista_espera,
// aviso_remarcacao) tem a sua escolha: "ultimo_usado" (sem linha tambem) ou
// "sempre pelo numero X". O eco da resposta ao toque segue D4, sem tipo.
//
// Cenario de todos os casos: numero A (principal) e B; o paciente escreveu
// pelo A; a confirmacao e o aviso de remarcacao sao fixos no B; o follow-up
// esta no ultimo usado; pos falta e lista de espera nao tem linha.
//
// A copia da politica antiga para os cinco tipos (a migration em si) foi
// ensaiada em SQL antes de aplicar; aqui ela ja rodou.
//
// Clinicas e_de_teste (o motor de producao as ignora) e jobs com run_at no
// futuro: nenhum executor pega o que este arquivo enfileira.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];
const AMANHA = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

let sequencia = 0;
function telefone(): string {
  sequencia += 1;
  return `+55849786${String(sequencia).padStart(5, "0")}`;
}

type Cenario = {
  clinicId: string;
  a: string;
  b: string;
  contactId: string;
  runs: { confirmacao: string; posFalta: string; followup: string };
};

async function cenario(nome: string): Promise<Cenario> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Numero por tipo ${nome} ${sufixo}`,
      slug: `numero-tipo-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);

  const a = await criarNumeroDeTeste(admin, clinicId);
  const b = await criarNumeroDeTeste(admin, clinicId, { nome: "B" });
  expect(a.principal).toBe(true);

  // O paciente escreveu pelo A: o ultimo usado dele e o A.
  const { data: entrada } = await admin
    .rpc("ingest_inbound_message", {
      p_clinic_id: clinicId,
      p_phone_e164: telefone(),
      p_name: "Paciente",
      p_wa_message_id: `tipo:${sufixo}:${nome}`,
      p_body: "oi",
      p_whatsapp_account_id: a.id,
    })
    .throwOnError();
  const contactId = (entrada as { contact_id: string }).contact_id;

  await admin
    .from("whatsapp_envio_automatico")
    .insert([
      {
        clinic_id: clinicId,
        tipo: "confirmacao",
        modo: "fixo",
        conta_fixa_id: b.id,
      },
      {
        clinic_id: clinicId,
        tipo: "aviso_remarcacao",
        modo: "fixo",
        conta_fixa_id: b.id,
      },
      { clinic_id: clinicId, tipo: "followup", modo: "ultimo_usado" },
    ])
    .throwOnError();

  // Uma run de cada regua (confirmacao e pos falta vem do seed da clinica).
  const passoDe = async (kind: string): Promise<string> => {
    const { data: regua } = await admin
      .from("cadence")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("kind", kind)
      .limit(1)
      .single()
      .throwOnError();
    const { data: passo } = await admin
      .from("cadence_step")
      .select("id")
      .eq("cadence_id", regua!.id)
      .limit(1)
      .single()
      .throwOnError();
    return passo!.id as string;
  };
  const { data: followup } = await admin
    .from("cadence")
    .insert({
      clinic_id: clinicId,
      kind: "followup",
      name: "Follow-up",
      trigger_stage: "novo",
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: passoFollowup } = await admin
    .from("cadence_step")
    .insert({
      clinic_id: clinicId,
      cadence_id: followup!.id,
      offset_minutes: 60,
      fixed_body: "Oi!",
    })
    .select("id")
    .single()
    .throwOnError();

  const run = async (passoId: string): Promise<string> => {
    const { data: linha } = await admin
      .from("cadence_run")
      .insert({
        clinic_id: clinicId,
        cadence_step_id: passoId,
        contact_id: contactId,
        scheduled_for: AMANHA(),
      })
      .select("id")
      .single()
      .throwOnError();
    return linha!.id as string;
  };
  return {
    clinicId,
    a: a.id,
    b: b.id,
    contactId,
    runs: {
      confirmacao: await run(await passoDe("confirmacao")),
      posFalta: await run(await passoDe("pos_falta")),
      followup: await run(passoFollowup!.id as string),
    },
  };
}

/** Enfileira sem numero: o gatilho job_ganha_numero decide. */
async function enfileirar(
  clinicId: string,
  kind: "executar_passo_de_regua" | "enviar_mensagem_ativa",
  payload: Record<string, unknown>,
  whatsappAccountId: string | null = null,
): Promise<{ id: string; whatsapp_account_id: string | null }> {
  const { data } = await admin
    .from("job_queue")
    .insert({
      clinic_id: clinicId,
      kind,
      payload,
      run_at: AMANHA(),
      whatsapp_account_id: whatsappAccountId,
    })
    .select("id, whatsapp_account_id")
    .single()
    .throwOnError();
  return data as { id: string; whatsapp_account_id: string | null };
}

async function numeroDoJob(jobId: string): Promise<string | null> {
  const { data } = await admin
    .from("job_queue")
    .select("whatsapp_account_id")
    .eq("id", jobId)
    .single()
    .throwOnError();
  return (data!.whatsapp_account_id as string | null) ?? null;
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("escolha do número por tipo", () => {
  it("confirmação fixa no B e follow-up no último usado A: cada um pelo seu", async () => {
    const c = await cenario("cada-um");
    const porTipo = async (tipo: string | null) => {
      const { data, error } = await admin.rpc("conta_de_envio", {
        p_clinic_id: c.clinicId,
        p_contact_id: c.contactId,
        ...(tipo ? { p_tipo: tipo } : {}),
      });
      expect(error).toBeNull();
      return data;
    };
    expect(await porTipo("confirmacao")).toBe(c.b);
    expect(await porTipo("aviso_remarcacao")).toBe(c.b);
    expect(await porTipo("followup")).toBe(c.a);
    // Tipo sem linha cai no ultimo usado.
    expect(await porTipo("pos_falta")).toBe(c.a);
    expect(await porTipo("lista_espera")).toBe(c.a);
    // Sem tipo, nenhuma escolha fixa vale.
    expect(await porTipo(null)).toBe(c.a);

    const { data: lote } = await admin.rpc("contas_de_envio", {
      p_clinic_id: c.clinicId,
      p_contact_ids: [c.contactId],
      p_tipo: "confirmacao",
    });
    expect(lote).toEqual([
      expect.objectContaining({
        contact_id: c.contactId,
        whatsapp_account_id: c.b,
        nome: "B",
      }),
    ]);
  });

  it("tipo desconhecido é recusado nas duas portas", async () => {
    const c = await cenario("desconhecido");
    const uma = await admin.rpc("conta_de_envio", {
      p_clinic_id: c.clinicId,
      p_contact_id: c.contactId,
      p_tipo: "confirmação",
    });
    expect(uma.error?.code).toBe("22023");
    const lote = await admin.rpc("contas_de_envio", {
      p_clinic_id: c.clinicId,
      p_contact_ids: [c.contactId],
      p_tipo: "eco",
    });
    expect(lote.error?.code).toBe("22023");
  });

  it("o job nasce no número do seu tipo (régua pela run, envio ativo pelo marcador)", async () => {
    const c = await cenario("fila");
    const confirmacao = await enfileirar(
      c.clinicId,
      "executar_passo_de_regua",
      { cadence_run_id: c.runs.confirmacao },
    );
    const cobrarAgora = await enfileirar(
      c.clinicId,
      "executar_passo_de_regua",
      { cadence_run_id: c.runs.confirmacao, manual: true },
    );
    const followup = await enfileirar(c.clinicId, "executar_passo_de_regua", {
      cadence_run_id: c.runs.followup,
    });
    const posFalta = await enfileirar(c.clinicId, "executar_passo_de_regua", {
      cadence_run_id: c.runs.posFalta,
    });
    const aviso = await enfileirar(c.clinicId, "enviar_mensagem_ativa", {
      contact_id: c.contactId,
      body: "Sua consulta mudou.",
      tipo_de_envio: "aviso_remarcacao",
    });
    const oferta = await enfileirar(c.clinicId, "enviar_mensagem_ativa", {
      contact_id: c.contactId,
      body: "Abriu uma vaga.",
      tipo_de_envio: "lista_espera",
    });

    expect(confirmacao.whatsapp_account_id).toBe(c.b);
    expect(cobrarAgora.whatsapp_account_id).toBe(c.b);
    expect(aviso.whatsapp_account_id).toBe(c.b);
    expect(followup.whatsapp_account_id).toBe(c.a);
    expect(posFalta.whatsapp_account_id).toBe(c.a);
    expect(oferta.whatsapp_account_id).toBe(c.a);
  });

  it("o tipo de cada job, como o banco deriva", async () => {
    const c = await cenario("derivacao");
    const tipo = async (kind: string, payload: Record<string, unknown>) => {
      const { data, error } = await admin.rpc("tipo_de_envio_do_job", {
        p_kind: kind,
        p_payload: payload,
      });
      expect(error).toBeNull();
      return data;
    };
    expect(
      await tipo("executar_passo_de_regua", {
        cadence_run_id: c.runs.confirmacao,
        manual: true,
      }),
    ).toBe("confirmacao");
    expect(
      await tipo("executar_passo_de_regua", {
        cadence_run_id: c.runs.posFalta,
      }),
    ).toBe("pos_falta");
    expect(
      await tipo("executar_passo_de_regua", {
        cadence_run_id: c.runs.followup,
      }),
    ).toBe("followup");
    expect(
      await tipo("enviar_mensagem_ativa", {
        tipo_de_envio: "aviso_remarcacao",
      }),
    ).toBe("aviso_remarcacao");
    expect(
      await tipo("enviar_mensagem_ativa", {
        resposta_ao_paciente: true,
        tipo_de_envio: "aviso_remarcacao",
      }),
    ).toBeNull();
    expect(await tipo("baixar_midia", {})).toBeNull();
  });

  it("trocar a escolha de um tipo recarimba só os jobs desse tipo", async () => {
    const c = await cenario("recarimbo");
    const followup = await enfileirar(c.clinicId, "executar_passo_de_regua", {
      cadence_run_id: c.runs.followup,
    });
    const posFalta = await enfileirar(c.clinicId, "executar_passo_de_regua", {
      cadence_run_id: c.runs.posFalta,
    });
    await admin
      .from("whatsapp_envio_automatico")
      .upsert(
        [
          {
            clinic_id: c.clinicId,
            tipo: "followup",
            modo: "fixo",
            conta_fixa_id: c.b,
          },
          {
            clinic_id: c.clinicId,
            tipo: "pos_falta",
            modo: "fixo",
            conta_fixa_id: c.b,
          },
        ],
        { onConflict: "clinic_id,tipo" },
      )
      .throwOnError();

    const { data: movidos, error } = await admin.rpc(
      "redistribuir_jobs_do_numero",
      { p_account_id: c.a, p_tipos: ["followup"] },
    );
    expect(error).toBeNull();
    expect(movidos).toBe(1);
    expect(await numeroDoJob(followup.id)).toBe(c.b);
    expect(await numeroDoJob(posFalta.id)).toBe(c.a);
  });

  it("número removido: a escolha fixa de todo tipo volta ao último usado e os jobs saem dele", async () => {
    const c = await cenario("remocao");
    const confirmacao = await enfileirar(
      c.clinicId,
      "executar_passo_de_regua",
      { cadence_run_id: c.runs.confirmacao },
    );
    const aviso = await enfileirar(c.clinicId, "enviar_mensagem_ativa", {
      contact_id: c.contactId,
      body: "Sua consulta mudou.",
      tipo_de_envio: "aviso_remarcacao",
    });
    expect(confirmacao.whatsapp_account_id).toBe(c.b);

    const { error } = await admin.rpc("remover_numero", {
      p_clinic_id: c.clinicId,
      p_account_id: c.b,
    });
    expect(error).toBeNull();

    const { data: linhas } = await admin
      .from("whatsapp_envio_automatico")
      .select("tipo, modo, conta_fixa_id")
      .eq("clinic_id", c.clinicId)
      .order("tipo")
      .throwOnError();
    expect(linhas).toEqual([
      { tipo: "aviso_remarcacao", modo: "ultimo_usado", conta_fixa_id: null },
      { tipo: "confirmacao", modo: "ultimo_usado", conta_fixa_id: null },
      { tipo: "followup", modo: "ultimo_usado", conta_fixa_id: null },
    ]);
    expect(await numeroDoJob(confirmacao.id)).toBe(c.a);
    expect(await numeroDoJob(aviso.id)).toBe(c.a);
  });

  it("eco da resposta ao toque (D4): fica no número que recebeu, com qualquer escolha", async () => {
    const c = await cenario("eco");
    // Tudo fixo no B.
    await admin
      .from("whatsapp_envio_automatico")
      .upsert(
        ["confirmacao", "pos_falta", "followup", "lista_espera"].map(
          (tipo) => ({
            clinic_id: c.clinicId,
            tipo,
            modo: "fixo",
            conta_fixa_id: c.b,
          }),
        ),
        { onConflict: "clinic_id,tipo" },
      )
      .throwOnError();
    const eco = await enfileirar(
      c.clinicId,
      "enviar_mensagem_ativa",
      {
        contact_id: c.contactId,
        body: "Presença confirmada",
        resposta_ao_paciente: true,
      },
      c.a,
    );
    expect(eco.whatsapp_account_id).toBe(c.a);

    const { error } = await admin.rpc("redistribuir_jobs_do_numero", {
      p_account_id: c.a,
    });
    expect(error).toBeNull();
    expect(await numeroDoJob(eco.id)).toBe(c.a);
  });
});
