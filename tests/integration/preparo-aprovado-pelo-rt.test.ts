import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// [AG7 preparo] início (frente M)
import { carregarCatalogoDoAgente } from "@/lib/agente/contexto";
import type { ClienteDoAgente } from "@/lib/agente/laco";
import {
  ehMensagemDoPreparo,
  normalizarTextoDoPreparo,
  situacaoDoPreparoNaTela,
  type SituacaoDoPreparo,
  type VersaoNaTela,
} from "@/lib/domain/preparo";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import { executarPassagemDaIa } from "@/lib/jobs/motor-ia";
// [AG7 preparo] fim
// [AG7 preparo] início (o fechamento entre as frentes)
import {
  fetchEnviosDoPreparo,
  jobsQuePodemSerDoPreparo,
  type MessageItem,
} from "@/lib/queries/conversations";
// [AG7 preparo] fim

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, anonClient } from "../rls/stack";

// O preparo aprovado pelo RT (AG7, migration
// 20261103100000_preparo_aprovado_pelo_rt.sql) contra o banco REAL, pelas
// RPCs (com a sessao de cada papel) e pelo servidor (a service role, como o
// executor e o envio gravam). O que esta em jogo (o contrato, secao 7.1):
// - a mensagem do banco (ler_preparo_para_envio) e o literal do contrato:
//   o cabecalho com o procedimento e o RT, o texto aprovado palavra por
//   palavra e o rodape; o hash e o da mensagem;
// - o ciclo pelas RPCs: salvar, aprovar, o texto igual ao em vigor, o
//   "Aprovar de novo" depois de suspender, renomear tira a aprovacao, a
//   trilha so com ids e o codigo do texto;
// - as leituras do servidor: os preparos em vigor (sem texto), os textos da
//   clinica (so das versoes que ja valeram, as copias do texto antigo e o
//   prep_instructions: a aguardando, a devolvida e a descartada de cadastro
//   ficam fora, BANCO-3) e o texto em vigor do procedimento (a regua);
// - o conteudo que o banco recusa sozinho pela API (CFM-2): o link, o valor
//   em reais, o arroba e o invisivel do filtro dao 22023 texto_recusado, sem
//   gravar nada;
// - o gatilho de message, o ramo novo: a mensagem exata com a decisao
//   enviou_preparo do job passa (a linha sistema com o corpo exato e a
//   decisao ligada); um caractere a menos ou a mais, outra versao, outro
//   procedimento, a suspensa, o RT encerrado, o nome mudado, a decisao de
//   outro job, a decisao sem a versao e outro hash dao CZIA3; o autor ia com
//   o corpo do preparo da CZIA1; o autor humano, CZIA3; a conversa com a
//   equipe e a janela trocada, CZIA2;
// - os CHECKs novos de ai_decision_log e de ai_turno pelo servidor;
// - a regra da tela (a situacao do preparo calculada com o que a SESSAO le:
//   as versoes, a linha aberta do RT, o vinculo dele e o nome do
//   procedimento) igual a preparo_em_vigor, em cada caso;
// - a copia do texto antigo, so leitura: toda versao texto_antigo e o
//   prep_instructions normalizado do procedimento dela, com as trocas de
//   normalizarTextoDoPreparo (a tabulacao vira espaco; o fechamento entre as
//   frentes), e o hash e o do texto;
// - o fechamento entre as frentes (TELA-13 e CFM-10a): o Atendimento so
//   confirma a bolha do preparo pela decisao 'enviou_preparo' do job
//   (fetchEnviosDoPreparo, pela sessao); o passo de regua no mesmo formato
//   passa no gatilho com o job da regua e fica como mensagem comum; quem nao
//   le a mensagem (o profissional sem a conversa) tambem nao le a decisao.
// [AG7 preparo] (frente M) A paridade da tela e situacaoDoPreparoNaTela
// (lib/domain/preparo.ts) contra preparo_em_vigor, e o turno de ponta a
// ponta pelo motor da IA, com o LLM falso, esta no fim deste arquivo. A
// maquina de estados pelo dono e o gatilho de imutabilidade estao no ensaio
// (o dono nao passa pela API; a service role recebe 42501, provado no teste
// de RLS).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste (slug
// preparo-int-*), apagadas no afterAll (os procedimentos, as versoes, o RT,
// as conversas, as mensagens e as decisoes vao em cascata; o beforeAll apaga
// a sobra de uma execucao que morreu ha mais de uma hora), e os usuarios
// desta execucao. A IA e liberada so na clinica de teste, em numero inteiro,
// no numero falso (nenhuma mensagem sai); os contatos sao ficticios; cada
// job de teste e concluido logo depois do caso (a manutencao do motor nao o
// pega). O interruptor global NUNCA e tocado. Nenhum modelo e chamado.
// ESCRITO NA AG7, AINDA NAO RODADO: grava no banco. Roda depois de aplicar a
// migration, com npm run test:integration -- preparo-aprovado-pelo-rt.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic where slug like 'preparo-int-%' and e_de_teste;
//   select u.id, u.email from auth.users u where u.email like 'preparo-int-%@teste.dev';
// e os usuarios pela API de administracao.

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `PreparoInt!${sufixo}`;
const WORKER = `preparo-int-${sufixo}`;

const CABECALHO = "Orientação de preparo para ";
const LINHA_DO_RT = "Responsável técnico da clínica: ";
const RODAPE =
  "Se tiver qualquer dúvida sobre o preparo, responda por aqui que a equipe da clínica te ajuda.";
const TEXTO_DA_COLONOSCOPIA =
  "No dia anterior, faça dieta líquida sem resíduos.\nÀs 18h, tome 2 comprimidos de bisacodil com um copo de água.\nJejum absoluto de 8 horas antes do exame.";
const TEXTO_DO_ULTRASSOM =
  "Jejum de 6 horas.\nBeba 4 copos de água 1 hora antes e não urine.";

type Erro = { code?: string; message?: string } | null;
type Salvo = { versao_id: string; versao: number; texto_sha256: string };
type Envio = {
  versao_id: string;
  procedure_id: string;
  versao: number;
  mensagem: string;
  sha256: string;
};

const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();
const idDe = (apelido: string) => ids.get(apelido)!;
const como = (apelido: string) => clientes.get(apelido)!;

let clinica = "";
let conferente: SupabaseClient | null = null;
let numero = "";
let colonoscopia = "";
let ultrassom = "";
let endoscopia = "";
let telefones = 0;
const jobs: string[] = [];

function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** A mensagem como o contrato a escreve (secao 1.4), montada aqui. */
function mensagemDoContrato(
  procedimento: string,
  rt: string,
  texto: string,
): string {
  return `${CABECALHO}${procedimento}\n${LINHA_DO_RT}${rt}\n\n${texto}\n\n${RODAPE}`;
}

async function rpcOk<T>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
}

async function inserir(
  tabela: string,
  linha: Record<string, unknown>,
): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function criarPessoa(apelido: string, papel: string): Promise<void> {
  const email = `preparo-int-${apelido}-${sufixo}@teste.dev`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
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
      clinic_id: clinica,
      user_id: data.user.id,
      role: papel,
      status: "ativo",
    })
    .throwOnError();
  const cliente = anonClient();
  const { error: erroLogin } = await cliente.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login ${apelido}: ${erroLogin.message}`);
  }
  clientes.set(apelido, cliente);
}


// Decisao do dono de 05/11/2026: sem o registro do RT conferido, nada esta em
// vigor, e so o super admin confere. Por isso esta suite exige
// INTEGRACAO_COM_SUPER_ADMIN=1 (o usuario sintetico com product_admin NO BANCO
// DE PRODUCAO, sem vinculo, como em super-admin-sem-clinica.test.ts; sai no
// afterAll). Se uma execucao morrer antes do afterAll:
//   delete from public.product_admin p using auth.users u
//    where u.id = p.user_id and u.email like 'preparo-int-super-%@example.com';
async function criarConferente(): Promise<void> {
  if (process.env.INTEGRACAO_COM_SUPER_ADMIN !== "1") {
    throw new Error(
      "Rode com INTEGRACAO_COM_SUPER_ADMIN=1: sem a conferencia do registro do RT, nenhum preparo fica em vigor.",
    );
  }
  const email = `preparo-int-super-${sufixo}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: "Conferente sintético" },
  });
  if (error || !data.user) {
    throw new Error(`criar o conferente: ${error?.message ?? "sem usuário"}`);
  }
  ids.set("conferente", data.user.id);
  await admin
    .from("product_admin")
    .insert({ user_id: data.user.id })
    .throwOnError();
  const cliente = anonClient();
  const { error: erroLogin } = await cliente.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login do conferente: ${erroLogin.message}`);
  }
  conferente = cliente;
}

async function tirarConferente(): Promise<void> {
  const id = ids.get("conferente");
  if (id) {
    await admin.from("product_admin").delete().eq("user_id", id);
  }
}

/** A designacao aberta, com o registro conferido pelo super admin. */
async function conferirRtAberto(): Promise<string> {
  const { data } = await admin
    .from("responsavel_tecnico")
    .select("id")
    .eq("clinic_id", clinica)
    .is("ate", null)
    .single()
    .throwOnError();
  const id = (data as { id: string }).id;
  const { error } = await conferente!.rpc(
    "conferir_registro_do_responsavel_tecnico",
    { p_rt_id: id },
  );
  expect(error, "conferir o registro do RT").toBeNull();
  return id;
}

async function maiorVersao(procedimento: string): Promise<number> {
  const { data } = await admin
    .from("preparo_do_procedimento")
    .select("versao")
    .eq("procedure_id", procedimento)
    .order("versao", { ascending: false })
    .limit(1)
    .throwOnError();
  return (data as { versao: number }[])[0]?.versao ?? 0;
}

async function salvar(
  apelido: string,
  procedimento: string,
  texto: string,
): Promise<{ data: Salvo; error: Erro }> {
  const { data, error } = await como(apelido).rpc(
    "salvar_preparo_do_procedimento",
    {
      p_procedure_id: procedimento,
      p_texto: texto,
      p_versao_lida: await maiorVersao(procedimento),
    },
  );
  return { data: data as Salvo, error: error as Erro };
}

async function aprovar(
  apelido: string,
  salvo: Salvo,
): Promise<{ data: unknown; error: Erro }> {
  const { data, error } = await como(apelido).rpc(
    "aprovar_preparo_do_procedimento",
    {
      p_versao_id: salvo.versao_id,
      p_texto_sha256: salvo.texto_sha256,
    },
  );
  return { data, error: error as Erro };
}

/** Salva e aprova (o administrador escreve, o RT aprova). */
async function emVigor(procedimento: string, texto: string): Promise<Salvo> {
  const { data: salvo, error } = await salvar("admin", procedimento, texto);
  expect(error, "salvar").toBeNull();
  expect((await aprovar("rt", salvo)).error, "aprovar").toBeNull();
  return salvo;
}

async function lerParaEnvio(versao: string): Promise<Envio | null> {
  return rpcOk<Envio | null>("ler_preparo_para_envio", {
    p_clinic_id: clinica,
    p_versao_id: versao,
  });
}

async function emVigorNoBanco(): Promise<Set<string>> {
  const lista = await rpcOk<{ versao_id: string }[]>(
    "preparos_em_vigor_da_clinica",
    { p_clinic_id: clinica },
  );
  return new Set(lista.map((p) => p.versao_id));
}

// [AG7 preparo] início (frente M)
/**
 * A regra da tela (situacaoDoPreparoNaTela, lib/domain/preparo.ts), so com o
 * que a SESSAO le: as versoes do procedimento, a linha aberta do RT, o
 * vinculo ativo dele (clinic_member, "membro ve o time") e o nome do
 * procedimento. "aprovada" se e so se a versao aprovada esta em vigor: tem
 * de dar o mesmo que preparo_em_vigor, caso a caso (o hash recalculado e do
 * banco; nenhum caso aqui mexe na linha por fora).
 */
async function emVigorPelaSessao(
  apelido: string,
  procedimento: string,
): Promise<string | null> {
  const sessao = como(apelido);
  const { data: versoes } = await sessao
    .from("preparo_do_procedimento")
    .select("id, versao, situacao, texto_sha256, nome_do_procedimento, rt_id")
    .eq("procedure_id", procedimento)
    .throwOnError();
  const lidas = (
    versoes as {
      id: string;
      versao: number;
      situacao: SituacaoDoPreparo;
      texto_sha256: string;
      nome_do_procedimento: string;
      rt_id: string | null;
    }[]
  ).map((v): VersaoNaTela => ({
    id: v.id,
    versao: v.versao,
    situacao: v.situacao,
    textoSha256: v.texto_sha256,
    nomeDoProcedimento: v.nome_do_procedimento,
    rtId: v.rt_id,
  }));
  const { data: rtAberto } = await sessao
    .from("responsavel_tecnico")
    .select("id, user_id")
    .eq("clinic_id", clinica)
    .is("ate", null)
    .maybeSingle()
    .throwOnError();
  const rt = rtAberto as {
    id: string;
    user_id: string;
  } | null;
  let rtComAcesso = false;
  if (rt) {
    const { data: vinculo } = await sessao
      .from("clinic_member")
      .select("status")
      .eq("clinic_id", clinica)
      .eq("user_id", rt.user_id)
      .maybeSingle()
      .throwOnError();
    rtComAcesso = (vinculo as { status: string } | null)?.status === "ativo";
  }
  const { data: proc } = await sessao
    .from("procedure")
    .select("name")
    .eq("id", procedimento)
    .single()
    .throwOnError();
  const situacao = situacaoDoPreparoNaTela({
    versoes: lidas,
    rtAberto: rt ? { id: rt.id, userId: rt.user_id } : null,
    rtComAcesso,
    nomeAtual: (proc as { name: string }).name,
  });
  return situacao === "aprovada"
    ? (lidas.find((v) => v.situacao === "aprovado")?.id ?? null)
    : null;
}
// [AG7 preparo] fim

/** A regra da tela e o banco iguais, para cada procedimento. */
async function paridade(rotulo: string): Promise<void> {
  const noBanco = await emVigorNoBanco();
  for (const procedimento of [colonoscopia, ultrassom, endoscopia]) {
    const pelaSessao = await emVigorPelaSessao("recepcao", procedimento);
    const doBanco = await rpcOk<{ versao_id: string } | null>(
      "preparo_em_vigor_do_procedimento",
      {
        p_clinic_id: clinica,
        p_procedure_id: procedimento,
      },
    );
    expect(pelaSessao, `${rotulo}: a regra da tela contra o banco`).toBe(
      doBanco?.versao_id ?? null,
    );
    expect(
      pelaSessao === null ? false : noBanco.has(pelaSessao),
      `${rotulo}: e a lista do catalogo`,
    ).toBe(pelaSessao !== null);
  }
}

/** Uma conversa na IA (com a janela) de um contato ficticio novo. */
async function conversaNaIa(): Promise<string> {
  telefones += 1;
  const contato = await inserir("contact", {
    clinic_id: clinica,
    phone_e164: `+55849${digitos}${String(telefones).padStart(3, "0")}`,
    name: "Contato sintético",
    kind: "lead",
  });
  const conversa = await inserir("conversation", {
    clinic_id: clinica,
    contact_id: contato,
    status: "ia_atendendo",
    awaiting_reply: false,
    whatsapp_account_id: numero,
  });
  const { data: chave } = await admin
    .from("contact")
    .select("phone_key")
    .eq("id", contato)
    .single()
    .throwOnError();
  await admin
    .from("ia_janela_da_conversa")
    .insert({
      conversation_id: conversa,
      clinic_id: clinica,
      contact_id: contato,
      phone_key: (chave as { phone_key: string }).phone_key,
      desde: new Date(Date.now() - 60 * 60_000).toISOString(),
      aberta_por: "ingestao",
    })
    .throwOnError();
  return conversa;
}

/** Um job da IA em execucao da conversa (concluido no fim de cada caso). */
async function jobEmExecucao(
  conversa: string,
  kind: "responder_com_ia" | "executar_passo_de_regua" = "responder_com_ia",
): Promise<string> {
  const job = await inserir("job_queue", {
    clinic_id: clinica,
    kind,
    whatsapp_account_id: numero,
    payload: { conversation_id: conversa },
    status: "executando",
    locked_by: WORKER,
    locked_at: new Date().toISOString(),
    attempts: 1,
    max_attempts: 3,
  });
  jobs.push(job);
  return job;
}

async function decidirPreparo(
  job: string,
  conversa: string,
  versao: string | null,
  corpo: string,
  desfecho = "enviou_preparo",
): Promise<void> {
  await admin
    .from("ai_decision_log")
    .insert({
      clinic_id: clinica,
      conversation_id: conversa,
      job_id: job,
      desfecho,
      preparo_versao_id: versao,
      texto_sha256: sha256(corpo),
      aprovado: desfecho === "respondeu" ? true : null,
      tool_used: "enviar_preparo",
    })
    .throwOnError();
}

async function enviar(
  conversa: string,
  job: string,
  corpo: string,
  extra: Record<string, unknown> = {},
): Promise<Erro> {
  const { error } = await admin.from("message").insert({
    clinic_id: clinica,
    conversation_id: conversa,
    whatsapp_account_id: numero,
    direction: "saida",
    author: "sistema",
    content_type: "texto",
    body: corpo,
    job_id: job,
    ...extra,
  });
  return error as Erro;
}

/** O caso inteiro: um job novo, a decisao do corpo decidido e o envio do corpo enviado. */
async function caso(
  conversa: string,
  versao: string | null,
  decidido: string,
  enviado: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const job = await jobEmExecucao(conversa);
  if (versao !== null) {
    await decidirPreparo(job, conversa, versao, decidido);
  }
  const error = await enviar(conversa, job, enviado, extra);
  await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
  return error ? `${error.code}:${error.message}` : "ok";
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "preparo-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
  clinica = await inserir("clinic", {
    name: `Preparo Int ${sufixo}`,
    slug: `preparo-int-${sufixo}`,
    e_de_teste: true,
    timezone: "America/Fortaleza",
  });
  numero = (await criarNumeroDeTeste(admin, clinica, { nome: "Recepção" })).id;
  // A IA liberada so aqui, em numero inteiro, no numero falso, com a
  // habilidade do preparo publicada (o caminho das suites da onda 2).
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinica,
    p_liberada: true,
    p_modo: "numero_inteiro",
    p_motivo: "teste de integracao da AG7",
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
    skills: { enviar_preparo: true },
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: false,
  });
  colonoscopia = await inserir("procedure", {
    clinic_id: clinica,
    name: "Colonoscopia",
    active: true,
  });
  ultrassom = await inserir("procedure", {
    clinic_id: clinica,
    name: "Ultrassom de abdome",
    active: true,
  });
  endoscopia = await inserir("procedure", {
    clinic_id: clinica,
    name: "Endoscopia",
    active: true,
  });
  await criarPessoa("admin", "admin");
  await criarPessoa("gestor", "gestor");
  await criarPessoa("recepcao", "recepcao");
  await criarPessoa("rt", "profissional");
  await criarPessoa("rt2", "leitura");
  await criarConferente();
  const { error } = await como("admin").rpc("definir_responsavel_tecnico", {
    p_clinic_id: clinica,
    p_user_id: idDe("rt"),
    p_nome: "Dra. Ana Souza",
    p_conselho: "CRM",
    p_numero: "12345",
    p_uf: "CE",
  });
  expect(error, "definir o RT").toBeNull();
  await conferirRtAberto();
}, 180_000);

afterAll(async () => {
  for (const job of jobs) {
    await admin
      .from("job_queue")
      .update({ status: "concluido", locked_by: null, locked_at: null })
      .eq("id", job);
  }
  if (clinica) {
    const { error } = await admin.from("clinic").delete().eq("id", clinica);
    expect(error, "apagar a clinica do teste").toBeNull();
  }
  await tirarConferente();
  for (const id of ids.values()) {
    await admin.auth.admin.deleteUser(id);
  }
}, 120_000);

describe("o ciclo pelas RPCs e a mensagem do banco", () => {
  it("salvar e aprovar: a mensagem e o literal do contrato, o hash e o dela, a trilha so com ids e o codigo", async () => {
    const { data: salvo, error } = await salvar(
      "admin",
      colonoscopia,
      TEXTO_DA_COLONOSCOPIA,
    );
    expect(error).toBeNull();
    expect(salvo).toMatchObject({
      versao: 1,
      texto_sha256: sha256(TEXTO_DA_COLONOSCOPIA),
    });
    // Aguardando: nada sai.
    expect(await lerParaEnvio(salvo.versao_id)).toBeNull();
    const { data: aprovado, error: erroAprovar } = await aprovar("rt", salvo);
    expect(erroAprovar).toBeNull();
    expect(aprovado).toMatchObject({
      versao_id: salvo.versao_id,
      versao: 1,
      texto_sha256: salvo.texto_sha256,
    });
    const esperada = mensagemDoContrato(
      "Colonoscopia",
      "Dra. Ana Souza (CRM-CE 12345)",
      TEXTO_DA_COLONOSCOPIA,
    );
    expect(await lerParaEnvio(salvo.versao_id)).toEqual({
      versao_id: salvo.versao_id,
      procedure_id: colonoscopia,
      versao: 1,
      mensagem: esperada,
      sha256: sha256(esperada),
    });
    const { data: trilha } = await admin
      .from("audit_log")
      .select("action, user_id, entity, detalhes")
      .eq("entity_id", salvo.versao_id)
      .order("id")
      .throwOnError();
    const detalhes = {
      procedure_id: colonoscopia,
      versao: 1,
      codigo: salvo.texto_sha256.slice(0, 8),
    };
    expect(trilha).toEqual([
      {
        action: "escreveu_preparo",
        user_id: idDe("admin"),
        entity: "preparo_do_procedimento",
        detalhes,
      },
      {
        action: "aprovou_preparo",
        user_id: idDe("rt"),
        entity: "preparo_do_procedimento",
        detalhes,
      },
    ]);
    // O mesmo texto da aprovada em vigor nao entra.
    const igual = await salvar("gestor", colonoscopia, TEXTO_DA_COLONOSCOPIA);
    expect(igual.error?.code).toBe("P0001");
    expect(igual.error?.message).toBe("texto_igual_ao_em_vigor");
    await paridade("depois de aprovar");
  });

  it("suspender tira de vigor; o mesmo texto entra de novo e o RT aprova de novo", async () => {
    const salvo = await emVigor(ultrassom, TEXTO_DO_ULTRASSOM);
    const { data, error } = await como("gestor").rpc(
      "suspender_preparo_do_procedimento",
      {
        p_procedure_id: ultrassom,
        p_comentario: "Revisar a quantidade de água.",
      },
    );
    expect(error).toBeNull();
    expect(data).toEqual({ versao_id: salvo.versao_id });
    expect(await lerParaEnvio(salvo.versao_id)).toBeNull();
    await paridade("suspensa");
    const novo = await emVigor(ultrassom, TEXTO_DO_ULTRASSOM);
    expect(novo.versao).toBe(2);
    expect((await lerParaEnvio(novo.versao_id))?.mensagem).toBe(
      mensagemDoContrato(
        "Ultrassom de abdome",
        "Dra. Ana Souza (CRM-CE 12345)",
        TEXTO_DO_ULTRASSOM,
      ),
    );
    await paridade("aprovada de novo");
  });

  it("renomear o procedimento tira a aprovacao (nome_mudou para o texto que esperava)", async () => {
    const salvo = await emVigor(endoscopia, "Jejum de 8 horas.");
    const { data: novo } = await salvar(
      "admin",
      endoscopia,
      "Jejum de 10 horas.",
    );
    await admin
      .from("procedure")
      .update({ name: "Endoscopia digestiva" })
      .eq("id", endoscopia)
      .throwOnError();
    expect(await lerParaEnvio(salvo.versao_id)).toBeNull();
    await paridade("renomeado");
    const { error } = await aprovar("rt", novo);
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("nome_mudou");
    // O texto salvo de novo com o nome novo e aprovado volta a valer.
    const deNovo = await emVigor(endoscopia, "Jejum de 10 horas.");
    expect((await lerParaEnvio(deNovo.versao_id))?.mensagem).toContain(
      `${CABECALHO}Endoscopia digestiva\n`,
    );
    await paridade("com o nome novo");
  });

  it("as leituras do servidor: em vigor sem o texto, os textos das versoes que ja valeram, o texto da regua", async () => {
    const lista = await rpcOk<Record<string, unknown>[]>(
      "preparos_em_vigor_da_clinica",
      { p_clinic_id: clinica },
    );
    expect(lista.length).toBe(3);
    for (const item of lista) {
      expect(Object.keys(item).sort()).toEqual([
        "aprovado_em",
        "procedure_id",
        "rt_nome",
        "texto_sha256",
        "versao",
        "versao_id",
      ]);
      expect(item.rt_nome).toBe("Dra. Ana Souza");
    }
    const textos = await rpcOk<string[]>("textos_de_preparo_da_clinica", {
      p_clinic_id: clinica,
    });
    expect(new Set(textos)).toEqual(
      new Set([
        TEXTO_DA_COLONOSCOPIA,
        TEXTO_DO_ULTRASSOM,
        "Jejum de 8 horas.",
        "Jejum de 10 horas.",
      ]),
    );
    const daRegua = await rpcOk<{
      versao_id: string;
      texto: string;
      texto_sha256: string;
    } | null>("preparo_em_vigor_do_procedimento", {
      p_clinic_id: clinica,
      p_procedure_id: colonoscopia,
    });
    expect(daRegua?.texto).toBe(TEXTO_DA_COLONOSCOPIA);
    expect(sha256(daRegua!.texto)).toBe(daRegua!.texto_sha256);
  });
});

describe("os textos da clinica e o conteudo recusado (BANCO-3 e CFM-2)", () => {
  it("so as versoes que ja valeram: a aguardando, a devolvida e a descartada ficam fora; a suspensa fica", async () => {
    const densitometria = await inserir("procedure", {
      clinic_id: clinica,
      name: "Densitometria",
      active: true,
    });
    const devolvida = "Traga o pedido medico impresso.";
    const descartada = "Chegue 40 minutos antes do horario.";
    const aprovada = "Venha com roupa sem metal.";
    const aguardando = "Venha com roupa leve, sem metal e sem joias.";
    // A devolvida: o administrador escreve, o RT devolve.
    const { data: primeira, error: erro1 } = await salvar(
      "admin",
      densitometria,
      devolvida,
    );
    expect(erro1).toBeNull();
    const { error: erroDevolver } = await como("rt").rpc(
      "devolver_preparo_do_procedimento",
      { p_versao_id: primeira.versao_id, p_comentario: "Falta a roupa." },
    );
    expect(erroDevolver).toBeNull();
    // A descartada: o gestor escreve e descarta.
    const { data: segunda, error: erro2 } = await salvar(
      "gestor",
      densitometria,
      descartada,
    );
    expect(erro2).toBeNull();
    const { error: erroDescartar } = await como("gestor").rpc(
      "descartar_preparo_do_procedimento",
      { p_versao_id: segunda.versao_id },
    );
    expect(erroDescartar).toBeNull();
    // A aprovada e, depois, um texto novo aguardando.
    await emVigor(densitometria, aprovada);
    expect((await salvar("admin", densitometria, aguardando)).error).toBeNull();
    const textos = await rpcOk<string[]>("textos_de_preparo_da_clinica", {
      p_clinic_id: clinica,
    });
    expect(textos).toContain(aprovada);
    for (const fora of [devolvida, descartada, aguardando]) {
      expect(textos, fora).not.toContain(fora);
    }
    // Suspensa, a que ja valeu continua na lista (ela pode ter saido).
    const { error: erroSuspender } = await como("gestor").rpc(
      "suspender_preparo_do_procedimento",
      { p_procedure_id: densitometria },
    );
    expect(erroSuspender).toBeNull();
    expect(
      await rpcOk<string[]>("textos_de_preparo_da_clinica", {
        p_clinic_id: clinica,
      }),
    ).toContain(aprovada);
  });

  it("o link, o valor em reais, o arroba e o invisivel do filtro: 22023 texto_recusado, nada gravado", async () => {
    const antes = await maiorVersao(ultrassom);
    for (const texto of [
      "Veja o preparo em https://bit.ly/preparo",
      "Acesse www.clinica.com.br",
      "Traga R$ 50,00 para o estacionamento.",
      "Pague 50 reais na recepcao.",
      "Siga @clinica para mais dicas.",
      "Jejum de \u20668 horas\u2069.",
    ]) {
      for (const apelido of ["admin", "rt", "recepcao"]) {
        const { error } = await salvar(apelido, ultrassom, texto);
        expect(error?.code, `${apelido}: ${texto}`).toBe("22023");
        expect(error?.message).toBe("texto_recusado");
      }
    }
    expect(await maiorVersao(ultrassom)).toBe(antes);
  });
});

describe("o gatilho de message: a mensagem do preparo", () => {
  let versao = "";
  let mensagem = "";
  let conversa = "";

  beforeAll(async () => {
    const { data } = await admin
      .from("preparo_do_procedimento")
      .select("id")
      .eq("procedure_id", colonoscopia)
      .eq("situacao", "aprovado")
      .single()
      .throwOnError();
    versao = (data as { id: string }).id;
    mensagem = (await lerParaEnvio(versao))!.mensagem;
    conversa = await conversaNaIa();
  });

  it("a mensagem exata com a decisao do job passa: a linha sistema com o corpo exato e a decisao ligada", async () => {
    const job = await jobEmExecucao(conversa);
    await decidirPreparo(job, conversa, versao, mensagem);
    expect(await enviar(conversa, job, mensagem)).toBeNull();
    const { data: linha } = await admin
      .from("message")
      .select("author, direction, content_type, body, author_user_id")
      .eq("job_id", job)
      .single()
      .throwOnError();
    expect(linha).toEqual({
      author: "sistema",
      direction: "saida",
      content_type: "texto",
      body: mensagem,
      author_user_id: null,
    });
    const { data: decisao } = await admin
      .from("ai_decision_log")
      .select("desfecho, preparo_versao_id, texto_sha256, aprovado")
      .eq("job_id", job)
      .single()
      .throwOnError();
    expect(decisao).toEqual({
      desfecho: "enviou_preparo",
      preparo_versao_id: versao,
      texto_sha256: sha256(mensagem),
      aprovado: null,
    });
    await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
  });

  it("o Atendimento so confirma o preparo pela decisao do job: o passo de regua no mesmo formato fica comum (TELA-13 e CFM-10a)", async () => {
    const daIa = await jobEmExecucao(conversa);
    await decidirPreparo(daIa, conversa, versao, mensagem);
    expect(await enviar(conversa, daIa, mensagem)).toBeNull();
    await rpcOk("concluir_job", { p_id: daIa, p_worker: WORKER });
    // O passo de regua escrito no formato exato: o gatilho deixa passar (o
    // job da regua), sem decisao nenhuma.
    const daRegua = await jobEmExecucao(conversa, "executar_passo_de_regua");
    expect(await enviar(conversa, daRegua, mensagem)).toBeNull();
    await rpcOk("concluir_job", { p_id: daRegua, p_worker: WORKER });

    // O fio pela sessao de quem le a conversa: as duas no formato do preparo.
    const { data } = await como("recepcao")
      .from("message")
      .select(
        "id, conversation_id, direction, author, author_user_id, content_type, body, media_url, is_internal_note, pelo_celular, job_id, created_at, deleted_at",
      )
      .in("job_id", [daIa, daRegua])
      .throwOnError();
    const linhas = (data ?? []).map((linha) => ({
      ...(linha as object),
      reply_to: null,
    })) as unknown as MessageItem[];
    expect(linhas).toHaveLength(2);
    expect(jobsQuePodemSerDoPreparo(linhas).sort()).toEqual(
      [daIa, daRegua].sort(),
    );
    // A confirmacao: so o job da IA tem a decisao 'enviou_preparo'.
    const envios = await fetchEnviosDoPreparo(como("recepcao"), clinica, [
      daIa,
      daRegua,
    ]);
    expect([...envios]).toEqual([daIa]);
    const preparo = linhas.filter((m) => ehMensagemDoPreparo(m, envios));
    expect(preparo.map((m) => m.job_id)).toEqual([daIa]);
    // O Somente leitura e o gestor tambem leem a decisao (a mesma RLS da
    // mensagem); o profissional sem a conversa nao le nem a mensagem nem a
    // decisao.
    for (const apelido of ["gestor", "rt2"]) {
      expect(
        [...(await fetchEnviosDoPreparo(como(apelido), clinica, [daIa]))],
        apelido,
      ).toEqual([daIa]);
    }
    const { data: doProfissional } = await como("rt")
      .from("message")
      .select("id")
      .in("job_id", [daIa, daRegua])
      .throwOnError();
    expect(doProfissional).toEqual([]);
    expect((await fetchEnviosDoPreparo(como("rt"), clinica, [daIa])).size).toBe(
      0,
    );
  });

  it("o conteudo diferente da versao em vigor: CZIA3", async () => {
    const divergente = "CZIA3:frase_divergente";
    expect(
      await caso(conversa, versao, mensagem, mensagem.slice(0, -1)),
      "um a menos",
    ).toBe(divergente);
    expect(
      await caso(conversa, versao, mensagem, `${mensagem}.`),
      "um a mais",
    ).toBe(divergente);
    expect(
      await caso(
        conversa,
        versao,
        mensagem.slice(0, -1),
        mensagem.slice(0, -1),
      ),
      "um a menos, decidido",
    ).toBe(divergente);
    const acrescimo = `${mensagem} Pode tomar café preto.`;
    expect(
      await caso(conversa, versao, acrescimo, acrescimo),
      "com acrescimo, decidido",
    ).toBe(divergente);
    expect(
      await caso(
        conversa,
        versao,
        TEXTO_DA_COLONOSCOPIA,
        TEXTO_DA_COLONOSCOPIA,
      ),
      "so o texto",
    ).toBe(divergente);
    // Outro procedimento: a decisao do ultrassom com a mensagem da colonoscopia.
    const { data: doUltrassom } = await admin
      .from("preparo_do_procedimento")
      .select("id")
      .eq("procedure_id", ultrassom)
      .eq("situacao", "aprovado")
      .single()
      .throwOnError();
    expect(
      await caso(
        conversa,
        (doUltrassom as { id: string }).id,
        mensagem,
        mensagem,
      ),
      "outro procedimento",
    ).toBe(divergente);
    // Outra versao: a suspensa do ultrassom (a 1).
    const { data: suspensa } = await admin
      .from("preparo_do_procedimento")
      .select("id")
      .eq("procedure_id", ultrassom)
      .eq("situacao", "suspenso")
      .single()
      .throwOnError();
    const daSuspensa = mensagemDoContrato(
      "Ultrassom de abdome",
      "Dra. Ana Souza (CRM-CE 12345)",
      TEXTO_DO_ULTRASSOM,
    );
    expect(
      await caso(
        conversa,
        (suspensa as { id: string }).id,
        daSuspensa,
        daSuspensa,
      ),
      "a suspensa",
    ).toBe(divergente);
  });

  it("a decisao: de outro job, sem a versao, com outro hash, sem decisao: CZIA3", async () => {
    const divergente = "CZIA3:frase_divergente";
    const outro = await jobEmExecucao(conversa);
    await decidirPreparo(outro, conversa, versao, mensagem);
    const job = await jobEmExecucao(conversa);
    expect(await enviar(conversa, job, mensagem), "de outro job").toMatchObject(
      { code: "CZIA3" },
    );
    await decidirPreparo(job, conversa, null, mensagem, "respondeu");
    expect(
      await enviar(conversa, job, mensagem),
      "sem a versao (respondeu, aprovada)",
    ).toMatchObject({ code: "CZIA3" });
    await rpcOk("concluir_job", { p_id: outro, p_worker: WORKER });
    await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
    expect(
      await caso(conversa, versao, "Outro corpo.", mensagem),
      "outro hash",
    ).toBe(divergente);
    expect(await caso(conversa, null, mensagem, mensagem), "sem decisao").toBe(
      divergente,
    );
  });

  it("quem e a forma: o autor ia da CZIA1; o autor humano, a nota e a midia, CZIA3", async () => {
    expect(
      await caso(conversa, versao, mensagem, mensagem, { author: "ia" }),
    ).toBe("CZIA1:ia_sem_aprovacao");
    expect(
      await caso(conversa, versao, mensagem, mensagem, {
        author_user_id: idDe("admin"),
      }),
    ).toBe("CZIA3:frase_divergente");
    expect(
      await caso(conversa, versao, mensagem, mensagem, {
        is_internal_note: true,
      }),
    ).toBe("CZIA3:frase_divergente");
  });

  it("a liberacao: a conversa com a equipe e a janela trocada dao CZIA2", async () => {
    const comAEquipe = await conversaNaIa();
    const job = await jobEmExecucao(comAEquipe);
    await decidirPreparo(job, comAEquipe, versao, mensagem);
    await admin
      .from("conversation")
      .update({ status: "em_atendimento", assignee_user_id: idDe("recepcao") })
      .eq("id", comAEquipe)
      .throwOnError();
    expect(await enviar(comAEquipe, job, mensagem)).toMatchObject({
      code: "CZIA2",
      message: "ia_nao_liberada",
    });
    await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
    const janelaTrocada = await conversaNaIa();
    const job2 = await jobEmExecucao(janelaTrocada);
    await decidirPreparo(job2, janelaTrocada, versao, mensagem);
    await admin
      .from("ia_janela_da_conversa")
      .update({ desde: new Date(Date.now() + 60_000).toISOString() })
      .eq("conversation_id", janelaTrocada)
      .throwOnError();
    expect(await enviar(janelaTrocada, job2, mensagem)).toMatchObject({
      code: "CZIA2",
      message: "ia_nao_liberada",
    });
    await rpcOk("concluir_job", { p_id: job2, p_worker: WORKER });
  });

  it("o RT encerrado tira de vigor (CZIA3); o RT trocado tambem, ate aprovar de novo", async () => {
    const { error } = await como("admin").rpc("encerrar_responsavel_tecnico", {
      p_clinic_id: clinica,
    });
    expect(error).toBeNull();
    expect(await caso(conversa, versao, mensagem, mensagem)).toBe(
      "CZIA3:frase_divergente",
    );
    await paridade("sem RT");
    const { error: erroDefinir } = await como("admin").rpc(
      "definir_responsavel_tecnico",
      {
        p_clinic_id: clinica,
        p_user_id: idDe("rt2"),
        p_nome: "Dr. Bruno Lima",
        p_conselho: "CRO",
        p_numero: "4321",
        p_uf: "SP",
      },
    );
    expect(erroDefinir).toBeNull();
    // A troca comeca sem a conferencia: confere, para o caso seguir.
    await conferirRtAberto();
    expect(await caso(conversa, versao, mensagem, mensagem)).toBe(
      "CZIA3:frase_divergente",
    );
    await paridade("RT trocado");
    // O RT novo (Somente leitura) aprova de novo o mesmo texto.
    const { data: salvo, error: erroSalvar } = await salvar(
      "rt2",
      colonoscopia,
      TEXTO_DA_COLONOSCOPIA,
    );
    expect(erroSalvar).toBeNull();
    expect((await aprovar("rt2", salvo)).error).toBeNull();
    const nova = (await lerParaEnvio(salvo.versao_id))!.mensagem;
    expect(nova).toBe(
      mensagemDoContrato(
        "Colonoscopia",
        "Dr. Bruno Lima (CRO-SP 4321)",
        TEXTO_DA_COLONOSCOPIA,
      ),
    );
    expect(await caso(conversa, salvo.versao_id, nova, nova)).toBe("ok");
    await paridade("aprovado pelo RT novo");
  });
});

describe("os CHECKs novos pelo servidor", () => {
  it("enviou_preparo so com a versao e o hash, sem aprovado; a saida preparo sem texto", async () => {
    const conversa = await conversaNaIa();
    const base = { clinic_id: clinica, conversation_id: conversa };
    const versao = crypto.randomUUID();
    const semVersao = await admin.from("ai_decision_log").insert({
      ...base,
      desfecho: "enviou_preparo",
      texto_sha256: sha256("x"),
    });
    expect(semVersao.error?.code).toBe("23514");
    const semDesfecho = await admin
      .from("ai_decision_log")
      .insert({ ...base, preparo_versao_id: versao });
    expect(semDesfecho.error?.code).toBe("23514");
    const aprovada = await admin.from("ai_decision_log").insert({
      ...base,
      desfecho: "enviou_preparo",
      preparo_versao_id: versao,
      texto_sha256: sha256("x"),
      aprovado: true,
    });
    expect(aprovada.error?.code).toBe("23514");
    const certa = await admin.from("ai_decision_log").insert({
      ...base,
      desfecho: "enviou_preparo",
      preparo_versao_id: versao,
      texto_sha256: sha256("x"),
    });
    expect(certa.error).toBeNull();
    const comTexto = await admin.from("ai_turno").insert({
      job_id: crypto.randomUUID(),
      ...base,
      estado: "decidido",
      saida: "preparo",
      texto: "Texto do preparo",
      texto_sha256: sha256("x"),
    });
    expect(comTexto.error?.code).toBe("23514");
    const semTexto = await admin.from("ai_turno").insert({
      job_id: crypto.randomUUID(),
      ...base,
      estado: "decidido",
      saida: "preparo",
      texto_sha256: sha256("x"),
    });
    expect(semTexto.error).toBeNull();
  });
});

describe("a copia do texto antigo (so leitura)", () => {
  it("toda versao texto_antigo e o prep_instructions normalizado do procedimento, na versao 1", async () => {
    const { data } = await admin
      .from("preparo_do_procedimento")
      .select(
        "texto, texto_sha256, versao, escrito_por, nome_do_procedimento, procedure:procedure_id ( name, prep_instructions )",
      )
      .eq("origem", "texto_antigo")
      .throwOnError();
    for (const v of data as unknown as {
      texto: string;
      texto_sha256: string;
      versao: number;
      escrito_por: string | null;
      nome_do_procedimento: string;
      procedure: { name: string; prep_instructions: string | null };
    }[]) {
      // A normalizacao da tela (a mesma da copia: a tabulacao vira espaco),
      // e o hash e o do texto (o que a tela guardaria com o mesmo texto).
      const normalizado = normalizarTextoDoPreparo(
        v.procedure.prep_instructions ?? "",
      );
      expect(v.texto).toBe(normalizado);
      expect(v.texto_sha256).toBe(sha256(normalizado));
      expect(v.versao).toBe(1);
      expect(v.escrito_por).toBeNull();
    }
  });
});

// [AG7 preparo] início (frente M)
// O turno de ponta a ponta pelo motor da IA (executarPassagemDaIa), com o
// LLM FALSO de roteiro (nenhuma chamada a OpenAI: o pacote 'openai' e um
// stub e o fetch recusa o host), o laco, o catalogo, o executor e o envio de
// verdade sobre o numero falso: a mensagem entra por ingest_inbound_message,
// vira job por enfileirar_resposta_da_ia, o modelo chama enviar_preparo e o
// sistema manda a mensagem que o banco montou da versao em vigor, palavra por
// palavra, pelo gatilho de message de verdade (a linha 'sistema' do job com a
// decisao enviou_preparo do mesmo job, o mesmo hash e a versao).
describe("o turno de ponta a ponta pelo motor da IA, com o LLM falso (frente M)", () => {
  /** O apelido do RT vigente agora (os casos de cima podem ter trocado). */
  async function apelidoDoRt(): Promise<string> {
    const { data } = await admin
      .from("responsavel_tecnico")
      .select("user_id")
      .eq("clinic_id", clinica)
      .is("ate", null)
      .maybeSingle()
      .throwOnError();
    const userId = (data as { user_id: string } | null)?.user_id;
    const apelido = [...ids.entries()].find(([, id]) => id === userId)?.[0];
    if (apelido !== undefined) {
      return apelido;
    }
    const { error } = await como("admin").rpc("definir_responsavel_tecnico", {
      p_clinic_id: clinica,
      p_user_id: idDe("rt"),
      p_nome: "Dra. Ana Souza",
      p_conselho: "CRM",
      p_numero: "12345",
      p_uf: "CE",
    });
    expect(error, "definir o RT de novo").toBeNull();
    await conferirRtAberto();
    return "rt";
  }

  const classificadorNeutro: ClassificadorDeEntrada = async () => ({
    tipo: "classificacao",
    classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: null,
  });
  // O turno do preparo nao passa pelo verificador: se passar, falha.
  const verificadorQueNaoRoda: Verificador = async () => {
    throw new Error("o verificador nao roda no turno do preparo");
  };

  it("pedido do preparo: a linha 'sistema' do job com o corpo exato, a decisao ligada e o turno enviado", async () => {
    resetFakeProvider();
    const nome = `Retossigmoidoscopia ${sufixo}`;
    const procedimento = await inserir("procedure", {
      clinic_id: clinica,
      name: nome,
      active: true,
    });
    const { data: salvo, error: erroSalvar } = await salvar(
      "admin",
      procedimento,
      TEXTO_DO_ULTRASSOM,
    );
    expect(erroSalvar).toBeNull();
    expect((await aprovar(await apelidoDoRt(), salvo)).error).toBeNull();
    const envio = (await lerParaEnvio(salvo.versao_id))!;
    expect(envio).not.toBeNull();

    // O codigo do procedimento no catalogo de verdade (o que vai ao modelo).
    const catalogo = await carregarCatalogoDoAgente(admin, clinica);
    const codigo = [
      ...catalogo.procedimentos,
      ...(catalogo.procedimentosSoComAEquipe ?? []),
    ].find((p) => p.id === procedimento)?.codigo;
    expect(codigo).toBeDefined();
    expect(catalogo.preparosEmVigor?.get(procedimento)?.versaoId).toBe(
      salvo.versao_id,
    );
    // Os textos de preparo da clinica ficam no servidor.
    expect(catalogo.textosDePreparo).toContain(TEXTO_DO_ULTRASSOM);

    // A mensagem entra e vira job.
    telefones += 1;
    const telefone = `+55849${digitos}${String(telefones).padStart(3, "0")}`;
    const ingestao = await rpcOk<{
      conversation_id: string;
      message_id: string;
      ia_atendendo?: boolean;
    }>("ingest_inbound_message", {
      p_clinic_id: clinica,
      p_phone_e164: telefone,
      p_name: "Contato sintético",
      p_wa_message_id: `preparo-int-pap:${sufixo}:${telefones}`,
      p_content_type: "texto",
      p_body: "Pode me mandar a orientação de preparo, por favor?",
      p_whatsapp_account_id: numero,
    });
    expect(ingestao.ia_atendendo).toBe(true);
    const enfileirado = await rpcOk<{ codigo: string; job_id: string }>(
      "enfileirar_resposta_da_ia",
      {
        p_clinic_id: clinica,
        p_conversation_id: ingestao.conversation_id,
        p_message_id: ingestao.message_id,
        p_incluir_teste: true,
      },
    );
    expect(enfileirado.codigo).toBe("enfileirado");
    await admin
      .from("job_queue")
      .update({ run_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", enfileirado.job_id)
      .throwOnError();

    // O motor da IA com o LLM falso: o modelo so escolhe o procedimento.
    const create = vi.fn(async () => ({
      model: "gpt-6-luna",
      status: "completed",
      incomplete_details: null,
      usage: {
        input_tokens: 1_200,
        output_tokens: 40,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 10 },
      },
      output: [
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "enviar_preparo",
          arguments: JSON.stringify({ procedimento: codigo }),
          status: "completed",
        },
      ],
    }));
    const resumo = await executarPassagemDaIa({
      executorId: `motor-ia:${crypto.randomUUID()}`,
      prazoFinalMs: Date.now() + 55_000,
      incluirClinicasDeTeste: true,
      baterPonto: false,
      dependencias: {
        admin,
        config: { ligado: true, clinicas: [clinica] },
        agora: Date.now,
        clienteDoAgente: () =>
          ({ responses: { create } }) as unknown as ClienteDoAgente,
        modeloDoAgente: () => "gpt-6-luna",
        segredoDoIdentificador: () => "s".repeat(40),
        criarVerificador: () => verificadorQueNaoRoda,
        criarClassificador: () => classificadorNeutro,
      },
    });
    expect(resumo).toMatchObject({
      reivindicados: 1,
      concluidos: 1,
      falhos: 0,
    });
    expect(create).toHaveBeenCalledTimes(1);
    // O texto nunca foi ao modelo.
    expect(JSON.stringify(create.mock.calls)).not.toContain(
      TEXTO_DO_ULTRASSOM.split("\n")[0],
    );

    // A linha 'sistema' do job, com o corpo exato, saiu pelo numero falso.
    const { data: linhas } = await admin
      .from("message")
      .select("id, author, body, job_id, delivery_status, cost_cents, billable")
      .eq("conversation_id", ingestao.conversation_id)
      .eq("job_id", enfileirado.job_id)
      .throwOnError();
    const linha = (linhas as Record<string, unknown>[])[0];
    expect(linha).toMatchObject({
      author: "sistema",
      body: envio.mensagem,
      delivery_status: "enviada",
      cost_cents: 0,
      billable: false,
    });
    expect(fakeSentMessages().map((m) => m.body)).toContain(envio.mensagem);

    // A decisao ligada a mensagem, e o turno enviado sem texto.
    const { data: decisao } = await admin
      .from("ai_decision_log")
      .select(
        "desfecho, preparo_versao_id, texto_sha256, aprovado, escalation_reason, tool_used, message_id",
      )
      .eq("job_id", enfileirado.job_id)
      .single()
      .throwOnError();
    expect(decisao).toEqual({
      desfecho: "enviou_preparo",
      preparo_versao_id: salvo.versao_id,
      texto_sha256: sha256(envio.mensagem),
      aprovado: false,
      escalation_reason: null,
      tool_used: "enviar_preparo",
      message_id: linha?.id,
    });
    const { data: turno } = await admin
      .from("ai_turno")
      .select("estado, saida, texto, texto_sha256")
      .eq("job_id", enfileirado.job_id)
      .single()
      .throwOnError();
    expect(turno).toEqual({
      estado: "enviado",
      saida: "preparo",
      texto: null,
      texto_sha256: sha256(envio.mensagem),
    });
    // A conversa segue na IA.
    const { data: conversa } = await admin
      .from("conversation")
      .select("status")
      .eq("id", ingestao.conversation_id)
      .single()
      .throwOnError();
    expect((conversa as { status: string }).status).toBe("ia_atendendo");
  }, 120_000);
});
// [AG7 preparo] fim

describe("as tres decisoes do dono de 05/11/2026", () => {
  let exame = "";
  beforeAll(async () => {
    exame = await inserir("procedure", {
      clinic_id: clinica,
      name: "Exame das decisoes",
      active: true,
    });
  });

  async function definirNovo(pessoa: string, conselho: string): Promise<void> {
    const { error } = await como("admin").rpc("definir_responsavel_tecnico", {
      p_clinic_id: clinica,
      p_user_id: idDe(pessoa),
      p_nome: "Dra. Decisão",
      p_conselho: conselho,
      p_numero: "999",
      p_uf: "CE",
    });
    expect(error).toBeNull();
  }

  it("o sintoma normalizado e a oferta: recusados ao salvar; o texto administrativo passa", async () => {
    const lida = await maiorVersao(exame);
    for (const recusado of [
      "Cólica leve depois do laxante é normal e passa sozinha.",
      "Aproveite e faça também a limpeza de pele.",
    ]) {
      const { error } = await como("admin").rpc(
        "salvar_preparo_do_procedimento",
        { p_procedure_id: exame, p_texto: recusado, p_versao_lida: lida },
      );
      expect(error?.code).toBe("22023");
      expect(error?.message).toBe("texto_recusado");
    }
    expect(await maiorVersao(exame)).toBe(lida);
    const { error } = await como("admin").rpc(
      "salvar_preparo_do_procedimento",
      {
        p_procedure_id: exame,
        p_texto: "É normal levar um acompanhante. Faça também o jejum.",
        p_versao_lida: lida,
      },
    );
    expect(error).toBeNull();
  });

  // Decisao do dono de 06/11/2026 (migration 20261106110000): a conferencia do
  // registro nao entra mais; o RT vigente e o texto aprovado bastam.
  it("sem a conferencia, sai; conferir nao muda nada; trocar o RT tira de vigor", async () => {
    await definirNovo("rt", "CRM");
    const { data: salvo } = await salvar(
      "admin",
      exame,
      "Traga o pedido médico antes do exame.",
    );
    await aprovar("rt", salvo);
    expect(await lerParaEnvio(salvo.versao_id)).not.toBeNull();
    expect((await emVigorNoBanco()).has(salvo.versao_id)).toBe(true);
    await conferirRtAberto();
    expect((await emVigorNoBanco()).has(salvo.versao_id)).toBe(true);
    await definirNovo("rt", "CRM");
    expect((await emVigorNoBanco()).has(salvo.versao_id)).toBe(false);
  });

  it("remedio ou dose so de CRM ou CRO: o CRN e recusado ao salvar", async () => {
    await definirNovo("rt", "CRN");
    await conferirRtAberto();
    const { error } = await como("admin").rpc(
      "salvar_preparo_do_procedimento",
      {
        p_procedure_id: exame,
        p_texto: "Tome 2 comprimidos de bisacodil às 18h.",
        p_versao_lida: await maiorVersao(exame),
      },
    );
    expect(error?.code).toBe("P0001");
    expect(error?.message).toBe("conselho_nao_aceita_remedio_ou_dose");
    await definirNovo("rt", "CRM");
    await conferirRtAberto();
  });
});
