import { describe, expect, it } from "vitest";

import {
  FORA_DO_CADASTRO,
  NOTA_PLANO_EM_USO,
  ROTULO_DOS_PLANOS,
  ajusteAoMarcar,
  ajusteNovo,
  avisoDosVinculosDesativados,
  contextoDosPlanos,
  conveniosParaMarcar,
  desmarcarPlano,
  extrasDaSincronizacao,
  linhaAoAdicionar,
  linhasDosVinculos,
  linhasQueAAgendaOferece,
  listaCurta,
  marcarPlano,
  modoDoPreco,
  personalizar,
  planosParaMarcar,
  planosQueCobremNaAbertura,
  precisaSincronizarVinculos,
  profissionaisParaAdicionar,
  resumoDoProcedimento,
  valoresDoAjuste,
  valoresDoPadrao,
  vinculosDasLinhas,
  voltarAoPadrao,
  type AberturaComPlanos,
  type AtendimentoDoProfissional,
  type ContextoDosPlanos,
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

// ---------------------------------------------------------------------------
// Convenio pelo profissional (decisao do dono em 02/10/2026): o cadastro do
// profissional diz quais convenios ele atende, o procedimento diz quais o
// cobrem, e "Quem faz e convenios" mostra so a intersecao, ja marcada.
// Desmarcar ali e a excecao daquele procedimento, implicita.
// ---------------------------------------------------------------------------

const NUTRO = "proc-nutro";
const AMIL = "conv-amil";
const NUTROLOGIA: PadraoDoProcedimento = {
  basePriceCents: 50000,
  durationMin: 60,
};

// Amil esta inativo. A ordem do catalogo e Unimed, Bradesco, Amil.
const CONVENIOS_DA_CLINICA = [
  { id: UNIMED, active: true },
  { id: BRADESCO, active: true },
  { id: AMIL, active: false },
];
const ORDEM = CONVENIOS_DA_CLINICA.map((c) => c.id);

// Joao atende Unimed e Bradesco (spec 3.5); Ana so Unimed; Caio Unimed e
// Amil (inativo).
const ATENDIMENTOS: AtendimentoDoProfissional[] = [
  { professional_id: JOAO, insurance_id: UNIMED },
  { professional_id: JOAO, insurance_id: BRADESCO },
  { professional_id: ANA, insurance_id: UNIMED },
  { professional_id: CAIO, insurance_id: UNIMED },
  { professional_id: CAIO, insurance_id: AMIL },
];

function contexto(
  planos: string[],
  marcadosNaAbertura: string[] = [],
): ContextoDosPlanos {
  return contextoDosPlanos({
    planos,
    marcadosNaAbertura,
    atendimentos: ATENDIMENTOS,
    convenios: CONVENIOS_DA_CLINICA,
  });
}

function coberto(parcial: Partial<VinculoGravado>): VinculoGravado {
  return vinculo({
    price_cents: null,
    covered_by_insurance: true,
    ...parcial,
  });
}

function idsDosConvenios(linha: LinhaDoProfissional | undefined) {
  return linha?.convenios.map((a) => a.insuranceId);
}

const TRAVESSAO = String.fromCharCode(0x2014);

describe("Convênios que cobrem na abertura (a cura)", () => {
  it("gravados mais os em uso num vínculo ativo; a nota vale só para os do vínculo", () => {
    const planos = planosQueCobremNaAbertura(
      PROC,
      [
        { procedure_id: PROC, insurance_id: BRADESCO },
        { procedure_id: OUTRO_PROC, insurance_id: UNIMED },
      ],
      [
        vinculo({ professional_id: JOAO }),
        coberto({ professional_id: JOAO, insurance_id: UNIMED }),
        coberto({ professional_id: JOAO, insurance_id: BRADESCO }),
        // desativado e de outro procedimento: nao contam
        coberto({ professional_id: ANA, insurance_id: AMIL, active: false }),
        coberto({
          professional_id: CAIO,
          insurance_id: AMIL,
          procedure_id: OUTRO_PROC,
        }),
      ],
      ORDEM,
    );
    expect(planos).toEqual({
      marcados: [UNIMED, BRADESCO],
      gravados: [BRADESCO],
      soDoVinculo: [UNIMED],
    });
  });

  it("procedimento que nenhum convênio cobre (Botox): só Particular", () => {
    expect(
      planosQueCobremNaAbertura(
        PROC,
        [{ procedure_id: OUTRO_PROC, insurance_id: UNIMED }],
        [vinculo({ professional_id: JOAO })],
        ORDEM,
      ),
    ).toEqual({ marcados: [], gravados: [], soDoVinculo: [] });
  });

  it("convênio inativo gravado continua marcado; quem tira é a pessoa", () => {
    expect(
      planosQueCobremNaAbertura(
        PROC,
        [{ procedure_id: PROC, insurance_id: AMIL }],
        [],
        ORDEM,
      ).marcados,
    ).toEqual([AMIL]);
  });

  it("convênio desativado em uso num vínculo ativo também entra na cura, e o Salvar o leva em planos", () => {
    // Ana tem vinculo ativo com a Amil (desativada depois) sem linha em
    // procedure_insurance: janela de publicacao (tela antiga no modo
    // legado) ou escrita direta. A cura nao filtra o inativo: tirar faria a
    // RPC recusar a linha da Ana com 23514.
    const vinculos = [
      vinculo({ professional_id: ANA }),
      coberto({ professional_id: ANA, insurance_id: AMIL }),
    ];
    const planos = planosQueCobremNaAbertura(
      PROC,
      [{ procedure_id: PROC, insurance_id: UNIMED }],
      vinculos,
      ORDEM,
    );
    expect(planos).toEqual({
      marcados: [UNIMED, AMIL],
      gravados: [UNIMED],
      soDoVinculo: [AMIL],
    });

    // Mudar so o preco base regrava. A RPC recebe a Amil em `planos` e fora
    // de `planosNaAbertura`: ela tem de conta-la como ja presente (em uso
    // num vinculo ativo do proprio procedimento), senao recusaria com 22023
    // um convenio que ninguem marcou e travaria todo Salvar de PROC.
    const linhas = linhasDosVinculos(vinculos, PROC, ENDO, [ANA], ORDEM);
    const abertura: AberturaComPlanos = {
      linhas,
      padrao: ENDO,
      iaPodeAgendar: true,
      planos: planos.marcados,
      planosGravados: planos.gravados,
    };
    const novoPadrao = { ...ENDO, basePriceCents: 45000 };
    expect(
      precisaSincronizarVinculos(abertura, {
        ...abertura,
        padrao: novoPadrao,
      }),
    ).toBe(true);
    expect(
      vinculosDasLinhas(linhas, novoPadrao, NOMES, planos.marcados),
    ).toEqual({
      ok: true,
      vinculos: [
        {
          professional_id: ANA,
          insurance_id: null,
          price_cents: 45000,
          covered_by_insurance: false,
          duration_min: 40,
        },
        {
          professional_id: ANA,
          insurance_id: AMIL,
          price_cents: null,
          covered_by_insurance: true,
          duration_min: 40,
        },
      ],
    });
    const extras = extrasDaSincronizacao(abertura, planos.marcados, false);
    expect(extras.planos).toEqual([UNIMED, AMIL]);
    expect(extras.planosNaAbertura).toEqual([UNIMED]);
    expect(extras.vinculosNaAbertura).toEqual([
      { professional_id: ANA, insurance_id: null },
      { professional_id: ANA, insurance_id: AMIL },
    ]);
  });

  it("os textos fixos não têm travessão", () => {
    for (const texto of [
      ROTULO_DOS_PLANOS,
      NOTA_PLANO_EM_USO,
      FORA_DO_CADASTRO,
    ]) {
      expect(texto).not.toContain(TRAVESSAO);
    }
    expect(ROTULO_DOS_PLANOS).toBe("Convênios que cobrem este procedimento");
    expect(FORA_DO_CADASTRO).toBe("Fora do cadastro do profissional");
  });
});

describe("contexto dos convênios", () => {
  it("atende por profissional, ativos, ordem e o que cobria na abertura", () => {
    const ctx = contexto([UNIMED], [BRADESCO]);
    expect([...ctx.atende(JOAO)]).toEqual([UNIMED, BRADESCO]);
    expect([...ctx.atende(ANA)]).toEqual([UNIMED]);
    // Profissional sem cadastro de convenio: nenhum.
    expect(ctx.atende("prof-sem-convenio").size).toBe(0);
    expect([...ctx.ativos]).toEqual([UNIMED, BRADESCO]);
    expect(ctx.ordem).toEqual(ORDEM);
    expect([...ctx.cobre]).toEqual([UNIMED]);
    expect([...ctx.cobriaNaAbertura]).toEqual([BRADESCO]);
  });

  it("sem a abertura (procedimento novo), nada cobria", () => {
    const ctx = contextoDosPlanos({
      planos: [],
      atendimentos: [],
      convenios: CONVENIOS_DA_CLINICA,
    });
    expect(ctx.cobriaNaAbertura.size).toBe(0);
  });
});

describe("opções da seção Convênios que cobrem", () => {
  it("os ativos, os marcados agora e os marcados na abertura", () => {
    const ids = (planos: string[], naAbertura: string[]) =>
      planosParaMarcar(CONVENIOS_DA_CLINICA, planos, naAbertura).map(
        (c) => c.id,
      );
    expect(ids([], [])).toEqual([UNIMED, BRADESCO]);
    expect(ids([AMIL], [])).toEqual([UNIMED, BRADESCO, AMIL]);
    // Inativo desmarcado por engano: continua para marcar de novo.
    expect(ids([], [AMIL])).toEqual([UNIMED, BRADESCO, AMIL]);
  });
});

describe("Atende por, com o cadastro do profissional", () => {
  const SO_PARTICULAR = (professionalId: string): LinhaDoProfissional => ({
    professionalId,
    convenios: [ajusteNovo(null, ENDO)],
  });
  const opcoes = (
    linha: LinhaDoProfissional,
    ctx: ContextoDosPlanos,
    naAbertura: readonly LinhaDoProfissional[] = [],
  ) =>
    conveniosParaMarcar(CONVENIOS_DA_CLINICA, linha, naAbertura, ctx).map(
      (o) => [o.convenio.id, o.foraDoCadastro],
    );

  it("só o que cobre e que ele atende (e a exceção desmarcada continua para marcar de novo)", () => {
    const ctx = contexto([UNIMED, BRADESCO]);
    expect(opcoes(SO_PARTICULAR(JOAO), ctx)).toEqual([
      [UNIMED, false],
      [BRADESCO, false],
    ]);
    expect(opcoes(SO_PARTICULAR(ANA), ctx)).toEqual([[UNIMED, false]]);
  });

  it("convênio que não cobre não aparece, mesmo que ele atenda", () => {
    expect(opcoes(SO_PARTICULAR(JOAO), contexto([UNIMED]))).toEqual([
      [UNIMED, false],
    ]);
    // Botox: ninguem ve convenio.
    expect(opcoes(SO_PARTICULAR(JOAO), contexto([]))).toEqual([]);
  });

  it("marcado sem estar no cadastro dele aparece com Fora do cadastro do profissional", () => {
    const ctx = contexto([UNIMED, BRADESCO]);
    const anaComBradesco: LinhaDoProfissional = {
      professionalId: ANA,
      convenios: [ajusteNovo(null, ENDO), ajusteNovo(BRADESCO, ENDO)],
    };
    expect(opcoes(anaComBradesco, ctx)).toEqual([
      [UNIMED, false],
      [BRADESCO, true],
    ]);
    // Gravado na abertura e desmarcado: continua (caminho de volta), com a nota.
    expect(opcoes(SO_PARTICULAR(ANA), ctx, [anaComBradesco])).toEqual([
      [UNIMED, false],
      [BRADESCO, true],
    ]);
  });

  it("convênio inativo só aparece se marcado ou gravado para ele", () => {
    const ctx = contexto([UNIMED, AMIL]);
    expect(opcoes(SO_PARTICULAR(CAIO), ctx)).toEqual([[UNIMED, false]]);
    const caioComAmil: LinhaDoProfissional = {
      professionalId: CAIO,
      convenios: [ajusteNovo(null, ENDO), ajusteNovo(AMIL, ENDO)],
    };
    expect(opcoes(caioComAmil, ctx)).toEqual([
      [UNIMED, false],
      [AMIL, false],
    ]);
    expect(opcoes(SO_PARTICULAR(CAIO), ctx, [caioComAmil])).toEqual([
      [UNIMED, false],
      [AMIL, false],
    ]);
  });

  it("sem contexto continua devolvendo os convênios como antes", () => {
    const lista = conveniosParaMarcar(
      CONVENIOS_DA_CLINICA,
      SO_PARTICULAR(ANA),
      [],
    );
    expect(lista).toEqual([
      { id: UNIMED, active: true },
      { id: BRADESCO, active: true },
    ]);
  });
});

describe("Adicionar quem faz, com a interseção", () => {
  it("quem é novo entra com Particular e os convênios que atende e que cobrem, pelo padrão", () => {
    const ctx = contexto([UNIMED, BRADESCO]);
    expect(linhaAoAdicionar(JOAO, [], ENDO, ctx)).toEqual({
      professionalId: JOAO,
      convenios: [
        ajusteNovo(null, ENDO),
        ajusteNovo(UNIMED, ENDO),
        ajusteNovo(BRADESCO, ENDO),
      ],
    });
    expect(idsDosConvenios(linhaAoAdicionar(ANA, [], ENDO, ctx))).toEqual([
      null,
      UNIMED,
    ]);
  });

  it("procedimento que nenhum convênio cobre: só Particular", () => {
    expect(linhaAoAdicionar(JOAO, [], ENDO, contexto([]))).toEqual({
      professionalId: JOAO,
      convenios: [ajusteNovo(null, ENDO)],
    });
  });

  it("convênio inativo não entra sozinho", () => {
    expect(
      idsDosConvenios(
        linhaAoAdicionar(CAIO, [], ENDO, contexto([UNIMED, AMIL])),
      ),
    ).toEqual([null, UNIMED]);
  });

  // Na abertura: Joao com Particular proprio (R$ 380), Unimed com
  // coparticipacao (R$ 50) e Bradesco pelo padrao.
  const JOAO_NA_ABERTURA = linhasDosVinculos(
    [
      vinculo({ professional_id: JOAO, price_cents: 38000 }),
      vinculo({
        professional_id: JOAO,
        insurance_id: UNIMED,
        price_cents: 5000,
        covered_by_insurance: true,
      }),
      coberto({ professional_id: JOAO, insurance_id: BRADESCO }),
    ],
    PROC,
    ENDO,
    [JOAO],
    ORDEM,
  );

  it("quem estava na abertura volta como estava, só com o que cobre agora", () => {
    // Bradesco foi desmarcado em "cobrem" antes de Joao voltar.
    const linha = linhaAoAdicionar(
      JOAO,
      JOAO_NA_ABERTURA,
      ENDO,
      contexto([UNIMED], [UNIMED, BRADESCO]),
    );
    expect(linha).toEqual({
      professionalId: JOAO,
      convenios: JOAO_NA_ABERTURA[0]!.convenios.slice(0, 2),
    });
    expect(linha.convenios[1]).toMatchObject({
      insuranceId: UNIMED,
      padrao: false,
      precoReais: "50,00",
    });
  });

  it("a exceção da abertura continua exceção", () => {
    // Na abertura Joao fazia so Particular, com a Unimed cobrindo: e a
    // excecao dele.
    const naAbertura = [
      { professionalId: JOAO, convenios: [ajusteNovo(null, ENDO)] },
    ];
    expect(
      idsDosConvenios(
        linhaAoAdicionar(JOAO, naAbertura, ENDO, contexto([UNIMED], [UNIMED])),
      ),
    ).toEqual([null]);
  });

  it("convênio que passou a cobrir depois da abertura entra para quem o atende", () => {
    const naAbertura = [
      { professionalId: JOAO, convenios: [ajusteNovo(null, ENDO)] },
    ];
    const linha = linhaAoAdicionar(
      JOAO,
      naAbertura,
      ENDO,
      contexto([UNIMED, BRADESCO], [UNIMED]),
    );
    expect(linha.convenios).toEqual([
      ajusteNovo(null, ENDO),
      ajusteNovo(BRADESCO, ENDO),
    ]);
  });

  it("quem fazia só por um convênio que deixou de cobrir volta sem nada (o Salvar barra)", () => {
    const naAbertura = [
      { professionalId: ANA, convenios: [ajusteNovo(UNIMED, ENDO)] },
    ];
    const linha = linhaAoAdicionar(
      ANA,
      naAbertura,
      ENDO,
      contexto([], [UNIMED]),
    );
    expect(linha.convenios).toEqual([]);
    expect(vinculosDasLinhas([linha], ENDO, NOMES, []).ok).toBe(false);
  });
});

describe("Convênios que cobrem: marcar e desmarcar com o desfazer seguro", () => {
  // Na abertura, Unimed e Bradesco cobrem. Joao faz Particular e Bradesco;
  // a Unimed e a excecao dele (ele atende, ela cobre, mas ele nao faz por
  // ela aqui). Ana faz Particular e Unimed com coparticipacao de R$ 50.
  const NA_ABERTURA = linhasDosVinculos(
    [
      vinculo({ professional_id: JOAO }),
      coberto({ professional_id: JOAO, insurance_id: BRADESCO }),
      vinculo({ professional_id: ANA }),
      vinculo({
        professional_id: ANA,
        insurance_id: UNIMED,
        price_cents: 5000,
        covered_by_insurance: true,
      }),
    ],
    PROC,
    ENDO,
    [JOAO, ANA],
    ORDEM,
  );
  const PLANOS_NA_ABERTURA = [UNIMED, BRADESCO];
  const ctx = contexto(PLANOS_NA_ABERTURA, PLANOS_NA_ABERTURA);
  const ABERTO = { planos: PLANOS_NA_ABERTURA, linhas: NA_ABERTURA };
  const linhaDe = (linhas: LinhaDoProfissional[], id: string) =>
    linhas.find((l) => l.professionalId === id);

  it("desmarcar tira o convênio da lista e de todas as linhas", () => {
    const sem = desmarcarPlano(ABERTO, UNIMED);
    expect(sem.planos).toEqual([BRADESCO]);
    expect(idsDosConvenios(linhaDe(sem.linhas, ANA))).toEqual([null]);
    expect(idsDosConvenios(linhaDe(sem.linhas, JOAO))).toEqual([
      null,
      BRADESCO,
    ]);
  });

  it("desmarcar e marcar de novo volta ao que estava na abertura: valores gravados e a exceção do João", () => {
    const deNovo = marcarPlano(
      desmarcarPlano(ABERTO, UNIMED),
      UNIMED,
      ctx,
      NA_ABERTURA,
      ENDO,
    );
    expect(deNovo.planos).toEqual([UNIMED, BRADESCO]);
    expect(deNovo.linhas).toEqual(NA_ABERTURA);
    expect(linhaDe(deNovo.linhas, ANA)!.convenios[1]).toMatchObject({
      insuranceId: UNIMED,
      padrao: false,
      precoReais: "50,00",
    });
  });

  it("quem entrou depois da abertura recebe o convênio marcado de novo pelo padrão, se atende", () => {
    const sem = desmarcarPlano(ABERTO, UNIMED);
    const comCaio = {
      ...sem,
      linhas: [
        ...sem.linhas,
        linhaAoAdicionar(
          CAIO,
          NA_ABERTURA,
          ENDO,
          contexto(sem.planos, PLANOS_NA_ABERTURA),
        ),
      ],
    };
    expect(idsDosConvenios(linhaDe(comCaio.linhas, CAIO))).toEqual([null]);
    const deNovo = marcarPlano(comCaio, UNIMED, ctx, NA_ABERTURA, ENDO);
    expect(linhaDe(deNovo.linhas, CAIO)).toEqual({
      professionalId: CAIO,
      convenios: [ajusteNovo(null, ENDO), ajusteNovo(UNIMED, ENDO)],
    });
  });

  it("convênio novo entra marcado, pelo padrão, para quem o atende; quem não atende fica como está", () => {
    // So a Unimed cobria na abertura.
    const naAbertura = [
      { professionalId: JOAO, convenios: [ajusteNovo(null, ENDO)] },
      {
        professionalId: ANA,
        convenios: [ajusteNovo(null, ENDO), ajusteNovo(UNIMED, ENDO)],
      },
    ];
    const comBradesco = marcarPlano(
      { planos: [UNIMED], linhas: naAbertura },
      BRADESCO,
      contexto([UNIMED], [UNIMED]),
      naAbertura,
      ENDO,
    );
    expect(comBradesco.planos).toEqual([UNIMED, BRADESCO]);
    expect(linhaDe(comBradesco.linhas, JOAO)!.convenios).toEqual([
      ajusteNovo(null, ENDO),
      ajusteNovo(BRADESCO, ENDO),
    ]);
    expect(linhaDe(comBradesco.linhas, ANA)).toEqual(naAbertura[1]);
  });

  it("o convênio entra na ordem do catálogo, depois do Particular", () => {
    const naAbertura = [
      {
        professionalId: JOAO,
        convenios: [ajusteNovo(null, ENDO), ajusteNovo(BRADESCO, ENDO)],
      },
    ];
    const comUnimed = marcarPlano(
      { planos: [BRADESCO], linhas: naAbertura },
      UNIMED,
      contexto([BRADESCO], [BRADESCO]),
      naAbertura,
      ENDO,
    );
    expect(idsDosConvenios(comUnimed.linhas[0])).toEqual([
      null,
      UNIMED,
      BRADESCO,
    ]);
  });

  it("marcar o que já está marcado não muda nada (não desfaz a exceção feita agora)", () => {
    // Caio entrou com Unimed e a pessoa desmarcou a Unimed dele.
    const caioSemUnimed = {
      professionalId: CAIO,
      convenios: [ajusteNovo(null, ENDO)],
    };
    const atual = { ...ABERTO, linhas: [...NA_ABERTURA, caioSemUnimed] };
    const depois = marcarPlano(atual, UNIMED, ctx, NA_ABERTURA, ENDO);
    expect(depois).toEqual(atual);
  });

  it("convênio inativo não entra sozinho para ninguém", () => {
    const caio = { professionalId: CAIO, convenios: [ajusteNovo(null, ENDO)] };
    const comAmil = marcarPlano(
      { planos: [], linhas: [caio] },
      AMIL,
      contexto([]),
      [],
      ENDO,
    );
    expect(comAmil.linhas).toEqual([caio]);
  });

  it("marcar e adicionar quem faz, em qualquer ordem, dão o mesmo resultado", () => {
    // Abertura: so a Unimed cobria e Joao fazia Particular e Unimed.
    const naAbertura = [
      {
        professionalId: JOAO,
        convenios: [ajusteNovo(null, ENDO), ajusteNovo(UNIMED, ENDO)],
      },
    ];
    const ctxDaAbertura = (planos: string[]) => contexto(planos, [UNIMED]);
    // 1) marca Bradesco com Joao na lista.
    const marcandoComEle = marcarPlano(
      { planos: [UNIMED], linhas: naAbertura },
      BRADESCO,
      ctxDaAbertura([UNIMED]),
      naAbertura,
      ENDO,
    );
    // 2) remove Joao, marca Bradesco e adiciona Joao de novo.
    const semEle = marcarPlano(
      { planos: [UNIMED], linhas: [] },
      BRADESCO,
      ctxDaAbertura([UNIMED]),
      naAbertura,
      ENDO,
    );
    const voltando = linhaAoAdicionar(
      JOAO,
      naAbertura,
      ENDO,
      ctxDaAbertura(semEle.planos),
    );
    expect(voltando).toEqual(marcandoComEle.linhas[0]);
    expect(idsDosConvenios(voltando)).toEqual([null, UNIMED, BRADESCO]);
  });
});

describe("Convênios que cobrem no Salvar", () => {
  const LINHAS = linhasDosVinculos(CASO_DO_DR_JOAO, PROC, ENDO, [JOAO, ANA]);
  const ABERTURA: EstadoDosVinculos = {
    linhas: LINHAS,
    padrao: ENDO,
    iaPodeAgendar: true,
    planos: [UNIMED, BRADESCO],
    planosGravados: [BRADESCO],
  };
  const agora = (planos?: string[]): EstadoDosVinculos => ({
    linhas: LINHAS,
    padrao: ENDO,
    iaPodeAgendar: true,
    planos,
  });

  it("o mesmo conjunto em outra ordem, ou só a cura da abertura: não grava", () => {
    expect(
      precisaSincronizarVinculos(ABERTURA, agora([BRADESCO, UNIMED])),
    ).toBe(false);
  });

  it("marcou ou desmarcou convênio em cobrem: grava", () => {
    expect(precisaSincronizarVinculos(ABERTURA, agora([UNIMED]))).toBe(true);
    expect(
      precisaSincronizarVinculos(ABERTURA, agora([UNIMED, BRADESCO, AMIL])),
    ).toBe(true);
    expect(precisaSincronizarVinculos(ABERTURA, agora([]))).toBe(true);
  });

  it("só um dos lados com a seção: grava; nenhum dos dois: como antes", () => {
    expect(precisaSincronizarVinculos(ABERTURA, agora(undefined))).toBe(true);
    const semPlanos: EstadoDosVinculos = {
      linhas: LINHAS,
      padrao: ENDO,
      iaPodeAgendar: true,
    };
    expect(precisaSincronizarVinculos(semPlanos, agora([UNIMED]))).toBe(true);
    expect(precisaSincronizarVinculos(semPlanos, agora(undefined))).toBe(false);
  });

  it("recusa a linha com convênio que não está em Convênios que cobrem", () => {
    const linhas = linhasDosVinculos(CASO_DO_DR_JOAO, PROC, ENDO, [JOAO, ANA]);
    const erro = vinculosDasLinhas(linhas, ENDO, NOMES, [BRADESCO]);
    expect(erro).toEqual({
      ok: false,
      erro: "Dr. João, Unimed: este convênio não está marcado em Convênios que cobrem este procedimento.",
    });
    expect(!erro.ok && erro.erro).not.toContain(TRAVESSAO);
    expect(vinculosDasLinhas(linhas, ENDO, NOMES, [UNIMED]).ok).toBe(true);
    // Particular nao e convenio: passa mesmo sem nenhum marcado.
    expect(
      vinculosDasLinhas(
        [{ professionalId: ANA, convenios: [ajusteNovo(null, ENDO)] }],
        ENDO,
        NOMES,
        [],
      ).ok,
    ).toBe(true);
    // Sem `planos`: como antes.
    expect(vinculosDasLinhas(linhas, ENDO, NOMES).ok).toBe(true);
  });
});

describe("extras do Salvar (o que vai para a RPC)", () => {
  const LINHAS = linhasDosVinculos(CASO_DO_DR_JOAO, PROC, ENDO, [JOAO, ANA]);
  const ABERTURA: AberturaComPlanos = {
    linhas: LINHAS,
    padrao: ENDO,
    iaPodeAgendar: true,
    // Unimed so em uso (a cura); procedure_insurance gravado: Bradesco.
    planos: [UNIMED, BRADESCO],
    planosGravados: [BRADESCO],
  };

  it("os vínculos ativos e os convênios gravados na abertura, sem a cura", () => {
    expect(
      extrasDaSincronizacao(ABERTURA, [UNIMED, BRADESCO, UNIMED], false),
    ).toEqual({
      planos: [UNIMED, BRADESCO],
      vinculosNaAbertura: [
        { professional_id: JOAO, insurance_id: null },
        { professional_id: JOAO, insurance_id: UNIMED },
        { professional_id: ANA, insurance_id: null },
      ],
      planosNaAbertura: [BRADESCO],
      confirmar: false,
    });
    expect(extrasDaSincronizacao(ABERTURA, [], true).confirmar).toBe(true);
  });

  it("usa o retrato da abertura, não o que a tela tem agora", () => {
    // A pessoa removeu a Ana e desmarcou a Unimed: a abertura nao muda.
    const sem = desmarcarPlano(
      { planos: [UNIMED, BRADESCO], linhas: [...LINHAS] },
      UNIMED,
    );
    const extras = extrasDaSincronizacao(ABERTURA, sem.planos, false);
    expect(extras.planos).toEqual([BRADESCO]);
    expect(extras.vinculosNaAbertura).toHaveLength(3);
  });

  it("procedimento novo: nada na abertura", () => {
    expect(extrasDaSincronizacao(null, [UNIMED], false)).toEqual({
      planos: [UNIMED],
      vinculosNaAbertura: [],
      planosNaAbertura: [],
      confirmar: false,
    });
  });
});

describe("o caso do Dr. João (spec 3.5) com o convênio pelo profissional", () => {
  // Dr. Joao atende Unimed e Bradesco. Endocrinologia: R$ 400, 40 min,
  // coberta pelos dois. Nutrologia: R$ 500, 60 min, so particular.

  it("Endocrinologia entra com Unimed e Bradesco; Nutrologia sem cobertura, só particular", () => {
    const endo = linhaAoAdicionar(JOAO, [], ENDO, contexto([UNIMED, BRADESCO]));
    const salvoEndo = vinculosDasLinhas([endo], ENDO, NOMES, [
      UNIMED,
      BRADESCO,
    ]);
    expect(salvoEndo).toEqual({
      ok: true,
      vinculos: [
        {
          professional_id: JOAO,
          insurance_id: null,
          price_cents: 40000,
          covered_by_insurance: false,
          duration_min: 40,
        },
        {
          professional_id: JOAO,
          insurance_id: UNIMED,
          price_cents: null,
          covered_by_insurance: true,
          duration_min: 40,
        },
        {
          professional_id: JOAO,
          insurance_id: BRADESCO,
          price_cents: null,
          covered_by_insurance: true,
          duration_min: 40,
        },
      ],
    });

    const nutro = linhaAoAdicionar(JOAO, [], NUTROLOGIA, contexto([]));
    expect(vinculosDasLinhas([nutro], NUTROLOGIA, NOMES, [])).toEqual({
      ok: true,
      vinculos: [
        {
          professional_id: JOAO,
          insurance_id: null,
          price_cents: 50000,
          covered_by_insurance: false,
          duration_min: 60,
        },
      ],
    });
  });

  it("Nutrologia coberta pela Unimed: a exceção do João (só particular) fica, mesmo desmarcando e marcando a Unimed", () => {
    // 1) Procedimento novo, Unimed marcada em "cobrem": Joao entra com ela e
    //    a pessoa desmarca a Unimed dele (a excecao, so neste procedimento).
    const entrou = linhaAoAdicionar(JOAO, [], NUTROLOGIA, contexto([UNIMED]));
    expect(idsDosConvenios(entrou)).toEqual([null, UNIMED]);
    const excecao: LinhaDoProfissional = {
      ...entrou,
      convenios: entrou.convenios.filter((a) => a.insuranceId !== UNIMED),
    };
    const salvo = vinculosDasLinhas([excecao], NUTROLOGIA, NOMES, [UNIMED]);
    expect(salvo.ok && salvo.vinculos.map((v) => v.insurance_id)).toEqual([
      null,
    ]);
    expect(extrasDaSincronizacao(null, [UNIMED], false).planos).toEqual([
      UNIMED,
    ]);

    // 2) Reabre: so o Particular gravado, a Unimed cobre.
    const gravados = [
      vinculo({
        professional_id: JOAO,
        procedure_id: NUTRO,
        price_cents: 50000,
        duration_min: 60,
      }),
    ];
    const planos = planosQueCobremNaAbertura(
      NUTRO,
      [{ procedure_id: NUTRO, insurance_id: UNIMED }],
      gravados,
      ORDEM,
    );
    expect(planos).toEqual({
      marcados: [UNIMED],
      gravados: [UNIMED],
      soDoVinculo: [],
    });
    const naAbertura = linhasDosVinculos(
      gravados,
      NUTRO,
      NUTROLOGIA,
      [JOAO],
      ORDEM,
    );
    expect(idsDosConvenios(naAbertura[0])).toEqual([null]);
    // A Unimed continua oferecida para ele, desmarcada; Bradesco nao cobre.
    expect(
      conveniosParaMarcar(
        CONVENIOS_DA_CLINICA,
        naAbertura[0]!,
        naAbertura,
        contexto(planos.marcados, planos.marcados),
      ).map((o) => o.convenio.id),
    ).toEqual([UNIMED]);

    // 3) Desmarca e marca a Unimed: Joao continua so particular.
    const ctx = contexto(planos.marcados, planos.marcados);
    const aberto = { planos: planos.marcados, linhas: naAbertura };
    const desfeito = marcarPlano(
      desmarcarPlano(aberto, UNIMED),
      UNIMED,
      ctx,
      naAbertura,
      NUTROLOGIA,
    );
    expect(desfeito.linhas).toEqual(naAbertura);

    // 4) Bradesco passa a cobrir: entra para ele (atende), a Unimed nao.
    const comBradesco = marcarPlano(
      desfeito,
      BRADESCO,
      ctx,
      naAbertura,
      NUTROLOGIA,
    );
    expect(idsDosConvenios(comBradesco.linhas[0])).toEqual([null, BRADESCO]);
    expect(
      precisaSincronizarVinculos(
        {
          linhas: naAbertura,
          padrao: NUTROLOGIA,
          iaPodeAgendar: true,
          planos: planos.marcados,
          planosGravados: planos.gravados,
        },
        {
          linhas: comBradesco.linhas,
          padrao: NUTROLOGIA,
          iaPodeAgendar: true,
          planos: comBradesco.planos,
        },
      ),
    ).toBe(true);
    expect(
      vinculosDasLinhas(
        comBradesco.linhas,
        NUTROLOGIA,
        NOMES,
        comBradesco.planos,
      ).ok,
    ).toBe(true);
  });
});
