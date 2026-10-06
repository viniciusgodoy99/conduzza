import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O compositor importa as Server Actions do Atendimento (enviar arquivo) e as
// acoes do cabecalho; aqui so a renderizacao importa.
vi.mock("@/app/(app)/atendimento/actions", () => ({
  enviarArquivoAction: vi.fn(),
  assumirConversaAction: vi.fn(),
  reabrirConversaAction: vi.fn(),
  resolverConversaAction: vi.fn(),
  transferirConversaAction: vi.fn(),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Composer } from "@/components/atendimento/composer";
import { ConversationCard } from "@/components/atendimento/conversation-card";
import {
  FaixaDoNumero,
  SeloDoNumero,
} from "@/components/atendimento/selo-do-numero";
import { TooltipProvider } from "@/components/ui/tooltip";
import { estadoVisualDaConversa } from "@/lib/design/status";
import {
  CORES_DO_NUMERO,
  corDoNumero,
  primeiraCorLivre,
} from "@/lib/domain/cor-do-numero";
import {
  aplicarLinhaAosNumeros,
  casaNumero,
  numeroParaMostrar,
  opcoesDoFiltroDeNumero,
  telefoneDoNumero,
  travaDoNumero,
  variosNumeros,
  type NumerosDoInbox,
} from "@/lib/domain/numeros-do-inbox";
import {
  fetchMessagesPage,
  type ConversationListItem,
  type NumeroDaClinica,
} from "@/lib/queries/conversations";

// Varios numeros no Atendimento (docs/07, Fase 4): selo no cartao, numero no
// cabecalho, filtro "Numero", compositor que diz por que a resposta nao sai,
// e o historico do fio preso ao numero da conversa (decisao 1 do dono).

const EU = "11111111-1111-4111-8111-111111111111";
const PRINCIPAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECEPCAO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CENTRO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function numero(campos: Partial<NumeroDaClinica> = {}): NumeroDaClinica {
  return {
    id: PRINCIPAL,
    nome: "Número principal",
    display_phone: "+55 84 90000-0001",
    connection_status: "conectado",
    principal: true,
    connected_at: "2026-09-20T12:00:00.000Z",
    cor: "azul",
    ...campos,
  };
}

const recepcao = numero({
  id: RECEPCAO,
  nome: "Recepção",
  display_phone: "558432558800",
  principal: false,
  cor: "rosa",
});

const DOIS: NumerosDoInbox = { ativos: [numero(), recepcao], removidos: [] };
const UM: NumerosDoInbox = { ativos: [numero()], removidos: [] };

function conversa(
  campos: Partial<ConversationListItem> = {},
): ConversationListItem {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    status: "em_atendimento",
    assignee_user_id: EU,
    unread_count: 0,
    awaiting_reply: false,
    last_message_at: "2026-09-24T14:30:00.000Z",
    last_inbound_at: "2026-09-24T12:10:00.000Z",
    last_preview: "Tem horário amanhã?",
    last_preview_kind: "texto",
    last_preview_author: "paciente",
    last_preview_author_user_id: null,
    tags: [],
    whatsapp_account_id: RECEPCAO,
    contact: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Maria Teste",
      phone_e164: "+5584999990000",
      kind: "paciente",
      funnel_stage: "novo",
      source_channel: null,
      source_campaign: null,
      first_contact_at: null,
    },
    ...campos,
  };
}

describe("quando o Inbox fala de numero", () => {
  it("com um numero ativo, nada muda: sem selo, sem trava", () => {
    const c = conversa({ whatsapp_account_id: PRINCIPAL });
    expect(variosNumeros(UM)).toBe(false);
    expect(numeroParaMostrar(c, UM)).toBeNull();
    expect(travaDoNumero(numeroParaMostrar(c, UM))).toBeNull();
  });

  it("com dois, mostra o numero da conversa", () => {
    expect(numeroParaMostrar(conversa(), DOIS)).toEqual({
      estado: "ativo",
      numero: recepcao,
    });
  });

  it("numero removido aparece sempre, mesmo com um ativo so", () => {
    const numeros: NumerosDoInbox = {
      ativos: [numero()],
      removidos: [{ id: CENTRO, nome: "Centro" }],
    };
    expect(
      numeroParaMostrar(conversa({ whatsapp_account_id: CENTRO }), numeros),
    ).toEqual({ estado: "removido", numero: { id: CENTRO, nome: "Centro" } });
  });

  it("conversa sem numero, ou com numero desconhecido, nao inventa nome", () => {
    expect(
      numeroParaMostrar(conversa({ whatsapp_account_id: null }), DOIS),
    ).toBeNull();
    expect(
      numeroParaMostrar(conversa({ whatsapp_account_id: CENTRO }), DOIS),
    ).toBeNull();
  });
});

describe("travaDoNumero", () => {
  it("conectado libera a resposta", () => {
    expect(travaDoNumero(numeroParaMostrar(conversa(), DOIS))).toBeNull();
  });

  it("qualquer status fora de conectado trava, com o nome", () => {
    for (const status of ["desconectado", "aguardando_qr", "conectando"]) {
      const numeros: NumerosDoInbox = {
        ativos: [numero(), { ...recepcao, connection_status: status }],
        removidos: [],
      };
      expect(travaDoNumero(numeroParaMostrar(conversa(), numeros))).toEqual({
        motivo: "desconectado",
        nome: "Recepção",
      });
    }
  });

  it("removido trava de vez", () => {
    expect(
      travaDoNumero({
        estado: "removido",
        numero: { id: CENTRO, nome: "Centro" },
      }),
    ).toEqual({ motivo: "removido", nome: "Centro" });
  });
});

describe("telefoneDoNumero", () => {
  it("formata o telefone pareado, com ou sem mascara e pais", () => {
    expect(telefoneDoNumero("+55 84 90000-0001")).toBe("(84) 90000-0001");
    expect(telefoneDoNumero("558432558800")).toBe("(84) 3255-8800");
    expect(telefoneDoNumero("1132558800")).toBe("(11) 3255-8800");
    // DDD 55 (RS) sem o pais: continua nacional.
    expect(telefoneDoNumero("5532221234")).toBe("(55) 3222-1234");
  });

  it("nome de perfil no lugar do telefone (achado N[2]) nao aparece", () => {
    expect(telefoneDoNumero("Clínica Sorriso")).toBeNull();
    expect(telefoneDoNumero("123")).toBeNull();
    expect(telefoneDoNumero(null)).toBeNull();
  });
});

describe("filtro Numero", () => {
  it("ativos na ordem da clinica, cada um contando o que filtra", () => {
    const lista = [
      conversa({ id: "1", whatsapp_account_id: RECEPCAO }),
      conversa({ id: "2", whatsapp_account_id: RECEPCAO }),
      conversa({ id: "3", whatsapp_account_id: PRINCIPAL }),
    ];
    expect(opcoesDoFiltroDeNumero(lista, DOIS)).toEqual([
      {
        id: PRINCIPAL,
        nome: "Número principal",
        removido: false,
        cor: "azul",
        total: 1,
      },
      {
        id: RECEPCAO,
        nome: "Recepção",
        removido: false,
        cor: "rosa",
        total: 2,
      },
    ]);
    expect(lista.filter((c) => casaNumero(c, RECEPCAO))).toHaveLength(2);
    expect(lista.filter((c) => casaNumero(c, null))).toHaveLength(3);
  });

  it("removido so vira chip quando ha conversa dele na lista", () => {
    const numeros: NumerosDoInbox = {
      ...DOIS,
      removidos: [
        { id: CENTRO, nome: "Centro" },
        { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", nome: "Velho" },
      ],
    };
    const opcoes = opcoesDoFiltroDeNumero(
      [conversa({ whatsapp_account_id: CENTRO })],
      numeros,
    );
    expect(opcoes.map((o) => o.nome)).toEqual([
      "Número principal",
      "Recepção",
      "Centro",
    ]);
    expect(opcoes[2]).toMatchObject({ removido: true, total: 1 });
  });
});

describe("aplicarLinhaAosNumeros (tempo real)", () => {
  it("UPDATE do slot de envio devolve o MESMO objeto (nada redesenha)", () => {
    const depois = aplicarLinhaAosNumeros(DOIS, {
      ...recepcao,
      removido_em: null,
    });
    expect(depois).toBe(DOIS);
  });

  it("aplica o status pela linha, sem mexer no outro numero", () => {
    const depois = aplicarLinhaAosNumeros(DOIS, {
      id: RECEPCAO,
      connection_status: "desconectado",
    });
    expect(depois).not.toBe(DOIS);
    expect(depois.ativos[1]?.connection_status).toBe("desconectado");
    expect(depois.ativos[0]).toBe(DOIS.ativos[0]);
  });

  it("removido sai dos ativos e passa a nomear as conversas antigas", () => {
    const depois = aplicarLinhaAosNumeros(DOIS, {
      id: RECEPCAO,
      nome: "Recepção",
      removido_em: "2026-09-25T10:00:00.000Z",
    });
    expect(depois.ativos.map((n) => n.id)).toEqual([PRINCIPAL]);
    expect(depois.removidos).toEqual([{ id: RECEPCAO, nome: "Recepção" }]);
    // O mesmo evento de novo nao duplica.
    expect(
      aplicarLinhaAosNumeros(depois, {
        id: RECEPCAO,
        removido_em: "2026-09-25T10:00:00.000Z",
      }),
    ).toBe(depois);
  });

  it("numero novo entra com o minimo do evento; sem ele, fica de fora", () => {
    const novo = aplicarLinhaAosNumeros(UM, {
      id: CENTRO,
      nome: "Centro",
      connection_status: "aguardando_qr",
      principal: false,
      display_phone: null,
      connected_at: null,
    });
    expect(novo.ativos.map((n) => n.nome)).toEqual([
      "Número principal",
      "Centro",
    ]);
    expect(aplicarLinhaAosNumeros(UM, { id: CENTRO })).toBe(UM);
  });

  it("troca de principal reordena: o principal vem primeiro", () => {
    const passo1 = aplicarLinhaAosNumeros(DOIS, {
      id: RECEPCAO,
      principal: true,
    });
    const passo2 = aplicarLinhaAosNumeros(passo1, {
      id: PRINCIPAL,
      principal: false,
    });
    expect(passo2.ativos.map((n) => n.id)).toEqual([RECEPCAO, PRINCIPAL]);
  });

  it("numero que volta de removido sai da lista dos removidos", () => {
    const numeros: NumerosDoInbox = {
      ativos: [numero()],
      removidos: [{ id: CENTRO, nome: "Centro" }],
    };
    const depois = aplicarLinhaAosNumeros(numeros, {
      id: CENTRO,
      nome: "Centro",
      connection_status: "desconectado",
      principal: false,
      removido_em: null,
    });
    expect(depois.ativos.map((n) => n.id)).toEqual([PRINCIPAL, CENTRO]);
    expect(depois.removidos).toEqual([]);
  });
});

describe("selo do numero no cartao", () => {
  const renderizar = (numeros: NumerosDoInbox, c = conversa()) =>
    renderToStaticMarkup(
      <ConversationCard
        conversation={c}
        estado={estadoVisualDaConversa(c, { viewerId: EU, authorNames: {} })}
        reserva="Paciente · Novo"
        etiquetas={[]}
        selected={false}
        viewerId={EU}
        timezone="America/Fortaleza"
        agora={Date.parse("2026-09-24T15:00:00.000Z")}
        onSelect={() => undefined}
        numero={numeroParaMostrar(c, numeros)}
      />,
    );

  it("com dois numeros, o cartao diz de qual numero e a conversa", () => {
    const html = renderizar(DOIS);
    expect(html).toContain("Número da clínica: ");
    expect(html).toContain("Recepção");
  });

  it("com um numero so, nenhum selo", () => {
    const html = renderizar(UM, conversa({ whatsapp_account_id: PRINCIPAL }));
    expect(html).not.toContain("Número da clínica");
  });

  it("numero removido diz que foi removido, em texto", () => {
    const html = renderizar(
      { ativos: [numero()], removidos: [{ id: CENTRO, nome: "Centro" }] },
      conversa({ whatsapp_account_id: CENTRO }),
    );
    expect(html).toContain("Centro");
    expect(html).toContain("(removido)");
  });
});

describe("compositor com o numero da conversa fora do ar", () => {
  const renderizar = (
    c: ConversationListItem,
    numeros: NumerosDoInbox,
    podeReconectar: boolean,
  ) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <Composer
            conversation={c}
            viewerId={EU}
            podeEditar
            autorizacao={{
              source: "whatsapp",
              granted_at: "2026-09-01T12:00:00.000Z",
              revoked_at: null,
            }}
            citando={null}
            aoCancelarCitacao={() => undefined}
            aoCancelarCitacaoSeFor={() => undefined}
            authorNames={{}}
            modo="responder"
            aoTrocarModo={() => undefined}
            texto=""
            aoMudarTexto={() => undefined}
            aoEnviarTexto={() => undefined}
            travaDoNumero={travaDoNumero(numeroParaMostrar(c, numeros))}
            podeReconectar={podeReconectar}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

  // O ATRIBUTO disabled da caixa (a classe dela tem "disabled:" do Tailwind).
  const CAIXA_DESABILITADA = /<textarea[^>]*\sdisabled=""/;

  const caido: NumerosDoInbox = {
    ativos: [numero(), { ...recepcao, connection_status: "desconectado" }],
    removidos: [],
  };

  it("diz qual numero caiu, trava a resposta e leva quem pode para reconectar", () => {
    const html = renderizar(conversa(), caido, true);
    expect(html).toContain("O número Recepção está desconectado.");
    expect(html).toContain("A resposta sai quando ele reconectar.");
    expect(html).toContain('href="/configuracoes?aba=whatsapp"');
    // A caixa de resposta fica desabilitada; a nota continua como opcao.
    expect(html).toMatch(CAIXA_DESABILITADA);
    expect(html).toContain("Nota interna");
  });

  it("quem nao reconecta ve o botao desabilitado, nunca escondido", () => {
    const html = renderizar(conversa(), caido, false);
    expect(html).toContain("O número Recepção está desconectado.");
    expect(html).not.toContain('href="/configuracoes?aba=whatsapp"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Reconectar<\/button>/);
  });

  it("com o numero conectado, nada de aviso e a caixa fica livre", () => {
    const html = renderizar(conversa(), DOIS, true);
    expect(html).not.toContain("está desconectado");
    expect(html).not.toMatch(CAIXA_DESABILITADA);
  });

  it("resolvida de numero removido: o motivo, e nao o caminho de Reabrir", () => {
    const html = renderizar(
      conversa({ status: "resolvida", whatsapp_account_id: CENTRO }),
      { ativos: [numero()], removidos: [{ id: CENTRO, nome: "Centro" }] },
      true,
    );
    expect(html).toContain(
      "Esta conversa era do número Centro, que foi removido.",
    );
    expect(html).not.toContain("Reabrir e responder");
  });
});

/**
 * Cliente falso que so grava a cadeia de chamadas de cada from(): o bastante
 * para provar QUAIS filtros o historico do fio aplica, sem banco.
 */
function clienteGravador(respostas: Record<string, unknown[]>) {
  const chamadas: { tabela: string; metodo: string; args: unknown[] }[] = [];
  const cliente = {
    from(tabela: string) {
      const consulta: Record<string, unknown> = {};
      const encadeia =
        (metodo: string) =>
        (...args: unknown[]) => {
          chamadas.push({ tabela, metodo, args });
          return consulta;
        };
      for (const metodo of [
        "select",
        "eq",
        "is",
        "or",
        "in",
        "order",
        "limit",
        "lt",
      ]) {
        consulta[metodo] = encadeia(metodo);
      }
      consulta.then = (
        resolver: (valor: { data: unknown[]; error: null }) => unknown,
      ) => resolver({ data: respostas[tabela] ?? [], error: null });
      return consulta;
    },
  };
  return { cliente, chamadas };
}

describe("historico do fio por numero (decisao 1 do dono)", () => {
  const CONVERSA = "33333333-3333-4333-8333-333333333333";
  const CONTATO = "44444444-4444-4444-8444-444444444444";

  const filtrosDaConversa = (numeroId: string | null | undefined) => {
    const { cliente, chamadas } = clienteGravador({
      conversation: [{ id: CONVERSA }],
      message: [],
    });
    return fetchMessagesPage(
      cliente as never,
      CONVERSA,
      undefined,
      CONTATO,
      numeroId,
    ).then(() => chamadas.filter((c) => c.tabela === "conversation"));
  };

  it("junta so as conversas anteriores do contato NO MESMO numero", async () => {
    const filtros = await filtrosDaConversa(RECEPCAO);
    expect(filtros).toContainEqual({
      tabela: "conversation",
      metodo: "eq",
      args: ["whatsapp_account_id", RECEPCAO],
    });
    expect(filtros).toContainEqual({
      tabela: "conversation",
      metodo: "eq",
      args: ["contact_id", CONTATO],
    });
  });

  it("conversa sem numero junta so as outras sem numero", async () => {
    const filtros = await filtrosDaConversa(null);
    expect(filtros).toContainEqual({
      tabela: "conversation",
      metodo: "is",
      args: ["whatsapp_account_id", null],
    });
  });

  it("sem a coluna (conversa montada a mao), o fio de antes, sem filtro de numero", async () => {
    const filtros = await filtrosDaConversa(undefined);
    expect(filtros.some((c) => c.args[0] === "whatsapp_account_id")).toBe(
      false,
    );
  });
});

// Cor do numero (pedido do dono em 06/10/2026): paleta fixa, faixa no topo da
// conversa, filete no selo, "Respondendo pelo numero" no compositor e o
// marcador no filtro. A cor so acompanha: o nome vem sempre escrito.
describe("cor do numero", () => {
  it("a paleta do codigo e a mesma do CHECK do banco", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261006130000_cor_do_numero.sql",
      ),
      "utf-8",
    );
    const check = sql.match(/check \(cor in \(([^)]*)\)\)/);
    expect(check?.[1]).toBeDefined();
    const doBanco = (check?.[1] ?? "")
      .split(",")
      .map((cor) => cor.trim().replace(/'/g, ""));
    expect(doBanco).toEqual([...CORES_DO_NUMERO]);
  });

  it("sugere a primeira cor livre e, com todas em uso, gira a paleta", () => {
    expect(primeiraCorLivre([])).toBe("azul");
    expect(primeiraCorLivre(["azul"])).toBe("rosa");
    expect(primeiraCorLivre(["rosa", "azul"])).toBe("verde");
    expect(primeiraCorLivre([...CORES_DO_NUMERO])).toBe("azul");
    expect(primeiraCorLivre([...CORES_DO_NUMERO, "azul"])).toBe("rosa");
  });

  it("valor fora da paleta nunca quebra a tela: vira azul", () => {
    expect(corDoNumero("vermelho")).toBe("azul");
    expect(corDoNumero(null)).toBe("azul");
    expect(corDoNumero("roxo")).toBe("roxo");
  });

  it("trocar a cor em Configuracoes chega pelo Realtime e redesenha", () => {
    const depois = aplicarLinhaAosNumeros(DOIS, {
      id: RECEPCAO,
      cor: "laranja",
    });
    expect(depois).not.toBe(DOIS);
    expect(depois.ativos.find((n) => n.id === RECEPCAO)?.cor).toBe("laranja");
    // A mesma cor (reserva de slot de envio) nao redesenha nada.
    expect(aplicarLinhaAosNumeros(DOIS, { id: RECEPCAO, cor: "rosa" })).toBe(
      DOIS,
    );
  });

  it("numero novo pelo Realtime com cor estranha entra azul", () => {
    const depois = aplicarLinhaAosNumeros(DOIS, {
      id: CENTRO,
      nome: "Centro",
      connection_status: "conectado",
      cor: "dourado",
    });
    expect(depois.ativos.find((n) => n.id === CENTRO)?.cor).toBe("azul");
  });

  it("no filtro, o removido fica sem cor", () => {
    const opcoes = opcoesDoFiltroDeNumero(
      [conversa({ whatsapp_account_id: CENTRO })],
      { ...DOIS, removidos: [{ id: CENTRO, nome: "Centro" }] },
    );
    expect(opcoes.find((o) => o.id === CENTRO)?.cor).toBeNull();
  });

  it("a faixa do topo diz o numero, o telefone e leva a cor dele", () => {
    const mostrado = numeroParaMostrar(conversa(), DOIS);
    expect(mostrado).not.toBeNull();
    const html = renderToStaticMarkup(<FaixaDoNumero numero={mostrado!} />);
    expect(html).toContain("Conversa pelo número ");
    expect(html).toContain("Recepção");
    expect(html).toContain("(84) 3255-8800");
    expect(html).toContain('data-cor="rosa"');
    expect(html).toContain("var(--numero-rosa-bg)");
    expect(html).toContain("var(--numero-rosa)");
    // Conectado e o normal: nenhum chip de conexao.
    expect(html).not.toContain("Desconectado");
  });

  it("a faixa mostra a conexao quando o numero caiu", () => {
    const caido: NumerosDoInbox = {
      ativos: [numero(), { ...recepcao, connection_status: "desconectado" }],
      removidos: [],
    };
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <FaixaDoNumero numero={numeroParaMostrar(conversa(), caido)!} />
      </TooltipProvider>,
    );
    expect(html).toContain("Desconectado");
  });

  it("numero removido: faixa neutra, sem cor, dizendo que saiu", () => {
    const html = renderToStaticMarkup(
      <FaixaDoNumero
        numero={numeroParaMostrar(conversa({ whatsapp_account_id: CENTRO }), {
          ativos: [numero()],
          removidos: [{ id: CENTRO, nome: "Centro" }],
        })!}
      />,
    );
    expect(html).toContain("Conversa do número ");
    expect(html).toContain("(removido da clínica)");
    expect(html).toContain('data-cor="nenhuma"');
    expect(html).not.toContain("var(--numero-");
  });

  it("o selo do cartao ganha o filete na cor, com o nome escrito", () => {
    const html = renderToStaticMarkup(
      <SeloDoNumero numero={numeroParaMostrar(conversa(), DOIS)!} />,
    );
    expect(html).toContain('data-cor="rosa"');
    expect(html).toContain("border-left-color:var(--numero-rosa)");
    expect(html).toContain("Recepção");
  });

  describe("compositor diz por qual numero a resposta sai", () => {
    const renderizar = (
      numeros: NumerosDoInbox,
      modo: "responder" | "nota" = "responder",
    ) => {
      const c = conversa();
      const mostrado = numeroParaMostrar(c, numeros);
      return renderToStaticMarkup(
        <QueryClientProvider client={new QueryClient()}>
          <TooltipProvider>
            <Composer
              conversation={c}
              viewerId={EU}
              podeEditar
              autorizacao={{
                source: "whatsapp",
                granted_at: "2026-09-01T12:00:00.000Z",
                revoked_at: null,
              }}
              citando={null}
              aoCancelarCitacao={() => undefined}
              aoCancelarCitacaoSeFor={() => undefined}
              authorNames={{}}
              modo={modo}
              aoTrocarModo={() => undefined}
              texto=""
              aoMudarTexto={() => undefined}
              aoEnviarTexto={() => undefined}
              travaDoNumero={travaDoNumero(mostrado)}
              numero={mostrado}
              podeReconectar
            />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    };

    it("com dois numeros: Respondendo pelo numero, com a cor", () => {
      const html = renderizar(DOIS);
      expect(html).toContain("Respondendo pelo número");
      expect(html).toContain("Recepção");
      expect(html).toContain('data-cor="rosa"');
    });

    it("com um numero so, nada muda", () => {
      expect(renderizar(UM)).not.toContain("Respondendo pelo número");
    });

    it("na nota interna, o aviso e o da nota", () => {
      const html = renderizar(DOIS, "nota");
      expect(html).not.toContain("Respondendo pelo número");
      expect(html).toContain("Nota interna: o paciente não vê.");
    });

    it("com o numero fora do ar, quem fala e o aviso de desconectado", () => {
      const html = renderizar({
        ativos: [numero(), { ...recepcao, connection_status: "desconectado" }],
        removidos: [],
      });
      expect(html).not.toContain("Respondendo pelo número");
      expect(html).toContain("O número Recepção está desconectado.");
    });
  });
});
