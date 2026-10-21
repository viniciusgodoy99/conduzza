import { beforeEach, describe, expect, it, vi } from "vitest";

// As actions de etapa da Jornada com os campos de 02/10/2026 ("quem escreve
// o termo" e a descricao do Kanban), com a sessao e o cliente do Supabase
// trocados por dubles que guardam o que a action mandou gravar. O que se
// prova aqui:
//   - termos_de_quem e descricao chegam ao update e ao insert;
//   - descricao vazia ou so de espacos vai como null (o check do banco
//     recusa string vazia) e espacos sao colapsados;
//   - descricao acima de 140 e quem escreve fora do catalogo sao recusados
//     antes do banco, com mensagem de gente para a descricao;
//   - a recusa da etapa com regua de follow-up vira mensagem que diz o que
//     fazer (antes caia no generico);
//   - etapa e etiqueta usadas por automacao de fluxo: a recusa vem pelo hint
//     que o banco devolve (etapa_usada_por_automacao e
//     etiqueta_usada_por_automacao) e vira mensagem que diz onde resolver;
//   - reordenar: a troca entre duas etapas de sistema do caminho do lead
//     (decisao D6, 21/10/2026) e recusada no servidor ANTES da RPC, com a
//     frase da ordem fixa e os nomes da clinica, tambem com o banco de antes
//     da migration 20261023100000 (Em contato pela chave; revisao de
//     21/10/2026); a recusa do banco (hint ordem_de_sistema) vira a mesma
//     frase; leitura da jornada que falha nao deixa reordenar.
// A RLS e os checks de verdade estao em tests/rls/crm-leva-a.test.ts e
// tests/rls/jornada.test.ts.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const USUARIO = "97777777-7777-4777-8777-777777777777";

type ErroFalso = { message: string; code?: string; hint?: string };
type Resultado = { data: unknown; error: ErroFalso | null };

const registro = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  inserts: [] as { tabela: string; valores: Record<string, unknown> }[],
  erroDoDelete: null as ErroFalso | null,
  erroDaRpc: null as ErroFalso | null,
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  jornada: null as Record<string, unknown>[] | null,
  erroDaLeitura: null as ErroFalso | null,
}));

// A jornada lida: so posicao e chave interessam a criar etapa; nome e papel,
// a frase da ordem fixa (a Em contato renomeada, como a da Salud Care).
const JORNADA_NOVA = [
  { chave: "novo", posicao: 10, nome: "Novo", papel: "entrada" },
  {
    chave: "aguardando_resposta",
    posicao: 20,
    nome: "Aguardando resposta",
    papel: "aguardando",
  },
  {
    chave: "em_contato",
    posicao: 30,
    nome: "Contato inicial",
    papel: "em_contato",
  },
  { chave: "agendou", posicao: 40, nome: "Agendou", papel: "agendou" },
  { chave: "compareceu", posicao: 50, nome: "Compareceu", papel: "compareceu" },
  { chave: "perdido", posicao: 60, nome: "Perdido", papel: "perdido" },
];

function cadeia(resultado: () => Resultado) {
  const alvo: Record<string, unknown> = {};
  for (const metodo of ["eq", "select", "order"]) {
    alvo[metodo] = () => alvo;
  }
  alvo.single = () => Promise.resolve(resultado());
  alvo.then = (ok: (valor: Resultado) => unknown) =>
    Promise.resolve(resultado()).then(ok);
  return alvo;
}

function cliente() {
  return {
    rpc: (nome: string, args: Record<string, unknown>) => {
      registro.rpcs.push({ nome, args });
      return Promise.resolve(
        registro.erroDaRpc
          ? { data: null, error: registro.erroDaRpc }
          : { data: "etapa-1", error: null },
      );
    },
    from: (tabela: string) => ({
      select: () =>
        cadeia(() =>
          registro.erroDaLeitura
            ? { data: null, error: registro.erroDaLeitura }
            : { data: registro.jornada ?? JORNADA_NOVA, error: null },
        ),
      update: (valores: Record<string, unknown>) => {
        registro.updates.push(valores);
        return cadeia(() => ({ data: [{ id: "etapa-1" }], error: null }));
      },
      insert: (valores: Record<string, unknown>) => {
        registro.inserts.push({ tabela, valores });
        return cadeia(() => ({ data: { id: "etapa-nova" }, error: null }));
      },
      delete: () =>
        cadeia(() =>
          registro.erroDoDelete
            ? { data: null, error: registro.erroDoDelete }
            : { data: [{ id: "etapa-1" }], error: null },
        ),
    }),
  };
}

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cliente(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => cliente() }));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => ({
    userId: USUARIO,
    active: { clinicId: CLINICA, role: "gestor", status: "ativo" },
  }),
}));

const {
  salvarEtapaDaJornadaAction,
  excluirEtapaDaJornadaAction,
  excluirEtiquetaDeConversaAction,
  reordenarEtapaDaJornadaAction,
} = await import("@/app/(app)/configuracoes/actions");
const { RECUSA_DA_ETAPA_USADA, RECUSA_DA_ETIQUETA_USADA } =
  await import("@/lib/domain/automacoes-de-fluxo");

function entrada(campos: Record<string, unknown> = {}) {
  return {
    chave: "em_contato",
    nome: "Em contato",
    tom: "info",
    icone: "message-square-text",
    descricao: null,
    termos_chave: ["seja bem-vinda"],
    termos_de_quem: "clinica",
    conversao: {
      meta_event_name: null,
      conversao_ativa: true,
      is_sale: false,
      is_first_contact: false,
      value_source: null,
      value_cents: null,
    },
    ...campos,
  };
}

beforeEach(() => {
  registro.updates = [];
  registro.inserts = [];
  registro.erroDoDelete = null;
  registro.erroDaRpc = null;
  registro.rpcs = [];
  registro.jornada = null;
  registro.erroDaLeitura = null;
});

describe("salvarEtapaDaJornadaAction: quem escreve e descrição", () => {
  it("editar grava quem escreve o termo e a descrição normalizada", async () => {
    const resultado = await salvarEtapaDaJornadaAction(
      entrada({ descricao: "  Recebeu as boas-vindas\n da recepção  " }),
    );

    expect(resultado).toEqual({ ok: true });
    expect(registro.updates).toHaveLength(1);
    expect(registro.updates[0]).toMatchObject({
      termos_de_quem: "clinica",
      descricao: "Recebeu as boas-vindas da recepção",
      termos_chave: ["seja bem-vinda"],
    });
  });

  it("descrição vazia ou só de espaços vai como null, nunca string vazia", async () => {
    for (const vazia of ["", "   ", "\n\t", null]) {
      registro.updates = [];
      const resultado = await salvarEtapaDaJornadaAction(
        entrada({ descricao: vazia }),
      );
      expect(resultado).toEqual({ ok: true });
      expect(registro.updates[0]!.descricao).toBeNull();
    }
  });

  it("criar etapa também grava os dois campos", async () => {
    const resultado = await salvarEtapaDaJornadaAction(
      entrada({
        chave: null,
        nome: "Boas-vindas",
        termos_de_quem: "qualquer",
        descricao: "Lead que recebeu a mensagem de boas-vindas",
      }),
    );

    expect(resultado).toEqual({ ok: true });
    const etapa = registro.inserts.find(
      (insert) => insert.tabela === "funnel_stage_def",
    );
    expect(etapa?.valores).toMatchObject({
      clinic_id: CLINICA,
      chave: "boas_vindas",
      termos_de_quem: "qualquer",
      descricao: "Lead que recebeu a mensagem de boas-vindas",
    });
  });

  it("descrição acima de 140 é recusada antes do banco, com mensagem de gente", async () => {
    const resultado = await salvarEtapaDaJornadaAction(
      entrada({ descricao: "a".repeat(141) }),
    );

    expect(resultado).toEqual({
      ok: false,
      error: "A descrição da etapa cabe em até 140 caracteres.",
    });
    expect(registro.updates).toEqual([]);
  });

  it("140 depois de colapsar os espaços passa", async () => {
    const resultado = await salvarEtapaDaJornadaAction(
      entrada({ descricao: `  ${"a".repeat(70)}     ${"b".repeat(69)}  ` }),
    );
    expect(resultado).toEqual({ ok: true });
    expect((registro.updates[0]!.descricao as string).length).toBe(140);
  });

  it("quem escreve fora do catálogo ou ausente é recusado", async () => {
    expect(
      await salvarEtapaDaJornadaAction(entrada({ termos_de_quem: "todos" })),
    ).toEqual({ ok: false, error: "Dados inválidos." });
    expect(
      await salvarEtapaDaJornadaAction(entrada({ termos_de_quem: undefined })),
    ).toEqual({ ok: false, error: "Dados inválidos." });
    expect(registro.updates).toEqual([]);
  });
});

describe("excluirEtapaDaJornadaAction: recusas do banco", () => {
  it("etapa com régua de follow-up: diz o que fazer, não o genérico", async () => {
    registro.erroDoDelete = {
      message: "Exclua a régua de follow-up desta etapa antes de excluí-la.",
    };

    expect(await excluirEtapaDaJornadaAction("em_contato")).toEqual({
      ok: false,
      error:
        "Esta etapa tem uma régua de follow-up. Exclua a régua em Automações antes de excluir a etapa.",
    });
  });

  it("recusa sem tradução continua no genérico", async () => {
    registro.erroDoDelete = { message: "erro qualquer do banco" };

    expect(await excluirEtapaDaJornadaAction("em_contato")).toEqual({
      ok: false,
      error: "Não foi possível excluir a etapa.",
    });
  });
});

describe("etapa e etiqueta usadas por automação de fluxo", () => {
  // O que o banco devolve (proteger_jornada e proteger_etiqueta_de_conversa,
  // migration 20261002130000): P0001 com o hint.
  const recusaDaEtapa: ErroFalso = {
    code: "P0001",
    message:
      "Esta etapa é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etapa.",
    hint: "etapa_usada_por_automacao",
  };
  const recusaDaEtiqueta: ErroFalso = {
    code: "P0001",
    message:
      "Esta etiqueta é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etiqueta.",
    hint: "etiqueta_usada_por_automacao",
  };

  it("excluir etapa usada: diz que é a automação e onde resolver", async () => {
    registro.erroDoDelete = recusaDaEtapa;
    const resultado = await excluirEtapaDaJornadaAction("em_contato");
    expect(resultado).toEqual({ ok: false, error: RECUSA_DA_ETAPA_USADA });
    expect(resultado.error).toContain(
      "em Automações, na aba Automações de fluxo",
    );
  });

  it("vale pelo código do banco, mesmo com outra mensagem", async () => {
    registro.erroDoDelete = {
      code: "P0001",
      message: "texto que mudou",
      hint: "etapa_usada_por_automacao",
    };
    expect(await excluirEtapaDaJornadaAction("em_contato")).toEqual({
      ok: false,
      error: RECUSA_DA_ETAPA_USADA,
    });
  });

  it("vale pela mensagem quando o hint não chega", async () => {
    registro.erroDoDelete = { message: recusaDaEtapa.message };
    expect(await excluirEtapaDaJornadaAction("em_contato")).toEqual({
      ok: false,
      error: RECUSA_DA_ETAPA_USADA,
    });
  });

  it("excluir etiqueta usada: diz que é a automação e onde resolver", async () => {
    registro.erroDoDelete = recusaDaEtiqueta;
    const resultado = await excluirEtiquetaDeConversaAction("retorno");
    expect(resultado).toEqual({ ok: false, error: RECUSA_DA_ETIQUETA_USADA });
    expect(resultado.error).toContain(
      "em Automações, na aba Automações de fluxo",
    );
  });

  it("etiqueta pelo código do banco, mesmo com outra mensagem", async () => {
    registro.erroDoDelete = {
      code: "P0001",
      message: "texto que mudou",
      hint: "etiqueta_usada_por_automacao",
    };
    expect(await excluirEtiquetaDeConversaAction("retorno")).toEqual({
      ok: false,
      error: RECUSA_DA_ETIQUETA_USADA,
    });
  });

  it("outra recusa da etiqueta continua no genérico", async () => {
    registro.erroDoDelete = { code: "42501", message: "permission denied" };
    expect(await excluirEtiquetaDeConversaAction("retorno")).toEqual({
      ok: false,
      error: "Não foi possível excluir a etiqueta.",
    });
  });

  it("a hint da etiqueta não vira a mensagem da etapa (e vice-versa)", async () => {
    registro.erroDoDelete = recusaDaEtiqueta;
    expect((await excluirEtapaDaJornadaAction("em_contato")).error).not.toBe(
      RECUSA_DA_ETAPA_USADA,
    );
    registro.erroDoDelete = recusaDaEtapa;
    expect((await excluirEtiquetaDeConversaAction("retorno")).error).toBe(
      "Não foi possível excluir a etiqueta.",
    );
  });
});

describe("reordenarEtapaDaJornadaAction: a ordem fixa das etapas de sistema", () => {
  const FRASE =
    "A ordem das etapas de sistema é fixa: Novo, Aguardando resposta, Contato inicial, Agendou e Compareceu.";

  function trilhas() {
    return registro.inserts.filter((insert) => insert.tabela === "audit_log");
  }

  it("troca entre duas da cadeia: recusada no servidor antes da RPC, com os nomes da clínica, sem trilha", async () => {
    expect(
      await reordenarEtapaDaJornadaAction("aguardando_resposta", "descer"),
    ).toEqual({ ok: false, error: FRASE });
    expect(await reordenarEtapaDaJornadaAction("em_contato", "subir")).toEqual({
      ok: false,
      error: FRASE,
    });
    expect(registro.rpcs).toEqual([]);
    expect(trilhas()).toEqual([]);
  });

  it("banco de antes da migration: Em contato já não passa de Novo (pela chave), sem RPC", async () => {
    // A ordem antiga, Em contato e Aguardando resposta ainda sem papel. A
    // RPC de antes nao recusaria; a cadeia invertida aqui faria a migration
    // parar (revisao de 21/10/2026).
    registro.jornada = [
      { chave: "novo", posicao: 10, nome: "Novo", papel: "entrada" },
      {
        chave: "em_contato",
        posicao: 20,
        nome: "Contato inicial",
        papel: null,
      },
      {
        chave: "aguardando_resposta",
        posicao: 30,
        nome: "Aguardando resposta",
        papel: null,
      },
      { chave: "agendou", posicao: 40, nome: "Agendou", papel: "agendou" },
      {
        chave: "compareceu",
        posicao: 50,
        nome: "Compareceu",
        papel: "compareceu",
      },
      { chave: "perdido", posicao: 60, nome: "Perdido", papel: "perdido" },
    ];
    expect(await reordenarEtapaDaJornadaAction("novo", "descer")).toEqual({
      ok: false,
      error:
        "A ordem das etapas de sistema é fixa: Novo, Contato inicial, Agendou e Compareceu.",
    });
    expect(registro.rpcs).toEqual([]);
    // Aguardando resposta sem papel segue livre: a troca vai para a RPC.
    expect(
      await reordenarEtapaDaJornadaAction("aguardando_resposta", "subir"),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toHaveLength(1);
  });

  it("o banco recusa o que a leitura deixou passar: a mesma frase, pelo hint ou pela mensagem", async () => {
    registro.erroDaRpc = {
      code: "P0001",
      message: "A ordem das etapas de sistema não muda.",
      hint: "ordem_de_sistema",
    };
    expect(await reordenarEtapaDaJornadaAction("perdido", "subir")).toEqual({
      ok: false,
      error: FRASE,
    });
    expect(registro.rpcs).toEqual([
      {
        nome: "reordenar_etapa_da_jornada",
        args: {
          p_clinic_id: CLINICA,
          p_chave: "perdido",
          p_direcao: "subir",
        },
      },
    ]);
    registro.erroDaRpc = { message: "A ordem das etapas de sistema não muda." };
    expect(await reordenarEtapaDaJornadaAction("perdido", "subir")).toEqual({
      ok: false,
      error: FRASE,
    });
    expect(trilhas()).toEqual([]);
  });

  it("a ponta e as outras recusas continuam com as frases delas", async () => {
    registro.erroDaRpc = { message: "A etapa já está na ponta da jornada." };
    expect(await reordenarEtapaDaJornadaAction("novo", "subir")).toEqual({
      ok: false,
      error: "A etapa já está na ponta da jornada.",
    });
    registro.erroDaRpc = { code: "XX000", message: "erro qualquer" };
    expect(await reordenarEtapaDaJornadaAction("compareceu", "descer")).toEqual(
      {
        ok: false,
        error: "Não foi possível reordenar. Tente de novo.",
      },
    );
  });

  it("leitura da jornada que falha: não reordena", async () => {
    registro.erroDaLeitura = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    expect(await reordenarEtapaDaJornadaAction("perdido", "subir")).toEqual({
      ok: false,
      error: "Não foi possível reordenar. Tente de novo.",
    });
    expect(registro.rpcs).toEqual([]);
  });

  it("troca aceita grava a trilha", async () => {
    expect(await reordenarEtapaDaJornadaAction("perdido", "subir")).toEqual({
      ok: true,
    });
    expect(trilhas()).toEqual([
      expect.objectContaining({
        valores: expect.objectContaining({
          action: "reordenou_etapa_da_jornada",
          entity_id: "etapa-1",
        }),
      }),
    ]);
  });
});
