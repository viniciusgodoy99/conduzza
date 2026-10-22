import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A aba importa as Server Actions; aqui so a renderizacao importa.
vi.mock("@/app/(app)/automacoes/fluxo-actions", () => ({
  salvarAutomacaoDeFluxoAction: vi.fn(),
  alternarAutomacaoDeFluxoAction: vi.fn(),
  excluirAutomacaoDeFluxoAction: vi.fn(),
  previaDaAutomacaoDeFluxoAction: vi.fn(),
  usoDasAutomacoesDeFluxoAction: vi.fn(),
  historicoDeAutomacoesDeFluxoAction: vi.fn(),
}));

import { AbaFluxo } from "@/components/automacoes/fluxo/aba-fluxo";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  AcaoDaAutomacao,
  AutomacaoDeFluxo,
} from "@/lib/domain/automacoes-de-fluxo";
import type { EtapaDaJornada } from "@/lib/domain/jornada";

// Aba "Automações de fluxo" (desde 20/10/2026 na tela Automacoes; ate entao
// em Configuracoes): vazio com exemplo, cada regra com nome, situacao em tres
// camadas, "Quando", "Se" (so com condicao, onda 4) e "Faz" em portugues
// (varias acoes numa frase, o mover por ultimo), os avisos fixos, o atalho
// para o follow-up (outra aba da mesma tela) e as acoes de quem nao gerencia
// visiveis e desabilitadas. Quem ve a aba (so administrador e gestor) esta
// em tela-guarda.test.tsx.

function etapa(
  chave: string,
  nome: string,
  papel: EtapaDaJornada["papel"],
  posicao: number,
): EtapaDaJornada {
  return {
    id: `id-${chave}`,
    chave,
    nome,
    posicao,
    tom: "neutral",
    icone: "circle",
    papel,
    descricao: null,
    termos_chave: [],
    termos_de_quem: "paciente",
    meta_event_name: null,
    conversao_ativa: false,
    is_sale: false,
    is_first_contact: false,
    value_source: null,
    value_cents: null,
  };
}

const JORNADA: EtapaDaJornada[] = [
  etapa("novo", "Novo", "entrada", 10),
  etapa("em_contato", "Em contato", null, 20),
  etapa("aguardando_resposta", "Aguardando resposta", null, 30),
  etapa("agendou", "Agendou", "agendou", 40),
  etapa("compareceu", "Compareceu", "compareceu", 50),
  etapa("perdido", "Perdido", "perdido", 60),
];

const SEM_ACAO: Omit<AcaoDaAutomacao, "posicao" | "acao"> = {
  etapa_destino: null,
  motivo_perda: null,
  etiqueta: null,
  atividade_titulo: null,
  atividade_prazo_dias: null,
  nota_texto: null,
};

const BASE: Omit<AutomacaoDeFluxo, "id" | "nome" | "ativa"> = {
  gatilho: "sem_resposta_na_etapa",
  etapa: "aguardando_resposta",
  espera_minutos: 48 * 60,
  combinar: "todas",
  condicoes: [],
  acoes: [
    {
      ...SEM_ACAO,
      posicao: 1,
      acao: "mover_etapa",
      etapa_destino: "perdido",
      motivo_perda: "nao_respondeu",
    },
  ],
  vigente_desde: "2026-10-02T12:00:00Z",
  created_at: "2026-10-02T12:00:00Z",
  updated_at: "2026-10-02T12:00:00Z",
};

const AUTOMACOES: AutomacaoDeFluxo[] = [
  {
    ...BASE,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    nome: "Sumiu vira Perdido",
    ativa: true,
  },
  {
    ...BASE,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    nome: "Ligar para quem entrou",
    ativa: false,
    gatilho: "entrou_na_etapa",
    etapa: "em_contato",
    espera_minutos: null,
    acoes: [
      {
        ...SEM_ACAO,
        posicao: 1,
        acao: "criar_atividade",
        atividade_titulo: "Ligar para o paciente",
        atividade_prazo_dias: 2,
      },
    ],
  },
  // Onda 4: com condicao e duas acoes (o mover por ultimo).
  {
    ...BASE,
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    nome: "Psiquiatria parada",
    ativa: true,
    gatilho: "tempo_na_etapa",
    etapa: "em_contato",
    espera_minutos: 24 * 60,
    combinar: "todas",
    condicoes: [
      { posicao: 1, tipo: "tem_etiqueta", etiqueta: "Psiquiatria" },
      { posicao: 2, tipo: "nao_tem_etiqueta", etiqueta: "Retorno" },
    ],
    acoes: [
      {
        ...SEM_ACAO,
        posicao: 1,
        acao: "criar_atividade",
        atividade_titulo: "Ligar",
        atividade_prazo_dias: 0,
      },
      {
        ...SEM_ACAO,
        posicao: 2,
        acao: "mover_etapa",
        etapa_destino: "aguardando_resposta",
      },
    ],
  },
];

/** O texto visivel, sem as tags e com os espacos colapsados. */
function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .replace(/ ([,.:)])/g, "$1")
    .trim();
}

/** Botao com aquele nome e desabilitado, em qualquer ordem de atributo. */
const desabilitado = (nome: string) =>
  new RegExp(`<button(?=[^>]*aria-label="${nome}")(?=[^>]*disabled="")[^>]*>`);

function aba(props: Partial<React.ComponentProps<typeof AbaFluxo>>) {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AbaFluxo
          automacoes={AUTOMACOES}
          jornada={JORNADA}
          etiquetas={[]}
          clinicId="c1111111-1111-4111-8111-111111111111"
          timezone="America/Fortaleza"
          podeGerenciar
          dica="Somente administradores e gestores mudam as automações de fluxo."
          {...props}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("aba Automações de fluxo", () => {
  it("vazio explica com exemplo e oferece criar", () => {
    const html = aba({ automacoes: [] });
    expect(html).toContain("Nenhuma automação de fluxo ainda");
    expect(html).toContain("Criar a primeira");
    expect(html).toContain("Nova automação");
    // Onda 3 (21/10/2026): em Aguardando resposta e o lead que espera a
    // equipe, e a automacao dispara tambem na entrada pela IA (decisao D4).
    // O exemplo nao sugere mais perder quem espera a clinica.
    expect(html).toContain(
      "Por exemplo: quem entrou em Aguardando resposta ganha uma atividade de responder, ou quem ficou 3 dias sem responder em Em contato vai para Perdido.",
    );
    expect(html).not.toContain(
      "sem responder em Aguardando resposta vai para Perdido",
    );
  });

  it("cada regra: nome, situação em texto, Quando e Faz em português", () => {
    const html = aba({});
    expect(html).toContain("Sumiu vira Perdido");
    expect(html).toContain("Ligada");
    expect(html).toContain("Desligada");
    expect(html).toContain("Ficou 48 h sem responder em Aguardando resposta");
    expect(html).toContain("Move para Perdido (Não respondeu)");
    expect(html).toContain("Entrou em Em contato");
    expect(html).toContain("Cria a atividade Ligar para o paciente, em 2 dias");
    // Situacao tambem no interruptor, com o nome da regra.
    expect(html).toContain('aria-label="Desligar Sumiu vira Perdido"');
    expect(html).toContain('aria-label="Ligar Ligar para quem entrou"');
    // Uso carregando: esqueleto com texto para leitor de tela.
    expect(html).toContain("Contando as execuções");
  });

  it("regra composta: o Se com as condições e o Faz com as ações em ordem", () => {
    const html = texto(aba({}));
    expect(html).toContain(
      "Se: O lead tem a etiqueta Psiquiatria e não tem a etiqueta Retorno",
    );
    expect(html).toContain(
      "Faz: Cria a atividade Ligar, para o mesmo dia, e move para Aguardando resposta",
    );
    // Regra sem condicao nao mostra o "Se".
    expect(html.match(/Se: /g)).toHaveLength(1);
  });

  it("avisos fixos e o atalho para o follow-up", () => {
    const html = aba({});
    expect(html).toContain("paciente nunca é movido por automação");
    expect(html).toContain("Agendou e Compareceu não são destino");
    expect(html).toContain("encerra o follow-up daquela etapa");
    expect(html).toContain("param no 3º salto");
    expect(html).toContain(
      "As condições são conferidas na hora do gatilho: quem não bate fica de fora daquela vez.",
    );
    // O follow-up e outra aba desta mesma tela: o atalho so troca a aba.
    expect(html).toContain(
      "A mensagem para o paciente ao entrar na etapa fica no Follow-up de leads, nesta mesma tela",
    );
    expect(html).toContain('href="/automacoes?aba=followup"');
    expect(html).toContain("Abrir o follow-up");
    expect(html).not.toContain("/configuracoes");
  });

  it("histórico começa carregando, com texto para leitor de tela", () => {
    const html = aba({});
    expect(html).toContain("Histórico");
    expect(html).toContain("Carregando o histórico");
  });

  it("quem não gerencia vê tudo desabilitado, com a dica alcançável", () => {
    const html = aba({ podeGerenciar: false });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Nova automação/);
    expect(html).toMatch(desabilitado("Editar Sumiu vira Perdido"));
    expect(html).toMatch(desabilitado("Excluir Sumiu vira Perdido"));
    expect(html).toMatch(desabilitado("Desligar Sumiu vira Perdido"));
    // O span com tabIndex deixa a dica abrir pelo teclado.
    expect(html).toContain('tabindex="0"');
  });

  it("sem travessão na tela", () => {
    expect(aba({})).not.toMatch(/[–—]/);
    expect(aba({ automacoes: [] })).not.toMatch(/[–—]/);
  });
});
