import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { diaCivil, instanteLocal, somarDias } from "@/lib/domain/horarios";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// A IA coloca o paciente na lista de espera (AG5, parte de banco: migration
// 20261029100000_lista_de_espera_pela_ia.sql) contra o banco REAL, pelo
// cliente de servico (o servidor, como o motor da IA chama). O que o ensaio
// nao prova, porque roda numa transacao so (now() fixo) e sem o PostgREST:
// as chamadas por HTTP, com os parametros por nome, em transacoes separadas
// (o instante do pedido, o da pergunta e o do "sim" de verdade).
// - pedir_lista_de_espera_pela_ia: cada recusa na ordem do contrato (22004,
//   22023 job_invalido, a idempotencia e job_de_outro_pedido,
//   preferencia_invalida, pagamento_invalido, cadastro_invalido,
//   ia_desligada, lista_de_espera_desligada, mais_de_uma_unidade,
//   so_com_a_equipe, sem_autorizacao, ja_na_lista com a entrada,
//   menor_de_idade, ja_tem_consulta com o inicio), a normalizacao da
//   preferencia e o pedido que substitui o vivo;
// - entrar_na_lista_de_espera_pela_ia: o caminho feliz de ponta a ponta (o
//   pedido do job J1, a pergunta escrita por J1, o "sim", o job J2 le e
//   entra: a entrada com origem ia, o job, a conversa e o pagamento, o
//   pedido consumido, o evento exato), a idempotencia, sem_pedido_de_espera,
//   a ancora (a automatica no meio, a pergunta de outro job, o "sim" que
//   cita outra mensagem; a pergunta de novo vale), a mensagem nova (R12: a
//   que chegou depois da leitura; a lida pelo turno enviado; a de sem_envio)
//   e ja_na_lista (a recepcao pos no mesmo grupo depois do pedido);
// - a revisao de 28/10/2026: o ja_na_lista de QUALQUER entrada ativa do
//   contato do mesmo procedimento (qualquer profissional) ou de qualquer
//   procedimento, nas duas fases, com a entrada que ja existe
//   ({procedimento, profissional, turnos, dias}); o mesmo job de novo com a
//   entrada removida pela recepcao: sem_pedido_de_espera, nada gravado;
// - marcar_mensagem_tratada_pelo_sistema: 22023, fora_da_ia, marcada e de
//   novo nada, o turno sintetico.
// LIMITE (como na AG4): a pergunta vencida (pedido_vencido, 60 minutos) e o
// envelhecimento do pedido nao se provam aqui sem esperar uma hora (a tabela
// do pedido e so leitura para o servidor); provados no ensaio do harness
// local (passo 9) e na simulacao. Os casos "ao mesmo tempo" (duas fases 2
// da mesma conversa, a fase 2 contra a recepcao, o 23505 que vira
// ja_na_lista) sao do teste de concorrencia do harness, com sessoes de
// verdade, nunca na producao. A marca de outra pessoa (dados informados) so
// grava por registrar_dados_da_marcacao: provada no ensaio (passo 5l).
//
// CUIDADO, o banco e o da producao: a clinica e_de_teste com o slug
// lista-ia-int-*, apagada no afterAll (a fila, os pedidos, as conversas, os
// jobs e as mensagens vao em cascata; o beforeAll apaga a sobra de uma
// execucao que morreu ha mais de uma hora). A IA liberada so nela (fora da
// lista fechada: so atende em numero 'fake' e o motor de producao nunca a
// reivindica; os jobs sao montados direto e nenhum executor roda aqui;
// nenhuma mensagem sai). O interruptor global NUNCA e tocado. Telefones
// ficticios. ESCRITO, AINDA NAO RODADO: grava no banco. Roda depois de
// aplicar a migration, com npm run test:integration -- lista-de-espera-pela-ia.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic
//    where slug like 'lista-ia-int-%' and e_de_teste;

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const FUSO = "America/Fortaleza";
const DADO_INVALIDO = "22023";
const PARAMETRO_NULO = "22004";
const PERGUNTA = "Confirma a sua entrada na lista de espera?";

type Resposta = {
  ok: boolean;
  motivo?: string;
  pedido_id?: string;
  waitlist_id?: string;
  reutilizado?: boolean;
  procedimento?: string;
  profissional?: string | null;
  convenio?: string | null;
  plano?: string | null;
  particular?: boolean;
  turnos?: string[];
  dias?: number[];
  entrada?: {
    procedimento: string | null;
    profissional: string | null;
    turnos: string[];
    dias: number[];
  } | null;
  starts_at?: string;
  marcada?: boolean;
};

let clinica = "";
let numero = "";
let ana = "";
let bruno = "";
let limpeza = "";
let botox = "";
let equipeProc = "";
let unimed = "";
let versao = 1;
let telefones = 0;

const dia = somarDias(diaCivil(FUSO, new Date()), 3);
const as = (hora: string, mais = 0): string =>
  instanteLocal(FUSO, somarDias(dia, mais), hora).toISOString();

async function rpcOk<T>(nome: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
}

async function inserir(tabela: string, linha: Record<string, unknown>): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/** Publica uma versao nova da configuracao (a de numero maior e a que vale). */
async function publicar(skills: Record<string, boolean>): Promise<void> {
  versao += 1;
  await inserir("ai_agent_config", {
    clinic_id: clinica,
    version: versao,
    status: "publicada",
    skills,
    agenda_antecedencia_horas: 2,
    agenda_horizonte_dias: 30,
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: false,
  });
}

const LISTA_LIGADA = { agendar: true, lista_de_espera: true };

/**
 * Telefone liberado, contato e conversa NA IA pela ingestao (janela e
 * autorizacao). Cada caso ingere logo antes de usar: a manutencao de
 * producao (a cada minuto) devolve a conversa de teste que espera resposta
 * ha mais de 3 minutos.
 */
async function conversaNaIa(): Promise<{ contato: string; conversa: string; telefone: string }> {
  // O numero desta chamada fica guardado antes do primeiro await (a licao
  // da AG3: duas chamadas ao mesmo tempo nao dividem o contador).
  telefones += 1;
  const n = telefones;
  const telefone = `+55843${digitos}${String(n).padStart(2, "0")}`;
  // O contato nasce paciente e o telefone, forcado, ANTES de a conversa
  // existir (o forcado so vale gravado depois do sinal de paciente), como
  // na AG4 (3f87861): a consulta que o caso cria depois (ja_tem_consulta)
  // nao abre janela para a manutencao do motor (a cada minuto) tirar a
  // conversa de teste da IA (ia_pode_falar_com), o que dava ia_desligada ao
  // acaso. A autorizacao continua nascendo na ingestao (o contato nao tem
  // linha de consentimento antes dela); a perguntaDoJob, que forca de novo,
  // mantem o forcado (o sinal ja existe).
  await admin
    .from("contact")
    .insert({
      clinic_id: clinica,
      phone_e164: telefone,
      name: "Contato sintético",
      kind: "paciente",
    })
    .throwOnError();
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinica,
    p_telefone_e164: telefone,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_forcar_contato_existente: true,
    p_confirmou_aviso_da_openai: true,
    p_confirmou_teste_com_paciente: true,
  });
  const r = await rpcOk<{
    conversation_id: string | null;
    contact_id: string | null;
    ia_atendendo?: boolean;
  }>("ingest_inbound_message", {
    p_clinic_id: clinica,
    p_phone_e164: telefone,
    p_name: "Contato sintético",
    p_wa_message_id: `lista-ia-int:${sufixo}:${n}`,
    p_content_type: "texto",
    p_body: "Mensagem sintética",
    p_whatsapp_account_id: numero,
  });
  expect(r.ia_atendendo, "a conversa nasce na IA").toBe(true);
  return { contato: r.contact_id!, conversa: r.conversation_id!, telefone };
}

async function job(conversa: string): Promise<string> {
  return inserir("job_queue", {
    clinic_id: clinica,
    kind: "responder_com_ia",
    whatsapp_account_id: numero,
    payload: { conversation_id: conversa },
    status: "executando",
    locked_by: `lista-ia-int-${sufixo}`,
    locked_at: new Date().toISOString(),
    attempts: 1,
    max_attempts: 3,
  });
}

/** O job leu a conversa (as mensagens do paciente nao apagadas), como o motor. */
async function leu(
  jobId: string,
  conversa: string,
  estado: "reservado" | "enviado" | "sem_envio" = "reservado",
): Promise<string> {
  const { data } = await admin
    .from("message")
    .select("id")
    .eq("conversation_id", conversa)
    .eq("direction", "entrada")
    .eq("author", "paciente")
    .is("deleted_at", null)
    .order("created_at")
    .throwOnError();
  await admin
    .from("ai_turno")
    .upsert(
      {
        job_id: jobId,
        clinic_id: clinica,
        conversation_id: conversa,
        estado,
        mensagens_lidas: (data as { id: string }[]).map((m) => m.id),
      },
      { onConflict: "job_id" },
    )
    .throwOnError();
  return jobId;
}

/** A pergunta T-E1 escrita pelo job (com a decisao aprovada, como o gatilho exige). */
async function perguntaDoJob(conversa: string, telefone: string, jobId: string): Promise<string> {
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinica,
    p_telefone_e164: telefone,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_forcar_contato_existente: true,
    p_confirmou_aviso_da_openai: true,
    p_confirmou_teste_com_paciente: true,
  });
  await admin
    .from("ai_decision_log")
    .insert({
      clinic_id: clinica,
      conversation_id: conversa,
      job_id: jobId,
      aprovado: true,
      texto_sha256: createHash("sha256").update(PERGUNTA, "utf8").digest("hex"),
      desfecho: "respondeu",
    })
    .throwOnError();
  return inserir("message", {
    clinic_id: clinica,
    conversation_id: conversa,
    direction: "saida",
    author: "ia",
    content_type: "texto",
    body: PERGUNTA,
    job_id: jobId,
  });
}

async function doPaciente(
  conversa: string,
  body = "sim",
  citada: string | null = null,
): Promise<string> {
  return inserir("message", {
    clinic_id: clinica,
    conversation_id: conversa,
    direction: "entrada",
    author: "paciente",
    content_type: "texto",
    body,
    reply_to_message_id: citada,
  });
}

async function automatica(conversa: string): Promise<string> {
  return inserir("message", {
    clinic_id: clinica,
    conversation_id: conversa,
    direction: "saida",
    author: "sistema",
    content_type: "texto",
    body: "Mensagem sintética automática",
  });
}

type Pedido = {
  procedimento?: string;
  profissional?: string | null;
  convenio?: string | null;
  particular?: boolean;
  turnos?: string[];
  dias?: number[];
};

async function pedir(conversa: string, jobId: string, p: Pedido = {}): Promise<Resposta> {
  return rpcOk<Resposta>("pedir_lista_de_espera_pela_ia", {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_job_id: jobId,
    p_procedure_id: p.procedimento ?? limpeza,
    p_professional_id: p.profissional ?? null,
    p_insurance_id: p.convenio ?? null,
    p_particular: p.particular ?? true,
    p_turnos: p.turnos ?? [],
    p_dias: p.dias ?? [],
  });
}

async function entrar(conversa: string, jobId?: string, ler = true): Promise<Resposta> {
  const j = jobId ?? (await job(conversa));
  if (ler) {
    await leu(j, conversa);
  }
  return rpcOk<Resposta>("entrar_na_lista_de_espera_pela_ia", {
    p_clinic_id: clinica,
    p_conversation_id: conversa,
    p_job_id: j,
  });
}

/** O caminho do motor ate a pergunta: J1 le, pede e escreve a T-E1. Devolve J1. */
async function pedidoEPergunta(
  c: { conversa: string; telefone: string },
  p: Pedido = {},
): Promise<string> {
  const j1 = await leu(await job(c.conversa), c.conversa);
  expect(await pedir(c.conversa, j1, p)).toMatchObject({ ok: true });
  await leu(j1, c.conversa, "enviado");
  await perguntaDoJob(c.conversa, c.telefone, j1);
  return j1;
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "lista-ia-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinica = await inserir("clinic", {
    name: `Lista IA integração ${sufixo}`,
    slug: `lista-ia-int-i-${sufixo}`,
    e_de_teste: true,
    timezone: FUSO,
  });
  numero = (await criarNumeroDeTeste(admin, clinica, { nome: "Recepção" })).id;
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinica,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de integracao da AG5",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinica,
    p_whatsapp_account_id: numero,
    p_ativo: true,
  });
  await inserir("ai_agent_config", {
    clinic_id: clinica,
    version: 1,
    status: "publicada",
    skills: LISTA_LIGADA,
    agenda_antecedencia_horas: 2,
    agenda_horizonte_dias: 30,
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: false,
  });
  ana = await inserir("professional", { clinic_id: clinica, name: "Dra. Ana" });
  bruno = await inserir("professional", { clinic_id: clinica, name: "Dr. Bruno" });
  limpeza = await inserir("procedure", { clinic_id: clinica, name: "Limpeza sintética", default_duration_min: 30 });
  botox = await inserir("procedure", { clinic_id: clinica, name: "Botox sintético", default_duration_min: 30 });
  equipeProc = await inserir("procedure", {
    clinic_id: clinica,
    name: "Só com a equipe sintético",
    default_duration_min: 30,
    bookable_by_ai: false,
  });
  unimed = await inserir("insurance", { clinic_id: clinica, name: "Unimed sintética", plan_name: "Plano Ouro" });
  for (const [prof, proc, convenio, daIa] of [
    [ana, limpeza, null, true],
    [ana, limpeza, unimed, true],
    [ana, botox, null, true],
    [ana, equipeProc, null, true],
    [bruno, limpeza, null, false],
  ] as const) {
    await inserir("service_link", {
      clinic_id: clinica,
      professional_id: prof,
      procedure_id: proc,
      insurance_id: convenio,
      duration_min: 30,
      price_cents: convenio ? null : 20000,
      covered_by_insurance: convenio !== null,
      bookable_by_ai: daIa,
    });
  }
}, 120_000);

afterAll(async () => {
  if (clinica) {
    const { error } = await admin.from("clinic").delete().eq("id", clinica);
    expect(error, "apagar a clinica do teste").toBeNull();
  }
}, 60_000);

describe("pedir_lista_de_espera_pela_ia: cada recusa, na ordem do contrato", () => {
  it("22004, 22023 job_invalido e os parametros", async () => {
    const c = await conversaNaIa();
    const j = await job(c.conversa);
    const { error: nulo } = await admin.rpc("pedir_lista_de_espera_pela_ia", {
      p_clinic_id: clinica,
      p_conversation_id: c.conversa,
      p_job_id: j,
      p_procedure_id: null,
      p_professional_id: null,
      p_insurance_id: null,
      p_particular: true,
      p_turnos: [],
      p_dias: [],
    });
    expect(nulo?.code).toBe(PARAMETRO_NULO);
    const outra = await conversaNaIa();
    for (const jobId of [crypto.randomUUID(), await job(outra.conversa)]) {
      const { error } = await admin.rpc("pedir_lista_de_espera_pela_ia", {
        p_clinic_id: clinica,
        p_conversation_id: c.conversa,
        p_job_id: jobId,
        p_procedure_id: limpeza,
        p_professional_id: null,
        p_insurance_id: null,
        p_particular: true,
        p_turnos: [],
        p_dias: [],
      });
      expect(error?.code).toBe(DADO_INVALIDO);
      expect(error?.message).toBe("job_invalido");
    }
    const base: Record<string, unknown> = {
      p_clinic_id: clinica,
      p_conversation_id: c.conversa,
      p_job_id: j,
      p_procedure_id: limpeza,
      p_professional_id: null,
      p_insurance_id: null,
      p_particular: true,
      p_turnos: [],
      p_dias: [],
    };
    const casos: [Record<string, unknown>, string][] = [
      [{ p_turnos: ["madrugada"] }, "preferencia_invalida"],
      [{ p_dias: [1, 1] }, "preferencia_invalida"],
      [{ p_insurance_id: unimed, p_particular: true }, "pagamento_invalido"],
      [{ p_particular: false }, "pagamento_invalido"],
      [{ p_procedure_id: crypto.randomUUID() }, "cadastro_invalido"],
    ];
    for (const [args, mensagem] of casos) {
      const { error } = await admin.rpc("pedir_lista_de_espera_pela_ia", { ...base, ...args });
      expect(error?.code, mensagem).toBe(DADO_INVALIDO);
      expect(error?.message).toBe(mensagem);
    }
  });

  it("o caminho feliz normaliza a preferencia; o mesmo job volta reutilizado; outro pedido do mesmo job e 22023", async () => {
    const c = await conversaNaIa();
    const j = await leu(await job(c.conversa), c.conversa);
    const r = await pedir(c.conversa, j, {
      profissional: ana,
      turnos: ["tarde", "manha"],
      dias: [3, 1],
    });
    expect(r).toMatchObject({
      ok: true,
      reutilizado: false,
      procedimento: "Limpeza sintética",
      profissional: "Dra. Ana",
      convenio: null,
      plano: null,
      particular: true,
      turnos: ["manha", "tarde"],
      dias: [1, 3],
    });
    const de_novo = await pedir(c.conversa, j, {
      profissional: ana,
      turnos: ["manha", "tarde"],
      dias: [1, 3],
    });
    expect(de_novo).toMatchObject({ ok: true, reutilizado: true, pedido_id: r.pedido_id });
    const { error } = await admin.rpc("pedir_lista_de_espera_pela_ia", {
      p_clinic_id: clinica,
      p_conversation_id: c.conversa,
      p_job_id: j,
      p_procedure_id: limpeza,
      p_professional_id: null,
      p_insurance_id: null,
      p_particular: true,
      p_turnos: [],
      p_dias: [],
    });
    expect(error?.code).toBe(DADO_INVALIDO);
    expect(error?.message).toBe("job_de_outro_pedido");
    // O convenio, todos os periodos e dias (viram qualquer); o pedido novo
    // substitui o vivo.
    const r2 = await pedir(c.conversa, await job(c.conversa), {
      convenio: unimed,
      particular: false,
      turnos: ["noite", "tarde", "manha"],
      dias: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(r2).toMatchObject({
      ok: true,
      convenio: "Unimed sintética",
      plano: "Plano Ouro",
      particular: false,
      profissional: null,
      turnos: [],
      dias: [],
    });
    const { data: vivos } = await admin
      .from("ia_pedido_de_espera")
      .select("id")
      .eq("clinic_id", clinica)
      .eq("conversation_id", c.conversa)
      .is("consumido_em", null)
      .throwOnError();
    expect((vivos as { id: string }[]).map((v) => v.id)).toEqual([r2.pedido_id]);
  });

  it("ia_desligada, lista_de_espera_desligada, mais_de_uma_unidade e so_com_a_equipe", async () => {
    const c = await conversaNaIa();
    const j = await job(c.conversa);
    await admin.from("conversation").update({ status: "aguardando_humano" }).eq("id", c.conversa).throwOnError();
    expect(await pedir(c.conversa, j)).toEqual({ ok: false, motivo: "ia_desligada" });
    await admin.from("conversation").update({ status: "ia_atendendo" }).eq("id", c.conversa).throwOnError();
    await publicar({ agendar: true });
    expect(await pedir(c.conversa, j)).toEqual({ ok: false, motivo: "lista_de_espera_desligada" });
    await publicar({ agendar: false, lista_de_espera: true });
    expect(await pedir(c.conversa, j)).toEqual({ ok: false, motivo: "lista_de_espera_desligada" });
    await publicar(LISTA_LIGADA);
    const unidades = [
      await inserir("unit", { clinic_id: clinica, name: "Sede sintética" }),
      await inserir("unit", { clinic_id: clinica, name: "Filial sintética" }),
    ];
    expect(await pedir(c.conversa, j)).toEqual({ ok: false, motivo: "mais_de_uma_unidade" });
    await admin.from("unit").delete().in("id", unidades).throwOnError();
    expect(await pedir(c.conversa, j, { procedimento: equipeProc })).toEqual({
      ok: false,
      motivo: "so_com_a_equipe",
    });
    expect(await pedir(c.conversa, j, { profissional: bruno })).toEqual({
      ok: false,
      motivo: "so_com_a_equipe",
    });
    expect(await pedir(c.conversa, j, { procedimento: botox, convenio: unimed, particular: false })).toEqual({
      ok: false,
      motivo: "so_com_a_equipe",
    });
  });

  it("sem_autorizacao, ja_na_lista (com a entrada), menor_de_idade e ja_tem_consulta (com o inicio)", async () => {
    const semAutorizacao = await conversaNaIa();
    await admin
      .from("contact_consent")
      .update({ revoked_at: new Date().toISOString() })
      .eq("contact_id", semAutorizacao.contato)
      .throwOnError();
    expect(await pedir(semAutorizacao.conversa, await job(semAutorizacao.conversa))).toEqual({
      ok: false,
      motivo: "sem_autorizacao",
    });

    const naLista = await conversaNaIa();
    await inserir("waitlist", {
      clinic_id: clinica,
      contact_id: naLista.contato,
      procedure_id: limpeza,
      professional_id: ana,
      preferred_shifts: ["manha"],
      preferred_weekdays: [2],
    });
    expect(await pedir(naLista.conversa, await job(naLista.conversa), { profissional: ana })).toEqual({
      ok: false,
      motivo: "ja_na_lista",
      entrada: { procedimento: "Limpeza sintética", profissional: "Dra. Ana", turnos: ["manha"], dias: [2] },
    });
    // (revisao de 28/10/2026) Qualquer entrada do mesmo procedimento: o
    // pedido de qualquer profissional tambem ouve a da Dra. Ana.
    expect(await pedir(naLista.conversa, await job(naLista.conversa))).toEqual({
      ok: false,
      motivo: "ja_na_lista",
      entrada: { procedimento: "Limpeza sintética", profissional: "Dra. Ana", turnos: ["manha"], dias: [2] },
    });
    // A de outro procedimento nao conta.
    expect(await pedir(naLista.conversa, await job(naLista.conversa), { procedimento: botox })).toMatchObject({
      ok: true,
    });
    // A de qualquer procedimento (da recepcao) cobre o pedido com a Dra. Ana.
    const qualquerProcedimento = await conversaNaIa();
    await inserir("waitlist", {
      clinic_id: clinica,
      contact_id: qualquerProcedimento.contato,
      procedure_id: null,
      preferred_shifts: ["tarde"],
    });
    expect(
      await pedir(qualquerProcedimento.conversa, await job(qualquerProcedimento.conversa), { profissional: ana }),
    ).toEqual({
      ok: false,
      motivo: "ja_na_lista",
      entrada: { procedimento: null, profissional: null, turnos: ["tarde"], dias: [] },
    });

    const menor = await conversaNaIa();
    const nascimento = new Date();
    nascimento.setFullYear(nascimento.getFullYear() - 15);
    await admin
      .from("contact")
      .update({ birth_date: nascimento.toISOString().slice(0, 10) })
      .eq("id", menor.contato)
      .throwOnError();
    expect(await pedir(menor.conversa, await job(menor.conversa))).toEqual({
      ok: false,
      motivo: "menor_de_idade",
    });

    const comConsulta = await conversaNaIa();
    await inserir("appointment", {
      clinic_id: clinica,
      contact_id: comConsulta.contato,
      professional_id: bruno,
      service_link_id: (
        (await admin
          .from("service_link")
          .select("id")
          .eq("clinic_id", clinica)
          .eq("professional_id", bruno)
          .single()
          .throwOnError()).data as { id: string }
      ).id,
      starts_at: as("10:00"),
      ends_at: as("10:30"),
      status: "agendado",
      created_by: "usuario",
    });
    const r = await pedir(comConsulta.conversa, await job(comConsulta.conversa));
    expect(r).toMatchObject({ ok: false, motivo: "ja_tem_consulta" });
    expect(Date.parse(r.starts_at!)).toBe(Date.parse(as("10:00")));
    expect(await pedir(comConsulta.conversa, await job(comConsulta.conversa), { procedimento: botox })).toMatchObject({
      ok: true,
    });
  });
});

describe("entrar_na_lista_de_espera_pela_ia: de ponta a ponta", () => {
  it("o pedido, a pergunta do mesmo job, o sim lido: a entrada, o pedido consumido, o evento; a repeticao", async () => {
    const c = await conversaNaIa();
    const j1 = await pedidoEPergunta(c, { profissional: ana, turnos: ["manha"], dias: [1, 3] });
    await doPaciente(c.conversa, "sim");
    const j2 = await job(c.conversa);
    const r = await entrar(c.conversa, j2);
    expect(r).toMatchObject({
      ok: true,
      reutilizado: false,
      procedimento: "Limpeza sintética",
      profissional: "Dra. Ana",
      convenio: null,
      plano: null,
      particular: true,
      turnos: ["manha"],
      dias: [1, 3],
    });
    const { data: entrada } = await admin
      .from("waitlist")
      .select("contact_id, procedure_id, professional_id, preferred_shifts, preferred_weekdays, priority, active, origem, ia_job_id, conversation_id, insurance_id, particular")
      .eq("id", r.waitlist_id!)
      .single()
      .throwOnError();
    expect(entrada).toEqual({
      contact_id: c.contato,
      procedure_id: limpeza,
      professional_id: ana,
      preferred_shifts: ["manha"],
      preferred_weekdays: [1, 3],
      priority: 1_000_000,
      active: true,
      origem: "ia",
      ia_job_id: j2,
      conversation_id: c.conversa,
      insurance_id: null,
      particular: true,
    });
    const { data: pedido } = await admin
      .from("ia_pedido_de_espera")
      .select("job_id, job_id_da_entrada, waitlist_id, consumido_em")
      .eq("conversation_id", c.conversa)
      .single()
      .throwOnError();
    expect(pedido).toMatchObject({ job_id: j1, job_id_da_entrada: j2, waitlist_id: r.waitlist_id });
    expect((pedido as { consumido_em: string | null }).consumido_em).not.toBeNull();
    const { data: eventos } = await admin
      .from("message")
      .select("body, author, billable, cost_cents")
      .eq("conversation_id", c.conversa)
      .eq("content_type", "evento")
      .throwOnError();
    expect(eventos).toEqual([
      {
        body: "A IA colocou o paciente na lista de espera: Limpeza sintética, Dra. Ana, particular. Preferência: manhã; segunda e quarta.",
        author: "sistema",
        billable: false,
        cost_cents: 0,
      },
    ]);
    expect(await entrar(c.conversa, j2)).toMatchObject({ ok: true, reutilizado: true, waitlist_id: r.waitlist_id });
    // (revisao de 28/10/2026, R3) A recepcao removeu a entrada entre as
    // tentativas do mesmo job: sem_pedido_de_espera, nada gravado; ativa de
    // novo, reutilizado.
    await admin.from("waitlist").update({ active: false }).eq("id", r.waitlist_id!).throwOnError();
    expect(await entrar(c.conversa, j2)).toEqual({ ok: false, motivo: "sem_pedido_de_espera" });
    const { data: daConversa } = await admin
      .from("waitlist")
      .select("id, active")
      .eq("contact_id", c.contato)
      .throwOnError();
    expect(daConversa).toEqual([{ id: r.waitlist_id, active: false }]);
    const { count: eventosDepois } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", c.conversa)
      .eq("content_type", "evento")
      .throwOnError();
    expect(eventosDepois).toBe(1);
    await admin.from("waitlist").update({ active: true }).eq("id", r.waitlist_id!).throwOnError();
    expect(await entrar(c.conversa, j2)).toMatchObject({ ok: true, reutilizado: true, waitlist_id: r.waitlist_id });
    expect(await entrar(c.conversa)).toEqual({ ok: false, motivo: "sem_pedido_de_espera" });
  });

  it("a ancora: a automatica no meio e a pergunta de outro job recusam; a pergunta de novo vale", async () => {
    const c = await conversaNaIa();
    await pedidoEPergunta(c);
    await automatica(c.conversa);
    await doPaciente(c.conversa, "sim");
    expect(await entrar(c.conversa)).toEqual({ ok: false, motivo: "sem_confirmacao_do_paciente" });
    // A pergunta de novo (o motor pede de novo com o job do turno).
    await pedidoEPergunta(c);
    await doPaciente(c.conversa, "sim");
    expect(await entrar(c.conversa)).toMatchObject({ ok: true });

    const outra = await conversaNaIa();
    const j1 = await leu(await job(outra.conversa), outra.conversa);
    expect(await pedir(outra.conversa, j1)).toMatchObject({ ok: true });
    await perguntaDoJob(outra.conversa, outra.telefone, await job(outra.conversa));
    await doPaciente(outra.conversa, "sim");
    expect(await entrar(outra.conversa)).toEqual({ ok: false, motivo: "sem_confirmacao_do_paciente" });
  });

  it("o sim que cita outra mensagem recusa; o que cita a pergunta passa", async () => {
    const c = await conversaNaIa();
    const antiga = await automatica(c.conversa);
    await pedidoEPergunta(c);
    await doPaciente(c.conversa, "sim", antiga);
    expect(await entrar(c.conversa)).toEqual({ ok: false, motivo: "sem_confirmacao_do_paciente" });
    const outra = await conversaNaIa();
    const j = await pedidoEPergunta(outra);
    const { data: pergunta } = await admin
      .from("message")
      .select("id")
      .eq("job_id", j)
      .single()
      .throwOnError();
    await doPaciente(outra.conversa, "sim", (pergunta as { id: string }).id);
    expect(await entrar(outra.conversa)).toMatchObject({ ok: true });
  });

  it("a mensagem nova: a que chegou depois da leitura recusa; a lida pelo turno enviado nao; a de sem_envio sim", async () => {
    const c = await conversaNaIa();
    await pedidoEPergunta(c, { procedimento: botox });
    await doPaciente(c.conversa, "sim");
    const j2 = await leu(await job(c.conversa), c.conversa);
    await doPaciente(c.conversa, "espera, nao");
    expect(await entrar(c.conversa, j2, false)).toEqual({ ok: false, motivo: "mensagem_nova_do_paciente" });
    expect(await entrar(c.conversa)).toMatchObject({ ok: true });

    const outra = await conversaNaIa();
    await pedidoEPergunta(outra, { procedimento: botox });
    const duvida = await doPaciente(outra.conversa, "quanto tempo demora?");
    const sim = await doPaciente(outra.conversa, "sim");
    const j0 = await job(outra.conversa);
    await admin
      .from("ai_turno")
      .insert({ job_id: j0, clinic_id: clinica, conversation_id: outra.conversa, estado: "sem_envio", mensagens_lidas: [duvida] })
      .throwOnError();
    const jSim = await job(outra.conversa);
    await admin
      .from("ai_turno")
      .insert({ job_id: jSim, clinic_id: clinica, conversation_id: outra.conversa, estado: "reservado", mensagens_lidas: [sim] })
      .throwOnError();
    expect(await entrar(outra.conversa, jSim, false)).toEqual({ ok: false, motivo: "mensagem_nova_do_paciente" });
    await admin.from("ai_turno").update({ estado: "enviado" }).eq("job_id", j0).throwOnError();
    expect(await entrar(outra.conversa, jSim, false)).toMatchObject({ ok: true });
  });

  it("ja_na_lista: a recepcao pos no mesmo grupo depois do pedido", async () => {
    const c = await conversaNaIa();
    await pedidoEPergunta(c, { profissional: ana });
    await doPaciente(c.conversa, "sim");
    await inserir("waitlist", { clinic_id: clinica, contact_id: c.contato, procedure_id: limpeza, professional_id: ana });
    expect(await entrar(c.conversa)).toEqual({
      ok: false,
      motivo: "ja_na_lista",
      entrada: { procedimento: "Limpeza sintética", profissional: "Dra. Ana", turnos: [], dias: [] },
    });
  });

  it("ja_na_lista (revisao): a recepcao pos o mesmo procedimento com OUTRO profissional depois do pedido", async () => {
    const c = await conversaNaIa();
    await pedidoEPergunta(c, { profissional: ana });
    await doPaciente(c.conversa, "sim");
    const daRecepcao = await inserir("waitlist", {
      clinic_id: clinica,
      contact_id: c.contato,
      procedure_id: limpeza,
      professional_id: bruno,
    });
    expect(await entrar(c.conversa)).toEqual({
      ok: false,
      motivo: "ja_na_lista",
      entrada: { procedimento: "Limpeza sintética", profissional: "Dr. Bruno", turnos: [], dias: [] },
    });
    // Removida a da recepcao, a fase 2 entra (o pedido seguiu vivo).
    await admin.from("waitlist").update({ active: false }).eq("id", daRecepcao).throwOnError();
    expect(await entrar(c.conversa)).toMatchObject({ ok: true, reutilizado: false });
  });
});

describe("marcar_mensagem_tratada_pelo_sistema", () => {
  it("22023 para a mensagem que nao e do paciente; fora_da_ia; marcada, e de novo nada", async () => {
    const c = await conversaNaIa();
    const j = await pedidoEPergunta(c);
    const { data: pergunta } = await admin.from("message").select("id").eq("job_id", j).single().throwOnError();
    const { error } = await admin.rpc("marcar_mensagem_tratada_pelo_sistema", {
      p_clinic_id: clinica,
      p_conversation_id: c.conversa,
      p_message_id: (pergunta as { id: string }).id,
    });
    expect(error?.code).toBe(DADO_INVALIDO);
    expect(error?.message).toBe("mensagem_invalida");
    const sim = await doPaciente(c.conversa, "SIM");
    expect(
      await rpcOk<Resposta>("marcar_mensagem_tratada_pelo_sistema", {
        p_clinic_id: clinica,
        p_conversation_id: c.conversa,
        p_message_id: sim,
      }),
    ).toEqual({ ok: true, marcada: true });
    const { data: turnos } = await admin
      .from("ai_turno")
      .select("job_id, estado, saida, mensagens_lidas")
      .eq("conversation_id", c.conversa)
      .contains("mensagens_lidas", [sim])
      .throwOnError();
    expect(turnos).toHaveLength(1);
    expect(turnos![0]).toMatchObject({ estado: "enviado", saida: "nenhuma", mensagens_lidas: [sim] });
    const { data: daFila } = await admin
      .from("job_queue")
      .select("id")
      .eq("id", (turnos![0] as { job_id: string }).job_id)
      .throwOnError();
    expect(daFila).toHaveLength(0);
    expect(
      await rpcOk<Resposta>("marcar_mensagem_tratada_pelo_sistema", {
        p_clinic_id: clinica,
        p_conversation_id: c.conversa,
        p_message_id: sim,
      }),
    ).toEqual({ ok: true, marcada: false });
    await admin.from("conversation").update({ status: "aguardando_humano" }).eq("id", c.conversa).throwOnError();
    const outra = await doPaciente(c.conversa, "NÃO QUERO");
    expect(
      await rpcOk<Resposta>("marcar_mensagem_tratada_pelo_sistema", {
        p_clinic_id: clinica,
        p_conversation_id: c.conversa,
        p_message_id: outra,
      }),
    ).toEqual({ ok: false, motivo: "fora_da_ia" });
  });
});
