import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  portaDaAgendaDoSimulador,
  type MemoriaDoSimulador,
} from "@/lib/agente/agenda";
import type { ClienteDoAgente } from "@/lib/agente/laco";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";

import { configDaAg4 } from "./ag4-conversa";
import { bancoDaAg3 } from "./ag3-contrato";
import type { AgendaEmMemoria } from "./agenda-em-memoria";
import {
  AGORA,
  CLINICA,
  codigoDoProcedimento,
  FUSO,
  iso,
  PROC,
  VINC,
} from "./agenda-fixtures";
import { catalogoDoCadastro, UNID } from "./cadastro-fixtures";

// AG4 no SIMULADOR da Tela 6: so a consulta marcada na propria conversa de
// teste aparece; cancelar e remarcar sao simulados (a conferencia do banco,
// sem gravar nada); a memoria assinada ganha o vinculo da remarcacao. No
// simulador nao ha aprovacao: a consulta marcada no teste conta como
// aprovada (para remarcar poder ser testado), e a remarcacao fica pendente.
// Nenhum teste fala com a OpenAI.

const CATALOGO = catalogoDoCadastro();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const USUARIO = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const AMBIENTE = {
  OPENAI_API_KEY: "sk-teste",
  VERCEL_ENV: "production",
  IA_SEGREDO_DO_IDENTIFICADOR: "s".repeat(40),
};

const contexto = vi.hoisted(() => ({ config: null as unknown }));

vi.mock("@/lib/agente/contexto", async () => {
  const { catalogoDoCadastro: catalogo } = await import("./cadastro-fixtures");
  return {
    carregarConfigDoRascunho: async () => ({
      config: contexto.config,
      rascunhoId: null,
      publicada: null,
    }),
    carregarCatalogoDoAgente: async () => catalogo(),
  };
});

const { simularTurno } = await import("@/lib/agente/simulador");

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
  const novo = bancoDaAg3();
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

  async envia(texto: string, roteiro: unknown[]) {
    if (this.falas.length > 0) {
      this.agora += 2 * 60_000;
    }
    this.falas.push({ autor: "paciente", texto });
    const create = vi.fn(async () => roteiro.shift());
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
  pacote(): {
    estado: Record<string, unknown>;
    memoria: MemoriaDoSimulador;
  } {
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
  contexto.config = configDaAg4();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Marca, no simulador, a consulta de quarta, 21/10 as 14:00 (AG3). */
async function marcarNoSimulador(tela: TelaDoSimulador) {
  await tela.envia("Quero marcar uma consulta à tarde", [
    ferramenta("buscar_horario", {
      procedimento: P_CONSULTA,
      profissional: null,
      convenio: null,
      a_partir_de: null,
      periodo: "tarde",
      unidade: null,
      hora: null,
    }),
    final(
      "Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro. Pode ser?",
    ),
  ]);
  await tela.envia("Pode ser", [
    ferramenta("reservar_horario", { horario: "h2" }),
    final(
      "Reservei quarta, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro. Me envie seu nome completo e sua data de nascimento.",
    ),
  ]);
  await tela.envia("Maria da Silva Souza, 12/03/1985", [
    ferramenta("registrar_dados_do_paciente", {
      nome_completo: "Maria da Silva Souza",
      data_nascimento: "1985-03-12",
      para_o_titular: true,
      campos_mascarados: [],
    }),
    final(
      "Confirma a Consulta com a Dra. Ana Lima na quarta, 21/10 às 14:00, na unidade Centro, no particular?",
    ),
  ]);
  await tela.envia("Sim, confirmo", [
    ferramenta("agendar", {}),
    final(
      "Pronto! Sua Consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe. A confirmação chega por aqui.",
    ),
  ]);
  expect(tela.pacote().memoria.consulta).toMatchObject({
    inicio: iso("2026-10-21", "14:00"),
  });
}

/** Nada gravado: nenhuma escrita e nenhuma RPC de agenda. */
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

describe("o simulador cancela e remarca sem gravar nada", () => {
  it("cancelar: a pergunta fixa e o texto do botão; a consulta simulada sai da memória", async () => {
    const tela = new TelaDoSimulador();
    await marcarNoSimulador(tela);
    const t1 = await tela.envia("Preciso cancelar essa consulta", [
      ferramenta("consultar_minhas_consultas", {}),
      ferramenta("pedir_cancelamento", { consulta: "c1" }),
    ]);
    expect(t1).toMatchObject({
      ok: true,
      tipo: "resposta",
      resposta:
        "Confirma o cancelamento da sua consulta de quarta, 21/10 às 14:00?",
    });
    expect(tela.pacote().estado).toMatchObject({
      etapa: "cancelar",
      pedido_pendente: "cancelar",
    });
    const t2 = await tela.envia("Sim", [ferramenta("cancelar_consulta", {})]);
    expect(t2).toMatchObject({
      ok: true,
      tipo: "resposta",
      resposta:
        "Tudo bem, sua consulta de 21/10 às 14:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.",
    });
    if (t2.ok) {
      expect(t2.trilha.map((p) => p.texto)).toContain(
        "Cancelaria a consulta de quarta, 21/10 às 14:00 (Consulta, Dra. Ana Lima), a pedido da pessoa. No simulador, nada foi gravado.",
      );
    }
    expect(tela.pacote().memoria.consulta).toBeNull();
    expect(tela.pacote().estado).toMatchObject({
      pedido_pendente: null,
      desfecho: "cancelou",
    });
    nadaGravado();
  });

  it("remarcar: T3 e T4 simulados; a memória assinada guarda a nova ligada à antiga", async () => {
    const tela = new TelaDoSimulador();
    await marcarNoSimulador(tela);
    const id = tela.pacote().memoria.consulta?.appointmentId;
    const t1 = await tela.envia(
      "Quero remarcar para a semana que vem de manhã",
      [
        ferramenta("buscar_horario_para_remarcar", {
          consulta: "c1",
          a_partir_de: "2026-10-26",
          periodo: "manha",
          hora: null,
          unidade: null,
        }),
        final("Tenho segunda, 26/10 às 08:00, na unidade Aldeota. Pode ser?"),
      ],
    );
    expect(t1).toMatchObject({ ok: true, tipo: "resposta" });
    const t2 = await tela.envia("Pode", [
      ferramenta("reservar_horario", { horario: "h1" }),
    ]);
    expect(t2).toMatchObject({
      ok: true,
      resposta:
        "Reservei segunda, 26/10 às 08:00, na unidade Aldeota, por 10 minutos. Confirma a remarcação da sua consulta de quarta, 21/10 às 14:00 para segunda, 26/10 às 08:00?",
    });
    const t3 = await tela.envia("Confirmo", [ferramenta("agendar", {})]);
    expect(t3).toMatchObject({
      ok: true,
      resposta:
        "Pronto, pedi a remarcação para segunda, 26/10 às 08:00. Até a equipe aprovar, sua consulta de quarta, 21/10 às 14:00 continua marcada. A confirmação chega por aqui.",
    });
    const { memoria, estado } = tela.pacote();
    expect(memoria.consulta).toMatchObject({
      inicio: iso("2026-10-26", "08:00"),
      serviceLinkId: VINC.consultaAna,
      unidadeId: UNID.aldeota,
      remarcacaoDe: { appointmentId: id, inicio: iso("2026-10-21", "14:00") },
    });
    expect(estado).toMatchObject({
      etapa: "pos_marcacao",
      intencao: "remarcar",
      desfecho: "remarcou",
    });
    // O pacote seguinte e aceito (a forma da remarcacao), e a lista mostra
    // as duas.
    const t4 = await tela.envia("Quais consultas eu tenho?", [
      ferramenta("consultar_minhas_consultas", {}),
      final(
        "Você tem a de quarta, 21/10 às 14:00, e a remarcação para segunda, 26/10 às 08:00, que espera a aprovação da equipe.",
      ),
    ]);
    expect(t4).toMatchObject({ ok: true, tipo: "resposta" });
    nadaGravado();
  });
});

describe("a porta do simulador (a conferência do banco, sem gravar)", () => {
  function porta(memoria: MemoriaDoSimulador, prazoHoras = 24) {
    return portaDaAgendaDoSimulador(banco.cliente(), {
      clinicId: CLINICA,
      agora: () => AGORA,
      memoria,
      catalogo: CATALOGO,
      config: {
        ...configDaAg4(),
        prazos: { cancelarHoras: prazoHoras, remarcarHoras: prazoHoras },
      },
      fuso: FUSO,
    });
  }
  const QUARTA = {
    appointmentId: "5e5e5e5e-0000-4000-8000-000000000001",
    inicio: iso("2026-10-21", "14:00"),
    serviceLinkId: VINC.consultaAna,
    unidadeId: UNID.centro,
  };

  it("só a consulta da conversa de teste aparece, como marcada; dentro do prazo, recusa", async () => {
    const memoria: MemoriaDoSimulador = {
      reserva: null,
      consulta: { ...QUARTA },
    };
    const p = porta(memoria);
    const lista = await p.lerConsultasDoContato?.();
    expect(lista?.consultas).toEqual([
      expect.objectContaining({
        id: QUARTA.appointmentId,
        aprovacao: null,
        status: "agendado",
        unidadeId: UNID.centro,
      }),
    ]);
    // 29 horas ate quarta 14:00: com prazo de 48, fora do prazo.
    expect(
      await porta(memoria, 48).cancelarConsulta?.(QUARTA.appointmentId),
    ).toEqual({
      ok: false,
      motivo: "fora_do_prazo",
    });
    expect(memoria.consulta).not.toBeNull();
    expect(await p.cancelarConsulta?.("outra")).toEqual({
      ok: false,
      motivo: "consulta_nao_encontrada",
    });
    expect(await p.cancelarConsulta?.(QUARTA.appointmentId)).toEqual({
      ok: true,
      inicio: QUARTA.inicio,
      reutilizado: false,
    });
    expect(memoria.consulta).toBeNull();
  });

  it("a remarcação simulada: a nova pendente, a antiga lida com a marca; nenhuma das duas cancela pela IA", async () => {
    const memoria: MemoriaDoSimulador = {
      reserva: {
        holdId: "4d4d4d4d-0000-4000-8000-000000000001",
        serviceLinkId: VINC.consultaAna,
        inicio: iso("2026-10-26", "08:00"),
        fim: iso("2026-10-26", "08:30"),
        unidadeId: UNID.aldeota,
        expiraEm: new Date(AGORA + 5 * 60_000).toISOString(),
      },
      consulta: { ...QUARTA },
    };
    const p = porta(memoria);
    const r = await p.agendar({
      slotHoldId: "4d4d4d4d-0000-4000-8000-000000000001",
      remarcarId: QUARTA.appointmentId,
    });
    expect(r).toMatchObject({
      ok: true,
      inicio: iso("2026-10-26", "08:00"),
      remarcacaoDe: QUARTA.appointmentId,
      inicioDaAntiga: QUARTA.inicio,
    });
    const nova = (r as { appointmentId: string }).appointmentId;
    expect(await p.lerConsulta?.(nova)).toMatchObject({
      pendente: true,
      remarcacaoDe: QUARTA.appointmentId,
    });
    expect(await p.lerConsulta?.(QUARTA.appointmentId)).toMatchObject({
      ativa: true,
      pendente: false,
      remarcacaoDe: null,
    });
    const lista = await p.lerConsultasDoContato?.();
    expect(
      lista?.consultas.map((c) => [c.id, c.aprovacao, c.temRemarcacaoPendente]),
    ).toEqual([
      [QUARTA.appointmentId, null, true],
      [nova, "pendente", false],
    ]);
    // Nem a antiga (tem uma remarcacao pendente) nem a nova (e a remarcacao
    // pendente) cancelam pela IA: a equipe (como conferir_consulta_da_ia).
    expect(await p.cancelarConsulta?.(QUARTA.appointmentId)).toEqual({
      ok: false,
      motivo: "remarcacao_pendente",
    });
    expect(await p.cancelarConsulta?.(nova)).toEqual({
      ok: false,
      motivo: "remarcacao_pendente",
    });
    expect(memoria.consulta).toMatchObject({
      appointmentId: nova,
      remarcacaoDe: { appointmentId: QUARTA.appointmentId },
    });
    expect(banco.escritas).toEqual([]);
  });

  it("a reserva da remarcação: o horário de outro profissional é remarcacao_invalida", async () => {
    const memoria: MemoriaDoSimulador = {
      reserva: null,
      consulta: { ...QUARTA },
    };
    const p = porta(memoria);
    expect(
      await p.reservar({
        serviceLinkId: VINC.consultaBruno,
        inicio: iso("2026-10-27", "13:00"),
        fim: iso("2026-10-27", "13:30"),
        unidadeId: null,
        remarcarId: QUARTA.appointmentId,
      }),
    ).toEqual({ ok: false, motivo: "remarcacao_invalida" });
    expect(memoria.reserva).toBeNull();
  });
});
