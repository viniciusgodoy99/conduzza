import {
  ClipboardList,
  History,
  Tag,
  UserRound,
  type LucideIcon,
} from "lucide-react";

// Reguas vinculadas de confirmacao e de pos-falta (decisao do dono em
// 29/09/2026): cada regua pode ter UM vinculo, medico (professional_id),
// especialidade (specialty) ou procedimento (procedure_id); sem vinculo e a
// geral. A escolha da regua de cada consulta e do banco
// (regua_da_consulta): procedimento 3 > medico 2 > especialidade 1 >
// geral 0, e dentro do nivel a reforcada por historico de falta vence. Aqui
// so o que a TELA precisa decidir, PURO e sem I/O: a chave da especialidade
// (espelho de chave_de_especialidade), a lista de especialidades dos
// profissionais ativos, o rotulo do vinculo e as opcoes ainda livres.

export type KindVinculavel = "confirmacao" | "pos_falta";

export type TipoDeVinculo = "procedimento" | "medico" | "especialidade";

export type VinculoDaRegua =
  | { tipo: "procedimento"; id: string; nome: string }
  | { tipo: "medico"; id: string; nome: string }
  | { tipo: "especialidade"; chave: string; nome: string };

/** O mesmo peso que regua_da_consulta da a cada vinculo (geral e 0). */
export const NIVEL_DO_VINCULO: Record<TipoDeVinculo, number> = {
  procedimento: 3,
  medico: 2,
  especialidade: 1,
};

export const AJUDA_DA_PRECEDENCIA =
  "A régua mais específica vence: procedimento, depois médico, depois especialidade. Sem vínculo, vale a geral.";

const PREFIXO_DO_NOME: Record<KindVinculavel, string> = {
  confirmacao: "Confirmação",
  pos_falta: "Pós-falta",
};

// A MESMA tabela de acentos do translate de public.chave_de_especialidade
// (migration 20260929110000_regua_vinculada.sql), letra por letra: a tela
// deduplica e confere a especialidade com a chave exata que o banco usa para
// casar a consulta e para o indice unico.
const COM_ACENTO = "ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ";
const SEM_ACENTO = "AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy";
const TROCA_DE_ACENTO = new Map(
  [...COM_ACENTO].map((letra, indice) => [letra, SEM_ACENTO[indice]!]),
);

/**
 * Espelho de public.chave_de_especialidade: tira o acento (translate), passa
 * para minusculas, colapsa os espacos do meio e tira os das pontas.
 * "Dermatologia", " dermatologia " e "DERMATOLOGÍA" sao a mesma chave.
 */
export function chaveDeEspecialidade(texto: string): string {
  return [...texto]
    .map((letra) => TROCA_DE_ACENTO.get(letra) ?? letra)
    .join("")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** O rotulo como foi digitado, so sem espaco sobrando. */
export function rotuloDeEspecialidade(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

export type OpcaoDeEspecialidade = { chave: string; rotulo: string };

function comparaRotulo(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
}

/**
 * Entre grafias da MESMA especialidade, a que a clinica mais usa. Empate:
 * a que comeca com maiuscula, depois a que tem acento (a grafia cuidada
 * costuma ser a certa), depois a ordem alfabetica, para nao depender da
 * ordem em que o banco devolveu os profissionais.
 */
function melhorRotulo(contagem: Map<string, number>): string {
  const candidatos = [...contagem.entries()];
  candidatos.sort(([rotuloA, totalA], [rotuloB, totalB]) => {
    if (totalA !== totalB) {
      return totalB - totalA;
    }
    const maiusculaA = /^\p{Lu}/u.test(rotuloA) ? 1 : 0;
    const maiusculaB = /^\p{Lu}/u.test(rotuloB) ? 1 : 0;
    if (maiusculaA !== maiusculaB) {
      return maiusculaB - maiusculaA;
    }
    const acentosA = rotuloA.normalize("NFD").length - rotuloA.length;
    const acentosB = rotuloB.normalize("NFD").length - rotuloB.length;
    if (acentosA !== acentosB) {
      return acentosB - acentosA;
    }
    return rotuloA < rotuloB ? -1 : rotuloA > rotuloB ? 1 : 0;
  });
  return candidatos[0]![0];
}

/**
 * As especialidades que a clinica oferece hoje: a uniao das especialidades
 * dos profissionais ATIVOS (texto livre no cadastro), sem repetir a mesma
 * chave, com o rotulo mais comum. Ordem alfabetica.
 */
export function especialidadesDosProfissionais(
  profissionais: readonly {
    specialties: readonly string[] | null;
    active: boolean;
  }[],
): OpcaoDeEspecialidade[] {
  const porChave = new Map<string, Map<string, number>>();
  for (const profissional of profissionais) {
    if (!profissional.active) {
      continue;
    }
    // A mesma grafia repetida na ficha de UM profissional conta uma vez.
    const vistas = new Set<string>();
    for (const bruto of profissional.specialties ?? []) {
      const rotulo = rotuloDeEspecialidade(bruto);
      const chave = chaveDeEspecialidade(rotulo);
      if (chave === "" || vistas.has(rotulo)) {
        continue;
      }
      vistas.add(rotulo);
      const contagem = porChave.get(chave) ?? new Map<string, number>();
      contagem.set(rotulo, (contagem.get(rotulo) ?? 0) + 1);
      porChave.set(chave, contagem);
    }
  }
  return [...porChave.entries()]
    .map(([chave, contagem]) => ({ chave, rotulo: melhorRotulo(contagem) }))
    .sort((a, b) => comparaRotulo(a.rotulo, b.rotulo));
}

/**
 * A especialidade que a clinica escolheu, conferida contra a lista dos
 * profissionais ativos. Devolve a opcao com o rotulo da lista (o que a
 * regua grava), ou null quando nenhum profissional ativo tem a especialidade.
 */
export function resolverEspecialidade(
  escolhida: string,
  opcoes: readonly OpcaoDeEspecialidade[],
): OpcaoDeEspecialidade | null {
  const chave = chaveDeEspecialidade(escolhida);
  if (chave === "") {
    return null;
  }
  return opcoes.find((opcao) => opcao.chave === chave) ?? null;
}

/** O nome com que a regua vinculada nasce: "Confirmação: Dra. Helena". */
export function nomeDaReguaVinculada(
  kind: KindVinculavel,
  nomeDoVinculo: string,
): string {
  return `${PREFIXO_DO_NOME[kind]}: ${nomeDoVinculo.trim()}`;
}

function primeiroDoEmbed(bruto: unknown): Record<string, unknown> | null {
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  return valor && typeof valor === "object"
    ? (valor as Record<string, unknown>)
    : null;
}

/**
 * O vinculo de uma linha crua de cadence, com os embeds do PostgREST
 * (procedure:procedure_id e professional:professional_id). Sem nenhum dos
 * tres, null: a regua e a geral ou so a reforcada.
 */
export function vinculoDaLinha(linha: {
  procedure?: unknown;
  professional?: unknown;
  specialty?: unknown;
}): VinculoDaRegua | null {
  const procedimento = primeiroDoEmbed(linha.procedure);
  if (procedimento && typeof procedimento.id === "string") {
    return {
      tipo: "procedimento",
      id: procedimento.id,
      nome: String(procedimento.name ?? ""),
    };
  }
  const profissional = primeiroDoEmbed(linha.professional);
  if (profissional && typeof profissional.id === "string") {
    return {
      tipo: "medico",
      id: profissional.id,
      nome: String(profissional.name ?? ""),
    };
  }
  if (typeof linha.specialty === "string" && linha.specialty.trim() !== "") {
    return {
      tipo: "especialidade",
      chave: chaveDeEspecialidade(linha.specialty),
      nome: rotuloDeEspecialidade(linha.specialty),
    };
  }
  return null;
}

export type RotuloDoVinculo = {
  /** "Médico", "Especialidade", "Procedimento" ou "Histórico de falta". */
  tipo: string;
  icone: LucideIcon;
  /** O nome do medico, da especialidade ou do procedimento; null na reforcada. */
  nome: string | null;
};

export const TIPOS_DE_VINCULO: Record<
  TipoDeVinculo | "reforcada",
  { rotulo: string; icone: LucideIcon }
> = {
  medico: { rotulo: "Médico", icone: UserRound },
  especialidade: { rotulo: "Especialidade", icone: Tag },
  procedimento: { rotulo: "Procedimento", icone: ClipboardList },
  reforcada: { rotulo: "Histórico de falta", icone: History },
};

/**
 * O que o cabecalho da regua mostra: icone e rotulo do vinculo. A regua so
 * reforcada (sem vinculo) aparece como "Histórico de falta"; a geral nao
 * passa por aqui (null).
 */
export function rotuloDoVinculo(regua: {
  vinculo: VinculoDaRegua | null;
  for_no_show_history: boolean;
}): RotuloDoVinculo | null {
  if (regua.vinculo) {
    const tipo = TIPOS_DE_VINCULO[regua.vinculo.tipo];
    return { tipo: tipo.rotulo, icone: tipo.icone, nome: regua.vinculo.nome };
  }
  if (regua.for_no_show_history) {
    const tipo = TIPOS_DE_VINCULO.reforcada;
    return { tipo: tipo.rotulo, icone: tipo.icone, nome: null };
  }
  return null;
}

/**
 * O texto da etiqueta do vinculo no cabecalho: o tipo e o nome ATUAL do
 * cadastro ("Médico: Dra. Helena Souza"). O nome da regua e gravado uma vez
 * so, na criacao, e fica velho quando Cadastros renomeia o medico ou o
 * procedimento; a etiqueta vem da leitura de agora. Sem nome (a reforcada
 * sem vinculo, ou embed vazio), so o tipo.
 */
export function textoDaEtiqueta(rotulo: RotuloDoVinculo): string {
  const nome = rotulo.nome?.trim() ?? "";
  return nome === "" ? rotulo.tipo : `${rotulo.tipo}: ${nome}`;
}

/**
 * A situacao do cartao da aba (confirmacao ou pos falta), que junta a geral
 * e as vinculadas do tipo, porque a vinculada envia mesmo com a geral
 * desligada (regua_da_consulta so olha a propria regua):
 * - geral ligada: "ligada";
 * - geral desligada (ou ausente) e alguma vinculada ligada:
 *   "ligada_nas_vinculadas", com quantas estao ligadas de quantas existem;
 * - nada ligado: "desligada", ou "nao_configurada" sem a geral.
 */
export type SituacaoDoTipo =
  | { estado: "ligada" | "desligada" | "nao_configurada" }
  | { estado: "ligada_nas_vinculadas"; ligadas: number; total: number };

export function situacaoDoTipo(
  geral: { active: boolean } | null,
  vinculadasDoTipo: readonly { active: boolean }[],
): SituacaoDoTipo {
  if (geral?.active) {
    return { estado: "ligada" };
  }
  const ligadas = vinculadasDoTipo.filter((regua) => regua.active).length;
  if (ligadas > 0) {
    return {
      estado: "ligada_nas_vinculadas",
      ligadas,
      total: vinculadasDoTipo.length,
    };
  }
  return { estado: geral ? "desligada" : "nao_configurada" };
}

export type OpcaoDeCadastro = { id: string; nome: string };

export type OpcoesDeVinculo = {
  medicos: OpcaoDeCadastro[];
  especialidades: OpcaoDeEspecialidade[];
  procedimentos: OpcaoDeCadastro[];
};

export type ReguaComVinculo = {
  kind: KindVinculavel;
  vinculo: VinculoDaRegua | null;
  for_no_show_history: boolean;
};

/**
 * O que o dialogo "Nova régua vinculada" ainda oferece para um tipo de
 * regua: tira o medico, a especialidade (pela chave) e o procedimento que
 * ja tem regua vinculada DAQUELE tipo. So a vinculada simples conta (a que
 * o dialogo cria); a reforcada sem vinculo so marca que ja existe.
 */
export function opcoesLivres(
  kind: KindVinculavel,
  reguas: readonly ReguaComVinculo[],
  opcoes: OpcoesDeVinculo,
): OpcoesDeVinculo & { temReforcada: boolean } {
  const doTipo = reguas.filter((regua) => regua.kind === kind);
  const usados = {
    medico: new Set<string>(),
    especialidade: new Set<string>(),
    procedimento: new Set<string>(),
  };
  for (const regua of doTipo) {
    if (!regua.vinculo || regua.for_no_show_history) {
      continue;
    }
    usados[regua.vinculo.tipo].add(
      regua.vinculo.tipo === "especialidade"
        ? regua.vinculo.chave
        : regua.vinculo.id,
    );
  }
  return {
    medicos: opcoes.medicos.filter((medico) => !usados.medico.has(medico.id)),
    especialidades: opcoes.especialidades.filter(
      (especialidade) => !usados.especialidade.has(especialidade.chave),
    ),
    procedimentos: opcoes.procedimentos.filter(
      (procedimento) => !usados.procedimento.has(procedimento.id),
    ),
    temReforcada: doTipo.some(
      (regua) => regua.vinculo === null && regua.for_no_show_history,
    ),
  };
}

export type ItemDoVinculo = { valor: string; rotulo: string };

/**
 * As opcoes de um tipo de vinculo no formato do seletor: o valor e o id (a
 * chave, na especialidade) e o rotulo e o nome que a clinica ve.
 */
export function itensDoVinculo(
  tipo: TipoDeVinculo,
  opcoes: OpcoesDeVinculo,
): ItemDoVinculo[] {
  switch (tipo) {
    case "medico":
      return opcoes.medicos.map((medico) => ({
        valor: medico.id,
        rotulo: medico.nome,
      }));
    case "especialidade":
      return opcoes.especialidades.map((especialidade) => ({
        valor: especialidade.chave,
        rotulo: especialidade.rotulo,
      }));
    case "procedimento":
      return opcoes.procedimentos.map((procedimento) => ({
        valor: procedimento.id,
        rotulo: procedimento.nome,
      }));
  }
}

/**
 * A ordem da lista espelha a precedencia do banco: procedimento, medico,
 * especialidade, e so entao a reforcada sem vinculo; dentro do nivel a
 * reforcada primeiro, depois o nome.
 */
export function ordenarReguasVinculadas<
  T extends {
    name: string;
    vinculo: VinculoDaRegua | null;
    for_no_show_history: boolean;
  },
>(reguas: readonly T[]): T[] {
  const nivel = (regua: T) =>
    regua.vinculo ? NIVEL_DO_VINCULO[regua.vinculo.tipo] : 0;
  return [...reguas].sort((a, b) => {
    if (nivel(a) !== nivel(b)) {
      return nivel(b) - nivel(a);
    }
    if (a.for_no_show_history !== b.for_no_show_history) {
      return a.for_no_show_history ? -1 : 1;
    }
    return comparaRotulo(a.name, b.name);
  });
}
