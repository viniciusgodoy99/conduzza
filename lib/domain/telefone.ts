// Telefone: a UNICA regra de identidade de numero do sistema. PURO, zero I/O.
//
// O problema que isto resolve: o WhatsApp entrega o celular de muitos DDDs
// SEM o nono digito (+558599990000), e quem digita o numero na recepcao
// escreve COM ele (+5585999990000). Comparando texto exato, a mesma pessoa
// virava dois contatos: a resposta "1" ao toque de confirmacao caia no
// contato errado e a consulta ficava aguardando para sempre.
//
// Tres funcoes, tres papeis:
//  - normalizarTelefone: entrada HUMANA (formulario, planilha) para E.164.
//    Guarda o numero como foi digitado, so que limpo; nao inventa digito.
//  - chaveDeTelefone: a forma CANONICA para comparar dois numeros. Celular
//    brasileiro antigo (8 digitos, comecando em 6 a 9) ganha o 9. Fixo e
//    estrangeiro ficam iguais.
//  - formatarTelefone: exibicao "(85) 99999-0000".
//
// ESPELHO NO BANCO: public.chave_telefone(text) aplica EXATAMENTE a mesma
// regra de chaveDeTelefone e alimenta a coluna gerada contact.phone_key, que
// tem indice unico por clinica. Mudou a regra aqui, muda la (migration nova)
// e o teste tests/unit/domain/telefone.test.ts, senao a tela e o banco
// discordam sobre quem e a mesma pessoa.

/**
 * DDDs que existem no Brasil (plano de numeracao da Anatel). "Dois digitos sem
 * zero" aceitaria 23, 25, 26, 29, 36, 39, 52, 56 a 59, 72, 76 e 78, que nao
 * existem: um erro de digitacao passaria como numero valido.
 */
// prettier-ignore
export const DDDS_VALIDOS: ReadonlySet<string> = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

/**
 * Numero nacional (sem +55): remove o zero de operadora e aceita DDD + 9
 * digitos de celular (o primeiro digito local e 9) ou DDD + 8 digitos (fixo
 * de 2 a 5, ou celular no formato antigo de 6 a 9, que e como o WhatsApp
 * ainda entrega muitos numeros). Sem DDD valido nao ha E.164: null.
 */
function normalizarNacional(digitos: string): string | null {
  let nacional = digitos;
  while (nacional.startsWith("0")) {
    nacional = nacional.slice(1);
  }
  if (!DDDS_VALIDOS.has(nacional.slice(0, 2))) {
    return null;
  }
  const local = nacional.slice(2);
  const celular = local.length === 9 && /^9\d{8}$/.test(local);
  const oitoDigitos = local.length === 8 && /^[2-9]\d{7}$/.test(local);
  if (!celular && !oitoDigitos) {
    return null;
  }
  return `+55${nacional}`;
}

/**
 * Telefone digitado ou colado por uma pessoa, em E.164. Aceita os formatos
 * brasileiros comuns: "(85) 99999-0000", "+55 85 99999-0000" colado do
 * WhatsApp Web, "085 99999-0000" com zero de operadora, com ou sem o 55 do
 * pais, com pontuacao e espacos. Numero internacional ja em E.164 (+ e 8 a 15
 * digitos, sem zero a esquerda) passa direto. Irrecuperavel (letras, curto
 * demais, DDD que nao existe) devolve null: o chamador recusa com mensagem,
 * nunca chuta.
 *
 * Idempotente: normalizar um E.164 valido devolve o mesmo E.164.
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

// +55, DDD e numero local de 8 digitos comecando em 6 a 9: celular no formato
// anterior ao nono digito. O DDD e conferido contra a lista a parte.
const CELULAR_SEM_NONO_DIGITO = /^\+55(\d{2})([6-9]\d{7})$/;

/**
 * Forma canonica de um telefone E.164, para COMPARAR: dois numeros sao a
 * mesma pessoa se e so se a chave e igual. Celular brasileiro sem o nono
 * digito ganha o 9; todo o resto (celular que ja tem o 9, fixo de 2 a 5,
 * estrangeiro, qualquer coisa fora do padrao) volta igual.
 *
 * Nao e o numero que se GRAVA: o contato guarda a forma que o WhatsApp
 * entregou (a que com certeza recebe mensagem) e a chave serve so para achar.
 */
export function chaveDeTelefone(e164: string): string {
  const partes = CELULAR_SEM_NONO_DIGITO.exec(e164);
  if (!partes) {
    return e164;
  }
  const [, ddd, local] = partes;
  if (!ddd || !local || !DDDS_VALIDOS.has(ddd)) {
    return e164;
  }
  return `+55${ddd}9${local}`;
}

/** Mensagem unica de telefone recusado, para toda porta de entrada humana. */
export const MENSAGEM_TELEFONE_INVALIDO =
  "Telefone inválido. Informe com DDD, por exemplo (85) 99999-0000.";

/**
 * Mensagem unica de duplicado: diz QUEM ja tem o numero, para a recepcao
 * abrir o cadastro certo em vez de criar outro.
 */
export function mensagemDeTelefoneDuplicado(
  nomeExistente: string | null,
): string {
  const nome = nomeExistente?.trim();
  return nome
    ? `Já existe um contato com este telefone: ${nome}.`
    : "Já existe um contato com este telefone (cadastro sem nome).";
}

/** Os dois telefones sao a mesma pessoa (mesma chave canonica)? */
export function mesmoTelefone(a: string, b: string): boolean {
  return chaveDeTelefone(a) === chaveDeTelefone(b);
}

/**
 * Telefone para EXIBIR: "(85) 99999-0000" ou "(85) 3222-0000". Mostra a forma
 * canonica, com o nono digito, porque e o numero que uma pessoa discaria hoje:
 * exibir "+558588887777" cru levava a recepcao a "corrigir" o numero achando
 * que faltava o 9. Estrangeiro ou fora do padrao volta como esta.
 */
export function formatarTelefone(e164: string): string {
  const chave = chaveDeTelefone(e164);
  const partes = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(chave);
  if (!partes) {
    return e164;
  }
  const [, ddd, inicio, fim] = partes;
  if (!ddd || !inicio || !fim || !DDDS_VALIDOS.has(ddd)) {
    return e164;
  }
  return `(${ddd}) ${inicio}-${fim}`;
}
