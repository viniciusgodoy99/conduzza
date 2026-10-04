"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import {
  CircleCheck,
  CirclePause,
  Copy,
  Globe,
  Hourglass,
  OctagonAlert,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Watch,
} from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  alternarRastreioDoSiteAction,
  salvarFrasesDoRastreioAction,
  trocarChaveDoRastreioAction,
} from "@/app/(app)/configuracoes/rastreio-do-site-actions";
import { focoPerdido } from "@/components/cadastros/comum";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { StatusDefinition } from "@/lib/design/status";
import {
  FRASE_PADRAO,
  frasesDoRastreioSchema,
  frasesNoFormato,
  LIMITE_DE_FRASES,
  linhaDoScript,
  SUFIXO_DE_URL_FINAL,
  TAMANHO_MAXIMO_DA_FRASE,
} from "@/lib/domain/rastreio-do-site";

// Cartao "Rastreio do site" (Configuracoes, aba Anuncios do Google; F1 do
// Google, pedido do dono em 04/10/2026). O anuncio do Google leva ao SITE da
// clinica; a linha de script colada no site marca o clique no botao de
// WhatsApp com um codigo, e o lead chega com a origem "Trafego pago,
// Google", o metodo "Clique no site" e o numero da campanha, sem cadastro
// manual. Contrato do banco: migration 20261005100000_clique_do_site.sql.
//
// - A linha do site e publica (vai no HTML), entao a chave aparece aqui para
//   a gestao (a RLS de rastreio_do_site so mostra a linha para administrador
//   e gestor). O gclid, o codigo e quem clicou NUNCA chegam nesta tela: a
//   situacao vem de situacao_do_rastreio, so com totais.
// - O endereco da linha e o PUBLIC_APP_URL do servidor (o mesmo do webhook
//   do WhatsApp), so com https (http so em localhost, para desenvolvimento).
//   Sem ele, a linha nao e montada: uma linha com endereco errado no site de
//   uma clinica perde todos os cliques.
// - A linha e o sufixo do Google Ads vem de lib/domain/rastreio-do-site.ts,
//   o mesmo modulo que a rota publica usa e que o teste do script confere
//   contra public/rastreio/v1.js: o sufixo que a clinica cola e exatamente o
//   que o script le (cz_campanha e cz_grupo).
// - O chip diz a verdade de HOJE: "Recebendo cliques" so com clique da chave
//   atual nos ultimos 7 dias (a mesma janela de situacao_do_rastreio). Clique
//   mais velho que isso, inclusive ao religar um rastreio parado ha meses,
//   vira "Sem cliques nos ultimos 7 dias", com o aviso de conferir o site: e
//   o sinal de que a linha sumiu do site ou os anuncios pararam. A hora de
//   referencia vem da pagina (agoraMs, servidor), como no cartao da Meta.
// - A linha nao sabe se o rastreio esta ligado: desligado, ela continua
//   acrescentando o codigo a mensagem de quem vem do Google (so nada e
//   registrado). O texto do desligado diz isso.
// - O passo a passo diz exatamente o link que o script aceita: wa.me seguido
//   so dos numeros (sem +), ou api.whatsapp.com/send. O link curto do
//   WhatsApp Business (wa.me/message/...) e os encurtadores ficam de fora
//   (o mesmo LINK_DO_WHATSAPP do modulo do rastreio e do v1.js).
// - "Gerar nova chave" pede confirmacao (a linha que esta no site para de
//   valer na hora). Foco do teclado como no "Remover token" do cartao da
//   Meta: a confirmacao recebe o foco ao aparecer e, ao cancelar ou quando a
//   troca falha, o foco volta ao botao.
// - Toda acao fica visivel; sem permissao, desabilitada com a dica.
// - "Mensagem do botao sem texto pronto" (ajuste do dono em 04/10/2026,
//   migration 20261005110000): de 1 a 5 frases que o script poe antes do
//   codigo quando o botao do site nao tem texto pronto (com mais de uma, o
//   script sorteia uma por clique). As regras de cada frase sao as do modulo
//   do rastreio (frasesDoRastreioSchema, os mesmos checks do banco): a tela
//   confere antes de mandar e a acao confere de novo. O site busca as frases
//   pela chave, entao salvar nao exige colar a linha de novo. Com o rastreio
//   desligado, a busca nao devolve nada e o site usa a FRASE_PADRAO: a tela
//   avisa. Sem linha, a gestao ve a frase padrao (o que o site usaria) e
//   salvar cria a linha desligada.
//
// Modulo "use client": as regras puras abaixo sao exportadas para os testes.
// A pagina (servidor) nao importa nada daqui alem de tipos: ela manda a
// linha e a resposta crua da situacao, e o parse acontece aqui.

/** A linha de rastreio_do_site que a gestao le. Nula: a clinica nunca ligou. */
export type LinhaDoRastreio = {
  chave: string;
  ativo: boolean;
  chave_trocada_em: string;
  ultimo_clique_em: string | null;
  /** As frases do botao sem texto pronto (de 1 a 5; default do banco). */
  frases: string[];
};

/** Os totais de situacao_do_rastreio (nunca a chave, o gclid ou o contato). */
export type SituacaoDoRastreio = {
  configurado: boolean;
  ativo: boolean;
  chaveTrocadaEm: string | null;
  ultimoCliqueEm: string | null;
  cliques7Dias: number;
  casados7Dias: number;
};

export type EstadoDoRastreio =
  "desligado" | "esperando" | "recebendo" | "sem_cliques_recentes";

/** A janela do "recebendo": a mesma dos totais de situacao_do_rastreio. */
export const JANELA_DE_CLIQUES_MS = 7 * 24 * 60 * 60 * 1000;

// Tres camadas, so com icones que ja tem dono no mesmo sentido e na mesma cor
// (tabela de icones reservados de lib/design/status.ts):
// - desligado: CirclePause neutro, o mesmo da regua "Desligada";
// - esperando: Hourglass warning, pendencia (ligado, nenhum clique com a
//   chave atual), como o "Ainda nao testada" da leitura da Meta;
// - recebendo: CircleCheck success;
// - sem_cliques_recentes: Watch warning, o mesmo sentido do "Esfriando" do
//   lead (tempo demais sem atividade), forma propria e diferente da
//   ampulheta do esperando.
export const RASTREIO_DO_SITE_STATUS: Record<
  EstadoDoRastreio,
  StatusDefinition
> = {
  desligado: { label: "Desligado", tone: "neutral", icon: CirclePause },
  esperando: {
    label: "Esperando o primeiro clique",
    tone: "warning",
    icon: Hourglass,
  },
  recebendo: {
    label: "Recebendo cliques",
    tone: "success",
    icon: CircleCheck,
  },
  sem_cliques_recentes: {
    label: "Sem cliques nos últimos 7 dias",
    tone: "warning",
    icon: Watch,
  },
};

/**
 * O sufixo do URL final que a clinica cola no Google Ads (ValueTrack): o do
 * modulo do rastreio, que o script do site le. Sem ele, vale o
 * gad_campaignid que o Google ja poe sozinho (sem o grupo de anuncios).
 */
export const SUFIXO_DO_GOOGLE_ADS = SUFIXO_DE_URL_FINAL;

/** Exemplo do codigo que o site acrescenta ao texto do WhatsApp. */
const EXEMPLO_DO_CODIGO = "[#K7Q2MX]";

export const TEXTOS_DO_RASTREIO = {
  ligueParaGerar: "Ligue o rastreio para gerar a linha do site.",
  chaveNasceAoLigar:
    "A chave nasce quando o rastreio é ligado pela primeira vez.",
  semEndereco:
    "O endereço público do sistema não está configurado, então a linha do site ainda não pode ser montada. Fale com o suporte.",
  enderecoDeTeste:
    "Este endereço é de teste. Não cole esta linha no site de uma clínica de verdade.",
  desligadoComLinha:
    "Com o rastreio desligado, nenhum clique é registrado, mas a linha que está no site continua acrescentando o código à mensagem de quem vem de anúncio do Google. Para parar de vez, tire a linha do site.",
  semCliqueComAChaveAtual:
    "Nenhum clique chegou com a chave atual. Se o site ainda tem a linha anterior, troque pela linha acima.",
  semCliquesRecentes:
    "Nenhum clique chegou nos últimos 7 dias. Confira se a linha continua no site e se os anúncios do Google estão no ar.",
  confirmarTroca:
    "Gerar uma chave nova? A linha que está no site para de valer na hora e precisa ser trocada pela nova. Os cliques já recebidos continuam valendo.",
  chaveTrocada:
    "Chave nova gerada. Troque a linha no site: a anterior parou de valer.",
  situacaoIlegivel:
    "Não foi possível carregar a situação do rastreio. Recarregue a página.",
  semResposta: "O servidor não respondeu. Confira a conexão e tente de novo.",
  copiaFalhouLinha: "Não foi possível copiar. Selecione a linha e copie à mão.",
  copiaFalhouSufixo:
    "Não foi possível copiar. Selecione o sufixo e copie à mão.",
  nenhumClique: "Nenhum clique recebido ainda",
  conectarEmBreve:
    "Em breve. A conexão com o Google Ads ainda está sendo preparada pela Conduzza.",
} as const;

/** Maquina local e tuneis de desenvolvimento (o endereco muda a cada sessao). */
const HOSTS_LOCAIS = ["localhost", "127.0.0.1"];
const HOSTS_DE_TESTE = [
  ".trycloudflare.com",
  ".ngrok-free.app",
  ".ngrok.app",
  ".ngrok.io",
  ".loca.lt",
];

function instante(valor: string | null | undefined): number | null {
  if (!valor) {
    return null;
  }
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? ms : null;
}

function textoOuNulo(valor: unknown): string | null | undefined {
  if (valor === null) {
    return null;
  }
  return typeof valor === "string" ? valor : undefined;
}

function contagem(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0
    ? valor
    : null;
}

/**
 * A resposta crua de situacao_do_rastreio, conferida campo a campo. Formato
 * inesperado vira nulo (a tela diz que nao carregou, em vez de mostrar zero).
 */
export function situacaoDaResposta(valor: unknown): SituacaoDoRastreio | null {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    return null;
  }
  const bruto = valor as Record<string, unknown>;
  const chaveTrocadaEm = textoOuNulo(bruto.chave_trocada_em);
  const ultimoCliqueEm = textoOuNulo(bruto.ultimo_clique_em);
  const cliques7Dias = contagem(bruto.cliques_7_dias);
  const casados7Dias = contagem(bruto.casados_7_dias);
  if (
    typeof bruto.configurado !== "boolean" ||
    typeof bruto.ativo !== "boolean" ||
    chaveTrocadaEm === undefined ||
    ultimoCliqueEm === undefined ||
    cliques7Dias === null ||
    casados7Dias === null
  ) {
    return null;
  }
  return {
    configurado: bruto.configurado,
    ativo: bruto.ativo,
    chaveTrocadaEm,
    ultimoCliqueEm,
    cliques7Dias,
    casados7Dias,
  };
}

/** Chegou clique desde que a chave atual nasceu? */
export function chegouCliqueComAChaveAtual(linha: LinhaDoRastreio): boolean {
  const ultimo = instante(linha.ultimo_clique_em);
  if (ultimo === null) {
    return false;
  }
  const trocada = instante(linha.chave_trocada_em);
  return trocada === null || ultimo >= trocada;
}

/**
 * O estado do chip na hora de referencia (agoraMs, vinda do servidor):
 * "recebendo" so com clique da chave atual ate 7 dias atras (inclusive, como
 * a janela de situacao_do_rastreio). Clique mais velho, ou religar depois de
 * meses parado, vira "sem_cliques_recentes".
 */
export function estadoDoRastreio(
  linha: LinhaDoRastreio | null,
  agoraMs: number,
): EstadoDoRastreio {
  if (!linha || !linha.ativo) {
    return "desligado";
  }
  if (!chegouCliqueComAChaveAtual(linha)) {
    return "esperando";
  }
  const ultimo = instante(linha.ultimo_clique_em);
  return ultimo !== null && agoraMs - ultimo <= JANELA_DE_CLIQUES_MS
    ? "recebendo"
    : "sem_cliques_recentes";
}

/**
 * A origem do endereco publico do sistema, ou nulo quando ele falta ou nao
 * serve: o site da clinica e https e bloqueia script em http (conteudo
 * misto). http so em localhost, para desenvolvimento (a mesma regra do
 * linhaDoScript do modulo do rastreio). Usuario e senha na URL nunca.
 */
export function origemDoSistema(
  valor: string | null | undefined,
): string | null {
  const limpo = valor?.trim();
  if (!limpo) {
    return null;
  }
  try {
    const url = new URL(limpo);
    const local = HOSTS_LOCAIS.includes(url.hostname);
    if (url.username || url.password) {
      return null;
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Endereco local ou de tunel de desenvolvimento: a tela avisa. */
export function enderecoDeTeste(origem: string): boolean {
  try {
    const host = new URL(origem).hostname;
    return (
      HOSTS_LOCAIS.includes(host) ||
      HOSTS_DE_TESTE.some((final) => host.endsWith(final))
    );
  } catch {
    return false;
  }
}

/**
 * A linha pronta para colar: a origem validada aqui e a linha montada pelo
 * modulo do rastreio (a mesma da rota publica). Nula sem endereco ou com a
 * chave fora do formato do banco.
 */
export function linhaParaColar(
  enderecoDoSistema: string | null | undefined,
  chave: string,
): string | null {
  const origem = origemDoSistema(enderecoDoSistema);
  return origem ? linhaDoScript(origem, chave) : null;
}

/** "04/10/2026 às 14:32" no fuso da clinica (CLAUDE.md 3.6). */
export function textoDoUltimoClique(
  iso: string | null | undefined,
  timezone: string,
): string {
  const ms = instante(iso);
  if (ms === null) {
    return TEXTOS_DO_RASTREIO.nenhumClique;
  }
  return format(new TZDate(ms, timezone), "dd/MM/yyyy 'às' HH:mm");
}

/** "Chave em uso desde 04/10/2026", no fuso da clinica. */
export function textoDaChaveEmUso(
  iso: string | null | undefined,
  timezone: string,
): string | null {
  const ms = instante(iso);
  if (ms === null) {
    return null;
  }
  return `Chave em uso desde ${format(new TZDate(ms, timezone), "dd/MM/yyyy")}`;
}

export type AcaoDoRastreio = "alternar" | "copiarLinha" | "trocarChave";

/**
 * A dica de cada controle desabilitado (nula = liberado): a permissao
 * primeiro, depois o que falta. Exportada para o teste, porque a dica so
 * aparece no HTML quando o tooltip abre.
 */
export function dicasDoRastreio(entrada: {
  podeGerenciar: boolean;
  dica: string;
  temLinha: boolean;
  temEndereco: boolean;
}): Record<AcaoDoRastreio, string | null> {
  const { podeGerenciar, dica, temLinha, temEndereco } = entrada;
  return {
    alternar: podeGerenciar ? null : dica,
    copiarLinha: !temLinha
      ? podeGerenciar
        ? TEXTOS_DO_RASTREIO.ligueParaGerar
        : dica
      : temEndereco
        ? null
        : TEXTOS_DO_RASTREIO.semEndereco,
    trocarChave: !podeGerenciar
      ? dica
      : temLinha
        ? null
        : TEXTOS_DO_RASTREIO.chaveNasceAoLigar,
  };
}

// ---------------------------------------------------------------------------
// Frases do botao sem texto pronto (regras puras)
// ---------------------------------------------------------------------------

export const TEXTOS_DAS_FRASES = {
  titulo: "Mensagem do botão sem texto pronto",
  quandoUsa:
    "Quando o botão do WhatsApp do site não traz texto pronto, a conversa já abre com uma destas frases e o código no fim. Botão com texto pronto continua com o texto dele.",
  semColarDeNovo:
    "Não precisa colar a linha de novo no site. Se o site não conseguir buscar as frases a tempo, vale a frase padrão.",
  desligado:
    "Com o rastreio desligado, o site usa a frase padrão. As frases abaixo passam a valer quando o rastreio estiver ligado.",
  sorteio: "Com mais de uma frase, o sistema sorteia uma a cada clique.",
  semAcesso: "As frases aparecem para administradores e gestores.",
  limite: `São no máximo ${LIMITE_DE_FRASES} frases. Remova uma para adicionar outra.`,
  minimo: "A lista precisa de pelo menos uma frase.",
  jaEPadrao: "A lista já tem só a frase padrão.",
  semAlteracao: "Nenhuma alteração para salvar.",
  confira: "Confira as frases marcadas antes de salvar.",
  salvas:
    "Frases salvas. O site passa a usar as frases novas, sem colar a linha de novo.",
  naoSalvas: "Alterações ainda não salvas.",
  previaTitulo: "Como chega no WhatsApp da clínica",
  previaVazia: "Escreva uma frase para ver como ela chega.",
  previaCodigo: "O código muda a cada clique.",
} as const;

/**
 * As frases da linha como o site as usa: as gravadas, se passam nas regras
 * do banco; sem linha ou fora da regra, a FRASE_PADRAO (a rota confere a
 * saida com a mesma regra e, fora dela, o script fica com a padrao).
 */
export function frasesDaLinha(linha: LinhaDoRastreio | null): string[] {
  return (linha ? frasesNoFormato(linha.frases) : null) ?? [FRASE_PADRAO];
}

/** "Frase [#K7Q2MX]": como a mensagem chega. Frase em branco: nula. */
export function previaDaFrase(frase: string): string | null {
  const limpa = frase.trim();
  return limpa ? `${limpa} ${EXEMPLO_DO_CODIGO}` : null;
}

export type ErrosDasFrases = {
  /** Uma mensagem por frase (nula = a frase passa), na ordem da lista. */
  porFrase: (string | null)[];
  /** Problema da lista inteira (nenhuma frase, mais de cinco). */
  daLista: string | null;
};

/**
 * O que impede salvar, pelas regras do modulo do rastreio (o mesmo schema
 * que a acao usa): nulo quando a lista passa. Por frase, a primeira regra
 * quebrada, no texto do proprio schema.
 */
export function errosDasFrases(
  lista: readonly string[],
): ErrosDasFrases | null {
  const resultado = frasesDoRastreioSchema.safeParse(lista);
  if (resultado.success) {
    return null;
  }
  const porFrase: (string | null)[] = lista.map(() => null);
  let daLista: string | null = null;
  for (const problema of resultado.error.issues) {
    const [indice] = problema.path;
    if (typeof indice === "number" && indice < porFrase.length) {
      porFrase[indice] ??= problema.message;
    } else {
      daLista ??= problema.message;
    }
  }
  return { porFrase, daLista };
}

/** Mesma lista, item a item (sem aparar: espaco a mais ainda nao foi salvo). */
export function mesmasFrases(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && a.every((frase, i) => frase === b[i]);
}

/**
 * O que o bloco faz quando as frases que vem do servidor mudam depois da
 * montagem (outra pessoa, ou outra aba, salvou, e uma acao do cartao
 * revalidou a pagina). Sem alteracao local, a lista acompanha o servidor;
 * com alteracao, a edicao fica e so a referencia do que esta salvo muda
 * (o "Salvar" passa a comparar com o que vale de verdade). Depois do proprio
 * salvar, o servidor traz o que a acao ja devolveu: nada muda.
 */
export function acompanharOServidor(entrada: {
  textos: readonly string[];
  salvas: readonly string[];
  doServidor: readonly string[];
}): { trocarItens: boolean; trocarSalvas: boolean } {
  const { textos, salvas, doServidor } = entrada;
  return {
    trocarItens:
      mesmasFrases(textos, salvas) && !mesmasFrases(textos, doServidor),
    trocarSalvas: !mesmasFrases(salvas, doServidor),
  };
}

export type AcaoDasFrases = "adicionar" | "remover" | "restaurar" | "salvar";

/**
 * A dica de cada controle das frases desabilitado (nula = liberado): a
 * permissao primeiro, depois o que falta. Exportada para o teste, porque a
 * dica so aparece no HTML quando o tooltip abre.
 */
export function dicasDasFrases(entrada: {
  podeGerenciar: boolean;
  dica: string;
  quantidade: number;
  soAPadrao: boolean;
  alterou: boolean;
}): Record<AcaoDasFrases, string | null> {
  const { podeGerenciar, dica, quantidade, soAPadrao, alterou } = entrada;
  if (!podeGerenciar) {
    return { adicionar: dica, remover: dica, restaurar: dica, salvar: dica };
  }
  return {
    adicionar: quantidade >= LIMITE_DE_FRASES ? TEXTOS_DAS_FRASES.limite : null,
    remover: quantidade <= 1 ? TEXTOS_DAS_FRASES.minimo : null,
    restaurar: soAPadrao ? TEXTOS_DAS_FRASES.jaEPadrao : null,
    salvar: alterou ? null : TEXTOS_DAS_FRASES.semAlteracao,
  };
}

function comDica(controle: React.ReactNode, dica: string | null) {
  return dica ? (
    <DisabledWithHint hint={dica}>{controle}</DisabledWithHint>
  ) : (
    controle
  );
}

function CodigoEmLinha({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-sm bg-surface-3 px-1 py-px font-mono text-[12px] break-all text-text-strong">
      {children}
    </code>
  );
}

type Resultado = { tom: "success" | "alert"; texto: string };
type Acao = "alternar" | "trocar";

export type RastreioDoSiteCardProps = {
  /** A linha da clinica; nula enquanto o rastreio nunca foi ligado. */
  linha: LinhaDoRastreio | null;
  /** Os totais; nulo quando a leitura falhou. */
  situacao: SituacaoDoRastreio | null;
  /** PUBLIC_APP_URL do servidor, cru (a validacao e daqui). */
  enderecoDoSistema: string | null;
  /** Fuso da clinica (CLAUDE.md 3.6). */
  timezone: string;
  /**
   * A hora de referencia do chip, do servidor (Date.now() na pagina): o
   * render do cliente nao le o relogio, e a hidratacao bate.
   */
  agoraMs: number;
  podeGerenciar: boolean;
  dica: string;
};

export function RastreioDoSiteCard({
  linha,
  situacao,
  enderecoDoSistema,
  timezone,
  agoraMs,
  podeGerenciar,
  dica,
}: RastreioDoSiteCardProps) {
  const ids = useId();
  const tituloId = `${ids}-titulo`;
  const chaveId = `${ids}-ligado`;
  const linhaTituloId = `${ids}-linha-titulo`;
  const situacaoTituloId = `${ids}-situacao-titulo`;
  const passosTituloId = `${ids}-passos-titulo`;
  const confirmacaoId = `${ids}-confirmacao`;

  const [acao, setAcao] = useState<Acao | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [confirmandoTroca, setConfirmandoTroca] = useState(false);
  const [copiado, setCopiado] = useState<"linha" | "sufixo" | null>(null);
  const [pendente, startTransition] = useTransition();

  const timerDaCopia = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timerDaCopia.current !== null) {
        window.clearTimeout(timerDaCopia.current);
      }
    },
    [],
  );

  // Foco na confirmacao inline: o "Gerar nova chave" sai da tela com o foco.
  // A confirmacao recebe o foco ao aparecer (no grupo, nao no botao de
  // confirmar: um Enter repetido nao troca a chave sem leitura). Ao cancelar,
  // ou se a troca falhar, o foco volta ao "Gerar nova chave". So quando o
  // foco se perdeu: quem ja esta em outro campo fica onde esta.
  const grupoDaConfirmacao = useRef<HTMLDivElement>(null);
  const botaoTrocarChave = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);
  useEffect(() => {
    if (confirmandoTroca) {
      if (focoPerdido()) {
        grupoDaConfirmacao.current?.focus();
      }
      return;
    }
    if (pendente || !devolverFoco.current) {
      return;
    }
    devolverFoco.current = false;
    const botao = botaoTrocarChave.current;
    if (botao && !botao.disabled && focoPerdido()) {
      botao.focus();
    }
  }, [confirmandoTroca, pendente]);

  const origem = origemDoSistema(enderecoDoSistema);
  const linhaPronta = linha
    ? linhaParaColar(enderecoDoSistema, linha.chave)
    : null;
  const estado = estadoDoRastreio(linha, agoraMs);
  const ligado = linha?.ativo ?? false;
  const chaveEmUso = linha
    ? textoDaChaveEmUso(linha.chave_trocada_em, timezone)
    : null;
  const semCliqueDesdeATroca =
    estado === "esperando" &&
    linha !== null &&
    instante(linha.ultimo_clique_em) !== null;

  const dicas = dicasDoRastreio({
    podeGerenciar,
    dica,
    temLinha: linha !== null,
    temEndereco: origem !== null,
  });

  const executar = (qual: Acao, tarefa: () => Promise<void>) => {
    setResultado(null);
    setAcao(qual);
    startTransition(async () => {
      try {
        await tarefa();
      } catch {
        if (qual === "trocar") {
          devolverFoco.current = true;
          setConfirmandoTroca(false);
        }
        setResultado({ tom: "alert", texto: TEXTOS_DO_RASTREIO.semResposta });
      }
    });
  };

  const alternar = (ligar: boolean) =>
    executar("alternar", async () => {
      const r = await alternarRastreioDoSiteAction({ ligar });
      if (!r.ok) {
        setResultado({ tom: "alert", texto: r.error });
        return;
      }
      toast.success(
        ligar ? "Rastreio do site ligado." : "Rastreio do site desligado.",
      );
    });

  const trocar = () =>
    executar("trocar", async () => {
      const r = await trocarChaveDoRastreioAction();
      devolverFoco.current = !r.ok;
      setConfirmandoTroca(false);
      setResultado(
        r.ok
          ? { tom: "success", texto: TEXTOS_DO_RASTREIO.chaveTrocada }
          : { tom: "alert", texto: r.error },
      );
    });

  const copiar = async (qual: "linha" | "sufixo", texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
      if (timerDaCopia.current !== null) {
        window.clearTimeout(timerDaCopia.current);
      }
      timerDaCopia.current = window.setTimeout(() => setCopiado(null), 2000);
    } catch {
      setResultado({
        tom: "alert",
        texto:
          qual === "linha"
            ? TEXTOS_DO_RASTREIO.copiaFalhouLinha
            : TEXTOS_DO_RASTREIO.copiaFalhouSufixo,
      });
    }
  };

  const ocupado = (qual: Acao) => pendente && acao === qual;

  const chave = (
    <Switch
      id={chaveId}
      checked={ligado}
      onCheckedChange={alternar}
      disabled={dicas.alternar !== null || pendente}
      aria-busy={ocupado("alternar") || undefined}
    />
  );
  const botaoCopiarLinha = (
    <Button
      variant="outline"
      onClick={() => {
        if (linhaPronta) {
          void copiar("linha", linhaPronta);
        }
      }}
      disabled={dicas.copiarLinha !== null || linhaPronta === null}
    >
      <Copy aria-hidden />
      {copiado === "linha" ? "Linha copiada" : "Copiar a linha"}
    </Button>
  );
  const botaoTrocar = (
    <Button
      ref={botaoTrocarChave}
      variant="ghost"
      onClick={() => setConfirmandoTroca(true)}
      disabled={dicas.trocarChave !== null || pendente}
      aria-busy={ocupado("trocar") || undefined}
    >
      <RefreshCw aria-hidden />
      {ocupado("trocar") ? "Gerando..." : "Gerar nova chave"}
    </Button>
  );

  return (
    <Card role="region" aria-labelledby={tituloId}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          {/* Ladrilho decorativo: a cor nao diz estado. */}
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3"
          >
            <Globe className="size-5 text-text-strong" />
          </span>
          <div className="grid min-w-0 gap-[3px]">
            <CardTitle id={tituloId}>Rastreio do site</CardTitle>
            <CardDescription>
              Quando o anúncio do Google leva ao site da clínica, a linha abaixo
              marca o clique no botão do WhatsApp. O lead chega com a origem
              Tráfego pago, Google e o número da campanha, sem cadastro manual.
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <StatusChip size="sm" definition={RASTREIO_DO_SITE_STATUS[estado]} />
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-6">
        <div className="flex min-h-10 flex-wrap items-center gap-2.5">
          {comDica(chave, dicas.alternar)}
          <Label htmlFor={chaveId}>
            {ligado
              ? "Rastreando os cliques do site"
              : "Rastrear os cliques do site"}
          </Label>
          {ocupado("alternar") ? (
            <span className="text-[13px] text-text-secondary">Salvando...</span>
          ) : null}
        </div>

        <section className="grid gap-2.5" aria-labelledby={linhaTituloId}>
          <h3
            id={linhaTituloId}
            className="text-[13.5px] font-semibold text-text-strong"
          >
            Linha para colar no site
          </h3>
          {linhaPronta ? (
            <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 px-3.5 py-3 font-mono text-[12.5px] leading-relaxed break-all whitespace-pre-wrap text-text-strong select-all">
              <code>{linhaPronta}</code>
            </pre>
          ) : (
            <p className="rounded-lg border border-dashed border-border-strong bg-surface-2 px-3.5 py-3 text-[13px] text-text-secondary">
              {linha
                ? "A linha aparece quando o endereço público do sistema estiver configurado."
                : TEXTOS_DO_RASTREIO.ligueParaGerar}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {comDica(botaoCopiarLinha, dicas.copiarLinha)}
            {confirmandoTroca ? null : comDica(botaoTrocar, dicas.trocarChave)}
          </div>

          {confirmandoTroca ? (
            <div
              ref={grupoDaConfirmacao}
              tabIndex={-1}
              role="group"
              aria-label="Confirmar a troca da chave do rastreio"
              aria-describedby={confirmacaoId}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-warning-bg px-3.5 py-3 text-warning-text"
            >
              <p id={confirmacaoId} className="min-w-0 flex-1 text-[13px]">
                {TEXTOS_DO_RASTREIO.confirmarTroca}
              </p>
              <Button
                variant="destructive"
                onClick={trocar}
                disabled={pendente}
                aria-busy={ocupado("trocar") || undefined}
              >
                {ocupado("trocar") ? "Gerando..." : "Gerar a chave nova"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  devolverFoco.current = true;
                  setConfirmandoTroca(false);
                }}
                disabled={pendente}
              >
                Cancelar
              </Button>
            </div>
          ) : null}

          {chaveEmUso ? (
            <p className="text-[12px] text-text-secondary">{chaveEmUso}</p>
          ) : null}
          {linha && !linha.ativo ? (
            <p className="text-[13px] text-text-secondary">
              {TEXTOS_DO_RASTREIO.desligadoComLinha}
            </p>
          ) : null}
          {origem === null ? (
            <Aviso tom="warning" role="note">
              {TEXTOS_DO_RASTREIO.semEndereco}
            </Aviso>
          ) : enderecoDeTeste(origem) ? (
            <Aviso tom="warning" role="note">
              {TEXTOS_DO_RASTREIO.enderecoDeTeste}
            </Aviso>
          ) : null}
          {semCliqueDesdeATroca ? (
            <Aviso tom="info" role="note">
              {TEXTOS_DO_RASTREIO.semCliqueComAChaveAtual}
            </Aviso>
          ) : null}
          {estado === "sem_cliques_recentes" ? (
            <Aviso tom="warning" role="note">
              {TEXTOS_DO_RASTREIO.semCliquesRecentes}
            </Aviso>
          ) : null}
        </section>

        {/* Sempre montada: o leitor de tela anuncia o resultado novo. */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="grid gap-2 empty:-mt-6"
        >
          {resultado ? (
            <Aviso tom={resultado.tom} role="note">
              {resultado.texto}
            </Aviso>
          ) : null}
        </div>

        <FrasesDoBotao
          // A gestao sem linha ve a padrao (o que o site usaria); quem nao
          // le a linha (a RLS so mostra para a gestao) nao ve conteudo.
          frases={linha || podeGerenciar ? frasesDaLinha(linha) : null}
          ligado={ligado}
          podeGerenciar={podeGerenciar}
          dica={dica}
        />

        <section className="grid gap-2.5" aria-labelledby={situacaoTituloId}>
          <h3
            id={situacaoTituloId}
            className="text-[13.5px] font-semibold text-text-strong"
          >
            Situação
          </h3>
          {situacao ? (
            <dl className="grid gap-2 sm:grid-cols-3">
              <div className="grid content-start gap-0.5 rounded-lg bg-surface-2 px-3.5 py-3">
                <dt className="text-[12px] text-text-secondary">
                  Último clique recebido
                </dt>
                <dd className="cz-num text-[15px] font-semibold text-text-strong">
                  {textoDoUltimoClique(situacao.ultimoCliqueEm, timezone)}
                </dd>
              </div>
              <div className="grid content-start gap-0.5 rounded-lg bg-surface-2 px-3.5 py-3">
                <dt className="text-[12px] text-text-secondary">
                  Cliques nos últimos 7 dias
                </dt>
                <dd className="cz-num text-[15px] font-semibold text-text-strong">
                  {situacao.cliques7Dias}
                </dd>
              </div>
              <div className="grid content-start gap-0.5 rounded-lg bg-surface-2 px-3.5 py-3">
                <dt className="text-[12px] text-text-secondary">
                  Chegaram ao WhatsApp nos últimos 7 dias
                </dt>
                <dd className="cz-num text-[15px] font-semibold text-text-strong">
                  {situacao.casados7Dias}
                </dd>
              </div>
            </dl>
          ) : (
            <Aviso tom="alert" role="note">
              {TEXTOS_DO_RASTREIO.situacaoIlegivel}
            </Aviso>
          )}
          <p className="text-[12px] text-text-secondary">
            Só totais. Quem clicou aparece no lead, quando a pessoa envia a
            mensagem com o código.
          </p>
        </section>

        <section className="grid gap-2.5" aria-labelledby={passosTituloId}>
          <h3
            id={passosTituloId}
            className="text-[13.5px] font-semibold text-text-strong"
          >
            Como instalar no site
          </h3>
          <ol className="grid list-decimal gap-2.5 pl-5 text-[13px] leading-[1.5] text-foreground marker:text-text-secondary">
            <li>Ligue o rastreio e copie a linha acima.</li>
            <li>
              No site da clínica, cole a linha antes do fim da página (logo
              antes de <CodigoEmLinha>{"</body>"}</CodigoEmLinha>), em todas as
              páginas. Se o site usa o Gerenciador de Tags do Google, crie uma
              tag de HTML personalizado com a linha, disparada em todas as
              páginas.
            </li>
            <li>
              O botão do WhatsApp do site precisa ser um link wa.me seguido só
              dos números do telefone, sem o sinal de mais, como{" "}
              <CodigoEmLinha>https://wa.me/5584999990000</CodigoEmLinha> (um
              link <CodigoEmLinha>https://api.whatsapp.com/send</CodigoEmLinha>{" "}
              também serve). O link curto do WhatsApp Business (
              <CodigoEmLinha>wa.me/message/...</CodigoEmLinha>), os encurtadores
              como wa.link e o botão que abre o WhatsApp de outro jeito não
              recebem o código.
            </li>
            <li>
              {/* O li fica list-item (grid apagaria o numero): a grade vai
                  num div por dentro. */}
              <div className="grid gap-2">
                <span>
                  No Google Ads, deixe a codificação automática (marcação
                  automática) ligada, em Administrador, Configurações da conta.
                  Ainda em Configurações da conta, em Acompanhamento, cole o
                  sufixo abaixo no Sufixo de URL final. Campanha que tem sufixo
                  próprio precisa dele também.
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <code className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-[12.5px] break-all text-text-strong select-all">
                    {SUFIXO_DO_GOOGLE_ADS}
                  </code>
                  <Button
                    variant="outline"
                    onClick={() => void copiar("sufixo", SUFIXO_DO_GOOGLE_ADS)}
                  >
                    <Copy aria-hidden />
                    {copiado === "sufixo"
                      ? "Sufixo copiado"
                      : "Copiar o sufixo"}
                  </Button>
                </span>
              </div>
            </li>
            <li>
              Não mude o endereço do anúncio: ele continua sendo o site da
              clínica. O endereço do Conduzza nunca vai no anúncio.
            </li>
            <li>
              Para conferir, abra o site com{" "}
              <CodigoEmLinha>?gclid=teste</CodigoEmLinha> no fim do endereço e
              toque no botão do WhatsApp: o texto da mensagem ganha um código
              como <CodigoEmLinha>{EXEMPLO_DO_CODIGO}</CodigoEmLinha>. Não envie
              a mensagem de teste: o seu número ficaria com a origem do Google
              para sempre. Ao recarregar esta página, o clique aparece na
              situação.
            </li>
          </ol>
          <p className="text-[12px] text-text-secondary">
            Se a pessoa apagar o código antes de enviar, o lead chega sem
            origem, e a recepção pode preencher depois. O rastreio nunca grava
            uma origem errada.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bloco "Mensagem do botao sem texto pronto"
// ---------------------------------------------------------------------------

/**
 * Uma frase da lista em edicao; o id estavel mantem foco e erro no lugar.
 * "n<numero>" nasce no proprio bloco; "s<geracao>-<posicao>" nasce quando
 * a lista acompanha o servidor (nunca colidem).
 */
type ItemDaFrase = { id: string; texto: string };

export type FrasesDoBotaoProps = {
  /**
   * As frases gravadas (ou a padrao, para a gestao sem linha). Nulas quando
   * o papel nao le a linha: o bloco mostra as acoes presas, sem o conteudo.
   */
  frases: string[] | null;
  /** O rastreio esta ligado? Desligado, o site usa a frase padrao. */
  ligado: boolean;
  podeGerenciar: boolean;
  dica: string;
};

export function FrasesDoBotao({
  frases,
  ligado,
  podeGerenciar,
  dica,
}: FrasesDoBotaoProps) {
  const ids = useId();
  const tituloId = `${ids}-frases-titulo`;
  const explicacaoId = `${ids}-frases-explicacao`;
  const previaTituloId = `${ids}-frases-previa`;

  const iniciais = frases ?? [];
  // O estado nasce das props. Depois do proprio salvar, o que ficou gravado
  // vem da resposta da acao. Quando as props mudam depois da montagem (outra
  // pessoa salvou e ligar, desligar ou trocar a chave revalidou a pagina),
  // a lista acompanha logo abaixo, sem remontar o bloco: remontar apagaria
  // o "Frases salvas." da regiao anunciada.
  const [itens, setItens] = useState<ItemDaFrase[]>(() =>
    iniciais.map((texto, i) => ({ id: `n${i}`, texto })),
  );
  const [salvas, setSalvas] = useState<string[]>(iniciais);
  const [erros, setErros] = useState<ErrosDasFrases | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pendente, startTransition] = useTransition();
  const proximoId = useRef(iniciais.length);
  const versao = JSON.stringify(frases);
  const [vista, setVista] = useState({ versao, geracao: 0 });

  // Foco depois de adicionar, remover, restaurar ou de um salvar recusado:
  // o controle que tinha o foco pode ter saido da tela.
  const campos = useRef(new Map<string, HTMLInputElement>());
  const focarNoItem = useRef<string | null>(null);
  useEffect(() => {
    const alvo = focarNoItem.current;
    if (alvo === null) {
      return;
    }
    focarNoItem.current = null;
    campos.current.get(alvo)?.focus();
  });

  const textos = itens.map((item) => item.texto);

  // Estado derivado das props (o padrao do React para "ajustar o estado
  // quando a prop muda"): roda no render, uma vez por versao do servidor.
  if (vista.versao !== versao) {
    const geracao = vista.geracao + 1;
    setVista({ versao, geracao });
    const doServidor = frases ?? [];
    const passo = acompanharOServidor({ textos, salvas, doServidor });
    if (passo.trocarItens) {
      // A mesma posicao fica com o mesmo id: o campo nao remonta e quem
      // estava nele nao perde o foco.
      setItens(
        doServidor.map((texto, i) => ({
          id: itens[i]?.id ?? `s${geracao}-${i}`,
          texto,
        })),
      );
      setErros(null);
    }
    if (passo.trocarSalvas) {
      setSalvas(doServidor);
    }
  }

  const alterou = !mesmasFrases(textos, salvas);
  const soAPadrao = mesmasFrases(textos, [FRASE_PADRAO]);
  const dicas = dicasDasFrases({
    podeGerenciar,
    dica,
    quantidade: itens.length,
    soAPadrao,
    alterou,
  });
  const previas = textos
    .map(previaDaFrase)
    .filter((previa): previa is string => previa !== null);

  const limparRetorno = () => {
    setResultado(null);
  };

  const mudar = (id: string, texto: string) => {
    limparRetorno();
    const indice = itens.findIndex((item) => item.id === id);
    setItens((atuais) =>
      atuais.map((item) => (item.id === id ? { ...item, texto } : item)),
    );
    if (erros && indice >= 0) {
      setErros({
        porFrase: erros.porFrase.map((erro, i) => (i === indice ? null : erro)),
        daLista: erros.daLista,
      });
    }
  };

  const adicionar = () => {
    if (itens.length >= LIMITE_DE_FRASES) {
      return;
    }
    limparRetorno();
    const id = `n${proximoId.current++}`;
    setItens((atuais) => [...atuais, { id, texto: "" }]);
    setErros((atuais) =>
      atuais ? { porFrase: [...atuais.porFrase, null], daLista: null } : null,
    );
    focarNoItem.current = id;
  };

  const remover = (id: string) => {
    if (itens.length <= 1) {
      return;
    }
    limparRetorno();
    const indice = itens.findIndex((item) => item.id === id);
    const restantes = itens.filter((item) => item.id !== id);
    setItens(restantes);
    setErros((atuais) =>
      atuais
        ? {
            porFrase: atuais.porFrase.filter((_, i) => i !== indice),
            daLista: null,
          }
        : null,
    );
    // O botao de remover sai da tela com o foco: vai para a frase que ficou
    // no lugar (ou a anterior, quando era a ultima).
    const vizinha = restantes[Math.min(indice, restantes.length - 1)];
    focarNoItem.current = vizinha?.id ?? null;
  };

  const restaurar = () => {
    limparRetorno();
    const id = `n${proximoId.current++}`;
    setItens([{ id, texto: FRASE_PADRAO }]);
    setErros(null);
    focarNoItem.current = id;
  };

  const salvar = () => {
    limparRetorno();
    const problemas = errosDasFrases(textos);
    if (problemas) {
      setErros(problemas);
      setResultado({
        tom: "alert",
        texto: problemas.daLista ?? TEXTOS_DAS_FRASES.confira,
      });
      const primeiro = problemas.porFrase.findIndex((erro) => erro !== null);
      focarNoItem.current =
        primeiro >= 0 ? (itens[primeiro]?.id ?? null) : null;
      return;
    }
    setErros(null);
    startTransition(async () => {
      try {
        const r = await salvarFrasesDoRastreioAction({ frases: textos });
        if (!r.ok) {
          setResultado({ tom: "alert", texto: r.error });
          return;
        }
        // As frases como ficaram gravadas (aparadas).
        setSalvas(r.frases);
        setItens(
          r.frases.map((texto) => ({ id: `n${proximoId.current++}`, texto })),
        );
        setResultado({ tom: "success", texto: TEXTOS_DAS_FRASES.salvas });
      } catch {
        setResultado({ tom: "alert", texto: TEXTOS_DO_RASTREIO.semResposta });
      }
    });
  };

  const travado = !podeGerenciar || frases === null;

  const botaoAdicionar = (
    <Button
      variant="outline"
      onClick={adicionar}
      disabled={travado || dicas.adicionar !== null || pendente}
    >
      <Plus aria-hidden />
      Adicionar frase
    </Button>
  );
  const botaoRestaurar = (
    <Button
      variant="ghost"
      onClick={restaurar}
      disabled={travado || dicas.restaurar !== null || pendente}
    >
      <RotateCcw aria-hidden />
      Restaurar a frase padrão
    </Button>
  );
  const botaoSalvar = (
    <Button
      onClick={salvar}
      disabled={travado || dicas.salvar !== null || pendente}
      aria-busy={pendente || undefined}
    >
      {pendente ? "Salvando..." : "Salvar frases"}
    </Button>
  );

  return (
    <section
      className="grid gap-3"
      aria-labelledby={tituloId}
      aria-describedby={explicacaoId}
    >
      <div className="grid gap-1">
        <h3
          id={tituloId}
          className="text-[13.5px] font-semibold text-text-strong"
        >
          {TEXTOS_DAS_FRASES.titulo}
        </h3>
        <p id={explicacaoId} className="text-[13px] text-text-secondary">
          {TEXTOS_DAS_FRASES.quandoUsa}
        </p>
      </div>

      {frases === null ? (
        <p className="rounded-lg border border-dashed border-border-strong bg-surface-2 px-3.5 py-3 text-[13px] text-text-secondary">
          {TEXTOS_DAS_FRASES.semAcesso}
        </p>
      ) : (
        <ol className="grid gap-3">
          {itens.map((item, indice) => {
            const campoId = `${ids}-frase-${item.id}`;
            const erroId = `${campoId}-erro`;
            const erro = erros?.porFrase[indice] ?? null;
            const botaoRemover = (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remover a frase ${indice + 1}`}
                onClick={() => remover(item.id)}
                disabled={travado || dicas.remover !== null || pendente}
              >
                <Trash2 aria-hidden />
              </Button>
            );
            return (
              // O li fica list-item: a grade vai num div por dentro.
              <li key={item.id}>
                <div className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor={campoId}>Frase {indice + 1}</Label>
                    <span
                      aria-hidden
                      className="cz-num text-[11px] text-text-secondary"
                    >
                      {item.texto.length}/{TAMANHO_MAXIMO_DA_FRASE}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      ref={(campo) => {
                        if (campo) {
                          campos.current.set(item.id, campo);
                        } else {
                          campos.current.delete(item.id);
                        }
                      }}
                      id={campoId}
                      type="text"
                      value={item.texto}
                      maxLength={TAMANHO_MAXIMO_DA_FRASE}
                      onChange={(evento) => mudar(item.id, evento.target.value)}
                      disabled={travado}
                      readOnly={pendente}
                      aria-invalid={erro ? true : undefined}
                      aria-describedby={erro ? erroId : undefined}
                      className="flex-1"
                    />
                    {comDica(botaoRemover, dicas.remover)}
                  </div>
                  {erro ? (
                    <p
                      id={erroId}
                      className="flex items-center gap-1.5 text-[12px] font-medium text-alert-text"
                    >
                      <OctagonAlert className="size-3.5 shrink-0" aria-hidden />
                      {erro}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {comDica(botaoAdicionar, dicas.adicionar)}
        {comDica(botaoRestaurar, dicas.restaurar)}
      </div>

      {frases !== null && itens.length > 1 ? (
        <Aviso tom="info" role="note">
          {TEXTOS_DAS_FRASES.sorteio}
        </Aviso>
      ) : null}
      {!ligado ? (
        <p className="text-[13px] text-text-secondary">
          {TEXTOS_DAS_FRASES.desligado}
        </p>
      ) : null}

      {frases !== null ? (
        <div
          className="grid gap-2"
          role="group"
          aria-labelledby={previaTituloId}
        >
          <span
            id={previaTituloId}
            className="text-xs font-semibold text-foreground"
          >
            {TEXTOS_DAS_FRASES.previaTitulo}
          </span>
          <div className="grid gap-2 rounded-card bg-surface-4 p-3.5">
            {previas.length > 0 ? (
              previas.map((previa, indice) => (
                <p
                  key={`${indice}-${previa}`}
                  className="w-full max-w-[420px] justify-self-start rounded-bubble rounded-bl-[6px] border border-border bg-card px-3 py-2 text-[13.5px] leading-[1.5] break-words text-foreground shadow-xs"
                >
                  {previa}
                </p>
              ))
            ) : (
              <p className="text-[13px] text-text-secondary italic">
                {TEXTOS_DAS_FRASES.previaVazia}
              </p>
            )}
          </div>
          <p className="text-[11.5px] text-text-secondary">
            {TEXTOS_DAS_FRASES.previaCodigo} {TEXTOS_DAS_FRASES.semColarDeNovo}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {comDica(botaoSalvar, dicas.salvar)}
        {alterou && !pendente && frases !== null ? (
          <span className="text-[12px] text-text-secondary">
            {TEXTOS_DAS_FRASES.naoSalvas}
          </span>
        ) : null}
      </div>

      {/* Sempre montada: o leitor de tela anuncia o resultado novo. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="grid gap-2 empty:-mt-3"
      >
        {resultado ? (
          <Aviso tom={resultado.tom} role="note">
            {resultado.texto}
          </Aviso>
        ) : null}
      </div>
    </section>
  );
}
