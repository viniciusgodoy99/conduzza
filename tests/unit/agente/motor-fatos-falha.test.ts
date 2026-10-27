import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Os fatos do turno que nao se deixam montar: falha fechada (AG2). O modulo
// e trocado por um que lanca; o resto do turno e o de verdade.
const montar = vi.hoisted(() => ({
  lancar: false,
}));
vi.mock("@/lib/agente/fatos", async (original) => {
  const real = await original<typeof import("@/lib/agente/fatos")>();
  return {
    ...real,
    montarFatosDoTurno: (
      ...args: Parameters<typeof real.montarFatosDoTurno>
    ) => {
      if (montar.lancar) {
        throw new Error("texto que nunca vai para o log");
      }
      return real.montarFatosDoTurno(...args);
    },
  };
});

import {
  executarTurnoDoAgente,
  TEXTO_DA_FALHA,
  type ClienteDoAgente,
} from "@/lib/agente/laco";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";

import {
  AGORA,
  catalogoDaAgenda,
  CLINICA,
  configComAgenda,
  FUSO,
} from "./agenda-fixtures";

function final(mensagem: string) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output: [
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              mensagem,
              encerra_a_conversa: false,
              perguntas_da_base: [],
            }),
            annotations: [],
          },
        ],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
    _request_id: "req_1",
  };
}

const classificador: ClassificadorDeEntrada = async () => ({
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: null,
});

let escrito: string[] = [];

beforeEach(() => {
  escrito = [];
  vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
    escrito.push(String(linha));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((linha) => {
    escrito.push(String(linha));
    return true;
  });
});

afterEach(() => {
  montar.lancar = false;
  vi.restoreAllMocks();
});

describe("os fatos do turno que não se deixam montar", () => {
  it("falha fechada: a resposta não sai, o verificador não é chamado, a conversa passa e o log não tem texto", async () => {
    montar.lancar = true;
    const verificador = vi.fn<Verificador>();
    const create = vi.fn(async () =>
      final("Posso ajudar com mais alguma coisa?"),
    );
    const r = await executarTurnoDoAgente({
      cliente: { responses: { create } } as unknown as ClienteDoAgente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: "a".repeat(64),
      config: configComAgenda(),
      catalogo: catalogoDaAgenda(),
      mensagens: [{ autor: "paciente", texto: "Oi, tudo bem?" }],
      agoraMs: AGORA,
      fuso: FUSO,
      verificador,
      classificador,
    });
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "desconhecida" });
    expect(r.filtro).toBeNull();
    expect(verificador).not.toHaveBeenCalled();
    expect(r.trilha.at(-1)).toEqual({
      tipo: "equipe",
      texto: `Passou para a equipe: ${TEXTO_DA_FALHA.desconhecida}`,
    });
    const log = escrito.join("");
    expect(log).toContain("ia_agente_fatos_falharam");
    expect(log).not.toContain("texto que nunca vai para o log");
    expect(log).not.toContain("Oi, tudo bem");
  });

  it("sem a falha, o mesmo turno responde (o módulo trocado e o de verdade)", async () => {
    const verificador = vi.fn<Verificador>(async () => ({
      tipo: "veredicto",
      veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
      modelo: "gpt-6-luna",
      uso: null,
    }));
    const create = vi.fn(async () =>
      final("Posso ajudar com mais alguma coisa?"),
    );
    const r = await executarTurnoDoAgente({
      cliente: { responses: { create } } as unknown as ClienteDoAgente,
      modelo: "gpt-6-luna",
      clinicId: CLINICA,
      identificadorDeSeguranca: "a".repeat(64),
      config: configComAgenda(),
      catalogo: catalogoDaAgenda(),
      mensagens: [{ autor: "paciente", texto: "Oi, tudo bem?" }],
      agoraMs: AGORA,
      fuso: FUSO,
      verificador,
      classificador,
    });
    expect(r.tipo).toBe("resposta");
    expect(verificador).toHaveBeenCalledTimes(1);
  });
});
