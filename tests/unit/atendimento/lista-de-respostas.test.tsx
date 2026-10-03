import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O compositor importa as Server Actions do Atendimento (enviar arquivo); aqui
// so a renderizacao importa.
vi.mock("@/app/(app)/atendimento/actions", () => ({
  enviarArquivoAction: vi.fn(),
}));

import {
  Composer,
  type MensagensPadraoDoCompositor,
} from "@/components/atendimento/composer";
import {
  DICA_SEM_CADASTRO,
  idsDaLista,
  ListaDeRespostas,
  type ItemDaLista,
} from "@/components/atendimento/lista-de-respostas";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RespostaRapida } from "@/lib/domain/respostas-rapidas";
import type { ConversationListItem } from "@/lib/queries/conversations";

// Marcacao da lista de mensagens padrao ("/" no compositor) e dos atributos
// que o compositor poe no campo. O teclado (setas, Enter, Esc) e o clique
// ficam no e2e tests/e2e/mensagens-padrao.spec.ts: aqui nao ha navegador.

const EU = "11111111-1111-4111-8111-111111111111";

function resposta(campos: Partial<RespostaRapida> = {}): RespostaRapida {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    atalho: "conf",
    titulo: "Confirmação",
    corpo: "Olá, {{nome}}! Confirmado.",
    ativo: true,
    posicao: 10,
    ...campos,
  };
}

const ITENS: ItemDaLista[] = [
  { resposta: resposta(), previa: "Olá, Maria Teste! Confirmado." },
  {
    resposta: resposta({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      atalho: "endereco",
      titulo: "Endereço",
      corpo: "Rua A, 10.",
      posicao: 20,
    }),
    previa: "Rua A, 10.",
  },
];

function lista(
  props: Partial<React.ComponentProps<typeof ListaDeRespostas>> = {},
) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ListaDeRespostas
        base="r1"
        estado="pronto"
        itens={ITENS}
        ativo={1}
        cadastradas={2}
        podeCadastrar
        contatoSemNome={false}
        aoEscolher={() => undefined}
        aoApontar={() => undefined}
        aoTentarDeNovo={() => undefined}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("lista de mensagens padrão", () => {
  it("listbox com opções, ids derivados da base e aria-selected na ativa", () => {
    const html = lista();
    const ids = idsDaLista("r1");
    expect(html).toContain(`id="${ids.painel}"`);
    expect(html).toContain(`id="${ids.lista}"`);
    expect(html).toMatch(
      /<ul[^>]*role="listbox"[^>]*aria-label="Mensagens padrão"/,
    );
    expect(html.match(/role="option"/g)).toHaveLength(2);
    expect(html).toMatch(
      new RegExp(`<li[^>]*id="${ids.opcao(0)}"[^>]*aria-selected="false"`),
    );
    expect(html).toMatch(
      new RegExp(`<li[^>]*id="${ids.opcao(1)}"[^>]*aria-selected="true"`),
    );
  });

  it("cada linha mostra título, atalho e o texto como vai entrar", () => {
    const html = lista();
    expect(html).toContain("Confirmação");
    expect(html).toContain("/conf");
    expect(html).toContain("Olá, Maria Teste! Confirmado.");
    // Alvo de toque: cada opcao tem pelo menos 40px.
    expect(html.match(/<li[^>]*class="[^"]*min-h-10/g)).toHaveLength(2);
  });

  it("carregando e erro, sem listbox", () => {
    const carregando = lista({ estado: "carregando", itens: [] });
    expect(carregando).toContain("Carregando as mensagens padrão");
    expect(carregando).not.toContain('role="listbox"');

    const erro = lista({ estado: "erro", itens: [] });
    expect(erro).toContain("Não foi possível carregar as mensagens padrão.");
    expect(erro).toContain("Tentar de novo");
    expect(erro).not.toContain('role="listbox"');
  });

  it("nenhuma cadastrada: administrador e gestor ganham o caminho", () => {
    const html = lista({ itens: [], cadastradas: 0, podeCadastrar: true });
    expect(html).toContain("Nenhuma mensagem padrão cadastrada.");
    expect(html).toContain('href="/configuracoes?aba=mensagens"');
  });

  it("nenhuma cadastrada: os demais veem o botão desabilitado, com dica", () => {
    const html = lista({ itens: [], cadastradas: 0, podeCadastrar: false });
    expect(html).toContain("Nenhuma mensagem padrão cadastrada.");
    expect(html).not.toContain("href=");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Cadastrar em Configurações/,
    );
    // A dica mora no tooltip (DisabledWithHint), alcancavel pelo foco.
    expect(html).toContain('tabindex="0"');
    expect(DICA_SEM_CADASTRO).toBe(
      "Somente administradores e gestores cadastram mensagens padrão.",
    );
  });

  it("sem resultado para o termo", () => {
    const html = lista({ itens: [], cadastradas: 2 });
    expect(html).toContain("Nenhuma mensagem com esse atalho.");
    expect(html).not.toContain('role="listbox"');
  });

  it("contato sem nome: a dica de que o nome sai do texto", () => {
    expect(lista({ contatoSemNome: true })).toContain(
      "Contato sem nome: o nome sai do texto.",
    );
    expect(lista()).not.toContain("Contato sem nome");
  });
});

function conversa(): ConversationListItem {
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
  };
}

const MENSAGENS: MensagensPadraoDoCompositor = {
  estado: "pronto",
  lista: [resposta()],
  aoTentarDeNovo: () => undefined,
  podeCadastrar: false,
};

function compositor(
  props: Partial<React.ComponentProps<typeof Composer>> = {},
) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <Composer
          conversation={conversa()}
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
          mensagensPadrao={MENSAGENS}
          nomeDaClinica="Clínica Sorriso"
          {...props}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const CAIXA = /<textarea[^>]*>/;

describe("compositor com mensagens padrão", () => {
  it("na resposta ao paciente: autocompletar em lista e a dica do /", () => {
    const html = compositor();
    const caixa = html.match(CAIXA)?.[0] ?? "";
    expect(caixa).toContain('aria-autocomplete="list"');
    const descrita = /aria-describedby="([^"]+)"/.exec(caixa)?.[1];
    expect(descrita).toBeTruthy();
    expect(html).toContain(
      `id="${descrita}" class="sr-only">Digite / para usar uma mensagem padrão.`,
    );
    // Fechada: nada aponta para lista nenhuma.
    expect(caixa).not.toContain("aria-activedescendant");
    expect(caixa).not.toContain("aria-controls");
    // O botao da barra, para toque e leitor de tela.
    expect(html).toMatch(/<button[^>]*aria-label="Mensagens padrão"/);
    expect(html).toMatch(/aria-haspopup="listbox"/);
    // A regiao de status existe antes de a lista abrir.
    expect(html).toContain('role="status" class="sr-only"');
  });

  it("na nota interna o / é texto comum", () => {
    const html = compositor({ modo: "nota" });
    const caixa = html.match(CAIXA)?.[0] ?? "";
    expect(caixa).not.toContain("aria-autocomplete");
    expect(caixa).not.toContain("aria-describedby");
  });

  it("sem escrita: sem lista, e o botão fica desabilitado com o motivo", () => {
    const html = compositor({ podeEditar: false });
    const caixa = html.match(CAIXA)?.[0] ?? "";
    expect(caixa).not.toContain("aria-autocomplete");
    expect(html).toMatch(
      /<button(?=[^>]*aria-label="Mensagens padrão")(?=[^>]*disabled="")[^>]*>/,
    );
  });

  it("sem as mensagens (outro uso do compositor), nada muda", () => {
    const html = compositor({ mensagensPadrao: undefined });
    expect(html).not.toContain("Mensagens padrão");
    expect(html.match(CAIXA)?.[0] ?? "").not.toContain("aria-autocomplete");
  });
});
