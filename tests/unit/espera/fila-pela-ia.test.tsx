import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  APPOINTMENT_STATUS,
  CONVERSATION_STATUS,
  STATUS_TONE_VARS,
} from "@/lib/design/status";
import { ROLES } from "@/lib/domain/permissions";
import type { EntradaDaEspera } from "@/lib/queries/espera";

// AG5 na Tela 10 (a IA coloca o paciente na lista de espera; desenho, secao
// 6): a entrada que a IA criou leva o selo "Pela IA" em 3 camadas (Sparkles,
// tom ai e o rotulo, o mesmo sentido do selo da IA no Atendimento), com a
// frase inteira para o leitor de tela; o pagamento declarado aparece na
// linha da preferencia; "Abrir conversa" (40px) respeita o papel (quem ve
// todas as conversas abre; o profissional ve o botao desabilitado, com a
// dica) e fica fora das acoes de editar a fila (quem so le a fila abre a
// conversa); a entrada da recepcao fica como era; o claro e o escuro vem dos
// tokens. Tudo renderizado no servidor; nada chama acao nem rede.

vi.mock("@/app/(app)/espera/actions", () => ({
  moverPrioridadeAction: vi.fn(),
  removerDaEsperaAction: vi.fn(),
}));
// A dica do desabilitado vira atributo legivel (o conteudo do tooltip vai
// para um portal, que a renderizacao estatica nao mostra).
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

const { FilaDeEspera, LEITURA_DA_ORIGEM_PELA_IA, ORIGEM_PELA_IA } =
  await import("@/components/espera/fila");
const {
  acessoAConversaDaEspera,
  DICA_CONVERSA_SO_ATRIBUIDA,
  fetchFilaDeEspera,
  pagamentoDaEntrada,
} = await import("@/lib/queries/espera");

const FUSO = "America/Fortaleza";
const CONVERSA = "c0000000-0000-4000-8000-0000000000aa";
const DICA_DA_FILA =
  "Seu perfil vê a lista de espera, sem alterar (quem altera é a recepção e a gestão)";

function entrada(campos: Partial<EntradaDaEspera> = {}): EntradaDaEspera {
  return {
    id: "w1",
    contact_id: "k1",
    procedure_id: "p1",
    professional_id: "r1",
    preferred_shifts: ["manha"],
    preferred_weekdays: [1, 3],
    priority: 0,
    created_at: "2026-10-27T13:00:00.000Z",
    origem: "equipe",
    conversation_id: null,
    insurance_id: null,
    particular: null,
    contact: { id: "k1", name: "Maria Souza", phone_e164: "+5585999990001" },
    procedure: { id: "p1", name: "Limpeza de pele" },
    professional: { id: "r1", name: "Dra. Ana Lima" },
    insurance: null,
    ...campos,
  };
}

const PELA_IA = entrada({
  id: "w2",
  contact_id: "k2",
  origem: "ia",
  conversation_id: CONVERSA,
  particular: true,
  contact: { id: "k2", name: "João Lima", phone_e164: "+5585999990002" },
});

function fila(
  entradas: EntradaDaEspera[],
  props: Partial<{
    podeEditar: boolean;
    podeAbrirConversa: boolean;
    dicaAbrirConversa: string;
  }> = {},
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <FilaDeEspera
        entradas={entradas}
        timezone={FUSO}
        podeEditar={props.podeEditar ?? true}
        dicaSemPermissao={DICA_DA_FILA}
        podeAbrirConversa={props.podeAbrirConversa ?? true}
        dicaAbrirConversa={props.dicaAbrirConversa ?? ""}
        aoMudar={() => undefined}
      />
    </TooltipProvider>,
  );
}

function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

/** O <li> da entrada, pelo nome do paciente. */
function linhaDe(html: string, nome: string): string {
  const linhas = html.match(/<li\b(?:(?!<\/li>).)*<\/li>/g) ?? [];
  const achada = linhas.find((linha) => linha.includes(nome));
  if (!achada) {
    throw new Error(`linha de ${nome} nao encontrada`);
  }
  return achada;
}

/** Os chips "Pela IA" (as pilulas com o rotulo) de um trecho. */
function selos(html: string): string[] {
  return (
    html.match(/<span data-size="sm"(?:(?!<\/span><\/span>).)*Pela IA/g) ?? []
  );
}

// ---------------------------------------------------------------------------

describe("o selo Pela IA", () => {
  it("é um status em 3 camadas: Sparkles, tom ai e o rótulo", () => {
    expect(ORIGEM_PELA_IA).toEqual({
      label: "Pela IA",
      tone: "ai",
      icon: Sparkles,
    });
    // O mesmo sentido (e a mesma forma e cor) do selo da IA no Atendimento:
    // o Sparkles e sempre do tom ai.
    expect(CONVERSATION_STATUS.ia_atendendo.icon).toBe(Sparkles);
    expect(CONVERSATION_STATUS.ia_atendendo.tone).toBe(ORIGEM_PELA_IA.tone);
    // Nenhum status de consulta usa a forma da IA.
    for (const definicao of Object.values(APPOINTMENT_STATUS)) {
      expect(definicao.icon).not.toBe(Sparkles);
    }
  });

  it("aparece só na entrada da IA, ao lado de entrou em, com a frase inteira para o leitor de tela", () => {
    const html = fila([entrada(), PELA_IA]);
    const daIa = linhaDe(html, "João Lima");
    const daEquipe = linhaDe(html, "Maria Souza");

    // Duas copias: a da grade estreita e a da larga (uma some pelo CSS).
    expect(selos(daIa)).toHaveLength(2);
    expect(selos(daEquipe)).toHaveLength(0);
    expect(daEquipe).not.toContain(LEITURA_DA_ORIGEM_PELA_IA);

    // Forma: o icone Sparkles; rotulo: o texto; cor: o par de tokens do ai.
    for (const selo of selos(daIa)) {
      expect(selo).toContain("lucide-sparkles");
      expect(selo).toContain(`color:${STATUS_TONE_VARS.ai.text}`);
      expect(selo).toContain(`background-color:${STATUS_TONE_VARS.ai.bg}`);
    }
    // O leitor de tela le a frase, nao a sigla: o selo visivel fica de fora.
    expect(LEITURA_DA_ORIGEM_PELA_IA).toBe(
      "Entrou pela conversa com o assistente",
    );
    expect(daIa).toContain(
      `<span class="sr-only">${LEITURA_DA_ORIGEM_PELA_IA}</span>`,
    );
    expect(daIa).toMatch(
      /<span aria-hidden="true" class="inline-flex shrink-0"><span data-size="sm"/,
    );

    // Ao lado de "entrou em": na grade larga, na mesma celula da data.
    const celula = daIa.match(
      /<span class="sr-only">Entrou em <\/span><span class="cz-num">27\/10\/2026<\/span>(?:(?!<\/span><\/span><\/span><\/span>).)*/,
    )?.[0];
    expect(celula).toContain("Pela IA");
    // Na estreita, depois do "entrou em", fora do texto que corta.
    expect(daIa).toMatch(
      /entrou em <span class="cz-num">27\/10\/2026<\/span><\/span><span aria-hidden="true" class="inline-flex shrink-0">/,
    );
  });

  it("claro e escuro: o selo usa so os tokens, definidos nos dois temas", () => {
    expect(STATUS_TONE_VARS.ai).toEqual({
      marker: "var(--ai)",
      text: "var(--ai-text)",
      bg: "var(--ai-bg)",
    });
    const selo = selos(fila([PELA_IA]))[0] ?? "";
    expect(selo).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const css = readFileSync(
      join(process.cwd(), "app", "globals.css"),
      "utf-8",
    );
    const claro = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
    const escuro = css.slice(css.indexOf(".dark {"));
    for (const bloco of [claro, escuro]) {
      expect(bloco).toMatch(/--ai-text:/);
      expect(bloco).toMatch(/--ai-bg:/);
    }
  });
});

describe("o pagamento declarado", () => {
  it("Particular, o convênio com o plano, só o convênio, nada quando não declarou", () => {
    expect(pagamentoDaEntrada({ particular: true, insurance: null })).toBe(
      "Particular",
    );
    expect(
      pagamentoDaEntrada({
        particular: false,
        insurance: { id: "i1", name: "Unimed", plan_name: "Plano Ouro" },
      }),
    ).toBe("Unimed, Plano Ouro");
    expect(
      pagamentoDaEntrada({
        particular: false,
        insurance: { id: "i1", name: "Unimed", plan_name: "  " },
      }),
    ).toBe("Unimed");
    // O convenio existe (FK sem cascata), mas a leitura nao o trouxe.
    expect(pagamentoDaEntrada({ particular: false, insurance: null })).toBe(
      "Convênio",
    );
    expect(
      pagamentoDaEntrada({ particular: null, insurance: null }),
    ).toBeNull();
  });

  it("entra na linha da preferência, nas duas grades; a entrada da recepção fica como era", () => {
    const comConvenio = entrada({
      id: "w3",
      origem: "ia",
      conversation_id: CONVERSA,
      particular: false,
      insurance_id: "i1",
      insurance: { id: "i1", name: "Unimed", plan_name: "Plano Ouro" },
      contact: { id: "k3", name: "Ana Paula", phone_e164: "+5585999990003" },
    });
    const html = fila([entrada(), PELA_IA, comConvenio]);

    const particular = linhaDe(html, "João Lima");
    expect(particular).toContain('title="Manhã · seg, qua · Particular"');
    expect(texto(particular)).toContain(
      "Preferência: Manhã · seg, qua · pagamento: Particular",
    );
    // Grade estreita: telefone, preferencia, pagamento e a entrada.
    expect(texto(particular)).toContain(
      "Manhã · seg, qua · Particular · entrou em 27/10/2026",
    );

    expect(texto(linhaDe(html, "Ana Paula"))).toContain(
      "Manhã · seg, qua · pagamento: Unimed, Plano Ouro",
    );

    const daEquipe = linhaDe(html, "Maria Souza");
    expect(daEquipe).toContain('title="Manhã · seg, qua"');
    expect(texto(daEquipe)).not.toMatch(/Particular|pagamento|Unimed/);
  });
});

describe("Abrir conversa", () => {
  it("na entrada da IA: um link de 40px para a conversa, com o nome no rótulo", () => {
    const daIa = linhaDe(fila([entrada(), PELA_IA]), "João Lima");
    const link = daIa.match(
      /<a\b[^>]*aria-label="Abrir conversa de João Lima"[^>]*>/,
    )?.[0];
    expect(link).toBeDefined();
    expect(link).toContain(`href="/atendimento?conversa=${CONVERSA}"`);
    // size="icon" do Button: 40x40 (alvo de toque minimo).
    expect(link).toContain('data-size="icon"');
    expect(link).toContain("size-10");
    expect(daIa).toContain("lucide-message-square-text");
  });

  it("só na entrada da IA com conversa: a da recepção não tem, nem a da IA sem conversa", () => {
    const semConversa = entrada({
      id: "w4",
      origem: "ia",
      conversation_id: null,
      particular: true,
      contact: { id: "k4", name: "Sem Conversa", phone_e164: "+5585999990004" },
    });
    const html = fila([entrada(), semConversa]);
    expect(linhaDe(html, "Maria Souza")).not.toContain("Abrir conversa");
    expect(linhaDe(html, "Sem Conversa")).not.toContain("Abrir conversa");
    expect(html).not.toContain("/atendimento?conversa=");
  });

  it("profissional: visível, desabilitado, com a dica (sem link)", () => {
    const { pode, dica } = acessoAConversaDaEspera("profissional");
    expect(pode).toBe(false);
    expect(dica).toBe(DICA_CONVERSA_SO_ATRIBUIDA);
    const daIa = linhaDe(
      fila([PELA_IA], {
        podeEditar: false,
        podeAbrirConversa: pode,
        dicaAbrirConversa: dica,
      }),
      "João Lima",
    );
    expect(daIa).not.toContain("/atendimento?conversa=");
    expect(daIa).toMatch(
      new RegExp(
        `<span data-dica="${DICA_CONVERSA_SO_ATRIBUIDA}"><button[^>]*aria-label="Abrir conversa de João Lima"[^>]*disabled=""`,
      ),
    );
  });

  it("somente leitura: abre a conversa, mesmo sem poder editar a fila", () => {
    const { pode, dica } = acessoAConversaDaEspera("leitura");
    expect(pode).toBe(true);
    expect(dica).toBe("");
    const daIa = linhaDe(
      fila([PELA_IA], {
        podeEditar: false,
        podeAbrirConversa: pode,
        dicaAbrirConversa: dica,
      }),
      "João Lima",
    );
    // O link fica fora da dica de quem nao edita a fila...
    expect(daIa).toContain(`href="/atendimento?conversa=${CONVERSA}"`);
    const dicaDaFila = daIa.indexOf(`data-dica="${DICA_DA_FILA}"`);
    expect(dicaDaFila).toBeGreaterThan(daIa.indexOf("Abrir conversa de"));
    // ...e as acoes de editar continuam desabilitadas.
    for (const rotulo of ["Subir", "Descer", "Remover"]) {
      expect(daIa, rotulo).toMatch(
        new RegExp(
          `<button[^>]*aria-label="${rotulo} João Lima[^"]*"[^>]*disabled=""`,
        ),
      );
    }
  });

  it("o papel decide: só quem vê todas as conversas do Atendimento", () => {
    const pode = Object.fromEntries(
      ROLES.map((papel) => [papel, acessoAConversaDaEspera(papel).pode]),
    );
    expect(pode).toEqual({
      admin: true,
      gestor: true,
      recepcao: true,
      profissional: false,
      leitura: true,
    });
  });
});

describe("estados e cópia", () => {
  it("vazio: diz que dá para adicionar também pelo assistente", () => {
    const html = fila([]);
    expect(texto(html)).toContain("Ninguém na lista de espera");
    expect(texto(html)).toContain(
      "Dá para adicionar por aqui, pela ficha do paciente, pela conversa ou pelo assistente.",
    );
  });

  it("sem travessão e sem jargão nos textos novos", () => {
    const amostras = [
      ORIGEM_PELA_IA.label,
      LEITURA_DA_ORIGEM_PELA_IA,
      DICA_CONVERSA_SO_ATRIBUIDA,
      texto(fila([PELA_IA])),
      texto(fila([])),
    ];
    for (const amostra of amostras) {
      expect(amostra).not.toMatch(/[—–]/);
      expect(amostra).not.toMatch(/\b(tenant|handoff|opt-in|slot|origem)\b/i);
    }
  });
});

describe("a leitura da fila (fetchFilaDeEspera)", () => {
  function supabaseCom(linhas: Record<string, unknown>[]) {
    const pedido: { colunas?: string } = {};
    const consulta = {
      select(colunas: string) {
        pedido.colunas = colunas;
        return consulta;
      },
      eq: () => consulta,
      order: () => consulta,
      limit: async () => ({ data: linhas, error: null }),
    };
    return {
      pedido,
      cliente: { from: () => consulta } as unknown as SupabaseClient,
    };
  }

  it("lê a origem, a conversa, o pagamento e o convênio pela FK", async () => {
    const { pedido, cliente } = supabaseCom([
      {
        id: "w1",
        origem: "ia",
        conversation_id: CONVERSA,
        insurance_id: "i1",
        particular: false,
        contact: [{ id: "k1", name: "Maria", phone_e164: "+5585" }],
        procedure: { id: "p1", name: "Limpeza" },
        professional: null,
        insurance: [{ id: "i1", name: "Unimed", plan_name: "Plano Ouro" }],
      },
      // Valor fora do CHECK (ou a coluna ausente) le como da equipe.
      { id: "w2", origem: "robo", conversation_id: 7, particular: "sim" },
    ]);
    const [daIa, estranha] = await fetchFilaDeEspera(cliente, "clinica");
    for (const coluna of [
      "origem",
      "conversation_id",
      "insurance_id",
      "particular",
      "insurance:insurance_id (id, name, plan_name)",
    ]) {
      expect(pedido.colunas).toContain(coluna);
    }
    expect(daIa).toMatchObject({
      origem: "ia",
      conversation_id: CONVERSA,
      insurance_id: "i1",
      particular: false,
      contact: { id: "k1", name: "Maria", phone_e164: "+5585" },
      insurance: { id: "i1", name: "Unimed", plan_name: "Plano Ouro" },
    });
    expect(estranha).toMatchObject({
      origem: "equipe",
      conversation_id: null,
      insurance_id: null,
      particular: null,
      insurance: null,
    });
  });
});
