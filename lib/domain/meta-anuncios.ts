// Regras PURAS da leitura do investimento da Meta (Fase 4): o formato da conta
// de anuncios, os problemas de leitura e o texto que a clinica le sobre cada
// um. Sem rede, sem banco: serve a integracao (lib/integrations/meta/
// insights.ts), ao job (lib/jobs/gasto-meta.ts), as Server Actions de
// Configuracoes e a tela.

/**
 * D4 do dono (pendente; construido com a recomendacao, facil de trocar):
 * dias lidos na primeira leitura, na troca de conta e na volta depois de um
 * buraco maior que a janela diaria. 60 deixa a comparacao com os 30 dias
 * anteriores de Resultados aparecer desde o primeiro dia.
 */
export const DIAS_DA_PRIMEIRA_LEITURA = 60;
/**
 * D4 do dono: dias regravados na leitura diaria. Cobre os 28 dias em que a
 * Meta ainda ajusta o gasto, com folga.
 */
export const DIAS_DA_LEITURA_DIARIA = 30;

/** Conta de anuncios no formato da Graph: "act_" seguido so de digitos. */
export type AdAccountId = `act_${string}`;

const CONTA_CRUA = /^(?:act_)?(\d{5,20})$/i;
// Link do Gerenciador de Anuncios: ...?act=123456789&business_id=...
const CONTA_NO_LINK = /[?&]act=(\d{5,20})(?=[&#]|$)/;

/**
 * Normaliza o que a pessoa colou no campo da conta para "act_<digitos>",
 * minusculo, sem espaco e sem link. Aceita so numeros, "act_" ou "ACT_" na
 * frente, espacos no meio (o numero copiado em grupos) e o link do
 * Gerenciador de Anuncios com "?act=". Qualquer outra coisa vira null: o
 * banco recusa o que nao bate com ^act_[0-9]{5,20}$ (CHECK
 * ad_account_id_formato).
 */
export function normalizarContaDeAnuncios(entrada: string): AdAccountId | null {
  const limpo = entrada.trim().replace(/\s+/g, "");
  if (limpo === "") {
    return null;
  }
  const casou = CONTA_CRUA.exec(limpo) ?? CONTA_NO_LINK.exec(limpo);
  const digitos = casou?.[1];
  return digitos ? `act_${digitos}` : null;
}

/**
 * Os 12 problemas de leitura, na ordem do CHECK de
 * meta_gasto_leitura.problema (migration 20261003100000). Mudar aqui exige
 * mudar o CHECK e as funcoes registrar_falha_do_gasto_meta e
 * enfileirar_gasto_meta_do_dia.
 */
export const PROBLEMAS_DE_LEITURA = [
  "token_invalido",
  "sem_permissao",
  "conta_sem_acesso",
  "exige_prova_do_app",
  "parametro_recusado",
  "versao_descontinuada",
  "consulta_pesada",
  "limite_da_meta",
  "meta_indisponivel",
  "resposta_invalida",
  "prazo_esgotado",
  "outro",
] as const;

export type ProblemaDeLeitura = (typeof PROBLEMAS_DE_LEITURA)[number];

/**
 * Problemas que PAUSAM a leitura diaria (C13): sao de configuracao, e repetir
 * nao conserta. A pausa sai quando o teste da certo, quando um token novo e
 * salvo ou quando a conta muda. Mesma lista das funcoes do banco.
 */
export const PROBLEMAS_QUE_PAUSAM: ReadonlySet<ProblemaDeLeitura> = new Set<ProblemaDeLeitura>([
  "token_invalido",
  "sem_permissao",
  "conta_sem_acesso",
  "exige_prova_do_app",
]);

/** O valor lido do banco (ou de qualquer lugar) e um dos 12 problemas? */
export function eProblemaDeLeitura(valor: unknown): valor is ProblemaDeLeitura {
  return (
    typeof valor === "string" &&
    (PROBLEMAS_DE_LEITURA as readonly string[]).includes(valor)
  );
}

/**
 * O que a clinica le sobre cada problema, em linguagem de recepcionista e sem
 * travessao. Nunca carrega a mensagem da Meta (pode vir em ingles e trazer
 * dado da conta); no maximo o numero do codigo, para o suporte.
 */
export function textoDoProblemaDeLeitura(
  problema: ProblemaDeLeitura,
  contexto: { adAccountId?: string | null; codigo?: number | null } = {},
): string {
  const codigo =
    typeof contexto.codigo === "number" && Number.isFinite(contexto.codigo)
      ? ` (código ${contexto.codigo})`
      : "";
  switch (problema) {
    case "token_invalido":
      return "A Meta recusou o token: ele expirou, foi revogado ou foi colado pela metade. Gere um novo e cole aqui.";
    case "sem_permissao":
      return "O token não tem permissão para ler anúncios. Gere de novo marcando a permissão ads_read (ler anúncios).";
    case "conta_sem_acesso": {
      const conta = contexto.adAccountId
        ? `a conta ${contexto.adAccountId}`
        : "a conta de anúncios";
      return `A Meta não encontrou ${conta} para este token. Confira o número da conta e se o usuário do sistema tem acesso a ela no Gerenciador de Negócios.`;
    }
    case "exige_prova_do_app":
      return "O aplicativo da Meta deste token exige uma assinatura extra que o Conduzza não usa. Gere o token por um usuário do sistema sem essa exigência.";
    case "parametro_recusado":
      return `A Meta não aceitou o pedido de leitura do investimento${codigo}. Fale com o suporte do Conduzza.`;
    case "versao_descontinuada":
      return "A Meta encerrou a versão que o Conduzza usa para ler o investimento. Fale com o suporte do Conduzza.";
    case "consulta_pesada":
      return "A conta tem informação demais para a Meta entregar de uma vez. Tente de novo mais tarde; se continuar, fale com o suporte.";
    case "limite_da_meta":
      return "A Meta pediu uma pausa nas consultas desta conta. Tente de novo em alguns minutos.";
    case "meta_indisponivel":
      return "A Meta não respondeu agora. Tente de novo em instantes.";
    case "resposta_invalida":
      return "A Meta respondeu de um jeito que o Conduzza não reconheceu. Tente de novo em alguns minutos.";
    case "prazo_esgotado":
      return "A leitura demorou mais do que o permitido. Tente de novo em alguns minutos.";
    case "outro":
      return `A Meta recusou a leitura${codigo}. Tente de novo; se continuar, fale com o suporte.`;
  }
}
