import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dadosVazios, estadoVazio } from "@/lib/agente/atendimento";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";

import {
  C1,
  C2,
  CenarioDaAg4,
  configDaAg4,
  consultasDoContato,
  ferramenta,
  final,
  saidas,
} from "./ag4-conversa";
import { consultaDoContato } from "./ag4-contrato";
import { iso, PROF, VINC } from "./agenda-fixtures";
import { UNID } from "./cadastro-fixtures";

// AG4: remarcar pela IA (D-10), em conversas de varias falas com o LLM falso
// sobre o contrato das RPCs em memoria. buscar_horario_para_remarcar fixa a
// consulta em foco e busca com o procedimento, o profissional e o pagamento
// dela (do servidor; ao modelo, so dia, hora e unidade, D-13);
// reservar_horario no modo de remarcacao devolve a pergunta fixa (T3), que
// arma "aguardando_confirmacao"; agendar cria a consulta NOVA pendente,
// ligada a antiga, que continua marcada, e o sistema responde (T4). Nenhum
// teste fala com a OpenAI nem com o banco.

const BUSCA_DA_SEMANA_QUE_VEM = {
  consulta: "c1",
  a_partir_de: "2026-10-26",
  periodo: "manha",
  hora: null,
  unidade: null,
};
const T3_SEGUNDA =
  "Reservei segunda, 26/10 às 08:00, na unidade Aldeota, por 10 minutos. Confirma a remarcação da sua consulta de quinta, 22/10 às 14:00 para segunda, 26/10 às 08:00?";
const T4_SEGUNDA =
  "Pronto, pedi a remarcação para segunda, 26/10 às 08:00. Até a equipe aprovar, sua consulta de quinta, 22/10 às 14:00 continua marcada. A confirmação chega por aqui.";

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** O bloco <atendimento_em_andamento> das instrucoes de uma chamada. */
function blocoDoEstado(instrucoes: string): string {
  return (
    instrucoes
      .split("\n<atendimento_em_andamento>\n")[1]
      ?.split("\n</atendimento_em_andamento>")[0] ?? ""
  );
}

/**
 * Revisao da AG4 (achado 4): o codigo c1..c5 so vale na resposta em que
 * consultar_minhas_consultas rodou. Toda busca pelo codigo lista antes.
 */
const LISTAR = () => ferramenta("consultar_minhas_consultas", {});

/** Ate a pergunta da remarcacao (T3): a busca e a reserva de segunda. */
async function ateAPerguntaDaRemarcacao(cenario: CenarioDaAg4) {
  const r1 = await cenario.fala({
    texto: "Quero remarcar a de quinta para a semana que vem, de manhã",
    roteiro: [
      LISTAR(),
      ferramenta("buscar_horario_para_remarcar", BUSCA_DA_SEMANA_QUE_VEM),
      final(
        "Tenho segunda, 26/10 às 08:00 e terça, 27/10 às 08:00, na unidade Aldeota. Qual fica melhor?",
      ),
    ],
  });
  const r2 = await cenario.fala({
    texto: "Segunda às 8",
    roteiro: [ferramenta("reservar_horario", { horario: "h1" })],
  });
  return { r1, r2 };
}

describe("remarcar: o caminho feliz", () => {
  it("a busca com o mesmo profissional, a pergunta fixa (T3) e a consulta nova pendente (T4); a antiga continua", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    const { r1, r2 } = await ateAPerguntaDaRemarcacao(cenario);

    // A busca: so dia, hora e unidade (a clinica tem duas), e o aviso de
    // que o profissional e o mesmo; nada do procedimento nem do pagamento.
    expect(r1.tipo).toBe("resposta");
    expect(saidas(cenario.corpos[2])[1]).toEqual({
      resultado: "horarios",
      mesmo_profissional: true,
      consulta: { dia: "quinta, 22/10", hora: "14:00" },
      horarios: [
        {
          codigo: "h1",
          dia: "segunda, 26/10",
          hora: "08:00",
          unidade: "Aldeota",
          unidade_codigo: "u1",
        },
        {
          codigo: "h2",
          dia: "terça, 27/10",
          hora: "08:00",
          unidade: "Aldeota",
          unidade_codigo: "u1",
        },
        {
          codigo: "h3",
          dia: "quarta, 28/10",
          hora: "08:00",
          unidade: "Aldeota",
          unidade_codigo: "u1",
        },
        {
          codigo: "h4",
          dia: "quinta, 29/10",
          hora: "08:00",
          unidade: "Aldeota",
          unidade_codigo: "u1",
        },
      ],
    });
    expect(JSON.stringify(saidas(cenario.corpos[2]))).not.toMatch(
      /Ana|Consulta"|particular|convenio/,
    );
    expect(r1.atendimento?.estado).toMatchObject({
      etapa: "oferta",
      intencao: "remarcar",
      pedido_pendente: "remarcar",
      appointment_id: C1,
      procedure_id: null,
      professional_id: null,
    });

    // O bloco do estado: o pedido e os horarios, sem nomes (D-13).
    const bloco = blocoDoEstado(cenario.instrucoesDaChamada(3));
    expect(bloco).toContain(
      "Passo: horários oferecidos para a remarcação, esperando a escolha da pessoa.",
    );
    expect(bloco).toContain(
      "Remarcando a consulta de quinta, 22/10 às 14:00, com o mesmo profissional, o mesmo procedimento e o mesmo pagamento.",
    );
    expect(bloco).toContain(
      "- h1: segunda, 26/10 às 08:00, unidade [u1] Aldeota: livre agora.",
    );
    expect(bloco).not.toMatch(/Ana|Consulta|particular|Dados/);

    // A reserva da remarcacao: p_remarcar e a pergunta fixa (T3).
    expect(cenario.banco.chamadasDe("reservar_horario_da_ia")).toEqual([
      expect.objectContaining({
        p_service_link_id: VINC.consultaAna,
        p_starts_at: iso("2026-10-26", "08:00"),
        p_unit_id: UNID.aldeota,
        p_remarcar: C1,
        p_job_id: cenario.jobs[1],
      }),
    ]);
    expect(r2.tipo).toBe("resposta");
    expect(r2.resposta).toBe(T3_SEGUNDA);
    expect(cenario.corpos).toHaveLength(4);
    expect(cenario.estado).toMatchObject({
      etapa: "aguardando_confirmacao",
      pedido_pendente: "remarcar",
      appointment_id: C1,
      slot_hold_id: cenario.banco.linhas("slot_hold")[0]?.id,
    });

    // O "Confirmo" numa mensagem nova: a consulta nova pendente, ligada.
    const r3 = await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([
      expect.objectContaining({
        p_remarcar: C1,
        p_slot_hold_id: cenario.banco.linhas("slot_hold")[0]?.id,
        p_job_id: cenario.jobs[2],
      }),
    ]);
    expect(r3.tipo).toBe("resposta");
    expect(r3.resposta).toBe(T4_SEGUNDA);
    const nova = cenario.banco
      .linhas("appointment")
      .find((a) => a.remarcacao_de === C1);
    expect(nova).toMatchObject({
      approval_status: "pendente",
      created_by: "ia",
      starts_at: iso("2026-10-26", "08:00"),
    });
    // A antiga continua de pe, com a marca do pedido.
    expect(c1.status).toBe("agendado");
    expect(c1.remarcacao_pedida_em).toBeTruthy();
    expect(cenario.estado).toMatchObject({
      etapa: "pos_marcacao",
      intencao: "remarcar",
      pedido_pendente: null,
      pedido_pendente_em: null,
      appointment_id: nova?.id,
      slot_hold_id: null,
      horarios_oferecidos: [],
      desfecho: "remarcou",
    });
    // O resumo do verificador: pendente, e a antiga continua marcada.
    expect(cenario.verificacao.pedidos.at(-1)?.resumoDosFatos).toContain(
      "pediu a remarcação para segunda, 26/10 às 08:00, unidade Aldeota, pendente da aprovação da equipe; a consulta de quinta, 22/10 às 14:00, unidade Centro continua marcada até lá",
    );

    // Depois: dizer que ja remarcou sem a pendencia barra; com ela, passa.
    const sem = await cenario.fala({
      texto: "Já está remarcada?",
      roteiro: [
        final("Sua consulta foi remarcada para segunda, 26/10 às 08:00."),
      ],
    });
    expect(sem.tipo).toBe("frase_fixa");
    expect(sem.desfecho).toMatchObject({
      tipo: "bloqueou",
      categoria: "acao_nao_executada",
      camada: "regra",
    });
    expect(blocoDoEstado(cenario.instrucoesDaChamada(5))).toContain(
      "Remarcação pedida nesta conversa: de quinta, 22/10 às 14:00 para segunda, 26/10 às 08:00, pendente da aprovação da equipe; a consulta de antes continua marcada até lá.",
    );
  });

  it("depois de remarcar, a resposta que diz a pendência passa (a nova e a antiga relidas)", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    const r = await cenario.fala({
      texto: "Então já está certo?",
      roteiro: [
        final(
          "Sua remarcação para segunda, 26/10 às 08:00 está pendente da aprovação da equipe, e a consulta de quinta, 22/10 às 14:00 continua marcada até lá.",
        ),
      ],
    });
    expect(r.tipo).toBe("resposta");
    expect(cenario.verificacao.pedidos.at(-1)?.resumoDosFatos).toContain(
      "segunda, 26/10 às 08:00, unidade Aldeota (remarcação pedida pela assistente nesta conversa, pendente da aprovação da equipe)",
    );
  });
});

describe("remarcar: o que fica com a equipe e as recusas", () => {
  it("consulta ainda pendente da equipe não remarca pela IA (D-26)", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    const r = await cenario.fala({
      texto: "Quero remarcar a de terça",
      roteiro: [
        LISTAR(),
        ferramenta("buscar_horario_para_remarcar", {
          ...BUSCA_DA_SEMANA_QUE_VEM,
          consulta: "c2",
        }),
      ],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.desfecho).toMatchObject({
      motivo: "pedido_de_agenda",
      origem: "ferramenta",
    });
    expect(r.notaParaAEquipe).toContain(
      "Pedido: remarcar a consulta de terça, 27/10 às 09:00 (Consulta, Dra. Ana Lima).",
    );
  });

  it("dentro do prazo da clínica: fora_do_prazo, com o prazo de remarcar na nota", async () => {
    const cenario = new CenarioDaAg4({
      config: configDaAg4({ prazos: { cancelarHoras: 24, remarcarHoras: 72 } }),
    });
    consultasDoContato(cenario.banco);
    const r = await cenario.fala({
      texto: "Quero remarcar a de quinta",
      roteiro: [
        LISTAR(),
        ferramenta("buscar_horario_para_remarcar", BUSCA_DA_SEMANA_QUE_VEM),
      ],
    });
    expect(r.desfecho).toMatchObject({
      motivo: "fora_do_prazo",
      origem: "ferramenta",
    });
    expect(r.notaParaAEquipe).toContain(
      "Parou em: o pedido ficou dentro do prazo da clínica para o assistente remarcar (72 horas).",
    );
  });

  it("a reserva de 10 minutos venceu: o agendar recusa e o modelo oferece de novo", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    cenario.agora += 11 * 60_000;
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        final(
          "O horário que eu tinha reservado não está mais garantido. Quer que eu veja de novo?",
        ),
      ],
    });
    expect(saidas(cenario.corpos[5])[0]).toEqual({
      resultado: "reserva_vencida",
    });
    expect(
      cenario.banco.linhas("appointment").some((a) => a.remarcacao_de === C1),
    ).toBe(false);
    // O foco continua (a pessoa ainda quer remarcar).
    expect(r.atendimento?.estado).toMatchObject({
      pedido_pendente: "remarcar",
      appointment_id: C1,
    });
  });

  it("a consulta mudou depois da reserva: o modelo reserva de novo e o sistema pergunta outra vez", async () => {
    const cenario = new CenarioDaAg4();
    const { c1 } = consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    c1.remarcada_em = new Date(cenario.agora + 60_000).toISOString();
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [
        ferramenta("agendar", {}),
        ferramenta("reservar_horario", { horario: "h1" }),
      ],
    });
    expect(saidas(cenario.corpos[5])[0]).toEqual({
      resultado: "consulta_mudou",
    });
    // O pedido nao desarma: reservar de novo resolve (a ancora e a reserva).
    expect(r.resposta).toBe(T3_SEGUNDA);
    expect(cenario.estado.etapa).toBe("aguardando_confirmacao");
  });

  it("o agendar sem a pergunta T3 no turno anterior é recusado sem RPC", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await cenario.fala({
      texto: "Quero remarcar a de quinta",
      roteiro: [
        LISTAR(),
        ferramenta("buscar_horario_para_remarcar", BUSCA_DA_SEMANA_QUE_VEM),
        final("Tenho segunda, 26/10 às 08:00. Pode ser?"),
      ],
    });
    // O modelo pergunta ele mesmo "Confirma ...?": nada armado.
    const r2 = await cenario.fala({
      texto: "Segunda",
      roteiro: [
        final(
          "Confirma a remarcação da sua consulta de quinta, 22/10 às 14:00 para segunda, 26/10 às 08:00?",
        ),
      ],
    });
    expect(r2.atendimento?.estado.etapa).toBe("oferta");
    await cenario.fala({
      texto: "Sim",
      roteiro: [
        ferramenta("agendar", {}),
        final("Vou reservar o horário primeiro."),
      ],
    });
    expect(saidas(cenario.corpos[5])[0]).toEqual({
      resultado: "sem_confirmacao_do_paciente",
    });
    expect(cenario.banco.chamadasDe("agendar_pela_ia")).toEqual([]);
  });

  it("o horário da remarcação de outro profissional: horario_fora_da_remarcacao, sem RPC", async () => {
    const cenario = new CenarioDaAg4({
      atendimento: {
        estado: {
          ...estadoVazio(),
          etapa: "oferta",
          intencao: "remarcar",
          pedido_pendente: "remarcar",
          pedido_pendente_em: "2026-10-20T11:58:00.000Z",
          appointment_id: C1,
          horarios_oferecidos: [
            {
              codigo: "h1",
              service_link_id: VINC.consultaBruno,
              professional_id: PROF.bruno,
              unit_id: null,
              starts_at: iso("2026-10-27", "13:00"),
              ends_at: iso("2026-10-27", "13:30"),
              oferecido_em: "2026-10-20T11:58:00.000Z",
            },
          ],
        },
        dados: dadosVazios(),
      },
    });
    consultasDoContato(cenario.banco);
    await cenario.fala({
      texto: "Pode ser terça às 13h",
      roteiro: [
        ferramenta("reservar_horario", { horario: "h1" }),
        final(
          "Esse horário não é com a mesma profissional. Quer que eu veja outros?",
        ),
      ],
    });
    expect(saidas(cenario.corpos[1])[0]).toEqual({
      resultado: "horario_fora_da_remarcacao",
    });
    expect(cenario.banco.chamadasDe("reservar_horario_da_ia")).toEqual([]);
    expect(cenario.estado.falhas_seguidas).toBe(1);
  });

  it("buscar_horario (marcar consulta nova) no meio da remarcação tira o pedido de remarcar", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await cenario.fala({
      texto: "Quero remarcar a de quinta",
      roteiro: [
        LISTAR(),
        ferramenta("buscar_horario_para_remarcar", BUSCA_DA_SEMANA_QUE_VEM),
        final("Tenho segunda, 26/10 às 08:00. Pode ser?"),
      ],
    });
    expect(cenario.estado.pedido_pendente).toBe("remarcar");
    await cenario.fala({
      texto: "Na verdade quero marcar outra consulta, para o mês que vem",
      roteiro: [
        ferramenta("buscar_horario", {
          procedimento: "p1",
          profissional: null,
          convenio: null,
          a_partir_de: null,
          periodo: null,
          unidade: null,
          hora: null,
        }),
        final("Certo. Para quando você prefere a consulta nova?"),
      ],
    });
    expect(cenario.estado).toMatchObject({
      pedido_pendente: null,
      appointment_id: null,
      intencao: "agendar",
    });
  });

  it("a remarcação já pedida por outra conversa: a equipe (remarcacao_pendente)", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    cenario.banco.inserir(
      "appointment",
      consultaDoContato({
        inicio: iso("2026-10-29", "15:00"),
        fim: iso("2026-10-29", "15:30"),
        vinculo: VINC.consultaAna,
        profissional: PROF.ana,
        aprovacao: "pendente",
        remarcacaoDe: C1,
        criadaPor: "ia",
      }),
    );
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.desfecho).toMatchObject({ motivo: "pedido_de_agenda" });
  });

  it("menor de idade no agendar da remarcação: a equipe (D-8)", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await ateAPerguntaDaRemarcacao(cenario);
    cenario.opcoes.forcar = { agendar: "menor_de_idade" };
    const r = await cenario.fala({
      texto: "Confirmo",
      roteiro: [ferramenta("agendar", {})],
    });
    expect(r.desfecho).toMatchObject({
      motivo: "menor_de_idade",
      origem: "ferramenta",
    });
  });

  it("sem remarcar ligada (sem o prazo, ou sem Agendar consulta): a ferramenta não vai ao modelo", async () => {
    for (const config of [
      configDaAg4({ prazos: { cancelarHoras: 24, remarcarHoras: null } }),
      configDaAg4({
        habilidades: {
          ...configDaAg4().habilidades,
          agendar: false,
        },
      }),
    ]) {
      const cenario = new CenarioDaAg4({ config });
      await cenario.fala({
        texto: "Quero remarcar",
        roteiro: [final("Certo. Para quando você quer remarcar?")],
      });
      const nomes = (cenario.corpos[0]?.tools as { name: string }[]).map(
        (f) => f.name,
      );
      expect(nomes).not.toContain("buscar_horario_para_remarcar");
      expect(cenario.instrucoesDaChamada(0)).toContain(
        'Remarcar consulta: desligado. Se o paciente quiser remarcar uma consulta, passe para a equipe com o motivo "pedido_de_agenda".',
      );
    }
  });

  it("busca sem a consulta e sem foco: sem_consulta_para_remarcar (falha)", async () => {
    const cenario = new CenarioDaAg4();
    consultasDoContato(cenario.banco);
    await cenario.fala({
      texto: "Quero remarcar",
      roteiro: [
        ferramenta("buscar_horario_para_remarcar", {
          ...BUSCA_DA_SEMANA_QUE_VEM,
          consulta: null,
        }),
        final("Qual consulta você quer remarcar?"),
      ],
    });
    expect(saidas(cenario.corpos[1])[0]).toEqual({
      resultado: "sem_consulta_para_remarcar",
    });
    expect(cenario.estado.falhas_seguidas).toBe(1);
    expect(cenario.estado.pedido_pendente).toBeNull();
    // A consulta C2 nem foi tocada.
    expect(
      cenario.banco.linhas("appointment").find((a) => a.id === C2)?.status,
    ).toBe("agendado");
  });
});
