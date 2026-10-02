import { ClipboardList, History, Tag, UserRound } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  AJUDA_DA_PRECEDENCIA,
  chaveDeEspecialidade,
  especialidadesDosProfissionais,
  itensDoVinculo,
  nomeDaReguaVinculada,
  opcoesLivres,
  ordenarReguasVinculadas,
  resolverEspecialidade,
  rotuloDeEspecialidade,
  rotuloDoVinculo,
  situacaoDoTipo,
  textoDaEtiqueta,
  vinculoDaLinha,
  type OpcoesDeVinculo,
  type ReguaComVinculo,
  type VinculoDaRegua,
} from "@/components/automacoes/vinculo-da-regua";

// Reguas vinculadas de confirmacao e pos-falta (decisao do dono em
// 29/09/2026): a logica PURA da Tela 7. A chave da especialidade espelha
// public.chave_de_especialidade; a lista de especialidades sai dos
// profissionais ativos, sem repetir a chave e com o rotulo mais comum; o
// rotulo do vinculo no cabecalho; e o que o dialogo ainda oferece.

const HELENA = "0a0a0a0a-0000-4000-8000-00000000000a";
const JOAO = "0b0b0b0b-0000-4000-8000-00000000000b";
const COLONO = "0c0c0c0c-0000-4000-8000-00000000000c";
const BOTOX = "0d0d0d0d-0000-4000-8000-00000000000d";

describe("chaveDeEspecialidade", () => {
  it("ignora maiúsculas, acento e espaço sobrando", () => {
    const chave = chaveDeEspecialidade("Dermatologia");
    expect(chave).toBe("dermatologia");
    expect(chaveDeEspecialidade("  dermatologia  ")).toBe(chave);
    expect(chaveDeEspecialidade("DERMATOLOGÍA")).toBe(chave);
    expect(chaveDeEspecialidade("Dermatologia\t")).toBe(chave);
  });

  it("colapsa os espaços do meio", () => {
    expect(chaveDeEspecialidade("Cirurgia   Plástica")).toBe(
      "cirurgia plastica",
    );
    expect(chaveDeEspecialidade("Ginecologia e\nObstetrícia")).toBe(
      "ginecologia e obstetricia",
    );
  });

  it("usa a mesma tabela de acentos do banco", () => {
    expect(chaveDeEspecialidade("ÁÀÂÃÄÅ ÉÈÊË ÍÌÎÏ ÓÒÔÕÖ ÚÙÛÜ Ç Ñ Ý")).toBe(
      "aaaaaa eeee iiii ooooo uuuu c n y",
    );
    expect(chaveDeEspecialidade("ação, pão, ýÿ")).toBe("acao, pao, yy");
  });

  it("texto só de espaço vira chave vazia", () => {
    expect(chaveDeEspecialidade("   ")).toBe("");
    expect(chaveDeEspecialidade("")).toBe("");
  });
});

describe("rotuloDeEspecialidade", () => {
  it("mantém a grafia e só tira espaço sobrando", () => {
    expect(rotuloDeEspecialidade("  Cirurgia   Plástica ")).toBe(
      "Cirurgia Plástica",
    );
  });
});

describe("especialidadesDosProfissionais", () => {
  it("une as especialidades dos ativos, sem repetir a chave, em ordem", () => {
    expect(
      especialidadesDosProfissionais([
        { active: true, specialties: ["Endocrinologia", "Nutrologia"] },
        { active: true, specialties: ["Dermatologia", " endocrinologia "] },
        { active: true, specialties: ["Endocrinologia"] },
      ]),
    ).toEqual([
      { chave: "dermatologia", rotulo: "Dermatologia" },
      { chave: "endocrinologia", rotulo: "Endocrinologia" },
      { chave: "nutrologia", rotulo: "Nutrologia" },
    ]);
  });

  it("ignora profissional inativo", () => {
    expect(
      especialidadesDosProfissionais([
        { active: false, specialties: ["Cardiologia"] },
        { active: true, specialties: ["Pediatria"] },
      ]),
    ).toEqual([{ chave: "pediatria", rotulo: "Pediatria" }]);
  });

  it("mostra o rótulo mais comum entre as grafias da mesma chave", () => {
    expect(
      especialidadesDosProfissionais([
        { active: true, specialties: ["cirurgia plastica"] },
        { active: true, specialties: ["cirurgia plastica"] },
        { active: true, specialties: ["Cirurgia Plástica"] },
      ]),
    ).toEqual([{ chave: "cirurgia plastica", rotulo: "cirurgia plastica" }]);
  });

  it("a mesma grafia repetida na ficha de um profissional conta uma vez", () => {
    expect(
      especialidadesDosProfissionais([
        {
          active: true,
          specialties: ["dermato", "dermato", "dermato"],
        },
        { active: true, specialties: ["Dermato"] },
        { active: true, specialties: ["Dermato"] },
      ]),
    ).toEqual([{ chave: "dermato", rotulo: "Dermato" }]);
  });

  it("no empate, maiúscula e acento vencem, sem depender da ordem", () => {
    const grafias = ["pediatria", "Pediatria", "Pedíatria"];
    const esperado = [{ chave: "pediatria", rotulo: "Pedíatria" }];
    expect(
      especialidadesDosProfissionais(
        grafias.map((grafia) => ({ active: true, specialties: [grafia] })),
      ),
    ).toEqual(esperado);
    expect(
      especialidadesDosProfissionais(
        [...grafias]
          .reverse()
          .map((grafia) => ({ active: true, specialties: [grafia] })),
      ),
    ).toEqual(esperado);
    expect(
      especialidadesDosProfissionais([
        { active: true, specialties: ["cardiologia"] },
        { active: true, specialties: ["Cardiologia"] },
      ]),
    ).toEqual([{ chave: "cardiologia", rotulo: "Cardiologia" }]);
  });

  it("ignora especialidade em branco e ficha sem lista", () => {
    expect(
      especialidadesDosProfissionais([
        { active: true, specialties: ["  ", ""] },
        { active: true, specialties: null },
      ]),
    ).toEqual([]);
  });
});

describe("resolverEspecialidade", () => {
  const opcoes = [
    { chave: "dermatologia", rotulo: "Dermatologia" },
    { chave: "cirurgia plastica", rotulo: "Cirurgia Plástica" },
  ];

  it("casa pela chave e devolve o rótulo da lista", () => {
    expect(resolverEspecialidade(" cirurgia  PLASTICA ", opcoes)).toEqual({
      chave: "cirurgia plastica",
      rotulo: "Cirurgia Plástica",
    });
  });

  it("recusa especialidade que nenhum profissional ativo tem", () => {
    expect(resolverEspecialidade("Cardiologia", opcoes)).toBeNull();
    expect(resolverEspecialidade("   ", opcoes)).toBeNull();
  });
});

describe("nomeDaReguaVinculada", () => {
  it("prefixa pelo tipo da régua", () => {
    expect(nomeDaReguaVinculada("confirmacao", "Dra. Helena")).toBe(
      "Confirmação: Dra. Helena",
    );
    expect(nomeDaReguaVinculada("pos_falta", " Dermatologia ")).toBe(
      "Pós-falta: Dermatologia",
    );
  });
});

describe("vinculoDaLinha", () => {
  it("lê o procedimento do embed, objeto ou lista", () => {
    expect(
      vinculoDaLinha({
        procedure: { id: COLONO, name: "Colonoscopia" },
        professional: null,
        specialty: null,
      }),
    ).toEqual({ tipo: "procedimento", id: COLONO, nome: "Colonoscopia" });
    expect(
      vinculoDaLinha({
        procedure: [{ id: COLONO, name: "Colonoscopia" }],
      }),
    ).toEqual({ tipo: "procedimento", id: COLONO, nome: "Colonoscopia" });
  });

  it("lê o médico e a especialidade", () => {
    expect(
      vinculoDaLinha({
        procedure: null,
        professional: { id: HELENA, name: "Dra. Helena" },
        specialty: null,
      }),
    ).toEqual({ tipo: "medico", id: HELENA, nome: "Dra. Helena" });
    expect(
      vinculoDaLinha({
        procedure: null,
        professional: null,
        specialty: " Cirurgia  Plástica",
      }),
    ).toEqual({
      tipo: "especialidade",
      chave: "cirurgia plastica",
      nome: "Cirurgia Plástica",
    });
  });

  it("sem vínculo é null (geral ou só reforçada)", () => {
    expect(
      vinculoDaLinha({ procedure: null, professional: null, specialty: null }),
    ).toBeNull();
    expect(vinculoDaLinha({ specialty: "  " })).toBeNull();
    expect(vinculoDaLinha({ procedure: [] })).toBeNull();
  });
});

describe("rotuloDoVinculo", () => {
  it("cada vínculo tem ícone e rótulo próprios", () => {
    expect(
      rotuloDoVinculo({
        vinculo: { tipo: "medico", id: HELENA, nome: "Dra. Helena" },
        for_no_show_history: false,
      }),
    ).toEqual({ tipo: "Médico", icone: UserRound, nome: "Dra. Helena" });
    expect(
      rotuloDoVinculo({
        vinculo: {
          tipo: "especialidade",
          chave: "dermatologia",
          nome: "Dermatologia",
        },
        for_no_show_history: false,
      }),
    ).toEqual({ tipo: "Especialidade", icone: Tag, nome: "Dermatologia" });
    expect(
      rotuloDoVinculo({
        vinculo: { tipo: "procedimento", id: COLONO, nome: "Colonoscopia" },
        for_no_show_history: true,
      }),
    ).toEqual({
      tipo: "Procedimento",
      icone: ClipboardList,
      nome: "Colonoscopia",
    });
  });

  it("a reforçada sem vínculo aparece como histórico de falta", () => {
    expect(
      rotuloDoVinculo({ vinculo: null, for_no_show_history: true }),
    ).toEqual({ tipo: "Histórico de falta", icone: History, nome: null });
  });

  it("os quatro ícones são diferentes", () => {
    const icones = new Set([UserRound, Tag, ClipboardList, History]);
    expect(icones.size).toBe(4);
  });

  it("a geral não tem vínculo para mostrar", () => {
    expect(
      rotuloDoVinculo({ vinculo: null, for_no_show_history: false }),
    ).toBeNull();
  });
});

describe("opcoesLivres", () => {
  const opcoes: OpcoesDeVinculo = {
    medicos: [
      { id: HELENA, nome: "Dra. Helena" },
      { id: JOAO, nome: "Dr. João" },
    ],
    especialidades: [
      { chave: "dermatologia", rotulo: "Dermatologia" },
      { chave: "endocrinologia", rotulo: "Endocrinologia" },
    ],
    procedimentos: [
      { id: COLONO, nome: "Colonoscopia" },
      { id: BOTOX, nome: "Toxina botulínica" },
    ],
  };

  const regua = (
    kind: ReguaComVinculo["kind"],
    vinculo: VinculoDaRegua | null,
    reforcada = false,
  ): ReguaComVinculo => ({ kind, vinculo, for_no_show_history: reforcada });

  it("sem régua vinculada, tudo está livre", () => {
    expect(opcoesLivres("confirmacao", [], opcoes)).toEqual({
      ...opcoes,
      temReforcada: false,
    });
  });

  it("tira o que já tem régua do MESMO tipo", () => {
    const reguas = [
      regua("confirmacao", { tipo: "medico", id: HELENA, nome: "Dra. Helena" }),
      regua("confirmacao", {
        tipo: "especialidade",
        chave: "dermatologia",
        nome: "dermatologia",
      }),
      regua("confirmacao", {
        tipo: "procedimento",
        id: COLONO,
        nome: "Colonoscopia",
      }),
      regua("pos_falta", { tipo: "medico", id: JOAO, nome: "Dr. João" }),
    ];
    const livres = opcoesLivres("confirmacao", reguas, opcoes);
    expect(livres.medicos).toEqual([{ id: JOAO, nome: "Dr. João" }]);
    expect(livres.especialidades).toEqual([
      { chave: "endocrinologia", rotulo: "Endocrinologia" },
    ]);
    expect(livres.procedimentos).toEqual([
      { id: BOTOX, nome: "Toxina botulínica" },
    ]);

    // Na pos-falta so o Dr. Joao ja tem regua.
    const livresDaPosFalta = opcoesLivres("pos_falta", reguas, opcoes);
    expect(livresDaPosFalta.medicos).toEqual([
      { id: HELENA, nome: "Dra. Helena" },
    ]);
    expect(livresDaPosFalta.especialidades).toEqual(opcoes.especialidades);
    expect(livresDaPosFalta.procedimentos).toEqual(opcoes.procedimentos);
  });

  it("a reforçada marca que já existe só no próprio tipo", () => {
    const reguas = [regua("confirmacao", null, true)];
    expect(opcoesLivres("confirmacao", reguas, opcoes).temReforcada).toBe(true);
    expect(opcoesLivres("pos_falta", reguas, opcoes).temReforcada).toBe(false);
  });

  it("vinculada reforçada não ocupa o lugar da vinculada comum", () => {
    const reguas = [
      regua(
        "confirmacao",
        { tipo: "medico", id: HELENA, nome: "Dra. Helena" },
        true,
      ),
    ];
    const livres = opcoesLivres("confirmacao", reguas, opcoes);
    expect(livres.medicos).toEqual(opcoes.medicos);
    expect(livres.temReforcada).toBe(false);
  });
});

describe("itensDoVinculo", () => {
  it("médico e procedimento pelo id; especialidade pela chave", () => {
    const opcoes: OpcoesDeVinculo = {
      medicos: [{ id: HELENA, nome: "Dra. Helena" }],
      especialidades: [{ chave: "dermatologia", rotulo: "Dermatologia" }],
      procedimentos: [{ id: COLONO, nome: "Colonoscopia" }],
    };
    expect(itensDoVinculo("medico", opcoes)).toEqual([
      { valor: HELENA, rotulo: "Dra. Helena" },
    ]);
    expect(itensDoVinculo("especialidade", opcoes)).toEqual([
      { valor: "dermatologia", rotulo: "Dermatologia" },
    ]);
    expect(itensDoVinculo("procedimento", opcoes)).toEqual([
      { valor: COLONO, rotulo: "Colonoscopia" },
    ]);
  });
});

describe("ordenarReguasVinculadas", () => {
  it("segue a precedência do banco: procedimento, médico, especialidade", () => {
    const reguas = [
      {
        name: "Confirmação reforçada",
        vinculo: null,
        for_no_show_history: true,
      },
      {
        name: "Confirmação: Dermatologia",
        vinculo: {
          tipo: "especialidade",
          chave: "dermatologia",
          nome: "Dermatologia",
        } as VinculoDaRegua,
        for_no_show_history: false,
      },
      {
        name: "Confirmação: Dra. Helena",
        vinculo: {
          tipo: "medico",
          id: HELENA,
          nome: "Dra. Helena",
        } as VinculoDaRegua,
        for_no_show_history: false,
      },
      {
        name: "Confirmação: Colonoscopia",
        vinculo: {
          tipo: "procedimento",
          id: COLONO,
          nome: "Colonoscopia",
        } as VinculoDaRegua,
        for_no_show_history: false,
      },
      {
        name: "Confirmação: Anestesiologia",
        vinculo: {
          tipo: "especialidade",
          chave: "anestesiologia",
          nome: "Anestesiologia",
        } as VinculoDaRegua,
        for_no_show_history: false,
      },
    ];
    expect(ordenarReguasVinculadas(reguas).map((r) => r.name)).toEqual([
      "Confirmação: Colonoscopia",
      "Confirmação: Dra. Helena",
      "Confirmação: Anestesiologia",
      "Confirmação: Dermatologia",
      "Confirmação reforçada",
    ]);
  });

  it("no mesmo nível, a reforçada vem primeiro", () => {
    const medico = {
      tipo: "medico",
      id: HELENA,
      nome: "Dra. Helena",
    } as VinculoDaRegua;
    const reguas = [
      { name: "A comum", vinculo: medico, for_no_show_history: false },
      { name: "B reforçada", vinculo: medico, for_no_show_history: true },
    ];
    expect(ordenarReguasVinculadas(reguas).map((r) => r.name)).toEqual([
      "B reforçada",
      "A comum",
    ]);
  });
});

describe("texto de ajuda", () => {
  it("diz a ordem de precedência em linguagem de recepção", () => {
    expect(AJUDA_DA_PRECEDENCIA).toBe(
      "A régua mais específica vence: procedimento, depois médico, depois especialidade. Sem vínculo, vale a geral.",
    );
  });
});

describe("textoDaEtiqueta", () => {
  it("mostra o tipo e o nome ATUAL do cadastro, sem travessão", () => {
    // O nome da régua ficou "Confirmação: Dra. Helena" na criação; Cadastros
    // renomeou a profissional, e a etiqueta acompanha a leitura de agora.
    const rotulo = rotuloDoVinculo({
      vinculo: { tipo: "medico", id: HELENA, nome: "Dra. Helena Souza" },
      for_no_show_history: false,
    });
    expect(textoDaEtiqueta(rotulo!)).toBe("Médico: Dra. Helena Souza");
    expect(textoDaEtiqueta(rotulo!)).not.toMatch(/[\u2013\u2014]/);
    expect(
      textoDaEtiqueta(
        rotuloDoVinculo({
          vinculo: {
            tipo: "especialidade",
            chave: "dermatologia",
            nome: "Dermatologia",
          },
          for_no_show_history: false,
        })!,
      ),
    ).toBe("Especialidade: Dermatologia");
  });

  it("sem nome, só o tipo (reforçada sem vínculo ou embed vazio)", () => {
    const reforcada = rotuloDoVinculo({
      vinculo: null,
      for_no_show_history: true,
    });
    expect(textoDaEtiqueta(reforcada!)).toBe("Histórico de falta");
    const semNome = rotuloDoVinculo({
      vinculo: { tipo: "procedimento", id: COLONO, nome: "   " },
      for_no_show_history: false,
    });
    expect(textoDaEtiqueta(semNome!)).toBe("Procedimento");
  });
});

describe("situacaoDoTipo (cartão da aba)", () => {
  const ligada = { active: true };
  const desligada = { active: false };

  it("geral ligada: ligada, com ou sem vinculadas", () => {
    expect(situacaoDoTipo(ligada, [])).toEqual({ estado: "ligada" });
    expect(situacaoDoTipo(ligada, [desligada, ligada])).toEqual({
      estado: "ligada",
    });
  });

  it("geral desligada e alguma vinculada ligada: ligada nas vinculadas, N de M", () => {
    expect(situacaoDoTipo(desligada, [ligada, desligada, desligada])).toEqual({
      estado: "ligada_nas_vinculadas",
      ligadas: 1,
      total: 3,
    });
    expect(situacaoDoTipo(desligada, [ligada, ligada])).toEqual({
      estado: "ligada_nas_vinculadas",
      ligadas: 2,
      total: 2,
    });
  });

  it("tudo desligado: desligada; sem a geral e sem vinculada ligada: não configurada", () => {
    expect(situacaoDoTipo(desligada, [])).toEqual({ estado: "desligada" });
    expect(situacaoDoTipo(desligada, [desligada])).toEqual({
      estado: "desligada",
    });
    expect(situacaoDoTipo(null, [])).toEqual({ estado: "nao_configurada" });
    expect(situacaoDoTipo(null, [desligada])).toEqual({
      estado: "nao_configurada",
    });
  });

  it("sem a geral, vinculada ligada ainda conta como ligada nas vinculadas", () => {
    expect(situacaoDoTipo(null, [ligada])).toEqual({
      estado: "ligada_nas_vinculadas",
      ligadas: 1,
      total: 1,
    });
  });
});
