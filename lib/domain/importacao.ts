// Importacao de planilha (Tela 4): normalizacao de telefone, validacao de
// linha mapeada e divisao em lotes. PURO, zero I/O: quem le o arquivo e a
// tela (lib/utils/csv.ts) e quem grava e a Server Action, em lotes.

import { normalizarTelefone as normalizarTelefoneUnico } from "@/lib/domain/telefone";

export type LinhaImportada = {
  name: string | null;
  phone_e164: string;
  email: string | null;
  insurance_name: string | null;
  source_campaign: string | null;
};

/**
 * Telefone bruto de planilha em E.164. A regra mora em lib/domain/telefone.ts
 * (a normalizacao UNICA de entrada humana: importacao, novo lead, ficha e
 * cadastro rapido da Agenda passam todos por ela). Mantida aqui com a mesma
 * assinatura porque a tela da importacao, o novo lead e a ficha importam
 * deste modulo. Irrecuperavel devolve null e a linha e reportada, nunca
 * chutada.
 */
export function normalizarTelefone(bruto: string): string | null {
  return normalizarTelefoneUnico(bruto);
}

/** Campos de LinhaImportada que o mapeamento de colunas pode apontar. */
export type CampoImportavel = keyof LinhaImportada;

/**
 * Valida uma linha ja separada em colunas contra o mapeamento escolhido na
 * tela (campo da ficha para indice da coluna; null quando a planilha nao tem
 * aquele campo). Telefone e obrigatorio e precisa normalizar em E.164; o
 * resto entra como veio, aparado, vazio vira null.
 */
export function validarLinha(
  colunas: string[],
  mapeamento: Record<string, number | null>,
): { ok: true; linha: LinhaImportada } | { ok: false; motivo: string } {
  const valorDe = (campo: CampoImportavel): string | null => {
    const indice = mapeamento[campo];
    if (indice === null || indice === undefined) {
      return null;
    }
    const bruto = colunas[indice];
    if (bruto === undefined) {
      return null;
    }
    const aparado = bruto.trim();
    return aparado === "" ? null : aparado;
  };

  const telefoneBruto = valorDe("phone_e164");
  if (telefoneBruto === null) {
    return { ok: false, motivo: "Linha sem telefone" };
  }
  const telefone = normalizarTelefone(telefoneBruto);
  if (telefone === null) {
    return { ok: false, motivo: "Telefone inválido" };
  }

  return {
    ok: true,
    linha: {
      name: valorDe("name"),
      phone_e164: telefone,
      email: valorDe("email"),
      insurance_name: valorDe("insurance_name"),
      source_campaign: valorDe("source_campaign"),
    },
  };
}

/**
 * Divide a lista em lotes de ate `tamanho` itens, na ordem original. A
 * importacao grava lote a lote para dar progresso real na tela e nao
 * estourar o limite de uma chamada so.
 */
export function dividirEmLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  if (!Number.isInteger(tamanho) || tamanho < 1) {
    throw new Error("Tamanho de lote precisa ser inteiro maior que zero");
  }
  const lotes: T[][] = [];
  for (let inicio = 0; inicio < itens.length; inicio += tamanho) {
    lotes.push(itens.slice(inicio, inicio + tamanho));
  }
  return lotes;
}
