import {
  CircleCheck,
  CirclePause,
  CircleQuestionMark,
  FlaskConical,
  Hourglass,
  RadioTower,
} from "lucide-react";
import { z } from "zod";

import {
  telefoneFormatado,
  type NumeroDoWhatsapp,
} from "@/components/whatsapp/numeros";
import type { StatusDefinition } from "@/lib/design/status";
import {
  agenteAtendeAgora,
  fimDoExpedienteAgora,
} from "@/lib/domain/agente/config";
import { formatarTelefone, normalizarTelefone } from "@/lib/domain/telefone";
import type {
  DadosDaIa,
  LiberacaoDaClinica,
  ModoDaIa,
} from "@/lib/queries/ia-liberacao";

// Regras da aba "WhatsApp" da tela Agente de IA (Tela 6). Ate a onda 2 era a
// aba "Agente de IA" de Configuracoes (Fase 3; decisao do dono em
// 05/10/2026); o item 8 da onda 2 (decisao do dono de 20/10/2026) juntou
// tudo do agente na Tela 6. Modulo puro, sem "use client": a aba, as Server
// Actions (app/(app)/agente/whatsapp-actions.ts), o Painel geral e os testes
// usam as mesmas regras, e o que a tela desabilita e o mesmo que a acao
// recusa no servidor.
//
// - A aba so existe nas clinicas com o agente habilitado (a lista do banco,
//   ia_clinicas_da_fase_controlada, que o super admin muda pelo Painel
//   geral; abaDaIaVisivel, em lib/queries/ia-liberacao.ts, decidida no
//   servidor). O que se muda aqui vale na hora, sem publicar.
// - Quem altera: o administrador da clinica e o super admin. Gestor ve tudo
//   desabilitado, com a dica ("Só o administrador da clínica muda isto.").
//   Recepcao ve so a linha de quem cuida (a RLS nao entrega as linhas).
// - Nesta fase (E3, 13/10/2026), LIGAR o atendimento pelo WhatsApp e so da
//   equipe Conduzza: escolher "Conversar com a equipe" e ligar um numero. O
//   administrador ve esses controles desabilitados, com a dica
//   soEquipeConduzzaLiga; desligar continua com ele. O banco confere de novo
//   (ia_exigir_equipe_conduzza).
// - Producao (onda 2, item 11, decisoes P11a a P11e): "Atendendo os
//   contatos" (o modo numero_inteiro do banco) aparece aqui e so muda pelo
//   Painel geral, com os requisitos cumpridos. A clinica pausa e retoma
//   sozinha (pausada_pela_clinica, T7). O interruptor geral saiu da aba e
//   foi para o topo do Painel geral (P8); o teto ficou como linha de
//   leitura.
// - Numeros do assistente (decisao do dono de 19/10/2026, migration
//   20261019110000): a clinica pode ter VARIOS numeros ligados ao mesmo
//   tempo, e cada um liga e desliga sozinho. O assistente responde por
//   qualquer numero ligado e conectado; o verde exige pelo menos um. Nenhum
//   ligado e "Nenhum número ligado ao assistente."; ligados, mas nenhum
//   conectado, um motivo por numero, com o nome dele.
// - Telefone da equipe (decisao do dono de 19/10/2026, migration
//   20261019100000): adicionar e "Ligar de novo" com o administrador da
//   clinica (e o super admin), com a confirmacao do aviso da OpenAI. Onda 2:
//   "Excluir" (item 9) e o "Usar mesmo assim" do telefone de paciente pelo
//   administrador, com a confirmacao do teste (item 3, decisao P3 do dono);
//   o telefone fora do publico escolhido (item 4, P4b) diz por que nao
//   aciona.
// - O estado diz a verdade de HOJE: "Ligado, mas parado" quando a escolha
//   da clinica e ligar, mas alguma trava ainda diz nao (ambiente, interruptor
//   geral, pausa, teto de gasto, versao publicada, horario, motor da IA,
//   numeros, telefone). O verde so aparece sem nenhum motivo e com tudo
//   conferido: leitura que falhou vira "Não deu para conferir agora" (achado
//   T3 da revisao). O teto e a versao vem de situacao_da_ia_na_clinica (so o
//   booleano do teto: ia_uso continua so do super admin).
// - Revisao de producao de 19/10/2026 (migration 20261019120000):
//   - a linha do telefone com conversa aberta com a equipe diz QUAL numero e
//     o que fazer (assumir e resolver no Atendimento), com o link para a
//     conversa; "Conversa com o assistente" so com pelo menos um numero
//     ligado e conectado SEM conversa aberta para aquele telefone (nesse
//     numero a proxima mensagem dele abre conversa nova com o assistente);
//   - quem desliga e nao liga de novo (o administrador da clinica) le
//     "Depois de desligar, só a equipe Conduzza liga de novo." junto do
//     Desligado, do So simulador e do Desligar de numero;
//   - para o super admin (a equipe Conduzza), os motivos do servidor, do
//     interruptor e do motor dizem o que conferir, sem mandar avisar a
//     propria equipe Conduzza (textoDoMotivo).

/**
 * O que a clinica tem ligado. "equipe" e o modo 'contatos' do banco (so os
 * telefones da equipe); "producao" e o 'numero_inteiro' (onda 2, item 11),
 * que so o Painel geral liga.
 */
export type EscolhaDaIa = "desligado" | "simulador" | "equipe" | "producao";

/** As opcoes do seletor da aba, na ordem. */
export const ESCOLHAS_DA_IA: readonly EscolhaDaIa[] = [
  "desligado",
  "simulador",
  "equipe",
  "producao",
];

/** O que a aba grava (a producao e so do Painel geral). */
export type EscolhaDaAba = Exclude<EscolhaDaIa, "producao">;

export const MODO_DA_ESCOLHA: Record<
  Exclude<EscolhaDaAba, "desligado">,
  ModoDaIa
> = { simulador: "simulador", equipe: "contatos" };

export const ROTULO_DA_ESCOLHA: Record<EscolhaDaIa, string> = {
  desligado: "Desligado",
  simulador: "Só simulador",
  equipe: "Conversar com a equipe",
  producao: "Atendendo os contatos",
};

/**
 * A escolha gravada: sem linha ou nao liberada e "desligado". O modo e lido
 * como texto: 'numero_inteiro' chega com a migration da producao (M3), e a
 * aba entende o valor antes e depois de o tipo do leitor ganhar a opcao.
 */
export function escolhaAtual(
  liberacao: LiberacaoDaClinica | null,
): EscolhaDaIa {
  if (!liberacao || !liberacao.liberada) {
    return "desligado";
  }
  const modo: string = liberacao.modo;
  if (modo === "numero_inteiro") {
    return "producao";
  }
  return modo === "contatos" ? "equipe" : "simulador";
}

/** O assistente responde pelo WhatsApp (equipe ou producao)? */
export function whatsappLigado(escolha: EscolhaDaIa): boolean {
  return escolha === "equipe" || escolha === "producao";
}

/** Por que a IA ligada pela clinica ainda nao responde. */
export type MotivoDaParada =
  | "servidor"
  | "interruptor"
  | "pausada"
  | "sem_versao_publicada"
  | "horario_nao_suportado"
  | "fora_do_horario_agora"
  | "teto_atingido"
  | "motor_parado"
  | "sem_numero"
  | "numero_desconectado"
  | "sem_telefone";

export type ContextoDaIa = {
  dados: DadosDaIa;
  /**
   * Os numeros ATIVOS da clinica (a mesma leitura da aba WhatsApp de
   * Configuracoes). Nulo: a leitura falhou, e a aba nao afirma nada sobre a
   * conexao.
   */
  numeros: readonly NumeroDoWhatsapp[] | null;
  /** T1 e T2: producao com a chave da OpenAI e a clinica na lista do banco. */
  ambienteLigado: boolean;
  /** Agora (epoch ms), para fora_do_horario_agora. */
  agoraMs: number;
  /** Fuso da clinica (CLAUDE.md 3.6), para o horario de operacao. */
  fuso: string;
};

/** Um numero ligado ao assistente: o id e, com a lista de numeros, os detalhes. */
export type NumeroLigado = { id: string; numero: NumeroDoWhatsapp | null };

/**
 * Os numeros que a IA usa: os ligados que ainda sao numeros ativos da
 * clinica (numero removido nao atende: ia_pode_atender confere), na ordem
 * da lista de numeros. Sem a lista (leitura que falhou), os ids ligados, sem
 * os detalhes da conexao. Vazia: nenhum.
 */
export function numerosLigados(
  dados: DadosDaIa,
  numeros: readonly NumeroDoWhatsapp[] | null,
): NumeroLigado[] {
  if (numeros === null) {
    return dados.numerosLigados.map((id) => ({ id, numero: null }));
  }
  return numeros
    .filter((numero) => dados.numerosLigados.includes(numero.id))
    .map((numero) => ({ id: numero.id, numero }));
}

/**
 * Os ligados que NAO estao conectados (so com a lista de numeros: sem ela, a
 * aba nao afirma nada sobre a conexao). Cada um ganha o aviso na propria
 * linha; se nenhum ligado esta conectado, viram o motivo da parada.
 */
export function numerosLigadosDesconectados(
  dados: DadosDaIa,
  numeros: readonly NumeroDoWhatsapp[] | null,
): NumeroDoWhatsapp[] {
  return numerosLigados(dados, numeros).flatMap((ligado) =>
    ligado.numero && ligado.numero.status !== "conectado"
      ? [ligado.numero]
      : [],
  );
}

/** O numero na lista "Números do assistente": ligado ao assistente ou nao. */
export type EstadoDoNumero = "ligado" | "desligado";

export function estadoDoNumero(
  dados: DadosDaIa,
  numeroId: string,
): EstadoDoNumero {
  return dados.numerosLigados.includes(numeroId) ? "ligado" : "desligado";
}

/**
 * Os telefones ativos da lista cujo contato nao cabe no publico publicado
 * (situacao_da_ia_na_clinica.telefones_fora_do_publico, onda 2, item 4). A
 * chave e OPCIONAL no leitor (contrato da onda 2, secao 7: ausente =
 * nenhum), entao a aba le o campo sem exigir que o tipo ja o tenha.
 */
export function telefonesForaDoPublico(dados: DadosDaIa): readonly string[] {
  const situacao = dados.situacao;
  const valor: unknown =
    "telefonesForaDoPublico" in situacao
      ? situacao.telefonesForaDoPublico
      : undefined;
  return Array.isArray(valor)
    ? valor.filter((id): id is string => typeof id === "string")
    : [];
}

/** Por que um telefone da lista nao aciona o assistente. */
export type MotivoDoTelefone =
  "invalido" | "sem_autorizacao" | "fora_do_publico";

/**
 * Por que o telefone nao aciona o assistente, ou null (aciona quando
 * ligado). "invalido" (situacao.telefonesInvalidos): numero de WhatsApp do
 * Conduzza, ou contato com sinal de paciente sem o "forcar" (D-B),
 * inclusive o forcado depois de desligado (o gatilho zera o forcado; so
 * volta pelo formulario de adicionar com o forcar). "sem_autorizacao"
 * (situacao.telefonesSemAutorizacao): o contato revogou a autorizacao para
 * receber mensagens, e o executor passa a conversa sem responder.
 * "fora_do_publico" (onda 2, P4b): o contato nao cabe no publico escolhido
 * em Regras e limites (so leads, so pacientes).
 */
export function porQueNaoAciona(
  dados: DadosDaIa,
  telefoneId: string,
): MotivoDoTelefone | null {
  if (dados.situacao.telefonesInvalidos.includes(telefoneId)) {
    return "invalido";
  }
  if (dados.situacao.telefonesSemAutorizacao.includes(telefoneId)) {
    return "sem_autorizacao";
  }
  if (telefonesForaDoPublico(dados).includes(telefoneId)) {
    return "fora_do_publico";
  }
  return null;
}

/** A frase da linha do telefone que nao aciona o assistente. */
export function textoDoTelefoneQueNaoAciona(motivo: MotivoDoTelefone): string {
  switch (motivo) {
    case "invalido":
      return TEXTOS_DA_IA.telefoneInvalidoNaLinha;
    case "sem_autorizacao":
      return TEXTOS_DA_IA.telefoneSemAutorizacaoNaLinha;
    case "fora_do_publico":
      return TEXTOS_DA_IA.telefoneForaDoPublicoNaLinha;
  }
}

/** Algum telefone cadastrado nao aciona o assistente? */
export function temTelefoneQueNaoAciona(dados: DadosDaIa): boolean {
  return (
    dados.situacao.telefonesInvalidos.length > 0 ||
    dados.situacao.telefonesSemAutorizacao.length > 0 ||
    telefonesForaDoPublico(dados).length > 0
  );
}

/**
 * Telefones ATIVOS que acionam o assistente: o que nao aciona
 * (porQueNaoAciona) nao conta, nem ligado (o banco recusa ligar o
 * invalido; a linha antiga pode existir).
 */
export function quantosTelefonesLigados(dados: DadosDaIa): number {
  return dados.telefones.filter(
    (telefone) =>
      telefone.ativo && porQueNaoAciona(dados, telefone.id) === null,
  ).length;
}

/** O estado da linha do telefone na lista da aba. */
export type EstadoDoTelefone = "ligado" | "desligado" | "invalido";

export function estadoDoTelefone(
  dados: DadosDaIa,
  telefoneId: string,
): EstadoDoTelefone {
  if (porQueNaoAciona(dados, telefoneId) !== null) {
    return "invalido";
  }
  const telefone = dados.telefones.find((linha) => linha.id === telefoneId);
  return telefone?.ativo ? "ligado" : "desligado";
}

/** O telefone tem conversa aberta com a equipe em algum numero ligado? */
export function telefoneComConversaAberta(
  dados: DadosDaIa,
  telefoneId: string,
): boolean {
  return dados.situacao.conversasAbertas.some(
    (conversa) => conversa.telefoneId === telefoneId,
  );
}

/**
 * Uma conversa aberta com a equipe na linha do telefone: o numero (com os
 * detalhes, quando a lista de numeros carregou) e o id da conversa, que leva
 * ao Atendimento.
 */
export type ConversaAbertaNaLinha = {
  numeroId: string;
  /** Nulo: a lista de numeros falhou (a linha nao diz o nome). */
  numero: NumeroDoWhatsapp | null;
  conversaId: string;
};

/**
 * As conversas abertas com a equipe deste telefone, uma por numero ligado,
 * na ordem da lista de numeros. Sem a lista (leitura que falhou), na ordem
 * do banco e sem os detalhes. Vazia: nenhuma.
 */
export function conversasAbertasDoTelefone(
  dados: DadosDaIa,
  numeros: readonly NumeroDoWhatsapp[] | null,
  telefoneId: string,
): ConversaAbertaNaLinha[] {
  const doTelefone = dados.situacao.conversasAbertas.filter(
    (conversa) => conversa.telefoneId === telefoneId,
  );
  if (numeros === null) {
    return doTelefone.map((conversa) => ({
      numeroId: conversa.numeroId,
      numero: null,
      conversaId: conversa.conversaId,
    }));
  }
  const naOrdem = numeros.flatMap((numero) => {
    const conversa = doTelefone.find((c) => c.numeroId === numero.id);
    return conversa
      ? [{ numeroId: numero.id, numero, conversaId: conversa.conversaId }]
      : [];
  });
  // Numero que saiu da lista de ativos entre as duas leituras: fica no fim,
  // sem o nome (a conversa continua aberta e o link continua valendo).
  const foraDaLista = doTelefone
    .filter((conversa) => !numeros.some((n) => n.id === conversa.numeroId))
    .map((conversa) => ({
      numeroId: conversa.numeroId,
      numero: null,
      conversaId: conversa.conversaId,
    }));
  return [...naOrdem, ...foraDaLista];
}

/**
 * Os numeros ligados e CONECTADOS em que este telefone nao tem conversa
 * aberta com a equipe: neles, a proxima mensagem dele abre conversa nova, e
 * a conversa nova nasce com o assistente. Sem a lista de numeros, nenhum (a
 * aba nao afirma a conexao que nao conferiu).
 */
export function numerosLivresDoTelefone(
  dados: DadosDaIa,
  numeros: readonly NumeroDoWhatsapp[] | null,
  telefoneId: string,
): NumeroDoWhatsapp[] {
  const comConversa = new Set(
    dados.situacao.conversasAbertas
      .filter((conversa) => conversa.telefoneId === telefoneId)
      .map((conversa) => conversa.numeroId),
  );
  return numerosLigados(dados, numeros).flatMap((ligado) =>
    ligado.numero &&
    ligado.numero.status === "conectado" &&
    !comConversa.has(ligado.id)
      ? [ligado.numero]
      : [],
  );
}

/** O link da conversa no Atendimento (a pagina abre esta conversa). */
export function linkDaConversa(conversaId: string): string {
  return `/atendimento?conversa=${encodeURIComponent(conversaId)}`;
}

/**
 * A frase da conversa aberta na linha do telefone: o numero pelo nome; sem
 * o nome (a lista de numeros falhou), "num dos números ligados".
 */
export function textoDaConversaAberta(
  numero: Pick<NumeroDoWhatsapp, "nome"> | null,
): string {
  return numero
    ? `Tem conversa aberta com a equipe no número ${numero.nome}.`
    : TEXTOS_DA_IA.conversaAbertaNumDosNumeros;
}

/** O nome acessivel do link da conversa aberta (o numero, quando sabe). */
export function rotuloDoLinkDaConversa(
  numero: Pick<NumeroDoWhatsapp, "nome"> | null,
): string {
  return numero
    ? `Abrir no Atendimento a conversa do número ${numero.nome}`
    : "Abrir no Atendimento a conversa aberta";
}

/**
 * O que falta para "Conversar com a equipe" (a opcao fica desabilitada e a
 * acao recusa): ao menos um numero ligado e ao menos um telefone ligado.
 * Numero ligado e desconectado nao e falta (a aba avisa; o motivo e outro).
 */
export function faltasParaAEquipe(
  dados: DadosDaIa,
  numeros: readonly NumeroDoWhatsapp[] | null,
): ("sem_numero" | "sem_telefone")[] {
  const faltas: ("sem_numero" | "sem_telefone")[] = [];
  if (numerosLigados(dados, numeros).length === 0) {
    faltas.push("sem_numero");
  }
  if (quantosTelefonesLigados(dados) === 0) {
    faltas.push("sem_telefone");
  }
  return faltas;
}

/**
 * O motor da IA esta parado? Vem de situacao_da_ia_na_clinica (motor_parado,
 * revisao do E3, B8): leitura obrigatoria, entao nao existe mais o motor
 * "que nao deu para ler" tratado como motor de pe. Se a leitura falha, a aba
 * mostra o erro, nunca o verde (achado T3).
 */
export function motorDaIaParadoNaAba(dados: DadosDaIa): boolean {
  return dados.situacao.motorParado;
}

/**
 * Na ordem em que a tela lista. Vazio com a IA desligada pela clinica.
 *
 * O teto vale tambem no simulador (a reserva do simulador usa o mesmo
 * teto). Versao publicada, horario, motor e numeros so com o WhatsApp
 * ligado (equipe ou producao): o simulador usa o rascunho e roda dentro da
 * tela. Telefone da equipe so no modo equipe: em producao (numero_inteiro)
 * a lista de telefones nao e exigida (contrato da onda 2, secao 3.2).
 *
 * Numeros (varios desde 19/10/2026): sem_numero quando nenhum esta ligado;
 * numero_desconectado quando ha ligados, mas NENHUM conectado (o texto diz
 * quais, textosDaParada). Com pelo menos um ligado e conectado, o assistente
 * responde por ele: o ligado que caiu e aviso na linha dele, nao parada.
 */
export function motivosDaParada(contexto: ContextoDaIa): MotivoDaParada[] {
  const { dados, numeros, ambienteLigado, agoraMs, fuso } = contexto;
  const escolha = escolhaAtual(dados.liberacao);
  if (escolha === "desligado") {
    return [];
  }
  const motivos: MotivoDaParada[] = [];
  if (!ambienteLigado) {
    motivos.push("servidor");
  }
  if (!dados.interruptorLigado) {
    motivos.push("interruptor");
  }
  if (dados.liberacao?.pausadaPelaClinica) {
    motivos.push("pausada");
  }
  if (dados.situacao.tetoAtingido) {
    motivos.push("teto_atingido");
  }
  if (whatsappLigado(escolha)) {
    const { versaoPublicada, horarioPublicado } = dados.situacao;
    if (versaoPublicada === null) {
      motivos.push("sem_versao_publicada");
    }
    if (horarioPublicado !== null) {
      if (horarioPublicado.modo === "fallback") {
        motivos.push("horario_nao_suportado");
      } else if (!agenteAtendeAgora(horarioPublicado, agoraMs, fuso).atende) {
        motivos.push("fora_do_horario_agora");
      }
    }
    if (motorDaIaParadoNaAba(dados)) {
      motivos.push("motor_parado");
    }
    const ligados = numerosLigados(dados, numeros);
    if (ligados.length === 0) {
      motivos.push("sem_numero");
    } else if (
      numeros !== null &&
      !ligados.some((ligado) => ligado.numero?.status === "conectado")
    ) {
      motivos.push("numero_desconectado");
    }
    if (escolha === "equipe" && quantosTelefonesLigados(dados) === 0) {
      motivos.push("sem_telefone");
    }
  }
  return motivos;
}

/**
 * O que a aba nao conseguiu conferir agora (achado T3 da revisao do E3).
 * So com o WhatsApp ligado: com a leitura dos numeros de WhatsApp falhando,
 * nao da para saber se algum numero ligado ainda e da clinica nem se esta
 * conectado, e o executor exige as duas coisas. Sem numero ligado, o motivo
 * e sem_numero (isso a aba sabe sem a lista).
 */
export type ConferenciaQueFalhou = "numero";

export function oQueNaoDeuParaConferir(
  contexto: ContextoDaIa,
): ConferenciaQueFalhou[] {
  const { dados, numeros } = contexto;
  if (!whatsappLigado(escolhaAtual(dados.liberacao)) || numeros !== null) {
    return [];
  }
  return numerosLigados(dados, numeros).length > 0 ? ["numero"] : [];
}

export type EstadoDaIa =
  | "desligado"
  | "simulador"
  | "equipe"
  | "producao"
  | "parado"
  | "nao_conferido";

/**
 * O estado do cabecalho. Um motivo conhecido vence ("Ligado, mas parado":
 * isso a aba sabe); sem motivo, mas com alguma leitura que falhou, "Não deu
 * para conferir agora" (nunca o verde: a aba nao afirma o que nao
 * conferiu). O verde so com tudo conferido e nenhum motivo.
 */
export function estadoDaIa(contexto: ContextoDaIa): EstadoDaIa {
  const escolha = escolhaAtual(contexto.dados.liberacao);
  if (escolha === "desligado") {
    return "desligado";
  }
  if (motivosDaParada(contexto).length > 0) {
    return "parado";
  }
  if (oQueNaoDeuParaConferir(contexto).length > 0) {
    return "nao_conferido";
  }
  return escolha;
}

/**
 * A Tela 6 diz "Em uso no WhatsApp" so quando a aba diria o verde
 * (contrato 3.13): a mesma regra, para as duas partes nunca divergirem
 * (achado T3 da revisao). Leitura que falhou nunca vira "em uso".
 */
export function versaoEmUsoNoWhatsapp(contexto: ContextoDaIa): boolean {
  const estado = estadoDaIa(contexto);
  return estado === "equipe" || estado === "producao";
}

// Tres camadas, com icones que ja tem dono no mesmo sentido e na mesma cor
// (tabela de icones reservados de lib/design/status.ts):
// - desligado: CirclePause neutral, o mesmo da regua "Desligada";
// - simulador: FlaskConical info, o mesmo sentido (teste, nada sai para o
//   paciente) e a mesma cor dos avisos de numero de teste da aba WhatsApp;
// - equipe: CircleCheck success, ativo;
// - producao: RadioTower success, icone sem outro dono no produto (no ar
//   para os contatos), para nao repetir o da equipe no mesmo cartao;
// - parado: Hourglass warning, pendencia (ligado, esperando uma trava);
// - nao_conferido: CircleQuestionMark neutral, a aba nao sabe (leitura que
//   falhou); icone sem outro dono nos mapas do produto.
export const IA_NA_CLINICA_STATUS: Record<EstadoDaIa, StatusDefinition> = {
  desligado: { label: "Desligado", tone: "neutral", icon: CirclePause },
  simulador: { label: "Só simulador", tone: "info", icon: FlaskConical },
  equipe: {
    label: "Conversando com a equipe",
    tone: "success",
    icon: CircleCheck,
  },
  producao: {
    label: "Atendendo os contatos",
    tone: "success",
    icon: RadioTower,
  },
  parado: { label: "Ligado, mas parado", tone: "warning", icon: Hourglass },
  nao_conferido: {
    label: "Não deu para conferir agora",
    tone: "neutral",
    icon: CircleQuestionMark,
  },
};

/** Telefone da equipe: ligado ou desligado. */
export const LIGADO_DESLIGADO_STATUS: Record<
  "ligado" | "desligado",
  StatusDefinition
> = {
  ligado: { label: "Ligado", tone: "success", icon: CircleCheck },
  desligado: { label: "Desligado", tone: "neutral", icon: CirclePause },
};

/**
 * A linha do telefone da equipe, em 3 camadas. "Nao aciona o assistente"
 * (porQueNaoAciona: numero de WhatsApp do Conduzza, contato com sinal de
 * paciente sem o "forcar", inclusive o forcado depois de desligado, contato
 * que revogou a autorizacao para receber mensagens, ou contato fora do
 * publico escolhido) e pendencia: Hourglass warning, o mesmo par do
 * "Ligado, mas parado" (um icone, uma cor). A frase da linha diz qual
 * (textoDoTelefoneQueNaoAciona).
 */
export const TELEFONE_DA_EQUIPE_STATUS: Record<
  EstadoDoTelefone,
  StatusDefinition
> = {
  ligado: LIGADO_DESLIGADO_STATUS.ligado,
  desligado: LIGADO_DESLIGADO_STATUS.desligado,
  invalido: {
    label: "Não aciona o assistente",
    tone: "warning",
    icon: Hourglass,
  },
};

/**
 * A linha de cada numero em "Números do assistente" (decisao do dono de
 * 19/10/2026: varios numeros, cada um com o proprio estado), em 3 camadas,
 * ao lado do chip da conexao: ligado, CircleCheck success (o mesmo par do
 * telefone ligado); desligado, CirclePause neutral (o mesmo par do
 * "Desligado"). O rotulo do ligado muda com rotuloDoNumeroLigado; o ligado
 * que caiu tem ainda o aviso na linha (TEXTOS_DA_IA.numeroDesconectado).
 */
export const NUMERO_DO_ASSISTENTE_STATUS: Record<
  EstadoDoNumero,
  StatusDefinition
> = {
  ligado: {
    label: "Ligado ao assistente",
    tone: "success",
    icon: CircleCheck,
  },
  desligado: {
    label: "Desligado do assistente",
    tone: "neutral",
    icon: CirclePause,
  },
};

/**
 * O rotulo da linha do telefone ligado e o do numero ligado (achado T4 da
 * revisao do E3). "Conversa com o assistente" e "Em uso pelo assistente" so
 * quando o assistente esta mesmo conversando (estado "equipe" ou
 * "producao", sem nenhum motivo de parada) e, no numero, so se ELE esta
 * conectado (com varios numeros, o verde pode vir de outro). Desligado, So
 * simulador, Ligado, mas parado ou o numero que caiu: o telefone diz so
 * "Ligado" e o numero, "Ligado ao assistente". A linha nunca afirma o que o
 * cabecalho da aba nega.
 *
 * No telefone, desde a revisao de producao de 19/10/2026, "Conversa com o
 * assistente" exige tambem pelo menos um numero ligado e conectado SEM
 * conversa aberta com a equipe para ele (numerosLivresDoTelefone): com
 * conversa aberta em todos, a mensagem dele cai nela e fica com a equipe.
 */
export function rotuloDoTelefoneLigado(
  estado: EstadoDaIa,
  numerosLivres: number,
): string {
  return (estado === "equipe" || estado === "producao") && numerosLivres > 0
    ? TEXTOS_DA_IA.telefoneConversaComOAssistente
    : TELEFONE_DA_EQUIPE_STATUS.ligado.label;
}

export function rotuloDoNumeroLigado(
  estado: EstadoDaIa,
  conectado: boolean,
): string {
  return (estado === "equipe" || estado === "producao") && conectado
    ? TEXTOS_DA_IA.numeroEmUso
    : NUMERO_DO_ASSISTENTE_STATUS.ligado.label;
}

/** Onde a clinica conecta os numeros (a aba WhatsApp de Configuracoes). */
export const LINK_DOS_NUMEROS = "/configuracoes?aba=whatsapp";

export const TEXTOS_DA_IA = {
  // A linha do topo da aba (contrato da onda 2, secao 5.1): nada daqui
  // passa pelo rascunho nem pelo Publicar.
  valeNaHora: "O que você muda aqui vale na hora, sem publicar.",
  semPermissao: "Só o administrador da clínica muda isto.",
  // A recepcao ve a aba sem os cartoes (a RLS nao entrega as linhas).
  soAdministradorEGestor:
    "Os números e os telefones do assistente ficam com o administrador e o gestor.",
  soEquipeConduzza: "A equipe Conduzza liga e desliga.",
  soEquipeConduzzaLiga:
    "Nesta fase, só a equipe Conduzza liga o atendimento pelo WhatsApp.",
  // A opcao "Atendendo os contatos" (producao, onda 2): so o Painel geral
  // liga e muda.
  producaoSoPeloPainel:
    "Atendendo os contatos: só a equipe Conduzza liga, pelo Painel geral, depois de conferir os requisitos.",
  // Revisao da onda 2: em producao o seletor inteiro fica preso (a
  // clinica para pelo Pausar, P11c); o servidor e o banco recusam tambem
  // (P0001 clinica_em_producao).
  emProducaoSoPeloPainel:
    "Com o assistente atendendo os contatos, só a equipe Conduzza muda o modo, pelo Painel geral. Para parar agora, use Pausar o assistente.",
  motivos: {
    servidor:
      "A equipe Conduzza ainda não ativou o assistente para esta clínica.",
    interruptor:
      "O interruptor geral está desligado. A equipe Conduzza liga e desliga.",
    pausada: "A clínica pausou o assistente.",
    sem_versao_publicada:
      "Publique a primeira versão do assistente na tela Agente de IA.",
    horario_nao_suportado:
      "Este modo de horário ainda não funciona no WhatsApp. Use 24 horas ou Só fora do expediente.",
    // So quando o fim do expediente de hoje nao esta a mao; a aba diz a
    // hora (textoDoForaDoHorarioAgora). Onda 2 (item 7): a conversa que
    // ninguem da equipe respondeu passa para o assistente no fim do
    // expediente.
    fora_do_horario_agora:
      "Agora é o horário da equipe. O assistente volta quando o expediente acabar, e assume as conversas que ninguém da equipe respondeu.",
    teto_atingido:
      "O gasto do dia chegou ao limite. O assistente volta sozinho quando o gasto das últimas 24 horas baixar.",
    motor_parado:
      "O motor do assistente não está rodando. Avise a equipe Conduzza.",
    sem_numero: "Nenhum número ligado ao assistente.",
    // So quando o nome do numero nao esta a mao; a aba diz qual
    // (motivoDoNumeroDesconectado, por numero ligado que caiu).
    numero_desconectado:
      "Nenhum número ligado ao assistente está conectado. Conecte um número em Configurações, aba WhatsApp.",
    sem_telefone: "Nenhum telefone da equipe ligado.",
  } satisfies Record<MotivoDaParada, string>,
  /**
   * Os motivos para o super admin (a equipe Conduzza), que nao tem a quem
   * avisar (revisao de producao de 19/10/2026): o que conferir. Os demais
   * motivos sao os mesmos para todos (textoDoMotivo).
   */
  motivosParaAEquipeConduzza: {
    servidor:
      "A chave da OpenAI ou o segredo do identificador não estão no ambiente de produção da Vercel.",
    // Onda 2 (P8): o interruptor geral mora no topo do Painel geral.
    interruptor:
      "O interruptor geral está desligado. Ele fica no topo do Painel geral.",
    motor_parado:
      "O motor do assistente não está rodando. Siga o diagnóstico rápido do motor-ia em supabase/operacao/motor-por-cron.md.",
  } satisfies Partial<Record<MotivoDaParada, string>>,
  faltaParaAEquipe: "Ligue ao menos um número e um telefone da equipe antes.",
  descricaoDosNumeros:
    "O assistente responde só pelos números ligados aqui, e só para os telefones da equipe.",
  descricaoDosNumerosEmProducao:
    "O assistente responde só pelos números ligados aqui, para os contatos do público escolhido em Regras e limites.",
  conecteAntes: "Conecte este número em Configurações, aba WhatsApp, antes.",
  numeroDesconectado:
    "Este número está desconectado. Conecte o número em Configurações, aba WhatsApp, para o assistente responder.",
  semNumeros:
    "Adicione e conecte um número em Configurações, aba WhatsApp. Depois, ligue o número aqui.",
  abrirConfiguracoes: "Abrir Configurações",
  soEstesTelefones:
    "Só estes telefones conversam com o assistente. Os pacientes continuam com a equipe, como hoje.",
  // PROPOSTA, espera aprovacao do dono (revisao da onda 2): em producao
  // (numero_inteiro) a lista e a trava K nao valem; quem decide e o
  // publico. O texto de antes dizia que a lista continuava valendo.
  telefonesEmProducao:
    "Em produção, quem decide é o público escolhido em Regras e limites: o assistente atende os contatos desse público, estejam ou não nesta lista. A lista volta a valer quando o assistente voltar para o teste.",
  telefoneInvalido:
    "Telefone inválido. Informe com DDD, por exemplo (84) 99999-0000. Número de outro país começa com + e o código do país.",
  rotuloVazio: "Informe de quem é o telefone.",
  rotuloLongo: "O nome tem no máximo 80 caracteres.",
  // A linha do limite de gasto (contrato da onda 2, P8): so leitura; quem
  // ajusta e a equipe Conduzza, no Painel geral.
  tetoSemLinha:
    "O limite de gasto do assistente nasce quando ele é ligado pela primeira vez nesta clínica. Quem muda é a equipe Conduzza.",
  tetoExplicacao:
    "Ao chegar no limite, o assistente para de responder até o gasto mais antigo completar 24 horas.",
  aindaNaoResponde: "Ele ainda não começa a responder",
  // Onda 2 (item 3, decisao P3 do dono): o telefone pode ser de quem aceitou
  // testar o assistente, nao so de alguem da equipe.
  confirmarContato:
    "Confirmo que este telefone é de alguém da equipe ou de quem aceitou testar o assistente",
  semResposta: "O servidor não respondeu. Confira a conexão e tente de novo.",
  telefoneDaPlataforma:
    "Este telefone não pode ser usado como telefone da equipe. Use o celular pessoal de alguém da equipe.",
  telefoneInvalidoNaLinha:
    "Este telefone não pode ser usado como telefone da equipe.",
  telefoneSemAutorizacaoNaLinha:
    "Este contato não autorizou receber mensagens. O assistente não conversa com ele.",
  telefoneForaDoPublicoNaLinha:
    "Este contato está fora do público escolhido em Regras e limites. O assistente não conversa com ele.",
  contatoDePaciente:
    "Este telefone é de um paciente da clínica. Só use mesmo assim se a pessoa aceitou testar o assistente.",
  confirmarAvisoDaOpenai:
    "Quem usa este celular sabe que o que escrever vai para a OpenAI, nos EUA, e vai usar só dados de teste.",
  avisoDaOpenaiObrigatorio:
    "Confirme o aviso sobre a OpenAI antes de adicionar o telefone.",
  // Revisao de producao de 19/10/2026: a linha do telefone com conversa
  // aberta diz o numero (textoDaConversaAberta) e o que fazer, com o link.
  conversaAbertaNumDosNumeros:
    "Tem conversa aberta com a equipe num dos números ligados.",
  conversaAbertaAcao:
    "Para o assistente começar neste número, assuma e resolva a conversa aberta no Atendimento.",
  abrirConversa: "Abrir conversa",
  /** Junto do Desligado, do So simulador e do Desligar de numero, para quem nao liga de novo. */
  depoisDeDesligar: "Depois de desligar, só a equipe Conduzza liga de novo.",
  avisoTelefoneInvalido:
    "Há telefone da equipe que não aciona o assistente. Veja a lista de telefones.",
  naoConferidoTitulo: "Não deu para conferir agora",
  naoConferido: {
    numero:
      "Não foi possível carregar os números de WhatsApp, então não dá para saber se os números ligados ao assistente estão conectados. Recarregue a página.",
  } satisfies Record<ConferenciaQueFalhou, string>,
  telefoneConversaComOAssistente: "Conversa com o assistente",
  numeroEmUso: "Em uso pelo assistente",
  // Excluir telefone (onda 2, item 9; textos do contrato, secao 5.2).
  excluir: "Excluir",
  excluirTitulo: "Excluir este telefone da equipe?",
  excluirTexto:
    "O telefone sai da lista e deixa de conversar com o assistente. Para usar de novo, adicione outra vez.",
  excluirForcado:
    "Ele foi usado mesmo sendo de paciente: para voltar, vai precisar dessa confirmação de novo.",
  telefoneExcluido: "Telefone excluído da lista.",
  // Pausar e retomar pela clinica (onda 2, item 11, P11c; T7).
  pausar: "Pausar o assistente",
  retomar: "Retomar o assistente",
  // Revisao da onda 2: a pausa vale tambem para o simulador (a liberacao
  // vigente exige a clinica nao pausada), entao o Retomar aparece em
  // qualquer modo enquanto a pausa estiver gravada.
  pausaExplicacao:
    "Pausado, o assistente para de responder pelo WhatsApp e no simulador, e as conversas dele voltam para a equipe sem nenhuma mensagem ao paciente. A clínica retoma quando quiser.",
  retomarTitulo: "Retomar o assistente?",
  retomarTexto:
    "O assistente volta a responder no modo escolhido: no simulador e, com o WhatsApp ligado, pelos números ligados.",
  pausado: "Assistente pausado.",
  retomado: "Assistente retomado.",
} as const;

/**
 * Os textos do "Usar mesmo assim" do telefone de paciente pelo
 * administrador (onda 2, item 3, decisao P3 do dono: opcao a). A frase da
 * confirmacao e a do contrato (secao 9, P3) e vai para a trilha no nome de
 * quem forca. O titulo e o texto do dialogo sao PROPOSTA, esperam a
 * aprovacao do dono antes de ir ao ar; ficam juntos aqui, num lugar so.
 */
export const TEXTOS_DO_TESTE_COM_PACIENTE = {
  // PROPOSTA (espera a aprovacao do dono).
  titulo: "Usar o telefone de um paciente para testar?",
  // PROPOSTA (espera a aprovacao do dono).
  texto:
    "Este telefone é de um paciente da clínica. Use só com quem aceitou testar o assistente: a confirmação fica registrada no seu nome.",
  // Texto do contrato (secao 9, P3).
  confirmacao:
    "A pessoa deste telefone sabe que vai conversar com um assistente virtual de teste e que o que escrever vai para a OpenAI, nos EUA.",
  // Texto do contrato (secao 4.9): o 23514 teste_com_paciente_nao_confirmado.
  naoConfirmado:
    "Confirme que a pessoa sabe que é um teste antes de usar este telefone.",
  botao: "Usar mesmo assim",
  usando: "Salvando...",
} as const;

/**
 * O texto de um motivo da parada para quem le. O super admin e a equipe
 * Conduzza: nos motivos que mandam falar com ela (servidor, interruptor e
 * motor), ele le o que conferir (TEXTOS_DA_IA.motivosParaAEquipeConduzza);
 * os outros papeis, o texto de sempre. Revisao de producao de 19/10/2026.
 */
export function textoDoMotivo(
  motivo: MotivoDaParada,
  superAdmin = false,
): string {
  const daEquipeConduzza: Partial<Record<MotivoDaParada, string>> =
    TEXTOS_DA_IA.motivosParaAEquipeConduzza;
  return (
    (superAdmin ? daEquipeConduzza[motivo] : undefined) ??
    TEXTOS_DA_IA.motivos[motivo]
  );
}

/** Os motivos, em texto, na ordem da tela (para o super admin, os dele). */
export function textosDosMotivos(
  motivos: readonly MotivoDaParada[],
  superAdmin = false,
): string[] {
  return motivos.map((motivo) => textoDoMotivo(motivo, superAdmin));
}

/**
 * A linha de apoio junto do desligar (Desligado, So simulador com o
 * WhatsApp ligado e Desligar de numero): para quem desliga, mas nao liga de
 * novo nesta fase (o administrador da clinica). O super admin liga de novo,
 * e quem nao altera nao desliga: nula, sem linha.
 */
export function apoioAoDesligar(entrada: {
  podeEditar: boolean;
  superAdmin: boolean;
}): string | null {
  return entrada.podeEditar && !entrada.superAdmin
    ? TEXTOS_DA_IA.depoisDeDesligar
    : null;
}

/**
 * A mesma linha junto do seletor e no dialogo do "Só simulador": so com o
 * WhatsApp ligado no modo equipe. Saindo do "Só simulador" para
 * "Desligado", ou voltando a ele, o administrador religa sozinho: sem
 * linha. Em producao o seletor fica preso (revisao da onda 2): sem linha.
 */
export function apoioAoDesligarOWhatsapp(entrada: {
  escolha: EscolhaDaIa;
  podeEditar: boolean;
  superAdmin: boolean;
}): string | null {
  return entrada.escolha === "equipe" ? apoioAoDesligar(entrada) : null;
}

/** O motivo numero_desconectado de UM numero ligado, com o nome dele. */
export function motivoDoNumeroDesconectado(nome: string): string {
  return `O número ${nome} está desconectado. Conecte o número em Configurações, aba WhatsApp.`;
}

/**
 * O motivo fora_do_horario_agora com a hora em que o assistente volta (o
 * fim do expediente de hoje, no fuso da clinica; contrato da onda 2, secao
 * 4.3).
 */
export function textoDoForaDoHorarioAgora(fim: string): string {
  return `Agora é o horário da equipe. O assistente volta às ${fim}, e assume as conversas que ninguém da equipe respondeu.`;
}

/**
 * Os motivos da parada como a aba mostra: os mesmos textos de
 * textosDosMotivos (para o super admin, os dele), mas numero_desconectado
 * diz QUAL numero caiu (um item por numero ligado que nao esta conectado;
 * com varios numeros, "o numero do assistente" nao diz nada) e
 * fora_do_horario_agora diz a hora em que o assistente volta.
 */
export function textosDaParada(
  contexto: ContextoDaIa,
  superAdmin = false,
): string[] {
  return motivosDaParada(contexto).flatMap((motivo) => {
    if (motivo === "fora_do_horario_agora") {
      const horario = contexto.dados.situacao.horarioPublicado;
      const fim = horario
        ? fimDoExpedienteAgora(horario, contexto.agoraMs, contexto.fuso)
        : null;
      return [fim ? textoDoForaDoHorarioAgora(fim) : textoDoMotivo(motivo)];
    }
    if (motivo !== "numero_desconectado") {
      return [textoDoMotivo(motivo, superAdmin)];
    }
    const caidos = numerosLigadosDesconectados(
      contexto.dados,
      contexto.numeros,
    );
    return caidos.length > 0
      ? caidos.map((numero) => motivoDoNumeroDesconectado(numero.nome))
      : [TEXTOS_DA_IA.motivos.numero_desconectado];
  });
}

/**
 * Os numeros ligados como o dialogo de ligar diz: um so, com o telefone
 * ("do número Recepção, (84) 99999-0000"); varios, pelos nomes ("dos
 * números Recepção e Unidade Centro"). Nulo sem nomes (a lista de numeros
 * falhou): o dialogo nao cita numero.
 */
export function numerosDoDialogo(
  ligados: readonly NumeroLigado[],
): string | null {
  const comDetalhes = ligados.flatMap((ligado) =>
    ligado.numero ? [ligado.numero] : [],
  );
  const [unico] = comDetalhes;
  if (comDetalhes.length === 1 && unico) {
    return `do número ${[unico.nome, telefoneFormatado(unico.displayPhone)]
      .filter(Boolean)
      .join(", ")}`;
  }
  if (comDetalhes.length > 1) {
    const nomes = comDetalhes.map((numero) => numero.nome);
    const ultimo = nomes.pop();
    return `dos números ${nomes.join(", ")} e ${ultimo}`;
  }
  return null;
}

/**
 * O aviso do dialogo de ligar: as travas que ainda dizem nao (as mesmas
 * frases dos motivos da parada), mais o telefone que nao aciona o
 * assistente. Vazio: nada a avisar.
 *
 * `modo` (padrao "equipe"): no "Só simulador" so valem o ambiente e o
 * interruptor; versao publicada, motor e telefones sao do WhatsApp.
 * `superAdmin`: os textos dele (textoDoMotivo).
 */
export function avisosAoLigar(entrada: {
  ambienteLigado: boolean;
  interruptorLigado: boolean;
  versaoPublicada: number | null;
  motorParado: boolean;
  temTelefoneInvalido: boolean;
  modo?: Exclude<EscolhaDaAba, "desligado">;
  superAdmin?: boolean;
}): string[] {
  const superAdmin = entrada.superAdmin ?? false;
  const motivos: MotivoDaParada[] = [];
  if (!entrada.ambienteLigado) {
    motivos.push("servidor");
  }
  if (!entrada.interruptorLigado) {
    motivos.push("interruptor");
  }
  if ((entrada.modo ?? "equipe") === "simulador") {
    return textosDosMotivos(motivos, superAdmin);
  }
  if (entrada.versaoPublicada === null) {
    motivos.push("sem_versao_publicada");
  }
  if (entrada.motorParado) {
    motivos.push("motor_parado");
  }
  const textos = textosDosMotivos(motivos, superAdmin);
  if (entrada.temTelefoneInvalido) {
    textos.push(TEXTOS_DA_IA.avisoTelefoneInvalido);
  }
  return textos;
}

/**
 * Telefone novo que ja e de um contato (lead ou paciente) da clinica: o
 * aviso, com o nome, pede a confirmacao explicita antes de gravar. O
 * assistente conversaria com essa pessoa pelo WhatsApp.
 */
export function avisoDeContatoDaClinica(nome: string | null): string {
  const limpo = nome?.trim();
  return `Este telefone já é de um contato da clínica (${
    limpo ? limpo : "cadastro sem nome"
  }). Só confirme se for de alguém da equipe ou de quem aceitou testar o assistente.`;
}

/** "US$ 5,00 a cada 24 horas", ou nulo sem a linha de liberacao. */
export function textoDoTeto(
  liberacao: LiberacaoDaClinica | null,
): string | null {
  if (!liberacao) {
    return null;
  }
  const dolares = (liberacao.tetoDiarioCentavosUsd / 100).toLocaleString(
    "pt-BR",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  );
  return `US$ ${dolares} a cada 24 horas`;
}

/**
 * A linha do limite de gasto na aba (contrato da onda 2, P8): "Limite de
 * gasto do assistente: US$ 5,00 a cada 24 horas. Quem muda é a equipe
 * Conduzza." Sem a linha de liberacao, quando ele nasce.
 */
export function textoDoLimiteDeGasto(
  liberacao: LiberacaoDaClinica | null,
): string {
  const teto = textoDoTeto(liberacao);
  return teto
    ? `Limite de gasto do assistente: ${teto}. Quem muda é a equipe Conduzza.`
    : TEXTOS_DA_IA.tetoSemLinha;
}

/** O telefone da equipe como a recepcao discaria: "(84) 99999-0000". */
export function telefoneParaExibir(telefone: string): string {
  return formatarTelefone(telefone);
}

export const LIMITE_DO_ROTULO = 80;

/**
 * Telefone novo da equipe: de quem e (1 a 80) e o telefone, normalizado
 * para E.164 com o 55 do Brasil quando vem sem o codigo do pais (a mesma
 * normalizarTelefone de toda entrada humana). O banco confere de novo
 * (^\+[1-9][0-9]{7,14}$ e a chave canonica). confirmarContato: ver o campo.
 */
export const telefoneDaEquipeSchema = z
  .object({
    rotulo: z
      .string()
      .trim()
      .min(1, TEXTOS_DA_IA.rotuloVazio)
      .max(LIMITE_DO_ROTULO, TEXTOS_DA_IA.rotuloLongo),
    telefone: z.string().transform((valor, contexto) => {
      const e164 = normalizarTelefone(valor);
      if (!e164) {
        contexto.addIssue({
          code: "custom",
          message: TEXTOS_DA_IA.telefoneInvalido,
        });
        return z.NEVER;
      }
      return e164;
    }),
    /**
     * Marcado so depois do aviso de que o telefone ja e de um contato da
     * clinica (avisoDeContatoDaClinica). Sem ele, a acao confere e recusa.
     */
    confirmarContato: z.boolean().optional(),
    /**
     * Confirmacao de LGPD, sempre presente no formulario: quem usa o
     * celular sabe que o texto vai para a OpenAI, nos EUA, e usa so dado de
     * teste (D32). A acao grava a confirmacao em audit_log.
     */
    confirmarAvisoDaOpenai: z.literal(true, {
      message: TEXTOS_DA_IA.avisoDaOpenaiObrigatorio,
    }),
    /**
     * "Usar mesmo assim", depois da recusa de contato de paciente (D43). Na
     * onda 2 (item 3, P3) o administrador da clinica tambem forca, sempre
     * com confirmouTesteComPaciente (o dialogo da confirmacao do teste); o
     * banco confere de novo e grava a trilha no nome de quem forcou.
     */
    forcarContatoDePaciente: z.boolean().optional(),
    /**
     * A confirmacao do teste com paciente (TEXTOS_DO_TESTE_COM_PACIENTE),
     * obrigatoria com o forcar: sem ela a acao recusa, e o banco tambem
     * (23514 teste_com_paciente_nao_confirmado).
     */
    confirmouTesteComPaciente: z.boolean().optional(),
  })
  .strict();

export type AcaoDaIa =
  | "modo"
  | "escolha"
  | "equipe"
  | "producao"
  | "numero"
  | "telefone"
  | "excluir"
  | "forcar"
  | "pausa";

/**
 * A dica de cada controle desabilitado (nula = liberado): a permissao
 * primeiro, depois quem liga nesta fase, depois o que falta. Exportada para
 * o teste, porque a dica so aparece no HTML quando o tooltip abre.
 *
 * Sentido de cada acao: `modo` = o seletor do modo inteiro (revisao da
 * onda 2: com o assistente em producao, preso para todos, porque so o
 * Painel geral muda o modo e a clinica para pelo Pausar); `escolha` =
 * mudar o modo (desligar e "Só simulador"), e tambem desligar um numero
 * ou um telefone; `equipe` =
 * escolher "Conversar com a equipe"; `producao` = "Atendendo os contatos",
 * que a aba nunca liga (so o Painel geral); `numero` = LIGAR um numero
 * (cada um sozinho, desde 19/10/2026); `telefone` = ADICIONAR ou LIGAR um
 * telefone; `excluir` = excluir um telefone (onda 2, item 9); `forcar` = o
 * "Usar mesmo assim" do telefone de paciente (onda 2, item 3: o
 * administrador tambem); `pausa` = pausar e retomar (onda 2, item 11).
 * Ligar o atendimento pelo WhatsApp (modo e numero) e so da equipe Conduzza
 * nesta fase: o administrador recebe soEquipeConduzzaLiga nos dois. Com o
 * assistente em producao, o modo so muda pelo Painel geral.
 */
export function dicasDaIa(entrada: {
  podeEditar: boolean;
  superAdmin: boolean;
  faltasParaAEquipe: readonly string[];
  /** O assistente esta atendendo os contatos (producao). */
  emProducao?: boolean;
}): Record<AcaoDaIa, string | null> {
  const { podeEditar, superAdmin, faltasParaAEquipe: faltas } = entrada;
  const emProducao = entrada.emProducao ?? false;
  const permissao = podeEditar ? null : TEXTOS_DA_IA.semPermissao;
  const quemLiga =
    permissao ?? (superAdmin ? null : TEXTOS_DA_IA.soEquipeConduzzaLiga);
  return {
    modo:
      permissao ?? (emProducao ? TEXTOS_DA_IA.emProducaoSoPeloPainel : null),
    escolha: permissao,
    equipe:
      permissao ??
      (emProducao
        ? TEXTOS_DA_IA.emProducaoSoPeloPainel
        : (quemLiga ??
          (faltas.length > 0 ? TEXTOS_DA_IA.faltaParaAEquipe : null))),
    producao: emProducao ? null : TEXTOS_DA_IA.producaoSoPeloPainel,
    numero: quemLiga,
    telefone: permissao,
    excluir: permissao,
    forcar: permissao,
    pausa: permissao,
  };
}
