import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/integrations/whatsapp/provider", () => ({
  getWhatsAppProvider: () => ({ isOfficialChannel: false }),
}));
vi.mock("@/lib/integrations/whatsapp/send", () => ({
  carregarInstancia: vi.fn(),
  falhaPermiteRetry: () => false,
  sendWhatsAppMedia: vi.fn(),
  sendWhatsAppMenu: vi.fn(),
  sendWhatsAppText: vi.fn(),
}));

import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import {
  modeloPedePreparo,
  modeloSemOPreparo,
} from "@/lib/domain/modelo-mensagem";
import { sendWhatsAppMenu } from "@/lib/integrations/whatsapp/send";
import {
  executarPassoDeRegua,
  MOTIVO_SEM_PREPARO_APROVADO,
} from "@/lib/jobs/regua";
import type { Job } from "@/lib/jobs/worker";
import { log } from "@/lib/log";

import { bancoFalso, eUpdate, type ChamadaDeTabela } from "./banco-falso";

// AG7 (D-74, contrato 3.1, REGUA): o {{preparo}} do toque e SO o texto em
// vigor do procedimento da consulta (preparo_em_vigor_do_procedimento:
// aprovado pelo responsavel tecnico vigente), conferido por hash logo antes
// de renderizar. Sem texto em vigor, a linha some; hash ou formato errados,
// tambem, com o log regua_preparo_divergente so com ids. Pos-condicao: com
// o texto em vigor, o corpo leva o texto inteiro; senao, sai sem ele e loga.
// prep_instructions nunca e lido. O "Cobrar agora" e o toque atrasado passam
// pelo mesmo caminho. Nada de rede nem de banco.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const CONSULTA = "44444444-4444-4444-8444-444444444444";
const CONTATO = "55555555-5555-4555-8555-555555555555";
const JOB = "66666666-6666-4666-8666-666666666666";
const PROCEDIMENTO = "77777777-7777-4777-8777-777777777777";
const VERSAO = "e7e70000-0000-4000-8000-000000000001";
const WORKER = "worker-de-teste";

const MIN = 60_000;
const HORA = 60 * MIN;
// 12h em Fortaleza (UTC-3).
const AGORA = new Date("2026-10-27T15:00:00.000Z").getTime();

const APROVADO =
  "Venha em jejum de 8 horas.\nTome 2 comprimidos de bisacodil às 18h da véspera.";
const ANTIGO = "Texto antigo do Cadastro, sem aprovação do RT.";
const MODELO =
  "Oi, {{nome}}! Sua {{procedimento}} é dia {{data}} às {{hora}}.\n{{ preparo }}\nPodemos confirmar sua presença?";

type Cenario = {
  modelo?: string;
  /** O retorno de preparo_em_vigor_do_procedimento. */
  preparo?: unknown;
  erroDoPreparo?: boolean;
  /** O codigo do erro da leitura (padrao: 57014). */
  codigoDoErro?: string;
  manual?: boolean;
  /** O toque venceu num dia e sai no seguinte (o toque atrasado). */
  atrasado?: boolean;
};

function montar(c: Cenario = {}) {
  const iso = (epoch: number) => new Date(epoch).toISOString();
  const inicioDaConsulta = c.atrasado ? AGORA + 4 * HORA : AGORA + 20 * HORA;
  const run = {
    id: RUN,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    appointment_id: CONSULTA,
    scheduled_for: iso(inicioDaConsulta - 1440 * MIN),
    sent_at: null,
    skipped_reason: null,
    cadence_step: {
      id: "passo",
      offset_minutes: -1440,
      fixed_body: c.modelo ?? MODELO,
      media_path: null,
      media_type: null,
      media_mimetype: null,
      media_filename: null,
      cadence: {
        id: "regua",
        kind: "confirmacao",
        active: true,
        send_window_start: "00:00",
        send_window_end: "23:59",
        send_weekdays: [0, 1, 2, 3, 4, 5, 6],
        trigger_stage: null,
      },
    },
    contact: {
      name: "Paciente",
      funnel_stage: "agendou",
      funnel_stage_changed_at: iso(AGORA - 30 * HORA),
      last_contact_at: null,
    },
    clinic: { name: "Clínica", timezone: "America/Fortaleza" },
  };
  const consulta = {
    id: CONSULTA,
    status: "agendado",
    starts_at: iso(inicioDaConsulta),
    send_confirmation: true,
    remarcacao_pedida_em: null,
    service_link: {
      // O banco antigo ainda tem a coluna: ela nunca entra no toque.
      procedure: {
        id: PROCEDIMENTO,
        name: "Colonoscopia",
        prep_instructions: ANTIGO,
      },
    },
    professional: { name: "Dra. Teste" },
  };
  return bancoFalso({
    tabelas: {
      cadence_run: (chamada) =>
        eUpdate(chamada)
          ? { data: null, error: null }
          : { data: run, error: null },
      appointment: () => ({ data: consulta, error: null }),
      cadence_step: () => ({ data: [], error: null }),
      whatsapp_account: () => ({
        data: {
          provider: "fake",
          connection_status: "conectado",
          removido_em: null,
        },
        error: null,
      }),
    },
    rpcs: {
      consentimento_vigente: () => ({ data: true, error: null }),
      regua_da_consulta: () => ({ data: "regua", error: null }),
      numero_do_job: () => ({
        data: { estado: "ok", whatsapp_account_id: NUMERO },
        error: null,
      }),
      garantir_conversa_aberta: () => ({ data: "conversa-1", error: null }),
      confirmar_posse_job: () => ({ data: true, error: null }),
      reagendar_job: () => ({ data: true, error: null }),
      preparo_em_vigor_do_procedimento: () =>
        c.erroDoPreparo
          ? { data: null, error: { code: c.codigoDoErro ?? "57014" } }
          : { data: c.preparo ?? null, error: null },
    },
  });
}

function emVigor(texto = APROVADO) {
  return {
    versao_id: VERSAO,
    texto,
    texto_sha256: sha256DoTexto(texto),
  };
}

function job(manual = false): Job {
  return {
    id: JOB,
    clinic_id: CLINICA,
    kind: "executar_passo_de_regua",
    payload: { cadence_run_id: RUN, ...(manual ? { manual: true } : {}) },
    attempts: 1,
    max_attempts: 8,
    whatsapp_account_id: NUMERO,
  };
}

/** O corpo que o toque mandou (o texto dos botoes da confirmacao). */
function corpoEnviado(): string {
  const chamadas = vi.mocked(sendWhatsAppMenu).mock.calls;
  expect(chamadas).toHaveLength(1);
  return String((chamadas[0]?.[1] as { body?: unknown }).body ?? "");
}

function selectDaConsulta(chamadas: ChamadaDeTabela[]): string {
  const daConsulta = chamadas.find((c) => c.tabela === "appointment");
  return String(
    daConsulta?.metodos.find((m) => m.metodo === "select")?.args[0] ?? "",
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.mocked(sendWhatsAppMenu).mockReset();
  vi.mocked(sendWhatsAppMenu).mockResolvedValue({
    ok: true,
    messageId: "msg-1",
  } as never);
  vi.mocked(log.warn).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  // Nenhum texto de preparo em log (so ids e codigos).
  const tudo = JSON.stringify([
    vi.mocked(log.warn).mock.calls,
    vi.mocked(log.info).mock.calls,
    vi.mocked(log.error).mock.calls,
  ]);
  expect(tudo).not.toContain("jejum");
  expect(tudo).not.toContain("bisacodil");
  expect(tudo).not.toContain(ANTIGO);
});

describe("modeloPedePreparo: a mesma leitura do renderizador", () => {
  it.each([
    ["{{preparo}}", true],
    ["Antes: {{ preparo }}.", true],
    ["{{nome}} e {{data}}", false],
    ["{{preparos}}", false],
    ["", false],
  ])("%s: %s", (modelo, esperado) => {
    expect(modeloPedePreparo(modelo)).toBe(esperado);
  });
});

describe("o {{preparo}} do toque", () => {
  it("com o texto em vigor: o toque leva o texto aprovado inteiro, palavra por palavra; prep_instructions nem e lido", async () => {
    const b = montar({ preparo: emVigor() });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    const corpo = corpoEnviado();
    expect(corpo).toContain(APROVADO);
    expect(corpo).toBe(
      `Oi, Paciente! Sua Colonoscopia é dia 28/10/2026 às 08:00.\n${APROVADO}\nPodemos confirmar sua presença?`,
    );
    expect(corpo).not.toContain(ANTIGO);
    // A leitura pelo procedimento da consulta, com a clinica explicita.
    expect(b.chamadasDe("preparo_em_vigor_do_procedimento")).toEqual([
      { p_clinic_id: CLINICA, p_procedure_id: PROCEDIMENTO },
    ]);
    const select = selectDaConsulta(b.tabelas);
    expect(select).toContain("procedure:procedure_id ( id, name )");
    expect(select).not.toContain("prep_instructions");
  });

  it("sem texto em vigor (so o aguardando, o devolvido ou o antigo): a linha some inteira, sem linha em branco", async () => {
    const b = montar({ preparo: null });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    const corpo = corpoEnviado();
    expect(corpo).toBe(
      "Oi, Paciente! Sua Colonoscopia é dia 28/10/2026 às 08:00.\nPodemos confirmar sua presença?",
    );
    expect(vi.mocked(log.warn)).not.toHaveBeenCalledWith(
      "regua_preparo_divergente",
      expect.anything(),
    );
  });

  it.each([
    ["hash", { ...emVigor(), texto_sha256: "0".repeat(64) }],
    ["formato", { ...emVigor(), versao_id: "nao-e-uuid" }],
    ["formato", { versao_id: VERSAO, texto: 7, texto_sha256: "x" }],
  ])(
    "o texto que nao confere (%s): o toque sai sem ele, e o log so com ids",
    async (status, preparo) => {
      const b = montar({ preparo });
      expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
        ok: true,
      });
      expect(corpoEnviado()).not.toContain("jejum");
      expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
        "regua_preparo_divergente",
        { clinic_id: CLINICA, job_id: JOB, status },
      );
    },
  );

  it("a pos-condicao: o renderizador mexeu no texto (as chaves duplas que ele apaga): o toque sai sem ele e loga", async () => {
    const comChaves = "Venha em jejum de 8 horas {{e}} traga o pedido.";
    const b = montar({ preparo: emVigor(comChaves) });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(corpoEnviado()).toBe(
      "Oi, Paciente! Sua Colonoscopia é dia 28/10/2026 às 08:00.\nPodemos confirmar sua presença?",
    );
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
      "regua_preparo_divergente",
      { clinic_id: CLINICA, job_id: JOB, status: "fora_do_corpo" },
    );
  });

  it("o modelo sem {{preparo}}: nada e lido", async () => {
    const b = montar({
      modelo: "Oi, {{nome}}! Podemos confirmar sua presença?",
      preparo: emVigor(),
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(b.chamadasDe("preparo_em_vigor_do_procedimento")).toEqual([]);
    expect(corpoEnviado()).toBe(
      "Oi, Paciente! Podemos confirmar sua presença?",
    );
  });

  it("erro da leitura: o job tenta de novo (nada sai)", async () => {
    const b = montar({ erroDoPreparo: true });
    await expect(executarPassoDeRegua(b.admin, job(), WORKER)).rejects.toThrow(
      "preparo_ilegivel",
    );
    expect(vi.mocked(sendWhatsAppMenu)).not.toHaveBeenCalled();
  });

  it("o Cobrar agora (manual) e o toque atrasado: o mesmo caminho, o mesmo texto", async () => {
    const manual = montar({ preparo: emVigor() });
    expect(await executarPassoDeRegua(manual.admin, job(true), WORKER)).toEqual(
      { ok: true },
    );
    expect(corpoEnviado()).toContain(APROVADO);

    vi.mocked(sendWhatsAppMenu).mockClear();
    const atrasado = montar({ preparo: emVigor(), atrasado: true });
    expect(await executarPassoDeRegua(atrasado.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    const corpo = corpoEnviado();
    expect(corpo).toContain(APROVADO);
    expect(corpo).toContain("27/10/2026 às 16:00");
  });
});

// ---------------------------------------------------------------------------
// Revisao da AG7
// ---------------------------------------------------------------------------

describe("revisao da AG7 (CFM-2): o texto em vigor com recusa nunca sai", () => {
  it.each([
    [
      "promessa de resultado",
      "Venha sem maquiagem. Resultado garantido, você vai sair renovada!",
      "promessa_resultado",
    ],
    [
      "oferta casada",
      "Jejum de 8 horas. Na compra do exame, o retorno sai de brinde.",
      "oferta_casada",
    ],
    [
      "link",
      "Jejum de 8 horas. Veja o vídeo em https://exemplo.com/preparo.",
      "formato_invalido",
    ],
  ])(
    "%s: a linha some, o resto da confirmacao sai, e o log so com as categorias",
    async (_n, texto, categoria) => {
      const b = montar({ preparo: emVigor(texto) });
      expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
        ok: true,
      });
      expect(corpoEnviado()).toBe(
        "Oi, Paciente! Sua Colonoscopia é dia 28/10/2026 às 08:00.\nPodemos confirmar sua presença?",
      );
      expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
        "regua_preparo_recusado",
        { clinic_id: CLINICA, job_id: JOB, kind: categoria },
      );
      const tudo = JSON.stringify(vi.mocked(log.warn).mock.calls);
      expect(tudo).not.toContain(texto.slice(0, 20));
    },
  );
});

describe("revisao da AG7 (BANCO-4): a funcao do banco ausente (o rollback com este codigo no ar)", () => {
  it.each(["42883", "PGRST202"])(
    "%s: a linha do {{preparo}} some e o resto da confirmacao sai, sem tentar de novo",
    async (codigo) => {
      const b = montar({ erroDoPreparo: true, codigoDoErro: codigo });
      expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
        ok: true,
      });
      expect(corpoEnviado()).toBe(
        "Oi, Paciente! Sua Colonoscopia é dia 28/10/2026 às 08:00.\nPodemos confirmar sua presença?",
      );
      expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
        "regua_preparo_sem_funcao",
        { clinic_id: CLINICA, job_id: JOB, error_code: codigo },
      );
    },
  );

  it("outro erro continua tentando de novo (nada sai)", async () => {
    const b = montar({ erroDoPreparo: true, codigoDoErro: "08006" });
    await expect(executarPassoDeRegua(b.admin, job(), WORKER)).rejects.toThrow(
      "preparo_ilegivel: 08006",
    );
    expect(vi.mocked(sendWhatsAppMenu)).not.toHaveBeenCalled();
  });
});

describe("revisao da AG7 (MOTOR-4): sem texto em vigor, a linha inteira que pedia {{preparo}} sai", () => {
  it.each([
    ["Preparo: {{preparo}}"],
    ["Lembre do preparo ({{preparo}})."],
    ["Siga o preparo abaixo: {{ preparo }}"],
    ["Siga o preparo abaixo:\n{{preparo}}"],
  ])("%j: o toque sem a linha (e sem a que so a apresentava)", async (meio) => {
    const b = montar({
      modelo: `Oi, {{nome}}! Sua {{procedimento}} é amanhã.\n${meio}\nPodemos confirmar sua presença?`,
      preparo: null,
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(corpoEnviado()).toBe(
      "Oi, Paciente! Sua Colonoscopia é amanhã.\nPodemos confirmar sua presença?",
    );
  });

  it("com o texto em vigor, o modelo fica como esta (a linha leva o texto inteiro)", async () => {
    const b = montar({
      modelo:
        "Oi, {{nome}}!\nSiga o preparo abaixo:\n{{preparo}}\nPodemos confirmar sua presença?",
      preparo: emVigor(),
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(corpoEnviado()).toBe(
      `Oi, Paciente!\nSiga o preparo abaixo:\n${APROVADO}\nPodemos confirmar sua presença?`,
    );
  });

  it("modeloSemOPreparo: so as linhas do preparo (e a apresentacao logo antes) saem", () => {
    expect(
      modeloSemOPreparo(
        "Atenção:\nOi {{nome}}\nSiga:\n{{preparo}}\nAté amanhã.",
      ),
    ).toBe("Atenção:\nOi {{nome}}\nAté amanhã.");
    expect(modeloSemOPreparo("{{preparo}}")).toBe("");
    expect(modeloSemOPreparo("Sem campo nenhum.")).toBe("Sem campo nenhum.");
  });
});

// Revisao curta da AG7 (CURTA-4): a MOTOR-4 tirava a linha inteira do
// {{preparo}}, com o que mais estivesse nela, e o passo de uma linha so nao
// saia (passo_sem_conteudo). Agora sai so o campo e o que apenas o
// apresentava; o passo que fica vazio nao sai, com o motivo gravado no
// toque; e a previa do editor usa a mesma funcao.
describe("revisao curta da AG7 (CURTA-4): sem texto em vigor, so o campo e o que o apresentava saem", () => {
  it.each([
    [
      "o campo no fim da linha da pergunta",
      "Oi, {{nome}}! Confirma {{procedimento}} amanhã às {{hora}}? {{preparo}}",
      "Oi, Paciente! Confirma Colonoscopia amanhã às 08:00?",
    ],
    [
      "o campo no fim da linha da data",
      "Sua consulta é amanhã, {{data}} às {{hora}}. {{preparo}}\nPodemos confirmar sua presença?",
      "Sua consulta é amanhã, 28/10/2026 às 08:00.\nPodemos confirmar sua presença?",
    ],
    [
      "a saudacao terminada em dois pontos antes do campo",
      "Olá {{nome}}, seguem os dados da sua consulta de amanhã:\n{{preparo}}\nData: {{data}} às {{hora}}.",
      "Olá Paciente, seguem os dados da sua consulta de amanhã:\nData: 28/10/2026 às 08:00.",
    ],
    [
      "o rotulo do preparo na mesma linha da pergunta",
      "Confirma {{procedimento}} amanhã? Siga o preparo: {{preparo}}",
      "Confirma Colonoscopia amanhã?",
    ],
    [
      "a apresentacao com uma linha em branco antes do campo",
      "Oi, {{nome}}!\nSiga o preparo abaixo:\n\n{{preparo}}\nPodemos confirmar sua presença?",
      "Oi, Paciente!\n\nPodemos confirmar sua presença?",
    ],
  ])("%s: o resto da mensagem sai", async (_n, modelo, esperado) => {
    const b = montar({ modelo, preparo: null });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(corpoEnviado()).toBe(esperado);
  });

  it("com o texto em vigor, o campo no fim da linha leva o texto inteiro", async () => {
    const b = montar({
      modelo:
        "Oi, {{nome}}! Confirma {{procedimento}} amanhã às {{hora}}? {{preparo}}",
      preparo: emVigor(),
    });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(corpoEnviado()).toBe(
      `Oi, Paciente! Confirma Colonoscopia amanhã às 08:00? ${APROVADO}`,
    );
  });

  it.each([
    ["{{preparo}}"],
    ["Preparo: {{preparo}}"],
    ["Siga o preparo abaixo:\n{{preparo}}"],
  ])(
    "%j sem texto em vigor: o passo fica vazio e nao sai, com o motivo gravado no toque",
    async (modelo) => {
      const b = montar({ modelo, preparo: null });
      expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
        ok: true,
      });
      expect(vi.mocked(sendWhatsAppMenu)).not.toHaveBeenCalled();
      const fechou = b.tabelas.find(
        (c) => c.tabela === "cadence_run" && eUpdate(c),
      );
      expect(
        fechou?.metodos.find((m) => m.metodo === "update")?.args[0],
      ).toEqual({
        skipped_reason: "falha_envio",
        motivo_da_falha: MOTIVO_SEM_PREPARO_APROVADO,
      });
    },
  );

  it("o mesmo passo com o texto em vigor sai com o texto", async () => {
    const b = montar({ modelo: "{{preparo}}", preparo: emVigor() });
    expect(await executarPassoDeRegua(b.admin, job(), WORKER)).toEqual({
      ok: true,
    });
    expect(corpoEnviado()).toBe(APROVADO);
  });

  it("modeloSemOPreparo: as frases da linha que nao so apresentam o preparo ficam", () => {
    expect(modeloSemOPreparo("Lembre do preparo ({{preparo}}).")).toBe("");
    expect(
      modeloSemOPreparo("Preparo: {{preparo}}. Até amanhã, {{nome}}!"),
    ).toBe("Até amanhã, {{nome}}!");
    // A pergunta que cita o preparo fica (ela e a confirmacao).
    expect(
      modeloSemOPreparo("Confirma a consulta e o preparo? {{preparo}}"),
    ).toBe("Confirma a consulta e o preparo?");
    // A linha antes que nao apresenta o preparo fica.
    expect(
      modeloSemOPreparo("Seguem os dados da sua consulta:\n{{preparo}}"),
    ).toBe("Seguem os dados da sua consulta:");
    // Sem o campo, nada muda.
    const semCampo = "Oi, {{nome}}!\nSiga o preparo abaixo:\nAté amanhã.";
    expect(modeloSemOPreparo(semCampo)).toBe(semCampo);
  });
});
