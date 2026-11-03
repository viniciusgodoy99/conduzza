import { beforeEach, describe, expect, it } from "vitest";

import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import {
  aprovarParaEnvio,
  type PreparoAprovado,
} from "@/lib/domain/conformidade/preparo-aprovado";
import {
  envioCertamenteNaoSaiu,
  falhaPermiteRetry,
} from "@/lib/integrations/whatsapp/falhas-do-envio";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  enviarPreparoAprovadoDaIa,
  enviarRespostaDaIa,
  type EnvioDaIaInput,
} from "@/lib/integrations/whatsapp/send";

import { MENSAGEM_DO_PREPARO_DE_TESTE } from "../../fixtures/ia/conformidade/casos";
import { BancoEmMemoria, type Resposta } from "../ia-whatsapp/banco-em-memoria";

// AG7 (D-80): enviarPreparoAprovadoDaIa, a orientacao de preparo aprovada
// pelo RT, palavra por palavra, como mensagem do SISTEMA no job da IA. So
// aceita PreparoAprovado (so aprovarParaEnvio produz um); o autor e
// 'sistema'; o jobId e obrigatorio; a guarda e a da resposta (a conversa tem
// de estar na IA), antes do slot e logo antes do provedor; o hash e
// conferido antes de tudo e de novo logo antes do provedor
// (conteudo_divergente, nada sai); a autorizacao para receber mensagens e o
// custo (0, nao cobravel) sao os de todo envio; a espera cai por
// ia_marcar_respondida so quando saiu. Nenhum teste fala com o WhatsApp de
// verdade (o provedor 'fake').

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const CONTATO = "c1000000-0000-4000-8000-000000000001";
const NUMERO = "a0000000-0000-4000-8000-000000000001";
const JOB = "10000000-0000-4000-8000-000000000001";
const EXECUTOR = "motor-ia:20000000-0000-4000-8000-000000000001";
const TELEFONE = "+5584999990001";
const VERSAO = "e7e70000-0000-4000-8000-000000000001";
const PROCEDIMENTO = "11111111-1111-4111-8111-111111111111";

const ENTRADA: EnvioDaIaInput = {
  clinicId: CLINICA,
  conversationId: CONVERSA,
  contactId: CONTATO,
  jobId: JOB,
  workerId: EXECUTOR,
  whatsappAccountId: NUMERO,
};

function preparoAprovado(): PreparoAprovado {
  const preparo = aprovarParaEnvio({
    versao_id: VERSAO,
    procedure_id: PROCEDIMENTO,
    versao: 3,
    mensagem: MENSAGEM_DO_PREPARO_DE_TESTE,
    sha256: sha256DoTexto(MENSAGEM_DO_PREPARO_DE_TESTE),
  });
  if (preparo === null) {
    throw new Error("o preparo de teste tem de ser aprovado");
  }
  return preparo;
}

let banco: BancoEmMemoria;
let guardas: string[];
let consentimento: boolean;

function montar(respostasDaGuarda: (Resposta | string)[] = ["ok", "ok"]) {
  banco = new BancoEmMemoria();
  guardas = [];
  consentimento = true;
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
  banco.rpc("consentimento_vigente", () => ({
    data: consentimento,
    error: null,
  }));
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

function nadaSaiu() {
  expect(fakeSentMessages()).toEqual([]);
  expect(banco.chamadasDe("ia_marcar_respondida")).toEqual([]);
}

describe("enviarPreparoAprovadoDaIa", () => {
  it("sai como 'sistema', palavra por palavra, no job da IA, com a guarda da resposta, custo zero e a espera por id", async () => {
    const r = await enviarPreparoAprovadoDaIa(banco.cliente(), {
      ...ENTRADA,
      preparo: preparoAprovado(),
    });
    expect(r.ok).toBe(true);
    expect(fakeSentMessages()).toHaveLength(1);
    expect(fakeSentMessages()[0]).toMatchObject({
      accountId: NUMERO,
      to: TELEFONE,
      body: MENSAGEM_DO_PREPARO_DE_TESTE,
    });
    // A guarda da RESPOSTA (a conversa tem de estar na IA), duas vezes.
    expect(guardas).toEqual(["resposta", "resposta"]);
    for (const args of banco.chamadasDe("ia_pode_enviar_agora")) {
      expect(args).toMatchObject({
        p_job_id: JOB,
        p_worker: EXECUTOR,
        p_tipo: "resposta",
        p_telefone: TELEFONE,
      });
    }
    expect(banco.linhas("message")[0]).toMatchObject({
      author: "sistema",
      author_user_id: null,
      direction: "saida",
      content_type: "texto",
      body: MENSAGEM_DO_PREPARO_DE_TESTE,
      job_id: JOB,
      delivery_status: "enviada",
      billable: false,
      cost_cents: 0,
    });
    // O trilho 1:1 e o teto curto da IA.
    expect(banco.chamadasDe("reservar_slot_envio_v2")[0]).toMatchObject({
      p_massa: false,
      p_espera_maxima_ms: 3_000,
    });
    // A espera cai por id, e o autor 'sistema' nao mexe nela pelo UPDATE.
    expect(banco.chamadasDe("ia_marcar_respondida")).toEqual([
      { p_job_id: JOB, p_worker: EXECUTOR },
    ]);
    expect(banco.linhas("conversation")[0]?.awaiting_reply).toBe(true);
  });

  it("o hash que nao confere, antes de tudo: conteudo_divergente, nada e lido, gravado nem enviado", async () => {
    const forjado = {
      ...preparoAprovado(),
      sha256: "0".repeat(64),
    } as unknown as PreparoAprovado;
    const r = await enviarPreparoAprovadoDaIa(banco.cliente(), {
      ...ENTRADA,
      preparo: forjado,
    });
    expect(r).toMatchObject({
      ok: false,
      reason: "falha_envio",
      code: "conteudo_divergente",
    });
    nadaSaiu();
    expect(banco.chamadas).toEqual([]);
    expect(banco.linhas("message")).toEqual([]);
    if (!r.ok) {
      expect(envioCertamenteNaoSaiu(r)).toBe(true);
      expect(falhaPermiteRetry(r.code)).toBe(false);
    }
  });

  it("o jobId e obrigatorio: sem ele, nada sai", async () => {
    const r = await enviarPreparoAprovadoDaIa(banco.cliente(), {
      ...ENTRADA,
      jobId: "",
      preparo: preparoAprovado(),
    });
    expect(r).toMatchObject({ ok: false, code: "conteudo_divergente" });
    nadaSaiu();
    expect(banco.linhas("message")).toEqual([]);
  });

  it("a mensagem que muda depois da linha gravada: a conferencia logo antes do provedor barra (a linha fica 'falhou')", async () => {
    // Um objeto (uma copia nao congelada) que devolve a mensagem certa na
    // primeira leitura e outra depois, o que nunca deveria acontecer com o
    // PreparoAprovado congelado: a segunda conferencia e a que pega.
    const real = { ...preparoAprovado() };
    let leituras = 0;
    const trocado = new Proxy(real, {
      get(alvo, chave, receptor) {
        if (chave === "mensagem") {
          leituras += 1;
          return leituras === 1
            ? alvo.mensagem
            : `${alvo.mensagem} Pode tomar café preto.`;
        }
        return Reflect.get(alvo, chave, receptor);
      },
    }) as unknown as PreparoAprovado;
    const r = await enviarPreparoAprovadoDaIa(banco.cliente(), {
      ...ENTRADA,
      preparo: trocado,
    });
    expect(r).toMatchObject({ ok: false, code: "conteudo_divergente" });
    nadaSaiu();
    expect(banco.linhas("message")[0]).toMatchObject({
      body: MENSAGEM_DO_PREPARO_DE_TESTE,
      delivery_status: "falhou",
      error_code: "conteudo_divergente",
    });
  });

  it("sem autorizacao para receber mensagens: nada sai", async () => {
    consentimento = false;
    const r = await enviarPreparoAprovadoDaIa(banco.cliente(), {
      ...ENTRADA,
      preparo: preparoAprovado(),
    });
    expect(r).toMatchObject({ ok: false, reason: "sem_consentimento" });
    nadaSaiu();
    expect(banco.linhas("message")).toEqual([]);
  });

  it("a guarda da IA recusa (a conversa saiu da IA): nada sai", async () => {
    montar(["fora_da_ia"]);
    const r = await enviarPreparoAprovadoDaIa(banco.cliente(), {
      ...ENTRADA,
      preparo: preparoAprovado(),
    });
    expect(r).toMatchObject({ ok: false, code: "fora_da_ia" });
    nadaSaiu();
  });

  it.each([
    ["CZIA3", "frase_divergente"],
    ["CZIA2", "ia_nao_liberada"],
    ["CZIA1", "ia_sem_aprovacao"],
  ])(
    "o gatilho de message recusa com %s: %s, nada sai",
    async (sqlstate, codigo) => {
      banco.aoInserir = (tabela) =>
        tabela === "message" ? { code: sqlstate, message: "x" } : null;
      const r = await enviarPreparoAprovadoDaIa(banco.cliente(), {
        ...ENTRADA,
        preparo: preparoAprovado(),
      });
      expect(r).toMatchObject({ ok: false, code: codigo });
      nadaSaiu();
      if (!r.ok) {
        expect(envioCertamenteNaoSaiu(r)).toBe(true);
      }
    },
  );

  it("o retry do mesmo job: a linha 'falhou' com codigo de retry e o MESMO corpo e reaproveitada; outro corpo, conteudo_divergente", async () => {
    banco.linhas("message").push({
      id: "m-1",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      author: "sistema",
      body: MENSAGEM_DO_PREPARO_DE_TESTE,
      delivery_status: "falhou",
      error_code: "provider_indisponivel",
    });
    const r = await enviarPreparoAprovadoDaIa(banco.cliente(), {
      ...ENTRADA,
      preparo: preparoAprovado(),
    });
    expect(r).toEqual({ ok: true, messageId: "m-1" });
    expect(banco.linhas("message")).toHaveLength(1);
    expect(fakeSentMessages().map((m) => m.body)).toEqual([
      MENSAGEM_DO_PREPARO_DE_TESTE,
    ]);

    montar();
    resetFakeProvider();
    banco.linhas("message").push({
      id: "m-2",
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      job_id: JOB,
      author: "sistema",
      body: "Outro texto.",
      delivery_status: "falhou",
      error_code: "provider_indisponivel",
    });
    const outro = await enviarPreparoAprovadoDaIa(banco.cliente(), {
      ...ENTRADA,
      preparo: preparoAprovado(),
    });
    expect(outro).toMatchObject({ ok: false, code: "conteudo_divergente" });
    nadaSaiu();
  });

  it("so PreparoAprovado: o objeto cru nao compila, e o preparo nunca vira resposta da IA", () => {
    const naoRodaCru = () =>
      enviarPreparoAprovadoDaIa(banco.cliente(), {
        ...ENTRADA,
        // @ts-expect-error so o PreparoAprovado (saido de aprovarParaEnvio)
        preparo: {
          mensagem: MENSAGEM_DO_PREPARO_DE_TESTE,
          sha256: sha256DoTexto(MENSAGEM_DO_PREPARO_DE_TESTE),
          versaoId: VERSAO,
          procedureId: PROCEDIMENTO,
          versao: 3,
        },
      });
    const naoRodaComoResposta = () =>
      enviarRespostaDaIa(banco.cliente(), {
        ...ENTRADA,
        // @ts-expect-error o preparo nunca e TextoAprovado (nao passa pelo filtro)
        texto: preparoAprovado(),
      });
    expect(typeof naoRodaCru).toBe("function");
    expect(typeof naoRodaComoResposta).toBe("function");
  });
});
