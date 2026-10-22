import { afterAll, describe, expect, it } from "vitest";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Automacoes compostas (onda 4, itens 14 e 15, migration 20261024110000)
// contra o banco REAL, com service role. O que esta em jogo (contrato da
// onda 4, secao 6; decisoes D5 a D7 e D9 do dono):
//   - varias acoes na ordem da posicao, com o mover sempre por ultimo (a
//     trilha de sistema na ordem) e o retrato de cada acao;
//   - condicoes "todas" (E) e "qualquer uma" (OU), com a etiqueta do lead e
//     a da conversa (pelo nome), inclusive so numa conversa ANTIGA e
//     resolvida, com a mais recente sem etiqueta (D1: qualquer conversa); a
//     que nao bate pula aquela entrada com o motivo condicoes_nao_atendidas;
//   - idempotencia por acao: a execucao feita pela metade (a acao com
//     retrato numa passagem anterior) nao repete a acao feita, e a condicao
//     nao e conferida de novo ao retomar;
//   - a automacao de hoje (uma acao, gravada pelas colunas de antes; o
//     espelho a leva para a posicao 1) executa e grava o historico igual a
//     antes;
//   - ciclo com o mover numa acao (pela RPC e pela escrita de antes) e
//     recusado;
//   - clinica suspensa: o planejador registra a execucao ja pulada
//     (clinica_suspensa), o executor fecha a pendente como pulada, nada e
//     feito, e na volta nada roda atrasado.
// Cada cenario chama planejar e executar com p_clinic_id e
// p_incluir_teste=true (o cron de producao nao pega clinica de teste). A
// execucao feita pela metade e montada como a trava da conversa a deixa (o
// caminho de verdade, com duas sessoes, esta provado no harness da onda 4,
// scratchpad/onda4-banco/harness/contencao.sh: o PostgREST nao segura uma
// transacao aberta entre duas chamadas). Nenhuma acao manda mensagem ao
// paciente (as notas sao internas).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste, contatos
// sinteticos com telefone ficticio, apagadas no afterAll (a suspensao vai
// junto). Nada aqui usa a id da salud-care, da teste123 nem da Conduzza
// Teste. ESCRITO NA ONDA 4 E AINDA NAO RODADO (roda depois de aplicar as
// migrations, com ok: npm run test:integration -- automacoes-compostas).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'compostas-int-%';
//   delete from public.clinic where slug like 'compostas-int-%';

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 10_000).padStart(4, "0");
const clinicasCriadas: string[] = [];
const HORA_MS = 60 * 60_000;

type Resultado = {
  executadas: number;
  puladas: number;
  falhas: number;
  adiadas: number;
};
type Erro = { code?: string; message?: string; hint?: string | null } | null;
type Execucao = {
  id: string;
  contact_id: string;
  status: string;
  motivo: string | null;
  para_etapa: string | null;
  acao: string | null;
  etiqueta: string | null;
  etiqueta_nome: string | null;
  conversation_id: string | null;
  atividade_id: string | null;
};
type RetratoDaAcao = {
  posicao: number;
  acao: string;
  status: string;
  motivo: string | null;
  para_etapa: string | null;
  etiqueta: string | null;
  etiqueta_nome: string | null;
  atividade_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
};

const atras = (horas: number) =>
  new Date(Date.now() - horas * HORA_MS).toISOString();

let contadorDeTelefone = 0;
function telefone(): string {
  contadorDeTelefone += 1;
  return `+5584970${digitos}${String(contadorDeTelefone).padStart(2, "0")}`;
}

async function novaClinica(
  nome: string,
): Promise<{ clinicId: string; numero: string }> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Compostas Int ${nome} ${sufixo}`,
      slug: `compostas-int-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = (data as { id: string }).id;
  clinicasCriadas.push(clinicId);
  await admin
    .from("funnel_stage_def")
    .insert(
      ["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8"].map((chave, i) => ({
        clinic_id: clinicId,
        chave,
        nome: `Etapa ${chave}`,
        posicao: 61 + i,
      })),
    )
    .throwOnError();
  await admin
    .from("conversation_tag_def")
    .insert({ clinic_id: clinicId, chave: "odonto", nome: "Odontologia" })
    .throwOnError();
  const numero = (await criarNumeroDeTeste(admin, clinicId)).id;
  return { clinicId, numero };
}

/** Grava pela RPC (o caminho do codigo novo) e recua a vigencia. */
async function salvar(
  clinicId: string,
  regra: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin.rpc("salvar_automacao_de_fluxo", {
    p_clinic_id: clinicId,
    p_id: null,
    p_regra: {
      ativa: true,
      gatilho: "tempo_na_etapa",
      espera_minutos: 60,
      combinar: "todas",
      condicoes: [],
      ...regra,
    },
  });
  expect(error).toBeNull();
  const id = data as string;
  await admin
    .from("automacao_fluxo")
    .update({ vigente_desde: atras(24) })
    .eq("id", id)
    .throwOnError();
  return id;
}

/** Lead nascido ha 30 dias, na etapa ha `horas`, com as etiquetas dadas. */
async function novoLead(
  clinicId: string,
  etapa: string,
  horas: number,
  etiquetas: string[] = [],
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone(),
      name: "Lead Composta",
      kind: "lead",
      funnel_stage: etapa,
      tags: etiquetas,
    })
    .select("id")
    .single()
    .throwOnError();
  const contactId = (data as { id: string }).id;
  await admin
    .from("contact")
    .update({
      created_at: atras(30 * 24),
      funnel_stage_changed_at: atras(horas),
    })
    .eq("id", contactId)
    .throwOnError();
  return contactId;
}

async function novaConversa(
  clinicId: string,
  contactId: string,
  numero: string,
  etiquetas: string[] = [],
): Promise<string> {
  const { data } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      whatsapp_account_id: numero,
      last_message_at: atras(1),
      tags: etiquetas,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function planejar(clinicId: string): Promise<number> {
  const { data, error } = await admin.rpc("planejar_automacoes_de_fluxo", {
    p_clinic_id: clinicId,
    p_incluir_teste: true,
  });
  expect(error).toBeNull();
  return data as number;
}

async function executar(clinicId: string): Promise<Resultado> {
  const { data, error } = await admin.rpc("executar_automacoes_de_fluxo", {
    p_clinic_id: clinicId,
    p_incluir_teste: true,
  });
  expect(error).toBeNull();
  return data as Resultado;
}

async function execucoes(regraId: string): Promise<Execucao[]> {
  const { data } = await admin
    .from("automacao_execucao")
    .select(
      "id, contact_id, status, motivo, para_etapa, acao, etiqueta, etiqueta_nome, conversation_id, atividade_id",
    )
    .eq("automacao_id", regraId)
    .order("created_at")
    .throwOnError();
  return (data ?? []) as Execucao[];
}

async function retratos(execucaoId: string): Promise<RetratoDaAcao[]> {
  const { data } = await admin
    .from("automacao_execucao_acao")
    .select(
      "posicao, acao, status, motivo, para_etapa, etiqueta, etiqueta_nome, atividade_id, conversation_id, message_id",
    )
    .eq("execucao_id", execucaoId)
    .order("posicao")
    .throwOnError();
  return (data ?? []) as RetratoDaAcao[];
}

async function etapaDe(contactId: string): Promise<string> {
  const { data } = await admin
    .from("contact")
    .select("funnel_stage")
    .eq("id", contactId)
    .single()
    .throwOnError();
  return (data as { funnel_stage: string }).funnel_stage;
}

async function etiquetasDaConversa(conversaId: string): Promise<string[]> {
  const { data } = await admin
    .from("conversation")
    .select("tags")
    .eq("id", conversaId)
    .single()
    .throwOnError();
  return (data as { tags: string[] }).tags;
}

async function atividadesDe(contactId: string): Promise<number> {
  const { count } = await admin
    .from("contact_activity")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId);
  return count ?? 0;
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("varias acoes", () => {
  it("rodam na ordem da posicao, com o mover por ultimo, cada uma com o retrato", async () => {
    const { clinicId, numero } = await novaClinica("ordem");
    // O mover vem primeiro na lista e roda por ultimo (D7).
    const regra = await salvar(clinicId, {
      nome: "Quatro acoes",
      etapa: "k1",
      acoes: [
        { acao: "mover_etapa", etapa_destino: "k2" },
        {
          acao: "criar_atividade",
          atividade_titulo: "Ligar",
          atividade_prazo_dias: 0,
        },
        { acao: "etiquetar", etiqueta: "urgente" },
        { acao: "nota_interna", nota_texto: "Conferir o convênio." },
      ],
    });
    const lead = await novoLead(clinicId, "k1", 2);
    const conversa = await novaConversa(clinicId, lead, numero);

    expect(await planejar(clinicId)).toBe(1);
    expect(await executar(clinicId)).toMatchObject({
      executadas: 1,
      falhas: 0,
    });

    const [execucao] = await execucoes(regra);
    // Com varias acoes, o retrato fica por acao (o pai nao tem uma acao so).
    expect(execucao).toMatchObject({
      status: "executada",
      motivo: null,
      para_etapa: "k2",
      acao: null,
      etiqueta: null,
      atividade_id: null,
    });
    const porAcao = await retratos(execucao!.id);
    expect(porAcao.map((r) => [r.posicao, r.acao, r.status])).toEqual([
      [1, "mover_etapa", "executada"],
      [2, "criar_atividade", "executada"],
      [3, "etiquetar", "executada"],
      [4, "nota_interna", "executada"],
    ]);
    expect(porAcao[0]?.para_etapa).toBe("k2");
    expect(porAcao[1]?.atividade_id).not.toBeNull();
    expect(porAcao[2]).toMatchObject({
      etiqueta: "urgente",
      conversation_id: conversa,
    });
    expect(porAcao[3]?.message_id).not.toBeNull();

    // O lead andou, a etiqueta entrou, uma atividade e uma nota interna.
    expect(await etapaDe(lead)).toBe("k2");
    expect(await etiquetasDaConversa(conversa)).toEqual(["urgente"]);
    expect(await atividadesDe(lead)).toBe(1);
    const { data: notas } = await admin
      .from("message")
      .select("is_internal_note, author, billable")
      .eq("conversation_id", conversa)
      .throwOnError();
    expect(notas).toEqual([
      { is_internal_note: true, author: "sistema", billable: false },
    ]);

    // A trilha de sistema na ordem em que as acoes rodaram.
    const { data: trilha } = await admin
      .from("audit_log")
      .select("action, user_id")
      .eq("clinic_id", clinicId)
      .like("action", "automacao%")
      .order("id")
      .throwOnError();
    expect(trilha).toEqual([
      { action: "automacao_criou_atividade", user_id: null },
      { action: "automacao_etiquetou", user_id: null },
      { action: "automacao_anotou", user_id: null },
      { action: "automacao_moveu_etapa", user_id: null },
    ]);
  });
});

describe("condicoes (D5, D6, D9)", () => {
  it("todas e qualquer uma, com a etiqueta do lead e a da conversa; a que nao bate pula com o motivo", async () => {
    const { clinicId, numero } = await novaClinica("condicoes");
    const nota = [{ acao: "nota_interna", nota_texto: "Lead da regra." }];
    const todas = await salvar(clinicId, {
      nome: "Psiquiatria sem Odontologia",
      etapa: "k3",
      combinar: "todas",
      condicoes: [
        { tipo: "tem_etiqueta", etiqueta: "Psiquiatria" },
        { tipo: "nao_tem_etiqueta", etiqueta: "odontologia" },
      ],
      acoes: nota,
    });
    const qualquer = await salvar(clinicId, {
      nome: "Psiquiatria ou Odontologia",
      etapa: "k4",
      combinar: "qualquer",
      condicoes: [
        { tipo: "tem_etiqueta", etiqueta: "Psiquiatria" },
        { tipo: "tem_etiqueta", etiqueta: "Odontologia" },
      ],
      acoes: nota,
    });
    // K3: so a etiqueta do lead (casa); a do lead e a Odontologia da
    // conversa (nao casa: "nao tem"); nenhuma (nao casa).
    const so = await novoLead(clinicId, "k3", 2, ["psiquiatria"]);
    await novaConversa(clinicId, so, numero);
    const comOdonto = await novoLead(clinicId, "k3", 2, ["Psiquiatria"]);
    await novaConversa(clinicId, comOdonto, numero, ["odonto"]);
    const nenhuma = await novoLead(clinicId, "k3", 2);
    await novaConversa(clinicId, nenhuma, numero);
    // K4: a Odontologia so na conversa (casa); nenhuma (nao casa); a
    // Odontologia so numa conversa ANTIGA, resolvida, com a mais recente
    // aberta e sem etiqueta (casa: D1, qualquer conversa do lead).
    const daConversa = await novoLead(clinicId, "k4", 2);
    await novaConversa(clinicId, daConversa, numero, ["odonto"]);
    const nadaK4 = await novoLead(clinicId, "k4", 2);
    await novaConversa(clinicId, nadaK4, numero);
    const naAntiga = await novoLead(clinicId, "k4", 2);
    await admin
      .from("conversation")
      .insert({
        clinic_id: clinicId,
        contact_id: naAntiga,
        whatsapp_account_id: numero,
        status: "resolvida",
        last_message_at: atras(48),
        tags: ["odonto"],
      })
      .throwOnError();
    await novaConversa(clinicId, naAntiga, numero);

    expect(await planejar(clinicId)).toBe(6);
    expect(await executar(clinicId)).toMatchObject({
      executadas: 3,
      puladas: 3,
      falhas: 0,
    });

    const porContato = async (regra: string) =>
      new Map(
        (await execucoes(regra)).map((e) => [
          e.contact_id,
          `${e.status}/${e.motivo ?? "-"}`,
        ]),
      );
    expect(await porContato(todas)).toEqual(
      new Map([
        [so, "executada/-"],
        [comOdonto, "pulada/condicoes_nao_atendidas"],
        [nenhuma, "pulada/condicoes_nao_atendidas"],
      ]),
    );
    expect(await porContato(qualquer)).toEqual(
      new Map([
        [daConversa, "executada/-"],
        [nadaK4, "pulada/condicoes_nao_atendidas"],
        [naAntiga, "executada/-"],
      ]),
    );
    // A pulada pela condicao nao tem retrato por acao: nenhuma acao rodou.
    const pulada = (await execucoes(todas)).find(
      (e) => e.contact_id === nenhuma,
    );
    expect(await retratos(pulada!.id)).toEqual([]);
  });
});

describe("idempotencia por acao", () => {
  it("a execucao feita pela metade nao repete a acao feita nem confere a condicao de novo", async () => {
    const { clinicId, numero } = await novaClinica("metade");
    const regra = await salvar(clinicId, {
      nome: "Atividade e etiqueta",
      etapa: "k5",
      condicoes: [{ tipo: "tem_etiqueta", etiqueta: "Psiquiatria" }],
      acoes: [
        {
          acao: "criar_atividade",
          atividade_titulo: "Ligar",
          atividade_prazo_dias: 0,
        },
        { acao: "etiquetar", etiqueta: "urgente" },
      ],
    });
    const lead = await novoLead(clinicId, "k5", 2, ["Psiquiatria"]);
    const conversa = await novaConversa(clinicId, lead, numero);
    expect(await planejar(clinicId)).toBe(1);
    // A passagem anterior fez a posicao 1 (o retrato existe) e a conversa
    // estava ocupada (a etiqueta adiou, a execucao ficou pendente); depois o
    // lead perdeu a etiqueta.
    const [pendente] = await execucoes(regra);
    await admin
      .from("automacao_execucao_acao")
      .insert({
        clinic_id: clinicId,
        execucao_id: pendente!.id,
        posicao: 1,
        acao: "criar_atividade",
        status: "executada",
      })
      .throwOnError();
    await admin
      .from("contact")
      .update({ tags: [] })
      .eq("id", lead)
      .throwOnError();

    expect(await executar(clinicId)).toMatchObject({
      executadas: 1,
      falhas: 0,
    });
    expect(await atividadesDe(lead)).toBe(0);
    expect(await etiquetasDaConversa(conversa)).toEqual(["urgente"]);
    expect(
      (await retratos(pendente!.id)).map((r) => [r.posicao, r.status]),
    ).toEqual([
      [1, "executada"],
      [2, "executada"],
    ]);
    // E uma terceira passagem nao faz nada (a execucao ja fechou).
    expect(await executar(clinicId)).toMatchObject({
      executadas: 0,
      puladas: 0,
    });
  });
});

describe("a automacao de hoje (uma acao, gravada pelas colunas de antes)", () => {
  it("executa e grava o historico igual a antes, com o retrato da posicao 1", async () => {
    const { clinicId, numero } = await novaClinica("legada");
    const { data } = await admin
      .from("automacao_fluxo")
      .insert({
        clinic_id: clinicId,
        nome: "Etiquetar ao entrar",
        ativa: true,
        gatilho: "entrou_na_etapa",
        etapa: "k6",
        acao: "etiquetar",
        etiqueta: "urgente",
      })
      .select("id")
      .single()
      .throwOnError();
    const regra = (data as { id: string }).id;
    const { data: acoes } = await admin
      .from("automacao_acao")
      .select("posicao, acao, etiqueta")
      .eq("automacao_id", regra)
      .throwOnError();
    expect(acoes).toEqual([
      { posicao: 1, acao: "etiquetar", etiqueta: "urgente" },
    ]);

    const lead = await novoLead(clinicId, "novo", 2);
    const conversa = await novaConversa(clinicId, lead, numero);
    await admin
      .from("contact")
      .update({ funnel_stage: "k6" })
      .eq("id", lead)
      .throwOnError();
    expect(await executar(clinicId)).toMatchObject({
      executadas: 1,
      falhas: 0,
    });

    const { data: urgente } = await admin
      .from("conversation_tag_def")
      .select("nome")
      .eq("clinic_id", clinicId)
      .eq("chave", "urgente")
      .single()
      .throwOnError();
    const nome = (urgente as { nome: string }).nome;
    const [execucao] = await execucoes(regra);
    // O retrato do pai como antes da onda 4 (acao, chave, nome e conversa).
    expect(execucao).toMatchObject({
      status: "executada",
      motivo: null,
      acao: "etiquetar",
      etiqueta: "urgente",
      etiqueta_nome: nome,
      conversation_id: conversa,
    });
    expect(await retratos(execucao!.id)).toMatchObject([
      {
        posicao: 1,
        acao: "etiquetar",
        status: "executada",
        etiqueta: "urgente",
        etiqueta_nome: nome,
        conversation_id: conversa,
      },
    ]);
  });
});

describe("ciclo", () => {
  it("o mover numa acao fecha ciclo com outra regra ligada: recusado pela RPC e pela escrita de antes", async () => {
    const { clinicId } = await novaClinica("ciclo");
    await salvar(clinicId, {
      nome: "K7 para K8",
      etapa: "k7",
      acoes: [{ acao: "mover_etapa", etapa_destino: "k8" }],
    });
    const { error } = await admin.rpc("salvar_automacao_de_fluxo", {
      p_clinic_id: clinicId,
      p_id: null,
      p_regra: {
        nome: "K8 para K7",
        ativa: true,
        gatilho: "sem_resposta_na_etapa",
        etapa: "k8",
        espera_minutos: 60,
        combinar: "todas",
        // A regra com condicao conta como aresta (conservador).
        condicoes: [{ tipo: "tem_etiqueta", etiqueta: "Psiquiatria" }],
        acoes: [
          { acao: "nota_interna", nota_texto: "Antes de voltar." },
          { acao: "mover_etapa", etapa_destino: "k7" },
        ],
      },
    });
    expect((error as Erro)?.code).toBe("23514");
    expect((error as Erro)?.hint).toBe("automacao_ciclo");

    const { error: legada } = await admin.from("automacao_fluxo").insert({
      clinic_id: clinicId,
      nome: "K8 para K7, pelas colunas de antes",
      ativa: true,
      gatilho: "tempo_na_etapa",
      etapa: "k8",
      espera_minutos: 60,
      acao: "mover_etapa",
      etapa_destino: "k7",
    });
    expect((legada as Erro)?.code).toBe("23514");
    expect((legada as Erro)?.hint).toBe("automacao_ciclo");
  });
});

describe("clinica suspensa (onda 1)", () => {
  it("nada roda na suspensao e nada roda atrasado na volta", async () => {
    const { clinicId, numero } = await novaClinica("suspensa");
    const tempo = await salvar(clinicId, {
      nome: "Atividade depois de 1 hora",
      etapa: "k1",
      acoes: [
        {
          acao: "criar_atividade",
          atividade_titulo: "Ligar",
          atividade_prazo_dias: 0,
        },
      ],
    });
    const entrada = await salvar(clinicId, {
      nome: "Etiquetar ao entrar",
      gatilho: "entrou_na_etapa",
      espera_minutos: null,
      etapa: "k2",
      acoes: [{ acao: "etiquetar", etiqueta: "urgente" }],
    });
    const leadDoTempo = await novoLead(clinicId, "k1", 2);
    await novaConversa(clinicId, leadDoTempo, numero);
    const leadDaEntrada = await novoLead(clinicId, "novo", 2);
    const conversaDaEntrada = await novaConversa(
      clinicId,
      leadDaEntrada,
      numero,
    );
    // A entrada registra antes da suspensao (o gatilho de contact nao muda).
    await admin
      .from("contact")
      .update({ funnel_stage: "k2" })
      .eq("id", leadDaEntrada)
      .throwOnError();

    const { error: erroDaSuspensao } = await admin.rpc("suspender_clinica", {
      p_clinic_id: clinicId,
      p_motivo: "Teste de integração da onda 4",
    });
    expect(erroDaSuspensao).toBeNull();
    // O planejador registra a devida ja pulada (antes do executor).
    expect(await planejar(clinicId)).toBe(1);
    expect(await execucoes(tempo)).toMatchObject([
      { contact_id: leadDoTempo, status: "pulada", motivo: "clinica_suspensa" },
    ]);
    // O executor fecha a pendente de antes como pulada, sem fazer nada.
    expect(await executar(clinicId)).toMatchObject({
      executadas: 0,
      falhas: 0,
    });
    expect(await execucoes(entrada)).toMatchObject([
      {
        contact_id: leadDaEntrada,
        status: "pulada",
        motivo: "clinica_suspensa",
      },
    ]);
    expect(await etiquetasDaConversa(conversaDaEntrada)).toEqual([]);
    expect(await atividadesDe(leadDoTempo)).toBe(0);

    // Na volta, nada roda atrasado: as entradas ficaram usadas.
    const { error: erroDaVolta } = await admin.rpc("reativar_clinica", {
      p_clinic_id: clinicId,
      p_motivo: "Fim do teste de integração da onda 4",
    });
    expect(erroDaVolta).toBeNull();
    expect(await planejar(clinicId)).toBe(0);
    expect(await executar(clinicId)).toMatchObject({ executadas: 0 });
    expect(await atividadesDe(leadDoTempo)).toBe(0);
    expect(await etiquetasDaConversa(conversaDaEntrada)).toEqual([]);
  });
});
