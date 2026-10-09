import type { DadosDoPainel, VersaoDoAgente } from "@/components/agente/tipos";
import {
  configPadraoDoAgente,
  type ConfigDoAgente,
  type ItemDaBase,
} from "@/lib/domain/agente/config";

// Dados de exemplo dos testes de tela do Agente de IA (Tela 6). Nada aqui e
// dado de paciente: perguntas da recepcao e nomes ficticios.

export const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
export const FUSO = "America/Fortaleza";

export const DICA_RECEPCAO =
  "Somente administradores e gestores alteram o agente de IA";

export const ITEM_ATIVO: ItemDaBase = {
  id: "11111111-1111-4111-8111-111111111111",
  pergunta: "Tem estacionamento?",
  resposta: "Sim, temos estacionamento gratuito para pacientes.",
  ativo: true,
};

export const ITEM_INATIVO: ItemDaBase = {
  id: "22222222-2222-4222-8222-222222222222",
  pergunta: "Aceitam cartão?",
  resposta: "Aceitamos cartão de crédito e de débito.",
  ativo: false,
};

export function configDeTeste(
  campos: Partial<ConfigDoAgente> = {},
): ConfigDoAgente {
  return {
    ...configPadraoDoAgente(),
    nome: "Ana",
    saudacao: "Olá! Aqui é a recepção.",
    encerramento: null,
    ...campos,
  };
}

export const VERSAO_2: VersaoDoAgente = {
  versao: 2,
  // 17:05 UTC = 14:05 em Fortaleza (UTC-3)
  publicadaEm: "2026-10-06T17:05:00.000Z",
  autor: "Vinicius",
  mudancas: [{ campo: "tom", rotulo: "Tom de voz: Formal" }],
  emUso: true,
};

export const VERSAO_1: VersaoDoAgente = {
  versao: 1,
  // 02:30 UTC do dia 05 = 23:30 do dia 04 em Fortaleza
  publicadaEm: "2026-10-05T02:30:00.000Z",
  autor: null,
  mudancas: [
    { campo: "primeira_publicacao", rotulo: "Primeira versão do assistente" },
  ],
  emUso: false,
};

export function dadosDeTeste(
  campos: Partial<DadosDoPainel> = {},
): DadosDoPainel {
  const config = campos.config ?? configDeTeste({ base: [ITEM_ATIVO] });
  return {
    clinicId: CLINICA,
    timezone: FUSO,
    config,
    temRascunho: true,
    publicada: null,
    base: [ITEM_ATIVO, ITEM_INATIVO],
    versoes: [],
    instrucoesMudaram: false,
    podeEditar: true,
    dicaSemPermissao: null,
    superAdmin: false,
    previaDoPrompt: null,
    motivoDoSimulador: null,
    ...campos,
  };
}
