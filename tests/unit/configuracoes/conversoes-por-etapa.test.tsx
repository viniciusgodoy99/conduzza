import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/configuracoes/actions", () => ({
  salvarConversoesDasEtapasAction: vi.fn(),
}));

import { ConversoesPorEtapa } from "@/components/configuracoes/conversoes-por-etapa";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { EtapaDaJornada } from "@/lib/domain/jornada";

// Passo "Conversoes por etapa" de Anuncios e rastreio (pedido do dono em
// 24/11/2026). O projeto nao tem jsdom: a tela e lida pelo HTML.

function etapa(
  chave: string,
  nome: string,
  papel: EtapaDaJornada["papel"],
  campos: Partial<EtapaDaJornada> = {},
): EtapaDaJornada {
  return {
    id: `id-${chave}`,
    chave,
    nome,
    posicao: 10,
    tom: "neutral",
    icone: "circle",
    papel,
    descricao: null,
    termos_chave: [],
    termos_de_quem: "paciente",
    meta_event_name: null,
    conversao_ativa: true,
    is_sale: false,
    is_first_contact: false,
    value_source: null,
    value_cents: null,
    ...campos,
  };
}

const JORNADA: EtapaDaJornada[] = [
  etapa("novo", "Novo", "entrada"),
  etapa("em_contato", "Contato inicial", "em_contato"),
  etapa("agendou", "Agendou", "agendou"),
  etapa("compareceu", "Compareceu", "compareceu"),
  etapa("perdido", "Perdido", "perdido"),
  etapa("comprou_homecare", "Comprou HomeCare", null),
];

const DICA = "Somente administradores e gestores alteram as configurações";

function tela(
  jornada: EtapaDaJornada[] | null = JORNADA,
  podeGerenciar = true,
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ConversoesPorEtapa
        jornada={jornada}
        podeGerenciar={podeGerenciar}
        dica={DICA}
      />
    </TooltipProvider>,
  );
}

const texto = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("ConversoesPorEtapa", () => {
  it("uma linha por etapa, menos Perdido, cada uma com o campo do evento rotulado", () => {
    const html = tela();
    for (const chave of ["novo", "em_contato", "agendou", "compareceu", "comprou_homecare"]) {
      expect(html).toContain(`id="conversao-${chave}-evento"`);
      expect(html).toContain(`for="conversao-${chave}-evento"`);
    }
    expect(html).not.toContain('id="conversao-perdido-evento"');
    expect(texto(html)).toContain("Perdido nunca vira conversão.");
    // Sem evento, nao ha valor a escolher.
    expect(html).not.toContain('id="conversao-novo-valor"');
  });

  it("oferece o recomendado com os nomes da clínica, sem o parágrafo de explicação", () => {
    const visivel = texto(tela());
    // 26/11/2026: a descricao do cartao saiu (tela que mostra e nao explica).
    expect(visivel).not.toContain("aprende quem são as pessoas");
    expect(visivel).toContain(
      "Recomendado para começar: Novo interessado (Lead) em Novo, Agendamento (Schedule) em Agendou e Compra (Purchase) em Compareceu, com o preço da consulta.",
    );
    expect(visivel).toContain("Usar o recomendado");
    expect(visivel).toContain("passo 4");
  });

  it("etapa que já envia mostra quando usar o evento e o campo do valor", () => {
    const html = tela([
      etapa("compareceu", "Compareceu", "compareceu", {
        meta_event_name: "Purchase",
        value_source: "service_link",
      }),
    ]);
    expect(texto(html)).toContain("A pessoa virou paciente ou pagou.");
    expect(html).toContain('id="conversao-compareceu-valor"');
    expect(html).toContain('aria-describedby="conversao-compareceu-quando"');
  });

  it("com o recomendado todo feito, o botão fica desabilitado com a dica", () => {
    const html = tela([
      etapa("novo", "Novo", "entrada", { meta_event_name: "Contact" }),
      etapa("agendou", "Agendou", "agendou", { meta_event_name: "Schedule" }),
      etapa("compareceu", "Compareceu", "compareceu", { meta_event_name: "Purchase" }),
    ]);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*Usar o recomendado/);
  });

  it("embaixo do evento diz como ele vai no anúncio do WhatsApp, e alerta o que a Meta não aceita lá", () => {
    const html = tela([
      etapa("novo", "Novo", "entrada", { meta_event_name: "Lead" }),
      etapa("em_contato", "Em contato", "em_contato", { meta_event_name: "Contact" }),
      etapa("compareceu", "Compareceu", "compareceu", { meta_event_name: "Purchase" }),
    ]);
    const visivel = texto(html);
    expect(visivel).toContain("vai como LeadSubmitted");
    expect(visivel).toContain(
      "A Meta não aceita este evento no anúncio que abre o WhatsApp",
    );
    expect(html).toContain(
      'aria-describedby="conversao-novo-quando conversao-novo-whatsapp"',
    );
    // Compra tem o mesmo nome la: sem nota.
    expect(html).not.toContain('id="conversao-compareceu-whatsapp"');
  });

  it("conversão pausada aparece pausada, em três camadas", () => {
    const html = tela([
      etapa("agendou", "Agendou", "agendou", {
        meta_event_name: "Schedule",
        conversao_ativa: false,
      }),
    ]);
    expect(texto(html)).toContain("Conversão pausada");
  });

  it("sem mudança, Salvar fica desabilitado; sem permissão, os campos também", () => {
    expect(tela()).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*Salvar conversões/);
    const semPermissao = tela(JORNADA, false);
    expect(semPermissao).toMatch(
      /<button[^>]*id="conversao-novo-evento"[^>]*disabled=""|<button[^>]*disabled=""[^>]*id="conversao-novo-evento"/,
    );
  });

  it("leitura da jornada que falhou: avisa, sem quebrar a aba", () => {
    expect(texto(tela(null))).toContain(
      "Não foi possível carregar as etapas da jornada",
    );
  });

  it("nenhum travessão e nenhuma cor solta", () => {
    for (const html of [tela(), tela(JORNADA, false), tela(null)]) {
      expect(html).not.toMatch(/[–—]/);
      expect(html).not.toMatch(/(?:text|bg|border)-\[#/);
    }
  });
});
