import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BancoFalso, type Linha } from "./banco-falso";

// Conexao por NUMERO (docs/07_multiplos_numeros_whatsapp.md, Fase 2):
// lib/actions/whatsapp-connect.ts contra um banco em memoria que imita as
// regras que importam (unique temporario por clinica, nome unico, limite do
// plano) e um servidor uazapi falso por fetch. Prova:
//   - toda acao recebe o id do numero, validado, e filtra por clinica E id;
//   - sem id, a conexao usa o principal, e sem numero nenhum cria o principal;
//   - a URL nova do webhook (?clinic=&account=&secret=);
//   - o nome da instancia (principal mantem, numero novo ganha o sufixo);
//   - a trava contra o mesmo celular em duas instancias;
//   - adicionar, renomear, principal e remover, com os papeis de D8.

const CLINICA_A = "0a0a0a0a-0000-4000-8000-00000000000a";
const CLINICA_B = "0b0b0b0b-0000-4000-8000-00000000000b";

const banco = new BancoFalso();
const sessao = {
  userId: "usuario-da-sessao",
  active: {
    clinicId: CLINICA_A,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "admin" as string,
    status: "ativo",
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => banco.cliente(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => banco.cliente(),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Map([
      ["origin", "https://app.exemplo.test"],
      ["host", "app.exemplo.test"],
    ]),
}));

const {
  adicionarNumeroAction,
  atualizarNumeroAction,
  checarConexaoAction,
  connectWhatsAppAction,
  definirNumeroPrincipalAction,
  disconnectWhatsAppAction,
  pollWhatsAppStatusAction,
  removerNumeroAction,
} = await import("@/lib/actions/whatsapp-connect");

type Chamada = {
  caminho: string;
  method: string;
  body: Record<string, unknown> | null;
  token: string | null;
};
type Resposta = { status: number; body?: unknown };

/** Servidor uazapi falso: responde por "METODO /caminho" e registra tudo. */
function servidorUazapi(
  respostas: Record<string, (chamada: Chamada) => Resposta> = {},
): Chamada[] {
  const chamadas: Chamada[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const cabecalhos = (init?.headers ?? {}) as Record<string, string>;
      const chamada: Chamada = {
        caminho: new URL(String(url)).pathname,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
        token: cabecalhos.token ?? null,
      };
      chamadas.push(chamada);
      const resposta = respostas[`${chamada.method} ${chamada.caminho}`]?.(
        chamada,
      ) ?? { status: 200, body: {} };
      return new Response(JSON.stringify(resposta.body ?? {}), {
        status: resposta.status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return chamadas;
}

function usarUazapi(): void {
  vi.stubEnv("WHATSAPP_PROVIDER", "uazapi");
  vi.stubEnv("UAZAPI_SERVER_URL", "https://uazapi.exemplo.test");
  vi.stubEnv("UAZAPI_ADMIN_TOKEN", "token-admin");
  vi.stubEnv("PUBLIC_APP_URL", "https://app.exemplo.test");
}

function conectadoCom(owner: string): Resposta {
  return {
    status: 200,
    body: {
      instance: { status: "connected", owner: `${owner}@s.whatsapp.net` },
    },
  };
}

/** Eventos de log escritos durante o teste (so o nome e os campos). */
function logs(): Linha[] {
  return escritas
    .flatMap((texto) => texto.split("\n"))
    .filter((linha) => linha.startsWith("{"))
    .map((linha) => JSON.parse(linha) as Linha);
}
const escritas: string[] = [];

function numeros(clinicId = CLINICA_A): Linha[] {
  return banco
    .linhas("whatsapp_account")
    .filter((numero) => numero.clinic_id === clinicId);
}

beforeEach(() => {
  banco.limpar();
  sessao.active.role = "admin";
  sessao.active.clinicId = CLINICA_A;
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("WHATSAPP_PROVIDER", "");
  vi.stubEnv("PUBLIC_APP_URL", "https://app.exemplo.test");
  escritas.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation((texto) => {
    escritas.push(String(texto));
    return true;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("conectar: qual número", () => {
  it("clínica sem número: Conectar cria o principal e devolve o id dele", async () => {
    const estado = await connectWhatsAppAction(null);

    const [numero] = numeros();
    expect(numeros()).toHaveLength(1);
    expect(numero).toMatchObject({
      nome: "Número principal",
      principal: true,
      provider: "fake",
      connection_status: "conectado",
    });
    expect(estado).toMatchObject({
      status: "conectado",
      accountId: numero!.id,
    });
    expect(banco.linhas("whatsapp_account_secret")).toEqual([
      expect.objectContaining({ clinic_id: CLINICA_A, account_id: numero!.id }),
    ]);
  });

  it("sem id e com número, usa o principal e não cria outro", async () => {
    const principal = banco.numero({ clinic_id: CLINICA_A });
    banco.segredo({ clinic_id: CLINICA_A, account_id: principal.id as string });

    const estado = await connectWhatsAppAction(null);

    expect(numeros()).toHaveLength(1);
    expect(estado.accountId).toBe(principal.id);
    expect(principal.connection_status).toBe("conectado");
  });

  it("id de outra clínica não é encontrado e nada muda nela", async () => {
    const alheio = banco.numero({
      clinic_id: CLINICA_B,
      connection_status: "conectado",
    });
    banco.segredo({ clinic_id: CLINICA_B, account_id: alheio.id as string });

    for (const resultado of [
      await connectWhatsAppAction(alheio.id as string),
      await pollWhatsAppStatusAction(alheio.id as string),
      await disconnectWhatsAppAction(alheio.id as string),
    ]) {
      expect(resultado.error).toBe(
        "Este número não existe mais nesta clínica. Recarregue a página.",
      );
    }
    expect(alheio.connection_status).toBe("conectado");
    expect(numeros()).toHaveLength(0);
  });

  it("número removido não conecta", async () => {
    const removido = banco.numero({
      clinic_id: CLINICA_A,
      principal: false,
      removido_em: "2026-09-25T12:00:00Z",
    });

    const estado = await connectWhatsAppAction(removido.id as string);

    expect(estado.error).toBe(
      "Este número não existe mais nesta clínica. Recarregue a página.",
    );
  });

  it("id que não é uuid é recusado antes de tocar no banco", async () => {
    const estado = await connectWhatsAppAction("1; drop table clinic");

    expect(estado.error).toBe(
      "Número de WhatsApp inválido. Recarregue a página e tente de novo.",
    );
    expect(numeros()).toHaveLength(0);
  });

  it("desconectar exige o id", async () => {
    const estado = await disconnectWhatsAppAction(
      undefined as unknown as string,
    );

    expect(estado.error).toBe(
      "Número de WhatsApp inválido. Recarregue a página e tente de novo.",
    );
  });

  it("papel sem Configurações não conecta", async () => {
    sessao.active.role = "recepcao";

    const estado = await connectWhatsAppAction(null);

    expect(estado.error).toBeTruthy();
    expect(numeros()).toHaveLength(0);
  });
});

describe("conectar: instância e webhook do número", () => {
  it("grava a URL nova do webhook, com clínica, número e o segredo do número", async () => {
    usarUazapi();
    const numero = banco.numero({
      clinic_id: CLINICA_A,
      provider: "uazapi",
      instance_id: "conduzza_clinica_a",
    });
    banco.segredo({
      clinic_id: CLINICA_A,
      account_id: numero.id as string,
      webhook_secret: "s3gredo",
      instance_token: "tok-a",
    });
    const chamadas = servidorUazapi({
      "POST /instance/connect": () => ({
        status: 200,
        body: {
          instance: {
            status: "connecting",
            qrcode: "data:image/png;base64,QR",
          },
        },
      }),
    });

    const estado = await connectWhatsAppAction(numero.id as string);

    const webhook = chamadas.find((chamada) => chamada.caminho === "/webhook");
    expect(webhook?.body?.url).toBe(
      `https://app.exemplo.test/api/webhooks/whatsapp?clinic=${CLINICA_A}&account=${numero.id as string}&secret=s3gredo`,
    );
    expect(webhook?.token).toBe("tok-a");
    expect(estado).toMatchObject({
      status: "aguardando_qr",
      accountId: numero.id,
    });
  });

  it("o principal que já tem instância mantém o nome dela ao recriar", async () => {
    usarUazapi();
    const numero = banco.numero({
      clinic_id: CLINICA_A,
      provider: "uazapi",
      instance_id: "conduzza_nome_antigo",
    });
    const segredo = banco.segredo({
      clinic_id: CLINICA_A,
      account_id: numero.id as string,
    });
    const chamadas = servidorUazapi({
      "POST /instance/create": (chamada) => ({
        status: 200,
        body: { token: "tok-novo", name: chamada.body?.name },
      }),
    });

    await connectWhatsAppAction(numero.id as string);

    const criar = chamadas.find(
      (chamada) => chamada.caminho === "/instance/create",
    );
    expect(criar?.body).toEqual({ name: "conduzza_nome_antigo" });
    expect(segredo.instance_token).toBe("tok-novo");
  });

  it("número sem instância ganha o sufixo do próprio id no nome", async () => {
    usarUazapi();
    const numero = banco.numero({ clinic_id: CLINICA_A, provider: "uazapi" });
    banco.segredo({ clinic_id: CLINICA_A, account_id: numero.id as string });
    const chamadas = servidorUazapi({
      "POST /instance/create": (chamada) => ({
        status: 200,
        body: { token: "tok-novo", name: chamada.body?.name },
      }),
    });

    await connectWhatsAppAction(numero.id as string);

    const criar = chamadas.find(
      (chamada) => chamada.caminho === "/instance/create",
    );
    expect(criar?.body).toEqual({
      name: `conduzza_clinica_a_${(numero.id as string).slice(0, 8)}`,
    });
    expect(numero.instance_id).toBe(
      `conduzza_clinica_a_${(numero.id as string).slice(0, 8)}`,
    );
  });
});

describe("trava contra o mesmo celular em duas instâncias", () => {
  function numeroEmPareamento(): Linha {
    const numero = banco.numero({
      clinic_id: CLINICA_A,
      provider: "uazapi",
      connection_status: "aguardando_qr",
    });
    banco.segredo({
      clinic_id: CLINICA_A,
      account_id: numero.id as string,
      instance_token: "tok-a",
    });
    return numero;
  }

  it("o mesmo celular conectado em outra clínica derruba a conexão nova", async () => {
    usarUazapi();
    banco.numero({
      clinic_id: CLINICA_B,
      provider: "uazapi",
      connection_status: "conectado",
      // Sem o nono digito, como o uazapi entrega: a chave e a mesma.
      display_phone: "558499990000",
    });
    const numero = numeroEmPareamento();
    const chamadas = servidorUazapi({
      "GET /instance/status": () => conectadoCom("5584999990000"),
    });

    const estado = await pollWhatsAppStatusAction(numero.id as string);

    expect(estado).toMatchObject({
      status: "desconectado",
      error:
        "Este número já está conectado em outra conta do Conduzza. Fale com o suporte.",
    });
    expect(
      chamadas.some((chamada) => chamada.caminho === "/instance/disconnect"),
    ).toBe(true);
    expect(numero.connection_status).toBe("desconectado");
    expect(numero.display_phone).toBeNull();
    // Nada da outra clinica no log desta.
    const evento = logs().find(
      (linha) => linha.evento === "whatsapp_celular_em_outro_numero",
    );
    expect(evento).toMatchObject({
      clinic_id: CLINICA_A,
      status: "outra_clinica",
    });
    expect(JSON.stringify(evento)).not.toContain(CLINICA_B);
    expect(JSON.stringify(evento)).not.toContain("99990000");
  });

  it("o mesmo celular em outro número da clínica diz qual é", async () => {
    usarUazapi();
    banco.uniqueTemporario = false;
    banco.numero({
      clinic_id: CLINICA_A,
      nome: "Recepção",
      principal: false,
      provider: "uazapi",
      connection_status: "conectado",
      display_phone: "5584999990000",
    });
    const numero = numeroEmPareamento();
    servidorUazapi({
      "GET /instance/status": () => conectadoCom("558499990000"),
    });

    const estado = await pollWhatsAppStatusAction(numero.id as string);

    expect(estado).toMatchObject({
      status: "desconectado",
      error: "Este número já está conectado como Recepção.",
    });
  });

  it("número removido ou desconectado com o mesmo celular não bloqueia", async () => {
    usarUazapi();
    banco.numero({
      clinic_id: CLINICA_B,
      provider: "uazapi",
      connection_status: "conectado",
      display_phone: "5584999990000",
      removido_em: "2026-09-20T12:00:00Z",
    });
    banco.numero({
      clinic_id: "0c0c0c0c-0000-4000-8000-00000000000c",
      provider: "uazapi",
      connection_status: "desconectado",
      display_phone: "5584999990000",
    });
    const numero = numeroEmPareamento();
    servidorUazapi({
      "GET /instance/status": () => conectadoCom("5584999990000"),
    });

    const estado = await pollWhatsAppStatusAction(numero.id as string);

    expect(estado.status).toBe("conectado");
    expect(estado.error).toBeUndefined();
    expect(numero.display_phone).toBe("5584999990000");
  });

  it("número que já estava conectado com o mesmo celular não é derrubado pela verificação", async () => {
    usarUazapi();
    sessao.active.role = "recepcao";
    banco.numero({
      clinic_id: CLINICA_B,
      provider: "uazapi",
      connection_status: "conectado",
      display_phone: "5584999990000",
    });
    const numero = banco.numero({
      clinic_id: CLINICA_A,
      provider: "uazapi",
      connection_status: "conectado",
      display_phone: "5584999990000",
    });
    banco.segredo({
      clinic_id: CLINICA_A,
      account_id: numero.id as string,
      instance_token: "tok-a",
    });
    const chamadas = servidorUazapi({
      "GET /instance/status": () => conectadoCom("5584999990000"),
    });

    const checagem = await checarConexaoAction();

    expect(checagem.numeros).toEqual([
      expect.objectContaining({
        id: numero.id,
        connection_status: "conectado",
      }),
    ]);
    expect(
      chamadas.some((chamada) => chamada.caminho === "/instance/disconnect"),
    ).toBe(false);
  });

  it("o simulador não passa pela trava (o celular dele é fictício)", async () => {
    banco.numero({
      clinic_id: CLINICA_B,
      connection_status: "conectado",
      display_phone: "+55 84 98888-0001",
    });

    const estado = await connectWhatsAppAction(null);

    expect(estado.status).toBe("conectado");
    expect(estado.error).toBeUndefined();
  });
});

describe("checar conexão: todos os números ativos", () => {
  it("confere cada número e devolve a lista, com o status do principal em status", async () => {
    usarUazapi();
    banco.uniqueTemporario = false;
    sessao.active.role = "recepcao";
    const principal = banco.numero({
      clinic_id: CLINICA_A,
      provider: "uazapi",
      connection_status: "conectado",
      display_phone: "5584911110000",
    });
    const recepcao = banco.numero({
      clinic_id: CLINICA_A,
      nome: "Recepção",
      principal: false,
      provider: "uazapi",
      connection_status: "conectado",
      display_phone: "5584922220000",
    });
    banco.numero({
      clinic_id: CLINICA_A,
      nome: "Antigo",
      principal: false,
      removido_em: "2026-09-20T12:00:00Z",
    });
    banco.segredo({
      clinic_id: CLINICA_A,
      account_id: principal.id as string,
      instance_token: "tok-principal",
    });
    banco.segredo({
      clinic_id: CLINICA_A,
      account_id: recepcao.id as string,
      instance_token: "tok-recepcao",
    });
    servidorUazapi({
      "GET /instance/status": (chamada) =>
        chamada.token === "tok-principal"
          ? conectadoCom("5584911110000")
          : { status: 401, body: { error: "invalid token" } },
    });

    const checagem = await checarConexaoAction();

    expect(checagem.status).toBe("conectado");
    expect(checagem.numeros).toHaveLength(2);
    expect(checagem.numeros).toEqual(
      expect.arrayContaining([
        {
          id: principal.id,
          nome: "Número principal",
          principal: true,
          connection_status: "conectado",
        },
        {
          id: recepcao.id,
          nome: "Recepção",
          principal: false,
          connection_status: "desconectado",
        },
      ]),
    );
    expect(recepcao.connection_status).toBe("desconectado");
    expect(principal.connection_status).toBe("conectado");
  });

  it("clínica sem número: nada a conferir e nenhum número criado", async () => {
    const checagem = await checarConexaoAction();

    expect(checagem).toEqual({ status: null, numeros: [] });
    expect(numeros()).toHaveLength(0);
  });
});

describe("adicionar número", () => {
  it("banco anterior ao contrato (unique temporário): o segundo número recebe a mensagem clara", async () => {
    // O contrato da Fase 3 tirou o unique; aqui ele e ligado a mao para
    // cobrir o ramo de mensagem que o codigo ainda tem.
    banco.uniqueTemporario = true;
    banco.numero({ clinic_id: CLINICA_A });

    const resultado = await adicionarNumeroAction({ nome: "Recepção" });

    expect(resultado).toEqual({
      ok: false,
      error: "Por enquanto, esta clínica tem um número só.",
    });
  });

  it("nome repetido entre os ativos, sem diferenciar maiúscula", async () => {
    banco.uniqueTemporario = false;
    banco.numero({ clinic_id: CLINICA_A, nome: "Recepção" });

    const resultado = await adicionarNumeroAction({ nome: "recepção" });

    expect(resultado.error).toBe(
      "Já existe um número com este nome nesta clínica. Escolha outro nome.",
    );
  });

  it("limite do plano atingido", async () => {
    banco.uniqueTemporario = false;
    banco.limites.set(CLINICA_A, 1);
    banco.numero({ clinic_id: CLINICA_A });

    const resultado = await adicionarNumeroAction({ nome: "Recepção" });

    expect(resultado.error).toBe(
      "Esta clínica atingiu o limite de números do plano.",
    );
  });

  it("gestor adiciona: nome sem espaços nas pontas, segredo do número e trilha", async () => {
    banco.uniqueTemporario = false;
    sessao.active.role = "gestor";
    banco.numero({ clinic_id: CLINICA_A });

    const resultado = await adicionarNumeroAction({
      nome: "  Recepção  ",
      unitId: null,
    });

    expect(resultado.ok).toBe(true);
    const novo = numeros().find((numero) => numero.id === resultado.accountId);
    expect(novo).toMatchObject({
      nome: "Recepção",
      principal: false,
      provider: "fake",
      unit_id: null,
    });
    expect(banco.linhas("whatsapp_account_secret")).toEqual([
      expect.objectContaining({
        clinic_id: CLINICA_A,
        account_id: resultado.accountId,
      }),
    ]);
    expect(banco.linhas("audit_log")).toEqual([
      {
        clinic_id: CLINICA_A,
        user_id: "usuario-da-sessao",
        action: "adicionou_numero_whatsapp",
        entity: "whatsapp_account",
        entity_id: resultado.accountId,
      },
    ]);
  });

  it("recusa nome vazio ou com mais de 40 caracteres", async () => {
    for (const nome of ["   ", "x".repeat(41)]) {
      const resultado = await adicionarNumeroAction({ nome });
      expect(resultado.ok).toBe(false);
    }
    expect(numeros()).toHaveLength(0);
  });

  it("recepção não adiciona", async () => {
    sessao.active.role = "recepcao";

    const resultado = await adicionarNumeroAction({ nome: "Recepção" });

    expect(resultado.ok).toBe(false);
    expect(numeros()).toHaveLength(0);
  });

  it("produção sem provedor real configurado não cria número", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("WHATSAPP_PROVIDER", "");

    const resultado = await adicionarNumeroAction({ nome: "Recepção" });

    expect(resultado.error).toBe(
      "Canal de WhatsApp não configurado no servidor. Fale com o suporte.",
    );
  });
});

describe("renomear e unidade", () => {
  it("renomeia pelo id da clínica e mantém a unidade quando ela não vem", async () => {
    const numero = banco.numero({
      clinic_id: CLINICA_A,
      unit_id: "unidade-centro",
    });

    const resultado = await atualizarNumeroAction({
      accountId: numero.id,
      nome: "Centro",
    });

    expect(resultado.ok).toBe(true);
    expect(numero).toMatchObject({ nome: "Centro", unit_id: "unidade-centro" });
  });

  it("unidade nula tira a unidade", async () => {
    const numero = banco.numero({
      clinic_id: CLINICA_A,
      unit_id: "unidade-centro",
    });

    await atualizarNumeroAction({
      accountId: numero.id,
      nome: "Centro",
      unitId: null,
    });

    expect(numero.unit_id).toBeNull();
  });

  it("trocar só a unidade não regrava o nome renomeado em outra aba", async () => {
    const UNIDADE_NOVA = "0c0c0c0c-0000-4000-8000-00000000000c";
    const numero = banco.numero({
      clinic_id: CLINICA_A,
      nome: "Recepção Centro",
      unit_id: null,
    });

    const resultado = await atualizarNumeroAction({
      accountId: numero.id,
      unitId: UNIDADE_NOVA,
    });

    expect(resultado.ok).toBe(true);
    expect(numero).toMatchObject({
      nome: "Recepção Centro",
      unit_id: UNIDADE_NOVA,
    });
  });

  it("sem nome e sem unidade não grava nada", async () => {
    const numero = banco.numero({ clinic_id: CLINICA_A, nome: "Recepção" });

    const resultado = await atualizarNumeroAction({ accountId: numero.id });

    expect(resultado.ok).toBe(false);
    expect(numero.nome).toBe("Recepção");
  });

  it("número de outra clínica não é alterado", async () => {
    const alheio = banco.numero({ clinic_id: CLINICA_B, nome: "Deles" });

    const resultado = await atualizarNumeroAction({
      accountId: alheio.id,
      nome: "Meu",
    });

    expect(resultado.error).toBe(
      "Este número não existe mais nesta clínica. Recarregue a página.",
    );
    expect(alheio.nome).toBe("Deles");
  });
});

describe("tornar principal", () => {
  it("chama a RPC com a clínica da sessão e o número", async () => {
    const numero = banco.numero({ clinic_id: CLINICA_A });
    sessao.active.role = "gestor";

    const resultado = await definirNumeroPrincipalAction(numero.id);

    expect(resultado.ok).toBe(true);
    expect(banco.rpc).toHaveBeenCalledWith("definir_numero_principal", {
      p_clinic_id: CLINICA_A,
      p_account_id: numero.id,
    });
    expect(banco.linhas("audit_log")[0]).toMatchObject({
      action: "definiu_numero_principal",
      entity_id: numero.id,
    });
  });

  it("número que a RPC não acha na clínica vira mensagem clara", async () => {
    banco.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "Número não encontrado nesta clínica." },
    });

    const resultado = await definirNumeroPrincipalAction(
      "0d0d0d0d-0000-4000-8000-00000000000d",
    );

    expect(resultado.error).toBe(
      "Este número não existe mais nesta clínica. Recarregue a página.",
    );
  });

  it("recepção não troca o principal", async () => {
    sessao.active.role = "recepcao";

    const resultado = await definirNumeroPrincipalAction(
      "0d0d0d0d-0000-4000-8000-00000000000d",
    );

    expect(resultado.ok).toBe(false);
    expect(banco.rpc).not.toHaveBeenCalled();
  });
});

describe("remover número (só administrador, D8)", () => {
  it("gestor não remove", async () => {
    sessao.active.role = "gestor";
    const numero = banco.numero({ clinic_id: CLINICA_A });

    const resultado = await removerNumeroAction(numero.id);

    expect(resultado.error).toBe(
      "Somente administradores removem um número de WhatsApp.",
    );
    expect(banco.rpc).not.toHaveBeenCalled();
  });

  it("recusa o principal enquanto houver outro número ativo, sem tocar na instância", async () => {
    usarUazapi();
    banco.uniqueTemporario = false;
    const principal = banco.numero({
      clinic_id: CLINICA_A,
      provider: "uazapi",
    });
    banco.numero({ clinic_id: CLINICA_A, nome: "Recepção", principal: false });
    const chamadas = servidorUazapi();

    const resultado = await removerNumeroAction(principal.id);

    expect(resultado.error).toBe(
      "Escolha outro número como principal antes de remover este.",
    );
    expect(banco.rpc).not.toHaveBeenCalled();
    expect(chamadas).toHaveLength(0);
  });

  it("recusa o número fixo das mensagens automáticas", async () => {
    const numero = banco.numero({ clinic_id: CLINICA_A });
    banco.linhas("whatsapp_envio_automatico").push({
      clinic_id: CLINICA_A,
      modo: "fixo",
      conta_fixa_id: numero.id,
    });

    const resultado = await removerNumeroAction(numero.id);

    expect(resultado.error).toBe(
      "As mensagens automáticas saem sempre por este número. Em Automações, escolha outro número antes de remover este.",
    );
    expect(banco.rpc).not.toHaveBeenCalled();
  });

  it("remove: RPC com quem removeu, depois desconecta e apaga a instância com o token de antes", async () => {
    usarUazapi();
    const numero = banco.numero({
      clinic_id: CLINICA_A,
      provider: "uazapi",
      instance_id: "conduzza_clinica_a",
      connection_status: "conectado",
    });
    const segredo = banco.segredo({
      clinic_id: CLINICA_A,
      account_id: numero.id as string,
      instance_token: "tok-a",
    });
    // Como a RPC de verdade: apaga o token e marca removido.
    banco.rpc.mockImplementation(async () => {
      segredo.instance_token = null;
      numero.removido_em = "2026-09-25T12:00:00Z";
      return { data: { ok: true }, error: null };
    });
    const chamadas = servidorUazapi();

    const resultado = await removerNumeroAction(numero.id);

    expect(resultado).toEqual({ ok: true, accountId: numero.id });
    expect(banco.rpc).toHaveBeenCalledWith("remover_numero", {
      p_clinic_id: CLINICA_A,
      p_account_id: numero.id,
      p_removido_por: "usuario-da-sessao",
    });
    expect(
      chamadas.map((chamada) => [
        chamada.method,
        chamada.caminho,
        chamada.token,
      ]),
    ).toEqual([
      ["POST", "/instance/disconnect", "tok-a"],
      ["DELETE", "/instance", "tok-a"],
    ]);
    expect(banco.linhas("audit_log")[0]).toMatchObject({
      action: "removeu_numero_whatsapp",
      entity: "whatsapp_account",
      entity_id: numero.id,
      user_id: "usuario-da-sessao",
    });
  });

  it("instância que o servidor não apaga não trava a remoção e fica no log", async () => {
    usarUazapi();
    const numero = banco.numero({ clinic_id: CLINICA_A, provider: "uazapi" });
    banco.segredo({
      clinic_id: CLINICA_A,
      account_id: numero.id as string,
      instance_token: "tok-a",
    });
    banco.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    servidorUazapi({ "DELETE /instance": () => ({ status: 403 }) });

    const resultado = await removerNumeroAction(numero.id);

    expect(resultado.ok).toBe(true);
    expect(
      logs().find(
        (linha) => linha.evento === "whatsapp_instancia_nao_excluida",
      ),
    ).toMatchObject({
      clinic_id: CLINICA_A,
      error_code: "uazapi_403",
    });
  });

  it("recusa da RPC (principal com outros ativos) vira a mesma mensagem", async () => {
    const numero = banco.numero({ clinic_id: CLINICA_A });
    banco.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "55000",
        message: "Escolha outro número como principal antes de remover este.",
      },
    });

    const resultado = await removerNumeroAction(numero.id);

    expect(resultado.error).toBe(
      "Escolha outro número como principal antes de remover este.",
    );
    expect(banco.linhas("audit_log")).toHaveLength(0);
  });

  it("número já removido: nada a fazer", async () => {
    const numero = banco.numero({
      clinic_id: CLINICA_A,
      principal: false,
      removido_em: "2026-09-25T12:00:00Z",
    });

    const resultado = await removerNumeroAction(numero.id);

    expect(resultado).toEqual({ ok: true, accountId: numero.id });
    expect(banco.rpc).not.toHaveBeenCalled();
  });
});
