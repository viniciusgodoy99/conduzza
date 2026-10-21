import {
  BadgePlus,
  CalendarPlus,
  CheckCheck,
  Circle,
  Flag,
  Gem,
  Handshake,
  Heart,
  MessageSquareText,
  Package,
  Phone,
  Repeat,
  Sparkles,
  Star,
  Timer,
  Trophy,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";

import type { StatusDefinition, StatusTone } from "@/lib/design/status";
import { normalizarTexto } from "@/lib/domain/attribution";

// A jornada configuravel da clinica (migration 20260909100000). Este modulo e
// puro e serve cliente e servidor: transforma as linhas de funnel_stage_def em
// tudo que a tela precisa (definicao visual das 3 camadas, agrupamento do
// Kanban, consultas por papel).
//
// GARANTIA QUE SIMPLIFICA TUDO: as quatro chaves de sistema ('novo',
// 'agendou', 'compareceu', 'perdido') existem em TODA jornada, porque a
// semeadura as cria, a chave e imutavel e etapa de sistema e indelevel (tudo
// por gatilho no banco). Codigo pode referencia-las com seguranca; so as
// etapas LIVRES variam por clinica.
//
// Onda 3 (21/10/2026, migration 20261023100000): Aguardando resposta e Em
// contato tambem viram etapas de sistema, com os papeis 'aguardando' (o lead
// espera a resposta da equipe; a passagem da IA poe aqui) e 'em_contato' (a
// equipe esta com a conversa; Assumir poe aqui). O codigo acha as duas pelo
// PAPEL, nunca pelo nome (a Salud Care renomeou a sua Em contato). E este
// codigo vai ao ar ANTES da migration: tudo aqui funciona tambem com o banco
// velho, em que as duas sao livres (sem papel) e podem ate faltar.

/**
 * Os papeis que o check funnel_stage_def_papel_check aceita, na ordem da
 * jornada semeada. Fonte unica para quem valida papel vindo do banco (o
 * Funil de leads do Inicio recusa papel fora desta lista).
 */
export const PAPEIS_DE_ETAPA = [
  "entrada",
  "aguardando",
  "em_contato",
  "agendou",
  "compareceu",
  "perdido",
] as const;

export type PapelDeEtapa = (typeof PAPEIS_DE_ETAPA)[number];

/**
 * Quem escreve o termo-chave que anda o contato para a etapa (pedido do dono
 * em 02/10/2026; coluna funnel_stage_def.termos_de_quem, check no banco).
 * 'paciente' e o comportamento original e o padrao de toda etapa que ja
 * existia; 'clinica' vale para o texto que a equipe envia pelo sistema e para
 * o que sai do celular conectado; 'qualquer' vale para os dois lados.
 */
export type TermosDeQuem = "paciente" | "clinica" | "qualquer";

/** De que lado da conversa veio o texto que esta sendo testado. */
export type QuemEscreveu = "paciente" | "clinica";

/** Os valores aceitos pelo check termos_de_quem_valido, na ordem da tela. */
export const TERMOS_DE_QUEM = [
  "paciente",
  "clinica",
  "qualquer",
] as const satisfies readonly TermosDeQuem[];

/** Teto da descricao da etapa (check descricao_de_etapa_com_tamanho). */
export const LIMITE_DA_DESCRICAO = 140;

export type EtapaDaJornada = {
  id: string;
  chave: string;
  nome: string;
  posicao: number;
  tom: StatusTone;
  icone: string;
  papel: PapelDeEtapa | null;
  /**
   * Texto curto que o Kanban mostra abaixo do nome da coluna (ate 140).
   * Nunca vai no cartao do lead (regra dos 5 elementos). Nulo sem descricao.
   */
  descricao: string | null;
  termos_chave: string[];
  termos_de_quem: TermosDeQuem;
  meta_event_name: string | null;
  conversao_ativa: boolean;
  is_sale: boolean;
  is_first_contact: boolean;
  value_source: "service_link" | "fixo" | null;
  value_cents: number | null;
};

/**
 * Catalogo FIXO de icones que uma etapa pode usar.
 *
 * O banco guarda o nome (kebab); o componente vem daqui. Catalogo fechado de
 * proposito: icone e uma das 3 camadas da regra de status (forma, rotulo,
 * cor), entao precisa ser um conjunto que o app sabe desenhar, nao texto
 * livre.
 */
export const ICONES_DE_ETAPA: Record<string, LucideIcon> = {
  "badge-plus": BadgePlus,
  "message-square-text": MessageSquareText,
  timer: Timer,
  "calendar-plus": CalendarPlus,
  "check-check": CheckCheck,
  "user-round-x": UserRoundX,
  circle: Circle,
  star: Star,
  heart: Heart,
  package: Package,
  gem: Gem,
  flag: Flag,
  sparkles: Sparkles,
  handshake: Handshake,
  repeat: Repeat,
  phone: Phone,
  trophy: Trophy,
};

/** As 3 camadas (forma, rotulo, cor) de uma etapa, no formato do StatusChip. */
export function definicaoDaEtapa(etapa: EtapaDaJornada): StatusDefinition {
  return {
    label: etapa.nome,
    tone: etapa.tom,
    icon: ICONES_DE_ETAPA[etapa.icone] ?? Circle,
  };
}

/** Mapa chave -> etapa, para consulta O(1) nas telas. */
export function porChave(
  jornada: readonly EtapaDaJornada[],
): Map<string, EtapaDaJornada> {
  return new Map(jornada.map((etapa) => [etapa.chave, etapa]));
}

/** O que a regra do Assumir precisa saber de cada etapa. */
export type EtapaParaAssumir = Pick<
  EtapaDaJornada,
  "chave" | "papel" | "posicao"
>;

/**
 * Assumir a conversa de um lead NOVO o move para "Em contato" (decisao do
 * dono em 19/09/2026): atender e o primeiro contato de verdade. Desde a onda
 * 3 (21/10/2026) vale tambem para o lead que AGUARDA RESPOSTA da equipe (a
 * IA passou a conversa) e para Iniciar conversa, Transferir para um colega e
 * Reabrir (decisao D7), que chamam a mesma regra. Regras defensivas, nesta
 * ordem:
 * - so contato kind lead (paciente nao anda por clique de atendimento);
 * - so quando a etapa ATUAL tem papel de entrada ou de aguardando (quem ja
 *   avancou ou se perdeu nao volta por causa de um clique);
 * - o destino e a etapa de papel em_contato; sem ela, a de CHAVE em_contato
 *   ainda livre (o banco antes da migration 20261023100000, em que a etapa
 *   nao tem papel; a clinica que a excluiu nao quer essa automacao);
 * - so para FRENTE: a posicao do destino tem de ser maior que a da atual
 *   (a ordem entre as etapas de sistema e fixa, mas o codigo nao aposta
 *   nisso para nunca andar para tras).
 * Devolve a chave de destino ou null para nao mover.
 */
export function etapaAposAssumir(params: {
  kind: "lead" | "paciente";
  etapaAtual: EtapaParaAssumir | null;
  jornada: readonly EtapaParaAssumir[];
}): string | null {
  if (params.kind !== "lead") {
    return null;
  }
  const atual = params.etapaAtual;
  if (!atual || (atual.papel !== "entrada" && atual.papel !== "aguardando")) {
    return null;
  }
  const destino =
    params.jornada.find((etapa) => etapa.papel === "em_contato") ??
    params.jornada.find(
      (etapa) => etapa.chave === "em_contato" && etapa.papel === null,
    );
  if (
    !destino ||
    destino.chave === atual.chave ||
    destino.posicao <= atual.posicao
  ) {
    return null;
  }
  return destino.chave;
}

/**
 * A etapa com um papel de sistema. As quatro antigas existem em toda
 * jornada; aguardando e em_contato so depois da migration 20261023100000
 * (antes dela, null).
 */
export function etapaPorPapel(
  jornada: readonly EtapaDaJornada[],
  papel: PapelDeEtapa,
): EtapaDaJornada | null {
  return jornada.find((etapa) => etapa.papel === papel) ?? null;
}

/**
 * Etapa de sistema = etapa com papel. Nunca sai da jornada (o gatilho
 * proteger_jornada recusa, ate para o service role), entao a tela mostra o
 * cadeado e nem oferece Excluir. Desde a onda 3 inclui Aguardando resposta
 * e Em contato; com o banco de antes elas chegam sem papel e continuam
 * livres.
 */
export function etapaDeSistema(etapa: Pick<EtapaDaJornada, "papel">): boolean {
  return etapa.papel !== null;
}

/** "A", "A e B", "A, B e C": a lista como se fala. */
export function listaEmPortugues(nomes: readonly string[]): string {
  if (nomes.length <= 1) {
    return nomes[0] ?? "";
  }
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Os nomes que a clinica deu as etapas destes papeis, na ordem pedida. */
function nomesDosPapeis(
  jornada: readonly Pick<EtapaDaJornada, "nome" | "papel">[],
  papeis: readonly PapelDeEtapa[],
): string[] {
  return papeis.flatMap((papel) => {
    const etapa = jornada.find((candidata) => candidata.papel === papel);
    return etapa ? [etapa.nome] : [];
  });
}

// ---------------------------------------------------------------------------
// Ordem fixa das etapas de sistema (decisao D6 do dono, 21/10/2026).

/**
 * Os papeis cuja ordem entre si nao muda: o caminho do lead ate a consulta.
 * Perdido fica de fora e vai para qualquer lugar, como as etapas livres. E
 * a mesma lista da trava de reordenar_etapa_da_jornada (migration
 * 20261023100000), que recusa a troca com o hint ordem_de_sistema.
 */
export const PAPEIS_EM_ORDEM_FIXA = [
  "entrada",
  "aguardando",
  "em_contato",
  "agendou",
  "compareceu",
] as const satisfies readonly PapelDeEtapa[];

/**
 * As etapas da cadeia de ordem fixa nesta jornada, na ordem dos papeis.
 * Depois da migration 20261023100000 cada uma e achada pelo proprio papel.
 * Antes dela (este codigo vai ao ar antes), Em contato ainda e livre e
 * entra pela CHAVE, como o destino de etapaAposAssumir: a migration poe
 * Aguardando resposta logo antes dela e preserva o resto da ordem, entao
 * Novo, Em contato, Agendou e Compareceu precisam chegar la ja na ordem (a
 * conferencia da migration recusa a cadeia invertida, que a D6 congelaria;
 * achado da revisao de 21/10/2026). Aguardando resposta sem papel continua
 * livre: onde quer que esteja, a migration a recoloca.
 */
function cadeiaDaJornada<T extends Pick<EtapaDaJornada, "chave" | "papel">>(
  jornada: readonly T[],
): T[] {
  return PAPEIS_EM_ORDEM_FIXA.flatMap((papel) => {
    const etapa =
      jornada.find((candidata) => candidata.papel === papel) ??
      (papel === "em_contato"
        ? jornada.find(
            (candidata) =>
              candidata.papel === null && candidata.chave === "em_contato",
          )
        : undefined);
    return etapa ? [etapa] : [];
  });
}

/**
 * A dica da seta que trocaria duas etapas de sistema, com os nomes que a
 * clinica deu, na ordem fixa: "A ordem das etapas de sistema é fixa: Novo,
 * Aguardando resposta, Em contato, Agendou e Compareceu." Tambem e o que a
 * action devolve quando recusa a troca (ou o banco recusa). Com o banco de
 * antes da migration, sai "Novo, Em contato, Agendou e Compareceu".
 */
export function dicaDaOrdemFixa(
  jornada: readonly Pick<EtapaDaJornada, "chave" | "nome" | "papel">[],
): string {
  const nomes = cadeiaDaJornada(jornada).map((etapa) => etapa.nome);
  return nomes.length > 0
    ? `A ordem das etapas de sistema é fixa: ${listaEmPortugues(nomes)}.`
    : "A ordem das etapas de sistema é fixa.";
}

export type TrocaDeOrdem =
  | { permitida: true }
  | {
      permitida: false;
      /** null: nao ha troca (ponta da jornada), nada a explicar. */
      dica: string | null;
    };

/**
 * A etapa pode trocar de lugar com a vizinha (Subir ou Descer)? Pura, para a
 * tela desabilitar a seta com a dica antes de o banco recusar.
 *
 * jornada vem na ordem da tela (fetchJornada: posicao, chave, a mesma da
 * RPC); a ordenacao aqui e so por posicao e estavel, entao o desempate de
 * quem chamou e mantido. Nega sem dica na ponta e para chave desconhecida;
 * nega COM a dica quando as duas etapas da troca sao da cadeia de ordem fixa
 * (cadeiaDaJornada: com o banco de antes da migration, Em contato entra pela
 * chave). As trocas sao sempre entre vizinhas, entao barrar so este caso
 * basta para a cadeia Novo, Aguardando resposta, Em contato, Agendou e
 * Compareceu nunca inverter, e etapa livre continua podendo passar por entre
 * elas. A action de reordenar confere o mesmo no servidor antes da RPC.
 */
export function trocaDeOrdemPermitida(
  jornada: readonly Pick<
    EtapaDaJornada,
    "chave" | "nome" | "papel" | "posicao"
  >[],
  chave: string,
  direcao: "subir" | "descer",
): TrocaDeOrdem {
  const ordenada = [...jornada].sort((a, b) => a.posicao - b.posicao);
  const indice = ordenada.findIndex((etapa) => etapa.chave === chave);
  const etapa = indice >= 0 ? ordenada[indice] : undefined;
  const vizinha =
    indice >= 0 ? ordenada[indice + (direcao === "subir" ? -1 : 1)] : undefined;
  if (!etapa || !vizinha) {
    return { permitida: false, dica: null };
  }
  const cadeia = cadeiaDaJornada(jornada);
  if (cadeia.includes(etapa) && cadeia.includes(vizinha)) {
    return { permitida: false, dica: dicaDaOrdemFixa(jornada) };
  }
  return { permitida: true };
}

/**
 * A recusa da RPC reordenar_etapa_da_jornada para a troca entre duas etapas
 * de sistema (P0001 com o hint ordem_de_sistema), pelo hint ou, se ele nao
 * chegar, pela mensagem.
 */
export function ehRecusaDaOrdemFixa(
  erro: { message?: string | null; hint?: string | null } | null | undefined,
): boolean {
  if (!erro) {
    return false;
  }
  return (
    erro.hint === "ordem_de_sistema" ||
    (erro.message ?? "").includes("A ordem das etapas de sistema não muda")
  );
}

/**
 * O rodape da tela Jornada, com os nomes da clinica. Diz quais sao as etapas
 * de sistema e o que e fixo nelas. Com o banco antes da migration
 * 20261023100000 a lista de sistema sai com as quatro de entao, sem mentir,
 * e a da ordem fixa ja inclui Em contato (pela chave, como a seta).
 */
export function rodapeDaJornada(
  jornada: readonly Pick<EtapaDaJornada, "chave" | "nome" | "papel">[],
): string {
  const deSistema = nomesDosPapeis(jornada, PAPEIS_DE_ETAPA);
  const emOrdemFixa = cadeiaDaJornada(jornada).map((etapa) => etapa.nome);
  const partes: string[] = [];
  if (deSistema.length > 0) {
    partes.push(
      `As etapas de sistema (${listaEmPortugues(deSistema)}) podem mudar de nome e de lugar, nunca sair: são elas que movem o contato sozinho e que protegem o motivo de perda.`,
    );
  }
  if (emOrdemFixa.length > 1) {
    partes.push(
      `A ordem entre ${listaEmPortugues(emOrdemFixa)} não muda; as outras etapas vão para qualquer lugar.`,
    );
  }
  partes.push(
    "Os eventos de conversão ainda não são enviados à Meta: esta tela define o que será enviado quando a conta de anúncios for conectada.",
  );
  return partes.join(" ");
}

// ---------------------------------------------------------------------------
// Regua de follow-up por etapa (decisao D3 do dono, 21/10/2026).

/**
 * A etapa e a de Aguardando resposta? Pelo papel depois da migration
 * 20261023100000; antes dela, pela CHAVE aguardando_resposta ainda sem papel
 * (achado da revisao de 21/10/2026: se uma clinica criasse a regua ali entre
 * a publicacao deste codigo e a migration, a conferencia da migration a
 * recusaria inteira, e a regua mandaria mensagem a quem passa a esperar a
 * clinica).
 */
function etapaDeAguardar(
  etapa: Pick<EtapaDaJornada, "chave" | "papel">,
): boolean {
  return (
    etapa.papel === "aguardando" ||
    (etapa.papel === null && etapa.chave === "aguardando_resposta")
  );
}

/**
 * A etapa aceita regua de follow-up? Perdido nao (acompanhar quem pediu para
 * parar seria spam). Aguardando resposta tambem nao: quem esta ali espera a
 * resposta da CLINICA, e a regua mandaria mensagem automatica a quem espera
 * gente (e, no canal nao oficial, cada mensagem a mais e risco de denuncia).
 * O banco recusa o mesmo pelo gatilho recusar_followup_em_aguardando (hint
 * etapa_sem_followup); aqui a tela nem oferece e a action recusa antes, ja
 * com o banco de antes da migration (etapaDeAguardar).
 */
export function etapaRecebeFollowup(
  etapa: Pick<EtapaDaJornada, "chave" | "papel">,
): boolean {
  return etapa.papel !== "perdido" && !etapaDeAguardar(etapa);
}

/** Por que a etapa nao recebe regua de follow-up, ou null se recebe. */
export function recusaDeFollowup(
  etapa: Pick<EtapaDaJornada, "chave" | "nome" | "papel">,
): string | null {
  if (etapa.papel === "perdido") {
    return "A etapa de perda não recebe follow-up automático.";
  }
  if (etapaDeAguardar(etapa)) {
    return `Quem está em ${etapa.nome} espera a resposta da clínica: esta etapa não tem régua de follow-up.`;
  }
  return null;
}

/** O que a decisao por termo-chave precisa saber de cada etapa. */
type EtapaParaTermo = Pick<
  EtapaDaJornada,
  "chave" | "posicao" | "papel" | "termos_chave" | "termos_de_quem"
>;

/**
 * A etapa aceita termo escrito por este lado da conversa?
 *
 * 'qualquer' aceita os dois; 'paciente' e 'clinica' so o proprio lado. Valor
 * desconhecido (nao passa no check do banco, mas um cache velho nao pode
 * mover ninguem) nao aceita nada.
 */
export function termoValePara(
  termosDeQuem: TermosDeQuem,
  quemEscreveu: QuemEscreveu,
): boolean {
  return termosDeQuem === "qualquer" || termosDeQuem === quemEscreveu;
}

/**
 * Decide se um texto move o contato de etapa por TERMO-CHAVE (fase 4 da
 * jornada configuravel; "quem escreve o termo" pedido em 02/10/2026). Pura,
 * zero I/O; quem le a jornada e grava o contato e
 * lib/integrations/whatsapp/termo-chave.ts.
 *
 * Regras, na ordem em que eliminam:
 * - corpo vazio, jornada vazia ou etapa atual desconhecida: nao move (etapa
 *   fora da jornada e cache velho; ser conservador aqui nao perde nada).
 * - contato em etapa de perda NUNCA sai por termo: reativar quem se perdeu e
 *   decisao de gente (ou do gatilho de agendamento), nao de palavra solta.
 * - so entram as etapas cujo termos_de_quem aceita QUEM ESCREVEU: o termo da
 *   etapa "da clinica" nao anda o lead quando e o paciente que o escreve, e
 *   vice versa.
 * - so anda PARA FRENTE (posicao maior que a atual) e nunca PARA a etapa de
 *   perda: "nao quero mais, era so o valor" nao pode perder ninguem.
 * - entre os termos que casaram, vence o mais longo (mais especifico), como
 *   na atribuicao de campanha; empate fica com a etapa mais cedo na jornada.
 *
 * Normalizacao identica a da atribuicao: minusculas, sem acento, espacos
 * colapsados, substring simples.
 */
export function etapaPorTermoChave<T extends EtapaParaTermo>(
  corpo: string | null,
  etapaAtual: string,
  jornada: readonly T[],
  quemEscreveu: QuemEscreveu,
): T | null {
  if (!corpo) {
    return null;
  }
  const corpoNormalizado = normalizarTexto(corpo);
  if (corpoNormalizado === "") {
    return null;
  }
  const atual = jornada.find((etapa) => etapa.chave === etapaAtual);
  if (!atual || atual.papel === "perdido") {
    return null;
  }

  let vencedora: T | null = null;
  let maiorComprimento = 0;
  for (const etapa of [...jornada].sort((a, b) => a.posicao - b.posicao)) {
    if (
      etapa.papel === "perdido" ||
      etapa.posicao <= atual.posicao ||
      !termoValePara(etapa.termos_de_quem, quemEscreveu)
    ) {
      continue;
    }
    for (const termo of etapa.termos_chave) {
      const termoNormalizado = normalizarTexto(termo);
      if (
        termoNormalizado !== "" &&
        termoNormalizado.length > maiorComprimento &&
        corpoNormalizado.includes(termoNormalizado)
      ) {
        vencedora = etapa;
        maiorComprimento = termoNormalizado.length;
      }
    }
  }
  return vencedora;
}

// ---------------------------------------------------------------------------
// Textos da tela Jornada sobre "quem escreve o termo". Aqui, e nao no
// componente, para o teste de unidade conferir cada combinacao (e a regra de
// nenhum travessao) sem renderizar nada.

/** As opcoes do campo "Quem escreve o termo", na ordem do banco. */
export const OPCOES_TERMOS_DE_QUEM: readonly {
  valor: TermosDeQuem;
  rotulo: string;
}[] = [
  { valor: "paciente", rotulo: "Paciente" },
  { valor: "clinica", rotulo: "Clínica" },
  { valor: "qualquer", rotulo: "Qualquer um" },
];

const POR_QUEM: Record<TermosDeQuem, string> = {
  paciente: "pelo paciente",
  clinica: "pela clínica",
  qualquer: "por qualquer um",
};

/**
 * O que vem depois do numero na linha recolhida da etapa:
 * "3 termos escritos pela clínica". Quem chama poe o numero (com a classe
 * de numeral tabular) na frente.
 */
export function resumoDosTermos(
  quantidade: number,
  termosDeQuem: TermosDeQuem,
): string {
  const substantivo = quantidade === 1 ? "termo escrito" : "termos escritos";
  return `${substantivo} ${POR_QUEM[termosDeQuem] ?? POR_QUEM.paciente}`;
}

const QUANDO_ESCREVE: Record<TermosDeQuem, string> = {
  paciente: "Quando o paciente escrever um destes termos na conversa",
  clinica:
    "Quando a clínica escrever um destes termos para o paciente, pelo sistema ou pelo celular conectado",
  qualquer:
    "Quando o paciente ou a clínica escrever um destes termos na conversa",
};

/** A explicacao do bloco "Termos que movem o contato para cá". */
export function ajudaDosTermos(termosDeQuem: TermosDeQuem): string {
  const quando = QUANDO_ESCREVE[termosDeQuem] ?? QUANDO_ESCREVE.paciente;
  return `${quando}, o contato anda sozinho para esta etapa (só para frente na jornada, nunca para a etapa de perda).`;
}

/** A explicacao do campo "Quem escreve o termo". */
export const AJUDA_QUEM_ESCREVE =
  "Paciente: a mensagem que chega dele. Clínica: o que a equipe envia pelo sistema ou pelo celular conectado. Qualquer um: os dois lados.";

// ---------------------------------------------------------------------------
// Descricao da etapa (pedido do dono em 02/10/2026).

/**
 * A descricao como o banco guarda: espacos e quebras de linha colapsados num
 * espaco so (o Kanban mostra em ate 2 linhas; quebra manual so desperdica
 * uma), pontas aparadas, e vazio vira null. O check do banco recusa string
 * vazia ou so de espacos, entao vazio NUNCA pode seguir como "".
 */
export function normalizarDescricaoDaEtapa(
  texto: string | null | undefined,
): string | null {
  if (texto === null || texto === undefined) {
    return null;
  }
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo === "" ? null : limpo;
}

/**
 * Alguma etapa tem descricao? Quando sim, TODAS as colunas do Kanban (e do
 * esqueleto) reservam a altura das 2 linhas, para os cartoes comecarem na
 * mesma altura em todas (o grid e items-start).
 */
export function algumaEtapaComDescricao(
  jornada: readonly Pick<EtapaDaJornada, "descricao">[],
): boolean {
  return jornada.some((etapa) => Boolean(etapa.descricao));
}

// ---------------------------------------------------------------------------
// Recusas do banco ao salvar ou excluir etapa.

/**
 * O gatilho proteger_jornada e os checks de funnel_stage_def recusam em
 * portugues. Mensagem nula: a do banco ja explica e vai como esta. Mensagem
 * preenchida: a do banco fala de outro jeito (nome de constraint, ou termo
 * tecnico) e a tela mostra esta. Recusa nova de exclusao (por exemplo, etapa
 * usada por automacao de fluxo) entra nesta lista.
 */
const RECUSAS_DA_JORNADA: readonly {
  trecho: string;
  mensagem: string | null;
}[] = [
  { trecho: "Etapa de sistema não pode ser excluída", mensagem: null },
  { trecho: "Mova os contatos desta etapa", mensagem: null },
  { trecho: "A chave de uma etapa não muda", mensagem: null },
  { trecho: "O papel de sistema de uma etapa não muda", mensagem: null },
  {
    // migration 20260914180000 (motor de follow-up): faltava aqui, e quem
    // tentava excluir uma etapa com regua via so o generico.
    trecho: "Exclua a régua de follow-up desta etapa",
    mensagem:
      "Esta etapa tem uma régua de follow-up. Exclua a régua em Automações antes de excluir a etapa.",
  },
  {
    // migration 20261002130000 (automacoes de fluxo): etapa que e origem ou
    // destino de uma automacao nao se exclui (hint etapa_usada_por_automacao).
    // Mesmo texto de RECUSA_DA_ETAPA_USADA (lib/domain/automacoes-de-fluxo);
    // desde 20/10/2026 a aba mora em Automacoes, e nao em Configuracoes.
    trecho: "Esta etapa é usada por uma automação de fluxo",
    mensagem:
      "Esta etapa é usada por uma automação de fluxo. Exclua a automação ou troque a etapa dela em Automações, na aba Automações de fluxo, antes de excluir a etapa.",
  },
  {
    trecho: "descricao_de_etapa_com_tamanho",
    mensagem: `A descrição da etapa cabe em até ${LIMITE_DA_DESCRICAO} caracteres.`,
  },
  {
    trecho: "termos_de_quem_valido",
    mensagem: "Escolha quem escreve o termo: paciente, clínica ou qualquer um.",
  },
];

/** A recusa do banco que a tela mostra, ou null para cair no generico. */
export function traduzirRecusaDaJornada(
  message: string | null | undefined,
): string | null {
  if (!message) {
    return null;
  }
  const recusa = RECUSAS_DA_JORNADA.find(({ trecho }) =>
    message.includes(trecho),
  );
  if (!recusa) {
    return null;
  }
  return recusa.mensagem ?? message;
}

/**
 * Agrupa itens com funnel_stage pelas etapas DA JORNADA, na ordem de posicao.
 *
 * Item cuja etapa nao esta na jornada nao some em silencio: cai na etapa de
 * entrada, que existe garantidamente. (Na pratica o banco impede o caso, mas
 * um cache momentaneamente velho na troca de jornada nao pode derrubar o
 * Kanban.)
 */
export function agruparPorJornada<T extends { funnel_stage: string }>(
  itens: readonly T[],
  jornada: readonly EtapaDaJornada[],
): Map<string, T[]> {
  const grupos = new Map<string, T[]>(
    jornada.map((etapa) => [etapa.chave, [] as T[]]),
  );
  const entrada = etapaPorPapel(jornada, "entrada");
  for (const item of itens) {
    const balde =
      grupos.get(item.funnel_stage) ??
      (entrada ? grupos.get(entrada.chave) : undefined);
    balde?.push(item);
  }
  return grupos;
}
