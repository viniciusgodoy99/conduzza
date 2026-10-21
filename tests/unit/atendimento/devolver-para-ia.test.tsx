import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O cabecalho importa as Server Actions do Atendimento; aqui so a
// renderizacao e as regras importam. Nenhuma e chamada (a conferencia so
// roda no navegador).
const acoes = vi.hoisted(() => ({
  elegibilidade: vi.fn(),
  devolver: vi.fn(),
}));
vi.mock("@/app/(app)/atendimento/actions", () => ({
  assumirConversaAction: vi.fn(),
  reabrirConversaAction: vi.fn(),
  resolverConversaAction: vi.fn(),
  transferirConversaAction: vi.fn(),
  devolverParaIaAction: acoes.devolver,
  elegibilidadeDoDevolverAction: acoes.elegibilidade,
}));

// O cabecalho cria o cliente do navegador (a equipe que recebe a
// transferencia); aqui nada e lido.
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import {
  AcoesDaConversa,
  SO_ACOMPANHA,
} from "@/components/atendimento/acoes-da-conversa";
import {
  BotaoDevolverParaIa,
  ConfirmacaoDoDevolver,
  dicaDoMotivo,
  estadoDoDevolver,
  leituraDaConsulta,
  TEXTOS_DO_DEVOLVER,
  useElegibilidadeDoDevolver,
  type EstadoDoDevolver,
  type LeituraDaElegibilidade,
} from "@/components/atendimento/devolver-para-ia";
import { Dialog } from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Role } from "@/lib/domain/permissions";
import type { ConversationListItem } from "@/lib/queries/conversations";
import { devolverKeys } from "@/lib/realtime/use-inbox-channel";

// "Devolver para a IA" (E3): so na conversa "minha", habilitado so quando o
// servidor diz que pode, com uma dica por motivo (e a generica para quem
// nao e administrador nem gestor), "Conferindo..." enquanto confere, erro
// quando a conferencia falha, e a confirmacao antes de devolver. Fora das
// duas clinicas da fase, a dica de sempre, sem perguntar ao servidor.

const EU = "11111111-1111-4111-8111-111111111111";
const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";

function conversa(
  campos: Partial<ConversationListItem> = {},
): ConversationListItem {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    status: "em_atendimento",
    assignee_user_id: EU,
    unread_count: 0,
    awaiting_reply: false,
    last_message_at: "2026-10-13T14:30:00.000Z",
    last_inbound_at: "2026-10-13T14:10:00.000Z",
    last_preview: "Oi",
    last_preview_kind: "texto",
    last_preview_author: "paciente",
    last_preview_author_user_id: null,
    tags: [],
    whatsapp_account_id: null,
    contact: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Telefone da equipe",
      phone_e164: "+5584999990001",
      kind: "lead",
      funnel_stage: "novo",
      source_channel: null,
      source_campaign: null,
      first_contact_at: null,
    },
    ...campos,
  };
}

const PODE: LeituraDaElegibilidade = {
  status: "success",
  data: { ok: true, pode: true },
};

function naoPode(
  motivo: Parameters<typeof dicaDoMotivo>[0],
): LeituraDaElegibilidade {
  return { status: "success", data: { ok: true, pode: false, motivo } };
}

function estado(
  leitura: LeituraDaElegibilidade,
  campos: { iaNaFase?: boolean; podeEditar?: boolean } = {},
): EstadoDoDevolver {
  return estadoDoDevolver({
    iaNaFase: campos.iaNaFase ?? true,
    podeEditar: campos.podeEditar ?? true,
    dicaSemPermissao: SO_ACOMPANHA,
    leitura,
  });
}

function botao(estadoDoBotao: EstadoDoDevolver, emCurso = false): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <BotaoDevolverParaIa
        estado={estadoDoBotao}
        emCurso={emCurso}
        ocupado={false}
        aoClicar={() => undefined}
        aoTentarDeNovo={() => undefined}
      />
    </TooltipProvider>,
  );
}

/** Os elementos da arvore (sem renderizar componentes): para achar o onClick. */
function elementos(no: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(no)) {
    return no.flatMap(elementos);
  }
  if (!isValidElement<Record<string, unknown>>(no)) {
    return [];
  }
  return [no, ...elementos(no.props.children as ReactNode)];
}

/** As tags de abertura de todos os botoes do HTML. */
function aberturasDosBotoes(html: string): string[] {
  return html.match(/<button[^>]*>/g) ?? [];
}

/** A tag de abertura do botao (o primeiro do HTML). */
function aberturaDoBotao(html: string): string {
  const inicio = html.indexOf("<button");
  return html.slice(inicio, html.indexOf(">", inicio) + 1);
}

/** O botao esta dentro do span com tabIndex da dica (DisabledWithHint)? */
function comDica(html: string): boolean {
  return /<span[^>]*tabindex="0"[^>]*><button/.test(html);
}

describe("estado do Devolver por motivo", () => {
  it("fora das duas clínicas: a dica de sempre, sem perguntar ao servidor", () => {
    // mesmo com a leitura dizendo que pode (nunca acontece: nem se pergunta)
    expect(estado(PODE, { iaNaFase: false })).toEqual({
      tipo: "nao_pode",
      dica: "Chega com o agente de IA. Até lá, use Resolver quando terminar o atendimento.",
    });
    expect(estado({ status: "pending" }, { iaNaFase: false }).tipo).toBe(
      "nao_pode",
    );
  });

  it("quem só acompanha: a dica de permissão de hoje", () => {
    expect(estado({ status: "pending" }, { podeEditar: false })).toEqual({
      tipo: "nao_pode",
      dica: SO_ACOMPANHA,
    });
  });

  it("conferindo, erro e pode", () => {
    expect(estado({ status: "pending" })).toEqual({ tipo: "conferindo" });
    expect(estado({ status: "error" })).toEqual({ tipo: "erro" });
    expect(
      estado({
        status: "success",
        data: {
          ok: false,
          error: "Não foi possível conferir agora. Tente de novo.",
        },
      }),
    ).toEqual({ tipo: "erro" });
    expect(estado(PODE)).toEqual({ tipo: "pode" });
  });

  it("cada motivo do servidor vira a sua dica, palavra por palavra", () => {
    const esperado = {
      fora_da_fase:
        "Chega com o agente de IA. Até lá, use Resolver quando terminar o atendimento.",
      pergunta_pendente: "Responda o paciente antes de devolver para a IA.",
      assistente_desligado:
        "O assistente está desligado ou sem versão publicada. Veja em Agente de IA, aba WhatsApp.",
      nao_liberada:
        "Este telefone ou este número não está liberado para o assistente.",
      contato_de_paciente:
        "Este contato é paciente da clínica. A IA só conversa com telefones da equipe.",
      nao_disponivel: "Esta conversa não pode voltar para a IA.",
      // achado T1 da revisao: o assistente nao responderia agora
      assistente_parado:
        "O assistente está parado agora. Veja em Agente de IA, aba WhatsApp.",
      fora_do_horario:
        "Agora está fora do horário escolhido para o assistente.",
      numero_desconectado: "O número desta conversa está desconectado.",
      sem_permissao: SO_ACOMPANHA,
      // so numa corrida (a tela ainda achava a conversa sua): a generica
      nao_e_sua: "Esta conversa não pode voltar para a IA.",
    } as const;
    for (const [motivo, dica] of Object.entries(esperado)) {
      expect(estado(naoPode(motivo as keyof typeof esperado)), motivo).toEqual({
        tipo: "nao_pode",
        dica,
      });
    }
  });
});

describe("a leitura da consulta", () => {
  const PODE_DADO = { ok: true, pode: true } as const;
  const FALHA_DADO = {
    ok: false,
    error: "Não foi possível conferir agora. Tente de novo.",
  } as const;

  it("sem resposta: conferindo; com resposta: a resposta", () => {
    expect(
      leituraDaConsulta({ isError: false, isFetching: true, data: undefined }),
    ).toEqual({ status: "pending" });
    expect(
      leituraDaConsulta({ isError: false, isFetching: false, data: PODE_DADO }),
    ).toEqual({ status: "success", data: PODE_DADO });
  });

  it("erro parado: erro; tentando de novo depois do erro: Conferindo...", () => {
    expect(
      leituraDaConsulta({ isError: true, isFetching: false, data: undefined }),
    ).toEqual({ status: "error" });
    expect(
      leituraDaConsulta({ isError: true, isFetching: true, data: undefined }),
    ).toEqual({ status: "pending" });
    // a action devolveu o erro (ok: false) e a pessoa tentou de novo
    expect(
      leituraDaConsulta({ isError: false, isFetching: true, data: FALHA_DADO }),
    ).toEqual({ status: "pending" });
    expect(
      leituraDaConsulta({
        isError: false,
        isFetching: false,
        data: FALHA_DADO,
      }),
    ).toEqual({ status: "success", data: FALHA_DADO });
  });

  it("resposta boa atualizando no fundo (tempo real): fica a resposta, sem piscar", () => {
    expect(
      leituraDaConsulta({ isError: false, isFetching: true, data: PODE_DADO }),
    ).toEqual({ status: "success", data: PODE_DADO });
  });
});

describe("o botão em cada estado", () => {
  it("conferindo: desabilitado, com Conferindo... e o nome do botão para o leitor", () => {
    const html = botao({ tipo: "conferindo" });
    expect(aberturaDoBotao(html)).toContain('disabled=""');
    expect(aberturaDoBotao(html)).toContain('aria-busy="true"');
    expect(html).toContain("Conferindo...");
    expect(html).toContain("(Devolver para a IA)");
    expect(comDica(html)).toBe(true);
  });

  it("erro: desabilitado com a dica de tentar de novo", () => {
    const html = botao({ tipo: "erro" });
    expect(aberturaDoBotao(html)).toContain('disabled=""');
    expect(comDica(html)).toBe(true);
    expect(html).toContain("Devolver para a IA");
    expect(TEXTOS_DO_DEVOLVER.erroAoConferir).toBe(
      "Não foi possível conferir agora. Tente de novo.",
    );
  });

  it("erro: ao lado, Tentar de novo habilitado (o erro manda tentar de novo e há como)", () => {
    const html = botao({ tipo: "erro" });
    const botoes = aberturasDosBotoes(html);
    expect(botoes).toHaveLength(2);
    // o Devolver preso, o Tentar de novo livre
    expect(botoes[0]).toContain('disabled=""');
    expect(botoes[1]).not.toContain('disabled=""');
    expect(html).toContain("Tentar de novo</span>");
    // o leitor de tela ouve de que botão se trata
    expect(html).toMatch(
      /Tentar de novo<\/span><span class="sr-only"> \(Devolver para a IA\)/,
    );
    // nos outros estados, nada de Tentar de novo
    for (const outro of [
      { tipo: "conferindo" },
      { tipo: "pode" },
      { tipo: "nao_pode", dica: TEXTOS_DO_DEVOLVER.dicas.nao_disponivel },
    ] as const) {
      expect(botao(outro)).not.toContain("Tentar de novo");
    }
  });

  it("erro: o clique em Tentar de novo refaz a conferência; o Devolver não é chamado", () => {
    const aoTentarDeNovo = vi.fn();
    const aoClicar = vi.fn();
    const arvore = BotaoDevolverParaIa({
      estado: { tipo: "erro" },
      emCurso: false,
      ocupado: false,
      aoClicar,
      aoTentarDeNovo,
    });
    const comClique = elementos(arvore).filter(
      (el) => typeof el.props.onClick === "function",
    );
    const tentar = comClique.find((el) =>
      renderToStaticMarkup(<TooltipProvider>{el}</TooltipProvider>).includes(
        "Tentar de novo",
      ),
    );
    expect(tentar).toBeDefined();
    (tentar?.props.onClick as () => void)();
    expect(aoTentarDeNovo).toHaveBeenCalledTimes(1);
    expect(aoClicar).not.toHaveBeenCalled();
  });

  it("erro com outra ação do cabeçalho rodando: Tentar de novo espera", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <BotaoDevolverParaIa
          estado={{ tipo: "erro" }}
          emCurso={false}
          ocupado
          aoClicar={() => undefined}
          aoTentarDeNovo={() => undefined}
        />
      </TooltipProvider>,
    );
    for (const abertura of aberturasDosBotoes(html)) {
      expect(abertura).toContain('disabled=""');
    }
  });

  it("não pode: visível, desabilitado e com dica (nunca escondido)", () => {
    const html = botao({
      tipo: "nao_pode",
      dica: TEXTOS_DO_DEVOLVER.dicas.pergunta_pendente,
    });
    expect(aberturaDoBotao(html)).toContain('disabled=""');
    expect(comDica(html)).toBe(true);
    expect(html).toContain("Devolver para a IA");
  });

  it("pode: habilitado; em curso, Devolvendo...", () => {
    const html = botao({ tipo: "pode" });
    expect(aberturaDoBotao(html)).not.toContain('disabled=""');
    expect(comDica(html)).toBe(false);
    expect(html).toContain("Devolver para a IA</span>");
    expect(botao({ tipo: "pode" }, true)).toContain("Devolvendo...");
  });
});

describe("confirmação", () => {
  it("título, texto e botões, palavra por palavra", () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <ConfirmacaoDoDevolver
          pendente={false}
          aoConfirmar={() => undefined}
          aoCancelar={() => undefined}
        />
      </Dialog>,
    );
    expect(html).toContain("Devolver para a IA?");
    expect(html).toContain(
      "A IA volta a responder esta conversa a partir da próxima mensagem do contato. O que foi conversado antes não vai para a IA.",
    );
    expect(html).toContain("Cancelar</button>");
    expect(html).toContain("Devolver</button>");
  });

  it("em curso: Devolvendo..., os dois botões presos", () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <ConfirmacaoDoDevolver
          pendente
          aoConfirmar={() => undefined}
          aoCancelar={() => undefined}
        />
      </Dialog>,
    );
    expect(html).toContain("Devolvendo...");
    expect(html.match(/<button[^>]*disabled=""/g) ?? []).toHaveLength(2);
  });

  it("sucesso com o texto do contrato", () => {
    expect(TEXTOS_DO_DEVOLVER.sucesso).toBe("Conversa devolvida para a IA.");
  });
});

describe("no cabeçalho do fio", () => {
  function cabecalho(
    c: ConversationListItem,
    opcoes: {
      iaNaFase?: boolean;
      papel?: Role;
      cache?: LeituraDaElegibilidade;
    } = {},
  ): string {
    const cliente = new QueryClient();
    if (opcoes.cache?.status === "success") {
      cliente.setQueryData(
        [
          ...devolverKeys.daConversa(c.id),
          c.status,
          c.assignee_user_id,
          c.awaiting_reply,
        ],
        opcoes.cache.data,
      );
    }
    return renderToStaticMarkup(
      <QueryClientProvider client={cliente}>
        <TooltipProvider>
          <AcoesDaConversa
            conversation={c}
            clinicId={CLINICA}
            viewerId={EU}
            viewerRole={opcoes.papel ?? "recepcao"}
            authorNames={{}}
            aoIrParaConversa={() => undefined}
            iaNaFase={opcoes.iaNaFase}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
  }

  function botaoDevolver(html: string): string {
    const indice = html.indexOf("Devolver para a IA");
    const inicio = html.lastIndexOf("<button", indice);
    return html.slice(inicio, html.indexOf(">", inicio) + 1);
  }

  it("fora da fase (a salud-care, o e2e): desabilitado com a dica de sempre", () => {
    const html = cabecalho(conversa(), { iaNaFase: false });
    expect(botaoDevolver(html)).toContain('disabled=""');
    expect(html).not.toContain("Conferindo...");
    expect(acoes.elegibilidade).not.toHaveBeenCalled();
  });

  it("na fase, antes da resposta do servidor: Conferindo...", () => {
    const html = cabecalho(conversa(), { iaNaFase: true });
    expect(html).toContain("Conferindo...");
    expect(botaoDevolver(html)).toContain('disabled=""');
  });

  it("na fase, o servidor disse que pode: habilitado", () => {
    const html = cabecalho(conversa(), { iaNaFase: true, cache: PODE });
    expect(botaoDevolver(html)).not.toContain('disabled=""');
  });

  it("na fase, o servidor disse que não: desabilitado", () => {
    const html = cabecalho(conversa({ awaiting_reply: true }), {
      iaNaFase: true,
      cache: naoPode("pergunta_pendente"),
    });
    expect(botaoDevolver(html)).toContain('disabled=""');
  });

  it("na fase, a conferência falhou: Devolver preso e Tentar de novo livre", () => {
    const html = cabecalho(conversa(), {
      iaNaFase: true,
      cache: {
        status: "success",
        data: {
          ok: false,
          error: "Não foi possível conferir agora. Tente de novo.",
        },
      },
    });
    expect(botaoDevolver(html)).toContain('disabled=""');
    const indice = html.indexOf("Tentar de novo</span>");
    expect(indice).toBeGreaterThan(-1);
    const tentar = html.slice(
      html.lastIndexOf("<button", indice),
      html.indexOf(">", html.lastIndexOf("<button", indice)) + 1,
    );
    expect(tentar).not.toContain('disabled=""');
  });

  it("Tentar de novo refaz a consulta no servidor e a resposta nova entra no lugar", async () => {
    const c = conversa();
    const chave = [
      ...devolverKeys.daConversa(c.id),
      c.status,
      c.assignee_user_id,
      c.awaiting_reply,
    ];
    const cliente = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    cliente.setQueryData(chave, {
      ok: false,
      error: "Não foi possível conferir agora. Tente de novo.",
    });
    acoes.elegibilidade.mockReset();
    acoes.elegibilidade.mockResolvedValue({ ok: true, pode: true });
    let capturado: ReturnType<typeof useElegibilidadeDoDevolver> | null = null;
    function Sonda() {
      capturado = useElegibilidadeDoDevolver({
        conversation: c,
        iaNaFase: true,
        podeEditar: true,
        minha: true,
      });
      return null;
    }
    renderToStaticMarkup(
      <QueryClientProvider client={cliente}>
        <Sonda />
      </QueryClientProvider>,
    );
    const lido = capturado as ReturnType<
      typeof useElegibilidadeDoDevolver
    > | null;
    expect(lido?.leitura).toEqual({
      status: "success",
      data: {
        ok: false,
        error: "Não foi possível conferir agora. Tente de novo.",
      },
    });
    lido?.tentarDeNovo();
    await vi.waitFor(() =>
      expect(cliente.getQueryData(chave)).toEqual({ ok: true, pode: true }),
    );
    expect(acoes.elegibilidade).toHaveBeenCalledWith(c.id);
  });

  it("o assistente não responderia agora (T1): desabilitado com a dica, nunca a promessa de resposta", () => {
    for (const [motivo, dica] of [
      [
        "assistente_parado",
        "O assistente está parado agora. Veja em Agente de IA, aba WhatsApp.",
      ],
      [
        "fora_do_horario",
        "Agora está fora do horário escolhido para o assistente.",
      ],
      ["numero_desconectado", "O número desta conversa está desconectado."],
    ] as const) {
      const html = cabecalho(conversa(), {
        iaNaFase: true,
        papel: "admin",
        cache: naoPode(motivo),
      });
      expect(botaoDevolver(html), motivo).toContain('disabled=""');
      expect(html, motivo).not.toContain(TEXTOS_DO_DEVOLVER.dicaQuandoPode);
      expect(estado(naoPode(motivo)), motivo).toEqual({
        tipo: "nao_pode",
        dica,
      });
    }
  });

  it("só na conversa minha: na da IA, sem atendente ou de colega, não aparece", () => {
    for (const c of [
      conversa({ status: "ia_atendendo", assignee_user_id: null }),
      conversa({ status: "aguardando_humano", assignee_user_id: null }),
      conversa({ assignee_user_id: "22222222-2222-4222-8222-222222222222" }),
    ]) {
      expect(cabecalho(c, { iaNaFase: true, cache: PODE })).not.toContain(
        "Devolver para a IA",
      );
    }
  });

  it("nenhum travessão nos textos do Devolver", () => {
    const textos: string[] = Object.values(TEXTOS_DO_DEVOLVER).flatMap(
      (valor): string[] =>
        typeof valor === "string" ? [valor] : Object.values(valor),
    );
    for (const texto of textos) {
      expect(texto).not.toMatch(/[—–]/);
      expect(texto).not.toMatch(/\b(handoff|tenant|opt-in)\b/i);
    }
  });
});
