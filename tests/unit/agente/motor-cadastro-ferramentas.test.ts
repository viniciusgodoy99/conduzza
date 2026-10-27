import type { FunctionTool } from "openai/resources/responses/responses";
import { describe, expect, it } from "vitest";

import {
  buscarProcedimento,
  limiteDaSaidaDaBusca,
  nomesDoCatalogo,
  type CatalogoDoAgente,
} from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  buscarProfissionais,
  entradaDaBuscaDeProfissionaisSchema,
  FERRAMENTA_BUSCAR_PROFISSIONAIS,
} from "@/lib/agente/ferramentas/buscar-profissionais";
import {
  enderecoMontado,
  horarioEmTexto,
  idadeAtendidaEmTexto,
  textoAoPacienteParaOAgente,
} from "@/lib/agente/ferramentas/cadastro-do-agente";
import {
  consultarRequisitos,
  entradaDaConsultaDeRequisitosSchema,
  FERRAMENTA_CONSULTAR_REQUISITOS,
} from "@/lib/agente/ferramentas/consultar-requisitos";
import {
  consultarUnidades,
  entradaDaConsultaDeUnidadesSchema,
  FERRAMENTA_CONSULTAR_UNIDADES,
} from "@/lib/agente/ferramentas/consultar-unidades";
import {
  executarConsultaDoCadastro,
  limiteDasConsultasDoCadastro,
  type ResultadoDaConsulta,
} from "@/lib/agente/ferramentas/consultas-do-cadastro";
import { FERRAMENTAS_DO_CADASTRO } from "@/lib/domain/agente/config";

import { catalogoDaAgenda, CONV, PROC, PROF } from "./agenda-fixtures";
import {
  catalogoDoCadastro,
  CONV_INATIVO,
  ENDERECO_DA_ALDEOTA,
  ENDERECO_DO_CENTRO,
  linhasDoCadastro,
  PROC_AG2,
  PROF_AG2,
  TUDO_LIGADO,
  UNID,
} from "./cadastro-fixtures";

// As consultas do Cadastro do agente (AG2, 27/10/2026): consultar_unidades,
// consultar_requisitos e buscar_profissionais, e o que buscar_procedimento
// traz a mais (duracao, avaliacao, requisitos, unidades e o procedimento que
// so a equipe marca). Puras, sobre o catalogo montado das linhas do banco:
// nada de banco, de rede nem de paciente.

const CATALOGO = catalogoDoCadastro();

function json(r: { saida: string }): Record<string, unknown> {
  return JSON.parse(r.saida) as Record<string, unknown>;
}

function unidades(argumentos: unknown = { unidade: null }) {
  return consultarUnidades(CATALOGO, argumentos);
}

function requisitos(
  procedimento: string,
  convenio: string | null = null,
  opcoes = TUDO_LIGADO,
) {
  return consultarRequisitos(CATALOGO, { procedimento, convenio }, opcoes);
}

function profissionais(
  filtros: {
    especialidade?: string | null;
    procedimento?: string | null;
    convenio?: string | null;
    unidade?: string | null;
  } = {},
  opcoes = TUDO_LIGADO,
  catalogo: CatalogoDoAgente = CATALOGO,
) {
  return buscarProfissionais(
    catalogo,
    {
      especialidade: filtros.especialidade ?? null,
      procedimento: filtros.procedimento ?? null,
      convenio: filtros.convenio ?? null,
      unidade: filtros.unidade ?? null,
    },
    opcoes,
  );
}

function nomes(r: ResultadoDaConsulta): string[] {
  return ((json(r).profissionais ?? []) as { nome: string }[]).map(
    (p) => p.nome,
  );
}

/** Nada que o filtro de saida barra, nem dado que nao vai a IA. */
function semContatoNemPreparo(saida: string): void {
  expect(saida).not.toMatch(/60150160|60150-160/);
  expect(saida).not.toMatch(/https?:|www\./);
  expect(saida).not.toMatch(/\(\d{2}\)|\d{4,5}-\d{4}/);
  expect(saida.toLowerCase()).not.toContain("jejum");
}

describe("definições para a Responses API", () => {
  const casos: [FunctionTool, { shape: Record<string, unknown> }][] = [
    [FERRAMENTA_CONSULTAR_UNIDADES, entradaDaConsultaDeUnidadesSchema],
    [FERRAMENTA_CONSULTAR_REQUISITOS, entradaDaConsultaDeRequisitosSchema],
    [FERRAMENTA_BUSCAR_PROFISSIONAIS, entradaDaBuscaDeProfissionaisSchema],
  ];
  it.each(casos)(
    "%#: strict, todas as propriedades exigidas, as chaves do Zod e sem travessão",
    (ferramenta, schema) => {
      const parametros = ferramenta.parameters as {
        properties: Record<string, unknown>;
        required: string[];
        additionalProperties: boolean;
      };
      expect(ferramenta.strict).toBe(true);
      expect(parametros.additionalProperties).toBe(false);
      expect(Object.keys(parametros.properties).sort()).toEqual(
        Object.keys(schema.shape).sort(),
      );
      expect([...parametros.required].sort()).toEqual(
        Object.keys(parametros.properties).sort(),
      );
      expect(JSON.stringify(ferramenta)).not.toMatch(/[–—]/);
      expect(FERRAMENTAS_DO_CADASTRO as readonly string[]).toContain(
        ferramenta.name,
      );
    },
  );
});

describe("o catálogo da AG2", () => {
  it("o índice não muda; os ativos fora dele vêm depois, com o código seguinte", () => {
    expect(CATALOGO.procedimentos).toEqual(
      catalogoDaAgenda().procedimentos.map((p) => ({
        ...p,
        exigeAvaliacao: false,
      })),
    );
    expect(
      (CATALOGO.procedimentosSoComAEquipe ?? []).map((p) => [
        p.codigo,
        p.nome,
        p.informaValor,
        p.exigeAvaliacao,
      ]),
    ).toEqual([
      ["p4", "Botox", true, true],
      ["p5", "Implante", false, false],
    ]);
    // O inativo (Peeling) fica de fora de tudo.
    expect(JSON.stringify(CATALOGO)).not.toContain("Peeling");
  });

  it("os vínculos da equipe: só do procedimento que deixa informar, nunca na agenda", () => {
    expect(
      (CATALOGO.vinculosDaEquipe ?? []).map((v) => [
        v.procedimentoId,
        v.convenioId,
        v.precoCentavos,
      ]),
    ).toEqual([
      [PROC_AG2.botox, null, 120_000],
      [PROC_AG2.botox, CONV.unimed, null],
    ]);
    expect(CATALOGO.vinculos.map((v) => v.procedimentoId)).not.toContain(
      PROC_AG2.botox,
    );
  });

  it("a matriz: todos os vínculos ativos, só ids, sem repetir", () => {
    expect(CATALOGO.matriz).toEqual(
      expect.arrayContaining([
        {
          procedimentoId: PROC.consulta,
          profissionalId: PROF.ana,
          convenioId: CONV.unimed,
        },
        {
          procedimentoId: PROC_AG2.botox,
          profissionalId: PROF.ana,
          convenioId: null,
        },
        {
          procedimentoId: PROC_AG2.implante,
          profissionalId: PROF.bruno,
          convenioId: null,
        },
      ]),
    );
    expect(CATALOGO.matriz).toHaveLength(8);
    expect(JSON.stringify(CATALOGO.matriz)).not.toMatch(/price|preco|valor/);
  });

  it("jornada por unidade, convênios do profissional e idade: só os ativos", () => {
    expect(CATALOGO.jornadas).toEqual([
      { profissionalId: PROF.ana, unidadeId: UNID.aldeota },
      { profissionalId: PROF.bruno, unidadeId: null },
      { profissionalId: PROF_AG2.carla, unidadeId: UNID.centro },
    ]);
    expect(CATALOGO.conveniosDosProfissionais).toEqual([
      { profissionalId: PROF.ana, convenioId: CONV.unimed },
      { profissionalId: PROF.bruno, convenioId: CONV.amil },
      { profissionalId: PROF_AG2.carla, convenioId: CONV.unimed },
    ]);
    const porId = new Map((CATALOGO.profissionais ?? []).map((p) => [p.id, p]));
    expect(porId.get(PROF.ana)).toMatchObject({ idadeMinima: 12 });
    expect(porId.get(PROF.ana)).not.toHaveProperty("idadeMaxima");
    expect(porId.get(PROF.bruno)).toMatchObject({
      idadeMinima: 18,
      idadeMaxima: 65,
    });
    expect(porId.get(PROF_AG2.carla)).not.toHaveProperty("idadeMinima");
  });

  it("requisitos: só os ativos, de procedimento ativo e convênio ativo; o preparo clínico fica de fora e conta", () => {
    const requisitos = CATALOGO.requisitos ?? [];
    expect(requisitos.some((r) => r.convenioId === CONV_INATIVO)).toBe(false);
    expect(requisitos.some((r) => r.procedimentoId === PROC_AG2.peeling)).toBe(
      false,
    );
    expect(requisitos.some((r) => r.procedimentoId === PROC.limpeza)).toBe(
      false,
    );
    expect(JSON.stringify(requisitos)).not.toContain("jejum");
    expect(CATALOGO.textosDoCadastroDescartados).toBe(1);
  });

  it("requisito fora do formato fica de fora e conta (tipo fora da lista, número incoerente)", () => {
    const catalogo = catalogoDoCadastro({
      requisitos: [
        {
          procedure_id: PROC.consulta,
          insurance_id: null,
          tipo: "jejum",
          valor_inteiro: null,
          texto_ao_paciente: null,
          ativo: true,
        },
        {
          procedure_id: PROC.consulta,
          insurance_id: null,
          tipo: "chegar_antes_minutos",
          valor_inteiro: 0,
          texto_ao_paciente: null,
          ativo: true,
        },
        {
          procedure_id: PROC.consulta,
          insurance_id: null,
          tipo: "carteirinha",
          valor_inteiro: 3,
          texto_ao_paciente: null,
          ativo: true,
        },
        {
          procedure_id: PROC.consulta,
          insurance_id: null,
          tipo: "pedido_medico",
          valor_inteiro: null,
          texto_ao_paciente: "Ligue para (85) 99999-8888 antes.",
          ativo: true,
        },
      ],
    });
    // O pedido medico fica, sem o texto que as regras barram.
    expect(catalogo.requisitos).toEqual([
      {
        procedimentoId: PROC.consulta,
        convenioId: null,
        tipo: "pedido_medico",
        valor: null,
        texto: null,
      },
    ]);
    expect(catalogo.textosDoCadastroDescartados).toBe(4);
  });

  it("nomes do catálogo (máscara do filtro): os procedimentos só com a equipe também", () => {
    expect(nomesDoCatalogo(CATALOGO)).toEqual(
      expect.arrayContaining(["Botox", "Implante", "Consulta"]),
    );
  });
});

describe("consultar_unidades", () => {
  it("as unidades ativas, por nome, com o endereço num campo só, o horário e quem atende", () => {
    const r = unidades();
    expect(r.resultado).toBe("unidades");
    expect(json(r)).toEqual({
      resultado: "unidades",
      unidades: [
        {
          codigo: "u1",
          nome: "Aldeota",
          endereco: ENDERECO_DA_ALDEOTA,
          ponto_de_referencia: "Em frente à praça Portugal.",
          estacionamento: "Estacionamento no subsolo do prédio.",
          acessibilidade: "Acesso por rampa e elevador.",
          observacao: "Entrada pela portaria principal.",
          horario_de_funcionamento: [
            "segunda a sexta: 08:00 às 12:00 e 14:00 às 18:00",
            "sábado: 08:00 às 12:00",
            "domingo: fechado",
          ],
          // O Dr. Bruno tem jornada sem unidade: qualquer unidade.
          profissionais: ["Dr. Bruno Costa", "Dra. Ana Lima"],
        },
        {
          codigo: "u2",
          nome: "Centro",
          endereco: ENDERECO_DO_CENTRO,
          horario_de_funcionamento: null,
          profissionais: ["Dr. Bruno Costa", "Dra. Carla Dias"],
        },
      ],
    });
    expect(r.passo).toBe("Consultou as unidades: Aldeota, Centro");
    expect(r.saida).not.toContain("Antiga");
    expect(r.fatos).toBeUndefined();
    semContatoNemPreparo(r.saida);
  });

  it("uma unidade pelo código; código desconhecido e entrada fora do formato não quebram", () => {
    const centro = unidades({ unidade: "U2" });
    expect(
      (json(centro).unidades as { nome: string }[]).map((u) => u.nome),
    ).toEqual(["Centro"]);
    expect(centro.passo).toBe("Consultou a unidade Centro");
    expect(unidades({ unidade: "u9" }).resultado).toBe(
      "unidade_nao_encontrada",
    );
    for (const errado of [{}, { unidade: 3 }, { unidade: null, outra: 1 }]) {
      expect(unidades(errado).resultado).toBe("entrada_invalida");
    }
  });

  it("sem unidade cadastrada: o resultado diz isso", () => {
    const r = consultarUnidades(catalogoDaAgenda(), { unidade: null });
    expect(json(r)).toEqual({ resultado: "sem_unidade_cadastrada" });
    expect(r.passo).toBe(
      "Consultou as unidades: nenhuma unidade ativa no Cadastro",
    );
  });

  it("CEP, telefone, link e o endereço livre nunca saem; texto que as regras barram fica de fora e conta", () => {
    const catalogo = catalogoDoCadastro({
      unidades: [
        {
          id: UNID.comTelefone,
          name: "Meireles",
          active: true,
          logradouro: "Rua Tibúrcio Cavalcante",
          numero: "500",
          bairro: "Meireles",
          cidade: "Fortaleza",
          uf: "CE",
          referencia: "Ligue (85) 99999-8888 ao chegar.",
          estacionamento: "Estacionamento gratuito no local.",
          acessibilidade: null,
          observacao_ao_paciente: "Veja www.exemplo.com.br",
          horario_de_funcionamento: {
            "1": [{ inicio: "08:00", fim: "17:00" }],
          },
        },
      ],
    });
    const r = consultarUnidades(catalogo, { unidade: null });
    expect(json(r)).toEqual({
      resultado: "unidades",
      unidades: [
        {
          codigo: "u1",
          nome: "Meireles",
          endereco: "Rua Tibúrcio Cavalcante, 500, Meireles, Fortaleza, CE",
          horario_de_funcionamento: [
            "segunda: 08:00 às 17:00",
            "terça a domingo: fechado",
          ],
          profissionais: ["Dr. Bruno Costa"],
        },
      ],
    });
    // Referencia, estacionamento e observacao: tres textos barrados.
    expect(catalogo.textosDoCadastroDescartados).toBe(1 + 3);
    semContatoNemPreparo(r.saida);
  });

  it("unidade cujo nome as regras barram fica de fora inteira; endereço montado que as regras barram vira nulo", () => {
    const catalogo = catalogoDoCadastro({
      unidades: [
        { id: UNID.comTelefone, name: "Unidade (85) 3333-4444", active: true },
        {
          id: UNID.centro,
          name: "Centro",
          active: true,
          logradouro: "Rua das Dores",
          numero: "12",
          cidade: "Recife",
          uf: "PE",
        },
      ],
    });
    const r = consultarUnidades(catalogo, { unidade: null });
    expect(json(r).unidades).toEqual([
      {
        codigo: "u1",
        nome: "Centro",
        endereco: null,
        horario_de_funcionamento: null,
        profissionais: ["Dr. Bruno Costa", "Dra. Carla Dias"],
      },
    ]);
  });
});

describe("horário de funcionamento e endereço em texto", () => {
  it("dias seguidos com as mesmas faixas viram uma linha; dois dias com 'e'; fechado explícito", () => {
    expect(
      horarioEmTexto({
        "1": [{ inicio: "07:30", fim: "19:00" }],
        "2": [{ inicio: "07:30", fim: "19:00" }],
        "4": [{ inicio: "07:30", fim: "19:00" }],
        "6": [{ inicio: "08:00", fim: "12:00" }],
        "0": [{ inicio: "08:00", fim: "12:00" }],
      }),
    ).toEqual([
      "segunda e terça: 07:30 às 19:00",
      "quarta: fechado",
      "quinta: 07:30 às 19:00",
      "sexta: fechado",
      "sábado e domingo: 08:00 às 12:00",
    ]);
    expect(
      horarioEmTexto({
        "3": [
          { inicio: "08:00", fim: "10:00" },
          { inicio: "11:00", fim: "12:00" },
          { inicio: "13:00", fim: "18:00" },
        ],
      }),
    ).toEqual([
      "segunda e terça: fechado",
      "quarta: 08:00 às 10:00, 11:00 às 12:00 e 13:00 às 18:00",
      "quinta a domingo: fechado",
    ]);
  });

  it("o endereço montado: só com logradouro, sem CEP, numa linha", () => {
    expect(
      enderecoMontado({
        id: "x",
        name: "X",
        logradouro: "  Rua das Flores\n",
        numero: "S/N",
        bairro: "Centro",
        cidade: "Fortaleza",
        uf: "CE",
      }),
    ).toBe("Rua das Flores, S/N, Centro, Fortaleza, CE");
    expect(
      enderecoMontado({ id: "x", name: "X", numero: "10", cidade: "Recife" }),
    ).toBeNull();
  });

  it("a idade atendida em texto curto; sem limite, nada a dizer", () => {
    expect(idadeAtendidaEmTexto(18, 65)).toBe("de 18 a 65 anos");
    expect(idadeAtendidaEmTexto(12, null)).toBe("a partir de 12 anos");
    expect(idadeAtendidaEmTexto(null, 1)).toBe("até 1 ano");
    expect(idadeAtendidaEmTexto(null, null)).toBeNull();
    expect(idadeAtendidaEmTexto(70, 18)).toBeNull();
    expect(idadeAtendidaEmTexto(-1, 200)).toBeNull();
  });

  it("o texto ao paciente: aparado, numa linha, sem sinal de bloco; o que as regras barram some", () => {
    expect(textoAoPacienteParaOAgente("  Rampa <b>e</b>\nelevador ")).toEqual({
      texto: "Rampa b e /b elevador",
      descartado: false,
    });
    expect(textoAoPacienteParaOAgente("   ")).toEqual({
      texto: null,
      descartado: false,
    });
    expect(textoAoPacienteParaOAgente(null)).toEqual({
      texto: null,
      descartado: false,
    });
    expect(textoAoPacienteParaOAgente("Tome um analgésico antes.")).toEqual({
      texto: null,
      descartado: true,
    });
  });
});

describe("consultar_requisitos", () => {
  it("sem convênio: os gerais, com o aviso de que há itens por convênio", () => {
    const r = requisitos("p1");
    expect(json(r)).toEqual({
      resultado: "requisitos",
      procedimento: "Consulta",
      ha_requisitos_por_convenio: true,
      requisitos: [
        { item: "Documento com foto" },
        {
          item: "Chegar 15 minutos antes",
          texto_ao_paciente: "Chegue com antecedência para o cadastro.",
        },
      ],
    });
    expect(r.passo).toBe(
      "Consultou o que o paciente precisa para Consulta: 2 itens",
    );
    expect(r.fatos).toBeUndefined();
  });

  it("com o convênio identificado: os gerais e os dele, separados", () => {
    const r = requisitos("p1", "Unimed Nacional");
    expect(json(r)).toEqual({
      resultado: "requisitos",
      procedimento: "Consulta",
      convenio: "Unimed (Nacional)",
      requisitos: [
        { item: "Documento com foto" },
        {
          item: "Chegar 15 minutos antes",
          texto_ao_paciente: "Chegue com antecedência para o cadastro.",
        },
      ],
      requisitos_do_convenio: [
        { item: "Autorização prévia do convênio" },
        { item: "Carteirinha do convênio" },
      ],
    });
    expect(r.passo).toBe(
      "Consultou o que o paciente precisa para Consulta pelo convênio Unimed (Nacional): 4 itens",
    );
  });

  it("particular: só os gerais, sem o aviso", () => {
    expect(json(requisitos("p1", "particular"))).toMatchObject({
      resultado: "requisitos",
      convenio: "particular",
    });
    expect(json(requisitos("p1", "particular"))).not.toHaveProperty(
      "ha_requisitos_por_convenio",
    );
  });

  it("dúvida sobre o convênio: as opções pela regra de buscar_procedimento, com os gerais e nada do convênio", () => {
    const plano = requisitos("p1", "Bradesco");
    expect(json(plano)).toEqual({
      resultado: "plano_nao_informado",
      procedimento: "Consulta",
      requisitos: [
        { item: "Documento com foto" },
        {
          item: "Chegar 15 minutos antes",
          texto_ao_paciente: "Chegue com antecedência para o cadastro.",
        },
      ],
      planos_da_operadora: [
        {
          convenio: "Bradesco Saúde (Flex)",
          chamar_com: "Bradesco Saúde (Flex)",
        },
        {
          convenio: "Bradesco Saúde (Top)",
          chamar_com: "Bradesco Saúde (Top)",
        },
      ],
    });
    const duvida = requisitos("p1", "Unimed");
    expect(duvida.resultado).toBe("convenio_nao_confirmado");
    expect(duvida.saida).not.toContain("Carteirinha");
    const nada = requisitos("p1", "plano do joão 85 99999-8888");
    expect(nada.resultado).toBe("convenio_nao_encontrado");
    expect(nada.saida).not.toContain("99999");
    expect(nada.passo).not.toContain("99999");
    expect(requisitos("p1", "tenho plano").resultado).toBe(
      "convenio_nao_informado",
    );
  });

  it("o texto do 'outro' é o próprio item; o preparo clínico nunca sai", () => {
    const r = requisitos("p2");
    expect(json(r).requisitos).toEqual([
      { item: "Pedido médico", texto_ao_paciente: "Traga o pedido médico." },
      { item: "Exames anteriores" },
      { item: "Traga o comprovante de residência." },
    ]);
    semContatoNemPreparo(r.saida);
  });

  it("o procedimento só com a equipe que deixa informar responde; o que não deixa, não", () => {
    expect(json(requisitos("p4"))).toEqual({
      resultado: "requisitos",
      procedimento: "Botox",
      requisitos: [
        { item: "Idade mínima: 18 anos" },
        { item: "Avaliação antes do procedimento" },
      ],
    });
    const implante = requisitos("p5");
    expect(json(implante)).toEqual({
      resultado: "so_com_a_equipe",
      procedimento: "Implante",
    });
    expect(implante.saida).not.toContain("Acompanhante");
  });

  it("nada cadastrado: nunca 'não precisa de nada'", () => {
    const r = requisitos("p3");
    expect(json(r)).toEqual({
      resultado: "sem_requisitos_cadastrados",
      procedimento: "Limpeza de pele",
    });
    expect(r.passo).toBe(
      "Consultou o que o paciente precisa para Limpeza de pele: nada cadastrado",
    );
  });

  it("com 'Informar preço e convênio' desligada, o convênio fica com a equipe", () => {
    const r = requisitos("p1", "Unimed Nacional", {
      informarConvenio: false,
      agendaLigada: true,
    });
    expect(json(r)).toEqual({
      resultado: "informar_convenio_desligado",
      procedimento: "Consulta",
    });
    // Sem convenio, os gerais saem do mesmo jeito.
    expect(
      requisitos("p1", null, { informarConvenio: false, agendaLigada: false })
        .resultado,
    ).toBe("requisitos");
  });

  it("procedimento desconhecido e entrada fora do formato", () => {
    expect(requisitos("p9").resultado).toBe("procedimento_nao_encontrado");
    expect(
      consultarRequisitos(CATALOGO, { procedimento: "p1" }, TUDO_LIGADO)
        .resultado,
    ).toBe("entrada_invalida");
  });
});

describe("buscar_profissionais", () => {
  it("sem filtro: todos os ativos, com o código, as especialidades, quem a IA marca, as unidades e a idade, nunca preço", () => {
    const r = profissionais();
    expect(json(r)).toEqual({
      resultado: "profissionais",
      profissionais: [
        {
          codigo: "r1",
          nome: "Dr. Bruno Costa",
          especialidades: ["Cardiologia"],
          marca_pela_ia: true,
          unidades: ["Aldeota", "Centro"],
          idade_atendida: "de 18 a 65 anos",
        },
        {
          codigo: "r2",
          nome: "Dra. Ana Lima",
          especialidades: ["Dermatologia", "Estética"],
          marca_pela_ia: true,
          unidades: ["Aldeota"],
          idade_atendida: "a partir de 12 anos",
        },
        {
          nome: "Dra. Carla Dias",
          especialidades: ["Ginecologia"],
          marca_pela_ia: false,
          unidades: ["Centro"],
        },
      ],
    });
    expect(r.saida).not.toMatch(/R\$|valor|preco/);
    expect(r.saida).not.toContain("Dr. Antigo");
    expect(r.fatos).toBeUndefined();
  });

  it("especialidade igual à do Cadastro, sem acento e caixa; a que não existe volta com a lista e sem ecoar o pedido", () => {
    expect(nomes(profissionais({ especialidade: "ESTETICA" }))).toEqual([
      "Dra. Ana Lima",
    ]);
    const r = profissionais({ especialidade: "dor nas costas" });
    expect(json(r)).toEqual({
      resultado: "especialidade_nao_encontrada",
      especialidades_cadastradas: [
        "Cardiologia",
        "Dermatologia",
        "Estética",
        "Ginecologia",
      ],
    });
    expect(r.passo).not.toContain("costas");
  });

  it("procedimento: quem tem vínculo ativo nele, do índice ou só com a equipe", () => {
    expect(nomes(profissionais({ procedimento: "p2" }))).toEqual([
      "Dr. Bruno Costa",
    ]);
    const botox = profissionais({ procedimento: "P4" });
    expect(json(botox).profissionais).toEqual([
      expect.objectContaining({ nome: "Dra. Ana Lima", marca_pela_ia: false }),
    ]);
    expect(nomes(profissionais({ procedimento: "p5" }))).toEqual([
      "Dr. Bruno Costa",
    ]);
    expect(profissionais({ procedimento: "p9" }).resultado).toBe(
      "procedimento_nao_encontrado",
    );
  });

  it("convênio sem procedimento: o convênio do profissional; com o procedimento, o vínculo dele no convênio", () => {
    const unimed = profissionais({ convenio: "Unimed Nacional" });
    expect(nomes(unimed)).toEqual(["Dra. Ana Lima", "Dra. Carla Dias"]);
    expect(json(unimed).convenio).toBe("Unimed (Nacional)");
    expect(unimed.fatos).toEqual({
      coberturas: [{ nome: "Unimed", plano: "Nacional", estado: "atende" }],
    });
    // A Dra. Carla atende Unimed, mas nao faz a Consulta por ele.
    expect(
      nomes(profissionais({ convenio: "Unimed Nacional", procedimento: "p1" })),
    ).toEqual(["Dra. Ana Lima"]);
    expect(nomes(profissionais({ convenio: "Amil" }))).toEqual([
      "Dr. Bruno Costa",
    ]);
    // Particular: quem tem vinculo particular.
    expect(
      nomes(profissionais({ convenio: "particular", procedimento: "p1" })),
    ).toEqual(["Dr. Bruno Costa", "Dra. Ana Lima"]);
  });

  it("dúvida sobre o convênio volta como opções, sem lista de profissionais", () => {
    const r = profissionais({ convenio: "Unimed" });
    expect(r.resultado).toBe("convenio_nao_confirmado");
    expect(r.saida).not.toContain("Dra. Ana");
    expect(r.fatos).toBeUndefined();
    expect(profissionais({ convenio: "Bradesco" }).resultado).toBe(
      "plano_nao_informado",
    );
    const nada = profissionais({ convenio: "Plano X 85 99999-8888" });
    expect(nada.resultado).toBe("convenio_nao_encontrado");
    expect(nada.passo).not.toContain("99999");
  });

  it("unidade: quem tem jornada nela (a jornada sem unidade vale para todas)", () => {
    expect(nomes(profissionais({ unidade: "u2" }))).toEqual([
      "Dr. Bruno Costa",
      "Dra. Carla Dias",
    ]);
    expect(nomes(profissionais({ unidade: "u1" }))).toEqual([
      "Dr. Bruno Costa",
      "Dra. Ana Lima",
    ]);
    expect(profissionais({ unidade: "u7" }).resultado).toBe(
      "unidade_nao_encontrada",
    );
  });

  it("os filtros valem juntos; ninguém: 'nenhum_profissional', sem fato de convênio", () => {
    const r = profissionais({
      especialidade: "Ginecologia",
      procedimento: "p1",
    });
    expect(json(r)).toEqual({ resultado: "nenhum_profissional" });
    expect(r.passo).toBe(
      "Consultou os profissionais (Ginecologia, Consulta): nenhum no Cadastro",
    );
    const semNinguem = profissionais({
      convenio: "Unimed Nacional",
      unidade: "u2",
      especialidade: "Dermatologia",
    });
    expect(semNinguem.resultado).toBe("nenhum_profissional");
    expect(semNinguem.fatos).toBeUndefined();
  });

  it("com a agenda desligada, ninguém é marcado pela IA; com o convênio desligado, ele fica com a equipe", () => {
    const r = profissionais(
      {},
      { informarConvenio: true, agendaLigada: false },
    );
    expect(
      (json(r).profissionais as { marca_pela_ia: boolean }[]).every(
        (p) => !p.marca_pela_ia,
      ),
    ).toBe(true);
    expect(
      json(
        profissionais(
          { convenio: "Amil" },
          { informarConvenio: false, agendaLigada: true },
        ),
      ),
    ).toEqual({ resultado: "informar_convenio_desligado" });
  });

  it("marca pela IA segue o procedimento e o convênio do filtro", () => {
    // O Bruno marca pela IA na Consulta particular, nao no Exame particular
    // (o vinculo do Exame e so Amil).
    const exame = profissionais({ procedimento: "p2", convenio: "particular" });
    expect(exame.resultado).toBe("nenhum_profissional");
    const amil = profissionais({ procedimento: "p2", convenio: "Amil" });
    expect(json(amil).profissionais).toEqual([
      expect.objectContaining({ nome: "Dr. Bruno Costa", marca_pela_ia: true }),
    ]);
  });
});

describe("buscar_procedimento ampliada", () => {
  it("a duração, se exige avaliação, o resumo dos requisitos e as unidades, com o preço de sempre", () => {
    const r = buscarProcedimento(CATALOGO, {
      procedimento: "p1",
      convenio: null,
    });
    expect(json(r)).toEqual({
      resultado: "particular",
      procedimento: "Consulta",
      duracao_min: 30,
      exige_avaliacao: false,
      requisitos: ["Documento com foto", "Chegar 15 minutos antes"],
      unidades: ["Aldeota", "Centro"],
      atende_particular: true,
      particular: [
        {
          profissional: "Dr. Bruno Costa",
          situacao: "valor",
          valor: "R$ 280,00",
        },
        {
          profissional: "Dra. Ana Lima",
          situacao: "valor",
          valor: "R$ 300,00",
        },
      ],
      convenios_aceitos: ["Unimed (Nacional)"],
    });
    expect(r.precos.sort()).toEqual([28_000, 30_000]);
    // Com o convenio identificado, o resumo traz os requisitos dele.
    expect(
      json(
        buscarProcedimento(CATALOGO, {
          procedimento: "p1",
          convenio: "Unimed Nacional",
        }),
      ).requisitos,
    ).toEqual([
      "Documento com foto",
      "Chegar 15 minutos antes",
      "Autorização prévia do convênio",
      "Carteirinha do convênio",
    ]);
  });

  it("duração diferente por profissional vem por profissional", () => {
    const catalogo = catalogoDoCadastro({
      vinculos: [
        ...linhasDoCadastro().vinculos,
        {
          id: "5a000000-0000-4000-8000-000000000099",
          procedure_id: PROC.limpeza,
          professional_id: PROF.bruno,
          insurance_id: null,
          price_cents: 15_000,
          covered_by_insurance: false,
          bookable_by_ai: true,
          active: true,
          duration_min: 45,
        },
      ],
    });
    expect(
      json(buscarProcedimento(catalogo, { procedimento: "p3", convenio: null }))
        .duracao_min_por_profissional,
    ).toEqual([
      { profissional: "Dr. Bruno Costa", duracao_min: 45 },
      { profissional: "Dra. Ana Lima", duracao_min: 60 },
    ]);
  });

  it("o procedimento só com a equipe que deixa informar: o valor pelas mesmas regras, com a marcação da equipe", () => {
    const r = buscarProcedimento(CATALOGO, {
      procedimento: "p4",
      convenio: null,
    });
    expect(json(r)).toEqual({
      resultado: "particular",
      procedimento: "Botox",
      marcacao: "so_com_a_equipe",
      duracao_min: 60,
      exige_avaliacao: true,
      requisitos: ["Idade mínima: 18 anos", "Avaliação antes do procedimento"],
      unidades: ["Aldeota"],
      atende_particular: true,
      particular: [
        {
          profissional: "Dra. Ana Lima",
          situacao: "valor",
          valor: "R$ 1.200,00",
        },
      ],
      convenios_aceitos: ["Unimed (Nacional)"],
    });
    expect(r.precos).toEqual([120_000]);
    expect(r.passo).toBe(
      "Consultou o preço de Botox (marcação só com a equipe)",
    );
    const coberto = buscarProcedimento(CATALOGO, {
      procedimento: "p4",
      convenio: "Unimed Nacional",
    });
    expect(json(coberto)).toMatchObject({
      resultado: "convenio",
      marcacao: "so_com_a_equipe",
      atendimentos: [{ profissional: "Dra. Ana Lima", situacao: "coberto" }],
    });
    expect(coberto.fatos).toEqual({
      coberturas: [{ nome: "Unimed", plano: "Nacional", estado: "coberto" }],
    });
    // A duvida do convenio segue a regra de sempre, sem valor.
    const plano = buscarProcedimento(CATALOGO, {
      procedimento: "p4",
      convenio: "Bradesco",
    });
    expect(plano.resultado).toBe("plano_nao_informado");
    expect(plano.precos).toEqual([]);
  });

  it("o que não deixa informar: só que a equipe cuida, sem valor, requisito nem unidade", () => {
    const r = buscarProcedimento(CATALOGO, {
      procedimento: "p5",
      convenio: null,
    });
    expect(json(r)).toEqual({
      resultado: "so_com_a_equipe",
      procedimento: "Implante",
    });
    expect(r.precos).toEqual([]);
    expect(r.fatos).toBeUndefined();
    expect(r.passo).toBe(
      "Consultou Implante: só a equipe informa e marca este procedimento",
    );
    // Deixando informar, mas sem vinculo ativo: o mesmo.
    const semVinculo = catalogoDoCadastro({ vinculosDaEquipe: [] });
    expect(
      buscarProcedimento(semVinculo, { procedimento: "p4", convenio: null })
        .resultado,
    ).toBe("so_com_a_equipe");
  });

  it("catálogo montado à mão (sem o Cadastro da AG2): a saída de antes, sem chave nova", () => {
    const antigo = catalogoDaAgenda();
    const r = buscarProcedimento(antigo, {
      procedimento: "p1",
      convenio: null,
    });
    expect(Object.keys(json(r)).sort()).toEqual(
      [
        "resultado",
        "procedimento",
        "duracao_min",
        "atende_particular",
        "particular",
        "convenios_aceitos",
      ].sort(),
    );
  });
});

describe("tetos de saída (a reserva do gasto)", () => {
  it("nenhuma saída das consultas passa do teto", () => {
    const teto = limiteDasConsultasDoCadastro(CATALOGO);
    const saidas = [
      unidades(),
      profissionais(),
      profissionais({ especialidade: "x" }),
      profissionais({ convenio: "Unimed" }),
      ...["p1", "p2", "p3", "p4", "p5"].flatMap((p) => [
        requisitos(p),
        requisitos(p, "Unimed Nacional"),
        requisitos(p, "Unimed"),
        requisitos(p, "Bradesco"),
      ]),
    ];
    for (const r of saidas) {
      expect(
        Buffer.byteLength(r.saida, "utf8"),
        r.resultado,
      ).toBeLessThanOrEqual(teto);
    }
  });

  it("nenhuma saída de buscar_procedimento passa do teto dela", () => {
    const teto = limiteDaSaidaDaBusca(CATALOGO);
    for (const procedimento of ["p1", "p2", "p3", "p4", "p5"]) {
      for (const convenio of [null, "Unimed Nacional", "Unimed", "Bradesco"]) {
        const r = buscarProcedimento(CATALOGO, { procedimento, convenio });
        expect(Buffer.byteLength(r.saida, "utf8")).toBeLessThanOrEqual(teto);
      }
    }
  });

  it("executarConsultaDoCadastro despacha pelo nome", () => {
    expect(
      executarConsultaDoCadastro(
        "consultar_unidades",
        CATALOGO,
        { unidade: null },
        TUDO_LIGADO,
      ).resultado,
    ).toBe("unidades");
    expect(
      executarConsultaDoCadastro(
        "consultar_requisitos",
        CATALOGO,
        { procedimento: "p1", convenio: null },
        TUDO_LIGADO,
      ).resultado,
    ).toBe("requisitos");
    expect(
      executarConsultaDoCadastro(
        "buscar_profissionais",
        CATALOGO,
        {
          especialidade: null,
          procedimento: null,
          convenio: null,
          unidade: null,
        },
        TUDO_LIGADO,
      ).resultado,
    ).toBe("profissionais");
  });
});
