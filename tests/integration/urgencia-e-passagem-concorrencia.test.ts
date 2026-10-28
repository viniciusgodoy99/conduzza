import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, anonClient } from "../rls/stack";

// Urgencia e passagem da IA (AG6a, migration 20261029120000, com a revisao
// de 28/10/2026: a atribuicao e a RPC atribuir_conversa_passada_pela_ia,
// DEPOIS da passagem e da frase) com chamadas AO MESMO TEMPO, contra o banco
// REAL: a passagem e a atribuicao pelo servidor (como o motor da IA) e o
// Assumir ou o Resolver pela sessao de quem atende (o update condicional
// das Server Actions do Atendimento).
//
// LIMITE (o mesmo de ia-agenda-concorrencia.test.ts): os casos "ao mesmo
// tempo" disparam as chamadas por HTTP (Promise.all) e NAO forcam a
// sobreposicao dentro do Postgres; eles provam o RESULTADO FINAL no banco
// real, em qualquer ordem que o PostgREST executar, nunca a trava. A prova
// deterministica das travas (uma sessao segura a transacao aberta e a outra
// TEM de esperar, nas duas ordens) e da migration contra sessoes segurando
// conversation e ai_decision_log (S5: sem 40P01; 55P03 depois de 3 s) esta
// no harness local (~/.claude/plans/agente-completo/ag6/banco/travas),
// nunca na producao.
// - R0, a passagem contra o Assumir de quem viu a conversa na IA: a passagem
//   nunca atribui; ou ela veio antes (a conversa na fila, o Assumir nao acha
//   a linha) ou o Assumir veio antes (ja_fora_da_ia);
// - R1, a atribuicao (com a passagem ja feita) contra o Assumir de quem viu
//   a conversa na fila: a conversa termina com UMA pessoa (o responsavel do
//   lead, se a atribuicao veio antes; quem assumiu, se o Assumir veio antes,
//   e a atribuicao devolve fora_da_fila) e nunca com o evento da atribuicao
//   sem a conversa estar com o responsavel;
// - R2, a urgencia contra o Assumir (e contra o Resolver): a marca nunca
//   fica ABERTA com a conversa fora de "Aguardando voce";
// - nenhuma chamada devolve 40P01 nem 40001.
//
// ESCRITO NA AG6a E NAO RODADO por quem escreveu: grava no banco. Quem roda
// e o coordenador, DEPOIS de aplicar a migration, com npm run
// test:integration -- urgencia-e-passagem-concorrencia.
//
// CUIDADO, o banco e o da producao: clinica e_de_teste (sem a IA liberada,
// numero fake: nenhuma mensagem sai), apagada no afterAll, e os usuarios
// desta execucao. O interruptor global NUNCA e tocado. Telefones ficticios.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic where slug like 'urgencia-conc-%' and e_de_teste;
//   select u.id, u.email from auth.users u where u.email like 'urgencia-conc-%@teste.dev';
// e os usuarios pela API de administracao.

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const SENHA = `UrgenciaConc!${sufixo}`;
const WORKER = `urgencia-conc-${sufixo}`;
const RODADAS = 6;
const usuarios = new Map<string, string>();

type Passagem = {
  passou: boolean;
  codigo: string;
  urgente: boolean;
};

type Atribuicao = {
  atribuida: boolean;
  codigo: string;
};

let clinica = "";
let numero = "";
let recepcao: SupabaseClient;
let telefones = 0;

const pessoa = (apelido: string) => usuarios.get(apelido)!;

async function inserir(tabela: string, linha: Record<string, unknown>): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function criarPessoa(apelido: string, papel: string): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `urgencia-conc-${apelido}-${sufixo}@teste.dev`,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Pessoa ${apelido}` },
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuário"}`);
  }
  usuarios.set(apelido, data.user.id);
  await admin
    .from("clinic_member")
    .insert({ clinic_id: clinica, user_id: data.user.id, role: papel, status: "ativo" })
    .throwOnError();
}

async function naIa(dono: string | null): Promise<string> {
  telefones += 1;
  const contato = await inserir("contact", {
    clinic_id: clinica,
    phone_e164: `+55846${digitos}${String(telefones).padStart(2, "0")}`,
    name: "Contato sintético",
    kind: "lead",
    owner_user_id: dono,
  });
  return inserir("conversation", {
    clinic_id: clinica,
    contact_id: contato,
    status: "ia_atendendo",
    awaiting_reply: false,
    whatsapp_account_id: numero,
  });
}

async function jobEmExecucao(conversa: string): Promise<string> {
  return inserir("job_queue", {
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
}

/** A decisao do job (escalou, com o motivo), como o motor grava antes da passagem. */
async function decidir(conversa: string, job: string, motivo: string): Promise<void> {
  await admin
    .from("ai_decision_log")
    .insert({
      clinic_id: clinica,
      conversation_id: conversa,
      job_id: job,
      desfecho: "escalou",
      escalation_reason: motivo,
    })
    .throwOnError();
}

async function passar(job: string, motivo: string) {
  return admin.rpc("passar_conversa_da_ia_para_equipe", {
    p_job_id: job,
    p_worker: WORKER,
    p_motivo: motivo,
  });
}

async function atribuir(job: string) {
  return admin.rpc("atribuir_conversa_passada_pela_ia", { p_job_id: job, p_worker: WORKER });
}

/** O Assumir da tela, a partir do estado que ela viu. */
async function assumir(conversa: string, statusVisto: string) {
  return recepcao
    .from("conversation")
    .update({ status: "em_atendimento", assignee_user_id: pessoa("recepcao") })
    .eq("id", conversa)
    .eq("status", statusVisto)
    .is("assignee_user_id", null)
    .select("id");
}

async function resolver(conversa: string) {
  return recepcao
    .from("conversation")
    .update({ status: "resolvida", awaiting_reply: false })
    .eq("id", conversa)
    .neq("status", "resolvida")
    .select("id");
}

async function situacao(conversa: string) {
  const [{ data: c }, { data: m }, { data: e }] = await Promise.all([
    admin.from("conversation").select("status, assignee_user_id").eq("id", conversa).single().throwOnError(),
    admin
      .from("conversa_urgente")
      .select("encerrada_em, encerrada_como")
      .eq("conversation_id", conversa)
      .maybeSingle()
      .throwOnError(),
    admin
      .from("message")
      .select("body")
      .eq("conversation_id", conversa)
      .eq("content_type", "evento")
      .like("body", "A conversa ficou com%")
      .throwOnError(),
  ]);
  return {
    conversa: c as { status: string; assignee_user_id: string | null },
    marca: m as { encerrada_em: string | null; encerrada_como: string | null } | null,
    eventosDaAtribuicao: (e as { body: string }[]).length,
  };
}

function semCicloNemSerializacao(...erros: ({ code?: string } | null)[]): void {
  for (const erro of erros) {
    expect(erro?.code ?? null).not.toBe("40P01");
    expect(erro?.code ?? null).not.toBe("40001");
  }
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "urgencia-conc-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
  clinica = await inserir("clinic", {
    name: `Urgência concorrência ${sufixo}`,
    slug: `urgencia-conc-${sufixo}`,
    e_de_teste: true,
    timezone: "America/Fortaleza",
  });
  numero = (await criarNumeroDeTeste(admin, clinica, { nome: "Recepção" })).id;
  await inserir("ai_agent_config", {
    clinic_id: clinica,
    version: 1,
    status: "publicada",
    published_at: new Date().toISOString(),
    escalation_rules: { passagem_para: "responsavel_do_lead" },
    exige_nome_completo: false,
    exige_nascimento: false,
    exige_cpf: false,
  });
  await criarPessoa("dona", "recepcao");
  await criarPessoa("recepcao", "recepcao");
  recepcao = anonClient();
  const { error } = await recepcao.auth.signInWithPassword({
    email: `urgencia-conc-recepcao-${sufixo}@teste.dev`,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login recepcao: ${error.message}`);
  }
}, 120_000);

afterAll(async () => {
  if (clinica) {
    await admin.from("clinic").delete().eq("id", clinica);
  }
  for (const id of usuarios.values()) {
    await admin.auth.admin.deleteUser(id);
  }
}, 120_000);

describe("R0: a passagem contra o Assumir de quem viu a conversa na IA, ao mesmo tempo", () => {
  it("a passagem nunca atribui: a conversa na fila sem ninguem, ou com quem assumiu", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const conversa = await naIa(pessoa("dona"));
      const job = await jobEmExecucao(conversa);
      await decidir(conversa, job, "sintoma");
      const [p, a] = await Promise.all([passar(job, "sintoma"), assumir(conversa, "ia_atendendo")]);
      semCicloNemSerializacao(p.error, a.error);
      expect(p.error).toBeNull();
      expect(a.error).toBeNull();
      const r = p.data as Passagem;
      const s = await situacao(conversa);
      expect(s.eventosDaAtribuicao).toBe(0);
      if (r.passou) {
        // A passagem veio antes: na fila, sem ninguem (a atribuicao e outra
        // chamada); o Assumir da tela (que viu "na IA") nao achou a linha.
        expect(r).toEqual({ passou: true, codigo: "passou", urgente: false });
        expect(s.conversa).toEqual({ status: "aguardando_humano", assignee_user_id: null });
        expect(a.data).toHaveLength(0);
      } else {
        // O Assumir veio antes: a passagem nao achou a conversa na IA.
        expect(r).toEqual({ passou: false, codigo: "ja_fora_da_ia", urgente: false });
        expect(s.conversa).toEqual({ status: "em_atendimento", assignee_user_id: pessoa("recepcao") });
        expect(a.data).toHaveLength(1);
      }
      await admin.rpc("concluir_job", { p_id: job, p_worker: WORKER });
    }
  }, 120_000);
});

describe("R1: a atribuicao contra o Assumir, ao mesmo tempo", () => {
  it("a conversa termina com UMA pessoa, e o evento da atribuicao so com o responsavel", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const conversa = await naIa(pessoa("dona"));
      const job = await jobEmExecucao(conversa);
      await decidir(conversa, job, "sintoma");
      // A passagem ja feita (o motor passa, manda a frase e so depois atribui).
      const p = await passar(job, "sintoma");
      expect(p.error).toBeNull();
      expect(p.data).toEqual({ passou: true, codigo: "passou", urgente: false });
      const [t, a] = await Promise.all([atribuir(job), assumir(conversa, "aguardando_humano")]);
      semCicloNemSerializacao(t.error, a.error);
      expect(t.error).toBeNull();
      expect(a.error).toBeNull();
      const r = t.data as Atribuicao;
      const s = await situacao(conversa);
      expect(s.conversa.status).toBe("em_atendimento");
      if (r.atribuida) {
        // A atribuicao veio antes: o Assumir da tela (que viu a conversa na
        // fila) nao achou a linha e nao roubou do responsavel.
        expect(r).toEqual({ atribuida: true, codigo: "atribuida" });
        expect(s.conversa.assignee_user_id).toBe(pessoa("dona"));
        expect(a.data).toHaveLength(0);
        expect(s.eventosDaAtribuicao).toBe(1);
      } else {
        // O Assumir veio antes: a atribuicao nao rouba (fora_da_fila).
        expect(r).toEqual({ atribuida: false, codigo: "fora_da_fila" });
        expect(s.conversa.assignee_user_id).toBe(pessoa("recepcao"));
        expect(a.data).toHaveLength(1);
        expect(s.eventosDaAtribuicao).toBe(0);
      }
      await admin.rpc("concluir_job", { p_id: job, p_worker: WORKER });
    }
  }, 120_000);
});

describe("R2: a urgencia contra quem pega a conversa, ao mesmo tempo", () => {
  it("contra o Assumir (que aceita a conversa na IA ou na fila): a marca nunca fica aberta com a conversa em atendimento", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const conversa = await naIa(null);
      const job = await jobEmExecucao(conversa);
      // O Assumir de quem viu a conversa na fila (o da IA ja e o R1): se a
      // passagem veio antes, ele pega a conversa marcada e o gatilho fecha a
      // marca; se veio depois, nao acha a linha.
      const [p, a] = await Promise.all([passar(job, "urgencia"), assumir(conversa, "aguardando_humano")]);
      semCicloNemSerializacao(p.error, a.error);
      expect(p.error).toBeNull();
      expect(a.error).toBeNull();
      const r = p.data as Passagem;
      expect(r).toEqual({ passou: true, codigo: "passou", urgente: true });
      const s = await situacao(conversa);
      if (s.conversa.status === "em_atendimento") {
        expect(s.marca).toMatchObject({ encerrada_como: "assumida" });
        expect(s.marca?.encerrada_em).toBeTruthy();
      } else {
        expect(s.conversa.status).toBe("aguardando_humano");
        expect(s.marca).toMatchObject({ encerrada_em: null });
      }
      await admin.rpc("concluir_job", { p_id: job, p_worker: WORKER });
    }
  }, 120_000);

  it("contra o Resolver: resolvida com a marca fechada, ou a marca aberta na fila", async () => {
    for (let i = 0; i < RODADAS; i += 1) {
      const conversa = await naIa(null);
      const job = await jobEmExecucao(conversa);
      const [p, v] = await Promise.all([passar(job, "urgencia"), resolver(conversa)]);
      semCicloNemSerializacao(p.error, v.error);
      expect(p.error).toBeNull();
      expect(v.error).toBeNull();
      const r = p.data as Passagem;
      const s = await situacao(conversa);
      if (r.passou) {
        // A passagem veio antes (marca aberta); o Resolver depois fecha.
        expect(r.urgente).toBe(true);
        expect(s.conversa.status).toBe("resolvida");
        expect(s.marca).toMatchObject({ encerrada_como: "resolvida" });
      } else {
        // O Resolver veio antes: a conversa saiu da IA e nada foi marcado.
        expect(r).toEqual({ passou: false, codigo: "ja_fora_da_ia", urgente: false });
        expect(s.conversa.status).toBe("resolvida");
        expect(s.marca).toBeNull();
      }
      await admin.rpc("concluir_job", { p_id: job, p_worker: WORKER });
    }
  }, 120_000);
});
