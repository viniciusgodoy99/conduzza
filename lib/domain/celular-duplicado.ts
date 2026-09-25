import { chaveDeTelefone } from "@/lib/domain/telefone";

// Trava contra o MESMO celular pareado em duas instancias (achado 10 do
// docs/07_multiplos_numeros_whatsapp.md). O WhatsApp aceita o mesmo celular
// como aparelho conectado em mais de uma instancia, e cada uma entrega a
// mesma mensagem recebida: a conversa do paciente duplicaria, e entre
// clinicas diferentes a clinica errada leria a conversa (risco LGPD). A
// conexao nova e recusada no instante em que chega "conectado".
//
// PURO, zero I/O: a trava (lib/integrations/whatsapp/trava-celular.ts, usada
// pelas acoes de conexao e pelo evento de conexao do webhook) le os numeros
// conectados e decide com estas funcoes;
// tests/unit/whatsapp/celular-duplicado.test.ts prova a decisao.

/**
 * Chave canonica do celular pareado, para comparar. Nulo quando o valor nao
 * e telefone: instancias pareadas antes da correcao do parse guardavam o NOME
 * do perfil em display_phone, e nome nao se compara com numero.
 *
 * O provedor guarda so digitos ("558499990000"); o simulador guarda
 * formatado ("+55 84 98888-0001"). Os dois viram a mesma chave de
 * chaveDeTelefone, que da o nono digito ao celular brasileiro antigo.
 */
export function chaveDoCelularPareado(
  bruto: string | null | undefined,
): string | null {
  const texto = bruto?.trim() ?? "";
  if (texto === "" || !/^[+\d\s().-]+$/.test(texto)) {
    return null;
  }
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 15) {
    return null;
  }
  return chaveDeTelefone(`+${digitos}`);
}

/** Um numero CONECTADO de qualquer clinica, como a busca o devolve. */
export type NumeroConectado = {
  id: string;
  clinic_id: string;
  nome: string;
  display_phone: string | null;
};

export type CelularDuplicado =
  { mesmaClinica: true; nome: string } | { mesmaClinica: false };

/**
 * O outro numero que ja esta com este celular, ou nulo.
 *
 * Da mesma clinica tem precedencia: a mensagem diz qual numero e, e a
 * clinica resolve sozinha. De outra clinica, a mensagem nao diz nada sobre
 * ela (nem nome, nem que clinica e).
 */
export function acharCelularDuplicado(
  alvo: {
    accountId: string;
    clinicId: string;
    displayPhone: string | null | undefined;
  },
  conectados: readonly NumeroConectado[],
): CelularDuplicado | null {
  const chave = chaveDoCelularPareado(alvo.displayPhone);
  if (chave === null) {
    return null;
  }
  const mesmos = conectados.filter(
    (numero) =>
      numero.id !== alvo.accountId &&
      chaveDoCelularPareado(numero.display_phone) === chave,
  );
  const daClinica = mesmos.find((numero) => numero.clinic_id === alvo.clinicId);
  if (daClinica) {
    return { mesmaClinica: true, nome: daClinica.nome };
  }
  return mesmos.length > 0 ? { mesmaClinica: false } : null;
}

export function mensagemDeCelularDuplicado(
  duplicado: CelularDuplicado,
): string {
  return duplicado.mesmaClinica
    ? `Este número já está conectado como ${duplicado.nome}.`
    : "Este número já está conectado em outra conta do Conduzza. Fale com o suporte.";
}

/**
 * A conferencia so vale para PAREAMENTO NOVO: o numero nao estava conectado,
 * ou estava com outro celular. Um numero que ja estava conectado com este
 * mesmo celular nao e conferido de novo, senao a verificacao de rotina
 * derrubaria o numero mais ANTIGO quando o duplicado aparecesse em outro
 * lugar (quem chega depois e que e recusado).
 */
export function pareamentoNovo(
  anterior: { connection_status: string; display_phone: string | null },
  displayPhone: string | null | undefined,
): boolean {
  const chave = chaveDoCelularPareado(displayPhone);
  if (chave === null) {
    return false;
  }
  return (
    anterior.connection_status !== "conectado" ||
    chaveDoCelularPareado(anterior.display_phone) !== chave
  );
}
