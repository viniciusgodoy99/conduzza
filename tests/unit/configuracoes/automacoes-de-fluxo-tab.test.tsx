import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A aba importa as Server Actions; aqui so a renderizacao importa.
vi.mock("@/app/(app)/configuracoes/automacoes-de-fluxo-actions", () => ({
  salvarAutomacaoDeFluxoAction: vi.fn(),
  alternarAutomacaoDeFluxoAction: vi.fn(),
  excluirAutomacaoDeFluxoAction: vi.fn(),
  previaDaAutomacaoDeFluxoAction: vi.fn(),
  usoDasAutomacoesDeFluxoAction: vi.fn(),
  historicoDeAutomacoesDeFluxoAction: vi.fn(),
}));

import { AutomacoesDeFluxoTab } from "@/components/configuracoes/automacoes-de-fluxo-tab";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AutomacaoDeFluxo } from "@/lib/domain/automacoes-de-fluxo";
import type { EtapaDaJornada } from "@/lib/domain/jornada";

// Aba "Automações de fluxo" de Configuracoes: vazio com exemplo, cada regra
// com nome, situacao em tres camadas, "Quando" e "Faz" em portugues, os
// avisos fixos, o atalho para o follow-up e as acoes de quem nao gerencia
// visiveis e desabilitadas.

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

const BASE: Omit<AutomacaoDeFluxo, "id" | "nome" | "ativa"> = {
  gatilho: "sem_resposta_na_etapa",
  etapa: "aguardando_resposta",
  espera_minutos: 48 * 60,
  acao: "mover_etapa",
  etapa_destino: "perdido",
  motivo_perda: "nao_respondeu",
  etiqueta: null,
  atividade_titulo: null,
  atividade_prazo_dias: null,
  nota_texto: null,
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
    acao: "criar_atividade",
    etapa_destino: null,
    motivo_perda: null,
    atividade_titulo: "Ligar para o paciente",
    atividade_prazo_dias: 2,
  },
];

/** Botao com aquele nome e desabilitado, em qualquer ordem de atributo. */
const desabilitado = (nome: string) =>
  new RegExp(`<button(?=[^>]*aria-label="${nome}")(?=[^>]*disabled="")[^>]*>`);

function aba(
  props: Partial<React.ComponentProps<typeof AutomacoesDeFluxoTab>>,
) {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AutomacoesDeFluxoTab
          automacoes={AUTOMACOES}
          jornada={JORNADA}
          etiquetas={[]}
          clinicId="c1111111-1111-4111-8111-111111111111"
          timezone="America/Fortaleza"
          podeGerenciar
          dica="Somente administradores e gestores alteram as configurações"
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
  });

  it("cada regra: nome, situação em texto, Quando e Faz em português", () => {
    const html = aba({});
    expect(html).toContain("Sumiu vira Perdido");
    expect(html).toContain("Ligada");
    expect(html).toContain("Desligada");
    expect(html).toContain("Ficou 48 h sem responder em Aguardando resposta");
    expect(html).toContain("Move para Perdido (Não respondeu)");
    expect(html).toContain("Entrou em Em contato");
    expect(html).toContain("Cria atividade: Ligar para o paciente, em 2 dias");
    // Situacao tambem no interruptor, com o nome da regra.
    expect(html).toContain('aria-label="Desligar Sumiu vira Perdido"');
    expect(html).toContain('aria-label="Ligar Ligar para quem entrou"');
    // Uso carregando: esqueleto com texto para leitor de tela.
    expect(html).toContain("Contando as execuções");
  });

  it("avisos fixos e o atalho para o follow-up", () => {
    const html = aba({});
    expect(html).toContain("paciente nunca é movido por automação");
    expect(html).toContain("Agendou e Compareceu não são destino");
    expect(html).toContain("encerra o follow-up daquela etapa");
    expect(html).toContain("param no 3º salto");
    expect(html).toContain(
      "A mensagem para o paciente ao entrar na etapa fica em Automações",
    );
    expect(html).toContain('href="/automacoes?aba=followup"');
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
