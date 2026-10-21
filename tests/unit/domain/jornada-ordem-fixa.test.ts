import { describe, expect, it } from "vitest";

import {
  PAPEIS_DE_ETAPA,
  PAPEIS_EM_ORDEM_FIXA,
  dicaDaOrdemFixa,
  ehRecusaDaOrdemFixa,
  listaEmPortugues,
  rodapeDaJornada,
  trocaDeOrdemPermitida,
  type EtapaDaJornada,
} from "@/lib/domain/jornada";

// Ordem fixa das etapas de sistema (decisao D6 do dono, 21/10/2026): Novo,
// Aguardando resposta, Em contato, Agendou e Compareceu nao trocam de lugar
// entre si; Perdido e as etapas livres vao para qualquer lugar. A regra pura
// decide a seta da tela antes de o banco recusar (a RPC
// reordenar_etapa_da_jornada recusa a mesma troca com o hint
// ordem_de_sistema, migration 20261023100000). A dica sai com os nomes que a
// clinica deu.

type Etapa = Pick<EtapaDaJornada, "chave" | "nome" | "papel" | "posicao">;

const PADRAO: Etapa[] = [
  { chave: "novo", nome: "Novo", papel: "entrada", posicao: 10 },
  {
    chave: "aguardando_resposta",
    nome: "Aguardando resposta",
    papel: "aguardando",
    posicao: 20,
  },
  { chave: "em_contato", nome: "Em contato", papel: "em_contato", posicao: 30 },
  { chave: "agendou", nome: "Agendou", papel: "agendou", posicao: 40 },
  { chave: "compareceu", nome: "Compareceu", papel: "compareceu", posicao: 50 },
  { chave: "perdido", nome: "Perdido", papel: "perdido", posicao: 60 },
];

const DICA_PADRAO =
  "A ordem das etapas de sistema é fixa: Novo, Aguardando resposta, Em contato, Agendou e Compareceu.";

/** A jornada da Salud Care depois da migration (D5 = A): 15 etapas. */
const SALUD_CARE: Etapa[] = [
  { chave: "novo", nome: "Novo", papel: "entrada", posicao: 10 },
  {
    chave: "aguardando_resposta",
    nome: "Aguardando resposta",
    papel: "aguardando",
    posicao: 20,
  },
  {
    chave: "em_contato",
    nome: "Contato inicial",
    papel: "em_contato",
    posicao: 30,
  },
  ...Array.from({ length: 8 }, (_, indice) => ({
    chave: `follow_${indice + 1}`,
    nome: `Follow ${indice + 1}`,
    papel: null,
    posicao: 40 + indice * 10,
  })),
  { chave: "agendou", nome: "Agendou", papel: "agendou", posicao: 120 },
  {
    chave: "compareceu",
    nome: "Compareceu",
    papel: "compareceu",
    posicao: 130,
  },
  {
    chave: "comprou_homecare",
    nome: "Comprou HomeCare",
    papel: null,
    posicao: 140,
  },
  { chave: "perdido", nome: "Perdido", papel: "perdido", posicao: 150 },
];

describe("trocaDeOrdemPermitida: duas etapas de sistema do caminho não trocam", () => {
  it.each([
    ["novo", "descer"],
    ["aguardando_resposta", "subir"],
    ["aguardando_resposta", "descer"],
    ["em_contato", "subir"],
    ["em_contato", "descer"],
    ["agendou", "subir"],
    ["agendou", "descer"],
    ["compareceu", "subir"],
  ] as const)("%s ao %s: negada, com a dica", (chave, direcao) => {
    expect(trocaDeOrdemPermitida(PADRAO, chave, direcao)).toEqual({
      permitida: false,
      dica: DICA_PADRAO,
    });
  });

  it("Perdido troca com Compareceu e Compareceu desce para depois de Perdido", () => {
    expect(trocaDeOrdemPermitida(PADRAO, "perdido", "subir")).toEqual({
      permitida: true,
    });
    expect(trocaDeOrdemPermitida(PADRAO, "compareceu", "descer")).toEqual({
      permitida: true,
    });
  });

  it("na ponta não há troca: negada sem dica", () => {
    expect(trocaDeOrdemPermitida(PADRAO, "novo", "subir")).toEqual({
      permitida: false,
      dica: null,
    });
    expect(trocaDeOrdemPermitida(PADRAO, "perdido", "descer")).toEqual({
      permitida: false,
      dica: null,
    });
  });

  it("chave desconhecida: negada sem dica", () => {
    expect(trocaDeOrdemPermitida(PADRAO, "fantasma", "subir")).toEqual({
      permitida: false,
      dica: null,
    });
  });
});

describe("trocaDeOrdemPermitida: etapa livre passa por entre as de sistema", () => {
  const comLivre: Etapa[] = [
    ...PADRAO.slice(0, 2),
    { chave: "pediu_valor", nome: "Pediu valor", papel: null, posicao: 25 },
    ...PADRAO.slice(2),
  ];

  it("a livre entre Aguardando resposta e Em contato sobe e desce", () => {
    expect(trocaDeOrdemPermitida(comLivre, "pediu_valor", "subir")).toEqual({
      permitida: true,
    });
    expect(trocaDeOrdemPermitida(comLivre, "pediu_valor", "descer")).toEqual({
      permitida: true,
    });
  });

  it("a de sistema vizinha da livre troca com ela", () => {
    expect(
      trocaDeOrdemPermitida(comLivre, "aguardando_resposta", "descer"),
    ).toEqual({ permitida: true });
    expect(trocaDeOrdemPermitida(comLivre, "em_contato", "subir")).toEqual({
      permitida: true,
    });
  });

  it("Salud Care: os 8 follows entre Contato inicial e Agendou vão e voltam", () => {
    expect(trocaDeOrdemPermitida(SALUD_CARE, "follow_1", "subir")).toEqual({
      permitida: true,
    });
    expect(trocaDeOrdemPermitida(SALUD_CARE, "follow_8", "descer")).toEqual({
      permitida: true,
    });
    expect(trocaDeOrdemPermitida(SALUD_CARE, "em_contato", "descer")).toEqual({
      permitida: true,
    });
    // Aguardando resposta e Contato inicial, vizinhas, nao trocam.
    expect(trocaDeOrdemPermitida(SALUD_CARE, "em_contato", "subir")).toEqual({
      permitida: false,
      dica: "A ordem das etapas de sistema é fixa: Novo, Aguardando resposta, Contato inicial, Agendou e Compareceu.",
    });
  });
});

describe("a dica usa os nomes da clínica, na ordem fixa", () => {
  it("nomes trocados aparecem como a clínica deixou", () => {
    const renomeada = PADRAO.map((etapa) => ({
      ...etapa,
      nome:
        {
          entrada: "Chegou agora",
          aguardando: "Esperando a recepção",
          em_contato: "Conversando",
          agendou: "Marcou",
          compareceu: "Veio",
          perdido: "Desistiu",
        }[etapa.papel ?? "perdido"] ?? etapa.nome,
    }));
    expect(trocaDeOrdemPermitida(renomeada, "em_contato", "subir")).toEqual({
      permitida: false,
      dica: "A ordem das etapas de sistema é fixa: Chegou agora, Esperando a recepção, Conversando, Marcou e Veio.",
    });
  });

  it("a ordem da dica é a do papel, mesmo com a lista fora de ordem", () => {
    expect(dicaDaOrdemFixa([...PADRAO].reverse())).toBe(DICA_PADRAO);
  });

  it("sem nenhuma etapa de sistema, a frase sai sem a lista", () => {
    expect(dicaDaOrdemFixa([])).toBe("A ordem das etapas de sistema é fixa.");
  });
});

// Com o banco de antes da migration 20261023100000 (este codigo vai ao ar
// antes dela), Em contato e Aguardando resposta chegam sem papel e na ordem
// antiga. A migration poe Aguardando resposta logo antes de Em contato e
// preserva o resto, entao Novo, Em contato, Agendou e Compareceu ja tem de
// estar na ordem: a cadeia invertida nesse meio tempo faria a migration
// parar (jornada_fora_de_ordem), e sem a conferencia ficaria congelada pela
// D6 (achado da revisao de 21/10/2026). Em contato entra na cadeia pela
// chave, como o destino do Assumir; Aguardando resposta continua livre (a
// migration a recoloca de qualquer lugar).
describe("banco de antes da migration: Em contato já entra na ordem fixa pela chave", () => {
  const VELHA: Etapa[] = [
    { chave: "novo", nome: "Novo", papel: "entrada", posicao: 10 },
    { chave: "em_contato", nome: "Em contato", papel: null, posicao: 20 },
    {
      chave: "aguardando_resposta",
      nome: "Aguardando resposta",
      papel: null,
      posicao: 30,
    },
    { chave: "agendou", nome: "Agendou", papel: "agendou", posicao: 40 },
    {
      chave: "compareceu",
      nome: "Compareceu",
      papel: "compareceu",
      posicao: 50,
    },
    { chave: "perdido", nome: "Perdido", papel: "perdido", posicao: 60 },
  ];
  const DICA_VELHA =
    "A ordem das etapas de sistema é fixa: Novo, Em contato, Agendou e Compareceu.";

  it("Novo e Em contato não trocam; a dica cita Em contato", () => {
    expect(dicaDaOrdemFixa(VELHA)).toBe(DICA_VELHA);
    expect(trocaDeOrdemPermitida(VELHA, "novo", "descer")).toEqual({
      permitida: false,
      dica: DICA_VELHA,
    });
    expect(trocaDeOrdemPermitida(VELHA, "em_contato", "subir")).toEqual({
      permitida: false,
      dica: DICA_VELHA,
    });
  });

  it("Em contato não passa de Agendou", () => {
    const semAguardando = VELHA.filter(
      (etapa) => etapa.chave !== "aguardando_resposta",
    );
    expect(
      trocaDeOrdemPermitida(semAguardando, "em_contato", "descer"),
    ).toEqual({ permitida: false, dica: DICA_VELHA });
    expect(trocaDeOrdemPermitida(semAguardando, "agendou", "subir")).toEqual({
      permitida: false,
      dica: DICA_VELHA,
    });
  });

  it("Aguardando resposta sem papel continua livre: troca com as vizinhas", () => {
    for (const [chave, direcao] of [
      ["em_contato", "descer"],
      ["aguardando_resposta", "subir"],
      ["aguardando_resposta", "descer"],
      ["agendou", "subir"],
    ] as const) {
      expect(trocaDeOrdemPermitida(VELHA, chave, direcao), chave).toEqual({
        permitida: true,
      });
    }
  });

  it("Salud Care de antes (sem Aguardando resposta, Em contato renomeada)", () => {
    const saludDeAntes: Etapa[] = [
      { chave: "novo", nome: "Novo", papel: "entrada", posicao: 10 },
      {
        chave: "em_contato",
        nome: "Contato inicial",
        papel: null,
        posicao: 20,
      },
      { chave: "follow_1", nome: "Follow 1", papel: null, posicao: 30 },
      { chave: "agendou", nome: "Agendou", papel: "agendou", posicao: 40 },
      {
        chave: "compareceu",
        nome: "Compareceu",
        papel: "compareceu",
        posicao: 50,
      },
      { chave: "perdido", nome: "Perdido", papel: "perdido", posicao: 60 },
    ];
    expect(trocaDeOrdemPermitida(saludDeAntes, "em_contato", "subir")).toEqual({
      permitida: false,
      dica: "A ordem das etapas de sistema é fixa: Novo, Contato inicial, Agendou e Compareceu.",
    });
    expect(trocaDeOrdemPermitida(saludDeAntes, "em_contato", "descer")).toEqual(
      { permitida: true },
    );
  });

  it("clínica que excluiu Em contato antes da migration: só as quatro de então", () => {
    const semEmContato = VELHA.filter((etapa) => etapa.chave !== "em_contato");
    expect(dicaDaOrdemFixa(semEmContato)).toBe(
      "A ordem das etapas de sistema é fixa: Novo, Agendou e Compareceu.",
    );
    expect(trocaDeOrdemPermitida(semEmContato, "novo", "descer")).toEqual({
      permitida: true,
    });
  });

  it("depois da migration, Em contato é achada pelo papel, nunca por uma livre de mesma chave", () => {
    // Defesa: o papel vence a chave (a mesma regra do destino do Assumir).
    const comPapel: Etapa[] = [
      { chave: "novo", nome: "Novo", papel: "entrada", posicao: 10 },
      {
        chave: "contato_inicial",
        nome: "Contato inicial",
        papel: "em_contato",
        posicao: 20,
      },
      { chave: "em_contato", nome: "Livre", papel: null, posicao: 30 },
    ];
    expect(dicaDaOrdemFixa(comPapel)).toBe(
      "A ordem das etapas de sistema é fixa: Novo e Contato inicial.",
    );
    expect(trocaDeOrdemPermitida(comPapel, "em_contato", "subir")).toEqual({
      permitida: true,
    });
  });
});

describe("a ordem da tela é respeitada", () => {
  it("lista fora de ordem: decide pela posição", () => {
    const embaralhada = [PADRAO[3]!, PADRAO[0]!, PADRAO[5]!, PADRAO[2]!];
    // Ordem real: novo 10, em_contato 30, agendou 40, perdido 60.
    expect(trocaDeOrdemPermitida(embaralhada, "agendou", "subir")).toEqual({
      permitida: false,
      dica: "A ordem das etapas de sistema é fixa: Novo, Em contato e Agendou.",
    });
    expect(trocaDeOrdemPermitida(embaralhada, "agendou", "descer")).toEqual({
      permitida: true,
    });
  });

  it("empate de posição mantém o desempate de quem chamou (a ordem do banco)", () => {
    const empatada: Etapa[] = [
      { chave: "novo", nome: "Novo", papel: "entrada", posicao: 10 },
      { chave: "b_livre", nome: "Livre", papel: null, posicao: 20 },
      {
        chave: "aguardando_resposta",
        nome: "Aguardando resposta",
        papel: "aguardando",
        posicao: 20,
      },
    ];
    // Como veio: novo, b_livre, aguardando. A vizinha de cima da
    // aguardando e a livre, entao a troca vale.
    expect(
      trocaDeOrdemPermitida(empatada, "aguardando_resposta", "subir"),
    ).toEqual({ permitida: true });
  });
});

describe("as listas de papéis", () => {
  it("as da ordem fixa são as de sistema menos Perdido, na mesma ordem", () => {
    expect([...PAPEIS_EM_ORDEM_FIXA]).toEqual(
      PAPEIS_DE_ETAPA.filter((papel) => papel !== "perdido"),
    );
  });

  it("listaEmPortugues junta com vírgula e e", () => {
    expect(listaEmPortugues([])).toBe("");
    expect(listaEmPortugues(["Novo"])).toBe("Novo");
    expect(listaEmPortugues(["Novo", "Agendou"])).toBe("Novo e Agendou");
    expect(listaEmPortugues(["Novo", "Em contato", "Agendou"])).toBe(
      "Novo, Em contato e Agendou",
    );
  });
});

describe("ehRecusaDaOrdemFixa", () => {
  it("pelo hint, pela mensagem e mais nada", () => {
    expect(
      ehRecusaDaOrdemFixa({ message: "outra", hint: "ordem_de_sistema" }),
    ).toBe(true);
    expect(
      ehRecusaDaOrdemFixa({
        message: "A ordem das etapas de sistema não muda.",
      }),
    ).toBe(true);
    expect(
      ehRecusaDaOrdemFixa({ message: "A etapa já está na ponta da jornada." }),
    ).toBe(false);
    expect(ehRecusaDaOrdemFixa(null)).toBe(false);
  });
});

describe("rodapeDaJornada", () => {
  it("cita as seis etapas de sistema e a ordem fixa das cinco", () => {
    expect(rodapeDaJornada(PADRAO)).toBe(
      "As etapas de sistema (Novo, Aguardando resposta, Em contato, Agendou, Compareceu e Perdido) podem mudar de nome e de lugar, nunca sair: são elas que movem o contato sozinho e que protegem o motivo de perda. A ordem entre Novo, Aguardando resposta, Em contato, Agendou e Compareceu não muda; as outras etapas vão para qualquer lugar. Os eventos de conversão ainda não são enviados à Meta: esta tela define o que será enviado quando a conta de anúncios for conectada.",
    );
  });

  it("com os nomes da clínica (Salud Care)", () => {
    const texto = rodapeDaJornada(SALUD_CARE);
    expect(texto).toContain(
      "(Novo, Aguardando resposta, Contato inicial, Agendou, Compareceu e Perdido)",
    );
    expect(texto).not.toContain("Follow");
    expect(texto).not.toContain("Comprou HomeCare");
  });

  it("banco antes da migration: as quatro de sistema de então; a ordem já trava Em contato", () => {
    const velha = PADRAO.map((etapa) =>
      etapa.papel === "aguardando" || etapa.papel === "em_contato"
        ? { ...etapa, papel: null }
        : etapa,
    );
    const texto = rodapeDaJornada(velha);
    expect(texto).toContain(
      "As etapas de sistema (Novo, Agendou, Compareceu e Perdido)",
    );
    expect(texto).toContain(
      "A ordem entre Novo, Em contato, Agendou e Compareceu não muda",
    );
    expect(texto).not.toContain("Aguardando resposta");
  });

  it("nenhum travessão em nenhum texto da ordem fixa", () => {
    const textos = [
      rodapeDaJornada(PADRAO),
      rodapeDaJornada([]),
      dicaDaOrdemFixa(PADRAO),
      dicaDaOrdemFixa([]),
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/[–—]/);
    }
  });
});
