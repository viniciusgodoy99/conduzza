import {
  BadgeX,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleX,
  FlaskConical,
  Hourglass,
  OctagonPause,
  RadioTower,
  TriangleAlert,
} from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  IA_NA_CLINICA_STATUS,
  LIGADO_DESLIGADO_STATUS,
  NUMERO_DO_ASSISTENTE_STATUS,
  TELEFONE_DA_EQUIPE_STATUS,
} from "@/components/agente/whatsapp/agente-de-ia";
import {
  AGENTE_DA_CLINICA_STATUS,
  agenteDaClinicaSchema,
  apoioDoAgente,
  efeitoDeRevogar,
  ESCOPO_DO_REQUISITO,
  evidenciaValida,
  detalheDoRequisito,
  linhasDosRequisitos,
  producaoLiberada,
  publicoDosRequisitos,
  publicoNoDialogo,
  registrarRequisitoSchema,
  REQUISITO_STATUS,
  REQUISITOS_DA_EQUIPE,
  requisitosDoHint,
  revogarRequisitoSchema,
  rotuloDoRequisito,
  versaoMudouDepoisDaRodada,
  contaDaClinicaSchema,
  dolares,
  dolaresParaCampo,
  estadoDoGasto,
  filtrarClinicas,
  filtrosAtivos,
  FILTROS_PADRAO,
  GASTO_STATUS,
  lerFiltrosDoPainel,
  lerRespostasPorHora,
  lerTetoEmDolares,
  motivoValido,
  nenhumNumeroConectado,
  normalizarBusca,
  OPCOES_DO_ESTADO_DO_AGENTE,
  quandoNaClinica,
  SITUACAO_DA_CONTA_STATUS,
  situacaoDaConta,
  tetoDaIaSchema,
  textoDosNumeros,
  TEXTOS_DO_PAINEL,
} from "@/components/painel-geral/painel-geral";
import {
  ACCESS_LEVEL_STATUS,
  APPOINTMENT_FLAG,
  APPOINTMENT_STATUS,
  ATIVIDADE_STATUS,
  CONSENT_STATUS,
  CONTACT_RECENCY,
  CONVERSAO_STATUS,
  CONVERSATION_STATUS,
  FUNNEL_STAGE,
  IA_AGENDA_STATUS,
  LEITURA_META_STATUS,
  MENSAGEM_AGENDADA_STATUS,
  PATIENT_TAG,
  RECORD_STATUS,
  REGUA_STATUS,
  TOKEN_META_STATUS,
  WHATSAPP_CONNECTION_STATUS,
  type StatusDefinition,
} from "@/lib/design/status";
import type {
  ClinicaNoPainel,
  RegistroDoRequisito,
  RequisitoConferido,
} from "@/lib/queries/painel-geral";

// Regras puras do Painel geral (onda 1): os status em 3 camadas sem
// repetir icone em outra cor, o gasto contra o teto, os formatos (dolar e
// data no fuso da clinica), a busca e os filtros da URL, as entradas das
// Server Actions (Zod) e a leitura do teto digitado. Nenhum texto com
// travessao nem jargao.

const ID_A = "a1111111-1111-4111-8111-111111111111";
const ID_B = "b2222222-2222-4222-8222-222222222222";
const ID_C = "c3333333-3333-4333-8333-333333333333";

function clinica(campos: Partial<ClinicaNoPainel> = {}): ClinicaNoPainel {
  return {
    id: ID_A,
    nome: "Clínica Aurora",
    criadaEm: "2026-09-01T12:00:00.000Z",
    fuso: "America/Fortaleza",
    membrosAtivos: 3,
    membrosPendentes: 0,
    administradores: [{ nome: "Ana Souza", email: "ana@aurora.com.br" }],
    numerosTotal: 2,
    numerosConectados: 1,
    numeros: [],
    contatos: 120,
    leads30Dias: 14,
    conversas30Dias: 40,
    ultimaMensagemEm: "2026-10-20T13:00:00.000Z",
    suspensao: null,
    agente: {
      estado: "desligado",
      modo: null,
      liberada: false,
      pausadaPelaClinica: false,
      telefonesLigados: 0,
    },
    gasto: {
      ultimas24hCentavos: 0,
      mesCentavos: 0,
      ultimas24hSemSimuladorCentavos: 0,
      mesSemSimuladorCentavos: 0,
    },
    tetoDiarioCentavos: null,
    ...campos,
  };
}

/** Todos os mapas de status do produto, com os do painel. */
const MAPAS_DO_PRODUTO: StatusDefinition[] = [
  ...Object.values(APPOINTMENT_STATUS),
  ...Object.values(CONVERSATION_STATUS),
  ...Object.values(FUNNEL_STAGE),
  ...Object.values(CONTACT_RECENCY),
  ...Object.values(PATIENT_TAG),
  ...Object.values(APPOINTMENT_FLAG),
  ...Object.values(RECORD_STATUS),
  ...Object.values(REGUA_STATUS),
  ...Object.values(WHATSAPP_CONNECTION_STATUS),
  ...Object.values(ACCESS_LEVEL_STATUS),
  ...Object.values(IA_AGENDA_STATUS),
  ...Object.values(CONVERSAO_STATUS),
  ...Object.values(TOKEN_META_STATUS),
  ...Object.values(LEITURA_META_STATUS),
  ...Object.values(CONSENT_STATUS),
  ...Object.values(ATIVIDADE_STATUS),
  ...Object.values(MENSAGEM_AGENDADA_STATUS),
  ...Object.values(IA_NA_CLINICA_STATUS),
  ...Object.values(LIGADO_DESLIGADO_STATUS),
  ...Object.values(TELEFONE_DA_EQUIPE_STATUS),
  ...Object.values(NUMERO_DO_ASSISTENTE_STATUS),
];

const MAPAS_DO_PAINEL = {
  SITUACAO_DA_CONTA_STATUS,
  AGENTE_DA_CLINICA_STATUS,
  GASTO_STATUS,
  REQUISITO_STATUS,
};

const DO_PAINEL: StatusDefinition[] = Object.values(MAPAS_DO_PAINEL).flatMap(
  (mapa) => Object.values(mapa),
);

describe("status do painel em 3 camadas", () => {
  it.each(Object.entries(MAPAS_DO_PAINEL))(
    "%s: ícone, rótulo e tom em toda chave, sem ícone repetido no mapa",
    (_nome, mapa) => {
      const definicoes: StatusDefinition[] = Object.values(mapa);
      for (const definicao of definicoes) {
        expect(definicao.icon).not.toBeNull();
        expect(definicao.label.length).toBeGreaterThan(2);
      }
      const icones = definicoes.map((definicao) => definicao.icon);
      expect(new Set(icones).size).toBe(icones.length);
    },
  );

  it("conta: Ativa é sucesso com CircleCheck; Suspensa é alerta com OctagonPause", () => {
    expect(SITUACAO_DA_CONTA_STATUS.ativa).toEqual({
      label: "Ativa",
      tone: "success",
      icon: CircleCheck,
    });
    expect(SITUACAO_DA_CONTA_STATUS.suspensa).toEqual({
      label: "Suspensa",
      tone: "alert",
      icon: OctagonPause,
    });
  });

  it("agente: Desligado e Teste com os mesmos pares da aba de Configurações", () => {
    expect(AGENTE_DA_CLINICA_STATUS.desligado).toMatchObject({
      tone: "neutral",
      icon: CirclePause,
    });
    expect(AGENTE_DA_CLINICA_STATUS.teste).toMatchObject({
      label: "Teste",
      tone: "info",
      icon: FlaskConical,
    });
    expect(IA_NA_CLINICA_STATUS.simulador.icon).toBe(FlaskConical);
    expect(IA_NA_CLINICA_STATUS.simulador.tone).toBe("info");
    // Onda 2: a producao, o mesmo par do "Atendendo os contatos" da Tela 6
    expect(AGENTE_DA_CLINICA_STATUS.producao).toEqual({
      label: "Produção",
      tone: "success",
      icon: RadioTower,
    });
    expect(IA_NA_CLINICA_STATUS.producao.icon).toBe(RadioTower);
  });

  it("requisito: Cumprido, Falta e Revogado; o CircleX fica só com o Cancelado pelo paciente", () => {
    expect(REQUISITO_STATUS).toEqual({
      cumprido: { label: "Cumprido", tone: "success", icon: CircleCheck },
      falta: { label: "Falta", tone: "neutral", icon: CircleDashed },
      revogado: { label: "Revogado", tone: "alert", icon: BadgeX },
    });
    const comX = [...MAPAS_DO_PRODUTO, ...DO_PAINEL].filter(
      (definicao) => definicao.icon === CircleX,
    );
    expect(comX).toEqual([APPOINTMENT_STATUS.cancelado_paciente]);
  });

  it("gasto: perto do teto é atenção (CircleAlert) e teto atingido é pendência (Hourglass)", () => {
    expect(GASTO_STATUS.perto).toMatchObject({
      tone: "warning",
      icon: CircleAlert,
    });
    expect(GASTO_STATUS.atingido).toMatchObject({
      tone: "warning",
      icon: Hourglass,
    });
  });

  it("nenhum ícone do painel aparece em outro tom em nenhum mapa do produto", () => {
    const tonsPorIcone = new Map<unknown, Set<string>>();
    for (const definicao of [...MAPAS_DO_PRODUTO, ...DO_PAINEL]) {
      if (definicao.icon === null) {
        continue;
      }
      const tons = tonsPorIcone.get(definicao.icon) ?? new Set<string>();
      tons.add(definicao.tone);
      tonsPorIcone.set(definicao.icon, tons);
    }
    for (const definicao of DO_PAINEL) {
      expect(
        [...(tonsPorIcone.get(definicao.icon) ?? [])],
        definicao.label,
      ).toEqual([definicao.tone]);
    }
  });

  it("OctagonPause é só da conta suspensa; o TriangleAlert (Faltou) não aparece", () => {
    const comPausa = [...MAPAS_DO_PRODUTO, ...DO_PAINEL].filter(
      (definicao) => definicao.icon === OctagonPause,
    );
    expect(comPausa).toEqual([SITUACAO_DA_CONTA_STATUS.suspensa]);
    expect(DO_PAINEL.some((d) => d.icon === TriangleAlert)).toBe(false);
  });
});

describe("gasto contra o teto", () => {
  it("sem teto, dentro, perto (80%) e atingido", () => {
    expect(estadoDoGasto(300, null)).toBe("sem_teto");
    expect(estadoDoGasto(0, 500)).toBe("dentro");
    expect(estadoDoGasto(399, 500)).toBe("dentro");
    expect(estadoDoGasto(400, 500)).toBe("perto");
    expect(estadoDoGasto(499, 500)).toBe("perto");
    expect(estadoDoGasto(500, 500)).toBe("atingido");
    expect(estadoDoGasto(720, 500)).toBe("atingido");
  });

  it("teto zero: qualquer gasto, mesmo nenhum, já é o teto", () => {
    expect(estadoDoGasto(0, 0)).toBe("atingido");
  });
});

describe("formatos", () => {
  it("dólares com duas casas, no jeito brasileiro", () => {
    expect(dolares(0)).toBe("US$ 0,00");
    expect(dolares(5)).toBe("US$ 0,05");
    expect(dolares(500)).toBe("US$ 5,00");
    expect(dolares(123456)).toBe("US$ 1.234,56");
    expect(dolaresParaCampo(500)).toBe("5,00");
    expect(dolaresParaCampo(1)).toBe("0,01");
  });

  it("quando, no relógio e no calendário da clínica", () => {
    const agora = new Date("2026-10-20T15:00:00.000Z"); // 12:00 em Fortaleza
    const fuso = "America/Fortaleza";
    expect(quandoNaClinica("2026-10-20T13:05:00.000Z", fuso, agora)).toBe(
      "Hoje, 10:05",
    );
    expect(quandoNaClinica("2026-10-19T23:30:00.000Z", fuso, agora)).toBe(
      "Ontem, 20:30",
    );
    // 02:30 UTC do dia 20 ainda e o dia 19 em Fortaleza (23:30).
    expect(quandoNaClinica("2026-10-20T02:30:00.000Z", fuso, agora)).toBe(
      "Ontem, 23:30",
    );
    expect(quandoNaClinica("2026-09-02T12:00:00.000Z", fuso, agora)).toBe(
      "02/09",
    );
    expect(quandoNaClinica("2025-12-31T12:00:00.000Z", fuso, agora)).toBe(
      "31/12/2025",
    );
  });

  it("números conectados de quantos", () => {
    expect(textoDosNumeros(clinica())).toBe("1 de 2");
    expect(
      textoDosNumeros(clinica({ numerosTotal: 0, numerosConectados: 0 })),
    ).toBe("Nenhum número");
    expect(nenhumNumeroConectado(clinica({ numerosConectados: 0 }))).toBe(true);
    expect(
      nenhumNumeroConectado(clinica({ numerosTotal: 0, numerosConectados: 0 })),
    ).toBe(false);
    expect(nenhumNumeroConectado(clinica())).toBe(false);
  });

  it("apoio do agente: só com o agente em teste, pela escolha da clínica", () => {
    expect(apoioDoAgente(clinica())).toBeNull();
    const emTeste = (agente: Partial<ClinicaNoPainel["agente"]>) =>
      clinica({
        agente: {
          estado: "teste",
          modo: "contatos",
          liberada: true,
          pausadaPelaClinica: false,
          telefonesLigados: 1,
          ...agente,
        },
      });
    expect(apoioDoAgente(emTeste({}))).toBe("Conversa com a equipe");
    expect(apoioDoAgente(emTeste({ modo: "simulador" }))).toBe("Só simulador");
    expect(apoioDoAgente(emTeste({ liberada: false }))).toBe(
      "Desligado pela clínica",
    );
    expect(apoioDoAgente(emTeste({ pausadaPelaClinica: true }))).toBe(
      "Pausado pela clínica",
    );
  });
});

describe("busca e filtros", () => {
  const lista = [
    clinica({ id: ID_A, nome: "Clínica Zélia" }),
    clinica({
      id: ID_B,
      nome: "Odonto Árvore",
      suspensao: {
        suspensaEm: "2026-10-10T12:00:00.000Z",
        motivo: "Pagamento atrasado",
      },
      administradores: [{ nome: "João Prado", email: "joao@arvore.com" }],
    }),
    clinica({
      id: ID_C,
      nome: "Estética Bela",
      agente: {
        estado: "teste",
        modo: "contatos",
        liberada: true,
        pausadaPelaClinica: false,
        telefonesLigados: 2,
      },
    }),
  ];

  it("lê os filtros da URL; valor desconhecido vira o padrão", () => {
    const params = (valores: Record<string, string>) =>
      new URLSearchParams(valores);
    expect(lerFiltrosDoPainel(params({}))).toEqual(FILTROS_PADRAO);
    expect(
      lerFiltrosDoPainel(
        params({ busca: "aurora", situacao: "suspensa", agente: "teste" }),
      ),
    ).toEqual({ busca: "aurora", situacao: "suspensa", agente: "teste" });
    // Onda 2: o agente em producao e filtro de verdade
    expect(lerFiltrosDoPainel(params({ agente: "producao" })).agente).toBe(
      "producao",
    );
    expect(
      lerFiltrosDoPainel(params({ situacao: "apagada", agente: "ligado" })),
    ).toEqual(FILTROS_PADRAO);
    expect(
      lerFiltrosDoPainel(params({ busca: "x".repeat(200) })).busca,
    ).toHaveLength(80);
  });

  it("sem filtro: todas, pelo nome", () => {
    expect(filtrarClinicas(lista, FILTROS_PADRAO).map((c) => c.nome)).toEqual([
      "Clínica Zélia",
      "Estética Bela",
      "Odonto Árvore",
    ]);
    expect(filtrosAtivos(FILTROS_PADRAO)).toBe(false);
  });

  it("situação e agente pelo valor exato", () => {
    expect(
      filtrarClinicas(lista, { ...FILTROS_PADRAO, situacao: "suspensa" }).map(
        (c) => c.id,
      ),
    ).toEqual([ID_B]);
    expect(
      filtrarClinicas(lista, { ...FILTROS_PADRAO, situacao: "ativa" }).map(
        (c) => c.id,
      ),
    ).toEqual([ID_A, ID_C]);
    expect(
      filtrarClinicas(lista, { ...FILTROS_PADRAO, agente: "teste" }).map(
        (c) => c.id,
      ),
    ).toEqual([ID_C]);
    expect(situacaoDaConta(lista[1] as ClinicaNoPainel)).toBe("suspensa");
  });

  it("a busca ignora acento e maiúscula e olha o administrador", () => {
    const busca = (termo: string) =>
      filtrarClinicas(lista, { ...FILTROS_PADRAO, busca: termo }).map(
        (c) => c.id,
      );
    expect(busca("arvore")).toEqual([ID_B]);
    expect(busca("ZELIA")).toEqual([ID_A]);
    expect(busca("joao@")).toEqual([ID_B]);
    expect(busca("prado")).toEqual([ID_B]);
    expect(busca("ninguém")).toEqual([]);
    expect(normalizarBusca("  Éstética ")).toBe("estetica");
    expect(filtrosAtivos({ ...FILTROS_PADRAO, busca: "  " })).toBe(false);
  });
});

describe("entradas das ações", () => {
  it("motivo de 3 a 300 letras depois do trim, entrada estrita", () => {
    expect(motivoValido("ok")).toBe(false);
    expect(motivoValido("  ok  ")).toBe(false);
    expect(motivoValido("ok!")).toBe(true);
    expect(motivoValido("x".repeat(300))).toBe(true);
    expect(motivoValido("x".repeat(301))).toBe(false);
    expect(
      contaDaClinicaSchema.safeParse({ clinicId: ID_A, motivo: "Atraso" })
        .success,
    ).toBe(true);
    expect(
      contaDaClinicaSchema.safeParse({
        clinicId: ID_A,
        motivo: "Atraso",
        extra: 1,
      }).success,
    ).toBe(false);
    expect(
      contaDaClinicaSchema.safeParse({ clinicId: "x", motivo: "Atraso" })
        .success,
    ).toBe(false);
  });

  it("agente: desligado, teste ou produção; a produção com motivo obrigatório (onda 2)", () => {
    for (const estado of ["desligado", "teste"]) {
      expect(
        agenteDaClinicaSchema.safeParse({ clinicId: ID_A, estado }).success,
      ).toBe(true);
    }
    const producao = (motivo?: string) =>
      agenteDaClinicaSchema.safeParse({
        clinicId: ID_A,
        estado: "producao",
        ...(motivo === undefined ? {} : { motivo }),
      });
    expect(producao().success).toBe(false);
    expect(producao("  ab  ").success).toBe(false);
    expect(producao().error?.issues[0]?.message).toBe(
      TEXTOS_DO_PAINEL.motivoCurto,
    );
    expect(producao("Requisitos conferidos").success).toBe(true);
    expect(producao("x".repeat(301)).success).toBe(false);
    expect(
      agenteDaClinicaSchema.safeParse({ clinicId: ID_A, estado: "ligado" })
        .success,
    ).toBe(false);
    expect(OPCOES_DO_ESTADO_DO_AGENTE.map((o) => o.label)).toEqual([
      "Desligado",
      "Teste",
      "Produção",
    ]);
  });

  it("teto: 1 a 100.000 centavos (o check do banco) e 1 a 200 respostas, inteiros", () => {
    const teto = (
      tetoDiarioCentavos: number,
      respostasPorConversaHora: number,
    ) =>
      tetoDaIaSchema.safeParse({
        clinicId: ID_A,
        tetoDiarioCentavos,
        respostasPorConversaHora,
      }).success;
    expect(teto(1, 1)).toBe(true);
    expect(teto(100_000, 200)).toBe(true);
    expect(teto(0, 20)).toBe(false);
    expect(teto(100_001, 20)).toBe(false);
    expect(teto(-1, 20)).toBe(false);
    expect(teto(500, 0)).toBe(false);
    expect(teto(500, 201)).toBe(false);
    expect(teto(500.5, 20)).toBe(false);
    expect(teto(500, 2.5)).toBe(false);
  });

  it("lê o teto digitado em dólares como as outras telas leem reais", () => {
    expect(lerTetoEmDolares("5,00")).toBe(500);
    expect(lerTetoEmDolares("5.5")).toBe(550);
    expect(lerTetoEmDolares("12")).toBe(1200);
    expect(lerTetoEmDolares("US$ 7,25")).toBe(725);
    expect(lerTetoEmDolares("1.000,00")).toBe(100_000);
    expect(lerTetoEmDolares("0,01")).toBe(1);
    // Para zerar o gasto, o agente desligado: o banco nao aceita teto zero.
    expect(lerTetoEmDolares("0")).toBeNull();
    expect(lerTetoEmDolares("0,00")).toBeNull();
    expect(lerTetoEmDolares("1.000,01")).toBeNull();
    expect(lerTetoEmDolares("")).toBeNull();
    expect(lerTetoEmDolares("cinco")).toBeNull();
    expect(lerTetoEmDolares("-5")).toBeNull();
  });

  it("lê as respostas por hora: inteiro de 1 a 200", () => {
    expect(lerRespostasPorHora("20")).toBe(20);
    expect(lerRespostasPorHora(" 1 ")).toBe(1);
    expect(lerRespostasPorHora("200")).toBe(200);
    expect(lerRespostasPorHora("0")).toBeNull();
    expect(lerRespostasPorHora("201")).toBeNull();
    expect(lerRespostasPorHora("2,5")).toBeNull();
    expect(lerRespostasPorHora("")).toBeNull();
  });
});

describe("textos do painel", () => {
  // As funcoes de texto entram com um exemplo.
  const todos = Object.values(TEXTOS_DO_PAINEL).flatMap((valor) =>
    Array.isArray(valor)
      ? valor
      : typeof valor === "function"
        ? [(valor as (...args: string[]) => string)("exemplo", "exemplo")]
        : [valor],
  ) as string[];

  it("sem travessão e sem jargão de programador", () => {
    for (const texto of todos) {
      expect(texto, texto).not.toMatch(/[—–]/);
      expect(texto, texto).not.toMatch(
        /\b(tenant|opt-in|handoff|kill switch|jobs?|RPC|super admin)\b/i,
      );
    }
  });

  it("a dica da produção diz os pré-requisitos da onda 2", () => {
    const dica = TEXTOS_DO_PAINEL.dicaDaProducao;
    expect(dica).toContain("conversão só depois da aprovação");
    expect(dica).toContain("leads, pacientes ou os dois");
    expect(dica).toContain("CFM");
    expect(dica).toContain("contrato com a OpenAI");
    expect(dica).toContain("assistente virtual");
  });

  it("os efeitos da suspensão dizem o que para e o que fica", () => {
    const efeitos = TEXTOS_DO_PAINEL.efeitoDaSuspensao.join(" ");
    expect(efeitos).toContain("Conta suspensa");
    expect(efeitos).toContain("param de enviar");
    expect(efeitos).toContain("continuam chegando");
    expect(efeitos).toContain("Nenhum dado é apagado");
  });
});

// ---------------------------------------------------------------------------
// Onda 2 (item 11): a produção e os requisitos
// ---------------------------------------------------------------------------

describe("onda 2: apoio do agente na lista", () => {
  it("em produção: Atendendo os contatos; a pausa e o desligar da clínica valem também", () => {
    const emProducao = (campos: Partial<ClinicaNoPainel["agente"]> = {}) =>
      clinica({
        agente: {
          estado: "producao",
          modo: "numero_inteiro",
          liberada: true,
          pausadaPelaClinica: false,
          telefonesLigados: 1,
          ...campos,
        },
      });
    expect(apoioDoAgente(emProducao())).toBe("Atendendo os contatos");
    expect(apoioDoAgente(emProducao({ pausadaPelaClinica: true }))).toBe(
      "Pausado pela clínica",
    );
    expect(apoioDoAgente(emProducao({ liberada: false }))).toBe(
      "Desligado pela clínica",
    );
    expect(apoioDoAgente(clinica())).toBeNull();
  });
});

describe("onda 2: requisitos da produção", () => {
  const REGISTRO = "e1111111-1111-4111-8111-111111111111";
  const OUTRO_REGISTRO = "e2222222-2222-4222-8222-222222222222";

  const NADA_CONFERIDO: RequisitoConferido["conferido"] = {
    estado: null,
    versao: null,
    publico: null,
    modo: null,
    conectados: null,
  };

  /** Um requisito como lerRequisitosDoBanco devolve. */
  function conferido(
    chave: string,
    ok: boolean,
    campos: Partial<Omit<RequisitoConferido, "chave" | "ok">> = {},
  ): RequisitoConferido {
    return {
      chave,
      ok,
      origem: "banco",
      registro: null,
      conferido: NADA_CONFERIDO,
      ...campos,
    };
  }

  function registro(
    campos: Partial<RegistroDoRequisito> = {},
  ): RegistroDoRequisito {
    return {
      id: REGISTRO,
      revogado: false,
      evidencia: "Rodada de 21/10. Filtro regras-1 portao-2, modelo gpt-6-luna",
      registradoEm: "2026-10-21T12:00:00.000Z",
      geral: true,
      revogadoEm: null,
      motivoDaRevogacao: null,
      ...campos,
    };
  }

  const revogadoDoBanco = registro({
    id: OUTRO_REGISTRO,
    revogado: true,
    evidencia: null,
    registradoEm: null,
    geral: null,
    revogadoEm: "2026-10-21T15:00:00.000Z",
    motivoDaRevogacao: "Contrato vencido",
  });

  it("as linhas: cumprido pelo ok do banco; revogado com o último revogado e sem vivo; falta no resto", () => {
    const linhas = linhasDosRequisitos({
      estado: "lido",
      conferidos: [
        conferido("versao_publicada", true, {
          conferido: { ...NADA_CONFERIDO, versao: 3 },
        }),
        conferido("rodada_cfm", false, {
          origem: "equipe",
          registro: revogadoDoBanco,
        }),
        conferido("contrato_openai", false, { origem: "equipe" }),
        conferido("termo_da_clinica", true, {
          origem: "equipe",
          registro: registro({ geral: false }),
        }),
      ],
    });
    expect(linhas.map((linha) => [linha.chave, linha.estado])).toEqual([
      ["versao_publicada", "cumprido"],
      ["rodada_cfm", "revogado"],
      ["contrato_openai", "falta"],
      ["termo_da_clinica", "cumprido"],
    ]);
    expect(linhas.map((linha) => linha.daEquipe)).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(linhas[3]?.vivo?.id).toBe(REGISTRO);
    expect(linhas[3]?.revogado).toBeNull();
    expect(linhas[1]?.vivo).toBeNull();
    expect(linhas[1]?.revogado?.motivoDaRevogacao).toBe("Contrato vencido");
    expect(linhas[0]?.detalhe).toBe("Versão 3 publicada.");
    expect(linhas[2]?.detalhe).toBeNull();
  });

  it("as linhas: só registra quem é da equipe pelo banco E pela tela; ok que não é verdadeiro é falta", () => {
    const linhas = linhasDosRequisitos({
      estado: "lido",
      conferidos: [
        // o banco diz equipe, a tela nao conhece a chave: sem Registrar
        conferido("chave_nova", false, { origem: "equipe" }),
        // chave da equipe que o banco diz conferir: sem Registrar
        conferido("rodada_cfm", false),
      ],
    });
    expect(linhas.map((linha) => linha.daEquipe)).toEqual([false, false]);
    expect(linhas.map((linha) => linha.estado)).toEqual(["falta", "falta"]);
    expect(linhas[0]?.rotulo).toBe("Outro requisito do banco");
  });

  it("o detalhe do que o banco conferiu, em texto de recepção", () => {
    const viu = (chave: string, campos: Partial<typeof NADA_CONFERIDO>) =>
      detalheDoRequisito(
        conferido(chave, false, {
          conferido: { ...NADA_CONFERIDO, ...campos },
        }),
      );
    expect(viu("agente_em_teste", { estado: "desligado" })).toBe(
      "Agora: Desligado.",
    );
    expect(viu("agente_em_teste", { estado: "teste" })).toBe("Agora: Teste.");
    expect(viu("agente_em_teste", { estado: "constructor" })).toBeNull();
    expect(viu("versao_publicada", { versao: 4 })).toBe("Versão 4 publicada.");
    expect(viu("versao_publicada", {})).toBe("Nenhuma versão publicada ainda.");
    expect(viu("publico_escolhido", { publico: "leads" })).toBe("Só leads.");
    expect(viu("publico_escolhido", { publico: "todos" })).toBe(
      "Leads e pacientes.",
    );
    expect(viu("publico_escolhido", {})).toBe(
      "Ainda não escolhido na versão publicada.",
    );
    expect(viu("horario_suportado", { modo: "fallback" })).toBe(
      "Se a equipe não responder.",
    );
    expect(viu("horario_suportado", { modo: "24h" })).toBe("24 horas.");
    expect(viu("horario_suportado", { modo: "toString" })).toBeNull();
    expect(viu("numero_conectado", { conectados: 0 })).toBe(
      "Nenhum número ligado e conectado.",
    );
    expect(viu("numero_conectado", { conectados: 3 })).toBe(
      "3 números ligados e conectados.",
    );
    expect(viu("numero_conectado", { conectados: 1 })).toBe(
      "1 número ligado e conectado.",
    );
    expect(viu("numero_conectado", {})).toBeNull();
    expect(viu("conta_ativa", {})).toBeNull();
    expect(viu("rodada_cfm", {})).toBeNull();
  });

  it("a produção só libera com todos cumpridos (falha fechada)", () => {
    const lido = (oks: boolean[]) => ({
      estado: "lido" as const,
      conferidos: oks.map((ok, indice) => conferido(`chave_${indice}`, ok)),
    });
    expect(producaoLiberada(lido([true, true]))).toBe(true);
    expect(producaoLiberada(lido([true, false]))).toBe(false);
    expect(producaoLiberada(lido([]))).toBe(false);
    expect(producaoLiberada({ estado: "indisponivel" })).toBe(false);
    expect(producaoLiberada("erro")).toBe(false);
  });

  it("o público da versão publicada vem do requisito publico_escolhido", () => {
    expect(
      publicoDosRequisitos({
        estado: "lido",
        conferidos: [
          conferido("publico_escolhido", true, {
            conferido: { ...NADA_CONFERIDO, publico: "pacientes" },
          }),
        ],
      }),
    ).toBe("pacientes");
    expect(
      publicoDosRequisitos({
        estado: "lido",
        conferidos: [conferido("publico_escolhido", false)],
      }),
    ).toBeNull();
    expect(publicoDosRequisitos({ estado: "lido", conferidos: [] })).toBeNull();
    expect(publicoDosRequisitos({ estado: "indisponivel" })).toBeNull();
    expect(publicoDosRequisitos("erro")).toBeNull();
  });

  it("P11e: a rodada registrada fala de outra versão do filtro ou do modelo: avisa", () => {
    const linhas = linhasDosRequisitos({
      estado: "lido",
      conferidos: [
        conferido("rodada_cfm", true, {
          origem: "equipe",
          registro: registro(),
        }),
      ],
    });
    expect(
      versaoMudouDepoisDaRodada(linhas, {
        filtro: "regras-1 portao-2",
        modelo: "gpt-6-luna",
      }),
    ).toBe(false);
    expect(
      versaoMudouDepoisDaRodada(linhas, {
        filtro: "regras-9 portao-2",
        modelo: "gpt-6-luna",
      }),
    ).toBe(true);
    expect(
      versaoMudouDepoisDaRodada(linhas, {
        filtro: "regras-1 portao-2",
        modelo: "gpt-6.1-sol",
      }),
    ).toBe(true);
    // sem versoes, sem a rodada viva (so a revogada) ou sem linhas: nada a avisar
    expect(versaoMudouDepoisDaRodada(linhas, null)).toBe(false);
    expect(
      versaoMudouDepoisDaRodada(
        linhasDosRequisitos({
          estado: "lido",
          conferidos: [
            conferido("rodada_cfm", false, {
              origem: "equipe",
              registro: revogadoDoBanco,
            }),
          ],
        }),
        { filtro: "x", modelo: "y" },
      ),
    ).toBe(false);
    expect(versaoMudouDepoisDaRodada([], { filtro: "x", modelo: "y" })).toBe(
      false,
    );
  });

  it("os da equipe Conduzza: o termo é por clínica; os outros valem para todas (P11d)", () => {
    expect([...REQUISITOS_DA_EQUIPE]).toEqual([
      "rodada_cfm",
      "contrato_openai",
      "aviso_assistente_virtual",
      "termo_da_clinica",
      "transcricao_com_nossa_chave",
    ]);
    expect(ESCOPO_DO_REQUISITO.termo_da_clinica).toBe("clinica");
    expect(ESCOPO_DO_REQUISITO.rodada_cfm).toBe("todas");
    expect(ESCOPO_DO_REQUISITO.transcricao_com_nossa_chave).toBe("todas");
  });

  // Revisao da onda 2: revogar o termo de uma clinica em producao a tira
  // da producao na hora (o banco volta para Teste); a confirmacao dessa
  // acao perigosa diz o efeito real.
  it("o efeito de revogar: o que vale para todas, o da clínica em produção e o da clínica fora dela", () => {
    expect(efeitoDeRevogar({ valeParaTodas: true, emProducao: false })).toBe(
      TEXTOS_DO_PAINEL.revogarTodasEfeito,
    );
    expect(efeitoDeRevogar({ valeParaTodas: true, emProducao: true })).toBe(
      TEXTOS_DO_PAINEL.revogarTodasEfeito,
    );
    expect(efeitoDeRevogar({ valeParaTodas: false, emProducao: false })).toBe(
      "Sem este requisito, a produção não liga nesta clínica.",
    );
    const emProducao = efeitoDeRevogar({ valeParaTodas: false, emProducao: true });
    expect(emProducao).toBe(TEXTOS_DO_PAINEL.revogarDaClinicaEmProducaoEfeito);
    expect(emProducao).toContain("volta para Teste na hora");
    expect(emProducao).toContain("sem mensagem ao paciente");
    expect(emProducao).not.toMatch(/[–—]/);
  });

  it("os nomes dos requisitos; chave desconhecida (ou do protótipo) vira um nome neutro", () => {
    expect(rotuloDoRequisito("rodada_cfm")).toBe(
      "Rodada paga de conferência do CFM",
    );
    expect(rotuloDoRequisito("chave_nova")).toBe("Outro requisito do banco");
    expect(rotuloDoRequisito("constructor")).toBe("Outro requisito do banco");
  });

  it("o hint de requisitos_pendentes vira a lista em nomes", () => {
    expect(requisitosDoHint("rodada_cfm, publico_escolhido")).toEqual([
      "Rodada paga de conferência do CFM",
      "Público escolhido em Regras e limites",
    ]);
    expect(requisitosDoHint("constructor toString")).toBeNull();
    expect(requisitosDoHint(null)).toBeNull();
    expect(requisitosDoHint("")).toBeNull();
  });

  it("o público no diálogo da produção", () => {
    expect(publicoNoDialogo("leads")).toBe("aos leads");
    expect(publicoNoDialogo("pacientes")).toBe("aos pacientes");
    expect(publicoNoDialogo("todos")).toBe("aos leads e aos pacientes");
    expect(publicoNoDialogo(null)).toBeNull();
    expect(publicoNoDialogo("outro")).toBeNull();
    expect(TEXTOS_DO_PAINEL.efeitoDaProducao("aos leads")).toBe(
      "O assistente passa a responder aos leads que escreverem para os números ligados. Os telefones da equipe continuam valendo.",
    );
  });

  it("registrar e revogar: entradas estritas, evidência de 3 a 500 e motivo de 3 a 300", () => {
    expect(evidenciaValida("ab")).toBe(false);
    expect(evidenciaValida(" abc ")).toBe(true);
    expect(evidenciaValida("x".repeat(501))).toBe(false);
    expect(
      registrarRequisitoSchema.safeParse({
        clinicId: ID_A,
        chave: "rodada_cfm",
        evidencia: "Rodada de 21/10",
      }).success,
    ).toBe(true);
    // so as chaves da equipe; as do banco nao se registram
    expect(
      registrarRequisitoSchema.safeParse({
        clinicId: ID_A,
        chave: "versao_publicada",
        evidencia: "Rodada de 21/10",
      }).success,
    ).toBe(false);
    expect(
      revogarRequisitoSchema.safeParse({
        clinicId: ID_A,
        id: REGISTRO,
        motivo: "ok",
      }).success,
    ).toBe(false);
    expect(
      revogarRequisitoSchema.safeParse({
        clinicId: ID_A,
        id: REGISTRO,
        motivo: "Contrato vencido",
        extra: 1,
      }).success,
    ).toBe(false);
  });
});
