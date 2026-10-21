import { z } from "zod";

import {
  codigosDoCliqueDoSite,
  eFraseDoBotao,
  extrairTokens,
  montarLinkWhatsApp,
  normalizarTexto,
  reconhecerOrigem,
  SOURCE_CHANNELS,
  type CampaignRule,
  type Reconhecimento,
  type SourceChannel,
} from "@/lib/domain/attribution";
import { textoDaOrigem } from "@/lib/domain/leads-ui";
import { FRASE_PADRAO } from "@/lib/domain/rastreio-do-site";
import { formatarTelefone } from "@/lib/domain/telefone";

// Regras PURAS da aba "Origem dos leads" de Configuracoes (onda 5, item 17;
// contrato A.2 e A.3): zero I/O. A tabela e campaign_link (as "regras de
// atribuicao" que a ingestao le a cada contato novo); a decisao continua em
// lib/domain/attribution.ts, e aqui so o que a tela e as Server Actions
// precisam: o schema (o mesmo do formulario e da action), os rotulos, o
// link para a bio, os avisos, as conferencias de conflito e o "Testar uma
// mensagem", que roda atribuirOrigem no navegador com as regras carregadas
// (nada vai ao servidor).
//
// Decisoes do dono (21/10/2026): P17-2 o metodo no lead se chama "Mensagem
// pronta do link"; P17-3 o codigo no link nasce ligado; P17-4 a mensagem
// pronta tem pelo menos 3 palavras e 15 caracteres (depois de normalizar)
// e a palavra-chave pelo menos 4, travado no banco e aqui; P17-5 sem previa,
// so o teste; P17-8 ate 50 origens ativas por clinica.
//
// A tela NAO liga regra a campanha nem a investimento da Meta (D1 de
// 04/10/2026): a campanha digitada aparece em Resultados como "fora da Meta".

/** Origens ativas por clinica (P17-8; o banco trava por gatilho). */
export const LIMITE_DE_ORIGENS_ATIVAS = 50;
export const NOME_MINIMO = 2;
export const NOME_MAXIMO = 120;
/** Origem, detalhe e campanha. */
export const TEXTO_MAXIMO = 120;
export const MENSAGEM_MAXIMA = 1000;
/** P17-4: depois de normalizar (sem acento, invisivel e espaco repetido). */
export const MENSAGEM_MINIMA_EM_CARACTERES = 15;
export const MENSAGEM_MINIMA_EM_PALAVRAS = 3;
export const LIMITE_DE_PALAVRAS_CHAVE = 20;
export const PALAVRA_CHAVE_MINIMA = 4;
export const PALAVRA_CHAVE_MAXIMA = 40;

/** Colunas de campaign_link que a aba le (lib/queries/regras-de-origem.ts). */
export const REGRA_DE_ORIGEM_SELECT =
  "id, name, token, channel, origin, medium, campaign, default_message, keywords, active, created_at";

/** Uma linha de campaign_link como o PostgREST devolve. */
export type LinhaDaRegraDeOrigem = {
  id: string;
  name: string;
  token: string | null;
  channel: SourceChannel;
  origin: string | null;
  medium: string | null;
  campaign: string | null;
  default_message: string | null;
  keywords: string[] | null;
  active: boolean;
  created_at: string;
};

/** Uma origem cadastrada, como a tela a mostra. */
export type RegraDeOrigem = {
  id: string;
  nome: string;
  /** o codigo do link, sem a cerquilha; nulo = sem codigo */
  codigo: string | null;
  canal: SourceChannel;
  origem: string | null;
  /** o "meio" (medium): Bio, Perfil, QR da recepcao */
  detalhe: string | null;
  campanha: string | null;
  /** a mensagem pronta do link; nula = sem mensagem */
  mensagem: string | null;
  palavrasChave: string[];
  ativa: boolean;
};

export function regraDaLinha(linha: LinhaDaRegraDeOrigem): RegraDeOrigem {
  return {
    id: linha.id,
    nome: linha.name,
    codigo: linha.token ? linha.token.toUpperCase() : null,
    canal: linha.channel,
    origem: linha.origin,
    detalhe: linha.medium,
    campanha: linha.campaign,
    mensagem: linha.default_message,
    palavrasChave: linha.keywords ?? [],
    ativa: linha.active,
  };
}

/** A regra no formato da decisao pura (attribution.ts). */
export function regraParaAtribuicao(regra: RegraDeOrigem): CampaignRule {
  return {
    id: regra.id,
    token: regra.codigo,
    channel: regra.canal,
    origin: regra.origem,
    medium: regra.detalhe,
    campaign: regra.campanha,
    defaultMessage: regra.mensagem,
    keywords: regra.palavrasChave,
  };
}

/**
 * As regras que a ingestao usa: SO as ativas, na ordem de criacao (a lista
 * ja vem nessa ordem; empate de mensagem e de palavra-chave fica com a
 * primeira).
 */
export function regrasQueAIngestaoUsa(
  regras: readonly RegraDeOrigem[],
): CampaignRule[] {
  return regras.filter((regra) => regra.ativa).map(regraParaAtribuicao);
}

// ---------------------------------------------------------------------------
// Schema do formulario e da action (react-hook-form e Server Action)

// C0, DEL e C1. A mensagem aceita a quebra de linha; tabulacao e retorno de
// carro viram espaco e \n antes de gravar (camposDaRegra), porque o banco so
// aceita \n e a normalizacao ja trata os dois como espaco.
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROLE_NA_MENSAGEM =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const QUEBRA_DE_LINHA = /[\u2028\u2029]/;

function semControle(texto: string): boolean {
  return !CONTROLE.test(texto) && !QUEBRA_DE_LINHA.test(texto);
}

/**
 * Caracteres como o banco os conta: char_length e o regex dos CHECKs da
 * migration 20261025100000 contam pontos de codigo, e nao as unidades
 * UTF-16 do .length do JavaScript. Um emoji fora do BMP (U+1F9B7) vale 1
 * aqui e no banco; pelo .length valeria 2, e o Zod aceitaria um nome, uma
 * mensagem ou uma palavra-chave que o banco recusa (23514). Serve tambem ao
 * contador do campo da mensagem.
 */
export function contarCaracteres(texto: string): number {
  return Array.from(texto).length;
}

/**
 * O tamanho do texto ja normalizado, para os minimos da P17-4 (contados
 * depois de normalizar): em pontos de codigo e recomposto em NFC. A
 * normalizacao decompoe o texto (NFD), e a silaba do hangul vira 2 ou 3
 * jamos, que o banco, com o texto como foi gravado, conta como 1. Assim o
 * minimo daqui nunca passa onde o do banco recusa.
 */
function tamanhoDoNormalizado(normalizado: string): number {
  return contarCaracteres(normalizado.normalize("NFC"));
}

function textoOpcional(campo: { na: string; da: string }) {
  return z
    .string()
    .trim()
    .refine((texto) => contarCaracteres(texto) <= TEXTO_MAXIMO, {
      error: `Use até ${TEXTO_MAXIMO} caracteres ${campo.na}.`,
    })
    .refine(semControle, { error: `Tire as quebras de linha ${campo.da}.` });
}

/** A mensagem pronta tem tamanho de texto de link, nao de saudacao (P17-4). */
export function mensagemComTamanhoBom(mensagem: string): boolean {
  const normalizada = normalizarTexto(mensagem);
  return (
    tamanhoDoNormalizado(normalizada) >= MENSAGEM_MINIMA_EM_CARACTERES &&
    normalizada.split(" ").length >= MENSAGEM_MINIMA_EM_PALAVRAS
  );
}

export const ERRO_DA_MENSAGEM_CURTA = `Use pelo menos ${MENSAGEM_MINIMA_EM_PALAVRAS} palavras e ${MENSAGEM_MINIMA_EM_CARACTERES} caracteres. Uma saudação curta, como Bom dia, marcaria leads que não vieram do link.`;

export const ERRO_DA_PALAVRA_CHAVE = `Cada palavra-chave tem de ${PALAVRA_CHAVE_MINIMA} a ${PALAVRA_CHAVE_MAXIMA} caracteres, sem quebra de linha.`;

export const ERRO_SEM_JEITO_DE_RECONHECER =
  "Escolha pelo menos um jeito de reconhecer: a mensagem pronta, o código no link ou uma palavra-chave.";

/**
 * A palavra-chave tem tamanho de palavra: o minimo contado sem acento e
 * invisivel, o maximo no texto como vai para o banco (os dois em pontos de
 * codigo, como o banco conta).
 */
export function palavraChaveValida(palavra: string): boolean {
  const aparada = palavra.trim();
  return (
    contarCaracteres(aparada) <= PALAVRA_CHAVE_MAXIMA &&
    tamanhoDoNormalizado(normalizarTexto(aparada)) >= PALAVRA_CHAVE_MINIMA &&
    semControle(aparada)
  );
}

const camposDaOrigem = {
  // refine e nao min/max: o min e o max do Zod contam unidades UTF-16, e o
  // banco conta pontos de codigo (contarCaracteres).
  nome: z
    .string()
    .trim()
    .refine((nome) => contarCaracteres(nome) >= NOME_MINIMO, {
      error: `Dê um nome com pelo menos ${NOME_MINIMO} caracteres.`,
    })
    .refine((nome) => contarCaracteres(nome) <= NOME_MAXIMO, {
      error: `O nome vai até ${NOME_MAXIMO} caracteres.`,
    })
    .refine(semControle, { error: "Tire as quebras de linha do nome." }),
  canal: z.enum(SOURCE_CHANNELS, { error: "Escolha o canal." }),
  origem: textoOpcional({ na: "na origem", da: "da origem" }),
  detalhe: textoOpcional({ na: "no detalhe", da: "do detalhe" }),
  campanha: textoOpcional({ na: "na campanha", da: "da campanha" }),
  mensagem: z
    .string()
    .trim()
    .refine((mensagem) => contarCaracteres(mensagem) <= MENSAGEM_MAXIMA, {
      error: `A mensagem pronta vai até ${MENSAGEM_MAXIMA} caracteres.`,
    }),
  palavras_chave: z.array(z.string()).max(LIMITE_DE_PALAVRAS_CHAVE, {
    error: `Use até ${LIMITE_DE_PALAVRAS_CHAVE} palavras-chave.`,
  }),
  /** So vale na criacao (P17-3): o codigo nunca muda depois. */
  com_codigo: z.boolean(),
};

type CamposDaOrigem = {
  mensagem: string;
  palavras_chave: string[];
  com_codigo: boolean;
};

function conferirOsJeitos(valores: CamposDaOrigem, ctx: z.RefinementCtx) {
  const mensagem = valores.mensagem.trim();
  if (mensagem !== "") {
    if (CONTROLE_NA_MENSAGEM.test(mensagem)) {
      ctx.addIssue({
        code: "custom",
        path: ["mensagem"],
        message: "Tire os caracteres especiais da mensagem pronta.",
      });
    } else if (!mensagemComTamanhoBom(mensagem)) {
      ctx.addIssue({
        code: "custom",
        path: ["mensagem"],
        message: ERRO_DA_MENSAGEM_CURTA,
      });
    }
  }
  const vistas = new Set<string>();
  for (const palavra of valores.palavras_chave) {
    if (!palavraChaveValida(palavra)) {
      ctx.addIssue({
        code: "custom",
        path: ["palavras_chave"],
        message: ERRO_DA_PALAVRA_CHAVE,
      });
      break;
    }
    const chave = normalizarTexto(palavra);
    if (vistas.has(chave)) {
      ctx.addIssue({
        code: "custom",
        path: ["palavras_chave"],
        message: `A palavra-chave ${palavra.trim()} está repetida.`,
      });
      break;
    }
    vistas.add(chave);
  }
  if (
    mensagem === "" &&
    valores.palavras_chave.length === 0 &&
    !valores.com_codigo
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["mensagem"],
      message: ERRO_SEM_JEITO_DE_RECONHECER,
    });
  }
}

/** O formulario de "Nova origem" e "Editar origem". */
export const formularioDaOrigemSchema = z
  .object(camposDaOrigem)
  .superRefine(conferirOsJeitos);

export type ValoresDaOrigem = z.infer<typeof formularioDaOrigemSchema>;

/**
 * A entrada da Server Action: os mesmos campos, com o id na edicao. Na
 * edicao, com_codigo diz se a origem JA tem codigo (a action confere com o
 * banco: o codigo nunca muda).
 */
export const salvarOrigemSchema = z
  .object({ id: z.uuid().optional(), ...camposDaOrigem })
  .superRefine(conferirOsJeitos);

export type EntradaDaOrigem = z.infer<typeof salvarOrigemSchema>;

/** O campo do formulario a que um erro se refere (para mostrar nele). */
export type CampoDaOrigem =
  | "nome"
  | "canal"
  | "origem"
  | "detalhe"
  | "campanha"
  | "mensagem"
  | "palavras_chave";

const CAMPOS: readonly CampoDaOrigem[] = [
  "nome",
  "canal",
  "origem",
  "detalhe",
  "campanha",
  "mensagem",
  "palavras_chave",
];

/** O campo do primeiro problema do Zod, quando e um campo do formulario. */
export function campoDoProblema(
  caminho: readonly PropertyKey[] | undefined,
): CampoDaOrigem | undefined {
  const primeiro = caminho?.[0];
  return CAMPOS.find((campo) => campo === primeiro);
}

/** Os valores do formulario de uma origem existente. */
export function valoresDaRegra(regra: RegraDeOrigem): ValoresDaOrigem {
  return {
    nome: regra.nome,
    canal: regra.canal,
    origem: regra.origem ?? "",
    detalhe: regra.detalhe ?? "",
    campanha: regra.campanha ?? "",
    mensagem: regra.mensagem ?? "",
    palavras_chave: [...regra.palavrasChave],
    com_codigo: regra.codigo !== null,
  };
}

export const VALORES_DE_UMA_ORIGEM_NOVA: ValoresDaOrigem = {
  nome: "",
  canal: "redes_sociais",
  origem: "",
  detalhe: "",
  campanha: "",
  mensagem: "",
  palavras_chave: [],
  // P17-3: o codigo no link nasce ligado.
  com_codigo: true,
};

function nuloSeVazio(texto: string): string | null {
  const aparado = texto.trim();
  return aparado === "" ? null : aparado;
}

/** A mensagem como vai para o banco: \r e tabulacao fora, aparada. */
export function mensagemParaGravar(mensagem: string): string | null {
  return nuloSeVazio(mensagem.replace(/\r\n?/g, "\n").replace(/\t/g, " "));
}

/** As colunas de campaign_link a gravar (sem clinic_id, token e active). */
export function camposDaRegra(valores: ValoresDaOrigem) {
  return {
    name: valores.nome.trim(),
    channel: valores.canal,
    origin: nuloSeVazio(valores.origem),
    medium: nuloSeVazio(valores.detalhe),
    campaign: nuloSeVazio(valores.campanha),
    default_message: mensagemParaGravar(valores.mensagem),
    keywords: valores.palavras_chave.map((palavra) => palavra.trim()),
  };
}

/**
 * As palavras-chave de um campo de texto: separadas por virgula ou quebra de
 * linha, aparadas, sem vazias e sem repetir (sem acento nem caixa), na
 * ordem em que foram escritas.
 */
export function palavrasDoTexto(texto: string): string[] {
  const vistas = new Set<string>();
  const palavras: string[] = [];
  for (const pedaco of texto.split(/[,\n]/)) {
    const palavra = pedaco.trim();
    const chave = normalizarTexto(palavra);
    if (palavra === "" || vistas.has(chave)) {
      continue;
    }
    vistas.add(chave);
    palavras.push(palavra);
  }
  return palavras;
}

// ---------------------------------------------------------------------------
// Rotulos

/** O canal e o detalhe, como o lead vai mostrar: "Redes sociais, Instagram (Bio)". */
export function textoDoCanalDaRegra(
  regra: Pick<RegraDeOrigem, "canal" | "origem" | "detalhe">,
): string {
  return (
    textoDaOrigem({
      source_channel: regra.canal,
      source_origin: regra.origem,
      source_medium: regra.detalhe,
    }) ?? regra.canal
  );
}

function palavrasPorExtenso(quantidade: number): string {
  return quantidade === 1 ? "1 palavra-chave" : `${quantidade} palavras-chave`;
}

/** "mensagem pronta", "código #K7Q2MX", "2 palavras-chave", na ordem da tela. */
export function jeitosDeReconhecer(
  regra: Pick<RegraDeOrigem, "mensagem" | "codigo" | "palavrasChave">,
): string[] {
  const jeitos: string[] = [];
  if (regra.mensagem && regra.mensagem.trim() !== "") {
    jeitos.push("mensagem pronta");
  }
  if (regra.codigo) {
    jeitos.push(`código #${regra.codigo}`);
  }
  if (regra.palavrasChave.length > 0) {
    jeitos.push(palavrasPorExtenso(regra.palavrasChave.length));
  }
  return jeitos;
}

/** "Reconhece por: mensagem pronta, código #K7Q2MX, 2 palavras-chave". */
export function textoDoReconhecimento(
  regra: Pick<RegraDeOrigem, "mensagem" | "codigo" | "palavrasChave">,
): string {
  const jeitos = jeitosDeReconhecer(regra);
  return jeitos.length > 0
    ? `Reconhece por: ${jeitos.join(", ")}`
    : "Não reconhece nada ainda: edite e escolha um jeito.";
}

// ---------------------------------------------------------------------------
// Link para a bio

/** Um numero ativo da clinica que serve ao link (ja tem o telefone). */
export type NumeroParaOLink = {
  id: string;
  nome: string;
  /** so digitos, com o 55 (o formato do wa.me) */
  digitos: string;
  /** como a tela mostra: (85) 99999-0000 */
  telefone: string;
};

/**
 * Os numeros da clinica que servem ao link: so os que ja tem o telefone
 * (numero que nunca conectou nao tem). A ordem e a da leitura (o principal
 * primeiro).
 */
export function numerosParaOLink(
  numeros: readonly {
    id: string;
    nome: string;
    displayPhone: string | null;
  }[],
): NumeroParaOLink[] {
  const servem: NumeroParaOLink[] = [];
  for (const numero of numeros) {
    const digitos = (numero.displayPhone ?? "").replace(/\D/g, "");
    if (digitos.length < 10 || digitos.length > 15) {
      continue;
    }
    servem.push({
      id: numero.id,
      nome: numero.nome,
      digitos,
      telefone: formatarTelefone(`+${digitos}`),
    });
  }
  return servem;
}

/**
 * O link do WhatsApp com a mensagem pronta (https://wa.me/<digitos>?text=),
 * e o " [#CODIGO]" no fim quando a origem tem codigo (o mesmo formato que a
 * ingestao procura). Nulo sem mensagem ou com numero fora do formato.
 */
export function linkDoWhatsApp(
  digitos: string,
  mensagem: string | null,
  codigo: string | null,
): string | null {
  const numero = digitos.replace(/\D/g, "");
  const texto = mensagem === null ? "" : mensagemParaGravar(mensagem);
  if (!texto || numero.length < 10 || numero.length > 15) {
    return null;
  }
  if (codigo) {
    return montarLinkWhatsApp(numero, texto, codigo);
  }
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/** O texto que a pessoa ve escrito no WhatsApp ao tocar no link. */
export function textoDoLink(mensagem: string, codigo: string | null): string {
  const texto = mensagemParaGravar(mensagem) ?? "";
  return codigo ? `${texto} [#${codigo.toUpperCase()}]` : texto;
}

// ---------------------------------------------------------------------------
// Avisos da mensagem pronta

/**
 * Os "#XXXXXX" da mensagem que a ingestao le como codigo (docs/01, 10.13:
 * texto pronto com hashtag que parece codigo e tratado como codigo do
 * link). Vazio quando nao ha.
 */
export function trechosQueParecemCodigo(mensagem: string): string[] {
  return extrairTokens(mensagem);
}

/** As frases do botao do site que a ingestao reconhece como do sistema. */
export function frasesDoBotaoDoSite(
  daClinica: readonly string[] | null,
): string[] {
  return [...(daClinica ?? []), FRASE_PADRAO, "Olá!"];
}

/**
 * A mensagem pronta e uma frase do botao do site (as da clinica, a de
 * fabrica ou o "Olá!" da primeira versao do script): quem escreve pelo site
 * sem anuncio do Google ganharia esta origem.
 */
export function eFraseDoSite(
  mensagem: string,
  frases: readonly string[],
): boolean {
  const normalizada = normalizarTexto(mensagem);
  return (
    normalizada !== "" &&
    frases.some((frase) => normalizarTexto(frase) === normalizada)
  );
}

export type AvisoDaMensagem = { chave: "codigo" | "site"; texto: string };

/** Os avisos da mensagem pronta (nao impedem salvar). */
export function avisosDaMensagem(
  mensagem: string,
  frasesDoSite: readonly string[],
): AvisoDaMensagem[] {
  const avisos: AvisoDaMensagem[] = [];
  const trechos = trechosQueParecemCodigo(mensagem);
  if (trechos.length > 0) {
    avisos.push({
      chave: "codigo",
      texto: `O trecho #${trechos[0]} da mensagem é lido como código. Tire a cerquilha (#) do texto.`,
    });
  }
  if (eFraseDoSite(mensagem, frasesDoSite)) {
    avisos.push({
      chave: "site",
      texto:
        "Esta mensagem é igual a uma frase do botão do site (aba Anúncios do Google). Quem escrever pelo site também ganharia esta origem: use um texto só deste link.",
    });
  }
  return avisos;
}

// ---------------------------------------------------------------------------
// Conflitos entre origens

/**
 * A origem ATIVA (outra que nao `idAtual`) cuja mensagem pronta e igual a
 * esta, com a mesma normalizacao da ingestao. Duas iguais: so a primeira
 * cadastrada reconheceria, e a segunda nunca. Nulo sem conflito.
 */
export function origemComAMesmaMensagem(
  mensagem: string | null,
  regras: readonly RegraDeOrigem[],
  idAtual: string | null,
): RegraDeOrigem | null {
  const normalizada = mensagem ? normalizarTexto(mensagem) : "";
  if (normalizada === "") {
    return null;
  }
  return (
    regras.find(
      (regra) =>
        regra.ativa &&
        regra.id !== idAtual &&
        regra.mensagem !== null &&
        normalizarTexto(regra.mensagem) === normalizada,
    ) ?? null
  );
}

export function recusaDaMensagemRepetida(nomeDaOutra: string): string {
  return `Esta mensagem já reconhece a origem ${nomeDaOutra}.`;
}

/**
 * As palavras-chave desta origem que outra origem ATIVA tambem usa (so
 * aviso: vence a mais longa e, no empate, a cadastrada primeiro).
 */
export function palavrasEmOutraOrigem(
  palavras: readonly string[],
  regras: readonly RegraDeOrigem[],
  idAtual: string | null,
): { palavra: string; origem: string }[] {
  const repetidas: { palavra: string; origem: string }[] = [];
  for (const palavra of palavras) {
    const chave = normalizarTexto(palavra);
    const outra = regras.find(
      (regra) =>
        regra.ativa &&
        regra.id !== idAtual &&
        regra.palavrasChave.some((dela) => normalizarTexto(dela) === chave),
    );
    if (outra) {
      repetidas.push({ palavra: palavra.trim(), origem: outra.nome });
    }
  }
  return repetidas;
}

export function avisoDasPalavrasRepetidas(
  repetidas: readonly { palavra: string; origem: string }[],
): string | null {
  const primeira = repetidas[0];
  if (!primeira) {
    return null;
  }
  const resto =
    repetidas.length > 1
      ? ` (e mais ${repetidas.length - 1} ${repetidas.length - 1 === 1 ? "palavra" : "palavras"})`
      : "";
  return `A palavra-chave ${primeira.palavra} também está na origem ${primeira.origem}${resto}. Vale a palavra mais longa e, no empate, a origem cadastrada primeiro.`;
}

export function recusaDoLimite(acao: "criar" | "ativar"): string {
  return `A clínica já tem ${LIMITE_DE_ORIGENS_ATIVAS} origens ativas. Desative uma antes de ${acao === "criar" ? "criar outra" : "ativar esta"}.`;
}

// ---------------------------------------------------------------------------
// Testar uma mensagem

export type ResultadoDoTeste =
  | { tipo: "vazio" }
  | { tipo: "nenhuma" }
  | {
      tipo: "reconhecida";
      regra: RegraDeOrigem;
      metodo: Reconhecimento["method"];
    };

/**
 * Qual origem ATIVA reconheceria a mensagem, pela mesma decisao da ingestao
 * (attribution.ts e tentarAtribuirOrigem de lib/integrations/whatsapp/
 * ingest.ts), no navegador. O "#XXXXXX" que nao e codigo de nenhuma origem
 * ativa a ingestao tenta como clique do site; aqui ele conta como clique NAO
 * achado (nao ha banco), o caso do link antigo ainda publicado (de uma
 * origem desativada ou excluida) e do codigo digitado errado. Com o clique
 * perdido, a ingestao compara a mensagem pronta tambem sem o sufixo
 * " [#XXXXXX]" e nao atribui nada a frase do botao do site (`frasesDoSite`,
 * as de frasesDoBotaoDoSite); aqui tambem. O clique achado, que daria a
 * origem do anuncio do Google, so a ingestao sabe.
 */
export function testarMensagem(
  texto: string,
  regras: readonly RegraDeOrigem[],
  frasesDoSite: readonly string[] = [],
): ResultadoDoTeste {
  if (normalizarTexto(texto) === "") {
    return { tipo: "vazio" };
  }
  const ativas = regrasQueAIngestaoUsa(regras);
  const codigos = codigosDoCliqueDoSite(texto, ativas);
  if (eFraseDoBotao(texto, codigos, frasesDoSite)) {
    return { tipo: "nenhuma" };
  }
  const reconhecimento = reconhecerOrigem(texto, ativas, codigos);
  const regra = reconhecimento
    ? regras.find((item) => item.id === reconhecimento.regra.id)
    : undefined;
  if (!reconhecimento || !regra) {
    return { tipo: "nenhuma" };
  }
  return { tipo: "reconhecida", regra, metodo: reconhecimento.method };
}

const PELO_METODO: Record<Reconhecimento["method"], string> = {
  mensagem_padrao: "pela mensagem pronta",
  link_token: "pelo código do link",
  palavra_chave: "pela palavra-chave",
};

/** A frase do resultado do teste; nula sem texto. */
export function fraseDoTeste(resultado: ResultadoDoTeste): string | null {
  if (resultado.tipo === "vazio") {
    return null;
  }
  if (resultado.tipo === "nenhuma") {
    return "Nenhuma origem cadastrada reconhece esta mensagem.";
  }
  return `Esta mensagem seria reconhecida como ${textoDoCanalDaRegra(resultado.regra)}, ${PELO_METODO[resultado.metodo]} da origem ${resultado.regra.nome}.`;
}

// ---------------------------------------------------------------------------
// Recusas do banco (migration 20261025100000, contrato A.1)

const RECUSAS_POR_CHECK: readonly {
  check: string;
  campo: CampoDaOrigem | undefined;
  texto: string;
}[] = [
  {
    check: "campaign_link_nome",
    campo: "nome",
    texto: `Use de ${NOME_MINIMO} a ${NOME_MAXIMO} caracteres no nome, sem quebra de linha.`,
  },
  {
    check: "campaign_link_textos",
    campo: "origem",
    texto: `Confira a origem, o detalhe e a campanha: até ${TEXTO_MAXIMO} caracteres cada, sem quebra de linha.`,
  },
  {
    check: "campaign_link_mensagem",
    campo: "mensagem",
    texto: ERRO_DA_MENSAGEM_CURTA,
  },
  {
    check: "campaign_link_palavras",
    campo: "palavras_chave",
    texto: `Use até ${LIMITE_DE_PALAVRAS_CHAVE} palavras-chave, de ${PALAVRA_CHAVE_MINIMA} a ${PALAVRA_CHAVE_MAXIMA} caracteres cada, sem quebra de linha.`,
  },
  {
    check: "campaign_link_codigo",
    campo: undefined,
    texto: "O código do link saiu fora do formato. Tente de novo.",
  },
  {
    check: "campaign_link_reconhece_algo",
    campo: "mensagem",
    texto: ERRO_SEM_JEITO_DE_RECONHECER,
  },
];

export const DICA_SEM_PERMISSAO_NAS_ORIGENS =
  "Somente administradores e gestores cadastram as origens dos leads.";

/**
 * A recusa do banco em texto de recepcao, com o campo quando da para saber.
 * Pelo CODIGO e pelo nome do check (que o PostgREST devolve na mensagem),
 * nunca repassando o texto cru. Nulo: nenhuma regra conhecida (quem chama
 * usa o texto padrao dele).
 */
export function recusaDoBancoNaOrigem(
  error: { code?: string; message?: string; details?: string; hint?: string },
  acao: "criar" | "ativar" = "criar",
): { texto: string; campo?: CampoDaOrigem } | null {
  const mensagem = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  if (error.code === "42501") {
    return { texto: DICA_SEM_PERMISSAO_NAS_ORIGENS };
  }
  if (error.code === "23514") {
    const conhecida = RECUSAS_POR_CHECK.find((recusa) =>
      mensagem.includes(recusa.check),
    );
    if (!conhecida) {
      return { texto: "Confira os campos da origem." };
    }
    return conhecida.campo
      ? { texto: conhecida.texto, campo: conhecida.campo }
      : { texto: conhecida.texto };
  }
  // O gatilho do limite de origens ativas (P17-8) recusa com a chave na
  // mensagem (nunca 40001).
  if (/limite_de_origens|origens_ativas/i.test(mensagem)) {
    return { texto: recusaDoLimite(acao) };
  }
  return null;
}
