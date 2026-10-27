import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ClienteDoAgente } from "@/lib/agente/laco";
import { simularTurno } from "@/lib/agente/simulador";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";

import { AgendaEmMemoria, type Linha } from "./agenda-em-memoria";
import { CLINICA } from "./agenda-fixtures";
import { ENDERECO_DA_ALDEOTA, linhasDoCadastro } from "./cadastro-fixtures";

// O simulador da Tela 6 com as consultas do Cadastro (AG2, 27/10/2026): o
// MESMO carregador do WhatsApp le o Cadastro de verdade (aqui, um banco em
// memoria) pela service role, a ferramenta roda sobre ele e nada e gravado:
// so as RPCs da liberacao e do gasto. Cliente da OpenAI, verificador e
// classificador falsos; nenhum teste fala com a OpenAI.

const USUARIO = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const RESERVA = "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e";
const AMBIENTE = {
  OPENAI_API_KEY: "sk-teste",
  VERCEL_ENV: "production",
  IA_SEGREDO_DO_IDENTIFICADOR: "s".repeat(40),
};
const USO = {
  tokensEntrada: 100,
  tokensSaida: 10,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
};
const PRECOS = [
  {
    modelo: "gpt-6-luna",
    entrada: 100_000,
    saida: 500_000,
    cacheLeitura: 10_000,
    cacheEscrita: 125_000,
  },
];

const verificador: Verificador = async () => ({
  tipo: "veredicto",
  veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: USO,
});
const classificador: ClassificadorDeEntrada = async () => ({
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: USO,
});

function resposta(output: unknown[]) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output,
    usage: {
      input_tokens: 1_000,
      output_tokens: 60,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 20 },
    },
  };
}

function clienteComRoteiro(roteiro: unknown[]): ClienteDoAgente {
  return {
    responses: { create: vi.fn(async () => roteiro.shift()) },
  } as unknown as ClienteDoAgente;
}

function daClinica<T extends object>(linhas: readonly T[]): Linha[] {
  return linhas.map((linha, i) => ({
    id: `linha-${i}`,
    ...linha,
    clinic_id: CLINICA,
  }));
}

function bancoDoSimulador(): AgendaEmMemoria {
  const linhas = linhasDoCadastro();
  const banco = new AgendaEmMemoria()
    .rpc("ia_clinicas_da_fase_controlada", () => ({
      data: [CLINICA],
      error: null,
    }))
    .rpc("ia_pode_simular", () => ({ data: true, error: null }))
    .rpc("reservar_gasto_da_ia", () => ({ data: RESERVA, error: null }))
    .rpc("acertar_gasto_da_ia", () => ({ data: null, error: null }));
  banco.inserir("procedure", ...daClinica(linhas.procedimentos));
  banco.inserir("service_link", ...daClinica(linhas.vinculos));
  banco.inserir("professional", ...daClinica(linhas.profissionais));
  banco.inserir("insurance", ...daClinica(linhas.convenios));
  banco.inserir("clinic", { id: CLINICA, name: "Clínica Bem Estar" });
  banco.inserir("unit", ...daClinica(linhas.unidades ?? []));
  banco.inserir("professional_schedule", ...daClinica(linhas.jornadas ?? []));
  banco.inserir("procedure_requirement", ...daClinica(linhas.requisitos ?? []));
  banco.inserir(
    "professional_insurance",
    ...daClinica(linhas.conveniosDosProfissionais ?? []),
  );
  return banco;
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("simulador com as consultas do Cadastro", () => {
  it("lê o Cadastro de verdade, responde com o endereço da unidade e não grava nada", async () => {
    const banco = bancoDoSimulador();
    const callId = randomUUID();
    const r = await simularTurno(
      {
        admin: banco.cliente(),
        clinicId: CLINICA,
        userId: USUARIO,
        fuso: "America/Fortaleza",
        mensagens: [{ autor: "paciente", texto: "Onde fica a clínica?" }],
        agoraMs: Date.UTC(2026, 9, 20, 12, 0),
        env: AMBIENTE,
      },
      {
        cliente: clienteComRoteiro([
          resposta([
            {
              type: "function_call",
              id: `fc_${callId}`,
              call_id: callId,
              name: "consultar_unidades",
              arguments: JSON.stringify({ unidade: "u1" }),
              status: "completed",
            },
          ]),
          resposta([
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    mensagem: `Olá! A unidade Aldeota fica na ${ENDERECO_DA_ALDEOTA}.`,
                    encerra_a_conversa: false,
                    perguntas_da_base: [],
                  }),
                },
              ],
            },
          ]),
        ]),
        verificador,
        classificador,
        precos: PRECOS,
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.tipo).toBe("resposta");
    expect(r.resposta).toContain(ENDERECO_DA_ALDEOTA);
    expect(r.trilha).toContainEqual({
      tipo: "cadastro",
      texto: "Consultou a unidade Aldeota",
    });
    // Nada gravado: nenhuma escrita em tabela, so as RPCs da liberacao e do
    // gasto.
    expect(banco.escritas).toEqual([]);
    expect(new Set(banco.chamadas.map((c) => c.nome))).toEqual(
      new Set([
        "ia_clinicas_da_fase_controlada",
        "ia_pode_simular",
        "reservar_gasto_da_ia",
        "acertar_gasto_da_ia",
      ]),
    );
    // O Cadastro foi lido pela clinica, nunca uma tabela de paciente.
    const tabelas = new Set(banco.leituras.map((l) => l.tabela));
    expect(tabelas).toContain("unit");
    expect(tabelas).toContain("procedure_requirement");
    for (const tabela of [
      "contact",
      "conversation",
      "message",
      "appointment",
    ]) {
      expect(tabelas).not.toContain(tabela);
    }
  });
});
