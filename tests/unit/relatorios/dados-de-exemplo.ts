import type { AppointmentStatus } from "@/lib/design/status";
import type { ConversoesResumo } from "@/lib/queries/conversoes-meta";
import type {
  AgendaDoPeriodo,
  AtendimentoDoPeriodo,
  CampanhasDoPeriodo,
  FaturamentoDoPeriodo,
  FunilDoPeriodo,
  InvestimentoDoPeriodo,
  Periodizado,
} from "@/lib/queries/relatorios";

// Dados de exemplo da Tela 11 para os testes de unidade (so contagens e
// valores agregados, nenhum dado de paciente).

export function porStatus(
  parcial: Partial<Record<AppointmentStatus, number>>,
): Record<AppointmentStatus, number> {
  return {
    agendado: 0,
    aguardando_confirmacao: 0,
    confirmado_paciente: 0,
    confirmado_recepcao: 0,
    na_recepcao: 0,
    em_atendimento: 0,
    compareceu: 0,
    cancelado_paciente: 0,
    cancelado_clinica: 0,
    faltou: 0,
    ...parcial,
  };
}

export const FUNIL: FunilDoPeriodo = {
  leads: 486,
  agendamentosCriados: 312,
  comparecimentos: 284,
  faltas: 28,
  coorte: { leads: 486, agendaram: 312, compareceram: 250 },
  porCanal: [
    { canal: "trafego_pago", leads: 300, agendaram: 200, compareceram: 160 },
    { canal: null, leads: 186, agendaram: 112, compareceram: 90 },
  ],
  porCampanha: [
    {
      campanha: "Check-up 2026",
      campanhaId: null,
      leads: 186,
      agendaram: 112,
      compareceram: 90,
    },
    {
      campanha: null,
      campanhaId: null,
      leads: 300,
      agendaram: 200,
      compareceram: 160,
    },
  ],
};

export function agenda(receitaCents: number | null): AgendaDoPeriodo {
  return {
    total: 40,
    criados: 35,
    porStatus: porStatus({
      compareceu: 30,
      faltou: 3,
      cancelado_paciente: 2,
      cancelado_clinica: 1,
      confirmado_paciente: 4,
    }),
    confirmadasAlgumaVez: 34,
    porProfissional: [
      {
        professionalId: "p1",
        nome: "Dra. Ana",
        total: 40,
        compareceu: 30,
        faltou: 3,
        cancelados: 3,
      },
    ],
    porProcedimento: [],
    recuperadas: { total: 2, receitaCents, semPreco: 1 },
    remarcadasAposFalta: { faltas: 3, remarcadas: 1 },
  };
}

export const ATENDIMENTO: AtendimentoDoPeriodo = {
  conversasIniciadas: 120,
  primeiraResposta: {
    conversas: 100,
    respondidas: 96,
    medianaSegundos: 540,
    p90Segundos: 3600,
  },
  mensagens: {
    porAutor: { paciente: 400, usuario: 300, sistema: 80 },
    entrada: 400,
    saida: 380,
    notasInternas: 12,
  },
};

export const FATURAMENTO: FaturamentoDoPeriodo = {
  comparecimentos: 30,
  valorCents: 28_400_000,
  comValor: 27,
  cobertas: 2,
  semPreco: 1,
};

export const CONVERSOES: ConversoesResumo = {
  porStatus: {
    registrado: 1,
    enfileirado: 0,
    enviado: 4,
    falhou: 0,
    descartado: 0,
  },
  total: 5,
  valorEnviadoCents: 50_000,
  comCtwa: 3,
  ultimoEnvio: null,
};

// ---------------------------------------------------------------------------
// Fase 4: campanhas_do_periodo, coerente com o FUNIL acima
// ---------------------------------------------------------------------------
// 486 leads = 120 (Implante) + 30 (campanha sem nome) + 186 (texto
// "Check-up 2026") + 150 sem campanha. Coorte: 312 agendaram (80 + 20 + 112
// + 100) e 250 compareceram (60 + 10 + 90 + 90). Leads de anuncio = 150
// casados + 12 sem campanha reconhecida = 162. Investimento da conta
// R$ 4.860,00 (R$ 3.420 + R$ 600 + R$ 500 da campanha sem lead + R$ 340 de
// post impulsionado), entao o custo por lead e R$ 4.860 / 162 = R$ 30,00.

export const INVESTIMENTO: InvestimentoDoPeriodo = {
  configurada: true,
  situacao: "funcionando",
  problema: null,
  moeda: "BRL",
  fusoDaConta: "America/Sao_Paulo",
  lidoDesde: "2026-08-04",
  lidoAte: "2026-10-02",
  // 06:00 em America/Fortaleza (UTC-3).
  sincronizadoEm: "2026-10-02T09:00:00.000Z",
  diaDe: "2026-09-03",
  diaAte: "2026-10-02",
  // Hoje no fuso da clinica: a leitura vai ate hoje, esta em dia.
  hoje: "2026-10-02",
  investimentoCents: 486_000,
  investimentoCasadoCents: 402_000,
  investimentoSemLeadCents: 50_000,
  campanhasSemLead: 1,
  outraMoeda: false,
};

export function campanhasDoPeriodo(
  investimento: Partial<InvestimentoDoPeriodo> | null = {},
  extra: Partial<CampanhasDoPeriodo> = {},
): CampanhasDoPeriodo {
  return {
    leads: 486,
    leadsDeAnuncio: 162,
    leadsCasados: 150,
    leadsDeAnuncioSemCampanha: 12,
    leadsSemCampanha: 150,
    // Ordem do banco: Meta antes de texto, investimento desc, leads desc.
    linhas: [
      {
        chave: "meta:120000000000000010",
        tipo: "meta",
        metaCampaignId: "120000000000000010",
        rotulo: "Implante Dentário",
        leads: 120,
        agendaram: 80,
        compareceram: 60,
        investimentoCents: 342_000,
      },
      {
        chave: "meta:120000000000000020",
        tipo: "meta",
        metaCampaignId: "120000000000000020",
        rotulo: null,
        leads: 30,
        agendaram: 20,
        compareceram: 10,
        investimentoCents: 60_000,
      },
      {
        chave: "meta:120000000000000030",
        tipo: "meta",
        metaCampaignId: "120000000000000030",
        rotulo: "Remarketing Botox",
        leads: 0,
        agendaram: 0,
        compareceram: 0,
        investimentoCents: 50_000,
      },
      {
        chave: "texto:Check-up 2026",
        tipo: "texto",
        metaCampaignId: null,
        rotulo: "Check-up 2026",
        leads: 186,
        agendaram: 112,
        compareceram: 90,
        investimentoCents: null,
      },
    ],
    investimento:
      investimento === null ? null : { ...INVESTIMENTO, ...investimento },
    ...extra,
  };
}

/** O periodo atual e o anterior (R$ 4.000 em 160 leads de anuncio: R$ 25,00). */
export function campanhasPeriodizadas(
  investimento: Partial<InvestimentoDoPeriodo> | null = {},
  extra: Partial<CampanhasDoPeriodo> = {},
): Periodizado<CampanhasDoPeriodo> {
  return {
    atual: campanhasDoPeriodo(investimento, extra),
    anterior: campanhasDoPeriodo(
      investimento === null
        ? null
        : {
            diaDe: "2026-08-04",
            diaAte: "2026-09-02",
            investimentoCents: 400_000,
            ...investimento,
          },
      { leadsDeAnuncio: 160, ...extra },
    ),
  };
}
