import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import { ingerirMensagemRecebida } from "@/lib/integrations/whatsapp/ingest";
import type {
  AnuncioDeOrigem,
  InboundEvent,
} from "@/lib/integrations/whatsapp/inbound";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Fase 4, tarefas 4.1 e 4.2, contra o banco REAL. ACEITE 4.2 do backlog:
// "lead vindo de anuncio com parametro chega com campanha preenchida sem
// ninguem digitar nada". Cobre a atribuicao pela ingestao, a origem
// preservada para sempre, os triggers de funil (agendar e comparecer), o
// consumo de sessao de pacote e a constraint de motivo de perda, todos da
// migration 20260825100000. Cada cenario usa a propria clinica descartavel.

const CHECK_VIOLATION = "23514";

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

type MensagemRecebida = Extract<InboundEvent, { kind: "message_received" }>;

type AgendaMinima = {
  profissionalId: string;
  procedimentoId: string;
  vinculoId: string;
};

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({ name: `Funil ${nome} ${sufixo}`, slug: `fun-${nome}-${sufixo}` })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  // Conversa exige numero de WhatsApp (contrato da Fase 3): a entrada sem
  // numero explicito cai no principal.
  await criarNumeroDeTeste(admin, clinicId);
  return clinicId;
}

async function criarContato(
  clinicId: string,
  telefone: string,
  extras: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Contato Funil",
      ...extras,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

// Molde minimo de agenda: profissional + procedimento + vinculo particular.
async function criarAgendaMinima(clinicId: string): Promise<AgendaMinima> {
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dra. Funil" })
    .select("id")
    .single()
    .throwOnError();
  const { data: proc } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinicId,
      name: "Sessao de teste",
      default_duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: prof!.id,
      procedure_id: proc!.id,
      insurance_id: null,
      price_cents: 20000,
      covered_by_insurance: false,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  return {
    profissionalId: prof!.id as string,
    procedimentoId: proc!.id as string,
    vinculoId: vinculo!.id as string,
  };
}

function slot(horaInicio: string, horaFim: string) {
  return {
    starts_at: `2026-11-10T${horaInicio}:00-03:00`,
    ends_at: `2026-11-10T${horaFim}:00-03:00`,
  };
}

async function agendar(
  clinicId: string,
  contactId: string,
  agenda: AgendaMinima,
  horaInicio: string,
  horaFim: string,
  vinculoId?: string,
): Promise<string> {
  const { data } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      professional_id: agenda.profissionalId,
      service_link_id: vinculoId ?? agenda.vinculoId,
      ...slot(horaInicio, horaFim),
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function marcarCompareceu(appointmentId: string): Promise<void> {
  await admin
    .from("appointment")
    .update({ status: "compareceu" })
    .eq("id", appointmentId)
    .throwOnError();
}

async function funilDe(contactId: string) {
  const { data } = await admin
    .from("contact")
    .select("funnel_stage, lost_reason, lost_reason_note")
    .eq("id", contactId)
    .single()
    .throwOnError();
  return data!;
}

async function origemDe(contactId: string) {
  const { data } = await admin
    .from("contact")
    .select(
      "source_channel, source_campaign, source_method, source_captured_at",
    )
    .eq("id", contactId)
    .single()
    .throwOnError();
  return data!;
}

function evento(
  phone: string,
  waMessageId: string,
  body: string,
): MensagemRecebida {
  return {
    kind: "message_received",
    phone,
    name: "Paciente Funil",
    waMessageId,
    contentType: "texto",
    body,
    mediaUrl: null,
    mediaFilename: null,
    mediaMimetype: null,
    quotedWaMessageId: null,
    anuncio: null,
    instanceToken: null,
  };
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("aceite 4.2: atribuição de origem na ingestão", () => {
  it("lead de anúncio com token chega com campanha preenchida sem ninguém digitar nada", async () => {
    const clinicId = await criarClinica("token");
    await admin
      .from("campaign_link")
      .insert({
        clinic_id: clinicId,
        name: "Botox Setembro",
        token: "C7K3F9",
        channel: "trafego_pago",
        campaign: "Botox Setembro",
      })
      .throwOnError();

    const { data, error } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento(
        "+5584971100001",
        `fun:${sufixo}:a1`,
        "Ola! Quero agendar uma avaliacao [#c7k3f9]",
      ),
    );
    expect(error).toBeNull();
    expect(data?.inserted).toBe(true);
    expect(data?.contact_created).toBe(true);

    const origem = await origemDe(data!.contact_id!);
    expect(origem).toMatchObject({
      source_campaign: "Botox Setembro",
      source_channel: "trafego_pago",
      source_method: "link_token",
    });
    expect(origem.source_captured_at).not.toBeNull();
  });

  it("segunda mensagem com OUTRO token válido não reatribui a origem", async () => {
    const clinicId = await criarClinica("reatr");
    await admin
      .from("campaign_link")
      .insert([
        {
          clinic_id: clinicId,
          name: "Campanha Um",
          token: "C7K3F9",
          channel: "trafego_pago",
          campaign: "Campanha Um",
        },
        {
          clinic_id: clinicId,
          name: "Campanha Dois",
          token: "D8M4G2",
          channel: "redes_sociais",
          campaign: "Campanha Dois",
        },
      ])
      .throwOnError();

    const primeira = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584971100002", `fun:${sufixo}:b1`, "Oi [#C7K3F9]"),
    );
    expect(primeira.error).toBeNull();
    expect(primeira.data?.contact_created).toBe(true);

    const segunda = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento(
        "+5584971100002",
        `fun:${sufixo}:b2`,
        "Vi outro anuncio tambem [#D8M4G2]",
      ),
    );
    expect(segunda.error).toBeNull();
    expect(segunda.data?.contact_created).toBe(false);
    expect(segunda.data?.contact_id).toBe(primeira.data?.contact_id);

    // A origem da primeira campanha ficou intacta.
    const origem = await origemDe(primeira.data!.contact_id!);
    expect(origem.source_campaign).toBe("Campanha Um");
    expect(origem.source_channel).toBe("trafego_pago");
  });

  it("nem o service role troca origem já capturada (trigger preserva)", async () => {
    const clinicId = await criarClinica("origem");
    const contatoId = await criarContato(clinicId, "+5584971100003", {
      source_channel: "indicacao",
      source_method: "manual",
      source_captured_at: new Date().toISOString(),
    });

    const { error } = await admin
      .from("contact")
      .update({ source_channel: "trafego_pago" })
      .eq("id", contatoId);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("preservada");
  });
});

describe("funil automático (triggers de appointment)", () => {
  it("agendar avança para 'agendou', comparecer vai ao topo e nunca regride", async () => {
    const clinicId = await criarClinica("etapas");
    const agenda = await criarAgendaMinima(clinicId);
    const contatoId = await criarContato(clinicId, "+5584971200001");

    const consultaId = await agendar(
      clinicId,
      contatoId,
      agenda,
      "09:00",
      "09:30",
    );
    expect((await funilDe(contatoId)).funnel_stage).toBe("agendou");

    await marcarCompareceu(consultaId);
    expect((await funilDe(contatoId)).funnel_stage).toBe("compareceu");

    // Nova consulta de quem ja compareceu NAO rebaixa a etapa.
    await agendar(clinicId, contatoId, agenda, "10:00", "10:30");
    expect((await funilDe(contatoId)).funnel_stage).toBe("compareceu");
  });

  it("lead perdido que agenda deixa de estar perdido e o motivo é limpo", async () => {
    const clinicId = await criarClinica("perdido");
    const agenda = await criarAgendaMinima(clinicId);
    const contatoId = await criarContato(clinicId, "+5584971200002", {
      funnel_stage: "perdido",
      lost_reason: "preco",
    });

    await agendar(clinicId, contatoId, agenda, "09:00", "09:30");

    const funil = await funilDe(contatoId);
    expect(funil.funnel_stage).toBe("agendou");
    expect(funil.lost_reason).toBeNull();
    expect(funil.lost_reason_note).toBeNull();
  });
});

describe("consumo de sessão de pacote no comparecimento", () => {
  it("debita a sessão certa, ignora procedimento diferente e para no saldo cheio", async () => {
    const clinicId = await criarClinica("pacote");
    const agenda = await criarAgendaMinima(clinicId);
    const contatoId = await criarContato(clinicId, "+5584971300001");

    // Segundo procedimento do MESMO profissional, fora do pacote.
    const { data: procOutro } = await admin
      .from("procedure")
      .insert({ clinic_id: clinicId, name: "Outro procedimento" })
      .select("id")
      .single()
      .throwOnError();
    const { data: vinculoOutro } = await admin
      .from("service_link")
      .insert({
        clinic_id: clinicId,
        professional_id: agenda.profissionalId,
        procedure_id: procOutro!.id,
        insurance_id: null,
        price_cents: 10000,
        covered_by_insurance: false,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();

    // Pacote e venda pelo caminho ANTIGO (procedure_id + sessions, INSERT
    // direto em package_balance): desde a migration 20260929120000 os
    // gatilhos do modo expand criam o item do pacote e o item da venda, e o
    // debito e por item. O pacote de varios procedimentos tem teste proprio
    // (tests/integration/pacote-com-varios-procedimentos.test.ts).
    const { data: pacote } = await admin
      .from("package")
      .insert({
        clinic_id: clinicId,
        procedure_id: agenda.procedimentoId,
        sessions: 2,
        price_cents: 100000,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: saldo } = await admin
      .from("package_balance")
      .insert({
        clinic_id: clinicId,
        contact_id: contatoId,
        package_id: pacote!.id,
        sessions_total: 2,
      })
      .select("id")
      .single()
      .throwOnError();
    const saldoId = saldo!.id as string;
    const { data: item } = await admin
      .from("package_balance_item")
      .select("id")
      .eq("package_balance_id", saldoId)
      .eq("procedure_id", agenda.procedimentoId)
      .single()
      .throwOnError();
    const itemId = item!.id as string;

    // O saldo mora no item; package_balance.sessions_used e a soma legada.
    const sessoesUsadas = async (): Promise<number> => {
      const { data } = await admin
        .from("package_balance_item")
        .select("sessions_used")
        .eq("id", itemId)
        .single()
        .throwOnError();
      const { data: legado } = await admin
        .from("package_balance")
        .select("sessions_used")
        .eq("id", saldoId)
        .single()
        .throwOnError();
      expect(legado!.sessions_used).toBe(data!.sessions_used);
      return data!.sessions_used as number;
    };
    const saldoDebitado = async (consultaId: string) => {
      const { data } = await admin
        .from("appointment")
        .select("package_balance_id, package_balance_item_id")
        .eq("id", consultaId)
        .single()
        .throwOnError();
      // Venda e item andam juntos: os dois ou nenhum.
      expect(data!.package_balance_item_id === null).toBe(
        data!.package_balance_id === null,
      );
      if (data!.package_balance_item_id !== null) {
        expect(data!.package_balance_item_id).toBe(itemId);
      }
      return data!.package_balance_id as string | null;
    };

    // 1a sessao do procedimento do pacote: debita e vincula.
    const consulta1 = await agendar(
      clinicId,
      contatoId,
      agenda,
      "09:00",
      "09:30",
    );
    await marcarCompareceu(consulta1);
    expect(await sessoesUsadas()).toBe(1);
    expect(await saldoDebitado(consulta1)).toBe(saldoId);

    // Procedimento diferente NAO consome, mesmo com saldo disponivel.
    const consultaOutra = await agendar(
      clinicId,
      contatoId,
      agenda,
      "10:00",
      "10:30",
      vinculoOutro!.id as string,
    );
    await marcarCompareceu(consultaOutra);
    expect(await sessoesUsadas()).toBe(1);
    expect(await saldoDebitado(consultaOutra)).toBeNull();

    // 2a sessao do pacote: esgota o saldo.
    const consulta2 = await agendar(
      clinicId,
      contatoId,
      agenda,
      "11:00",
      "11:30",
    );
    await marcarCompareceu(consulta2);
    expect(await sessoesUsadas()).toBe(2);
    expect(await saldoDebitado(consulta2)).toBe(saldoId);

    // 3a: saldo cheio, a consulta e avulsa e o saldo nao estoura.
    const consulta3 = await agendar(
      clinicId,
      contatoId,
      agenda,
      "12:00",
      "12:30",
    );
    await marcarCompareceu(consulta3);
    expect(await sessoesUsadas()).toBe(2);
    expect(await saldoDebitado(consulta3)).toBeNull();
  });
});

describe("constraint de motivo de perda", () => {
  it("mover para 'perdido' sem motivo falha com 23514", async () => {
    const clinicId = await criarClinica("motivo");
    const contatoId = await criarContato(clinicId, "+5584971400001");

    const { error } = await admin
      .from("contact")
      .update({ funnel_stage: "perdido" })
      .eq("id", contatoId);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });
});

// Regressoes da revisao adversarial do bloco (25/08/2026).
describe("correções da revisão: descadastro, coerência de clínica e token tardio", () => {
  it("mensagem recebida DEPOIS da revogação não reativa o consentimento", async () => {
    const clinicId = await criarClinica("revog");
    const telefone = "+5584971500001";

    const primeira = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento(telefone, `fun:${sufixo}:r1`, "Oi, quero informacoes"),
    );
    const contatoId = primeira.data!.contact_id!;

    const vigente = async (): Promise<boolean> => {
      const { data } = await admin.rpc("consentimento_vigente", {
        p_clinic_id: clinicId,
        p_contact_id: contatoId,
        p_channel: "whatsapp",
      });
      return data === true;
    };
    expect(await vigente()).toBe(true);

    // Descadastro (mesmo update da revogarConsentimentoAction).
    await admin
      .from("contact_consent")
      .update({ revoked_at: new Date().toISOString() })
      .eq("clinic_id", clinicId)
      .eq("contact_id", contatoId)
      .is("revoked_at", null)
      .throwOnError();
    expect(await vigente()).toBe(false);

    // O paciente escreve de novo: a ingestao NAO recria o consentimento.
    const segunda = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento(
        telefone,
        `fun:${sufixo}:r2`,
        "Por que voces pararam de responder?",
      ),
    );
    expect(segunda.error).toBeNull();
    expect(segunda.data?.inserted).toBe(true);
    expect(await vigente()).toBe(false);
  });

  it("consulta e saldo de pacote não nascem referenciando contato de OUTRA clínica", async () => {
    const clinicA = await criarClinica("coera");
    const clinicB = await criarClinica("coerb");
    const agendaA = await criarAgendaMinima(clinicA);
    const contatoDeB = await criarContato(clinicB, "+5584971500002");

    const { error: erroConsulta } = await admin.from("appointment").insert({
      clinic_id: clinicA,
      contact_id: contatoDeB,
      professional_id: agendaA.profissionalId,
      service_link_id: agendaA.vinculoId,
      ...slot("14:00", "14:30"),
    });
    expect(erroConsulta?.message).toContain("não pertence");

    const { data: pacote } = await admin
      .from("package")
      .insert({
        clinic_id: clinicA,
        procedure_id: agendaA.procedimentoId,
        sessions: 5,
        price_cents: 50000,
      })
      .select("id")
      .single()
      .throwOnError();
    const { error: erroSaldo } = await admin.from("package_balance").insert({
      clinic_id: clinicA,
      contact_id: contatoDeB,
      package_id: pacote!.id,
      sessions_total: 5,
    });
    expect(erroSaldo?.message).toContain("não pertence");
  });

  it("contato pré-existente sem origem ganha atribuição por token, mas não por palavra-chave", async () => {
    const clinicId = await criarClinica("tardio");
    await admin
      .from("campaign_link")
      .insert({
        clinic_id: clinicId,
        name: "Campanha Tardia",
        token: "H5N7P2",
        channel: "trafego_pago",
        campaign: "Campanha Tardia",
        keywords: ["botox"],
      })
      .throwOnError();

    // Nasce SEM token (sem origem).
    const primeira = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584971500003", `fun:${sufixo}:t1`, "Oi, tudo bem?"),
    );
    const contatoId = primeira.data!.contact_id!;
    expect((await origemDe(contatoId)).source_channel).toBeNull();

    // Palavra-chave em mensagem posterior NAO atribui (conversa comum).
    await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584971500003", `fun:${sufixo}:t2`, "Quanto custa o botox?"),
    );
    expect((await origemDe(contatoId)).source_channel).toBeNull();

    // Token em mensagem posterior atribui: sinal explicito vale sempre.
    await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento(
        "+5584971500003",
        `fun:${sufixo}:t3`,
        "Vim pelo anuncio [#H5N7P2]",
      ),
    );
    const origem = await origemDe(contatoId);
    expect(origem.source_channel).toBe("trafego_pago");
    expect(origem.source_method).toBe("link_token");
  });
});

// Estrutura de captura do anuncio CTWA (R1 sem o teste R0, decisao do dono em
// 08/09/2026). A regra que importa: PRIMEIRO CLIQUE VENCE. Quem clicou no
// anuncio A e depois mandou mensagem com vestigio do anuncio B continua
// atribuido ao A, senao a conversao volta para a campanha errada e o dinheiro
// da clinica e otimizado no anuncio que nao trouxe o paciente.
describe("captura do ctwa_clid na ingestão", () => {
  it("grava o clique no nascimento do contato e não deixa o segundo sobrescrever", async () => {
    const clinicId = await criarClinica("ctwa");
    const telefone = "+5584977770001";

    const comAnuncio = {
      ...evento(telefone, `ctwa-1-${sufixo}`, "vi o anuncio"),
      anuncio: {
        ctwaClid: "CLID-PRIMEIRO",
        adId: "120210000000000001",
        adsetId: "238500000000000001",
        campaignId: "6720000000000001",
        sourceUrl: "https://fb.me/abc",
        plataforma: null,
        tipo: null,
        chavesVistas: { anuncio: [], contexto: [] },
      },
    };
    const { data, error } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      comAnuncio,
    );
    expect(error).toBeNull();

    const { data: contato } = await admin
      .from("contact")
      .select("ctwa_clid, source_ad_id, source_adset_id, source_campaign_id")
      .eq("id", data!.contact_id!)
      .single();
    expect(contato).toEqual({
      ctwa_clid: "CLID-PRIMEIRO",
      source_ad_id: "120210000000000001",
      source_adset_id: "238500000000000001",
      source_campaign_id: "6720000000000001",
    });

    // Segundo clique, outro anúncio: não pode sobrescrever o primeiro.
    const segundo = {
      ...evento(telefone, `ctwa-2-${sufixo}`, "vi outro anuncio"),
      anuncio: {
        ctwaClid: "CLID-SEGUNDO",
        adId: "999999999999999999",
        adsetId: null,
        campaignId: null,
        sourceUrl: null,
        plataforma: null,
        tipo: null,
        chavesVistas: { anuncio: [], contexto: [] },
      },
    };
    await ingerirMensagemRecebida(admin, clinicId, null, segundo);

    const { data: depois } = await admin
      .from("contact")
      .select("ctwa_clid, source_ad_id")
      .eq("id", data!.contact_id!)
      .single();
    expect(depois!.ctwa_clid).toBe("CLID-PRIMEIRO");
    expect(depois!.source_ad_id).toBe("120210000000000001");
  });

  it("mensagem sem anúncio não toca nas colunas de anúncio", async () => {
    const clinicId = await criarClinica("semctwa");
    const { data } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584977770002", `semctwa-${sufixo}`, "bom dia"),
    );
    const { data: contato } = await admin
      .from("contact")
      .select("ctwa_clid, source_ad_id")
      .eq("id", data!.contact_id!)
      .single();
    expect(contato!.ctwa_clid).toBeNull();
    expect(contato!.source_ad_id).toBeNull();
  });
});

// Origem real do lead de anuncio (D3, 04/10/2026, frente D). O anuncio
// Click-to-WhatsApp grava canal trafego_pago, origem Meta, meio = plataforma
// (Facebook, Instagram ou nulo) e metodo anuncio_ctwa, NUNCA source_campaign
// (campanha e conjunto vem de meta_anuncio pelo source_ad_id). A origem e
// imutavel, entao cada caso confere tambem o que NAO pode mudar. Depende da
// migration 20261004100000 aplicada.
describe("origem real do anúncio na ingestão", () => {
  const ANUNCIO_A = "120240624148610289";
  const ANUNCIO_B = "120240624148619999";

  function anuncio(parcial: Partial<AnuncioDeOrigem> = {}): AnuncioDeOrigem {
    return {
      ctwaClid: `Af-CLIQUE-A-${sufixo}`,
      adId: ANUNCIO_A,
      adsetId: null,
      campaignId: null,
      sourceUrl: "https://fb.me/abcXYZ",
      plataforma: null,
      tipo: "ad",
      chavesVistas: {
        anuncio: ["ctwaClid", "sourceApp", "sourceID", "sourceType"],
        contexto: ["entryPointConversionApp", "externalAdReply"],
      },
      ...parcial,
    };
  }

  function mensagemDeAnuncio(
    telefone: string,
    waMessageId: string,
    corpo: string,
    comAnuncio: AnuncioDeOrigem,
  ): MensagemRecebida {
    return { ...evento(telefone, waMessageId, corpo), anuncio: comAnuncio };
  }

  async function origemCompletaDe(contactId: string) {
    const { data } = await admin
      .from("contact")
      .select(
        "ctwa_clid, source_ad_id, source_channel, source_origin, source_medium, source_campaign, source_method, source_captured_at",
      )
      .eq("id", contactId)
      .single()
      .throwOnError();
    return data!;
  }

  /** O cliente admin de verdade, anotando o nome de cada RPC chamada. */
  function adminQueAnotaRpcs(rpcs: string[]): SupabaseClient {
    const cliente = {
      from: (tabela: string) => admin.from(tabela),
      rpc: (nome: string, args?: Record<string, unknown>) => {
        rpcs.push(nome);
        return admin.rpc(nome, args);
      },
    };
    return cliente as unknown as SupabaseClient;
  }

  it("anúncio novo recebe canal, origem, plataforma e método, com source_campaign nulo", async () => {
    const clinicId = await criarClinica("adnovo");
    const { data, error } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      mensagemDeAnuncio(
        "+5584978880001",
        `orig-1-${sufixo}`,
        "Olá! Quero saber mais",
        anuncio({ plataforma: "Instagram" }),
      ),
    );
    expect(error).toBeNull();
    expect(data?.contact_created).toBe(true);

    const origem = await origemCompletaDe(data!.contact_id!);
    expect(origem).toMatchObject({
      ctwa_clid: `Af-CLIQUE-A-${sufixo}`,
      source_ad_id: ANUNCIO_A,
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_medium: "Instagram",
      source_method: "anuncio_ctwa",
      source_campaign: null,
    });
    expect(origem.source_captured_at).not.toBeNull();
  });

  it("sem plataforma informada, o meio fica nulo", async () => {
    const clinicId = await criarClinica("adsemplat");
    const { data } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      mensagemDeAnuncio(
        "+5584978880002",
        `orig-2-${sufixo}`,
        "oi",
        anuncio({ plataforma: null }),
      ),
    );
    const origem = await origemCompletaDe(data!.contact_id!);
    expect(origem).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_medium: null,
      source_method: "anuncio_ctwa",
      source_campaign: null,
    });
  });

  it("um segundo anúncio não muda a origem nem os ids", async () => {
    const clinicId = await criarClinica("adsegundo");
    const telefone = "+5584978880003";
    const primeira = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      mensagemDeAnuncio(
        telefone,
        `orig-3a-${sufixo}`,
        "primeiro",
        anuncio({ plataforma: "Instagram" }),
      ),
    );
    const contatoId = primeira.data!.contact_id!;
    const antes = await origemCompletaDe(contatoId);

    const segunda = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      mensagemDeAnuncio(
        telefone,
        `orig-3b-${sufixo}`,
        "segundo",
        anuncio({
          ctwaClid: `Af-CLIQUE-B-${sufixo}`,
          adId: ANUNCIO_B,
          plataforma: "Facebook",
        }),
      ),
    );
    expect(segunda.error).toBeNull();
    expect(segunda.data?.contact_id).toBe(contatoId);

    expect(await origemCompletaDe(contatoId)).toEqual(antes);
  });

  it("origem manual se mantém e os ids do anúncio continuam sendo gravados", async () => {
    const clinicId = await criarClinica("admanual");
    const telefone = "+5584978880004";
    const capturadaEm = "2026-09-01T10:00:00+00:00";
    const contatoId = await criarContato(clinicId, telefone, {
      source_channel: "indicacao",
      source_method: "manual",
      source_captured_at: capturadaEm,
    });

    const { error } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      mensagemDeAnuncio(
        telefone,
        `orig-4-${sufixo}`,
        "vi o anúncio",
        anuncio({ plataforma: "Facebook" }),
      ),
    );
    expect(error).toBeNull();

    const origem = await origemCompletaDe(contatoId);
    expect(origem).toMatchObject({
      ctwa_clid: `Af-CLIQUE-A-${sufixo}`,
      source_ad_id: ANUNCIO_A,
      source_channel: "indicacao",
      source_method: "manual",
      source_origin: null,
      source_medium: null,
      source_campaign: null,
    });
    expect(Date.parse(origem.source_captured_at as string)).toBe(
      Date.parse(capturadaEm),
    );
  });

  it("contato antigo sem origem ganha a origem do anúncio", async () => {
    const clinicId = await criarClinica("adantigo");
    const telefone = "+5584978880005";
    const contatoId = await criarContato(clinicId, telefone);

    const { data } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      mensagemDeAnuncio(telefone, `orig-5-${sufixo}`, "oi", anuncio()),
    );
    expect(data?.contact_created).toBe(false);
    expect(await origemCompletaDe(contatoId)).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_method: "anuncio_ctwa",
      source_campaign: null,
    });
  });

  it("anúncio e código de campanha na mesma mensagem: vence o anúncio", async () => {
    const clinicId = await criarClinica("adcodigo");
    await admin
      .from("campaign_link")
      .insert({
        clinic_id: clinicId,
        name: "Botox Outubro",
        token: "K4M7Q2",
        channel: "redes_sociais",
        campaign: "Botox Outubro",
      })
      .throwOnError();

    const { data, error } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      mensagemDeAnuncio(
        "+5584978880006",
        `orig-6-${sufixo}`,
        "Quero agendar [#K4M7Q2]",
        anuncio({ plataforma: "Instagram" }),
      ),
    );
    expect(error).toBeNull();
    expect(await origemCompletaDe(data!.contact_id!)).toMatchObject({
      source_channel: "trafego_pago",
      source_origin: "Meta",
      source_medium: "Instagram",
      source_method: "anuncio_ctwa",
      source_campaign: null,
    });
  });

  it("post não vira Tráfego pago e não grava id nenhum", async () => {
    const clinicId = await criarClinica("adpost");
    const { data, error } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      mensagemDeAnuncio(
        "+5584978880007",
        `orig-7-${sufixo}`,
        "vi a publicação",
        anuncio({ tipo: "post", adId: "1789000000000001" }),
      ),
    );
    expect(error).toBeNull();
    expect(await origemCompletaDe(data!.contact_id!)).toMatchObject({
      ctwa_clid: null,
      source_ad_id: null,
      source_channel: null,
      source_origin: null,
      source_method: null,
    });
  });

  it("só o primeiro clique pede a campanha à Meta, e sem conta configurada nenhum job nasce", async () => {
    const clinicId = await criarClinica("adfila");
    const telefone = "+5584978880008";
    const rpcs: string[] = [];
    const cliente = adminQueAnotaRpcs(rpcs);

    await ingerirMensagemRecebida(
      cliente,
      clinicId,
      null,
      mensagemDeAnuncio(telefone, `orig-8a-${sufixo}`, "oi", anuncio()),
    );
    await ingerirMensagemRecebida(
      cliente,
      clinicId,
      null,
      mensagemDeAnuncio(
        telefone,
        `orig-8b-${sufixo}`,
        "de novo",
        anuncio({ ctwaClid: `Af-CLIQUE-B-${sufixo}`, adId: ANUNCIO_B }),
      ),
    );

    expect(
      rpcs.filter((nome) => nome === "enfileirar_resolucao_de_anuncios_meta"),
    ).toHaveLength(1);
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("kind", "resolver_anuncio_meta")
      .throwOnError();
    expect(jobs).toEqual([]);
  });
});
