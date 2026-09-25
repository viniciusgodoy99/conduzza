// Conexao dos numeros de WhatsApp da clinica, vista pelo shell: a faixa de
// desconectado (components/shell/whatsapp-status.tsx) e o recarregar do
// Inbox (lib/realtime/use-inbox-channel.ts). Regras puras, testadas em
// tests/unit/domain/conexao-dos-numeros.test.ts.
//
// Desenho: docs/07_multiplos_numeros_whatsapp.md (decisao D6).

/** O que a faixa precisa de cada numero ATIVO (removido_em nulo). */
export type NumeroDaFaixa = {
  id: string;
  nome: string;
  connection_status: string;
  principal: boolean;
  connected_at: string | null;
};

/** As colunas de NumeroDaFaixa, para o layout (servidor) e o vigia (browser). */
export const COLUNAS_DA_FAIXA =
  "id, nome, connection_status, principal, connected_at";

/**
 * A linha de whatsapp_account como chega no evento de Realtime ou na resposta
 * de "Verificar conexao". Tudo opcional: o evento traz a linha nova inteira,
 * mas a verificacao traz so id e status.
 */
export type LinhaDoNumero = {
  id?: string;
  nome?: string;
  connection_status?: string | null;
  principal?: boolean;
  connected_at?: string | null;
  removido_em?: string | null;
};

/**
 * D6: a faixa considera o principal e os numeros que ja conectaram alguma vez.
 * Um numero recem cadastrado que nunca foi pareado nao acende a faixa: ele
 * nunca atendeu ninguem, entao nenhum paciente esta sem resposta por causa
 * dele. O principal entra sempre, conectado ou nao, porque e por ele que a
 * clinica recebe quando so tem um numero (o comportamento de antes).
 */
export function numerosVigiados(
  numeros: readonly NumeroDaFaixa[],
): NumeroDaFaixa[] {
  return numeros.filter(
    (numero) => numero.principal || numero.connected_at !== null,
  );
}

export type TextoDaFaixa = {
  /** a parte em negrito */
  titulo: string;
  /** o complemento, depois dos dois pontos */
  detalhe: string;
};

/**
 * O texto da faixa, ou null quando ela nao aparece.
 *
 * Com um numero ativo, o texto e o de sempre ("WhatsApp desconectado"). Com
 * mais de um, a faixa diz QUAL caiu: "WhatsApp Recepcao desconectado", ou
 * "2 numeros desconectados" quando cai mais de um.
 */
export function textoDaFaixa(
  numeros: readonly NumeroDaFaixa[],
): TextoDaFaixa | null {
  const desconectados = numerosVigiados(numeros).filter(
    (numero) => numero.connection_status !== "conectado",
  );
  if (desconectados.length === 0) {
    return null;
  }
  if (numeros.length <= 1) {
    return {
      titulo: "WhatsApp desconectado",
      detalhe: "os pacientes não estão sendo atendidos",
    };
  }
  if (desconectados.length === 1) {
    return {
      titulo: `WhatsApp ${desconectados[0]!.nome} desconectado`,
      detalhe: "os pacientes deste número não estão sendo atendidos",
    };
  }
  return {
    titulo: `${desconectados.length} números desconectados`,
    detalhe: "os pacientes destes números não estão sendo atendidos",
  };
}

function mesmoNumero(a: NumeroDaFaixa, b: NumeroDaFaixa): boolean {
  return (
    a.nome === b.nome &&
    a.connection_status === b.connection_status &&
    a.principal === b.principal &&
    a.connected_at === b.connected_at
  );
}

/**
 * Aplica UMA linha (evento de Realtime ou verificacao) a lista, pelo id.
 *
 * Devolve a MESMA lista quando nada do que a faixa usa mudou. Isso importa:
 * toda reserva de slot de envio faz UPDATE em whatsapp_account (achado 6 do
 * docs/07), e devolver uma lista nova a cada mensagem enviada faria a faixa
 * renderizar de novo em todas as abas sem motivo.
 *
 * Numero removido sai da lista. Numero desconhecido so entra se a linha
 * trouxer o minimo para a faixa (id, nome e status), que e o caso do evento
 * de Realtime e nao o da verificacao.
 */
export function aplicarLinhaDoNumero(
  numeros: readonly NumeroDaFaixa[],
  linha: LinhaDoNumero,
): readonly NumeroDaFaixa[] {
  const id = linha.id;
  if (!id) {
    return numeros;
  }
  const indice = numeros.findIndex((numero) => numero.id === id);
  if (linha.removido_em) {
    return indice === -1
      ? numeros
      : numeros.filter((numero) => numero.id !== id);
  }
  if (indice === -1) {
    if (
      typeof linha.nome !== "string" ||
      typeof linha.connection_status !== "string"
    ) {
      return numeros;
    }
    return [
      ...numeros,
      {
        id,
        nome: linha.nome,
        connection_status: linha.connection_status,
        principal: linha.principal === true,
        connected_at: linha.connected_at ?? null,
      },
    ];
  }
  const atual = numeros[indice]!;
  const proximo: NumeroDaFaixa = {
    id,
    nome: typeof linha.nome === "string" ? linha.nome : atual.nome,
    connection_status:
      typeof linha.connection_status === "string"
        ? linha.connection_status
        : atual.connection_status,
    principal:
      typeof linha.principal === "boolean" ? linha.principal : atual.principal,
    connected_at:
      linha.connected_at !== undefined
        ? linha.connected_at
        : atual.connected_at,
  };
  if (mesmoNumero(atual, proximo)) {
    return numeros;
  }
  return numeros.map((numero) => (numero.id === id ? proximo : numero));
}

/**
 * O que o Inbox compara para decidir se recarrega a pagina: o status de
 * conexao e se o numero continua ativo. O resto da linha (principalmente o
 * slot de envio, que muda a cada mensagem) nao conta.
 */
export function assinaturaDaConexao(linha: LinhaDoNumero): string | null {
  if (typeof linha.connection_status !== "string") {
    return null;
  }
  return `${linha.connection_status}|${linha.removido_em ? "removido" : "ativo"}`;
}

export type VerificacaoLida = {
  erro: string | null;
  /**
   * status por numero, quando a acao devolve a lista (com nome e principal
   * quando vierem: e o que deixa um numero que a faixa ainda nao conhecia
   * entrar na lista)
   */
  linhas: {
    id: string;
    connection_status: string;
    nome?: string;
    principal?: boolean;
  }[];
  /** status unico (forma antiga da acao), quando ela nao devolve a lista */
  statusUnico: string | null | undefined;
};

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null
    ? (valor as Record<string, unknown>)
    : null;
}

/**
 * Le a resposta de checarConexaoAction sem depender da forma exata.
 *
 * A Fase 2 troca o status unico pela lista de numeros verificados
 * (ChecagemDeConexao em lib/actions/whatsapp-connect.ts: `numeros`, cada um
 * com id, nome, principal e connection_status, mais o `status` do principal
 * na forma de antes). A faixa aceita a lista (em "numeros", ou a propria
 * resposta sendo a lista; o status do item em connection_status ou status)
 * e, sem lista, o status unico antigo, que vale para o principal. Qualquer
 * outra coisa vira "nada verificado", nunca excecao.
 */
export function lerVerificacao(resultado: unknown): VerificacaoLida {
  const corpo = objeto(resultado);
  const erro =
    corpo && typeof corpo.error === "string" && corpo.error.length > 0
      ? corpo.error
      : null;
  const lista: unknown[] | null = Array.isArray(resultado)
    ? resultado
    : corpo && Array.isArray(corpo.numeros)
      ? corpo.numeros
      : null;
  const linhas: VerificacaoLida["linhas"] = [];
  for (const item of lista ?? []) {
    const numero = objeto(item);
    const status = numero?.connection_status ?? numero?.status;
    if (numero && typeof numero.id === "string" && typeof status === "string") {
      linhas.push({
        id: numero.id,
        connection_status: status,
        nome: typeof numero.nome === "string" ? numero.nome : undefined,
        principal:
          typeof numero.principal === "boolean" ? numero.principal : undefined,
      });
    }
  }
  const statusUnico =
    lista === null && corpo && "status" in corpo
      ? typeof corpo.status === "string"
        ? corpo.status
        : null
      : undefined;
  return { erro, linhas, statusUnico };
}

/**
 * Junta a verificacao a lista da faixa. O status unico (forma antiga) vale
 * para o principal, que era o unico numero quando a acao devolvia um status
 * so.
 */
export function aplicarVerificacao(
  numeros: readonly NumeroDaFaixa[],
  verificacao: VerificacaoLida,
): readonly NumeroDaFaixa[] {
  let proxima = numeros;
  for (const linha of verificacao.linhas) {
    proxima = aplicarLinhaDoNumero(proxima, linha);
  }
  if (typeof verificacao.statusUnico === "string") {
    const principal =
      proxima.find((numero) => numero.principal) ??
      (proxima.length === 1 ? proxima[0] : undefined);
    if (principal) {
      proxima = aplicarLinhaDoNumero(proxima, {
        id: principal.id,
        connection_status: verificacao.statusUnico,
      });
    }
  }
  return proxima;
}
