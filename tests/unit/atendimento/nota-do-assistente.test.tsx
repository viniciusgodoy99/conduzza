import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O fio importa as acoes do cabecalho (Server Actions); aqui so o rotulo e a
// bolha importam.
vi.mock("@/app/(app)/atendimento/actions", () => ({
  assumirConversaAction: vi.fn(),
  reabrirConversaAction: vi.fn(),
  resolverConversaAction: vi.fn(),
  transferirConversaAction: vi.fn(),
}));

import { autorDaCitacao } from "@/components/atendimento/citacao";
import { MessageBubble } from "@/components/atendimento/message-bubble";
import {
  AUTOR_DA_AUTOMACAO,
  autorDaBolha,
} from "@/components/atendimento/thread";
import {
  dadosVazios,
  estadoVazio,
  notaDaPassagem,
} from "@/lib/agente/atendimento";
import {
  AUTOR_DA_NOTA_DA_PASSAGEM,
  CABECALHO_DA_NOTA_DA_PASSAGEM,
  ehNotaDaPassagemDaIa,
} from "@/lib/agente/nota-da-passagem";
import type { MessageItem } from "@/lib/queries/conversations";

// D-20 (decisao do dono, 27/10/2026): a nota interna que a IA deixa ao
// passar a conversa para a equipe aparecia assinada "Automação" (ela e
// gravada como a nota de automacao: author 'sistema', is_internal_note, sem
// pessoa). Agora assina "Assistente", com a autoria da IA (o brilho e o selo
// "IA") e, como toda nota, o cadeado e "Nota interna, o paciente não vê".
// Sem mudar o banco: a nota da IA se reconhece pelo cabecalho fixo.

const TRAVESSAO = /[\u2013\u2014]/;

/** A nota que o turno monta de verdade (so do estado e do Cadastro). */
const NOTA_DA_IA =
  notaDaPassagem({
    estado: { ...estadoVazio(), intencao: "agendar" },
    dados: dadosVazios(["nome_completo", "data_nascimento"]),
    procedimento: "Consulta",
    profissional: "Dra. Ana Lima",
    pagamento: "particular",
    unidade: "Centro",
    preferencia: { periodo: "tarde", hora: null },
    reserva: null,
    oferecidos: [],
    parouEm: "o paciente descreveu um sintoma",
  }) ?? "";

function mensagem(campos: Partial<MessageItem> = {}): MessageItem {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    direction: "saida",
    author: "sistema",
    author_user_id: null,
    content_type: "texto",
    body: NOTA_DA_IA,
    media_url: null,
    transcript: null,
    is_internal_note: true,
    delivery_status: null,
    error_code: null,
    created_at: "2026-10-27T13:00:00.000Z",
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

describe("D-20: a nota da passagem é do assistente", () => {
  it("a nota que o turno monta começa pelo cabeçalho que o Atendimento reconhece", () => {
    expect(NOTA_DA_IA.startsWith(`${CABECALHO_DA_NOTA_DA_PASSAGEM}\n`)).toBe(true);
    expect(ehNotaDaPassagemDaIa(mensagem())).toBe(true);
  });

  it("assina Assistente, e a nota da automação continua Automação", () => {
    expect(autorDaBolha(mensagem(), {})).toBe(AUTOR_DA_NOTA_DA_PASSAGEM);
    expect(AUTOR_DA_NOTA_DA_PASSAGEM).toBe("Assistente");
    expect(
      autorDaBolha(mensagem({ body: "Lead entrou em Avaliação marcada." }), {}),
    ).toBe(AUTOR_DA_AUTOMACAO);
  });

  it("só a nota do sistema, sem pessoa, em texto e com o cabeçalho no começo", () => {
    // Uma pessoa que escreve o mesmo texto assina pelo nome dela.
    const ANA = "22222222-2222-4222-8222-222222222222";
    expect(
      autorDaBolha(
        mensagem({ author: "usuario", author_user_id: ANA }),
        { [ANA]: "Ana Recepção" },
      ),
    ).toBe("Ana Recepção");
    const variacoes: Partial<MessageItem>[] = [
      { is_internal_note: false },
      { author: "usuario" },
      { author_user_id: ANA },
      { content_type: "imagem" },
      { direction: "entrada" },
      { body: `Obs.: ${NOTA_DA_IA}` },
      { body: `${CABECALHO_DA_NOTA_DA_PASSAGEM} e mais nada na mesma linha` },
      { body: null },
    ];
    for (const campos of variacoes) {
      expect(ehNotaDaPassagemDaIa(mensagem(campos)), JSON.stringify(campos)).toBe(
        false,
      );
    }
    expect(ehNotaDaPassagemDaIa(mensagem({ body: CABECALHO_DA_NOTA_DA_PASSAGEM }))).toBe(
      true,
    );
  });

  it("a citação da nota também diz Assistente", () => {
    expect(autorDaCitacao(mensagem(), "Paciente", {})).toBe("Assistente");
    expect(
      autorDaCitacao(mensagem({ body: "Lead entrou em Avaliação marcada." }), "Paciente", {}),
    ).toBe("Sistema");
  });
});

describe("D-20: a bolha da nota da passagem", () => {
  const html = renderToStaticMarkup(
    <MessageBubble message={mensagem()} authorName={autorDaBolha(mensagem(), {})} />,
  );
  const linha = html.slice(0, html.indexOf("data-bolha"));

  it("a linha de autoria da IA: o brilho, Assistente e o selo IA", () => {
    expect(linha).toContain("data-nota-da-ia");
    expect(linha).toMatch(/lucide-sparkles/);
    expect(linha).toContain("Assistente");
    expect(linha).toMatch(/bg-ai-bg[^>]*>\s*IA\s*</);
    expect(html).not.toContain("Automação");
  });

  it("e a da nota: o cadeado, o texto e a cor (nunca só a cor), na pele da nota", () => {
    expect(linha).toMatch(/text-warning-text[^>]*>.*lucide-lock/);
    expect(linha).toContain("Nota interna, o paciente não vê");
    expect(html).toContain("bg-warning-bg");
    // Uma linha de autoria so, nao duas.
    expect(linha.match(/Nota interna, o paciente não vê/g)).toHaveLength(1);
  });

  it("o corpo aparece inteiro, sem travessão", () => {
    expect(html).toContain(CABECALHO_DA_NOTA_DA_PASSAGEM);
    expect(NOTA_DA_IA).not.toMatch(TRAVESSAO);
    expect(linha).not.toMatch(TRAVESSAO);
  });

  it("a nota da automação continua com a linha de antes", () => {
    const automacao = mensagem({ body: "Lead entrou em Avaliação marcada." });
    const outra = renderToStaticMarkup(
      <MessageBubble message={automacao} authorName={autorDaBolha(automacao, {})} />,
    );
    const linhaDaAutomacao = outra.slice(0, outra.indexOf("data-bolha"));
    expect(linhaDaAutomacao).toContain("Automação");
    expect(linhaDaAutomacao).not.toContain("data-nota-da-ia");
    expect(linhaDaAutomacao).not.toMatch(/lucide-sparkles/);
  });
});
