import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/automacoes/fluxo-actions", () => ({
  salvarAutomacaoDeFluxoAction: vi.fn(),
  alternarAutomacaoDeFluxoAction: vi.fn(),
  excluirAutomacaoDeFluxoAction: vi.fn(),
  previaDaAutomacaoDeFluxoAction: vi.fn(),
  usoDasAutomacoesDeFluxoAction: vi.fn(),
  historicoDeAutomacoesDeFluxoAction: vi.fn(),
}));
// O dialogo do Radix so abre com interacao: aqui as pecas viram blocos.
vi.mock("@/components/ui/dialog", () => {
  const Bloco = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div data-parte="dialogo">{children}</div> : null,
    DialogClose: Bloco,
    DialogContent: Bloco,
    DialogDescription: Bloco,
    DialogFooter: Bloco,
    DialogHeader: Bloco,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  };
});
// A dica vira atributo, para o teste ler o porque do controle desabilitado.
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

import { PainelDeEtiquetas } from "@/components/automacoes/seletor-de-etiqueta";
import { DialogoDaAutomacao } from "@/components/automacoes/fluxo/dialogo-da-automacao";
import { HistoricoDasAutomacoes } from "@/components/automacoes/fluxo/historico-das-automacoes";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  AcaoDaAutomacao,
  AutomacaoDeFluxo,
  ExecucaoDeAutomacao,
} from "@/lib/domain/automacoes-de-fluxo";
import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import { opcoesDeEtiqueta } from "@/lib/domain/etiquetas-do-lead";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import { automacoesDeFluxoKeys } from "@/lib/queries/automacoes-de-fluxo";

// A tela da automacao composta (onda 4, itens 14 e 15): o dialogo com o
// Quando, o Se (condicoes de etiqueta, todas ou qualquer uma, ate 5) e o Faz
// (ate 5 acoes, um mover so, sempre por ultimo, com Subir e Descer que nunca
// passam dele); o historico com o que cada acao fez ou nao fez; e o seletor
// de etiqueta do filtro (as do catalogo e as em uso, ou uma nova com a
// grafia que a clinica ja tem).

const CLINICA = "c1111111-1111-4111-8111-111111111111";

function etapa(
  chave: string,
  nome: string,
  papel: EtapaDaJornada["papel"],
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
    conversao_ativa: false,
    is_sale: false,
    is_first_contact: false,
    value_source: null,
    value_cents: null,
  };
}

const JORNADA = [
  etapa("novo", "Novo", "entrada"),
  etapa("em_contato", "Em contato", "em_contato"),
  etapa("follow_2", "Follow 2", null),
  etapa("agendou", "Agendou", "agendou"),
  etapa("perdido", "Perdido", "perdido"),
];

const CATALOGO: EtiquetaDeConversa[] = [
  { id: "t1", chave: "retorno", nome: "Retorno", tom: "warning" },
];

const VAZIA: Omit<AcaoDaAutomacao, "posicao" | "acao"> = {
  etapa_destino: null,
  motivo_perda: null,
  etiqueta: null,
  atividade_titulo: null,
  atividade_prazo_dias: null,
  nota_texto: null,
};

const COMPOSTA: AutomacaoDeFluxo = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  nome: "Psiquiatria parada",
  ativa: false,
  gatilho: "tempo_na_etapa",
  etapa: "em_contato",
  espera_minutos: 24 * 60,
  combinar: "qualquer",
  condicoes: [
    { posicao: 1, tipo: "tem_etiqueta", etiqueta: "Psiquiatria" },
    { posicao: 2, tipo: "nao_tem_etiqueta", etiqueta: "Retorno" },
  ],
  acoes: [
    {
      ...VAZIA,
      posicao: 1,
      acao: "criar_atividade",
      atividade_titulo: "Ligar",
      atividade_prazo_dias: 0,
    },
    { ...VAZIA, posicao: 2, acao: "mover_etapa", etapa_destino: "follow_2" },
  ],
  vigente_desde: "2026-10-24T12:00:00Z",
  created_at: "2026-10-24T12:00:00Z",
  updated_at: "2026-10-24T12:00:00Z",
};

function dialogo(regra: AutomacaoDeFluxo | null): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <DialogoDaAutomacao
          aberto
          aoFechar={() => undefined}
          aoSalvar={() => undefined}
          regra={regra}
          automacoes={regra ? [regra] : []}
          jornada={JORNADA}
          etiquetas={CATALOGO}
          opcoesDeEtiqueta={opcoesDeEtiqueta(CATALOGO, [])}
          leituraDasOpcoes="pronto"
          clinicId={CLINICA}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** O botao com aquele nome acessivel (e a dica em volta, se houver). */
function botao(html: string, nome: string): string {
  const achado = new RegExp(
    `(?:<span data-dica="([^"]*)">)?<button(?=[^>]*aria-label="${nome}")[^>]*>`,
  ).exec(html);
  expect(achado, nome).not.toBeNull();
  return achado![0];
}

describe("o diálogo da automação composta", () => {
  it("as três partes: Quando, Se (opcional) e Faz", () => {
    const lido = texto(dialogo(COMPOSTA));
    expect(lido).toContain("Quando");
    expect(lido).toContain("Se (opcional)");
    expect(lido).toContain("Faz");
    expect(lido).toContain("Como juntar as condições");
    expect(lido).toContain(
      "Mover roda sempre por último, depois das outras ações.",
    );
  });

  it("as condições: tem e não tem, a etiqueta escolhida e remover", () => {
    const html = dialogo(COMPOSTA);
    expect(html).toContain('aria-label="Etiqueta da condição 1: Psiquiatria"');
    expect(html).toContain('aria-label="Etiqueta da condição 2: Retorno"');
    // O tom do catalogo no marcador da etiqueta Retorno.
    expect(html).toContain("background-color:var(--warning)");
    botao(html, "Remover a condição 1");
    expect(texto(html)).toContain(
      "Vale a etiqueta do lead (Leads) e a da conversa (Atendimento), pelo nome, sem diferença de maiúscula e acento.",
    );
  });

  it("as ações na ordem, o mover por último, e Subir e Descer nunca passam dele", () => {
    const html = dialogo(COMPOSTA);
    const lido = texto(html);
    expect(lido.indexOf("Ação 1")).toBeLessThan(lido.indexOf("Ação 2"));
    expect(lido).toContain("O que fazer");
    expect(lido).toContain("Para a etapa");
    // A atividade e a primeira: nao sobe; e o mover vem logo depois: nao
    // desce.
    expect(botao(html, "Subir a ação 1")).toContain('disabled=""');
    expect(botao(html, "Descer a ação 1")).toContain('disabled=""');
    // O mover: desabilitados, com a dica que explica.
    const subirMover = botao(html, "Subir a ação 2");
    expect(subirMover).toContain('disabled=""');
    expect(subirMover).toContain(
      'data-dica="Mover roda sempre por último, depois das outras ações."',
    );
    expect(botao(html, "Remover a ação 2")).not.toContain('disabled=""');
  });

  it("regra nova: sem condição e uma ação, que não se remove", () => {
    const html = dialogo(null);
    const lido = texto(html);
    expect(lido).toContain("Nova automação de fluxo");
    expect(lido).toContain(
      "Sem condição, a automação vale para todo lead que bate com o Quando.",
    );
    expect(lido).not.toContain("Como juntar as condições");
    expect(lido).toContain("Ação 1");
    expect(lido).not.toContain("Ação 2");
    const remover = botao(html, "Remover a ação 1");
    expect(remover).toContain('disabled=""');
    expect(remover).toContain(
      'data-dica="Uma automação faz pelo menos uma ação."',
    );
  });

  it("com 5 ações e 5 condições, adicionar fica desabilitado com a dica", () => {
    const nota = (posicao: number): AcaoDaAutomacao => ({
      ...VAZIA,
      posicao,
      acao: "nota_interna",
      nota_texto: "Oi",
    });
    const cheia: AutomacaoDeFluxo = {
      ...COMPOSTA,
      condicoes: [1, 2, 3, 4, 5].map((posicao) => ({
        posicao,
        tipo: "tem_etiqueta",
        etiqueta: `E${posicao}`,
      })),
      acoes: [1, 2, 3, 4, 5].map(nota),
    };
    const html = dialogo(cheia);
    expect(html).toMatch(
      /data-dica="Até 5 ações por automação\."><button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Adicionar ação/,
    );
    expect(html).toMatch(
      /data-dica="Até 5 condições por automação\."><button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Adicionar condição/,
    );
  });

  it("sem travessão", () => {
    expect(dialogo(COMPOSTA)).not.toMatch(/[–—]/);
    expect(dialogo(null)).not.toMatch(/[–—]/);
  });
});

describe("o histórico: o que cada ação fez e o pulou porque", () => {
  function historico(execucoes: ExecucaoDeAutomacao[]): string {
    const cliente = new QueryClient();
    cliente.setQueryData(
      automacoesDeFluxoKeys.historico(CLINICA, null),
      execucoes,
    );
    return texto(
      renderToStaticMarkup(
        <QueryClientProvider client={cliente}>
          <TooltipProvider>
            <HistoricoDasAutomacoes
              automacoes={[COMPOSTA]}
              jornada={JORNADA}
              etiquetas={CATALOGO}
              clinicId={CLINICA}
              timezone="America/Fortaleza"
            />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );
  }

  const base: ExecucaoDeAutomacao = {
    id: "e1",
    automacao_id: COMPOSTA.id,
    status: "executada",
    motivo: null,
    de_etapa: "em_contato",
    para_etapa: "follow_2",
    acao: null,
    etiqueta: null,
    etiqueta_nome: null,
    executada_em: "2026-10-24T13:00:00Z",
    created_at: "2026-10-24T12:59:00Z",
    contato: "Maria",
    acoes: [],
  };

  it("várias ações: uma linha por ação, com o feito e o não feito", () => {
    const lido = historico([
      {
        ...base,
        acoes: [
          {
            posicao: 1,
            acao: "criar_atividade",
            status: "executada",
            motivo: null,
            para_etapa: null,
            etiqueta: null,
            etiqueta_nome: null,
            executada_em: "2026-10-24T13:00:00Z",
          },
          {
            posicao: 2,
            acao: "etiquetar",
            status: "pulada",
            motivo: "ja_tinha_etiqueta",
            para_etapa: null,
            etiqueta: "retorno",
            etiqueta_nome: "Retorno",
            executada_em: "2026-10-24T13:00:00Z",
          },
          {
            posicao: 3,
            acao: "mover_etapa",
            status: "executada",
            motivo: null,
            para_etapa: "follow_2",
            etiqueta: null,
            etiqueta_nome: null,
            executada_em: "2026-10-24T13:00:00Z",
          },
        ],
      },
    ]);
    expect(lido).toContain(
      "Maria Psiquiatria parada Fez 2 de 3 ações (em Em contato)",
    );
    expect(lido).toContain("Fez: criou uma atividade");
    expect(lido).toContain(
      "Não fez: etiquetar a conversa com Retorno (a conversa já tinha a etiqueta)",
    );
    expect(lido).toContain("Fez: moveu de Em contato para Follow 2");
  });

  it("a condição que não bateu: pulada, com o porquê", () => {
    const lido = historico([
      {
        ...base,
        status: "pulada",
        motivo: "condicoes_nao_atendidas",
        para_etapa: null,
        executada_em: null,
      },
    ]);
    expect(lido).toContain("Pulada");
    expect(lido).toContain(
      "Não fez nada: o lead não batia com as condições na hora (em Em contato)",
    );
  });
});

describe("o seletor de etiqueta do filtro", () => {
  type Elemento = ReactElement<Record<string, unknown>>;

  /** Os elementos da arvore (sem renderizar), em profundidade. */
  function elementos(no: ReactNode): Elemento[] {
    if (Array.isArray(no)) {
      return no.flatMap(elementos);
    }
    if (!isValidElement(no)) {
      return [];
    }
    const elemento = no as Elemento;
    return [elemento, ...elementos(elemento.props.children as ReactNode)];
  }

  function painel(
    campos: Partial<ComponentProps<typeof PainelDeEtiquetas>> = {},
  ) {
    const aoEscolher = vi.fn();
    const props: ComponentProps<typeof PainelDeEtiquetas> = {
      digitada: "",
      aoDigitar: () => undefined,
      opcoes: opcoesDeEtiqueta(CATALOGO, [{ tags: ["Psiquiatria", "LEAD"] }]),
      leitura: "pronto",
      jaEscolhidas: [],
      aoEscolher,
      ...campos,
    };
    const arvore = PainelDeEtiquetas(props);
    return { arvore, aoEscolher, html: renderToStaticMarkup(arvore) };
  }

  it("oferece as do catálogo e as em uso; tocar escolhe pelo nome", () => {
    const { arvore, aoEscolher, html } = painel();
    expect(html).toContain('aria-label="Escolher a etiqueta Retorno"');
    expect(html).toContain('aria-label="Escolher a etiqueta Psiquiatria"');
    expect(texto(html)).toContain("só nos leads");
    const opcao = elementos(arvore).find(
      (elemento) =>
        elemento.props["aria-label"] === "Escolher a etiqueta Psiquiatria",
    );
    (opcao?.props.onClick as () => void)();
    expect(aoEscolher).toHaveBeenCalledWith("Psiquiatria");
  });

  it("a escrita entra com a grafia que a clínica já tem", () => {
    const { arvore, aoEscolher, html } = painel({ digitada: "lead" });
    expect(texto(html)).toContain(
      "Esta etiqueta já existe como LEAD e entra com essa grafia.",
    );
    const usar = elementos(arvore).find(
      (elemento) => elemento.props.children === "Usar",
    );
    (usar?.props.onClick as () => void)();
    expect(aoEscolher).toHaveBeenCalledWith("LEAD");
  });

  it("a que já está no filtro não se oferece de novo", () => {
    const { html } = painel({ jaEscolhidas: ["retorno"], digitada: "RETORNO" });
    expect(html).not.toContain('aria-label="Escolher a etiqueta Retorno"');
    expect(texto(html)).toContain("Esta etiqueta já está no filtro.");
  });

  it("sem o catálogo: diz que não carregou e aceita a escrita", () => {
    const { html } = painel({ opcoes: [], leitura: "erro", digitada: "Nova" });
    expect(texto(html)).toContain(
      "Não foi possível carregar as etiquetas da clínica.",
    );
    expect(html).not.toMatch(/[–—]/);
  });
});
