import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as dominio from "@/lib/domain/automacoes-de-fluxo";
import {
  AVISOS_FIXOS,
  automacaoDeFluxoSchema,
  camposParaGravar,
  cicloDaAutomacao,
  descreverAcao,
  descreverExecucao,
  descreverGatilho,
  destinosPossiveis,
  entradaDoFormulario,
  esperaEmMinutos,
  esperaParaEdicao,
  formularioDaAutomacaoSchema,
  mensagemDaRecusaDaAutomacao,
  MENSAGENS_DO_VETO,
  motivoDaPerdaPara,
  OPCOES_DE_ACAO,
  OPCOES_DE_GATILHO,
  PRIMEIRA_FALA_MINUTOS,
  previaDaAutomacaoSchema,
  quandoNaClinica,
  recomecaAVigencia,
  resolvedorDeNomes,
  textoDaEspera,
  textoDaPrevia,
  textoDoCiclo,
  textoDoMotivo,
  textoDoUso,
  valoresIniciais,
  vetoDoDestino,
  type AutomacaoDeFluxo,
  type EtapaParaAutomacao,
  type RegraParaCiclo,
} from "@/lib/domain/automacoes-de-fluxo";

// Funcoes puras da aba "Automacoes de fluxo": a frase em portugues de cada
// regra, os vetos e o detector de ciclo que ESPELHAM o banco
// (validar_automacao_de_fluxo e os checks de automacao_fluxo, migration
// 20261002130000), a conversao do formulario, a traducao das recusas e os
// textos da previa e do historico. O banco de verdade esta nos testes de
// integracao e RLS da Leva B.

const JORNADA: EtapaParaAutomacao[] = [
  { chave: "novo", nome: "Novo", papel: "entrada" },
  { chave: "em_contato", nome: "Em contato", papel: null },
  { chave: "aguardando_resposta", nome: "Aguardando resposta", papel: null },
  { chave: "agendou", nome: "Agendou", papel: "agendou" },
  { chave: "compareceu", nome: "Compareceu", papel: "compareceu" },
  { chave: "perdido", nome: "Perdido", papel: "perdido" },
];

const nomeDaEtapa = resolvedorDeNomes(JORNADA);
const nomes = {
  etapa: nomeDaEtapa,
  etiqueta: resolvedorDeNomes([{ chave: "retorno", nome: "Retorno" }]),
};

function regra(campos: Partial<AutomacaoDeFluxo> = {}): AutomacaoDeFluxo {
  return {
    id: "a1111111-1111-4111-8111-111111111111",
    nome: "Sem resposta vira Perdido",
    ativa: true,
    gatilho: "tempo_na_etapa",
    etapa: "em_contato",
    espera_minutos: 3 * 1440,
    acao: "mover_etapa",
    etapa_destino: "aguardando_resposta",
    motivo_perda: null,
    etiqueta: null,
    atividade_titulo: null,
    atividade_prazo_dias: null,
    nota_texto: null,
    vigente_desde: "2026-10-02T12:00:00Z",
    created_at: "2026-10-02T12:00:00Z",
    updated_at: "2026-10-02T12:00:00Z",
    ...campos,
  };
}

function aresta(
  id: string | null,
  etapa: string,
  destino: string,
  campos: Partial<RegraParaCiclo> = {},
): RegraParaCiclo {
  return {
    id,
    ativa: true,
    gatilho: "tempo_na_etapa",
    acao: "mover_etapa",
    etapa,
    etapa_destino: destino,
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

  it("as quatro ações", () => {
    expect(
      descreverAcao(
        regra({ etapa_destino: "perdido", motivo_perda: "nao_respondeu" }),
        nomes,
      ),
    ).toBe("Move para Perdido (Não respondeu)");
    expect(
      descreverAcao(
        regra({ acao: "etiquetar", etapa_destino: null, etiqueta: "retorno" }),
        nomes,
      ),
    ).toBe("Etiqueta: Retorno");
    expect(
      descreverAcao(
        regra({
          acao: "criar_atividade",
          etapa_destino: null,
          atividade_titulo: "Ligar para o paciente",
          atividade_prazo_dias: 2,
        }),
        nomes,
      ),
    ).toBe("Cria atividade: Ligar para o paciente, em 2 dias");
    expect(
      descreverAcao(
        regra({
          acao: "criar_atividade",
          etapa_destino: null,
          atividade_titulo: "Ligar",
          atividade_prazo_dias: 0,
        }),
        nomes,
      ),
    ).toBe("Cria atividade: Ligar, para o mesmo dia");
    expect(
      descreverAcao(
        regra({ acao: "nota_interna", etapa_destino: null, nota_texto: "x" }),
        nomes,
      ),
    ).toBe("Nota interna");
  });

  it("chave que sumiu do catálogo (cache velho) aparece crua, sem quebrar", () => {
    expect(
      descreverGatilho(regra({ etapa: "etapa_apagada" }), nomeDaEtapa),
    ).toBe("Ficou 3 dias em etapa_apagada");
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
    ).toEqual(["novo", "aguardando_resposta", "perdido"]);
  });

  it("cada veto do gatilho validar_automacao_de_fluxo", () => {
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

describe("detector de ciclo (espelho do with recursive do banco)", () => {
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
    // Editando "a" de em_contato->aguardando para aguardando->em_contato: a
    // versao antiga nao pode fechar ciclo com a nova.
    const antiga = aresta("a", "em_contato", "aguardando_resposta");
    expect(
      cicloDaAutomacao(aresta("a", "aguardando_resposta", "em_contato"), [
        antiga,
      ]),
    ).toBeNull();
  });

  it("ação que não é mover nunca fecha ciclo", () => {
    expect(
      cicloDaAutomacao(
        { ...aresta("a", "em_contato", "x"), acao: "etiquetar" },
        [aresta("b", "x", "em_contato")],
      ),
    ).toBeNull();
  });
});

describe("entrada da Server Action", () => {
  const base = {
    id: null,
    nome: "Cobrar retorno",
    ativa: false,
    gatilho: "entrou_na_etapa",
    etapa: "em_contato",
    espera_minutos: null,
    acao: "criar_atividade",
    etapa_destino: null,
    etiqueta: null,
    atividade_titulo: "Ligar para o lead",
    atividade_prazo_dias: 2,
    nota_texto: null,
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

  it("cada ação exige os próprios campos", () => {
    expect(
      automacaoDeFluxoSchema.safeParse({ ...base, acao: "mover_etapa" })
        .success,
    ).toBe(false);
    expect(
      automacaoDeFluxoSchema.safeParse({ ...base, acao: "etiquetar" }).success,
    ).toBe(false);
    expect(
      automacaoDeFluxoSchema.safeParse({ ...base, acao: "nota_interna" })
        .success,
    ).toBe(false);
    expect(
      automacaoDeFluxoSchema.safeParse({ ...base, atividade_titulo: "x" })
        .success,
    ).toBe(false);
    expect(
      automacaoDeFluxoSchema.safeParse({ ...base, atividade_prazo_dias: 366 })
        .success,
    ).toBe(false);
  });

  it("grava só os campos da ação; os outros vão null e o motivo vem do destino", () => {
    const dados = automacaoDeFluxoSchema.parse({
      ...base,
      gatilho: "tempo_na_etapa",
      espera_minutos: 4320,
      acao: "mover_etapa",
      etapa_destino: "perdido",
      // Lixo de outras acoes: nao pode ir para o banco.
      etiqueta: "retorno",
      nota_texto: "sobra",
    });
    expect(camposParaGravar(dados, JORNADA)).toEqual({
      nome: "Cobrar retorno",
      ativa: false,
      gatilho: "tempo_na_etapa",
      etapa: "em_contato",
      espera_minutos: 4320,
      acao: "mover_etapa",
      etapa_destino: "perdido",
      motivo_perda: "nao_respondeu",
      etiqueta: null,
      atividade_titulo: null,
      atividade_prazo_dias: null,
      nota_texto: null,
    });
  });

  it("espera de gatilho que não é de tempo vai null", () => {
    const dados = automacaoDeFluxoSchema.parse({
      ...base,
      espera_minutos: 600,
    });
    expect(camposParaGravar(dados, JORNADA).espera_minutos).toBeNull();
  });

  it("nunca manda carimbo do banco", () => {
    const campos = camposParaGravar(
      automacaoDeFluxoSchema.parse(base),
      JORNADA,
    );
    for (const proibido of [
      "created_by",
      "updated_by",
      "created_at",
      "vigente_desde",
      "clinic_id",
    ]) {
      expect(campos).not.toHaveProperty(proibido);
    }
  });
});

describe("formulário do diálogo", () => {
  it("regra nova nasce desligada", () => {
    expect(valoresIniciais(null).ativa).toBe(false);
  });

  it("ida e volta: regra existente vira formulário e volta igual", () => {
    const existente = regra({
      gatilho: "sem_resposta_na_etapa",
      espera_minutos: 48 * 60,
      etapa_destino: "perdido",
      motivo_perda: "nao_respondeu",
    });
    const valores = valoresIniciais(existente);
    expect(valores.espera_valor).toBe("48");
    expect(valores.espera_unidade).toBe("horas");
    expect(formularioDaAutomacaoSchema.safeParse(valores).success).toBe(true);
    const entrada = entradaDoFormulario(valores, existente.id);
    expect(entrada).toMatchObject({
      id: existente.id,
      gatilho: "sem_resposta_na_etapa",
      espera_minutos: 2880,
      acao: "mover_etapa",
      etapa_destino: "perdido",
      etiqueta: null,
      atividade_titulo: null,
      nota_texto: null,
    });
    expect(automacaoDeFluxoSchema.safeParse(entrada).success).toBe(true);
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

  it("etapa ou etiqueta inexistente (FK composta, 23503)", () => {
    const fk = (constraint: string) =>
      mensagemDaRecusaDaAutomacao(
        {
          code: "23503",
          message: `insert or update on table "automacao_fluxo" violates foreign key constraint "${constraint}"`,
        },
        padrao,
      );
    expect(fk("automacao_fluxo_etapa_destino_fkey")).toBe(
      MENSAGENS_DO_VETO.destino_inexistente,
    );
    expect(fk("automacao_fluxo_etapa_fkey")).toContain(
      "A etapa escolhida não existe mais",
    );
    expect(fk("automacao_fluxo_etiqueta_fkey")).toContain(
      "A etiqueta escolhida não existe mais",
    );
  });

  it("pela constraint do check", () => {
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
    // Mudar o nome ou a acao (ou desligar) nao recomeca.
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
  // A frase sai do RETRATO gravado na execucao pelo motor (acao, etiqueta e
  // o nome dela na hora), nunca da regra como esta hoje.
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
    ).toEqual({ texto: "Moveu de Em contato para Perdido", codigo: null });
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

  it("conta o que a regra fez NA ÉPOCA, mesmo que ela tenha mudado depois", () => {
    // A regra rodou etiquetando com Retorno; hoje ela deixa nota interna (ou
    // etiqueta com VIP). A funcao nem recebe a regra: so o retrato conta.
    const naEpoca = execucao({
      acao: "etiquetar",
      etiqueta: "retorno",
      etiqueta_nome: "Retorno",
    });
    const hoje = regra({ acao: "nota_interna", etiqueta: null });
    expect(hoje.acao).toBe("nota_interna");
    expect(descreverExecucao(naEpoca, nomes).texto).toBe(
      "Etiquetou a conversa com Retorno (em Novo)",
    );
  });

  it("usa o nome da etiqueta na hora, não o de hoje", () => {
    // A etiqueta foi renomeada (ou excluida) depois da execucao.
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
    });
    expect(
      descreverExecucao(execucao({ acao: "etiquetar" }), nomes).texto,
    ).toBe("Etiquetou a conversa (em Novo)");
  });

  it("pendente diz que está na fila", () => {
    expect(
      descreverExecucao(execucao({ status: "pendente" }), nomes).texto,
    ).toBe("Na fila, roda em até 1 minuto (em Novo)");
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
      ...Object.values(MENSAGENS_DO_VETO),
      dominio.DICA_SEM_PERMISSAO,
      dominio.RECUSA_DA_ETAPA_USADA,
      dominio.RECUSA_DA_ETIQUETA_USADA,
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/[–—]/);
    }
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
