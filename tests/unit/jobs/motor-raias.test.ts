import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// O executor de verdade fica de fora: aqui so importa QUANDO cada job comeca
// e termina, nao o que ele faz.
vi.mock("@/lib/jobs/worker", () => ({
  executarJobComPosse: vi.fn(),
}));

import {
  executarPassagemDoMotor,
  montarGruposDaPassagem,
  raiasDoAmbiente,
} from "@/lib/jobs/motor";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";

import { bancoFalso } from "./banco-falso";

// Quantas raias o claim de envio traz por passagem (contrato da Fase 3, fila
// por raia, docs/07). MOTOR_MAX_CLINICAS passou a contar raias, com padrao 8.
// Um valor torto no ambiente nao pode virar um claim recusado a cada
// passagem (NaN ou zero no p_max_clinicas): cai no padrao.

describe("raias por passagem do motor", () => {
  it("sem a variável, o padrão é 8", () => {
    expect(raiasDoAmbiente(undefined)).toBe(8);
  });

  it("inteiro positivo vale como veio", () => {
    expect(raiasDoAmbiente("4")).toBe(4);
    expect(raiasDoAmbiente("12")).toBe(12);
  });

  it.each(["", "  ", "0", "-3", "2.5", "oito", "NaN"])(
    "valor torto (%j) cai no padrão",
    (valor) => {
      expect(raiasDoAmbiente(valor)).toBe(8);
    },
  );
});

// Leitura do investimento da Meta (Fase 4, L1): o job dura ate cerca de 40 s
// e nao tem numero, entao a raia dele seria a clinica. No agruparPorRaia ele
// ficaria em serie com a integracao (ou o envio sem numero) da MESMA clinica,
// e o segundo voltaria com 'orcamento_da_passagem', gastando o teto de 20
// devolucoes. Ele tem claim proprio e roda num grupo so dele.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "22222222-2222-4222-8222-222222222222";

function umJob(
  id: string,
  kind: Job["kind"],
  extra: Partial<Job> = {},
): Job {
  return {
    id,
    clinic_id: CLINICA,
    kind,
    payload: {},
    attempts: 1,
    max_attempts: 5,
    whatsapp_account_id: null,
    ...extra,
  };
}

describe("montarGruposDaPassagem", () => {
  it("o gasto da Meta fica fora da raia da clínica", () => {
    const integracao = umJob("i1", "enviar_conversao_meta");
    const envioSemNumero = umJob("e1", "enviar_mensagem_ativa");
    const gasto = umJob("g1", "sincronizar_gasto_meta");
    const grupos = montarGruposDaPassagem({
      envios: [envioSemNumero],
      midias: [],
      integracoes: [integracao],
      gastos: [gasto],
    });
    // Envio sem numero e integracao da mesma clinica continuam em serie
    // (comportamento de antes); o gasto, sozinho.
    expect(grupos.map((g) => g.map((j) => j.id))).toEqual([["e1", "i1"], ["g1"]]);
  });

  it("cada leitura de gasto é um grupo, mesmo duas da mesma clínica", () => {
    const grupos = montarGruposDaPassagem({
      envios: [umJob("e1", "enviar_mensagem_ativa", { whatsapp_account_id: NUMERO })],
      midias: [umJob("m1", "baixar_midia", { whatsapp_account_id: NUMERO })],
      integracoes: [],
      gastos: [
        umJob("g1", "sincronizar_gasto_meta"),
        umJob("g2", "sincronizar_gasto_meta"),
      ],
    });
    expect(grupos.map((g) => g.map((j) => j.id))).toEqual([
      ["e1", "m1"],
      ["g1"],
      ["g2"],
    ]);
  });
});

describe("executarPassagemDoMotor com leitura de gasto", () => {
  afterEach(() => {
    vi.mocked(executarJobComPosse).mockReset();
  });

  function bancoDoMotor(porKinds: Record<string, Job[]>) {
    return bancoFalso({
      rpcs: {
        claim_jobs_por_clinica: (args) => {
          const kinds = args.p_kinds as string[];
          return { data: porKinds[kinds.join(",")] ?? [], error: null };
        },
      },
    });
  }

  it("reivindica o gasto num quarto claim de 2 raias", async () => {
    vi.mocked(executarJobComPosse).mockResolvedValue("concluido");
    const db = bancoDoMotor({});
    await executarPassagemDoMotor(db.admin, { executorId: "motor-teste" });
    const claims = db.chamadasDe("claim_jobs_por_clinica");
    expect(claims.map((c) => c.p_kinds)).toEqual([
      [
        "enviar_mensagem_ativa",
        "executar_passo_de_regua",
        "enviar_mensagem_agendada",
      ],
      ["baixar_midia"],
      ["enviar_conversao_meta", "oferecer_lista_espera"],
      ["sincronizar_gasto_meta", "resolver_anuncio_meta"],
    ]);
    expect(claims[3]).toMatchObject({
      p_max_clinicas: 2,
      p_incluir_teste: false,
      p_worker: "motor-teste",
    });
  });

  it("gasto e integração da mesma clínica rodam ao mesmo tempo, não em série", async () => {
    const eventos: string[] = [];
    let soltarIntegracao: () => void = () => {};
    const integracaoPresa = new Promise<void>((resolve) => {
      soltarIntegracao = resolve;
    });
    vi.mocked(executarJobComPosse).mockImplementation(async (_admin, _w, job) => {
      eventos.push(`inicio:${job.kind}`);
      if (job.kind === "enviar_conversao_meta") {
        await integracaoPresa;
      }
      eventos.push(`fim:${job.kind}`);
      return "concluido";
    });
    const db = bancoDoMotor({
      "enviar_conversao_meta,oferecer_lista_espera": [
        umJob("i1", "enviar_conversao_meta"),
      ],
      "sincronizar_gasto_meta,resolver_anuncio_meta": [
        umJob("g1", "sincronizar_gasto_meta"),
      ],
    });

    const passagem = executarPassagemDoMotor(db.admin, { executorId: "motor-teste" });
    // Em serie, o gasto so comecaria depois de a integracao terminar, e ela
    // so termina quando soltarmos: este waitFor estouraria.
    await vi.waitFor(() =>
      expect(eventos).toContain("inicio:sincronizar_gasto_meta"),
    );
    expect(eventos).not.toContain("fim:enviar_conversao_meta");
    soltarIntegracao();

    const resultado = await passagem;
    expect(resultado).toMatchObject({
      reivindicados: 2,
      concluidos: 2,
      nao_couberam: 0,
    });
    expect(db.chamadasDe("reagendar_job")).toHaveLength(0);
  });

  it("o gasto cabe no orçamento da passagem (40 s estimados, começa perto de 0)", async () => {
    vi.mocked(executarJobComPosse).mockResolvedValue("concluido");
    const db = bancoDoMotor({
      "sincronizar_gasto_meta,resolver_anuncio_meta": [
        umJob("g1", "sincronizar_gasto_meta"),
      ],
    });
    const resultado = await executarPassagemDoMotor(db.admin, {
      executorId: "motor-teste",
    });
    expect(resultado).toMatchObject({ concluidos: 1, nao_couberam: 0 });
    expect(executarJobComPosse).toHaveBeenCalledTimes(1);
  });
});
