import {
  CircleCheck,
  CirclePause,
  CircleQuestionMark,
  FlaskConical,
  Hourglass,
} from "lucide-react";
import { z } from "zod";

import type { NumeroDoWhatsapp } from "@/components/whatsapp/numeros";
import type { StatusDefinition } from "@/lib/design/status";
import { agenteAtendeAgora } from "@/lib/domain/agente/config";
import { formatarTelefone, normalizarTelefone } from "@/lib/domain/telefone";
import type {
  DadosDaIa,
  LiberacaoDaClinica,
  ModoDaIa,
} from "@/lib/queries/ia-liberacao";

// Regras da aba "Agente de IA" de Configuracoes (Fase 3; decisao do dono em
// 05/10/2026). Modulo puro, sem "use client": a aba, as Server Actions e os
// testes usam as mesmas regras, e o que a tela desabilita e o mesmo que a
// acao recusa no servidor.
//
// - A aba so existe na teste123 e na Conduzza Teste (abaDaIaVisivel, em
//   lib/queries/ia-liberacao.ts, decidida no servidor).
// - Quem altera: o administrador da clinica e o super admin. Gestor ve tudo
//   desabilitado, com a dica. O interruptor geral e so do super admin.
// - Nesta fase (E3, 13/10/2026), LIGAR o atendimento pelo WhatsApp e so da
//   equipe Conduzza: escolher "Conversar com a equipe" e usar um numero. O
//   administrador ve esses controles desabilitados, com a dica
//   soEquipeConduzzaLiga; desligar continua com ele. O banco confere de novo
//   (ia_exigir_equipe_conduzza).
// - Telefone da equipe (decisao do dono de 19/10/2026, migration
//   20261019100000): adicionar e "Ligar de novo" voltam para o
//   administrador da clinica (e o super admin), com a mesma confirmacao do
//   aviso da OpenAI. O "Usar mesmo assim" do telefone de paciente (o forcar)
//   continua so do super admin, aqui, na action e no banco.
// - O estado diz a verdade de HOJE: "Ligado, mas parado" quando a escolha
//   da clinica e ligar, mas alguma trava ainda diz nao (ambiente, interruptor
//   geral, pausa, teto de gasto, versao publicada, horario, motor da IA,
//   numero, telefone). O verde so aparece sem nenhum motivo e com tudo
//   conferido: leitura que falhou vira "Não deu para conferir agora" (achado
//   T3 da revisao). O teto e a versao vem de situacao_da_ia_na_clinica (so o
//   booleano do teto: ia_uso continua so do super admin).

/** O que a clinica escolhe na aba. "equipe" e o modo 'contatos' do banco. */
export type EscolhaDaIa = "desligado" | "simulador" | "equipe";

export const ESCOLHAS_DA_IA: readonly EscolhaDaIa[] = [
  "desligado",
  "simulador",
  "equipe",
];

export const MODO_DA_ESCOLHA: Record<
  Exclude<EscolhaDaIa, "desligado">,
  ModoDaIa
> = { simulador: "simulador", equipe: "contatos" };

export const ROTULO_DA_ESCOLHA: Record<EscolhaDaIa, string> = {
  desligado: "Desligado",
  simulador: "Só simulador",
  equipe: "Conversar com a equipe",
};

/** A escolha gravada: sem linha ou nao liberada e "desligado". */
export function escolhaAtual(
  liberacao: LiberacaoDaClinica | null,
): EscolhaDaIa {
  if (!liberacao || !liberacao.liberada) {
    return "desligado";
  }
  return liberacao.modo === "contatos" ? "equipe" : "simulador";
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
   * Os numeros ATIVOS da clinica (a mesma leitura da aba WhatsApp). Nulo:
   * a leitura falhou, e a aba nao afirma nada sobre a conexao.
   */
  numeros: readonly NumeroDoWhatsapp[] | null;
  /** T1 e T2: producao com a chave da OpenAI e a clinica na lista fechada. */
  ambienteLigado: boolean;
  /** Agora (epoch ms), para fora_do_horario_agora. */
  agoraMs: number;
  /** Fuso da clinica (CLAUDE.md 3.6), para o horario de operacao. */
  fuso: string;
};

/**
 * O numero que a IA usa: o liberado e ativo que ainda e um numero ativo da
 * clinica (numero removido nao atende: ia_pode_atender confere). Sem a
 * lista de numeros, o id liberado sem os detalhes da conexao.
 */
export function numeroDaIa(
  dados: DadosDaIa,
  numeros: readonly NumeroDoWhatsapp[] | null,
): { id: string; numero: NumeroDoWhatsapp | null } | null {
  const ativos = dados.numeros.filter((linha) => linha.ativo);
  if (numeros === null) {
    const primeiro = ativos[0];
    return primeiro ? { id: primeiro.whatsappAccountId, numero: null } : null;
  }
  for (const linha of ativos) {
    const numero = numeros.find(
      (candidato) => candidato.id === linha.whatsappAccountId,
    );
    if (numero) {
      return { id: numero.id, numero };
    }
  }
  return null;
}

/**
 * Por que o telefone nao aciona o assistente, ou null (aciona quando
 * ligado). "invalido" (situacao.telefonesInvalidos): numero de WhatsApp do
 * Conduzza, ou contato com sinal de paciente sem o "forcar" (D-B),
 * inclusive o forcado depois de desligado (o gatilho zera o forcado; so
 * volta pelo formulario de adicionar com o forcar). "sem_autorizacao"
 * (situacao.telefonesSemAutorizacao): o contato revogou a autorizacao para
 * receber mensagens, e o executor passa a conversa sem responder.
 */
export function porQueNaoAciona(
  dados: DadosDaIa,
  telefoneId: string,
): "invalido" | "sem_autorizacao" | null {
  if (dados.situacao.telefonesInvalidos.includes(telefoneId)) {
    return "invalido";
  }
  if (dados.situacao.telefonesSemAutorizacao.includes(telefoneId)) {
    return "sem_autorizacao";
  }
  return null;
}

/** A frase da linha do telefone que nao aciona o assistente. */
export function textoDoTelefoneQueNaoAciona(
  motivo: "invalido" | "sem_autorizacao",
): string {
  return motivo === "invalido"
    ? TEXTOS_DA_IA.telefoneInvalidoNaLinha
    : TEXTOS_DA_IA.telefoneSemAutorizacaoNaLinha;
}

/** Algum telefone cadastrado nao aciona o assistente? */
export function temTelefoneQueNaoAciona(dados: DadosDaIa): boolean {
  return (
    dados.situacao.telefonesInvalidos.length > 0 ||
    dados.situacao.telefonesSemAutorizacao.length > 0
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

/** O telefone tem conversa aberta com a equipe no numero escolhido? */
export function telefoneComConversaAberta(
  dados: DadosDaIa,
  telefoneId: string,
): boolean {
  return dados.situacao.telefonesComConversaAberta.includes(telefoneId);
}

/**
 * O que falta para "Conversar com a equipe" (a opcao fica desabilitada e a
 * acao recusa): um numero escolhido e ao menos um telefone ligado.
 */
export function faltasParaAEquipe(
  dados: DadosDaIa,
  numeros: readonly NumeroDoWhatsapp[] | null,
): ("sem_numero" | "sem_telefone")[] {
  const faltas: ("sem_numero" | "sem_telefone")[] = [];
  if (!numeroDaIa(dados, numeros)) {
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
 * teto). Versao publicada, horario e motor so no modo equipe: o simulador
 * usa o rascunho e roda dentro da tela.
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
  if (escolha === "equipe") {
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
    const escolhido = numeroDaIa(dados, numeros);
    if (!escolhido) {
      motivos.push("sem_numero");
    } else if (escolhido.numero && escolhido.numero.status !== "conectado") {
      motivos.push("numero_desconectado");
    }
    if (quantosTelefonesLigados(dados) === 0) {
      motivos.push("sem_telefone");
    }
  }
  return motivos;
}

/**
 * O que a aba nao conseguiu conferir agora (achado T3 da revisao do E3).
 * So no modo equipe: com a leitura dos numeros de WhatsApp falhando, nao da
 * para saber se o numero escolhido ainda e da clinica nem se esta
 * conectado, e o executor exige as duas coisas. Sem numero liberado, o
 * motivo e sem_numero (isso a aba sabe sem a lista).
 */
export type ConferenciaQueFalhou = "numero";

export function oQueNaoDeuParaConferir(
  contexto: ContextoDaIa,
): ConferenciaQueFalhou[] {
  const { dados, numeros } = contexto;
  if (escolhaAtual(dados.liberacao) !== "equipe" || numeros !== null) {
    return [];
  }
  return numeroDaIa(dados, numeros) ? ["numero"] : [];
}

export type EstadoDaIa =
  "desligado" | "simulador" | "equipe" | "parado" | "nao_conferido";

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
 * (contrato 3.13): a mesma regra, para as duas telas nunca divergirem
 * (achado T3 da revisao). Leitura que falhou nunca vira "em uso".
 */
export function versaoEmUsoNoWhatsapp(contexto: ContextoDaIa): boolean {
  return estadoDaIa(contexto) === "equipe";
}

// Tres camadas, com icones que ja tem dono no mesmo sentido e na mesma cor
// (tabela de icones reservados de lib/design/status.ts):
// - desligado: CirclePause neutral, o mesmo da regua "Desligada";
// - simulador: FlaskConical info, o mesmo sentido (teste, nada sai para o
//   paciente) e a mesma cor dos avisos de numero de teste da aba WhatsApp;
// - equipe: CircleCheck success, ativo;
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
  parado: { label: "Ligado, mas parado", tone: "warning", icon: Hourglass },
  nao_conferido: {
    label: "Não deu para conferir agora",
    tone: "neutral",
    icon: CircleQuestionMark,
  },
};

/** Interruptor geral e telefone da equipe: ligado ou desligado. */
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
 * paciente sem o "forcar", inclusive o forcado depois de desligado, ou
 * contato que revogou a autorizacao para receber mensagens) e pendencia:
 * Hourglass warning, o mesmo par do "Ligado, mas parado" (um icone, uma
 * cor). A frase da linha diz qual (textoDoTelefoneQueNaoAciona).
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
 * O rotulo da linha do telefone ligado e o do numero escolhido (achado T4
 * da revisao do E3). "Conversa com o assistente" e "Em uso pelo assistente"
 * so quando o assistente esta mesmo conversando (estado "equipe", sem
 * nenhum motivo de parada). Desligado, So simulador ou Ligado, mas parado:
 * o telefone diz so "Ligado" (TELEFONE_DA_EQUIPE_STATUS, contrato 3.11) e
 * o numero, "Escolhido para o assistente". A linha nunca afirma o que o
 * cabecalho da aba nega.
 */
export function rotuloDoTelefoneLigado(estado: EstadoDaIa): string {
  return estado === "equipe"
    ? TEXTOS_DA_IA.telefoneConversaComOAssistente
    : TELEFONE_DA_EQUIPE_STATUS.ligado.label;
}

export function rotuloDoNumeroEscolhido(estado: EstadoDaIa): string {
  return estado === "equipe"
    ? TEXTOS_DA_IA.numeroEmUso
    : TEXTOS_DA_IA.numeroEscolhido;
}

export const TEXTOS_DA_IA = {
  descricaoDaAba:
    "Fase de teste controlado: o assistente de IA conversa só com os telefones da equipe cadastrados aqui, por um número da clínica. Os pacientes continuam sendo atendidos pela equipe, como hoje.",
  semPermissao: "Somente o administrador da clínica altera o assistente de IA.",
  soEquipeConduzza: "A equipe Conduzza liga e desliga.",
  soEquipeConduzzaLiga:
    "Nesta fase, só a equipe Conduzza liga o atendimento pelo WhatsApp.",
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
    fora_do_horario_agora:
      "Agora está fora do horário escolhido para o assistente.",
    teto_atingido:
      "O gasto do dia chegou ao limite. O assistente volta sozinho quando o gasto das últimas 24 horas baixar.",
    motor_parado:
      "O motor do assistente não está rodando. Avise a equipe Conduzza.",
    sem_numero: "Nenhum número escolhido para o assistente.",
    numero_desconectado:
      "O número do assistente está desconectado. Conecte o número na aba WhatsApp.",
    sem_telefone: "Nenhum telefone da equipe ligado.",
  } satisfies Record<MotivoDaParada, string>,
  faltaParaAEquipe:
    "Escolha o número e ligue ao menos um telefone da equipe antes.",
  conecteAntes: "Conecte este número em WhatsApp antes.",
  numeroDesconectado:
    "Este número está desconectado. Conecte o número na aba WhatsApp para o assistente responder.",
  soEstesTelefones:
    "Só estes telefones conversam com o assistente. Os pacientes continuam com a equipe, como hoje.",
  telefoneInvalido:
    "Telefone inválido. Informe com DDD, por exemplo (84) 99999-0000. Número de outro país começa com + e o código do país.",
  rotuloVazio: "Informe de quem é o telefone.",
  rotuloLongo: "O nome tem no máximo 80 caracteres.",
  tetoSemLinha:
    "O teto nasce quando o assistente é ligado pela primeira vez nesta clínica.",
  tetoExplicacao:
    "Ao chegar no teto, o assistente para de responder até o gasto mais antigo completar 24 horas. Só a equipe Conduzza muda o teto nesta fase.",
  aindaNaoResponde: "Ele ainda não começa a responder",
  confirmarContato: "Confirmo que este telefone é de alguém da equipe",
  semResposta: "O servidor não respondeu. Confira a conexão e tente de novo.",
  telefoneDaPlataforma:
    "Este telefone não pode ser usado como telefone da equipe. Use o celular pessoal de alguém da equipe.",
  telefoneInvalidoNaLinha:
    "Este telefone não pode ser usado como telefone da equipe.",
  telefoneSemAutorizacaoNaLinha:
    "Este contato não autorizou receber mensagens. O assistente não conversa com ele.",
  contatoDePaciente:
    "Este telefone é de um paciente da clínica. A IA só conversa com telefones da equipe.",
  forcarContatoDePaciente: "Usar mesmo assim (fica registrado)",
  soEquipeConduzzaForca:
    "Somente a equipe Conduzza usa o telefone de um paciente como telefone da equipe.",
  confirmarAvisoDaOpenai:
    "Quem usa este celular sabe que o que escrever vai para a OpenAI, nos EUA, e vai usar só dados de teste.",
  avisoDaOpenaiObrigatorio:
    "Confirme o aviso sobre a OpenAI antes de adicionar o telefone.",
  conversaAbertaNoNumero:
    "Tem conversa aberta com a equipe neste número: o assistente começa na próxima conversa.",
  avisoTelefoneInvalido:
    "Há telefone da equipe que não aciona o assistente. Veja a lista de telefones.",
  naoConferidoTitulo: "Não deu para conferir agora",
  naoConferido: {
    numero:
      "Não foi possível carregar os números de WhatsApp, então não dá para saber se o número do assistente está conectado. Recarregue a página.",
  } satisfies Record<ConferenciaQueFalhou, string>,
  telefoneConversaComOAssistente: "Conversa com o assistente",
  numeroEmUso: "Em uso pelo assistente",
  numeroEscolhido: "Escolhido para o assistente",
} as const;

/** Os motivos, em texto, na ordem da tela. */
export function textosDosMotivos(motivos: readonly MotivoDaParada[]): string[] {
  return motivos.map((motivo) => TEXTOS_DA_IA.motivos[motivo]);
}

/**
 * O aviso do dialogo de ligar: as travas que ainda dizem nao (as mesmas
 * frases dos motivos da parada), mais o telefone que nao aciona o
 * assistente. Vazio: nada a avisar.
 *
 * `modo` (padrao "equipe"): no "Só simulador" so valem o ambiente e o
 * interruptor; versao publicada, motor e telefones sao do WhatsApp.
 */
export function avisosAoLigar(entrada: {
  ambienteLigado: boolean;
  interruptorLigado: boolean;
  versaoPublicada: number | null;
  motorParado: boolean;
  temTelefoneInvalido: boolean;
  modo?: Exclude<EscolhaDaIa, "desligado">;
}): string[] {
  const motivos: MotivoDaParada[] = [];
  if (!entrada.ambienteLigado) {
    motivos.push("servidor");
  }
  if (!entrada.interruptorLigado) {
    motivos.push("interruptor");
  }
  if ((entrada.modo ?? "equipe") === "simulador") {
    return textosDosMotivos(motivos);
  }
  if (entrada.versaoPublicada === null) {
    motivos.push("sem_versao_publicada");
  }
  if (entrada.motorParado) {
    motivos.push("motor_parado");
  }
  const textos = textosDosMotivos(motivos);
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
  }). Só confirme se for de alguém da equipe.`;
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
     * So o super admin ve a opcao, depois da recusa de contato de paciente
     * (D43). A action recusa o forcar de quem nao e super admin
     * (soEquipeConduzzaForca, sem banco), e o banco confere de novo
     * (ia_exigir_equipe_conduzza) e grava a trilha.
     */
    forcarContatoDePaciente: z.boolean().optional(),
  })
  .strict();

export type AcaoDaIa =
  "escolha" | "equipe" | "numero" | "telefone" | "interruptor";

/**
 * A dica de cada controle desabilitado (nula = liberado): a permissao
 * primeiro, depois quem liga nesta fase, depois o que falta. Exportada para
 * o teste, porque a dica so aparece no HTML quando o tooltip abre.
 *
 * Sentido de cada acao: `escolha` = mudar o modo (desligar e "Só
 * simulador"), e tambem desligar um numero ou um telefone; `equipe` =
 * escolher "Conversar com a equipe"; `numero` = USAR um numero; `telefone` =
 * ADICIONAR ou LIGAR um telefone. Ligar o atendimento pelo WhatsApp (modo e
 * numero) e so da equipe Conduzza nesta fase: o administrador recebe
 * soEquipeConduzzaLiga nos dois. O telefone, desde 19/10/2026 (decisao do
 * dono), so pede a permissao, como desligar.
 */
export function dicasDaIa(entrada: {
  podeEditar: boolean;
  superAdmin: boolean;
  faltasParaAEquipe: readonly string[];
}): Record<AcaoDaIa, string | null> {
  const { podeEditar, superAdmin, faltasParaAEquipe: faltas } = entrada;
  const permissao = podeEditar ? null : TEXTOS_DA_IA.semPermissao;
  const quemLiga =
    permissao ?? (superAdmin ? null : TEXTOS_DA_IA.soEquipeConduzzaLiga);
  return {
    escolha: permissao,
    equipe:
      quemLiga ?? (faltas.length > 0 ? TEXTOS_DA_IA.faltaParaAEquipe : null),
    numero: quemLiga,
    telefone: permissao,
    interruptor: superAdmin ? null : TEXTOS_DA_IA.soEquipeConduzza,
  };
}
