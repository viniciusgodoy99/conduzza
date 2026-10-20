import { DndContext } from "@dnd-kit/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O Kanban importa a Server Action de mudar etapa; aqui nada e gravado.
vi.mock("@/app/(app)/leads/actions", () => ({
  mudarEtapaAction: vi.fn(),
}));

import {
  criarArrastoDoQuadro,
  LIMITES_ANTES_DE_MEDIR,
  limitesDaRolagem,
  rolagemDasSetas,
  SELETOR_QUE_NAO_ARRASTA,
  type EventoDoPonteiro,
  type QuadroQueRola,
} from "@/components/leads/arrastar-para-os-lados";
import { ColunasCarregando } from "@/components/leads/colunas-carregando";
import { FaixaDeRolagem, KanbanBoard } from "@/components/leads/kanban-board";
import { LeadCard } from "@/components/leads/lead-card";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import type { LeadResumo } from "@/lib/queries/leads";

// "Nao consigo puxar para o lado" (relato de 20/10/2026): o quadro do Kanban
// com mais etapas do que cabem rola arrastando o FUNDO com o mouse, pelas
// setas da faixa acima dele e pelo teclado. Os testes de unidade do projeto
// rodam em node, sem DOM: o arrasto roda contra um quadro falso (scrollWidth,
// clientWidth e scrollLeft por Object.defineProperty, com o limite que o
// navegador aplica) e as telas saem pelo HTML do servidor.

const FOCAVEL = "[tabindex]:not([tabindex='-1'])";

/**
 * No falso: o pai e o item de SELETOR_QUE_NAO_ARRASTA que ele casa (null no
 * fundo). O closest sobe do proprio no ate a raiz, como o do navegador.
 */
type No = {
  pai: No | null;
  casa: string | null;
  closest(lista: string): No | null;
};

function no(pai: No | null, casa: string | null = null): No {
  const proprio: No = {
    pai,
    casa,
    closest(lista) {
      const seletores = lista.split(", ");
      for (let atual: No | null = proprio; atual !== null; atual = atual.pai) {
        if (atual.casa !== null && seletores.includes(atual.casa)) {
          return atual;
        }
      }
      return null;
    },
  };
  return proprio;
}

type QuadroFalso = No & QuadroQueRola & { capturas: number[] };

/**
 * Quadro de 1000px visiveis com 2400px de conteudo, 200px abaixo do topo da
 * janela e com 480px de area de conteudo (a barra de rolagem vem depois).
 * Dentro: uma coluna com cabecalho, espaco vazio, um cartao e controles.
 */
function montarQuadro({
  largura = 1000,
  conteudo = 2400,
  rolagem = 0,
}: { largura?: number; conteudo?: number; rolagem?: number } = {}) {
  // O quadro e focavel (tabIndex 0): o closest de quem esta no fundo para
  // nele, e so o controle DENTRO dele impede o arrasto.
  const quadro = no(no(null), FOCAVEL) as QuadroFalso;
  let rolagemAtual = rolagem;
  Object.defineProperties(quadro, {
    scrollWidth: { value: conteudo },
    clientWidth: { value: largura },
    clientHeight: { value: 480 },
    clientTop: { value: 0 },
    clientLeft: { value: 0 },
    // Como no navegador: o valor fica entre o comeco e o fim.
    scrollLeft: {
      get: () => rolagemAtual,
      set: (valor: number) => {
        rolagemAtual = Math.min(
          Math.max(valor, 0),
          Math.max(conteudo - largura, 0),
        );
      },
    },
  });
  quadro.capturas = [];
  quadro.getBoundingClientRect = () => ({ top: 200, left: 300 });
  quadro.contains = (outro) => {
    for (
      let atual = outro as unknown as No | null;
      atual !== null;
      atual = atual.pai
    ) {
      if (atual === quadro) {
        return true;
      }
    }
    return false;
  };
  quadro.setPointerCapture = (ponteiro) => {
    quadro.capturas.push(ponteiro);
  };

  const coluna = no(quadro);
  const cartao = no(coluna, "[data-cartao-do-lead]");
  return {
    quadro,
    fundo: {
      "vão entre colunas": quadro,
      coluna,
      "cabeçalho da coluna": no(no(coluna)),
      "espaço vazio da coluna": no(coluna),
    },
    // O texto do nome, dentro do botao do cartao.
    cartao: no(no(cartao)),
    controles: {
      botão: no(coluna, "button"),
      link: no(coluna, "a[href]"),
      "descrição focável da etapa": no(coluna, FOCAVEL),
    },
  };
}

function ponteiro(
  quadro: QuadroFalso,
  alvo: No,
  campos: Partial<EventoDoPonteiro> = {},
): EventoDoPonteiro {
  return {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    clientX: 900,
    clientY: 400,
    target: alvo as unknown as EventTarget,
    currentTarget: quadro,
    ...campos,
  };
}

/** Aperta em alvo no x de, arrasta ate o x ate e solta. */
function arrastar(
  quadro: QuadroFalso,
  alvo: No,
  de: number,
  ate: number,
  campos: Partial<EventoDoPonteiro> = {},
): boolean[] {
  const mudancas: boolean[] = [];
  const arrasto = criarArrastoDoQuadro((valor) => mudancas.push(valor));
  arrasto.aoApertar(ponteiro(quadro, alvo, { ...campos, clientX: de }));
  arrasto.aoMover(
    ponteiro(quadro, alvo, { ...campos, clientX: (de + ate) / 2 }),
  );
  arrasto.aoMover(ponteiro(quadro, alvo, { ...campos, clientX: ate }));
  arrasto.aoSoltar(ponteiro(quadro, alvo, campos));
  return mudancas;
}

describe("arrasto do fundo do quadro", () => {
  it("apertar o fundo e mover o mouse rola o quadro para os lados", () => {
    const { quadro, fundo } = montarQuadro();
    const alvo = fundo["cabeçalho da coluna"];
    const mudancas: boolean[] = [];
    const arrasto = criarArrastoDoQuadro((valor) => mudancas.push(valor));

    arrasto.aoApertar(ponteiro(quadro, alvo, { clientX: 900 }));
    expect(mudancas).toEqual([true]);
    // Capturado: sair do quadro no meio do arrasto nao solta.
    expect(quadro.capturas).toEqual([1]);

    // Puxar para a esquerda mostra as proximas etapas...
    arrasto.aoMover(ponteiro(quadro, alvo, { clientX: 650 }));
    expect(quadro.scrollLeft).toBe(250);
    // ...e voltar para a direita, as anteriores.
    arrasto.aoMover(ponteiro(quadro, alvo, { clientX: 800 }));
    expect(quadro.scrollLeft).toBe(100);

    arrasto.aoSoltar(ponteiro(quadro, alvo));
    expect(mudancas).toEqual([true, false]);
    // Solto, mover o mouse nao rola mais.
    arrasto.aoMover(ponteiro(quadro, alvo, { clientX: 100 }));
    expect(quadro.scrollLeft).toBe(100);
  });

  it("vale em todo o fundo e parte de onde o quadro estava", () => {
    for (const onde of Object.keys(montarQuadro().fundo)) {
      const { quadro, fundo } = montarQuadro({ rolagem: 700 });
      const alvo = fundo[onde as keyof typeof fundo];
      const mudancas = arrastar(quadro, alvo, 900, 600);
      expect(mudancas, onde).toEqual([true, false]);
      expect(quadro.scrollLeft, onde).toBe(1000);
    }
  });

  it("começando num cartão NÃO rola: ali o dnd-kit arrasta o lead e o clique abre o drawer", () => {
    const { quadro, cartao } = montarQuadro();
    expect(arrastar(quadro, cartao, 900, 400)).toEqual([]);
    expect(quadro.scrollLeft).toBe(0);
    expect(quadro.capturas).toEqual([]);
  });

  it("nem em controle: botão, link ou a descrição focável da etapa", () => {
    for (const qual of Object.keys(montarQuadro().controles)) {
      const { quadro, controles } = montarQuadro();
      const alvo = controles[qual as keyof typeof controles];
      expect(arrastar(quadro, alvo, 900, 400), qual).toEqual([]);
      expect(quadro.scrollLeft, qual).toBe(0);
    }
  });

  it("só o botão principal do mouse: no toque e na caneta o navegador já rola", () => {
    const outros: Partial<EventoDoPonteiro>[] = [
      { pointerType: "touch" },
      { pointerType: "pen" },
      { button: 1, buttons: 4 },
      { button: 2, buttons: 2 },
    ];
    for (const campos of outros) {
      const { quadro, fundo } = montarQuadro();
      const descricao = JSON.stringify(campos);
      expect(
        arrastar(quadro, fundo.coluna, 900, 400, campos),
        descricao,
      ).toEqual([]);
      expect(quadro.scrollLeft, descricao).toBe(0);
    }
  });

  it("sem excesso de largura não há o que arrastar (nem cursor, nem captura)", () => {
    const { quadro, fundo } = montarQuadro({ conteudo: 1000 });
    expect(arrastar(quadro, fundo.coluna, 900, 400)).toEqual([]);
    expect(quadro.capturas).toEqual([]);
  });

  it("na barra de rolagem do quadro quem rola é o navegador", () => {
    // Area do conteudo de 200 a 680: a barra fica de 680 para baixo.
    const { quadro, fundo } = montarQuadro();
    expect(
      arrastar(quadro, fundo["vão entre colunas"], 900, 400, { clientY: 684 }),
    ).toEqual([]);
    expect(quadro.scrollLeft).toBe(0);
  });

  it("botão já solto sem pointerup (menu de contexto) encerra o arrasto", () => {
    const { quadro, fundo } = montarQuadro();
    const mudancas: boolean[] = [];
    const arrasto = criarArrastoDoQuadro((valor) => mudancas.push(valor));
    arrasto.aoApertar(ponteiro(quadro, fundo.coluna, { clientX: 900 }));
    arrasto.aoMover(
      ponteiro(quadro, fundo.coluna, { clientX: 500, buttons: 0 }),
    );
    expect(mudancas).toEqual([true, false]);
    expect(quadro.scrollLeft).toBe(0);
  });

  it("outro ponteiro não mexe no arrasto em curso", () => {
    const { quadro, fundo } = montarQuadro();
    const mudancas: boolean[] = [];
    const arrasto = criarArrastoDoQuadro((valor) => mudancas.push(valor));
    arrasto.aoApertar(ponteiro(quadro, fundo.coluna, { clientX: 900 }));
    arrasto.aoMover(
      ponteiro(quadro, fundo.coluna, { pointerId: 7, clientX: 100 }),
    );
    arrasto.aoSoltar(ponteiro(quadro, fundo.coluna, { pointerId: 7 }));
    expect(quadro.scrollLeft).toBe(0);
    expect(mudancas).toEqual([true]);
  });
});

describe("limites da rolagem", () => {
  it("sem excesso de largura: nada a rolar", () => {
    expect(
      limitesDaRolagem({ scrollWidth: 1000, clientWidth: 1000, scrollLeft: 0 }),
    ).toEqual({ excede: false, noComeco: true, noFim: true });
    // 1px a mais e arredondamento, nao conteudo escondido.
    expect(
      limitesDaRolagem({ scrollWidth: 1001, clientWidth: 1000, scrollLeft: 0 })
        .excede,
    ).toBe(false);
  });

  it("no começo, no meio e no fim (scrollLeft fracionado conta como fim)", () => {
    const largura = { scrollWidth: 2400, clientWidth: 1000 };
    expect(limitesDaRolagem({ ...largura, scrollLeft: 0 })).toEqual({
      excede: true,
      noComeco: true,
      noFim: false,
    });
    expect(limitesDaRolagem({ ...largura, scrollLeft: 700 })).toEqual({
      excede: true,
      noComeco: false,
      noFim: false,
    });
    expect(limitesDaRolagem({ ...largura, scrollLeft: 1399.5 })).toEqual({
      excede: true,
      noComeco: false,
      noFim: true,
    });
  });

  it("antes de medir, o caso comum: passa da largura e está no começo", () => {
    expect(LIMITES_ANTES_DE_MEDIR).toEqual({
      excede: true,
      noComeco: true,
      noFim: false,
    });
  });

  it("cada seta anda 80% da largura visível, suave salvo movimento reduzido", () => {
    expect(rolagemDasSetas(1000, 1, false)).toEqual({
      left: 800,
      behavior: "smooth",
    });
    expect(rolagemDasSetas(1000, -1, false)).toEqual({
      left: -800,
      behavior: "smooth",
    });
    expect(rolagemDasSetas(1235, 1, true)).toEqual({
      left: 988,
      behavior: "auto",
    });
  });
});

/** A tag de abertura do botao com o aria-label pedido. */
function seta(html: string, rotulo: string): string {
  const achada = html.match(
    new RegExp(`<button[^>]*aria-label="${rotulo}"[^>]*>`),
  )?.[0];
  expect(achada, `seta "${rotulo}"`).toBeDefined();
  return achada ?? "";
}

function desabilitada(botao: string): boolean {
  return /\sdisabled=""/.test(botao);
}

function faixa(opcoes: Parameters<typeof montarQuadro>[0]): string {
  const { quadro } = montarQuadro(opcoes);
  return renderToStaticMarkup(
    <FaixaDeRolagem
      quadroId="quadro-de-etapas"
      limites={limitesDaRolagem(quadro)}
      aoRolar={() => undefined}
    />,
  );
}

describe("faixa das setas", () => {
  it("no começo: 'Ver etapas anteriores' desabilitada e 'Ver próximas etapas' habilitada", () => {
    const html = faixa({ rolagem: 0 });
    expect(desabilitada(seta(html, "Ver etapas anteriores"))).toBe(true);
    expect(desabilitada(seta(html, "Ver próximas etapas"))).toBe(false);
  });

  it("no fim: só a de voltar fica habilitada", () => {
    const html = faixa({ rolagem: 1400 });
    expect(desabilitada(seta(html, "Ver etapas anteriores"))).toBe(false);
    expect(desabilitada(seta(html, "Ver próximas etapas"))).toBe(true);
  });

  it("no meio: as duas habilitadas", () => {
    const html = faixa({ rolagem: 700 });
    expect(desabilitada(seta(html, "Ver etapas anteriores"))).toBe(false);
    expect(desabilitada(seta(html, "Ver próximas etapas"))).toBe(false);
  });

  it("setas de 40px que controlam o quadro, com a dica ao lado", () => {
    const html = faixa({ rolagem: 0 });
    for (const rotulo of ["Ver etapas anteriores", "Ver próximas etapas"]) {
      const botao = seta(html, rotulo);
      expect(botao).toContain("size-10");
      expect(botao).toContain('aria-controls="quadro-de-etapas"');
    }
    expect(html).toContain("lucide-chevron-left");
    expect(html).toContain("lucide-chevron-right");
    expect(html).toContain("Arraste o quadro para os lados ou use as setas.");
    // Presa no topo ao rolar a pagina, com fundo opaco por cima dos cartoes.
    expect(html).toMatch(/class="sticky top-0 z-10 [^"]*bg-background/);
  });

  it("a faixa não aparece quando não há excesso de largura", () => {
    expect(faixa({ conteudo: 1000 })).toBe("");
  });
});

function etapa(chave: string, nome: string, posicao: number): EtapaDaJornada {
  return {
    id: `e-${chave}`,
    chave,
    nome,
    posicao,
    tom: "info",
    icone: "circle",
    papel: null,
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

// Oito etapas, como no relato (8 a 10).
const JORNADA: EtapaDaJornada[] = [
  "Novo",
  "Em contato",
  "Aguardando resposta",
  "Avaliação",
  "Orçamento",
  "Agendou",
  "Compareceu",
  "Perdido",
].map((nome, indice) =>
  etapa(nome.toLowerCase().replace(/\s+/g, "_"), nome, (indice + 1) * 10),
);

const LEAD: LeadResumo = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Maria Silva",
  phone_e164: "+5585999990001",
  funnel_stage: "novo",
  lost_reason: null,
  lost_reason_note: null,
  owner_user_id: null,
  tags: [],
  source_channel: null,
  source_campaign: null,
  source_origin: null,
  source_medium: null,
  source_method: null,
  source_ad_id: null,
  source_google_campaign_id: null,
  first_contact_at: "2026-10-05T12:00:00.000Z",
  last_contact_at: null,
  insurance: null,
  consent_ativo: false,
  anuncio_meta: { estado: "lida", anuncio: null },
};

function quadroNaTela(): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <KanbanBoard
        clinicId="c1111111-1111-4111-8111-111111111111"
        jornada={JORNADA}
        leads={[LEAD]}
        membros={{}}
        reguas={[]}
        podeEditar
        onAbrirLead={() => undefined}
      />
    </QueryClientProvider>,
  );
}

function cartao(podeEditar: boolean): string {
  return renderToStaticMarkup(
    <DndContext>
      <LeadCard
        lead={LEAD}
        nomeResponsavel={null}
        podeEditar={podeEditar}
        onAbrir={() => undefined}
      />
    </DndContext>,
  );
}

describe("o quadro na tela de Leads", () => {
  it("é uma região focável 'Etapas da jornada', com anel de foco e mão de arrastar", () => {
    const regiao =
      quadroNaTela().match(/<div[^>]*role="region"[^>]*>/)?.[0] ?? "";
    expect(regiao).toContain('aria-label="Etapas da jornada"');
    expect(regiao).toContain('tabindex="0"');
    expect(regiao).toContain("focus-visible:outline-focus");
    expect(regiao).toContain("overflow-x-auto");
    expect(regiao).toContain("cursor-grab");
  });

  it("a faixa vem antes do quadro (antes de medir) e as setas apontam para ele", () => {
    const html = quadroNaTela();
    const id = html.match(/<div id="([^"]+)"[^>]*role="region"/)?.[1];
    expect(id).toBeDefined();
    const anterior = seta(html, "Ver etapas anteriores");
    expect(anterior).toContain(`aria-controls="${id}"`);
    expect(desabilitada(anterior)).toBe(true);
    expect(desabilitada(seta(html, "Ver próximas etapas"))).toBe(false);
    expect(html.indexOf("Ver etapas anteriores")).toBeLessThan(
      html.indexOf('role="region"'),
    );
  });

  it("o cartão carrega a marca que o arrasto do quadro respeita", () => {
    expect(SELETOR_QUE_NAO_ARRASTA.split(", ")).toContain(
      "[data-cartao-do-lead]",
    );
    expect(cartao(true)).toMatch(/<button[^>]*data-cartao-do-lead=""/);
    expect(quadroNaTela()).toContain('data-cartao-do-lead=""');
  });

  it("cartão sem edição tem o cursor padrão, e não herda a mão do quadro", () => {
    const comEdicao = cartao(true).match(/<button[^>]*>/)?.[0] ?? "";
    const semEdicao = cartao(false).match(/<button[^>]*>/)?.[0] ?? "";
    expect(comEdicao).toContain("cursor-grab");
    expect(semEdicao).toContain("cursor-default");
    expect(semEdicao).not.toContain("cursor-grab");
  });

  it("o esqueleto reserva a faixa das setas: o quadro não desce quando a lista chega", () => {
    const esqueleto = renderToStaticMarkup(<ColunasCarregando colunas={8} />);
    const tela = quadroNaTela();
    // Mesmo vao entre faixa e quadro, mesmo respiro e dois quadrados de 40px.
    expect(esqueleto).toMatch(
      /^<div aria-hidden="true" class="flex flex-col gap-1">/,
    );
    expect(tela).toMatch(/^<div class="flex flex-col gap-1">/);
    expect(esqueleto).toMatch(
      /<div class="flex items-center gap-2 pt-2 pb-1">/,
    );
    expect(tela).toMatch(
      /<div class="[^"]*flex items-center gap-2 [^"]*pt-2 pb-1">/,
    );
    expect(esqueleto.match(/size-10 rounded-md/g)).toHaveLength(2);
  });
});
