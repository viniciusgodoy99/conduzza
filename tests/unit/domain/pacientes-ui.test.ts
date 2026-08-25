import { describe, expect, it } from "vitest";

import {
  agregadosDeConsultas,
  etiquetasDoPaciente,
  filtrarPacientes,
  indicadoresDe,
  pacoteVencido,
  porcentagemDeComparecimento,
  saldoDeSessoes,
  sessoesRestantes,
  type ConsultaAgregavel,
  type PacienteFiltravel,
} from "@/lib/domain/pacientes-ui";

// Aceite da Tela 9: filtros da barra, indicadores dos cartoes, etiquetas
// derivadas e saldo de pacote. O filtro "Com falta" comeca em 1 falta; a
// etiqueta "Risco de falta" so em 2 (etiquetas.ts). Sao regras diferentes.

const DIA_MS = 24 * 60 * 60 * 1000;
const agora = new Date("2026-08-25T12:00:00Z");

function haDias(dias: number): string {
  return new Date(agora.getTime() - dias * DIA_MS).toISOString();
}

function paciente(parcial: Partial<PacienteFiltravel>): PacienteFiltravel {
  return {
    total_faltou: 0,
    ultima_consulta: haDias(10),
    proxima_consulta: null,
    saldo_sessoes: 0,
    insurance_id: null,
    profissionais_ids: [],
    ...parcial,
  };
}

describe("filtrarPacientes", () => {
  it("sem filtro nenhum devolve a lista inteira", () => {
    const lista = [paciente({}), paciente({ total_faltou: 5 })];
    expect(filtrarPacientes(lista, {}, agora)).toEqual(lista);
  });

  it("comFalta usa total_faltou, nao no_show_count", () => {
    const semFalta = paciente({ total_faltou: 0 });
    const duas = paciente({ total_faltou: 2 });
    expect(
      filtrarPacientes([semFalta, duas], { comFalta: true }, agora),
    ).toEqual([duas]);
  });

  it("uma falta entra no filtro, mas nao ganha a etiqueta de risco", () => {
    const uma = paciente({ total_faltou: 1 });
    expect(filtrarPacientes([uma], { comFalta: true }, agora)).toEqual([uma]);
    expect(etiquetasDoPaciente(uma, agora)).toEqual([]);
  });

  it("duas faltas entram no filtro e ganham a etiqueta de risco", () => {
    const duas = paciente({ total_faltou: 2 });
    expect(filtrarPacientes([duas], { comFalta: true }, agora)).toEqual([duas]);
    expect(etiquetasDoPaciente(duas, agora)).toEqual(["risco_de_falta"]);
  });

  it("zero falta fica de fora do filtro", () => {
    expect(
      filtrarPacientes(
        [paciente({ total_faltou: 0 })],
        { comFalta: true },
        agora,
      ),
    ).toEqual([]);
  });

  it("inativos: exatos 90 dias NAO entra, um ms alem entra", () => {
    const exatos90 = paciente({ ultima_consulta: haDias(90) });
    expect(filtrarPacientes([exatos90], { inativos: true }, agora)).toEqual([]);
    const passou = paciente({
      ultima_consulta: new Date(
        agora.getTime() - 90 * DIA_MS - 1,
      ).toISOString(),
    });
    expect(filtrarPacientes([passou], { inativos: true }, agora)).toHaveLength(
      1,
    );
  });

  it("consulta futura tira o paciente do filtro de inativos", () => {
    const some = paciente({
      ultima_consulta: haDias(400),
      proxima_consulta: new Date(agora.getTime() + DIA_MS).toISOString(),
    });
    expect(filtrarPacientes([some], { inativos: true }, agora)).toEqual([]);
  });

  it("paciente sem consulta nenhuma nao conta como inativo", () => {
    const semHistorico = paciente({ ultima_consulta: null });
    expect(filtrarPacientes([semHistorico], { inativos: true }, agora)).toEqual(
      [],
    );
  });

  it("comPacote exige saldo maior que zero", () => {
    const zerado = paciente({ saldo_sessoes: 0 });
    const comSaldo = paciente({ saldo_sessoes: 3 });
    expect(
      filtrarPacientes([zerado, comSaldo], { comPacote: true }, agora),
    ).toEqual([comSaldo]);
  });

  it("convenio compara o id e ignora quem e particular", () => {
    const unimed = paciente({ insurance_id: "conv-1" });
    const particular = paciente({ insurance_id: null });
    expect(
      filtrarPacientes([unimed, particular], { convenio: "conv-1" }, agora),
    ).toEqual([unimed]);
    expect(
      filtrarPacientes([unimed, particular], { convenio: null }, agora),
    ).toHaveLength(2);
  });

  it("profissional casa quando o id esta na lista de quem ja atendeu", () => {
    const daAna = paciente({ profissionais_ids: ["p-ana", "p-bia"] });
    const doCarlos = paciente({ profissionais_ids: ["p-carlos"] });
    expect(
      filtrarPacientes([daAna, doCarlos], { profissional: "p-bia" }, agora),
    ).toEqual([daAna]);
    expect(
      filtrarPacientes([daAna, doCarlos], { profissional: "p-zeta" }, agora),
    ).toEqual([]);
  });

  it("filtros combinados sao conjuncao: precisa satisfazer todos", () => {
    const soFalta = paciente({ total_faltou: 3, saldo_sessoes: 0 });
    const soPacote = paciente({ total_faltou: 0, saldo_sessoes: 4 });
    const osDois = paciente({
      total_faltou: 2,
      saldo_sessoes: 2,
      insurance_id: "conv-1",
      profissionais_ids: ["p-ana"],
      ultima_consulta: haDias(200),
    });
    const lista = [soFalta, soPacote, osDois];
    expect(
      filtrarPacientes(lista, { comFalta: true, comPacote: true }, agora),
    ).toEqual([osDois]);
    expect(
      filtrarPacientes(
        lista,
        {
          comFalta: true,
          comPacote: true,
          inativos: true,
          convenio: "conv-1",
          profissional: "p-ana",
        },
        agora,
      ),
    ).toEqual([osDois]);
  });

  it("filtro sem casamento devolve lista vazia (estado de vazio da tela)", () => {
    expect(
      filtrarPacientes(
        [paciente({})],
        { comFalta: true, comPacote: true },
        agora,
      ),
    ).toEqual([]);
  });
});

describe("indicadoresDe", () => {
  it("sem consulta nenhuma a taxa nao existe (null, nunca 0)", () => {
    expect(indicadoresDe({ total_compareceu: 0, total_faltou: 0 })).toEqual({
      totalConsultas: 0,
      faltas: 0,
      taxaComparecimento: null,
    });
  });

  it("so faltas: taxa zero de verdade", () => {
    expect(indicadoresDe({ total_compareceu: 0, total_faltou: 3 })).toEqual({
      totalConsultas: 3,
      faltas: 3,
      taxaComparecimento: 0,
    });
  });

  it("so comparecimentos: taxa cheia", () => {
    expect(indicadoresDe({ total_compareceu: 4, total_faltou: 0 })).toEqual({
      totalConsultas: 4,
      faltas: 0,
      taxaComparecimento: 1,
    });
  });

  it("total de consultas soma compareceu e faltou, cancelada nao entra", () => {
    const indicadores = indicadoresDe({
      total_compareceu: 9,
      total_faltou: 2,
    });
    expect(indicadores.totalConsultas).toBe(11);
    expect(indicadores.faltas).toBe(2);
    expect(indicadores.taxaComparecimento).toBeCloseTo(9 / 11);
  });
});

describe("agregadosDeConsultas", () => {
  function consulta(
    dias: number,
    status: ConsultaAgregavel["status"],
  ): ConsultaAgregavel {
    return { starts_at: haDias(dias), status };
  }

  it("sem consulta nenhuma zera os totais e deixa as datas nulas", () => {
    expect(agregadosDeConsultas([], agora)).toEqual({
      total_compareceu: 0,
      total_faltou: 0,
      ultima_consulta: null,
      proxima_consulta: null,
    });
  });

  it("conta compareceu e faltou como a RPC conta", () => {
    const agregados = agregadosDeConsultas(
      [
        consulta(30, "compareceu"),
        consulta(20, "faltou"),
        consulta(10, "compareceu"),
        consulta(5, "cancelado_paciente"),
      ],
      agora,
    );
    expect(agregados.total_compareceu).toBe(2);
    expect(agregados.total_faltou).toBe(1);
  });

  it("cancelada nao vira ultima nem proxima consulta", () => {
    const futura = new Date(agora.getTime() + DIA_MS).toISOString();
    const agregados = agregadosDeConsultas(
      [
        { starts_at: futura, status: "cancelado_clinica" },
        consulta(2, "cancelado_paciente"),
        consulta(9, "compareceu"),
      ],
      agora,
    );
    expect(agregados.ultima_consulta).toBe(haDias(9));
    expect(agregados.proxima_consulta).toBeNull();
  });

  it("ultima e a mais recente do passado; proxima e a mais proxima do futuro", () => {
    const amanha = new Date(agora.getTime() + DIA_MS).toISOString();
    const semanaQueVem = new Date(agora.getTime() + 7 * DIA_MS).toISOString();
    const agregados = agregadosDeConsultas(
      [
        consulta(40, "compareceu"),
        consulta(3, "faltou"),
        { starts_at: semanaQueVem, status: "agendado" },
        { starts_at: amanha, status: "agendado" },
      ],
      agora,
    );
    expect(agregados.ultima_consulta).toBe(haDias(3));
    expect(agregados.proxima_consulta).toBe(amanha);
  });
});

describe("etiquetasDoPaciente", () => {
  it("paciente em dia nao ganha etiqueta nenhuma", () => {
    expect(etiquetasDoPaciente(paciente({}), agora)).toEqual([]);
  });

  it("so risco de falta", () => {
    expect(etiquetasDoPaciente(paciente({ total_faltou: 2 }), agora)).toEqual([
      "risco_de_falta",
    ]);
  });

  it("so inativo", () => {
    expect(
      etiquetasDoPaciente(paciente({ ultima_consulta: haDias(120) }), agora),
    ).toEqual(["inativo"]);
  });

  it("as duas juntas, nesta ordem", () => {
    expect(
      etiquetasDoPaciente(
        paciente({ total_faltou: 4, ultima_consulta: haDias(120) }),
        agora,
      ),
    ).toEqual(["risco_de_falta", "inativo"]);
  });

  it("consulta futura derruba a etiqueta de inativo, mas nao a de risco", () => {
    expect(
      etiquetasDoPaciente(
        paciente({
          total_faltou: 2,
          ultima_consulta: haDias(400),
          proxima_consulta: new Date(agora.getTime() + DIA_MS).toISOString(),
        }),
        agora,
      ),
    ).toEqual(["risco_de_falta"]);
  });
});

describe("saldo de pacote", () => {
  const HOJE = "2026-08-25";
  const pacote = (parcial: {
    sessions_total?: number;
    sessions_used?: number;
    expires_at?: string | null;
  }) => ({
    sessions_total: 10,
    sessions_used: 4,
    expires_at: null as string | null,
    ...parcial,
  });

  it("pacote sem validade nunca vence", () => {
    const semValidade = pacote({ expires_at: null });
    expect(pacoteVencido(semValidade, HOJE)).toBe(false);
    expect(sessoesRestantes(semValidade, HOJE)).toBe(6);
  });

  it("vence no dia seguinte ao da validade: o proprio dia ainda vale", () => {
    const hoje = pacote({ expires_at: HOJE });
    expect(pacoteVencido(hoje, HOJE)).toBe(false);
    expect(sessoesRestantes(hoje, HOJE)).toBe(6);

    const ontem = pacote({ expires_at: "2026-08-24" });
    expect(pacoteVencido(ontem, HOJE)).toBe(true);
  });

  it("pacote vencido nao tem sessao restante, mesmo sem nenhuma usada", () => {
    const vencido = pacote({ sessions_used: 0, expires_at: "2026-08-24" });
    expect(sessoesRestantes(vencido, HOJE)).toBe(0);
  });

  it("pacote gasto alem do total nao devolve numero negativo", () => {
    expect(
      sessoesRestantes(pacote({ sessions_total: 3, sessions_used: 5 }), HOJE),
    ).toBe(0);
  });

  it("o saldo da ficha soma so o que esta na validade", () => {
    const lista = [
      pacote({
        sessions_total: 10,
        sessions_used: 4,
        expires_at: "2026-12-31",
      }),
      pacote({ sessions_total: 5, sessions_used: 0, expires_at: "2026-08-24" }),
      pacote({ sessions_total: 2, sessions_used: 0, expires_at: null }),
    ];
    expect(saldoDeSessoes(lista, HOJE)).toBe(8);
  });

  it("so pacote vencido: a ficha diz zero, igual a lista", () => {
    expect(
      saldoDeSessoes(
        [pacote({ sessions_used: 0, expires_at: "2026-01-01" })],
        HOJE,
      ),
    ).toBe(0);
  });

  it("o dia civil da clinica manda: a virada muda o resultado", () => {
    const pacoteDoDia = pacote({ expires_at: "2026-08-25" });
    expect(pacoteVencido(pacoteDoDia, "2026-08-25")).toBe(false);
    expect(pacoteVencido(pacoteDoDia, "2026-08-26")).toBe(true);
  });
});

describe("porcentagemDeComparecimento", () => {
  it("taxa nula devolve vazio para a interface pintar traco", () => {
    expect(porcentagemDeComparecimento(null)).toBe("");
  });

  it("arredonda para inteiro", () => {
    expect(porcentagemDeComparecimento(0.82)).toBe("82%");
    expect(porcentagemDeComparecimento(9 / 11)).toBe("82%");
    expect(porcentagemDeComparecimento(0.815)).toBe("82%");
  });

  it("extremos: zero e cheio", () => {
    expect(porcentagemDeComparecimento(0)).toBe("0%");
    expect(porcentagemDeComparecimento(1)).toBe("100%");
  });
});
