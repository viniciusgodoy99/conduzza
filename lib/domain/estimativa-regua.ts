// Estimativa de volume e custo de uma regua (spec 7.5), PURA e honesta.
//
// A regra que manda aqui e a pendencia P1 do backlog: o preco por mensagem em
// BRL NAO EXISTE ainda (message_pricing nasce vazia de proposito) e nao se
// inventa valor. Entao a estimativa fala do que e aritmetica de dado real (o
// VOLUME: eventos dos ultimos 30 dias vezes passos da regua) e so fala de
// dinheiro quando a tabela de precos tiver linha. No canal por QR o custo por
// mensagem e zero mesmo, e o texto diz isso com todas as letras.

export type BaseDaEstimativa = {
  /** Eventos-gatilho dos ultimos 30 dias (consultas, faltas, entradas na etapa). */
  eventos30d: number;
  /** Passos da regua que efetivamente enviam (com texto). */
  passos: number;
  /** "consultas marcadas" | "faltas registradas" | "leads que entraram na etapa" */
  rotuloDoEvento: string;
  /** Preco por mensagem em centavos quando message_pricing tiver linha; senao null. */
  precoCents: number | null;
};

export type EstimativaDaRegua = {
  mensagensPorMes: number;
  frase: string;
  fraseDeCusto: string;
};

const formatadorBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function estimarRegua(base: BaseDaEstimativa): EstimativaDaRegua {
  const mensagensPorMes = base.eventos30d * base.passos;
  const frase =
    base.passos === 0
      ? "Esta régua ainda não tem mensagem com texto, então nada é enviado."
      : `Esta régua envia cerca de ${mensagensPorMes} ${
          mensagensPorMes === 1 ? "mensagem" : "mensagens"
        } por mês, considerando ${base.eventos30d} ${base.rotuloDoEvento} nos últimos 30 dias e ${
          base.passos === 1 ? "1 mensagem" : `${base.passos} mensagens`
        } por ${base.rotuloDoEvento === "faltas registradas" ? "falta" : base.rotuloDoEvento === "consultas marcadas" ? "consulta" : "lead"}.`;
  const fraseDeCusto =
    base.precoCents === null
      ? "No WhatsApp conectado por QR não há custo por mensagem. Quando o canal oficial estiver ativo, o custo estimado em reais aparece aqui."
      : `Custo estimado: ${formatadorBRL.format((mensagensPorMes * base.precoCents) / 100)} por mês. Mensagens respondidas dentro de 24 horas não são cobradas.`;
  return { mensagensPorMes, frase, fraseDeCusto };
}
