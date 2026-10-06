import { beforeEach, describe, expect, it } from "vitest";

import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  sendWhatsAppText,
  type SendTextInput,
} from "@/lib/integrations/whatsapp/send";

import { bancoFalso, type Resposta } from "../jobs/banco-falso";

// Os dois campos que a mensagem agendada acrescentou ao envio (desenho
// revisado 2.1), e so eles:
// - manterAguardando: a agendada sai com author 'usuario' (assina quem a
//   escreveu), mas foi escrita ANTES da pergunta do paciente; o "Aguardando
//   voce" nao cai;
// - trilhaDoSistema: o bloqueio por falta de autorizacao vai para a trilha
//   sem pessoa, porque quem decidiu enviar naquela hora foi o motor.
// Sem os campos, tudo continua como era. O resto do envio (idempotencia,
// slot, custo 0) esta nos testes de send.ts e de integracao.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const NUMERO = "a2222222-2222-4222-8222-222222222222";
const ANA = "a1a1a1a1-0000-4000-8000-000000000001";

function banco(opcoes: {
  consentimentos?: Resposta[];
  slot?: Record<string, unknown>;
}) {
  const consentimentos = [...(opcoes.consentimentos ?? [])];
  return bancoFalso({
    tabelas: {
      conversation: () => ({
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
      }),
      contact: () => ({ data: { phone_e164: "+5584999990000" }, error: null }),
      message: (chamada) =>
        chamada.metodos.some((m) => m.metodo === "insert")
          ? { data: { id: "mensagem-1" }, error: null }
          : { data: null, error: null },
    },
    rpcs: {
      consentimento_vigente: () =>
        consentimentos.shift() ?? { data: true, error: null },
      reservar_slot_envio_v2: () => ({
        data: opcoes.slot ?? { estado: "reservado", espera_ms: 0 },
        error: null,
      }),
    },
  });
}

function enviar(
  b: ReturnType<typeof banco>,
  extra: Partial<SendTextInput> = {},
) {
  return sendWhatsAppText(b.admin, {
    clinicId: CLINICA,
    conversationId: "conversa-1",
    contactId: "contato-1",
    body: "Bom dia! Passando para lembrar do retorno.",
    authorUserId: ANA,
    author: "usuario",
    ...extra,
  });
}

function updateDaConversa(b: ReturnType<typeof banco>) {
  const updates = b.updatesEm("conversation") as Record<string, unknown>[];
  expect(updates).toHaveLength(1);
  return updates[0]!;
}

function trilha(b: ReturnType<typeof banco>) {
  return b.tabelas
    .filter((t) => t.tabela === "audit_log")
    .map((t) => t.metodos.find((m) => m.metodo === "insert")?.args[0]);
}

beforeEach(() => {
  resetFakeProvider();
});

describe("manterAguardando", () => {
  it("sem o campo, a resposta de gente derruba o Aguardando você (como sempre)", async () => {
    const b = banco({});
    expect((await enviar(b)).ok).toBe(true);
    expect(updateDaConversa(b)).toMatchObject({ awaiting_reply: false });
  });

  it("com o campo, a mensagem sai em nome da pessoa e o Aguardando continua", async () => {
    const b = banco({});
    expect((await enviar(b, { manterAguardando: true })).ok).toBe(true);
    const update = updateDaConversa(b);
    expect(update).not.toHaveProperty("awaiting_reply");
    expect(update).toHaveProperty("last_message_at");
    expect(fakeSentMessages()).toHaveLength(1);
    // A linha nasce com a autoria da pessoa (a bolha assina por ela).
    const [linha] = b.tabelas
      .filter((t) => t.tabela === "message")
      .flatMap((t) => t.metodos.filter((m) => m.metodo === "insert"))
      .map((m) => m.args[0] as Record<string, unknown>);
    expect(linha).toMatchObject({
      author: "usuario",
      author_user_id: ANA,
      billable: false,
      cost_cents: 0,
    });
  });

  it("toque do sistema continua sem mexer no Aguardando", async () => {
    const b = banco({});
    await enviar(b, { author: "sistema", authorUserId: null });
    expect(updateDaConversa(b)).not.toHaveProperty("awaiting_reply");
  });
});

describe("trilhaDoSistema", () => {
  it("sem autorização, com o campo: o bloqueio vai para a trilha sem pessoa", async () => {
    const b = banco({ consentimentos: [{ data: false, error: null }] });
    const resultado = await enviar(b, { trilhaDoSistema: true });
    expect(resultado).toMatchObject({ ok: false, reason: "sem_consentimento" });
    expect(trilha(b)).toEqual([
      {
        clinic_id: CLINICA,
        user_id: null,
        action: "envio_bloqueado_sem_autorizacao",
        entity: "contact",
        entity_id: "contato-1",
      },
    ]);
    expect(fakeSentMessages()).toHaveLength(0);
  });

  it("sem o campo, o bloqueio leva quem enviou (como sempre)", async () => {
    const b = banco({ consentimentos: [{ data: false, error: null }] });
    await enviar(b);
    expect(trilha(b)).toEqual([expect.objectContaining({ user_id: ANA })]);
  });

  it("revogou durante a espera do slot: a reconferência também grava sem pessoa", async () => {
    const b = banco({
      consentimentos: [
        { data: true, error: null },
        { data: false, error: null },
      ],
      slot: { estado: "reservado", espera_ms: 1 },
    });
    const resultado = await enviar(b, { trilhaDoSistema: true });
    expect(resultado).toMatchObject({
      ok: false,
      reason: "sem_consentimento",
      code: "sem_consentimento_no_envio",
    });
    expect(trilha(b)).toEqual([expect.objectContaining({ user_id: null })]);
    expect(fakeSentMessages()).toHaveLength(0);
  });
});

// F15 (achado 21 da revisao): no retry, a linha reaproveitada (message
// 'falhou' com codigo que garante que nada saiu) so vira 'enviando' depois
// da reserva do slot, logo antes do provedor. Antes, ela virava 'enviando'
// e, com o slot adiado, ficava assim sem envio nenhum: a tentativa seguinte
// lia "pode ter chegado" e a agendada fechava como nao confirmada.
describe("linha reaproveitada no retry (F15)", () => {
  function bancoDoRetry(opcoes: {
    slot: Record<string, unknown>;
    erroNaMarca?: boolean;
  }) {
    const marcas = { updatesAntesDoSlot: -1 };
    const b = bancoFalso({
      tabelas: {
        conversation: () => ({
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
        }),
        contact: () => ({
          data: { phone_e164: "+5584999990000" },
          error: null,
        }),
        message: (chamada) => {
          if (chamada.metodos.some((m) => m.metodo === "update")) {
            const marca = chamada.metodos.find((m) => m.metodo === "update")
              ?.args[0] as Record<string, unknown>;
            return opcoes.erroNaMarca && marca.delivery_status === "enviando"
              ? { data: null, error: { code: "08006", message: "x" } }
              : { data: null, error: null };
          }
          if (chamada.metodos.some((m) => m.metodo === "insert")) {
            return { data: { id: "linha-nova" }, error: null };
          }
          // A leitura pela chave do job: a tentativa anterior falhou sem
          // enviar.
          return {
            data: {
              id: "linha-do-job",
              delivery_status: "falhou",
              error_code: "leitura_falhou",
            },
            error: null,
          };
        },
      },
      rpcs: {
        consentimento_vigente: () => ({ data: true, error: null }),
        reservar_slot_envio_v2: () => {
          marcas.updatesAntesDoSlot = b.updatesEm("message").length;
          return { data: opcoes.slot, error: null };
        },
      },
    });
    return { b, marcas };
  }

  const inserts = (b: ReturnType<typeof bancoFalso>) =>
    b.tabelas.filter(
      (t) =>
        t.tabela === "message" && t.metodos.some((m) => m.metodo === "insert"),
    );

  it("slot adiado no retry: a linha continua 'falhou' (nunca 'enviando'), nada sai", async () => {
    const { b, marcas } = bancoDoRetry({
      slot: { estado: "adiado", livre_em: "2026-10-07T12:00:00.000Z" },
    });
    const resultado = await enviar(b, { jobId: "job-1" });
    expect(resultado).toMatchObject({
      ok: false,
      reason: "slot_adiado",
      code: "canal_ocupado",
    });
    expect(marcas.updatesAntesDoSlot).toBe(0);
    expect(b.updatesEm("message")).toEqual([]);
    expect(inserts(b)).toEqual([]);
    expect(fakeSentMessages()).toHaveLength(0);
  });

  it("slot indisponível no retry: idem", async () => {
    const { b } = bancoDoRetry({ slot: { estado: "sem_conta" } });
    const resultado = await enviar(b, { jobId: "job-1" });
    expect(resultado).toMatchObject({ ok: false, code: "slot_indisponivel" });
    expect(b.updatesEm("message")).toEqual([]);
    expect(fakeSentMessages()).toHaveLength(0);
  });

  it("slot reservado: a mesma linha vira 'enviando' só depois do slot, e sai", async () => {
    const { b, marcas } = bancoDoRetry({
      slot: { estado: "reservado", espera_ms: 0 },
    });
    const resultado = await enviar(b, { jobId: "job-1" });
    expect(resultado).toEqual({ ok: true, messageId: "linha-do-job" });
    expect(marcas.updatesAntesDoSlot).toBe(0);
    const [marca, final] = b.updatesEm("message") as Record<string, unknown>[];
    expect(marca).toEqual({ delivery_status: "enviando", error_code: null });
    expect(final).toMatchObject({ delivery_status: "enviada" });
    expect(inserts(b)).toEqual([]);
    expect(fakeSentMessages()).toHaveLength(1);
  });

  it("a marca 'enviando' falhou: nada sai (a linha 'falhou' faria o retry repetir)", async () => {
    const { b } = bancoDoRetry({
      slot: { estado: "reservado", espera_ms: 0 },
      erroNaMarca: true,
    });
    const resultado = await enviar(b, { jobId: "job-1" });
    expect(resultado).toMatchObject({ ok: false, code: "registro_falhou" });
    expect(fakeSentMessages()).toHaveLength(0);
  });
});
