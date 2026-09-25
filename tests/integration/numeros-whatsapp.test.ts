import { afterAll, describe, expect, it } from "vitest";

import { adminClient } from "../rls/stack";

// Varios numeros de WhatsApp por clinica contra o banco REAL: os gatilhos e
// as RPCs das Fases 1A e 1B (migrations 20260925130000 e 20260925131000) e o
// contrato da Fase 3 (20260925140000), que tira o unique temporario de um
// numero por clinica, troca a conversa aberta por contato pela conversa
// aberta por contato E numero e torna o numero da conversa obrigatorio.
// Desenho em docs/07_multiplos_numeros_whatsapp.md.
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
  // So clinic_id e provedor: nome, principal e id vem do banco.
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
  // O segredo e do numero (account_id obrigatorio desde o contrato).
  await admin
    .from("whatsapp_account_secret")
    .insert({
      clinic_id: clinicId,
      account_id: numero!.id,
      instance_token: `tok-${nome}`,
    })
    .throwOnError();
  return { clinicId, numeroId: numero!.id as string };
}

/** Um numero a mais na clinica (nasce comum: o principal ja existe). */
async function criarOutroNumero(
  clinicId: string,
  nome = "Segundo",
): Promise<string> {
  const { data } = await admin
    .from("whatsapp_account")
    .insert({
      clinic_id: clinicId,
      provider: "fake",
      nome,
      connection_status: "conectado",
    })
    .select("id, principal")
    .single()
    .throwOnError();
  expect(data!.principal).toBe(false);
  await admin
    .from("whatsapp_account_secret")
    .insert({ clinic_id: clinicId, account_id: data!.id })
    .throwOnError();
  return data!.id as string;
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

async function numeroDaConversa(
  conversationId: string,
): Promise<string | null> {
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

  it("clínica sem número: conversa não nasce (o número é obrigatório)", async () => {
    // Desde o contrato da Fase 3 nao existe conversa sem numero: nem pela
    // tabela, nem pela entrada, nem pelo garantir do executor.
    const { clinicId } = await criarClinica("sem-numero", { comNumero: false });
    const contactId = await criarContato(clinicId);
    const direto = await admin
      .from("conversation")
      .insert({ clinic_id: clinicId, contact_id: contactId });
    expect(direto.error?.code).toBe("23502");

    const garantir = await admin.rpc("garantir_conversa_aberta", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
    });
    expect(garantir.error?.code).toBe("23502");

    // A entrada e uma transacao so: sem conversa, nem o contato novo fica.
    const fone = telefone();
    const entrada = await ingerir(clinicId, fone, `num:${sufixo}:sem-numero`);
    expect(entrada.error?.code).toBe("23502");
    const { data: contatos } = await admin
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("phone_e164", fone);
    expect(contatos).toHaveLength(0);
    const { data: conversas } = await admin
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(conversas).toHaveLength(0);
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
    const { data } = await ingerir(
      clinicId,
      telefone(),
      `num:${sufixo}:perfil`,
    );
    expect((data as { inserted: boolean }).inserted).toBe(true);
  });

  // Contrato da Fase 3: sem o unique temporario nem
  // conversation_aberta_por_contato, uma conversa aberta por contato E numero.
  it("números A e B abrem duas conversas do mesmo paciente", async () => {
    const { clinicId, numeroId: numeroA } = await criarClinica("dois");
    const numeroB = await criarOutroNumero(clinicId);
    const fone = telefone();
    const pelaA = await ingerir(clinicId, fone, `num:${sufixo}:a`, numeroA!);
    const pelaB = await ingerir(clinicId, fone, `num:${sufixo}:b`, numeroB);
    expect(pelaA.error).toBeNull();
    expect(pelaB.error).toBeNull();
    const a = pelaA.data as { conversation_id: string; contact_id: string };
    const b = pelaB.data as { conversation_id: string; contact_id: string };
    // O mesmo paciente (um contato so), duas conversas.
    expect(b.contact_id).toBe(a.contact_id);
    expect(a.conversation_id).not.toBe(b.conversation_id);
    expect(await numeroDaConversa(a.conversation_id)).toBe(numeroA);
    expect(await numeroDaConversa(b.conversation_id)).toBe(numeroB);

    // A segunda mensagem pelo A cai na conversa do A, nao na do B.
    const deNovoPelaA = await ingerir(
      clinicId,
      fone,
      `num:${sufixo}:a2`,
      numeroA!,
    );
    expect(
      (deNovoPelaA.data as { conversation_id: string }).conversation_id,
    ).toBe(a.conversation_id);

    // Cada mensagem guarda o numero da propria conversa.
    const { data: mensagens } = await admin
      .from("message")
      .select("conversation_id, whatsapp_account_id")
      .eq("clinic_id", clinicId);
    expect(mensagens).toHaveLength(3);
    for (const mensagem of mensagens ?? []) {
      expect(mensagem.whatsapp_account_id).toBe(
        mensagem.conversation_id === a.conversation_id ? numeroA : numeroB,
      );
    }

    // Duas abertas no MESMO numero continuam proibidas.
    const duplicada = await admin.from("conversation").insert({
      clinic_id: clinicId,
      contact_id: a.contact_id,
      whatsapp_account_id: numeroA,
    });
    expect(duplicada.error?.code).toBe("23505");
  });

  it("reabrir a conversa do A não colide com a aberta no B", async () => {
    const { clinicId, numeroId: numeroA } = await criarClinica("reabrir");
    const numeroB = await criarOutroNumero(clinicId);
    const fone = telefone();
    const pelaA = await ingerir(clinicId, fone, `num:${sufixo}:ra`, numeroA!);
    const pelaB = await ingerir(clinicId, fone, `num:${sufixo}:rb`, numeroB);
    const conversaA = (pelaA.data as { conversation_id: string })
      .conversation_id;
    const { contact_id: contactId } = pelaB.data as { contact_id: string };

    await admin
      .from("conversation")
      .update({ status: "resolvida" })
      .eq("id", conversaA)
      .throwOnError();
    // Com a do B aberta, reabrir a do A passa (antes, por contato, era 23505).
    const reaberta = await admin
      .from("conversation")
      .update({ status: "aguardando_humano" })
      .eq("id", conversaA)
      .select("status");
    expect(reaberta.error).toBeNull();
    expect(reaberta.data).toEqual([{ status: "aguardando_humano" }]);

    // Com uma NOVA aberta no A, reabrir a velha do A colide: a unicidade
    // continua, agora por numero.
    await admin
      .from("conversation")
      .update({ status: "resolvida" })
      .eq("id", conversaA)
      .throwOnError();
    const { data: nova } = await admin.rpc("garantir_conversa_aberta", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
      p_whatsapp_account_id: numeroA,
    });
    expect(nova).not.toBe(conversaA);
    expect(await numeroDaConversa(nova as string)).toBe(numeroA);
    const colide = await admin
      .from("conversation")
      .update({ status: "aguardando_humano" })
      .eq("id", conversaA);
    expect(colide.error?.code).toBe("23505");
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

  // Dois numeros: o paciente escreveu por ultimo no B.
  it("último usado é o número em que o paciente escreveu por último (last_inbound_at)", async () => {
    const { clinicId, numeroId: numeroA } = await criarClinica("conta-dois");
    const numeroB = await criarOutroNumero(clinicId);
    const fone = telefone();
    const pelaA = await ingerir(clinicId, fone, `num:${sufixo}:u-a`, numeroA!);
    await ingerir(clinicId, fone, `num:${sufixo}:u-b`, numeroB);
    await admin
      .from("conversation")
      .update({
        last_inbound_at: new Date(Date.now() - 3_600_000).toISOString(),
      })
      .eq("id", (pelaA.data as { conversation_id: string }).conversation_id)
      .throwOnError();
    const contactId = (pelaA.data as { contact_id: string }).contact_id;
    const { data } = await admin.rpc("conta_de_envio", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
    });
    expect(data).toBe(numeroB);

    // A versao em lote diz o mesmo, com o nome do numero.
    const { data: lote } = await admin.rpc("contas_de_envio", {
      p_clinic_id: clinicId,
      p_contact_ids: [contactId],
    });
    expect(lote).toEqual([
      {
        contact_id: contactId,
        whatsapp_account_id: numeroB,
        nome: "Segundo",
        connection_status: "conectado",
      },
    ]);

    // E o job de envio sem numero nasce carimbado no B pelo gatilho.
    const { data: job } = await admin
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
    expect(job!.whatsapp_account_id).toBe(numeroB);
  });

  it("modo fixo no número que não é o principal manda em todo contato", async () => {
    const { clinicId, numeroId: numeroA } = await criarClinica("conta-fixo-b");
    const numeroB = await criarOutroNumero(clinicId);
    const fone = telefone();
    // O paciente escreveu pelo A, mas as automaticas sao fixas no B.
    const pelaA = await ingerir(clinicId, fone, `num:${sufixo}:f-a`, numeroA!);
    await admin
      .from("whatsapp_envio_automatico")
      .insert({ clinic_id: clinicId, modo: "fixo", conta_fixa_id: numeroB })
      .throwOnError();
    const { data } = await admin.rpc("conta_de_envio", {
      p_clinic_id: clinicId,
      p_contact_id: (pelaA.data as { contact_id: string }).contact_id,
    });
    expect(data).toBe(numeroB);
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
    const { conversation_id: conversaId, contact_id: contactId } = entrada as {
      conversation_id: string;
      contact_id: string;
    };

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
    expect(tarde).toMatchObject({
      inserted: false,
      ignorada: "numero_removido",
    });

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

  // Com dois numeros, o principal so sai depois de outro virar principal, e
  // os jobs pendentes vao para o outro numero.
  it("principal com outro número ativo: recusa; o outro recebe os jobs", async () => {
    const { clinicId, numeroId: numeroA } = await criarClinica("remover-dois");
    const numeroB = await criarOutroNumero(clinicId);
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
        whatsapp_account_id: numeroB,
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .rpc("remover_numero", { p_clinic_id: clinicId, p_account_id: numeroB })
      .throwOnError();
    const { data: depois } = await admin
      .from("job_queue")
      .select("whatsapp_account_id")
      .eq("id", job!.id)
      .single();
    expect(depois?.whatsapp_account_id).toBe(numeroA);
  });

  // Achado N[0] da revisao da Fase 2: o eco da resposta ao toque ja
  // reivindicado quando o numero sai. remover_numero so cancela eco
  // PENDENTE; este, executando, chega a numero_do_job. Antes do contrato ele
  // era recarimbado com o outro numero e so a copia lida no claim (worker.ts)
  // segurava a D4. Agora o banco devolve 'numero_removido' e nao mexe na
  // coluna, por mais que o job volte a fila.
  it("numero_do_job: eco cujo número saiu não é recarimbado (D4)", async () => {
    const { clinicId, numeroId: numeroA } = await criarClinica("eco-removido");
    const numeroB = await criarOutroNumero(clinicId);
    const contactId = await criarContato(clinicId);
    const worker = `teste-eco-${sufixo}`;
    const { data: eco } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: {
          contact_id: contactId,
          body: "Presença confirmada (teste)",
          resposta_ao_paciente: true,
        },
        run_at: AMANHA(),
        whatsapp_account_id: numeroA,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: comum } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { contact_id: contactId, body: "comum" },
        run_at: AMANHA(),
        whatsapp_account_id: numeroA,
      })
      .select("id")
      .single()
      .throwOnError();
    // Posse simulada, como o claim faz: os dois ja estao executando.
    await admin
      .from("job_queue")
      .update({ status: "executando", locked_by: worker })
      .in("id", [eco!.id, comum!.id])
      .throwOnError();

    await admin
      .rpc("definir_numero_principal", {
        p_clinic_id: clinicId,
        p_account_id: numeroB,
      })
      .throwOnError();
    await admin
      .rpc("remover_numero", { p_clinic_id: clinicId, p_account_id: numeroA })
      .throwOnError();

    for (let vez = 0; vez < 2; vez += 1) {
      const { data: estado } = await admin.rpc("numero_do_job", {
        p_job_id: eco!.id,
        p_worker: worker,
      });
      expect(estado).toEqual({ estado: "numero_removido" });
      const { data: linha } = await admin
        .from("job_queue")
        .select("whatsapp_account_id")
        .eq("id", eco!.id)
        .single();
      expect(linha?.whatsapp_account_id).toBe(numeroA);
    }

    // O envio comum, sem mensagem, continua indo para o numero que sobrou.
    const { data: estadoComum } = await admin.rpc("numero_do_job", {
      p_job_id: comum!.id,
      p_worker: worker,
    });
    expect(estadoComum).toEqual({
      estado: "ok",
      whatsapp_account_id: numeroB,
    });

    await admin
      .from("job_queue")
      .update({ status: "cancelado", locked_by: null })
      .in("id", [eco!.id, comum!.id])
      .throwOnError();
  });
});
