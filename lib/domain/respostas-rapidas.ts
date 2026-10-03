import { z } from "zod";

import { normalizarTexto } from "@/lib/domain/attribution";
import { renderizarModelo } from "@/lib/domain/modelo-mensagem";

// Mensagens padrao ("/" no compositor do Atendimento, spec 1.11; na tela o
// nome e "Mensagens padrao", palavras do dono em 02/10/2026). Logica PURA:
// roda no navegador e no servidor, sem I/O, e e o que os testes de unidade
// cobrem. A tabela e resposta_rapida (migration 20261002120000_crm_leva_a).
//
// O texto cadastrado e da clinica. O nome do paciente so entra na
// renderizacao, no navegador de quem usa, e o resultado NUNCA vai para log.

/** Os unicos campos que a mensagem padrao sabe preencher no compositor. */
export const PLACEHOLDERS_DA_RESPOSTA = ["nome", "clinica"] as const;

/** Mesmo teto do envio (bodySchema das actions do Atendimento) e do banco. */
export const LIMITE_DO_TEXTO = 4096;

/** A lista do "/" mostra no maximo isto: mais que isso nao se escolhe no olho. */
export const MAXIMO_NA_LISTA = 8;

/** Termo maior que o maior titulo nao casa nada: a lista fecha. */
const MAIOR_TERMO = 60;

/** O alfabeto do atalho, igual ao check atalho_de_resposta_valido. */
export const ATALHO_VALIDO = /^[a-z0-9_]{1,30}$/;

export type RespostaRapida = {
  id: string;
  atalho: string;
  titulo: string;
  corpo: string;
  ativo: boolean;
  posicao: number;
};

/** As colunas que a tela le (o resto e trilha do banco). */
export const RESPOSTA_RAPIDA_SELECT =
  "id, atalho, titulo, corpo, ativo, posicao";

// ---------------------------------------------------------------------------
// Cadastro (Configuracoes, aba Mensagens padrao)

/**
 * O que a aba manda para a Server Action. A action valida de novo com este
 * mesmo schema (o cliente nunca e confiavel); a tela usa para travar o
 * Salvar antes de ir ao servidor.
 */
export const mensagemPadraoSchema = z.object({
  /** nulo = criar; presente = editar a existente */
  id: z.uuid().nullable(),
  atalho: z.string().trim().regex(ATALHO_VALIDO, {
    error:
      "O atalho usa de 1 a 30 letras minúsculas, números ou _ (sem espaço e sem acento).",
  }),
  titulo: z
    .string()
    .trim()
    .min(2, { error: "O título precisa de pelo menos 2 caracteres." })
    .max(60, { error: "O título vai até 60 caracteres." }),
  corpo: z
    .string()
    .trim()
    .min(1, { error: "Escreva o texto da mensagem." })
    .max(LIMITE_DO_TEXTO, {
      error: `O texto vai até ${LIMITE_DO_TEXTO} caracteres.`,
    }),
  ativo: z.boolean(),
});

export type MensagemPadraoEntrada = z.infer<typeof mensagemPadraoSchema>;

/**
 * Atalho sugerido a partir do titulo: sem acento, minusculo, _ no lugar do
 * resto. "Confirmação de horário" vira "confirmacao_de_horario".
 */
export function atalhoDoTitulo(titulo: string): string {
  return titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30)
    .replace(/_+$/g, "");
}

/**
 * Limpa o que se digita no campo do atalho, sem tirar o _ do fim (a pessoa
 * pode estar no meio de "boas_"): minusculo, sem acento, espaco e hifen
 * viram _, o resto sai.
 */
export function limparAtalho(digitado: string): string {
  return digitado
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 30);
}

/**
 * Campos {{...}} do texto que a mensagem padrao NAO preenche. Eles nao
 * explodem (renderizarModelo limpa), mas sumir em silencio e pior: a aba
 * avisa enquanto a pessoa escreve.
 */
export function camposDesconhecidos(corpo: string): string[] {
  const usados = [...corpo.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map(
    (casamento) => casamento[1] ?? "",
  );
  const conhecidos: readonly string[] = PLACEHOLDERS_DA_RESPOSTA;
  return [...new Set(usados)].filter((campo) => !conhecidos.includes(campo));
}

/** O texto usa o nome do contato (para a dica de contato sem nome). */
export function usaNome(corpo: string): boolean {
  return /\{\{\s*nome\s*\}\}/.test(corpo);
}

/**
 * Nova ordem depois de subir ou descer uma mensagem, ja renumerada de 10 em
 * 10. Devolve SO as linhas cuja posicao muda (menos escrita), ou null quando
 * a mensagem ja esta na ponta ou nao existe. A renumeracao completa desfaz
 * empate antigo de posicao, que deixaria o subir e o descer sem efeito.
 */
export function novaOrdem(
  lista: readonly Pick<RespostaRapida, "id" | "posicao" | "titulo">[],
  id: string,
  direcao: "subir" | "descer",
): { id: string; posicao: number }[] | null {
  const ordenada = ordenarRespostas(lista);
  const indice = ordenada.findIndex((item) => item.id === id);
  if (indice < 0) {
    return null;
  }
  const alvo = direcao === "subir" ? indice - 1 : indice + 1;
  if (alvo < 0 || alvo >= ordenada.length) {
    return null;
  }
  const trocada = [...ordenada];
  [trocada[indice], trocada[alvo]] = [trocada[alvo]!, trocada[indice]!];
  return trocada
    .map((item, posicao) => ({ id: item.id, posicao: (posicao + 1) * 10 }))
    .filter(
      (novo) =>
        ordenada.find((antigo) => antigo.id === novo.id)?.posicao !==
        novo.posicao,
    );
}

/** A ordem da lista: posicao, depois titulo (a mesma da consulta). */
export function ordenarRespostas<
  T extends Pick<RespostaRapida, "posicao" | "titulo">,
>(lista: readonly T[]): T[] {
  return [...lista].sort(
    (a, b) =>
      a.posicao - b.posicao || a.titulo.localeCompare(b.titulo, "pt-BR"),
  );
}

// ---------------------------------------------------------------------------
// Compositor ("/" na resposta ao paciente)

/** Trecho do campo que a mensagem escolhida substitui. */
export type AlvoDaResposta = {
  /** onde comeca o trecho (a "/" ou o cursor) */
  inicio: number;
  /** onde termina (o cursor ou o fim da selecao) */
  fim: number;
  /** o que vem depois da "/" ate o cursor; vazio no botao */
  termo: string;
  /** espaco posto antes da mensagem quando ela cairia colada numa palavra */
  separador: string;
};

const ESPACO = /\s/;

/**
 * A "/" que abre a lista, lida pelo VALOR do campo e pela posicao do cursor
 * (nunca pela tecla: no teclado virtual do Android a tecla chega como 229).
 *
 * Abre quando:
 * - a "/" esta no inicio do texto ou logo depois de espaco ou quebra de
 *   linha;
 * - entre a "/" e o cursor nao ha espaco nem outra "/";
 * - o cursor esta no FIM do trecho (logo depois vem espaco, quebra ou o fim
 *   do texto). Cursor no meio de uma palavra nao abre: escolher ali comeria
 *   o resto da palavra ou deixaria a mensagem colada nela.
 *
 * Por isso nao abre em "https://x.com/a", "12/10", "e/ou" nem "//", e fecha
 * ao digitar espaco.
 */
export function gatilhoDaBarra(
  texto: string,
  cursor: number,
): AlvoDaResposta | null {
  if (cursor < 1 || cursor > texto.length) {
    return null;
  }
  const depois = texto.charAt(cursor);
  if (depois !== "" && !ESPACO.test(depois)) {
    return null;
  }
  let barra = cursor - 1;
  while (barra >= 0) {
    const caractere = texto.charAt(barra);
    if (caractere === "/") {
      break;
    }
    if (ESPACO.test(caractere)) {
      return null;
    }
    barra -= 1;
  }
  if (barra < 0) {
    return null;
  }
  const antes = barra === 0 ? "" : texto.charAt(barra - 1);
  if (antes !== "" && !ESPACO.test(antes)) {
    return null;
  }
  const termo = texto.slice(barra + 1, cursor);
  if (termo.length > MAIOR_TERMO) {
    return null;
  }
  return { inicio: barra, fim: cursor, termo, separador: "" };
}

/**
 * O trecho que o BOTAO da barra substitui: a selecao (ou o cursor; sem
 * cursor conhecido, o fim do texto). Se a mensagem cairia colada numa
 * palavra ("Olá" + "Confirmo..."), entra um espaco antes.
 */
export function alvoDoBotao(
  texto: string,
  inicioDaSelecao: number | null,
  fimDaSelecao: number | null,
): AlvoDaResposta {
  const limitar = (valor: number | null) =>
    valor === null ? texto.length : Math.min(Math.max(valor, 0), texto.length);
  const inicio = limitar(inicioDaSelecao);
  const fim = Math.max(inicio, limitar(fimDaSelecao ?? inicioDaSelecao));
  const antes = inicio === 0 ? "" : texto.charAt(inicio - 1);
  return {
    inicio,
    fim,
    termo: "",
    separador: antes !== "" && !ESPACO.test(antes) ? " " : "",
  };
}

/**
 * Filtra as mensagens pelo termo, sem diferenciar acento nem caixa. Ordem:
 * atalho que comeca com o termo, depois titulo que comeca, depois titulo que
 * contem; dentro de cada grupo, a ordem da clinica. So as ativas, e no
 * maximo `limite` (8 no "/"; o botao passa Infinity, porque ali nao ha termo
 * para estreitar a lista).
 */
export function filtrarRespostas<T extends RespostaRapida>(
  lista: readonly T[],
  termo: string,
  limite: number = MAXIMO_NA_LISTA,
): T[] {
  const ativas = ordenarRespostas(lista.filter((item) => item.ativo));
  const busca = normalizarTexto(termo);
  if (busca === "") {
    return ativas.slice(0, limite);
  }
  const atalhoComeca: T[] = [];
  const tituloComeca: T[] = [];
  const tituloContem: T[] = [];
  for (const item of ativas) {
    const titulo = normalizarTexto(item.titulo);
    if (normalizarTexto(item.atalho).startsWith(busca)) {
      atalhoComeca.push(item);
    } else if (titulo.startsWith(busca)) {
      tituloComeca.push(item);
    } else if (titulo.includes(busca)) {
      tituloContem.push(item);
    }
  }
  return [...atalhoComeca, ...tituloComeca, ...tituloContem].slice(0, limite);
}

/**
 * O texto que entra no campo: {{nome}} vira o nome do contato da conversa e
 * {{clinica}} o nome da clinica, pelo MESMO renderizador da regua (contato
 * sem nome leva junto o vocativo: "Olá, {{nome}}!" vira "Olá!"). Qualquer
 * outro campo sai em branco.
 */
export function renderizarResposta(
  corpo: string,
  valores: { nome: string | null | undefined; clinica: string },
): string {
  return renderizarModelo(corpo, {
    nome: valores.nome,
    clinica: valores.clinica,
  }).trim();
}

/**
 * Troca o trecho do alvo pela mensagem ja renderizada e devolve o texto novo
 * com o cursor no fim da mensagem. Null quando o resultado passaria do teto
 * de 4096 (a mensagem nao entra cortada: a pessoa encurta antes).
 */
export function aplicarResposta(
  texto: string,
  alvo: AlvoDaResposta,
  corpoRenderizado: string,
  limite: number = LIMITE_DO_TEXTO,
): { texto: string; cursor: number } | null {
  const inserido = alvo.separador + corpoRenderizado;
  const novo = texto.slice(0, alvo.inicio) + inserido + texto.slice(alvo.fim);
  if (novo.length > limite) {
    return null;
  }
  return { texto: novo, cursor: alvo.inicio + inserido.length };
}

/** Identidade estavel do gatilho: o Esc fecha a lista ate o termo mudar. */
export function chaveDoGatilho(alvo: AlvoDaResposta): string {
  return `${alvo.inicio}:${alvo.termo}`;
}

/** Frase da regiao de status que acompanha a lista aberta. */
export function anuncioDaLista(
  estado: "carregando" | "erro" | "pronto",
  quantas: number,
  cadastradas: number,
): string {
  if (estado === "carregando") {
    return "Carregando as mensagens padrão.";
  }
  if (estado === "erro") {
    return "Não foi possível carregar as mensagens padrão.";
  }
  if (cadastradas === 0) {
    return "Nenhuma mensagem padrão cadastrada.";
  }
  if (quantas === 0) {
    return "Nenhuma mensagem com esse atalho.";
  }
  return quantas === 1
    ? "1 mensagem. Use as setas e Enter."
    : `${quantas} mensagens. Use as setas e Enter.`;
}
