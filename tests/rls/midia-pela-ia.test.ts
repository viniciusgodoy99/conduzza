import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Midia na conversa com a IA (AG6b, parte de banco: migration
// 20261030100000_midia_pela_ia.sql), pela API com JWT real de cada papel. O
// que esta em jogo:
// - ia_leitura_da_midia (a transcricao e a leitura): a clinica A le as suas
//   e nao a da B; o profissional so a da conversa que esta com ele; o
//   pendente nada; anon nao le (42501); a tela le as colunas do fio;
// - ninguem grava pela API (insert, update e delete de cada papel e da
//   service role: 42501): so a RPC gravar_leitura_da_midia;
// - a mensagem apagada (apagar_mensagem pela tela) leva a leitura;
// - gravar_leitura_da_midia e midia_da_ia_liberada: 42501 para toda sessao e
//   para anon; o servidor recebe resposta de negocio;
// - ia_contato_liberado.aviso_da_openai_versao: a sessao le, nao grava;
//   definir_contato_liberado_da_ia pelo administrador grava a versao (e a
//   trilha com {versao}).
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// midia-rls-*, apagadas no afterAll (as conversas, as mensagens, os jobs e as
// leituras vao em cascata; o beforeAll apaga a sobra de uma execucao que
// morreu ha mais de uma hora), e os usuarios desta execucao (depois das
// clinicas). Nenhuma mensagem sai (numero fake) e nenhum modelo e chamado: a
// leitura e gravada pela RPC com um texto sintetico, como o motor gravaria.
// A IA e liberada so na A e na B, no numero falso, e so para telefones
// ficticios. A LICAO DE 30/10/2026 (commit 3f87861 do main): o contato nasce
// kind 'paciente' e o telefone e liberado FORCADO, com a confirmacao do
// aviso novo (p_versao_do_aviso 2), ANTES de qualquer conversa existir
// (definir_contato_liberado_da_ia roda ia_desligar na clinica, e o forcado
// so vale gravado depois do sinal de paciente); as conversas sao linhas
// gravadas direto, sem janela (a manutencao do motor so mexe em conversa de
// teste COM janela), e nenhum definir_* da A ou da B roda depois delas. O
// interruptor global NUNCA e tocado. Nada usa a id de uma clinica real.
// ESCRITO, AINDA NAO RODADO: grava no banco. Roda depois de aplicar a
// migration, com npm run test:rls -- midia-pela-ia.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// NESTA ORDEM (as clinicas primeiro).
//   delete from public.clinic where slug like 'midia-rls-%' and e_de_teste;
//   select u.id, u.email from auth.users u where u.email like 'midia-rls-%@teste.dev';
// e os usuarios pela API de administracao, como o afterAll faz.

const PERMISSAO_NEGADA = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `MidiaRls!${sufixo}`;
const WORKER = `midia-rls-${sufixo}`;
const TRANSCRICAO = "Texto sintetico de ensaio";

const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();
const email = (apelido: string) => `midia-rls-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;

const SESSOES = [
  "admin-a",
  "gestor-a",
  "recepcao-a",
  "profissional-a",
  "leitura-a",
  "pendente-a",
  "admin-b",
  "admin-t",
] as const;

type Gravacao = {
  ok: boolean;
  motivo?: string;
  reutilizado?: boolean;
  id?: string;
};

type Cena = {
  conversa: string;
  mensagem: string;
  telefone: string;
};

let clinicaA = "";
let clinicaB = "";
let clinicaT = "";
let numeroA = "";
let numeroB = "";
let profissionalA = "";
let telefones = 0;
/** As cenas da A: a do audio, a da imagem, a do profissional e a que sera apagada. */
let audioA: Cena;
let imagemA: Cena;
let doProfissional: Cena;
let apagadaA: Cena;
/** A cena da B. */
let audioB: Cena;
/** Um telefone liberado da A sem conversa ainda (a conversa e aberta por contato e numero). */
let telefoneLivreA = "";
let telefoneDaCarteirinhaA = "";

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
    name: `Midia RLS ${nome} ${sufixo}`,
    slug: `midia-rls-${nome.toLowerCase()}-${sufixo}`,
    e_de_teste: true,
    timezone: "America/Fortaleza",
  });
}

async function criarPessoa(
  apelido: string,
  clinicId: string,
  role: string,
  status: "ativo" | "pendente" = "ativo",
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
      status,
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
 * O telefone de teste, ANTES de qualquer conversa da clinica (a licao de
 * 30/10/2026): o contato nasce paciente e o telefone e liberado forcado, com
 * o aviso novo (versao 2). Devolve o telefone.
 */
async function telefoneLiberado(clinica: string): Promise<string> {
  // O numero desta chamada fica guardado antes do primeiro await.
  telefones += 1;
  const telefone = `+55847${digitos}${String(telefones).padStart(2, "0")}`;
  await admin
    .from("contact")
    .insert({ clinic_id: clinica, phone_e164: telefone, name: "Contato sintético", kind: "paciente" })
    .throwOnError();
  expect(
    await rpcOk<boolean>("definir_contato_liberado_da_ia", {
      p_clinic_id: clinica,
      p_telefone_e164: telefone,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_forcar_contato_existente: true,
      p_confirmou_aviso_da_openai: true,
      p_confirmou_teste_com_paciente: true,
      p_versao_do_aviso: 2,
    }),
  ).toBe(true);
  return telefone;
}

/** A conversa na IA (linha gravada direto, sem janela) do contato do telefone. */
async function conversaNaIa(clinica: string, numero: string, telefone: string): Promise<string> {
  const { data } = await admin
    .from("contact")
    .select("id")
    .eq("clinic_id", clinica)
    .eq("phone_e164", telefone)
    .single()
    .throwOnError();
  return inserir("conversation", {
    clinic_id: clinica,
    contact_id: (data as { id: string }).id,
    status: "ia_atendendo",
    awaiting_reply: false,
    whatsapp_account_id: numero,
  });
}

/** O audio ou a imagem do paciente, ja no Storage (o caminho que o worker grava). */
async function midiaDoPaciente(
  clinica: string,
  conversa: string,
  midia: "audio" | "imagem",
): Promise<string> {
  const mensagem = crypto.randomUUID();
  await admin
    .from("message")
    .insert({
      id: mensagem,
      clinic_id: clinica,
      conversation_id: conversa,
      direction: "entrada",
      author: "paciente",
      content_type: midia,
      media_url: `storage://midia-conversas/${clinica}/${mensagem}`,
      media_mimetype: midia === "audio" ? "audio/mpeg" : "image/jpeg",
    })
    .throwOnError();
  return mensagem;
}

/** Um job da IA em execucao da conversa, com o turno que leu a mensagem. */
async function jobQueLeu(clinica: string, numero: string, conversa: string, mensagem: string): Promise<string> {
  const job = await inserir("job_queue", {
    clinic_id: clinica,
    kind: "responder_com_ia",
    whatsapp_account_id: numero,
    payload: { conversation_id: conversa },
    status: "executando",
    locked_by: WORKER,
    locked_at: new Date().toISOString(),
    attempts: 1,
    max_attempts: 3,
  });
  await admin
    .from("ai_turno")
    .insert({
      job_id: job,
      clinic_id: clinica,
      conversation_id: conversa,
      estado: "reservado",
      mensagens_lidas: [mensagem],
    })
    .throwOnError();
  return job;
}

function argumentosDaLeitura(job: string, mensagem: string, midia: "audio" | "imagem"): Record<string, unknown> {
  return midia === "audio"
    ? {
        p_job_id: job,
        p_worker: WORKER,
        p_message_id: mensagem,
        p_midia: "audio",
        p_tipo: "transcricao",
        p_transcricao: TRANSCRICAO,
        p_segundos: 12,
        p_procedimentos: null,
        p_fora_do_cadastro: null,
        p_confianca: null,
        p_resumo: null,
        p_modelo: "whisper-1",
        p_versao: "transcricao-0123456789ab",
      }
    : {
        p_job_id: job,
        p_worker: WORKER,
        p_message_id: mensagem,
        p_midia: "imagem",
        p_tipo: "carteirinha",
        p_transcricao: null,
        p_segundos: null,
        p_procedimentos: [],
        p_fora_do_cadastro: 0,
        p_confianca: "alta",
        p_resumo: "carteirinha do convênio",
        p_modelo: "gpt-6-luna",
        p_versao: "leitor-0123456789ab",
      };
}

/** A conversa, a midia, o job que leu e a leitura gravada pela RPC (o servidor). */
async function cenaComLeitura(
  clinica: string,
  numero: string,
  telefone: string,
  midia: "audio" | "imagem",
): Promise<Cena> {
  const conversa = await conversaNaIa(clinica, numero, telefone);
  const mensagem = await midiaDoPaciente(clinica, conversa, midia);
  const job = await jobQueLeu(clinica, numero, conversa, mensagem);
  const r = await rpcOk<Gravacao>("gravar_leitura_da_midia", argumentosDaLeitura(job, mensagem, midia));
  expect(r).toMatchObject({ ok: true, reutilizado: false });
  await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
  return { conversa, mensagem, telefone };
}

async function lidasPor(cliente: SupabaseClient, mensagens: string[]): Promise<string[]> {
  const { data, error } = await cliente
    .from("ia_leitura_da_midia")
    .select("message_id")
    .in("message_id", mensagens);
  expect(error).toBeNull();
  return (data as { message_id: string }[]).map((l) => l.message_id).sort();
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "midia-rls-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  clinicaT = await criarClinica("T");
  numeroA = (await criarNumeroDeTeste(admin, clinicaA, { nome: "Recepção" })).id;
  numeroB = (await criarNumeroDeTeste(admin, clinicaB, { nome: "Recepção" })).id;
  for (const [clinica, numero] of [
    [clinicaA, numeroA],
    [clinicaB, numeroB],
  ] as const) {
    await rpcOk("definir_liberacao_da_ia", {
      p_clinic_id: clinica,
      p_liberada: true,
      p_modo: "contatos",
      p_motivo: "teste de RLS da AG6b",
    });
    await rpcOk("definir_numero_da_ia", { p_clinic_id: clinica, p_whatsapp_account_id: numero, p_ativo: true });
    // As duas habilidades da midia na versao publicada.
    await inserir("ai_agent_config", {
      clinic_id: clinica,
      version: 1,
      status: "publicada",
      skills: { ler_audio: true, ler_imagem_e_documento: true },
      exige_nome_completo: false,
      exige_nascimento: false,
      exige_cpf: false,
    });
  }
  // A T: so a linha da liberacao (a lista de telefones do administrador da T).
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinicaT,
    p_liberada: false,
    p_modo: "contatos",
    p_motivo: "teste de RLS da AG6b",
  });
  profissionalA = await inserir("professional", { clinic_id: clinicaA, name: "Dra. Um" });

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("profissional-a", clinicaA, "profissional", "ativo", profissionalA);
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa("pendente-a", clinicaA, "recepcao", "pendente");
  await criarPessoa("admin-b", clinicaB, "admin");
  await criarPessoa("admin-t", clinicaT, "admin");

  // TODOS os telefones antes de qualquer conversa (a licao de 30/10/2026).
  const telefonesDaA = [];
  for (let i = 0; i < 6; i += 1) {
    telefonesDaA.push(await telefoneLiberado(clinicaA));
  }
  const telefoneDaB = await telefoneLiberado(clinicaB);
  telefoneLivreA = telefonesDaA[4]!;
  telefoneDaCarteirinhaA = telefonesDaA[5]!;

  audioA = await cenaComLeitura(clinicaA, numeroA, telefonesDaA[0]!, "audio");
  imagemA = await cenaComLeitura(clinicaA, numeroA, telefonesDaA[1]!, "imagem");
  doProfissional = await cenaComLeitura(clinicaA, numeroA, telefonesDaA[2]!, "audio");
  apagadaA = await cenaComLeitura(clinicaA, numeroA, telefonesDaA[3]!, "audio");
  audioB = await cenaComLeitura(clinicaB, numeroB, telefoneDaB, "audio");
  // O servidor poe uma conversa com o profissional.
  await admin
    .from("conversation")
    .update({ status: "em_atendimento", assignee_user_id: ids.get("profissional-a")! })
    .eq("id", doProfissional.conversa)
    .throwOnError();
}, 180_000);

afterAll(async () => {
  for (const clinica of [clinicaA, clinicaB, clinicaT]) {
    if (clinica) {
      const { error } = await admin.from("clinic").delete().eq("id", clinica);
      expect(error, "apagar a clinica do teste").toBeNull();
    }
  }
  for (const id of ids.values()) {
    await admin.auth.admin.deleteUser(id);
  }
}, 120_000);

describe("gravar_leitura_da_midia e midia_da_ia_liberada: so o servidor", () => {
  it("toda sessao e anon recebem 42501 nas duas; o servidor recebe resposta de negocio", async () => {
    const conversa = await conversaNaIa(clinicaA, numeroA, telefoneLivreA);
    const mensagem = await midiaDoPaciente(clinicaA, conversa, "audio");
    const job = await jobQueLeu(clinicaA, numeroA, conversa, mensagem);
    const daLeitura = argumentosDaLeitura(job, mensagem, "audio");
    const doAviso = { p_clinic_id: clinicaA, p_telefone: telefoneLivreA };
    for (const cliente of [anonClient(), ...SESSOES.map(como)]) {
      const { error: erroDaLeitura } = await cliente.rpc("gravar_leitura_da_midia", daLeitura);
      expect(erroDaLeitura?.code).toBe(PERMISSAO_NEGADA);
      const { error: erroDoAviso } = await cliente.rpc("midia_da_ia_liberada", doAviso);
      expect(erroDoAviso?.code).toBe(PERMISSAO_NEGADA);
    }
    // Nenhuma sessao gravou.
    expect(await lidasPor(admin, [mensagem])).toEqual([]);
    // O servidor: o telefone pode mandar midia; outro worker nao tem a posse.
    expect(await rpcOk<boolean>("midia_da_ia_liberada", doAviso)).toBe(true);
    expect(await rpcOk<Gravacao>("gravar_leitura_da_midia", { ...daLeitura, p_worker: "outro" })).toEqual({
      ok: false,
      motivo: "sem_posse",
    });
    await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
  });
});

describe("a carteirinha lida (matriz de 06/11/2026, migration 20261106130000)", () => {
  it("toda sessao e anon recebem 42501 com os parametros novos; a RPC grava so pelo servidor; a B nao le a nota nem o contato; o numero nunca volta", async () => {
    const NUMERO = "99887766554433ZQ";
    const convenio = await inserir("insurance", {
      clinic_id: clinicaA,
      name: "Convenio sintetico",
      requires_card: true,
      active: true,
    });
    const conversa = await conversaNaIa(clinicaA, numeroA, telefoneDaCarteirinhaA);
    const mensagem = await midiaDoPaciente(clinicaA, conversa, "imagem");
    const job = await jobQueLeu(clinicaA, numeroA, conversa, mensagem);
    const daLeitura = {
      ...argumentosDaLeitura(job, mensagem, "imagem"),
      p_convenio_lido: convenio,
      p_numero_da_carteirinha: NUMERO,
    };
    const contato = async () => {
      const { data } = await admin
        .from("contact")
        .select("id, insurance_card, insurance_id")
        .eq("clinic_id", clinicaA)
        .eq("phone_e164", telefoneDaCarteirinhaA)
        .single()
        .throwOnError();
      return data as { id: string; insurance_card: string | null; insurance_id: string | null };
    };
    await admin
      .from("contact")
      .update({ insurance_card: "12345678" })
      .eq("clinic_id", clinicaA)
      .eq("phone_e164", telefoneDaCarteirinhaA)
      .throwOnError();
    for (const cliente of [anonClient(), ...SESSOES.map(como)]) {
      const { error } = await cliente.rpc("gravar_leitura_da_midia", daLeitura);
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
    expect((await contato()).insurance_card).toBe("12345678");
    const gravada = await rpcOk<Gravacao>("gravar_leitura_da_midia", daLeitura);
    expect(gravada).toMatchObject({ ok: true, reutilizado: false });
    expect(JSON.stringify(gravada)).not.toContain(NUMERO);
    // O numero diferente nao muda; o plano vazio grava; a nota, sem o numero.
    expect(await contato()).toMatchObject({ insurance_card: "12345678", insurance_id: convenio });
    const notas = async (cliente: SupabaseClient) => {
      const { data } = await cliente
        .from("message")
        .select("body")
        .eq("conversation_id", conversa)
        .eq("is_internal_note", true);
      return (data ?? []) as { body: string }[];
    };
    expect(await notas(como("admin-a"))).toHaveLength(1);
    expect(JSON.stringify(await notas(admin))).not.toContain(NUMERO);
    expect(await notas(como("admin-b"))).toEqual([]);
    expect(await notas(como("pendente-a"))).toEqual([]);
    const daB = await como("admin-b").from("contact").select("id").eq("id", (await contato()).id);
    expect(daB.data).toEqual([]);
    await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
  });
});

describe("ia_leitura_da_midia: quem le", () => {
  it("a A le as suas; a B so a dela; o profissional so a da conversa com ele; o pendente e a T, nada", async () => {
    const todas = [audioA.mensagem, imagemA.mensagem, doProfissional.mensagem, apagadaA.mensagem, audioB.mensagem];
    const daA = [audioA.mensagem, imagemA.mensagem, doProfissional.mensagem, apagadaA.mensagem];
    const esperado: Record<(typeof SESSOES)[number], string[]> = {
      "admin-a": daA,
      "gestor-a": daA,
      "recepcao-a": daA,
      "leitura-a": daA,
      "profissional-a": [doProfissional.mensagem],
      "pendente-a": [],
      "admin-b": [audioB.mensagem],
      "admin-t": [],
    };
    for (const apelido of SESSOES) {
      expect(await lidasPor(como(apelido), todas), apelido).toEqual([...esperado[apelido]].sort());
    }
    // O servidor le as cinco (anti falso positivo: as cinco existem).
    expect(await lidasPor(admin, todas)).toHaveLength(5);
  });

  it("anon nao le (42501)", async () => {
    const { error } = await anonClient().from("ia_leitura_da_midia").select("message_id").limit(1);
    expect(error?.code).toBe(PERMISSAO_NEGADA);
  });

  it("a tela le as colunas do fio (a transcricao do audio; o resumo da imagem, sem transcricao)", async () => {
    const { data, error } = await como("recepcao-a")
      .from("ia_leitura_da_midia")
      .select("message_id, midia, tipo, transcricao, resumo")
      .in("message_id", [audioA.mensagem, imagemA.mensagem]);
    expect(error).toBeNull();
    const porMensagem = new Map(
      (data as { message_id: string; midia: string; tipo: string; transcricao: string | null; resumo: string | null }[]).map(
        (l) => [l.message_id, l],
      ),
    );
    expect(porMensagem.get(audioA.mensagem)).toEqual({
      message_id: audioA.mensagem,
      midia: "audio",
      tipo: "transcricao",
      transcricao: TRANSCRICAO,
      resumo: null,
    });
    expect(porMensagem.get(imagemA.mensagem)).toEqual({
      message_id: imagemA.mensagem,
      midia: "imagem",
      tipo: "carteirinha",
      transcricao: null,
      resumo: "carteirinha do convênio",
    });
  });
});

describe("ia_leitura_da_midia: ninguem grava pela API", () => {
  it("insert, update e delete de cada papel e da service role: 42501; a leitura fica", async () => {
    for (const cliente of [admin, anonClient(), ...SESSOES.map(como)]) {
      const { error: erroInserir } = await cliente.from("ia_leitura_da_midia").insert({
        clinic_id: clinicaA,
        conversation_id: audioA.conversa,
        message_id: crypto.randomUUID(),
        job_id: crypto.randomUUID(),
        midia: "audio",
        tipo: "sem_fala",
        segundos_de_audio: 3,
        modelo: "whisper-1",
        versao: "transcricao-0123456789ab",
      });
      expect(erroInserir?.code).toBe(PERMISSAO_NEGADA);
      const { error: erroMudar } = await cliente
        .from("ia_leitura_da_midia")
        .update({ transcricao: "outra" })
        .eq("message_id", audioA.mensagem);
      expect(erroMudar?.code).toBe(PERMISSAO_NEGADA);
      const { error: erroApagar } = await cliente.from("ia_leitura_da_midia").delete().eq("message_id", audioA.mensagem);
      expect(erroApagar?.code).toBe(PERMISSAO_NEGADA);
    }
    const { data } = await admin
      .from("ia_leitura_da_midia")
      .select("tipo, transcricao")
      .eq("message_id", audioA.mensagem)
      .single()
      .throwOnError();
    expect(data).toEqual({ tipo: "transcricao", transcricao: TRANSCRICAO });
  });
});

describe("a mensagem apagada leva a leitura", () => {
  it("o administrador apaga o audio pela tela: a leitura sai na mesma transacao, para todos", async () => {
    expect(await lidasPor(admin, [apagadaA.mensagem])).toEqual([apagadaA.mensagem]);
    const { data, error } = await como("admin-a").rpc("apagar_mensagem", {
      p_message_id: apagadaA.mensagem,
      p_escopo: "local",
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, acao: "apagar" });
    expect(await lidasPor(admin, [apagadaA.mensagem])).toEqual([]);
    expect(await lidasPor(como("recepcao-a"), [apagadaA.mensagem])).toEqual([]);
    // A transcricao nao foi ao cofre (D-93): o cofre guarda o audio.
    const { data: cofre } = await admin
      .from("message_apagada")
      .select("content_type, body, transcript")
      .eq("message_id", apagadaA.mensagem)
      .single()
      .throwOnError();
    expect(cofre).toEqual({ content_type: "audio", body: null, transcript: null });
  });
});

describe("ia_contato_liberado: a versao do aviso", () => {
  it("a sessao le a versao e nao grava a coluna (42501)", async () => {
    const { data, error } = await como("admin-a")
      .from("ia_contato_liberado")
      .select("aviso_da_openai_versao")
      .eq("clinic_id", clinicaA);
    expect(error).toBeNull();
    expect((data as { aviso_da_openai_versao: number }[]).map((l) => l.aviso_da_openai_versao)).toContain(2);
    const { error: erroMudar } = await como("admin-a")
      .from("ia_contato_liberado")
      .update({ aviso_da_openai_versao: 1 })
      .eq("clinic_id", clinicaA);
    expect(erroMudar?.code).toBe(PERMISSAO_NEGADA);
    const { error: erroInserir } = await como("admin-a").from("ia_contato_liberado").insert({
      clinic_id: clinicaA,
      phone_key: `+55847${digitos}99`,
      ativo: true,
      aviso_da_openai_versao: 2,
    });
    expect(erroInserir?.code).toBe(PERMISSAO_NEGADA);
  });

  it("definir_contato_liberado_da_ia pelo administrador grava a versao, com a trilha; desligar volta a 1", async () => {
    const telefone = `+55848${digitos}01`;
    const { data, error } = await como("admin-t").rpc("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaT,
      p_telefone_e164: telefone,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_confirmou_aviso_da_openai: true,
      p_versao_do_aviso: 2,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
    const { data: linha } = await como("admin-t")
      .from("ia_contato_liberado")
      .select("id, ativo, aviso_da_openai_versao")
      .eq("clinic_id", clinicaT)
      .eq("phone_key", telefone)
      .single()
      .throwOnError();
    const telefoneDaT = linha as { id: string; ativo: boolean; aviso_da_openai_versao: number };
    expect(telefoneDaT).toMatchObject({ ativo: true, aviso_da_openai_versao: 2 });
    const { data: trilha } = await admin
      .from("audit_log")
      .select("user_id, detalhes")
      .eq("entity_id", telefoneDaT.id)
      .eq("action", "confirmou_aviso_da_openai")
      .throwOnError();
    expect(trilha).toEqual([{ user_id: ids.get("admin-t"), detalhes: { versao: 2 } }]);
    // A versao fora de 1 ou 2: 22023, nada muda.
    const { error: erroVersao } = await como("admin-t").rpc("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaT,
      p_telefone_e164: telefone,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_confirmou_aviso_da_openai: true,
      p_versao_do_aviso: 3,
    });
    expect(erroVersao?.code).toBe("22023");
    expect(erroVersao?.message).toBe("versao_do_aviso_invalida");
    // Desligar volta a 1.
    await como("admin-t")
      .rpc("definir_contato_liberado_da_ia", {
        p_clinic_id: clinicaT,
        p_telefone_e164: telefone,
        p_rotulo: null,
        p_ativo: false,
      })
      .throwOnError();
    const { data: depois } = await como("admin-t")
      .from("ia_contato_liberado")
      .select("ativo, aviso_da_openai_versao")
      .eq("id", telefoneDaT.id)
      .single()
      .throwOnError();
    expect(depois).toEqual({ ativo: false, aviso_da_openai_versao: 1 });
  });
});
