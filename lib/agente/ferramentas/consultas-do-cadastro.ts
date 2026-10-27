// As tres consultas do Cadastro do agente de IA (AG2, 27/10/2026):
// consultar_unidades, consultar_requisitos e buscar_profissionais. Sao da
// habilidade travada "Responder dúvidas" (lib/domain/agente/config.ts):
// sempre oferecidas com o agente ligado, no WhatsApp e no simulador da Tela 6.
// PURAS: leem o catalogo que o servidor carregou com o clinic_id explicito
// (lib/agente/contexto.ts); nao leem o banco, nao gravam nada e nao tem dado
// de paciente. Erro de leitura do Cadastro derruba o carregamento do
// catalogo inteiro, antes do turno (falha fechada, como o catalogo de hoje).

import type { FatosDaFerramenta } from "@/lib/domain/conformidade/fatos-do-turno";
import type { FerramentaDoCadastro } from "@/lib/domain/agente/config";

import {
  conveniosConhecidos,
  type CatalogoDoAgente,
} from "./buscar-procedimento";
import { buscarProfissionais } from "./buscar-profissionais";
import { itemDoRequisito } from "./cadastro-do-agente";
import { consultarRequisitos } from "./consultar-requisitos";
import { consultarUnidades } from "./consultar-unidades";

/** O que uma consulta do Cadastro devolve ao laco (lib/agente/laco.ts). */
export type ResultadoDaConsulta = {
  /** JSON para o modelo (function_call_output). */
  saida: string;
  /** O passo da trilha (tipo "cadastro"), so com nomes do Cadastro. */
  passo: string;
  /** Codigo do resultado, para log e teste. */
  resultado: string;
  /** O que a saida afirma de convenio, para os fatos do turno. */
  fatos?: FatosDaFerramenta;
};

/** O que a configuracao publicada liga, para as consultas respeitarem. */
export type OpcoesDaConsulta = {
  /** "Informar preço e convênio" ligada (buscar_procedimento oferecida). */
  informarConvenio: boolean;
  /** "Agendar consulta" ligada com a agenda completa (buscar_horario). */
  agendaLigada: boolean;
};

/** Executa a consulta pelo nome. Nunca lanca (entrada invalida e resultado). */
export function executarConsultaDoCadastro(
  nome: FerramentaDoCadastro,
  catalogo: CatalogoDoAgente,
  argumentos: unknown,
  opcoes: OpcoesDaConsulta,
): ResultadoDaConsulta {
  switch (nome) {
    case "consultar_unidades":
      return consultarUnidades(catalogo, argumentos);
    case "consultar_requisitos":
      return consultarRequisitos(catalogo, argumentos, opcoes);
    case "buscar_profissionais":
      return buscarProfissionais(catalogo, argumentos, opcoes);
  }
}

const TODOS = {
  especialidade: null,
  procedimento: null,
  convenio: null,
  unidade: null,
};

/**
 * Teto, em bytes, de UMA saida de uma consulta do Cadastro neste catalogo
 * (a reserva do gasto, lib/agente/gasto.ts e laco.ts): a maior entre todas
 * as unidades, todos os profissionais (com todas as especialidades e
 * unidades), todos os requisitos e as opcoes de convenio (o mesmo teto de
 * buscar_procedimento). Cada texto conta como fica no JSON.
 */
export function limiteDasConsultasDoCadastro(
  catalogo: CatalogoDoAgente,
): number {
  const noJson = (texto: string) =>
    Buffer.byteLength(JSON.stringify(texto), "utf8");
  const bytes = (texto: string) => Buffer.byteLength(texto, "utf8");
  const ligado: OpcoesDaConsulta = {
    informarConvenio: true,
    agendaLigada: true,
  };
  const unidades = bytes(consultarUnidades(catalogo, { unidade: null }).saida);
  const profissionais = bytes(
    buscarProfissionais(catalogo, TODOS, ligado).saida,
  );
  const especialidades = (catalogo.profissionais ?? [])
    .flatMap((p) => p.especialidades)
    .reduce((soma, e) => soma + noJson(e) + 2, 0);
  const maiorProcedimento = [
    ...catalogo.procedimentos,
    ...(catalogo.procedimentosSoComAEquipe ?? []),
  ].reduce((maior, p) => Math.max(maior, noJson(p.nome)), 0);
  const requisitos = (catalogo.requisitos ?? []).reduce(
    (soma, r) => soma + noJson(itemDoRequisito(r)) + noJson(r.texto ?? "") + 64,
    0,
  );
  const convenios = conveniosConhecidos(catalogo).reduce(
    (soma, c) =>
      soma + 2 * noJson(`${c.nome} (${c.plano ?? "sem plano"})`) + 128,
    0,
  );
  return (
    512 +
    Math.max(
      unidades,
      profissionais,
      especialidades,
      maiorProcedimento + requisitos + convenios,
    )
  );
}
