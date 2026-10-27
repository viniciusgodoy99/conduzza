import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ClienteDoAgente } from "@/lib/agente/laco";
import type { ConfigDoAgente } from "@/lib/domain/agente/config";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import type { ClassificadorDeEntrada } from "@/lib/integrations/llm/classificador-de-entrada";

import { bancoDaAg3 } from "./ag3-contrato";
import type { AgendaEmMemoria } from "./agenda-em-memoria";
import {
  AGORA,
  CLINICA,
  codigoDoProcedimento,
  configComAgenda,
  FUSO,
  PROC,
} from "./agenda-fixtures";
import { catalogoDoCadastro } from "./cadastro-fixtures";

// O agendamento completo (AG3) no SIMULADOR da Tela 6, de ponta a ponta e
// SEM GRAVAR NADA: o estado do atendimento volta para a tela num pacote
// assinado (ligado a resposta), a reserva e a marcacao sao simuladas (a
// reserva confere a Agenda de verdade, como a RPC), os dados sao conferidos
// pelas regras do banco e o valor nao fica em lugar nenhum. Pacote alterado
// e recusado como o historico alterado. Nenhum teste fala com a OpenAI.

const CATALOGO = catalogoDoCadastro();
const P_CONSULTA = codigoDoProcedimento(CATALOGO, PROC.consulta);
const USUARIO = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const SEGREDO = "s".repeat(40);
const AMBIENTE = {
  OPENAI_API_KEY: "sk-teste",
  VERCEL_ENV: "production",
  IA_SEGREDO_DO_IDENTIFICADOR: SEGREDO,
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

type Fala = { autor: "paciente" | "assistente"; texto: string; assinatura?: string | null };

/** A conversa de teste como a tela guarda (falas, assinaturas e o estado). */
class TelaDoSimulador {
  falas: Fala[] = [];
  estado: string | null = null;
  agora = AGORA;

  async envia(texto: string, roteiro: unknown[], estado = this.estado) {
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
        estado,
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
      this.falas.push({ autor: "assistente", texto: r.resposta, assinatura: r.assinatura });
      this.estado = r.estado;
    } else {
      this.falas.pop();
    }
    return r;
  }
}

beforeEach(() => {
  banco = bancoDoSimulador();
  contexto.config = configComAgenda() satisfies ConfigDoAgente;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const BUSCA = {
  procedimento: P_CONSULTA,
  profissional: null,
  convenio: null,
  a_partir_de: null,
  periodo: "tarde",
  unidade: null,
  hora: null,
};

describe("o simulador faz o agendamento inteiro sem gravar nada", () => {
  it("oferecer, reservar pelo código do estado, os dados, Confirma e marcar: nenhuma escrita e nenhuma RPC de agenda", async () => {
    const tela = new TelaDoSimulador();
    const t1 = await tela.envia("Quero marcar uma consulta à tarde", [
      ferramenta("buscar_horario", BUSCA),
      final("Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima na unidade Centro. Pode ser?"),
    ]);
    expect(t1).toMatchObject({ ok: true, tipo: "resposta" });
    expect(tela.estado).toMatch(/^e1\./);

    const t2 = await tela.envia("Pode ser", [
      ferramenta("reservar_horario", { horario: "h2" }),
      final(
        "Reservei quarta, 21/10 às 14:00 com a Dra. Ana Lima, na unidade Centro. Me envie seu nome completo e sua data de nascimento.",
      ),
    ]);
    expect(t2).toMatchObject({ ok: true, tipo: "resposta" });
    if (t2.ok) {
      expect(t2.trilha.map((p) => p.texto)).toContain(
        "Reservaria quarta, 21/10 às 14:00 (Consulta, Dra. Ana Lima), unidade Centro por 10 minutos. No simulador, nada foi gravado.",
      );
    }

    const t3 = await tela.envia("Maria da Silva Souza, 12/03/1985", [
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
    expect(t3).toMatchObject({ ok: true, tipo: "resposta" });
    if (t3.ok) {
      expect(t3.trilha.map((p) => p.texto)).toContain(
        "Registraria o nome completo e a data de nascimento (nenhum dado falta). No simulador, nada foi gravado.",
      );
    }

    const t4 = await tela.envia("Sim, confirmo", [
      ferramenta("agendar", {}),
      final(
        "Pronto! Sua Consulta de quarta, 21/10 às 14:00 com a Dra. Ana Lima ficou marcada e fica pendente da aprovação da equipe. A confirmação chega por aqui.",
      ),
    ]);
    expect(t4).toMatchObject({ ok: true, tipo: "resposta" });
    if (t4.ok) {
      expect(t4.trilha.map((p) => p.texto)).toContain(
        "Marcaria a consulta de quarta, 21/10 às 14:00 (Consulta, Dra. Ana Lima), unidade Centro, pendente de aprovação da equipe. No simulador, nada foi gravado.",
      );
    }

    // Nada gravado: nenhuma escrita em tabela e nenhuma RPC da agenda ou
    // dos dados; so as travas e o gasto.
    expect(banco.escritas).toEqual([]);
    expect(
      [...new Set(banco.chamadas.map((c) => c.nome))].sort(),
    ).toEqual(
      [
        "acertar_gasto_da_ia",
        "ia_clinicas_da_fase_controlada",
        "ia_pode_simular",
        "reservar_gasto_da_ia",
      ].sort(),
    );
    // O pacote do estado nunca leva o valor de um dado.
    for (const pacote of [tela.estado ?? ""]) {
      const conteudo = Buffer.from(pacote.split(".")[1] ?? "", "base64url").toString("utf8");
      expect(conteudo).not.toMatch(/Maria|Souza|1985/);
      expect(JSON.parse(conteudo)).toMatchObject({
        estado: { etapa: "pos_marcacao", desfecho: "marcou" },
        dados: { nome_completo: true, data_nascimento: true },
      });
    }
  });

  it("o pacote do estado alterado, ou de outra resposta, é recusado como o histórico alterado", async () => {
    const tela = new TelaDoSimulador();
    await tela.envia("Quero marcar uma consulta à tarde", [
      ferramenta("buscar_horario", BUSCA),
      final("Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima. Pode ser?"),
    ]);
    const [versao, conteudo, assinatura] = (tela.estado ?? "").split(".");
    const outro = Buffer.from(
      Buffer.from(conteudo ?? "", "base64url")
        .toString("utf8")
        .replace('"oferta"', '"aguardando_confirmacao"'),
      "utf8",
    ).toString("base64url");
    const alterado = await tela.envia(
      "Sim",
      [final("não deveria rodar")],
      `${versao}.${outro}.${assinatura}`,
    );
    expect(alterado).toEqual({
      ok: false,
      error: TEXTOS_DO_SIMULADOR.historicoAlterado,
    });
  });

  it("sem a pergunta Confirma de antes, marcar no simulador também não acontece", async () => {
    const tela = new TelaDoSimulador();
    await tela.envia("Quero marcar uma consulta à tarde", [
      ferramenta("buscar_horario", BUSCA),
      final("Tenho quarta, 21/10 às 14:00 com a Dra. Ana Lima. Pode ser?"),
    ]);
    const r = await tela.envia("Pode marcar", [
      ferramenta("agendar", {}),
      final("Antes, me confirme o horário: quarta, 21/10 às 14:00 com a Dra. Ana Lima. Pode ser?"),
    ]);
    expect(r).toMatchObject({ ok: true, tipo: "resposta" });
    if (r.ok) {
      expect(r.trilha.map((p) => p.texto)).toContain(
        "Tentou marcar a consulta: o paciente ainda não confirmou numa mensagem nova",
      );
    }
  });
});
