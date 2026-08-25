// Importacao de planilha (Tela 4): normalizacao de telefone, validacao de
// linha mapeada e divisao em lotes. PURO, zero I/O: quem le o arquivo e a
// tela (lib/utils/csv.ts) e quem grava e a Server Action, em lotes.

export type LinhaImportada = {
  name: string | null;
  phone_e164: string;
  email: string | null;
  insurance_name: string | null;
  source_campaign: string | null;
};

// DDD brasileiro: dois digitos, nenhum deles zero.
const DDD_REGEX = /^[1-9][1-9]$/;

/**
 * Numero nacional (sem +55): remove o zero de operadora e aceita DDD + 9
 * digitos de celular (o terceiro digito e 9) ou DDD + 8 digitos de fixo
 * (primeiro digito local 2 a 9). Sem DDD nao ha como montar E.164: null.
 */
function normalizarNacional(digitos: string): string | null {
  let nacional = digitos;
  while (nacional.startsWith("0")) {
    nacional = nacional.slice(1);
  }
  if (!DDD_REGEX.test(nacional.slice(0, 2))) {
    return null;
  }
  const local = nacional.slice(2);
  const celular = local.length === 9 && /^9\d{8}$/.test(local);
  const fixo = local.length === 8 && /^[2-9]\d{7}$/.test(local);
  if (!celular && !fixo) {
    return null;
  }
  return `+55${nacional}`;
}

/**
 * Telefone bruto de planilha em E.164. Aceita os formatos brasileiros
 * comuns: com ou sem +55, com ou sem DDD explicito no prefixo 55, com ou
 * sem o nono digito (fixo de 8 digitos vale), com pontuacao e espacos.
 * Numero internacional ja em E.164 (+ e 8 a 15 digitos, sem zero a
 * esquerda) passa direto. Irrecuperavel (letras, curto demais, DDD
 * invalido) devolve null e a linha e reportada, nunca chutada.
 */
export function normalizarTelefone(bruto: string): string | null {
  const texto = bruto.trim();
  if (texto === "" || /[a-z]/i.test(texto)) {
    return null;
  }
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length === 0) {
    return null;
  }

  if (texto.startsWith("+")) {
    if (digitos.startsWith("55")) {
      return normalizarNacional(digitos.slice(2));
    }
    return /^[1-9]\d{7,14}$/.test(digitos) ? `+${digitos}` : null;
  }

  // Sem +: pode vir com o 55 do pais na frente (12 ou 13 digitos). Com 11
  // digitos, 55 e DDD valido (regiao de Santa Maria), nao prefixo de pais.
  if (
    digitos.startsWith("55") &&
    (digitos.length === 12 || digitos.length === 13)
  ) {
    return normalizarNacional(digitos.slice(2));
  }
  return normalizarNacional(digitos);
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
