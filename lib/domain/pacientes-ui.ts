import type { AppointmentStatus, PatientTag } from "@/lib/design/status";
import { estaInativo, temRiscoDeFalta } from "@/lib/domain/etiquetas";

// Regras PURAS da Tela 9 (Pacientes): filtros da barra, indicadores da ficha
// e etiquetas derivadas. Zero I/O: quem busca dados e lib/queries/pacientes.ts.
// Os campos abaixo sao os que a RPC pacientes_resumo devolve, em snake_case.

/** O minimo que um paciente precisa ter para os filtros puros da lista. */
export type PacienteFiltravel = {
  total_faltou: number;
  ultima_consulta: string | null;
  proxima_consulta: string | null;
  saldo_sessoes: number;
  insurance_id: string | null;
  profissionais_ids: string[];
};

export type FiltrosDePacientes = {
  comFalta?: boolean;
  inativos?: boolean;
  comPacote?: boolean;
  convenio?: string | null;
  profissional?: string | null;
};

/**
 * Filtros da barra da Tela 9, aplicados no cliente (mesma decisao da Agenda e
 * da Tela 4: troca de filtro instantanea, sem refetch). Filtros combinados sao
 * conjuncao: marcar "com falta" e "com pacote" devolve quem tem os dois.
 */
export function filtrarPacientes<T extends PacienteFiltravel>(
  pacientes: readonly T[],
  filtros: FiltrosDePacientes,
  agora: Date,
): T[] {
  return pacientes.filter((paciente) => {
    // Risco de falta pelo total_faltou das CONSULTAS, nao pelo
    // contact.no_show_count: o contador denormalizado so cresce quando alguem
    // marca falta pela agenda e diverge em base importada. A RPC conta a
    // fonte que nao mente, e a nota da migration 20260825200000 diz o mesmo.
    if (filtros.comFalta && !temRiscoDeFalta(paciente.total_faltou)) {
      return false;
    }
    if (
      filtros.inativos &&
      !estaInativo({
        temConsultaFutura: paciente.proxima_consulta !== null,
        ultimaConsultaEm: paciente.ultima_consulta
          ? new Date(paciente.ultima_consulta)
          : null,
        agora,
      })
    ) {
      return false;
    }
    if (filtros.comPacote && paciente.saldo_sessoes <= 0) {
      return false;
    }
    if (filtros.convenio && paciente.insurance_id !== filtros.convenio) {
      return false;
    }
    if (
      filtros.profissional &&
      !paciente.profissionais_ids.includes(filtros.profissional)
    ) {
      return false;
    }
    return true;
  });
}

export type IndicadoresDoPaciente = {
  totalConsultas: number;
  faltas: number;
  /** null quando nao houve consulta nenhuma: a taxa nao existe, nao e 0. */
  taxaComparecimento: number | null;
};

/**
 * Cartoes da ficha. Total de consultas = compareceu + faltou; cancelada NAO
 * conta, porque cancelar com aviso nao e o mesmo que sumir no dia. Sem
 * consulta nenhuma a taxa e null e a interface mostra traco, nunca 0%, que
 * leria como "esse paciente nunca aparece".
 */
export function indicadoresDe(entrada: {
  total_compareceu: number;
  total_faltou: number;
}): IndicadoresDoPaciente {
  const totalConsultas = entrada.total_compareceu + entrada.total_faltou;
  return {
    totalConsultas,
    faltas: entrada.total_faltou,
    taxaComparecimento:
      totalConsultas === 0 ? null : entrada.total_compareceu / totalConsultas,
  };
}

/**
 * Etiquetas DERIVADAS, nunca persistidas: sao recalculadas a cada leitura, e
 * por isso somem sozinhas quando o paciente volta a marcar.
 */
export function etiquetasDoPaciente(
  entrada: PacienteFiltravel,
  agora: Date,
): PatientTag[] {
  const etiquetas: PatientTag[] = [];
  if (temRiscoDeFalta(entrada.total_faltou)) {
    etiquetas.push("risco_de_falta");
  }
  if (
    estaInativo({
      temConsultaFutura: entrada.proxima_consulta !== null,
      ultimaConsultaEm: entrada.ultima_consulta
        ? new Date(entrada.ultima_consulta)
        : null,
      agora,
    })
  ) {
    etiquetas.push("inativo");
  }
  return etiquetas;
}

/** O minimo de uma consulta para os agregados da ficha. */
export type ConsultaAgregavel = {
  starts_at: string;
  status: AppointmentStatus;
};

const CANCELADOS: readonly AppointmentStatus[] = [
  "cancelado_paciente",
  "cancelado_clinica",
];

/**
 * Os mesmos agregados que a RPC pacientes_resumo calcula, agora a partir da
 * linha do tempo que a ficha ja carregou: a ficha nao chama a RPC de novo, e
 * os dois lados precisam contar igual. Cancelada nao entra em nada, nem nos
 * totais nem nas datas.
 */
export function agregadosDeConsultas(
  consultas: readonly ConsultaAgregavel[],
  agora: Date,
): {
  total_compareceu: number;
  total_faltou: number;
  ultima_consulta: string | null;
  proxima_consulta: string | null;
} {
  let total_compareceu = 0;
  let total_faltou = 0;
  let ultima_consulta: string | null = null;
  let ultimaMs = -Infinity;
  let proxima_consulta: string | null = null;
  let proximaMs = Infinity;
  for (const consulta of consultas) {
    if (consulta.status === "compareceu") {
      total_compareceu++;
    }
    if (consulta.status === "faltou") {
      total_faltou++;
    }
    if (CANCELADOS.includes(consulta.status)) {
      continue;
    }
    // Compara em milissegundos, nunca texto: o mesmo instante pode voltar do
    // banco com fusos escritos diferentes e a ordem alfabetica mentiria.
    const instante = new Date(consulta.starts_at).getTime();
    if (instante <= agora.getTime()) {
      if (instante > ultimaMs) {
        ultimaMs = instante;
        ultima_consulta = consulta.starts_at;
      }
    } else if (instante < proximaMs) {
      proximaMs = instante;
      proxima_consulta = consulta.starts_at;
    }
  }
  return { total_compareceu, total_faltou, ultima_consulta, proxima_consulta };
}

/** "82%" para a taxa, ou vazio quando ela nao existe (a UI poe traco). */
export function porcentagemDeComparecimento(taxa: number | null): string {
  if (taxa === null) {
    return "";
  }
  return `${Math.round(taxa * 100)}%`;
}
