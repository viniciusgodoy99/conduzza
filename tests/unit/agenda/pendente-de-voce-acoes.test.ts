import { beforeEach, describe, expect, it, vi } from "vitest";

// "Pendente de voce" no E4 (contrato da E4, secao 3; decisoes do dono de
// 20/10/2026): aprovarEncaixeAction e recusarEncaixeAction tratam o encaixe
// da IA (de sempre) e a consulta que a IA marcou (created_by 'ia', sem
// encaixe, nasce 'pendente' com send_confirmation false):
//   - aprovar a consulta da IA volta send_confirmation para true no MESMO
//     update (a regua de confirmacao so comeca depois da aprovacao);
//   - recusar a consulta da IA cancela sem oferecer o horario a lista de
//     espera e, DEPOIS da recusa, chama devolver_conversa_da_consulta_recusada
//     pela sessao; erro nela (ou conversa nao achada) nao desfaz a recusa:
//     volta ok com o aviso, e o log leva so ids e o codigo;
//   - o tipo vem do banco, nunca da tela; o encaixe segue como antes;
//   - cancelar pela Agenda (mudarStatusAction) a pendencia da IA conta como
//     recusar (decisao do dono de 20/10/2026): a mesma gravacao do Recusar,
//     a conversa devolvida depois e `recusada` no retorno, para a tela.
// Contra um cliente do Supabase dublado que aplica os filtros de eq.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const OUTRA_CLINICA = "0a0a0a0a-0000-4000-8000-00000000000b";
const DA_IA = "c0c0c0c0-0000-4000-8000-000000000001";
const ENCAIXE = "c0c0c0c0-0000-4000-8000-000000000002";
const DA_OUTRA = "c0c0c0c0-0000-4000-8000-000000000003";
const COMUM = "c0c0c0c0-0000-4000-8000-000000000004";
const USUARIO = "e1e1e1e1-0000-4000-8000-000000000001";

type Linha = Record<string, unknown>;
type Operacao = {
  tabela: string;
  tipo: "select" | "insert" | "update";
  dados?: unknown;
  colunas?: string;
  filtros: [string, unknown][];
  /** .not(coluna, "in", "(a,b)"): a coluna fora da lista. */
  excluidos: [string, string[]][];
};
type RespostaDoRpc = { data: unknown; error: { code?: string } | null };

const estado = {
  consultas: [] as Linha[],
  erroNaLeitura: null as { code: string } | null,
  erroNoUpdate: null as { code: string; message?: string } | null,
  rpc: { data: true, error: null } as RespostaDoRpc | "lanca",
  operacoes: [] as Operacao[],
  rpcs: [] as { nome: string; args: unknown }[],
  sequencia: [] as string[],
};

function consultaDaIa(): Linha {
  return {
    id: DA_IA,
    clinic_id: CLINICA,
    created_by: "ia",
    is_overbooking: false,
    approval_status: "pendente",
    status: "agendado",
    send_confirmation: false,
    oferecer_vaga_ao_cancelar: false,
  };
}

function encaixeDaIa(): Linha {
  return {
    id: ENCAIXE,
    clinic_id: CLINICA,
    created_by: "ia",
    is_overbooking: true,
    approval_status: "pendente",
    status: "agendado",
    send_confirmation: true,
    oferecer_vaga_ao_cancelar: true,
  };
}

// A consulta que a recepcao marcou: nunca foi pendencia.
function consultaComum(): Linha {
  return {
    id: COMUM,
    clinic_id: CLINICA,
    created_by: "usuario",
    is_overbooking: false,
    approval_status: null,
    status: "agendado",
    send_confirmation: true,
    oferecer_vaga_ao_cancelar: true,
  };
}

function from(tabela: string) {
  const op: Operacao = { tabela, tipo: "select", filtros: [], excluidos: [] };
  const casa = (linha: Linha) =>
    op.filtros.every(([coluna, valor]) => linha[coluna] === valor) &&
    op.excluidos.every(
      ([coluna, lista]) => !lista.includes(String(linha[coluna])),
    );
  const executar = (): { data: unknown; error: unknown } => {
    estado.operacoes.push(op);
    estado.sequencia.push(`${tabela}:${op.tipo}`);
    if (tabela !== "appointment") {
      return { data: null, error: null };
    }
    if (op.tipo === "select") {
      if (estado.erroNaLeitura) {
        return { data: null, error: estado.erroNaLeitura };
      }
      return {
        data: estado.consultas.filter(casa).map((linha) => ({ ...linha })),
        error: null,
      };
    }
    if (op.tipo === "update") {
      if (estado.erroNoUpdate) {
        return { data: null, error: estado.erroNoUpdate };
      }
      const alvos = estado.consultas.filter(casa);
      for (const linha of alvos) {
        Object.assign(linha, op.dados);
      }
      return { data: alvos.map((linha) => ({ id: linha.id })), error: null };
    }
    return { data: null, error: null };
  };
  const api = {
    select: (colunas: string) => {
      if (op.tipo === "select") {
        op.colunas = colunas;
      }
      return api;
    },
    update: (dados: unknown) => {
      op.tipo = "update";
      op.dados = dados;
      return api;
    },
    insert: (dados: unknown) => {
      op.tipo = "insert";
      op.dados = dados;
      return api;
    },
    eq: (coluna: string, valor: unknown) => {
      op.filtros.push([coluna, valor]);
      return api;
    },
    not: (coluna: string, operador: string, valor: string) => {
      if (operador !== "in") {
        throw new Error(`operador ${operador} sem dublê`);
      }
      op.excluidos.push([coluna, valor.replace(/^\(|\)$/g, "").split(",")]);
      return api;
    },
    maybeSingle: async () => {
      const { data, error } = executar();
      return {
        data: Array.isArray(data) ? (data[0] ?? null) : data,
        error,
      };
    },
    then: <T>(
      ok: (valor: { data: unknown; error: unknown }) => T,
      falha?: (erro: unknown) => T,
    ) => Promise.resolve(executar()).then(ok, falha),
  };
  return api;
}

const cliente = {
  from,
  rpc: async (nome: string, args: unknown) => {
    estado.rpcs.push({ nome, args });
    estado.sequencia.push(`rpc:${nome}`);
    if (estado.rpc === "lanca") {
      throw new Error("rede");
    }
    return estado.rpc;
  },
};

const sessao = {
  userId: USUARIO,
  active: {
    clinicId: CLINICA,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "recepcao" as string,
    status: "ativo",
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cliente,
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));

const { aprovarEncaixeAction, mudarStatusAction, recusarEncaixeAction } =
  await import("@/app/(app)/agenda/actions");

let logs: string[] = [];

function reiniciar() {
  estado.consultas = [
    consultaDaIa(),
    encaixeDaIa(),
    { ...consultaDaIa(), id: DA_OUTRA, clinic_id: OUTRA_CLINICA },
    consultaComum(),
  ];
  estado.erroNaLeitura = null;
  estado.erroNoUpdate = null;
  estado.rpc = { data: true, error: null };
  estado.operacoes = [];
  estado.rpcs = [];
  estado.sequencia = [];
  sessao.active.role = "recepcao";
  logs = [];
}

beforeEach(() => {
  reiniciar();
  vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
    logs.push(String(linha));
    return true;
  });
});

function linha(id: string): Linha {
  const achada = estado.consultas.find((c) => c.id === id);
  if (!achada) {
    throw new Error(`consulta ${id} nao existe`);
  }
  return achada;
}

function updates(): Operacao[] {
  return estado.operacoes.filter(
    (op) => op.tabela === "appointment" && op.tipo === "update",
  );
}

function trilha(): unknown[] {
  return estado.operacoes
    .filter((op) => op.tabela === "audit_log")
    .map((op) => op.dados);
}

// ---------------------------------------------------------------------------

describe("aprovar", () => {
  // Revisao da E4: a consulta da IA nasce com oferecer_vaga_ao_cancelar
  // false (so por causa da recusa). Aprovada, ela volta ao padrao da coluna:
  // sem isto, o paciente que cancela pela regua nunca liberava o horario
  // para a lista de espera (o gatilho oferecer_ao_cancelar pula com false).
  it("consulta da IA: aprovada, com a confirmação automática ligada e a vaga oferecida ao cancelar, no mesmo update", async () => {
    expect(await aprovarEncaixeAction(DA_IA)).toEqual({ ok: true });
    const [update] = updates();
    expect(update?.dados).toEqual({
      approval_status: "aprovado",
      send_confirmation: true,
      oferecer_vaga_ao_cancelar: true,
    });
    // O tipo lido do banco vai de novo no filtro (corrida perde educada).
    expect(update?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", DA_IA],
      ["approval_status", "pendente"],
      ["created_by", "ia"],
      ["is_overbooking", false],
    ]);
    expect(linha(DA_IA)).toMatchObject({
      approval_status: "aprovado",
      send_confirmation: true,
      oferecer_vaga_ao_cancelar: true,
    });
    expect(trilha()).toEqual([
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "aprovou_consulta_da_ia",
        entity: "appointment",
        entity_id: DA_IA,
      },
    ]);
    // Aprovar nao devolve conversa nenhuma.
    expect(estado.rpcs).toEqual([]);
  });

  it("encaixe da IA: só a aprovação, como antes", async () => {
    expect(await aprovarEncaixeAction(ENCAIXE)).toEqual({ ok: true });
    const [update] = updates();
    expect(update?.dados).toEqual({ approval_status: "aprovado" });
    expect(update?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", ENCAIXE],
      ["approval_status", "pendente"],
    ]);
    expect(trilha()).toMatchObject([{ action: "aprovou_encaixe" }]);
  });

  it("o tipo vem do banco: a leitura confere clínica, id e pendência", async () => {
    await aprovarEncaixeAction(DA_IA);
    const leitura = estado.operacoes.find(
      (op) => op.tabela === "appointment" && op.tipo === "select",
    );
    expect(leitura?.colunas).toBe("created_by, is_overbooking, status");
    expect(leitura?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", DA_IA],
      ["approval_status", "pendente"],
    ]);
  });

  it("já tratada, de outra clínica, leitura ou gravação que falha", async () => {
    linha(DA_IA).approval_status = "aprovado";
    expect(await aprovarEncaixeAction(DA_IA)).toEqual({
      ok: false,
      code: "ja_tratado",
      error: "Esta consulta já foi tratada.",
    });
    expect(await aprovarEncaixeAction(DA_OUTRA)).toMatchObject({
      ok: false,
      code: "ja_tratado",
    });
    expect(linha(DA_OUTRA).approval_status).toBe("pendente");

    estado.erroNaLeitura = { code: "57014" };
    expect(await aprovarEncaixeAction(ENCAIXE)).toEqual({
      ok: false,
      error: "Não foi possível conferir esta consulta. Tente de novo.",
    });
    estado.erroNaLeitura = null;
    estado.erroNoUpdate = { code: "42501" };
    expect(await aprovarEncaixeAction(ENCAIXE)).toEqual({
      ok: false,
      error: "Não foi possível aprovar. Tente de novo.",
    });
    expect(trilha()).toEqual([]);
  });
});

// Revisao da onda 2: a pendente cancelada pelo paciente (a funcao do banco
// muda so o status; ela continua 'pendente') conta como recusada. Aprovar
// converteria o lead e avancaria o funil de uma consulta cancelada; recusar
// trocaria o "cancelado pelo paciente" por "cancelado pela clinica".
describe("a pendente já cancelada", () => {
  it("aprovar: recusado com o texto da consulta cancelada, sem update nem trilha", async () => {
    linha(DA_IA).status = "cancelado_paciente";
    expect(await aprovarEncaixeAction(DA_IA)).toEqual({
      ok: false,
      code: "ja_tratado",
      error: "Esta consulta já foi cancelada.",
    });
    expect(updates()).toEqual([]);
    expect(trilha()).toEqual([]);
    expect(linha(DA_IA).approval_status).toBe("pendente");
  });

  it("recusar: recusado do mesmo jeito, e o cancelamento do paciente fica", async () => {
    linha(DA_IA).status = "cancelado_paciente";
    expect(await recusarEncaixeAction(DA_IA)).toEqual({
      ok: false,
      code: "ja_tratado",
      error: "Esta consulta já foi cancelada.",
    });
    expect(updates()).toEqual([]);
    expect(estado.rpcs).toEqual([]);
    expect(linha(DA_IA).status).toBe("cancelado_paciente");
  });

  it("a leitura da pendência traz a situação, e o update perde a corrida com o cancelamento", async () => {
    expect(await aprovarEncaixeAction(DA_IA)).toEqual({ ok: true });
    const leitura = estado.operacoes.find(
      (op) => op.tabela === "appointment" && op.tipo === "select",
    );
    expect(leitura?.colunas).toBe("created_by, is_overbooking, status");
    const [update] = updates();
    expect(update?.excluidos).toEqual([
      ["status", ["cancelado_paciente", "cancelado_clinica"]],
    ]);
  });

  it("o encaixe pendente cancelado pela clínica também não aprova", async () => {
    linha(ENCAIXE).status = "cancelado_clinica";
    const resultado = await aprovarEncaixeAction(ENCAIXE);
    expect(resultado).toMatchObject({ ok: false, code: "ja_tratado" });
    expect(updates()).toEqual([]);
  });
});

describe("recusar", () => {
  it("consulta da IA: cancela sem oferecer o horário e, depois, devolve a conversa", async () => {
    expect(await recusarEncaixeAction(DA_IA)).toEqual({ ok: true });
    const [update] = updates();
    expect(update?.dados).toEqual({
      approval_status: "recusado",
      status: "cancelado_clinica",
      oferecer_vaga_ao_cancelar: false,
    });
    expect(update?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", DA_IA],
      ["approval_status", "pendente"],
      ["created_by", "ia"],
      ["is_overbooking", false],
    ]);
    expect(estado.rpcs).toEqual([
      {
        nome: "devolver_conversa_da_consulta_recusada",
        args: { p_clinic_id: CLINICA, p_appointment_id: DA_IA },
      },
    ]);
    // A RPC so depois da recusa gravada.
    expect(estado.sequencia.indexOf("appointment:update")).toBeLessThan(
      estado.sequencia.indexOf("rpc:devolver_conversa_da_consulta_recusada"),
    );
    // Historico e trilha como sempre, com a acao propria.
    const historico = estado.operacoes.find(
      (op) => op.tabela === "appointment_status_history",
    );
    expect(historico?.dados).toEqual({
      clinic_id: CLINICA,
      appointment_id: DA_IA,
      status: "cancelado_clinica",
      changed_by: "usuario",
      changed_by_user_id: USUARIO,
    });
    expect(trilha()).toMatchObject([{ action: "recusou_consulta_da_ia" }]);
  });

  it("erro na devolução não desfaz a recusa: ok com o aviso, e o log só com ids e o código", async () => {
    estado.rpc = { data: null, error: { code: "42501" } };
    const r = await recusarEncaixeAction(DA_IA);
    expect(r).toEqual({
      ok: true,
      aviso:
        "A consulta foi recusada, mas a conversa não voltou para a equipe. Abra a conversa no Atendimento e avise o paciente.",
    });
    // Uma gravacao so: nada volta atras.
    expect(updates()).toHaveLength(1);
    expect(linha(DA_IA)).toMatchObject({
      approval_status: "recusado",
      status: "cancelado_clinica",
    });
    const linhaDoLog = logs.find((l) =>
      l.includes('"evento":"agenda_conversa_nao_devolvida"'),
    );
    expect(linhaDoLog).toBeDefined();
    const campos = JSON.parse(linhaDoLog ?? "{}") as Record<string, unknown>;
    expect(campos).toMatchObject({
      nivel: "warn",
      clinic_id: CLINICA,
      user_id: USUARIO,
      error_code: "42501",
    });
    expect(Object.keys(campos).sort()).toEqual(
      ["clinic_id", "error_code", "evento", "nivel", "ts", "user_id"].sort(),
    );
  });

  it("a RPC que lança também vira aviso, e a conversa não encontrada também avisa", async () => {
    estado.rpc = "lanca";
    expect(await recusarEncaixeAction(DA_IA)).toMatchObject({
      ok: true,
      aviso: expect.stringContaining("a conversa não voltou para a equipe"),
    });

    estado.consultas = [consultaDaIa()];
    estado.rpc = { data: false, error: null };
    expect(await recusarEncaixeAction(DA_IA)).toEqual({
      ok: true,
      aviso:
        "A consulta foi recusada, mas a conversa do paciente não foi encontrada. Avise o paciente pelo Atendimento.",
    });
    expect(logs.join("")).toContain('"evento":"agenda_recusa_sem_conversa"');
  });

  it("encaixe da IA: recusa como antes, sem devolver conversa", async () => {
    expect(await recusarEncaixeAction(ENCAIXE)).toEqual({ ok: true });
    expect(updates()[0]?.dados).toEqual({
      approval_status: "recusado",
      status: "cancelado_clinica",
    });
    expect(estado.rpcs).toEqual([]);
    expect(trilha()).toMatchObject([{ action: "recusou_encaixe" }]);
  });

  it("já tratada: nada de devolver conversa, nada de histórico", async () => {
    linha(DA_IA).approval_status = "recusado";
    expect(await recusarEncaixeAction(DA_IA)).toMatchObject({
      ok: false,
      code: "ja_tratado",
    });
    expect(estado.rpcs).toEqual([]);
    expect(
      estado.operacoes.some((op) => op.tabela === "appointment_status_history"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cancelar pela Agenda (mudarStatusAction) conta como recusar
// ---------------------------------------------------------------------------

function cancelar(
  id: string,
  novoStatus: "cancelado_paciente" | "cancelado_clinica" = "cancelado_paciente",
  extra: { oferecer_vaga?: boolean; status_atual?: string } = {},
) {
  return mudarStatusAction({
    id,
    status_atual: "agendado",
    novo_status: novoStatus,
    canal: null,
    ...extra,
  });
}

function historico(): unknown[] {
  return estado.operacoes
    .filter((op) => op.tabela === "appointment_status_history")
    .map((op) => op.dados);
}

/** O que foi gravado (tabela, tipo e dados), sem as leituras. */
function gravacoes(): unknown[] {
  return estado.operacoes
    .filter((op) => op.tipo !== "select")
    .map(({ tabela, tipo, dados }) => ({ tabela, tipo, dados }));
}

describe("cancelar pela Agenda a pendência da IA conta como recusar", () => {
  it("consulta da IA pendente: recusada e cancelada pela clínica, sai do Pendente de você e, depois, devolve a conversa", async () => {
    // Mesmo "a pedido do paciente" e com a lista de espera marcada: o
    // resultado e o do Recusar (decisao do dono de 20/10/2026).
    expect(
      await cancelar(DA_IA, "cancelado_paciente", { oferecer_vaga: true }),
    ).toEqual({ ok: true, recusada: "consulta_da_ia" });
    const [update] = updates();
    expect(update?.dados).toEqual({
      approval_status: "recusado",
      status: "cancelado_clinica",
      oferecer_vaga_ao_cancelar: false,
    });
    // O tipo lido do banco e o status que a tela viu vao no filtro.
    expect(update?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", DA_IA],
      ["approval_status", "pendente"],
      ["created_by", "ia"],
      ["is_overbooking", false],
      ["status", "agendado"],
    ]);
    expect(linha(DA_IA)).toMatchObject({
      approval_status: "recusado",
      status: "cancelado_clinica",
      oferecer_vaga_ao_cancelar: false,
    });
    expect(
      estado.consultas.filter(
        (c) => c.clinic_id === CLINICA && c.approval_status === "pendente",
      ),
    ).toEqual([encaixeDaIa()]);
    expect(estado.rpcs).toEqual([
      {
        nome: "devolver_conversa_da_consulta_recusada",
        args: { p_clinic_id: CLINICA, p_appointment_id: DA_IA },
      },
    ]);
    // A RPC so depois da recusa gravada.
    expect(estado.sequencia.indexOf("appointment:update")).toBeLessThan(
      estado.sequencia.indexOf("rpc:devolver_conversa_da_consulta_recusada"),
    );
    expect(historico()).toEqual([
      {
        clinic_id: CLINICA,
        appointment_id: DA_IA,
        status: "cancelado_clinica",
        changed_by: "usuario",
        changed_by_user_id: USUARIO,
      },
    ]);
    expect(trilha()).toEqual([
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "recusou_consulta_da_ia",
        entity: "appointment",
        entity_id: DA_IA,
      },
    ]);
  });

  it("grava exatamente o que o Recusar grava", async () => {
    await recusarEncaixeAction(DA_IA);
    const doRecusar = gravacoes();
    const rpcsDoRecusar = [...estado.rpcs];
    expect(doRecusar).not.toEqual([]);

    for (const novoStatus of [
      "cancelado_clinica",
      "cancelado_paciente",
    ] as const) {
      reiniciar();
      await cancelar(DA_IA, novoStatus);
      expect(gravacoes(), novoStatus).toEqual(doRecusar);
      expect(estado.rpcs, novoStatus).toEqual(rpcsDoRecusar);
    }
  });

  it("erro na devolução não desfaz o cancelamento: ok com o aviso, e o log só com ids e o código", async () => {
    estado.rpc = { data: null, error: { code: "42501" } };
    expect(await cancelar(DA_IA)).toEqual({
      ok: true,
      recusada: "consulta_da_ia",
      aviso:
        "A consulta foi recusada, mas a conversa não voltou para a equipe. Abra a conversa no Atendimento e avise o paciente.",
    });
    // Uma gravacao so: nada volta atras.
    expect(updates()).toHaveLength(1);
    expect(linha(DA_IA)).toMatchObject({
      approval_status: "recusado",
      status: "cancelado_clinica",
    });
    const linhaDoLog = logs.find((l) =>
      l.includes('"evento":"agenda_conversa_nao_devolvida"'),
    );
    expect(linhaDoLog).toBeDefined();
    const campos = JSON.parse(linhaDoLog ?? "{}") as Record<string, unknown>;
    expect(campos).toMatchObject({
      clinic_id: CLINICA,
      user_id: USUARIO,
      error_code: "42501",
    });
    expect(Object.keys(campos).sort()).toEqual(
      ["clinic_id", "error_code", "evento", "nivel", "ts", "user_id"].sort(),
    );

    // A RPC que lanca tambem vira aviso.
    reiniciar();
    estado.rpc = "lanca";
    expect(await cancelar(DA_IA)).toMatchObject({
      ok: true,
      recusada: "consulta_da_ia",
      aviso: expect.stringContaining("a conversa não voltou para a equipe"),
    });
    expect(linha(DA_IA).approval_status).toBe("recusado");
  });

  it("encaixe da IA pendente: a recusa do encaixe, sem devolver conversa", async () => {
    expect(await cancelar(ENCAIXE, "cancelado_clinica")).toEqual({
      ok: true,
      recusada: "encaixe",
    });
    expect(updates()[0]?.dados).toEqual({
      approval_status: "recusado",
      status: "cancelado_clinica",
    });
    expect(linha(ENCAIXE).approval_status).toBe("recusado");
    expect(estado.rpcs).toEqual([]);
    expect(trilha()).toMatchObject([{ action: "recusou_encaixe" }]);
  });

  it("consulta comum e consulta da IA já aprovada: o cancelamento de sempre, sem recusa nem conversa", async () => {
    expect(
      await cancelar(COMUM, "cancelado_paciente", { oferecer_vaga: false }),
    ).toEqual({ ok: true });
    expect(updates()[0]?.dados).toEqual({
      status: "cancelado_paciente",
      oferecer_vaga_ao_cancelar: false,
    });
    expect(linha(COMUM)).toMatchObject({
      approval_status: null,
      status: "cancelado_paciente",
    });
    expect(trilha()).toMatchObject([{ action: "mudou_status" }]);

    reiniciar();
    linha(DA_IA).approval_status = "aprovado";
    expect(await cancelar(DA_IA, "cancelado_clinica")).toEqual({ ok: true });
    expect(updates()[0]?.dados).toEqual({
      status: "cancelado_clinica",
      oferecer_vaga_ao_cancelar: true,
    });
    expect(linha(DA_IA).approval_status).toBe("aprovado");
    expect(estado.rpcs).toEqual([]);
    expect(trilha()).toMatchObject([{ action: "mudou_status" }]);
  });

  // Onda 2 (item 10, P10a e P10b): a consulta pendente so aprova, recusa ou
  // cancela. Antes, confirmar uma pendente da IA passava (e Compareceu
  // avancaria o funil antes da aprovacao).
  it("outra mudança de situação na consulta pendente espera a aprovação: nada é gravado", async () => {
    for (const [id, novo_status, canal] of [
      [DA_IA, "confirmado_recepcao", "telefone"],
      [DA_IA, "aguardando_confirmacao", null],
      [ENCAIXE, "confirmado_recepcao", "presencial"],
    ] as const) {
      reiniciar();
      expect(
        await mudarStatusAction({
          id,
          status_atual: "agendado",
          novo_status,
          canal,
        }),
        `${id} ${novo_status}`,
      ).toEqual({
        ok: false,
        code: "consulta_pendente",
        error:
          "Esta consulta ainda espera aprovação. Aprove ou recuse antes de mudar a situação.",
      });
      expect(linha(id)).toMatchObject({
        approval_status: "pendente",
        status: "agendado",
      });
      expect(gravacoes()).toEqual([]);
      expect(estado.rpcs).toEqual([]);
    }
  });

  it("a pendência que barra a mudança é lida do banco, pela clínica e pelo id", async () => {
    await mudarStatusAction({
      id: DA_IA,
      status_atual: "agendado",
      novo_status: "confirmado_recepcao",
      canal: "telefone",
    });
    const leitura = estado.operacoes.find(
      (op) => op.tabela === "appointment" && op.tipo === "select",
    );
    expect(leitura?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", DA_IA],
      ["approval_status", "pendente"],
    ]);

    // Leitura que falha: nada gravado (falha fechada).
    reiniciar();
    estado.erroNaLeitura = { code: "57014" };
    expect(
      await mudarStatusAction({
        id: DA_IA,
        status_atual: "agendado",
        novo_status: "confirmado_recepcao",
        canal: "telefone",
      }),
    ).toEqual({
      ok: false,
      error: "Não foi possível conferir esta consulta. Tente de novo.",
    });
    expect(gravacoes()).toEqual([]);
  });

  it("consulta comum e consulta da IA já aprovada mudam de situação como sempre", async () => {
    expect(
      await mudarStatusAction({
        id: COMUM,
        status_atual: "agendado",
        novo_status: "confirmado_recepcao",
        canal: "telefone",
      }),
    ).toEqual({ ok: true });
    expect(linha(COMUM).status).toBe("confirmado_recepcao");

    reiniciar();
    linha(DA_IA).approval_status = "aprovado";
    expect(
      await mudarStatusAction({
        id: DA_IA,
        status_atual: "agendado",
        novo_status: "confirmado_recepcao",
        canal: "telefone",
      }),
    ).toEqual({ ok: true });
    expect(linha(DA_IA)).toMatchObject({
      approval_status: "aprovado",
      status: "confirmado_recepcao",
    });
  });

  it("o gatilho do banco que recusa (23514 consulta_pendente) vira a mesma dica", async () => {
    // A consulta virou pendente entre a leitura e o update: o banco recusa.
    estado.erroNoUpdate = {
      code: "23514",
      message: "consulta_pendente",
    };
    expect(
      await mudarStatusAction({
        id: COMUM,
        status_atual: "agendado",
        novo_status: "confirmado_recepcao",
        canal: "telefone",
      }),
    ).toEqual({
      ok: false,
      code: "consulta_pendente",
      error:
        "Esta consulta ainda espera aprovação. Aprove ou recuse antes de mudar a situação.",
    });
    // Outro 23514 continua o erro de sempre.
    reiniciar();
    estado.erroNoUpdate = { code: "23514", message: "outra_regra" };
    expect(
      await mudarStatusAction({
        id: COMUM,
        status_atual: "agendado",
        novo_status: "confirmado_recepcao",
        canal: "telefone",
      }),
    ).toEqual({ ok: false, error: "Não foi possível mudar a situação." });
  });

  it("a pendência é lida do banco: leitura que falha não grava nada", async () => {
    estado.erroNaLeitura = { code: "57014" };
    expect(await cancelar(DA_IA)).toEqual({
      ok: false,
      error: "Não foi possível conferir esta consulta. Tente de novo.",
    });
    expect(gravacoes()).toEqual([]);
    expect(estado.rpcs).toEqual([]);
  });

  it("a situação mudou no meio: já tratada, sem conversa, histórico nem trilha", async () => {
    linha(DA_IA).status = "confirmado_recepcao";
    expect(await cancelar(DA_IA)).toEqual({
      ok: false,
      code: "ja_tratado",
      error: "Esta consulta já foi tratada.",
    });
    expect(linha(DA_IA)).toMatchObject({
      approval_status: "pendente",
      status: "confirmado_recepcao",
    });
    expect(estado.rpcs).toEqual([]);
    expect(historico()).toEqual([]);
    expect(trilha()).toEqual([]);
  });

  it("a consulta de outra clínica não é lida nem gravada", async () => {
    expect(await cancelar(DA_OUTRA)).toMatchObject({
      ok: false,
      code: "ja_tratado",
    });
    expect(linha(DA_OUTRA)).toMatchObject({
      approval_status: "pendente",
      status: "agendado",
    });
    expect(estado.rpcs).toEqual([]);
  });
});

describe("guarda", () => {
  it("somente leitura e id inválido não tocam o banco", async () => {
    sessao.active.role = "leitura";
    expect(await aprovarEncaixeAction(DA_IA)).toEqual({
      ok: false,
      error: "Seu perfil não pode alterar a agenda.",
    });
    expect(await recusarEncaixeAction(DA_IA)).toEqual({
      ok: false,
      error: "Seu perfil não pode alterar a agenda.",
    });
    expect(await cancelar(DA_IA)).toEqual({
      ok: false,
      error: "Seu perfil não pode alterar a agenda.",
    });
    sessao.active.role = "recepcao";
    expect(await recusarEncaixeAction("nao-e-uuid")).toEqual({
      ok: false,
      error: "Consulta inválida.",
    });
    expect(estado.operacoes).toEqual([]);
    expect(estado.rpcs).toEqual([]);
  });
});
