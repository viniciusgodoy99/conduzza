import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Onda 2, item 10 (migration 20261022100000_conversao_na_aprovacao.sql, M1),
// contra o banco REAL, pelo cliente de servico (como o agendar da IA e a
// Agenda chegam ao banco). O que esta em jogo:
// - a consulta PENDENTE (a que a IA marca) nao converte o lead, nao avanca o
//   funil, nao registra a conversao (conversion_event, o que vai para a
//   Meta) nem a execucao da automacao "entrou na etapa";
// - aprovar faz tudo isso (o funil antes do kind: a automacao, que so
//   registra lead, registra);
// - recusar (approval recusado e cancelado_clinica) e o cancelamento pelo
//   paciente (cancelar_pelo_paciente) nao disparam nada, nem quando a
//   pendente ja cancelada e aprovada depois (revisao da onda 2);
// - a consulta da equipe (approval_status nulo) converte na hora
//   (regressao);
// - o sinal de paciente (a trava K): a pendente e a recusada nao contam, a
//   aprovada conta; logo depois do agendar, ia_pode_falar_com continua
//   verdadeiro para o telefone da equipe nao forcado (a resposta ao "sim"
//   sai); depois da aprovacao, a trava K volta;
// - a pendente so aprova, recusa ou cancela: confirmar e compareceu dao
//   23514 consulta_pendente (marcar_aguardando_confirmacao e
//   confirmar_pelo_paciente tambem); aprovar e confirmar no mesmo UPDATE
//   passa.
// A conta da Meta NAO e ligada: o envio da conversao segue embargado
// (conferir_token_antes_de_ligar_envio, decisao D6), entao nenhuma clinica
// tem envio_ativado; o registro da conversao (conversion_event) e o que
// prova o momento.
//
// ESTE BANCO E O DE PRODUCAO: clinica e_de_teste (o motor de producao a
// ignora), apagada no afterAll; nenhuma mensagem sai (numero fake, nenhum
// executor roda aqui). O interruptor global NUNCA e tocado. Nada usa a id
// da salud-care, da teste123 nem da Conduzza Teste. Telefones ficticios.
// ESCRITO NA ONDA 2 E NAO RODADO por quem escreveu (grava no banco): roda
// depois de aplicar a migration (npm run test:integration --
// conversao-na-aprovacao).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'conversao-aprovacao-int-%';
//   delete from public.clinic where slug like 'conversao-aprovacao-int-%' and e_de_teste;

const admin = adminClient();
const sufixo = Date.now().toString(36);
const digitos = String(Date.now() % 1_000_000).padStart(6, "0");

// O telefone da equipe (nao forcado) e os contatos de cada caso.
const EQUIPE = `+5584939${digitos}`;
const telefone = (final: string) => `+558493${final}${digitos}`;

let clinica = "";
let numero = "";
let profissional = "";
let vinculo = "";
let automacao = "";
let slot = 0;

type Erro = { code?: string; message?: string } | null;

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

async function contato(telefoneE164: string): Promise<string> {
  return inserir("contact", {
    clinic_id: clinica,
    phone_e164: telefoneE164,
    name: "Contato sintético",
  });
}

/** Uma consulta num horario proprio (amanha + n horas), pendente ou da equipe. */
async function consulta(
  contatoId: string,
  aprovacao: "pendente" | null,
): Promise<string> {
  slot += 1;
  const inicio = new Date(Date.now() + 24 * 60 * 60_000 + slot * 60 * 60_000);
  inicio.setUTCMinutes(0, 0, 0);
  return inserir("appointment", {
    clinic_id: clinica,
    contact_id: contatoId,
    professional_id: profissional,
    service_link_id: vinculo,
    starts_at: inicio.toISOString(),
    ends_at: new Date(inicio.getTime() + 30 * 60_000).toISOString(),
    status: "agendado",
    created_by: aprovacao === null ? "usuario" : "ia",
    approval_status: aprovacao,
    send_confirmation: aprovacao === null,
  });
}

type Retrato = {
  kind: string;
  etapa: string;
  conversoes: number;
  automacoes: number;
};

async function retrato(contatoId: string): Promise<Retrato> {
  const [{ data: k }, conversoes, automacoes] = await Promise.all([
    admin
      .from("contact")
      .select("kind, funnel_stage")
      .eq("id", contatoId)
      .single()
      .throwOnError(),
    admin
      .from("conversion_event")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contatoId),
    admin
      .from("automacao_execucao")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contatoId),
  ]);
  const linha = k as { kind: string; funnel_stage: string };
  return {
    kind: linha.kind,
    etapa: linha.funnel_stage,
    conversoes: conversoes.count ?? -1,
    automacoes: automacoes.count ?? -1,
  };
}

const LEAD_INTOCADO: Retrato = {
  kind: "lead",
  etapa: "novo",
  conversoes: 0,
  automacoes: 0,
};
const CONVERTIDO: Retrato = {
  kind: "paciente",
  etapa: "agendou",
  conversoes: 1,
  automacoes: 1,
};

async function sinal(telefoneE164: string): Promise<boolean> {
  return rpcOk<boolean>("contato_tem_sinal_de_paciente", {
    p_clinic_id: clinica,
    p_phone_key: telefoneE164,
  });
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .like("slug", "conversao-aprovacao-int-%")
    .eq("e_de_teste", true);
  clinica = await inserir("clinic", {
    name: `Conversao na aprovacao ${sufixo}`,
    slug: `conversao-aprovacao-int-${sufixo}`,
    e_de_teste: true,
  });
  numero = (await criarNumeroDeTeste(admin, clinica, { nome: "Recepção" })).id;
  profissional = await inserir("professional", {
    clinic_id: clinica,
    name: "Dra. Sintética",
  });
  const procedimento = await inserir("procedure", {
    clinic_id: clinica,
    name: "Consulta sintética",
  });
  vinculo = await inserir("service_link", {
    clinic_id: clinica,
    professional_id: profissional,
    procedure_id: procedimento,
    duration_min: 30,
  });

  // A etapa agendou com o evento da Meta (a conversao) e uma automacao
  // "entrou na etapa" que so registra lead.
  await admin
    .from("funnel_stage_def")
    .update({ meta_event_name: "Schedule", conversao_ativa: true })
    .eq("clinic_id", clinica)
    .eq("papel", "agendou")
    .throwOnError();
  automacao = await inserir("automacao_fluxo", {
    clinic_id: clinica,
    nome: "Nota sintética da onda 2",
    ativa: true,
    gatilho: "entrou_na_etapa",
    etapa: "agendou",
    acao: "nota_interna",
    nota_texto: "Nota sintética",
    vigente_desde: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
  });

  // A IA da clinica de teste (numero fake) com o telefone da equipe, nao
  // forcado, e uma versao publicada.
  await rpcOk("definir_liberacao_da_ia", {
    p_clinic_id: clinica,
    p_liberada: true,
    p_modo: "contatos",
    p_motivo: "teste de integracao da onda 2",
  });
  await rpcOk("definir_numero_da_ia", {
    p_clinic_id: clinica,
    p_whatsapp_account_id: numero,
    p_ativo: true,
  });
  await rpcOk("definir_contato_liberado_da_ia", {
    p_clinic_id: clinica,
    p_telefone_e164: EQUIPE,
    p_rotulo: "Equipe sintética",
    p_ativo: true,
    p_confirmou_aviso_da_openai: true,
  });
  await admin
    .from("ai_agent_config")
    .insert({ clinic_id: clinica, version: 1, status: "publicada" })
    .throwOnError();
});

afterAll(async () => {
  if (clinica) {
    await admin.from("clinic").delete().eq("id", clinica);
  }
});

describe("a consulta pendente e a aprovacao", () => {
  it("a pendente nao converte, nao avanca o funil e nao registra nada; aprovar faz tudo", async () => {
    const lead = await contato(telefone("1"));
    const pendente = await consulta(lead, "pendente");
    expect(await retrato(lead)).toEqual(LEAD_INTOCADO);
    expect(await sinal(telefone("1"))).toBe(false);

    await admin
      .from("appointment")
      .update({ approval_status: "aprovado", send_confirmation: true })
      .eq("id", pendente)
      .throwOnError();
    expect(await retrato(lead)).toEqual(CONVERTIDO);
    expect(await sinal(telefone("1"))).toBe(true);
    const { data: conversao } = await admin
      .from("conversion_event")
      .select("stage_chave, event_name, status")
      .eq("contact_id", lead)
      .single()
      .throwOnError();
    expect(conversao).toEqual({
      stage_chave: "agendou",
      event_name: "Schedule",
      status: "registrado",
    });
    const { data: execucao } = await admin
      .from("automacao_execucao")
      .select("automacao_id, de_etapa")
      .eq("contact_id", lead)
      .single()
      .throwOnError();
    expect(execucao).toEqual({ automacao_id: automacao, de_etapa: "agendou" });
  });

  it("recusar e o cancelamento pelo paciente nao disparam nada; a recusada nao e sinal", async () => {
    const recusado = await contato(telefone("2"));
    const aRecusar = await consulta(recusado, "pendente");
    await admin
      .from("appointment")
      .update({
        approval_status: "recusado",
        status: "cancelado_clinica",
        oferecer_vaga_ao_cancelar: false,
      })
      .eq("id", aRecusar)
      .throwOnError();
    expect(await retrato(recusado)).toEqual(LEAD_INTOCADO);
    expect(await sinal(telefone("2"))).toBe(false);

    const cancelado = await contato(telefone("3"));
    const aCancelar = await consulta(cancelado, "pendente");
    const r = await rpcOk<{ ok: boolean }>("cancelar_pelo_paciente", {
      p_clinic_id: clinica,
      p_appointment_id: aCancelar,
      p_contact_id: cancelado,
    });
    expect(r.ok).toBe(true);
    expect(await retrato(cancelado)).toEqual(LEAD_INTOCADO);

    // Revisao da onda 2: a pendente cancelada pelo paciente continua
    // 'pendente' (a funcao muda so o status). Aprovada depois (por
    // qualquer caminho), conta como recusada: nao converte, nao avanca o
    // funil, nao cria conversao nem execucao de automacao.
    const { data: depois } = await admin
      .from("appointment")
      .select("status, approval_status")
      .eq("id", aCancelar)
      .single()
      .throwOnError();
    expect(depois).toEqual({
      status: "cancelado_paciente",
      approval_status: "pendente",
    });
    expect(await sinal(telefone("3"))).toBe(false);
    await admin
      .from("appointment")
      .update({ approval_status: "aprovado", send_confirmation: true })
      .eq("id", aCancelar)
      .throwOnError();
    expect(await retrato(cancelado)).toEqual(LEAD_INTOCADO);
  });

  it("a consulta da equipe converte na hora (regressao)", async () => {
    const lead = await contato(telefone("4"));
    await consulta(lead, null);
    expect(await retrato(lead)).toEqual(CONVERTIDO);
  });

  it("depois do agendar, a trava K nao corta o telefone da equipe; depois da aprovacao, corta", async () => {
    const equipe = await contato(EQUIPE);
    const pendente = await consulta(equipe, "pendente");
    expect(
      await rpcOk<boolean>("ia_pode_falar_com", {
        p_clinic_id: clinica,
        p_whatsapp_account_id: numero,
        p_telefone: EQUIPE,
      }),
    ).toBe(true);
    await admin
      .from("appointment")
      .update({ approval_status: "aprovado" })
      .eq("id", pendente)
      .throwOnError();
    expect(
      await rpcOk<boolean>("ia_pode_falar_com", {
        p_clinic_id: clinica,
        p_whatsapp_account_id: numero,
        p_telefone: EQUIPE,
      }),
    ).toBe(false);
  });

  it("a pendente so aprova, recusa ou cancela: confirmar e compareceu dao 23514; aprovar e confirmar juntos passa", async () => {
    const lead = await contato(telefone("5"));
    const pendente = await consulta(lead, "pendente");
    for (const status of ["confirmado_recepcao", "compareceu"]) {
      const { error } = await admin
        .from("appointment")
        .update({ status })
        .eq("id", pendente);
      expect((error as Erro)?.code, status).toBe("23514");
      expect((error as Erro)?.message, status).toBe("consulta_pendente");
    }
    const { error: marcar } = await admin.rpc("marcar_aguardando_confirmacao", {
      p_clinic_id: clinica,
      p_appointment_id: pendente,
    });
    expect((marcar as Erro)?.code).toBe("23514");
    const { error: confirmar } = await admin.rpc("confirmar_pelo_paciente", {
      p_clinic_id: clinica,
      p_appointment_id: pendente,
      p_contact_id: lead,
    });
    expect((confirmar as Erro)?.code).toBe("23514");
    expect(await retrato(lead)).toEqual(LEAD_INTOCADO);
    await admin
      .from("appointment")
      .update({ approval_status: "aprovado", status: "confirmado_recepcao" })
      .eq("id", pendente)
      .throwOnError();
    expect(await retrato(lead)).toEqual(CONVERTIDO);
  });
});
