import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A lista importa as Server Actions da agendada; aqui so a renderizacao.
vi.mock("@/app/(app)/atendimento/agendadas-actions", () => ({
  dispensarAgendadaAction: vi.fn(),
  enviarAgendadaAgoraAction: vi.fn(),
  excluirAgendadaAction: vi.fn(),
}));
// A dica do botao desabilitado mora num tooltip (portal), que nao existe no
// HTML estatico: aqui ela vira um atributo, para o teste ler a frase.
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => (
    <span tabIndex={0} data-dica={hint}>
      {children}
    </span>
  ),
}));

import { SEM_ANUNCIO } from "@/components/atendimento/agendadas/anuncio";
import {
  contextoComNumerosAoVivo,
  itensVisiveis,
  ListaDeAgendadas,
  proximoFoco,
  type DadosDaListaDeAgendadas,
} from "@/components/atendimento/agendadas/lista-de-agendadas";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  AgendadaDaLista,
  ContextoDaListaDeAgendadas,
} from "@/lib/domain/mensagem-agendada";

// Lista das mensagens agendadas acima da caixa de escrever (secao 4.4 do
// desenho, com A1, A2 e A3 do desenho final): estados de vazio, carregando e
// erro; o item com chip, quando, quem, numero e acoes; as dicas das acoes
// desabilitadas; o resumo com 2 ou mais; a regiao role=status montada
// sempre. Renderizacao estatica: os efeitos (relogio, esqueleto) nao rodam.

const FUSO = "America/Fortaleza";
// 06/10/2026, 09:00 em Fortaleza (UTC-3).
const AGORA = Date.parse("2026-10-06T12:00:00.000Z");
const EU = "11111111-1111-4111-8111-111111111111";
const ANA = "22222222-2222-4222-8222-222222222222";
const BRUNO = "33333333-3333-4333-8333-333333333333";
const RECEPCAO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CENTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTATO = "44444444-4444-4444-8444-444444444444";
const CONVERSA = "55555555-5555-4555-8555-555555555555";
const CLINICA = "66666666-6666-4666-8666-666666666666";

const NOMES = { [EU]: "Carla Recepção", [ANA]: "Ana", [BRUNO]: "Bruno" };

function agendada(campos: Partial<AgendadaDaLista> = {}): AgendadaDaLista {
  return {
    id: "77777777-7777-4777-8777-777777777771",
    contactId: CONTATO,
    whatsappAccountId: RECEPCAO,
    conversationId: CONVERSA,
    texto: "Oi, Maria! Passando para lembrar do seu retorno amanhã.",
    // 07/10, 09:00 em Fortaleza
    enviarEm: "2026-10-07T12:00:00.000Z",
    situacao: "agendada",
    motivo: null,
    criadaPor: EU,
    editadaPor: null,
    enviadaEm: null,
    messageId: null,
    dispensadaEm: null,
    criadaEm: "2026-10-06T11:00:00.000Z",
    editadaEm: null,
    ...campos,
  };
}

function contexto(
  campos: Partial<ContextoDaListaDeAgendadas> = {},
): ContextoDaListaDeAgendadas {
  return {
    ultimaEntradaPorNumero: { [RECEPCAO]: "2026-10-06T10:00:00.000Z" },
    conexaoPorNumero: {
      [RECEPCAO]: {
        nome: "Recepção",
        conectado: true,
        removido: false,
        cor: "rosa",
      },
      [CENTRO]: {
        nome: "Centro",
        conectado: true,
        removido: false,
        cor: "azul",
      },
    },
    membrosComEscrita: [EU, ANA, BRUNO],
    ...campos,
  };
}

function render(
  props: Partial<ComponentProps<typeof ListaDeAgendadas>> & {
    itens?: AgendadaDaLista[];
    ctx?: ContextoDaListaDeAgendadas;
  } = {},
): string {
  const { itens, ctx, ...resto } = props;
  const dados: DadosDaListaDeAgendadas | undefined =
    "dados" in props
      ? props.dados
      : { itens: itens ?? [agendada()], contexto: ctx ?? contexto() };
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ListaDeAgendadas
          clinicId={CLINICA}
          estado="pronto"
          aoTentarDeNovo={() => undefined}
          conversa={{
            id: CONVERSA,
            status: "em_atendimento",
            assigneeUserId: EU,
            whatsappAccountId: RECEPCAO,
            contactId: CONTATO,
            contato: "Maria Teste",
          }}
          viewerId={EU}
          podeEscrever
          nomes={NOMES}
          timezone={FUSO}
          agoraInicial={AGORA}
          mostrarNumero={false}
          anuncio={SEM_ANUNCIO}
          anunciar={() => undefined}
          aoEditar={() => undefined}
          aoAgendarDeNovo={() => undefined}
          aoDevolverTexto={() => undefined}
          aoIrParaConversa={() => undefined}
          {...resto}
          dados={dados}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** O atributo disabled (e nao a classe disabled:...). */
function desabilitado(botaoHtml: string | null): boolean {
  return botaoHtml !== null && /\sdisabled=""/.test(botaoHtml);
}

/** O botao com este nome acessivel, ou null. */
function botao(html: string, nome: string): string | null {
  const indice = html.indexOf(`aria-label="${nome}"`);
  if (indice < 0) {
    return null;
  }
  const inicio = html.lastIndexOf("<button", indice);
  const fim = html.indexOf(">", indice);
  return html.slice(inicio, fim + 1);
}

/** A dica do botao desabilitado com este nome acessivel, ou null. */
function dica(html: string, nome: string): string | null {
  const indice = html.indexOf(`aria-label="${nome}"`);
  if (indice < 0) {
    return null;
  }
  const envoltorio = html.lastIndexOf("<span", indice);
  const achada = /data-dica="([^"]*)"/.exec(html.slice(envoltorio, indice));
  return achada?.[1]?.replaceAll("&quot;", '"') ?? null;
}

/** As classes da lista de itens (o ul). */
function classesDaLista(html: string): string | null {
  return /<ul id="[^"]+" class="([^"]*)"/.exec(html)?.[1] ?? null;
}

describe("estados da lista", () => {
  it("vazia: so a regiao role=status, sem caixa nem titulo", () => {
    const html = render({ itens: [] });
    expect(html).toBe('<span role="status" class="sr-only"></span>');
  });

  it("carregando: nada nos primeiros 300 ms (so a regiao viva)", () => {
    const html = render({ estado: "carregando", dados: undefined });
    expect(html).toBe('<span role="status" class="sr-only"></span>');
    expect(html).not.toContain("Mensagens agendadas");
  });

  it("erro sem dados: aviso compacto com Tentar de novo", () => {
    const html = render({ estado: "erro", dados: undefined });
    expect(html).toContain("Não foi possível carregar as mensagens agendadas.");
    expect(html).toContain("Tentar de novo");
    expect(html).toContain('data-tom="alert"');
    expect(html).toContain('role="status" class="sr-only"');
  });

  it("erro com dados antigos: mostra o que tem", () => {
    const html = render({ estado: "erro" });
    expect(html).not.toContain("Não foi possível carregar");
    expect(html).toContain("Sai amanhã às 09:00");
  });

  it("a regiao viva diz o anuncio", () => {
    const html = render({
      anuncio: { texto: "Mensagem agendada excluída.", vez: 1 },
    });
    expect(html).toContain(
      '<span role="status" class="sr-only">Mensagem agendada excluída.</span>',
    );
  });
});

describe("um item agendado", () => {
  it("chip, quando (visivel e para o leitor de tela) e quem", () => {
    const html = render();
    expect(html).toMatch(/<section aria-labelledby="[^"]+"/);
    expect(html).toContain("Mensagens agendadas</h2>");
    expect(html).toContain(">Agendada</span>");
    expect(html).toContain("lucide-clock-fading");
    expect(html).toContain("Sai amanhã às 09:00");
    expect(html).toContain("Sai na quarta, 7 de outubro, às 09:00.");
    expect(html).toContain("Agendada por você");
    expect(html).toContain(
      "Oi, Maria! Passando para lembrar do seu retorno amanhã.",
    );
  });

  it("as acoes de 40px levam a data no nome acessivel", () => {
    const html = render();
    for (const nome of [
      "Editar a mensagem agendada para amanhã às 09:00",
      "Enviar agora a mensagem agendada para amanhã às 09:00",
      "Excluir a mensagem agendada para amanhã às 09:00",
    ]) {
      const b = botao(html, nome);
      expect(b, nome).not.toBeNull();
      expect(b).toContain('data-size="icon"');
      expect(desabilitado(b)).toBe(false);
    }
  });

  it("editada por outra pessoa: assina quem editou (A1)", () => {
    const html = render({
      itens: [agendada({ criadaPor: ANA, editadaPor: BRUNO })],
    });
    expect(html).toContain("Agendada por Ana, editada por Bruno");
  });

  it("assinante sem escrita aparece como sem acesso", () => {
    const html = render({
      itens: [agendada({ criadaPor: ANA })],
      ctx: contexto({ membrosComEscrita: [EU] }),
    });
    expect(html).toContain("Agendada por Ana (sem acesso)");
  });

  it("com mais de um numero, diz por qual sai, com o marcador", () => {
    const html = render({ mostrarNumero: true });
    expect(html).toContain("pelo número Recepção");
    expect(html).toContain('data-cor="rosa"');
  });

  it("com um numero so, nao fala de numero", () => {
    expect(render()).not.toContain("pelo número");
  });

  it("o paciente escreveu depois: aviso de atencao", () => {
    const html = render({
      ctx: contexto({
        ultimaEntradaPorNumero: { [RECEPCAO]: "2026-10-06T11:30:00.000Z" },
      }),
    });
    expect(html).toContain(
      "Maria Teste escreveu depois que esta mensagem foi agendada. Confira se ela ainda faz sentido.",
    );
    expect(html).toContain("lucide-circle-alert");
  });

  it("numero desconectado antes da hora: aviso", () => {
    const html = render({
      ctx: contexto({
        conexaoPorNumero: {
          [RECEPCAO]: {
            nome: "Recepção",
            conectado: false,
            removido: false,
            cor: "rosa",
          },
        },
      }),
    });
    // O prazo efetivo (F4): marcada amanha 09:00, o limite e amanha 21:00.
    expect(html).toContain(
      "O número Recepção está desconectado. Se não reconectar até amanhã às 21:00, a mensagem não sai.",
    );
  });
});

describe("F7: Enviar agora com o numero da agendada desconectado", () => {
  const caido = {
    nome: "Recepção",
    conectado: false,
    removido: false,
    cor: "rosa" as const,
  };

  it("desabilitado, com a dica de que ela espera a reconexao", () => {
    const html = render({
      ctx: contexto({
        conexaoPorNumero: { ...contexto().conexaoPorNumero, [RECEPCAO]: caido },
      }),
    });
    const nome = "Enviar agora a mensagem agendada para amanhã às 09:00";
    expect(desabilitado(botao(html, nome))).toBe(true);
    expect(dica(html, nome)).toBe(
      "O número Recepção está desconectado. A mensagem continua agendada e espera a reconexão.",
    );
    // Editar e excluir continuam.
    expect(
      desabilitado(
        botao(html, "Editar a mensagem agendada para amanhã às 09:00"),
      ),
    ).toBe(false);
  });

  it("vale a conexao AO VIVO do Inbox, por cima da ultima leitura", () => {
    const nome = "Enviar agora a mensagem agendada para amanhã às 09:00";
    // A leitura viu conectado; o tempo real ja sabe que caiu.
    const caiuAgora = render({
      numerosAoVivo: {
        ativos: [
          {
            id: RECEPCAO,
            nome: "Recepção",
            display_phone: null,
            connection_status: "desconectado",
            principal: true,
            connected_at: null,
            cor: "rosa",
          },
        ],
        removidos: [],
      },
    });
    expect(desabilitado(botao(caiuAgora, nome))).toBe(true);
    // E o contrario: reconectou, destrava sem esperar a proxima leitura.
    const voltou = render({
      ctx: contexto({
        conexaoPorNumero: { ...contexto().conexaoPorNumero, [RECEPCAO]: caido },
      }),
      numerosAoVivo: {
        ativos: [
          {
            id: RECEPCAO,
            nome: "Recepção",
            display_phone: null,
            connection_status: "conectado",
            principal: true,
            connected_at: "2026-10-06T11:00:00.000Z",
            cor: "rosa",
          },
        ],
        removidos: [],
      },
    });
    expect(desabilitado(botao(voltou, nome))).toBe(false);
  });
});

describe("F8: a lista tem teto de altura sempre", () => {
  const TETO = /(^| )max-h-\[40svh\]( |$)/;

  it("com 1 item", () => {
    const classes = classesDaLista(render());
    expect(classes).toMatch(TETO);
    expect(classes).toContain("overflow-y-auto");
  });

  it("fechada, com varios itens que pedem atencao a vista", () => {
    const html = render({
      itens: [1, 2, 3].map((n) =>
        agendada({
          id: `77777777-7777-4777-8777-77777777777${n}`,
          situacao: "nao_enviada",
          motivo: "numero_removido",
          enviarEm: `2026-10-0${n}T12:00:00.000Z`,
        }),
      ),
    });
    expect(html).toMatch(/aria-expanded="false"[^>]*>Ver todas<\/button>/);
    expect(classesDaLista(html)).toMatch(TETO);
  });
});

describe("F6: o aviso de que o paciente escreveu fica a vista", () => {
  it("lista fechada: a que ainda vai sair com o aviso aparece, a outra nao", () => {
    const html = render({
      itens: [
        // Criada antes da fala do paciente: avisa.
        agendada({ criadaEm: "2026-10-06T09:00:00.000Z" }),
        // Editada depois da fala: nada a avisar, fica no resumo.
        agendada({
          id: "77777777-7777-4777-8777-777777777772",
          texto: "Lembrete da semana que vem.",
          enviarEm: "2026-10-13T12:00:00.000Z",
          criadaEm: "2026-10-06T09:00:00.000Z",
          editadaEm: "2026-10-06T11:00:00.000Z",
        }),
      ],
      ctx: contexto({
        ultimaEntradaPorNumero: { [RECEPCAO]: "2026-10-06T10:00:00.000Z" },
      }),
    });
    expect(html).toMatch(/aria-expanded="false"[^>]*>Ver todas<\/button>/);
    expect(html).toContain(
      "Maria Teste escreveu depois que esta mensagem foi agendada. Confira se ela ainda faz sentido.",
    );
    expect(html).toContain("Sai amanhã às 09:00");
    expect(html).not.toContain("Lembrete da semana que vem.");
  });
});

describe("F19: Agendar de novo numa conversa de numero removido", () => {
  const naoEnviada = agendada({
    situacao: "nao_enviada",
    motivo: "numero_removido",
    enviarEm: "2026-10-05T12:00:00.000Z",
  });
  const NOME = "Agendar de novo a mensagem marcada para ontem às 09:00";

  it("o numero da conversa aberta (o da agendada) foi removido", () => {
    const html = render({
      itens: [naoEnviada],
      ctx: contexto({
        conexaoPorNumero: {
          [RECEPCAO]: {
            nome: "Recepção",
            conectado: false,
            removido: true,
            cor: "rosa",
          },
        },
      }),
    });
    expect(desabilitado(botao(html, NOME))).toBe(true);
    expect(dica(html, NOME)).toBe(
      "O número Recepção foi removido. Para agendar de novo, use a conversa de outro número.",
    );
  });

  it("removido que so o Inbox conhece (nenhuma agendada nele)", () => {
    const html = render({
      itens: [naoEnviada],
      conversa: {
        id: CONVERSA,
        status: "em_atendimento",
        assigneeUserId: EU,
        whatsappAccountId: CENTRO,
        contactId: CONTATO,
        contato: "Maria Teste",
      },
      ctx: contexto({
        conexaoPorNumero: {
          [RECEPCAO]: contexto().conexaoPorNumero[RECEPCAO]!,
        },
      }),
      numerosAoVivo: {
        ativos: [],
        removidos: [{ id: CENTRO, nome: "Centro" }],
      },
    });
    expect(desabilitado(botao(html, NOME))).toBe(true);
    expect(dica(html, NOME)).toBe(
      "O número Centro foi removido. Para agendar de novo, use a conversa de outro número.",
    );
  });

  it("numero ativo: habilitado com a conversa comigo", () => {
    expect(desabilitado(botao(render({ itens: [naoEnviada] }), NOME))).toBe(
      false,
    );
  });
});

describe("contextoComNumerosAoVivo", () => {
  it("sem numeros do Inbox, o contexto da leitura como veio", () => {
    const ctx = contexto();
    expect(contextoComNumerosAoVivo(ctx, undefined)).toBe(ctx);
    expect(contextoComNumerosAoVivo(ctx, { ativos: [], removidos: [] })).toBe(
      ctx,
    );
  });

  it("ativos e removidos por cima; o que o Inbox nao conhece fica", () => {
    const ctx = contexto();
    const vivo = contextoComNumerosAoVivo(ctx, {
      ativos: [
        {
          id: RECEPCAO,
          nome: "Recepção nova",
          display_phone: null,
          connection_status: "desconectado",
          principal: true,
          connected_at: null,
          cor: "verde",
        },
      ],
      removidos: [{ id: "removido-1", nome: "Antigo" }],
    });
    expect(vivo.conexaoPorNumero[RECEPCAO]).toEqual({
      nome: "Recepção nova",
      conectado: false,
      removido: false,
      cor: "verde",
    });
    expect(vivo.conexaoPorNumero["removido-1"]).toEqual({
      nome: "Antigo",
      conectado: false,
      removido: true,
      cor: null,
    });
    expect(vivo.conexaoPorNumero[CENTRO]).toEqual(ctx.conexaoPorNumero[CENTRO]);
    // O resto do contexto nao muda, e o original fica intacto.
    expect(vivo.membrosComEscrita).toBe(ctx.membrosComEscrita);
    expect(ctx.conexaoPorNumero[RECEPCAO]?.conectado).toBe(true);
  });
});

describe("acoes desabilitadas ficam visiveis, com o motivo", () => {
  it("Somente leitura: editar, enviar agora e excluir desabilitados", () => {
    const html = render({ podeEscrever: false });
    for (const nome of [
      "Editar a mensagem agendada para amanhã às 09:00",
      "Enviar agora a mensagem agendada para amanhã às 09:00",
      "Excluir a mensagem agendada para amanhã às 09:00",
    ]) {
      const b = botao(html, nome);
      expect(b, nome).not.toBeNull();
      expect(desabilitado(b)).toBe(true);
    }
    // A dica mora no tooltip do span focavel (DisabledWithHint).
    expect(html).toContain('tabindex="0"');
  });

  it("conversa com colega: so o Enviar agora trava", () => {
    const html = render({
      conversa: {
        id: CONVERSA,
        status: "em_atendimento",
        assigneeUserId: ANA,
        whatsappAccountId: RECEPCAO,
        contactId: CONTATO,
        contato: "Maria Teste",
      },
    });
    expect(
      desabilitado(
        botao(html, "Enviar agora a mensagem agendada para amanhã às 09:00"),
      ),
    ).toBe(true);
    expect(
      desabilitado(
        botao(html, "Editar a mensagem agendada para amanhã às 09:00"),
      ),
    ).toBe(false);
    expect(
      desabilitado(
        botao(html, "Excluir a mensagem agendada para amanhã às 09:00"),
      ),
    ).toBe(false);
  });

  it("na fila: editar trava, excluir continua, enviar agora some", () => {
    const html = render({
      itens: [
        agendada({
          situacao: "enviando",
          enviarEm: "2026-10-06T11:58:00.000Z",
        }),
      ],
    });
    expect(html).toContain(">Na fila para sair</span>");
    expect(html).toContain(
      "Marcada para hoje às 08:58. Pode levar alguns minutos.",
    );
    expect(
      desabilitado(
        botao(html, "Editar a mensagem agendada para hoje às 08:58"),
      ),
    ).toBe(true);
    expect(
      desabilitado(
        botao(html, "Excluir a mensagem agendada para hoje às 08:58"),
      ),
    ).toBe(false);
    expect(
      botao(html, "Enviar agora a mensagem agendada para hoje às 08:58"),
    ).toBeNull();
  });
});

describe("estados depois da hora", () => {
  it("nao enviada: motivo, atividade (A3), agendar de novo e dispensar", () => {
    const html = render({
      itens: [
        agendada({
          situacao: "nao_enviada",
          motivo: "atrasou",
          enviarEm: "2026-10-05T12:00:00.000Z",
        }),
      ],
    });
    expect(html).toContain(">Não enviada</span>");
    expect(html).toContain("lucide-octagon-alert");
    expect(html).toContain("Não enviada: o envio atrasou mais de 12 horas.");
    expect(html).toContain("Uma atividade foi criada para você conferir.");
    expect(html).toContain(">Agendar de novo</button>");
    expect(html).toContain(">Dispensar</button>");
    expect(html).not.toContain("Editar a mensagem");
  });

  it("envio nao confirmado: so Entendi, esconder", () => {
    const html = render({
      itens: [
        agendada({
          situacao: "nao_confirmada",
          motivo: "envio_incerto",
          enviarEm: "2026-10-06T11:00:00.000Z",
        }),
      ],
    });
    expect(html).toContain(">Envio não confirmado</span>");
    expect(html).toContain(
      "A mensagem pode ter chegado ao paciente. Confira a conversa antes de mandar de novo.",
    );
    expect(html).toContain(">Entendi, esconder</button>");
    expect(html).not.toContain(">Agendar de novo</button>");
    expect(html).not.toContain("Excluir a mensagem");
  });

  it("enviada nas ultimas 24 horas: Ver na conversa", () => {
    const html = render({
      itens: [
        agendada({
          situacao: "enviada",
          texto: null,
          enviarEm: "2026-10-06T11:00:00.000Z",
          enviadaEm: "2026-10-06T11:02:00.000Z",
          messageId: "88888888-8888-4888-8888-888888888888",
        }),
      ],
    });
    expect(html).toContain(">Enviada</span>");
    expect(html).toContain("Enviada hoje às 08:02");
    expect(html).toContain(">Ver na conversa</button>");
  });

  it("esperando o numero: linha com o prazo de 12 horas", () => {
    const html = render({
      itens: [
        agendada({
          situacao: "enviando",
          enviarEm: "2026-10-06T11:00:00.000Z",
        }),
      ],
      ctx: contexto({
        conexaoPorNumero: {
          [RECEPCAO]: {
            nome: "Recepção",
            conectado: false,
            removido: false,
            cor: "rosa",
          },
        },
      }),
    });
    expect(html).toContain(">Esperando o número reconectar</span>");
    expect(html).toContain(
      "Marcada para hoje às 08:00. Se o número Recepção não reconectar até hoje às 20:00, a mensagem não sai.",
    );
  });
});

describe("dois ou mais itens", () => {
  const tres = [
    agendada(),
    agendada({
      id: "77777777-7777-4777-8777-777777777772",
      enviarEm: "2026-10-08T14:00:00.000Z",
    }),
    agendada({
      id: "77777777-7777-4777-8777-777777777773",
      situacao: "nao_enviada",
      motivo: "sem_autorizacao",
      enviarEm: "2026-10-05T12:00:00.000Z",
    }),
  ];

  it("resumo com Ver todas; o que pede atencao fica a vista", () => {
    const html = render({ itens: tres });
    expect(html).toContain(
      "3 mensagens agendadas. A próxima sai amanhã às 09:00.",
    );
    expect(html).toMatch(/aria-expanded="false"[^>]*>Ver todas<\/button>/);
    // O titulo continua para o leitor de tela.
    expect(html).toMatch(
      /<h2 id="[^"]+" class="[^"]*sr-only[^"]*">Mensagens agendadas/,
    );
    // Fechada: so a nao enviada aparece.
    expect(html).toContain(
      "Não enviada: Maria Teste não autoriza receber mensagens.",
    );
    expect(html).not.toContain("Sai amanhã às 09:00");
  });

  it("itensVisiveis esconde cancelada, dispensada e enviada antiga", () => {
    const visiveis = itensVisiveis(
      [
        agendada(),
        agendada({ id: "a", situacao: "cancelada", texto: null }),
        agendada({
          id: "b",
          situacao: "nao_enviada",
          dispensadaEm: "2026-10-06T10:00:00.000Z",
        }),
        agendada({
          id: "c",
          situacao: "enviada",
          enviadaEm: "2026-10-04T12:00:00.000Z",
        }),
      ],
      contexto(),
      AGORA,
      FUSO,
    );
    expect(visiveis.map((item) => item.agendada.id)).toEqual([
      "77777777-7777-4777-8777-777777777771",
    ]);
  });
});

describe("foco depois de tirar um item", () => {
  it("vai para o proximo; sem proximo, para o titulo (null)", () => {
    expect(proximoFoco(["a", "b", "c"], "a")).toBe("b");
    expect(proximoFoco(["a", "b", "c"], "c")).toBeNull();
    expect(proximoFoco(["a"], "x")).toBeNull();
  });
});

describe("textos sem travessao", () => {
  it("nenhum travessao nem meia-risca na lista", () => {
    const html = [
      render(),
      render({ podeEscrever: false }),
      render({
        itens: [agendada({ situacao: "nao_enviada", motivo: "atrasou" })],
      }),
      render({ estado: "erro", dados: undefined }),
    ].join("");
    expect(html).not.toMatch(/[—–]/);
  });
});
