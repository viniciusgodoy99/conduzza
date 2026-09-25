// Conexao dos numeros de WhatsApp da clinica, vista pelo shell: a faixa de
// desconectado (components/shell/whatsapp-status.tsx). O Inbox aplica os
// eventos na propria copia dos numeros (lib/domain/numeros-do-inbox.ts) e
// nao recarrega mais a pagina; assinaturaDaConexao fica para quem precisar
// comparar so o status. Regras puras, testadas em
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

/** Os numeros vigiados que estao fora do ar (a faixa acende por eles). */
function vigiadosDesconectados(
  numeros: readonly NumeroDaFaixa[],
): NumeroDaFaixa[] {
  return numerosVigiados(numeros).filter(
    (numero) => numero.connection_status !== "conectado",
  );
}

/**
 * Os numeros cujas mensagens automaticas esperando a faixa conta: so com mais
 * de um numero ativo (com um so, o texto e o de sempre) e so os vigiados que
 * estao fora do ar. Lista vazia: nada a contar, e ninguem consulta a fila.
 */
export function numerosParaContar(numeros: readonly NumeroDaFaixa[]): string[] {
  if (numeros.length <= 1) {
    return [];
  }
  return vigiadosDesconectados(numeros).map((numero) => numero.id);
}

/**
 * Quantas mensagens automaticas esperam por cada numero, pelo id
 * (contarMensagensEsperando, em lib/queries/mensagens-esperando.ts). Numero
 * ausente: nao contado.
 */
export type EsperandoPorNumero = Readonly<Record<string, number>>;

/** Junta os nomes na forma falada: "A", "A e B", "A, B e C". */
function listaDeNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) {
    return nomes[0] ?? "";
  }
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Teto de nomes no titulo; acima dele, a faixa conta os numeros. */
const NOMES_NO_TITULO = 3;

/**
 * O texto da faixa, ou null quando ela nao aparece.
 *
 * Com um numero ativo, o texto e o de sempre ("WhatsApp desconectado"). Com
 * mais de um, a faixa NOMEIA quem caiu ("WhatsApp Recepcao desconectado",
 * "WhatsApp Recepcao e Centro desconectados"; acima de 3, "4 numeros
 * desconectados") e, com a contagem da fila, diz quantas mensagens
 * automaticas esperam a reconexao. Sem contagem (ainda nao chegou, ou a
 * consulta falhou) ou com zero, a frase da fila nao aparece: a faixa nunca
 * afirma um numero que nao conferiu.
 */
export function textoDaFaixa(
  numeros: readonly NumeroDaFaixa[],
  esperando?: EsperandoPorNumero,
): TextoDaFaixa | null {
  const desconectados = vigiadosDesconectados(numeros);
  if (desconectados.length === 0) {
    return null;
  }
  if (numeros.length <= 1) {
    return {
      titulo: "WhatsApp desconectado",
      detalhe: "os pacientes não estão sendo atendidos",
    };
  }
  // So com a contagem de TODOS os que cairam: somar uma parte seria afirmar
  // um total menor do que o da fila (o numero que acabou de cair ainda nao
  // foi contado).
  const contados = desconectados.every(
    (numero) => esperando?.[numero.id] !== undefined,
  );
  const naFila = contados
    ? desconectados.reduce(
        (soma, numero) => soma + (esperando?.[numero.id] ?? 0),
        0,
      )
    : 0;
  const fila =
    naFila === 0
      ? ""
      : naFila === 1
        ? " e 1 mensagem automática espera a reconexão"
        : ` e ${naFila} mensagens automáticas esperam a reconexão`;
  if (desconectados.length === 1) {
    return {
      titulo: `WhatsApp ${desconectados[0]!.nome} desconectado`,
      detalhe: `os pacientes deste número não estão sendo atendidos${fila}`,
    };
  }
  return {
    titulo:
      desconectados.length <= NOMES_NO_TITULO
        ? `WhatsApp ${listaDeNomes(desconectados.map((numero) => numero.nome))} desconectados`
        : `${desconectados.length} números desconectados`,
    detalhe: `os pacientes destes números não estão sendo atendidos${fila}`,
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
    /**
     * por que o numero caiu, quando a trava recusou o celular (so vem para
     * administrador e gestor)
     */
    motivo?: string;
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
        motivo:
          typeof numero.motivo === "string" && numero.motivo.length > 0
            ? numero.motivo
            : undefined,
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

/** O aviso que o "Verificar conexao" mostra quando a faixa continua acesa. */
export type AvisoDaVerificacao = {
  mensagem: string;
  /**
   * Por que caiu, quando a trava recusou o celular de um numero que a faixa
   * nomeia. Vai no complemento do aviso, e nao no texto da faixa, que
   * continua curto.
   */
  motivo: string | null;
};

/**
 * O aviso depois do "Verificar conexao", ou null quando a verificacao apagou
 * a faixa.
 *
 * Com um numero so, o motivo vai como veio ("Este número já está conectado
 * em outra conta do Conduzza..."). Com mais de um, cada motivo leva o nome
 * do numero na frente, porque "este número" sozinho nao diz qual. So entram
 * os numeros que a faixa nomeia (os vigiados fora do ar, D6).
 */
export function avisoDaVerificacao(
  numeros: readonly NumeroDaFaixa[],
  verificacao: VerificacaoLida,
): AvisoDaVerificacao | null {
  const proximos = aplicarVerificacao(numeros, verificacao);
  const aindaFora = textoDaFaixa(proximos);
  if (!aindaFora) {
    return null;
  }
  const umSo = proximos.length <= 1;
  const motivoPorNumero = new Map(
    verificacao.linhas.flatMap((linha) =>
      linha.motivo ? [[linha.id, linha.motivo] as const] : [],
    ),
  );
  const motivos = vigiadosDesconectados(proximos).flatMap((numero) => {
    const motivo = motivoPorNumero.get(numero.id);
    if (!motivo) {
      return [];
    }
    return [umSo ? motivo : `${numero.nome}: ${motivo}`];
  });
  return {
    mensagem: umSo
      ? "Ainda desconectado. Abra Configurações para reconectar."
      : `${aindaFora.titulo}. Abra Configurações para reconectar.`,
    motivo: motivos.length > 0 ? motivos.join(" ") : null,
  };
}
