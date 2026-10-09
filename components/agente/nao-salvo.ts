import { useEffect } from "react";

import { ABAS_DO_AGENTE } from "@/components/agente/textos";

// Edicao nao salva da Tela 6 (achados 10 e 27): cada formulario avisa o
// painel quando tem o que nao foi salvo, e o painel nao publica ate a pessoa
// salvar ou descartar (o publicar leva so o que esta gravado no rascunho).
// Ao desmontar (salvou e remontou, descartou, fechou o editor), o formulario
// avisa que nao tem mais nada pendente. As regras ficam em funcoes puras
// (testadas sem navegador); o hook so liga o formulario ao painel.

/** Os formularios com Salvar (Habilidades grava no toque, sem Salvar). */
export const FORMULARIOS_DO_AGENTE = [
  "persona",
  "conhecimento",
  "regras",
  "instrucoes",
] as const;

export type FormularioDoAgente = (typeof FORMULARIOS_DO_AGENTE)[number];

/** O aviso que cada formulario recebe do painel. */
export type AvisarNaoSalvo = (naoSalvo: boolean) => void;

export type EstadoNaoSalvo = Record<FormularioDoAgente, boolean>;

/** A geracao de cada formulario: muda ao descartar (o formulario remonta). */
export type GeracaoDosFormularios = Record<FormularioDoAgente, number>;

export const NADA_NAO_SALVO: EstadoNaoSalvo = {
  persona: false,
  conhecimento: false,
  regras: false,
  instrucoes: false,
};

export const GERACAO_INICIAL: GeracaoDosFormularios = {
  persona: 0,
  conhecimento: 0,
  regras: 0,
  instrucoes: 0,
};

/**
 * Os formularios com edicao nao salva, na ordem das abas. O das instrucoes
 * so conta para o super admin (a aba nem existe para os outros).
 */
export function formulariosNaoSalvos(
  estado: EstadoNaoSalvo,
  superAdmin: boolean,
): FormularioDoAgente[] {
  return FORMULARIOS_DO_AGENTE.filter(
    (formulario) =>
      estado[formulario] && (formulario !== "instrucoes" || superAdmin),
  );
}

/** Descartar: os formularios pendentes remontam com o que esta salvo. */
export function geracaoDepoisDeDescartar(
  geracao: GeracaoDosFormularios,
  pendentes: readonly FormularioDoAgente[],
): GeracaoDosFormularios {
  const proxima = { ...geracao };
  for (const formulario of pendentes) {
    proxima[formulario] += 1;
  }
  return proxima;
}

/** O rotulo da aba de cada formulario, para a lista do que nao foi salvo. */
export function rotuloDoFormulario(formulario: FormularioDoAgente): string {
  return (
    ABAS_DO_AGENTE.find((aba) => aba.chave === formulario)?.rotulo ?? formulario
  );
}

/**
 * Conhecimento: abrir outro editor (`alvo`) com o aberto alterado e nao
 * salvo pede confirmacao antes de descartar o que foi digitado.
 */
export function trocaDeEditorPedeConfirmacao(
  aberto: string | null,
  alvo: string,
  naoSalvo: boolean,
): boolean {
  return aberto !== null && aberto !== alvo && naoSalvo;
}

/** Avisa o painel do estado atual e, ao desmontar, que nada ficou. */
export function useAvisarNaoSalvo(
  naoSalvo: boolean,
  avisar: AvisarNaoSalvo | undefined,
): void {
  useEffect(() => {
    avisar?.(naoSalvo);
  }, [naoSalvo, avisar]);
  useEffect(() => () => avisar?.(false), [avisar]);
}
