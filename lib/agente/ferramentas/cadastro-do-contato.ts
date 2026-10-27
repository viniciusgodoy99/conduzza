// Ferramenta consultar_cadastro_do_contato do agente de IA (AG3,
// 27/10/2026): SO SINAIS do cadastro da pessoa desta conversa, para o modelo
// saber o que perguntar (se o cadastro ja tem convenio, se a pessoa ja tem
// consulta marcada). PURO: a definicao, a entrada e a saida. Quem le o
// cadastro e lib/agente/agenda.ts (pelo servidor, com o clinic_id e o
// contato da conversa, nunca do modelo).
//
// LGPD (minimizacao): vai ao modelo se e lead ou paciente, se o nome do
// cadastro e confirmado (alguem da equipe escreveu, veio de importacao ou de
// uma marcacao aprovada) ou e o do WhatsApp, se TEM nascimento e se TEM CPF
// (nunca os valores), o convenio cadastrado (nome e plano, do Cadastro de
// convenios) e QUANTAS consultas futuras. Nunca o nome, o CPF, a carteirinha,
// o e-mail, o telefone nem a data. Os dados exigidos sao pedidos mesmo com
// o cadastro preenchido (decisao da migration 20261027120000): estes sinais
// nao trocam o pedido.

import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import type { TipoDoContato } from "@/lib/domain/agente/config";

import type { CatalogoDoAgente } from "./buscar-procedimento";

export const NOME_DO_CADASTRO_DO_CONTATO = "consultar_cadastro_do_contato";

export const entradaDoCadastroDoContatoSchema = z.object({}).strict();

export const FERRAMENTA_CONSULTAR_CADASTRO_DO_CONTATO: FunctionTool = {
  type: "function",
  name: NOME_DO_CADASTRO_DO_CONTATO,
  strict: true,
  description:
    "Consulta sinais do cadastro da pessoa desta conversa: se é lead ou paciente, se o nome do cadastro é confirmado, se o cadastro tem data de nascimento e CPF (nunca os valores), o convênio cadastrado e quantas consultas futuras ela tem.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

/** O nome do cadastro: escrito por alguem, o do WhatsApp ou vazio. */
export type NomeDoCadastro = "confirmado" | "do_whatsapp" | "sem_nome";

/** O que o servidor le do cadastro (so sinais e o id do convenio). */
export type CadastroDoContato = {
  tipo: TipoDoContato | null;
  nome: NomeDoCadastro;
  temNascimento: boolean;
  temCpf: boolean;
  /** contact.insurance_id (vira nome e plano pelo Cadastro de convenios). */
  convenioId: string | null;
  /** Consultas futuras ativas (nao canceladas, nem recusadas). */
  consultasFuturas: number;
  /** No simulador nao ha contato: os sinais sao os do "Testar como". */
  simulado?: boolean;
};

/**
 * O nome do cadastro pelo criterio do banco (aplicar_dados_na_aprovacao):
 * vazio; confirmado quando veio de importacao, quando alguem da equipe
 * criou ou editou o contato (a trilha) ou quando um nome informado ja foi
 * aplicado; senao, o do WhatsApp.
 */
export function nomeDoCadastro(entrada: {
  /** O cadastro tem nome (contado pelo banco: o valor nunca e lido). */
  temNome: boolean;
  criadoPorImportacao: boolean;
  escritoPorAlguem: boolean;
}): NomeDoCadastro {
  if (!entrada.temNome) {
    return "sem_nome";
  }
  return entrada.criadoPorImportacao || entrada.escritoPorAlguem
    ? "confirmado"
    : "do_whatsapp";
}

/** A saida para o modelo (so sinais) e o passo da trilha. */
export function saidaDoCadastroDoContato(
  catalogo: Pick<CatalogoDoAgente, "conveniosDoCadastro" | "convenios">,
  cadastro: CadastroDoContato,
): { saida: Record<string, unknown>; passo: string } {
  const convenio =
    cadastro.convenioId === null
      ? null
      : ([...catalogo.conveniosDoCadastro, ...catalogo.convenios].find(
          (c) => c.id === cadastro.convenioId,
        ) ?? null);
  const consultas = Math.max(0, Math.floor(cadastro.consultasFuturas));
  return {
    saida: {
      tipo: cadastro.tipo,
      nome_no_cadastro: cadastro.nome,
      tem_data_de_nascimento: cadastro.temNascimento,
      tem_cpf: cadastro.temCpf,
      convenio_cadastrado:
        convenio === null ? null : { nome: convenio.nome, plano: convenio.plano },
      consultas_futuras: consultas,
      ...(cadastro.simulado === true ? { simulado: true } : {}),
    },
    passo:
      cadastro.simulado === true
        ? "Consultou o cadastro da pessoa: no simulador não há cadastro de contato."
        : `Consultou o cadastro da pessoa (${cadastro.tipo === "paciente" ? "paciente" : cadastro.tipo === "lead" ? "lead" : "sem tipo"}, ${consultas === 1 ? "1 consulta futura" : `${consultas} consultas futuras`})`,
  };
}
