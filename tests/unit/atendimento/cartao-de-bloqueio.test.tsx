import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const acoes = vi.hoisted(() => ({ ler: vi.fn() }));
vi.mock("@/app/(app)/atendimento/actions", () => ({
  lerRascunhoBloqueadoAction: acoes.ler,
}));

import {
  ComplianceBlockCard,
  ConteudoDoRascunho,
  ERRO_DAS_DECISOES,
  rotuloDaRegra,
  TEXTOS_DO_BLOQUEIO,
} from "@/components/atendimento/cartao-de-bloqueio";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ComplianceDecision } from "@/lib/queries/conversations";

// Cartao de bloqueio de conformidade no fio (E3): titulo e rotulo do botao
// que o e2e le; a conversa passada "para a equipe"; o rascunho (dado de
// saude em potencial) so para o super admin ate o dono decidir (D25), lido
// so ao abrir o dialogo; para os outros, o botao visivel e desabilitado com
// a dica. O fio nunca carrega o texto do rascunho.

const DECISAO: ComplianceDecision = {
  id: "55555555-5555-4555-8555-555555555555",
  message_id: null,
  compliance_rule: "triagem",
  escalation_reason: "conformidade",
  created_at: "2026-10-13T15:00:00.000Z",
};

function cartao(podeVerRascunho: boolean, decisao = DECISAO): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ComplianceBlockCard
        decision={decisao}
        podeVerRascunho={podeVerRascunho}
      />
    </TooltipProvider>,
  );
}

function aberturaDoBotao(html: string, texto: string): string {
  const indice = html.indexOf(`${texto}</button>`);
  expect(indice, texto).toBeGreaterThan(-1);
  const inicio = html.lastIndexOf("<button", indice);
  return html.slice(inicio, html.indexOf(">", inicio) + 1);
}

function comDica(html: string, texto: string): boolean {
  const indice = html.indexOf(`${texto}</button>`);
  const inicio = html.lastIndexOf("<button", indice);
  const antes = html.slice(Math.max(0, inicio - 200), inicio);
  return /<span[^>]*tabindex="0"[^>]*>$/.test(antes);
}

describe("cartão de bloqueio por papel", () => {
  it("o título e a linha, com a conversa passada para a equipe", () => {
    const html = cartao(false);
    expect(html).toContain("Resposta da IA bloqueada pela conformidade");
    expect(html).toContain(
      "Motivo: triagem de sintoma. A conversa foi passada para a equipe.",
    );
    expect(html).not.toContain("recepção");
  });

  it("super admin: Ver o que a IA ia responder habilitado (o texto só ao abrir)", () => {
    const html = cartao(true);
    expect(aberturaDoBotao(html, "Ver o que a IA ia responder")).not.toContain(
      'disabled=""',
    );
    expect(comDica(html, "Ver o que a IA ia responder")).toBe(false);
    // nada foi buscado so por desenhar o cartao
    expect(acoes.ler).not.toHaveBeenCalled();
  });

  it("os outros papéis: visível, desabilitado e com a dica", () => {
    const html = cartao(false);
    expect(aberturaDoBotao(html, "Ver o que a IA ia responder")).toContain(
      'disabled=""',
    );
    expect(comDica(html, "Ver o que a IA ia responder")).toBe(true);
    expect(TEXTOS_DO_BLOQUEIO.soEquipeConduzza).toBe(
      "Só a equipe Conduzza vê o rascunho bloqueado.",
    );
  });

  it("regra desconhecida: rótulo genérico", () => {
    expect(rotuloDaRegra(null)).toBe("regra de conformidade");
    expect(rotuloDaRegra("inventada")).toBe("regra de conformidade");
    expect(rotuloDaRegra("promessa_resultado")).toBe("promessa de resultado");
  });

  it("o tipo da decisão no fio não tem o rascunho", () => {
    // O cartao nao le blocked_draft: o grant novo nega a coluna a sessao.
    const fonte = readFileSync(
      "components/atendimento/cartao-de-bloqueio.tsx",
      "utf-8",
    );
    expect(fonte).not.toContain("blocked_draft");
  });
});

describe("o diálogo do rascunho em cada estado", () => {
  function conteudo(
    leitura: Parameters<typeof ConteudoDoRascunho>[0]["leitura"],
  ): string {
    return renderToStaticMarkup(
      <ConteudoDoRascunho leitura={leitura} aoTentarDeNovo={() => undefined} />,
    );
  }

  it("carregando", () => {
    const html = conteudo({ tipo: "carregando" });
    expect(html).toContain('role="status"');
    expect(html).toContain("Carregando o rascunho...");
  });

  it("erro, com Tentar de novo", () => {
    const html = conteudo({ tipo: "erro", texto: TEXTOS_DO_BLOQUEIO.erro });
    expect(html).toContain('role="alert"');
    expect(html).toContain(
      "Não foi possível carregar o rascunho. Tente de novo.",
    );
    expect(html).toContain("Tentar de novo</button>");
  });

  it("vazio: apagado pela retenção de 90 dias", () => {
    expect(conteudo({ tipo: "vazio" })).toContain(
      "O rascunho já foi apagado (guardamos por 90 dias).",
    );
  });

  it("o texto", () => {
    expect(conteudo({ tipo: "texto", texto: "Rascunho de teste" })).toContain(
      "Rascunho de teste",
    );
  });

  it("textos do contrato, sem travessão", () => {
    expect(TEXTOS_DO_BLOQUEIO.dialogoTitulo).toBe("Rascunho bloqueado");
    expect(TEXTOS_DO_BLOQUEIO.dialogoDescricao).toBe(
      "Registrado para auditoria. Este texto nunca foi enviado ao paciente.",
    );
    expect(ERRO_DAS_DECISOES).toBe(
      "Não foi possível carregar o registro da IA.",
    );
    for (const valor of Object.values(TEXTOS_DO_BLOQUEIO)) {
      const texto = typeof valor === "function" ? valor("x") : valor;
      expect(texto).not.toMatch(/[—–]/);
    }
  });
});
