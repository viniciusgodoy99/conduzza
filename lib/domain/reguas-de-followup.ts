import { z } from "zod";

import {
  chavesDeEtiquetas,
  etiquetaLimpa,
  etiquetasCasam,
  MODOS_DO_FILTRO,
  recusaDasEtiquetas,
  type ModoDoFiltro,
} from "@/lib/domain/etiquetas-do-lead";

// Reguas de follow-up por etiqueta (onda 4, item 16; decisoes do dono de
// 20/10/2026, D1 a D4; migration 20261024100000_reguas_por_etiqueta.sql).
// Modulo puro, serve cliente e servidor.
//
// Antes, uma regua de follow-up por etapa e sem filtro. Agora a etapa pode
// ter varias: as COM etiqueta (Psiquiatria, Odontologia) e no maximo uma
// GERAL (sem etiqueta). Para cada lead vale UMA por vez, escolhida pelo
// banco em regua_de_followup_do_contato, a mesma funcao que o planejador e o
// executor usam (precedente: regua_da_consulta, das reguas vinculadas):
//   - so regua LIGADA conta (D4: a com etiqueta desligada deixa os leads
//     dela para a geral);
//   - a etiqueta conta se estiver no lead OU em qualquer conversa dele,
//     pelo nome sem maiuscula e acento (D1);
//   - com etiqueta vem antes da geral; entre as com etiqueta, a ordem que a
//     clinica escolhe (prioridade), depois a mais antiga (D2: vale a de
//     cima).
// Aqui fica o ESPELHO dessa escolha (reguaQueVale), a ordem da tela, as
// frases e a validacao do "Para quem". O banco e a garantia.

/** Ate quantas etiquetas uma regua filtra (check etiquetas_validas). */
export const ETIQUETAS_POR_REGUA = 10;

/** Faixa do check cadence_prioridade_na_faixa. */
export const PRIORIDADE_MAXIMA = 1000;

/** Limites do nome da regua na tela (o banco so exige nao nulo). */
export const NOME_DA_REGUA_MINIMO = 2;
export const NOME_DA_REGUA_MAXIMO = 80;

/** O que a precedencia precisa de cada regua de follow-up da etapa. */
export type ReguaDaPrecedencia = {
  id: string;
  active: boolean;
  /** Os NOMES das etiquetas (o filtro casa pela chave); vazio: a geral. */
  etiquetas: readonly string[];
  etiquetas_modo: ModoDoFiltro;
  prioridade: number;
  created_at: string;
};

/** A regua geral da etapa: a que nao filtra etiqueta nenhuma. */
export function ehReguaGeral(regua: Pick<ReguaDaPrecedencia, "etiquetas">) {
  return regua.etiquetas.length === 0;
}

function instante(texto: string): number {
  const ms = Date.parse(texto);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * A ordem da precedencia, a mesma do ORDER BY do banco: com etiqueta antes
 * da geral; entre as com etiqueta, prioridade, depois created_at e id.
 */
export function compararPrecedencia(
  a: ReguaDaPrecedencia,
  b: ReguaDaPrecedencia,
): number {
  const geralA = ehReguaGeral(a);
  const geralB = ehReguaGeral(b);
  if (geralA !== geralB) {
    return geralA ? 1 : -1;
  }
  if (a.prioridade !== b.prioridade) {
    return a.prioridade - b.prioridade;
  }
  const tempo = instante(a.created_at) - instante(b.created_at);
  if (tempo !== 0) {
    return tempo;
  }
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** As reguas da etapa na ordem da tela, que e a da precedencia. */
export function reguasEmOrdem<T extends ReguaDaPrecedencia>(
  reguas: readonly T[],
): T[] {
  return [...reguas].sort(compararPrecedencia);
}

/**
 * Espelho de regua_de_followup_do_contato: entre as reguas da etapa do lead,
 * a primeira LIGADA, na ordem da precedencia, cujo filtro casa com as
 * etiquetas dele (chaves do lead e das conversas, pelo nome). Nenhuma: null
 * (o lead fica sem follow-up nesta etapa).
 */
export function reguaQueVale<T extends ReguaDaPrecedencia>(
  reguasDaEtapa: readonly T[],
  chavesDoLead: readonly string[],
): T | null {
  return (
    reguasEmOrdem(reguasDaEtapa).find(
      (regua) =>
        regua.active &&
        etiquetasCasam(chavesDoLead, regua.etiquetas, regua.etiquetas_modo),
    ) ?? null
  );
}

/**
 * O modo que o filtro guarda: com 0 ou 1 etiqueta, "qualquer uma" e "todas"
 * sao o mesmo filtro, e o modo e sempre qualquer (o check
 * cadence_modo_so_com_varias_etiquetas do banco; revisao de 21/10/2026). Sem
 * isto, a mesma etiqueta em "todas" e em "qualquer" passaria como dois
 * filtros, e a regua de baixo nunca valeria para ninguem.
 */
export function modoDoFiltro(
  etiquetas: readonly string[],
  modo: ModoDoFiltro,
): ModoDoFiltro {
  return chavesDeEtiquetas(etiquetas).length >= 2 ? modo : "qualquer";
}

/** Dois filtros iguais (indice cadence_followup_mesmo_filtro)? */
export function mesmoFiltro(
  a: Pick<ReguaDaPrecedencia, "etiquetas" | "etiquetas_modo">,
  b: Pick<ReguaDaPrecedencia, "etiquetas" | "etiquetas_modo">,
): boolean {
  return (
    modoDoFiltro(a.etiquetas, a.etiquetas_modo) ===
      modoDoFiltro(b.etiquetas, b.etiquetas_modo) &&
    JSON.stringify(chavesDeEtiquetas(a.etiquetas)) ===
      JSON.stringify(chavesDeEtiquetas(b.etiquetas))
  );
}

// ---------------------------------------------------------------------------
// Frases

/** "Psiquiatria", "Psiquiatria ou Odontologia", "A, B e C". */
export function textoDasEtiquetas(
  etiquetas: readonly string[],
  modo: ModoDoFiltro,
): string {
  if (etiquetas.length <= 1) {
    return etiquetas[0] ?? "";
  }
  const ligacao = modo === "todas" ? " e " : " ou ";
  return `${etiquetas.slice(0, -1).join(", ")}${ligacao}${etiquetas[etiquetas.length - 1]}`;
}

/** O "Para quem" do cartao da regua. */
export function textoDeParaQuem(
  regua: Pick<ReguaDaPrecedencia, "etiquetas" | "etiquetas_modo">,
): string {
  if (ehReguaGeral(regua)) {
    return "Régua geral da etapa: vale para quem não tem as etiquetas das outras réguas.";
  }
  return `Leads com ${textoDasEtiquetas(regua.etiquetas, regua.etiquetas_modo)}.`;
}

/** "Follow-up de Em contato" ou "Follow-up de Em contato: Psiquiatria". */
export function nomeSugeridoDaRegua(
  nomeDaEtapa: string,
  etiquetas: readonly string[],
  modo: ModoDoFiltro,
): string {
  const base = `Follow-up de ${nomeDaEtapa}`;
  const sufixo = textoDasEtiquetas(etiquetas, modo);
  const nome = sufixo ? `${base}: ${sufixo}` : base;
  return nome.length <= NOME_DA_REGUA_MAXIMO
    ? nome
    : `${nome.slice(0, NOME_DA_REGUA_MAXIMO - 3).trimEnd()}...`;
}

/** A ordem entre as reguas com etiqueta (D2). */
export const REGRA_DA_ORDEM =
  "Se o lead tiver as etiquetas de mais de uma régua, vale a de cima.";

/** O texto fixo de cada etapa com regua por etiqueta e regua geral (D2). */
export const REGRA_DA_PRECEDENCIA = `${REGRA_DA_ORDEM} Quem não tiver nenhuma recebe a régua geral da etapa.`;

/** Etapa sem regua geral: quantos leads ficam sem nenhuma. */
export function avisoDeSemRegua(leads: number, nomeDaEtapa: string): string {
  return leads === 1
    ? `1 lead de ${nomeDaEtapa} não recebe nenhuma régua.`
    : `${leads} leads de ${nomeDaEtapa} não recebem nenhuma régua.`;
}

/** Sem a contagem: a mesma regra, sem numero. */
export function avisoDeEtapaSemGeral(nomeDaEtapa: string): string {
  return `${nomeDaEtapa} não tem régua geral: quem não tiver as etiquetas das réguas acima não recebe nenhuma.`;
}

/** A geral existe, mas esta desligada: o mesmo efeito, enquanto durar (D4). */
export function avisoDeGeralDesligada(nomeDaEtapa: string): string {
  return `A régua geral de ${nomeDaEtapa} está desligada: quem não tiver as etiquetas das réguas acima não recebe nenhuma.`;
}

/**
 * Regua com etiqueta LIGADA e sem mensagem nenhuma vale para os leads dela
 * (a precedencia olha so as ligadas) e nao manda nada: eles ficariam sem
 * follow-up, nem a geral (correcao de 22/10/2026). Por isso ela so liga com
 * pelo menos uma mensagem (alternarReguaAction recusa, e o interruptor fica
 * desabilitado com esta dica); a ultima mensagem ja nao se exclui pela tela.
 */
export const DICA_PARA_LIGAR_SEM_MENSAGEM =
  "Escreva pelo menos uma mensagem antes de ligar. Sem mensagem, os leads com estas etiquetas não recebem nada, nem a régua geral.";

/** A mesma regra, se a regua ja estiver ligada sem mensagem (corrida). */
export function avisoDeLigadaSemMensagem(
  regua: Pick<ReguaDaPrecedencia, "etiquetas" | "etiquetas_modo">,
): string {
  return `Esta régua está ligada sem mensagens: os leads com ${textoDasEtiquetas(regua.etiquetas, regua.etiquetas_modo)} não recebem nada, nem a régua geral da etapa. Escreva uma mensagem ou desligue a régua.`;
}

/** Ao desligar a regua com etiqueta (D4). */
export function avisoAoDesligar(
  regua: Pick<ReguaDaPrecedencia, "etiquetas" | "etiquetas_modo">,
): string {
  return `Os leads com ${textoDasEtiquetas(regua.etiquetas, regua.etiquetas_modo)} passam a receber a régua geral da etapa, se ela estiver ligada.`;
}

/**
 * O que cada lead da etapa recebe, para a confirmacao de mover em Leads:
 * "Psiquiatria, Odontologia ou a geral". So reguas ligadas, na ordem.
 */
export function opcoesDaEtapa(
  reguas: readonly Pick<ReguaDaPrecedencia, "etiquetas" | "etiquetas_modo">[],
): string {
  const partes = reguas
    .filter((regua) => !ehReguaGeral(regua))
    .map((regua) => textoDasEtiquetas(regua.etiquetas, regua.etiquetas_modo));
  if (reguas.some(ehReguaGeral)) {
    partes.push("a geral");
  }
  if (partes.length <= 1) {
    return partes[0] ?? "";
  }
  return `${partes.slice(0, -1).join(", ")} ou ${partes[partes.length - 1]}`;
}

// ---------------------------------------------------------------------------
// A tela: agrupada por etapa, na ordem da jornada

export type EtapaComReguas<T> = {
  chave: string;
  nome: string;
  /** As com etiqueta, na ordem da precedencia (Subir e Descer). */
  comEtiqueta: T[];
  /** A geral da etapa, que vem por ultimo; null quando nao ha. */
  geral: T | null;
};

/**
 * As reguas agrupadas por etapa, na ordem da jornada; etapa sem regua nao
 * aparece. Regua de etapa fora da lista (cache velho) fica no fim, pelo
 * nome que a regua guarda, para nao sumir da tela.
 */
export function agruparReguasPorEtapa<
  T extends ReguaDaPrecedencia & { trigger_stage: string; etapa_nome: string },
>(
  reguas: readonly T[],
  etapas: readonly { chave: string; nome: string }[],
): EtapaComReguas<T>[] {
  const porEtapa = new Map<string, T[]>();
  for (const regua of reguas) {
    const lista = porEtapa.get(regua.trigger_stage) ?? [];
    lista.push(regua);
    porEtapa.set(regua.trigger_stage, lista);
  }
  const grupo = (chave: string, nome: string): EtapaComReguas<T> => {
    const ordenadas = reguasEmOrdem(porEtapa.get(chave) ?? []);
    return {
      chave,
      nome,
      comEtiqueta: ordenadas.filter((regua) => !ehReguaGeral(regua)),
      geral: ordenadas.find(ehReguaGeral) ?? null,
    };
  };
  const conhecidas = new Set(etapas.map((etapa) => etapa.chave));
  const grupos = etapas
    .filter((etapa) => porEtapa.has(etapa.chave))
    .map((etapa) => grupo(etapa.chave, etapa.nome));
  const soltas = [...porEtapa.keys()]
    .filter((chave) => !conhecidas.has(chave))
    .map((chave) => grupo(chave, porEtapa.get(chave)?.[0]?.etapa_nome ?? chave))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return [...grupos, ...soltas];
}

/**
 * A lista das reguas com etiqueta da etapa depois de subir (-1) ou descer
 * (+1) uma delas; null quando nao da (a primeira nao sobe, a ultima nao
 * desce). E a lista que ordenar_reguas_de_followup recebe.
 */
export function novaOrdemDasReguas(
  comEtiqueta: readonly { id: string }[],
  id: string,
  direcao: -1 | 1,
): string[] | null {
  const ids = comEtiqueta.map((regua) => regua.id);
  const de = ids.indexOf(id);
  const para = de + direcao;
  if (de < 0 || para < 0 || para >= ids.length) {
    return null;
  }
  const [movida] = ids.splice(de, 1);
  ids.splice(para, 0, movida!);
  return ids;
}

// ---------------------------------------------------------------------------
// Entrada das Server Actions (o banco confere de novo)

const etapaSchema = z
  .string()
  .regex(/^[a-z0-9_]{1,40}$/, { error: "Escolha a etapa da jornada." });

/** O nome digitado; vazio vale a sugestao. */
const nomeDaReguaSchema = z
  .string()
  .transform((texto) => texto.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .max(NOME_DA_REGUA_MAXIMO, {
        error: `O nome vai até ${NOME_DA_REGUA_MAXIMO} caracteres.`,
      })
      .refine((nome) => nome === "" || nome.length >= NOME_DA_REGUA_MINIMO, {
        error: `Dê um nome com pelo menos ${NOME_DA_REGUA_MINIMO} caracteres.`,
      }),
  );

const etiquetasDaReguaSchema = z
  .array(z.string().max(200))
  .max(50)
  .transform((lista) => lista.map(etiquetaLimpa))
  .superRefine((lista, ctx) => {
    const recusa = recusaDasEtiquetas(lista, ETIQUETAS_POR_REGUA);
    if (recusa) {
      ctx.addIssue({ code: "custom", message: recusa });
    }
  });

/**
 * A regua nova. So `trigger_stage` e obrigatorio: sem etiquetas e a geral da
 * etapa (como sempre foi), e sem nome vale a sugestao. O modo sai
 * normalizado (modoDoFiltro): com menos de duas etiquetas, qualquer.
 */
export const novaReguaDeFollowupSchema = z
  .object({
    trigger_stage: etapaSchema,
    etiquetas: etiquetasDaReguaSchema.default([]),
    etiquetas_modo: z.enum(MODOS_DO_FILTRO).default("qualquer"),
    nome: nomeDaReguaSchema.default(""),
  })
  .transform((entrada) => ({
    ...entrada,
    etiquetas_modo: modoDoFiltro(entrada.etiquetas, entrada.etiquetas_modo),
  }));

export type EntradaDaNovaRegua = z.infer<typeof novaReguaDeFollowupSchema>;

/**
 * O "Para quem" de uma regua que ja existe: nome, etiquetas e modo. A geral
 * continua geral (sem etiqueta); a com etiqueta continua com pelo menos uma
 * (a action confere contra o que esta no banco). O modo sai normalizado,
 * como na regua nova: tirar a segunda etiqueta de um filtro "todas" grava
 * qualquer.
 */
export const paraQuemDaReguaSchema = z
  .object({
    cadence_id: z.uuid(),
    nome: nomeDaReguaSchema,
    etiquetas: etiquetasDaReguaSchema,
    etiquetas_modo: z.enum(MODOS_DO_FILTRO),
  })
  .transform((entrada) => ({
    ...entrada,
    etiquetas_modo: modoDoFiltro(entrada.etiquetas, entrada.etiquetas_modo),
  }));

export type EntradaDoParaQuem = z.infer<typeof paraQuemDaReguaSchema>;

export const ordemDasReguasSchema = z.object({
  trigger_stage: etapaSchema,
  ids: z.array(z.uuid()).min(1).max(200),
});

/** As recusas que a tela mostra (23505 de cada indice). */
export const RECUSAS_DA_REGUA = {
  geralJaExiste:
    "Esta etapa já tem a régua geral. Para outra régua, escolha as etiquetas.",
  mesmoFiltro: "Já existe uma régua com estas etiquetas nesta etapa.",
  semEtiquetaNaComEtiqueta:
    "Escolha pelo menos uma etiqueta. Quem não tiver nenhuma recebe a régua geral da etapa.",
  geralSemEtiqueta:
    "A régua geral da etapa vale para todos os leads dela e não filtra etiqueta. Para filtrar, crie outra régua.",
  ordemMudou:
    "A lista de réguas desta etapa mudou. Recarregue a página e tente de novo.",
  bancoSemEtiquetas:
    "As réguas por etiqueta ainda não estão disponíveis. Tente de novo em alguns minutos.",
  ligarSemMensagem:
    "Escreva pelo menos uma mensagem antes de ligar esta régua. Ligada sem mensagem, os leads com estas etiquetas não receberiam nada, nem a régua geral da etapa.",
} as const;
