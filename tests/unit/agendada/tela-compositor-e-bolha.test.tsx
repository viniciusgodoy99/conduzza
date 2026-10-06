import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O compositor importa a Server Action de arquivo; aqui so a renderizacao.
vi.mock("@/app/(app)/atendimento/actions", () => ({
  enviarArquivoAction: vi.fn(),
}));

import {
  agendadaDaMensagem,
  assinaturaDosIds,
  idsQuePodemTerSaidoDeAgendada,
  SEM_AGENDADAS_DO_FIO,
} from "@/components/atendimento/agendadas/da-mensagem";
import { Composer } from "@/components/atendimento/composer";
import { MessageBubble } from "@/components/atendimento/message-bubble";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgendadaDoFio } from "@/lib/domain/mensagem-agendada";
import type {
  ConversationListItem,
  MessageItem,
} from "@/lib/queries/conversations";

// O botao "Agendar mensagem" na barra do compositor (secao 4.1 do desenho),
// o texto da conversa resolvida (secao 4.6) e a linha de autor da bolha que
// saiu de uma agendada (secao 4.5, com a A1 do desenho final). A autoria da
// bolha vem de uma consulta SEPARADA do fio (F11 da revisao): o fio nao
// embute mais a agendada.

const EU = "11111111-1111-4111-8111-111111111111";
const ANA = "22222222-2222-4222-8222-222222222222";
const BRUNO = "33333333-3333-4333-8333-333333333333";

function conversa(
  campos: Partial<ConversationListItem> = {},
): ConversationListItem {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    status: "em_atendimento",
    assignee_user_id: EU,
    unread_count: 0,
    awaiting_reply: false,
    last_message_at: "2026-10-06T12:00:00.000Z",
    last_inbound_at: "2026-10-06T11:00:00.000Z",
    last_preview: "Oi",
    last_preview_kind: "texto",
    last_preview_author: "paciente",
    last_preview_author_user_id: null,
    tags: [],
    whatsapp_account_id: null,
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

const AUTORIZADA = {
  source: "whatsapp",
  granted_at: "2026-09-01T12:00:00.000Z",
  revoked_at: null,
};

function compositor(
  props: Partial<ComponentProps<typeof Composer>> = {},
): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <Composer
          conversation={conversa()}
          viewerId={EU}
          podeEditar
          autorizacao={AUTORIZADA}
          citando={null}
          aoCancelarCitacao={() => undefined}
          aoCancelarCitacaoSeFor={() => undefined}
          authorNames={{}}
          modo="responder"
          aoTrocarModo={() => undefined}
          texto=""
          aoMudarTexto={() => undefined}
          aoEnviarTexto={() => undefined}
          agendamento={{ estado: "pronto", aoAgendar: () => undefined }}
          {...props}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** O botao "Agendar mensagem", ou null. */
function botaoDeAgendar(html: string): string | null {
  const indice = html.indexOf('aria-label="Agendar mensagem"');
  if (indice < 0) {
    return null;
  }
  return html.slice(
    html.lastIndexOf("<button", indice),
    html.indexOf(">", indice) + 1,
  );
}

/** O atributo disabled (e nao a classe disabled:...). */
function desabilitado(botaoHtml: string | null): boolean {
  return botaoHtml !== null && /\sdisabled=""/.test(botaoHtml);
}

/** A barra de botoes (Mensagens padrao, Agendar, anexo) esta escondida? */
function barraEscondida(html: string): boolean {
  const indice = html.indexOf('aria-label="Agendar mensagem"');
  const barra = html.lastIndexOf('class="ml-auto', indice);
  const fim = html.indexOf(">", barra);
  return html.slice(barra, fim).includes("hidden");
}

describe("botao Agendar mensagem no compositor", () => {
  it("em atendimento comigo: botao de icone de 40px, habilitado", () => {
    const html = compositor();
    const botao = botaoDeAgendar(html);
    expect(botao).not.toBeNull();
    expect(botao).toContain('data-size="icon"');
    expect(botao).toContain('aria-haspopup="dialog"');
    expect(desabilitado(botao)).toBe(false);
    expect(html).toContain("lucide-clock-plus");
    expect(barraEscondida(html)).toBe(false);
  });

  it("fica ao lado de Mensagens padrao, antes do anexo", () => {
    const html = compositor({
      mensagensPadrao: {
        estado: "pronto",
        lista: [],
        aoTentarDeNovo: () => undefined,
        podeCadastrar: false,
      },
    });
    const padrao = html.indexOf('aria-label="Mensagens padrão"');
    const agendar = html.indexOf('aria-label="Agendar mensagem"');
    expect(padrao).toBeGreaterThan(-1);
    expect(agendar).toBeGreaterThan(padrao);
  });

  it("na nota interna, some junto com a barra", () => {
    expect(barraEscondida(compositor({ modo: "nota" }))).toBe(true);
  });

  it("com a resposta bloqueada pela autorizacao, some junto com a barra", () => {
    const html = compositor({
      autorizacao: {
        source: "whatsapp",
        granted_at: "2026-09-01T12:00:00.000Z",
        revoked_at: "2026-09-10T12:00:00.000Z",
      },
    });
    expect(barraEscondida(html)).toBe(true);
  });

  it("Somente leitura com a conversa: visivel e desabilitado", () => {
    const botao = botaoDeAgendar(compositor({ podeEditar: false }));
    expect(botao).not.toBeNull();
    expect(desabilitado(botao)).toBe(true);
  });

  it("erro na leitura da lista: visivel e desabilitado", () => {
    const botao = botaoDeAgendar(
      compositor({
        agendamento: { estado: "erro", aoAgendar: () => undefined },
      }),
    );
    expect(botao).not.toBeNull();
    expect(desabilitado(botao)).toBe(true);
  });

  it("carregando a lista: continua habilitado (o servidor confere)", () => {
    const botao = botaoDeAgendar(
      compositor({
        agendamento: { estado: "carregando", aoAgendar: () => undefined },
      }),
    );
    expect(desabilitado(botao)).toBe(false);
  });

  it("sem a prop, nenhum botao (as outras telas nao mudam)", () => {
    expect(botaoDeAgendar(compositor({ agendamento: undefined }))).toBeNull();
  });

  it("conversa de colega, com a IA ou aguardando: so o aviso, sem botao", () => {
    for (const c of [
      conversa({ assignee_user_id: ANA }),
      conversa({ status: "ia_atendendo", assignee_user_id: null }),
      conversa({ status: "aguardando_humano", assignee_user_id: null }),
    ]) {
      expect(botaoDeAgendar(compositor({ conversation: c }))).toBeNull();
    }
  });

  it("a caixa de escrever leva a marca para devolver o foco", () => {
    expect(compositor()).toContain("data-caixa-do-compositor");
  });
});

describe("conversa resolvida (secao 4.6)", () => {
  it("diz que responder ou agendar comeca por Reabrir e responder", () => {
    const html = compositor({
      conversation: conversa({ status: "resolvida" }),
    });
    expect(html).toContain(
      "Para responder ou agendar uma mensagem, use Reabrir e responder, no topo da conversa.",
    );
    expect(html).not.toContain("Para responder de novo");
    expect(botaoDeAgendar(html)).toBeNull();
  });
});

function mensagem(campos: Partial<MessageItem> = {}): MessageItem {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    direction: "saida",
    author: "usuario",
    author_user_id: ANA,
    content_type: "texto",
    body: "Bom dia! Seu retorno é amanhã às 9h.",
    media_url: null,
    transcript: null,
    is_internal_note: false,
    delivery_status: "enviada",
    error_code: null,
    created_at: "2026-10-06T12:00:00.000Z",
    deleted_at: null,
    deleted_by: null,
    deleted_source: null,
    deleted_escopo: null,
    reply_to_message_id: null,
    reply_to_wa_message_id: null,
    reply_to: null,
    ...campos,
  };
}

function bolha(
  message: MessageItem,
  agendada: AgendadaDoFio | null = null,
): string {
  return renderToStaticMarkup(
    <MessageBubble
      message={message}
      authorName="Ana"
      authorNames={{ [ANA]: "Ana", [BRUNO]: "Bruno" }}
      timezone="America/Fortaleza"
      agendada={agendada}
    />,
  );
}

describe("bolha da mensagem que saiu de uma agendada", () => {
  it("ninguem editou: Ana · Mensagem agendada, com o relogio", () => {
    const html = bolha(mensagem(), { criadaPor: ANA, editadaPor: null });
    expect(html).toContain("Ana · Mensagem agendada");
    expect(html).toContain("lucide-clock-fading");
    expect(html).toContain(
      "Mensagem agendada por Ana, enviada sozinha na hora marcada.",
    );
    // A linha de autor comum nao aparece junto.
    expect(html.match(/>Ana</g)).toBeNull();
  });

  it("editada por outra pessoa: assina quem editou (A1)", () => {
    const html = bolha(mensagem({ author_user_id: BRUNO }), {
      criadaPor: ANA,
      editadaPor: BRUNO,
    });
    expect(html).toContain("Bruno · Mensagem agendada (criada por Ana)");
    expect(html).toContain(
      "Mensagem agendada por Ana, editada por Bruno, enviada sozinha na hora marcada.",
    );
  });

  it("sem agendada (ou a consulta do fio falhou): a linha de autor de sempre", () => {
    const html = bolha(mensagem());
    expect(html).not.toContain("Mensagem agendada");
    expect(html).toContain(">Ana</span>");
  });

  it("apagada: sem a linha de autor", () => {
    const html = bolha(
      mensagem({
        deleted_at: "2026-10-06T12:05:00.000Z",
        deleted_by: ANA,
        deleted_source: "clinica",
        deleted_escopo: "todos",
        body: null,
      }),
      { criadaPor: ANA, editadaPor: null },
    );
    expect(html).not.toContain("Mensagem agendada");
  });

  it("do paciente, da IA, nota ou pelo celular: nunca e agendada", () => {
    const agendada = { criadaPor: ANA, editadaPor: null };
    for (const m of [
      mensagem({ direction: "entrada", author: "paciente" }),
      mensagem({ author: "ia", author_user_id: null }),
      mensagem({ is_internal_note: true }),
      mensagem({ pelo_celular: true, author_user_id: null }),
    ]) {
      expect(bolha(m, agendada)).not.toContain("Mensagem agendada");
    }
  });
});

describe("autoria da bolha pela consulta separada do fio (F11)", () => {
  const id = (n: number) => `99999999-9999-4999-8999-99999999999${n}`;

  it("so vao na consulta as respostas da equipe pelo sistema, nao apagadas", () => {
    const ids = idsQuePodemTerSaidoDeAgendada([
      mensagem({ id: id(1) }),
      mensagem({ id: id(2), direction: "entrada", author: "paciente" }),
      mensagem({ id: id(3), author: "ia", author_user_id: null }),
      mensagem({ id: id(4), is_internal_note: true }),
      mensagem({ id: id(5), pelo_celular: true, author_user_id: null }),
      mensagem({ id: id(6), deleted_at: "2026-10-06T12:05:00.000Z" }),
      mensagem({ id: id(7), author: "sistema", author_user_id: null }),
      mensagem({ id: id(8) }),
    ]);
    expect(ids).toEqual([id(1), id(8)]);
  });

  it("a assinatura muda com mensagem nova e com pagina antiga, e e curta", () => {
    const base = [id(2), id(3)];
    expect(assinaturaDosIds([])).toBe("0");
    expect(assinaturaDosIds(base)).toBe(`2:${id(2)}:${id(3)}`);
    // Mensagem nova no fim, pagina antiga no comeco: chave nova.
    expect(assinaturaDosIds([...base, id(4)])).not.toBe(assinaturaDosIds(base));
    expect(assinaturaDosIds([id(1), ...base])).not.toBe(assinaturaDosIds(base));
  });

  it("a agendada da mensagem pelo mapa; vazio, ausente e prototipo dao null", () => {
    const mapa = { [id(1)]: { criadaPor: ANA, editadaPor: BRUNO } };
    expect(agendadaDaMensagem(mapa, id(1))).toEqual({
      criadaPor: ANA,
      editadaPor: BRUNO,
    });
    expect(agendadaDaMensagem(mapa, id(2))).toBeNull();
    expect(agendadaDaMensagem(SEM_AGENDADAS_DO_FIO, id(1))).toBeNull();
    expect(agendadaDaMensagem(mapa, "constructor")).toBeNull();
  });
});
