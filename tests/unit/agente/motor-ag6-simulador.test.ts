import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PASSO_DA_URGENCIA, type ClienteDoAgente } from "@/lib/agente/laco";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";

import { PARA_O_RESPONSAVEL } from "./ag6-contrato";
import type { AgendaEmMemoria } from "./agenda-em-memoria";
import {
  AGORA,
  bancoComJornadas,
  CLINICA,
  configComAgenda,
  FUSO,
} from "./agenda-fixtures";

// AG6a no SIMULADOR da Tela 6 (D-62: sem audio, foto nem documento nesta
// etapa): a mensagem com sinal de emergencia passa no portao do laco (a
// segunda trava), sem chamar modelo nenhum, com a frase de SEMPRE e o passo
// da urgencia na trilha; a fala seguinte e recusada como toda conversa que
// passou para a equipe. A regra do responsavel nao muda nada no simulador
// (nada e gravado). Nenhum teste fala com a OpenAI.

const USUARIO = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const AMBIENTE = {
  OPENAI_API_KEY: "sk-teste",
  VERCEL_ENV: "production",
  IA_SEGREDO_DO_IDENTIFICADOR: "s".repeat(40),
};

const contexto = vi.hoisted(() => ({ config: null as unknown }));

vi.mock("@/lib/agente/contexto", async () => {
  const { catalogoDaAgenda: catalogo } = await import("./agenda-fixtures");
  return {
    carregarConfigDoRascunho: async () => ({
      config: contexto.config,
      rascunhoId: null,
      publicada: null,
    }),
    carregarCatalogoDoAgente: async () => catalogo(),
  };
});

const { simularTurno, TEXTOS_DO_SIMULADOR } =
  await import("@/lib/agente/simulador");

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

let banco: AgendaEmMemoria;
let classificador: ReturnType<typeof vi.fn<ClassificadorDeEntrada>>;
let verificador: ReturnType<typeof vi.fn<Verificador>>;
let logs: string[];

function bancoDoSimulador(): AgendaEmMemoria {
  const novo = bancoComJornadas();
  novo.inserir("ia_interruptor", { ligado: true });
  novo.inserir("ia_liberacao", {
    clinic_id: CLINICA,
    liberada: true,
    pausada_pela_clinica: false,
    modo: "simulador",
  });
  novo.rpc("ia_clinicas_da_fase_controlada", () => ({
    data: [CLINICA],
    error: null,
  }));
  novo.rpc("ia_pode_simular", () => ({ data: true, error: null }));
  novo.rpc("reservar_gasto_da_ia", () => ({
    data: "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e",
    error: null,
  }));
  novo.rpc("acertar_gasto_da_ia", () => ({ data: null, error: null }));
  return novo;
}

type Fala = {
  autor: "paciente" | "assistente";
  texto: string;
  assinatura?: string | null;
};

class TelaDoSimulador {
  falas: Fala[] = [];
  estado: string | null = null;
  agora = AGORA;
  create = vi.fn<() => Promise<unknown>>(async () => {
    throw new Error("o modelo nunca pode ser chamado na urgencia");
  });

  async envia(texto: string) {
    if (this.falas.length > 0) {
      this.agora += 2 * 60_000;
    }
    this.falas.push({ autor: "paciente", texto });
    const r = await simularTurno(
      {
        admin: banco.cliente(),
        clinicId: CLINICA,
        userId: USUARIO,
        fuso: FUSO,
        mensagens: [...this.falas],
        agoraMs: this.agora,
        estado: this.estado,
        env: AMBIENTE,
      },
      {
        cliente: {
          responses: { create: this.create },
        } as unknown as ClienteDoAgente,
        verificador,
        classificador,
        precos: PRECOS,
      },
    );
    if (r.ok) {
      this.falas.push({
        autor: "assistente",
        texto: r.resposta,
        assinatura: r.assinatura,
      });
      this.estado = r.estado;
    } else {
      this.falas.pop();
    }
    return r;
  }
}

beforeEach(() => {
  banco = bancoDoSimulador();
  contexto.config = { ...configComAgenda(), regras: PARA_O_RESPONSAVEL };
  classificador = vi.fn<ClassificadorDeEntrada>(async () => ({
    tipo: "classificacao",
    classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: USO,
  }));
  verificador = vi.fn<Verificador>(async () => ({
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: USO,
  }));
  logs = [];
  const capturar = (linha: string | Uint8Array): boolean => {
    logs.push(String(linha));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
});

afterEach(() => {
  vi.restoreAllMocks();
  expect(logs.join("")).not.toContain("falta de ar");
  expect(logs.join("")).not.toContain("morrer");
});

describe("AG6a: a urgência no simulador", () => {
  it.each([
    "Fiz o preenchimento ontem e agora to com falta de ar",
    "não aguento mais, quero morrer",
    "chama o SAMU",
  ])(
    "%s: a frase de sempre, sem modelo, e a conversa de teste acaba",
    async (texto) => {
      const tela = new TelaDoSimulador();
      const r = await tela.envia(texto);
      expect(r).toMatchObject({
        ok: true,
        tipo: "frase_fixa",
        resposta: FRASE_DE_ESCALONAMENTO,
        rascunhoBloqueado: null,
      });
      if (!r.ok) {
        return;
      }
      expect(r.trilha.map((p) => p.texto)).toContain(PASSO_DA_URGENCIA);
      expect(tela.create).not.toHaveBeenCalled();
      expect(classificador).not.toHaveBeenCalled();
      expect(verificador).not.toHaveBeenCalled();
      // A reserva do simulador e acertada sem uso (nada foi chamado).
      expect(banco.chamadasDe("acertar_gasto_da_ia")).toHaveLength(1);
      // Nada gravado: o simulador nunca escreve (nem a marca).
      expect(banco.escritas).toEqual([]);
      // A fala seguinte e recusada: a conversa passou para a equipe.
      const depois = await tela.envia("alô?");
      expect(depois).toEqual({
        ok: false,
        error: TEXTOS_DO_SIMULADOR.conversaComAEquipe,
      });
    },
  );

  it("o SAMU citado sem o pedido não é urgência: segue para o classificador e o modelo", async () => {
    const tela = new TelaDoSimulador();
    tela.create.mockImplementation(async () => ({
      model: "gpt-6-luna",
      status: "completed",
      incomplete_details: null,
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                mensagem: "Posso ajudar com alguma coisa sobre a clínica?",
                encerra_a_conversa: false,
                perguntas_da_base: [],
              }),
            },
          ],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 10 },
    }));
    const r = await tela.envia("o SAMU fica perto daí?");
    expect(r.ok).toBe(true);
    expect(classificador).toHaveBeenCalledTimes(1);
    expect(tela.create).toHaveBeenCalled();
    if (r.ok) {
      expect(r.trilha.map((p) => p.texto)).not.toContain(PASSO_DA_URGENCIA);
    }
  });
});
