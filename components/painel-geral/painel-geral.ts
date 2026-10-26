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
  OctagonPause,
  RadioTower,
  Watch,
} from "lucide-react";
import { z } from "zod";

import type { StatusDefinition } from "@/lib/design/status";
import {
  publicoDoBanco,
  ROTULO_DO_MODO,
  ROTULO_DO_PUBLICO,
  type ModoDeOperacao,
} from "@/lib/domain/agente/config";
import { diaCivil, diasEntre, somarDias } from "@/lib/domain/horarios";
import { ROTULO_DO_PAPEL } from "@/lib/domain/permissions";
import type {
  ClinicaNoPainel,
  EstadoDoAgente,
  PessoaDaEquipe,
  RegistroDoRequisito,
  RequisitoConferido,
  RequisitosDaProducao,
  SituacaoDaConta,
  SituacaoDoMembro,
  UltimoAcessoNoPainel,
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
//   la; na lista, so o total do mes no cartao do topo.
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

export function situacaoDaConta(clinica: ClinicaNoPainel): SituacaoDaConta {
  return clinica.suspensao ? "suspensa" : "ativa";
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
} as const;

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

export type FiltrosDoPainel = {
  busca: string;
  uso: FiltroDoUso;
  conta: FiltroDaConta;
  agente: FiltroDoAgente;
};

export const FILTROS_PADRAO: FiltrosDoPainel = {
  busca: "",
  uso: "todas",
  conta: "todas",
  agente: "todos",
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
    busca: (params.get("busca") ?? "").slice(0, 80),
    uso: uso === "em_uso" || uso === "sem_uso" ? uso : "todas",
    conta: conta === "ativa" || conta === "suspensa" ? conta : "todas",
    agente:
      agente === "liberado" || agente === "nao_liberado" ? agente : "todos",
  };
}

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
 * qualquer pessoa da equipe dela (dado da equipe); o uso, a conta e o agente
 * pelo valor exato. Ordem: ordemDoPainel.
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
    filtros.agente !== "todos"
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
