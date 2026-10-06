import {
  CircleCheck,
  CirclePause,
  FlaskConical,
  Hourglass,
} from "lucide-react";
import { z } from "zod";

import type { NumeroDoWhatsapp } from "@/components/whatsapp/numeros";
import type { StatusDefinition } from "@/lib/design/status";
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
// - O estado diz a verdade de HOJE: "Ligado, mas parado" quando a escolha
//   da clinica e ligar, mas alguma trava ainda diz nao (servidor,
//   interruptor geral, pausa, numero, telefone). O teto de gasto nao entra:
//   o gasto das ultimas 24 horas so o super admin le (ia_uso).

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
  /** As travas de ambiente T1 e T2 (Vercel) para esta clinica. */
  ambienteLigado: boolean;
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

export function quantosTelefonesLigados(dados: DadosDaIa): number {
  return dados.telefones.filter((telefone) => telefone.ativo).length;
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

/** Na ordem em que a tela lista. Vazio com a IA desligada pela clinica. */
export function motivosDaParada(contexto: ContextoDaIa): MotivoDaParada[] {
  const { dados, numeros, ambienteLigado } = contexto;
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
  if (escolha === "equipe") {
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

export type EstadoDaIa = "desligado" | "simulador" | "equipe" | "parado";

export function estadoDaIa(contexto: ContextoDaIa): EstadoDaIa {
  const escolha = escolhaAtual(contexto.dados.liberacao);
  if (escolha === "desligado") {
    return "desligado";
  }
  return motivosDaParada(contexto).length > 0 ? "parado" : escolha;
}

// Tres camadas, com icones que ja tem dono no mesmo sentido e na mesma cor
// (tabela de icones reservados de lib/design/status.ts):
// - desligado: CirclePause neutral, o mesmo da regua "Desligada";
// - simulador: FlaskConical info, o mesmo sentido (teste, nada sai para o
//   paciente) e a mesma cor dos avisos de numero de teste da aba WhatsApp;
// - equipe: CircleCheck success, ativo;
// - parado: Hourglass warning, pendencia (ligado, esperando uma trava).
export const IA_NA_CLINICA_STATUS: Record<EstadoDaIa, StatusDefinition> = {
  desligado: { label: "Desligado", tone: "neutral", icon: CirclePause },
  simulador: { label: "Só simulador", tone: "info", icon: FlaskConical },
  equipe: {
    label: "Conversando com a equipe",
    tone: "success",
    icon: CircleCheck,
  },
  parado: { label: "Ligado, mas parado", tone: "warning", icon: Hourglass },
};

/** Interruptor geral e telefone da equipe: ligado ou desligado. */
export const LIGADO_DESLIGADO_STATUS: Record<
  "ligado" | "desligado",
  StatusDefinition
> = {
  ligado: { label: "Ligado", tone: "success", icon: CircleCheck },
  desligado: { label: "Desligado", tone: "neutral", icon: CirclePause },
};

export const TEXTOS_DA_IA = {
  descricaoDaAba:
    "Fase de teste controlado: o assistente de IA conversa só com os telefones da equipe cadastrados aqui, por um número da clínica. Os pacientes continuam sendo atendidos pela equipe, como hoje.",
  semPermissao: "Somente o administrador da clínica altera o assistente de IA.",
  soEquipeConduzza: "A equipe Conduzza liga e desliga.",
  motivos: {
    servidor:
      "A equipe Conduzza ainda não ativou o assistente para esta clínica.",
    interruptor:
      "O interruptor geral está desligado. A equipe Conduzza liga e desliga.",
    pausada: "A clínica pausou o assistente.",
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
} as const;

/** Os motivos, em texto, na ordem da tela. */
export function textosDosMotivos(motivos: readonly MotivoDaParada[]): string[] {
  return motivos.map((motivo) => TEXTOS_DA_IA.motivos[motivo]);
}

/**
 * O aviso do dialogo de ligar: as travas da equipe Conduzza que ainda dizem
 * nao (as mesmas frases dos motivos da parada). Vazio: nada a avisar.
 */
export function avisosAoLigar(entrada: {
  ambienteLigado: boolean;
  interruptorLigado: boolean;
}): string[] {
  const motivos: MotivoDaParada[] = [];
  if (!entrada.ambienteLigado) {
    motivos.push("servidor");
  }
  if (!entrada.interruptorLigado) {
    motivos.push("interruptor");
  }
  return textosDosMotivos(motivos);
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
  })
  .strict();

export type AcaoDaIa =
  "escolha" | "equipe" | "numero" | "telefone" | "interruptor";

/**
 * A dica de cada controle desabilitado (nula = liberado): a permissao
 * primeiro, depois o que falta. Exportada para o teste, porque a dica so
 * aparece no HTML quando o tooltip abre.
 */
export function dicasDaIa(entrada: {
  podeEditar: boolean;
  superAdmin: boolean;
  faltasParaAEquipe: readonly string[];
}): Record<AcaoDaIa, string | null> {
  const { podeEditar, superAdmin, faltasParaAEquipe: faltas } = entrada;
  const permissao = podeEditar ? null : TEXTOS_DA_IA.semPermissao;
  return {
    escolha: permissao,
    equipe:
      permissao ?? (faltas.length > 0 ? TEXTOS_DA_IA.faltaParaAEquipe : null),
    numero: permissao,
    telefone: permissao,
    interruptor: superAdmin ? null : TEXTOS_DA_IA.soEquipeConduzza,
  };
}
