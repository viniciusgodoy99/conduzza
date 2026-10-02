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

// Excecoes da 4.8: regua propria por procedimento e reforcada. A policy de
// escrita e a mesma ("gestao escreve reguas"); o que se prova aqui e o insert
// de gestor, o isolamento entre clinicas no insert e o indice unico que
// impede duas reguas para o mesmo recorte.
describe("exceções da régua de confirmação (4.8)", () => {
  it("gestor cria régua por procedimento, duplicada conflita e ele exclui", async () => {
    const { data: procedimento } = await admin
      .from("procedure")
      .insert({
        clinic_id: clinicaA,
        name: `Colono ${sufixo}`,
        default_duration_min: 40,
      })
      .select("id")
      .single()
      .throwOnError();
    const procedureId = procedimento!.id as string;

    const { data: criada, error } = await sessoes.gestor
      .from("cadence")
      .insert({
        clinic_id: clinicaA,
        kind: "confirmacao",
        name: `Confirmação: Colono ${sufixo}`,
        procedure_id: procedureId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    const { error: duplicada } = await sessoes.gestor
      .from("cadence")
      .insert({
        clinic_id: clinicaA,
        kind: "confirmacao",
        name: "Duplicada",
        procedure_id: procedureId,
      });
    expect(duplicada?.code).toBe("23505");

    const { error: excluida } = await sessoes.gestor
      .from("cadence")
      .delete()
      .eq("id", criada!.id as string);
    expect(excluida).toBeNull();
    const { data: prova } = await admin
      .from("cadence")
      .select("id")
      .eq("id", criada!.id as string);
    expect(prova).toHaveLength(0);
    await admin.from("procedure").delete().eq("id", procedureId);
  });

  it("gestor da clínica B não cria exceção na A", async () => {
    const { error } = await sessoes.gestorB.from("cadence").insert({
      clinic_id: clinicaA,
      kind: "confirmacao",
      name: "Invasão",
      for_no_show_history: true,
    });
    expect(error?.code).toBe(RLS_VIOLATION);
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

// Regua vinculada a medico, especialidade ou procedimento (decisao do dono de
// 29/09/2026, migration 20260929110000). As colunas novas (professional_id,
// specialty) vivem na MESMA linha de cadence: a policy "gestao escreve
// reguas" continua decidindo quem escreve. O que se prova aqui e o que o
// banco acrescentou: o vinculo e da mesma clinica (gatilho
// exigir_cadastro_da_mesma_clinica, que fecha tambem o procedure_id de outra
// clinica), um vinculo so por regua, especialidade unica pela chave (grafias
// diferentes conflitam), follow-up sem vinculo, e regua_da_consulta respeita
// a RLS de quem chama (SECURITY INVOKER).
describe("régua vinculada: médico, especialidade ou procedimento", () => {
  const FK_VIOLATION = "23503";
  const UNIQUE_VIOLATION = "23505";

  let profissionalA = "";
  let profissionalB = "";
  let procedimentoB = "";
  let consultaA = "";
  const criadas: string[] = [];

  beforeAll(async () => {
    const { data: profA } = await admin
      .from("professional")
      .insert({
        clinic_id: clinicaA,
        name: `Dra. Vinculada ${sufixo}`,
        specialties: ["Dermatologia"],
      })
      .select("id")
      .single()
      .throwOnError();
    profissionalA = profA!.id as string;

    const { data: profB } = await admin
      .from("professional")
      .insert({ clinic_id: clinicaB, name: `Dr. da Vizinha ${sufixo}` })
      .select("id")
      .single()
      .throwOnError();
    profissionalB = profB!.id as string;

    const { data: procB } = await admin
      .from("procedure")
      .insert({
        clinic_id: clinicaB,
        name: `Procedimento da Vizinha ${sufixo}`,
        default_duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    procedimentoB = procB!.id as string;

    // Uma consulta da A com a Dra. Vinculada, daqui a 10 dias (longe do
    // horizonte do planner; as reguas daqui nao tem passo).
    const { data: procA } = await admin
      .from("procedure")
      .insert({
        clinic_id: clinicaA,
        name: `Consulta vinculada ${sufixo}`,
        default_duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: vinculo } = await admin
      .from("service_link")
      .insert({
        clinic_id: clinicaA,
        professional_id: profissionalA,
        procedure_id: procA!.id,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const inicio = new Date(Date.now() + 10 * 86_400_000);
    const { data: consulta } = await admin
      .from("appointment")
      .insert({
        clinic_id: clinicaA,
        contact_id: contatoA,
        professional_id: profissionalA,
        service_link_id: vinculo!.id,
        starts_at: inicio.toISOString(),
        ends_at: new Date(inicio.getTime() + 30 * 60_000).toISOString(),
      })
      .select("id")
      .single()
      .throwOnError();
    consultaA = consulta!.id as string;
  });

  afterAll(async () => {
    if (criadas.length > 0) {
      await admin.from("cadence").delete().in("id", criadas);
    }
  });

  async function reguasDaA(): Promise<number> {
    const { count } = await admin
      .from("cadence")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA);
    return count ?? 0;
  }

  it("gestor cria confirmação vinculada ao médico e pós falta vinculado; administrador, a da especialidade", async () => {
    const { data: doMedico, error: erroMedico } = await sessoes.gestor
      .from("cadence")
      .insert({
        clinic_id: clinicaA,
        kind: "confirmacao",
        name: "Confirmação: Dra. Vinculada",
        professional_id: profissionalA,
      })
      .select("id, professional_id, specialty, procedure_id")
      .single();
    expect(erroMedico).toBeNull();
    expect(doMedico).toMatchObject({
      professional_id: profissionalA,
      specialty: null,
      procedure_id: null,
    });
    criadas.push(doMedico!.id as string);

    const { data: posFalta, error: erroPosFalta } = await sessoes.gestor
      .from("cadence")
      .insert({
        clinic_id: clinicaA,
        kind: "pos_falta",
        name: "Recuperação: Dra. Vinculada",
        professional_id: profissionalA,
      })
      .select("id")
      .single();
    expect(erroPosFalta).toBeNull();
    criadas.push(posFalta!.id as string);

    const { data: daEspecialidade, error: erroEspecialidade } =
      await sessoes.admin
        .from("cadence")
        .insert({
          clinic_id: clinicaA,
          kind: "confirmacao",
          name: "Confirmação: Dermatologia",
          specialty: "Dermatologia",
        })
        .select("id, specialty")
        .single();
    expect(erroEspecialidade).toBeNull();
    // O rotulo fica como o usuario escolheu; a chave so compara.
    expect(daEspecialidade?.specialty).toBe("Dermatologia");
    criadas.push(daEspecialidade!.id as string);
  });

  it("a mesma especialidade com outra grafia conflita: 23505", async () => {
    const antes = await reguasDaA();
    const { error } = await sessoes.gestor.from("cadence").insert({
      clinic_id: clinicaA,
      kind: "confirmacao",
      name: "Duplicada",
      specialty: "  dermatologia ",
    });
    expect(error?.code).toBe(UNIQUE_VIOLATION);
    expect(await reguasDaA()).toBe(antes);
  });

  it("médico da clínica B não entra na régua da A: 23503", async () => {
    const antes = await reguasDaA();
    const { error } = await sessoes.gestor.from("cadence").insert({
      clinic_id: clinicaA,
      kind: "confirmacao",
      name: "Médico da vizinha",
      professional_id: profissionalB,
    });
    expect(error?.code).toBe(FK_VIOLATION);
    expect(await reguasDaA()).toBe(antes);
  });

  it("procedimento da clínica B também não (a falha antiga fechada): 23503", async () => {
    const antes = await reguasDaA();
    const { error } = await sessoes.admin.from("cadence").insert({
      clinic_id: clinicaA,
      kind: "confirmacao",
      name: "Procedimento da vizinha",
      procedure_id: procedimentoB,
    });
    expect(error?.code).toBe(FK_VIOLATION);
    expect(await reguasDaA()).toBe(antes);
  });

  it("nem trocando o médico de uma régua que já existe: 23503, e o vínculo fica", async () => {
    const reguaDoMedico = criadas[0]!;
    const { error } = await sessoes.gestor
      .from("cadence")
      .update({ professional_id: profissionalB })
      .eq("id", reguaDoMedico)
      .select("id");
    expect(error?.code).toBe(FK_VIOLATION);
    const { data } = await admin
      .from("cadence")
      .select("professional_id")
      .eq("id", reguaDoMedico)
      .single()
      .throwOnError();
    expect(data?.professional_id).toBe(profissionalA);
  });

  it("um vínculo só por régua: médico e especialidade juntos, 23514", async () => {
    const antes = await reguasDaA();
    const { error } = await sessoes.gestor.from("cadence").insert({
      clinic_id: clinicaA,
      kind: "confirmacao",
      name: "Dois vínculos",
      professional_id: profissionalA,
      specialty: "Cardiologia",
    });
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain("cadence_um_vinculo");
    expect(await reguasDaA()).toBe(antes);
  });

  it("follow-up não ganha vínculo: 23514", async () => {
    const { error } = await sessoes.gestor.from("cadence").insert({
      clinic_id: clinicaA,
      kind: "followup",
      name: "Follow-up vinculado",
      trigger_stage: "em_contato",
      professional_id: profissionalA,
    });
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("recepção e leitura não criam régua vinculada: 42501", async () => {
    const antes = await reguasDaA();
    for (const chave of ["recepcao", "leitura"] as const) {
      const { error } = await sessoes[chave].from("cadence").insert({
        clinic_id: clinicaA,
        kind: "confirmacao",
        name: `Vinculada pela ${chave}`,
        specialty: "Cardiologia",
      });
      expect(error?.code, chave).toBe(RLS_VIOLATION);
    }
    expect(await reguasDaA()).toBe(antes);
  });

  it("recepção não troca o vínculo de uma régua (zero linha, banco igual)", async () => {
    const reguaDaEspecialidade = criadas[2]!;
    const { data: alteradas, error } = await sessoes.recepcao
      .from("cadence")
      .update({ specialty: "Cardiologia" })
      .eq("id", reguaDaEspecialidade)
      .select("id");
    if (error) {
      expect(error.code).toBe(RLS_VIOLATION);
    } else {
      expect(alteradas ?? []).toHaveLength(0);
    }
    const { data } = await admin
      .from("cadence")
      .select("specialty")
      .eq("id", reguaDaEspecialidade)
      .single()
      .throwOnError();
    expect(data?.specialty).toBe("Dermatologia");
  });

  it("o gestor da B não lê as réguas vinculadas da A nem cria uma lá", async () => {
    const { data, error } = await sessoes.gestorB
      .from("cadence")
      .select("id, professional_id, specialty")
      .in("id", criadas);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { error: erroInsert } = await sessoes.gestorB.from("cadence").insert({
      clinic_id: clinicaA,
      kind: "confirmacao",
      name: "Invasão vinculada",
      professional_id: profissionalA,
    });
    expect(erroInsert?.code).toBe(RLS_VIOLATION);

    // Anti falso-positivo: as tres existem para o service role.
    const { count } = await admin
      .from("cadence")
      .select("id", { count: "exact", head: true })
      .in("id", criadas);
    expect(count).toBe(3);
  });

  it("regua_da_consulta respeita a RLS de quem chama", async () => {
    const reguaDoMedico = criadas[0]!;
    // Ligada (com janela) so para este caso; o afterAll apaga.
    await admin
      .from("cadence")
      .update({
        active: true,
        send_window_start: "08:00",
        send_window_end: "18:00",
        send_weekdays: [1, 2, 3, 4, 5],
      })
      .eq("id", reguaDoMedico)
      .throwOnError();
    const argumentos = {
      p_appointment_id: consultaA,
      p_kind: "confirmacao",
    };

    // Anti falso-positivo: o service role enxerga a regua vigente.
    const { data: peloServico } = await admin.rpc(
      "regua_da_consulta",
      argumentos,
    );
    expect(peloServico).toBe(reguaDoMedico);

    const { data: pelaGestora, error: erroGestora } = await sessoes.gestor.rpc(
      "regua_da_consulta",
      argumentos,
    );
    expect(erroGestora).toBeNull();
    expect(pelaGestora).toBe(reguaDoMedico);

    // A sessao da B nao enxerga a consulta da A: nulo, sem erro e sem
    // oraculo.
    const { data: pelaVizinha, error: erroVizinha } = await sessoes.gestorB.rpc(
      "regua_da_consulta",
      argumentos,
    );
    expect(erroVizinha).toBeNull();
    expect(pelaVizinha).toBeNull();

    // Sem login, nem executa.
    const { error: erroAnonimo } = await anonClient().rpc(
      "regua_da_consulta",
      argumentos,
    );
    expect(erroAnonimo?.code).toBe(RLS_VIOLATION);

    await admin
      .from("cadence")
      .update({ active: false })
      .eq("id", reguaDoMedico)
      .throwOnError();
  });
});
