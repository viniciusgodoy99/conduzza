/**
 * PROVA DO MOTOR, ponta a ponta, contra as peças REAIS da máquina:
 * o banco (numa clínica descartável com provider fake), a aplicação rodando em
 * localhost:3000 (o webhook HTTP de verdade, com secret) e o worker vivo
 * (claim, envio, planner).
 *
 * Rode com `npm run prova:motor`, com `npm run dev` e `npm run worker` de pé.
 * É o que responde "o produto está mesmo funcionando?" sem precisar de um
 * paciente de verdade: os testes automatizados provam peça por peça, este
 * script prova a corrente inteira.
 *
 * Nada encosta no canal uazapi real. A clínica é apagada no finally.
 *
 * O que se prova, na ordem:
 *  1. Régua de confirmação: clínica configura janela, liga, consulta a ~24h
 *     entra no planner, o worker envia, status vira aguardando_confirmacao.
 *  2. Resposta do paciente "1" entra pelo WEBHOOK HTTP real e vira
 *     confirmado_paciente com autoria de paciente, e a conversa sai do
 *     contador de espera.
 *  3. Régua de pós-falta: falta marcada por gente, planner cria o toque D+0,
 *     o worker envia o texto com a DATA da consulta (nunca "hoje").
 */
import { adminClient } from "../../tests/rls/stack";

const admin = adminClient();
const MIN = 60_000;
const sufixo = Date.now().toString(36);
const falhas: string[] = [];

function ok(nome: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ok  ${nome}`);
  } else {
    falhas.push(nome);
    console.log(
      `FALHA ${nome}`,
      extra !== undefined ? JSON.stringify(extra).slice(0, 300) : "",
    );
  }
}

async function poll<T>(
  nome: string,
  fn: () => Promise<T | null>,
  timeoutMs = 90_000,
): Promise<T | null> {
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    const v = await fn();
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`  (timeout esperando: ${nome})`);
  return null;
}

let clinicId: string | null = null;
try {
  // ---------- montagem ----------
  const { data: clinica } = await admin
    .from("clinic")
    .insert({ name: `Prova Viva ${sufixo}`, slug: `prova-viva-${sufixo}` })
    .select("id, timezone")
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
  const { data: segredo } = await admin
    .from("whatsapp_account_secret")
    .insert({ clinic_id: clinicId })
    .select("webhook_secret")
    .single()
    .throwOnError();
  const secret = segredo!.webhook_secret as string;

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dra. Prova" })
    .select("id")
    .single()
    .throwOnError();
  const { data: proc } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinicId,
      name: "Avaliação",
      default_duration_min: 30,
      prep_instructions: "Venha sem maquiagem.",
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinc } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: prof!.id,
      procedure_id: proc!.id,
      insurance_id: null,
      price_cents: 15000,
      covered_by_insurance: false,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();

  const telefone1 = "+5584968000001";
  const telefone2 = "+5584968000002";
  const contatos = (
    await admin
      .from("contact")
      .insert([
        { clinic_id: clinicId, phone_e164: telefone1, name: "Paula Prova" },
        { clinic_id: clinicId, phone_e164: telefone2, name: "Fábio Falta" },
      ])
      .select("id, phone_e164")
      .throwOnError()
  ).data as { id: string; phone_e164: string }[];
  const c1 = contatos.find((c) => c.phone_e164 === telefone1)!.id;
  const c2 = contatos.find((c) => c.phone_e164 === telefone2)!.id;
  await admin
    .from("contact_consent")
    .insert([
      {
        clinic_id: clinicId,
        contact_id: c1,
        channel: "whatsapp",
        source: "recepcao",
      },
      {
        clinic_id: clinicId,
        contact_id: c2,
        channel: "whatsapp",
        source: "recepcao",
      },
    ])
    .throwOnError();

  // O seed do gatilho criou as duas réguas desligadas?
  const { data: reguas } = await admin
    .from("cadence")
    .select("id, kind, active")
    .eq("clinic_id", clinicId)
    .throwOnError();
  ok(
    "seed criou as 2 réguas, desligadas",
    (reguas ?? []).length === 2 && (reguas ?? []).every((r) => !r.active),
    reguas,
  );
  const reguaConf = (reguas ?? []).find((r) => r.kind === "confirmacao")!;
  const reguaFalta = (reguas ?? []).find((r) => r.kind === "pos_falta")!;

  // A clínica configura a janela e liga (como o painel faz).
  await admin
    .from("cadence")
    .update({
      send_window_start: "00:00",
      send_window_end: "23:59",
      send_weekdays: [0, 1, 2, 3, 4, 5, 6],
      active: true,
    })
    .eq("id", reguaConf.id)
    .throwOnError();

  // ---------- 1. toque automático de 24h ----------
  const inicio1 = new Date(Date.now() + 1437 * MIN); // 24h - 3min à frente
  const { data: consulta1 } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicId,
      contact_id: c1,
      professional_id: prof!.id,
      service_link_id: vinc!.id,
      starts_at: inicio1.toISOString(),
      ends_at: new Date(inicio1.getTime() + 30 * MIN).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  const appt1 = consulta1!.id as string;

  await admin.rpc("planejar_reguas").throwOnError();
  const { data: runs1 } = await admin
    .from("cadence_run")
    .select("id, cadence_step_id, scheduled_for")
    .eq("clinic_id", clinicId)
    .eq("appointment_id", appt1)
    .throwOnError();
  ok(
    "planner criou exatamente 1 run (toque de 24h)",
    (runs1 ?? []).length === 1,
    runs1,
  );

  // chamar o planner de novo NÃO duplica
  await admin.rpc("planejar_reguas").throwOnError();
  const { count: runs1b } = await admin
    .from("cadence_run")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("appointment_id", appt1);
  ok("planner repetido não duplica a run", runs1b === 1, runs1b);

  // o worker de verdade pega o job e envia
  const enviada = await poll("worker enviar o toque de 24h", async () => {
    const { data } = await admin
      .from("cadence_run")
      .select("sent_at, message_id")
      .eq("clinic_id", clinicId)
      .eq("appointment_id", appt1)
      .single();
    return data?.sent_at ? data : null;
  });
  ok(
    "worker enviou o toque (sent_at + message_id)",
    Boolean(enviada?.message_id),
    enviada,
  );

  if (enviada?.message_id) {
    const { data: msg } = await admin
      .from("message")
      .select("body, direction, author, billable, cost_cents, job_id")
      .eq("id", enviada.message_id as string)
      .single();
    ok(
      "mensagem gravada como saída do sistema",
      msg?.direction === "saida" && msg?.author === "sistema",
      msg,
    );
    ok(
      "custo zero e não faturável no canal atual",
      msg?.billable === false && msg?.cost_cents === 0,
      msg,
    );
    ok(
      "modelo preenchido (sem chaves soltas)",
      Boolean(msg?.body) && !String(msg?.body).includes("{{"),
      msg?.body,
    );
    ok(
      "corpo carrega o preparo do procedimento",
      String(msg?.body ?? "").includes("Venha sem maquiagem"),
      msg?.body,
    );
    ok(
      "corpo carrega as 3 opções numeradas",
      ["1. Confirmar", "2. Remarcar", "3. Cancelar"].every((o) =>
        String(msg?.body ?? "").includes(o),
      ),
      msg?.body,
    );
  }

  const { data: apos } = await admin
    .from("appointment")
    .select("status")
    .eq("id", appt1)
    .single();
  ok(
    "status virou aguardando_confirmacao",
    apos?.status === "aguardando_confirmacao",
    apos,
  );

  const { data: convApos } = await admin
    .from("conversation")
    .select("id, status, awaiting_reply, unread_count")
    .eq("clinic_id", clinicId)
    .eq("contact_id", c1)
    .single();
  ok(
    "conversa aberta pela régua NÃO conta como esperando resposta",
    convApos?.awaiting_reply === false,
    convApos,
  );

  // ---------- 2. resposta "1" pelo webhook HTTP real ----------
  const resposta = await fetch(
    `http://localhost:3000/api/webhooks/whatsapp?clinic=${clinicId}&secret=${encodeURIComponent(secret)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "message_received",
        phone: telefone1,
        waMessageId: `prova-viva-${sufixo}-1`,
        contentType: "texto",
        body: "1",
      }),
    },
  );
  ok("webhook aceitou a resposta do paciente (200)", resposta.status === 200, {
    status: resposta.status,
    body: await resposta.text(),
  });

  const confirmada = await poll(
    "confirmação refletir na agenda",
    async () => {
      const { data } = await admin
        .from("appointment")
        .select("status, confirmation_channel")
        .eq("id", appt1)
        .single();
      return data?.status === "confirmado_paciente" ? data : null;
    },
    30_000,
  );
  ok(
    "paciente respondeu 1 e o status mudou sozinho",
    confirmada?.status === "confirmado_paciente",
    confirmada,
  );
  ok(
    "canal de confirmação registrado como whatsapp",
    confirmada?.confirmation_channel === "whatsapp",
    confirmada,
  );

  const { data: trilha } = await admin
    .from("appointment_status_history")
    .select("status, changed_by")
    .eq("appointment_id", appt1)
    .order("changed_at");
  // A primeira linha e 'agendado:usuario', gravada na criacao da consulta.
  ok(
    "trilha registra sistema depois paciente",
    JSON.stringify((trilha ?? []).map((t) => `${t.status}:${t.changed_by}`)) ===
      JSON.stringify([
        "agendado:usuario",
        "aguardando_confirmacao:sistema",
        "confirmado_paciente:paciente",
      ]),
    trilha,
  );

  const eco = await poll(
    "eco de confirmação sair para o paciente",
    async () => {
      const { data } = await admin
        .from("message")
        .select("id, body")
        .eq("clinic_id", clinicId)
        .eq("direction", "saida")
        .ilike("body", "%confirmad%")
        .neq(
          "id",
          enviada?.message_id ?? "00000000-0000-0000-0000-000000000000",
        );
      return (data ?? []).length > 0 ? data![0] : null;
    },
    60_000,
  );
  ok("eco de agradecimento enviado", Boolean(eco), eco);

  const { data: convFinal } = await admin
    .from("conversation")
    .select("awaiting_reply")
    .eq("clinic_id", clinicId)
    .eq("contact_id", c1)
    .single();
  ok(
    "máquina resolveu sozinha: conversa fora do contador",
    convFinal?.awaiting_reply === false,
    convFinal,
  );

  // responder "1" de novo não confirma duas vezes nem manda dois ecos
  await fetch(
    `http://localhost:3000/api/webhooks/whatsapp?clinic=${clinicId}&secret=${encodeURIComponent(secret)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "message_received",
        phone: telefone1,
        waMessageId: `prova-viva-${sufixo}-2`,
        contentType: "texto",
        body: "1",
      }),
    },
  );
  await new Promise((r) => setTimeout(r, 4000));
  const { count: trilhaDepois } = await admin
    .from("appointment_status_history")
    .select("id", { count: "exact", head: true })
    .eq("appointment_id", appt1);
  ok(
    "responder de novo não grava segunda confirmação",
    trilhaDepois === 3,
    trilhaDepois,
  );

  // ---------- 2b. o canal real: reação e botão ----------
  const postar = (corpo: Record<string, unknown>) =>
    fetch(
      `http://localhost:3000/api/webhooks/whatsapp?clinic=${clinicId}&secret=${encodeURIComponent(secret)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      },
    );

  // Uma segunda consulta pendente para os testes de resposta.
  // Uma hora depois da primeira: mesma profissional, e o banco recusa
  // sobreposicao (exclusion constraint sem_sobreposicao_profissional).
  const inicio1b = new Date(Date.now() + 1500 * MIN);
  const { data: consulta1b } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicId,
      contact_id: c1,
      professional_id: prof!.id,
      service_link_id: vinc!.id,
      starts_at: inicio1b.toISOString(),
      ends_at: new Date(inicio1b.getTime() + 30 * MIN).toISOString(),
      status: "aguardando_confirmacao",
    })
    .select("id")
    .single()
    .throwOnError();
  const appt1b = consulta1b!.id as string;
  const { data: passo24 } = await admin
    .from("cadence_step")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("offset_minutes", -1440)
    .single()
    .throwOnError();
  await admin
    .from("cadence_run")
    .insert({
      clinic_id: clinicId,
      cadence_step_id: passo24!.id,
      contact_id: c1,
      appointment_id: appt1b,
      scheduled_for: new Date(inicio1b.getTime() - 1440 * MIN).toISOString(),
      sent_at: new Date().toISOString(),
    })
    .throwOnError();

  // REAÇÃO de joinha (formato uazapi) não pode confirmar nada.
  await postar({
    EventType: "messages",
    token: "x",
    message: {
      messageid: `prova-reacao-${sufixo}`,
      chatid: `${telefone1.slice(1)}@s.whatsapp.net`,
      sender_pn: `${telefone1.slice(1)}@s.whatsapp.net`,
      messageType: "reaction",
      text: "👍",
    },
  });
  await new Promise((r) => setTimeout(r, 2500));
  const { data: aposReacao } = await admin
    .from("appointment")
    .select("status")
    .eq("id", appt1b)
    .single();
  ok(
    "reação de joinha NÃO confirma a consulta",
    aposReacao?.status === "aguardando_confirmacao",
    aposReacao,
  );

  // BOTÃO sem texto: a escolha vem em buttonOrListid.
  await postar({
    EventType: "messages",
    token: "x",
    message: {
      messageid: `prova-botao-${sufixo}`,
      chatid: `${telefone1.slice(1)}@s.whatsapp.net`,
      sender_pn: `${telefone1.slice(1)}@s.whatsapp.net`,
      text: "",
      buttonOrListid: "confirmar",
    },
  });
  const porBotao = await poll(
    "botão confirmar refletir na agenda",
    async () => {
      const { data } = await admin
        .from("appointment")
        .select("status")
        .eq("id", appt1b)
        .single();
      return data?.status === "confirmado_paciente" ? data : null;
    },
    30_000,
  );
  ok(
    "toque no botão Confirmar muda o status",
    porBotao?.status === "confirmado_paciente",
    porBotao,
  );

  // Recepcionista respondendo pelo celular pareado derruba a espera.
  await admin
    .from("conversation")
    .update({ awaiting_reply: true })
    .eq("clinic_id", clinicId)
    .eq("contact_id", c1)
    .throwOnError();
  await postar({
    EventType: "messages",
    token: "x",
    message: {
      messageid: `prova-fromme-${sufixo}`,
      chatid: `${telefone1.slice(1)}@s.whatsapp.net`,
      sender_pn: "5584911112222@s.whatsapp.net",
      fromMe: true,
      text: "Já te respondo!",
    },
  });
  await new Promise((r) => setTimeout(r, 2000));
  const { data: convCelular } = await admin
    .from("conversation")
    .select("awaiting_reply")
    .eq("clinic_id", clinicId)
    .eq("contact_id", c1)
    .single();
  ok(
    "resposta pelo celular da clínica tira a conversa da espera",
    convCelular?.awaiting_reply === false,
    convCelular,
  );

  // Cobrar agora com o canal fora do ar recusa em vez de prometer.
  await admin
    .from("whatsapp_account")
    .update({ connection_status: "desconectado" })
    .eq("clinic_id", clinicId)
    .throwOnError();
  const { planejarCobrancaManual } =
    await import("../../lib/jobs/cobranca-manual");
  const recusa = await planejarCobrancaManual(admin, admin, {
    clinicId,
    timezone: clinica!.timezone as string,
    appointmentIds: [appt1b],
  });
  ok(
    "cobrar agora recusa com WhatsApp desconectado",
    recusa.ok === false && /desconectado/i.test(recusa.error ?? ""),
    recusa,
  );
  await admin
    .from("whatsapp_account")
    .update({ connection_status: "conectado" })
    .eq("clinic_id", clinicId)
    .throwOnError();

  // ---------- 3. pós-falta: D+0 com a data, nunca "hoje" ----------
  await admin
    .from("cadence")
    .update({
      send_window_start: "00:00",
      send_window_end: "23:59",
      send_weekdays: [0, 1, 2, 3, 4, 5, 6],
      active: true,
    })
    .eq("id", reguaFalta.id)
    .throwOnError();

  const inicio2 = new Date(Date.now() - 3 * 24 * 60 * MIN); // consulta 3 dias atrás
  const { data: consulta2 } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicId,
      contact_id: c2,
      professional_id: prof!.id,
      service_link_id: vinc!.id,
      starts_at: inicio2.toISOString(),
      ends_at: new Date(inicio2.getTime() + 30 * MIN).toISOString(),
      status: "compareceu",
    })
    .select("id")
    .single()
    .throwOnError();
  const appt2 = consulta2!.id as string;
  // falta marcada AGORA, por gente, dias depois da consulta (o caso do texto)
  await admin
    .from("appointment")
    .update({ status: "faltou" })
    .eq("id", appt2)
    .throwOnError();
  await admin
    .from("appointment_status_history")
    .insert({
      clinic_id: clinicId,
      appointment_id: appt2,
      status: "faltou",
      changed_by: "usuario",
      changed_at: new Date(Date.now() - 2 * MIN).toISOString(),
    })
    .throwOnError();

  await admin.rpc("planejar_reguas").throwOnError();
  const toqueFalta = await poll(
    "worker enviar o toque D+0 de pós-falta",
    async () => {
      const { data } = await admin
        .from("cadence_run")
        .select("sent_at, message_id, skipped_reason")
        .eq("clinic_id", clinicId)
        .eq("appointment_id", appt2)
        .not("sent_at", "is", null)
        .limit(1);
      return (data ?? []).length > 0 ? data![0] : null;
    },
  );
  ok(
    "pós-falta: toque D+0 enviado",
    Boolean(toqueFalta?.message_id),
    toqueFalta,
  );
  if (toqueFalta?.message_id) {
    const { data: msgFalta } = await admin
      .from("message")
      .select("body")
      .eq("id", toqueFalta.message_id as string)
      .single();
    const dataConsulta = inicio2.toLocaleDateString("pt-BR", {
      timeZone: clinica!.timezone as string,
    });
    ok(
      "texto cita a DATA da consulta",
      String(msgFalta?.body ?? "").includes(dataConsulta),
      { body: msgFalta?.body, esperado: dataConsulta },
    );
    ok(
      "texto NÃO diz 'hoje'",
      !/\bhoje\b/i.test(String(msgFalta?.body ?? "")),
      msgFalta?.body,
    );
  }
} finally {
  if (clinicId) {
    await admin.from("clinic").delete().eq("id", clinicId);
    console.log("(clínica descartável apagada)");
  }
}

console.log(
  falhas.length === 0
    ? "\nPROVA VIVA: TUDO PASSOU"
    : `\nPROVA VIVA: ${falhas.length} FALHAS:\n- ${falhas.join("\n- ")}`,
);
process.exit(falhas.length === 0 ? 0 : 1);
