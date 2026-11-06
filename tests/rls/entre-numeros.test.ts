import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Teste do agente entre numeros conectados (migration 20261106100000), pela API
// com JWT real. ESCRITO E NAO RODADO por quem escreveu (grava no banco): quem
// roda e o coordenador, DEPOIS de aplicar a migration. O que esta em jogo:
//   - as decisoes novas nao sao da sessao (42501), para anon e authenticated;
//   - a coluna entre_numeros nao se escreve pela sessao, e o servidor so grava
//     pela funcao (gatilho: 42501 so_pela_marca_entre_numeros);
//   - A nao le a marca de B, e o administrador de A nao marca em B;
//   - sem a confirmacao, numero conectado segue recusado para todos; a clinica
//     real fora da fase segue recusada mesmo pelo servidor; o par reciproco e
//     recusado;
//   - a trilha fica em audit_log, sem telefone.
// CUIDADO, o banco e o da producao: clinicas e_de_teste, apagadas no afterAll.
// So numero fake; nada sai. O interruptor global nunca e tocado.

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const digitos = sufixo.replace(/\D/g, "").padEnd(6, "5").slice(0, 6);
const SENHA = "EntreNumeros!Rls2026";
const TEL_A = `+5584931${digitos}`;
const TEL_B = `+5584932${digitos}`;
const TEL_R = `+5584933${digitos}`;
const clinicas: string[] = [];
const pessoas: string[] = [];
let clinicaA = "";
let clinicaB = "";
let clinicaReal = "";
let adminA: SupabaseClient;
let recepcaoA: SupabaseClient;

async function novaClinica(nome: string, teste = true): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({ name: `Entre ${nome} ${sufixo}`, slug: `entre-rls-${nome}-${sufixo}`, e_de_teste: teste })
    .select("id")
    .single()
    .throwOnError();
  const id = (data as { id: string }).id;
  clinicas.push(id);
  return id;
}

async function novaPessoa(apelido: string, clinica: string, role: string): Promise<SupabaseClient> {
  const email = `entre-rls-${apelido}-${sufixo}@teste.dev`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Sintetica ${apelido}` },
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuario"}`);
  }
  pessoas.push(data.user.id);
  await admin
    .from("clinic_member")
    .insert({ clinic_id: clinica, user_id: data.user.id, role, status: "ativo" })
    .throwOnError();
  const cliente = anonClient();
  const { error: erroLogin } = await cliente.auth.signInWithPassword({ email, password: SENHA });
  if (erroLogin) {
    throw new Error(`login ${apelido}: ${erroLogin.message}`);
  }
  return cliente;
}

const marcar = (cliente: SupabaseClient, clinica: string, telefone: string, confirmou?: boolean) =>
  cliente.rpc("definir_contato_liberado_da_ia", {
    p_clinic_id: clinica,
    p_telefone_e164: telefone,
    p_rotulo: "Numero em teste",
    p_ativo: true,
    p_confirmou_aviso_da_openai: true,
    ...(confirmou === undefined ? {} : { p_confirmou_entre_numeros: confirmou }),
  });

beforeAll(async () => {
  clinicaA = await novaClinica("a");
  clinicaB = await novaClinica("b");
  clinicaReal = await novaClinica("r");
  await criarNumeroDeTeste(admin, clinicaA, { display_phone: TEL_A.slice(1) });
  await criarNumeroDeTeste(admin, clinicaB, { display_phone: TEL_B.slice(1) });
  await criarNumeroDeTeste(admin, clinicaReal, { display_phone: TEL_R.slice(1) });
  for (const c of [clinicaA, clinicaB]) {
    await admin
      .from("ia_liberacao")
      .insert({ clinic_id: c, liberada: false, modo: "contatos", motivo: "teste de RLS" })
      .throwOnError();
  }
  adminA = await novaPessoa("admin-a", clinicaA, "admin");
  recepcaoA = await novaPessoa("recepcao-a", clinicaA, "recepcao");
  await novaPessoa("admin-b", clinicaB, "admin");
});

afterAll(async () => {
  await admin.from("clinic").update({ e_de_teste: true }).in("id", clinicas);
  await admin.from("clinic").delete().in("id", clinicas);
  for (const id of pessoas) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("as decisoes novas nao sao da sessao", () => {
  it.each([
    ["ia_entre_numeros_vale", { p_clinic_id: "00000000-0000-4000-8000-000000000000", p_whatsapp_account_id: "00000000-0000-4000-8000-000000000000", p_telefone: "+5584930000000" }],
    ["ia_entre_numeros_marcado", { p_clinic_id: "00000000-0000-4000-8000-000000000000", p_telefone: "+5584930000000" }],
    ["ia_entre_numeros_fecha_par", { p_clinic_id: "00000000-0000-4000-8000-000000000000", p_chave: "+5584930000000" }],
    ["ia_resposta_entre_numeros", { p_whatsapp_account_id: "00000000-0000-4000-8000-000000000000", p_telefone: "+5584930000000" }],
    ["chave_do_numero_conectado", { p_display_phone: "5584930000000" }],
  ])("%s: 42501 para anon e authenticated; o servidor chama", async (nome, args) => {
    for (const cliente of [anonClient(), adminA]) {
      const { error } = await cliente.rpc(nome, args);
      expect(error?.code).toBe("42501");
    }
    const { error } = await admin.rpc(nome, args);
    expect(error).toBeNull();
  });
});

describe("a marca", () => {
  it("sem a confirmacao, numero conectado recusado; o administrador com ela marca; a trilha sem telefone", async () => {
    const semConfirmar = await marcar(adminA, clinicaA, TEL_B);
    expect(semConfirmar.error?.message).toBe("telefone_invalido_para_equipe");
    const { error } = await marcar(adminA, clinicaA, TEL_B, true);
    expect(error).toBeNull();
    const { data: lida } = await adminA
      .from("ia_contato_liberado")
      .select("entre_numeros")
      .eq("clinic_id", clinicaA)
      .single()
      .throwOnError();
    expect((lida as { entre_numeros: boolean }).entre_numeros).toBe(true);
    const { data: trilha } = await admin
      .from("audit_log")
      .select("action, detalhes, entity")
      .eq("clinic_id", clinicaA)
      .eq("action", "marcou_numero_conectado_em_teste")
      .throwOnError();
    expect(trilha).toHaveLength(1);
    expect(JSON.stringify(trilha)).not.toContain(digitos);
  });

  it("A nao le a marca de B, e B nao le a de A", async () => {
    const { data } = await adminA.from("ia_contato_liberado").select("id").eq("clinic_id", clinicaB);
    expect(data ?? []).toEqual([]);
    const { error } = await marcar(adminA, clinicaB, TEL_A, true);
    expect(error?.code).toBe("42501");
  });

  it("a sessao nao escreve a coluna; quem nao e administrador nao marca", async () => {
    const { error } = await adminA
      .from("ia_contato_liberado")
      .update({ entre_numeros: false })
      .eq("clinic_id", clinicaA);
    expect(error?.code).toBe("42501");
    const recepcao = await marcar(recepcaoA, clinicaA, TEL_R, true);
    expect(recepcao.error?.code).toBe("42501");
  });

  it("o servidor nao grava a marca sem a funcao", async () => {
    const { error } = await admin
      .from("ia_contato_liberado")
      .insert({ clinic_id: clinicaB, phone_key: TEL_R, ativo: true, entre_numeros: true });
    expect(error?.code).toBe("42501");
    expect(error?.message).toBe("so_pela_marca_entre_numeros");
  });

  it("o par reciproco e recusado", async () => {
    const { error } = await marcar(admin, clinicaB, TEL_A, true);
    expect(error?.code).toBe("23514");
    expect(error?.message).toBe("entre_numeros_reciproco");
  });

  it("clinica real fora da fase, mesmo pelo servidor: recusada", async () => {
    await admin.from("clinic").update({ e_de_teste: false }).eq("id", clinicaReal).throwOnError();
    try {
      const { error } = await marcar(admin, clinicaReal, TEL_A, true);
      expect(error?.code).toBe("23514");
      expect(error?.message).toBe("entre_numeros_fora_da_fase");
    } finally {
      await admin.from("clinic").update({ e_de_teste: true }).eq("id", clinicaReal).throwOnError();
    }
  });
});
