import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Onda 3, item 10: a passagem da IA para a equipe leva o LEAD para Aguardando
// resposta (migrations 20261023100000 M1 e 20261023110000 M2; decisoes do
// dono de 21/10/2026: D1 = A, D2 so lead, D4 as automacoes disparam) contra o
// banco REAL, pelo cliente de servico (o servidor). As conversas "na IA" sao
// linhas gravadas direto (o servidor pode por ia_atendendo); a passagem e
// sempre a de verdade (as RPCs e a manutencao), e o gatilho
// passagem_da_ia_move_o_lead de conversation faz o resto:
// - a IA decide passar (passar_conversa_da_ia_para_equipe) e o servidor tira
//   (tirar_conversa_da_ia_pelo_servidor): Novo vai para Aguardando resposta,
//   com a trilha ia_moveu_etapa sem usuario e sem detalhes;
// - nunca para tras: Em contato, Agendou, Compareceu, Perdido e a livre
//   depois de Aguardando resposta ficam; a livre antes, move;
// - paciente fica (D2);
// - a resposta pelo celular nao move (a pessoa derruba a espera antes);
// - a varredura de 3 minutos (motor_manutencao): sem_resposta move;
//   liberacao_perdida sem o paciente esperando nao move, e com ele
//   esperando, move;
// - IA desligada (definir_liberacao_da_ia, que chama ia_desligar): move quem
//   esperava, e so;
// - consulta da IA recusada (devolver_conversa_da_consulta_recusada): depois
//   da onda 2 (conversao so na aprovacao) o contato continua lead e move;
// - a pendencia (o contato estava travado) e processada por
//   processar_pendencias_do_funil e apagada, e descartada se a conversa ja
//   foi assumida; o motor (sem clinica) ignora clinica de teste;
// - D4: a automacao entrou_na_etapa em Aguardando resposta registra;
// - etapa com evento da Meta: uma conversao por contato, mesmo passando de
//   novo.
// Que a passagem nao falha com a funcao do funil quebrada e que ela nunca
// espera o contato travado (duas sessoes) esta provado no harness local e
// nos ensaios (~/.claude/plans/onda3-funil/ensaio-20261023100000.sql e
// -20261023110000.sql; scratchpad/onda3-banco/harness/contencao.sh): aqui
// nao se sabota funcao da producao nem se segura trava.
//
// ESCRITO NA ONDA 3 E NAO RODADO por quem escreveu: grava no banco. Quem roda
// e o coordenador, DEPOIS de aplicar a M1 e a M2 (e a onda 2, antes delas),
// com npm run test:integration.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste (sem a IA liberada:
// nenhuma conversa e atendida e nenhuma mensagem sai; numero fake), apagadas
// no afterAll. O motor de producao ignora clinica de teste (inclusive a
// entrada funil-da-passagem do pg_cron); a manutencao chamada aqui e a
// mesma que o pg_cron chama. O interruptor global NUNCA e tocado. Nada usa a
// id da salud-care, da teste123 nem da Conduzza Teste. Telefones
// ficticios.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   delete from public.clinic where slug like 'funil-passagem-int-%' and e_de_teste;

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");
const clinicas: string[] = [];

let clinicaF = "";
let numeroF = "";
let telefones = 0;

type Etapa = { funnel_stage: string; kind: string };
type Resultado = {
  movidos: number;
  descartadas: number;
  adiadas: number;
  sem_mudanca: number;
  erros: string[];
};

async function novaClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Funil passagem ${nome} ${sufixo}`,
      slug: `funil-passagem-int-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const id = (data as { id: string }).id;
  clinicas.push(id);
  return id;
}

async function rpcOk<T>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
}

async function inserir(
  tabela: string,
  linha: Record<string, unknown>,
): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

function novoTelefone(): string {
  telefones += 1;
  return `+55849${digitos}${String(telefones).padStart(2, "0")}`;
}

/**
 * Contato sintetico e a conversa dele "na IA" (so as linhas), com a ultima
 * mensagem do paciente ha um minuto.
 */
async function naIa(
  opcoes: {
    clinica?: string;
    numero?: string;
    esperando?: boolean;
    etapa?: string;
    tipo?: "lead" | "paciente";
    telefone?: string;
  } = {},
): Promise<{ contato: string; conversa: string; telefone: string }> {
  const clinica = opcoes.clinica ?? clinicaF;
  const telefone = opcoes.telefone ?? novoTelefone();
  const umMinuto = new Date(Date.now() - 60_000).toISOString();
  const contato = await inserir("contact", {
    clinic_id: clinica,
    phone_e164: telefone,
    name: "Contato sintético",
    kind: opcoes.tipo ?? "lead",
    funnel_stage: opcoes.etapa ?? "novo",
    lost_reason: opcoes.etapa === "perdido" ? "preco" : null,
  });
  const conversa = await inserir("conversation", {
    clinic_id: clinica,
    contact_id: contato,
    status: "ia_atendendo",
    awaiting_reply: opcoes.esperando ?? true,
    last_inbound_at: umMinuto,
    last_message_at: umMinuto,
    whatsapp_account_id: opcoes.numero ?? numeroF,
  });
  await admin
    .from("message")
    .insert({
      clinic_id: clinica,
      conversation_id: conversa,
      direction: "entrada",
      author: "paciente",
      content_type: "texto",
      body: "Mensagem sintética",
      billable: false,
      cost_cents: 0,
      created_at: umMinuto,
    })
    .throwOnError();
  return { contato, conversa, telefone };
}

async function etapaDe(contato: string): Promise<Etapa> {
  const { data } = await admin
    .from("contact")
    .select("funnel_stage, kind")
    .eq("id", contato)
    .single()
    .throwOnError();
  return data as Etapa;
}

async function conversa(id: string) {
  const { data } = await admin
    .from("conversation")
    .select("status, awaiting_reply")
    .eq("id", id)
    .single()
    .throwOnError();
  return data as { status: string; awaiting_reply: boolean };
}

async function trilhasDoFunil(contato: string) {
  const { data } = await admin
    .from("audit_log")
    .select("action, entity, user_id, detalhes")
    .eq("entity_id", contato)
    .eq("action", "ia_moveu_etapa")
    .throwOnError();
  return data as {
    action: string;
    entity: string;
    user_id: string | null;
    detalhes: unknown;
  }[];
}

/** O servidor tira a conversa da IA (sem job: a rota do webhook). */
async function tirarPeloServidor(clinica: string, id: string): Promise<void> {
  expect(
    await rpcOk<boolean>("tirar_conversa_da_ia_pelo_servidor", {
      p_clinic_id: clinica,
      p_conversation_id: id,
      p_motivo: "falha_tecnica",
    }),
  ).toBe(true);
}

async function processar(clinica: string): Promise<Resultado> {
  return rpcOk<Resultado>("processar_pendencias_do_funil", {
    p_clinic_id: clinica,
    p_incluir_teste: true,
  });
}

async function posicaoDe(clinica: string, chave: string): Promise<number> {
  const { data } = await admin
    .from("funnel_stage_def")
    .select("posicao")
    .eq("clinic_id", clinica)
    .eq("chave", chave)
    .single()
    .throwOnError();
  return (data as { posicao: number }).posicao;
}

beforeAll(async () => {
  clinicaF = await novaClinica("F");
  numeroF = (await criarNumeroDeTeste(admin, clinicaF, { nome: "Recepção" }))
    .id;
  // Uma livre antes de Aguardando resposta e uma depois de Em contato.
  const aguardando = await posicaoDe(clinicaF, "aguardando_resposta");
  const emContato = await posicaoDe(clinicaF, "em_contato");
  await admin
    .from("funnel_stage_def")
    .insert([
      {
        clinic_id: clinicaF,
        chave: "livre_antes",
        nome: "Livre antes",
        posicao: aguardando - 5,
      },
      {
        clinic_id: clinicaF,
        chave: "livre_depois",
        nome: "Livre depois",
        posicao: emContato + 5,
      },
    ])
    .throwOnError();
});

afterAll(async () => {
  if (clinicas.length > 0) {
    await admin.from("clinic").delete().in("id", clinicas);
  }
});

describe("a passagem leva o lead para Aguardando resposta (D1 = A)", () => {
  it("a jornada da clínica de teste nasce na ordem nova, com as duas livres no lugar", async () => {
    const { data } = await admin
      .from("funnel_stage_def")
      .select("chave, papel")
      .eq("clinic_id", clinicaF)
      .order("posicao")
      .order("chave")
      .throwOnError();
    expect((data as { chave: string }[]).map((e) => e.chave)).toEqual([
      "novo",
      "livre_antes",
      "aguardando_resposta",
      "em_contato",
      "livre_depois",
      "agendou",
      "compareceu",
      "perdido",
    ]);
  });

  it("a IA decide passar: Novo vai para Aguardando resposta, com a trilha sem usuário", async () => {
    const { contato, conversa: id } = await naIa();
    const worker = `funil-int-${sufixo}-passar`;
    const jobId = await inserir("job_queue", {
      clinic_id: clinicaF,
      kind: "responder_com_ia",
      whatsapp_account_id: numeroF,
      payload: { conversation_id: id },
      status: "executando",
      locked_by: worker,
      locked_at: new Date().toISOString(),
      attempts: 1,
      max_attempts: 3,
    });
    expect(
      await rpcOk("passar_conversa_da_ia_para_equipe", {
        p_job_id: jobId,
        p_worker: worker,
        p_motivo: "agente_pediu",
      }),
    ).toEqual({ passou: true, codigo: "passou" });
    expect(await conversa(id)).toEqual({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
    expect(await etapaDe(contato)).toEqual({
      funnel_stage: "aguardando_resposta",
      kind: "lead",
    });
    expect(await trilhasDoFunil(contato)).toEqual([
      {
        action: "ia_moveu_etapa",
        entity: "contact",
        user_id: null,
        detalhes: null,
      },
    ]);
    await rpcOk("concluir_job", { p_id: jobId, p_worker: worker });
  });

  it("o servidor tira (falha técnica): move; tirar de novo não grava outra trilha", async () => {
    const { contato, conversa: id } = await naIa();
    await tirarPeloServidor(clinicaF, id);
    expect((await etapaDe(contato)).funnel_stage).toBe("aguardando_resposta");
    // A conversa ja esta fora da IA: a funcao devolve false e nada muda.
    expect(
      await rpcOk<boolean>("tirar_conversa_da_ia_pelo_servidor", {
        p_clinic_id: clinicaF,
        p_conversation_id: id,
        p_motivo: "falha_tecnica",
      }),
    ).toBe(false);
    expect(await trilhasDoFunil(contato)).toHaveLength(1);
  });

  it("nunca para trás: Em contato, Agendou, Compareceu, Perdido e a livre depois ficam; a livre antes move", async () => {
    const casos: [string, string][] = [
      ["em_contato", "em_contato"],
      ["agendou", "agendou"],
      ["compareceu", "compareceu"],
      ["perdido", "perdido"],
      ["livre_depois", "livre_depois"],
      ["livre_antes", "aguardando_resposta"],
    ];
    for (const [etapa, esperada] of casos) {
      const { contato, conversa: id } = await naIa({ etapa });
      await tirarPeloServidor(clinicaF, id);
      expect((await etapaDe(contato)).funnel_stage, etapa).toBe(esperada);
      expect(await trilhasDoFunil(contato), etapa).toHaveLength(
        esperada === "aguardando_resposta" ? 1 : 0,
      );
    }
  });

  it("paciente fica onde está (D2)", async () => {
    const { contato, conversa: id } = await naIa({ tipo: "paciente" });
    await tirarPeloServidor(clinicaF, id);
    expect(await etapaDe(contato)).toEqual({
      funnel_stage: "novo",
      kind: "paciente",
    });
    expect(await trilhasDoFunil(contato)).toEqual([]);
  });

  it("a resposta pelo celular não move: a pessoa derruba a espera antes de tirar da IA", async () => {
    const { contato, conversa: id, telefone } = await naIa();
    const r = await rpcOk<{ inserted: boolean; automatica: boolean }>(
      "registrar_mensagem_do_celular",
      {
        p_clinic_id: clinicaF,
        p_whatsapp_account_id: numeroF,
        p_phone_e164: telefone,
        p_wa_message_id: `funil-int:${sufixo}:celular`,
        p_body: "Oi, aqui é a recepção.",
      },
    );
    expect(r).toMatchObject({ inserted: true, automatica: false });
    expect(await conversa(id)).toEqual({
      status: "aguardando_humano",
      awaiting_reply: false,
    });
    expect((await etapaDe(contato)).funnel_stage).toBe("novo");
  });
});

describe("a varredura de 3 minutos (motor_manutencao)", () => {
  /**
   * Janela da IA como a ingestao abre (a varredura so olha conversa de
   * teste com janela). Sem telefone, a chave do proprio contato (a janela
   * confere); com outro telefone, a janela nao confere.
   */
  async function janela(
    contato: string,
    id: string,
    outroTelefone?: string,
  ): Promise<void> {
    const { data } = await admin
      .from("contact")
      .select("phone_key")
      .eq("id", contato)
      .single()
      .throwOnError();
    await admin
      .from("ia_janela_da_conversa")
      .insert({
        conversation_id: id,
        clinic_id: clinicaF,
        contact_id: contato,
        phone_key: outroTelefone ?? (data as { phone_key: string }).phone_key,
        desde: new Date(Date.now() - 10 * 60_000).toISOString(),
        aberta_por: "ingestao",
      })
      .throwOnError();
  }

  it("sem resposta há mais de 3 minutos: move", async () => {
    const { contato, conversa: id } = await naIa();
    await janela(contato, id);
    await admin
      .from("conversation")
      .update({
        last_inbound_at: new Date(Date.now() - 4 * 60_000).toISOString(),
      })
      .eq("id", id)
      .throwOnError();
    await rpcOk("motor_manutencao");
    expect(await conversa(id)).toEqual({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
    expect((await etapaDe(contato)).funnel_stage).toBe("aguardando_resposta");
  });

  it("liberação perdida: sem o paciente esperando não move; com ele esperando, move", async () => {
    const semEspera = await naIa({ esperando: false });
    const comEspera = await naIa({ esperando: true });
    // A janela que nao confere (outro telefone): a varredura tira com
    // liberacao_perdida, sem mexer em awaiting_reply.
    await janela(semEspera.contato, semEspera.conversa, novoTelefone());
    await janela(comEspera.contato, comEspera.conversa, novoTelefone());
    await rpcOk("motor_manutencao");
    expect(await conversa(semEspera.conversa)).toEqual({
      status: "aguardando_humano",
      awaiting_reply: false,
    });
    expect((await etapaDe(semEspera.contato)).funnel_stage).toBe("novo");
    expect(await conversa(comEspera.conversa)).toEqual({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
    expect((await etapaDe(comEspera.contato)).funnel_stage).toBe(
      "aguardando_resposta",
    );
  });
});

describe("IA desligada (ia_desligar)", () => {
  it("move quem esperava, e só", async () => {
    const clinicaD = await novaClinica("D");
    const numeroD = (await criarNumeroDeTeste(admin, clinicaD)).id;
    // d1: nao esperava, mas a ultima mensagem e do paciente (ia_desligar poe
    // a espera); d2: a ultima e da clinica (continua sem espera); d3: esperava.
    const d1 = await naIa({
      clinica: clinicaD,
      numero: numeroD,
      esperando: false,
    });
    const d2 = await naIa({
      clinica: clinicaD,
      numero: numeroD,
      esperando: false,
    });
    await admin
      .from("message")
      .insert({
        clinic_id: clinicaD,
        conversation_id: d2.conversa,
        direction: "saida",
        author: "sistema",
        content_type: "texto",
        body: "Mensagem automática sintética",
        billable: false,
        cost_cents: 0,
      })
      .throwOnError();
    const d3 = await naIa({ clinica: clinicaD, numero: numeroD });
    await rpcOk("definir_liberacao_da_ia", {
      p_clinic_id: clinicaD,
      p_liberada: false,
      p_modo: "simulador",
      p_motivo: "teste de integracao da onda 3",
    });
    for (const d of [d1, d2, d3]) {
      expect((await conversa(d.conversa)).status).toBe("aguardando_humano");
    }
    expect((await etapaDe(d1.contato)).funnel_stage).toBe(
      "aguardando_resposta",
    );
    expect((await etapaDe(d2.contato)).funnel_stage).toBe("novo");
    expect((await etapaDe(d3.contato)).funnel_stage).toBe(
      "aguardando_resposta",
    );
  });
});

describe("consulta da IA recusada", () => {
  // Depois da onda 2 (migration 20261022100000, conversao so na aprovacao):
  // a consulta da IA nasce pendente e nao converte; recusada, o contato
  // continua lead, e a devolucao da conversa (ia_atendendo para
  // aguardando_humano com o paciente esperando) leva o lead para Aguardando
  // resposta.
  it("a devolução da conversa move o lead", async () => {
    const profissional = await inserir("professional", {
      clinic_id: clinicaF,
      name: "Dra. Sintética",
    });
    const procedimento = await inserir("procedure", {
      clinic_id: clinicaF,
      name: "Consulta sintética",
    });
    const vinculo = await inserir("service_link", {
      clinic_id: clinicaF,
      professional_id: profissional,
      procedure_id: procedimento,
      duration_min: 30,
    });
    const { contato, conversa: id } = await naIa({ esperando: false });
    const amanha = new Date(Date.now() + 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);
    const inicio = new Date(`${amanha}T09:00:00-03:00`).toISOString();
    const fim = new Date(`${amanha}T09:30:00-03:00`).toISOString();
    // Nasce pendente (como a da IA) e ja cancelada (fora da agenda: nao
    // ocupa o horario); a pendente nao converte nem avanca o funil.
    const consulta = await inserir("appointment", {
      clinic_id: clinicaF,
      contact_id: contato,
      professional_id: profissional,
      service_link_id: vinculo,
      starts_at: inicio,
      ends_at: fim,
      status: "cancelado_clinica",
      created_by: "ia",
      approval_status: "pendente",
      send_confirmation: false,
      oferecer_vaga_ao_cancelar: false,
    });
    expect(await etapaDe(contato)).toEqual({
      funnel_stage: "novo",
      kind: "lead",
    });
    // A equipe recusa (recusar nao converte).
    await admin
      .from("appointment")
      .update({ approval_status: "recusado" })
      .eq("id", consulta)
      .throwOnError();
    await inserir("slot_hold", {
      clinic_id: clinicaF,
      professional_id: profissional,
      contact_id: contato,
      service_link_id: vinculo,
      conversation_id: id,
      job_id: crypto.randomUUID(),
      job_id_do_agendar: crypto.randomUUID(),
      consumido_em: new Date().toISOString(),
      appointment_id: consulta,
      starts_at: inicio,
      ends_at: fim,
      expires_at: new Date().toISOString(),
      created_by: "ia",
    });
    expect(
      await rpcOk<boolean>("devolver_conversa_da_consulta_recusada", {
        p_clinic_id: clinicaF,
        p_appointment_id: consulta,
      }),
    ).toBe(true);
    expect(await conversa(id)).toEqual({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
    expect(await etapaDe(contato)).toEqual({
      funnel_stage: "aguardando_resposta",
      kind: "lead",
    });
  });
});

describe("a pendência (o contato estava travado na passagem)", () => {
  /** Lead em Novo com a conversa no status dado e a pendencia gravada. */
  async function pendente(status: string): Promise<{
    contato: string;
    conversa: string;
  }> {
    const contato = await inserir("contact", {
      clinic_id: clinicaF,
      phone_e164: novoTelefone(),
      name: "Contato sintético",
    });
    const id = await inserir("conversation", {
      clinic_id: clinicaF,
      contact_id: contato,
      status,
      awaiting_reply: true,
      whatsapp_account_id: numeroF,
    });
    await admin
      .from("etapa_pendente_da_passagem")
      .insert({ contact_id: contato, clinic_id: clinicaF, conversation_id: id })
      .throwOnError();
    return { contato, conversa: id };
  }

  async function aindaPendente(contato: string): Promise<boolean> {
    const { count } = await admin
      .from("etapa_pendente_da_passagem")
      .select("contact_id", { count: "exact", head: true })
      .eq("contact_id", contato)
      .throwOnError();
    return (count ?? 0) > 0;
  }

  it("o motor (sem clínica) ignora a clínica de teste; com a clínica, move e apaga", async () => {
    const p = await pendente("aguardando_humano");
    const doMotor = await rpcOk<Resultado>("processar_pendencias_do_funil");
    expect(doMotor.erros).toEqual([]);
    expect(await aindaPendente(p.contato)).toBe(true);
    expect((await etapaDe(p.contato)).funnel_stage).toBe("novo");

    expect(await processar(clinicaF)).toEqual({
      movidos: 1,
      descartadas: 0,
      adiadas: 0,
      sem_mudanca: 0,
      erros: [],
    });
    expect(await aindaPendente(p.contato)).toBe(false);
    expect((await etapaDe(p.contato)).funnel_stage).toBe("aguardando_resposta");
    expect(await trilhasDoFunil(p.contato)).toHaveLength(1);
  });

  it("descarta a pendência cuja conversa já foi assumida, sem mover", async () => {
    const p = await pendente("em_atendimento");
    expect(await processar(clinicaF)).toEqual({
      movidos: 0,
      descartadas: 1,
      adiadas: 0,
      sem_mudanca: 0,
      erros: [],
    });
    expect(await aindaPendente(p.contato)).toBe(false);
    expect((await etapaDe(p.contato)).funnel_stage).toBe("novo");
  });
});

describe("o que dispara na entrada em Aguardando resposta", () => {
  it("D4: a automação entrou_na_etapa registra a execução", async () => {
    const automacao = await inserir("automacao_fluxo", {
      clinic_id: clinicaF,
      nome: "Responder o lead (teste)",
      ativa: true,
      gatilho: "entrou_na_etapa",
      etapa: "aguardando_resposta",
      acao: "criar_atividade",
      atividade_titulo: "Responder o lead",
      atividade_prazo_dias: 0,
      vigente_desde: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    const { contato, conversa: id } = await naIa();
    await tirarPeloServidor(clinicaF, id);
    const { data } = await admin
      .from("automacao_execucao")
      .select("contact_id, de_etapa")
      .eq("automacao_id", automacao)
      .throwOnError();
    expect(data).toEqual([
      { contact_id: contato, de_etapa: "aguardando_resposta" },
    ]);
    await admin
      .from("automacao_fluxo")
      .update({ ativa: false })
      .eq("id", automacao)
      .throwOnError();
  });

  it("etapa com evento da Meta: uma conversão por contato, mesmo passando de novo", async () => {
    await admin
      .from("funnel_stage_def")
      .update({ meta_event_name: "Lead", conversao_ativa: true })
      .eq("clinic_id", clinicaF)
      .eq("chave", "aguardando_resposta")
      .throwOnError();
    const um = await naIa();
    const dois = await naIa();
    await tirarPeloServidor(clinicaF, um.conversa);
    await tirarPeloServidor(clinicaF, dois.conversa);
    // De novo para o primeiro: a pendencia volta a rodar e o lead ja esta la.
    await admin
      .from("etapa_pendente_da_passagem")
      .insert({
        contact_id: um.contato,
        clinic_id: clinicaF,
        conversation_id: um.conversa,
      })
      .throwOnError();
    expect((await processar(clinicaF)).sem_mudanca).toBe(1);
    const { data } = await admin
      .from("conversion_event")
      .select("contact_id")
      .eq("clinic_id", clinicaF)
      .eq("stage_chave", "aguardando_resposta")
      .throwOnError();
    const porContato = (data as { contact_id: string }[]).map(
      (e) => e.contact_id,
    );
    expect(porContato.filter((c) => c === um.contato)).toHaveLength(1);
    expect(porContato.filter((c) => c === dois.contato)).toHaveLength(1);
    await admin
      .from("funnel_stage_def")
      .update({ meta_event_name: null })
      .eq("clinic_id", clinicaF)
      .eq("chave", "aguardando_resposta")
      .throwOnError();
  });
});
