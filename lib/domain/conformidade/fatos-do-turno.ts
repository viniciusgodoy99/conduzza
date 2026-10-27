// Fatos do turno: o que a camada deterministica do filtro de saida aceita
// como verdade numa resposta da IA (etapa AG2, 27/10/2026). PURO, zero I/O.
//
// A regra de ouro: fato critico so vale se uma ferramenta do turno disse. O
// preco ja era assim desde o E2 (precosDoTurno, filtro-deterministico.ts);
// aqui entram as quatro categorias novas, no mesmo molde (entrada opcional:
// quando quem chama passa os fatos, a regra vale; os textos estaticos
// conferidos na publicacao da Tela 6 nao passam fatos e nao mudam):
//  - horario_nao_verificado: toda data e toda hora do rascunho tem de estar
//    nas saidas das ferramentas do turno ou nos textos publicados que o
//    modelo recebe (base, instrucoes, nome da clinica, a hora na clinica) ou
//    que vao colados na resposta (saudacao, encerramento). A mensagem nova
//    do paciente tambem e fonte, mas SO numa frase que nega ou pergunta
//    ("15:00 nao tenho", "prefere as 15:00?"): repetir a hora do paciente
//    afirmando nao vale. Os formatos sao normalizados antes de comparar
//    ("14h", "14:00" e "as 2 da tarde" sao a mesma hora; "21/10",
//    "21/10/2026" e "21 de outubro", a mesma data). Revisao da AG2: a frase
//    que AFIRMA horario livre (tenho, temos, vaga, livre, pode ser, consigo,
//    da, disponivel) so passa com o horario livre que uma ferramenta de
//    agenda trouxe no turno (horariosLivres), conferido EM PAR (o dia com a
//    hora dele, nunca separados), e tambem a data sem hora ("tenho vaga dia
//    30", "amanha de manha tenho vaga"); o texto publicado e a mensagem do
//    paciente nunca provam horario livre.
//  - endereco_nao_verificado: logradouro com numero ("Av. Santos Dumont,
//    1500") so se veio de ferramenta do turno (consultar_unidades) ou dos
//    textos publicados. Nunca da mensagem do paciente. O endereco que veio
//    da ferramenta e nome de lugar: as vedacoes clinicas nao leem o trecho
//    do rascunho que bate com ele ("Rua das Dores, 100";
//    trechosDeEnderecoDasFerramentas e filtro-deterministico.ts).
//  - cobertura_nao_verificada: dizer que o convenio cobre, que e aceito ou
//    que a clinica atende por ele so com um resultado de cobertura do turno
//    (buscar_procedimento, buscar_horario, buscar_profissionais), do mesmo
//    convenio (e do plano, quando citado) e do mesmo procedimento, quando a
//    frase cita um; negar tambem so com fato ("sem informacao" nunca vira
//    "nao cobre"), a nao ser que o Cadastro nao tenha nenhum convenio ativo
//    (semConvenioAtivo). Revisao da AG2: depois de "aceita", "atende pelo",
//    "trabalha com" e "cobre", tudo o que nao for meio de pagamento
//    ("cartao", "pix", "dinheiro", "boleto") nem "particular" exige fato
//    (a operadora fora da lista e fora do Cadastro nunca tem fato). A base
//    publicada NAO vale aqui: so ferramenta.
//  - acao_nao_executada: dizer que marcou, reservou, confirmou, cancelou,
//    remarcou ou colocou na lista de espera so com o sucesso da ferramenta
//    correspondente neste turno, inclusive nas formas curtas ("Agendado!",
//    "Consulta cancelada", "Ta marcado", "Ja deixei agendado"). O estado de
//    uma consulta que ja existia ("sua consulta esta marcada para...") vale
//    com a consulta lida por ferramenta (confirmar_presenca) ou marcada
//    neste turno.
//
// Revisao 2 da AG2 (27/10/2026), a segunda rodada de achados:
//  - pergunta de verdade: a etiqueta de confirmacao do fim ("ok?", "certo?",
//    "tudo bem?", "combinado?", "ne?", "pode ser?") nao isenta nem legitima
//    a hora do paciente (ehPerguntaDeVerdade);
//  - negacao que rege o verbo: so as palavras da propria oferta entre a
//    palavra que nega e a oferta ("nao temos mais horario", "sem vaga");
//    "nao se preocupe que", "sem duvida" e "nao tem problema" nao negam;
//  - na pergunta de verdade, a oferta de procurar nao afirma ("quer que eu
//    veja se tem horario na quinta?");
//  - a palavra de disponibilidade sem dia nem hora ("temos vagas essa
//    semana") so com algum horario livre da ferramenta;
//  - o par de TODA frase com dia e hora: o dia e a hora juntos num trecho de
//    fonte (um objeto da ferramenta, uma linha do funcionamento, um horario
//    livre, uma frase publicada), nao so na oferta;
//  - acao: as formas que passavam ("ficou para quinta", "coloquei voce na
//    agenda", "consegui encaixar", "foi registrado", "foi para a lista de
//    espera", "tirei da agenda") e a regra ESTRUTURAL do fechamento: sem
//    acao de sucesso e sem consulta lida, a frase com dia ou hora e marca de
//    fechamento ("pronto", "combinado", "ficou para", "te esperamos",
//    "anotado", "confirmado"...) afirma acao (fechamentosDasFrases);
//  - convenio: a regra INVERTIDA (a frase afirmativa que cita convenio exige
//    o fato daquele convenio, com qualquer verbo), o procedimento citado em
//    "coberto", "cobertura" e "aceita" e o "seu plano" com o convenio que o
//    paciente citou;
//  - endereco: o bairro e a cidade que consultar_unidades traz em campos
//    proprios sao nome de lugar (duas palavras de nome, no minimo).
// E, fora deste arquivo, a SEGUNDA camada: o verificador por modelo recebe
// o resumo destes fatos, sem dado de paciente (resumo-dos-fatos.ts), e julga
// fato tambem.
//
// Revisao curta das correcoes da AG3 (27/10/2026), os achados da revisao
// das correcoes da revisao final:
//  - 3: o eco do pedido (e a hora do paciente) vale tambem na frase que diz
//    que o horario NAO esta livre sem a palavra que nega ("ja esta
//    ocupado", "esta indisponivel", "ja foi preenchido", "esta lotado", "a
//    agenda esta cheia", "ja tem paciente", "esse ja foi", "ja foi marcado
//    por outra pessoa") e no relato do pedido ("voce pediu quarta as 15h,
//    certo?"); nunca na que afirma horario livre, que agora tambem le "nao
//    esta ocupado", "vagou" e "tenho esse horario";
//  - 4: o par permitido depende do tipo da marca de fechamento: a marca
//    forte so com o par da consulta marcada, remarcada ou lida (a consulta
//    de quarta, relida do estado, nao libera "te esperamos terca" da reserva
//    nova de terca); a da reserva so com o par da reserva;
//  - 5: a frase da acao, do estado ou do fechamento que cita outro
//    profissional do Cadastro ou outra unidade barra (o profissional vem nos
//    fatos, lib/agente/fatos.ts, e nunca vai ao resumo do verificador);
//  - 6: as formas que passavam ("pode vir", "e so comparecer", "a Dra. Ana
//    te recebe", "voce sera atendida", "ja esta no seu nome", "tudo ok",
//    "confirmadissimo", "assegurada", "Sua consulta: ...", "separei",
//    "guardei", "bloqueei", "Reservei terca. Te esperamos!");
//  - 7: "Combinado!", "Feito!" e "Tudo certo!" sozinhos so dizem "certo": com
//    "Reservei quarta as 14h" e o par da reserva, passam;
//  - 14: "plano" seguido de verbo ("meu plano era ir hoje") nao e convenio.
//
// So BLOQUEIA, como toda regra deterministica: o rascunho que passa aqui
// ainda vai ao verificador por modelo (filtro.ts). As regras leem o rascunho
// SEM os textos fixos colados em volta dele (saudacao, aviso e encerramento:
// nao sao afirmacao do modelo e ja foram conferidos na publicacao), em
// visoes proprias: a base com a mascara do catalogo para data, hora e acao
// (sem as expressoes permitidas de padroes.ts, que trocam "garantida" por
// "reservada") e a base sem mascara para endereco e convenio (o nome do
// convenio precisa ser visto). A unica negacao lida e a da propria
// afirmacao de fato ("ainda nao marquei" nao afirma acao).

import type { CategoriaDosFatos } from "@/lib/domain/conformidade/categorias";
import {
  mascararNomes,
  normalizarBase,
} from "@/lib/domain/conformidade/normalizar";
import {
  CONVENIO_NO_OBJETO,
  FUNCAO_NO_OBJETO,
  LUGAR_OU_PRECO_COBERTO,
  MEIOS_DE_PAGAMENTO,
  NAO_E_CONVENIO,
  OBJETO_GENERICO_DE_COBRE,
  PARTICULAR,
  SUJEITO_QUE_NAO_E_CONVENIO,
} from "@/lib/domain/conformidade/palavras-do-convenio";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * O que uma ferramenta do turno disse de um convenio:
 *  - coberto: buscar_procedimento disse "coberto" para o convenio e plano;
 *  - atende: o convenio tem vinculo no procedimento (aceito), com ou sem
 *    valor (buscar_procedimento, buscar_horario), ou o profissional atende
 *    por ele (buscar_profissionais);
 *  - nao_atende: buscar_horario disse convenio_nao_atendido (nenhum vinculo
 *    do convenio no procedimento, nem so com a equipe).
 * "Sem informacao" nao vira estado nenhum.
 */
export const ESTADOS_DA_COBERTURA = [
  "coberto",
  "atende",
  "nao_atende",
] as const;
export type EstadoDaCobertura = (typeof ESTADOS_DA_COBERTURA)[number];

/** As acoes que uma ferramenta do turno pode ter executado com sucesso. */
export const ACOES_DO_TURNO = [
  "reservou",
  "marcou",
  "confirmou_presenca",
  "cancelou",
  "remarcou",
  "lista_de_espera",
] as const;
export type AcaoDoTurno = (typeof ACOES_DO_TURNO)[number];

/** Um convenio do Cadastro (o nome da operadora e o plano). */
export type ConvenioDosFatos = { nome: string; plano: string | null };

export type CoberturaDoTurno = ConvenioDosFatos & {
  estado: EstadoDaCobertura;
  /**
   * O procedimento do fato, com o nome do Cadastro que a ferramenta trouxe
   * (revisao da AG2: "a Unimed cobre o ultrassom" so com o fato da Unimed
   * para o ultrassom). Nulo: a ferramenta afirmou o convenio sem
   * procedimento (buscar_profissionais sem o filtro de procedimento), e o
   * fato nao sustenta frase que cita procedimento.
   */
  procedimento: string | null;
};

/**
 * Um horario livre que uma ferramenta de agenda trouxe no turno, com o dia
 * e a hora exatamente como ela devolveu ao modelo ("terca, 21/10" e
 * "14:00"). AG3 (27/10/2026): com a unidade do horario (o nome do Cadastro),
 * quando ele tem uma; ausente ou nula, sem unidade. O resumo dos fatos leva
 * a unidade ao verificador.
 */
export type HorarioLivreDoTurno = {
  dia: string;
  hora: string;
  unidade?: string | null;
};

/** Um dia do calendario (hoje no fuso da clinica). */
export type DiaDaClinica = { dia: number; mes: number; ano: number };

/**
 * Revisao final da AG3 (27/10/2026): o dia, a hora e a unidade de uma acao
 * de sucesso (reservou, marcou, remarcou) ou de uma consulta lida, no
 * formato exato que a ferramenta devolveu ao modelo ("quarta, 21/10" e
 * "14:00"; a unidade e o nome do Cadastro, nula sem unidade).
 */
export type HorarioDoFato = {
  dia: string;
  hora: string;
  unidade: string | null;
  /**
   * Revisao curta das correcoes da AG3 (achado 5): o nome do Cadastro do
   * profissional da acao ou da consulta lida ("Dra. Ana Lima"). Ausente ou
   * nulo: nao se sabe, e a regra do profissional nao le esta acao. Fica so
   * nas regras deterministicas: o resumo dos fatos nunca leva o profissional
   * ao verificador (minimizacao).
   */
  profissional?: string | null;
};

/**
 * Uma acao de sucesso com o horario dela. AG4: na remarcacao, `anterior` e o
 * horario da consulta antiga (que continua marcada ate a aprovacao); vai ao
 * resumo do verificador ("pediu a remarcacao para X; a consulta de Y
 * continua marcada").
 */
export type AcaoComHorario = HorarioDoFato & {
  acao: AcaoDoTurno;
  anterior?: HorarioDoFato | null;
};

/**
 * Uma consulta que a ferramenta leu (confirmar_presenca, ja_tem_consulta ou
 * a consulta do estado). marcadaNestaConversa: a consulta que a IA marcou
 * nesta conversa num turno anterior, relida agora (o estado do
 * atendimento): "ficou marcada" e "foi marcada" valem com ela. AG4:
 * remarcadaNestaConversa e a consulta NOVA da remarcacao que a IA pediu
 * nesta conversa, relida e ainda pendente da aprovacao: "foi remarcada" vale
 * com ela, e a mensagem que diz isso tem de dizer que depende da aprovacao
 * (remarcacao_sem_pendencia).
 */
export type ConsultaDoFato = HorarioDoFato & {
  marcadaNestaConversa: boolean;
  remarcadaNestaConversa?: boolean;
  /**
   * Revisao da AG4 (achado 7): a consulta NOVA da remarcacao que a IA pediu
   * nesta conversa, ja aprovada pela equipe (relida agora): "foi remarcada"
   * vale com ela, com o par dela, sem a pendencia (que ja nao e verdade).
   * Nunca junto de remarcadaNestaConversa (fato incoerente bloqueia).
   */
  remarcacaoAprovada?: boolean;
};

/** O que uma ferramenta acrescenta aos fatos, alem da propria saida. */
export type FatosDaFerramenta = {
  coberturas?: readonly CoberturaDoTurno[];
  acao?: AcaoDoTurno;
  /**
   * Revisao final da AG3: o horario da acao (reservou, marcou, remarcou).
   * Sem ele, a frase da acao com dia ou hora nao passa.
   */
  horarioDaAcao?: HorarioDoFato;
  /** A ferramenta leu uma consulta que ja existia (confirmar_presenca). */
  consultaLida?: boolean;
  /**
   * Revisao final da AG3: o horario da consulta lida. Sem ele, a frase do
   * estado da consulta com dia ou hora nao passa.
   */
  consultaComHorario?: ConsultaDoFato;
  /**
   * AG4: as consultas lidas de uma vez (consultar_minhas_consultas, a
   * consulta em foco e, na remarcacao, a antiga), com o horario de cada uma.
   */
  consultasComHorario?: readonly ConsultaDoFato[];
  /**
   * AG4: na remarcacao (acao "remarcou"), o horario da consulta antiga, que
   * continua marcada ate a aprovacao.
   */
  horarioAnterior?: HorarioDoFato;
  /**
   * Revisao da AG4 (achado 7): as consultas que a IA cancelou nesta conversa
   * num turno anterior, relidas agora e ainda canceladas (o estado do
   * atendimento). So sustentam a frase do cancelamento, com o par delas;
   * nunca sao consulta lida (nao estao marcadas).
   */
  consultasCanceladas?: readonly HorarioDoFato[];
  /**
   * Os horarios livres que a ferramenta trouxe (buscar_horario) ou reservou
   * (reservar_horario): a unica prova de "tenho as 14h".
   */
  horarios?: readonly HorarioLivreDoTurno[];
  /**
   * Revisao final da AG3: o eco do pedido (a hora e o dia que a pessoa
   * pediu, de buscar_horario, e o dia e a hora que reservar_horario recusou).
   * Fonte de data e hora SO na frase que nega ou pergunta, como a mensagem
   * do paciente; nunca prova horario livre nem acao.
   */
  ecos?: readonly string[];
  /**
   * A saida como os fatos a leem, sem o eco (ausente: a propria saida). O
   * modelo continua lendo a saida inteira.
   */
  saidaSemEco?: string;
};

export type FatosDoTurno = {
  /** As saidas (o JSON que o modelo leu) das ferramentas do turno. */
  saidasDasFerramentas: readonly string[];
  /**
   * Os textos publicados que o modelo recebe (base, instrucoes, nome da
   * clinica, a linha da hora na clinica) e os que vao colados na resposta
   * (saudacao, encerramento): fonte de data, hora e endereco.
   */
  textosPublicados: readonly string[];
  /**
   * Os textos fixos colados em volta da resposta (saudacao, aviso de
   * assistente virtual, encerramento, frase fixa escolhida): as regras dos
   * fatos tiram estes trechos do rascunho antes de ler. Nao sao afirmacao
   * do modelo.
   */
  textosColados: readonly string[];
  /** Todos os convenios do Cadastro, para reconhecer o nome no rascunho. */
  convenios: readonly ConvenioDosFatos[];
  /** O que as ferramentas do turno disseram de cada convenio. */
  coberturas: readonly CoberturaDoTurno[];
  /** As acoes que as ferramentas do turno executaram com sucesso. */
  acoes: readonly AcaoDoTurno[];
  /**
   * Revisao final da AG3: as acoes de sucesso com o horario delas (o dia, a
   * hora e a unidade). A frase da acao com dia ou hora so passa com o par
   * daquela acao (reservou quarta 14h e a resposta diz quinta 13h: barra).
   */
  horariosDasAcoes: readonly AcaoComHorario[];
  /** Uma ferramenta do turno leu uma consulta que ja existia. */
  consultaLida: boolean;
  /**
   * Revisao final da AG3: as consultas lidas com o horario delas. A frase do
   * estado da consulta com dia ou hora so passa com o par de uma delas (ou
   * da consulta marcada ou remarcada no turno).
   */
  consultasLidas: readonly ConsultaDoFato[];
  /**
   * Revisao da AG4 (achado 7): as consultas que a IA cancelou nesta conversa
   * num turno anterior, relidas e ainda canceladas. "Foi cancelada" vale com
   * o par de uma delas; nunca sustentam o estado da consulta nem o
   * fechamento. Ausente: nenhuma.
   */
  consultasCanceladas?: readonly HorarioDoFato[];
  /**
   * Revisao final da AG3: o eco do pedido (FatosDaFerramenta.ecos), fonte
   * de data e hora so na frase que nega ou pergunta.
   */
  ecosDoPedido: readonly string[];
  /** O ano de hoje no fuso da clinica (data sem ano no fato e deste ano). */
  anoCorrente: number;
  /**
   * Os horarios livres que as ferramentas de agenda trouxeram no turno: a
   * unica fonte da frase que afirma horario livre.
   */
  horariosLivres: readonly HorarioLivreDoTurno[];
  /**
   * Os nomes dos procedimentos ativos do Cadastro, para ler o procedimento
   * citado ao lado do convenio ("a Unimed cobre a Limpeza de pele").
   */
  procedimentos: readonly string[];
  /**
   * O Cadastro do turno nao tem nenhum convenio ativo: a negativa ("nao
   * atendemos convenio, so particular") e verdade sem ferramenta. So vale
   * com `convenios` vazio (o contrario e fato incoerente e bloqueia).
   */
  semConvenioAtivo: boolean;
  /**
   * Hoje no fuso da clinica, para ler "hoje" e "amanha" na frase que afirma
   * horario livre. Nulo: nao se sabe, e essa frase nao passa.
   */
  hoje: DiaDaClinica | null;
  /**
   * Revisao 2 da AG2: as respostas da base publicada que o modelo disse ter
   * usado (perguntas_da_base). Texto publicado pela clinica, nunca do
   * paciente: vai no resumo dos fatos do verificador (resumo-dos-fatos.ts)
   * como fonte de endereco e de requisito.
   */
  respostasDaBase: readonly string[];
  /**
   * Revisao curta das correcoes da AG3 (achado 5): os nomes dos profissionais
   * e das unidades do Cadastro, para ler o profissional e a unidade que a
   * frase da acao ou do estado da consulta cita ("marcada com o Dr. Bruno",
   * "na unidade Aldeota"). Ausentes ou vazios: a regra nao reconhece nenhum
   * nome do Cadastro (so os das proprias acoes).
   */
  profissionais?: readonly string[];
  unidades?: readonly string[];
};

export type AchadoDosFatos = { categoria: CategoriaDosFatos; regra: string };

/** Os fatos de um turno sem ferramenta, sem texto e sem convenio. */
export function fatosVazios(anoCorrente: number): FatosDoTurno {
  return {
    saidasDasFerramentas: [],
    textosPublicados: [],
    textosColados: [],
    convenios: [],
    coberturas: [],
    acoes: [],
    horariosDasAcoes: [],
    consultaLida: false,
    consultasLidas: [],
    consultasCanceladas: [],
    ecosDoPedido: [],
    anoCorrente,
    horariosLivres: [],
    procedimentos: [],
    semConvenioAtivo: false,
    hoje: null,
    respostasDaBase: [],
    profissionais: [],
    unidades: [],
  };
}

// ---------------------------------------------------------------------------
// Validacao (o filtro nao confia em quem chama)
// ---------------------------------------------------------------------------

function listaDeTextos(valor: unknown): boolean {
  return Array.isArray(valor) && valor.every((v) => typeof v === "string");
}

function convenioValido(valor: unknown): boolean {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const c = valor as Record<string, unknown>;
  return (
    typeof c.nome === "string" &&
    (c.plano === null || typeof c.plano === "string")
  );
}

function coberturaValida(valor: unknown): boolean {
  if (!convenioValido(valor)) {
    return false;
  }
  const c = valor as Record<string, unknown>;
  return (
    (ESTADOS_DA_COBERTURA as readonly unknown[]).includes(c.estado) &&
    (c.procedimento === null || typeof c.procedimento === "string")
  );
}

function horarioLivreValido(valor: unknown): boolean {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const h = valor as Record<string, unknown>;
  return (
    typeof h.dia === "string" &&
    typeof h.hora === "string" &&
    (h.unidade === undefined ||
      h.unidade === null ||
      typeof h.unidade === "string")
  );
}

function horarioDoFatoValido(valor: unknown): boolean {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const h = valor as Record<string, unknown>;
  return (
    typeof h.dia === "string" &&
    typeof h.hora === "string" &&
    (h.unidade === null || typeof h.unidade === "string") &&
    (h.profissional === undefined ||
      h.profissional === null ||
      typeof h.profissional === "string")
  );
}

/** Lista de textos opcional: ausente vale, presente tem de ser lista. */
function listaDeTextosOpcional(valor: unknown): boolean {
  return valor === undefined || listaDeTextos(valor);
}

function acaoComHorarioValida(valor: unknown): boolean {
  const anterior = (valor as Record<string, unknown> | null)?.anterior;
  return (
    horarioDoFatoValido(valor) &&
    (ACOES_DO_TURNO as readonly unknown[]).includes(
      (valor as Record<string, unknown>).acao,
    ) &&
    // AG4: o horario da consulta antiga, opcional, so na remarcacao.
    (anterior === undefined ||
      anterior === null ||
      (horarioDoFatoValido(anterior) &&
        (valor as Record<string, unknown>).acao === "remarcou"))
  );
}

function consultaDoFatoValida(valor: unknown): boolean {
  const remarcada = (valor as Record<string, unknown> | null)
    ?.remarcadaNestaConversa;
  const aprovada = (valor as Record<string, unknown> | null)
    ?.remarcacaoAprovada;
  return (
    horarioDoFatoValido(valor) &&
    typeof (valor as Record<string, unknown>).marcadaNestaConversa ===
      "boolean" &&
    (remarcada === undefined || typeof remarcada === "boolean") &&
    // Revisao da AG4 (achado 7): aprovada, opcional, nunca junto da
    // pendente.
    (aprovada === undefined || typeof aprovada === "boolean") &&
    !(remarcada === true && aprovada === true)
  );
}

/** Revisao da AG4 (achado 7): a lista opcional das consultas canceladas. */
function consultasCanceladasValidas(valor: unknown): boolean {
  return (
    valor === undefined ||
    (Array.isArray(valor) && valor.every(horarioDoFatoValido))
  );
}

function inteiroEntre(valor: unknown, minimo: number, maximo: number) {
  return (
    typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= minimo &&
    valor <= maximo
  );
}

function diaDaClinicaValido(valor: unknown): boolean {
  if (valor === null) {
    return true;
  }
  if (typeof valor !== "object") {
    return false;
  }
  const d = valor as Record<string, unknown>;
  return (
    inteiroEntre(d.dia, 1, 31) &&
    inteiroEntre(d.mes, 1, 12) &&
    inteiroEntre(d.ano, 2000, 2200)
  );
}

/** Os fatos tem exatamente o formato esperado? Qualquer desvio bloqueia. */
export function fatosValidos(valor: unknown): valor is FatosDoTurno {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const f = valor as Record<string, unknown>;
  return (
    listaDeTextos(f.saidasDasFerramentas) &&
    listaDeTextos(f.textosPublicados) &&
    listaDeTextos(f.textosColados) &&
    Array.isArray(f.convenios) &&
    f.convenios.every(convenioValido) &&
    Array.isArray(f.coberturas) &&
    f.coberturas.every(coberturaValida) &&
    Array.isArray(f.acoes) &&
    f.acoes.every((a) => (ACOES_DO_TURNO as readonly unknown[]).includes(a)) &&
    // Revisao final da AG3: o horario de cada acao e de cada consulta lida;
    // a acao com horario tem de estar entre as acoes, e a consulta lida com
    // horario, com a consulta lida (fato incoerente bloqueia).
    Array.isArray(f.horariosDasAcoes) &&
    f.horariosDasAcoes.every(acaoComHorarioValida) &&
    f.horariosDasAcoes.every((h) =>
      (f.acoes as readonly unknown[]).includes(
        (h as Record<string, unknown>).acao,
      ),
    ) &&
    typeof f.consultaLida === "boolean" &&
    Array.isArray(f.consultasLidas) &&
    f.consultasLidas.every(consultaDoFatoValida) &&
    (f.consultasLidas.length === 0 || f.consultaLida === true) &&
    consultasCanceladasValidas(f.consultasCanceladas) &&
    listaDeTextos(f.ecosDoPedido) &&
    inteiroEntre(f.anoCorrente, 2000, 2200) &&
    Array.isArray(f.horariosLivres) &&
    f.horariosLivres.every(horarioLivreValido) &&
    listaDeTextos(f.procedimentos) &&
    typeof f.semConvenioAtivo === "boolean" &&
    // Sem convenio ativo com convenio no Cadastro e fato incoerente.
    !(f.semConvenioAtivo && f.convenios.length > 0) &&
    diaDaClinicaValido(f.hoje) &&
    listaDeTextos(f.respostasDaBase) &&
    // Revisao curta das correcoes da AG3: os nomes do Cadastro, opcionais.
    listaDeTextosOpcional(f.profissionais) &&
    listaDeTextosOpcional(f.unidades)
  );
}

// ---------------------------------------------------------------------------
// Data e hora
// ---------------------------------------------------------------------------

const MESES = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;
const NOME_DO_MES = `(?:${MESES.join("|")})`;

export type DataLida = { dia: number; mes: number | null; ano: number | null };

export type DatasEHoras = {
  datas: DataLida[];
  /** "HH:MM", com a hora em dois digitos. */
  horas: string[];
};

/** "rascunho": o que o modelo escreveu. "fonte": de onde o fato vale. */
export type ModoDaLeitura = "rascunho" | "fonte";

// dd/mm e dd/mm/aaaa (ou aa). Ponto e hifen so com o ano de quatro digitos:
// "1.500" e preco, "2-3 dias" e quantidade.
const DATA_COM_BARRA =
  /(?<![\d/.,:])(\d{1,2})\s?\/\s?(\d{1,2})(?:\s?\/\s?(\d{4}|\d{2}))?(?![\d/]|[.,]\d)/g;
const DATA_COM_PONTO = /(?<![\d/.,:])(\d{1,2})[.-](\d{1,2})[.-](\d{4})(?!\d)/g;
// "16 de outubro", "1o de maio" (o "º" vira "o" na base), "21 de outubro
// de 2026".
const DATA_POR_EXTENSO = new RegExp(
  `(?<![\\d/.,])(\\d{1,2})o?\\s+de\\s+(${NOME_DO_MES})(?:\\s+de\\s+(\\d{4}))?\\b`,
  "g",
);
// "dia 30" so quando acompanha hora ("dia 30 as 14h", "dia 30, 9h30"): sem
// mes nem hora, "dia 30" e so o dia do mes e nao e lido.
const DIA_COM_HORA =
  /\bdia\s+(\d{1,2})\b(?!\s*(?:\/|de\s+[a-z]))(?=\s*,?\s*(?:(?:as|a partir das|pelas|das)\s+\d{1,2}(?!\d)|\d{1,2}\s?(?:h(?![a-z])|hs\b|hrs?\b|:\d{2})))/g;
// Logradouro com data no nome ("Rua 7 de Setembro", "Av. 13 de Maio"): a
// data e nome, nao data.
const DATA_QUE_E_NOME =
  /\b(?:rua|r\.|avenida|av\.?|travessa|alameda|praca|estrada|rodovia|largo|ladeira|bairro|conjunto|colegio|escola|hospital|shopping|edificio|predio|galeria|vila|parque|viaduto|ponte)\s*$/;
// "24/7" (o tempo todo) e fracao de valor ("1/3 do valor") nao sao data.
const DEPOIS_DE_DATA_QUE_NAO_E =
  /^\s*(?:d[oa]s?\s+(?:valor|total|preco|pagamento|procedimento|sessao|sessoes)\b|horas?\b|h\b|x\b|%)/;

// Uma expressao de hora so: "as 14", "das 8", "a partir das 9h", "ate as
// 18:30", "pelas 10 e meia", "14:00", "14h", "14h30", "14hs", "14 hrs",
// "14h30min", "10 horas".
const PREFIXO_DE_HORA = "(?:as|das|pelas|a partir das|ate as)";
const HORA = new RegExp(
  `(\\b${PREFIXO_DE_HORA}\\s+)?(?<![\\d:.,/])(\\d{1,2})(?:\\s?:\\s?(\\d{2})(?![\\d:])|\\s?(h|hs|hrs?|horas?)(?![a-z])(?:\\s?(\\d{2})(?!\\d))?(?:\\s?min\\b)?|\\s+e\\s+(meia|\\d{2})\\b)?(?![\\d/]|[.,]\\d|:)`,
  "g",
);
// "de 8 as 18", "de 8 a 18h": o primeiro numero tambem e hora.
const INICIO_DE_FAIXA =
  /\bde\s+(\d{1,2})(?=\s+(?:as|ate as)\s+\d{1,2}\b|\s+a\s+\d{1,2}\s?(?:h|hs|horas)(?![a-z]))/g;
const MEIO_DIA = /\bmeio[- ]?dia\b/g;
const MEIA_NOITE = /\bmeia[- ]?noite\b/g;

// "as 2 consultas", "as 3 opcoes": o artigo, nao a hora.
const QUANTIDADE_DEPOIS =
  /^\s*(?:sessoes|sessao|consultas?|vagas?|opcoes|opcao|unidades?|aplicacoes|aplicacao|vezes|pessoas?|primeir|ultim|outr|mais\b|anos?\b|meses|mes\b|dias?\b|semanas?|reais|real\b|r\$|%|x\b|parcelas?|pacientes?|clinicas?|salas?|profissionais|medic|doutor|areas?|regioes|procedimentos?|retornos?|avaliacoes|minutos?|min\b|segundos?|horarios?|datas?|perguntas?|mensagens?)/;
// Duracao: "dura 1h", "leva 2h", "em 6h", "1h de duracao", "48h antes".
const ANTES_DE_DURACAO =
  /(?:\b(?:dura|duram|durar|durando|duracao|leva|levam|levar|levando|demora|demoram|demorar|demorando|intervalo|jejum|a cada)\s+(?:\S+\s+){0,2}|\b(?:em|por)\s+)$/;
const DEPOIS_DE_DURACAO =
  /^\s*(?:de\s+(?:duracao|antecedencia|atraso|tolerancia|jejum|repouso|intervalo|espera|procedimento|sessao|aplicacao|consulta|atendimento|viagem|voo|carro|ida|antecipacao)\b|antes\b|depois\b|apos\b|seguid|por\s+(?:dia|semana|sessao|mes)\b|semanais\b|diarias\b|de\s+cada\b)/;
const PERIODO_DEPOIS = /^\s*(?:da|de|a)\s+(manha|tarde|noite)\b/;
/** Hora sem "as" na frente ate isto, no rascunho, e duracao ("dura 1h"). */
const MAIOR_HORA_QUE_E_DURACAO = 5;

function dataValida(dia: number, mes: number | null): boolean {
  return dia >= 1 && dia <= 31 && (mes === null || (mes >= 1 && mes <= 12));
}

function anoDe(texto: string | undefined): number | null {
  if (texto === undefined) {
    return null;
  }
  const n = Number(texto);
  return texto.length === 2 ? 2000 + n : n;
}

function hora(h: number, m: number): string | null {
  if (!Number.isInteger(h) || !Number.isInteger(m)) {
    return null;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "as 2 da tarde" e 14:00; "as 8 da noite", 20:00. */
function comPeriodo(h: number, depois: string): number {
  const periodo = PERIODO_DEPOIS.exec(depois)?.[1];
  if ((periodo === "tarde" || periodo === "noite") && h >= 1 && h < 12) {
    return h + 12;
  }
  return h;
}

/** Uma data ou uma hora lida, com a posicao no texto. */
type TemporalLido =
  | { tipo: "data"; indice: number; fim: number; data: DataLida }
  | { tipo: "hora"; indice: number; fim: number; hora: string };

/**
 * As datas e as horas de um texto JA NORMALIZADO, com a posicao, na ordem
 * de leitura de datasEHorasDoTexto (primeiro as datas, depois as horas).
 */
function temporaisDoTexto(base: string, modo: ModoDaLeitura): TemporalLido[] {
  const lidos: TemporalLido[] = [];
  const rascunho = modo === "rascunho";
  const antes = (indice: number) =>
    base.slice(Math.max(0, indice - 40), indice);
  const depois = (fim: number) => base.slice(fim, fim + 40);
  const data = (indice: number, fim: number, lida: DataLida) =>
    lidos.push({ tipo: "data", indice, fim, data: lida });
  const comHora = (indice: number, fim: number, lida: string | null) => {
    if (lida !== null) {
      lidos.push({ tipo: "hora", indice, fim, hora: lida });
    }
  };

  for (const m of base.matchAll(DATA_COM_BARRA)) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    const indice = m.index ?? 0;
    const fim = indice + m[0].length;
    if (
      rascunho &&
      ((dia === 24 && mes === 7 && m[3] === undefined) ||
        DEPOIS_DE_DATA_QUE_NAO_E.test(depois(fim)))
    ) {
      continue;
    }
    if (dataValida(dia, mes)) {
      data(indice, fim, { dia, mes, ano: anoDe(m[3]) });
    }
  }
  for (const m of base.matchAll(DATA_COM_PONTO)) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    const indice = m.index ?? 0;
    if (dataValida(dia, mes)) {
      data(indice, indice + m[0].length, { dia, mes, ano: anoDe(m[3]) });
    }
  }
  for (const m of base.matchAll(DATA_POR_EXTENSO)) {
    const indice = m.index ?? 0;
    if (rascunho && DATA_QUE_E_NOME.test(antes(indice))) {
      continue;
    }
    const dia = Number(m[1]);
    const mes = MESES.indexOf(m[2] as (typeof MESES)[number]) + 1;
    if (dataValida(dia, mes)) {
      data(indice, indice + m[0].length, { dia, mes, ano: anoDe(m[3]) });
    }
  }
  for (const m of base.matchAll(DIA_COM_HORA)) {
    const dia = Number(m[1]);
    const indice = m.index ?? 0;
    if (dataValida(dia, null)) {
      data(indice, indice + m[0].length, { dia, mes: null, ano: null });
    }
  }

  for (const m of base.matchAll(HORA)) {
    const [, prefixo, hh, mmDosPontos, unidade, mmDoH, mmDoE] = m;
    const inicio = (m.index ?? 0) + (prefixo?.length ?? 0);
    const fim = (m.index ?? 0) + m[0].length;
    const depoisDela = depois(fim);
    const comPeriodoDepois = PERIODO_DEPOIS.test(depoisDela);
    const h = Number(hh);
    const doisPontos = mmDosPontos !== undefined;
    const comH = unidade !== undefined && !unidade.startsWith("hora");
    const emHoras = unidade !== undefined && unidade.startsWith("hora");
    const comE = mmDoE !== undefined;

    if (prefixo === undefined) {
      // Numero solto so e hora com dois pontos, com "h", com "e meia" ou
      // com o periodo ("2 da tarde"). "Dias 14 e 15" nao e hora: sem "as",
      // so "e meia". "10 horas" sem "as" e duracao no rascunho ("24 horas
      // de antecedencia"); na fonte, conta.
      const ehHora =
        doisPontos ||
        comH ||
        mmDoE === "meia" ||
        comPeriodoDepois ||
        (emHoras && !rascunho);
      if (!ehHora) {
        continue;
      }
      if (
        rascunho &&
        !comPeriodoDepois &&
        (h <= MAIOR_HORA_QUE_E_DURACAO ||
          ANTES_DE_DURACAO.test(antes(inicio)) ||
          DEPOIS_DE_DURACAO.test(depoisDela))
      ) {
        continue;
      }
    } else if (
      rascunho &&
      unidade === undefined &&
      !doisPontos &&
      !comE &&
      QUANTIDADE_DEPOIS.test(depoisDela)
    ) {
      continue;
    }
    const minutos =
      mmDoE === "meia" ? 30 : Number(mmDosPontos ?? mmDoH ?? mmDoE ?? "0");
    comHora(inicio, fim, hora(comPeriodo(h, depoisDela), minutos));
  }
  for (const m of base.matchAll(INICIO_DE_FAIXA)) {
    const fim = (m.index ?? 0) + m[0].length;
    comHora(fim - (m[1]?.length ?? 0), fim, hora(Number(m[1]), 0));
  }
  for (const m of base.matchAll(MEIO_DIA)) {
    const indice = m.index ?? 0;
    comHora(indice, indice + m[0].length, "12:00");
  }
  for (const m of base.matchAll(MEIA_NOITE)) {
    const indice = m.index ?? 0;
    comHora(indice, indice + m[0].length, "00:00");
  }
  return lidos;
}

/**
 * As datas e as horas de um texto JA NORMALIZADO (normalizarBase). No modo
 * "fonte" (de onde o fato vale), tudo que tem cara de hora conta; no modo
 * "rascunho" (o que o modelo escreveu), duracao ("dura 1h", "24h de
 * antecedencia", "48h antes", "10 horas"), quantidade ("as 3 opcoes") e
 * data que e nome de rua ("Rua 7 de Setembro") ficam de fora. Numero solto
 * ("30 minutos", "R$ 150", "3o andar") nunca e hora.
 */
export function datasEHorasDoTexto(
  base: string,
  modo: ModoDaLeitura,
): DatasEHoras {
  const lidos = temporaisDoTexto(base, modo);
  return {
    datas: lidos.flatMap((l) => (l.tipo === "data" ? [l.data] : [])),
    horas: lidos.flatMap((l) => (l.tipo === "hora" ? [l.hora] : [])),
  };
}

function dataNosFatos(
  data: DataLida,
  fatos: readonly DataLida[],
  anoCorrente: number,
): boolean {
  return fatos.some(
    (f) =>
      f.dia === data.dia &&
      (data.mes === null || f.mes === null || f.mes === data.mes) &&
      (data.ano === null ||
        (f.ano === null ? data.ano === anoCorrente : f.ano === data.ano)),
  );
}

// ---------------------------------------------------------------------------
// Frases com a posicao (data, hora e convenio)
// ---------------------------------------------------------------------------

/**
 * Abreviacoes que terminam em ponto sem fechar a frase ("Dra. Ana", "Av.
 * Brasil", "R. Dr. Jose"). Ja sem acento e minusculas.
 */
const ABREVIACOES: ReadonlySet<string> = new Set([
  "dr",
  "dra",
  "drs",
  "dras",
  "sr",
  "sra",
  "srta",
  "av",
  "r",
  "n",
  "no",
  "nr",
  "prof",
  "profa",
  "eng",
  "sto",
  "sta",
  "al",
  "pca",
  "tv",
  "trav",
  "rod",
  "estr",
  "s",
  "km",
  "ex",
  "obs",
  "aprox",
  "tel",
  "cel",
  "ltda",
  "cia",
  "jd",
  "pq",
  "vl",
  "ed",
  "bl",
  "ap",
  "apto",
  "cj",
  "qd",
  "lt",
]);

/**
 * O que fecha uma frase: "!" e "?", o ponto seguido de espaco (nao o da
 * abreviacao nem o do numero, "1.500") e as conjuncoes que viram a frase
 * ("15:00 nao tenho, mas as 16h tenho": a segunda parte afirma). O ";" nao
 * fecha: e a lista de horarios ("terca as 14h; quarta as 9h").
 */
const FIM_DE_FRASE =
  /[!?]+|\.+(?=\s|$)|\s+(?:mas|porem|contudo|entretanto|no entanto)\s+/g;

type Frase = { inicio: number; fim: number; texto: string };

/** As frases de um texto JA NORMALIZADO, com a posicao. */
function frasesComPosicao(base: string): Frase[] {
  const frases: Frase[] = [];
  let inicio = 0;
  const fechar = (fim: number, proximo: number) => {
    const texto = base.slice(inicio, fim);
    if (texto.trim() !== "") {
      frases.push({ inicio, fim, texto });
    }
    inicio = proximo;
  };
  for (const m of base.matchAll(FIM_DE_FRASE)) {
    const indice = m.index ?? 0;
    const trecho = m[0];
    if (/^\s/.test(trecho)) {
      // A conjuncao abre a frase seguinte.
      fechar(indice, indice + 1);
      continue;
    }
    if (trecho.startsWith(".")) {
      const palavra = /([a-z]+)$/.exec(base.slice(0, indice))?.[1];
      if (palavra !== undefined && ABREVIACOES.has(palavra)) {
        continue;
      }
    }
    fechar(indice + trecho.length, indice + trecho.length);
  }
  fechar(base.length, base.length);
  return frases;
}

function fraseNoIndice(
  frases: readonly Frase[],
  indice: number,
): Frase | undefined {
  return frases.find((f) => indice >= f.inicio && indice < f.fim);
}

// ---------------------------------------------------------------------------
// Horario livre (revisao da AG2)
// ---------------------------------------------------------------------------

/** Hora ou data logo depois do verbo ("tenho 10:30", "temos 21/10"). */
const HORA_OU_DATA_LOGO_DEPOIS =
  "\\d{1,2}(?:\\s?:\\s?\\d{2}|\\s?h(?![a-z])|\\s?hs\\b|\\s?horas?\\b|\\s?\\/\\s?\\d)";
/** A vaga da agenda ("vaga de estacionamento" nao e). */
const VAGA_DA_AGENDA =
  "vag(?:a|as|o|os)\\b(?!\\s+(?:de|do|no|na)\\s+(?:estacionamento|garagem|carro|moto))";
/** O que vem depois de "tenho", "temos" e "tem" numa oferta de horario. */
const DEPOIS_DE_TER = `(?:horarios?(?!\\s+(?:ja\\s+)?(?:marcad|agendad|reservad|confirmad))|${VAGA_DA_AGENDA}|disponibilidade|encaixes?|agenda|as\\b|a partir|depois d|antes d|para\\b|pra\\b|na\\b|no\\b|nesta|nessa|neste|nesse|dia\\b|dias\\b|amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo|${HORA_OU_DATA_LOGO_DEPOIS}|de manha|de tarde|de noite|a tarde|a noite|pela manha|pela tarde|pela noite|com\\s+(?:a|o)\\b|livres?\\b|\\u00a7)`;
// Revisao curta das correcoes da AG3 (achado 3): tambem "tenho esse horario",
// "temos o mesmo horario" (a oferta que repete o pedido).
const QUANTIFICADORES_DA_OFERTA =
  "(?:(?:sim|ainda|so|apenas|tambem|a|o|as|os|um|uma|uns|umas|outro|outra|outros|outras|mais|disponivel|livre|estes|estas|esses|essas|esse|essa|este|esta|mesmo|mesma|os seguintes|as seguintes|alguns|algumas|dois|duas|tres)\\s+)*";
const PERIODOS_DA_OFERTA = `(?:as\\b|a partir|depois|antes|na\\b|no\\b|dia\\b|amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo|${HORA_OU_DATA_LOGO_DEPOIS}|de manha|de tarde|de noite|a tarde|a noite|pela manha|pela tarde|nesse|nesta|neste|nessa)`;
/**
 * O que esta livre ou disponivel sem ser a agenda ("o estacionamento e
 * livre das 7h as 19h", "o laudo fica disponivel as 14h").
 */
const LIVRE_QUE_NAO_E_AGENDA =
  "(?<!\\b(?:estacionamento|garagem|acesso|entrada|wi-?fi|internet|banheiro|elevador|rampa|cafe|agua|area|espaco|sala de espera|recepcao|resultado|laudo|exame|documento|recibo|nota|guia|boleto|link|pix|cardapio|material)\\s+(?:\\S+\\s+){0,3})";
/** Quem abre e fecha ("a clinica abre apenas as 8h") nao oferece horario. */
const SO_AS_QUE_NAO_E_OFERTA =
  "(?<!\\b(?:abre|abrimos|abrem|abrindo|fecha|fechamos|fecham|fechando|funciona|funcionamos|funcionam|atende|atendemos|atendem|chegar|chegue|cheguem)\\s+)";
/**
 * Revisao curta das correcoes da AG3 (achado 3): as palavras que dizem que o
 * horario NAO esta livre sem a palavra que nega ("ja esta ocupado", "esta
 * indisponivel", "ja foi preenchido", "esta lotado", "esgotou", "a agenda
 * esta cheia", "ja foi pego"). Negadas ("nao esta ocupado") dizem o
 * contrario: a frase afirma horario livre (AFIRMA_HORARIO_LIVRE).
 */
const OCUPADO =
  "(?:ocupad[oa]s?|indisponive(?:l|is)|preenchid[oa]s?|lotad[oa]s?|esgotad[oa]s?|tomad[oa]s?|peg[oa]s?|cheia|cheias|cheio|cheios|ocupou|ocuparam|preencheu|preencheram|lotou|lotaram|esgotou|esgotaram|encheu|encheram)";

/**
 * A frase afirma horario livre: "tenho as 14h", "temos vaga", "esta
 * livre", "pode ser as 10 e meia", "as 15h30 consigo", "da pra ser
 * amanha", "esta disponivel", "so as 16h", "tenho estes horarios: ...",
 * "encontrei terca as 14h", "que tal terca as 14h?". Lido frase a frase; a
 * negacao logo antes ("nao tenho", "sem vaga", "nao da pra") desfaz.
 */
const AFIRMA_HORARIO_LIVRE = new RegExp(
  [
    // "Voce tem horario as 14h" e a consulta da pessoa, nao horario livre.
    `(?<!\\b(?:voce|vc|a senhora|o senhor)\\s+(?:ja\\s+)?)\\b(?:tenho|temos|tem|teria|teriamos|terei|teremos)\\s+${QUANTIFICADORES_DA_OFERTA}${DEPOIS_DE_TER}`,
    // "As 16h tenho", "as 16h tenho, sim": o verbo no fim da oracao.
    "(?<!\\b(?:voce|vc|a senhora|o senhor)\\s+(?:ja\\s+)?)\\b(?:tenho|temos|tem)\\s*(?:,?\\s*sim\\b|[,.!?;]|$)",
    `\\bha\\s+${QUANTIFICADORES_DA_OFERTA}(?:horarios?|${VAGA_DA_AGENDA}|disponibilidade|encaixes?)`,
    `\\b${VAGA_DA_AGENDA}`,
    `${LIVRE_QUE_NAO_E_AGENDA}\\blivres?\\b`,
    `${LIVRE_QUE_NAO_E_AGENDA}(?:\\bdisponive(?:l|is)\\b|\\bdisponibilidade\\b)`,
    `\\bpode ser\\s+(?:sim\\s*,?\\s*)?${PERIODOS_DA_OFERTA}`,
    "(?<!\\b(?:traga|traz|trazer|leve|levar|levem|tragam|levando|trazendo)\\s)\\b(?:consigo|conseguimos|conseguiria|conseguiriamos)\\b",
    "\\bda\\s+(?:pra|para|sim|certo)\\b",
    "\\b(?:encaixo|encaixamos|encaixar|encaixe)\\b",
    "\\b(?:posso|podemos)\\s+(?:te\\s+|lhe\\s+)?oferecer\\b|\\bofereco\\b",
    `${SO_AS_QUE_NAO_E_OFERTA}\\b(?:so|somente|apenas)\\s+(?:as|a partir das|depois das|antes das)\\s+\\d`,
    "\\b(?:abriu|abriram|sobrou|sobraram|surgiu|surgiram|apareceu|liberou|liberaram)\\s+(?:uma?\\s+|um\\s+|outr[oa]\\s+|mais\\s+)?(?:vagas?|horarios?|encaixes?)\\b",
    "\\b(?:encontrei|achei|localizei)\\b",
    "\\bproxim[oa]s?\\s+(?:horarios?|vagas?|datas?)\\b",
    // "Que tal sexta?" propoe procurar; "que tal sexta as 14h?" oferece o
    // horario (com a hora na frase).
    "\\b(?:opc(?:ao|oes)|que tal|possivel)\\b(?=[^.!?;]*\\d)",
    "\\bposso\\s+(?:te\\s+|lhe\\s+)?(?:marcar|agendar|reservar|encaixar)\\b",
    // Revisao 2 da AG2: a lista de horarios tambem e oferta ("Seguem os
    // horarios: terca as 14h", "As opcoes sao: ..."), com numero depois.
    "\\b(?:segue|seguem|aqui estao|aqui vao|estes sao|estas sao|sao estes|sao estas)\\b(?=[^.!?]*\\d)",
    "\\b(?:horarios|opcoes|datas|vagas)\\b(?!\\s+de\\s+(?:funcionamento|atendimento|visita))(?:\\s+[^\\s:.!?]+){0,2}?\\s*:(?=[^.!?]*\\d)",
    // Revisao curta das correcoes da AG3 (achado 3): o horario que "nao esta
    // ocupado", "nao esta mais lotado", "vagou" ou "desocupou" esta livre.
    // O eco do pedido nunca prova isso: so o horario livre da ferramenta.
    `${LIVRE_QUE_NAO_E_AGENDA}\\b(?:nao|nem)\\s+(?:(?:esta|estao|ta|fica|ficou|e|esta mais|ta mais)\\s+)?(?:mais\\s+)?${OCUPADO}\\b`,
    `${LIVRE_QUE_NAO_E_AGENDA}\\b(?:vagou|vagaram|desocupou|desocuparam|desocupad[oa]s?)\\b`,
  ].join("|"),
  "g",
);
/** A oferta que fala de agenda e passa para a frase seguinte. */
const FALA_DE_AGENDA =
  /\b(?:horarios?|vagas?|disponibilidade|encaixes?|opcoes|datas)\b/;

// ---------------------------------------------------------------------------
// Pergunta de verdade e negacao que rege o verbo (revisao 2 da AG2)
// ---------------------------------------------------------------------------

/**
 * A etiqueta de confirmacao no fim da frase ("ok?", "certo?", "tudo bem?",
 * "combinado?", "beleza?", "viu?", "ne?", "ta bom?", "pode ser?") nao faz da
 * afirmacao uma pergunta: "Sua consulta esta marcada para amanha, ok?"
 * afirma. Ja sem acento.
 */
const ETIQUETAS_DE_CONFIRMACAO = [
  "ok",
  "okay",
  "certo",
  "certinho",
  "ta certo",
  "esta certo",
  "correto",
  "tudo bem",
  "tudo certo",
  "tudo ok",
  "combinado",
  "beleza",
  "blz",
  "viu",
  "ne",
  "nao e",
  "ta bom",
  "esta bom",
  "ta",
  "pode ser",
  "fechado",
  "confere",
  "entendido",
];
const ETIQUETA_NO_FIM = new RegExp(
  `(?:^|[\\s,;:.!-])(?:${ETIQUETAS_DE_CONFIRMACAO.join("|")})\\s*\\?[?!.\\s]*$`,
);

/**
 * A frase e uma pergunta de verdade: termina em "?" depois de tirar a
 * etiqueta de confirmacao do fim. So ela isenta ("Voce tem consulta
 * amanha?"); a etiqueta nunca isenta nem legitima a hora dita pelo
 * paciente.
 */
export function ehPerguntaDeVerdade(frase: string): boolean {
  let texto = frase.trimEnd();
  for (;;) {
    if (!texto.endsWith("?")) {
      return false;
    }
    const etiqueta = ETIQUETA_NO_FIM.exec(texto);
    if (etiqueta === null) {
      return true;
    }
    texto = texto.slice(0, etiqueta.index).trimEnd();
  }
}

/** As palavras que negam. */
const NEGADORES: ReadonlySet<string> = new Set([
  "nao",
  "nem",
  "nunca",
  "jamais",
  "sem",
  "nenhum",
  "nenhuma",
]);

/**
 * O que pode ficar entre a palavra que nega e a oferta sem desfazer a
 * negacao: as palavras da propria oferta ("nao temos MAIS horario", "nao
 * tenho VAGA livre", "sem NENHUM horario"). "Nao se preocupe que tenho",
 * "sem duvida tenho" e "nao tem problema" tem no meio palavra que nao e da
 * oferta: nao negam.
 */
const LIGACAO_DA_NEGACAO: ReadonlySet<string> = new Set([
  "te",
  "lhe",
  "me",
  "mais",
  "ainda",
  "mesmo",
  "tinha",
  "vou",
  "vamos",
  "vai",
  "iria",
  "ia",
  "um",
  "uma",
  "uns",
  "umas",
  "nenhum",
  "nenhuma",
  "outro",
  "outra",
  "outros",
  "outras",
  "o",
  "a",
  "os",
  "as",
  "esse",
  "essa",
  "este",
  "esta",
  "esses",
  "essas",
  "nesse",
  "nessa",
  "neste",
  "nesta",
  "no",
  "na",
  "nos",
  "nas",
  "para",
  "pra",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "por",
  "pelo",
  "pela",
  "dia",
  "data",
  "periodo",
  "horario",
  "horarios",
  "vaga",
  "vagas",
  "encaixe",
  "encaixes",
  "disponibilidade",
  "agenda",
  "livre",
  "livres",
  "disponivel",
  "disponiveis",
  "hoje",
  "amanha",
  "manha",
  "tarde",
  "noite",
  "tenho",
  "temos",
  "tem",
  "ha",
  "havera",
  "existe",
  "existem",
  "teria",
  "teriamos",
  "terei",
  "teremos",
  "sobrou",
  "sobraram",
  "consigo",
  "conseguimos",
  "conseguiria",
  "consegue",
  "conseguem",
  "dao",
  "daria",
  "posso",
  "podemos",
  "pode",
  "poderia",
  "estao",
  "fica",
  "ficou",
  "ficaria",
  "encaixo",
  "encaixamos",
  "oferecer",
  "ofereco",
  // Revisao 2: "nao encontrei vaga", "nao achei horario livre", "nao
  // apareceu vaga".
  "encontrei",
  "encontramos",
  "encontrar",
  "achei",
  "achamos",
  "achar",
  "localizei",
  "localizamos",
  "consegui",
  "conseguir",
  "vi",
  "vimos",
  "aparece",
  "apareceu",
  "apareceram",
  "abriu",
  "surgiu",
  "restou",
  "resta",
  "teve",
  "houve",
  "marcar",
  "agendar",
  "reservar",
  "encaixar",
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
  "domingo",
]);

/** Uma hora escrita como palavra ("14h", "14:00", "14"). */
const PALAVRA_DE_HORA = /^\d{1,2}(?:h\d{0,2}|hs|:\d{2})?$/;

/**
 * A negacao rege a oferta: andando para tras a partir da oferta, so ha
 * palavras da propria oferta ate a palavra que nega, sem passar de
 * pontuacao e no maximo cinco palavras. "Nao tenho", "nao temos mais
 * horario", "sem vaga" e "nenhum horario livre" regem; "nao se preocupe que
 * tenho", "sem duvida tenho" e "nao tem problema" nao.
 */
function negacaoRegeAOferta(antes: string): boolean {
  const clausula = antes.split(/[,;:.!?()]/).pop() ?? "";
  const palavras = clausula
    .trim()
    .split(/\s+/)
    .filter((p) => p !== "");
  for (let i = palavras.length - 1, lidas = 0; i >= 0; i -= 1, lidas += 1) {
    const palavra = palavras[i] ?? "";
    if (NEGADORES.has(palavra)) {
      return true;
    }
    if (
      lidas >= 5 ||
      !(LIGACAO_DA_NEGACAO.has(palavra) || PALAVRA_DE_HORA.test(palavra))
    ) {
      return false;
    }
  }
  return false;
}

/** O verbo que diz que ha (ou nao ha) horario, para a frase que nega. */
const VERBO_DE_TER = new Set([
  "tenho",
  "temos",
  "tem",
  "ha",
  "havera",
  "existe",
  "existem",
  "teria",
  "teriamos",
  "terei",
  "teremos",
  "sobrou",
  "sobraram",
]);
const VERBO_DE_PODER = new Set([
  "consigo",
  "conseguimos",
  "conseguiria",
  "conseguiriamos",
  "consegue",
  "conseguem",
  "da",
  "dao",
  "daria",
  "posso",
  "podemos",
  "pode",
  "poderia",
  "poderiamos",
  "esta",
  "estao",
  "fica",
  "ficaria",
  "encaixo",
  "encaixamos",
  "marco",
  "marcamos",
  "agendo",
  "agendamos",
  "atendo",
  "atendemos",
  "abre",
  "abrimos",
  "funciona",
  "funcionamos",
]);
/**
 * "As 11h15 ainda nao sei", "15h nao encontrei": a incerteza e a busca sem
 * resultado tambem nao afirmam horario.
 */
const VERBO_DE_INCERTEZA = new Set([
  "sei",
  "sabemos",
  "saberia",
  "saberiamos",
  "encontrei",
  "encontramos",
  "achei",
  "achamos",
  "localizei",
  "localizamos",
  "consegui",
  "vi",
  "vimos",
]);
const NOME_DE_DISPONIBILIDADE = new Set([
  "horario",
  "horarios",
  "vaga",
  "vagas",
  "disponibilidade",
  "encaixe",
  "encaixes",
  "agenda",
]);
/** O que pode vir logo depois de "nao tenho" na negativa de horario. */
const DEPOIS_DO_TER_NA_NEGATIVA = new Set([
  ...NOME_DE_DISPONIBILIDADE,
  "mais",
  "nenhum",
  "nenhuma",
  "um",
  "uma",
  "outro",
  "outra",
  "livre",
  "livres",
  "disponivel",
  "as",
  "a",
  "para",
  "pra",
  "nesse",
  "nessa",
  "neste",
  "nesta",
  "no",
  "na",
  "dia",
  "amanha",
  "hoje",
  "depois",
  "antes",
  "como",
  "esse",
  "essa",
  "este",
  "esta",
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
  "domingo",
]);

/**
 * A frase nega horario: a palavra que nega rege um verbo de ter, de poder
 * ou de saber ("15:00 nao tenho", "nao consigo", "nao da", "voce nao
 * pode", "ainda nao sei") ou um nome de horario ("sem vaga", "nenhum
 * horario"). "Nao tem problema", "nao se preocupe" e "sem duvida" nao
 * negam horario.
 */
function fraseNegaHorario(frase: string): boolean {
  const palavras = frase
    .split(/([,;:.!?()])|\s+/)
    .filter((p): p is string => p !== undefined && p.trim() !== "");
  const fimDaClausula = (p: string | undefined) =>
    p === undefined || /^[,;:.!?()]$/.test(p);
  for (let i = 0; i < palavras.length; i += 1) {
    const negador = palavras[i] ?? "";
    if (!NEGADORES.has(negador)) {
      continue;
    }
    let j = i + 1;
    while (
      j < palavras.length &&
      j <= i + 2 &&
      /^(?:te|lhe|me|mais|ainda|mesmo|tinha|vou|vamos|vai|iria|ia)$/.test(
        palavras[j] ?? "",
      )
    ) {
      j += 1;
    }
    const cabeca = palavras[j];
    if (cabeca === undefined || fimDaClausula(cabeca)) {
      continue;
    }
    if (negador === "sem" || negador === "nenhum" || negador === "nenhuma") {
      if (NOME_DE_DISPONIBILIDADE.has(cabeca)) {
        return true;
      }
      continue;
    }
    if (VERBO_DE_PODER.has(cabeca) || VERBO_DE_INCERTEZA.has(cabeca)) {
      return true;
    }
    if (VERBO_DE_TER.has(cabeca)) {
      const seguinte = palavras[j + 1];
      if (
        fimDaClausula(seguinte) ||
        DEPOIS_DO_TER_NA_NEGATIVA.has(seguinte ?? "") ||
        PALAVRA_DE_HORA.test(seguinte ?? "")
      ) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// O horario que nao esta livre e o relato do pedido (revisao curta das
// correcoes da AG3, achado 3)
// ---------------------------------------------------------------------------

/** "Ocupado", "lotado", "ja foi preenchido"... (OCUPADO), fora da negacao. */
const DIZ_QUE_ESTA_OCUPADO = new RegExp(`\\b${OCUPADO}\\b`, "g");
/** "Nao esta ocupado", "nem esta mais lotado": a negacao do ocupado. */
const NEGACAO_DO_OCUPADO =
  /\b(?:nao|nem|nunca|jamais)\s+(?:(?:esta|estao|ta|fica|ficou|e|foi|era|estava|mais|ja|tinha|sido)\s+){0,3}$/;
/**
 * "As 15h ja tem paciente", "ja tem outra pessoa nesse horario", "a Dra.
 * ja esta com paciente". "Voce ja tem..." e a consulta da pessoa, nao o
 * horario ocupado.
 */
const JA_TEM_PACIENTE =
  /(?<!\b(?:voce|vc|a senhora|o senhor)\s+)\b(?:ja|tambem)\s+(?:tem|ha|tinha|existe)\s+(?:(?:um|uma|outro|outra|outros|outras)\s+)?(?:pacientes?|pessoas?|alguem|clientes?|gente)\b|\b(?:ja\s+)?(?:esta|estara)\s+com\s+(?:(?:um|uma|outro|outra)\s+)?(?:pacientes?|pessoas?|clientes?)\b/;
/** "Esse ja foi", "esse horario ja era": o "ja foi" que fecha a oracao. */
const JA_FOI_NO_FIM = /\bja\s+(?:foi|foram|era|eram)\b(?=\s*(?:[,;:.!?)]|$))/;
/** "Sua consulta ... ja foi" fala da consulta da pessoa, nao do horario. */
const CONSULTA_DA_PESSOA =
  /\b(?:sua|seu|tua|teu)\s+(?:consulta|agendamento|retorno|sessao|avaliacao|atendimento|procedimento|\u00a7)/;
/**
 * O horario de outra pessoa: "ja foi marcado por outra pessoa", "esta
 * reservado para outro paciente", "outra pessoa marcou antes".
 */
const DE_OUTRA_PESSOA =
  /\b(?:marcad|agendad|reservad|ocupad|pegad)[oa]s?\s+(?:por|para|pra)\s+(?:(?:um|uma)\s+)?(?:outr[oa]s?\s+(?:pessoas?|pacientes?|clientes?)|alguem)\b|\b(?:outr[oa]s?\s+(?:pessoas?|pacientes?|clientes?)|alguem)\s+(?:ja\s+)?(?:marcou|agendou|reservou|pegou|ocupou)\b/;

/**
 * A frase diz que o horario NAO esta livre sem a palavra que nega: "ja esta
 * ocupado", "esta indisponivel", "ja foi preenchido", "esta lotado", "a
 * agenda esta cheia", "ja tem paciente", "esse ja foi". Como a frase que
 * nega (fraseNegaHorario), ela aceita a data e a hora que so o paciente
 * disse e o eco do pedido; a que afirma horario livre continua nunca
 * aceitando (aceitaODitoPeloPaciente).
 */
function fraseDizQueNaoEstaLivre(frase: string): boolean {
  for (const m of frase.matchAll(DIZ_QUE_ESTA_OCUPADO)) {
    const indice = m.index ?? 0;
    if (
      !NEGACAO_DO_OCUPADO.test(frase.slice(Math.max(0, indice - 40), indice))
    ) {
      return true;
    }
  }
  return (
    JA_TEM_PACIENTE.test(frase) ||
    DE_OUTRA_PESSOA.test(frase) ||
    (JA_FOI_NO_FIM.test(frase) && !CONSULTA_DA_PESSOA.test(frase))
  );
}

/**
 * O relato do pedido da pessoa ("Voce pediu quarta as 15h, certo?", "o
 * horario que voce queria"): repete o que ela disse, sem afirmar que esta
 * livre nem que foi feito (as regras do horario livre, da acao e do
 * fechamento continuam lendo a frase).
 */
const RELATO_DO_PEDIDO =
  /\b(?:voce|vc|a senhora|o senhor)\s+(?:(?:tinha|ja|me|nos|havia)\s+){0,2}(?:pediu|pedia|queria|quer|gostaria|prefere|preferia|preferiu|mencionou|falou|disse|perguntou|solicitou|escolheu|sugeriu|comentou|citou)\b/;

/**
 * O verbo de procurar antes da oferta, na pergunta que oferece procurar
 * ("quer que eu veja se tem horario na quinta?", "prefere que eu procure
 * vaga na sexta?").
 */
const PROCURAR_ANTES =
  /\b(?:ver|veja|vejo|vemos|verificar|verifique|verifico|verificamos|procurar|procure|procuro|procuramos|buscar|busque|busco|buscamos|consultar|consulte|consulto|consultamos|conferir|confira|confiro|conferimos|checar|cheque|checo|olhar|olhe|olho|pesquisar|pesquise|pesquiso|achar|ache|encontrar|encontre)\b(?:\s+[^\s,;:.!?]+){0,3}\s*$/;
/** O "se" da pergunta indireta, ate quatro palavras antes. */
const SE_ANTES = /\bse\b(?:\s+[^\s,;:.!?]+){0,4}\s*$/;
/**
 * A pergunta indireta com o verbo de saber ou de procurar ("nao sei se tem
 * vaga amanha", "vou ver se tem horario"): nao afirma, nem fora da pergunta.
 */
const INDIRETA_ANTES =
  /\b(?:sei|sabemos|saber|ver|vejo|verificar|verifico|consultar|consulto|conferir|confiro|checar|checo|olhar|olho|procurar|procuro|perguntar|pergunto)\s+se\b(?:\s+[^\s,;:.!?]+){0,4}\s*$/;

/** Uma oferta que a frase afirma (o trecho e a posicao). */
type OfertaLida = { indice: number; texto: string };

/**
 * As ofertas de horario livre que a frase afirma: o que casa com
 * AFIRMA_HORARIO_LIVRE, menos o que a negacao rege e, na pergunta de
 * verdade, a oferta de procurar ("quer que eu veja se tem horario na
 * quinta?", "posso verificar se tem vaga amanha?"): o horario ainda nao foi
 * visto, entao nada e afirmado.
 */
function ofertasDaFrase(frase: string): OfertaLida[] {
  const pergunta = ehPerguntaDeVerdade(frase);
  const ofertas: OfertaLida[] = [];
  for (const m of frase.matchAll(AFIRMA_HORARIO_LIVRE)) {
    const indice = m.index ?? 0;
    const antes = frase.slice(0, indice);
    if (negacaoRegeAOferta(antes)) {
      continue;
    }
    if (pergunta && (SE_ANTES.test(antes) || PROCURAR_ANTES.test(antes))) {
      continue;
    }
    if (INDIRETA_ANTES.test(antes)) {
      continue;
    }
    ofertas.push({ indice, texto: m[0] });
  }
  return ofertas;
}

function afirmaHorarioLivre(frase: string): boolean {
  return ofertasDaFrase(frase).length > 0;
}

/**
 * A oferta que afirma disponibilidade mesmo sem dia nem hora, pela palavra
 * de disponibilidade ("temos vagas essa semana", "tem horario livre sim",
 * "temos disponibilidade"): so passa com algum horario livre que a
 * ferramenta de agenda trouxe no turno. "Encontrei", "que tal", "pode ser",
 * "posso marcar para voce", "consigo te ajudar" e "temos sim" sem dia nem
 * hora nao afirmam horario (o verificador por modelo le o resto).
 */
const DISPONIBILIDADE_SEM_DATA = /horario|vag[ao]s?\b|disponibilidade|encaixe/;

function afirmaDisponibilidadeSemData(frase: string): boolean {
  // "Aviso se surgir uma vaga": a condicao nao afirma.
  return ofertasDaFrase(frase).some(
    (oferta) =>
      DISPONIBILIDADE_SEM_DATA.test(oferta.texto) &&
      !SE_ANTES.test(frase.slice(0, oferta.indice)),
  );
}

/**
 * A data, a hora e o endereco que so o paciente disse valem na frase que
 * nega horario ou e pergunta de verdade ("15:00 nao tenho", "prefere as
 * 15:00?"), nunca na que afirma horario livre. A etiqueta de confirmacao
 * ("anotado: as 15h, certo?") e a negacao de outra coisa ("nao tem
 * problema, as 15h") nao valem. Revisao curta das correcoes da AG3 (achado
 * 3): tambem na frase que diz que o horario nao esta livre sem a palavra
 * que nega ("ja esta ocupado", "esta lotado", "ja tem paciente") e no
 * relato do pedido ("voce pediu quarta as 15h, certo?").
 */
function aceitaODitoPeloPaciente(frase: Frase): boolean {
  return (
    (ehPerguntaDeVerdade(frase.texto) ||
      fraseNegaHorario(frase.texto) ||
      fraseDizQueNaoEstaLivre(frase.texto) ||
      RELATO_DO_PEDIDO.test(frase.texto)) &&
    !afirmaHorarioLivre(frase.texto)
  );
}

/** Os dias da semana, de domingo (0) a sabado (6), sem acento. */
const DIAS_DA_SEMANA = [
  "domingo",
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
] as const;
// "Terca", "terca-feira", "aos sabados". "Segunda opcao" e "quinta vez" sao
// ordinais, nao dias; "a primeira as 14h e a segunda as 15h" tambem ("a
// segunda" sem "-feira" nem data depois).
const DIA_DA_SEMANA = new RegExp(
  `\\b(${DIAS_DA_SEMANA.join("|")})(?:s|-feira|-feiras|\\s+feira|\\s+feiras)?\\b(?!\\s+(?:opcao|opcoes|vez|vezes|via|parte|sessao|sessoes|consulta|consultas|alternativa|data|semana|quinzena|etapa|dose|aplicacao|feira\\b))`,
  "g",
);
const ORDINAL_E_NAO_DIA = /(?:^|\s)(?:a|o)\s+$/;
const DIA_DEPOIS_DO_ORDINAL = /^(?:-feira|\s*,?\s*(?:dia\s+)?\d{1,2}\s?\/)/;
const DIA_RELATIVO = /\b(depois de amanha|amanha|hoje)\b/g;
const DESLOCAMENTO_DO_DIA: Readonly<Record<string, number>> = {
  hoje: 0,
  amanha: 1,
  "depois de amanha": 2,
};
// "dia 30" sem hora, so na frase que afirma horario livre ("tenho vaga dia
// 30").
const DIA_SOLTO = new RegExp(
  `\\bdia\\s+(\\d{1,2})\\b(?!\\s*(?:\\/|:|h\\b|de\\s+${NOME_DO_MES}))`,
  "g",
);
type PeriodoDoDia = "manha" | "tarde" | "noite";
// "de manha", "a tarde", "pela noite", "na parte da tarde".
const PERIODO_DO_DIA =
  /\b(?:de|pela|na|a|durante a|no periodo da|na parte da|periodo da|parte da)\s+(manha|tarde|noite)\b/g;
/** As faixas de buscar_horario (FAIXA_DO_PERIODO), em minutos do dia. */
const FAIXA_DO_PERIODO: Readonly<Record<PeriodoDoDia, [number, number]>> = {
  manha: [0, 12 * 60],
  tarde: [12 * 60, 18 * 60],
  noite: [18 * 60, 24 * 60],
};
// Entre duas partes da mesma data ("terca, 21/10", "amanha (quarta)",
// "quarta, dia 22").
const ENTRE_PARTES_DA_DATA = /^[\s,()-]*$/;

/** Uma data da oferta: cada parte nula vale qualquer uma. */
type DataDaOferta = {
  dia: number | null;
  mes: number | null;
  ano: number | null;
  semana: number | null;
  /** "amanha" sem saber hoje: nunca bate com nada. */
  impossivel: boolean;
};

type ParteDaOferta =
  | {
      tipo: "data";
      indice: number;
      fim: number;
      data: DataDaOferta;
      periodo: PeriodoDoDia | null;
    }
  | { tipo: "hora"; indice: number; fim: number; hora: string }
  | { tipo: "periodo"; indice: number; fim: number; periodo: PeriodoDoDia };

/** O par que a frase afirma: o dia com a hora dele (ou so um dos dois). */
type ParDaOferta = {
  data: DataDaOferta | null;
  hora: string | null;
  periodo: PeriodoDoDia | null;
};

function somarDias(hoje: DiaDaClinica, dias: number): DataDaOferta {
  const data = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia + dias));
  return {
    dia: data.getUTCDate(),
    mes: data.getUTCMonth() + 1,
    ano: data.getUTCFullYear(),
    semana: null,
    impossivel: false,
  };
}

/** Junta duas partes da mesma data, se nao se contradizem. */
function juntarDatas(a: DataDaOferta, b: DataDaOferta): DataDaOferta | null {
  const campo = (x: number | null, y: number | null) =>
    x === null || y === null || x === y;
  if (
    !campo(a.dia, b.dia) ||
    !campo(a.mes, b.mes) ||
    !campo(a.ano, b.ano) ||
    !campo(a.semana, b.semana)
  ) {
    return null;
  }
  return {
    dia: a.dia ?? b.dia,
    mes: a.mes ?? b.mes,
    ano: a.ano ?? b.ano,
    semana: a.semana ?? b.semana,
    impossivel: a.impossivel || b.impossivel,
  };
}

/**
 * As partes de data, hora e periodo de uma frase que afirma horario livre
 * (o texto inteiro ja normalizado e a frase dentro dele). Alem do que
 * temporaisDoTexto le, o dia da semana, "hoje" e "amanha", "dia 30" sem
 * hora e o periodo do dia; as partes coladas da mesma data ("terca, 21/10")
 * viram uma so, e o periodo logo depois da data e dela ("amanha de manha").
 * No modo "fonte" (revisao 2: a unidade de uma fonte, para o par de toda
 * frase), tudo que tem cara de hora conta e "a sexta" de "segunda a sexta"
 * e dia, nao ordinal.
 */
function partesDaOferta(
  base: string,
  frase: Frase,
  hoje: DiaDaClinica | null,
  modo: ModoDaLeitura = "rascunho",
): ParteDaOferta[] {
  const dentro = (indice: number) =>
    indice >= frase.inicio && indice < frase.fim;
  const datas: { indice: number; fim: number; data: DataDaOferta }[] = [];
  const horas: ParteDaOferta[] = [];
  for (const lido of temporaisDoTexto(base, modo)) {
    if (!dentro(lido.indice)) {
      continue;
    }
    if (lido.tipo === "hora") {
      horas.push(lido);
    } else {
      datas.push({
        indice: lido.indice,
        fim: lido.fim,
        data: { ...lido.data, semana: null, impossivel: false },
      });
    }
  }
  const trecho = base.slice(frase.inicio, frase.fim);
  const ocupado = (indice: number) =>
    datas.some((d) => indice >= d.indice && indice < d.fim);
  for (const m of trecho.matchAll(DIA_DA_SEMANA)) {
    const indice = frase.inicio + (m.index ?? 0);
    const fim = indice + m[0].length;
    if (
      modo === "rascunho" &&
      ORDINAL_E_NAO_DIA.test(base.slice(Math.max(0, indice - 4), indice)) &&
      !DIA_DEPOIS_DO_ORDINAL.test(base.slice(fim, fim + 12)) &&
      m[0] === m[1]
    ) {
      continue;
    }
    datas.push({
      indice,
      fim: indice + m[0].length,
      data: {
        dia: null,
        mes: null,
        ano: null,
        semana: DIAS_DA_SEMANA.indexOf(m[1] as (typeof DIAS_DA_SEMANA)[number]),
        impossivel: false,
      },
    });
  }
  for (const m of trecho.matchAll(DIA_RELATIVO)) {
    const indice = frase.inicio + (m.index ?? 0);
    const deslocamento = DESLOCAMENTO_DO_DIA[m[1] ?? ""] ?? 0;
    datas.push({
      indice,
      fim: indice + m[0].length,
      data:
        hoje === null
          ? {
              dia: null,
              mes: null,
              ano: null,
              semana: null,
              impossivel: true,
            }
          : somarDias(hoje, deslocamento),
    });
  }
  for (const m of trecho.matchAll(DIA_SOLTO)) {
    const indice = frase.inicio + (m.index ?? 0);
    const dia = Number(m[1]);
    if (!ocupado(indice) && dataValida(dia, null)) {
      datas.push({
        indice,
        fim: indice + m[0].length,
        data: { dia, mes: null, ano: null, semana: null, impossivel: false },
      });
    }
  }
  datas.sort((a, b) => a.indice - b.indice);

  // As partes coladas da mesma data viram uma so.
  const juntas: {
    indice: number;
    fim: number;
    data: DataDaOferta;
    periodo: PeriodoDoDia | null;
  }[] = [];
  for (const parte of datas) {
    const anterior = juntas[juntas.length - 1];
    if (
      anterior !== undefined &&
      parte.indice >= anterior.fim &&
      ENTRE_PARTES_DA_DATA.test(base.slice(anterior.fim, parte.indice))
    ) {
      const junta = juntarDatas(anterior.data, parte.data);
      if (junta !== null) {
        anterior.data = junta;
        anterior.fim = Math.max(anterior.fim, parte.fim);
        continue;
      }
    }
    if (anterior !== undefined && parte.indice < anterior.fim) {
      continue;
    }
    juntas.push({ ...parte, periodo: null });
  }

  // O periodo logo depois da data e dela; logo depois da hora e da hora
  // ("as 9 de manha") e ja foi lido nela; o resto fica solto.
  const periodos: ParteDaOferta[] = [];
  for (const m of trecho.matchAll(PERIODO_DO_DIA)) {
    const indice = frase.inicio + (m.index ?? 0);
    const periodo = m[1] as PeriodoDoDia;
    const daData = juntas.find(
      (d) => d.fim <= indice && /^[\s,]*$/.test(base.slice(d.fim, indice)),
    );
    if (daData !== undefined) {
      daData.periodo = daData.periodo ?? periodo;
      continue;
    }
    if (
      horas.some(
        (h) => h.fim <= indice && /^[\s,]*$/.test(base.slice(h.fim, indice)),
      )
    ) {
      continue;
    }
    periodos.push({
      tipo: "periodo",
      indice,
      fim: indice + m[0].length,
      periodo,
    });
  }
  return [
    ...juntas.map((d) => ({ tipo: "data" as const, ...d })),
    ...horas,
    ...periodos,
  ].sort((a, b) => a.indice - b.indice);
}

/**
 * Os pares que a frase afirma. A hora vai com a data do mesmo lado em que a
 * frase comecou: "terca, 21/10 as 14h e quarta, 22/10 as 9h" (data antes)
 * e "as 14h na terca, 21/10, ou as 9h na quarta" (hora antes); sem data
 * desse lado, a do outro. A data sem hora e o periodo solto (sem hora na
 * frase) tambem sao pares.
 */
function paresDaOferta(partes: readonly ParteDaOferta[]): ParDaOferta[] {
  const datas = partes.filter(
    (p): p is Extract<ParteDaOferta, { tipo: "data" }> => p.tipo === "data",
  );
  const horas = partes.filter(
    (p): p is Extract<ParteDaOferta, { tipo: "hora" }> => p.tipo === "hora",
  );
  const primeira = partes.find((p) => p.tipo !== "periodo");
  const dataAntes = primeira?.tipo === "data";
  const usadas = new Set<number>();
  const pares: ParDaOferta[] = [];
  for (const h of horas) {
    const antes = [...datas].reverse().find((d) => d.indice < h.indice);
    const depois = datas.find((d) => d.indice > h.indice);
    const d = dataAntes ? (antes ?? depois) : (depois ?? antes);
    if (d !== undefined) {
      usadas.add(d.indice);
    }
    pares.push({
      data: d?.data ?? null,
      hora: h.hora,
      periodo: d?.periodo ?? null,
    });
  }
  for (const d of datas) {
    if (!usadas.has(d.indice)) {
      pares.push({ data: d.data, hora: null, periodo: d.periodo });
    }
  }
  if (horas.length === 0) {
    for (const p of partes) {
      if (p.tipo === "periodo") {
        pares.push({ data: null, hora: null, periodo: p.periodo });
      }
    }
  }
  return pares;
}

type HorarioLivreLido = { data: DataDaOferta; hora: string };

/**
 * O horario livre que a ferramenta devolveu, lido com as mesmas regras do
 * rascunho ("terca, 21/10" e "14:00"). O dia da semana e o que a
 * ferramenta escreveu. Fora do formato: nulo (nao prova nada).
 */
function horarioLivreLido(
  horario: HorarioLivreDoTurno,
  anoCorrente: number,
): HorarioLivreLido | null {
  const dia = normalizarBase(horario.dia);
  const datas = temporaisDoTexto(dia, "fonte").filter(
    (l): l is Extract<TemporalLido, { tipo: "data" }> => l.tipo === "data",
  );
  const lidaAHora = temporaisDoTexto(
    normalizarBase(horario.hora),
    "fonte",
  ).find(
    (l): l is Extract<TemporalLido, { tipo: "hora" }> => l.tipo === "hora",
  );
  const data = datas[0]?.data;
  if (datas.length !== 1 || data === undefined || lidaAHora === undefined) {
    return null;
  }
  const semana = /^\s*([a-z]+)/.exec(dia)?.[1];
  const indiceDaSemana = DIAS_DA_SEMANA.indexOf(
    semana as (typeof DIAS_DA_SEMANA)[number],
  );
  return {
    data: {
      dia: data.dia,
      mes: data.mes,
      ano: data.ano ?? anoCorrente,
      semana: indiceDaSemana === -1 ? null : indiceDaSemana,
      impossivel: false,
    },
    hora: lidaAHora.hora,
  };
}

function minutosDa(horaLida: string): number {
  const [h = "0", m = "0"] = horaLida.split(":");
  return Number(h) * 60 + Number(m);
}

function mesmaData(rascunho: DataDaOferta, livre: DataDaOferta): boolean {
  const igual = (x: number | null, y: number | null) =>
    x === null || y === null || x === y;
  return (
    !rascunho.impossivel &&
    (rascunho.dia === null || rascunho.dia === livre.dia) &&
    igual(rascunho.mes, livre.mes) &&
    (rascunho.ano === null || rascunho.ano === livre.ano) &&
    igual(rascunho.semana, livre.semana)
  );
}

function parNoHorarioLivre(par: ParDaOferta, livre: HorarioLivreLido) {
  const [de, ate] =
    par.periodo === null ? [0, 24 * 60] : FAIXA_DO_PERIODO[par.periodo];
  const minutos = minutosDa(livre.hora);
  return (
    (par.data === null || mesmaData(par.data, livre.data)) &&
    (par.hora === null || par.hora === livre.hora) &&
    minutos >= de &&
    minutos < ate
  );
}

// ---------------------------------------------------------------------------
// O par de toda frase (revisao 2 da AG2)
// ---------------------------------------------------------------------------

/**
 * Um trecho de fonte em que o dia e a hora valem JUNTOS: um objeto da saida
 * de uma ferramenta (o horario que buscar_horario trouxe, o reservado, o
 * marcado, a consulta lida), uma linha do horario de funcionamento, um
 * horario livre, uma frase de texto publicado ou, na frase que nega ou
 * pergunta, da mensagem do paciente. "Terca, 21/10 as 14:00" e "quinta,
 * 23/10 as 16:15" nao sustentam "quinta as 14h".
 */
type TrechoDaFonte = { datas: DataDaOferta[]; horas: ReadonlySet<string> };

/** "segunda a sexta", "de terca ate sabado": os dias do meio tambem. */
const ENTRE_DIAS_DA_FAIXA = /^\s*(?:a|ate)\s*$/;

/** O dia da semana escrito ou, com dia e mes, o do calendario. */
function semanaDaData(data: DataDaOferta, anoCorrente: number): number | null {
  if (data.semana !== null) {
    return data.semana;
  }
  if (data.dia === null || data.mes === null) {
    return null;
  }
  return new Date(
    Date.UTC(data.ano ?? anoCorrente, data.mes - 1, data.dia),
  ).getUTCDay();
}

/** O trecho de fonte JA NORMALIZADO, com os dias e as horas dele. */
function trechoDaFonte(
  base: string,
  hoje: DiaDaClinica | null,
): TrechoDaFonte | null {
  const partes = partesDaOferta(
    base,
    { inicio: 0, fim: base.length, texto: base },
    hoje,
    "fonte",
  );
  const horas = new Set(
    partes.flatMap((p) => (p.tipo === "hora" ? [p.hora] : [])),
  );
  const dias = partes.filter(
    (p): p is Extract<ParteDaOferta, { tipo: "data" }> => p.tipo === "data",
  );
  if (horas.size === 0 || dias.length === 0) {
    return null;
  }
  const datas: DataDaOferta[] = [];
  dias.forEach((parte, i) => {
    datas.push(parte.data);
    const seguinte = dias[i + 1];
    const deSemana = (d: DataDaOferta) => d.semana !== null && d.dia === null;
    if (
      seguinte !== undefined &&
      deSemana(parte.data) &&
      deSemana(seguinte.data) &&
      ENTRE_DIAS_DA_FAIXA.test(base.slice(parte.fim, seguinte.indice))
    ) {
      const ultimo = seguinte.data.semana ?? 0;
      for (
        let semana = ((parte.data.semana ?? 0) + 1) % 7;
        semana !== ultimo;
        semana = (semana + 1) % 7
      ) {
        datas.push({
          dia: null,
          mes: null,
          ano: null,
          semana,
          impossivel: false,
        });
      }
    }
  });
  return { datas, horas };
}

/** Os textos de uma saida de ferramenta: cada objeto e cada linha de lista. */
function textosDaSaida(saida: string): string[] | null {
  let lido: unknown;
  try {
    lido = JSON.parse(saida);
  } catch {
    return null;
  }
  const textos: string[] = [];
  const visitar = (valor: unknown, profundidade: number) => {
    if (profundidade > 6 || typeof valor !== "object" || valor === null) {
      return;
    }
    if (Array.isArray(valor)) {
      for (const item of valor) {
        if (typeof item === "string") {
          textos.push(item);
        } else {
          visitar(item, profundidade + 1);
        }
      }
      return;
    }
    const doObjeto: string[] = [];
    for (const item of Object.values(valor)) {
      if (typeof item === "string") {
        doObjeto.push(item);
      } else {
        visitar(item, profundidade + 1);
      }
    }
    if (doObjeto.length > 0) {
      textos.push(doObjeto.join(" ; "));
    }
  };
  visitar(lido, 0);
  return textos;
}

/** As frases de um texto JA NORMALIZADO, como trechos de fonte. */
function trechosDasFrases(
  base: string,
  hoje: DiaDaClinica | null,
): TrechoDaFonte[] {
  return frasesComPosicao(base).flatMap((frase) => {
    const trecho = trechoDaFonte(frase.texto, hoje);
    return trecho === null ? [] : [trecho];
  });
}

/**
 * Os trechos de onde o par vale: as saidas das ferramentas (cada objeto e
 * cada linha de lista; texto que nao e JSON, frase a frase), os horarios
 * livres e as frases dos textos publicados.
 */
function trechosDasFontes(fatos: FatosDoTurno): TrechoDaFonte[] {
  const trechos: TrechoDaFonte[] = [];
  const juntar = (texto: string) => {
    const trecho = trechoDaFonte(normalizarBase(texto), fatos.hoje);
    if (trecho !== null) {
      trechos.push(trecho);
    }
  };
  for (const saida of fatos.saidasDasFerramentas) {
    const textos = textosDaSaida(saida);
    if (textos === null) {
      trechos.push(...trechosDasFrases(normalizarBase(saida), fatos.hoje));
    } else {
      textos.forEach(juntar);
    }
  }
  for (const livre of fatos.horariosLivres) {
    juntar(`${livre.dia} ${livre.hora}`);
  }
  for (const texto of fatos.textosPublicados) {
    trechos.push(...trechosDasFrases(normalizarBase(texto), fatos.hoje));
  }
  return trechos;
}

function datasCompativeis(
  doRascunho: DataDaOferta,
  daFonte: DataDaOferta,
  anoCorrente: number,
): boolean {
  const semDia = (d: DataDaOferta) => d.dia === null || d.mes === null;
  if (
    (doRascunho.impossivel && semDia(doRascunho)) ||
    (daFonte.impossivel && semDia(daFonte))
  ) {
    return false;
  }
  const igual = (x: number | null, y: number | null) =>
    x === null || y === null || x === y;
  if (doRascunho.dia !== null && daFonte.dia !== null) {
    return (
      doRascunho.dia === daFonte.dia &&
      igual(doRascunho.mes, daFonte.mes) &&
      igual(doRascunho.ano, daFonte.ano) &&
      igual(doRascunho.semana, daFonte.semana)
    );
  }
  const semana = semanaDaData(doRascunho, anoCorrente);
  return semana !== null && semana === semanaDaData(daFonte, anoCorrente);
}

/** O par (dia e hora) da frase esta num trecho de fonte. */
function parNoTrecho(
  par: ParDaOferta,
  trecho: TrechoDaFonte,
  anoCorrente: number,
): boolean {
  const { data, hora } = par;
  return (
    data !== null &&
    hora !== null &&
    trecho.horas.has(hora) &&
    trecho.datas.some((d) => datasCompativeis(data, d, anoCorrente))
  );
}

// ---------------------------------------------------------------------------
// Endereco
// ---------------------------------------------------------------------------

/**
 * O tipo do logradouro, com a abreviacao. A abreviacao curta que e palavra
 * comum ("r", "al", "rod") so vale com o ponto; "av" e "pca" valem sem.
 */
const TIPOS_DE_LOGRADOURO: ReadonlyMap<string, string> = new Map([
  ["rua", "rua"],
  ["r.", "rua"],
  ["avenida", "avenida"],
  ["av", "avenida"],
  ["av.", "avenida"],
  ["travessa", "travessa"],
  ["trav.", "travessa"],
  ["tv.", "travessa"],
  ["alameda", "alameda"],
  ["al.", "alameda"],
  ["rodovia", "rodovia"],
  ["rod.", "rodovia"],
  ["praca", "praca"],
  ["pca", "praca"],
  ["pca.", "praca"],
  ["estrada", "estrada"],
  ["estr.", "estrada"],
  ["largo", "largo"],
  ["ladeira", "ladeira"],
  ["beco", "beco"],
  ["viela", "viela"],
]);

/** Palavras do nome que nao distinguem ("Rua DAS Flores"). */
const LIGACOES_DO_NOME: ReadonlySet<string> = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "d'",
]);

/** O que vem antes do numero da porta ("no 1500", "n. 1500", "numero 1500"). */
const ANTES_DO_NUMERO: ReadonlySet<string> = new Set([
  "n",
  "n.",
  "no",
  "no.",
  "n°",
  "numero",
]);

/** Numero que e medida, andar ou quantidade, nao numero da porta. */
const UNIDADE_DEPOIS_DO_NUMERO =
  /^(?:metros?|m|km|quilometros?|minutos?|min|horas?|h|andar|andares|o|a|reais|%|x|vezes|dias?|semanas?|meses|anos?|vagas?|salas?|pessoas?)$/;

/** Quantas palavras de nome, no maximo, entre o tipo e o numero. */
const MAXIMO_DE_PALAVRAS_DO_NOME = 8;

export type EnderecoLido = {
  tipo: string;
  /** As palavras do nome, sem as de ligacao (abreviacao termina em "."). */
  nome: string[];
  numero: string;
};

type EnderecoComPosicao = EnderecoLido & { inicio: number; fim: number };

/**
 * Pontuacao da borda da palavra, guardando o ponto da abreviacao ("av.",
 * "dr."); o ponto final do numero sai ("1500." e o fim da frase).
 */
function nucleo(token: string): string {
  const semBorda = token.replace(/^[("'[]+/, "").replace(/[,;:!?)"'\]]+$/, "");
  return /^\d{1,5}[a-z]?\.$/.test(semBorda) ? semBorda.slice(0, -1) : semBorda;
}

function ehNumeroDaPorta(texto: string): boolean {
  return /^\d{1,5}[a-z]?$/.test(texto);
}

/** "Dr.", "Eng.", "Av.": ponto de abreviacao, nao fim de frase. */
function ehAbreviacao(texto: string): boolean {
  return /^[a-z]{1,4}\.$/.test(texto);
}

type Palavra = { texto: string; inicio: number; fim: number };

/** O fim do nucleo da palavra no texto ("1500," termina antes da virgula). */
function fimDoNucleo(palavra: Palavra): number {
  const miolo = nucleo(palavra.texto);
  const onde = palavra.texto.indexOf(miolo);
  return onde === -1 ? palavra.fim : palavra.inicio + onde + miolo.length;
}

/**
 * Os logradouros com numero de um texto JA NORMALIZADO, com o trecho do
 * tipo ao numero.
 */
function enderecosComPosicao(base: string): EnderecoComPosicao[] {
  const tokens: Palavra[] = Array.from(base.matchAll(/\S+/g), (m) => ({
    texto: m[0],
    inicio: m.index ?? 0,
    fim: (m.index ?? 0) + m[0].length,
  }));
  const texto = (indice: number) => tokens[indice]?.texto ?? "";
  const enderecos: EnderecoComPosicao[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tipo = TIPOS_DE_LOGRADOURO.get(nucleo(texto(i)));
    if (tipo === undefined) {
      continue;
    }
    const nome: string[] = [];
    let numero: string | null = null;
    let ultimo = i;
    for (let j = i + 1; j < tokens.length; j += 1) {
      const anterior = texto(j - 1);
      if (j > i + 1) {
        // Fim de frase encerra a busca; o ponto de abreviacao, nao.
        if (/[!?;]$/.test(anterior)) {
          break;
        }
        const semVirgula = anterior.replace(/[,)"']+$/, "");
        if (semVirgula.endsWith(".") && !ehAbreviacao(semVirgula)) {
          break;
        }
      }
      const token = nucleo(texto(j));
      const seguinte = nucleo(texto(j + 1));
      const depoisDoSeguinte = nucleo(texto(j + 2));
      if (token === "") {
        continue;
      }
      if (/^(?:s\/n[o.]?|sn)$/.test(token)) {
        numero = "sn";
        ultimo = j;
        break;
      }
      if (token === "km" && ehNumeroDaPorta(seguinte)) {
        numero = `km${seguinte}`;
        ultimo = j + 1;
        break;
      }
      if (ANTES_DO_NUMERO.has(token) && ehNumeroDaPorta(seguinte)) {
        numero = seguinte;
        ultimo = j + 1;
        break;
      }
      if (ehNumeroDaPorta(token)) {
        // "7 de Setembro": o numero e parte do nome.
        if (
          seguinte === "de" &&
          (MESES as readonly string[]).includes(depoisDoSeguinte)
        ) {
          nome.push(token, depoisDoSeguinte);
          j += 2;
          continue;
        }
        // "Rua 15, 230" e "Rua 15, no 230": o primeiro numero e o nome.
        if (
          /,$/.test(texto(j)) &&
          (ehNumeroDaPorta(seguinte) ||
            (ANTES_DO_NUMERO.has(seguinte) &&
              ehNumeroDaPorta(depoisDoSeguinte)))
        ) {
          nome.push(token);
          continue;
        }
        // "1500, sala 302": com a virgula, o que vem depois e o
        // complemento. Sem ela, "300 metros" e "3 salas" sao medida.
        if (/,$/.test(texto(j)) || !UNIDADE_DEPOIS_DO_NUMERO.test(seguinte)) {
          numero = token;
          ultimo = j;
        }
        break;
      }
      if (!/[a-z]/.test(token)) {
        break;
      }
      if (!LIGACOES_DO_NOME.has(token)) {
        nome.push(token);
      }
      if (nome.length > MAXIMO_DE_PALAVRAS_DO_NOME) {
        break;
      }
    }
    const primeiro = tokens[i];
    const final = tokens[ultimo];
    if (
      numero !== null &&
      nome.length > 0 &&
      primeiro !== undefined &&
      final !== undefined
    ) {
      enderecos.push({
        tipo,
        nome,
        numero,
        inicio: primeiro.inicio,
        fim: fimDoNucleo(final),
      });
    }
  }
  return enderecos;
}

/**
 * Os logradouros com numero de um texto JA NORMALIZADO (normalizarBase, sem
 * mascara): "Av. Santos Dumont, 1500", "Rua 7 de Setembro, 45", "Rodovia
 * CE-040, km 12", "Rua X, s/n". Sem numero nao e lido: a regra e sobre o
 * endereco que leva a pessoa a uma porta.
 */
export function enderecosDoTexto(base: string): EnderecoLido[] {
  return enderecosComPosicao(base).map(({ tipo, nome, numero }) => ({
    tipo,
    nome,
    numero,
  }));
}

/**
 * Revisao 2 da AG2: as frases dos textos (ja normalizadas) que trazem
 * logradouro com numero. O resumo dos fatos do verificador leva as dos
 * textos publicados (resumo-dos-fatos.ts).
 */
export function frasesComEndereco(textos: readonly string[]): string[] {
  return textos.flatMap((texto) =>
    frasesComPosicao(normalizarBase(texto))
      .map((frase) => frase.texto.trim())
      .filter((frase) => enderecosDoTexto(frase).length > 0),
  );
}

function palavraBate(doRascunho: string, doFato: string): boolean {
  const r = doRascunho.replace(/\.$/, "");
  const f = doFato.replace(/\.$/, "");
  if (r === f) {
    return true;
  }
  // Abreviacao de um lado ("Eng." e "Engenheiro").
  if (doRascunho.endsWith(".") && f.startsWith(r)) {
    return true;
  }
  return doFato.endsWith(".") && r.startsWith(f);
}

/**
 * O endereco do rascunho esta nos fatos: o mesmo tipo, o mesmo numero e
 * toda palavra do nome no nome do fato (pode faltar palavra, nunca sobrar).
 */
function enderecoNosFatos(
  endereco: EnderecoLido,
  fatos: readonly EnderecoLido[],
): boolean {
  return fatos.some(
    (f) =>
      f.tipo === endereco.tipo &&
      f.numero === endereco.numero &&
      endereco.nome.every((palavra) =>
        f.nome.some((doFato) => palavraBate(palavra, doFato)),
      ),
  );
}

/** Na saida da ferramenta, a pontuacao do JSON vira espaco. */
function semPontuacaoDoJson(texto: string): string {
  return texto.replace(/["{}[\]:]/g, " ");
}

function enderecosDasFontes(textos: readonly string[]): EnderecoLido[] {
  return textos.flatMap((texto) =>
    enderecosDoTexto(normalizarBase(semPontuacaoDoJson(texto))),
  );
}

/**
 * Os campos de texto com estas chaves ("endereco"; desde a revisao 2,
 * tambem "bairro" e "cidade") de uma saida de ferramenta em JSON.
 */
function camposDaSaida(saida: string, chaves: ReadonlySet<string>): string[] {
  let lido: unknown;
  try {
    lido = JSON.parse(saida);
  } catch {
    return [];
  }
  const achados: string[] = [];
  const visitar = (valor: unknown, profundidade: number) => {
    if (profundidade > 6 || typeof valor !== "object" || valor === null) {
      return;
    }
    if (Array.isArray(valor)) {
      for (const item of valor) {
        visitar(item, profundidade + 1);
      }
      return;
    }
    for (const [chave, item] of Object.entries(valor)) {
      if (chaves.has(chave) && typeof item === "string") {
        achados.push(item);
      } else {
        visitar(item, profundidade + 1);
      }
    }
  };
  visitar(lido, 0);
  return achados;
}

const CAMPOS_DE_ENDERECO: ReadonlySet<string> = new Set(["endereco"]);
const CAMPOS_DE_LUGAR: ReadonlySet<string> = new Set(["bairro", "cidade"]);

/**
 * Revisao 2 da AG2: a parte do endereco da ferramenta (bairro, cidade) que
 * vale como nome de lugar no rascunho: pelo menos duas palavras de nome
 * (sem "de", "da", "dos"...), para uma palavra solta ("Dores") nunca sair
 * das vedacoes clinicas, e a palavra clinica de lugar so como a ultima
 * ("Nossa Senhora dos Remedios" vale; "Remedios do Norte" nao).
 */
function parteQueENomeDeLugar(parte: string): boolean {
  const palavras = palavrasDe(parte);
  const deNome = palavras.filter(
    (p) => !LIGACOES_DO_NOME.has(p) && p.length >= 2,
  );
  return (
    deNome.length >= 2 &&
    palavras.slice(0, -1).every((p) => !PALAVRAS_CLINICAS_DE_LUGAR.has(p))
  );
}

/**
 * Palavras que as regras clinicas leem como sintoma ou remedio e que sao
 * nome de lugar no Brasil ("Rua das Dores", "Nossa Senhora dos Remedios",
 * "Bairro das Dores"). Lista fechada e curta, ja sem acento: e a unica
 * excecao que o endereco do Cadastro ganha, e so como a ULTIMA palavra do
 * nome (cadastro-do-agente.ts troca a ultima palavra por uma neutra no
 * logradouro, no bairro e na cidade e confere o endereco inteiro de novo;
 * "Rua Tome Dipirona" e "Rua Dores de Cabeca Passam" continuam fora).
 */
export const PALAVRAS_CLINICAS_DE_NOME_DE_LUGAR: readonly string[] = [
  "dor",
  "dores",
  "remedio",
  "remedios",
];
const PALAVRAS_CLINICAS_DE_LUGAR: ReadonlySet<string> = new Set(
  PALAVRAS_CLINICAS_DE_NOME_DE_LUGAR,
);

/**
 * O nome de lugar com a ULTIMA palavra trocada por "Lugar" quando ela esta
 * em PALAVRAS_CLINICAS_DE_NOME_DE_LUGAR ("Rua das Dores" vira "Rua das
 * Lugar"), para conferir o texto inteiro com as regras de sempre. A palavra
 * no meio do nome fica como esta (e continua barrando).
 */
export function semPalavrasClinicasDeLugar(texto: string): string {
  return texto.replace(
    /(\p{L}+)(\P{L}*)$/u,
    (inteiro, palavra: string, resto: string) =>
      PALAVRAS_CLINICAS_DE_LUGAR.has(normalizarBase(palavra))
        ? `Lugar${resto}`
        : inteiro,
  );
}

/**
 * Os trechos do rascunho (ja normalizados) que sao o endereco que uma
 * ferramenta do turno trouxe (consultar_unidades): o campo "endereco"
 * inteiro, quando o rascunho o repete, o logradouro com o numero que bate
 * com um endereco dela ("Rua das Dores, 100") e, desde a revisao 2, o
 * bairro e a cidade que ela trouxe em campos proprios, quando o rascunho os
 * cita ("fica em Nossa Senhora dos Remedios"; parteQueENomeDeLugar). Sao
 * nome de lugar: o filtro
 * deterministico (filtro-deterministico.ts) tira estes trechos so das
 * vedacoes clinicas que a mascara do catalogo cobre, e o resto do rascunho
 * continua lido ("Rua das Dores, 100. Tome dipirona" barra). O endereco da
 * ferramenta ja passou pelas regras do filtro no carregamento, com a unica
 * excecao de PALAVRAS_CLINICAS_DE_NOME_DE_LUGAR.
 */
export function trechosDeEnderecoDasFerramentas(
  rascunho: string,
  fatos: FatosDoTurno,
): string[] {
  const base = normalizarBase(rascunho);
  const citado = (trecho: string) =>
    trecho.length >= 3 &&
    new RegExp(`(?<![a-z0-9])${escaparRegex(trecho)}(?![a-z0-9])`).test(base);
  const completos = fatos.saidasDasFerramentas
    .flatMap((saida) => camposDaSaida(saida, CAMPOS_DE_ENDERECO))
    .map((endereco) => normalizarBase(endereco))
    .filter(citado);
  const dasFerramentas = enderecosDasFontes(fatos.saidasDasFerramentas);
  const logradouros = enderecosComPosicao(base)
    .filter((e) => enderecoNosFatos(e, dasFerramentas))
    .map((e) => base.slice(e.inicio, e.fim));
  const lugares = fatos.saidasDasFerramentas
    .flatMap((saida) => camposDaSaida(saida, CAMPOS_DE_LUGAR))
    .map((parte) => normalizarBase(parte))
    .filter((parte) => parteQueENomeDeLugar(parte) && citado(parte));
  return [...new Set([...completos, ...logradouros, ...lugares])];
}

// ---------------------------------------------------------------------------
// Acao e estado da consulta
// ---------------------------------------------------------------------------

function alternativas(termos: readonly string[]): string {
  return `(?:${termos.join("|")})`;
}

/**
 * O objeto da agenda ("sua consulta", "seu horario") e o marcador do nome
 * do catalogo mascarado. O marcador nao e letra: antes dele, a fronteira e
 * "(?<![a-z0-9])", nunca a de palavra.
 */
const OBJETOS_DA_AGENDA = [
  "consulta",
  "consultas",
  "horario",
  "agendamento",
  "atendimento",
  "retorno",
  "sessao",
  "avaliacao",
  "procedimento",
  "reserva",
  "vaga",
  "\\u00a7",
];
const OBJETO = alternativas(OBJETOS_DA_AGENDA);
/** A consulta como compromisso da pessoa (sem horario, vaga e reserva). */
const CONSULTA = alternativas([
  "consulta",
  "retorno",
  "sessao",
  "avaliacao",
  "procedimento",
  "agendamento",
  "atendimento",
  "\\u00a7",
]);
/** O compromisso com o possessivo: tambem "seu horario" (revisao da AG2). */
const CONSULTA_OU_HORARIO = alternativas([CONSULTA, "horarios?"]);
/**
 * O objeto da agenda no singular, sem artigo, no comeco da frase
 * ("Consulta cancelada", "Horario marcado: ..."). O plural sem artigo e
 * regra ("Consultas canceladas em cima da hora sao cobradas").
 */
const OBJETO_NO_SINGULAR = alternativas([
  "consulta",
  "horario",
  "agendamento",
  "atendimento",
  "retorno",
  "sessao",
  "avaliacao",
  "procedimento",
  "reserva",
  "vaga",
  "presenca",
  "\\u00a7",
]);
const POSSESSIVO = "(?:(?:o|a)\\s+)?(?:seu|sua|teu|tua)";
/** O auxiliar que diz que a coisa ja aconteceu ("ficou marcada"). */
const JA_ACONTECEU = [
  "ficou",
  "ficaram",
  "foi",
  "foram",
  "ja foi",
  "ja foram",
  "acabou de ser",
  "acabaram de ser",
];
/** O auxiliar do estado ("esta marcada"). */
const ESTA = [
  "esta",
  "estao",
  "ta",
  "ja esta",
  "ja estao",
  "continua",
  "segue",
];
const FEITO = "(?:feit|realizad|concluid|efetuad)[oa]s?";
/**
 * Revisao curta das correcoes da AG3 (achado 3): o horario "ja foi marcado
 * por outra pessoa" ou "esta reservado para outro paciente" e o horario
 * ocupado, nao a acao da assistente.
 */
const POR_OUTRA_PESSOA =
  "(?!\\s+(?:por|para|pra)\\s+(?:(?:um|uma)\\s+)?(?:outr[oa]s?\\s+(?:pessoas?|pacientes?|clientes?)|alguem)\\b)";
/**
 * "O sabado fica reservado para retornos" e regra da agenda, nao a reserva
 * de 10 minutos (nem "reservado para outra pessoa", revisao curta das
 * correcoes da AG3).
 */
const RESERVA_QUE_E_REGRA = `(?!\\s+(?:para|pra|aos?|as?)\\s+(?:os\\s+|as\\s+)?(?:retornos?|pacientes?|convenios?|urgencias?|encaixes?|procedimentos?|cirurgias?|exames?|avaliac\\w*|criancas?|idosos?|gestantes?)\\b)${POR_OUTRA_PESSOA}`;
/**
 * O comeco da frase, com as interjeicoes de quem acabou de fazer ("Pronto,
 * cancelada", "Prontinho! Agendado", "Ok, consulta marcada") e o "ja" e o
 * "tudo" ("Ja agendado", "Tudo marcado").
 */
const NO_COMECO_DA_FRASE =
  "(?<=(?:^|[.!?;:])\\s*)(?:(?:pronto|prontinho|prontissimo|feito|perfeito|tudo certo|tudo pronto|tudo ok|certo|certinho|ok|okay|otimo|combinado|beleza|show|maravilha|excelente|isso|entao|sim|claro|oba|legal|muito bem|bom)\\s*[,!.]*\\s+)*(?:ja\\s+)?(?:tudo\\s+)?";
/** O objeto sem artigo antes do participio ("Consulta com a Dra. Ana marcada"). */
const OBJETO_ANTES_DO_PARTICIPIO = `(?:${OBJETO_NO_SINGULAR}(?:\\s+(?:de|do|da|com)\\s+(?:\\S+\\s+){0,2}?)?\\s+)?`;
/**
 * O participio que descreve a regra, e nao a acao ("Cancelada com menos de
 * 24 horas, a consulta e cobrada", "Agendado so depois da sua
 * confirmacao").
 */
const PARTICIPIO_DA_REGRA =
  "(?!\\s+(?:com\\s+(?:menos|mais|antecedencia|no minimo|pelo menos|ate|\\d)|em cima da hora|fora do prazo|sem aviso|sem antecedencia|no mesmo dia|ate\\s+\\d|so\\s+(?:depois|quando|apos|com)|apos\\b|depois\\b|quando\\b|assim que|antes\\s+d|(?:pelo|pela|por)\\s+(?:whatsapp|site|app|aplicativo|telefone|internet|aqui)\\s+(?:precisa|precisam|fica|ficam|passa|passam|depende|dependem|tem|e|sao|sera|serao)\\b))";

/**
 * Revisao final da AG3: o que a frase afirma da agenda, com a ferramenta
 * que sustenta: a acao do padrao ou o estado da consulta.
 */
type AlegacaoDaFrase = AcaoDoTurno | "estado";

type PadraoDeAcao = {
  nome: string;
  /** null: o estado da consulta (vale com consultaLida ou marcou). */
  acao: AcaoDoTurno | null;
  regex: RegExp;
  /**
   * Revisao curta das correcoes da AG3 (achado 6): o verbo so afirma a acao
   * com a agenda na frase (dia, hora, "horario", "vaga", "agenda"):
   * "Separei quarta as 14h" afirma; "Separei as informacoes" nao.
   */
  soComAgendaNaFrase: boolean;
};

function padraoDeAcao(
  nome: string,
  alvo: AcaoDoTurno | null,
  fonte: string,
  soComAgendaNaFrase = false,
): PadraoDeAcao {
  return {
    nome,
    acao: alvo,
    regex: new RegExp(fonte, "g"),
    soComAgendaNaFrase,
  };
}

/** A agenda na frase, para os verbos que so afirmam com ela. */
const AGENDA_NA_FRASE = /\b(?:horarios?|vagas?|agenda|encaixes?)\b/;
/**
 * O que se separa ou se guarda e nao e horario ("Guardei seu contato",
 * "Separei as informacoes", "Bloqueei o numero").
 */
const NAO_E_HORARIO_GUARDADO =
  "(?!\\s+(?:(?:os|as|o|a|seus|suas|seu|sua|teus|tuas|teu|tua|todos|todas|esses|essas|estes|estas|um|uma|aqui)\\s+){0,2}(?:dados?|nomes?|data|nascimento|cpf|carteirinha|informac\\w*|documentos?|contatos?|telefones?|e-?mails?|numeros?|enderecos?|pedidos?|exames?|fotos?|materia\\w*|lembretes?|recados?|mensage\\w*|duvidas?|perguntas?|respostas?|anotac\\w*|observac\\w*|preferencias?|orcamentos?|valores?|precos?|links?)\\b)";

/** O participio no comeco da frase, com ou sem o objeto. */
function participioNoComeco(participio: string, depois = ""): string {
  return `${NO_COMECO_DA_FRASE}${OBJETO_ANTES_DO_PARTICIPIO}${participio}[oa]s?\\b${depois}${PARTICIPIO_DA_REGRA}`;
}

const PADROES_DE_ACAO: readonly PadraoDeAcao[] = [
  // Marcar.
  padraoDeAcao(
    "marcacao",
    "marcou",
    "\\b(?:marquei|agendei|acabei de marcar|acabei de agendar)\\b",
  ),
  padraoDeAcao(
    "marcacao",
    "marcou",
    `\\b(?:marcamos|agendamos)\\s+${POSSESSIVO}\\b`,
  ),
  padraoDeAcao(
    "marcacao",
    "marcou",
    `\\b${alternativas(JA_ACONTECEU)}\\s+(?:\\w+\\s+)?(?:marcad|agendad)[oa]s?\\b${POR_OUTRA_PESSOA}`,
  ),
  padraoDeAcao(
    "marcacao",
    "marcou",
    `\\b(?:agendamento|marcacao)\\s+(?:foi\\s+|ja foi\\s+|esta\\s+|ficou\\s+)?${FEITO}\\b`,
  ),
  padraoDeAcao(
    "marcacao",
    "marcou",
    `(?<![a-z0-9])${OBJETO}\\s+(?:marcad|agendad)[oa]s?\\s+com\\s+sucesso\\b`,
  ),
  padraoDeAcao(
    "marcacao",
    "marcou",
    `(?:^|[.!?]\\s*)(?:pronto|prontinho|feito|tudo certo|perfeito)[,!.]?\\s+(?:${POSSESSIVO}\\s+)?(?:${OBJETO}\\s+)?(?:marcad|agendad)[oa]s?\\b`,
  ),
  // Revisao da AG2: "Ja deixei agendado", "deixamos tudo marcado".
  padraoDeAcao(
    "marcacao",
    "marcou",
    "\\b(?:deixei|deixamos)\\s+(?:\\S+\\s+){0,2}?(?:marcad|agendad)[oa]s?\\b",
  ),
  // Revisao da AG2: o participio no comeco da frase ("Agendado!", "Consulta
  // marcada para quinta", "Horario marcado: ..."). E o estado da consulta:
  // vale com a consulta marcada neste turno ou lida por ferramenta.
  padraoDeAcao(
    "marcacao",
    null,
    participioNoComeco("(?:marcad|agendad)", POR_OUTRA_PESSOA),
  ),
  // Reservar.
  padraoDeAcao("reserva", "reservou", "\\b(?:reservei|segurei)\\b"),
  padraoDeAcao(
    "reserva",
    "reservou",
    `\\b(?:reservamos|seguramos)\\s+${POSSESSIVO}\\b`,
  ),
  padraoDeAcao(
    "reserva",
    "reservou",
    `\\b${alternativas([...JA_ACONTECEU, ...ESTA, "fica", "ficara", "vai ficar", "deixei", "deixamos"])}\\s+(?:\\w+\\s+){0,2}reservad[oa]s?\\b${RESERVA_QUE_E_REGRA}`,
  ),
  padraoDeAcao(
    "reserva",
    "reservou",
    participioNoComeco("reservad", RESERVA_QUE_E_REGRA),
  ),
  // Confirmar presenca.
  padraoDeAcao(
    "confirmacao",
    "confirmou_presenca",
    "\\bconfirmei\\b(?!\\s+com\\b)",
  ),
  padraoDeAcao(
    "confirmacao",
    "confirmou_presenca",
    `\\bconfirmamos\\s+${POSSESSIVO}\\b`,
  ),
  padraoDeAcao(
    "confirmacao",
    "confirmou_presenca",
    `\\b${alternativas([...JA_ACONTECEU, ...ESTA])}\\s+(?:\\w+\\s+)?confirmad[oa]s?\\b`,
  ),
  padraoDeAcao(
    "confirmacao",
    "confirmou_presenca",
    `(?<![a-z0-9])${alternativas(["presenca", ...OBJETOS_DA_AGENDA])}\\s+confirmad[oa]s?\\b`,
  ),
  padraoDeAcao(
    "confirmacao",
    "confirmou_presenca",
    participioNoComeco("confirmad"),
  ),
  padraoDeAcao(
    "confirmacao",
    "confirmou_presenca",
    `\\bconfirmo\\s+(?:entao\\s+)?(?:para|pra|${POSSESSIVO}|o horario|a consulta|a presenca)\\b`,
  ),
  // Cancelar.
  padraoDeAcao("cancelamento", "cancelou", "\\b(?:cancelei|desmarquei)\\b"),
  padraoDeAcao(
    "cancelamento",
    "cancelou",
    `\\b(?:cancelamos|desmarcamos)\\s+${POSSESSIVO}\\b`,
  ),
  padraoDeAcao(
    "cancelamento",
    "cancelou",
    `\\b${alternativas([...JA_ACONTECEU, ...ESTA])}\\s+(?:\\w+\\s+)?(?:cancelad|desmarcad)[oa]s?\\b`,
  ),
  padraoDeAcao(
    "cancelamento",
    "cancelou",
    `\\b(?:cancelamento|desmarcacao)\\s+(?:foi\\s+|ja foi\\s+|esta\\s+|ficou\\s+)?(?:${FEITO}|confirmad[oa]s?)\\b`,
  ),
  // Revisao da AG2: "Cancelado, Maria", "Consulta cancelada", "Pronto,
  // cancelada".
  padraoDeAcao(
    "cancelamento",
    "cancelou",
    participioNoComeco("(?:cancelad|desmarcad)"),
  ),
  // Remarcar.
  padraoDeAcao(
    "remarcacao",
    "remarcou",
    "\\b(?:remarquei|reagendei|mudei (?:a|o) (?:sua|seu)|transferi (?:a|o) (?:sua|seu))\\b",
  ),
  padraoDeAcao(
    "remarcacao",
    "remarcou",
    `\\b(?:remarcamos|reagendamos)\\s+${POSSESSIVO}\\b`,
  ),
  padraoDeAcao(
    "remarcacao",
    "remarcou",
    `\\b${alternativas([...JA_ACONTECEU, ...ESTA])}\\s+(?:\\w+\\s+)?(?:remarcad|reagendad)[oa]s?\\b`,
  ),
  padraoDeAcao(
    "remarcacao",
    "remarcou",
    `\\b(?:remarcacao|reagendamento)\\s+(?:foi\\s+|ja foi\\s+|esta\\s+|ficou\\s+)?(?:${FEITO}|confirmad[oa]s?)\\b`,
  ),
  // Revisao da AG2: "Remarcado para quinta".
  padraoDeAcao(
    "remarcacao",
    "remarcou",
    participioNoComeco("(?:remarcad|reagendad)"),
  ),
  // Lista de espera.
  padraoDeAcao(
    "lista_de_espera",
    "lista_de_espera",
    "\\b(?:coloquei|inclui|adicionei|botei|anotei|cadastrei|inscrevi|registrei|pus|incluimos|colocamos|adicionamos|anotamos|cadastramos)\\s+(?:\\S+\\s+){0,3}?(?:na|em)\\s+(?:nossa\\s+|a\\s+)?lista de espera\\b",
  ),
  padraoDeAcao(
    "lista_de_espera",
    "lista_de_espera",
    "\\b(?:esta|estao|ta|ficou|ja esta|entrou|entrei|foi (?:incluid|colocad|adicionad|anotad)[oa])\\s+(?:\\S+\\s+){0,2}?(?:na|para a)\\s+(?:nossa\\s+)?lista de espera\\b",
  ),
  // Revisao 2 da AG2: as formas que passavam.
  // "Sua consulta foi para a lista de espera", "vai para a lista de espera".
  padraoDeAcao(
    "lista_de_espera",
    "lista_de_espera",
    "\\b(?:foi|foram|ja foi|vai|vao|passou|passaram|seguiu)\\s+(?:\\S+\\s+){0,2}?(?:para a|pra|para|na|a)\\s+(?:nossa\\s+)?lista de espera\\b",
  ),
  // "Ja coloquei voce na agenda de quinta", "anotei na agenda da Dra. Ana".
  padraoDeAcao(
    "marcacao",
    "marcou",
    "\\b(?:coloquei|colocamos|inclui|incluimos|botei|botamos|pus|pusemos|encaixei|encaixamos|registrei|registramos|anotei|anotamos|adicionei|adicionamos|inseri|inserimos|lancei|lancamos)\\s+(?:\\S+\\s+){0,3}?(?:na|em|para a|pra)\\s+(?:\\S+\\s+)?agenda\\b",
  ),
  // "Consegui encaixar voce na quinta", "consegui marcar".
  padraoDeAcao(
    "marcacao",
    "marcou",
    "\\bconsegui(?:mos)?\\s+(?:te\\s+|lhe\\s+)?(?:encaixar|marcar|agendar)\\b",
  ),
  padraoDeAcao(
    "reserva",
    "reservou",
    "\\bconsegui(?:mos)?\\s+(?:te\\s+|lhe\\s+)?(?:reservar|segurar)\\b",
  ),
  // Revisao curta das correcoes da AG3 (achado 6): separar, guardar e
  // bloquear o horario sao a reserva ("Separei quarta as 14h para voce",
  // "Ja deixei separado quarta as 14h", "Bloqueei a agenda de quarta"), so
  // com a agenda na frase e fora do dado ("Guardei seu contato").
  padraoDeAcao(
    "reserva",
    "reservou",
    `\\b(?:separei|guardei|bloqueei|separamos|guardamos|bloqueamos)\\b${NAO_E_HORARIO_GUARDADO}`,
    true,
  ),
  padraoDeAcao(
    "reserva",
    "reservou",
    "\\b(?:deixei|deixamos)\\s+(?:\\S+\\s+){0,2}?(?:separad|guardad|bloquead)[oa]s?\\b",
    true,
  ),
  padraoDeAcao(
    "reserva",
    "reservou",
    `\\bconsegui(?:mos)?\\s+(?:te\\s+|lhe\\s+)?(?:separar|guardar|bloquear)\\b${NAO_E_HORARIO_GUARDADO}`,
    true,
  ),
  padraoDeAcao(
    "cancelamento",
    "cancelou",
    "\\bconsegui(?:mos)?\\s+(?:te\\s+|lhe\\s+)?(?:cancelar|desmarcar)\\b",
  ),
  padraoDeAcao(
    "remarcacao",
    "remarcou",
    "\\bconsegui(?:mos)?\\s+(?:te\\s+|lhe\\s+)?(?:remarcar|reagendar|mudar|transferir)\\b",
  ),
  // "Encaixei voce", "encaixamos sua consulta": encaixar e marcar.
  padraoDeAcao("marcacao", "marcou", "\\b(?:encaixei|encaixamos)\\b"),
  // "Seu horario foi registrado", "sua consulta ficou anotada".
  padraoDeAcao(
    "marcacao",
    "marcou",
    `\\b${POSSESSIVO}\\s+${CONSULTA_OU_HORARIO}\\s+(?:\\S+\\s+){0,6}?${alternativas([...JA_ACONTECEU, ...ESTA])}\\s+(?:\\w+\\s+)?(?:registrad|anotad|garantid|lancad|inserid|encaixad)[oa]s?\\b`,
  ),
  // "Ja tirei sua consulta da agenda", "removi voce da agenda".
  padraoDeAcao(
    "cancelamento",
    "cancelou",
    "\\b(?:tirei|retirei|removi|exclui|apaguei|tiramos|retiramos|removemos|excluimos|apagamos)\\s+(?:\\S+\\s+){0,3}?(?:da|de)\\s+(?:\\S+\\s+)?agenda\\b",
  ),
  // O estado da consulta que ja existia (fora de pergunta: "voce tem
  // consulta amanha?" pergunta, nao afirma). Sem "horario" e "vaga" no
  // "voce tem": "voce tem horario amanha" e oferta.
  padraoDeAcao(
    "consulta_existente",
    null,
    `\\b${POSSESSIVO}\\s+${CONSULTA_OU_HORARIO}\\s+(?:\\S+\\s+){0,6}?${alternativas(ESTA)}\\s+(?:\\w+\\s+)?(?:marcad|agendad)[oa]s?\\b`,
  ),
  padraoDeAcao(
    "consulta_existente",
    null,
    `\\b${POSSESSIVO}\\s+${CONSULTA_OU_HORARIO}\\s+(?:marcad|agendad)[oa]s?\\s+(?:para|pra|no|na|em|dia|as|amanha|hoje)\\b`,
  ),
  // Revisao final da AG3: tambem com o complemento no meio ("voce ja tem
  // uma consulta desse procedimento marcada para terca").
  padraoDeAcao(
    "consulta_existente",
    null,
    `\\b(?:voce|vc|a senhora|o senhor)\\s+(?:ja\\s+)?tem\\s+(?:uma\\s+)?${CONSULTA}\\s+(?:(?:desse|deste|do|da|de|com|nesse|neste|nessa|nesta)\\s+(?:\\S+\\s+){0,2}?)?(?:marcad[oa]|agendad[oa]|amanha|hoje|depois de amanha|na\\b|no\\b|dia\\b|as\\b|para\\b|pra\\b)`,
  ),
  // Revisao da AG2: "Esta agendado para quinta", "Ta marcado", "Ja esta
  // tudo marcado" (sem o possessivo), "voce tem horario marcado" e "A
  // consulta marcada para quinta ...".
  padraoDeAcao(
    "consulta_existente",
    null,
    `\\b${alternativas(ESTA)}\\s+(?:(?:tudo|ja|certinho|bem|sim)\\s+)?(?:marcad|agendad)[oa]s?\\b${POR_OUTRA_PESSOA}`,
  ),
  padraoDeAcao(
    "consulta_existente",
    null,
    "\\b(?:voce|vc|a senhora|o senhor)\\s+(?:ja\\s+)?tem\\s+(?:um\\s+)?horario\\s+(?:marcad|agendad)o\\b",
  ),
  // "Fica marcado para terca", fora da condicao ("assim que voce
  // confirmar, fica marcado" descreve o fluxo).
  padraoDeAcao(
    "consulta_existente",
    null,
    "(?<!\\b(?:se|assim que|quando|depois que|apos|caso|logo que)\\b[^.!?]{0,40})\\b(?:fica|ficara|vai ficar)\\s+(?:tudo\\s+|ja\\s+)?(?:marcad|agendad)[oa]s?\\b",
  ),
  // Revisao 2 da AG2: "Sua consulta ficou para quinta", "seu horario esta
  // para amanha", "prontinho, sua consulta ficou para amanha as 8h".
  padraoDeAcao(
    "consulta_existente",
    null,
    `\\b${POSSESSIVO}\\s+${CONSULTA_OU_HORARIO}\\s+(?:\\S+\\s+){0,4}?(?:ficou|ficaram|fica|ficara|vai ficar|esta|estao|ta|ja esta|continua|segue|foi|foram)\\s+(?:(?:tudo|entao|certinho|mesmo|marcad[oa]|agendad[oa]|remarcad[oa])\\s+)?(?:para|pra)\\b(?!\\s+(?:a\\s+)?(?:nossa\\s+)?lista de espera\\b)`,
  ),
  padraoDeAcao(
    "consulta_existente",
    null,
    `(?<=(?:^|[.!?;:])\\s*)(?:a|o)\\s+${OBJETO_NO_SINGULAR}\\s+(?:marcad|agendad)[oa]\\s+(?:para|pra|no|na|em|dia|as|amanha|hoje)\\b`,
  ),
  // Revisao curta das correcoes da AG3 (achados 4 e 6): o procedimento dito
  // em parte, que a mascara do catalogo nao cobre, no comeco da frase com o
  // dia ou a hora ("Limpeza marcada para terca as 14h", "Pronto! Limpeza
  // facial agendada para amanha"). "Nada marcado ainda" nao afirma; o
  // verbo no lugar do nome ("Esta agendado", "Fica marcado") e dos padroes
  // de antes.
  padraoDeAcao(
    "marcacao",
    null,
    `${NO_COMECO_DA_FRASE}(?!(?:nada|nenhum|nenhuma|ninguem|tudo|nao|nem|isso|isto|algo|ainda|ja|esta|estao|estava|ta|fica|ficou|ficaram|ficara|foi|foram|sera|seria|era|vai|vao|deixei|deixamos|deixou|continua|segue|seguem|tem|tinha)\\b)[a-z]{3,}(?:\\s+(?:(?:de|do|da)\\s+)?[a-z]{3,})?\\s+(?:marcad|agendad)[oa]\\s+(?:para|pra)\\s+(?:o\\s+dia\\b|dia\\b|amanha|hoje|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|\\d)`,
  ),
];

/** "Agendadinho", "marcadinha": o participio no diminutivo. */
const PARTICIPIO_NO_DIMINUTIVO =
  /\b(marcad|agendad|cancelad|desmarcad|remarcad|reagendad|reservad|confirmad)inh([oa]s?)\b/g;
/**
 * Revisao curta das correcoes da AG3 (achado 6): "confirmadissimo",
 * "garantidissima": o participio no superlativo.
 */
const PARTICIPIO_NO_SUPERLATIVO =
  /\b(marcad|agendad|cancelad|desmarcad|remarcad|reagendad|reservad|confirmad|garantid|assegurad|combinad)issim([oa]s?)\b/g;

/** O participio sem o diminutivo e sem o superlativo. */
function semFlexaoDoParticipio(texto: string): string {
  return texto
    .replace(PARTICIPIO_NO_DIMINUTIVO, "$1$2")
    .replace(PARTICIPIO_NO_SUPERLATIVO, "$1$2");
}

/**
 * AG4 (27/10/2026): a frase diz que a remarcacao depende da aprovacao da
 * equipe ("pendente da aprovacao", "ate a equipe aprovar", "falta a
 * aprovacao"). "Aprovada" e "aprovado" NAO contam: dizem que ja foi.
 * Revisao da AG4 (achado 5): so a pendencia DITA, com a aprovacao ou a
 * equipe junto ("qualquer pendencia, me chame" e "a aprovacao" sozinha nao
 * contam), lida na frase da afirmacao e na frase logo depois dela (nunca na
 * mensagem inteira).
 */
const PENDENCIA_DA_REMARCACAO = new RegExp(
  [
    // "pendente da aprovacao da equipe", "pendente de aprovacao",
    // "pendente ate a equipe aprovar".
    "\\bpendentes?\\s+(?:de|da|do|ate|ainda)\\s+(?:\\w+\\s+){0,2}?(?:aprovacao|equipe|aprovar)\\b",
    // "esta pendente", "fica pendente", "continua pendente".
    "\\b(?:esta|estao|fica|ficam|ficou|ficaram|continua|continuam|segue|seguem)\\s+(?:ainda\\s+)?pendentes?\\b",
    // "aguardando a aprovacao", "depende da equipe", "sujeita a aprovacao".
    "\\b(?:aguardando|esperando|aguarda|espera|aguardam|esperam|aguardar|esperar|depende|dependem|dependendo|sujeit[oa]s?)\\s+(?:\\w+\\s+){0,2}?(?:aprovacao|equipe)\\b",
    // "ate a equipe aprovar", "assim que a equipe confirmar".
    "\\b(?:ate|assim que|quando|depois que|logo que|antes que)\\s+(?:a\\s+)?(?:equipe|clinica|recepcao)\\s+(?:\\w+\\s+)?(?:aprovar|aprove|confirmar|confirme)\\b",
    // "ate a aprovacao", "depois da aprovacao".
    "\\b(?:ate|antes da|depois da|apos a|apos)\\s+(?:a\\s+)?aprovacao\\b",
    // "precisa ser aprovada", "falta a equipe aprovar", "tem que ser aprovada".
    "\\b(?:precisa|precisam|falta|faltando|tem que|ainda tem que)\\s+(?:\\w+\\s+){0,3}?(?:aprovad[oa]s?|aprovacao|aprovar)\\b",
    // "ainda nao foi aprovada".
    "\\bainda nao (?:foi|esta|ficou) aprovad[oa]s?\\b",
  ].join("|"),
);

/**
 * Revisao da AG4 (achado 5): a frase que AFIRMA a aprovacao ou nega a
 * pendencia ("a aprovacao ja saiu", "ja aprovada", "a equipe aprovou",
 * "nao precisa de aprovacao", "sem pendencia"). Com a remarcacao pendente,
 * qualquer uma delas na mensagem barra (a remarcacao ainda nao foi
 * aprovada), e a frase com ela nunca conta como pendencia.
 */
const APROVACAO_AFIRMADA = new RegExp(
  [
    "\\bja\\s+(?:foi\\s+|foram\\s+|esta\\s+|estao\\s+|ficou\\s+)?aprovad[oa]s?\\b",
    "\\baprovacao\\s+(?:\\w+\\s+){0,3}?(?:ja\\s+)?(?:saiu|veio|chegou|foi dada|foi feita|aconteceu)\\b",
    "\\b(?:equipe|clinica|recepcao)\\s+(?:ja\\s+)?(?:aprovou|aprovaram)\\b",
    "\\bja\\s+(?:aprovou|aprovaram)\\b",
    "(?<!\\bnao\\s)\\b(?:foi|foram|esta|estao|ficou|ficaram|sido)\\s+aprovad[oa]s?\\b",
    "\\bnao\\s+(?:esta|fica|ficou|precisa|depende|tem|ha|existe)\\s+(?:mais\\s+)?(?:nenhuma\\s+|de\\s+|da\\s+|a\\s+)?(?:pendentes?|pendencia|aprovacao)\\b",
    "\\bnao\\s+(?:precisa|e preciso|tem que)\\s+(?:\\w+\\s+){0,2}?aprov",
    "\\b(?:sem|nenhuma)\\s+pendencia\\b",
  ].join("|"),
);

/** Negacao colada na afirmacao ("nao marquei", "ainda nao foi marcada"). */
const NEGACAO_ANTES =
  /\b(?:nao|nem|nunca)\s+(?:(?:te|lhe|me|se|a|o|ainda|tinha)\s+)?$/;

function negada(texto: string, indice: number): boolean {
  return NEGACAO_ANTES.test(texto.slice(Math.max(0, indice - 30), indice));
}

// ---------------------------------------------------------------------------
// Regra estrutural do fechamento (revisao 2 da AG2; revisao final da AG3;
// revisao curta das correcoes)
// ---------------------------------------------------------------------------

/**
 * O tipo da marca de fechamento (revisao final da AG3: a marca e licenciada
 * pela acao, nao por qualquer acao de sucesso; revisao curta das correcoes,
 * achados 4, 6 e 7: o par permitido depende do tipo):
 *  - "fraca": "pronto" e "prontinho" no comeco da frase (a oferta "Pronto!
 *    Tenho terca as 14h" nao fecha nada);
 *  - "interjeicao": "Combinado!", "Feito!", "Tudo certo!" sozinhos no comeco
 *    (a frase curta ou o comeco com a pontuacao logo depois): so dizem
 *    "certo", e o que foi feito e o verbo que vem depois ("Combinado!
 *    Reservei quarta as 14h"). Como a fraca;
 *  - "forte": a consulta dada por feita ("te esperamos", "ficou para",
 *    "tudo certo para", "confirmado", "nos vemos", "ate terca", "sua
 *    consulta sera", "fica terca", "Agendamento: ...", "tudo pronto",
 *    "assegurada"). So com a consulta marcada ou remarcada no turno, ou com
 *    uma consulta lida, e so com o par delas;
 *  - "compromisso": a pessoa ja tem onde ir ("a Dra. Ana te recebe", "pode
 *    vir", "e so comparecer", "voce sera atendida"). Como a forte, menos na
 *    frase que pergunta (tambem "pode ser?"), da alternativa ("ou") ou da
 *    condicao ("se"), que e oferta;
 *  - "horario": "seu horario e", "seu horario sera", "ja esta no seu nome"
 *    (o horario da pessoa). Com a consulta marcada ou lida (o par delas) ou
 *    na frase que diz a acao que o turno fez (o par dela: "Seu horario e
 *    quarta as 14h, reservado por 10 minutos");
 *  - "resumo": "Sua consulta: quarta as 14h". Como a do horario, menos
 *    quando a frase seguinte pede a confirmacao ("... Confirma?");
 *  - "reserva": "reservado", "reservei", "segurei" (so a reserva de 10
 *    minutos): com a reserva no turno e so com o par dela (sem reserva no
 *    turno, a palavra na frase da consulta marcada ou lida, com o par dela).
 */
type TipoDaMarca =
  | "fraca"
  | "interjeicao"
  | "forte"
  | "compromisso"
  | "horario"
  | "resumo"
  | "reserva";

/** As interjeicoes que podem vir antes da marca no comeco da frase. */
const INTERJEICAO_ANTES_DA_MARCA =
  "(?:ok|okay|certo|otimo|perfeito|entao|bom|maravilha|show|isso|sim|oba|legal|claro|muito bem|tudo bem)";
/**
 * "Pronto" e "prontinho" no comeco da frase: a marca FRACA (a oferta
 * "Pronto! Tenho terca as 14h" nao fecha nada; a confere a regra do
 * horario livre).
 */
const FECHAMENTO_FRACO_NO_COMECO = new RegExp(
  `^[\\s"'(]*(?:${INTERJEICAO_ANTES_DA_MARCA}\\s*[,!.]*\\s+)*(?:pronto|prontinho|prontissimo)\\b`,
);
/**
 * Revisao curta das correcoes da AG3 (achado 7): as interjeicoes que so dizem
 * "certo" ("Combinado!", "Feito!", "Fechado,", "Tudo certo!"), com a
 * pontuacao logo depois ("Fechado aos domingos" e "tudo certo para quinta"
 * nao sao interjeicao).
 */
const INTERJEICAO_DE_FECHAMENTO =
  "(?:combinad[oa]s?|feito|feita|fechado|fechadissimo|tudo certo|tudo certinho|tudo ok|tudo okay|tudo pronto|tudo prontinho)";
/** Uma interjeicao no comeco do texto, com a pontuacao depois (ou o fim). */
const INTERJEICAO_NO_COMECO = new RegExp(
  `^[\\s"'(]*(?:(${INTERJEICAO_DE_FECHAMENTO})|pronto|prontinho|prontissimo|${INTERJEICAO_ANTES_DA_MARCA})(?:\\s+entao)?\\s*(?:[,!.:;]+|$)`,
);
/**
 * A interjeicao no fim, depois da virgula ("Reservei quarta as 14h, tudo
 * certo!"). Sem a virgula ("Esta tudo certo!") e a marca forte.
 */
const INTERJEICAO_NO_FIM = new RegExp(
  `[,;:]\\s*(?:${INTERJEICAO_ANTES_DA_MARCA}\\s*[,!.]*\\s+)*${INTERJEICAO_DE_FECHAMENTO}(?:\\s+entao)?\\s*[!.]*\\s*$`,
);
/**
 * No comeco da frase (depois das interjeicoes): revisao final da AG3, "Ate
 * terca", "Ate amanha" e "Agendamento: ...". "Feito!" e "Fechado," sao
 * interjeicao desde a revisao curta das correcoes.
 */
const FECHAMENTO_FORTE_NO_COMECO = new RegExp(
  `^[\\s"'(]*(?:${INTERJEICAO_ANTES_DA_MARCA}\\s*[,!.]*\\s+)*(?:ate\\s+(?:segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|hoje|depois de amanha|o dia\\b|dia\\b|\\d)|(?:(?:o|a|seu|sua)\\s+)?(?:agendamento|marcacao)\\s*:)`,
);
/**
 * Revisao final da AG3: o dado da pessoa ("anotei seus dados", "nome
 * registrado") nao e marca de fechamento: e o registro dos dados, nao da
 * consulta.
 */
const DADO_DA_PESSOA =
  "(?:dados|dado|nome|nomes|data|nascimento|cpf|carteirinha|informacoes|informacao|documentos?)";
const NAO_E_DADO_DEPOIS = `(?!\\s+(?:(?:os|as|o|a|seus|suas|seu|sua|todos|todas|esses|essas)\\s+){0,2}${DADO_DA_PESSOA}\\b)`;
const NAO_E_DADO_ANTES = `(?<!\\b${DADO_DA_PESSOA}\\s+(?:\\S+\\s+)?)`;
/** As marcas FORTES, em qualquer lugar da frase. */
const FECHAMENTO_FORTE = new RegExp(
  [
    // Revisao curta das correcoes da AG3 (achado 6): tambem "tudo ok", "tudo
    // pronto" ("ja deixei tudo pronto para quarta", "esta tudo ok para").
    "\\btudo\\s+(?:certo|certinho|ok|okay|pronto|prontinho|acertado|resolvido)\\b",
    "\\bcombinad[oa]s?\\b",
    "\\bficou\\s+(?:tudo\\s+|entao\\s+)?(?:para|pra)\\b",
    "\\b(?:coloquei|colocamos)\\b(?!\\s+(?:(?:aqui|abaixo|acima|embaixo)\\b|(?:os|as)\\s+(?:horarios|opcoes|datas|dias)\\b|(?:\\S+\\s+){0,3}?(?:na|em)\\s+(?:nossa\\s+|a\\s+)?lista de espera\\b))",
    "\\b(?:encaixei|encaixamos)\\b",
    `${NAO_E_DADO_ANTES}\\b(?:registrei|registramos|registrad[oa]s?)\\b${NAO_E_DADO_DEPOIS}`,
    `${NAO_E_DADO_ANTES}\\b(?:anotei|anotamos|anotad[oa]s?)\\b${NAO_E_DADO_DEPOIS}`,
    // Achado 6: "sua vaga esta assegurada".
    "\\b(?:garantid|assegurad)[oa]s?\\b",
    "\\bte\\s+(?:esperamos|espero|aguardamos|aguardo|esperando|aguardando)\\b",
    "\\b(?:esperamos|aguardamos|espero|aguardo)\\s+(?:voce|vc|a senhora|o senhor|por voce)\\b",
    "\\bconfirmad[oa]s?\\b",
    "\\b(?:esta|ta|ficou|fica|ja esta)\\s+(?:tudo\\s+)?(?:feito|fechado)\\b",
    // Revisao final da AG3: o fechamento sem as marcas de antes ("Sua
    // consulta sera terca", "Nos vemos terca", "Entao fica terca").
    `\\b${POSSESSIVO}\\s+${CONSULTA}\\s+(?:(?!reservad)\\S+\\s+){0,4}?(?:sera|vai ser|e|eh|fica|ficara|vai ficar)\\b`,
    "\\bnos\\s+vemos\\b",
    "\\b(?:fica|ficara|vai ficar)\\s+(?:entao\\s+|tudo\\s+)?(?:para|pra|dia\\b|segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|hoje|\\d)",
  ].join("|"),
  "g",
);
/**
 * Revisao curta das correcoes da AG3 (achado 6): a pessoa ja tem onde ir ("A
 * Dra. Ana te recebe quarta", "vai te atender", "voce sera atendida", "pode
 * vir quarta", "e so comparecer"). "Pode vir a partir das 8h" e regra de
 * funcionamento, nao compromisso.
 */
const FECHAMENTO_DO_COMPROMISSO = new RegExp(
  [
    "\\bte\\s+(?:recebe|recebera|recebem|receberao|recebemos|receberemos|atende|atendera|atendem|atenderao|atendemos|atenderemos|aguarda|aguardara|espera|esperara)\\b",
    "\\b(?:vai|vao|vamos|irei|iremos|ira|irao)\\s+te\\s+(?:receber|atender|esperar|aguardar)\\b",
    "\\b(?:voce|vc|a senhora|o senhor)\\s+(?:(?:ja|entao)\\s+)?(?:sera|vai ser|esta|fica|ficou)\\s+(?:atendid|recebid|esperad|aguardad)[oa]s?\\b",
    "\\b(?:pode|podera)\\s+(?:vir|comparecer|aparecer)\\b(?!\\s+(?:a partir|depois|antes|entre|ate\\b|de\\s+\\d|das\\s+\\d|no horario|em qualquer|qualquer|sem\\b))",
    "\\b(?:e so|basta)\\s+(?:voce\\s+|vc\\s+)?(?:vir|comparecer|aparecer|chegar)\\b(?!\\s+(?:a partir|depois|antes|entre|ate\\b|de\\s+\\d|das\\s+\\d|no horario|em qualquer|qualquer|sem\\b))",
  ].join("|"),
  "g",
);
/**
 * O compromisso que e oferta ou condicao: "se preferir, a Dra. Ana te
 * atende quarta", "assim que confirmar, te recebemos", "quando chegar".
 * O "se" reflexivo ("ela se especializou") nao e condicao.
 */
const CONDICAO_NA_FRASE =
  /\b(?:caso|quando|assim que|depois que|desde que|logo que)\b|\bse\s+(?:(?:voce|vc|a senhora|o senhor)\s+)?(?:quiser|preferir|confirmar|puder|der|for|tiver|precisar|desejar|estiver|houver|conseguir|achar|topar|aceitar|gostar|interessar|fizer|vier|confirmarmos)\b/;
/**
 * O compromisso que e o funcionamento ("a clinica te atende de segunda a
 * sexta, das 8h as 18h", "a Dra. Ana te atende as tercas"): a faixa de
 * horas, o dia da semana no plural ou a faixa de dias.
 */
const FUNCIONAMENTO_NA_FRASE =
  /\b(?:das\s+\d{1,2}\S*\s+(?:as|ate)\b|de\s+\d{1,2}\S*\s+(?:as|a|ate)\s+\d|a partir d|ate as\b|(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)s\b|(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira)?\s+a\s+(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)|tod[oa]s?\s+(?:(?:as|os)\s+)?(?:segunda|terca|quarta|quinta|sexta|sabado|domingo|dias|semanas?))/;
/**
 * Revisao final da AG3: "seu horario e quarta", "seu horario sera as 14h".
 * Revisao curta das correcoes (achado 6): "ja esta no seu nome", "deixei
 * quarta as 14h no seu nome".
 */
const FECHAMENTO_DO_HORARIO = new RegExp(
  [
    `\\b${POSSESSIVO}\\s+horarios?\\s+(?:(?!reservad)\\S+\\s+){0,4}?(?:sera|vai ser|e|eh|fica|ficara|vai ficar)\\b`,
    "\\b(?:esta|estao|ta|ja esta|ficou|ficaram|fica|ficara|vai ficar|deixei|deixamos|coloquei|colocamos|botei|pus)\\s+(?:\\S+\\s+){0,6}?(?:no|em)\\s+(?:seu|teu)\\s+nome\\b",
  ].join("|"),
  "g",
);
/** Revisao curta das correcoes da AG3 (achado 6): "Sua consulta: quarta...". */
const FECHAMENTO_DO_RESUMO = new RegExp(
  `\\b${POSSESSIVO}\\s+(?:consulta|agendamento|horario|atendimento|retorno|sessao|avaliacao|procedimento|\\u00a7)\\s*:`,
  "g",
);
/**
 * A frase seguinte que pergunta a escolha ou pede a confirmacao ("Sua
 * consulta: quarta as 14h. Confirma?", "A Dra. Ana te recebe quarta as
 * 14h. Pode ser?"): o resumo e o compromisso de antes sao a proposta, nao o
 * feito.
 */
const PERGUNTA_DE_ESCOLHA =
  /\b(?:confirma|confirmar|confirmamos|confirmo|posso (?:marcar|agendar|confirmar|reservar)|podemos (?:marcar|agendar|confirmar|reservar)|marco|agendo|reservo|pode ser|serve|prefere|quer|gostaria|topa|fica bom|esta bom|ta bom|tudo bem|esta certo|ta certo|certo|correto|combinado|de acordo|ok)\b[^.!]*\?\s*$/;
/** As marcas da reserva de 10 minutos ("reservado", "reservei"). */
const FECHAMENTO_DA_RESERVA = new RegExp(
  `\\breservad[oa]s?\\b${RESERVA_QUE_E_REGRA}|\\b(?:reservei|reservamos|segurei|seguramos)\\b`,
  "g",
);
/**
 * A negacao da marca ("ainda nao esta confirmado", "nao ficou combinado").
 * Revisao final da AG3: tambem com "mais" e "ja" ("nao esta mais
 * reservado", "ja nao esta confirmada").
 */
const NEGACAO_DA_MARCA =
  /\b(?:nao|nem|nunca)\s+(?:(?:te|lhe|me|se|a|o|ainda|tinha|esta|estao|ta|foi|foram|ficou|ficaram|fica|e|mais|ja|vai|pode|sera)\s+){0,3}$/;
/**
 * Revisao final da AG3: a frase que diz que a reserva ou o horario nao vale
 * mais ("a reserva de quarta as 14h venceu", "o horario de quarta nao esta
 * mais reservado") nao fecha nada, nem com a marca da frase curta de antes
 * ("Anotei seus dados. A reserva ... venceu.").
 */
const NAO_VALE_MAIS =
  /\b(?:venceu|venceram|vencid[oa]s?|expirou|expiraram|expirad[oa]s?)\b|\b(?:nao|ja nao)\s+(?:esta|estao|ta|ficou|ficaram|fica|e)\s+(?:mais\s+)?(?:reservad|livre|disponive|valend|garantid)/;

/**
 * As interjeicoes do comeco da frase ("Otimo, tudo certo!", "Combinado,
 * reservei..."): se alguma e de fechamento (INTERJEICAO_DE_FECHAMENTO), e o
 * resto da frase depois delas.
 */
function interjeicoesDoComeco(frase: string): {
  deFechamento: boolean;
  resto: string;
} {
  let resto = frase;
  let deFechamento = false;
  for (;;) {
    const m = INTERJEICAO_NO_COMECO.exec(resto);
    if (m === null || m[0] === "") {
      break;
    }
    if (m[1] !== undefined) {
      deFechamento = true;
    }
    resto = resto.slice(m[0].length);
  }
  const noFim = INTERJEICAO_NO_FIM.exec(resto);
  if (noFim !== null) {
    deFechamento = true;
    resto = resto.slice(0, noFim.index);
  }
  return { deFechamento, resto };
}

/**
 * O compromisso que a frase afirma: fora da pergunta (tambem "pode ser?"),
 * da alternativa ("ou"), da condicao, do funcionamento e da proposta que a
 * frase seguinte pergunta ("... Pode ser?").
 */
function afirmaCompromisso(
  frase: string,
  seguinte: string | undefined,
  semNegacao: (texto: string, regex: RegExp) => RegExpMatchArray[],
): boolean {
  if (
    frase.trimEnd().endsWith("?") ||
    /\sou\s/.test(frase) ||
    CONDICAO_NA_FRASE.test(frase) ||
    FUNCIONAMENTO_NA_FRASE.test(frase) ||
    (seguinte !== undefined && PERGUNTA_DE_ESCOLHA.test(seguinte))
  ) {
    return false;
  }
  return semNegacao(frase, FECHAMENTO_DO_COMPROMISSO).length > 0;
}

/**
 * As marcas de fechamento da frase, pelo tipo (vazio: nenhuma). A frase
 * seguinte so decide o resumo ("Sua consulta: quarta as 14h. Confirma?").
 */
function marcasDeFechamento(
  frase: string,
  seguinte: string | undefined,
): Set<TipoDaMarca> {
  const tipos = new Set<TipoDaMarca>();
  const semNegacao = (texto: string, regex: RegExp) =>
    [...texto.matchAll(regex)].filter((m) => {
      const indice = m.index ?? 0;
      return !NEGACAO_DA_MARCA.test(
        texto.slice(Math.max(0, indice - 40), indice),
      );
    });
  const { deFechamento, resto } = interjeicoesDoComeco(frase);
  if (deFechamento) {
    tipos.add("interjeicao");
  }
  if (
    FECHAMENTO_FORTE_NO_COMECO.test(resto) ||
    semNegacao(resto, FECHAMENTO_FORTE).length > 0
  ) {
    tipos.add("forte");
  }
  if (afirmaCompromisso(frase, seguinte, semNegacao)) {
    tipos.add("compromisso");
  }
  if (semNegacao(frase, FECHAMENTO_DO_HORARIO).length > 0) {
    tipos.add("horario");
  }
  if (
    semNegacao(frase, FECHAMENTO_DO_RESUMO).length > 0 &&
    !(seguinte !== undefined && PERGUNTA_DE_ESCOLHA.test(seguinte))
  ) {
    tipos.add("resumo");
  }
  if (semNegacao(frase, FECHAMENTO_DA_RESERVA).length > 0) {
    tipos.add("reserva");
  }
  if (FECHAMENTO_FRACO_NO_COMECO.test(frase)) {
    tipos.add("fraca");
  }
  return tipos;
}

/** Quantas palavras, no maximo, tem a frase que so fecha ("Pronto, Maria!"). */
const MAXIMO_DE_PALAVRAS_DA_INTERJEICAO = 4;

/** As marcas que so dizem "certo" (o feito e o verbo da frase). */
const MARCAS_DE_INTERJEICAO: ReadonlySet<TipoDaMarca> = new Set([
  "fraca",
  "interjeicao",
]);

/** Uma frase com dia ou hora e marca de fechamento. */
type FechamentoDaFrase = {
  /** O indice da frase. */
  indice: number;
  /** As marcas da frase e as da frase curta logo antes. */
  tipos: ReadonlySet<TipoDaMarca>;
  /** Os pares (dia e hora) da frase. */
  pares: ParDaOferta[];
};

/**
 * As frases (fora da pergunta de verdade) com dia, dia da semana, "hoje",
 * "amanha" ou hora E uma marca de fechamento, na propria frase ou na frase
 * curta logo antes ("Combinado! Te esperamos quinta", "Pronto. Quinta as
 * 14h"). Revisao curta das correcoes da AG3: tambem a da frase curta logo
 * DEPOIS, sem dia nem hora ("Reservei quarta as 14h. Te esperamos!"). A
 * marca que so diz "certo" ("pronto", "combinado!") com a oferta de horario
 * livre na frase nao conta: a oferta ja e conferida com os horarios livres.
 * A frase que diz que a reserva ou o horario nao vale mais tambem nao
 * (NAO_VALE_MAIS).
 */
function fechamentosDasFrases(
  texto: string,
  frases: readonly Frase[],
  hoje: DiaDaClinica | null,
): FechamentoDaFrase[] {
  const lidas = frases.map((frase, indice) => {
    const marcas = marcasDeFechamento(frase.texto, frases[indice + 1]?.texto);
    const pergunta = ehPerguntaDeVerdade(frase.texto);
    const partes = partesDaOferta(texto, frase, hoje);
    return {
      frase,
      marcas,
      pergunta,
      partes,
      /** A frase curta que so fecha ("Pronto, Maria!", "Te esperamos!"). */
      curta:
        !pergunta &&
        marcas.size > 0 &&
        palavrasDe(frase.texto).length <= MAXIMO_DE_PALAVRAS_DA_INTERJEICAO,
      temDiaOuHora: partes.some(
        (parte) => parte.tipo === "data" || parte.tipo === "hora",
      ),
    };
  });
  const fechamentos: FechamentoDaFrase[] = [];
  lidas.forEach((lida, indice) => {
    const anterior = lidas[indice - 1];
    const seguinte = lidas[indice + 1];
    const tipos = new Set([
      ...lida.marcas,
      ...(anterior?.curta ? anterior.marcas : []),
      ...(seguinte?.curta && !seguinte.temDiaOuHora ? seguinte.marcas : []),
    ]);
    if (
      lida.pergunta ||
      tipos.size === 0 ||
      NAO_VALE_MAIS.test(lida.frase.texto) ||
      !lida.temDiaOuHora
    ) {
      return;
    }
    if (
      [...tipos].every((tipo) => MARCAS_DE_INTERJEICAO.has(tipo)) &&
      afirmaHorarioLivre(lida.frase.texto)
    ) {
      return;
    }
    fechamentos.push({ indice, tipos, pares: paresDaOferta(lida.partes) });
  });
  return fechamentos;
}

// ---------------------------------------------------------------------------
// O profissional e a unidade da acao (revisao curta das correcoes da AG3,
// achado 5)
// ---------------------------------------------------------------------------

/**
 * Um fato da agenda (acao ou consulta lida) lido: o dia e a hora, e o
 * profissional e a unidade dele (nulo: nao se sabe ou sem unidade).
 */
type FatoDaAgendaLido = HorarioLivreLido & {
  profissional: string | null;
  unidade: string | null;
};

/** Os titulos que nao fazem parte do nome ("Dra. Ana Lima" e "ana lima"). */
const TITULOS_DO_PROFISSIONAL: ReadonlySet<string> = new Set([
  "dr",
  "dra",
  "drs",
  "dras",
  "doutor",
  "doutora",
  "doutores",
  "doutoras",
  "prof",
  "profa",
  "professor",
  "professora",
]);

/** As palavras do nome, sem titulo e sem pontuacao, ja sem acento. */
function palavrasDoNomeDaPessoa(nome: string): string[] {
  return normalizarBase(nome)
    .split(/[^a-z0-9]+/)
    .filter((p) => p !== "" && !TITULOS_DO_PROFISSIONAL.has(p));
}

/** As palavras do nome da unidade, sem o "unidade" do comeco. */
function palavrasDoNomeDaUnidade(nome: string): string[] {
  const palavras = normalizarBase(nome)
    .split(/[^a-z0-9]+/)
    .filter((p) => p !== "");
  return palavras[0] === "unidade" ? palavras.slice(1) : palavras;
}

/**
 * O titulo com o nome logo depois ("dra. ana", "dr bruno", "doutora ana").
 * O titulo do nome de rua ("Rua Dr. Jose Lourenco") nao e o profissional.
 */
const TITULO_E_NOME =
  /(?<!\b(?:rua|r\.|av\.?|avenida|travessa|tv\.|alameda|al\.|praca|pca\.?|rodovia|rod\.|estrada|largo|ladeira|beco|viela|hospital|colegio|escola|edificio|predio|shopping)\s+)\b(?:dra?s?|doutora?s?|doutores)\b\.?\s+([a-z]+)/g;
/**
 * O nome dito com a negacao logo depois ("o Dr. Bruno nao tinha horario",
 * "a unidade Aldeota nao tem vaga") nao e o da acao.
 */
const NEGACAO_DEPOIS_DA_MENCAO = /^(?:\s+\S+){0,3}?\s+(?:nao|nem|sem|nunca)\b/;

/** Um nome citado na frase e as chaves de quem ele pode ser. */
type MencaoNaFrase = {
  inicio: number;
  fim: number;
  chaves: ReadonlySet<string>;
};

function sobrepoe(
  mencoes: readonly MencaoNaFrase[],
  inicio: number,
  fim: number,
): boolean {
  return mencoes.some((m) => inicio < m.fim && fim > m.inicio);
}

function regexDasPalavras(palavras: readonly string[], antes = ""): RegExp {
  return new RegExp(
    `(?<![a-z0-9])${antes}${palavras.map(escaparRegex).join("[^a-z0-9]+")}(?![a-z0-9])`,
    "g",
  );
}

/**
 * Os profissionais que a frase (ja normalizada, sem a mascara) cita: o nome
 * inteiro sem titulo, de duas palavras ou mais ("Ana Lima", "Dr. Bruno
 * Costa"), ou o titulo com uma palavra do nome ("Dra. Ana", "Dr. Costa":
 * todos os profissionais com essa palavra). O primeiro nome sem titulo
 * ("com a Ana") nao conta: pode ser o nome da pessoa.
 */
function profissionaisCitados(
  frase: string,
  nomes: readonly string[],
): MencaoNaFrase[] {
  const chaves = [
    ...new Set(nomes.map((nome) => palavrasDoNomeDaPessoa(nome).join(" "))),
  ]
    .filter((chave) => chave !== "")
    .sort((a, b) => b.length - a.length);
  const mencoes: MencaoNaFrase[] = [];
  for (const chave of chaves) {
    const palavras = chave.split(" ");
    if (palavras.length < 2) {
      continue;
    }
    for (const m of frase.matchAll(regexDasPalavras(palavras))) {
      const inicio = m.index ?? 0;
      const fim = inicio + m[0].length;
      if (!sobrepoe(mencoes, inicio, fim)) {
        mencoes.push({ inicio, fim, chaves: new Set([chave]) });
      }
    }
  }
  for (const m of frase.matchAll(TITULO_E_NOME)) {
    const palavra = m[1] ?? "";
    const inicio = m.index ?? 0;
    const fim = inicio + m[0].length;
    const de = chaves.filter((chave) => chave.split(" ").includes(palavra));
    if (de.length === 0 || sobrepoe(mencoes, inicio, fim)) {
      continue;
    }
    mencoes.push({ inicio, fim, chaves: new Set(de) });
  }
  return mencoes.filter(
    (m) => !NEGACAO_DEPOIS_DA_MENCAO.test(frase.slice(m.fim, m.fim + 40)),
  );
}

/**
 * As unidades que a frase (ja normalizada) cita com a palavra "unidade"
 * ("na unidade Aldeota", "unidade do Centro", "Unidade: Centro"). O nome
 * solto ("no Centro", "na Aldeota") pode ser o bairro, e fica para o
 * verificador.
 */
function unidadesCitadas(
  frase: string,
  nomes: readonly string[],
): MencaoNaFrase[] {
  const chaves = [
    ...new Set(nomes.map((nome) => palavrasDoNomeDaUnidade(nome).join(" "))),
  ]
    .filter((chave) => chave !== "")
    .sort((a, b) => b.length - a.length);
  const mencoes: MencaoNaFrase[] = [];
  for (const chave of chaves) {
    const regex = regexDasPalavras(
      chave.split(" "),
      "unidade\\s*:?\\s*(?:(?:do|da|de|dos|das)\\s+)?",
    );
    for (const m of frase.matchAll(regex)) {
      const inicio = m.index ?? 0;
      const fim = inicio + m[0].length;
      if (!sobrepoe(mencoes, inicio, fim)) {
        mencoes.push({ inicio, fim, chaves: new Set([chave]) });
      }
    }
  }
  return mencoes.filter(
    (m) => !NEGACAO_DEPOIS_DA_MENCAO.test(frase.slice(m.fim, m.fim + 40)),
  );
}

/**
 * A frase da acao, do estado ou do fechamento cita outro profissional ou
 * outra unidade que a do fato dela? Os fatos da frase sao os da alegacao e
 * os das marcas licenciadas; com dia ou hora, so os do par da frase (o par
 * fora do fato ja barra em outra regra). Fato sem profissional (ou sem
 * unidade) conhecido: nao se sabe, e nao barra. Devolve as regras.
 */
function profissionalOuUnidadeForaDaAcao(
  frase: string,
  pares: readonly ParDaOferta[],
  fatosDaFrase: readonly FatoDaAgendaLido[],
  fatos: FatosDoTurno,
): string[] {
  const daFrase =
    pares.length === 0
      ? fatosDaFrase
      : fatosDaFrase.filter((f) =>
          pares.some((par) => parNoHorarioLivre(par, f)),
        );
  if (daFrase.length === 0) {
    return [];
  }
  const regras: string[] = [];
  const profissionais = daFrase.flatMap((f) =>
    f.profissional === null ? [] : [f.profissional],
  );
  const citados = profissionaisCitados(frase, [
    ...(fatos.profissionais ?? []),
    ...profissionais,
  ]);
  if (
    citados.length > 0 &&
    profissionais.length === daFrase.length &&
    !profissionais.some((nome) => {
      const chave = palavrasDoNomeDaPessoa(nome).join(" ");
      return citados.every((m) => m.chaves.has(chave));
    })
  ) {
    regras.push("profissional_fora_da_acao");
  }
  const unidades = daFrase.flatMap((f) =>
    f.unidade === null ? [] : [f.unidade],
  );
  const naFrase = unidadesCitadas(frase, [
    ...(fatos.unidades ?? []),
    ...unidades,
  ]);
  if (
    naFrase.length > 0 &&
    unidades.length === daFrase.length &&
    !unidades.some((nome) => {
      const chave = palavrasDoNomeDaUnidade(nome).join(" ");
      return naFrase.every((m) => m.chaves.has(chave));
    })
  ) {
    regras.push("unidade_fora_da_acao");
  }
  return regras;
}

// ---------------------------------------------------------------------------
// Convenio
// ---------------------------------------------------------------------------

/**
 * As palavras genericas que apontam convenio e as operadoras mais comuns:
 * so para RECONHECER a afirmacao ("aceitamos Hapvida" com a Hapvida fora do
 * Cadastro tambem precisa de fato). Nao e dado de clinica nenhuma e nunca
 * libera nada; os nomes do Cadastro entram pelos fatos. Revisao da AG2: o
 * "Bradesco" sozinho e mais operadoras regionais; a operadora que nao esta
 * aqui nem no Cadastro e pega pelo objeto de "aceita", "atende pelo",
 * "trabalha com" e "cobre" (analisarObjeto).
 */
const OPERADORAS_CONHECIDAS = [
  "unimed",
  "bradesco saude",
  "bradesco",
  "amil",
  "sulamerica",
  "sul america",
  "hapvida",
  "notredame",
  "notre dame",
  "intermedica",
  "cassi",
  "geap",
  "golden cross",
  "mediservice",
  "omint",
  "care plus",
  "prevent senior",
  "camed",
  "porto seguro",
  "allianz",
  "sompo",
  "postal saude",
  "saude caixa",
  "petrobras",
  "assim saude",
  "medsenior",
  "planserv",
  "issec",
  "ipsemg",
  "iamspe",
  "cabesp",
  "fusex",
  "gama saude",
  "trasmontano",
  "ameplan",
];
/**
 * Revisao curta das correcoes da AG3 (achado 14): "plano" seguido de verbo e
 * o plano de fazer algo, nao o convenio ("meu plano era ir hoje a tarde",
 * "o plano e passar ai amanha", "meu plano de vir cedo"). O adjetivo em -ar
 * e -er ("plano familiar", "plano hospitalar", "plano master") continua
 * sendo convenio, e "meu plano e a Hapvida" tambem.
 */
const VERBO_DEPOIS_DO_PLANO =
  "\\s+(?:(?:e|eh|era|foi|seria|sera|e de|era de|de|seria de|sera de)\\s+)?(?:ir|vir|ver|ser|ter|dar|ler|[a-z]{2,}(?:ar|er|ir))\\b(?<!\\b(?:familiar|popular|regular|titular|hospitalar|similar|escolar|militar|singular|particular|lugar|celular|exemplar|master|super|premier|mulher))";
/** "Plano" que nao e o plano de fazer algo (VERBO_DEPOIS_DO_PLANO). */
const NAO_E_PLANO_DE_FAZER = `(?!${VERBO_DEPOIS_DO_PLANO})`;
const CONVENIO_GENERICO = `(?:convenios?|planos?(?!\\s+de\\s+(?:tratamento|pagamento|acao|saude bucal))${NAO_E_PLANO_DE_FAZER}|seguro saude|operadoras?|${OPERADORAS_CONHECIDAS.join("|")})`;

/** "cobre": precisa de "coberto"; "aceita": basta o convenio atender. */
type Alegacao = "cobre" | "aceita";

/** Ate dois artigos, possessivos ou demonstrativos ("o seu convenio"). */
const DETERMINANTES =
  "(?:(?:o|a|os|as|seu|sua|seus|suas|esse|essa|esses|essas|este|esta)\\s+){0,2}";

type PadraoDeCobertura = {
  nome: string;
  alegacao: Alegacao;
  /** A fonte, com o alvo (generico ou nome do Cadastro) no lugar dele. */
  fonte: (alvo: string) => string;
};

/** As afirmacoes lidas pelo convenio citado (o alvo). */
const PADROES_DE_COBERTURA: readonly PadraoDeCobertura[] = [
  {
    nome: "convenio_paga",
    alegacao: "cobre",
    fonte: (alvo) =>
      `\\b${alvo}(?:\\s+\\S+){0,4}?\\s+(?:paga|pagam|pagara|vai pagar|custeia|custeiam|reembolsa|reembolsam|arca com)\\b`,
  },
  {
    nome: "incluso_no_convenio",
    alegacao: "cobre",
    fonte: (alvo) =>
      `\\b(?:inclus|incluid)[oa]s?\\s+(?:no|na|pelo|pela|em)\\s+${DETERMINANTES}${alvo}`,
  },
  {
    nome: "atende_por",
    alegacao: "aceita",
    fonte: (alvo) =>
      `\\b(?:atende|atendem|atendemos|atendo)\\b(?:\\s+\\S+){0,3}?\\s+(?:por|com)\\s+${DETERMINANTES}${alvo}`,
  },
  {
    nome: "credenciado",
    alegacao: "aceita",
    fonte: () => "\\bcredenciad[oa]s?\\b",
  },
  {
    nome: "convenio_aceito",
    alegacao: "aceita",
    fonte: (alvo) =>
      `\\b${alvo}(?:\\s+\\S+){0,2}?\\s+(?:e|eh|esta|sao|estao|foi)\\s+(?:aceit|atendid)[oa]s?\\b`,
  },
];

type PadraoPeloObjeto = {
  nome: string;
  /**
   * "todo": todo objeto que nao e pagamento, "particular" nem palavra de
   * fora (horario, canal, gente, lugar) exige fato, inclusive a operadora
   * fora da lista. "convenio": so o objeto que cita convenio (o "atende"
   * direto: "atendemos adultos" nao e convenio).
   */
  objeto: "todo" | "convenio";
  regex: RegExp;
};

/**
 * Revisao da AG2: as afirmacoes lidas pelo OBJETO, ate o fim da oracao
 * ("Sim, aceitamos Bradesco.", "Atendemos pela Camed.", "Trabalhamos com
 * Unimed e cartao").
 */
const PADROES_PELO_OBJETO: readonly PadraoPeloObjeto[] = [
  {
    nome: "aceita",
    objeto: "todo",
    regex:
      /\baceit(?:a|am|amos|o)\b(?:\s+(?:sim|tambem|ainda|so|somente|apenas|normalmente))*/g,
  },
  {
    nome: "atende_pelo",
    objeto: "todo",
    regex:
      /\b(?:atende|atendem|atendemos|atendo)\b(?:\s+[^\s,;:.!?]+){0,3}?\s+pel[oa]s?\b/g,
  },
  {
    nome: "trabalha_com",
    objeto: "todo",
    regex:
      /\btrabalh(?:a|am|amos|o)\s+(?:sim\s+|tambem\s+|so\s+|somente\s+|apenas\s+)?com\b/g,
  },
  {
    nome: "atende",
    objeto: "convenio",
    regex:
      /\b(?:atende|atendem|atendemos|atendo)\b(?!\s+(?:\S+\s+){0,3}?pel[oa]s?\b)/g,
  },
];

/** Onde acaba o objeto: a pontuacao forte, a oracao seguinte e a preposicao. */
const FIM_DO_OBJETO =
  /[.;:!?]|,\s*(?=(?:e|mas|que|porque|pois|se|entao|ja|sim|nao|o|a|os|as|tudo|ok|certo|claro|pode|quer|posso|voce|so|apenas|inclusive|alem|caso)\b)|\s(?=(?:para|pra|no|na|nos|nas|em|se|mas|quando|porque|pois|ate|desde|via|caso|que|onde|so|apenas|somente|inclusive|exceto|menos|mediante|conforme)\b)/;

/** "plano de tratamento" e "plano de pagamento" nao sao convenio. */
/** Revisao curta das correcoes da AG3 (achado 14): nem "plano de ir amanha". */
const PLANO_QUE_NAO_E_CONVENIO = new RegExp(
  `\\bplanos?(?:\\s+de\\s+(?:tratamento|pagamento|acao|saude bucal)\\b|(?=${VERBO_DEPOIS_DO_PLANO}))`,
  "g",
);

/** Lugar coberto ("estacionamento coberto", "area coberta"). */
const LUGAR_ANTES_DE_COBERTO =
  "(?<!\\b(?:estacionamento|garagem|vagas?|local|area|espaco|lugar|patio|corredor|acesso|ponto|toldo|teto)\\s(?:\\S+\\s){0,2})";
/** "Coberto pelo valor da consulta" e o preco, nao convenio. */
const COBERTO_PELO_PRECO =
  "(?!\\s+(?:pelo|pela)\\s+(?:valor|preco|pacote|taxa|sinal|investimento|orcamento)\\b)";
const COBERTO = new RegExp(
  `${LUGAR_ANTES_DE_COBERTO}\\bcobert[oa]s?\\b${COBERTO_PELO_PRECO}`,
  "g",
);
// "Na cobertura do predio" e o andar; "sem cobertura" e "fora da
// cobertura" sao a negativa (SEM_COBERTURA).
const COBERTURA =
  /(?<!\b(?:na|sem|fora da|fora de)\s)\bcobertura\b(?!\s+d[oa]\s+(?:predio|edificio|shopping|torre|bloco))/g;
/** "Coberto" com o verbo de ligacao: "e coberto", "sim, e coberta". */
const VERBO_ANTES_DE_COBERTO =
  /\b(?:e|eh|sao|esta|estao|fica|ficam|seria|sera|serao|foi|foram|sim)\s+(?:(?:sim|tambem|totalmente|integralmente|parcialmente)\s+)?$/;
/** "Tem cobertura", "com cobertura": a afirmacao sem a palavra convenio. */
const TER_COBERTURA =
  /\b(?:tem|ha|possui|possuem|com|inclui|incluid[oa]|dentro da)\s+(?:\S+\s+)?$/;
/** O paciente perguntou de convenio ou de cobertura. */
const CONVENIO_NA_MENSAGEM = new RegExp(
  `\\b(?:convenios?|planos?(?!\\s+de\\s+(?:tratamento|pagamento))${NAO_E_PLANO_DE_FAZER}|operadoras?|carteirinha|seguro saude|cobre|cobrem|cobertura|coberto|coberta|credenciad\\w*|reembolso)\\b`,
);

/** A negacao da afirmacao de convenio, ate tres palavras antes. */
const NEGACAO_DO_CONVENIO =
  /\b(?:nao|nem|nenhum|nenhuma)\b(?:\s+[^\s,;:.!?]+){0,3}\s*$/;
/**
 * Pergunta indireta ou condicao ("ver se cobre", "se o plano cobre"). A
 * pontuacao fecha o alcance ("Nao, mas atendemos pelo X" afirma; "nao" e
 * a resposta de antes).
 */
const CONDICAO_ANTES = /\bse\b(?:\s+[^\s,;:.!?]+){0,4}\s*$/;
const SEM_COBERTURA =
  /\b(?:sem cobertura|fora da (?:cobertura|rede)|nao (?:faz|fazem) parte da (?:rede|cobertura))\b/;

type ConvenioNormalizado = { nome: string; plano: string | null };

function normalizarConvenio(c: ConvenioDosFatos): ConvenioNormalizado {
  return {
    nome: normalizarBase(c.nome),
    plano: c.plano === null ? null : normalizarBase(c.plano),
  };
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexDoNome(nome: string, flags = ""): RegExp {
  return new RegExp(`(?<![a-z0-9])${escaparRegex(nome)}(?![a-z0-9])`, flags);
}

function contem(frase: string, nome: string): boolean {
  return nome.length >= 2 && regexDoNome(nome).test(frase);
}

function semONome(frase: string, nome: string): string {
  return frase.replace(regexDoNome(nome, "g"), " ");
}

function palavrasDe(texto: string): string[] {
  return texto.split(/[^a-z0-9\u00a7]+/).filter((p) => p !== "");
}

/** O objeto de um verbo: do fim do verbo ate o fim da oracao. */
function objetoDepois(frase: string, desde: number): string {
  const resto = frase.slice(desde);
  const fim = resto.search(FIM_DO_OBJETO);
  return fim === -1 ? resto : resto.slice(0, fim);
}

/**
 * O sujeito de um verbo: da ultima virgula, do ultimo "que" ou da ultima
 * conjuncao (ou do comeco) ate o verbo ("a Dra. Ana disse que o plano
 * cobre": "o plano").
 */
function sujeitoAntes(frase: string, ate: number): string {
  const antes = frase.slice(0, ate);
  let corte = -1;
  // A virgula do numero ("R$ 250,00") nao corta.
  for (const m of antes.matchAll(
    /[,;:](?=\s)|\(|\s(?:que|ou|mas|porque|pois|quando|onde)(?=\s)/g,
  )) {
    corte = Math.max(corte, (m.index ?? 0) + m[0].length - 1);
  }
  return corte === -1 ? antes : antes.slice(corte + 1);
}

type AnaliseDoObjeto = {
  /** O objeto cita convenio (palavra generica, operadora ou Cadastro). */
  citaConvenio: boolean;
  /** Palavras que nao sao nada conhecido: a operadora fora da lista. */
  desconhecidas: string[];
  /** So palavra de funcao ("Aceitamos, sim!"): o objeto e o da pergunta. */
  vazio: boolean;
};

/**
 * O que o objeto de "aceita", "atende pelo", "trabalha com" (ou o sujeito
 * de "cobre") diz de convenio. Cada item da lista ("Pix, cartao e Unimed")
 * e lido sozinho: o que comeca com meio de pagamento ou "particular" nao e
 * convenio; o nome do Cadastro, a operadora conhecida e a palavra generica
 * citam convenio; o resto que nao e palavra de funcao nem de fora
 * (NAO_E_CONVENIO) e desconhecido, e nenhum fato sustenta o desconhecido.
 */
function analisarObjeto(
  objeto: string,
  nomesDeConvenio: readonly string[],
): AnaliseDoObjeto {
  let citaConvenio = false;
  const desconhecidas: string[] = [];
  const semPlanoDeTratamento = objeto.replace(
    PLANO_QUE_NAO_E_CONVENIO,
    " \u00a7 ",
  );
  const vazio = palavrasDe(semPlanoDeTratamento).every((p) =>
    FUNCAO_NO_OBJETO.has(p),
  );
  for (const item of semPlanoDeTratamento.split(/\s*,\s*|\s+(?:e|ou)\s+/)) {
    let resto = ` ${item} `;
    let citouNoItem = false;
    for (const nome of nomesDeConvenio) {
      if (contem(resto, nome)) {
        citouNoItem = true;
        resto = semONome(resto, nome);
      }
    }
    const conteudo = palavrasDe(resto).filter((p) => !FUNCAO_NO_OBJETO.has(p));
    const primeira = conteudo[0];
    if (
      !citouNoItem &&
      primeira !== undefined &&
      (MEIOS_DE_PAGAMENTO.has(primeira) || PARTICULAR.has(primeira))
    ) {
      continue;
    }
    if (citouNoItem) {
      citaConvenio = true;
    }
    for (const palavra of conteudo) {
      if (CONVENIO_NO_OBJETO.has(palavra)) {
        citaConvenio = true;
        continue;
      }
      if (
        MEIOS_DE_PAGAMENTO.has(palavra) ||
        PARTICULAR.has(palavra) ||
        NAO_E_CONVENIO.has(palavra) ||
        palavra.includes("\u00a7") ||
        /^\d/.test(palavra) ||
        palavra.length < 3 ||
        palavra.endsWith("mente")
      ) {
        continue;
      }
      desconhecidas.push(palavra);
    }
  }
  return { citaConvenio, desconhecidas, vazio };
}

/** As palavras do objeto de "cobre" que citam procedimento ("o ultrassom"). */
function procedimentoNoObjeto(objeto: string): string[] {
  return palavrasDe(objeto).filter(
    (p) =>
      !FUNCAO_NO_OBJETO.has(p) &&
      !OBJETO_GENERICO_DE_COBRE.has(p) &&
      !CONVENIO_NO_OBJETO.has(p) &&
      !p.includes("\u00a7") &&
      !/^\d/.test(p) &&
      !p.endsWith("mente") &&
      p.length >= 3,
  );
}

/**
 * Revisao final da AG3 (item 9): o nome depois da palavra generica de
 * convenio ("meu plano e o X", "convenio X", "a operadora Y").
 */
const NOME_DEPOIS_DO_CONVENIO = new RegExp(
  `\\b(?:convenios?|planos?(?!\\s+de\\s+(?:tratamento|pagamento|acao|saude bucal))${NAO_E_PLANO_DE_FAZER}|operadoras?|seguro saude)\\b(?:\\s+(?:e|eh|sera|seria|chamad[oa]|chama)\\b|\\s*:)?`,
  "g",
);
/**
 * "Tenho Humana Saude", "uso o plano X", "sou cliente da Y": o objeto, que
 * so conta quando cita convenio (a palavra generica, como "saude" ou
 * "plano").
 */
const TER_O_CONVENIO =
  /\b(?:tenho|temos|uso|usamos|possuo|possuimos|sou\s+(?:cliente\s+)?d[oa]|somos\s+(?:clientes\s+)?d[oa])\b/g;

/**
 * Revisao final da AG3 (item 9): a mensagem do paciente cita um convenio
 * que nao e nome do Cadastro, operadora conhecida nem palavra conhecida: o
 * objeto de "aceita", "atende pelo" e "trabalha com" (e de "atende", quando
 * cita convenio) ou o nome depois de "convenio", "plano" e "operadora" com
 * palavra desconhecida ("Voces aceitam Humana Saude?", "meu plano e o X").
 */
function convenioNaoReconhecidoNaMensagem(
  mensagem: string,
  nomesDeConvenio: readonly string[],
  naoConvenios: readonly string[],
): boolean {
  const desconhecido = (objeto: string, soComConvenio: boolean) => {
    const analise = analisarObjeto(
      mascararNomes(objeto, naoConvenios),
      nomesDeConvenio,
    );
    return (
      analise.desconhecidas.length > 0 &&
      (!soComConvenio || analise.citaConvenio)
    );
  };
  for (const padrao of PADROES_PELO_OBJETO) {
    for (const m of mensagem.matchAll(padrao.regex)) {
      const fim = (m.index ?? 0) + m[0].length;
      if (
        desconhecido(objetoDepois(mensagem, fim), padrao.objeto === "convenio")
      ) {
        return true;
      }
    }
  }
  for (const m of mensagem.matchAll(NOME_DEPOIS_DO_CONVENIO)) {
    const fim = (m.index ?? 0) + m[0].length;
    if (desconhecido(objetoDepois(mensagem, fim), false)) {
      return true;
    }
  }
  for (const m of mensagem.matchAll(TER_O_CONVENIO)) {
    const fim = (m.index ?? 0) + m[0].length;
    if (desconhecido(objetoDepois(mensagem, fim), true)) {
      return true;
    }
  }
  return false;
}

function regraDaCobertura(
  base: string,
  fatos: FatosDoTurno,
  contexto: {
    nomesDoCatalogo: readonly string[];
    mensagensDoPaciente: readonly string[];
  },
): Set<string> {
  const convenios = fatos.convenios.map(normalizarConvenio);
  const coberturas = fatos.coberturas.map((c) => ({
    ...normalizarConvenio(c),
    estado: c.estado,
    procedimento:
      c.procedimento === null
        ? null
        : palavrasDe(normalizarBase(c.procedimento)),
  }));
  const nomes = [
    ...new Set(
      convenios
        .flatMap((c) => [c.nome, ...(c.plano === null ? [] : [c.plano])])
        .filter((nome) => nome.length >= 2),
    ),
  ].sort((a, b) => b.length - a.length);
  const alvo = `(?:${[CONVENIO_GENERICO, ...nomes.map(escaparRegex)].join("|")})(?![a-z0-9])`;
  const citaConvenio = new RegExp(`(?<![a-z0-9])${alvo}`);
  const nomesDeConvenio = [...new Set([...nomes, ...OPERADORAS_CONHECIDAS])]
    .filter((nome) => nome.length >= 2)
    .sort((a, b) => b.length - a.length);
  // O catalogo que nao e convenio (procedimento, profissional, clinica) fica
  // mascarado no objeto: "trabalhamos com a Limpeza de pele" nao e convenio.
  // O nome que cita convenio (do Cadastro, operadora ou palavra generica)
  // nunca e mascarado.
  const naoConvenios = contexto.nomesDoCatalogo.filter(
    (nome) => !citaConvenio.test(normalizarBase(nome)),
  );
  const procedimentos = [
    ...new Set(fatos.procedimentos.map((p) => normalizarBase(p))),
  ]
    .filter((p) => p.length >= 3)
    .sort((a, b) => b.length - a.length);
  /**
   * Revisao final da AG3 (item 9): o paciente citou um convenio que nao e
   * do Cadastro nem uma operadora conhecida ("Voces aceitam Humana Saude?",
   * "meu plano e o X", "tenho Humana Saude"). A afirmacao generica
   * ("Aceitamos o seu plano, sim!", "Pode usar o seu convenio") passa a
   * precisar do fato dele, que nunca existe: o grupo vazio entra entre os do
   * paciente (antes, sem grupo, valia qualquer fato do turno, de outro
   * convenio). E a pergunta dele e de convenio ("Aceitamos, sim!" responde).
   */
  const pacienteCitouConvenioNaoReconhecido = contexto.mensagensDoPaciente.some(
    (mensagem) =>
      convenioNaoReconhecidoNaMensagem(
        normalizarBase(mensagem),
        nomesDeConvenio,
        naoConvenios,
      ),
  );
  const pacienteFalouDeConvenio =
    pacienteCitouConvenioNaoReconhecido ||
    contexto.mensagensDoPaciente.some((mensagem) => {
      const lida = normalizarBase(mensagem);
      return CONVENIO_NA_MENSAGEM.test(lida) || citaConvenio.test(lida);
    });

  /**
   * Os convenios que a frase cita, em grupos: cada grupo e um nome citado
   * (uma operadora do Cadastro, ou uma operadora conhecida, que vale pelos
   * convenios do Cadastro com esse nome e, fora do Cadastro, por nenhum).
   */
  const operadorasDoCadastro = [...new Set(convenios.map((c) => c.nome))]
    .filter((nome) => nome.length >= 2)
    .sort((a, b) => b.length - a.length);
  const conhecidas = [...OPERADORAS_CONHECIDAS].sort(
    (a, b) => b.length - a.length,
  );
  /** Os planos de um grupo que o texto cita ("Unimed Nacional"). */
  const planosNoTexto = (
    texto: string,
    grupo: readonly ConvenioNormalizado[],
  ): string[] =>
    grupo.flatMap((c) =>
      c.plano !== null && contem(texto, c.plano) ? [c.plano] : [],
    );

  /**
   * As mencoes de convenio pelo nome, com a posicao: cada uma e um grupo
   * (uma operadora do Cadastro, ou uma operadora conhecida, que vale pelos
   * convenios do Cadastro com esse nome e, fora do Cadastro, por nenhum: o
   * grupo vazio nunca e sustentado). O nome mais comprido primeiro, e o
   * trecho citado nao cita outro: "Unimed Fortaleza" nao cita tambem a
   * "Unimed" do Cadastro.
   */
  const mencoesPeloNome = (texto: string): MencaoDeConvenio[] => {
    const mencoes: MencaoDeConvenio[] = [];
    const ocupado = (inicio: number, fim: number) =>
      mencoes.some((m) => inicio < m.fim && fim > m.inicio);
    const nomesCitaveis: [string, ConvenioNormalizado[]][] = [
      ...operadorasDoCadastro.map((nome): [string, ConvenioNormalizado[]] => [
        nome,
        convenios.filter((c) => c.nome === nome),
      ]),
      ...conhecidas.map((conhecida): [string, ConvenioNormalizado[]] => [
        conhecida,
        convenios.filter((c) => contem(c.nome, conhecida)),
      ]),
    ];
    for (const [nome, grupo] of nomesCitaveis) {
      if (nome.length < 2) {
        continue;
      }
      for (const m of texto.matchAll(regexDoNome(nome, "g"))) {
        const inicio = m.index ?? 0;
        const fim = inicio + m[0].length;
        if (ocupado(inicio, fim)) {
          continue;
        }
        mencoes.push({
          inicio,
          fim,
          grupo: { convenios: grupo, planos: planosNoTexto(texto, grupo) },
        });
      }
    }
    return mencoes.sort((a, b) => a.inicio - b.inicio);
  };

  /** Os grupos que o texto cita pelo nome (um por operadora). */
  const gruposCitados = (texto: string): GrupoCitado[] => {
    const vistos = new Map<string, GrupoCitado>();
    for (const { grupo } of mencoesPeloNome(texto)) {
      if (grupo === null) {
        continue;
      }
      const chave = grupo.convenios
        .map((c) => `${c.nome}/${c.plano ?? ""}`)
        .sort()
        .join("|");
      const visto = vistos.get(chave);
      if (visto === undefined) {
        vistos.set(chave, { convenios: grupo.convenios, planos: grupo.planos });
      } else {
        visto.planos = [...new Set([...visto.planos, ...grupo.planos])];
      }
    }
    return [...vistos.values()];
  };

  /**
   * Revisao 2: o convenio de quem fala sem nome ("o seu plano", "pode ser
   * pelo convenio") e o que o paciente citou nas mensagens novas e o que o
   * proprio rascunho cita em outra frase. Sem nenhum, qualquer fato do
   * turno com o estado pedido.
   */
  const gruposDoGenerico = gruposCitados(
    [...contexto.mensagensDoPaciente.map((m) => normalizarBase(m)), base].join(
      " . ",
    ),
  );

  /** Os procedimentos do Cadastro que a frase cita (o mais comprido antes). */
  const procedimentosCitados = (frase: string): string[][] => {
    let resto = frase;
    const citadosNaFrase: string[][] = [];
    for (const procedimento of procedimentos) {
      if (contem(resto, procedimento)) {
        citadosNaFrase.push(palavrasDe(procedimento));
        resto = semONome(resto, procedimento);
      }
    }
    return citadosNaFrase;
  };

  /**
   * Revisao 2: as palavras dos procedimentos do Cadastro que distinguem um
   * procedimento ("limpeza" de "Limpeza de pele", "peeling"), para ler o
   * procedimento citado em parte ("a limpeza e coberta").
   */
  const palavrasDosProcedimentos = new Set(
    procedimentos
      .flatMap((p) => palavrasDe(p))
      .filter(
        (p) =>
          p.length >= 4 &&
          !OBJETO_GENERICO_DE_COBRE.has(p) &&
          !FUNCAO_NO_OBJETO.has(p) &&
          !CONVENIO_NO_OBJETO.has(p) &&
          !NAO_E_CONVENIO.has(p),
      ),
  );
  const procedimentosParciais = (frase: string): string[][] => {
    let resto = frase;
    for (const procedimento of procedimentos) {
      resto = semONome(resto, procedimento);
    }
    return [
      ...new Set(
        palavrasDe(resto).filter((p) => palavrasDosProcedimentos.has(p)),
      ),
    ].map((p) => [p]);
  };

  /**
   * Revisao 2: as palavras de um trecho (o sujeito de "e coberto", o objeto
   * de "cobertura para", o complemento de "aceitamos X para") que citam
   * procedimento: sem o catalogo que nao e convenio, sem os procedimentos
   * do Cadastro (ja lidos inteiros na frase), sem os convenios e sem o que
   * nao e procedimento (horario, lugar, gente).
   */
  const palavrasDeProcedimento = (trecho: string): string[] =>
    procedimentoNoObjeto(
      mascararNomes(trecho, [
        ...naoConvenios,
        ...procedimentos,
        ...nomesDeConvenio,
      ]),
    ).filter((p) => !NAO_E_CONVENIO.has(p));

  /**
   * A afirmacao tem fato? Cada grupo citado precisa de um fato com o estado
   * pedido (com o plano, quando o texto cita o plano) e, quando a frase cita
   * procedimento, do fato desse procedimento. Sem grupo, o turno precisa de
   * algum fato com o estado (do procedimento citado).
   */
  const sustentadaPorGrupos = (
    grupos: readonly GrupoCitado[],
    estados: readonly EstadoDaCobertura[],
    mencoes: readonly string[][],
  ): boolean => {
    const candidatas = coberturas.filter((c) => estados.includes(c.estado));
    const doProcedimento = (lista: typeof candidatas) =>
      mencoes.length === 0
        ? lista.length > 0
        : mencoes.every((mencao) =>
            lista.some(
              (c) =>
                c.procedimento !== null &&
                mencao.every((palavra) => c.procedimento?.includes(palavra)),
            ),
          );
    if (grupos.length === 0) {
      return doProcedimento(candidatas);
    }
    return grupos.every((grupo) => {
      const nomesDoGrupo = new Set(grupo.convenios.map((c) => c.nome));
      const doGrupo = candidatas.filter((c) => nomesDoGrupo.has(c.nome));
      return doProcedimento(
        grupo.planos.length === 0
          ? doGrupo
          : doGrupo.filter(
              (c) => c.plano !== null && grupo.planos.includes(c.plano),
            ),
      );
    });
  };
  const gruposDaAfirmacaoGenerica: readonly GrupoCitado[] =
    pacienteCitouConvenioNaoReconhecido
      ? [...gruposDoGenerico, { convenios: [], planos: [] }]
      : gruposDoGenerico;
  /**
   * Os grupos que a frase cita pelo nome; sem nenhum, os do paciente e os
   * do resto do rascunho (revisao 2: "o seu plano cobre" so com o fato de
   * cada convenio que o paciente citou).
   */
  const sustentada = (
    frase: string,
    estados: readonly EstadoDaCobertura[],
    mencoes: readonly string[][],
  ): boolean => {
    const grupos = gruposCitados(frase);
    return sustentadaPorGrupos(
      grupos.length > 0 ? grupos : gruposDaAfirmacaoGenerica,
      estados,
      mencoes,
    );
  };
  /** Sem convenio ativo no Cadastro, a negativa e verdade sem ferramenta. */
  const negativaSustentada = (frase: string, mencoes: readonly string[][]) =>
    fatos.semConvenioAtivo || sustentada(frase, ["nao_atende"], mencoes);

  const regras = new Set<string>();
  const padroes = PADROES_DE_COBERTURA.map((padrao) => ({
    padrao,
    regex: new RegExp(padrao.fonte(alvo), "g"),
  }));
  /** O procedimento citado no trecho, como mencao (nada: nenhuma). */
  const comOTrecho = (
    doCatalogo: readonly string[][],
    trecho: string,
  ): string[][] => {
    const palavras = palavrasDeProcedimento(trecho).filter(
      (p) => !LUGAR_OU_PRECO_COBERTO.has(p),
    );
    return palavras.length === 0 ? [...doCatalogo] : [...doCatalogo, palavras];
  };
  for (const { texto: frase } of frasesComPosicao(base)) {
    const doCatalogo = procedimentosCitados(frase);
    const temContextoDeConvenio =
      citaConvenio.test(frase) || pacienteFalouDeConvenio;
    // Revisao 2: o que esta frase ja barrou (a regra do convenio citado so
    // roda na frase que as regras de verbo deixaram passar).
    let barrouNaFrase = false;
    const anotar = (regra: string) => {
      regras.add(regra);
      barrouNaFrase = true;
    };
    if (
      temContextoDeConvenio &&
      SEM_COBERTURA.test(frase) &&
      !negativaSustentada(frase, doCatalogo)
    ) {
      anotar("negativa_sem_fato");
    }
    const afirmar = (
      antes: string,
      alegacao: Alegacao,
      mencoes: readonly string[][],
      desconhecidas: readonly string[],
    ) => {
      if (CONDICAO_ANTES.test(antes)) {
        return;
      }
      if (NEGACAO_DO_CONVENIO.test(antes)) {
        if (
          !fatos.semConvenioAtivo &&
          (desconhecidas.length > 0 || !negativaSustentada(frase, mencoes))
        ) {
          anotar("negativa_sem_fato");
        }
        return;
      }
      const estados: readonly EstadoDaCobertura[] =
        alegacao === "cobre" ? ["coberto"] : ["coberto", "atende"];
      if (desconhecidas.length > 0 || !sustentada(frase, estados, mencoes)) {
        anotar(
          alegacao === "cobre" ? "cobertura_sem_fato" : "aceitacao_sem_fato",
        );
      }
    };

    // Pelo convenio citado.
    for (const { padrao, regex } of padroes) {
      for (const m of frase.matchAll(regex)) {
        afirmar(frase.slice(0, m.index ?? 0), padrao.alegacao, doCatalogo, []);
      }
    }

    // Pelo objeto: "aceitamos Bradesco", "atendemos pela Camed".
    for (const padrao of PADROES_PELO_OBJETO) {
      for (const m of frase.matchAll(padrao.regex)) {
        const inicio = m.index ?? 0;
        const fimDoVerbo = inicio + m[0].length;
        const objetoBruto = objetoDepois(frase, fimDoVerbo);
        const objeto = mascararNomes(objetoBruto, naoConvenios);
        const analise = analisarObjeto(objeto, nomesDeConvenio);
        // "Aceitamos, sim!" respondendo a quem perguntou do convenio: o
        // objeto e o da pergunta.
        const respondeAPergunta = analise.vazio && pacienteFalouDeConvenio;
        if (!analise.citaConvenio && !respondeAPergunta) {
          if (
            padrao.objeto === "convenio" ||
            analise.desconhecidas.length === 0
          ) {
            continue;
          }
        }
        // Revisao 2: o procedimento entre o verbo e o "pelo" ("atendemos
        // a limpeza pelo convenio") e o do complemento ("aceitamos Unimed
        // para o peeling").
        const entre =
          padrao.nome === "atende_pelo"
            ? m[0].replace(/^\S+/, " ").replace(/\bpel[oa]s?\s*$/, " ")
            : "";
        const complemento =
          /^\s*(?:para|pra|no|na|nos|nas|em)\b([^.;:!?,]*)/.exec(
            frase.slice(fimDoVerbo + objetoBruto.length),
          )?.[1] ?? "";
        afirmar(
          frase.slice(0, inicio),
          "aceita",
          comOTrecho(doCatalogo, `${entre} , ${complemento}`),
          padrao.objeto === "todo" ? analise.desconhecidas : [],
        );
      }
    }

    // "Cobre": o sujeito diz se e convenio ("O valor de R$ 300 cobre a
    // consulta" nao e); sem sujeito ("Cobre, sim") e convenio. O objeto
    // diz o procedimento ("cobre o ultrassom").
    for (const m of frase.matchAll(/\bcobrem?\b/g)) {
      const inicio = m.index ?? 0;
      const sujeito = mascararNomes(sujeitoAntes(frase, inicio), naoConvenios);
      const palavrasDoSujeito = palavrasDe(
        sujeito.replace(PLANO_QUE_NAO_E_CONVENIO, " \u00a7 "),
      );
      if (palavrasDoSujeito.some((p) => SUJEITO_QUE_NAO_E_CONVENIO.has(p))) {
        continue;
      }
      const analise = analisarObjeto(sujeito, nomesDeConvenio);
      afirmar(
        frase.slice(0, inicio),
        "cobre",
        comOTrecho(doCatalogo, objetoDepois(frase, inicio + m[0].length)),
        analise.desconhecidas,
      );
    }

    // "Coberto": com convenio na frase (ou na pergunta do paciente), ou com
    // o verbo de ligacao ("o procedimento e coberto"), fora de lugar e de
    // preco. Revisao 2: o sujeito diz o procedimento ("a limpeza e
    // coberta"), como o objeto de "cobre".
    for (const m of frase.matchAll(COBERTO)) {
      const inicio = m.index ?? 0;
      const antes = frase.slice(0, inicio);
      if (!temContextoDeConvenio) {
        if (!VERBO_ANTES_DE_COBERTO.test(antes)) {
          continue;
        }
        const sujeito = palavrasDe(sujeitoAntes(frase, inicio));
        if (sujeito.some((p) => LUGAR_OU_PRECO_COBERTO.has(p))) {
          continue;
        }
      }
      const agente = objetoDepois(frase, inicio + m[0].length);
      const analise = /^\s*pel[oa]s?\b/.test(agente)
        ? analisarObjeto(
            agente.replace(/^\s*pel[oa]s?\b/, " "),
            nomesDeConvenio,
          )
        : { citaConvenio: false, desconhecidas: [], vazio: true };
      afirmar(
        antes,
        "cobre",
        comOTrecho(
          doCatalogo,
          sujeitoAntes(frase, inicio).replace(VERBO_DE_LIGACAO_NO_FIM, " "),
        ),
        analise.desconhecidas,
      );
    }

    // "Cobertura": com convenio na frase (ou na pergunta do paciente), ou
    // "tem cobertura". Revisao 2: o procedimento do objeto ("cobertura
    // para a limpeza") e do sujeito ("a limpeza tem cobertura").
    for (const m of frase.matchAll(COBERTURA)) {
      const inicio = m.index ?? 0;
      const antes = frase.slice(0, inicio);
      if (!temContextoDeConvenio && !TER_COBERTURA.test(antes)) {
        continue;
      }
      const depois =
        /^\s*(?:para|pra|de|do|da|dos|das|no|na|em)\b([^.;:!?,]*)/.exec(
          frase.slice(inicio + m[0].length),
        )?.[1] ?? "";
      const sujeito = sujeitoAntes(frase, inicio).replace(
        VERBO_DE_LIGACAO_NO_FIM,
        " ",
      );
      afirmar(
        antes,
        "cobre",
        comOTrecho(doCatalogo, `${sujeito} , ${depois}`),
        [],
      );
    }

    // Revisao 2 (regra invertida): a frase afirmativa que cita convenio
    // (nome do Cadastro, operadora conhecida ou as palavras convenio, plano,
    // conveniado, credenciado, parceira) exige o fato daquele convenio, com
    // qualquer verbo ("Temos convenio com a Unimed", "Somos conveniados a
    // Unimed", "A Bradesco Saude e parceira da clinica").
    if (!barrouNaFrase) {
      const regra = convenioCitadoSemFato(frase, doCatalogo, {
        mencoesPeloNome,
        gruposDoGenerico: gruposDaAfirmacaoGenerica,
        procedimentosParciais,
        sustentadaPorGrupos,
        nomesDeConvenio,
        semConvenioAtivo: fatos.semConvenioAtivo,
      });
      if (regra !== null) {
        anotar(regra);
      }
    }
  }
  return regras;
}

/**
 * Revisao 2 da AG2: a regra invertida do convenio numa frase, com o que a
 * regra da cobertura ja leu do turno (os grupos, a sustentacao e os
 * procedimentos citados em parte).
 */
type LeituraDaCobertura = {
  mencoesPeloNome: (texto: string) => MencaoDeConvenio[];
  gruposDoGenerico: readonly GrupoCitado[];
  procedimentosParciais: (frase: string) => string[][];
  sustentadaPorGrupos: (
    grupos: readonly GrupoCitado[],
    estados: readonly EstadoDaCobertura[],
    mencoes: readonly string[][],
  ) => boolean;
  nomesDeConvenio: readonly string[];
  semConvenioAtivo: boolean;
};

/**
 * A regra invertida numa frase. Fica de fora a pergunta de verdade, o
 * convenio dentro de condicao ou de pergunta indireta ("se o seu plano
 * cobrir", "vou ver se o convenio"), o que pede o convenio ("qual e o seu
 * convenio?", "me diga o plano"), o complemento de documento ou de
 * pagamento ("carteirinha do convenio", "cartao de qualquer operadora") e o
 * lugar conveniado ("estacionamento conveniado"). Sem nome na frase, o
 * convenio e o que o paciente citou ou o que o rascunho cita em outra
 * frase. A frase que nega ("nao atendemos", "a Unimed nao esta entre os
 * nossos convenios", "fora da cobertura") so passa com a negativa do fato
 * ou sem convenio ativo no Cadastro.
 */
function convenioCitadoSemFato(
  frase: string,
  doCatalogo: readonly string[][],
  leitura: LeituraDaCobertura,
): string | null {
  if (ehPerguntaDeVerdade(frase)) {
    return null;
  }
  const mencoes = [...leitura.mencoesPeloNome(frase)];
  for (const m of frase.matchAll(MENCAO_GENERICA_DE_CONVENIO)) {
    const inicio = m.index ?? 0;
    const fim = inicio + m[0].length;
    if (!mencoes.some((n) => inicio < n.fim && fim > n.inicio)) {
      mencoes.push({ inicio, fim, grupo: null });
    }
  }
  const valem = mencoes.filter((mencao) => {
    const antes = frase.slice(0, mencao.inicio);
    if (
      CONDICAO_ANTES.test(antes) ||
      SABER_ANTES.test(antes) ||
      PEDIDO_ANTES.test(antes) ||
      COMPLEMENTO_ANTES.test(antes)
    ) {
      return false;
    }
    return !(
      mencao.grupo === null &&
      /^(?:conveniad|credenciad|parceir)/.test(
        frase.slice(mencao.inicio, mencao.fim),
      ) &&
      LUGAR_ANTES_DO_CONVENIADO.test(antes)
    );
  });
  if (valem.length === 0) {
    return null;
  }
  const pelosNomes = valem.flatMap((m) => (m.grupo === null ? [] : [m.grupo]));
  // So a palavra generica numa frase que pede o convenio ("Para convenio,
  // preciso saber qual e o seu plano"): e pedido, nao afirmacao.
  if (pelosNomes.length === 0 && PEDIDO_NA_FRASE.test(frase)) {
    return null;
  }
  const grupos = pelosNomes.length > 0 ? pelosNomes : leitura.gruposDoGenerico;
  const procedimentosDaFrase = [
    ...doCatalogo,
    ...leitura.procedimentosParciais(frase),
  ];
  if (negaConvenio(frase, leitura.nomesDeConvenio)) {
    return leitura.semConvenioAtivo ||
      leitura.sustentadaPorGrupos(grupos, ["nao_atende"], procedimentosDaFrase)
      ? null
      : "negativa_sem_fato";
  }
  return leitura.sustentadaPorGrupos(
    grupos,
    ["coberto", "atende"],
    procedimentosDaFrase,
  )
    ? null
    : "convenio_citado_sem_fato";
}

/** Uma operadora citada pelo nome e os planos dela que o texto cita. */
type GrupoCitado = { convenios: ConvenioNormalizado[]; planos: string[] };

/** Uma mencao de convenio na frase: pelo nome (o grupo) ou generica (nulo). */
type MencaoDeConvenio = {
  inicio: number;
  fim: number;
  grupo: GrupoCitado | null;
};

/**
 * Revisao 2 da AG2: as palavras genericas que citam convenio na regra
 * invertida ("convenio", "plano", "conveniado", "credenciado", "parceira",
 * "operadora", "seguro saude"), fora de "plano de tratamento" e "plano de
 * pagamento".
 */
const MENCAO_GENERICA_DE_CONVENIO = new RegExp(
  `(?<![a-z0-9])(?:convenios?|conveniad[oa]s?|credenciad[oa]s?|parceir[oa]s?|parcerias?|operadoras?|seguro saude|planos?(?!\\s+de\\s+(?:tratamento|pagamento|acao|saude bucal))${NAO_E_PLANO_DE_FAZER})(?![a-z0-9])`,
  "g",
);
/** Pergunta indireta: "vou ver se o seu convenio", "nao sei informar se". */
const SABER_ANTES =
  /\b(?:ver|veja|vejo|verificar|verifique|verifico|consultar|consulte|consulto|conferir|confira|confiro|checar|cheque|saber|sei|informar|informe|descobrir|perguntar|pergunte|confirmar|confirme)\b(?:\s+[^\s,;:.!?]+){0,4}\s*$/;
/** O que pede o convenio: "qual e o seu convenio", "me diga o plano". */
const PEDIDO_ANTES =
  /\b(?:qual|quais|nome|me\s+(?:diga|diz|informe|informa|passe|passa|fale|fala|mande|manda|envie|envia|conte|conta))\b(?:\s+[^\s,;:.!?]+){0,5}\s*$/;
/** A frase que pede o convenio ou o plano da pessoa. */
const PEDIDO_NA_FRASE =
  /\b(?:qual|quais|preciso saber|precisamos saber|preciso do nome|me\s+(?:diga|diz|informe|informa|passe|passa|fale|fala|mande|manda|envie|envia|conte|conta)|informe|poderia\s+(?:me\s+)?(?:dizer|informar|passar))\b/;
/**
 * Documento ou pagamento do convenio: "carteirinha do convenio",
 * "autorizacao previa do convenio", "cartao de qualquer operadora".
 */
const COMPLEMENTO_ANTES =
  /\b(?:carteirinha|carteirinhas|carteira|carteiras|cartao|cartoes|autorizacao|autorizacoes|guia|guias|senha|senhas|pedido|pedidos|numero|token|codigo|bandeira|bandeiras|maquininha)(?:\s+[^\s,;:.!?]+){0,2}?\s+(?:de|do|da|dos|das)\s+(?:(?:seu|sua|seus|suas|o|a|os|as|qualquer|cada|esse|essa|este|esta)\s+){0,2}$/;
/** O lugar conveniado: "estacionamento conveniado", "farmacia parceira". */
const LUGAR_ANTES_DO_CONVENIADO =
  /\b(?:estacionamento|estacionamentos|garagem|garagens|vaga|vagas|local|area|espaco|lugar|patio|farmacia|farmacias|laboratorio|laboratorios|hotel|hoteis|restaurante|restaurantes|loja|lojas|academia|academias)\s+$/;
/** O verbo de ligacao no fim do sujeito ("a limpeza e", "a limpeza tem"). */
const VERBO_DE_LIGACAO_NO_FIM =
  /\b(?:e|eh|sao|esta|estao|fica|ficam|seria|sera|serao|foi|foram|tem|possui|possuem|ha|tera|teria)\s+(?:(?:sim|tambem|totalmente|integralmente|parcialmente)\s+)?$/;

/** O verbo de convenio que a negacao rege ("nao atendemos", "nao cobre"). */
const VERBO_DE_CONVENIO =
  /^(?:atend|aceit|trabalh|cobr|conveniad|credenciad|parceir|inclu|consta)/;
/** O verbo de ligacao que so nega convenio com convenio logo depois. */
const LIGACAO_DE_CONVENIO = new Set([
  "e",
  "eh",
  "sao",
  "esta",
  "estao",
  "somos",
  "sou",
  "ficou",
  "fica",
  "temos",
  "tem",
  "ha",
  "havera",
  "possui",
  "possuimos",
  "possuem",
  "existe",
  "existem",
  "faz",
  "fazem",
  "fazemos",
]);
/** O que diz que a ligacao e de convenio ("nao esta ENTRE os convenios"). */
const DEPOIS_DA_LIGACAO_DE_CONVENIO =
  /^(?:entre|parte|conveniad|credenciad|parceir|convenio|plano|operadora|cobert|rede|com)/;

/**
 * A frase nega convenio: "sem cobertura" e "fora da rede", ou a palavra
 * que nega rege um verbo de convenio ("nao atendemos", "nao cobre") ou uma
 * ligacao seguida de convenio ("nao temos convenio", "a Unimed nao esta
 * entre os nossos convenios"). "Nao se preocupe, somos conveniados" e "nao
 * tem problema, pode usar o convenio" nao negam.
 */
function negaConvenio(frase: string, nomes: readonly string[] = []): boolean {
  if (SEM_COBERTURA.test(frase)) {
    return true;
  }
  const palavras = frase
    .split(/([,;:.!?()])|\s+/)
    .filter((p): p is string => p !== undefined && p.trim() !== "");
  for (let i = 0; i < palavras.length; i += 1) {
    if (!/^(?:nao|nem|nunca|jamais|nenhum|nenhuma)$/.test(palavras[i] ?? "")) {
      continue;
    }
    let j = i + 1;
    while (
      j < palavras.length &&
      j <= i + 2 &&
      /^(?:te|lhe|me|mais|ainda|mesmo|tambem|o|a|os|as)$/.test(
        palavras[j] ?? "",
      )
    ) {
      j += 1;
    }
    const cabeca = palavras[j] ?? "";
    if (
      VERBO_DE_CONVENIO.test(cabeca) ||
      /^(?:convenios?|planos?)$/.test(cabeca)
    ) {
      return true;
    }
    if (!LIGACAO_DE_CONVENIO.has(cabeca)) {
      continue;
    }
    for (let k = j + 1; k <= j + 4 && k < palavras.length; k += 1) {
      const palavra = palavras[k] ?? "";
      if (/^[,;:.!?()]$/.test(palavra)) {
        break;
      }
      if (
        DEPOIS_DA_LIGACAO_DE_CONVENIO.test(palavra) ||
        nomes.some((nome) => nome.split(" ")[0] === palavra)
      ) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// A regra
// ---------------------------------------------------------------------------

function semTextosColados(
  rascunho: string,
  colados: readonly string[],
): string {
  let texto = rascunho;
  for (const colado of colados) {
    const limpo = colado.trim();
    if (limpo !== "") {
      texto = texto.split(limpo).join("\n");
    }
  }
  return texto;
}

/**
 * As regras dos fatos no rascunho. Devolve os achados (vazio = nenhuma
 * regra dos fatos achou nada; isso NAO e aprovacao).
 */
export function regrasDosFatos(
  rascunho: string,
  contexto: {
    fatos: FatosDoTurno;
    nomesDoCatalogo: readonly string[];
    mensagensDoPaciente: readonly string[];
  },
): AchadoDosFatos[] {
  const { fatos } = contexto;
  const achados: AchadoDosFatos[] = [];
  const base = normalizarBase(semTextosColados(rascunho, fatos.textosColados));
  const mascarada = mascararNomes(base, contexto.nomesDoCatalogo);
  const frases = frasesComPosicao(mascarada);

  // Data e hora. A ferramenta e o texto publicado valem em qualquer frase;
  // a mensagem nova do paciente, so na que nega horario ou e pergunta de
  // verdade (revisao 2: "anotado: as 15h, certo?" e "nao tem problema, as
  // 15h" nao valem).
  const doRascunho = temporaisDoTexto(mascarada, "rascunho");
  let foraDosFatos: TemporalLido[] = [];
  if (doRascunho.length > 0) {
    const ler = (textos: readonly string[]) => {
      const lidos = textos.map((texto) =>
        datasEHorasDoTexto(normalizarBase(texto), "fonte"),
      );
      return {
        datas: lidos.flatMap((l) => l.datas),
        horas: new Set(lidos.flatMap((l) => l.horas)),
      };
    };
    const fortes = ler([
      ...fatos.saidasDasFerramentas,
      ...fatos.horariosLivres.map((h) => `${h.dia} ${h.hora}`),
      ...fatos.textosPublicados,
    ]);
    // Revisao final da AG3 (item 5): o eco do pedido (a hora e o dia que a
    // pessoa pediu, e o que reservar_horario recusou) vale como a mensagem
    // do paciente: so na frase que nega ou pergunta.
    const doPaciente = ler([
      ...contexto.mensagensDoPaciente,
      ...fatos.ecosDoPedido,
    ]);
    const naFonte = (
      lido: TemporalLido,
      fonte: { datas: DataLida[]; horas: Set<string> },
    ) =>
      lido.tipo === "data"
        ? dataNosFatos(lido.data, fonte.datas, fatos.anoCorrente)
        : fonte.horas.has(lido.hora);
    const vale = (lido: TemporalLido) => {
      if (naFonte(lido, fortes)) {
        return true;
      }
      const frase = fraseNoIndice(frases, lido.indice);
      return (
        frase !== undefined &&
        aceitaODitoPeloPaciente(frase) &&
        naFonte(lido, doPaciente)
      );
    };
    foraDosFatos = doRascunho.filter((lido) => !vale(lido));
    if (foraDosFatos.some((lido) => lido.tipo === "data")) {
      achados.push({
        categoria: "horario_nao_verificado",
        regra: "data_fora_dos_fatos",
      });
    }
    if (foraDosFatos.some((lido) => lido.tipo === "hora")) {
      achados.push({
        categoria: "horario_nao_verificado",
        regra: "hora_fora_dos_fatos",
      });
    }
  }

  // Horario livre: so com o horario livre da ferramenta, em par.
  const livres = fatos.horariosLivres
    .map((h) => horarioLivreLido(h, fatos.anoCorrente))
    .filter((h): h is HorarioLivreLido => h !== null);
  // A oferta de horario sem dia nem hora passa para a frase seguinte
  // ("Tenho estes horarios com a Dra. Ana. Terca as 14h ou quarta as 9h.").
  // So a que fala de agenda: "Temos sim, na rua ao lado" nao passa.
  let ofertaAnterior = false;
  let semFerramenta = false;
  const frasesQueOferecem = new Set<number>();
  frases.forEach((frase, indice) => {
    const afirmaAqui = afirmaHorarioLivre(frase.texto);
    const afirma =
      afirmaAqui ||
      (ofertaAnterior &&
        !fraseNegaHorario(frase.texto) &&
        !fraseDizQueNaoEstaLivre(frase.texto));
    if (!afirma) {
      ofertaAnterior = false;
      return;
    }
    frasesQueOferecem.add(indice);
    const pares = paresDaOferta(partesDaOferta(mascarada, frase, fatos.hoje));
    ofertaAnterior =
      pares.length === 0 && afirmaAqui && FALA_DE_AGENDA.test(frase.texto);
    if (pares.length === 0) {
      // Revisao 2: a disponibilidade sem dia nem hora ("temos vagas essa
      // semana", "tem horario livre sim", "consigo sim") so passa com algum
      // horario livre que a ferramenta de agenda trouxe no turno.
      if (
        afirmaAqui &&
        livres.length === 0 &&
        afirmaDisponibilidadeSemData(frase.texto)
      ) {
        semFerramenta = true;
      }
      return;
    }
    if (
      pares.some(
        (par) => !livres.some((livre) => parNoHorarioLivre(par, livre)),
      )
    ) {
      semFerramenta = true;
    }
  });
  if (semFerramenta) {
    achados.push({
      categoria: "horario_nao_verificado",
      regra: "horario_livre_sem_ferramenta",
    });
  }

  // Revisao 2: em TODA frase com dia e hora, nao so na oferta, o dia e a
  // hora tem de vir JUNTOS de uma fonte ("A quinta, 23/10, as 9h30 ainda
  // esta em aberto", "Quinta as 14h da", com a busca trazendo quarta, 22/10
  // as 9h30 e quinta, 23/10 as 16h15, sao barradas). A data ou a hora fora
  // dos fatos ja barrou acima; a oferta ja conferiu com os horarios livres.
  if (foraDosFatos.length === 0) {
    let fontes: TrechoDaFonte[] | null = null;
    let doPaciente: TrechoDaFonte[] | null = null;
    const trechosFortes = () => {
      fontes = fontes ?? trechosDasFontes(fatos);
      return fontes;
    };
    const trechosDoPaciente = () => {
      doPaciente =
        doPaciente ??
        [...contexto.mensagensDoPaciente, ...fatos.ecosDoPedido].flatMap(
          (mensagem) => trechosDasFrases(normalizarBase(mensagem), fatos.hoje),
        );
      return doPaciente;
    };
    const parSolto = frases.some((frase, indice) => {
      if (frasesQueOferecem.has(indice)) {
        return false;
      }
      const pares = paresDaOferta(
        partesDaOferta(mascarada, frase, fatos.hoje),
      ).filter((par) => par.data !== null && par.hora !== null);
      if (pares.length === 0) {
        return false;
      }
      const comPaciente = aceitaODitoPeloPaciente(frase);
      return pares.some(
        (par) =>
          !trechosFortes().some((t) =>
            parNoTrecho(par, t, fatos.anoCorrente),
          ) &&
          !(
            comPaciente &&
            trechosDoPaciente().some((t) =>
              parNoTrecho(par, t, fatos.anoCorrente),
            )
          ),
      );
    });
    if (parSolto) {
      achados.push({
        categoria: "horario_nao_verificado",
        regra: "par_fora_dos_fatos",
      });
    }
  }

  // Endereco. Na fonte, a pontuacao do JSON da ferramenta vira espaco
  // ('"endereco":"Rua X, 100"' e '"logradouro":"Rua X","numero":"100"').
  const enderecos = enderecosDoTexto(base);
  if (enderecos.length > 0) {
    const dosFatos = enderecosDasFontes([
      ...fatos.saidasDasFerramentas,
      ...fatos.textosPublicados,
    ]);
    if (enderecos.some((e) => !enderecoNosFatos(e, dosFatos))) {
      achados.push({
        categoria: "endereco_nao_verificado",
        regra: "endereco_fora_dos_fatos",
      });
    }
  }

  // Acao e estado da consulta. O diminutivo e o participio ("ficou
  // agendadinho"; revisao curta das correcoes da AG3, o superlativo:
  // "confirmadissimo").
  const acoes = new Set(fatos.acoes);
  // Revisao final da AG3: a consulta que a IA marcou nesta conversa, relida
  // no turno (o estado do atendimento), sustenta "ficou marcada" e "foi
  // marcada" no turno seguinte ao da marcacao.
  const marcadaNestaConversa = fatos.consultasLidas.some(
    (c) => c.marcadaNestaConversa,
  );
  // AG4: a remarcacao que a IA pediu nesta conversa, relida no turno (ainda
  // pendente), sustenta "foi remarcada" no turno seguinte ao do pedido.
  const remarcadaNestaConversa = fatos.consultasLidas.some(
    (c) => c.remarcadaNestaConversa === true,
  );
  // Revisao da AG4 (achado 7): a remarcacao pedida nesta conversa e ja
  // aprovada pela equipe tambem sustenta "foi remarcada" (sem a pendencia),
  // e a consulta que a IA cancelou nesta conversa, relida e ainda
  // cancelada, sustenta "foi cancelada"; as duas so com o par delas.
  const remarcacaoAprovada = fatos.consultasLidas.some(
    (c) => c.remarcacaoAprovada === true,
  );
  const canceladas = fatos.consultasCanceladas ?? [];
  const acoesSemFerramenta = new Set<string>();
  const semDiminutivo = semFlexaoDoParticipio(mascarada);
  const frasesSemDiminutivo = frasesComPosicao(semDiminutivo);
  /** A frase tem a agenda (dia, hora, "horario", "vaga", "agenda")? */
  const temAgenda = (frase: Frase) =>
    AGENDA_NA_FRASE.test(frase.texto) ||
    partesDaOferta(semDiminutivo, frase, fatos.hoje).some(
      (parte) => parte.tipo === "data" || parte.tipo === "hora",
    );
  /** As alegacoes sustentadas de cada frase (pelo indice): a acao ou o estado. */
  const alegadas = new Map<number, Set<AlegacaoDaFrase>>();
  for (const padrao of PADROES_DE_ACAO) {
    for (const m of semDiminutivo.matchAll(padrao.regex)) {
      const inicio = (m.index ?? 0) + (m[0].length - m[0].trimStart().length);
      if (negada(semDiminutivo, inicio)) {
        continue;
      }
      // Revisao 2: so a pergunta de verdade isenta o estado da consulta
      // ("Voce tem consulta amanha?"); "esta marcada para amanha, ok?"
      // afirma.
      const indiceDaFrase = frasesSemDiminutivo.findIndex(
        (f) => inicio >= f.inicio && inicio < f.fim,
      );
      const frase = frasesSemDiminutivo[indiceDaFrase];
      if (
        padrao.acao === null &&
        frase !== undefined &&
        ehPerguntaDeVerdade(frase.texto)
      ) {
        continue;
      }
      // Revisao curta das correcoes da AG3 (achado 6): "separei", "guardei" e
      // "bloqueei" so afirmam a reserva com a agenda na frase.
      if (
        padrao.soComAgendaNaFrase &&
        (frase === undefined || !temAgenda(frase))
      ) {
        continue;
      }
      // O estado da consulta vale com a consulta lida, marcada ou remarcada
      // no turno ("sua consulta ficou para quinta" depois de remarcar).
      const sustentada =
        padrao.acao === null
          ? fatos.consultaLida || acoes.has("marcou") || acoes.has("remarcou")
          : acoes.has(padrao.acao) ||
            (padrao.acao === "marcou" && marcadaNestaConversa) ||
            (padrao.acao === "remarcou" &&
              (remarcadaNestaConversa || remarcacaoAprovada)) ||
            (padrao.acao === "cancelou" && canceladas.length > 0);
      if (!sustentada) {
        acoesSemFerramenta.add(padrao.nome);
        continue;
      }
      if (indiceDaFrase >= 0) {
        const daFrase = alegadas.get(indiceDaFrase) ?? new Set();
        daFrase.add(padrao.acao ?? "estado");
        alegadas.set(indiceDaFrase, daFrase);
      }
    }
  }
  for (const nome of acoesSemFerramenta) {
    achados.push({
      categoria: "acao_nao_executada",
      regra: `${nome}_sem_ferramenta`,
    });
  }

  // Revisao final da AG3 (item 2): a frase da acao ou do estado da consulta
  // com dia ou hora so passa com o par DAQUELA acao ou da consulta lida
  // (reservou quarta 14h e a resposta diz "reservei quinta as 13h": barra,
  // mesmo com quinta 13h livre na busca). Revisao curta das correcoes: cada
  // fato leva o profissional e a unidade dele (achado 5).
  const lidos = (lista: readonly HorarioDoFato[]): FatoDaAgendaLido[] =>
    lista.flatMap((h) => {
      const lido = horarioLivreLido(h, fatos.anoCorrente);
      return lido === null
        ? []
        : [
            {
              ...lido,
              profissional: h.profissional ?? null,
              unidade: h.unidade,
            },
          ];
    });
  const daAcao = (...quais: AcaoDoTurno[]) =>
    lidos(fatos.horariosDasAcoes.filter((h) => quais.includes(h.acao)));
  const permitidosDaAlegacao = (
    alegacao: AlegacaoDaFrase,
  ): FatoDaAgendaLido[] => {
    switch (alegacao) {
      case "estado":
        return [
          ...lidos(fatos.consultasLidas),
          ...daAcao("marcou", "remarcou"),
        ];
      case "marcou":
        return [
          ...daAcao("marcou"),
          ...lidos(fatos.consultasLidas.filter((c) => c.marcadaNestaConversa)),
        ];
      case "confirmou_presenca":
        return [
          ...lidos(fatos.consultasLidas),
          ...daAcao("confirmou_presenca"),
        ];
      case "remarcou":
        // AG4: a remarcacao do turno ou a pedida nesta conversa, relida
        // (revisao da AG4, achado 7: pendente ou ja aprovada).
        return [
          ...daAcao("remarcou"),
          ...lidos(
            fatos.consultasLidas.filter(
              (c) =>
                c.remarcadaNestaConversa === true ||
                c.remarcacaoAprovada === true,
            ),
          ),
        ];
      case "cancelou":
        // Revisao da AG4 (achado 7): o cancelamento do turno ou o feito
        // nesta conversa num turno anterior, relido.
        return [...daAcao("cancelou"), ...lidos(canceladas)];
      default:
        return daAcao(alegacao);
    }
  };
  const foraDoParDaAcao = new Set<string>();
  /** Os fatos de cada frase de acao, de estado ou de fechamento licenciado. */
  const fatosDaFrase = new Map<number, FatoDaAgendaLido[]>();
  const juntarFatos = (indice: number, lista: readonly FatoDaAgendaLido[]) =>
    fatosDaFrase.set(indice, [...(fatosDaFrase.get(indice) ?? []), ...lista]);
  for (const [indice, daFrase] of alegadas) {
    const frase = frasesSemDiminutivo[indice];
    if (frase === undefined) {
      continue;
    }
    const permitidos = [...daFrase].flatMap(permitidosDaAlegacao);
    juntarFatos(indice, permitidos);
    const pares = paresDaOferta(
      partesDaOferta(semDiminutivo, frase, fatos.hoje),
    );
    if (pares.length === 0) {
      continue;
    }
    if (
      pares.some((par) => !permitidos.some((h) => parNoHorarioLivre(par, h)))
    ) {
      foraDoParDaAcao.add(
        daFrase.has("estado") && daFrase.size === 1
          ? "horario_da_consulta"
          : "horario_da_acao",
      );
    }
  }
  for (const regra of foraDoParDaAcao) {
    achados.push({ categoria: "acao_nao_executada", regra });
  }

  // Revisao 2 (regra estrutural), com a licenca pela acao (revisao final da
  // AG3, item 3): a frase com dia ou hora e marca de fechamento ("pronto",
  // "combinado", "ficou para", "te esperamos"...) afirma que algo foi feito
  // na agenda, seja qual for o verbo. A reserva viva do estado NAO libera
  // "te esperamos". Revisao curta das correcoes da AG3 (achados 4 e 7): o par
  // permitido depende do tipo da marca, e a frase passa so com o par que
  // TODAS as marcas dela permitem:
  //  - forte e compromisso: a consulta marcada ou remarcada no turno ou uma
  //    consulta lida, com o par delas (a consulta de quarta, lida, nao
  //    libera "te esperamos terca" da reserva nova de terca);
  //  - reserva: a reserva do turno, com o par dela (sem reserva no turno, a
  //    consulta marcada ou lida, com o par dela);
  //  - fraca, interjeicao, horario e resumo: a consulta marcada ou lida
  //    (com o par dela) ou a acao que a frase diz (com o par dela:
  //    "Combinado! Reservei quarta as 14h" passa com a reserva de quarta).
  if (acoesSemFerramenta.size === 0) {
    const licencaGeral =
      fatos.consultaLida || acoes.has("marcou") || acoes.has("remarcou");
    const paresGerais = [
      ...lidos(fatos.consultasLidas),
      ...daAcao("marcou", "remarcou"),
    ];
    const paresDaReserva = daAcao("reservou");
    let semLicenca = false;
    let foraDoPar = false;
    for (const fechamento of fechamentosDasFrases(
      semDiminutivo,
      frasesSemDiminutivo,
      fatos.hoje,
    )) {
      const daFrase = alegadas.get(fechamento.indice) ?? new Set();
      const reservaNaFrase =
        fechamento.tipos.has("reserva") && acoes.has("reservou");
      const acaoNaFrase = daFrase.size > 0 || reservaNaFrase;
      const daAcaoNaFrase = [
        ...[...daFrase].flatMap(permitidosDaAlegacao),
        ...(reservaNaFrase ? paresDaReserva : []),
      ];
      const permitidosDoTipo = (
        tipo: TipoDaMarca,
      ): FatoDaAgendaLido[] | null => {
        switch (tipo) {
          case "forte":
          case "compromisso":
            return licencaGeral ? paresGerais : null;
          case "reserva":
            // A outra acao dita na mesma frase ("reservei terca, e sua
            // consulta de quarta continua marcada") vale com o par dela
            // (a regra do par da acao ja confere).
            if (acoes.has("reservou")) {
              return [
                ...paresDaReserva,
                ...[...daFrase]
                  .filter((alegacao) => alegacao !== "reservou")
                  .flatMap(permitidosDaAlegacao),
              ];
            }
            return licencaGeral ? paresGerais : null;
          default:
            if (!licencaGeral && !acaoNaFrase) {
              return null;
            }
            return [
              ...(licencaGeral ? paresGerais : []),
              ...(acaoNaFrase ? daAcaoNaFrase : []),
            ];
        }
      };
      const porTipo = [...fechamento.tipos].map(permitidosDoTipo);
      if (porTipo.some((lista) => lista === null)) {
        semLicenca = true;
        continue;
      }
      const listas = porTipo.filter(
        (lista): lista is FatoDaAgendaLido[] => lista !== null,
      );
      juntarFatos(fechamento.indice, listas.flat());
      if (
        fechamento.pares.some((par) =>
          listas.some((lista) => !lista.some((h) => parNoHorarioLivre(par, h))),
        )
      ) {
        foraDoPar = true;
      }
    }
    if (semLicenca) {
      achados.push({
        categoria: "acao_nao_executada",
        regra: "fechamento_sem_acao",
      });
    }
    if (foraDoPar && !foraDoParDaAcao.has("horario_da_acao")) {
      achados.push({
        categoria: "acao_nao_executada",
        regra: "fechamento_fora_do_horario",
      });
    }
  }

  // AG4 (27/10/2026): a remarcacao que a IA pede nasce PENDENTE da aprovacao
  // da equipe, e a consulta antiga continua marcada ate la (D-10). A frase
  // que diz que remarcou (a acao, ou o estado ou o fechamento com o par da
  // consulta nova) so passa com a pendencia dita (PENDENCIA_DA_REMARCACAO):
  // "Remarquei para terca" sozinho barra. Revisao da AG4 (achado 5): a
  // pendencia na PROPRIA frase ou na frase logo depois dela (a T4: "Pronto,
  // pedi a remarcacao para ... Ate a equipe aprovar, ..."), nunca em
  // qualquer lugar da mensagem; a frase que afirma a aprovacao ou nega a
  // pendencia (APROVACAO_AFIRMADA) nunca conta, e com a remarcacao pendente
  // ela barra em qualquer lugar da mensagem ("a aprovacao ja saiu").
  const paresDaRemarcacao = [
    ...daAcao("remarcou"),
    ...lidos(
      fatos.consultasLidas.filter((c) => c.remarcadaNestaConversa === true),
    ),
  ];
  const pendenciaNaFrase = (indice: number): boolean => {
    const frase = frasesSemDiminutivo[indice];
    return (
      frase !== undefined &&
      PENDENCIA_DA_REMARCACAO.test(frase.texto) &&
      !APROVACAO_AFIRMADA.test(frase.texto)
    );
  };
  if (acoes.has("remarcou") || remarcadaNestaConversa) {
    const indices = new Set([...alegadas.keys(), ...fatosDaFrase.keys()]);
    const dizQueRemarcou = [...indices].some((indice) => {
      const frase = frasesSemDiminutivo[indice];
      if (frase === undefined) {
        return false;
      }
      const daRemarcacao =
        alegadas.get(indice)?.has("remarcou") === true ||
        paresDaOferta(partesDaOferta(semDiminutivo, frase, fatos.hoje)).some(
          (par) => paresDaRemarcacao.some((h) => parNoHorarioLivre(par, h)),
        );
      return (
        daRemarcacao && !pendenciaNaFrase(indice) && !pendenciaNaFrase(indice + 1)
      );
    });
    if (dizQueRemarcou || APROVACAO_AFIRMADA.test(semDiminutivo)) {
      achados.push({
        categoria: "acao_nao_executada",
        regra: "remarcacao_sem_pendencia",
      });
    }
  }

  // Revisao curta das correcoes da AG3 (achado 5): a frase da acao, do estado
  // da consulta ou do fechamento licenciado que cita OUTRO profissional do
  // Cadastro ou OUTRA unidade ("Sua consulta esta marcada com o Dr. Bruno",
  // marcada com a Dra. Ana; "na unidade Aldeota", marcada no Centro) barra.
  // O nome so aparece no texto sem a mascara do catalogo: a frase e a mesma
  // pela posicao (as frases com e sem mascara tem de bater em numero; nao
  // batendo, a regra nao le, e o verificador continua lendo).
  if (fatosDaFrase.size > 0) {
    const frasesSemMascara = frasesComPosicao(semFlexaoDoParticipio(base));
    if (frasesSemMascara.length === frasesSemDiminutivo.length) {
      const foraDaAcao = new Set<string>();
      for (const [indice, lista] of fatosDaFrase) {
        const frase = frasesSemDiminutivo[indice];
        const semMascara = frasesSemMascara[indice];
        if (frase === undefined || semMascara === undefined) {
          continue;
        }
        const pares = paresDaOferta(
          partesDaOferta(semDiminutivo, frase, fatos.hoje),
        );
        for (const regra of profissionalOuUnidadeForaDaAcao(
          semMascara.texto,
          pares,
          lista,
          fatos,
        )) {
          foraDaAcao.add(regra);
        }
      }
      for (const regra of foraDaAcao) {
        achados.push({ categoria: "acao_nao_executada", regra });
      }
    }
  }

  // Convenio.
  for (const regra of regraDaCobertura(base, fatos, contexto)) {
    achados.push({ categoria: "cobertura_nao_verificada", regra });
  }

  return achados;
}

/**
 * As regras dos fatos que vivem em codigo, para a versao das regras
 * (filtro.ts) mudar quando elas mudarem.
 */
export const FONTES_DOS_FATOS: readonly string[] = [
  DATA_COM_BARRA.source,
  DATA_COM_PONTO.source,
  DATA_POR_EXTENSO.source,
  DIA_COM_HORA.source,
  DATA_QUE_E_NOME.source,
  DEPOIS_DE_DATA_QUE_NAO_E.source,
  HORA.source,
  INICIO_DE_FAIXA.source,
  MEIO_DIA.source,
  MEIA_NOITE.source,
  QUANTIDADE_DEPOIS.source,
  ANTES_DE_DURACAO.source,
  DEPOIS_DE_DURACAO.source,
  PERIODO_DEPOIS.source,
  `hora sem "as" ate ${MAIOR_HORA_QUE_E_DURACAO} e duracao`,
  // Revisao da AG2: frases, horario livre, paciente so negando ou
  // perguntando.
  [...ABREVIACOES].join(","),
  FIM_DE_FRASE.source,
  AFIRMA_HORARIO_LIVRE.source,
  VAGA_DA_AGENDA,
  ORDINAL_E_NAO_DIA.source,
  DIA_DEPOIS_DO_ORDINAL.source,
  "paciente: so na frase que nega ou pergunta e nao afirma horario livre",
  // Revisao 2 da AG2: pergunta de verdade, negacao que rege o verbo, oferta
  // de procurar, disponibilidade sem data e o par de toda frase.
  ETIQUETA_NO_FIM.source,
  [...NEGADORES].join(","),
  [...LIGACAO_DA_NEGACAO].join(","),
  PALAVRA_DE_HORA.source,
  [...VERBO_DE_TER].join(","),
  [...VERBO_DE_PODER].join(","),
  [...VERBO_DE_INCERTEZA].join(","),
  [...NOME_DE_DISPONIBILIDADE].join(","),
  [...DEPOIS_DO_TER_NA_NEGATIVA].join(","),
  PROCURAR_ANTES.source,
  SE_ANTES.source,
  INDIRETA_ANTES.source,
  DISPONIBILIDADE_SEM_DATA.source,
  "horario livre: disponibilidade sem dia nem hora so com horario livre da ferramenta",
  ENTRE_DIAS_DA_FAIXA.source,
  "par de toda frase: dia e hora juntos num objeto da ferramenta, linha, horario livre ou frase publicada",
  DIA_DA_SEMANA.source,
  DIA_RELATIVO.source,
  DIA_SOLTO.source,
  PERIODO_DO_DIA.source,
  JSON.stringify(FAIXA_DO_PERIODO),
  ENTRE_PARTES_DA_DATA.source,
  "horario livre: pares pela ordem da frase, dia da semana da ferramenta",
  "horario livre: a oferta sem dia nem hora vale para a frase seguinte",
  FALA_DE_AGENDA.source,
  [...TIPOS_DE_LOGRADOURO].map(([de, para]) => `${de}=${para}`).join(","),
  [...LIGACOES_DO_NOME].join(","),
  [...ANTES_DO_NUMERO].join(","),
  UNIDADE_DEPOIS_DO_NUMERO.source,
  `nome ate ${MAXIMO_DE_PALAVRAS_DO_NOME}`,
  // Revisao da AG2: o endereco da ferramenta fora das vedacoes clinicas.
  "endereco da ferramenta: campo endereco inteiro e logradouro com numero",
  // Revisao 2 da AG2: o bairro e a cidade da ferramenta.
  [...CAMPOS_DE_LUGAR].join(","),
  "lugar da ferramenta: duas palavras de nome, a palavra clinica so no fim",
  PALAVRAS_CLINICAS_DE_NOME_DE_LUGAR.join(","),
  ...PADROES_DE_ACAO.map(
    (p) =>
      `${p.nome} ${p.acao ?? "estado"} ${p.regex.source}${p.soComAgendaNaFrase ? " so com agenda na frase" : ""}`,
  ),
  NEGACAO_ANTES.source,
  PARTICIPIO_NO_DIMINUTIVO.source,
  RESERVA_QUE_E_REGRA,
  // Revisao 2 da AG2: a regra estrutural do fechamento. Revisao final da
  // AG3: a marca licenciada pela acao (forte so com marcou, remarcou ou
  // consulta lida; reserva com reservou; fraca e horario com a acao na
  // frase), as marcas novas, o dado da pessoa, a negacao com "mais" e a
  // frase que diz que a reserva nao vale mais.
  "fechamento: forte com marcou, remarcou ou consulta lida; reserva com reservou; fraca e horario com a acao na frase",
  FECHAMENTO_FRACO_NO_COMECO.source,
  FECHAMENTO_FORTE_NO_COMECO.source,
  DADO_DA_PESSOA,
  FECHAMENTO_FORTE.source,
  FECHAMENTO_DO_HORARIO.source,
  FECHAMENTO_DA_RESERVA.source,
  NEGACAO_DA_MARCA.source,
  NAO_VALE_MAIS.source,
  `interjeicao ate ${MAXIMO_DE_PALAVRAS_DA_INTERJEICAO} palavras vale para a frase seguinte`,
  "estado da consulta: consulta lida, marcou ou remarcou",
  // Revisao final da AG3: o par da acao e da consulta lida, a consulta
  // marcada nesta conversa e o eco do pedido.
  "acao e estado com dia ou hora: o par da acao (reservou, marcou, remarcou) ou da consulta lida",
  "marcou: tambem a consulta marcada nesta conversa, relida no turno",
  "fechamento licenciado: o par de uma acao ou de uma consulta lida",
  "eco do pedido: fonte so na frase que nega ou pergunta",
  // Revisao curta das correcoes da AG3 (achados 3 a 7): o horario que nao esta
  // livre, o relato do pedido, o horario de outra pessoa, o duplo negativo
  // como horario livre, os tipos de marca com o par de cada um, as marcas
  // novas, a frase curta depois, o superlativo, a reserva por "separei" e o
  // profissional e a unidade da acao.
  OCUPADO,
  DIZ_QUE_ESTA_OCUPADO.source,
  NEGACAO_DO_OCUPADO.source,
  JA_TEM_PACIENTE.source,
  JA_FOI_NO_FIM.source,
  CONSULTA_DA_PESSOA.source,
  DE_OUTRA_PESSOA.source,
  RELATO_DO_PEDIDO.source,
  POR_OUTRA_PESSOA,
  "paciente e eco: tambem na frase que diz que o horario nao esta livre e no relato do pedido",
  PARTICIPIO_NO_SUPERLATIVO.source,
  AGENDA_NA_FRASE.source,
  NAO_E_HORARIO_GUARDADO,
  INTERJEICAO_DE_FECHAMENTO,
  INTERJEICAO_NO_COMECO.source,
  INTERJEICAO_NO_FIM.source,
  FECHAMENTO_DO_COMPROMISSO.source,
  CONDICAO_NA_FRASE.source,
  FUNCIONAMENTO_NA_FRASE.source,
  FECHAMENTO_DO_RESUMO.source,
  PERGUNTA_DE_ESCOLHA.source,
  "fechamento por tipo: forte e compromisso com o par da consulta marcada ou lida; reserva com o da reserva (e o da outra acao da frase); fraca, interjeicao, horario e resumo tambem com o da acao da frase; a frase passa so com o par que todas as marcas permitem",
  "fechamento: a frase curta logo depois, sem dia nem hora, tambem marca a frase",
  [...TITULOS_DO_PROFISSIONAL].join(","),
  TITULO_E_NOME.source,
  NEGACAO_DEPOIS_DA_MENCAO.source,
  "profissional e unidade: a frase da acao, do estado ou do fechamento licenciado com outro profissional do Cadastro (nome inteiro ou titulo com o nome) ou outra unidade (com a palavra unidade) barra; fato sem profissional ou unidade nao barra",
  // AG4 (27/10/2026): a remarcacao pedida nesta conversa e a pendencia.
  "remarcou: tambem a remarcacao pedida nesta conversa, relida e pendente",
  PENDENCIA_DA_REMARCACAO.source,
  // Revisao da AG4 (achados 5 e 7): a pendencia na frase (ou na seguinte),
  // a aprovacao afirmada, a remarcacao aprovada e a cancelada nesta
  // conversa.
  APROVACAO_AFIRMADA.source,
  "remarcacao_sem_pendencia: a frase que diz que remarcou (acao, ou estado ou fechamento com o par da consulta nova) so com a pendencia nela ou na frase logo depois, sem a aprovacao afirmada; com a remarcacao pendente, a aprovacao afirmada em qualquer frase barra",
  "remarcou: tambem a remarcacao pedida nesta conversa e ja aprovada, relida, com o par dela e sem a pendencia",
  "cancelou: tambem a consulta cancelada nesta conversa num turno anterior, relida e ainda cancelada, com o par dela; nunca consulta lida",
  "acao com horario: o anterior so na remarcacao",
  CONVENIO_GENERICO,
  DETERMINANTES,
  ...PADROES_DE_COBERTURA.map(
    (p) => `${p.nome} ${p.alegacao} ${p.fonte("ALVO")}`,
  ),
  ...PADROES_PELO_OBJETO.map((p) => `${p.nome} ${p.objeto} ${p.regex.source}`),
  FIM_DO_OBJETO.source,
  [...FUNCAO_NO_OBJETO].join(","),
  [...MEIOS_DE_PAGAMENTO].join(","),
  [...PARTICULAR].join(","),
  [...NAO_E_CONVENIO].join(","),
  [...CONVENIO_NO_OBJETO].join(","),
  PLANO_QUE_NAO_E_CONVENIO.source,
  [...SUJEITO_QUE_NAO_E_CONVENIO].join(","),
  [...LUGAR_OU_PRECO_COBERTO].join(","),
  [...OBJETO_GENERICO_DE_COBRE].join(","),
  COBERTO.source,
  COBERTURA.source,
  VERBO_ANTES_DE_COBERTO.source,
  TER_COBERTURA.source,
  CONVENIO_NA_MENSAGEM.source,
  "convenio: procedimento citado so com o fato do procedimento",
  "convenio: objeto vazio com a pergunta do paciente sobre convenio",
  "convenio: sem convenio ativo, a negativa passa",
  NEGACAO_DO_CONVENIO.source,
  CONDICAO_ANTES.source,
  SEM_COBERTURA.source,
  // Revisao 2 da AG2: a regra invertida do convenio citado, o procedimento
  // de "coberto", "cobertura" e "aceita" e o "seu plano" do paciente.
  MENCAO_GENERICA_DE_CONVENIO.source,
  SABER_ANTES.source,
  PEDIDO_ANTES.source,
  PEDIDO_NA_FRASE.source,
  COMPLEMENTO_ANTES.source,
  LUGAR_ANTES_DO_CONVENIADO.source,
  VERBO_DE_LIGACAO_NO_FIM.source,
  VERBO_DE_CONVENIO.source,
  [...LIGACAO_DE_CONVENIO].join(","),
  DEPOIS_DA_LIGACAO_DE_CONVENIO.source,
  "convenio: sem nome, o do paciente e o do resto do rascunho",
  "convenio: procedimento em parte pelas palavras do Cadastro",
  // Revisao final da AG3: o convenio que o paciente citou e que nao foi
  // reconhecido.
  NOME_DEPOIS_DO_CONVENIO.source,
  TER_O_CONVENIO.source,
  "convenio: o citado pelo paciente e nao reconhecido barra a afirmacao generica e a regra invertida",
  // Revisao curta das correcoes da AG3 (achado 14): "plano" com verbo.
  VERBO_DEPOIS_DO_PLANO,
];
