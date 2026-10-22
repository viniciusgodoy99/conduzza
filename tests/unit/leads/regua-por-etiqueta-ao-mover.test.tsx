import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O dialogo renderiza no lugar (sem portal), so quando aberto.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-parte="dialogo">{children}</div> : null,
  DialogContent: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
}));

import {
  decidirMudancaDeEtapa,
  DialogoMoverParaEtapa,
  nomesDasReguas,
  OpcoesDeEtapa,
  reguasPorEtapa,
  type ConfirmacaoDeEtapa,
} from "@/components/leads/mudar-etapa";
import type { EtapaDaJornada } from "@/lib/domain/jornada";
import type { ReguaDaEtapa } from "@/lib/queries/leads";

// O aviso de regua ao mudar a etapa em Leads (onda 4, item 16): a etapa pode
// ter varias reguas ligadas (as com etiqueta e a geral), e cada lead recebe
// UMA, a que vale para as etiquetas dele (no lead ou na conversa; quem
// escolhe e o banco). Com a geral sozinha, o texto de antes; com varias, ou
// so com etiqueta, a confirmacao diz quais sao e que cada lead recebe a que
// vale para ele. O selo "Régua" do seletor de etapa fica igual, com os nomes
// no texto para leitor de tela.

function etapa(chave: string, nome: string): EtapaDaJornada {
  return {
    id: `id-${chave}`,
    chave,
    nome,
    posicao: 10,
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

const EM_CONTATO = etapa("em_contato", "Em contato");
const NOVO = etapa("novo", "Novo");

const PSIQUIATRIA: ReguaDaEtapa = {
  etapa: "em_contato",
  nome: "Psiquiatria",
  etiquetas: ["Psiquiatria"],
  etiquetas_modo: "qualquer",
};
const ODONTO: ReguaDaEtapa = {
  etapa: "em_contato",
  nome: "Odonto",
  etiquetas: ["Odontologia", "Implante"],
  etiquetas_modo: "todas",
};
const GERAL: ReguaDaEtapa = {
  etapa: "em_contato",
  nome: "Follow-up de Em contato",
  etiquetas: [],
  etiquetas_modo: "qualquer",
};
/** A regua de antes da onda 4: sem os campos do filtro, e a geral. */
const DE_ANTES: ReguaDaEtapa = { etapa: "novo", nome: "Régua do Novo" };

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([,.)])/g, "$1")
    .replace(/\( /g, "(")
    .trim();
}

describe("decidirMudancaDeEtapa com várias réguas", () => {
  it("uma lista por etapa, na ordem que chegou", () => {
    const mapa = reguasPorEtapa([PSIQUIATRIA, ODONTO, GERAL, DE_ANTES]);
    expect(mapa.get("em_contato")).toEqual([PSIQUIATRIA, ODONTO, GERAL]);
    expect(mapa.get("novo")).toEqual([DE_ANTES]);
    expect(nomesDasReguas([PSIQUIATRIA, ODONTO, GERAL])).toBe(
      "Psiquiatria, Odonto e Follow-up de Em contato",
    );
  });

  it("só a geral (inclusive a de antes da onda 4): o texto de sempre", () => {
    expect(decidirMudancaDeEtapa(NOVO, [DE_ANTES])).toEqual({
      tipo: "confirmar",
      regua: "Régua do Novo",
    });
    expect(decidirMudancaDeEtapa(EM_CONTATO, [GERAL])).toEqual({
      tipo: "confirmar",
      regua: "Follow-up de Em contato",
    });
  });

  it("várias, ou só com etiqueta: confirma com a lista", () => {
    expect(
      decidirMudancaDeEtapa(EM_CONTATO, [PSIQUIATRIA, ODONTO, GERAL]),
    ).toEqual({
      tipo: "confirmar",
      regua: "Psiquiatria, Odonto e Follow-up de Em contato",
      reguas: [PSIQUIATRIA, ODONTO, GERAL],
    });
    expect(decidirMudancaDeEtapa(EM_CONTATO, [PSIQUIATRIA])).toEqual({
      tipo: "confirmar",
      regua: "Psiquiatria",
      reguas: [PSIQUIATRIA],
    });
  });

  it("sem régua na etapa, move direto; sem como saber, confirma", () => {
    expect(decidirMudancaDeEtapa(NOVO, [PSIQUIATRIA])).toEqual({
      tipo: "mover",
    });
    expect(decidirMudancaDeEtapa(NOVO, null)).toEqual({
      tipo: "confirmar",
      regua: null,
    });
  });
});

describe("a confirmação de mover", () => {
  function dialogo(
    confirmacao: ConfirmacaoDeEtapa,
    quem: ComponentProps<typeof DialogoMoverParaEtapa>["quem"],
  ): string {
    return texto(
      renderToStaticMarkup(
        <DialogoMoverParaEtapa
          confirmacao={confirmacao}
          quem={quem}
          aoCancelar={() => undefined}
          aoConfirmar={() => undefined}
        />,
      ),
    );
  }

  const VARIAS: ConfirmacaoDeEtapa = {
    chave: "em_contato",
    nome: "Em contato",
    regua: "Psiquiatria, Odonto e Follow-up de Em contato",
    reguas: [PSIQUIATRIA, ODONTO, GERAL],
  };

  it("um lead: recebe a que vale para as etiquetas dele", () => {
    const lido = dialogo(VARIAS, {
      tipo: "lead",
      nome: "Maria",
      autorizado: true,
    });
    expect(lido).toContain(
      "A etapa Em contato tem 3 réguas de follow-up ligadas (Psiquiatria, Odonto e Follow-up de Em contato).",
    );
    expect(lido).toContain(
      "Este lead tem autorização e recebe a régua que vale para as etiquetas dele (Psiquiatria, Odontologia e Implante ou a geral).",
    );
    expect(lido).not.toContain("não recebe nada");
  });

  it("sem a geral: quem não tem as etiquetas não recebe nada", () => {
    const lido = dialogo(
      {
        chave: "em_contato",
        nome: "Em contato",
        regua: "Psiquiatria",
        reguas: [PSIQUIATRIA],
      },
      { tipo: "lead", nome: "Maria", autorizado: true },
    );
    expect(lido).toContain(
      "A etapa Em contato tem régua de follow-up ligada (Psiquiatria).",
    );
    expect(lido).toContain(
      "recebe a régua que vale para as etiquetas dele (Psiquiatria). Sem nenhuma dessas etiquetas, não recebe nada.",
    );
  });

  it("sem autorização, o texto de sempre", () => {
    expect(
      dialogo(VARIAS, { tipo: "lead", nome: "Maria", autorizado: false }),
    ).toContain(
      "Este lead está sem autorização e não recebe nada por esta mudança.",
    );
  });

  it("a seleção: cada lead recebe a que vale para as etiquetas dele", () => {
    const lido = dialogo(VARIAS, { tipo: "selecao", total: 3, recebem: 2 });
    expect(lido).toContain(
      "2 leads com autorização recebem a régua que vale para as etiquetas de cada um (Psiquiatria, Odontologia e Implante ou a geral).",
    );
    expect(lido).toContain(
      "Os outros 1 não recebem nada por esta mudança (estão sem autorização ou já estavam nesta etapa).",
    );
    expect(lido).not.toMatch(/[–—]/);
  });

  it("só a geral: os textos de antes, sem mudança", () => {
    const lido = dialogo(
      {
        chave: "em_contato",
        nome: "Em contato",
        regua: "Follow-up de Em contato",
      },
      { tipo: "lead", nome: "Maria", autorizado: true },
    );
    expect(lido).toContain(
      "A etapa Em contato tem régua de follow-up ligada (Follow-up de Em contato).",
    );
    expect(lido).toContain(
      "Este lead tem autorização e vai receber as mensagens automáticas dela.",
    );
  });
});

describe("o selo Régua no seletor de etapa", () => {
  it("fica igual, com os nomes de todas para leitor de tela", () => {
    const html = renderToStaticMarkup(
      <OpcoesDeEtapa
        jornada={[NOVO, EM_CONTATO]}
        reguas={[PSIQUIATRIA, GERAL, DE_ANTES]}
        aoEscolher={() => undefined}
      />,
    );
    expect(html.match(/lucide-workflow/g)).toHaveLength(2);
    expect(html).toContain(" de follow-up ligada: Régua do Novo");
    expect(html).toContain(
      " de follow-up: 2 ligadas, Psiquiatria e Follow-up de Em contato",
    );
  });
});
