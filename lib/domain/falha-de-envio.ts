import type { ConsentStatus } from "@/lib/design/status";

// "Nao enviadas" da Tela 2 (Fase 3, decisao do dono em 02/10/2026): o que
// conta como toque que nao saiu e o rotulo CURTO do porque, para o rodape
// "motivo mais comum" do cartao. Modulo PURO: serve ao cartao, ao filtro e
// aos testes.
//
// Conta como nao enviada a consulta cujo ULTIMO toque foi pulado por um
// motivo que deixou o paciente sem a mensagem: falha no envio, WhatsApp fora
// do ar, fila ate a hora da consulta, numero removido, sem autorizacao, fora
// do horario de envio e limite de gasto. Ficam de fora os pulos esperados
// (condicao_parada, consulta_remarcada, remarcacao_pedida, toque_atrasado):
// o toque nao era mais necessario ou o seguinte cobriu.
//
// Os rotulos sao em lingua de recepcao, sem travessao, e nunca inventam
// codigo: cada chave abaixo existe no codigo de envio (send.ts, uazapi.ts),
// no motor (regua.ts, worker.ts) ou nas funcoes do banco que gravam
// job_queue.last_error. Codigo sem rotulo cai em "Falha no envio".

/** Motivos de cadence_run.skipped_reason que contam como "Não enviada". */
export const MOTIVOS_DE_NAO_ENVIO = [
  "falha_envio",
  "desconectado",
  "canal_ocupado",
  "numero_removido",
  "sem_consentimento",
  "fora_janela",
  "teto_gasto",
] as const;

export type MotivoDeNaoEnvio = (typeof MOTIVOS_DE_NAO_ENVIO)[number];

const CONJUNTO_DE_NAO_ENVIO: ReadonlySet<string> = new Set(
  MOTIVOS_DE_NAO_ENVIO,
);

/** O pulo deixou o paciente sem a mensagem (e nao foi um pulo esperado)? */
export function contaComoNaoEnviada(motivo: string): boolean {
  return CONJUNTO_DE_NAO_ENVIO.has(motivo);
}

/**
 * Rotulo da falha sem detalhe: linha antiga (motivo_da_falha nulo, antes da
 * migration 20261002110000), codigo 'desconhecido' ou codigo sem rotulo.
 */
export const ROTULO_DA_FALHA_GENERICA = "Falha no envio";

const ROTULO_POR_MOTIVO: Record<
  Exclude<MotivoDeNaoEnvio, "falha_envio" | "sem_consentimento">,
  string
> = {
  desconectado: "WhatsApp desconectado",
  canal_ocupado: "Fila até a hora da consulta",
  numero_removido: "Número removido da clínica",
  fora_janela: "Fora do horário de envio",
  teto_gasto: "Limite de gasto atingido",
};

const SISTEMA = "Erro do sistema no envio";
const NUMERO_NAO_CONFIGURADO = "Número da clínica não configurado";
const SERVIDOR_FORA_DO_AR = "Servidor do WhatsApp fora do ar";

/**
 * Codigos de cadence_run.motivo_da_falha (so com skipped_reason =
 * 'falha_envio'). Os uazapi_<status> sao tratados a parte, pela faixa.
 */
const ROTULO_POR_CODIGO: Readonly<Record<string, string>> = {
  // Provedor (uazapi.ts)
  whatsapp_463: "WhatsApp restringiu o número",
  provider_indisponivel: SERVIDOR_FORA_DO_AR,
  envio_incerto: "Sem confirmação do WhatsApp",
  instancia_invalida: "WhatsApp desconectado",
  // Envio (send.ts)
  sem_instancia: NUMERO_NAO_CONFIGURADO,
  configuracao_ausente: NUMERO_NAO_CONFIGURADO,
  slot_indisponivel: "Número da clínica indisponível",
  conta_divergente: "Conversa em outro número",
  conversa_inexistente: "Conversa não encontrada",
  contato_inexistente: "Contato não encontrado",
  sem_consentimento_no_envio: "Sem autorização",
  leitura_falhou: SISTEMA,
  registro_falhou: SISTEMA,
  // Motor (regua.ts, worker.ts) e fila (job_queue.last_error)
  pular_run_falhou: SISTEMA,
  excecao_no_worker: SISTEMA,
  lease_expirado: "Envio interrompido",
  devolucoes_demais: "Envio adiado várias vezes",
};

const CODIGO_DO_PROVEDOR = /^uazapi_(\d{3})$/;

/**
 * Rotulo curto do codigo gravado em motivo_da_falha. Nulo (linha antiga),
 * 'desconhecido' e codigo sem rotulo viram "Falha no envio": codigo cru
 * nunca aparece na tela.
 */
export function rotuloDaFalhaDeEnvio(
  codigo: string | null | undefined,
): string {
  if (!codigo) {
    return ROTULO_DA_FALHA_GENERICA;
  }
  const doProvedor = CODIGO_DO_PROVEDOR.exec(codigo);
  if (doProvedor) {
    // 5xx: o servidor do WhatsApp caiu; o resto (4xx) e recusa da mensagem.
    return Number(doProvedor[1]) >= 500
      ? SERVIDOR_FORA_DO_AR
      : "WhatsApp recusou a mensagem";
  }
  return ROTULO_POR_CODIGO[codigo] ?? ROTULO_DA_FALHA_GENERICA;
}

/**
 * Rotulo curto de um toque nao enviado: o motivo do pulo e, na falha de
 * envio, o codigo. "sem_consentimento" depende do estado da autorizacao
 * (achado 57): quem pediu para nao receber aparece diferente de quem so
 * nunca foi registrado.
 */
export function rotuloDoNaoEnvio(
  motivo: string,
  detalhe: string | null | undefined,
  consentimento?: ConsentStatus,
): string {
  if (motivo === "falha_envio") {
    return rotuloDaFalhaDeEnvio(detalhe);
  }
  if (motivo === "sem_consentimento") {
    return consentimento === "revogado"
      ? "Pediu para não receber"
      : "Sem autorização";
  }
  return (
    (ROTULO_POR_MOTIVO as Readonly<Record<string, string>>)[motivo] ??
    ROTULO_DA_FALHA_GENERICA
  );
}

/** O resumo dos motivos das nao enviadas do dia, para o rodape do cartao. */
export type ResumoDosMotivos =
  | { tipo: "nenhum" }
  /** Todas pelo mesmo motivo. */
  | { tipo: "unico"; rotulo: string }
  /** Um motivo aparece mais que qualquer outro (a moda). */
  | { tipo: "mais_comum"; rotulo: string }
  /** Empate no topo: apontar um so seria mentir. */
  | { tipo: "variados" };

/** A moda dos rotulos curtos. Empate no topo nao escolhe um ao acaso. */
export function resumirMotivos(rotulos: readonly string[]): ResumoDosMotivos {
  if (rotulos.length === 0) {
    return { tipo: "nenhum" };
  }
  const vezes = new Map<string, number>();
  for (const rotulo of rotulos) {
    vezes.set(rotulo, (vezes.get(rotulo) ?? 0) + 1);
  }
  if (vezes.size === 1) {
    return { tipo: "unico", rotulo: rotulos[0] as string };
  }
  let maximo = 0;
  let lideres: string[] = [];
  for (const [rotulo, quantas] of vezes) {
    if (quantas > maximo) {
      maximo = quantas;
      lideres = [rotulo];
    } else if (quantas === maximo) {
      lideres.push(rotulo);
    }
  }
  return lideres.length === 1
    ? { tipo: "mais_comum", rotulo: lideres[0] as string }
    : { tipo: "variados" };
}

/** Texto do rodape do cartao "Não enviadas"; null quando nao ha nenhuma. */
export function rodapeDosMotivos(resumo: ResumoDosMotivos): string | null {
  switch (resumo.tipo) {
    case "nenhum":
      return null;
    case "unico":
      return `Motivo: ${resumo.rotulo}`;
    case "mais_comum":
      return `Mais comum: ${resumo.rotulo}`;
    case "variados":
      return "Motivos variados";
  }
}
