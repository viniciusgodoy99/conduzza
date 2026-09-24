// Marca de reserva do produto (Conduzza Design System, docs/06 secao 5.1).
// Vale enquanto a clinica nao tiver logo proprio: quando o editor de marca
// (Tela 12) existir, os logos vem de clinic_branding e estes ficam so como
// reserva. Arquivos gerados a partir de "Conduzza Design System/assets".
//
// So ha versao para fundo escuro: a marca em fundo claro espera o lockup
// oficial em tinta (conflito C34 da especificacao), entao nenhum lugar usa
// marca sobre fundo claro por enquanto.

export const MARCA_PADRAO = {
  nomeDoProduto: "Conduzza Clínicas",
  /** Simbolo e nome, cream e lime; proporcao 6,086:1 (146x24, 170x28). */
  lockupFundoEscuro: "/brand/conduzza-lockup-on-dark.png",
  /** So o simbolo em lime, recortado e quadrado (menu recolhido). */
  simboloFundoEscuro: "/brand/conduzza-symbol-lime.png",
} as const;
