import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ehGrade,
  ehTipoDeRequisito,
  ehUf,
  lerHorarioDeFuncionamento,
  prontidaoDoCadastroSchema,
  type HorarioDeFuncionamento,
  type ProntidaoDoCadastro,
  type RequisitoDoProcedimento,
} from "@/lib/domain/cadastro-para-o-agente";

// O cadastro para o agente (AG1, migration 20261027100000): as colunas novas
// de unit, professional e procedure e a tabela procedure_requirement, lidas
// SO por Cadastros (e a prontidao, pela Tela 6). Fica fora de fetchCatalogo
// de proposito: o Catalogo e lido pela Agenda, por Pacientes e por
// Confirmacoes, que nao precisam disto e nao podem cair por isto (se este
// codigo for ao ar antes da migration, so Cadastros cai no erro da pagina).
// Isomorfico: roda no servidor (carga inicial) e no browser (TanStack).
// A RLS do banco garante isolamento e papel; o filtro pela clinica ativa
// existe porque a RLS deixa quem e membro de duas clinicas ler as duas.

export type CadastroDaUnidade = {
  unit_id: string;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  referencia: string | null;
  estacionamento: string | null;
  acessibilidade: string | null;
  link_do_mapa: string | null;
  /** Nulo quando nao informado (ou fora da regra, o que o banco nao deixa). */
  horario_de_funcionamento: HorarioDeFuncionamento | null;
  observacao_ao_paciente: string | null;
};

export type CadastroDoProfissional = {
  professional_id: string;
  idade_minima: number | null;
  idade_maxima: number | null;
  grade_minutos: number | null;
};

export type CadastroDoProcedimento = {
  procedure_id: string;
  ia_pode_informar: boolean;
};

/** Listas (e nao Map) para atravessar do servidor para o cliente. */
export type CadastroParaOAgente = {
  unidades: CadastroDaUnidade[];
  profissionais: CadastroDoProfissional[];
  procedimentos: CadastroDoProcedimento[];
  requisitos: RequisitoDoProcedimento[];
};

export const CADASTRO_VAZIO_PARA_O_AGENTE: CadastroParaOAgente = {
  unidades: [],
  profissionais: [],
  procedimentos: [],
  requisitos: [],
};

/**
 * Sob o prefixo do catalogo (["catalogo", clinicId]): o aoMudar de Cadastros
 * (invalidate do prefixo) recarrega isto junto com o catalogo.
 */
export const cadastroParaOAgenteKey = (clinicId: string) =>
  ["catalogo", clinicId, "cadastro-para-o-agente"] as const;

type Linha = Record<string, unknown>;

const textoOuNulo = (valor: unknown): string | null =>
  typeof valor === "string" ? valor : null;
const inteiroOuNulo = (valor: unknown): number | null =>
  typeof valor === "number" && Number.isInteger(valor) ? valor : null;

/**
 * As colunas novas e os requisitos da clinica. Erro em qualquer leitura
 * LANCA: Cadastros cai no erro da pagina em vez de abrir os modais sem o
 * que esta gravado (o proximo Salvar apagaria).
 */
export async function fetchCadastroParaOAgente(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<CadastroParaOAgente> {
  const [unidades, profissionais, procedimentos, requisitos] =
    await Promise.all([
      supabase
        .from("unit")
        .select(
          "id, logradouro, numero, complemento, bairro, cidade, uf, cep, referencia, estacionamento, acessibilidade, link_do_mapa, horario_de_funcionamento, observacao_ao_paciente",
        )
        .eq("clinic_id", clinicId)
        .order("id"),
      supabase
        .from("professional")
        .select("id, idade_minima, idade_maxima, grade_minutos")
        .eq("clinic_id", clinicId)
        .order("id"),
      supabase
        .from("procedure")
        .select("id, ia_pode_informar")
        .eq("clinic_id", clinicId)
        .order("id"),
      supabase
        .from("procedure_requirement")
        .select(
          "id, procedure_id, insurance_id, tipo, valor_inteiro, texto_ao_paciente, ativo",
        )
        .eq("clinic_id", clinicId)
        .order("created_at")
        .order("id"),
    ]);
  for (const resultado of [
    unidades,
    profissionais,
    procedimentos,
    requisitos,
  ]) {
    if (resultado.error) {
      throw new Error(resultado.error.message);
    }
  }
  return {
    unidades: ((unidades.data ?? []) as Linha[]).map((u) => ({
      unit_id: u.id as string,
      logradouro: textoOuNulo(u.logradouro),
      numero: textoOuNulo(u.numero),
      complemento: textoOuNulo(u.complemento),
      bairro: textoOuNulo(u.bairro),
      cidade: textoOuNulo(u.cidade),
      uf: ehUf(u.uf) ? u.uf : null,
      cep: textoOuNulo(u.cep),
      referencia: textoOuNulo(u.referencia),
      estacionamento: textoOuNulo(u.estacionamento),
      acessibilidade: textoOuNulo(u.acessibilidade),
      link_do_mapa: textoOuNulo(u.link_do_mapa),
      horario_de_funcionamento: lerHorarioDeFuncionamento(
        u.horario_de_funcionamento ?? null,
      ),
      observacao_ao_paciente: textoOuNulo(u.observacao_ao_paciente),
    })),
    profissionais: ((profissionais.data ?? []) as Linha[]).map((p) => ({
      professional_id: p.id as string,
      idade_minima: inteiroOuNulo(p.idade_minima),
      idade_maxima: inteiroOuNulo(p.idade_maxima),
      grade_minutos: ehGrade(p.grade_minutos) ? p.grade_minutos : null,
    })),
    procedimentos: ((procedimentos.data ?? []) as Linha[]).map((r) => ({
      procedure_id: r.id as string,
      ia_pode_informar: r.ia_pode_informar !== false,
    })),
    requisitos: ((requisitos.data ?? []) as Linha[]).flatMap((q) =>
      ehTipoDeRequisito(q.tipo)
        ? [
            {
              id: q.id as string,
              procedure_id: q.procedure_id as string,
              insurance_id: textoOuNulo(q.insurance_id),
              tipo: q.tipo,
              valor_inteiro: inteiroOuNulo(q.valor_inteiro),
              texto_ao_paciente: textoOuNulo(q.texto_ao_paciente),
              ativo: q.ativo === true,
            },
          ]
        : [],
    ),
  };
}

/** Os requisitos de um procedimento, na ordem em que foram criados. */
export function requisitosDoProcedimento(
  cadastro: CadastroParaOAgente,
  procedureId: string,
): RequisitoDoProcedimento[] {
  return cadastro.requisitos.filter((r) => r.procedure_id === procedureId);
}

export function cadastroDaUnidade(
  cadastro: CadastroParaOAgente,
  unitId: string,
): CadastroDaUnidade | null {
  return cadastro.unidades.find((u) => u.unit_id === unitId) ?? null;
}

export function cadastroDoProfissional(
  cadastro: CadastroParaOAgente,
  professionalId: string,
): CadastroDoProfissional | null {
  return (
    cadastro.profissionais.find((p) => p.professional_id === professionalId) ??
    null
  );
}

export function cadastroDoProcedimento(
  cadastro: CadastroParaOAgente,
  procedureId: string,
): CadastroDoProcedimento | null {
  return (
    cadastro.procedimentos.find((p) => p.procedure_id === procedureId) ?? null
  );
}

/**
 * A prontidao do cadastro da clinica (RPC prontidao_do_cadastro_da_ia, so
 * para administrador, gestor e super admin; o banco recusa os outros com
 * 42501). So contagens e nomes de cadastro. Erro ou formato inesperado
 * LANCA: o cartao mostra o erro dele, nunca um "pronto" que nao conferiu.
 */
export async function fetchProntidaoDoCadastro(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ProntidaoDoCadastro> {
  const { data, error } = await supabase.rpc("prontidao_do_cadastro_da_ia", {
    p_clinic_id: clinicId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const lido = prontidaoDoCadastroSchema.safeParse(data);
  if (!lido.success) {
    throw new Error("Formato inesperado da prontidão do cadastro.");
  }
  return lido.data;
}
