import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  sendWhatsAppMenu,
  sendWhatsAppText,
  type SendTextResult,
} from "@/lib/integrations/whatsapp/send";

import {
  BancoEmMemoria,
  type ManipuladorDeRpc,
  type Resposta,
} from "../ia-whatsapp/banco-em-memoria";
import { aprovarParaTeste } from "../ia-whatsapp/texto-aprovado-de-teste";

// A trava final da conta suspensa em send.ts (onda 1, decisao do dono de
// 20/10/2026): clinica com a conta suspensa nao manda NADA por nenhum
// caminho (texto do atendimento, menu, resposta e frase fixa da IA), e nada
// e gravado (nem linha de message, nem slot, nem trilha). So o booleano do
// banco decide: qualquer outra resposta (erro, PGRST202, 42883, nulo,
// formato estranho) FECHA (leitura_falhou, retentavel). Sem tolerancia para
// funcao ausente: a migration 20261021100000 foi aplicada antes deste
// codigo. A suspensao que chega DURANTE a espera do slot tambem para o envio
// (reconferencia, com a linha marcada). Banco em memoria e provedor falso:
// nada de rede.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const CONTATO = "c1000000-0000-4000-8000-000000000001";
const NUMERO = "a0000000-0000-4000-8000-000000000001";
const JOB = "10000000-0000-4000-8000-000000000001";
const EXECUTOR = "motor-ia:20000000-0000-4000-8000-000000000001";
const TELEFONE = "+5584999990001";
const CORPO = "Bom dia! Passando para lembrar do retorno.";

const RESPOSTA_DA_IA = "A consulta custa R$ 150,00.";
const RESPOSTA_APROVADA: TextoAprovado = await aprovarParaTeste(
  RESPOSTA_DA_IA,
  [15_000],
);

const RECUSA_DA_SUSPENSAO: SendTextResult = {
  ok: false,
  reason: "falha_envio",
  code: "clinica_suspensa",
  message: "A conta desta clínica está suspensa. Nada foi enviado.",
};

let banco: BancoEmMemoria;
let consentimento: Resposta;
let suspensao: ManipuladorDeRpc;
let saida: string[];

function montar() {
  banco = new BancoEmMemoria();
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
  banco.rpc("consentimento_vigente", () => consentimento);
  banco.rpc("reservar_slot_envio_v2", () => ({
    data: { estado: "ok", espera_ms: 0 },
    error: null,
  }));
  banco.rpc("ia_pode_enviar_agora", () => ({ data: "ok", error: null }));
  banco.rpc("ia_marcar_respondida", () => ({ data: true, error: null }));
  banco.rpc("clinica_esta_suspensa", (args) => suspensao(args));
}

/** Os quatro caminhos que passam por enviarPeloCanal. */
const CAMINHOS: [string, () => Promise<SendTextResult>][] = [
  [
    "texto do atendimento",
    () =>
      sendWhatsAppText(banco.cliente(), {
        clinicId: CLINICA,
        conversationId: CONVERSA,
        contactId: CONTATO,
        body: CORPO,
        authorUserId: null,
      }),
  ],
  [
    "menu da régua",
    () =>
      sendWhatsAppMenu(banco.cliente(), {
        clinicId: CLINICA,
        conversationId: CONVERSA,
        contactId: CONTATO,
        body: CORPO,
        authorUserId: null,
        author: "sistema",
        options: [
          { id: "1", text: "Confirmar" },
          { id: "2", text: "Remarcar" },
        ],
      }),
  ],
  [
    "resposta da IA",
    () =>
      enviarRespostaDaIa(banco.cliente(), {
        clinicId: CLINICA,
        conversationId: CONVERSA,
        contactId: CONTATO,
        jobId: JOB,
        workerId: EXECUTOR,
        whatsappAccountId: NUMERO,
        texto: RESPOSTA_APROVADA,
      }),
  ],
  [
    "frase fixa da IA",
    () =>
      enviarFraseFixaDaIa(banco.cliente(), {
        clinicId: CLINICA,
        conversationId: CONVERSA,
        contactId: CONTATO,
        jobId: JOB,
        workerId: EXECUTOR,
        whatsappAccountId: NUMERO,
      }),
  ],
];

/** Nenhuma escrita em tabela nenhuma (message, audit_log, conversation...). */
function escritas() {
  return banco.operacoes.filter((op) => op.operacao !== "select");
}

beforeEach(() => {
  resetFakeProvider();
  consentimento = { data: true, error: null };
  suspensao = () => ({ data: false, error: null });
  montar();
  saida = [];
  const guardar = (pedaco: unknown) => {
    saida.push(String(pedaco));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(guardar);
  vi.spyOn(process.stderr, "write").mockImplementation(guardar);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("conta suspensa: nada sai, nada é gravado", () => {
  it.each(CAMINHOS)("%s", async (_caminho, enviar) => {
    suspensao = () => ({ data: true, error: null });
    expect(await enviar()).toEqual(RECUSA_DA_SUSPENSAO);
    expect(fakeSentMessages()).toEqual([]);
    expect(escritas()).toEqual([]);
    expect(banco.chamadasDe("clinica_esta_suspensa")).toEqual([
      { p_clinic_id: CLINICA },
    ]);
    // Nem o slot do canal nem a guarda da IA chegam a ser pedidos.
    expect(banco.chamadasDe("reservar_slot_envio_v2")).toEqual([]);
    expect(banco.chamadasDe("ia_pode_enviar_agora")).toEqual([]);
  });

  it("vence a autorização revogada: a recusa é a da suspensão, sem trilha de bloqueio", async () => {
    suspensao = () => ({ data: true, error: null });
    consentimento = { data: false, error: null };
    const [, enviar] = CAMINHOS[0]!;
    expect(await enviar()).toEqual(RECUSA_DA_SUSPENSAO);
    expect(escritas()).toEqual([]);
    expect(banco.linhas("audit_log")).toEqual([]);
  });

  it("vence outra leitura que falhou: sabendo que está suspensa, a recusa é essa (não é retry)", async () => {
    suspensao = () => ({ data: true, error: null });
    consentimento = { data: null, error: { code: "57014" } };
    const [, enviar] = CAMINHOS[0]!;
    expect(await enviar()).toEqual(RECUSA_DA_SUSPENSAO);
  });

  it("o código: certo que não saiu, e sem retry automático", () => {
    expect(
      envioCertamenteNaoSaiu({
        reason: "falha_envio",
        code: "clinica_suspensa",
      }),
    ).toBe(true);
    expect(falhaPermiteRetry("clinica_suspensa")).toBe(false);
  });

  it("o log só leva ids: nada do texto nem do telefone", async () => {
    suspensao = () => ({ data: true, error: null });
    const [, enviar] = CAMINHOS[0]!;
    await enviar();
    const linhas = saida.join("");
    expect(linhas).toContain("envio_bloqueado_clinica_suspensa");
    expect(linhas).toContain(CLINICA);
    expect(linhas).toContain(CONVERSA);
    expect(linhas).not.toContain(CORPO);
    expect(linhas).not.toContain(TELEFONE);
  });
});

describe("suspensão que não deu para conferir: falha fechada e retentável", () => {
  it.each<[string, ManipuladorDeRpc]>([
    ["erro do banco", () => ({ data: null, error: { code: "57014" } })],
    ["permissão negada", () => ({ data: null, error: { code: "42501" } })],
    ["resposta fora do formato", () => ({ data: "sim", error: null })],
    // A funcao nunca devolve nulo (exists): nulo e resposta estranha.
    ["resposta nula", () => ({ data: null, error: null })],
    // Cache velho do PostgREST depois de um DROP, ou erro dentro de um
    // corpo quebrado: nao e "a suspensao nao existe".
    [
      "função ausente no Postgres (42883)",
      () => ({ data: null, error: { code: "42883" } }),
    ],
    // O PostgREST nao conhece a funcao: depois da migration aplicada nao ha
    // mais rede para a ordem de publicacao, e isso tambem fecha.
    [
      "função ausente no PostgREST (PGRST202)",
      () => ({ data: null, error: { code: "PGRST202" } }),
    ],
    [
      "falha de rede",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("%s: leitura_falhou, nada sai nem é gravado", async (_caso, resposta) => {
    suspensao = resposta;
    const [, enviar] = CAMINHOS[0]!;
    const r = await enviar();
    expect(r).toMatchObject({
      ok: false,
      reason: "falha_envio",
      code: "leitura_falhou",
    });
    expect(falhaPermiteRetry("leitura_falhou")).toBe(true);
    expect(fakeSentMessages()).toEqual([]);
    expect(escritas()).toEqual([]);
  });
});

describe("conta ativa: o envio segue como sempre", () => {
  it("não suspensa (false): os quatro caminhos enviam", async () => {
    suspensao = () => ({ data: false, error: null });
    for (const [, enviar] of CAMINHOS) {
      resetFakeProvider();
      montar();
      expect((await enviar()).ok).toBe(true);
      expect(fakeSentMessages()).toHaveLength(1);
    }
    expect(saida.join("")).not.toContain("suspensao");
  });
});

describe("suspensão durante a espera do slot: nada sai depois dela", () => {
  /** Ativa na trava final; a resposta dada na reconferencia, depois. */
  function suspensaNaReconferencia(depois: ManipuladorDeRpc): void {
    let leituras = 0;
    suspensao = (args) => {
      leituras += 1;
      return leituras === 1 ? { data: false, error: null } : depois(args);
    };
    banco.rpc("reservar_slot_envio_v2", () => ({
      data: { estado: "ok", espera_ms: 5 },
      error: null,
    }));
  }

  it.each(CAMINHOS)(
    "%s: a recusa da suspensão, a linha marcada e o provedor nunca chamado",
    async (_caminho, enviar) => {
      suspensaNaReconferencia(() => ({ data: true, error: null }));
      expect(await enviar()).toEqual(RECUSA_DA_SUSPENSAO);
      expect(fakeSentMessages()).toEqual([]);
      // As duas leituras: antes do slot e depois da espera.
      expect(banco.chamadasDe("clinica_esta_suspensa")).toEqual([
        { p_clinic_id: CLINICA },
        { p_clinic_id: CLINICA },
      ]);
      // A linha que nasceu antes da espera fica 'falhou' com o codigo da
      // suspensao: um retry nao a reenvia (sem retry automatico).
      expect(banco.linhas("message")).toEqual([
        expect.objectContaining({
          delivery_status: "falhou",
          error_code: "clinica_suspensa",
        }),
      ]);
      expect(falhaPermiteRetry("clinica_suspensa")).toBe(false);
      expect(saida.join("")).toContain("envio_bloqueado_clinica_suspensa");
      expect(saida.join("")).not.toContain(CORPO);
    },
  );

  it("vence a autorização revogada na mesma reconferência: a recusa é a da suspensão", async () => {
    suspensaNaReconferencia(() => ({ data: true, error: null }));
    let consultas = 0;
    banco.rpc("consentimento_vigente", () => {
      consultas += 1;
      return { data: consultas === 1, error: null };
    });
    const [, enviar] = CAMINHOS[0]!;
    expect(await enviar()).toEqual(RECUSA_DA_SUSPENSAO);
    expect(banco.linhas("audit_log")).toEqual([]);
  });

  it("a reconferência que não deu para ler fecha (leitura_falhou), com a linha retentável", async () => {
    suspensaNaReconferencia(() => ({ data: null, error: { code: "57014" } }));
    const [, enviar] = CAMINHOS[0]!;
    expect(await enviar()).toMatchObject({
      ok: false,
      reason: "falha_envio",
      code: "leitura_falhou",
    });
    expect(fakeSentMessages()).toEqual([]);
    expect(banco.linhas("message")).toEqual([
      expect.objectContaining({
        delivery_status: "falhou",
        error_code: "leitura_falhou",
      }),
    ]);
    expect(falhaPermiteRetry("leitura_falhou")).toBe(true);
  });

  it("ativa nas duas leituras: o envio sai depois da espera", async () => {
    suspensaNaReconferencia(() => ({ data: false, error: null }));
    const [, enviar] = CAMINHOS[0]!;
    expect((await enviar()).ok).toBe(true);
    expect(fakeSentMessages()).toHaveLength(1);
    expect(banco.chamadasDe("clinica_esta_suspensa")).toHaveLength(2);
  });
});
