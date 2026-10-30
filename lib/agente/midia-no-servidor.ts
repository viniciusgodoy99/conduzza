import "server-only";

import type { MidiaNoServidor } from "@/lib/domain/agente/config";
import {
  TETO_DE_TOKENS_POR_IMAGEM,
  TETO_DE_TOKENS_POR_PAGINA,
} from "@/lib/integrations/llm/leitor-de-midia";
import { TRANSCRICAO_CALIBRADA } from "@/lib/integrations/llm/transcricao";

// [AG6b mídia] (arquivo novo da revisao das telas da AG6b, item 3)
//
// O audio, a foto e o documento ja valem no servidor? Ate a prova paga
// (D-100), TRANSCRICAO_CALIBRADA e falsa e os tetos de tokens do leitor sao
// nulos: o plano do turno (planejarMidiasDoTurno e tokensDoArquivoNaReserva,
// lib/agente/midia.ts) marca todo audio, foto e documento como fora, e a
// conversa vai para a equipe, mesmo com "Entender áudio" e "Ler imagem e
// documento" ligadas. A Tela 6 mostra isso na habilidade (a dica de
// TEXTOS_DA_MIDIA), em vez de um "Ligada" sem efeito.
//
// So as CONSTANTES da calibragem: este arquivo nunca chama o SDK, e e
// server-only para o SDK (que os dois modulos importam) nunca ir ao
// navegador; a pagina calcula e manda so os dois booleanos. O que depende do
// ambiente ou do banco (o modelo da transcricao fora da lista, o preco por
// minuto, o modelo do leitor) o turno confere de novo, e falha fechada.

/** As constantes da calibragem (os testes passam outras). */
export type CalibragemDaMidia = {
  transcricaoCalibrada: boolean;
  tetoPorImagem: number | null;
  tetoPorPagina: number | null;
};

export const CALIBRAGEM_DO_SERVIDOR: CalibragemDaMidia = {
  transcricaoCalibrada: TRANSCRICAO_CALIBRADA,
  tetoPorImagem: TETO_DE_TOKENS_POR_IMAGEM,
  tetoPorPagina: TETO_DE_TOKENS_POR_PAGINA,
};

/**
 * O que vale no servidor: o audio, com a transcricao calibrada; a foto e o
 * documento, so com os DOIS tetos (a imagem e a pagina do PDF), o lado
 * conservador. Os dois sao medidos na mesma prova; com um so, parte dos
 * arquivos continuaria indo para a equipe, e a dica continua.
 */
export function midiaNoServidor(
  calibragem: CalibragemDaMidia = CALIBRAGEM_DO_SERVIDOR,
): MidiaNoServidor {
  return {
    audio: calibragem.transcricaoCalibrada,
    arquivo: calibragem.tetoPorImagem !== null && calibragem.tetoPorPagina !== null,
  };
}
