import { afterAll, describe, expect, it } from "vitest";

import { executarPassoDeRegua } from "@/lib/jobs/regua";
import type { Job } from "@/lib/jobs/worker";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Reguas de follow-up por etiqueta (onda 4, item 16, migration
// 20261024100000) contra o banco REAL, com service role. O que esta em jogo
// (contrato da onda 4, secao 6; decisoes D1 a D4 do dono):
//   - o lead com a etiqueta (no lead ou numa conversa dele, pelo nome)
//     recebe so a regua dela; o sem etiqueta recebe a geral;
//   - a ordem da clinica decide entre duas reguas que casam (D2);
//   - "todas" e "qualquer uma" (D6);
//   - regua com etiqueta desligada: os leads dela caem na geral (D4);
//   - etapa sem regua geral deixa o lead sem nenhuma;
//   - a etiqueta posta no meio troca no proximo toque (D3): o toque ja
//     planejado da regua que deixou de valer e pulado pelo executor
//     ('condicao_parada', a cadeia nao para), o passo ja vencido da regua
//     nova NAO nasce com o toque da outra ha menos de 30 minutos, e o
//     proximo passo dela nasce;
//   - a etiqueta numa conversa ANTIGA (resolvida) do lead tambem conta, com
//     a conversa mais recente sem etiqueta (D1: qualquer conversa);
//   - o passo que nasceu vencido da regua que passou a valer nao sai logo
//     depois do toque da que valia antes: o executor confere a trava de 30
//     minutos de novo na hora de enviar (correcao de 22/10/2026: o toque
//     antigo que ainda estava saindo quando o planejador rodou nao travava);
//   - o consentimento continua pulando ('sem_consentimento', nada sai);
//   - uma regua sem etiqueta por etapa (o estado de hoje) da exatamente o
//     conjunto de toques de antes, e o planejador cria exatamente essas runs
//     (uma vez so).
// AS REGUAS NASCEM DESLIGADAS e so ligam (ligar) depois que os leads estao
// montados (correcao de 22/10/2026): o planejar_reguas do cron roda a cada
// minuto e nao filtra clinica de teste; com a regua ligada antes, ele podia
// rodar entre o insert do lead (relogio da etapa = agora) e o recuo do
// relogio, e criar runs ancoradas no horario do insert, que quebrariam as
// comparacoes exatas de runs.
// O conjunto de toques e lido de followups_devidos(clinica) (so leitura, so
// a service role), a mesma funcao que planejar_reguas usa. Os testes que
// precisam de toque de verdade (o executor) chamam planejar_reguas(), como
// tests/integration/followup.test.ts: e a mesma chamada que o pg_cron faz a
// cada minuto, idempotente (o UNIQUE de cadence_run), e as clinicas
// e_de_teste nao sao reivindicadas pelo motor de producao, entao os jobs
// daqui so rodam pelo executor chamado neste arquivo (numero fake).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste, contatos
// sinteticos com telefone ficticio, apagadas no afterAll. Nada aqui usa a id
// da salud-care, da teste123 nem da Conduzza Teste. ESCRITO NA ONDA 4 E
// AINDA NAO RODADO (roda depois de aplicar a migration, com ok: npm run
// test:integration -- followup-por-etiqueta).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'fup-etq-%';
//   delete from public.clinic where slug like 'fup-etq-%';

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 10_000).padStart(4, "0");
const clinicasCriadas: string[] = [];
const MINUTO = 60_000;
const WORKER = `teste-fup-etq-${sufixo}`;

const JANELA_ABERTA = {
  send_window_start: "00:00",
  send_window_end: "23:59",
  send_weekdays: [0, 1, 2, 3, 4, 5, 6],
};

type Devido = { step_id: string; contact_id: string; scheduled_for: string };
type Run = {
  id: string;
  cadence_step_id: string;
  sent_at: string | null;
  skipped_reason: string | null;
};

let contadorDeTelefone = 0;
function telefone(): string {
  contadorDeTelefone += 1;
  return `+5584971${digitos}${String(contadorDeTelefone).padStart(2, "0")}`;
}

async function novaClinica(
  nome: string,
): Promise<{ clinicId: string; numero: string }> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Fup etq ${nome} ${sufixo}`,
      slug: `fup-etq-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = (data as { id: string }).id;
  clinicasCriadas.push(clinicId);
  await admin
    .from("funnel_stage_def")
    .insert([
      { clinic_id: clinicId, chave: "e1", nome: "Etapa E1", posicao: 61 },
      { clinic_id: clinicId, chave: "e2", nome: "Etapa E2", posicao: 62 },
    ])
    .throwOnError();
  await admin
    .from("conversation_tag_def")
    .insert({ clinic_id: clinicId, chave: "psiq", nome: "Psiquiatria" })
    .throwOnError();
  const numero = (await criarNumeroDeTeste(admin, clinicId)).id;
  return { clinicId, numero };
}

/**
 * Regua de follow-up DESLIGADA, janela aberta, com os passos dados. Liga com
 * `ligar`, depois de montar os leads.
 */
async function novaRegua(
  clinicId: string,
  campos: {
    nome: string;
    etapa: string;
    offsets: number[];
    etiquetas?: string[];
    modo?: "qualquer" | "todas";
    prioridade?: number;
  },
): Promise<{ id: string; passos: Map<number, string> }> {
  const { data } = await admin
    .from("cadence")
    .insert({
      clinic_id: clinicId,
      kind: "followup",
      name: campos.nome,
      trigger_stage: campos.etapa,
      active: false,
      ...JANELA_ABERTA,
      etiquetas: campos.etiquetas ?? [],
      etiquetas_modo: campos.modo ?? "qualquer",
      prioridade: campos.prioridade ?? 0,
    })
    .select("id")
    .single()
    .throwOnError();
  const id = (data as { id: string }).id;
  const { data: passos } = await admin
    .from("cadence_step")
    .insert(
      campos.offsets.map((offset) => ({
        clinic_id: clinicId,
        cadence_id: id,
        offset_minutes: offset,
        fixed_body: `Oi, {{nome}}! Passo ${offset} da ${campos.nome}.`,
      })),
    )
    .select("id, offset_minutes")
    .throwOnError();
  return {
    id,
    passos: new Map(
      ((passos ?? []) as { id: string; offset_minutes: number }[]).map((p) => [
        p.offset_minutes,
        p.id,
      ]),
    ),
  };
}

/** Liga as reguas dadas (depois de os leads estarem montados). */
async function ligar(...reguas: { id: string }[]): Promise<void> {
  await admin
    .from("cadence")
    .update({ active: true })
    .in(
      "id",
      reguas.map((regua) => regua.id),
    )
    .throwOnError();
}

/** Lead sintetico na etapa ha `minutos`, com consentimento (salvo o dito). */
async function novoLead(
  clinicId: string,
  etapa: string,
  minutos: number,
  opcoes: { etiquetas?: string[]; consentimento?: boolean; kind?: string } = {},
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone(),
      name: "Lead Etiqueta",
      kind: opcoes.kind ?? "lead",
      funnel_stage: etapa,
      tags: opcoes.etiquetas ?? [],
    })
    .select("id")
    .single()
    .throwOnError();
  const contactId = (data as { id: string }).id;
  if (opcoes.consentimento ?? true) {
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
  // Viagem no tempo: a coluna aceita escrita direta do servico.
  await admin
    .from("contact")
    .update({
      created_at: new Date(Date.now() - 30 * 24 * 60 * MINUTO).toISOString(),
      funnel_stage_changed_at: new Date(
        Date.now() - minutos * MINUTO,
      ).toISOString(),
    })
    .eq("id", contactId)
    .throwOnError();
  return contactId;
}

/** Os toques devidos da clinica, como "contato:passo". */
async function devidos(clinicId: string): Promise<Devido[]> {
  const { data, error } = await admin.rpc("followups_devidos", {
    p_clinic_id: clinicId,
  });
  expect(error).toBeNull();
  return (data ?? []) as Devido[];
}

async function devidosDe(
  clinicId: string,
  contactId: string,
): Promise<string[]> {
  return (await devidos(clinicId))
    .filter((d) => d.contact_id === contactId)
    .map((d) => d.step_id)
    .sort();
}

async function reguaQueVale(contactId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("regua_de_followup_do_contato", {
    p_contact_id: contactId,
  });
  expect(error).toBeNull();
  return (data as string | null) ?? null;
}

async function planejar(): Promise<void> {
  const { error } = await admin.rpc("planejar_reguas");
  expect(error).toBeNull();
}

async function runsDoContato(
  clinicId: string,
  contactId: string,
): Promise<Run[]> {
  const { data } = await admin
    .from("cadence_run")
    .select("id, cadence_step_id, sent_at, skipped_reason")
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .order("scheduled_for")
    .throwOnError();
  return (data ?? []) as Run[];
}

/** Executa o job REAL da run (o que o motor faria), com a posse do job. */
async function executarJobDaRun(clinicId: string, runId: string) {
  const { data: jobs } = await admin
    .from("job_queue")
    .select("id, clinic_id, kind, payload, attempts, max_attempts")
    .eq("clinic_id", clinicId)
    .eq("kind", "executar_passo_de_regua")
    .contains("payload", { cadence_run_id: runId })
    .throwOnError();
  expect(jobs).toHaveLength(1);
  const job = (jobs ?? [])[0] as unknown as Job;
  await admin
    .from("job_queue")
    .update({
      status: "executando",
      locked_by: WORKER,
      locked_at: new Date().toISOString(),
      attempts: job.attempts + 1,
    })
    .eq("id", job.id)
    .eq("status", "pendente")
    .throwOnError();
  return executarPassoDeRegua(admin, job, WORKER);
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("a regua que vale para cada lead (D1, D2, D4, D6)", () => {
  it("com a etiqueta no lead ou na conversa, so a regua dela; sem etiqueta, a geral", async () => {
    const { clinicId, numero } = await novaClinica("vale");
    const geral = await novaRegua(clinicId, {
      nome: "Geral",
      etapa: "e1",
      offsets: [0],
    });
    const psiq = await novaRegua(clinicId, {
      nome: "Psiquiatria",
      etapa: "e1",
      offsets: [0],
      etiquetas: ["Psiquiatria"],
    });
    const doLead = await novoLead(clinicId, "e1", 5, {
      etiquetas: ["psiquiatría"],
    });
    const daConversa = await novoLead(clinicId, "e1", 5);
    await admin
      .from("conversation")
      .insert({
        clinic_id: clinicId,
        contact_id: daConversa,
        whatsapp_account_id: numero,
        tags: ["psiq"],
      })
      .throwOnError();
    const semEtiqueta = await novoLead(clinicId, "e1", 5);
    // D1, qualquer conversa: a etiqueta so na conversa ANTIGA (resolvida); a
    // mais recente, aberta, sem etiqueta.
    const naConversaAntiga = await novoLead(clinicId, "e1", 5);
    await admin
      .from("conversation")
      .insert({
        clinic_id: clinicId,
        contact_id: naConversaAntiga,
        whatsapp_account_id: numero,
        tags: ["psiq"],
        status: "resolvida",
        last_message_at: new Date(Date.now() - 48 * 60 * MINUTO).toISOString(),
      })
      .throwOnError();
    await admin
      .from("conversation")
      .insert({
        clinic_id: clinicId,
        contact_id: naConversaAntiga,
        whatsapp_account_id: numero,
        last_message_at: new Date(Date.now() - 60 * MINUTO).toISOString(),
      })
      .throwOnError();
    await ligar(geral, psiq);

    expect(await reguaQueVale(doLead)).toBe(psiq.id);
    expect(await reguaQueVale(daConversa)).toBe(psiq.id);
    expect(await reguaQueVale(naConversaAntiga)).toBe(psiq.id);
    expect(await reguaQueVale(semEtiqueta)).toBe(geral.id);
    expect(await devidosDe(clinicId, doLead)).toEqual([psiq.passos.get(0)]);
    expect(await devidosDe(clinicId, daConversa)).toEqual([psiq.passos.get(0)]);
    expect(await devidosDe(clinicId, naConversaAntiga)).toEqual([
      psiq.passos.get(0),
    ]);
    expect(await devidosDe(clinicId, semEtiqueta)).toEqual([
      geral.passos.get(0),
    ]);

    // D4: a regua com etiqueta desligada nao conta; os leads dela caem na
    // geral.
    await admin
      .from("cadence")
      .update({ active: false })
      .eq("id", psiq.id)
      .throwOnError();
    expect(await reguaQueVale(doLead)).toBe(geral.id);
    expect(await devidosDe(clinicId, doLead)).toEqual([geral.passos.get(0)]);
  });

  it("duas reguas que casam: vale a de cima na ordem da clinica; todas e qualquer uma", async () => {
    const { clinicId } = await novaClinica("ordem");
    const geral = await novaRegua(clinicId, {
      nome: "Geral",
      etapa: "e1",
      offsets: [0],
    });
    const psiq = await novaRegua(clinicId, {
      nome: "Psiquiatria",
      etapa: "e1",
      offsets: [0],
      etiquetas: ["Psiquiatria"],
      prioridade: 1,
    });
    const odonto = await novaRegua(clinicId, {
      nome: "Odontologia",
      etapa: "e1",
      offsets: [0],
      etiquetas: ["Odontologia"],
      prioridade: 2,
    });
    const asDuas = await novaRegua(clinicId, {
      nome: "As duas",
      etapa: "e1",
      offsets: [0],
      etiquetas: ["Psiquiatria", "Odontologia"],
      modo: "todas",
      prioridade: 3,
    });
    const comAsDuas = await novoLead(clinicId, "e1", 5, {
      etiquetas: ["Psiquiatria", "Odontologia"],
    });
    const soPsiq = await novoLead(clinicId, "e1", 5, {
      etiquetas: ["Psiquiatria"],
    });
    await ligar(geral, psiq, odonto, asDuas);
    expect(await reguaQueVale(comAsDuas)).toBe(psiq.id);

    // A clinica reordena: Odontologia passa para cima.
    const { error } = await admin.rpc("ordenar_reguas_de_followup", {
      p_clinic_id: clinicId,
      p_trigger_stage: "e1",
      p_ids: [odonto.id, psiq.id, asDuas.id],
    });
    expect(error).toBeNull();
    expect(await reguaQueVale(comAsDuas)).toBe(odonto.id);

    // "Todas": so vale para quem tem as duas; posta no topo, ganha delas.
    const { error: erroDoTopo } = await admin.rpc(
      "ordenar_reguas_de_followup",
      {
        p_clinic_id: clinicId,
        p_trigger_stage: "e1",
        p_ids: [asDuas.id, odonto.id, psiq.id],
      },
    );
    expect(erroDoTopo).toBeNull();
    expect(await reguaQueVale(comAsDuas)).toBe(asDuas.id);
    expect(await reguaQueVale(soPsiq)).toBe(psiq.id);
  });

  it("etapa sem regua geral: o lead sem etiqueta fica sem nenhuma", async () => {
    const { clinicId } = await novaClinica("sem-geral");
    const psiq = await novaRegua(clinicId, {
      nome: "Psiquiatria de E2",
      etapa: "e2",
      offsets: [0],
      etiquetas: ["Psiquiatria"],
    });
    const semEtiqueta = await novoLead(clinicId, "e2", 5);
    await ligar(psiq);
    expect(await reguaQueVale(semEtiqueta)).toBeNull();
    expect(await devidosDe(clinicId, semEtiqueta)).toEqual([]);
  });
});

describe("a etiqueta posta no meio e o consentimento, com o executor", () => {
  it("troca no proximo toque: o da regua velha e pulado e o passo vencido da nova nao repete em 30 minutos", async () => {
    const { clinicId } = await novaClinica("troca");
    const geral = await novaRegua(clinicId, {
      nome: "Geral",
      etapa: "e1",
      offsets: [0, 50],
    });
    const psiq = await novaRegua(clinicId, {
      nome: "Psiquiatria",
      etapa: "e1",
      offsets: [0, 50],
      etiquetas: ["Psiquiatria"],
    });
    // Entrou ha 5 minutos sem etiqueta: a geral planeja o passo 0 (vencido) e
    // o 50 (daqui a 45 minutos).
    const lead = await novoLead(clinicId, "e1", 5);
    await ligar(geral, psiq);
    await planejar();
    const antes = await runsDoContato(clinicId, lead);
    expect(antes.map((run) => run.cadence_step_id)).toEqual([
      geral.passos.get(0),
      geral.passos.get(50),
    ]);
    expect(await executarJobDaRun(clinicId, antes[0]!.id)).toEqual({
      ok: true,
    });
    expect((await runsDoContato(clinicId, lead))[0]!.sent_at).not.toBeNull();

    // A etiqueta chega agora: vale a regua de Psiquiatria.
    await admin
      .from("contact")
      .update({ tags: ["Psiquiatria"] })
      .eq("id", lead)
      .throwOnError();
    expect(await reguaQueVale(lead)).toBe(psiq.id);
    // O passo 0 dela ja venceu e o lead recebeu o da geral ha menos de 30
    // minutos: nao nasce (sem toque repetido). O passo 50 dela, futuro, nasce.
    expect(await devidosDe(clinicId, lead)).toEqual([psiq.passos.get(50)]);
    await planejar();
    // O toque ja planejado da geral (passo 50) deixou de valer: o executor o
    // pula, sem parar a cadeia nem mandar nada.
    const runGeral50 = (await runsDoContato(clinicId, lead)).find(
      (run) => run.cadence_step_id === geral.passos.get(50),
    );
    expect(await executarJobDaRun(clinicId, runGeral50!.id)).toEqual({
      ok: true,
    });
    // (O passo 50 das duas reguas tem o mesmo horario: compara por passo.)
    const depois = new Map(
      (await runsDoContato(clinicId, lead)).map((run) => [
        run.cadence_step_id,
        { enviada: run.sent_at !== null, pulada: run.skipped_reason },
      ]),
    );
    expect(depois).toEqual(
      new Map([
        [geral.passos.get(0), { enviada: true, pulada: null }],
        [geral.passos.get(50), { enviada: false, pulada: "condicao_parada" }],
        [psiq.passos.get(50), { enviada: false, pulada: null }],
      ]),
    );
    const { count } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("direction", "saida");
    expect(count).toBe(1);
  });

  it("o passo que nasceu vencido da regua nova nao sai logo depois do toque da que valia: a trava na hora de enviar", async () => {
    const { clinicId, numero } = await novaClinica("trava-envio");
    const geral = await novaRegua(clinicId, {
      nome: "Geral",
      etapa: "e1",
      offsets: [0],
    });
    const psiq = await novaRegua(clinicId, {
      nome: "Psiquiatria",
      etapa: "e1",
      offsets: [0],
      etiquetas: ["Psiquiatria"],
    });
    const lead = await novoLead(clinicId, "e1", 5);
    await ligar(geral, psiq);
    await planejar();
    const [daGeral] = await runsDoContato(clinicId, lead);
    expect(daGeral?.cadence_step_id).toBe(geral.passos.get(0));
    // O toque da geral sai (sem etiqueta, ela vale).
    expect(await executarJobDaRun(clinicId, daGeral!.id)).toEqual({ ok: true });

    // A corrida: a etiqueta chegou e o planejador rodou ENQUANTO o toque da
    // geral ainda saia (sem sent_at): o passo 0 da Psiquiatria, ja vencido,
    // nasceu, porque a trava do planejador so ve toque enviado. A run e o
    // job sao montados como o planejador os grava (o PostgREST nao segura a
    // corrida de verdade).
    await admin
      .from("contact")
      .update({ tags: ["Psiquiatria"] })
      .eq("id", lead)
      .throwOnError();
    expect(await reguaQueVale(lead)).toBe(psiq.id);
    // Com o toque ja gravado, o planejador nao o cria (a trava dele).
    expect(await devidosDe(clinicId, lead)).toEqual([]);
    const { data: contato } = await admin
      .from("contact")
      .select("funnel_stage_changed_at")
      .eq("id", lead)
      .single()
      .throwOnError();
    const { data: corrida } = await admin
      .from("cadence_run")
      .insert({
        clinic_id: clinicId,
        cadence_step_id: psiq.passos.get(0),
        contact_id: lead,
        scheduled_for: (contato as { funnel_stage_changed_at: string })
          .funnel_stage_changed_at,
      })
      .select("id")
      .single()
      .throwOnError();
    const runDaCorrida = (corrida as { id: string }).id;
    await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "executar_passo_de_regua",
        payload: { cadence_run_id: runDaCorrida },
        run_at: new Date().toISOString(),
        prioridade: 1,
        whatsapp_account_id: numero,
      })
      .throwOnError();

    // O executor confere a trava de novo, agora com o toque da geral
    // gravado: pula so esta run, sem mandar.
    expect(await executarJobDaRun(clinicId, runDaCorrida)).toEqual({
      ok: true,
    });
    const depois = new Map(
      (await runsDoContato(clinicId, lead)).map((run) => [
        run.cadence_step_id,
        { enviada: run.sent_at !== null, pulada: run.skipped_reason },
      ]),
    );
    expect(depois).toEqual(
      new Map([
        [geral.passos.get(0), { enviada: true, pulada: null }],
        [psiq.passos.get(0), { enviada: false, pulada: "condicao_parada" }],
      ]),
    );
    const { count } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("direction", "saida");
    expect(count).toBe(1);
  });

  it("sem autorizacao para receber mensagens, o toque da regua por etiqueta e pulado", async () => {
    const { clinicId } = await novaClinica("consentimento");
    const psiq = await novaRegua(clinicId, {
      nome: "Psiquiatria",
      etapa: "e1",
      offsets: [0],
      etiquetas: ["Psiquiatria"],
    });
    const lead = await novoLead(clinicId, "e1", 5, {
      etiquetas: ["Psiquiatria"],
      consentimento: false,
    });
    await ligar(psiq);
    await planejar();
    const [run] = await runsDoContato(clinicId, lead);
    expect(run?.cadence_step_id).toBe(psiq.passos.get(0));
    expect(await executarJobDaRun(clinicId, run!.id)).toEqual({ ok: true });
    const [depois] = await runsDoContato(clinicId, lead);
    expect(depois?.skipped_reason).toBe("sem_consentimento");
    expect(depois?.sent_at).toBeNull();
    const { count } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("direction", "saida");
    expect(count).toBe(0);
  });
});

describe("paridade: uma regua sem etiqueta por etapa (o estado de hoje)", () => {
  it("os toques devidos e as runs do planejador sao exatamente os de antes", async () => {
    const { clinicId } = await novaClinica("paridade");
    const g1 = await novaRegua(clinicId, {
      nome: "Geral de E1",
      etapa: "e1",
      offsets: [0, 60],
    });
    const g2 = await novaRegua(clinicId, {
      nome: "Geral de E2",
      etapa: "e2",
      offsets: [30],
    });
    // A regra de antes: entrada + offset entre 30 minutos atras e 60 para a
    // frente, sem resposta desde a entrada, fora o importado parado, sem
    // olhar o tipo do contato. Os casos ficam longe das bordas da janela.
    const a1 = await novoLead(clinicId, "e1", 10); // 0 (-10) e 60 (+50)
    const a2 = await novoLead(clinicId, "e1", 45); // so o 60 (+15)
    const a3 = await novoLead(clinicId, "e1", 10); // respondeu: nada
    await admin
      .from("contact")
      .update({
        last_contact_at: new Date(Date.now() - 2 * MINUTO).toISOString(),
      })
      .eq("id", a3)
      .throwOnError();
    const a4 = await novoLead(clinicId, "e1", 10); // importado parado: nada
    await admin
      .from("contact")
      .update({
        criado_por_importacao: true,
        created_at: new Date(Date.now() - 10 * MINUTO).toISOString(),
      })
      .eq("id", a4)
      .throwOnError();
    const a5 = await novoLead(clinicId, "e2", 20); // o 30 (+10)
    const a6 = await novoLead(clinicId, "e2", 200); // nada na janela
    const paciente = await novoLead(clinicId, "e1", 10, { kind: "paciente" }); // 0 e 60
    await ligar(g1, g2);

    const esperado = [
      `${a1}:${g1.passos.get(0)}`,
      `${a1}:${g1.passos.get(60)}`,
      `${a2}:${g1.passos.get(60)}`,
      `${a5}:${g2.passos.get(30)}`,
      `${paciente}:${g1.passos.get(0)}`,
      `${paciente}:${g1.passos.get(60)}`,
    ].sort();
    const obtido = (await devidos(clinicId))
      .map((d) => `${d.contact_id}:${d.step_id}`)
      .sort();
    expect(obtido).toEqual(esperado);
    for (const contato of [a1, a2, a3, a4, paciente]) {
      expect(await reguaQueVale(contato)).toBe(g1.id);
    }
    for (const contato of [a5, a6]) {
      expect(await reguaQueVale(contato)).toBe(g2.id);
    }

    // E as runs que o planejador cria sao exatamente essas (uma por toque;
    // planejar de novo nao repete).
    await planejar();
    await planejar();
    const { data: runs } = await admin
      .from("cadence_run")
      .select("contact_id, cadence_step_id")
      .eq("clinic_id", clinicId)
      .throwOnError();
    expect(
      ((runs ?? []) as { contact_id: string; cadence_step_id: string }[])
        .map((run) => `${run.contact_id}:${run.cadence_step_id}`)
        .sort(),
    ).toEqual(esperado);
  });
});
