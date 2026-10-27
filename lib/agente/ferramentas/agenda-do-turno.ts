// As ferramentas de agenda dentro de UM turno do agente (E4, contrato da E4
// secao 2; AG3). O laco (lib/agente/laco.ts) chama `executar` para
// buscar_horario, reservar_horario, agendar, confirmar_presenca e, desde a
// AG3, registrar_dados_do_paciente e consultar_cadastro_do_contato; isto
// aqui guarda o estado do turno e monta a saida para o modelo e o passo da
// trilha. A leitura da Agenda e os efeitos chegam pela PORTA
// (PortaDaAgenda): no WhatsApp, as RPCs com o job_id do turno
// (lib/agente/agenda.ts, a idempotencia: repetir o job nunca cria segunda
// reserva nem segunda consulta); no simulador, a Agenda de verdade para
// buscar e respostas simuladas, sem gravar, para o resto.
//
// Regras do turno:
//  - no maximo UM reservar_horario, UM agendar e UM confirmar_presenca que
//    chegam a porta por turno (o mesmo job_id devolveria a primeira reserva
//    no lugar da segunda);
//  - agendar no mesmo turno de QUALQUER chamada de reservar_horario (que
//    chegou a porta ou nao: codigo invalido e entrada invalida contam) e
//    "sem_confirmacao_do_paciente" sem chamar a porta: o turno em que o
//    modelo tentou reservar e o da escolha do horario, nunca o da
//    confirmacao;
//  - "ia_desligada" da RPC e a liberacao que caiu: o turno para como na
//    trava entre rodadas (liberacao_suspensa, sem frase);
//  - erro de leitura ou de RPC, ou resposta fora do formato: falha fechada
//    (a frase fixa e a equipe), porque ninguem sabe o que o banco fez;
//  - confirmar_presenca (revisao da E4): ao modelo vao so o dia e a hora da
//    consulta confirmada; com um horario reservado nesta conversa esperando a
//    confirmacao, nada e confirmado ("reserva_em_andamento").
//
// AG3 (27/10/2026), com o estado do atendimento (lib/agente/atendimento.ts):
//  - os codigos (h1, h2...) valem entre as mensagens: os horarios oferecidos
//    do estado entram no mapa do turno, a reserva aceita o codigo de uma
//    busca anterior e a RPC confere tudo de novo. Codigo novo nunca repete
//    um que esta no estado;
//  - antes da primeira rodada (`preparar`), a RECONFERENCIA LEVE: uma
//    leitura da Agenda diz quais horarios do estado continuam livres, a
//    reserva do estado e lida (viva ou vencida) e a consulta marcada nesta
//    conversa tambem (so o dia e a hora). So o que foi conferido agora vira
//    fato de horario livre; o resto o modelo cita como ja oferecido e, para
//    dizer que esta livre, busca de novo;
//  - agendar so com a pergunta "Confirma ...?" feita num turno ANTERIOR
//    (etapa aguardando_confirmacao no comeco do turno), alem da regra da
//    reserva no mesmo turno; e as recusas novas: consulta_para_outra_pessoa
//    e menor_de_idade passam para a equipe (tipo "passar"), ja_tem_consulta
//    diz o dia e a hora da consulta que ja existe (so isso), faltam_dados
//    diz o que falta;
//  - registrar_dados_do_paciente prepara os dados (ferramentas/
//    registrar-dados.ts: o CPF e a carteirinha o servidor acha no texto
//    original) e chama a porta; ao modelo vai so quais campos ficaram
//    registrados, quais faltam e qual teve problema, nunca o valor;
//  - `fechar` devolve o estado novo (etapa, horarios, reserva, consulta,
//    falhas seguidas e desfecho) e `nota` monta a nota para a equipe.
//
// Revisao final da AG3 (27/10/2026):
//  - a etapa aguardando_confirmacao so e armada quando a pergunta
//    "Confirma ...?" traz o dd/mm e o HH:mm da reserva viva (e o
//    profissional e a unidade dela, quando cita) e nenhum outro dia e hora
//    (perguntaConfirmaAReserva); o slot_hold_id do estado e a reserva
//    perguntada, e o agendar manda esse id (p_slot_hold_id): reserva viva
//    diferente e "reserva_diferente", e o modelo pergunta de novo com o
//    horario certo;
//  - a acao (reservou, marcou) e a consulta lida levam o dia, a hora e a
//    unidade aos fatos do turno; a recusa da reserva diz o dia e a hora ao
//    modelo, mas nos fatos isso e eco do pedido (so na frase que nega ou
//    pergunta);
//  - a recusa do agendar pelo horario (conflito, ocupado, bloqueado, fora
//    da jornada...) e a reconferencia que acha o horario da reserva ocupado
//    deixam a reserva PERDIDA (nao viva, codigo ocupado, slot_hold_id
//    nulo); so a reserva cujo horario a reconferencia disse livre e horario
//    livre nos fatos;
//  - reservar recusa ja_tem_consulta (o dia e a hora da consulta que ja
//    existe, antes de qualquer dado);
//  - a reserva que vence no meio do turno (o relogio do turno passa do
//    vencimento) conta como vencida na gravacao, nos fatos e na pergunta.
// Nada daqui tem texto do paciente: a trilha cita nomes do Cadastro, dias,
// horas e os nomes dos campos.

import {
  ferramentasDoAgente,
  type ConfigDoAgente,
  type FerramentaDeAgenda,
  type MotivoDeEscalonamento,
} from "@/lib/domain/agente/config";
import type {
  CoberturaDoTurno,
  FatosDaFerramenta,
  HorarioLivreDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";

import {
  comHorariosOferecidos,
  copiarEstado,
  dadosQueFaltam,
  dadosVazios,
  estadoVazio,
  falhasDepoisDoTurno,
  listaEmTexto,
  notaDaPassagem,
  perguntaConfirmaAReserva,
  proximoNumeroDoCodigo,
  ROTULO_DO_DADO,
  type DadoDaMarcacao,
  type DadosInformados,
  type EstadoDoAtendimento,
  type EtapaDoAtendimento,
  type HorarioDoEstado,
  type HorarioLegivel,
} from "../atendimento";
import type { SaidaParaOsFatos } from "../fatos";
import {
  entradaDoAgendarSchema,
  type MotivoDoAgendar,
  type RespostaDoAgendar,
} from "./agendar";
import {
  diaAsHora,
  diaEHora,
  escolherHorarios,
  horarioContinuaLivre,
  pedidoDaReconferencia,
  planejarBuscaDeHorario,
  type AgendaCarregada,
  type HorarioOferecido,
  type HorarioParaReconferir,
  type PedidoDaAgenda,
} from "./buscar-horario";
import {
  coberturaDoConvenio,
  nomeDoConvenio,
  type CatalogoDoAgente,
  type ConvenioDoAgente,
  type VinculoDoAgente,
} from "./buscar-procedimento";
import {
  entradaDoCadastroDoContatoSchema,
  saidaDoCadastroDoContato,
  type CadastroDoContato,
} from "./cadastro-do-contato";
import {
  entradaDaConfirmacaoSchema,
  type MotivoDaConfirmacao,
  type RespostaDaConfirmacao,
} from "./confirmar-presenca";
import {
  entradaDoRegistroDeDadosSchema,
  prepararRegistro,
  resultadoDoProblema,
  type DadosParaRegistrar,
  type MensagemDoPaciente,
  type ProblemaDoCampo,
  type RespostaDoRegistro,
} from "./registrar-dados";
import {
  entradaDaReservaSchema,
  MINUTOS_DA_RESERVA,
  type MotivoDaReserva,
  type RespostaDaReserva,
} from "./reservar-horario";

/** A reserva do estado como a porta le (AG3). */
export type ReservaLida = {
  viva: boolean;
  serviceLinkId: string;
  /** ISO (UTC). */
  inicio: string;
  fim: string;
  unidadeId: string | null;
  /**
   * Revisao final da AG3: quando a reserva vence (ISO, UTC). A reserva que
   * vence no meio do turno conta como vencida na gravacao e na resposta.
   * Ausente: so vale o "viva" da leitura.
   */
  expiraEm?: string | null;
};

/**
 * Revisao final da AG3: a reserva viva da conversa, qualquer que seja (a
 * recusa reserva_diferente do agendar), com o id dela.
 */
export type ReservaVivaDaConversa = ReservaLida & { holdId: string };

/** A consulta como a porta le (AG3): so o inicio e se continua de pe. */
export type ConsultaLida = {
  /** ISO (UTC). */
  inicio: string;
  /** Nao cancelada, nem recusada, nem que ja passou. */
  ativa: boolean;
  /** Revisao final da AG3: a unidade da consulta (null: sem unidade). */
  unidadeId?: string | null;
};

/**
 * O que o turno pede ao servidor. Cada metodo pode lancar (erro de leitura,
 * de rede, prazo): o turno falha fechado. Os metodos da AG3 sao opcionais
 * (a porta de antes da AG3 nao tem): sem eles, a ferramenta que precisa
 * falha fechado e a reconferencia nao acontece.
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
    /** AG3: a unidade do horario (null = sem unidade). */
    unidadeId?: string | null;
  }) => Promise<RespostaDaReserva>;
  /**
   * agendar_pela_ia com o job_id do turno. Revisao final da AG3: com a
   * reserva que a pergunta "Confirma ...?" mostrou (p_slot_hold_id); a RPC
   * recusa reserva_diferente quando a reserva viva e outra. Sem o pedido
   * (ou com o id nulo), a reserva viva da conversa, como antes.
   */
  agendar: (pedido?: { slotHoldId: string | null }) => Promise<RespostaDoAgendar>;
  /** A consulta do contato que aguarda confirmacao e confirmar_pelo_paciente. */
  confirmarPresenca: () => Promise<RespostaDaConfirmacao>;
  /** AG3: registrar_dados_da_marcacao com o job_id do turno. */
  registrarDados?: (dados: DadosParaRegistrar) => Promise<RespostaDoRegistro>;
  /** AG3: os sinais do cadastro do contato da conversa. */
  lerCadastroDoContato?: () => Promise<CadastroDoContato>;
  /** AG3: a reserva do estado (da conversa), ou null. */
  lerReserva?: (holdId: string) => Promise<ReservaLida | null>;
  /** AG3: uma consulta do contato da conversa, ou null. */
  lerConsulta?: (appointmentId: string) => Promise<ConsultaLida | null>;
  /**
   * Revisao final da AG3: a reserva viva da conversa (a do agendar que
   * recusou reserva_diferente), ou null. Lanca na leitura que falha.
   */
  lerReservaViva?: () => Promise<ReservaVivaDaConversa | null>;
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
      /**
       * Os fatos do turno (AG2): a acao que deu certo (reservado, marcado,
       * confirmada, inclusive no simulador, que mostra o que a IA diria),
       * a consulta lida e o que a busca afirma do convenio.
       */
      fatos?: FatosDaFerramenta;
    }
  /**
   * AG3: a recusa que passa a conversa para a equipe (consulta para outra
   * pessoa, menor de idade, D-8), com o motivo do banco.
   */
  | {
      tipo: "passar";
      motivo: Extract<
        MotivoDeEscalonamento,
        "consulta_para_outra_pessoa" | "menor_de_idade"
      >;
      passo: string;
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
  unidade_invalida: "a unidade não pode mais ser marcada pelo assistente",
  antes_da_antecedencia: "o horário ficou dentro da antecedência mínima",
  depois_do_horizonte: "o horário passou do limite de dias à frente",
  fora_da_jornada: "o horário está fora da jornada do profissional",
  bloqueado: "o horário está bloqueado na agenda",
  ocupado: "o horário já está ocupado",
  reservado_por_outra_conversa: "o horário está reservado em outra conversa",
  reserva_inexistente: "não havia horário reservado nesta conversa",
  reserva_vencida: "a reserva de 10 minutos venceu",
  reserva_diferente:
    "o horário reservado nesta conversa não é o que a pessoa confirmou",
  sem_confirmacao_do_paciente:
    "o paciente ainda não confirmou numa mensagem nova",
  conflito: "a agenda recebeu outra consulta nesse horário",
  consulta_para_outra_pessoa: "a consulta é para outra pessoa",
  menor_de_idade: "o paciente é menor de idade",
  ja_tem_consulta: "o paciente já tem consulta marcada deste procedimento",
  faltam_dados: "faltam dados do paciente para marcar",
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

/**
 * Onde o atendimento parou, em texto de recepcao, pelo ultimo resultado de
 * agenda que conta (a nota para a equipe). Fora daqui, vale o motivo da
 * passagem.
 */
const PAROU_EM: Readonly<Record<string, string>> = {
  hora_pedida_ocupada: "a hora pedida não estava livre",
  sem_horario: "não havia horário livre no período pedido",
  agenda_nao_cadastrada: "a agenda do profissional não está cadastrada",
  nao_atende_na_unidade: "o profissional não atende na unidade pedida",
  idade_nao_atendida: "o profissional não atende a idade do paciente",
  convenio_nao_atendido: "o convênio não é atendido neste procedimento",
  convenio_so_com_a_equipe: "o convênio só é marcado pela equipe",
  procedimento_nao_agendavel: "o procedimento só é marcado pela equipe",
  reserva_vencida: "a reserva de 10 minutos venceu",
  reserva_diferente: "o horário reservado mudou antes da confirmação",
  ocupado: "o horário escolhido deixou de estar livre",
  conflito: "o horário escolhido deixou de estar livre",
  reservado_por_outra_conversa: "o horário escolhido estava reservado em outra conversa",
  faltam_dados: "faltaram dados do paciente para marcar",
  ja_tem_consulta: "o paciente já tem consulta deste procedimento",
  consulta_para_outra_pessoa: "a consulta é para outra pessoa",
  menor_de_idade: "o paciente é menor de idade",
  cpf_invalido: "o CPF informado não confere",
  dados_invalidos: "um dado informado não está no formato",
};

const SIMULADO = "No simulador, nada foi gravado.";

/** O atendimento com que o turno comeca (o estado lido e os dados). */
export type AtendimentoDoTurno = {
  estado: EstadoDoAtendimento;
  dados: DadosInformados;
};

/** A situacao de um horario do estado, depois da reconferencia. */
export type SituacaoDoHorario = "livre" | "ocupado" | "nao_conferido";

/** Um horario do estado como vai ao bloco <atendimento_em_andamento>. */
export type HorarioParaOModelo = HorarioLegivel & {
  codigo: string;
  procedimento: string;
  unidadeCodigo: string | null;
  situacao: SituacaoDoHorario;
};

/** O que vai ao modelo do estado (lib/agente/prompt.ts monta o bloco). */
export type AtendimentoParaOModelo = {
  etapa: EtapaDoAtendimento;
  procedimento: { codigo: string; nome: string } | null;
  profissional: { codigo: string | null; nome: string } | null;
  pagamento: string | null;
  unidade: { codigo: string; nome: string } | null;
  horarios: HorarioParaOModelo[];
  reserva:
    | (HorarioLegivel & {
        codigo: string | null;
        procedimento: string;
        /**
         * Revisao final da AG3: "perdida" e a reserva cujo horario deixou
         * de estar livre (a reconferencia achou ocupado, ou o agendar
         * recusou pelo horario).
         */
        situacao: "viva" | "vencida" | "nao_conferida" | "perdida";
      })
    | null;
  informados: DadoDaMarcacao[];
  faltam: DadoDaMarcacao[];
  paraOTitular: boolean | null;
  consulta: { dia: string; hora: string } | null;
  falhasSeguidas: number;
};

export type FechamentoDoTurno = {
  estado: EstadoDoAtendimento;
  dados: DadosInformados;
};

export type AgendaDoTurno = {
  executar: (
    nome: FerramentaDeAgenda,
    argumentos: unknown,
  ) => Promise<ResultadoDaFerramentaDeAgenda>;
  /**
   * AG3: a reconferencia leve, antes da primeira rodada (os horarios do
   * estado, a reserva e a consulta marcada nesta conversa). Nunca lanca:
   * leitura que falha so deixa tudo "nao conferido".
   */
  preparar: () => Promise<void>;
  /** AG3: o estado para o bloco do modelo (null: nada em andamento). */
  paraOModelo: () => AtendimentoParaOModelo | null;
  /** AG3: os fatos que vem do estado (fonte de dia e hora), ou null. */
  fatosDoEstado: () => SaidaParaOsFatos | null;
  /** AG3: os codigos de resultado das ferramentas deste turno, em ordem. */
  resultados: () => string[];
  /** AG3: as falhas seguidas depois deste turno (item 9). */
  falhasDepois: () => number;
  /** AG3: o estado e os dados depois do turno. */
  fechar: (entrada: {
    /** A resposta que vai sair (null: o turno passou para a equipe). */
    mensagemFinal: string | null;
    passou: boolean;
  }) => FechamentoDoTurno;
  /** AG3: a nota para a equipe na passagem (null: nada a contar). */
  nota: (motivo: string) => string | null;
  /**
   * Revisao final da AG3 (LGPD): os nomes completos que o modelo mandou
   * registrar neste turno (como ele copiou e como o paciente escreveu), so
   * para mascarar a copia do verificador. Nunca vai para log nem para fora
   * do turno.
   */
  nomesCitados: () => string[];
};

function saida(
  resultado: string,
  corpo: Record<string, unknown>,
  passo: string,
  precos: number[] = [],
  fatos?: FatosDaFerramenta,
): ResultadoDaFerramentaDeAgenda {
  return {
    tipo: "saida",
    saida: JSON.stringify({ resultado, ...corpo }),
    passo,
    precos,
    resultado,
    ...(fatos === undefined ? {} : { fatos }),
  };
}

/** A reserva que o turno conhece (a do estado ou a feita no turno). */
type ReservaDoTurno = {
  /** O horario do codigo (null: o horario da reserva nao tem codigo no mapa). */
  horario: HorarioOferecido | null;
  leitura: ReservaLida | null;
  /** true: viva na leitura; false: vencida ou sumiu; null: nao conferida. */
  viva: boolean | null;
  /**
   * Revisao final da AG3: o horario deixou de estar livre (a reconferencia
   * achou ocupado, ou o agendar recusou pelo horario). A reserva perdida nao
   * e viva, o codigo dela fica ocupado e o estado nao guarda o id.
   */
  perdida: boolean;
  /** Revisao final da AG3: o que a reconferencia disse do horario dela. */
  situacao: SituacaoDoHorario;
  /** slot_hold.id (null: a RPC nao devolveu). */
  holdId: string | null;
};

/**
 * Revisao final da AG3: as recusas do agendar pelo horario (a reserva fica
 * perdida: o horario nao vira consulta).
 */
const RECUSAS_PELO_HORARIO: ReadonlySet<string> = new Set([
  "conflito",
  "ocupado",
  "bloqueado",
  "fora_da_jornada",
  "antes_da_antecedencia",
  "depois_do_horizonte",
  "reservado_por_outra_conversa",
  "vinculo_invalido",
  "unidade_invalida",
]);

/** O codigo interno do horario da reserva sem codigo, na reconferencia. */
const CODIGO_DA_RESERVA = "reserva";

/** Hoje (aaaa-mm-dd) no fuso dado. */
function hojeNoFuso(agoraMs: number, fuso: string): string {
  try {
    const texto = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(agoraMs));
    return /^\d{4}-\d{2}-\d{2}$/.test(texto)
      ? texto
      : new Date(agoraMs).toISOString().slice(0, 10);
  } catch {
    return new Date(agoraMs).toISOString().slice(0, 10);
  }
}

/** O instante em UTC com Z (a forma que o estado guarda). */
function emUtc(iso: string): string {
  return new Date(Date.parse(iso)).toISOString();
}

/**
 * O executor das ferramentas de agenda de um turno. Sem porta (nenhum
 * servidor para ler a Agenda), toda ferramenta de agenda e falha fechada.
 */
export function criarAgendaDoTurno(entrada: {
  porta: PortaDaAgenda | null;
  catalogo: CatalogoDoAgente;
  config: Pick<ConfigDoAgente, "habilidades" | "agenda"> &
    Partial<Pick<ConfigDoAgente, "dadosExigidos">>;
  agoraMs: number;
  fuso: string;
  /**
   * AG3: o estado do atendimento lido no comeco do turno. Ausente ou nulo:
   * como antes da AG3 (codigos so do turno, sem a etapa no agendar).
   */
  atendimento?: AtendimentoDoTurno | null;
  /** AG3: as mensagens do paciente (registrar_dados_do_paciente). */
  mensagens?: {
    doPaciente: readonly MensagemDoPaciente[];
    pendentes: readonly MensagemDoPaciente[];
  };
  /** AG3: os nascimentos conhecidos (cadastro e informado), para a idade. */
  nascimentos?: readonly string[];
  /**
   * Revisao final da AG3: o relogio do turno (a reserva que vence no meio
   * do turno conta como vencida). Ausente: o instante do comeco do turno.
   */
  agora?: () => number;
}): AgendaDoTurno {
  const { porta, catalogo, agoraMs, fuso } = entrada;
  const relogio = entrada.agora ?? (() => agoraMs);
  const comEstado =
    entrada.atendimento !== null && entrada.atendimento !== undefined;
  const estado: EstadoDoAtendimento = comEstado
    ? copiarEstado(entrada.atendimento!.estado)
    : estadoVazio();
  const dados: DadosInformados = comEstado
    ? {
        ...entrada.atendimento!.dados,
        faltam: [...entrada.atendimento!.dados.faltam],
      }
    : dadosVazios();
  const etapaInicial = estado.etapa;
  const exigidos = entrada.config.dadosExigidos ?? {
    nomeCompleto: false,
    nascimento: false,
    cpf: false,
  };
  const agendaLigada = ferramentasDoAgente(
    entrada.config.habilidades,
    entrada.config.agenda,
  ).includes("buscar_horario");

  const horarios = new Map<string, HorarioOferecido>();
  const situacoes = new Map<string, "livre" | "ocupado">();
  /** O ultimo numero de codigo dado neste turno (os novos vem depois). */
  let ultimoNumero = 0;
  /** Alguma chamada de reservar_horario neste turno, valida ou nao. */
  let tentouReservar = false;
  /** Um reservar_horario chegou a porta (limite de uma reserva por turno). */
  let chamouReservar = false;
  let chamouAgendar = false;
  let chamouConfirmar = false;
  const resultados: string[] = [];
  /** Os nomes que o modelo mandou registrar (so para mascarar o verificador). */
  const nomesCitados: string[] = [];
  let ultimaPreferencia: { periodo: string | null; hora: string | null } | null =
    null;
  /** A reserva conhecida: a deste turno ou a do estado, conferida. */
  let reserva: ReservaDoTurno | null = null;
  /** A consulta marcada nesta conversa (o estado), relida no turno. */
  let consultaLida: { dia: string; hora: string; unidade: string | null } | null =
    null;
  let consultaDoTurno: { dia: string; hora: string } | null = null;

  /**
   * Revisao final da AG3: a reserva vale agora? Viva na leitura (ou feita
   * neste turno), nao perdida e, pelo relogio do turno, ainda nao vencida.
   */
  const reservaVivaAgora = (r: ReservaDoTurno | null = reserva): boolean => {
    if (r === null || r.viva !== true || r.perdida) {
      return false;
    }
    const expira = r.leitura?.expiraEm ?? null;
    return expira === null || !(Date.parse(expira) <= relogio());
  };
  /** A reserva que se sabe morta (vencida, sumida ou perdida). */
  const reservaMorta = (r: ReservaDoTurno | null = reserva): boolean =>
    r !== null && (r.viva === false || r.perdida || (r.viva === true && !reservaVivaAgora(r)));

  /** O nome da unidade pelo id (null: sem unidade ou fora do catalogo). */
  const nomeDaUnidade = (id: string | null | undefined): string | null =>
    id === null || id === undefined
      ? null
      : ((catalogo.unidades ?? []).find((u) => u.id === id)?.nome ?? null);

  /** O vinculo do catalogo pelo id. */
  const vinculoDe = (id: string | null): VinculoDoAgente | undefined =>
    id === null ? undefined : catalogo.vinculos.find((v) => v.id === id);

  const procedimentoDe = (procedimentoId: string | undefined) =>
    [...catalogo.procedimentos, ...(catalogo.procedimentosSoComAEquipe ?? [])].find(
      (p) => p.id === procedimentoId,
    );

  const convenioDe = (id: string | null): ConvenioDoAgente | undefined =>
    id === null
      ? undefined
      : [...catalogo.conveniosDoCadastro, ...catalogo.convenios].find(
          (c) => c.id === id,
        );

  /** Um horario do estado com dia, hora e nomes (null: o vinculo saiu). */
  const doEstado = (h: HorarioDoEstado): HorarioOferecido | null => {
    const vinculo = vinculoDe(h.service_link_id);
    const procedimento = procedimentoDe(vinculo?.procedimentoId);
    if (
      vinculo === undefined ||
      vinculo.id === null ||
      vinculo.duracaoMin === null ||
      procedimento === undefined ||
      vinculo.profissionalId !== h.professional_id
    ) {
      return null;
    }
    const unidade =
      h.unit_id === null
        ? null
        : ((catalogo.unidades ?? []).find((u) => u.id === h.unit_id) ?? null);
    if (h.unit_id !== null && unidade === null) {
      return null;
    }
    const { dia, hora } = diaEHora(new Date(h.starts_at), fuso, agoraMs);
    return {
      codigo: h.codigo,
      serviceLinkId: vinculo.id,
      profissionalId: vinculo.profissionalId,
      inicio: emUtc(h.starts_at),
      fim: emUtc(h.ends_at),
      dia,
      hora,
      profissional: vinculo.profissional,
      procedimento: procedimento.nome,
      duracaoMin: vinculo.duracaoMin,
      unidadeId: unidade?.id ?? null,
      unidade: unidade?.nome ?? null,
      unidadeCodigo: unidade?.codigo ?? null,
      convenioId: vinculo.convenioId,
      oferecidoEm: emUtc(h.oferecido_em),
    };
  };

  // Os horarios do estado entram no mapa do turno (o codigo vale de uma
  // mensagem para a outra). O que saiu do catalogo fica de fora.
  for (const h of estado.horarios_oferecidos) {
    const lido = doEstado(h);
    if (lido !== null) {
      horarios.set(lido.codigo, lido);
    }
  }
  estado.horarios_oferecidos = estado.horarios_oferecidos.filter((h) =>
    horarios.has(h.codigo),
  );

  const proximoCodigo = (): string => {
    const numero = proximoNumeroDoCodigo([...horarios.keys()], ultimoNumero);
    ultimoNumero = numero;
    return `h${numero}`;
  };

  const paraOEstado = (h: HorarioOferecido): HorarioDoEstado => ({
    codigo: h.codigo,
    service_link_id: h.serviceLinkId,
    professional_id: h.profissionalId,
    unit_id: h.unidadeId,
    starts_at: emUtc(h.inicio),
    ends_at: emUtc(h.fim),
    oferecido_em: h.oferecidoEm,
  });

  /** Profissional e procedimento de um vinculo do catalogo, para a saida. */
  const nomesDoVinculo = (
    serviceLinkId: string | null,
  ): { profissional: string; procedimento: string } | null => {
    const vinculo = vinculoDe(serviceLinkId);
    const procedimento = procedimentoDe(vinculo?.procedimentoId);
    return vinculo === undefined || procedimento === undefined
      ? null
      : { profissional: vinculo.profissional, procedimento: procedimento.nome };
  };

  const entreParenteses = (
    nomes: { profissional: string; procedimento: string } | null,
  ) =>
    nomes === null ? "" : ` (${nomes.procedimento}, ${nomes.profissional})`;

  /** "particular" ou o nome do convenio (e plano) do vinculo. */
  const pagamentoDoVinculo = (convenioId: string | null): string | null => {
    if (convenioId === null) {
      return "particular";
    }
    const convenio = convenioDe(convenioId);
    return convenio === undefined ? null : nomeDoConvenio(convenio);
  };

  /** O fato "atende" do convenio do vinculo no procedimento dele. */
  const coberturaDoVinculo = (
    serviceLinkId: string | null,
  ): CoberturaDoTurno[] => {
    const vinculo = vinculoDe(serviceLinkId);
    const convenio = convenioDe(vinculo?.convenioId ?? null);
    const procedimento = procedimentoDe(vinculo?.procedimentoId);
    return convenio === undefined || procedimento === undefined
      ? []
      : [coberturaDoConvenio(convenio, "atende", procedimento.nome)];
  };

  /** Os dados que faltam agora, com o vinculo da reserva viva. */
  const recalcularFaltam = (serviceLinkId: string | null) => {
    const vinculo = vinculoDe(serviceLinkId);
    dados.faltam = dadosQueFaltam({
      exigidos,
      informados: dados,
      vinculo:
        vinculo === undefined
          ? null
          : {
              procedimentoId: vinculo.procedimentoId,
              convenioId: vinculo.convenioId,
            },
      catalogo,
    });
  };

  // -------------------------------------------------------------------------
  // A reconferencia leve (AG3)
  // -------------------------------------------------------------------------

  async function preparar(): Promise<void> {
    if (!comEstado || porta === null) {
      return;
    }
    // A reserva do estado: viva ou vencida (e o horario dela).
    if (estado.slot_hold_id !== null && porta.lerReserva !== undefined) {
      const holdId = estado.slot_hold_id;
      try {
        const lida = await porta.lerReserva(holdId);
        if (lida !== null) {
          const codigo =
            [...horarios.values()].find(
              (h) =>
                h.serviceLinkId === lida.serviceLinkId &&
                Date.parse(h.inicio) === Date.parse(lida.inicio),
            ) ?? null;
          reserva = {
            horario: codigo,
            leitura: lida,
            viva: lida.viva,
            perdida: false,
            situacao: "nao_conferido",
            holdId,
          };
        } else {
          // Revisao final da AG3: a reserva que sumiu (a manutencao apaga a
          // vencida) e nula na gravacao e na resposta.
          reserva = {
            horario: null,
            leitura: null,
            viva: false,
            perdida: false,
            situacao: "nao_conferido",
            holdId,
          };
        }
      } catch {
        reserva = {
          horario: null,
          leitura: null,
          viva: null,
          perdida: false,
          situacao: "nao_conferido",
          holdId,
        };
      }
    }
    // A consulta marcada nesta conversa (so o dia, a hora e a unidade).
    if (estado.appointment_id !== null && porta.lerConsulta !== undefined) {
      try {
        const lida = await porta.lerConsulta(estado.appointment_id);
        if (lida !== null && lida.ativa) {
          consultaLida = {
            ...diaEHora(new Date(lida.inicio), fuso, agoraMs),
            unidade: nomeDaUnidade(lida.unidadeId),
          };
        }
      } catch {
        consultaLida = null;
      }
    }
    // Os horarios oferecidos e, revisao final da AG3, o horario da reserva
    // viva: continuam livres? (A reserva desta conversa nao ocupa o horario
    // dela.)
    if (!agendaLigada) {
      return;
    }
    const lista: HorarioParaReconferir[] = [...horarios.values()].map((h) => ({
      codigo: h.codigo,
      serviceLinkId: h.serviceLinkId,
      unidadeId: h.unidadeId,
      inicio: h.inicio,
      fim: h.fim,
    }));
    const daReserva: HorarioParaReconferir | null =
      reserva !== null &&
      reserva.viva === true &&
      reserva.horario === null &&
      reserva.leitura !== null
        ? {
            codigo: CODIGO_DA_RESERVA,
            serviceLinkId: reserva.leitura.serviceLinkId,
            unidadeId: reserva.leitura.unidadeId,
            inicio: reserva.leitura.inicio,
            fim: reserva.leitura.fim,
          }
        : null;
    const todos = daReserva === null ? lista : [...lista, daReserva];
    if (todos.length === 0) {
      return;
    }
    const pedido = pedidoDaReconferencia(catalogo, todos);
    if (pedido === null) {
      return;
    }
    try {
      const agenda = await porta.carregar(pedido);
      for (const h of todos) {
        const situacao = horarioContinuaLivre({
          catalogo,
          agenda,
          config: entrada.config.agenda,
          horario: h,
          agoraMs,
          fuso,
        })
          ? "livre"
          : "ocupado";
        if (h === daReserva) {
          if (reserva !== null) {
            reserva.situacao = situacao;
          }
        } else {
          situacoes.set(h.codigo, situacao);
        }
      }
    } catch {
      situacoes.clear();
    }
    // A reserva com codigo fica com a situacao do codigo; a viva cujo
    // horario a reconferencia achou ocupado esta perdida.
    if (reserva !== null) {
      if (reserva.horario !== null) {
        reserva.situacao = situacoes.get(reserva.horario.codigo) ?? "nao_conferido";
      }
      if (reserva.viva === true && reserva.situacao === "ocupado") {
        reserva.perdida = true;
      }
    }
  }

  // -------------------------------------------------------------------------
  // As ferramentas
  // -------------------------------------------------------------------------

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
      nascimentos: entrada.nascimentos ?? [],
    });
    estado.intencao = "agendar";
    if (estado.etapa === "informacao") {
      estado.etapa = "escolha";
    }
    if (plano.tipo === "resultado") {
      const r = plano.resultado;
      resultados.push(r.resultado);
      return {
        tipo: "saida",
        saida: r.saida,
        passo: r.passo,
        precos: r.precos,
        resultado: r.resultado,
        ...(r.fatos === undefined ? {} : { fatos: r.fatos }),
      };
    }
    ultimaPreferencia = {
      periodo: plano.plano.periodo,
      hora: plano.plano.hora ?? null,
    };
    estado.procedure_id = plano.plano.procedimento.id;
    let agenda: AgendaCarregada;
    try {
      if (porta === null) {
        throw new Error("sem porta");
      }
      agenda = await porta.carregar(plano.pedido);
    } catch {
      return { tipo: "falha", passo: "Não foi possível ler a agenda agora." };
    }
    const r = escolherHorarios(plano.plano, agenda, proximoCodigo);
    resultados.push(r.resultado);
    for (const horario of r.horarios) {
      horarios.set(horario.codigo, horario);
      situacoes.set(horario.codigo, "livre");
    }
    if (r.horarios.length > 0) {
      const reservado = reserva?.horario?.codigo ?? null;
      estado.horarios_oferecidos = comHorariosOferecidos(
        estado.horarios_oferecidos,
        r.horarios.map(paraOEstado),
        reservado,
      );
      // O que saiu da lista do estado sai tambem do mapa do turno? Nao: o
      // codigo continua valendo ate o fim deste turno (o modelo acabou de
      // ver); o estado guarda os 9 mais novos.
      estado.etapa = "oferta";
    }
    estado.professional_id = plano.plano.profissionalId ?? null;
    if (plano.plano.convenioDoCadastro) {
      estado.insurance_id = plano.plano.convenioDoCadastro.id;
      estado.particular = false;
    } else {
      estado.insurance_id = null;
      estado.particular = true;
    }
    estado.unit_id = plano.plano.unidade?.id ?? null;
    return {
      tipo: "saida",
      saida: r.saida,
      passo: r.passo,
      precos: r.precos,
      resultado: r.resultado,
      ...(r.fatos === undefined ? {} : { fatos: r.fatos }),
    };
  }

  async function reservar(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    // Antes de validar qualquer coisa: o modelo que tenta reservar acha que
    // a pessoa esta escolhendo horario agora, entao agendar neste turno nao.
    tentouReservar = true;
    estado.intencao = "agendar";
    const lido = entradaDaReservaSchema.safeParse(argumentos);
    if (!lido.success) {
      resultados.push("entrada_invalida");
      return saida(
        "entrada_invalida",
        {},
        "Tentou reservar um horário com um pedido incompleto",
      );
    }
    if (chamouReservar) {
      resultados.push("uma_reserva_por_resposta");
      return saida(
        "uma_reserva_por_resposta",
        {},
        "Pediu uma segunda reserva na mesma resposta: recusada",
      );
    }
    const horario = horarios.get(lido.data.horario.toLowerCase());
    if (horario === undefined) {
      resultados.push("codigo_invalido");
      return saida(
        "codigo_invalido",
        {},
        comEstado
          ? "Tentou reservar um horário que nenhuma busca trouxe"
          : "Tentou reservar um horário que a busca desta resposta não trouxe",
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
        unidadeId: horario.unidadeId,
      });
    } catch {
      return {
        tipo: "falha",
        passo: "Não foi possível reservar o horário agora.",
      };
    }
    const pedido = `${horario.dia} às ${horario.hora}`;
    if (!resposta.ok) {
      resultados.push(resposta.motivo);
      const motivo = ROTULO_DO_MOTIVO_DA_AGENDA[resposta.motivo];
      if (resposta.motivo === "ia_desligada") {
        return {
          tipo: "liberacao_suspensa",
          passo: `Tentou reservar ${pedido}: ${motivo}`,
        };
      }
      if (resposta.motivo === "ja_tem_consulta") {
        // Revisao final da AG3 (item 6): o contato ja tem consulta futura
        // ativa deste procedimento. Ao modelo, so o dia e a hora dela (pode
        // ter sido marcada pela recepcao, fora desta conversa), antes de
        // qualquer dado; nada foi reservado.
        return jaTemConsulta(
          resposta.inicio,
          resposta.appointmentId,
          `Não reservou ${pedido}: ${motivo}`,
        );
      }
      situacoes.set(horario.codigo, "ocupado");
      // Revisao final da AG3 (item 5): o dia e a hora recusados vao ao
      // modelo (para dizer que esse horario nao esta mais livre), mas nos
      // fatos sao eco do pedido: so na frase que nega ou pergunta.
      return saida(
        resposta.motivo,
        { dia: horario.dia, hora: horario.hora },
        `Tentou reservar ${pedido}: ${motivo}`,
        [],
        {
          ecos: [pedido],
          saidaSemEco: JSON.stringify({ resultado: resposta.motivo }),
        },
      );
    }
    resultados.push("reservado");
    // Os nomes vem do vinculo da RESERVA: repetir o job devolve a reserva
    // que ele ja tinha, que pode ser de outro horario.
    const mesmoHorario =
      Date.parse(resposta.inicio) === Date.parse(horario.inicio) &&
      (resposta.serviceLinkId === null ||
        resposta.serviceLinkId === horario.serviceLinkId);
    const serviceLinkId = mesmoHorario
      ? horario.serviceLinkId
      : (resposta.serviceLinkId ?? null);
    const nomes = mesmoHorario
      ? {
          profissional: horario.profissional,
          procedimento: horario.procedimento,
        }
      : nomesDoVinculo(serviceLinkId);
    const unidadeId = resposta.unitId ?? (mesmoHorario ? horario.unidadeId : null);
    const unidade =
      unidadeId === null
        ? null
        : ((catalogo.unidades ?? []).find((u) => u.id === unidadeId) ?? null);
    const { dia, hora } = diaEHora(new Date(resposta.inicio), fuso, agoraMs);
    const vinculo = vinculoDe(serviceLinkId);
    const pagamento = pagamentoDoVinculo(vinculo?.convenioId ?? null);
    // O estado: a reserva viva, o pedido (do vinculo e do horario).
    estado.slot_hold_id = resposta.holdId;
    if (vinculo !== undefined) {
      estado.procedure_id = vinculo.procedimentoId;
      estado.professional_id = vinculo.profissionalId;
      estado.insurance_id = vinculo.convenioId;
      estado.particular = vinculo.convenioId === null;
    }
    estado.unit_id = unidadeId;
    if (estado.etapa === "informacao" || estado.etapa === "escolha") {
      estado.etapa = "oferta";
    }
    const reservado: HorarioOferecido | null = mesmoHorario
      ? { ...horario, unidadeId, unidade: unidade?.nome ?? null, unidadeCodigo: unidade?.codigo ?? null }
      : null;
    reserva = {
      horario: reservado,
      leitura: {
        viva: true,
        serviceLinkId: serviceLinkId ?? horario.serviceLinkId,
        inicio: resposta.inicio,
        fim: resposta.fim,
        unidadeId,
        expiraEm: resposta.expiraEm,
      },
      viva: true,
      perdida: false,
      // A RPC acabou de conferir o horario.
      situacao: "livre",
      holdId: resposta.holdId,
    };
    recalcularFaltam(serviceLinkId);
    const quando = `${dia} às ${hora}${entreParenteses(nomes)}${unidade === null ? "" : `, unidade ${unidade.nome}`}`;
    const livre: HorarioLivreDoTurno = { dia, hora, unidade: unidade?.nome ?? null };
    return saida(
      "reservado",
      {
        minutos: MINUTOS_DA_RESERVA,
        dia,
        hora,
        ...(nomes === null ? {} : nomes),
        unidade: unidade?.nome ?? null,
        ...(pagamento === null ? {} : { pagamento }),
        ...(comEstado ? { dados_que_faltam: dados.faltam } : {}),
      },
      porta?.simulada
        ? `Reservaria ${quando} por ${MINUTOS_DA_RESERVA} minutos. ${SIMULADO}`
        : `Reservou ${quando} por ${MINUTOS_DA_RESERVA} minutos`,
      [],
      // Revisao da AG2: o horario reservado tambem e horario livre do turno
      // (o dia e a hora como foram ao modelo; AG3, com a unidade). Revisao
      // final da AG3: e o horario da acao (a frase "reservei" so com ele).
      {
        acao: "reservou",
        horarioDaAcao: { dia, hora, unidade: unidade?.nome ?? null },
        horarios: [livre],
        ...(coberturaDoVinculo(serviceLinkId).length > 0
          ? { coberturas: coberturaDoVinculo(serviceLinkId) }
          : {}),
      },
    );
  }

  async function registrar(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    estado.intencao = "agendar";
    const preparo = prepararRegistro({
      argumentos,
      doPaciente: entrada.mensagens?.doPaciente ?? [],
      pendentes: entrada.mensagens?.pendentes ?? [],
      hoje: hojeNoFuso(agoraMs, fuso),
    });
    // Revisao final da AG3 (LGPD): o nome como o modelo copiou e como o
    // paciente escreveu, para a copia do verificador ir sem ele.
    const pedidoDoNome = entradaDoRegistroDeDadosSchema.safeParse(argumentos);
    if (pedidoDoNome.success && pedidoDoNome.data.nome_completo !== null) {
      const copiado = pedidoDoNome.data.nome_completo;
      nomesCitados.push(copiado);
      // Sem a marca do nome do contato ("Fulano da Silva" vira "da Silva"
      // quando a resposta tira a marca).
      const semAMarca = copiado.replace(/(?<!\p{L})fulan[oa](?!\p{L})/giu, " ").trim();
      if (semAMarca !== copiado && semAMarca.split(/\s+/).length >= 2) {
        nomesCitados.push(semAMarca);
      }
    }
    if (preparo.tipo === "pronto" && preparo.dados.nomeCompleto !== null) {
      nomesCitados.push(preparo.dados.nomeCompleto);
    }
    if (preparo.tipo === "entrada_invalida") {
      resultados.push("entrada_invalida");
      return saida(
        "entrada_invalida",
        {},
        "Tentou registrar os dados do paciente com um pedido incompleto",
      );
    }
    if (porta === null || porta.registrarDados === undefined) {
      return {
        tipo: "falha",
        passo: "Não foi possível registrar os dados agora.",
      };
    }
    if (preparo.tipo === "outra_pessoa") {
      let resposta: RespostaDoRegistro;
      try {
        resposta = await porta.registrarDados({
          paraOTitular: false,
          nomeCompleto: null,
          dataNascimento: null,
          cpf: null,
          carteirinha: null,
        });
      } catch {
        return {
          tipo: "falha",
          passo: "Não foi possível registrar os dados agora.",
        };
      }
      if (!resposta.ok && resposta.motivo === "ia_desligada") {
        return {
          tipo: "liberacao_suspensa",
          passo: "Tentou registrar os dados: o assistente não está mais atendendo esta conversa",
        };
      }
      dados.para_o_titular = false;
      dados.nome_completo = false;
      dados.data_nascimento = false;
      dados.cpf = false;
      dados.carteirinha = false;
      resultados.push("consulta_para_outra_pessoa");
      return {
        tipo: "passar",
        motivo: "consulta_para_outra_pessoa",
        resultado: "consulta_para_outra_pessoa",
        passo: "A consulta é para outra pessoa: nenhum dado foi guardado",
      };
    }
    const { campos, problemas } = preparo;
    const comProblema = Object.entries(problemas) as [
      DadoDaMarcacao,
      ProblemaDoCampo,
    ][];
    const problemasParaOModelo = Object.fromEntries(comProblema);
    if (campos.length === 0) {
      const [primeiro] = comProblema;
      const codigo =
        primeiro === undefined
          ? "entrada_invalida"
          : resultadoDoProblema(primeiro[0], primeiro[1]);
      resultados.push(codigo);
      return saida(
        codigo,
        { problemas: problemasParaOModelo, faltam: dados.faltam },
        `Não registrou os dados: ${listaEmTexto(comProblema.map(([c]) => ROTULO_DO_DADO[c]))} com problema`,
      );
    }
    let resposta: RespostaDoRegistro;
    try {
      resposta = await porta.registrarDados(preparo.dados);
    } catch {
      return {
        tipo: "falha",
        passo: "Não foi possível registrar os dados agora.",
      };
    }
    if (!resposta.ok) {
      if (resposta.motivo === "ia_desligada") {
        return {
          tipo: "liberacao_suspensa",
          passo: "Tentou registrar os dados: o assistente não está mais atendendo esta conversa",
        };
      }
      if (resposta.motivo === "menor_de_idade") {
        dados.data_nascimento = true;
        resultados.push("menor_de_idade");
        return {
          tipo: "passar",
          motivo: "menor_de_idade",
          resultado: "menor_de_idade",
          passo: "O paciente é menor de idade: a marcação fica com a equipe",
        };
      }
      if (resposta.motivo === "consulta_para_outra_pessoa") {
        resultados.push("consulta_para_outra_pessoa");
        return {
          tipo: "passar",
          motivo: "consulta_para_outra_pessoa",
          resultado: "consulta_para_outra_pessoa",
          passo: "A consulta é para outra pessoa: nenhum dado foi guardado",
        };
      }
      resultados.push("dados_invalidos");
      return saida(
        "dados_invalidos",
        { invalidos: resposta.invalidos ?? [], faltam: dados.faltam },
        `Não registrou os dados: ${listaEmTexto((resposta.invalidos ?? []).map((c) => ROTULO_DO_DADO[c]))} fora do formato`,
      );
    }
    for (const campo of campos) {
      dados[campo] = true;
    }
    dados.para_o_titular = true;
    dados.faltam = [...resposta.faltam];
    resultados.push("registrado");
    if (comProblema.length > 0) {
      const [primeiro] = comProblema;
      if (primeiro !== undefined) {
        resultados.push(resultadoDoProblema(primeiro[0], primeiro[1]));
      }
    }
    const registrados = listaEmTexto(campos.map((c) => ROTULO_DO_DADO[c]));
    const faltamTexto =
      dados.faltam.length === 0
        ? "nenhum dado falta"
        : `falta ${listaEmTexto(dados.faltam.map((c) => ROTULO_DO_DADO[c]))}`;
    return saida(
      "registrado",
      {
        registrados: campos,
        faltam: dados.faltam,
        ...(comProblema.length > 0 ? { problemas: problemasParaOModelo } : {}),
      },
      porta.simulada
        ? `Registraria ${registrados} (${faltamTexto}). ${SIMULADO}`
        : `Registrou ${registrados} (${faltamTexto})`,
    );
  }

  /**
   * O contato ja tem consulta futura ativa deste procedimento (ja_tem_consulta
   * do reservar e do agendar): ao modelo vao SO o dia e a hora dela (pode ter
   * sido marcada pela recepcao, fora desta conversa). O inicio vem da RPC ou,
   * sem ele, da leitura da consulta pelo id (do contato da conversa). Revisao
   * final da AG3: a consulta lida leva o dia, a hora e a unidade aos fatos.
   */
  async function jaTemConsulta(
    inicioDaRpc: string | null,
    appointmentId: string | null | undefined,
    passoSemDia: string,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    let inicio = inicioDaRpc;
    let unidadeId: string | null = null;
    if (appointmentId && porta?.lerConsulta !== undefined) {
      try {
        const lida = await porta.lerConsulta(appointmentId);
        if (lida !== null) {
          inicio = lida.inicio;
          unidadeId = lida.unidadeId ?? null;
        }
      } catch {
        // Sem a leitura, vale o inicio que a RPC trouxe (ou nenhum).
      }
    }
    const quando =
      inicio === null ? null : diaEHora(new Date(inicio), fuso, agoraMs);
    if (quando === null) {
      // O modelo so ouve que ja ha consulta; a consulta existe (a RPC disse),
      // sem dia nem hora: a frase com dia ou hora nao passa.
      return saida("ja_tem_consulta", {}, passoSemDia, [], {
        consultaLida: true,
      });
    }
    return saida(
      "ja_tem_consulta",
      { ...quando },
      `${passoSemDia} (${quando.dia} às ${quando.hora})`,
      [],
      {
        consultaLida: true,
        consultaComHorario: {
          ...quando,
          unidade: nomeDaUnidade(unidadeId),
          marcadaNestaConversa: false,
        },
      },
    );
  }

  /**
   * Revisao final da AG3: a reserva viva da conversa e outra (reserva_
   * diferente). Le a viva para o modelo perguntar "Confirma ...?" de novo,
   * com o horario certo; o estado passa a guardar ela (e a etapa volta para
   * a oferta no fechamento, ate a pergunta nova). Leitura que falha: falha
   * fechada.
   */
  async function reservaDiferente(
    passo: string,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    let viva: ReservaVivaDaConversa | null;
    try {
      if (porta === null || porta.lerReservaViva === undefined) {
        throw new Error("sem porta");
      }
      viva = await porta.lerReservaViva();
    } catch {
      return {
        tipo: "falha",
        passo: "Não foi possível ler o horário reservado nesta conversa.",
      };
    }
    if (viva === null || !viva.viva) {
      // Ninguem mais tem reserva: como a reserva que venceu.
      reserva = reserva === null ? null : { ...reserva, viva: false };
      estado.slot_hold_id = null;
      return saida("reserva_inexistente", {}, passo);
    }
    const codigo =
      [...horarios.values()].find(
        (h) =>
          h.serviceLinkId === viva.serviceLinkId &&
          Date.parse(h.inicio) === Date.parse(viva.inicio),
      ) ?? null;
    reserva = {
      horario: codigo,
      leitura: viva,
      viva: true,
      perdida: false,
      situacao: codigo === null ? "nao_conferido" : situacaoDe(codigo.codigo),
      holdId: viva.holdId,
    };
    estado.slot_hold_id = viva.holdId;
    // O pedido passa a ser o da reserva viva (o vinculo e a unidade dela).
    const vinculo = vinculoDe(viva.serviceLinkId);
    if (vinculo !== undefined) {
      estado.procedure_id = vinculo.procedimentoId;
      estado.professional_id = vinculo.profissionalId;
      estado.insurance_id = vinculo.convenioId;
      estado.particular = vinculo.convenioId === null;
    }
    estado.unit_id = viva.unidadeId;
    recalcularFaltam(viva.serviceLinkId);
    const nomes = nomesDoVinculo(viva.serviceLinkId);
    const unidade = nomeDaUnidade(viva.unidadeId);
    const { dia, hora } = diaEHora(new Date(viva.inicio), fuso, agoraMs);
    return saida(
      "reserva_diferente",
      {
        horario_reservado: {
          dia,
          hora,
          ...(nomes === null ? {} : nomes),
          unidade,
        },
      },
      `${passo} (o reservado é ${dia} às ${hora}${entreParenteses(nomes)}${unidade === null ? "" : `, unidade ${unidade}`})`,
      [],
      // A reserva viva desta conversa: e reserva feita, com o horario dela.
      {
        acao: "reservou",
        horarioDaAcao: { dia, hora, unidade },
      },
    );
  }

  async function agendar(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    estado.intencao = "agendar";
    if (!entradaDoAgendarSchema.safeParse(argumentos ?? {}).success) {
      resultados.push("entrada_invalida");
      return saida(
        "entrada_invalida",
        {},
        "Tentou marcar a consulta com um pedido fora do formato",
      );
    }
    if (chamouAgendar) {
      resultados.push("uma_marcacao_por_resposta");
      return saida(
        "uma_marcacao_por_resposta",
        {},
        "Pediu para marcar de novo na mesma resposta: recusado",
      );
    }
    // Revisao final da AG3: a reserva que a pergunta "Confirma ...?" mostrou
    // e a do estado lido no comeco do turno (a etapa so e armada com ela).
    const reservaPerguntada = comEstado
      ? entrada.atendimento!.estado.slot_hold_id
      : null;
    if (
      tentouReservar ||
      (comEstado &&
        (etapaInicial !== "aguardando_confirmacao" || reservaPerguntada === null))
    ) {
      // A confirmacao tem de vir numa mensagem nova, depois da pergunta
      // "Confirma ...?" (AG3: feita num turno anterior, com a reserva viva e
      // sem dado faltando). O turno que tentou reservar e o da escolha do
      // horario, nunca o da confirmacao.
      resultados.push("sem_confirmacao_do_paciente");
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
      resposta = comEstado
        ? await porta.agendar({ slotHoldId: reservaPerguntada })
        : await porta.agendar();
    } catch {
      return {
        tipo: "falha",
        passo: "Não foi possível marcar a consulta agora.",
      };
    }
    if (!resposta.ok) {
      resultados.push(resposta.motivo);
      const motivo = ROTULO_DO_MOTIVO_DA_AGENDA[resposta.motivo];
      if (resposta.motivo === "ia_desligada") {
        return {
          tipo: "liberacao_suspensa",
          passo: `Tentou marcar a consulta: ${motivo}`,
        };
      }
      if (
        resposta.motivo === "consulta_para_outra_pessoa" ||
        resposta.motivo === "menor_de_idade"
      ) {
        return {
          tipo: "passar",
          motivo: resposta.motivo,
          resultado: resposta.motivo,
          passo: `Não marcou a consulta: ${motivo}`,
        };
      }
      if (resposta.motivo === "ja_tem_consulta") {
        return jaTemConsulta(
          null,
          resposta.appointmentId,
          `Não marcou: ${motivo}`,
        );
      }
      if (resposta.motivo === "faltam_dados") {
        dados.faltam = [...(resposta.faltam ?? dados.faltam)];
        return saida(
          "faltam_dados",
          { faltam: dados.faltam },
          `Não marcou: falta ${listaEmTexto(dados.faltam.map((c) => ROTULO_DO_DADO[c]))}`,
        );
      }
      if (resposta.motivo === "reserva_diferente") {
        return reservaDiferente(`Não marcou: ${motivo}`);
      }
      if (resposta.motivo === "reserva_vencida" || resposta.motivo === "reserva_inexistente") {
        reserva = reserva === null ? null : { ...reserva, viva: false };
      }
      if (RECUSAS_PELO_HORARIO.has(resposta.motivo)) {
        // Revisao final da AG3 (item 4): o horario da reserva nao vira
        // consulta. A reserva fica perdida (nao viva, o codigo dela ocupado,
        // o estado sem o id) e sai dos horarios livres do turno.
        if (reserva !== null) {
          reserva = { ...reserva, perdida: true, situacao: "ocupado" };
          if (reserva.horario !== null) {
            situacoes.set(reserva.horario.codigo, "ocupado");
          }
        }
        estado.slot_hold_id = null;
      }
      return saida(resposta.motivo, {}, `Tentou marcar a consulta: ${motivo}`);
    }
    resultados.push("marcado");
    estado.appointment_id = resposta.appointmentId;
    estado.slot_hold_id = null;
    estado.horarios_oferecidos = [];
    estado.etapa = "pos_marcacao";
    estado.desfecho = "marcou";
    const reservaAntes = reserva;
    reserva = null;
    const serviceLinkId =
      resposta.serviceLinkId ?? reservaAntes?.leitura?.serviceLinkId ?? null;
    const nomes = nomesDoVinculo(serviceLinkId);
    const inicio = resposta.inicio ?? reservaAntes?.leitura?.inicio ?? null;
    const unidadeId = reservaAntes?.leitura?.unidadeId ?? null;
    const unidade =
      unidadeId === null
        ? null
        : ((catalogo.unidades ?? []).find((u) => u.id === unidadeId) ?? null);
    const quando =
      inicio === null ? null : diaEHora(new Date(inicio), fuso, agoraMs);
    consultaDoTurno = quando;
    if (porta?.simulada && quando === null) {
      // O simulador sem a reserva guardada: sem dia e hora (e, nos fatos do
      // turno, a resposta que repete o dia e a hora e barrada).
      return saida(
        "marcado",
        { pendente: true },
        `Marcaria a consulta reservada, pendente de aprovação da equipe. ${SIMULADO}`,
        [],
        { acao: "marcou" },
      );
    }
    const texto =
      quando === null
        ? "a consulta reservada"
        : `a consulta de ${quando.dia} às ${quando.hora}${entreParenteses(nomes)}${unidade === null ? "" : `, unidade ${unidade.nome}`}`;
    return saida(
      "marcado",
      {
        pendente: true,
        ...(quando === null ? {} : quando),
        ...(nomes === null ? {} : nomes),
        ...(unidade === null ? {} : { unidade: unidade.nome }),
      },
      porta?.simulada
        ? `Marcaria ${texto}, pendente de aprovação da equipe. ${SIMULADO}`
        : `Marcou ${texto}, pendente de aprovação da equipe`,
      [],
      // Revisao final da AG3: o horario da acao (a frase "ficou marcada"
      // com dia ou hora so com ele).
      quando === null
        ? { acao: "marcou" }
        : {
            acao: "marcou",
            horarioDaAcao: { ...quando, unidade: unidade?.nome ?? null },
          },
    );
  }

  async function confirmar(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    if (estado.intencao === null) {
      estado.intencao = "confirmar";
    }
    if (!entradaDaConfirmacaoSchema.safeParse(argumentos ?? {}).success) {
      resultados.push("entrada_invalida");
      return saida(
        "entrada_invalida",
        {},
        "Tentou confirmar a presença com um pedido fora do formato",
      );
    }
    if (chamouConfirmar) {
      resultados.push("uma_confirmacao_por_resposta");
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
      resultados.push(resposta.motivo);
      return saida(
        resposta.motivo,
        {},
        PASSO_DA_CONFIRMACAO_RECUSADA[resposta.motivo],
      );
    }
    resultados.push("confirmada");
    estado.desfecho = "confirmou";
    if (porta?.simulada) {
      return saida(
        "confirmada",
        {},
        `Confirmaria a presença na consulta do paciente. ${SIMULADO}`,
        [],
        { acao: "confirmou_presenca", consultaLida: true },
      );
    }
    // LGPD (minimizacao): a consulta pode ter sido marcada pela recepcao,
    // fora desta conversa. Ao modelo vao so o dia e a hora; procedimento e
    // profissional ficam na trilha da tela, que nao vai a OpenAI.
    const nomes = nomesDoVinculo(resposta.serviceLinkId);
    // A consulta confirmada ja existia: a ferramenta a leu (o estado "sua
    // consulta esta marcada" vale) e confirmou (a acao vale).
    const fatosDaConfirmacao: FatosDaFerramenta = {
      acao: "confirmou_presenca",
      consultaLida: true,
    };
    if (resposta.inicio === null) {
      return saida(
        "confirmada",
        {},
        `Confirmou a presença na consulta do paciente${entreParenteses(nomes)}`,
        [],
        fatosDaConfirmacao,
      );
    }
    const quando = diaEHora(new Date(resposta.inicio), fuso, agoraMs);
    return saida(
      "confirmada",
      { ...quando },
      `Confirmou a presença na consulta de ${diaAsHora(new Date(resposta.inicio), fuso, agoraMs)}${entreParenteses(nomes)}`,
      [],
      // Revisao final da AG3: a consulta lida com o dia e a hora dela.
      {
        ...fatosDaConfirmacao,
        consultaComHorario: {
          ...quando,
          unidade: null,
          marcadaNestaConversa: false,
        },
      },
    );
  }

  async function consultarCadastro(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    if (!entradaDoCadastroDoContatoSchema.safeParse(argumentos ?? {}).success) {
      resultados.push("entrada_invalida");
      return saida(
        "entrada_invalida",
        {},
        "Tentou consultar o cadastro da pessoa com um pedido fora do formato",
      );
    }
    let cadastro: CadastroDoContato;
    try {
      if (porta === null || porta.lerCadastroDoContato === undefined) {
        throw new Error("sem porta");
      }
      cadastro = await porta.lerCadastroDoContato();
    } catch {
      return {
        tipo: "falha",
        passo: "Não foi possível consultar o cadastro da pessoa agora.",
      };
    }
    resultados.push("cadastro");
    const { saida: corpo, passo } = saidaDoCadastroDoContato(catalogo, cadastro);
    return saida("cadastro", corpo, passo);
  }

  // -------------------------------------------------------------------------
  // O estado para o modelo, os fatos, o fechamento e a nota
  // -------------------------------------------------------------------------

  const legivel = (h: HorarioOferecido): HorarioLegivel => ({
    dia: h.dia,
    hora: h.hora,
    profissional: h.profissional,
    unidade: h.unidade,
  });

  /**
   * O horario da reserva conhecida, legivel (null: nao ha reserva). viva:
   * revisao final da AG3, pelo relogio do turno (a que venceu no meio do
   * turno e false) e falsa na perdida.
   */
  const reservaLegivel = ():
    | (HorarioLegivel & {
        codigo: string | null;
        procedimento: string;
        viva: boolean | null;
        perdida: boolean;
      })
    | null => {
    if (reserva === null) {
      return null;
    }
    const viva =
      reserva.viva === null ? null : reservaVivaAgora(reserva);
    if (reserva.horario !== null) {
      return {
        ...legivel(reserva.horario),
        codigo: reserva.horario.codigo,
        procedimento: reserva.horario.procedimento,
        viva,
        perdida: reserva.perdida,
      };
    }
    const leitura = reserva.leitura;
    if (leitura === null) {
      return null;
    }
    const nomes = nomesDoVinculo(leitura.serviceLinkId);
    const unidade =
      leitura.unidadeId === null
        ? null
        : ((catalogo.unidades ?? []).find((u) => u.id === leitura.unidadeId) ?? null);
    const { dia, hora } = diaEHora(new Date(leitura.inicio), fuso, agoraMs);
    return {
      dia,
      hora,
      profissional: nomes?.profissional ?? null,
      unidade: unidade?.nome ?? null,
      codigo: null,
      procedimento: nomes?.procedimento ?? "",
      viva,
      perdida: reserva.perdida,
    };
  };

  const situacaoDe = (codigo: string): SituacaoDoHorario =>
    situacoes.get(codigo) ?? "nao_conferido";

  function paraOModelo(): AtendimentoParaOModelo | null {
    if (!comEstado) {
      return null;
    }
    const nada =
      estado.etapa === "informacao" &&
      estado.intencao === null &&
      estado.procedure_id === null &&
      horarios.size === 0 &&
      estado.slot_hold_id === null &&
      estado.appointment_id === null &&
      !dados.nome_completo &&
      !dados.data_nascimento &&
      !dados.cpf &&
      !dados.carteirinha &&
      dados.faltam.length === 0 &&
      estado.falhas_seguidas === 0;
    if (nada) {
      return null;
    }
    const procedimento = procedimentoDe(estado.procedure_id ?? undefined);
    const profissionalDoIndice = (catalogo.profissionais ?? []).find(
      (p) => p.id === estado.professional_id,
    );
    const codigoDoProfissional = (() => {
      if (estado.professional_id === null) {
        return null;
      }
      const ordenados = [
        ...new Map(
          catalogo.vinculos.map((v) => [v.profissionalId, v.profissional]),
        ).entries(),
      ]
        .map(([id, nome]) => ({ id, nome }))
        .sort(
          (a, b) =>
            a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id),
        );
      const indice = ordenados.findIndex((p) => p.id === estado.professional_id);
      return indice < 0 ? null : `r${indice + 1}`;
    })();
    const unidade =
      estado.unit_id === null
        ? null
        : ((catalogo.unidades ?? []).find((u) => u.id === estado.unit_id) ?? null);
    const pagamento =
      estado.particular === true
        ? "particular"
        : estado.insurance_id !== null
          ? (() => {
              const c = convenioDe(estado.insurance_id);
              return c === undefined ? null : nomeDoConvenio(c);
            })()
          : null;
    const r = reservaLegivel();
    return {
      etapa: estado.etapa,
      procedimento:
        procedimento === undefined
          ? null
          : { codigo: procedimento.codigo, nome: procedimento.nome },
      profissional:
        profissionalDoIndice === undefined
          ? null
          : { codigo: codigoDoProfissional, nome: profissionalDoIndice.nome },
      pagamento,
      unidade:
        unidade === null ? null : { codigo: unidade.codigo, nome: unidade.nome },
      horarios: [...horarios.values()]
        .filter((h) =>
          estado.horarios_oferecidos.some((e) => e.codigo === h.codigo),
        )
        .map((h) => ({
          ...legivel(h),
          codigo: h.codigo,
          procedimento: h.procedimento,
          unidadeCodigo: h.unidadeCodigo,
          situacao: situacaoDe(h.codigo),
        })),
      reserva:
        r === null
          ? null
          : {
              dia: r.dia,
              hora: r.hora,
              profissional: r.profissional,
              unidade: r.unidade,
              codigo: r.codigo,
              procedimento: r.procedimento,
              situacao: r.perdida
                ? "perdida"
                : r.viva === true
                  ? "viva"
                  : r.viva === false
                    ? "vencida"
                    : "nao_conferida",
            },
      informados: (["nome_completo", "data_nascimento", "cpf", "carteirinha"] as const).filter(
        (d) => dados[d],
      ),
      faltam: [...dados.faltam],
      paraOTitular: dados.para_o_titular,
      consulta:
        consultaLida === null
          ? null
          : { dia: consultaLida.dia, hora: consultaLida.hora },
      falhasSeguidas: estado.falhas_seguidas,
    };
  }

  function fatosDoEstado(): SaidaParaOsFatos | null {
    if (!comEstado) {
      return null;
    }
    const oferecidos = [...horarios.values()].filter((h) =>
      estado.horarios_oferecidos.some((e) => e.codigo === h.codigo),
    );
    const r = reservaLegivel();
    if (oferecidos.length === 0 && r === null && consultaLida === null) {
      return null;
    }
    // Fonte de dia e hora (citar o que ja foi oferecido, negar); so o
    // conferido agora e horario LIVRE.
    const livres: HorarioLivreDoTurno[] = oferecidos
      .filter((h) => situacaoDe(h.codigo) === "livre")
      .map((h) => ({ dia: h.dia, hora: h.hora, unidade: h.unidade }));
    const coberturas: CoberturaDoTurno[] = [];
    for (const h of oferecidos.filter((o) => situacaoDe(o.codigo) === "livre")) {
      coberturas.push(...coberturaDoVinculo(h.serviceLinkId));
    }
    // Revisao final da AG3: a reserva viva AGORA (pelo relogio do turno, nao
    // perdida) e reserva feita nesta conversa, com o horario dela; so entra
    // nos horarios livres a reserva cujo horario a reconferencia (ou a
    // reserva deste turno) disse livre.
    const reservaViva = r !== null && r.viva === true && !r.perdida;
    if (reservaViva && r !== null && reserva?.situacao === "livre") {
      livres.push({ dia: r.dia, hora: r.hora, unidade: r.unidade });
      coberturas.push(...coberturaDoVinculo(reserva?.leitura?.serviceLinkId ?? null));
    }
    const fatos: FatosDaFerramenta = {
      ...(livres.length > 0 ? { horarios: livres } : {}),
      ...(coberturas.length > 0 ? { coberturas } : {}),
      // A reserva viva, lida agora, e reserva feita (nesta conversa).
      ...(reservaViva && r !== null
        ? {
            acao: "reservou" as const,
            horarioDaAcao: { dia: r.dia, hora: r.hora, unidade: r.unidade },
          }
        : {}),
      // A consulta que a IA marcou nesta conversa, relida agora.
      ...(consultaLida === null
        ? {}
        : {
            consultaLida: true,
            consultaComHorario: {
              dia: consultaLida.dia,
              hora: consultaLida.hora,
              unidade: consultaLida.unidade,
              marcadaNestaConversa: true,
            },
          }),
    };
    return {
      saida: JSON.stringify({
        resultado: "atendimento_em_andamento",
        horarios_oferecidos: oferecidos.map((h) => ({
          codigo: h.codigo,
          dia: h.dia,
          hora: h.hora,
          profissional: h.profissional,
          procedimento: h.procedimento,
          unidade: h.unidade,
        })),
        ...(r === null
          ? {}
          : {
              horario_reservado: {
                dia: r.dia,
                hora: r.hora,
                profissional: r.profissional,
                procedimento: r.procedimento,
                unidade: r.unidade,
              },
            }),
        ...(consultaLida === null
          ? {}
          : {
              consulta_marcada: {
                dia: consultaLida.dia,
                hora: consultaLida.hora,
              },
            }),
      }),
      fatos,
    };
  }

  function falhasDepois(): number {
    return falhasDepoisDoTurno(estado.falhas_seguidas, resultados);
  }

  function fechar(fim: {
    mensagemFinal: string | null;
    passou: boolean;
  }): FechamentoDoTurno {
    const final = copiarEstado(estado);
    final.falhas_seguidas = falhasDepois();
    if (fim.passou) {
      final.desfecho = "passou_para_equipe";
    }
    if (final.etapa !== "pos_marcacao" || consultaDoTurno === null) {
      // Revisao final da AG3: a reserva que venceu (inclusive no meio do
      // turno, pelo relogio), sumiu ou ficou perdida e nula no estado.
      const morta = reservaMorta();
      if (final.slot_hold_id !== null && morta) {
        final.slot_hold_id = null;
      }
      const reservaViva = !morta && reservaVivaAgora();
      const r = reservaLegivel();
      // Revisao final da AG3 (item 1): a etapa so e armada com a pergunta
      // "Confirma ...?" que traz o dd/mm e o HH:mm DA reserva viva (e o
      // profissional e a unidade dela, quando cita) e nenhum outro dia e
      // hora; o estado guarda o id da reserva perguntada (o agendar manda).
      const perguntouAReserva =
        r !== null &&
        reserva !== null &&
        reserva.holdId !== null &&
        final.slot_hold_id === reserva.holdId &&
        fim.mensagemFinal !== null &&
        perguntaConfirmaAReserva(fim.mensagemFinal, {
          dia: r.dia,
          hora: r.hora,
          profissional: r.profissional,
          unidade: r.unidade,
          profissionais: nomesDosProfissionais(),
          unidades: (catalogo.unidades ?? []).map((u) => u.nome),
        });
      if (
        !fim.passou &&
        reservaViva &&
        dados.faltam.length === 0 &&
        perguntouAReserva
      ) {
        final.etapa = "aguardando_confirmacao";
      } else if (final.etapa !== "pos_marcacao") {
        if (final.horarios_oferecidos.length > 0 || reservaViva) {
          final.etapa = "oferta";
        } else if (final.intencao === "agendar") {
          final.etapa = "escolha";
        }
      }
    }
    return {
      estado: final,
      dados: { ...dados, faltam: [...dados.faltam] },
    };
  }

  /** Os nomes dos profissionais do catalogo (para a pergunta "Confirma"). */
  function nomesDosProfissionais(): string[] {
    return [
      ...new Set([
        ...catalogo.vinculos.map((v) => v.profissional),
        ...(catalogo.profissionais ?? []).map((p) => p.nome),
      ]),
    ];
  }

  function nota(motivo: string): string | null {
    if (!comEstado) {
      return null;
    }
    const procedimento = procedimentoDe(estado.procedure_id ?? undefined);
    const profissional = (catalogo.profissionais ?? []).find(
      (p) => p.id === estado.professional_id,
    );
    const unidade =
      estado.unit_id === null
        ? null
        : ((catalogo.unidades ?? []).find((u) => u.id === estado.unit_id) ?? null);
    const pagamento =
      estado.particular === true
        ? "particular"
        : estado.insurance_id !== null
          ? (() => {
              const c = convenioDe(estado.insurance_id);
              return c === undefined ? null : nomeDoConvenio(c);
            })()
          : null;
    const r = reservaLegivel();
    const ultimo = [...resultados].reverse().find((c) => PAROU_EM[c] !== undefined);
    return notaDaPassagem({
      estado,
      dados,
      procedimento: procedimento?.nome ?? null,
      profissional: profissional?.nome ?? null,
      pagamento,
      unidade: unidade?.nome ?? null,
      preferencia: ultimaPreferencia,
      reserva: r === null ? null : { ...r, viva: r.viva, perdida: r.perdida },
      oferecidos: [...horarios.values()]
        .filter((h) => estado.horarios_oferecidos.some((e) => e.codigo === h.codigo))
        .map(legivel),
      parouEm: ultimo === undefined ? motivo : (PAROU_EM[ultimo] ?? motivo),
    });
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
        case "registrar_dados_do_paciente":
          return registrar(argumentos);
        case "consultar_cadastro_do_contato":
          return consultarCadastro(argumentos);
      }
    },
    preparar,
    paraOModelo,
    fatosDoEstado,
    resultados: () => [...resultados],
    falhasDepois,
    fechar,
    nota,
    nomesCitados: () => [...nomesCitados],
  };
}
