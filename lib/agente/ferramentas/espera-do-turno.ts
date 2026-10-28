// A lista de espera dentro de UM turno do agente (AG5, 27/10/2026; o desenho
// da AG5, secoes 1 e 4). O executor das duas ferramentas (pedir_lista_de_
// espera e entrar_na_lista_de_espera), o preparo (o pedido e a entrada desta
// conversa, relidos), a conferencia da pergunta T-E1 do turno anterior, os
// fatos, a parte do bloco do modelo e a da nota da equipe. Quem chama e
// lib/agente/ferramentas/agenda-do-turno.ts (o turno so delega): o laco nao
// muda (as duas passam por agendaDoTurno.executar; frase, passar,
// mensagem_nova e falha ja existem).
//
// As regras (os mecanismos da AG4, os mesmos):
//  - o procedimento, o profissional (nulo: qualquer) e o pagamento vem do
//    ESTADO do atendimento (a ultima busca de horario), nunca do texto do
//    modelo; sem eles, sem_busca_antes (falha) e nada chega ao banco. Com
//    mais de uma unidade ativa, a lista passa para a equipe (D-38);
//  - pedir: a RPC confere e grava o pedido com o job do turno; o SISTEMA
//    escreve a pergunta fixa (T-E1), que encerra o turno. No maximo uma
//    chamada de cada RPC da lista por turno (o mesmo job com outro pedido
//    seria 22023 no banco);
//  - entrar: so com o pedido vivo lido no preparo e a T-E1 dele conferida
//    como a saida logo antes da resposta (a autoria real e o corpo
//    original, pela porta: lerSaidaAntesDaResposta; sem a porta, o
//    historico), dentro de 60 minutos dela; a resposta que cita (ou toca o
//    botao de) OUTRA mensagem nunca e o "sim". O "sim" numa lista fechada
//    PROPRIA (interpretarRespostaAListaDeEspera). Pergunta que nao vale mais
//    (venceu, outra saida no meio, nao conferida): o sistema pergunta de
//    novo (a RPC do pedido, com o job DESTE turno, re-ancora), e so a que
//    nao venceu conta falha. "Nao": paciente_nao_quis ao modelo. Nao claro:
//    a pergunta volta e conta falha (na segunda seguida, a equipe);
//  - as recusas do banco: as da equipe passam com pedido_de_agenda (ou com
//    o motivo da D-8); ja_na_lista e ja_tem_consulta vao ao modelo (so a
//    preferencia; so o dia e a hora); mensagem_nova_do_paciente para o
//    turno sem enviar nada e sem falha; pedido_vencido e
//    sem_confirmacao_do_paciente perguntam de novo (so o segundo conta
//    falha); ia_desligada para o turno como a trava; motivo desconhecido,
//    erro ou resposta fora do formato: falha fechada;
//  - nada daqui muda ia_atendimento: o pedido mora em ia_pedido_de_espera,
//    ancorado pelo job.
// Nada daqui tem texto do paciente: a trilha e a nota citam nomes do
// Cadastro e a preferencia (listas fechadas). O "sim" e lido do texto
// original da mensagem, sem sair do turno, nunca para log.

import type { FerramentaDeAgenda } from "@/lib/domain/agente/config";
import type {
  CoberturaDoTurno,
  EntradaDaEsperaDoFato,
  FatosDaFerramenta,
} from "@/lib/domain/conformidade/fatos-do-turno";
import { interpretarRespostaAListaDeEspera } from "@/lib/domain/resposta-paciente";
import {
  PERGUNTA_DA_LISTA_DE_ESPERA,
  pedidoDaEsperaEmTexto,
  perguntaDaListaDeEspera,
  preferenciaEmTexto,
  respostaDaListaDeEspera,
  type PedidoDaEsperaEmTexto,
} from "@/lib/domain/textos-da-lista-de-espera";

import type { EstadoDoAtendimento } from "../atendimento";
import type {
  PortaDaAgenda,
  ResultadoDaFerramentaDeAgenda,
} from "./agenda-do-turno";
import { diaEHora } from "./buscar-horario";
import {
  coberturaDoConvenio,
  nomeDoConvenio,
  type CatalogoDoAgente,
  type ConvenioDoAgente,
} from "./buscar-procedimento";
import { pedidoAindaVale } from "./cancelar-consulta";
import {
  entradaDaEntradaNaEsperaSchema,
  entradaDoPedidoDeEsperaSchema,
  numeroDoDia,
  type EsperaDaConversa,
  type MotivoDaEntradaNaEspera,
  type MotivoDoPedidoDeEspera,
  type PedidoDeEsperaLido,
  type PeriodoDaEspera,
  type RespostaDaEntradaNaEspera,
  type RespostaDoPedidoDeEspera,
} from "./lista-de-espera";
import type { MensagemDoPaciente } from "./registrar-dados";

const SIMULADO = "No simulador, nada foi gravado.";

/**
 * O que a trilha diz de cada motivo das duas RPCs da lista (linguagem de
 * recepcao). Os que tem o mesmo nome dos da AG3 e da AG4 (so_com_a_equipe,
 * ja_tem_consulta, pedido_vencido, sem_confirmacao_do_paciente) tem aqui o
 * texto da lista de espera.
 */
export const ROTULO_DO_MOTIVO_DA_ESPERA: Readonly<
  Record<MotivoDoPedidoDeEspera | MotivoDaEntradaNaEspera, string>
> = {
  ia_desligada: "o assistente não está mais atendendo esta conversa",
  lista_de_espera_desligada:
    "a lista de espera não está ligada, ou Agendar consulta não vale, na versão publicada",
  sem_pedido_de_espera: "não havia pedido de lista de espera nesta conversa",
  mais_de_uma_unidade:
    "a clínica tem mais de uma unidade, e a lista de espera ainda não guarda a unidade",
  so_com_a_equipe:
    "o procedimento, o profissional ou o convênio do pedido só é marcado pela equipe",
  sem_autorizacao: "o contato não tem autorização para receber mensagens",
  ja_na_lista: "a pessoa já está na lista de espera para esse pedido",
  mensagem_nova_do_paciente:
    "a pessoa mandou outra mensagem enquanto o assistente respondia",
  consulta_para_outra_pessoa: "a consulta é para outra pessoa",
  menor_de_idade: "o paciente é menor de idade",
  ja_tem_consulta: "o paciente já tem consulta marcada deste procedimento",
  pedido_vencido:
    "a pergunta da lista de espera venceu (mais de 1 hora sem a resposta)",
  sem_confirmacao_do_paciente:
    "a resposta da pessoa não veio logo depois da pergunta da lista de espera",
};

/**
 * Os codigos de resultado da lista para a nota ("Parou em"), com o texto da
 * lista; os que tem o mesmo sentido dos da AG3 (ja_tem_consulta, a D-8) ficam
 * com o texto de la. so_com_a_equipe e o "sim" que nao foi claro tem codigo
 * proprio (o texto da AG4 fala da consulta e do cancelamento).
 */
export const PAROU_EM_DA_ESPERA: Readonly<Record<string, string>> = {
  ja_na_lista: "a pessoa já está na lista de espera para esse pedido",
  mais_de_uma_unidade:
    "a clínica tem mais de uma unidade, e a lista de espera ainda não guarda a unidade",
  sem_autorizacao: "o contato não tem autorização para receber mensagens",
  lista_de_espera_desligada:
    "a lista de espera não está ligada na versão publicada",
  espera_so_com_a_equipe:
    "o procedimento, o profissional ou o convênio do pedido só é marcado pela equipe",
  espera_sem_confirmacao_clara:
    "a resposta do paciente à pergunta da lista de espera não ficou clara",
};

/** O passo da trilha quando a resposta cita outra mensagem (AG4). */
const PASSO_DA_RESPOSTA_A_OUTRA_MENSAGEM =
  "a resposta da pessoa citou outra mensagem (um botão tocado ou a resposta a uma mensagem antiga), e não a pergunta da lista de espera";

/** Escapa o texto para virar parte de uma expressao regular. */
function literal(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A T-E1 de QUALQUER pedido (cada campo no lugar do valor), no fim da
 * mensagem (a saudacao e o aviso vem antes). Montada da propria frase: o
 * texto do dono que mudar muda aqui junto.
 */
const T_E1_DE_QUALQUER_PEDIDO = new RegExp(
  `${literal(PERGUNTA_DA_LISTA_DE_ESPERA).replace(/\\\{\\\{[a-z_]+\\\}\\\}/g, "[^?]+?")}\\s*$`,
);

/** O resultado da conferencia da pergunta do turno anterior (AG4). */
export type PerguntaConferidaPeloTurno =
  | "conferida"
  | "outra_mensagem"
  | "nao_conferida"
  | "consulta_mudou";

/** O que o turno (agenda-do-turno.ts) empresta a lista de espera. */
export type ContextoDaEspera = {
  porta: PortaDaAgenda | null;
  catalogo: CatalogoDoAgente;
  /** A habilidade "Lista de espera" vale (as duas ferramentas vem). */
  ligada: boolean;
  /** O estado do turno (so lido: o procedimento, o profissional, o pagamento). */
  estado: EstadoDoAtendimento;
  agoraMs: number;
  fuso: string;
  relogio: () => number;
  /** As mensagens do paciente ainda nao respondidas (o texto original). */
  pendentes: readonly MensagemDoPaciente[];
  /** Os codigos de resultado do turno (o mesmo array do turno). */
  resultados: string[];
  /**
   * A conferencia da AG4: a saida logo antes da resposta da pessoa e a
   * frase da IA (a autoria real, o corpo original, sem falha e sem empate),
   * ou a mesma frase com outro conteudo (`molde`).
   */
  conferirAPergunta: (frase: string, molde: RegExp) => PerguntaConferidaPeloTurno;
  /** A resposta da pessoa cita (ou toca o botao de) outra mensagem (AG4). */
  respostaCitaOutraMensagem: () => boolean;
  /** O instante da pergunta conferida (a saida lida do banco), ou null. */
  instanteDaPergunta: () => string | null;
  /** O nome do profissional pelo id, do Cadastro. */
  nomeDoProfissional: (id: string | null | undefined) => string | null;
};

/** A situacao da pergunta T-E1 do turno anterior, no preparo. */
type PerguntaDaEspera =
  | "nenhuma"
  | "nao_lida"
  | "conferida"
  | "vencida"
  | "outra_mensagem"
  | "nao_conferida";

/** O que o bloco do modelo diz da lista (lib/agente/prompt.ts monta). */
export type ListaDeEsperaParaOModelo = {
  /**
   * A pergunta da lista: "feita" (esperando a resposta da pessoa) ou
   * "nao_vale_mais" (venceu, outra mensagem saiu depois, ou nao deu para
   * conferir). null: nenhuma pergunta em andamento.
   */
  pergunta: "feita" | "nao_vale_mais" | null;
  /** As entradas que a pessoa fez nesta conversa (o pedido em texto). */
  entradas: string[];
};

/** O que a nota da equipe conta da lista (lib/agente/atendimento.ts monta). */
export type ListaDeEsperaNaNota = {
  pedido: string;
  situacao: "perguntada" | "entrou";
};

export type EsperaDoTurno = {
  /** Le o pedido e a entrada desta conversa. Nunca lanca. */
  ler: () => Promise<void>;
  /** Ha uma pergunta da lista do turno anterior a conferir. */
  temPerguntaAConferir: () => boolean;
  /** Confere a pergunta (depois de o turno ler a saida antes da resposta). */
  conferir: () => void;
  executar: (
    nome: Extract<
      FerramentaDeAgenda,
      "pedir_lista_de_espera" | "entrar_na_lista_de_espera"
    >,
    argumentos: unknown,
  ) => Promise<ResultadoDaFerramentaDeAgenda>;
  paraOModelo: () => ListaDeEsperaParaOModelo | null;
  /** As entradas desta conversa, relidas, como fato (o turno seguinte). */
  fatosDoEstado: () => FatosDaFerramenta | null;
  nota: () => ListaDeEsperaNaNota | null;
};

/** Uma saida ao modelo (o JSON do function_call_output). */
function saida(
  resultado: string,
  corpo: Record<string, unknown>,
  passo: string,
  fatos?: FatosDaFerramenta,
): ResultadoDaFerramentaDeAgenda {
  return {
    tipo: "saida",
    saida: JSON.stringify({ resultado, ...corpo }),
    passo,
    precos: [],
    resultado,
    ...(fatos === undefined ? {} : { fatos }),
  };
}

/** A frase fixa que encerra o turno (com os fatos dela). */
function frase(
  texto: string,
  passo: string,
  resultado: string,
  fatos: FatosDaFerramenta,
): ResultadoDaFerramentaDeAgenda {
  return {
    tipo: "frase",
    texto,
    saida: JSON.stringify({ resultado }),
    passo,
    resultado,
    fatos,
  };
}

/** O pedido como a porta manda ao banco (ids, listas fechadas). */
type PedidoParaOBanco = {
  procedimentoId: string;
  profissionalId: string | null;
  convenioId: string | null;
  particular: boolean;
  turnos: PeriodoDaEspera[];
  dias: number[];
};

export function criarEsperaDoTurno(c: ContextoDaEspera): EsperaDoTurno {
  const { porta, catalogo, estado } = c;
  /** O que o preparo leu (null: nada lido, ou a habilidade desligada). */
  let lida: EsperaDaConversa | null = null;
  let leituraFalhou = false;
  let pergunta: PerguntaDaEspera = "nenhuma";
  /** A pergunta conferida, mas a resposta cita outra mensagem. */
  let citouOutra = false;
  /** Uma RPC da lista (pedir ou entrar) ja foi chamada neste turno. */
  let chamouAPorta = false;
  /** O pedido perguntado neste turno (a T-E1 que saiu). */
  let perguntadoNoTurno: PedidoDeEsperaLido | null = null;
  /** A entrada feita neste turno (a T-E2 que saiu). */
  let entrouNoTurno: PedidoDeEsperaLido | null = null;

  const registrar = (...codigos: string[]) => {
    c.resultados.push(...codigos);
  };

  const procedimentoDe = (id: string | null | undefined) =>
    id === null || id === undefined
      ? undefined
      : [...catalogo.procedimentos, ...(catalogo.procedimentosSoComAEquipe ?? [])].find(
          (p) => p.id === id,
        );

  const convenioDe = (id: string | null): ConvenioDoAgente | undefined =>
    id === null
      ? undefined
      : [...catalogo.conveniosDoCadastro, ...catalogo.convenios].find(
          (convenio) => convenio.id === id,
        );

  /**
   * O pedido com os nomes do Cadastro (os mesmos que a T-E1 escreveu e que
   * o preparo confere). Sem um nome no catalogo, o que a RPC devolveu; sem
   * nenhum dos dois, null (falha fechada).
   */
  function emTexto(
    pedido: Pick<
      PedidoDeEsperaLido,
      "procedimentoId" | "profissionalId" | "convenioId" | "turnos" | "dias"
    >,
    daRpc?: {
      procedimento: string | null;
      profissional: string | null;
      convenio: string | null;
      plano: string | null;
    },
  ): PedidoDaEsperaEmTexto | null {
    const procedimento =
      procedimentoDe(pedido.procedimentoId)?.nome ?? daRpc?.procedimento ?? null;
    const profissional =
      pedido.profissionalId === null
        ? null
        : (c.nomeDoProfissional(pedido.profissionalId) ??
          daRpc?.profissional ??
          undefined);
    const doCadastro = convenioDe(pedido.convenioId);
    const convenio =
      pedido.convenioId === null
        ? null
        : doCadastro !== undefined
          ? nomeDoConvenio(doCadastro)
          : daRpc?.convenio !== undefined && daRpc.convenio !== null
            ? daRpc.plano === null
              ? daRpc.convenio
              : `${daRpc.convenio} (${daRpc.plano})`
            : undefined;
    if (procedimento === null || profissional === undefined || convenio === undefined) {
      return null;
    }
    return {
      procedimento,
      profissional,
      convenio,
      turnos: pedido.turnos,
      dias: pedido.dias,
    };
  }

  /** O fato "atende" do convenio do pedido no procedimento (a T-E1 e a T-E2). */
  function coberturasDo(
    pedido: Pick<PedidoDeEsperaLido, "convenioId" | "procedimentoId">,
  ): CoberturaDoTurno[] {
    const convenio = convenioDe(pedido.convenioId);
    const procedimento = procedimentoDe(pedido.procedimentoId);
    return convenio === undefined || procedimento === undefined
      ? []
      : [coberturaDoConvenio(convenio, "atende", procedimento.nome)];
  }

  /** A entrada como fato do turno (os nomes do Cadastro e a preferencia). */
  function entradaComoFato(
    texto: PedidoDaEsperaEmTexto,
    origem: EntradaDaEsperaDoFato["origem"],
  ): EntradaDaEsperaDoFato {
    return {
      procedimento: texto.procedimento,
      profissional: texto.profissional,
      turnos: [...texto.turnos],
      dias: [...texto.dias],
      origem,
    };
  }

  // -------------------------------------------------------------------------
  // O preparo
  // -------------------------------------------------------------------------

  /** Ja leu (ou tentou ler) o pedido neste turno. */
  let leu = false;

  async function ler(): Promise<void> {
    if (!c.ligada || porta === null || leu) {
      return;
    }
    leu = true;
    if (porta.lerPedidoDeEspera === undefined) {
      leituraFalhou = true;
      pergunta = "nao_lida";
      return;
    }
    try {
      lida = await porta.lerPedidoDeEspera();
    } catch {
      leituraFalhou = true;
      pergunta = "nao_lida";
    }
  }

  function temPerguntaAConferir(): boolean {
    return lida?.vivo !== null && lida?.vivo !== undefined;
  }

  /**
   * A pergunta do turno anterior so vale para a resposta que veio LOGO
   * depois dela: a saida antes da resposta da pessoa e a T-E1 da IA para o
   * pedido vivo (o banco confere a mesma ancora pelo job do pedido), dentro
   * de 60 minutos dela (D-43, a mesma constante do cancelamento).
   */
  function conferir(): void {
    const vivo = lida?.vivo ?? null;
    if (leituraFalhou || vivo === null) {
      return;
    }
    const texto = emTexto(vivo);
    if (texto === null) {
      pergunta = "nao_conferida";
      return;
    }
    const conferida = c.conferirAPergunta(
      perguntaDaListaDeEspera(texto),
      T_E1_DE_QUALQUER_PEDIDO,
    );
    if (conferida !== "conferida") {
      // A T-E1 de outro pedido (os nomes do Cadastro mudaram no meio) e o
      // que nao confere: pergunta de novo, com falha. Sem a pergunta logo
      // antes e com o pedido ja vencido, vale o vencido (sem falha), como
      // no cancelamento.
      pergunta =
        !pedidoAindaVale(vivo.criadoEm, c.relogio())
          ? "vencida"
          : conferida === "outra_mensagem"
            ? "outra_mensagem"
            : "nao_conferida";
      return;
    }
    if (!pedidoAindaVale(c.instanteDaPergunta() ?? vivo.criadoEm, c.relogio())) {
      pergunta = "vencida";
      return;
    }
    pergunta = "conferida";
    citouOutra = c.respostaCitaOutraMensagem();
  }

  // -------------------------------------------------------------------------
  // pedir_lista_de_espera
  // -------------------------------------------------------------------------

  /**
   * O pedido do estado do atendimento (a ultima busca de horario), ou null
   * quando a busca nao veio antes (o procedimento ou o pagamento vazios).
   */
  function pedidoDoEstado(
    turnos: PeriodoDaEspera[],
    dias: number[],
  ): PedidoParaOBanco | null {
    if (
      estado.procedure_id === null ||
      estado.particular === null ||
      (estado.particular === false && estado.insurance_id === null) ||
      procedimentoDe(estado.procedure_id) === undefined
    ) {
      return null;
    }
    return {
      procedimentoId: estado.procedure_id,
      profissionalId: estado.professional_id,
      convenioId: estado.particular ? null : estado.insurance_id,
      particular: estado.particular,
      turnos,
      dias,
    };
  }

  /**
   * A RPC do pedido (com o job deste turno) e a resposta: a T-E1 ou a
   * recusa. `porque`: o passo da pergunta de novo (null na primeira).
   */
  async function pedirPelaRpc(
    pedido: PedidoParaOBanco,
    porque: string | null,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    chamouAPorta = true;
    let r: RespostaDoPedidoDeEspera;
    try {
      if (porta === null || porta.pedirListaDeEspera === undefined) {
        throw new Error("sem porta");
      }
      r = await porta.pedirListaDeEspera(pedido);
    } catch {
      return {
        tipo: "falha",
        passo: "Não foi possível pedir a lista de espera agora.",
      };
    }
    if (!r.ok) {
      return recusaDaEspera(r, pedido, "Não pediu a lista de espera");
    }
    const lido: PedidoDeEsperaLido = {
      id: "",
      jobId: "",
      procedimentoId: pedido.procedimentoId,
      profissionalId: pedido.profissionalId,
      convenioId: pedido.convenioId,
      particular: pedido.particular,
      // A preferencia como o banco normalizou (os tres periodos ou os sete
      // dias viram "qualquer"), a mesma que o preparo confere depois.
      turnos: r.turnos,
      dias: r.dias,
      criadoEm: new Date(c.relogio()).toISOString(),
    };
    const texto = emTexto(lido, r);
    if (texto === null) {
      return {
        tipo: "falha",
        passo: "O pedido da lista de espera foi feito, mas não foi possível ler o procedimento, o profissional ou o convênio dele.",
      };
    }
    perguntadoNoTurno = lido;
    registrar("pergunta_da_espera");
    const descricao = pedidoDaEsperaEmTexto(texto);
    return frase(
      perguntaDaListaDeEspera(texto),
      porque === null
        ? `Perguntou se a pessoa confirma a entrada na lista de espera para ${descricao}`
        : `${porque}: perguntou de novo se a pessoa confirma a entrada na lista de espera para ${descricao}`,
      "pergunta_da_espera",
      { coberturas: coberturasDo(lido) },
    );
  }

  async function pedir(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    const lido = entradaDoPedidoDeEsperaSchema.safeParse(argumentos);
    if (!lido.success) {
      registrar("entrada_invalida");
      return saida(
        "entrada_invalida",
        {},
        "Tentou pedir a lista de espera com um pedido fora do formato",
      );
    }
    if (chamouAPorta) {
      registrar("um_pedido_de_espera_por_resposta");
      return saida(
        "um_pedido_de_espera_por_resposta",
        {},
        "Pediu a lista de espera duas vezes na mesma resposta: recusado",
      );
    }
    const pedido = pedidoDoEstado(
      [...lido.data.periodos],
      lido.data.dias.map(numeroDoDia),
    );
    if (pedido === null) {
      registrar("sem_busca_antes");
      return saida(
        "sem_busca_antes",
        {},
        "Tentou pedir a lista de espera sem a busca de horário antes (o procedimento ou o pagamento não estavam definidos)",
      );
    }
    // D-38 (recomendacao): a fila e a oferta nao guardam a unidade.
    if ((catalogo.unidades ?? []).length > 1) {
      registrar("mais_de_uma_unidade");
      return {
        tipo: "passar",
        motivo: "pedido_de_agenda",
        resultado: "mais_de_uma_unidade",
        passo: `Não pediu a lista de espera: ${ROTULO_DO_MOTIVO_DA_ESPERA.mais_de_uma_unidade}`,
      };
    }
    return pedirPelaRpc(pedido, null);
  }

  // -------------------------------------------------------------------------
  // As recusas do banco (as duas fases)
  // -------------------------------------------------------------------------

  /**
   * A recusa das RPCs da lista: as da equipe passam; ja_na_lista e
   * ja_tem_consulta vao ao modelo; a mensagem nova para o turno; o resto
   * (pedido_vencido e sem_confirmacao_do_paciente, so na fase 2) quem chama
   * trata antes. Motivo fora do que esta funcao conhece: falha fechada.
   */
  function recusaDaEspera(
    r: {
      motivo: MotivoDoPedidoDeEspera | MotivoDaEntradaNaEspera;
      entrada?: { profissional: string | null; turnos: PeriodoDaEspera[]; dias: number[] } | null;
      inicio?: string | null;
    },
    pedido: Pick<PedidoParaOBanco, "procedimentoId" | "profissionalId" | "convenioId">,
    passoBase: string,
  ): ResultadoDaFerramentaDeAgenda {
    const rotulo = ROTULO_DO_MOTIVO_DA_ESPERA[r.motivo];
    const passo = `${passoBase}: ${rotulo}`;
    switch (r.motivo) {
      case "ia_desligada":
        registrar(r.motivo);
        return { tipo: "liberacao_suspensa", passo };
      case "mensagem_nova_do_paciente":
        registrar(r.motivo);
        return {
          tipo: "mensagem_nova",
          passo: `${passo}. Nada foi enviado; a próxima resposta lê a mensagem nova.`,
        };
      case "lista_de_espera_desligada":
      case "mais_de_uma_unidade":
      case "sem_autorizacao":
        registrar(r.motivo);
        return { tipo: "passar", motivo: "pedido_de_agenda", resultado: r.motivo, passo };
      case "so_com_a_equipe":
        registrar("espera_so_com_a_equipe");
        return {
          tipo: "passar",
          motivo: "pedido_de_agenda",
          resultado: "espera_so_com_a_equipe",
          passo,
        };
      case "consulta_para_outra_pessoa":
      case "menor_de_idade":
        registrar(r.motivo);
        return { tipo: "passar", motivo: r.motivo, resultado: r.motivo, passo };
      case "ja_na_lista": {
        registrar(r.motivo);
        const entrada = r.entrada ?? null;
        const procedimento = procedimentoDe(pedido.procedimentoId)?.nome ?? null;
        if (entrada === null || procedimento === null) {
          // A entrada que ja existe sem a preferencia: o modelo so ouve que
          // a pessoa ja esta na lista (o fato sem a preferencia nao e dado:
          // a frase com dia ou periodo nao passa).
          return saida("ja_na_lista", {}, passo);
        }
        const preferencia = preferenciaEmTexto(entrada.turnos, entrada.dias);
        return saida(
          "ja_na_lista",
          { preferencia },
          `${passo} (${preferencia})`,
          {
            entradasDaEspera: [
              {
                procedimento,
                profissional:
                  entrada.profissional ??
                  (pedido.profissionalId === null
                    ? null
                    : c.nomeDoProfissional(pedido.profissionalId)),
                turnos: [...entrada.turnos],
                dias: [...entrada.dias],
                origem: "existente",
              },
            ],
          },
        );
      }
      case "ja_tem_consulta": {
        registrar(r.motivo);
        const inicio = r.inicio ?? null;
        if (inicio === null) {
          return saida("ja_tem_consulta", {}, passo, { consultaLida: true });
        }
        // D-13: ao modelo, so o dia e a hora da consulta que a pessoa tem.
        const quando = diaEHora(new Date(inicio), c.fuso, c.agoraMs);
        return saida(
          "ja_tem_consulta",
          { ...quando },
          `${passo} (${quando.dia} às ${quando.hora})`,
          {
            consultaLida: true,
            consultaComHorario: {
              ...quando,
              unidade: null,
              marcadaNestaConversa: false,
            },
          },
        );
      }
      default:
        registrar(r.motivo);
        return { tipo: "falha", passo: `${passo}.` };
    }
  }

  // -------------------------------------------------------------------------
  // entrar_na_lista_de_espera
  // -------------------------------------------------------------------------

  /** O pedido vivo como a porta manda ao banco (a pergunta de novo). */
  function doPedidoLido(p: PedidoDeEsperaLido): PedidoParaOBanco {
    return {
      procedimentoId: p.procedimentoId,
      profissionalId: p.profissionalId,
      convenioId: p.convenioId,
      particular: p.particular,
      turnos: [...p.turnos],
      dias: [...p.dias],
    };
  }

  /** A pergunta de novo (a RPC do pedido com o job deste turno). */
  function perguntarDeNovo(
    vivo: PedidoDeEsperaLido,
    porque: string,
    contaFalha: boolean,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    if (contaFalha) {
      // A falha que o avanco do turno nao apaga (AG4): a pergunta que
      // nunca confere passa para a equipe na segunda vez.
      registrar("resposta_fora_da_pergunta");
    }
    return pedirPelaRpc(doPedidoLido(vivo), porque);
  }

  async function entrar(
    argumentos: unknown,
  ): Promise<ResultadoDaFerramentaDeAgenda> {
    if (!entradaDaEntradaNaEsperaSchema.safeParse(argumentos ?? {}).success) {
      registrar("entrada_invalida");
      return saida(
        "entrada_invalida",
        {},
        "Tentou colocar na lista de espera com um pedido fora do formato",
      );
    }
    if (chamouAPorta) {
      registrar("um_pedido_de_espera_por_resposta");
      return saida(
        "um_pedido_de_espera_por_resposta",
        {},
        "Tentou a lista de espera duas vezes na mesma resposta: recusado",
      );
    }
    if (leituraFalhou) {
      return {
        tipo: "falha",
        passo: "Não foi possível ler o pedido da lista de espera desta conversa.",
      };
    }
    const vivo = lida?.vivo ?? null;
    if (vivo === null) {
      registrar("sem_pergunta_de_espera");
      return saida(
        "sem_pergunta_de_espera",
        {},
        "Tentou colocar na lista de espera sem a pergunta da lista feita numa mensagem anterior",
      );
    }
    // A pergunta do turno anterior nao vale mais: o SISTEMA pergunta de
    // novo, com o job deste turno (so a vencida nao conta falha).
    if (pergunta === "vencida") {
      return perguntarDeNovo(
        vivo,
        "A pergunta da lista de espera venceu (mais de 1 hora sem a resposta)",
        false,
      );
    }
    if (pergunta === "outra_mensagem") {
      return perguntarDeNovo(
        vivo,
        "A resposta da pessoa não veio logo depois da pergunta da lista de espera (outra mensagem da clínica saiu no meio)",
        true,
      );
    }
    if (pergunta !== "conferida") {
      return perguntarDeNovo(
        vivo,
        "Não deu para conferir que a resposta da pessoa veio logo depois da pergunta da lista de espera",
        true,
      );
    }
    // D-30: o "sim" numa lista fechada propria, nas mensagens da pessoa
    // depois da pergunta (o texto original, que nao sai daqui). A resposta
    // que cita (ou toca o botao de) outra mensagem nunca e o "sim".
    const resposta = citouOutra
      ? "nao_reconhecida"
      : interpretarRespostaAListaDeEspera(c.pendentes.map((m) => m.original));
    const texto = emTexto(vivo);
    if (texto === null) {
      return {
        tipo: "falha",
        passo: "Não foi possível ler o procedimento, o profissional ou o convênio do pedido da lista de espera.",
      };
    }
    const descricao = pedidoDaEsperaEmTexto(texto);
    if (resposta === "nao") {
      registrar("paciente_nao_quis");
      return saida(
        "paciente_nao_quis",
        {},
        `A pessoa não quis entrar na lista de espera para ${descricao}: nada foi gravado`,
      );
    }
    if (resposta === "nao_reconhecida") {
      // Nao e um sim claro: a pergunta volta (re-ancorada neste job) e conta
      // uma falha.
      registrar("espera_sem_confirmacao_clara");
      if (citouOutra) {
        registrar("resposta_fora_da_pergunta");
      }
      return pedirPelaRpc(
        doPedidoLido(vivo),
        citouOutra
          ? `Não colocou na lista de espera: ${PASSO_DA_RESPOSTA_A_OUTRA_MENSAGEM}`
          : "A resposta não foi um sim claro",
      );
    }
    chamouAPorta = true;
    let r: RespostaDaEntradaNaEspera;
    try {
      if (porta === null || porta.entrarNaListaDeEspera === undefined) {
        throw new Error("sem porta");
      }
      r = await porta.entrarNaListaDeEspera();
    } catch {
      return {
        tipo: "falha",
        passo: "Não foi possível colocar na lista de espera agora.",
      };
    }
    if (!r.ok) {
      // pedido_vencido e sem_confirmacao_do_paciente: "pergunte de novo"
      // (so o segundo conta falha). A pergunta de novo chama a RPC do pedido
      // (a da entrada ja foi chamada; a do pedido ainda nao).
      if (r.motivo === "pedido_vencido" || r.motivo === "sem_confirmacao_do_paciente") {
        registrar(r.motivo);
        chamouAPorta = false;
        return perguntarDeNovo(
          vivo,
          `Não colocou na lista de espera: ${ROTULO_DO_MOTIVO_DA_ESPERA[r.motivo]}`,
          r.motivo === "sem_confirmacao_do_paciente",
        );
      }
      if (r.motivo === "sem_pedido_de_espera") {
        // O preparo leu o pedido vivo e o banco nao: ninguem sabe o que
        // aconteceu (falha fechada).
        registrar(r.motivo);
        return {
          tipo: "falha",
          passo: `Não colocou na lista de espera: ${ROTULO_DO_MOTIVO_DA_ESPERA.sem_pedido_de_espera}.`,
        };
      }
      return recusaDaEspera(r, doPedidoLido(vivo), "Não colocou na lista de espera");
    }
    // A T-E2 com a entrada como o banco a gravou (a preferencia do pedido,
    // normalizada; os nomes do Cadastro, e sem eles os que a RPC trouxe).
    const feita: PedidoDeEsperaLido = { ...vivo, turnos: r.turnos, dias: r.dias };
    const daEntrada = emTexto(feita, r) ?? texto;
    const descricaoDaEntrada = pedidoDaEsperaEmTexto(daEntrada);
    entrouNoTurno = feita;
    registrar("entrou_na_lista");
    return frase(
      respostaDaListaDeEspera(daEntrada),
      porta.simulada
        ? `Colocaria a pessoa na lista de espera para ${descricaoDaEntrada}. ${SIMULADO}`
        : r.reutilizado
          ? `Colocou a pessoa na lista de espera para ${descricaoDaEntrada} (a mesma resposta retomada: a entrada já estava feita)`
          : `Colocou a pessoa na lista de espera para ${descricaoDaEntrada}`,
      "entrou_na_lista",
      {
        acao: "lista_de_espera",
        entradasDaEspera: [entradaComoFato(daEntrada, "turno")],
        coberturas: coberturasDo(vivo),
      },
    );
  }

  // -------------------------------------------------------------------------
  // O bloco do modelo, os fatos e a nota
  // -------------------------------------------------------------------------

  /** As entradas desta conversa (relidas) e a do turno, em texto. */
  function entradasEmTexto(): PedidoDaEsperaEmTexto[] {
    const todas = [
      ...(lida?.entradas ?? []),
      ...(entrouNoTurno === null ? [] : [entrouNoTurno]),
    ];
    return todas.flatMap((p) => {
      const texto = emTexto(p);
      return texto === null ? [] : [texto];
    });
  }

  function paraOModelo(): ListaDeEsperaParaOModelo | null {
    const entradas = (lida?.entradas ?? []).flatMap((p) => {
      const texto = emTexto(p);
      return texto === null ? [] : [pedidoDaEsperaEmTexto(texto)];
    });
    const vivo = lida?.vivo ?? null;
    const daPergunta: ListaDeEsperaParaOModelo["pergunta"] =
      vivo === null || pergunta === "nenhuma"
        ? null
        : pergunta === "conferida"
          ? "feita"
          : "nao_vale_mais";
    if (daPergunta === null && entradas.length === 0) {
      return null;
    }
    return { pergunta: daPergunta, entradas };
  }

  function fatosDoEstado(): FatosDaFerramenta | null {
    const entradas = (lida?.entradas ?? []).flatMap((p) => {
      const texto = emTexto(p);
      return texto === null ? [] : [entradaComoFato(texto, "conversa")];
    });
    return entradas.length === 0 ? null : { entradasDaEspera: entradas };
  }

  function nota(): ListaDeEsperaNaNota | null {
    const entradas = entradasEmTexto();
    const ultima = entradas.at(-1);
    if (ultima !== undefined) {
      return { pedido: pedidoDaEsperaEmTexto(ultima), situacao: "entrou" };
    }
    // A pergunta feita neste turno, ou a de um turno anterior que a pessoa
    // ainda nao confirmou (o pedido vivo desta janela): a equipe sabe do
    // pedido.
    const perguntado = perguntadoNoTurno ?? lida?.vivo ?? null;
    if (perguntado === null) {
      return null;
    }
    const texto = emTexto(perguntado);
    return texto === null
      ? null
      : { pedido: pedidoDaEsperaEmTexto(texto), situacao: "perguntada" };
  }

  return {
    ler,
    temPerguntaAConferir,
    conferir,
    executar: (nome, argumentos) =>
      nome === "pedir_lista_de_espera" ? pedir(argumentos) : entrar(argumentos),
    paraOModelo,
    fatosDoEstado,
    nota,
  };
}
