import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MENSAGEM_BLOQUEADO_SEM_ENCAIXE,
  MENSAGEM_HORARIO_BLOQUEADO,
  MENSAGEM_SEM_CONFERIR_AGENDA,
  recusaPorBloqueio,
} from "@/lib/domain/remarcacao";

// Revisao de 02/10/2026 (agenda-bloqueio 1): criarAgendamentoAction so
// conferia bloqueio no encaixe. Com a agenda em cache (o bloqueio nao tem
// tempo real), a recepcao marcava consulta comum dentro do bloqueio que o
// gestor acabara de criar em outro computador. Agora TODA consulta confere,
// como na remarcacao: a comum nao entra em bloqueio nenhum, o encaixe so nao
// entra no que impede encaixe, e erro na leitura recusa (nunca grava sem
// conferir). Contra um cliente do Supabase dublado que aplica os filtros.

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const OUTRA_CLINICA = "0a0a0a0a-0000-4000-8000-00000000000b";
const JOAO = "1b1b1b1b-0000-4000-8000-000000000001";
const ANA = "1b1b1b1b-0000-4000-8000-000000000002";
const VINCULO = "2c2c2c2c-0000-4000-8000-000000000001";
const CONTATO = "3d3d3d3d-0000-4000-8000-000000000001";

// 06/10/2026 em Fortaleza (UTC-3): 15:00 local = 18:00 UTC.
const AS_15H = "2026-10-06T18:00:00.000Z";
const AS_15H30 = "2026-10-06T18:30:00.000Z";

type Linha = Record<string, unknown>;
type Erro = { code?: string; message: string };

const estado = {
  tabelas: {} as Record<string, Linha[]>,
  erroNaLeitura: {} as Record<string, Erro | null>,
  inseridos: {} as Record<string, Linha[]>,
};

function consulta(tabela: string) {
  const filtros: ((linha: Linha) => boolean)[] = [];
  const resultado = () => {
    const erro = estado.erroNaLeitura[tabela] ?? null;
    if (erro) {
      return { data: null, error: erro };
    }
    return {
      data: (estado.tabelas[tabela] ?? []).filter((linha) =>
        filtros.every((filtro) => filtro(linha)),
      ),
      error: null,
    };
  };
  const api = {
    select: () => api,
    eq: (coluna: string, valor: unknown) => {
      filtros.push((linha) => linha[coluna] === valor);
      return api;
    },
    lt: (coluna: string, valor: string) => {
      filtros.push(
        (linha) => Date.parse(String(linha[coluna])) < Date.parse(valor),
      );
      return api;
    },
    gt: (coluna: string, valor: string) => {
      filtros.push(
        (linha) => Date.parse(String(linha[coluna])) > Date.parse(valor),
      );
      return api;
    },
    maybeSingle: async () => {
      const { data, error } = resultado();
      return { data: data?.[0] ?? null, error };
    },
    then: <T>(
      resolver: (valor: ReturnType<typeof resultado>) => T,
      rejeitar?: (motivo: unknown) => T,
    ) => Promise.resolve(resultado()).then(resolver, rejeitar),
    insert: (linha: Linha) => {
      (estado.inseridos[tabela] ??= []).push(linha);
      const gravado = { data: { id: `novo-${tabela}` }, error: null };
      return {
        select: () => ({ single: async () => gravado }),
        then: <T>(resolver: (valor: typeof gravado) => T) =>
          Promise.resolve(gravado).then(resolver),
      };
    },
  };
  return api;
}

const cliente = { from: (tabela: string) => consulta(tabela) };

const sessao = {
  userId: "usuario-da-sessao",
  active: {
    clinicId: CLINICA,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "recepcao" as string,
    status: "ativo",
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cliente,
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { criarAgendamentoAction } = await import("@/app/(app)/agenda/actions");

function bloqueio(parcial: Partial<Linha>): Linha {
  return {
    clinic_id: CLINICA,
    professional_id: JOAO,
    starts_at: AS_15H,
    ends_at: AS_15H30,
    blocks_overbooking: false,
    ...parcial,
  };
}

function marcar(parcial: Partial<Record<string, unknown>> = {}) {
  return criarAgendamentoAction({
    contact_id: CONTATO,
    professional_id: JOAO,
    service_link_id: VINCULO,
    unit_id: null,
    resource_id: null,
    starts_at: AS_15H,
    ends_at: AS_15H30,
    is_overbooking: false,
    send_confirmation: true,
    notes: null,
    ...parcial,
  });
}

const consultasGravadas = () => estado.inseridos.appointment ?? [];

beforeEach(() => {
  estado.tabelas = {
    service_link: [
      {
        id: VINCULO,
        clinic_id: CLINICA,
        duration_min: 30,
        procedure: { resource_id: null },
      },
    ],
    professional_block: [],
  };
  estado.erroNaLeitura = {};
  estado.inseridos = {};
  sessao.active.role = "recepcao";
});

describe("criarAgendamentoAction e os bloqueios do profissional", () => {
  it("sem bloqueio no caminho, marca a consulta", async () => {
    const resultado = await marcar();
    expect(resultado).toEqual({ ok: true, id: "novo-appointment" });
    expect(consultasGravadas()).toHaveLength(1);
  });

  it("consulta comum dentro de bloqueio que permite encaixe é recusada", async () => {
    estado.tabelas.professional_block = [bloqueio({})];
    const resultado = await marcar();
    expect(resultado).toEqual({
      ok: false,
      code: "bloqueado",
      error: MENSAGEM_HORARIO_BLOQUEADO,
    });
    expect(consultasGravadas()).toHaveLength(0);
  });

  it("consulta comum dentro de bloqueio que impede encaixe é recusada", async () => {
    estado.tabelas.professional_block = [
      bloqueio({ blocks_overbooking: true }),
    ];
    const resultado = await marcar();
    expect(resultado).toMatchObject({
      ok: false,
      code: "bloqueado",
      error: MENSAGEM_HORARIO_BLOQUEADO,
    });
    expect(consultasGravadas()).toHaveLength(0);
  });

  it("encaixe passa por cima de bloqueio que permite encaixe", async () => {
    estado.tabelas.professional_block = [bloqueio({})];
    const resultado = await marcar({ is_overbooking: true });
    expect(resultado.ok).toBe(true);
    expect(consultasGravadas()).toMatchObject([{ is_overbooking: true }]);
  });

  it("encaixe em bloqueio que impede encaixe é recusado, agora com o código", async () => {
    estado.tabelas.professional_block = [
      bloqueio({ blocks_overbooking: true }),
    ];
    const resultado = await marcar({ is_overbooking: true });
    expect(resultado).toEqual({
      ok: false,
      code: "bloqueado",
      error: MENSAGEM_BLOQUEADO_SEM_ENCAIXE,
    });
    expect(consultasGravadas()).toHaveLength(0);
  });

  it("erro na leitura dos bloqueios recusa, nunca deixa passar", async () => {
    estado.erroNaLeitura.professional_block = { message: "falhou" };
    const resultado = await marcar();
    expect(resultado).toEqual({
      ok: false,
      error: MENSAGEM_SEM_CONFERIR_AGENDA,
    });
    expect(consultasGravadas()).toHaveLength(0);
  });

  it("bloqueio de outro profissional, de outra clínica ou que só encosta não atrapalha", async () => {
    estado.tabelas.professional_block = [
      bloqueio({ professional_id: ANA }),
      bloqueio({ clinic_id: OUTRA_CLINICA }),
      bloqueio({
        starts_at: "2026-10-06T17:00:00.000Z",
        ends_at: AS_15H,
      }),
      bloqueio({
        starts_at: AS_15H30,
        ends_at: "2026-10-06T19:00:00.000Z",
      }),
    ];
    const resultado = await marcar();
    expect(resultado.ok).toBe(true);
  });

  it("confere com a duração do vínculo, nunca com o fim que o cliente mandou", async () => {
    // Bloqueio das 15:20 às 16:00; o cliente diz que a consulta acaba 15:10,
    // mas o vínculo é de 30 minutos (até 15:30).
    estado.tabelas.professional_block = [
      bloqueio({
        starts_at: "2026-10-06T18:20:00.000Z",
        ends_at: "2026-10-06T19:00:00.000Z",
      }),
    ];
    const resultado = await marcar({ ends_at: "2026-10-06T18:10:00.000Z" });
    expect(resultado).toMatchObject({ ok: false, code: "bloqueado" });
    expect(consultasGravadas()).toHaveLength(0);
  });

  it("papel que não altera a agenda nem chega a ler os bloqueios", async () => {
    sessao.active.role = "leitura";
    estado.erroNaLeitura.professional_block = { message: "não deveria ler" };
    const resultado = await marcar();
    expect(resultado.ok).toBe(false);
    expect(resultado.code).toBeUndefined();
    expect(resultado.error).not.toBe(MENSAGEM_SEM_CONFERIR_AGENDA);
    expect(consultasGravadas()).toHaveLength(0);
  });
});

describe("recusaPorBloqueio", () => {
  const inicio = new Date(AS_15H);
  const fim = new Date(AS_15H30);
  const comum = {
    starts_at: AS_15H,
    ends_at: AS_15H30,
    blocks_overbooking: false,
  };
  const semEncaixe = { ...comum, blocks_overbooking: true };

  it("consulta comum não entra em bloqueio nenhum", () => {
    expect(recusaPorBloqueio([comum], { inicio, fim, encaixe: false })).toBe(
      MENSAGEM_HORARIO_BLOQUEADO,
    );
    expect(
      recusaPorBloqueio([semEncaixe], { inicio, fim, encaixe: false }),
    ).toBe(MENSAGEM_HORARIO_BLOQUEADO);
  });

  it("encaixe só não entra no bloqueio que impede encaixe", () => {
    expect(
      recusaPorBloqueio([comum], { inicio, fim, encaixe: true }),
    ).toBeNull();
    expect(
      recusaPorBloqueio([comum, semEncaixe], { inicio, fim, encaixe: true }),
    ).toBe(MENSAGEM_BLOQUEADO_SEM_ENCAIXE);
  });

  it("sem bloqueio que cruze o horário, pode", () => {
    expect(recusaPorBloqueio([], { inicio, fim, encaixe: false })).toBeNull();
    expect(
      recusaPorBloqueio(
        [
          {
            ...comum,
            starts_at: AS_15H30,
            ends_at: "2026-10-06T19:00:00.000Z",
          },
        ],
        { inicio, fim, encaixe: false },
      ),
    ).toBeNull();
  });

  it("as mensagens não usam travessão", () => {
    for (const texto of [
      MENSAGEM_HORARIO_BLOQUEADO,
      MENSAGEM_BLOQUEADO_SEM_ENCAIXE,
      MENSAGEM_SEM_CONFERIR_AGENDA,
    ]) {
      expect(texto).not.toMatch(/[–—]/);
    }
  });
});
