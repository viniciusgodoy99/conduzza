import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Fase 4, tarefa 4.6: RLS do motor de reguas (migration 20260826100000).
// Matriz: membro ativo LE cadence, cadence_step e cadence_run da propria
// clinica; so admin e gestor ESCREVEM a configuracao (mesmo recorte de
// Automacoes); cadence_run e registro do sistema, sem policy de escrita, entao
// nenhuma sessao insere ali. E a trava active_exige_janela, que e do banco e
// nao da tela, recusa ligar a regua sem janela de envio ate para o
// administrador.
//
// Padrao da suite: select barrado por RLS retorna VAZIO, nao erro; toda
// negacao tem verificacao anti falso-positivo via service role.
//
// Seguranca: o canal desta maquina e real (uazapi). As duas clinicas de teste
// nascem com whatsapp_account provider 'fake' e a unica regua que este arquivo
// chega a ligar volta desligada e sem janela antes do fim.

const RLS_VIOLATION = "42501";
const CHECK_VIOLATION = "23514";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Reguas!Rls2026";

type Chave = "admin" | "gestor" | "recepcao" | "leitura" | "gestorB";

const sessoes = {} as Record<Chave, SupabaseClient>;

let clinicaA = "";
let clinicaB = "";
let contatoA = "";
let cadenciaA = "";
let passoA = "";
let execucaoA = "";

function endereco(chave: Chave): string {
  return `reguas-${chave.toLowerCase()}-${sufixo}@teste.dev`;
}

async function criarUsuario(chave: Chave, clinicId: string, role: string) {
  const email = endereco(chave);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: chave },
  });
  if (error || !data?.user) {
    throw new Error(`criar ${email}: ${error?.message}`);
  }
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status: "ativo",
    })
    .throwOnError();
}

async function logado(chave: Chave): Promise<SupabaseClient> {
  const cliente = anonClient();
  const email = endereco(chave);
  const { error } = await cliente.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${email}: ${error.message}`);
  }
  return cliente;
}

/** Estado da regua de confirmacao da clinica A, lido por service role. */
async function reguaNoBanco() {
  const { data } = await admin
    .from("cadence")
    .select("name, active, send_window_start, send_window_end, send_weekdays")
    .eq("id", cadenciaA)
    .single()
    .throwOnError();
  return data as {
    name: string;
    active: boolean;
    send_window_start: string | null;
    send_window_end: string | null;
    send_weekdays: number[] | null;
  };
}

beforeAll(async () => {
  // O gatilho seed_reguas_da_clinica_nova roda aqui: as reguas padrao ja
  // nascem junto com a clinica, e e isso que o primeiro cenario confere.
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Réguas A ${sufixo}`, slug: `reguas-a-${sufixo}` },
      { name: `Réguas B ${sufixo}`, slug: `reguas-b-${sufixo}` },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug.startsWith("reguas-a"))!.id as string;
  clinicaB = clinicas!.find((c) => c.slug.startsWith("reguas-b"))!.id as string;

  // Canal falso nas duas: nenhum teste pode encostar no WhatsApp real.
  await admin
    .from("whatsapp_account")
    .insert([
      { clinic_id: clinicaA, provider: "fake", connection_status: "conectado" },
      { clinic_id: clinicaB, provider: "fake", connection_status: "conectado" },
    ])
    .throwOnError();

  await criarUsuario("admin", clinicaA, "admin");
  await criarUsuario("gestor", clinicaA, "gestor");
  await criarUsuario("recepcao", clinicaA, "recepcao");
  await criarUsuario("leitura", clinicaA, "leitura");
  await criarUsuario("gestorB", clinicaB, "gestor");

  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: "+5584962000001",
      name: "Paciente Régua RLS",
    })
    .select("id")
    .single()
    .throwOnError();
  contatoA = contato!.id as string;

  const { data: contatoDaB } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaB,
      phone_e164: "+5584962000002",
      name: "Paciente da Vizinha",
    })
    .select("id")
    .single()
    .throwOnError();

  const { data: regua } = await admin
    .from("cadence")
    .select("id, cadence_step ( id, offset_minutes )")
    .eq("clinic_id", clinicaA)
    .eq("kind", "confirmacao")
    .single()
    .throwOnError();
  cadenciaA = regua!.id as string;
  const passos = (regua as unknown as { cadence_step: { id: string }[] })
    .cadence_step;
  passoA = passos[0]!.id;

  // Execucao do sistema: quem grava cadence_run e o worker, por service role.
  const { data: execucao } = await admin
    .from("cadence_run")
    .insert({
      clinic_id: clinicaA,
      cadence_step_id: passoA,
      contact_id: contatoA,
      scheduled_for: new Date(Date.now() + 3600_000).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  execucaoA = execucao!.id as string;

  // A clinica B tambem tem execucao, senao o zero lido pelo gestor da B seria
  // ambiguo (nao dava para separar "RLS barrou" de "nao havia nada la").
  const { data: reguaB } = await admin
    .from("cadence")
    .select("id, cadence_step ( id )")
    .eq("clinic_id", clinicaB)
    .eq("kind", "confirmacao")
    .single()
    .throwOnError();
  const passoB = (reguaB as unknown as { cadence_step: { id: string }[] })
    .cadence_step[0]!.id;
  await admin
    .from("cadence_run")
    .insert({
      clinic_id: clinicaB,
      cadence_step_id: passoB,
      contact_id: contatoDaB!.id,
      scheduled_for: new Date(Date.now() + 3600_000).toISOString(),
    })
    .throwOnError();

  for (const chave of [
    "admin",
    "gestor",
    "recepcao",
    "leitura",
    "gestorB",
  ] as Chave[]) {
    sessoes[chave] = await logado(chave);
  }
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicaA);
  await admin.from("clinic").delete().eq("id", clinicaB);
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const usuario of data?.users ?? []) {
    if (
      (usuario.email ?? "").startsWith("reguas-") &&
      usuario.email?.includes(sufixo)
    ) {
      await admin.auth.admin.deleteUser(usuario.id);
    }
  }
});

describe("a clínica nova já nasce com as réguas padrão", () => {
  it("confirmação e pós falta existem, desligadas e sem janela de envio", async () => {
    const { data, error } = await sessoes.admin
      .from("cadence")
      .select(
        "kind, name, active, send_window_start, send_window_end, send_weekdays",
      )
      .eq("clinic_id", clinicaA)
      .order("kind", { ascending: true });
    expect(error).toBeNull();
    expect(data?.map((c) => c.kind)).toEqual(["confirmacao", "pos_falta"]);

    // Decisao do dono em 25/08/2026: sem modo de ensaio, a regua nasce
    // DESLIGADA e a clinica preenche a janela antes de conseguir ligar.
    for (const regua of data ?? []) {
      expect(regua.active).toBe(false);
      expect(regua.send_window_start).toBeNull();
      expect(regua.send_window_end).toBeNull();
      expect(regua.send_weekdays).toBeNull();
    }
  });

  it("os passos padrão vieram junto: três de confirmação e dois de pós falta", async () => {
    const { data } = await sessoes.admin
      .from("cadence_step")
      .select("cadence_id, offset_minutes")
      .eq("clinic_id", clinicaA);
    const daConfirmacao = (data ?? []).filter(
      (p) => p.cadence_id === cadenciaA,
    );
    expect(
      daConfirmacao.map((p) => p.offset_minutes).sort((a, b) => a - b),
    ).toEqual([-4320, -1440, -180]);
    expect(data).toHaveLength(5);
  });
});

describe("membro ativo lê a régua da própria clínica", () => {
  it("até o papel leitura enxerga régua, passos e execuções", async () => {
    const { data: reguas, error: erroReguas } = await sessoes.leitura
      .from("cadence")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(erroReguas).toBeNull();
    expect(reguas).toHaveLength(2);

    const { data: passos, error: erroPassos } = await sessoes.leitura
      .from("cadence_step")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(erroPassos).toBeNull();
    expect(passos).toHaveLength(5);

    const { data: execucoes, error: erroExecucoes } = await sessoes.leitura
      .from("cadence_run")
      .select("id, scheduled_for, sent_at")
      .eq("clinic_id", clinicaA);
    expect(erroExecucoes).toBeNull();
    expect(execucoes).toHaveLength(1);
    expect(execucoes?.[0]?.id).toBe(execucaoA);
  });
});

describe("a régua da clínica A não vaza para a clínica B", () => {
  it("o gestor da B lê zero linha nas três tabelas", async () => {
    for (const tabela of ["cadence", "cadence_step", "cadence_run"]) {
      const { data, error } = await sessoes.gestorB
        .from(tabela)
        .select("id")
        .eq("clinic_id", clinicaA);
      expect(error).toBeNull();
      expect(data, `${tabela} vazou para a clínica B`).toHaveLength(0);
    }
  });

  it("anti falso-positivo: as linhas da A existem para o service role", async () => {
    for (const [tabela, esperado] of [
      ["cadence", 2],
      ["cadence_step", 5],
      ["cadence_run", 1],
    ] as const) {
      const { count } = await admin
        .from(tabela)
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicaA);
      expect(count, tabela).toBe(esperado);
    }
  });

  it("o gestor da B também não escreve na régua da A", async () => {
    const antes = await reguaNoBanco();

    const { data: alteradas, error: erroUpdate } = await sessoes.gestorB
      .from("cadence")
      .update({ name: "Sequestrada" })
      .eq("id", cadenciaA)
      .select("id");
    if (erroUpdate) {
      expect(erroUpdate.code).toBe(RLS_VIOLATION);
    } else {
      expect(alteradas ?? []).toHaveLength(0);
    }

    const { error: erroInsert } = await sessoes.gestorB.from("cadence").insert({
      clinic_id: clinicaA,
      kind: "reativacao",
      name: "Invasão",
    });
    expect(erroInsert?.code).toBe(RLS_VIOLATION);

    expect((await reguaNoBanco()).name).toBe(antes.name);
  });
});

describe("quem edita a régua: administrador e gestor", () => {
  it("o administrador muda o nome da régua", async () => {
    const { data, error } = await sessoes.admin
      .from("cadence")
      .update({ name: "Confirmação, ajustada pela administradora" })
      .eq("id", cadenciaA)
      .select("id, name");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((await reguaNoBanco()).name).toBe(
      "Confirmação, ajustada pela administradora",
    );
  });

  it("o gestor também muda o nome da régua", async () => {
    const { data, error } = await sessoes.gestor
      .from("cadence")
      .update({ name: "Confirmação de consulta" })
      .eq("id", cadenciaA)
      .select("id, name");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((await reguaNoBanco()).name).toBe("Confirmação de consulta");
  });

  it("o gestor edita o texto do passo", async () => {
    const { data, error } = await sessoes.gestor
      .from("cadence_step")
      .update({ fixed_body: "Texto revisado pela gestora." })
      .eq("id", passoA)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("a recepção não configura régua", () => {
  it("não cria régua: 42501", async () => {
    const { error } = await sessoes.recepcao.from("cadence").insert({
      clinic_id: clinicaA,
      kind: "reativacao",
      name: "Régua da recepção",
    });
    expect(error?.code).toBe(RLS_VIOLATION);

    const { count } = await admin
      .from("cadence")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA);
    expect(count).toBe(2);
  });

  it("não edita a régua, e o nome no banco continua o mesmo", async () => {
    const antes = await reguaNoBanco();

    // A policy de escrita e FOR ALL: a linha que nao passa no USING nem entra
    // na atualizacao, entao a recusa aparece como zero linha, nao como 42501.
    // O que prova a trava e o par "nenhuma linha voltou" mais "o banco esta
    // igual".
    const { data: alteradas, error } = await sessoes.recepcao
      .from("cadence")
      .update({ name: "Nome trocado pela recepção", active: true })
      .eq("id", cadenciaA)
      .select("id");
    if (error) {
      expect(error.code).toBe(RLS_VIOLATION);
    } else {
      expect(alteradas ?? []).toHaveLength(0);
    }

    expect(await reguaNoBanco()).toMatchObject({
      name: antes.name,
      active: false,
    });
  });

  it("não cria nem edita passo de régua", async () => {
    const { data: antes } = await admin
      .from("cadence_step")
      .select("fixed_body")
      .eq("id", passoA)
      .single()
      .throwOnError();

    const { error: erroInsert } = await sessoes.recepcao
      .from("cadence_step")
      .insert({
        clinic_id: clinicaA,
        cadence_id: cadenciaA,
        offset_minutes: -99999,
        fixed_body: "Passo que não deveria entrar.",
      });
    expect(erroInsert?.code).toBe(RLS_VIOLATION);

    const { data: alteradas, error: erroUpdate } = await sessoes.recepcao
      .from("cadence_step")
      .update({ fixed_body: "Texto trocado pela recepção." })
      .eq("id", passoA)
      .select("id");
    if (erroUpdate) {
      expect(erroUpdate.code).toBe(RLS_VIOLATION);
    } else {
      expect(alteradas ?? []).toHaveLength(0);
    }

    const { data: depois } = await admin
      .from("cadence_step")
      .select("fixed_body")
      .eq("id", passoA)
      .single()
      .throwOnError();
    expect(depois).toEqual(antes);
    const { count } = await admin
      .from("cadence_step")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA);
    expect(count).toBe(5);
  });
});

describe("cadence_run é registro do sistema, não da sessão", () => {
  const daquiA2Horas = new Date(Date.now() + 2 * 3600_000).toISOString();

  it("nem o administrador insere execução pela sessão: 42501", async () => {
    const { error } = await sessoes.admin.from("cadence_run").insert({
      clinic_id: clinicaA,
      cadence_step_id: passoA,
      contact_id: contatoA,
      scheduled_for: daquiA2Horas,
    });
    expect(error?.code).toBe(RLS_VIOLATION);

    const { count } = await admin
      .from("cadence_run")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA);
    expect(count).toBe(1);
  });

  it("nem o gestor marca uma execução como enviada", async () => {
    const { data: alteradas, error } = await sessoes.gestor
      .from("cadence_run")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", execucaoA)
      .select("id");
    if (error) {
      expect(error.code).toBe(RLS_VIOLATION);
    } else {
      expect(alteradas ?? []).toHaveLength(0);
    }

    const { data: intacta } = await admin
      .from("cadence_run")
      .select("sent_at, skipped_reason")
      .eq("id", execucaoA)
      .single()
      .throwOnError();
    expect(intacta?.sent_at).toBeNull();
    expect(intacta?.skipped_reason).toBeNull();
  });

  it("nem o administrador apaga a trilha de execução", async () => {
    const { data: apagadas, error } = await sessoes.admin
      .from("cadence_run")
      .delete()
      .eq("id", execucaoA)
      .select("id");
    if (error) {
      expect(error.code).toBe(RLS_VIOLATION);
    } else {
      expect(apagadas ?? []).toHaveLength(0);
    }

    const { count } = await admin
      .from("cadence_run")
      .select("id", { count: "exact", head: true })
      .eq("id", execucaoA);
    expect(count).toBe(1);
  });

  it("anti falso-positivo: o service role insere a mesma linha sem esforço", async () => {
    const { data, error } = await admin
      .from("cadence_run")
      .insert({
        clinic_id: clinicaA,
        cadence_step_id: passoA,
        contact_id: contatoA,
        scheduled_for: daquiA2Horas,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();

    // Volta ao estado anterior: os cenarios seguintes contam execucoes.
    await admin.from("cadence_run").delete().eq("id", data!.id);
  });
});

describe("a régua não liga sem janela de envio", () => {
  // Rede de seguranca: aconteca o que acontecer nos cenarios abaixo, a regua
  // desta clinica termina desligada. O canal desta maquina e real e nenhuma
  // regua de teste pode ficar de pe.
  afterAll(async () => {
    await admin
      .from("cadence")
      .update({
        active: false,
        send_window_start: null,
        send_window_end: null,
        send_weekdays: null,
      })
      .eq("clinic_id", clinicaA);
  });

  it("com a janela nula, nem o administrador ativa: 23514", async () => {
    const { error } = await sessoes.admin
      .from("cadence")
      .update({ active: true })
      .eq("id", cadenciaA)
      .select("id");
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain("active_exige_janela");
    expect((await reguaNoBanco()).active).toBe(false);
  });

  it("dias de envio sem horário também não bastam", async () => {
    const { error } = await sessoes.admin
      .from("cadence")
      .update({ active: true, send_weekdays: [1, 2, 3, 4, 5] })
      .eq("id", cadenciaA)
      .select("id");
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect((await reguaNoBanco()).active).toBe(false);
  });

  it("a trava é do banco, então vale para o gestor do mesmo jeito", async () => {
    const { error } = await sessoes.gestor
      .from("cadence")
      .update({ active: true })
      .eq("id", cadenciaA)
      .select("id");
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect((await reguaNoBanco()).active).toBe(false);
  });

  it("nem o service role liga a régua sem janela", async () => {
    const { error } = await admin
      .from("cadence")
      .update({ active: true })
      .eq("id", cadenciaA)
      .select("id");
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect((await reguaNoBanco()).active).toBe(false);
  });

  it("com janela e dias preenchidos, o administrador ativa", async () => {
    const { data, error } = await sessoes.admin
      .from("cadence")
      .update({
        active: true,
        send_window_start: "08:00",
        send_window_end: "18:00",
        send_weekdays: [1, 2, 3, 4, 5],
      })
      .eq("id", cadenciaA)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const noBanco = await reguaNoBanco();
    expect(noBanco.active).toBe(true);
    expect(noBanco.send_window_start).toContain("08:00");
    expect(noBanco.send_window_end).toContain("18:00");
    expect(noBanco.send_weekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it("e o teste devolve a régua desligada, com a janela nula de novo", async () => {
    const { error } = await sessoes.admin
      .from("cadence")
      .update({
        active: false,
        send_window_start: null,
        send_window_end: null,
        send_weekdays: null,
      })
      .eq("id", cadenciaA)
      .select("id");
    expect(error).toBeNull();

    const noBanco = await reguaNoBanco();
    expect(noBanco.active).toBe(false);
    expect(noBanco.send_window_start).toBeNull();
    expect(noBanco.send_window_end).toBeNull();
    expect(noBanco.send_weekdays).toBeNull();
  });
});
