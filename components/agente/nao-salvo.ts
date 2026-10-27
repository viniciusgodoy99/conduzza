import { useEffect } from "react";

import { ABAS_DO_AGENTE, type AbaDoAgente } from "@/components/agente/textos";

// Edicao nao salva da Tela 6 (achados 10 e 27): cada formulario avisa o
// painel quando tem o que nao foi salvo, e o painel nao publica ate a pessoa
// salvar ou descartar (o publicar leva so o que esta gravado no rascunho).
// Ao desmontar (salvou e remontou, descartou, fechou o editor), o formulario
// avisa que nao tem mais nada pendente. As regras ficam em funcoes puras
// (testadas sem navegador); o hook so liga o formulario ao painel.
//
// E4 (20/10/2026): a aba Regras e limites tem dois formularios, o horario
// ("regras") e os limites para marcar consulta ("agenda"), cada um com o
// proprio Salvar. Cada um avisa e remonta sozinho; a lista do publicar diz a
// aba uma vez so (abasNaoSalvas). Onda 2 (item 4): o terceiro, "Quem o
// assistente atende" ("publico"), na mesma aba. A aba WhatsApp grava na
// hora, fora do rascunho: nao tem formulario aqui.
//
// AG3: o quarto da aba, "Dados para marcar consulta", nao ganha nome proprio:
// conta como o dos limites ("agenda"; comOsDadosParaMarcar), porque os dois
// sao sobre marcar consulta e moram juntos. A aba fica pendente enquanto um
// dos dois tiver o que nao foi salvo, e descartar remonta os dois (a mesma
// geracao).

/** Os formularios com Salvar (Habilidades grava no toque, sem Salvar). */
export const FORMULARIOS_DO_AGENTE = [
  "persona",
  "conhecimento",
  "publico",
  "regras",
  "agenda",
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
  publico: false,
  regras: false,
  agenda: false,
  instrucoes: false,
};

export const GERACAO_INICIAL: GeracaoDosFormularios = {
  persona: 0,
  conhecimento: 0,
  publico: 0,
  regras: 0,
  agenda: 0,
  instrucoes: 0,
};

/**
 * A aba de cada formulario: o publico, o horario e a agenda moram em Regras
 * e limites.
 */
const ABA_DO_FORMULARIO: Readonly<Record<FormularioDoAgente, AbaDoAgente>> = {
  persona: "persona",
  conhecimento: "conhecimento",
  publico: "regras",
  regras: "regras",
  agenda: "regras",
  instrucoes: "instrucoes",
};

/**
 * O estado com o cartao "Dados para marcar consulta" (AG3) junto dos limites:
 * o que foi marcado e nao salvo nele deixa "agenda" pendente.
 */
export function comOsDadosParaMarcar(
  estado: EstadoNaoSalvo,
  dadosNaoSalvos: boolean,
): EstadoNaoSalvo {
  return dadosNaoSalvos && !estado.agenda
    ? { ...estado, agenda: true }
    : estado;
}

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
  const aba = ABA_DO_FORMULARIO[formulario];
  return ABAS_DO_AGENTE.find((item) => item.chave === aba)?.rotulo ?? aba;
}

/**
 * As abas com edicao nao salva, na ordem, sem repetir: o horario e os
 * limites para marcar consulta, os dois pendentes, dizem "Regras e limites"
 * uma vez.
 */
export function abasNaoSalvas(
  pendentes: readonly FormularioDoAgente[],
): string[] {
  return [...new Set(pendentes.map(rotuloDoFormulario))];
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
