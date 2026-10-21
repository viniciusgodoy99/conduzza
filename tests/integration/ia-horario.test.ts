import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Onda 2, item 7 (migration 20261022110000_ia_horario_publico_e_telefones.sql,
// M2): o horario do assistente decidido no banco, contra o banco REAL, pelo
// cliente de servico (como o webhook, o motor e o executor chegam ao banco).
// O expediente da versao publicada e montado em volta da hora local de
// agora (todos os dias de 00:00 a 23:59 no fuso da clinica; se agora for
// 23:59 em Fortaleza, a clinica fica em Manaus, uma hora antes). O que esta
// em jogo:
// - fora do expediente (24h), a conversa nova do telefone da equipe nasce
//   na IA, como hoje;
// - no expediente, a conversa nova nasce com a equipe, com o evento
//   no_expediente, a linha de espera (ia_conversa_fora_do_horario, origem
//   ingestao) e nenhum job; a conversa que estava na IA vai para a equipe
//   com o evento fora_do_horario e a linha de espera desde a janela que ela
//   tinha (origem turno);
// - a retomada (publicar uma versao em que agora e fora do expediente e
//   chamar ia_retomar_conversas_no_horario(50, true), como a manutencao faz
//   a cada minuto sem a flag de teste): a conversa volta para a IA, com a
//   janela aberta_por horario e o desde da espera, o evento
//   retomou_no_horario e a ultima mensagem do paciente na fila; com resposta
//   da equipe, com responsavel ou resolvida, a linha cai e nada volta;
// - a varredura de 3 minutos (motor_manutencao) nao tira a retomada antes
//   de 3 minutos da retomada, mesmo com a mensagem do paciente antiga;
// - revisao da onda 2: a rajada (a mensagem cuja transacao comecou antes
//   da que criou a conversa fica com created_at antes do desde) entra na
//   janela da retomada; a linha de mais de 24 horas sai mesmo sem a flag
//   de teste (a da clinica que saiu da fase nao fica para sempre).
//
// ESTE BANCO E O DE PRODUCAO: clinica e_de_teste (o motor de producao a
// ignora; a manutencao chama a retomada SEM a flag de teste), apagada no
// afterAll; nenhuma mensagem sai (numero fake, nenhum executor roda aqui).
// O interruptor global NUNCA e tocado. Nada usa a id da salud-care, da
// teste123 nem da Conduzza Teste. Telefones ficticios. A retomada com a
// flag de teste tambem passa pelas linhas de outras clinicas de teste (de
// outra suite rodando junto): as contagens sao conferidas com "pelo menos"
// e o estado de cada conversa desta suite, uma a uma.
// ESCRITO NA ONDA 2 E NAO RODADO por quem escreveu (grava no banco): roda
// depois de aplicar a migration (npm run test:integration -- ia-horario).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'ia-horario-int-%';
//   delete from public.clinic where slug like 'ia-horario-int-%' and e_de_teste;
// e o usuario sintetico 'ia-horario-int-%@teste.dev' pela API de
// administracao.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const telefone = (final: string) => `+558492${final}${digitos}`;

const NO_EXPEDIENTE =
  "O assistente não respondeu: agora é o horário da equipe. Se ninguém da equipe responder, ele assume quando o horário dele começar.";
const FORA_DO_HORARIO =
  "A IA passou a conversa para a equipe: agora está fora do horário escolhido para o assistente.";
const RETOMOU =
  "Começou o horário do assistente: ele assumiu esta conversa, que ninguém da equipe tinha respondido.";

let clinica = "";
let numero = "";
let responsavel = "";
let seq = 0;
const wa = () => `ia-horario-int:${sufixo}:${++seq}`;

type Ingestao = {
  inserted: boolean;
  conversation_id: string | null;
  message_id: string | null;
  contact_id: string | null;
  ia_atendendo?: boolean;
};

type Espera = {
  conversation_id: string;
  contact_id: string;
  phone_key: string;
  whatsapp_account_id: string;
  desde: string;
  origem: string;
};

async function rpcOk<T>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
}

async function ingerir(telefoneE164: string, corpo = "Mensagem sintética") {
  return rpcOk<Ingestao>("ingest_inbound_message", {
    p_clinic_id: clinica,
    p_phone_e164: telefoneE164,
    p_name: "Contato sintético",
    p_wa_message_id: wa(),
    p_content_type: "texto",
    p_body: corpo,
    p_whatsapp_account_id: numero,
  });
}

async function liberar(telefoneE164: string): Promise<void> {
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinica,
    p_telefone_e164: telefoneE164,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_confirmou_aviso_da_openai: true,
  });
}

/** Uma versao publicada nova: 24h, ou fora_expediente com a grade dada. */
async function publicar(aberto: boolean | null): Promise<void> {
  const { data } = await admin
    .from("ai_agent_config")
    .select("version")
    .eq("clinic_id", clinica)
    .order("version", { ascending: false })
    .limit(1)
    .throwOnError();
  const versao = ((data ?? []) as { version: number }[])[0]?.version ?? 0;
  const grade =
    aberto === null
      ? null
      : Object.fromEntries(
          ["dom", "seg", "ter", "qua", "qui", "sex", "sab"].map((dia) => [
            dia,
            { aberto, inicio: "00:00", fim: "23:59" },
          ]),
        );
  await admin
    .from("ai_agent_config")
    .insert({
      clinic_id: clinica,
      version: versao + 1,
      status: "publicada",
      operating_mode: aberto === null ? "24h" : "fora_expediente",
      operating_hours: grade,
    })
    .throwOnError();
}

async function conversa(id: string) {
  const { data } = await admin
    .from("conversation")
    .select("status, assignee_user_id, awaiting_reply")
    .eq("id", id)
    .single()
    .throwOnError();
  return data as {
    status: string;
    assignee_user_id: string | null;
    awaiting_reply: boolean;
  };
}

async function eventos(id: string): Promise<string[]> {
  const { data } = await admin
    .from("message")
    .select("body")
    .eq("conversation_id", id)
    .eq("content_type", "evento")
    .order("created_at")
    .throwOnError();
  return (data as { body: string }[]).map((linha) => linha.body);
}

async function espera(id: string): Promise<Espera | null> {
  const { data } = await admin
    .from("ia_conversa_fora_do_horario")
    .select(
      "conversation_id, contact_id, phone_key, whatsapp_account_id, desde, origem",
    )
    .eq("conversation_id", id)
    .maybeSingle()
    .throwOnError();
  return (data as Espera | null) ?? null;
}

async function janela(id: string) {
  const { data } = await admin
    .from("ia_janela_da_conversa")
    .select("aberta_por, desde, updated_at")
    .eq("conversation_id", id)
    .maybeSingle()
    .throwOnError();
  return data as {
    aberta_por: string;
    desde: string;
    updated_at: string;
  } | null;
}

async function jobsDa(id: string) {
  const { data } = await admin
    .from("job_queue")
    .select("id, status, payload")
    .eq("kind", "responder_com_ia")
    .eq("payload->>conversation_id", id)
    .throwOnError();
  return (data ?? []) as {
    id: string;
    status: string;
    payload: { ultima_mensagem_id?: string };
  }[];
}

const mesmoInstante = (a: string, b: string) =>
  new Date(a).getTime() === new Date(b).getTime();

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .like("slug", "ia-horario-int-%")
    .eq("e_de_teste", true);
  const agoraEmFortaleza = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  const { data: nova } = await admin
    .from("clinic")
    .insert({
      name: `IA horario ${sufixo}`,
      slug: `ia-horario-int-${sufixo}`,
      e_de_teste: true,
      timezone:
        agoraEmFortaleza === "23:59" ? "America/Manaus" : "America/Fortaleza",
    })
    .select("id")
    .single()
    .throwOnError();
  clinica = (nova as { id: string }).id;
  numero = (await criarNumeroDeTeste(admin, clinica, { nome: "Recepção" })).id;

  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinica,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de integracao da onda 2",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinica,
    p_whatsapp_account_id: numero,
    p_ativo: true,
  });
  for (const final of ["1", "2", "3", "4", "5", "6"]) {
    await liberar(telefone(final));
  }
  await publicar(null);

  // A pessoa da equipe que assume uma conversa (so o id; sem sessao).
  const { data: criada, error } = await admin.auth.admin.createUser({
    email: `ia-horario-int-${sufixo}@teste.dev`,
    password: `IaHorario!${sufixo}${digitos}`,
    email_confirm: true,
    user_metadata: { name: "Recepção sintética" },
  });
  if (error || !criada.user) {
    throw new Error(`criar usuario: ${error?.message ?? "sem usuário"}`);
  }
  responsavel = criada.user.id;
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinica,
      user_id: responsavel,
      role: "recepcao",
      status: "ativo",
    })
    .throwOnError();
});

afterAll(async () => {
  if (clinica) {
    await admin.from("clinic").delete().eq("id", clinica);
  }
  if (responsavel) {
    await admin.auth.admin.deleteUser(responsavel);
  }
});

describe("o horario do assistente no banco", () => {
  let naIa = ""; // nasceu na IA no 24h
  let desdeDaJanela = "";
  let nova = ""; // nasceu no expediente
  let ultimaDaNova = "";
  let comEquipe = ""; // alguem da equipe escreveu
  let comResponsavel = "";
  let resolvida = "";
  let rajada = ""; // conversa nova do expediente com a mensagem de antes
  let antesDoDesde = "";

  it("no 24h, a conversa nova do telefone da equipe nasce na IA (como hoje)", async () => {
    const r = await ingerir(telefone("1"), "Oi");
    expect(r.ia_atendendo).toBe(true);
    naIa = r.conversation_id!;
    const aberta = await janela(naIa);
    expect(aberta?.aberta_por).toBe("ingestao");
    desdeDaJanela = aberta!.desde;
    expect(await espera(naIa)).toBeNull();
    expect(
      await rpcOk<string>("ia_horario_do_assistente", { p_clinic_id: clinica }),
    ).toBe("atende");
  });

  it("no expediente, a conversa nova nasce com a equipe: no_expediente, a linha de espera, nenhum job", async () => {
    await publicar(true);
    expect(
      await rpcOk<string>("ia_horario_do_assistente", { p_clinic_id: clinica }),
    ).toBe("no_expediente");
    const r = await ingerir(telefone("2"), "Bom dia, quero saber o preço");
    expect(r.ia_atendendo).toBe(false);
    nova = r.conversation_id!;
    ultimaDaNova = r.message_id!;
    expect((await conversa(nova)).status).toBe("aguardando_humano");
    expect(await eventos(nova)).toEqual([NO_EXPEDIENTE]);
    expect(await janela(nova)).toBeNull();
    const linha = await espera(nova);
    expect(linha).toMatchObject({
      contact_id: r.contact_id,
      phone_key: telefone("2"),
      whatsapp_account_id: numero,
      origem: "ingestao",
    });
    expect(await jobsDa(nova)).toEqual([]);
  });

  it("no expediente, a conversa que estava na IA vai para a equipe: fora_do_horario e a espera desde a janela dela", async () => {
    const r = await ingerir(telefone("1"), "Ainda está aí?");
    expect(r.ia_atendendo).toBe(false);
    expect(r.conversation_id).toBe(naIa);
    expect((await conversa(naIa)).status).toBe("aguardando_humano");
    expect(await eventos(naIa)).toEqual([FORA_DO_HORARIO]);
    const linha = await espera(naIa);
    expect(linha?.origem).toBe("turno");
    expect(mesmoInstante(linha!.desde, desdeDaJanela)).toBe(true);
  });

  it("a rajada: a mensagem de uma transacao que comecou antes da que criou a conversa fica antes do desde", async () => {
    const r = await ingerir(telefone("6"), "Quero marcar");
    expect(r.ia_atendendo).toBe(false);
    rajada = r.conversation_id!;
    const linha = await espera(rajada);
    expect(linha?.origem).toBe("ingestao");
    // Como o webhook gravaria a mensagem da transacao que comecou um
    // segundo antes (o created_at e o now() do inicio dela).
    antesDoDesde = new Date(new Date(linha!.desde).getTime() - 1000).toISOString();
    await admin
      .from("message")
      .insert({
        clinic_id: clinica,
        conversation_id: rajada,
        direction: "entrada",
        author: "paciente",
        content_type: "texto",
        body: "Mensagem sintética da rajada",
        created_at: antesDoDesde,
      })
      .throwOnError();
  });

  it("com resposta da equipe, com responsavel ou resolvida, a linha cai na retomada e nada volta", async () => {
    // Tres conversas novas no expediente (com a linha de espera).
    comEquipe = (await ingerir(telefone("3"))).conversation_id!;
    comResponsavel = (await ingerir(telefone("4"))).conversation_id!;
    resolvida = (await ingerir(telefone("5"))).conversation_id!;
    for (const id of [comEquipe, comResponsavel, resolvida]) {
      expect((await espera(id))?.origem).toBe("ingestao");
    }
    // Alguem respondeu pelo celular (author usuario); alguem assumiu; uma
    // foi resolvida.
    await admin
      .from("message")
      .insert({
        clinic_id: clinica,
        conversation_id: comEquipe,
        direction: "saida",
        author: "usuario",
        content_type: "texto",
        body: "Resposta sintética da equipe",
        pelo_celular: true,
      })
      .throwOnError();
    await admin
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: responsavel })
      .eq("id", comResponsavel)
      .throwOnError();
    await admin
      .from("conversation")
      .update({ status: "resolvida" })
      .eq("id", resolvida)
      .throwOnError();
  });

  it("no horario do assistente, a retomada poe na IA as que ninguem tocou, com a janela horario e a mensagem na fila", async () => {
    // Ainda no expediente: nada volta.
    const noExpediente = await rpcOk<{ retomadas: number }>(
      "ia_retomar_conversas_no_horario",
      { p_limite: 50, p_incluir_teste: true },
    );
    expect(noExpediente.retomadas).toBeGreaterThanOrEqual(0);
    expect((await conversa(nova)).status).toBe("aguardando_humano");
    expect(await espera(nova)).not.toBeNull();

    // Agora fora do expediente: o assistente atende.
    await publicar(false);
    expect(
      await rpcOk<string>("ia_horario_do_assistente", { p_clinic_id: clinica }),
    ).toBe("atende");
    const resumo = await rpcOk<{
      retomadas: number;
      descartadas: number;
      enfileiradas: number;
      erros_por_linha: number;
    }>("ia_retomar_conversas_no_horario", {
      p_limite: 50,
      p_incluir_teste: true,
    });
    expect(resumo.retomadas).toBeGreaterThanOrEqual(2);
    expect(resumo.descartadas).toBeGreaterThanOrEqual(3);
    expect(resumo.enfileiradas).toBeGreaterThanOrEqual(2);

    for (const id of [nova, naIa]) {
      expect(await conversa(id)).toMatchObject({
        status: "ia_atendendo",
        assignee_user_id: null,
      });
      expect(await espera(id)).toBeNull();
      expect((await eventos(id)).slice(-1)).toEqual([RETOMOU]);
      expect((await janela(id))?.aberta_por).toBe("horario");
    }
    // A janela da conversa que estava na IA le desde a janela que ela tinha.
    expect(mesmoInstante((await janela(naIa))!.desde, desdeDaJanela)).toBe(
      true,
    );
    // A rajada: a janela le desde a primeira mensagem da conversa, entao a
    // mensagem do segundo antes entra (sem isto a IA nao a leria).
    expect((await conversa(rajada)).status).toBe("ia_atendendo");
    const daRajada = await janela(rajada);
    expect(daRajada?.aberta_por).toBe("horario");
    expect(mesmoInstante(daRajada!.desde, antesDoDesde)).toBe(true);
    // A ultima mensagem do paciente da conversa nova esta na fila.
    const naFila = await jobsDa(nova);
    expect(naFila).toHaveLength(1);
    expect(naFila[0]).toMatchObject({ status: "pendente" });
    expect(naFila[0]!.payload.ultima_mensagem_id).toBe(ultimaDaNova);

    // As descartadas: a linha caiu e a conversa ficou como estava.
    expect(await conversa(comEquipe)).toMatchObject({
      status: "aguardando_humano",
    });
    expect(await conversa(comResponsavel)).toMatchObject({
      status: "em_atendimento",
      assignee_user_id: responsavel,
    });
    expect((await conversa(resolvida)).status).toBe("resolvida");
    for (const id of [comEquipe, comResponsavel, resolvida]) {
      expect(await espera(id)).toBeNull();
      expect(await eventos(id)).not.toContain(RETOMOU);
      expect(await jobsDa(id)).toEqual([]);
    }
  });

  it("a varredura de 3 minutos nao tira a retomada antes de 3 minutos da retomada, mesmo com a mensagem antiga", async () => {
    // A mensagem do paciente da conversa nova "de meia hora atras".
    await admin
      .from("conversation")
      .update({
        last_inbound_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      })
      .eq("id", nova)
      .throwOnError();
    const resumo = await rpcOk<{ horario_da_ia?: unknown }>("motor_manutencao");
    expect(resumo.horario_da_ia).toBeDefined();
    expect((await conversa(nova)).status).toBe("ia_atendendo");
  });

  it("a linha de mais de 24 horas sai mesmo sem a flag de teste (a clinica que saiu da fase)", async () => {
    const velha = crypto.randomUUID();
    const umDiaEMeio = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    await admin
      .from("ia_conversa_fora_do_horario")
      .insert({
        conversation_id: velha,
        clinic_id: clinica,
        contact_id: crypto.randomUUID(),
        phone_key: telefone("9"),
        whatsapp_account_id: numero,
        desde: umDiaEMeio,
        origem: "ingestao",
        criada_em: umDiaEMeio,
      })
      .throwOnError();
    // Sem a flag, a clinica de teste nem entra no laco: so a limpeza das
    // 24 horas, que vale para qualquer clinica, apaga a linha.
    const resumo = await rpcOk<{ descartadas: number }>(
      "ia_retomar_conversas_no_horario",
      { p_limite: 50, p_incluir_teste: false },
    );
    expect(resumo.descartadas).toBeGreaterThanOrEqual(1);
    expect(await espera(velha)).toBeNull();
  });
});
