import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Teste do agente entre numeros conectados (migration 20261106100000): a ingestao
// e as decisoes, no banco. ESCRITO E NAO RODADO por quem escreveu (grava no
// banco): quem roda e o coordenador, DEPOIS de aplicar a migration. A prova ja
// rodada e o ensaio no Postgres local (ensaio-20261106100000.sql).
// CUIDADO, o banco e o da producao: clinicas e_de_teste, numero fake, apagadas no
// afterAll. Nenhuma mensagem sai e nenhum executor roda aqui. A manutencao de
// producao varre conversa de teste com janela: cada bloco ingere logo antes.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const TEL_M1 = `+5584941${digitos}`;
const TEL_M2 = `+5584942${digitos}`;
const TEL_X = `+5584943${digitos}`;
const TEL_Y = `+5584944${digitos}`;
const clinicas: string[] = [];
let clinicaM = "";
let clinicaX = "";
let clinicaY = "";
let m1 = "";
let m2 = "";
let numX = "";
let numY = "";

async function rpc(nome: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await admin.rpc(nome, args);
  if (error) {
    throw new Error(`${nome}: ${error.code} ${error.message}`);
  }
  return data;
}

type Ingestao = {
  inserted: boolean;
  ignorada?: string;
  ia_atendendo: boolean;
  conversation_id: string | null;
  contact_id: string | null;
  message_id: string | null;
};

const ingerir = (clinica: string, numero: string, telefone: string, id: string) =>
  rpc("ingest_inbound_message", {
    p_clinic_id: clinica,
    p_phone_e164: telefone,
    p_name: null,
    p_wa_message_id: id,
    p_body: "mensagem de teste",
    p_whatsapp_account_id: numero,
  }) as Promise<Ingestao>;

async function novaClinica(nome: string, ligada: boolean): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({ name: `Entre int ${nome} ${sufixo}`, slug: `entre-int-${nome}-${sufixo}`, e_de_teste: true })
    .select("id")
    .single()
    .throwOnError();
  const id = (data as { id: string }).id;
  clinicas.push(id);
  await rpc("definir_liberacao_da_ia", {
    p_clinic_id: id,
    p_liberada: ligada,
    p_modo: "contatos",
    p_motivo: "teste de integracao",
  });
  await admin
    .from("ai_agent_config")
    .insert({ clinic_id: id, version: 1, status: "publicada", publico_atendido: "todos" })
    .throwOnError();
  return id;
}

const marcar = (clinica: string, telefone: string) =>
  rpc("definir_contato_liberado_da_ia", {
    p_clinic_id: clinica,
    p_telefone_e164: telefone,
    p_rotulo: "Numero em teste",
    p_ativo: true,
    p_confirmou_aviso_da_openai: true,
    p_confirmou_entre_numeros: true,
  });

beforeAll(async () => {
  clinicaM = await novaClinica("m", true);
  clinicaX = await novaClinica("x", false);
  clinicaY = await novaClinica("y", true);
  m1 = (await criarNumeroDeTeste(admin, clinicaM, { nome: "Um", display_phone: TEL_M1.slice(1) })).id;
  m2 = (await criarNumeroDeTeste(admin, clinicaM, { nome: "Dois", display_phone: TEL_M2.slice(1) })).id;
  numX = (await criarNumeroDeTeste(admin, clinicaX, { display_phone: TEL_X.slice(1) })).id;
  numY = (await criarNumeroDeTeste(admin, clinicaY, { display_phone: TEL_Y.slice(1) })).id;
  await rpc("definir_numero_da_ia", { p_clinic_id: clinicaM, p_whatsapp_account_id: m2, p_ativo: true });
  await rpc("definir_numero_da_ia", { p_clinic_id: clinicaY, p_whatsapp_account_id: numY, p_ativo: true });
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", clinicas);
});

describe("na mesma clinica", () => {
  it("sem a marca: numero_proprio", async () => {
    const r = await ingerir(clinicaM, m2, TEL_M1, `int-m-a-${sufixo}`);
    expect(r.ignorada).toBe("numero_proprio");
  });

  it("com a marca: nasce na IA, com id proprio; reentrega nao repete; a resposta no outro numero e numero_proprio", async () => {
    await marcar(clinicaM, TEL_M1);
    const id = `int-m-b-${sufixo}`;
    const r = await ingerir(clinicaM, m2, TEL_M1, id);
    expect(r).toMatchObject({ inserted: true, ia_atendendo: true });
    const { data: linha } = await admin
      .from("message")
      .select("wa_message_id")
      .eq("id", r.message_id!)
      .single()
      .throwOnError();
    expect((linha as { wa_message_id: string }).wa_message_id).toBe(`entre:${m2}:${id}`);
    expect((await ingerir(clinicaM, m2, TEL_M1, id)).inserted).toBe(false);
    const resposta = await ingerir(clinicaM, m1, TEL_M2, `int-m-c-${sufixo}`);
    expect(resposta.ignorada).toBe("numero_proprio");
    expect(await rpc("consentimento_vigente", { p_clinic_id: clinicaM, p_contact_id: r.contact_id })).toBe(true);
    expect(
      await rpc("enfileirar_resposta_da_ia", {
        p_clinic_id: clinicaM,
        p_conversation_id: r.conversation_id,
        p_message_id: r.message_id,
        p_incluir_teste: true,
      }),
    ).toMatchObject({ codigo: "enfileirado" });
  });

  it("o outro numero da mesma clinica nao fecha o par", async () => {
    await expect(marcar(clinicaM, TEL_M2)).rejects.toThrow("entre_numeros_reciproco");
  });
});

describe("entre clinicas", () => {
  it("a pergunta entra, a resposta fica com quem atende, e o id bruto nunca colide", async () => {
    await marcar(clinicaY, TEL_X);
    expect(
      await rpc("ia_pode_falar_com", { p_clinic_id: clinicaY, p_whatsapp_account_id: numY, p_telefone: TEL_X }),
    ).toBe(true);
    const pergunta = await ingerir(clinicaY, numY, TEL_X, `int-x-a-${sufixo}`);
    expect(pergunta).toMatchObject({ inserted: true, ia_atendendo: true });
    const idDaResposta = `int-y-a-${sufixo}`;
    const antes = await ingerir(clinicaX, numX, TEL_Y, idDaResposta);
    expect(antes.ignorada).toBe("resposta_entre_numeros");
    await admin
      .from("message")
      .insert({
        clinic_id: clinicaY,
        conversation_id: pergunta.conversation_id,
        wa_message_id: idDaResposta,
        direction: "saida",
        author: "usuario",
        content_type: "texto",
        body: "resposta de teste",
        billable: false,
        cost_cents: 0,
      })
      .throwOnError();
    const depois = await ingerir(clinicaX, numX, TEL_Y, idDaResposta);
    expect(depois.ignorada).toBe("resposta_entre_numeros");
    const { count } = await admin
      .from("contact")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaX)
      .throwOnError();
    expect(count).toBe(0);
  });

  it("o outro lado nao fecha o par, e o par de pe continua valendo", async () => {
    await expect(marcar(clinicaX, TEL_Y)).rejects.toThrow("entre_numeros_reciproco");
    expect(
      await rpc("ia_entre_numeros_vale", { p_clinic_id: clinicaY, p_whatsapp_account_id: numY, p_telefone: TEL_X }),
    ).toBe(true);
  });
});
