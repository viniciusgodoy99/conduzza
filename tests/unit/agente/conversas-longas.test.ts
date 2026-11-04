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

import { PASSO_DO_PREPARO_FORA_DE_VIGOR } from "@/lib/agente/ferramentas/enviar-preparo";
import { PASSO_DA_URGENCIA } from "@/lib/agente/laco";
import { PREFIXO_DO_AUDIO } from "@/lib/agente/midia";
import { sha256DoTexto } from "@/lib/domain/conformidade/filtro";
import {
  FRASE_DE_ESCALONAMENTO,
  FRASE_DO_ASSISTENTE_VIRTUAL,
  FRASE_FORA_DO_ASSUNTO,
} from "@/lib/domain/conformidade/frase-fixa";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import {
  FRASE_DO_PREPARO_DEPOIS_DE_MARCAR,
  mensagemDoPreparo,
  substitutoDaMensagemDoPreparo,
} from "@/lib/domain/preparo";

import {
  FRASE_DO_PREPARO_SO_DO_TRECHO,
  RT_DE_TESTE,
  TEXTO_DO_PREPARO_DE_TESTE,
} from "../../fixtures/ia/conformidade/casos";

import { C1, consultasDoContato, ferramenta, final } from "./ag4-conversa";
import {
  busca as buscaDaLimpeza,
  CATALOGO_DA_AG5,
  P_LIMPEZA,
  R_ANA,
  T_E1_ANA_NOITE_SEG_QUA,
  T_E2_ANA_NOITE_SEG_QUA,
} from "./ag5-conversa";
import {
  codigoDoProcedimento,
  CONV,
  iso,
  PROC,
  PROF,
  VINC,
} from "./agenda-fixtures";
import {
  catalogoDoCadastro,
  ENDERECO_DA_ALDEOTA,
  ENDERECO_DO_CENTRO,
  UNID,
} from "./cadastro-fixtures";
import {
  comPreparoEmVigor,
  configPublicada,
  ConversaLonga,
  prepararOTeste,
  saidasDoTurno,
  trilhaDoTurno,
  type FalaDaConversa,
  type TurnoDaConversa,
} from "./conversa-longa";

// Cada conversa roda dezenas de turnos inteiros: com a maquina ocupada, os 5 s
// padrao viram falso alarme.
vi.setConfig({ testTimeout: 60_000 });

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
  // O que esta suite promete: conversas longas, em turnos separados.
  expect(conversaDoTeste?.turnos.length ?? 0).toBeGreaterThanOrEqual(8);
  // O aviso de assistente virtual sai uma vez so, em toda a conversa.
  expect(
    conversaDoTeste?.recebidasPeloPaciente.filter((m) =>
      m.includes(FRASE_DO_ASSISTENTE_VIRTUAL),
    ).length ?? 0,
  ).toBeLessThanOrEqual(1);
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
async function marcarASexta(
  c: ConversaLonga,
  abertura = `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n`,
) {
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
  respondeu(t1, `${abertura}${oferta}`);
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

  it("a emergência que chega no meio do turno do 'sim': nada é marcado, nada sai, e o job seguinte passa como urgente", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await ateAPerguntaConfirma(c);
    const t5 = await c.fala({
      texto: "Sim, confirmo",
      roteiro: [ferramenta("agendar", {})],
      durante: () => {
        c.escreve("to com dor no peito");
      },
    });
    expect(t5.enviadas).toEqual([]);
    expect(oQueDecidiu(t5)).toMatchObject({
      desfecho: "falhou",
      falha: "sem_mensagem",
      motivo: null,
    });
    expect(t5.statusDaConversa).toBe("ia_atendendo");
    expect(c.consultas).toEqual([]);
    expect(c.temJobPendente).toBe(true);

    const t6 = await c.rodarOJobPendente({});
    passouPorUrgencia(c, t6);
    expect(c.consultas).toEqual([]);
    await nadaMaisSai(c, ["Sim", "alô?"]);
    expect(c.temJobPendente).toBe(false);
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

/**
 * Seis falas de uma conversa em andamento: preço, endereço, a busca, a reserva
 * de quarta às 14h, o nome e o estacionamento. Falta só o nascimento.
 */
async function conversaEmAndamento(c: ConversaLonga) {
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
  const endereco = `A unidade Aldeota fica na ${ENDERECO_DA_ALDEOTA}.`;
  respondeu(
    await c.fala({
      texto: "Onde fica a clínica?",
      roteiro: [ferramenta("consultar_unidades", { unidade: "u1" }), final(endereco)],
    }),
    endereco,
  );
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
  const falta = "Obrigada! Agora só falta sua data de nascimento.";
  respondeu(
    await c.fala({
      texto: "Meu nome é Maria da Silva Souza",
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: "Fulano da Silva Souza",
          data_nascimento: null,
          para_o_titular: true,
          campos_mascarados: [],
        }),
        final(falta),
      ],
    }),
    falta,
  );
  const estacionamento =
    "Na unidade Aldeota tem estacionamento no subsolo do prédio.";
  respondeu(
    await c.fala({
      texto: "Tem estacionamento?",
      roteiro: [
        ferramenta("consultar_unidades", { unidade: "u1" }),
        final(estacionamento),
      ],
    }),
    estacionamento,
  );
  expect(c.dados).toMatchObject({
    nome_completo: true,
    data_nascimento: false,
    faltam: ["data_nascimento"],
  });
  expect(c.reservasVivas).toHaveLength(1);
}

/**
 * Sete falas sem marcar nada (a conversa de sempre, mais o nascimento): a
 * reserva viva, a pergunta "Confirma" no ar.
 */
async function comAPerguntaConfirmaNoAr(c: ConversaLonga) {
  await conversaEmAndamento(c);
  const confirma =
    "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?";
  const t = await c.fala({
    texto: "Nasci em 12/03/1985",
    roteiro: [
      ferramenta("registrar_dados_do_paciente", {
        nome_completo: null,
        data_nascimento: "1985-03-12",
        para_o_titular: true,
        campos_mascarados: [],
      }),
      final(confirma),
    ],
  });
  respondeu(t, confirma);
  expect(t.estado.etapa).toBe("aguardando_confirmacao");
}

const ACOMPANHA_ALTA = { categoria: "orientacao_clinica", gravidade: "alta" } as const;
const USO_DO_FALSO = {
  tokensEntrada: 100,
  tokensSaida: 10,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
};

describe("5. o pedido clínico no meio da conversa", () => {
  type CasoClinico = {
    nome: string;
    fala: FalaDaConversa;
    esperado: Partial<ReturnType<typeof oQueDecidiu>>;
    /** O texto do modelo que nunca pode chegar ao paciente. */
    doModelo?: string;
    chamadas: number;
  };
  const casos: CasoClinico[] = [
    {
      nome: "'é normal doer?': o portão, sem modelo",
      fala: { texto: "É normal doer depois da consulta?" },
      esperado: { desfecho: "escalou", motivo: "sintoma", gatilho: "sintoma" },
      chamadas: 0,
    },
    {
      nome: "'posso tomar remédio?': o portão, sem modelo",
      fala: { texto: "Posso tomar remédio antes da consulta?" },
      esperado: {
        desfecho: "escalou",
        motivo: "assunto_clinico",
        gatilho: "assunto_clinico",
      },
      chamadas: 0,
    },
    {
      nome: "a paráfrase que o portão não pega: o classificador, sem o agente",
      fala: {
        texto: "Isso resolve meu problema?",
        classificacao: {
          tipo: "classificacao",
          classificacao: { gatilhos: ["assunto_clinico"], confianca: "alta" },
          modelo: "gpt-6-luna",
          uso: USO_DO_FALSO,
        },
      },
      esperado: {
        desfecho: "escalou",
        motivo: "assunto_clinico",
        gatilho: "assunto_clinico",
      },
      chamadas: 0,
    },
    {
      nome: "o classificador fora do ar: falha fechada, sem o agente",
      fala: {
        texto: "E depois da consulta, como fica?",
        classificacao: {
          tipo: "falha",
          motivo: "timeout",
          modelo: null,
          uso: null,
          httpStatus: null,
        },
      },
      esperado: {
        desfecho: "falhou",
        motivo: "falha_tecnica",
        falha: "timeout",
      },
      chamadas: 0,
    },
    {
      nome: "o modelo que escreve orientação clínica: a regra barra",
      fala: {
        texto: "E depois da consulta, como fica?",
        roteiro: [
          final("É normal doer um pouco. Pode tomar dipirona 500 mg de 6 em 6 horas."),
        ],
      },
      doModelo:
        "É normal doer um pouco. Pode tomar dipirona 500 mg de 6 em 6 horas.",
      esperado: {
        desfecho: "bloqueou",
        motivo: "conformidade",
        camada: "regra",
      },
      chamadas: 1,
    },
    {
      nome: "a paráfrase que a regra não pega: o verificador por modelo barra",
      fala: {
        texto: "E depois da consulta, como fica?",
        roteiro: [final("Fico à disposição para o que precisar.")],
        verificador: async () => ({
          tipo: "veredicto",
          veredicto: {
            aprovado: false,
            violacoes: [ACOMPANHA_ALTA],
            confianca: "alta",
          },
          modelo: "gpt-6-luna",
          uso: USO_DO_FALSO,
        }),
      },
      doModelo: "Fico à disposição para o que precisar.",
      esperado: {
        desfecho: "bloqueou",
        motivo: "conformidade",
        regra: "orientacao_clinica",
        camada: "modelo",
      },
      chamadas: 1,
    },
    {
      nome: "o verificador fora do ar: falha fechada",
      fala: {
        texto: "E depois da consulta, como fica?",
        roteiro: [final("Posso ajudar com a sua marcação.")],
        verificador: async () => ({
          tipo: "falha",
          motivo: "timeout",
          modelo: null,
          uso: null,
          httpStatus: null,
        }),
      },
      doModelo: "Posso ajudar com a sua marcação.",
      esperado: {
        desfecho: "bloqueou",
        motivo: "conformidade",
        regra: "falha_verificador",
        camada: "falha",
        falha: "timeout",
      },
      chamadas: 1,
    },
    {
      nome: "o modelo que passa para a equipe",
      fala: {
        texto: "E depois da consulta, como fica?",
        roteiro: [
          ferramenta("escalar_humano", { motivo: "assunto_clinico" }),
        ],
      },
      esperado: { desfecho: "escalou", motivo: "assunto_clinico" },
      chamadas: 1,
    },
  ];

  it.each(casos)("$nome", async ({ fala, esperado, doModelo, chamadas }) => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await conversaEmAndamento(c);

    const t = await c.fala(fala);
    expect(oQueDecidiu(t)).toMatchObject(esperado);
    expect(t.chamadasAoModelo).toBe(chamadas);
    // So a frase fixa: nada do que o modelo escreveu.
    expect(t.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(t.statusDaConversa).toBe("aguardando_humano");
    expect(t.decisao).toMatchObject({ aprovado: false, texto_sha256: null });
    if (doModelo !== undefined) {
      expect(c.recebidasPeloPaciente.join("\n")).not.toContain(doModelo);
      if (esperado.desfecho === "bloqueou") {
        // O rascunho fica so no lugar restrito, nunca na decisao.
        expect(c.rascunhosBloqueados).toHaveLength(1);
        expect(c.rascunhosBloqueados[0]?.decision_id).toBe(t.decisao?.id);
        expect(JSON.stringify(t.decisao)).not.toContain(doModelo);
      }
    }
    // O atendimento fica contado para a equipe (a reserva e o nome informado,
    // nunca o valor) e o que a pessoa ja informou nao se perde.
    expect(t.estado.desfecho).toBe("passou_para_equipe");
    expect(c.dados.nome_completo).toBe(true);
    const nota = c.notasInternas.at(-1) ?? "";
    expect(nota).toContain("Resumo do assistente");
    expect(nota).toContain("quarta, 21/10 às 14:00");
    expect(nota).not.toContain("Maria");

    await nadaMaisSai(c, ["Sim", "Nasci em 12/03/1985", "E aí, é normal?"]);
    expect(c.consultas).toEqual([]);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(
      c.recebidasPeloPaciente.filter((m) => m === FRASE_DE_ESCALONAMENTO),
    ).toHaveLength(1);
    expect(c.passagens).toHaveLength(1);
  });
});

describe("6. o modelo que diz que fez sem ter feito, num turno tardio", () => {
  function barrado(
    c: ConversaLonga,
    t: TurnoDaConversa,
    doModelo: string,
    regra = "acao_nao_executada",
  ) {
    expect(oQueDecidiu(t)).toEqual({
      desfecho: "bloqueou",
      regra,
      motivo: "conformidade",
      falha: null,
      gatilho: null,
      camada: "regra",
    });
    expect(t.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(t.ferramentas).toEqual([]);
    expect(t.statusDaConversa).toBe("aguardando_humano");
    expect(c.rascunhosBloqueados).toEqual([
      expect.objectContaining({ texto: doModelo, decision_id: t.decisao?.id }),
    ]);
  }

  it("'Está marcado!' sem reservar nada: a regra barra, e o 'sim' seguinte não marca", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const preco =
      "A consulta custa R$ 280,00 com o Dr. Bruno Costa e R$ 300,00 com a Dra. Ana Lima, no particular.";
    const conversaSemReserva = [
      {
        texto: "Oi, quanto custa a consulta?",
        roteiro: [
          ferramenta("buscar_procedimento", {
            procedimento: P_CONSULTA,
            convenio: null,
          }),
          final(preco),
        ],
      },
      {
        texto: "Onde fica a clínica?",
        roteiro: [
          ferramenta("consultar_unidades", { unidade: "u1" }),
          final(`A unidade Aldeota fica na ${ENDERECO_DA_ALDEOTA}.`),
        ],
      },
      {
        texto: "Tem estacionamento?",
        roteiro: [
          ferramenta("consultar_unidades", { unidade: "u1" }),
          final("Na unidade Aldeota tem estacionamento no subsolo do prédio."),
        ],
      },
      {
        texto: "Tem acesso para cadeira de rodas?",
        roteiro: [
          ferramenta("consultar_unidades", { unidade: "u1" }),
          final("Na unidade Aldeota o acesso é por rampa e elevador."),
        ],
      },
      {
        texto: "O que eu preciso levar?",
        roteiro: [
          ferramenta("consultar_requisitos", {
            procedimento: P_CONSULTA,
            convenio: null,
          }),
          final(
            "Para a Consulta, leve um documento com foto e chegue 15 minutos antes.",
          ),
        ],
      },
      {
        texto: "Quero marcar à tarde",
        roteiro: [
          ferramenta("buscar_horario", busca({ periodo: "tarde" })),
          final(
            "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?",
          ),
        ],
      },
      {
        texto: "Deixa eu ver minha agenda",
        roteiro: [final("Claro, sem pressa. Me diga qual prefere.")],
      },
    ];
    for (const fala of conversaSemReserva) {
      const t = await c.fala(fala);
      expect(oQueDecidiu(t).desfecho).toBe("respondeu");
    }
    expect(c.reservasVivas).toEqual([]);

    const alucinou = "Está marcado!";
    const t8 = await c.fala({
      texto: "Pode marcar quarta às 14h",
      roteiro: [final(alucinou)],
    });
    barrado(c, t8, alucinou);
    expect(c.cenario.banco.chamadasDe("reservar_horario_da_ia")).toEqual([]);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(c.consultas).toEqual([]);

    await nadaMaisSai(c, ["Sim", "Obrigada"]);
    expect(c.consultas).toEqual([]);
  });

  it.each([
    [
      "'Está marcado!'",
      "Está marcado!",
    ],
    [
      "com o dia e a hora da reserva",
      "Está marcado! Sua Consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima ficou marcada.",
    ],
  ])(
    "o 'sim' ao 'Confirma' com o modelo que responde %s sem chamar agendar: barrado; a reserva não vira consulta",
    async (_nome, alucinou) => {
      const c = new ConversaLonga(contexto, {
        catalogo: CADASTRO,
        duasUnidades: true,
      });
      conversaDoTeste = c;
      await comAPerguntaConfirmaNoAr(c);
      const t = await c.fala({
        texto: "Sim, confirmo",
        roteiro: [final(alucinou)],
      });
      barrado(c, t, alucinou);
      expect(c.consultas).toEqual([]);
      expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
      expect(c.reservasVivas).toHaveLength(1);
      await nadaMaisSai(c, ["Sim", "Confirmado?"]);
      expect(c.consultas).toEqual([]);
    },
  );

  it.each([
    ["cancelou", "Quero cancelar minha consulta", "Pronto, cancelei sua consulta."],
    [
      "remarcou",
      "Quero remarcar para segunda",
      "Pronto, remarquei sua consulta para segunda, 02/11 às 14:00.",
    ],
    [
      "entrou na lista",
      "Me coloca na lista de espera",
      "Pronto, você entrou na lista de espera.",
    ],
  ])(
    "depois de marcar de verdade, o modelo diz que %s sem a ferramenta: barrado; a consulta fica",
    async (_nome, texto, alucinou) => {
      const c = new ConversaLonga(contexto, {
        catalogo: CADASTRO,
        duasUnidades: true,
      });
      conversaDoTeste = c;
      const consulta = await marcarASexta(c);
      const quando =
        "Sua Consulta está marcada para sexta, 30/10 às 14:00, pendente da aprovação da equipe.";
      respondeu(
        await c.fala({ texto: "Qual é mesmo o horário?", roteiro: [final(quando)] }),
        quando,
      );
      const tchau = "Por nada!";
      respondeu(await c.fala({ texto: "Obrigada", roteiro: [final(tchau)] }), tchau);
      const espera = "Claro, é só me dizer.";
      respondeu(
        await c.fala({ texto: "Vou ver uma coisa aqui", roteiro: [final(espera)] }),
        espera,
      );
      const t = await c.fala({ texto, roteiro: [final(alucinou)] });
      barrado(c, t, alucinou);
      expect(consulta.status).toBe("agendado");
      expect(c.consultasVivas).toEqual([consulta]);
      expect(c.cenario.fila).toEqual([]);
      await nadaMaisSai(c, ["Sim", "Obrigada"]);
    },
  );

  it.each([
    [
      "o preço",
      "A consulta custa R$ 300,00 com a Dra. Ana Lima.",
      "preco_nao_verificado",
    ],
    [
      "o endereço",
      `A unidade Aldeota fica na ${ENDERECO_DA_ALDEOTA}.`,
      "endereco_nao_verificado",
    ],
    [
      "o convênio",
      "A Consulta é atendida pela Unimed (Nacional).",
      "cobertura_nao_verificada",
    ],
    ["um horário", "Tenho quarta, 21/10 às 15:00.", "horario_nao_verificado"],
  ])(
    "o modelo que repete de cabeça %s, já dito em turnos anteriores: só sai com a ferramenta do turno",
    async (_nome, deCabeca, regra) => {
      const c = new ConversaLonga(contexto, {
        catalogo: CADASTRO,
        duasUnidades: true,
      });
      conversaDoTeste = c;
      await conversaEmAndamento(c);
      const convenio =
        "Sim, a Consulta com a Dra. Ana Lima é atendida pela Unimed (Nacional).";
      respondeu(
        await c.fala({
          texto: "Vocês atendem Unimed?",
          roteiro: [
            ferramenta("buscar_procedimento", {
              procedimento: P_CONSULTA,
              convenio: "Unimed Nacional",
            }),
            final(convenio),
          ],
        }),
        convenio,
      );
      const t = await c.fala({
        texto: "Pode repetir, por favor?",
        roteiro: [final(deCabeca)],
      });
      barrado(c, t, deCabeca, regra);
      await nadaMaisSai(c, ["Sim"]);
    },
  );

  it("com a reserva vencida, dizer que continua reservado é barrado", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await conversaEmAndamento(c);
    const conversa = "Claro, é só me dizer.";
    respondeu(
      await c.fala({ texto: "Vou ver uma coisa aqui", roteiro: [final(conversa)] }),
      conversa,
    );
    const alucinou = "Seu horário continua reservado.";
    const t = await c.fala(
      { texto: "Ainda está reservado?", roteiro: [final(alucinou)] },
      11 * 60_000,
    );
    barrado(c, t, alucinou);
    expect(c.reservasVivas).toEqual([]);
    await nadaMaisSai(c, ["Sim"]);
  });

  // achado: "A equipe já aprovou sua consulta." passa pela regra com a
  // consulta ainda pendente (a mesma frase da remarcacao e barrada). Nenhuma
  // regra confere a aprovacao afirmada na marcacao: o paciente le que esta
  // aprovada, e a equipe ainda pode recusar. Devia barrar (acao_nao_executada).
  // Sobra so o verificador por modelo, que aqui e o falso que aprova.
  it.fails("com a consulta pendente, dizer que a equipe já aprovou não pode sair", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const consulta = await marcarASexta(c);
    const quando =
      "Sua Consulta está marcada para sexta, 30/10 às 14:00, pendente da aprovação da equipe.";
    respondeu(
      await c.fala({ texto: "Qual é mesmo o horário?", roteiro: [final(quando)] }),
      quando,
    );
    const tchau = "Por nada!";
    respondeu(await c.fala({ texto: "Obrigada", roteiro: [final(tchau)] }), tchau);
    const espera = "Claro, é só me dizer.";
    respondeu(
      await c.fala({ texto: "Vou ver uma coisa aqui", roteiro: [final(espera)] }),
      espera,
    );
    expect(consulta.approval_status).toBe("pendente");
    const alucinou = "A equipe já aprovou sua consulta.";
    const t = await c.fala({
      texto: "Já aprovaram?",
      roteiro: [final(alucinou)],
    });
    barrado(c, t, alucinou);
  });

  // achado: depois de marcar UMA consulta de verdade, a resposta sem dia e sem
  // hora que afirma outra marcacao ("Está marcado!", "Marquei sua limpeza de
  // pele.", "Sua limpeza de pele está marcada.") passa pela regra: o fato
  // "marcada nesta conversa" nao diz de QUAL procedimento (fatos-do-turno.ts,
  // sustentada por marcadaNestaConversa) e so a frase com dia ou hora e
  // conferida contra o par. Devia barrar (acao_nao_executada): nenhuma
  // ferramenta rodou no turno e o procedimento pedido nao foi marcado. Sobra
  // so o verificador por modelo, que aqui e o falso que aprova.
  it.fails("depois de marcar uma consulta, 'Está marcado!' para OUTRO procedimento, sem nenhuma ferramenta: não pode sair", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await marcarASexta(c);
    const preco = "A Limpeza de pele custa R$ 120,00 no particular, com a Dra. Ana Lima.";
    respondeu(
      await c.fala({
        texto: "E a limpeza de pele, quanto custa?",
        roteiro: [
          ferramenta("buscar_procedimento", {
            procedimento: codigoDoProcedimento(CADASTRO, PROC.limpeza),
            convenio: null,
          }),
          final(preco),
        ],
      }),
      preco,
    );
    const tchau = "Combinado.";
    respondeu(await c.fala({ texto: "Vou pensar", roteiro: [final(tchau)] }), tchau);
    const certo = "Claro, é só me dizer.";
    respondeu(await c.fala({ texto: "Já volto", roteiro: [final(certo)] }), certo);

    const alucinou = "Está marcado!";
    const t = await c.fala({
      texto: "Pode marcar a limpeza de pele para segunda de manhã",
      roteiro: [final(alucinou)],
    });
    barrado(c, t, alucinou);
    expect(c.consultas).toHaveLength(1);
  });
});

describe("7. muda de assunto várias vezes e volta para a marcação", () => {
  /** O bloco do estado que o modelo leu na primeira chamada do turno. */
  function blocoDoEstado(t: TurnoDaConversa): string {
    return (
      String(t.corpos[0]?.instructions ?? "")
        .split("\n<atendimento_em_andamento>\n")[1]
        ?.split("\n</atendimento_em_andamento>")[0] ?? ""
    );
  }

  it("a coleta não recomeça: o nome fica de uma fala para a outra, mesmo com a reserva vencendo no meio", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;

    await c.fala({
      texto: "Quero marcar uma consulta à tarde",
      roteiro: [
        ferramenta("buscar_horario", busca({ periodo: "tarde" })),
        final(
          "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?",
        ),
      ],
    });
    const reservou =
      "Reservei quarta, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.";
    const t2 = await c.fala({
      texto: "Quarta às 14h",
      roteiro: [ferramenta("reservar_horario", { horario: "h2" }), final(reservou)],
    });
    respondeu(t2, reservou);
    const reserva = t2.estado.slot_hold_id;
    expect(reserva).not.toBeNull();

    const falta = "Obrigada! Agora só falta sua data de nascimento.";
    const t3 = await c.fala({
      texto: "Meu nome é Maria da Silva Souza",
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: "Fulano da Silva Souza",
          data_nascimento: null,
          para_o_titular: true,
          campos_mascarados: [],
        }),
        final(falta),
      ],
    });
    respondeu(t3, falta);
    expect(c.dados).toMatchObject({
      nome_completo: true,
      data_nascimento: false,
      faltam: ["data_nascimento"],
    });

    /** Nada do que importa para marcar mudou com o assunto de fora. */
    const nadaMudou = (t: TurnoDaConversa) => {
      expect(t.estado).toMatchObject({
        etapa: "oferta",
        intencao: "agendar",
        procedure_id: PROC.consulta,
        slot_hold_id: reserva,
        falhas_seguidas: 0,
      });
      expect(t.estado.horarios_oferecidos.map((h) => h.codigo)).toEqual([
        "h1",
        "h2",
        "h3",
        "h4",
      ]);
      expect(c.dados.faltam).toEqual(["data_nascimento"]);
      // O modelo le o que ja tem e o que falta: nao precisa pedir de novo.
      expect(blocoDoEstado(t)).toContain("Dados já informados: nome completo.");
      expect(blocoDoEstado(t)).toContain(
        "Dados que faltam para marcar: data de nascimento.",
      );
    };

    const preco =
      "A consulta custa R$ 280,00 com o Dr. Bruno Costa e R$ 300,00 com a Dra. Ana Lima, no particular.";
    const t4 = await c.fala({
      texto: "Só uma dúvida, quanto custa a consulta?",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: P_CONSULTA,
          convenio: null,
        }),
        final(preco),
      ],
    });
    respondeu(t4, preco);
    nadaMudou(t4);

    const limpeza =
      "A Limpeza de pele custa R$ 120,00 no particular, com a Dra. Ana Lima.";
    const t5 = await c.fala({
      texto: "E a limpeza de pele?",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: codigoDoProcedimento(CADASTRO, PROC.limpeza),
          convenio: null,
        }),
        final(limpeza),
      ],
    });
    respondeu(t5, limpeza);
    // O preco de outro procedimento nao troca o pedido da marcacao.
    nadaMudou(t5);

    const endereco = `A unidade Centro fica na ${ENDERECO_DO_CENTRO}.`;
    const t6 = await c.fala({
      texto: "Onde fica mesmo?",
      roteiro: [ferramenta("consultar_unidades", { unidade: "u2" }), final(endereco)],
    });
    respondeu(t6, endereco);
    nadaMudou(t6);
    expect(c.reservasVivas).toHaveLength(1);

    // Doze minutos depois da reserva: ela venceu. O fora do assunto responde
    // a frase do dono e o estado fica sem a reserva, com os horarios e o nome.
    const t7 = await c.fala({
      texto: "Quem ganhou o jogo ontem?",
      roteiro: [ferramenta("fora_do_assunto", {})],
    });
    respondeu(t7, FRASE_FORA_DO_ASSUNTO);
    expect(t7.decisao?.tool_used).toBe("fora_do_assunto");
    expect(c.reservasVivas).toEqual([]);
    expect(t7.estado).toMatchObject({
      etapa: "oferta",
      slot_hold_id: null,
      procedure_id: PROC.consulta,
      falhas_seguidas: 0,
    });
    expect(c.dados).toMatchObject({
      nome_completo: true,
      faltam: ["data_nascimento"],
    });

    // Volta: o nascimento e o mesmo horario, reservado de novo. So o que
    // faltava e pedido: o nome nao volta.
    const confirma =
      "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?";
    const t8 = await c.fala({
      texto: "Voltando: nasci em 12/03/1985 e pode ser aquela de quarta às 14h",
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: null,
          data_nascimento: "1985-03-12",
          para_o_titular: true,
          campos_mascarados: [],
        }),
        ferramenta("reservar_horario", { horario: "h2" }),
        final(confirma),
      ],
    });
    respondeu(t8, confirma);
    // O bloco do estado disse que a reserva tinha vencido.
    expect(blocoDoEstado(t8)).toContain("Dados já informados: nome completo.");
    expect(saidasDoTurno(t8)).toEqual([
      {
        resultado: "registrado",
        registrados: ["data_nascimento"],
        faltam: [],
      },
      expect.objectContaining({ resultado: "reservado", dados_que_faltam: [] }),
    ]);
    expect(t8.estado.etapa).toBe("aguardando_confirmacao");
    expect(t8.estado.slot_hold_id).not.toBe(reserva);
    expect(c.cenario.banco.chamadasDe("registrar_dados_da_marcacao")).toEqual([
      expect.objectContaining({
        p_nome_completo: "Maria da Silva Souza",
        p_data_nascimento: null,
      }),
      expect.objectContaining({
        p_nome_completo: null,
        p_data_nascimento: "1985-03-12",
      }),
    ]);

    const marcou =
      "Pronto! Sua Consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.";
    const t9 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {}), final(marcou)],
    });
    respondeu(t9, marcou);
    expect(c.consultas).toEqual([
      expect.objectContaining({ starts_at: iso("2026-10-21", "14:00") }),
    ]);
    // Os dados das duas falas ficam juntos, ligados a consulta.
    expect(c.cenario.banco.linhas("dados_informados_na_marcacao")).toEqual([
      expect.objectContaining({
        appointment_id: c.consultas[0]?.id,
        nome_completo: "Maria da Silva Souza",
        data_nascimento: "1985-03-12",
      }),
    ]);
  });

  it("muda de procedimento e de pagamento no meio: o nome fica, a carteirinha passa a faltar e a reserva antiga sai", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await conversaEmAndamento(c);
    const reservaDoParticular = c.estado.slot_hold_id;

    const unimed =
      "Sim, a Consulta com a Dra. Ana Lima é atendida pela Unimed (Nacional). Tenho quarta, 21/10 às 15:00, na unidade Centro. Pode ser?";
    const t7 = await c.fala({
      texto: "Na verdade vou usar a Unimed Nacional, tem quarta às 15h?",
      roteiro: [
        ferramenta(
          "buscar_horario",
          busca({
            convenio: "Unimed Nacional",
            a_partir_de: "2026-10-21",
            hora: "15:00",
          }),
        ),
        final(unimed),
      ],
    });
    respondeu(t7, unimed);
    expect(t7.estado).toMatchObject({
      insurance_id: CONV.unimed,
      particular: false,
    });
    // A reserva do particular continua ate a pessoa escolher outra.
    expect(t7.estado.slot_hold_id).toBe(reservaDoParticular);
    expect(c.dados.nome_completo).toBe(true);

    const codigoDaUnimed = (
      saidasDoTurno(t7)[0]?.horarios as { codigo: string }[]
    )[0]?.codigo;
    const reservou =
      "Reservei quarta, 21/10 às 15:00 com a Dra. Ana Lima, na unidade Centro, por 10 minutos. Agora me envie sua data de nascimento e o número da carteirinha.";
    const t8 = await c.fala({
      texto: "Pode ser",
      roteiro: [
        ferramenta("reservar_horario", { horario: codigoDaUnimed }),
        final(reservou),
      ],
    });
    respondeu(t8, reservou);
    expect(c.reservasVivas).toEqual([
      expect.objectContaining({
        service_link_id: VINC.consultaAnaUnimed,
        starts_at: iso("2026-10-21", "15:00"),
      }),
    ]);
    // O nome nao volta a faltar; a carteirinha entra, pelo convenio.
    expect(c.dados).toMatchObject({
      nome_completo: true,
      faltam: ["data_nascimento", "carteirinha"],
    });

    const confirma =
      "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 15:00, na unidade Centro, pela Unimed (Nacional)?";
    const t9 = await c.fala({
      texto: "Carteirinha 12345678, nasci em 12/03/1985",
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: null,
          data_nascimento: "1985-03-12",
          para_o_titular: true,
          campos_mascarados: ["carteirinha"],
        }),
        final(confirma),
      ],
    });
    respondeu(t9, confirma);
    expect(t9.estado.etapa).toBe("aguardando_confirmacao");
    expect(c.dados).toMatchObject({ carteirinha: true, faltam: [] });
    // A carteirinha foi lida pelo servidor: nunca foi ao modelo.
    expect(JSON.stringify(c.cenario.corpos)).not.toContain("12345678");

    const marcou =
      "Pronto! Sua Consulta de quarta, 21/10 às 15:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.";
    const t10 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {}), final(marcou)],
    });
    respondeu(t10, marcou);
    expect(c.consultas).toEqual([
      expect.objectContaining({
        service_link_id: VINC.consultaAnaUnimed,
        starts_at: iso("2026-10-21", "15:00"),
      }),
    ]);
  });

  it("o segundo assunto de fora na mesma conversa passa para a equipe, com a marcação contada na nota", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await conversaEmAndamento(c);
    const t7 = await c.fala({
      texto: "Quem ganhou o jogo ontem?",
      roteiro: [ferramenta("fora_do_assunto", {})],
    });
    respondeu(t7, FRASE_FORA_DO_ASSUNTO);
    const t8 = await c.fala({
      texto: "E a previsão do tempo?",
      roteiro: [ferramenta("fora_do_assunto", {})],
    });
    expect(oQueDecidiu(t8)).toMatchObject({
      desfecho: "escalou",
      motivo: "fora_do_assunto",
    });
    expect(t8.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(c.notasInternas.at(-1)).toContain("quarta, 21/10 às 14:00");
    await nadaMaisSai(c, ["Nasci em 12/03/1985", "Sim"]);
    expect(c.consultas).toEqual([]);
  });
});

describe("8. o preparo aprovado depois de marcar", () => {
  const CATALOGO_COM_PREPARO = comPreparoEmVigor(CATALOGO_DA_AG5, [PROC.limpeza]);
  const MENSAGEM_DO_PREPARO = mensagemDoPreparo({
    procedimento: "Limpeza de pele",
    rt: RT_DE_TESTE,
    texto: TEXTO_DO_PREPARO_DE_TESTE,
  });
  const MARCOU =
    "Pronto! Sua Limpeza de pele de quinta, 22/10 às 08:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.";

  /** Busca, reserva, dados e confirmação da limpeza: a F2 depois de marcar. */
  async function marcarALimpeza(c: ConversaLonga) {
    await c.fala({
      texto: "Quero marcar limpeza de pele com a Dra. Ana de manhã",
      roteiro: [
        ferramenta(
          "buscar_horario",
          buscaDaLimpeza({ profissional: R_ANA, periodo: "manha" }),
        ),
        final(
          "Tenho quarta, 21/10 às 08:00 ou quinta, 22/10 às 08:00 com a Dra. Ana Lima. Qual prefere?",
        ),
      ],
    });
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
    const t4 = await c.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {}), final(MARCOU)],
    });
    // A F2: o sistema cola depois da resposta do modelo, pelo filtro inteiro.
    respondeu(t4, `${MARCOU}\n\n${FRASE_DO_PREPARO_DEPOIS_DE_MARCAR}`);
    return t4;
  }

  it("só o texto aprovado sai, palavra por palavra, numa mensagem só; o modelo nunca lê o texto; escrever o preparo é barrado", async () => {
    const c = new ConversaLonga(contexto, { catalogo: CATALOGO_COM_PREPARO });
    conversaDoTeste = c;
    await marcarALimpeza(c);

    const preco = "A Limpeza de pele custa R$ 120,00 no particular, com a Dra. Ana Lima.";
    const t5 = await c.fala({
      texto: "Quanto custa mesmo?",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: P_LIMPEZA,
          convenio: null,
        }),
        final(preco),
      ],
    });
    // A F2 so no turno que marcou.
    respondeu(t5, preco);

    // O pedido: sem nenhum texto do modelo, sem o filtro e sem o verificador.
    const pedidosAoVerificador = c.cenario.verificacao.pedidos.length;
    const t6 = await c.fala({
      texto: "Me manda a orientação de preparo",
      roteiro: [ferramenta("enviar_preparo", { procedimento: P_LIMPEZA })],
    });
    expect(t6.enviadas).toEqual([MENSAGEM_DO_PREPARO]);
    expect(t6.chamadasAoModelo).toBe(1);
    expect(t6.decisao).toMatchObject({
      desfecho: "enviou_preparo",
      preparo_versao_id: CATALOGO_COM_PREPARO.preparosEmVigor?.get(PROC.limpeza)
        ?.versaoId,
      texto_sha256: sha256DoTexto(MENSAGEM_DO_PREPARO),
      aprovado: false,
      compliance_blocked: false,
      escalation_reason: null,
      tool_used: "enviar_preparo",
    });
    expect(c.cenario.verificacao.pedidos).toHaveLength(pedidosAoVerificador);
    expect(t6.statusDaConversa).toBe("ia_atendendo");
    expect(t6.estado).toMatchObject({
      etapa: "pos_marcacao",
      appointment_id: c.consultas[0]?.id,
    });
    const linha = c.cenario.banco
      .linhas("message")
      .find((m) => m.job_id === t6.job);
    expect(linha).toMatchObject({
      author: "sistema",
      body: MENSAGEM_DO_PREPARO,
      delivery_status: "enviada",
      billable: false,
      cost_cents: 0,
    });

    // O turno seguinte: o modelo le o substituto, nunca o texto (o ajudante
    // confere o texto em todo corpo).
    const quando =
      "Sua Limpeza de pele está marcada para quinta, 22/10 às 08:00, pendente da aprovação da equipe.";
    const t7 = await c.fala({
      texto: "Qual é mesmo o horário?",
      roteiro: [final(quando)],
    });
    respondeu(t7, quando);
    const noHistorico = JSON.stringify(t7.corpos[0]?.input);
    expect(noHistorico).toContain(
      substitutoDaMensagemDoPreparo("Limpeza de pele"),
    );

    // O preparo pedido junto de outra ferramenta nao sai: volta ao modelo, e o
    // que sai e so a resposta dele, sem o texto.
    const separada =
      "A Limpeza de pele custa R$ 120,00. Quer receber a orientação de preparo?";
    const t8 = await c.fala({
      texto: "Quanto custa e me manda o preparo de novo",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: P_LIMPEZA,
          convenio: null,
        }),
        ferramenta("enviar_preparo", { procedimento: P_LIMPEZA }),
        final(separada),
      ],
    });
    respondeu(t8, separada);
    expect(saidasDoTurno(t8).at(-1)).toEqual({
      ok: false,
      motivo: "vai_sozinha",
    });

    // O modelo que copia um trecho do texto aprovado: barrado.
    const t9 = await c.fala({
      texto: "O que mais eu preciso saber?",
      roteiro: [final(FRASE_DO_PREPARO_SO_DO_TRECHO)],
    });
    expect(oQueDecidiu(t9)).toMatchObject({
      desfecho: "bloqueou",
      motivo: "conformidade",
      regra: "orientacao_clinica",
      camada: "regra",
    });
    expect(t9.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(c.recebidasPeloPaciente.join("\n").split(MENSAGEM_DO_PREPARO)).toHaveLength(
      2,
    );

    await nadaMaisSai(c, ["Me manda o preparo de novo", "Sim"]);
    // O preparo saiu uma vez so, e nada do texto saiu em outra mensagem.
    const foraDoPreparo = c.recebidasPeloPaciente.filter(
      (m) => m !== MENSAGEM_DO_PREPARO,
    );
    for (const frase of TEXTO_DO_PREPARO_DE_TESTE.split("\n")) {
      expect(foraDoPreparo.join("\n")).not.toContain(frase);
    }
  });

  it("o pedido do preparo no meio do 'Confirma' desarma a pergunta: o 'sim' seguinte não marca, e a pergunta de novo vale", async () => {
    const c = new ConversaLonga(contexto, { catalogo: CATALOGO_COM_PREPARO });
    conversaDoTeste = c;
    await c.fala({
      texto: "Quero marcar limpeza de pele com a Dra. Ana de manhã",
      roteiro: [
        ferramenta(
          "buscar_horario",
          buscaDaLimpeza({ profissional: R_ANA, periodo: "manha" }),
        ),
        final(
          "Tenho quarta, 21/10 às 08:00 ou quinta, 22/10 às 08:00 com a Dra. Ana Lima. Qual prefere?",
        ),
      ],
    });
    const reservou =
      "Reservei quinta, 22/10 às 08:00 com a Dra. Ana Lima por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.";
    await c.fala({
      texto: "Quinta às 8",
      roteiro: [ferramenta("reservar_horario", { horario: "h2" }), final(reservou)],
    });
    const confirma =
      "Obrigada! Confirma a Limpeza de pele com a Dra. Ana Lima na quinta, 22/10 às 08:00, no particular?";
    const t3 = await c.fala({
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
    expect(t3.estado.etapa).toBe("aguardando_confirmacao");

    const t4 = await c.fala({
      texto: "Antes de confirmar, me manda a orientação de preparo",
      roteiro: [ferramenta("enviar_preparo", { procedimento: P_LIMPEZA })],
    });
    expect(t4.enviadas).toEqual([MENSAGEM_DO_PREPARO]);
    expect(t4.estado.etapa).not.toBe("aguardando_confirmacao");
    expect(c.reservasVivas).toHaveLength(1);

    // O "sim" agora responde ao preparo, nao ao "Confirma": nao marca.
    const deNovo =
      "Confirma a Limpeza de pele com a Dra. Ana Lima na quinta, 22/10 às 08:00, no particular?";
    const t5 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {}), final(deNovo)],
    });
    respondeu(t5, deNovo);
    expect(saidasDoTurno(t5)[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(c.consultas).toEqual([]);
    expect(t5.estado.etapa).toBe("aguardando_confirmacao");
    expect(t5.estado.falhas_seguidas).toBe(1);

    const t6 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {}), final(MARCOU)],
    });
    respondeu(t6, `${MARCOU}\n\n${FRASE_DO_PREPARO_DEPOIS_DE_MARCAR}`);
    expect(c.consultas).toHaveLength(1);
    expect(t6.estado.falhas_seguidas).toBe(0);

    // O preparo de novo, de outro job, sai inteiro; e o pedido com a situacao
    // da pessoa fica com a equipe.
    const t7 = await c.fala({
      texto: "Me manda de novo a orientação de preparo",
      roteiro: [ferramenta("enviar_preparo", { procedimento: P_LIMPEZA })],
    });
    expect(t7.enviadas).toEqual([MENSAGEM_DO_PREPARO]);
    const t8 = await c.fala({
      texto: "Me manda o preparo, eu tomo remédio pra pressão",
    });
    expect(oQueDecidiu(t8)).toMatchObject({
      desfecho: "escalou",
      motivo: "assunto_clinico",
    });
    expect(t8.chamadasAoModelo).toBe(0);
    expect(t8.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    await nadaMaisSai(c, ["Oi?"]);
  });

  it("a versão que sai de vigor antes do envio: nada do preparo sai; a frase e a equipe, com a nota", async () => {
    const c = new ConversaLonga(contexto, { catalogo: CATALOGO_COM_PREPARO });
    conversaDoTeste = c;
    await marcarALimpeza(c);
    const quando =
      "Sua Limpeza de pele está marcada para quinta, 22/10 às 08:00, pendente da aprovação da equipe.";
    respondeu(
      await c.fala({ texto: "Qual é mesmo o horário?", roteiro: [final(quando)] }),
      quando,
    );
    const tchau = "Por nada!";
    respondeu(await c.fala({ texto: "Obrigada", roteiro: [final(tchau)] }), tchau);

    // O RT saiu: o catalogo do turno ainda tem a versao; a leitura do envio, nao.
    c.preparoForaDeVigor = true;
    const t7 = await c.fala({
      texto: "Me manda a orientação de preparo",
      roteiro: [ferramenta("enviar_preparo", { procedimento: P_LIMPEZA })],
    });
    expect(oQueDecidiu(t7)).toMatchObject({
      desfecho: "escalou",
      motivo: "assunto_clinico",
    });
    expect(t7.decisao?.preparo_versao_id).toBeUndefined();
    expect(t7.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(trilhaDoTurno(t7)).toContain(PASSO_DO_PREPARO_FORA_DE_VIGOR);
    expect(c.notasInternas.at(-1)).toContain("Resumo do assistente");
    await nadaMaisSai(c, ["Me manda o preparo", "Oi?"]);
    expect(c.recebidasPeloPaciente.join("\n")).not.toContain(
      TEXTO_DO_PREPARO_DE_TESTE,
    );
  });
});

describe("9. o 'sim' solto não confirma nada", () => {
  const CONFIRMA_QUARTA =
    "Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?";
  const MARCOU_QUARTA =
    "Pronto! Sua Consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.";

  it("marcação: o 'sim' depois de outra mensagem da clínica não marca; a pergunta de novo vale", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await comAPerguntaConfirmaNoAr(c);

    c.daClinica("A Clínica Bem Estar deseja uma ótima semana!");
    const t8 = await c.fala(
      {
        texto: "Sim",
        roteiro: [ferramenta("agendar", {}), final(CONFIRMA_QUARTA)],
      },
      20_000,
    );
    respondeu(t8, CONFIRMA_QUARTA);
    expect(saidasDoTurno(t8)[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(c.consultas).toEqual([]);
    expect(c.reservasVivas).toHaveLength(1);
    expect(t8.estado).toMatchObject({
      etapa: "aguardando_confirmacao",
      falhas_seguidas: 1,
    });

    // Agora o "sim" vem logo depois da pergunta: marca.
    const t9 = await c.fala(
      {
        texto: "Sim",
        roteiro: [ferramenta("agendar", {}), final(MARCOU_QUARTA)],
      },
      20_000,
    );
    respondeu(t9, MARCOU_QUARTA);
    expect(c.consultas).toHaveLength(1);
    expect(t9.estado).toMatchObject({
      etapa: "pos_marcacao",
      falhas_seguidas: 0,
    });
  });

  it("marcação: o 'sim' depois que a reserva venceu não marca; e o 'sim' seguinte, sem pergunta, também não", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await comAPerguntaConfirmaNoAr(c);

    const venceu =
      "O horário que estava reservado não vale mais. Quer que eu procure de novo?";
    const t8 = await c.fala(
      {
        texto: "Sim",
        roteiro: [ferramenta("agendar", {}), final(venceu)],
      },
      11 * 60_000,
    );
    respondeu(t8, venceu);
    expect(saidasDoTurno(t8)[0]).toEqual({ resultado: "reserva_vencida" });
    expect(c.consultas).toEqual([]);
    expect(c.reservasVivas).toEqual([]);
    expect(t8.estado).toMatchObject({
      etapa: "oferta",
      slot_hold_id: null,
      falhas_seguidas: 0,
    });
    // O nome e o nascimento continuam.
    expect(c.dados).toMatchObject({
      nome_completo: true,
      data_nascimento: true,
      faltam: [],
    });

    // "Sim" de novo: a etapa nao esta armada, e a RPC nem e chamada.
    const chamadas = c.cenario.banco.chamadasDe("agendar_pela_ia").length;
    const semPergunta = "Para qual horário? Posso procurar de novo.";
    const t9 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {}), final(semPergunta)],
    });
    respondeu(t9, semPergunta);
    expect(saidasDoTurno(t9)[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(chamadas);
    expect(c.consultas).toEqual([]);
    expect(t9.estado.falhas_seguidas).toBe(1);
  });

  it("cancelamento: campanha no meio, a pergunta vencida, outro assunto e a citação de outra mensagem: nada cancela até o 'sim' logo depois da pergunta", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const { c1, c2 } = consultasDoContato(c.cenario.banco);
    const T1 = "Confirma o cancelamento da sua consulta de quinta, 22/10 às 14:00?";
    const pedido = {
      roteiro: () => [
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("pedir_cancelamento", { consulta: "c1" }),
      ],
    };
    const intacta = () => {
      expect(c1.status).toBe("agendado");
      expect(c2.status).toBe("agendado");
      expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    };

    const t1 = await c.fala({
      texto: "Preciso cancelar minha consulta de quinta",
      roteiro: pedido.roteiro(),
    });
    respondeu(t1, `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${T1}`);
    expect(t1.estado).toMatchObject({
      etapa: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: C1,
    });

    // A campanha sai entre a pergunta e o "sim": a pergunta volta, com falha.
    const campanha = c.daClinica("A Clínica Bem Estar deseja uma ótima semana!");
    const t2 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    respondeu(t2, T1);
    intacta();
    expect(t2.estado).toMatchObject({
      pedido_pendente: "cancelar",
      falhas_seguidas: 1,
    });
    expect(trilhaDoTurno(t2).join(" ")).toContain("outra mensagem da clínica");

    // Mais de uma hora depois: a pergunta venceu; volta sem falha.
    const t3 = await c.fala(
      { texto: "Sim", roteiro: [ferramenta("cancelar_consulta", {})] },
      61 * 60_000,
    );
    respondeu(t3, T1);
    intacta();
    expect(t3.estado.falhas_seguidas).toBe(0);
    expect(trilhaDoTurno(t3).join(" ")).toContain("venceu");

    // Outro assunto: a pergunta desarma.
    const preco =
      "A consulta custa R$ 280,00 com o Dr. Bruno Costa e R$ 300,00 com a Dra. Ana Lima, no particular.";
    const t4 = await c.fala({
      texto: "Quanto custa a consulta?",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: P_CONSULTA,
          convenio: null,
        }),
        final(preco),
      ],
    });
    respondeu(t4, preco);
    expect(t4.estado.pedido_pendente).toBeNull();
    intacta();

    // "Sim" sem pergunta armada: recusado no servidor.
    const qual = "Claro. Sobre o que é o seu sim?";
    const t5 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {}), final(qual)],
    });
    respondeu(t5, qual);
    expect(saidasDoTurno(t5)[0]).toEqual({
      resultado: "sem_pergunta_de_cancelamento",
    });
    intacta();
    expect(t5.estado.falhas_seguidas).toBe(1);

    const t6 = await c.fala({
      texto: "Quero cancelar a de quinta",
      roteiro: pedido.roteiro(),
    });
    respondeu(t6, T1);
    expect(t6.estado.falhas_seguidas).toBe(0);

    // O "sim" que cita outra mensagem (o botao de uma mensagem antiga).
    const t7 = await c.fala({
      texto: "Sim",
      citacao: { mensagem: campanha },
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    respondeu(t7, T1);
    intacta();
    expect(t7.estado.falhas_seguidas).toBe(1);

    // O "sim" logo depois da pergunta: cancela so a consulta do pedido.
    const t8 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    respondeu(
      t8,
      "Tudo bem, sua consulta de 22/10 às 14:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.",
    );
    expect(c1.status).toBe("cancelado_paciente");
    expect(c2.status).toBe("agendado");
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toHaveLength(1);
    expect(t8.estado).toMatchObject({
      desfecho: "cancelou",
      falhas_seguidas: 0,
    });
  });

  it("remarcação: outra pergunta no meio e o 'sim' depois da hora não trocam a consulta", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const consulta = await marcarASexta(c);
    c.equipeAprova(consulta);
    await pedirARemarcacaoParaTerca(c);

    // Outro assunto depois da T3: a pergunta deixa de valer.
    const preco =
      "A consulta custa R$ 280,00 com o Dr. Bruno Costa e R$ 300,00 com a Dra. Ana Lima, no particular.";
    const t7 = await c.fala({
      texto: "Quanto custa mesmo?",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: P_CONSULTA,
          convenio: null,
        }),
        final(preco),
      ],
    });
    respondeu(t7, preco);
    expect(t7.estado).toMatchObject({
      etapa: "oferta",
      pedido_pendente: "remarcar",
    });

    // O "sim" agora responde ao preco: nao remarca.
    const deNovo = "Para remarcar, preciso que confirme o horário de novo.";
    const t8 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {}), final(deNovo)],
    });
    respondeu(t8, deNovo);
    expect(saidasDoTurno(t8)[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(c.consultas).toEqual([consulta]);
    expect(consulta.remarcacao_pedida_em ?? null).toBeNull();

    // A T3 de novo, e o "sim" so depois de vencer a reserva.
    const t9 = await c.fala({
      texto: "Pode ser terça às 8 mesmo",
      roteiro: [ferramenta("reservar_horario", { horario: "h1" })],
    });
    respondeu(
      t9,
      "Reservei terça, 03/11 às 08:00, na unidade Aldeota, por 10 minutos. Confirma a remarcação da sua consulta de sexta, 30/10 às 14:00 para terça, 03/11 às 08:00?",
    );
    expect(t9.estado.etapa).toBe("aguardando_confirmacao");
    const venceu = "O horário reservado não vale mais. Quer que eu procure de novo?";
    const t10 = await c.fala(
      { texto: "Sim", roteiro: [ferramenta("agendar", {}), final(venceu)] },
      11 * 60_000,
    );
    respondeu(t10, venceu);
    expect(saidasDoTurno(t10)[0]).toEqual({ resultado: "reserva_vencida" });
    expect(c.consultas).toEqual([consulta]);
    expect(consulta.status).toBe("agendado");
  });

  it("o 'sim' sem pergunta nenhuma, duas vezes seguidas: passa para a equipe, sem o texto do modelo", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await conversaEmAndamento(c);

    const qual = "Claro. Sobre o que é o seu sim?";
    const t7 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {}), final(qual)],
    });
    respondeu(t7, qual);
    expect(t7.estado.falhas_seguidas).toBe(1);

    const doModelo = "Pronto, está tudo certo.";
    const t8 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {}), final(doModelo)],
    });
    expect(oQueDecidiu(t8)).toMatchObject({
      desfecho: "escalou",
      motivo: "falhas_seguidas",
    });
    expect(t8.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(c.recebidasPeloPaciente.join("\n")).not.toContain(doModelo);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    await nadaMaisSai(c, ["Sim", "Sim!"]);
    expect(c.consultas).toEqual([]);
  });

  it("o 'sim' cruzado entre as perguntas: o da lista de espera não marca, e o do 'Confirma' não entra na lista", async () => {
    const c = new ConversaLonga(contexto, { catalogo: CATALOGO_DA_AG5 });
    conversaDoTeste = c;

    const semNoite =
      "Não tenho horário à noite com a Dra. Ana Lima. Posso procurar de manhã ou à tarde, ou colocar você na lista de espera para à noite. O que prefere?";
    await c.fala({
      texto: "Queria limpeza de pele com a Dra. Ana, só à noite.",
      roteiro: [
        ferramenta(
          "buscar_horario",
          buscaDaLimpeza({ profissional: R_ANA, periodo: "noite" }),
        ),
        final(semNoite),
      ],
    });
    respondeu(
      await c.fala({
        texto: "Lista de espera. Segunda ou quarta.",
        roteiro: [
          ferramenta("pedir_lista_de_espera", {
            periodos: ["noite"],
            dias: ["segunda", "quarta"],
          }),
        ],
      }),
      T_E1_ANA_NOITE_SEG_QUA,
    );

    // A pessoa nao responde a T-E1: vai para a marcacao.
    const oferta =
      "Tenho quarta, 21/10 às 08:00 ou quinta, 22/10 às 08:00 com a Dra. Ana Lima. Qual prefere?";
    respondeu(
      await c.fala({
        texto: "Melhor de manhã mesmo",
        roteiro: [
          ferramenta(
            "buscar_horario",
            buscaDaLimpeza({ profissional: R_ANA, periodo: "manha" }),
          ),
          final(oferta),
        ],
      }),
      oferta,
    );
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
    const t5 = await c.fala({
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
    respondeu(t5, confirma);
    expect(t5.estado.etapa).toBe("aguardando_confirmacao");
    expect(c.cenario.pedidos).toHaveLength(1);

    // O "sim" responde ao "Confirma", e o modelo chama a lista: nao entra. O
    // sistema pergunta a T-E1 de novo (com falha), e o "Confirma" desarma.
    const t6 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    respondeu(t6, T_E1_ANA_NOITE_SEG_QUA);
    expect(c.cenario.fila).toEqual([]);
    expect(c.consultas).toEqual([]);
    expect(t6.estado.etapa).not.toBe("aguardando_confirmacao");
    expect(t6.estado.falhas_seguidas).toBe(1);

    // O "sim" agora responde a T-E1, e o modelo chama agendar: nao marca.
    const deNovo =
      "Confirma a Limpeza de pele com a Dra. Ana Lima na quinta, 22/10 às 08:00, no particular?";
    const t7 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {}), final(deNovo)],
    });
    expect(oQueDecidiu(t7)).toMatchObject({
      desfecho: "escalou",
      motivo: "falhas_seguidas",
    });
    expect(t7.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(c.consultas).toEqual([]);
    expect(c.cenario.fila).toEqual([]);

    await nadaMaisSai(c, ["Sim", "Sim"]);
    expect(c.consultas).toEqual([]);
    expect(c.cenario.fila).toEqual([]);
  });

  // achado: na marcacao e na remarcacao o "sim" nao tem a lista fechada do
  // cancelamento e da lista de espera (D-30): quem julga a resposta da pessoa e
  // so o modelo. A pessoa escreve "Não, melhor não" (sozinho, ou "Sim" e "Não,
  // espera" na mesma rajada, lidos pelo mesmo job), o modelo chama agendar e a
  // consulta nasce, pendente da equipe, com a resposta "ficou marcada". Devia
  // recusar (sem_confirmacao_do_paciente), como no cancelamento.
  it.fails.each([
    ["'Não, melhor não'", ["Não, melhor não"]],
    ["'Sim' e 'Não, espera' na mesma rajada", ["Sim", "Não, espera"]],
  ])("marcação: %s com o modelo que chama agendar não pode marcar", async (_nome, textos) => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await comAPerguntaConfirmaNoAr(c);
    await c.rajada(
      textos,
      { roteiro: [ferramenta("agendar", {}), final(MARCOU_QUARTA)] },
      20_000,
    );
    expect(c.consultas).toEqual([]);
  });

  it("cancelamento: 'Sim' e 'Não, espera' na mesma rajada: a lista fechada não cancela, e a pergunta volta", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await conversaEmAndamento(c);
    const { c1 } = consultasDoContato(c.cenario.banco);
    const T1 = "Confirma o cancelamento da sua consulta de quinta, 22/10 às 14:00?";
    respondeu(
      await c.fala({
        texto: "Preciso cancelar minha consulta de quinta",
        roteiro: [
          ferramenta("consultar_minhas_consultas", {}),
          ferramenta("pedir_cancelamento", { consulta: "c1" }),
        ],
      }),
      T1,
    );
    const t8 = await c.rajada(["Sim", "Não, espera"], {
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    respondeu(t8, T1);
    expect(c1.status).toBe("agendado");
    expect(c.cenario.banco.chamadasDe("cancelar_consulta_pela_ia")).toEqual([]);
    expect(t8.estado.falhas_seguidas).toBe(1);
    // "Não": fica como esta, sem cancelar, e o modelo so le o resultado.
    const naoCancelou = "Tudo bem, sua consulta continua marcada.";
    const t9 = await c.fala({
      texto: "Não",
      roteiro: [ferramenta("cancelar_consulta", {}), final(naoCancelou)],
    });
    respondeu(t9, naoCancelou);
    expect(saidasDoTurno(t9)[0]).toEqual({ resultado: "paciente_nao_confirmou" });
    expect(c1.status).toBe("agendado");
    expect(t9.estado.pedido_pendente).toBeNull();
  });
});

describe("10. dois assuntos numa fala só e a rajada", () => {
  it("cada job responde uma vez; o segundo job da rajada não repete; o 'sim' com mensagem no meio do turno não marca", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;

    const dois = `A consulta custa R$ 300,00 com a Dra. Ana Lima, no particular. A unidade Aldeota fica na ${ENDERECO_DA_ALDEOTA}.`;
    const t1 = await c.fala({
      texto: "Quanto custa a consulta e onde fica a clínica?",
      roteiro: [
        ferramenta("buscar_procedimento", {
          procedimento: P_CONSULTA,
          convenio: null,
        }),
        ferramenta("consultar_unidades", { unidade: "u1" }),
        final(dois),
      ],
    });
    respondeu(t1, `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${dois}`);
    expect(t1.ferramentas).toEqual(["buscar_procedimento", "consultar_unidades"]);

    // A rajada: um job so le as tres e responde uma vez.
    const oferta =
      "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro, ou quinta, 22/10 às 13:00 com o Dr. Bruno Costa. Qual prefere?";
    const t2 = await c.rajada(["Quero marcar", "à tarde", "sem convênio"], {
      roteiro: [
        ferramenta("buscar_horario", busca({ periodo: "tarde" })),
        final(oferta),
      ],
    });
    respondeu(t2, oferta);
    const turnoDaRajada = c.executor
      .linhas("ai_turno")
      .find((l) => l.job_id === t2.job);
    expect(turnoDaRajada?.mensagens_lidas).toHaveLength(3);
    // As tres foram ao modelo, depois da resposta anterior.
    expect(
      (t2.corpos[0]?.input as { role: string; content: string }[])
        .slice(-3)
        .map((m) => m.content),
    ).toEqual(["Quero marcar", "à tarde", "sem convênio"]);

    // O segundo job da mesma rajada nao tem o que responder.
    const t3 = await c.continua();
    expect(t3.resultado).toEqual({ ok: true });
    expect(t3.chamadasAoModelo).toBe(0);
    expect(t3.enviadas).toEqual([]);
    expect(t3.decisao).toBeUndefined();

    // Dois assuntos com efeito na mesma fala: a reserva e os dados.
    const confirma =
      "Obrigada! Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?";
    const t4 = await c.fala({
      texto: "Quarta às 14h. Sou Maria da Silva Souza, nasci em 12/03/1985",
      roteiro: [
        ferramenta("reservar_horario", { horario: "h2" }),
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
    expect(c.dados.faltam).toEqual([]);
    const reserva = t4.estado.slot_hold_id;

    // O "sim", com a pessoa escrevendo de novo no meio do turno: o banco diz
    // mensagem_nova, nada sai, nada muda e o job seguinte fica na fila.
    const estadoAntes = structuredClone(c.estado);
    const t5 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("agendar", {})],
      durante: () => {
        c.escreve("Espera, na verdade prefiro quinta");
      },
    });
    expect(t5.resultado).toEqual({ ok: true });
    expect(t5.enviadas).toEqual([]);
    expect(oQueDecidiu(t5)).toMatchObject({
      desfecho: "falhou",
      falha: "sem_mensagem",
      motivo: null,
    });
    expect(t5.statusDaConversa).toBe("ia_atendendo");
    expect(c.estado).toEqual(estadoAntes);
    expect(c.consultas).toEqual([]);
    expect(c.temJobPendente).toBe(true);

    // O job seguinte le o "sim" e a mensagem nova, e a pessoa quer quinta.
    const trocou =
      "Troquei para quinta. Confirma a Consulta com a Dra. Ana Lima na quinta, 22/10 às 14:00, na unidade Centro, no particular?";
    const t6 = await c.rodarOJobPendente({
      roteiro: [
        ferramenta(
          "buscar_horario",
          busca({ a_partir_de: "2026-10-22", hora: "14:00" }),
        ),
        ferramenta("reservar_horario", { horario: "h6" }),
        final(trocou),
      ],
    });
    respondeu(t6, trocou);
    expect(
      c.executor.linhas("ai_turno").find((l) => l.job_id === t6.job)
        ?.mensagens_lidas,
    ).toHaveLength(2);
    expect(t6.estado.slot_hold_id).not.toBe(reserva);
    expect(t6.estado.etapa).toBe("aguardando_confirmacao");
    expect(c.temJobPendente).toBe(false);

    const marcou =
      "Pronto! Sua Consulta de quinta, 22/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.";
    const t7 = await c.fala(
      { texto: "Sim", roteiro: [ferramenta("agendar", {}), final(marcou)] },
      30_000,
    );
    respondeu(t7, marcou);
    expect(c.consultas).toEqual([
      expect.objectContaining({ starts_at: iso("2026-10-22", "14:00") }),
    ]);

    // O mesmo job de novo, como a fila faria: nada sai e nada marca outra vez.
    const t8 = await c.repetirOJob(t7);
    expect(t8.resultado).toEqual({ ok: true });
    expect(t8.chamadasAoModelo).toBe(0);
    expect(t8.enviadas).toEqual([]);
    expect(c.consultas).toHaveLength(1);

    const tchau = "Por nada! Qualquer coisa, é só chamar por aqui.";
    const t9 = await c.rajada(["Obrigada", "Até mais"], { roteiro: [final(tchau)] });
    respondeu(t9, tchau);
    expect(c.decisoes.filter((d) => d.desfecho === "respondeu")).toHaveLength(6);
  });

  it("a mensagem no meio do turno do cancelamento e da lista de espera: nada acontece, e o job seguinte lê as duas", async () => {
    const c = new ConversaLonga(contexto, { catalogo: CATALOGO_DA_AG5 });
    conversaDoTeste = c;
    const { c1 } = consultasDoContato(c.cenario.banco);
    const T1 = "Confirma o cancelamento da sua consulta de quinta, 22/10 às 14:00?";
    const pedido = await c.fala({
      texto: "Quero cancelar a de quinta",
      roteiro: [
        ferramenta("consultar_minhas_consultas", {}),
        ferramenta("pedir_cancelamento", { consulta: "c1" }),
      ],
    });
    respondeu(pedido, `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${T1}`);

    const t2 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
      durante: () => {
        c.escreve("Não, espera, deixa quieto");
      },
    });
    expect(t2.enviadas).toEqual([]);
    expect(oQueDecidiu(t2)).toMatchObject({
      desfecho: "falhou",
      falha: "sem_mensagem",
    });
    expect(c1.status).toBe("agendado");
    expect(c.estado).toMatchObject({
      pedido_pendente: "cancelar",
      falhas_seguidas: 0,
    });
    expect(c.temJobPendente).toBe(true);

    // O job seguinte le o "sim" e o "nao" juntos: nao e um sim claro.
    const t3 = await c.rodarOJobPendente({
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    respondeu(t3, T1);
    expect(c1.status).toBe("agendado");
    expect(t3.estado.falhas_seguidas).toBe(1);

    const continua = "Tudo bem, sua consulta continua marcada.";
    const t4 = await c.fala({
      texto: "Não",
      roteiro: [ferramenta("cancelar_consulta", {}), final(continua)],
    });
    respondeu(t4, continua);
    expect(c1.status).toBe("agendado");
    expect(t4.estado.pedido_pendente).toBeNull();

    // A lista de espera, com o mesmo caminho.
    const semNoite =
      "Não tenho horário à noite com a Dra. Ana Lima. Posso procurar de manhã ou à tarde, ou colocar você na lista de espera para à noite. O que prefere?";
    await c.fala({
      texto: "Queria limpeza de pele com a Dra. Ana, só à noite.",
      roteiro: [
        ferramenta(
          "buscar_horario",
          buscaDaLimpeza({ profissional: R_ANA, periodo: "noite" }),
        ),
        final(semNoite),
      ],
    });
    respondeu(
      await c.fala({
        texto: "Lista de espera. Segunda ou quarta.",
        roteiro: [
          ferramenta("pedir_lista_de_espera", {
            periodos: ["noite"],
            dias: ["segunda", "quarta"],
          }),
        ],
      }),
      T_E1_ANA_NOITE_SEG_QUA,
    );
    const t7 = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
      durante: () => {
        c.escreve("Melhor não, obrigada");
      },
    });
    expect(t7.enviadas).toEqual([]);
    expect(c.cenario.fila).toEqual([]);
    expect(c.temJobPendente).toBe(true);

    const t8 = await c.rodarOJobPendente({
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
    });
    respondeu(t8, T_E1_ANA_NOITE_SEG_QUA);
    expect(c.cenario.fila).toEqual([]);

    const semLista = "Tudo bem, não coloquei você na lista de espera.";
    const t9 = await c.fala({
      texto: "Não",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {}), final(semLista)],
    });
    respondeu(t9, semLista);
    expect(saidasDoTurno(t9)[0]).toMatchObject({
      resultado: "paciente_nao_quis",
    });
    expect(c.cenario.fila).toEqual([]);
  });

  it("o canal ocupado no turno que marca: a resposta sai depois, uma vez só, sem chamar o modelo de novo", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await comAPerguntaConfirmaNoAr(c);
    const marcou =
      "Pronto! Sua Consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.";
    c.canalOcupado = true;
    const t8 = await c.fala(
      { texto: "Sim", roteiro: [ferramenta("agendar", {}), final(marcou)] },
      20_000,
    );
    expect(t8.resultado).toMatchObject({ motivo: "canal_ocupado" });
    expect(t8.enviadas).toEqual([]);
    // Ja marcou, ja decidiu e ja gravou o estado; so o envio ficou para depois.
    expect(c.consultas).toHaveLength(1);
    expect(oQueDecidiu(t8).desfecho).toBe("respondeu");
    expect(t8.estado.etapa).toBe("pos_marcacao");

    const t9 = await c.repetirOJob(t8);
    expect(t9.resultado).toEqual({ ok: true });
    expect(t9.chamadasAoModelo).toBe(0);
    respondeu(t9, marcou);
    expect(c.consultas).toHaveLength(1);
    expect(c.decisoes.filter((d) => d.job_id === t8.job)).toHaveLength(1);
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(c.executor.linhas("ai_turno").find((l) => l.job_id === t8.job)).toMatchObject({
      estado: "enviado",
      texto: null,
    });

    // A fala seguinte segue normal: o "sim" ja foi respondido.
    const tchau = "Por nada! Qualquer coisa, é só chamar por aqui.";
    const t10 = await c.fala({ texto: "Obrigada", roteiro: [final(tchau)] });
    respondeu(t10, tchau);
    expect(
      (t10.corpos[0]?.input as { role: string; content: string }[]).at(-1)?.content,
    ).toBe("Obrigada");
  });

  it("mais de cinco mensagens sem resposta: nenhum modelo lê, e a conversa passa para a equipe", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await conversaEmAndamento(c);
    const t7 = await c.rajada(
      ["oi", "tem alguém aí", "?", "alô", "oi?", "preciso de ajuda"],
      {},
    );
    expect(oQueDecidiu(t7)).toMatchObject({
      desfecho: "escalou",
      motivo: "agente_pediu",
      gatilho: "mensagem_longa",
    });
    expect(t7.chamadasAoModelo).toBe(0);
    expect(t7.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    await nadaMaisSai(c, ["Sim", "oi"]);
    expect(c.consultas).toEqual([]);
  });

  it("o teto de respostas por hora da conversa: sem modelo, a frase e a equipe; a conversa não fica sem resposta", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    c.executor.linhas("ia_liberacao")[0]!.teto_respostas_por_conversa_hora = 6;
    await conversaEmAndamento(c);
    const t7 = await c.fala({ texto: "Nasci em 12/03/1985" });
    expect(oQueDecidiu(t7)).toMatchObject({
      desfecho: "escalou",
      motivo: "teto_de_respostas",
    });
    expect(t7.chamadasAoModelo).toBe(0);
    expect(t7.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    await nadaMaisSai(c, ["Sim", "oi"]);
    expect(c.consultas).toEqual([]);
  });
});

describe("11. a conversa que sai da IA por fora do que o paciente escreveu", () => {
  it("a autorização revogada no meio: sem modelo e sem frase; quem revogou não recebe mais nada", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await conversaEmAndamento(c);
    c.consentimento = false;
    const recebidas = c.recebidasPeloPaciente.length;
    const t7 = await c.fala({ texto: "Nasci em 12/03/1985" });
    expect(t7.chamadasAoModelo).toBe(0);
    expect(t7.enviadas).toEqual([]);
    expect(t7.statusDaConversa).toBe("aguardando_humano");
    expect(c.passagens).toHaveLength(1);
    await nadaMaisSai(c, ["Sim", "oi"]);
    expect(c.recebidasPeloPaciente).toHaveLength(recebidas);
    expect(c.consultas).toEqual([]);
  });

  it.each([
    [
      "com o 'sim' e o agendar",
      "Sim",
      () => [ferramenta("agendar", {})],
    ],
    [
      "com a resposta já escrita",
      "Quanto custa mesmo?",
      () => [final("Fico à disposição para o que precisar.")],
    ],
  ])(
    "alguém da equipe assume no meio do turno, %s: nada marca e nada sai, nem a frase",
    async (_nome, texto, roteiro) => {
      const c = new ConversaLonga(contexto, {
        catalogo: CADASTRO,
        duasUnidades: true,
      });
      conversaDoTeste = c;
      await comAPerguntaConfirmaNoAr(c);
      const recebidas = c.recebidasPeloPaciente.length;
      const t8 = await c.fala(
        {
          texto,
          roteiro: roteiro(),
          durante: () => {
            c.equipeAssume();
          },
        },
        20_000,
      );
      expect(oQueDecidiu(t8)).toMatchObject({
        desfecho: "falhou",
        falha: "liberacao_suspensa",
        motivo: null,
      });
      expect(t8.enviadas).toEqual([]);
      expect(t8.statusDaConversa).toBe("em_atendimento");
      expect(c.consultas).toEqual([]);
      await nadaMaisSai(c, ["Sim", "Confirmo", "oi"]);
      expect(c.recebidasPeloPaciente).toHaveLength(recebidas);
      expect(c.consultas).toEqual([]);
    },
  );
});

describe("12. duas frentes na mesma conversa e o efeito que já aconteceu", () => {
  const P_LIMPEZA_DO_CADASTRO = codigoDoProcedimento(CADASTRO, PROC.limpeza);
  /** Um minuto entre as falas: a reserva dura as cinco. */
  const UM_MINUTO_MS = 60_000;

  /**
   * Duas falas de conversa, a marcação da limpeza até o "Confirma", a T1 de
   * outra consulta e o "sim": a consulta cancela e a reserva fica.
   */
  async function cancelarNoMeioDaMarcacao(c: ConversaLonga) {
    const { c1, c2 } = consultasDoContato(c.cenario.banco);
    const oferta =
      "Tenho quarta, 21/10 às 08:00 com a Dra. Ana Lima na unidade Aldeota. Pode ser?";
    await c.fala({
      texto: "Quero marcar limpeza de pele de manhã",
      roteiro: [
        ferramenta(
          "buscar_horario",
          busca({ procedimento: P_LIMPEZA_DO_CADASTRO, periodo: "manha" }),
        ),
        final(oferta),
      ],
    });
    const reservou =
      "Reservei quarta, 21/10 às 08:00 com a Dra. Ana Lima, na unidade Aldeota, por 10 minutos. Para marcar, me envie seu nome completo e sua data de nascimento.";
    respondeu(
      await c.fala(
        {
          texto: "Pode",
          roteiro: [ferramenta("reservar_horario", { horario: "h1" }), final(reservou)],
        },
        UM_MINUTO_MS,
      ),
      reservou,
    );
    const confirma =
      "Obrigada! Confirma a Limpeza de pele com a Dra. Ana Lima na quarta, 21/10 às 08:00, na unidade Aldeota, no particular?";
    const t3 = await c.fala(
      {
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
      },
      UM_MINUTO_MS,
    );
    respondeu(t3, confirma);
    expect(t3.estado.etapa).toBe("aguardando_confirmacao");
    const reserva = t3.estado.slot_hold_id;

    // Antes de confirmar, cancela a outra: a T1.
    const T1 = "Confirma o cancelamento da sua consulta de quinta, 22/10 às 14:00?";
    const t4 = await c.fala(
      {
        texto: "Antes, preciso cancelar minha consulta de quinta",
        roteiro: [
          ferramenta("consultar_minhas_consultas", {}),
          ferramenta("pedir_cancelamento", { consulta: "c1" }),
        ],
      },
      UM_MINUTO_MS,
    );
    respondeu(t4, T1);
    expect(t4.estado).toMatchObject({
      etapa: "cancelar",
      pedido_pendente: "cancelar",
      appointment_id: C1,
      slot_hold_id: reserva,
    });

    const t5 = await c.fala(
      { texto: "Sim", roteiro: [ferramenta("cancelar_consulta", {})] },
      UM_MINUTO_MS,
    );
    respondeu(
      t5,
      "Tudo bem, sua consulta de 22/10 às 14:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.",
    );
    expect(c1.status).toBe("cancelado_paciente");
    expect(c2.status).toBe("agendado");
    // So o cancelamento: o "sim" nao marcou a limpeza.
    expect(c.cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
    expect(t5.estado.slot_hold_id).toBe(reserva);
    expect(c.reservasVivas).toHaveLength(1);
    return { c1, c2, reserva, confirma };
  }

  it("cancela outra consulta no meio de uma marcação: a reserva fica e a marcação termina, com a pergunta de novo", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const { c1, c2, reserva, confirma } = await cancelarNoMeioDaMarcacao(c);

    // Volta para a limpeza: a pergunta de novo e o "sim" marcam a reservada.
    const t6 = await c.fala(
      { texto: "E a limpeza de pele?", roteiro: [final(confirma)] },
      UM_MINUTO_MS,
    );
    respondeu(t6, confirma);
    expect(t6.estado).toMatchObject({
      etapa: "aguardando_confirmacao",
      slot_hold_id: reserva,
    });

    const marcou =
      "Pronto! Sua Limpeza de pele de quarta, 21/10 às 08:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.";
    const t7 = await c.fala(
      { texto: "Sim", roteiro: [ferramenta("agendar", {}), final(marcou)] },
      UM_MINUTO_MS,
    );
    respondeu(t7, marcou);
    expect(c.consultasVivas.map((a) => a.starts_at)).toEqual([
      iso("2026-10-27", "09:00"),
      iso("2026-10-21", "08:00"),
    ]);
    expect(c1.status).toBe("cancelado_paciente");
    expect(c2.status).toBe("agendado");

    const tchau = "Por nada! Qualquer coisa, é só chamar por aqui.";
    respondeu(await c.fala({ texto: "Obrigada", roteiro: [final(tchau)] }), tchau);
  });

  // achado: com uma marcacao em andamento, o cancelamento feito sai do estado
  // no mesmo turno (ehEstadoDoCancelamento exige a reserva vazia e nenhum
  // horario oferecido; fechar apaga o id): no turno seguinte a IA nao sabe mais
  // que cancelou, e a resposta VERDADEIRA ("sua consulta ... foi cancelada") e
  // barrada (acao_nao_executada) e a conversa cai para a equipe. Nada errado
  // chega ao paciente: ele recebe a frase fixa no lugar da resposta. Devia
  // passar, como passa sem a marcacao em andamento (cenario 2).
  it.fails("com a marcação em andamento, a resposta verdadeira sobre o cancelamento feito tem de passar", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const certo = "Claro, é só me dizer.";
    respondeu(
      await c.fala({ texto: "Oi, tudo bem?", roteiro: [final(certo)] }),
      `${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n${certo}`,
    );
    respondeu(await c.fala({ texto: "Queria umas informações", roteiro: [final(certo)] }), certo);
    await cancelarNoMeioDaMarcacao(c);
    const cancelada =
      "Sim, sua consulta de quinta, 22/10 às 14:00 foi cancelada.";
    respondeu(
      await c.fala(
        { texto: "Foi cancelada mesmo?", roteiro: [final(cancelada)] },
        UM_MINUTO_MS,
      ),
      cancelada,
    );
  });

  /** O efeito feito, com a resposta que não sai: a equipe tem de saber. */
  const verificadorForaDoAr: Verificador = async () => ({
    tipo: "falha",
    motivo: "timeout",
    modelo: null,
    uso: null,
    httpStatus: null,
  });

  it("a marcação feita com a resposta barrada: a consulta fica, o paciente recebe só a frase e a nota conta a consulta", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await comAPerguntaConfirmaNoAr(c);
    const doModelo =
      "Pronto! Sua Consulta de quarta, 21/10 às 14:00 ficou marcada. O resultado é garantido.";
    const t = await c.fala(
      { texto: "Sim", roteiro: [ferramenta("agendar", {}), final(doModelo)] },
      20_000,
    );
    expect(oQueDecidiu(t)).toMatchObject({
      desfecho: "bloqueou",
      regra: "promessa_resultado",
      camada: "regra",
    });
    expect(t.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(c.consultas).toHaveLength(1);
    expect(t.decisao?.tool_used).toBe("agendar");
    expect(t.estado).toMatchObject({
      etapa: "pos_marcacao",
      desfecho: "passou_para_equipe",
      appointment_id: c.consultas[0]?.id,
    });
    expect(c.notasInternas.at(-1)).toContain("Consulta marcada pelo assistente");
    await nadaMaisSai(c, ["Sim", "Está marcado?"]);
    expect(c.consultas).toHaveLength(1);
  });

  /** O cancelamento feito no turno em que a T2 não pode sair. */
  async function cancelarComOVerificadorForaDoAr(c: ConversaLonga) {
    await conversaEmAndamento(c);
    const { c1 } = consultasDoContato(c.cenario.banco);
    await c.fala(
      {
        texto: "Preciso cancelar minha consulta de quinta",
        roteiro: [
          ferramenta("consultar_minhas_consultas", {}),
          ferramenta("pedir_cancelamento", { consulta: "c1" }),
        ],
      },
      20_000,
    );
    const t = await c.fala(
      {
        texto: "Sim",
        roteiro: [ferramenta("cancelar_consulta", {})],
        verificador: verificadorForaDoAr,
      },
      20_000,
    );
    return { c1, t };
  }

  it("o cancelamento feito com o verificador fora do ar: a consulta fica cancelada e o paciente recebe só a frase", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const { c1, t } = await cancelarComOVerificadorForaDoAr(c);
    expect(oQueDecidiu(t)).toMatchObject({
      desfecho: "bloqueou",
      regra: "falha_verificador",
      camada: "falha",
    });
    expect(t.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(c1.status).toBe("cancelado_paciente");
    expect(t.decisao?.tool_used).toBe("cancelar_consulta");
    expect(trilhaDoTurno(t).join(" ")).toContain("Cancelou a consulta");
    await nadaMaisSai(c, ["Cancelou?", "Sim"]);
  });

  // achado: o cancelamento FEITO no turno e a T2 que nao sai (o filtro barrou
  // ou o verificador caiu): a nota da equipe diz "Pedido: cancelar a consulta
  // de quinta..." e "Parou em: a resposta não passou na conformidade", como se
  // o pedido estivesse em aberto. O paciente so recebeu a frase; quem atende
  // pode nao saber que a consulta ja saiu da agenda. Devia dizer "Consulta
  // cancelada pelo assistente nesta conversa" (notaDaPassagem volta no ramo do
  // pedido, antes da linha da cancelada; a passagem do turno SEGUINTE diz).
  it.fails("o cancelamento feito com a T2 barrada: a nota da equipe tem de dizer que cancelou", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await cancelarComOVerificadorForaDoAr(c);
    expect(c.notasInternas.at(-1)).toContain(
      "Consulta cancelada pelo assistente nesta conversa: quinta, 22/10 às 14:00.",
    );
  });

  it("a remarcação pedida com o verificador fora do ar: a nova fica pendente, a antiga de pé, e a nota conta o par", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const consulta = await marcarASexta(c);
    c.equipeAprova(consulta);
    const quando =
      "Sua Consulta está marcada para sexta, 30/10 às 14:00.";
    respondeu(
      await c.fala({ texto: "Qual é mesmo o horário?", roteiro: [final(quando)] }),
      quando,
    );
    await pedirARemarcacaoParaTerca(c);
    const t = await c.fala(
      {
        texto: "Confirmo",
        roteiro: [ferramenta("agendar", {})],
        verificador: verificadorForaDoAr,
      },
      20_000,
    );
    expect(oQueDecidiu(t)).toMatchObject({
      desfecho: "bloqueou",
      regra: "falha_verificador",
    });
    expect(t.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    const nova = c.consultas.find((a) => a.remarcacao_de === consulta.id);
    expect(nova).toMatchObject({ approval_status: "pendente" });
    expect(consulta.status).toBe("agendado");
    const nota = c.notasInternas.at(-1) ?? "";
    expect(nota).toContain("sexta, 30/10 às 14:00");
    expect(nota).toContain("terça, 03/11 às 08:00");
    await nadaMaisSai(c, ["Remarcou?"]);
  });

  it("a entrada na lista com o verificador fora do ar: a entrada fica, e a nota conta a lista", async () => {
    const c = new ConversaLonga(contexto, { catalogo: CATALOGO_DA_AG5 });
    conversaDoTeste = c;
    const preco = "A Limpeza de pele custa R$ 120,00 no particular, com a Dra. Ana Lima.";
    const buscarOPreco = () => [
      ferramenta("buscar_procedimento", {
        procedimento: P_LIMPEZA,
        convenio: null,
      }),
      final(preco),
    ];
    for (const texto of [
      "Quanto custa a limpeza de pele?",
      "Quanto custa mesmo?",
      "Desculpa, quanto era?",
      "Certo, e o valor é esse mesmo?",
    ]) {
      await c.fala({ texto, roteiro: buscarOPreco() });
    }
    const semNoite =
      "Não tenho horário à noite com a Dra. Ana Lima. Posso procurar de manhã ou à tarde, ou colocar você na lista de espera para à noite. O que prefere?";
    await c.fala({
      texto: "Queria com a Dra. Ana, só à noite.",
      roteiro: [
        ferramenta(
          "buscar_horario",
          buscaDaLimpeza({ profissional: R_ANA, periodo: "noite" }),
        ),
        final(semNoite),
      ],
    });
    respondeu(
      await c.fala({
        texto: "Lista de espera. Segunda ou quarta.",
        roteiro: [
          ferramenta("pedir_lista_de_espera", {
            periodos: ["noite"],
            dias: ["segunda", "quarta"],
          }),
        ],
      }),
      T_E1_ANA_NOITE_SEG_QUA,
    );
    const t = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("entrar_na_lista_de_espera", {})],
      verificador: verificadorForaDoAr,
    });
    expect(oQueDecidiu(t)).toMatchObject({
      desfecho: "bloqueou",
      regra: "falha_verificador",
    });
    expect(t.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(c.cenario.fila).toHaveLength(1);
    expect(c.notasInternas.at(-1)).toContain("lista de espera");
    await nadaMaisSai(c, ["Entrei?"]);
  });

  it("a conversa que passa de 20 mensagens: o modelo lê só as últimas, a saudação e o aviso não voltam, e o estado continua inteiro", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
      config: configPublicada({ saudacao: "Olá! Que bom falar com você." }),
    });
    conversaDoTeste = c;
    const consulta = await marcarASexta(
      c,
      `Olá! Que bom falar com você.\n\n${FRASE_DO_ASSISTENTE_VIRTUAL}\n\n`,
    );
    const voltas = [
      "Qual é mesmo o horário?",
      "E é sexta mesmo?",
      "Às 14h, certo?",
      "Com a Dra. Ana?",
      "Pendente da equipe?",
      "Desculpa, sou esquecida",
      "Me diz de novo o horário",
      "Sexta, né?",
    ];
    const quando =
      "Sua Consulta está marcada para sexta, 30/10 às 14:00, pendente da aprovação da equipe.";
    for (const texto of voltas) {
      const t = await c.fala({ texto, roteiro: [final(quando)] });
      respondeu(t, quando);
      expect(t.estado).toMatchObject({
        etapa: "pos_marcacao",
        appointment_id: consulta.id,
      });
    }
    // 12 falas e 12 respostas: o modelo le as 20 ultimas e a pendente no fim.
    const ultimo = c.turnos.at(-1)!;
    const input = ultimo.corpos[0]?.input as { role: string; content: string }[];
    expect(input).toHaveLength(20);
    expect(input.at(-1)?.content).toBe("Sexta, né?");
    expect(
      c.recebidasPeloPaciente.filter((m) => m.includes("Que bom falar com você")),
    ).toHaveLength(1);

    // Dali em diante, cancelar vale como sempre: as ancoras leem o banco.
    const T1 = "Confirma o cancelamento da sua consulta de sexta, 30/10 às 14:00?";
    respondeu(
      await c.fala({
        texto: "Quero cancelar minha consulta",
        roteiro: [
          ferramenta("consultar_minhas_consultas", {}),
          ferramenta("pedir_cancelamento", { consulta: "c1" }),
        ],
      }),
      T1,
    );
    const cancelou = await c.fala({
      texto: "Sim",
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    respondeu(
      cancelou,
      "Tudo bem, sua consulta de 30/10 às 14:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.",
    );
    expect(consulta.status).toBe("cancelado_paciente");
  });
});

describe("13. áudio e foto no meio da conversa", () => {
  const CONFIRMA =
    "Obrigada! Confirma a Consulta com a Dra. Ana Lima na sexta, 30/10 às 14:00, na unidade Centro, no particular?";

  /** A marcação inteira falada: a escolha, os dados e o "sim". */
  async function marcarFalando(c: ConversaLonga) {
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
    const t2 = await c.audio("Pode ser às catorze horas", {
      roteiro: [ferramenta("reservar_horario", { horario: "h1" }), final(reservou)],
    });
    respondeu(t2, reservou);
    // O modelo le a transcricao marcada como audio, com o nome mascarado.
    expect(
      (t2.corpos[0]?.input as { role: string; content: string }[]).at(-1)?.content,
    ).toBe(`${PREFIXO_DO_AUDIO} Pode ser às catorze horas`);

    const t3 = await c.audio("Maria da Silva Souza, nascida em 12/03/1985", {
      roteiro: [
        ferramenta("registrar_dados_do_paciente", {
          nome_completo: "Fulano da Silva Souza",
          data_nascimento: "1985-03-12",
          para_o_titular: true,
          campos_mascarados: [],
        }),
        final(CONFIRMA),
      ],
    });
    respondeu(t3, CONFIRMA);
    expect(t3.estado.etapa).toBe("aguardando_confirmacao");
    expect(c.dados).toMatchObject({
      nome_completo: true,
      data_nascimento: true,
      faltam: [],
    });

    const marcou =
      "Pronto! Sua Consulta de sexta, 30/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe.";
    const t4 = await c.audio("sim", {
      roteiro: [ferramenta("agendar", {}), final(marcou)],
    });
    respondeu(t4, marcou);
    expect(c.consultas).toHaveLength(1);
    return c.consultas[0]!;
  }

  it("a marcação falada, o pedido lido na foto e o sinal de emergência falado: o portão lê a transcrição", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const consulta = await marcarFalando(c);
    expect(c.executor.linhas("ia_leitura_da_midia")).toHaveLength(3);

    // A foto de um pedido com um procedimento do Cadastro: o modelo le so a
    // descricao do servidor.
    const P_EXAME = codigoDoProcedimento(CADASTRO, PROC.exame);
    const pedido = "No pedido que você mandou, vi Exame. É isso mesmo?";
    const t5 = await c.foto(
      {
        tipo: "pedido_de_exame_ou_procedimento",
        procedimentos: [PROC.exame],
        codigos: [P_EXAME],
        foraDoCadastro: 0,
        confianca: "alta",
      },
      { roteiro: [final(pedido)] },
    );
    respondeu(t5, pedido);
    expect(
      (t5.corpos[0]?.input as { role: string; content: string }[]).at(-1)?.content,
    ).toContain("Exame");

    const certo = "Certo. Qualquer coisa, é só chamar por aqui.";
    respondeu(await c.fala({ texto: "Isso, depois eu vejo", roteiro: [final(certo)] }), certo);
    respondeu(await c.fala({ texto: "Obrigada", roteiro: [final(certo)] }), certo);

    // O sinal de emergencia falado: passa como urgente, sem o agente.
    const t8 = await c.audio("estou com dor no peito e falta de ar");
    expect(oQueDecidiu(t8)).toEqual({
      desfecho: "escalou",
      regra: null,
      motivo: "urgencia",
      falha: null,
      gatilho: "urgencia",
      camada: null,
    });
    expect(t8.chamadasAoModelo).toBe(0);
    expect(t8.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(c.executor.linhas("conversa_urgente")).toHaveLength(1);

    // Depois da passagem, nem o audio nem a foto chamam modelo nenhum.
    await nadaMaisSai(c, ["alô?", "Sim"]);
    const t11 = await c.audio("sim, confirmo");
    expect(t11.chamadasAoModelo).toBe(0);
    expect(t11.enviadas).toEqual([]);
    expect(consulta.status).toBe("agendado");
  });

  it("o 'sim' falado cancela depois da pergunta; o áudio sem fala e a foto clínica passam para a equipe, sem o agente", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    const consulta = await marcarFalando(c);
    c.equipeAprova(consulta);

    const T1 = "Confirma o cancelamento da sua consulta de sexta, 30/10 às 14:00?";
    respondeu(
      await c.fala({
        texto: "Quero cancelar",
        roteiro: [
          ferramenta("consultar_minhas_consultas", {}),
          ferramenta("pedir_cancelamento", { consulta: "c1" }),
        ],
      }),
      T1,
    );
    // O audio de um "nao" nao cancela.
    const continua = "Tudo bem, sua consulta continua marcada.";
    const t6 = await c.audio("não, deixa", {
      roteiro: [ferramenta("cancelar_consulta", {}), final(continua)],
    });
    respondeu(t6, continua);
    expect(consulta.status).toBe("agendado");

    respondeu(
      await c.fala({
        texto: "Pensando bem, quero cancelar sim",
        roteiro: [
          ferramenta("consultar_minhas_consultas", {}),
          ferramenta("pedir_cancelamento", { consulta: "c1" }),
        ],
      }),
      T1,
    );
    const t8 = await c.audio("sim", {
      roteiro: [ferramenta("cancelar_consulta", {})],
    });
    respondeu(
      t8,
      "Tudo bem, sua consulta de 30/10 às 14:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.",
    );
    expect(consulta.status).toBe("cancelado_paciente");

    // A foto de um documento clinico: o leitor identificou, e a conversa passa.
    const t9 = await c.foto({
      tipo: "documento_clinico",
      procedimentos: [],
      codigos: [],
      foraDoCadastro: 0,
      confianca: "alta",
    });
    expect(t9.chamadasAoModelo).toBe(0);
    expect(t9.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    expect(oQueDecidiu(t9).desfecho).toBe("escalou");
    expect(t9.statusDaConversa).toBe("aguardando_humano");
    await nadaMaisSai(c, ["Sim"]);
  });

  it("o áudio sem fala no meio da marcação: nada é reservado nem marcado, e a conversa passa como mídia", async () => {
    const c = new ConversaLonga(contexto, {
      catalogo: CADASTRO,
      duasUnidades: true,
    });
    conversaDoTeste = c;
    await conversaEmAndamento(c);
    const t7 = await c.audio(null);
    expect(oQueDecidiu(t7)).toMatchObject({
      desfecho: "escalou",
      motivo: "midia_nao_suportada",
      gatilho: "midia",
    });
    expect(t7.chamadasAoModelo).toBe(0);
    expect(t7.enviadas).toEqual([FRASE_DE_ESCALONAMENTO]);
    await nadaMaisSai(c, ["Sim", "Nasci em 12/03/1985"]);
    expect(c.consultas).toEqual([]);
  });
});
