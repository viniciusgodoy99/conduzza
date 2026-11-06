import "server-only";

import type { MidiaNoServidor } from "@/lib/domain/agente/config";
import {
  TETO_DE_TOKENS_POR_IMAGEM,
  TETO_DE_TOKENS_POR_PAGINA,
} from "@/lib/integrations/llm/leitor-de-midia";
import { TRANSCRICAO_CALIBRADA } from "@/lib/integrations/llm/transcricao";

// [AG6b mídia] (arquivo novo da revisao das telas da AG6b, item 3)
//
// O audio, a foto e o documento ja valem no servidor? Desde a decisao do dono
// de 06/11/2026, sim. Com TRANSCRICAO_CALIBRADA falsa ou os tetos de tokens do
// leitor nulos, o plano do turno (planejarMidiasDoTurno e
// tokensDoArquivoNaReserva, lib/agente/midia.ts) marca o audio, a foto e o
// documento como fora, e a conversa vai para a equipe, mesmo com "Entender
// áudio" e "Ler imagem e documento" ligadas. A Tela 6 mostra isso na
// habilidade (a dica de TEXTOS_DA_MIDIA), em vez de um "Ligada" sem efeito.
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
 * documento, com QUALQUER um dos tetos (a imagem ou a pagina do PDF).
 *
 * Revisao R3 de d1a15f6 (3): a dica "Ainda nao esta valendo" diz que foto e
 * documento vao para a equipe, entao so aparece quando NADA do grupo sai do
 * servidor. O plano do turno libera cada tipo pelo seu teto
 * (tokensDoArquivoNaReserva, lib/agente/midia.ts): com so o teto da imagem,
 * a foto ja vai para a OpenAI, e a dica com os dois tetos exigidos
 * prometia uma privacidade que o servidor nao cumpria. A tela nunca promete
 * mais privacidade do que o servidor cumpre: com um teto so, sem dica (o
 * PDF ainda vai para a equipe, o lado que so protege mais).
 */
export function midiaNoServidor(
  calibragem: CalibragemDaMidia = CALIBRAGEM_DO_SERVIDOR,
): MidiaNoServidor {
  return {
    audio: calibragem.transcricaoCalibrada,
    arquivo: calibragem.tetoPorImagem !== null || calibragem.tetoPorPagina !== null,
  };
}
