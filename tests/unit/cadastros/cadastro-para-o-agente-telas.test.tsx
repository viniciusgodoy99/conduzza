import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Telas do cadastro para o agente (AG1, migration 20261027100000): a aba
// Unidades (endereco estruturado, horario de funcionamento e textos ao
// paciente), "O que o paciente precisa" e a chave "A IA pode informar" no
// modal do Procedimento, a idade e a grade no modal do Profissional, e o
// cartao "Prontidao do cadastro" da Tela 6. Renderizacao estatica: o Dialog
// do Radix vira marcacao sempre aberta (o modal aparece no estado de
// cadastro novo) e a dica de permissao vira um atributo conferivel (o
// Tooltip pede provedor). Interacao fica nos e2e; a gravacao, em
// cadastro-para-o-agente-actions.test.ts.

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => (
    <div data-parte="dialog">{children}</div>
  ),
  DialogContent: ({ children }: ComponentProps<"div">) => (
    <div data-parte="conteudo">{children}</div>
  ),
  DialogHeader: ({ children }: ComponentProps<"div">) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: ComponentProps<"div">) => (
    <div data-parte="rodape">{children}</div>
  ),
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
vi.mock("@/app/(app)/cadastros/actions", () => ({
  salvarUnidadeAction: vi.fn(),
  salvarProcedimentoAction: vi.fn(),
  salvarRequisitosDoProcedimentoAction: vi.fn(),
  sincronizarVinculosDoProcedimentoAction: vi.fn(),
  salvarProfissionalAction: vi.fn(),
  salvarJornadaAction: vi.fn(),
}));

const {
  UnidadesTab,
  TEXTOS_DA_UNIDADE,
  formDaUnidade,
  problemaDoFormDaUnidade,
  entradaDaUnidade,
  resumoDoHorario,
} = await import("@/components/cadastros/unidades-tab");
const { ProcedimentosTab, ROTULO_IA_PODE_INFORMAR, AJUDA_IA_PODE_INFORMAR } =
  await import("@/components/cadastros/procedimentos-tab");
const { ProfissionaisTab, TEXTOS_DA_IDADE_E_GRADE, idadeEGradeDoForm } =
  await import("@/components/cadastros/profissionais-tab");
const {
  RequisitosDoProcedimento,
  RequisitosSomenteLeitura,
  TEXTOS_DOS_REQUISITOS,
  requisitosParaSalvar,
} = await import("@/components/cadastros/requisitos-do-procedimento");
const { EditorDoHorarioDeFuncionamento, TEXTOS_DO_HORARIO } =
  await import("@/components/cadastros/horario-de-funcionamento");
const { CartaoDaProntidao, TEXTOS_DA_PRONTIDAO } =
  await import("@/components/agente/cartao-da-prontidao");
const { horarioParaEdicao } =
  await import("@/lib/domain/cadastro-para-o-agente");

import type { ProntidaoDoCadastro } from "@/lib/domain/cadastro-para-o-agente";
import {
  CADASTRO_VAZIO_PARA_O_AGENTE,
  type CadastroParaOAgente,
} from "@/lib/queries/cadastro-para-o-agente";
import type { Catalogo, Convenio, Unidade } from "@/lib/queries/catalogo";

const TRAVESSAO = String.fromCharCode(0x2014);
const DICA = "Somente administradores e gestores alteram os cadastros";

function catalogo(parcial: Partial<Catalogo> = {}): Catalogo {
  return {
    profissionais: [],
    jornadas: [],
    recursos: [],
    procedimentos: [],
    convenios: [],
    vinculos: [],
    pacotes: [],
    unidades: [],
    ...parcial,
  };
}

const SEDE: Unidade = {
  id: "unidade-sede",
  name: "Sede",
  address: "Rua das Flores, 123, Centro, Fortaleza/CE",
  phone: null,
  active: true,
};

const CADASTRO_DA_SEDE: CadastroParaOAgente = {
  ...CADASTRO_VAZIO_PARA_O_AGENTE,
  unidades: [
    {
      unit_id: "unidade-sede",
      logradouro: "Rua das Flores",
      numero: "123",
      complemento: null,
      bairro: "Centro",
      cidade: "Fortaleza",
      uf: "CE",
      cep: "60000000",
      referencia: "Em frente à praça.",
      estacionamento: null,
      acessibilidade: null,
      link_do_mapa: null,
      horario_de_funcionamento: {
        "1": [{ inicio: "08:00", fim: "12:00" }],
        "2": [{ inicio: "08:00", fim: "12:00" }],
      },
      observacao_ao_paciente: null,
    },
  ],
};

function props(parcial: Record<string, unknown> = {}) {
  return {
    catalogo: catalogo(),
    matriz: { atendimentos: [], coberturas: [] },
    cadastroDoAgente: CADASTRO_VAZIO_PARA_O_AGENTE,
    podeEditar: true,
    dica: DICA,
    aoMudar: () => undefined,
    timezone: "America/Fortaleza",
    ...parcial,
  };
}

function semTravessao(html: string) {
  expect(html).not.toContain(TRAVESSAO);
}

describe("aba Unidades", () => {
  it("vazio: o texto novo e a acao, e o modal com os campos estruturados", () => {
    const html = renderToStaticMarkup(<UnidadesTab {...props()} />);
    expect(html).toContain(TEXTOS_DA_UNIDADE.vazioTitulo);
    expect(html).toContain(TEXTOS_DA_UNIDADE.vazioDescricao);
    for (const rotulo of [
      "Rua ou avenida",
      "Número",
      "Complemento",
      "Bairro",
      "Cidade",
      "UF",
      "CEP",
      TEXTOS_DA_UNIDADE.referencia,
      TEXTOS_DA_UNIDADE.linkDoMapa,
      TEXTOS_DA_UNIDADE.estacionamento,
      TEXTOS_DA_UNIDADE.acessibilidade,
      TEXTOS_DA_UNIDADE.observacao,
      TEXTOS_DO_HORARIO.legenda,
    ]) {
      expect(html, rotulo).toContain(rotulo);
    }
    expect(html).toContain(TEXTOS_DA_UNIDADE.cepAjuda);
    expect(html).toContain(TEXTOS_DA_UNIDADE.textosAoPaciente);
    // Os campos tem 40px (h-10) e o modal largo (o horario tem tabela).
    expect(html).toContain('id="unidade-logradouro"');
    expect(html).toMatch(
      /id="unidade-cep"[^>]*maxLength="9"|maxLength="9"[^>]*id="unidade-cep"/,
    );
    semTravessao(html);
  });

  it("com unidade: o endereco composto, o horario em dias e Ver detalhes para quem so ve", () => {
    const html = renderToStaticMarkup(
      <UnidadesTab
        {...props({
          catalogo: catalogo({ unidades: [SEDE] }),
          cadastroDoAgente: CADASTRO_DA_SEDE,
          podeEditar: false,
        })}
      />,
    );
    expect(html).toContain("Rua das Flores, 123, Centro, Fortaleza/CE");
    expect(html).toContain("2 dias por semana");
    expect(html).toContain("Ver detalhes de Sede");
    // Acao sem permissao: visivel e desabilitada, com a dica.
    expect(html).toContain(`data-dica="${DICA}"`);
    semTravessao(html);
  });

  it("o formulario: CEP com mascara, o endereco antigo so sem os campos", () => {
    const form = formDaUnidade(SEDE, CADASTRO_DA_SEDE.unidades[0] ?? null);
    expect(form.cep).toBe("60000-000");
    expect(form.enderecoAntigo).toBeNull();
    expect(form.horario["1"].aberto).toBe(true);
    const antiga = formDaUnidade({ ...SEDE, address: "Rua Velha, 1" }, null);
    expect(antiga.enderecoAntigo).toBe("Rua Velha, 1");
    expect(resumoDoHorario(null)).toBe(TEXTOS_DA_UNIDADE.semHorario);
  });

  it("o que impede salvar, antes do banco, e o que vai para a action", () => {
    const form = formDaUnidade(SEDE, CADASTRO_DA_SEDE.unidades[0] ?? null);
    expect(problemaDoFormDaUnidade(form)).toBeNull();
    expect(problemaDoFormDaUnidade({ ...form, cep: "6000-000" })).toBe(
      "CEP: use 8 números, como 60000-000.",
    );
    expect(
      problemaDoFormDaUnidade({ ...form, link_do_mapa: "maps.google.com" }),
    ).toBe("Link do mapa: cole o endereço completo, começando com https://.");
    expect(
      problemaDoFormDaUnidade({ ...form, referencia: "Ligue 85 3333-4444" }),
    ).toMatch(/^Ponto de referência: Tire o telefone/);
    const virouODia = {
      ...form,
      horario: {
        ...form.horario,
        "1": {
          aberto: true,
          faixas: [{ chave: "x", inicio: "18:00", fim: "08:00" }],
        },
      },
    };
    expect(problemaDoFormDaUnidade(virouODia)).toBe(
      "Horário de funcionamento: Segunda-feira: o fim de cada faixa precisa ser depois do início.",
    );
    const entrada = entradaDaUnidade(form);
    expect(entrada.cep).toBe("60000000");
    expect(entrada.address).toBeNull();
    expect(entrada.horario_de_funcionamento).toEqual({
      "1": [{ inicio: "08:00", fim: "12:00" }],
      "2": [{ inicio: "08:00", fim: "12:00" }],
    });
  });
});

describe("editor do horario de funcionamento", () => {
  it("uma linha por dia, de domingo a sabado; o fechado diz Fechado", () => {
    let n = 0;
    const html = renderToStaticMarkup(
      <EditorDoHorarioDeFuncionamento
        idBase="h"
        valor={horarioParaEdicao(
          {
            "1": [
              { inicio: "08:00", fim: "12:00" },
              { inicio: "13:00", fim: "18:00" },
            ],
          },
          () => `k${(n += 1)}`,
        )}
        aoMudar={() => undefined}
        novaChave={() => "nova"}
      />,
    );
    expect(html.match(/<li /g)).toHaveLength(7);
    expect(html.indexOf("Domingo")).toBeLessThan(html.indexOf("Segunda-feira"));
    expect(html).toContain("Segunda-feira, faixa 2: fim");
    expect(html).toContain("Remover a faixa 1 de Segunda-feira");
    // Seis dias fechados: o texto a vista (aria-hidden) e o do leitor de
    // tela, ao lado da caixa de marcar.
    expect(html.match(/<p aria-hidden="true"[^>]*>Fechado</g)).toHaveLength(6);
    expect(html.match(/<span class="sr-only">Fechado</g)).toHaveLength(6);
    expect(html.match(/<span class="sr-only">Aberto</g)).toHaveLength(1);
    expect(html).toContain(TEXTOS_DO_HORARIO.adicionarFaixa);
    // Botao de remover com 40px (size-10).
    expect(html).toContain("size-10");
    semTravessao(html);
  });
});

describe("modal do Procedimento", () => {
  const UNIMED: Convenio = {
    id: "conv-unimed",
    name: "Unimed",
    plan_name: "Nacional",
    requires_card: true,
    notes: null,
    active: true,
  };

  it("a chave A IA pode informar e a secao O que o paciente precisa", () => {
    const html = renderToStaticMarkup(
      <ProcedimentosTab
        {...props({ catalogo: catalogo({ convenios: [UNIMED] }) })}
      />,
    );
    expect(html).toContain(ROTULO_IA_PODE_INFORMAR);
    expect(html).toContain(AJUDA_IA_PODE_INFORMAR);
    const quemFaz = html.indexOf("Quem faz e convênios</h3>");
    const requisitos = html.indexOf(`${TEXTOS_DOS_REQUISITOS.titulo}</h3>`);
    expect(requisitos).toBeGreaterThan(quemFaz);
    expect(html).toContain(TEXTOS_DOS_REQUISITOS.vazio);
    expect(html).toContain(TEXTOS_DOS_REQUISITOS.adicionar);
    semTravessao(html);
  });

  it("a lista de requisitos: o numero so no tipo que pede, o convenio e o texto", () => {
    const html = renderToStaticMarkup(
      <RequisitosDoProcedimento
        requisitos={[
          {
            chave: "a",
            tipo: "chegar_antes_minutos",
            insurance_id: null,
            valor: "15",
            texto: "",
            ativo: true,
          },
          {
            chave: "b",
            id: "r2",
            tipo: "autorizacao_previa",
            insurance_id: "conv-unimed",
            valor: "",
            texto: "Peça a autorização ao convênio antes.",
            ativo: false,
          },
        ]}
        aoMudar={() => undefined}
        convenios={[UNIMED]}
        novaChave={() => "c"}
      />,
    );
    expect(html.match(/Quantos minutos antes/g)).toHaveLength(1);
    expect(html).toContain("De 1 a 480 minutos.");
    expect(
      html.match(new RegExp(TEXTOS_DOS_REQUISITOS.paraQuem, "g")),
    ).toHaveLength(2);
    expect(html).toContain("Peça a autorização ao convênio antes.");
    expect(html).toContain("37/300");
    expect(html).toContain("Remover o item 2, Autorização prévia do convênio");
    semTravessao(html);
  });

  it("para quem so ve: a lista em texto, com a situacao em 3 camadas", () => {
    const html = renderToStaticMarkup(
      <RequisitosSomenteLeitura
        requisitos={[
          {
            id: "r1",
            procedure_id: "p",
            insurance_id: "conv-unimed",
            tipo: "carteirinha",
            valor_inteiro: null,
            texto_ao_paciente: "Traga a carteirinha.",
            ativo: true,
          },
          {
            id: "r2",
            procedure_id: "p",
            insurance_id: null,
            tipo: "idade_minima",
            valor_inteiro: 18,
            texto_ao_paciente: null,
            ativo: false,
          },
        ]}
        convenios={[UNIMED]}
      />,
    );
    expect(html).toContain("Carteirinha do convênio");
    expect(html).toContain("Unimed (Nacional)");
    expect(html).toContain("Idade mínima: 18 anos");
    expect(html).toContain(TEXTOS_DOS_REQUISITOS.todos);
    expect(html).toContain("Ativo");
    expect(html).toContain("Inativo");
    expect(
      renderToStaticMarkup(
        <RequisitosSomenteLeitura requisitos={[]} convenios={[]} />,
      ),
    ).toContain(TEXTOS_DOS_REQUISITOS.leituraVazia);
  });

  it("o que vai para a action: numero do tipo que pede, texto aparado", () => {
    expect(
      requisitosParaSalvar([
        {
          chave: "a",
          tipo: "chegar_antes_minutos",
          insurance_id: null,
          valor: " 15 ",
          texto: "  ",
          ativo: true,
        },
        {
          chave: "b",
          id: "r2",
          tipo: "pedido_medico",
          insurance_id: null,
          valor: "9",
          texto: " Traga. ",
          ativo: true,
        },
        {
          chave: "c",
          tipo: "idade_minima",
          insurance_id: null,
          valor: "1,5",
          texto: "",
          ativo: true,
        },
      ]),
    ).toEqual([
      {
        tipo: "chegar_antes_minutos",
        insurance_id: null,
        valor_inteiro: 15,
        texto_ao_paciente: null,
        ativo: true,
      },
      {
        id: "r2",
        tipo: "pedido_medico",
        insurance_id: null,
        valor_inteiro: null,
        texto_ao_paciente: "Traga.",
        ativo: true,
      },
      {
        tipo: "idade_minima",
        insurance_id: null,
        valor_inteiro: Number.NaN,
        texto_ao_paciente: null,
        ativo: true,
      },
    ]);
  });
});

describe("modal do Profissional", () => {
  it("a idade atendida e a grade de horarios", () => {
    const html = renderToStaticMarkup(<ProfissionaisTab {...props()} />);
    expect(html).toContain(TEXTOS_DA_IDADE_E_GRADE.idade);
    expect(html).toContain(TEXTOS_DA_IDADE_E_GRADE.idadeDe);
    expect(html).toContain(TEXTOS_DA_IDADE_E_GRADE.idadeAte);
    expect(html).toContain(TEXTOS_DA_IDADE_E_GRADE.grade);
    expect(html).toContain(TEXTOS_DA_IDADE_E_GRADE.gradeAjuda);
    expect(html).toContain('id="prof-idade-minima"');
    semTravessao(html);
  });

  it("a conferencia antes de gravar", () => {
    expect(
      idadeEGradeDoForm({
        idade_minima: "",
        idade_maxima: "",
        grade_minutos: "",
      }),
    ).toEqual({
      ok: true,
      campos: { idade_minima: null, idade_maxima: null, grade_minutos: null },
    });
    expect(
      idadeEGradeDoForm({
        idade_minima: "18",
        idade_maxima: "65",
        grade_minutos: "30",
      }),
    ).toEqual({
      ok: true,
      campos: { idade_minima: 18, idade_maxima: 65, grade_minutos: 30 },
    });
    expect(
      idadeEGradeDoForm({
        idade_minima: "30",
        idade_maxima: "20",
        grade_minutos: "",
      }),
    ).toEqual({
      ok: false,
      erro: "Idade atendida: a idade de início não pode passar da idade final.",
    });
    expect(
      idadeEGradeDoForm({
        idade_minima: "130",
        idade_maxima: "",
        grade_minutos: "",
      }),
    ).toEqual({
      ok: false,
      erro: "Idade atendida: use um número inteiro de 0 a 120 anos.",
    });
    expect(
      idadeEGradeDoForm({
        idade_minima: "",
        idade_maxima: "",
        grade_minutos: "25",
      }),
    ).toEqual({
      ok: false,
      erro: "Escolha a grade de horários da lista.",
    });
  });
});

describe("cartao Prontidao do cadastro (Tela 6)", () => {
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

  it("pronto: a frase e o selo Pronto, sem lista", () => {
    const html = renderToStaticMarkup(<CartaoDaProntidao prontidao={pronta} />);
    expect(html).toContain(TEXTOS_DA_PRONTIDAO.titulo);
    expect(html).toContain(TEXTOS_DA_PRONTIDAO.pronto);
    expect(html).toContain(">Pronto<");
    expect(html).not.toContain("<ul");
    semTravessao(html);
  });

  it("com pendencias: o selo com a contagem, cada uma com o link da aba", () => {
    const html = renderToStaticMarkup(
      <CartaoDaProntidao
        prontidao={{
          ...pronta,
          unidades_ativas: 0,
          nenhuma_unidade_ativa: true,
          profissionais_sem_jornada: { total: 1, nomes: ["Ana Lima"] },
          procedimentos_sem_requisitos: {
            total: 2,
            nomes: ["Botox", "Peeling"],
          },
        }}
      />,
    );
    expect(html).toContain(">2 pendências<");
    expect(html).not.toContain(TEXTOS_DA_PRONTIDAO.pronto);
    expect(html).toContain('href="/cadastros?aba=unidades"');
    expect(html).toContain('href="/cadastros"');
    expect(html).toContain('href="/cadastros?aba=procedimentos"');
    expect(html).toContain("1 profissional ativo sem jornada");
    expect(html).toContain(`${TEXTOS_DA_PRONTIDAO.informativo}: `);
    semTravessao(html);
  });

  it("so o informativo: continua pronto, com a linha informativa", () => {
    const html = renderToStaticMarkup(
      <CartaoDaProntidao
        prontidao={{
          ...pronta,
          procedimentos_sem_requisitos: { total: 1, nomes: ["Botox"] },
        }}
      />,
    );
    expect(html).toContain(TEXTOS_DA_PRONTIDAO.pronto);
    expect(html).toContain("Botox");
  });

  it("erro: diz que nao conferiu, nunca pronto", () => {
    const html = renderToStaticMarkup(<CartaoDaProntidao prontidao={null} />);
    expect(html).toContain(TEXTOS_DA_PRONTIDAO.erro);
    expect(html).toContain(TEXTOS_DA_PRONTIDAO.erroDescricao);
    expect(html).not.toContain(TEXTOS_DA_PRONTIDAO.pronto);
    expect(html).not.toContain(">Pronto<");
  });
});
