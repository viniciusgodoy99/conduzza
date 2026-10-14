import { beforeEach, describe, expect, it } from "vitest";

import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { TextoAprovado } from "@/lib/domain/conformidade/texto-aprovado";
import {
  envioCertamenteNaoSaiu,
  falhaPermiteRetry,
} from "@/lib/integrations/whatsapp/falhas-do-envio";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  enviarFraseFixaDaIa,
  enviarRespostaDaIa,
  type EnvioDaIaInput,
} from "@/lib/integrations/whatsapp/send";

import { BancoEmMemoria, type Resposta } from "./banco-em-memoria";
import { aprovarParaTeste } from "./texto-aprovado-de-teste";

// As portas da IA em send.ts (E3): a resposta (author 'ia', so com
// TextoAprovado) e a frase fixa (author 'sistema', corpo nunca parametro).
// O que se prova: a guarda ia_pode_enviar_agora roda antes do slot e logo
// antes do provedor, com o numero e o telefone que vao ao provedor; guarda
// que recusa ou falha nao deixa nada no provedor falso; a linha do job com
// outro conteudo e recusada; os SQLSTATE do gatilho de message viram
// codigos proprios; a resposta derruba a espera por ia_marcar_respondida e
// nunca pelo UPDATE de horario.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const CONTATO = "c1000000-0000-4000-8000-000000000001";
const NUMERO = "a0000000-0000-4000-8000-000000000001";
const JOB = "10000000-0000-4000-8000-000000000001";
const EXECUTOR = "motor-ia:20000000-0000-4000-8000-000000000001";
const TELEFONE = "+5584999990001";

const ENTRADA: EnvioDaIaInput = {
  clinicId: CLINICA,
  conversationId: CONVERSA,
  contactId: CONTATO,
  jobId: JOB,
  workerId: EXECUTOR,
  whatsappAccountId: NUMERO,
};

const RESPOSTA = "A consulta custa R$ 150,00.";

// TextoAprovado pelo proprio filtro de saida (nunca pela retomada).
const RESPOSTA_APROVADA: TextoAprovado = await aprovarParaTeste(
  RESPOSTA,
  [15_000],
);

function aprovado(texto: string): TextoAprovado {
  if (texto !== RESPOSTA) {
    throw new Error("so a resposta de teste foi aprovada pelo filtro");
  }
  return RESPOSTA_APROVADA;
}

let banco: BancoEmMemoria;
let guardas: string[];

function montar(respostasDaGuarda: (Resposta | string)[] = ["ok", "ok"]) {
  banco = new BancoEmMemoria();
  guardas = [];
  banco.linhas("conversation").push({
    id: CONVERSA,
    clinic_id: CLINICA,
    whatsapp_account_id: NUMERO,
    awaiting_reply: true,
    numero: {
      id: NUMERO,
      provider: "fake",
      server_url: null,
      instance_id: "fake-a0000000",
      nome: "Recepção",
      connection_status: "conectado",
      removido_em: null,
    },
  });
  banco.linhas("contact").push({
    id: CONTATO,
    clinic_id: CLINICA,
    phone_e164: TELEFONE,
  });
  banco.linhas("whatsapp_account_secret").push({
    clinic_id: CLINICA,
    account_id: NUMERO,
    instance_token: "token",
  });
  banco.rpc("consentimento_vigente", () => ({ data: true, error: null }));
  banco.rpc("reservar_slot_envio_v2", () => ({
    data: { estado: "ok", espera_ms: 0 },
    error: null,
  }));
  banco.rpc("ia_pode_enviar_agora", (args) => {
    guardas.push(String(args.p_tipo));
    const proxima = respostasDaGuarda.shift() ?? "ok";
    return typeof proxima === "string"
      ? { data: proxima, error: null }
      : proxima;
  });
  banco.rpc("ia_marcar_respondida", () => ({ data: true, error: null }));
}

beforeEach(() => {
  resetFakeProvider();
  montar();
});

describe("enviarRespostaDaIa", () => {
  it("com a guarda: sai como 'ia', pelo número e para o telefone que a guarda conferiu", async () => {
    const r = await enviarRespostaDaIa(banco.cliente(), {
      ...ENTRADA,
      texto: aprovado(RESPOSTA),
    });
    expect(r.ok).toBe(true);
    expect(fakeSentMessages()).toHaveLength(1);
    expect(fakeSentMessages()[0]).toMatchObject({
      accountId: NUMERO,
      to: TELEFONE,
      body: RESPOSTA,
    });
    expect(guardas).toEqual(["resposta", "resposta"]);
    for (const args of banco.chamadasDe("ia_pode_enviar_agora")) {
      expect(args).toEqual({
        p_job_id: JOB,
        p_worker: EXECUTOR,
        p_conversation_id: CONVERSA,
        p_whatsapp_account_id: NUMERO,
        p_telefone: TELEFONE,
        p_tipo: "resposta",
      });
    }
    const [linha] = banco.linhas("message");
    expect(linha).toMatchObject({
      author: "ia",
      author_user_id: null,
      body: RESPOSTA,
      job_id: JOB,
      delivery_status: "enviada",
      billable: false,
      cost_cents: 0,
    });
    // O trilho 1:1 (nao o de massa) e o teto curto.
    expect(banco.chamadasDe("reservar_slot_envio_v2")[0]).toMatchObject({
      p_massa: false,
      p_espera_maxima_ms: 3_000,
      p_whatsapp_account_id: NUMERO,
    });
    // A espera cai por id (ia_marcar_respondida), nunca pelo UPDATE.
    expect(banco.chamadasDe("ia_marcar_respondida")).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR },
    ]);
    expect(banco.linhas("conversation")[0]?.awaiting_reply).toBe(true);
  });

  it.each([
    ["sem_posse", "sem_posse"],
    ["fora_da_ia", "fora_da_ia"],
    ["janela_invalida", "janela_invalida"],
    ["nao_liberada", "ia_nao_liberada"],
    ["qualquer_outra", "ia_nao_liberada"],
  ])(
    "guarda cedo devolve %s: nada sai, nada é gravado nem reservado (%s)",
    async (daGuarda, codigo) => {
      montar([daGuarda]);
      const r = await enviarRespostaDaIa(banco.cliente(), {
        ...ENTRADA,
        texto: aprovado(RESPOSTA),
      });
      expect(r).toMatchObject({
        ok: false,
        reason: "falha_envio",
        code: codigo,
      });
      expect(fakeSentMessages()).toEqual([]);
      expect(banco.linhas("message")).toEqual([]);
      expect(banco.chamadasDe("reservar_slot_envio_v2")).toEqual([]);
      expect(banco.chamadasDe("ia_marcar_respondida")).toEqual([]);
      if (!r.ok) {
        expect(envioCertamenteNaoSaiu(r)).toBe(true);
        expect(falhaPermiteRetry(r.code)).toBe(false);
      }
    },
  );

  it("guarda com erro do banco: falha fechada, nada sai", async () => {
    montar([{ data: null, error: { code: "57014" } }]);
    const r = await enviarRespostaDaIa(banco.cliente(), {
      ...ENTRADA,
      texto: aprovado(RESPOSTA),
    });
    expect(r).toMatchObject({ ok: false, code: "ia_nao_liberada" });
    expect(fakeSentMessages()).toEqual([]);
  });

  it("guarda logo antes do provedor recusa: a linha fica 'falhou' com o código e nada sai", async () => {
    montar(["ok", "fora_da_ia"]);
    const r = await enviarRespostaDaIa(banco.cliente(), {
      ...ENTRADA,
      texto: aprovado(RESPOSTA),
    });
    expect(r).toMatchObject({ ok: false, code: "fora_da_ia" });
    expect(fakeSentMessages()).toEqual([]);
    expect(banco.linhas("message")[0]).toMatchObject({
      author: "ia",
      delivery_status: "falhou",
      error_code: "fora_da_ia",
    });
  });

  it("a linha do job com outro conteúdo: conteudo_divergente, nada sai", async () => {
    banco.linhas("message").push({
      id: "m-1",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      author: "sistema",
      body: FRASE_DE_ESCALONAMENTO,
      delivery_status: "falhou",
      error_code: "provider_indisponivel",
    });
    const r = await enviarRespostaDaIa(banco.cliente(), {
      ...ENTRADA,
      texto: aprovado(RESPOSTA),
    });
    expect(r).toMatchObject({ ok: false, code: "conteudo_divergente" });
    expect(fakeSentMessages()).toEqual([]);
  });

  it.each([
    ["CZIA1", "ia_sem_aprovacao"],
    ["CZIA2", "ia_nao_liberada"],
    ["CZIA3", "frase_divergente"],
    ["23505", "registro_falhou"],
  ])(
    "o gatilho de message recusa com %s: %s, nada sai",
    async (sqlstate, codigo) => {
      banco.aoInserir = (tabela) =>
        tabela === "message" ? { code: sqlstate, message: "x" } : null;
      const r = await enviarRespostaDaIa(banco.cliente(), {
        ...ENTRADA,
        texto: aprovado(RESPOSTA),
      });
      expect(r).toMatchObject({ ok: false, code: codigo });
      expect(fakeSentMessages()).toEqual([]);
      if (!r.ok) {
        expect(envioCertamenteNaoSaiu(r)).toBe(true);
      }
    },
  );

  it("string crua não compila como resposta da IA", () => {
    const naoRoda = () =>
      enviarRespostaDaIa(banco.cliente(), {
        ...ENTRADA,
        // @ts-expect-error so TextoAprovado (saido do filtro) vai como 'ia'
        texto: "Pode tomar dipirona",
      });
    expect(typeof naoRoda).toBe("function");
  });
});

describe("enviarFraseFixaDaIa", () => {
  it("sai como 'sistema' com a frase fixa, a guarda de frase e sem mexer na espera", async () => {
    const r = await enviarFraseFixaDaIa(banco.cliente(), ENTRADA);
    expect(r.ok).toBe(true);
    expect(fakeSentMessages().map((m) => m.body)).toEqual([
      FRASE_DE_ESCALONAMENTO,
    ]);
    expect(guardas).toEqual(["frase", "frase"]);
    expect(banco.linhas("message")[0]).toMatchObject({
      author: "sistema",
      body: FRASE_DE_ESCALONAMENTO,
      job_id: JOB,
    });
    expect(banco.chamadasDe("ia_marcar_respondida")).toEqual([]);
    expect(banco.linhas("conversation")[0]?.awaiting_reply).toBe(true);
  });

  it("a porta não recebe corpo: o texto é sempre a frase", async () => {
    const comCorpo = {
      ...ENTRADA,
      body: "texto cru da IA",
      texto: "texto cru da IA",
    } as EnvioDaIaInput;
    await enviarFraseFixaDaIa(banco.cliente(), comCorpo);
    expect(fakeSentMessages().map((m) => m.body)).toEqual([
      FRASE_DE_ESCALONAMENTO,
    ]);
  });

  it("canal ocupado: devolve slot_adiado sem gravar (quem chama não reagenda)", async () => {
    banco.rpc("reservar_slot_envio_v2", () => ({
      data: { estado: "adiado", livre_em: "2026-10-13T12:00:30.000Z" },
      error: null,
    }));
    const r = await enviarFraseFixaDaIa(banco.cliente(), ENTRADA);
    expect(r).toMatchObject({ ok: false, reason: "slot_adiado" });
    expect(banco.linhas("message")).toEqual([]);
    expect(fakeSentMessages()).toEqual([]);
  });

  it("a guarda da frase recusa: nada sai", async () => {
    montar(["fora_da_ia"]);
    const r = await enviarFraseFixaDaIa(banco.cliente(), ENTRADA);
    expect(r).toMatchObject({ ok: false, code: "fora_da_ia" });
    expect(fakeSentMessages()).toEqual([]);
  });
});
