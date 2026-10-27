import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  agendaCompleta,
  agendaDoAgenteSchema,
  agendaDoBanco,
  agendaPadrao,
  agendaParaOBanco,
  agenteAtendeAgora,
  agenteKeys,
  ANTECEDENCIA_DA_AGENDA,
  baseDoConhecimento,
  CAMPOS_DE_TEXTO_DO_AGENTE,
  comMudancaDasInstrucoes,
  configDaLinha,
  configPadraoDoAgente,
  DADOS_EXIGIDOS,
  dadosExigidosDoBanco,
  dadosExigidosPadrao,
  dadosExigidosParaOBanco,
  dadosExigidosSchema,
  descricaoDoModo,
  DIAS_DA_SEMANA,
  DICA_DA_AGENDA_INCOMPLETA,
  diferencasDoRascunho,
  EXEMPLO_DO_TOM,
  expedientePadrao,
  ehFerramentaDeAgenda,
  ehFerramentaDoCadastro,
  FERRAMENTAS_DE_AGENDA,
  FERRAMENTAS_DO_CADASTRO,
  FERRAMENTAS_DO_AGENTE,
  ferramentasDoAgente,
  GATILHOS_OBRIGATORIOS,
  HABILIDADES_DO_AGENTE,
  habilidadesComAgenda,
  habilidadesComAgendaSchema,
  habilidadesEfetivas,
  habilidadesSchema,
  HORIZONTE_DA_AGENDA,
  horarioDoBanco,
  horarioPadrao,
  horarioParaOBanco,
  horarioSchema,
  INSTRUCAO_DO_EMOJI,
  INSTRUCAO_DO_TOM,
  instrucoesSchema,
  itemDaBaseSchema,
  LIMITES_DO_AGENTE,
  mesmasInstrucoes,
  MODOS_DE_OPERACAO,
  MOTIVOS_DE_ESCALONAMENTO,
  MUDANCA_DAS_INSTRUCOES,
  PADROES_PROPOSTOS_DA_CLINICA_NOVA,
  personaParaOBanco,
  personaSchema,
  PROBLEMA_DAS_INSTRUCOES_PARA_A_CLINICA,
  problemaNoTextoDoAgente,
  problemasDaPublicacao,
  problemasNoTextoDoAgente,
  problemasParaQuemPublica,
  PUBLICOS_DO_AGENTE,
  publicoDoBanco,
  publicoParaOBanco,
  publicoSchema,
  ROTULO_CURTO_DO_DIA,
  ROTULO_DA_AGENDA,
  ROTULO_DA_TRAVA,
  ROTULO_DO_CAMPO_DE_TEXTO,
  ROTULO_DO_DIA,
  ROTULO_DO_MODO,
  ROTULO_DO_CAMPO_PUBLICO,
  ROTULO_DOS_DADOS_EXIGIDOS,
  ROTULO_DO_MOTIVO_DE_ESCALONAMENTO,
  ROTULO_DO_PUBLICO,
  ROTULO_DO_PUBLICO_NAO_ESCOLHIDO,
  ROTULO_DO_TOM,
  TEXTO_DA_CONFORMIDADE,
  TEXTO_DAS_INSTRUCOES_A_AJUSTAR,
  textoDoProblemaDaPublicacao,
  tipoDoContatoDoBanco,
  tipoDoContatoSchema,
  TIPOS_DO_CONTATO,
  TONS_DO_AGENTE,
  type ConfigDoAgente,
  type HorarioDeOperacao,
  type ItemDaBase,
  type LinhaDaConfigDoAgente,
} from "@/lib/domain/agente/config";
import { CATEGORIAS_CLINICAS } from "@/lib/domain/conformidade/categorias";
import {
  avaliarRegras,
  LIMITE_DO_RASCUNHO,
} from "@/lib/domain/conformidade/filtro-deterministico";
import { COLUNAS_DA_CONFIG_DO_AGENTE } from "@/lib/queries/agente";

// Dominio puro da Tela 6 (configuracao do agente de IA). As outras partes
// (banco, motor, telas) dependem destes nomes e destas regras.

const CONTEXTO_VAZIO = {
  precosDoTurno: [],
  nomesDoCatalogo: [],
  mensagensDoPaciente: [],
} as const;

const TRAVESSAO = /[–—]/;
const MIGRATION_DA_AGENDA = "supabase/migrations/20261020130000_ia_agenda.sql";
// Linguagem de recepcionista (CLAUDE.md 5 e especificacao da Tela 6).
const JARGAO = /\b(prompt|token|llm|skill|tenant|handoff|opt-in)\b/i;

const ID_A = "0b6a6f7e-6d2c-4c0e-9a51-1f1f8b6b1a01";
const ID_B = "0b6a6f7e-6d2c-4c0e-9a51-1f1f8b6b1a02";
const ID_C = "0b6a6f7e-6d2c-4c0e-9a51-1f1f8b6b1a03";

function item(
  id: string,
  pergunta: string,
  resposta: string,
  ativo = true,
): ItemDaBase {
  return { id, pergunta, resposta, ativo };
}

function config(parcial: Partial<ConfigDoAgente> = {}): ConfigDoAgente {
  return { ...configPadraoDoAgente(), ...parcial };
}

describe("limites", () => {
  it("sao os da especificacao", () => {
    expect(LIMITES_DO_AGENTE).toEqual({
      nome: 40,
      saudacao: 300,
      encerramento: 300,
      instrucoes: 2000,
      pergunta: 200,
      resposta: 600,
      itensDaBase: 60,
    });
  });

  it("a resposta da base cabe no limite do filtro", () => {
    expect(LIMITES_DO_AGENTE.resposta).toBeLessThan(LIMITE_DO_RASCUNHO);
  });
});

describe("tom de voz", () => {
  it("tem os tres tons do banco com rotulo, exemplo e instrucao", () => {
    expect(TONS_DO_AGENTE).toEqual(["formal", "cordial", "proximo"]);
    expect(ROTULO_DO_TOM).toEqual({
      formal: "Formal",
      cordial: "Cordial",
      proximo: "Próximo",
    });
    for (const tom of TONS_DO_AGENTE) {
      expect(EXEMPLO_DO_TOM[tom].length).toBeGreaterThan(10);
      expect(INSTRUCAO_DO_TOM[tom].length).toBeGreaterThan(10);
    }
  });

  it.each(TONS_DO_AGENTE)(
    "o exemplo do tom %s passa limpo pelo filtro e e curto",
    (tom) => {
      const exemplo = EXEMPLO_DO_TOM[tom];
      expect(avaliarRegras(exemplo, CONTEXTO_VAZIO).achados).toEqual([]);
      expect(problemaNoTextoDoAgente(exemplo, "saudacao")).toBeNull();
      expect(exemplo.length).toBeLessThanOrEqual(120);
      expect(exemplo).not.toMatch(TRAVESSAO);
    },
  );

  it("os exemplos sao diferentes entre si", () => {
    expect(new Set(Object.values(EXEMPLO_DO_TOM)).size).toBe(3);
  });

  it("as frases que vao ao modelo nao tem travessao", () => {
    for (const texto of [
      ...Object.values(INSTRUCAO_DO_TOM),
      ...Object.values(INSTRUCAO_DO_EMOJI),
    ]) {
      expect(texto).not.toMatch(TRAVESSAO);
    }
  });
});

describe("habilidades", () => {
  it("e a lista fechada (E4: agendar e confirmar presenca)", () => {
    expect(HABILIDADES_DO_AGENTE.map((h) => h.chave)).toEqual([
      "responder_duvidas",
      "informar_preco_e_convenio",
      "agendar",
      "confirmar_presenca",
      "passar_para_equipe",
    ]);
    const porChave = Object.fromEntries(
      HABILIDADES_DO_AGENTE.map((h) => [h.chave, h]),
    );
    expect(porChave.responder_duvidas?.travada).toBe(true);
    // Onda 2 (item 5 e P5c): as frases fixas vem sempre, pela habilidade
    // travada. AG2: as consultas do Cadastro tambem (so leitura).
    expect(porChave.responder_duvidas?.ferramentas).toEqual([
      "fora_do_assunto",
      "sou_assistente_virtual",
      "consultar_unidades",
      "consultar_requisitos",
      "buscar_profissionais",
    ]);
    expect(porChave.informar_preco_e_convenio?.travada).toBe(false);
    expect(porChave.informar_preco_e_convenio?.ferramentas).toEqual([
      "buscar_procedimento",
    ]);
    expect(porChave.agendar).toMatchObject({
      titulo: "Agendar consulta",
      travada: false,
      padrao: false,
      precisaDaAgenda: true,
      // AG3: o cadastro da pessoa (so sinais) e os dados para marcar.
      ferramentas: [
        "consultar_cadastro_do_contato",
        "buscar_horario",
        "reservar_horario",
        "registrar_dados_do_paciente",
        "agendar",
      ],
    });
    expect(porChave.confirmar_presenca).toMatchObject({
      titulo: "Confirmar presença",
      travada: false,
      padrao: false,
      precisaDaAgenda: false,
      ferramentas: ["confirmar_presenca"],
    });
    expect(porChave.passar_para_equipe?.travada).toBe(true);
    expect(porChave.passar_para_equipe?.ferramentas).toEqual([
      "escalar_humano",
    ]);
    // Toda ferramenta conhecida vem de uma habilidade, e as de agenda sao
    // as das duas habilidades novas.
    expect(
      HABILIDADES_DO_AGENTE.flatMap((h) => [...h.ferramentas]).sort(),
    ).toEqual([...FERRAMENTAS_DO_AGENTE].sort());
    expect([...FERRAMENTAS_DE_AGENDA]).toEqual([
      "buscar_horario",
      "reservar_horario",
      "agendar",
      "confirmar_presenca",
      // AG3: pela porta da agenda do turno (gravam ou leem pelo servidor).
      "registrar_dados_do_paciente",
      "consultar_cadastro_do_contato",
    ]);
    expect(ehFerramentaDeAgenda("agendar")).toBe(true);
    expect(ehFerramentaDeAgenda("buscar_procedimento")).toBe(false);
    // AG2: as consultas do Cadastro nao sao de agenda (nao gravam, nao leem
    // a Agenda, nao mudam as rodadas).
    expect([...FERRAMENTAS_DO_CADASTRO]).toEqual([
      "consultar_unidades",
      "consultar_requisitos",
      "buscar_profissionais",
    ]);
    for (const nome of FERRAMENTAS_DO_CADASTRO) {
      expect(ehFerramentaDoCadastro(nome)).toBe(true);
      expect(ehFerramentaDeAgenda(nome)).toBe(false);
    }
    expect(ehFerramentaDoCadastro("buscar_procedimento")).toBe(false);
  });

  it("travada vale sempre, desconhecida e ignorada, ausente vale o padrao", () => {
    expect(
      habilidadesEfetivas({
        responder_duvidas: false,
        passar_para_equipe: false,
        informar_preco_e_convenio: false,
        agendar: true,
        remarcar: true,
      }),
    ).toEqual({
      responder_duvidas: true,
      informar_preco_e_convenio: false,
      agendar: true,
      confirmar_presenca: false,
      passar_para_equipe: true,
    });
    expect(habilidadesEfetivas({})).toEqual({
      responder_duvidas: true,
      informar_preco_e_convenio: true,
      agendar: false,
      confirmar_presenca: false,
      passar_para_equipe: true,
    });
  });

  it("valor fora do formato nunca lanca", () => {
    for (const valor of [null, undefined, "x", 3, [], [true]]) {
      expect(habilidadesEfetivas(valor)).toEqual(habilidadesEfetivas({}));
    }
    expect(
      habilidadesEfetivas({ informar_preco_e_convenio: "nao" })
        .informar_preco_e_convenio,
    ).toBe(true);
  });

  it("as ferramentas seguem as habilidades; escalar_humano e as frases fixas sempre vem", () => {
    const semAgenda = agendaPadrao();
    expect(ferramentasDoAgente({}, semAgenda)).toEqual([
      "fora_do_assunto",
      "sou_assistente_virtual",
      "consultar_unidades",
      "consultar_requisitos",
      "buscar_profissionais",
      "buscar_procedimento",
      "escalar_humano",
    ]);
    expect(
      ferramentasDoAgente({ informar_preco_e_convenio: false }, semAgenda),
    ).toEqual([
      "fora_do_assunto",
      "sou_assistente_virtual",
      "consultar_unidades",
      "consultar_requisitos",
      "buscar_profissionais",
      "escalar_humano",
    ]);
    expect(
      ferramentasDoAgente({ responder_duvidas: false }, semAgenda),
    ).toContain("fora_do_assunto");
    expect(
      ferramentasDoAgente({ passar_para_equipe: false }, semAgenda),
    ).toContain("escalar_humano");
  });

  it("agendar so da as ferramentas com a antecedencia e o horizonte (falha fechada)", () => {
    const completa = { antecedenciaHoras: 2, horizonteDias: 30 };
    const ligadas = { agendar: true, confirmar_presenca: true };
    expect(ferramentasDoAgente(ligadas, completa)).toEqual([
      "fora_do_assunto",
      "sou_assistente_virtual",
      "consultar_unidades",
      "consultar_requisitos",
      "buscar_profissionais",
      "buscar_procedimento",
      "consultar_cadastro_do_contato",
      "buscar_horario",
      "reservar_horario",
      "registrar_dados_do_paciente",
      "agendar",
      "confirmar_presenca",
      "escalar_humano",
    ]);
    for (const agenda of [
      agendaPadrao(),
      { antecedenciaHoras: 2, horizonteDias: null },
      { antecedenciaHoras: null, horizonteDias: 30 },
      // Fora da faixa do CHECK: nao vale como preenchida.
      { antecedenciaHoras: 2, horizonteDias: 0 },
      { antecedenciaHoras: 721, horizonteDias: 30 },
      { antecedenciaHoras: 1.5, horizonteDias: 30 },
    ]) {
      expect(ferramentasDoAgente(ligadas, agenda)).toEqual([
        "fora_do_assunto",
        "sou_assistente_virtual",
        "consultar_unidades",
        "consultar_requisitos",
        "buscar_profissionais",
        "buscar_procedimento",
        "confirmar_presenca",
        "escalar_humano",
      ]);
    }
  });

  it("o schema descarta chave desconhecida, liga as travadas e recusa nao booleano", () => {
    expect(
      habilidadesSchema.parse({
        informar_preco_e_convenio: false,
        responder_duvidas: false,
        outra: "x",
      }),
    ).toEqual({
      responder_duvidas: true,
      informar_preco_e_convenio: false,
      agendar: false,
      confirmar_presenca: false,
      passar_para_equipe: true,
    });
    expect(
      habilidadesSchema.safeParse({ informar_preco_e_convenio: "sim" }).success,
    ).toBe(false);
    expect(habilidadesSchema.safeParse({ agendar: "sim" }).success).toBe(false);
  });

  it("ligar Agendar consulta sem a agenda completa e recusado, com a dica da tela", () => {
    const incompleta = { antecedenciaHoras: 4, horizonteDias: null };
    const recusado = habilidadesComAgendaSchema(incompleta).safeParse({
      agendar: true,
    });
    expect(recusado.success).toBe(false);
    expect(recusado.error?.issues[0]?.message).toBe(DICA_DA_AGENDA_INCOMPLETA);
    expect(recusado.error?.issues[0]?.path).toEqual(["agendar"]);
    // Desligar (ou nao mexer) passa; com a agenda completa, ligar passa.
    expect(
      habilidadesComAgendaSchema(incompleta).parse({ agendar: false }).agendar,
    ).toBe(false);
    expect(
      habilidadesComAgendaSchema(incompleta).parse({ confirmar_presenca: true })
        .confirmar_presenca,
    ).toBe(true);
    expect(
      habilidadesComAgendaSchema({
        antecedenciaHoras: 0,
        horizonteDias: 1,
      }).parse({ agendar: true }).agendar,
    ).toBe(true);
    expect(DICA_DA_AGENDA_INCOMPLETA).not.toMatch(TRAVESSAO);
  });

  it("o que vale de fato desliga agendar sem a agenda completa", () => {
    expect(
      habilidadesComAgenda({ agendar: true }, agendaPadrao()).agendar,
    ).toBe(false);
    expect(
      habilidadesComAgenda(
        { agendar: true },
        { antecedenciaHoras: 24, horizonteDias: 60 },
      ).agendar,
    ).toBe(true);
    // As outras nao dependem da agenda.
    expect(
      habilidadesComAgenda({ confirmar_presenca: true }, agendaPadrao())
        .confirmar_presenca,
    ).toBe(true);
  });
});

describe("agenda da IA (antecedencia e horizonte)", () => {
  it("as faixas sao as do contrato da E4", () => {
    expect(ANTECEDENCIA_DA_AGENDA).toEqual({ minimo: 0, maximo: 720 });
    expect(HORIZONTE_DA_AGENDA).toEqual({ minimo: 1, maximo: 365 });
  });

  // A migration e da frente de banco desta leva: enquanto ela nao existe no
  // disco, o cruzamento fica pulado (e aparece como pulado na saida).
  it.skipIf(!existsSync(MIGRATION_DA_AGENDA))(
    "as faixas espelham o CHECK da migration",
    () => {
      const sql = readFileSync(MIGRATION_DA_AGENDA, "utf-8");
      for (const [coluna, faixa] of [
        ["agenda_antecedencia_horas", ANTECEDENCIA_DA_AGENDA],
        ["agenda_horizonte_dias", HORIZONTE_DA_AGENDA],
      ] as const) {
        const checks = [
          ...sql.matchAll(/check\s*\(([^;]*?)\)\s*[,;)]/gi),
        ].filter((m) => (m[1] ?? "").includes(coluna));
        expect(checks.length, coluna).toBeGreaterThan(0);
        const numeros = checks.flatMap((m) =>
          [...(m[1] ?? "").matchAll(/\b\d+\b/g)].map((n) => Number(n[0])),
        );
        expect(numeros, coluna).toContain(faixa.minimo);
        expect(numeros, coluna).toContain(faixa.maximo);
      }
    },
  );

  it("o schema aceita inteiros nas faixas e nulo, e recusa o resto", () => {
    expect(
      agendaDoAgenteSchema.parse({ antecedenciaHoras: 0, horizonteDias: 1 }),
    ).toEqual({ antecedenciaHoras: 0, horizonteDias: 1 });
    expect(
      agendaDoAgenteSchema.parse({
        antecedenciaHoras: 720,
        horizonteDias: 365,
      }),
    ).toEqual({ antecedenciaHoras: 720, horizonteDias: 365 });
    expect(
      agendaDoAgenteSchema.parse({
        antecedenciaHoras: null,
        horizonteDias: null,
      }),
    ).toEqual(agendaPadrao());
    for (const entrada of [
      { antecedenciaHoras: -1, horizonteDias: 30 },
      { antecedenciaHoras: 721, horizonteDias: 30 },
      { antecedenciaHoras: 2.5, horizonteDias: 30 },
      { antecedenciaHoras: 2, horizonteDias: 0 },
      { antecedenciaHoras: 2, horizonteDias: 366 },
      { antecedenciaHoras: 2, horizonteDias: 7.5 },
      { antecedenciaHoras: "2", horizonteDias: 30 },
      { antecedenciaHoras: Number.NaN, horizonteDias: 30 },
      { antecedenciaHoras: 2 },
    ]) {
      const lido = agendaDoAgenteSchema.safeParse(entrada);
      expect(lido.success, JSON.stringify(entrada)).toBe(false);
      for (const problema of lido.error?.issues ?? []) {
        expect(problema.message).not.toMatch(TRAVESSAO);
        expect(problema.message).toMatch(/^Use um número inteiro de /);
      }
    }
  });

  it("le as colunas do banco com falha fechada e grava de volta", () => {
    expect(
      agendaDoBanco({
        agenda_antecedencia_horas: 12,
        agenda_horizonte_dias: 45,
      }),
    ).toEqual({ antecedenciaHoras: 12, horizonteDias: 45 });
    // Coluna fora do select, fora da faixa ou de outro tipo: nulo.
    expect(agendaDoBanco({})).toEqual(agendaPadrao());
    expect(
      agendaDoBanco({
        agenda_antecedencia_horas: "12",
        agenda_horizonte_dias: 400,
      }),
    ).toEqual(agendaPadrao());
    expect(
      agendaParaOBanco({ antecedenciaHoras: 3, horizonteDias: null }),
    ).toEqual({ agenda_antecedencia_horas: 3, agenda_horizonte_dias: null });
    expect(agendaCompleta(agendaPadrao())).toBe(false);
    expect(agendaCompleta({ antecedenciaHoras: 0, horizonteDias: 1 })).toBe(
      true,
    );
  });

  it("os rotulos da agenda sao os da aba Regras e limites", () => {
    expect(ROTULO_DA_AGENDA).toEqual({
      antecedenciaHoras: "Antecedência mínima para marcar",
      horizonteDias: "Até quantos dias à frente",
    });
  });
});

describe("horario de operacao", () => {
  const SEGUNDA_09H = Date.parse("2026-10-05T12:00:00Z"); // 09:00 em Fortaleza
  const SEGUNDA_08H = Date.parse("2026-10-05T11:00:00Z");
  const SEGUNDA_18H = Date.parse("2026-10-05T21:00:00Z");
  const SEGUNDA_17H59 = Date.parse("2026-10-05T20:59:00Z");
  const SABADO_10H = Date.parse("2026-10-10T13:00:00Z");

  function foraDoExpediente(): HorarioDeOperacao {
    return { ...horarioPadrao(), modo: "fora_expediente" };
  }

  it("24h sempre atende", () => {
    expect(
      agenteAtendeAgora(horarioPadrao(), SEGUNDA_09H, "America/Fortaleza"),
    ).toEqual({ atende: true, motivo: "sempre" });
  });

  it("fallback conta como atende (a espera e do E3)", () => {
    expect(
      agenteAtendeAgora(
        { ...horarioPadrao(), modo: "fallback" },
        SEGUNDA_09H,
        "America/Fortaleza",
      ),
    ).toEqual({ atende: true, motivo: "espera_a_equipe" });
  });

  it("fora do expediente: no expediente quem responde e a equipe", () => {
    const horario = foraDoExpediente();
    expect(
      agenteAtendeAgora(horario, SEGUNDA_09H, "America/Fortaleza"),
    ).toEqual({
      atende: false,
      motivo: "no_expediente",
    });
    expect(agenteAtendeAgora(horario, SABADO_10H, "America/Fortaleza")).toEqual(
      {
        atende: true,
        motivo: "fora_do_expediente",
      },
    );
  });

  it("o inicio entra e o fim nao entra no expediente", () => {
    const horario = foraDoExpediente();
    const fuso = "America/Fortaleza";
    expect(agenteAtendeAgora(horario, SEGUNDA_08H, fuso).atende).toBe(false);
    expect(agenteAtendeAgora(horario, SEGUNDA_17H59, fuso).atende).toBe(false);
    expect(agenteAtendeAgora(horario, SEGUNDA_18H, fuso).atende).toBe(true);
  });

  it("o dia e a hora sao os do fuso da clinica, nao os de UTC", () => {
    // 01:00 de terca em UTC = 22:00 de segunda em Fortaleza.
    const instante = Date.parse("2026-10-06T01:00:00Z");
    const fechado = {
      aberto: false,
      inicio: "08:00",
      fim: "18:00",
    };
    const horario: HorarioDeOperacao = {
      modo: "fora_expediente",
      minutosSemResposta: 5,
      expediente: {
        dom: fechado,
        seg: { aberto: true, inicio: "20:00", fim: "23:00" },
        ter: { aberto: true, inicio: "00:00", fim: "02:00" },
        qua: fechado,
        qui: fechado,
        sex: fechado,
        sab: fechado,
      },
    };
    expect(agenteAtendeAgora(horario, instante, "America/Fortaleza")).toEqual({
      atende: false,
      motivo: "no_expediente",
    });
    // Em UTC seria terca 01:00, tambem no expediente; em Manaus (UTC-4)
    // e segunda 21:00. Fuso que muda o dia muda a resposta:
    expect(agenteAtendeAgora(horario, instante, "Asia/Tokyo")).toEqual({
      atende: true,
      motivo: "fora_do_expediente",
    });
  });

  it("fuso invalido cai no padrao da clinica (Fortaleza)", () => {
    const horario = foraDoExpediente();
    expect(agenteAtendeAgora(horario, SEGUNDA_09H, "Nao/Existe")).toEqual({
      atende: false,
      motivo: "no_expediente",
    });
  });

  it("instante invalido falha fechado no modo fora do expediente", () => {
    expect(
      agenteAtendeAgora(foraDoExpediente(), Number.NaN, "America/Fortaleza"),
    ).toEqual({ atende: false, motivo: "no_expediente" });
  });

  it("o schema aceita a grade padrao e recusa fim antes do inicio", () => {
    const valido = horarioSchema.safeParse({
      modo: "fora_expediente",
      minutosSemResposta: 10,
      expediente: expedientePadrao(),
    });
    expect(valido.success).toBe(true);

    const expediente = expedientePadrao();
    expediente.seg = { aberto: true, inicio: "18:00", fim: "08:00" };
    const invalido = horarioSchema.safeParse({
      modo: "fora_expediente",
      minutosSemResposta: 10,
      expediente,
    });
    expect(invalido.success).toBe(false);
    if (!invalido.success) {
      expect(invalido.error.issues[0]?.path).toEqual([
        "expediente",
        "seg",
        "fim",
      ]);
      expect(invalido.error.issues[0]?.message).toContain("Segunda-feira");
    }

    // Dia fechado nao confere a ordem das horas.
    const fechado = expedientePadrao();
    fechado.dom = { aberto: false, inicio: "18:00", fim: "08:00" };
    expect(
      horarioSchema.safeParse({
        modo: "24h",
        minutosSemResposta: 5,
        expediente: fechado,
      }).success,
    ).toBe(true);
  });

  it("o schema recusa hora fora do formato e minutos fora da faixa", () => {
    const expediente = expedientePadrao();
    expediente.ter = { aberto: true, inicio: "8:00", fim: "18:00" };
    expect(
      horarioSchema.safeParse({
        modo: "24h",
        minutosSemResposta: 5,
        expediente,
      }).success,
    ).toBe(false);
    for (const minutos of [0, -1, 121, 2.5]) {
      expect(
        horarioSchema.safeParse({
          modo: "fallback",
          minutosSemResposta: minutos,
          expediente: expedientePadrao(),
        }).success,
      ).toBe(false);
    }
    expect(
      horarioSchema.safeParse({
        modo: "noite",
        minutosSemResposta: 5,
        expediente: expedientePadrao(),
      }).success,
    ).toBe(false);
  });

  it("vai e volta do banco sem perder nada", () => {
    const horario: HorarioDeOperacao = {
      modo: "fallback",
      minutosSemResposta: 12,
      expediente: {
        ...expedientePadrao(),
        sab: { aberto: true, inicio: "08:00", fim: "12:00" },
      },
    };
    expect(horarioDoBanco(horarioParaOBanco(horario))).toEqual(horario);
  });

  it("le do banco o que estiver fora do formato como padrao", () => {
    const lido = horarioDoBanco({
      operating_mode: "outro",
      fallback_minutes: null,
      operating_hours: {
        seg: { aberto: true, inicio: "10:00", fim: "09:00" },
        ter: { aberto: true, inicio: "07:30", fim: "12:00" },
        qua: "x",
      },
    });
    const padrao = horarioPadrao();
    expect(lido.modo).toBe("24h");
    expect(lido.minutosSemResposta).toBe(5);
    expect(lido.expediente.seg).toEqual(padrao.expediente.seg);
    expect(lido.expediente.ter).toEqual({
      aberto: true,
      inicio: "07:30",
      fim: "12:00",
    });
    expect(lido.expediente.qua).toEqual(padrao.expediente.qua);
    expect(
      horarioDoBanco({
        operating_mode: "24h",
        fallback_minutes: 5,
        operating_hours: null,
      }),
    ).toEqual(padrao);
  });

  it("dia fechado nao valida as horas, nao perde as que estao no formato e volta fechado do banco (achado 14)", () => {
    // O cenario do achado: inicio 18:00 e fim 08:00 na segunda, e a segunda
    // fechada. Antes, voltava do banco ABERTA das 08:00 as 18:00 e o
    // assistente deixava de responder num dia em que a clinica fecha.
    const expediente = expedientePadrao();
    expediente.seg = { aberto: false, inicio: "18:00", fim: "08:00" };
    // Horas apagadas num dia fechado (o campo some da tela) nao travam o
    // Salvar: viram a hora padrao.
    expediente.ter = { aberto: false, inicio: "", fim: "9" };
    const lido = horarioSchema.safeParse({
      modo: "fora_expediente",
      minutosSemResposta: 5,
      expediente,
    });
    expect(lido.success).toBe(true);
    if (!lido.success) {
      return;
    }
    expect(lido.data.expediente.seg).toEqual({
      aberto: false,
      inicio: "18:00",
      fim: "08:00",
    });
    expect(lido.data.expediente.ter).toEqual({
      aberto: false,
      inicio: "08:00",
      fim: "18:00",
    });
    const devolta = horarioDoBanco(horarioParaOBanco(lido.data));
    expect(devolta).toEqual(lido.data);
    // Segunda, 10h em Fortaleza (13h UTC): fora do expediente, atende.
    expect(
      agenteAtendeAgora(
        devolta,
        Date.UTC(2026, 9, 5, 13, 0),
        "America/Fortaleza",
      ),
    ).toEqual({ atende: true, motivo: "fora_do_expediente" });

    // Dia ABERTO continua exigindo as duas horas, com a mensagem no campo.
    const aberto = expedientePadrao();
    aberto.qua = { aberto: true, inicio: "", fim: "18:00" };
    const invalido = horarioSchema.safeParse({
      modo: "fora_expediente",
      minutosSemResposta: 5,
      expediente: aberto,
    });
    expect(invalido.success).toBe(false);
    if (!invalido.success) {
      expect(invalido.error.issues[0]?.path).toEqual([
        "expediente",
        "qua",
        "inicio",
      ]);
      expect(invalido.error.issues[0]?.message).toBe(
        "Use a hora no formato 08:00.",
      );
    }
  });

  it("do banco, preserva aberto: aberto com hora estragada continua aberto, nas horas padrao", () => {
    const lido = horarioDoBanco({
      operating_mode: "fora_expediente",
      fallback_minutes: 5,
      operating_hours: {
        dom: { aberto: true, inicio: "x", fim: "18:00" },
        seg: { aberto: false, inicio: "x", fim: "07:00" },
        ter: { inicio: "08:00", fim: "18:00" },
      },
    });
    expect(lido.expediente.dom).toEqual({
      aberto: true,
      inicio: "08:00",
      fim: "18:00",
    });
    expect(lido.expediente.seg).toEqual({
      aberto: false,
      inicio: "08:00",
      fim: "07:00",
    });
    // Sem dizer se abre: o padrao do dia.
    expect(lido.expediente.ter).toEqual(horarioPadrao().expediente.ter);
  });

  it("descreve cada modo com o tempo de espera no plural certo", () => {
    expect(descricaoDoModo("fallback", 1)).toContain("1 minuto.");
    expect(descricaoDoModo("fallback", 7)).toContain("7 minutos.");
    for (const modo of MODOS_DE_OPERACAO) {
      expect(ROTULO_DO_MODO[modo].length).toBeGreaterThan(0);
      expect(descricaoDoModo(modo, 5)).not.toMatch(TRAVESSAO);
    }
  });

  it("os dias seguem Date.getDay (0 = domingo)", () => {
    expect(DIAS_DA_SEMANA[0]).toBe("dom");
    expect(DIAS_DA_SEMANA[6]).toBe("sab");
    expect(ROTULO_DO_DIA.seg).toBe("Segunda-feira");
  });
});

describe("escalonamento e conformidade", () => {
  it("os motivos espelham o CHECK de escalation_reason da migration mais nova que o define", () => {
    // O CHECK foi redefinido no E3 (falha_tecnica, teto_de_respostas,
    // nao_individual e pedido_de_agenda), na onda 2 (fora_do_assunto,
    // migration 20261022110000) e na AG3 (consulta_para_outra_pessoa,
    // ja_tem_consulta e faltam_dados, migration 20261027120000): vale o da
    // migration mais nova.
    const pasta = "supabase/migrations";
    const arquivos = readdirSync(pasta)
      .filter((arquivo) => arquivo.endsWith(".sql"))
      .sort()
      .reverse();
    let bloco: string | null = null;
    let arquivoDoCheck: string | null = null;
    for (const arquivo of arquivos) {
      const sql = readFileSync(`${pasta}/${arquivo}`, "utf-8");
      const achado = [
        ...sql.matchAll(
          /escalation_reason is null or escalation_reason in \(([\s\S]*?)\)\)/g,
        ),
      ].at(-1);
      if (achado) {
        bloco = achado[1] ?? "";
        arquivoDoCheck = arquivo;
        break;
      }
    }
    expect(bloco).not.toBeNull();
    expect((arquivoDoCheck ?? "") >= "20261027120000").toBe(true);
    const doBanco = [...(bloco ?? "").matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    expect([...MOTIVOS_DE_ESCALONAMENTO].sort()).toEqual(doBanco.sort());
    expect(MOTIVOS_DE_ESCALONAMENTO).toHaveLength(21);
  });

  it("AG3: os três motivos novos têm o rótulo do banco", () => {
    expect(ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.consulta_para_outra_pessoa).toBe(
      "a consulta é para outra pessoa",
    );
    expect(ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.ja_tem_consulta).toBe(
      "o paciente já tem consulta marcada deste procedimento",
    );
    expect(ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.faltam_dados).toBe(
      "faltaram dados do paciente para marcar",
    );
  });

  it("os 6 gatilhos obrigatorios sao motivos validos", () => {
    expect(GATILHOS_OBRIGATORIOS.map((g) => g.chave)).toEqual([
      "sintoma",
      "pedido_humano",
      "insatisfacao",
      "falhas_seguidas",
      "valor_fora_da_tabela",
      "menor_de_idade",
    ]);
    for (const gatilho of GATILHOS_OBRIGATORIOS) {
      expect(MOTIVOS_DE_ESCALONAMENTO).toContain(gatilho.chave);
    }
  });

  it("a caixa de conformidade tem o texto do brief e as 8 travas", () => {
    expect(TEXTO_DA_CONFORMIDADE.texto).toBe(
      "Estas travas são obrigatórias e não podem ser desligadas: o agente não faz triagem de sintoma, não indica tratamento ou medicamento, não promete resultado, e não faz oferta casada. Base: Resoluções CFM 2.314/2022 e 2.336/2023.",
    );
    expect(TEXTO_DA_CONFORMIDADE.travas.map((t) => t.categoria)).toEqual([
      ...CATEGORIAS_CLINICAS,
    ]);
    expect(Object.keys(ROTULO_DA_TRAVA).sort()).toEqual(
      [...CATEGORIAS_CLINICAS].sort(),
    );
  });
});

describe("schemas da persona, da base e das instrucoes", () => {
  it("persona: apara, vazio vira nulo e confere o nome", () => {
    const lida = personaSchema.parse({
      nome: "  Ana Clara ",
      tom: "proximo",
      usarEmoji: true,
      saudacao: "   ",
      encerramento: " Até logo! ",
    });
    expect(lida).toEqual({
      nome: "Ana Clara",
      tom: "proximo",
      usarEmoji: true,
      saudacao: null,
      encerramento: "Até logo!",
    });
    expect(personaParaOBanco(lida)).toEqual({
      agent_name: "Ana Clara",
      tone: "proximo",
      use_emoji: true,
      greeting: null,
      closing: "Até logo!",
    });
  });

  it("persona: nomes validos e invalidos", () => {
    const base = {
      tom: "cordial",
      usarEmoji: false,
      saudacao: null,
      encerramento: null,
    };
    for (const nome of ["Ana", "Maria-Luísa", "D'Ávila", "Ana Clara"]) {
      expect(personaSchema.safeParse({ ...base, nome }).success, nome).toBe(
        true,
      );
    }
    for (const nome of [
      "",
      "Ana 2",
      "Dra. Ana",
      "<b>Ana</b>",
      "a".repeat(41),
      "Ana--Bia",
    ]) {
      expect(personaSchema.safeParse({ ...base, nome }).success, nome).toBe(
        false,
      );
    }
  });

  it("persona: limites da saudacao e do encerramento e tom fechado", () => {
    const base = {
      nome: "Ana",
      tom: "cordial",
      usarEmoji: false,
      saudacao: null,
      encerramento: null,
    };
    expect(
      personaSchema.safeParse({ ...base, saudacao: "a".repeat(300) }).success,
    ).toBe(true);
    expect(
      personaSchema.safeParse({ ...base, saudacao: "a".repeat(301) }).success,
    ).toBe(false);
    expect(
      personaSchema.safeParse({ ...base, encerramento: "a".repeat(301) })
        .success,
    ).toBe(false);
    expect(personaSchema.safeParse({ ...base, tom: "seco" }).success).toBe(
      false,
    );
  });

  it("item da base: limites, apara e id", () => {
    expect(
      itemDaBaseSchema.parse({
        id: null,
        pergunta: " Tem estacionamento? ",
        resposta: " Sim, no prédio. ",
        ativo: true,
      }),
    ).toEqual({
      id: null,
      pergunta: "Tem estacionamento?",
      resposta: "Sim, no prédio.",
      ativo: true,
    });
    const valido = {
      id: ID_A,
      pergunta: "a".repeat(200),
      resposta: "b".repeat(600),
      ativo: false,
    };
    expect(itemDaBaseSchema.safeParse(valido).success).toBe(true);
    for (const errado of [
      { ...valido, pergunta: "a".repeat(201) },
      { ...valido, resposta: "b".repeat(601) },
      { ...valido, pergunta: "  " },
      { ...valido, resposta: "" },
      { ...valido, id: "123" },
    ]) {
      expect(itemDaBaseSchema.safeParse(errado).success).toBe(false);
    }
  });

  it("instrucoes: ate 2.000 caracteres, vazio vira nulo", () => {
    expect(instrucoesSchema.parse({ instrucoes: "  " })).toEqual({
      instrucoes: null,
    });
    expect(instrucoesSchema.parse({ instrucoes: null })).toEqual({
      instrucoes: null,
    });
    expect(
      instrucoesSchema.safeParse({ instrucoes: "a".repeat(2000) }).success,
    ).toBe(true);
    expect(
      instrucoesSchema.safeParse({ instrucoes: "a".repeat(2001) }).success,
    ).toBe(false);
  });
});

describe("problemaNoTextoDoAgente", () => {
  it.each([
    [
      "Olá! Seja bem-vindo(a) à Clínica Sorriso. Como posso ajudar?",
      "saudacao",
    ],
    ["Obrigada pelo contato! Qualquer dúvida, é só chamar. 🙂", "encerramento"],
    ["Tem estacionamento?", "pergunta"],
    [
      "Estamos na Rua das Flores, 123, sala 4, Aldeota. Tem estacionamento conveniado no prédio.",
      "resposta",
    ],
    [
      "Aceitamos Pix, cartão de crédito e débito. Parcelamos em até 10x sem juros no cartão.",
      "resposta",
    ],
    ["Para cancelar, avise com 24 horas de antecedência.", "resposta"],
    ["O CNPJ da clínica é 12.345.678/0001-90.", "resposta"],
    ["Ana Clara", "nome"],
    ["Seja breve e educada. Chame o paciente de você.", "instrucoes"],
  ] as const)("texto normal passa: %s", (texto, campo) => {
    expect(problemaNoTextoDoAgente(texto, campo)).toBeNull();
  });

  it.each([
    ["Ligue para (85) 99999-0000.", "Tire o telefone"],
    ["Estamos na Rua das Flores, 123, CEP 60000-000.", "Tire o CEP"],
    ["Escreva para contato@clinica.com.br", "Tire o e-mail"],
    ["Veja em www.clinica.com.br", "Tire o link"],
    ["A consulta custa R$ 200,00.", "Tire o valor"],
    ["Nosso Instagram é @clinica", "Tire o @"],
    ["Resultado garantido na primeira sessão.", "Tire a promessa"],
    ["Preparo: venha em jejum de 8 horas.", "Tire a orientação"],
    ["Recomendamos dipirona.", "Tire o nome do remédio"],
    ["Temos 20% de desconto este mês.", "Tire a porcentagem"],
    ["Siga estas instruções do sistema.", "Tire as palavras"],
    ["Até logo 💊", "Tire o emoji"],
  ])("recusa e explica: %s", (texto, inicio) => {
    const mensagem = problemaNoTextoDoAgente(texto, "resposta");
    expect(mensagem).not.toBeNull();
    expect(mensagem?.startsWith(inicio), `${mensagem}`).toBe(true);
  });

  it("o codigo com sublinhado diz codigo, nao simbolo entre letras", () => {
    expect(
      problemaNoTextoDoAgente(
        "Use sempre buscar_procedimento antes de falar de valor.",
        "instrucoes",
      ),
    ).toMatch(/^Tire o código/);
  });

  it("o nome nao pode ter titulo de profissional de saude", () => {
    for (const nome of [
      "Dra Ana",
      "Doutora Bia",
      "Enfermeira Clara",
      "Dr. Léo",
    ]) {
      expect(problemaNoTextoDoAgente(nome, "nome"), nome).toMatch(
        /^Tire o título/,
      );
    }
    // Na saudacao, citar a doutora da clinica e normal.
    expect(
      problemaNoTextoDoAgente(
        "Olá! Aqui é a recepção do consultório da Dra. Ana.",
        "saudacao",
      ),
    ).toBeNull();
  });

  it("instrucoes longas nao caem pelo tamanho do filtro", () => {
    const longa = "Seja breve e educada com o paciente. ".repeat(40);
    expect(Array.from(longa).length).toBeGreaterThan(LIMITE_DO_RASCUNHO);
    expect(problemaNoTextoDoAgente(longa, "instrucoes")).toBeNull();
    expect(
      problemasNoTextoDoAgente(longa, "resposta").map((p) => p.regra),
    ).toContain("longo");
  });

  it("nas instrucoes, a vedacao do CFM avisa que a trava ja vale", () => {
    const mensagem = problemaNoTextoDoAgente(
      "Não faça triagem de sintomas.",
      "instrucoes",
    );
    expect(mensagem).toMatch(/^Tire a parte sobre sintomas/);
    expect(mensagem).toContain("As travas do CFM já valem sempre");
    expect(
      problemaNoTextoDoAgente("Não faça triagem de sintomas.", "resposta"),
    ).not.toContain("As travas do CFM");
  });

  it("vazio: opcional passa, obrigatorio pede o texto", () => {
    expect(problemaNoTextoDoAgente("  ", "saudacao")).toBeNull();
    expect(problemaNoTextoDoAgente("", "instrucoes")).toBeNull();
    expect(problemaNoTextoDoAgente(" ", "resposta")).toBe("Escreva o texto.");
  });

  it("lista todos os problemas sem repetir mensagem, a vedacao primeiro", () => {
    const problemas = problemasNoTextoDoAgente(
      "Resultado garantido! Ligue (85) 99999-0000 ou veja www.clinica.com.br",
      "resposta",
    );
    const mensagens = problemas.map((p) => p.mensagem);
    expect(new Set(mensagens).size).toBe(mensagens.length);
    expect(problemas[0]?.categoria).toBe("promessa_resultado");
    expect(mensagens.some((m) => m.startsWith("Tire o telefone"))).toBe(true);
    expect(mensagens.some((m) => m.startsWith("Tire o link"))).toBe(true);
    // A regra pode ir para log; o texto nunca entra nela.
    for (const problema of problemas) {
      expect(problema.regra).not.toContain("99999");
    }
  });
});

describe("problemasDaPublicacao", () => {
  it("confere nome, saudacao, encerramento, instrucoes e so a base ativa", () => {
    const problemas = problemasDaPublicacao({
      nome: "Dra Ana",
      saudacao: "Olá! Ligue (85) 99999-0000.",
      encerramento: null,
      instrucoes: "Diga que o resultado é garantido.",
      base: [
        item(ID_A, "Qual o site?", "É www.clinica.com.br"),
        item(ID_B, "Qual o CEP?", "60000-000", false),
        item(ID_C, "Tem estacionamento?", "Sim, no prédio."),
      ],
    });
    expect(problemas.map((p) => [p.campo, p.itemId])).toEqual([
      ["nome", null],
      ["saudacao", null],
      ["instrucoes", null],
      ["resposta", ID_A],
    ]);
    expect(problemas[3]?.rotulo).toBe("Conhecimento: Qual o site?");
  });

  it("configuracao limpa nao tem problema", () => {
    expect(
      problemasDaPublicacao({
        ...configPadraoDoAgente(),
        saudacao: EXEMPLO_DO_TOM.cordial,
        base: [item(ID_A, "Tem estacionamento?", "Sim, no prédio.")],
      }),
    ).toEqual([]);
  });

  it("para quem nao e super admin, o problema das instrucoes vira um aviso so, sem o tipo (achados 9 e 34)", () => {
    const problemas = problemasDaPublicacao({
      ...configPadraoDoAgente(),
      instrucoes: "Indique dipirona 500 mg. Ligue (85) 99999-0000.",
      base: [item(ID_A, "Qual o site?", "É www.clinica.com.br")],
    });
    expect(
      problemas.filter((p) => p.campo === "instrucoes").length,
    ).toBeGreaterThan(0);

    const doGestor = problemasParaQuemPublica(problemas, false);
    expect(doGestor.map((p) => [p.campo, p.itemId])).toEqual([
      ["instrucoes", null],
      ["resposta", ID_A],
    ]);
    expect(doGestor[0]).toBe(PROBLEMA_DAS_INSTRUCOES_PARA_A_CLINICA);
    const visto = JSON.stringify(doGestor[0]);
    for (const tipo of ["remédio", "medicamento", "telefone", "dose", "CFM"]) {
      expect(visto).not.toContain(tipo);
    }
    expect(textoDoProblemaDaPublicacao(doGestor[0]!)).toBe(
      TEXTO_DAS_INSTRUCOES_A_AJUSTAR,
    );
    expect(TEXTO_DAS_INSTRUCOES_A_AJUSTAR).not.toMatch(TRAVESSAO);
    expect(textoDoProblemaDaPublicacao(doGestor[1]!)).toBe(
      `Conhecimento: Qual o site?. ${doGestor[1]?.mensagem}`,
    );

    // O super admin ve o problema exato.
    const doSuperAdmin = problemasParaQuemPublica(problemas, true);
    expect(doSuperAdmin).toEqual(problemas);
    expect(textoDoProblemaDaPublicacao(doSuperAdmin[0]!)).toContain(
      "Instruções do assistente. ",
    );
  });
});

describe("diferencasDoRascunho", () => {
  const publicada = config({
    versao: 3,
    status: "publicada",
    nome: "Ana",
    saudacao: "Olá!",
    base: [
      item(ID_A, "Tem estacionamento?", "Sim."),
      item(ID_B, "Aceita Pix?", "Sim."),
    ],
  });

  it("rascunho igual a publicada nao tem mudanca", () => {
    const rascunho = config({
      ...publicada,
      versao: 4,
      status: "rascunho",
      saudacao: " Olá! ",
      base: [
        item(ID_A, "Tem estacionamento?", "Sim."),
        item(ID_B, "Aceita Pix?", "Sim."),
        item(ID_C, "Rascunho antigo", "Desativado.", false),
      ],
    });
    expect(diferencasDoRascunho(rascunho, publicada)).toEqual([]);
  });

  it("conta cada campo, habilidade, dia e item da base", () => {
    const expediente = expedientePadrao();
    expediente.sab = { aberto: true, inicio: "08:00", fim: "12:00" };
    const rascunho = config({
      versao: 4,
      nome: "Bia",
      tom: "formal",
      usarEmoji: true,
      saudacao: null,
      encerramento: "Até logo!",
      habilidades: { informar_preco_e_convenio: false },
      horario: {
        modo: "fora_expediente",
        minutosSemResposta: 5,
        expediente,
      },
      base: [
        item(ID_A, "Tem estacionamento?", "Sim, no subsolo."),
        item(ID_B, "Aceita Pix?", "Sim.", false),
        item(ID_C, "Atende sábado?", "Sim, de manhã."),
      ],
    });
    expect(diferencasDoRascunho(rascunho, publicada)).toEqual([
      { campo: "nome", rotulo: "Nome do assistente" },
      { campo: "tom", rotulo: "Tom de voz: Formal" },
      { campo: "usarEmoji", rotulo: "Emoji ligado" },
      { campo: "saudacao", rotulo: "Saudação" },
      { campo: "encerramento", rotulo: "Encerramento" },
      {
        campo: "habilidades",
        rotulo: "Informar preço e convênio: desligada",
      },
      {
        campo: "horario",
        rotulo: "Horário de operação: Só fora do expediente",
      },
      { campo: "horario", rotulo: "Expediente: Sábado" },
      { campo: "base", rotulo: "Pergunta alterada: Tem estacionamento?" },
      { campo: "base", rotulo: "Pergunta desativada: Aceita Pix?" },
      { campo: "base", rotulo: "Pergunta incluída: Atende sábado?" },
    ]);
  });

  it("item excluido da base conta", () => {
    const rascunho = config({
      ...publicada,
      status: "rascunho",
      base: [item(ID_A, "Tem estacionamento?", "Sim.")],
    });
    expect(diferencasDoRascunho(rascunho, publicada)).toEqual([
      { campo: "base", rotulo: "Pergunta excluída: Aceita Pix?" },
    ]);
  });

  it("conta cada campo da agenda e a habilidade como vale de fato", () => {
    const rascunho = config({
      ...publicada,
      status: "rascunho",
      habilidades: { agendar: true, confirmar_presenca: true },
      agenda: { antecedenciaHoras: 1, horizonteDias: 30 },
    });
    expect(diferencasDoRascunho(rascunho, publicada)).toEqual([
      { campo: "habilidades", rotulo: "Agendar consulta: ligada" },
      { campo: "habilidades", rotulo: "Confirmar presença: ligada" },
      { campo: "agenda", rotulo: "Antecedência mínima para marcar: 1 hora" },
      { campo: "agenda", rotulo: "Até quantos dias à frente: 30 dias" },
    ]);
    // Agendar ligada no jsonb sem a agenda completa nao conta como ligada.
    const semHorizonte = config({
      ...publicada,
      status: "rascunho",
      habilidades: { agendar: true },
      agenda: { antecedenciaHoras: 0, horizonteDias: null },
    });
    expect(diferencasDoRascunho(semHorizonte, publicada)).toEqual([
      { campo: "agenda", rotulo: "Antecedência mínima para marcar: 0 horas" },
    ]);
    // Apagar um campo da publicada desliga a habilidade.
    const publicadaComAgenda = config({
      ...publicada,
      habilidades: { agendar: true },
      agenda: { antecedenciaHoras: 2, horizonteDias: 1 },
    });
    expect(
      diferencasDoRascunho(
        {
          ...publicadaComAgenda,
          status: "rascunho",
          agenda: { antecedenciaHoras: 2, horizonteDias: null },
        },
        publicadaComAgenda,
      ),
    ).toEqual([
      { campo: "habilidades", rotulo: "Agendar consulta: desligada" },
      { campo: "agenda", rotulo: "Até quantos dias à frente: não preenchido" },
    ]);
    expect(
      diferencasDoRascunho(
        {
          ...publicadaComAgenda,
          status: "rascunho",
          agenda: { antecedenciaHoras: null, horizonteDias: 1 },
        },
        publicadaComAgenda,
      ).map((m) => m.rotulo),
    ).toEqual([
      "Agendar consulta: desligada",
      "Antecedência mínima para marcar: não preenchida",
    ]);
  });

  it("instrucoes contam so quando foram lidas e mudaram", () => {
    const rascunho = config({ ...publicada, status: "rascunho" });
    expect(
      diferencasDoRascunho(
        { ...rascunho, instrucoes: "Seja breve." },
        { ...publicada, instrucoes: "Seja breve." },
      ),
    ).toEqual([]);
    expect(
      diferencasDoRascunho(
        { ...rascunho, instrucoes: "Seja breve e gentil." },
        { ...publicada, instrucoes: "Seja breve." },
      ),
    ).toEqual([
      { campo: "instrucoes", rotulo: "Instruções da equipe Conduzza" },
    ]);
  });

  it("sem publicada compara com os padroes e sempre tem o que publicar", () => {
    expect(diferencasDoRascunho(configPadraoDoAgente(), null)).toEqual([
      { campo: "primeira_publicacao", rotulo: "Primeira versão do assistente" },
    ]);
    expect(
      diferencasDoRascunho(
        config({ base: [item(ID_A, "Tem estacionamento?", "Sim.")] }),
        null,
      ),
    ).toEqual([
      { campo: "base", rotulo: "Pergunta incluída: Tem estacionamento?" },
    ]);
  });

  it("pergunta longa aparece cortada no rotulo", () => {
    const longa = `${"Pergunta muito comprida ".repeat(5)}?`;
    const [mudanca] = diferencasDoRascunho(
      config({ base: [item(ID_A, longa, "Sim.")] }),
      null,
    );
    expect(mudanca?.rotulo.endsWith("…")).toBe(true);
    expect(Array.from(mudanca?.rotulo ?? "").length).toBeLessThanOrEqual(
      "Pergunta incluída: ".length + 60,
    );
  });

  it("a linha das instrucoes vem do servidor, sem conteudo, para todos (achados 16, 35 e 38)", () => {
    const base = { campo: "base" as const, rotulo: "Pergunta incluída: X" };
    const tom = { campo: "tom" as const, rotulo: "Tom de voz: Formal" };
    // Mudaram: entra antes das perguntas da base.
    expect(comMudancaDasInstrucoes([tom, base], true)).toEqual([
      tom,
      MUDANCA_DAS_INSTRUCOES,
      base,
    ]);
    // A comparacao do navegador nunca vale (para o super admin, uma leitura
    // que falhou criaria uma alteracao fantasma): sai sem o sinal.
    expect(
      comMudancaDasInstrucoes(
        [tom, { campo: "instrucoes", rotulo: "Instruções do assistente" }],
        false,
      ),
    ).toEqual([tom]);
    expect(comMudancaDasInstrucoes([MUDANCA_DAS_INSTRUCOES], null)).toEqual([]);
    // So as instrucoes mudaram numa primeira versao: a linha delas basta.
    expect(
      comMudancaDasInstrucoes(
        [
          {
            campo: "primeira_publicacao",
            rotulo: "Primeira versão do assistente",
          },
        ],
        true,
      ),
    ).toEqual([MUDANCA_DAS_INSTRUCOES]);
    expect(MUDANCA_DAS_INSTRUCOES.rotulo).toBe("Instruções da equipe Conduzza");
    expect(mesmasInstrucoes(" Seja breve. ", "Seja breve.")).toBe(true);
    expect(mesmasInstrucoes("", null)).toBe(true);
    expect(mesmasInstrucoes("Seja breve.", null)).toBe(false);
  });
});

describe("leitura do banco", () => {
  const linha: LinhaDaConfigDoAgente = {
    version: 2,
    status: "publicada",
    agent_name: "Ana",
    tone: "formal",
    use_emoji: true,
    greeting: "Olá!",
    closing: " ",
    skills: { informar_preco_e_convenio: false, agendar: true },
    operating_mode: "fallback",
    fallback_minutes: 15,
    operating_hours: null,
    agenda_antecedencia_horas: null,
    agenda_horizonte_dias: null,
  };

  it("monta a configuracao com a base e as instrucoes de fora", () => {
    const base = [item(ID_A, "Tem estacionamento?", "Sim.")];
    expect(configDaLinha(linha, { base, instrucoes: "Seja breve." })).toEqual({
      versao: 2,
      status: "publicada",
      nome: "Ana",
      tom: "formal",
      usarEmoji: true,
      saudacao: "Olá!",
      encerramento: null,
      // agendar esta ligada no jsonb, mas a agenda nao foi preenchida: vale
      // desligada (D13).
      habilidades: {
        responder_duvidas: true,
        informar_preco_e_convenio: false,
        agendar: false,
        confirmar_presenca: false,
        passar_para_equipe: true,
      },
      horario: { ...horarioPadrao(), modo: "fallback", minutosSemResposta: 15 },
      agenda: { antecedenciaHoras: null, horizonteDias: null },
      // Onda 2: coluna fora do select (ou antes da migration) e nula.
      publico: null,
      // AG3: colunas fora do select (ou antes da migration) leem falso,
      // como as versoes de antes da migration 20261027120000.
      dadosExigidos: { nomeCompleto: false, nascimento: false, cpf: false },
      instrucoes: "Seja breve.",
      base,
    });
  });

  it("le a agenda das duas colunas, e com ela agendar vale ligada", () => {
    const lida = configDaLinha(
      { ...linha, agenda_antecedencia_horas: 24, agenda_horizonte_dias: 30 },
      { base: [] },
    );
    expect(lida.agenda).toEqual({ antecedenciaHoras: 24, horizonteDias: 30 });
    expect(lida.habilidades.agendar).toBe(true);
    // Coluna fora do select (linha antiga em cache): falha fechada.
    const semColunas = { ...linha } as Partial<LinhaDaConfigDoAgente>;
    delete semColunas.agenda_antecedencia_horas;
    delete semColunas.agenda_horizonte_dias;
    const antiga = configDaLinha(semColunas as LinhaDaConfigDoAgente, {
      base: [],
    });
    expect(antiga.agenda).toEqual(agendaPadrao());
    expect(antiga.habilidades.agendar).toBe(false);
  });

  it("sem instrucoes (papel que nao le) chega nulo; valor fora do formato vira padrao", () => {
    const lida = configDaLinha(
      { ...linha, status: "outro", tone: "seco", agent_name: " " },
      { base: [] },
    );
    expect(lida.instrucoes).toBeNull();
    expect(lida.status).toBe("rascunho");
    expect(lida.tom).toBe("cordial");
    expect(lida.nome).toBe("Assistente");
  });

  it("le o conhecimento congelado e descarta o que esta fora do formato", () => {
    expect(
      baseDoConhecimento([
        { id: ID_A, pergunta: "Tem estacionamento?", resposta: "Sim." },
        { id: ID_B, pergunta: " ", resposta: "Sim." },
        { id: 3, pergunta: "x", resposta: "y" },
        "texto",
        null,
      ]),
    ).toEqual([item(ID_A, "Tem estacionamento?", "Sim.")]);
    expect(baseDoConhecimento(null)).toEqual([]);
    expect(baseDoConhecimento({})).toEqual([]);
  });

  it("o padrao e o do banco", () => {
    expect(configPadraoDoAgente()).toEqual({
      versao: 1,
      status: "rascunho",
      nome: "Assistente",
      tom: "cordial",
      usarEmoji: false,
      saudacao: null,
      encerramento: null,
      habilidades: {
        responder_duvidas: true,
        informar_preco_e_convenio: true,
        agendar: false,
        confirmar_presenca: false,
        passar_para_equipe: true,
      },
      horario: {
        modo: "24h",
        minutosSemResposta: 5,
        expediente: expedientePadrao(),
      },
      agenda: { antecedenciaHoras: null, horizonteDias: null },
      publico: null,
      // AG3 (D-6): o padrao da coluna para a primeira versao da clinica.
      dadosExigidos: { nomeCompleto: true, nascimento: true, cpf: false },
      instrucoes: null,
      base: [],
    });
  });
});

// Onda 2, item 4 (contrato 4.5; decisoes do dono P4a e P4b): quem o
// assistente atende mora na configuracao do agente (versionada).
describe("público do assistente", () => {
  const linha: LinhaDaConfigDoAgente = {
    version: 3,
    status: "publicada",
    agent_name: "Ana",
    tone: "cordial",
    use_emoji: false,
    greeting: null,
    closing: null,
    skills: {},
    operating_mode: "24h",
    fallback_minutes: 5,
    operating_hours: null,
    agenda_antecedencia_horas: null,
    agenda_horizonte_dias: null,
  };

  it("espelha o CHECK e tem os rótulos da tela", () => {
    expect([...PUBLICOS_DO_AGENTE]).toEqual(["leads", "pacientes", "todos"]);
    expect(ROTULO_DO_PUBLICO).toEqual({
      leads: "Só leads",
      pacientes: "Só pacientes",
      todos: "Leads e pacientes",
    });
    expect(ROTULO_DO_PUBLICO_NAO_ESCOLHIDO).toBe("Ainda não escolhido");
    for (const texto of [
      ...Object.values(ROTULO_DO_PUBLICO),
      ROTULO_DO_PUBLICO_NAO_ESCOLHIDO,
      ROTULO_DO_CAMPO_PUBLICO,
    ]) {
      expect(texto).not.toMatch(TRAVESSAO);
    }
  });

  it("publicoDoBanco: nulo, ausente e fora da lista viram nulo (ainda não escolhido)", () => {
    expect(publicoDoBanco("leads")).toBe("leads");
    expect(publicoDoBanco("pacientes")).toBe("pacientes");
    expect(publicoDoBanco("todos")).toBe("todos");
    for (const valor of [null, undefined, "", "Leads", "lead", 1, {}]) {
      expect(publicoDoBanco(valor), String(valor)).toBeNull();
    }
    expect(publicoParaOBanco("pacientes")).toEqual({
      publico_atendido: "pacientes",
    });
  });

  it("configDaLinha lê a coluna; sem ela, nulo", () => {
    expect(
      configDaLinha({ ...linha, publico_atendido: "leads" }, { base: [] })
        .publico,
    ).toBe("leads");
    expect(
      configDaLinha({ ...linha, publico_atendido: "outro" }, { base: [] })
        .publico,
    ).toBeNull();
    expect(configDaLinha(linha, { base: [] }).publico).toBeNull();
  });

  it("o schema aceita só os três, com a mensagem de recepção", () => {
    expect(publicoSchema.parse({ publico: "todos" })).toEqual({
      publico: "todos",
    });
    for (const publico of [null, "", "leads ", "paciente", undefined]) {
      const lido = publicoSchema.safeParse({ publico });
      expect(lido.success, String(publico)).toBe(false);
      if (!lido.success) {
        expect(lido.error.issues[0]?.message).toBe(
          "Escolha quem o assistente atende.",
        );
      }
    }
  });

  it("entra no 'o que mudou' das Versões: escolher, trocar e voltar a nulo", () => {
    const publicada = {
      ...configPadraoDoAgente(),
      status: "publicada" as const,
    };
    const escolhida = { ...configPadraoDoAgente(), publico: "leads" as const };
    expect(diferencasDoRascunho(escolhida, publicada)).toEqual([
      { campo: "publico", rotulo: "Quem o assistente atende: Só leads" },
    ]);
    expect(
      diferencasDoRascunho(
        { ...escolhida, publico: "todos" },
        { ...publicada, publico: "leads" },
      ),
    ).toEqual([
      {
        campo: "publico",
        rotulo: "Quem o assistente atende: Leads e pacientes",
      },
    ]);
    expect(
      diferencasDoRascunho(
        { ...configPadraoDoAgente(), publico: null },
        { ...publicada, publico: "pacientes" },
      ),
    ).toEqual([
      {
        campo: "publico",
        rotulo: "Quem o assistente atende: Ainda não escolhido",
      },
    ]);
    // Igual nos dois lados: nada muda.
    expect(
      diferencasDoRascunho(escolhida, { ...publicada, publico: "leads" }),
    ).toEqual([]);
  });

  it("tipo do contato: só lead ou paciente (e o Testar como valida o mesmo)", () => {
    expect([...TIPOS_DO_CONTATO]).toEqual(["lead", "paciente"]);
    expect(tipoDoContatoSchema.parse("lead")).toBe("lead");
    expect(tipoDoContatoSchema.parse(null)).toBeNull();
    for (const valor of ["", "Lead", "cliente", 1, undefined]) {
      expect(tipoDoContatoSchema.safeParse(valor).success, String(valor)).toBe(
        false,
      );
    }
    expect(tipoDoContatoDoBanco("lead")).toBe("lead");
    expect(tipoDoContatoDoBanco("paciente")).toBe("paciente");
    for (const valor of [null, undefined, "", "Lead", "cliente"]) {
      expect(tipoDoContatoDoBanco(valor), String(valor)).toBeNull();
    }
  });
});

// AG3 (migration 20261027120000; decisao D-6 do dono, padrao recomendado):
// os dados que a IA pede antes de marcar moram na configuracao do agente
// (versionados), nas colunas exige_nome_completo, exige_nascimento e
// exige_cpf.
describe("dados para marcar consulta (AG3)", () => {
  const MIGRATION_DA_AG3 =
    "supabase/migrations/20261027120000_agendamento_completo_da_ia.sql";
  const linha: LinhaDaConfigDoAgente = {
    version: 3,
    status: "publicada",
    agent_name: "Ana",
    tone: "cordial",
    use_emoji: false,
    greeting: null,
    closing: null,
    skills: {},
    operating_mode: "24h",
    fallback_minutes: 5,
    operating_hours: null,
    agenda_antecedencia_horas: null,
    agenda_horizonte_dias: null,
  };

  it("a lista e os rótulos da tela, sem travessão", () => {
    expect(DADOS_EXIGIDOS.map((d) => d.chave)).toEqual([
      "nomeCompleto",
      "nascimento",
      "cpf",
    ]);
    expect(DADOS_EXIGIDOS.map((d) => d.rotulo)).toEqual([
      "Nome completo",
      "Data de nascimento",
      "CPF",
    ]);
    expect(ROTULO_DOS_DADOS_EXIGIDOS).toBe("Dados para marcar consulta");
    for (const texto of [
      ROTULO_DOS_DADOS_EXIGIDOS,
      ...DADOS_EXIGIDOS.flatMap((d) => [d.rotulo, d.noTexto]),
    ]) {
      expect(texto).not.toMatch(TRAVESSAO);
      expect(texto).not.toMatch(JARGAO);
    }
  });

  it("o padrão é o da coluna para a primeira versão (nome completo e nascimento, sem CPF)", () => {
    expect(dadosExigidosPadrao()).toEqual({
      nomeCompleto: true,
      nascimento: true,
      cpf: false,
    });
    const sql = readFileSync(MIGRATION_DA_AG3, "utf-8");
    // As versoes que existem leem falso; a coluna passa a nascer verdadeira
    // so para nome completo e nascimento.
    expect(sql).toMatch(
      /add column exige_nome_completo boolean not null default false/,
    );
    expect(sql).toMatch(/alter column exige_nome_completo set default true/);
    expect(sql).toMatch(/alter column exige_nascimento set default true/);
    expect(sql).toMatch(/add column exige_cpf boolean not null default false/);
    expect(sql).not.toMatch(/alter column exige_cpf set default true/);
  });

  it("a Tela 6 lê as três colunas, que têm o grant por coluna da sessão", () => {
    for (const coluna of [
      "exige_nome_completo",
      "exige_nascimento",
      "exige_cpf",
    ]) {
      expect(COLUNAS_DA_CONFIG_DO_AGENTE).toContain(coluna);
    }
    const sql = readFileSync(MIGRATION_DA_AG3, "utf-8").replace(/\s+/g, " ");
    expect(sql).toContain(
      "grant select (exige_nome_completo, exige_nascimento, exige_cpf), update (exige_nome_completo, exige_nascimento, exige_cpf) on public.ai_agent_config to authenticated",
    );
  });

  it("do banco: só true conta; nulo, ausente ou outro valor lê falso", () => {
    expect(
      dadosExigidosDoBanco({
        exige_nome_completo: true,
        exige_nascimento: false,
        exige_cpf: true,
      }),
    ).toEqual({ nomeCompleto: true, nascimento: false, cpf: true });
    expect(dadosExigidosDoBanco({})).toEqual({
      nomeCompleto: false,
      nascimento: false,
      cpf: false,
    });
    expect(
      dadosExigidosDoBanco({
        exige_nome_completo: null,
        exige_nascimento: "true",
        exige_cpf: 1,
      }),
    ).toEqual({ nomeCompleto: false, nascimento: false, cpf: false });
    expect(
      dadosExigidosParaOBanco({
        nomeCompleto: true,
        nascimento: false,
        cpf: true,
      }),
    ).toEqual({
      exige_nome_completo: true,
      exige_nascimento: false,
      exige_cpf: true,
    });
  });

  it("configDaLinha lê as três colunas; sem elas, falso", () => {
    expect(
      configDaLinha(
        {
          ...linha,
          exige_nome_completo: true,
          exige_nascimento: true,
          exige_cpf: true,
        },
        { base: [] },
      ).dadosExigidos,
    ).toEqual({ nomeCompleto: true, nascimento: true, cpf: true });
    expect(configDaLinha(linha, { base: [] }).dadosExigidos).toEqual({
      nomeCompleto: false,
      nascimento: false,
      cpf: false,
    });
  });

  it("o schema aceita os três booleanos e recusa o resto (a ação usa o strict)", () => {
    expect(
      dadosExigidosSchema.parse({
        nomeCompleto: true,
        nascimento: false,
        cpf: true,
      }),
    ).toEqual({ nomeCompleto: true, nascimento: false, cpf: true });
    for (const entrada of [
      {},
      { nomeCompleto: true, nascimento: true },
      { nomeCompleto: "sim", nascimento: true, cpf: false },
      { nomeCompleto: true, nascimento: null, cpf: false },
      null,
      "tudo",
    ]) {
      expect(
        dadosExigidosSchema.safeParse(entrada).success,
        JSON.stringify(entrada),
      ).toBe(false);
    }
    expect(
      dadosExigidosSchema
        .strict()
        .safeParse({
          nomeCompleto: true,
          nascimento: true,
          cpf: false,
          extra: 1,
        }).success,
    ).toBe(false);
  });

  it("entra no 'o que mudou' contra a versão publicada: cada dado uma vez", () => {
    const publicada = config({
      status: "publicada",
      versao: 3,
      dadosExigidos: { nomeCompleto: false, nascimento: false, cpf: false },
    });
    const rascunho = config({
      versao: 4,
      dadosExigidos: { nomeCompleto: true, nascimento: true, cpf: false },
    });
    expect(diferencasDoRascunho(rascunho, publicada)).toEqual([
      {
        campo: "dados_exigidos",
        rotulo: "Dados para marcar consulta: pede o nome completo",
      },
      {
        campo: "dados_exigidos",
        rotulo: "Dados para marcar consulta: pede a data de nascimento",
      },
    ]);
    expect(
      diferencasDoRascunho(
        config({
          dadosExigidos: { nomeCompleto: false, nascimento: true, cpf: true },
        }),
        config({
          status: "publicada",
          dadosExigidos: { nomeCompleto: true, nascimento: true, cpf: false },
        }),
      ),
    ).toEqual([
      {
        campo: "dados_exigidos",
        rotulo: "Dados para marcar consulta: não pede o nome completo",
      },
      {
        campo: "dados_exigidos",
        rotulo: "Dados para marcar consulta: pede o CPF",
      },
    ]);
    // Igual nos dois lados: nada muda.
    expect(
      diferencasDoRascunho(rascunho, { ...rascunho, status: "publicada" }),
    ).toEqual([]);
  });

  it("sem versão publicada não conta: a versão 1 das clínicas de antes não ganha mudança que ninguém fez", () => {
    const antiga = config({
      status: "publicada",
      versao: 1,
      dadosExigidos: { nomeCompleto: false, nascimento: false, cpf: false },
    });
    expect(diferencasDoRascunho(antiga, null)).toEqual([
      { campo: "primeira_publicacao", rotulo: "Primeira versão do assistente" },
    ]);
    // O rascunho de quem nunca publicou continua com o que publicar.
    expect(
      diferencasDoRascunho(
        config({
          dadosExigidos: { nomeCompleto: true, nascimento: true, cpf: true },
        }),
        null,
      ),
    ).toEqual([
      { campo: "primeira_publicacao", rotulo: "Primeira versão do assistente" },
    ]);
  });
});

// Onda 2 (P6b): a proposta dos padroes de clinica nova. Nao esta ligada
// (o padrao continua o do banco), mas ja passa nas regras do texto do
// agente, para o dono aprovar sem retrabalho.
describe("padrões propostos de clínica nova (P6b, proposta)", () => {
  it("passam nas regras do texto do agente e no formato do nome, sem travessão", () => {
    const p = PADROES_PROPOSTOS_DA_CLINICA_NOVA;
    expect(
      personaSchema.safeParse({
        nome: p.nome,
        tom: "cordial",
        usarEmoji: false,
        saudacao: p.saudacao,
        encerramento: p.encerramento,
      }).success,
    ).toBe(true);
    expect(problemaNoTextoDoAgente(p.nome, "nome")).toBeNull();
    expect(problemaNoTextoDoAgente(p.saudacao, "saudacao")).toBeNull();
    expect(problemaNoTextoDoAgente(p.encerramento, "encerramento")).toBeNull();
    for (const texto of Object.values(p)) {
      expect(texto).not.toMatch(TRAVESSAO);
    }
  });

  // Revisao da onda 2: a saudacao vai logo antes do aviso de assistente
  // virtual (P11a) na primeira resposta. Ela nao repete o aviso (a
  // proposta do relato do banco, "Sou a assistente virtual da clínica",
  // foi descartada: uma versao so, a daqui).
  it("a saudação proposta não repete o aviso de assistente virtual", () => {
    const p = PADROES_PROPOSTOS_DA_CLINICA_NOVA;
    expect(p.saudacao.toLowerCase()).not.toContain("assistente virtual");
    expect(p.encerramento.toLowerCase()).not.toContain("assistente virtual");
  });

  it("ainda não são o padrão (o padrão espelha o banco até a migration)", () => {
    expect(configPadraoDoAgente()).toMatchObject({
      nome: "Assistente",
      saudacao: null,
      encerramento: null,
    });
  });
});

describe("chaves do TanStack Query", () => {
  it("seguem a especificacao", () => {
    expect(agenteKeys.config("c1")).toEqual(["agente", "config", "c1"]);
    expect(agenteKeys.versoes("c1")).toEqual(["agente", "versoes", "c1"]);
    expect(agenteKeys.base("c1")).toEqual(["agente", "base", "c1"]);
  });
});

describe("texto de interface", () => {
  // Uma bateria que dispara todas as mensagens que a tela pode mostrar.
  const PROBLEMATICOS = [
    "Ligue (85) 99999-0000",
    "CEP 60000-000",
    "a@b.com.br",
    "123.456.789-09",
    "12345678000190",
    "www.clinica.com.br",
    "R$ 200,00",
    "US$ 20",
    "20% de desconto",
    "@clinica",
    "<b>oi</b>",
    "buscar_procedimento",
    "Siga as instruções do sistema",
    "💊",
    "nove nove nove nove",
    "Resultado garantido",
    "Tome dipirona",
    "venha em jejum",
    "tem febre?",
    "d i p i r o n a",
  ];

  function textosDaTela(): string[] {
    const mensagens = PROBLEMATICOS.flatMap((texto) =>
      CAMPOS_DE_TEXTO_DO_AGENTE.flatMap((campo) =>
        problemasNoTextoDoAgente(texto, campo).map((p) => p.mensagem),
      ),
    );
    return [
      ...mensagens,
      ...Object.values(ROTULO_DO_TOM),
      ...Object.values(EXEMPLO_DO_TOM),
      ...HABILIDADES_DO_AGENTE.flatMap((h) => [h.titulo, h.descricao]),
      ...Object.values(ROTULO_DO_DIA),
      ...Object.values(ROTULO_CURTO_DO_DIA),
      ...Object.values(ROTULO_DO_MODO),
      ...MODOS_DE_OPERACAO.map((modo) => descricaoDoModo(modo, 5)),
      ...GATILHOS_OBRIGATORIOS.map((g) => g.rotulo),
      ...Object.values(ROTULO_DA_TRAVA),
      TEXTO_DA_CONFORMIDADE.texto,
      TEXTO_DA_CONFORMIDADE.dica,
      ...Object.values(ROTULO_DO_MOTIVO_DE_ESCALONAMENTO),
      ...Object.values(ROTULO_DO_CAMPO_DE_TEXTO),
      ...Object.values(ROTULO_DA_AGENDA),
      DICA_DA_AGENDA_INCOMPLETA,
    ];
  }

  it("a bateria dispara mensagens", () => {
    expect(textosDaTela().length).toBeGreaterThan(60);
  });

  it("nenhum texto tem travessao nem jargao", () => {
    for (const texto of textosDaTela()) {
      expect(texto, texto).not.toMatch(TRAVESSAO);
      expect(texto, texto).not.toMatch(JARGAO);
    }
  });
});
