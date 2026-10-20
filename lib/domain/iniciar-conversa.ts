import { canEdit, type Role } from "@/lib/domain/permissions";

// "Iniciar conversa" (decisao do dono em 20/10/2026): a equipe manda a
// primeira mensagem pelo sistema para quem nunca escreveu, desde que a
// autorizacao para receber mensagens esteja registrada. PURO, zero I/O: a
// Server Action (app/(app)/atendimento/iniciar-conversa-actions.ts) e as
// telas (gaveta de Leads e ficha do paciente) usam as mesmas regras e as
// mesmas frases, sem travessao.
//
// Nada em massa aqui: disparo em massa continua so pela regua, com a fila
// (regra 3.3). Esta e uma mensagem 1:1, digitada por uma pessoa.

/** Teto da mensagem: o mesmo do envio do atendente (bodySchema do Inbox). */
export const TEXTO_MAXIMO_DA_PRIMEIRA_MENSAGEM = 4096;

/**
 * Quem inicia conversa: quem responde no Atendimento E edita leads e
 * pacientes (a mesma matriz das duas pontas: a conversa nasce no
 * Atendimento a partir da ficha do contato). Na pratica, administrador,
 * gestor e recepcao; o profissional responde so as conversas dele e so ve
 * leads e pacientes, e leitura so acompanha.
 */
export function podeIniciarConversa(role: Role): boolean {
  return canEdit(role, "atendimento") && canEdit(role, "leads_pacientes");
}

export const DICA_SEM_PERMISSAO_PARA_INICIAR =
  "Seu perfil não pode iniciar conversas.";

/** A dica do botao desabilitado por papel; null quando o papel pode. */
export function dicaParaIniciarConversa(role: Role): string | null {
  return podeIniciarConversa(role) ? null : DICA_SEM_PERMISSAO_PARA_INICIAR;
}

/** Botao desabilitado quando o contato nao tem autorizacao vigente. */
export const DICA_SEM_AUTORIZACAO_PARA_INICIAR =
  "Registre a autorização para receber mensagens na ficha para iniciar a conversa.";

/** Recusa da Server Action sem autorizacao vigente (nada e gravado). */
export const MENSAGEM_SEM_AUTORIZACAO_PARA_INICIAR =
  "Este contato não autorizou receber mensagens. Registre a autorização na ficha antes de iniciar a conversa.";

export const MENSAGEM_SEM_NUMERO_PARA_INICIAR =
  "A clínica ainda não tem número de WhatsApp. Conecte um número em Configurações para iniciar conversas.";

export const MENSAGEM_CONVERSA_COM_OUTRA_PESSOA =
  "Este contato já tem uma conversa aberta neste número, com outra pessoa da equipe. Abra a conversa no Atendimento.";

/** O minimo de um numero da clinica para escolher por onde a conversa sai. */
export type NumeroParaIniciar = {
  id: string;
  nome: string;
  connection_status: string;
  principal: boolean;
};

export function numeroConectado(numero: {
  connection_status: string;
}): boolean {
  return numero.connection_status === "conectado";
}

/**
 * O numero ja escolhido ao abrir: o principal, se estiver conectado; senao o
 * primeiro conectado (a mensagem nao sai por numero desconectado, e o
 * dialogo de teste das Automacoes faz igual); sem nenhum conectado, o
 * principal, para a tela dizer que ele esta desconectado. Nulo sem numero.
 * A lista vem como fetchNumerosDaClinica devolve: o principal primeiro.
 */
export function numeroPadraoParaIniciar<N extends NumeroParaIniciar>(
  numeros: readonly N[],
): N | null {
  const principal =
    numeros.find((numero) => numero.principal) ?? numeros[0] ?? null;
  if (principal && numeroConectado(principal)) {
    return principal;
  }
  return numeros.find(numeroConectado) ?? principal;
}

/**
 * Numero escolhido que nao esta conectado: com varios, diz qual e oferece
 * outro; com um so, fala do WhatsApp da clinica.
 */
export function mensagemDeNumeroDesconectado(
  numero: { nome: string },
  varios: boolean,
): string {
  return varios
    ? `O número "${numero.nome}" não está conectado. Reconecte em Configurações ou escolha outro número.`
    : "O WhatsApp da clínica não está conectado. Reconecte em Configurações para iniciar a conversa.";
}
