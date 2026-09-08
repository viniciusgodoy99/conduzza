// Catalogo dos eventos de conversao padrao da Meta (pixel/CAPI), com rotulo em
// linguagem de recepcao. E o mesmo catalogo que o Tintim mostra ao editar uma
// etapa da Jornada de Compra (docs/06 secao 2.4), e a coluna
// funnel_conversion_map.meta_event_name e texto livre de proposito: evento
// personalizado nao exige migration, so nao aparece nesta lista.
//
// Modulo puro, sem I/O: alimenta a tela do mapa de conversao (R2) e sera
// reusado pelo disparo (R4) e pelas configuracoes da Meta (R6).

export type EventoMeta = {
  /** o event_name EXATO que a Meta espera; sensivel a maiusculas */
  nome: string;
  /** como a recepcao le */
  rotulo: string;
};

// Os 17 eventos padrao do pixel da Meta. A ordem aqui e a de UTILIDADE para
// clinica (os quatro primeiros sao os que o produto sugere no docs/06), nao a
// alfabetica: o Select mostra primeiro o que a pessoa provavelmente quer.
export const EVENTOS_META_PADRAO: readonly EventoMeta[] = [
  { nome: "Lead", rotulo: "Lead (novo interessado)" },
  { nome: "Contact", rotulo: "Contato (falou com a clínica)" },
  { nome: "Schedule", rotulo: "Agendamento (Schedule)" },
  { nome: "Purchase", rotulo: "Compra (Purchase)" },
  { nome: "ViewContent", rotulo: "Visualização de conteúdo" },
  { nome: "InitiateCheckout", rotulo: "Início de finalização de compra" },
  { nome: "AddToCart", rotulo: "Adição ao carrinho" },
  { nome: "AddToWishlist", rotulo: "Adição à lista de desejos" },
  { nome: "AddPaymentInfo", rotulo: "Dados de pagamento informados" },
  { nome: "CompleteRegistration", rotulo: "Cadastro concluído" },
  { nome: "Subscribe", rotulo: "Assinatura" },
  { nome: "StartTrial", rotulo: "Início de período de teste" },
  { nome: "SubmitApplication", rotulo: "Envio de inscrição" },
  { nome: "Search", rotulo: "Busca" },
  { nome: "FindLocation", rotulo: "Busca de localização" },
  { nome: "CustomizeProduct", rotulo: "Personalização de produto" },
  { nome: "Donate", rotulo: "Doação" },
] as const;

/** O evento e um dos 17 padrao? (personalizado e permitido, so nao esta aqui) */
export function ehEventoPadrao(nome: string): boolean {
  return EVENTOS_META_PADRAO.some((evento) => evento.nome === nome);
}

/** Rotulo de leitura para qualquer evento, inclusive personalizado. */
export function rotuloDoEvento(nome: string): string {
  return (
    EVENTOS_META_PADRAO.find((evento) => evento.nome === nome)?.rotulo ?? nome
  );
}
