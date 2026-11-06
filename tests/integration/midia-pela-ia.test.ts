import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, anonClient } from "../rls/stack";

// Midia na conversa com a IA (AG6b, migration 20261030100000_midia_pela_ia.sql)
// contra o banco REAL, pelo cliente de servico (o servidor, como o motor da
// IA chama) e, para apagar, pela sessao do administrador (a tela) e pelo
// servidor (o WhatsApp). O que o ensaio nao prova, porque roda numa
// transacao so: cada chamada numa transacao propria, pelo PostgREST de
// verdade.
// - gravar_leitura_da_midia: as recusas na ordem do contrato (22004, os
//   22023 com o codigo, sem_posse, job_antigo, fora_da_ia,
//   mensagem_invalida, mensagem_nao_lida, leitura_desligada,
//   midia_bloqueada, procedimento_invalido), o que grava (transcricao,
//   sem_fala, o pedido com os itens do Cadastro, a figurinha local) e a
//   primeira leitura que vale (reutilizado, o mesmo job e outro job);
// - o portao do aviso: o telefone com o aviso de hoje (1) nao manda midia;
//   reconfirmado com o aviso novo (2), manda; desligado, volta a 1; a versao
//   fora de 1 ou 2, 22023; a trilha com {versao};
// - o apagamento pela tela e pelo WhatsApp leva a leitura; depois, a
//   gravacao recusa mensagem_invalida;
// - a poda (pela manutencao do motor): a leitura da mensagem apagada sai; a
//   chave leituras;
// - a atribuicao com a midia (D-96): o audio transcrito e o texto atribuem;
//   o audio sem fala e o que ninguem leu ficam na fila (midia_nao_lida);
//   midia_clinica e midia_nao_identificada nunca atribuem; o
//   documento_do_paciente atribui; os eventos dos tres motivos novos;
// - os CHECKs aceitam os motivos e os papeis novos; o preco do whisper-1;
// - a matriz de arquivos (migration 20261106130000): a carteirinha no cadastro,
//   so o vazio, e as notas, uma vez, sem o numero. ESCRITO E NAO RODADO, como o
//   resto.
//
// ESCRITO NA AG6b E NAO RODADO por quem escreveu: grava no banco. Quem roda
// e o coordenador, DEPOIS de aplicar a migration, com npm run
// test:integration -- midia-pela-ia (um arquivo por vez).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste (slug midia-int-*),
// apagadas no afterAll (as conversas, as mensagens, os jobs, as decisoes, o
// gasto e as leituras vao em cascata), os usuarios desta execucao e os
// arquivos sinteticos que o teste subiu no Storage (bucket midia-conversas,
// so na pasta das clinicas de teste). Nenhum modelo e chamado: a leitura e
// gravada pela RPC com um texto sintetico, como o motor gravaria. A IA e
// liberada so na M, no numero falso (fora da lista fechada: o motor de
// producao nunca reivindica job de clinica de teste, e numero 'fake' nao
// manda nada), e so para telefones ficticios. A LICAO DE 30/10/2026 (commit
// 3f87861 do main): TODO contato de teste nasce kind 'paciente' e o telefone
// e liberado FORCADO (com o aviso confirmado e a versao pedida) ANTES de
// qualquer conversa da clinica existir; definir_contato_liberado_da_ia roda
// ia_desligar na clinica inteira, por isso nenhum definir_* roda depois da
// primeira conversa (o portao do aviso e lido no beforeAll e conferido no
// caso). A conversa principal entra pela ingestao de verdade (com a janela;
// a manutencao do motor acha o telefone forcado e nao a tira da IA); as
// outras sao linhas gravadas direto, sem janela. O interruptor global NUNCA
// e tocado. Nada usa a id da salud-care, da teste123 nem da Conduzza Teste.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// NESTA ORDEM (as clinicas primeiro).
//   delete from public.clinic where slug like 'midia-int-%' and e_de_teste;
//   select u.id, u.email from auth.users u where u.email like 'midia-int-%@teste.dev';
// os usuarios pela API de administracao, e no Storage (midia-conversas) as
// pastas com a id das clinicas apagadas.

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `MidiaInt!${sufixo}`;
const WORKER = `midia-int-${sufixo}`;
// O bucket e o caminho que o worker grava (lib/domain/midia-recebida.ts).
const BUCKET = "midia-conversas";
const TRANSCRICAO = "Oi, queria saber quanto custa a limpeza de pele";
const clinicas: string[] = [];
const usuarios = new Map<string, string>();
const sessoes = new Map<string, SupabaseClient>();
const arquivos: string[] = [];

type Leitura = {
  midia: string;
  tipo: string;
  transcricao: string | null;
  segundos_de_audio: number | null;
  procedimentos: string[];
  fora_do_cadastro: number;
  confianca: string | null;
  resumo: string | null;
};

type Gravacao = {
  ok: boolean;
  motivo?: string;
  reutilizado?: boolean;
  id?: string;
  leitura?: Leitura;
};

type Ingestao = {
  inserted: boolean;
  conversation_id: string | null;
  contact_id: string | null;
  message_id: string | null;
  ia_atendendo?: boolean;
};

type Passagem = { passou: boolean; codigo: string; urgente: boolean };
type Atribuicao = { atribuida: boolean; codigo: string };
type Midia = "audio" | "imagem" | "documento";

let clinicaM = "";
let numeroM = "";
let clinicaB = "";
let numeroB = "";
let examePedido = "";
let outroExame = "";
let exameInativo = "";
let exameDaB = "";
/** Os telefones da M, todos liberados (forcados) antes de qualquer conversa. */
const telefonesM = new Map<string, string>();
/** O portao do aviso, lido no beforeAll (antes das conversas). */
const aviso = new Map<string, boolean | number | null>();
let telefoneDaB = "";

const pessoa = (apelido: string) => usuarios.get(apelido)!;

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

async function novaClinica(nome: string): Promise<string> {
  const id = await inserir("clinic", {
    name: `Midia Int ${nome} ${sufixo}`,
    slug: `midia-int-${nome.toLowerCase()}-${sufixo}`,
    e_de_teste: true,
    timezone: "America/Fortaleza",
  });
  clinicas.push(id);
  return id;
}

async function publicar(clinica: string, versao: number, skills: Record<string, boolean>): Promise<void> {
  await inserir("ai_agent_config", {
    clinic_id: clinica,
    version: versao,
    status: "publicada",
    published_at: new Date().toISOString(),
    skills,
    escalation_rules: { passagem_para: "responsavel_do_lead" },
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: false,
  });
}

async function criarPessoa(apelido: string, clinica: string, papel: string, sessao = false): Promise<void> {
  const email = `midia-int-${apelido}-${sufixo}@teste.dev`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: apelido },
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuário"}`);
  }
  usuarios.set(apelido, data.user.id);
  await admin
    .from("clinic_member")
    .insert({ clinic_id: clinica, user_id: data.user.id, role: papel, status: "ativo" })
    .throwOnError();
  if (sessao) {
    const cliente = anonClient();
    const { error: erroLogin } = await cliente.auth.signInWithPassword({ email, password: SENHA });
    if (erroLogin) {
      throw new Error(`login ${apelido}: ${erroLogin.message}`);
    }
    sessoes.set(apelido, cliente);
  }
}

/**
 * O telefone de teste ANTES de qualquer conversa (a licao de 30/10/2026): o
 * contato nasce paciente (com a dona como responsavel do lead) e o telefone
 * e liberado forcado, com o aviso na versao pedida.
 */
async function telefoneLiberado(clinica: string, nome: string, versao: 1 | 2): Promise<string> {
  const telefone = `+55846${digitos}${String(telefonesM.size + 10).padStart(2, "0")}`;
  telefonesM.set(nome, telefone);
  await admin
    .from("contact")
    .insert({
      clinic_id: clinica,
      phone_e164: telefone,
      name: "Contato sintético",
      kind: "paciente",
      owner_user_id: usuarios.get("dona") ?? null,
    })
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
      p_versao_do_aviso: versao,
    }),
  ).toBe(true);
  return telefone;
}

async function liberada(clinica: string, telefone: string): Promise<boolean> {
  return rpcOk<boolean>("midia_da_ia_liberada", { p_clinic_id: clinica, p_telefone: telefone });
}

async function versaoDoTelefone(clinica: string, telefone: string): Promise<number> {
  const { data } = await admin
    .from("ia_contato_liberado")
    .select("aviso_da_openai_versao")
    .eq("clinic_id", clinica)
    .eq("phone_key", telefone)
    .single()
    .throwOnError();
  return (data as { aviso_da_openai_versao: number }).aviso_da_openai_versao;
}

/** O arquivo sintetico no Storage e a mensagem apontando para ele, como o worker deixa. */
async function noStorage(clinica: string, mensagem: string, midia: Midia): Promise<void> {
  const caminho = `${clinica}/${mensagem}`;
  const tipo = midia === "audio" ? "audio/mpeg" : midia === "imagem" ? "image/jpeg" : "application/pdf";
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(caminho, new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0])], { type: tipo }), {
      contentType: tipo,
      upsert: true,
    });
  expect(error, "subir o arquivo sintetico").toBeNull();
  arquivos.push(caminho);
  await admin
    .from("message")
    .update({ media_url: `storage://${BUCKET}/${caminho}`, media_mimetype: tipo })
    .eq("id", mensagem)
    .throwOnError();
}

/** A conversa pela ingestao de verdade (com a janela), a midia do paciente ainda no provedor. */
async function pelaIngestao(nome: string, midia: Midia): Promise<{ conversa: string; mensagem: string }> {
  const r = await rpcOk<Ingestao>("ingest_inbound_message", {
    p_clinic_id: clinicaM,
    p_phone_e164: telefonesM.get(nome)!,
    p_name: "Contato sintético",
    p_wa_message_id: `midia-int:${sufixo}:${nome}`,
    p_content_type: midia,
    p_body: null,
    p_media_url: "https://mmg.whatsapp.net/x/sintetico.enc",
    p_media_mimetype: midia === "audio" ? "audio/mpeg" : "image/jpeg",
    p_whatsapp_account_id: numeroM,
  });
  expect(r, "a ingestao").toMatchObject({ inserted: true, ia_atendendo: true });
  return { conversa: r.conversation_id!, mensagem: r.message_id! };
}

/** A conversa na IA gravada direto (sem janela) do contato do telefone, e uma midia ja no Storage. */
async function direta(
  clinica: string,
  numero: string,
  telefone: string,
  midia: Midia | "texto",
  status = "ia_atendendo",
): Promise<{ conversa: string; mensagem: string }> {
  const { data } = await admin
    .from("contact")
    .select("id")
    .eq("clinic_id", clinica)
    .eq("phone_e164", telefone)
    .single()
    .throwOnError();
  const conversa = await inserir("conversation", {
    clinic_id: clinica,
    contact_id: (data as { id: string }).id,
    status,
    awaiting_reply: false,
    whatsapp_account_id: numero,
  });
  const mensagem = await outraMensagem(clinica, conversa, midia);
  return { conversa, mensagem };
}

async function outraMensagem(clinica: string, conversa: string, midia: Midia | "texto"): Promise<string> {
  const mensagem = await inserir("message", {
    clinic_id: clinica,
    conversation_id: conversa,
    direction: "entrada",
    author: "paciente",
    content_type: midia,
    body: midia === "texto" ? "Mensagem sintética" : null,
  });
  if (midia !== "texto") {
    await noStorage(clinica, mensagem, midia);
  }
  return mensagem;
}

/** Um job da IA em execucao da conversa (criado em `criado`), com o turno que leu as mensagens. */
async function jobQueLeu(
  clinica: string,
  numero: string,
  conversa: string,
  lidas: string[],
  criado?: string,
): Promise<string> {
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
    ...(criado ? { created_at: criado } : {}),
  });
  if (lidas.length > 0) {
    await admin
      .from("ai_turno")
      .upsert(
        { job_id: job, clinic_id: clinica, conversation_id: conversa, estado: "reservado", mensagens_lidas: lidas },
        { onConflict: "job_id" },
      )
      .throwOnError();
  }
  return job;
}

function doAudio(job: string, mensagem: string): Record<string, unknown> {
  return {
    p_job_id: job,
    p_worker: WORKER,
    p_message_id: mensagem,
    p_midia: "audio",
    p_tipo: "transcricao",
    p_transcricao: TRANSCRICAO,
    p_segundos: 15,
    p_procedimentos: null,
    p_fora_do_cadastro: null,
    p_confianca: null,
    p_resumo: null,
    p_modelo: "whisper-1",
    p_versao: "transcricao-0123456789ab",
  };
}

function doPedido(job: string, mensagem: string, midia: "imagem" | "documento" = "imagem"): Record<string, unknown> {
  return {
    p_job_id: job,
    p_worker: WORKER,
    p_message_id: mensagem,
    p_midia: midia,
    p_tipo: "pedido_de_exame_ou_procedimento",
    p_transcricao: null,
    p_segundos: null,
    p_procedimentos: [examePedido, outroExame],
    p_fora_do_cadastro: 0,
    p_confianca: "alta",
    p_resumo: "pedido com Hemograma e Glicemia de jejum",
    p_modelo: "gpt-6-luna",
    p_versao: "leitor-0123456789ab",
  };
}

async function gravar(args: Record<string, unknown>): Promise<Gravacao> {
  return rpcOk<Gravacao>("gravar_leitura_da_midia", args);
}

async function erroDaGravacao(args: Record<string, unknown>): Promise<{ code: string | undefined; message: string | undefined }> {
  const { data, error } = await admin.rpc("gravar_leitura_da_midia", args);
  expect(data, "a gravacao com erro nao devolve dado").toBeNull();
  return { code: error?.code, message: error?.message };
}

async function leituraDe(mensagem: string): Promise<Record<string, unknown> | null> {
  const { data } = await admin
    .from("ia_leitura_da_midia")
    .select("clinic_id, conversation_id, job_id, midia, tipo, transcricao, segundos_de_audio, procedimentos, fora_do_cadastro, confianca, resumo, modelo, versao")
    .eq("message_id", mensagem)
    .maybeSingle()
    .throwOnError();
  return data as Record<string, unknown> | null;
}

async function concluir(job: string): Promise<void> {
  await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
}

async function decidir(clinica: string, conversa: string, job: string, motivo: string): Promise<void> {
  await admin
    .from("ai_decision_log")
    .insert({
      clinic_id: clinica,
      conversation_id: conversa,
      job_id: job,
      desfecho: motivo === "falha_tecnica" ? "falhou" : "escalou",
      escalation_reason: motivo,
      aprovado: false,
      compliance_blocked: false,
      motivo_da_falha: motivo === "falha_tecnica" ? "prazo" : null,
    })
    .throwOnError();
}

/** O caminho do motor: a decisao, a passagem e, depois da frase, a atribuicao; o job conclui no fim. */
async function passarEAtribuir(conversa: string, job: string, motivo: string): Promise<{ passagem: Passagem; atribuicao: Atribuicao }> {
  await decidir(clinicaM, conversa, job, motivo);
  const passagem = await rpcOk<Passagem>("passar_conversa_da_ia_para_equipe", {
    p_job_id: job,
    p_worker: WORKER,
    p_motivo: motivo,
  });
  const atribuicao = await rpcOk<Atribuicao>("atribuir_conversa_passada_pela_ia", { p_job_id: job, p_worker: WORKER });
  await concluir(job);
  return { passagem, atribuicao };
}

async function eventos(conversa: string): Promise<string[]> {
  const { data } = await admin
    .from("message")
    .select("body")
    .eq("conversation_id", conversa)
    .eq("author", "sistema")
    .eq("content_type", "evento")
    .throwOnError();
  return (data as { body: string }[]).map((m) => m.body).sort();
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "midia-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaM = await novaClinica("M");
  numeroM = (await criarNumeroDeTeste(admin, clinicaM, { nome: "Recepção" })).id;
  clinicaB = await novaClinica("B");
  numeroB = (await criarNumeroDeTeste(admin, clinicaB, { nome: "Recepção" })).id;
  await criarPessoa("dona", clinicaM, "recepcao");
  await criarPessoa("admin-m", clinicaM, "admin", true);
  examePedido = await inserir("procedure", { clinic_id: clinicaM, name: "Hemograma", default_duration_min: 30 });
  outroExame = await inserir("procedure", { clinic_id: clinicaM, name: "Glicemia de jejum", default_duration_min: 30 });
  exameInativo = await inserir("procedure", {
    clinic_id: clinicaM,
    name: "Exame inativo",
    default_duration_min: 30,
    active: false,
  });
  exameDaB = await inserir("procedure", { clinic_id: clinicaB, name: "Hemograma da B", default_duration_min: 30 });
  await publicar(clinicaM, 1, { ler_audio: true, ler_imagem_e_documento: true });
  await publicar(clinicaB, 1, { ler_audio: true, ler_imagem_e_documento: true });
  for (const [clinica, numero] of [
    [clinicaM, numeroM],
    [clinicaB, numeroB],
  ] as const) {
    await rpcOk("definir_liberacao_da_ia", {
      p_clinic_id: clinica,
      p_liberada: true,
      p_modo: "contatos",
      p_motivo: "teste de integracao da AG6b",
    });
    await rpcOk("definir_numero_da_ia", { p_clinic_id: clinica, p_whatsapp_account_id: numero, p_ativo: true });
  }

  // TODOS os telefones, antes de qualquer conversa (a licao de 30/10/2026).
  for (const nome of [
    "principal",
    "recusas",
    "fila",
    "grava",
    "apaga-tela",
    "apaga-whatsapp",
    "poda",
    "texto",
    "transcrito",
    "sem-fala",
    "ninguem-leu",
    "clinica",
    "documento",
    "nao-identificada",
    "carteirinha-vazia",
    "carteirinha-diferente",
    "carteirinha-recusas",
    "pedido-parcial",
  ]) {
    await telefoneLiberado(clinicaM, nome, 2);
  }
  // O portao do aviso: o aviso de hoje (1); reconfirmado com o novo (2); desligado.
  const v1 = await telefoneLiberado(clinicaM, "aviso-1", 1);
  aviso.set("v1-liberada", await liberada(clinicaM, v1));
  const v12 = await telefoneLiberado(clinicaM, "aviso-1-depois-2", 1);
  aviso.set("v12-antes", await liberada(clinicaM, v12));
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinicaM,
    p_telefone_e164: v12,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_forcar_contato_existente: true,
    p_confirmou_aviso_da_openai: true,
    p_confirmou_teste_com_paciente: true,
    p_versao_do_aviso: 2,
  });
  aviso.set("v12-depois", await liberada(clinicaM, v12));
  aviso.set("v12-versao", await versaoDoTelefone(clinicaM, v12));
  const desligado = await telefoneLiberado(clinicaM, "desligado", 2);
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinicaM,
    p_telefone_e164: desligado,
    p_rotulo: null,
    p_ativo: false,
  });
  aviso.set("desligado-liberada", await liberada(clinicaM, desligado));
  aviso.set("desligado-versao", await versaoDoTelefone(clinicaM, desligado));
  const { error: erroVersao } = await admin.rpc("definir_contato_liberado_da_ia", {
    p_clinic_id: clinicaM,
    p_telefone_e164: v1,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_forcar_contato_existente: true,
    p_confirmou_aviso_da_openai: true,
    p_confirmou_teste_com_paciente: true,
    p_versao_do_aviso: 3,
  });
  aviso.set("versao-3", erroVersao?.message === "versao_do_aviso_invalida" && erroVersao.code === "22023");
  aviso.set("v1-versao-depois-do-erro", await versaoDoTelefone(clinicaM, v1));
  // O telefone da B (a conversa de outra clinica).
  telefoneDaB = `+55846${digitos}99`;
  await admin
    .from("contact")
    .insert({ clinic_id: clinicaB, phone_e164: telefoneDaB, name: "Contato sintético", kind: "paciente" })
    .throwOnError();
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinicaB,
    p_telefone_e164: telefoneDaB,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_forcar_contato_existente: true,
    p_confirmou_aviso_da_openai: true,
    p_confirmou_teste_com_paciente: true,
    p_versao_do_aviso: 2,
  });
}, 240_000);

afterAll(async () => {
  if (arquivos.length > 0) {
    await admin.storage.from(BUCKET).remove(arquivos);
  }
  if (clinicas.length > 0) {
    await admin.from("clinic").delete().in("id", clinicas);
  }
  for (const id of usuarios.values()) {
    await admin.auth.admin.deleteUser(id);
  }
}, 120_000);

describe("o portao do aviso dos telefones (D-60, D-95)", () => {
  it("o aviso de hoje nao manda midia; reconfirmado com o novo, manda; desligado, volta a 1; a versao 3, 22023", () => {
    expect(Object.fromEntries(aviso)).toEqual({
      "v1-liberada": false,
      "v12-antes": false,
      "v12-depois": true,
      "v12-versao": 2,
      "desligado-liberada": false,
      "desligado-versao": 1,
      "versao-3": true,
      "v1-versao-depois-do-erro": 1,
    });
  });

  it("a trilha da confirmacao do aviso guarda a versao", async () => {
    const { data } = await admin
      .from("audit_log")
      .select("detalhes")
      .eq("clinic_id", clinicaM)
      .eq("action", "confirmou_aviso_da_openai")
      .throwOnError();
    const versoes = (data as { detalhes: { versao?: number } | null }[]).map((l) => l.detalhes?.versao ?? null);
    expect(versoes.length).toBeGreaterThan(0);
    expect(versoes.every((v) => v === 1 || v === 2)).toBe(true);
    expect(versoes).toContain(1);
    expect(versoes).toContain(2);
  });
});

describe("gravar_leitura_da_midia: as recusas, na ordem do contrato", () => {
  it("a conversa pela ingestao: o audio ainda no provedor, depois no Storage; cada recusa e o que grava", async () => {
    const { conversa, mensagem } = await pelaIngestao("principal", "audio");
    const job = await jobQueLeu(clinicaM, numeroM, conversa, [mensagem]);
    // O audio ainda no provedor (o worker nao baixou): mensagem_invalida.
    expect(await gravar(doAudio(job, mensagem))).toEqual({ ok: false, motivo: "mensagem_invalida" });
    await noStorage(clinicaM, mensagem, "audio");

    // 22004 e os 22023 (o codigo na mensagem), antes da posse.
    expect(await erroDaGravacao({ ...doAudio(job, mensagem), p_versao: null })).toEqual({
      code: "22004",
      message: "parametro_nulo",
    });
    const regras: [Record<string, unknown>, string][] = [
      [{ p_midia: "video" }, "midia_invalida"],
      [{ p_tipo: "carteirinha" }, "tipo_invalido"],
      [{ p_transcricao: null }, "transcricao_invalida"],
      [{ p_segundos: 151 }, "segundos_invalidos"],
      [{ p_procedimentos: [examePedido] }, "itens_invalidos"],
      [{ p_fora_do_cadastro: 1 }, "fora_do_cadastro_invalido"],
      [{ p_confianca: "alta" }, "confianca_invalida"],
      [{ p_resumo: "resumo no audio" }, "resumo_invalido"],
      [{ p_modelo: "GPT-6" }, "modelo_invalido"],
      [{ p_versao: "leitor-0123456789ab" }, "versao_invalida"],
      [{ p_midia: "video", p_worker: "outro" }, "midia_invalida"],
    ];
    for (const [troca, codigo] of regras) {
      expect(await erroDaGravacao({ ...doAudio(job, mensagem), ...troca }), codigo).toEqual({
        code: "22023",
        message: codigo,
      });
    }

    // sem_posse: outro worker; o job da B com a conversa da M.
    expect(await gravar({ ...doAudio(job, mensagem), p_worker: "outro" })).toEqual({ ok: false, motivo: "sem_posse" });
    const jobDaB = await jobQueLeu(clinicaB, numeroB, conversa, [mensagem]);
    expect(await gravar(doAudio(jobDaB, mensagem))).toEqual({ ok: false, motivo: "sem_posse" });
    await concluir(jobDaB);

    // job_antigo (D-A): o job criado antes da janela da ingestao.
    const antigo = await jobQueLeu(clinicaM, numeroM, conversa, [mensagem], new Date(Date.now() - 60 * 60_000).toISOString());
    expect(await gravar(doAudio(antigo, mensagem))).toEqual({ ok: false, motivo: "job_antigo" });
    await concluir(antigo);

    // mensagem_nao_lida: o job que nao leu o audio.
    const outraMidia = await outraMensagem(clinicaM, conversa, "audio");
    expect(await gravar(doAudio(job, outraMidia))).toEqual({ ok: false, motivo: "mensagem_nao_lida" });
    // mensagem_invalida antes de mensagem_nao_lida: a midia de outro tipo.
    expect(await gravar(doPedido(job, outraMidia))).toEqual({ ok: false, motivo: "mensagem_invalida" });

    // leitura_desligada: a ultima publicada sem ler_audio.
    await publicar(clinicaM, 2, { ler_audio: false, ler_imagem_e_documento: true });
    expect(await gravar(doAudio(job, mensagem))).toEqual({ ok: false, motivo: "leitura_desligada" });
    await publicar(clinicaM, 3, { ler_audio: true, ler_imagem_e_documento: true });

    // O que grava, e a primeira leitura vale.
    const r = await gravar(doAudio(job, mensagem));
    expect(r).toMatchObject({ ok: true, reutilizado: false });
    expect(await leituraDe(mensagem)).toEqual({
      clinic_id: clinicaM,
      conversation_id: conversa,
      job_id: job,
      midia: "audio",
      tipo: "transcricao",
      transcricao: TRANSCRICAO,
      segundos_de_audio: 15,
      procedimentos: [],
      fora_do_cadastro: 0,
      confianca: null,
      resumo: null,
      modelo: "whisper-1",
      versao: "transcricao-0123456789ab",
    });
    expect(await gravar({ ...doAudio(job, mensagem), p_tipo: "sem_fala", p_transcricao: null })).toEqual({
      ok: true,
      reutilizado: true,
      id: r.id,
      leitura: {
        midia: "audio",
        tipo: "transcricao",
        transcricao: TRANSCRICAO,
        segundos_de_audio: 15,
        procedimentos: [],
        fora_do_cadastro: 0,
        confianca: null,
        resumo: null,
        convenio_lido_id: null,
      },
    });
    const outroJob = await jobQueLeu(clinicaM, numeroM, conversa, [mensagem]);
    expect(await gravar(doAudio(outroJob, mensagem))).toMatchObject({ ok: true, reutilizado: true, id: r.id });
    await concluir(outroJob);
    await concluir(job);
  });

  it("fora_da_ia (a conversa na fila) e midia_bloqueada (o telefone com o aviso de hoje)", async () => {
    const naFila = await direta(clinicaM, numeroM, telefonesM.get("fila")!, "audio", "aguardando_humano");
    const job = await jobQueLeu(clinicaM, numeroM, naFila.conversa, [naFila.mensagem]);
    expect(await gravar(doAudio(job, naFila.mensagem))).toEqual({ ok: false, motivo: "fora_da_ia" });
    await concluir(job);
    const doAvisoDeHoje = await direta(clinicaM, numeroM, telefonesM.get("aviso-1")!, "audio");
    const outro = await jobQueLeu(clinicaM, numeroM, doAvisoDeHoje.conversa, [doAvisoDeHoje.mensagem]);
    expect(await gravar(doAudio(outro, doAvisoDeHoje.mensagem))).toEqual({ ok: false, motivo: "midia_bloqueada" });
    // midia_bloqueada antes de procedimento_invalido.
    const imagem = await outraMensagem(clinicaM, doAvisoDeHoje.conversa, "imagem");
    await admin
      .from("ai_turno")
      .update({ mensagens_lidas: [doAvisoDeHoje.mensagem, imagem] })
      .eq("job_id", outro)
      .throwOnError();
    expect(await gravar({ ...doPedido(outro, imagem), p_procedimentos: [exameInativo] })).toEqual({
      ok: false,
      motivo: "midia_bloqueada",
    });
    await concluir(outro);
    // O telefone reconfirmado com o aviso novo manda midia.
    const reconfirmado = await direta(clinicaM, numeroM, telefonesM.get("aviso-1-depois-2")!, "audio");
    const terceiro = await jobQueLeu(clinicaM, numeroM, reconfirmado.conversa, [reconfirmado.mensagem]);
    expect(await gravar(doAudio(terceiro, reconfirmado.mensagem))).toMatchObject({ ok: true, reutilizado: false });
    await concluir(terceiro);
  });

  it("o pedido: os itens do Cadastro (procedimento_invalido: inativo, de outra clinica); o que grava", async () => {
    const { conversa, mensagem } = await direta(clinicaM, numeroM, telefonesM.get("recusas")!, "imagem");
    const job = await jobQueLeu(clinicaM, numeroM, conversa, [mensagem]);
    expect(await gravar({ ...doPedido(job, mensagem), p_procedimentos: [examePedido, exameInativo] })).toEqual({
      ok: false,
      motivo: "procedimento_invalido",
    });
    expect(await gravar({ ...doPedido(job, mensagem), p_procedimentos: [exameDaB] })).toEqual({
      ok: false,
      motivo: "procedimento_invalido",
    });
    expect(await gravar(doPedido(job, mensagem))).toMatchObject({ ok: true, reutilizado: false });
    expect(await leituraDe(mensagem)).toMatchObject({
      midia: "imagem",
      tipo: "pedido_de_exame_ou_procedimento",
      procedimentos: [examePedido, outroExame],
      confianca: "alta",
      resumo: "pedido com Hemograma e Glicemia de jejum",
    });
    // A figurinha local (sem modelo) e o audio sem fala.
    const figurinha = await outraMensagem(clinicaM, conversa, "imagem");
    const semFala = await outraMensagem(clinicaM, conversa, "audio");
    await admin
      .from("ai_turno")
      .update({ mensagens_lidas: [mensagem, figurinha, semFala] })
      .eq("job_id", job)
      .throwOnError();
    expect(
      await gravar({
        ...doPedido(job, figurinha),
        p_tipo: "figurinha",
        p_procedimentos: [],
        p_resumo: null,
        p_modelo: "local",
        p_versao: "figurinha-0123456789ab",
      }),
    ).toMatchObject({ ok: true, reutilizado: false });
    expect(await gravar({ ...doAudio(job, semFala), p_tipo: "sem_fala", p_transcricao: null, p_segundos: 3 })).toMatchObject({
      ok: true,
      reutilizado: false,
    });
    expect(await leituraDe(semFala)).toMatchObject({ tipo: "sem_fala", transcricao: null, segundos_de_audio: 3 });
    await concluir(job);
  });
});

describe("o apagamento leva a leitura", () => {
  it("pela tela (o administrador) e pelo WhatsApp (o paciente); depois, mensagem_invalida", async () => {
    const tela = await direta(clinicaM, numeroM, telefonesM.get("apaga-tela")!, "audio");
    const jobTela = await jobQueLeu(clinicaM, numeroM, tela.conversa, [tela.mensagem]);
    expect(await gravar(doAudio(jobTela, tela.mensagem))).toMatchObject({ ok: true });
    const { data, error } = await sessoes.get("admin-m")!.rpc("apagar_mensagem", {
      p_message_id: tela.mensagem,
      p_escopo: "local",
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, acao: "apagar" });
    expect(await leituraDe(tela.mensagem)).toBeNull();
    expect(await gravar(doAudio(jobTela, tela.mensagem))).toEqual({ ok: false, motivo: "mensagem_invalida" });
    await concluir(jobTela);

    const zap = await direta(clinicaM, numeroM, telefonesM.get("apaga-whatsapp")!, "imagem");
    await admin
      .from("message")
      .update({ wa_message_id: `midia-int:${sufixo}:apaga-whatsapp` })
      .eq("id", zap.mensagem)
      .throwOnError();
    const jobZap = await jobQueLeu(clinicaM, numeroM, zap.conversa, [zap.mensagem]);
    expect(await gravar(doPedido(jobZap, zap.mensagem))).toMatchObject({ ok: true });
    const apagou = await rpcOk<{ ok: boolean; origem: string }>("registrar_apagamento_do_whatsapp", {
      p_clinic_id: clinicaM,
      p_wa_message_id: `midia-int:${sufixo}:apaga-whatsapp`,
    });
    expect(apagou).toMatchObject({ ok: true, origem: "paciente" });
    expect(await leituraDe(zap.mensagem)).toBeNull();
    await concluir(jobZap);
  });
});

describe("a poda, pela manutencao do motor", () => {
  it("a leitura da mensagem apagada sem passar pelo apagamento sai; a chave leituras", async () => {
    const { conversa, mensagem } = await direta(clinicaM, numeroM, telefonesM.get("poda")!, "audio");
    const job = await jobQueLeu(clinicaM, numeroM, conversa, [mensagem]);
    expect(await gravar(doAudio(job, mensagem))).toMatchObject({ ok: true });
    await concluir(job);
    await admin.from("message").update({ deleted_at: new Date().toISOString() }).eq("id", mensagem).throwOnError();
    expect(await leituraDe(mensagem)).not.toBeNull();
    const r = await rpcOk<{ agendamento_da_ia?: { leituras?: number } }>("motor_manutencao");
    // A manutencao do cron pode ter podado antes (roda a cada minuto): a
    // chave existe e a leitura nao fica.
    expect(typeof r.agendamento_da_ia?.leituras).toBe("number");
    expect(await leituraDe(mensagem)).toBeNull();
  });
});

// Muitos casos com o banco de verdade: 30 s estouram com a maquina carregada.
describe("a atribuicao com a midia (D-96) e os motivos novos", { timeout: 120_000 }, () => {
  it("o texto e o audio transcrito atribuem; o sem fala e o que ninguem leu ficam na fila", async () => {
    const casos: [string, Midia | "texto", "transcrita" | "sem_fala" | "nenhuma", string][] = [
      ["texto", "texto", "nenhuma", "atribuida"],
      ["transcrito", "audio", "transcrita", "atribuida"],
      ["sem-fala", "audio", "sem_fala", "midia_nao_lida"],
      ["ninguem-leu", "audio", "nenhuma", "midia_nao_lida"],
    ];
    for (const [nome, midia, leitura, esperado] of casos) {
      const { conversa, mensagem } = await direta(clinicaM, numeroM, telefonesM.get(nome)!, midia);
      const job = await jobQueLeu(clinicaM, numeroM, conversa, [mensagem]);
      if (leitura === "transcrita") {
        expect(await gravar(doAudio(job, mensagem))).toMatchObject({ ok: true });
      } else if (leitura === "sem_fala") {
        expect(await gravar({ ...doAudio(job, mensagem), p_tipo: "sem_fala", p_transcricao: null })).toMatchObject({ ok: true });
      }
      const { passagem, atribuicao } = await passarEAtribuir(conversa, job, "falha_tecnica");
      expect(passagem.passou, nome).toBe(true);
      expect(atribuicao, nome).toEqual({ atribuida: esperado === "atribuida", codigo: esperado });
      const { data } = await admin
        .from("conversation")
        .select("status, assignee_user_id")
        .eq("id", conversa)
        .single()
        .throwOnError();
      expect(data, nome).toEqual(
        esperado === "atribuida"
          ? { status: "em_atendimento", assignee_user_id: pessoa("dona") }
          : { status: "aguardando_humano", assignee_user_id: null },
      );
    }
  });

  it("midia_clinica e midia_nao_identificada nunca atribuem; documento_do_paciente atribui; os eventos", async () => {
    const casos: [string, Midia, string, string, string][] = [
      [
        "clinica",
        "imagem",
        "resultado_ou_laudo",
        "midia_clinica",
        "A IA passou a conversa para a equipe: o paciente mandou um arquivo que só a equipe pode avaliar.",
      ],
      [
        "documento",
        "documento",
        "carteirinha",
        "documento_do_paciente",
        "A IA passou a conversa para a equipe: o paciente mandou a carteirinha, uma guia do convênio ou um documento pessoal.",
      ],
      [
        "nao-identificada",
        "imagem",
        "outro",
        "midia_nao_identificada",
        "A IA passou a conversa para a equipe: o assistente não identificou o arquivo que o paciente mandou.",
      ],
    ];
    for (const [nome, midia, tipo, motivo, evento] of casos) {
      const { conversa, mensagem } = await direta(clinicaM, numeroM, telefonesM.get(nome)!, midia);
      const job = await jobQueLeu(clinicaM, numeroM, conversa, [mensagem]);
      expect(
        await gravar({
          ...doPedido(job, mensagem, midia === "documento" ? "documento" : "imagem"),
          p_tipo: tipo,
          p_procedimentos: [],
          p_resumo: "arquivo sintetico, passado para a equipe",
        }),
      ).toMatchObject({ ok: true });
      const { atribuicao } = await passarEAtribuir(conversa, job, motivo);
      const atribui = motivo === "documento_do_paciente";
      expect(atribuicao, nome).toEqual({ atribuida: atribui, codigo: atribui ? "atribuida" : "motivo_nao_atribui" });
      expect(await eventos(conversa), nome).toContain(evento);
    }
  });
});

describe("a matriz de arquivos (migration 20261106130000): a carteirinha e as notas", () => {
  const NUMERO = "99887766554433ZQ";
  let convenio = "";

  beforeAll(async () => {
    convenio = await inserir("insurance", {
      clinic_id: clinicaM,
      name: "Convenio sintetico",
      requires_card: true,
      active: true,
    });
  });

  const contatoDe = async (nome: string) => {
    const { data } = await admin
      .from("contact")
      .select("id, kind, insurance_card, insurance_id")
      .eq("clinic_id", clinicaM)
      .eq("phone_e164", telefonesM.get(nome)!)
      .single()
      .throwOnError();
    return data as { id: string; kind: string; insurance_card: string | null; insurance_id: string | null };
  };
  const notasDe = async (conversa: string) => {
    const { data } = await admin
      .from("message")
      .select("body, author, direction, billable, cost_cents, job_id, is_internal_note")
      .eq("conversation_id", conversa)
      .eq("is_internal_note", true)
      .throwOnError();
    return (data ?? []) as Record<string, unknown>[];
  };
  const daCarteirinha = (job: string, mensagem: string, extra: Record<string, unknown> = {}) => ({
    ...doPedido(job, mensagem),
    p_tipo: "carteirinha",
    p_procedimentos: [],
    p_resumo: "carteirinha do convênio",
    p_convenio_lido: convenio,
    p_numero_da_carteirinha: NUMERO,
    ...extra,
  });

  it("com o cadastro vazio: grava o numero e o plano, uma vez; a trilha e a resposta sem o valor", async () => {
    const { conversa, mensagem } = await direta(clinicaM, numeroM, telefonesM.get("carteirinha-vazia")!, "imagem");
    const job = await jobQueLeu(clinicaM, numeroM, conversa, [mensagem]);
    const gravada = await gravar(daCarteirinha(job, mensagem));
    expect(gravada).toMatchObject({
      ok: true,
      reutilizado: false,
      carteirinha_no_cadastro: true,
      convenio_do_cadastro: convenio,
    });
    expect(JSON.stringify(gravada)).not.toContain(NUMERO);
    const contato = await contatoDe("carteirinha-vazia");
    expect(contato).toMatchObject({ insurance_card: NUMERO, insurance_id: convenio, kind: "paciente" });
    expect(await leituraDe(mensagem)).toMatchObject({ tipo: "carteirinha", resumo: "carteirinha do convênio" });
    expect(JSON.stringify(await leituraDe(mensagem))).not.toContain(NUMERO);
    const { data: trilha } = await admin
      .from("audit_log")
      .select("detalhes")
      .eq("entity_id", contato.id)
      .eq("action", "gravou_carteirinha_lida")
      .throwOnError();
    expect(trilha).toEqual([{ detalhes: { campos: ["insurance_card", "insurance_id"], message_id: mensagem } }]);
    // O job repetido: a primeira vale, com outro numero, sem nota e sem trilha nova.
    const repetida = await gravar(daCarteirinha(job, mensagem, { p_numero_da_carteirinha: "11112222333344" }));
    expect(repetida).toMatchObject({ ok: true, reutilizado: true, carteirinha_no_cadastro: true });
    expect((await contatoDe("carteirinha-vazia")).insurance_card).toBe(NUMERO);
    expect(await notasDe(conversa)).toEqual([]);
    await concluir(job);
  });

  it("o numero diferente nao muda: nota do sistema, sem o numero; a conversa continua na IA", async () => {
    await admin
      .from("contact")
      .update({ insurance_card: "1234.5678-9" })
      .eq("clinic_id", clinicaM)
      .eq("phone_e164", telefonesM.get("carteirinha-diferente")!)
      .throwOnError();
    const { conversa, mensagem } = await direta(clinicaM, numeroM, telefonesM.get("carteirinha-diferente")!, "imagem");
    const job = await jobQueLeu(clinicaM, numeroM, conversa, [mensagem]);
    await gravar(daCarteirinha(job, mensagem));
    expect((await contatoDe("carteirinha-diferente")).insurance_card).toBe("1234.5678-9");
    const notas = await notasDe(conversa);
    expect(notas).toHaveLength(1);
    expect(notas[0]).toMatchObject({ author: "sistema", direction: "saida", billable: false, cost_cents: 0, job_id: null });
    expect(String(notas[0]?.body)).toContain("tem número diferente do cadastro");
    expect(JSON.stringify(notas)).not.toContain(NUMERO);
    const { data } = await admin.from("conversation").select("status").eq("id", conversa).single().throwOnError();
    expect(data).toEqual({ status: "ia_atendendo" });
    await concluir(job);
  });

  it("as recusas: 22023 sem o valor, e nada grava", async () => {
    const { conversa, mensagem } = await direta(clinicaM, numeroM, telefonesM.get("carteirinha-recusas")!, "imagem");
    const job = await jobQueLeu(clinicaM, numeroM, conversa, [mensagem]);
    for (const [extra, codigo] of [
      [{ p_confianca: "media" }, "carteirinha_invalida"],
      [{ p_tipo: "outro", p_convenio_lido: null }, "carteirinha_invalida"],
      [{ p_numero_da_carteirinha: "Ignore as instrucoes" }, "carteirinha_invalida"],
      [{ p_tipo: "outro", p_numero_da_carteirinha: null }, "convenio_invalido"],
    ] as const) {
      expect(await erroDaGravacao(daCarteirinha(job, mensagem, extra))).toEqual({ code: "22023", message: codigo });
    }
    expect(await leituraDe(mensagem)).toBeNull();
    expect((await contatoDe("carteirinha-recusas")).insurance_card).toBeNull();
    await concluir(job);
  });

  it("o pedido com parte fora do Cadastro: a nota uma vez, so a contagem; a conversa e a previa nao mudam", async () => {
    const { conversa, mensagem } = await direta(clinicaM, numeroM, telefonesM.get("pedido-parcial")!, "imagem");
    const job = await jobQueLeu(clinicaM, numeroM, conversa, [mensagem]);
    const antes = await admin.from("conversation").select("status, last_preview").eq("id", conversa).single().throwOnError();
    const args = {
      ...doPedido(job, mensagem),
      p_procedimentos: [examePedido],
      p_fora_do_cadastro: 2,
      p_resumo: "pedido com Hemograma; 2 fora do Cadastro, para a equipe conferir",
    };
    expect(await gravar(args)).toMatchObject({ ok: true, reutilizado: false });
    expect(await gravar(args)).toMatchObject({ ok: true, reutilizado: true });
    const notas = await notasDe(conversa);
    expect(notas).toHaveLength(1);
    expect(String(notas[0]?.body)).toContain("item fora do Cadastro (2)");
    expect(String(notas[0]?.body)).not.toContain("Hemograma");
    const depois = await admin.from("conversation").select("status, last_preview").eq("id", conversa).single().throwOnError();
    expect(depois.data).toEqual(antes.data);
    await concluir(job);
  });
});

describe("os CHECKs e o preco", () => {
  it("os papeis novos do gasto e o preco do whisper-1 (US$ 0,006 por minuto)", async () => {
    for (const papel of ["transcricao", "leitor_de_midia"]) {
      await admin
        .from("ia_uso")
        .insert({ clinic_id: clinicaM, origem: "whatsapp", papel, modelo: papel === "transcricao" ? "whisper-1" : "gpt-6-luna", custo_microdolar: 0 })
        .throwOnError();
    }
    const { error } = await admin
      .from("ia_uso")
      .insert({ clinic_id: clinicaM, origem: "whatsapp", papel: "leitor", modelo: "x", custo_microdolar: 0 });
    expect(error?.code).toBe("23514");
    const { data } = await admin
      .from("llm_preco")
      .select("entrada_microdolar_por_milhao, saida_microdolar_por_milhao, audio_microdolar_por_minuto")
      .eq("modelo", "whisper-1")
      .single()
      .throwOnError();
    expect(data).toEqual({ entrada_microdolar_por_milhao: 0, saida_microdolar_por_milhao: 0, audio_microdolar_por_minuto: 6000 });
  });
});
