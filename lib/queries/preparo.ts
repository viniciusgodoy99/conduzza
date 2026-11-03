import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SITUACOES_DO_PREPARO,
  situacaoDoPreparoNaTela,
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
  texto: string;
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

const COLUNAS_DA_VERSAO =
  "id, procedure_id, versao, situacao, texto, texto_sha256, nome_do_procedimento, origem, escrito_por, escrito_em, aprovado_por, aprovado_em, rt_id, encerrado_por, encerrado_em, comentario";

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
    typeof v.texto !== "string" ||
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
    texto: v.texto,
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

/**
 * Tudo o que a secao "Orientacao de preparo" de Cadastros mostra: as versoes
 * de todos os procedimentos, as designacoes de RT, se o RT aberto tem acesso
 * e se a sessao e o RT vigente. Erro numa leitura LANCA: a secao mostra o
 * erro com "Tentar de novo" (nunca um "sem orientacao" que nao conferiu).
 * So os nomes sao tolerantes: sem eles, a tela diz "uma pessoa da equipe".
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
  const lidas = ((versoes.data ?? []) as Linha[])
    .map(lerVersao)
    .filter((v): v is VersaoDoPreparo => v !== null);
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

/** Quantos procedimentos tem um texto esperando o RT (a faixa do RT). */
export function procedimentosAguardandoORt(dados: PreparosDaClinica): string[] {
  return [
    ...new Set(
      dados.versoes
        .filter((v) => v.situacao === "aguardando_rt")
        .map((v) => v.procedureId),
    ),
  ];
}

/**
 * Algum procedimento ATIVO tem orientacao em vigor? (a nota da habilidade
 * "Enviar orientacao de preparo" na Tela 6: a IA so ve procedimento ativo).
 */
export function algumPreparoEmVigor(
  dados: Pick<PreparosDaClinica, "versoes" | "rtAberto" | "rtComAcesso">,
  procedimentos: readonly { id: string; name: string; active: boolean }[],
): boolean {
  const completos: PreparosDaClinica = {
    ...PREPAROS_VAZIOS,
    versoes: dados.versoes,
    rtAberto: dados.rtAberto,
    rtComAcesso: dados.rtComAcesso,
  };
  return procedimentos.some(
    (p) => p.active && situacaoDoProcedimento(completos, p) === "aprovada",
  );
}

/**
 * Para a Tela 6 (a nota "Nenhum procedimento tem orientacao aprovada pelo
 * responsavel tecnico"): le so as versoes aprovadas, o RT aberto, o vinculo
 * dele e os procedimentos ativos. Vale para todo papel que abre a Tela 6 (a
 * recepcao inclusive). Erro LANCA: quem chama decide (a pagina nao mostra a
 * nota quando nao conferiu).
 */
export async function fetchHaPreparoEmVigor(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<boolean> {
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
    return false;
  }
  const rtComAcesso = await temAcessoAtivo(supabase, clinicId, rt.userId);
  const ativos = ((procedimentos.data ?? []) as Linha[]).flatMap((p) =>
    typeof p.id === "string" && typeof p.name === "string"
      ? [{ id: p.id, name: p.name, active: p.active === true }]
      : [],
  );
  return algumPreparoEmVigor(
    { versoes: aprovadas, rtAberto: rt, rtComAcesso },
    ativos,
  );
}
