import { afterAll, describe, expect, it } from "vitest";

import type { TermosDeQuem } from "@/lib/domain/jornada";
import { ingerirMensagemRecebida } from "@/lib/integrations/whatsapp/ingest";
import type { InboundEvent } from "@/lib/integrations/whatsapp/inbound";
import { tentarMoverPorTermo } from "@/lib/integrations/whatsapp/termo-chave";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Fase 4 da jornada configuravel, contra o banco REAL: o termo-chave move o
// contato de etapa DENTRO da ingestao (tentarMoverPorTermo), nao so na
// decisao pura ja provada em tests/unit/domain/jornada-termo.test.ts. O que
// so a integracao pega: a jornada semeada pelo gatilho da clinica, o guard
// de concorrencia por etapa atual, a reentrega de webhook (inserted=false) e
// a trilha de auditoria como movimento de sistema. Cada cenario usa a
// propria clinica descartavel, que ja nasce com as 6 etapas padrao.
//
// "Quem escreve o termo" (02/10/2026, migration 20261002120000): a coluna
// termos_de_quem nasce 'paciente' em toda etapa (o comportamento de antes),
// a mensagem do paciente so anda etapa de paciente ou de qualquer um, e o
// texto da clinica (envio pelo sistema e eco do celular, que chamam
// tentarMoverPorTermo com 'clinica') so anda etapa da clinica ou de
// qualquer um, com a trilha termo_chave_moveu_etapa_clinica.
//
// Eco do celular, "nunca reentrega" (mesma migration): a rota marca o
// wa_message_id em termo_eco_visto por marcar_eco_para_termo e so move quando
// a marca nasce. A marca nasceu quando o eco nao virava linha de message;
// desde 05/10/2026 ele vira (registrar_mensagem_do_celular), mas o termo
// continua decidido pela marca, nao pelo "inserted" da gravacao. Aqui: a
// marca e unica por clinica e id, nem nasce sem etapa com termo da clinica,
// e a poda e por clinica.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

type MensagemRecebida = Extract<InboundEvent, { kind: "message_received" }>;

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Termo ${nome} ${sufixo}`,
      slug: `termo-${nome}-${sufixo}`,
      e_de_teste: true,
    })
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

async function configurarTermos(
  clinicId: string,
  chave: string,
  termos: string[],
  termosDeQuem?: TermosDeQuem,
): Promise<void> {
  await admin
    .from("funnel_stage_def")
    .update({
      termos_chave: termos,
      ...(termosDeQuem ? { termos_de_quem: termosDeQuem } : {}),
    })
    .eq("clinic_id", clinicId)
    .eq("chave", chave)
    .throwOnError();
}

function evento(
  phone: string,
  waMessageId: string,
  body: string,
): MensagemRecebida {
  return {
    kind: "message_received",
    phone,
    name: "Paciente Termo",
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

async function etapaDe(contactId: string): Promise<string> {
  const { data } = await admin
    .from("contact")
    .select("funnel_stage")
    .eq("id", contactId)
    .single()
    .throwOnError();
  return data!.funnel_stage as string;
}

async function trilhasDe(
  clinicId: string,
  contactId: string,
  action = "termo_chave_moveu_etapa",
) {
  const { data } = await admin
    .from("audit_log")
    .select("user_id, action")
    .eq("clinic_id", clinicId)
    .eq("entity_id", contactId)
    .eq("action", action)
    .throwOnError();
  return data ?? [];
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("termo-chave na ingestão, contra o banco real", () => {
  it("mensagem com termo move o contato para a etapa, com trilha de sistema", async () => {
    const clinicId = await criarClinica("move");
    await configurarTermos(clinicId, "agendou", ["quero agendar"]);

    const { data } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584972200001", `termo:${sufixo}:m1`, "Oi, quero agendar!"),
    );
    expect(data?.contact_id).toBeTruthy();
    expect(await etapaDe(data!.contact_id!)).toBe("agendou");

    const trilhas = await trilhasDe(clinicId, data!.contact_id!);
    expect(trilhas).toHaveLength(1);
    expect(trilhas[0]!.user_id).toBeNull();
  });

  it("reentrega do MESMO wa_message_id não move nem audita de novo", async () => {
    const clinicId = await criarClinica("dupla");
    await configurarTermos(clinicId, "em_contato", ["informacao"]);

    const mensagem = evento(
      "+5584972200002",
      `termo:${sufixo}:d1`,
      "Quero informacao",
    );
    const { data: primeira } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      mensagem,
    );
    expect(await etapaDe(primeira!.contact_id!)).toBe("em_contato");

    // Volta o contato para tras NA MAO, simulando o pior caso: se a
    // reentrega rodasse o termo de novo, ela moveria de novo.
    await admin
      .from("contact")
      .update({ funnel_stage: "novo" })
      .eq("id", primeira!.contact_id!)
      .throwOnError();
    const { data: segunda } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      mensagem,
    );
    expect(segunda?.inserted).toBe(false);
    expect(await etapaDe(primeira!.contact_id!)).toBe("novo");
    expect(await trilhasDe(clinicId, primeira!.contact_id!)).toHaveLength(1);
  });

  it("termo de etapa anterior não volta o contato; perdido não sai por termo", async () => {
    const clinicId = await criarClinica("guarda");
    await configurarTermos(clinicId, "em_contato", ["quero saber"]);
    await configurarTermos(clinicId, "agendou", ["agendar"]);

    const telefone = "+5584972200003";
    const { data } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento(telefone, `termo:${sufixo}:g1`, "Quero agendar amanha"),
    );
    expect(await etapaDe(data!.contact_id!)).toBe("agendou");

    // Termo da etapa ANTERIOR (em_contato) nao pode voltar quem ja agendou.
    await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento(telefone, `termo:${sufixo}:g2`, "quero saber o endereco"),
    );
    expect(await etapaDe(data!.contact_id!)).toBe("agendou");

    // Perdido e definitivo para o termo: so gente (ou o gatilho de agenda)
    // reativa. O termo de agendar chega e o contato NAO se move.
    await admin
      .from("contact")
      .update({ funnel_stage: "perdido", lost_reason: "preco" })
      .eq("id", data!.contact_id!)
      .throwOnError();
    await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento(telefone, `termo:${sufixo}:g3`, "posso agendar de novo?"),
    );
    expect(await etapaDe(data!.contact_id!)).toBe("perdido");
  });

  it("clínica sem termo nenhum: mensagem não move nem audita", async () => {
    const clinicId = await criarClinica("quieta");
    const { data } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584972200004", `termo:${sufixo}:q1`, "Oi, tudo bem?"),
    );
    expect(await etapaDe(data!.contact_id!)).toBe("novo");
    expect(await trilhasDe(clinicId, data!.contact_id!)).toHaveLength(0);
  });
});

describe("quem escreve o termo, contra o banco real", () => {
  it("etapa nova (criada sem dizer quem escreve) e etapa semeada nascem com termo do paciente", async () => {
    const clinicId = await criarClinica("padrao");
    // Etapa criada DEPOIS da semeadura, sem citar termos_de_quem: o padrao
    // da coluna vale tambem para ela, nao so para as 6 do gatilho.
    await admin
      .from("funnel_stage_def")
      .insert({
        clinic_id: clinicId,
        chave: "avaliacao",
        nome: "Avaliação",
        posicao: 35,
      })
      .throwOnError();
    const { data } = await admin
      .from("funnel_stage_def")
      .select("chave, termos_de_quem")
      .eq("clinic_id", clinicId)
      .throwOnError();
    const chaves = data!.map((etapa) => etapa.chave as string);
    expect(chaves).toContain("avaliacao");
    expect(chaves).toContain("novo");
    expect(data!.length).toBeGreaterThan(1);
    for (const etapa of data!) {
      expect(etapa.termos_de_quem).toBe("paciente");
    }
  });

  it("etapa da clínica: o paciente escrevendo o termo não move", async () => {
    const clinicId = await criarClinica("so-clinica");
    await configurarTermos(
      clinicId,
      "em_contato",
      ["seja bem-vinda"],
      "clinica",
    );

    const { data } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento(
        "+5584972200005",
        `termo:${sufixo}:c1`,
        "me mandaram seja bem-vinda",
      ),
    );
    expect(await etapaDe(data!.contact_id!)).toBe("novo");
    expect(await trilhasDe(clinicId, data!.contact_id!)).toHaveLength(0);
  });

  it("etapa da clínica: o texto da clínica move, com a trilha da clínica e sem autor no eco", async () => {
    const clinicId = await criarClinica("clinica-move");
    await configurarTermos(
      clinicId,
      "em_contato",
      ["seja bem-vinda"],
      "clinica",
    );
    const { data } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584972200006", `termo:${sufixo}:c2`, "Oi, boa tarde"),
    );
    const contactId = data!.contact_id!;
    expect(await etapaDe(contactId)).toBe("novo");

    // O mesmo caminho do eco do celular (route.ts) e do envio pelo sistema
    // (atendimento/actions.ts, que passa o id de quem enviou).
    const destino = await tentarMoverPorTermo(admin, {
      clinicId,
      contactId,
      corpo: "Olá! Seja bem-vinda à clínica",
      quemEscreveu: "clinica",
      userId: null,
    });
    expect(destino).toBe("em_contato");
    expect(await etapaDe(contactId)).toBe("em_contato");

    const daClinica = await trilhasDe(
      clinicId,
      contactId,
      "termo_chave_moveu_etapa_clinica",
    );
    expect(daClinica).toHaveLength(1);
    expect(daClinica[0]!.user_id).toBeNull();
    // A trilha do paciente nao ganha linha por um texto da clinica.
    expect(await trilhasDe(clinicId, contactId)).toHaveLength(0);

    // Segunda passada do mesmo texto (reentrega dentro da janela): o
    // contato ja esta na etapa do termo e "so para frente" nao move de novo.
    expect(
      await tentarMoverPorTermo(admin, {
        clinicId,
        contactId,
        corpo: "Olá! Seja bem-vinda à clínica",
        quemEscreveu: "clinica",
        userId: null,
      }),
    ).toBeNull();
    expect(
      await trilhasDe(clinicId, contactId, "termo_chave_moveu_etapa_clinica"),
    ).toHaveLength(1);
  });

  it("etapa do paciente (padrão): o texto da clínica com o termo não move", async () => {
    const clinicId = await criarClinica("clinica-nao");
    await configurarTermos(clinicId, "agendou", ["agendar"]);
    const { data } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584972200007", `termo:${sufixo}:c3`, "Oi"),
    );
    const contactId = data!.contact_id!;

    expect(
      await tentarMoverPorTermo(admin, {
        clinicId,
        contactId,
        corpo: "Quer agendar para amanhã?",
        quemEscreveu: "clinica",
        userId: null,
      }),
    ).toBeNull();
    expect(await etapaDe(contactId)).toBe("novo");
  });

  it("etapa de qualquer um: anda pelo paciente e pela clínica", async () => {
    const clinicId = await criarClinica("qualquer");
    await configurarTermos(clinicId, "em_contato", ["orcamento"], "qualquer");
    await configurarTermos(
      clinicId,
      "aguardando_resposta",
      ["proposta"],
      "qualquer",
    );

    const { data } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584972200008", `termo:${sufixo}:q2`, "Quero um orcamento"),
    );
    const contactId = data!.contact_id!;
    expect(await etapaDe(contactId)).toBe("em_contato");

    expect(
      await tentarMoverPorTermo(admin, {
        clinicId,
        contactId,
        corpo: "Segue a proposta",
        quemEscreveu: "clinica",
        userId: null,
      }),
    ).toBe("aguardando_resposta");
    expect(await etapaDe(contactId)).toBe("aguardando_resposta");
  });
});

describe("eco do celular: marca única por wa_message_id, contra o banco real", () => {
  async function marcar(clinicId: string, waMessageId: string) {
    const { data, error } = await admin.rpc("marcar_eco_para_termo", {
      p_clinic_id: clinicId,
      p_wa_message_id: waMessageId,
    });
    expect(error).toBeNull();
    return data as boolean;
  }

  async function marcasDe(clinicId: string): Promise<string[]> {
    const { data } = await admin
      .from("termo_eco_visto")
      .select("wa_message_id")
      .eq("clinic_id", clinicId)
      .order("wa_message_id")
      .throwOnError();
    return (data ?? []).map((linha) => linha.wa_message_id as string);
  }

  it("sem etapa com termo da clínica não marca nem grava (nada andaria)", async () => {
    const clinicId = await criarClinica("eco-quieta");
    // Termo de etapa do PACIENTE nao conta: o eco e texto da clinica.
    await configurarTermos(clinicId, "agendou", ["agendar"]);
    expect(await marcar(clinicId, `eco:${sufixo}:q1`)).toBe(false);
    expect(await marcasDe(clinicId)).toEqual([]);
  });

  it("o primeiro eco marca; a reentrega do mesmo id não, mesmo com o lead voltado à mão", async () => {
    const clinicId = await criarClinica("eco-marca");
    await configurarTermos(
      clinicId,
      "em_contato",
      ["seja bem-vinda"],
      "clinica",
    );
    const { data } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      null,
      evento("+5584972200009", `termo:${sufixo}:e1`, "Oi, boa tarde"),
    );
    const contactId = data!.contact_id!;
    const ecoId = `eco:${sufixo}:e1`;
    const texto = "Olá! Seja bem-vinda à clínica";

    // O que a rota faz: marca e, so se a marca nasceu, move.
    async function rotaDoEco(): Promise<string | null> {
      if (!(await marcar(clinicId, ecoId))) {
        return null;
      }
      return tentarMoverPorTermo(admin, {
        clinicId,
        contactId,
        corpo: texto,
        quemEscreveu: "clinica",
        userId: null,
      });
    }

    expect(await rotaDoEco()).toBe("em_contato");
    expect(await etapaDe(contactId)).toBe("em_contato");

    // Alguem volta o lead a mao e o provedor reentrega o MESMO eco.
    await admin
      .from("contact")
      .update({ funnel_stage: "novo" })
      .eq("id", contactId)
      .throwOnError();
    expect(await rotaDoEco()).toBeNull();
    expect(await etapaDe(contactId)).toBe("novo");
    expect(
      await trilhasDe(clinicId, contactId, "termo_chave_moveu_etapa_clinica"),
    ).toHaveLength(1);

    // Outro eco (outro id) e novo.
    expect(await marcar(clinicId, `eco:${sufixo}:e2`)).toBe(true);
    expect(await marcasDe(clinicId)).toEqual([ecoId, `eco:${sufixo}:e2`]);
  });

  it("o mesmo id em outra clínica é outra marca; a poda de uma não apaga a da outra", async () => {
    const clinicaA = await criarClinica("eco-a");
    const clinicaB = await criarClinica("eco-b");
    for (const clinicId of [clinicaA, clinicaB]) {
      await configurarTermos(clinicId, "em_contato", ["proposta"], "qualquer");
    }
    const ecoId = `eco:${sufixo}:mesmo`;
    expect(await marcar(clinicaA, ecoId)).toBe(true);
    expect(await marcar(clinicaB, ecoId)).toBe(true);

    // Marcas de mais de 1 dia saem na proxima marca DA MESMA clinica.
    const anteontem = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await admin
      .from("termo_eco_visto")
      .insert([
        {
          clinic_id: clinicaA,
          wa_message_id: `eco:${sufixo}:velho-a`,
          created_at: anteontem,
        },
        {
          clinic_id: clinicaB,
          wa_message_id: `eco:${sufixo}:velho-b`,
          created_at: anteontem,
        },
      ])
      .throwOnError();
    expect(await marcar(clinicaA, `eco:${sufixo}:novo-a`)).toBe(true);
    expect(await marcasDe(clinicaA)).toEqual([
      ecoId,
      `eco:${sufixo}:novo-a`,
    ]);
    expect(await marcasDe(clinicaB)).toEqual([
      ecoId,
      `eco:${sufixo}:velho-b`,
    ]);
  });
});
