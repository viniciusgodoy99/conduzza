import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchAgendadasDoFio } from "@/lib/queries/agendadas-do-fio";
import {
  CONVERSATIONS_ATIVAS_LIMIT,
  fetchConversations,
  fetchMessagesPage,
} from "@/lib/queries/conversations";
import { fetchMensagensAgendadas } from "@/lib/queries/mensagens-agendadas";

// As leituras do servidor da mensagem agendada:
// - a lista do contato (lib/queries/mensagens-agendadas.ts): o que entra
//   (filtro em uma ida so), a forma do item e o contexto calculado no
//   servidor (ultima entrada por numero, conexao, quem ainda escreve);
// - o fio: a agendada de onde a mensagem saiu NAO vem embutida (F11); vem
//   de fetchAgendadasDoFio (lib/queries/agendadas-do-fio.ts), so com ids, e
//   qualquer erro vira mapa vazio;
// - a lista de conversas (fetchConversations): as 300 mais recentes unidas
//   as que esperam resposta (F18).
// Contra um cliente dublado que grava a consulta; a RLS e o banco ficam nos
// testes de RLS e de integracao.

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const CONTATO = "3d3d3d3d-0000-4000-8000-000000000001";
const RECEPCAO = "4e4e4e4e-0000-4000-8000-000000000001";
const CENTRO = "4e4e4e4e-0000-4000-8000-000000000002";
const ANA = "7b7b7b7b-0000-4000-8000-000000000001";

type Consulta = {
  tabela: string;
  colunas?: string;
  filtros: [string, unknown, unknown?][];
};
type Resposta = { data: unknown; error: { message: string } | null };

function clienteGravador(responder: (c: Consulta) => Resposta) {
  const consultas: Consulta[] = [];
  const cliente = {
    from(tabela: string) {
      const consulta: Consulta = { tabela, filtros: [] };
      consultas.push(consulta);
      const api: Record<string, unknown> = {};
      api.select = (colunas: string) => {
        consulta.colunas = colunas;
        return api;
      };
      for (const metodo of [
        "eq",
        "neq",
        "in",
        "is",
        "or",
        "order",
        "limit",
        "lt",
      ]) {
        api[metodo] = (coluna: unknown, valor?: unknown) => {
          consulta.filtros.push([metodo, coluna, valor]);
          return api;
        };
      }
      api.then = (
        resolver: (valor: Resposta) => unknown,
        rejeitar?: (erro: unknown) => unknown,
      ) => Promise.resolve(responder(consulta)).then(resolver, rejeitar);
      return api;
    },
  };
  return { cliente: cliente as never, consultas };
}

function linha(campos: Record<string, unknown> = {}) {
  return {
    id: "6a6a6a6a-0000-4000-8000-000000000001",
    contact_id: CONTATO,
    whatsapp_account_id: RECEPCAO,
    conversation_id: "5f5f5f5f-0000-4000-8000-000000000001",
    texto: "Bom dia!",
    enviar_em: "2026-10-08T12:30:00+00:00",
    situacao: "agendada",
    motivo: null,
    criada_por: ANA,
    editada_por: null,
    enviada_em: null,
    message_id: null,
    dispensada_em: null,
    criada_em: "2026-10-06T15:00:00+00:00",
    editada_em: null,
    ...campos,
  };
}

const AGORA = new Date("2026-10-06T15:00:00.000Z");

describe("fetchMensagensAgendadas", () => {
  it("sem agendada: uma consulta só, e contexto vazio", async () => {
    const { cliente, consultas } = clienteGravador(() => ({
      data: [],
      error: null,
    }));
    expect(
      await fetchMensagensAgendadas(cliente, CLINICA, CONTATO, AGORA),
    ).toEqual({
      itens: [],
      contexto: {
        ultimaEntradaPorNumero: {},
        conexaoPorNumero: {},
        membrosComEscrita: [],
      },
    });
    expect(consultas).toHaveLength(1);
    const [lista] = consultas;
    expect(lista!.tabela).toBe("mensagem_agendada");
    expect(lista!.filtros).toContainEqual(["eq", "clinic_id", CLINICA]);
    expect(lista!.filtros).toContainEqual(["eq", "contact_id", CONTATO]);
    // As que vao sair, as que nao sairam sem dispensa e as enviadas das
    // ultimas 24 h, numa expressao so.
    expect(lista!.filtros).toContainEqual([
      "or",
      'situacao.in.(agendada,enviando),and(situacao.in.(nao_enviada,nao_confirmada),dispensada_em.is.null),and(situacao.eq.enviada,enviada_em.gte."2026-10-05T15:00:00.000Z")',
      undefined,
    ]);
  });

  it("monta os itens e o contexto: última entrada por número, conexão e quem escreve", async () => {
    const { cliente, consultas } = clienteGravador((consulta) => {
      switch (consulta.tabela) {
        case "mensagem_agendada":
          return {
            data: [
              linha(),
              linha({
                id: "6a6a6a6a-0000-4000-8000-000000000002",
                whatsapp_account_id: CENTRO,
                situacao: "nao_enviada",
                motivo: "numero_desconectado",
              }),
              linha({
                id: "6a6a6a6a-0000-4000-8000-000000000003",
                situacao: "estranha",
              }),
              linha({
                id: "6a6a6a6a-0000-4000-8000-000000000004",
                situacao: "nao_enviada",
                motivo: "motivo_que_nao_existe",
              }),
            ],
            error: null,
          };
        case "conversation":
          return {
            data: [
              {
                whatsapp_account_id: RECEPCAO,
                last_inbound_at: "2026-10-01T10:00:00+00:00",
              },
              {
                whatsapp_account_id: RECEPCAO,
                last_inbound_at: "2026-10-06T14:00:00+00:00",
              },
              { whatsapp_account_id: CENTRO, last_inbound_at: null },
            ],
            error: null,
          };
        case "whatsapp_account":
          return {
            data: [
              {
                id: RECEPCAO,
                nome: "Recepção",
                connection_status: "conectado",
                removido_em: null,
                cor: "verde",
              },
              {
                id: CENTRO,
                nome: "Centro",
                connection_status: "desconectado",
                removido_em: "2026-10-05T10:00:00+00:00",
                cor: "cor-que-nao-existe",
              },
            ],
            error: null,
          };
        case "clinic_member":
          return { data: [{ user_id: ANA }], error: null };
        default:
          return { data: null, error: null };
      }
    });
    const lista = await fetchMensagensAgendadas(
      cliente,
      CLINICA,
      CONTATO,
      AGORA,
    );
    expect(lista.itens.map((item) => item.id)).toEqual([
      "6a6a6a6a-0000-4000-8000-000000000001",
      "6a6a6a6a-0000-4000-8000-000000000002",
      "6a6a6a6a-0000-4000-8000-000000000004",
    ]);
    expect(lista.itens[0]).toEqual({
      id: "6a6a6a6a-0000-4000-8000-000000000001",
      contactId: CONTATO,
      whatsappAccountId: RECEPCAO,
      conversationId: "5f5f5f5f-0000-4000-8000-000000000001",
      texto: "Bom dia!",
      enviarEm: "2026-10-08T12:30:00+00:00",
      situacao: "agendada",
      motivo: null,
      criadaPor: ANA,
      editadaPor: null,
      enviadaEm: null,
      messageId: null,
      dispensadaEm: null,
      criadaEm: "2026-10-06T15:00:00+00:00",
      editadaEm: null,
    });
    expect(lista.itens[1]!.motivo).toBe("numero_desconectado");
    // Motivo fora da lista nunca chega a tela como codigo cru.
    expect(lista.itens[2]!.motivo).toBeNull();
    expect(lista.contexto).toEqual({
      ultimaEntradaPorNumero: {
        [RECEPCAO]: "2026-10-06T14:00:00+00:00",
        [CENTRO]: null,
      },
      conexaoPorNumero: {
        [RECEPCAO]: {
          nome: "Recepção",
          conectado: true,
          removido: false,
          cor: "verde",
        },
        [CENTRO]: {
          nome: "Centro",
          conectado: false,
          removido: true,
          cor: "azul",
        },
      },
      membrosComEscrita: [ANA],
    });
    // Tudo preso a clinica; numeros so os da lista; quem escreve sem a
    // Somente leitura.
    for (const consulta of consultas) {
      expect(consulta.filtros).toContainEqual(["eq", "clinic_id", CLINICA]);
    }
    const numeros = consultas.find((c) => c.tabela === "whatsapp_account")!;
    expect(numeros.filtros).toContainEqual(["in", "id", [RECEPCAO, CENTRO]]);
    const membros = consultas.find((c) => c.tabela === "clinic_member")!;
    expect(membros.filtros).toContainEqual(["eq", "status", "ativo"]);
    expect(membros.filtros).toContainEqual([
      "in",
      "role",
      ["admin", "gestor", "recepcao", "profissional"],
    ]);
  });

  it("erro de leitura lança, nunca vira lista vazia", async () => {
    const lista = clienteGravador(() => ({
      data: null,
      error: { message: "falhou" },
    }));
    await expect(
      fetchMensagensAgendadas(lista.cliente, CLINICA, CONTATO, AGORA),
    ).rejects.toThrow();
    const contexto = clienteGravador((consulta) =>
      consulta.tabela === "mensagem_agendada"
        ? { data: [linha()], error: null }
        : consulta.tabela === "clinic_member"
          ? { data: null, error: { message: "falhou" } }
          : { data: [], error: null },
    );
    await expect(
      fetchMensagensAgendadas(contexto.cliente, CLINICA, CONTATO, AGORA),
    ).rejects.toThrow();
  });
});

describe("fio da conversa: a agendada de onde a mensagem saiu (F11)", () => {
  const M1 = "8a8a8a8a-0000-4000-8000-000000000001";
  const M2 = "8a8a8a8a-0000-4000-8000-000000000002";
  const M3 = "8a8a8a8a-0000-4000-8000-000000000003";

  it("o select do fio não embute mensagem_agendada (uma tabela que falte não derruba o fio)", async () => {
    const { cliente, consultas } = clienteGravador(() => ({
      data: [],
      error: null,
    }));
    await fetchMessagesPage(cliente, "c1");
    expect(consultas[0]!.tabela).toBe("message");
    expect(consultas[0]!.colunas).not.toContain("mensagem_agendada");
  });

  it("consulta separada: só ids, presa à clínica, por message_id, e vira mapa", async () => {
    const { cliente, consultas } = clienteGravador(() => ({
      data: [
        { message_id: M1, criada_por: ANA, editada_por: null },
        { message_id: M2, criada_por: ANA, editada_por: CENTRO },
        // linha sem message_id ou sem autor: ignorada
        { message_id: null, criada_por: ANA, editada_por: null },
        { message_id: M3, criada_por: null, editada_por: null },
      ],
      error: null,
    }));
    const mapa = await fetchAgendadasDoFio(cliente, CLINICA, [
      M1,
      M2,
      M3,
      M1,
      // a bolha otimista tem id provisorio: fica de fora (um uuid invalido
      // derrubaria a consulta inteira)
      "otimista-1",
    ]);
    expect(mapa).toEqual({
      [M1]: { criadaPor: ANA, editadaPor: null },
      [M2]: { criadaPor: ANA, editadaPor: CENTRO },
    });
    expect(consultas).toHaveLength(1);
    const [consulta] = consultas;
    expect(consulta!.tabela).toBe("mensagem_agendada");
    // So ids: o texto da agendada nunca vem para o fio.
    expect(consulta!.colunas).toBe("message_id, criada_por, editada_por");
    expect(consulta!.filtros).toContainEqual(["eq", "clinic_id", CLINICA]);
    expect(consulta!.filtros).toContainEqual([
      "in",
      "message_id",
      [M1, M2, M3],
    ]);
  });

  it("sem ids válidos, nenhuma consulta", async () => {
    const { cliente, consultas } = clienteGravador(() => ({
      data: [],
      error: null,
    }));
    expect(await fetchAgendadasDoFio(cliente, CLINICA, [])).toEqual({});
    expect(await fetchAgendadasDoFio(cliente, CLINICA, ["x"])).toEqual({});
    expect(consultas).toEqual([]);
  });

  it("muitos ids: em lotes de 100 na URL", async () => {
    const ids = Array.from(
      { length: 250 },
      (_, i) => `8a8a8a8a-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const { cliente, consultas } = clienteGravador(() => ({
      data: [],
      error: null,
    }));
    await fetchAgendadasDoFio(cliente, CLINICA, ids);
    const tamanhos = consultas.map(
      (c) => (c.filtros.find((f) => f[0] === "in")![2] as string[]).length,
    );
    expect(tamanhos).toEqual([100, 100, 50]);
  });

  it("erro (tabela que falta, RLS, rede) ou exceção: mapa vazio, nunca lança", async () => {
    const erro = clienteGravador(() => ({
      data: null,
      error: { message: "relation does not exist" },
    }));
    expect(await fetchAgendadasDoFio(erro.cliente, CLINICA, [M1])).toEqual({});
    const lanca = {
      from() {
        throw new Error("rede");
      },
    };
    expect(await fetchAgendadasDoFio(lanca as never, CLINICA, [M1])).toEqual(
      {},
    );
  });
});

describe("lista de conversas: quem espera resposta nunca fica de fora (F18)", () => {
  function conversa(
    id: string,
    campos: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id,
      status: "aguardando_humano",
      awaiting_reply: false,
      last_message_at: null,
      last_inbound_at: null,
      contact: [{ id: CONTATO, name: "Maria", phone_e164: "+5584999990000" }],
      ...campos,
    };
  }

  it("as mais recentes unidas às que esperam resposta, sem repetir, na ordem da última mensagem", async () => {
    const { cliente, consultas } = clienteGravador((consulta) => {
      const esperando = consulta.filtros.some(
        (f) => f[0] === "eq" && f[1] === "awaiting_reply",
      );
      return esperando
        ? {
            data: [
              // fora das recentes: o paciente escreveu ontem e ninguem
              // respondeu
              conversa("antiga", {
                awaiting_reply: true,
                last_message_at: "2026-10-05T18:00:00+00:00",
                last_inbound_at: "2026-10-05T18:00:00+00:00",
              }),
              // tambem esta nas recentes: nao repete
              conversa("recente-2", {
                awaiting_reply: true,
                last_message_at: "2026-10-06T14:00:00+00:00",
                last_inbound_at: "2026-10-06T14:00:00+00:00",
              }),
            ],
            error: null,
          }
        : {
            data: [
              conversa("recente-1", {
                last_message_at: "2026-10-06T15:00:00+00:00",
              }),
              conversa("recente-2", {
                awaiting_reply: true,
                last_message_at: "2026-10-06T14:00:00+00:00",
                last_inbound_at: "2026-10-06T14:00:00+00:00",
              }),
            ],
            error: null,
          };
    });
    const lista = await fetchConversations(cliente, CLINICA);
    expect(lista.map((c) => c.id)).toEqual([
      "recente-1",
      "recente-2",
      "antiga",
    ]);
    // O contato vem como objeto (normalizado).
    expect(lista[0]!.contact).toMatchObject({ id: CONTATO });
    expect(consultas).toHaveLength(2);
    for (const consulta of consultas) {
      expect(consulta.tabela).toBe("conversation");
      expect(consulta.filtros).toContainEqual(["eq", "clinic_id", CLINICA]);
      expect(consulta.filtros).toContainEqual(["neq", "status", "resolvida"]);
      expect(consulta.filtros).toContainEqual([
        "limit",
        CONVERSATIONS_ATIVAS_LIMIT,
        undefined,
      ]);
    }
    const [recentes, esperando] = consultas;
    expect(recentes!.filtros).toContainEqual([
      "order",
      "last_message_at",
      { ascending: false, nullsFirst: false },
    ]);
    expect(esperando!.filtros).toContainEqual(["eq", "awaiting_reply", true]);
    expect(esperando!.filtros).toContainEqual([
      "order",
      "last_inbound_at",
      { ascending: false, nullsFirst: false },
    ]);
  });

  it("erro em qualquer das duas leituras lança", async () => {
    const { cliente } = clienteGravador((consulta) =>
      consulta.filtros.some((f) => f[1] === "awaiting_reply")
        ? { data: null, error: { message: "falhou" } }
        : { data: [], error: null },
    );
    await expect(fetchConversations(cliente, CLINICA)).rejects.toThrow();
  });
});
