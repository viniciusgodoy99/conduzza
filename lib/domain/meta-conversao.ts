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
  /** como a recepcao le: em portugues, com o nome da Meta entre parenteses */
  rotulo: string;
  /** quando usar, numa frase curta; so nos que a clinica mais usa */
  quandoUsar?: string;
};

// Os 17 eventos padrao do pixel da Meta. A ordem aqui e a de UTILIDADE para
// clinica (os quatro primeiros sao os que o produto sugere no docs/06), nao a
// alfabetica: o Select mostra primeiro o que a pessoa provavelmente quer.
// Rotulo "Portugues (NomeDaMeta)" (pedido do dono em 24/11/2026, "tipo o
// Compra (Purchase)"): a clinica entende o que e, e acha o mesmo nome no
// Gerenciador de Eventos da Meta.
export const EVENTOS_META_PADRAO: readonly EventoMeta[] = [
  {
    nome: "Lead",
    rotulo: "Novo interessado (Lead)",
    quandoUsar: "Chegou um contato novo.",
  },
  // Contact saiu dos mais usados em 24/11/2026: a Meta nao o aceita no
  // anuncio que abre o WhatsApp (EVENTOS_DO_WHATSAPP, abaixo).
  { nome: "Contact", rotulo: "Contato (Contact)" },
  {
    nome: "Schedule",
    rotulo: "Agendamento (Schedule)",
    quandoUsar: "A pessoa marcou uma consulta.",
  },
  {
    nome: "Purchase",
    rotulo: "Compra (Purchase)",
    quandoUsar: "A pessoa virou paciente ou pagou. É o que a Meta usa para achar quem compra.",
  },
  { nome: "ViewContent", rotulo: "Visualização de conteúdo (ViewContent)" },
  {
    nome: "InitiateCheckout",
    rotulo: "Início da finalização da compra (InitiateCheckout)",
  },
  { nome: "AddToCart", rotulo: "Adição ao carrinho (AddToCart)" },
  { nome: "AddToWishlist", rotulo: "Adição à lista de desejos (AddToWishlist)" },
  {
    nome: "AddPaymentInfo",
    rotulo: "Dados de pagamento informados (AddPaymentInfo)",
  },
  {
    nome: "CompleteRegistration",
    rotulo: "Cadastro concluído (CompleteRegistration)",
  },
  { nome: "Subscribe", rotulo: "Assinatura (Subscribe)" },
  { nome: "StartTrial", rotulo: "Início do período de teste (StartTrial)" },
  { nome: "SubmitApplication", rotulo: "Envio de inscrição (SubmitApplication)" },
  { nome: "Search", rotulo: "Busca (Search)" },
  { nome: "FindLocation", rotulo: "Busca de localização (FindLocation)" },
  {
    nome: "CustomizeProduct",
    rotulo: "Personalização de produto (CustomizeProduct)",
  },
  { nome: "Donate", rotulo: "Doação (Donate)" },
] as const;

/**
 * Os que a clinica mais usa (com "quando usar"); o resto vai em "Outros". Os
 * tres valem tambem no anuncio que abre o WhatsApp (eventoNoWhatsapp).
 */
export const EVENTOS_MAIS_USADOS = EVENTOS_META_PADRAO.filter(
  (evento) => evento.quandoUsar,
);
export const OUTROS_EVENTOS = EVENTOS_META_PADRAO.filter(
  (evento) => !evento.quandoUsar,
);

export type ValorDaConversao = "sem" | "fixo" | "service_link";

/**
 * O recomendado para comecar (proposta aceita pelo dono em 24/11/2026; e o
 * que o Q5 manda sozinho): Novo = Lead, Agendou = Schedule e Compareceu =
 * Purchase com o preco da consulta. Pelo PAPEL da etapa, porque a clinica
 * pode renomear (a Salud Care renomeou a Em contato).
 */
export const CONVERSOES_RECOMENDADAS: readonly {
  papel: "entrada" | "agendou" | "compareceu";
  evento: string;
  valor: ValorDaConversao;
}[] = [
  { papel: "entrada", evento: "Lead", valor: "sem" },
  { papel: "agendou", evento: "Schedule", valor: "sem" },
  { papel: "compareceu", evento: "Purchase", valor: "service_link" },
];

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

export type EtapaParaORecomendado = {
  chave: string;
  nome: string;
  papel: string | null;
};

/**
 * O que "Usar o recomendado" preenche: so as etapas do recomendado que ainda
 * nao mandam nada. Nunca troca uma escolha da clinica. Vazio: nada a fazer.
 */
export function recomendadoParaAJornada(
  etapas: readonly EtapaParaORecomendado[],
  semEvento: (chave: string) => boolean,
): { chave: string; evento: string; valor: ValorDaConversao }[] {
  return CONVERSOES_RECOMENDADAS.flatMap((recomendado) => {
    const etapa = etapas.find((e) => e.papel === recomendado.papel);
    return etapa && semEvento(etapa.chave)
      ? [{ chave: etapa.chave, evento: recomendado.evento, valor: recomendado.valor }]
      : [];
  });
}

/**
 * O recomendado com os nomes que a clinica deu as etapas: "Novo interessado
 * (Lead) em Novo, Agendamento (Schedule) em Agendou e Compra (Purchase) em
 * Compareceu, com o preço da consulta."
 */
export function textoDoRecomendado(
  etapas: readonly EtapaParaORecomendado[],
): string {
  const partes = CONVERSOES_RECOMENDADAS.flatMap((recomendado) => {
    const etapa = etapas.find((e) => e.papel === recomendado.papel);
    if (!etapa) {
      return [];
    }
    const comValor =
      recomendado.valor === "service_link" ? ", com o preço da consulta" : "";
    return [`${rotuloDoEvento(recomendado.evento)} em ${etapa.nome}${comValor}`];
  });
  if (partes.length === 0) {
    return "";
  }
  const ultima = partes.pop()!;
  return `${partes.length > 0 ? `${partes.join(", ")} e ` : ""}${ultima}.`;
}

// ---------------------------------------------------------------------------
// O anuncio que abre o WhatsApp (revisao de 24/11/2026)
// ---------------------------------------------------------------------------
//
// O evento do lead que veio do anuncio clique-para-WhatsApp sai no formato
// "business_messaging", e nele a Meta aceita so estes eventos (doc oficial
// "Conversions API for Business Messaging: Onboarding Guide", lida em
// 24/11/2026). Lead e Schedule, que a clinica mais escolhe, nao estao na lista:
// viram os equivalentes de la. O resto que nao esta na lista nao sai por esse
// caminho (o job descarta com "evento_fora_do_whatsapp") e a tela avisa.
export const EVENTOS_DO_WHATSAPP: readonly string[] = [
  "Purchase",
  "LeadSubmitted",
  "QualifiedLead",
  "InitiateCheckout",
  "AddToCart",
  "ViewContent",
  "OrderCreated",
  "OrderShipped",
  "OrderDelivered",
  "OrderCanceled",
  "OrderReturned",
  "CartAbandoned",
  "RatingProvided",
  "ReviewProvided",
];

const NOME_NO_WHATSAPP: Record<string, string> = {
  Lead: "LeadSubmitted",
  // Agendou e o lead que se qualificou: o mais perto de Schedule que a Meta
  // aceita no WhatsApp.
  Schedule: "QualifiedLead",
};

/** O nome que o evento leva no anuncio que abre o WhatsApp; null: a Meta nao aceita la. */
export function eventoNoWhatsapp(nome: string): string | null {
  const traduzido = NOME_NO_WHATSAPP[nome] ?? nome;
  return EVENTOS_DO_WHATSAPP.includes(traduzido) ? traduzido : null;
}

/**
 * O que a tela diz sobre o evento escolhido no anuncio que abre o WhatsApp:
 * nada quando o nome e o mesmo, uma nota quando muda e um alerta quando a
 * Meta nao aceita.
 */
export function avisoDoWhatsapp(
  nome: string,
): { tom: "nota" | "alerta"; texto: string } | null {
  const noWhatsapp = eventoNoWhatsapp(nome);
  if (noWhatsapp === nome) {
    return null;
  }
  if (noWhatsapp) {
    return {
      tom: "nota",
      texto: `No anúncio que abre o WhatsApp, vai como ${noWhatsapp}, o nome que a Meta aceita lá.`,
    };
  }
  return {
    tom: "alerta",
    texto:
      "A Meta não aceita este evento no anúncio que abre o WhatsApp: os leads desse anúncio não contam nesta etapa. Prefira um dos mais usados em clínica.",
  };
}
