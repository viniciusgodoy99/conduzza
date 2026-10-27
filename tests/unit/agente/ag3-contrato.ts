import { randomUUID } from "node:crypto";

import { dadosQueFaltam, type DadoDaMarcacao } from "@/lib/agente/atendimento";
import type { CatalogoDoAgente } from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  carteirinhaValida,
  cpfValido,
  idadeNoDia,
  nomeCompletoValido,
} from "@/lib/agente/ferramentas/registrar-dados";
import { diaCivil } from "@/lib/domain/horarios";

import { AgendaEmMemoria, type Linha } from "./agenda-em-memoria";
import { CLINICA, CONTATO, FUSO, PROF } from "./agenda-fixtures";
import { UNID } from "./cadastro-fixtures";

// O CONTRATO das RPCs da AG3 (migration 20261027120000) em memoria, para as
// conversas de varias falas com o LLM falso: reservar_horario_da_ia com a
// unidade, registrar_dados_da_marcacao (as regras do banco, a linha aberta
// da conversa, menor de idade e outra pessoa) e agendar_pela_ia com as
// recusas novas na ordem do banco. Simplificado onde o teste nao precisa
// (a conferencia do horario e a da agenda em memoria; a mensagem do paciente
// depois da pergunta nao e conferida: o turno ja confere a etapa). As RPCs
// de verdade sao provadas nas suites de integracao e de RLS (com o banco).
//
// Revisao final da AG3: o reservar recusa ja_tem_consulta (com o id e o
// inicio da consulta futura ativa do mesmo procedimento) e o agendar recebe
// p_slot_hold_id (a reserva da pergunta "Confirma"): com a viva diferente,
// reserva_diferente.
//
// Revisao curta das correcoes da AG4 (contrato-mudancas R7, R9 e R10, a
// frente de banco): com a conversa (`conversa`) e as lidas do job
// (`lidas`), o agendar confere tambem, depois de faltam_dados e antes de
// marcar, mensagem_nova_do_paciente (R7) e a ancora forte (R9: a ultima
// saida antes da ultima mensagem do paciente e a resposta da IA, nao
// falhada, depois da reserva). Sem elas, como antes.

/**
 * Revisao da AG4: uma mensagem da conversa como o banco guarda, na ordem
 * (direction, author, created_at e se a entrega falhou). Evento e nota
 * interna nao entram (o banco nao os conta como saida). Revisao curta das
 * correcoes: o id (as lidas do job), se foi apagada (R7) e o job que a
 * escreveu (a resposta da IA; R8).
 */
export type MensagemNoBanco = {
  id?: string;
  direcao: "entrada" | "saida";
  autor: "paciente" | "ia" | "usuario" | "sistema";
  /** created_at (ms). */
  em: number;
  falhou?: boolean;
  apagada?: boolean;
  /** message.job_id (a resposta da IA sai com o job do turno). */
  job?: string;
};

export type OpcoesDoContrato = {
  catalogo: CatalogoDoAgente;
  exigidos: { nomeCompleto: boolean; nascimento: boolean; cpf: boolean };
  /** O relogio do banco. */
  agora: () => number;
  /** Uma recusa forcada do agendar (o primeiro motivo da ordem do banco). */
  recusarAgendar?: string | null;
  /**
   * Revisao da AG4: a conversa como o banco guarda (a ancora forte do "sim").
   * Ausente: a ancora nao e conferida.
   */
  conversa?: () => readonly MensagemNoBanco[];
  /**
   * Revisao curta das correcoes da AG4: os ids das mensagens do paciente
   * que o job leu (ai_turno.mensagens_lidas). Ausente (ou sem as do job):
   * mensagem_nova_do_paciente nao e conferida.
   */
  lidas?: (jobId: string) => readonly string[] | undefined;
};

/**
 * Revisao da AG4 (R2 e R3; revisao curta, R9 na marcacao): a ancora forte.
 * A ULTIMA mensagem do paciente na conversa; a ultima SAIDA antes dela (de
 * qualquer autor, em qualquer situacao de entrega) tem de ser da IA, nao
 * falhada e gravada depois de `desde` (o instante do pedido, ou a reserva).
 * Sem mensagem do paciente: nao. Sem a conversa: sem conferir (como antes
 * da revisao).
 */
export function ancoraForte(
  conversa: readonly MensagemNoBanco[] | undefined,
  desde: number | null,
): boolean {
  if (conversa === undefined) {
    return true;
  }
  let ultimaDoPaciente = -1;
  conversa.forEach((m, i) => {
    if (m.direcao === "entrada" && m.autor === "paciente") {
      ultimaDoPaciente = i;
    }
  });
  if (ultimaDoPaciente < 0 || desde === null) {
    return false;
  }
  const saida = conversa
    .slice(0, ultimaDoPaciente)
    .filter((m) => m.direcao === "saida")
    .at(-1);
  return (
    saida !== undefined &&
    saida.autor === "ia" &&
    saida.falhou !== true &&
    saida.em > desde
  );
}

/**
 * Revisao curta das correcoes da AG4 (R8): a pergunta respondida
 * (v_pergunta): a ULTIMA resposta da IA (saida, nao falhada) gravada depois
 * de `desde` (o instante do pedido, ou a reserva) e antes da ultima mensagem
 * do paciente. null: nao ha (sem conversa, sem mensagem do paciente, sem
 * resposta da IA no intervalo).
 */
export function perguntaRespondida(
  conversa: readonly MensagemNoBanco[] | undefined,
  desde: number | null,
): MensagemNoBanco | null {
  if (conversa === undefined || desde === null) {
    return null;
  }
  const sim = conversa
    .filter((m) => m.direcao === "entrada" && m.autor === "paciente")
    .at(-1)?.em;
  if (sim === undefined) {
    return null;
  }
  return (
    conversa
      .filter(
        (m) =>
          m.direcao === "saida" &&
          m.autor === "ia" &&
          m.falhou !== true &&
          m.em > desde &&
          m.em < sim,
      )
      .at(-1) ?? null
  );
}

/**
 * Revisao curta das correcoes da AG4 (R7): a pessoa escreveu (ou apagou)
 * depois que o job leu as pendentes. As conferidas: as mensagens do paciente
 * do instante da ultima em diante (empate, todas) ou depois da pergunta
 * respondida; recusa se alguma NAO apagada esta fora das lidas (chegou
 * depois da leitura) ou alguma APAGADA esta dentro delas (o paciente apagou
 * o que o modelo leu). A apagada que o job nao leu nao conta. Sem a conversa
 * ou sem as lidas: nao confere.
 */
export function mensagemNovaDoPaciente(
  conversa: readonly MensagemNoBanco[] | undefined,
  lidas: readonly string[] | undefined,
  pergunta: MensagemNoBanco | null = null,
): boolean {
  if (conversa === undefined || lidas === undefined) {
    return false;
  }
  const doPaciente = conversa.filter(
    (m) => m.direcao === "entrada" && m.autor === "paciente",
  );
  const sim = doPaciente.at(-1)?.em;
  if (sim === undefined) {
    return false;
  }
  return doPaciente
    .filter((m) => m.em >= sim || (pergunta !== null && m.em > pergunta.em))
    .some((m) => {
      const lida = lidas.includes(m.id ?? "");
      return m.apagada === true ? lida : !lida;
    });
}

/** A jornada com unidades: a Dra. Ana de manha na Aldeota e a tarde no Centro. */
export function bancoDaAg3(): AgendaEmMemoria {
  const banco = new AgendaEmMemoria();
  let n = 0;
  const faixa = (
    professional_id: string,
    weekday: number,
    de: string,
    ate: string,
    unit_id: string | null,
  ) => ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    clinic_id: CLINICA,
    professional_id,
    weekday,
    starts_at: `${de}:00`,
    ends_at: `${ate}:00`,
    unit_id,
  });
  for (const dia of [1, 2, 3, 4, 5]) {
    banco.inserir(
      "professional_schedule",
      faixa(PROF.ana, dia, "08:00", "12:00", UNID.aldeota),
      faixa(PROF.ana, dia, "14:00", "18:00", UNID.centro),
    );
  }
  for (const dia of [2, 4]) {
    banco.inserir(
      "professional_schedule",
      faixa(PROF.bruno, dia, "13:00", "17:00", null),
    );
  }
  banco.inserir("contact", {
    id: CONTATO,
    clinic_id: CLINICA,
    kind: "lead",
    name: "Maria Souza",
    insurance_id: null,
    criado_por_importacao: false,
    birth_date: null,
    cpf: null,
  });
  return banco;
}

function vivaDaConversa(banco: AgendaEmMemoria, conversa: unknown, agora: number) {
  return banco
    .linhas("slot_hold")
    .find(
      (h) =>
        h.conversation_id === conversa &&
        h.consumido_em === null &&
        Date.parse(String(h.expires_at)) > agora,
    );
}

export function rpcsDaAg3(banco: AgendaEmMemoria, opcoes: OpcoesDoContrato) {
  const { catalogo } = opcoes;
  const vinculoDe = (id: unknown) => catalogo.vinculos.find((v) => v.id === id);
  const faltamPara = (dados: Linha | undefined, holdServiceLink: unknown) => {
    const vinculo = vinculoDe(holdServiceLink);
    return dadosQueFaltam({
      exigidos: opcoes.exigidos,
      informados: {
        nome_completo: (dados?.nome_completo ?? null) !== null,
        data_nascimento: (dados?.data_nascimento ?? null) !== null,
        cpf: (dados?.cpf ?? null) !== null,
        carteirinha: (dados?.carteirinha ?? null) !== null,
      },
      vinculo:
        vinculo === undefined
          ? null
          : { procedimentoId: vinculo.procedimentoId, convenioId: vinculo.convenioId },
      catalogo,
    });
  };
  /** A consulta futura ativa do contato, do mesmo procedimento. */
  const consultaDoProcedimento = (procedimentoId: unknown, agora: number) =>
    banco
      .linhas("appointment")
      .find(
        (a) =>
          a.contact_id === CONTATO &&
          vinculoDe(a.service_link_id)?.procedimentoId === procedimentoId &&
          Date.parse(String(a.starts_at)) > agora &&
          !String(a.status).startsWith("cancelado") &&
          a.approval_status !== "recusado",
      );
  const abertaDa = (conversa: unknown) =>
    banco
      .linhas("dados_informados_na_marcacao")
      .find((d) => d.conversation_id === conversa && (d.appointment_id ?? null) === null);

  banco.rpc("reservar_horario_da_ia", (args) => {
    const agora = opcoes.agora();
    const jaTem = banco.linhas("slot_hold").find((h) => h.job_id === args.p_job_id);
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
      return { data: { ok: false, motivo: "vinculo_invalido" }, error: null };
    }
    if (
      args.p_unit_id !== null &&
      !(catalogo.unidades ?? []).some((u) => u.id === args.p_unit_id)
    ) {
      return { data: { ok: false, motivo: "unidade_invalida" }, error: null };
    }
    // Revisao final da AG3: o contato ja tem consulta futura ativa do mesmo
    // procedimento.
    const jaMarcada = consultaDoProcedimento(vinculo.procedimentoId, agora);
    if (jaMarcada) {
      return {
        data: {
          ok: false,
          motivo: "ja_tem_consulta",
          appointment_id: jaMarcada.id,
          starts_at: jaMarcada.starts_at,
        },
        error: null,
      };
    }
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
      return { data: { ok: false, motivo: "ocupado" }, error: null };
    }
    // A reserva nao consumida desta conversa sai (uma por conversa).
    banco.tabelas.set(
      "slot_hold",
      banco
        .linhas("slot_hold")
        .filter(
          (h) => !(h.conversation_id === args.p_conversation_id && h.consumido_em === null),
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
      // Revisao curta das correcoes da AG4: a ancora forte do agendar.
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

  banco.rpc("registrar_dados_da_marcacao", (args) => {
    const agora = opcoes.agora();
    const viva = vivaDaConversa(banco, args.p_conversation_id, agora);
    let aberta = abertaDa(args.p_conversation_id);
    if (args.p_para_o_titular === false) {
      if (aberta) {
        Object.assign(aberta, {
          nome_completo: null,
          data_nascimento: null,
          cpf: null,
          carteirinha: null,
          para_o_titular: false,
        });
      } else {
        banco.inserir("dados_informados_na_marcacao", {
          id: randomUUID(),
          conversation_id: args.p_conversation_id,
          contact_id: CONTATO,
          appointment_id: null,
          para_o_titular: false,
        });
      }
      return { data: { ok: false, motivo: "consulta_para_outra_pessoa" }, error: null };
    }
    const hoje = diaCivil(FUSO, new Date(agora));
    const invalidos: DadoDaMarcacao[] = [];
    if (args.p_nome_completo != null && nomeCompletoValido(String(args.p_nome_completo)) === null) {
      invalidos.push("nome_completo");
    }
    if (
      args.p_data_nascimento != null &&
      (String(args.p_data_nascimento) < "1900-01-01" || String(args.p_data_nascimento) > hoje)
    ) {
      invalidos.push("data_nascimento");
    }
    if (args.p_cpf != null && !cpfValido(String(args.p_cpf).replace(/[^0-9]/g, ""))) {
      invalidos.push("cpf");
    }
    if (args.p_carteirinha != null && carteirinhaValida(String(args.p_carteirinha)) === null) {
      invalidos.push("carteirinha");
    }
    if (invalidos.length > 0) {
      return { data: { ok: false, motivo: "dados_invalidos", invalidos }, error: null };
    }
    if (!aberta || aberta.para_o_titular === false) {
      aberta = {
        id: randomUUID(),
        conversation_id: args.p_conversation_id,
        contact_id: CONTATO,
        appointment_id: null,
        nome_completo: null,
        data_nascimento: null,
        cpf: null,
        carteirinha: null,
        para_o_titular: true,
      };
      banco.tabelas.set(
        "dados_informados_na_marcacao",
        banco
          .linhas("dados_informados_na_marcacao")
          .filter((d) => d.conversation_id !== args.p_conversation_id || d.appointment_id),
      );
      banco.inserir("dados_informados_na_marcacao", aberta);
    }
    aberta.nome_completo = args.p_nome_completo ?? aberta.nome_completo;
    aberta.data_nascimento = args.p_data_nascimento ?? aberta.data_nascimento;
    aberta.cpf = args.p_cpf ?? aberta.cpf;
    aberta.carteirinha = args.p_carteirinha ?? aberta.carteirinha;
    if (aberta.data_nascimento) {
      const dia = viva ? diaCivil(FUSO, new Date(String(viva.starts_at))) : hoje;
      const idade = idadeNoDia(String(aberta.data_nascimento), dia);
      if (idade !== null && idade < 18) {
        return {
          data: { ok: false, motivo: "menor_de_idade", dados_id: aberta.id },
          error: null,
        };
      }
    }
    return {
      data: {
        ok: true,
        dados_id: aberta.id,
        faltam: faltamPara(aberta, viva?.service_link_id),
      },
      error: null,
    };
  });

  banco.rpc("agendar_pela_ia", (args) => {
    const agora = opcoes.agora();
    const consumida = banco
      .linhas("slot_hold")
      .find((h) => h.job_id_do_agendar === args.p_job_id);
    if (consumida) {
      return {
        data: {
          ok: true,
          appointment_id: consumida.appointment_id,
          starts_at: consumida.starts_at,
          ends_at: consumida.ends_at,
          reutilizado: true,
        },
        error: null,
      };
    }
    const viva = banco
      .linhas("slot_hold")
      .find((h) => h.conversation_id === args.p_conversation_id && h.consumido_em === null);
    if (!viva) {
      return { data: { ok: false, motivo: "reserva_inexistente" }, error: null };
    }
    // Revisao final da AG3: a reserva perguntada tem de ser a viva.
    if (
      args.p_slot_hold_id !== undefined &&
      args.p_slot_hold_id !== null &&
      args.p_slot_hold_id !== viva.id
    ) {
      return { data: { ok: false, motivo: "reserva_diferente" }, error: null };
    }
    if (Date.parse(String(viva.expires_at)) <= agora) {
      return { data: { ok: false, motivo: "reserva_vencida" }, error: null };
    }
    if (opcoes.recusarAgendar) {
      const extra =
        opcoes.recusarAgendar === "faltam_dados"
          ? { faltam: faltamPara(abertaDa(args.p_conversation_id), viva.service_link_id) }
          : {};
      return {
        data: { ok: false, motivo: opcoes.recusarAgendar, ...extra },
        error: null,
      };
    }
    const dados = abertaDa(args.p_conversation_id);
    if (dados && dados.para_o_titular === false) {
      return { data: { ok: false, motivo: "consulta_para_outra_pessoa" }, error: null };
    }
    const vinculo = vinculoDe(viva.service_link_id);
    const ja = consultaDoProcedimento(vinculo?.procedimentoId, agora);
    if (ja) {
      return {
        data: { ok: false, motivo: "ja_tem_consulta", appointment_id: ja.id },
        error: null,
      };
    }
    const faltam = faltamPara(dados, viva.service_link_id);
    if (faltam.length > 0) {
      return { data: { ok: false, motivo: "faltam_dados", faltam }, error: null };
    }
    // Revisao curta das correcoes da AG4 (R7 e R9, R10 na ordem): com a
    // conversa e as lidas, a mensagem nova do paciente e a ancora forte
    // (depois da reserva), as ultimas conferencias antes de marcar.
    const desde =
      typeof viva.created_at === "string" ? Date.parse(viva.created_at) : null;
    const conversa = opcoes.conversa?.();
    if (
      mensagemNovaDoPaciente(
        conversa,
        opcoes.lidas?.(String(args.p_job_id)),
        perguntaRespondida(conversa, desde),
      )
    ) {
      return {
        data: { ok: false, motivo: "mensagem_nova_do_paciente" },
        error: null,
      };
    }
    if (!ancoraForte(conversa, desde)) {
      return {
        data: { ok: false, motivo: "sem_confirmacao_do_paciente" },
        error: null,
      };
    }
    const consulta: Linha = {
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
    };
    banco.inserir("appointment", consulta);
    Object.assign(viva, {
      consumido_em: new Date(agora).toISOString(),
      appointment_id: consulta.id,
      job_id_do_agendar: args.p_job_id,
    });
    if (dados) {
      dados.appointment_id = consulta.id;
    }
    return {
      data: {
        ok: true,
        appointment_id: consulta.id,
        starts_at: consulta.starts_at,
        ends_at: consulta.ends_at,
        reutilizado: false,
      },
      error: null,
    };
  });
}
