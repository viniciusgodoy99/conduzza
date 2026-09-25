import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { BancoFalso, type Linha } from "./banco-falso";

// O motivo da recusa do celular FORA do dialogo de conexao (continuacao do
// achado M[0] da revisao das Fases 3 e 4). Antes so a consulta do pareamento
// o mostrava, e quem recarregava a pagina depois da recusa via so
// "Desconectado". Prova, contra um banco em memoria e um uazapi falso:
//   - Configuracoes > WhatsApp: o cartao do numero recusado ja chega com o
//     motivo, lido por service role com a clinica da sessao;
//   - o cartao do onboarding (/whatsapp) abre com o motivo no aviso;
//   - "Verificar conexao" da faixa devolve o motivo por numero;
//   - so administrador e gestor recebem o texto: para os outros papeis a
//     trilha nem e lida;
//   - nada da outra clinica: um id de la, pedido com a clinica da sessao,
//     nao devolve motivo;
//   - o cartao mostra o motivo so desconectado, com o chip nas 3 camadas.

const CLINICA_A = "0a0a0a0a-0000-4000-8000-00000000000a";
const CLINICA_B = "0b0b0b0b-0000-4000-8000-00000000000b";
const TEXTO_OUTRA_CONTA =
  "Este número já está conectado em outra conta do Conduzza. Fale com o suporte.";

const banco = new BancoFalso();
const sessao = {
  userId: "usuario-da-sessao",
  userName: "Pessoa da sessão",
  active: {
    clinicId: CLINICA_A,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "admin" as string,
    status: "ativo",
  },
};

/** Tabelas lidas por cada cliente ("admin:audit_log", "sessao:clinic"...). */
const leituras: string[] = [];
function clienteRegistrado(quem: "admin" | "sessao") {
  const base = banco.cliente();
  return {
    ...base,
    from: (tabela: string) => {
      leituras.push(`${quem}:${tabela}`);
      return base.from(tabela);
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => clienteRegistrado("admin"),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => clienteRegistrado("sessao"),
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

const { checarConexaoAction, pollWhatsAppStatusAction } =
  await import("@/lib/actions/whatsapp-connect");
const { motivosDaRecusaVigentes, TEXTO_CELULAR_EM_OUTRO_NUMERO } =
  await import("@/lib/integrations/whatsapp/trava-celular");
const { default: ConfiguracoesPage } =
  await import("@/app/(app)/configuracoes/page");
const { default: WhatsAppOnboardingPage } =
  await import("@/app/(onboarding)/whatsapp/page");
const { CartaoDoNumero } =
  await import("@/components/whatsapp/cartao-do-numero");
const { motivoParaMostrar } = await import("@/components/whatsapp/numeros");

type NumeroDoWhatsapp =
  import("@/components/whatsapp/numeros").NumeroDoWhatsapp;
type ConnectState = import("@/lib/actions/whatsapp-connect").ConnectState;

// Pelo codigo, para o caractere nao aparecer escrito no fonte.
const TRAVESSAO = String.fromCharCode(0x2014);

type Chamada = { caminho: string; method: string; token: string | null };
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
}

/**
 * GET /instance/status do numero da clinica A (token "tok-a"): conectado com
 * `owner` ate o provedor receber o desligamento, desconectado depois.
 */
function instanciaQueDesliga(owner: string): void {
  let desligada = false;
  servidorUazapi({
    "GET /instance/status": (chamada) => {
      if (chamada.token !== "tok-a") {
        return { status: 404 };
      }
      return desligada
        ? { status: 200, body: { instance: { status: "disconnected" } } }
        : {
            status: 200,
            body: {
              instance: {
                status: "connected",
                owner: `${owner}@s.whatsapp.net`,
              },
            },
          };
    },
    "POST /instance/disconnect": () => {
      desligada = true;
      return { status: 200 };
    },
  });
}

/** Numero de uma clinica, com instancia e segredo proprios. */
function numeroComInstancia(
  clinicId: string,
  token: string,
  dados: Linha = {},
): Linha {
  const numero = banco.numero({
    clinic_id: clinicId,
    provider: "uazapi",
    connection_status: "aguardando_qr",
    ...dados,
  });
  banco.segredo({
    clinic_id: clinicId,
    account_id: numero.id as string,
    instance_token: token,
  });
  return numero;
}

/**
 * A recusa acontece no dialogo (a consulta do pareamento acha o mesmo
 * celular conectado em outro numero) e a pessoa recarrega a pagina depois.
 * Roda como administrador; quem chama troca o papel em seguida.
 */
async function recusarNoDialogo(numero: Linha): Promise<ConnectState> {
  const papel = sessao.active.role;
  sessao.active.role = "admin";
  const estado = await pollWhatsAppStatusAction(numero.id as string);
  sessao.active.role = papel;
  return estado;
}

/** Acha, na arvore devolvida pela pagina, os props que tem `chave`. */
function propsCom<T>(no: unknown, chave: string): T | null {
  if (!no || typeof no !== "object") {
    return null;
  }
  const props = (no as { props?: Record<string, unknown> }).props;
  if (!props) {
    return null;
  }
  if (chave in props) {
    return props as T;
  }
  const filhos = props.children;
  for (const filho of Array.isArray(filhos) ? filhos : [filhos]) {
    const achado = propsCom<T>(filho, chave);
    if (achado) {
      return achado;
    }
  }
  return null;
}

async function numerosDeConfiguracoes(): Promise<NumeroDoWhatsapp[]> {
  const pagina = await ConfiguracoesPage({ searchParams: Promise.resolve({}) });
  const props = propsCom<{
    whatsapp: { numeros: NumeroDoWhatsapp[] } | null;
  }>(pagina, "whatsapp");
  if (!props?.whatsapp) {
    throw new Error("a aba de WhatsApp nao chegou ao cliente");
  }
  return props.whatsapp.numeros;
}

async function estadoInicialDoOnboarding(): Promise<ConnectState> {
  const pagina = await WhatsAppOnboardingPage();
  const props = propsCom<{ initial: ConnectState }>(pagina, "initial");
  if (!props) {
    throw new Error("o cartao de conexao nao chegou ao cliente");
  }
  return props.initial;
}

function leuATrilhaPorServiceRole(): boolean {
  return leituras.includes("admin:audit_log");
}

beforeEach(() => {
  banco.limpar();
  sessao.active.role = "admin";
  sessao.active.clinicId = CLINICA_A;
  leituras.length = 0;
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("WHATSAPP_PROVIDER", "");
  vi.stubEnv("PUBLIC_APP_URL", "https://app.exemplo.test");
  // Os eventos de log da trava nao poluem a saida do teste.
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Configurações > WhatsApp: o cartão chega com o motivo", () => {
  it("celular de outra clínica: depois de recarregar, o número recusado mostra o motivo e os outros não", async () => {
    usarUazapi();
    numeroComInstancia(CLINICA_B, "tok-b", {
      connection_status: "conectado",
      display_phone: "558499990000",
    });
    const principal = banco.numero({
      clinic_id: CLINICA_A,
      connection_status: "conectado",
    });
    const recepcao = numeroComInstancia(CLINICA_A, "tok-a", {
      nome: "Recepção",
      principal: false,
    });
    instanciaQueDesliga("5584999990000");
    expect((await recusarNoDialogo(recepcao)).error).toBe(TEXTO_OUTRA_CONTA);

    const numeros = await numerosDeConfiguracoes();

    expect(numeros.map((numero) => numero.id)).toEqual([
      principal.id,
      recepcao.id,
    ]);
    expect(numeros.find((n) => n.id === recepcao.id)).toMatchObject({
      status: "desconectado",
      motivoDaDesconexao: TEXTO_OUTRA_CONTA,
    });
    expect(
      numeros.find((n) => n.id === principal.id)?.motivoDaDesconexao,
    ).toBeNull();
    expect(leuATrilhaPorServiceRole()).toBe(true);
  });

  it("gestor também vê, e na mesma clínica o motivo diz o nome do outro número", async () => {
    usarUazapi();
    banco.numero({
      clinic_id: CLINICA_A,
      nome: "Recepção 1",
      provider: "uazapi",
      connection_status: "conectado",
      display_phone: "558499990000",
    });
    const segundo = numeroComInstancia(CLINICA_A, "tok-a", {
      nome: "Recepção 2",
      principal: false,
    });
    instanciaQueDesliga("5584999990000");
    await recusarNoDialogo(segundo);
    sessao.active.role = "gestor";

    const numeros = await numerosDeConfiguracoes();

    expect(numeros.find((n) => n.id === segundo.id)?.motivoDaDesconexao).toBe(
      "Este número já está conectado como Recepção 1.",
    );
  });

  it("papel que não gerencia o número: nenhum motivo e a trilha nem é lida", async () => {
    usarUazapi();
    numeroComInstancia(CLINICA_B, "tok-b", {
      connection_status: "conectado",
      display_phone: "558499990000",
    });
    const numero = numeroComInstancia(CLINICA_A, "tok-a");
    instanciaQueDesliga("5584999990000");
    await recusarNoDialogo(numero);
    // O layout de Configuracoes ja barra os outros papeis; a pagina confere
    // de novo antes de ler o motivo.
    sessao.active.role = "recepcao";
    leituras.length = 0;

    const numeros = await numerosDeConfiguracoes();

    expect(numeros[0]?.motivoDaDesconexao).toBeNull();
    expect(leuATrilhaPorServiceRole()).toBe(false);
  });

  it("desconexão comum, sem recusa: o cartão não inventa motivo", async () => {
    banco.numero({
      clinic_id: CLINICA_A,
      connection_status: "desconectado",
      disconnected_at: "2026-09-25T12:00:00.000Z",
    });

    const [numero] = await numerosDeConfiguracoes();

    expect(numero?.status).toBe("desconectado");
    expect(numero?.motivoDaDesconexao).toBeNull();
  });
});

describe("onboarding (/whatsapp): o cartão abre com o motivo", () => {
  it("principal recusado: o aviso do cartão já diz por quê", async () => {
    usarUazapi();
    numeroComInstancia(CLINICA_B, "tok-b", {
      connection_status: "conectado",
      display_phone: "558499990000",
    });
    const principal = numeroComInstancia(CLINICA_A, "tok-a");
    instanciaQueDesliga("5584999990000");
    await recusarNoDialogo(principal);
    leituras.length = 0;

    const inicial = await estadoInicialDoOnboarding();

    expect(inicial).toMatchObject({
      status: "desconectado",
      error: TEXTO_OUTRA_CONTA,
    });
    expect(leuATrilhaPorServiceRole()).toBe(true);
  });

  it("quem não conecta o WhatsApp não recebe o motivo, e a trilha nem é lida", async () => {
    usarUazapi();
    numeroComInstancia(CLINICA_B, "tok-b", {
      connection_status: "conectado",
      display_phone: "558499990000",
    });
    const principal = numeroComInstancia(CLINICA_A, "tok-a");
    instanciaQueDesliga("5584999990000");
    await recusarNoDialogo(principal);
    sessao.active.role = "leitura";
    leituras.length = 0;

    const inicial = await estadoInicialDoOnboarding();

    expect(inicial.status).toBe("desconectado");
    expect(inicial.error).toBeUndefined();
    expect(leuATrilhaPorServiceRole()).toBe(false);
  });

  it("número conectado ou desconexão comum: sem motivo e sem leitura da trilha", async () => {
    banco.numero({ clinic_id: CLINICA_A, connection_status: "conectado" });

    expect((await estadoInicialDoOnboarding()).error).toBeUndefined();
    expect(leuATrilhaPorServiceRole()).toBe(false);
  });
});

describe("Verificar conexão da faixa: o motivo vem por número", () => {
  it("a própria verificação recusa o celular e já devolve o motivo", async () => {
    usarUazapi();
    numeroComInstancia(CLINICA_B, "tok-b", {
      connection_status: "conectado",
      display_phone: "558499990000",
    });
    const numero = numeroComInstancia(CLINICA_A, "tok-a");
    instanciaQueDesliga("5584999990000");

    const checagem = await checarConexaoAction();

    expect(checagem.numeros).toEqual([
      {
        id: numero.id,
        nome: "Número principal",
        principal: true,
        connection_status: "desconectado",
        motivo: TEXTO_OUTRA_CONTA,
      },
    ]);
  });

  it("recusa anterior continua explicando a queda para o gestor", async () => {
    usarUazapi();
    numeroComInstancia(CLINICA_B, "tok-b", {
      connection_status: "conectado",
      display_phone: "558499990000",
    });
    const numero = numeroComInstancia(CLINICA_A, "tok-a");
    instanciaQueDesliga("5584999990000");
    await recusarNoDialogo(numero);
    sessao.active.role = "gestor";

    const checagem = await checarConexaoAction();

    expect(checagem.numeros[0]).toMatchObject({
      id: numero.id,
      connection_status: "desconectado",
      motivo: TEXTO_OUTRA_CONTA,
    });
  });

  it("recepção verifica a conexão, mas o motivo não vem e a trilha nem é lida", async () => {
    usarUazapi();
    numeroComInstancia(CLINICA_B, "tok-b", {
      connection_status: "conectado",
      display_phone: "558499990000",
    });
    const numero = numeroComInstancia(CLINICA_A, "tok-a");
    instanciaQueDesliga("5584999990000");
    await recusarNoDialogo(numero);
    sessao.active.role = "recepcao";
    leituras.length = 0;

    const checagem = await checarConexaoAction();

    expect(checagem.numeros).toEqual([
      {
        id: numero.id,
        nome: "Número principal",
        principal: true,
        connection_status: "desconectado",
      },
    ]);
    expect("motivo" in checagem.numeros[0]!).toBe(false);
    expect(leuATrilhaPorServiceRole()).toBe(false);
  });
});

describe("motivosDaRecusaVigentes: sempre pela clínica de quem chama", () => {
  it("o id de um número recusado da outra clínica, pedido com a clínica da sessão, não devolve nada", async () => {
    usarUazapi();
    numeroComInstancia(CLINICA_A, "tok-b", {
      connection_status: "conectado",
      display_phone: "558499990000",
    });
    // A recusa acontece NA clinica B (o mesmo celular ja estava na A).
    sessao.active.clinicId = CLINICA_B;
    const daOutra = numeroComInstancia(CLINICA_B, "tok-a");
    instanciaQueDesliga("5584999990000");
    expect((await recusarNoDialogo(daOutra)).error).toBe(TEXTO_OUTRA_CONTA);

    const admin = clienteRegistrado("admin") as never;
    expect(
      await motivosDaRecusaVigentes(admin, CLINICA_B, [daOutra.id as string]),
    ).toEqual({ [daOutra.id as string]: TEXTO_OUTRA_CONTA });
    expect(
      await motivosDaRecusaVigentes(admin, CLINICA_A, [daOutra.id as string]),
    ).toEqual({});
  });

  it("só entra quem tem motivo; leitura que lança tira só o motivo daquele número", async () => {
    usarUazapi();
    const outro = banco.numero({
      clinic_id: CLINICA_A,
      nome: "Recepção 1",
      provider: "uazapi",
      connection_status: "conectado",
      display_phone: "558499990000",
    });
    const recusado = numeroComInstancia(CLINICA_A, "tok-a", {
      nome: "Recepção 2",
      principal: false,
    });
    const comum = banco.numero({
      clinic_id: CLINICA_A,
      nome: "Centro",
      principal: false,
      connection_status: "desconectado",
      disconnected_at: "2026-09-25T12:00:00.000Z",
    });
    instanciaQueDesliga("5584999990000");
    await recusarNoDialogo(recusado);
    // O outro numero saiu da clinica depois da recusa: o texto fica sem nome.
    outro.removido_em = "2026-09-25T13:00:00.000Z";

    // A consulta do numero "Centro" lanca (rede que caiu no meio); a do
    // recusado segue normal.
    const base = clienteRegistrado("admin");
    let quebras = 0;
    const quebraNoCentro = {
      ...base,
      from: (tabela: string) =>
        new Proxy(base.from(tabela), {
          get(alvo, propriedade, proxy) {
            const valor: unknown = Reflect.get(alvo, propriedade, alvo);
            if (typeof valor !== "function") {
              return valor;
            }
            return (...args: unknown[]) => {
              if (
                propriedade === "eq" &&
                args[0] === "id" &&
                args[1] === comum.id
              ) {
                quebras += 1;
                throw new Error("rede caiu");
              }
              const resultado: unknown = Reflect.apply(valor, alvo, args);
              return resultado === alvo ? proxy : resultado;
            };
          },
        }),
    };

    expect(
      await motivosDaRecusaVigentes(quebraNoCentro as never, CLINICA_A, [
        recusado.id as string,
        comum.id as string,
      ]),
    ).toEqual({ [recusado.id as string]: TEXTO_CELULAR_EM_OUTRO_NUMERO });
    expect(quebras).toBe(1);
    // Lista vazia: nenhuma leitura.
    leituras.length = 0;
    expect(await motivosDaRecusaVigentes(base as never, CLINICA_A, [])).toEqual(
      {},
    );
    expect(leituras).toEqual([]);
  });
});

describe("cartão do número: o motivo embaixo do chip", () => {
  const semAcao = () => undefined;

  function numero(campos: Partial<NumeroDoWhatsapp> = {}): NumeroDoWhatsapp {
    return {
      id: "22222222-2222-4222-8222-222222222222",
      nome: "Recepção",
      principal: false,
      unitId: null,
      displayPhone: null,
      status: "desconectado",
      connectedAt: null,
      provider: "uazapi",
      motivoDaDesconexao: TEXTO_OUTRA_CONTA,
      ...campos,
    };
  }

  function cartao(campos: Partial<NumeroDoWhatsapp> = {}): string {
    return renderToStaticMarkup(
      <TooltipProvider>
        <CartaoDoNumero
          numero={numero(campos)}
          unidade={null}
          fixoDasAutomaticas={false}
          timezone="America/Fortaleza"
          podeGerenciar
          dica="Seu perfil não altera as configurações"
          motivoParaNaoRemover={null}
          motivoParaNaoEscolherUnidade={null}
          ocupado={false}
          aoConectar={semAcao}
          aoDesconectar={semAcao}
          aoRenomear={semAcao}
          aoEscolherUnidade={semAcao}
          aoTornarPrincipal={semAcao}
          aoRemover={semAcao}
        />
      </TooltipProvider>,
    );
  }

  it("desconectado com motivo: o chip continua nas 3 camadas e o motivo vem num aviso", () => {
    const html = cartao();

    // Chip: icone (svg), rotulo e cor da familia de alerta.
    expect(html).toMatch(
      /<span data-size="md"[^>]*style="color:var\(--alert-text\)[^"]*"><svg[^>]*lucide-wifi-off[^>]*>[\s\S]*?<\/svg><span>Desconectado<\/span><\/span>/,
    );
    expect(html).toMatch(
      new RegExp(
        `<div role="status" data-tom="alert"[\\s\\S]*?${TEXTO_OUTRA_CONTA}`,
      ),
    );
    expect(html).not.toContain(TRAVESSAO);
  });

  it("sem motivo, ou com a situação já em outra, não aparece aviso nenhum", () => {
    expect(cartao({ motivoDaDesconexao: null })).not.toContain(
      'data-tom="alert"',
    );
    expect(cartao({ motivoDaDesconexao: undefined })).not.toContain(
      'data-tom="alert"',
    );
    const conectado = cartao({
      status: "conectado",
      connectedAt: "2026-09-25T12:00:00.000Z",
    });
    expect(conectado).not.toContain(TEXTO_OUTRA_CONTA);
    expect(cartao({ status: "aguardando_qr" })).not.toContain(
      TEXTO_OUTRA_CONTA,
    );
  });

  it("motivoParaMostrar: só com o número desconectado", () => {
    expect(
      motivoParaMostrar({
        status: "desconectado",
        motivoDaDesconexao: TEXTO_OUTRA_CONTA,
      }),
    ).toBe(TEXTO_OUTRA_CONTA);
    expect(
      motivoParaMostrar({
        status: "conectando",
        motivoDaDesconexao: TEXTO_OUTRA_CONTA,
      }),
    ).toBeNull();
    expect(motivoParaMostrar({ status: "desconectado" })).toBeNull();
  });
});
