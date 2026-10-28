import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { CHAVE_DO_LEMBRETE } from "@/lib/domain/lembrete-da-oferta";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  ESPERA_MAXIMA_DO_LEMBRETE_MS,
  executarJobComPosse,
  type Job,
} from "@/lib/jobs/worker";
import { log } from "@/lib/log";

import { BancoEmMemoria, type Linha } from "../ia-whatsapp/banco-em-memoria";

// O lembrete da oferta (T-E4, AG5) sai como RESPOSTA 1:1. A conversa fica
// no contador do Atendimento ate ele SAIR, e a varredura de 3 minutos a
// passa para a equipe ("A IA nao respondeu a tempo", ia_sem_resposta no
// planner, 503 na saude). No trilho automatico ele reservava o slot de massa
// do numero, e numa leva de confirmacoes da manha (10 a 30 s entre uma e
// outra) era adiado passagem apos passagem.
//
// Aqui roda o executor de verdade (executarJobComPosse) com o envio de
// verdade (send.ts) sobre o provedor falso. Do banco, so o que o envio
// precisa, em memoria, e um MODELO de reservar_slot_envio_v2 com os dois
// trilhos por numero (migration 20260925131000): a massa espera e empurra
// next_bulk_send_at e o intervalo curto; o 1:1 espera e empurra so o
// intervalo curto (next_send_at). Os toques de confirmacao da regua
// (lib/jobs/regua.ts) reservam o slot com os mesmos parametros do envio em
// massa deste teste (envioAutomatico, 10 a 30 s, teto de 3 s), e nao mudam.
//
// O que NAO esta aqui: a ordem do claim. claim_jobs_por_clinica (no banco)
// pega um job por numero a cada passagem, por prioridade e run_at, e o
// lembrete nasce com a prioridade 0 dos toques (o CHECK
// job_queue_prioridade_valida aceita so 0 e 1). Isto prova o envio na
// passagem em que ele e reivindicado.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "22222222-2222-4222-8222-222222222222";
const OUTRO_NUMERO = "22222222-2222-4222-8222-222222222223";
const CONTATO = "55555555-5555-4555-8555-555555555555";
const OUTRO_CONTATO = "55555555-5555-4555-8555-555555555556";
const CONVERSA_DA_IA = "c0000000-0000-4000-8000-000000000001";
const CONVERSA_DO_TOQUE = "c0000000-0000-4000-8000-000000000002";
const OFERTA = "99999999-9999-4999-8999-999999999999";
const JOB_DO_LEMBRETE = "66666666-6666-4666-8666-666666666661";
const JOB_DO_ECO = "66666666-6666-4666-8666-666666666662";
const JOB_EM_MASSA = "66666666-6666-4666-8666-666666666663";
const OUTRO_JOB_EM_MASSA = "66666666-6666-4666-8666-666666666664";
const EXECUTOR = "motor-fila";
const TELEFONE = "+5585999990001";
const OUTRO_TELEFONE = "+5585999990002";
const TEXTO_DO_LEMBRETE = "Lembrete da oferta (texto de teste)";

const SEG = 1_000;
const MIN = 60 * SEG;
const AGORA = Date.UTC(2026, 9, 28, 11, 0);
const iso = (epoch: number) => new Date(epoch).toISOString();

/** Os dois relogios anti-ban do numero, como whatsapp_account os guarda. */
type SlotDoNumero = { curto: number | null; massa: number | null };

let banco: BancoEmMemoria;
let slot: SlotDoNumero;
let consentimento: boolean;
let numeroDoJob: string;

/**
 * reservar_slot_envio_v2 (migration 20260925131000), so a regra dos dois
 * trilhos: adiado nao grava nada; a massa espera os dois relogios e empurra
 * os dois; o 1:1 espera e empurra so o curto.
 */
function reservarSlot(args: Record<string, unknown>) {
  if (args.p_whatsapp_account_id !== NUMERO) {
    return { data: { estado: "sem_conta" }, error: null };
  }
  const agora = Date.now();
  const massa = args.p_massa === true;
  const livre = massa
    ? Math.max(slot.massa ?? agora, slot.curto ?? agora, agora)
    : Math.max(slot.curto ?? agora, agora);
  const espera = Math.max(0, livre - agora);
  if (espera > Number(args.p_espera_maxima_ms)) {
    return { data: { estado: "adiado", livre_em: iso(livre) }, error: null };
  }
  const espaco = Number(args.p_espaco_ms);
  if (massa) {
    const curto = Math.min(Number(args.p_espaco_curto_ms ?? espaco), espaco);
    slot = { massa: livre + espaco, curto: livre + curto };
  } else {
    slot = { ...slot, curto: livre + espaco };
  }
  return { data: { estado: "reservado", espera_ms: espera }, error: null };
}

const NUMERO_DA_CONVERSA = {
  id: NUMERO,
  provider: "fake",
  server_url: null,
  instance_id: "fake-22222222",
  nome: "Recepção",
  connection_status: "conectado",
  removido_em: null,
};

function montar(): void {
  banco = new BancoEmMemoria();
  banco.linhas("waitlist_offer").push({
    id: OFERTA,
    clinic_id: CLINICA,
    status: "aberta",
    expires_at: iso(AGORA + 30 * MIN),
    declined_by: [],
    offered_to: [CONTATO],
  });
  banco.linhas("conversation").push(
    {
      id: CONVERSA_DA_IA,
      clinic_id: CLINICA,
      contact_id: CONTATO,
      status: "ia_atendendo",
      awaiting_reply: true,
      whatsapp_account_id: NUMERO,
      numero: NUMERO_DA_CONVERSA,
    },
    {
      id: CONVERSA_DO_TOQUE,
      clinic_id: CLINICA,
      contact_id: OUTRO_CONTATO,
      status: "aberta",
      awaiting_reply: false,
      whatsapp_account_id: NUMERO,
      numero: NUMERO_DA_CONVERSA,
    },
  );
  banco.linhas("contact").push(
    { id: CONTATO, clinic_id: CLINICA, phone_e164: TELEFONE },
    { id: OUTRO_CONTATO, clinic_id: CLINICA, phone_e164: OUTRO_TELEFONE },
  );
  banco.linhas("whatsapp_account_secret").push({
    clinic_id: CLINICA,
    account_id: NUMERO,
    instance_token: "token-de-teste",
  });
  banco
    .rpc("confirmar_posse_job", () => ({ data: true, error: null }))
    .rpc("consentimento_vigente", () => ({ data: consentimento, error: null }))
    .rpc("numero_do_job", () => ({
      data: { estado: "ok", whatsapp_account_id: numeroDoJob },
      error: null,
    }))
    .rpc("garantir_conversa_aberta", (args) => ({
      data:
        args.p_contact_id === CONTATO ? CONVERSA_DA_IA : CONVERSA_DO_TOQUE,
      error: null,
    }))
    .rpc("reservar_slot_envio_v2", reservarSlot)
    .rpc("concluir_job", () => ({ data: null, error: null }))
    .rpc("falhar_job", () => ({ data: null, error: null }))
    .rpc("reagendar_job", () => ({ data: true, error: null }));
}

function umJob(id: string, payload: Record<string, unknown>): Job {
  return {
    id,
    clinic_id: CLINICA,
    kind: "enviar_mensagem_ativa",
    payload,
    attempts: 1,
    max_attempts: 8,
    whatsapp_account_id: NUMERO,
    created_at: iso(AGORA - MIN),
  };
}

/** O lembrete como o interceptador o enfileira. */
const lembrete = () =>
  umJob(JOB_DO_LEMBRETE, {
    contact_id: CONTATO,
    body: TEXTO_DO_LEMBRETE,
    resposta_ao_paciente: true,
    [CHAVE_DO_LEMBRETE]: OFERTA,
  });

/** O eco comum ("Presença confirmada"), sem a chave do lembrete. */
const eco = () =>
  umJob(JOB_DO_ECO, {
    contact_id: OUTRO_CONTATO,
    body: "Eco de teste",
    resposta_ao_paciente: true,
  });

/** Um envio em massa (sem a marca de resposta): o slot de 10 a 30 s. */
const emMassa = (id = JOB_EM_MASSA) =>
  umJob(id, { contact_id: OUTRO_CONTATO, body: "Envio em massa de teste" });

const executar = (job: Job) => executarJobComPosse(banco.cliente(), EXECUTOR, job);

const reservas = () => banco.chamadasDe("reservar_slot_envio_v2");
const enviadasPara = (telefone: string) =>
  fakeSentMessages().filter((m) => m.to === telefone);
const conversa = (id: string) =>
  banco.linhas("conversation").find((c) => c.id === id) as Linha;
const mensagensDoJob = (jobId: string) =>
  banco.linhas("message").filter((m) => m.job_id === jobId);

/** Uma confirmacao acabou de sair: o slot de massa so abre daqui a 25 s. */
function levaDeConfirmacoesEmCurso(): void {
  slot = { curto: AGORA - SEG, massa: AGORA + 25 * SEG };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  resetFakeProvider();
  consentimento = true;
  numeroDoJob = NUMERO;
  slot = { curto: null, massa: null };
  montar();
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(log.info).mockClear();
  vi.mocked(log.warn).mockClear();
  vi.mocked(log.error).mockClear();
});

describe("o lembrete da oferta sai como resposta 1:1", () => {
  it("com o slot de massa ocupado pela leva de confirmações, sai na passagem em que é reivindicado", async () => {
    levaDeConfirmacoesEmCurso();
    expect(await executar(lembrete())).toBe("concluido");

    expect(enviadasPara(TELEFONE)).toEqual([
      expect.objectContaining({
        body: TEXTO_DO_LEMBRETE,
        accountId: NUMERO,
        clinicId: CLINICA,
      }),
    ]);
    // Trilho 1:1: sem o slot de massa, o espacamento curto e o teto da
    // resposta 1:1, pelo numero que recebeu.
    expect(reservas()).toHaveLength(1);
    const reserva = reservas()[0]!;
    expect(reserva).toMatchObject({
      p_clinic_id: CLINICA,
      p_massa: false,
      p_espera_maxima_ms: ESPERA_MAXIMA_DO_LEMBRETE_MS,
      p_whatsapp_account_id: NUMERO,
    });
    expect(reserva.p_espaco_ms).toBeGreaterThanOrEqual(1_500);
    expect(reserva.p_espaco_ms).toBeLessThan(4_000);
    expect(banco.chamadasDe("reagendar_job")).toEqual([]);
    expect(banco.chamadasDe("concluir_job")).toHaveLength(1);
  });

  it("não mexe no slot de massa: só o intervalo curto anda", async () => {
    levaDeConfirmacoesEmCurso();
    await executar(lembrete());
    const espaco = Number(reservas()[0]!.p_espaco_ms);
    expect(slot).toEqual({ massa: AGORA + 25 * SEG, curto: AGORA + espaco });
  });

  it("saiu: a conversa da IA sai do contador, e a mensagem fica gravada com o custo do canal não oficial", async () => {
    levaDeConfirmacoesEmCurso();
    await executar(lembrete());
    expect(conversa(CONVERSA_DA_IA).awaiting_reply).toBe(false);
    expect(mensagensDoJob(JOB_DO_LEMBRETE)).toEqual([
      expect.objectContaining({
        clinic_id: CLINICA,
        conversation_id: CONVERSA_DA_IA,
        direction: "saida",
        author: "sistema",
        body: TEXTO_DO_LEMBRETE,
        cost_cents: 0,
        billable: false,
        delivery_status: "enviada",
      }),
    ]);
  });

  it("respeita o intervalo curto do número (o anti-ban da resposta 1:1): espera e reconfere a autorização", async () => {
    // Uma resposta da IA acabou de sair por este numero.
    slot = { curto: AGORA + 300, massa: AGORA + 25 * SEG };
    expect(await executar(lembrete())).toBe("concluido");
    expect(reservas()[0]).toMatchObject({ p_massa: false });
    const espaco = Number(reservas()[0]!.p_espaco_ms);
    expect(slot.curto).toBe(AGORA + 300 + espaco);
    expect(slot.massa).toBe(AGORA + 25 * SEG);
    // O executor, o envio e a reconferencia depois da espera.
    expect(banco.chamadasDe("consentimento_vigente")).toHaveLength(3);
    expect(enviadasPara(TELEFONE)).toHaveLength(1);
  });

  it("com envios 1:1 empilhados além do teto: volta para a fila sem enviar, sem reservar e sem tirar do contador", async () => {
    slot = { curto: AGORA + 9 * SEG, massa: null };
    expect(await executar(lembrete())).toBe("reagendado");
    expect(banco.chamadasDe("reagendar_job")).toEqual([
      expect.objectContaining({
        p_id: JOB_DO_LEMBRETE,
        p_run_at: iso(AGORA + 9 * SEG),
        p_motivo: "canal_ocupado",
      }),
    ]);
    expect(slot).toEqual({ curto: AGORA + 9 * SEG, massa: null });
    expect(fakeSentMessages()).toEqual([]);
    expect(mensagensDoJob(JOB_DO_LEMBRETE)).toEqual([]);
    expect(conversa(CONVERSA_DA_IA).awaiting_reply).toBe(true);
  });
});

describe("os outros envios não mudam", () => {
  it("o envio em massa depois do lembrete continua espaçado: espera o slot de massa da confirmação anterior", async () => {
    levaDeConfirmacoesEmCurso();
    await executar(lembrete());

    // Na mesma hora, o proximo envio em massa do numero nao sai: o slot de
    // massa e o da confirmacao anterior (o lembrete nao o tocou).
    expect(await executar(emMassa())).toBe("reagendado");
    expect(banco.chamadasDe("reagendar_job")).toEqual([
      expect.objectContaining({
        p_id: JOB_EM_MASSA,
        p_run_at: iso(AGORA + 25 * SEG),
        p_motivo: "canal_ocupado",
      }),
    ]);
    expect(reservas()[1]).toMatchObject({
      p_massa: true,
      p_espera_maxima_ms: 3_000,
    });
    expect(enviadasPara(OUTRO_TELEFONE)).toEqual([]);

    // Quando o slot de massa abre, sai, e empurra o proximo em 10 a 30 s.
    vi.setSystemTime(AGORA + 25 * SEG);
    expect(await executar(emMassa())).toBe("concluido");
    const reserva = reservas()[2]!;
    expect(reserva).toMatchObject({ p_massa: true, p_espera_maxima_ms: 3_000 });
    expect(reserva.p_espaco_ms).toBeGreaterThanOrEqual(10_000);
    expect(reserva.p_espaco_ms).toBeLessThan(30_000);
    expect(slot.massa).toBe(AGORA + 25 * SEG + Number(reserva.p_espaco_ms));
    expect(enviadasPara(OUTRO_TELEFONE)).toHaveLength(1);

    // O seguinte, logo depois, espera esse espacamento inteiro.
    expect(await executar(emMassa(OUTRO_JOB_EM_MASSA))).toBe("reagendado");
    expect(banco.chamadasDe("reagendar_job").at(-1)).toMatchObject({
      p_id: OUTRO_JOB_EM_MASSA,
      p_run_at: iso(AGORA + 25 * SEG + Number(reserva.p_espaco_ms)),
    });
  });

  it("o eco comum continua no trilho automático: espera o slot de massa, com o espaçamento curto do 1:1", async () => {
    levaDeConfirmacoesEmCurso();
    expect(await executar(eco())).toBe("reagendado");
    const reserva = reservas()[0]!;
    expect(reserva).toMatchObject({ p_massa: true, p_espera_maxima_ms: 3_000 });
    expect(reserva.p_espaco_ms).toBeGreaterThanOrEqual(1_500);
    expect(reserva.p_espaco_ms).toBeLessThan(4_000);
    expect(banco.chamadasDe("reagendar_job")).toEqual([
      expect.objectContaining({
        p_id: JOB_DO_ECO,
        p_run_at: iso(AGORA + 25 * SEG),
      }),
    ]);
    expect(fakeSentMessages()).toEqual([]);
  });
});

describe("as guardas do lembrete continuam valendo no trilho 1:1", () => {
  it("sem a autorização para receber mensagens: nada sai, nada é reservado, e a trilha registra", async () => {
    consentimento = false;
    expect(await executar(lembrete())).toBe("falhou");
    expect(banco.chamadasDe("falhar_job")).toEqual([
      expect.objectContaining({
        p_erro: "sem_consentimento",
        p_definitivo: true,
      }),
    ]);
    expect(reservas()).toEqual([]);
    expect(fakeSentMessages()).toEqual([]);
    expect(banco.linhas("audit_log")).toEqual([
      expect.objectContaining({
        clinic_id: CLINICA,
        action: "envio_bloqueado_sem_autorizacao",
        entity_id: CONTATO,
      }),
    ]);
    expect(conversa(CONVERSA_DA_IA).awaiting_reply).toBe(true);
  });

  it("a oferta fechou (outro candidato aceitou): nada sai e nada é reservado", async () => {
    const oferta = banco.linhas("waitlist_offer")[0]!;
    oferta.status = "preenchida";
    expect(await executar(lembrete())).toBe("falhou");
    expect(banco.chamadasDe("falhar_job")).toEqual([
      expect.objectContaining({
        p_erro: "oferta_encerrada",
        p_definitivo: true,
      }),
    ]);
    expect(reservas()).toEqual([]);
    expect(fakeSentMessages()).toEqual([]);
  });

  it("o número que recebeu saiu (o banco recarimbou outro): nada sai por outro número", async () => {
    numeroDoJob = OUTRO_NUMERO;
    expect(await executar(lembrete())).toBe("falhou");
    expect(banco.chamadasDe("falhar_job")).toEqual([
      expect.objectContaining({
        p_erro: "numero_removido",
        p_definitivo: true,
      }),
    ]);
    expect(banco.chamadasDe("garantir_conversa_aberta")).toEqual([]);
    expect(reservas()).toEqual([]);
    expect(fakeSentMessages()).toEqual([]);
  });

  it("uma mensagem por job: a nova tentativa do lembrete que já saiu não manda de novo", async () => {
    expect(await executar(lembrete())).toBe("concluido");
    expect(await executar(lembrete())).toBe("concluido");
    expect(enviadasPara(TELEFONE)).toHaveLength(1);
    expect(mensagensDoJob(JOB_DO_LEMBRETE)).toHaveLength(1);
    expect(reservas()).toHaveLength(1);
  });

  it("nenhum log leva o texto do lembrete nem o telefone", async () => {
    levaDeConfirmacoesEmCurso();
    await executar(lembrete());
    slot = { curto: AGORA + 9 * SEG, massa: null };
    await executar(lembrete());
    const registrado = JSON.stringify([
      vi.mocked(log.info).mock.calls,
      vi.mocked(log.warn).mock.calls,
      vi.mocked(log.error).mock.calls,
    ]);
    expect(registrado).not.toContain(TEXTO_DO_LEMBRETE);
    expect(registrado).not.toContain(TELEFONE);
  });
});
