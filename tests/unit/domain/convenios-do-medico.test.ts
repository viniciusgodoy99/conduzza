import { describe, expect, it } from "vitest";

import {
  AJUDA_CONVENIOS_QUE_ATENDE,
  conveniosQueAtendeNaAbertura,
  fraseDeQuemDeixaDeFazer,
  frasesDoResumoDosConvenios,
  listaFalada,
  MENSAGEM_CADASTRO_MUDOU,
  MENSAGEM_CONVENIO_INATIVO,
  NOTA_CONVENIO_EM_USO,
  opcoesDosConveniosQueAtende,
  precisaSalvarConvenios,
  previaDosConveniosDoProfissional,
  ROTULO_CONVENIOS_QUE_ATENDE,
  ROTULO_CONVENIOS_QUE_COBREM,
  ROTULO_FORA_DO_CADASTRO,
  ROTULO_SALVAR_MESMO_ASSIM,
  ROTULO_TIRAR_CONVENIO,
  tituloDoAvisoDosConvenios,
  VAZIO_CONVENIOS_QUE_ATENDE,
  type AtendimentoDoConvenio,
  type CoberturaDoConvenio,
  type NomesDoResumo,
  type VinculoDoMedico,
} from "@/lib/domain/convenios-do-medico";

// Convenio pelo medico (decisao do dono em 02/10/2026): o cadastro do
// profissional e o padrao, o convenio entra sozinho so onde cobre, e a
// excecao desmarcada no Procedimento fica. A previa tem de dar o mesmo que a
// RPC sincronizar_convenios_do_profissional (critica §3.2).

const JOAO = "prof-joao";
const ANA = "prof-ana";
const NOVO = "prof-novo";

const ENDO = "proc-endo";
const NUTRO = "proc-nutro";
const RETORNO = "proc-retorno";
const BOTOX = "proc-botox";

const UNIMED = "conv-unimed";
const BRADESCO = "conv-bradesco";
const AMIL = "conv-amil";

const NOMES: NomesDoResumo = {
  convenio: (id) =>
    ({ [UNIMED]: "Unimed", [BRADESCO]: "Bradesco Saúde", [AMIL]: "Amil" })[
      id
    ] ?? "Convênio removido",
  procedimento: (id) =>
    ({
      [ENDO]: "Endocrinologia",
      [NUTRO]: "Nutrologia",
      [RETORNO]: "Retorno",
      [BOTOX]: "Botox",
    })[id] ?? "Procedimento removido",
};

function vinculo(
  procedure_id: string,
  insurance_id: string | null,
  parcial: Partial<VinculoDoMedico> = {},
): VinculoDoMedico {
  return {
    professional_id: JOAO,
    procedure_id,
    insurance_id,
    active: true,
    ...parcial,
  };
}

function atende(
  insurance_id: string,
  professional_id = JOAO,
): AtendimentoDoConvenio {
  return { professional_id, insurance_id };
}

function cobre(
  procedure_id: string,
  insurance_id: string,
): CoberturaDoConvenio {
  return { procedure_id, insurance_id };
}

describe("conveniosQueAtendeNaAbertura (auto cura)", () => {
  it("abre com os pares gravados dele, sem nota", () => {
    const abertura = conveniosQueAtendeNaAbertura(
      JOAO,
      [atende(UNIMED), atende(BRADESCO), atende(AMIL, ANA)],
      [vinculo(ENDO, null), vinculo(ENDO, UNIMED)],
    );
    expect(abertura).toEqual({
      marcados: [UNIMED, BRADESCO],
      gravados: [UNIMED, BRADESCO],
      emUsoForaDoCadastro: [],
    });
  });

  it("marca o convenio que so estava no vinculo ativo e separa para a nota", () => {
    const abertura = conveniosQueAtendeNaAbertura(
      JOAO,
      [atende(UNIMED)],
      [
        vinculo(ENDO, UNIMED),
        vinculo(ENDO, BRADESCO),
        vinculo(RETORNO, BRADESCO),
      ],
    );
    expect(abertura.marcados).toEqual([UNIMED, BRADESCO]);
    expect(abertura.gravados).toEqual([UNIMED]);
    expect(abertura.emUsoForaDoCadastro).toEqual([BRADESCO]);
  });

  it("ignora vinculo inativo, Particular e vinculo de outro profissional", () => {
    const abertura = conveniosQueAtendeNaAbertura(
      JOAO,
      [],
      [
        vinculo(ENDO, null),
        vinculo(ENDO, UNIMED, { active: false }),
        vinculo(ENDO, AMIL, { professional_id: ANA }),
      ],
    );
    expect(abertura).toEqual({
      marcados: [],
      gravados: [],
      emUsoForaDoCadastro: [],
    });
  });
});

describe("precisaSalvarConvenios", () => {
  /** Abertura sem cura: marcados == gravados */
  const semCura = (gravados: string[]) => ({ gravados, marcados: gravados });

  it("sem cura, compara por conjunto com os pares crus", () => {
    expect(
      precisaSalvarConvenios(semCura([UNIMED, BRADESCO]), [BRADESCO, UNIMED]),
    ).toBe(false);
    expect(precisaSalvarConvenios(semCura([]), [])).toBe(false);
    expect(precisaSalvarConvenios(semCura([UNIMED]), [UNIMED, BRADESCO])).toBe(
      true,
    );
    expect(precisaSalvarConvenios(semCura([UNIMED, BRADESCO]), [UNIMED])).toBe(
      true,
    );
    expect(precisaSalvarConvenios(semCura([UNIMED]), [BRADESCO])).toBe(true);
  });

  it("a cura sem ninguem mexer manda salvar (so grava o par)", () => {
    const abertura = conveniosQueAtendeNaAbertura(
      JOAO,
      [atende(UNIMED)],
      [vinculo(ENDO, BRADESCO)],
    );
    expect(precisaSalvarConvenios(abertura, abertura.marcados)).toBe(true);
  });

  it("desmarcar so o convenio curado manda salvar (a previa anuncia a saida)", () => {
    // Par gravado so com a Unimed; Bradesco ativo na Endocrinologia sem par
    // (dado antigo). Desmarcar o Bradesco deixa a lista igual aos pares crus,
    // mas a RPC o conta em `saem` e desativa o vinculo: tem de ir para ela.
    const atendimentos = [atende(UNIMED)];
    const vinculos = [
      vinculo(ENDO, null),
      vinculo(ENDO, UNIMED),
      vinculo(ENDO, BRADESCO),
    ];
    const abertura = conveniosQueAtendeNaAbertura(
      JOAO,
      atendimentos,
      vinculos,
    );
    expect(abertura.gravados).toEqual([UNIMED]);
    expect(abertura.emUsoForaDoCadastro).toEqual([BRADESCO]);
    expect(precisaSalvarConvenios(abertura, [UNIMED])).toBe(true);
    const previa = previaDosConveniosDoProfissional({
      professionalId: JOAO,
      agora: [UNIMED],
      atendimentos,
      coberturas: [],
      vinculos,
    });
    expect(previa.saem).toEqual([
      { insuranceId: BRADESCO, procedureIds: [ENDO] },
    ]);
  });

  it("com cura, so nao manda quando nada difere dos pares nem da abertura", () => {
    // Com cura, marcados != gravados: qualquer lista difere de um dos dois.
    const abertura = conveniosQueAtendeNaAbertura(
      JOAO,
      [atende(UNIMED)],
      [vinculo(ENDO, BRADESCO)],
    );
    for (const agora of [[], [UNIMED], [BRADESCO], [BRADESCO, UNIMED]]) {
      expect(precisaSalvarConvenios(abertura, agora)).toBe(true);
    }
  });
});

describe("opcoesDosConveniosQueAtende", () => {
  const convenios = [
    { id: BRADESCO, name: "Bradesco Saúde", plan_name: null, active: true },
    { id: UNIMED, name: "Unimed", plan_name: "Nacional", active: true },
    { id: AMIL, name: "Amil", plan_name: null, active: false },
    { id: "conv-sul", name: "SulAmérica", active: false },
  ];

  it("oferece os ativos por nome e esconde o inativo que nao esta marcado", () => {
    const opcoes = opcoesDosConveniosQueAtende({
      convenios,
      marcados: [],
      naAbertura: [],
      emUsoForaDoCadastro: [],
    });
    expect(opcoes).toEqual([
      { id: BRADESCO, nome: "Bradesco Saúde", plano: null, inativo: false },
      { id: UNIMED, nome: "Unimed", plano: "Nacional", inativo: false },
    ]);
  });

  it("o inativo marcado ou da abertura aparece no fim, para poder sair", () => {
    const opcoes = opcoesDosConveniosQueAtende({
      convenios,
      marcados: new Set([AMIL]),
      naAbertura: ["conv-sul"],
      emUsoForaDoCadastro: [],
    });
    expect(opcoes.map((o) => [o.id, o.inativo])).toEqual([
      [BRADESCO, false],
      [UNIMED, false],
      [AMIL, true],
      ["conv-sul", true],
    ]);
  });

  it("o que veio so do vinculo ganha a nota da cura", () => {
    const opcoes = opcoesDosConveniosQueAtende({
      convenios,
      marcados: [BRADESCO],
      naAbertura: [BRADESCO],
      emUsoForaDoCadastro: [BRADESCO],
    });
    expect(opcoes.find((o) => o.id === BRADESCO)?.nota).toBe(
      NOTA_CONVENIO_EM_USO,
    );
    expect(opcoes.find((o) => o.id === UNIMED)?.nota).toBeUndefined();
  });
});

describe("previaDosConveniosDoProfissional", () => {
  it("Dr. Joao, Nutrologia sem cobertura: Unimed e Bradesco entram so na Endocrinologia", () => {
    // Spec 3.5: Endocrinologia R$ 400 / 40 min coberta por Unimed e Bradesco;
    // Nutrologia R$ 500 / 60 min so particular.
    const previa = previaDosConveniosDoProfissional({
      professionalId: JOAO,
      agora: [UNIMED, BRADESCO],
      atendimentos: [],
      coberturas: [cobre(ENDO, UNIMED), cobre(ENDO, BRADESCO)],
      vinculos: [vinculo(ENDO, null), vinculo(NUTRO, null)],
    });
    expect(previa).toEqual({
      entram: [
        { insuranceId: UNIMED, procedureIds: [ENDO] },
        { insuranceId: BRADESCO, procedureIds: [ENDO] },
      ],
      saem: [],
      deixaDeFazer: [],
    });
    expect(frasesDoResumoDosConvenios(previa, NOMES)).toEqual([
      "Bradesco Saúde entra em 1 procedimento: Endocrinologia.",
      "Unimed entra em 1 procedimento: Endocrinologia.",
    ]);
  });

  describe("Dr. Joao, Nutrologia coberta pela Unimed (por causa da Dra. Ana) com a excecao dele", () => {
    const atendimentos = [
      atende(UNIMED),
      atende(BRADESCO),
      atende(UNIMED, ANA),
    ];
    const coberturas = [
      cobre(ENDO, UNIMED),
      cobre(ENDO, BRADESCO),
      cobre(NUTRO, UNIMED),
      cobre(ENDO, AMIL),
    ];
    const vinculos = [
      vinculo(ENDO, null),
      vinculo(ENDO, UNIMED),
      vinculo(ENDO, BRADESCO),
      // A excecao: ele faz Nutrologia, atende Unimed, a Unimed cobre, mas o
      // vinculo (Joao, Nutrologia, Unimed) foi desmarcado no Procedimento.
      vinculo(NUTRO, null),
      vinculo(NUTRO, UNIMED, { professional_id: ANA }),
    ];

    it("salvar com a mesma lista nao muda nada: a excecao fica", () => {
      const previa = previaDosConveniosDoProfissional({
        professionalId: JOAO,
        agora: [BRADESCO, UNIMED],
        atendimentos,
        coberturas,
        vinculos,
      });
      expect(previa).toEqual({ entram: [], saem: [], deixaDeFazer: [] });
      expect(frasesDoResumoDosConvenios(previa, NOMES)).toEqual([]);
    });

    it("um convenio novo entra so onde cobre e nao desfaz a excecao da Unimed", () => {
      const previa = previaDosConveniosDoProfissional({
        professionalId: JOAO,
        agora: [UNIMED, BRADESCO, AMIL],
        atendimentos,
        coberturas,
        vinculos,
      });
      expect(previa.entram).toEqual([
        { insuranceId: AMIL, procedureIds: [ENDO] },
      ]);
      expect(previa.saem).toEqual([]);
    });

    it("tirar a Unimed sai so de onde ela esta ativa, sem tirar ele da Nutrologia", () => {
      const previa = previaDosConveniosDoProfissional({
        professionalId: JOAO,
        agora: [BRADESCO],
        atendimentos,
        coberturas,
        vinculos,
      });
      expect(previa).toEqual({
        entram: [],
        saem: [{ insuranceId: UNIMED, procedureIds: [ENDO] }],
        deixaDeFazer: [],
      });
    });

    it("marcar a Unimed de novo depois de salvar sem ela entra tambem na Nutrologia (a excecao some)", () => {
      const previa = previaDosConveniosDoProfissional({
        professionalId: JOAO,
        agora: [BRADESCO, UNIMED],
        atendimentos: [atende(BRADESCO), atende(UNIMED, ANA)],
        coberturas,
        vinculos: [
          vinculo(ENDO, null),
          vinculo(ENDO, UNIMED, { active: false }),
          vinculo(ENDO, BRADESCO),
          vinculo(NUTRO, null),
          vinculo(NUTRO, UNIMED, { professional_id: ANA }),
        ],
      });
      // Endocrinologia volta pela reativacao (valores gravados, D2) e
      // Nutrologia ganha o vinculo novo, como Coberto.
      expect(previa.entram).toEqual([
        { insuranceId: UNIMED, procedureIds: [ENDO, NUTRO] },
      ]);
      expect(frasesDoResumoDosConvenios(previa, NOMES)).toEqual([
        "Unimed entra em 2 procedimentos: Endocrinologia e Nutrologia.",
      ]);
    });
  });

  it("procedimento sem cobertura (Botox) nao recebe convenio", () => {
    const previa = previaDosConveniosDoProfissional({
      professionalId: JOAO,
      agora: [UNIMED],
      atendimentos: [],
      coberturas: [cobre(ENDO, UNIMED)],
      vinculos: [vinculo(BOTOX, null), vinculo(ENDO, null)],
    });
    expect(previa.entram).toEqual([
      { insuranceId: UNIMED, procedureIds: [ENDO] },
    ]);
  });

  it("medico sem procedimento: o convenio fica so no cadastro", () => {
    const previa = previaDosConveniosDoProfissional({
      professionalId: NOVO,
      agora: [UNIMED, BRADESCO],
      atendimentos: [],
      coberturas: [cobre(ENDO, UNIMED), cobre(ENDO, BRADESCO)],
      vinculos: [vinculo(ENDO, null)],
    });
    expect(previa).toEqual({
      entram: [
        { insuranceId: UNIMED, procedureIds: [] },
        { insuranceId: BRADESCO, procedureIds: [] },
      ],
      saem: [],
      deixaDeFazer: [],
    });
    expect(frasesDoResumoDosConvenios(previa, NOMES)).toEqual([
      "Bradesco Saúde fica no cadastro e ainda não entra em nenhum procedimento deste profissional.",
      "Unimed fica no cadastro e ainda não entra em nenhum procedimento deste profissional.",
    ]);
  });

  it("faz = vinculo ativo de qualquer convenio, Particular incluido; vinculo inativo nao conta", () => {
    const previa = previaDosConveniosDoProfissional({
      professionalId: JOAO,
      agora: [UNIMED, BRADESCO],
      atendimentos: [atende(UNIMED)],
      coberturas: [
        cobre(ENDO, BRADESCO),
        cobre(RETORNO, BRADESCO),
        cobre(NUTRO, BRADESCO),
      ],
      vinculos: [
        // Endocrinologia so pela Unimed (sem Particular): ele faz.
        vinculo(ENDO, UNIMED),
        // Retorno so Particular: ele faz.
        vinculo(RETORNO, null),
        // Nutrologia so com vinculo desativado: ele nao faz.
        vinculo(NUTRO, null, { active: false }),
      ],
    });
    expect(previa.entram).toEqual([
      { insuranceId: BRADESCO, procedureIds: [ENDO, RETORNO] },
    ]);
  });

  it("vinculo inativo do convenio que entra volta (reativacao conta como entrada)", () => {
    const previa = previaDosConveniosDoProfissional({
      professionalId: JOAO,
      agora: [UNIMED],
      atendimentos: [],
      coberturas: [cobre(ENDO, UNIMED)],
      vinculos: [vinculo(ENDO, null), vinculo(ENDO, UNIMED, { active: false })],
    });
    expect(previa.entram).toEqual([
      { insuranceId: UNIMED, procedureIds: [ENDO] },
    ]);
  });

  it("convenio curado (so no vinculo) conta como ja marcado e nao cascateia", () => {
    // Bradesco esta ativo na Endocrinologia sem o par (dado antigo). A cura o
    // marca na abertura; salvar com ele marcado NAO o leva ao Retorno, mesmo
    // com o Bradesco cobrindo o Retorno que ele faz. Vinculo ja ativo tambem
    // nao conta como entrada.
    const previa = previaDosConveniosDoProfissional({
      professionalId: JOAO,
      agora: [UNIMED, BRADESCO],
      atendimentos: [atende(UNIMED)],
      coberturas: [cobre(ENDO, BRADESCO), cobre(RETORNO, BRADESCO)],
      vinculos: [
        vinculo(ENDO, null),
        vinculo(ENDO, BRADESCO),
        vinculo(RETORNO, null),
      ],
    });
    expect(previa).toEqual({ entram: [], saem: [], deixaDeFazer: [] });
  });

  it("convenio curado desmarcado sai dos vinculos dele", () => {
    const previa = previaDosConveniosDoProfissional({
      professionalId: JOAO,
      agora: [UNIMED],
      atendimentos: [atende(UNIMED)],
      coberturas: [],
      vinculos: [vinculo(ENDO, null), vinculo(ENDO, BRADESCO)],
    });
    expect(previa.saem).toEqual([
      { insuranceId: BRADESCO, procedureIds: [ENDO] },
    ]);
    expect(previa.deixaDeFazer).toEqual([]);
  });

  it("convenio que sai sem vinculo sai so do cadastro", () => {
    const previa = previaDosConveniosDoProfissional({
      professionalId: JOAO,
      agora: [],
      atendimentos: [atende(AMIL)],
      coberturas: [],
      vinculos: [vinculo(ENDO, null)],
    });
    expect(previa.saem).toEqual([{ insuranceId: AMIL, procedureIds: [] }]);
    expect(frasesDoResumoDosConvenios(previa, NOMES)).toEqual([
      "Amil sai do cadastro, sem mudar nenhum procedimento.",
    ]);
  });

  describe("deixa de fazer (D3)", () => {
    const atendimentos = [atende(UNIMED)];
    const vinculos = [
      vinculo(ENDO, null),
      vinculo(ENDO, UNIMED),
      // Retorno so pela Unimed, sem Particular.
      vinculo(RETORNO, UNIMED),
    ];

    it("quem so fazia o procedimento pelo convenio que sai deixa de fazer", () => {
      const previa = previaDosConveniosDoProfissional({
        professionalId: JOAO,
        agora: [],
        atendimentos,
        coberturas: [cobre(ENDO, UNIMED), cobre(RETORNO, UNIMED)],
        vinculos,
      });
      expect(previa).toEqual({
        entram: [],
        saem: [{ insuranceId: UNIMED, procedureIds: [ENDO, RETORNO] }],
        deixaDeFazer: [RETORNO],
      });
      expect(frasesDoResumoDosConvenios(previa, NOMES)).toEqual([
        "Unimed sai de 2 procedimentos: Endocrinologia e Retorno.",
        "Este profissional deixa de fazer 1 procedimento, porque só atendia nele pelo convênio desmarcado: Retorno. Para voltar, inclua o profissional em Quem faz, no cadastro do procedimento.",
      ]);
    });

    it("trocar Unimed por Bradesco onde o Bradesco cobre: continua fazendo", () => {
      const previa = previaDosConveniosDoProfissional({
        professionalId: JOAO,
        agora: [BRADESCO],
        atendimentos,
        coberturas: [
          cobre(ENDO, UNIMED),
          cobre(RETORNO, UNIMED),
          cobre(RETORNO, BRADESCO),
        ],
        vinculos,
      });
      expect(previa.entram).toEqual([
        { insuranceId: BRADESCO, procedureIds: [RETORNO] },
      ]);
      expect(previa.deixaDeFazer).toEqual([]);
    });

    it("trocar Unimed por um convenio que nao cobre o Retorno: deixa de fazer", () => {
      const previa = previaDosConveniosDoProfissional({
        professionalId: JOAO,
        agora: [BRADESCO],
        atendimentos,
        coberturas: [cobre(ENDO, BRADESCO)],
        vinculos,
      });
      expect(previa.entram).toEqual([
        { insuranceId: BRADESCO, procedureIds: [ENDO] },
      ]);
      expect(previa.deixaDeFazer).toEqual([RETORNO]);
    });

    it("o Particular ativo segura o procedimento", () => {
      const previa = previaDosConveniosDoProfissional({
        professionalId: JOAO,
        agora: [],
        atendimentos,
        coberturas: [],
        vinculos: [vinculo(ENDO, null), vinculo(ENDO, UNIMED)],
      });
      expect(previa.deixaDeFazer).toEqual([]);
    });

    it("dois convenios saindo do mesmo procedimento: deixa de fazer, no plural", () => {
      const previa = previaDosConveniosDoProfissional({
        professionalId: JOAO,
        agora: [],
        atendimentos: [atende(UNIMED), atende(BRADESCO)],
        coberturas: [],
        vinculos: [
          vinculo(RETORNO, UNIMED),
          vinculo(RETORNO, BRADESCO),
          vinculo(NUTRO, UNIMED),
        ],
      });
      expect([...previa.deixaDeFazer].sort()).toEqual([NUTRO, RETORNO].sort());
      expect(
        fraseDeQuemDeixaDeFazer(previa.deixaDeFazer, previa.saem.length, NOMES),
      ).toBe(
        "Este profissional deixa de fazer 2 procedimentos, porque só atendia neles pelos convênios desmarcados: Nutrologia e Retorno. Para voltar, inclua o profissional em Quem faz, no cadastro do procedimento.",
      );
    });
  });

  it("vinculos de outro profissional nao contam", () => {
    const previa = previaDosConveniosDoProfissional({
      professionalId: JOAO,
      agora: [UNIMED],
      atendimentos: [atende(UNIMED, ANA)],
      coberturas: [cobre(ENDO, UNIMED)],
      vinculos: [vinculo(ENDO, null, { professional_id: ANA })],
    });
    expect(previa).toEqual({
      entram: [{ insuranceId: UNIMED, procedureIds: [] }],
      saem: [],
      deixaDeFazer: [],
    });
  });

  it("id repetido na tela conta uma vez", () => {
    const previa = previaDosConveniosDoProfissional({
      professionalId: JOAO,
      agora: [UNIMED, UNIMED],
      atendimentos: [],
      coberturas: [cobre(ENDO, UNIMED)],
      vinculos: [vinculo(ENDO, null)],
    });
    expect(previa.entram).toEqual([
      { insuranceId: UNIMED, procedureIds: [ENDO] },
    ]);
  });
});

describe("textos do resumo", () => {
  it("listaFalada junta na forma falada e so resume acima de limite + 1", () => {
    expect(listaFalada([])).toBe("");
    expect(listaFalada(["A"])).toBe("A");
    expect(listaFalada(["A", "B"])).toBe("A e B");
    expect(listaFalada(["A", "B", "C"])).toBe("A, B e C");
    expect(listaFalada(["A", "B", "C", "D"])).toBe("A, B, C e D");
    expect(listaFalada(["A", "B", "C", "D", "E"])).toBe("A, B, C e mais 2");
  });

  it("o exemplo do plano: Unimed entra em 3 procedimentos, em ordem de nome", () => {
    const frases = frasesDoResumoDosConvenios(
      {
        entram: [
          {
            insuranceId: UNIMED,
            procedureIds: ["p-ultra", "p-consulta", "p-retorno"],
          },
        ],
        saem: [],
      },
      {
        convenio: NOMES.convenio,
        procedimento: (id) =>
          ({
            "p-ultra": "Ultrassom",
            "p-consulta": "Consulta",
            "p-retorno": "Retorno",
          })[id] ?? "?",
      },
    );
    expect(frases).toEqual([
      "Unimed entra em 3 procedimentos: Consulta, Retorno e Ultrassom.",
    ]);
  });

  it("sai no singular e no plural, depois das entradas", () => {
    const frases = frasesDoResumoDosConvenios(
      {
        entram: [{ insuranceId: AMIL, procedureIds: [ENDO] }],
        saem: [
          { insuranceId: UNIMED, procedureIds: [ENDO, NUTRO] },
          { insuranceId: BRADESCO, procedureIds: [ENDO] },
        ],
        deixaDeFazer: [],
      },
      NOMES,
    );
    expect(frases).toEqual([
      "Amil entra em 1 procedimento: Endocrinologia.",
      "Bradesco Saúde sai de 1 procedimento: Endocrinologia.",
      "Unimed sai de 2 procedimentos: Endocrinologia e Nutrologia.",
    ]);
  });

  it("aceita o retorno da RPC sem deixaDeFazer e nada muda sem mudanca", () => {
    expect(frasesDoResumoDosConvenios({ entram: [], saem: [] }, NOMES)).toEqual(
      [],
    );
    expect(fraseDeQuemDeixaDeFazer([], 1, NOMES)).toBeNull();
  });

  it("titulo do aviso de consultas: singular, plural e sem consulta", () => {
    expect(tituloDoAvisoDosConvenios(1, 1)).toBe(
      "Há 1 consulta marcada com este profissional pelo convênio desmarcado. Remarque ou cancele, se for o caso.",
    );
    expect(tituloDoAvisoDosConvenios(3, 2)).toBe(
      "Há 3 consultas marcadas com este profissional pelos convênios desmarcados. Remarque ou cancele, se for o caso.",
    );
    expect(tituloDoAvisoDosConvenios(0, 1)).toBeNull();
  });

  it("nenhum texto tem travessao", () => {
    const textos = [
      ...frasesDoResumoDosConvenios(
        {
          entram: [
            { insuranceId: UNIMED, procedureIds: [ENDO] },
            { insuranceId: AMIL, procedureIds: [] },
          ],
          saem: [
            { insuranceId: BRADESCO, procedureIds: [] },
            { insuranceId: "conv-x", procedureIds: [NUTRO] },
          ],
          deixaDeFazer: [NUTRO],
        },
        NOMES,
      ),
      tituloDoAvisoDosConvenios(2, 1) ?? "",
      ROTULO_CONVENIOS_QUE_ATENDE,
      ROTULO_CONVENIOS_QUE_COBREM,
      ROTULO_FORA_DO_CADASTRO,
      ROTULO_TIRAR_CONVENIO,
      ROTULO_SALVAR_MESMO_ASSIM,
      AJUDA_CONVENIOS_QUE_ATENDE,
      VAZIO_CONVENIOS_QUE_ATENDE,
      NOTA_CONVENIO_EM_USO,
      MENSAGEM_CADASTRO_MUDOU,
      MENSAGEM_CONVENIO_INATIVO,
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/[–—]/);
    }
  });
});
