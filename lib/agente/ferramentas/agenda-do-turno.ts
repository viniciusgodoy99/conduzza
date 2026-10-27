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
//
// AG4 (27/10/2026), remarcar e cancelar (desenho da AG4, secoes 1 e 4):
//  - consultar_minhas_consultas le as consultas futuras do contato (c1 a c5,
//    so dia, hora e situacao ao modelo; D-13);
//  - pedir_cancelamento e cancelar_consulta, em duas fases: a primeira
//    confere a consulta (o espelho de conferir_consulta_da_ia) e devolve a
//    FRASE FIXA da pergunta (T1), que arma o pedido no fechamento; a segunda,
//    numa mensagem nova e so com o pedido armado no comeco do turno, confere
//    o "sim" numa lista fechada (D-30) e chama a RPC. Deu certo: a frase fixa
//    do botao (T2);
//  - buscar_horario_para_remarcar fixa a consulta em foco e busca com o
//    procedimento, o profissional e o pagamento dela (do servidor);
//    reservar_horario e agendar no modo de remarcacao mandam p_remarcar e
//    devolvem as frases fixas T3 (que arma "aguardando_confirmacao") e T4;
//  - a frase fixa ({tipo: "frase"}) encerra o turno: o laco a compoe com a
//    saudacao e o aviso e a manda pelo filtro inteiro, com os fatos dela;
//  - a pergunta e armada pelo RESULTADO da ferramenta, nunca por expressao
//    no texto, e desarma em qualquer outro turno;
//  - as recusas que sao da equipe passam com pedido_de_agenda, e as do prazo
//    com fora_do_prazo (tipo "passar", com a nota da passagem).
//
// Revisao independente da AG4 (27/10/2026), os achados 1 a 9:
//  - a pergunta do turno anterior (T1 e T3) so vale quando e a mensagem da
//    IA (autoria real, nao o papel "assistente" do historico) logo antes da
//    resposta da pessoa; a T1 vence em 60 minutos. Sem isso, o preparo
//    desfaz o pedido de cancelar (cancelar_consulta pergunta de novo, sem a
//    RPC) e o agendar da remarcacao recusa sem a RPC. pedido_vencido e
//    sem_confirmacao_do_paciente do banco tambem sao "pergunte de novo";
//  - o codigo c1 a c5 so vale com consultar_minhas_consultas no turno;
//  - a remarcacao so reserva com o pedido gravado no turno anterior (buscar
//    e reservar na mesma resposta: oferecer_antes_de_reservar, sem a RPC);
//    ja_tem_consulta na remarcacao e fora do contrato (falha fechada);
//  - a busca da remarcacao com consulta null reconfere o foco (o prazo e a
//    remarcacao pendente) antes de oferecer horario;
//  - reserva_diferente na remarcacao vai ao modelo so com dia, hora e (com
//    mais de uma unidade) a unidade;
//  - o estado guarda a consulta cancelada nesta conversa: o turno seguinte
//    rele e "foi cancelada" vale so com o par dela (como "foi remarcada"
//    com a remarcacao ja aprovada).
//
// Revisao curta das correcoes da AG4 (27/10/2026), os achados 1 a 9:
//  - mensagem_nova_do_paciente (cancelar e agendar, com e sem p_remarcar): a
//    pessoa escreveu de novo depois das mensagens que o job leu. O turno
//    para SEM enviar nada e sem mexer no estado (nenhuma falha, nenhuma
//    pergunta de novo): o proximo turno le a mensagem nova;
//  - a pergunta do turno anterior e conferida contra a SAIDA que o banco
//    conta (porta.lerSaidaAntesDaResposta: a ordem real, toda saida que nao
//    e evento nem nota, a apagada e a automatica inclusive) e contra o corpo
//    ORIGINAL dela (sem a mascara do nome: "Vila Mariana" com a contato
//    Mariana, a consulta de domingo com o contato Domingo). Sem a porta (o
//    simulador), a mensagem logo antes das pendentes, como antes;
//  - a T1 da mesma consulta com outro horario (a recepcao mudou no meio) e
//    consulta_mudou: sem falha e sem a trilha de "outra mensagem"; a T3 com
//    a consulta antiga em outro horario, tambem (o modelo reserva de novo);
//  - a recusa da T3 (a pergunta que nao confere, ou o banco que nao viu o
//    "sim" logo depois dela) conta falha mesmo com o reservar no mesmo
//    turno: a segunda seguida passa para a equipe, nunca um laco;
//  - a consulta do pedido de cancelar que ja nao esta de pe (o mesmo job que
//    cancelou e caiu antes de gravar, ou outro cancelamento): a RPC decide
//    (idempotente pelo job: reutilizado e a T2; senao, consulta_encerrada);
//  - o id da consulta cancelada sai do estado quando o estado deixa de ser
//    o do cancelamento (a nota nunca a chama de "marcada").
// Nada daqui tem texto do paciente: a trilha cita nomes do Cadastro, dias,
// horas e os nomes dos campos. O "sim" do cancelamento e lido do texto
// original da mensagem (sem sair do turno, nunca para log).

import {
  ferramentasDoAgente,
  prazoDaAcao,
  type AcaoComPrazo,
  type ConfigDoAgente,
  type FerramentaDeAgenda,
  type MotivoDeEscalonamento,
} from "@/lib/domain/agente/config";
import type {
  ConsultaDoFato,
  CoberturaDoTurno,
  FatosDaFerramenta,
  HorarioDoFato,
  HorarioLivreDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";
import { pareceNomeDePessoa } from "@/lib/domain/conformidade/minimizar";
import { interpretarRespostaAoCancelamento } from "@/lib/domain/resposta-paciente";

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
  entradaDoCancelamentoSchema,
  entradaDoPedidoDeCancelamentoSchema,
  pedidoAindaVale,
  type MotivoDoCancelamento,
  type RespostaDoCancelamento,
} from "./cancelar-consulta";
import {
  diaAsHora,
  diaEHora,
  escolherHorarios,
  fusoDaAgenda,
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
  indiceDosProfissionais,
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
  perguntaDaRemarcacao,
  perguntaDoCancelamento,
  respostaDaRemarcacao,
  respostaDoCancelamento,
} from "./frases-da-agenda";
import {
  conferirConsultaDaIa,
  emOrdem,
  entradaDasMinhasConsultasSchema,
  MAXIMO_DE_CONSULTAS_NA_LISTA,
  ROTULO_DA_SITUACAO,
  situacaoDaConsulta,
  type ConsultaDoContato,
  type ConsultasDoContato,
  type MotivoDaConferenciaDaConsulta,
} from "./minhas-consultas";
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
  ehMotivoDaRemarcacao,
  entradaDaBuscaParaRemarcarSchema,
} from "./remarcar";
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
  /**
   * AG4 (o limite da 21.15): o profissional da consulta, para os fatos do
   * turno (o nome vem do catalogo, so no servidor; nunca ao modelo nem ao
   * resumo do verificador). Ausente: nao se sabe.
   */
  profissionalId?: string | null;
  /** AG4: o vinculo (procedimento, profissional e convenio) da consulta. */
  serviceLinkId?: string | null;
  /** AG4: approval_status = 'pendente' (a consulta da IA ainda nao aprovada). */
  pendente?: boolean;
  /** AG4: appointment.remarcacao_de (esta consulta e a remarcacao de outra). */
  remarcacaoDe?: string | null;
  /**
   * Revisao da AG4 (achado 7): a consulta esta cancelada (pelo paciente ou
   * pela clinica). So o cancelamento feito nesta conversa (o estado) le
   * isto. Ausente: nao se sabe (nao vira fato).
   */
  cancelada?: boolean;
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
    /** AG4: a consulta que esta sendo remarcada (p_remarcar). */
    remarcarId?: string | null;
  }) => Promise<RespostaDaReserva>;
  /**
   * agendar_pela_ia com o job_id do turno. Revisao final da AG3: com a
   * reserva que a pergunta "Confirma ...?" mostrou (p_slot_hold_id); a RPC
   * recusa reserva_diferente quando a reserva viva e outra. Sem o pedido
   * (ou com o id nulo), a reserva viva da conversa, como antes.
   */
  agendar: (pedido?: {
    slotHoldId: string | null;
    /** AG4: a consulta que esta sendo remarcada (p_remarcar). */
    remarcarId?: string | null;
  }) => Promise<RespostaDoAgendar>;
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
  /**
   * AG4: as consultas futuras do contato da conversa (ate 5, com ha_mais).
   * Lanca na leitura que falha. Revisao da AG4 (achado 9): com `apenas`, so
   * aquela consulta (a mesma leitura e a mesma conferencia da lista, para
   * reconferir a consulta em foco antes de buscar horario).
   */
  lerConsultasDoContato?: (apenas?: string) => Promise<ConsultasDoContato>;
  /** AG4: cancelar_consulta_pela_ia com o job_id do turno. */
  cancelarConsulta?: (appointmentId: string) => Promise<RespostaDoCancelamento>;
  /**
   * Revisao curta das correcoes da AG4 (achados 2 e 8): a ultima SAIDA antes
   * da ultima mensagem do paciente, como o banco conta na ancora do "sim"
   * (a ordem real; toda saida que nao e evento nem nota interna, de qualquer
   * autor e em qualquer situacao de entrega), com o corpo original (so o
   * servidor le). null: sem mensagem do paciente ou sem saida antes dela.
   * Lanca na leitura que falha. Ausente (o simulador): vale a mensagem logo
   * antes das pendentes do historico.
   */
  lerSaidaAntesDaResposta?: () => Promise<SaidaAntesDaResposta | null>;
};

/**
 * Revisao curta das correcoes da AG4 (achados 2 e 8): a saida que o banco
 * ve logo antes da resposta da pessoa.
 */
export type SaidaAntesDaResposta = {
  /** message.author (null: valor que o codigo nao conhece). */
  autoria: "ia" | "usuario" | "sistema" | null;
  /** O corpo ORIGINAL, so de texto (null: midia ou vazio). Nunca vai a log. */
  texto: string | null;
  /** A entrega falhou (delivery_status = 'falhou'). */
  falhou: boolean;
  /**
   * Outra saida no MESMO instante que nao e da IA (ou que falhou): o banco
   * conta como outra mensagem no meio.
   */
  empate: boolean;
  /**
   * created_at (ISO) da saida. Contrato da frente de banco, R8: a validade
   * do pedido de cancelar conta da PERGUNTA respondida (60 minutos depois
   * dela), nao do instante do pedido. null: nao veio.
   */
  criadaEm: string | null;
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
   * pessoa, menor de idade, D-8), com o motivo do banco. AG4: a consulta que
   * so a equipe mexe (pedido_de_agenda) e o pedido dentro do prazo da
   * clinica (fora_do_prazo).
   */
  | {
      tipo: "passar";
      motivo: Extract<
        MotivoDeEscalonamento,
        | "consulta_para_outra_pessoa"
        | "menor_de_idade"
        | "pedido_de_agenda"
        | "fora_do_prazo"
      >;
      passo: string;
      resultado: string;
    }
  /**
   * AG4: a FRASE FIXA que encerra o turno (as perguntas e as respostas do
   * cancelamento e da remarcacao, T1 a T4). O laco a compoe com a saudacao e
   * o aviso e a manda pelo filtro INTEIRO, com estes fatos; o modelo nao
   * escreve nada.
   */
  | {
      tipo: "frase";
      /** O texto que sai (antes da saudacao e do aviso). */
      texto: string;
      /** O JSON dos fatos (o dia e a hora juntos, como uma saida). */
      saida: string;
      passo: string;
      resultado: string;
      fatos: FatosDaFerramenta;
    }
  /** A RPC disse ia_desligada: o turno para sem frase (liberacao_suspensa). */
  | { tipo: "liberacao_suspensa"; passo: string }
  /**
   * Revisao curta das correcoes da AG4 (achado 1): a RPC disse
   * mensagem_nova_do_paciente (a pessoa escreveu de novo depois das
   * mensagens que o job leu). O turno para SEM enviar nada e sem passar para
   * a equipe; o estado fica como estava no comeco (fechar) e o proximo turno
   * le a mensagem nova. Nenhuma falha.
   */
  | { tipo: "mensagem_nova"; passo: string }
  /** Leitura ou RPC que falhou, ou resposta fora do formato: falha fechada. */
  | { tipo: "falha"; passo: string };

/** O que a trilha diz de cada motivo das RPCs (linguagem de recepcao). */
export const ROTULO_DO_MOTIVO_DA_AGENDA: Readonly<
  Record<
    | MotivoDaReserva
    | MotivoDoAgendar
    | MotivoDoCancelamento
    | MotivoDaConferenciaDaConsulta,
    string
  >
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
  // AG4: remarcar e cancelar.
  remarcacao_desligada:
    "remarcar não está ligado, ou o prazo para remarcar não está preenchido, na versão publicada",
  cancelamento_desligado:
    "cancelar não está ligado, ou o prazo para cancelar não está preenchido, na versão publicada",
  sem_pedido_de_remarcacao: "não havia pedido de remarcação nesta conversa",
  sem_pedido_de_cancelamento: "não havia pedido de cancelamento nesta conversa",
  consulta_nao_encontrada: "a consulta não é do paciente desta conversa",
  consulta_encerrada:
    "a consulta não está mais marcada (já passou, foi atendida ou cancelada)",
  encaixe: "a consulta é um encaixe, que só a equipe mexe",
  so_com_a_equipe: "a consulta só é mexida pela equipe",
  pendente_da_equipe: "a consulta ainda espera a aprovação da equipe",
  remarcacao_pendente: "a consulta já tem uma remarcação esperando a aprovação",
  fora_do_prazo: "o pedido ficou dentro do prazo da clínica",
  remarcacao_invalida:
    "o horário novo não é do mesmo procedimento, profissional e pagamento",
  consulta_mudou: "a consulta mudou depois do pedido",
  // Revisao da AG4 (achado 1): a pergunta vale 60 minutos.
  pedido_vencido:
    "a pergunta do cancelamento venceu (mais de 1 hora sem a resposta)",
  // Revisao curta das correcoes da AG4 (achado 1).
  mensagem_nova_do_paciente:
    "a pessoa mandou outra mensagem enquanto o assistente respondia",
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
  // AG4: remarcar e cancelar ("fora_do_prazo" leva o numero do prazo, na
  // nota). As recusas que vem do banco depois da pergunta tambem.
  encaixe: "a consulta é um encaixe, que só a equipe mexe",
  so_com_a_equipe: "a consulta só é mexida pela equipe",
  pendente_da_equipe: "a consulta ainda espera a aprovação da equipe",
  remarcacao_pendente: "a consulta já tem uma remarcação esperando a aprovação",
  consulta_mudou: "a consulta mudou depois do pedido",
  remarcacao_invalida:
    "o horário escolhido não é do mesmo procedimento, profissional e pagamento",
  horario_fora_da_remarcacao:
    "o horário escolhido não é do mesmo procedimento, profissional e pagamento",
  sem_confirmacao_clara: "a resposta do paciente à pergunta do cancelamento não ficou clara",
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
  /**
   * AG4: o pedido de cancelar ou remarcar em andamento, com a consulta em
   * foco (so o dia e a hora, D-13; nulos quando nao deu para reler agora).
   */
  pedidoDaConsulta?: {
    acao: "cancelar" | "remarcar";
    dia: string | null;
    hora: string | null;
    /**
     * Revisao da AG4 (achado 1): a pergunta do cancelamento nao vale mais
     * (venceu, ou outra mensagem saiu entre ela e a resposta da pessoa): o
     * pedido foi desfeito no comeco do turno.
     */
    desfeito?: boolean;
    /**
     * Revisao curta das correcoes da AG4 (achado 6): desfeito porque a
     * consulta mudou de horario depois da pergunta (o dia e a hora sao os
     * de agora).
     */
    mudou?: boolean;
  } | null;
  /**
   * Revisao da AG4 (achado 7): a consulta cancelada pela IA nesta conversa,
   * relida (so o dia e a hora, D-13).
   */
  cancelada?: { dia: string; hora: string } | null;
  /**
   * AG4: a remarcacao pedida nesta conversa, relida (de, para e se ainda
   * espera a aprovacao da equipe).
   */
  remarcacao?: {
    de: { dia: string; hora: string } | null;
    para: { dia: string; hora: string };
    pendente: boolean;
  } | null;
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
   * registrar neste turno (como ele copiou, sem a marca do contato e como o
   * paciente escreveu), so para mascarar a copia do verificador. Revisao
   * curta das correcoes (achado 1, CFM): SO os que o servidor validou (achou
   * na mensagem do paciente e passou nas regras do nome) E que parecem nome
   * (pareceNomeDePessoa): "ana e to com o dente mole" nunca entra, mesmo
   * validado. Nunca vai para log nem para fora do turno.
   */
  nomesValidados: () => string[];
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

/**
 * AG4: o profissional do fato so quando se sabe (sem ele, a chave fica de
 * fora, como antes: "nao se sabe").
 */
function comOProfissional(
  nome: string | null | undefined,
): { profissional?: string } {
  return typeof nome === "string" && nome.trim() !== ""
    ? { profissional: nome }
    : {};
}

/** AG4: a frase fixa que encerra o turno (com os fatos dela). */
function frase(
  texto: string,
  corpo: Record<string, unknown>,
  passo: string,
  resultado: string,
  fatos: FatosDaFerramenta,
): ResultadoDaFerramentaDeAgenda {
  return {
    tipo: "frase",
    texto,
    saida: JSON.stringify({ resultado, ...corpo }),
    passo,
    resultado,
    fatos,
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
 * AG4: a consulta em foco do pedido de cancelar ou remarcar (so o servidor
 * ve isto: o vinculo, o profissional e a unidade nunca vao ao modelo).
 */
type ConsultaEmFoco = {
  id: string;
  /** ISO (UTC). */
  inicio: string;
  serviceLinkId: string | null;
  profissionalId: string | null;
  unidadeId: string | null;
};

/** AG4: as recusas da consulta que passam para a equipe (pedido_de_agenda). */
const RECUSAS_DA_EQUIPE: ReadonlySet<string> = new Set([
  "encaixe",
  "so_com_a_equipe",
  "pendente_da_equipe",
  "remarcacao_pendente",
  "cancelamento_desligado",
  "remarcacao_desligada",
]);

/**
 * AG4: as recusas que vao ao modelo (a consulta deixou de estar marcada, ou
 * mudou depois do pedido; o horario novo nao e o da consulta; a mensagem da
 * pessoa depois da pergunta nao veio), e o modelo diz isso a pessoa.
 */
const RECUSAS_PARA_O_MODELO: ReadonlySet<string> = new Set([
  "consulta_encerrada",
  "consulta_nao_encontrada",
  "consulta_mudou",
  "remarcacao_invalida",
  "sem_confirmacao_do_paciente",
]);

/**
 * AG4: as que desarmam o pedido. No cancelamento, todas (a pergunta volta
 * por pedir_cancelamento, com a consulta lida de novo). Na remarcacao, so a
 * consulta que deixou de estar marcada: com "a consulta mudou" (o banco
 * ancora na reserva) e com o horario de fora, reservar de novo resolve, sem
 * perder o foco (contrato da frente de banco, item 4).
 */
function desarmaOPedido(motivo: string, acao: AcaoComPrazo): boolean {
  return acao === "cancelar"
    ? RECUSAS_PARA_O_MODELO.has(motivo)
    : motivo === "consulta_encerrada" || motivo === "consulta_nao_encontrada";
}

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

/**
 * Revisao da AG4 (achado 1): por que o pedido de cancelar com que o turno
 * comecou foi desfeito no preparo, e o que a trilha diz. Revisao curta das
 * correcoes da AG4: "nao_conferida" (a pergunta nao foi entregue, saiu no
 * mesmo instante de outra mensagem, ou a conversa nao foi lida; conta
 * falha, como "outra_mensagem") e "consulta_mudou" (a pergunta da IA logo
 * antes e a do cancelamento da MESMA consulta com outro horario: a recepcao
 * mudou a consulta no meio; nao conta falha).
 */
type MotivoDoPedidoDesfeito =
  | "vencido"
  | "outra_mensagem"
  | "nao_conferida"
  | "consulta_nao_lida"
  | "consulta_mudou";

const PASSO_DO_PEDIDO_DESFEITO: Readonly<Record<MotivoDoPedidoDesfeito, string>> =
  {
    vencido: "A pergunta do cancelamento venceu (mais de 1 hora sem a resposta)",
    outra_mensagem:
      "A resposta da pessoa não veio logo depois da pergunta do cancelamento (outra mensagem da clínica saiu no meio)",
    nao_conferida:
      "Não deu para conferir que a resposta da pessoa veio logo depois da pergunta do cancelamento (a pergunta não foi entregue, saiu junto de outra mensagem, ou a conversa não foi lida)",
    consulta_nao_lida: "A consulta do pedido de cancelamento não foi relida",
    consulta_mudou:
      "A consulta do pedido de cancelamento mudou de horário depois da pergunta (nada foi cancelado)",
  };

/** Os motivos do pedido desfeito que contam uma falha (a pergunta de novo). */
const DESFEITO_QUE_E_FALHA: ReadonlySet<MotivoDoPedidoDesfeito> = new Set([
  "outra_mensagem",
  "nao_conferida",
]);

/**
 * Revisao curta das correcoes da AG4 (achados 1, 2 e 6): o resultado da
 * conferencia da pergunta do turno anterior contra a saida logo antes da
 * resposta da pessoa.
 */
type PerguntaConferida =
  | "conferida"
  | "outra_mensagem"
  | "nao_conferida"
  | "consulta_mudou";

/** Escapa o texto para virar parte de uma expressao regular. */
function literal(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Revisao curta das correcoes da AG4 (achado 6): a T1 de QUALQUER dia e
 * hora (a frase fixa com o dia e a hora no lugar de cada um), no fim da
 * mensagem (a saudacao e o aviso vem antes). Montada da propria frase: o
 * texto do dono que mudar muda aqui junto.
 */
const T1_DE_QUALQUER_HORARIO = (() => {
  const dia = "\u0000DIA\u0000";
  const hora = "\u0000HORA\u0000";
  const fonte = literal(perguntaDoCancelamento({ dia, hora }))
    .replace(literal(dia), "[^?]+?")
    .replace(literal(hora), "\\d{1,2}:\\d{2}");
  return new RegExp(`${fonte}\\s*$`);
})();

/**
 * Revisao curta das correcoes da AG4: a T3 de QUALQUER par de horarios (com
 * ou sem a unidade), no fim da mensagem.
 */
const T3_DE_QUALQUER_HORARIO = (() => {
  const dia = "\u0000DIA\u0000";
  const hora = "\u0000HORA\u0000";
  const unidade = "\u0000UNIDADE\u0000";
  const fonte = literal(
    perguntaDaRemarcacao({
      antiga: { dia, hora },
      nova: { dia, hora },
      unidade,
    }),
  )
    .replaceAll(literal(dia), "[^?]+?")
    .replaceAll(literal(hora), "\\d{1,2}:\\d{2}")
    // O aposto da unidade (", na unidade X,") e opcional.
    .replace(`, na unidade ${literal(unidade)},`, "(?:, na unidade [^?]+?,)?");
  return new RegExp(`${fonte}\\s*$`);
})();

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
 * Revisao da AG4 (achado 7): o estado logo depois de a IA cancelar uma
 * consulta nesta conversa (cancelar_consulta deixa o id dela em
 * appointment_id, com o desfecho), e nada de outro atendimento comecou.
 */
function ehEstadoDoCancelamento(e: EstadoDoAtendimento): boolean {
  return (
    e.desfecho === "cancelou" &&
    e.intencao === "cancelar" &&
    e.etapa === "informacao" &&
    e.pedido_pendente === null &&
    e.appointment_id !== null &&
    e.slot_hold_id === null &&
    e.horarios_oferecidos.length === 0
  );
}

/**
 * Revisao da AG4 (achado 1): a mensagem e a frase fixa da IA? A resposta
 * sai com a saudacao e o aviso colados ANTES da frase (laco.ts,
 * comporResposta): a frase e o fim da mensagem. Sem texto: nao.
 */
function terminaComAFrase(texto: string | null, frase: string): boolean {
  return texto !== null && texto.trim().endsWith(frase.trim());
}

/**
 * O executor das ferramentas de agenda de um turno. Sem porta (nenhum
 * servidor para ler a Agenda), toda ferramenta de agenda e falha fechada.
 */
export function criarAgendaDoTurno(entrada: {
  porta: PortaDaAgenda | null;
  catalogo: CatalogoDoAgente;
  /**
   * AG4: os prazos (opcionais: sem eles, cancelar e remarcar valem
   * desligadas e a conferencia da consulta da fora do prazo).
   */
  config: Pick<ConfigDoAgente, "habilidades" | "agenda"> &
    Partial<Pick<ConfigDoAgente, "dadosExigidos" | "prazos">>;
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
    /**
     * Revisao da AG4 (achado 1): a mensagem da clinica logo antes das
     * pendentes, com a autoria real (o historico mostra a IA, a equipe e o
     * sistema todos como "assistente"). A pergunta do cancelamento (T1) e a
     * da remarcacao (T3) so valem quando e ela, da IA; outra saida no meio
     * (campanha, lembrete, a equipe) desfaz o pedido. Ausente ou nula: nao
     * se sabe (falha fechada: desfaz). Revisao curta das correcoes da AG4
     * (achados 2 e 8): so vale SEM a leitura da porta
     * (lerSaidaAntesDaResposta, o simulador): no WhatsApp, o texto daqui e o
     * mascarado e a ordem e a do historico (as pendentes no fim), e a
     * conferencia usa a saida que o banco conta, com o corpo original.
     */
    antesDasPendentes?: {
      autoria: "ia" | "usuario" | "sistema" | null;
      texto: string | null;
    } | null;
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
  const ferramentasLigadas = ferramentasDoAgente(
    entrada.config.habilidades,
    entrada.config.agenda,
    entrada.config.prazos ?? null,
  );
  const agendaLigada = ferramentasLigadas.includes("buscar_horario");

  // AG4: o pedido de cancelar ou remarcar com que o turno comeca. "remarcou":
  // a remarcacao foi pedida nesta conversa (pos_marcacao, a consulta nova
  // no appointment_id). Revisao da AG4 (achado 7): "cancelou", a consulta
  // que a IA cancelou nesta conversa (o estado guarda o id dela, com o
  // desfecho, ate outro atendimento comecar).
  const pedidoInicial = estado.pedido_pendente;
  const focoInicialId = estado.appointment_id;
  const pedidoInicialEm = estado.pedido_pendente_em;
  const modoInicial: "cancelar" | "remarcar" | "remarcou" | "cancelou" | null =
    focoInicialId === null
      ? null
      : pedidoInicial === "cancelar"
        ? "cancelar"
        : pedidoInicial === "remarcar"
          ? "remarcar"
          : estado.intencao === "remarcar" && estado.etapa === "pos_marcacao"
            ? "remarcou"
            : ehEstadoDoCancelamento(estado)
              ? "cancelou"
              : null;
  /**
   * Revisao da AG4 (achado 1): o pedido com que o turno comecou foi desfeito
   * no preparo (a pergunta do cancelamento venceu, ou a mensagem logo antes
   * das pendentes nao e a pergunta da IA). O foco continua lido (fato), mas
   * nada e cancelado sem perguntar de novo.
   */
  let pedidoDesfeito: MotivoDoPedidoDesfeito | null = null;
  /**
   * Revisao da AG4 (achado 1): o preparo conferiu que a pergunta do turno
   * anterior (T1 no cancelamento, T3 na remarcacao) e a mensagem da IA logo
   * antes das pendentes (e, no cancelamento, que nao venceu). Sem o preparo
   * (ou com a pergunta que nao confere), cancelar_consulta e o agendar da
   * remarcacao recusam sem chamar a RPC: falha fechada.
   */
  let perguntaDoCancelamentoConferida = false;
  let perguntaDaRemarcacaoConferida = false;
  /**
   * Revisao curta das correcoes da AG4 (achado 2): a T3 do turno anterior
   * nao conferiu (outra saida no meio, ou nada lido), ou conferiu com a
   * consulta antiga em outro horario (a recepcao a mudou no meio: so
   * consulta_mudou, sem falha). Nulo: conferiu, ou nao era o caso.
   */
  let recusaDaPerguntaDaRemarcacao: "nao_conferida" | "consulta_mudou" | null =
    null;
  /**
   * Revisao curta das correcoes da AG4 (achados 2 e 8): a saida que o banco
   * ve logo antes da resposta da pessoa, lida pela porta no preparo (so com
   * uma pergunta do turno anterior a conferir). Nulo: nao lida (sem a porta,
   * o simulador: vale a mensagem logo antes das pendentes do historico).
   */
  let saidaAntes:
    | { tipo: "lida"; saida: SaidaAntesDaResposta | null }
    | { tipo: "falhou" }
    | null = null;
  /**
   * Revisao curta das correcoes da AG4 (achado 7): a consulta do pedido de
   * cancelar, relida no preparo, que NAO esta mais de pe (cancelada, passada
   * ou recusada): a retomada do mesmo job que a cancelou e caiu antes de
   * gravar o turno, ou outro cancelamento. Nunca e fato de consulta marcada;
   * cancelar_consulta deixa a RPC decidir (idempotente pelo job).
   */
  let focoInativo: ConsultaEmFoco | null = null;
  /**
   * Revisao curta das correcoes da AG4 (achado 1): a RPC disse
   * mensagem_nova_do_paciente. O fechamento devolve o estado do comeco, sem
   * falha nem pergunta armada.
   */
  let mensagemNova = false;

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
  /**
   * Os nomes que o servidor validou no turno e que parecem nome (so para
   * mascarar a copia do verificador).
   */
  const nomesValidados: string[] = [];
  let ultimaPreferencia: { periodo: string | null; hora: string | null } | null =
    null;
  /** A reserva conhecida: a deste turno ou a do estado, conferida. */
  let reserva: ReservaDoTurno | null = null;
  /** A consulta marcada nesta conversa (o estado), relida no turno. */
  let consultaLida: {
    dia: string;
    hora: string;
    unidade: string | null;
    profissional: string | null;
  } | null = null;
  let consultaDoTurno: { dia: string; hora: string } | null = null;

  // AG4: remarcar e cancelar.
  /** As consultas do contato lidas neste turno (os codigos c1 a c5). */
  let listaDoTurno: ConsultasDoContato | null = null;
  /**
   * Revisao da AG4 (achado 4): consultar_minhas_consultas rodou (e leu)
   * neste turno. Os codigos c1 a c5 so valem com ela: o codigo de outra
   * resposta pode apontar outra consulta (a lista muda entre as mensagens).
   */
  let listouNoTurno = false;
  const consultasPorCodigo = new Map<string, ConsultaDoContato>();
  /** A consulta em foco (do pedido do estado, relida, ou escolhida agora). */
  let foco: ConsultaEmFoco | null = null;
  /** A frase fixa deste turno que arma a pergunta no fechamento. */
  let perguntaArmada: "cancelar" | "remarcar" | null = null;
  let chamouPedidoDeCancelamento = false;
  let chamouCancelamento = false;
  /** A consulta cancelada neste turno (sai dos fatos do estado). */
  let canceladaNoTurno: string | null = null;
  /** A remarcacao pedida neste turno (a antiga e a nova, como fato). */
  let remarcacaoNoTurno: { antiga: HorarioDoFato; nova: HorarioDoFato } | null =
    null;
  /** A remarcacao pedida nesta conversa, relida (modo "remarcou"). */
  let remarcacaoLida: {
    nova: ConsultaDoFato;
    antiga: ConsultaDoFato | null;
    pendente: boolean;
  } | null = null;
  /**
   * Revisao da AG4 (achado 7): a consulta que a IA cancelou nesta conversa,
   * relida e ainda cancelada (modo "cancelou"): o fato do cancelamento no
   * turno seguinte, so com o par dela.
   */
  let canceladaLida: HorarioDoFato | null = null;
  /** O pedido que a nota da passagem conta (a acao e a consulta). */
  let pedidoDaNota: { acao: AcaoComPrazo; consulta: ConsultaEmFoco } | null =
    null;

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

  /**
   * AG4 (o limite da 21.15): o nome do profissional pelo id, do Cadastro. So
   * para os fatos do turno e a trilha; nunca vai ao modelo nem ao resumo.
   */
  const nomeDoProfissional = (id: string | null | undefined): string | null =>
    id === null || id === undefined
      ? null
      : ((catalogo.profissionais ?? []).find((p) => p.id === id)?.nome ??
        catalogo.vinculos.find((v) => v.profissionalId === id)?.profissional ??
        null);

  /** AG4: o prazo de uma acao (nulo: nao preenchido, a IA nao age). */
  const prazoDe = (acao: AcaoComPrazo): number | null =>
    prazoDaAcao(entrada.config.prazos ?? null, acao);

  /**
   * AG4: uma consulta como fato do turno (o dia, a hora, a unidade e o
   * profissional do Cadastro). "marcada": a IA marcou nesta conversa;
   * "remarcada": e a remarcacao pedida nesta conversa, ainda pendente.
   * Revisao da AG4 (achado 7): "remarcacaoAprovada", a remarcacao pedida
   * nesta conversa que a equipe ja aprovou ("foi remarcada" vale com ela,
   * sem a pendencia).
   */
  function consultaComoFato(
    c: {
      inicio: string;
      unidadeId?: string | null;
      profissionalId?: string | null;
    },
    sinais: {
      marcada: boolean;
      remarcada?: boolean;
      remarcacaoAprovada?: boolean;
    },
  ): ConsultaDoFato {
    const { dia, hora } = diaEHora(new Date(c.inicio), fuso, agoraMs);
    return {
      dia,
      hora,
      unidade: nomeDaUnidade(c.unidadeId),
      ...comOProfissional(nomeDoProfissional(c.profissionalId)),
      marcadaNestaConversa: sinais.marcada,
      ...(sinais.remarcada === true ? { remarcadaNestaConversa: true } : {}),
      ...(sinais.remarcacaoAprovada === true
        ? { remarcacaoAprovada: true }
        : {}),
    };
  }

  /** AG4: a consulta da lista como a consulta em foco. */
  const focoDaConsulta = (c: ConsultaDoContato): ConsultaEmFoco => ({
    id: c.id,
    inicio: c.inicio,
    serviceLinkId: c.serviceLinkId,
    profissionalId: c.profissionalId,
    unidadeId: c.unidadeId,
  });

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
  // Revisao da AG4 (achado 1): a pergunta do turno anterior
  // -------------------------------------------------------------------------

  /**
   * Contrato da frente de banco (R8): o instante da pergunta conferida (a
   * saida logo antes da resposta, lida do banco). Nulo: sem a leitura do
   * banco, ou sem o instante.
   */
  function instanteDaPergunta(): string | null {
    return saidaAntes?.tipo === "lida" && saidaAntes.saida !== null
      ? saidaAntes.saida.criadaEm
      : null;
  }

  /**
   * A saida logo antes da resposta da pessoa e a frase fixa da IA? O
   * historico mostra a IA, a equipe e o sistema todos como "assistente":
   * vale a autoria real. Sem a mensagem, sem a autoria ou com outro texto:
   * nao (falha fechada).
   *
   * Revisao curta das correcoes da AG4 (achados 2, 6 e 8): com a porta, a
   * saida e a que o banco conta (a ordem real, a apagada e a automatica
   * inclusive), conferida contra o corpo ORIGINAL (a mascara do nome do
   * historico trocava "Vila Mariana" por "Vila Fulano" e "domingo" por
   * "Fulano", e a pergunta nunca conferia); a entregue com falha e a do
   * mesmo instante de outra saida nao valem. A frase fixa da IA com outro
   * horario (`molde`, a mesma frase com qualquer dia e hora) e
   * consulta_mudou: a consulta mudou depois da pergunta. Sem a porta (o
   * simulador, que nao mascara), a mensagem logo antes das pendentes.
   */
  function conferirAPergunta(frase: string, molde: RegExp): PerguntaConferida {
    let antes: { autoria: string | null; texto: string | null } | null;
    if (saidaAntes !== null) {
      if (saidaAntes.tipo === "falhou") {
        return "nao_conferida";
      }
      const lida = saidaAntes.saida;
      if (lida !== null && lida.autoria === "ia" && (lida.falhou || lida.empate)) {
        return "nao_conferida";
      }
      antes = lida;
    } else {
      antes = entrada.mensagens?.antesDasPendentes ?? null;
    }
    if (antes === null || antes.autoria !== "ia" || antes.texto === null) {
      return "outra_mensagem";
    }
    if (terminaComAFrase(antes.texto, frase)) {
      return "conferida";
    }
    return molde.test(antes.texto.trim()) ? "consulta_mudou" : "outra_mensagem";
  }

  /**
   * Desfaz o pedido de cancelar com que o turno comecou: a pergunta venceu
   * (60 minutos, como o banco), a resposta da pessoa nao veio logo depois
   * dela (outra mensagem da clinica no meio: campanha, lembrete, a equipe;
   * o "sim" pode ser de outra pergunta) ou a consulta nao foi relida. O
   * foco lido continua fato (a consulta esta de pe); nada e cancelado sem
   * perguntar de novo.
   */
  function desfazerOPedidoDoComeco(motivo: MotivoDoPedidoDesfeito) {
    pedidoDesfeito = motivo;
    estado.pedido_pendente = null;
    estado.pedido_pendente_em = null;
    estado.appointment_id = null;
    if (estado.etapa === "cancelar") {
      estado.etapa = "informacao";
    }
  }

  /**
   * A pergunta do turno anterior so vale para a resposta que veio LOGO
   * depois dela (o banco confere a mesma ancora, contrato-mudancas R2 e R3):
   *  - cancelar (T1): o pedido vale 60 minutos e a mensagem logo antes das
   *    pendentes tem de ser a pergunta da IA para a consulta em foco, relida
   *    agora (a consulta que mudou de horario muda a pergunta). Senao, o
   *    pedido e desfeito;
   *  - remarcar (T3, na etapa aguardando_confirmacao): a mensagem logo antes
   *    das pendentes tem de ser a pergunta da IA para a reserva e a consulta
   *    lidas agora. Senao, o agendar da remarcacao recusa sem a RPC (o
   *    modelo reserva de novo e o sistema pergunta outra vez).
   */
  function conferirAPerguntaDoTurnoAnterior(): void {
    if (modoInicial === "cancelar") {
      if (foco === null && focoInativo !== null) {
        // Revisao curta das correcoes da AG4 (achado 7): a consulta do
        // pedido ja nao esta de pe. Nada a perguntar de novo (nao ha o que
        // cancelar): cancelar_consulta deixa a RPC decidir (o mesmo job que
        // cancelou recebe reutilizado; senao, consulta_encerrada).
        return;
      }
      if (foco === null) {
        desfazerOPedidoDoComeco(
          pedidoAindaVale(pedidoInicialEm, relogio())
            ? "consulta_nao_lida"
            : "vencido",
        );
        return;
      }
      const conferida = conferirAPergunta(
        perguntaDoCancelamento(diaEHora(new Date(foco.inicio), fuso, agoraMs)),
        T1_DE_QUALQUER_HORARIO,
      );
      if (conferida !== "conferida") {
        // Sem a pergunta logo antes e com o proprio pedido ja vencido (mais
        // de 60 minutos), vale o vencido (pergunta de novo sem falha), como
        // antes; a consulta que mudou de horario fica consulta_mudou.
        desfazerOPedidoDoComeco(
          conferida !== "consulta_mudou" &&
            !pedidoAindaVale(pedidoInicialEm, relogio())
            ? "vencido"
            : conferida,
        );
        return;
      }
      // Contrato da frente de banco (R8): a validade (60 minutos) conta da
      // PERGUNTA respondida, o instante dela no banco (a pergunta feita de
      // novo aos 50 minutos vale ate os 110). Sem a leitura do banco (o
      // simulador), do instante do pedido, como antes.
      if (!pedidoAindaVale(instanteDaPergunta() ?? pedidoInicialEm, relogio())) {
        desfazerOPedidoDoComeco("vencido");
        return;
      }
      perguntaDoCancelamentoConferida = true;
      return;
    }
    if (modoInicial === "remarcar" && etapaInicial === "aguardando_confirmacao") {
      const leitura = reserva?.leitura ?? null;
      const conferida: PerguntaConferida =
        foco === null || leitura === null
          ? "nao_conferida"
          : conferirAPergunta(
              perguntaDaRemarcacao({
                antiga: diaEHora(new Date(foco.inicio), fuso, agoraMs),
                nova: diaEHora(new Date(leitura.inicio), fuso, agoraMs),
                unidade:
                  (catalogo.unidades ?? []).length > 1
                    ? nomeDaUnidade(leitura.unidadeId)
                    : null,
              }),
              T3_DE_QUALQUER_HORARIO,
            );
      perguntaDaRemarcacaoConferida = conferida === "conferida";
      recusaDaPerguntaDaRemarcacao =
        conferida === "conferida"
          ? null
          : conferida === "consulta_mudou"
            ? "consulta_mudou"
            : "nao_conferida";
      if (
        !perguntaDaRemarcacaoConferida &&
        estado.etapa === "aguardando_confirmacao"
      ) {
        // A pergunta nao vale: a reserva e o foco ficam, a etapa volta para
        // a oferta (o modelo reserva de novo e o sistema pergunta outra vez).
        estado.etapa = "oferta";
      }
    }
  }

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
    // A consulta do estado: a marcada nesta conversa (AG3; so o dia, a hora
    // e a unidade ao modelo; AG4, o profissional nos fatos), a consulta em
    // foco do pedido de cancelar ou remarcar (AG4, nunca "marcada nesta
    // conversa") ou, depois de remarcar, a nova e a antiga.
    if (estado.appointment_id !== null && porta.lerConsulta !== undefined) {
      const id = estado.appointment_id;
      if (modoInicial === "cancelar" || modoInicial === "remarcar") {
        try {
          const lida = await porta.lerConsulta(id);
          const lidaComoFoco =
            lida === null
              ? null
              : {
                  id,
                  inicio: lida.inicio,
                  serviceLinkId: lida.serviceLinkId ?? null,
                  profissionalId: lida.profissionalId ?? null,
                  unidadeId: lida.unidadeId ?? null,
                };
          if (lidaComoFoco !== null && lida !== null && lida.ativa) {
            foco = lidaComoFoco;
          } else if (lidaComoFoco !== null && modoInicial === "cancelar") {
            // Revisao curta das correcoes da AG4 (achado 7): a consulta do
            // pedido de cancelar existe e nao esta mais de pe (nunca fato).
            focoInativo = lidaComoFoco;
          }
        } catch {
          foco = null;
        }
      } else if (modoInicial === "remarcou") {
        try {
          const nova = await porta.lerConsulta(id);
          if (nova !== null && nova.ativa) {
            const pendente = nova.pendente === true;
            let antiga: ConsultaDoFato | null = null;
            if (nova.remarcacaoDe) {
              const lidaAntiga = await porta.lerConsulta(nova.remarcacaoDe);
              if (lidaAntiga !== null && lidaAntiga.ativa) {
                antiga = consultaComoFato(lidaAntiga, { marcada: false });
              }
            }
            remarcacaoLida = {
              // Revisao da AG4 (achado 7): aprovada (a de pe que nao espera
              // mais a equipe; a recusada nao esta de pe), "foi remarcada"
              // vale sem a pendencia.
              nova: consultaComoFato(nova, {
                marcada: false,
                remarcada: pendente,
                remarcacaoAprovada: !pendente,
              }),
              antiga,
              pendente,
            };
          }
        } catch {
          remarcacaoLida = null;
        }
      } else if (modoInicial === "cancelou") {
        // Revisao da AG4 (achado 7): a consulta que a IA cancelou nesta
        // conversa, relida; so a que continua cancelada vira fato.
        try {
          const lida = await porta.lerConsulta(id);
          if (lida !== null && lida.cancelada === true) {
            canceladaLida = consultaComoFato(lida, { marcada: false });
          }
        } catch {
          canceladaLida = null;
        }
      } else {
        try {
          const lida = await porta.lerConsulta(id);
          if (lida !== null && lida.ativa) {
            consultaLida = {
              ...diaEHora(new Date(lida.inicio), fuso, agoraMs),
              unidade: nomeDaUnidade(lida.unidadeId),
              profissional: nomeDoProfissional(lida.profissionalId),
            };
          }
        } catch {
          consultaLida = null;
        }
      }
    }
    // Revisao curta das correcoes da AG4 (achados 2 e 8): a saida logo antes
    // da resposta da pessoa, como o banco conta, so quando ha uma pergunta
    // do turno anterior a conferir (a leitura que falha nao confere).
    const temPerguntaAConferir =
      modoInicial === "cancelar" ||
      (modoInicial === "remarcar" && etapaInicial === "aguardando_confirmacao");
    if (temPerguntaAConferir && porta.lerSaidaAntesDaResposta !== undefined) {
      try {
        saidaAntes = {
          tipo: "lida",
          saida: await porta.lerSaidaAntesDaResposta(),
        };
      } catch {
        saidaAntes = { tipo: "falhou" };
      }
    }
    // Revisao da AG4 (achado 1): a pergunta do turno anterior (T1 ou T3) so
    // vale para a resposta que veio logo depois dela.
    conferirAPerguntaDoTurnoAnterior();
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
      informarValor: ferramentasLigadas.includes("buscar_procedimento"),
      nascimentos: entrada.nascimentos ?? [],
    });
    // AG4: buscar_horario e para marcar uma consulta NOVA. Com uma
    // remarcacao em andamento, o pedido de remarcar sai (a busca da
    // remarcacao e buscar_horario_para_remarcar): o horario desta busca
    // reserva como marcacao nova, e o banco recusa ja_tem_consulta do mesmo
    // procedimento.
    if (estado.pedido_pendente === "remarcar") {
      desarmarPedido();
    }
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
    // AG4: com o pedido de remarcar no estado, a reserva e da remarcacao
    // (p_remarcar, a consulta em foco).
    const remarcarId =
      estado.pedido_pendente === "remarcar" ? estado.appointment_id : null;
    estado.intencao = remarcarId === null ? "agendar" : "remarcar";
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
    // AG4: a pre-checagem da remarcacao (D-26): o horario novo e do mesmo
    // procedimento, do mesmo profissional e do mesmo pagamento da consulta
    // em foco. A RPC confere de novo (remarcacao_invalida).
    if (remarcarId !== null) {
      // Revisao da AG4 (achado 3): o banco so conhece o pedido de remarcar
      // que o turno ANTERIOR gravou (pedido_da_ia_na_conversa). Com a busca
      // da remarcacao nesta mesma resposta (o pedido nao estava no estado do
      // comeco do turno, ou o foco mudou), a RPC recusaria
      // sem_pedido_de_remarcacao: nada de RPC; o modelo oferece o horario e
      // espera a escolha numa mensagem nova.
      if (pedidoInicial !== "remarcar" || focoInicialId !== remarcarId) {
        resultados.push("oferecer_antes_de_reservar");
        return saida(
          "oferecer_antes_de_reservar",
          {},
          `Tentou reservar ${horario.dia} às ${horario.hora} para a remarcação na mesma resposta da busca: o horário vai à pessoa primeiro`,
        );
      }
      const daConsulta =
        foco !== null && foco.id === remarcarId
          ? vinculoDe(foco.serviceLinkId)
          : undefined;
      if (daConsulta === undefined) {
        return {
          tipo: "falha",
          passo: "Não foi possível ler a consulta que está sendo remarcada.",
        };
      }
      const doHorario = vinculoDe(horario.serviceLinkId);
      if (
        doHorario === undefined ||
        doHorario.procedimentoId !== daConsulta.procedimentoId ||
        doHorario.profissionalId !== daConsulta.profissionalId ||
        doHorario.convenioId !== daConsulta.convenioId
      ) {
        resultados.push("horario_fora_da_remarcacao");
        return saida(
          "horario_fora_da_remarcacao",
          {},
          "Tentou reservar para a remarcação um horário de outro procedimento, profissional ou pagamento",
        );
      }
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
        ...(remarcarId === null ? {} : { remarcarId }),
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
      // AG4: as recusas da remarcacao (a habilidade, o pedido, a consulta e
      // o prazo), so no modo de remarcacao.
      if (remarcarId !== null && ehMotivoDaRemarcacao(resposta.motivo)) {
        const daRemarcacao = recusaDoPedido(
          resposta.motivo,
          "remarcar",
          `Não reservou ${pedido} para a remarcação`,
        );
        if (daRemarcacao !== null) {
          return daRemarcacao;
        }
      }
      if (remarcarId !== null && resposta.motivo === "ja_tem_consulta") {
        // Revisao da AG4 (achado 2): com p_remarcar o banco NAO confere
        // ja_tem_consulta (a remarcacao troca uma consulta por outra;
        // contrato-mudancas R5). A recusa aqui e fora do contrato: falha
        // fechada, e o modelo nunca diz "voce ja tem consulta" no meio da
        // remarcacao.
        return {
          tipo: "falha",
          passo: `Não reservou ${pedido} para a remarcação: o banco respondeu fora do contrato da remarcação.`,
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
    if (
      estado.etapa === "informacao" ||
      estado.etapa === "escolha" ||
      estado.etapa === "remarcar"
    ) {
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
    const quando = `${dia} às ${hora}${entreParenteses(nomes)}${unidade === null ? "" : `, unidade ${unidade.nome}`}`;
    const livre: HorarioLivreDoTurno = { dia, hora, unidade: unidade?.nome ?? null };
    if (remarcarId !== null && foco !== null) {
      // AG4: a remarcacao nao pede dados (D-26). O SISTEMA pergunta (T3), e
      // a pergunta arma "aguardando_confirmacao" pelo resultado.
      dados.faltam = [];
      perguntaArmada = "remarcar";
      const antiga = diaEHora(new Date(foco.inicio), fuso, agoraMs);
      const variasUnidades = (catalogo.unidades ?? []).length > 1;
      const unidadeDaFrase = variasUnidades ? (unidade?.nome ?? null) : null;
      const daConsulta = `${antiga.dia} às ${antiga.hora}`;
      return frase(
        perguntaDaRemarcacao({
          antiga,
          nova: { dia, hora },
          unidade: unidadeDaFrase,
        }),
        {
          minutos: MINUTOS_DA_RESERVA,
          dia,
          hora,
          ...(unidadeDaFrase === null ? {} : { unidade: unidadeDaFrase }),
          consulta: antiga,
        },
        porta?.simulada
          ? `Reservaria ${quando} por ${MINUTOS_DA_RESERVA} minutos para a remarcação da consulta de ${daConsulta} e perguntaria se a pessoa confirma. ${SIMULADO}`
          : `Reservou ${quando} por ${MINUTOS_DA_RESERVA} minutos para a remarcação da consulta de ${daConsulta} e perguntou se a pessoa confirma`,
        "reservado",
        {
          acao: "reservou",
          horarioDaAcao: {
            dia,
            hora,
            unidade: unidade?.nome ?? null,
            profissional: nomes?.profissional ?? null,
          },
          horarios: [livre],
          consultaLida: true,
          consultasComHorario: [consultaComoFato(foco, { marcada: false })],
        },
      );
    }
    recalcularFaltam(serviceLinkId);
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
    // paciente escreveu, para a copia do verificador ir sem ele. Revisao
    // curta das correcoes (achado 1, CFM): so com o nome VALIDADO pelo
    // servidor (achado na mensagem do paciente e nas regras do nome) e so as
    // formas que parecem nome; o resto vai ao verificador como esta.
    const pedidoDoNome = entradaDoRegistroDeDadosSchema.safeParse(argumentos);
    if (
      preparo.tipo === "pronto" &&
      preparo.dados.nomeCompleto !== null &&
      pedidoDoNome.success &&
      pedidoDoNome.data.nome_completo !== null
    ) {
      const copiado = pedidoDoNome.data.nome_completo;
      // Sem a marca do nome do contato ("Fulano da Silva" vira "da Silva"
      // quando a resposta tira a marca).
      const semAMarca = copiado
        .replace(/(?<!\p{L})fulan[oa](?!\p{L})/giu, " ")
        .replace(/\s+/gu, " ")
        .trim();
      for (const forma of [copiado, semAMarca, preparo.dados.nomeCompleto]) {
        if (pareceNomeDePessoa(forma) && !nomesValidados.includes(forma)) {
          nomesValidados.push(forma);
        }
      }
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
    let profissionalId: string | null = null;
    if (appointmentId && porta?.lerConsulta !== undefined) {
      try {
        const lida = await porta.lerConsulta(appointmentId);
        if (lida !== null) {
          inicio = lida.inicio;
          unidadeId = lida.unidadeId ?? null;
          profissionalId = lida.profissionalId ?? null;
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
          // AG4 (o limite da 21.15): o profissional relido, so nos fatos.
          ...comOProfissional(nomeDoProfissional(profissionalId)),
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
    /**
     * Revisao da AG4 (achado 6, D-13): na remarcacao, ao modelo vao so o dia,
     * a hora e, com mais de uma unidade na clinica, a unidade da reserva viva
     * (o procedimento, o profissional e o pagamento sao os da consulta, que
     * a pessoa ja tem). Os nomes ficam na trilha.
     */
    naRemarcacao = false,
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
    if (!naRemarcacao) {
      recalcularFaltam(viva.serviceLinkId);
    }
    const nomes = nomesDoVinculo(viva.serviceLinkId);
    const unidade = nomeDaUnidade(viva.unidadeId);
    const { dia, hora } = diaEHora(new Date(viva.inicio), fuso, agoraMs);
    const variasUnidades = (catalogo.unidades ?? []).length > 1;
    return saida(
      "reserva_diferente",
      {
        horario_reservado: naRemarcacao
          ? {
              dia,
              hora,
              ...(variasUnidades && unidade !== null ? { unidade } : {}),
            }
          : {
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
    // AG4: com o pedido de remarcar no comeco do turno (e ainda de pe), o
    // agendar e o da remarcacao (p_remarcar, a consulta em foco).
    const remarcarId =
      modoInicial === "remarcar" && estado.pedido_pendente === "remarcar"
        ? focoInicialId
        : null;
    estado.intencao = remarcarId === null ? "agendar" : "remarcar";
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
    // Revisao da AG4 (achado 1): na remarcacao, a pergunta (T3) tem de ser
    // a mensagem da IA logo antes da resposta da pessoa (o preparo confere;
    // sem ele, falha fechada), como o banco.
    if (remarcarId !== null && !perguntaDaRemarcacaoConferida) {
      if (recusaDaPerguntaDaRemarcacao === "consulta_mudou") {
        // Revisao curta das correcoes da AG4 (achado 6): a T3 logo antes e a
        // da mesma remarcacao com a consulta antiga em outro horario (a
        // recepcao a mudou depois da pergunta): consulta_mudou, sem falha. O
        // pedido fica (o modelo reserva de novo e o sistema pergunta outra
        // vez, com o horario novo), como na recusa do banco.
        resultados.push("consulta_mudou");
        return saida(
          "consulta_mudou",
          {},
          `Não pediu a remarcação: ${ROTULO_DO_MOTIVO_DA_AGENDA.consulta_mudou} (a consulta antiga mudou de horário depois da pergunta)`,
        );
      }
      // Revisao curta das correcoes da AG4 (achado 2): a recusa da T3 conta
      // falha MESMO com o reservar de novo no mesmo turno (a pergunta que
      // nunca confere passa para a equipe na segunda vez, nunca um laco).
      resultados.push("sem_confirmacao_do_paciente", "resposta_fora_da_pergunta");
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
        ? await porta.agendar({
            slotHoldId: reservaPerguntada,
            ...(remarcarId === null ? {} : { remarcarId }),
          })
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
      if (resposta.motivo === "mensagem_nova_do_paciente") {
        // Revisao curta das correcoes da AG4 (achado 1): a pessoa escreveu de
        // novo depois das mensagens que o job leu (o "Confirmo" pode ter
        // virado outra coisa). Nada foi marcado: o turno para sem enviar nada
        // e o proximo le a mensagem nova (fechar devolve o estado do comeco).
        mensagemNova = true;
        return {
          tipo: "mensagem_nova",
          passo: `Não ${remarcarId === null ? "marcou a consulta" : "pediu a remarcação"}: ${motivo}. Nada foi enviado; a próxima resposta lê a mensagem nova.`,
        };
      }
      if (resposta.motivo === "sem_confirmacao_do_paciente") {
        // Revisao curta das correcoes da AG4 (achado 2 e a ancora forte do
        // agendar da AG3): o banco nao viu o "sim" logo depois da pergunta
        // (outra saida no meio). "Pergunte de novo", como no cancelar: conta
        // falha mesmo com o reservar de novo no mesmo turno (a segunda
        // seguida passa para a equipe, nunca um laco).
        resultados.push("resposta_fora_da_pergunta");
      }
      // AG4: as recusas da remarcacao (a habilidade, o pedido, a consulta,
      // o prazo e "a consulta mudou"), so no modo de remarcacao.
      if (remarcarId !== null && ehMotivoDaRemarcacao(resposta.motivo)) {
        const daRemarcacao = recusaDoPedido(
          resposta.motivo,
          "remarcar",
          "Não pediu a remarcação",
        );
        if (daRemarcacao !== null) {
          return daRemarcacao;
        }
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
        if (remarcarId !== null) {
          // Revisao da AG4 (achado 2): fora do contrato da remarcacao
          // (contrato-mudancas R5): falha fechada.
          return {
            tipo: "falha",
            passo:
              "Não pediu a remarcação: o banco respondeu fora do contrato da remarcação.",
          };
        }
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
        // Revisao da AG4 (achado 6, D-13): na remarcacao, ao modelo so o dia,
        // a hora e (com mais de uma unidade) a unidade da reserva viva.
        return reservaDiferente(`Não marcou: ${motivo}`, remarcarId !== null);
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
    if (remarcarId !== null) {
      return remarcou(resposta, remarcarId);
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
      // Revisao final da AG3: a consulta lida com o dia e a hora dela. AG4
      // (o limite da 21.15): e o profissional relido, so nos fatos.
      {
        ...fatosDaConfirmacao,
        consultaComHorario: {
          ...quando,
          unidade: null,
          ...comOProfissional(
            nomeDoProfissional(resposta.profissionalId) ??
              nomes?.profissional ??
              null,
          ),
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
  // AG4: remarcar e cancelar
  // -------------------------------------------------------------------------

  /** O texto da acao na trilha e na nota. */
  const verboDaAcao = (acao: AcaoComPrazo) =>
    acao === "cancelar" ? "cancelar" : "remarcar";

  /** "quinta, 29/10 às 14:00 (Limpeza, Dra. Ana)": so na trilha e na nota. */
  const descricaoDaConsulta = (c: {
    inicio: string;
    serviceLinkId: string | null;
  }): string => {
    const { dia, hora } = diaEHora(new Date(c.inicio), fuso, agoraMs);
    return `${dia} às ${hora}${entreParenteses(nomesDoVinculo(c.serviceLinkId))}`;
  };

  /**
   * Tira o pedido de cancelar ou remarcar do estado (a pessoa mudou de
   * assunto, a consulta mudou, ou o pedido acabou). O que a nota conta fica
   * em pedidoDaNota.
   */
  function desarmarPedido(): void {
    if (estado.pedido_pendente === null) {
      return;
    }
    estado.pedido_pendente = null;
    estado.pedido_pendente_em = null;
    estado.appointment_id = null;
    if (estado.etapa === "cancelar" || estado.etapa === "remarcar") {
      estado.etapa = "informacao";
    }
    if (perguntaArmada !== null) {
      perguntaArmada = null;
    }
  }

  /** O instante de agora em UTC (o banco carimba o de verdade). */
  const agoraEmUtc = () => new Date(relogio()).toISOString();

  /**
   * A recusa da conferencia da consulta, do espelho (antes da RPC) ou do
   * banco: a da equipe passa com pedido_de_agenda; a do prazo, com
   * fora_do_prazo; a que o modelo conta (a consulta nao esta mais marcada,
   * mudou, ou o horario novo nao e o dela) volta para ele e desarma o
   * pedido; a do pedido que nao esta no estado e falha fechada. Nulo: nao e
   * recusa do pedido (quem chama trata).
   */
  function recusaDoPedido(
    motivo: string,
    acao: AcaoComPrazo,
    passoBase: string,
  ): ResultadoDaFerramentaDeAgenda | null {
    const rotulo =
      ROTULO_DO_MOTIVO_DA_AGENDA[
        motivo as keyof typeof ROTULO_DO_MOTIVO_DA_AGENDA
      ] ?? motivo;
    if (RECUSAS_DA_EQUIPE.has(motivo)) {
      if (!resultados.includes(motivo)) {
        resultados.push(motivo);
      }
      return {
        tipo: "passar",
        motivo: "pedido_de_agenda",
        resultado: motivo,
        passo: `${passoBase}: ${rotulo}`,
      };
    }
    if (motivo === "fora_do_prazo") {
      if (!resultados.includes(motivo)) {
        resultados.push(motivo);
      }
      const prazo = prazoDe(acao);
      return {
        tipo: "passar",
        motivo: "fora_do_prazo",
        resultado: motivo,
        passo: `${passoBase}: o pedido ficou dentro do prazo da clínica para o assistente ${verboDaAcao(acao)}${prazo === null ? "" : ` (${prazo === 1 ? "1 hora" : `${prazo} horas`})`}`,
      };
    }
    if (
      motivo === "sem_pedido_de_remarcacao" ||
      motivo === "sem_pedido_de_cancelamento"
    ) {
      return {
        tipo: "falha",
        passo: `${passoBase}: ${rotulo}.`,
      };
    }
    if (RECUSAS_PARA_O_MODELO.has(motivo)) {
      if (!resultados.includes(motivo)) {
        resultados.push(motivo);
      }
      if (desarmaOPedido(motivo, acao)) {
        desarmarPedido();
      }
      return saida(motivo, {}, `${passoBase}: ${rotulo}`);
    }
    return null;
  }

  /** As consultas do contato, lidas uma vez por turno (c1 a c5). */
  async function lerAsConsultas(): Promise<ConsultasDoContato | null> {
    if (listaDoTurno !== null) {
      return listaDoTurno;
    }
    if (porta === null || porta.lerConsultasDoContato === undefined) {
      return null;
    }
    const lida = await porta.lerConsultasDoContato();
    const consultas = emOrdem(lida.consultas).slice(
      0,
      MAXIMO_DE_CONSULTAS_NA_LISTA,
    );
    listaDoTurno = {
      consultas,
      haMais: lida.haMais || lida.consultas.length > consultas.length,
    };
    consultas.forEach((c, i) => consultasPorCodigo.set(`c${i + 1}`, c));
    return listaDoTurno;
  }

  async function consultarMinhasConsultas(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    if (!entradaDasMinhasConsultasSchema.safeParse(argumentos ?? {}).success) {
      resultados.push("entrada_invalida");
      return saida(
        "entrada_invalida",
        {},
        "Tentou consultar as consultas do paciente com um pedido fora do formato",
      );
    }
    let lista: ConsultasDoContato | null;
    try {
      lista = await lerAsConsultas();
    } catch {
      lista = null;
    }
    if (lista === null) {
      return {
        tipo: "falha",
        passo: "Não foi possível ler as consultas do paciente agora.",
      };
    }
    listouNoTurno = true;
    if (lista.consultas.length === 0) {
      resultados.push("sem_consultas");
      return saida(
        "sem_consultas",
        {},
        "Procurou as consultas do paciente: nenhuma consulta futura",
      );
    }
    resultados.push("consultas");
    const consultas = lista.consultas.map((c, i) => ({
      codigo: `c${i + 1}`,
      ...diaEHora(new Date(c.inicio), fuso, agoraMs),
      situacao: situacaoDaConsulta(c),
    }));
    const lidas = lista.consultas
      .map(
        (c) =>
          `${descricaoDaConsulta(c)}, ${ROTULO_DA_SITUACAO[situacaoDaConsulta(c)]}`,
      )
      .join("; ");
    return saida(
      "consultas",
      { consultas, ha_mais: lista.haMais },
      `Leu as consultas do paciente: ${lidas}${lista.haMais ? "; e outras" : ""}`,
      [],
      {
        consultaLida: true,
        consultasComHorario: lista.consultas.map((c) =>
          consultaComoFato(c, { marcada: false }),
        ),
      },
    );
  }

  /**
   * A consulta do codigo, da lista que consultar_minhas_consultas leu NESTE
   * turno, ou o resultado que encerra a ferramenta (codigo invalido).
   * Revisao da AG4 (achado 4): sem a lista do turno, o codigo e de outra
   * resposta (a lista pode ter mudado: a recepcao marcou ou cancelou outra
   * consulta no meio, e "c2" passaria a ser outra): codigo_invalido, sem
   * ler nada, e o modelo lista de novo.
   */
  async function consultaDoCodigo(
    codigo: string,
    passoDoCodigo: string,
  ): Promise<ConsultaDoContato | ResultadoDaFerramentaDeAgenda> {
    if (!listouNoTurno) {
      resultados.push("codigo_invalido");
      return saida("codigo_invalido", {}, passoDoCodigo);
    }
    const consulta = consultasPorCodigo.get(codigo.trim().toLowerCase());
    if (consulta === undefined) {
      resultados.push("codigo_invalido");
      return saida("codigo_invalido", {}, passoDoCodigo);
    }
    return consulta;
  }

  /**
   * A recusa da conferencia em TS (antes de qualquer RPC). Revisao curta das
   * correcoes da AG4 (achado 7): sem a descricao (a consulta nao foi lida),
   * "a consulta do pedido" (nunca "a consulta de do pedido").
   */
  function recusaDaConferencia(
    motivo: MotivoDaConferenciaDaConsulta,
    acao: AcaoComPrazo,
    descricao: string | null,
  ): ResultadoDaFerramentaDeAgenda {
    const passoBase = `Não pediu para ${verboDaAcao(acao)} a consulta ${descricao === null ? "do pedido" : `de ${descricao}`}`;
    if (motivo === "consulta_nao_encontrada" || motivo === "consulta_encerrada") {
      resultados.push("consulta_encerrada");
      return saida(
        "consulta_encerrada",
        {},
        `${passoBase}: ${ROTULO_DO_MOTIVO_DA_AGENDA.consulta_encerrada}`,
      );
    }
    return (
      recusaDoPedido(motivo, acao, passoBase) ?? {
        tipo: "falha",
        passo: `${passoBase}.`,
      }
    );
  }

  /**
   * Revisao da AG4 (achados 1 e 9): a consulta em foco relida AGORA, pela
   * mesma leitura e a mesma conferencia da lista (a situacao, o prazo, a
   * remarcacao pendente). Nulo: nao esta mais entre as consultas futuras do
   * contato (passou, foi cancelada ou recusada). Lanca na leitura que falha
   * e sem a porta.
   */
  async function relerAConsulta(id: string): Promise<ConsultaDoContato | null> {
    if (porta === null || porta.lerConsultasDoContato === undefined) {
      throw new Error("sem porta");
    }
    const lida = await porta.lerConsultasDoContato(id);
    return lida.consultas.find((c) => c.id === id) ?? null;
  }

  /**
   * Revisao da AG4 (achado 1): a pergunta do cancelamento de novo (T1),
   * depois de o preparo desfazer o pedido (vencido, ou outra mensagem no
   * meio). A consulta e relida e conferida agora; a recusa vai como na
   * primeira pergunta.
   */
  async function perguntarDeNovo(
    id: string,
    porque: MotivoDoPedidoDesfeito,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    let consulta: ConsultaDoContato | null;
    try {
      consulta = await relerAConsulta(id);
    } catch {
      return {
        tipo: "falha",
        passo: "Não foi possível ler a consulta do pedido de cancelamento.",
      };
    }
    const lidaAntes = foco ?? focoInativo;
    const descricao =
      consulta !== null
        ? descricaoDaConsulta(consulta)
        : lidaAntes !== null
          ? descricaoDaConsulta(lidaAntes)
          : null;
    const motivo = conferirConsultaDaIa({
      consulta,
      acao: "cancelar",
      prazoHoras: prazoDe("cancelar"),
      agoraMs: relogio(),
      catalogo,
    });
    if (motivo !== null || consulta === null) {
      return recusaDaConferencia(
        motivo ?? "consulta_nao_encontrada",
        "cancelar",
        descricao,
      );
    }
    foco = focoDaConsulta(consulta);
    pedidoDaNota = { acao: "cancelar", consulta: foco };
    perguntaArmada = "cancelar";
    if (DESFEITO_QUE_E_FALHA.has(porque)) {
      // Conta uma falha: a pergunta que nunca confere (o texto gravado nao
      // bate) passa para a equipe na segunda vez, em vez de repetir sem fim.
      // Revisao curta das correcoes da AG4 (achado 2): mesmo com outra
      // ferramenta que avanca no mesmo turno (a lista de novo).
      resultados.push("resposta_fora_da_pergunta");
    }
    resultados.push("pergunta_do_cancelamento");
    const quando = diaEHora(new Date(consulta.inicio), fuso, agoraMs);
    return frase(
      perguntaDoCancelamento(quando),
      { consulta: quando },
      `${PASSO_DO_PEDIDO_DESFEITO[porque]}: perguntou de novo se a pessoa confirma o cancelamento da consulta de ${descricaoDaConsulta(consulta)}`,
      "pergunta_do_cancelamento",
      {
        consultaLida: true,
        consultasComHorario: [consultaComoFato(consulta, { marcada: false })],
      },
    );
  }

  async function pedirCancelamento(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    estado.intencao = "cancelar";
    const lido = entradaDoPedidoDeCancelamentoSchema.safeParse(argumentos);
    if (!lido.success) {
      resultados.push("entrada_invalida");
      return saida(
        "entrada_invalida",
        {},
        "Tentou pedir o cancelamento com um pedido incompleto",
      );
    }
    if (chamouPedidoDeCancelamento || chamouCancelamento) {
      resultados.push("um_cancelamento_por_resposta");
      return saida(
        "um_cancelamento_por_resposta",
        {},
        "Pediu um segundo cancelamento na mesma resposta: recusado",
      );
    }
    chamouPedidoDeCancelamento = true;
    const achada = await consultaDoCodigo(
      lido.data.consulta,
      "Tentou cancelar uma consulta que a lista desta resposta não trouxe",
    );
    if (!("id" in achada)) {
      return achada;
    }
    const consulta = achada;
    const descricao = descricaoDaConsulta(consulta);
    pedidoDaNota = { acao: "cancelar", consulta: focoDaConsulta(consulta) };
    const motivo = conferirConsultaDaIa({
      consulta,
      acao: "cancelar",
      prazoHoras: prazoDe("cancelar"),
      agoraMs: relogio(),
      catalogo,
    });
    if (motivo !== null) {
      return recusaDaConferencia(motivo, "cancelar", descricao);
    }
    // A pergunta fixa (T1); o fechamento arma o pedido.
    foco = focoDaConsulta(consulta);
    perguntaArmada = "cancelar";
    resultados.push("pergunta_do_cancelamento");
    const quando = diaEHora(new Date(consulta.inicio), fuso, agoraMs);
    return frase(
      perguntaDoCancelamento(quando),
      { consulta: quando },
      `Perguntou se a pessoa confirma o cancelamento da consulta de ${descricao}`,
      "pergunta_do_cancelamento",
      {
        consultaLida: true,
        consultasComHorario: [consultaComoFato(consulta, { marcada: false })],
      },
    );
  }

  async function cancelarConsulta(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    estado.intencao = "cancelar";
    if (!entradaDoCancelamentoSchema.safeParse(argumentos ?? {}).success) {
      resultados.push("entrada_invalida");
      return saida(
        "entrada_invalida",
        {},
        "Tentou cancelar a consulta com um pedido fora do formato",
      );
    }
    if (chamouCancelamento || chamouPedidoDeCancelamento) {
      resultados.push("um_cancelamento_por_resposta");
      return saida(
        "um_cancelamento_por_resposta",
        {},
        "Pediu um segundo cancelamento na mesma resposta: recusado",
      );
    }
    // Revisao curta das correcoes da AG4 (achado 7): a consulta do pedido ja
    // nao esta de pe (o preparo a leu cancelada, passada ou recusada). Pode
    // ser a retomada do MESMO job que a cancelou e caiu antes de gravar o
    // turno: com o "sim" claro (o mesmo da primeira vez), a RPC decide
    // (idempotente pelo job, devolve reutilizado e o sistema responde com a
    // T2). Outro cancelamento: consulta_encerrada, e nada muda (a RPC nunca
    // cancela consulta que nao esta de pe). Sem o "sim" claro, nem a RPC:
    // consulta_encerrada ao modelo.
    if (
      modoInicial === "cancelar" &&
      foco === null &&
      focoInativo !== null &&
      focoInicialId !== null &&
      estado.pedido_pendente === "cancelar" &&
      estado.appointment_id === focoInicialId
    ) {
      chamouCancelamento = true;
      pedidoDaNota = { acao: "cancelar", consulta: focoInativo };
      const respostaDaPessoa = interpretarRespostaAoCancelamento(
        (entrada.mensagens?.pendentes ?? []).map((m) => m.original),
      );
      if (respostaDaPessoa !== "sim") {
        return (
          recusaDoPedido(
            "consulta_encerrada",
            "cancelar",
            `Não cancelou a consulta de ${descricaoDaConsulta(focoInativo)}`,
          ) ?? { tipo: "falha", passo: "A consulta do pedido não está mais marcada." }
        );
      }
      return cancelarPelaRpc(focoInativo, true);
    }
    // Revisao da AG4 (achado 1): o pedido com que o turno comecou foi
    // desfeito no preparo (a pergunta venceu, ou outra mensagem da clinica
    // saiu entre ela e a resposta da pessoa: o "sim" pode ser de outra
    // pergunta). Nada e cancelado: o SISTEMA pergunta de novo (T1), com a
    // consulta relida e conferida agora. Revisao curta das correcoes da AG4
    // (achado 6): a pergunta logo antes e a do cancelamento da MESMA
    // consulta com outro horario (a recepcao a mudou depois da pergunta):
    // consulta_mudou, sem falha e sem a trilha de outra mensagem; a pergunta
    // de novo, com o horario de agora, re-arma a ancora (contrato da frente
    // de banco, R8: o consulta_mudou do banco conta do job da pergunta, e o
    // deste turno e de depois da mudanca).
    if (
      modoInicial === "cancelar" &&
      pedidoDesfeito !== null &&
      focoInicialId !== null
    ) {
      chamouCancelamento = true;
      return perguntarDeNovo(focoInicialId, pedidoDesfeito);
    }
    // So com a pergunta feita num turno ANTERIOR (o pedido armado no comeco
    // deste), ainda de pe e, revisao da AG4 (achado 1), conferida no preparo
    // (a mensagem da IA logo antes da resposta da pessoa; sem o preparo,
    // falha fechada).
    if (
      modoInicial !== "cancelar" ||
      etapaInicial !== "cancelar" ||
      focoInicialId === null ||
      estado.pedido_pendente !== "cancelar" ||
      estado.appointment_id !== focoInicialId ||
      !perguntaDoCancelamentoConferida
    ) {
      resultados.push("sem_pergunta_de_cancelamento");
      return saida(
        "sem_pergunta_de_cancelamento",
        {},
        "Tentou cancelar sem a pergunta de cancelamento feita numa mensagem anterior",
      );
    }
    chamouCancelamento = true;
    const descricao =
      foco === null ? "do pedido" : `de ${descricaoDaConsulta(foco)}`;
    if (foco !== null) {
      pedidoDaNota = { acao: "cancelar", consulta: foco };
    }
    // D-30: o "sim" numa lista fechada, nas mensagens da pessoa depois da
    // pergunta (o texto original, que nao sai daqui).
    const resposta = interpretarRespostaAoCancelamento(
      (entrada.mensagens?.pendentes ?? []).map((m) => m.original),
    );
    if (resposta === "nao") {
      resultados.push("paciente_nao_confirmou");
      desarmarPedido();
      return saida(
        "paciente_nao_confirmou",
        {},
        `A pessoa não confirmou o cancelamento da consulta ${descricao}: nada foi cancelado`,
      );
    }
    if (resposta === "nao_reconhecida") {
      if (foco === null) {
        return {
          tipo: "falha",
          passo: "Não foi possível ler a consulta do pedido de cancelamento.",
        };
      }
      // Nao e um sim claro: a pergunta fixa volta e conta uma falha.
      perguntaArmada = "cancelar";
      resultados.push("sem_confirmacao_clara");
      const quando = diaEHora(new Date(foco.inicio), fuso, agoraMs);
      return frase(
        perguntaDoCancelamento(quando),
        { consulta: quando },
        `A resposta não foi um sim claro: perguntou de novo se a pessoa confirma o cancelamento da consulta ${descricao}`,
        "sem_confirmacao_clara",
        {
          consultaLida: true,
          consultasComHorario: [consultaComoFato(foco, { marcada: false })],
        },
      );
    }
    return cancelarPelaRpc(foco, false);
  }

  /**
   * cancelar_consulta_pela_ia para a consulta do pedido (focoInicialId) e a
   * resposta ao modelo ou a frase fixa. `alvo`: a consulta como o preparo a
   * leu (a de pe, ou, com `inativa`, a que nao esta mais de pe, revisao
   * curta das correcoes da AG4, achado 7).
   */
  async function cancelarPelaRpc(
    alvo: ConsultaEmFoco | null,
    inativa: boolean,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    const descricao =
      alvo === null ? "do pedido" : `de ${descricaoDaConsulta(alvo)}`;
    if (focoInicialId === null) {
      return { tipo: "falha", passo: "Não havia consulta no pedido de cancelamento." };
    }
    let r: RespostaDoCancelamento;
    try {
      if (porta === null || porta.cancelarConsulta === undefined) {
        throw new Error("sem porta");
      }
      r = await porta.cancelarConsulta(focoInicialId);
    } catch {
      return {
        tipo: "falha",
        passo: "Não foi possível cancelar a consulta agora.",
      };
    }
    if (!r.ok) {
      if (r.motivo === "ia_desligada") {
        resultados.push(r.motivo);
        return {
          tipo: "liberacao_suspensa",
          passo: `Tentou cancelar a consulta: ${ROTULO_DO_MOTIVO_DA_AGENDA.ia_desligada}`,
        };
      }
      if (r.motivo === "mensagem_nova_do_paciente") {
        // Revisao curta das correcoes da AG4 (achado 1): a pessoa escreveu
        // de novo depois das mensagens que o job leu (o "sim" pode ter virado
        // "espera, nao"). Nada foi cancelado: o turno para sem enviar nada,
        // sem falha e sem perguntar de novo; o estado fica como no comeco
        // (o pedido armado) e o proximo turno le a mensagem nova.
        resultados.push(r.motivo);
        mensagemNova = true;
        return {
          tipo: "mensagem_nova",
          passo: `Não cancelou a consulta ${descricao}: ${ROTULO_DO_MOTIVO_DA_AGENDA.mensagem_nova_do_paciente}. Nada foi enviado; a próxima resposta lê a mensagem nova.`,
        };
      }
      // Revisao da AG4 (achado 1; contrato-mudancas R1, R2 e R4): o banco
      // nao cancelou porque a pergunta venceu (pedido_vencido, 60 minutos)
      // ou porque outra mensagem saiu entre ela e a resposta da pessoa
      // (sem_confirmacao_do_paciente, a ancora forte). "Pergunte de novo": o
      // SISTEMA repete a pergunta (T1), que re-arma o pedido (o gravar
      // carimba o instante novo). sem_confirmacao_do_paciente conta como
      // falha (na segunda seguida, a equipe; revisao curta das correcoes,
      // achado 2: mesmo com outra ferramenta que avanca no turno);
      // pedido_vencido nao. A consulta que nao esta mais de pe nunca e
      // perguntada de novo (falha fechada: nem chega a esses motivos).
      if (
        (r.motivo === "pedido_vencido" ||
          r.motivo === "sem_confirmacao_do_paciente") &&
        alvo !== null &&
        !inativa
      ) {
        resultados.push(r.motivo);
        if (r.motivo === "sem_confirmacao_do_paciente") {
          resultados.push("resposta_fora_da_pergunta");
        }
        perguntaArmada = "cancelar";
        const quando = diaEHora(new Date(alvo.inicio), fuso, agoraMs);
        return frase(
          perguntaDoCancelamento(quando),
          { consulta: quando },
          `Não cancelou a consulta ${descricao}: ${ROTULO_DO_MOTIVO_DA_AGENDA[r.motivo]}; perguntou de novo se a pessoa confirma o cancelamento`,
          r.motivo,
          {
            consultaLida: true,
            consultasComHorario: [consultaComoFato(alvo, { marcada: false })],
          },
        );
      }
      const recusa = recusaDoPedido(
        r.motivo,
        "cancelar",
        `Não cancelou a consulta ${descricao}`,
      );
      if (recusa !== null) {
        return recusa;
      }
      resultados.push(r.motivo);
      return {
        tipo: "falha",
        passo: `Não cancelou a consulta ${descricao}: ${ROTULO_DO_MOTIVO_DA_AGENDA[r.motivo]}.`,
      };
    }
    const inicio = r.inicio ?? alvo?.inicio ?? null;
    if (inicio === null) {
      return {
        tipo: "falha",
        passo: "A consulta foi cancelada, mas não foi possível ler o dia e a hora dela.",
      };
    }
    canceladaNoTurno = focoInicialId;
    resultados.push("cancelada");
    estado.pedido_pendente = null;
    estado.pedido_pendente_em = null;
    // Revisao da AG4 (achado 7): o estado guarda a consulta cancelada (com o
    // desfecho), para o turno seguinte reler e o fato "foi cancelada" valer
    // so com o par dela (ehEstadoDoCancelamento).
    estado.appointment_id = focoInicialId;
    estado.etapa = "informacao";
    estado.desfecho = "cancelou";
    const quando = diaEHora(new Date(inicio), fuso, agoraMs);
    const unidade = nomeDaUnidade(alvo?.unidadeId);
    return frase(
      respostaDoCancelamento(quando),
      { ...quando },
      porta.simulada
        ? `Cancelaria a consulta ${descricao}, a pedido da pessoa. ${SIMULADO}`
        : r.reutilizado
          ? `Cancelou a consulta ${descricao}, a pedido da pessoa (a mesma resposta retomada: o cancelamento já estava feito)`
          : `Cancelou a consulta ${descricao}, a pedido da pessoa`,
      "cancelada",
      {
        acao: "cancelou",
        horarioDaAcao: {
          ...quando,
          unidade,
          profissional: nomeDoProfissional(alvo?.profissionalId),
        },
      },
    );
  }

  /** O que a busca da remarcacao devolve ao modelo (so dia, hora e unidade). */
  function saidaDaRemarcacao(
    saidaDaBusca: string,
    consulta: { dia: string; hora: string },
  ): string {
    let lido: Record<string, unknown>;
    try {
      lido = JSON.parse(saidaDaBusca) as Record<string, unknown>;
    } catch {
      lido = { resultado: "entrada_invalida" };
    }
    const variasUnidades = (catalogo.unidades ?? []).length > 1;
    const horariosLidos = Array.isArray(lido.horarios) ? lido.horarios : null;
    const corpo: Record<string, unknown> = {
      resultado: lido.resultado,
      mesmo_profissional: true,
      consulta,
      ...(typeof lido.hora_pedida === "string"
        ? { hora_pedida: lido.hora_pedida }
        : {}),
      ...(typeof lido.dia_pedido === "string"
        ? { dia_pedido: lido.dia_pedido }
        : {}),
      ...(typeof lido.ate === "string" ? { ate: lido.ate } : {}),
      ...(variasUnidades && typeof lido.unidade === "string"
        ? { unidade: lido.unidade }
        : {}),
    };
    if (horariosLidos !== null) {
      corpo.horarios = horariosLidos.map((h) => {
        const item = (h ?? {}) as Record<string, unknown>;
        return {
          codigo: item.codigo,
          dia: item.dia,
          hora: item.hora,
          ...(variasUnidades && typeof item.unidade === "string"
            ? {
                unidade: item.unidade,
                ...(typeof item.unidade_codigo === "string"
                  ? { unidade_codigo: item.unidade_codigo }
                  : {}),
              }
            : {}),
        };
      });
    }
    return JSON.stringify(corpo);
  }

  async function buscarParaRemarcar(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    estado.intencao = "remarcar";
    const lido = entradaDaBuscaParaRemarcarSchema.safeParse(argumentos);
    if (!lido.success) {
      resultados.push("entrada_invalida");
      return saida(
        "entrada_invalida",
        {},
        "Tentou buscar horário para remarcar com um pedido incompleto",
      );
    }
    const pedido = lido.data;
    // A consulta: pelo codigo (o primeiro uso; confere) ou o foco do estado.
    let consulta: ConsultaEmFoco;
    if (pedido.consulta !== null && pedido.consulta.trim() !== "") {
      const achada = await consultaDoCodigo(
        pedido.consulta,
        "Tentou remarcar uma consulta que a lista desta resposta não trouxe",
      );
      if (!("id" in achada)) {
        return achada;
      }
      pedidoDaNota = { acao: "remarcar", consulta: focoDaConsulta(achada) };
      const motivo = conferirConsultaDaIa({
        consulta: achada,
        acao: "remarcar",
        prazoHoras: prazoDe("remarcar"),
        agoraMs: relogio(),
        catalogo,
      });
      if (motivo !== null) {
        return recusaDaConferencia(
          motivo,
          "remarcar",
          descricaoDaConsulta(achada),
        );
      }
      consulta = focoDaConsulta(achada);
    } else if (
      estado.pedido_pendente === "remarcar" &&
      estado.appointment_id !== null &&
      foco !== null &&
      foco.id === estado.appointment_id
    ) {
      // Revisao da AG4 (achado 9): a consulta em foco relida e conferida
      // AGORA, como pelo codigo (o prazo pode ter passado entre as mensagens,
      // e outra conversa pode ter pedido a remarcacao dela), antes de
      // oferecer horario.
      const focoId: string = foco.id;
      let relida: ConsultaDoContato | null;
      try {
        relida = await relerAConsulta(focoId);
      } catch {
        return {
          tipo: "falha",
          passo: "Não foi possível ler a consulta que está sendo remarcada.",
        };
      }
      const descricaoDoFoco =
        relida === null ? descricaoDaConsulta(foco) : descricaoDaConsulta(relida);
      pedidoDaNota = {
        acao: "remarcar",
        consulta: relida === null ? foco : focoDaConsulta(relida),
      };
      const motivo = conferirConsultaDaIa({
        consulta: relida,
        acao: "remarcar",
        prazoHoras: prazoDe("remarcar"),
        agoraMs: relogio(),
        catalogo,
      });
      if (motivo !== null || relida === null) {
        const recusada = motivo ?? "consulta_nao_encontrada";
        if (
          recusada === "consulta_nao_encontrada" ||
          recusada === "consulta_encerrada"
        ) {
          // A consulta nao esta mais de pe: o pedido sai (o modelo le de
          // novo, como na recusa do banco).
          desarmarPedido();
        }
        return recusaDaConferencia(recusada, "remarcar", descricaoDoFoco);
      }
      consulta = focoDaConsulta(relida);
    } else {
      resultados.push("sem_consulta_para_remarcar");
      return saida(
        "sem_consulta_para_remarcar",
        {},
        "Tentou buscar horário para remarcar sem dizer qual consulta",
      );
    }
    pedidoDaNota = { acao: "remarcar", consulta };
    // O foco do estado: a consulta que esta sendo remarcada.
    if (
      estado.pedido_pendente !== "remarcar" ||
      estado.appointment_id !== consulta.id
    ) {
      estado.pedido_pendente = "remarcar";
      estado.pedido_pendente_em = agoraEmUtc();
      estado.appointment_id = consulta.id;
      // Os horarios de outro pedido saem (o codigo da remarcacao e novo).
      estado.horarios_oferecidos = [];
      horarios.clear();
      situacoes.clear();
      if (estado.etapa !== "aguardando_confirmacao") {
        estado.etapa = "remarcar";
      }
    }
    if (estado.etapa === "informacao" || estado.etapa === "escolha" || estado.etapa === "cancelar" || estado.etapa === "pos_marcacao") {
      estado.etapa = "remarcar";
    }
    foco = consulta;
    const quando = diaEHora(new Date(consulta.inicio), fuso, agoraMs);
    const descricao = descricaoDaConsulta(consulta);
    // O procedimento, o profissional e o pagamento da consulta (D-26),
    // fixados no servidor.
    const vinculo = vinculoDe(consulta.serviceLinkId);
    const procedimento =
      vinculo === undefined
        ? undefined
        : catalogo.procedimentos.find((p) => p.id === vinculo.procedimentoId);
    const profissional =
      vinculo === undefined
        ? undefined
        : indiceDosProfissionais(catalogo).find(
            (p) => p.id === vinculo.profissionalId,
          );
    const convenio =
      vinculo === undefined || vinculo.convenioId === null
        ? null
        : (convenioDe(vinculo.convenioId) ?? undefined);
    if (
      vinculo === undefined ||
      procedimento === undefined ||
      profissional === undefined ||
      convenio === undefined
    ) {
      return (
        recusaDoPedido(
          "so_com_a_equipe",
          "remarcar",
          `Não buscou horário para remarcar a consulta de ${descricao}`,
        ) ?? { tipo: "falha", passo: "Não foi possível buscar horário agora." }
      );
    }
    const plano = planejarBuscaDeHorario({
      catalogo,
      agenda: entrada.config.agenda,
      argumentos: {
        procedimento: procedimento.codigo,
        profissional: profissional.codigo,
        convenio: null,
        a_partir_de: pedido.a_partir_de,
        periodo: pedido.periodo,
        unidade: pedido.unidade,
        hora: pedido.hora,
      },
      agoraMs,
      fuso,
      // Sem valor na remarcacao: o pagamento e o da consulta.
      informarValor: false,
      nascimentos: entrada.nascimentos ?? [],
      convenioFixo: convenio,
    });
    const fatoDaConsulta = consultaComoFato(consulta, { marcada: false });
    const comAConsulta = (r: {
      resultado: string;
      saida: string;
      passo: string;
      fatos?: FatosDaFerramenta;
    }): ResultadoDaFerramentaDeAgenda => {
      const fatos: FatosDaFerramenta = {
        // Sem convenio (o modelo nao le o pagamento da consulta) e com a
        // consulta lida.
        ...(r.fatos?.horarios === undefined ? {} : { horarios: r.fatos.horarios }),
        ...(r.fatos?.ecos === undefined ? {} : { ecos: r.fatos.ecos }),
        ...(r.fatos?.saidaSemEco === undefined
          ? {}
          : { saidaSemEco: saidaDaRemarcacao(r.fatos.saidaSemEco, quando) }),
        consultaLida: true,
        consultasComHorario: [fatoDaConsulta],
      };
      return {
        tipo: "saida",
        saida: saidaDaRemarcacao(r.saida, quando),
        passo: `Remarcação da consulta de ${descricao}: ${r.passo}`,
        precos: [],
        resultado: r.resultado,
        fatos,
      };
    };
    if (plano.tipo === "resultado") {
      resultados.push(plano.resultado.resultado);
      return comAConsulta(plano.resultado);
    }
    ultimaPreferencia = {
      periodo: plano.plano.periodo,
      hora: plano.plano.hora ?? null,
    };
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
      if (estado.etapa !== "aguardando_confirmacao") {
        estado.etapa = "oferta";
      }
    }
    return comAConsulta(r);
  }

  /**
   * O agendar da remarcacao deu certo: a consulta nova nasce pendente,
   * ligada a antiga, que continua marcada ate a aprovacao (D-10). O SISTEMA
   * responde (T4).
   */
  function remarcou(
    resposta: Extract<RespostaDoAgendar, { ok: true }>,
    antigaId: string,
  ): ResultadoDaFerramentaDeAgenda {
    resultados.push("remarcado");
    const reservaAntes = reserva;
    reserva = null;
    estado.appointment_id = resposta.appointmentId;
    estado.slot_hold_id = null;
    estado.horarios_oferecidos = [];
    estado.etapa = "pos_marcacao";
    estado.intencao = "remarcar";
    estado.pedido_pendente = null;
    estado.pedido_pendente_em = null;
    estado.desfecho = "remarcou";
    const inicioNovo = resposta.inicio ?? reservaAntes?.leitura?.inicio ?? null;
    const inicioAntigo =
      resposta.inicioDaAntiga ??
      (foco !== null && foco.id === antigaId ? foco.inicio : null);
    if (inicioNovo === null || inicioAntigo === null) {
      return {
        tipo: "falha",
        passo: "A remarcação foi pedida, mas não foi possível ler o dia e a hora das consultas.",
      };
    }
    const serviceLinkId =
      resposta.serviceLinkId ?? reservaAntes?.leitura?.serviceLinkId ?? null;
    const nomes = nomesDoVinculo(serviceLinkId);
    const unidadeId = reservaAntes?.leitura?.unidadeId ?? null;
    const nova = diaEHora(new Date(inicioNovo), fuso, agoraMs);
    const antiga = diaEHora(new Date(inicioAntigo), fuso, agoraMs);
    const fatoDaNova: HorarioDoFato = {
      ...nova,
      unidade: nomeDaUnidade(unidadeId),
      profissional: nomes?.profissional ?? null,
    };
    const fatoDaAntiga: ConsultaDoFato = consultaComoFato(
      {
        inicio: inicioAntigo,
        unidadeId: foco?.id === antigaId ? foco.unidadeId : null,
        profissionalId: foco?.id === antigaId ? foco.profissionalId : null,
      },
      { marcada: false },
    );
    remarcacaoNoTurno = { antiga: fatoDaAntiga, nova: fatoDaNova };
    const texto = `de ${antiga.dia} às ${antiga.hora} para ${nova.dia} às ${nova.hora}${entreParenteses(nomes)}`;
    return frase(
      respostaDaRemarcacao({ antiga, nova }),
      { pendente: true, ...nova, consulta: antiga },
      porta?.simulada
        ? `Pediria a remarcação ${texto}, pendente de aprovação da equipe; a consulta antiga continuaria marcada. ${SIMULADO}`
        : `Pediu a remarcação ${texto}, pendente de aprovação da equipe; a consulta antiga continua marcada`,
      "remarcado",
      {
        acao: "remarcou",
        horarioDaAcao: fatoDaNova,
        horarioAnterior: {
          dia: fatoDaAntiga.dia,
          hora: fatoDaAntiga.hora,
          unidade: fatoDaAntiga.unidade,
          profissional: fatoDaAntiga.profissional ?? null,
        },
        consultaLida: true,
        consultasComHorario: [fatoDaAntiga],
      },
    );
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
      estado.falhas_seguidas === 0 &&
      estado.pedido_pendente === null;
    if (nada) {
      return null;
    }
    // AG4 (D-13): na remarcacao, a consulta que a pessoa ja tem vai ao
    // modelo so com o dia e a hora. O procedimento, o profissional e o
    // pagamento dela (e dos horarios da remarcacao, que sao os mesmos) ficam
    // no servidor.
    if (modoInicial === "cancelar" || modoInicial === "remarcar" || modoInicial === "remarcou") {
      return paraOModeloNaConsulta();
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
      // Revisao da AG4 (achado 7): a consulta que a IA cancelou nesta
      // conversa, relida e ainda cancelada (so o dia e a hora, D-13).
      ...(canceladaLida === null
        ? {}
        : { cancelada: { dia: canceladaLida.dia, hora: canceladaLida.hora } }),
    };
  }

  /**
   * AG4: o bloco do estado no pedido de cancelar ou remarcar e depois da
   * remarcacao: o pedido com o dia e a hora da consulta em foco, os horarios
   * e a reserva da remarcacao so com o dia, a hora e a unidade (D-13).
   */
  function paraOModeloNaConsulta(): AtendimentoParaOModelo {
    const r = reservaLegivel();
    const variasUnidades = (catalogo.unidades ?? []).length > 1;
    const daUnidade = (nome: string | null) => (variasUnidades ? nome : null);
    // Revisao curta das correcoes da AG4 (achado 7): a consulta do pedido
    // de cancelar que nao esta mais de pe vai ao bloco com o dia e a hora da
    // pergunta (a retomada do job chama cancelar_consulta de novo e a RPC
    // decide); nunca vira fato de consulta marcada.
    const doPedido =
      foco ?? (modoInicial === "cancelar" ? focoInativo : null);
    const focoLegivel =
      doPedido === null
        ? null
        : diaEHora(new Date(doPedido.inicio), fuso, agoraMs);
    return {
      etapa: estado.etapa,
      procedimento: null,
      profissional: null,
      pagamento: null,
      unidade: null,
      horarios: [...horarios.values()]
        .filter((h) =>
          estado.horarios_oferecidos.some((e) => e.codigo === h.codigo),
        )
        .map((h) => ({
          dia: h.dia,
          hora: h.hora,
          profissional: null,
          unidade: daUnidade(h.unidade),
          codigo: h.codigo,
          procedimento: "",
          unidadeCodigo: variasUnidades ? h.unidadeCodigo : null,
          situacao: situacaoDe(h.codigo),
        })),
      reserva:
        r === null
          ? null
          : {
              dia: r.dia,
              hora: r.hora,
              profissional: null,
              unidade: daUnidade(r.unidade),
              codigo: r.codigo,
              procedimento: "",
              situacao: r.perdida
                ? "perdida"
                : r.viva === true
                  ? "viva"
                  : r.viva === false
                    ? "vencida"
                    : "nao_conferida",
            },
      informados: [],
      faltam: [],
      paraOTitular: null,
      consulta: null,
      falhasSeguidas: estado.falhas_seguidas,
      pedidoDaConsulta:
        modoInicial === "cancelar" || modoInicial === "remarcar"
          ? {
              acao: modoInicial,
              dia: focoLegivel?.dia ?? null,
              hora: focoLegivel?.hora ?? null,
              // Revisao da AG4 (achado 1): a pergunta do cancelamento nao
              // vale mais (venceu, ou outra mensagem saiu depois dela).
              ...(pedidoDesfeito === null ? {} : { desfeito: true }),
              // Revisao curta das correcoes da AG4 (achado 6): a consulta
              // mudou de horario depois da pergunta.
              ...(pedidoDesfeito === "consulta_mudou" ? { mudou: true } : {}),
            }
          : null,
      remarcacao:
        modoInicial === "remarcou" && remarcacaoLida !== null
          ? {
              de:
                remarcacaoLida.antiga === null
                  ? null
                  : {
                      dia: remarcacaoLida.antiga.dia,
                      hora: remarcacaoLida.antiga.hora,
                    },
              para: {
                dia: remarcacaoLida.nova.dia,
                hora: remarcacaoLida.nova.hora,
              },
              pendente: remarcacaoLida.pendente,
            }
          : null,
    };
  }

  /**
   * AG4: as consultas do estado como fato do turno: a consulta em foco do
   * pedido (nunca "marcada nesta conversa"; a cancelada neste turno sai) e,
   * depois de remarcar, a nova (remarcada nesta conversa enquanto pendente) e
   * a antiga.
   */
  function consultasDoEstadoComoFato(): {
    fatos: ConsultaDoFato[];
    canceladas: HorarioDoFato[];
    saida: Record<string, unknown>;
  } {
    const fatos: ConsultaDoFato[] = [];
    const canceladas: HorarioDoFato[] = [];
    const saida: Record<string, unknown> = {};
    // Revisao da AG4 (achado 7): a consulta que a IA cancelou nesta conversa
    // (num turno anterior), relida e ainda cancelada. Nunca e consulta lida
    // (nao esta marcada): so o fato do cancelamento, com o par dela.
    if (modoInicial === "cancelou" && canceladaLida !== null) {
      canceladas.push(canceladaLida);
      saida.consulta_cancelada = {
        dia: canceladaLida.dia,
        hora: canceladaLida.hora,
      };
    }
    if (
      (modoInicial === "cancelar" || modoInicial === "remarcar") &&
      foco !== null &&
      foco.id === focoInicialId &&
      canceladaNoTurno !== foco.id
    ) {
      const fato = consultaComoFato(foco, { marcada: false });
      fatos.push(fato);
      saida.consulta_em_foco = { dia: fato.dia, hora: fato.hora };
    }
    if (modoInicial === "remarcou" && remarcacaoLida !== null) {
      fatos.push(remarcacaoLida.nova);
      saida.remarcacao_pedida = {
        dia: remarcacaoLida.nova.dia,
        hora: remarcacaoLida.nova.hora,
      };
      if (remarcacaoLida.antiga !== null) {
        fatos.push(remarcacaoLida.antiga);
        saida.consulta_antiga = {
          dia: remarcacaoLida.antiga.dia,
          hora: remarcacaoLida.antiga.hora,
        };
      }
    }
    return { fatos, canceladas, saida };
  }

  function fatosDoEstado(): SaidaParaOsFatos | null {
    if (!comEstado) {
      return null;
    }
    const doPedido = consultasDoEstadoComoFato();
    const oferecidos = [...horarios.values()].filter((h) =>
      estado.horarios_oferecidos.some((e) => e.codigo === h.codigo),
    );
    const r = reservaLegivel();
    if (
      oferecidos.length === 0 &&
      r === null &&
      consultaLida === null &&
      doPedido.fatos.length === 0 &&
      doPedido.canceladas.length === 0
    ) {
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
      // A consulta que a IA marcou nesta conversa, relida agora (AG4: com o
      // profissional, so nos fatos).
      ...(consultaLida === null
        ? {}
        : {
            consultaLida: true,
            consultaComHorario: {
              dia: consultaLida.dia,
              hora: consultaLida.hora,
              unidade: consultaLida.unidade,
              ...comOProfissional(consultaLida.profissional),
              marcadaNestaConversa: true,
            },
          }),
      // AG4: a consulta em foco do pedido e a remarcacao pedida, relidas.
      ...(doPedido.fatos.length === 0
        ? {}
        : { consultaLida: true, consultasComHorario: doPedido.fatos }),
      // Revisao da AG4 (achado 7): a cancelada nesta conversa (so o fato do
      // cancelamento, nunca consulta lida).
      ...(doPedido.canceladas.length === 0
        ? {}
        : { consultasCanceladas: doPedido.canceladas }),
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
        ...doPedido.saida,
      }),
      fatos,
    };
  }

  function falhasDepois(): number {
    // Revisao curta das correcoes da AG4 (achado 1): a mensagem nova da
    // pessoa nao e falha de ninguem (o turno nem respondeu).
    if (mensagemNova) {
      return estado.falhas_seguidas;
    }
    return falhasDepoisDoTurno(estado.falhas_seguidas, resultados);
  }

  function fechar(fim: {
    mensagemFinal: string | null;
    passou: boolean;
  }): FechamentoDoTurno {
    // Revisao curta das correcoes da AG4 (achado 1): a RPC disse
    // mensagem_nova_do_paciente e o turno parou sem enviar nada. O estado
    // fica como estava no COMECO (o pedido armado, a etapa, a reserva, o
    // contador): o proximo turno le a mensagem nova com a mesma pergunta de
    // pe (ela continua a ultima saida antes da resposta da pessoa).
    if (mensagemNova && comEstado) {
      const doComeco = entrada.atendimento!;
      return {
        estado: copiarEstado(doComeco.estado),
        dados: { ...doComeco.dados, faltam: [...doComeco.dados.faltam] },
      };
    }
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
      // Revisao curta (achados 2 e 8): pela mensagem inteira, sem palavra
      // distintiva de outro profissional ou unidade, e com "hoje" e
      // "amanha" conferidos contra o dia da reserva no fuso da clinica.
      const inicioDaReserva =
        reserva?.horario?.inicio ?? reserva?.leitura?.inicio ?? null;
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
          diaNaClinica:
            inicioDaReserva === null || !Number.isFinite(Date.parse(inicioDaReserva))
              ? null
              : hojeNoFuso(Date.parse(inicioDaReserva), fusoDaAgenda(fuso)),
          hojeNaClinica: hojeNoFuso(relogio(), fusoDaAgenda(fuso)),
        });
      // AG4: na remarcacao, a pergunta e a frase fixa (T3) e arma pelo
      // RESULTADO de reservar_horario, nunca pela expressao.
      const remarcando = final.pedido_pendente === "remarcar";
      if (remarcando) {
        if (!fim.passou && reservaViva && perguntaArmada === "remarcar") {
          final.etapa = "aguardando_confirmacao";
        } else if (final.horarios_oferecidos.length > 0 || reservaViva) {
          final.etapa = "oferta";
        } else {
          final.etapa = "remarcar";
        }
      } else if (
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
    // AG4: a pergunta do cancelamento (T1) arma o pedido pelo resultado de
    // pedir_cancelamento (ou de cancelar_consulta, que pergunta de novo) e
    // vale so para a resposta seguinte: em qualquer outro turno, desarma.
    if (perguntaArmada === "cancelar" && !fim.passou && foco !== null) {
      final.etapa = "cancelar";
      final.intencao = "cancelar";
      final.pedido_pendente = "cancelar";
      final.appointment_id = foco.id;
    } else if (final.pedido_pendente === "cancelar") {
      final.pedido_pendente = null;
      final.appointment_id = null;
      if (final.etapa === "cancelar") {
        final.etapa = "informacao";
      }
    }
    // Revisao curta das correcoes da AG4 (achado 4): o id da consulta que a
    // IA cancelou nesta conversa so fica no estado enquanto o estado e o do
    // cancelamento (ehEstadoDoCancelamento). Saiu dele (a pessoa quis marcar
    // outra, confirmou presenca, passou para a equipe): o id sai, e nenhum
    // turno seguinte le a cancelada como "a consulta marcada nesta conversa"
    // (a nota dizia "Consulta marcada pelo assistente nesta conversa").
    const idDaCanceladaNoEstado =
      canceladaNoTurno ?? (modoInicial === "cancelou" ? focoInicialId : null);
    if (
      idDaCanceladaNoEstado !== null &&
      final.appointment_id === idDaCanceladaNoEstado &&
      !ehEstadoDoCancelamento(final)
    ) {
      final.appointment_id = null;
    }
    // O instante do pedido: o banco carimba quando o pedido ou a consulta em
    // foco mudam (e ignora o que vai daqui); com os dois iguais, fica o de
    // antes. O estado so precisa de um instante valido junto do pedido.
    if (final.pedido_pendente === null) {
      final.pedido_pendente_em = null;
    } else if (
      final.pedido_pendente === pedidoInicial &&
      final.appointment_id === focoInicialId &&
      pedidoInicialEm !== null &&
      // Revisao da AG4 (contrato-mudancas R4): o instante de antes so fica
      // enquanto vale; vencido, o banco carimba agora.
      pedidoAindaVale(pedidoInicialEm, relogio())
    ) {
      final.pedido_pendente_em = pedidoInicialEm;
    } else if (final.pedido_pendente_em === null || final.pedido_pendente_em === pedidoInicialEm) {
      final.pedido_pendente_em = agoraEmUtc();
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
    // AG4: o pedido de cancelar ou remarcar (a consulta, com os nomes do
    // Cadastro) e a remarcacao pedida; "fora do prazo" com o numero do prazo.
    const doPedido =
      pedidoDaNota ??
      ((modoInicial === "cancelar" || modoInicial === "remarcar") &&
      foco !== null
        ? { acao: modoInicial, consulta: foco }
        : null);
    const pedidoDaConsulta =
      doPedido === null
        ? null
        : (() => {
            const quando = diaEHora(
              new Date(doPedido.consulta.inicio),
              fuso,
              agoraMs,
            );
            const nomes = nomesDoVinculo(doPedido.consulta.serviceLinkId);
            return {
              acao: doPedido.acao,
              dia: quando.dia,
              hora: quando.hora,
              procedimento: nomes?.procedimento ?? null,
              profissional:
                nomeDoProfissional(doPedido.consulta.profissionalId) ??
                nomes?.profissional ??
                null,
            };
          })();
    const remarcacao =
      remarcacaoNoTurno !== null
        ? {
            de: { dia: remarcacaoNoTurno.antiga.dia, hora: remarcacaoNoTurno.antiga.hora },
            para: { dia: remarcacaoNoTurno.nova.dia, hora: remarcacaoNoTurno.nova.hora },
          }
        : modoInicial === "remarcou" && remarcacaoLida !== null
          ? {
              de:
                remarcacaoLida.antiga === null
                  ? null
                  : { dia: remarcacaoLida.antiga.dia, hora: remarcacaoLida.antiga.hora },
              para: { dia: remarcacaoLida.nova.dia, hora: remarcacaoLida.nova.hora },
            }
          : null;
    const prazoDoPedido = doPedido === null ? null : prazoDe(doPedido.acao);
    const parouEm =
      resultados.at(-1) === "fora_do_prazo" && doPedido !== null
        ? `o pedido ficou dentro do prazo da clínica para o assistente ${verboDaAcao(doPedido.acao)}${prazoDoPedido === null ? "" : ` (${prazoDoPedido === 1 ? "1 hora" : `${prazoDoPedido} horas`})`}`
        : ultimo === undefined
          ? motivo
          : (PAROU_EM[ultimo] ?? motivo);
    // Revisao da AG4 (achado 7): o appointment_id do estado e a consulta
    // que o assistente cancelou nesta conversa (neste turno ou num
    // anterior), nunca a marcada: a nota diz a cancelada.
    const idDaCancelada =
      canceladaNoTurno ??
      (modoInicial === "cancelou" ? focoInicialId : null);
    const comACancelada =
      idDaCancelada !== null && estado.appointment_id === idDaCancelada;
    const canceladaNaNota: { dia: string; hora: string } | null = !comACancelada
      ? null
      : canceladaNoTurno !== null && foco !== null && foco.id === canceladaNoTurno
        ? diaEHora(new Date(foco.inicio), fuso, agoraMs)
        : canceladaLida === null
          ? null
          : { dia: canceladaLida.dia, hora: canceladaLida.hora };
    return notaDaPassagem({
      estado: comACancelada ? { ...estado, appointment_id: null } : estado,
      dados,
      cancelada: canceladaNaNota,
      procedimento: procedimento?.nome ?? null,
      profissional: profissional?.nome ?? null,
      pagamento,
      unidade: unidade?.nome ?? null,
      preferencia: ultimaPreferencia,
      reserva: r === null ? null : { ...r, viva: r.viva, perdida: r.perdida },
      oferecidos: [...horarios.values()]
        .filter((h) => estado.horarios_oferecidos.some((e) => e.codigo === h.codigo))
        .map(legivel),
      parouEm,
      pedidoDaConsulta,
      remarcacao,
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
        case "consultar_minhas_consultas":
          return consultarMinhasConsultas(argumentos);
        case "pedir_cancelamento":
          return pedirCancelamento(argumentos);
        case "cancelar_consulta":
          return cancelarConsulta(argumentos);
        case "buscar_horario_para_remarcar":
          return buscarParaRemarcar(argumentos);
      }
    },
    preparar,
    paraOModelo,
    fatosDoEstado,
    resultados: () => [...resultados],
    falhasDepois,
    fechar,
    nota,
    nomesValidados: () => [...nomesValidados],
  };
}
