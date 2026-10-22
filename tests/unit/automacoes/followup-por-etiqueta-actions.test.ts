import { beforeEach, describe, expect, it, vi } from "vitest";

import { BancoEmMemoria, type Linha } from "../ia-whatsapp/banco-em-memoria";

// As Server Actions das reguas de follow-up por etiqueta (onda 4, item 16;
// decisoes D1 a D4 do dono), com a sessao e o banco trocados por dubles. O
// que se prova aqui:
//   - a regua nova com etiqueta nasce desligada, no FIM da ordem da etapa,
//     com o filtro, o nome sugerido e a janela e as mensagens copiadas da
//     geral da etapa; a geral nasce como sempre (sem as colunas do filtro);
//   - o 23505 de cada indice vira a frase certa (a geral repetida, o mesmo
//     filtro), e o mesmo filtro e recusado antes do banco;
//   - "Para quem": a geral continua geral, a com etiqueta continua com
//     etiqueta, e o 23505 vira frase;
//   - a ordem passa pela RPC ordenar_reguas_de_followup, e a lista que
//     mudou (22023) vira frase;
//   - excluir: a trava de "enviou ha menos de 30 minutos" passa a valer
//     para o follow-up quando a etapa tem OUTRA regua;
//   - papel sem gestao nem chega ao banco; nada de paciente na trilha.
// O banco de verdade (indices, RLS, a RPC) esta nos testes de RLS e
// integracao.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";
const GERAL = "a1111111-1111-4111-8111-111111111111";
const PSIQUIATRIA = "b2222222-2222-4222-8222-222222222222";
const ODONTO = "d4444444-4444-4444-8444-444444444444";

const estado = vi.hoisted(() => ({
  banco: null as unknown,
  papel: "gestor" as string,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    (estado.banco as { cliente: () => unknown }).cliente(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    ...(estado.banco as { cliente: () => object }).cliente(),
    storage: {
      from: () => ({
        download: async () => ({ data: null, error: null }),
        upload: async () => ({ data: null, error: null }),
        remove: async () => ({ data: null, error: null }),
      }),
    },
  }),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => ({
    userId: USUARIO,
    active: { clinicId: CLINICA, role: estado.papel, status: "ativo" },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const {
  criarReguaDeFollowupAction,
  editarParaQuemDaReguaAction,
  excluirReguaAction,
  ordenarReguasDeFollowupAction,
} = await import("@/app/(app)/automacoes/actions");

let banco: BancoEmMemoria;

function regua(campos: Linha): Linha {
  return {
    clinic_id: CLINICA,
    kind: "followup",
    trigger_stage: "em_contato",
    active: false,
    etiquetas: [],
    etiquetas_modo: "qualquer",
    prioridade: 0,
    send_window_start: null,
    send_window_end: null,
    send_weekdays: null,
    created_at: "2026-10-24T12:00:00Z",
    ...campos,
  };
}

const novas = () =>
  banco
    .linhas("cadence")
    .filter(
      (linha) => ![GERAL, PSIQUIATRIA, ODONTO].includes(linha.id as string),
    );
const trilha = () => banco.linhas("audit_log");

beforeEach(() => {
  banco = new BancoEmMemoria();
  estado.banco = banco;
  estado.papel = "gestor";
  banco.linhas("funnel_stage_def").push(
    {
      clinic_id: CLINICA,
      chave: "em_contato",
      nome: "Em contato",
      papel: "em_contato",
    },
    {
      clinic_id: CLINICA,
      chave: "pediu_valor",
      nome: "Pediu valor",
      papel: null,
    },
    {
      clinic_id: CLINICA,
      chave: "perdido",
      nome: "Perdido",
      papel: "perdido",
    },
  );
});

/** A etapa Em contato com a geral (com janela e dois passos) e Psiquiatria. */
function etapaComReguas() {
  banco.linhas("cadence").push(
    regua({
      id: GERAL,
      name: "Follow-up de Em contato",
      active: true,
      send_window_start: "08:00:00",
      send_window_end: "18:00:00",
      send_weekdays: [1, 2, 3, 4, 5],
    }),
    regua({
      id: PSIQUIATRIA,
      name: "Follow-up de Em contato: Psiquiatria",
      etiquetas: ["Psiquiatria"],
      prioridade: 3,
    }),
  );
  banco.linhas("cadence_step").push(
    {
      id: "passo-1",
      clinic_id: CLINICA,
      cadence_id: GERAL,
      offset_minutes: 60,
      fixed_body: "Oi, {{nome}}!",
      media_path: null,
    },
    {
      id: "passo-2",
      clinic_id: CLINICA,
      cadence_id: GERAL,
      offset_minutes: 1440,
      fixed_body: "Podemos ajudar?",
      media_path: null,
    },
  );
}

describe("criarReguaDeFollowupAction com etiquetas", () => {
  it("nasce desligada, no fim da ordem, com o filtro e o que veio da geral", async () => {
    etapaComReguas();
    const resultado = await criarReguaDeFollowupAction({
      trigger_stage: "em_contato",
      etiquetas: [" Odontologia ", "Implante"],
      etiquetas_modo: "todas",
    });
    expect(resultado).toEqual({ ok: true });
    const [nova] = novas();
    expect(nova).toMatchObject({
      clinic_id: CLINICA,
      kind: "followup",
      trigger_stage: "em_contato",
      name: "Follow-up de Em contato: Odontologia e Implante",
      active: false,
      etiquetas: ["Odontologia", "Implante"],
      etiquetas_modo: "todas",
      // Depois da Psiquiatria (prioridade 3).
      prioridade: 4,
      send_window_start: "08:00:00",
      send_window_end: "18:00:00",
      send_weekdays: [1, 2, 3, 4, 5],
    });
    // As mensagens da geral, copiadas para a nova.
    expect(
      banco
        .linhas("cadence_step")
        .filter((passo) => passo.cadence_id === nova!.id)
        .map((passo) => [passo.offset_minutes, passo.fixed_body])
        .sort((a, b) => (a[0] as number) - (b[0] as number)),
    ).toEqual([
      [60, "Oi, {{nome}}!"],
      [1440, "Podemos ajudar?"],
    ]);
    expect(trilha()).toEqual([
      expect.objectContaining({
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "criou_regua_de_followup",
        entity: "cadence",
        entity_id: nova!.id,
      }),
    ]);
    // Sem nome de etiqueta nem de lead na trilha.
    expect(JSON.stringify(trilha())).not.toContain("Odontologia");
  });

  it("o nome escrito vence a sugestão", async () => {
    etapaComReguas();
    await criarReguaDeFollowupAction({
      trigger_stage: "em_contato",
      etiquetas: ["Odontologia"],
      nome: "  Dentista  ",
    });
    expect(novas()[0]?.name).toBe("Dentista");
  });

  it("etapa sem geral: nasce sem passos e sem janela, a primeira da ordem", async () => {
    const resultado = await criarReguaDeFollowupAction({
      trigger_stage: "pediu_valor",
      etiquetas: ["Psiquiatria"],
    });
    expect(resultado).toEqual({ ok: true });
    expect(novas()[0]).toMatchObject({
      prioridade: 0,
      send_window_start: null,
      send_weekdays: null,
    });
    expect(banco.linhas("cadence_step")).toHaveLength(0);
  });

  it("o mesmo filtro (pela chave e pelo modo) é recusado antes do banco", async () => {
    etapaComReguas();
    expect(
      await criarReguaDeFollowupAction({
        trigger_stage: "em_contato",
        etiquetas: ["PSIQUIATRIA"],
      }),
    ).toEqual({
      ok: false,
      error: "Já existe uma régua com estas etiquetas nesta etapa.",
    });
    // Com uma etiqueta so, "todas" e o mesmo filtro (revisao de 21/10/2026:
    // o modo sai qualquer, como o check do banco guarda).
    expect(
      await criarReguaDeFollowupAction({
        trigger_stage: "em_contato",
        etiquetas: ["psiquiatria"],
        etiquetas_modo: "todas",
      }),
    ).toEqual({
      ok: false,
      error: "Já existe uma régua com estas etiquetas nesta etapa.",
    });
    expect(novas()).toHaveLength(0);
    // Com duas, o modo faz outro filtro.
    expect(
      (
        await criarReguaDeFollowupAction({
          trigger_stage: "em_contato",
          etiquetas: ["Psiquiatria", "Adulto"],
          etiquetas_modo: "todas",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await criarReguaDeFollowupAction({
          trigger_stage: "em_contato",
          etiquetas: ["Adulto", "Psiquiatria"],
          etiquetas_modo: "qualquer",
        })
      ).ok,
    ).toBe(true);
    expect(
      await criarReguaDeFollowupAction({
        trigger_stage: "em_contato",
        etiquetas: ["adulto", "PSIQUIATRIA"],
        etiquetas_modo: "todas",
      }),
    ).toEqual({
      ok: false,
      error: "Já existe uma régua com estas etiquetas nesta etapa.",
    });
  });

  it("uma etiqueta pedida com todas grava qualquer (a forma única do filtro)", async () => {
    await criarReguaDeFollowupAction({
      trigger_stage: "pediu_valor",
      etiquetas: ["Psiquiatria"],
      etiquetas_modo: "todas",
    });
    expect(novas()[0]).toMatchObject({
      etiquetas: ["Psiquiatria"],
      etiquetas_modo: "qualquer",
    });
  });

  it("o 23505 do índice vira a frase de cada caso", async () => {
    banco.aoInserir = (tabela) =>
      tabela === "cadence"
        ? {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "cadence_followup_geral_unico_por_etapa"',
          }
        : null;
    expect(
      await criarReguaDeFollowupAction({ trigger_stage: "em_contato" }),
    ).toEqual({
      ok: false,
      error:
        "Esta etapa já tem a régua geral. Para outra régua, escolha as etiquetas.",
    });
    expect(
      await criarReguaDeFollowupAction({
        trigger_stage: "em_contato",
        etiquetas: ["Psiquiatria"],
      }),
    ).toEqual({
      ok: false,
      error: "Já existe uma régua com estas etiquetas nesta etapa.",
    });
    expect(trilha()).toHaveLength(0);
  });

  it("a geral sem etiqueta continua nascendo como sempre, sem as colunas do filtro", async () => {
    expect(
      await criarReguaDeFollowupAction({ trigger_stage: "pediu_valor" }),
    ).toEqual({ ok: true });
    const [nova] = novas();
    expect(nova).toMatchObject({
      name: "Follow-up de Pediu valor",
      active: false,
    });
    expect(nova).not.toHaveProperty("etiquetas");
    expect(nova).not.toHaveProperty("prioridade");
  });

  it("banco antes da migration (coluna desconhecida): a régua com etiqueta diz que ainda não dá", async () => {
    banco.erros.set("cadence:select", {
      code: "42703",
      message: "column cadence.etiquetas does not exist",
    });
    expect(
      await criarReguaDeFollowupAction({
        trigger_stage: "em_contato",
        etiquetas: ["Psiquiatria"],
      }),
    ).toEqual({
      ok: false,
      error:
        "As réguas por etiqueta ainda não estão disponíveis. Tente de novo em alguns minutos.",
    });
  });

  it("etiquetas inválidas nem chegam ao banco", async () => {
    for (const etiquetas of [
      ["Psiquiatria", "psiquiatria"],
      ["x".repeat(41)],
      Array.from({ length: 11 }, (_, i) => `E${i}`),
    ]) {
      const resultado = await criarReguaDeFollowupAction({
        trigger_stage: "em_contato",
        etiquetas,
      });
      expect(resultado.ok).toBe(false);
    }
    expect(banco.operacoes.filter((op) => op.tabela === "cadence")).toEqual([]);
  });

  it("Perdido e quem espera a equipe continuam recusados, com ou sem etiqueta", async () => {
    expect(
      await criarReguaDeFollowupAction({
        trigger_stage: "perdido",
        etiquetas: ["Psiquiatria"],
      }),
    ).toEqual({
      ok: false,
      error: "A etapa de perda não recebe follow-up automático.",
    });
    expect(novas()).toHaveLength(0);
  });

  it("recepção não cria", async () => {
    estado.papel = "recepcao";
    expect(
      (
        await criarReguaDeFollowupAction({
          trigger_stage: "em_contato",
          etiquetas: ["Psiquiatria"],
        })
      ).ok,
    ).toBe(false);
    expect(banco.operacoes).toHaveLength(0);
  });
});

describe("editarParaQuemDaReguaAction", () => {
  it("com etiqueta: grava nome, etiquetas e modo, e a trilha", async () => {
    etapaComReguas();
    const resultado = await editarParaQuemDaReguaAction({
      cadence_id: PSIQUIATRIA,
      nome: "Psiquiatria adulto",
      etiquetas: ["Psiquiatria", "Adulto"],
      etiquetas_modo: "todas",
    });
    expect(resultado).toEqual({ ok: true });
    expect(
      banco.linhas("cadence").find((linha) => linha.id === PSIQUIATRIA),
    ).toMatchObject({
      name: "Psiquiatria adulto",
      etiquetas: ["Psiquiatria", "Adulto"],
      etiquetas_modo: "todas",
    });
    expect(trilha()).toEqual([
      expect.objectContaining({
        action: "editou_para_quem_da_regua",
        entity: "cadence",
        entity_id: PSIQUIATRIA,
      }),
    ]);
  });

  it("tirar a segunda etiqueta de um filtro todas grava qualquer", async () => {
    etapaComReguas();
    const linha = banco
      .linhas("cadence")
      .find((item) => item.id === PSIQUIATRIA)!;
    linha.etiquetas = ["Psiquiatria", "Adulto"];
    linha.etiquetas_modo = "todas";
    expect(
      await editarParaQuemDaReguaAction({
        cadence_id: PSIQUIATRIA,
        nome: "Psiquiatria",
        etiquetas: ["Psiquiatria"],
        etiquetas_modo: "todas",
      }),
    ).toEqual({ ok: true });
    expect(
      banco.linhas("cadence").find((item) => item.id === PSIQUIATRIA),
    ).toMatchObject({ etiquetas: ["Psiquiatria"], etiquetas_modo: "qualquer" });
  });

  it("a geral continua geral: só o nome muda; etiqueta é recusada", async () => {
    etapaComReguas();
    expect(
      await editarParaQuemDaReguaAction({
        cadence_id: GERAL,
        nome: "Geral",
        etiquetas: [],
        etiquetas_modo: "qualquer",
      }),
    ).toEqual({ ok: true });
    const geral = banco.linhas("cadence").find((linha) => linha.id === GERAL);
    expect(geral).toMatchObject({ name: "Geral", etiquetas: [] });
    expect(
      await editarParaQuemDaReguaAction({
        cadence_id: GERAL,
        nome: "Geral",
        etiquetas: ["Psiquiatria"],
        etiquetas_modo: "qualquer",
      }),
    ).toEqual({
      ok: false,
      error:
        "A régua geral da etapa vale para todos os leads dela e não filtra etiqueta. Para filtrar, crie outra régua.",
    });
  });

  it("a com etiqueta não fica sem etiqueta", async () => {
    etapaComReguas();
    expect(
      await editarParaQuemDaReguaAction({
        cadence_id: PSIQUIATRIA,
        nome: "Psiquiatria",
        etiquetas: [],
        etiquetas_modo: "qualquer",
      }),
    ).toEqual({
      ok: false,
      error:
        "Escolha pelo menos uma etiqueta. Quem não tiver nenhuma recebe a régua geral da etapa.",
    });
  });

  it("o mesmo filtro de outra régua (23505) vira frase; régua de outra clínica não existe", async () => {
    etapaComReguas();
    banco.erros.set("cadence:update", {
      code: "23505",
      message: "cadence_followup_mesmo_filtro",
    });
    expect(
      await editarParaQuemDaReguaAction({
        cadence_id: PSIQUIATRIA,
        nome: "Psiquiatria",
        etiquetas: ["Odontologia"],
        etiquetas_modo: "qualquer",
      }),
    ).toEqual({
      ok: false,
      error: "Já existe uma régua com estas etiquetas nesta etapa.",
    });
    banco.erros.delete("cadence:update");
    banco.linhas("cadence").push(
      regua({
        id: ODONTO,
        clinic_id: "outra-clinica",
        etiquetas: ["Odontologia"],
      }),
    );
    expect(
      await editarParaQuemDaReguaAction({
        cadence_id: ODONTO,
        nome: "Odonto",
        etiquetas: ["Odontologia"],
        etiquetas_modo: "qualquer",
      }),
    ).toEqual({ ok: false, error: "Régua não encontrada." });
  });
});

describe("ordenarReguasDeFollowupAction", () => {
  it("passa a lista pela RPC, com a clínica da sessão, e grava a trilha", async () => {
    banco.rpc("ordenar_reguas_de_followup", () => ({
      data: null,
      error: null,
    }));
    expect(
      await ordenarReguasDeFollowupAction({
        trigger_stage: "em_contato",
        ids: [ODONTO, PSIQUIATRIA],
      }),
    ).toEqual({ ok: true });
    expect(banco.chamadasDe("ordenar_reguas_de_followup")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_trigger_stage: "em_contato",
        p_ids: [ODONTO, PSIQUIATRIA],
      },
    ]);
    expect(trilha()).toEqual([
      expect.objectContaining({
        action: "ordenou_reguas_de_followup",
        entity: "cadence",
        entity_id: null,
      }),
    ]);
  });

  it("a lista que mudou no meio (22023) e a recusa da RLS viram frase", async () => {
    banco.rpc("ordenar_reguas_de_followup", () => ({
      data: null,
      error: { code: "22023", message: "lista" },
    }));
    expect(
      await ordenarReguasDeFollowupAction({
        trigger_stage: "em_contato",
        ids: [PSIQUIATRIA],
      }),
    ).toEqual({
      ok: false,
      error:
        "A lista de réguas desta etapa mudou. Recarregue a página e tente de novo.",
    });
    banco.rpc("ordenar_reguas_de_followup", () => ({
      data: null,
      error: { code: "42501", message: "rls" },
    }));
    expect(
      await ordenarReguasDeFollowupAction({
        trigger_stage: "em_contato",
        ids: [PSIQUIATRIA],
      }),
    ).toEqual({
      ok: false,
      error: "Somente administradores e gestores alteram as automações.",
    });
    expect(trilha()).toHaveLength(0);
  });

  it("lista repetida ou vazia nem chega ao banco; recepção também não", async () => {
    expect(
      (
        await ordenarReguasDeFollowupAction({
          trigger_stage: "em_contato",
          ids: [PSIQUIATRIA, PSIQUIATRIA],
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await ordenarReguasDeFollowupAction({
          trigger_stage: "em_contato",
          ids: [],
        })
      ).ok,
    ).toBe(false);
    estado.papel = "recepcao";
    expect(
      (
        await ordenarReguasDeFollowupAction({
          trigger_stage: "em_contato",
          ids: [PSIQUIATRIA],
        })
      ).ok,
    ).toBe(false);
    expect(banco.chamadasDe("ordenar_reguas_de_followup")).toEqual([]);
  });
});

describe("excluirReguaAction: a trava de 30 minutos no follow-up", () => {
  /** Uma run da regua, enviada `minutos` atras. */
  function runEnviada(cadenceId: string, minutos: number) {
    const passo = banco
      .linhas("cadence_step")
      .find((linha) => linha.cadence_id === cadenceId);
    banco.linhas("cadence_run").push({
      id: `run-${banco.linhas("cadence_run").length}`,
      clinic_id: CLINICA,
      cadence_step_id: passo!.id,
      sent_at: new Date(Date.now() - minutos * 60_000).toISOString(),
    });
  }

  it("a etapa tem outra régua e esta enviou há pouco: recusa", async () => {
    etapaComReguas();
    runEnviada(GERAL, 10);
    expect(await excluirReguaAction({ cadence_id: GERAL })).toEqual({
      ok: false,
      error:
        "Esta régua enviou mensagens há pouco. Desligue agora e exclua daqui a 30 minutos.",
    });
    expect(banco.linhas("cadence").map((linha) => linha.id)).toContain(GERAL);
  });

  it("enviou há mais de 30 minutos: exclui", async () => {
    etapaComReguas();
    runEnviada(GERAL, 45);
    expect(await excluirReguaAction({ cadence_id: GERAL })).toEqual({
      ok: true,
    });
    expect(banco.linhas("cadence").map((linha) => linha.id)).not.toContain(
      GERAL,
    );
  });

  it("sozinha na etapa: exclui como antes, mesmo tendo enviado agora", async () => {
    banco
      .linhas("cadence")
      .push(regua({ id: GERAL, name: "Follow-up de Em contato" }));
    banco.linhas("cadence_step").push({
      id: "passo-1",
      clinic_id: CLINICA,
      cadence_id: GERAL,
      offset_minutes: 60,
      fixed_body: "Oi",
      media_path: null,
    });
    runEnviada(GERAL, 5);
    expect(await excluirReguaAction({ cadence_id: GERAL })).toEqual({
      ok: true,
    });
  });
});
