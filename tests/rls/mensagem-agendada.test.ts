import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  diaCivil,
  instanteLocal,
  somarDias,
  somarMeses,
} from "@/lib/domain/horarios";
import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Mensagem agendada (migration 20261006140000), pela API com JWT real de cada
// papel. O que esta em jogo:
//   - Dado de paciente: membro ATIVO le (o profissional so a da conversa
//     dele), pendente nao, a clinica B nunca ve nem mexe na da A.
//   - Agendar: quem pode responder (user_can_write), na conversa em
//     atendimento com ele, pelo numero ativo, com autorizacao vigente, no
//     futuro, ate 1 ano no dia civil da clinica, ate 10 ativas por contato.
//     Autoria e estado sao sempre do banco (o cliente nao forja).
//   - Mexer (A1, decisao do dono de 06/10/2026): quem escreve e ve a agendada
//     edita texto e hora enquanto 'agendada' e passa a ASSINAR (editada_por);
//     quem escreve exclui (agendada ou na fila) e dispensa a que nao saiu. A
//     sessao nao toca job, motivo, autoria, atividade nem carimbos.
//   - Sem DELETE; anon sem privilegio; as funcoes do sistema (planejadora,
//     reconciliacao, encerrar) nao sao de nenhum papel; o Enviar agora nao e
//     oraculo de existencia.
//   - A revogacao pela sessao encerra a agendada e cria UMA atividade do
//     sistema para quem assina (A3), passando pelo validar_atividade,
//     inclusive a que esta na fila com o job pendente (o job e cancelado).
//   - Excluir a que esta na fila cancela o job pendente quando nada pode
//     ter saido (sem message, ou message 'falhou' com codigo de
//     falhas_sem_envio()); o teto de 10 segura duas insercoes simultaneas.
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// O caso do 29/02 no teto de 1 ano: o gatilho usa date + interval '1 year',
// que prende 29/02 em 28/02 do ano seguinte, a mesma regra de somarMeses
// (coberta no teste de unidade de lib/domain/horarios). Aqui o teto e
// conferido nas duas bordas do dia limite calculado por somarMeses.

const RLS_VIOLATION = "42501";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const CORRIDA = "CZ409";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Agendada!Rls2026";
const TZ = "America/Fortaleza";
const HORA = 60 * 60_000;

let clinicaA = "";
let clinicaB = "";
let numeroA = "";
let numeroRemovido = "";
let numeroB = "";
// Contatos e conversas da A (todas em atendimento com recepcao-a, salvo dito)
let contato1 = "";
let conversa1 = "";
let contatoSemAutorizacao = "";
let conversaSemAutorizacao = "";
let contatoDoTeto = "";
let conversaDoTeto = "";
let contatoNoRemovido = "";
let conversaNoRemovido = "";
let contatoDoProfissional = "";
let conversaDoProfissional = "";
let contatoB = "";
let conversaB = "";
const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();

const email = (apelido: string) => `agendada-${apelido}-${sufixo}@teste.dev`;
const id = (apelido: string) => ids.get(apelido)!;
const como = (apelido: string) => clientes.get(apelido)!;

let sequenciaDeTelefone = 0;
function telefone(): string {
  sequenciaDeTelefone += 1;
  const base = sufixo.replace(/\D/g, "1").slice(0, 3).padEnd(3, "1");
  return `+5584976${base}${String(sequenciaDeTelefone).padStart(3, "0")}`;
}

async function criarPessoa(
  apelido: string,
  clinicId: string,
  role: string,
  status: "ativo" | "pendente" = "ativo",
  professionalId?: string,
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
      ...(professionalId ? { professional_id: professionalId } : {}),
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

async function novoContato(
  clinicId: string,
  autorizado: boolean,
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: telefone(), kind: "lead" })
    .select("id")
    .single()
    .throwOnError();
  const contactId = data!.id as string;
  if (autorizado) {
    await admin
      .from("contact_consent")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        channel: "whatsapp",
        source: "recepcao",
      })
      .throwOnError();
  }
  return contactId;
}

async function conversaComigo(
  clinicId: string,
  contactId: string,
  numeroId: string,
  responsavel: string,
): Promise<string> {
  const { data } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      whatsapp_account_id: numeroId,
      status: "em_atendimento",
      assignee_user_id: responsavel,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

type Par = { contato: string; conversa: string };

/**
 * Contato autorizado com a conversa em atendimento com o apelido, no numero
 * ativo da A. Cada teste que deixa agendada viva usa o seu par: o teto de 10
 * por contato nao pode vazar de um teste para outro.
 */
async function parNovo(responsavel = "recepcao-a"): Promise<Par> {
  const contato = await novoContato(clinicaA, true);
  const conversa = await conversaComigo(
    clinicaA,
    contato,
    numeroA,
    id(responsavel),
  );
  return { contato, conversa };
}

type Agendar = {
  conversa?: string;
  contato?: string;
  numero?: string;
  clinica?: string;
  texto?: string;
  enviarEm?: Date;
  id?: string;
  extras?: Record<string, unknown>;
};

/** INSERT pela sessao do apelido (sem lancar: o teste confere o erro). */
async function agendarComo(apelido: string, campos: Agendar = {}) {
  return como(apelido)
    .from("mensagem_agendada")
    .insert({
      ...(campos.id ? { id: campos.id } : {}),
      clinic_id: campos.clinica ?? clinicaA,
      contact_id: campos.contato ?? contato1,
      whatsapp_account_id: campos.numero ?? numeroA,
      conversation_id: campos.conversa ?? conversa1,
      texto: campos.texto ?? `Lembrete ${crypto.randomUUID().slice(0, 6)}`,
      enviar_em: (
        campos.enviarEm ?? new Date(Date.now() + 2 * HORA)
      ).toISOString(),
      criada_por: id(apelido),
      ...(campos.extras ?? {}),
    })
    .select(
      "id, criada_por, situacao, motivo, job_id, editada_por, cancelada_por, dispensada_por, atividade_id",
    )
    .single();
}

/** Agenda e devolve o id (falha alto se recusar). */
async function agendada(
  apelido: string,
  campos: Agendar = {},
): Promise<string> {
  const { data, error } = await agendarComo(apelido, campos);
  if (error || !data) {
    throw new Error(
      `agendar como ${apelido}: ${error?.code} ${error?.message}`,
    );
  }
  return data.id as string;
}

type LinhaNoBanco = {
  situacao: string;
  motivo: string | null;
  texto: string | null;
  criada_por: string;
  editada_por: string | null;
  editada_em: string | null;
  cancelada_por: string | null;
  cancelada_em: string | null;
  dispensada_por: string | null;
  dispensada_em: string | null;
  encerrada_em: string | null;
  job_id: string | null;
  atividade_id: string | null;
};

/** A linha como o banco guardou (service role, sem RLS). */
async function noBanco(agendadaId: string): Promise<LinhaNoBanco> {
  const { data } = await admin
    .from("mensagem_agendada")
    .select(
      "situacao, motivo, texto, criada_por, editada_por, editada_em, cancelada_por, cancelada_em, dispensada_por, dispensada_em, encerrada_em, job_id, atividade_id",
    )
    .eq("id", agendadaId)
    .single()
    .throwOnError();
  return data as LinhaNoBanco;
}

/** Muda o estado como o sistema muda (service role: o gatilho deixa). */
async function comoSistema(
  agendadaId: string,
  campos: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("mensagem_agendada")
    .update(campos)
    .eq("id", agendadaId)
    .throwOnError();
}

/**
 * Poe a agendada na fila como a planejadora poria: job pendente do kind da
 * agendada (clinica de teste: o motor nao o pega) e situacao 'enviando'.
 */
async function naFilaComJob(
  agendadaId: string,
  numeroId = numeroA,
): Promise<string> {
  const { data } = await admin
    .from("job_queue")
    .insert({
      clinic_id: clinicaA,
      kind: "enviar_mensagem_agendada",
      payload: { mensagem_agendada_id: agendadaId },
      whatsapp_account_id: numeroId,
      run_at: new Date(Date.now() + HORA).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  const jobId = data!.id as string;
  await comoSistema(agendadaId, { situacao: "enviando", job_id: jobId });
  return jobId;
}

/** A message que o send.ts gravou para o job, com o desfecho dado. */
async function mensagemDoJob(
  par: Par,
  jobId: string,
  codigo: string | null,
): Promise<void> {
  await admin
    .from("message")
    .insert({
      clinic_id: clinicaA,
      conversation_id: par.conversa,
      direction: "saida",
      author: "usuario",
      author_user_id: id("recepcao-a"),
      content_type: "texto",
      body: "Mensagem do job",
      job_id: jobId,
      delivery_status: "falhou",
      error_code: codigo,
      billable: false,
      cost_cents: 0,
    })
    .throwOnError();
}

type LinhaDoJob = { status: string; last_error: string | null };

async function jobNoBanco(jobId: string): Promise<LinhaDoJob> {
  const { data } = await admin
    .from("job_queue")
    .select("status, last_error")
    .eq("id", jobId)
    .single()
    .throwOnError();
  return data as LinhaDoJob;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Agendada A ${sufixo}`,
        slug: `agendada-rls-a-${sufixo}`,
        e_de_teste: true,
        timezone: TZ,
      },
      {
        name: `Agendada B ${sufixo}`,
        slug: `agendada-rls-b-${sufixo}`,
        e_de_teste: true,
        timezone: TZ,
      },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `agendada-rls-a-${sufixo}`)!
    .id as string;
  clinicaB = clinicas!.find((c) => c.slug === `agendada-rls-b-${sufixo}`)!
    .id as string;

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Agendada" })
    .select("id")
    .single()
    .throwOnError();
  const { data: prof2 } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dr. Sem Conversa" })
    .select("id")
    .single()
    .throwOnError();

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("recepcao2-a", clinicaA, "recepcao");
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa(
    "prof-a",
    clinicaA,
    "profissional",
    "ativo",
    prof!.id as string,
  );
  await criarPessoa(
    "prof2-a",
    clinicaA,
    "profissional",
    "ativo",
    prof2!.id as string,
  );
  await criarPessoa("pendente-a", clinicaA, "recepcao", "pendente");
  await criarPessoa("admin-b", clinicaB, "admin");

  numeroA = (await criarNumeroDeTeste(admin, clinicaA)).id;
  numeroRemovido = (
    await criarNumeroDeTeste(admin, clinicaA, { nome: "Removido" })
  ).id;
  numeroB = (await criarNumeroDeTeste(admin, clinicaB)).id;

  contato1 = await novoContato(clinicaA, true);
  conversa1 = await conversaComigo(
    clinicaA,
    contato1,
    numeroA,
    id("recepcao-a"),
  );
  contatoSemAutorizacao = await novoContato(clinicaA, false);
  conversaSemAutorizacao = await conversaComigo(
    clinicaA,
    contatoSemAutorizacao,
    numeroA,
    id("recepcao-a"),
  );
  contatoDoTeto = await novoContato(clinicaA, true);
  conversaDoTeto = await conversaComigo(
    clinicaA,
    contatoDoTeto,
    numeroA,
    id("recepcao-a"),
  );
  contatoNoRemovido = await novoContato(clinicaA, true);
  conversaNoRemovido = await conversaComigo(
    clinicaA,
    contatoNoRemovido,
    numeroRemovido,
    id("recepcao-a"),
  );
  contatoDoProfissional = await novoContato(clinicaA, true);
  conversaDoProfissional = await conversaComigo(
    clinicaA,
    contatoDoProfissional,
    numeroA,
    id("prof-a"),
  );
  contatoB = await novoContato(clinicaB, true);
  conversaB = await conversaComigo(clinicaB, contatoB, numeroB, id("admin-b"));

  // O numero sai da clinica com a conversa ainda aberta (o caminho de
  // remover_numero encerraria a conversa; aqui so o numero importa).
  await admin
    .from("whatsapp_account")
    .update({ removido_em: new Date().toISOString(), principal: false })
    .eq("id", numeroRemovido)
    .throwOnError();
});

afterAll(async () => {
  // As clinicas antes dos usuarios: autoria e atividade apontam para eles.
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const usuario of ids.values()) {
    await admin.auth.admin.deleteUser(usuario);
  }
});

// ---------------------------------------------------------------------------
// Agendar
// ---------------------------------------------------------------------------

describe("agendar: quem está com a conversa, e o banco carimba", () => {
  it("a autoria e o estado são do banco, mesmo com campos forjados", async () => {
    const { data, error } = await agendarComo("recepcao-a", {
      extras: {
        criada_por: id("gestor-a"),
        situacao: "enviada",
        motivo: "atrasou",
        editada_por: id("gestor-a"),
        cancelada_por: id("gestor-a"),
        dispensada_por: id("gestor-a"),
      },
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      criada_por: id("recepcao-a"),
      situacao: "agendada",
      motivo: null,
      job_id: null,
      editada_por: null,
      cancelada_por: null,
      dispensada_por: null,
      atividade_id: null,
    });
  });

  it("quem escreve mas não está com a conversa não agenda (nem o admin)", async () => {
    for (const papel of ["recepcao2-a", "admin-a", "gestor-a"]) {
      const { error } = await agendarComo(papel);
      expect(error?.code, papel).toBe(RLS_VIOLATION);
    }
    const { count } = await admin
      .from("mensagem_agendada")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA)
      .in("criada_por", [id("recepcao2-a"), id("admin-a"), id("gestor-a")]);
    expect(count).toBe(0);
  });

  it("leitura, pendente e a clínica B não agendam", async () => {
    // Leitura com a conversa atribuida a ela: o papel e que barra.
    const leitura = await agendarComo("leitura-a", await parNovo("leitura-a"));
    expect(leitura.error?.code).toBe(RLS_VIOLATION);
    expect(leitura.error?.message).toBe(
      "Sem permissão para agendar mensagens nesta clínica.",
    );

    const pendente = await agendarComo("pendente-a");
    expect(pendente.error?.code).toBe(RLS_VIOLATION);

    // A B nao aprende nada da A pela mensagem de erro: so a permissao.
    const daB = await agendarComo("admin-b", {
      contato: contatoNoRemovido,
      conversa: conversaNoRemovido,
      numero: numeroRemovido,
    });
    expect(daB.error?.message).toBe(
      "Sem permissão para agendar mensagens nesta clínica.",
    );

    // Positivo: a B agenda na propria.
    const propria = await agendarComo("admin-b", {
      clinica: clinicaB,
      contato: contatoB,
      numero: numeroB,
      conversa: conversaB,
    });
    expect(propria.error).toBeNull();
  });

  it("exige autorização vigente e número ativo", async () => {
    const semAutorizacao = await agendarComo("recepcao-a", {
      contato: contatoSemAutorizacao,
      conversa: conversaSemAutorizacao,
    });
    expect(semAutorizacao.error?.code).toBe(CHECK_VIOLATION);
    expect(semAutorizacao.error?.message).toBe(
      "Este contato não autorizou receber mensagens. Registre a autorização na ficha antes de agendar.",
    );

    const noRemovido = await agendarComo("recepcao-a", {
      contato: contatoNoRemovido,
      conversa: conversaNoRemovido,
      numero: numeroRemovido,
    });
    expect(noRemovido.error?.code).toBe(CHECK_VIOLATION);
    expect(noRemovido.error?.message).toBe(
      "O número desta conversa foi removido. Não dá para agendar por ele.",
    );
  });

  it("hora passada e mais de 1 ano à frente (no dia civil da clínica) são recusadas; o último dia vale", async () => {
    const passada = await agendarComo("recepcao-a", {
      enviarEm: new Date(Date.now() - 60_000),
    });
    expect(passada.error?.code).toBe(CHECK_VIOLATION);
    expect(passada.error?.message).toBe("Essa hora já passou. Escolha outra.");

    const ultimoDia = somarMeses(diaCivil(TZ, new Date()), 12);
    const noLimite = await agendarComo("recepcao-a", {
      enviarEm: instanteLocal(TZ, ultimoDia, "23:59"),
    });
    expect(noLimite.error).toBeNull();

    const depois = await agendarComo("recepcao-a", {
      enviarEm: instanteLocal(TZ, somarDias(ultimoDia, 1), "00:00"),
    });
    expect(depois.error?.code).toBe(CHECK_VIOLATION);
    expect(depois.error?.message).toBe(
      "Mais de 1 ano à frente não dá para agendar.",
    );
  });

  it("texto vazio ou acima de 4096 caracteres é recusado; 4096 vale", async () => {
    for (const texto of ["   ", "x".repeat(4097)]) {
      const { error } = await agendarComo("recepcao-a", { texto });
      expect(error?.code).toBe(CHECK_VIOLATION);
    }
    const limite = await agendarComo("recepcao-a", { texto: "y".repeat(4096) });
    expect(limite.error).toBeNull();
  });

  it("teto de 10 agendadas ativas por contato", async () => {
    for (let n = 1; n <= 10; n += 1) {
      await agendada("recepcao-a", {
        contato: contatoDoTeto,
        conversa: conversaDoTeto,
        enviarEm: new Date(Date.now() + n * HORA),
      });
    }
    const decima = await agendarComo("recepcao-a", {
      contato: contatoDoTeto,
      conversa: conversaDoTeto,
      enviarEm: new Date(Date.now() + 20 * HORA),
    });
    expect(decima.error?.code).toBe(CHECK_VIOLATION);
    expect(decima.error?.message).toBe(
      "Este contato já tem muitas mensagens agendadas. Exclua uma antes de agendar outra.",
    );

    // Excluir uma libera a vaga.
    const { data: umaDelas } = await admin
      .from("mensagem_agendada")
      .select("id")
      .eq("contact_id", contatoDoTeto)
      .eq("situacao", "agendada")
      .limit(1)
      .single()
      .throwOnError();
    const { data: excluida } = await como("recepcao-a")
      .from("mensagem_agendada")
      .update({ situacao: "cancelada" })
      .eq("id", umaDelas!.id as string)
      .select("id");
    expect(excluida).toHaveLength(1);
    const depois = await agendarComo("recepcao-a", {
      contato: contatoDoTeto,
      conversa: conversaDoTeto,
      enviarEm: new Date(Date.now() + 21 * HORA),
    });
    expect(depois.error).toBeNull();
  });

  it("teto com corrida: com 9 ativas, duas inserções ao mesmo tempo, só uma passa", async () => {
    const par = await parNovo();
    for (let n = 1; n <= 9; n += 1) {
      await agendada("recepcao-a", {
        ...par,
        enviarEm: new Date(Date.now() + n * HORA),
      });
    }
    const [uma, outra] = await Promise.all([
      agendarComo("recepcao-a", {
        ...par,
        texto: "Corrida um",
        enviarEm: new Date(Date.now() + 40 * HORA),
      }),
      agendarComo("recepcao-a", {
        ...par,
        texto: "Corrida dois",
        enviarEm: new Date(Date.now() + 41 * HORA),
      }),
    ]);
    const erros = [uma.error, outra.error].filter((erro) => erro !== null);
    expect(erros).toHaveLength(1);
    expect(erros[0]?.code).toBe(CHECK_VIOLATION);
    const { count } = await admin
      .from("mensagem_agendada")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", par.contato)
      .eq("situacao", "agendada");
    expect(count).toBe(10);
  });

  it("a mesma mensagem para a mesma hora é duplicata; o id repetido não muda a linha", async () => {
    const enviarEm = new Date(Date.now() + 30 * HORA);
    enviarEm.setUTCSeconds(0, 0);
    const primeiro = crypto.randomUUID();
    await agendada("recepcao-a", {
      id: primeiro,
      texto: "Mensagem igual",
      enviarEm,
    });
    const duplicata = await agendarComo("recepcao-a", {
      texto: "Mensagem igual",
      enviarEm,
    });
    expect(duplicata.error?.code).toBe(UNIQUE_VIOLATION);

    // O reenvio do formulario com o mesmo id: 23505 da chave, e a linha que
    // a sessao rele e a primeira, intacta.
    const reenvio = await agendarComo("recepcao-a", {
      id: primeiro,
      texto: "Outro texto",
      enviarEm: new Date(Date.now() + 31 * HORA),
    });
    expect(reenvio.error?.code).toBe(UNIQUE_VIOLATION);
    const { data: relida } = await como("recepcao-a")
      .from("mensagem_agendada")
      .select("id, texto, criada_por, contact_id")
      .eq("id", primeiro);
    expect(relida).toEqual([
      {
        id: primeiro,
        texto: "Mensagem igual",
        criada_por: id("recepcao-a"),
        contact_id: contato1,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Ler
// ---------------------------------------------------------------------------

describe("ler: membro ativo, profissional só a da conversa dele", () => {
  let daRecepcao = "";
  let doProfissional = "";

  beforeAll(async () => {
    daRecepcao = await agendada("recepcao-a", { texto: "Para a leitura" });
    doProfissional = await agendada("prof-a", {
      contato: contatoDoProfissional,
      conversa: conversaDoProfissional,
      texto: "Do profissional",
    });
  });

  it("admin, gestor, recepção e leitura leem", async () => {
    for (const papel of ["admin-a", "gestor-a", "recepcao2-a", "leitura-a"]) {
      const { data } = await como(papel)
        .from("mensagem_agendada")
        .select("id")
        .in("id", [daRecepcao, doProfissional]);
      expect((data ?? []).length, papel).toBe(2);
    }
  });

  it("o profissional lê só a da conversa dele; o outro profissional não lê nenhuma", async () => {
    const { data: doProf } = await como("prof-a")
      .from("mensagem_agendada")
      .select("id")
      .in("id", [daRecepcao, doProfissional]);
    expect(doProf).toEqual([{ id: doProfissional }]);

    const { data: doOutro } = await como("prof2-a")
      .from("mensagem_agendada")
      .select("id")
      .in("id", [daRecepcao, doProfissional]);
    expect(doOutro ?? []).toEqual([]);

    const { data: alterou } = await como("prof2-a")
      .from("mensagem_agendada")
      .update({ texto: "Tentativa" })
      .eq("id", doProfissional)
      .select("id");
    expect(alterou ?? []).toEqual([]);
    expect((await noBanco(doProfissional)).texto).toBe("Do profissional");
  });

  it("pendente e a clínica B não leem; a A não lê a da B", async () => {
    for (const papel of ["pendente-a", "admin-b"]) {
      const { data } = await como(papel)
        .from("mensagem_agendada")
        .select("id")
        .in("id", [daRecepcao, doProfissional]);
      expect(data ?? [], papel).toEqual([]);
    }
    const { data: daB } = await como("admin-a")
      .from("mensagem_agendada")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect(daB ?? []).toEqual([]);
    const { data: propriaB } = await como("admin-b")
      .from("mensagem_agendada")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect((propriaB ?? []).length).toBeGreaterThan(0);
  });

  it("anon não tem privilégio na tabela", async () => {
    const anonimo = await anonClient()
      .from("mensagem_agendada")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(anonimo.error?.code).toBe(RLS_VIOLATION);
    expect(anonimo.error?.message).toMatch(/permission denied for table/);
  });
});

// ---------------------------------------------------------------------------
// Mexer: editar, excluir, dispensar
// ---------------------------------------------------------------------------

describe("mexer: quem escreve e vê (A1)", () => {
  it("outra pessoa que escreve edita e passa a assinar; quem agendou edita de novo e volta a assinar", async () => {
    const agendadaId = await agendada("recepcao-a", {
      ...(await parNovo()),
      texto: "Primeiro texto",
    });
    const novaHora = new Date(Date.now() + 5 * HORA).toISOString();
    const { data, error } = await como("recepcao2-a")
      .from("mensagem_agendada")
      .update({ texto: "Texto da colega", enviar_em: novaHora })
      .eq("id", agendadaId)
      .eq("situacao", "agendada")
      .select("editada_por, criada_por, texto");
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        editada_por: id("recepcao2-a"),
        criada_por: id("recepcao-a"),
        texto: "Texto da colega",
      },
    ]);
    expect((await noBanco(agendadaId)).editada_em).not.toBeNull();

    const { data: devolta } = await como("recepcao-a")
      .from("mensagem_agendada")
      .update({ texto: "Texto final" })
      .eq("id", agendadaId)
      .select("editada_por");
    expect(devolta).toEqual([{ editada_por: id("recepcao-a") }]);
  });

  it("leitura e pendente não mexem (0 linhas)", async () => {
    const agendadaId = await agendada("recepcao-a", {
      ...(await parNovo()),
      texto: "Intocada",
    });
    for (const papel of ["leitura-a", "pendente-a", "admin-b"]) {
      const { data } = await como(papel)
        .from("mensagem_agendada")
        .update({ texto: "Mexida" })
        .eq("id", agendadaId)
        .select("id");
      expect(data ?? [], papel).toEqual([]);
      const { data: excluida } = await como(papel)
        .from("mensagem_agendada")
        .update({ situacao: "cancelada" })
        .eq("id", agendadaId)
        .select("id");
      expect(excluida ?? [], papel).toEqual([]);
    }
    expect(await noBanco(agendadaId)).toMatchObject({
      situacao: "agendada",
      texto: "Intocada",
    });
  });

  it("a sessão não muda job, motivo, autoria, conversa nem atividade", async () => {
    const agendadaId = await agendada("recepcao-a", await parNovo());
    const proibidos: Record<string, unknown>[] = [
      { job_id: crypto.randomUUID() },
      { motivo: "atrasou" },
      { criada_por: id("gestor-a") },
      { conversation_id: conversaDoTeto },
      { contact_id: contatoDoTeto },
      { atividade_id: crypto.randomUUID() },
      { encerrada_em: new Date().toISOString() },
      { situacao: "enviada" },
    ];
    for (const campos of proibidos) {
      const { error } = await como("gestor-a")
        .from("mensagem_agendada")
        .update(campos)
        .eq("id", agendadaId);
      expect(error?.code, JSON.stringify(campos)).toBe(RLS_VIOLATION);
    }
    // Carimbos mandados pelo cliente sao ignorados (a edicao vale e carimba
    // a sessao; o resto fica como estava).
    const { data } = await como("gestor-a")
      .from("mensagem_agendada")
      .update({
        texto: "Com carimbo forjado",
        editada_por: id("recepcao2-a"),
        cancelada_por: id("recepcao2-a"),
      })
      .eq("id", agendadaId)
      .select("editada_por, cancelada_por, cancelada_em, situacao");
    expect(data).toEqual([
      {
        editada_por: id("gestor-a"),
        cancelada_por: null,
        cancelada_em: null,
        situacao: "agendada",
      },
    ]);

    const juntas = await como("gestor-a")
      .from("mensagem_agendada")
      .update({ texto: "Outra", situacao: "cancelada" })
      .eq("id", agendadaId);
    expect(juntas.error?.code).toBe(RLS_VIOLATION);
  });

  it("editar para hora passada ou mais de 1 ano é recusado", async () => {
    const agendadaId = await agendada("recepcao-a", await parNovo());
    const passada = await como("recepcao-a")
      .from("mensagem_agendada")
      .update({ enviar_em: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", agendadaId);
    expect(passada.error?.code).toBe(CHECK_VIOLATION);
    const longe = await como("recepcao-a")
      .from("mensagem_agendada")
      .update({
        enviar_em: instanteLocal(
          TZ,
          somarDias(somarMeses(diaCivil(TZ, new Date()), 12), 1),
          "09:00",
        ).toISOString(),
      })
      .eq("id", agendadaId);
    expect(longe.error?.code).toBe(CHECK_VIOLATION);
  });

  it("quem escreve exclui, inclusive a agendada vencida; a cancelada não volta", async () => {
    const agendadaId = await agendada("recepcao-a", await parNovo());
    // Vencida e ainda nao planejada (a planejadora nao passou).
    await comoSistema(agendadaId, {
      enviar_em: new Date(Date.now() - 60_000).toISOString(),
    });
    const { data, error } = await como("gestor-a")
      .from("mensagem_agendada")
      .update({ situacao: "cancelada" })
      .in("situacao", ["agendada", "enviando"])
      .eq("id", agendadaId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await noBanco(agendadaId)).toMatchObject({
      situacao: "cancelada",
      cancelada_por: id("gestor-a"),
      texto: null,
    });
    expect((await noBanco(agendadaId)).encerrada_em).not.toBeNull();

    const { data: voltou } = await como("admin-a")
      .from("mensagem_agendada")
      .update({ situacao: "agendada" })
      .eq("id", agendadaId)
      .select("id");
    expect(voltou ?? []).toEqual([]);
    expect((await noBanco(agendadaId)).situacao).toBe("cancelada");
  });

  it("na fila para sair: editar dá corrida (CZ409) e o filtro da ação devolve 0 linhas; excluir sem job pendente dá CZ409", async () => {
    const agendadaId = await agendada("recepcao-a", {
      ...(await parNovo()),
      texto: "Na fila",
    });
    await comoSistema(agendadaId, { situacao: "enviando" });

    const filtrada = await como("recepcao-a")
      .from("mensagem_agendada")
      .update({ texto: "Tarde demais" })
      .eq("id", agendadaId)
      .eq("situacao", "agendada")
      .select("id");
    expect(filtrada.error).toBeNull();
    expect(filtrada.data ?? []).toEqual([]);

    const editar = await como("recepcao-a")
      .from("mensagem_agendada")
      .update({ texto: "Tarde demais" })
      .eq("id", agendadaId);
    expect(editar.error?.code).toBe(CORRIDA);

    // Sem job pendente para cancelar (ja saiu ou nunca nasceu): perde.
    const excluir = await como("recepcao-a")
      .from("mensagem_agendada")
      .update({ situacao: "cancelada" })
      .eq("id", agendadaId);
    expect(excluir.error?.code).toBe(CORRIDA);
    expect(await noBanco(agendadaId)).toMatchObject({
      situacao: "enviando",
      texto: "Na fila",
    });
  });

  it("na fila depois de uma falha que certamente não enviou: excluir cancela o job; envio incerto ou falha sem código dão CZ409", async () => {
    const par = await parNovo();
    const semEnvio = await agendada("recepcao-a", {
      ...par,
      texto: "Falhou sem sair",
    });
    const jobSemEnvio = await naFilaComJob(semEnvio);
    await mensagemDoJob(par, jobSemEnvio, "leitura_falhou");
    const { data, error } = await como("recepcao2-a")
      .from("mensagem_agendada")
      .update({ situacao: "cancelada" })
      .in("situacao", ["agendada", "enviando"])
      .eq("id", semEnvio)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await jobNoBanco(jobSemEnvio)).toEqual({
      status: "cancelado",
      last_error: "cancelada_pela_clinica",
    });
    expect(await noBanco(semEnvio)).toMatchObject({
      situacao: "cancelada",
      cancelada_por: id("recepcao2-a"),
      texto: null,
    });

    // Pode ter chegado: a exclusao perde e o job fica.
    for (const codigo of ["envio_incerto", "uazapi_500", null]) {
      const outroPar = await parNovo();
      const talvez = await agendada("recepcao-a", {
        ...outroPar,
        texto: "Talvez tenha saído",
      });
      const job = await naFilaComJob(talvez);
      await mensagemDoJob(outroPar, job, codigo);
      const excluir = await como("recepcao2-a")
        .from("mensagem_agendada")
        .update({ situacao: "cancelada" })
        .eq("id", talvez);
      expect(excluir.error?.code, String(codigo)).toBe(CORRIDA);
      expect((await jobNoBanco(job)).status, String(codigo)).toBe("pendente");
      expect(await noBanco(talvez)).toMatchObject({
        situacao: "enviando",
        texto: "Talvez tenha saído",
      });
    }
  });

  it("dispensar só vale na que não saiu, e carimba a sessão", async () => {
    const par = await parNovo();
    const agendadaId = await agendada("recepcao-a", {
      ...par,
      texto: "Vai falhar",
    });
    const cedo = await como("recepcao-a")
      .from("mensagem_agendada")
      .update({ dispensada_em: new Date().toISOString() })
      .eq("id", agendadaId);
    expect(cedo.error?.code).toBe(RLS_VIOLATION);

    await comoSistema(agendadaId, {
      situacao: "nao_enviada",
      motivo: "falha_no_envio",
      encerrada_em: new Date().toISOString(),
    });
    const { data, error } = await como("recepcao2-a")
      .from("mensagem_agendada")
      .update({
        dispensada_em: new Date(Date.now() - 24 * HORA).toISOString(),
        dispensada_por: id("gestor-a"),
      })
      .in("situacao", ["nao_enviada", "nao_confirmada"])
      .is("dispensada_em", null)
      .eq("id", agendadaId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const linha = await noBanco(agendadaId);
    expect(linha).toMatchObject({
      dispensada_por: id("recepcao2-a"),
      texto: null,
      situacao: "nao_enviada",
    });
    expect(Date.now() - new Date(linha.dispensada_em!).getTime()).toBeLessThan(
      5 * 60_000,
    );

    // A que nao saiu nao e excluida nem editada.
    const outra = await agendada("recepcao-a", {
      ...par,
      texto: "Outra que falhou",
    });
    await comoSistema(outra, {
      situacao: "nao_enviada",
      motivo: "atrasou",
      encerrada_em: new Date().toISOString(),
    });
    const excluir = await como("recepcao-a")
      .from("mensagem_agendada")
      .update({ situacao: "cancelada" })
      .eq("id", outra);
    expect(excluir.error?.code).toBe(RLS_VIOLATION);
  });

  it("sem DELETE pela API", async () => {
    const agendadaId = await agendada("recepcao-a", await parNovo());
    const { error } = await como("admin-a")
      .from("mensagem_agendada")
      .delete()
      .eq("id", agendadaId);
    expect(error?.code).toBe(RLS_VIOLATION);
    expect((await noBanco(agendadaId)).situacao).toBe("agendada");
  });

  it("A1/A5: a gestão cancela as agendadas que uma pessoa assina", async () => {
    const par = await parNovo();
    const minha = await agendada("recepcao-a", {
      ...par,
      texto: "Assinada pela recepção",
    });
    const editada = await agendada("recepcao-a", {
      ...par,
      texto: "Vai ser da colega",
    });
    await como("recepcao2-a")
      .from("mensagem_agendada")
      .update({ texto: "Agora da colega" })
      .eq("id", editada)
      .throwOnError();

    // Assinante = coalesce(editada_por, criada_por) = recepcao-a
    const { data } = await como("gestor-a")
      .from("mensagem_agendada")
      .update({ situacao: "cancelada" })
      .eq("clinic_id", clinicaA)
      .eq("situacao", "agendada")
      .or(
        `editada_por.eq.${id("recepcao-a")},and(editada_por.is.null,criada_por.eq.${id("recepcao-a")})`,
      )
      .in("id", [minha, editada])
      .select("id");
    expect(data).toEqual([{ id: minha }]);
    expect((await noBanco(editada)).situacao).toBe("agendada");
  });
});

// ---------------------------------------------------------------------------
// Funcoes
// ---------------------------------------------------------------------------

describe("funções do sistema e Enviar agora", () => {
  it("nenhum papel nem anon chama a planejadora, a reconciliação, o encerrar, o motivo e a lista de falhas", async () => {
    const chamadas: [string, Record<string, unknown>][] = [
      [
        "planejar_mensagens_agendadas",
        { p_clinic_id: clinicaA, p_incluir_teste: true },
      ],
      [
        "reconciliar_mensagens_agendadas",
        { p_clinic_id: clinicaA, p_incluir_teste: true },
      ],
      ["reconciliar_mensagem_agendada", { p_agendada_id: crypto.randomUUID() }],
      [
        "encerrar_agendada_sem_envio",
        {
          p_agendada_id: crypto.randomUUID(),
          p_situacao: "nao_enviada",
          p_motivo: "atrasou",
        },
      ],
      ["motivo_da_agendada", { p_codigo: "desconectado" }],
      ["falhas_sem_envio", {}],
    ];
    const sessoes: [string, SupabaseClient][] = [
      ["admin-a", como("admin-a")],
      ["recepcao-a", como("recepcao-a")],
      ["anon", anonClient()],
    ];
    for (const [funcao, args] of chamadas) {
      for (const [papel, cliente] of sessoes) {
        const { error } = await cliente.rpc(funcao, args);
        expect(error?.code, `${papel} chamou ${funcao}`).toBe(RLS_VIOLATION);
        expect(error?.message, `${papel} chamou ${funcao}`).toMatch(
          /permission denied for function/,
        );
      }
    }
    // Positivo: o service role chama.
    const { data, error } = await admin.rpc("motivo_da_agendada", {
      p_codigo: "desconectado",
    });
    expect(error).toBeNull();
    expect(data).toBe("numero_desconectado");
    const falhas = await admin.rpc("falhas_sem_envio");
    expect(falhas.error).toBeNull();
    expect(falhas.data).toContain("leitura_falhou");
    expect(falhas.data).not.toContain("envio_incerto");
  });

  it("Enviar agora: sem oráculo para quem não vê; quem escreve sem a conversa recebe 'assuma'; quem está com ela retira (A1)", async () => {
    const par = await parNovo();
    const agendadaId = await agendada("recepcao-a", {
      ...par,
      texto: "Para enviar agora",
    });
    // A colega edita: assina, mas nao esta com a conversa.
    await como("recepcao2-a")
      .from("mensagem_agendada")
      .update({ texto: "Para enviar agora, editada" })
      .eq("id", agendadaId)
      .throwOnError();

    for (const papel of ["admin-b", "leitura-a", "prof2-a", "pendente-a"]) {
      const { data, error } = await como(papel).rpc(
        "tirar_agendada_para_enviar_agora",
        { p_id: agendadaId },
      );
      expect(error, papel).toBeNull();
      expect(data, papel).toEqual({ estado: "nao_encontrada" });
    }
    const inexistente = await como("recepcao-a").rpc(
      "tirar_agendada_para_enviar_agora",
      { p_id: crypto.randomUUID() },
    );
    expect(inexistente.data).toEqual({ estado: "nao_encontrada" });

    const anonimo = await anonClient().rpc("tirar_agendada_para_enviar_agora", {
      p_id: agendadaId,
    });
    expect(anonimo.error?.code).toBe(RLS_VIOLATION);

    const colega = await como("recepcao2-a").rpc(
      "tirar_agendada_para_enviar_agora",
      { p_id: agendadaId },
    );
    expect(colega.data).toEqual({ estado: "assuma_a_conversa" });
    expect((await noBanco(agendadaId)).situacao).toBe("agendada");

    const { data, error } = await como("recepcao-a").rpc(
      "tirar_agendada_para_enviar_agora",
      { p_id: agendadaId },
    );
    expect(error).toBeNull();
    expect(data).toEqual({
      estado: "ok",
      texto: "Para enviar agora, editada",
      conversation_id: par.conversa,
    });
    expect(await noBanco(agendadaId)).toMatchObject({
      situacao: "cancelada",
      motivo: "enviada_agora",
      cancelada_por: id("recepcao-a"),
      texto: null,
    });

    // Retirada uma vez: a segunda chamada nao devolve o texto de novo.
    const deNovo = await como("recepcao-a").rpc(
      "tirar_agendada_para_enviar_agora",
      { p_id: agendadaId },
    );
    expect(deNovo.data).toEqual({ estado: "nao_encontrada" });

    const { data: trilha } = await admin
      .from("audit_log")
      .select("user_id, action, entity")
      .eq("entity_id", agendadaId)
      .throwOnError();
    // A RPC registra a retirada; o envio de fato e auditado pela Server
    // Action (aqui ninguem envia).
    expect(trilha).toEqual([
      {
        user_id: id("recepcao-a"),
        action: "retirou_agendada_para_enviar_agora",
        entity: "mensagem_agendada",
      },
    ]);
  });

  it("Enviar agora na fila para sair devolve 'ja_saindo'", async () => {
    const agendadaId = await agendada("recepcao-a", {
      ...(await parNovo()),
      texto: "Já na fila",
    });
    await comoSistema(agendadaId, { situacao: "enviando" });
    const { data } = await como("recepcao-a").rpc(
      "tirar_agendada_para_enviar_agora",
      { p_id: agendadaId },
    );
    expect(data).toEqual({ estado: "ja_saindo" });
    expect((await noBanco(agendadaId)).texto).toBe("Já na fila");
  });
});

// ---------------------------------------------------------------------------
// Revogacao pela sessao (A3)
// ---------------------------------------------------------------------------

describe("revogação pela ficha encerra as agendadas com a atividade do sistema", () => {
  it("a sessão revoga: a agendada vira 'nao_enviada' sem_autorizacao e nasce UMA atividade para quem assina", async () => {
    const { contato, conversa } = await parNovo();
    const primeira = await agendada("recepcao-a", {
      contato,
      conversa,
      texto: "Primeira do contato",
    });
    const segunda = await agendada("recepcao-a", {
      contato,
      conversa,
      texto: "Segunda do contato",
      enviarEm: new Date(Date.now() + 6 * HORA),
    });
    // A colega edita a segunda: ela passa a assinar.
    await como("recepcao2-a")
      .from("mensagem_agendada")
      .update({ texto: "Segunda, editada" })
      .eq("id", segunda)
      .throwOnError();

    const { error } = await como("recepcao-a")
      .from("contact_consent")
      .update({ revoked_at: new Date().toISOString() })
      .eq("clinic_id", clinicaA)
      .eq("contact_id", contato)
      .eq("channel", "whatsapp")
      .is("revoked_at", null);
    expect(error).toBeNull();

    for (const [agendadaId, assinante] of [
      [primeira, id("recepcao-a")],
      [segunda, id("recepcao2-a")],
    ] as const) {
      const linha = await noBanco(agendadaId);
      expect(linha).toMatchObject({
        situacao: "nao_enviada",
        motivo: "sem_autorizacao",
      });
      expect(linha.atividade_id).not.toBeNull();
      const { data: atividade } = await admin
        .from("contact_activity")
        .select(
          "contact_id, conversation_id, titulo, detalhes, origem, automacao_id, created_by, assignee_user_id, status, due_on, due_at",
        )
        .eq("id", linha.atividade_id!)
        .single()
        .throwOnError();
      expect(atividade).toMatchObject({
        contact_id: contato,
        conversation_id: conversa,
        titulo: "Mensagem agendada não saiu",
        origem: "automacao",
        automacao_id: null,
        created_by: null,
        assignee_user_id: assinante,
        status: "pendente",
        due_on: diaCivil(TZ, new Date()),
        due_at: null,
      });
      // Nada do texto da mensagem nem do telefone na atividade.
      const detalhes = atividade!.detalhes as string;
      expect(detalhes).toContain("o contato não autoriza receber mensagens");
      expect(detalhes).not.toContain("Primeira do contato");
      expect(detalhes).not.toContain("Segunda, editada");
      expect(detalhes).not.toMatch(/\+55/);
    }
    const { count } = await admin
      .from("contact_activity")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contato);
    expect(count).toBe(2);

    // A sessao continua sem criar atividade de automacao por conta propria.
    const forjada = await como("recepcao-a")
      .from("contact_activity")
      .insert({
        clinic_id: clinicaA,
        contact_id: contato,
        titulo: "Forjada",
        due_on: diaCivil(TZ, new Date()),
        origem: "automacao",
      });
    expect(forjada.error?.code).toBe(RLS_VIOLATION);
  });

  it("a da fila com o job pendente (inclusive depois de falha que certamente não enviou) também para: o job é cancelado; com o job executando, fica para o executor", async () => {
    const par = await parNovo();
    const naFila = await agendada("recepcao-a", {
      ...par,
      texto: "Na fila, esperando o número",
    });
    const jobNaFila = await naFilaComJob(naFila);
    await mensagemDoJob(par, jobNaFila, "canal_ocupado");

    // Outro numero do mesmo contato, com o job ja executando.
    const outroNumero = (
      await criarNumeroDeTeste(admin, clinicaA, { nome: "Segundo da A" })
    ).id;
    const conversaNoOutro = await conversaComigo(
      clinicaA,
      par.contato,
      outroNumero,
      id("recepcao-a"),
    );
    const executando = await agendada("recepcao-a", {
      contato: par.contato,
      conversa: conversaNoOutro,
      numero: outroNumero,
      texto: "Já saindo",
    });
    const jobExecutando = await naFilaComJob(executando, outroNumero);
    await admin
      .from("job_queue")
      .update({
        status: "executando",
        locked_by: `teste-agendada-${sufixo}`,
        locked_at: new Date().toISOString(),
      })
      .eq("id", jobExecutando)
      .throwOnError();

    const { error } = await como("recepcao-a")
      .from("contact_consent")
      .update({ revoked_at: new Date().toISOString() })
      .eq("clinic_id", clinicaA)
      .eq("contact_id", par.contato)
      .is("revoked_at", null);
    expect(error).toBeNull();

    expect(await noBanco(naFila)).toMatchObject({
      situacao: "nao_enviada",
      motivo: "sem_autorizacao",
      texto: "Na fila, esperando o número",
    });
    expect((await noBanco(naFila)).atividade_id).not.toBeNull();
    expect(await jobNoBanco(jobNaFila)).toEqual({
      status: "cancelado",
      last_error: "sem_consentimento",
    });
    expect((await noBanco(executando)).situacao).toBe("enviando");
    expect((await jobNoBanco(jobExecutando)).status).toBe("executando");

    // Solta o job executando sem enviar (nada aqui executa).
    await admin
      .from("job_queue")
      .update({ status: "cancelado", locked_by: null, locked_at: null })
      .eq("id", jobExecutando)
      .throwOnError();
  });
});
