import { TZDate } from "@date-fns/tz";

import {
  interpretarResposta,
  normalizar,
} from "@/lib/domain/resposta-paciente";

// Logica PURA da lista de espera (tarefa 4.9), zero I/O: o casamento entre a
// vaga que abriu e as preferencias da fila, a montagem da onda e o
// vocabulario da resposta a oferta. Quem le o banco e envia e o job em
// lib/jobs/lista-espera.ts; quem decide o vencedor e a RPC (FOR UPDATE).

export type Turno = "manha" | "tarde" | "noite";

export type EntradaDaFila = {
  id: string;
  contactId: string;
  procedureId: string | null;
  professionalId: string | null;
  preferredShifts: string[];
  preferredWeekdays: number[];
  priority: number;
  createdAt: string;
  /** Convenio do contato (contact.insurance_id); null = particular. */
  insuranceId: string | null;
};

export type SlotVago = {
  professionalId: string;
  /** 0=domingo..6=sabado, no fuso da clinica. */
  weekday: number;
  turno: Turno;
  /** Tamanho da vaga em minutos (fim menos inicio do horario cancelado). */
  duracaoMin: number;
  /**
   * Procedimento da consulta cancelada: vale para a entrada "qualquer
   * procedimento" (herda o PROCEDIMENTO, nunca o vinculo, que carrega o
   * convenio de quem cancelou).
   */
  procedimentoDaVaga: string | null;
};

/** Um service_link ativo do profissional da vaga (procedimento ativo). */
export type VinculoDaVaga = {
  id: string;
  procedureId: string;
  /** null = particular. */
  insuranceId: string | null;
  durationMin: number;
  /** Sala ou equipamento que o procedimento exige, se exigir. */
  resourceId: string | null;
};

/** Repouso entre ofertas de SLOTS DIFERENTES para a mesma pessoa. */
export const REPOUSO_POS_OFERTA_MS = 2 * 60 * 60 * 1000;

/**
 * Folga depois do vencimento de uma oferta aberta antes de tentar de novo:
 * quem fecha a oferta vencida e o cron de manutencao, que roda por minuto.
 */
export const FOLGA_DO_FECHAMENTO_MS = 2 * 60 * 1000;

/**
 * O vinculo com que a entrada seria agendada, na MESMA regra do aceite
 * (aceitar_oferta_de_espera): o do convenio do contato, senao o particular.
 * service_link e unico por (profissional, procedimento, convenio), entao ha
 * no maximo um de cada e a escolha e deterministica.
 */
export function escolherVinculo(
  vinculos: readonly VinculoDaVaga[],
  procedureId: string | null,
  insuranceId: string | null,
): VinculoDaVaga | null {
  if (!procedureId) {
    return null;
  }
  const doProcedimento = vinculos.filter(
    (vinculo) => vinculo.procedureId === procedureId,
  );
  if (insuranceId) {
    const doConvenio = doProcedimento.find(
      (vinculo) => vinculo.insuranceId === insuranceId,
    );
    if (doConvenio) {
      return doConvenio;
    }
  }
  return doProcedimento.find((vinculo) => vinculo.insuranceId === null) ?? null;
}

/** O vinculo da entrada nesta vaga (procedimento pedido ou o da vaga). */
export function vinculoDaEntrada(
  entrada: EntradaDaFila,
  slot: SlotVago,
  vinculos: readonly VinculoDaVaga[],
): VinculoDaVaga | null {
  return escolherVinculo(
    vinculos,
    entrada.procedureId ?? slot.procedimentoDaVaga,
    entrada.insuranceId,
  );
}

/** Manha ate 11:59, tarde ate 17:59, noite dai em diante (fuso da clinica). */
export function turnoDoInstante(instante: Date, timezone: string): Turno {
  const hora = new TZDate(instante.getTime(), timezone).getHours();
  if (hora < 12) {
    return "manha";
  }
  if (hora < 18) {
    return "tarde";
  }
  return "noite";
}

/** Dia da semana no fuso da clinica (0=domingo, convencao getDay). */
export function diaDaSemanaNoFuso(instante: Date, timezone: string): number {
  return new TZDate(instante.getTime(), timezone).getDay();
}

/**
 * A entrada casa com a vaga? Campo vazio ou nulo e "sem preferencia" e casa
 * com tudo; preferencia declarada precisa bater. Alem das preferencias, a
 * pessoa precisa ter COMO ser agendada ali: um vinculo ativo do profissional
 * para o procedimento (o pedido, ou o da vaga) no convenio dela ou
 * particular, cuja duracao caiba na vaga e cujo recurso nao esteja ocupado.
 */
export function casaComSlot(
  entrada: EntradaDaFila,
  slot: SlotVago,
  vinculos: readonly VinculoDaVaga[],
  recursosOcupados: ReadonlySet<string> = new Set(),
): boolean {
  if (
    entrada.professionalId !== null &&
    entrada.professionalId !== slot.professionalId
  ) {
    return false;
  }
  const vinculo = vinculoDaEntrada(entrada, slot, vinculos);
  if (!vinculo) {
    return false;
  }
  if (vinculo.durationMin > slot.duracaoMin) {
    return false;
  }
  if (vinculo.resourceId !== null && recursosOcupados.has(vinculo.resourceId)) {
    return false;
  }
  if (
    entrada.preferredShifts.length > 0 &&
    !entrada.preferredShifts.includes(slot.turno)
  ) {
    return false;
  }
  if (
    entrada.preferredWeekdays.length > 0 &&
    !entrada.preferredWeekdays.includes(slot.weekday)
  ) {
    return false;
  }
  return true;
}

/** O grupo da tela e do reordenar: (profissional, procedimento), nulo casa nulo. */
function grupoDaEntrada(entrada: EntradaDaFila): string {
  return `${entrada.professionalId ?? "*"}|${entrada.procedureId ?? "*"}`;
}

function instante(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * A ordem da fila INTEIRA para a onda. A prioridade so tem sentido DENTRO do
 * grupo (mover_na_lista_de_espera renumera so o grupo da tela para 10, 20...,
 * enquanto os outros ficam no padrao 1000000): comparar prioridade entre
 * grupos punha o grupo reordenado inteiro na frente de quem espera ha
 * semanas em outro grupo.
 *
 * Regra: dentro do grupo, a ordem que a recepcao escolheu (prioridade, depois
 * chegada). Entre grupos, a chegada: a k-esima posicao do grupo herda a
 * k-esima data de chegada do grupo, e a fila inteira ordena por essa data.
 * Reordenar um grupo so troca quem ocupa as vagas de chegada DELE.
 */
export function ordenarFila(
  entradas: readonly EntradaDaFila[],
): EntradaDaFila[] {
  const grupos = new Map<string, EntradaDaFila[]>();
  for (const entrada of entradas) {
    const chave = grupoDaEntrada(entrada);
    const grupo = grupos.get(chave);
    if (grupo) {
      grupo.push(entrada);
    } else {
      grupos.set(chave, [entrada]);
    }
  }

  const efetiva = new Map<string, { chegada: number; posicao: number }>();
  for (const grupo of grupos.values()) {
    const naOrdemDaRecepcao = [...grupo].sort(
      (a, b) =>
        a.priority - b.priority ||
        instante(a.createdAt) - instante(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
    const chegadas = grupo
      .map((entrada) => instante(entrada.createdAt))
      .sort((a, b) => a - b);
    naOrdemDaRecepcao.forEach((entrada, posicao) => {
      efetiva.set(entrada.id, { chegada: chegadas[posicao]!, posicao });
    });
  }

  return [...entradas].sort((a, b) => {
    const ka = efetiva.get(a.id)!;
    const kb = efetiva.get(b.id)!;
    return (
      ka.chegada - kb.chegada ||
      ka.posicao - kb.posicao ||
      a.id.localeCompare(b.id)
    );
  });
}

/**
 * Os N primeiros da fila que casam com a vaga, na ordem de ordenarFila; um
 * contato entra UMA vez mesmo com duas entradas.
 */
export function montarOnda(params: {
  entradas: readonly EntradaDaFila[];
  slot: SlotVago;
  vinculos: readonly VinculoDaVaga[];
  recursosOcupados?: ReadonlySet<string>;
  excluirContatos: ReadonlySet<string>;
  tamanho: number;
}): EntradaDaFila[] {
  const onda: EntradaDaFila[] = [];
  const vistos = new Set<string>();
  for (const entrada of ordenarFila(params.entradas)) {
    if (onda.length >= params.tamanho) {
      break;
    }
    if (vistos.has(entrada.contactId)) {
      continue;
    }
    if (params.excluirContatos.has(entrada.contactId)) {
      continue;
    }
    if (
      !casaComSlot(
        entrada,
        params.slot,
        params.vinculos,
        params.recursosOcupados,
      )
    ) {
      continue;
    }
    vistos.add(entrada.contactId);
    onda.push(entrada);
  }
  return onda;
}

export type OfertaRecente = {
  offeredTo: readonly string[];
  status: string;
  createdAt: string;
  expiresAt: string;
};

/**
 * Quando cada contato sai do bloqueio TEMPORARIO (oferta aberta de outro
 * horario, ou o repouso de 2h depois de qualquer oferta): o maior entre o
 * fim do repouso e, se a oferta segue aberta, o vencimento dela mais a folga
 * do fechamento. Epoch em ms.
 */
export function liberacaoPorContato(
  ofertas: readonly OfertaRecente[],
): Map<string, number> {
  const liberacao = new Map<string, number>();
  for (const oferta of ofertas) {
    let libera = instante(oferta.createdAt) + REPOUSO_POS_OFERTA_MS;
    if (oferta.status === "aberta") {
      libera = Math.max(
        libera,
        instante(oferta.expiresAt) + FOLGA_DO_FECHAMENTO_MS,
      );
    }
    for (const contato of oferta.offeredTo) {
      liberacao.set(contato, Math.max(liberacao.get(contato) ?? 0, libera));
    }
  }
  return liberacao;
}

/**
 * A onda saiu vazia. Foi por falta de interessado, ou porque quem serve esta
 * PRESO em outra oferta (duas vagas abertas na mesma manha)? No segundo caso
 * devolve o instante em que o primeiro deles se libera, para o job voltar
 * nessa hora; null quando ninguem esta preso ou quando a liberacao so chega
 * depois do limite (inicio da vaga menos a janela de resposta).
 */
export function proximaTentativaDaVaga(params: {
  entradas: readonly EntradaDaFila[];
  slot: SlotVago;
  vinculos: readonly VinculoDaVaga[];
  recursosOcupados?: ReadonlySet<string>;
  /** Exclusoes que valem para ESTA vaga para sempre. */
  excluirPermanentes: ReadonlySet<string>;
  liberacao: ReadonlyMap<string, number>;
  agora: number;
  limite: number;
}): number | null {
  const semBloqueioTemporario = montarOnda({
    entradas: params.entradas,
    slot: params.slot,
    vinculos: params.vinculos,
    recursosOcupados: params.recursosOcupados,
    excluirContatos: params.excluirPermanentes,
    tamanho: params.entradas.length,
  });
  let primeira: number | null = null;
  for (const entrada of semBloqueioTemporario) {
    const libera = params.liberacao.get(entrada.contactId);
    if (libera === undefined) {
      continue;
    }
    primeira = primeira === null ? libera : Math.min(primeira, libera);
  }
  if (primeira === null) {
    return null;
  }
  // Nunca no passado (oferta vencida que o cron ainda nao fechou).
  const quando = Math.max(primeira, params.agora + 60_000);
  return quando < params.limite ? quando : null;
}

/** Espera pela reconexao do WhatsApp: cresce de 5 em 5 minutos por volta. */
export const PASSO_DA_ESPERA_POR_RECONEXAO_MS = 5 * 60_000;
/** Espera maxima entre uma volta e outra enquanto o WhatsApp segue fora. */
export const TETO_DA_ESPERA_POR_RECONEXAO_MS = 30 * 60_000;
/**
 * A ultima volta cai este tanto antes do limite, e espera menor que isto nao
 * vale uma volta: o relogio do banco (que libera o job) e o do executor (que
 * decide) podem divergir alguns segundos.
 */
export const FOLGA_DA_ULTIMA_VOLTA_MS = 60_000;

/**
 * WhatsApp fora do ar: quando a onda tenta de novo. O teto e de TEMPO, nao de
 * voltas: a vaga espera a reconexao enquanto ainda da para oferecer (limite =
 * inicio da vaga menos a janela de resposta), em passos crescentes de 5, 10,
 * 15... ate 30 minutos. Perto do limite, a ultima volta cai 1 minuto antes
 * dele, para uma reconexao de ultima hora ainda salvar a vaga. Devolve null
 * quando nao sobra tempo util (desistir). `passo` e quantas voltas ja foram
 * dadas esperando a reconexao (0 na primeira). Epoch em ms.
 */
export function proximaEsperaPorReconexao(params: {
  passo: number;
  agora: number;
  limite: number;
}): number | null {
  const passo =
    Number.isInteger(params.passo) && params.passo >= 0 ? params.passo : 0;
  const espera = Math.min(
    PASSO_DA_ESPERA_POR_RECONEXAO_MS * (passo + 1),
    TETO_DA_ESPERA_POR_RECONEXAO_MS,
  );
  const quando = Math.min(
    params.agora + espera,
    params.limite - FOLGA_DA_ULTIMA_VOLTA_MS,
  );
  return quando - params.agora >= FOLGA_DA_ULTIMA_VOLTA_MS ? quando : null;
}

/**
 * A mensagem da oferta ainda vale a pena sair? So com pelo menos METADE da
 * janela de resposta pela frente: oferta que chega no fim do prazo vira "Poxa,
 * esse horario nao esta mais disponivel" para quem correu para responder.
 */
export function temFolgaParaResponder(params: {
  criadaEm: string;
  venceEm: string;
  agora: number;
}): boolean {
  const vence = instante(params.venceEm);
  const janela = vence - instante(params.criadaEm);
  return vence - params.agora >= janela / 2;
}

// A oferta pergunta sim ou nao, e a mensagem instrui "responda SIM" /
// "responda NAO QUERO". Os sets de confirmacao/cancelamento da 4.7 valem
// (inclusive "1" e "3" de quem responde como no menu), mais o vocabulario
// natural de oferta. "Remarcar" nao significa nada numa oferta.
const ACEITAR_EXTRA = new Set(["quero", "aceito", "sim quero", "eu quero"]);
const RECUSAR_EXTRA = new Set(["nao", "nao quero", "nao posso", "agora nao"]);

export type RespostaDeOferta = "aceitar" | "recusar" | "nao_reconhecida";

export function interpretarRespostaDeOferta(
  body: string | null,
): RespostaDeOferta {
  if (!body) {
    return "nao_reconhecida";
  }
  const texto = normalizar(body);
  if (ACEITAR_EXTRA.has(texto)) {
    return "aceitar";
  }
  if (RECUSAR_EXTRA.has(texto)) {
    return "recusar";
  }
  const base = interpretarResposta(body);
  if (base === "confirmar") {
    return "aceitar";
  }
  if (base === "cancelar") {
    return "recusar";
  }
  return "nao_reconhecida";
}
