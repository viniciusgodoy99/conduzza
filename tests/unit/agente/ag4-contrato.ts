import { randomUUID } from "node:crypto";

import type { EstadoDoAtendimento } from "@/lib/agente/atendimento";
import {
  conferirConsultaDaIa,
  type ConsultaDoContato,
} from "@/lib/agente/ferramentas/minhas-consultas";

import {
  ancoraForte,
  mensagemNovaDoPaciente,
  perguntaRespondida,
  rpcsDaAg3,
  type OpcoesDoContrato,
} from "./ag3-contrato";
import type { AgendaEmMemoria, Linha } from "./agenda-em-memoria";
import { CLINICA, CONTATO } from "./agenda-fixtures";

// O CONTRATO das RPCs da AG4 (migration 20261028100000_remarcar_e_cancelar_
// pela_ia.sql; o desenho, secao 3, e o contrato-mudancas da frente de banco)
// em memoria, para as conversas de varias falas com o LLM falso: cancelar_
// consulta_pela_ia (a idempotencia pelo job, a habilidade e o prazo, o
// pedido no estado GRAVADO, a conferencia da consulta, "a consulta mudou"
// com a folga de 2 minutos e a mesma transicao do botao) e reservar_horario_
// da_ia e agendar_pela_ia com p_remarcar (a consulta nova pendente, ligada a
// antiga, que continua de pe). As RPCs de verdade sao provadas nas suites de
// integracao e de RLS (com o banco).
//
// Revisao da AG4 (27/10/2026, contrato-mudancas R1 a R5), o mesmo que a
// frente de banco mudou:
//  - cancelar: o pedido vale 60 minutos (pedido_vencido, depois de
//    consulta_mudou e antes de sem_confirmacao_do_paciente) e a ANCORA FORTE
//    do "sim": a ultima saida antes da ultima mensagem do paciente tem de ser
//    da IA, nao falhada e gravada depois do instante do pedido (outra saida
//    no meio, de qualquer autor: sem_confirmacao_do_paciente);
//  - agendar com p_remarcar: a mesma ancora, gravada depois da reserva;
//  - reservar e agendar com p_remarcar nunca conferem ja_tem_consulta (a
//    remarcacao troca uma consulta por outra): so o caminho da AG3, sem
//    p_remarcar, recusa ja_tem_consulta;
//  - o gravar carimba de novo o instante vencido (comOCarimboDoBanco).
// A ancora so e conferida com a conversa (`conversa`); sem ela, como antes.
//
// Revisao curta das correcoes da AG4 (contrato-mudancas R7 a R10, a frente
// de banco):
//  - R7: mensagem_nova_do_paciente no cancelar e no agendar (com e sem
//    p_remarcar). As conferidas sao as mensagens do paciente do instante da
//    ultima em diante (empate, todas) ou depois da pergunta respondida; recusa
//    se alguma nao apagada esta fora das lidas (`lidas`, ai_turno.
//    mensagens_lidas) ou alguma apagada esta dentro delas. Sem `lidas`, nao
//    confere. Ordem: no cancelar, depois de pedido_vencido; no agendar,
//    depois de faltam_dados; antes de sem_confirmacao_do_paciente;
//  - R8: a pergunta respondida (a ultima resposta da IA, nao falhada, depois
//    do pedido, ou da reserva, e antes da ultima mensagem do paciente):
//    pedido_vencido conta dela (60 minutos); consulta_mudou conta do comeco
//    do job que a escreveu (`jobCriadoEm`; no agendar com p_remarcar, o job
//    da reserva); sem o job, a regra de antes (o pedido, ou a reserva, menos
//    2 minutos);
//  - R9: a ancora forte tambem no agendar SEM p_remarcar (a AG3): a ultima
//    saida antes do "sim" e a resposta da IA depois da reserva (no contrato
//    da AG3, com a conversa e as lidas das opcoes).
// A conversa (MensagemNoBanco), a ancora forte, a pergunta respondida e a
// mensagem nova moram no contrato da AG3 (ag3-contrato.ts), que os dois
// espelhos usam; daqui sao reexportadas.

export {
  ancoraForte,
  mensagemNovaDoPaciente,
  perguntaRespondida,
  type MensagemNoBanco,
} from "./ag3-contrato";

export type HabilidadeDaVersao = { ligada: boolean; prazoHoras: number | null };

/** Revisao da AG4 (R1): o pedido de cancelar vale 60 minutos. */
export const VALIDADE_DO_PEDIDO_NO_BANCO_MS = 60 * 60_000;

export type OpcoesDaAg4 = OpcoesDoContrato & {
  /**
   * O estado GRAVADO da conversa (o que gravar_atendimento_da_ia guardou no
   * fim do turno anterior, com o instante do pedido carimbado pelo banco).
   */
  estado: () => EstadoDoAtendimento | null;
  /** Cancelar e remarcar na versao publicada (a habilidade e o prazo). */
  cancelar: HabilidadeDaVersao;
  remarcar: HabilidadeDaVersao;
  /**
   * Revisao curta das correcoes da AG4 (R8): quando o job foi criado
   * (job_queue.created_at, ms). Ausente: sem o job (a regra de antes).
   */
  jobCriadoEm?: (jobId: string) => number | undefined;
  /** Uma recusa forcada (o primeiro motivo da ordem do banco). */
  forcar?: {
    cancelar?: string | null;
    reservar?: string | null;
    agendar?: string | null;
  };
};

const DUAS_HORAS_DE_FOLGA_MS = 2 * 60_000;

/** Uma consulta do contato da conversa, como o banco guarda. */
export function consultaDoContato(e: {
  id?: string;
  inicio: string;
  fim: string;
  vinculo: string;
  profissional: string;
  unidade?: string | null;
  status?: string;
  aprovacao?: string | null;
  encaixe?: boolean;
  remarcacaoDe?: string | null;
  criadaPor?: string;
}): Linha {
  return {
    id: e.id ?? randomUUID(),
    clinic_id: CLINICA,
    contact_id: CONTATO,
    professional_id: e.profissional,
    service_link_id: e.vinculo,
    unit_id: e.unidade ?? null,
    starts_at: e.inicio,
    ends_at: e.fim,
    status: e.status ?? "agendado",
    approval_status: e.aprovacao ?? null,
    is_overbooking: e.encaixe ?? false,
    remarcacao_de: e.remarcacaoDe ?? null,
    remarcacao_pedida_em: null,
    created_by: e.criadaPor ?? "usuario",
  };
}

/** A linha do banco como a conferencia le (o espelho de conferir_consulta_da_ia). */
function comoConsulta(banco: AgendaEmMemoria, a: Linha): ConsultaDoContato {
  return {
    id: String(a.id),
    inicio: String(a.starts_at),
    fim: String(a.ends_at),
    status: String(a.status),
    aprovacao: (a.approval_status as string | null) ?? null,
    encaixe: a.is_overbooking === true,
    serviceLinkId: String(a.service_link_id),
    profissionalId: String(a.professional_id),
    unidadeId: (a.unit_id as string | null) ?? null,
    remarcacaoDe: (a.remarcacao_de as string | null) ?? null,
    temRemarcacaoPendente: banco
      .linhas("appointment")
      .some(
        (b) =>
          b.remarcacao_de === a.id &&
          b.approval_status === "pendente" &&
          !String(b.status).startsWith("cancelado"),
      ),
  };
}

function recusa(motivo: string) {
  return { data: { ok: false, motivo }, error: null };
}

/**
 * Revisao curta das correcoes da AG4 (R8): de quando conta o consulta_mudou.
 * O comeco do job que escreveu a pergunta (no agendar com p_remarcar, o da
 * reserva), aceito so se o job e anterior a ela; sem o job, a regra de antes
 * (`semJob`: o pedido, ou a reserva, menos 2 minutos).
 */
function pisoDoConsultaMudou(
  opcoes: OpcoesDaAg4,
  job: string | undefined,
  ate: number,
  semJob: number,
): number {
  const criado = job === undefined ? undefined : opcoes.jobCriadoEm?.(job);
  return criado !== undefined && criado <= ate ? criado : semJob;
}

export function rpcsDaAg4(banco: AgendaEmMemoria, opcoes: OpcoesDaAg4) {
  // Revisao curta das correcoes da AG4 (R7 e R9): o agendar SEM p_remarcar
  // (a AG3) confere a mensagem nova do paciente e a ancora forte com a
  // conversa e as lidas destas opcoes (o espelho da AG3 ganhou a regra).
  rpcsDaAg3(banco, opcoes);
  const { catalogo } = opcoes;
  const reservarDaAg3 = banco.manipuladores.get("reservar_horario_da_ia")!;
  const agendarDaAg3 = banco.manipuladores.get("agendar_pela_ia")!;
  const vinculoDe = (id: unknown) => catalogo.vinculos.find((v) => v.id === id);
  const consultaDe = (id: unknown) =>
    banco
      .linhas("appointment")
      .find(
        (a) =>
          a.id === id && a.clinic_id === CLINICA && a.contact_id === CONTATO,
      );
  const conferir = (id: unknown, acao: "cancelar" | "remarcar") => {
    const linha = consultaDe(id);
    const habilidade = acao === "cancelar" ? opcoes.cancelar : opcoes.remarcar;
    return conferirConsultaDaIa({
      consulta: linha === undefined ? null : comoConsulta(banco, linha),
      acao,
      prazoHoras: habilidade.prazoHoras,
      agoraMs: opcoes.agora(),
      catalogo,
    });
  };

  banco.rpc("cancelar_consulta_pela_ia", (args) => {
    const agora = opcoes.agora();
    // A idempotencia pelo job (a linha da trilha com ia_job_id).
    const feita = banco
      .linhas("appointment_status_history")
      .find((h) => h.ia_job_id === args.p_job_id);
    if (feita) {
      if (feita.appointment_id !== args.p_appointment_id) {
        return { data: null, error: { code: "22023" } };
      }
      return {
        data: {
          ok: true,
          starts_at: consultaDe(feita.appointment_id)?.starts_at,
          reutilizado: true,
        },
        error: null,
      };
    }
    if (!opcoes.cancelar.ligada || opcoes.cancelar.prazoHoras === null) {
      return recusa("cancelamento_desligado");
    }
    const estado = opcoes.estado();
    if (
      estado === null ||
      estado.pedido_pendente !== "cancelar" ||
      estado.appointment_id !== args.p_appointment_id
    ) {
      return recusa("sem_pedido_de_cancelamento");
    }
    const motivo = conferir(args.p_appointment_id, "cancelar");
    if (motivo !== null) {
      return recusa(motivo);
    }
    if (opcoes.forcar?.cancelar) {
      return recusa(opcoes.forcar.cancelar);
    }
    const linha = consultaDe(args.p_appointment_id)!;
    const pedidoEm =
      estado.pedido_pendente_em === null
        ? null
        : Date.parse(estado.pedido_pendente_em);
    const conversa = opcoes.conversa?.();
    // Revisao curta das correcoes da AG4 (R8): a pergunta respondida.
    const pergunta = perguntaRespondida(conversa, pedidoEm);
    // "A consulta mudou": a recepcao remarcou depois do comeco do job que
    // escreveu a pergunta (R8); sem o job, depois do pedido menos a folga de
    // 2 minutos (contrato-mudancas item 4).
    if (
      typeof linha.remarcada_em === "string" &&
      pedidoEm !== null &&
      Date.parse(linha.remarcada_em) >
        pisoDoConsultaMudou(
          opcoes,
          pergunta?.job,
          pergunta?.em ?? Number.NEGATIVE_INFINITY,
          pedidoEm - DUAS_HORAS_DE_FOLGA_MS,
        )
    ) {
      return recusa("consulta_mudou");
    }
    // Revisao da AG4 (R1) e revisao curta (R8): a PERGUNTA respondida vale
    // 60 minutos; vencida, "pergunte de novo". Sem pergunta, nao se aplica.
    if (
      pergunta !== null &&
      pergunta.em <= agora - VALIDADE_DO_PEDIDO_NO_BANCO_MS
    ) {
      return recusa("pedido_vencido");
    }
    // Revisao curta das correcoes da AG4 (R7): a pessoa escreveu (ou apagou)
    // depois das mensagens que o job leu.
    if (
      mensagemNovaDoPaciente(
        conversa,
        opcoes.lidas?.(String(args.p_job_id)),
        pergunta,
      )
    ) {
      return recusa("mensagem_nova_do_paciente");
    }
    // Revisao da AG4 (R2): a ancora forte (a pergunta da IA logo antes do
    // "sim", depois do pedido).
    if (!ancoraForte(conversa, pedidoEm)) {
      return recusa("sem_confirmacao_do_paciente");
    }
    // A mesma transicao do botao: cancelado_paciente, com a trilha da IA.
    linha.status = "cancelado_paciente";
    banco.inserir("appointment_status_history", {
      id: randomUUID(),
      clinic_id: CLINICA,
      appointment_id: linha.id,
      status: "cancelado_paciente",
      changed_by: "ia",
      changed_by_user_id: null,
      ia_job_id: args.p_job_id,
      changed_at: new Date(agora).toISOString(),
    });
    banco.inserir("message", {
      id: randomUUID(),
      conversation_id: args.p_conversation_id,
      content_type: "evento",
      author: "sistema",
    });
    return {
      data: { ok: true, starts_at: linha.starts_at, reutilizado: false },
      error: null,
    };
  });

  banco.rpc("reservar_horario_da_ia", (args) => {
    if (args.p_remarcar === undefined || args.p_remarcar === null) {
      return reservarDaAg3(args);
    }
    const agora = opcoes.agora();
    const jaTem = banco
      .linhas("slot_hold")
      .find((h) => h.job_id === args.p_job_id);
    if (jaTem) {
      return {
        data: {
          ok: true,
          hold_id: jaTem.id,
          starts_at: jaTem.starts_at,
          ends_at: jaTem.ends_at,
          expires_at: jaTem.expires_at,
          reutilizado: true,
          unit_id: jaTem.unit_id ?? null,
        },
        error: null,
      };
    }
    const vinculo = vinculoDe(args.p_service_link_id);
    if (!vinculo) {
      return recusa("vinculo_invalido");
    }
    if (!opcoes.remarcar.ligada || opcoes.remarcar.prazoHoras === null) {
      return recusa("remarcacao_desligada");
    }
    const estado = opcoes.estado();
    if (
      estado === null ||
      estado.pedido_pendente !== "remarcar" ||
      estado.appointment_id !== args.p_remarcar
    ) {
      return recusa("sem_pedido_de_remarcacao");
    }
    const motivo = conferir(args.p_remarcar, "remarcar");
    if (motivo !== null) {
      return recusa(motivo);
    }
    const antiga = consultaDe(args.p_remarcar)!;
    const daAntiga = vinculoDe(antiga.service_link_id);
    if (
      daAntiga === undefined ||
      daAntiga.procedimentoId !== vinculo.procedimentoId ||
      daAntiga.profissionalId !== vinculo.profissionalId ||
      daAntiga.convenioId !== vinculo.convenioId
    ) {
      return recusa("remarcacao_invalida");
    }
    if (opcoes.forcar?.reservar) {
      return recusa(opcoes.forcar.reservar);
    }
    // Revisao da AG4 (R5): com p_remarcar, NADA de ja_tem_consulta (outra
    // consulta futura do mesmo procedimento, inclusive a pendente que a IA
    // marcou, nao barra).
    const inicio = String(args.p_starts_at);
    const fim = new Date(
      Date.parse(inicio) + (vinculo.duracaoMin ?? 30) * 60_000,
    ).toISOString();
    const ocupado = banco
      .linhas("appointment")
      .some(
        (a) =>
          a.professional_id === vinculo.profissionalId &&
          !String(a.status).startsWith("cancelado") &&
          Date.parse(String(a.starts_at)) < Date.parse(fim) &&
          Date.parse(String(a.ends_at)) > Date.parse(inicio),
      );
    if (ocupado) {
      return recusa("ocupado");
    }
    banco.tabelas.set(
      "slot_hold",
      banco
        .linhas("slot_hold")
        .filter(
          (h) =>
            !(
              h.conversation_id === args.p_conversation_id &&
              h.consumido_em === null
            ),
        ),
    );
    const hold: Linha = {
      id: randomUUID(),
      clinic_id: args.p_clinic_id,
      professional_id: vinculo.profissionalId,
      conversation_id: args.p_conversation_id,
      service_link_id: args.p_service_link_id,
      job_id: args.p_job_id,
      unit_id: args.p_unit_id ?? null,
      starts_at: inicio,
      ends_at: fim,
      expires_at: new Date(agora + 10 * 60_000).toISOString(),
      created_at: new Date(agora).toISOString(),
      consumido_em: null,
    };
    banco.inserir("slot_hold", hold);
    return {
      data: {
        ok: true,
        hold_id: hold.id,
        starts_at: inicio,
        ends_at: fim,
        expires_at: hold.expires_at,
        reutilizado: false,
        unit_id: hold.unit_id,
      },
      error: null,
    };
  });

  banco.rpc("agendar_pela_ia", (args) => {
    if (args.p_remarcar === undefined || args.p_remarcar === null) {
      return agendarDaAg3(args);
    }
    const agora = opcoes.agora();
    const consumida = banco
      .linhas("slot_hold")
      .find((h) => h.job_id_do_agendar === args.p_job_id);
    if (consumida) {
      const nova = banco
        .linhas("appointment")
        .find((a) => a.id === consumida.appointment_id);
      const antiga = consultaDe(nova?.remarcacao_de);
      return {
        data: {
          ok: true,
          appointment_id: consumida.appointment_id,
          starts_at: consumida.starts_at,
          ends_at: consumida.ends_at,
          reutilizado: true,
          remarcacao_de: nova?.remarcacao_de ?? null,
          remarcacao_de_starts_at: antiga?.starts_at ?? null,
        },
        error: null,
      };
    }
    const viva = banco
      .linhas("slot_hold")
      .find(
        (h) =>
          h.conversation_id === args.p_conversation_id &&
          h.consumido_em === null,
      );
    if (!viva) {
      return recusa("reserva_inexistente");
    }
    if (
      args.p_slot_hold_id !== undefined &&
      args.p_slot_hold_id !== null &&
      args.p_slot_hold_id !== viva.id
    ) {
      return recusa("reserva_diferente");
    }
    if (Date.parse(String(viva.expires_at)) <= agora) {
      return recusa("reserva_vencida");
    }
    if (!opcoes.remarcar.ligada || opcoes.remarcar.prazoHoras === null) {
      return recusa("remarcacao_desligada");
    }
    const estado = opcoes.estado();
    if (
      estado === null ||
      estado.pedido_pendente !== "remarcar" ||
      estado.appointment_id !== args.p_remarcar
    ) {
      return recusa("sem_pedido_de_remarcacao");
    }
    const motivo = conferir(args.p_remarcar, "remarcar");
    if (motivo !== null) {
      return recusa(motivo);
    }
    const antiga = consultaDe(args.p_remarcar)!;
    const daAntiga = vinculoDe(antiga.service_link_id);
    const daReserva = vinculoDe(viva.service_link_id);
    if (
      daAntiga === undefined ||
      daReserva === undefined ||
      daAntiga.procedimentoId !== daReserva.procedimentoId ||
      daAntiga.profissionalId !== daReserva.profissionalId ||
      daAntiga.convenioId !== daReserva.convenioId
    ) {
      return recusa("remarcacao_invalida");
    }
    // "A consulta mudou": a ancora e a reserva (o T3). Revisao curta das
    // correcoes da AG4 (R8): do comeco do job da reserva; sem ele, da
    // reserva menos a folga de 2 minutos.
    const criadaEm =
      typeof viva.created_at === "string" ? Date.parse(viva.created_at) : null;
    if (
      typeof antiga.remarcada_em === "string" &&
      criadaEm !== null &&
      Date.parse(antiga.remarcada_em) >
        pisoDoConsultaMudou(
          opcoes,
          typeof viva.job_id === "string" ? viva.job_id : undefined,
          criadaEm,
          criadaEm - DUAS_HORAS_DE_FOLGA_MS,
        )
    ) {
      return recusa("consulta_mudou");
    }
    if (opcoes.forcar?.agendar) {
      return recusa(opcoes.forcar.agendar);
    }
    // Revisao curta das correcoes da AG4 (R7): a pessoa escreveu (ou apagou)
    // depois das mensagens que o job leu.
    const conversa = opcoes.conversa?.();
    if (
      mensagemNovaDoPaciente(
        conversa,
        opcoes.lidas?.(String(args.p_job_id)),
        perguntaRespondida(conversa, criadaEm),
      )
    ) {
      return recusa("mensagem_nova_do_paciente");
    }
    // Revisao da AG4 (R3): a ancora forte, depois da reserva (o T3). Sem
    // ja_tem_consulta (R5).
    if (!ancoraForte(conversa, criadaEm)) {
      return recusa("sem_confirmacao_do_paciente");
    }
    // O indice unico de uma remarcacao pendente por consulta (23505).
    const outraPendente = banco
      .linhas("appointment")
      .some(
        (a) =>
          a.remarcacao_de === antiga.id &&
          a.approval_status === "pendente" &&
          !String(a.status).startsWith("cancelado"),
      );
    if (outraPendente) {
      return recusa("remarcacao_pendente");
    }
    const nova: Linha = {
      id: randomUUID(),
      clinic_id: args.p_clinic_id,
      contact_id: CONTATO,
      professional_id: viva.professional_id,
      service_link_id: viva.service_link_id,
      unit_id: viva.unit_id ?? null,
      starts_at: viva.starts_at,
      ends_at: viva.ends_at,
      status: "agendado",
      created_by: "ia",
      approval_status: "pendente",
      is_overbooking: false,
      remarcacao_de: antiga.id,
      remarcacao_pedida_em: null,
    };
    banco.inserir("appointment", nova);
    antiga.remarcacao_pedida_em =
      antiga.remarcacao_pedida_em ?? new Date(agora).toISOString();
    Object.assign(viva, {
      consumido_em: new Date(agora).toISOString(),
      appointment_id: nova.id,
      job_id_do_agendar: args.p_job_id,
    });
    return {
      data: {
        ok: true,
        appointment_id: nova.id,
        starts_at: nova.starts_at,
        ends_at: nova.ends_at,
        reutilizado: false,
        remarcacao_de: antiga.id,
        remarcacao_de_starts_at: antiga.starts_at,
      },
      error: null,
    };
  });
}

/**
 * O gravar_atendimento_da_ia do banco, so o carimbo (contrato-mudancas,
 * item 5): o instante que o codigo manda e ignorado; o banco grava agora
 * quando o pedido ou o foco mudam, mantem quando os dois ficam iguais, e o
 * pedido nulo tem o instante nulo. Revisao da AG4 (R4): o instante de antes
 * so fica enquanto vale (60 minutos); vencido, agora (o pedido re-armado).
 */
export function comOCarimboDoBanco(
  anterior: EstadoDoAtendimento,
  novo: EstadoDoAtendimento,
  agora: number,
): EstadoDoAtendimento {
  if (novo.pedido_pendente === null) {
    return { ...novo, pedido_pendente_em: null };
  }
  const igual =
    novo.pedido_pendente === anterior.pedido_pendente &&
    novo.appointment_id === anterior.appointment_id &&
    anterior.pedido_pendente_em !== null &&
    Date.parse(anterior.pedido_pendente_em) >
      agora - VALIDADE_DO_PEDIDO_NO_BANCO_MS;
  return {
    ...novo,
    pedido_pendente_em: igual
      ? anterior.pedido_pendente_em
      : new Date(agora).toISOString(),
  };
}
