import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DICA_SEM_PERMISSAO_PARA_INICIAR,
  MENSAGEM_CONVERSA_COM_OUTRA_PESSOA,
  MENSAGEM_SEM_AUTORIZACAO_PARA_INICIAR,
  MENSAGEM_SEM_NUMERO_PARA_INICIAR,
} from "@/lib/domain/iniciar-conversa";

import { BancoEmMemoria, type Linha } from "../ia-whatsapp/banco-em-memoria";

// "Iniciar conversa" (decisao do dono em 20/10/2026): a Server Action de
// verdade (app/(app)/atendimento/iniciar-conversa-actions.ts), com a sessao,
// o banco e as duas pecas do Atendimento que ela reusa (o Assumir e o envio
// do atendente) trocados. Prova a ORDEM que importa: papel e autorizacao
// ANTES de qualquer escrita (sem autorizacao nada nasce, nem tentativa na
// trilha), o numero da clinica (ativo, desta clinica e conectado), a conversa
// aberta do numero reaproveitada (e a de um colega nunca tomada), e o envio
// pelo caminho do atendente, com a trilha so de ids.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const OUTRA_CLINICA = "c2222222-2222-4222-8222-222222222222";
const USUARIO = "a0000000-0000-4000-8000-000000000001";
const COLEGA = "a0000000-0000-4000-8000-000000000002";
const CONTATO = "10000000-0000-4000-8000-000000000001";
const CONTATO_DE_FORA = "10000000-0000-4000-8000-000000000002";
const PRINCIPAL = "20000000-0000-4000-8000-000000000001";
const SEGUNDO = "20000000-0000-4000-8000-000000000002";
const REMOVIDO = "20000000-0000-4000-8000-000000000003";
const DE_OUTRA_CLINICA = "20000000-0000-4000-8000-000000000004";
const CONVERSA_EXISTENTE = "30000000-0000-4000-8000-000000000001";
const TEXTO = "Olá! Aqui é da clínica. Podemos falar sobre o seu retorno?";

const estado = vi.hoisted(() => ({
  banco: null as unknown,
  sessao: null as unknown,
  rpcsDoAdmin: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    (estado.banco as { cliente: () => unknown }).cliente(),
}));
// O service role so entra no garantir_conversa_aberta: o espiao registra o
// que passou por ele.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const cliente = (
      estado.banco as {
        cliente: () => {
          rpc: (nome: string, args: Record<string, unknown>) => unknown;
        };
      }
    ).cliente();
    return {
      ...cliente,
      rpc: (nome: string, args: Record<string, unknown>) => {
        estado.rpcsDoAdmin.push(nome);
        return cliente.rpc(nome, args);
      },
    };
  },
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => estado.sessao,
}));
const atendimento = vi.hoisted(() => ({
  assumirConversaAction: vi.fn(),
  enviarComoAtendente: vi.fn(),
}));
vi.mock("@/app/(app)/atendimento/actions", () => atendimento);

const { iniciarConversaAction } =
  await import("@/app/(app)/atendimento/iniciar-conversa-actions");

let banco: BancoEmMemoria;
let autorizado: boolean | "erro";

function sessao(papel = "recepcao") {
  return {
    userId: USUARIO,
    userName: "Ana Recepção",
    active: {
      clinicId: CLINICA,
      role: papel,
      status: "ativo",
      timezone: "America/Fortaleza",
    },
  };
}

function numero(id: string, campos: Partial<Linha> = {}): Linha {
  return {
    id,
    clinic_id: CLINICA,
    nome: id === PRINCIPAL ? "Recepção" : "Unidade Centro",
    connection_status: "conectado",
    principal: id === PRINCIPAL,
    removido_em: null,
    created_at:
      id === PRINCIPAL ? "2026-09-01T00:00:00Z" : "2026-09-02T00:00:00Z",
    ...campos,
  };
}

/** O que garantir_conversa_aberta faz: acha a aberta do numero ou abre uma. */
function garantir(args: Record<string, unknown>) {
  const conversas = banco.linhas("conversation");
  const aberta = conversas.find(
    (conversa) =>
      conversa.clinic_id === args.p_clinic_id &&
      conversa.contact_id === args.p_contact_id &&
      conversa.whatsapp_account_id === args.p_whatsapp_account_id &&
      conversa.status !== "resolvida",
  );
  if (aberta) {
    return { data: aberta.id, error: null };
  }
  const id = `30000000-0000-4000-8000-00000000009${conversas.length}`;
  conversas.push({
    id,
    clinic_id: args.p_clinic_id,
    contact_id: args.p_contact_id,
    whatsapp_account_id: args.p_whatsapp_account_id,
    status: "aguardando_humano",
    assignee_user_id: null,
  });
  return { data: id, error: null };
}

function entrada(campos: Record<string, unknown> = {}) {
  return { contact_id: CONTATO, texto: TEXTO, ...campos };
}

function nadaFoiGravado() {
  expect(estado.rpcsDoAdmin).toEqual([]);
  expect(atendimento.assumirConversaAction).not.toHaveBeenCalled();
  expect(atendimento.enviarComoAtendente).not.toHaveBeenCalled();
  expect(banco.linhas("conversation")).toHaveLength(0);
  expect(banco.linhas("audit_log")).toHaveLength(0);
  expect(banco.operacoes.filter((op) => op.operacao !== "select")).toHaveLength(
    0,
  );
}

beforeEach(() => {
  banco = new BancoEmMemoria();
  estado.banco = banco;
  estado.sessao = sessao();
  estado.rpcsDoAdmin = [];
  autorizado = true;
  atendimento.assumirConversaAction.mockReset();
  atendimento.assumirConversaAction.mockResolvedValue({ ok: true });
  atendimento.enviarComoAtendente.mockReset();
  atendimento.enviarComoAtendente.mockResolvedValue({
    ok: true,
    messageId: "m1",
  });
  banco.linhas("contact").push(
    { id: CONTATO, clinic_id: CLINICA, phone_e164: "+5585999990001" },
    {
      id: CONTATO_DE_FORA,
      clinic_id: OUTRA_CLINICA,
      phone_e164: "+5585999990002",
    },
  );
  banco
    .linhas("whatsapp_account")
    .push(
      numero(PRINCIPAL),
      numero(SEGUNDO),
      numero(REMOVIDO, { removido_em: "2026-10-01T00:00:00Z" }),
      numero(DE_OUTRA_CLINICA, { clinic_id: OUTRA_CLINICA }),
    );
  banco.rpc("consentimento_vigente", () =>
    autorizado === "erro"
      ? { data: null, error: { code: "57014" } }
      : { data: autorizado, error: null },
  );
  banco.rpc("garantir_conversa_aberta", garantir);
});

describe("iniciarConversaAction: autorização ANTES de tudo", () => {
  it("sem autorização vigente recusa com a frase e não grava nada, nem tentativa", async () => {
    autorizado = false;
    const resultado = await iniciarConversaAction(entrada());
    expect(resultado).toEqual({
      ok: false,
      error: MENSAGEM_SEM_AUTORIZACAO_PARA_INICIAR,
    });
    nadaFoiGravado();
    // A autorizacao foi conferida pela SESSAO, com o contato e o canal.
    expect(banco.chamadasDe("consentimento_vigente")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_contact_id: CONTATO,
        p_channel: "whatsapp",
      },
    ]);
  });

  it("autorização que não deu para conferir também não grava nada", async () => {
    autorizado = "erro";
    const resultado = await iniciarConversaAction(entrada());
    expect(resultado).toEqual({
      ok: false,
      error: "Não foi possível conferir a autorização. Tente de novo.",
    });
    nadaFoiGravado();
  });

  it("contato de outra clínica é recusado antes da autorização", async () => {
    const resultado = await iniciarConversaAction(
      entrada({ contact_id: CONTATO_DE_FORA }),
    );
    expect(resultado).toEqual({
      ok: false,
      error: "Contato não encontrado nesta clínica.",
    });
    expect(banco.chamadasDe("consentimento_vigente")).toHaveLength(0);
    nadaFoiGravado();
  });
});

describe("iniciarConversaAction: papel e Zod", () => {
  it.each(["profissional", "leitura"])(
    "%s é recusado sem nem consultar o banco",
    async (papel) => {
      estado.sessao = sessao(papel);
      const resultado = await iniciarConversaAction(entrada());
      expect(resultado).toEqual({
        ok: false,
        error: DICA_SEM_PERMISSAO_PARA_INICIAR,
      });
      expect(banco.operacoes).toHaveLength(0);
      expect(banco.chamadas).toHaveLength(0);
      nadaFoiGravado();
    },
  );

  it.each(["admin", "gestor", "recepcao"])("%s inicia", async (papel) => {
    estado.sessao = sessao(papel);
    const resultado = await iniciarConversaAction(entrada());
    expect(resultado.ok).toBe(true);
  });

  it("sessão expirada não grava nada", async () => {
    estado.sessao = null;
    const resultado = await iniciarConversaAction(entrada());
    expect(resultado).toEqual({
      ok: false,
      error: "Sessão expirada. Entre de novo.",
    });
    nadaFoiGravado();
  });

  it.each([
    ["texto vazio", { texto: "   " }, "Escreva a mensagem antes de enviar."],
    [
      "texto acima de 4.096 caracteres",
      { texto: "a".repeat(4097) },
      "A mensagem ficou longa demais.",
    ],
    [
      "contato que não é uuid",
      { contact_id: "nao-e-uuid" },
      "Confira os dados da conversa.",
    ],
    [
      "número que não é uuid",
      { whatsapp_account_id: "numero" },
      "Confira os dados da conversa.",
    ],
  ])("%s é recusado sem tocar no banco", async (_caso, campos, mensagem) => {
    const resultado = await iniciarConversaAction(entrada(campos));
    expect(resultado).toEqual({ ok: false, error: mensagem });
    expect(banco.operacoes).toHaveLength(0);
    nadaFoiGravado();
  });
});

describe("iniciarConversaAction: o número da clínica", () => {
  it("sem escolha, sai pelo principal", async () => {
    await iniciarConversaAction(entrada());
    expect(banco.chamadasDe("garantir_conversa_aberta")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_contact_id: CONTATO,
        p_whatsapp_account_id: PRINCIPAL,
      },
    ]);
    // So o service role abre a conversa.
    expect(estado.rpcsDoAdmin).toEqual(["garantir_conversa_aberta"]);
  });

  it("principal desconectado e sem escolha: o primeiro conectado", async () => {
    const principal = banco
      .linhas("whatsapp_account")
      .find((linha) => linha.id === PRINCIPAL);
    Object.assign(principal ?? {}, { connection_status: "desconectado" });
    await iniciarConversaAction(entrada());
    expect(
      banco.chamadasDe("garantir_conversa_aberta")[0]?.p_whatsapp_account_id,
    ).toBe(SEGUNDO);
  });

  it("o número escolhido, quando é desta clínica e está conectado", async () => {
    await iniciarConversaAction(entrada({ whatsapp_account_id: SEGUNDO }));
    expect(
      banco.chamadasDe("garantir_conversa_aberta")[0]?.p_whatsapp_account_id,
    ).toBe(SEGUNDO);
  });

  it.each([
    ["de outra clínica", DE_OUTRA_CLINICA],
    ["removido", REMOVIDO],
  ])(
    "número %s é recusado sem abrir conversa",
    async (_caso, whatsappAccountId) => {
      const resultado = await iniciarConversaAction(
        entrada({ whatsapp_account_id: whatsappAccountId }),
      );
      expect(resultado).toEqual({
        ok: false,
        error:
          "Este número não está mais ativo na clínica. Escolha outro número.",
      });
      nadaFoiGravado();
    },
  );

  it("número escolhido desconectado diz qual e não abre conversa", async () => {
    const segundo = banco
      .linhas("whatsapp_account")
      .find((linha) => linha.id === SEGUNDO);
    Object.assign(segundo ?? {}, { connection_status: "desconectado" });
    const resultado = await iniciarConversaAction(
      entrada({ whatsapp_account_id: SEGUNDO }),
    );
    expect(resultado).toEqual({
      ok: false,
      error:
        'O número "Unidade Centro" não está conectado. Reconecte em Configurações ou escolha outro número.',
    });
    nadaFoiGravado();
  });

  it("clínica sem número ativo: recusa com o caminho para conectar", async () => {
    banco.tabelas.set(
      "whatsapp_account",
      banco
        .linhas("whatsapp_account")
        .filter((linha) => linha.clinic_id !== CLINICA),
    );
    const resultado = await iniciarConversaAction(entrada());
    expect(resultado).toEqual({
      ok: false,
      error: MENSAGEM_SEM_NUMERO_PARA_INICIAR,
    });
    nadaFoiGravado();
  });
});

describe("iniciarConversaAction: a conversa e o envio", () => {
  it("abre a conversa do número, fica com quem iniciou e envia pelo caminho do atendente", async () => {
    const resultado = await iniciarConversaAction(entrada());
    const [conversa] = banco.linhas("conversation");
    expect(conversa).toMatchObject({
      clinic_id: CLINICA,
      contact_id: CONTATO,
      whatsapp_account_id: PRINCIPAL,
    });
    expect(resultado).toEqual({ ok: true, conversationId: conversa?.id });
    expect(atendimento.assumirConversaAction).toHaveBeenCalledWith(
      conversa?.id,
    );
    expect(atendimento.enviarComoAtendente).toHaveBeenCalledWith(
      conversa?.id,
      TEXTO,
    );
    // Assumir ANTES de enviar: o envio do atendente exige a conversa com ele.
    expect(
      atendimento.assumirConversaAction.mock.invocationCallOrder[0],
    ).toBeLessThan(
      atendimento.enviarComoAtendente.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("o texto vai aparado, como na resposta digitada", async () => {
    await iniciarConversaAction(entrada({ texto: `  ${TEXTO}  ` }));
    expect(atendimento.enviarComoAtendente).toHaveBeenCalledWith(
      expect.any(String),
      TEXTO,
    );
  });

  it("conversa aberta naquele número: a mensagem cai nela, sem conversa nova", async () => {
    banco.linhas("conversation").push({
      id: CONVERSA_EXISTENTE,
      clinic_id: CLINICA,
      contact_id: CONTATO,
      whatsapp_account_id: PRINCIPAL,
      status: "aguardando_humano",
      assignee_user_id: null,
    });
    const resultado = await iniciarConversaAction(entrada());
    expect(resultado).toEqual({
      ok: true,
      conversationId: CONVERSA_EXISTENTE,
    });
    expect(banco.linhas("conversation")).toHaveLength(1);
    expect(atendimento.assumirConversaAction).toHaveBeenCalledWith(
      CONVERSA_EXISTENTE,
    );
    expect(atendimento.enviarComoAtendente).toHaveBeenCalledWith(
      CONVERSA_EXISTENTE,
      TEXTO,
    );
  });

  it("conversa aberta em atendimento com um colega: não toma a conversa e devolve o id", async () => {
    banco.linhas("conversation").push({
      id: CONVERSA_EXISTENTE,
      clinic_id: CLINICA,
      contact_id: CONTATO,
      whatsapp_account_id: PRINCIPAL,
      status: "em_atendimento",
      assignee_user_id: COLEGA,
    });
    const resultado = await iniciarConversaAction(entrada());
    expect(resultado).toEqual({
      ok: false,
      error: MENSAGEM_CONVERSA_COM_OUTRA_PESSOA,
      conversationId: CONVERSA_EXISTENTE,
    });
    expect(atendimento.assumirConversaAction).not.toHaveBeenCalled();
    expect(atendimento.enviarComoAtendente).not.toHaveBeenCalled();
    expect(banco.linhas("audit_log")).toHaveLength(0);
  });

  it("conversa aberta em OUTRO número não serve: abre a do número escolhido", async () => {
    banco.linhas("conversation").push({
      id: CONVERSA_EXISTENTE,
      clinic_id: CLINICA,
      contact_id: CONTATO,
      whatsapp_account_id: SEGUNDO,
      status: "em_atendimento",
      assignee_user_id: COLEGA,
    });
    const resultado = await iniciarConversaAction(entrada());
    expect(resultado.ok).toBe(true);
    expect(banco.linhas("conversation")).toHaveLength(2);
  });

  it("a trilha diz quem iniciou e qual conversa, sem telefone nem texto", async () => {
    const resultado = await iniciarConversaAction(entrada());
    const trilha = banco.linhas("audit_log");
    expect(trilha).toEqual([
      expect.objectContaining({
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "iniciou_conversa",
        entity: "conversation",
        entity_id: resultado.ok ? resultado.conversationId : null,
      }),
    ]);
    const texto = JSON.stringify(trilha);
    expect(texto).not.toContain("99999");
    expect(texto).not.toContain("retorno");
  });

  it("envio que falhou devolve o motivo e a conversa, sem a trilha de iniciou", async () => {
    atendimento.enviarComoAtendente.mockResolvedValue({
      ok: false,
      error: 'O número "Recepção" da clínica não está conectado.',
      codigo: "desconectado",
      naoSaiu: true,
    });
    const resultado = await iniciarConversaAction(entrada());
    const [conversa] = banco.linhas("conversation");
    expect(resultado).toEqual({
      ok: false,
      error: 'O número "Recepção" da clínica não está conectado.',
      conversationId: conversa?.id,
    });
    expect(banco.linhas("audit_log")).toHaveLength(0);
  });

  it("assumir que falhou não envia e devolve a conversa", async () => {
    atendimento.assumirConversaAction.mockResolvedValue({
      ok: false,
      error: "Outra pessoa assumiu esta conversa primeiro. Atualize a lista.",
    });
    const resultado = await iniciarConversaAction(entrada());
    expect(resultado).toMatchObject({
      ok: false,
      error: "Outra pessoa assumiu esta conversa primeiro. Atualize a lista.",
    });
    expect(resultado.ok ? null : resultado.conversationId).toBeTruthy();
    expect(atendimento.enviarComoAtendente).not.toHaveBeenCalled();
  });

  it("falha ao abrir a conversa não chama o Assumir nem o envio", async () => {
    banco.rpc("garantir_conversa_aberta", () => ({
      data: null,
      error: { code: "23502" },
    }));
    const resultado = await iniciarConversaAction(entrada());
    expect(resultado).toEqual({
      ok: false,
      error: "Não foi possível abrir a conversa. Tente de novo.",
    });
    expect(atendimento.assumirConversaAction).not.toHaveBeenCalled();
    expect(atendimento.enviarComoAtendente).not.toHaveBeenCalled();
  });
});
