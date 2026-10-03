import { beforeEach, describe, expect, it, vi } from "vitest";

// As Server Actions da aba "Automações de fluxo", com a sessao e o cliente do
// Supabase trocados por dubles que guardam o que a action mandou. O que se
// prova aqui:
//   - so os campos da acao chegam ao banco (os das outras vao null), sem
//     carimbo (created_by, updated_by, vigente_desde) e com clinic_id da
//     SESSAO no insert;
//   - o motivo da perda nasce do papel do destino lido do banco;
//   - destino Agendou e recusado antes do banco, com a mensagem de gente;
//   - a recusa do banco (ciclo pelo hint, RLS) volta traduzida;
//   - toda mutacao grava audit_log com entity automacao_fluxo e o id, sem
//     nome nem texto da regra;
//   - o historico grava a trilha de leitura (traz nome do lead);
//   - papel sem gestao nao chega ao banco.
// A RLS, os checks e o detector de ciclo de verdade estao nos testes de RLS
// e integracao da Leva B.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";
const REGRA = "a1111111-1111-4111-8111-111111111111";

type Erro = {
  code?: string;
  message: string;
  hint?: string | null;
} | null;
type Resultado = { data: unknown; error: Erro; count?: number };

const registro = vi.hoisted(() => ({
  papel: "gestor" as string,
  inserts: [] as { tabela: string; valores: Record<string, unknown> }[],
  updates: [] as { tabela: string; valores: Record<string, unknown> }[],
  deletes: [] as string[],
  erroDaEscrita: null as Erro,
  linhasDoUpdate: [{ id: "a1111111-1111-4111-8111-111111111111" }] as {
    id: string;
  }[],
  leituras: [] as { entity: string; clinicId: string; userId: string }[],
  historico: [] as Record<string, unknown>[],
}));

function cadeia(resultado: () => Resultado) {
  const alvo: Record<string, unknown> = {};
  for (const metodo of ["eq", "select", "order", "limit", "in"]) {
    alvo[metodo] = () => alvo;
  }
  alvo.single = () => Promise.resolve(resultado());
  alvo.then = (ok: (valor: Resultado) => unknown) =>
    Promise.resolve(resultado()).then(ok);
  return alvo;
}

const JORNADA = [
  { chave: "novo", nome: "Novo", papel: "entrada" },
  { chave: "em_contato", nome: "Em contato", papel: null },
  { chave: "aguardando_resposta", nome: "Aguardando resposta", papel: null },
  { chave: "agendou", nome: "Agendou", papel: "agendou" },
  { chave: "compareceu", nome: "Compareceu", papel: "compareceu" },
  { chave: "perdido", nome: "Perdido", papel: "perdido" },
];

function cliente() {
  return {
    from: (tabela: string) => ({
      select: () =>
        cadeia(() => {
          if (tabela === "funnel_stage_def") {
            return { data: JORNADA, error: null };
          }
          if (tabela === "automacao_execucao") {
            return { data: registro.historico, error: null, count: 3 };
          }
          return { data: [], error: null };
        }),
      insert: (valores: Record<string, unknown>) => {
        registro.inserts.push({ tabela, valores });
        return cadeia(() =>
          tabela === "automacao_fluxo" && registro.erroDaEscrita
            ? { data: null, error: registro.erroDaEscrita }
            : { data: { id: REGRA }, error: null },
        );
      },
      update: (valores: Record<string, unknown>) => {
        registro.updates.push({ tabela, valores });
        return cadeia(() =>
          registro.erroDaEscrita
            ? { data: null, error: registro.erroDaEscrita }
            : { data: registro.linhasDoUpdate, error: null },
        );
      },
      delete: () => {
        registro.deletes.push(tabela);
        return cadeia(() => ({ data: [{ id: REGRA }], error: null }));
      },
    }),
    rpc: () =>
      Promise.resolve({
        data: { na_etapa: 5, ja_se_encaixam: 2, importados_fora: 1 },
        error: null,
      }),
  };
}

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cliente(),
}));
vi.mock("@/lib/auth/read-audit", () => ({
  auditarLeituraDePaciente: async (
    _supabase: unknown,
    params: { entity: string; clinicId: string; userId: string },
  ) => {
    registro.leituras.push(params);
  },
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => ({
    userId: USUARIO,
    active: { clinicId: CLINICA, role: registro.papel, status: "ativo" },
  }),
}));

const {
  salvarAutomacaoDeFluxoAction,
  alternarAutomacaoDeFluxoAction,
  excluirAutomacaoDeFluxoAction,
  previaDaAutomacaoDeFluxoAction,
  historicoDeAutomacoesDeFluxoAction,
} = await import("@/app/(app)/configuracoes/automacoes-de-fluxo-actions");

function entrada(campos: Record<string, unknown> = {}) {
  return {
    id: null,
    nome: "Sumiu vira Perdido",
    ativa: true,
    gatilho: "sem_resposta_na_etapa",
    etapa: "aguardando_resposta",
    espera_minutos: 2880,
    acao: "mover_etapa",
    etapa_destino: "perdido",
    etiqueta: null,
    atividade_titulo: null,
    atividade_prazo_dias: null,
    nota_texto: null,
    ...campos,
  };
}

const daRegra = () =>
  registro.inserts.filter((linha) => linha.tabela === "automacao_fluxo");
const trilha = () =>
  registro.inserts.filter((linha) => linha.tabela === "audit_log");

beforeEach(() => {
  registro.papel = "gestor";
  registro.inserts = [];
  registro.updates = [];
  registro.deletes = [];
  registro.erroDaEscrita = null;
  registro.linhasDoUpdate = [{ id: REGRA }];
  registro.leituras = [];
  registro.historico = [];
});

describe("salvarAutomacaoDeFluxoAction", () => {
  it("criar grava só os campos da ação, com o motivo do destino e sem carimbo", async () => {
    const resultado = await salvarAutomacaoDeFluxoAction(
      entrada({ etiqueta: "lixo", nota_texto: "lixo" }),
    );
    expect(resultado).toEqual({ ok: true, id: REGRA });
    expect(daRegra()).toHaveLength(1);
    const valores = daRegra()[0]!.valores;
    expect(valores).toEqual({
      clinic_id: CLINICA,
      nome: "Sumiu vira Perdido",
      ativa: true,
      gatilho: "sem_resposta_na_etapa",
      etapa: "aguardando_resposta",
      espera_minutos: 2880,
      acao: "mover_etapa",
      etapa_destino: "perdido",
      motivo_perda: "nao_respondeu",
      etiqueta: null,
      atividade_titulo: null,
      atividade_prazo_dias: null,
      nota_texto: null,
    });
  });

  it("toda mutação grava a trilha sem nome nem texto da regra", async () => {
    await salvarAutomacaoDeFluxoAction(entrada());
    expect(trilha()).toHaveLength(1);
    expect(trilha()[0]!.valores).toEqual({
      clinic_id: CLINICA,
      user_id: USUARIO,
      action: "criou_automacao_de_fluxo",
      entity: "automacao_fluxo",
      entity_id: REGRA,
    });
  });

  it("editar usa update filtrado e grava editou", async () => {
    const resultado = await salvarAutomacaoDeFluxoAction(
      entrada({
        id: REGRA,
        acao: "nota_interna",
        etapa_destino: null,
        nota_texto: "  Ofereça horário.  ",
      }),
    );
    expect(resultado).toEqual({ ok: true, id: REGRA });
    const update = registro.updates.find(
      (linha) => linha.tabela === "automacao_fluxo",
    );
    expect(update?.valores).toMatchObject({
      acao: "nota_interna",
      nota_texto: "Ofereça horário.",
      etapa_destino: null,
      motivo_perda: null,
    });
    expect(update?.valores).not.toHaveProperty("clinic_id");
    expect(trilha()[0]!.valores.action).toBe("editou_automacao_de_fluxo");
  });

  it("destino Agendou é recusado antes do banco", async () => {
    const resultado = await salvarAutomacaoDeFluxoAction(
      entrada({ etapa_destino: "agendou" }),
    );
    expect(resultado).toEqual({
      ok: false,
      error:
        "Agendou e Compareceu são marcados pela Agenda e não podem ser destino de uma automação.",
    });
    expect(daRegra()).toHaveLength(0);
  });

  it("o ciclo recusado pelo banco volta traduzido, sem trilha", async () => {
    registro.erroDaEscrita = {
      code: "23514",
      message: "Esta automação fecha um ciclo...",
      hint: "automacao_ciclo",
    };
    const resultado = await salvarAutomacaoDeFluxoAction(entrada());
    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.error).toContain("fecha um ciclo");
    expect(trilha()).toHaveLength(0);
  });

  it("dado incoerente nem chega ao banco", async () => {
    const resultado = await salvarAutomacaoDeFluxoAction(
      entrada({ espera_minutos: null }),
    );
    expect(resultado.ok).toBe(false);
    expect(registro.inserts).toHaveLength(0);
  });

  it("papel sem gestão não chega ao banco", async () => {
    registro.papel = "recepcao";
    const resultado = await salvarAutomacaoDeFluxoAction(entrada());
    expect(resultado.ok).toBe(false);
    expect(registro.inserts).toHaveLength(0);
  });
});

describe("ligar, desligar e excluir", () => {
  it("ligar grava só ativa e a trilha ligou", async () => {
    const resultado = await alternarAutomacaoDeFluxoAction(REGRA, true);
    expect(resultado).toEqual({ ok: true, id: REGRA });
    expect(registro.updates[0]!.valores).toEqual({ ativa: true });
    expect(trilha()[0]!.valores.action).toBe("ligou_automacao_de_fluxo");
  });

  it("desligar grava a trilha desligou", async () => {
    await alternarAutomacaoDeFluxoAction(REGRA, false);
    expect(trilha()[0]!.valores.action).toBe("desligou_automacao_de_fluxo");
  });

  it("RLS (42501) vira a dica de permissão", async () => {
    registro.erroDaEscrita = { code: "42501", message: "rls" };
    const resultado = await alternarAutomacaoDeFluxoAction(REGRA, true);
    expect(resultado).toEqual({
      ok: false,
      error: "Somente administradores e gestores mudam as automações de fluxo.",
    });
  });

  it("regra que sumiu (0 linhas) diz para recarregar", async () => {
    registro.linhasDoUpdate = [];
    const resultado = await alternarAutomacaoDeFluxoAction(REGRA, false);
    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.error).toContain("Recarregue a página");
  });

  it("excluir grava a trilha excluiu", async () => {
    const resultado = await excluirAutomacaoDeFluxoAction(REGRA);
    expect(resultado).toEqual({ ok: true, id: REGRA });
    expect(registro.deletes).toEqual(["automacao_fluxo"]);
    expect(trilha()[0]!.valores.action).toBe("excluiu_automacao_de_fluxo");
  });

  it("id inválido não chega ao banco", async () => {
    expect((await excluirAutomacaoDeFluxoAction("x")).ok).toBe(false);
    expect((await alternarAutomacaoDeFluxoAction(REGRA, "sim")).ok).toBe(false);
    expect(registro.deletes).toHaveLength(0);
    expect(registro.updates).toHaveLength(0);
  });
});

describe("leituras sob demanda", () => {
  it("prévia valida a faixa e devolve as contagens", async () => {
    expect(
      await previaDaAutomacaoDeFluxoAction({
        gatilho: "tempo_na_etapa",
        etapa: "em_contato",
        espera_minutos: 30,
      }),
    ).toEqual({ ok: false, error: "O tempo vai de 1 hora a 90 dias." });
    expect(
      await previaDaAutomacaoDeFluxoAction({
        gatilho: "tempo_na_etapa",
        etapa: "em_contato",
        espera_minutos: 4320,
      }),
    ).toEqual({
      ok: true,
      previa: { na_etapa: 5, ja_se_encaixam: 2, importados_fora: 1 },
    });
  });

  it("histórico grava a trilha de leitura (traz nome do lead)", async () => {
    registro.historico = [
      {
        id: "e1",
        automacao_id: REGRA,
        status: "executada",
        motivo: null,
        de_etapa: "aguardando_resposta",
        para_etapa: "perdido",
        acao: "mover_etapa",
        etiqueta: null,
        etiqueta_nome: null,
        executada_em: "2026-10-02T13:00:00Z",
        created_at: "2026-10-02T12:59:00Z",
        contact: { name: "Maria" },
      },
    ];
    const resultado = await historicoDeAutomacoesDeFluxoAction(null);
    expect(resultado.ok).toBe(true);
    expect(resultado.ok && resultado.execucoes[0]?.contato).toBe("Maria");
    expect(resultado.ok && resultado.execucoes[0]?.acao).toBe("mover_etapa");
    // Entidade propria da aba: nao se confunde com a lista de Leads no
    // dedupe de 5 minutos da trilha.
    expect(registro.leituras).toEqual([
      { clinicId: CLINICA, userId: USUARIO, entity: "automacoes_de_fluxo" },
    ]);
  });
});
