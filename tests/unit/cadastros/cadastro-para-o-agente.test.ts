import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  camposDaUnidadeParaOAgenteSchema,
  comporEndereco,
  descricaoDoRequisito,
  diasAbertos,
  enderecoCompleto,
  faixasEmTexto,
  formatarCep,
  GRADES_DE_HORARIO,
  horarioDaEdicao,
  horarioDeFuncionamentoValido,
  horarioParaEdicao,
  idadeEGradeSchema,
  lerCep,
  lerHorarioDeFuncionamento,
  lerIdade,
  LIMITES_DO_CADASTRO,
  linhasDoHorario,
  linkDaAbaDoCadastro,
  linkDoMapaValido,
  nomesEmTexto,
  pendenciasDaProntidao,
  problemaNoTextoAoPaciente,
  problemaNosRequisitos,
  problemaNosTextosDaUnidade,
  problemasDoHorarioEmEdicao,
  prontidaoDoCadastroSchema,
  requisitosDoProcedimentoSchema,
  requisitosMudaram,
  rotuloDaGrade,
  ROTULO_DO_TIPO_DE_REQUISITO,
  temEnderecoEstruturado,
  textoDaIdadeAtendida,
  TIPOS_DE_REQUISITO,
  UFS,
  VALOR_DO_TIPO,
  type ProntidaoDoCadastro,
  type RequisitoDoProcedimento,
  type RequisitoParaSalvar,
} from "@/lib/domain/cadastro-para-o-agente";

import casosDoHorario from "../../fixtures/cadastro/horarios-de-funcionamento.json";

// Cadastro para o agente (AG1, migration 20261027100000): as regras puras da
// unidade (endereco, horario, textos ao paciente), do que o procedimento
// exige, da idade e da grade do profissional e da prontidao. Cada regra que
// espelha um CHECK do banco e conferida contra o texto da migration (o
// espelho nao pode divergir), e o horario usa a MESMA tabela verdade do
// ensaio (tests/fixtures/cadastro/horarios-de-funcionamento.json).

const MIGRATION = readFileSync(
  "supabase/migrations/20261027100000_cadastro_para_o_agente.sql",
  "utf-8",
);
const TRAVESSAO = String.fromCharCode(0x2014);

describe("espelho dos CHECKs da migration", () => {
  it("as 27 UFs sao as do CHECK unit_uf_valida, na mesma ordem", () => {
    const trecho = MIGRATION.match(
      /add constraint unit_uf_valida check \(\s*uf in \(([^)]*)\)\)/,
    )?.[1];
    expect(trecho).toBeDefined();
    const doBanco = [...(trecho ?? "").matchAll(/'([A-Z]{2})'/g)].map(
      (m) => m[1],
    );
    expect(doBanco).toEqual(UFS.map(([sigla]) => sigla));
    expect(doBanco).toHaveLength(27);
  });

  it("a grade e os tipos de requisito sao os do banco", () => {
    expect(MIGRATION).toContain(
      `grade_minutos in (${GRADES_DE_HORARIO.join(", ")})`,
    );
    const tipos = MIGRATION.match(
      /procedure_requirement_tipo_valido check \(\s*tipo in \(([^)]*)\)\)/,
    )?.[1];
    expect(
      [...(tipos ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
    ).toEqual([...TIPOS_DE_REQUISITO]);
  });

  it("os tamanhos sao os dos CHECKs", () => {
    const pares: [string, number][] = [
      ["logradouro", LIMITES_DO_CADASTRO.logradouro],
      ["numero", LIMITES_DO_CADASTRO.numero],
      ["complemento", LIMITES_DO_CADASTRO.complemento],
      ["bairro", LIMITES_DO_CADASTRO.bairro],
      ["cidade", LIMITES_DO_CADASTRO.cidade],
      ["referencia", LIMITES_DO_CADASTRO.referencia],
      ["estacionamento", LIMITES_DO_CADASTRO.estacionamento],
      ["acessibilidade", LIMITES_DO_CADASTRO.acessibilidade],
      ["observacao_ao_paciente", LIMITES_DO_CADASTRO.observacaoAoPaciente],
      ["texto_ao_paciente", LIMITES_DO_CADASTRO.textoDoRequisito],
    ];
    for (const [coluna, maximo] of pares) {
      expect(MIGRATION, coluna).toContain(
        `public.cadastro_texto_valido(${coluna}, ${maximo})`,
      );
    }
    expect(MIGRATION).toContain(
      `char_length(link_do_mapa) <= ${LIMITES_DO_CADASTRO.linkDoMapa}`,
    );
    expect(MIGRATION).toContain(
      `not between 1 and ${LIMITES_DO_CADASTRO.faixasPorDia}`,
    );
    expect(MIGRATION).toContain(
      `valor_inteiro between 1 and ${LIMITES_DO_CADASTRO.minutosAntes}`,
    );
    expect(MIGRATION).toContain(
      `valor_inteiro between 1 and ${LIMITES_DO_CADASTRO.idadeDoRequisito}`,
    );
    expect(MIGRATION).toContain(
      `check (idade_minima between 0 and ${LIMITES_DO_CADASTRO.idade})`,
    );
    expect(VALOR_DO_TIPO.chegar_antes_minutos?.maximo).toBe(480);
    expect(VALOR_DO_TIPO.idade_minima?.maximo).toBe(120);
  });
});

describe("horario de funcionamento", () => {
  it("a tabela verdade do ensaio (41 casos) da o mesmo no TypeScript", () => {
    expect(casosDoHorario).toHaveLength(41);
    for (const caso of casosDoHorario) {
      expect(horarioDeFuncionamentoValido(caso.valor), caso.caso).toBe(
        caso.valido,
      );
    }
  });

  it("nulo e nao informado e passa", () => {
    expect(horarioDeFuncionamentoValido(null)).toBe(true);
    expect(horarioDeFuncionamentoValido(undefined)).toBe(true);
    expect(lerHorarioDeFuncionamento(null)).toBeNull();
  });

  it("a leitura ordena as faixas e o invalido vira nulo", () => {
    const lido = lerHorarioDeFuncionamento({
      "1": [
        { inicio: "13:00", fim: "18:00" },
        { inicio: "08:00", fim: "12:00" },
      ],
    });
    expect(lido).toEqual({
      "1": [
        { inicio: "08:00", fim: "12:00" },
        { inicio: "13:00", fim: "18:00" },
      ],
    });
    expect(lerHorarioDeFuncionamento({ "7": [] })).toBeNull();
    expect(diasAbertos(lido)).toBe(1);
    expect(faixasEmTexto(lido?.["1"] ?? [])).toBe(
      "08:00 às 12:00 e 13:00 às 18:00",
    );
    expect(linhasDoHorario(lido ?? {}).map((l) => l.texto)).toEqual([
      "Fechado",
      "08:00 às 12:00 e 13:00 às 18:00",
      "Fechado",
      "Fechado",
      "Fechado",
      "Fechado",
      "Fechado",
    ]);
  });

  it("a edicao: os problemas com o dia, o dia fechado fora da conta", () => {
    let n = 0;
    const chave = () => `k${(n += 1)}`;
    const edicao = horarioParaEdicao(
      { "1": [{ inicio: "08:00", fim: "12:00" }] },
      chave,
    );
    expect(edicao["1"].aberto).toBe(true);
    expect(edicao["0"]).toEqual({ aberto: false, faixas: [] });
    expect(problemasDoHorarioEmEdicao(edicao)).toEqual([]);

    const ruim = {
      ...edicao,
      "1": {
        aberto: true,
        faixas: [
          { chave: "a", inicio: "08:00", fim: "12:00" },
          { chave: "b", inicio: "11:00", fim: "13:00" },
        ],
      },
      "2": {
        aberto: true,
        faixas: [{ chave: "c", inicio: "8:00", fim: "12:00" }],
      },
      "3": {
        aberto: true,
        faixas: [{ chave: "d", inicio: "18:00", fim: "08:00" }],
      },
      // Fechado com faixa ruim: nao conta (nao vai para o banco).
      "4": {
        aberto: false,
        faixas: [{ chave: "e", inicio: "99:00", fim: "x" }],
      },
      "5": { aberto: true, faixas: [] },
    };
    expect(problemasDoHorarioEmEdicao(ruim)).toEqual([
      "Segunda-feira: as faixas não podem se sobrepor.",
      "Terça-feira: use a hora no formato 08:00.",
      "Quarta-feira: o fim de cada faixa precisa ser depois do início.",
      "Sexta-feira: inclua uma faixa ou marque o dia como fechado.",
    ]);
  });

  it("o que vai ao banco: so os dias abertos, em ordem; nenhum aberto e nulo", () => {
    let n = 0;
    const chave = () => `k${(n += 1)}`;
    const edicao = horarioParaEdicao(null, chave);
    expect(horarioDaEdicao(edicao)).toBeNull();
    const aberta = {
      ...edicao,
      "6": {
        aberto: true,
        faixas: [
          { chave: "x", inicio: "13:00", fim: "17:00" },
          { chave: "y", inicio: "08:00", fim: "12:00" },
        ],
      },
      "0": {
        aberto: false,
        faixas: [{ chave: "z", inicio: "08:00", fim: "12:00" }],
      },
    };
    const salvo = horarioDaEdicao(aberta);
    expect(salvo).toEqual({
      "6": [
        { inicio: "08:00", fim: "12:00" },
        { inicio: "13:00", fim: "17:00" },
      ],
    });
    expect(horarioDeFuncionamentoValido(salvo)).toBe(true);
  });
});

describe("endereco", () => {
  const completo = {
    logradouro: "Rua das Flores",
    numero: "123",
    complemento: "Sala 4",
    bairro: "Centro",
    cidade: "Fortaleza",
    uf: "CE",
  };

  it("compoe o texto sem o CEP, so com o que foi preenchido", () => {
    expect(comporEndereco(completo)).toBe(
      "Rua das Flores, 123, Sala 4, Centro, Fortaleza/CE",
    );
    expect(
      comporEndereco({ ...completo, complemento: null, bairro: "  " }),
    ).toBe("Rua das Flores, 123, Fortaleza/CE");
    expect(comporEndereco({ ...completo, uf: null })).toBe(
      "Rua das Flores, 123, Sala 4, Centro, Fortaleza",
    );
    const vazio = {
      logradouro: null,
      numero: "",
      complemento: null,
      bairro: null,
      cidade: null,
      uf: null,
    };
    expect(comporEndereco(vazio)).toBeNull();
    expect(temEnderecoEstruturado(vazio)).toBe(false);
    expect(temEnderecoEstruturado({ ...vazio, cidade: "Fortaleza" })).toBe(
      true,
    );
  });

  it("completo para o agente: rua, numero, bairro, cidade e UF", () => {
    expect(enderecoCompleto(completo)).toBe(true);
    expect(enderecoCompleto({ ...completo, complemento: null })).toBe(true);
    expect(enderecoCompleto({ ...completo, bairro: null })).toBe(false);
    expect(enderecoCompleto({ ...completo, numero: " " })).toBe(false);
  });

  it("o CEP: com ou sem hifen, 8 digitos; a mascara so na tela", () => {
    expect(lerCep("")).toBeNull();
    expect(lerCep(" 60000-000 ")).toBe("60000000");
    expect(lerCep("60000000")).toBe("60000000");
    expect(lerCep("6000-000")).toBeUndefined();
    expect(lerCep("60000.000")).toBeUndefined();
    expect(lerCep("abcdefgh")).toBeUndefined();
    expect(formatarCep("60000000")).toBe("60000-000");
  });

  it("o link do mapa: os mesmos casos do ensaio", () => {
    const bons = [
      "https://maps.app.goo.gl/AbC123",
      "https://www.google.com/maps/place/Cl%C3%ADnica/@-3.7,-38.5,17z?entry=ttu",
      "https://g.co",
      "https://x.com/caminho#ancora",
      "https://x.com?q=1",
      `https://${"a".repeat(492)}`,
    ];
    const ruins = [
      `https://${"a".repeat(493)}`,
      "http://maps.google.com",
      "https://",
      "https:///caminho",
      "HTTPS://maps.google.com",
      "https://maps google.com",
      "https://maps.google.com/a b",
      " https://g.co",
      "https://g.co ",
      "javascript:alert(1)",
      "ftp://g.co",
      "https://g.co\n",
      "www.google.com/maps",
      "",
    ];
    for (const link of bons) {
      expect(linkDoMapaValido(link), link).toBe(true);
    }
    for (const link of ruins) {
      expect(linkDoMapaValido(link), JSON.stringify(link)).toBe(false);
    }
  });
});

describe("textos ao paciente (as regras do editor da base)", () => {
  it("recusa telefone, link e valor; vazio passa", () => {
    expect(problemaNoTextoAoPaciente("")).toBeNull();
    expect(problemaNoTextoAoPaciente("   ")).toBeNull();
    expect(problemaNoTextoAoPaciente(null)).toBeNull();
    expect(problemaNoTextoAoPaciente("Ligue para 85 3333-4444")).toMatch(
      /^Tire o telefone/,
    );
    expect(
      problemaNoTextoAoPaciente("Veja no mapa: https://maps.app.goo.gl/abc"),
    ).toMatch(/^Tire o link/);
    expect(
      problemaNoTextoAoPaciente("Estacionamento pago: R$ 10 a hora"),
    ).toMatch(/^Tire o valor/);
  });

  it("os exemplos que a tela mostra passam nas regras", () => {
    for (const exemplo of [
      "Em frente à praça, ao lado da farmácia.",
      "Estacionamento próprio no subsolo, para pacientes.",
      "Rampa na entrada e elevador até o consultório.",
      "Traga a carteirinha e um documento com foto.",
      "Chegue com 10 minutos de antecedência.",
    ]) {
      expect(problemaNoTextoAoPaciente(exemplo), exemplo).toBeNull();
    }
  });

  it("o problema da unidade diz o campo", () => {
    expect(
      problemaNosTextosDaUnidade({
        referencia: "Perto do mercado",
        estacionamento: "Ligue 85 3333-4444 para reservar",
      }),
    ).toMatch(/^Estacionamento: Tire o telefone/);
    expect(
      problemaNosTextosDaUnidade({ observacao_ao_paciente: "" }),
    ).toBeNull();
  });
});

describe("schema da unidade (a entrada da action)", () => {
  it("apara, vazio vira nulo e ausente continua ausente", () => {
    const lido = camposDaUnidadeParaOAgenteSchema.parse({
      logradouro: "  Rua A  ",
      numero: "",
      uf: "CE",
      cep: "60000000",
      link_do_mapa: " https://g.co ",
      horario_de_funcionamento: { "1": [{ inicio: "08:00", fim: "12:00" }] },
    });
    expect(lido.logradouro).toBe("Rua A");
    expect(lido.numero).toBeNull();
    expect(lido.link_do_mapa).toBe("https://g.co");
    expect("bairro" in lido).toBe(false);
    expect("observacao_ao_paciente" in lido).toBe(false);
  });

  it("recusa o que o banco recusaria, com a frase do campo", () => {
    const erro = (entrada: Record<string, unknown>) =>
      camposDaUnidadeParaOAgenteSchema.safeParse(entrada).error?.issues[0]
        ?.message;
    expect(erro({ uf: "XX" })).toBe("Escolha a UF da lista.");
    expect(erro({ uf: "ce" })).toBe("Escolha a UF da lista.");
    expect(erro({ cep: "60000-000" })).toBe(
      "Use o CEP com 8 números, como 60000-000.",
    );
    expect(erro({ link_do_mapa: "http://g.co" })).toBe(
      "Link do mapa: cole o endereço completo, começando com https://.",
    );
    expect(erro({ logradouro: "a".repeat(201) })).toBe(
      "Logradouro: até 200 caracteres.",
    );
    expect(erro({ observacao_ao_paciente: "a".repeat(301) })).toBe(
      "Observação ao paciente: até 300 caracteres.",
    );
    expect(erro({ horario_de_funcionamento: {} })).toBe(
      "Confira o horário de funcionamento.",
    );
    expect(erro({ horario_de_funcionamento: null })).toBeUndefined();
  });
});

describe("profissional: idade e grade", () => {
  it("lerIdade e o texto da idade atendida", () => {
    expect(lerIdade("")).toBeNull();
    expect(lerIdade(" 18 ")).toBe(18);
    expect(lerIdade("0")).toBe(0);
    expect(lerIdade("121")).toBeUndefined();
    expect(lerIdade("-1")).toBeUndefined();
    expect(lerIdade("1.5")).toBeUndefined();
    expect(textoDaIdadeAtendida(18, 65)).toBe("De 18 a 65 anos");
    expect(textoDaIdadeAtendida(12, null)).toBe("A partir de 12 anos");
    expect(textoDaIdadeAtendida(null, 17)).toBe("Até 17 anos");
    expect(textoDaIdadeAtendida(null, null)).toBe("Todas as idades");
    expect(textoDaIdadeAtendida(0, 1)).toBe("De 0 a 1 ano");
  });

  it("a grade so da lista", () => {
    expect(rotuloDaGrade(null)).toBe("Sem grade definida");
    expect(rotuloDaGrade(30)).toBe("A cada 30 minutos");
    expect(idadeEGradeSchema.safeParse({ grade_minutos: 25 }).success).toBe(
      false,
    );
    expect(idadeEGradeSchema.safeParse({ grade_minutos: 45 }).success).toBe(
      true,
    );
    expect(idadeEGradeSchema.safeParse({ idade_minima: 121 }).success).toBe(
      false,
    );
    expect(idadeEGradeSchema.parse({})).toEqual({});
  });
});

describe("o que o paciente precisa", () => {
  const nome = (id: string | null) => (id === null ? "todos" : "Unimed");
  const base: RequisitoParaSalvar = {
    tipo: "pedido_medico",
    insurance_id: null,
    valor_inteiro: null,
    texto_ao_paciente: null,
    ativo: true,
  };

  it("o numero so no tipo que pede, na faixa do tipo", () => {
    expect(problemaNosRequisitos([{ ...base }], nome)).toBeNull();
    expect(
      problemaNosRequisitos([{ ...base, tipo: "chegar_antes_minutos" }], nome),
    ).toBe(
      "Chegar antes do horário: use um número inteiro de 1 a 480 minutos.",
    );
    expect(
      problemaNosRequisitos(
        [{ ...base, tipo: "chegar_antes_minutos", valor_inteiro: 15 }],
        nome,
      ),
    ).toBeNull();
    expect(
      problemaNosRequisitos(
        [{ ...base, tipo: "idade_minima", valor_inteiro: 121 }],
        nome,
      ),
    ).toBe("Idade mínima: use um número inteiro de 1 a 120 anos.");
    expect(
      problemaNosRequisitos(
        [{ ...base, tipo: "idade_minima", valor_inteiro: Number.NaN }],
        nome,
      ),
    ).toBe("Idade mínima: use um número inteiro de 1 a 120 anos.");
    expect(problemaNosRequisitos([{ ...base, valor_inteiro: 3 }], nome)).toBe(
      "Pedido médico: este item não leva número.",
    );
  });

  it("Outro pede texto; o texto passa pelas regras", () => {
    expect(problemaNosRequisitos([{ ...base, tipo: "outro" }], nome)).toBe(
      "Outro: escreva o que o paciente precisa.",
    );
    expect(
      problemaNosRequisitos(
        [{ ...base, texto_ao_paciente: "Ligue 85 3333-4444 antes" }],
        nome,
      ),
    ).toMatch(/^Pedido médico: Tire o telefone/);
    expect(
      problemaNosRequisitos(
        [{ ...base, texto_ao_paciente: "a".repeat(301) }],
        nome,
      ),
    ).toBe("Pedido médico: o texto ao paciente vai até 300 caracteres.");
  });

  it("um so ativo do mesmo tipo e convenio, menos Outro", () => {
    expect(problemaNosRequisitos([{ ...base }, { ...base }], nome)).toBe(
      "Pedido médico para todos aparece duas vezes. Deixe um só ativo.",
    );
    expect(
      problemaNosRequisitos([{ ...base }, { ...base, ativo: false }], nome),
    ).toBeNull();
    expect(
      problemaNosRequisitos(
        [{ ...base }, { ...base, insurance_id: "conv" }],
        nome,
      ),
    ).toBeNull();
    const outro = {
      ...base,
      tipo: "outro" as const,
      texto_ao_paciente: "Traga os exames.",
    };
    expect(problemaNosRequisitos([outro, outro], nome)).toBeNull();
  });

  it("a descricao e o que mudou", () => {
    expect(
      descricaoDoRequisito({ tipo: "chegar_antes_minutos", valor_inteiro: 15 }),
    ).toBe("Chegar 15 minutos antes");
    expect(
      descricaoDoRequisito({ tipo: "idade_minima", valor_inteiro: 18 }),
    ).toBe("Idade mínima: 18 anos");
    expect(
      descricaoDoRequisito({ tipo: "carteirinha", valor_inteiro: null }),
    ).toBe(ROTULO_DO_TIPO_DE_REQUISITO.carteirinha);
    const gravado: RequisitoDoProcedimento = {
      id: "r1",
      procedure_id: "p",
      insurance_id: null,
      tipo: "pedido_medico",
      valor_inteiro: null,
      texto_ao_paciente: "Traga o pedido.",
      ativo: true,
    };
    const igual: RequisitoParaSalvar = {
      id: "r1",
      tipo: "pedido_medico",
      insurance_id: null,
      valor_inteiro: null,
      texto_ao_paciente: " Traga o pedido. ",
      ativo: true,
    };
    expect(requisitosMudaram([igual], [gravado])).toBe(false);
    expect(requisitosMudaram([{ ...igual, ativo: false }], [gravado])).toBe(
      true,
    );
    expect(requisitosMudaram([], [gravado])).toBe(true);
    expect(requisitosMudaram([{ ...igual, id: undefined }], [gravado])).toBe(
      true,
    );
  });

  it("o schema da action recusa tipo fora da lista e mais de 30 itens", () => {
    const procedure_id = "0a0a0a0a-0000-4000-8000-00000000000a";
    expect(
      requisitosDoProcedimentoSchema.safeParse({
        procedure_id,
        requisitos: [{ ...base, tipo: "invalido" }],
        ids_na_abertura: [],
      }).success,
    ).toBe(false);
    expect(
      requisitosDoProcedimentoSchema.safeParse({
        procedure_id,
        requisitos: Array.from({ length: 31 }, () => base),
        ids_na_abertura: [],
      }).success,
    ).toBe(false);
    const lido = requisitosDoProcedimentoSchema.parse({
      procedure_id,
      requisitos: [{ ...base, texto_ao_paciente: "  " }],
      ids_na_abertura: [],
    });
    expect(lido.requisitos[0]?.texto_ao_paciente).toBeNull();
  });
});

describe("prontidao do cadastro", () => {
  const vazia = { total: 0, nomes: [] as string[] };
  const pronta: ProntidaoDoCadastro = {
    profissionais_sem_jornada: vazia,
    procedimentos_sem_vinculo: vazia,
    procedimentos_sem_preco: vazia,
    unidades_ativas: 1,
    nenhuma_unidade_ativa: false,
    unidades_sem_endereco: vazia,
    unidades_sem_horario: vazia,
    convenios_sem_cobertura: vazia,
    procedimentos_sem_requisitos: vazia,
  };

  it("le o formato exato da funcao e recusa o que falta", () => {
    expect(prontidaoDoCadastroSchema.safeParse(pronta).success).toBe(true);
    const { unidades_ativas: _sem, ...faltando } = pronta;
    void _sem;
    expect(prontidaoDoCadastroSchema.safeParse(faltando).success).toBe(false);
  });

  it("pronta: nenhuma frase", () => {
    expect(pendenciasDaProntidao(pronta)).toEqual([]);
  });

  it("as frases na ordem da recepcao, com a aba certa e sem travessao", () => {
    const frases = pendenciasDaProntidao({
      profissionais_sem_jornada: {
        total: 2,
        nomes: ["bia Souza", "Bruno Reis"],
      },
      procedimentos_sem_vinculo: { total: 12, nomes: ["A", "B", "C", "D"] },
      procedimentos_sem_preco: { total: 1, nomes: ["Retorno"] },
      unidades_ativas: 0,
      nenhuma_unidade_ativa: true,
      unidades_sem_endereco: vazia,
      unidades_sem_horario: vazia,
      convenios_sem_cobertura: { total: 1, nomes: ["Hapvida (Mix)"] },
      procedimentos_sem_requisitos: { total: 3, nomes: ["X", "Y", "Z"] },
    });
    expect(frases.map((f) => [f.chave, f.tipo, f.aba])).toEqual([
      ["sem_unidade", "pendencia", "unidades"],
      ["profissionais_sem_jornada", "pendencia", "profissionais"],
      ["procedimentos_sem_vinculo", "pendencia", "procedimentos"],
      ["procedimentos_sem_preco", "pendencia", "procedimentos"],
      ["convenios_sem_cobertura", "pendencia", "procedimentos"],
      ["procedimentos_sem_requisitos", "informativo", "procedimentos"],
    ]);
    expect(frases[1]?.texto).toBe(
      "2 profissionais ativos sem jornada, então a agenda não abre horário: bia Souza e Bruno Reis.",
    );
    expect(frases[2]?.texto).toBe(
      "12 procedimentos que a IA pode agendar estão sem ninguém em Quem faz e convênios: A, B, C e mais 9.",
    );
    expect(frases[3]?.texto).toBe(
      "1 procedimento que a IA pode agendar está sem preço e sem Coberto em Quem faz e convênios: Retorno.",
    );
    for (const frase of frases) {
      expect(frase.texto).not.toContain(TRAVESSAO);
      expect(frase.rotuloDoLink).toMatch(/^Abrir /);
    }
  });

  it("os links das abas de Cadastros", () => {
    expect(linkDaAbaDoCadastro("profissionais")).toBe("/cadastros");
    expect(linkDaAbaDoCadastro("unidades")).toBe("/cadastros?aba=unidades");
    expect(linkDaAbaDoCadastro("procedimentos")).toBe(
      "/cadastros?aba=procedimentos",
    );
    expect(nomesEmTexto({ total: 1, nomes: ["Ana"] })).toBe("Ana");
    expect(nomesEmTexto({ total: 2, nomes: ["Ana", "Bia"] })).toBe("Ana e Bia");
    expect(nomesEmTexto({ total: 0, nomes: [] })).toBe("");
  });
});
