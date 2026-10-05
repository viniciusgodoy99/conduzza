import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  sendWhatsAppMedia,
  sendWhatsAppMenu,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";

// Marca de rastreio e rede de seguranca contra o eco duplicado.
//
// 1. Todo envio sai marcado com o id da linha de message que o registra (o
//    uazapi devolve a marca no eco, e o webhook descarta o eco por ela). O
//    id tem de ser o DESTA linha nos tres caminhos: linha nova, linha com id
//    fixado (midia) e linha 'falhou' reaproveitada pelo retry do job.
// 2. Se o eco escapar dos filtros e for gravado como "enviada pelo celular"
//    antes do update do wa_message_id, o update bate no unique (23505). O
//    envio ja saiu: a funcao chama adotar_eco_do_envio, nunca muda o retorno
//    e nunca loga conteudo.
//
// O banco aqui e um duble minimo do client do Supabase, como em
// send-por-numero.test.ts; o caminho real da RPC e da integracao.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const NUMERO = "a2222222-2222-4222-8222-222222222222";
const LINHA_NOVA = "d4444444-4444-4444-8444-444444444444";
const CORPO = "Sua consulta com a Dra. Fulana";

type Cenario = {
  /** linha que o job ja tem (retry); ausente, o job nao tem linha */
  linhaDoJob?: { id: string; delivery_status: string; error_code: string };
  /** erro no update que grava o wa_message_id */
  erroNoUpdate?: { code: string } | null;
  /** resposta de adotar_eco_do_envio; "lanca" simula excecao do client */
  adocao?: { data: unknown; error: unknown } | "lanca";
};

type Consulta = {
  tabela: string;
  operacao: "select" | "insert" | "update";
  valores?: Record<string, unknown>;
  filtros: Array<[string, unknown]>;
};

function bancoFalso(cenario: Cenario = {}) {
  const consultas: Consulta[] = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];

  function responder(c: Consulta): Record<string, unknown> {
    if (c.tabela === "conversation" && c.operacao === "select") {
      return {
        data: {
          whatsapp_account_id: NUMERO,
          numero: {
            id: NUMERO,
            provider: "fake",
            server_url: null,
            instance_id: "fake-a2222222",
            nome: "Recepção",
            connection_status: "conectado",
            removido_em: null,
          },
        },
        error: null,
      };
    }
    if (c.tabela === "whatsapp_account_secret") {
      return { data: { instance_token: "token" }, error: null };
    }
    if (c.tabela === "contact") {
      return { data: { phone_e164: "+5584999990000" }, error: null };
    }
    if (c.tabela === "message" && c.operacao === "select") {
      return { data: cenario.linhaDoJob ?? null, error: null };
    }
    if (c.tabela === "message" && c.operacao === "insert") {
      const id = (c.valores?.id as string | undefined) ?? LINHA_NOVA;
      return { data: { id }, error: null };
    }
    if (
      c.tabela === "message" &&
      c.operacao === "update" &&
      c.valores?.wa_message_id !== undefined
    ) {
      return { data: null, error: cenario.erroNoUpdate ?? null };
    }
    return { data: null, error: null };
  }

  function from(tabela: string) {
    const consulta: Consulta = { tabela, operacao: "select", filtros: [] };
    consultas.push(consulta);
    const construtor = {
      select() {
        return construtor;
      },
      insert(valores: Record<string, unknown>) {
        consulta.operacao = "insert";
        consulta.valores = valores;
        return construtor;
      },
      update(valores: Record<string, unknown>) {
        consulta.operacao = "update";
        consulta.valores = valores;
        return construtor;
      },
      eq(coluna: string, valor: unknown) {
        consulta.filtros.push([coluna, valor]);
        return construtor;
      },
      is(coluna: string, valor: unknown) {
        consulta.filtros.push([coluna, valor]);
        return construtor;
      },
      maybeSingle: async () => responder(consulta),
      single: async () => responder(consulta),
      then(
        resolver: (valor: Record<string, unknown>) => unknown,
        rejeitar?: (erro: unknown) => unknown,
      ) {
        return Promise.resolve(responder(consulta)).then(resolver, rejeitar);
      },
    };
    return construtor;
  }

  async function rpc(nome: string, args: Record<string, unknown>) {
    rpcs.push({ nome, args });
    if (nome === "consentimento_vigente") {
      return { data: true, error: null };
    }
    if (nome === "reservar_slot_envio_v2") {
      return { data: { estado: "reservado", espera_ms: 0 }, error: null };
    }
    if (nome === "adotar_eco_do_envio") {
      if (cenario.adocao === "lanca") {
        throw new Error("fetch failed");
      }
      return cenario.adocao ?? { data: true, error: null };
    }
    return { data: null, error: null };
  }

  return {
    client: { from, rpc } as unknown as SupabaseClient,
    consultas,
    rpcs,
  };
}

const BASE = {
  clinicId: CLINICA,
  conversationId: "conversa-1",
  contactId: "contato-1",
  body: CORPO,
  authorUserId: null,
} as const;

function chamadasDaAdocao(banco: ReturnType<typeof bancoFalso>) {
  return banco.rpcs.filter((r) => r.nome === "adotar_eco_do_envio");
}

let saida: string[] = [];

beforeEach(() => {
  resetFakeProvider();
  saida = [];
  const capturar = (pedaco: string | Uint8Array): boolean => {
    saida.push(String(pedaco));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o envio sai marcado com o id da linha de message", () => {
  it("texto do Inbox: a marca é o id da linha recém-inserida", async () => {
    const banco = bancoFalso();
    const resultado = await sendWhatsAppText(banco.client, BASE);

    expect(resultado).toEqual({ ok: true, messageId: LINHA_NOVA });
    expect(fakeSentMessages()).toHaveLength(1);
    expect(fakeSentMessages()[0]?.rastreioId).toBe(LINHA_NOVA);
  });

  it("mídia com id fixado: a marca é o id fixado, o mesmo do arquivo no balde", async () => {
    const banco = bancoFalso();
    const fixado = "e5555555-5555-4555-8555-555555555555";
    const resultado = await sendWhatsAppMedia(banco.client, {
      ...BASE,
      body: "",
      messageId: fixado,
      midia: {
        tipo: "image",
        base64: "AAAA",
        mimetype: "image/png",
        caminhoNoStorage: `${CLINICA}/${fixado}`,
      },
    });

    expect(resultado).toEqual({ ok: true, messageId: fixado });
    expect(fakeSentMessages()[0]?.rastreioId).toBe(fixado);
  });

  it("menu da régua: a marca é o id da linha, não o texto numerado", async () => {
    const banco = bancoFalso();
    const resultado = await sendWhatsAppMenu(banco.client, {
      ...BASE,
      author: "sistema",
      envioAutomatico: true,
      options: [{ id: "sim", text: "Confirmar" }],
    });

    expect(resultado.ok).toBe(true);
    expect(fakeSentMessages()[0]?.rastreioId).toBe(LINHA_NOVA);
  });

  it("retry do job reaproveita a linha 'falhou' e a marca é o id DELA", async () => {
    const reaproveitada = "f6666666-6666-4666-8666-666666666666";
    const banco = bancoFalso({
      linhaDoJob: {
        id: reaproveitada,
        delivery_status: "falhou",
        error_code: "provider_indisponivel",
      },
    });
    const resultado = await sendWhatsAppText(banco.client, {
      ...BASE,
      author: "sistema",
      jobId: "job-1",
    });

    expect(resultado).toEqual({ ok: true, messageId: reaproveitada });
    expect(
      banco.consultas.some(
        (c) => c.tabela === "message" && c.operacao === "insert",
      ),
    ).toBe(false);
    expect(fakeSentMessages()[0]?.rastreioId).toBe(reaproveitada);
  });
});

describe("rede de segurança: o eco gravado antes do wa_message_id", () => {
  it("23505 no update chama adotar_eco_do_envio com clínica, linha e wa_message_id", async () => {
    const banco = bancoFalso({ erroNoUpdate: { code: "23505" } });
    const resultado = await sendWhatsAppText(banco.client, BASE);

    // O retorno nao muda: o envio saiu.
    expect(resultado).toEqual({ ok: true, messageId: LINHA_NOVA });
    const waMessageId = fakeSentMessages()[0]?.waMessageId;
    expect(chamadasDaAdocao(banco)).toEqual([
      {
        nome: "adotar_eco_do_envio",
        args: {
          p_clinic_id: CLINICA,
          p_message_id: LINHA_NOVA,
          p_wa_message_id: waMessageId,
        },
      },
    ]);

    const tudo = saida.join("");
    expect(tudo).toContain("envio_adocao_do_eco");
    expect(tudo).toContain('"status":"adotado"');
    expect(tudo).toContain(`"message_id":"${LINHA_NOVA}"`);
    expect(tudo).toContain(`"whatsapp_account_id":"${NUMERO}"`);
    // Adotou: o log antigo de registro sem confirmacao nao aparece.
    expect(tudo).not.toContain("envio_saiu_sem_confirmar_registro");
    // Nenhum conteudo, nem o wa_message_id.
    expect(tudo).not.toContain("Fulana");
    expect(tudo).not.toContain(waMessageId);
  });

  it("a conversa segue atualizada depois da adoção, como num envio normal", async () => {
    const banco = bancoFalso({ erroNoUpdate: { code: "23505" } });
    await sendWhatsAppText(banco.client, {
      ...BASE,
      authorUserId: "usuario-1",
    });

    const conversa = banco.consultas.find(
      (c) => c.tabela === "conversation" && c.operacao === "update",
    );
    expect(conversa?.valores).toMatchObject({ awaiting_reply: false });
  });

  it("nada adotado (colisão com outra coisa): mantém o log antigo e o retorno", async () => {
    const banco = bancoFalso({
      erroNoUpdate: { code: "23505" },
      adocao: { data: false, error: null },
    });
    const resultado = await sendWhatsAppText(banco.client, BASE);

    expect(resultado).toEqual({ ok: true, messageId: LINHA_NOVA });
    expect(chamadasDaAdocao(banco)).toHaveLength(1);
    const tudo = saida.join("");
    expect(tudo).toContain('"status":"nada_adotado"');
    expect(tudo).toContain("envio_saiu_sem_confirmar_registro");
    expect(tudo).toContain('"error_code":"23505"');
    expect(tudo).not.toContain("Fulana");
  });

  it("RPC com erro: mantém o log antigo, com o código da RPC à parte", async () => {
    const banco = bancoFalso({
      erroNoUpdate: { code: "23505" },
      adocao: { data: null, error: { code: "42883" } },
    });
    const resultado = await sendWhatsAppText(banco.client, BASE);

    expect(resultado).toEqual({ ok: true, messageId: LINHA_NOVA });
    const tudo = saida.join("");
    expect(tudo).toContain('"status":"falhou"');
    expect(tudo).toContain('"error_code":"42883"');
    expect(tudo).toContain("envio_saiu_sem_confirmar_registro");
  });

  it("RPC que lança não derruba o envio que já saiu (retry duplicaria a mensagem)", async () => {
    const banco = bancoFalso({
      erroNoUpdate: { code: "23505" },
      adocao: "lanca",
    });
    const resultado = await sendWhatsAppText(banco.client, BASE);

    expect(resultado).toEqual({ ok: true, messageId: LINHA_NOVA });
    expect(fakeSentMessages()).toHaveLength(1);
    expect(saida.join("")).toContain("envio_saiu_sem_confirmar_registro");
  });

  it("outro erro no update não chama a RPC: só o log antigo", async () => {
    const banco = bancoFalso({ erroNoUpdate: { code: "57014" } });
    const resultado = await sendWhatsAppText(banco.client, BASE);

    expect(resultado).toEqual({ ok: true, messageId: LINHA_NOVA });
    expect(chamadasDaAdocao(banco)).toHaveLength(0);
    const tudo = saida.join("");
    expect(tudo).toContain("envio_saiu_sem_confirmar_registro");
    expect(tudo).toContain('"error_code":"57014"');
    expect(tudo).not.toContain("envio_adocao_do_eco");
  });

  it("update que dá certo não chama a RPC nem loga nada", async () => {
    const banco = bancoFalso();
    await sendWhatsAppText(banco.client, BASE);

    expect(chamadasDaAdocao(banco)).toHaveLength(0);
    expect(saida.join("")).toBe("");
  });
});
