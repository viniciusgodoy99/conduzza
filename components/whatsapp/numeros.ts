import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

import type { ConnectState } from "@/lib/actions/whatsapp-connect";
import { formatarTelefone } from "@/lib/domain/telefone";

// Regras da tela de numeros de WhatsApp (Configuracoes > WhatsApp; docs/07,
// Telas). Modulo puro, sem "use client": o cartao, os dialogos e os testes
// usam as mesmas regras, e o que a tela desabilita e o mesmo que a acao
// recusa no servidor (lib/actions/whatsapp-connect.ts).

export type SituacaoDaConexao = ConnectState["status"];

/** Um numero ATIVO da clinica, como a tela o mostra. */
export type NumeroDoWhatsapp = {
  /** whatsapp_account.id */
  id: string;
  /** nome livre dado pela equipe ("Recepção", "Unidade Centro") */
  nome: string;
  principal: boolean;
  unitId: string | null;
  /** o telefone pareado, quando ja conectou alguma vez */
  displayPhone: string | null;
  status: SituacaoDaConexao;
  /** ultima vez que conectou; nulo = nunca foi pareado */
  connectedAt: string | null;
  /** provedor da conta ('fake', 'uazapi'...) */
  provider: string | null;
  /**
   * Por que o numero caiu, quando a trava recusou o celular dele (o mesmo
   * texto do dialogo de conexao). So vem para administrador e gestor, e so
   * enquanto a recusa ainda explica a desconexao (motivoDaRecusaVigente).
   */
  motivoDaDesconexao?: string | null;
};

/**
 * O motivo que o cartao mostra: so com o numero desconectado. A situacao e o
 * motivo vem de leituras separadas, e a recusa nunca aparece ao lado de
 * outra situacao (conectado, aguardando o QR).
 */
export function motivoParaMostrar(
  numero: Pick<NumeroDoWhatsapp, "status" | "motivoDaDesconexao">,
): string | null {
  return numero.status === "desconectado"
    ? (numero.motivoDaDesconexao ?? null)
    : null;
}

export type UnidadeDaClinica = { id: string; nome: string; ativa: boolean };

const SITUACOES: readonly SituacaoDaConexao[] = [
  "desconectado",
  "aguardando_qr",
  "conectando",
  "conectado",
];

/** Valor do banco (texto livre) na situacao da tela; o desconhecido e desconectado. */
export function situacaoDaConexao(
  valor: string | null | undefined,
): SituacaoDaConexao {
  return SITUACOES.find((situacao) => situacao === valor) ?? "desconectado";
}

/**
 * Telefone para exibir, como a recepcao discaria. O provedor guarda so
 * digitos ("5584..."). Nulo quando o texto nao e telefone: uma conta antiga
 * chegou a guardar o nome do perfil no lugar do numero, e ele nao pode
 * aparecer como se fosse o telefone.
 */
export function telefoneFormatado(bruto: string | null): string | null {
  if (!bruto) {
    return null;
  }
  const digitos = bruto.replace(/\D/g, "");
  if (/^[+\d\s().-]+$/.test(bruto) && digitos.length >= 10) {
    return formatarTelefone(`+${digitos}`);
  }
  return null;
}

/** Data da conexao no fuso da clinica (CLAUDE.md 3.6), nunca no do navegador. */
export function dataNoFusoDaClinica(
  instante: string,
  timezone: string,
): string | null {
  const ms = Date.parse(instante);
  if (Number.isNaN(ms)) {
    return null;
  }
  return format(new TZDate(ms, timezone), "dd/MM/yyyy");
}

/** O botao de conexao do cartao, pela situacao do numero. */
export type AcaoDeConexao =
  "conectar" | "reconectar" | "continuar" | "desconectar";

export function acaoDeConexao(
  numero: Pick<NumeroDoWhatsapp, "status" | "connectedAt">,
): AcaoDeConexao {
  switch (numero.status) {
    case "conectado":
      return "desconectar";
    // Pareamento em andamento: o dialogo retoma a consulta e mostra o QR,
    // sem pedir outro (pedir de novo recusa com "fluxo em andamento").
    case "aguardando_qr":
    case "conectando":
      return "continuar";
    default:
      return numero.connectedAt ? "reconectar" : "conectar";
  }
}

export const ROTULO_DA_ACAO: Record<AcaoDeConexao, string> = {
  conectar: "Conectar",
  reconectar: "Reconectar",
  continuar: "Continuar conexão",
  desconectar: "Desconectar",
};

// D8 do docs/07: remover e so do administrador. Os dois outros textos sao os
// mesmos que removerNumeroAction devolve quando recusa.
export const DICA_SO_ADMIN =
  "Somente administradores removem um número de WhatsApp.";
export const DICA_PRINCIPAL_COM_OUTROS =
  "Escolha outro número como principal antes de remover este.";
export const DICA_NUMERO_DAS_AUTOMATICAS =
  "As mensagens automáticas saem sempre por este número. Em Automações, escolha outro número antes de remover este.";
export const DICA_JA_E_PRINCIPAL = "Este já é o número principal.";
export const DICA_SEM_UNIDADES =
  "Esta clínica ainda não tem unidades. Cadastre em Cadastros, na aba Unidades.";
export const DICA_UNIDADES_NAO_CARREGADAS =
  "Não foi possível carregar as unidades. Recarregue a página.";

/**
 * Por que o numero nao pode ser removido agora (nulo: pode). A tela deixa o
 * item visivel e desabilitado com este texto; a acao confere de novo no
 * servidor, porque outra aba pode ter mudado o principal ou a politica.
 */
export function motivoParaNaoRemover(
  numero: Pick<NumeroDoWhatsapp, "id" | "principal">,
  contexto: {
    ehAdmin: boolean;
    /** numeros ativos da clinica, este incluido */
    totalAtivos: number;
    /** o numero fixo das mensagens automaticas (modo fixo), se houver */
    contaFixaId: string | null;
  },
): string | null {
  if (!contexto.ehAdmin) {
    return DICA_SO_ADMIN;
  }
  if (numero.principal && contexto.totalAtivos > 1) {
    return DICA_PRINCIPAL_COM_OUTROS;
  }
  if (contexto.contaFixaId === numero.id) {
    return DICA_NUMERO_DAS_AUTOMATICAS;
  }
  return null;
}

/** Com limite do plano preenchido, a clinica chegou nele. Nulo = sem limite. */
export function limiteAtingido(total: number, limite: number | null): boolean {
  return limite !== null && total >= limite;
}

function numerosPorExtenso(quantidade: number): string {
  return quantidade === 1 ? "número" : "números";
}

/** "2 de 3 números do plano" (a tela poe os numeros em cz-num). */
export function textoDoLimite(total: number, limite: number): string {
  return `${total} de ${limite} ${numerosPorExtenso(limite)} do plano`;
}

export function dicaDoLimite(limite: number): string {
  return `O plano desta clínica permite até ${limite} ${numerosPorExtenso(limite)}. Fale com o suporte para ampliar.`;
}

/** Corpo do dialogo de remover (D3: as conversas abertas sao encerradas). */
export function textoDaRemocao(
  numero: Pick<NumeroDoWhatsapp, "displayPhone">,
): string {
  const telefone = telefoneFormatado(numero.displayPhone);
  const quem = telefone ? `O WhatsApp ${telefone}` : "Este número";
  return `${quem} deixa de receber e enviar mensagens pelo Conduzza. As conversas abertas dele são encerradas e o histórico continua.`;
}

/** Nome da unidade do numero, quando ele tem uma e ela esta na lista. */
export function nomeDaUnidade(
  unitId: string | null,
  unidades: UnidadeDaClinica[] | null,
): string | null {
  if (!unitId || !unidades) {
    return null;
  }
  return unidades.find((unidade) => unidade.id === unitId)?.nome ?? null;
}

/**
 * Unidades que o seletor oferece: as ativas, mais a atual do numero mesmo
 * que desativada (para ela nao sumir do campo sem ninguem mexer).
 */
export function unidadesParaEscolher(
  unidades: UnidadeDaClinica[],
  atual: string | null,
): UnidadeDaClinica[] {
  return unidades.filter((unidade) => unidade.ativa || unidade.id === atual);
}
