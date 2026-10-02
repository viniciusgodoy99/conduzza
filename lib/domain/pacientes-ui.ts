import type { AppointmentStatus, PatientTag } from "@/lib/design/status";
import { estaInativo, temRiscoDeFalta } from "@/lib/domain/etiquetas";
import { diaCivil, somarDias } from "@/lib/domain/horarios";

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
    // "Com falta" e "Risco de falta" sao coisas DIFERENTES: o filtro da lista
    // pega quem ja faltou ao menos uma vez (brief da Tela 9) e a etiqueta so
    // nasce com 2 faltas ou mais (temRiscoDeFalta, spec 6.4). Quem tem 1 falta
    // entra no filtro e NAO recebe etiqueta.
    // A contagem sai do total_faltou das CONSULTAS, nao do
    // contact.no_show_count: o contador denormalizado so cresce quando alguem
    // marca falta pela agenda e diverge em base importada. A RPC conta a
    // fonte que nao mente, e a nota da migration 20260825200000 diz o mesmo.
    if (filtros.comFalta && paciente.total_faltou < 1) {
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

/** O minimo de um item de saldo (um procedimento da venda) para as contas. */
export type ItemComSessoes = {
  sessions_total: number;
  sessions_used: number;
};

/**
 * O minimo de uma venda de pacote para as contas da ficha. Desde a migration
 * 20260929120000 o saldo e POR ITEM (procedimento) e a validade e da venda.
 */
export type PacoteComValidade = {
  /** Dia civil (aaaa-mm-dd), ou null quando o pacote nao vence. */
  expires_at: string | null;
  itens: readonly ItemComSessoes[];
};

/**
 * Vencido = tem validade e ela ficou para tras no DIA CIVIL DA CLINICA
 * (regra 3.6). `hojeNaClinica` vem de diaCivil(clinic.timezone, agora), nunca
 * do dia do servidor: e assim que a RPC pacientes_resumo compara, e a ficha
 * precisa contar igual a lista.
 */
export function pacoteVencido(
  pacote: { expires_at: string | null },
  hojeNaClinica: string,
): boolean {
  return pacote.expires_at !== null && pacote.expires_at < hojeNaClinica;
}

/** Sessoes que o item ainda tem, sem olhar validade (nunca negativo). */
export function sessoesDoItem(item: ItemComSessoes): number {
  return Math.max(item.sessions_total - item.sessions_used, 0);
}

/** Vendidas e usadas da venda inteira (soma dos itens). */
export function totaisDoPacote(pacote: { itens: readonly ItemComSessoes[] }): {
  total: number;
  usadas: number;
} {
  let total = 0;
  let usadas = 0;
  for (const item of pacote.itens) {
    total += item.sessions_total;
    usadas += item.sessions_used;
  }
  return { total, usadas };
}

/**
 * Sessoes que ainda dao para usar na venda (soma dos itens). Pacote vencido
 * nao vale nada: zero.
 */
export function sessoesRestantes(
  pacote: PacoteComValidade,
  hojeNaClinica: string,
): number {
  if (pacoteVencido(pacote, hojeNaClinica)) {
    return 0;
  }
  return pacote.itens.reduce((soma, item) => soma + sessoesDoItem(item), 0);
}

/** Saldo total da ficha, a mesma conta do saldo_sessoes da RPC. */
export function saldoDeSessoes(
  pacotes: readonly PacoteComValidade[],
  hojeNaClinica: string,
): number {
  return pacotes.reduce(
    (soma, pacote) => soma + sessoesRestantes(pacote, hojeNaClinica),
    0,
  );
}

/** "82%" para a taxa, ou vazio quando ela nao existe (a UI poe traco). */
export function porcentagemDeComparecimento(taxa: number | null): string {
  if (taxa === null) {
    return "";
  }
  return `${Math.round(taxa * 100)}%`;
}

/**
 * Linha unica da RPC metricas_de_pacientes (migration 20261002110000), ja
 * normalizada: as contagens chegam como number e primeiro_comparecimento e
 * null quando a clinica (ou, para o profissional, a agenda dele) nunca teve
 * comparecimento. Clinica sem dado devolve zeros e null, nunca linha vazia.
 */
export type MetricasDePacientes = {
  /** Contatos com comparecimento nos ultimos 12 meses (ate o fim de hoje). */
  ativos: number;
  /** O mesmo calculo com a janela recuada 30 dias. */
  ativos_30d_atras: number;
  /** Primeira consulta nao cancelada no mes civil (passada ou futura). */
  novos_no_mes: number;
  /** Comparecimentos da janela madura [12 meses, 90 dias atras). */
  retorno_base: number;
  /** Desses, os que tiveram outra consulta viva ou atendida em ate 90 dias. */
  retorno_voltaram: number;
  /** Ultimo comparecimento ha mais de 6 meses e nada marcado adiante. */
  sem_contato_6m: number;
  primeiro_comparecimento: string | null;
};

/** O que os 4 cartoes do topo da Tela 9 mostram, ja decidido. */
export type CartoesDePacientes = {
  ativos: {
    valor: number;
    /** Base da variacao absoluta; null esconde a variacao (base zero). */
    anterior: number | null;
    /** dd/mm/aaaa do primeiro comparecimento, com menos de 12 meses de historico. */
    contandoDesde: string | null;
  };
  novosNoMes: number;
  retorno:
    | { medido: true; percentual: number; base: number }
    | {
        medido: false;
        /** dd/mm/aaaa em que a primeira medida sai, quando ainda vai sair. */
        primeiraMedidaEm: string | null;
      };
  semConsulta6m:
    | { medido: true; valor: number }
    | {
        medido: false;
        /** dd/mm/aaaa em que a contagem comeca, quando ja existe historico. */
        contaDesde: string | null;
      };
};

/** aaaa-mm-dd em dd/mm/aaaa, sem passar por fuso. */
function diaParaTexto(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split("-");
  return `${diaDoMes}/${mes}/${ano}`;
}

/**
 * Soma meses a um dia civil (aaaa-mm-dd) como o Postgres soma
 * `date + interval 'N months'`: o dia que nao existe no mes de chegada cai
 * no ultimo dia dele (31/08 menos 6 meses = 28/02). E o espelho das janelas
 * de metricas_de_pacientes, para a tela decidir "Ainda não medido" e
 * "Contando desde" com a mesma fronteira do banco.
 */
export function somarMeses(diaLocal: string, meses: number): string {
  const [ano, mes, dia] = diaLocal.split("-").map(Number);
  const indice = ano! * 12 + (mes! - 1) + meses;
  const anoFinal = Math.floor(indice / 12);
  const mesFinal = indice - anoFinal * 12;
  const ultimoDia = new Date(Date.UTC(anoFinal, mesFinal + 1, 0)).getUTCDate();
  const diaFinal = Math.min(dia!, ultimoDia);
  return `${String(anoFinal).padStart(4, "0")}-${String(mesFinal + 1).padStart(2, "0")}-${String(diaFinal).padStart(2, "0")}`;
}

/**
 * Decide o que os 4 cartoes do topo da lista mostram (Fase 3, decisoes do
 * dono em 02/10/2026), com as MESMAS fronteiras de metricas_de_pacientes no
 * dia civil da clinica (regra 3.6):
 * - ativos: variacao absoluta em pessoas contra 30 dias atras, escondida com
 *   base zero; "Contando desde" enquanto o historico (desde o primeiro
 *   comparecimento) for menor que a janela de 12 meses, que no banco e
 *   [amanha menos 12 meses, amanha);
 * - retorno em 90 dias: sem base e "Ainda não medido" (nunca 0%); o primeiro
 *   comparecimento do dia D entra na base em D + 91 (a janela madura fecha
 *   no inicio de hoje menos 90 dias);
 * - sem consulta ha 6 meses: "Ainda não medido" enquanto o primeiro
 *   comparecimento nao for anterior a hoje menos 6 meses (antes disso o zero
 *   e estrutural, nao uma boa noticia).
 */
export function cartoesDePacientes(
  metricas: MetricasDePacientes,
  agora: Date,
  timezone: string,
): CartoesDePacientes {
  const hoje = diaCivil(timezone, agora);
  const primeiroDia =
    metricas.primeiro_comparecimento === null
      ? null
      : diaCivil(timezone, new Date(metricas.primeiro_comparecimento));

  const inicioDosDozeMeses = somarMeses(somarDias(hoje, 1), -12);
  const contandoDesde =
    primeiroDia !== null && primeiroDia >= inicioDosDozeMeses
      ? diaParaTexto(primeiroDia)
      : null;

  let retorno: CartoesDePacientes["retorno"];
  if (metricas.retorno_base > 0) {
    retorno = {
      medido: true,
      percentual: (metricas.retorno_voltaram / metricas.retorno_base) * 100,
      base: metricas.retorno_base,
    };
  } else {
    const primeiraMedida =
      primeiroDia === null ? null : somarDias(primeiroDia, 91);
    retorno = {
      medido: false,
      primeiraMedidaEm:
        primeiraMedida !== null && primeiraMedida > hoje
          ? diaParaTexto(primeiraMedida)
          : null,
    };
  }

  let semConsulta6m: CartoesDePacientes["semConsulta6m"];
  if (primeiroDia !== null && primeiroDia < somarMeses(hoje, -6)) {
    semConsulta6m = { medido: true, valor: metricas.sem_contato_6m };
  } else if (primeiroDia === null) {
    semConsulta6m = { medido: false, contaDesde: null };
  } else {
    // Primeiro dia em que "hoje menos 6 meses" passa do primeiro
    // comparecimento. Partir de D + 6 meses e andar dia a dia cobre o
    // arredondamento de fim de mes (no maximo 3 passos).
    let comeco = somarMeses(primeiroDia, 6);
    while (somarMeses(comeco, -6) <= primeiroDia) {
      comeco = somarDias(comeco, 1);
    }
    semConsulta6m = { medido: false, contaDesde: diaParaTexto(comeco) };
  }

  return {
    ativos: {
      valor: metricas.ativos,
      anterior:
        metricas.ativos_30d_atras > 0 ? metricas.ativos_30d_atras : null,
      contandoDesde,
    },
    novosNoMes: metricas.novos_no_mes,
    retorno,
    semConsulta6m,
  };
}
