import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as dominio from "@/lib/domain/automacoes-de-fluxo";
import {
  acaoEmBranco,
  AJUDA_DAS_CONDICOES,
  automacaoDeFluxoLinhaSchema,
  automacaoDeFluxoSchema,
  AVISOS_FIXOS,
  cicloDaAutomacao,
  condicoesCasam,
  descreverAcoes,
  descreverCondicoes,
  descreverExecucao,
  descreverGatilho,
  descreverRegra,
  destinoDoMover,
  destinosPossiveis,
  entradaDoFormulario,
  esperaEmMinutos,
  esperaParaEdicao,
  formularioDaAutomacaoSchema,
  mensagemDaRecusaAoSalvar,
  mensagemDaRecusaDaAutomacao,
  MENSAGENS_DO_VETO,
  motivoDaPerdaPara,
  NOTA_DO_MOVER,
  OPCOES_DE_ACAO,
  OPCOES_DE_COMBINAR,
  OPCOES_DE_CONDICAO,
  OPCOES_DE_GATILHO,
  ordenarAcoes,
  PRIMEIRA_FALA_MINUTOS,
  previaDaAutomacaoSchema,
  quandoNaClinica,
  RECUSA_DA_ETIQUETA_EM_FILTRO,
  RECUSA_DA_ETIQUETA_USADA,
  recusaDaEtiquetaUsadaPorAutomacao,
  RECUSAS_AO_SALVAR,
  recomecaAVigencia,
  regraParaCiclo,
  regraParaGravar,
  resolvedorDeNomes,
  textoDaEspera,
  textoDaPrevia,
  textoDoCiclo,
  textoDoMotivo,
  textoDoUso,
  valoresIniciais,
  vetoDoDestino,
  type AcaoDaAutomacao,
  type AutomacaoDeFluxo,
  type EtapaParaAutomacao,
  type ExecucaoDaAcao,
  type RegraParaCiclo,
} from "@/lib/domain/automacoes-de-fluxo";
import { chaveDaEtiqueta } from "@/lib/domain/etiquetas-do-lead";

// Funcoes puras da aba "Automacoes de fluxo": a frase em portugues de cada
// regra (Quando, Se e Faz desde a onda 4), as condicoes e o detector de
// ciclo que ESPELHAM o banco, a ordem das acoes (o mover por ultimo), a
// entrada da RPC salvar_automacao_de_fluxo, a conversao do formulario, a
// traducao das recusas e os textos da previa e do historico por acao. O
// banco de verdade esta nos testes de integracao e RLS.

const JORNADA: EtapaParaAutomacao[] = [
  { chave: "novo", nome: "Novo", papel: "entrada" },
  { chave: "em_contato", nome: "Em contato", papel: null },
  { chave: "aguardando_resposta", nome: "Aguardando resposta", papel: null },
  { chave: "follow_2", nome: "Follow 2 - Ligação", papel: null },
  { chave: "agendou", nome: "Agendou", papel: "agendou" },
  { chave: "compareceu", nome: "Compareceu", papel: "compareceu" },
  { chave: "perdido", nome: "Perdido", papel: "perdido" },
];

const nomeDaEtapa = resolvedorDeNomes(JORNADA);
const nomes = {
  etapa: nomeDaEtapa,
  etiqueta: resolvedorDeNomes([{ chave: "retorno", nome: "Retorno" }]),
};

function acao(campos: Partial<AcaoDaAutomacao> = {}): AcaoDaAutomacao {
  return {
    posicao: 1,
    acao: "mover_etapa",
    etapa_destino: "aguardando_resposta",
    motivo_perda: null,
    etiqueta: null,
    atividade_titulo: null,
    atividade_prazo_dias: null,
    nota_texto: null,
    ...campos,
  };
}

const ATIVIDADE = acao({
  posicao: 1,
  acao: "criar_atividade",
  etapa_destino: null,
  atividade_titulo: "Ligar",
  atividade_prazo_dias: 0,
});

function regra(campos: Partial<AutomacaoDeFluxo> = {}): AutomacaoDeFluxo {
  return {
    id: "a1111111-1111-4111-8111-111111111111",
    nome: "Sem resposta vira Perdido",
    ativa: true,
    gatilho: "tempo_na_etapa",
    etapa: "em_contato",
    espera_minutos: 3 * 1440,
    combinar: "todas",
    condicoes: [],
    acoes: [acao()],
    vigente_desde: "2026-10-02T12:00:00Z",
    created_at: "2026-10-02T12:00:00Z",
    updated_at: "2026-10-02T12:00:00Z",
    ...campos,
  };
}

function aresta(
  id: string | null,
  etapa: string,
  destino: string | null,
  campos: Partial<RegraParaCiclo> = {},
): RegraParaCiclo {
  return {
    id,
    ativa: true,
    gatilho: "tempo_na_etapa",
    etapa,
    destino,
    ...campos,
  };
}

describe("a regra em português", () => {
  it("os quatro gatilhos, como a recepção fala", () => {
    expect(descreverGatilho(regra(), nomeDaEtapa)).toBe(
      "Ficou 3 dias em Em contato",
    );
    expect(
      descreverGatilho(
        regra({
          gatilho: "sem_resposta_na_etapa",
          etapa: "aguardando_resposta",
          espera_minutos: 48 * 60,
        }),
        nomeDaEtapa,
      ),
    ).toBe("Ficou 48 h sem responder em Aguardando resposta");
    expect(
      descreverGatilho(
        regra({
          gatilho: "entrou_na_etapa",
          etapa: "agendou",
          espera_minutos: null,
        }),
        nomeDaEtapa,
      ),
    ).toBe("Entrou em Agendou");
    expect(
      descreverGatilho(
        regra({
          gatilho: "mensagem_recebida",
          etapa: "novo",
          espera_minutos: null,
        }),
        nomeDaEtapa,
      ),
    ).toBe("Mandou mensagem estando em Novo");
  });

  it("cada uma das quatro ações sozinha", () => {
    expect(
      descreverAcoes(
        [acao({ etapa_destino: "perdido", motivo_perda: "nao_respondeu" })],
        nomes,
      ),
    ).toBe("Move para Perdido (Não respondeu)");
    expect(
      descreverAcoes(
        [acao({ acao: "etiquetar", etapa_destino: null, etiqueta: "retorno" })],
        nomes,
      ),
    ).toBe("Etiqueta a conversa com Retorno");
    expect(
      descreverAcoes(
        [
          acao({
            acao: "criar_atividade",
            etapa_destino: null,
            atividade_titulo: "Ligar para o paciente",
            atividade_prazo_dias: 2,
          }),
        ],
        nomes,
      ),
    ).toBe("Cria a atividade Ligar para o paciente, em 2 dias");
    expect(
      descreverAcoes(
        [acao({ acao: "nota_interna", etapa_destino: null, nota_texto: "x" })],
        nomes,
      ),
    ).toBe("Deixa uma nota interna");
  });

  it("várias ações na ordem em que rodam, o mover por último", () => {
    // O exemplo do contrato: a automacao da Salud Care com duas acoes.
    const moverPrimeiro = [
      acao({ posicao: 1, etapa_destino: "follow_2" }),
      { ...ATIVIDADE, posicao: 2 },
    ];
    expect(descreverAcoes(moverPrimeiro, nomes)).toBe(
      "Cria a atividade Ligar, para o mesmo dia, e move para Follow 2 - Ligação",
    );
    expect(
      descreverAcoes(
        [
          acao({ acao: "etiquetar", etapa_destino: null, etiqueta: "retorno" }),
          acao({ acao: "nota_interna", etapa_destino: null }),
          acao({ etapa_destino: "perdido", motivo_perda: "nao_respondeu" }),
        ],
        nomes,
      ),
    ).toBe(
      "Etiqueta a conversa com Retorno, deixa uma nota interna e move para Perdido (Não respondeu)",
    );
    expect(descreverAcoes([], nomes)).toBe("Nenhuma ação");
  });

  it("o Se: condições de etiqueta, todas ou qualquer uma", () => {
    expect(descreverCondicoes(regra())).toBeNull();
    expect(
      descreverCondicoes(
        regra({
          condicoes: [
            { posicao: 1, tipo: "tem_etiqueta", etiqueta: "Psiquiatria" },
            { posicao: 2, tipo: "nao_tem_etiqueta", etiqueta: "Retorno" },
          ],
        }),
      ),
    ).toBe("O lead tem a etiqueta Psiquiatria e não tem a etiqueta Retorno");
    expect(
      descreverCondicoes(
        regra({
          combinar: "qualquer",
          condicoes: [
            { posicao: 1, tipo: "tem_etiqueta", etiqueta: "A" },
            { posicao: 2, tipo: "tem_etiqueta", etiqueta: "B" },
            { posicao: 3, tipo: "tem_etiqueta", etiqueta: "C" },
          ],
        }),
      ),
    ).toBe("O lead tem a etiqueta A, tem a etiqueta B ou tem a etiqueta C");
  });

  it("a regra numa frase só (diálogo de ligar)", () => {
    expect(
      descreverRegra(
        regra({
          espera_minutos: 24 * 60,
          etapa: "aguardando_resposta",
          condicoes: [
            { posicao: 1, tipo: "tem_etiqueta", etiqueta: "Psiquiatria" },
          ],
          acoes: [
            { ...ATIVIDADE },
            acao({ posicao: 2, etapa_destino: "follow_2" }),
          ],
        }),
        nomes,
      ),
    ).toBe(
      "Ficou 24 h em Aguardando resposta, se o lead tem a etiqueta Psiquiatria: cria a atividade Ligar, para o mesmo dia, e move para Follow 2 - Ligação.",
    );
    expect(descreverRegra(regra(), nomes)).toBe(
      "Ficou 3 dias em Em contato: move para Aguardando resposta.",
    );
  });

  it("chave que sumiu do catálogo (cache velho) aparece crua, sem quebrar", () => {
    expect(
      descreverGatilho(regra({ etapa: "etapa_apagada" }), nomeDaEtapa),
    ).toBe("Ficou 3 dias em etapa_apagada");
  });
});

describe("a ordem das ações (D7)", () => {
  it("o mover vai para o fim; as outras ficam na ordem dada", () => {
    const lista = [
      { acao: "mover_etapa" as const, id: 1 },
      { acao: "nota_interna" as const, id: 2 },
      { acao: "etiquetar" as const, id: 3 },
    ];
    expect(ordenarAcoes(lista).map((item) => item.id)).toEqual([2, 3, 1]);
    expect(ordenarAcoes([]).length).toBe(0);
  });

  it("o destino do mover da regra (ou nenhum)", () => {
    expect(
      destinoDoMover([ATIVIDADE, acao({ etapa_destino: "perdido" })]),
    ).toBe("perdido");
    expect(destinoDoMover([ATIVIDADE])).toBeNull();
  });

  it("a linha lida do banco sai com as filhas em ordem e o mover no fim", () => {
    const linha = automacaoDeFluxoLinhaSchema.parse({
      id: "x",
      nome: "Regra",
      ativa: true,
      gatilho: "entrou_na_etapa",
      etapa: "novo",
      espera_minutos: null,
      combinar: "qualquer",
      vigente_desde: "2026-10-24T12:00:00Z",
      created_at: "2026-10-24T12:00:00Z",
      updated_at: "2026-10-24T12:00:00Z",
      condicoes: [
        { posicao: 2, tipo: "nao_tem_etiqueta", etiqueta: "B" },
        { posicao: 1, tipo: "tem_etiqueta", etiqueta: "A" },
      ],
      acoes: [
        acao({
          posicao: 1,
          etapa_destino: "perdido",
          motivo_perda: "nao_respondeu",
        }),
        { ...ATIVIDADE, posicao: 3 },
        acao({
          posicao: 2,
          acao: "nota_interna",
          etapa_destino: null,
          nota_texto: "x",
        }),
      ],
    });
    expect(linha.condicoes.map((c) => c.etiqueta)).toEqual(["A", "B"]);
    expect(linha.acoes.map((a) => a.acao)).toEqual([
      "nota_interna",
      "criar_atividade",
      "mover_etapa",
    ]);
    // Sem filhas embutidas: listas vazias, nunca erro.
    const semFilhas = automacaoDeFluxoLinhaSchema.parse({
      id: "y",
      nome: "Regra",
      ativa: false,
      gatilho: "entrou_na_etapa",
      etapa: "novo",
      espera_minutos: null,
      combinar: "todas",
      vigente_desde: "2026-10-24T12:00:00Z",
      created_at: "2026-10-24T12:00:00Z",
      updated_at: "2026-10-24T12:00:00Z",
    });
    expect(semFilhas.condicoes).toEqual([]);
    expect(semFilhas.acoes).toEqual([]);
  });

  it("valor fora do vocabulário vira erro, não frase mentindo", () => {
    expect(
      automacaoDeFluxoLinhaSchema.safeParse({
        ...regra(),
        combinar: "nenhuma",
      }).success,
    ).toBe(false);
  });
});

describe("condições (espelho do executor; D1, D5, D6, D9)", () => {
  const doLead = ["Psiquiatria", "Retorno"].map(chaveDaEtiqueta);

  it("sem condição, sempre casa", () => {
    expect(condicoesCasam([], [], "todas")).toBe(true);
    expect(condicoesCasam([], doLead, "qualquer")).toBe(true);
  });

  it("tem e não tem, pelo nome sem maiúscula e acento", () => {
    expect(
      condicoesCasam(
        [{ tipo: "tem_etiqueta", etiqueta: "PSIQUIATRIA" }],
        doLead,
        "todas",
      ),
    ).toBe(true);
    expect(
      condicoesCasam(
        [{ tipo: "nao_tem_etiqueta", etiqueta: "retorno" }],
        doLead,
        "todas",
      ),
    ).toBe(false);
    expect(
      condicoesCasam(
        [{ tipo: "nao_tem_etiqueta", etiqueta: "Odontologia" }],
        doLead,
        "todas",
      ),
    ).toBe(true);
    expect(
      condicoesCasam(
        [{ tipo: "tem_etiqueta", etiqueta: "Avaliação" }],
        [chaveDaEtiqueta(" avaliacao ")],
        "todas",
      ),
    ).toBe(true);
  });

  it("todas exige cada uma; qualquer uma basta uma", () => {
    const condicoes = [
      { tipo: "tem_etiqueta" as const, etiqueta: "Psiquiatria" },
      { tipo: "tem_etiqueta" as const, etiqueta: "Odontologia" },
    ];
    expect(condicoesCasam(condicoes, doLead, "todas")).toBe(false);
    expect(condicoesCasam(condicoes, doLead, "qualquer")).toBe(true);
    expect(condicoesCasam(condicoes, [], "qualquer")).toBe(false);
  });
});

describe("espera: horas e dias na tela, minutos no banco", () => {
  it("converte para minutos", () => {
    expect(esperaEmMinutos(48, "horas")).toBe(2880);
    expect(esperaEmMinutos(3, "dias")).toBe(4320);
  });

  it("frase: dias a partir de 3 dias inteiros, horas no resto", () => {
    expect(textoDaEspera(60)).toBe("1 h");
    expect(textoDaEspera(24 * 60)).toBe("24 h");
    expect(textoDaEspera(48 * 60)).toBe("48 h");
    expect(textoDaEspera(72 * 60)).toBe("3 dias");
    expect(textoDaEspera(90 * 1440)).toBe("90 dias");
    expect(textoDaEspera(73 * 60)).toBe("73 h");
    // Fracao de hora so nasce fora da tela, mas a frase nao mente.
    expect(textoDaEspera(90)).toBe("1 h 30 min");
  });

  it("reabrir no diálogo usa a mesma regra da frase", () => {
    expect(esperaParaEdicao(48 * 60)).toEqual({ valor: 48, unidade: "horas" });
    expect(esperaParaEdicao(7 * 1440)).toEqual({ valor: 7, unidade: "dias" });
    expect(esperaParaEdicao(90)).toEqual({ valor: 2, unidade: "horas" });
  });
});

describe("vetos de destino (espelho do banco)", () => {
  it("Agendou e Compareceu nunca são destino, nem a própria origem", () => {
    expect(
      destinosPossiveis(JORNADA, "em_contato").map((etapa) => etapa.chave),
    ).toEqual(["novo", "aguardando_resposta", "follow_2", "perdido"]);
  });

  it("cada veto do gatilho de validação", () => {
    const veto = (etapaDestino: string | null, motivoPerda: string | null) =>
      vetoDoDestino({
        etapa: "em_contato",
        etapaDestino,
        motivoPerda,
        jornada: JORNADA,
      });
    expect(veto(null, null)).toBe("sem_destino");
    expect(veto("em_contato", null)).toBe("destino_igual_origem");
    expect(veto("nao_existe", null)).toBe("destino_inexistente");
    expect(veto("agendou", null)).toBe("destino_da_agenda");
    expect(veto("compareceu", null)).toBe("destino_da_agenda");
    expect(veto("perdido", null)).toBe("perdido_sem_motivo");
    expect(veto("aguardando_resposta", "nao_respondeu")).toBe(
      "motivo_sem_perdido",
    );
    expect(veto("perdido", "nao_respondeu")).toBeNull();
    expect(veto("aguardando_resposta", null)).toBeNull();
  });

  it("o motivo da perda nasce do papel do destino", () => {
    expect(motivoDaPerdaPara("perdido", JORNADA)).toBe("nao_respondeu");
    expect(motivoDaPerdaPara("em_contato", JORNADA)).toBeNull();
    expect(motivoDaPerdaPara(null, JORNADA)).toBeNull();
  });
});

describe("detector de ciclo (espelho de automacao_fecha_ciclo, lendo as ações)", () => {
  it("ida e volta entre duas etapas por tempo fecha ciclo, com o caminho", () => {
    const outras = [aresta("b", "aguardando_resposta", "em_contato")];
    const caminho = cicloDaAutomacao(
      aresta(null, "em_contato", "aguardando_resposta"),
      outras,
    );
    expect(caminho).toEqual([
      "em_contato",
      "aguardando_resposta",
      "em_contato",
    ]);
    expect(textoDoCiclo(caminho!, nomeDaEtapa)).toBe(
      "Em contato, Aguardando resposta e de volta a Em contato",
    );
  });

  it("ciclo de três etapas", () => {
    const outras = [
      aresta("b", "aguardando_resposta", "novo"),
      aresta("c", "novo", "em_contato"),
    ];
    expect(
      cicloDaAutomacao(
        aresta("a", "em_contato", "aguardando_resposta"),
        outras,
      ),
    ).toEqual(["em_contato", "aguardando_resposta", "novo", "em_contato"]);
  });

  it("o destino sai da ação de mover, mesmo com outras ações antes dela", () => {
    const outra = regraParaCiclo(
      regra({
        id: "b",
        etapa: "aguardando_resposta",
        acoes: [ATIVIDADE, acao({ posicao: 2, etapa_destino: "em_contato" })],
      }),
    );
    expect(outra.destino).toBe("em_contato");
    expect(
      cicloDaAutomacao(aresta("a", "em_contato", "aguardando_resposta"), [
        outra,
      ]),
    ).not.toBeNull();
    // Regra com condicao conta como aresta (conservador: pode bater).
    const comCondicao = regraParaCiclo(
      regra({
        id: "c",
        etapa: "aguardando_resposta",
        condicoes: [{ posicao: 1, tipo: "tem_etiqueta", etiqueta: "X" }],
        acoes: [acao({ etapa_destino: "em_contato" })],
      }),
    );
    expect(
      cicloDaAutomacao(aresta("a", "em_contato", "aguardando_resposta"), [
        comCondicao,
      ]),
    ).not.toBeNull();
  });

  it("regra desligada não entra, nem a salva desligada", () => {
    const outras = [
      aresta("b", "aguardando_resposta", "em_contato", { ativa: false }),
    ];
    expect(
      cicloDaAutomacao(
        aresta("a", "em_contato", "aguardando_resposta"),
        outras,
      ),
    ).toBeNull();
    expect(
      cicloDaAutomacao(
        aresta("a", "em_contato", "aguardando_resposta", { ativa: false }),
        [aresta("b", "aguardando_resposta", "em_contato")],
      ),
    ).toBeNull();
  });

  it("gatilho de mensagem não vira aresta (depende de o lead escrever)", () => {
    const outras = [
      aresta("b", "aguardando_resposta", "em_contato", {
        gatilho: "mensagem_recebida",
      }),
    ];
    expect(
      cicloDaAutomacao(
        aresta("a", "em_contato", "aguardando_resposta"),
        outras,
      ),
    ).toBeNull();
    expect(
      cicloDaAutomacao(
        aresta("a", "em_contato", "aguardando_resposta", {
          gatilho: "mensagem_recebida",
        }),
        [aresta("b", "aguardando_resposta", "em_contato")],
      ),
    ).toBeNull();
  });

  it("a versão antiga da própria regra fica de fora (pelo id)", () => {
    const antiga = aresta("a", "em_contato", "aguardando_resposta");
    expect(
      cicloDaAutomacao(aresta("a", "aguardando_resposta", "em_contato"), [
        antiga,
      ]),
    ).toBeNull();
  });

  it("regra sem ação de mover nunca fecha ciclo", () => {
    expect(
      cicloDaAutomacao(aresta("a", "em_contato", null), [
        aresta("b", "x", "em_contato"),
      ]),
    ).toBeNull();
    expect(regraParaCiclo(regra({ acoes: [ATIVIDADE] })).destino).toBeNull();
  });
});

describe("entrada da Server Action (regra composta)", () => {
  const base = {
    id: null,
    nome: "Cobrar retorno",
    ativa: false,
    gatilho: "entrou_na_etapa",
    etapa: "em_contato",
    espera_minutos: null,
    combinar: "todas",
    condicoes: [],
    acoes: [
      {
        acao: "criar_atividade",
        atividade_titulo: "Ligar para o lead",
        atividade_prazo_dias: 2,
      },
    ],
  };

  it("aceita a regra coerente", () => {
    expect(automacaoDeFluxoSchema.safeParse(base).success).toBe(true);
  });

  it("gatilho de tempo exige espera na faixa de 1 hora a 90 dias", () => {
    const semEspera = automacaoDeFluxoSchema.safeParse({
      ...base,
      gatilho: "tempo_na_etapa",
    });
    expect(semEspera.success).toBe(false);
    for (const minutos of [59, 129_601]) {
      expect(
        automacaoDeFluxoSchema.safeParse({
          ...base,
          gatilho: "tempo_na_etapa",
          espera_minutos: minutos,
        }).success,
      ).toBe(false);
    }
  });

  it("de 1 a 5 ações; até 5 condições", () => {
    expect(
      automacaoDeFluxoSchema.safeParse({ ...base, acoes: [] }).success,
    ).toBe(false);
    const nota = { acao: "nota_interna", nota_texto: "Oi" };
    expect(
      automacaoDeFluxoSchema.safeParse({
        ...base,
        acoes: [nota, nota, nota, nota, nota],
      }).success,
    ).toBe(true);
    expect(
      automacaoDeFluxoSchema.safeParse({
        ...base,
        acoes: [nota, nota, nota, nota, nota, nota],
      }).success,
    ).toBe(false);
    const condicao = { tipo: "tem_etiqueta", etiqueta: "X" };
    expect(
      automacaoDeFluxoSchema.safeParse({
        ...base,
        condicoes: Array(5).fill(condicao),
      }).success,
    ).toBe(true);
    expect(
      automacaoDeFluxoSchema.safeParse({
        ...base,
        condicoes: Array(6).fill(condicao),
      }).success,
    ).toBe(false);
  });

  it("no máximo um mover, com destino diferente da origem", () => {
    const mover = { acao: "mover_etapa", etapa_destino: "perdido" };
    const dois = automacaoDeFluxoSchema.safeParse({
      ...base,
      acoes: [mover, { ...mover, etapa_destino: "novo" }],
    });
    expect(dois.success).toBe(false);
    expect(dois.error?.issues.map((issue) => issue.message)).toContain(
      "Uma automação move o lead uma vez só.",
    );
    expect(
      automacaoDeFluxoSchema.safeParse({
        ...base,
        acoes: [{ acao: "mover_etapa", etapa_destino: "em_contato" }],
      }).success,
    ).toBe(false);
  });

  it("cada ação exige os próprios campos", () => {
    for (const invalida of [
      { acao: "mover_etapa" },
      { acao: "etiquetar" },
      { acao: "nota_interna", nota_texto: "   " },
      {
        acao: "criar_atividade",
        atividade_titulo: "x",
        atividade_prazo_dias: 1,
      },
      {
        acao: "criar_atividade",
        atividade_titulo: "Ligar",
        atividade_prazo_dias: 366,
      },
      { acao: "enviar_mensagem", texto: "Oi" },
    ]) {
      expect(
        automacaoDeFluxoSchema.safeParse({ ...base, acoes: [invalida] })
          .success,
        JSON.stringify(invalida),
      ).toBe(false);
    }
  });

  it("a etiqueta da condição: limpa, de 1 a 40 caracteres", () => {
    const comCondicao = (etiqueta: string) =>
      automacaoDeFluxoSchema.safeParse({
        ...base,
        condicoes: [{ tipo: "tem_etiqueta", etiqueta }],
      });
    expect(comCondicao("  Psiquiatria   adulta ").data?.condicoes).toEqual([
      { tipo: "tem_etiqueta", etiqueta: "Psiquiatria adulta" },
    ]);
    expect(comCondicao("").success).toBe(false);
    expect(comCondicao("x".repeat(41)).success).toBe(false);
    expect(
      automacaoDeFluxoSchema.safeParse({
        ...base,
        condicoes: [{ tipo: "parece_com", etiqueta: "X" }],
      }).success,
    ).toBe(false);
  });

  it("o jsonb da RPC: o mover no fim, só os campos de cada ação, sem motivo nem carimbo", () => {
    const dados = automacaoDeFluxoSchema.parse({
      ...base,
      gatilho: "tempo_na_etapa",
      espera_minutos: 1440,
      combinar: "qualquer",
      condicoes: [{ tipo: "nao_tem_etiqueta", etiqueta: "Retorno" }],
      acoes: [
        { acao: "mover_etapa", etapa_destino: "follow_2", etiqueta: "lixo" },
        {
          acao: "criar_atividade",
          atividade_titulo: " Ligar ",
          atividade_prazo_dias: 0,
          nota_texto: "lixo",
        },
      ],
    });
    expect(regraParaGravar(dados)).toEqual({
      nome: "Cobrar retorno",
      ativa: false,
      gatilho: "tempo_na_etapa",
      etapa: "em_contato",
      espera_minutos: 1440,
      combinar: "qualquer",
      condicoes: [{ tipo: "nao_tem_etiqueta", etiqueta: "Retorno" }],
      acoes: [
        {
          acao: "criar_atividade",
          etapa_destino: null,
          etiqueta: null,
          atividade_titulo: "Ligar",
          atividade_prazo_dias: 0,
          nota_texto: null,
        },
        {
          acao: "mover_etapa",
          etapa_destino: "follow_2",
          etiqueta: null,
          atividade_titulo: null,
          atividade_prazo_dias: null,
          nota_texto: null,
        },
      ],
    });
  });

  it("espera de gatilho que não é de tempo vai null; nunca manda carimbo", () => {
    const gravar = regraParaGravar(
      automacaoDeFluxoSchema.parse({ ...base, espera_minutos: 600 }),
    );
    expect(gravar.espera_minutos).toBeNull();
    for (const proibido of [
      "id",
      "created_by",
      "updated_by",
      "created_at",
      "vigente_desde",
      "clinic_id",
    ]) {
      expect(gravar).not.toHaveProperty(proibido);
    }
    for (const acaoGravada of gravar.acoes) {
      expect(acaoGravada).not.toHaveProperty("motivo_perda");
    }
  });
});

describe("formulário do diálogo", () => {
  it("regra nova nasce desligada, sem condição e com uma ação (mover)", () => {
    const valores = valoresIniciais(null);
    expect(valores.ativa).toBe(false);
    expect(valores.condicoes).toEqual([]);
    expect(valores.combinar).toBe("todas");
    expect(valores.acoes).toEqual([acaoEmBranco("mover_etapa")]);
  });

  it("ida e volta: regra composta vira formulário e volta igual", () => {
    const existente = regra({
      gatilho: "sem_resposta_na_etapa",
      espera_minutos: 48 * 60,
      combinar: "qualquer",
      condicoes: [
        { posicao: 1, tipo: "tem_etiqueta", etiqueta: "Psiquiatria" },
      ],
      acoes: [
        { ...ATIVIDADE },
        acao({
          posicao: 2,
          etapa_destino: "perdido",
          motivo_perda: "nao_respondeu",
        }),
      ],
    });
    const valores = valoresIniciais(existente);
    expect(valores.espera_valor).toBe("48");
    expect(valores.espera_unidade).toBe("horas");
    expect(valores.acoes.map((item) => item.acao)).toEqual([
      "criar_atividade",
      "mover_etapa",
    ]);
    expect(formularioDaAutomacaoSchema.safeParse(valores).success).toBe(true);
    const entrada = entradaDoFormulario(valores, existente.id);
    expect(entrada).toEqual({
      id: existente.id,
      nome: existente.nome,
      ativa: true,
      gatilho: "sem_resposta_na_etapa",
      etapa: "em_contato",
      espera_minutos: 2880,
      combinar: "qualquer",
      condicoes: [{ tipo: "tem_etiqueta", etiqueta: "Psiquiatria" }],
      acoes: [
        {
          acao: "criar_atividade",
          atividade_titulo: "Ligar",
          atividade_prazo_dias: 0,
        },
        { acao: "mover_etapa", etapa_destino: "perdido" },
      ],
    });
    expect(automacaoDeFluxoSchema.safeParse(entrada).success).toBe(true);
  });

  it("o erro de cada ação cai no campo dela", () => {
    const resultado = formularioDaAutomacaoSchema.safeParse({
      ...valoresIniciais(regra()),
      acoes: [
        { ...acaoEmBranco("criar_atividade"), atividade_titulo: "x" },
        acaoEmBranco("mover_etapa"),
      ],
    });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues.map((issue) => issue.path)).toEqual([
      ["acoes", 0, "atividade_titulo"],
      ["acoes", 1, "etapa_destino"],
    ]);
  });

  it("condição sem etiqueta é recusada no campo dela", () => {
    const resultado = formularioDaAutomacaoSchema.safeParse({
      ...valoresIniciais(regra()),
      condicoes: [{ tipo: "tem_etiqueta", etiqueta: "  " }],
    });
    expect(resultado.error?.issues.map((issue) => issue.path)).toEqual([
      ["condicoes", 0, "etiqueta"],
    ]);
  });

  it("dois movers no formulário: o erro da lista", () => {
    const resultado = formularioDaAutomacaoSchema.safeParse({
      ...valoresIniciais(regra()),
      acoes: [
        { ...acaoEmBranco("mover_etapa"), etapa_destino: "perdido" },
        { ...acaoEmBranco("mover_etapa"), etapa_destino: "novo" },
      ],
    });
    expect(resultado.error?.issues[0]).toMatchObject({
      path: ["acoes"],
      message: "Uma automação move o lead uma vez só.",
    });
  });

  it("tempo fora da faixa ou não inteiro é recusado no campo do tempo", () => {
    for (const [valor, unidade] of [
      ["0", "horas"],
      ["91", "dias"],
      ["1,5", "horas"],
      ["", "dias"],
    ] as const) {
      const resultado = formularioDaAutomacaoSchema.safeParse({
        ...valoresIniciais(regra()),
        espera_valor: valor,
        espera_unidade: unidade,
      });
      expect(resultado.success).toBe(false);
      expect(resultado.error?.issues[0]?.path).toEqual(["espera_valor"]);
    }
  });

  it("gatilho que não é de tempo ignora o campo do tempo", () => {
    const valores = {
      ...valoresIniciais(regra()),
      gatilho: "entrou_na_etapa" as const,
      espera_valor: "",
    };
    expect(formularioDaAutomacaoSchema.safeParse(valores).success).toBe(true);
    expect(entradaDoFormulario(valores, null).espera_minutos).toBeNull();
  });
});

describe("recusas do banco traduzidas", () => {
  const padrao = "Não foi possível salvar a automação.";

  it("pelo hint do 23514 (ciclo, destino da Agenda, motivo)", () => {
    expect(
      mensagemDaRecusaDaAutomacao(
        { code: "23514", message: "...", hint: "automacao_ciclo" },
        padrao,
      ),
    ).toContain("fecha um ciclo");
    expect(
      mensagemDaRecusaDaAutomacao(
        { code: "23514", message: "...", hint: "automacao_destino_da_agenda" },
        padrao,
      ),
    ).toBe(MENSAGENS_DO_VETO.destino_da_agenda);
    expect(
      mensagemDaRecusaDaAutomacao(
        { code: "23514", message: "...", hint: "automacao_perdido_sem_motivo" },
        padrao,
      ),
    ).toBe(MENSAGENS_DO_VETO.perdido_sem_motivo);
    expect(
      mensagemDaRecusaDaAutomacao(
        {
          code: "23514",
          message: "...",
          hint: "automacao_motivo_sem_perdido",
        },
        padrao,
      ),
    ).toBe(MENSAGENS_DO_VETO.motivo_sem_perdido);
  });

  it("etapa ou etiqueta inexistente (FK composta, 23503), na regra e nas ações", () => {
    const fk = (tabela: string, constraint: string) =>
      mensagemDaRecusaDaAutomacao(
        {
          code: "23503",
          message: `insert or update on table "${tabela}" violates foreign key constraint "${constraint}"`,
        },
        padrao,
      );
    expect(fk("automacao_fluxo", "automacao_fluxo_etapa_destino_fkey")).toBe(
      MENSAGENS_DO_VETO.destino_inexistente,
    );
    expect(fk("automacao_acao", "automacao_acao_etapa_destino_fkey")).toBe(
      MENSAGENS_DO_VETO.destino_inexistente,
    );
    expect(fk("automacao_fluxo", "automacao_fluxo_etapa_fkey")).toContain(
      "A etapa escolhida não existe mais",
    );
    expect(fk("automacao_acao", "automacao_acao_etiqueta_fkey")).toContain(
      "A etiqueta escolhida não existe mais",
    );
  });

  it("pela constraint do check (também os das tabelas filhas)", () => {
    expect(
      mensagemDaRecusaDaAutomacao(
        {
          code: "23514",
          message:
            'new row for relation "automacao_fluxo" violates check constraint "espera_na_faixa"',
        },
        padrao,
      ),
    ).toBe("O tempo vai de 1 hora a 90 dias.");
    expect(
      mensagemDaRecusaDaAutomacao(
        {
          code: "23514",
          message:
            'new row for relation "automacao_acao" violates check constraint "nota_da_automacao_com_tamanho"',
        },
        padrao,
      ),
    ).toBe("A nota vai de 1 a 2000 caracteres.");
    expect(
      mensagemDaRecusaDaAutomacao(
        {
          code: "23514",
          message:
            'new row for relation "automacao_condicao" violates check constraint "automacao_condicao_etiqueta_check"',
        },
        padrao,
      ),
    ).toContain("cada etiqueta vai de 1 a 40 caracteres");
    expect(
      mensagemDaRecusaDaAutomacao(
        {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "automacao_acao_um_mover"',
        },
        padrao,
      ),
    ).toBe("Uma automação move o lead uma vez só.");
  });

  it("permissão e o resto", () => {
    expect(
      mensagemDaRecusaDaAutomacao({ code: "42501", message: "rls" }, padrao),
    ).toBe("Somente administradores e gestores mudam as automações de fluxo.");
    expect(
      mensagemDaRecusaDaAutomacao(
        { code: "23514", message: "Uma automação não muda de clínica." },
        padrao,
      ),
    ).toBe(padrao);
    expect(mensagemDaRecusaDaAutomacao(null, padrao)).toBe(padrao);
  });

  it("ao salvar pela RPC: limites, regra que não existe e banco antes da migration", () => {
    expect(mensagemDaRecusaAoSalvar({ code: "22023" }, padrao)).toBe(
      RECUSAS_AO_SALVAR.limites,
    );
    // Os hints da RPC (migration 20261024110000).
    expect(
      mensagemDaRecusaAoSalvar(
        { code: "22023", hint: "automacao_acoes" },
        padrao,
      ),
    ).toBe("Uma automação tem de 1 a 5 ações.");
    expect(
      mensagemDaRecusaAoSalvar(
        { code: "22023", hint: "automacao_condicoes" },
        padrao,
      ),
    ).toBe("Uma automação tem até 5 condições.");
    expect(
      mensagemDaRecusaAoSalvar(
        { code: "22023", hint: "automacao_um_mover" },
        padrao,
      ),
    ).toBe("Uma automação move o lead uma vez só.");
    expect(
      mensagemDaRecusaAoSalvar(
        { code: "22023", hint: "automacao_regra_invalida" },
        padrao,
      ),
    ).toBe("Confira os campos da automação e salve de novo.");
    // P0002 nao diz se o id existe em outra clinica.
    expect(mensagemDaRecusaAoSalvar({ code: "P0002" }, padrao)).toBe(
      RECUSAS_AO_SALVAR.naoExiste,
    );
    // A RPC ausente falha fechado: nada foi gravado (correcao de 22/10/2026).
    expect(mensagemDaRecusaAoSalvar({ code: "PGRST202" }, padrao)).toBe(
      "Não foi possível salvar a automação agora. Nada foi alterado. Tente de novo em alguns minutos.",
    );
    expect(mensagemDaRecusaAoSalvar({ code: "42883" }, padrao)).toBe(
      RECUSAS_AO_SALVAR.indisponivel,
    );
    expect(
      mensagemDaRecusaAoSalvar(
        { code: "23514", hint: "automacao_ciclo" },
        padrao,
      ),
    ).toContain("fecha um ciclo");
    expect(mensagemDaRecusaAoSalvar({ code: "42501" }, padrao)).toBe(
      "Somente administradores e gestores mudam as automações de fluxo.",
    );
    expect(mensagemDaRecusaAoSalvar(null, padrao)).toBe(padrao);
  });

  it("etiqueta do catálogo num filtro: a mensagem do banco, que diz onde trocar", () => {
    expect(
      recusaDaEtiquetaUsadaPorAutomacao({
        code: "P0001",
        message: "Esta etiqueta é usada por uma automação de fluxo.",
        hint: "etiqueta_usada_por_automacao",
      }),
    ).toBe(RECUSA_DA_ETIQUETA_USADA);
    expect(
      recusaDaEtiquetaUsadaPorAutomacao({
        code: "P0001",
        message:
          "Esta etiqueta está no filtro de uma régua de follow-up. Troque em Automações.",
        hint: "etiqueta_usada_em_filtro",
      }),
    ).toBe(
      "Esta etiqueta está no filtro de uma régua de follow-up. Troque em Automações.",
    );
    expect(
      recusaDaEtiquetaUsadaPorAutomacao({
        code: "P0001",
        message: "",
        hint: "etiqueta_usada_em_filtro",
      }),
    ).toBe(RECUSA_DA_ETIQUETA_EM_FILTRO);
    expect(
      recusaDaEtiquetaUsadaPorAutomacao({ code: "42501", message: "rls" }),
    ).toBeNull();
  });
});

describe("prévia (não é retroativa)", () => {
  it("a vigência recomeça como no banco: nova, ao ligar, ao mudar quando roda", () => {
    const ligada = regra();
    expect(recomecaAVigencia(null, ligada)).toBe(true);
    expect(
      recomecaAVigencia(
        { ...ligada, ativa: false },
        { ...ligada, ativa: true },
      ),
    ).toBe(true);
    expect(recomecaAVigencia(ligada, { ...ligada, espera_minutos: 60 })).toBe(
      true,
    );
    expect(recomecaAVigencia(ligada, { ...ligada, etapa: "novo" })).toBe(true);
    expect(
      recomecaAVigencia(ligada, {
        ...ligada,
        gatilho: "sem_resposta_na_etapa",
      }),
    ).toBe(true);
    // Mudar o nome, as condicoes ou as acoes (ou desligar) nao recomeca.
    expect(recomecaAVigencia(ligada, { ...ligada })).toBe(false);
    expect(recomecaAVigencia(ligada, { ...ligada, ativa: false })).toBe(false);
  });

  it("valida o formato da RPC", () => {
    expect(
      previaDaAutomacaoSchema.safeParse({
        na_etapa: 5,
        ja_se_encaixam: 2,
        importados_fora: 0,
      }).success,
    ).toBe(true);
    expect(previaDaAutomacaoSchema.safeParse({ na_etapa: "5" }).success).toBe(
      false,
    );
  });

  it("gatilho de tempo: N leads já passaram do tempo e não serão afetados", () => {
    expect(
      textoDaPrevia(
        { na_etapa: 9, ja_se_encaixam: 4, importados_fora: 0 },
        "tempo_na_etapa",
        "Em contato",
      ),
    ).toEqual({
      principal: "4 leads já passaram do tempo e não serão afetados.",
      importados: null,
    });
    expect(
      textoDaPrevia(
        { na_etapa: 1, ja_se_encaixam: 1, importados_fora: 2 },
        "sem_resposta_na_etapa",
        "Em contato",
      ),
    ).toEqual({
      principal: "1 lead já passou do tempo e não será afetado.",
      importados:
        "2 leads importados que nunca mudaram de etapa ficam de fora.",
    });
  });

  it("entrada e mensagem", () => {
    expect(
      textoDaPrevia(
        { na_etapa: 3, ja_se_encaixam: 3, importados_fora: 0 },
        "entrou_na_etapa",
        "Novo",
      ).principal,
    ).toBe(
      "3 leads já estão em Novo e não serão afetados: a automação vale para quem entrar daqui em diante.",
    );
    expect(
      textoDaPrevia(
        { na_etapa: 3, ja_se_encaixam: 0, importados_fora: 0 },
        "mensagem_recebida",
        "Novo",
      ).principal,
    ).toContain("próxima mensagem");
  });
});

describe("histórico", () => {
  // A frase sai do RETRATO gravado na execucao pelo motor (o do pai com uma
  // acao so, o de cada acao com varias), nunca da regra como esta hoje.
  const execucao = (
    campos: Partial<Parameters<typeof descreverExecucao>[0]> = {},
  ): Parameters<typeof descreverExecucao>[0] => ({
    status: "executada",
    motivo: null,
    de_etapa: "novo",
    para_etapa: null,
    acao: null,
    etiqueta: null,
    etiqueta_nome: null,
    ...campos,
  });

  const retrato = (campos: Partial<ExecucaoDaAcao>): ExecucaoDaAcao => ({
    posicao: 1,
    acao: "criar_atividade",
    status: "executada",
    motivo: null,
    para_etapa: null,
    etiqueta: null,
    etiqueta_nome: null,
    executada_em: "2026-10-24T13:00:00Z",
    ...campos,
  });

  it("moveu: de e para", () => {
    expect(
      descreverExecucao(
        execucao({
          de_etapa: "em_contato",
          para_etapa: "perdido",
          acao: "mover_etapa",
        }),
        nomes,
      ),
    ).toEqual({
      texto: "Moveu de Em contato para Perdido",
      codigo: null,
      acoes: [],
    });
  });

  it("etiquetou, criou atividade e anotou", () => {
    expect(
      descreverExecucao(
        execucao({
          acao: "etiquetar",
          etiqueta: "retorno",
          etiqueta_nome: "Retorno",
        }),
        nomes,
      ).texto,
    ).toBe("Etiquetou a conversa com Retorno (em Novo)");
    expect(
      descreverExecucao(execucao({ acao: "criar_atividade" }), nomes).texto,
    ).toBe("Criou uma atividade (em Novo)");
    expect(
      descreverExecucao(execucao({ acao: "nota_interna" }), nomes).texto,
    ).toBe("Deixou uma nota interna na conversa (em Novo)");
  });

  it("execução de antes da onda 4 (sem as filhas): a frase de sempre", () => {
    const antiga = execucao({
      acao: "etiquetar",
      etiqueta: "retorno",
      etiqueta_nome: "Retorno",
    });
    expect(descreverExecucao(antiga, nomes)).toEqual(
      descreverExecucao({ ...antiga, acoes: [] }, nomes),
    );
  });

  it("uma ação só (a automação migrada): igual a antes, pelo retrato do pai", () => {
    const migrada = execucao({
      acao: "criar_atividade",
      acoes: [retrato({})],
    });
    expect(descreverExecucao(migrada, nomes)).toEqual({
      texto: "Criou uma atividade (em Novo)",
      codigo: null,
      acoes: [],
    });
  });

  it("várias ações: o que cada uma fez e o que não fez, e por quê", () => {
    const frase = descreverExecucao(
      execucao({
        de_etapa: "em_contato",
        acoes: [
          retrato({ posicao: 2, acao: "mover_etapa", para_etapa: "follow_2" }),
          retrato({ posicao: 1 }),
          retrato({
            posicao: 3,
            acao: "etiquetar",
            status: "pulada",
            motivo: "ja_tinha_etiqueta",
            etiqueta: "retorno",
            etiqueta_nome: "Retorno",
          }),
        ],
      }),
      nomes,
    );
    expect(frase.texto).toBe("Fez 2 de 3 ações (em Em contato)");
    expect(frase.acoes).toEqual([
      {
        posicao: 1,
        status: "executada",
        texto: "Fez: criou uma atividade",
        codigo: null,
      },
      {
        posicao: 2,
        status: "executada",
        texto: "Fez: moveu de Em contato para Follow 2 - Ligação",
        codigo: null,
      },
      {
        posicao: 3,
        status: "pulada",
        texto:
          "Não fez: etiquetar a conversa com Retorno (a conversa já tinha a etiqueta)",
        codigo: null,
      },
    ]);
  });

  it("várias ações: falha com código e pulada com o motivo do pai", () => {
    const falhou = descreverExecucao(
      execucao({
        status: "falhou",
        motivo: "erro_23514",
        acoes: [
          retrato({ status: "falhou", motivo: "erro_23514" }),
          retrato({
            posicao: 2,
            acao: "nota_interna",
            status: "pulada",
            motivo: "sem_conversa",
          }),
        ],
      }),
      nomes,
    );
    expect(falhou.codigo).toBe("erro_23514");
    expect(falhou.acoes[0]).toEqual({
      posicao: 1,
      status: "falhou",
      texto: "Não conseguiu: criar a atividade",
      codigo: "erro_23514",
    });
    expect(falhou.acoes[1]?.texto).toBe(
      "Não fez: deixar a nota interna (o lead não tem conversa)",
    );
    const pulada = descreverExecucao(
      execucao({
        status: "pulada",
        motivo: "acoes_puladas",
        acoes: [
          retrato({
            status: "pulada",
            motivo: "sem_conversa",
            acao: "nota_interna",
          }),
          retrato({
            posicao: 2,
            acao: "mover_etapa",
            status: "pulada",
            motivo: "tem_consulta_futura",
          }),
        ],
      }),
      nomes,
    );
    expect(pulada.texto).toBe(
      "Não fez nada: nenhuma das ações pôde ser feita (em Novo)",
    );
    expect(pulada.acoes[1]?.texto).toBe(
      "Não fez: mover o lead (o lead tem consulta marcada)",
    );
  });

  it("condição que não bateu e conta suspensa: pulada antes da primeira ação", () => {
    expect(
      descreverExecucao(
        execucao({ status: "pulada", motivo: "condicoes_nao_atendidas" }),
        nomes,
      ),
    ).toEqual({
      texto:
        "Não fez nada: o lead não batia com as condições na hora (em Novo)",
      codigo: null,
      acoes: [],
    });
    expect(
      descreverExecucao(
        execucao({ status: "pulada", motivo: "clinica_suspensa" }),
        nomes,
      ).texto,
    ).toBe("Não fez nada: a conta da clínica estava suspensa (em Novo)");
  });

  it("conta o que a regra fez NA ÉPOCA, mesmo que ela tenha mudado depois", () => {
    const naEpoca = execucao({
      acao: "etiquetar",
      etiqueta: "retorno",
      etiqueta_nome: "Retorno",
    });
    const hoje = regra({
      acoes: [acao({ acao: "nota_interna", etapa_destino: null })],
    });
    expect(hoje.acoes[0]?.acao).toBe("nota_interna");
    expect(descreverExecucao(naEpoca, nomes).texto).toBe(
      "Etiquetou a conversa com Retorno (em Novo)",
    );
  });

  it("usa o nome da etiqueta na hora, não o de hoje", () => {
    const renomeada = execucao({
      acao: "etiquetar",
      etiqueta: "retorno",
      etiqueta_nome: "Retorno antigo",
    });
    expect(descreverExecucao(renomeada, nomes).texto).toBe(
      "Etiquetou a conversa com Retorno antigo (em Novo)",
    );
    const excluida = execucao({
      acao: "etiquetar",
      etiqueta: "vip_apagada",
      etiqueta_nome: "VIP",
    });
    expect(descreverExecucao(excluida, nomes).texto).toBe(
      "Etiquetou a conversa com VIP (em Novo)",
    );
  });

  it("sem o retrato, cai num texto neutro (nunca a ação da regra atual)", () => {
    expect(descreverExecucao(execucao(), nomes)).toEqual({
      texto: "Executou a automação (em Novo)",
      codigo: null,
      acoes: [],
    });
    expect(
      descreverExecucao(execucao({ acao: "etiquetar" }), nomes).texto,
    ).toBe("Etiquetou a conversa (em Novo)");
  });

  it("pendente diz que está na fila", () => {
    expect(
      descreverExecucao(execucao({ status: "pendente" }), nomes).texto,
    ).toBe("Na fila, roda em até 1 minuto (em Novo)");
    // Com parte feita (uma trava ocupada adiou o resto): o que ja fez.
    const parcial = descreverExecucao(
      execucao({
        status: "pendente",
        acoes: [retrato({}), retrato({ posicao: 2, acao: "nota_interna" })],
      }),
      nomes,
    );
    expect(parcial.texto).toBe("Na fila, termina em até 1 minuto (em Novo)");
    expect(parcial.acoes).toHaveLength(2);
  });

  it("pulada diz o motivo; falhou mostra o código", () => {
    expect(
      descreverExecucao(
        execucao({
          status: "pulada",
          motivo: "etapa_mudou",
          de_etapa: "em_contato",
        }),
        nomes,
      ).texto,
    ).toBe("Não fez nada: o lead já tinha mudado de etapa (em Em contato)");
    expect(
      descreverExecucao(
        execucao({
          status: "falhou",
          motivo: "erro_23514",
          de_etapa: "em_contato",
        }),
        nomes,
      ).codigo,
    ).toBe("erro_23514");
  });

  it("todo motivo de pulada do banco tem texto", () => {
    for (const motivo of [
      "regra_desligada",
      "regra_alterada",
      "etapa_mudou",
      "nao_e_lead",
      "importado",
      "lead_respondeu",
      "limite_de_cascata",
      "limite_diario",
      "destino_invalido",
      "tem_consulta_futura",
      "sem_conversa",
      "ja_tinha_etiqueta",
      "limite_de_etiquetas",
      // Onda 4.
      "condicoes_nao_atendidas",
      "acoes_puladas",
      "clinica_suspensa",
    ]) {
      expect(textoDoMotivo(motivo)).not.toBe("motivo não reconhecido");
    }
  });

  it("uso: ainda não rodou, 1 vez, N vezes", () => {
    expect(textoDoUso({ vezes: 0, ultima: null })).toBe("Ainda não rodou");
    expect(textoDoUso({ vezes: 1, ultima: "x" })).toBe("Rodou 1 vez");
    expect(textoDoUso({ vezes: 12, ultima: "x" })).toBe("Rodou 12 vezes");
  });

  it("quando, no fuso da clínica (não no do navegador)", () => {
    const agora = new Date("2026-10-02T15:00:00Z"); // 12:00 em Fortaleza
    // 01:30 UTC do dia 2 ainda e dia 1 em Fortaleza (UTC-3): ontem.
    expect(
      quandoNaClinica("2026-10-02T01:30:00Z", "America/Fortaleza", agora),
    ).toBe("ontem, 22:30");
    expect(
      quandoNaClinica("2026-10-02T13:05:00Z", "America/Fortaleza", agora),
    ).toBe("hoje, 10:05");
    expect(
      quandoNaClinica("2026-09-22T17:05:00Z", "America/Fortaleza", agora),
    ).toBe("22/09, 14:05");
    expect(
      quandoNaClinica("2025-09-22T17:05:00Z", "America/Fortaleza", agora),
    ).toBe("22/09/2025, 14:05");
    // Outro fuso, outro relogio (Manaus, UTC-4).
    expect(
      quandoNaClinica("2026-10-02T13:05:00Z", "America/Manaus", agora),
    ).toBe("hoje, 09:05");
  });
});

describe("textos de interface", () => {
  it("nenhum travessão nos textos da aba", () => {
    const textos: string[] = [
      ...AVISOS_FIXOS,
      ...OPCOES_DE_GATILHO.flatMap((opcao) => [opcao.rotulo, opcao.ajuda]),
      ...OPCOES_DE_ACAO.flatMap((opcao) => [opcao.rotulo, opcao.ajuda]),
      ...OPCOES_DE_CONDICAO.map((opcao) => opcao.rotulo),
      ...OPCOES_DE_COMBINAR.map((opcao) => opcao.rotulo),
      ...Object.values(MENSAGENS_DO_VETO),
      ...Object.values(RECUSAS_AO_SALVAR),
      NOTA_DO_MOVER,
      AJUDA_DAS_CONDICOES,
      dominio.DICA_SEM_PERMISSAO,
      dominio.RECUSA_DA_ETAPA_USADA,
      dominio.RECUSA_DA_ETIQUETA_USADA,
      RECUSA_DA_ETIQUETA_EM_FILTRO,
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/[–—]/);
    }
  });

  it("o aviso fixo de D9: a condição é conferida na hora do gatilho", () => {
    expect(AVISOS_FIXOS).toContain(
      "As condições são conferidas na hora do gatilho: quem não bate fica de fora daquela vez.",
    );
    expect(NOTA_DO_MOVER).toBe(
      "Mover roda sempre por último, depois das outras ações.",
    );
  });
});

describe("ajuda dos gatilhos: espelho da regra do banco", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261002130000_automacoes_de_fluxo.sql",
    ),
    "utf8",
  );
  const ajuda = (valor: string) =>
    OPCOES_DE_GATILHO.find((opcao) => opcao.valor === valor)!.ajuda;

  it("sem responder conta do mais recente entre a entrada e a mensagem do lead", () => {
    // greatest(funnel_stage_changed_at, last_contact_at) na fila, no executor
    // e na previa.
    expect(sql).toContain(
      "greatest(ct.funnel_stage_changed_at, ct.last_contact_at)",
    );
    expect(ajuda("sem_resposta_na_etapa")).toBe(
      "O tempo conta da entrada na etapa ou da última mensagem do lead, o que for mais recente. Mensagem da clínica não zera o tempo.",
    );
  });

  it("a primeira fala que não conta é a mesma janela do banco", () => {
    expect(sql).toContain(
      `v_contato.created_at > now() - interval '${PRIMEIRA_FALA_MINUTOS} minutes'`,
    );
    expect(ajuda("mensagem_recebida")).toContain(
      `primeiros ${PRIMEIRA_FALA_MINUTOS} minutos de um contato novo`,
    );
  });
});
