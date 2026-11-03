import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SITUACOES_DO_PREPARO,
  situacaoDoPreparoNaTela,
  type PreparoDaHabilidade,
  type SituacaoDoPreparo,
  type SituacaoDoPreparoNaTela,
  type VersaoNaTela,
} from "@/lib/domain/preparo";
import { fetchProfileNames } from "@/lib/queries/profiles";

// A orientacao de preparo aprovada pelo responsavel tecnico (AG7, migration
// 20261103100000), lida pela SESSAO: preparo_do_procedimento e
// responsavel_tecnico tem a policy "membro ativo le" (todo papel ativo, e o
// super admin), e clinic_member tem "membro ve o time". Nada aqui escreve:
// a escrita e so pelas RPCs (app/(app)/cadastros/preparo-actions.ts e
// app/(app)/configuracoes/responsavel-tecnico-actions.ts).
//
// Isomorfico: roda no servidor (carga inicial de Cadastros, Configuracoes e
// Tela 6) e no navegador (TanStack). O filtro pela clinica ativa existe
// porque a RLS deixa quem e membro de duas clinicas ler as duas.
//
// O texto do preparo nao e dado de paciente (e o protocolo da clinica). A
// conferencia do hash recalculado e do banco (preparo_em_vigor); a tela usa
// situacaoDoPreparoNaTela (lib/domain/preparo.ts), com a paridade testada
// na integracao.
//
// O texto (ate 3.500 caracteres) so e lido das versoes que a tela mostra
// (revisao das telas, TELA-14): cada Salvar cria uma versao, e ler o texto de
// todas a cada carga e a cada volta do foco pesava sem servir a ninguem. A
// lista "Ver versoes" nao mostra texto. A Tela 6 tambem nao, mas le o texto
// das versoes EM VIGOR (uma por procedimento, no maximo) para o servidor
// conferir as regras de hoje (revisao curta da AG7, a sobra da CURTA-5).

export type ResponsavelTecnico = {
  id: string;
  userId: string;
  nome: string;
  conselho: string;
  numero: string;
  uf: string;
  desde: string;
  ate: string | null;
};

export type OrigemDoPreparo = "cadastro" | "texto_antigo";

export type VersaoDoPreparo = {
  id: string;
  procedureId: string;
  versao: number;
  situacao: SituacaoDoPreparo;
  /**
   * O texto, so nas versoes que a secao mostra (a mais nova aprovada,
   * aguardando, suspensa e devolvida de cada procedimento; ver
   * versoesComTextoNaTela). null: o texto desta versao nao foi lido.
   */
  texto: string | null;
  textoSha256: string;
  nomeDoProcedimento: string;
  origem: OrigemDoPreparo;
  escritoPor: string | null;
  escritoEm: string;
  aprovadoPor: string | null;
  aprovadoEm: string | null;
  rtId: string | null;
  encerradoPor: string | null;
  encerradoEm: string | null;
  comentario: string | null;
};

/** Listas e registros simples (e nao Map) para atravessar do servidor. */
export type PreparosDaClinica = {
  /** Toda versao da clinica, por procedimento e numero da versao. */
  versoes: VersaoDoPreparo[];
  /**
   * Toda designacao de RT da clinica (a aberta e as encerradas): a versao
   * aprovada guarda o rt_id de quem aprovou, que pode ja ter saido.
   */
  responsaveis: ResponsavelTecnico[];
  /** A designacao aberta (ate nulo), com ou sem acesso ativo. */
  rtAberto: ResponsavelTecnico | null;
  /** O RT aberto tem clinic_member ativo na clinica (a regra do vigente). */
  rtComAcesso: boolean;
  /** A sessao e o RT vigente (RPC user_e_responsavel_tecnico). */
  souRt: boolean;
  /** Nome de quem escreveu, aprovou ou encerrou, por user_id. */
  nomes: Record<string, string>;
};

export const PREPAROS_VAZIOS: PreparosDaClinica = {
  versoes: [],
  responsaveis: [],
  rtAberto: null,
  rtComAcesso: false,
  souRt: false,
  nomes: {},
};

/**
 * Sob o prefixo do catalogo (["catalogo", clinicId]): o aoMudar de Cadastros
 * (invalidate do prefixo) recarrega isto junto com o catalogo.
 */
export const preparosDaClinicaKey = (clinicId: string) =>
  ["catalogo", clinicId, "preparo"] as const;

type Linha = Record<string, unknown>;

const textoOuNulo = (valor: unknown): string | null =>
  typeof valor === "string" ? valor : null;

function ehSituacao(valor: unknown): valor is SituacaoDoPreparo {
  return (
    typeof valor === "string" &&
    (SITUACOES_DO_PREPARO as readonly string[]).includes(valor)
  );
}

const COLUNAS_DO_RT = "id, user_id, nome, conselho, numero, uf, desde, ate";

// Sem o texto: ele vem numa leitura propria, so das versoes que a tela
// mostra (lerTextosDasVersoes).
const COLUNAS_DA_VERSAO =
  "id, procedure_id, versao, situacao, texto_sha256, nome_do_procedimento, origem, escrito_por, escrito_em, aprovado_por, aprovado_em, rt_id, encerrado_por, encerrado_em, comentario";

function lerResponsavel(r: Linha): ResponsavelTecnico | null {
  if (
    typeof r.id !== "string" ||
    typeof r.user_id !== "string" ||
    typeof r.nome !== "string" ||
    typeof r.conselho !== "string" ||
    typeof r.numero !== "string" ||
    typeof r.uf !== "string" ||
    typeof r.desde !== "string"
  ) {
    return null;
  }
  return {
    id: r.id,
    userId: r.user_id,
    nome: r.nome,
    conselho: r.conselho,
    numero: r.numero,
    uf: r.uf,
    desde: r.desde,
    ate: textoOuNulo(r.ate),
  };
}

function lerVersao(v: Linha): VersaoDoPreparo | null {
  if (
    typeof v.id !== "string" ||
    typeof v.procedure_id !== "string" ||
    typeof v.versao !== "number" ||
    !ehSituacao(v.situacao) ||
    typeof v.texto_sha256 !== "string" ||
    typeof v.nome_do_procedimento !== "string" ||
    typeof v.escrito_em !== "string"
  ) {
    return null;
  }
  return {
    id: v.id,
    procedureId: v.procedure_id,
    versao: v.versao,
    situacao: v.situacao,
    texto: textoOuNulo(v.texto),
    textoSha256: v.texto_sha256,
    nomeDoProcedimento: v.nome_do_procedimento,
    origem: v.origem === "texto_antigo" ? "texto_antigo" : "cadastro",
    escritoPor: textoOuNulo(v.escrito_por),
    escritoEm: v.escrito_em,
    aprovadoPor: textoOuNulo(v.aprovado_por),
    aprovadoEm: textoOuNulo(v.aprovado_em),
    rtId: textoOuNulo(v.rt_id),
    encerradoPor: textoOuNulo(v.encerrado_por),
    encerradoEm: textoOuNulo(v.encerrado_em),
    comentario: textoOuNulo(v.comentario),
  };
}

/** O vinculo da pessoa na clinica esta ativo? (a regra do RT vigente) */
async function temAcessoAtivo(
  supabase: SupabaseClient,
  clinicId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("clinic_member")
    .select("status")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as { status?: unknown } | null)?.status === "ativo";
}

/**
 * A designacao aberta do RT da clinica (ate nulo), ou null. Erro LANCA.
 * Configuracoes, Equipe (o cartao e o selo na lista) le daqui.
 */
export async function fetchResponsavelTecnicoAberto(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ResponsavelTecnico | null> {
  const { data, error } = await supabase
    .from("responsavel_tecnico")
    .select(COLUNAS_DO_RT)
    .eq("clinic_id", clinicId)
    .is("ate", null)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data ? lerResponsavel(data as Linha) : null;
}

/** As situacoes cujo texto a secao mostra (a mais nova de cada uma). */
const SITUACOES_COM_TEXTO_NA_TELA: ReadonlySet<SituacaoDoPreparo> = new Set([
  "aprovado",
  "aguardando_rt",
  "suspenso",
  "devolvido",
]);

/**
 * Os ids das versoes cujo texto a secao mostra: de cada procedimento, a mais
 * nova aprovada, aguardando o RT, suspensa e devolvida (o bloco em vigor ou
 * parado, o bloco aguardando, o suspenso, o ponto de partida do editor, o
 * dialogo do RT e o "Aprovar de novo"). E um pouco mais do que a secao usa
 * (resumoDoPreparo), nunca menos.
 */
export function versoesComTextoNaTela(
  versoes: readonly Pick<
    VersaoDoPreparo,
    "id" | "procedureId" | "versao" | "situacao"
  >[],
): string[] {
  const maisNova = new Map<string, { id: string; versao: number }>();
  for (const v of versoes) {
    if (!SITUACOES_COM_TEXTO_NA_TELA.has(v.situacao)) {
      continue;
    }
    const chave = `${v.procedureId}:${v.situacao}`;
    const atual = maisNova.get(chave);
    if (!atual || v.versao > atual.versao) {
      maisNova.set(chave, { id: v.id, versao: v.versao });
    }
  }
  return [...maisNova.values()].map((v) => v.id);
}

/** Ids por consulta: o filtro in.(...) vai na URL. */
const LOTE_DOS_TEXTOS = 100;

/**
 * O texto das versoes pedidas, por id (as versoes sao imutaveis: o texto de
 * um id nunca muda). Erro LANCA, como o resto da leitura da secao.
 */
async function lerTextosDasVersoes(
  supabase: SupabaseClient,
  clinicId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const lotes: string[][] = [];
  for (let inicio = 0; inicio < ids.length; inicio += LOTE_DOS_TEXTOS) {
    lotes.push(ids.slice(inicio, inicio + LOTE_DOS_TEXTOS));
  }
  const respostas = await Promise.all(
    lotes.map((lote) =>
      supabase
        .from("preparo_do_procedimento")
        .select("id, texto")
        .eq("clinic_id", clinicId)
        .in("id", lote),
    ),
  );
  const textos = new Map<string, string>();
  for (const { data, error } of respostas) {
    if (error) {
      throw new Error(error.message);
    }
    for (const linha of (data ?? []) as Linha[]) {
      if (typeof linha.id === "string" && typeof linha.texto === "string") {
        textos.set(linha.id, linha.texto);
      }
    }
  }
  return textos;
}

/**
 * Tudo o que a secao "Orientacao de preparo" de Cadastros mostra: as versoes
 * de todos os procedimentos (o texto so das que a secao mostra), as
 * designacoes de RT, se o RT aberto tem acesso e se a sessao e o RT vigente.
 * Erro numa leitura LANCA: a secao mostra o erro com "Tentar de novo" (nunca
 * um "sem orientacao" que nao conferiu). So os nomes sao tolerantes: sem
 * eles, a tela diz "uma pessoa da equipe".
 */
export async function fetchPreparosDaClinica(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<PreparosDaClinica> {
  const [versoes, responsaveis, souRt] = await Promise.all([
    supabase
      .from("preparo_do_procedimento")
      .select(COLUNAS_DA_VERSAO)
      .eq("clinic_id", clinicId)
      .order("procedure_id")
      .order("versao"),
    supabase
      .from("responsavel_tecnico")
      .select(COLUNAS_DO_RT)
      .eq("clinic_id", clinicId)
      .order("desde"),
    supabase.rpc("user_e_responsavel_tecnico", { p_clinic_id: clinicId }),
  ]);
  for (const resultado of [versoes, responsaveis, souRt]) {
    if (resultado.error) {
      throw new Error(resultado.error.message);
    }
  }
  const semTexto = ((versoes.data ?? []) as Linha[])
    .map(lerVersao)
    .filter((v): v is VersaoDoPreparo => v !== null);
  const textos = await lerTextosDasVersoes(
    supabase,
    clinicId,
    versoesComTextoNaTela(semTexto),
  );
  const lidas = semTexto.map((v) => ({
    ...v,
    texto: textos.get(v.id) ?? null,
  }));
  const designacoes = ((responsaveis.data ?? []) as Linha[])
    .map(lerResponsavel)
    .filter((r): r is ResponsavelTecnico => r !== null);
  const rtAberto = designacoes.find((r) => r.ate === null) ?? null;
  const rtComAcesso = rtAberto
    ? await temAcessoAtivo(supabase, clinicId, rtAberto.userId)
    : false;

  const ids = [
    ...new Set(
      lidas.flatMap((v) =>
        [v.escritoPor, v.aprovadoPor, v.encerradoPor].filter(
          (id): id is string => id !== null,
        ),
      ),
    ),
  ];
  let nomes: Record<string, string> = {};
  try {
    nomes = await fetchProfileNames(supabase, ids);
  } catch {
    nomes = {};
  }

  return {
    versoes: lidas,
    responsaveis: designacoes,
    rtAberto,
    rtComAcesso,
    souRt: souRt.data === true,
    nomes,
  };
}

/** As versoes de um procedimento, da mais antiga para a mais nova. */
export function versoesDoProcedimento(
  dados: PreparosDaClinica,
  procedureId: string,
): VersaoDoPreparo[] {
  return dados.versoes
    .filter((v) => v.procedureId === procedureId)
    .sort((a, b) => a.versao - b.versao);
}

/** A maior versao do procedimento (0 sem versao): o p_versao_lida. */
export function versaoLidaDoProcedimento(
  dados: PreparosDaClinica,
  procedureId: string,
): number {
  return versoesDoProcedimento(dados, procedureId).reduce(
    (maior, v) => Math.max(maior, v.versao),
    0,
  );
}

/** A clinica tem RT vigente (aberto e com acesso ativo)? */
export function temRtVigente(dados: PreparosDaClinica): boolean {
  return dados.rtAberto !== null && dados.rtComAcesso;
}

function paraATela(v: VersaoDoPreparo): VersaoNaTela {
  return {
    id: v.id,
    versao: v.versao,
    situacao: v.situacao,
    textoSha256: v.textoSha256,
    nomeDoProcedimento: v.nomeDoProcedimento,
    rtId: v.rtId,
  };
}

/** O chip do procedimento (os cinco do desenho), com o nome GRAVADO dele. */
export function situacaoDoProcedimento(
  dados: PreparosDaClinica,
  procedimento: { id: string; name: string },
): SituacaoDoPreparoNaTela {
  return situacaoDoPreparoNaTela({
    versoes: versoesDoProcedimento(dados, procedimento.id).map(paraATela),
    rtAberto: dados.rtAberto
      ? { id: dados.rtAberto.id, userId: dados.rtAberto.userId }
      : null,
    rtComAcesso: dados.rtComAcesso,
    nomeAtual: procedimento.name,
  });
}

/**
 * Os procedimentos cuja orientacao espera o RT (a faixa e o filtro do RT):
 * um texto aguardando a aprovacao, ou a aprovacao que parou de valer ("Precisa
 * de nova aprovacao": RT trocado ou nome mudado, D-73). Depois da troca do
 * RT, e por aqui que o RT novo acha o que parou (revisao das telas, TELA-7).
 * O envio suspenso fica de fora: suspender e uma decisao, e voltar a enviar
 * tambem.
 */
export function procedimentosEsperandoORt(
  dados: PreparosDaClinica,
  procedimentos: readonly { id: string; name: string }[],
): string[] {
  return procedimentos
    .filter(
      (p) =>
        situacaoDoProcedimento(dados, p) === "precisa_de_nova_aprovacao" ||
        dados.versoes.some(
          (v) => v.procedureId === p.id && v.situacao === "aguardando_rt",
        ),
    )
    .map((p) => p.id);
}

/**
 * As versoes aprovadas EM VIGOR dos procedimentos ATIVOS (a nota da
 * habilidade "Enviar orientacao de preparo" na Tela 6: a IA so ve
 * procedimento ativo): de cada procedimento com o chip "aprovada" (o RT da
 * versao e o aberto, com acesso, e o nome nao mudou), a aprovada mais nova.
 */
export function versoesEmVigorDosAtivos(
  dados: Pick<PreparosDaClinica, "versoes" | "rtAberto" | "rtComAcesso">,
  procedimentos: readonly { id: string; name: string; active: boolean }[],
): string[] {
  const completos: PreparosDaClinica = {
    ...PREPAROS_VAZIOS,
    versoes: dados.versoes,
    rtAberto: dados.rtAberto,
    rtComAcesso: dados.rtComAcesso,
  };
  return procedimentos.flatMap((p) => {
    if (!p.active || situacaoDoProcedimento(completos, p) !== "aprovada") {
      return [];
    }
    const aprovada = versoesDoProcedimento(completos, p.id)
      .filter((v) => v.situacao === "aprovado")
      .at(-1);
    return aprovada ? [aprovada.id] : [];
  });
}

/**
 * A nota da Tela 6 a partir das versoes em vigor e dos textos lidos (revisao
 * curta da AG7, a sobra da CURTA-5): sem nenhuma, "sem_texto_aprovado";
 * quando as regras de hoje recusam o texto de todas (o envio e a regua nao
 * as deixam sair, e Cadastros as mostra como "Aprovada, sem envio"),
 * "aprovada_sem_envio"; senao, "sai". O texto que nao veio na leitura conta
 * como o que sai: sem conferir, a tela nao inventa a nota.
 */
export function preparoDaHabilidade(
  emVigor: readonly string[],
  textos: ReadonlyMap<string, string>,
  recusado: (texto: string) => boolean,
): PreparoDaHabilidade {
  if (emVigor.length === 0) {
    return "sem_texto_aprovado";
  }
  return emVigor.some((id) => {
    const texto = textos.get(id);
    return texto === undefined || !recusado(texto);
  })
    ? "sai"
    : "aprovada_sem_envio";
}

/**
 * Para a Tela 6 (a nota de "Enviar orientação de preparo"): le as versoes
 * aprovadas (sem o texto, TELA-14), o RT aberto, o vinculo dele e os
 * procedimentos ativos; depois, so o texto das versoes EM VIGOR (uma por
 * procedimento, no maximo), para conferir as regras de hoje. `recusado` e
 * a conferencia do SERVIDOR: o filtro de conformidade nunca vai ao
 * navegador, e a pagina passa recusadoPelasRegrasDeHoje
 * (app/(app)/cadastros/recusas-do-preparo.ts), o mesmo criterio do chip
 * "Aprovada, sem envio" de Cadastros. Vale para todo papel que abre a Tela 6
 * (a recepcao inclusive). Erro LANCA: quem chama decide (a pagina nao mostra
 * a nota quando nao conferiu).
 */
export async function fetchPreparoDaHabilidade(
  supabase: SupabaseClient,
  clinicId: string,
  recusado: (texto: string) => boolean,
): Promise<PreparoDaHabilidade> {
  const [versoes, rt, procedimentos] = await Promise.all([
    supabase
      .from("preparo_do_procedimento")
      .select(COLUNAS_DA_VERSAO)
      .eq("clinic_id", clinicId)
      .eq("situacao", "aprovado"),
    fetchResponsavelTecnicoAberto(supabase, clinicId),
    supabase
      .from("procedure")
      .select("id, name, active")
      .eq("clinic_id", clinicId)
      .eq("active", true),
  ]);
  if (versoes.error) {
    throw new Error(versoes.error.message);
  }
  if (procedimentos.error) {
    throw new Error(procedimentos.error.message);
  }
  const aprovadas = ((versoes.data ?? []) as Linha[])
    .map(lerVersao)
    .filter((v): v is VersaoDoPreparo => v !== null);
  if (aprovadas.length === 0 || rt === null) {
    return "sem_texto_aprovado";
  }
  const rtComAcesso = await temAcessoAtivo(supabase, clinicId, rt.userId);
  const ativos = ((procedimentos.data ?? []) as Linha[]).flatMap((p) =>
    typeof p.id === "string" && typeof p.name === "string"
      ? [{ id: p.id, name: p.name, active: p.active === true }]
      : [],
  );
  const emVigor = versoesEmVigorDosAtivos(
    { versoes: aprovadas, rtAberto: rt, rtComAcesso },
    ativos,
  );
  if (emVigor.length === 0) {
    return "sem_texto_aprovado";
  }
  const textos = await lerTextosDasVersoes(supabase, clinicId, emVigor);
  return preparoDaHabilidade(emVigor, textos, recusado);
}
