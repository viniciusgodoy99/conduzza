"use server";

import { z } from "zod";

import { getSessionContext } from "@/lib/auth/active-clinic";
import type { EsperandoPorNumero } from "@/lib/domain/conexao-dos-numeros";
import {
  contarMensagensEsperando,
  MAX_NUMEROS_CONTADOS,
} from "@/lib/queries/mensagens-esperando";
import { createAdminClient } from "@/lib/supabase/admin";

// A faixa de desconectado (components/shell/whatsapp-status.tsx) pergunta
// quantas mensagens automaticas esperam por cada numero fora do ar. Qualquer
// membro ativo da clinica ve a faixa, entao qualquer membro pergunta; a
// resposta e so a contagem, da clinica ATIVA da sessao (um id de numero de
// outra clinica conta zero, porque a consulta filtra pela clinica).

const entradaSchema = z.array(z.uuid()).max(MAX_NUMEROS_CONTADOS);

export async function contarMensagensEsperandoAction(
  numeroIds: string[],
): Promise<EsperandoPorNumero> {
  const entrada = entradaSchema.safeParse(numeroIds);
  if (!entrada.success || entrada.data.length === 0) {
    return {};
  }
  const context = await getSessionContext();
  if (!context?.active) {
    return {};
  }
  try {
    return await contarMensagensEsperando(
      createAdminClient(),
      context.active.clinicId,
      entrada.data,
    );
  } catch {
    // Sem contagem, a faixa fica com o texto sem a fila: nunca quebra.
    return {};
  }
}
