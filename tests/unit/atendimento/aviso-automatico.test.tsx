import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O fio importa as acoes do cabecalho (Server Actions); aqui so o rotulo, a
// bolha e a citacao importam.
vi.mock("@/app/(app)/atendimento/actions", () => ({
  assumirConversaAction: vi.fn(),
  reabrirConversaAction: vi.fn(),
  resolverConversaAction: vi.fn(),
  transferirConversaAction: vi.fn(),
}));

import {
  AUTOR_DO_AVISO_AUTOMATICO,
  ehAvisoAutomaticoDaIa,
  EXPLICACAO_DO_AVISO_AUTOMATICO,
} from "@/components/atendimento/aviso-automatico";
import { autorDaCitacao } from "@/components/atendimento/citacao";
import {
  MessageBubble,
  PELES_DA_BOLHA,
} from "@/components/atendimento/message-bubble";
import { autorDaBolha } from "@/components/atendimento/thread";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import type { MessageItem, QuotedMessage } from "@/lib/queries/conversations";

// A frase fixa que o contato recebe quando a IA passa a conversa para a
// equipe (revisao de producao de 19/10/2026, operacao.md 14): autor
// 'sistema', pela linha do job da IA, com o corpo sempre igual a
// FRASE_DE_ESCALONAMENTO. No fio ela aparecia na pele da atendente e sem
// linha de autor (parecia fala de alguem da equipe). Agora: mensagem
// automatica do sistema, com pele neutra propria, a linha "Aviso
// automático" com o UsersRound neutro e a explicacao para o leitor de tela.
// A mensagem automatica da regua (outro corpo) continua como antes.

const NOMES = {};

function mensagem(campos: Partial<MessageItem> = {}): MessageItem {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    direction: "saida",
    author: "sistema",
    author_user_id: null,
    content_type: "texto",
    body: FRASE_DE_ESCALONAMENTO,
    media_url: null,
    transcript: null,
    is_internal_note: false,
    delivery_status: "entregue",
    error_code: null,
    created_at: "2026-10-19T13:00:00.000Z",
    deleted_at: null,
    deleted_by: null,
    deleted_source: null,
    deleted_escopo: null,
    reply_to_message_id: null,
    reply_to_wa_message_id: null,
    reply_to: null,
    pelo_celular: false,
    ...campos,
  };
}

function bolha(message: MessageItem): string {
  return renderToStaticMarkup(
    <MessageBubble
      message={message}
      authorName={autorDaBolha(message, NOMES)}
      authorNames={NOMES}
    />,
  );
}

/** O que vem antes da bolha: a linha de autor. */
function linhaDeAutor(html: string): string {
  return html.slice(0, html.indexOf("data-bolha"));
}

/** As classes da bolha (a div com data-bolha). */
function classesDaBolha(html: string): string {
  const inicio = html.lastIndexOf("<div", html.indexOf("data-bolha"));
  return html.slice(inicio, html.indexOf(">", inicio));
}

describe("a frase fixa da IA é uma mensagem automática do sistema", () => {
  it("reconhece a frase: saída do sistema, texto, com o corpo exato", () => {
    expect(ehAvisoAutomaticoDaIa(mensagem())).toBe(true);
    // com o job da IA, quando o fio trouxer o job_id
    expect(ehAvisoAutomaticoDaIa({ ...mensagem(), job_id: "j-1" })).toBe(true);
  });

  it("não confunde: outro autor, nota, pelo celular, entrada, outro corpo ou sem job", () => {
    for (const campos of [
      { author: "usuario" },
      { author: "ia" },
      { is_internal_note: true },
      { pelo_celular: true },
      { direction: "entrada", author: "paciente" },
      { body: "Lembrete: sua consulta é amanhã às 9h." },
      { body: `${FRASE_DE_ESCALONAMENTO} ` },
      { body: null },
      { content_type: "evento" },
    ] as const satisfies readonly Partial<MessageItem>[]) {
      expect(ehAvisoAutomaticoDaIa(mensagem(campos)), JSON.stringify(campos)).toBe(
        false,
      );
    }
    expect(ehAvisoAutomaticoDaIa({ ...mensagem(), job_id: null })).toBe(false);
  });

  it("a linha de autor: Aviso automático com o UsersRound, a explicação no title e no leitor de tela", () => {
    expect(autorDaBolha(mensagem(), NOMES)).toBe("Aviso automático");
    const html = bolha(mensagem());
    const linha = linhaDeAutor(html);
    expect(linha).toContain("data-aviso-automatico");
    expect(linha).toContain(AUTOR_DO_AVISO_AUTOMATICO);
    expect(linha).toContain("lucide-users-round");
    expect(linha).toContain(`title="${EXPLICACAO_DO_AVISO_AUTOMATICO}"`);
    expect(linha).toContain(
      `<span class="sr-only">Aviso automático: ${EXPLICACAO_DO_AVISO_AUTOMATICO}</span>`,
    );
    // uma linha so: nem o selo da IA, nem a linha generica
    expect(linha).not.toContain(">IA<");
    expect(linha.match(/Aviso automático/g)).toHaveLength(2);
    expect(EXPLICACAO_DO_AVISO_AUTOMATICO).toBe(
      "Mensagem automática enviada ao contato quando a IA passa a conversa para a equipe.",
    );
  });

  it("a pele própria (neutra, a superfície do evento), nunca a da atendente nem a da IA", () => {
    const html = bolha(mensagem());
    const classes = classesDaBolha(html);
    expect(classes).toContain("bg-surface-4");
    expect(classes).not.toContain("bg-bubble-out");
    expect(classes).not.toContain("bg-bubble-ai");
    expect(PELES_DA_BOLHA.aviso).toContain("bg-surface-4");
    // do lado da clinica, com o tique de entrega
    expect(html).toContain("justify-end");
    expect(html).toContain('data-tique="entregue"');
    expect(html).toContain(FRASE_DE_ESCALONAMENTO);
  });

  it("a mensagem automática da régua (outro corpo) continua como antes: pele da atendente, sem linha", () => {
    const regua = mensagem({ body: "Lembrete: sua consulta é amanhã às 9h." });
    expect(autorDaBolha(regua, NOMES)).toBeNull();
    const html = bolha(regua);
    expect(classesDaBolha(html)).toContain("bg-bubble-out");
    expect(linhaDeAutor(html)).not.toContain("Aviso automático");
  });

  it("a resposta da pessoa da equipe com o mesmo texto continua dela", () => {
    const ANA = "22222222-2222-4222-8222-222222222222";
    const daAna = mensagem({ author: "usuario", author_user_id: ANA });
    expect(autorDaBolha(daAna, { [ANA]: "Ana Recepção" })).toBe("Ana Recepção");
    const html = renderToStaticMarkup(
      <MessageBubble
        message={daAna}
        authorName="Ana Recepção"
        authorNames={{ [ANA]: "Ana Recepção" }}
      />,
    );
    expect(classesDaBolha(html)).toContain("bg-bubble-out");
    expect(html).not.toContain("Aviso automático");
  });

  it("apagada: a lápide, sem a linha do aviso", () => {
    const html = bolha(
      mensagem({ deleted_at: "2026-10-19T13:05:00.000Z", body: null }),
    );
    expect(html).not.toContain("data-aviso-automatico");
  });

  it("citada: assina Aviso automático, não Sistema; a régua continua Sistema", () => {
    const citada = (campos: Partial<QuotedMessage> = {}): QuotedMessage => ({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      author: "sistema",
      author_user_id: null,
      content_type: "texto",
      body: FRASE_DE_ESCALONAMENTO,
      is_internal_note: false,
      deleted_at: null,
      pelo_celular: false,
      ...campos,
    });
    expect(autorDaCitacao(citada(), "Paciente", NOMES)).toBe("Aviso automático");
    expect(
      autorDaCitacao(citada({ body: "Lembrete da régua" }), "Paciente", NOMES),
    ).toBe("Sistema");
  });

  it("nenhum travessão nos textos novos", () => {
    for (const texto of [
      AUTOR_DO_AVISO_AUTOMATICO,
      EXPLICACAO_DO_AVISO_AUTOMATICO,
    ]) {
      expect(texto).not.toMatch(/[—–]/);
    }
  });
});
