import type {
  EtiquetaDeConversa,
  TomDeEtiqueta,
} from "@/lib/domain/etiquetas-de-conversa";

// Etiquetas do LEAD (contact.tags): texto livre, gravado pelo "Etiquetar
// lead" da lista de Leads (RPC etiquetar_contatos). Nao sao as etiquetas de
// CONVERSA (conversation_tag_def, cadastradas em Configuracoes), mas a tela
// junta as duas (relato do dono em 20/10/2026: "nao aparecem as que ja
// existem"):
//
// - o "Etiquetar lead" oferece as cadastradas, pelo NOME e com o tom delas,
//   e as que ja estao em uso nos leads carregados;
// - a MESMA etiqueta, ignorando maiuscula, acento e espaco sobrando, conta
//   uma vez: a cadastrada vence e fica com a grafia dela; entre as que so
//   estao em uso, fica a grafia mais usada;
// - o chip do lead (lista, cartao do quadro e gaveta) pega o tom da
//   cadastrada com o mesmo nome; sem ela, neutro. O texto e o do lead.
//
// Logica pura: roda no servidor e no cliente, e e o que os testes cobrem.

/** Leitura das etiquetas cadastradas da clinica, para a tela dizer o estado. */
export type LeituraDasEtiquetas = "pronto" | "carregando" | "erro";

/** O que o etiquetar em massa aceita por etiqueta (etiquetaSchema). */
const MAXIMO_DA_ETIQUETA = 40;
/** Quantas etiquetas um pedido remove de uma vez (etiquetarSchema). */
const MAXIMO_POR_PEDIDO = 20;

/**
 * Chave de comparacao: sem acento, minuscula e com um espaco so entre as
 * palavras. "Avaliação", "avaliacao" e " AVALIAÇÃO " sao a mesma etiqueta.
 */
export function chaveDaEtiqueta(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

function porNome(a: { nome: string }, b: { nome: string }): number {
  return a.nome.localeCompare(b.nome, "pt-BR");
}

/** O tom de cada etiqueta cadastrada, pela chave de comparacao do nome. */
export type TonsDasEtiquetas = ReadonlyMap<string, TomDeEtiqueta>;

/** Sem catalogo (carregando ou erro): todo chip sai neutro. */
export const SEM_TONS: TonsDasEtiquetas = new Map();

export function tonsDasEtiquetas(
  catalogo: readonly Pick<EtiquetaDeConversa, "nome" | "tom">[],
): TonsDasEtiquetas {
  const tons = new Map<string, TomDeEtiqueta>();
  for (const etiqueta of catalogo) {
    const chave = chaveDaEtiqueta(etiqueta.nome);
    if (chave && !tons.has(chave)) {
      tons.set(chave, etiqueta.tom);
    }
  }
  return tons;
}

/** Um chip de etiqueta do lead: o texto gravado e o tom resolvido. */
export type EtiquetaDoLead = { nome: string; tom: TomDeEtiqueta };

/**
 * As etiquetas de um lead para desenhar, em ordem de nome: o tom da
 * cadastrada com o mesmo nome (ignorando maiuscula e acento); sem ela,
 * neutro. A grafia e a que esta no lead.
 */
export function etiquetasDoLead(
  tags: readonly string[],
  tons: TonsDasEtiquetas,
): EtiquetaDoLead[] {
  return tags
    .map((nome) => ({
      nome,
      tom: tons.get(chaveDaEtiqueta(nome)) ?? ("neutral" as const),
    }))
    .sort(porNome);
}

/** Uma etiqueta que o "Etiquetar lead" oferece para adicionar. */
export type OpcaoDeEtiqueta = EtiquetaDoLead & {
  /** Cadastrada em Configuracoes; as outras so estao em uso nos leads. */
  cadastrada: boolean;
};

/**
 * As etiquetas da clinica para o "Etiquetar lead": as cadastradas e as que
 * ja estao em uso nos leads carregados, sem repetir, em ordem de nome.
 */
export function opcoesDeEtiqueta(
  catalogo: readonly Pick<EtiquetaDeConversa, "nome" | "tom">[],
  leads: readonly { tags: readonly string[] }[],
): OpcaoDeEtiqueta[] {
  const opcoes = new Map<string, OpcaoDeEtiqueta>();
  for (const etiqueta of catalogo) {
    const nome = etiqueta.nome.trim();
    const chave = chaveDaEtiqueta(nome);
    if (chave && !opcoes.has(chave)) {
      opcoes.set(chave, { nome, tom: etiqueta.tom, cadastrada: true });
    }
  }

  // So em uso: quantos leads usam cada grafia, para ficar com a mais usada
  // (empate: a primeira em ordem de nome, para a tela nao piscar).
  const grafias = new Map<string, Map<string, number>>();
  for (const lead of leads) {
    for (const tag of lead.tags) {
      const nome = tag.trim();
      const chave = chaveDaEtiqueta(nome);
      if (!chave || opcoes.has(chave)) {
        continue;
      }
      const contagem = grafias.get(chave) ?? new Map<string, number>();
      contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
      grafias.set(chave, contagem);
    }
  }
  for (const [chave, contagem] of grafias) {
    let escolhida: { nome: string; usos: number } | null = null;
    for (const [nome, usos] of contagem) {
      if (
        escolhida === null ||
        usos > escolhida.usos ||
        (usos === escolhida.usos && porNome({ nome }, escolhida) < 0)
      ) {
        escolhida = { nome, usos };
      }
    }
    if (escolhida !== null) {
      opcoes.set(chave, {
        nome: escolhida.nome,
        tom: "neutral",
        cadastrada: false,
      });
    }
  }

  return [...opcoes.values()].sort(porNome);
}

/**
 * A grafia com que a etiqueta digitada entra: se a clinica ja tem a mesma
 * etiqueta com outra grafia, a dela ("lead" entra como "LEAD"); se e nova,
 * o texto aparado, com um espaco so entre as palavras.
 */
export function grafiaDaEtiqueta(
  digitada: string,
  opcoes: readonly Pick<OpcaoDeEtiqueta, "nome">[],
): string {
  const nome = digitada.replace(/\s+/g, " ").trim();
  const chave = chaveDaEtiqueta(nome);
  if (!chave) {
    return nome;
  }
  return (
    opcoes.find((opcao) => chaveDaEtiqueta(opcao.nome) === chave)?.nome ?? nome
  );
}

/**
 * Outras grafias da mesma etiqueta nos leads selecionados ("lead" quando
 * entra "LEAD"). Saem no mesmo pedido em que a grafia certa entra, para o
 * lead nao ficar com as duas. So as que o etiquetar em massa aceita remover.
 */
export function outrasGrafias(
  nome: string,
  selecionados: readonly { tags: readonly string[] }[],
): string[] {
  const chave = chaveDaEtiqueta(nome);
  if (!chave) {
    return [];
  }
  const outras = new Set<string>();
  for (const lead of selecionados) {
    for (const tag of lead.tags) {
      if (
        tag !== nome &&
        tag === tag.trim() &&
        tag.length <= MAXIMO_DA_ETIQUETA &&
        chaveDaEtiqueta(tag) === chave
      ) {
        outras.add(tag);
      }
    }
  }
  return [...outras]
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .slice(0, MAXIMO_POR_PEDIDO);
}
