import { describe, expect, it } from "vitest";

import {
  ajusteAoMarcar,
  ajusteNovo,
  avisoDosVinculosDesativados,
  conveniosParaMarcar,
  linhaAoAdicionar,
  linhasDosVinculos,
  linhasQueAAgendaOferece,
  listaCurta,
  modoDoPreco,
  personalizar,
  precisaSincronizarVinculos,
  profissionaisParaAdicionar,
  resumoDoProcedimento,
  valoresDoAjuste,
  valoresDoPadrao,
  vinculosDasLinhas,
  voltarAoPadrao,
  type EstadoDosVinculos,
  type LinhaDoProfissional,
  type PadraoDoProcedimento,
  type VinculoGravado,
} from "@/lib/domain/vinculos-do-procedimento";

// "Quem faz e convenios" no modal do Procedimento (decisao do dono em
// 29/09/2026): dos vinculos gravados para as linhas da tela e de volta. O
// caso que precisa funcionar e o do Dr. Joao (spec 3.5): no MESMO
// procedimento, um profissional aceita Unimed e o outro nao.

const PROC = "proc-endo";
const OUTRO_PROC = "proc-derma";
const JOAO = "prof-joao";
const ANA = "prof-ana";
const CAIO = "prof-caio";
const UNIMED = "conv-unimed";
const BRADESCO = "conv-bradesco";

const ENDO: PadraoDoProcedimento = { basePriceCents: 40000, durationMin: 40 };

const NOMES = {
  profissional: (id: string) =>
    ({ [JOAO]: "Dr. João", [ANA]: "Dra. Ana", [CAIO]: "Dr. Caio" })[id] ??
    "Profissional removido",
  convenio: (id: string | null) =>
    id === null
      ? "Particular"
      : ({ [UNIMED]: "Unimed", [BRADESCO]: "Bradesco" }[id] ??
        "Convênio removido"),
};

function vinculo(parcial: Partial<VinculoGravado>): VinculoGravado {
  return {
    professional_id: JOAO,
    procedure_id: PROC,
    insurance_id: null,
    price_cents: 40000,
    covered_by_insurance: false,
    duration_min: 40,
    active: true,
    ...parcial,
  };
}

// O caso do Dr. Joao: Joao atende Particular pelo padrao e Unimed coberto;
// Ana atende so Particular, com preco e duracao proprios.
const CASO_DO_DR_JOAO: VinculoGravado[] = [
  vinculo({ professional_id: JOAO }),
  vinculo({
    professional_id: JOAO,
    insurance_id: UNIMED,
    price_cents: null,
    covered_by_insurance: true,
  }),
  vinculo({ professional_id: ANA, price_cents: 35000, duration_min: 45 }),
];

describe("padrão do procedimento", () => {
  it("Particular leva o preço base e a duração padrão", () => {
    expect(valoresDoPadrao(null, ENDO)).toEqual({
      price_cents: 40000,
      covered_by_insurance: false,
      duration_min: 40,
    });
  });

  it("convênio entra como Coberto (preço nulo com cobertura), nunca R$ 0,00", () => {
    expect(valoresDoPadrao(UNIMED, ENDO)).toEqual({
      price_cents: null,
      covered_by_insurance: true,
      duration_min: 40,
    });
  });

  it("procedimento sem preço fixo deixa o Particular sem preço informado", () => {
    expect(
      valoresDoPadrao(null, { basePriceCents: null, durationMin: 30 }),
    ).toEqual({
      price_cents: null,
      covered_by_insurance: false,
      duration_min: 30,
    });
  });

  it("os três estados de preço continuam distintos", () => {
    expect(modoDoPreco({ price_cents: 0, covered_by_insurance: false })).toBe(
      "valor",
    );
    expect(modoDoPreco({ price_cents: null, covered_by_insurance: true })).toBe(
      "coberto",
    );
    expect(
      modoDoPreco({ price_cents: null, covered_by_insurance: false }),
    ).toBe("sem");
  });
});

describe("dos vínculos gravados para as linhas da tela", () => {
  it("o caso do Dr. João: um aceita Unimed e o outro não, no mesmo procedimento", () => {
    const linhas = linhasDosVinculos(CASO_DO_DR_JOAO, PROC, ENDO, [ANA, JOAO]);
    expect(linhas.map((l) => l.professionalId)).toEqual([ANA, JOAO]);

    const [ana, joao] = linhas as [LinhaDoProfissional, LinhaDoProfissional];
    expect(ana.convenios.map((a) => a.insuranceId)).toEqual([null]);
    expect(joao.convenios.map((a) => a.insuranceId)).toEqual([null, UNIMED]);

    // Joao segue o padrao nos dois; Ana e excecao com valor e duracao.
    expect(joao.convenios.every((a) => a.padrao)).toBe(true);
    expect(ana.convenios[0]).toEqual({
      insuranceId: null,
      padrao: false,
      modo: "valor",
      precoReais: "350,00",
      duracao: "45",
    });
  });

  it("ignora vínculo desativado e vínculo de outro procedimento", () => {
    const linhas = linhasDosVinculos(
      [
        ...CASO_DO_DR_JOAO,
        vinculo({ professional_id: CAIO, active: false }),
        vinculo({ professional_id: CAIO, procedure_id: OUTRO_PROC }),
        vinculo({
          professional_id: ANA,
          insurance_id: UNIMED,
          price_cents: null,
          covered_by_insurance: true,
          active: false,
        }),
      ],
      PROC,
      ENDO,
    );
    expect(linhas.map((l) => l.professionalId).sort()).toEqual([ANA, JOAO]);
    const ana = linhas.find((l) => l.professionalId === ANA)!;
    expect(ana.convenios.map((a) => a.insuranceId)).toEqual([null]);
  });

  it("Particular primeiro, convênios na ordem pedida e ids desconhecidos no fim, sem sumir", () => {
    const linhas = linhasDosVinculos(
      [
        vinculo({
          professional_id: CAIO,
          insurance_id: BRADESCO,
          price_cents: null,
          covered_by_insurance: true,
        }),
        vinculo({
          professional_id: CAIO,
          insurance_id: "conv-desconhecido",
          price_cents: null,
          covered_by_insurance: true,
        }),
        vinculo({
          professional_id: CAIO,
          insurance_id: UNIMED,
          price_cents: null,
          covered_by_insurance: true,
        }),
        vinculo({ professional_id: CAIO }),
        vinculo({ professional_id: "prof-desconhecido" }),
      ],
      PROC,
      ENDO,
      [CAIO],
      [UNIMED, BRADESCO],
    );
    expect(linhas.map((l) => l.professionalId)).toEqual([
      CAIO,
      "prof-desconhecido",
    ]);
    expect(linhas[0]!.convenios.map((a) => a.insuranceId)).toEqual([
      null,
      UNIMED,
      BRADESCO,
      "conv-desconhecido",
    ]);
  });

  it("lê como padrão só o que é exatamente o padrão do procedimento gravado", () => {
    const linhas = linhasDosVinculos(
      [
        // duracao diferente: excecao
        vinculo({ professional_id: JOAO, duration_min: 50 }),
        // convenio sem preco e sem cobertura: excecao "sem"
        vinculo({
          professional_id: ANA,
          insurance_id: UNIMED,
          price_cents: null,
          covered_by_insurance: false,
        }),
        // convenio com valor (coparticipacao): excecao "valor"
        vinculo({
          professional_id: ANA,
          insurance_id: BRADESCO,
          price_cents: 5000,
          covered_by_insurance: true,
        }),
      ],
      PROC,
      ENDO,
      [JOAO, ANA],
      [UNIMED, BRADESCO],
    );
    const [joao, ana] = linhas as [LinhaDoProfissional, LinhaDoProfissional];
    expect(joao.convenios[0]).toMatchObject({
      padrao: false,
      modo: "valor",
      precoReais: "400,00",
      duracao: "50",
    });
    expect(ana.convenios[0]).toMatchObject({
      insuranceId: UNIMED,
      padrao: false,
      modo: "sem",
    });
    expect(ana.convenios[1]).toMatchObject({
      insuranceId: BRADESCO,
      padrao: false,
      modo: "valor",
      precoReais: "50,00",
    });
  });

  it("gratuito de verdade (R$ 0,00) segue o padrão de um procedimento de preço base zero", () => {
    const gratis: PadraoDoProcedimento = { basePriceCents: 0, durationMin: 20 };
    const [linha] = linhasDosVinculos(
      [vinculo({ price_cents: 0, duration_min: 20 })],
      PROC,
      gratis,
    );
    expect(linha!.convenios[0]!.padrao).toBe(true);
    expect(valoresDoAjuste(linha!.convenios[0]!, gratis).price_cents).toBe(0);
  });
});

describe("das linhas da tela de volta para a RPC", () => {
  it("ida e volta reproduz os vínculos ativos do caso do Dr. João", () => {
    const linhas = linhasDosVinculos(CASO_DO_DR_JOAO, PROC, ENDO, [JOAO, ANA]);
    const resultado = vinculosDasLinhas(linhas, ENDO, NOMES);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) {
      return;
    }
    const esperado = CASO_DO_DR_JOAO.map((v) => ({
      professional_id: v.professional_id,
      insurance_id: v.insurance_id,
      price_cents: v.price_cents,
      covered_by_insurance: v.covered_by_insurance,
      duration_min: v.duration_min,
    }));
    expect(resultado.vinculos).toEqual(esperado);
  });

  it("quem segue o padrão acompanha o preço base e a duração novos; a exceção não", () => {
    const linhas = linhasDosVinculos(CASO_DO_DR_JOAO, PROC, ENDO, [JOAO, ANA]);
    const novo: PadraoDoProcedimento = {
      basePriceCents: 45000,
      durationMin: 50,
    };
    const resultado = vinculosDasLinhas(linhas, novo, NOMES);
    if (!resultado.ok) {
      throw new Error(resultado.erro);
    }
    expect(resultado.vinculos).toEqual([
      {
        professional_id: JOAO,
        insurance_id: null,
        price_cents: 45000,
        covered_by_insurance: false,
        duration_min: 50,
      },
      {
        professional_id: JOAO,
        insurance_id: UNIMED,
        price_cents: null,
        covered_by_insurance: true,
        duration_min: 50,
      },
      {
        professional_id: ANA,
        insurance_id: null,
        price_cents: 35000,
        covered_by_insurance: false,
        duration_min: 45,
      },
    ]);
  });

  it("exceção com Coberto e com sem preço grava os três estados certos", () => {
    const linhas: LinhaDoProfissional[] = [
      {
        professionalId: JOAO,
        convenios: [
          { ...personalizar(ajusteNovo(null, ENDO), ENDO), modo: "sem" },
          {
            ...personalizar(ajusteNovo(UNIMED, ENDO), ENDO),
            modo: "coberto",
            duracao: "30",
          },
          {
            ...personalizar(ajusteNovo(BRADESCO, ENDO), ENDO),
            modo: "valor",
            precoReais: "0",
          },
        ],
      },
    ];
    const resultado = vinculosDasLinhas(linhas, ENDO, NOMES);
    if (!resultado.ok) {
      throw new Error(resultado.erro);
    }
    expect(resultado.vinculos).toEqual([
      {
        professional_id: JOAO,
        insurance_id: null,
        price_cents: null,
        covered_by_insurance: false,
        duration_min: 40,
      },
      {
        professional_id: JOAO,
        insurance_id: UNIMED,
        price_cents: null,
        covered_by_insurance: true,
        duration_min: 30,
      },
      {
        professional_id: JOAO,
        insurance_id: BRADESCO,
        price_cents: 0,
        covered_by_insurance: false,
        duration_min: 40,
      },
    ]);
  });

  it("lista vazia é válida: ninguém faz o procedimento (a RPC desativa tudo)", () => {
    expect(vinculosDasLinhas([], ENDO, NOMES)).toEqual({
      ok: true,
      vinculos: [],
    });
  });

  it("recusa profissional sem convênio nenhum, dizendo quem", () => {
    const resultado = vinculosDasLinhas(
      [{ professionalId: ANA, convenios: [] }],
      ENDO,
      NOMES,
    );
    expect(resultado).toEqual({
      ok: false,
      erro: "Dra. Ana: marque ao menos o Particular ou um convênio, ou remova o profissional deste procedimento.",
    });
  });

  it("recusa profissional repetido e convênio repetido", () => {
    const particular = ajusteNovo(null, ENDO);
    expect(
      vinculosDasLinhas(
        [
          { professionalId: ANA, convenios: [particular] },
          { professionalId: ANA, convenios: [particular] },
        ],
        ENDO,
        NOMES,
      ).ok,
    ).toBe(false);
    expect(
      vinculosDasLinhas(
        [{ professionalId: ANA, convenios: [particular, particular] }],
        ENDO,
        NOMES,
      ),
    ).toEqual({ ok: false, erro: "Dra. Ana: Particular aparece duas vezes." });
  });

  it("recusa Coberto no Particular", () => {
    const resultado = vinculosDasLinhas(
      [
        {
          professionalId: JOAO,
          convenios: [
            { ...personalizar(ajusteNovo(null, ENDO), ENDO), modo: "coberto" },
          ],
        },
      ],
      ENDO,
      NOMES,
    );
    expect(resultado.ok).toBe(false);
  });

  it("recusa valor vazio ou ilegível e diz qual profissional e convênio", () => {
    const comPreco = (precoReais: string) =>
      vinculosDasLinhas(
        [
          {
            professionalId: JOAO,
            convenios: [
              {
                ...personalizar(ajusteNovo(UNIMED, ENDO), ENDO),
                modo: "valor",
                precoReais,
              },
            ],
          },
        ],
        ENDO,
        NOMES,
      );
    expect(comPreco("")).toEqual({
      ok: false,
      erro: "Dr. João, Unimed: informe o valor em reais, por exemplo 250,00.",
    });
    expect(comPreco("1,250")).toEqual({
      ok: false,
      erro: "Dr. João, Unimed: não entendemos o valor. Use o formato 250,00.",
    });
    // "250.00" e R$ 250,00, nunca R$ 25.000,00 (achado 34).
    const ok = comPreco("250.00");
    expect(ok.ok && ok.vinculos[0]!.price_cents).toBe(25000);
  });

  it("recusa duração fora de 5 a 600 minutos na exceção", () => {
    for (const duracao of ["", "4", "601", "30.5", "abc"]) {
      const resultado = vinculosDasLinhas(
        [
          {
            professionalId: JOAO,
            convenios: [
              { ...personalizar(ajusteNovo(null, ENDO), ENDO), duracao },
            ],
          },
        ],
        ENDO,
        NOMES,
      );
      expect(resultado.ok, `duração "${duracao}"`).toBe(false);
    }
  });
});

describe("personalizar e voltar ao padrão", () => {
  it("personalizar parte do padrão de agora (com o formulário), não do gravado", () => {
    const novo: PadraoDoProcedimento = {
      basePriceCents: 45000,
      durationMin: 50,
    };
    const ajuste = personalizar(ajusteNovo(null, ENDO), novo);
    expect(ajuste).toEqual({
      insuranceId: null,
      padrao: false,
      modo: "valor",
      precoReais: "450,00",
      duracao: "50",
    });
    expect(personalizar(ajusteNovo(UNIMED, ENDO), novo)).toMatchObject({
      padrao: false,
      modo: "coberto",
      duracao: "50",
    });
  });

  it("voltar ao padrão descarta a exceção", () => {
    const excecao = {
      ...personalizar(ajusteNovo(UNIMED, ENDO), ENDO),
      modo: "valor" as const,
      precoReais: "99,00",
    };
    expect(voltarAoPadrao(excecao, ENDO)).toEqual(ajusteNovo(UNIMED, ENDO));
  });

  it("valoresDoAjuste mostra o padrão com o formulário e a exceção como digitada", () => {
    const novo: PadraoDoProcedimento = {
      basePriceCents: 1000,
      durationMin: 15,
    };
    expect(valoresDoAjuste(ajusteNovo(null, ENDO), novo)).toEqual({
      price_cents: 1000,
      covered_by_insurance: false,
      duration_min: 15,
    });
    expect(
      valoresDoAjuste(
        {
          insuranceId: UNIMED,
          padrao: false,
          modo: "valor",
          precoReais: "xx",
          duracao: "",
        },
        novo,
      ),
    ).toEqual({
      price_cents: null,
      covered_by_insurance: false,
      duration_min: null,
    });
  });
});

describe("colunas da tabela", () => {
  it("resumo: só vínculo ativo de profissional e convênio ativos, Particular primeiro", () => {
    const resumo = resumoDoProcedimento(
      [
        ...CASO_DO_DR_JOAO,
        // Caio inativo: nao aparece
        vinculo({ professional_id: CAIO }),
        // Bradesco inativo: nao aparece
        vinculo({
          professional_id: ANA,
          insurance_id: BRADESCO,
          price_cents: null,
          covered_by_insurance: true,
        }),
        // vinculo desativado: nao aparece
        vinculo({
          professional_id: ANA,
          insurance_id: UNIMED,
          price_cents: null,
          covered_by_insurance: true,
          active: false,
        }),
      ],
      PROC,
      [ANA, JOAO],
      [UNIMED],
    );
    expect(resumo).toEqual({
      profissionais: [ANA, JOAO],
      convenios: [null, UNIMED],
    });
  });

  it("procedimento sem ninguém fica vazio", () => {
    expect(
      resumoDoProcedimento(CASO_DO_DR_JOAO, OUTRO_PROC, [JOAO], []),
    ).toEqual({ profissionais: [], convenios: [] });
  });

  it("lista curta com +N", () => {
    expect(listaCurta(["A", "B"], 2)).toBe("A, B");
    expect(listaCurta(["A", "B", "C", "D"], 2)).toBe("A, B +2");
    expect(listaCurta([], 2)).toBe("");
  });
});

describe("Ver detalhes: só o que a Agenda oferece", () => {
  // Desativar profissional ou convenio nao desativa os vinculos dele: as
  // linhas da tela ainda os trazem, e o modo leitura tem de tira-los.
  const COM_INATIVOS = linhasDosVinculos(
    [
      ...CASO_DO_DR_JOAO,
      // Bradesco (inativo) aceito pela Ana
      vinculo({
        professional_id: ANA,
        insurance_id: BRADESCO,
        price_cents: null,
        covered_by_insurance: true,
      }),
      // Caio (inativo) atende Particular
      vinculo({ professional_id: CAIO }),
    ],
    PROC,
    ENDO,
    [JOAO, ANA, CAIO],
    [UNIMED, BRADESCO],
  );

  it("tira profissional inativo e convênio inativo, e avisa que tirou", () => {
    const { linhas, ocultos } = linhasQueAAgendaOferece(
      COM_INATIVOS,
      [JOAO, ANA],
      [UNIMED],
    );
    expect(ocultos).toBe(true);
    expect(
      linhas.map((l) => [
        l.professionalId,
        l.convenios.map((a) => a.insuranceId),
      ]),
    ).toEqual([
      [JOAO, [null, UNIMED]],
      [ANA, [null]],
    ]);
  });

  it("bate com a coluna Quem faz da tabela", () => {
    const { linhas } = linhasQueAAgendaOferece(
      COM_INATIVOS,
      [JOAO, ANA],
      [UNIMED],
    );
    const resumo = resumoDoProcedimento(
      [
        ...CASO_DO_DR_JOAO,
        vinculo({
          professional_id: ANA,
          insurance_id: BRADESCO,
          price_cents: null,
          covered_by_insurance: true,
        }),
        vinculo({ professional_id: CAIO }),
      ],
      PROC,
      [JOAO, ANA],
      [UNIMED],
    );
    expect(linhas.map((l) => l.professionalId)).toEqual(resumo.profissionais);
  });

  it("profissional que só atendia por convênio inativo sai inteiro", () => {
    const { linhas, ocultos } = linhasQueAAgendaOferece(
      [
        {
          professionalId: ANA,
          convenios: [ajusteNovo(BRADESCO, ENDO)],
        },
      ],
      [ANA],
      [UNIMED],
    );
    expect(linhas).toEqual([]);
    expect(ocultos).toBe(true);
  });

  it("tudo ativo: nada some e não há nota", () => {
    const linhasDaTela = linhasDosVinculos(CASO_DO_DR_JOAO, PROC, ENDO, [
      JOAO,
      ANA,
    ]);
    const resultado = linhasQueAAgendaOferece(
      linhasDaTela,
      [JOAO, ANA],
      [UNIMED],
    );
    expect(resultado).toEqual({ linhas: linhasDaTela, ocultos: false });
  });
});

describe("o que estava gravado na abertura pode voltar enquanto o modal está aberto", () => {
  // Bradesco e Caio inativos. Na abertura, Joao aceitava Bradesco (inativo)
  // com preco proprio e Caio (inativo) atendia Particular.
  const CONVENIOS = [
    { id: UNIMED, active: true },
    { id: BRADESCO, active: false },
  ];
  const PROFISSIONAIS = [
    { id: JOAO, active: true },
    { id: ANA, active: true },
    { id: CAIO, active: false },
    { id: "prof-saiu", active: false },
  ];
  const NA_ABERTURA = linhasDosVinculos(
    [
      vinculo({ professional_id: JOAO }),
      vinculo({
        professional_id: JOAO,
        insurance_id: BRADESCO,
        price_cents: 12000,
        duration_min: 30,
      }),
      vinculo({ professional_id: CAIO, price_cents: 30000 }),
    ],
    PROC,
    ENDO,
    [JOAO, ANA, CAIO],
    [UNIMED, BRADESCO],
  );
  const joaoNaAbertura = NA_ABERTURA[0]!;
  const caioNaAbertura = NA_ABERTURA[1]!;

  it("convênio inativo desmarcado por engano continua na lista de quem o tinha gravado", () => {
    const joaoSemBradesco: LinhaDoProfissional = {
      professionalId: JOAO,
      convenios: joaoNaAbertura.convenios.filter(
        (a) => a.insuranceId !== BRADESCO,
      ),
    };
    expect(
      conveniosParaMarcar(CONVENIOS, joaoSemBradesco, NA_ABERTURA).map(
        (c) => c.id,
      ),
    ).toEqual([UNIMED, BRADESCO]);
  });

  it("convênio inativo que não estava gravado para o profissional fica fora", () => {
    const ana: LinhaDoProfissional = {
      professionalId: ANA,
      convenios: [ajusteNovo(null, ENDO)],
    };
    expect(
      conveniosParaMarcar(CONVENIOS, ana, NA_ABERTURA).map((c) => c.id),
    ).toEqual([UNIMED]);
    // Procedimento novo: so os ativos.
    expect(conveniosParaMarcar(CONVENIOS, ana, []).map((c) => c.id)).toEqual([
      UNIMED,
    ]);
  });

  it("convênio inativo marcado na tela continua aparecendo", () => {
    const ana: LinhaDoProfissional = {
      professionalId: ANA,
      convenios: [ajusteNovo(BRADESCO, ENDO)],
    };
    expect(conveniosParaMarcar(CONVENIOS, ana, []).map((c) => c.id)).toEqual([
      UNIMED,
      BRADESCO,
    ]);
  });

  it("profissional inativo removido por engano volta para Adicionar quem faz", () => {
    const semCaio = [joaoNaAbertura];
    expect(
      profissionaisParaAdicionar(PROFISSIONAIS, semCaio, NA_ABERTURA).map(
        (p) => p.id,
      ),
    ).toEqual([ANA, CAIO]);
  });

  it("profissional inativo que não estava na abertura e quem já está na lista ficam fora", () => {
    expect(
      profissionaisParaAdicionar(PROFISSIONAIS, NA_ABERTURA, NA_ABERTURA).map(
        (p) => p.id,
      ),
    ).toEqual([ANA]);
    // Procedimento novo: so os ativos.
    expect(
      profissionaisParaAdicionar(PROFISSIONAIS, [], []).map((p) => p.id),
    ).toEqual([JOAO, ANA]);
  });

  it("quem estava na abertura volta com os convênios e os valores gravados", () => {
    expect(linhaAoAdicionar(CAIO, NA_ABERTURA, ENDO)).toEqual(caioNaAbertura);
    expect(linhaAoAdicionar(JOAO, NA_ABERTURA, ENDO)).toEqual(joaoNaAbertura);
    expect(caioNaAbertura.convenios[0]).toMatchObject({
      padrao: false,
      precoReais: "300,00",
    });
  });

  it("quem é novo entra atendendo Particular pelo padrão", () => {
    expect(linhaAoAdicionar(ANA, NA_ABERTURA, ENDO)).toEqual({
      professionalId: ANA,
      convenios: [ajusteNovo(null, ENDO)],
    });
  });

  it("convênio gravado marcado de novo volta como estava; o novo segue o padrão", () => {
    expect(ajusteAoMarcar(JOAO, BRADESCO, NA_ABERTURA, ENDO)).toEqual({
      insuranceId: BRADESCO,
      padrao: false,
      modo: "valor",
      precoReais: "120,00",
      duracao: "30",
    });
    expect(ajusteAoMarcar(JOAO, UNIMED, NA_ABERTURA, ENDO)).toEqual(
      ajusteNovo(UNIMED, ENDO),
    );
    // Bradesco era do Joao, nao da Ana.
    expect(ajusteAoMarcar(ANA, BRADESCO, NA_ABERTURA, ENDO)).toEqual(
      ajusteNovo(BRADESCO, ENDO),
    );
  });
});

describe("o Salvar só regrava os vínculos quando algo de que eles dependem mudou", () => {
  const LINHAS = linhasDosVinculos(CASO_DO_DR_JOAO, PROC, ENDO, [JOAO, ANA]);
  const ABERTURA: EstadoDosVinculos = {
    linhas: LINHAS,
    padrao: ENDO,
    iaPodeAgendar: true,
  };
  const joao = LINHAS[0]!;
  const ana = LINHAS[1]!;

  function agora(parcial: Partial<EstadoDosVinculos> = {}): EstadoDosVinculos {
    return { ...ABERTURA, ...parcial };
  }

  it("procedimento novo sempre grava", () => {
    expect(precisaSincronizarVinculos(null, agora({ linhas: [] }))).toBe(true);
    expect(precisaSincronizarVinculos(null, agora())).toBe(true);
  });

  it("nada mudou na seção, no preço base, na duração nem na IA: não grava", () => {
    expect(precisaSincronizarVinculos(ABERTURA, agora())).toBe(false);
    // Copia das linhas (outro objeto, mesmo conteudo).
    expect(
      precisaSincronizarVinculos(
        ABERTURA,
        agora({ linhas: structuredClone(LINHAS) }),
      ),
    ).toBe(false);
  });

  it("procedimento sem ninguém e que continua sem ninguém: não grava", () => {
    expect(
      precisaSincronizarVinculos(
        { ...ABERTURA, linhas: [] },
        agora({ linhas: [] }),
      ),
    ).toBe(false);
  });

  it("reordenar a lista ou abrir uma exceção e voltar sem mudar nada não conta", () => {
    expect(
      precisaSincronizarVinculos(ABERTURA, agora({ linhas: [ana, joao] })),
    ).toBe(false);
    const joaoPersonalizado: LinhaDoProfissional = {
      ...joao,
      convenios: joao.convenios.map((a) => personalizar(a, ENDO)),
    };
    expect(
      precisaSincronizarVinculos(
        ABERTURA,
        agora({ linhas: [joaoPersonalizado, ana] }),
      ),
    ).toBe(false);
  });

  it("mudou a chave IA pode agendar: grava (a RPC copia a chave em todo vínculo)", () => {
    expect(
      precisaSincronizarVinculos(ABERTURA, agora({ iaPodeAgendar: false })),
    ).toBe(true);
  });

  it("mudou o preço base ou a duração padrão: grava (quem segue o padrão grava cópia deles)", () => {
    expect(
      precisaSincronizarVinculos(
        ABERTURA,
        agora({ padrao: { ...ENDO, basePriceCents: 45000 } }),
      ),
    ).toBe(true);
    expect(
      precisaSincronizarVinculos(
        ABERTURA,
        agora({ padrao: { ...ENDO, basePriceCents: null } }),
      ),
    ).toBe(true);
    expect(
      precisaSincronizarVinculos(
        ABERTURA,
        agora({ padrao: { ...ENDO, durationMin: 50 } }),
      ),
    ).toBe(true);
  });

  it("saiu ou entrou profissional: grava", () => {
    expect(
      precisaSincronizarVinculos(ABERTURA, agora({ linhas: [joao] })),
    ).toBe(true);
    expect(
      precisaSincronizarVinculos(
        ABERTURA,
        agora({
          linhas: [
            ...LINHAS,
            { professionalId: CAIO, convenios: [ajusteNovo(null, ENDO)] },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("desmarcou ou marcou convênio: grava", () => {
    const joaoSemUnimed: LinhaDoProfissional = {
      ...joao,
      convenios: joao.convenios.filter((a) => a.insuranceId !== UNIMED),
    };
    expect(
      precisaSincronizarVinculos(
        ABERTURA,
        agora({ linhas: [joaoSemUnimed, ana] }),
      ),
    ).toBe(true);
    const anaComUnimed: LinhaDoProfissional = {
      ...ana,
      convenios: [...ana.convenios, ajusteNovo(UNIMED, ENDO)],
    };
    expect(
      precisaSincronizarVinculos(
        ABERTURA,
        agora({ linhas: [joao, anaComUnimed] }),
      ),
    ).toBe(true);
  });

  it("mudou o preço, a cobertura ou a duração de uma exceção: grava", () => {
    const anaCom = (
      mudanca: Partial<LinhaDoProfissional["convenios"][number]>,
    ): LinhaDoProfissional => ({
      ...ana,
      convenios: ana.convenios.map((a) => ({ ...a, ...mudanca })),
    });
    for (const mudanca of [
      { precoReais: "360,00" },
      { duracao: "50" },
      { modo: "sem" as const },
      { padrao: true },
    ]) {
      expect(
        precisaSincronizarVinculos(
          ABERTURA,
          agora({ linhas: [joao, anaCom(mudanca)] }),
        ),
      ).toBe(true);
    }
    // O mesmo valor escrito de outro jeito nao conta.
    expect(
      precisaSincronizarVinculos(
        ABERTURA,
        agora({ linhas: [joao, anaCom({ precoReais: "350" })] }),
      ),
    ).toBe(false);
  });

  it("a mesma chave duas vezes: grava (quem recusa é vinculosDasLinhas)", () => {
    expect(
      precisaSincronizarVinculos(ABERTURA, agora({ linhas: [joao, joao] })),
    ).toBe(true);
  });
});

describe("aviso de combinações que saíram da agenda", () => {
  it("nada saiu: sem aviso", () => {
    expect(avisoDosVinculosDesativados(0)).toBeNull();
    expect(avisoDosVinculosDesativados(-1)).toBeNull();
  });

  it("singular e plural, sem travessão", () => {
    const travessao = String.fromCharCode(0x2014);
    expect(avisoDosVinculosDesativados(1)).toBe(
      "1 combinação de quem faz e convênio saiu da agenda.",
    );
    expect(avisoDosVinculosDesativados(2)).toBe(
      "2 combinações de quem faz e convênio saíram da agenda.",
    );
    expect(avisoDosVinculosDesativados(2)).not.toContain(travessao);
  });
});
