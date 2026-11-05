import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// A IA coloca o paciente na lista de espera (AG5, parte de banco: migration
// 20261029100000_lista_de_espera_pela_ia.sql), pela API com JWT real de cada
// papel. O que esta em jogo:
// - as RPCs novas (pedir_lista_de_espera_pela_ia,
//   entrar_na_lista_de_espera_pela_ia, marcar_mensagem_tratada_pelo_sistema):
//   42501 para toda sessao e para anon; o servidor chama (resposta de
//   negocio);
// - ia_pedido_de_espera: nenhuma sessao le nem grava (42501); a service role
//   so le;
// - waitlist, as colunas novas: a sessao nunca grava origem ia, ia_job_id
//   nem conversation_id (42501 entrada_da_ia_so_pelo_servidor, o gatilho
//   exigir_entrada_da_ia), nem muda a entrada da IA (23514
//   entrada_da_ia_nao_muda); o convenio de outra clinica e 23503; Remover e
//   reordenar a entrada da IA passam (admin, gestor e recepcao);
// - a clinica A nao le a entrada da IA da clinica B; leitura e profissional
//   veem (com as colunas novas) e nao editam;
// - ai_turno: o CHECK das lidas (nulo dentro e 23514);
// - a revisao de 28/10/2026: a interna nova consulta_futura_do_procedimento
//   (42501 para toda sessao, anon e a service role) e as duas trocadas
//   encerrar_envios_da_oferta e expirar_ofertas_de_espera (42501 para toda
//   sessao e anon; o servidor chama, como antes).
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// lista-ia-rls-*, apagadas no afterAll (a fila, os pedidos, as conversas e as
// mensagens vao em cascata; o beforeAll apaga a sobra de uma execucao que
// morreu ha mais de uma hora), e os usuarios desta execucao (depois das
// clinicas). A IA e liberada so na A, de teste (fora da lista fechada: nao
// depende do interruptor, so atende em numero 'fake' e o motor da IA de
// producao nunca a reivindica; nenhum executor roda aqui; nenhuma mensagem
// sai). Nada usa a id de uma clinica real. Telefones ficticios. ESCRITO,
// AINDA NAO RODADO: grava no banco. Roda depois de aplicar a migration, com
// npm run test:rls -- lista-de-espera-pela-ia.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// NESTA ORDEM (as clinicas primeiro).
//   delete from public.clinic
//    where slug like 'lista-ia-rls-%' and e_de_teste;
//   select u.id, u.email from auth.users u
//    where u.email like 'lista-ia-rls-%@teste.dev';
// e os usuarios pela API de administracao, como o afterAll faz.

const PERMISSAO_NEGADA = "42501";
const VIOLA_CHECK = "23514";
const VIOLA_FK = "23503";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `ListaIaRls!${sufixo}`;
const COLUNAS =
  "id, origem, ia_job_id, conversation_id, insurance_id, particular, active";

const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();
const email = (apelido: string) => `lista-ia-rls-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;

const SESSOES = [
  "admin-a",
  "gestor-a",
  "recepcao-a",
  "profissional-a",
  "leitura-a",
  "admin-b",
] as const;
const QUEM_ESCREVE = ["admin-a", "gestor-a", "recepcao-a"] as const;

let clinicaA = "";
let clinicaB = "";
let numeroA = "";
let profissionalA = "";
let procedimentoA = "";
let convenioA = "";
let convenioB = "";
let conversaA = "";
let contatoA = "";
let entradaDaIa = "";
let telefones = 0;

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

async function criarClinica(nome: string): Promise<string> {
  return inserir("clinic", {
    name: `Lista IA RLS ${nome} ${sufixo}`,
    slug: `lista-ia-rls-${nome.toLowerCase()}-${sufixo}`,
    e_de_teste: true,
    timezone: "America/Fortaleza",
  });
}

async function criarPessoa(
  apelido: string,
  clinicId: string,
  role: string,
  professionalId: string | null = null,
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(apelido),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: apelido },
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuário"}`);
  }
  ids.set(apelido, data.user.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status: "ativo",
      professional_id: professionalId,
    })
    .throwOnError();
  const cliente = anonClient();
  const { error: erroLogin } = await cliente.auth.signInWithPassword({
    email: email(apelido),
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login ${apelido}: ${erroLogin.message}`);
  }
  clientes.set(apelido, cliente);
}

/**
 * Telefone liberado, contato e conversa NA IA pela ingestao (com a janela e a
 * autorizacao). A manutencao de producao (a cada minuto) devolve a conversa
 * de teste que espera resposta ha mais de 3 minutos: so o primeiro caso
 * depende de conversaA estar com a IA, e ela nasce no fim do beforeAll.
 */
async function conversaNaIa(): Promise<{ contato: string; conversa: string }> {
  // O numero desta chamada fica guardado antes do primeiro await (a licao
  // da AG3: duas chamadas ao mesmo tempo nao dividem o contador).
  telefones += 1;
  const n = telefones;
  const telefone = `+55846${digitos}${String(n).padStart(2, "0")}`;
  // O contato nasce paciente e o telefone, forcado, ANTES de a conversa
  // existir (o forcado so vale gravado depois do sinal de paciente), como
  // na AG4 (3f87861): a conversa nao depende de o contato seguir sem sinal
  // de paciente (a entrada na fila nao e sinal hoje; a consulta e) para a
  // manutencao do motor (a cada minuto) nao a tirar da IA
  // (ia_pode_falar_com), o que daria ia_desligada ou fora_da_ia ao acaso. A
  // autorizacao continua nascendo na ingestao (o contato nao tem linha de
  // consentimento antes dela).
  await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: telefone,
      name: "Contato sintético",
      kind: "paciente",
    })
    .throwOnError();
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinicaA,
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
    p_clinic_id: clinicaA,
    p_phone_e164: telefone,
    p_name: "Contato sintético",
    p_wa_message_id: `lista-ia-rls:${sufixo}:${n}`,
    p_content_type: "texto",
    p_body: "Mensagem sintética",
    p_whatsapp_account_id: numeroA,
  });
  expect(r.ia_atendendo, "a conversa nasce na IA").toBe(true);
  return { contato: r.contact_id!, conversa: r.conversation_id! };
}

async function jobEmExecucao(conversa: string): Promise<string> {
  return inserir("job_queue", {
    clinic_id: clinicaA,
    kind: "responder_com_ia",
    whatsapp_account_id: numeroA,
    payload: { conversation_id: conversa },
    status: "executando",
    locked_by: `lista-ia-rls-${sufixo}`,
    locked_at: new Date().toISOString(),
    attempts: 1,
    max_attempts: 3,
  });
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "lista-ia-rls-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  numeroA = (await criarNumeroDeTeste(admin, clinicaA, { nome: "Recepção" })).id;
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinicaA,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de RLS da AG5",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinicaA,
    p_whatsapp_account_id: numeroA,
    p_ativo: true,
  });
  await inserir("ai_agent_config", {
    clinic_id: clinicaA,
    version: 1,
    status: "publicada",
    skills: { agendar: true, lista_de_espera: true },
    agenda_antecedencia_horas: 2,
    agenda_horizonte_dias: 30,
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: false,
  });
  profissionalA = await inserir("professional", { clinic_id: clinicaA, name: "Dra. Um" });
  procedimentoA = await inserir("procedure", {
    clinic_id: clinicaA,
    name: "Limpeza sintética",
    default_duration_min: 30,
  });
  await inserir("service_link", {
    clinic_id: clinicaA,
    professional_id: profissionalA,
    procedure_id: procedimentoA,
    duration_min: 30,
    price_cents: 20000,
  });
  convenioA = await inserir("insurance", { clinic_id: clinicaA, name: "Convênio A sintético" });
  convenioB = await inserir("insurance", { clinic_id: clinicaB, name: "Convênio B sintético" });

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("profissional-a", clinicaA, "profissional", profissionalA);
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa("admin-b", clinicaB, "admin");

  const c = await conversaNaIa();
  conversaA = c.conversa;
  contatoA = c.contato;
  // A entrada da IA, gravada pelo servidor (sem sessao), como a fase 2.
  entradaDaIa = await inserir("waitlist", {
    clinic_id: clinicaA,
    contact_id: contatoA,
    procedure_id: procedimentoA,
    origem: "ia",
    ia_job_id: crypto.randomUUID(),
    conversation_id: conversaA,
    insurance_id: convenioA,
    particular: false,
  });
}, 120_000);

afterAll(async () => {
  for (const clinica of [clinicaA, clinicaB]) {
    if (clinica) {
      const { error } = await admin.from("clinic").delete().eq("id", clinica);
      expect(error, "apagar a clinica do teste").toBeNull();
    }
  }
  for (const id of ids.values()) {
    await admin.auth.admin.deleteUser(id);
  }
}, 120_000);

describe("as RPCs novas: so o servidor", () => {
  it("toda sessao e anon recebem 42501; o servidor recebe resposta de negocio", async () => {
    const job = await jobEmExecucao(conversaA);
    const argsPedir = {
      p_clinic_id: clinicaA,
      p_conversation_id: conversaA,
      p_job_id: job,
      p_procedure_id: procedimentoA,
      p_professional_id: null,
      p_insurance_id: null,
      p_particular: true,
      p_turnos: [],
      p_dias: [],
    };
    const argsEntrar = {
      p_clinic_id: clinicaA,
      p_conversation_id: conversaA,
      p_job_id: job,
    };
    const { data: mensagem } = await admin
      .from("message")
      .select("id")
      .eq("conversation_id", conversaA)
      .eq("author", "paciente")
      .limit(1)
      .single()
      .throwOnError();
    const argsMarcar = {
      p_clinic_id: clinicaA,
      p_conversation_id: conversaA,
      p_message_id: (mensagem as { id: string }).id,
    };
    for (const cliente of [anonClient(), ...SESSOES.map(como)]) {
      for (const [nome, args] of [
        ["pedir_lista_de_espera_pela_ia", argsPedir],
        ["entrar_na_lista_de_espera_pela_ia", argsEntrar],
        ["marcar_mensagem_tratada_pelo_sistema", argsMarcar],
      ] as const) {
        const { error } = await cliente.rpc(nome, args);
        expect(error?.code, nome).toBe(PERMISSAO_NEGADA);
      }
    }
    // O servidor: a conversa ja esta na lista no grupo (a entrada da IA).
    const pedido = await rpcOk<{ ok: boolean; motivo?: string }>("pedir_lista_de_espera_pela_ia", argsPedir);
    expect(pedido).toMatchObject({ ok: false, motivo: "ja_na_lista" });
    const entrar = await rpcOk<{ ok: boolean; motivo?: string }>("entrar_na_lista_de_espera_pela_ia", argsEntrar);
    expect(entrar).toEqual({ ok: false, motivo: "sem_pedido_de_espera" });
    const marcar = await rpcOk<{ ok: boolean; marcada?: boolean }>(
      "marcar_mensagem_tratada_pelo_sistema",
      argsMarcar,
    );
    expect(marcar.ok).toBe(true);
  });
});

describe("a revisao de 28/10/2026: a interna nova e as duas do fechamento da oferta", () => {
  it("consulta_futura_do_procedimento: ninguem da API executa, nem o servidor", async () => {
    const args = {
      p_clinic_id: clinicaA,
      p_contato: contatoA,
      p_procedure_id: procedimentoA,
      p_exceto: null,
    };
    for (const cliente of [anonClient(), ...SESSOES.map(como), admin]) {
      const { error } = await cliente.rpc("consulta_futura_do_procedimento", args);
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
  });

  it("encerrar_envios_da_oferta e expirar_ofertas_de_espera: sessao e anon 42501; o servidor chama", async () => {
    const oferta = crypto.randomUUID();
    for (const cliente of [anonClient(), ...SESSOES.map(como)]) {
      const { error: erroEncerrar } = await cliente.rpc("encerrar_envios_da_oferta", {
        p_clinic_id: clinicaA,
        p_offer_id: oferta,
      });
      expect(erroEncerrar?.code).toBe(PERMISSAO_NEGADA);
      const { error: erroExpirar } = await cliente.rpc("expirar_ofertas_de_espera");
      expect(erroExpirar?.code).toBe(PERMISSAO_NEGADA);
    }
    // O servidor: nenhum envio dessa oferta (que nao existe) e cancelado.
    expect(
      await rpcOk<number>("encerrar_envios_da_oferta", { p_clinic_id: clinicaA, p_offer_id: oferta }),
    ).toBe(0);
  });
});

describe("ia_pedido_de_espera: nenhuma sessao le nem grava", () => {
  it("sessao e anon: 42501; a service role le", async () => {
    for (const cliente of [anonClient(), ...SESSOES.map(como)]) {
      const { error } = await cliente.from("ia_pedido_de_espera").select("id").limit(1);
      expect(error?.code).toBe(PERMISSAO_NEGADA);
      const { error: erroGravar } = await cliente.from("ia_pedido_de_espera").insert({
        clinic_id: clinicaA,
        conversation_id: conversaA,
        contact_id: contatoA,
        janela_desde: new Date().toISOString(),
        job_id: crypto.randomUUID(),
        procedure_id: procedimentoA,
        particular: true,
      });
      expect(erroGravar?.code).toBe(PERMISSAO_NEGADA);
    }
    const { error } = await admin
      .from("ia_pedido_de_espera")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(error).toBeNull();
    const { error: erroServidor } = await admin
      .from("ia_pedido_de_espera")
      .delete()
      .eq("clinic_id", clinicaA);
    expect(erroServidor?.code).toBe(PERMISSAO_NEGADA);
  });
});

describe("waitlist: as colunas da IA pela sessao", () => {
  it("quem escreve poe a entrada da equipe (origem equipe); nunca a da IA (42501)", async () => {
    for (const [i, apelido] of QUEM_ESCREVE.entries()) {
      const c = await conversaNaIa();
      const { data, error } = await como(apelido)
        .from("waitlist")
        .insert({ clinic_id: clinicaA, contact_id: c.contato, procedure_id: procedimentoA })
        .select(COLUNAS)
        .single();
      expect(error, apelido).toBeNull();
      expect(data).toMatchObject({
        origem: "equipe",
        ia_job_id: null,
        conversation_id: null,
        insurance_id: null,
        particular: null,
      });
      for (const extra of [
        { origem: "ia", ia_job_id: crypto.randomUUID(), conversation_id: c.conversa, particular: true },
        { conversation_id: c.conversa },
        { ia_job_id: crypto.randomUUID() },
      ]) {
        const { error: erro } = await como(apelido)
          .from("waitlist")
          .insert({
            clinic_id: clinicaA,
            contact_id: c.contato,
            procedure_id: null,
            professional_id: profissionalA,
            ...extra,
          });
        expect(erro?.code, `${apelido} ${i}`).toBe(PERMISSAO_NEGADA);
        expect(erro?.message).toBe("entrada_da_ia_so_pelo_servidor");
      }
    }
  });

  it("o convenio de outra clinica e 23503; o pagamento incoerente, 23514; o da clinica passa", async () => {
    const c = await conversaNaIa();
    const { error: deOutra } = await como("recepcao-a").from("waitlist").insert({
      clinic_id: clinicaA,
      contact_id: c.contato,
      procedure_id: procedimentoA,
      insurance_id: convenioB,
      particular: false,
    });
    expect(deOutra?.code).toBe(VIOLA_FK);
    const { error: incoerente } = await como("recepcao-a").from("waitlist").insert({
      clinic_id: clinicaA,
      contact_id: c.contato,
      procedure_id: procedimentoA,
      particular: false,
    });
    expect(incoerente?.code).toBe(VIOLA_CHECK);
    const { error: daClinica } = await como("recepcao-a").from("waitlist").insert({
      clinic_id: clinicaA,
      contact_id: c.contato,
      procedure_id: procedimentoA,
      insurance_id: convenioA,
      particular: false,
    });
    expect(daClinica).toBeNull();
  });

  it("a entrada da IA nao muda pela sessao (23514); Remover e reordenar passam", async () => {
    for (const apelido of QUEM_ESCREVE) {
      for (const mudanca of [
        { particular: true, insurance_id: null },
        { origem: "equipe", ia_job_id: null, conversation_id: null },
        { conversation_id: crypto.randomUUID() },
      ]) {
        const { error } = await como(apelido)
          .from("waitlist")
          .update(mudanca)
          .eq("id", entradaDaIa);
        expect(error?.code, apelido).toBe(VIOLA_CHECK);
        expect(error?.message).toBe("entrada_da_ia_nao_muda");
      }
      const { data: removida, error: erroRemover } = await como(apelido)
        .from("waitlist")
        .update({ active: false })
        .eq("id", entradaDaIa)
        .select("id");
      expect(erroRemover).toBeNull();
      expect(removida).toHaveLength(1);
      const { error: erroVoltar } = await como(apelido)
        .from("waitlist")
        .update({ active: true })
        .eq("id", entradaDaIa);
      expect(erroVoltar).toBeNull();
    }
    const { data: movida, error } = await como("recepcao-a").rpc("mover_na_lista_de_espera", {
      p_clinic_id: clinicaA,
      p_id: entradaDaIa,
      p_nova_posicao: 1,
    });
    expect(error).toBeNull();
    expect(movida).toBe(entradaDaIa);
    const { data: intacta } = await admin
      .from("waitlist")
      .select(COLUNAS)
      .eq("id", entradaDaIa)
      .single()
      .throwOnError();
    expect(intacta).toMatchObject({
      origem: "ia",
      conversation_id: conversaA,
      insurance_id: convenioA,
      particular: false,
      active: true,
    });
  });
});

describe("waitlist: quem le a entrada da IA", () => {
  it("a A le (com as colunas novas); a B nao; leitura e profissional nao editam", async () => {
    for (const apelido of ["admin-a", "recepcao-a", "profissional-a", "leitura-a"] as const) {
      const { data, error } = await como(apelido)
        .from("waitlist")
        .select(`${COLUNAS}, insurance:insurance_id ( name )`)
        .eq("id", entradaDaIa);
      expect(error, apelido).toBeNull();
      expect(data, apelido).toHaveLength(1);
      expect(data![0]).toMatchObject({ origem: "ia", conversation_id: conversaA, particular: false });
    }
    const { data: daB, error: erroB } = await como("admin-b")
      .from("waitlist")
      .select("id")
      .eq("id", entradaDaIa);
    expect(erroB).toBeNull();
    expect(daB).toHaveLength(0);
    for (const apelido of ["leitura-a", "profissional-a", "admin-b"] as const) {
      const { data, error } = await como(apelido)
        .from("waitlist")
        .update({ active: false })
        .eq("id", entradaDaIa)
        .select("id");
      expect(error, apelido).toBeNull();
      expect(data, apelido).toHaveLength(0);
    }
    const c = await conversaNaIa();
    for (const apelido of ["leitura-a", "profissional-a"] as const) {
      const { error } = await como(apelido).from("waitlist").insert({
        clinic_id: clinicaA,
        contact_id: c.contato,
        procedure_id: procedimentoA,
      });
      expect(error?.code, apelido).toBe(PERMISSAO_NEGADA);
    }
    const { data: ativa } = await admin
      .from("waitlist")
      .select("active")
      .eq("id", entradaDaIa)
      .single()
      .throwOnError();
    expect((ativa as { active: boolean }).active).toBe(true);
  });
});

describe("ai_turno: as lidas sem nulo", () => {
  it("nulo dentro das lidas e 23514; sem nulo passa", async () => {
    const { error } = await admin.from("ai_turno").insert({
      job_id: crypto.randomUUID(),
      clinic_id: clinicaA,
      conversation_id: conversaA,
      estado: "reservado",
      mensagens_lidas: [crypto.randomUUID(), null],
    });
    expect(error?.code).toBe(VIOLA_CHECK);
    const { error: semNulo } = await admin.from("ai_turno").insert({
      job_id: crypto.randomUUID(),
      clinic_id: clinicaA,
      conversation_id: conversaA,
      estado: "reservado",
      mensagens_lidas: [crypto.randomUUID()],
    });
    expect(semNulo).toBeNull();
  });
});
