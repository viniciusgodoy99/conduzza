import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  agenteAtendeAgora,
  agenteKeys,
  baseDoConhecimento,
  CAMPOS_DE_TEXTO_DO_AGENTE,
  comMudancaDasInstrucoes,
  configDaLinha,
  configPadraoDoAgente,
  descricaoDoModo,
  DIAS_DA_SEMANA,
  diferencasDoRascunho,
  EXEMPLO_DO_TOM,
  expedientePadrao,
  ferramentasDoAgente,
  GATILHOS_OBRIGATORIOS,
  HABILIDADES_DO_AGENTE,
  habilidadesEfetivas,
  habilidadesSchema,
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
  personaParaOBanco,
  personaSchema,
  PROBLEMA_DAS_INSTRUCOES_PARA_A_CLINICA,
  problemaNoTextoDoAgente,
  problemasDaPublicacao,
  problemasNoTextoDoAgente,
  problemasParaQuemPublica,
  ROTULO_CURTO_DO_DIA,
  ROTULO_DA_TRAVA,
  ROTULO_DO_CAMPO_DE_TEXTO,
  ROTULO_DO_DIA,
  ROTULO_DO_MODO,
  ROTULO_DO_MOTIVO_DE_ESCALONAMENTO,
  ROTULO_DO_TOM,
  TEXTO_DA_CONFORMIDADE,
  TEXTO_DAS_INSTRUCOES_A_AJUSTAR,
  textoDoProblemaDaPublicacao,
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

// Dominio puro da Tela 6 (configuracao do agente de IA). As outras partes
// (banco, motor, telas) dependem destes nomes e destas regras.

const CONTEXTO_VAZIO = {
  precosDoTurno: [],
  nomesDoCatalogo: [],
  mensagensDoPaciente: [],
} as const;

const TRAVESSAO = /[–—]/;
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
  it("e a lista fechada desta leva", () => {
    expect(HABILIDADES_DO_AGENTE.map((h) => h.chave)).toEqual([
      "responder_duvidas",
      "informar_preco_e_convenio",
      "passar_para_equipe",
    ]);
    const porChave = Object.fromEntries(
      HABILIDADES_DO_AGENTE.map((h) => [h.chave, h]),
    );
    expect(porChave.responder_duvidas?.travada).toBe(true);
    expect(porChave.responder_duvidas?.ferramenta).toBeNull();
    expect(porChave.informar_preco_e_convenio?.travada).toBe(false);
    expect(porChave.informar_preco_e_convenio?.ferramenta).toBe(
      "buscar_procedimento",
    );
    expect(porChave.passar_para_equipe?.travada).toBe(true);
    expect(porChave.passar_para_equipe?.ferramenta).toBe("escalar_humano");
  });

  it("travada vale sempre, desconhecida e ignorada, ausente vale o padrao", () => {
    expect(
      habilidadesEfetivas({
        responder_duvidas: false,
        passar_para_equipe: false,
        informar_preco_e_convenio: false,
        agendar: true,
      }),
    ).toEqual({
      responder_duvidas: true,
      informar_preco_e_convenio: false,
      passar_para_equipe: true,
    });
    expect(habilidadesEfetivas({})).toEqual({
      responder_duvidas: true,
      informar_preco_e_convenio: true,
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

  it("as ferramentas seguem as habilidades, e escalar_humano sempre vem", () => {
    expect(ferramentasDoAgente({})).toEqual([
      "buscar_procedimento",
      "escalar_humano",
    ]);
    expect(ferramentasDoAgente({ informar_preco_e_convenio: false })).toEqual([
      "escalar_humano",
    ]);
    expect(ferramentasDoAgente({ passar_para_equipe: false })).toContain(
      "escalar_humano",
    );
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
      passar_para_equipe: true,
    });
    expect(
      habilidadesSchema.safeParse({ informar_preco_e_convenio: "sim" }).success,
    ).toBe(false);
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
  it("os motivos espelham o CHECK de escalation_reason da migration", () => {
    const sql = readFileSync(
      "supabase/migrations/20261006100000_ia_liberacao_e_schema.sql",
      "utf-8",
    );
    const bloco = sql.match(
      /escalation_reason is null or escalation_reason in \(([\s\S]*?)\)\)/,
    );
    expect(bloco).not.toBeNull();
    const doBanco = [...(bloco?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    expect([...MOTIVOS_DE_ESCALONAMENTO].sort()).toEqual(doBanco.sort());
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
      habilidades: {
        responder_duvidas: true,
        informar_preco_e_convenio: false,
        passar_para_equipe: true,
      },
      horario: { ...horarioPadrao(), modo: "fallback", minutosSemResposta: 15 },
      instrucoes: "Seja breve.",
      base,
    });
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
        passar_para_equipe: true,
      },
      horario: {
        modo: "24h",
        minutosSemResposta: 5,
        expediente: expedientePadrao(),
      },
      instrucoes: null,
      base: [],
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
