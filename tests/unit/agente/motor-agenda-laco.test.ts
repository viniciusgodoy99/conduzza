import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  portaDaAgendaDoSimulador,
  portaDaAgendaDoWhatsapp,
} from "@/lib/agente/agenda";
import type { PortaDaAgenda } from "@/lib/agente/ferramentas/agenda-do-turno";
import {
  custoMaximoDoTurno,
  executarTurnoDoAgente,
  MAX_TOKENS_DO_AGENTE,
  MAXIMO_DE_RODADAS,
  MAXIMO_DE_RODADAS_COM_AGENDA,
  PASSO_SEM_CONSULTA,
  type ClienteDoAgente,
  type EntradaDoTurno,
  type MensagemDaConversa,
} from "@/lib/agente/laco";
import { TEXTO_FIXO_DO_AGENTE } from "@/lib/agente/prompt";
import { linhaDaDecisao } from "@/lib/agente/whatsapp";
import { configPadraoDoAgente } from "@/lib/domain/agente/config";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type {
  ResultadoDoVerificador,
  Verificador,
} from "@/lib/domain/conformidade/veredicto";
import type {
  ClassificadorDeEntrada,
  ResultadoDoClassificador,
} from "@/lib/integrations/llm/classificador-de-entrada";

import type { AgendaEmMemoria, Linha } from "./agenda-em-memoria";
import {
  AGORA,
  bancoComJornadas,
  catalogoDaAgenda,
  CLINICA,
  codigoDoProcedimento,
  configComAgenda,
  CONTATO,
  CONVERSA,
  FUSO,
  iso,
  JOB,
  PROC,
  VINC,
} from "./agenda-fixtures";

// O laco do agente (lib/agente/laco.ts) com as ferramentas de agenda (E4) e
// um LLM FALSO de roteiro: o efeito acontece uma vez so (uma reserva por
// turno), repetir o job nao duplica (a idempotencia das RPCs pelo job_id),
// o simulador nao grava, o turno com agenda ganha rodadas, a liberacao que
// cai no meio para o turno e a falha da agenda e fechada. Nenhum teste fala
// com a OpenAI.

const CATALOGO = catalogoDaAgenda();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const IDENTIFICADOR = "a".repeat(64);
const USO = {
  input_tokens: 1_000,
  output_tokens: 60,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 20 },
};
const USO_LIDO = {
  tokensEntrada: 1_000,
  tokensSaida: 60,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
};

function resposta(output: unknown[]) {
  return {
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output,
    usage: USO,
    _request_id: "req_1",
  };
}

function ferramenta(name: string, args: unknown, callId = randomUUID()) {
  return resposta([
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "x" },
    {
      type: "function_call",
      id: `fc_${callId}`,
      call_id: callId,
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
  ]);
}

function clienteComRoteiro(roteiro: unknown[]) {
  const corpos: Record<string, unknown>[] = [];
  const create = vi.fn(async (corpo: unknown) => {
    corpos.push(structuredClone(corpo) as Record<string, unknown>);
    return roteiro.shift();
  });
  return {
    cliente: { responses: { create } } as unknown as ClienteDoAgente,
    corpos,
    create,
  };
}

const aprovador: Verificador = async (): Promise<ResultadoDoVerificador> => ({
  tipo: "veredicto",
  veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: { ...USO_LIDO },
});

const LIMPO: ResultadoDoClassificador = {
  tipo: "classificacao",
  classificacao: { gatilhos: ["nenhum"], confianca: "alta" },
  modelo: "gpt-6-luna",
  uso: { ...USO_LIDO },
};
const classificador: ClassificadorDeEntrada = async () => LIMPO;

function paciente(texto: string): MensagemDaConversa {
  return { autor: "paciente", texto };
}

const BUSCA = {
  procedimento: P_CONSULTA,
  profissional: null,
  convenio: null,
  a_partir_de: null,
  periodo: "manha",
};

const RESERVEI =
  "Reservei terça, 20/10 às 11:30 com a Dra. Ana Lima para a Consulta. Posso confirmar?";

let banco: AgendaEmMemoria;

function rpcsDoContrato() {
  banco.rpc("reservar_horario_da_ia", (args) => {
    const jaTem = banco
      .linhas("slot_hold")
      .find((h) => h.job_id === args.p_job_id);
    const hold: Linha = jaTem ?? {
      id: randomUUID(),
      conversation_id: args.p_conversation_id,
      service_link_id: args.p_service_link_id,
      job_id: args.p_job_id,
      starts_at: args.p_starts_at,
      ends_at: new Date(
        Date.parse(String(args.p_starts_at)) + 30 * 60_000,
      ).toISOString(),
      expires_at: new Date(AGORA + 10 * 60_000).toISOString(),
      consumido_em: null,
    };
    if (!jaTem) {
      banco.inserir("slot_hold", hold);
    }
    return {
      data: {
        ok: true,
        hold_id: hold.id,
        starts_at: hold.starts_at,
        ends_at: hold.ends_at,
        expires_at: hold.expires_at,
        reutilizado: jaTem !== undefined,
      },
      error: null,
    };
  });
}

function portaDoWhatsapp(): PortaDaAgenda {
  return portaDaAgendaDoWhatsapp(banco.cliente(), {
    clinicId: CLINICA,
    conversationId: CONVERSA,
    contactId: CONTATO,
    jobId: JOB,
    agora: () => AGORA,
  });
}

function entrada(
  extra: Partial<EntradaDoTurno> & { cliente: ClienteDoAgente | null },
): EntradaDoTurno {
  return {
    modelo: "gpt-6-luna",
    clinicId: CLINICA,
    identificadorDeSeguranca: IDENTIFICADOR,
    config: configComAgenda(),
    catalogo: CATALOGO,
    mensagens: [paciente("Quero marcar uma consulta de manhã")],
    agoraMs: AGORA,
    fuso: FUSO,
    verificador: aprovador,
    classificador,
    agenda: portaDoWhatsapp(),
    ...extra,
  };
}

let escrito: string[] = [];

beforeEach(() => {
  banco = bancoComJornadas();
  rpcsDoContrato();
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
  vi.restoreAllMocks();
});

function saidasDasFerramentas(corpo: Record<string, unknown> | undefined) {
  return ((corpo?.input as { type?: string; output?: string }[]) ?? [])
    .filter((item) => item.type === "function_call_output")
    .map((item) => JSON.parse(item.output ?? "{}") as Record<string, unknown>);
}

describe("o laço com as ferramentas de agenda", () => {
  it("busca, reserva e responde: o efeito pela porta, a trilha e o log da decisão", async () => {
    const { cliente, corpos } = clienteComRoteiro([
      ferramenta("buscar_horario", BUSCA),
      ferramenta("reservar_horario", { horario: "h1" }),
      final(RESERVEI),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.tipo).toBe("resposta");
    expect(r.desfecho).toEqual({ tipo: "respondeu" });
    // As ferramentas que o modelo recebe com Agendar e Confirmar ligadas
    // (as duas de frase fixa da onda 2 e as tres consultas do Cadastro da
    // AG2 vem sempre, na frente).
    expect((corpos[0]?.tools as { name: string }[]).map((t) => t.name)).toEqual(
      [
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
      ],
    );
    expect(
      String(corpos[0]?.instructions).slice(TEXTO_FIXO_DO_AGENTE.length),
    ).toContain("<profissionais>\n");
    // A saida da busca volta ao modelo; depois, a da reserva.
    expect(saidasDasFerramentas(corpos[1])[0]).toMatchObject({
      resultado: "horarios",
    });
    expect(saidasDasFerramentas(corpos[2])[1]).toMatchObject({
      resultado: "reservado",
      hora: "11:30",
    });
    expect(banco.chamadasDe("reservar_horario_da_ia")).toHaveLength(1);
    expect(r.trilha.filter((p) => p.tipo === "agenda")).toHaveLength(2);
    expect(r.trilha.map((p) => p.texto)).not.toContain(PASSO_SEM_CONSULTA);
    expect(r.ferramentasUsadas).toEqual(["buscar_horario", "reservar_horario"]);
    // Nada do paciente na trilha.
    expect(JSON.stringify(r.trilha)).not.toContain("de manhã");
    // O tool_used da decisao e o efeito.
    expect(
      linhaDaDecisao({
        clinicId: CLINICA,
        conversationId: CONVERSA,
        jobId: JOB,
        desfecho: r.desfecho,
        textoSha256: null,
        filtro: null,
        trilha: r.trilha,
        uso: r.uso,
        versaoDoPrompt: r.versaoDoPrompt,
        configVersion: 1,
        latenciaMs: 10,
        ferramentasUsadas: r.ferramentasUsadas,
      }).tool_used,
    ).toBe("reservar_horario");
  });

  it("o efeito acontece uma vez só: a segunda reserva do turno é recusada sem RPC", async () => {
    const { cliente, corpos } = clienteComRoteiro([
      ferramenta("buscar_horario", BUSCA),
      ferramenta("reservar_horario", { horario: "h1" }),
      ferramenta("reservar_horario", { horario: "h2" }),
      final(RESERVEI),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.tipo).toBe("resposta");
    expect(saidasDasFerramentas(corpos[3])[2]).toEqual({
      resultado: "uma_reserva_por_resposta",
    });
    expect(banco.chamadasDe("reservar_horario_da_ia")).toHaveLength(1);
    expect(banco.linhas("slot_hold")).toHaveLength(1);
  });

  it("repetir o job não duplica: a mesma reserva volta (idempotência pelo job_id)", async () => {
    for (let vez = 0; vez < 2; vez += 1) {
      const { cliente } = clienteComRoteiro([
        ferramenta("buscar_horario", BUSCA),
        ferramenta("reservar_horario", { horario: vez === 0 ? "h1" : "h3" }),
        final(RESERVEI),
      ]);
      const r = await executarTurnoDoAgente(entrada({ cliente }));
      expect(r.tipo).toBe("resposta");
    }
    expect(banco.chamadasDe("reservar_horario_da_ia")).toHaveLength(2);
    expect(banco.linhas("slot_hold")).toHaveLength(1);
    expect(
      banco.chamadasDe("reservar_horario_da_ia").map((a) => a.p_job_id),
    ).toEqual([JOB, JOB]);
  });

  it("o simulador não grava: nenhuma RPC e nenhuma escrita", async () => {
    const porta = portaDaAgendaDoSimulador(banco.cliente(), {
      clinicId: CLINICA,
      agora: () => AGORA,
    });
    const { cliente } = clienteComRoteiro([
      ferramenta("buscar_horario", BUSCA),
      ferramenta("reservar_horario", { horario: "h1" }),
      final(RESERVEI),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente, agenda: porta }));
    expect(r.tipo).toBe("resposta");
    const { cliente: segundo } = clienteComRoteiro([
      ferramenta("agendar", {}),
      final("Pronto, sua consulta ficou marcada. A equipe confirma por aqui."),
    ]);
    const marcou = await executarTurnoDoAgente(
      entrada({
        cliente: segundo,
        agenda: porta,
        mensagens: [
          paciente("Quero marcar"),
          { autor: "assistente", texto: RESERVEI },
          paciente("Pode confirmar"),
        ],
      }),
    );
    expect(marcou.tipo).toBe("resposta");
    expect(marcou.trilha.map((p) => p.texto).join(" ")).toContain(
      "No simulador, nada foi gravado.",
    );
    expect(banco.chamadas).toEqual([]);
    expect(banco.escritas).toEqual([]);
  });
});

describe("rodadas, liberação e falha fechada", () => {
  it(`o turno que usa a agenda vai até ${MAXIMO_DE_RODADAS_COM_AGENDA} rodadas; sem agenda, ${MAXIMO_DE_RODADAS}`, async () => {
    const cinco = Array.from({ length: 5 }, () =>
      ferramenta("buscar_horario", BUSCA),
    );
    const { cliente, create } = clienteComRoteiro([
      ...cinco,
      final("Tenho terça, 20/10 às 11:30 com a Dra. Ana Lima. Pode ser?"),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(create).toHaveBeenCalledTimes(6);
    expect(r.tipo).toBe("resposta");

    const seis = Array.from({ length: 8 }, () =>
      ferramenta("buscar_horario", BUSCA),
    );
    const esgotou = clienteComRoteiro(seis);
    const r2 = await executarTurnoDoAgente(
      entrada({ cliente: esgotou.cliente }),
    );
    expect(esgotou.create).toHaveBeenCalledTimes(MAXIMO_DE_RODADAS_COM_AGENDA);
    expect(r2.desfecho).toEqual({
      tipo: "falhou",
      motivo: "rodadas_esgotadas",
    });

    const preco = Array.from({ length: 6 }, () =>
      ferramenta("buscar_procedimento", {
        procedimento: P_CONSULTA,
        convenio: null,
      }),
    );
    const semAgenda = clienteComRoteiro(preco);
    await executarTurnoDoAgente(entrada({ cliente: semAgenda.cliente }));
    expect(semAgenda.create).toHaveBeenCalledTimes(MAXIMO_DE_RODADAS);
  });

  it("ia_desligada da RPC para o turno como a trava (sem frase, sem outra rodada)", async () => {
    banco.rpc("reservar_horario_da_ia", () => ({
      data: { ok: false, motivo: "ia_desligada" },
      error: null,
    }));
    const { cliente, create } = clienteComRoteiro([
      ferramenta("buscar_horario", BUSCA),
      ferramenta("reservar_horario", { horario: "h1" }),
      final("não deveria chegar aqui"),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.desfecho).toEqual({
      tipo: "falhou",
      motivo: "liberacao_suspensa",
    });
    expect(
      r.trilha.some(
        (p) => p.tipo === "agenda" && p.texto.startsWith("Tentou reservar"),
      ),
    ).toBe(true);
  });

  // COMPORTAMENTO DE HOJE, escrito para ficar visivel (revisao da E4, achado
  // da trava K, decisao pendente do dono): a consulta que a propria IA marca
  // da sinal de paciente ao contato (consulta, e o gatilho
  // converter_lead_em_paciente), e a trava do WhatsApp (ia_pode_falar_com,
  // D-B de 13/10/2026) cai para o telefone que nao foi forcado. O turno que
  // acabou de marcar para na rodada seguinte, sem frase: a consulta pendente
  // e o evento ficam, a conversa vai para a equipe e quem confirmou nao
  // recebe a resposta da IA. Se o dono mudar a regra, este teste muda junto.
  it("a trava que cai logo depois do agendar (sinal de paciente): a consulta fica, o turno para sem frase", async () => {
    banco.rpc("agendar_pela_ia", () => ({
      data: {
        ok: true,
        appointment_id: "a1000000-0000-4000-8000-000000000001",
        starts_at: "2026-10-20T14:15:00.000Z",
        ends_at: "2026-10-20T14:45:00.000Z",
        reutilizado: false,
      },
      error: null,
    }));
    let conferencias = 0;
    // Liberada antes da primeira rodada; depois da marcacao, nao mais.
    const conferirTrava = vi.fn(async () => {
      conferencias += 1;
      return conferencias === 1;
    });
    const { cliente, create } = clienteComRoteiro([
      ferramenta("agendar", {}),
      final(
        "Pronto, sua consulta ficou marcada, pendente da aprovação da equipe.",
      ),
    ]);
    const r = await executarTurnoDoAgente(
      entrada({
        cliente,
        conferirTrava,
        mensagens: [
          paciente("Quero marcar"),
          { autor: "assistente", texto: RESERVEI },
          paciente("Confirmo"),
        ],
      }),
    );
    expect(banco.chamadasDe("agendar_pela_ia")).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.desfecho).toEqual({
      tipo: "falhou",
      motivo: "liberacao_suspensa",
    });
    expect(
      r.trilha.some(
        (p) => p.tipo === "agenda" && p.texto.startsWith("Marcou a consulta"),
      ),
    ).toBe(true);
    expect(r.ferramentasUsadas).toEqual(["agendar"]);
  });

  it("leitura da agenda que falha: frase fixa, falha fechada, com o passo da agenda", async () => {
    banco.comErro.add("professional_schedule");
    const { cliente } = clienteComRoteiro([
      ferramenta("buscar_horario", BUSCA),
      final("não deveria chegar aqui"),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente }));
    expect(r.tipo).toBe("frase_fixa");
    expect(r.resposta).toBe(FRASE_DE_ESCALONAMENTO);
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "desconhecida" });
    expect(r.trilha.map((p) => p.texto)).toContain(
      "Não foi possível ler a agenda agora.",
    );
    expect(escrito.join("")).toContain("ia_agente_agenda_falhou");
  });

  it("sem porta, ferramenta de agenda é falha fechada", async () => {
    const { cliente } = clienteComRoteiro([
      ferramenta("buscar_horario", BUSCA),
      final("x"),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente, agenda: null }));
    expect(r.desfecho).toEqual({ tipo: "falhou", motivo: "desconhecida" });
  });

  it("habilidade desligada: a ferramenta não vai ao modelo e o pedido dela é recusado", async () => {
    const { cliente, corpos } = clienteComRoteiro([
      ferramenta("reservar_horario", { horario: "h1" }),
    ]);
    const r = await executarTurnoDoAgente(
      entrada({ cliente, config: { ...configPadraoDoAgente(), nome: "Ana" } }),
    );
    expect((corpos[0]?.tools as { name: string }[]).map((t) => t.name)).toEqual(
      [
        "fora_do_assunto",
        "sou_assistente_virtual",
        "consultar_unidades",
        "consultar_requisitos",
        "buscar_profissionais",
        "buscar_procedimento",
        "escalar_humano",
      ],
    );
    // Onda 2 (item 6, P6a): o bloco <profissionais> vai sempre, mas sem a
    // agenda o bloco <atendimento> manda passar o pedido de marcar.
    expect(
      String(corpos[0]?.instructions).slice(TEXTO_FIXO_DO_AGENTE.length),
    ).toContain("<profissionais>");
    expect(r.desfecho).toEqual({
      tipo: "falhou",
      motivo: "ferramenta_invalida",
    });
    expect(banco.chamadas).toEqual([]);
  });

  it("D14: o valor particular que a busca trouxe passa no filtro; valor inventado não", async () => {
    const amil = { ...BUSCA, convenio: "Amil", periodo: null };
    const ok = clienteComRoteiro([
      ferramenta("buscar_horario", amil),
      final(
        "A Dra. Ana Lima não atende a Consulta pela Amil. Quer fazer no particular? O valor é R$ 300,00.",
      ),
    ]);
    const r = await executarTurnoDoAgente(entrada({ cliente: ok.cliente }));
    expect(r.tipo).toBe("resposta");
    const inventado = clienteComRoteiro([
      ferramenta("buscar_horario", amil),
      final("No particular fica R$ 999,00."),
    ]);
    const barrado = await executarTurnoDoAgente(
      entrada({ cliente: inventado.cliente }),
    );
    expect(barrado.desfecho).toMatchObject({
      tipo: "bloqueou",
      categoria: "preco_nao_verificado",
    });
  });
});

describe("custo máximo do turno com agenda", () => {
  const PRECOS = [
    {
      modelo: "gpt-6-luna",
      entrada: 100_000,
      saida: 500_000,
      cacheLeitura: 10_000,
      cacheEscrita: 125_000,
    },
  ];
  it("reserva as rodadas a mais quando a agenda está ligada", () => {
    const base = {
      catalogo: CATALOGO,
      mensagens: [paciente("Quero marcar")],
      agoraMs: AGORA,
      fuso: FUSO,
      modelo: "gpt-6-luna",
      modeloDosClassificadores: "gpt-6-luna",
      precos: PRECOS,
    };
    const sem =
      custoMaximoDoTurno({ ...base, config: configPadraoDoAgente() }) ?? 0;
    const com = custoMaximoDoTurno({ ...base, config: configComAgenda() }) ?? 0;
    expect(com).toBeGreaterThan(sem);
    expect(com).toBeGreaterThanOrEqual(
      Math.ceil(
        (MAXIMO_DE_RODADAS_COM_AGENDA * MAX_TOKENS_DO_AGENTE * 500_000) / 1e6,
      ),
    );
  });
});

describe("o texto de marcar e a passagem prometida (Q5)", () => {
  it("a forma que o texto fixo pede não vira passagem; prometer ação da equipe vira", async () => {
    const marcado =
      "Pronto! Sua Consulta de terça, 20/10 às 11:30 com a Dra. Ana Lima ficou marcada. Ela fica pendente até a equipe aprovar, e a confirmação chega por aqui.";
    const pergunta =
      "Reservei terça, 20/10 às 11:30 por 10 minutos. Confirma a Consulta com a Dra. Ana Lima nesse horário?";
    // AG2: o texto de marcar so sai no turno em que a ferramenta marcou ou
    // reservou (os fatos do turno); aqui, cada um com a sua ferramenta.
    banco.rpc("agendar_pela_ia", () => ({
      data: {
        ok: true,
        appointment_id: randomUUID(),
        starts_at: iso("2026-10-20", "11:30"),
        ends_at: iso("2026-10-20", "11:45"),
        reutilizado: false,
        service_link_id: VINC.consultaAna,
      },
      error: null,
    }));
    for (const [texto, ferramentas] of [
      [marcado, [ferramenta("agendar", {})]],
      [
        pergunta,
        [
          ferramenta("buscar_horario", BUSCA),
          ferramenta("reservar_horario", { horario: "h1" }),
        ],
      ],
    ] as const) {
      const { cliente } = clienteComRoteiro([...ferramentas, final(texto)]);
      const r = await executarTurnoDoAgente(entrada({ cliente }));
      expect(r.tipo, texto).toBe("resposta");
    }
    // Sem a ferramenta, o mesmo texto nao e passagem: e afirmacao sem fato,
    // e a conformidade barra (frase fixa e a equipe).
    for (const texto of [marcado, pergunta]) {
      const { cliente } = clienteComRoteiro([final(texto)]);
      const r = await executarTurnoDoAgente(entrada({ cliente }));
      expect(r.desfecho, texto).toMatchObject({
        tipo: "bloqueou",
        categoria: "acao_nao_executada",
        camada: "regra",
      });
    }
    for (const texto of [
      "Pronto, ficou marcada. A equipe vai confirmar por aqui.",
      "Posso confirmar a Consulta com a Dra. Ana Lima na terça às 11:30?",
    ]) {
      const { cliente } = clienteComRoteiro([final(texto)]);
      const r = await executarTurnoDoAgente(entrada({ cliente }));
      expect(r.desfecho, texto).toEqual({
        tipo: "escalou",
        motivo: "agente_pediu",
        gatilho: null,
        origem: "texto_do_agente",
      });
    }
  });
});
