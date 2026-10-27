import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BancoFalso, type Linha } from "./banco-falso-da-agenda";

// Remarcacao pedida pela IA na Agenda (AG4, decisao D-10; desenho da secao
// 5, com as recomendacoes das decisoes pendentes D-27, D-28, D-29 e D-32),
// pelas Server Actions (app/(app)/agenda/actions.ts), contra um cliente do
// Supabase dublado:
//   - aprovarRemarcacaoAction: guarda de sempre da Agenda (o papel leitura
//     nem chega ao banco) e Zod estrito; le a remarcacao e a antiga do BANCO;
//     aprova como a consulta da IA de sempre, com a ligacao no filtro; o
//     gatilho cancela a antiga (o 23514 remarcacao_consulta_antiga_encerrada
//     vira o texto do desenho, com o horario da antiga no fuso da clinica);
//     com a caixa marcada (D-28), o aviso de remarcacao de sempre sai com a
//     consulta NOVA; o texto de sucesso diz o horario da antiga;
//   - recusarRemarcacaoAction: a recusa da consulta da IA de sempre (so a
//     nova e cancelada, sem reoferta; a conversa volta), com a ligacao no
//     filtro e os textos da remarcacao ("continua marcada" so quando
//     continua);
//   - os caminhos antigos (aprovarEncaixeAction, recusarEncaixeAction e o
//     cancelar do mudarStatusAction) passam pela remarcacao quando a
//     pendencia e uma;
//   - remarcarAgendamentoAction distingue o 23514 remarcacao_pendente (D-32)
//     do "consulta encerrada".

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const OUTRA_CLINICA = "0a0a0a0a-0000-4000-8000-00000000000b";
const NOVA = "c0c0c0c0-0000-4000-8000-0000000000a1";
const ANTIGA = "c0c0c0c0-0000-4000-8000-0000000000a0";
const DA_IA = "c0c0c0c0-0000-4000-8000-0000000000b1";
const CONTATO = "3d3d3d3d-0000-4000-8000-000000000001";
const PROFISSIONAL = "1b1b1b1b-0000-4000-8000-000000000001";
const USUARIO = "e1e1e1e1-0000-4000-8000-000000000001";
const NUMERO = "9a9a9a9a-0000-4000-8000-000000000001";

// 29/10/2026 14:00 e 03/11/2026 10:00 em Fortaleza (UTC-3).
const INICIO_DA_ANTIGA = "2026-10-29T17:00:00.000Z";
const INICIO_DA_NOVA = "2026-11-03T13:00:00.000Z";

const TEXTOS = {
  jaTratada: "Esta remarcação já foi tratada.",
  // Com o aviso pelo WhatsApp pedido (a caixa marcada).
  aprovada: "Remarcação aprovada. A consulta de 29/10 às 14:00 foi cancelada.",
  // Sem ele (a caixa desmarcada ou o Aprovar de antes; revisao, achado 4).
  aprovadaSemAviso:
    "Remarcação aprovada. A consulta de 29/10 às 14:00 foi cancelada. Avise o paciente pelo Atendimento.",
  aprovadaJaCancelada:
    "Remarcação aprovada. A consulta de 29/10 às 14:00 já estava cancelada. Avise o paciente pelo Atendimento.",
  // A antiga continua com o pedido e sem a confirmacao automatica
  // (revisao, achado 9), com o nome do botao entre aspas (revisao curta).
  recusada:
    'Remarcação recusada. A consulta de 29/10 às 14:00 continua marcada, com o pedido de remarcação: a confirmação automática fica parada até alguém usar "Manter o horário", em Confirmações. Avise o paciente pelo Atendimento.',
  antigaEncerrada:
    "A consulta de 29/10 às 14:00 já foi atendida ou teve a falta marcada. Recuse esta remarcação e fale com o paciente.",
  dicaDaAntiga:
    "Aprove ou recuse a remarcação pedida pela IA antes de mover esta consulta.",
} as const;

let banco = new BancoFalso();
const fila: unknown[] = [];

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
  createClient: async () => banco.cliente(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => ({
      insert: async (dados: unknown) => {
        fila.push({ tabela, dados });
        return { error: null };
      },
    }),
  }),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));

const {
  aprovarEncaixeAction,
  aprovarRemarcacaoAction,
  mudarStatusAction,
  recusarEncaixeAction,
  recusarRemarcacaoAction,
  remarcarAgendamentoAction,
} = await import("@/app/(app)/agenda/actions");

function nova(extra: Linha = {}): Linha {
  return {
    id: NOVA,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    professional_id: PROFISSIONAL,
    created_by: "ia",
    is_overbooking: false,
    approval_status: "pendente",
    status: "agendado",
    send_confirmation: false,
    oferecer_vaga_ao_cancelar: false,
    remarcacao_de: ANTIGA,
    starts_at: INICIO_DA_NOVA,
    ...extra,
  };
}

function antiga(extra: Linha = {}): Linha {
  return {
    id: ANTIGA,
    clinic_id: CLINICA,
    contact_id: CONTATO,
    professional_id: PROFISSIONAL,
    created_by: "usuario",
    is_overbooking: false,
    approval_status: null,
    status: "confirmado_paciente",
    remarcacao_de: null,
    starts_at: INICIO_DA_ANTIGA,
    ...extra,
  };
}

/** A consulta que a IA marcou (sem remarcacao): o caminho de sempre. */
function daIa(): Linha {
  return {
    ...nova(),
    id: DA_IA,
    remarcacao_de: null,
  };
}

let logs: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T15:00:00.000Z"));
  banco = new BancoFalso();
  banco.tabelas.appointment = [nova(), antiga(), daIa()];
  banco.tabelas.contact = [
    { id: CONTATO, clinic_id: CLINICA, name: "Paciente de Teste" },
  ];
  banco.tabelas.whatsapp_account = [
    { id: NUMERO, clinic_id: CLINICA, removido_em: null },
  ];
  banco.respostasDosRpcs = {
    consentimento_vigente: { data: true, error: null },
    contas_de_envio: {
      data: [
        {
          contact_id: CONTATO,
          whatsapp_account_id: NUMERO,
          nome: "Principal",
          connection_status: "conectado",
        },
      ],
      error: null,
    },
    devolver_conversa_da_consulta_recusada: { data: true, error: null },
  };
  fila.length = 0;
  sessao.active.role = "recepcao";
  logs = [];
  vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
    logs.push(String(linha));
    return true;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function updatesDaConsulta() {
  return banco.doTipo("appointment", "update");
}

function trilha(): unknown[] {
  return banco.doTipo("audit_log", "insert").map((op) => op.dados);
}

// ---------------------------------------------------------------------------

describe("a guarda, antes do banco", () => {
  it("o papel leitura recebe a dica de sempre e nada é lido nem gravado", async () => {
    sessao.active.role = "leitura";
    expect(
      await aprovarRemarcacaoAction({ id: NOVA, avisar_paciente: true }),
    ).toEqual({ ok: false, error: "Seu perfil não pode alterar a agenda." });
    expect(await recusarRemarcacaoAction(NOVA)).toEqual({
      ok: false,
      error: "Seu perfil não pode alterar a agenda.",
    });
    expect(banco.operacoes).toEqual([]);
    expect(banco.rpcs).toEqual([]);
  });

  it("entrada fora do formato (o Zod estrito) é recusada antes do banco", async () => {
    for (const entrada of [
      { id: NOVA },
      { id: NOVA, avisar_paciente: "sim" },
      { id: "nao-e-uuid", avisar_paciente: true },
      { id: NOVA, avisar_paciente: true, extra: 1 },
      null,
      NOVA,
    ]) {
      expect(
        await aprovarRemarcacaoAction(entrada),
        JSON.stringify(entrada),
      ).toEqual({ ok: false, error: "Consulta inválida." });
    }
    expect(await recusarRemarcacaoAction("x")).toEqual({
      ok: false,
      error: "Consulta inválida.",
    });
    expect(banco.operacoes).toEqual([]);
  });
});

describe("aprovar a remarcação", () => {
  it("lê a remarcação e a antiga do banco e aprova como a consulta da IA, com a ligação no filtro", async () => {
    const r = await aprovarRemarcacaoAction({
      id: NOVA,
      avisar_paciente: false,
    });
    expect(r).toEqual({ ok: true, mensagem: TEXTOS.aprovadaSemAviso });

    const [daNova, daAntiga] = banco.doTipo("appointment", "select");
    expect(daNova?.colunas).toBe(
      "created_by, is_overbooking, status, remarcacao_de, contact_id, professional_id, starts_at",
    );
    expect(daNova?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", NOVA],
      ["approval_status", "pendente"],
    ]);
    expect(daAntiga?.colunas).toBe("starts_at, status");
    expect(daAntiga?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", ANTIGA],
    ]);

    const [update, ...outros] = updatesDaConsulta();
    expect(outros).toEqual([]);
    expect(update?.dados).toEqual({
      approval_status: "aprovado",
      send_confirmation: true,
      oferecer_vaga_ao_cancelar: true,
    });
    expect(update?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", NOVA],
      ["approval_status", "pendente"],
      ["created_by", "ia"],
      ["is_overbooking", false],
      ["remarcacao_de", ANTIGA],
    ]);
    expect(update?.excluidos).toEqual([
      ["status", ["cancelado_paciente", "cancelado_clinica"]],
    ]);
    // A antiga e do gatilho do banco: a acao nao mexe nela.
    expect(banco.linha("appointment", ANTIGA).status).toBe(
      "confirmado_paciente",
    );
    expect(trilha()).toEqual([
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "aprovou_remarcacao_da_ia",
        entity: "appointment",
        entity_id: NOVA,
      },
    ]);
    // Sem a caixa, nada sai para o paciente.
    expect(banco.rpcs).toEqual([]);
    expect(fila).toEqual([]);
  });

  it("com a caixa marcada (D-28), sai o aviso de remarcação de sempre, com a consulta nova", async () => {
    const r = await aprovarRemarcacaoAction({
      id: NOVA,
      avisar_paciente: true,
    });
    expect(r).toEqual({ ok: true, mensagem: TEXTOS.aprovada });
    // A aprovacao vem antes do aviso.
    expect(banco.sequencia.indexOf("appointment:update")).toBeLessThan(
      banco.sequencia.indexOf("rpc:consentimento_vigente"),
    );
    expect(banco.rpcs.map((chamada) => chamada.nome)).toEqual([
      "consentimento_vigente",
      "contas_de_envio",
    ]);
    expect(banco.rpcs[0]?.args).toEqual({
      p_clinic_id: CLINICA,
      p_contact_id: CONTATO,
      p_channel: "whatsapp",
    });
    expect(fila).toEqual([
      {
        tabela: "job_queue",
        dados: {
          clinic_id: CLINICA,
          kind: "enviar_mensagem_ativa",
          payload: {
            contact_id: CONTATO,
            body: "Olá, Paciente de Teste! Sua consulta na Clínica A foi remarcada para 03/11/2026 às 10:00. Qualquer dúvida, é só responder aqui.",
            appointment_id: NOVA,
            starts_at: INICIO_DA_NOVA,
            professional_id: PROFISSIONAL,
            tipo_de_envio: "aviso_remarcacao",
          },
          whatsapp_account_id: NUMERO,
        },
      },
    ]);
    expect(trilha()).toMatchObject([
      { action: "aprovou_remarcacao_da_ia", entity_id: NOVA },
      { action: "enfileirou_aviso_de_remarcacao", entity_id: NOVA },
    ]);
  });

  it("o aviso que não sai volta junto do sucesso, nunca no lugar dele", async () => {
    banco.respostasDosRpcs.consentimento_vigente = {
      data: false,
      error: null,
    };
    expect(
      await aprovarRemarcacaoAction({ id: NOVA, avisar_paciente: true }),
    ).toEqual({
      ok: true,
      mensagem: TEXTOS.aprovada,
      aviso: "O paciente não autorizou receber mensagens. Avise por telefone.",
    });
    expect(fila).toEqual([]);
  });

  it("a antiga já cancelada nesse meio: aprova e diz que ela já estava cancelada", async () => {
    banco.linha("appointment", ANTIGA).status = "cancelado_paciente";
    expect(
      await aprovarRemarcacaoAction({ id: NOVA, avisar_paciente: false }),
    ).toEqual({ ok: true, mensagem: TEXTOS.aprovadaJaCancelada });
  });

  it("o 23514 do gatilho (a antiga já atendida ou com falta) vira o texto do desenho, sem trilha nem aviso", async () => {
    banco.errosNoUpdate.appointment = {
      code: "23514",
      message: "remarcacao_consulta_antiga_encerrada",
      hint: "A consulta antiga já foi atendida ou teve a falta marcada. Recuse esta remarcação e fale com o paciente.",
    };
    expect(
      await aprovarRemarcacaoAction({ id: NOVA, avisar_paciente: true }),
    ).toEqual({
      ok: false,
      code: "remarcacao_antiga_encerrada",
      error: TEXTOS.antigaEncerrada,
    });
    expect(trilha()).toEqual([]);
    expect(banco.rpcs).toEqual([]);
    expect(fila).toEqual([]);
  });

  it("outro erro do banco: tente de novo (o 23514 de outra regra também)", async () => {
    for (const erro of [
      { code: "42501" },
      { code: "23514", message: "outra_regra" },
    ]) {
      banco.errosNoUpdate.appointment = erro;
      expect(
        await aprovarRemarcacaoAction({ id: NOVA, avisar_paciente: false }),
        JSON.stringify(erro),
      ).toEqual({
        ok: false,
        error: "Não foi possível aprovar. Tente de novo.",
      });
    }
    expect(trilha()).toEqual([]);
  });

  it("quem chega depois: já tratada, sem gravar nada", async () => {
    for (const mudanca of [
      { approval_status: "aprovado" },
      { approval_status: "recusado", status: "cancelado_clinica" },
      // A pendente cancelada conta como recusada (revisao da onda 2).
      { status: "cancelado_paciente" },
      { clinic_id: OUTRA_CLINICA },
    ]) {
      banco.tabelas.appointment = [nova(mudanca), antiga()];
      banco.operacoes = [];
      expect(
        await aprovarRemarcacaoAction({ id: NOVA, avisar_paciente: true }),
        JSON.stringify(mudanca),
      ).toEqual({ ok: false, code: "ja_tratado", error: TEXTOS.jaTratada });
      expect(updatesDaConsulta()).toEqual([]);
    }
    // Nao e remarcacao da IA: nada a aprovar por aqui.
    banco.tabelas.appointment = [nova({ remarcacao_de: null }), antiga()];
    expect(
      await aprovarRemarcacaoAction({ id: NOVA, avisar_paciente: false }),
    ).toEqual({ ok: false, code: "ja_tratado", error: TEXTOS.jaTratada });
    expect(fila).toEqual([]);
  });

  it("a corrida perde educadamente: zero linhas no update é já tratada", async () => {
    // A leitura viu pendente; outra pessoa aprovou antes do update.
    banco.errosNoUpdate = {};
    const original = banco.cliente.bind(banco);
    banco.cliente = () => {
      const cliente = original();
      return {
        ...cliente,
        from: (tabela: string) => {
          const consulta = cliente.from(tabela);
          if (tabela !== "appointment") {
            return consulta;
          }
          const update = consulta.update;
          consulta.update = (dados: unknown) => {
            banco.linha("appointment", NOVA).approval_status = "aprovado";
            return update(dados);
          };
          return consulta;
        },
      };
    };
    expect(
      await aprovarRemarcacaoAction({ id: NOVA, avisar_paciente: true }),
    ).toEqual({ ok: false, code: "ja_tratado", error: TEXTOS.jaTratada });
    expect(trilha()).toEqual([]);
    expect(fila).toEqual([]);
  });

  it("leitura que falha: nada gravado (falha fechada)", async () => {
    banco.errosNaLeitura.appointment = { code: "57014" };
    expect(
      await aprovarRemarcacaoAction({ id: NOVA, avisar_paciente: true }),
    ).toEqual({
      ok: false,
      error: "Não foi possível conferir esta remarcação. Tente de novo.",
    });
    expect(banco.gravacoes()).toEqual([]);
  });

  it("sem a antiga (a RLS não deixou ler): aprova sem dizer o horário", async () => {
    banco.tabelas.appointment = [nova()];
    expect(
      await aprovarRemarcacaoAction({ id: NOVA, avisar_paciente: false }),
    ).toEqual({
      ok: true,
      mensagem: "Remarcação aprovada. Avise o paciente pelo Atendimento.",
    });
  });
});

describe("recusar a remarcação", () => {
  it("cancela só a nova, sem reoferta, com a ligação no filtro, e depois devolve a conversa", async () => {
    expect(await recusarRemarcacaoAction(NOVA)).toEqual({
      ok: true,
      mensagem: TEXTOS.recusada,
    });
    const [update, ...outros] = updatesDaConsulta();
    expect(outros).toEqual([]);
    expect(update?.dados).toEqual({
      approval_status: "recusado",
      status: "cancelado_clinica",
      oferecer_vaga_ao_cancelar: false,
    });
    expect(update?.filtros).toEqual([
      ["clinic_id", CLINICA],
      ["id", NOVA],
      ["approval_status", "pendente"],
      ["created_by", "ia"],
      ["is_overbooking", false],
      ["remarcacao_de", ANTIGA],
    ]);
    // A antiga fica como esta (D-29).
    expect(banco.linha("appointment", ANTIGA)).toMatchObject({
      status: "confirmado_paciente",
    });
    expect(
      banco.doTipo("appointment_status_history", "insert")[0]?.dados,
    ).toEqual({
      clinic_id: CLINICA,
      appointment_id: NOVA,
      status: "cancelado_clinica",
      changed_by: "usuario",
      changed_by_user_id: USUARIO,
    });
    expect(trilha()).toEqual([
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "recusou_remarcacao_da_ia",
        entity: "appointment",
        entity_id: NOVA,
      },
    ]);
    expect(banco.rpcs).toEqual([
      {
        nome: "devolver_conversa_da_consulta_recusada",
        args: { p_clinic_id: CLINICA, p_appointment_id: NOVA },
      },
    ]);
    expect(banco.sequencia.indexOf("appointment:update")).toBeLessThan(
      banco.sequencia.indexOf("rpc:devolver_conversa_da_consulta_recusada"),
    );
  });

  it("só diz que a antiga continua marcada quando ela continua", async () => {
    banco.linha("appointment", ANTIGA).status = "cancelado_clinica";
    expect(await recusarRemarcacaoAction(NOVA)).toEqual({
      ok: true,
      mensagem:
        "Remarcação recusada. A consulta de 29/10 às 14:00 já estava cancelada. Avise o paciente pelo Atendimento.",
    });
    banco.tabelas.appointment = [nova(), antiga({ status: "compareceu" })];
    expect(await recusarRemarcacaoAction(NOVA)).toEqual({
      ok: true,
      mensagem: "Remarcação recusada. Avise o paciente pelo Atendimento.",
    });
  });

  it("a conversa que não voltou vira aviso, junto do sucesso, e o log leva só ids e o código", async () => {
    banco.respostasDosRpcs.devolver_conversa_da_consulta_recusada = {
      data: null,
      error: { code: "42501" },
    };
    expect(await recusarRemarcacaoAction(NOVA)).toEqual({
      ok: true,
      mensagem: TEXTOS.recusada,
      aviso:
        "A remarcação foi recusada, mas a conversa não voltou para a equipe. Abra a conversa no Atendimento e avise o paciente.",
    });
    banco.tabelas.appointment = [nova(), antiga()];
    banco.respostasDosRpcs.devolver_conversa_da_consulta_recusada = {
      data: false,
      error: null,
    };
    expect(await recusarRemarcacaoAction(NOVA)).toMatchObject({
      ok: true,
      aviso:
        "A remarcação foi recusada, mas a conversa do paciente não foi encontrada. Avise o paciente pelo Atendimento.",
    });
    const tudo = logs.join("");
    expect(tudo).toContain('"evento":"agenda_conversa_nao_devolvida"');
    expect(tudo).not.toContain("Paciente de Teste");
  });

  it("quem chega depois: já tratada, sem histórico, trilha nem conversa", async () => {
    banco.linha("appointment", NOVA).approval_status = "recusado";
    expect(await recusarRemarcacaoAction(NOVA)).toEqual({
      ok: false,
      code: "ja_tratado",
      error: TEXTOS.jaTratada,
    });
    expect(banco.gravacoes()).toEqual([]);
    expect(banco.rpcs).toEqual([]);
  });
});

describe("os caminhos de antes passam pela remarcação", () => {
  it("Aprovar do encaixe e da consulta da IA: a remarcação aprova pelo caminho dela, sem o aviso", async () => {
    expect(await aprovarEncaixeAction(NOVA)).toEqual({
      ok: true,
      mensagem: TEXTOS.aprovadaSemAviso,
    });
    expect(updatesDaConsulta()[0]?.filtros).toContainEqual([
      "remarcacao_de",
      ANTIGA,
    ]);
    expect(fila).toEqual([]);
    expect(trilha()).toMatchObject([{ action: "aprovou_remarcacao_da_ia" }]);
  });

  it("Recusar: a remarcação recusa pelo caminho dela", async () => {
    expect(await recusarEncaixeAction(NOVA)).toEqual({
      ok: true,
      mensagem: TEXTOS.recusada,
    });
    expect(trilha()).toMatchObject([{ action: "recusou_remarcacao_da_ia" }]);
  });

  it("a leitura da pendência traz a ligação com a antiga", async () => {
    await aprovarEncaixeAction(DA_IA);
    const [leitura] = banco.doTipo("appointment", "select");
    expect(leitura?.colunas).toBe(
      "created_by, is_overbooking, status, remarcacao_de",
    );
    // A consulta da IA sem remarcacao segue como antes.
    expect(trilha()).toMatchObject([{ action: "aprovou_consulta_da_ia" }]);
    expect(updatesDaConsulta()[0]?.filtros).not.toContainEqual([
      "remarcacao_de",
      ANTIGA,
    ]);
  });

  it("cancelar a remarcação pendente pela mudança de situação é recusá-la (a antiga continua)", async () => {
    expect(
      await mudarStatusAction({
        id: NOVA,
        status_atual: "agendado",
        novo_status: "cancelado_paciente",
        canal: null,
        oferecer_vaga: true,
      }),
    ).toEqual({ ok: true, recusada: "remarcacao", mensagem: TEXTOS.recusada });
    const [update] = updatesDaConsulta();
    expect(update?.dados).toEqual({
      approval_status: "recusado",
      status: "cancelado_clinica",
      oferecer_vaga_ao_cancelar: false,
    });
    // O status que a tela viu vai no filtro, como em toda mudanca.
    expect(update?.filtros).toContainEqual(["status", "agendado"]);
    expect(update?.filtros).toContainEqual(["remarcacao_de", ANTIGA]);
    expect(banco.linha("appointment", ANTIGA).status).toBe(
      "confirmado_paciente",
    );
  });
});

// ---------------------------------------------------------------------------
// Mover a antiga com a remarcacao pendente (D-32)
// ---------------------------------------------------------------------------

describe("remarcar a antiga com a remarcação da IA pendente", () => {
  function preparar() {
    // Encaixe: o servidor nao confere a jornada (so o bloqueio), o que
    // deixa o teste sem montar a grade do profissional.
    banco.tabelas.appointment = [
      nova(),
      antiga({
        ends_at: "2026-10-29T17:30:00.000Z",
        service_link_id: "2c2c2c2c-0000-4000-8000-000000000001",
        is_overbooking: true,
        service_link: { procedure_id: "p1", insurance_id: null },
      }),
    ];
    banco.tabelas.professional = [
      { id: PROFISSIONAL, clinic_id: CLINICA, active: true },
    ];
    banco.tabelas.professional_block = [];
    banco.tabelas.professional_schedule = [];
  }

  const ENTRADA = {
    id: ANTIGA,
    starts_at_esperado: INICIO_DA_ANTIGA,
    novo_starts_at: "2026-10-30T17:00:00.000Z",
    novo_professional_id: PROFISSIONAL,
    avisar_paciente: true,
  };

  it("o 23514 remarcacao_pendente do gatilho vira a dica, e nada sai para o paciente", async () => {
    preparar();
    banco.errosNoUpdate.appointment = {
      code: "23514",
      message: "remarcacao_pendente",
      hint: TEXTOS.dicaDaAntiga,
    };
    expect(await remarcarAgendamentoAction(ENTRADA)).toEqual({
      ok: false,
      code: "remarcacao_pendente",
      error: TEXTOS.dicaDaAntiga,
    });
    expect(trilha()).toEqual([]);
    expect(fila).toEqual([]);
    expect(banco.rpcs).toEqual([]);
  });

  it("o outro 23514 continua o da consulta encerrada", async () => {
    preparar();
    banco.errosNoUpdate.appointment = {
      code: "23514",
      message: "consulta_encerrada",
    };
    expect(await remarcarAgendamentoAction(ENTRADA)).toEqual({
      ok: false,
      code: "situacao_final",
      error: "Consulta encerrada não se remarca. Marque uma nova consulta.",
    });
  });
});
