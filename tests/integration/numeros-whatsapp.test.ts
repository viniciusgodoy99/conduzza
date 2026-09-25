import { afterAll, describe, expect, it } from "vitest";

import { adminClient } from "../rls/stack";

// Varios numeros de WhatsApp por clinica, Fases 1A e 1B, contra o banco REAL
// (migrations 20260925130000 e 20260925131000; desenho em
// docs/07_multiplos_numeros_whatsapp.md). Prova os gatilhos e as RPCs que a
// Fase 2 vai usar, SEM mudar codigo: e isso que deixa as migrations subirem
// antes do codigo.
//
// NESTA FASE o unique temporario whatsapp_account_uma_por_clinica ainda
// impede o segundo numero numa clinica, e ele e constraint da tabela (nao da
// para desligar so numa clinica de teste). Tudo o que funciona com UM numero
// e testado agora; o que precisa de dois fica em it.skip e ativa na Fase 3.
// O comportamento com dois numeros foi provado no ensaio das migrations, numa
// transacao desfeita que derruba o unique temporario.
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
  return `+55849781${String(sequencia).padStart(5, "0")}`;
}

async function criarClinica(
  nome: string,
  opcoes: { comNumero: boolean } = { comNumero: true },
): Promise<{ clinicId: string; numeroId: string | null }> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Numeros ${nome} ${sufixo}`,
      slug: `numeros-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  if (!opcoes.comNumero) {
    return { clinicId, numeroId: null };
  }
  // Como o codigo de HOJE grava: so clinic_id e provedor.
  const { data: numero } = await admin
    .from("whatsapp_account")
    .insert({
      clinic_id: clinicId,
      provider: "fake",
      connection_status: "conectado",
    })
    .select("id")
    .single()
    .throwOnError();
  await admin
    .from("whatsapp_account_secret")
    .insert({ clinic_id: clinicId, instance_token: `tok-${nome}` })
    .throwOnError();
  return { clinicId, numeroId: numero!.id as string };
}

async function criarContato(clinicId: string): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: telefone(), name: "Paciente" })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function ingerir(
  clinicId: string,
  phone: string,
  waMessageId: string,
  numeroId?: string,
) {
  return await admin.rpc("ingest_inbound_message", {
    p_clinic_id: clinicId,
    p_phone_e164: phone,
    p_name: "Paciente",
    p_wa_message_id: waMessageId,
    p_body: "oi",
    ...(numeroId ? { p_whatsapp_account_id: numeroId } : {}),
  });
}

async function numeroDaConversa(conversationId: string): Promise<string | null> {
  const { data } = await admin
    .from("conversation")
    .select("whatsapp_account_id")
    .eq("id", conversationId)
    .single()
    .throwOnError();
  return (data!.whatsapp_account_id as string | null) ?? null;
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("conversa e mensagem ganham o número", () => {
  it("conversa sem número ganha o principal", async () => {
    const { clinicId, numeroId } = await criarClinica("conversa");
    const contactId = await criarContato(clinicId);
    const { data } = await admin
      .from("conversation")
      .insert({ clinic_id: clinicId, contact_id: contactId })
      .select("whatsapp_account_id")
      .single()
      .throwOnError();
    expect(data!.whatsapp_account_id).toBe(numeroId);
  });

  it("conversa com número de outra clínica é recusada", async () => {
    const { clinicId } = await criarClinica("conversa-outra");
    const { numeroId: numeroDeFora } = await criarClinica("conversa-fora");
    const contactId = await criarContato(clinicId);
    const { error } = await admin.from("conversation").insert({
      clinic_id: clinicId,
      contact_id: contactId,
      whatsapp_account_id: numeroDeFora,
    });
    expect(error?.code).toBe("23503");
  });

  it("mensagem herda o número da conversa, e a forja é sobrescrita", async () => {
    const { clinicId, numeroId } = await criarClinica("mensagem");
    const { numeroId: numeroDeFora } = await criarClinica("mensagem-fora");
    const contactId = await criarContato(clinicId);
    const { data: conversa } = await admin
      .from("conversation")
      .insert({ clinic_id: clinicId, contact_id: contactId })
      .select("id")
      .single()
      .throwOnError();
    const { data: mensagem } = await admin
      .from("message")
      .insert({
        clinic_id: clinicId,
        conversation_id: conversa!.id,
        direction: "saida",
        author: "sistema",
        content_type: "evento",
        body: "evento de teste",
        whatsapp_account_id: numeroDeFora,
      })
      .select("id, whatsapp_account_id")
      .single()
      .throwOnError();
    expect(mensagem!.whatsapp_account_id).toBe(numeroId);

    // Depois de definido, o numero da mensagem nao muda.
    const { error } = await admin
      .from("message")
      .update({ whatsapp_account_id: numeroDeFora })
      .eq("id", mensagem!.id);
    expect(error?.code).toBe("23514");
  });

  it("clínica sem número: conversa fica sem número e é adotada quando o número chega", async () => {
    // Muitos testes antigos inserem conversa em clinica SEM conta: isso
    // continua funcionando, e o primeiro numero da clinica adota o que ficou.
    const { clinicId } = await criarClinica("orfas", { comNumero: false });
    const { data: entrada, error } = await ingerir(
      clinicId,
      telefone(),
      `num:${sufixo}:orfa`,
    );
    expect(error).toBeNull();
    const conversationId = (entrada as { conversation_id: string })
      .conversation_id;
    expect(await numeroDaConversa(conversationId)).toBeNull();

    const { data: numero } = await admin
      .from("whatsapp_account")
      .insert({ clinic_id: clinicId, provider: "fake" })
      .select("id, principal")
      .single()
      .throwOnError();
    expect(numero!.principal).toBe(true);
    expect(await numeroDaConversa(conversationId)).toBe(numero!.id);
    const { data: mensagens } = await admin
      .from("message")
      .select("whatsapp_account_id")
      .eq("conversation_id", conversationId);
    expect(mensagens).toEqual([{ whatsapp_account_id: numero!.id }]);
  });
});

describe("entrada com número", () => {
  it("sem p_whatsapp_account_id, a mensagem entra pelo principal", async () => {
    const { clinicId, numeroId } = await criarClinica("entrada-principal");
    const { data, error } = await ingerir(
      clinicId,
      telefone(),
      `num:${sufixo}:principal`,
    );
    expect(error).toBeNull();
    const resultado = data as {
      inserted: boolean;
      conversation_id: string;
      whatsapp_account_id: string;
    };
    expect(resultado.inserted).toBe(true);
    expect(resultado.whatsapp_account_id).toBe(numeroId);
    expect(await numeroDaConversa(resultado.conversation_id)).toBe(numeroId);
  });

  it("com p_whatsapp_account_id, a conversa e a mensagem são daquele número", async () => {
    const { clinicId, numeroId } = await criarClinica("entrada-numero");
    const { data, error } = await ingerir(
      clinicId,
      telefone(),
      `num:${sufixo}:com-numero`,
      numeroId!,
    );
    expect(error).toBeNull();
    const resultado = data as { conversation_id: string; message_id: string };
    expect(await numeroDaConversa(resultado.conversation_id)).toBe(numeroId);
    const { data: mensagem } = await admin
      .from("message")
      .select("whatsapp_account_id")
      .eq("id", resultado.message_id)
      .single();
    expect(mensagem?.whatsapp_account_id).toBe(numeroId);
  });

  it("número de outra clínica é recusado", async () => {
    const { clinicId } = await criarClinica("entrada-outra");
    const { numeroId: numeroDeFora } = await criarClinica("entrada-fora");
    const { error } = await ingerir(
      clinicId,
      telefone(),
      `num:${sufixo}:de-fora`,
      numeroDeFora!,
    );
    expect(error?.code).toBe("23503");
  });

  it("mensagem do próprio número da clínica é ignorada, sem criar contato", async () => {
    const { clinicId, numeroId } = await criarClinica("proprio");
    // display_phone como o uazapi grava: so digitos, sem o nono digito.
    await admin
      .from("whatsapp_account")
      .update({ display_phone: "558499776655" })
      .eq("id", numeroId!)
      .throwOnError();
    const { data, error } = await ingerir(
      clinicId,
      "+5584999776655",
      `num:${sufixo}:proprio`,
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({
      inserted: false,
      ignorada: "numero_proprio",
      contact_id: null,
      conversation_id: null,
      message_id: null,
    });
    const { data: contatos } = await admin
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(contatos).toHaveLength(0);
  });

  it("display_phone com nome de perfil não filtra ninguém", async () => {
    const { clinicId, numeroId } = await criarClinica("perfil");
    await admin
      .from("whatsapp_account")
      .update({ display_phone: "Clinica 24h" })
      .eq("id", numeroId!)
      .throwOnError();
    const { data } = await ingerir(clinicId, telefone(), `num:${sufixo}:perfil`);
    expect((data as { inserted: boolean }).inserted).toBe(true);
  });

  // Ativa na Fase 3 (sem o unique temporario nem conversation_aberta_por_contato).
  it.skip("números A e B abrem duas conversas do mesmo paciente", async () => {
    const { clinicId, numeroId: numeroA } = await criarClinica("dois");
    const { data: b } = await admin
      .from("whatsapp_account")
      .insert({ clinic_id: clinicId, provider: "fake", nome: "Segundo" })
      .select("id")
      .single()
      .throwOnError();
    const fone = telefone();
    const pelaA = await ingerir(clinicId, fone, `num:${sufixo}:a`, numeroA!);
    const pelaB = await ingerir(clinicId, fone, `num:${sufixo}:b`, b!.id);
    const conversaA = (pelaA.data as { conversation_id: string }).conversation_id;
    const conversaB = (pelaB.data as { conversation_id: string }).conversation_id;
    expect(conversaA).not.toBe(conversaB);
    expect(await numeroDaConversa(conversaB)).toBe(b!.id);
  });
});

describe("conta_de_envio", () => {
  it("paciente que nunca escreveu sai pelo principal", async () => {
    const { clinicId, numeroId } = await criarClinica("conta-principal");
    const contactId = await criarContato(clinicId);
    const { data, error } = await admin.rpc("conta_de_envio", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
    });
    expect(error).toBeNull();
    expect(data).toBe(numeroId);
  });

  it("paciente que escreveu sai pelo número da conversa", async () => {
    const { clinicId, numeroId } = await criarClinica("conta-ultimo");
    const fone = telefone();
    const { data: entrada } = await ingerir(
      clinicId,
      fone,
      `num:${sufixo}:ultimo`,
    );
    const contactId = (entrada as { contact_id: string }).contact_id;
    const { data } = await admin.rpc("conta_de_envio", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
    });
    expect(data).toBe(numeroId);
  });

  it("modo fixo manda no número", async () => {
    const { clinicId, numeroId } = await criarClinica("conta-fixo");
    await admin
      .from("whatsapp_envio_automatico")
      .insert({ clinic_id: clinicId, modo: "fixo", conta_fixa_id: numeroId })
      .throwOnError();
    const contactId = await criarContato(clinicId);
    const { data } = await admin.rpc("contas_de_envio", {
      p_clinic_id: clinicId,
      p_contact_ids: [contactId, contactId],
    });
    expect(data).toEqual([
      {
        contact_id: contactId,
        whatsapp_account_id: numeroId,
        nome: "Número principal",
        connection_status: "conectado",
      },
    ]);
  });

  it("número removido sai da escolha", async () => {
    const { clinicId, numeroId } = await criarClinica("conta-removido");
    const { data: entrada } = await ingerir(
      clinicId,
      telefone(),
      `num:${sufixo}:removido`,
    );
    const contactId = (entrada as { contact_id: string }).contact_id;
    const { error: erroRemover } = await admin.rpc("remover_numero", {
      p_clinic_id: clinicId,
      p_account_id: numeroId,
    });
    expect(erroRemover).toBeNull();
    const { data } = await admin.rpc("conta_de_envio", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
    });
    expect(data).toBeNull();
  });

  // Ativa na Fase 3: dois numeros, o paciente escreveu por ultimo no B.
  it.skip("último usado é o número em que o paciente escreveu por último (last_inbound_at)", async () => {
    const { clinicId, numeroId: numeroA } = await criarClinica("conta-dois");
    const { data: b } = await admin
      .from("whatsapp_account")
      .insert({ clinic_id: clinicId, provider: "fake", nome: "Segundo" })
      .select("id")
      .single()
      .throwOnError();
    const fone = telefone();
    const pelaA = await ingerir(clinicId, fone, `num:${sufixo}:u-a`, numeroA!);
    await ingerir(clinicId, fone, `num:${sufixo}:u-b`, b!.id);
    await admin
      .from("conversation")
      .update({ last_inbound_at: new Date(Date.now() - 3_600_000).toISOString() })
      .eq("id", (pelaA.data as { conversation_id: string }).conversation_id)
      .throwOnError();
    const { data } = await admin.rpc("conta_de_envio", {
      p_clinic_id: clinicId,
      p_contact_id: (pelaA.data as { contact_id: string }).contact_id,
    });
    expect(data).toBe(b!.id);
  });
});

describe("fila ganha o número", () => {
  it("job de envio nasce carimbado; mídia não", async () => {
    const { clinicId, numeroId } = await criarClinica("job");
    const contactId = await criarContato(clinicId);
    const { data: envio } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { contact_id: contactId, body: "teste" },
        run_at: AMANHA(),
      })
      .select("whatsapp_account_id")
      .single()
      .throwOnError();
    expect(envio!.whatsapp_account_id).toBe(numeroId);

    const { data: midia } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "baixar_midia",
        payload: {},
        run_at: AMANHA(),
      })
      .select("whatsapp_account_id")
      .single()
      .throwOnError();
    expect(midia!.whatsapp_account_id).toBeNull();
  });

  it("passo de régua acha o contato pela execução", async () => {
    const { clinicId, numeroId } = await criarClinica("job-regua");
    const contactId = await criarContato(clinicId);
    const { data: regua } = await admin
      .from("cadence")
      .insert({
        clinic_id: clinicId,
        kind: "followup",
        name: `Regua ${sufixo}`,
        trigger_stage: "novo",
        active: false,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: passo } = await admin
      .from("cadence_step")
      .insert({
        clinic_id: clinicId,
        cadence_id: regua!.id,
        offset_minutes: 60,
        fixed_body: "Oi",
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: execucao } = await admin
      .from("cadence_run")
      .insert({
        clinic_id: clinicId,
        cadence_step_id: passo!.id,
        contact_id: contactId,
        scheduled_for: AMANHA(),
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: job } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "executar_passo_de_regua",
        payload: { cadence_run_id: execucao!.id },
        run_at: AMANHA(),
      })
      .select("whatsapp_account_id")
      .single()
      .throwOnError();
    expect(job!.whatsapp_account_id).toBe(numeroId);
  });

  it("job com número de outra clínica é recusado", async () => {
    const { clinicId } = await criarClinica("job-outra");
    const { numeroId: numeroDeFora } = await criarClinica("job-fora");
    const { error } = await admin.from("job_queue").insert({
      clinic_id: clinicId,
      kind: "enviar_mensagem_ativa",
      payload: {},
      run_at: AMANHA(),
      whatsapp_account_id: numeroDeFora,
    });
    expect(error?.code).toBe("23503");
  });
});

describe("slot anti-ban por número", () => {
  it("reserva na linha do número; nulo é o principal; de fora é sem_conta", async () => {
    const { clinicId, numeroId } = await criarClinica("slot");
    const { numeroId: numeroDeFora } = await criarClinica("slot-fora");
    const reservar = (numero?: string | null) =>
      admin.rpc("reservar_slot_envio_v2", {
        p_clinic_id: clinicId,
        p_espaco_ms: 60_000,
        p_espera_maxima_ms: 1_000,
        ...(numero ? { p_whatsapp_account_id: numero } : {}),
      });

    const primeiro = await reservar(numeroId);
    expect((primeiro.data as { estado: string }).estado).toBe("reservado");
    // O mesmo numero acabou de reservar 60 s: a proxima fica adiada, pelo
    // numero explicito e pelo principal (nulo).
    const pelaMesma = await reservar(numeroId);
    expect((pelaMesma.data as { estado: string }).estado).toBe("adiado");
    const peloPrincipal = await reservar(null);
    expect((peloPrincipal.data as { estado: string }).estado).toBe("adiado");
    const deFora = await reservar(numeroDeFora);
    expect((deFora.data as { estado: string }).estado).toBe("sem_conta");

    const { data: foraDepois } = await admin
      .from("whatsapp_account")
      .select("next_send_at")
      .eq("id", numeroDeFora!)
      .single();
    expect(foraDepois?.next_send_at).toBeNull();
  });
});

describe("garantir_conversa_aberta e apagamento com número", () => {
  it("garantir devolve a conversa do número; número de fora é recusado", async () => {
    const { clinicId, numeroId } = await criarClinica("garantir");
    const { numeroId: numeroDeFora } = await criarClinica("garantir-fora");
    const contactId = await criarContato(clinicId);
    const { data: conversaId, error } = await admin.rpc(
      "garantir_conversa_aberta",
      { p_clinic_id: clinicId, p_contact_id: contactId },
    );
    expect(error).toBeNull();
    expect(await numeroDaConversa(conversaId as string)).toBe(numeroId);

    const { data: mesma } = await admin.rpc("garantir_conversa_aberta", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
      p_whatsapp_account_id: numeroId,
    });
    expect(mesma).toBe(conversaId);

    const { error: erroFora } = await admin.rpc("garantir_conversa_aberta", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
      p_whatsapp_account_id: numeroDeFora,
    });
    expect(erroFora?.code).toBe("23503");
  });

  it("apagamento com número só alcança a mensagem daquele número", async () => {
    const { clinicId, numeroId } = await criarClinica("apagar");
    const { numeroId: numeroDeFora } = await criarClinica("apagar-fora");
    const waId = `num:${sufixo}:apagar`;
    await ingerir(clinicId, telefone(), waId);

    const { data: errado } = await admin.rpc(
      "registrar_apagamento_do_whatsapp",
      {
        p_clinic_id: clinicId,
        p_wa_message_id: waId,
        p_whatsapp_account_id: numeroDeFora,
      },
    );
    expect(errado).toMatchObject({ ok: false, motivo: "nao_encontrada" });

    const { data: certo } = await admin.rpc(
      "registrar_apagamento_do_whatsapp",
      {
        p_clinic_id: clinicId,
        p_wa_message_id: waId,
        p_whatsapp_account_id: numeroId,
      },
    );
    expect(certo).toMatchObject({ ok: true, origem: "paciente" });
  });
});

describe("remover_numero", () => {
  it("encerra as conversas abertas com evento, redistribui os jobs e gira o segredo", async () => {
    const { clinicId, numeroId } = await criarClinica("remover");
    const { data: entrada } = await ingerir(
      clinicId,
      telefone(),
      `num:${sufixo}:remover`,
    );
    const { conversation_id: conversaId, contact_id: contactId } =
      entrada as { conversation_id: string; contact_id: string };

    // Job pendente sem mensagem (redistribui) e job que ja gravou mensagem
    // (fica no numero removido e falha na execucao).
    const { data: pendente } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { contact_id: contactId, body: "pendente" },
        run_at: AMANHA(),
      })
      .select("id, whatsapp_account_id")
      .single()
      .throwOnError();
    expect(pendente!.whatsapp_account_id).toBe(numeroId);
    const { data: jaEnviou } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { contact_id: contactId, body: "enviado" },
        run_at: AMANHA(),
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("message")
      .insert({
        clinic_id: clinicId,
        conversation_id: conversaId,
        direction: "saida",
        author: "sistema",
        body: "enviado",
        job_id: jaEnviou!.id,
      })
      .throwOnError();

    const { data: segredoAntes } = await admin
      .from("whatsapp_account_secret")
      .select("webhook_secret")
      .eq("account_id", numeroId!)
      .single()
      .throwOnError();

    const { data: resultado, error } = await admin.rpc("remover_numero", {
      p_clinic_id: clinicId,
      p_account_id: numeroId,
    });
    expect(error).toBeNull();
    // Unico numero da clinica: o job pendente fica sem numero (nao ha outro).
    expect(resultado).toMatchObject({
      ok: true,
      ja_removido: false,
      conversas_encerradas: 1,
      jobs_redistribuidos: 1,
    });

    const { data: conversa } = await admin
      .from("conversation")
      .select("status, awaiting_reply")
      .eq("id", conversaId)
      .single();
    expect(conversa).toEqual({ status: "resolvida", awaiting_reply: false });
    const { data: eventos } = await admin
      .from("message")
      .select("body")
      .eq("conversation_id", conversaId)
      .eq("content_type", "evento");
    expect(eventos).toEqual([
      {
        body: 'Conversa encerrada porque o número "Número principal" foi removido da clínica.',
      },
    ]);

    const { data: jobs } = await admin
      .from("job_queue")
      .select("id, whatsapp_account_id")
      .in("id", [pendente!.id, jaEnviou!.id]);
    const numeroDoJob = (id: string) =>
      (jobs ?? []).find((j) => j.id === id)?.whatsapp_account_id;
    expect(numeroDoJob(pendente!.id as string)).toBeNull();
    expect(numeroDoJob(jaEnviou!.id as string)).toBe(numeroId);

    const { data: numero } = await admin
      .from("whatsapp_account")
      .select("principal, connection_status, removido_em")
      .eq("id", numeroId!)
      .single();
    expect(numero?.principal).toBe(false);
    expect(numero?.connection_status).toBe("desconectado");
    expect(numero?.removido_em).not.toBeNull();
    const { data: segredoDepois } = await admin
      .from("whatsapp_account_secret")
      .select("instance_token, webhook_secret")
      .eq("account_id", numeroId!)
      .single();
    expect(segredoDepois?.instance_token).toBeNull();
    expect(segredoDepois?.webhook_secret).not.toBe(
      segredoAntes!.webhook_secret,
    );

    // Entrada pelo numero removido nao grava nada.
    const { data: tarde } = await ingerir(
      clinicId,
      telefone(),
      `num:${sufixo}:tarde`,
      numeroId!,
    );
    expect(tarde).toMatchObject({ inserted: false, ignorada: "numero_removido" });

    // Remover de novo nao faz nada.
    const { data: deNovo } = await admin.rpc("remover_numero", {
      p_clinic_id: clinicId,
      p_account_id: numeroId,
    });
    expect(deNovo).toMatchObject({ ok: true, ja_removido: true });
  });

  it("numero_do_job: removido com mensagem falha; sem mensagem recarimba", async () => {
    const { clinicId, numeroId } = await criarClinica("numero-do-job");
    const contactId = await criarContato(clinicId);
    const worker = `teste-${sufixo}`;
    const { data: conversa } = await admin
      .from("conversation")
      .insert({ clinic_id: clinicId, contact_id: contactId })
      .select("id")
      .single()
      .throwOnError();
    const { data: comMensagem } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { contact_id: contactId },
        run_at: AMANHA(),
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("message")
      .insert({
        clinic_id: clinicId,
        conversation_id: conversa!.id,
        direction: "saida",
        author: "sistema",
        body: "ja saiu",
        job_id: comMensagem!.id,
      })
      .throwOnError();

    await admin
      .rpc("remover_numero", { p_clinic_id: clinicId, p_account_id: numeroId })
      .throwOnError();

    // Job carimbado com o numero removido e SEM mensagem: recarimba (e, sem
    // outro numero ativo, fica sem numero).
    const { data: semMensagem } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { contact_id: contactId },
        run_at: AMANHA(),
        whatsapp_account_id: numeroId,
      })
      .select("id")
      .single()
      .throwOnError();

    // Posse simulada, como o claim faz.
    await admin
      .from("job_queue")
      .update({ status: "executando", locked_by: worker })
      .in("id", [comMensagem!.id, semMensagem!.id])
      .throwOnError();

    const { data: estadoComMensagem } = await admin.rpc("numero_do_job", {
      p_job_id: comMensagem!.id,
      p_worker: worker,
    });
    expect(estadoComMensagem).toEqual({ estado: "numero_removido" });

    const { data: semPosse } = await admin.rpc("numero_do_job", {
      p_job_id: comMensagem!.id,
      p_worker: "outro-worker",
    });
    expect(semPosse).toEqual({ estado: "sem_posse" });

    const { data: estadoSemMensagem } = await admin.rpc("numero_do_job", {
      p_job_id: semMensagem!.id,
      p_worker: worker,
    });
    expect(estadoSemMensagem).toEqual({ estado: "sem_numero" });
    const { data: recarimbado } = await admin
      .from("job_queue")
      .select("whatsapp_account_id")
      .eq("id", semMensagem!.id)
      .single();
    expect(recarimbado?.whatsapp_account_id).toBeNull();

    // Devolve os jobs para ninguem tropeçar neles antes do afterAll.
    await admin
      .from("job_queue")
      .update({ status: "cancelado", locked_by: null })
      .in("id", [comMensagem!.id, semMensagem!.id])
      .throwOnError();
  });

  // Ativa na Fase 3: com dois numeros, o principal so sai depois de outro
  // virar principal, e os jobs pendentes vao para o outro numero.
  it.skip("principal com outro número ativo: recusa; o outro recebe os jobs", async () => {
    const { clinicId, numeroId: numeroA } = await criarClinica("remover-dois");
    const { data: b } = await admin
      .from("whatsapp_account")
      .insert({ clinic_id: clinicId, provider: "fake", nome: "Segundo" })
      .select("id")
      .single()
      .throwOnError();
    const recusa = await admin.rpc("remover_numero", {
      p_clinic_id: clinicId,
      p_account_id: numeroA,
    });
    expect(recusa.error?.code).toBe("55000");

    const contactId = await criarContato(clinicId);
    const { data: job } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { contact_id: contactId },
        run_at: AMANHA(),
        whatsapp_account_id: b!.id,
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .rpc("remover_numero", { p_clinic_id: clinicId, p_account_id: b!.id })
      .throwOnError();
    const { data: depois } = await admin
      .from("job_queue")
      .select("whatsapp_account_id")
      .eq("id", job!.id)
      .single();
    expect(depois?.whatsapp_account_id).toBe(numeroA);
  });
});
