import { describe, expect, it } from "vitest";

import {
  agruparPorRaia,
  fraseDeNumerosDesconectados,
  lerContasDeEnvio,
  lerNumeroDoJob,
  nomesParaATela,
  raiaDoJob,
} from "@/lib/jobs/numero-de-envio";

// Por qual numero um envio sai (varios numeros por clinica, docs/07, Fase 2).
// O banco decide (numero_do_job, contas_de_envio); aqui mora so a leitura do
// que ele respondeu, a raia do motor e a frase que nomeia o numero fora do ar.

const NUMERO_A = "11111111-1111-4111-8111-111111111111";
const NUMERO_B = "22222222-2222-4222-8222-222222222222";
const CLINICA = "33333333-3333-4333-8333-333333333333";

describe("lerNumeroDoJob", () => {
  it("ok com numero valido", () => {
    expect(
      lerNumeroDoJob({ estado: "ok", whatsapp_account_id: NUMERO_A }),
    ).toEqual({ estado: "ok", whatsappAccountId: NUMERO_A });
  });

  it("os estados sem numero passam como vieram", () => {
    for (const estado of [
      "numero_removido",
      "sem_numero",
      "nao_se_aplica",
      "sem_posse",
    ] as const) {
      expect(lerNumeroDoJob({ estado })).toEqual({ estado });
    }
  });

  it("ok sem numero, ou com numero que nao e uuid, e leitura falha: nada sai por palpite", () => {
    expect(lerNumeroDoJob({ estado: "ok" })).toEqual({
      estado: "leitura_falhou",
    });
    expect(
      lerNumeroDoJob({ estado: "ok", whatsapp_account_id: "principal" }),
    ).toEqual({ estado: "leitura_falhou" });
  });

  it("resposta fora do contrato e leitura falha", () => {
    expect(lerNumeroDoJob(null)).toEqual({ estado: "leitura_falhou" });
    expect(lerNumeroDoJob("ok")).toEqual({ estado: "leitura_falhou" });
    expect(lerNumeroDoJob([{ estado: "ok" }])).toEqual({
      estado: "leitura_falhou",
    });
    expect(lerNumeroDoJob({ estado: "desconhecido" })).toEqual({
      estado: "leitura_falhou",
    });
  });
});

describe("lerContasDeEnvio", () => {
  it("indexa por contato, com nome e conexao", () => {
    const contas = lerContasDeEnvio([
      {
        contact_id: "c1",
        whatsapp_account_id: NUMERO_A,
        nome: "Recepção",
        connection_status: "conectado",
      },
      {
        contact_id: "c2",
        whatsapp_account_id: NUMERO_B,
        nome: "Unidade Sul",
        connection_status: "desconectado",
      },
    ]);
    expect(contas.get("c1")).toEqual({
      whatsappAccountId: NUMERO_A,
      nome: "Recepção",
      conectado: true,
    });
    expect(contas.get("c2")).toEqual({
      whatsappAccountId: NUMERO_B,
      nome: "Unidade Sul",
      conectado: false,
    });
  });

  it("contato sem numero (clinica sem numero ativo) nunca conta como conectado", () => {
    const contas = lerContasDeEnvio([
      {
        contact_id: "c1",
        whatsapp_account_id: null,
        nome: null,
        connection_status: null,
      },
    ]);
    expect(contas.get("c1")).toEqual({
      whatsappAccountId: null,
      nome: null,
      conectado: false,
    });
  });

  it("status que nao e exatamente 'conectado' e desconectado", () => {
    const contas = lerContasDeEnvio([
      {
        contact_id: "c1",
        whatsapp_account_id: NUMERO_A,
        nome: "A",
        connection_status: "conectando",
      },
    ]);
    expect(contas.get("c1")?.conectado).toBe(false);
  });

  it("ignora linha torta e entrada que nao e lista", () => {
    expect(lerContasDeEnvio(null).size).toBe(0);
    expect(lerContasDeEnvio({ contact_id: "c1" }).size).toBe(0);
    expect(
      lerContasDeEnvio([null, 1, { whatsapp_account_id: NUMERO_A }]).size,
    ).toBe(0);
  });
});

describe("nomesParaATela", () => {
  it("com um numero so, nao nomeia: a frase e a de sempre", () => {
    expect(nomesParaATela(["Número principal"], 1)).toEqual([]);
    expect(nomesParaATela(["Número principal"], 0)).toEqual([]);
  });

  it("com mais de um, nomeia sem repetir e sem vazio, na ordem", () => {
    expect(
      nomesParaATela(["Sul", null, "Norte", "Sul", "  ", " Norte "], 3),
    ).toEqual(["Sul", "Norte"]);
  });
});

describe("fraseDeNumerosDesconectados", () => {
  it("sem nome, null (quem chama usa a frase da clinica)", () => {
    expect(fraseDeNumerosDesconectados([])).toBeNull();
    expect(fraseDeNumerosDesconectados(["", "  "])).toBeNull();
  });

  it("um numero", () => {
    expect(fraseDeNumerosDesconectados(["Unidade Sul"])).toBe(
      'O número "Unidade Sul" está desconectado',
    );
  });

  it("dois e tres numeros", () => {
    expect(fraseDeNumerosDesconectados(["Sul", "Norte"])).toBe(
      'Os números "Sul" e "Norte" estão desconectados',
    );
    expect(fraseDeNumerosDesconectados(["Sul", "Norte", "Centro"])).toBe(
      'Os números "Sul", "Norte" e "Centro" estão desconectados',
    );
  });

  it("nunca usa travessao (regra de interface)", () => {
    const travessao = String.fromCharCode(0x2014);
    expect(fraseDeNumerosDesconectados(["A", "B", "C"])).not.toContain(
      travessao,
    );
  });
});

describe("raia do motor", () => {
  it("job com numero corre na raia do numero; sem numero, na da clinica", () => {
    expect(
      raiaDoJob({ clinic_id: CLINICA, whatsapp_account_id: NUMERO_A }),
    ).toBe(NUMERO_A);
    expect(raiaDoJob({ clinic_id: CLINICA, whatsapp_account_id: null })).toBe(
      CLINICA,
    );
    expect(raiaDoJob({ clinic_id: CLINICA })).toBe(CLINICA);
  });

  it("dois numeros da mesma clinica viram duas raias; a ordem de chegada fica", () => {
    const jobs = [
      { id: "1", clinic_id: CLINICA, whatsapp_account_id: NUMERO_A },
      { id: "2", clinic_id: CLINICA, whatsapp_account_id: NUMERO_B },
      { id: "3", clinic_id: CLINICA, whatsapp_account_id: NUMERO_A },
      { id: "4", clinic_id: CLINICA, whatsapp_account_id: null },
    ];
    const grupos = agruparPorRaia(jobs);
    expect([...grupos.keys()]).toEqual([NUMERO_A, NUMERO_B, CLINICA]);
    expect(grupos.get(NUMERO_A)?.map((j) => j.id)).toEqual(["1", "3"]);
    expect(grupos.get(NUMERO_B)?.map((j) => j.id)).toEqual(["2"]);
    expect(grupos.get(CLINICA)?.map((j) => j.id)).toEqual(["4"]);
  });

  it("com um numero por clinica, a raia e a clinica de antes (um grupo por clinica)", () => {
    const outraClinica = "44444444-4444-4444-8444-444444444444";
    const jobs = [
      { clinic_id: CLINICA, whatsapp_account_id: NUMERO_A },
      { clinic_id: outraClinica, whatsapp_account_id: NUMERO_B },
      { clinic_id: CLINICA, whatsapp_account_id: NUMERO_A },
    ];
    expect(agruparPorRaia(jobs).size).toBe(2);
  });
});
