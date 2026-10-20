// As quatro ferramentas de agenda dentro de UM turno do agente (E4,
// contrato da E4 secao 2). O laco (lib/agente/laco.ts) chama `executar` para
// buscar_horario, reservar_horario, agendar e confirmar_presenca; isto aqui
// guarda o estado do turno e monta a saida para o modelo e o passo da
// trilha. A leitura da Agenda e os efeitos chegam pela PORTA
// (PortaDaAgenda): no WhatsApp, as RPCs com o job_id do turno
// (lib/agente/agenda.ts, a idempotencia: repetir o job nunca cria segunda
// reserva nem segunda consulta); no simulador, a Agenda de verdade para
// buscar e respostas simuladas, sem gravar, para o resto.
//
// Regras do turno:
//  - os codigos h1, h2... sao do turno e nao se repetem (a segunda busca da
//    h4, h5...): reservar so aceita um codigo que uma busca DESTE turno
//    trouxe, e o que vai a RPC e o (service_link_id, starts_at) guardado,
//    nunca o que o modelo escreveu;
//  - no maximo UM reservar_horario, UM agendar e UM confirmar_presenca que
//    chegam a porta por turno (o mesmo job_id devolveria a primeira reserva
//    no lugar da segunda);
//  - agendar no mesmo turno de QUALQUER chamada de reservar_horario (que
//    chegou a porta ou nao: codigo invalido e entrada invalida contam) e
//    "sem_confirmacao_do_paciente" sem chamar a porta: o turno em que o
//    modelo tentou reservar e o da escolha do horario, nunca o da
//    confirmacao; a confirmacao tem de vir numa mensagem nova, depois da
//    reserva (a RPC confere de novo), e a reserva viva de um turno anterior
//    pode ser de outro horario;
//  - "ia_desligada" da RPC e a liberacao que caiu: o turno para como na
//    trava entre rodadas (liberacao_suspensa, sem frase);
//  - erro de leitura ou de RPC, ou resposta fora do formato: falha fechada
//    (a frase fixa e a equipe), porque ninguem sabe o que o banco fez;
//  - confirmar_presenca (revisao da E4): ao modelo vao so o dia e a hora da
//    consulta confirmada (a consulta pode ter sido marcada pela recepcao,
//    fora da conversa: procedimento e profissional ficam na trilha, que nao
//    vai a OpenAI); com um horario reservado nesta conversa esperando a
//    confirmacao, nada e confirmado ("reserva_em_andamento").
// Nada daqui tem texto do paciente: a trilha cita nomes do Cadastro, dias e
// horas.

import {
  ferramentasDoAgente,
  type ConfigDoAgente,
  type FerramentaDeAgenda,
} from "@/lib/domain/agente/config";

import {
  entradaDoAgendarSchema,
  type MotivoDoAgendar,
  type RespostaDoAgendar,
} from "./agendar";
import {
  diaAsHora,
  diaEHora,
  escolherHorarios,
  planejarBuscaDeHorario,
  type AgendaCarregada,
  type HorarioOferecido,
  type PedidoDaAgenda,
} from "./buscar-horario";
import type { CatalogoDoAgente } from "./buscar-procedimento";
import {
  entradaDaConfirmacaoSchema,
  type MotivoDaConfirmacao,
  type RespostaDaConfirmacao,
} from "./confirmar-presenca";
import {
  entradaDaReservaSchema,
  MINUTOS_DA_RESERVA,
  type MotivoDaReserva,
  type RespostaDaReserva,
} from "./reservar-horario";

/**
 * O que o turno pede ao servidor. Cada metodo pode lancar (erro de leitura,
 * de rede, prazo): o turno falha fechado.
 */
export type PortaDaAgenda = {
  /** true no simulador: reservar, agendar e confirmar nao gravam nada. */
  simulada: boolean;
  /** Le a Agenda do pedido (so horarios, nunca dado de paciente). */
  carregar: (pedido: PedidoDaAgenda) => Promise<AgendaCarregada>;
  /** reservar_horario_da_ia com o job_id do turno. */
  reservar: (pedido: {
    serviceLinkId: string;
    inicio: string;
    fim: string;
  }) => Promise<RespostaDaReserva>;
  /** agendar_pela_ia com o job_id do turno. */
  agendar: () => Promise<RespostaDoAgendar>;
  /** A consulta do contato que aguarda confirmacao e confirmar_pelo_paciente. */
  confirmarPresenca: () => Promise<RespostaDaConfirmacao>;
};

export type ResultadoDaFerramentaDeAgenda =
  | {
      tipo: "saida";
      /** JSON para o modelo (function_call_output). */
      saida: string;
      /** O passo da trilha (tipo "agenda"). */
      passo: string;
      /** Centavos de todo valor devolvido (precosDoTurno do filtro). */
      precos: number[];
      /** Codigo do resultado, para log e teste. */
      resultado: string;
    }
  /** A RPC disse ia_desligada: o turno para sem frase (liberacao_suspensa). */
  | { tipo: "liberacao_suspensa"; passo: string }
  /** Leitura ou RPC que falhou, ou resposta fora do formato: falha fechada. */
  | { tipo: "falha"; passo: string };

/** O que a trilha diz de cada motivo das RPCs (linguagem de recepcao). */
export const ROTULO_DO_MOTIVO_DA_AGENDA: Readonly<
  Record<MotivoDaReserva | MotivoDoAgendar, string>
> = {
  ia_desligada: "o assistente não está mais atendendo esta conversa",
  agenda_nao_configurada:
    "a antecedência e o horizonte não estão preenchidos na versão publicada",
  vinculo_invalido:
    "o procedimento ou o profissional não pode mais ser marcado pelo assistente",
  antes_da_antecedencia: "o horário ficou dentro da antecedência mínima",
  depois_do_horizonte: "o horário passou do limite de dias à frente",
  fora_da_jornada: "o horário está fora da jornada do profissional",
  bloqueado: "o horário está bloqueado na agenda",
  ocupado: "o horário já está ocupado",
  reservado_por_outra_conversa: "o horário está reservado em outra conversa",
  reserva_inexistente: "não havia horário reservado nesta conversa",
  reserva_vencida: "a reserva de 10 minutos venceu",
  sem_confirmacao_do_paciente:
    "o paciente ainda não confirmou numa mensagem nova",
  conflito: "a agenda recebeu outra consulta nesse horário",
};

/** O passo da trilha de cada motivo de confirmar_presenca. */
const PASSO_DA_CONFIRMACAO_RECUSADA: Readonly<
  Record<MotivoDaConfirmacao, string>
> = {
  sem_consulta:
    "Procurou a consulta para confirmar a presença: nenhuma aguardando confirmação",
  mais_de_uma:
    "Procurou a consulta para confirmar a presença: mais de uma aguardando confirmação",
  reserva_em_andamento:
    "Não confirmou presença: há um horário reservado nesta conversa esperando a confirmação",
};

const SIMULADO = "No simulador, nada foi gravado.";

export type AgendaDoTurno = {
  executar: (
    nome: FerramentaDeAgenda,
    argumentos: unknown,
  ) => Promise<ResultadoDaFerramentaDeAgenda>;
};

function saida(
  resultado: string,
  corpo: Record<string, unknown>,
  passo: string,
  precos: number[] = [],
): ResultadoDaFerramentaDeAgenda {
  return {
    tipo: "saida",
    saida: JSON.stringify({ resultado, ...corpo }),
    passo,
    precos,
    resultado,
  };
}

/**
 * O executor das ferramentas de agenda de um turno. Sem porta (nenhum
 * servidor para ler a Agenda), toda ferramenta de agenda e falha fechada.
 */
export function criarAgendaDoTurno(entrada: {
  porta: PortaDaAgenda | null;
  catalogo: CatalogoDoAgente;
  config: Pick<ConfigDoAgente, "habilidades" | "agenda">;
  agoraMs: number;
  fuso: string;
}): AgendaDoTurno {
  const { porta, catalogo, agoraMs, fuso } = entrada;
  const horarios = new Map<string, HorarioOferecido>();
  let proximoNumero = 1;
  /** Alguma chamada de reservar_horario neste turno, valida ou nao. */
  let tentouReservar = false;
  /** Um reservar_horario chegou a porta (limite de uma reserva por turno). */
  let chamouReservar = false;
  let chamouAgendar = false;
  let chamouConfirmar = false;

  /** Profissional e procedimento de um vinculo do catalogo, para a saida. */
  const nomesDoVinculo = (
    serviceLinkId: string | null,
  ): { profissional: string; procedimento: string } | null => {
    if (serviceLinkId === null) {
      return null;
    }
    const vinculo = catalogo.vinculos.find((v) => v.id === serviceLinkId);
    const procedimento = catalogo.procedimentos.find(
      (p) => p.id === vinculo?.procedimentoId,
    );
    return vinculo === undefined || procedimento === undefined
      ? null
      : { profissional: vinculo.profissional, procedimento: procedimento.nome };
  };

  const entreParenteses = (
    nomes: { profissional: string; procedimento: string } | null,
  ) =>
    nomes === null ? "" : ` (${nomes.procedimento}, ${nomes.profissional})`;

  async function buscar(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    const plano = planejarBuscaDeHorario({
      catalogo,
      agenda: entrada.config.agenda,
      argumentos,
      agoraMs,
      fuso,
      informarValor: ferramentasDoAgente(
        entrada.config.habilidades,
        entrada.config.agenda,
      ).includes("buscar_procedimento"),
    });
    if (plano.tipo === "resultado") {
      const r = plano.resultado;
      return {
        tipo: "saida",
        saida: r.saida,
        passo: r.passo,
        precos: r.precos,
        resultado: r.resultado,
      };
    }
    let agenda: AgendaCarregada;
    try {
      if (porta === null) {
        throw new Error("sem porta");
      }
      agenda = await porta.carregar(plano.pedido);
    } catch {
      return { tipo: "falha", passo: "Não foi possível ler a agenda agora." };
    }
    const r = escolherHorarios(plano.plano, agenda, proximoNumero);
    proximoNumero += r.horarios.length;
    for (const horario of r.horarios) {
      horarios.set(horario.codigo, horario);
    }
    return {
      tipo: "saida",
      saida: r.saida,
      passo: r.passo,
      precos: r.precos,
      resultado: r.resultado,
    };
  }

  async function reservar(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    // Antes de validar qualquer coisa: o modelo que tenta reservar acha que
    // a pessoa esta escolhendo horario agora, entao agendar neste turno nao.
    tentouReservar = true;
    const lido = entradaDaReservaSchema.safeParse(argumentos);
    if (!lido.success) {
      return saida(
        "entrada_invalida",
        {},
        "Tentou reservar um horário com um pedido incompleto",
      );
    }
    if (chamouReservar) {
      return saida(
        "uma_reserva_por_resposta",
        {},
        "Pediu uma segunda reserva na mesma resposta: recusada",
      );
    }
    const horario = horarios.get(lido.data.horario.toLowerCase());
    if (horario === undefined) {
      return saida(
        "codigo_invalido",
        {},
        "Tentou reservar um horário que a busca desta resposta não trouxe",
      );
    }
    chamouReservar = true;
    let resposta: RespostaDaReserva;
    try {
      if (porta === null) {
        throw new Error("sem porta");
      }
      resposta = await porta.reservar({
        serviceLinkId: horario.serviceLinkId,
        inicio: horario.inicio,
        fim: horario.fim,
      });
    } catch {
      return {
        tipo: "falha",
        passo: "Não foi possível reservar o horário agora.",
      };
    }
    const pedido = `${horario.dia} às ${horario.hora}`;
    if (!resposta.ok) {
      const motivo = ROTULO_DO_MOTIVO_DA_AGENDA[resposta.motivo];
      if (resposta.motivo === "ia_desligada") {
        return {
          tipo: "liberacao_suspensa",
          passo: `Tentou reservar ${pedido}: ${motivo}`,
        };
      }
      return saida(
        resposta.motivo,
        { dia: horario.dia, hora: horario.hora },
        `Tentou reservar ${pedido}: ${motivo}`,
      );
    }
    // Os nomes vem do vinculo da RESERVA: repetir o job devolve a reserva
    // que ele ja tinha, que pode ser de outro horario.
    const mesmoHorario =
      Date.parse(resposta.inicio) === Date.parse(horario.inicio) &&
      (resposta.serviceLinkId === null ||
        resposta.serviceLinkId === horario.serviceLinkId);
    const nomes = mesmoHorario
      ? {
          profissional: horario.profissional,
          procedimento: horario.procedimento,
        }
      : nomesDoVinculo(resposta.serviceLinkId);
    const { dia, hora } = diaEHora(new Date(resposta.inicio), fuso, agoraMs);
    const quando = `${dia} às ${hora}${entreParenteses(nomes)}`;
    return saida(
      "reservado",
      {
        minutos: MINUTOS_DA_RESERVA,
        dia,
        hora,
        ...(nomes === null ? {} : nomes),
      },
      porta?.simulada
        ? `Reservaria ${quando} por ${MINUTOS_DA_RESERVA} minutos. ${SIMULADO}`
        : `Reservou ${quando} por ${MINUTOS_DA_RESERVA} minutos`,
    );
  }

  async function agendar(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    if (!entradaDoAgendarSchema.safeParse(argumentos ?? {}).success) {
      return saida(
        "entrada_invalida",
        {},
        "Tentou marcar a consulta com um pedido fora do formato",
      );
    }
    if (chamouAgendar) {
      return saida(
        "uma_marcacao_por_resposta",
        {},
        "Pediu para marcar de novo na mesma resposta: recusado",
      );
    }
    if (tentouReservar) {
      // A confirmacao tem de vir numa mensagem nova, depois da reserva. O
      // turno que tentou reservar (com ou sem sucesso, com codigo valido ou
      // nao) e o da escolha do horario, nunca o da confirmacao: marcar aqui
      // usaria a reserva viva de antes, que pode ser de outro horario.
      return saida(
        "sem_confirmacao_do_paciente",
        {},
        `Tentou marcar a consulta: ${ROTULO_DO_MOTIVO_DA_AGENDA.sem_confirmacao_do_paciente}`,
      );
    }
    chamouAgendar = true;
    let resposta: RespostaDoAgendar;
    try {
      if (porta === null) {
        throw new Error("sem porta");
      }
      resposta = await porta.agendar();
    } catch {
      return {
        tipo: "falha",
        passo: "Não foi possível marcar a consulta agora.",
      };
    }
    if (!resposta.ok) {
      const motivo = ROTULO_DO_MOTIVO_DA_AGENDA[resposta.motivo];
      if (resposta.motivo === "ia_desligada") {
        return {
          tipo: "liberacao_suspensa",
          passo: `Tentou marcar a consulta: ${motivo}`,
        };
      }
      return saida(resposta.motivo, {}, `Tentou marcar a consulta: ${motivo}`);
    }
    if (porta?.simulada) {
      // O simulador nao guarda a reserva entre as rodadas: sem dia e hora.
      return saida(
        "marcado",
        { pendente: true },
        `Marcaria a consulta reservada, pendente de aprovação da equipe. ${SIMULADO}`,
      );
    }
    const nomes = nomesDoVinculo(resposta.serviceLinkId);
    const quando =
      resposta.inicio === null
        ? null
        : diaEHora(new Date(resposta.inicio), fuso, agoraMs);
    return saida(
      "marcado",
      {
        pendente: true,
        ...(quando === null ? {} : quando),
        ...(nomes === null ? {} : nomes),
      },
      quando === null
        ? "Marcou a consulta reservada, pendente de aprovação da equipe"
        : `Marcou a consulta de ${quando.dia} às ${quando.hora}${entreParenteses(nomes)}, pendente de aprovação da equipe`,
    );
  }

  async function confirmar(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    if (!entradaDaConfirmacaoSchema.safeParse(argumentos ?? {}).success) {
      return saida(
        "entrada_invalida",
        {},
        "Tentou confirmar a presença com um pedido fora do formato",
      );
    }
    if (chamouConfirmar) {
      return saida(
        "uma_confirmacao_por_resposta",
        {},
        "Pediu para confirmar a presença de novo na mesma resposta: recusado",
      );
    }
    chamouConfirmar = true;
    let resposta: RespostaDaConfirmacao;
    try {
      if (porta === null) {
        throw new Error("sem porta");
      }
      resposta = await porta.confirmarPresenca();
    } catch {
      return {
        tipo: "falha",
        passo: "Não foi possível confirmar a presença agora.",
      };
    }
    if (!resposta.ok) {
      return saida(
        resposta.motivo,
        {},
        PASSO_DA_CONFIRMACAO_RECUSADA[resposta.motivo],
      );
    }
    if (porta?.simulada) {
      return saida(
        "confirmada",
        {},
        `Confirmaria a presença na consulta do paciente. ${SIMULADO}`,
      );
    }
    // LGPD (minimizacao): a consulta pode ter sido marcada pela recepcao,
    // fora desta conversa. Ao modelo vao so o dia e a hora; procedimento e
    // profissional ficam na trilha da tela, que nao vai a OpenAI.
    const nomes = nomesDoVinculo(resposta.serviceLinkId);
    if (resposta.inicio === null) {
      return saida(
        "confirmada",
        {},
        `Confirmou a presença na consulta do paciente${entreParenteses(nomes)}`,
      );
    }
    const quando = diaEHora(new Date(resposta.inicio), fuso, agoraMs);
    return saida(
      "confirmada",
      { ...quando },
      `Confirmou a presença na consulta de ${diaAsHora(new Date(resposta.inicio), fuso, agoraMs)}${entreParenteses(nomes)}`,
    );
  }

  return {
    executar: (nome, argumentos) => {
      switch (nome) {
        case "buscar_horario":
          return buscar(argumentos);
        case "reservar_horario":
          return reservar(argumentos);
        case "agendar":
          return agendar(argumentos);
        case "confirmar_presenca":
          return confirmar(argumentos);
      }
    },
  };
}
