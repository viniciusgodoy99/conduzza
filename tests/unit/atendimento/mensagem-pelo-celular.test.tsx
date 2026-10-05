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

import { autorDaCitacao } from "@/components/atendimento/citacao";
import {
  MessageBubble,
  motivoParaNaoApagar,
} from "@/components/atendimento/message-bubble";
import {
  AUTOR_PELO_CELULAR,
  EXPLICACAO_PELO_CELULAR,
} from "@/components/atendimento/pelo-celular";
import { autorDaBolha } from "@/components/atendimento/thread";
import { nomeParaBaixar } from "@/lib/domain/midia-recebida";
import type { MessageItem, QuotedMessage } from "@/lib/queries/conversations";

// Mensagem enviada direto pelo WhatsApp do numero conectado (celular,
// WhatsApp Web), fora do sistema (05/10/2026). O webhook grava como saida sem
// pessoa: author 'usuario' quando foi gente da clinica, 'sistema' quando foi
// a resposta automatica do app WhatsApp Business. Nos dois casos a bolha fica
// na pele da atendente e assina "Pelo WhatsApp" com o icone do aparelho, e o
// leitor de tela ouve a frase inteira: lado, pele, icone e texto.

const ANA = "22222222-2222-4222-8222-222222222222";
const NOMES = { [ANA]: "Ana Recepção" };

function mensagem(campos: Partial<MessageItem> = {}): MessageItem {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    direction: "saida",
    author: "usuario",
    author_user_id: null,
    content_type: "texto",
    body: "Pode vir amanhã às 9h.",
    media_url: null,
    transcript: null,
    is_internal_note: false,
    delivery_status: "enviada",
    error_code: null,
    created_at: "2026-10-05T13:00:00.000Z",
    deleted_at: null,
    deleted_by: null,
    deleted_source: null,
    deleted_escopo: null,
    reply_to_message_id: null,
    reply_to_wa_message_id: null,
    reply_to: null,
    pelo_celular: true,
    ...campos,
  };
}

function bolha(
  message: MessageItem,
  extra: Partial<Parameters<typeof MessageBubble>[0]> = {},
): string {
  return renderToStaticMarkup(
    <MessageBubble
      message={message}
      authorName={autorDaBolha(message, NOMES)}
      authorNames={NOMES}
      {...extra}
    />,
  );
}

/** O que vem antes da bolha: a linha de autor. */
function linhaDeAutor(html: string): string {
  return html.slice(0, html.indexOf("data-bolha"));
}

describe("autor da bolha", () => {
  it("pessoa da clínica pelo celular (sem author_user_id) assina Pelo WhatsApp", () => {
    expect(autorDaBolha(mensagem(), NOMES)).toBe(AUTOR_PELO_CELULAR);
    expect(AUTOR_PELO_CELULAR).toBe("Pelo WhatsApp");
  });

  it("resposta automática do app (author sistema) também assina Pelo WhatsApp", () => {
    expect(autorDaBolha(mensagem({ author: "sistema" }), NOMES)).toBe(
      "Pelo WhatsApp",
    );
  });

  it("sem pelo_celular nada muda: régua sem linha, pessoa pelo nome", () => {
    expect(
      autorDaBolha(
        mensagem({ author: "sistema", pelo_celular: undefined }),
        NOMES,
      ),
    ).toBeNull();
    expect(
      autorDaBolha(mensagem({ author: "sistema", pelo_celular: false }), NOMES),
    ).toBeNull();
    expect(
      autorDaBolha(
        mensagem({ author_user_id: ANA, pelo_celular: false }),
        NOMES,
      ),
    ).toBe("Ana Recepção");
  });
});

describe("bolha da mensagem enviada pelo celular", () => {
  it.each([
    ["pessoa da clínica", "usuario"],
    ["resposta automática do app", "sistema"],
  ] as const)(
    "%s: Pelo WhatsApp com o ícone do aparelho, na linha de autor",
    (_caso, author) => {
      const html = bolha(mensagem({ author }));
      const linha = linhaDeAutor(html);
      expect(linha).toContain("Pelo WhatsApp");
      // O icone (svg do Smartphone) dentro da linha de autor, nao so a cor.
      expect(linha).toMatch(/<svg[^>]*lucide-smartphone/);
      // O leitor de tela ouve a frase inteira; o mouse ve a mesma no title.
      expect(linha).toContain(
        `<span class="sr-only">${EXPLICACAO_PELO_CELULAR}</span>`,
      );
      expect(linha).toContain(`title="${EXPLICACAO_PELO_CELULAR}"`);
      expect(EXPLICACAO_PELO_CELULAR).toBe(
        "Enviada direto pelo WhatsApp da clínica, fora do sistema",
      );
      // Mesma receita da linha de autor, sem caixa alta.
      expect(linha).toContain("text-[11px] font-semibold text-text-secondary");
      expect(linha).not.toContain("uppercase");
    },
  );

  it("fica à direita, na pele da atendente", () => {
    const html = bolha(mensagem());
    expect(html).toContain("justify-end");
    expect(html).toMatch(/data-bolha[^>]*bg-bubble-out/);
  });

  it("o rótulo visível não é lido duas vezes", () => {
    const linha = linhaDeAutor(bolha(mensagem()));
    expect(linha).toMatch(/<span aria-hidden="true"[^>]*>.*Pelo WhatsApp/);
  });

  it("apagada perde a linha de autor, como as outras", () => {
    const html = bolha(
      mensagem({
        deleted_at: "2026-10-05T13:05:00.000Z",
        deleted_escopo: "todos",
        deleted_source: "clinica",
        body: null,
      }),
    );
    expect(html).not.toContain("Pelo WhatsApp");
    expect(html).toContain("A clínica apagou esta mensagem.");
  });

  it("sem pelo_celular nada muda", () => {
    const daPessoa = bolha(
      mensagem({ author_user_id: ANA, pelo_celular: false }),
    );
    expect(daPessoa).toContain("Ana Recepção");
    expect(daPessoa).not.toContain("Pelo WhatsApp");
    expect(daPessoa).not.toContain("lucide-smartphone");

    const daRegua = bolha(
      mensagem({ author: "sistema", pelo_celular: undefined }),
    );
    expect(linhaDeAutor(daRegua)).not.toContain("<span");
    expect(daRegua).not.toContain("Pelo WhatsApp");
  });

  it("nota interna nunca vira Pelo WhatsApp (o banco nem aceita a marca nela)", () => {
    const html = bolha(
      mensagem({ is_internal_note: true, author_user_id: ANA }),
    );
    expect(html).toContain("Nota interna, o paciente não vê");
    expect(html).not.toContain("Pelo WhatsApp");
  });
});

describe("arquivo enviado pelo celular que ainda está baixando", () => {
  // A URL do provedor (ainda nao foi para o acervo) e a mensagem de agora:
  // dentro da janela de download.
  const agora = () => new Date().toISOString();

  it.each([
    ["imagem", null, "Foto enviada", "Foto recebida"],
    ["documento", "application/pdf", "Documento enviado", "Documento recebido"],
    ["texto", "video/mp4", "Vídeo enviado", "Vídeo recebido"],
  ] as const)(
    "%s diz enviada, nunca recebida",
    (contentType, mimetype, enviado, recebido) => {
      const campos = {
        content_type: contentType,
        media_url: "https://mmg.whatsapp.net/arquivo.enc",
        media_mimetype: mimetype,
        body: null,
        created_at: agora(),
      } satisfies Partial<MessageItem>;
      const daClinica = bolha(mensagem(campos));
      expect(daClinica).toContain(enviado);
      expect(daClinica).not.toContain(recebido);
      expect(daClinica).toContain("Baixando o arquivo");

      // O do paciente continua "recebido".
      const doPaciente = bolha(
        mensagem({
          ...campos,
          direction: "entrada",
          author: "paciente",
          pelo_celular: false,
        }),
      );
      expect(doPaciente).toContain(recebido);
    },
  );

  it("áudio diz Áudio enviado", () => {
    const html = bolha(
      mensagem({
        content_type: "audio",
        media_url: "https://mmg.whatsapp.net/audio.enc",
        body: null,
        created_at: agora(),
      }),
    );
    expect(html).toContain("Áudio enviado");
    expect(html).not.toContain("Áudio recebido");
  });
});

describe("dica do Apagar desabilitado", () => {
  it("pelo celular: sem pessoa no sistema, só a chefia apaga", () => {
    expect(motivoParaNaoApagar(mensagem())).toBe(
      "Mensagem enviada direto pelo WhatsApp da clínica: só um administrador ou gestor pode apagar.",
    );
  });

  it("as outras continuam com a dica de sempre", () => {
    expect(motivoParaNaoApagar(mensagem({ pelo_celular: false }))).toBe(
      "Só quem escreveu a mensagem pode apagar. Um administrador ou gestor também pode.",
    );
    expect(motivoParaNaoApagar(mensagem({ pelo_celular: undefined }))).toBe(
      "Só quem escreveu a mensagem pode apagar. Um administrador ou gestor também pode.",
    );
  });
});

describe("citação de uma mensagem enviada pelo celular", () => {
  function citada(campos: Partial<QuotedMessage> = {}): QuotedMessage {
    return {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      author: "usuario",
      author_user_id: null,
      content_type: "texto",
      body: "Pode vir amanhã às 9h.",
      is_internal_note: false,
      deleted_at: null,
      pelo_celular: true,
      ...campos,
    };
  }

  it("assina Pelo WhatsApp, e não Sistema", () => {
    expect(autorDaCitacao(citada(), "Paciente", NOMES)).toBe("Pelo WhatsApp");
    expect(
      autorDaCitacao(citada({ author: "sistema" }), "Paciente", NOMES),
    ).toBe("Pelo WhatsApp");
  });

  it("sem pelo_celular nada muda", () => {
    expect(
      autorDaCitacao(
        citada({ author: "sistema", pelo_celular: undefined }),
        "Paciente",
        NOMES,
      ),
    ).toBe("Sistema");
    expect(
      autorDaCitacao(
        citada({ author_user_id: ANA, pelo_celular: false }),
        "Paciente",
        NOMES,
      ),
    ).toBe("Ana Recepção");
  });

  it("dentro da bolha que responde a ela", () => {
    const html = bolha(
      mensagem({
        direction: "entrada",
        author: "paciente",
        pelo_celular: false,
        body: "Combinado!",
        reply_to_message_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        reply_to: citada(),
      }),
    );
    expect(html).toContain("Pelo WhatsApp");
    expect(html).not.toContain("Sistema");
  });
});

describe("nome do download do documento enviado pelo celular", () => {
  it("sem tipo, não ganha .pdf: o celular manda qualquer arquivo", () => {
    expect(
      nomeParaBaixar({
        content_type: "documento",
        body: null,
        direction: "saida",
        pelo_celular: true,
      }),
    ).toBe("conduzza-documento");
    expect(
      nomeParaBaixar({
        content_type: "documento",
        body: null,
        media_filename: "planilha de horarios",
        direction: "saida",
        pelo_celular: true,
      }),
    ).toBe("planilha de horarios");
  });

  it("com o tipo real, a extensão dele", () => {
    expect(
      nomeParaBaixar({
        content_type: "documento",
        body: null,
        media_mimetype:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        direction: "saida",
        pelo_celular: true,
      }),
    ).toMatch(/^conduzza-documento\.xlsx$/);
  });

  it("o PDF enviado pelo sistema continua .pdf", () => {
    expect(
      nomeParaBaixar({
        content_type: "documento",
        body: null,
        direction: "saida",
      }),
    ).toBe("conduzza-documento.pdf");
    expect(
      nomeParaBaixar({
        content_type: "documento",
        body: null,
        direction: "saida",
        pelo_celular: false,
      }),
    ).toBe("conduzza-documento.pdf");
  });
});
