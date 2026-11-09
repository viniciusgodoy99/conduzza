import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  configDaLinha,
  configPadraoDoAgente,
  diferencasDoRascunho,
  dizQueEVirtual,
  fraseDoAssistenteVirtual,
  LIMITES_DO_AGENTE,
  problemaNoTextoDoAgente,
  problemasNoTextoDoAgente,
  type ConfigDoAgente,
  type LinhaDaConfigDoAgente,
} from "@/lib/domain/agente/config";
import { FRASE_DO_ASSISTENTE_VIRTUAL } from "@/lib/domain/conformidade/frase-fixa";
import { COLUNAS_DA_CONFIG_DO_AGENTE } from "@/lib/queries/agente";

// A frase de assistente virtual de cada clinica (decisao do dono de
// 09/11/2026: "Isso é pra ser configurado na aba de agente de IA de cada
// clinica"). Ela e o aviso antes da primeira resposta da IA em cada janela e
// a resposta ao "você é um robô?"; nula, vale a padrao. O laco, o limite da
// mensagem e os fatos tem os testes deles (motor-laco, motor-prompt e
// motor-fatos-do-turno); a tela e a Server Action, os delas (tela-abas e
// acoes-agente).

const MIGRATION = "supabase/migrations/20261109120000_frase_do_assistente.sql";

/** Meia-risca e travessao, pelo codigo (o arquivo fica sem os dois). */
const TRAVESSAO = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

/**
 * O que o CHECK do banco aceita, conferido no Postgres local e no ensaio
 * (~/.claude/plans/agente-completo/frase-do-assistente/
 * ensaio-20261109120000.sql, com a mesma lista): dizQueEVirtual diz o mesmo em
 * cada uma, para o banco nunca recusar o que a tela aceitou. O link e o
 * tamanho ficam com o filtro e com o zod (abaixo).
 */
const AMOSTRAS_DO_BANCO: readonly (readonly [string, boolean])[] = [
  [FRASE_DO_ASSISTENTE_VIRTUAL, true],
  ["Oi! Sou a Ana, inteligência artificial da clínica.", true],
  ["SOU A ASSISTENTE VIRTUAL DA CLÍNICA.", true],
  ["Olá! Aqui é a INTELIGÊNCIA ARTIFICIAL da Clínica Sol.", true],
  ["Atendimento por inteligência\nartificial da clínica.", true],
  ["Aqui é a Ana, da recepção.", false],
  ["Sou virtualmente sua assistente.", false],
  ["Sou a assistente virtua l.", false],
  ["inteligenciaartificial", false],
  ["Sou a assistente virtual_da clínica", false],
];

const LINHA: LinhaDaConfigDoAgente = {
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

function config(parcial: Partial<ConfigDoAgente> = {}): ConfigDoAgente {
  return { ...configPadraoDoAgente(), ...parcial };
}

describe("a frase de assistente virtual da clínica: as regras", () => {
  it("a padrão passa nas regras da frase (é a que vale quando a clínica não escreve)", () => {
    expect(
      problemaNoTextoDoAgente(FRASE_DO_ASSISTENTE_VIRTUAL, "fraseDoAssistente"),
    ).toBeNull();
    expect(dizQueEVirtual(FRASE_DO_ASSISTENTE_VIRTUAL)).toBe(true);
  });

  it("dizQueEVirtual diz o mesmo que o CHECK do banco em cada amostra", () => {
    for (const [frase, aceita] of AMOSTRAS_DO_BANCO) {
      expect(dizQueEVirtual(frase), frase).toBe(aceita);
    }
  });

  it("sem dizer que é virtual, com link, com promessa ou com telefone: a mensagem de recepcionista, sem travessão", () => {
    const casos = [
      [
        "Aqui é a Ana, da recepção.",
        "Diga na frase que é a assistente virtual ou uma inteligência artificial: o paciente precisa saber que não está falando com uma pessoa.",
      ],
      ["Sou a assistente virtual. Veja www.clinica.com.br", "Tire o link"],
      ["Sou a assistente virtual: http://clinica", "Tire o link"],
      [
        "Sou a assistente virtual e garanto o resultado do seu tratamento.",
        "Tire a promessa",
      ],
      ["Sou a assistente virtual. Ligue (85) 99999-0000.", "Tire o telefone"],
    ] as const;
    for (const [frase, esperado] of casos) {
      const mensagem = problemaNoTextoDoAgente(frase, "fraseDoAssistente");
      expect(mensagem, frase).toContain(esperado);
      expect(mensagem ?? "", frase).not.toMatch(TRAVESSAO);
    }
  });

  it("dizer que é virtual vem antes do filtro, e a regra é só da frase", () => {
    expect(
      problemasNoTextoDoAgente(
        "Aqui é a Ana. Ligue (85) 99999-0000.",
        "fraseDoAssistente",
      ).map((p) => p.regra),
    ).toEqual(["sem_dizer_que_e_virtual", "dado_pessoal"]);
    // A saudacao nao precisa dizer que e virtual.
    expect(
      problemaNoTextoDoAgente("Olá! Aqui é a Ana.", "saudacao"),
    ).toBeNull();
  });

  it("em branco não tem problema: vale a padrão", () => {
    expect(problemasNoTextoDoAgente("   ", "fraseDoAssistente")).toEqual([]);
  });
});

describe("a frase de assistente virtual da clínica: a que vale e a do banco", () => {
  it("a da clínica, aparada; nula, em branco ou ausente, a padrão", () => {
    expect(
      fraseDoAssistenteVirtual({ fraseDoAssistente: " Sou a Ana, virtual. " }),
    ).toBe("Sou a Ana, virtual.");
    for (const fraseDoAssistente of [null, "", "   "]) {
      expect(fraseDoAssistenteVirtual({ fraseDoAssistente })).toBe(
        FRASE_DO_ASSISTENTE_VIRTUAL,
      );
    }
    // Uma configuracao montada a mao, sem o campo.
    expect(
      fraseDoAssistenteVirtual({} as Pick<ConfigDoAgente, "fraseDoAssistente">),
    ).toBe(FRASE_DO_ASSISTENTE_VIRTUAL);
    expect(configPadraoDoAgente().fraseDoAssistente).toBeNull();
  });

  it("configDaLinha lê frase_do_assistente aparada; em branco ou fora do select, nula", () => {
    expect(
      configDaLinha(
        { ...LINHA, frase_do_assistente: " Sou a assistente virtual. " },
        { base: [] },
      ).fraseDoAssistente,
    ).toBe("Sou a assistente virtual.");
    expect(
      configDaLinha({ ...LINHA, frase_do_assistente: "  " }, { base: [] })
        .fraseDoAssistente,
    ).toBeNull();
    expect(configDaLinha(LINHA, { base: [] }).fraseDoAssistente).toBeNull();
  });

  it("o que mudou: a frase conta uma vez quando muda; espaço nas pontas não conta; a primeira versão sem frase não ganha mudança", () => {
    const publicada = config({ status: "publicada", versao: 2 });
    expect(
      diferencasDoRascunho(
        config({ fraseDoAssistente: "Sou a assistente virtual." }),
        publicada,
      ),
    ).toEqual([
      { campo: "fraseDoAssistente", rotulo: "Frase de assistente virtual" },
    ]);
    expect(
      diferencasDoRascunho(
        config({ fraseDoAssistente: " Sou a assistente virtual. " }),
        config({
          status: "publicada",
          fraseDoAssistente: "Sou a assistente virtual.",
        }),
      ),
    ).toEqual([]);
    // Voltar para a padrao tambem e mudanca.
    expect(
      diferencasDoRascunho(
        config(),
        config({
          status: "publicada",
          fraseDoAssistente: "Sou a assistente virtual.",
        }),
      ).map((m) => m.campo),
    ).toEqual(["fraseDoAssistente"]);
    expect(
      diferencasDoRascunho(config(), null).map((m) => m.campo),
    ).not.toContain("fraseDoAssistente");
  });
});

describe("a frase de assistente virtual da clínica: a migration", () => {
  const sql = readFileSync(MIGRATION, "utf-8");
  const junto = sql.replace(/\s+/g, " ");

  it("a coluna nasce nula, sem default, com o CHECK do tamanho, do link e do virtual", () => {
    expect(junto).toContain(
      "alter table public.ai_agent_config add column frase_do_assistente text,",
    );
    expect(junto).toContain(
      "add constraint ai_agent_config_frase_do_assistente_valida check ( frase_do_assistente is null or (",
    );
    expect(junto).toContain(
      `char_length(frase_do_assistente) <= ${LIMITES_DO_AGENTE.fraseDoAssistente}`,
    );
    expect(junto).toContain("frase_do_assistente !~* '(http|://|www\\.)'");
    // Os mesmos acentos de dizQueEVirtual (e as maiusculas, se o lower do
    // banco nao as baixar) e a mesma fronteira de palavra.
    expect(junto).toContain(
      "'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'",
    );
    expect(junto).toContain(
      "~ '\\m(virtual|inteligencia[^[:alnum:]]+artificial)\\M'",
    );
    expect(junto).not.toMatch(/frase_do_assistente text (not null|default)/);
  });

  it("a sessão lê e grava a coluna (grant por coluna), e a Tela 6 a lê", () => {
    expect(junto).toContain(
      "grant select (frase_do_assistente), update (frase_do_assistente) on public.ai_agent_config to authenticated;",
    );
    expect(COLUNAS_DA_CONFIG_DO_AGENTE).toContain("frase_do_assistente");
  });

  it("o rascunho copia a frase da última publicada e o restaurar a devolve", () => {
    expect(junto).toContain(
      "-- [frase do assistente] inicio , frase_do_assistente -- [frase do assistente] fim ) select",
    );
    expect(junto).toContain(
      "-- [frase do assistente] inicio , a.frase_do_assistente -- [frase do assistente] fim from public.ai_agent_config a",
    );
    expect(junto).toContain(
      "frase_do_assistente = v_origem.frase_do_assistente,",
    );
    expect(sql.match(/create or replace function/g)).toHaveLength(2);
  });
});
