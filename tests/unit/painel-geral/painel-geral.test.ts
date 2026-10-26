import {
  BadgeX,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleSlash,
  CircleX,
  FlaskConical,
  Hourglass,
  OctagonAlert,
  OctagonPause,
  PhoneOff,
  RadioTower,
  Siren,
  Sprout,
  TriangleAlert,
  Watch,
  WifiOff,
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
  contagemDaEquipe,
  efeitoDeRevogar,
  estadoDaConfirmacao,
  haQuantoTempo,
  liberacaoDoAgente,
  nomeDaPessoa,
  OPCOES_DA_CONTA,
  OPCOES_DO_AGENTE,
  OPCOES_DO_USO,
  ordemDoPainel,
  papelDaPessoa,
  porQueNaoLibera,
  quemEntrou,
  quemEntrouNaLista,
  ROTULO_DA_LIBERACAO,
  SITUACAO_DO_MEMBRO_STATUS,
  USO_DA_CLINICA_STATUS,
  usoDaClinica,
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
  PASSO_STATUS,
  quandoNaClinica,
  SAUDE_STATUS,
  SINAL_STATUS,
  SITUACAO_DA_CONTA_STATUS,
  situacaoDaConta,
  TETO_DE_IA_ATINGIDO_STATUS,
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

// Regras puras do Painel geral (onda 1; desde 26/10/2026, o acompanhamento
// de cliente): os status em 3 camadas sem repetir icone em outra cor (o uso
// da clinica, a pessoa da equipe e o agente com o rotulo da liberacao), o
// gasto contra o teto, os formatos (dolar, data e "Há N dias" no fuso da
// clinica, quem entrou), a busca e os filtros da URL (uso, conta e agente,
// e a ordem pelo ultimo acesso), o dialogo do agente (liberar e retirar),
// as entradas das Server Actions (Zod) e a leitura do teto digitado. Nenhum
// texto com travessao nem jargao.

const ID_A = "a1111111-1111-4111-8111-111111111111";
const ID_B = "b2222222-2222-4222-8222-222222222222";
const ID_C = "c3333333-3333-4333-8333-333333333333";
const PESSOA = "d4444444-4444-4444-8444-444444444444";

function clinica(campos: Partial<ClinicaNoPainel> = {}): ClinicaNoPainel {
  return {
    id: ID_A,
    nome: "Clínica Aurora",
    criadaEm: "2026-09-01T12:00:00.000Z",
    fuso: "America/Fortaleza",
    emUso: true,
    ultimoAcesso: {
      em: "2026-10-20T13:00:00.000Z",
      userId: PESSOA,
      nome: "Ana Souza",
      email: "ana@aurora.com.br",
      papel: "admin",
      implementador: false,
      equipeConduzza: false,
    },
    membrosAtivos: 3,
    membrosPendentes: 0,
    membrosEquipeConduzza: 0,
    pessoas: [{ nome: "Ana Souza", email: "ana@aurora.com.br" }],
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
      ultimas24hMicrodolares: 0,
      mesMicrodolares: 0,
      ultimas24hSemSimuladorMicrodolares: 0,
      mesSemSimuladorMicrodolares: 0,
      ultimas24hChamadas: 0,
      mesChamadas: 0,
      ultimas24hSemSimuladorChamadas: 0,
      mesSemSimuladorChamadas: 0,
    },
    tetoDiarioCentavos: null,
    saude: "saudavel",
    sinais: [],
    implantacao: implantacao(),
    tendencia: {
      leads: {
        atual: 14,
        anterior: 10,
        variacaoPercentual: 40,
        direcao: "subindo",
      },
      conversas: {
        atual: 40,
        anterior: 41,
        variacaoPercentual: -2,
        direcao: "estavel",
      },
    },
    ultimaNotaEm: null,
    ...campos,
  };
}

/** Os seis passos do banco: os feitos nas posicoes pedidas. */
function implantacao(
  feitos: readonly boolean[] = [true, true, false, false, false, false],
): ClinicaNoPainel["implantacao"] {
  const chaves = [
    "whatsapp_conectado",
    "equipe_com_duas_pessoas",
    "procedimentos_cadastrados",
    "profissionais_cadastrados",
    "regua_de_confirmacao_ligada",
    "anuncios_conectados",
  ] as const;
  const passos = chaves.map((chave, indice) => ({
    chave,
    feito: feitos[indice] ?? false,
    quantidade: feitos[indice] ? 1 : 0,
  }));
  return {
    feitos: passos.filter((passo) => passo.feito).length,
    total: passos.length,
    passos,
    anuncios: { meta: false, google: false },
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
  USO_DA_CLINICA_STATUS,
  SITUACAO_DO_MEMBRO_STATUS,
  // Segunda leva (26/10/2026)
  SINAL_STATUS,
  SAUDE_STATUS,
  PASSO_STATUS,
  // Terceira leva (26/10/2026): a variante do sinal do teto a partir de 100%
  TETO_DE_IA_ATINGIDO: { atingido: TETO_DE_IA_ATINGIDO_STATUS },
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

  it("OctagonPause é só da conta suspensa (o chip da conta e o sinal Conta suspensa); o TriangleAlert (Faltou) não aparece", () => {
    const comPausa = [...MAPAS_DO_PRODUTO, ...DO_PAINEL].filter(
      (definicao) => definicao.icon === OctagonPause,
    );
    expect(comPausa).toEqual([
      SITUACAO_DA_CONTA_STATUS.suspensa,
      SINAL_STATUS.conta_suspensa,
    ]);
    expect(comPausa.every((definicao) => definicao.tone === "alert")).toBe(
      true,
    );
    expect(DO_PAINEL.some((d) => d.icon === TriangleAlert)).toBe(false);
  });

  it("segunda leva: a saúde, os sinais e os passos em 3 camadas, com os sentidos da tabela de ícones", () => {
    expect(SAUDE_STATUS).toEqual({
      saudavel: { label: "Saudável", tone: "success", icon: CircleCheck },
      atencao: { label: "Atenção", tone: "warning", icon: CircleAlert },
      em_risco: { label: "Em risco", tone: "alert", icon: Siren },
    });
    expect(SINAL_STATUS).toEqual({
      conta_suspensa: {
        label: "Conta suspensa",
        tone: "alert",
        icon: OctagonPause,
      },
      sem_uso: { label: "Sem uso há 30 dias", tone: "warning", icon: Watch },
      ainda_sem_acesso: {
        label: "Ainda sem acesso",
        tone: "warning",
        icon: Sprout,
      },
      whatsapp_desconectado: {
        label: "WhatsApp desconectado",
        tone: "alert",
        icon: WifiOff,
      },
      sem_numero_de_whatsapp: {
        label: "Sem número de WhatsApp",
        tone: "warning",
        icon: PhoneOff,
      },
      pedido_de_entrada_esperando: {
        label: "Pedido de entrada esperando",
        tone: "warning",
        icon: Hourglass,
      },
      falhas_de_envio: {
        label: "Falhas de envio",
        tone: "alert",
        icon: OctagonAlert,
      },
      perto_do_teto_da_ia: {
        label: "Perto do teto de IA",
        tone: "warning",
        icon: CircleAlert,
      },
    });
    // O WhatsApp desconectado e o mesmo par do "Desconectado" da conexao.
    expect(SINAL_STATUS.whatsapp_desconectado.icon).toBe(
      WHATSAPP_CONNECTION_STATUS.desconectado.icon,
    );
    expect(PASSO_STATUS).toEqual({
      feito: { label: "Feito", tone: "success", icon: CircleCheck },
      falta: { label: "Falta", tone: "neutral", icon: CircleDashed },
    });
  });

  it("terceira leva: Sprout é só do Ainda sem acesso; o Teto de IA atingido tem a cara do Teto atingido do cartão de gasto", () => {
    const todos = [...MAPAS_DO_PRODUTO, ...DO_PAINEL];
    expect(todos.filter((definicao) => definicao.icon === Sprout)).toEqual([
      SINAL_STATUS.ainda_sem_acesso,
    ]);
    expect(TETO_DE_IA_ATINGIDO_STATUS).toEqual({
      label: "Teto de IA atingido",
      tone: "warning",
      icon: Hourglass,
    });
    expect(TETO_DE_IA_ATINGIDO_STATUS.icon).toBe(GASTO_STATUS.atingido.icon);
    expect(TETO_DE_IA_ATINGIDO_STATUS.tone).toBe(GASTO_STATUS.atingido.tone);
  });

  it("segunda leva: Siren (Em risco) e PhoneOff (Sem número de WhatsApp) têm um dono só no produto", () => {
    const todos = [...MAPAS_DO_PRODUTO, ...DO_PAINEL];
    expect(todos.filter((definicao) => definicao.icon === Siren)).toEqual([
      SAUDE_STATUS.em_risco,
    ]);
    expect(todos.filter((definicao) => definicao.icon === PhoneOff)).toEqual([
      SINAL_STATUS.sem_numero_de_whatsapp,
    ]);
  });

  it("uso (26/10/2026): Em uso é sucesso; Sem uso é o Watch âmbar do Esfriando (tempo demais sem atividade)", () => {
    expect(USO_DA_CLINICA_STATUS).toEqual({
      em_uso: { label: "Em uso", tone: "success", icon: CircleCheck },
      sem_uso: { label: "Sem uso", tone: "warning", icon: Watch },
    });
    // O mesmo par de outro mapa do produto, no mesmo sentido.
    expect(
      MAPAS_DO_PRODUTO.filter((definicao) => definicao.icon === Watch).map(
        (definicao) => definicao.tone,
      ),
    ).toEqual(["warning"]);
    expect(usoDaClinica({ emUso: true })).toBe("em_uso");
    expect(usoDaClinica({ emUso: false })).toBe("sem_uso");
  });

  it("pessoa da equipe: Ativa, Pendente (ampulheta, esperando liberação) e Inativa (o Sem acesso da lista da equipe)", () => {
    expect(SITUACAO_DO_MEMBRO_STATUS).toEqual({
      ativo: { label: "Ativa", tone: "success", icon: CircleCheck },
      pendente: { label: "Pendente", tone: "warning", icon: Hourglass },
      inativo: { label: "Inativa", tone: "neutral", icon: CircleSlash },
    });
    expect(ACCESS_LEVEL_STATUS.nada.icon).toBe(CircleSlash);
    expect(ACCESS_LEVEL_STATUS.nada.tone).toBe("neutral");
  });

  it("agente na lista: o rótulo da liberação, com o ícone e a cor do agente da clínica", () => {
    expect(ROTULO_DA_LIBERACAO).toEqual({
      desligado: "Não liberado",
      teste: "Liberado (Teste)",
      producao: "Liberado (Produção)",
    });
    expect(liberacaoDoAgente("desligado")).toBe("nao_liberado");
    expect(liberacaoDoAgente("teste")).toBe("liberado");
    expect(liberacaoDoAgente("producao")).toBe("liberado");
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

  it("há quanto tempo, pelos dias do calendário da clínica", () => {
    const agora = new Date("2026-10-26T15:00:00.000Z"); // 12:00 em Fortaleza
    const fuso = "America/Fortaleza";
    expect(haQuantoTempo("2026-10-26T13:05:00.000Z", fuso, agora)).toBe("Hoje");
    // 02:30 UTC do dia 26 ainda e o dia 25 em Fortaleza (23:30).
    expect(haQuantoTempo("2026-10-26T02:30:00.000Z", fuso, agora)).toBe(
      "Ontem",
    );
    expect(haQuantoTempo("2026-10-24T12:00:00.000Z", fuso, agora)).toBe(
      "Há 2 dias",
    );
    expect(haQuantoTempo("2026-09-27T12:00:00.000Z", fuso, agora)).toBe(
      "Há 29 dias",
    );
    // Ate 30 dias de calendario, em dias (o "Em uso" conta 30 vezes 24
    // horas); "Há 1 mês" so a partir de 31.
    expect(haQuantoTempo("2026-09-26T12:00:00.000Z", fuso, agora)).toBe(
      "Há 30 dias",
    );
    expect(haQuantoTempo("2026-09-25T12:00:00.000Z", fuso, agora)).toBe(
      "Há 1 mês",
    );
    expect(haQuantoTempo("2026-07-01T12:00:00.000Z", fuso, agora)).toBe(
      "Há 3 meses",
    );
    expect(haQuantoTempo("2025-10-01T12:00:00.000Z", fuso, agora)).toBe(
      "Há 1 ano",
    );
    expect(haQuantoTempo("2023-10-01T12:00:00.000Z", fuso, agora)).toBe(
      "Há 3 anos",
    );
    // relogio da tela um pouco atras do instante: hoje, nunca "Há -1 dias"
    expect(haQuantoTempo("2026-10-26T15:00:05.000Z", fuso, agora)).toBe("Hoje");
  });

  it('a borda dos 30 dias: o login que o banco ainda conta como em uso nunca aparece como "Há 1 mês" (revisão de 26/10/2026)', () => {
    // Login em 25/09/2026 as 23:30 em Fortaleza, leitura em 25/10/2026 as
    // 08:00: 704,5 horas (menos de 30 vezes 24), em uso para o banco; 30
    // dias de calendario.
    const login = "2026-09-26T02:30:00.000Z";
    const leitura = new Date("2026-10-25T11:00:00.000Z");
    expect((leitura.getTime() - Date.parse(login)) / 3_600_000).toBe(704.5);
    expect(haQuantoTempo(login, "America/Fortaleza", leitura)).toBe(
      "Há 30 dias",
    );
  });

  it("quem entrou: o nome e o papel; sem nome, o e-mail; o Implementador pelo rótulo dele", () => {
    const acesso = clinica().ultimoAcesso!;
    expect(quemEntrou(acesso)).toBe("Ana Souza (Administrador)");
    expect(quemEntrou({ ...acesso, papel: "recepcao" })).toBe(
      "Ana Souza (Recepção)",
    );
    expect(quemEntrou({ ...acesso, nome: null, implementador: true })).toBe(
      "ana@aurora.com.br (Implementador)",
    );
    expect(quemEntrou({ ...acesso, papel: null })).toBe("Ana Souza");
    expect(nomeDaPessoa({ nome: null, email: null })).toBe(
      TEXTOS_DO_PAINEL.semNomeNoPerfil,
    );
    expect(papelDaPessoa({ papel: "leitura" })).toBe("Somente leitura");
  });

  it("quando o último acesso foi da equipe Conduzza, a lista e o detalhe dizem (ela conta no uso, marcada)", () => {
    const acesso = clinica().ultimoAcesso!;
    expect(quemEntrouNaLista(acesso)).toBe("Ana Souza");
    expect(
      quemEntrouNaLista({
        ...acesso,
        nome: "Vinicius Rodrigues",
        equipeConduzza: true,
      }),
    ).toBe("Vinicius Rodrigues (equipe Conduzza)");
    expect(
      quemEntrou({
        ...acesso,
        nome: "Vinicius Rodrigues",
        equipeConduzza: true,
      }),
    ).toBe("Vinicius Rodrigues (Administrador, equipe Conduzza)");
    expect(
      quemEntrou({
        ...acesso,
        nome: "Vinicius Rodrigues",
        papel: null,
        equipeConduzza: true,
      }),
    ).toBe("Vinicius Rodrigues (equipe Conduzza)");
    expect(TEXTOS_DO_PAINEL.incluiEquipeConduzza(1)).toBe(
      "Inclui 1 da equipe Conduzza",
    );
    expect(TEXTOS_DO_PAINEL.incluiEquipeConduzza(1200)).toBe(
      "Inclui 1.200 da equipe Conduzza",
    );
  });

  it("o painel diz que o último acesso é a última atividade, não só o login (decisão do dono de 26/10/2026)", () => {
    expect(TEXTOS_DO_PAINEL.descricao).toContain(
      TEXTOS_DO_PAINEL.ultimoAcessoEAtividade,
    );
    expect(TEXTOS_DO_PAINEL.ultimoAcessoEAtividade).toContain(
      "última atividade",
    );
    expect(TEXTOS_DO_PAINEL.rodapeDoEmUso).toBe(
      "Alguém da equipe usou o sistema nos últimos 30 dias",
    );
    expect(TEXTOS_DO_PAINEL.rodapeDoSemUso).toContain("usou o sistema");
    // Nenhum texto do uso fala em login (a regra de antes) nem tem
    // travessao.
    for (const texto of [
      TEXTOS_DO_PAINEL.descricao,
      TEXTOS_DO_PAINEL.ultimoAcessoEAtividade,
      TEXTOS_DO_PAINEL.rodapeDoEmUso,
      TEXTOS_DO_PAINEL.rodapeDoSemUso,
    ]) {
      expect(texto).not.toMatch(/login/i);
      expect(texto).not.toMatch(/[–—]/);
    }
  });

  it("a coluna Equipe: ativas e pendentes, no singular e no plural, com o número à parte", () => {
    expect(contagemDaEquipe(0, "ativas")).toEqual({
      numero: null,
      palavra: "Nenhuma ativa",
    });
    expect(contagemDaEquipe(1, "ativas")).toEqual({
      numero: "1",
      palavra: "ativa",
    });
    expect(contagemDaEquipe(1200, "ativas")).toEqual({
      numero: "1.200",
      palavra: "ativas",
    });
    expect(contagemDaEquipe(0, "pendentes")).toEqual({
      numero: null,
      palavra: "Nenhuma pendente",
    });
    expect(contagemDaEquipe(1, "pendentes")).toEqual({
      numero: "1",
      palavra: "pendente",
    });
    expect(contagemDaEquipe(3, "pendentes")).toEqual({
      numero: "3",
      palavra: "pendentes",
    });
  });
});

describe("busca, filtros e ordem", () => {
  const acessoEm = (em: string) => ({
    ...clinica().ultimoAcesso!,
    em,
  });
  const lista = [
    clinica({
      id: ID_A,
      nome: "Clínica Zélia",
      ultimoAcesso: acessoEm("2026-10-20T13:00:00.000Z"),
    }),
    clinica({
      id: ID_B,
      nome: "Odonto Árvore",
      emUso: false,
      ultimoAcesso: null,
      suspensao: {
        suspensaEm: "2026-10-10T12:00:00.000Z",
        motivo: "Pagamento atrasado",
      },
      pessoas: [
        { nome: "João Prado", email: "joao@arvore.com" },
        // pendente e inativo tambem entram na busca (decisao do banco)
        { nome: null, email: "recepcao.antiga@arvore.com" },
      ],
    }),
    clinica({
      id: ID_C,
      nome: "Estética Bela",
      ultimoAcesso: acessoEm("2026-10-25T09:00:00.000Z"),
      agente: {
        estado: "teste",
        modo: "contatos",
        liberada: true,
        pausadaPelaClinica: false,
        telefonesLigados: 2,
      },
    }),
  ];

  it("lê os filtros da URL; valor desconhecido (ou de antes de 26/10) vira o padrão", () => {
    const params = (valores: Record<string, string>) =>
      new URLSearchParams(valores);
    expect(lerFiltrosDoPainel(params({}))).toEqual(FILTROS_PADRAO);
    expect(
      lerFiltrosDoPainel(
        params({
          busca: "aurora",
          uso: "sem_uso",
          conta: "suspensa",
          agente: "liberado",
        }),
      ),
    ).toEqual({
      busca: "aurora",
      uso: "sem_uso",
      conta: "suspensa",
      agente: "liberado",
      saude: "todas",
    });
    expect(lerFiltrosDoPainel(params({ agente: "nao_liberado" })).agente).toBe(
      "nao_liberado",
    );
    expect(
      lerFiltrosDoPainel(
        params({
          uso: "ativo",
          conta: "apagada",
          agente: "teste",
          situacao: "suspensa",
        }),
      ),
    ).toEqual(FILTROS_PADRAO);
    expect(
      lerFiltrosDoPainel(params({ busca: "x".repeat(200) })).busca,
    ).toHaveLength(80);
  });

  it("as opções de cada filtro, na ordem do desenho", () => {
    expect(OPCOES_DO_USO.map((o) => o.label)).toEqual([
      "Todas",
      "Em uso",
      "Sem uso",
    ]);
    expect(OPCOES_DA_CONTA.map((o) => o.label)).toEqual([
      "Todas",
      "Ativas",
      "Suspensas",
    ]);
    expect(OPCOES_DO_AGENTE.map((o) => o.label)).toEqual([
      "Todos",
      "Liberado",
      "Não liberado",
    ]);
  });

  it("sem filtro: todas, o último acesso mais recente primeiro e quem nunca entrou no fim", () => {
    expect(filtrarClinicas(lista, FILTROS_PADRAO).map((c) => c.nome)).toEqual([
      "Estética Bela",
      "Clínica Zélia",
      "Odonto Árvore",
    ]);
    expect(filtrosAtivos(FILTROS_PADRAO)).toBe(false);
  });

  it("a ordem: empate no acesso (ou ninguém entrou) vai pelo nome, sem caixa, e pelo id", () => {
    const mesmo = "2026-10-20T13:00:00.000Z";
    const ordenadas = [
      clinica({ id: ID_C, nome: "beta", ultimoAcesso: null, emUso: false }),
      clinica({ id: ID_B, nome: "Alfa", ultimoAcesso: null, emUso: false }),
      clinica({ id: ID_A, nome: "Zeta", ultimoAcesso: acessoEm(mesmo) }),
      clinica({ id: ID_C, nome: "Alfa", ultimoAcesso: acessoEm(mesmo) }),
    ]
      .sort(ordemDoPainel)
      .map((c) => `${c.nome} ${c.id.slice(0, 1)}`);
    expect(ordenadas).toEqual(["Alfa c", "Zeta a", "Alfa b", "beta c"]);
  });

  it("uso, conta e agente pelo valor exato", () => {
    const ids = (filtros: Partial<typeof FILTROS_PADRAO>) =>
      filtrarClinicas(lista, { ...FILTROS_PADRAO, ...filtros }).map(
        (c) => c.id,
      );
    expect(ids({ uso: "em_uso" })).toEqual([ID_C, ID_A]);
    expect(ids({ uso: "sem_uso" })).toEqual([ID_B]);
    expect(ids({ conta: "suspensa" })).toEqual([ID_B]);
    expect(ids({ conta: "ativa" })).toEqual([ID_C, ID_A]);
    expect(ids({ agente: "liberado" })).toEqual([ID_C]);
    expect(ids({ agente: "nao_liberado" })).toEqual([ID_A, ID_B]);
    expect(ids({ uso: "sem_uso", agente: "liberado" })).toEqual([]);
    expect(situacaoDaConta(lista[1] as ClinicaNoPainel)).toBe("suspensa");
    expect(filtrosAtivos({ ...FILTROS_PADRAO, uso: "em_uso" })).toBe(true);
    expect(filtrosAtivos({ ...FILTROS_PADRAO, conta: "ativa" })).toBe(true);
    expect(filtrosAtivos({ ...FILTROS_PADRAO, agente: "liberado" })).toBe(true);
  });

  it("a busca ignora acento e maiúscula e olha qualquer pessoa da equipe", () => {
    const busca = (termo: string) =>
      filtrarClinicas(lista, { ...FILTROS_PADRAO, busca: termo }).map(
        (c) => c.id,
      );
    expect(busca("arvore")).toEqual([ID_B]);
    expect(busca("ZELIA")).toEqual([ID_A]);
    expect(busca("joao@")).toEqual([ID_B]);
    expect(busca("prado")).toEqual([ID_B]);
    expect(busca("recepcao.antiga")).toEqual([ID_B]);
    expect(busca("ana souza")).toEqual([ID_C, ID_A]);
    expect(busca("ninguém")).toEqual([]);
    expect(normalizarBusca("  Éstética ")).toBe("estetica");
    expect(filtrosAtivos({ ...FILTROS_PADRAO, busca: "  " })).toBe(false);
  });
});

describe("o agente na linha da lista (liberar e retirar)", () => {
  it("cada confirmação grava o estado certo", () => {
    expect(estadoDaConfirmacao("liberar")).toBe("teste");
    expect(estadoDaConfirmacao("teste")).toBe("teste");
    expect(estadoDaConfirmacao("volta")).toBe("teste");
    expect(estadoDaConfirmacao("producao")).toBe("producao");
    expect(estadoDaConfirmacao("retirar")).toBe("desligado");
  });

  it("Liberar não liga com a conta suspensa (o banco recusa); retirar continua livre", () => {
    expect(porQueNaoLibera({ estado: "desligado", suspensa: true })).toBe(
      TEXTOS_DO_PAINEL.suspensaNaoLigaOAgente,
    );
    expect(porQueNaoLibera({ estado: "desligado", suspensa: false })).toBe(
      null,
    );
    expect(porQueNaoLibera({ estado: "teste", suspensa: true })).toBeNull();
    expect(porQueNaoLibera({ estado: "producao", suspensa: true })).toBeNull();
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
    expect(
      agenteDaClinicaSchema.safeParse({
        clinicId: ID_A,
        estadoVisto: "teste",
        estado: "desligado",
      }).success,
    ).toBe(true);
    expect(
      agenteDaClinicaSchema.safeParse({
        clinicId: ID_A,
        estadoVisto: "desligado",
        estado: "teste",
      }).success,
    ).toBe(true);
    const producao = (motivo?: string) =>
      agenteDaClinicaSchema.safeParse({
        clinicId: ID_A,
        estadoVisto: "teste",
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
      agenteDaClinicaSchema.safeParse({
        clinicId: ID_A,
        estadoVisto: "desligado",
        estado: "ligado",
      }).success,
    ).toBe(false);
    expect(OPCOES_DO_ESTADO_DO_AGENTE.map((o) => o.label)).toEqual([
      "Desligado",
      "Teste",
      "Produção",
    ]);
  });

  it("agente: o estado que a tela mostrava vai junto, e pedir o mesmo não é mudança (revisão de 26/10/2026)", () => {
    // Sem o estado visto: recusado (a tela sempre manda o que mostrava).
    expect(
      agenteDaClinicaSchema.safeParse({ clinicId: ID_A, estado: "teste" })
        .success,
    ).toBe(false);
    expect(
      agenteDaClinicaSchema.safeParse({
        clinicId: ID_A,
        estadoVisto: "ligado",
        estado: "teste",
      }).success,
    ).toBe(false);
    for (const estado of ["desligado", "teste", "producao"] as const) {
      const mesmo = agenteDaClinicaSchema.safeParse({
        clinicId: ID_A,
        estadoVisto: estado,
        estado,
        motivo: "Requisitos conferidos",
      });
      expect(mesmo.success).toBe(false);
      expect(mesmo.error?.issues[0]?.path).toEqual(["estado"]);
    }
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
    const emProducao = efeitoDeRevogar({
      valeParaTodas: false,
      emProducao: true,
    });
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
      "O assistente passa a responder aos leads que escreverem para os números ligados. Os telefones da equipe também são atendidos, se estiverem no público escolhido.",
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
