import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { chaveDeTelefone } from "@/lib/domain/telefone";
import { importarContatos } from "@/lib/integrations/importar-contatos";
import { adminClient } from "../rls/stack";

// Migration 20260924100000, contra o banco REAL. O WhatsApp entrega o celular
// de muitos DDDs SEM o nono digito e a recepcao cadastra COM ele. Antes o
// ingest casava por texto exato: a mesma pessoa virava dois contatos e a
// resposta ao toque de confirmacao caia no contato errado. Aqui se prova que
// as duas formas sao UM contato, em todas as portas de entrada, e que a chave
// do banco (chave_telefone) e a da tela (chaveDeTelefone) concordam.

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
let clinicId: string;

// Celular de DDD 84 no formato antigo (8 digitos comecando em 8) e o mesmo
// com o nono digito. Digitos aleatorios para nao colidir entre execucoes.
function parDeTelefones(): { semNove: string; comNove: string } {
  const local = `8${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  return { semNove: `+5584${local}`, comNove: `+55849${local}` };
}

async function ingest(
  telefone: string,
  waMessageId: string,
  extras: Record<string, unknown> = {},
) {
  return await admin.rpc("ingest_inbound_message", {
    p_clinic_id: clinicId,
    p_phone_e164: telefone,
    p_name: "Paciente do WhatsApp",
    p_wa_message_id: waMessageId,
    p_content_type: "texto",
    p_body: "oi",
    p_media_url: null,
    p_transcript: null,
    ...extras,
  });
}

async function contatosDaChave(chave: string) {
  const { data } = await admin
    .from("contact")
    .select("id, phone_e164, phone_key, name")
    .eq("clinic_id", clinicId)
    .eq("phone_key", chave)
    .throwOnError();
  return data ?? [];
}

beforeAll(async () => {
  const { data } = await admin
    .from("clinic")
    .insert({ name: `Telefone ${sufixo}`, slug: `telefone-${sufixo}` })
    .select("id")
    .single()
    .throwOnError();
  clinicId = data!.id as string;
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicId);
});

describe("chave do banco igual a chave da tela", () => {
  it.each([
    "+558499990000",
    "+5584999990000",
    "+558432220000",
    "+558466665555",
    "+442071234567",
    "+552381239999",
    "+555585999990000",
  ])("%s", async (telefone) => {
    const { data, error } = await admin.rpc("chave_telefone", {
      p_phone: telefone,
    });
    expect(error).toBeNull();
    expect(data).toBe(chaveDeTelefone(telefone));
  });
});

describe("ingestao casa as duas formas", () => {
  it("cadastro COM o 9 e mensagem SEM o 9 sao o mesmo contato", async () => {
    const { semNove, comNove } = parDeTelefones();
    const { data: criado } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicId,
        phone_e164: comNove,
        name: "Digitada na Recepcao",
        kind: "paciente",
      })
      .select("id")
      .single()
      .throwOnError();

    const { data, error } = await ingest(semNove, `tel:${sufixo}:1`);
    expect(error).toBeNull();
    const resultado = data as { contact_id: string; contact_created: boolean };
    expect(resultado.contact_created).toBe(false);
    expect(resultado.contact_id).toBe(criado!.id);

    const contatos = await contatosDaChave(chaveDeTelefone(comNove));
    expect(contatos).toHaveLength(1);
    // O numero passa a ser o que o WhatsApp entregou (a forma que recebe).
    expect(contatos[0]!.phone_e164).toBe(semNove);
    // O nome digitado pela recepcao nao e trocado pelo do WhatsApp.
    expect(contatos[0]!.name).toBe("Digitada na Recepcao");
  });

  it("cadastro SEM o 9 e mensagem COM o 9 tambem casam", async () => {
    const { semNove, comNove } = parDeTelefones();
    const primeira = await ingest(semNove, `tel:${sufixo}:2a`);
    const segunda = await ingest(comNove, `tel:${sufixo}:2b`);
    expect(primeira.error).toBeNull();
    expect(segunda.error).toBeNull();
    expect((segunda.data as { contact_id: string }).contact_id).toBe(
      (primeira.data as { contact_id: string }).contact_id,
    );
    expect(await contatosDaChave(chaveDeTelefone(semNove))).toHaveLength(1);

    const { count } = await admin
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("contact_id", (primeira.data as { contact_id: string }).contact_id);
    expect(count).toBe(1);
  });

  it("primeiras mensagens simultaneas nas duas formas criam UM contato", async () => {
    const { semNove, comNove } = parDeTelefones();
    const chamadas = Array.from({ length: 10 }, (_, i) =>
      ingest(i % 2 === 0 ? semNove : comNove, `tel:${sufixo}:conc:${i}`),
    );
    const resultados = await Promise.all(chamadas);
    for (const resultado of resultados) {
      expect(resultado.error).toBeNull();
    }
    const ids = new Set(
      resultados.map((r) => (r.data as { contact_id: string }).contact_id),
    );
    expect(ids.size).toBe(1);
    expect(await contatosDaChave(chaveDeTelefone(semNove))).toHaveLength(1);
  });

  it("o banco recusa um segundo contato na outra forma", async () => {
    const { semNove, comNove } = parDeTelefones();
    await admin
      .from("contact")
      .insert({ clinic_id: clinicId, phone_e164: semNove })
      .throwOnError();
    const { error } = await admin
      .from("contact")
      .insert({ clinic_id: clinicId, phone_e164: comNove });
    expect(error?.code).toBe("23505");
  });

  it("fixo e celular com os mesmos 8 digitos continuam pessoas diferentes", async () => {
    const final = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
    const fixo = `+55843${final}`;
    const celular = `+558493${final}`;
    const a = await ingest(fixo, `tel:${sufixo}:fixo`);
    const b = await ingest(celular, `tel:${sufixo}:cel`);
    expect((a.data as { contact_id: string }).contact_id).not.toBe(
      (b.data as { contact_id: string }).contact_id,
    );
  });
});

describe("importacao casa pela chave", () => {
  it("planilha COM o 9 atualiza o contato que veio do WhatsApp SEM o 9", async () => {
    const { semNove, comNove } = parDeTelefones();
    const { data } = await ingest(semNove, `tel:${sufixo}:imp`);
    const contactId = (data as { contact_id: string }).contact_id;

    const resultado = await importarContatos(admin, clinicId, {
      declaracao: { opcao: "recepcao" },
      lote: [
        {
          name: "Nome da Planilha",
          phone_e164: comNove,
          email: "planilha@exemplo.com",
          insurance_name: null,
          source_campaign: null,
        },
      ],
    });
    expect(resultado).toMatchObject({
      ok: true,
      importados: 0,
      atualizados: 1,
    });

    const contatos = await contatosDaChave(chaveDeTelefone(comNove));
    expect(contatos).toHaveLength(1);
    expect(contatos[0]!.id).toBe(contactId);
    // O telefone gravado continua o do WhatsApp.
    expect(contatos[0]!.phone_e164).toBe(semNove);
  });
});

describe("conversa sem agente e arquivo recebido", () => {
  it("mensagem nova tira a conversa de 'ia_atendendo'", async () => {
    const { semNove } = parDeTelefones();
    const { data } = await ingest(semNove, `tel:${sufixo}:ia1`);
    const conversationId = (data as { conversation_id: string })
      .conversation_id;
    await admin
      .from("conversation")
      .update({ status: "ia_atendendo", assignee_user_id: null })
      .eq("id", conversationId)
      .throwOnError();

    await ingest(semNove, `tel:${sufixo}:ia2`);
    const { data: conversa } = await admin
      .from("conversation")
      .select("status, awaiting_reply")
      .eq("id", conversationId)
      .single()
      .throwOnError();
    expect(conversa).toEqual({
      status: "aguardando_humano",
      awaiting_reply: true,
    });
  });

  it("nome e tipo do documento sao gravados e saneados", async () => {
    const { semNove } = parDeTelefones();
    const { data } = await ingest(semNove, `tel:${sufixo}:doc`, {
      p_content_type: "documento",
      p_body: "segue o pedido",
      p_media_filename: "../pasta/pedido\u0001.docx",
      p_media_mimetype: "Application/PDF; charset=binary",
    });
    const messageId = (data as { message_id: string }).message_id;
    const { data: mensagem } = await admin
      .from("message")
      .select("body, media_filename, media_mimetype")
      .eq("id", messageId)
      .single()
      .throwOnError();
    expect(mensagem).toEqual({
      body: "segue o pedido",
      media_filename: "..pastapedido.docx",
      media_mimetype: "application/pdf",
    });
  });
});
