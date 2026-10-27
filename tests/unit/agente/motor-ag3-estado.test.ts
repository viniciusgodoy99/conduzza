import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  comHorariosOferecidos,
  dadosQueFaltam,
  dadosVazios,
  DESFECHOS_DO_ATENDIMENTO,
  estadoDoAtendimentoValido,
  estadoVazio,
  ETAPAS_DO_ATENDIMENTO,
  exigeCarteirinha,
  falhasDepoisDoTurno,
  FALHAS_PARA_PASSAR,
  INTENCOES_DO_ATENDIMENTO,
  lerRespostaDaGravacao,
  lerRespostaDoAtendimento,
  MAXIMO_DE_HORARIOS_NO_ESTADO,
  notaDaPassagem,
  perguntaSeConfirma,
  proximoNumeroDoCodigo,
  RESULTADOS_QUE_SAO_FALHA,
  type HorarioDoEstado,
} from "@/lib/agente/atendimento";

import { CONV, PROC, VINC } from "./agenda-fixtures";
import { catalogoDoCadastro } from "./cadastro-fixtures";

// O estado do atendimento da IA entre os turnos (AG3, lib/agente/
// atendimento.ts), puro: a forma e o espelho do CHECK da migration
// 20261027120000 (ia_estado_do_atendimento_valido), a leitura das respostas
// das RPCs sem confiar no formato, os horarios que valem entre as mensagens
// (ate 9, codigos sem repetir), os dados que faltam (a carteirinha so pelo
// convenio), a pergunta "Confirma", as falhas seguidas e a nota para a
// equipe sem dado de paciente. Nenhum teste fala com o banco nem com a
// OpenAI.

const MIGRATION =
  "supabase/migrations/20261027120000_agendamento_completo_da_ia.sql";

const H = (n: number, extra: Partial<HorarioDoEstado> = {}): HorarioDoEstado => ({
  codigo: `h${n}`,
  service_link_id: VINC.consultaAna,
  professional_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  unit_id: null,
  starts_at: `2026-10-2${n % 9}T14:00:00.000Z`,
  ends_at: `2026-10-2${n % 9}T14:30:00.000Z`,
  oferecido_em: "2026-10-20T12:00:00.000Z",
  ...extra,
});

describe("a forma do estado (o espelho do CHECK)", () => {
  it("as listas fechadas são as da migration", () => {
    const sql = readFileSync(MIGRATION, "utf-8");
    const lista = (nome: string) => {
      const m = new RegExp(`constraint ia_atendimento_${nome} check \\(\\s*\\w+ in \\(([^)]*)\\)`).exec(sql);
      return (m?.[1] ?? "")
        .split(",")
        .map((v) => v.trim().replace(/^'|'$/g, ""))
        .filter(Boolean);
    };
    expect(lista("etapa_valida")).toEqual([...ETAPAS_DO_ATENDIMENTO]);
    expect(lista("intencao_valida")).toEqual([...INTENCOES_DO_ATENDIMENTO]);
    expect(lista("desfecho_valido")).toEqual([...DESFECHOS_DO_ATENDIMENTO]);
  });

  it("o vazio é válido; as 14 chaves exatas, ids e instantes em UTC", () => {
    expect(estadoDoAtendimentoValido(estadoVazio())).toBe(true);
    expect(
      estadoDoAtendimentoValido({
        ...estadoVazio(),
        etapa: "oferta",
        intencao: "agendar",
        procedure_id: PROC.consulta,
        particular: true,
        horarios_oferecidos: [H(1), H(2)],
        falhas_seguidas: 1,
      }),
    ).toBe(true);
    for (const ruim of [
      { ...estadoVazio(), extra: 1 },
      { ...estadoVazio(), etapa: "marcando" },
      { ...estadoVazio(), procedure_id: "P1" },
      {
        ...estadoVazio(),
        professional_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      },
      { ...estadoVazio(), falhas_seguidas: 21 },
      { ...estadoVazio(), falhas_seguidas: 1.5 },
      // Particular e convenio nao andam juntos.
      { ...estadoVazio(), particular: true, insurance_id: CONV.unimed },
      // O pedido pendente e o instante dele andam juntos.
      { ...estadoVazio(), pedido_pendente: "cancelar" },
      { ...estadoVazio(), horarios_oferecidos: [H(1), H(1)] },
      { ...estadoVazio(), horarios_oferecidos: [H(1, { codigo: "h100" })] },
      {
        ...estadoVazio(),
        horarios_oferecidos: [H(1, { starts_at: "2026-10-21T14:00:00-03:00" })],
      },
      { ...estadoVazio(), horarios_oferecidos: [{ ...H(1), nome: "Maria" }] },
      // Texto livre nunca cabe.
      { ...estadoVazio(), intencao: "quero marcar" },
    ]) {
      expect(estadoDoAtendimentoValido(ruim), JSON.stringify(ruim)).toBe(false);
    }
    const nove = Array.from({ length: 9 }, (_, i) => H(i + 1));
    expect(
      estadoDoAtendimentoValido({ ...estadoVazio(), horarios_oferecidos: nove }),
    ).toBe(true);
    expect(
      estadoDoAtendimentoValido({
        ...estadoVazio(),
        horarios_oferecidos: [...nove, H(10)],
      }),
    ).toBe(false);
  });

  it("a leitura de ler_atendimento_da_ia e de gravar_atendimento_da_ia não confia no formato", () => {
    const dados = {
      nome_completo: true,
      data_nascimento: false,
      cpf: false,
      carteirinha: false,
      para_o_titular: true,
      faltam: ["data_nascimento"],
    };
    expect(
      lerRespostaDoAtendimento({
        ok: true,
        versao: 3,
        janela_desde: "2026-10-20T11:00:00+00:00",
        estado: estadoVazio(),
        dados,
      }),
    ).toEqual({
      ok: true,
      versao: 3,
      janelaDesde: "2026-10-20T11:00:00+00:00",
      estado: estadoVazio(),
      dados,
    });
    expect(lerRespostaDoAtendimento({ ok: false, motivo: "fora_da_ia" })).toEqual(
      { ok: false, motivo: "fora_da_ia" },
    );
    expect(lerRespostaDoAtendimento({ ok: false, motivo: "job_antigo" })).toEqual(
      { ok: false, motivo: "job_antigo" },
    );
    for (const ruim of [
      null,
      { ok: false, motivo: "outro" },
      { ok: true, versao: -1, janela_desde: "x", estado: estadoVazio(), dados },
      { ok: true, versao: 1, janela_desde: "2026-10-20T11:00:00Z", estado: {}, dados },
      {
        ok: true,
        versao: 1,
        janela_desde: "2026-10-20T11:00:00Z",
        estado: estadoVazio(),
        dados: { ...dados, cpf: "52998224725" },
      },
      {
        ok: true,
        versao: 1,
        janela_desde: "2026-10-20T11:00:00Z",
        estado: estadoVazio(),
        dados: { ...dados, faltam: ["rg"] },
      },
    ]) {
      expect(lerRespostaDoAtendimento(ruim), JSON.stringify(ruim)).toBeNull();
    }
    expect(lerRespostaDaGravacao({ ok: true, versao: 2, reutilizado: true })).toEqual(
      { ok: true, versao: 2, reutilizado: true },
    );
    for (const motivo of ["fora_da_ia", "sem_posse", "job_antigo", "estado_mudou"]) {
      expect(lerRespostaDaGravacao({ ok: false, motivo })).toEqual({
        ok: false,
        motivo,
      });
    }
    for (const ruim of [null, { ok: true }, { ok: true, versao: 0 }, { ok: false, motivo: "x" }]) {
      expect(lerRespostaDaGravacao(ruim), JSON.stringify(ruim)).toBeNull();
    }
  });
});

describe("os horários oferecidos entre as mensagens", () => {
  it("guarda os 9 mais novos; o reservado fica", () => {
    const antes = Array.from({ length: 8 }, (_, i) => H(i + 1));
    const depois = comHorariosOferecidos(antes, [H(9), H(10), H(11)], "h1");
    expect(depois).toHaveLength(MAXIMO_DE_HORARIOS_NO_ESTADO);
    expect(depois.map((h) => h.codigo)).toEqual([
      "h1",
      "h4",
      "h5",
      "h6",
      "h7",
      "h8",
      "h9",
      "h10",
      "h11",
    ]);
    expect(estadoDoAtendimentoValido({ ...estadoVazio(), horarios_oferecidos: depois })).toBe(true);
  });

  it("o código nunca repete um que está no estado; depois de h99, o menor livre", () => {
    expect(proximoNumeroDoCodigo([])).toBe(1);
    expect(proximoNumeroDoCodigo(["h3", "h7"])).toBe(8);
    expect(proximoNumeroDoCodigo(["h3"], 5)).toBe(6);
    expect(proximoNumeroDoCodigo(["h99", "h1", "h2"])).toBe(3);
  });
});

describe("os dados que faltam (o espelho de dados_que_faltam_para_marcar)", () => {
  const catalogo = catalogoDoCadastro();
  const todos = { nomeCompleto: true, nascimento: true, cpf: true };

  it("pela configuração, na ordem do banco; o que já veio não falta", () => {
    expect(
      dadosQueFaltam({
        exigidos: todos,
        informados: dadosVazios(),
        vinculo: null,
        catalogo,
      }),
    ).toEqual(["nome_completo", "data_nascimento", "cpf"]);
    expect(
      dadosQueFaltam({
        exigidos: { nomeCompleto: true, nascimento: true, cpf: false },
        informados: { ...dadosVazios(), nome_completo: true },
        vinculo: null,
        catalogo,
      }),
    ).toEqual(["data_nascimento"]);
    expect(
      dadosQueFaltam({
        exigidos: { nomeCompleto: false, nascimento: false, cpf: false },
        informados: dadosVazios(),
        vinculo: { procedimentoId: PROC.consulta, convenioId: null },
        catalogo,
      }),
    ).toEqual([]);
  });

  it("a carteirinha só na consulta pelo convênio, pelo requisito ou pela Carteirinha obrigatória", () => {
    // A Consulta pela Unimed tem o requisito carteirinha (cadastro-fixtures).
    expect(
      exigeCarteirinha(catalogo, {
        procedimentoId: PROC.consulta,
        convenioId: CONV.unimed,
      }),
    ).toBe(true);
    expect(
      exigeCarteirinha(catalogo, { procedimentoId: PROC.consulta, convenioId: null }),
    ).toBe(false);
    // O Exame pela Amil nao tem requisito; com "Carteirinha obrigatoria" no
    // convenio, passa a pedir.
    expect(
      exigeCarteirinha(catalogo, { procedimentoId: PROC.exame, convenioId: CONV.amil }),
    ).toBe(false);
    const comCarteirinha = catalogoDoCadastro({
      convenios: [
        { id: CONV.amil, name: "Amil", plan_name: null, active: true, requires_card: true },
      ],
    });
    expect(
      exigeCarteirinha(comCarteirinha, {
        procedimentoId: PROC.exame,
        convenioId: CONV.amil,
      }),
    ).toBe(true);
    expect(
      dadosQueFaltam({
        exigidos: { nomeCompleto: false, nascimento: false, cpf: false },
        informados: dadosVazios(),
        vinculo: { procedimentoId: PROC.consulta, convenioId: CONV.unimed },
        catalogo,
      }),
    ).toEqual(["carteirinha"]);
  });
});

describe("a pergunta Confirma", () => {
  it("uma frase que começa com Confirma e termina em interrogação", () => {
    for (const sim of [
      "Confirma terça, 21/10 às 14:00 com a Dra. Ana Lima, Consulta, na unidade Centro, particular?",
      "Reservei. Confirma a consulta de terça às 14:00?",
      "Eu sou a assistente virtual da clínica.\n\nConfirmá terça às 14h?",
    ]) {
      expect(perguntaSeConfirma(sim), sim).toBe(true);
    }
    for (const nao of [
      "Posso marcar terça às 14:00?",
      "Confirma. Vou marcar.",
      "Quer que eu confirme terça às 14:00?",
    ]) {
      expect(perguntaSeConfirma(nao), nao).toBe(false);
    }
    // Revisao final da AG3 (achado 11): depois de uma interjeicao ou com
    // quem confirma, tambem e a pergunta (a etapa ainda depende da reserva:
    // perguntaConfirmaAReserva).
    for (const sim of [
      "Ótimo, confirma a consulta de terça, 21/10 às 14:00?",
      "Você confirma a consulta de terça, 21/10 às 14:00?",
      "Obrigada! Então, a senhora confirma terça, 21/10 às 14:00?",
      "Você confirma presença?",
    ]) {
      expect(perguntaSeConfirma(sim), sim).toBe(true);
    }
  });
});

describe("as falhas seguidas (item 9)", () => {
  it("falha soma, avanço zera, só conversa não mexe; na segunda passa", () => {
    expect(FALHAS_PARA_PASSAR).toBe(2);
    expect(falhasDepoisDoTurno(0, ["codigo_invalido"])).toBe(1);
    expect(falhasDepoisDoTurno(1, ["cpf_invalido"])).toBe(2);
    // Errou e acertou no mesmo turno: avancou.
    expect(falhasDepoisDoTurno(1, ["codigo_invalido", "reservado"])).toBe(0);
    // Ferramenta sem falha: a conversa andou.
    expect(falhasDepoisDoTurno(1, ["particular"])).toBe(0);
    // Horario que deixou de estar livre nao e falha de ninguem.
    expect(falhasDepoisDoTurno(1, ["ocupado"])).toBe(0);
    // Sem ferramenta: so conversa.
    expect(falhasDepoisDoTurno(1, [])).toBe(1);
    expect(falhasDepoisDoTurno(20, ["entrada_invalida"])).toBe(20);
    expect(RESULTADOS_QUE_SAO_FALHA.has("reserva_vencida")).toBe(false);
  });
});

describe("a nota para a equipe (item 8)", () => {
  it("só do estado e do Cadastro: pedido, reserva, dados (sem valor) e onde parou", () => {
    const nota = notaDaPassagem({
      estado: {
        ...estadoVazio(),
        etapa: "oferta",
        intencao: "agendar",
        procedure_id: PROC.consulta,
        particular: true,
        slot_hold_id: "5c000000-0000-4000-8000-000000000001",
      },
      dados: {
        ...dadosVazios(["cpf"]),
        nome_completo: true,
        data_nascimento: true,
        para_o_titular: true,
      },
      procedimento: "Consulta dermatológica",
      profissional: "Dra. X",
      pagamento: "particular",
      unidade: "Centro",
      preferencia: { periodo: "tarde", hora: null },
      reserva: {
        dia: "terça, 21/10",
        hora: "14:00",
        profissional: "Dra. X",
        unidade: "Centro",
        viva: true,
      },
      oferecidos: [],
      parouEm: "a hora pedida não estava livre",
    });
    expect(nota).toBe(
      [
        "Resumo do assistente para a equipe (montado pelo sistema, sem dados do paciente).",
        "Pedido: marcar Consulta dermatológica, com Dra. X, particular, unidade Centro, preferência: tarde.",
        "Horário reservado: terça, 21/10 às 14:00, Dra. X, unidade Centro (reserva de 10 minutos ainda valendo).",
        "Dados para marcar: o nome completo e a data de nascimento informados (a equipe vê os valores na aprovação da consulta); falta o CPF.",
        "Parou em: a hora pedida não estava livre.",
      ].join("\n"),
    );
    expect(nota).not.toMatch(/[–—]/);
  });

  it("sem atendimento de marcar, nada a contar; outra pessoa, só a marca", () => {
    expect(
      notaDaPassagem({
        estado: estadoVazio(),
        dados: dadosVazios(),
        procedimento: null,
        profissional: null,
        pagamento: null,
        unidade: null,
        preferencia: null,
        reserva: null,
        oferecidos: [],
        parouEm: "o paciente descreveu um sintoma",
      }),
    ).toBeNull();
    const outra = notaDaPassagem({
      estado: { ...estadoVazio(), intencao: "agendar" },
      dados: { ...dadosVazios(), para_o_titular: false },
      procedimento: null,
      profissional: null,
      pagamento: null,
      unidade: null,
      preferencia: null,
      reserva: null,
      oferecidos: [],
      parouEm: "a consulta é para outra pessoa",
    });
    expect(outra).toContain("A consulta é para outra pessoa.");
    expect(outra).not.toContain("Dados para marcar");
  });
});
