import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, anonClient } from "../rls/stack";

// Midia na conversa com a IA (AG6b, migration 20261030100000_midia_pela_ia.sql)
// com chamadas AO MESMO TEMPO, contra o banco REAL: a gravacao da leitura
// pelo servidor (como o motor da IA), o apagamento pela sessao do
// administrador (a tela) e pelo servidor (o WhatsApp), o Assumir pela sessao
// de quem atende (o update condicional das Server Actions do Atendimento), a
// passagem e a atribuicao pelo servidor.
//
// LIMITE (o mesmo de urgencia-e-passagem-concorrencia.test.ts): os casos "ao
// mesmo tempo" disparam as chamadas por HTTP (Promise.all) e NAO forcam a
// sobreposicao dentro do Postgres; eles provam o RESULTADO FINAL no banco
// real, em qualquer ordem que o PostgREST executar, nunca a trava. A prova
// deterministica das travas (uma sessao segura a transacao aberta e a outra
// TEM de esperar, nas duas ordens, com o audio sendo ou nao a ultima
// mensagem; tres sessoes e a ordem mensagem e depois conversa; a migration
// contra sessoes segurando as tabelas) esta no harness local
// (~/.claude/plans/agente-completo/ag6/banco-b/travas), nunca na producao.
// - R1, a leitura contra o apagamento (pela tela e pelo WhatsApp): nunca fica
//   leitura de mensagem apagada; a gravacao gravou (e o apagamento a levou)
//   ou recebeu mensagem_invalida;
// - R2, duas leituras da mesma mensagem (dois jobs): uma leitura so; uma
//   chamada grava, a outra recebe reutilizado (ou as duas veem a mesma);
// - R3, a leitura contra o Assumir: ou a leitura veio antes (gravada, e a
//   conversa assumida), ou o Assumir veio antes (fora_da_ia, nenhuma
//   leitura); nunca leitura gravada depois de a conversa ser assumida;
// - R4, a ordem do motor: a leitura contra a passagem do mesmo job; depois, a
//   atribuicao ve a leitura (atribuida) ou nao (midia_nao_lida);
// - nenhuma chamada devolve 40P01 nem 40001.
//
// ESCRITO NA AG6b E NAO RODADO por quem escreveu: grava no banco. Quem roda
// e o coordenador, DEPOIS de aplicar a migration, com npm run
// test:integration -- midia-pela-ia-concorrencia (um arquivo por vez).
//
// CUIDADO, o banco e o da producao: clinica e_de_teste (slug midia-conc-*),
// apagada no afterAll, os usuarios desta execucao e os arquivos sinteticos
// do Storage (bucket midia-conversas, so na pasta da clinica de teste).
// Nenhum modelo e chamado; nenhuma mensagem sai (numero fake). A IA e
// liberada so nesta clinica, no numero falso, e so para telefones
// ficticios. A LICAO DE 30/10/2026 (commit 3f87861 do main): TODO contato
// nasce kind 'paciente' e o telefone e liberado FORCADO, com o aviso novo
// (2), ANTES de qualquer conversa existir; nenhum definir_* roda depois; as
// conversas sao linhas gravadas direto, sem janela (a manutencao do motor
// nao as toca). O interruptor global NUNCA e tocado.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic where slug like 'midia-conc-%' and e_de_teste;
//   select u.id, u.email from auth.users u where u.email like 'midia-conc-%@teste.dev';
// os usuarios pela API de administracao, e no Storage (midia-conversas) a
// pasta com a id da clinica apagada.

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `MidiaConc!${sufixo}`;
const WORKER = `midia-conc-${sufixo}`;
const BUCKET = "midia-conversas";
const RODADAS = 6;
const usuarios = new Map<string, string>();
const arquivos: string[] = [];

type Gravacao = { ok: boolean; motivo?: string; reutilizado?: boolean; id?: string };
type Atribuicao = { atribuida: boolean; codigo: string };

let clinica = "";
let numero = "";
let administrador: SupabaseClient;
let recepcao: SupabaseClient;
/** Os telefones, um por conversa, todos liberados antes de qualquer conversa. */
const livres: string[] = [];

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

async function criarPessoa(apelido: string, papel: string): Promise<SupabaseClient> {
  const email = `midia-conc-${apelido}-${sufixo}@teste.dev`;
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
  const cliente = anonClient();
  const { error: erroLogin } = await cliente.auth.signInWithPassword({ email, password: SENHA });
  if (erroLogin) {
    throw new Error(`login ${apelido}: ${erroLogin.message}`);
  }
  return cliente;
}

/** A conversa na IA (direta, sem janela) do proximo telefone livre, com o audio ja no Storage. */
async function cena(): Promise<{ conversa: string; mensagem: string; job: string; wa: string }> {
  const telefone = livres.shift()!;
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
    status: "ia_atendendo",
    awaiting_reply: false,
    whatsapp_account_id: numero,
  });
  const mensagem = crypto.randomUUID();
  const wa = `midia-conc:${sufixo}:${mensagem}`;
  const caminho = `${clinica}/${mensagem}`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(caminho, new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0])], { type: "audio/mpeg" }), {
      contentType: "audio/mpeg",
      upsert: true,
    });
  expect(error, "subir o arquivo sintetico").toBeNull();
  arquivos.push(caminho);
  await admin
    .from("message")
    .insert({
      id: mensagem,
      clinic_id: clinica,
      conversation_id: conversa,
      wa_message_id: wa,
      direction: "entrada",
      author: "paciente",
      content_type: "audio",
      media_url: `storage://${BUCKET}/${caminho}`,
      media_mimetype: "audio/mpeg",
    })
    .throwOnError();
  const job = await jobQueLeu(conversa, mensagem);
  return { conversa, mensagem, job, wa };
}

async function jobQueLeu(conversa: string, mensagem: string): Promise<string> {
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
    .insert({ job_id: job, clinic_id: clinica, conversation_id: conversa, estado: "reservado", mensagens_lidas: [mensagem] })
    .throwOnError();
  return job;
}

/** A gravacao pelo servidor; devolve o resultado ou o codigo do erro. */
async function gravar(job: string, mensagem: string): Promise<Gravacao | { erro: string }> {
  const { data, error } = await admin.rpc("gravar_leitura_da_midia", {
    p_job_id: job,
    p_worker: WORKER,
    p_message_id: mensagem,
    p_midia: "audio",
    p_tipo: "transcricao",
    p_transcricao: "Texto sintetico",
    p_segundos: 10,
    p_procedimentos: null,
    p_fora_do_cadastro: null,
    p_confianca: null,
    p_resumo: null,
    p_modelo: "whisper-1",
    p_versao: "transcricao-0123456789ab",
  });
  return error ? { erro: error.code ?? "?" } : (data as Gravacao);
}

async function leituras(mensagem: string): Promise<number> {
  const { count } = await admin
    .from("ia_leitura_da_midia")
    .select("id", { count: "exact", head: true })
    .eq("message_id", mensagem)
    .throwOnError();
  return count ?? -1;
}

async function apagada(mensagem: string): Promise<boolean> {
  const { data } = await admin.from("message").select("deleted_at").eq("id", mensagem).single().throwOnError();
  return (data as { deleted_at: string | null }).deleted_at !== null;
}

function semCicloNemRepeticao(...respostas: unknown[]): void {
  for (const r of respostas) {
    const texto = JSON.stringify(r);
    expect(texto).not.toContain("40P01");
    expect(texto).not.toContain("40001");
  }
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "midia-conc-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
  clinica = await inserir("clinic", {
    name: `Midia Conc ${sufixo}`,
    slug: `midia-conc-${sufixo}`,
    e_de_teste: true,
    timezone: "America/Fortaleza",
  });
  numero = (await criarNumeroDeTeste(admin, clinica, { nome: "Recepção" })).id;
  await inserir("ai_agent_config", {
    clinic_id: clinica,
    version: 1,
    status: "publicada",
    published_at: new Date().toISOString(),
    skills: { ler_audio: true, ler_imagem_e_documento: true },
    escalation_rules: { passagem_para: "responsavel_do_lead" },
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: false,
  });
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinica,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de concorrencia da AG6b",
  });
  await rpcOk("definir_numero_da_ia", { p_clinic_id: clinica, p_whatsapp_account_id: numero, p_ativo: true });
  administrador = await criarPessoa("admin", "admin");
  recepcao = await criarPessoa("recepcao", "recepcao");
  await criarPessoa("dona", "recepcao");
  // TODOS os telefones antes de qualquer conversa (a licao de 30/10/2026).
  for (let i = 0; i < RODADAS * 5; i += 1) {
    const telefone = `+55845${digitos}${String(i).padStart(2, "0")}`;
    await admin
      .from("contact")
      .insert({ clinic_id: clinica, phone_e164: telefone, name: "Contato sintético", kind: "paciente", owner_user_id: pessoa("dona") })
      .throwOnError();
    await rpcOk("definir_contato_liberado_da_ia", {
      p_clinic_id: clinica,
      p_telefone_e164: telefone,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_forcar_contato_existente: true,
      p_confirmou_aviso_da_openai: true,
      p_confirmou_teste_com_paciente: true,
      p_versao_do_aviso: 2,
    });
    livres.push(telefone);
  }
}, 300_000);

afterAll(async () => {
  if (arquivos.length > 0) {
    await admin.storage.from(BUCKET).remove(arquivos);
  }
  if (clinica) {
    await admin.from("clinic").delete().eq("id", clinica);
  }
  for (const id of usuarios.values()) {
    await admin.auth.admin.deleteUser(id);
  }
}, 120_000);

describe("R1, a leitura contra o apagamento", () => {
  it("pela tela: nunca fica leitura de mensagem apagada", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const { mensagem, job } = await cena();
      const [g, a] = await Promise.all([
        gravar(job, mensagem),
        administrador.rpc("apagar_mensagem", { p_message_id: mensagem, p_escopo: "local" }),
      ]);
      semCicloNemRepeticao(g, a.error);
      expect(a.error).toBeNull();
      expect(await apagada(mensagem)).toBe(true);
      expect(await leituras(mensagem)).toBe(0);
      expect(
        (g as Gravacao).ok === true || (g as Gravacao).motivo === "mensagem_invalida",
        JSON.stringify(g),
      ).toBe(true);
    }
  });

  it("pelo WhatsApp: nunca fica leitura de mensagem apagada", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const { mensagem, job, wa } = await cena();
      const [g, a] = await Promise.all([
        gravar(job, mensagem),
        admin.rpc("registrar_apagamento_do_whatsapp", { p_clinic_id: clinica, p_wa_message_id: wa }),
      ]);
      semCicloNemRepeticao(g, a.error);
      expect(a.error).toBeNull();
      expect(await apagada(mensagem)).toBe(true);
      expect(await leituras(mensagem)).toBe(0);
      expect(
        (g as Gravacao).ok === true || (g as Gravacao).motivo === "mensagem_invalida",
        JSON.stringify(g),
      ).toBe(true);
    }
  });
});

describe("R2, duas leituras da mesma mensagem", () => {
  it("uma leitura so; uma grava, a outra reutiliza", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const { conversa, mensagem, job } = await cena();
      const outro = await jobQueLeu(conversa, mensagem);
      const [a, b] = await Promise.all([gravar(job, mensagem), gravar(outro, mensagem)]);
      semCicloNemRepeticao(a, b);
      expect(await leituras(mensagem)).toBe(1);
      const respostas = [a as Gravacao, b as Gravacao];
      expect(respostas.every((r) => r.ok === true)).toBe(true);
      expect(respostas.filter((r) => r.reutilizado === false)).toHaveLength(1);
      expect(respostas[0]!.id).toBe(respostas[1]!.id);
    }
  });
});

describe("R3, a leitura contra o Assumir", () => {
  it("ou a leitura antes (gravada e a conversa assumida), ou o Assumir antes (fora_da_ia, nada gravado)", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const { conversa, mensagem, job } = await cena();
      const [g, s] = await Promise.all([
        gravar(job, mensagem),
        recepcao
          .from("conversation")
          .update({ status: "em_atendimento", assignee_user_id: pessoa("recepcao") })
          .eq("id", conversa)
          .in("status", ["ia_atendendo", "aguardando_humano"])
          .is("assignee_user_id", null)
          .select("id"),
      ]);
      semCicloNemRepeticao(g, s.error);
      expect(s.error).toBeNull();
      expect(s.data).toHaveLength(1);
      const r = g as Gravacao;
      if (r.ok) {
        expect(await leituras(mensagem)).toBe(1);
      } else {
        expect(r.motivo).toBe("fora_da_ia");
        expect(await leituras(mensagem)).toBe(0);
      }
    }
  });
});

describe("R4, a ordem do motor: a leitura e a passagem do mesmo job", () => {
  it("depois, a atribuicao ve a leitura (atribuida) ou nao (midia_nao_lida)", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const { conversa, mensagem, job } = await cena();
      await admin
        .from("ai_decision_log")
        .insert({ clinic_id: clinica, conversation_id: conversa, job_id: job, desfecho: "escalou", escalation_reason: "pedido_humano" })
        .throwOnError();
      const [g, p] = await Promise.all([
        gravar(job, mensagem),
        admin.rpc("passar_conversa_da_ia_para_equipe", { p_job_id: job, p_worker: WORKER, p_motivo: "pedido_humano" }),
      ]);
      semCicloNemRepeticao(g, p.error);
      expect(p.error).toBeNull();
      const atribuicao = await rpcOk<Atribuicao>("atribuir_conversa_passada_pela_ia", { p_job_id: job, p_worker: WORKER });
      const r = g as Gravacao;
      if (r.ok) {
        expect(await leituras(mensagem)).toBe(1);
        expect(atribuicao).toEqual({ atribuida: true, codigo: "atribuida" });
      } else {
        expect(r.motivo).toBe("fora_da_ia");
        expect(await leituras(mensagem)).toBe(0);
        expect(atribuicao).toEqual({ atribuida: false, codigo: "midia_nao_lida" });
      }
      await rpcOk("concluir_job", { p_id: job, p_worker: WORKER });
    }
  });
});
