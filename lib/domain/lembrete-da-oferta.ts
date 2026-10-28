import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

import { renderizarModelo } from "@/lib/domain/modelo-mensagem";

// O lembrete da oferta da lista de espera (AG5, desenho 1.6 e 4.3; decisao
// D-39 e o texto T-E4 da D-40, as duas pela recomendacao, pendentes do
// dono). Modulo PURO: o interceptador (lib/integrations/whatsapp/
// interceptar-resposta.ts) decide e enfileira; o teste da conformidade roda
// o texto preenchido no filtro inteiro.
//
// Quando sai: a pessoa esta numa conversa com a IA, a oferta da reoferta
// automatica e a pergunta de pe para ela (a mais recente que o sistema fez,
// pelo numero que recebeu, ou a citada) e ela escreveu outra coisa, nem SIM
// nem NAO QUERO. O SISTEMA responde com este texto fixo, uma vez por oferta e
// contato, e a IA nao responde aquela mensagem. Quem aceita ou recusa a
// oferta continua sendo o interceptador, nunca a IA.
//
// O lembrete sai pela fila (enviar_mensagem_ativa, resposta_ao_paciente): o
// executor reconfere a autorizacao para receber mensagens e grava o custo,
// como todo eco. Autor sistema: ele NAO fecha o contexto da oferta (so a
// fala de gente, usuario ou ia, fecha), entao o SIM seguinte continua sendo
// do interceptador.
//
// Sem "vaga", sem promessa e sem travessao. O prazo e so a hora: a janela de
// resposta da clinica vai de 5 a 240 minutos (CHECK de
// clinic.waitlist_response_minutes), entao "ate as 10:30" e sempre o proximo
// 10:30, nunca outro dia.

/** T-E4: data e hora do horario oferecido e a hora em que a oferta vence. */
export const LEMBRETE_DA_OFERTA =
  "Sobre o horário de {{data}} às {{hora}}: para ficar com ele, responda SIM até as {{prazo}}. Se não quiser, responda NÃO QUERO, que você continua na lista de espera.";

/**
 * A chave do payload do job do lembrete (enviar_mensagem_ativa): o id da
 * oferta. E por ela que o interceptador sabe que o lembrete desta oferta ja
 * saiu para o contato (uma vez por oferta e contato) e que a citacao do
 * lembrete vale como citacao da oferta. O lembrete NUNCA leva offer_id: ele
 * nao e a mensagem da oferta (envioDaOferta e situacaoDoEnvioDeOferta nao o
 * contam).
 */
export const CHAVE_DO_LEMBRETE = "lembrete_da_oferta";

/** O que o texto precisa da oferta, no fuso da clinica (CLAUDE.md 3.6). */
export type DadosDoLembrete = {
  /** waitlist_offer.slot_starts_at */
  inicioDoHorario: string;
  /** waitlist_offer.expires_at */
  venceEm: string;
  /** clinic.timezone */
  fuso: string;
};

/** O T-E4 preenchido: data e hora do horario e a hora do prazo, no fuso. */
export function textoDoLembreteDaOferta(dados: DadosDoLembrete): string {
  const inicio = new TZDate(
    new Date(dados.inicioDoHorario).getTime(),
    dados.fuso,
  );
  const prazo = new TZDate(new Date(dados.venceEm).getTime(), dados.fuso);
  return renderizarModelo(LEMBRETE_DA_OFERTA, {
    data: format(inicio, "dd/MM/yyyy"),
    hora: format(inicio, "HH:mm"),
    prazo: format(prazo, "HH:mm"),
  });
}

/** A oferta como o interceptador a le (waitlist_offer). */
export type OfertaDoLembrete = {
  status: string;
  expires_at: string;
  declined_by: string[] | null;
};

/**
 * A oferta ainda pergunta algo a ESTE contato: aberta, dentro do prazo e sem
 * a recusa dele. Fora disso nao ha o que lembrar (a mensagem fica com quem
 * atende, a IA).
 */
export function ofertaDePeParaOContato(
  oferta: OfertaDoLembrete,
  contactId: string,
  agoraMs: number,
): boolean {
  return (
    oferta.status === "aberta" &&
    new Date(oferta.expires_at).getTime() > agoraMs &&
    !(oferta.declined_by ?? []).includes(contactId)
  );
}
