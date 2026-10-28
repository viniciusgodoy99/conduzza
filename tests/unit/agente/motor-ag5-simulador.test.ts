import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { MemoriaDoSimulador } from "@/lib/agente/agenda";
import type { ClienteDoAgente } from "@/lib/agente/laco";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";

import { configDaAg5 } from "./ag5-conversa";
import type { AgendaEmMemoria } from "./agenda-em-memoria";
import {
  AGORA,
  bancoComJornadas,
  catalogoDaAgenda,
  CLINICA,
  codigoDoProcedimento,
  codigoDoProfissional,
  FUSO,
  PROC,
  PROF,
} from "./agenda-fixtures";

// AG5 no SIMULADOR da Tela 6: as duas fases da lista de espera (a pergunta
// T-E1 e a entrada, T-E2) so simulam, com as conferencias do banco que o
// simulador sabe fazer, e NADA e gravado (nenhuma escrita, nenhuma RPC da
// lista). O pedido e a entrada simulados ficam na memoria do pacote
// assinado, conferida na forma; pacote alterado e recusado. Nenhum teste
// fala com a OpenAI.

const CATALOGO = catalogoDaAgenda();
const P_LIMPEZA = codigoDoProcedimento(CATALOGO, PROC.limpeza);
const R_ANA = codigoDoProfissional(CATALOGO, PROF.ana);
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

const { simularTurno, TEXTOS_DO_SIMULADOR } = await import(
  "@/lib/agente/simulador"
);

const USO = {
  tokensEntrada: 100,
  tokensSaida: 10,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
};
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
const PRECOS = [
  {
    modelo: "gpt-6-luna",
    entrada: 100_000,
    saida: 500_000,
    cacheLeitura: 10_000,
    cacheEscrita: 125_000,
  },
];

function resposta(output: unknown[]) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output,
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}

function ferramenta(name: string, args: unknown) {
  const id = randomUUID();
  return resposta([
    {
      type: "function_call",
      id: `fc_${id}`,
      call_id: id,
      name,
      arguments: JSON.stringify(args),
      status: "completed",
    },
  ]);
}

function final(mensagem: string) {
  return resposta([
    {
      type: "message",
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
        },
      ],
    },
  ]);
}

let banco: AgendaEmMemoria;

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
  corpos: Record<string, unknown>[] = [];

  async envia(texto: string, roteiro: unknown[]) {
    if (this.falas.length > 0) {
      this.agora += 2 * 60_000;
    }
    this.falas.push({ autor: "paciente", texto });
    const create = vi.fn(async (corpo: unknown) => {
      this.corpos.push(structuredClone(corpo) as Record<string, unknown>);
      return roteiro.shift();
    });
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
        cliente: { responses: { create } } as unknown as ClienteDoAgente,
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

  /** O conteudo do pacote assinado do estado. */
  pacote(): { estado: Record<string, unknown>; memoria: MemoriaDoSimulador } {
    const conteudo = Buffer.from(
      (this.estado ?? "").split(".")[1] ?? "",
      "base64url",
    ).toString("utf8");
    return JSON.parse(conteudo) as {
      estado: Record<string, unknown>;
      memoria: MemoriaDoSimulador;
    };
  }
}

beforeEach(() => {
  banco = bancoDoSimulador();
  contexto.config = configDaAg5();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Nada gravado: nenhuma escrita e nenhuma RPC da agenda nem da lista. */
function nadaGravado() {
  expect(banco.escritas).toEqual([]);
  expect([...new Set(banco.chamadas.map((c) => c.nome))].sort()).toEqual(
    [
      "acertar_gasto_da_ia",
      "ia_clinicas_da_fase_controlada",
      "ia_pode_simular",
      "reservar_gasto_da_ia",
    ].sort(),
  );
}

const T_E1 =
  "Confirma a sua entrada na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas? Se abrir um horário assim, você recebe uma mensagem por aqui para ficar com ele.";
const T_E2 =
  "Pronto, você entrou na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas. Se abrir um horário assim, você recebe uma mensagem por aqui.";

async function ateAPergunta(tela: TelaDoSimulador) {
  const r0 = await tela.envia("Queria limpeza de pele com a Dra. Ana, só à noite.", [
    ferramenta("buscar_horario", {
      procedimento: P_LIMPEZA,
      profissional: R_ANA,
      convenio: null,
      a_partir_de: null,
      periodo: "noite",
      unidade: null,
      hora: null,
    }),
    final(
      "Não tenho horário à noite com a Dra. Ana Lima. Posso procurar de manhã ou à tarde, ou colocar você na lista de espera para à noite. O que prefere?",
    ),
  ]);
  expect(r0.ok).toBe(true);
  return tela.envia("Lista de espera. Segunda ou quarta.", [
    ferramenta("pedir_lista_de_espera", {
      periodos: ["noite"],
      dias: ["segunda", "quarta"],
    }),
  ]);
}

describe("o simulador põe na lista de espera sem gravar nada", () => {
  it("as duas fases: a T-E1 e a T-E2 simuladas; a memória assinada guarda o pedido e depois a entrada", async () => {
    const tela = new TelaDoSimulador();
    const t1 = await ateAPergunta(tela);
    expect(t1).toMatchObject({ ok: true, tipo: "resposta", resposta: T_E1 });
    expect(tela.pacote().memoria.espera).toEqual({
      pedido: expect.objectContaining({
        procedimentoId: PROC.limpeza,
        profissionalId: PROF.ana,
        convenioId: null,
        particular: true,
        turnos: ["noite"],
        dias: [1, 3],
      }),
      entradas: [],
    });
    const t2 = await tela.envia("Sim", [ferramenta("entrar_na_lista_de_espera", {})]);
    expect(t2).toMatchObject({ ok: true, tipo: "resposta", resposta: T_E2 });
    if (t2.ok) {
      expect(t2.trilha.map((p) => p.texto)).toContain(
        "Colocaria a pessoa na lista de espera para Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas. No simulador, nada foi gravado.",
      );
    }
    expect(tela.pacote().memoria.espera).toEqual({
      pedido: null,
      entradas: [expect.objectContaining({ procedimentoId: PROC.limpeza })],
    });
    nadaGravado();
  });

  it("o turno seguinte relê a entrada simulada (o bloco do modelo) e pedir de novo é ja_na_lista", async () => {
    const tela = new TelaDoSimulador();
    await ateAPergunta(tela);
    await tela.envia("Sim", [ferramenta("entrar_na_lista_de_espera", {})]);
    const t3 = await tela.envia("Me coloca de novo, segunda.", [
      ferramenta("pedir_lista_de_espera", { periodos: ["noite"], dias: ["segunda"] }),
      final("Você já está na lista de espera à noite, às segundas e às quartas."),
    ]);
    expect(t3).toMatchObject({ ok: true, tipo: "resposta" });
    expect(String(tela.corpos.at(-2)?.instructions ?? "")).toContain(
      "A pessoa entrou na lista de espera nesta conversa: Limpeza de pele, com Dra. Ana Lima, no particular, à noite, às segundas e às quartas.",
    );
    const saida = (
      (tela.corpos.at(-1)?.input as { type?: string; output?: string }[]) ?? []
    )
      .filter((i) => i.type === "function_call_output")
      .map((i) => JSON.parse(i.output ?? "{}") as Record<string, unknown>)
      .at(-1);
    expect(saida).toEqual({
      resultado: "ja_na_lista",
      preferencia: "à noite, às segundas e às quartas",
    });
    nadaGravado();
  });

  it("o pacote do estado alterado (a lista de espera inventada) é recusado", async () => {
    const tela = new TelaDoSimulador();
    await ateAPergunta(tela);
    const [versao, conteudo, hmac] = (tela.estado ?? "").split(".");
    const lido = JSON.parse(
      Buffer.from(conteudo ?? "", "base64url").toString("utf8"),
    ) as { memoria: MemoriaDoSimulador };
    lido.memoria.espera = { pedido: null, entradas: [] };
    tela.estado = `${versao}.${Buffer.from(JSON.stringify(lido), "utf8").toString("base64url")}.${hmac}`;
    const r = await tela.envia("Sim", [ferramenta("entrar_na_lista_de_espera", {})]);
    expect(r).toEqual({ ok: false, error: TEXTOS_DO_SIMULADOR.historicoAlterado });
  });
});
