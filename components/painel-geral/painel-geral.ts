import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import {
  BadgeX,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleSlash,
  FlaskConical,
  Hourglass,
  OctagonAlert,
  OctagonPause,
  PhoneOff,
  RadioTower,
  Siren,
  Watch,
} from "lucide-react";
import { z } from "zod";

import {
  WHATSAPP_CONNECTION_STATUS,
  type StatusDefinition,
} from "@/lib/design/status";
import {
  publicoDoBanco,
  ROTULO_DO_MODO,
  ROTULO_DO_PUBLICO,
  type ModoDeOperacao,
} from "@/lib/domain/agente/config";
import { diaCivil, diasEntre, somarDias } from "@/lib/domain/horarios";
import { ROTULO_DO_PAPEL } from "@/lib/domain/permissions";
import {
  SAUDES_DO_BANCO,
  type AutorNoPainel,
  type ChaveDoPasso,
  type ChaveDoSinal,
  type ClinicaNoPainel,
  type DirecaoDaTendencia,
  type EstadoDoAgente,
  type EventoDaConta,
  type ImplantacaoNoPainel,
  type PassoNoPainel,
  type PessoaDaEquipe,
  type RegistroDoRequisito,
  type RequisitoConferido,
  type RequisitosDaProducao,
  type SaudeNoPainel,
  type SinalNoPainel,
  type SituacaoDaConta,
  type SituacaoDoMembro,
  type TendenciaNoPainel,
  type UltimoAcessoNoPainel,
} from "@/lib/queries/painel-geral";
import { lerReais } from "@/lib/utils/moeda";

// Regras do Painel geral (onda 1, decisao do dono de 20/10/2026; desde
// 26/10/2026, o acompanhamento de cliente). Modulo puro, sem "use client":
// as telas, as Server Actions e os testes usam as mesmas regras, e o que a
// tela desabilita e o mesmo que a acao recusa.
//
// - So a equipe Conduzza (super admin) chega aqui: a guarda vive no layout
//   da rota, em cada Server Action e nas RPCs do banco (42501).
// - Acompanhamento de cliente (pedido do dono de 26/10/2026, "ele e para
//   ser tipo uma visualizacao de CS"): quantas clinicas, quantas em uso
//   (alguem da equipe da clinica entrou nos ultimos 30 dias, a resposta do
//   dono), quem entrou por ultimo e quando, a equipe, o WhatsApp e o
//   agente. A funcionalidade que a equipe Conduzza libera e o agente de IA
//   ("Preciso poder liberar as funcionalidades de agente de IA ou nao para a
//   clinica"): liberar e ligar em Teste, na propria linha da lista; a
//   Producao continua so no detalhe, com o checklist.
// - O ultimo acesso e a ULTIMA ATIVIDADE (decisao do dono de 26/10/2026,
//   "Pela ultima atividade"): o maior entre o ultimo login e a renovacao da
//   sessao, que acontece enquanto a pessoa usa o sistema. Quem continua
//   conectado por semanas aparece em dia, e a tela diz isso. A equipe
//   Conduzza com vinculo ativo conta como qualquer pessoa ativa (o desenho:
//   "dos membros ATIVOS"; o dono confirmou em 26/10/2026); a tela a marca
//   quando o ultimo acesso foi dela e diz quantas das ativas sao dela.
// - Mudar o agente pelo painel manda junto o estado que a tela mostrava; o
//   banco recusa (agente_mudou) se ele mudou desde que a pagina abriu (outra
//   aba, outra pessoa), em vez de rebaixar a Producao ou passar por cima da
//   escolha da clinica.
// - Suspender a conta mantem os dados: a equipe da clinica ve "Conta
//   suspensa" ao entrar, os envios automaticos e o agente param, as
//   mensagens que chegam continuam guardadas, e reativar volta tudo como
//   estava (as mensagens automaticas que venceram durante a suspensao sao
//   canceladas, para nao sair mensagem fora de hora).
// - Agente por clinica: Desligado, Teste (so os telefones da equipe) ou
//   Producao (onda 2, item 11, decisoes P11a a P11e: os contatos do publico
//   escolhido). Producao so a partir de Teste, so com todos os requisitos
//   cumpridos (o cartao "Para liberar a produção") e sempre com motivo.
// - O interruptor geral (todas as clinicas) mora no topo da lista desde a
//   onda 2 (P8).
// - O gasto da IA (24 horas, a janela do teto, e o mes no fuso da clinica)
//   aparece no detalhe contra o teto diario, que a equipe Conduzza ajusta
//   la. Desde a segunda leva (26/10/2026), com a precisao real (nunca "US$
//   0,00" quando houve gasto) e as chamadas, no cartao do topo, no detalhe
//   e na coluna "IA no mes" da lista.
// - Segunda leva (26/10/2026, escolhas do dono): os sinais de alerta e a
//   saude, a implantacao e a tendencia vem decididos pelo banco (migration
//   20261026110000; as regras novas la estao marcadas AJUSTAVEL); aqui, os
//   rotulos, os status em 3 camadas, o filtro de saude, a ordem por coluna,
//   as notas internas, o historico da conta e as entradas das acoes.
// - De paciente, so contagens: nenhum dado de paciente na tela, na URL nem
//   em log. Nome, e-mail, papel e ultimo acesso sao da equipe da clinica.

// ---------------------------------------------------------------------------
// Status em 3 camadas (icone, rotulo e cor), com icones que ja tem dono no
// mesmo sentido e na mesma cor (tabela de icones reservados de
// lib/design/status.ts):
// - ativa: CircleCheck success (ativo);
// - suspensa: OctagonPause alert, icone sem outro dono no produto (a placa
//   de parar com a pausa: a conta parada de proposito, com os dados);
// - agente desligado: CirclePause neutral, o mesmo do "Desligado" da aba
//   WhatsApp da Tela 6;
// - agente em teste: FlaskConical info, o mesmo sentido e a mesma cor do
//   "Só simulador" (teste, sem paciente);
// - agente em producao: RadioTower success, o mesmo do "Atendendo os
//   contatos" da aba WhatsApp da Tela 6 (no ar para os contatos);
// - requisito da producao: CircleCheck success (cumprido), CircleDashed
//   neutral (falta: o "nada aqui ainda") e BadgeX alert (revogado; o CircleX
//   que o contrato da onda 2 sugeria e so do Cancelado pelo paciente na
//   tabela de icones reservados);
// - gasto perto do teto: CircleAlert warning (atencao);
// - teto atingido: Hourglass warning (pendencia: o agente espera o gasto
//   mais antigo completar 24 horas), o mesmo par do "Ligado, mas parado".
// Desde 26/10/2026 (acompanhamento de cliente), nenhum icone ganha dono
// novo:
// - em uso: CircleCheck success (ativo, feito);
// - sem uso: Watch warning, o mesmo sentido e a mesma cor do "Esfriando"
//   do lead e do "Sem cliques nos últimos 7 dias" (tempo demais sem
//   atividade);
// - agente na lista: os pares do agente da clinica com o rotulo da
//   liberacao ("Não liberado", "Liberado (Teste)", "Liberado (Produção)");
// - pessoa da equipe: ativa CircleCheck success, pendente Hourglass warning
//   (pendencia: esperando liberacao) e inativa CircleSlash neutral, o mesmo
//   do "Sem acesso" da lista da equipe em Configuracoes.
// Segunda leva (26/10/2026), dois icones ganham dono e o resto reaproveita
// sentidos da tabela:
// - saude: Saudavel CircleCheck success (sucesso), Atencao CircleAlert
//   warning (atencao) e Em risco Siren alert (DONO NOVO: so a clinica em
//   risco; o ShieldAlert do "risco" e do Risco de falta, e a familia Shield
//   e da autorizacao para receber mensagens);
// - sinais: Conta suspensa OctagonPause alert (o da conta suspensa),
//   WhatsApp desconectado WifiOff alert (o do Desconectado), Sem uso ha 30
//   dias Watch warning (o do Sem uso), Sem numero de WhatsApp PhoneOff
//   warning (DONO NOVO: so a clinica sem numero), Falhas de envio
//   OctagonAlert alert (erro ou falha, o do "Não enviada"), Perto do teto
//   de IA CircleAlert warning (o do Perto do teto) e Pedido de entrada
//   esperando Hourglass warning (pendencia, o da pessoa Pendente);
// - passo da implantacao: Feito CircleCheck success e Falta CircleDashed
//   neutral (o "nada aqui ainda"), os pares do requisito da producao.
// ---------------------------------------------------------------------------

export const SITUACAO_DA_CONTA_STATUS: Record<
  SituacaoDaConta,
  StatusDefinition
> = {
  ativa: { label: "Ativa", tone: "success", icon: CircleCheck },
  suspensa: { label: "Suspensa", tone: "alert", icon: OctagonPause },
};

export const AGENTE_DA_CLINICA_STATUS: Record<
  EstadoDoAgente,
  StatusDefinition
> = {
  desligado: { label: "Desligado", tone: "neutral", icon: CirclePause },
  teste: { label: "Teste", tone: "info", icon: FlaskConical },
  producao: { label: "Produção", tone: "success", icon: RadioTower },
};

/**
 * O agente na lista, como a equipe Conduzza libera: o mesmo icone e a mesma
 * cor do agente da clinica (AGENTE_DA_CLINICA_STATUS), com o rotulo da
 * liberacao.
 */
export const ROTULO_DA_LIBERACAO: Readonly<Record<EstadoDoAgente, string>> = {
  desligado: "Não liberado",
  teste: "Liberado (Teste)",
  producao: "Liberado (Produção)",
};

/** O uso da clinica: alguem da equipe usou o sistema nos ultimos 30 dias, ou nao. */
export type UsoDaClinica = "em_uso" | "sem_uso";

export const USO_DA_CLINICA_STATUS: Record<UsoDaClinica, StatusDefinition> = {
  em_uso: { label: "Em uso", tone: "success", icon: CircleCheck },
  sem_uso: { label: "Sem uso", tone: "warning", icon: Watch },
};

export const SITUACAO_DO_MEMBRO_STATUS: Record<
  SituacaoDoMembro,
  StatusDefinition
> = {
  ativo: { label: "Ativa", tone: "success", icon: CircleCheck },
  pendente: { label: "Pendente", tone: "warning", icon: Hourglass },
  inativo: { label: "Inativa", tone: "neutral", icon: CircleSlash },
};

/** Pelo que o banco disse na leitura (em_uso), nunca pelo relogio da tela. */
export function usoDaClinica(
  clinica: Pick<ClinicaNoPainel, "emUso">,
): UsoDaClinica {
  return clinica.emUso ? "em_uso" : "sem_uso";
}

/** Um requisito da producao na lista do cartao. */
export type EstadoDoRequisito = "cumprido" | "falta" | "revogado";

export const REQUISITO_STATUS: Record<EstadoDoRequisito, StatusDefinition> = {
  cumprido: { label: "Cumprido", tone: "success", icon: CircleCheck },
  falta: { label: "Falta", tone: "neutral", icon: CircleDashed },
  revogado: { label: "Revogado", tone: "alert", icon: BadgeX },
};

/** O gasto das ultimas 24 horas contra o teto diario. */
export type EstadoDoGasto = "sem_teto" | "dentro" | "perto" | "atingido";

/** So os dois estados que pedem atencao viram chip. */
export const GASTO_STATUS: Record<"perto" | "atingido", StatusDefinition> = {
  perto: { label: "Perto do teto", tone: "warning", icon: CircleAlert },
  atingido: { label: "Teto atingido", tone: "warning", icon: Hourglass },
};

/** A partir de quanto do teto o gasto e "perto" (80%). */
export const PERTO_DO_TETO = 0.8;

export function estadoDoGasto(
  gastoCentavos: number,
  tetoCentavos: number | null,
): EstadoDoGasto {
  if (tetoCentavos === null) {
    return "sem_teto";
  }
  if (gastoCentavos >= tetoCentavos) {
    return "atingido";
  }
  return gastoCentavos >= tetoCentavos * PERTO_DO_TETO ? "perto" : "dentro";
}

export function situacaoDaConta(
  clinica: Pick<ClinicaNoPainel, "suspensao">,
): SituacaoDaConta {
  return clinica.suspensao ? "suspensa" : "ativa";
}

// ---------------------------------------------------------------------------
// Sinais de alerta e saude (segunda leva, 26/10/2026; escolhas (1) e (8) do
// dono). O BANCO decide quais sinais acendem e a saude (migration
// 20261026110000, onde as regras novas estao marcadas AJUSTAVEL); a tela
// mostra cada sinal em 3 camadas, com o rotulo e o que o banco contou, e a
// leitura (lib/queries/painel-geral.ts) confere a saude com os sinais.
// ---------------------------------------------------------------------------

export const SINAL_STATUS: Record<ChaveDoSinal, StatusDefinition> = {
  conta_suspensa: {
    label: "Conta suspensa",
    tone: "alert",
    icon: OctagonPause,
  },
  sem_uso: { label: "Sem uso há 30 dias", tone: "warning", icon: Watch },
  whatsapp_desconectado: {
    label: "WhatsApp desconectado",
    tone: WHATSAPP_CONNECTION_STATUS.desconectado.tone,
    icon: WHATSAPP_CONNECTION_STATUS.desconectado.icon,
  },
  sem_numero_de_whatsapp: {
    label: "Sem número de WhatsApp",
    tone: "warning",
    icon: PhoneOff,
  },
  pedido_de_entrada_esperando: {
    label: "Pedido de entrada esperando",
    tone: "warning",
    icon: Hourglass,
  },
  falhas_de_envio: {
    label: "Falhas de envio",
    tone: "alert",
    icon: OctagonAlert,
  },
  perto_do_teto_da_ia: {
    label: "Perto do teto de IA",
    tone: "warning",
    icon: CircleAlert,
  },
};

/** O rotulo do sinal na linha, com a contagem quando ajuda. */
export function rotuloDoSinal(
  sinal: Pick<SinalNoPainel, "chave" | "quantidade">,
): string {
  const quantidade = sinal.quantidade ?? 0;
  switch (sinal.chave) {
    case "pedido_de_entrada_esperando":
      return quantidade > 1
        ? `${contagemNoPainel(quantidade)} pedidos de entrada esperando`
        : SINAL_STATUS.pedido_de_entrada_esperando.label;
    case "falhas_de_envio":
      return quantidade > 1
        ? `${contagemNoPainel(quantidade)} falhas de envio`
        : "1 falha de envio";
    default:
      return SINAL_STATUS[sinal.chave].label;
  }
}

/**
 * O que o banco contou do sinal, em texto de recepcao, para o detalhe:
 * desde quando, quantos, quanto do teto. Nulo: nada a acrescentar. Datas no
 * fuso da clinica.
 */
export function detalheDoSinal(
  sinal: SinalNoPainel,
  fuso: string,
): string | null {
  const quando = sinal.desde ? dataEHoraNaClinica(sinal.desde, fuso) : null;
  const quantidade = sinal.quantidade ?? 0;
  switch (sinal.chave) {
    case "conta_suspensa":
      return quando ? `Suspensa desde ${quando}.` : null;
    case "sem_uso":
      return quando
        ? `Último acesso da equipe em ${quando}.`
        : "Ninguém da equipe entrou ainda.";
    case "whatsapp_desconectado": {
      const numeros =
        quantidade === 1
          ? "O número está sem conexão."
          : `Os ${contagemNoPainel(quantidade)} números estão sem conexão.`;
      return quando
        ? `${numeros} A desconexão mais recente foi em ${quando}.`
        : numeros;
    }
    case "sem_numero_de_whatsapp":
      return "A clínica ainda não conectou um número na aba WhatsApp de Configurações.";
    case "pedido_de_entrada_esperando": {
      const pedidos =
        quantidade === 1
          ? "1 pedido esperando há mais de 2 dias."
          : `${contagemNoPainel(quantidade)} pedidos esperando há mais de 2 dias.`;
      return sinal.desde
        ? `${pedidos} O mais antigo é de ${dataNaClinica(sinal.desde, fuso)}.`
        : pedidos;
    }
    case "falhas_de_envio": {
      const falhas =
        quantidade === 1
          ? "1 mensagem não saiu nos últimos 7 dias."
          : `${contagemNoPainel(quantidade)} mensagens não saíram nos últimos 7 dias.`;
      return quando ? `${falhas} A primeira falha foi em ${quando}.` : falhas;
    }
    case "perto_do_teto_da_ia":
      return quantidade >= 100
        ? `${contagemNoPainel(quantidade)}% do teto diário gasto nas últimas 24 horas. O agente para de responder até o gasto mais antigo completar 24 horas.`
        : `${contagemNoPainel(quantidade)}% do teto diário gasto nas últimas 24 horas.`;
  }
}

export const SAUDE_STATUS: Record<SaudeNoPainel, StatusDefinition> = {
  saudavel: { label: "Saudável", tone: "success", icon: CircleCheck },
  atencao: { label: "Atenção", tone: "warning", icon: CircleAlert },
  em_risco: { label: "Em risco", tone: "alert", icon: Siren },
};

/** A ordem da saude, da melhor para a pior (a faixa e o filtro). */
export const SAUDES: readonly SaudeNoPainel[] = SAUDES_DO_BANCO;

// ---------------------------------------------------------------------------
// Implantacao (segunda leva, escolha (2) do dono): seis passos, cada um
// feito ou nao, decididos pelo banco (a equipe minima de 2 pessoas ativas
// conta a equipe Conduzza, como as outras contagens; AJUSTAVEL na
// migration). A tela da o nome e o que o banco contou.
// ---------------------------------------------------------------------------

export const ROTULO_DO_PASSO: Readonly<Record<ChaveDoPasso, string>> = {
  whatsapp_conectado: "Número de WhatsApp conectado",
  equipe_com_duas_pessoas: "Equipe com 2 ou mais pessoas ativas",
  procedimentos_cadastrados: "Procedimentos cadastrados",
  profissionais_cadastrados: "Profissionais cadastrados",
  regua_de_confirmacao_ligada: "Régua de confirmação ligada",
  anuncios_conectados: "Anúncios conectados (Meta ou rastreio do Google)",
};

export type EstadoDoPasso = "feito" | "falta";

export const PASSO_STATUS: Record<EstadoDoPasso, StatusDefinition> = {
  feito: { label: "Feito", tone: "success", icon: CircleCheck },
  falta: { label: "Falta", tone: "neutral", icon: CircleDashed },
};

/** Um passo como a tela mostra. */
export type PassoDaImplantacao = {
  chave: ChaveDoPasso;
  rotulo: string;
  feito: boolean;
  /** O que o banco contou, em texto ("2 números conectados"). */
  detalhe: string;
};

function plural(quantidade: number, um: string, varios: string): string {
  return quantidade === 1
    ? `1 ${um}`
    : `${contagemNoPainel(quantidade)} ${varios}`;
}

function detalheDoPasso(
  passo: PassoNoPainel,
  anuncios: ImplantacaoNoPainel["anuncios"],
): string {
  switch (passo.chave) {
    case "whatsapp_conectado":
      return passo.quantidade === 0
        ? "Nenhum número conectado."
        : `${plural(passo.quantidade, "número conectado", "números conectados")}.`;
    case "equipe_com_duas_pessoas":
      return passo.quantidade === 0
        ? "Nenhuma pessoa ativa."
        : `${plural(passo.quantidade, "pessoa ativa", "pessoas ativas")}.`;
    case "procedimentos_cadastrados":
      return passo.quantidade === 0
        ? "Nenhum procedimento ativo."
        : `${plural(passo.quantidade, "procedimento ativo", "procedimentos ativos")}.`;
    case "profissionais_cadastrados":
      return passo.quantidade === 0
        ? "Nenhum profissional ativo."
        : `${plural(passo.quantidade, "profissional ativo", "profissionais ativos")}.`;
    case "regua_de_confirmacao_ligada":
      return passo.quantidade === 0
        ? "Nenhuma régua de confirmação ligada."
        : `${plural(passo.quantidade, "régua de confirmação ligada", "réguas de confirmação ligadas")}.`;
    case "anuncios_conectados":
      return `Meta ${anuncios.meta ? "ligada" : "desligada"}. Rastreio do Google ${anuncios.google ? "ligado" : "desligado"}.`;
  }
}

/** Os seis passos, na ordem do banco, com o nome e o que ele contou. */
export function passosDaImplantacao(
  clinica: Pick<ClinicaNoPainel, "implantacao">,
): PassoDaImplantacao[] {
  return clinica.implantacao.passos.map((passo) => ({
    chave: passo.chave,
    rotulo: ROTULO_DO_PASSO[passo.chave],
    feito: passo.feito,
    detalhe: detalheDoPasso(passo, clinica.implantacao.anuncios),
  }));
}

/** "4 de 6 passos". */
export function textoDaImplantacao(feitos: number, total: number): string {
  return `${feitos} de ${total} passos`;
}

// ---------------------------------------------------------------------------
// Tendencia (segunda leva, escolha (3) do dono): os ultimos 30 dias contra
// os 30 anteriores, com a direcao que o banco decide (a faixa do estavel e
// dele, AJUSTAVEL na migration). A seta e o texto, nunca so a cor; a cor
// pela polaridade (mais leads e mais conversas e bom), como a variacao dos
// cartoes de metrica.
// ---------------------------------------------------------------------------

export const COMPARADO_COM_OS_30_DIAS = "30 dias anteriores";

/** O percentual com o sinal ASCII ("+25%", "-10%", "0%"). */
function percentualComSinal(valor: number): string {
  const modulo = `${contagemNoPainel(Math.abs(valor))}%`;
  if (valor > 0) {
    return `+${modulo}`;
  }
  return valor < 0 ? `-${modulo}` : modulo;
}

export type TendenciaDescrita = {
  direcao: DirecaoDaTendencia;
  /** O texto visivel: "+25%", "-10%", "Estável" ou "Sem base". */
  visivel: string;
  /** A frase do leitor de tela. */
  falado: string;
  /** Bom para a clinica (subindo), ruim (caindo) ou nulo (estavel, sem base). */
  boa: boolean | null;
};

export function descreverTendencia(
  tendencia: TendenciaNoPainel,
): TendenciaDescrita {
  const vs = `vs. ${COMPARADO_COM_OS_30_DIAS}`;
  const variacao = tendencia.variacaoPercentual ?? 0;
  switch (tendencia.direcao) {
    case "sem_base":
      return {
        direcao: "sem_base",
        visivel: TEXTOS_DO_PAINEL.semBase,
        falado: `sem base de comparação: nenhum nos ${COMPARADO_COM_OS_30_DIAS}`,
        boa: null,
      };
    case "estavel":
      return {
        direcao: "estavel",
        visivel: TEXTOS_DO_PAINEL.estavel,
        falado: `estável, ${percentualComSinal(variacao)} ${vs}`,
        boa: null,
      };
    case "subindo":
      return {
        direcao: "subindo",
        visivel: percentualComSinal(variacao),
        falado: `subindo ${contagemNoPainel(Math.abs(variacao))}% ${vs}`,
        boa: true,
      };
    case "caindo":
      return {
        direcao: "caindo",
        visivel: percentualComSinal(variacao),
        falado: `caindo ${contagemNoPainel(Math.abs(variacao))}% ${vs}`,
        boa: false,
      };
  }
}

// ---------------------------------------------------------------------------
// IA no mes (segunda leva, pedido do dono: "Esse gasto de IA ta certo? Era
// bom fazer por clinica"): o gasto do mes com a precisao real e as chamadas.
// ---------------------------------------------------------------------------

/**
 * Sem agente liberado, sem gasto e sem chamada no mes: a linha diz "Sem uso
 * de IA" (nunca um traco nem um "US$ 0,00" solto).
 */
export function semUsoDeIa(
  clinica: Pick<ClinicaNoPainel, "agente" | "gasto">,
): boolean {
  return (
    clinica.agente.estado === "desligado" &&
    clinica.gasto.mesMicrodolares === 0 &&
    clinica.gasto.mesChamadas === 0
  );
}

// ---------------------------------------------------------------------------
// Textos (linguagem de recepcao, sem travessao)
// ---------------------------------------------------------------------------

/**
 * O que o ultimo acesso mede (decisao do dono de 26/10/2026, "Pela ultima
 * atividade"): o maior entre o ultimo login e a renovacao da sessao, que o
 * sistema faz enquanto a pessoa usa. A tela diz isso na descricao do
 * painel e na equipe do detalhe. Os limites (folga de ate cerca de 1 hora;
 * quem clica em Sair volta ao login) ficam no docs/04, secao 27.
 */
const ULTIMO_ACESSO_E_ATIVIDADE =
  "O último acesso é a última atividade da pessoa no sistema: quem continua conectado e usando aparece em dia, sem precisar entrar de novo.";

export const TEXTOS_DO_PAINEL = {
  titulo: "Painel geral",
  eyebrow: "Equipe Conduzza",
  descricao: `Como cada clínica usa o sistema: quem da equipe usou por último, quantas pessoas tem, o WhatsApp e o agente de IA. De paciente, só contagens. ${ULTIMO_ACESSO_E_ATIVIDADE}`,
  ultimoAcessoEAtividade: ULTIMO_ACESSO_E_ATIVIDADE,
  soEquipeConduzza: "Somente a equipe Conduzza usa o painel geral.",
  sessaoExpirada: "Sessão expirada. Entre de novo.",
  dadosInvalidos: "Dados inválidos. Recarregue a página e tente de novo.",
  semResposta: "O servidor não respondeu. Confira a conexão e tente de novo.",
  erroAoCarregar: "Não foi possível carregar o painel",
  erroAoCarregarDescricao:
    "Confira a conexão e tente de novo. Nada foi alterado em nenhuma clínica.",
  vazio: "Nenhuma clínica cadastrada ainda",
  vazioDescricao:
    "As clínicas aparecem aqui assim que alguém se cadastra ou a equipe Conduzza cria uma.",
  vazioPorFiltro: "Nenhuma clínica com esses filtros",
  vazioPorFiltroDescricao:
    "Ajuste a busca ou os filtros, ou limpe para ver todas as clínicas.",
  clinicaNaoEncontrada:
    "Esta clínica não está no painel. Ela pode ter sido removida. Recarregue a página.",
  // Acompanhamento de cliente (26/10/2026): o uso e o ultimo acesso
  buscaPlaceholder: "Clínica, nome ou e-mail da equipe",
  ninguemEntrou: "Ninguém entrou ainda",
  nuncaEntrou: "Nunca entrou",
  semNomeNoPerfil: "Sem nome no perfil",
  rodapeDoEmUso: "Alguém da equipe usou o sistema nos últimos 30 dias",
  rodapeDoSemUso: "Ninguém da equipe usou o sistema nos últimos 30 dias",
  rodapeDasSuspensas: "Também contadas em Em uso ou Sem uso",
  rodapeDoAgenteLiberado: "Em Teste ou em Produção",
  // O agente na linha da lista: liberar (Teste) e retirar (Desligado)
  liberarAgente: "Liberar agente",
  retirarAgente: "Retirar agente",
  agenteLiberadoNaClinica: (nome: string) =>
    `Agente de IA liberado na ${nome}, em Teste.`,
  agenteRetiradoDaClinica: (nome: string) =>
    `Agente de IA retirado da ${nome}.`,
  // Depois de liberar, o agente so responde com os numeros e os telefones
  // ligados, o que se faz no detalhe da clinica.
  efeitoDaLiberacaoNoDetalhe:
    "Ele só responde depois que os números e os telefones da equipe forem ligados, no detalhe da clínica.",
  efeitoDaRetirada: [
    "O agente para de atender nesta clínica, em todos os números.",
    "As conversas que estavam com ele voltam para a equipe da clínica, sem nenhuma mensagem ao paciente.",
  ],
  efeitoDaRetiradaDaProducao:
    "A clínica sai da produção. Para voltar, o agente é liberado em Teste de novo, e a produção liga pelo detalhe da clínica, com os requisitos cumpridos.",
  // A equipe no detalhe (P18-5: os Implementadores numa lista separada)
  equipeTitulo: "Equipe da clínica",
  equipeLista: "Equipe",
  equipeVazia: "Ninguém na equipe desta clínica.",
  equipeConduzzaMarca: "Equipe Conduzza",
  equipeConduzzaExplicacao:
    "Quem é da equipe Conduzza aparece marcado. Com acesso ativo, conta no uso e nas contagens da clínica como qualquer pessoa da equipe.",
  // O marcador do ultimo acesso quando foi a equipe Conduzza (na lista e no
  // detalhe) e a linha da coluna Equipe.
  daEquipeConduzza: "equipe Conduzza",
  incluiEquipeConduzza: (quantas: number) =>
    quantas === 1
      ? "Inclui 1 da equipe Conduzza"
      : `Inclui ${quantas.toLocaleString("pt-BR")} da equipe Conduzza`,
  implementadoresTitulo: "Implementadores",
  implementadoresDescricao:
    "Assistentes técnicos que configuram a clínica, marcados pelo administrador dela. Veem e fazem tudo o que o administrador faz, menos mexer em administradores e exportar os leads.",
  nenhumImplementador: "Nenhum implementador nesta clínica.",
  equipeSemLeitura:
    "Não foi possível carregar a equipe desta clínica. Recarregue a página.",
  // Conta
  motivoCurto: "Escreva o motivo com pelo menos 3 letras.",
  motivoLongo: "O motivo tem no máximo 300 caracteres.",
  motivoInvalido: "Escreva o motivo com 3 a 300 caracteres.",
  motivoRegistrado: "Fica registrado junto com o seu usuário e a data.",
  // Suspender e reativar: o motivo e obrigatorio e o botao de confirmar
  // so habilita dentro da faixa (o check do banco); a regra fica escrita
  // no apoio do campo, ligado ao campo e ao botao.
  regraDoMotivoDaConta:
    "De 3 a 300 caracteres. Fica registrado junto com o seu usuário e a data.",
  efeitoDaSuspensao: [
    'A equipe da clínica passa a ver "Conta suspensa" ao entrar e não abre mais as telas.',
    "Réguas, automações, mensagens agendadas e o agente de IA param de enviar. As conversas do agente voltam para a equipe.",
    "As mensagens que os pacientes mandarem continuam chegando e ficam guardadas. Nenhum dado é apagado.",
  ],
  efeitoDaReativacao: [
    "A equipe da clínica volta a entrar normalmente, e tudo volta como estava.",
    "As mensagens automáticas que venceram durante a suspensão são canceladas, para nenhum paciente receber mensagem fora de hora. As marcadas para depois de agora continuam na fila.",
  ],
  jaSuspensa: "Esta clínica já está suspensa. Recarregue a página.",
  jaAtiva: "Esta clínica já está ativa. Recarregue a página.",
  naoSuspendeu: "Não foi possível suspender a conta. Tente de novo.",
  naoReativou: "Não foi possível reativar a conta. Tente de novo.",
  // Agente
  descricaoDoAgente:
    "Desligado: o agente não atende nesta clínica. Teste: conversa só com os telefones da equipe cadastrados abaixo, pelos números ligados. Produção: atende os contatos do público escolhido, pelos números ligados, depois de cumpridos os requisitos.",
  // Antes da migration da producao (o banco ainda nao tem os requisitos).
  dicaDaProducao:
    "A produção ainda não está liberada. Antes dela vêm: a conversão só depois da aprovação, a escolha entre leads, pacientes ou os dois, a rodada paga de conferência do CFM, o contrato com a OpenAI e o aviso de assistente virtual para o paciente.",
  dicaDaProducaoComRequisitos:
    "Produção: só liga com todos os requisitos de Para liberar a produção cumpridos.",
  dicaDaProducaoSoDeTeste: "Produção: ligue o agente em Teste antes.",
  producaoRecusada: "A produção do agente ainda não está liberada.",
  efeitoDoTeste: [
    "O agente passa a conversar pelo WhatsApp só com os telefones da equipe cadastrados nesta clínica, pelos números ligados a ele.",
    "Os pacientes continuam sendo atendidos pela equipe da clínica.",
    "O gasto conta para o teto da clínica, e a clínica pode desligar ou pausar o agente na aba WhatsApp da tela Agente de IA.",
  ],
  // Producao (onda 2, item 11; texto do contrato, secao 5.4).
  efeitoDaProducao: (publico: string) =>
    `O assistente passa a responder ${publico} que escreverem para os números ligados. Os telefones da equipe também são atendidos, se estiverem no público escolhido.`,
  efeitosDaProducao: [
    "O gasto conta para o teto da clínica, que acaba mais rápido com todos os contatos. Confira o teto antes.",
    "A clínica pode pausar e retomar o agente na aba WhatsApp da tela Agente de IA.",
  ],
  regraDoMotivoDaProducao:
    "Obrigatório, de 3 a 300 caracteres. Fica registrado junto com o seu usuário e a data.",
  // Producao para Teste: as conversas de quem nao e telefone da equipe
  // voltam para a equipe, sem mensagem ao paciente (contrato, secao 3.1).
  efeitoDaVoltaParaTeste: [
    "O agente volta a conversar só com os telefones da equipe cadastrados nesta clínica.",
    "As conversas dele com os outros contatos voltam para a equipe da clínica, sem nenhuma mensagem ao paciente.",
  ],
  requisitosPendentes: (faltam: string) =>
    `Ainda falta cumprir: ${faltam}. Recarregue a página e confira a lista.`,
  requisitosPendentesSemLista:
    "Ainda há requisito da produção pendente. Recarregue a página e confira a lista.",
  producaoSoDeTeste: "Ligue o agente em Teste antes de ligar a produção.",
  agenteDeTesteRecusado:
    "Esta clínica é de teste automático e não muda pelo painel.",
  naoMudouOAgente: "Não foi possível mudar o agente. Tente de novo.",
  // A tela mostrava um estado que nao e mais o de agora (outra aba, outra
  // pessoa da equipe Conduzza, a revogacao de um requisito): o banco recusa
  // (P0001 agente_mudou) e nada muda.
  agenteMudou:
    "O agente desta clínica mudou desde que a página foi aberta. Recarregue a página e confira antes de mudar de novo.",
  // O banco recusa ligar em teste a clinica suspensa (P0001
  // clinica_suspensa); desligar continua livre.
  suspensaNaoLigaOAgente:
    "Reative a conta antes de ligar o agente desta clínica em Teste.",
  // Com a linha de liberacao ligada, a clinica suspensa sai da lista e o
  // banco recusa mudar o teto (P0001 clinica_suspensa).
  suspensaNaoMudaOTeto: "Reative a conta antes de mudar o teto desta clínica.",
  agenteComContaSuspensa:
    "Com a conta suspensa, o agente não atende, mesmo em Teste. Ele volta a atender quando a conta for reativada.",
  agenteSemLeitura:
    "Não foi possível conferir agora como o agente está na clínica. Recarregue a página.",
  // Interruptor geral (onda 2, P8: saiu da aba da clinica e mora no topo
  // da lista do painel; o mesmo comportamento de antes).
  interruptorTitulo: "Interruptor geral",
  interruptorDescricao:
    "Liga e desliga o agente em todas as clínicas de uma vez.",
  interruptorEfeito:
    "Desligado, nenhuma clínica tem o agente respondendo, e as conversas dele voltam para a equipe sem nenhuma mensagem ao paciente.",
  interruptorLigarTitulo: "Ligar o interruptor geral?",
  interruptorLigarTexto:
    "O agente passa a responder em todas as clínicas que estão com ele ligado, cada uma no modo escolhido por ela.",
  interruptorLigado: "Interruptor geral ligado.",
  interruptorDesligado: "Interruptor geral desligado.",
  interruptorNaoAlterou:
    "Não foi possível alterar o interruptor geral. Tente de novo.",
  interruptorSemLeitura:
    "Não foi possível conferir o interruptor geral agora. Recarregue a página.",
  // Teto
  tetoExplicacao:
    "Ao chegar no teto, o agente para de responder até o gasto mais antigo completar 24 horas. O simulador conta junto.",
  respostasExplicacao:
    "O máximo de respostas do agente numa mesma conversa em uma hora.",
  tetoSemLinha:
    "O teto nasce quando o agente é ligado em Teste pela primeira vez nesta clínica.",
  tetoInvalido: "Informe o teto em dólares, de 0,01 a 1.000, por exemplo 5,00.",
  respostasInvalidas: "Informe um número inteiro de 1 a 200.",
  naoMudouOTeto: "Não foi possível salvar o teto. Tente de novo.",
  // Numeros e telefones do agente pelo painel (os cartoes da aba WhatsApp
  // da Tela 6, no modo do painel; as acoes de
  // app/(app)/agente/whatsapp-actions.ts usam os mesmos textos)
  soEquipeConduzzaNoAgente:
    "Somente a equipe Conduzza muda o agente de uma clínica pelo painel geral.",
  ligueOAgenteAntes:
    "Ligue o agente desta clínica em Teste antes de mudar os números e os telefones.",
  suspensaNaoMudaNumeros:
    "Reative a conta antes de mudar os números e os telefones do agente.",
  // A acao nao sabe por que a clinica esta fora da lista do banco (agente
  // desligado ou conta suspensa): o texto cobre os dois.
  soComAgenteEmTeste:
    "Os números e os telefones só mudam com o agente desta clínica em Teste ou em Produção e a conta ativa.",
  confirmeQueEDaEquipe:
    "Confirme que este telefone é de alguém da equipe da clínica antes de adicionar.",
  semNumerosNoPainel:
    "A clínica adiciona e conecta os números na aba WhatsApp de Configurações. Depois, ligue o número aqui.",
  conversaAbertaNoPainel:
    "O agente só começa neste número depois que a equipe da clínica assumir e resolver a conversa aberta no Atendimento.",
  // Requisitos da producao (onda 2, item 11; contrato secoes 3.3 e 5.4)
  requisitosTitulo: "Para liberar a produção",
  requisitosDescricao:
    "A produção só liga com todos cumpridos. Os do banco se conferem sozinhos; os da equipe Conduzza se registram aqui, com a evidência.",
  requisitosIndisponiveis:
    "A produção ainda não chegou ao banco. Quando chegar, a lista dos requisitos aparece aqui.",
  requisitosSemLeitura:
    "Não foi possível carregar os requisitos da produção. Recarregue a página.",
  registrar: "Registrar",
  registrarDeNovo: "Registrar de novo",
  registrando: "Registrando...",
  revogar: "Revogar",
  revogando: "Revogando...",
  evidencia: "Evidência",
  evidenciaApoio:
    "O que prova e onde está guardado. De 3 a 500 caracteres. Fica registrado junto com o seu usuário e a data.",
  evidenciaInvalida: "Escreva a evidência com 3 a 500 caracteres.",
  valeParaTodas: "Vale para todas as clínicas.",
  valeSoParaEsta: "Vale só para esta clínica.",
  revogarTodasEfeito:
    "Vale para todas as clínicas: as que estão em produção voltam para Teste, e as conversas delas com quem não é telefone da equipe voltam para a equipe da clínica.",
  revogarDaClinicaEfeito:
    "Sem este requisito, a produção não liga nesta clínica.",
  // Revisao da onda 2: revogar o termo de uma clinica EM PRODUCAO tira a
  // clinica da producao na hora (revogar_requisito_da_producao chama
  // definir_agente_da_clinica para teste): a confirmacao diz o efeito real.
  revogarDaClinicaEmProducaoEfeito:
    "Esta clínica está em produção: sem este requisito, ela volta para Teste na hora, e as conversas dela com quem não é telefone da equipe voltam para a equipe da clínica, sem mensagem ao paciente.",
  requisitoRegistrado: "Requisito registrado.",
  requisitoRevogado: "Requisito revogado.",
  naoRegistrou: "Não foi possível registrar o requisito. Tente de novo.",
  naoRevogou: "Não foi possível revogar o requisito. Tente de novo.",
  requisitoJaRevogado: "Este registro já foi revogado. Recarregue a página.",
  requisitoNaoEncontrado: "Este registro não existe mais. Recarregue a página.",
  // P11e: a rodada do CFM fica registrada com a versao do filtro e do
  // modelo; mudar a versao depois so avisa, nao trava.
  versoesParaAEvidencia: (filtro: string, modelo: string) =>
    `Escreva na evidência a versão do filtro (${filtro}) e o modelo (${modelo}) da rodada.`,
  versaoMudou:
    "A versão do filtro ou do modelo mudou depois da rodada registrada. Confira e registre de novo, se for o caso. A produção não trava sozinha por isso.",
  // Segunda leva (26/10/2026): gasto de IA por clinica, saude e sinais,
  // implantacao, tendencia, notas, historico, exportar e ordenar.
  rodapeDoGastoDoMes: "Todas as clínicas, no mês corrente de cada uma.",
  semUsoDeIa: "Sem uso de IA",
  tetoPorDia: (teto: string) => `Teto de ${teto} por dia`,
  saudeTitulo: "Saúde da clínica",
  saudeRegra:
    "Em risco: sem uso há 30 dias, WhatsApp desconectado ou conta suspensa. Atenção: qualquer outro sinal de alerta. Saudável: nenhum sinal.",
  nenhumSinal: "Nenhum sinal de alerta.",
  sinaisDeAlerta: "Sinais de alerta",
  faixaDeSaude: "Saúde das clínicas",
  faixaDeSaudeApoio: "Escolha uma saúde para filtrar a lista.",
  implantacaoTitulo: "Implantação",
  implantacaoDescricao:
    "Os passos para a clínica usar o sistema por inteiro. A equipe conta quem tem acesso ativo, a equipe Conduzza inclusive.",
  semBase: "Sem base",
  estavel: "Estável",
  // Notas internas da equipe Conduzza (escolha (6) do dono)
  notasTitulo: "Notas da equipe Conduzza",
  notasDescricao:
    "Só a equipe Conduzza vê estas notas. A equipe da clínica não vê.",
  naoEscrevaDadoDePaciente: "Não escreva dado de paciente aqui.",
  naoEscrevaDadoDePacienteApoio:
    "Nada de nome, telefone ou assunto de saúde de paciente. Escreva só o que a equipe Conduzza precisa saber da conta.",
  novaNota: "Nova nota",
  regraDaNota:
    "De 1 a 2.000 caracteres. Fica registrada com o seu nome e a data.",
  salvarNota: "Salvar nota",
  salvandoNota: "Salvando...",
  notaSalva: "Nota salva.",
  notaVazia: "Escreva a nota antes de salvar.",
  notaLonga: "A nota tem no máximo 2.000 caracteres.",
  notaInvalida: "Escreva a nota com 1 a 2.000 caracteres.",
  naoSalvouANota: "Não foi possível salvar a nota. Tente de novo.",
  nenhumaNota: "Nenhuma nota ainda.",
  nenhumaNotaApoio:
    "Escreva o que a equipe Conduzza combinou com a clínica, para quem atender depois.",
  notasSemLeitura:
    "Não foi possível carregar as notas desta clínica. Recarregue a página.",
  notasTemMais: "Mostrando as 100 notas mais recentes.",
  excluirNota: "Excluir nota",
  excluindoNota: "Excluindo...",
  excluirNotaTitulo: "Excluir esta nota?",
  excluirNotaEfeito:
    "A nota sai da lista desta clínica para toda a equipe Conduzza. A exclusão fica no histórico da conta.",
  notaExcluida: "Nota excluída.",
  naoExcluiuANota: "Não foi possível excluir a nota. Tente de novo.",
  soQuemEscreveuExclui: "Só quem escreveu a nota pode excluir.",
  notaNaoEncontrada: "Esta nota não existe mais. Recarregue a página.",
  peloSistema: "pelo sistema",
  ultimaNotaEm: (data: string) => `Última nota em ${data}`,
  // Historico da conta (escolha (6) do dono)
  historicoTitulo: "Histórico da conta",
  historicoDescricao:
    "O que a equipe Conduzza mudou nesta clínica, do mais novo para o mais antigo.",
  historicoVazio: "Nada registrado ainda.",
  historicoSemLeitura:
    "Não foi possível carregar o histórico desta clínica. Recarregue a página.",
  historicoTemMais: "Mostrando os 100 registros mais recentes.",
  // Exportar a lista (escolha (7) do dono)
  exportar: "Exportar",
  exportando: "Exportando...",
  exportarSemClinicas: "Nenhuma clínica com esses filtros para exportar.",
} as const;

/**
 * O motivo do agente (e do interruptor) quando a tela nao manda nenhum: a
 * acao grava este texto na trilha, e o historico da conta nao o repete.
 */
export const MOTIVO_PADRAO_DO_AGENTE = "Painel geral";

// ---------------------------------------------------------------------------
// Requisitos da producao (onda 2, item 11; contrato secao 3.3)
// ---------------------------------------------------------------------------

/** Conferidos pelo banco, por clinica (so leitura na tela). */
export const REQUISITOS_DO_BANCO = [
  "agente_em_teste",
  "versao_publicada",
  "publico_escolhido",
  "horario_suportado",
  "numero_conectado",
  "conta_ativa",
  "conversao_na_aprovacao",
] as const;

/**
 * Registrados pela equipe Conduzza (o dono), com a evidencia. Os dois
 * ultimos entraram pela decisao P11d do dono.
 */
export const REQUISITOS_DA_EQUIPE = [
  "rodada_cfm",
  "contrato_openai",
  "aviso_assistente_virtual",
  "termo_da_clinica",
  "transcricao_com_nossa_chave",
] as const;

export type RequisitoDaEquipe = (typeof REQUISITOS_DA_EQUIPE)[number];

/**
 * O efeito de revogar, como o dialogo de confirmacao diz: o que vale para
 * todas devolve para Teste as clinicas em producao; o que vale so para
 * esta clinica tira ESTA clinica da producao na hora, se ela estiver em
 * producao (revisao da onda 2), e senao so impede ligar a producao.
 */
export function efeitoDeRevogar(entrada: {
  valeParaTodas: boolean;
  emProducao: boolean;
}): string {
  if (entrada.valeParaTodas) {
    return TEXTOS_DO_PAINEL.revogarTodasEfeito;
  }
  return entrada.emProducao
    ? TEXTOS_DO_PAINEL.revogarDaClinicaEmProducaoEfeito
    : TEXTOS_DO_PAINEL.revogarDaClinicaEfeito;
}

export function ehRequisitoDaEquipe(chave: string): chave is RequisitoDaEquipe {
  return (REQUISITOS_DA_EQUIPE as readonly string[]).includes(chave);
}

/**
 * Para quem vale o registro: o termo e por clinica (RIPD e termo da clinica
 * com a IA e a OpenAI como suboperadora); os outros valem para todas.
 */
export const ESCOPO_DO_REQUISITO: Readonly<
  Record<RequisitoDaEquipe, "clinica" | "todas">
> = {
  rodada_cfm: "todas",
  contrato_openai: "todas",
  aviso_assistente_virtual: "todas",
  termo_da_clinica: "clinica",
  transcricao_com_nossa_chave: "todas",
};

/** O nome de cada requisito na lista (linguagem da equipe Conduzza). */
export const ROTULO_DO_REQUISITO: Readonly<Record<string, string>> = {
  agente_em_teste: "O agente passou pelo Teste",
  versao_publicada: "Versão do assistente publicada",
  publico_escolhido: "Público escolhido em Regras e limites",
  horario_suportado:
    "Horário que funciona no WhatsApp (24 horas ou Só fora do expediente)",
  numero_conectado: "Pelo menos um número ligado ao agente e conectado",
  conta_ativa: "Conta da clínica ativa",
  conversao_na_aprovacao: "Conversão só depois da aprovação da consulta",
  rodada_cfm: "Rodada paga de conferência do CFM",
  contrato_openai: "Contrato com a OpenAI para dado de saúde",
  aviso_assistente_virtual: "Aviso de assistente virtual aprovado",
  termo_da_clinica: "Termo da clínica com a IA e a OpenAI",
  transcricao_com_nossa_chave: "Transcrição de áudio pela chave do Conduzza",
};

/** O nome do requisito; chave que a tela nao conhece vira um nome neutro. */
export function rotuloDoRequisito(chave: string): string {
  return Object.hasOwn(ROTULO_DO_REQUISITO, chave)
    ? (ROTULO_DO_REQUISITO[chave] ?? "Outro requisito do banco")
    : "Outro requisito do banco";
}

/** Uma linha do cartao "Para liberar a produção". */
export type LinhaDoRequisito = {
  chave: string;
  rotulo: string;
  estado: EstadoDoRequisito;
  /** O que o banco conferiu, em texto (nulo: nada a acrescentar). */
  detalhe: string | null;
  /** Da equipe Conduzza: registra (sem registro vivo) ou revoga. */
  daEquipe: boolean;
  /** O registro vivo que vale para esta clinica, se houver. */
  vivo: RegistroDoRequisito | null;
  /** O ultimo revogado (so quando nao ha vivo). */
  revogado: RegistroDoRequisito | null;
};

const ROTULO_DO_ESTADO_DO_AGENTE: Readonly<Record<string, string>> = {
  desligado: "Desligado",
  teste: "Teste",
  producao: "Produção",
};

/**
 * O que o banco conferiu, em texto de recepcao (so o que ajuda a cumprir o
 * que falta). Nulo: nada a acrescentar.
 */
export function detalheDoRequisito(
  conferido: RequisitoConferido,
): string | null {
  const { chave, conferido: viu } = conferido;
  switch (chave) {
    case "agente_em_teste":
      return viu.estado && Object.hasOwn(ROTULO_DO_ESTADO_DO_AGENTE, viu.estado)
        ? `Agora: ${ROTULO_DO_ESTADO_DO_AGENTE[viu.estado]}.`
        : null;
    case "versao_publicada":
      return viu.versao !== null
        ? `Versão ${viu.versao} publicada.`
        : "Nenhuma versão publicada ainda.";
    case "publico_escolhido": {
      const publico = publicoDoBanco(viu.publico);
      return publico
        ? `${ROTULO_DO_PUBLICO[publico]}.`
        : "Ainda não escolhido na versão publicada.";
    }
    case "horario_suportado":
      return viu.modo && Object.hasOwn(ROTULO_DO_MODO, viu.modo)
        ? `${ROTULO_DO_MODO[viu.modo as ModoDeOperacao]}.`
        : null;
    case "numero_conectado":
      return viu.conectados === null
        ? null
        : viu.conectados === 0
          ? "Nenhum número ligado e conectado."
          : viu.conectados === 1
            ? "1 número ligado e conectado."
            : `${viu.conectados} números ligados e conectados.`;
    default:
      return null;
  }
}

/**
 * As linhas do cartao, na ordem do banco: cumprido pelo que o banco diz
 * (ok); sem o ok, "Revogado" quando o registro da equipe que valia foi
 * revogado e nao ha outro vivo, e "Falta" no resto.
 */
export function linhasDosRequisitos(
  requisitos: Extract<RequisitosDaProducao, { estado: "lido" }>,
): LinhaDoRequisito[] {
  return requisitos.conferidos.map((conferido) => {
    const registro = conferido.registro;
    const vivo = registro && !registro.revogado ? registro : null;
    const revogado = registro && registro.revogado ? registro : null;
    const estado: EstadoDoRequisito = conferido.ok
      ? "cumprido"
      : revogado !== null
        ? "revogado"
        : "falta";
    return {
      chave: conferido.chave,
      rotulo: rotuloDoRequisito(conferido.chave),
      estado,
      detalhe: detalheDoRequisito(conferido),
      daEquipe:
        conferido.origem === "equipe" && ehRequisitoDaEquipe(conferido.chave),
      vivo,
      revogado,
    };
  });
}

/**
 * Producao liberada: os requisitos foram lidos, a lista nao esta vazia e
 * todos estao cumpridos (falha fechada: leitura que falhou, banco sem a
 * migration ou lista vazia nunca liberam).
 */
export function producaoLiberada(
  requisitos: RequisitosDaProducao | "erro",
): boolean {
  return (
    requisitos !== "erro" &&
    requisitos.estado === "lido" &&
    requisitos.conferidos.length > 0 &&
    requisitos.conferidos.every((requisito) => requisito.ok)
  );
}

/**
 * O publico da ultima versao publicada, como o banco conferiu no requisito
 * publico_escolhido. Nulo: ainda nao escolhido, ou nao deu para ler.
 */
export function publicoDosRequisitos(
  requisitos: RequisitosDaProducao | "erro",
): string | null {
  if (requisitos === "erro" || requisitos.estado !== "lido") {
    return null;
  }
  return (
    requisitos.conferidos.find((r) => r.chave === "publico_escolhido")
      ?.conferido.publico ?? null
  );
}

/**
 * P11e: a rodada do CFM registrada fala de outra versao do filtro ou do
 * modelo? A evidencia e texto livre; a tela pede para escrever as duas
 * versoes nela e confere se as de agora aparecem. So avisa (nunca trava).
 * Sem registro vivo da rodada: nada a avisar.
 */
export function versaoMudouDepoisDaRodada(
  linhas: readonly LinhaDoRequisito[],
  versoes: { filtro: string; modelo: string } | null,
): boolean {
  if (versoes === null) {
    return false;
  }
  const evidencia =
    linhas.find((linha) => linha.chave === "rodada_cfm")?.vivo?.evidencia ??
    null;
  if (evidencia === null) {
    return false;
  }
  return (
    !evidencia.includes(versoes.filtro) || !evidencia.includes(versoes.modelo)
  );
}

/**
 * As chaves que o banco devolve no hint de P0001 requisitos_pendentes
 * (definir_agente_da_clinica), em nomes; nulo quando nao da para ler.
 */
export function requisitosDoHint(
  hint: string | null | undefined,
): string[] | null {
  if (!hint) {
    return null;
  }
  const chaves = hint
    .split(/[\s,;]+/)
    .map((parte) => parte.trim())
    .filter(
      (parte) => parte !== "" && Object.hasOwn(ROTULO_DO_REQUISITO, parte),
    );
  return chaves.length > 0 ? chaves.map(rotuloDoRequisito) : null;
}

/**
 * "aos leads", "aos pacientes" ou "aos leads e aos pacientes": o publico
 * publicado no dialogo da producao. Nulo: a tela nao sabe (o requisito do
 * publico ja trava a producao nesse caso).
 */
export function publicoNoDialogo(publico: string | null): string | null {
  switch (publico) {
    case "leads":
      return "aos leads";
    case "pacientes":
      return "aos pacientes";
    case "todos":
      return "aos leads e aos pacientes";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Formatos
// ---------------------------------------------------------------------------

/** "US$ 1,23" (centavos de dolar, sempre com 2 casas). */
export function dolares(centavos: number): string {
  const valor = (centavos / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `US$ ${valor}`;
}

/** "5,00": o valor do campo de digitacao do teto. */
export function dolaresParaCampo(centavos: number): string {
  return (centavos / 100).toFixed(2).replace(".", ",");
}

/** 10.000 microdolares = 1 centavo de dolar. */
export const MICRODOLARES_POR_CENTAVO = 10_000;

/**
 * O gasto em microdolares (US$ 1 = 1.000.000) com a precisao real (segunda
 * leva, pedido do dono): abaixo de 1 centavo, todas as casas que o valor
 * tem ("US$ 0,001", "US$ 0,0015", "US$ 0,000001"), nunca "US$ 0,00" quando
 * houve gasto; de 1 centavo para cima, as 2 casas de sempre ("US$ 3,10",
 * arredondado como o banco arredonda os centavos). Zero e "US$ 0,00".
 */
export function dolaresPrecisos(microdolares: number): string {
  if (microdolares > 0 && microdolares < MICRODOLARES_POR_CENTAVO) {
    const valor = (microdolares / 1_000_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 6,
    });
    return `US$ ${valor}`;
  }
  return dolares(Math.round(microdolares / MICRODOLARES_POR_CENTAVO));
}

/**
 * O mesmo valor para a planilha, sem o "US$" ("0,001", "3,10"): a coluna
 * diz a moeda no titulo.
 */
export function dolaresPrecisosParaPlanilha(microdolares: number): string {
  return dolaresPrecisos(microdolares).replace(/^US\$\s/, "");
}

/** "Nenhuma chamada", "1 chamada", "1.234 chamadas" (as chamadas da IA). */
export function textoDasChamadas(chamadas: number): string {
  if (chamadas === 0) {
    return "Nenhuma chamada";
  }
  return chamadas === 1
    ? "1 chamada"
    : `${contagemNoPainel(chamadas)} chamadas`;
}

/** "2 de 3"; "Nenhum número" sem numero. */
export function textoDosNumeros(clinica: ClinicaNoPainel): string {
  if (clinica.numerosTotal === 0) {
    return "Nenhum número";
  }
  return `${clinica.numerosConectados} de ${clinica.numerosTotal}`;
}

/** Ha numero, mas nenhum conectado (o chip de alerta na lista). */
export function nenhumNumeroConectado(
  clinica: Pick<ClinicaNoPainel, "numerosTotal" | "numerosConectados">,
): boolean {
  return clinica.numerosTotal > 0 && clinica.numerosConectados === 0;
}

function naClinica(instante: string, fuso: string): TZDate {
  return new TZDate(new Date(instante).getTime(), fuso);
}

/**
 * Quando, no relogio e no calendario da clinica (CLAUDE.md 3.6): "Hoje,
 * 14:05", "Ontem, 09:12", "22/09" no mesmo ano ou "22/09/2025".
 */
export function quandoNaClinica(
  instante: string,
  fuso: string,
  agora: Date,
): string {
  const dia = diaCivil(fuso, new Date(instante));
  const hoje = diaCivil(fuso, agora);
  const local = naClinica(instante, fuso);
  if (dia === hoje) {
    return `Hoje, ${format(local, "HH:mm")}`;
  }
  if (dia === somarDias(hoje, -1)) {
    return `Ontem, ${format(local, "HH:mm")}`;
  }
  return format(
    local,
    dia.slice(0, 4) === hoje.slice(0, 4) ? "dd/MM" : "dd/MM/yyyy",
  );
}

/** "22/09/2026, 14:05" no fuso da clinica (suspensao, criacao). */
export function dataEHoraNaClinica(instante: string, fuso: string): string {
  return format(naClinica(instante, fuso), "dd/MM/yyyy, HH:mm");
}

/** "22/09/2026" no fuso da clinica. */
export function dataNaClinica(instante: string, fuso: string): string {
  return format(naClinica(instante, fuso), "dd/MM/yyyy");
}

/** "1.248": contagem com o separador de milhar do pt-BR. */
export function contagemNoPainel(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

/**
 * Ha quanto tempo, pelos dias do calendario da clinica (CLAUDE.md 3.6):
 * "Hoje", "Ontem", "Há 5 dias" (ate 30), "Há 1 mês", "Há 3 meses" (a
 * partir de 31, de 30 em 30 dias) e "Há 1 ano", "Há 2 anos" (de 365 em
 * 365). O dia e a hora exatos vao ao lado (dataEHoraNaClinica).
 *
 * Ate 30 em dias, nunca em meses: o "Em uso" do banco conta 30 vezes 24
 * horas, e um acesso de 30 dias de calendario atras (25/09 as 23:30 lido em
 * 25/10 as 08:00) ainda esta em uso; "Há 1 mês" nessa linha desmentia o
 * "usou o sistema nos últimos 30 dias" (revisao de 26/10/2026).
 */
export function haQuantoTempo(
  instante: string,
  fuso: string,
  agora: Date,
): string {
  const dias = diasEntre(
    diaCivil(fuso, new Date(instante)),
    diaCivil(fuso, agora),
  );
  if (dias <= 0) {
    return "Hoje";
  }
  if (dias === 1) {
    return "Ontem";
  }
  if (dias <= 30) {
    return `Há ${dias} dias`;
  }
  if (dias < 365) {
    const meses = Math.floor(dias / 30);
    return meses === 1 ? "Há 1 mês" : `Há ${meses} meses`;
  }
  const anos = Math.floor(dias / 365);
  return anos === 1 ? "Há 1 ano" : `Há ${anos} anos`;
}

/**
 * Como a pessoa aparece: o nome do perfil; sem nome, o e-mail; sem os
 * dois, "Sem nome no perfil".
 */
export function nomeDaPessoa(pessoa: {
  nome: string | null;
  email: string | null;
}): string {
  return pessoa.nome ?? pessoa.email ?? TEXTOS_DO_PAINEL.semNomeNoPerfil;
}

/**
 * Quem entrou por ultimo, na linha da lista: o nome e, quando foi a equipe
 * Conduzza, a marca ("Vinicius Rodrigues (equipe Conduzza)"), para o uso
 * dela nao passar pelo da clinica.
 */
export function quemEntrouNaLista(acesso: UltimoAcessoNoPainel): string {
  const nome = nomeDaPessoa(acesso);
  return acesso.equipeConduzza
    ? `${nome} (${TEXTOS_DO_PAINEL.daEquipeConduzza})`
    : nome;
}

/**
 * Quem entrou por ultimo, para o detalhe: o nome e o papel na clinica
 * ("Ana Souza (Recepção)"; o Implementador pelo rotulo dele), com a marca
 * da equipe Conduzza quando foi ela ("Vinicius Rodrigues (Administrador,
 * equipe Conduzza)").
 */
export function quemEntrou(acesso: UltimoAcessoNoPainel): string {
  const nome = nomeDaPessoa(acesso);
  const papel = acesso.implementador
    ? ROTULO_DO_PAPEL.implementador
    : acesso.papel
      ? ROTULO_DO_PAPEL[acesso.papel]
      : null;
  const marcas = [
    ...(papel ? [papel] : []),
    ...(acesso.equipeConduzza ? [TEXTOS_DO_PAINEL.daEquipeConduzza] : []),
  ];
  return marcas.length > 0 ? `${nome} (${marcas.join(", ")})` : nome;
}

/** O papel da pessoa como a equipe da clinica ve ("Recepção"). */
export function papelDaPessoa(pessoa: Pick<PessoaDaEquipe, "papel">): string {
  return ROTULO_DO_PAPEL[pessoa.papel];
}

/**
 * A coluna Equipe da lista, em partes (o numero em mono, a palavra no
 * texto, como os leads e as conversas): "3 ativas" (vinculos ativos) e "2
 * pendentes" (pedidos de entrada); sem nenhuma, so a palavra ("Nenhuma
 * ativa"). Juntas, numero e palavra separados por espaco.
 */
export function contagemDaEquipe(
  valor: number,
  tipo: "ativas" | "pendentes",
): { numero: string | null; palavra: string } {
  const singular = tipo === "ativas" ? "ativa" : "pendente";
  if (valor === 0) {
    return { numero: null, palavra: `Nenhuma ${singular}` };
  }
  return {
    numero: contagemNoPainel(valor),
    palavra: valor === 1 ? singular : tipo,
  };
}

// ---------------------------------------------------------------------------
// Busca e filtros (na URL: o link leva o mesmo recorte)
// ---------------------------------------------------------------------------

export type FiltroDoUso = "todas" | UsoDaClinica;
export type FiltroDaConta = "todas" | SituacaoDaConta;

/** O agente liberado (Teste ou Producao) ou nao (Desligado). */
export type LiberacaoDoAgente = "liberado" | "nao_liberado";
export type FiltroDoAgente = "todos" | LiberacaoDoAgente;

/** A saude (segunda leva): a faixa do topo e o segmentado mexem aqui. */
export type FiltroDaSaude = "todas" | SaudeNoPainel;

export type FiltrosDoPainel = {
  busca: string;
  uso: FiltroDoUso;
  conta: FiltroDaConta;
  agente: FiltroDoAgente;
  saude: FiltroDaSaude;
};

export const FILTROS_PADRAO: FiltrosDoPainel = {
  busca: "",
  uso: "todas",
  conta: "todas",
  agente: "todos",
  saude: "todas",
};

export const OPCOES_DO_USO: readonly { value: FiltroDoUso; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "em_uso", label: "Em uso" },
  { value: "sem_uso", label: "Sem uso" },
];

export const OPCOES_DA_CONTA: readonly {
  value: FiltroDaConta;
  label: string;
}[] = [
  { value: "todas", label: "Todas" },
  { value: "ativa", label: "Ativas" },
  { value: "suspensa", label: "Suspensas" },
];

export const OPCOES_DO_AGENTE: readonly {
  value: FiltroDoAgente;
  label: string;
}[] = [
  { value: "todos", label: "Todos" },
  { value: "liberado", label: "Liberado" },
  { value: "nao_liberado", label: "Não liberado" },
];

export const OPCOES_DA_SAUDE: readonly {
  value: FiltroDaSaude;
  label: string;
}[] = [
  { value: "todas", label: "Todas" },
  ...SAUDES.map((saude) => ({
    value: saude,
    label: SAUDE_STATUS[saude].label,
  })),
];

function filtroDaSaude(valor: string | null): FiltroDaSaude {
  return SAUDES.find((saude) => saude === valor) ?? "todas";
}

export function liberacaoDoAgente(estado: EstadoDoAgente): LiberacaoDoAgente {
  return estado === "desligado" ? "nao_liberado" : "liberado";
}

/** Os filtros da URL; valor desconhecido vira o padrao. */
export function lerFiltrosDoPainel(params: {
  get(nome: string): string | null;
}): FiltrosDoPainel {
  const uso = params.get("uso");
  const conta = params.get("conta");
  const agente = params.get("agente");
  return {
    busca: (params.get("busca") ?? "").slice(0, BUSCA_MAXIMA),
    uso: uso === "em_uso" || uso === "sem_uso" ? uso : "todas",
    conta: conta === "ativa" || conta === "suspensa" ? conta : "todas",
    agente:
      agente === "liberado" || agente === "nao_liberado" ? agente : "todos",
    saude: filtroDaSaude(params.get("saude")),
  };
}

/** A busca da lista tem ate 80 caracteres (o campo e a URL). */
export const BUSCA_MAXIMA = 80;

/** Sem acento e em minusculas, para a busca nao depender da grafia. */
export function normalizarBusca(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * A ordem da lista (a mesma do banco): o ultimo acesso mais recente
 * primeiro, quem nunca entrou no fim; empate, pelo nome e pelo id.
 */
export function ordemDoPainel(a: ClinicaNoPainel, b: ClinicaNoPainel): number {
  const emA = a.ultimoAcesso ? Date.parse(a.ultimoAcesso.em) : null;
  const emB = b.ultimoAcesso ? Date.parse(b.ultimoAcesso.em) : null;
  if (emA !== emB) {
    if (emA === null) {
      return 1;
    }
    if (emB === null) {
      return -1;
    }
    return emB - emA;
  }
  return (
    a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * O recorte da lista: a busca olha o nome da clinica e o nome e o e-mail de
 * qualquer pessoa da equipe dela (dado da equipe); o uso, a conta, o agente
 * e a saude pelo valor exato. Ordem: ordemDoPainel (a ordem escolhida no
 * cabecalho vem depois, em ordenarClinicas).
 */
export function filtrarClinicas(
  clinicas: readonly ClinicaNoPainel[],
  filtros: FiltrosDoPainel,
): ClinicaNoPainel[] {
  const termo = normalizarBusca(filtros.busca);
  return clinicas
    .filter((clinica) => {
      if (filtros.uso !== "todas" && usoDaClinica(clinica) !== filtros.uso) {
        return false;
      }
      if (
        filtros.conta !== "todas" &&
        situacaoDaConta(clinica) !== filtros.conta
      ) {
        return false;
      }
      if (
        filtros.agente !== "todos" &&
        liberacaoDoAgente(clinica.agente.estado) !== filtros.agente
      ) {
        return false;
      }
      if (filtros.saude !== "todas" && clinica.saude !== filtros.saude) {
        return false;
      }
      if (termo === "") {
        return true;
      }
      const onde = [
        clinica.nome,
        ...clinica.pessoas.flatMap((pessoa) => [
          pessoa.nome ?? "",
          pessoa.email ?? "",
        ]),
      ];
      return onde.some((campo) => normalizarBusca(campo).includes(termo));
    })
    .sort(ordemDoPainel);
}

export function filtrosAtivos(filtros: FiltrosDoPainel): boolean {
  return (
    filtros.busca.trim() !== "" ||
    filtros.uso !== "todas" ||
    filtros.conta !== "todas" ||
    filtros.agente !== "todos" ||
    filtros.saude !== "todas"
  );
}

// ---------------------------------------------------------------------------
// Ordem da lista (segunda leva, escolha (7) do dono): clicar no cabecalho
// ordena por aquela coluna; clicar de novo inverte. Na URL (ordem e
// sentido), como os filtros. Sem nada na URL, a ordem do banco (o ultimo
// acesso mais recente primeiro). Empate: a ordem do banco.
// ---------------------------------------------------------------------------

export type ColunaDaOrdem =
  "ultimo_acesso" | "saude" | "ia" | "leads" | "conversas" | "implantacao";

export type SentidoDaOrdem = "asc" | "desc";

export type OrdemDaLista = { coluna: ColunaDaOrdem; sentido: SentidoDaOrdem };

export const ORDEM_PADRAO: OrdemDaLista = {
  coluna: "ultimo_acesso",
  sentido: "desc",
};

const COLUNAS_DA_ORDEM: readonly ColunaDaOrdem[] = [
  "ultimo_acesso",
  "saude",
  "ia",
  "leads",
  "conversas",
  "implantacao",
];

/**
 * O sentido do primeiro clique em cada coluna, o mais util para quem
 * acompanha: o acesso mais recente, a pior saude, o maior gasto, mais leads
 * e mais conversas primeiro; na implantacao, quem fez menos passos primeiro
 * (quem precisa de ajuda).
 */
export const PRIMEIRO_SENTIDO: Readonly<Record<ColunaDaOrdem, SentidoDaOrdem>> =
  {
    ultimo_acesso: "desc",
    saude: "desc",
    ia: "desc",
    leads: "desc",
    conversas: "desc",
    implantacao: "asc",
  };

/** A ordem da URL; coluna ou sentido desconhecidos viram a padrao. */
export function lerOrdemDaLista(params: {
  get(nome: string): string | null;
}): OrdemDaLista {
  const coluna = COLUNAS_DA_ORDEM.find(
    (valida) => valida === params.get("ordem"),
  );
  if (!coluna) {
    return ORDEM_PADRAO;
  }
  const sentido = params.get("sentido");
  return {
    coluna,
    sentido:
      sentido === "asc" || sentido === "desc"
        ? sentido
        : PRIMEIRO_SENTIDO[coluna],
  };
}

/** A ordem depois do clique no cabecalho da coluna. */
export function proximaOrdem(
  atual: OrdemDaLista,
  coluna: ColunaDaOrdem,
): OrdemDaLista {
  if (atual.coluna !== coluna) {
    return { coluna, sentido: PRIMEIRO_SENTIDO[coluna] };
  }
  return { coluna, sentido: atual.sentido === "asc" ? "desc" : "asc" };
}

export function ehOrdemPadrao(ordem: OrdemDaLista): boolean {
  return (
    ordem.coluna === ORDEM_PADRAO.coluna &&
    ordem.sentido === ORDEM_PADRAO.sentido
  );
}

const PESO_DA_SAUDE: Readonly<Record<SaudeNoPainel, number>> = {
  saudavel: 0,
  atencao: 1,
  em_risco: 2,
};

/**
 * O valor de cada clinica na coluna (maior = "desc" primeiro). No ultimo
 * acesso, quem nunca entrou vale menos que qualquer data (fica no fim do
 * mais recente primeiro e no comeco do mais antigo primeiro). Na saude, a
 * pior vale mais, e os sinais desempatam.
 */
function valorNaColuna(
  clinica: ClinicaNoPainel,
  coluna: ColunaDaOrdem,
): number[] {
  switch (coluna) {
    case "ultimo_acesso":
      return [
        clinica.ultimoAcesso
          ? Date.parse(clinica.ultimoAcesso.em)
          : Number.NEGATIVE_INFINITY,
      ];
    case "saude":
      return [PESO_DA_SAUDE[clinica.saude], clinica.sinais.length];
    case "ia":
      return [clinica.gasto.mesMicrodolares, clinica.gasto.mesChamadas];
    case "leads":
      return [clinica.leads30Dias];
    case "conversas":
      return [clinica.conversas30Dias];
    case "implantacao":
      return [clinica.implantacao.feitos];
  }
}

function compararValores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * A lista na ordem escolhida (uma copia). Empate, a ordem do banco
 * (ordemDoPainel): a lista nunca pula de lugar entre duas leituras iguais.
 */
export function ordenarClinicas(
  clinicas: readonly ClinicaNoPainel[],
  ordem: OrdemDaLista,
): ClinicaNoPainel[] {
  const sinal = ordem.sentido === "asc" ? 1 : -1;
  return [...clinicas].sort(
    (a, b) =>
      sinal *
        compararValores(
          valorNaColuna(a, ordem.coluna),
          valorNaColuna(b, ordem.coluna),
        ) || ordemDoPainel(a, b),
  );
}

// ---------------------------------------------------------------------------
// Agente: as tres opcoes da tela (producao so com os requisitos cumpridos)
// ---------------------------------------------------------------------------

export type OpcaoDoAgente = EstadoDoAgente;

export const OPCOES_DO_ESTADO_DO_AGENTE: readonly {
  value: OpcaoDoAgente;
  label: string;
}[] = [
  { value: "desligado", label: "Desligado" },
  { value: "teste", label: "Teste" },
  { value: "producao", label: "Produção" },
];

/**
 * O dialogo de confirmacao do agente (components/painel-geral/
 * dialogo-do-agente.tsx), o mesmo no detalhe e na linha da lista:
 * - no detalhe: ligar em teste, ligar a producao e voltar para teste;
 * - na lista: liberar (vai para Teste) e retirar (vai para Desligado).
 */
export type ConfirmacaoDoAgente =
  "teste" | "producao" | "volta" | "liberar" | "retirar";

/** O estado que a confirmacao grava (definir_agente_da_clinica). */
export function estadoDaConfirmacao(
  confirmacao: ConfirmacaoDoAgente,
): EstadoDoAgente {
  switch (confirmacao) {
    case "producao":
      return "producao";
    case "retirar":
      return "desligado";
    default:
      return "teste";
  }
}

/**
 * Por que "Liberar agente" nao liga agora (a dica do botao desabilitado):
 * o banco recusa ligar em Teste a clinica suspensa (P0001
 * clinica_suspensa). Nulo: liga. Retirar continua livre.
 */
export function porQueNaoLibera(entrada: {
  estado: EstadoDoAgente;
  suspensa: boolean;
}): string | null {
  return entrada.estado === "desligado" && entrada.suspensa
    ? TEXTOS_DO_PAINEL.suspensaNaoLigaOAgente
    : null;
}

// ---------------------------------------------------------------------------
// Entradas das Server Actions (Zod, a mesma regra na tela e no servidor)
// ---------------------------------------------------------------------------

/** Faixa do motivo (check de clinica_suspensa: 3 a 300 depois do trim). */
export const MOTIVO_MINIMO = 3;
export const MOTIVO_MAXIMO = 300;

export const motivoSchema = z
  .string()
  .trim()
  .min(MOTIVO_MINIMO, TEXTOS_DO_PAINEL.motivoCurto)
  .max(MOTIVO_MAXIMO, TEXTOS_DO_PAINEL.motivoLongo);

export function motivoValido(motivo: string): boolean {
  return motivoSchema.safeParse(motivo).success;
}

export const contaDaClinicaSchema = z
  .object({ clinicId: z.uuid(), motivo: motivoSchema })
  .strict();

/**
 * Motivo do agente: opcional em Desligado e Teste (vazio vira o texto
 * padrao do painel); OBRIGATORIO na Producao (3 a 300, contrato da onda 2,
 * secao 3.1). estadoVisto e o estado que a tela mostrava quando a pessoa
 * decidiu: o banco confere se ainda e o de agora (agente_mudou) antes de
 * mudar. Pedir o mesmo estado que a tela mostrava nao e mudanca (o banco
 * tambem recusa, mudanca_invalida).
 */
export const agenteDaClinicaSchema = z
  .object({
    clinicId: z.uuid(),
    estadoVisto: z.enum(["desligado", "teste", "producao"]),
    estado: z.enum(["desligado", "teste", "producao"]),
    motivo: z
      .string()
      .trim()
      .max(MOTIVO_MAXIMO, TEXTOS_DO_PAINEL.motivoLongo)
      .optional(),
  })
  .strict()
  .superRefine((entrada, ctx) => {
    if (entrada.estado === entrada.estadoVisto) {
      ctx.addIssue({
        code: "custom",
        path: ["estado"],
        message: TEXTOS_DO_PAINEL.dadosInvalidos,
      });
    }
    if (
      entrada.estado === "producao" &&
      (entrada.motivo ?? "").length < MOTIVO_MINIMO
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["motivo"],
        message: TEXTOS_DO_PAINEL.motivoCurto,
      });
    }
  });

/** Faixa da evidencia de um requisito (CHECK de ia_requisito_da_producao). */
export const EVIDENCIA_MINIMA = 3;
export const EVIDENCIA_MAXIMA = 500;

export const evidenciaSchema = z
  .string()
  .trim()
  .min(EVIDENCIA_MINIMA, TEXTOS_DO_PAINEL.evidenciaInvalida)
  .max(EVIDENCIA_MAXIMA, TEXTOS_DO_PAINEL.evidenciaInvalida);

export function evidenciaValida(evidencia: string): boolean {
  return evidenciaSchema.safeParse(evidencia).success;
}

/**
 * Registrar um requisito da equipe Conduzza: a chave (so as da equipe), a
 * clinica da tela (o termo vale so para ela; os outros, para todas) e a
 * evidencia.
 */
export const registrarRequisitoSchema = z
  .object({
    clinicId: z.uuid(),
    chave: z.enum(REQUISITOS_DA_EQUIPE),
    evidencia: evidenciaSchema,
  })
  .strict();

/** Revogar um registro: o id dele, a clinica da tela e o motivo (3 a 300). */
export const revogarRequisitoSchema = z
  .object({
    clinicId: z.uuid(),
    id: z.uuid(),
    motivo: motivoSchema,
  })
  .strict();

export const interruptorGeralSchema = z
  .object({ ligado: z.boolean() })
  .strict();

// ---------------------------------------------------------------------------
// Notas internas da equipe Conduzza (segunda leva, escolha (6) do dono)
// ---------------------------------------------------------------------------

/** Faixa do texto da nota (a mesma do banco: 1 a 2.000 depois do trim). */
export const NOTA_MINIMA = 1;
export const NOTA_MAXIMA = 2000;

export const textoDaNotaSchema = z
  .string()
  .trim()
  .min(NOTA_MINIMA, TEXTOS_DO_PAINEL.notaVazia)
  .max(NOTA_MAXIMA, TEXTOS_DO_PAINEL.notaLonga);

export function notaValida(texto: string): boolean {
  return textoDaNotaSchema.safeParse(texto).success;
}

/** Escrever uma nota: a clinica da tela e o texto. */
export const escreverNotaSchema = z
  .object({ clinicId: z.uuid(), texto: textoDaNotaSchema })
  .strict();

/** Excluir uma nota: a clinica da tela (para revalidar) e a nota. */
export const excluirNotaSchema = z
  .object({ clinicId: z.uuid(), notaId: z.uuid() })
  .strict();

// ---------------------------------------------------------------------------
// Historico da conta (segunda leva, escolha (6) do dono): cada evento em
// texto de recepcao, com o que o banco deixa sair dos detalhes (o motivo, o
// estado do agente, os tetos, o requisito e as contagens).
// ---------------------------------------------------------------------------

export type DescricaoDoEvento = {
  titulo: string;
  /** As linhas de apoio, ja em texto ("Motivo: ..."). */
  linhas: string[];
};

/**
 * O motivo que revogar_requisito_da_producao grava quando tira a clinica da
 * producao (a volta para Teste e automatica): este prefixo e a CHAVE do
 * requisito ('Requisito da produção revogado: termo_da_clinica'). Ele so
 * tira da producao: a mudanca com este motivo e sempre uma volta.
 */
const MOTIVO_DA_VOLTA_PELA_REVOGACAO = "Requisito da produção revogado: ";

/** A volta automatica para Teste pela revogacao de um requisito. */
function voltaPelaRevogacao(motivo: string | null): boolean {
  return (motivo?.trim() ?? "").startsWith(MOTIVO_DA_VOLTA_PELA_REVOGACAO);
}

/**
 * "Motivo: ...", menos o motivo padrao que o painel grava sozinho. No da
 * volta pela revogacao, a chave do requisito vira o nome dele (revisao de
 * 26/10/2026: a equipe lia "termo_da_clinica").
 */
function linhaDoMotivo(motivo: string | null): string[] {
  const limpo = motivo?.trim() ?? "";
  if (limpo === "" || limpo === MOTIVO_PADRAO_DO_AGENTE) {
    return [];
  }
  if (voltaPelaRevogacao(limpo)) {
    const chave = limpo.slice(MOTIVO_DA_VOLTA_PELA_REVOGACAO.length).trim();
    if (/^[a-z0-9_]+$/.test(chave)) {
      return [
        `Motivo: ${MOTIVO_DA_VOLTA_PELA_REVOGACAO}${rotuloDoRequisito(chave)}`,
      ];
    }
  }
  return [`Motivo: ${limpo}`];
}

/**
 * O titulo da mudanca do agente. A trilha so guarda o estado de DESTINO:
 * Teste e tanto a liberacao (de Desligado) quanto a volta (da Producao,
 * pelo seletor ou pela revogacao de um requisito). A direcao vem do estado
 * da mudanca anterior na mesma lista (estadoAnterior) ou do motivo da volta
 * pela revogacao; sem nenhum dos dois, o titulo fica neutro (revisao de
 * 26/10/2026: o historico dizia "liberado" na volta).
 */
function tituloDoAgente(
  estado: string | null,
  motivo: string | null,
  estadoAnterior: string | null,
): string {
  switch (estado) {
    case "desligado":
      return "Agente retirado";
    case "producao":
      return "Agente ligado em Produção";
    case "teste":
      if (voltaPelaRevogacao(motivo) || estadoAnterior === "producao") {
        return "Agente voltou para Teste";
      }
      return estadoAnterior === "desligado"
        ? "Agente liberado em Teste"
        : "Agente passou para Teste";
    default:
      return "Agente da clínica mudou";
  }
}

function linhasDoTeto(detalhes: EventoDaConta["detalhes"]): string[] {
  const linhas: string[] = [];
  const teto = detalhes.tetoDiarioCentavos;
  const tetoAntes = detalhes.tetoDiarioAntesCentavos;
  if (teto !== null) {
    linhas.push(
      tetoAntes !== null && tetoAntes !== teto
        ? `Teto a cada 24 horas: de ${dolares(tetoAntes)} para ${dolares(teto)}.`
        : `Teto a cada 24 horas: ${dolares(teto)}.`,
    );
  }
  const respostas = detalhes.tetoRespostasPorConversaHora;
  const respostasAntes = detalhes.tetoRespostasAntesPorConversaHora;
  if (respostas !== null) {
    linhas.push(
      respostasAntes !== null && respostasAntes !== respostas
        ? `Respostas por conversa em 1 hora: de ${respostasAntes} para ${respostas}.`
        : `Respostas por conversa em 1 hora: ${respostas}.`,
    );
  }
  return linhas;
}

function linhaDoRequisito(chave: string | null): string[] {
  return chave ? [`${rotuloDoRequisito(chave)}.`] : [];
}

/**
 * O evento em texto: o titulo e as linhas de apoio. Datas (a nota excluida)
 * no fuso da clinica. estadoAnterior: o estado do agente na mudanca de
 * agente anterior a esta (descricoesDoHistorico acha na lista); nulo quando
 * nao se sabe.
 */
export function descricaoDoEvento(
  evento: Pick<EventoDaConta, "acao" | "detalhes">,
  fuso: string,
  estadoAnterior: string | null = null,
): DescricaoDoEvento {
  const { detalhes } = evento;
  switch (evento.acao) {
    case "suspendeu_clinica":
      return {
        titulo: "Conta suspensa",
        linhas: linhaDoMotivo(detalhes.motivo),
      };
    case "reativou_clinica": {
      const vencidas = detalhes.jobsVencidos ?? 0;
      return {
        titulo: "Conta reativada",
        linhas: [
          ...linhaDoMotivo(detalhes.motivo),
          ...(vencidas > 0
            ? [
                vencidas === 1
                  ? "1 mensagem automática vencida foi cancelada."
                  : `${contagemNoPainel(vencidas)} mensagens automáticas vencidas foram canceladas.`,
              ]
            : []),
        ],
      };
    }
    case "mudou_agente_da_clinica":
      return {
        titulo: tituloDoAgente(
          detalhes.estado,
          detalhes.motivo,
          estadoAnterior,
        ),
        linhas: linhaDoMotivo(detalhes.motivo),
      };
    case "mudou_teto_da_ia":
      return { titulo: "Teto de IA mudou", linhas: linhasDoTeto(detalhes) };
    case "registrou_requisito_da_producao":
      return {
        titulo: "Requisito da produção registrado",
        linhas: [
          ...linhaDoRequisito(detalhes.chave),
          ...(detalhes.substituiu ? ["Substituiu o registro anterior."] : []),
        ],
      };
    case "revogou_requisito_da_producao": {
      const devolvidas = detalhes.clinicasDeVoltaAoTeste ?? 0;
      return {
        titulo: "Requisito da produção revogado",
        linhas: [
          ...linhaDoRequisito(detalhes.chave),
          ...linhaDoMotivo(detalhes.motivo),
          ...(devolvidas > 0
            ? [
                devolvidas === 1
                  ? "1 clínica voltou para Teste."
                  : `${contagemNoPainel(devolvidas)} clínicas voltaram para Teste.`,
              ]
            : []),
        ],
      };
    }
    case "escreveu_nota_interna":
      return { titulo: "Nota escrita", linhas: [] };
    case "excluiu_nota_interna":
      return {
        titulo: "Nota excluída",
        linhas: detalhes.notaEscritaEm
          ? [
              `A nota tinha sido escrita em ${dataEHoraNaClinica(detalhes.notaEscritaEm, fuso)}.`,
            ]
          : [],
      };
  }
}

/**
 * O historico inteiro em texto (o mais novo primeiro, como o banco manda).
 * O estado de antes de cada mudanca do agente e o da mudanca de agente
 * seguinte na lista (a anterior no tempo); a mais antiga da lista fica sem
 * ele (pode haver outra alem do limite de 100), e o titulo dela, neutro.
 */
export function descricoesDoHistorico<
  E extends Pick<EventoDaConta, "acao" | "detalhes">,
>(
  eventos: readonly E[],
  fuso: string,
): { evento: E; descricao: DescricaoDoEvento }[] {
  // Do mais antigo para o mais novo: o estado do agente ate cada evento.
  const anteriores = new Array<string | null>(eventos.length).fill(null);
  let estado: string | null = null;
  for (let i = eventos.length - 1; i >= 0; i--) {
    anteriores[i] = estado;
    const evento = eventos[i];
    if (evento?.acao === "mudou_agente_da_clinica" && evento.detalhes.estado) {
      estado = evento.detalhes.estado;
    }
  }
  return eventos.map((evento, i) => ({
    evento,
    descricao: descricaoDoEvento(evento, fuso, anteriores[i] ?? null),
  }));
}

/**
 * Quem fez, para o fim da frase: "por Ana Souza", com "(equipe Conduzza)"
 * quando e dela; sem pessoa (a service role ou o SQL editor), "pelo
 * sistema".
 */
export function autoria(autor: AutorNoPainel | null): string {
  if (!autor) {
    return TEXTOS_DO_PAINEL.peloSistema;
  }
  const nome = nomeDaPessoa(autor);
  return autor.equipeConduzza
    ? `por ${nome} (${TEXTOS_DO_PAINEL.daEquipeConduzza})`
    : `por ${nome}`;
}

/**
 * Faixas de definir_teto_da_ia, as mesmas da RPC (decisao do coordenador
 * da onda 1): o teto diario de 1 a 100.000 centavos (o banco manteve o
 * check de ia_liberacao, maior que zero: para zerar o gasto, o agente
 * desligado) e as respostas de 1 a 200.
 */
export const TETO_MINIMO_CENTAVOS = 1;
export const TETO_MAXIMO_CENTAVOS = 100_000;
export const RESPOSTAS_MINIMAS = 1;
export const RESPOSTAS_MAXIMAS = 200;

export const tetoDaIaSchema = z
  .object({
    clinicId: z.uuid(),
    tetoDiarioCentavos: z
      .number()
      .int()
      .min(TETO_MINIMO_CENTAVOS, TEXTOS_DO_PAINEL.tetoInvalido)
      .max(TETO_MAXIMO_CENTAVOS, TEXTOS_DO_PAINEL.tetoInvalido),
    respostasPorConversaHora: z
      .number()
      .int(TEXTOS_DO_PAINEL.respostasInvalidas)
      .min(RESPOSTAS_MINIMAS, TEXTOS_DO_PAINEL.respostasInvalidas)
      .max(RESPOSTAS_MAXIMAS, TEXTOS_DO_PAINEL.respostasInvalidas),
  })
  .strict();

/**
 * O teto digitado em dolares ("5,00", "5.5", "12") em centavos. Nulo:
 * vazio ou fora do formato e da faixa (a tela mostra tetoInvalido). Mesma
 * leitura do valor em reais das outras telas (lerReais), sem o "R$".
 */
export function lerTetoEmDolares(texto: string): number | null {
  const semPrefixo = texto.trim().replace(/^US\$\s*/i, "");
  const centavos = lerReais(semPrefixo);
  if (
    typeof centavos !== "number" ||
    centavos < TETO_MINIMO_CENTAVOS ||
    centavos > TETO_MAXIMO_CENTAVOS
  ) {
    return null;
  }
  return centavos;
}

/** As respostas por conversa por hora digitadas; nulo fora da faixa. */
export function lerRespostasPorHora(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d{1,3}$/.test(limpo)) {
    return null;
  }
  const valor = Number(limpo);
  return valor >= RESPOSTAS_MINIMAS && valor <= RESPOSTAS_MAXIMAS
    ? valor
    : null;
}
