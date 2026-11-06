import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, anonClient } from "../rls/stack";

// O preparo aprovado pelo RT (AG7, migration
// 20261103100000_preparo_aprovado_pelo_rt.sql) com chamadas AO MESMO TEMPO,
// contra o banco REAL: o envio da mensagem do preparo pelo servidor (como o
// envio grava a linha), e as RPCs das telas pela sessao de cada papel.
//
// LIMITE (o mesmo de midia-pela-ia-concorrencia.test.ts): os casos "ao mesmo
// tempo" disparam as chamadas por HTTP (Promise.all) e NAO forcam a
// sobreposicao dentro do Postgres; eles provam o RESULTADO FINAL no banco
// real, em qualquer ordem que o PostgREST executar, nunca a trava. A prova
// deterministica das travas (uma sessao segura a transacao aberta e a outra
// TEM de esperar, nas duas ordens; a migration contra sessoes segurando as
// tabelas) esta no harness local
// (~/.claude/plans/agente-completo/ag7/banco/travas), nunca na producao.
// - P1, o envio contra a suspensao: ou a mensagem saiu (aprovada naquele
//   instante) e a versao ficou suspensa, ou o envio foi recusado (CZIA3);
//   nunca sai depois da suspensao;
// - P2, duas aprovacoes da mesma versao (o clique duplo): uma aprova, a outra
//   recebe nao_aguarda_aprovacao; uma aprovada so;
// - P3, a aprovacao contra o fim do RT: ou aprovou e saiu de vigor com o fim,
//   ou o fim veio antes e a aprovacao recebeu 42501; nunca em vigor sem RT;
// - P4, salvar duas vezes com a mesma versao lida: uma grava, a outra recebe
//   texto_mudou; uma versao nova so;
// - P6, o envio contra a troca do RT: ou saiu antes da troca, ou recebeu
//   CZIA3; a versao sai de vigor com a troca;
// - P7, definir o RT duas vezes: um aberto so (a segunda recebe
//   outra_definicao, ou encerra a primeira e abre a dela);
// - P7b, definir contra encerrar (BANCO-6): nunca o 23514 de ate antes de
//   desde; a recusa e so outra_definicao (a linha aberta nasceu depois do
//   comeco da transacao de quem perdeu) ou sem_responsavel_tecnico; no maximo
//   um aberto. A corrida deterministica (C1 abre a transacao, C2 define e
//   commita, C1 define ou encerra) e o P10 e o P11 do harness local;
// - P8, aprovar contra suspender: uma aprovada no maximo, e a suspensao
//   nunca deixa uma aprovada nova em vigor por engano;
// - nenhuma chamada devolve 40P01 nem 40001.
//
// ESCRITO NA AG7 E NAO RODADO por quem escreveu: grava no banco. Quem roda e
// o coordenador, DEPOIS de aplicar a migration, com npm run test:integration
// -- preparo-aprovado-pelo-rt-concorrencia (um arquivo por vez).
//
// CUIDADO, o banco e o da producao: clinica e_de_teste (slug
// preparo-conc-*), apagada no afterAll, e os usuarios desta execucao. Nenhum
// modelo e chamado; nenhuma mensagem sai (numero falso). A IA e liberada so
// nesta clinica, em numero inteiro, no numero falso; os contatos sao
// ficticios; cada job de teste e concluido logo depois do caso. O interruptor
// global NUNCA e tocado.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic where slug like 'preparo-conc-%' and e_de_teste;
//   select u.id, u.email from auth.users u where u.email like 'preparo-conc-%@teste.dev';
// e os usuarios pela API de administracao.

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `PreparoConc!${sufixo}`;
const WORKER = `preparo-conc-${sufixo}`;
const RODADAS = 5;

type Erro = { code?: string; message?: string } | null;
type Salvo = { versao_id: string; versao: number; texto_sha256: string };

const usuarios = new Map<string, string>();
const sessoes = new Map<string, SupabaseClient>();
const pessoa = (apelido: string) => usuarios.get(apelido)!;
const como = (apelido: string) => sessoes.get(apelido)!;

let clinica = "";
let conferente: SupabaseClient | null = null;
let numero = "";
let telefones = 0;
let procedimentos = 0;
const jobs: string[] = [];

function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
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
  const email = `preparo-conc-${apelido}-${sufixo}@teste.dev`;
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
  sessoes.set(apelido, cliente);
}

function semCicloNemRepeticao(...respostas: unknown[]): void {
  for (const r of respostas) {
    const texto = JSON.stringify(r);
    expect(texto).not.toContain("40P01");
    expect(texto).not.toContain("40001");
  }
}


// Desde a decisao do dono de 06/11/2026, conferir nao muda mais nada (a RPC
// fica, sem uso). Antes, de 05/11/2026: sem o registro do RT conferido, nada esta em
// vigor, e so o super admin confere. Por isso esta suite exige
// INTEGRACAO_COM_SUPER_ADMIN=1 (o usuario sintetico com product_admin NO BANCO
// DE PRODUCAO, sem vinculo, como em super-admin-sem-clinica.test.ts; sai no
// afterAll). Se uma execucao morrer antes do afterAll:
//   delete from public.product_admin p using auth.users u
//    where u.id = p.user_id and u.email like 'preparo-conc-super-%@example.com';
async function criarConferente(): Promise<void> {
  if (process.env.INTEGRACAO_COM_SUPER_ADMIN !== "1") {
    throw new Error(
      "Rode com INTEGRACAO_COM_SUPER_ADMIN=1: sem a conferencia do registro do RT, nenhum preparo fica em vigor.",
    );
  }
  const email = `preparo-conc-super-${sufixo}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: "Conferente sintético" },
  });
  if (error || !data.user) {
    throw new Error(`criar o conferente: ${error?.message ?? "sem usuário"}`);
  }
  usuarios.set("conferente", data.user.id);
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
  const id = usuarios.get("conferente");
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

async function definirRtConferido(
  apelido: string,
  quem: string,
  nome: string,
): Promise<void> {
  expect(await definirRt(apelido, quem, nome)).toBeNull();
  await conferirRtAberto();
}

async function definirRt(
  apelido: string,
  quem: string,
  nome: string,
): Promise<Erro> {
  const { error } = await como(apelido).rpc("definir_responsavel_tecnico", {
    p_clinic_id: clinica,
    p_user_id: pessoa(quem),
    p_nome: nome,
    p_conselho: "CRM",
    p_numero: "12345",
    p_uf: "CE",
  });
  return error as Erro;
}

async function procedimentoNovo(): Promise<string> {
  procedimentos += 1;
  return inserir("procedure", {
    clinic_id: clinica,
    name: `Exame ${procedimentos}`,
    active: true,
  });
}

async function salvar(
  apelido: string,
  procedimento: string,
  texto: string,
  lida: number,
) {
  return como(apelido).rpc("salvar_preparo_do_procedimento", {
    p_procedure_id: procedimento,
    p_texto: texto,
    p_versao_lida: lida,
  });
}

async function aprovar(apelido: string, salvo: Salvo) {
  return como(apelido).rpc("aprovar_preparo_do_procedimento", {
    p_versao_id: salvo.versao_id,
    p_texto_sha256: salvo.texto_sha256,
  });
}

async function suspender(apelido: string, procedimento: string) {
  return como(apelido).rpc("suspender_preparo_do_procedimento", {
    p_procedure_id: procedimento,
  });
}

/** Um procedimento novo com a versao 1 aprovada pelo RT de agora. */
async function aprovadoNovo(): Promise<{ procedimento: string; salvo: Salvo }> {
  const procedimento = await procedimentoNovo();
  const { data, error } = await salvar(
    "admin",
    procedimento,
    `Jejum de ${procedimentos} horas.`,
    0,
  );
  expect(error).toBeNull();
  const salvo = data as Salvo;
  expect((await aprovar("rt", salvo)).error).toBeNull();
  return { procedimento, salvo };
}

async function situacao(versao: string): Promise<string> {
  const { data } = await admin
    .from("preparo_do_procedimento")
    .select("situacao")
    .eq("id", versao)
    .single()
    .throwOnError();
  return (data as { situacao: string }).situacao;
}

async function emVigor(versao: string): Promise<boolean> {
  return (
    (await rpcOk<{ mensagem: string } | null>("ler_preparo_para_envio", {
      p_clinic_id: clinica,
      p_versao_id: versao,
    })) !== null
  );
}

/** A conversa na IA com a janela, o job em execucao e a decisao do preparo da versao. */
async function cenaDoEnvio(
  versao: string,
): Promise<{ conversa: string; job: string; mensagem: string }> {
  telefones += 1;
  const contato = await inserir("contact", {
    clinic_id: clinica,
    phone_e164: `+55848${digitos}${String(telefones).padStart(3, "0")}`,
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
  jobs.push(job);
  const lido = await rpcOk<{ mensagem: string }>("ler_preparo_para_envio", {
    p_clinic_id: clinica,
    p_versao_id: versao,
  });
  await admin
    .from("ai_decision_log")
    .insert({
      clinic_id: clinica,
      conversation_id: conversa,
      job_id: job,
      desfecho: "enviou_preparo",
      preparo_versao_id: versao,
      texto_sha256: sha256(lido.mensagem),
      tool_used: "enviar_preparo",
    })
    .throwOnError();
  return { conversa, job, mensagem: lido.mensagem };
}

async function enviar(cena: {
  conversa: string;
  job: string;
  mensagem: string;
}) {
  return admin.from("message").insert({
    clinic_id: clinica,
    conversation_id: cena.conversa,
    whatsapp_account_id: numero,
    direction: "saida",
    author: "sistema",
    content_type: "texto",
    body: cena.mensagem,
    job_id: cena.job,
  });
}

async function mensagensDoJob(job: string): Promise<number> {
  const { count } = await admin
    .from("message")
    .select("id", { count: "exact", head: true })
    .eq("job_id", job)
    .throwOnError();
  return count ?? -1;
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "preparo-conc-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
  clinica = await inserir("clinic", {
    name: `Preparo Conc ${sufixo}`,
    slug: `preparo-conc-${sufixo}`,
    e_de_teste: true,
    timezone: "America/Fortaleza",
  });
  numero = (await criarNumeroDeTeste(admin, clinica, { nome: "Recepção" })).id;
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinica,
    p_liberada: true,
    p_modo: "numero_inteiro",
    p_motivo: "teste de concorrencia da AG7",
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
  await criarPessoa("admin", "admin");
  await criarPessoa("admin2", "admin");
  await criarPessoa("gestor", "gestor");
  await criarPessoa("rt", "profissional");
  await criarPessoa("rt2", "recepcao");
  await criarConferente();
  await definirRtConferido("admin", "rt", "Dra. Ana Souza");
}, 300_000);

afterAll(async () => {
  for (const job of jobs) {
    await admin
      .from("job_queue")
      .update({ status: "concluido", locked_by: null, locked_at: null })
      .eq("id", job);
  }
  if (clinica) {
    await admin.from("clinic").delete().eq("id", clinica);
  }
  await tirarConferente();
  for (const id of usuarios.values()) {
    await admin.auth.admin.deleteUser(id);
  }
}, 120_000);

describe("P1, o envio contra a suspensao", () => {
  it("ou saiu aprovada e ficou suspensa, ou foi recusada; nunca sai depois", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const { procedimento, salvo } = await aprovadoNovo();
      const cena = await cenaDoEnvio(salvo.versao_id);
      const [e, s] = await Promise.all([
        enviar(cena),
        suspender("gestor", procedimento),
      ]);
      semCicloNemRepeticao(e.error, s.error);
      expect(s.error).toBeNull();
      expect(await situacao(salvo.versao_id)).toBe("suspenso");
      if (e.error) {
        expect(e.error.code).toBe("CZIA3");
        expect(await mensagensDoJob(cena.job)).toBe(0);
      } else {
        expect(await mensagensDoJob(cena.job)).toBe(1);
      }
      expect(await emVigor(salvo.versao_id)).toBe(false);
      await rpcOk("concluir_job", { p_id: cena.job, p_worker: WORKER });
    }
  });
});

describe("P2, duas aprovacoes da mesma versao", () => {
  it("uma aprova, a outra recebe nao_aguarda_aprovacao; uma aprovada so", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const procedimento = await procedimentoNovo();
      const { data } = await salvar(
        "admin",
        procedimento,
        "Jejum de 4 horas.",
        0,
      );
      const salvo = data as Salvo;
      const [a, b] = await Promise.all([
        aprovar("rt", salvo),
        aprovar("rt", salvo),
      ]);
      semCicloNemRepeticao(a.error, b.error);
      const erros = [a.error, b.error].filter(Boolean) as {
        code: string;
        message: string;
      }[];
      expect(erros).toHaveLength(1);
      expect(erros[0]).toMatchObject({
        code: "P0001",
        message: "nao_aguarda_aprovacao",
      });
      const { count } = await admin
        .from("preparo_do_procedimento")
        .select("id", { count: "exact", head: true })
        .eq("procedure_id", procedimento)
        .eq("situacao", "aprovado")
        .throwOnError();
      expect(count).toBe(1);
    }
  });
});

describe("P3, a aprovacao contra o fim do RT", () => {
  it("ou aprovou e saiu de vigor, ou recebeu 42501; nunca em vigor sem RT", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const procedimento = await procedimentoNovo();
      const { data } = await salvar(
        "admin",
        procedimento,
        "Jejum de 5 horas.",
        0,
      );
      const salvo = data as Salvo;
      const [a, f] = await Promise.all([
        aprovar("rt", salvo),
        como("admin").rpc("encerrar_responsavel_tecnico", {
          p_clinic_id: clinica,
        }),
      ]);
      semCicloNemRepeticao(a.error, f.error);
      expect(f.error).toBeNull();
      if (a.error) {
        expect(a.error.code).toBe("42501");
        expect(await situacao(salvo.versao_id)).toBe("aguardando_rt");
      } else {
        expect(await situacao(salvo.versao_id)).toBe("aprovado");
      }
      expect(await emVigor(salvo.versao_id)).toBe(false);
      await definirRtConferido("admin", "rt", "Dra. Ana Souza");
    }
  });
});

describe("P4, salvar duas vezes com a mesma versao lida", () => {
  it("uma grava, a outra recebe texto_mudou; uma versao so", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const procedimento = await procedimentoNovo();
      const [a, b] = await Promise.all([
        salvar("admin", procedimento, "Jejum de 2 horas.", 0),
        salvar("gestor", procedimento, "Jejum de 3 horas.", 0),
      ]);
      semCicloNemRepeticao(a.error, b.error);
      const erros = [a.error, b.error].filter(Boolean) as {
        code: string;
        message: string;
      }[];
      expect(erros).toHaveLength(1);
      expect(erros[0]).toMatchObject({ code: "P0001", message: "texto_mudou" });
      const { count } = await admin
        .from("preparo_do_procedimento")
        .select("id", { count: "exact", head: true })
        .eq("procedure_id", procedimento)
        .throwOnError();
      expect(count).toBe(1);
    }
  });
});

describe("P6, o envio contra a troca do RT", () => {
  it("ou saiu antes da troca, ou recebeu CZIA3; a versao sai de vigor com a troca", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const { salvo } = await aprovadoNovo();
      const cena = await cenaDoEnvio(salvo.versao_id);
      const outro = i % 2 === 0 ? "rt2" : "rt";
      const [e, d] = await Promise.all([
        enviar(cena),
        definirRt("admin", outro, `Dr. Troca ${i}`),
      ]);
      semCicloNemRepeticao(e.error, d);
      expect(d).toBeNull();
      if (e.error) {
        expect(e.error.code).toBe("CZIA3");
        expect(await mensagensDoJob(cena.job)).toBe(0);
      } else {
        expect(await mensagensDoJob(cena.job)).toBe(1);
      }
      expect(await emVigor(salvo.versao_id)).toBe(false);
      await rpcOk("concluir_job", { p_id: cena.job, p_worker: WORKER });
      // O RT de antes de volta, para o proximo caso aprovar.
      await definirRtConferido("admin", "rt", "Dra. Ana Souza");
    }
  });
});

describe("P7, definir o RT duas vezes", () => {
  it("um aberto so; a segunda recebe outra_definicao ou encerra a primeira", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const [a, b] = await Promise.all([
        definirRt("admin", "rt2", "Dr. Bruno Lima"),
        definirRt("admin2", "rt", "Dra. Ana Souza"),
      ]);
      semCicloNemRepeticao(a, b);
      for (const erro of [a, b].filter(Boolean)) {
        expect(erro).toMatchObject({
          code: "P0001",
          message: "outra_definicao",
        });
      }
      expect([a, b].filter((e) => e === null).length).toBeGreaterThanOrEqual(1);
      const { count } = await admin
        .from("responsavel_tecnico")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinica)
        .is("ate", null)
        .throwOnError();
      expect(count).toBe(1);
      await definirRtConferido("admin", "rt", "Dra. Ana Souza");
    }
  });
});

describe("P7b, definir contra encerrar (BANCO-6)", () => {
  it("nunca 23514; so outra_definicao ou sem_responsavel_tecnico; no maximo um aberto", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const [definiu, encerrou] = await Promise.all([
        definirRt("admin", "rt2", "Dr. Bruno Lima"),
        como("admin2")
          .rpc("encerrar_responsavel_tecnico", { p_clinic_id: clinica })
          .then(({ error }) => error as Erro),
      ]);
      semCicloNemRepeticao(definiu, encerrou);
      for (const erro of [definiu, encerrou].filter(Boolean)) {
        expect(erro?.code).toBe("P0001");
        expect(["outra_definicao", "sem_responsavel_tecnico"]).toContain(
          erro?.message,
        );
      }
      const { count } = await admin
        .from("responsavel_tecnico")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinica)
        .is("ate", null)
        .throwOnError();
      expect(count ?? 0).toBeLessThanOrEqual(1);
      // De volta ao RT de sempre.
      await definirRtConferido("admin", "rt", "Dra. Ana Souza");
    }
  });
});

describe("P8, aprovar contra suspender", () => {
  it("uma aprovada no maximo; a suspensao pega a aprovada de quando chegou", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const { procedimento, salvo: primeira } = await aprovadoNovo();
      const { data } = await salvar(
        "admin",
        procedimento,
        "Jejum de 12 horas.",
        1,
      );
      const segunda = data as Salvo;
      const [a, s] = await Promise.all([
        aprovar("rt", segunda),
        suspender("gestor", procedimento),
      ]);
      semCicloNemRepeticao(a.error, s.error);
      expect(a.error).toBeNull();
      expect(s.error).toBeNull();
      const suspensa = (s.data as { versao_id: string }).versao_id;
      if (suspensa === segunda.versao_id) {
        // A aprovacao veio antes: a primeira foi substituida e a segunda suspensa.
        expect(await situacao(primeira.versao_id)).toBe("substituido");
        expect(await situacao(segunda.versao_id)).toBe("suspenso");
      } else {
        // A suspensao veio antes: a primeira suspensa e a segunda aprovada.
        expect(suspensa).toBe(primeira.versao_id);
        expect(await situacao(primeira.versao_id)).toBe("suspenso");
        expect(await situacao(segunda.versao_id)).toBe("aprovado");
      }
      const { count } = await admin
        .from("preparo_do_procedimento")
        .select("id", { count: "exact", head: true })
        .eq("procedure_id", procedimento)
        .eq("situacao", "aprovado")
        .throwOnError();
      expect(count ?? 0).toBeLessThanOrEqual(1);
    }
  });
});
