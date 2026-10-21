import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import {
  CircleAlert,
  CircleCheck,
  CirclePause,
  FlaskConical,
  Hourglass,
  OctagonPause,
} from "lucide-react";
import { z } from "zod";

import type { StatusDefinition } from "@/lib/design/status";
import { diaCivil, somarDias } from "@/lib/domain/horarios";
import type {
  ClinicaNoPainel,
  EstadoDoAgente,
  SituacaoDaConta,
} from "@/lib/queries/painel-geral";
import { lerReais } from "@/lib/utils/moeda";

// Regras do Painel geral (onda 1, decisao do dono de 20/10/2026). Modulo
// puro, sem "use client": as telas, as Server Actions e os testes usam as
// mesmas regras, e o que a tela desabilita e o mesmo que a acao recusa.
//
// - So a equipe Conduzza (super admin) chega aqui: a guarda vive no layout
//   da rota, em cada Server Action e nas RPCs do banco (42501).
// - Suspender a conta mantem os dados: a equipe da clinica ve "Conta
//   suspensa" ao entrar, os envios automaticos e o agente param, as
//   mensagens que chegam continuam guardadas, e reativar volta tudo como
//   estava (as mensagens automaticas que venceram durante a suspensao sao
//   canceladas, para nao sair mensagem fora de hora).
// - Agente por clinica: Desligado ou Teste (so os telefones da equipe).
//   Producao fica visivel e travada ate a onda 2, com os pre-requisitos na
//   dica.
// - O gasto da IA (24 horas, a janela do teto, e o mes no fuso da clinica)
//   aparece contra o teto diario, que a equipe Conduzza ajusta aqui.
// - So contagens: nenhum dado de paciente na tela, na URL nem em log.

// ---------------------------------------------------------------------------
// Status em 3 camadas (icone, rotulo e cor), com icones que ja tem dono no
// mesmo sentido e na mesma cor (tabela de icones reservados de
// lib/design/status.ts):
// - ativa: CircleCheck success (ativo);
// - suspensa: OctagonPause alert, icone sem outro dono no produto (a placa
//   de parar com a pausa: a conta parada de proposito, com os dados);
// - agente desligado: CirclePause neutral, o mesmo do "Desligado" da aba
//   Agente de IA de Configuracoes;
// - agente em teste: FlaskConical info, o mesmo sentido e a mesma cor do
//   "Só simulador" (teste, sem paciente);
// - gasto perto do teto: CircleAlert warning (atencao);
// - teto atingido: Hourglass warning (pendencia: o agente espera o gasto
//   mais antigo completar 24 horas), o mesmo par do "Ligado, mas parado".
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

export function situacaoDaConta(clinica: ClinicaNoPainel): SituacaoDaConta {
  return clinica.suspensao ? "suspensa" : "ativa";
}

// ---------------------------------------------------------------------------
// Textos (linguagem de recepcao, sem travessao)
// ---------------------------------------------------------------------------

export const TEXTOS_DO_PAINEL = {
  titulo: "Painel geral",
  eyebrow: "Equipe Conduzza",
  descricao:
    "Todas as clínicas do sistema: conta, agente de IA, números de WhatsApp, movimento dos últimos 30 dias e gasto de IA. Só contagens, nenhum dado de paciente.",
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
    "Desligado: o agente não atende nesta clínica. Teste: conversa só com os telefones da equipe cadastrados abaixo, pelos números ligados. Os pacientes continuam com a equipe da clínica.",
  dicaDaProducao:
    "A produção ainda não está liberada. Antes dela vêm: a conversão só depois da aprovação, a escolha entre leads, pacientes ou os dois, a rodada paga de conferência do CFM, o contrato com a OpenAI e o aviso de assistente virtual para o paciente.",
  producaoRecusada: "A produção do agente ainda não está liberada.",
  efeitoDoTeste: [
    "O agente passa a conversar pelo WhatsApp só com os telefones da equipe cadastrados nesta clínica, pelos números ligados a ele.",
    "Os pacientes continuam sendo atendidos pela equipe da clínica.",
    "O gasto conta para o teto da clínica, e a clínica pode desligar o agente na aba Agente de IA de Configurações.",
  ],
  agenteDeTesteRecusado:
    "Esta clínica é de teste automático e não muda pelo painel.",
  naoMudouOAgente: "Não foi possível mudar o agente. Tente de novo.",
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
  // O motivo "interruptor" da aba manda ao cartao Interruptor geral, que
  // nao esta no painel: aqui, onde ele fica.
  interruptorNoPainel:
    "O interruptor geral está desligado. Ele fica no cartão Interruptor geral da aba Agente de IA, em Configurações.",
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
  // Numeros e telefones do agente pelo painel (os cartoes da aba Agente de
  // IA de Configuracoes, no modo do painel; as acoes de
  // app/(app)/configuracoes/ia-liberacao-actions.ts usam os mesmos textos)
  soEquipeConduzzaNoAgente:
    "Somente a equipe Conduzza muda o agente de uma clínica pelo painel geral.",
  ligueOAgenteAntes:
    "Ligue o agente desta clínica em Teste antes de mudar os números e os telefones.",
  suspensaNaoMudaNumeros:
    "Reative a conta antes de mudar os números e os telefones do agente.",
  // A acao nao sabe por que a clinica esta fora da lista do banco (agente
  // desligado ou conta suspensa): o texto cobre os dois.
  soComAgenteEmTeste:
    "Os números e os telefones só mudam com o agente desta clínica em Teste e a conta ativa.",
  confirmeQueEDaEquipe:
    "Confirme que este telefone é de alguém da equipe da clínica antes de adicionar.",
  semNumerosNoPainel:
    "A clínica adiciona e conecta os números na aba WhatsApp de Configurações. Depois, ligue o número aqui.",
  conversaAbertaNoPainel:
    "O agente só começa neste número depois que a equipe da clínica assumir e resolver a conversa aberta no Atendimento.",
} as const;

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

/** "2 de 3"; "Nenhum número" sem numero. */
export function textoDosNumeros(clinica: ClinicaNoPainel): string {
  if (clinica.numerosTotal === 0) {
    return "Nenhum número";
  }
  return `${clinica.numerosConectados} de ${clinica.numerosTotal}`;
}

/** Ha numero, mas nenhum conectado (o chip de alerta na lista). */
export function nenhumNumeroConectado(clinica: ClinicaNoPainel): boolean {
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

// ---------------------------------------------------------------------------
// Busca e filtros (na URL: o link leva o mesmo recorte)
// ---------------------------------------------------------------------------

export type FiltroDaSituacao = "todas" | SituacaoDaConta;
export type FiltroDoAgente = "todos" | EstadoDoAgente;

export type FiltrosDoPainel = {
  busca: string;
  situacao: FiltroDaSituacao;
  agente: FiltroDoAgente;
};

export const FILTROS_PADRAO: FiltrosDoPainel = {
  busca: "",
  situacao: "todas",
  agente: "todos",
};

export const OPCOES_DA_SITUACAO: readonly {
  value: FiltroDaSituacao;
  label: string;
}[] = [
  { value: "todas", label: "Todas as contas" },
  { value: "ativa", label: "Ativas" },
  { value: "suspensa", label: "Suspensas" },
];

export const OPCOES_DO_AGENTE: readonly {
  value: FiltroDoAgente;
  label: string;
}[] = [
  { value: "todos", label: "Todos os agentes" },
  { value: "desligado", label: "Agente desligado" },
  { value: "teste", label: "Agente em teste" },
];

/** Os filtros da URL; valor desconhecido vira o padrao. */
export function lerFiltrosDoPainel(params: {
  get(nome: string): string | null;
}): FiltrosDoPainel {
  const situacao = params.get("situacao");
  const agente = params.get("agente");
  return {
    busca: (params.get("busca") ?? "").slice(0, 80),
    situacao:
      situacao === "ativa" || situacao === "suspensa" ? situacao : "todas",
    agente: agente === "desligado" || agente === "teste" ? agente : "todos",
  };
}

/** Sem acento e em minusculas, para a busca nao depender da grafia. */
export function normalizarBusca(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * O recorte da lista: a busca olha o nome da clinica e o nome e o e-mail dos
 * administradores (dado da equipe); a situacao e o agente, o valor exato.
 * Ordem: pelo nome, como a recepcao procura.
 */
export function filtrarClinicas(
  clinicas: readonly ClinicaNoPainel[],
  filtros: FiltrosDoPainel,
): ClinicaNoPainel[] {
  const termo = normalizarBusca(filtros.busca);
  return clinicas
    .filter((clinica) => {
      if (
        filtros.situacao !== "todas" &&
        situacaoDaConta(clinica) !== filtros.situacao
      ) {
        return false;
      }
      if (
        filtros.agente !== "todos" &&
        clinica.agente.estado !== filtros.agente
      ) {
        return false;
      }
      if (termo === "") {
        return true;
      }
      const onde = [
        clinica.nome,
        ...clinica.administradores.flatMap((admin) => [
          admin.nome ?? "",
          admin.email ?? "",
        ]),
      ];
      return onde.some((campo) => normalizarBusca(campo).includes(termo));
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export function filtrosAtivos(filtros: FiltrosDoPainel): boolean {
  return (
    filtros.busca.trim() !== "" ||
    filtros.situacao !== "todas" ||
    filtros.agente !== "todos"
  );
}

// ---------------------------------------------------------------------------
// Agente: as tres opcoes da tela (producao visivel e travada)
// ---------------------------------------------------------------------------

export type OpcaoDoAgente = EstadoDoAgente | "producao";

export const OPCOES_DO_ESTADO_DO_AGENTE: readonly {
  value: OpcaoDoAgente;
  label: string;
}[] = [
  { value: "desligado", label: "Desligado" },
  { value: "teste", label: "Teste" },
  { value: "producao", label: "Produção" },
];

/**
 * O que o agente da clinica mostra na linha de apoio da lista: com o agente
 * em teste, a escolha da propria clinica na aba de Configuracoes. Nulo:
 * nada a acrescentar.
 */
export function apoioDoAgente(clinica: ClinicaNoPainel): string | null {
  if (clinica.agente.estado !== "teste") {
    return null;
  }
  if (clinica.agente.pausadaPelaClinica) {
    return "Pausado pela clínica";
  }
  if (!clinica.agente.liberada) {
    return "Desligado pela clínica";
  }
  return clinica.agente.modo === "contatos"
    ? "Conversa com a equipe"
    : "Só simulador";
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

/** Motivo opcional do agente: vazio vira o texto padrao do painel. */
export const agenteDaClinicaSchema = z
  .object({
    clinicId: z.uuid(),
    estado: z.enum(["desligado", "teste", "producao"]),
    motivo: z.string().trim().max(MOTIVO_MAXIMO).optional(),
  })
  .strict();

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
