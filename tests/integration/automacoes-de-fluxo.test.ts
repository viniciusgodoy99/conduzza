import { afterAll, describe, expect, it } from "vitest";

import { diaCivil, somarDias } from "@/lib/domain/horarios";
import { ingerirMensagemRecebida } from "@/lib/integrations/whatsapp/ingest";
import type { InboundEvent } from "@/lib/integrations/whatsapp/inbound";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Automacoes de fluxo (Leva B, migration 20261002130000) contra o banco
// REAL, com service role. O que so a integracao prova: os gatilhos que
// registram (entrada na etapa e mensagem recebida, inclusive pela ingestao
// de verdade com o termo-chave), a varredura dos gatilhos de tempo e o
// executor, cada um na sua transacao (o now() muda entre as chamadas, como
// no pg_cron).
//
// Clinicas com e_de_teste=true: o motor padrao (p_incluir_teste=false) as
// ignora, entao o cron de producao nao compete com os cenarios; cada um
// chama planejar/executar com p_clinic_id e p_incluir_teste=true. Os
// relogios (entrada na etapa, vigente_desde da regra, nascimento do contato)
// sao recuados pelo servico, que e livre para isso.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];
const usuariosCriados: string[] = [];
const HORA_MS = 60 * 60_000;

type MensagemRecebida = Extract<InboundEvent, { kind: "message_received" }>;
type Resultado = {
  executadas: number;
  puladas: number;
  falhas: number;
  adiadas: number;
};
type Execucao = {
  contact_id: string;
  status: string;
  motivo: string | null;
  de_etapa: string;
  para_etapa: string | null;
  profundidade: number;
  conversation_id: string | null;
  atividade_id: string | null;
  message_id: string | null;
  devida_em: string;
  // O retrato do que a regra fez nesta execucao (so em executada).
  acao: string | null;
  etiqueta: string | null;
  etiqueta_nome: string | null;
};

const atras = (horas: number) =>
  new Date(Date.now() - horas * HORA_MS).toISOString();

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Fluxo ${nome} ${sufixo}`,
      slug: `fluxo-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  return clinicId;
}

async function criarEtapas(clinicId: string, chaves: string[]): Promise<void> {
  await admin
    .from("funnel_stage_def")
    .insert(
      chaves.map((chave, i) => ({
        clinic_id: clinicId,
        chave,
        nome: `Etapa ${chave}`,
        posicao: 61 + i,
      })),
    )
    .throwOnError();
}

/** Lead nascido ha 30 dias, na etapa ha `horas` horas. */
async function novoLead(
  clinicId: string,
  telefone: string,
  etapa: string,
  horas: number,
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Lead Fluxo",
      kind: "lead",
      funnel_stage: etapa,
    })
    .select("id")
    .single()
    .throwOnError();
  const contactId = data!.id as string;
  await admin
    .from("contact")
    .update({
      created_at: atras(30 * 24),
      funnel_stage_changed_at: atras(horas),
    })
    .eq("id", contactId)
    .throwOnError();
  return contactId;
}

async function novaConversa(
  clinicId: string,
  contactId: string,
  numeroId: string,
  ultimaHaHoras: number,
  atendente: string | null = null,
): Promise<string> {
  const { data } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      whatsapp_account_id: numeroId,
      last_message_at: atras(ultimaHaHoras),
      assignee_user_id: atendente,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

/** Regra criada pelo servico; vigente_desde recuado quando pedido. */
async function novaRegra(
  campos: Record<string, unknown>,
  vigenteHaHoras?: number,
): Promise<string> {
  const { data } = await admin
    .from("automacao_fluxo")
    .insert({ ativa: true, ...campos })
    .select("id")
    .single()
    .throwOnError();
  const regraId = data!.id as string;
  if (vigenteHaHoras !== undefined) {
    await admin
      .from("automacao_fluxo")
      .update({ vigente_desde: atras(vigenteHaHoras) })
      .eq("id", regraId)
      .throwOnError();
  }
  return regraId;
}

async function mover(contactId: string, etapa: string): Promise<void> {
  await admin
    .from("contact")
    .update({ funnel_stage: etapa })
    .eq("id", contactId)
    .throwOnError();
}

async function etapaDe(contactId: string): Promise<string> {
  const { data } = await admin
    .from("contact")
    .select("funnel_stage")
    .eq("id", contactId)
    .single()
    .throwOnError();
  return data!.funnel_stage as string;
}

async function planejar(clinicId: string): Promise<number> {
  const { data, error } = await admin.rpc("planejar_automacoes_de_fluxo", {
    p_clinic_id: clinicId,
    p_incluir_teste: true,
  });
  expect(error).toBeNull();
  return data as number;
}

async function executar(clinicId: string): Promise<Resultado> {
  const { data, error } = await admin.rpc("executar_automacoes_de_fluxo", {
    p_clinic_id: clinicId,
    p_incluir_teste: true,
  });
  expect(error).toBeNull();
  return data as Resultado;
}

async function execucoes(regraId: string): Promise<Execucao[]> {
  const { data } = await admin
    .from("automacao_execucao")
    .select(
      "contact_id, status, motivo, de_etapa, para_etapa, profundidade, conversation_id, atividade_id, message_id, devida_em, acao, etiqueta, etiqueta_nome",
    )
    .eq("automacao_id", regraId)
    .order("created_at")
    .throwOnError();
  return (data ?? []) as Execucao[];
}

function evento(
  phone: string,
  waMessageId: string,
  body: string,
): MensagemRecebida {
  return {
    kind: "message_received",
    phone,
    name: "Paciente Fluxo",
    waMessageId,
    contentType: "texto",
    body,
    mediaUrl: null,
    mediaFilename: null,
    mediaMimetype: null,
    quotedWaMessageId: null,
    anuncio: null,
    instanceToken: null,
  };
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
  for (const usuario of usuariosCriados) {
    await admin.auth.admin.deleteUser(usuario);
  }
});

describe("entrou na etapa", () => {
  it("etiqueta a conversa mais recente, uma vez por entrada, com trilha de sistema", async () => {
    const clinicId = await criarClinica("entrada");
    const numero1 = (await criarNumeroDeTeste(admin, clinicId)).id;
    const numero2 = (
      await criarNumeroDeTeste(admin, clinicId, { nome: "Segundo" })
    ).id;
    const regra = await novaRegra({
      clinic_id: clinicId,
      nome: "Etiquetar ao entrar em contato",
      gatilho: "entrou_na_etapa",
      etapa: "em_contato",
      acao: "etiquetar",
      etiqueta: "urgente",
    });
    const lead = await novoLead(clinicId, "+5584975100001", "novo", 24);
    const velha = await novaConversa(clinicId, lead, numero1, 48);
    const nova = await novaConversa(clinicId, lead, numero2, 1);

    await mover(lead, "em_contato");
    expect(await execucoes(regra)).toMatchObject([
      { contact_id: lead, status: "pendente", profundidade: 0 },
    ]);

    const resultado = await executar(clinicId);
    expect(resultado).toMatchObject({ executadas: 1, falhas: 0 });
    const { data: conversas } = await admin
      .from("conversation")
      .select("id, tags")
      .in("id", [velha, nova])
      .throwOnError();
    const tags = new Map(conversas!.map((c) => [c.id as string, c.tags]));
    expect(tags.get(nova)).toEqual(["urgente"]);
    expect(tags.get(velha)).toEqual([]);

    const { data: trilhas } = await admin
      .from("audit_log")
      .select("user_id")
      .eq("clinic_id", clinicId)
      .eq("action", "automacao_etiquetou")
      .eq("entity_id", nova)
      .throwOnError();
    expect(trilhas).toEqual([{ user_id: null }]);

    // O retrato do que a regra fez NA HORA: acao, chave e nome da etiqueta.
    const { data: etiquetaDaHora } = await admin
      .from("conversation_tag_def")
      .select("nome")
      .eq("clinic_id", clinicId)
      .eq("chave", "urgente")
      .single()
      .throwOnError();
    const retrato = {
      status: "executada",
      acao: "etiquetar",
      etiqueta: "urgente",
      etiqueta_nome: etiquetaDaHora!.nome,
    };
    expect(await execucoes(regra)).toMatchObject([retrato]);
    // Editar a regra (outra acao) e renomear a etiqueta depois nao reescreve
    // o historico: a execucao continua contando o que aconteceu.
    await admin
      .from("automacao_fluxo")
      .update({
        acao: "nota_interna",
        etiqueta: null,
        nota_texto: "Conferir o convênio.",
      })
      .eq("id", regra)
      .throwOnError();
    await admin
      .from("conversation_tag_def")
      .update({ nome: `Renomeada ${sufixo}` })
      .eq("clinic_id", clinicId)
      .eq("chave", "urgente")
      .throwOnError();
    expect(await execucoes(regra)).toMatchObject([retrato]);
    await admin
      .from("automacao_fluxo")
      .update({ acao: "etiquetar", etiqueta: "urgente", nota_texto: null })
      .eq("id", regra)
      .throwOnError();

    // mexer no contato sem mudar de etapa nao e outra entrada
    await admin
      .from("contact")
      .update({ name: "Renomeado", funnel_stage: "em_contato" })
      .eq("id", lead)
      .throwOnError();
    expect(await executar(clinicId)).toMatchObject({ executadas: 0 });
    expect(await execucoes(regra)).toHaveLength(1);
  });
});

describe("tempo na etapa", () => {
  it("nao e retroativo, e o movimento humano vence a automacao (CAS)", async () => {
    const clinicId = await criarClinica("tempo");
    await criarEtapas(clinicId, ["parado", "destino"]);
    const regra = await novaRegra(
      {
        clinic_id: clinicId,
        nome: "Parado uma hora",
        gatilho: "tempo_na_etapa",
        etapa: "parado",
        espera_minutos: 60,
        acao: "mover_etapa",
        etapa_destino: "destino",
      },
      2,
    );
    const velho = await novoLead(clinicId, "+5584975200001", "parado", 5);
    const vencido = await novoLead(clinicId, "+5584975200002", "parado", 1.5);
    const humano = await novoLead(clinicId, "+5584975200003", "parado", 1.5);
    const voltou = await novoLead(clinicId, "+5584975200004", "parado", 1.5);
    const cedo = await novoLead(clinicId, "+5584975200005", "parado", 0.5);

    expect(await planejar(clinicId)).toBe(3);
    expect(await planejar(clinicId)).toBe(0);

    // a pessoa mexe entre o planejamento e a execucao
    await mover(humano, "em_contato");
    await mover(voltou, "em_contato");
    await mover(voltou, "parado");

    expect(await executar(clinicId)).toMatchObject({
      executadas: 1,
      puladas: 2,
      falhas: 0,
    });
    const porContato = new Map(
      (await execucoes(regra)).map((e) => [e.contact_id, e]),
    );
    expect(porContato.has(velho)).toBe(false);
    expect(porContato.has(cedo)).toBe(false);
    expect(porContato.get(vencido)).toMatchObject({
      status: "executada",
      de_etapa: "parado",
      para_etapa: "destino",
      acao: "mover_etapa",
      etiqueta: null,
      etiqueta_nome: null,
    });
    // Pulada nao tem retrato: nao fez nada.
    expect(porContato.get(humano)).toMatchObject({
      status: "pulada",
      motivo: "etapa_mudou",
      acao: null,
    });
    expect(porContato.get(voltou)).toMatchObject({
      status: "pulada",
      motivo: "etapa_mudou",
    });
    expect(await etapaDe(vencido)).toBe("destino");
    expect(await etapaDe(humano)).toBe("em_contato");
    expect(await etapaDe(voltou)).toBe("parado");
    expect(await etapaDe(velho)).toBe("parado");

    const { data: trilhas } = await admin
      .from("audit_log")
      .select("user_id")
      .eq("action", "automacao_moveu_etapa")
      .eq("entity_id", vencido)
      .throwOnError();
    expect(trilhas).toEqual([{ user_id: null }]);
  });

  it("vai para Perdido com o motivo da regra e pula quem tem consulta futura", async () => {
    const clinicId = await criarClinica("perdido");
    await criarEtapas(clinicId, ["sumido"]);
    const { data: prof } = await admin
      .from("professional")
      .insert({ clinic_id: clinicId, name: "Dra. Fluxo" })
      .select("id")
      .single()
      .throwOnError();
    const { data: proc } = await admin
      .from("procedure")
      .insert({
        clinic_id: clinicId,
        name: "Avaliação",
        base_price_cents: 10000,
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
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const regra = await novaRegra(
      {
        clinic_id: clinicId,
        nome: "Sumiu, perdido",
        gatilho: "tempo_na_etapa",
        etapa: "sumido",
        espera_minutos: 60,
        acao: "mover_etapa",
        etapa_destino: "perdido",
        motivo_perda: "nao_respondeu",
      },
      24,
    );
    const sumido = await novoLead(clinicId, "+5584975300001", "sumido", 2);
    const comConsulta = await novoLead(clinicId, "+5584975300002", "novo", 2);
    const inicio = new Date(Date.now() + 2 * 24 * HORA_MS);
    await admin
      .from("appointment")
      .insert({
        clinic_id: clinicId,
        contact_id: comConsulta,
        professional_id: prof!.id,
        service_link_id: vinculo!.id,
        starts_at: inicio.toISOString(),
        ends_at: new Date(inicio.getTime() + 30 * 60_000).toISOString(),
      })
      .throwOnError();
    // a consulta converte em paciente e move para Agendou; o cenario precisa
    // de um LEAD com consulta futura, parado em "sumido"
    await admin
      .from("contact")
      .update({ kind: "lead", funnel_stage: "sumido", lost_reason: null })
      .eq("id", comConsulta)
      .throwOnError();
    await admin
      .from("contact")
      .update({ funnel_stage_changed_at: atras(2) })
      .eq("id", comConsulta)
      .throwOnError();

    expect(await planejar(clinicId)).toBe(2);
    await executar(clinicId);

    const { data: perdido } = await admin
      .from("contact")
      .select("funnel_stage, lost_reason, lost_reason_note")
      .eq("id", sumido)
      .single()
      .throwOnError();
    expect(perdido).toEqual({
      funnel_stage: "perdido",
      lost_reason: "nao_respondeu",
      lost_reason_note: null,
    });
    const porContato = new Map(
      (await execucoes(regra)).map((e) => [e.contact_id, e]),
    );
    expect(porContato.get(comConsulta)).toMatchObject({
      status: "pulada",
      motivo: "tem_consulta_futura",
    });
    expect(await etapaDe(comConsulta)).toBe("sumido");
  });
});

describe("sem resposta na etapa", () => {
  it("cria a atividade com prazo no fuso da clinica e o responsavel da conversa", async () => {
    const clinicId = await criarClinica("silencio");
    const fuso = "Pacific/Kiritimati";
    await admin
      .from("clinic")
      .update({ timezone: fuso })
      .eq("id", clinicId)
      .throwOnError();
    await criarEtapas(clinicId, ["silencio"]);
    const numero = (await criarNumeroDeTeste(admin, clinicId)).id;
    const { data: usuario } = await admin.auth.admin.createUser({
      email: `fluxo-silencio-${sufixo}@teste.dev`,
      password: `Fluxo!${sufixo}2026`,
      email_confirm: true,
    });
    const atendente = usuario.user!.id;
    usuariosCriados.push(atendente);
    await admin
      .from("clinic_member")
      .insert({ clinic_id: clinicId, user_id: atendente, role: "recepcao" })
      .throwOnError();
    const regra = await novaRegra(
      {
        clinic_id: clinicId,
        nome: "Duas horas sem resposta",
        gatilho: "sem_resposta_na_etapa",
        etapa: "silencio",
        espera_minutos: 120,
        acao: "criar_atividade",
        atividade_titulo: "Ligar para o lead",
        atividade_prazo_dias: 2,
      },
      5,
    );
    // calado ha 3 h (vence), escreveu ha 30 min (nao vence)
    const calado = await novoLead(clinicId, "+5584975400001", "silencio", 10);
    const falou = await novoLead(clinicId, "+5584975400002", "silencio", 10);
    await admin
      .from("contact")
      .update({ last_contact_at: atras(3) })
      .eq("id", calado)
      .throwOnError();
    await admin
      .from("contact")
      .update({ last_contact_at: atras(0.5) })
      .eq("id", falou)
      .throwOnError();
    const conversa = await novaConversa(clinicId, calado, numero, 3, atendente);

    expect(await planejar(clinicId)).toBe(1);
    expect(await executar(clinicId)).toMatchObject({ executadas: 1 });

    const [execucao] = await execucoes(regra);
    expect(execucao).toMatchObject({
      contact_id: calado,
      status: "executada",
      acao: "criar_atividade",
      etiqueta: null,
    });
    const { data: atividade } = await admin
      .from("contact_activity")
      .select(
        "titulo, due_on, due_at, origem, automacao_id, created_by, assignee_user_id, conversation_id, status",
      )
      .eq("id", execucao!.atividade_id!)
      .single()
      .throwOnError();
    expect(atividade).toEqual({
      titulo: "Ligar para o lead",
      due_on: somarDias(diaCivil(fuso, new Date()), 2),
      due_at: null,
      origem: "automacao",
      automacao_id: regra,
      created_by: null,
      assignee_user_id: atendente,
      conversation_id: conversa,
      status: "pendente",
    });

    // apagar a regra mantem a atividade, sem a regra
    await admin.from("automacao_fluxo").delete().eq("id", regra).throwOnError();
    const { data: depois } = await admin
      .from("contact_activity")
      .select("automacao_id, origem")
      .eq("id", execucao!.atividade_id!)
      .single()
      .throwOnError();
    expect(depois).toEqual({ automacao_id: null, origem: "automacao" });
  });
});

describe("nota interna", () => {
  it("cai na conversa mais recente como nota do sistema; sem conversa e pulada", async () => {
    const clinicId = await criarClinica("nota");
    await criarEtapas(clinicId, ["avaliacao"]);
    const numero = (await criarNumeroDeTeste(admin, clinicId)).id;
    const texto = "Lead chegou na avaliação. Conferir o convênio.";
    const regra = await novaRegra({
      clinic_id: clinicId,
      nome: "Nota ao entrar na avaliação",
      gatilho: "entrou_na_etapa",
      etapa: "avaliacao",
      acao: "nota_interna",
      nota_texto: texto,
    });
    const comConversa = await novoLead(clinicId, "+5584975500001", "novo", 24);
    const conversa = await novaConversa(clinicId, comConversa, numero, 1);
    const semConversa = await novoLead(clinicId, "+5584975500002", "novo", 24);
    await mover(comConversa, "avaliacao");
    await mover(semConversa, "avaliacao");

    expect(await executar(clinicId)).toMatchObject({
      executadas: 1,
      puladas: 1,
    });
    const { data: notas } = await admin
      .from("message")
      .select(
        "author, author_user_id, direction, is_internal_note, body, whatsapp_account_id",
      )
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(notas).toEqual([
      {
        author: "sistema",
        author_user_id: null,
        direction: "saida",
        is_internal_note: true,
        body: texto,
        whatsapp_account_id: numero,
      },
    ]);
    const porContato = new Map(
      (await execucoes(regra)).map((e) => [e.contact_id, e]),
    );
    expect(porContato.get(semConversa)).toMatchObject({
      status: "pulada",
      motivo: "sem_conversa",
      acao: null,
    });
    expect(porContato.get(comConversa)).toMatchObject({
      status: "executada",
      acao: "nota_interna",
      etiqueta: null,
    });
  });
});

describe("mensagem recebida", () => {
  it("ignora a primeira fala do contato novo, registra uma vez por entrada e o termo-chave vence", async () => {
    const clinicId = await criarClinica("mensagem");
    await criarEtapas(clinicId, ["respondeu"]);
    await criarNumeroDeTeste(admin, clinicId);
    await admin
      .from("funnel_stage_def")
      .update({ termos_chave: ["quero agendar"] })
      .eq("clinic_id", clinicId)
      .eq("chave", "em_contato")
      .throwOnError();
    const regra = await novaRegra({
      clinic_id: clinicId,
      nome: "Escreveu em Novo",
      gatilho: "mensagem_recebida",
      etapa: "novo",
      acao: "mover_etapa",
      etapa_destino: "respondeu",
    });

    // contato novo pelo WhatsApp: a primeira mensagem nao dispara
    const { data: primeira } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584975600001", `fluxo:${sufixo}:p1`, "Oi"),
    );
    expect(primeira?.contact_created).toBe(true);
    expect(await execucoes(regra)).toHaveLength(0);

    // A rajada da primeira fala: a segunda mensagem chega em OUTRA chamada
    // (outra transacao, o contato ja nasceu na anterior) e tambem nao conta,
    // porque chega nos 2 minutos seguintes ao nascimento do contato.
    const { data: segunda } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584975600001", `fluxo:${sufixo}:p2`, "Queria saber o valor"),
    );
    expect(segunda?.contact_created).toBe(false);
    expect(await execucoes(regra)).toHaveLength(0);

    // Passados os 2 minutos (nascimento recuado pelo servico), a mensagem
    // seguinte do mesmo contato ja conta.
    const novoContato = primeira!.contact_id!;
    await admin
      .from("contact")
      .update({ created_at: new Date(Date.now() - 3 * 60_000).toISOString() })
      .eq("id", novoContato)
      .throwOnError();
    await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584975600001", `fluxo:${sufixo}:p3`, "Alguém aí?"),
    );
    expect(await execucoes(regra)).toMatchObject([
      { contact_id: novoContato, status: "pendente" },
    ]);

    // lead que ja existia escreve duas vezes: uma execucao, com 15 s de folga
    const lead = await novoLead(clinicId, "+5584975600002", "novo", 24);
    const { data: m1 } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584975600002", `fluxo:${sufixo}:l1`, "Qual o valor?"),
    );
    await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584975600002", `fluxo:${sufixo}:l2`, "Alô?"),
    );
    const registradas = (await execucoes(regra)).filter(
      (e) => e.contact_id === lead,
    );
    expect(registradas).toHaveLength(1);
    expect(registradas[0]).toMatchObject({
      contact_id: lead,
      status: "pendente",
      message_id: m1!.message_id,
    });
    // A folga medida pelo carimbo do PROPRIO banco: message.created_at e
    // devida_em saem do mesmo now() da transacao da ingestao, entao a
    // diferenca e 15 s exatos (a faixa so absorve o arredondamento de
    // microssegundo). Sem a folga (devida_em = now()) daria 0 e o teste cai;
    // nao depende do relogio da maquina de teste.
    const { data: msg1 } = await admin
      .from("message")
      .select("created_at")
      .eq("id", m1!.message_id)
      .single()
      .throwOnError();
    const folgaMs =
      new Date(registradas[0]!.devida_em).getTime() -
      new Date(msg1!.created_at as string).getTime();
    expect(folgaMs).toBeGreaterThanOrEqual(14_000);
    expect(folgaMs).toBeLessThanOrEqual(16_000);

    // o termo-chave move na propria ingestao, antes da passagem
    const termo = await novoLead(clinicId, "+5584975600003", "novo", 24);
    await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584975600003", `fluxo:${sufixo}:t1`, "Oi, quero agendar"),
    );
    expect(await etapaDe(termo)).toBe("em_contato");

    // vence a folga e roda a passagem
    await admin
      .from("automacao_execucao")
      .update({ devida_em: new Date().toISOString() })
      .eq("automacao_id", regra)
      .eq("status", "pendente")
      .throwOnError();
    await executar(clinicId);
    const porContato = new Map(
      (await execucoes(regra)).map((e) => [e.contact_id, e]),
    );
    expect(porContato.get(lead)).toMatchObject({
      status: "executada",
      para_etapa: "respondeu",
    });
    expect(porContato.get(termo)).toMatchObject({
      status: "pulada",
      motivo: "etapa_mudou",
    });
    expect(await etapaDe(lead)).toBe("respondeu");
    expect(await etapaDe(termo)).toBe("em_contato");
  });
});

describe("travas contra laco", () => {
  it("cascata anda um salto por passagem e para em 3", async () => {
    const clinicId = await criarClinica("cascata");
    await criarEtapas(clinicId, ["e1", "e2", "e3", "e4", "e5"]);
    const regras: string[] = [];
    for (const [de, para] of [
      ["e1", "e2"],
      ["e2", "e3"],
      ["e3", "e4"],
      ["e4", "e5"],
    ] as const) {
      regras.push(
        await novaRegra({
          clinic_id: clinicId,
          nome: `${de} para ${para}`,
          gatilho: "entrou_na_etapa",
          etapa: de,
          acao: "mover_etapa",
          etapa_destino: para,
        }),
      );
    }
    const lead = await novoLead(clinicId, "+5584975700001", "novo", 24);
    await mover(lead, "e1");

    await executar(clinicId);
    expect(await etapaDe(lead)).toBe("e2");
    await executar(clinicId);
    expect(await etapaDe(lead)).toBe("e3");
    await executar(clinicId);
    expect(await etapaDe(lead)).toBe("e4");
    await executar(clinicId);
    expect(await etapaDe(lead)).toBe("e4");
    expect(await execucoes(regras[3]!)).toMatchObject([
      { status: "pulada", motivo: "limite_de_cascata", profundidade: 3 },
    ]);
  });

  it("no maximo 10 movimentos automaticos por lead em 24 h", async () => {
    const clinicId = await criarClinica("teto");
    await criarEtapas(clinicId, ["teto", "teto_destino"]);
    const regra = await novaRegra(
      {
        clinic_id: clinicId,
        nome: "Teto",
        gatilho: "tempo_na_etapa",
        etapa: "teto",
        espera_minutos: 60,
        acao: "mover_etapa",
        etapa_destino: "teto_destino",
      },
      24,
    );
    const lead = await novoLead(clinicId, "+5584975800001", "teto", 2);
    await admin
      .from("automacao_execucao")
      .insert(
        Array.from({ length: 10 }, (_, i) => ({
          clinic_id: clinicId,
          automacao_id: regra,
          contact_id: lead,
          de_etapa: "teto",
          para_etapa: "teto_destino",
          entrada_na_etapa: atras(3 + i / 60),
          devida_em: atras(3),
          status: "executada",
          executada_em: atras(1),
        })),
      )
      .throwOnError();

    expect(await planejar(clinicId)).toBe(1);
    await executar(clinicId);
    const pendente = (await execucoes(regra)).filter(
      (e) => e.status !== "executada",
    );
    expect(pendente).toMatchObject([
      { status: "pulada", motivo: "limite_diario" },
    ]);
    expect(await etapaDe(lead)).toBe("teto");
  });
});

describe("motor_manutencao", () => {
  it("roda as automacoes no proprio bloco, sem acusar erro nelas", async () => {
    const { data, error } = await admin.rpc("motor_manutencao");
    expect(error).toBeNull();
    const resultado = data as {
      automacoes: Record<string, number>;
      erros: string[];
    };
    expect(resultado.automacoes).toHaveProperty("planejadas");
    expect(resultado.automacoes).toHaveProperty("executadas");
    expect(
      resultado.erros.filter((codigo) => codigo.includes("automacoes")),
    ).toEqual([]);
  });
});
