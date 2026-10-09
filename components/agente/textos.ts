import {
  horaNaClinica,
  dataNaClinica,
} from "@/components/atendimento/fuso-da-clinica";

// Textos e regras puras da tela do Agente de IA (Tela 6). Modulo PURO: o
// teste de tela confere a copia daqui (sem travessao, sem jargao) e a
// pagina, o painel e o simulador usam os mesmos textos.
//
// Linguagem de recepcionista (CLAUDE.md secao 5): "assistente", "passar
// para a equipe", "publicar". A unica excecao e a "Prévia do prompt", que
// so o super admin ve (decisao do dono de 06/10/2026).

export const ABAS_DO_AGENTE = [
  { chave: "persona", rotulo: "Persona", soSuperAdmin: false },
  { chave: "habilidades", rotulo: "Habilidades", soSuperAdmin: false },
  { chave: "conhecimento", rotulo: "Conhecimento", soSuperAdmin: false },
  { chave: "regras", rotulo: "Regras e limites", soSuperAdmin: false },
  {
    chave: "instrucoes",
    rotulo: "Instruções do assistente",
    soSuperAdmin: true,
  },
  { chave: "versoes", rotulo: "Versões", soSuperAdmin: false },
] as const;

export type AbaDoAgente = (typeof ABAS_DO_AGENTE)[number]["chave"];

/** As abas que esta pessoa ve, na ordem. */
export function abasVisiveis(
  superAdmin: boolean,
): (typeof ABAS_DO_AGENTE)[number][] {
  return ABAS_DO_AGENTE.filter((aba) => superAdmin || !aba.soSuperAdmin);
}

/**
 * A aba aberta a partir do ?aba= da URL. Aba desconhecida, ou a das
 * instrucoes para quem nao e super admin, cai na Persona.
 */
export function abaDoAgente(
  valor: string | null | undefined,
  superAdmin: boolean,
): AbaDoAgente {
  const achada = abasVisiveis(superAdmin).find((aba) => aba.chave === valor);
  return achada ? achada.chave : "persona";
}

/** O indicador do rodape ("3 alterações não publicadas"). */
export function textoDasAlteracoes(quantas: number): string {
  if (quantas <= 0) {
    return "Nenhuma alteração para publicar";
  }
  return quantas === 1
    ? "1 alteração não publicada"
    : `${quantas} alterações não publicadas`;
}

/** "06/10/2026 às 14:05", no fuso da clinica (CLAUDE.md 3.6). */
export function dataEHoraNaClinica(instante: string, fuso: string): string {
  return `${dataNaClinica(instante, fuso)} às ${horaNaClinica(instante, fuso)}`;
}

/**
 * A ultima versao publicada, para o rodape. "Ultima publicada" e nao "em
 * uso": nesta leva nenhuma conversa de verdade usa a versao publicada (o
 * WhatsApp vem no E3), e o simulador sempre usa o rascunho (achado 30).
 *
 * `ultima` vem do historico das Versões; `versaoPublicada`, da leitura da
 * configuracao (que nao falha sozinha: sem ela a pagina e o erro). Quando o
 * historico nao carregou, o rodape diz o numero sem a data, nunca que o
 * assistente nao foi publicado (achado 29).
 */
export function textoDaUltimaPublicada(
  ultima: { versao: number; publicadaEm: string } | null,
  versaoPublicada: number | null,
  fuso: string,
): string {
  if (ultima) {
    return `Última publicada: versão ${ultima.versao}, em ${dataEHoraNaClinica(ultima.publicadaEm, fuso)}.`;
  }
  if (versaoPublicada !== null) {
    return `Última publicada: versão ${versaoPublicada}.`;
  }
  return "O assistente ainda não foi publicado.";
}

/**
 * Os rotulos das abas numa frase: "Persona", "Persona; Regras e limites". O
 * ponto e virgula separa, e nao o "e", porque o rotulo "Regras e limites" ja
 * tem um "e" ("Persona e Regras e limites" parecia uma aba so).
 */
export function listaEmTexto(itens: readonly string[]): string {
  return itens.join("; ");
}

/**
 * Os cenarios do simulador (brief, Tela 6): escolher um preenche a primeira
 * mensagem, que a pessoa pode mudar antes de enviar. Textos de exemplo, sem
 * nome, telefone ou dado de paciente.
 */
export const CENARIOS_DO_SIMULADOR = [
  {
    chave: "preco",
    rotulo: "Paciente perguntando preço",
    mensagem: "Oi! Quanto custa uma consulta?",
  },
  {
    chave: "agendar",
    rotulo: "Paciente querendo agendar",
    mensagem: "Boa tarde, queria marcar um horário para esta semana.",
  },
  {
    chave: "sintoma",
    rotulo: "Paciente descrevendo sintoma",
    mensagem: "Estou com dor de cabeça forte desde ontem. O que eu faço?",
  },
  {
    chave: "irritado",
    rotulo: "Paciente irritado",
    mensagem:
      "Já é a terceira vez que eu mando mensagem e ninguém responde. Que falta de respeito!",
  },
] as const;

export type CenarioDoSimulador =
  (typeof CENARIOS_DO_SIMULADOR)[number]["chave"];

export function ehCenario(valor: string): valor is CenarioDoSimulador {
  return CENARIOS_DO_SIMULADOR.some((cenario) => cenario.chave === valor);
}

/**
 * Quantas falas o simulador manda por rodada: as mais recentes. O motor le
 * as 20 ultimas (MENSAGENS_NO_HISTORICO, lib/agente/laco.ts) e a acao recusa
 * mais de 40. Nunca abaixo de 20: a assinatura do servidor cobre as 19
 * falas que terminam na resposta (FALAS_ASSINADAS, lib/agente/assinatura),
 * e a janela precisa delas mais a fala nova (motor-assinatura.test.ts).
 */
export const FALAS_ENVIADAS_PELO_SIMULADOR = 20;

/** Teto de caracteres de uma mensagem digitada no simulador. */
export const LIMITE_DA_MENSAGEM_DO_SIMULADOR = 1000;

export const TEXTOS_DO_AGENTE = {
  eyebrow: "Inteligência",
  titulo: "Agente de IA",
  descricao: "Como a recepcionista de IA se comporta.",
  erroAoCarregar: "Não foi possível carregar o assistente de IA",
  erroAoCarregarDescricao:
    "Recarregue a página. Se continuar, fale com o suporte.",
  semResposta: "O servidor não respondeu. Confira a conexão e tente de novo.",
  semPermissao: "Somente administradores e gestores alteram o agente de IA",
  publicar: "Publicar alterações",
  publicando: "Publicando...",
  publicado: "Alterações publicadas.",
  // Sem prometer o que ainda nao existe (achado 30): a versao publicada so
  // vale nas conversas quando o assistente for ligado no WhatsApp, e o
  // simulador nunca usa a publicada (sempre o rascunho).
  publicarDescricao:
    "A nova versão fica guardada em Versões e passa a valer nas conversas quando o assistente for ligado no WhatsApp. O simulador sempre usa o rascunho.",
  publicarSemSalvar: "Salve ou descarte o que não foi salvo antes de publicar",
  naoSalvasTitulo: "Há alterações que não foram salvas",
  naoSalvasTexto: (abas: string) =>
    `Em ${abas}. A publicação leva só o que está salvo: volte à aba e salve, ou descarte o que foi digitado.`,
  descartarNaoSalvas: "Descartar o que não foi salvo",
  nadaParaPublicar: "Não há alteração para publicar.",
  semRascunho:
    "Salve a persona, as habilidades, o horário ou uma pergunta. Depois, publique.",
  baseSemLeitura:
    "As perguntas do Conhecimento não carregaram. Recarregue a página antes de publicar.",
  conferirAntes: "Corrija antes de publicar",
  // Persona
  personaTitulo: "Persona",
  personaDescricao: "Como o assistente se apresenta e fala com o paciente.",
  nome: "Nome do assistente",
  nomeDica: "O paciente vê este nome quando o assistente se apresenta.",
  tom: "Tom de voz",
  emoji: "Usar emoji",
  emojiDescricao:
    "No máximo um emoji discreto por mensagem. Emoji de remédio, injeção ou bebida nunca sai.",
  saudacao: "Saudação",
  saudacaoDica: "Entra no começo da primeira resposta de cada conversa.",
  encerramento: "Encerramento",
  encerramentoDica: "Entra no fim da resposta que fecha a conversa.",
  comoOPacienteVe: "Como o paciente vê",
  previaExplicacao:
    "A frase do meio é o exemplo do tom: a resposta de verdade depende da pergunta do paciente.",
  personaSalva: "Persona salva no rascunho.",
  // Habilidades
  habilidadesTitulo: "Habilidades",
  habilidadesDescricao:
    "O que o assistente pode fazer na conversa. Por enquanto, quem agenda, remarca e cancela é a equipe.",
  habilidadeLigada: (titulo: string) => `${titulo}: ligada no rascunho.`,
  habilidadeDesligada: (titulo: string) => `${titulo}: desligada no rascunho.`,
  // Conhecimento
  conhecimentoTitulo: "Perguntas e respostas",
  conhecimentoAviso:
    "Preços, profissionais, procedimentos e convênios vêm automaticamente do Cadastro. Não repita aqui.",
  conhecimentoVazio: "Nenhuma pergunta ainda",
  conhecimentoVazioDescricao:
    "Escreva as dúvidas que a recepção mais responde, como endereço, estacionamento, formas de pagamento e política de cancelamento.",
  novaPergunta: "Nova pergunta",
  pergunta: "Pergunta",
  resposta: "Resposta",
  perguntaPlaceholder: "Ex.: Tem estacionamento?",
  respostaPlaceholder:
    "Ex.: Sim, temos estacionamento gratuito para pacientes na entrada da clínica.",
  ativa: "Ativa: o assistente usa esta resposta",
  ativaDescricao:
    "Desmarcada, fica guardada aqui e o assistente deixa de usar.",
  perguntaCriada: "Pergunta incluída no rascunho.",
  perguntaSalva: "Pergunta salva no rascunho.",
  perguntaAtivada: "Pergunta ativada no rascunho.",
  perguntaDesativada: "Pergunta desativada no rascunho.",
  perguntaExcluida: "Pergunta excluída.",
  trocarPerguntaTitulo: "Descartar o que foi digitado?",
  trocarPerguntaTexto:
    "A pergunta aberta tem alterações que não foram salvas. Se você abrir outra, elas se perdem.",
  continuarEditando: "Continuar editando",
  descartarEAbrir: "Descartar e abrir",
  // Regras e limites
  horarioTitulo: "Horário de operação",
  horarioDescricao:
    "Quando o assistente responde. A grade vale no fuso da clínica.",
  minutos: "Minutos sem resposta da equipe",
  expediente: "Expediente da clínica",
  expedienteDescricao:
    "Vale no modo Só fora do expediente: dentro destes horários, quem responde é a equipe.",
  aberto: "Aberto",
  fechado: "Fechado",
  inicio: "Início",
  fim: "Fim",
  horarioSalvo: "Horário salvo no rascunho.",
  horarioComErro: "Corrija antes de salvar",
  gatilhosTitulo: "Quando o assistente passa para a equipe",
  gatilhosDescricao:
    "Nestes casos a conversa sempre vai para a equipe, e o paciente recebe uma frase fixa, nunca escrita pelo assistente. Não podem ser desligados.",
  // Instrucoes (so super admin)
  instrucoesTitulo: "Instruções do assistente",
  instrucoesDescricao:
    "Texto livre da equipe Conduzza para esta clínica. Só o super admin vê e edita.",
  instrucoesAviso:
    "As travas do CFM valem sempre, conferidas em cada resposta antes do envio: não precisa escrevê-las aqui. O texto passa pela mesma conferência ao salvar e ao publicar.",
  instrucoesSalvas: "Instruções salvas no rascunho.",
  previaTitulo: "Prévia do prompt",
  previaDescricao:
    "O texto que o assistente recebe com a configuração do rascunho, sem a conversa. Somente leitura.",
  previaIndisponivel: "A prévia não carregou. Recarregue a página.",
  // Versoes
  versoesTitulo: "Versões publicadas",
  versoesDescricao:
    "Cada publicação vira uma versão. Restaurar traz a configuração e as perguntas daquela versão para o rascunho; nada muda para o paciente até publicar.",
  versoesVazio: "Nenhuma versão publicada ainda",
  versoesVazioDescricao:
    "Quando você publicar, cada versão aparece aqui com a data, quem publicou e o que mudou.",
  versoesErro: "Não foi possível carregar as versões",
  restaurar: "Restaurar",
  // O restaurar desativa (nao apaga) as perguntas fora da versao e traz
  // tambem as instrucoes da equipe Conduzza daquela versao (achados 3, 16,
  // 25 e 28): o dialogo diz as duas coisas, sem mostrar o texto.
  restaurarDescricao:
    "O rascunho passa a ter a persona, as habilidades, o horário, as instruções da equipe Conduzza e as perguntas desta versão. As perguntas que não estão nesta versão ficam desativadas, não são apagadas: dá para reativar no Conhecimento. As outras alterações que ainda não foram publicadas se perdem. Para o paciente, nada muda até você publicar.",
  restaurada: (versao: number) =>
    `Versão ${versao} restaurada no rascunho. Confira e publique.`,
  autorDesconhecido: "Pessoa fora da equipe",
  // Simulador
  simuladorTitulo: "Simulador",
  simuladorDescricao:
    "Converse como se fosse o paciente. Usa o rascunho e nada vai para o WhatsApp.",
  simuladorAviso: "Use dados de teste. Não escreva dados de pacientes reais.",
  cenario: "Cenário",
  cenarioPlaceholder: "Escolha um cenário",
  mensagemDoPaciente: "Mensagem do paciente",
  mensagemPlaceholder: "Escreva como se fosse o paciente.",
  enviar: "Enviar",
  reiniciar: "Reiniciar",
  conversaVazia:
    "Escolha um cenário ou escreva uma mensagem para ver como o assistente responde.",
  escrevendo: "O assistente está escrevendo...",
  porQue: "Por que a IA respondeu isso",
  // Reserva: o servidor ja manda este passo quando nada foi consultado.
  porQueVazio: "Respondeu só com a configuração, sem consultar nada.",
  // A frase fixa em dois desenhos (achado 31): o bloqueio da conformidade
  // como no Atendimento (ShieldBan, alert) e o passar para a equipe sem
  // bloqueio (UsersRound, neutro).
  bloqueioTitulo: "Resposta da IA bloqueada pela conformidade",
  escalonamentoTitulo: "A conversa passou para a equipe",
  fraseFixaTexto:
    "Na conversa de verdade, o paciente recebe esta frase fixa e a conversa passa para a equipe.",
  verRascunhoBloqueado: "Ver o que o assistente ia responder",
  rascunhoBloqueadoExplicacao:
    "A conformidade barrou este texto antes do envio: ele nunca chegaria ao paciente.",
  conversaEncerrada:
    "A conversa passou para a equipe. Reinicie para testar de novo.",
  paciente: "Paciente",
} as const;
