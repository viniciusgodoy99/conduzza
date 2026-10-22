import { beforeEach, describe, expect, it, vi } from "vitest";

// As Server Actions da aba "Automações de fluxo" (desde 20/10/2026 na tela
// Automacoes, app/(app)/automacoes/fluxo-actions.ts), com a sessao e o
// cliente do Supabase trocados por dubles que guardam o que a action mandou.
// O que se prova aqui:
//   - salvar e UMA chamada a RPC salvar_automacao_de_fluxo (onda 4: a regra
//     composta, com o "Se" e o "Faz" nas tabelas filhas), com a clinica da
//     SESSAO, o id so na edicao e o jsonb da regra: cada acao so com os
//     proprios campos, o mover por ultimo, sem motivo da perda nem carimbo
//     (o banco tira os dois);
//   - destino Agendou e recusado antes do banco, com a mensagem de gente;
//   - a recusa do banco (ciclo pelo hint, RLS, limites, regra que nao
//     existe) volta traduzida;
//   - toda mutacao grava audit_log com entity automacao_fluxo e o id, sem
//     nome nem texto da regra, e revalida /automacoes (onde a aba mora);
//   - o historico grava a trilha de leitura (traz nome do lead);
//   - so administrador e gestor passam: recepcao, profissional e leitura
//     sao recusados em TODA action, as de leitura inclusive, antes de abrir
//     o cliente do banco (decisao do dono de 20/10/2026).
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
  /** As chamadas de RPC, com os argumentos. */
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  /** O que a RPC salvar_automacao_de_fluxo devolve. */
  respostaDoSalvar: {
    data: "a1111111-1111-4111-8111-111111111111" as unknown,
    error: null as Erro,
  },
  /** Quantas vezes a action abriu o cliente do banco. */
  clientes: 0,
  /** Os caminhos revalidados. */
  revalidados: [] as string[],
  inserts: [] as { tabela: string; valores: Record<string, unknown> }[],
  updates: [] as { tabela: string; valores: Record<string, unknown> }[],
  deletes: [] as string[],
  erroDaEscrita: null as Erro,
  linhasDoUpdate: [{ id: "a1111111-1111-4111-8111-111111111111" }] as {
    id: string;
  }[],
  leituras: [] as { entity: string; clinicId: string; userId: string }[],
  historico: [] as Record<string, unknown>[],
  /** Sessao sem clinica ativa (expirada, ou mais de uma sem escolha). */
  semClinicaAtiva: false,
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
    rpc: (nome: string, args: Record<string, unknown>) => {
      registro.rpcs.push({ nome, args });
      if (nome === "salvar_automacao_de_fluxo") {
        return Promise.resolve(registro.respostaDoSalvar);
      }
      return Promise.resolve({
        data: { na_etapa: 5, ja_se_encaixam: 2, importados_fora: 1 },
        error: null,
      });
    },
  };
}

vi.mock("next/cache", () => ({
  revalidatePath: (caminho: string) => {
    registro.revalidados.push(caminho);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    registro.clientes += 1;
    return cliente();
  },
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
    active: registro.semClinicaAtiva
      ? null
      : { clinicId: CLINICA, role: registro.papel, status: "ativo" },
  }),
}));

const {
  salvarAutomacaoDeFluxoAction,
  alternarAutomacaoDeFluxoAction,
  excluirAutomacaoDeFluxoAction,
  previaDaAutomacaoDeFluxoAction,
  usoDasAutomacoesDeFluxoAction,
  historicoDeAutomacoesDeFluxoAction,
} = await import("@/app/(app)/automacoes/fluxo-actions");

function entrada(campos: Record<string, unknown> = {}) {
  return {
    id: null,
    nome: "Sumiu vira Perdido",
    ativa: true,
    gatilho: "sem_resposta_na_etapa",
    etapa: "aguardando_resposta",
    espera_minutos: 2880,
    combinar: "todas",
    condicoes: [],
    acoes: [{ acao: "mover_etapa", etapa_destino: "perdido" }],
    ...campos,
  };
}

/** As chamadas da RPC de salvar (a regra so chega ao banco por ela). */
const salvamentos = () =>
  registro.rpcs.filter((rpc) => rpc.nome === "salvar_automacao_de_fluxo");
const trilha = () =>
  registro.inserts.filter((linha) => linha.tabela === "audit_log");

beforeEach(() => {
  registro.papel = "gestor";
  registro.rpcs = [];
  registro.respostaDoSalvar = { data: REGRA, error: null };
  registro.clientes = 0;
  registro.revalidados = [];
  registro.inserts = [];
  registro.updates = [];
  registro.deletes = [];
  registro.erroDaEscrita = null;
  registro.linhasDoUpdate = [{ id: REGRA }];
  registro.leituras = [];
  registro.historico = [];
  registro.semClinicaAtiva = false;
});

describe("salvarAutomacaoDeFluxoAction", () => {
  it("criar chama a RPC com a clínica da sessão, sem id, e o jsonb da regra", async () => {
    const resultado = await salvarAutomacaoDeFluxoAction(
      entrada({
        combinar: "qualquer",
        condicoes: [{ tipo: "tem_etiqueta", etiqueta: "  Psiquiatria " }],
        acoes: [
          // Lixo de outras acoes no mover: nao pode ir para o banco.
          { acao: "mover_etapa", etapa_destino: "perdido", etiqueta: "lixo" },
          {
            acao: "criar_atividade",
            atividade_titulo: "Ligar",
            atividade_prazo_dias: 0,
          },
        ],
      }),
    );
    expect(resultado).toEqual({ ok: true, id: REGRA });
    expect(salvamentos()).toEqual([
      {
        nome: "salvar_automacao_de_fluxo",
        args: {
          p_clinic_id: CLINICA,
          p_id: null,
          p_regra: {
            nome: "Sumiu vira Perdido",
            ativa: true,
            gatilho: "sem_resposta_na_etapa",
            etapa: "aguardando_resposta",
            espera_minutos: 2880,
            combinar: "qualquer",
            condicoes: [{ tipo: "tem_etiqueta", etiqueta: "Psiquiatria" }],
            // O mover vai por ultimo; sem motivo da perda (o banco tira do
            // papel do destino) e sem carimbo.
            acoes: [
              {
                acao: "criar_atividade",
                etapa_destino: null,
                etiqueta: null,
                atividade_titulo: "Ligar",
                atividade_prazo_dias: 0,
                nota_texto: null,
              },
              {
                acao: "mover_etapa",
                etapa_destino: "perdido",
                etiqueta: null,
                atividade_titulo: null,
                atividade_prazo_dias: null,
                nota_texto: null,
              },
            ],
          },
        },
      },
    ]);
    // Nada de escrita direta nas tabelas da regra.
    expect(
      registro.inserts.filter((linha) => linha.tabela !== "audit_log"),
    ).toEqual([]);
    expect(registro.updates).toEqual([]);
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

  it("revalida a tela Automações, onde a aba mora (não mais Configurações)", async () => {
    await salvarAutomacaoDeFluxoAction(entrada());
    await alternarAutomacaoDeFluxoAction(REGRA, false);
    await excluirAutomacaoDeFluxoAction(REGRA);
    expect(registro.revalidados).toEqual([
      "/automacoes",
      "/automacoes",
      "/automacoes",
    ]);
  });

  it("editar manda o id e grava editou", async () => {
    const resultado = await salvarAutomacaoDeFluxoAction(
      entrada({
        id: REGRA,
        acoes: [{ acao: "nota_interna", nota_texto: "  Ofereça horário.  " }],
      }),
    );
    expect(resultado).toEqual({ ok: true, id: REGRA });
    const args = salvamentos()[0]!.args;
    expect(args.p_id).toBe(REGRA);
    expect((args.p_regra as { acoes: unknown[] }).acoes).toEqual([
      {
        acao: "nota_interna",
        etapa_destino: null,
        etiqueta: null,
        atividade_titulo: null,
        atividade_prazo_dias: null,
        nota_texto: "Ofereça horário.",
      },
    ]);
    expect(trilha()[0]!.valores.action).toBe("editou_automacao_de_fluxo");
  });

  it("destino Agendou é recusado antes do banco", async () => {
    const resultado = await salvarAutomacaoDeFluxoAction(
      entrada({ acoes: [{ acao: "mover_etapa", etapa_destino: "agendou" }] }),
    );
    expect(resultado).toEqual({
      ok: false,
      error:
        "Agendou e Compareceu são marcados pela Agenda e não podem ser destino de uma automação.",
    });
    expect(salvamentos()).toHaveLength(0);
  });

  it("dois movers nem chegam ao banco", async () => {
    const resultado = await salvarAutomacaoDeFluxoAction(
      entrada({
        acoes: [
          { acao: "mover_etapa", etapa_destino: "perdido" },
          { acao: "mover_etapa", etapa_destino: "novo" },
        ],
      }),
    );
    expect(resultado).toEqual({
      ok: false,
      error: "Uma automação move o lead uma vez só.",
    });
    expect(salvamentos()).toHaveLength(0);
  });

  it("o ciclo recusado pelo banco volta traduzido, sem trilha", async () => {
    registro.respostaDoSalvar = {
      data: null,
      error: {
        code: "23514",
        message: "Esta automação fecha um ciclo...",
        hint: "automacao_ciclo",
      },
    };
    const resultado = await salvarAutomacaoDeFluxoAction(entrada());
    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.error).toContain("fecha um ciclo");
    expect(trilha()).toHaveLength(0);
  });

  it("regra que não existe (P0002) e limites (22023) viram frase de gente", async () => {
    registro.respostaDoSalvar = {
      data: null,
      error: { code: "P0002", message: "nao encontrada" },
    };
    expect(await salvarAutomacaoDeFluxoAction(entrada({ id: REGRA }))).toEqual({
      ok: false,
      error:
        "Esta automação não existe mais. Recarregue a página para ver a lista atual.",
    });
    registro.respostaDoSalvar = {
      data: null,
      error: { code: "22023", message: "limites" },
    };
    const limites = await salvarAutomacaoDeFluxoAction(entrada());
    expect(!limites.ok && limites.error).toContain("de 1 a 5 ações");
    expect(trilha()).toHaveLength(0);
  });

  // Banco sem a migration 20261024110000 (revisao de 21/10/2026): o contrato
  // publica este codigo antes dela, junto com o do follow-up.
  it.each(["PGRST202", "42883"])(
    "banco sem a RPC (%s): a regra de uma ação e sem condição grava pelas colunas de antes",
    async (codigo) => {
      registro.respostaDoSalvar = {
        data: null,
        error: { code: codigo, message: "Could not find the function" },
      };
      expect(await salvarAutomacaoDeFluxoAction(entrada())).toEqual({
        ok: true,
        id: REGRA,
      });
      expect(
        registro.inserts.filter((linha) => linha.tabela === "automacao_fluxo"),
      ).toEqual([
        {
          tabela: "automacao_fluxo",
          valores: {
            clinic_id: CLINICA,
            nome: "Sumiu vira Perdido",
            ativa: true,
            gatilho: "sem_resposta_na_etapa",
            etapa: "aguardando_resposta",
            espera_minutos: 2880,
            acao: "mover_etapa",
            etapa_destino: "perdido",
            // Do papel do destino, como o codigo de antes.
            motivo_perda: "nao_respondeu",
            etiqueta: null,
            atividade_titulo: null,
            atividade_prazo_dias: null,
            nota_texto: null,
          },
        },
      ]);
      expect(trilha().map((linha) => linha.valores.action)).toEqual([
        "criou_automacao_de_fluxo",
      ]);

      // Editar: update das colunas de antes, so na regra desta clinica.
      registro.inserts = [];
      await salvarAutomacaoDeFluxoAction(
        entrada({
          id: REGRA,
          gatilho: "entrou_na_etapa",
          espera_minutos: null,
          acoes: [
            {
              acao: "criar_atividade",
              atividade_titulo: "Ligar",
              atividade_prazo_dias: 1,
            },
          ],
        }),
      );
      expect(registro.updates).toEqual([
        {
          tabela: "automacao_fluxo",
          valores: {
            nome: "Sumiu vira Perdido",
            ativa: true,
            gatilho: "entrou_na_etapa",
            etapa: "aguardando_resposta",
            espera_minutos: null,
            acao: "criar_atividade",
            etapa_destino: null,
            motivo_perda: null,
            etiqueta: null,
            atividade_titulo: "Ligar",
            atividade_prazo_dias: 1,
            nota_texto: null,
          },
        },
      ]);
      expect(trilha().map((linha) => linha.valores.action)).toEqual([
        "editou_automacao_de_fluxo",
      ]);
    },
  );

  it("banco sem a RPC: com mais de uma ação ou com condição, recusa sem gravar nada", async () => {
    registro.respostaDoSalvar = {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    };
    for (const composta of [
      entrada({
        acoes: [
          { acao: "nota_interna", nota_texto: "Ligar" },
          { acao: "mover_etapa", etapa_destino: "perdido" },
        ],
      }),
      entrada({
        condicoes: [{ tipo: "tem_etiqueta", etiqueta: "Psiquiatria" }],
      }),
    ]) {
      const resultado = await salvarAutomacaoDeFluxoAction(composta);
      expect(!resultado.ok && resultado.error).toBe(
        "Esta clínica ainda não tem automações com mais de uma ação ou com condições. Por enquanto, salve com uma ação só e sem condições.",
      );
    }
    expect(registro.inserts).toEqual([]);
    expect(registro.updates).toEqual([]);
  });

  it("resposta sem id não grava trilha", async () => {
    registro.respostaDoSalvar = { data: null, error: null };
    const resultado = await salvarAutomacaoDeFluxoAction(entrada());
    expect(resultado).toEqual({
      ok: false,
      error: "Não foi possível criar a automação.",
    });
    expect(trilha()).toHaveLength(0);
  });

  it("dado incoerente nem chega ao banco", async () => {
    const resultado = await salvarAutomacaoDeFluxoAction(
      entrada({ espera_minutos: null }),
    );
    expect(resultado.ok).toBe(false);
    expect(registro.inserts).toHaveLength(0);
    expect(salvamentos()).toHaveLength(0);
  });

  it("papel sem gestão não chega ao banco", async () => {
    registro.papel = "recepcao";
    const resultado = await salvarAutomacaoDeFluxoAction(entrada());
    expect(resultado.ok).toBe(false);
    expect(registro.inserts).toHaveLength(0);
    expect(salvamentos()).toHaveLength(0);
  });
});

describe("quem pode (decisão do dono de 20/10/2026)", () => {
  // Toda action, as de leitura inclusive, com uma entrada valida: a recusa
  // tem de vir do papel, nunca do Zod.
  const ACTIONS: [string, () => Promise<{ ok: boolean }>][] = [
    ["salvar", () => salvarAutomacaoDeFluxoAction(entrada())],
    ["ligar", () => alternarAutomacaoDeFluxoAction(REGRA, true)],
    ["desligar", () => alternarAutomacaoDeFluxoAction(REGRA, false)],
    ["excluir", () => excluirAutomacaoDeFluxoAction(REGRA)],
    [
      "prévia",
      () =>
        previaDaAutomacaoDeFluxoAction({
          gatilho: "tempo_na_etapa",
          etapa: "em_contato",
          espera_minutos: 4320,
        }),
    ],
    ["uso", () => usoDasAutomacoesDeFluxoAction([REGRA])],
    ["histórico", () => historicoDeAutomacoesDeFluxoAction(null)],
  ];

  describe.each(["recepcao", "profissional", "leitura"])(
    "%s é recusado",
    (papel) => {
      it.each(ACTIONS)("%s: sem abrir o banco", async (_nome, chamar) => {
        registro.papel = papel;
        const resultado = await chamar();
        expect(resultado).toEqual({
          ok: false,
          error:
            "Somente administradores e gestores mudam as automações de fluxo.",
        });
        expect(registro.clientes).toBe(0);
        expect(registro.inserts).toHaveLength(0);
        expect(registro.updates).toHaveLength(0);
        expect(registro.deletes).toHaveLength(0);
        expect(registro.rpcs).toHaveLength(0);
        // O historico traz nome de lead: nem a leitura nem a trilha.
        expect(registro.leituras).toHaveLength(0);
        expect(registro.revalidados).toHaveLength(0);
      });
    },
  );

  describe.each(["admin", "gestor"])("%s passa", (papel) => {
    it.each(ACTIONS)("%s", async (_nome, chamar) => {
      registro.papel = papel;
      const resultado = await chamar();
      expect(resultado.ok).toBe(true);
      expect(registro.clientes).toBe(1);
    });
  });

  it("sem clínica ativa: sessão expirada, sem abrir o banco", async () => {
    registro.semClinicaAtiva = true;
    const resultado = await historicoDeAutomacoesDeFluxoAction(null);
    expect(resultado).toEqual({
      ok: false,
      error: "Sessão expirada. Entre de novo.",
    });
    expect(registro.clientes).toBe(0);
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
        // O retrato por acao (onda 4), fora de ordem: volta ordenado.
        acoes: [
          {
            posicao: 2,
            acao: "mover_etapa",
            status: "executada",
            motivo: null,
            para_etapa: "perdido",
            etiqueta: null,
            etiqueta_nome: null,
            executada_em: "2026-10-02T13:00:00Z",
          },
          {
            posicao: 1,
            acao: "criar_atividade",
            status: "pulada",
            motivo: "sem_conversa",
            para_etapa: null,
            etiqueta: null,
            etiqueta_nome: null,
            executada_em: "2026-10-02T13:00:00Z",
          },
        ],
      },
    ];
    const resultado = await historicoDeAutomacoesDeFluxoAction(null);
    expect(resultado.ok).toBe(true);
    expect(resultado.ok && resultado.execucoes[0]?.contato).toBe("Maria");
    expect(resultado.ok && resultado.execucoes[0]?.acao).toBe("mover_etapa");
    expect(
      resultado.ok && resultado.execucoes[0]?.acoes.map((a) => a.posicao),
    ).toEqual([1, 2]);
    // Entidade propria da aba: nao se confunde com a lista de Leads no
    // dedupe de 5 minutos da trilha.
    expect(registro.leituras).toEqual([
      { clinicId: CLINICA, userId: USUARIO, entity: "automacoes_de_fluxo" },
    ]);
  });
});
