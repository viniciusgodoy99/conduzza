import { afterAll, describe, expect, it } from "vitest";

import { ingerirMensagemRecebida } from "@/lib/integrations/whatsapp/ingest";
import type { InboundEvent } from "@/lib/integrations/whatsapp/inbound";
import { adminClient } from "../rls/stack";

// Fase 4 da jornada configuravel, contra o banco REAL: o termo-chave move o
// contato de etapa DENTRO da ingestao (tentarMoverPorTermo), nao so na
// decisao pura ja provada em tests/unit/domain/jornada-termo.test.ts. O que
// so a integracao pega: a jornada semeada pelo gatilho da clinica, o guard
// de concorrencia por etapa atual, a reentrega de webhook (inserted=false) e
// a trilha de auditoria como movimento de sistema. Cada cenario usa a
// propria clinica descartavel, que ja nasce com as 6 etapas padrao.

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
  return clinicId;
}

async function configurarTermos(
  clinicId: string,
  chave: string,
  termos: string[],
): Promise<void> {
  await admin
    .from("funnel_stage_def")
    .update({ termos_chave: termos })
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

async function trilhasDe(clinicId: string, contactId: string) {
  const { data } = await admin
    .from("audit_log")
    .select("user_id, action")
    .eq("clinic_id", clinicId)
    .eq("entity_id", contactId)
    .eq("action", "termo_chave_moveu_etapa")
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
      evento(telefone, `termo:${sufixo}:g1`, "Quero agendar amanha"),
    );
    expect(await etapaDe(data!.contact_id!)).toBe("agendou");

    // Termo da etapa ANTERIOR (em_contato) nao pode voltar quem ja agendou.
    await ingerirMensagemRecebida(
      admin,
      clinicId,
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
      evento(telefone, `termo:${sufixo}:g3`, "posso agendar de novo?"),
    );
    expect(await etapaDe(data!.contact_id!)).toBe("perdido");
  });

  it("clínica sem termo nenhum: mensagem não move nem audita", async () => {
    const clinicId = await criarClinica("quieta");
    const { data } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      evento("+5584972200004", `termo:${sufixo}:q1`, "Oi, tudo bem?"),
    );
    expect(await etapaDe(data!.contact_id!)).toBe("novo");
    expect(await trilhasDe(clinicId, data!.contact_id!)).toHaveLength(0);
  });
});
