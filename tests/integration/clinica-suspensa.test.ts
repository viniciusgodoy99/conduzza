import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Onda 1 (migration 20261021100000_painel_geral.sql), contra o banco REAL,
// pelo cliente de servico (como o motor, a ingestao e o painel chegam ao
// banco pelo PostgREST). O que esta em jogo:
// - suspender_clinica e reativar_clinica: as recusas chegam com o codigo e a
//   CHAVE que a tela traduz (app/(app)/painel-geral/actions.ts compara
//   error.message com clinica_ja_suspensa, clinica_nao_suspensa,
//   clinica_de_teste, clinica_suspensa e sem_liberacao), sem laco de
//   retentativa do PostgREST (nenhuma e 40001); a linha, a trilha e a
//   conversa do agente de volta para a equipe;
// - com a conta suspensa: ia_pode_atender e ia_atende_no_whatsapp falsos; a
//   mensagem que chega e gravada e a conversa nao nasce na IA; o claim do
//   motor nao pega job da clinica, MENOS a midia que chega; ia_jobs_devidos a
//   deixa de fora;
// - reativar: cancela a mensagem automatica que venceu (pendente com run_at
//   passado e executando de lease vencido; last_error vencido_na_suspensao),
//   deixa o futuro, a midia, as da Meta (conversao e gasto: nao mandam
//   mensagem ao paciente e seguem como estavam) e o executando vivo; fecha
//   o toque de regua do job cancelado; devolve {jobs_vencidos} igual a
//   trilha; a IA volta;
// - painel_geral_das_clinicas: o formato dela (a tela a leu ate 26/10/2026;
//   desde entao lerPainelDoBanco, em lib/queries/painel-geral.ts, le
//   painel_cs_das_clinicas, e a funcao antiga sai numa limpeza depois) e os
//   numeros da clinica de teste;
// - definir_agente_da_clinica e definir_teto_da_ia: as recusas (de teste,
//   estado, faixas, sem liberacao, conta suspensa) e, numa clinica que deixa
//   de ser de teste SO DENTRO do teste, a entrada e a saida da lista da IA.
//
// ESTE BANCO E O DE PRODUCAO. Por isso, como em fila-por-raia.test.ts:
//   - todo job do claim nasce com run_at de um ano atras e p_max_clinicas e
//     EXATAMENTE o numero de raias esperado: o LIMIT para antes de qualquer
//     job de verdade; o que vier de fora volta na hora (reagendar_job, mesmo
//     run_at) e o teste falha dizendo isso;
//   - nenhum job e executado (numero fake, nenhum executor roda aqui); os
//     que sobram terminam cancelados, e as clinicas sao apagadas no afterAll;
//   - a clinica N deixa de ser de teste so no teste do agente e volta a ser
//     no finally (desligada e reativada antes): ela nao tem numero nem
//     telefone, entao nem na lista a IA atende nela. Se a execucao morrer
//     antes do finally, o beforeAll da execucao seguinte acha a N pela
//     slug e pelo nome, desliga o agente, reativa, devolve a marca de teste
//     e so entao a apaga com as outras sobras.
// O interruptor global NUNCA e tocado. Nada usa a id da salud-care, da
// teste123 nem da Conduzza Teste. Telefones ficticios. ESCRITO, AINDA NAO
// RODADO (roda depois de aplicar a migration:
// npm run test:integration -- clinica-suspensa).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// conferir e depois apagar (a suspensao e o estado do agente vao junto).
//   select id, name, e_de_teste from public.clinic where slug like 'onda1-int-%';
//   delete from public.clinic where slug like 'onda1-int-%';
// (A N que ficou sem a marca de teste sai junto: apagar a clinica leva a
// linha de ia_clinica_habilitada e a de ia_liberacao, em cascata.)

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const clinicas: string[] = [];
const DIA = 24 * 60 * 60 * 1000;
const WORKER = `int-onda1-${sufixo}`;

// Telefones da equipe (ficticios).
const EQ1 = `+5584976${digitos}`;
const EQ2 = `+5584977${digitos}`;
const EQ3 = `+5584978${digitos}`;

let clinicaS = ""; // a que e suspensa (de teste)
let clinicaT = ""; // a de controle (de teste, nunca suspensa)
let numeroS = "";
let numeroS2 = "";
let numeroT = "";
let contatoS = "";
let contatoT = "";
let conversaDoAgente = "";

type Erro = { code?: string; message?: string } | null;

type Job = {
  id: string;
  clinic_id: string;
  kind: string;
  status: string;
  last_error: string | null;
  locked_by: string | null;
  run_at: string;
};

type Ingestao = {
  inserted: boolean;
  conversation_id: string | null;
  message_id: string | null;
  ia_atendendo?: boolean;
};

/** run_at bem no passado, com o desempate dentro do teste em segundos. */
function haUmAno(segundos = 0): string {
  return new Date(Date.now() - 365 * DIA + segundos * 1000).toISOString();
}

let contadorWa = 0;
function wa(): string {
  contadorWa += 1;
  return `onda1-int-${sufixo}-${contadorWa}`;
}

async function rpcOk<T>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
}

async function rpcErro(
  nome: string,
  args: Record<string, unknown>,
): Promise<Erro> {
  const { error } = await admin.rpc(nome, args);
  return error as Erro;
}

/**
 * A migration da producao do agente (onda 2, M3, 20261022120000) ja foi
 * aplicada? Ela muda dois contratos que esta suite fixa: os totais do
 * painel ganham agente_em_producao, e producao deixa de ser estado
 * invalido (numa clinica e_de_teste vira P0001 clinica_de_teste). As
 * migrations da onda 2 vao para a producao em fases (a M3 espera as
 * decisoes do dono): a suite vale antes e depois dela. Sem a funcao, o
 * PostgREST responde PGRST202 (ou o banco, 42883).
 */
async function producaoDoAgenteAplicada(): Promise<boolean> {
  const { error } = await admin.rpc("requisitos_da_producao", {
    p_clinic_id: crypto.randomUUID(),
  });
  return !(error && (error.code === "PGRST202" || error.code === "42883"));
}

function esperaErro(erro: Erro, codigo: string, chave?: string): void {
  expect(erro?.code).toBe(codigo);
  if (chave !== undefined) {
    expect(erro?.message).toBe(chave);
  }
}

async function novaClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Onda1 Int ${nome} ${sufixo}`,
      slug: `onda1-int-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const id = (data as { id: string }).id;
  clinicas.push(id);
  return id;
}

async function novoContato(
  clinicId: string,
  telefone: string,
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Contato sintético",
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function enfileirar(campos: {
  clinicId: string;
  kind: string;
  runAt: string;
  numero?: string | null;
  payload?: Record<string, unknown>;
  status?: string;
  lockedAt?: string;
}): Promise<string> {
  const { data } = await admin
    .from("job_queue")
    .insert({
      clinic_id: campos.clinicId,
      kind: campos.kind,
      payload: campos.payload ?? {},
      run_at: campos.runAt,
      whatsapp_account_id: campos.numero ?? null,
      ...(campos.status
        ? {
            status: campos.status,
            locked_by: `${WORKER}-antigo`,
            locked_at: campos.lockedAt,
            attempts: 1,
          }
        : {}),
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function jobs(ids: string[]): Promise<Map<string, Job>> {
  const { data } = await admin
    .from("job_queue")
    .select("id, clinic_id, kind, status, last_error, locked_by, run_at")
    .in("id", ids)
    .throwOnError();
  return new Map(((data ?? []) as Job[]).map((linha) => [linha.id, linha]));
}

/**
 * Uma chamada do claim do motor. Devolve so os jobs das clinicas deste
 * teste; o que vier de fora volta para a fila na hora (e fica contado).
 */
async function reivindicar(
  maxRaias: number,
  kinds: string[],
): Promise<{ meus: Job[]; deFora: number }> {
  const { data, error } = await admin.rpc("claim_jobs_por_clinica", {
    p_worker: WORKER,
    p_max_clinicas: maxRaias,
    p_kinds: kinds,
    p_incluir_teste: true,
  });
  expect(error).toBeNull();
  const todos = (data ?? []) as Job[];
  const meus = todos.filter((job) => clinicas.includes(job.clinic_id));
  const deFora = todos.filter((job) => !clinicas.includes(job.clinic_id));
  for (const job of deFora) {
    await admin.rpc("reagendar_job", {
      p_id: job.id,
      p_worker: WORKER,
      p_run_at: job.run_at,
      p_motivo: "teste_da_suspensao_devolveu",
    });
  }
  return { meus, deFora: deFora.length };
}

async function ingerir(
  telefone: string,
  clinica = clinicaS,
  numero = numeroS,
): Promise<Ingestao> {
  return rpcOk<Ingestao>("ingest_inbound_message", {
    p_clinic_id: clinica,
    p_phone_e164: telefone,
    p_name: "Contato sintético",
    p_wa_message_id: wa(),
    p_content_type: "texto",
    p_body: "Mensagem sintética",
    p_whatsapp_account_id: numero,
  });
}

async function suspensa(clinicId: string): Promise<boolean> {
  return rpcOk<boolean>("clinica_esta_suspensa", { p_clinic_id: clinicId });
}

async function reativarSeSuspensa(clinicId: string): Promise<void> {
  if (clinicId && (await suspensa(clinicId))) {
    await admin.rpc("reativar_clinica", {
      p_clinic_id: clinicId,
      p_motivo: "Limpeza do teste de integracao",
    });
  }
}

async function iaDevidos(clinicId: string): Promise<string[]> {
  const ids = await rpcOk<string[]>("ia_jobs_devidos", {
    p_clinic_ids: [clinicId],
    p_incluir_teste: true,
    p_folga: "0 seconds",
  });
  return ids ?? [];
}

beforeAll(async () => {
  // Sobra de uma execucao anterior que caiu no meio: os jobs dela teriam
  // run_at ainda mais antigo que os desta e passariam na frente no claim.
  // A clinica N deixa de ser de teste no teste do agente: se a execucao
  // morreu antes do finally, ela ficou como clinica de verdade (no painel e,
  // em teste, na lista da IA). Achada pela slug E pelo nome desta suite,
  // ela sai da lista (reativada e desligada pelo caminho de sempre), volta
  // a ser de teste e so entao e apagada com as outras: o delete continua
  // so de clinica de teste.
  const { data: sobrasDeVerdade } = await admin
    .from("clinic")
    .select("id")
    .like("slug", "onda1-int-n-%")
    .like("name", "Onda1 Int N %")
    .eq("e_de_teste", false)
    .throwOnError();
  for (const { id } of (sobrasDeVerdade ?? []) as { id: string }[]) {
    await reativarSeSuspensa(id);
    await rpcOk("definir_agente_da_clinica", {
      p_clinic_id: id,
      p_estado: "desligado",
      p_motivo: "Limpeza de sobra do teste de integracao",
    });
    await admin
      .from("clinic")
      .update({ e_de_teste: true })
      .eq("id", id)
      .throwOnError();
  }
  await admin
    .from("clinic")
    .delete()
    .like("slug", "onda1-int-%")
    .eq("e_de_teste", true)
    .throwOnError();

  clinicaS = await novaClinica("S");
  clinicaT = await novaClinica("T");
  numeroS = (await criarNumeroDeTeste(admin, clinicaS, { nome: "Recepção" }))
    .id;
  numeroS2 = (await criarNumeroDeTeste(admin, clinicaS, { nome: "Segundo" }))
    .id;
  numeroT = (await criarNumeroDeTeste(admin, clinicaT, { nome: "Recepção" }))
    .id;
  contatoS = await novoContato(clinicaS, `+5584979${digitos}`);
  contatoT = await novoContato(clinicaT, `+5584970${digitos}`);

  // A IA da S como as suites a ligam (de teste: fora da lista, numero fake).
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinicaS,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de integracao da onda 1",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinicaS,
    p_whatsapp_account_id: numeroS,
    p_ativo: true,
  });
  for (const telefone of [EQ1, EQ2, EQ3]) {
    await rpcOk("definir_contato_liberado_da_ia", {
      p_clinic_id: clinicaS,
      p_telefone_e164: telefone,
      p_rotulo: "Equipe sintética",
      p_ativo: true,
      p_confirmou_aviso_da_openai: true,
    });
  }
  await admin
    .from("ai_agent_config")
    .insert({ clinic_id: clinicaS, version: 1, status: "publicada" })
    .throwOnError();
});

afterAll(async () => {
  for (const clinicId of clinicas) {
    await reativarSeSuspensa(clinicId);
  }
  for (const clinicId of clinicas) {
    await admin
      .from("job_queue")
      .update({ status: "cancelado", locked_by: null, locked_at: null })
      .eq("clinic_id", clinicId)
      .in("status", ["pendente", "executando"]);
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("suspender e reativar (as recusas com a chave da tela)", () => {
  it("motivo, clínica, nulo e reativar sem suspensão: nada gravado", async () => {
    esperaErro(
      await rpcErro("suspender_clinica", {
        p_clinic_id: clinicaS,
        p_motivo: "  ab  ",
      }),
      "22023",
      "motivo_invalido",
    );
    esperaErro(
      await rpcErro("suspender_clinica", {
        p_clinic_id: clinicaS,
        p_motivo: null,
      }),
      "22023",
      "motivo_invalido",
    );
    esperaErro(
      await rpcErro("suspender_clinica", {
        p_clinic_id: clinicaS,
        p_motivo: "x".repeat(301),
      }),
      "22023",
      "motivo_invalido",
    );
    esperaErro(
      await rpcErro("suspender_clinica", {
        p_clinic_id: crypto.randomUUID(),
        p_motivo: "Motivo de teste",
      }),
      "P0002",
    );
    esperaErro(
      await rpcErro("suspender_clinica", {
        p_clinic_id: null,
        p_motivo: "Motivo de teste",
      }),
      "22004",
    );
    esperaErro(
      await rpcErro("reativar_clinica", {
        p_clinic_id: clinicaS,
        p_motivo: "Motivo de teste",
      }),
      "P0001",
      "clinica_nao_suspensa",
    );
    expect(await suspensa(clinicaS)).toBe(false);
  });
});

describe("a conta da S suspensa e reativada", () => {
  let envS = "";
  let midiaS = "";
  let gastoS = "";
  let envT = "";
  let futuroS = "";
  let reguaS = "";
  let toqueS = "";
  let execVelhoS = "";
  let execNovoS = "";
  let midiaVelhaS = "";
  let iaS = "";
  let conversaoS = "";

  it("antes: a IA da S atende e a conversa do telefone da equipe nasce nela", async () => {
    expect(
      await rpcOk<boolean>("ia_pode_atender", {
        p_clinic_id: clinicaS,
        p_whatsapp_account_id: numeroS,
        p_phone_key: EQ1,
      }),
    ).toBe(true);
    const ingestao = await ingerir(EQ1);
    expect(ingestao.ia_atendendo).toBe(true);
    conversaDoAgente = ingestao.conversation_id!;
  });

  it("suspender: a linha, a trilha e a conversa do agente de volta para a equipe", async () => {
    await rpcOk("suspender_clinica", {
      p_clinic_id: clinicaS,
      p_motivo: "  Teste de integracao da onda 1  ",
    });
    const { data: linha } = await admin
      .from("clinica_suspensa")
      .select("motivo, suspensa_por")
      .eq("clinic_id", clinicaS)
      .single()
      .throwOnError();
    expect(linha).toEqual({
      motivo: "Teste de integracao da onda 1",
      suspensa_por: null,
    });

    const { data: trilha } = await admin
      .from("audit_log")
      .select("entity, entity_id, detalhes")
      .eq("clinic_id", clinicaS)
      .eq("action", "suspendeu_clinica")
      .throwOnError();
    expect(trilha).toEqual([
      {
        entity: "clinic",
        entity_id: clinicaS,
        detalhes: { motivo: "Teste de integracao da onda 1" },
      },
    ]);

    const { data: conversa } = await admin
      .from("conversation")
      .select("status")
      .eq("id", conversaDoAgente)
      .single()
      .throwOnError();
    expect((conversa as { status: string }).status).toBe("aguardando_humano");

    esperaErro(
      await rpcErro("suspender_clinica", {
        p_clinic_id: clinicaS,
        p_motivo: "De novo",
      }),
      "P0001",
      "clinica_ja_suspensa",
    );
    expect(await suspensa(clinicaS)).toBe(true);
    expect(await suspensa(clinicaT)).toBe(false);
  });

  it("com a S suspensa: a IA não atende, a mensagem que chega é gravada fora da IA", async () => {
    for (const funcao of ["ia_pode_atender", "ia_atende_no_whatsapp"]) {
      const args =
        funcao === "ia_pode_atender"
          ? {
              p_clinic_id: clinicaS,
              p_whatsapp_account_id: numeroS,
              p_phone_key: EQ2,
            }
          : {
              p_clinic_id: clinicaS,
              p_whatsapp_account_id: numeroS,
              p_telefone: EQ2,
            };
      expect(await rpcOk<boolean>(funcao, args), funcao).toBe(false);
    }
    const ingestao = await ingerir(EQ2);
    expect(ingestao.inserted).toBe(true);
    expect(ingestao.ia_atendendo).toBe(false);
    const { data: conversa } = await admin
      .from("conversation")
      .select("status")
      .eq("id", ingestao.conversation_id!)
      .single()
      .throwOnError();
    expect((conversa as { status: string }).status).toBe("aguardando_humano");
    const { data: mensagem } = await admin
      .from("message")
      .select("id")
      .eq("id", ingestao.message_id!)
      .throwOnError();
    expect(mensagem).toHaveLength(1);
  });

  it("com a S suspensa: o claim só pega a mídia da S (e o job da T)", async () => {
    envS = await enfileirar({
      clinicId: clinicaS,
      kind: "enviar_mensagem_ativa",
      runAt: haUmAno(0),
      numero: numeroS,
      payload: { contact_id: contatoS, body: "Teste" },
    });
    midiaS = await enfileirar({
      clinicId: clinicaS,
      kind: "baixar_midia",
      runAt: haUmAno(1),
      numero: numeroS,
    });
    gastoS = await enfileirar({
      clinicId: clinicaS,
      kind: "sincronizar_gasto_meta",
      runAt: haUmAno(2),
    });
    envT = await enfileirar({
      clinicId: clinicaT,
      kind: "enviar_mensagem_ativa",
      runAt: haUmAno(10),
      numero: numeroT,
      payload: { contact_id: contatoT, body: "Teste" },
    });
    const { meus, deFora } = await reivindicar(2, [
      "enviar_mensagem_ativa",
      "baixar_midia",
      "sincronizar_gasto_meta",
    ]);
    expect(deFora).toBe(0);
    expect(meus.map((job) => job.id).sort()).toEqual([midiaS, envT].sort());
    const estados = await jobs([envS, gastoS]);
    expect(estados.get(envS)?.status).toBe("pendente");
    expect(estados.get(gastoS)?.status).toBe("pendente");
  });

  it("com a S suspensa: ia_jobs_devidos deixa a S de fora", async () => {
    await admin
      .from("conversation")
      .update({ status: "ia_atendendo" })
      .eq("id", conversaDoAgente)
      .throwOnError();
    iaS = await enfileirar({
      clinicId: clinicaS,
      kind: "responder_com_ia",
      runAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      numero: numeroS,
      payload: { conversation_id: conversaDoAgente },
    });
    expect(await iaDevidos(clinicaS)).not.toContain(iaS);
  });

  it("reativar: cancela a mensagem vencida, deixa o futuro, a mídia, as da Meta e o executando vivo", async () => {
    const { data: regua } = await admin
      .from("cadence")
      .insert({
        clinic_id: clinicaS,
        kind: "reativacao",
        name: "Teste onda 1",
        active: false,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: passo } = await admin
      .from("cadence_step")
      .insert({
        clinic_id: clinicaS,
        cadence_id: (regua as { id: string }).id,
        offset_minutes: 0,
        fixed_body: "Teste",
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: toque } = await admin
      .from("cadence_run")
      .insert({
        clinic_id: clinicaS,
        cadence_step_id: (passo as { id: string }).id,
        contact_id: contatoS,
        scheduled_for: haUmAno(3),
      })
      .select("id")
      .single()
      .throwOnError();
    toqueS = (toque as { id: string }).id;
    reguaS = await enfileirar({
      clinicId: clinicaS,
      kind: "executar_passo_de_regua",
      runAt: haUmAno(3),
      numero: numeroS,
      payload: { cadence_run_id: toqueS },
    });
    futuroS = await enfileirar({
      clinicId: clinicaS,
      kind: "enviar_mensagem_ativa",
      runAt: new Date(Date.now() + DIA).toISOString(),
      numero: numeroS,
      payload: { contact_id: contatoS, body: "Teste" },
    });
    execVelhoS = await enfileirar({
      clinicId: clinicaS,
      kind: "enviar_mensagem_ativa",
      runAt: new Date(Date.now() - DIA).toISOString(),
      numero: numeroS,
      payload: { contact_id: contatoS, body: "Teste" },
      status: "executando",
      lockedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    execNovoS = await enfileirar({
      clinicId: clinicaS,
      kind: "enviar_mensagem_ativa",
      runAt: new Date(Date.now() - DIA).toISOString(),
      numero: numeroS,
      payload: { contact_id: contatoS, body: "Teste" },
      status: "executando",
      lockedAt: new Date().toISOString(),
    });
    midiaVelhaS = await enfileirar({
      clinicId: clinicaS,
      kind: "baixar_midia",
      runAt: new Date(Date.now() - DIA).toISOString(),
      numero: numeroS2,
    });
    // A conversao da Meta vencida durante a suspensao: nao manda mensagem
    // ao paciente, entao segue ao reativar (o job ja descarta o evento fora
    // da janela de 7 dias). Id de evento sintetico: nenhum executor roda.
    conversaoS = await enfileirar({
      clinicId: clinicaS,
      kind: "enviar_conversao_meta",
      runAt: haUmAno(4),
      payload: { conversion_event_id: crypto.randomUUID() },
    });

    const resposta = await rpcOk<{ jobs_vencidos: number }>(
      "reativar_clinica",
      {
        p_clinic_id: clinicaS,
        p_motivo: "Teste de integracao: reativacao",
      },
    );
    expect(await suspensa(clinicaS)).toBe(false);

    const { data: cancelados } = await admin
      .from("job_queue")
      .select("id")
      .eq("clinic_id", clinicaS)
      .eq("status", "cancelado")
      .eq("last_error", "vencido_na_suspensao")
      .throwOnError();
    const idsCancelados = ((cancelados ?? []) as { id: string }[]).map(
      (linha) => linha.id,
    );
    expect(idsCancelados).toEqual(
      expect.arrayContaining([envS, reguaS, execVelhoS, iaS]),
    );
    expect(idsCancelados).not.toContain(gastoS);
    expect(idsCancelados).not.toContain(conversaoS);
    expect(resposta).toEqual({ jobs_vencidos: idsCancelados.length });

    const estados = await jobs([
      futuroS,
      midiaVelhaS,
      midiaS,
      execNovoS,
      execVelhoS,
      gastoS,
      conversaoS,
    ]);
    expect(estados.get(futuroS)?.status).toBe("pendente");
    expect(estados.get(midiaVelhaS)?.status).toBe("pendente");
    // As da Meta seguem como estavam (nada se perde ao reativar).
    expect(estados.get(gastoS)).toMatchObject({
      status: "pendente",
      last_error: null,
    });
    expect(estados.get(conversaoS)).toMatchObject({
      status: "pendente",
      last_error: null,
    });
    expect(estados.get(midiaS)?.status).toBe("executando");
    expect(estados.get(execNovoS)?.status).toBe("executando");
    expect(estados.get(execVelhoS)?.locked_by).toBeNull();

    const { data: toqueFechado } = await admin
      .from("cadence_run")
      .select("sent_at, skipped_reason, motivo_da_falha")
      .eq("id", toqueS)
      .single()
      .throwOnError();
    expect(toqueFechado).toEqual({
      sent_at: null,
      skipped_reason: "falha_envio",
      motivo_da_falha: "vencido_na_suspensao",
    });

    const { data: trilha } = await admin
      .from("audit_log")
      .select("detalhes")
      .eq("clinic_id", clinicaS)
      .eq("action", "reativou_clinica")
      .throwOnError();
    expect(trilha).toEqual([
      {
        detalhes: {
          motivo: "Teste de integracao: reativacao",
          jobs_vencidos: idsCancelados.length,
        },
      },
    ]);

    esperaErro(
      await rpcErro("reativar_clinica", {
        p_clinic_id: clinicaS,
        p_motivo: "De novo",
      }),
      "P0001",
      "clinica_nao_suspensa",
    );
  });

  it("depois de reativar, a IA volta (conversa nova nasce nela; o motor a vê)", async () => {
    expect(
      await rpcOk<boolean>("ia_pode_atender", {
        p_clinic_id: clinicaS,
        p_whatsapp_account_id: numeroS,
        p_phone_key: EQ3,
      }),
    ).toBe(true);
    const ingestao = await ingerir(EQ3);
    expect(ingestao.ia_atendendo).toBe(true);
    const novo = await enfileirar({
      clinicId: clinicaS,
      kind: "responder_com_ia",
      runAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      numero: numeroS,
      payload: { conversation_id: ingestao.conversation_id },
    });
    expect(await iaDevidos(clinicaS)).toContain(novo);
  });
});

describe("painel_geral_das_clinicas pela service role", () => {
  it("o formato da função antiga e os números da S", async () => {
    const painel = await rpcOk<Record<string, unknown>>(
      "painel_geral_das_clinicas",
      {
        p_incluir_teste: true,
      },
    );
    expect(Object.keys(painel).sort()).toEqual(["clinicas", "totais"]);
    // Onda 2 (M3): os totais ganham agente_em_producao.
    const comProducao = await producaoDoAgenteAplicada();
    expect(Object.keys(painel.totais as object).sort()).toEqual([
      ...(comProducao ? ["agente_em_producao"] : []),
      "agente_em_teste",
      "ativas",
      "clinicas",
      "gasto_24h_centavos_usd",
      "gasto_mes_centavos_usd",
      "suspensas",
    ]);
    const linhas = painel.clinicas as Record<string, unknown>[];
    const s = linhas.find((linha) => linha.id === clinicaS)!;
    expect(Object.keys(s).sort()).toEqual([
      "administradores",
      "agente",
      "contatos",
      "conversas_30_dias",
      "criada_em",
      "fuso",
      "gasto",
      "id",
      "leads_30_dias",
      "membros_ativos",
      "membros_pendentes",
      "nome",
      "numeros",
      "numeros_conectados",
      "numeros_total",
      "suspensao",
      "teto_diario_centavos_usd",
      "ultima_mensagem_em",
    ]);
    expect(s.nome).toBe(`Onda1 Int S ${sufixo}`);
    expect(s.suspensao).toBeNull();
    expect(s.numeros_total).toBe(2);
    expect(s.agente).toEqual({
      estado: "desligado",
      modo: "contatos",
      liberada: true,
      pausada_pela_clinica: false,
      telefones_ligados: 3,
    });
    expect(s.teto_diario_centavos_usd).toBe(500);
    expect(s.gasto).toEqual({
      ultimas_24h_centavos_usd: 0,
      mes_centavos_usd: 0,
      ultimas_24h_sem_simulador_centavos_usd: 0,
      mes_sem_simulador_centavos_usd: 0,
    });
    // contatoS e os tres telefones da equipe que escreveram.
    expect(s.contatos).toBe(4);
    const numeros = s.numeros as {
      id: string;
      ia_ligada: boolean;
      final: string | null;
    }[];
    expect(numeros.find((n) => n.id === numeroS)?.ia_ligada).toBe(true);
    expect(numeros.find((n) => n.id === numeroS2)?.ia_ligada).toBe(false);
    // Nenhum telefone nem nome de contato no painel.
    expect(JSON.stringify(s)).not.toContain(digitos);
    expect(JSON.stringify(s)).not.toContain("Contato sintético");

    const t = linhas.find((linha) => linha.id === clinicaT)!;
    expect(t.agente).toEqual({
      estado: "desligado",
      modo: null,
      liberada: false,
      pausada_pela_clinica: false,
      telefones_ligados: 0,
    });
    expect(t.teto_diario_centavos_usd).toBeNull();

    const semTeste = await rpcOk<{ clinicas: { id: string }[] }>(
      "painel_geral_das_clinicas",
    );
    const ids = semTeste.clinicas.map((linha) => linha.id);
    expect(ids).not.toContain(clinicaS);
    expect(ids).not.toContain(clinicaT);
  });
});

describe("agente por clínica e teto", () => {
  it("recusas: clínica de teste, estado, faixas e sem liberação", async () => {
    esperaErro(
      await rpcErro("definir_agente_da_clinica", {
        p_clinic_id: clinicaS,
        p_estado: "teste",
        p_motivo: "Teste",
      }),
      "P0001",
      "clinica_de_teste",
    );
    // Onda 2 (M3): producao passa a ser um estado; numa clinica e_de_teste
    // a recusa e a da clinica de teste. Antes dela, estado invalido. Um
    // estado que nao existe e invalido nos dois.
    const comProducao = await producaoDoAgenteAplicada();
    esperaErro(
      await rpcErro("definir_agente_da_clinica", {
        p_clinic_id: clinicaS,
        p_estado: "producao",
        p_motivo: "Teste",
      }),
      comProducao ? "P0001" : "22023",
      comProducao ? "clinica_de_teste" : "estado_invalido",
    );
    esperaErro(
      await rpcErro("definir_agente_da_clinica", {
        p_clinic_id: clinicaS,
        p_estado: "no_ar",
        p_motivo: "Teste",
      }),
      "22023",
      "estado_invalido",
    );
    for (const [teto, respostas, chave] of [
      [0, 20, "teto_invalido"],
      [100001, 20, "teto_invalido"],
      [500, 0, "respostas_invalidas"],
      [500, 201, "respostas_invalidas"],
    ] as const) {
      esperaErro(
        await rpcErro("definir_teto_da_ia", {
          p_clinic_id: clinicaS,
          p_teto_diario_centavos_usd: teto,
          p_teto_respostas_por_conversa_hora: respostas,
        }),
        "22023",
        chave,
      );
    }
    esperaErro(
      await rpcErro("definir_teto_da_ia", {
        p_clinic_id: clinicaT,
        p_teto_diario_centavos_usd: 500,
        p_teto_respostas_por_conversa_hora: 20,
      }),
      "P0001",
      "sem_liberacao",
    );
    // O teto da S (de teste, liberada): passa, com a trilha.
    await rpcOk("definir_teto_da_ia", {
      p_clinic_id: clinicaS,
      p_teto_diario_centavos_usd: 800,
      p_teto_respostas_por_conversa_hora: 25,
    });
    const { data: liberacao } = await admin
      .from("ia_liberacao")
      .select("teto_diario_centavos_usd, teto_respostas_por_conversa_hora")
      .eq("clinic_id", clinicaS)
      .single()
      .throwOnError();
    expect(liberacao).toEqual({
      teto_diario_centavos_usd: 800,
      teto_respostas_por_conversa_hora: 25,
    });
    const { data: trilha } = await admin
      .from("audit_log")
      .select("detalhes")
      .eq("clinic_id", clinicaS)
      .eq("action", "mudou_teto_da_ia")
      .throwOnError();
    expect(trilha).toEqual([
      {
        detalhes: {
          teto_diario_centavos_usd: 800,
          teto_respostas_por_conversa_hora: 25,
          antes: {
            teto_diario_centavos_usd: 500,
            teto_respostas_por_conversa_hora: 20,
          },
        },
      },
    ]);
  });

  it("numa clínica que não é de teste: teste entra na lista, suspensa sai, desligado sai", async () => {
    const clinicaN = await novaClinica("N");
    const lista = async () =>
      (await rpcOk<string[]>("ia_clinicas_da_fase_controlada")).map((id) =>
        id.toLowerCase(),
      );
    try {
      await admin
        .from("clinic")
        .update({ e_de_teste: false })
        .eq("id", clinicaN)
        .throwOnError();

      await rpcOk("definir_agente_da_clinica", {
        p_clinic_id: clinicaN,
        p_estado: "teste",
        p_motivo: "Teste de integracao da onda 1",
      });
      expect(await lista()).toContain(clinicaN);
      const { data: liberacao } = await admin
        .from("ia_liberacao")
        .select("modo, liberada")
        .eq("clinic_id", clinicaN)
        .single()
        .throwOnError();
      expect(liberacao).toEqual({ modo: "contatos", liberada: true });

      await rpcOk("suspender_clinica", {
        p_clinic_id: clinicaN,
        p_motivo: "Teste de integracao da onda 1",
      });
      expect(await lista()).not.toContain(clinicaN);
      esperaErro(
        await rpcErro("definir_agente_da_clinica", {
          p_clinic_id: clinicaN,
          p_estado: "teste",
          p_motivo: "Teste",
        }),
        "P0001",
        "clinica_suspensa",
      );
      esperaErro(
        await rpcErro("definir_teto_da_ia", {
          p_clinic_id: clinicaN,
          p_teto_diario_centavos_usd: 900,
          p_teto_respostas_por_conversa_hora: 20,
        }),
        "P0001",
        "clinica_suspensa",
      );

      await rpcOk("definir_agente_da_clinica", {
        p_clinic_id: clinicaN,
        p_estado: "desligado",
        p_motivo: "Teste de integracao da onda 1",
      });
      await rpcOk("reativar_clinica", {
        p_clinic_id: clinicaN,
        p_motivo: "Teste de integracao da onda 1",
      });
      expect(await lista()).not.toContain(clinicaN);
      const { data: desligada } = await admin
        .from("ia_liberacao")
        .select("liberada")
        .eq("clinic_id", clinicaN)
        .single()
        .throwOnError();
      expect(desligada).toEqual({ liberada: false });
      const { data: trilha } = await admin
        .from("audit_log")
        .select("detalhes")
        .eq("clinic_id", clinicaN)
        .eq("action", "mudou_agente_da_clinica")
        .order("id")
        .throwOnError();
      expect(trilha).toEqual([
        {
          detalhes: {
            estado: "teste",
            motivo: "Teste de integracao da onda 1",
          },
        },
        {
          detalhes: {
            estado: "desligado",
            motivo: "Teste de integracao da onda 1",
          },
        },
      ]);
    } finally {
      await reativarSeSuspensa(clinicaN);
      await admin.rpc("definir_agente_da_clinica", {
        p_clinic_id: clinicaN,
        p_estado: "desligado",
        p_motivo: "Limpeza do teste de integracao",
      });
      await admin
        .from("clinic")
        .update({ e_de_teste: true })
        .eq("id", clinicaN);
    }
  });
});
