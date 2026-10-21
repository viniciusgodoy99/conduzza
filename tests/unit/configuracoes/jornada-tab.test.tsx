import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { EtapaDaJornada } from "@/lib/domain/jornada";

// A aba "Jornada e conversões" de Configuracoes com as etapas de sistema da
// onda 3 (21/10/2026, migration 20261023100000): Aguardando resposta e Em
// contato ganham o cadeado, a frase do papel e somem do Excluir; a seta que
// trocaria duas etapas do caminho do lead (Novo, Aguardando resposta, Em
// contato, Agendou e Compareceu) fica visivel e desabilitada, com a dica
// dizendo a ordem com os nomes da clinica (decisao D6); o rodape cita as
// etapas de sistema. E tudo continua de pe com o banco de antes da
// migration, em que as duas chegam sem papel.
//
// O projeto nao tem jsdom: a tela e lida pelo HTML de renderToStaticMarkup.
// A dica (Tooltip do Radix) nao aparece no HTML estatico, entao o
// DisabledWithHint vira um span com a dica num atributo.

vi.mock("@/app/(app)/configuracoes/actions", () => ({
  salvarEtapaDaJornadaAction: vi.fn(),
  reordenarEtapaDaJornadaAction: vi.fn(),
  excluirEtapaDaJornadaAction: vi.fn(),
}));
vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

const { JornadaTab } = await import("@/components/configuracoes/jornada-tab");
const { etapaDeSistema } = await import("@/lib/domain/jornada");

const DICA_DE_PERMISSAO =
  "Somente administradores e gestores alteram as configurações";
const DICA_DA_ORDEM =
  "A ordem das etapas de sistema é fixa: Novo, Aguardando resposta, Em contato, Agendou e Compareceu.";
const FRASE_DO_AGUARDANDO =
  "Etapa de sistema: quando a IA passa a conversa de um lead novo para a equipe, o lead vem para cá.";
const FRASE_DO_EM_CONTATO =
  "Etapa de sistema: quando a equipe assume, inicia, passa para um colega ou reabre a conversa de um lead novo ou que aguarda resposta, o lead vem para cá.";

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
    conversao_ativa: true,
    is_sale: false,
    is_first_contact: false,
    value_source: null,
    value_cents: null,
  };
}

/** A jornada semeada depois da migration, com uma etapa livre no fim. */
const NOVA: EtapaDaJornada[] = [
  etapa("novo", "Novo", "entrada", 10),
  etapa("aguardando_resposta", "Aguardando resposta", "aguardando", 20),
  etapa("em_contato", "Em contato", "em_contato", 30),
  etapa("agendou", "Agendou", "agendou", 40),
  etapa("compareceu", "Compareceu", "compareceu", 50),
  etapa("perdido", "Perdido", "perdido", 60),
  etapa("comprou_pacote", "Comprou pacote", null, 70),
];

/** A mesma clinica com o banco de antes: as duas etapas sem papel. */
const VELHA: EtapaDaJornada[] = [
  etapa("novo", "Novo", "entrada", 10),
  etapa("em_contato", "Em contato", null, 20),
  etapa("aguardando_resposta", "Aguardando resposta", null, 30),
  etapa("agendou", "Agendou", "agendou", 40),
  etapa("compareceu", "Compareceu", "compareceu", 50),
  etapa("perdido", "Perdido", "perdido", 60),
];

function aba(jornada: EtapaDaJornada[], podeGerenciar = true): string {
  return renderToStaticMarkup(
    <JornadaTab
      jornada={jornada}
      podeGerenciar={podeGerenciar}
      dica={DICA_DE_PERMISSAO}
    />,
  );
}

type Seta = { desabilitada: boolean; dica: string | null };

/**
 * A seta pelo aria-label ("Subir Novo"): desabilitada? e a dica do span que
 * a envolve (o DisabledWithHint falso), se houver. A dica de permissao
 * envolve as duas setas juntas, dentro de um span de layout.
 */
function seta(html: string, rotulo: string): Seta {
  const botao = new RegExp(`<button(?=[^>]*aria-label="${rotulo}")[^>]*>`).exec(
    html,
  );
  expect(botao, `seta "${rotulo}"`).not.toBeNull();
  const inicio = botao!.index;
  const antes = html.slice(0, inicio);
  // O span de dica mais proximo que ainda esta aberto antes da seta.
  const aberturas = [...antes.matchAll(/<span data-dica="([^"]*)">/g)];
  let dica: string | null = null;
  for (const abertura of aberturas.reverse()) {
    const depois = antes.slice(abertura.index! + abertura[0].length);
    const abertas = (depois.match(/<span\b/g) ?? []).length;
    const fechadas = (depois.match(/<\/span>/g) ?? []).length;
    if (abertas >= fechadas) {
      dica = abertura[1] ?? null;
      break;
    }
  }
  return { desabilitada: /\sdisabled=""/.test(botao![0]), dica };
}

describe("aba Jornada: as etapas de sistema da onda 3", () => {
  it("as seis etapas de sistema têm o cadeado; a livre não", () => {
    const html = aba(NOVA);
    expect(html.match(/<span>Sistema<\/span>/g) ?? []).toHaveLength(6);
  });

  it("Aguardando resposta e Em contato explicam o que move o lead para lá", () => {
    const html = aba(NOVA);
    expect(html).toContain(FRASE_DO_AGUARDANDO);
    expect(html).toContain(FRASE_DO_EM_CONTATO);
    // As quatro de antes continuam com as frases delas.
    expect(html).toContain("Etapa de sistema: todo contato novo nasce aqui.");
    expect(html).toContain(
      "Etapa de sistema: marcar como perdido exige o motivo.",
    );
  });

  it("sem Excluir para etapa de sistema: só a livre sai da jornada", () => {
    // O formulario so abre com clique (sem DOM aqui): a decisao do botao
    // Excluir e a mesma funcao que desenha o cadeado.
    for (const linha of NOVA) {
      expect(etapaDeSistema(linha), linha.chave).toBe(linha.papel !== null);
    }
    expect(
      NOVA.filter((linha) => !etapaDeSistema(linha)).map((l) => l.chave),
    ).toEqual(["comprou_pacote"]);
    // E a tela fechada nao oferece Excluir de etapa nenhuma.
    expect(aba(NOVA)).not.toContain("Excluir etapa");
  });

  it("o rodapé cita as seis etapas de sistema e a ordem fixa", () => {
    const html = aba(NOVA);
    expect(html).toContain(
      "As etapas de sistema (Novo, Aguardando resposta, Em contato, Agendou, Compareceu e Perdido) podem mudar de nome e de lugar, nunca sair",
    );
    expect(html).toContain(
      "A ordem entre Novo, Aguardando resposta, Em contato, Agendou e Compareceu não muda",
    );
    expect(html).toContain("Os eventos de conversão ainda não são enviados");
  });
});

describe("aba Jornada: setas da ordem fixa (decisão D6)", () => {
  it("a seta que trocaria duas etapas do caminho fica desabilitada, com a dica", () => {
    const html = aba(NOVA);
    for (const rotulo of [
      "Descer Novo",
      "Subir Aguardando resposta",
      "Descer Aguardando resposta",
      "Subir Em contato",
      "Descer Em contato",
      "Subir Agendou",
      "Descer Agendou",
      "Subir Compareceu",
    ]) {
      expect(seta(html, rotulo), rotulo).toEqual({
        desabilitada: true,
        dica: DICA_DA_ORDEM,
      });
    }
  });

  it("Perdido e a etapa livre continuam indo para qualquer lugar", () => {
    const html = aba(NOVA);
    for (const rotulo of [
      "Descer Compareceu",
      "Subir Perdido",
      "Descer Perdido",
      "Subir Comprou pacote",
    ]) {
      expect(seta(html, rotulo), rotulo).toEqual({
        desabilitada: false,
        dica: null,
      });
    }
  });

  it("nas pontas a seta fica desabilitada sem dica (não há troca)", () => {
    const html = aba(NOVA);
    expect(seta(html, "Subir Novo")).toEqual({
      desabilitada: true,
      dica: null,
    });
    expect(seta(html, "Descer Comprou pacote")).toEqual({
      desabilitada: true,
      dica: null,
    });
  });

  it("a dica usa os nomes que a clínica deu", () => {
    const renomeada = NOVA.map((linha) =>
      linha.papel === "em_contato"
        ? { ...linha, nome: "Contato inicial" }
        : linha,
    );
    const html = aba(renomeada);
    expect(seta(html, "Subir Contato inicial").dica).toBe(
      "A ordem das etapas de sistema é fixa: Novo, Aguardando resposta, Contato inicial, Agendou e Compareceu.",
    );
  });

  it("quem não gerencia vê as setas desabilitadas, com a dica de permissão", () => {
    const html = aba(NOVA, false);
    for (const rotulo of [
      "Subir Novo",
      "Descer Novo",
      "Subir Perdido",
      "Descer Compareceu",
      "Subir Comprou pacote",
    ]) {
      expect(seta(html, rotulo), rotulo).toEqual({
        desabilitada: true,
        dica: DICA_DE_PERMISSAO,
      });
    }
    // Nenhuma dica da ordem para quem nem pode mexer.
    expect(html).not.toContain(`data-dica="${DICA_DA_ORDEM}"`);
  });
});

describe("aba Jornada com o banco de antes da migration", () => {
  it("Em contato e Aguardando resposta seguem livres: sem cadeado, sem frase", () => {
    const html = aba(VELHA);
    expect(html.match(/<span>Sistema<\/span>/g) ?? []).toHaveLength(4);
    expect(html).not.toContain(FRASE_DO_AGUARDANDO);
    expect(html).not.toContain(FRASE_DO_EM_CONTATO);
  });

  // Revisao de 21/10/2026: a migration poe Aguardando resposta logo antes
  // de Em contato e preserva o resto da ordem, entao Novo, Em contato,
  // Agendou e Compareceu ja ficam na ordem fixa antes dela (Em contato pela
  // chave). Aguardando resposta sem papel continua livre.
  it("Em contato já não passa de Novo; Aguardando resposta troca como livre", () => {
    const html = aba(VELHA);
    const dicaDeAntes =
      "A ordem das etapas de sistema é fixa: Novo, Em contato, Agendou e Compareceu.";
    expect(seta(html, "Descer Novo")).toEqual({
      desabilitada: true,
      dica: dicaDeAntes,
    });
    expect(seta(html, "Subir Em contato")).toEqual({
      desabilitada: true,
      dica: dicaDeAntes,
    });
    expect(seta(html, "Descer Em contato")).toEqual({
      desabilitada: false,
      dica: null,
    });
    expect(seta(html, "Subir Agendou")).toEqual({
      desabilitada: false,
      dica: null,
    });
    // Agendou e Compareceu ja eram de sistema: a ordem delas trava ja.
    expect(seta(html, "Descer Agendou").desabilitada).toBe(true);
  });

  it("o rodapé lista só as quatro de sistema de então e a ordem com Em contato", () => {
    const html = aba(VELHA);
    expect(html).toContain(
      "As etapas de sistema (Novo, Agendou, Compareceu e Perdido)",
    );
    expect(html).toContain(
      "A ordem entre Novo, Em contato, Agendou e Compareceu não muda",
    );
  });
});

describe("aba Jornada: vazio e texto", () => {
  it("jornada vazia mostra o vazio", () => {
    const html = aba([]);
    expect(html).toContain("Nenhuma etapa na jornada");
  });

  it("nenhum travessão na tela", () => {
    for (const html of [aba(NOVA), aba(VELHA), aba(NOVA, false), aba([])]) {
      expect(html).not.toMatch(/[–—]/);
    }
  });
});
