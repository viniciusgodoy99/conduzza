import type { AppointmentStatus } from "@/lib/design/status";
import type { ConversoesResumo } from "@/lib/queries/conversoes-meta";
import type {
  AgendaDoPeriodo,
  AtendimentoDoPeriodo,
  FaturamentoDoPeriodo,
  FunilDoPeriodo,
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
