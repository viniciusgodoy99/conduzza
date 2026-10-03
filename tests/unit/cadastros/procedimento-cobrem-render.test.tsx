import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Montagem da secao "Convênios que cobrem este procedimento" (convenio pelo
// profissional, decisao do dono em 02/10/2026) no modal do Procedimento,
// acima de "Quem faz e convênios". O Dialog do Radix renderiza num portal,
// que nao existe no servidor: aqui ele vira marcacao simples e sempre
// aberta, entao o modal aparece no estado de procedimento novo (nada
// marcado). Interacao (marcar, desmarcar, Salvar) fica nos e2e e na ordem de
// gravacao em procedimento-salvar.test.ts.

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => (
    <div data-parte="dialog">{children}</div>
  ),
  DialogContent: ({ children }: ComponentProps<"div">) => (
    <div data-parte="conteudo">{children}</div>
  ),
  DialogHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => (
    <div data-parte="rodape">{children}</div>
  ),
}));
vi.mock("@/app/(app)/cadastros/actions", () => ({
  salvarProcedimentoAction: vi.fn(),
  sincronizarVinculosDoProcedimentoAction: vi.fn(),
}));

import {
  AJUDA_DE_QUEM_FAZ,
  AJUDA_DOS_CONVENIOS_QUE_COBREM,
  ProcedimentosTab,
  SO_PARTICULAR,
  VAZIO_DOS_CONVENIOS_QUE_COBREM,
} from "@/components/cadastros/procedimentos-tab";
import { ROTULO_DOS_PLANOS } from "@/lib/domain/vinculos-do-procedimento";
import type { Catalogo, Convenio } from "@/lib/queries/catalogo";

const CONVENIO_BASE: Omit<Convenio, "id" | "name" | "active"> = {
  plan_name: null,
  requires_card: false,
  notes: null,
};

function catalogo(convenios: Convenio[]): Catalogo {
  return {
    profissionais: [],
    jornadas: [],
    recursos: [],
    procedimentos: [],
    convenios,
    vinculos: [],
    pacotes: [],
    unidades: [],
  };
}

function html(convenios: Convenio[]): string {
  return renderToStaticMarkup(
    <ProcedimentosTab
      catalogo={catalogo(convenios)}
      matriz={{ atendimentos: [], coberturas: [] }}
      podeEditar
      dica="Somente administradores e gestores alteram os cadastros."
      aoMudar={() => undefined}
      timezone="America/Fortaleza"
    />,
  );
}

// O React escapa as aspas no HTML estatico.
function noHtml(texto: string): string {
  return texto.replaceAll('"', "&quot;");
}

describe("seção Convênios que cobrem no modal do Procedimento", () => {
  it("fica acima de Quem faz e convênios, com a ajuda nova", () => {
    const saida = html([
      { ...CONVENIO_BASE, id: "conv-unimed", name: "Unimed", active: true },
    ]);
    const cobrem = saida.indexOf(ROTULO_DOS_PLANOS);
    const quemFaz = saida.indexOf("Quem faz e convênios</h3>");
    expect(cobrem).toBeGreaterThan(-1);
    expect(quemFaz).toBeGreaterThan(cobrem);
    expect(saida).toContain(AJUDA_DOS_CONVENIOS_QUE_COBREM);
    expect(saida).toContain(noHtml(AJUDA_DE_QUEM_FAZ));
    // Grupo de caixas com legenda (o nome que os e2e procuram).
    expect(saida).toMatch(
      new RegExp(`<fieldset[^>]*>\\s*<legend[^>]*>${ROTULO_DOS_PLANOS}`, "u"),
    );
    expect(saida).toContain("Unimed");
  });

  it("procedimento novo, sem nada marcado: só Particular", () => {
    const saida = html([
      { ...CONVENIO_BASE, id: "conv-unimed", name: "Unimed", active: true },
    ]);
    expect(saida).toContain(SO_PARTICULAR);
    expect(saida).toContain('aria-live="polite"');
  });

  it("sem convênio ativo para oferecer: só o texto, sem atalho (D6)", () => {
    const saida = html([
      { ...CONVENIO_BASE, id: "conv-amil", name: "Amil", active: false },
    ]);
    expect(saida).toContain(VAZIO_DOS_CONVENIOS_QUE_COBREM);
    // Inativo nao marcado nem gravado nao e oferecido.
    expect(saida).not.toContain("Amil");
    expect(saida).not.toContain(SO_PARTICULAR);
  });
});
