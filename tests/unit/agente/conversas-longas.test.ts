import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const contexto = vi.hoisted(() => ({
  config: null as unknown,
  catalogo: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agente/contexto", async () => {
  const real = await vi.importActual<typeof import("@/lib/agente/contexto")>(
    "@/lib/agente/contexto",
  );
  return {
    carregarConfigPublicada: async () => contexto.config,
    carregarCatalogoDoAgente: async () => contexto.catalogo,
    lerPreparoParaEnvio: real.lerPreparoParaEnvio,
  };
});

import { PASSO_DA_URGENCIA } from "@/lib/agente/laco";
import {
  FRASE_DE_ESCALONAMENTO,
  FRASE_DO_ASSISTENTE_VIRTUAL,
} from "@/lib/domain/conformidade/frase-fixa";

import { ferramenta, final } from "./ag4-conversa";
import {
  busca as buscaDaLimpeza,
  CATALOGO_DA_AG5,
  P_LIMPEZA,
  R_ANA,
  T_E1_ANA_NOITE_SEG_QUA,
  T_E2_ANA_NOITE_SEG_QUA,
} from "./ag5-conversa";
import { codigoDoProcedimento, iso, PROC, PROF } from "./agenda-fixtures";
import {
  catalogoDoCadastro,
  ENDERECO_DA_ALDEOTA,
  ENDERECO_DO_CENTRO,
  UNID,
} from "./cadastro-fixtures";
import {
  ConversaLonga,
  prepararOTeste,
  saidasDoTurno,
  trilhaDoTurno,
  type TurnoDaConversa,
} from "./conversa-longa";

const UM_DIA_MS = 24 * 60 * 60_000;
const CADASTRO = catalogoDoCadastro();
const P_CONSULTA = codigoDoProcedimento(CADASTRO, PROC.consulta);

function busca(extra: Record<string, unknown> = {}) {
  return {
    procedimento: P_CONSULTA,
    profissional: null,
    convenio: null,
    a_partir_de: null,
    periodo: null,
    unidade: null,
    hora: null,
    ...extra,
  };
}

let escrito: string[] = [];
let conversaDoTeste: ConversaLonga | null = null;

beforeEach(() => {
  prepararOTeste();
  escrito = [];
  conversaDoTeste = null;
  const capturar = (linha: string | Uint8Array): boolean => {
    escrito.push(String(linha));
    return true;
  };
  if (!process.env.DEPURAR) {
    vi.spyOn(process.stdout, "write").mockImplementation(capturar);
    vi.spyOn(process.stderr, "write").mockImplementation(capturar);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  conversaDoTeste?.conferirOsLogs(escrito);
});

/** O que a decisao gravada diz (aparece inteiro quando o assert falha). */
function oQueDecidiu(t: TurnoDaConversa) {
  return {
    desfecho: t.decisao?.desfecho ?? null,
    regra: t.decisao?.compliance_rule ?? null,
    motivo: t.decisao?.escalation_reason ?? null,
    falha: t.decisao?.motivo_da_falha ?? null,
    gatilho: t.decisao?.gatilho_entrada ?? null,
    camada: t.decisao?.camada ?? null,
  };
}

/** O turno respondeu com o texto: so ele saiu e a conversa segue na IA. */
function respondeu(t: TurnoDaConversa, texto: string) {
  expect(oQueDecidiu(t)).toEqual({
    desfecho: "respondeu",
    regra: null,
    motivo: null,
    falha: null,
    gatilho: null,
    camada: null,
  });
  expect(t.enviadas).toEqual([texto]);
  expect(t.decisao).toMatchObject({ aprovado: true, compliance_blocked: false });
  expect(t.statusDaConversa).toBe("ia_atendendo");
}

describe("1. preço, convênio, endereço, agenda, troca de horário e confirmação", () => {
  it("cada assunto responde com o fato do turno; a troca solta a reserva antiga; só a última vira consulta", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;

    const preco =
      "A consulta custa R$ 280,00 com o Dr. Bruno Costa e R$ 300,00 com a Dra. Ana Lima, no particular.";
    const t1 = await c.fala({
      texto: "Oi, quanto custa a consulta?",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: P_CONSULTA,
          convenio: null,
        }),
        final(preco),
      ],
    });
    respondeu(t1, `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${preco}`);
    expect(t1.ferramentas).toEqual(["buscar_procedimento"]);
    expect(t1.decisao?.tool_used).toBe("buscar_procedimento");
    expect(t1.estado).toMatchObject({ etapa: "informacao", intencao: null });

    const convenio =
      "Sim, a Consulta com a Dra. Ana Lima é atendida pela Unimed (Nacional).";
    const t2 = await c.fala({
      texto: "Vocês atendem Unimed?",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: P_CONSULTA,
          convenio: "Unimed Nacional",
        }),
        final(convenio),
      ],
    });
    respondeu(t2, convenio);
    expect(t2.estado).toMatchObject({ etapa: "informacao", intencao: null });

    const endereco = `Temos duas unidades: Aldeota, na ${ENDERECO_DA_ALDEOTA}, e Centro, na ${ENDERECO_DO_CENTRO}.`;
    const t3 = await c.fala({
      texto: "Onde fica a clínica?",
      roteiro: [
        ferramenta("consultar_unidades", { unidade: null }),
        final(endereco),
      ],
    });
    respondeu(t3, endereco);
    expect(t3.decisao?.tool_used).toBe("consultar_unidades");

    const estacionamento =
      "Na unidade Aldeota tem estacionamento no subsolo do prédio.";
    const t4 = await c.fala({
      texto: "Tem estacionamento?",
      roteiro: [
        ferramenta("consultar_unidades", { unidade: "u1" }),
        final(estacionamento),
      ],
    });
    respondeu(t4, estacionamento);
    // Quatro respostas sem nenhum passo de agenda: nada reservado.
    expect(c.reservasVivas).toEqual([]);
    expect(c.cenario.banco.chamadasDe("reservar_horario_da_ia")).toEqual([]);

    const oferta =
      "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?";
    const t5 = await c.fala({
      texto: "Quero marcar uma consulta à tarde, no particular",
      roteiro: [
        ferramenta("buscar_horario", busca({ periodo: "tarde" })),
        final(oferta),
      ],
    });
    respondeu(t5, oferta);
    expect(t5.estado).toMatchObject({
      etapa: "oferta",
      intencao: "agendar",
      procedure_id: PROC.consulta,
      particular: true,
    });
    expect(t5.estado.horarios_oferecidos.map((h) => h.codigo)).toEqual([
      "h1",
      "h2",
      "h3",
      "h4",
    ]);

    const reservou =
      "Reservei quarta, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.";
    const t6 = await c.fala({
      texto: "Pode ser quarta às 14h",
      roteiro: [ferramenta("reservar_horario", { horario: "h2" }), final(reservou)],
    });
    respondeu(t6, reservou);
    expect(c.reservasVivas).toEqual([
      expect.objectContaining({ starts_at: iso("2026-10-21", "14:00") }),
    ]);
    const reservaDeQuarta = t6.estado.slot_hold_id;
    expect(reservaDeQuarta).toBe(c.reservasVivas[0]?.id);
    expect(t6.estado.falhas_seguidas).toBe(0);
    expect(c.dados.faltam).toEqual(["nome_completo", "data_nascimento"]);

    // Muda de horario no meio: a busca e a reserva nova; a antiga sai.
    const trocou =
      "Troquei: reservei quinta, 22/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Agora me envie seu nome completo e sua data de nascimento.";
    const t7 = await c.fala({
      texto: "Mudei de ideia, prefiro quinta às 14h",
      roteiro: [
        ferramenta(
          "buscar_horario",
          busca({ a_partir_de: "2026-10-22", hora: "14:00" }),
        ),
        // h5 e o Dr. Bruno no mesmo horario; h6, a Dra. Ana.
        ferramenta("reservar_horario", { horario: "h6" }),
        final(trocou),
      ],
    });
    respondeu(t7, trocou);
    expect(t7.ferramentas).toEqual(["buscar_horario", "reservar_horario"]);
    expect(c.reservasVivas).toEqual([
      expect.objectContaining({ starts_at: iso("2026-10-22", "14:00") }),
    ]);
    expect(t7.estado.slot_hold_id).not.toBe(reservaDeQuarta);
    expect(t7.estado.slot_hold_id).toBe(c.reservasVivas[0]?.id);

    const confirma =
      "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quinta, 22/10 às 14:00, na unidade Centro, no particular?";
    const t8 = await c.fala({
      texto: "Maria da Silva Souza, nascida em 12/03/1985",
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: "Fulano da Silva Souza",
          data_nascimento: "1985-03-12",
          para_o_titular: true,
          campos_mascarados: [],
        }),
        final(confirma),
      ],
    });
    respondeu(t8, confirma);
    expect(t8.estado.etapa).toBe("aguardando_confirmacao");
    expect(c.dados).toMatchObject({
      nome_completo: true,
      data_nascimento: true,
      faltam: [],
    });
    // Ninguem marcou nada ate o "sim".
    expect(c.consultas).toEqual([]);

    const marcou =
      "Pronto! Sua Consulta de quinta, 22/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe. A confirmação chega por aqui.";
    const t9 = await c.fala({
      texto: "Sim, confirmo",
      roteiro: [ferramenta("agendar", {}), final(marcou)],
    });
    respondeu(t9, marcou);
    expect(t9.decisao?.tool_used).toBe("agendar");
    expect(c.consultas).toEqual([
      expect.objectContaining({
        starts_at: iso("2026-10-22", "14:00"),
        unit_id: UNID.centro,
        approval_status: "pendente",
        created_by: "ia",
      }),
    ]);
    expect(t9.estado).toMatchObject({
      etapa: "pos_marcacao",
      desfecho: "marcou",
      appointment_id: c.consultas[0]?.id,
      slot_hold_id: null,
      horarios_oferecidos: [],
      falhas_seguidas: 0,
    });
    expect(c.reservasVivas).toEqual([]);

    // Depois de marcar: o que levar e o agradecimento, sem mexer na consulta.
    const levar =
      "Para a Consulta, leve um documento com foto e chegue 15 minutos antes.";
    const t10 = await c.fala({
      texto: "O que eu preciso levar?",
      roteiro: [
        ferramenta("consultar_requisitos", {
          procedimento: P_CONSULTA,
          convenio: null,
        }),
        final(levar),
      ],
    });
    respondeu(t10, levar);
    expect(t10.estado).toMatchObject({
      etapa: "pos_marcacao",
      appointment_id: c.consultas[0]?.id,
    });

    const tchau = "Por nada! Qualquer coisa, é só chamar por aqui.";
    const t11 = await c.fala({
      texto: "Obrigada!",
      roteiro: [final(tchau)],
    });
    respondeu(t11, tchau);

    // A conversa inteira: uma mensagem por fala, na ordem; o aviso uma vez so;
    // uma decisao aprovada por resposta; uma consulta.
    expect(c.recebidasPeloPaciente).toEqual([
      `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${preco}`,
      convenio,
      endereco,
      estacionamento,
      oferta,
      reservou,
      trocou,
      confirma,
      marcou,
      levar,
      tchau,
    ]);
    expect(c.decisoes.map((d) => d.desfecho)).toEqual(
      Array.from({ length: 11 }, () => "respondeu"),
    );
    expect(c.consultas).toHaveLength(1);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(c.conversa.status).toBe("ia_atendendo");
  });
});

/** Tudo o que a conversa fez depois da passagem: nada. */
async function nadaMaisSai(c: ConversaLonga, falas: readonly string[]) {
  const recebidas = c.recebidasPeloPaciente.length;
  const decisoes = c.decisoes.length;
  const status = c.conversa.status;
  for (const texto of falas) {
    // Sem roteiro: o LLM falso que fosse chamado devolveria nada, e o
    // conferirOTurno do ajudante ja falha em qualquer chamada.
    const t = await c.fala({ texto });
    expect(t.resultado).toEqual({ ok: true });
    expect(t.chamadasAoModelo).toBe(0);
    expect(t.enviadas).toEqual([]);
    expect(t.decisao).toBeUndefined();
    expect(t.statusDaConversa).toBe(status);
  }
  expect(c.recebidasPeloPaciente).toHaveLength(recebidas);
  expect(c.decisoes).toHaveLength(decisoes);
}

const FRASE_MARCADA_SEXTA =
  "Pronto! Sua Consulta de sexta, 30/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe. A confirmação chega por aqui.";

/** As quatro falas da marcação da sexta, 30/10 às 14:00 (longe do prazo). */
async function marcarASexta(c: ConversaLonga) {
  const oferta =
    "Tenho sexta, 30/10 às 14:00 ou às 15:00 com a Dra. Ana Lima, na unidade Centro. Qual prefere?";
  const t1 = await c.fala({
    texto: "Quero marcar uma consulta para a sexta da semana que vem, à tarde",
    roteiro: [
      ferramenta(
        "buscar_horario",
        busca({ a_partir_de: "2026-10-30", periodo: "tarde" }),
      ),
      final(oferta),
    ],
  });
  respondeu(t1, `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${oferta}`);
  const reservou =
    "Reservei sexta, 30/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.";
  const t2 = await c.fala({
    texto: "Às 14h",
    roteiro: [ferramenta("reservar_horario", { horario: "h1" }), final(reservou)],
  });
  respondeu(t2, reservou);
  const confirma =
    "Obrigada! Confirma a Consulta com a Dra. Ana Lima na sexta, 30/10 às 14:00, na unidade Centro, no particular?";
  const t3 = await c.fala({
    texto: "Maria da Silva Souza, nascida em 12/03/1985",
    roteiro: [
      ferramenta("registrar_dados_do_paciente", {
        nome_completo: "Fulano da Silva Souza",
        data_nascimento: "1985-03-12",
        para_o_titular: true,
        campos_mascarados: [],
      }),
      final(confirma),
    ],
  });
  respondeu(t3, confirma);
  expect(t3.estado.etapa).toBe("aguardando_confirmacao");
  const t4 = await c.fala({
    texto: "Confirmo",
    roteiro: [ferramenta("agendar", {}), final(FRASE_MARCADA_SEXTA)],
  });
  respondeu(t4, FRASE_MARCADA_SEXTA);
  expect(t4.estado).toMatchObject({
    etapa: "pos_marcacao",
    desfecho: "marcou",
    appointment_id: c.consultas[0]?.id,
  });
  expect(c.consultas).toHaveLength(1);
  return c.consultas[0]!;
}

/** O pedido de remarcar a consulta de sexta para terça, 03/11 às 08:00 (T3). */
async function pedirARemarcacaoParaTerca(c: ConversaLonga) {
  const oferta =
    "Tenho terça, 03/11 às 08:00, na unidade Aldeota. Pode ser?";
  const t1 = await c.fala(
    {
      texto: "Preciso remarcar minha consulta, pode ser na terça de manhã?",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("buscar_horario_para_remarcar", {
          consulta: "c1",
          a_partir_de: "2026-11-03",
          periodo: "manha",
          hora: null,
          unidade: null,
        }),
        final(oferta),
      ],
    },
    3 * UM_DIA_MS,
  );
  respondeu(t1, oferta);
  expect(t1.estado).toMatchObject({
    etapa: "oferta",
    intencao: "remarcar",
    pedido_pendente: "remarcar",
  });
  const t2 = await c.fala({
    texto: "Às 8",
    roteiro: [ferramenta("reservar_horario", { horario: "h1" })],
  });
  respondeu(
    t2,
    "Reservei terça, 03/11 às 08:00, na unidade Aldeota, por 10 minutos. Confirma a remarcação da sua consulta de sexta, 30/10 às 14:00 para terça, 03/11 às 08:00?",
  );
  expect(t2.estado.etapa).toBe("aguardando_confirmacao");
  expect(t2.chamadasAoModelo).toBe(1);
  return { t1, t2 };
}

describe("2. marca, dias depois remarca, depois cancela: nunca duas consultas vivas", () => {
  it("o pedido de outra consulta do mesmo procedimento é recusado; a remarcação aprovada troca uma pela outra; o cancelamento deixa zero", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const consulta = await marcarASexta(c);

    // No mesmo dia, outra consulta do mesmo procedimento: o banco recusa.
    const jaTem =
      "Você já tem Consulta marcada na sexta, 30/10 às 14:00. Se quiser, posso ajudar a remarcar ou cancelar.";
    const t5 = await c.fala({
      texto: "Quero marcar mais uma consulta na segunda de tarde",
      roteiro: [
        ferramenta(
          "buscar_horario",
          busca({ a_partir_de: "2026-11-02", periodo: "tarde" }),
        ),
        ferramenta("reservar_horario", { horario: "h1" }),
        final(jaTem),
      ],
    });
    respondeu(t5, jaTem);
    expect(saidasDoTurno(t5).at(-1)).toEqual({
      resultado: "ja_tem_consulta",
      dia: "sexta, 30/10",
      hora: "14:00",
    });
    expect(c.reservasVivas).toEqual([]);
    expect(c.consultas).toHaveLength(1);

    // A equipe aprova; tres dias depois a pessoa remarca.
    c.equipeAprova(consulta);
    await pedirARemarcacaoParaTerca(c);
    expect(c.consultas).toHaveLength(1);

    const t8 = await c.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    respondeu(
      t8,
      "Pronto, pedi a remarcação para terça, 03/11 às 08:00. Até a equipe aprovar, sua consulta de sexta, 30/10 às 14:00 continua marcada. A confirmação chega por aqui.",
    );
    const nova = c.consultas.find((a) => a.remarcacao_de === consulta.id);
    expect(nova).toMatchObject({
      starts_at: iso("2026-11-03", "08:00"),
      approval_status: "pendente",
      created_by: "ia",
    });
    // A antiga continua de pe ate a aprovacao: a de valer e uma so.
    expect(consulta.status).toBe("agendado");
    expect(c.consultasVivas).toHaveLength(2);
    expect(t8.estado).toMatchObject({
      etapa: "pos_marcacao",
      intencao: "remarcar",
      pedido_pendente: null,
      appointment_id: nova?.id,
      slot_hold_id: null,
      desfecho: "remarcou",
    });

    const pendencia =
      "Sua remarcação para terça, 03/11 às 08:00 está pendente da aprovação da equipe, e a consulta de sexta, 30/10 às 14:00 continua marcada até lá.";
    respondeu(
      await c.fala({
        texto: "Então está certo?",
        roteiro: [final(pendencia)],
      }),
      pendencia,
    );

    // A equipe aprova a remarcacao: sobra uma de pe.
    c.equipeAprova(nova!);
    expect(c.consultasVivas).toEqual([nova]);

    // Dois dias depois, a pessoa cancela: a lista so traz a de pe.
    const t10 = await c.fala(
      {
        texto: "Não vou poder ir, quero cancelar minha consulta",
        roteiro: [
          ferramenta("consultar_minhas_consultas", {}),
          ferramenta("pedir_cancelamento", { consulta: "c1" }),
        ],
      },
      2 * UM_DIA_MS,
    );
    respondeu(
      t10,
      "Confirma o cancelamento da sua consulta de terça, 03/11 às 08:00?",
    );
    expect(saidasDoTurno(t10)[0]).toMatchObject({
      resultado: "consultas",
      consultas: [{ codigo: "c1", dia: "terça, 03/11", hora: "08:00" }],
    });
    expect(t10.estado).toMatchObject({
      etapa: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: nova?.id,
    });
    expect(nova?.status).toBe("agendado");

    const t11 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    respondeu(
      t11,
      "Tudo bem, sua consulta de 03/11 às 08:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.",
    );
    expect(nova?.status).toBe("cancelado_paciente");
    expect(c.consultasVivas).toEqual([]);
    expect(t11.decisao?.tool_used).toBe("cancelar_consulta");
    expect(c.cenario.banco.linhas("appointment_status_history")).toEqual([
      expect.objectContaining({
        appointment_id: nova?.id,
        changed_by: "ia",
        ia_job_id: t11.job,
      }),
    ]);
    expect(t11.estado).toMatchObject({
      etapa: "informacao",
      intencao: "cancelar",
      pedido_pendente: null,
      desfecho: "cancelou",
      falhas_seguidas: 0,
    });

    const cancelada = "Sim, sua consulta de terça, 03/11 às 08:00 foi cancelada.";
    respondeu(
      await c.fala({
        texto: "Foi cancelada mesmo?",
        roteiro: [final(cancelada)],
      }),
      cancelada,
    );
    // So o horario novo chegou a ser marcado e so uma cancelada pela IA.
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(2);
  });

  it("cancelar com a remarcação pendente fica com a equipe: as duas consultas continuam como estavam", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const consulta = await marcarASexta(c);
    c.equipeAprova(consulta);
    await pedirARemarcacaoParaTerca(c);
    await c.fala({ texto: "Confirmo", roteiro: [ferramenta("agendar", {})] });
    const nova = c.consultas.find((a) => a.remarcacao_de === consulta.id);

    const t = await c.fala({
      texto: "Mudei de ideia, quero cancelar a consulta",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("pedir_cancelamento", { consulta: "c1" }),
      ],
    });
    expect(oQueDecidiu(t)).toMatchObject({
      desfecho: "escalou",
      motivo: "pedido_de_agenda",
    });
    expect(t.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(t.statusDaConversa).toBe("aguardando_humano");
    expect(consulta.status).toBe("agendado");
    expect(nova?.status).toBe("agendado");
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(c.notasInternas.at(-1)).toContain("Resumo do assistente");

    await nadaMaisSai(c, ["Sim", "Pode cancelar", "Alguém aí?"]);
    expect(consulta.status).toBe("agendado");
    expect(nova?.status).toBe("agendado");
  });
});

describe("3. sem horário bom: a lista de espera e depois a marcação do mesmo procedimento", () => {
  it("entra uma vez só; pedir de novo é ja_na_lista; marcar deixa uma consulta; repetir a marcação é recusado", async () => {
    const c = new ConversaLonga(contexto, { catalogo: CATALOGO_DA_AG5 });
    conversaDoTeste = c;

    const preco = "A Limpeza de pele custa R$ 120,00 no particular, com a Dra. Ana Lima.";
    const t1 = await c.fala({
      texto: "Quanto custa a limpeza de pele?",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: P_LIMPEZA,
          convenio: null,
        }),
        final(preco),
      ],
    });
    respondeu(t1, `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${preco}`);

    const semNoite =
      "Não tenho horário à noite com a Dra. Ana Lima. Posso procurar de manhã ou à tarde, ou colocar você na lista de espera para à noite. O que prefere?";
    const t2 = await c.fala({
      texto: "Queria com a Dra. Ana, só à noite.",
      roteiro: [
        ferramenta(
          "buscar_horario",
          buscaDaLimpeza({ profissional: R_ANA, periodo: "noite" }),
        ),
        final(semNoite),
      ],
    });
    respondeu(t2, semNoite);
    expect(saidasDoTurno(t2)[0]).toMatchObject({ resultado: "sem_horario" });
    expect(t2.estado).toMatchObject({
      procedure_id: PROC.limpeza,
      professional_id: PROF.ana,
      particular: true,
    });

    const t3 = await c.fala({
      texto: "Lista de espera. Segunda ou quarta.",
      roteiro: [
        ferramenta("pedir_lista_de_espera", {
          periodos: ["noite"],
          dias: ["segunda", "quarta"],
        }),
      ],
    });
    respondeu(t3, T_E1_ANA_NOITE_SEG_QUA);
    expect(c.cenario.fila).toEqual([]);
    expect(c.cenario.pedidos).toHaveLength(1);

    const t4 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    respondeu(t4, T_E2_ANA_NOITE_SEG_QUA);
    expect(c.cenario.fila).toEqual([
      expect.objectContaining({
        active: true,
        origem: "ia",
        ia_job_id: t4.job,
        procedure_id: PROC.limpeza,
        preferred_shifts: ["noite"],
        preferred_weekdays: [1, 3],
      }),
    ]);
    expect(t4.decisao?.tool_used).toBe("entrar_na_lista_de_espera");
    expect(c.eventos).toContain(
      "A IA colocou o paciente na lista de espera: Limpeza de pele, Dra. Ana Lima, particular. Preferência: noite; segunda e quarta.",
    );

    // O turno seguinte le a entrada: dizer que esta na lista vale.
    const naLista =
      "Sim, você está na lista de espera para Limpeza de pele, com Dra. Ana Lima, à noite, às segundas e às quartas.";
    respondeu(
      await c.fala({ texto: "Estou mesmo na lista?", roteiro: [final(naLista)] }),
      naLista,
    );

    // Pedir de novo: uma entrada so.
    const jaNaLista =
      "Você já está na lista de espera para a Limpeza de pele com a Dra. Ana Lima, à noite, às segundas e às quartas.";
    const t6 = await c.fala({
      texto: "Me coloca também para as quintas",
      roteiro: [
        ferramenta("pedir_lista_de_espera", {
          periodos: ["noite"],
          dias: ["quinta"],
        }),
        final(jaNaLista),
      ],
    });
    respondeu(t6, jaNaLista);
    expect(saidasDoTurno(t6)[0]).toMatchObject({ resultado: "ja_na_lista" });
    expect(c.cenario.fila).toHaveLength(1);

    // Desiste de esperar: marca de manha, o mesmo procedimento.
    const oferta =
      "Tenho quarta, 21/10 às 08:00 ou quinta, 22/10 às 08:00 com a Dra. Ana Lima. Qual prefere?";
    const t7 = await c.fala({
      texto: "Melhor marcar de manhã mesmo",
      roteiro: [
        ferramenta(
          "buscar_horario",
          buscaDaLimpeza({ profissional: R_ANA, periodo: "manha" }),
        ),
        final(oferta),
      ],
    });
    respondeu(t7, oferta);
    expect(t7.estado.etapa).toBe("oferta");

    const reservou =
      "Reservei quinta, 22/10 às 08:00 com a Dra. Ana Lima por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.";
    respondeu(
      await c.fala({
        texto: "Quinta às 8",
        roteiro: [ferramenta("reservar_horario", { horario: "h2" }), final(reservou)],
      }),
      reservou,
    );

    const confirma =
      "Obrigada! Confirma a Limpeza de pele com a Dra. Ana Lima na quinta, 22/10 às 08:00, no particular?";
    const t9 = await c.fala({
      texto: "Maria da Silva Souza, 12/03/1985",
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: "Fulano da Silva Souza",
          data_nascimento: "1985-03-12",
          para_o_titular: true,
          campos_mascarados: [],
        }),
        final(confirma),
      ],
    });
    respondeu(t9, confirma);
    expect(t9.estado.etapa).toBe("aguardando_confirmacao");

    const marcou =
      "Pronto! Sua Limpeza de pele de quinta, 22/10 às 08:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.";
    const t10 = await c.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {}), final(marcou)],
    });
    respondeu(t10, marcou);
    expect(c.consultas).toHaveLength(1);
    // A entrada fica na fila (a reoferta le o predicado e nao oferece a quem
    // ja tem a consulta do mesmo procedimento): nunca duas entradas.
    expect(c.cenario.fila).toEqual([
      expect.objectContaining({ active: true, ia_job_id: t4.job }),
    ]);

    // Com a consulta marcada, outra do mesmo procedimento: recusada.
    const jaTem =
      "Você já tem Limpeza de pele marcada na quinta, 22/10 às 08:00.";
    const t11 = await c.fala({
      texto: "Queria marcar outra limpeza de pele na sexta de manhã",
      roteiro: [
        ferramenta(
          "buscar_horario",
          buscaDaLimpeza({ a_partir_de: "2026-10-23", periodo: "manha" }),
        ),
        ferramenta("reservar_horario", { horario: "h1" }),
        final(jaTem),
      ],
    });
    respondeu(t11, jaTem);
    expect(saidasDoTurno(t11).at(-1)).toEqual({
      resultado: "ja_tem_consulta",
      dia: "quinta, 22/10",
      hora: "08:00",
    });
    expect(c.consultas).toHaveLength(1);
    expect(c.reservasVivas).toEqual([]);
  });

  it("com a consulta já marcada, pedir a lista do mesmo procedimento é recusado (D-41): nenhum pedido, nenhuma entrada", async () => {
    const c = new ConversaLonga(contexto, { catalogo: CATALOGO_DA_AG5 });
    conversaDoTeste = c;
    const oferta =
      "Tenho quarta, 21/10 às 08:00 ou quinta, 22/10 às 08:00 com a Dra. Ana Lima. Qual prefere?";
    respondeu(
      await c.fala({
        texto: "Quero marcar limpeza de pele com a Dra. Ana de manhã",
        roteiro: [
          ferramenta(
            "buscar_horario",
            buscaDaLimpeza({ profissional: R_ANA, periodo: "manha" }),
          ),
          final(oferta),
        ],
      }),
      `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${oferta}`,
    );
    const reservou =
      "Reservei quarta, 21/10 às 08:00 com a Dra. Ana Lima por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.";
    respondeu(
      await c.fala({
        texto: "Quarta às 8",
        roteiro: [ferramenta("reservar_horario", { horario: "h1" }), final(reservou)],
      }),
      reservou,
    );
    const confirma =
      "Confirma a Limpeza de pele com a Dra. Ana Lima na quarta, 21/10 às 08:00, no particular?";
    respondeu(
      await c.fala({
        texto: "Maria da Silva Souza, 12/03/1985",
        roteiro: [
          ferramenta("registrar_dados_do_paciente", {
            nome_completo: "Fulano da Silva Souza",
            data_nascimento: "1985-03-12",
            para_o_titular: true,
            campos_mascarados: [],
          }),
          final(confirma),
        ],
      }),
      confirma,
    );
    const marcou =
      "Pronto! Sua Limpeza de pele de quarta, 21/10 às 08:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.";
    respondeu(
      await c.fala({
        texto: "Sim",
        roteiro: [ferramenta("agendar", {}), final(marcou)],
      }),
      marcou,
    );
    const semNoite =
      "Não tenho horário à noite com a Dra. Ana Lima. Se preferir outro período, posso procurar.";
    respondeu(
      await c.fala({
        texto: "Tem à noite, se abrir vaga?",
        roteiro: [
          ferramenta(
            "buscar_horario",
            buscaDaLimpeza({ profissional: R_ANA, periodo: "noite" }),
          ),
          final(semNoite),
        ],
      }),
      semNoite,
    );
    const jaTem =
      "Você já tem Limpeza de pele marcada na quarta, 21/10 às 08:00, então não precisa da lista de espera.";
    const t6 = await c.fala({
      texto: "Então me coloca na lista de espera para a noite",
      roteiro: [
        ferramenta("pedir_lista_de_espera", { periodos: ["noite"], dias: [] }),
        final(jaTem),
      ],
    });
    respondeu(t6, jaTem);
    expect(saidasDoTurno(t6)[0]).toMatchObject({ resultado: "ja_tem_consulta" });
    expect(c.cenario.pedidos).toEqual([]);
    expect(c.cenario.fila).toEqual([]);

    // Um "sim" solto depois da recusa nao entra em lista nenhuma.
    const semPergunta = "Tudo certo então. Posso ajudar em mais alguma coisa?";
    const t7 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {}), final(semPergunta)],
    });
    respondeu(t7, semPergunta);
    expect(saidasDoTurno(t7)[0]).toEqual({ resultado: "sem_pergunta_de_espera" });
    expect(c.cenario.fila).toEqual([]);
    expect(t7.estado.falhas_seguidas).toBe(1);

    const tchau = "Por nada! Qualquer coisa, é só chamar por aqui.";
    respondeu(await c.fala({ texto: "Obrigada", roteiro: [final(tchau)] }), tchau);
    expect(c.consultas).toHaveLength(1);
  });
});

describe("4. o sinal de emergência no meio da marcação", () => {
  /** Preço, busca, reserva e a pergunta "Confirma": quatro falas. */
  async function ateAPerguntaConfirma(c: ConversaLonga) {
    const preco =
      "A consulta custa R$ 280,00 com o Dr. Bruno Costa e R$ 300,00 com a Dra. Ana Lima, no particular.";
    await c.fala({
      texto: "Oi, quanto custa a consulta?",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: P_CONSULTA,
          convenio: null,
        }),
        final(preco),
      ],
    });
    const oferta =
      "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?";
    respondeu(
      await c.fala({
        texto: "Quero marcar à tarde",
        roteiro: [
          ferramenta("buscar_horario", busca({ periodo: "tarde" })),
          final(oferta),
        ],
      }),
      oferta,
    );
    const reservou =
      "Reservei quarta, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.";
    respondeu(
      await c.fala({
        texto: "Quarta às 14h",
        roteiro: [ferramenta("reservar_horario", { horario: "h2" }), final(reservou)],
      }),
      reservou,
    );
    const confirma =
      "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?";
    const t4 = await c.fala({
      texto: "Maria da Silva Souza, nascida em 12/03/1985",
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: "Fulano da Silva Souza",
          data_nascimento: "1985-03-12",
          para_o_titular: true,
          campos_mascarados: [],
        }),
        final(confirma),
      ],
    });
    respondeu(t4, confirma);
    expect(t4.estado.etapa).toBe("aguardando_confirmacao");
    expect(c.reservasVivas).toHaveLength(1);
  }

  /** A passagem por urgência: sem modelo, a marca e a frase de sempre. */
  function passouPorUrgencia(c: ConversaLonga, t: TurnoDaConversa) {
    expect(oQueDecidiu(t)).toEqual({
      desfecho: "escalou",
      regra: null,
      motivo: "urgencia",
      falha: null,
      gatilho: "urgencia",
      camada: null,
    });
    expect(t.chamadasAoModelo).toBe(0);
    expect(t.doLaco).toBeNull();
    expect(t.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(t.statusDaConversa).toBe("aguardando_humano");
    expect(c.conversa.assignee_user_id).toBeNull();
    expect(trilhaDoTurno(t)).toContain(PASSO_DA_URGENCIA);
    expect(c.passagens.at(-1)).toEqual({
      passou: true,
      codigo: "passou",
      urgente: true,
    });
    expect(c.executor.linhas("conversa_urgente")).toEqual([
      expect.objectContaining({ job_id: t.job, encerrada_em: null }),
    ]);
    // A urgencia nunca atribui.
    expect(c.executor.chamadasDe("atribuir_conversa_passada_pela_ia")).toEqual([]);
    expect(t.decisao).toMatchObject({
      aprovado: false,
      texto_sha256: null,
      tokens_entrada: 0,
    });
  }

  it("com o 'Confirma' no ar: passa como urgente e nenhuma mensagem nova chega ao modelo, nem o 'sim'", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await ateAPerguntaConfirma(c);

    const t5 = await c.fala({
      texto: "Espera, estou com dor no peito e falta de ar",
    });
    passouPorUrgencia(c, t5);

    await nadaMaisSai(c, [
      "Sim, confirmo",
      "alô?",
      "tem alguém aí?",
      "Quanto custa a consulta?",
      "Quero cancelar tudo",
    ]);
    // O "sim" depois da urgencia nao marcou nada, e ninguem foi chamado.
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(c.consultas).toEqual([]);
    expect(c.conversa.status).toBe("aguardando_humano");
    expect(c.recebidasPeloPaciente.at(-1)).toBe(FRASE_DE_ESCALONAMENTO);
    expect(
      c.recebidasPeloPaciente.filter((m) => m === FRASE_DE_ESCALONAMENTO),
    ).toHaveLength(1);
  });

  it("o sinal partido numa rajada ('to com dor' e 'no peito') também passa como urgente", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await ateAPerguntaConfirma(c);
    const t5 = await c.rajada(["to com dor", "no peito"], {});
    passouPorUrgencia(c, t5);
    await nadaMaisSai(c, ["Sim", "Confirmo", "oi?", "por favor"]);
    expect(c.consultas).toEqual([]);
  });

  it("depois de marcar: a consulta fica como está, e o pedido de cancelar depois da passagem não chega a lugar nenhum", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const consulta = await marcarASexta(c);
    const t5 = await c.fala({ texto: "to com falta de ar, o que eu faço" });
    passouPorUrgencia(c, t5);
    await nadaMaisSai(c, [
      "Preciso cancelar minha consulta",
      "Sim",
      "Quero remarcar",
      "Me responde",
    ]);
    expect(consulta.status).toBe("agendado");
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
  });
});
