// A urgencia (AG6a; decisoes D-51 e D-52, PENDENTES, construidas com a
// recomendacao): uma lista CURTA e DETERMINISTICA de sinais de emergencia na
// mensagem do paciente. PURO, zero I/O (roda tambem no navegador, pelo
// portao de entrada).
//
// Para que serve, e so isso: PASSAR a conversa para a equipe marcada como
// "Urgente" (no topo do Atendimento), com a frase de SEMPRE. A IA nunca faz
// triagem nem orienta (CLAUDE.md 3.2; CFM 2.314/2022): detectar o sinal nao
// e avaliar o sintoma, e nada daqui vira texto ao paciente. O aviso do SAMU
// (192) e do CVV (188) e da AG6c, com o responsavel tecnico; nesta rodada o
// contato recebe a frase de sempre.
//
// Quem chama:
//  - o executor do WhatsApp (lib/jobs/responder-com-ia.ts, passo 7c), nos
//    textos ORIGINAIS das mensagens pendentes (e na legenda da midia), ANTES
//    do teto de respostas, da reserva do gasto e de qualquer modelo (o teto
//    do dia acabado nao segura a passagem da urgencia);
//  - o portao de entrada (gatilhos-de-entrada.ts), como o gatilho "urgencia",
//    o primeiro na ordem (categorias.ts): a segunda trava no laco e o
//    simulador;
//  - o interceptador da resposta (lib/integrations/whatsapp), num texto so.
// O classificador por modelo NAO decide urgencia (D-52): ele continua so com
// "sintoma", que passa com a frase de sempre e sem a marca.
//
// Regras que so BLOQUEIAM o caminho da IA: o que casar aqui passa a conversa;
// o que nao casar segue para o portao de sempre (o "sintoma" continua
// escalando com a frase de sempre). Falso positivo: a conversa vai para a
// equipe como Urgente (o que ja ia para a equipe pelo "sintoma" na maioria
// dos sinais). Falso negativo: cai no "sintoma", sem a marca (o de hoje). Na
// duvida, fica urgencia: o falso positivo custa atencao, o falso negativo
// custa seguranca (revisao de 30/10/2026: nenhuma emergencia que a versao
// conferida edd123c pegava pode ficar de fora; a bateria de nao regressao
// lista cada frase que deixou de ser urgencia, com o motivo).
//
// Como le o texto: as mesmas visoes do portao (base, despacado, leet,
// emendado e preservado, com as trocas de expressao permitida do portao:
// "Maria do Socorro", "sou a Dores") e, em cada uma, a letra repetida vira
// uma so ("faltaaa de arrr" vira "falta de ar"). Por isso as fontes abaixo
// sao escritas SEM letra dobrada ("morer", "derame", "prenchimento",
// "socoro"): um teste confere. Caixa alta nao importa (a base e minuscula,
// sem acento). Varios textos (as pendentes de uma rajada, na ordem, e a
// legenda da midia): cada um sozinho e tambem a JUNCAO deles, na ordem,
// separados por espaco ("to com dor" e depois "no peito"; revisao de
// 28/10/2026). A juncao so acrescenta: o que um texto sozinho ja casou
// continua valendo. Na juncao, cada mensagem guarda onde comeca, para a
// excecao "da mensagem" ler so a mensagem do sinal (revisao de 30/10/2026).
//
// A ORACAO acaba na pontuacao e em "mas", "porem", "so que", "entao",
// "contudo" e "todavia". Em cada sinal que casou:
//  - a NEGACAO: "nao", "nunca", "nem", "jamais", "sem", "nenhum" ou
//    "nenhuma" logo antes, na mesma oracao, com no maximo quatro palavras
//    curtas no meio ("nao estou com falta de ar", "nunca tive convulsao",
//    "nao e emergencia", "sem dor no peito") nao conta. Palavra de outro
//    tipo no meio desfaz a negacao ("nao aguento mais quero morrer" continua
//    urgente). O "nunca" (ou "jamais") com a INTENSIDADE e enfase, nao
//    negacao ("nunca senti uma dor tao forte no peito", "nunca tive tanta
//    falta de ar", "nunca tive falta de ar assim": revisao de 28/10/2026).
//    A negacao DENTRO do sinal tambem nao casa: a palavra do meio nunca e
//    a negacao ("minha lingua nao esta inchada", "a boca nao ficou torta");
//    e a pergunta retorica com o "nao" e o sinal ("nao seria melhor eu
//    morrer?");
//  - as EXCECOES do sinal: antes dele na oracao, depois dele na oracao, na
//    oracao anterior ou na MESMA MENSAGEM do sinal (revisao de 30/10/2026:
//    nunca na rajada inteira). Cada sinal diz quais, e o que as desfaz
//    ("de repente", "acordei", a pessoa nomeada no telefone, o pedido de
//    ajuda), lido em qualquer mensagem da rajada: a excecao tira a
//    urgencia e le estreito; o que a desfaz devolve a urgencia e le largo;
//  - o ANTECEDENTE (so nos sinais fisicos; revisao de 28/10/2026, refeito
//    em 30/10/2026): a historia contada ("ja desmaiei tirando sangue", "ja
//    tive choque anafilatico", "as vezes falta de ar", "quando eu era
//    crianca tive convulsao") nao e emergencia AGORA. So vale quando GOVERNA
//    o sinal: na mesma parte da oracao (a oracao tambem quebra no " e ":
//    "ja tive infarto e to com dor no peito" e urgencia), antes dele ou, se
//    e uma marca de tempo ("ano passado", "quando era crianca"), logo
//    depois ("uma vez" so antes: "desmaiou uma vez" e a contagem). O agora
//    na oracao ("ja desmaiei duas vezes hoje"), o presente na parte do
//    sinal ("to com", "esta com", "continua", "ainda", o gerundio com o
//    verbo de agora: "ta convulsionando"), a retomada depois ("e continua",
//    "e voltou") e o agora na oracao seguinte, depois do "mas" ("ja tive
//    dor no peito, mas agora ta muito forte") ou com o estado de agora ("ja
//    tive dor no peito, agora ta muito forte"; o estado bom, "hoje estou
//    bem", nao) desfazem a historia. Nunca vale para chamar o socorro nem
//    para o sangramento ("ja perdi muito sangue", "ja tive que chamar o
//    SAMU"). O risco de vida nunca tem antecedente: "ja pensei em suicidio"
//    passa como urgencia (o lado conservador; o falso negativo ali nao
//    escala por nenhum outro gatilho).
//
// O EVENTO GRAVE (o infarto, o AVC ou derrame, a hemorragia e a parada
// cardiaca; revisao de 28/10/2026) so conta AGORA: com a suspeita antes
// ("acho que", "to tendo", "pode ser", "acabou de ter"), com o agora junto
// ("teve um AVC agora", "hoje ela teve um derrame") ou com o socorro antes
// na mesma frase ("socorro, minha mae teve um AVC"). O nome sozinho, a
// historia ("minha mae teve um AVC", "meu pai infartou") e a pergunta
// ("botox causa AVC?") seguem pelo portao de sempre (assunto clinico ou
// sintoma), que tambem passa a conversa e, pela Revisao R2 do contrato do
// banco, nunca a leva ao responsavel do lead.
//
// LISTA PROPOSTA AO RT (D-51), nao aprovada: cada sinal tem nome, tipo e a
// fonte. Mudar um sinal muda a versao do portao (FONTES_DA_URGENCIA entra
// em fontesDoPortao, filtro.ts).
//
// Nada daqui vai para log (nem o nome do sinal: e dado de saude derivado do
// texto do paciente).

import {
  frasesDasVisoes,
  neutralizador,
  visoesDoTexto,
} from "@/lib/domain/conformidade/normalizar";
import { NEUTRALIZACOES_DE_ENTRADA } from "@/lib/domain/conformidade/padroes";

/**
 * Os dois tipos (desenho 1.1 e 5.2): o fisico e o risco de vida por
 * sofrimento. Na AG6a os dois passam do mesmo jeito (a frase de sempre e a
 * marca); a AG6c escolhe o aviso pelo tipo.
 */
export const TIPOS_DE_URGENCIA = ["fisica", "risco_de_vida"] as const;
export type TipoDeUrgencia = (typeof TIPOS_DE_URGENCIA)[number];

export type SinalDeEmergencia = {
  /** Nome estavel do sinal (teste e versao; nunca vai para log). */
  nome: string;
  tipo: TipoDeUrgencia;
  /** A fonte da regex, para o texto normalizado e sem letra repetida. */
  fonte: string;
  /**
   * A excecao lida no trecho ANTES do sinal, na mesma oracao: casou, o sinal
   * nao conta ("contato de emergencia", "historico de convulsao").
   */
  excecaoAntes?: string;
  /**
   * A excecao lida no trecho DEPOIS do sinal, na mesma oracao ("emergencia
   * familiar", "e emergencia nao", "boca torta de nascenca").
   */
  excecaoDepois?: string;
  /**
   * A excecao lida na ORACAO ANTERIOR, a que acaba logo antes da do sinal
   * ("tentei ligar varias vezes, nao consigo falar").
   */
  excecaoNaOracaoAnterior?: string;
  /**
   * A excecao lida na MESMA MENSAGEM do sinal (revisao de 30/10/2026: nunca
   * a rajada inteira; na juncao, so a mensagem, ou as mensagens, em que o
   * sinal casou): casou, o sinal nao conta ("fiz botox e minha boca ficou
   * torta", "tenho uma emergencia, preciso remarcar").
   */
  excecaoNaMensagem?: string;
  /**
   * O que DESFAZ as excecoes acima: com ele, o sinal conta mesmo que uma
   * excecao case ("de repente", "acordei", a pessoa nomeada no telefone, o
   * pedido de ajuda). Lido na leitura INTEIRA (na juncao, a rajada toda: so
   * acrescenta urgencia, entao le largo; a excecao, que tira, le estreito).
   * A negacao e o antecedente continuam valendo.
   */
  semExcecaoCom?: string;
  /**
   * O antecedente (a historia) nunca apaga este sinal fisico (revisao de
   * 30/10/2026: chamar o socorro e o sangramento).
   */
  semAntecedente?: true;
};

export type Urgencia = {
  tipo: TipoDeUrgencia;
  /** O primeiro sinal do tipo que venceu (so para teste; nunca para log). */
  sinal: string;
};

/** "ar condicionado", "ar livre": nao e o ar de respirar. */
const NAO_E_O_AR_DE_RESPIRAR =
  "(?!\\s?-?condicionad|\\s?cond\\b|\\s(?:livre|puro|fresco|quente|frio|seco|umido)\\b)";

/**
 * Quem esta "sem ar" e o lugar (a sala sem ar condicionado). Sem o "ai":
 * "ai, to sem ar" e de dor.
 */
const LUGAR_SEM_AR =
  "\\b(?:sala|salas|clinica|consultorio|recepcao|predio|espera|voces|vcs|vc|lugar|local|loja)\\b(?:\\s+\\S+){0,3}\\s*$";

/** A pergunta sobre o lugar: "ta sem ar ai?", "sem ar hoje?". */
const PERGUNTA_DO_LUGAR =
  "(?!\\s*(?:(?:ai|la|aqui|hoje|agora|de novo)\\s*)?\\?)";

/**
 * Revisao de 30/10/2026: o nariz com a cirurgia do nariz na mesma mensagem
 * ("tenho dificuldade para respirar pelo nariz, quero fazer rinoplastia") e
 * a estetica, nao a falta de ar. O nariz sozinho continua urgencia (o lado
 * conservador).
 */
const NARIZ_COM_PROCEDIMENTO =
  "^(?!.*\\b(?:pela boca|sufoc\\w*|falta d[ei] ar|sem ar)\\b)(?=.*\\brespirar (?:direito |bem )?(?:pelo|pela|com o) (?:nariz|narina|narinas)\\b)(?=.*\\b(?:rinoplastia|rinomodelacao|septoplastia|septo|cirurgia|operar|operacao|plastica|corigir|corecao|procedimento)\\b)";

/** O verbo de quem chama ou espera o socorro ("chama o SAMU"). */
const CHAMAR_O_SOCORRO =
  "(?:chamar|chama|chame|chamem|chamei|chamou|chamaram|chamamos|chamando|ligar|liga|ligue|liguem|liguei|ligou|ligaram|ligamos|ligando|acionar|aciona|acione|acionei|acionou|acionaram|esperando|aguardando|preciso d[ae]|precisa d[ae]|precisando d[ae])";

/**
 * As palavras que reforcam a dor ("uma dor muito forte no peito", "uma dor
 * assim no peito").
 */
const REFORCO_DA_DOR =
  "(?:muito|mto|mt|bem|super|tao|forte|fortes|intensa|intenso|aguda|horivel|terivel|insuportavel|esquisita|estranha|enorme|grande|grave|fortisima|absurda|danada|aqui|ai|la|asim)";

/**
 * Expressoes de exagero que nao sao risco de vida ("morrer de rir", "morrendo
 * de vontade").
 */
const EXAGERO_DE_MORRER =
  "(?! de (?:tanto|rir|vergonha|fome|sede|calor|frio|saudade|saudades|medo|tedio|sono|inveja|preguica|cansaco|curiosidade|amor|amores|ciume|raiva|susto|felicidade|alegria|emocao|orgulho|chorar|vontade|ansiedade|nervoso|dor de cabeca)\\b)";

/**
 * "me matar de rir", "se matando de trabalhar" e, na revisao de 28/10/2026,
 * "vou me matar na academia", "me matando no trabalho".
 */
const EXAGERO_DE_MATAR =
  "(?! de (?:tanto|rir|trabalhar|estudar|fome|vergonha|cansaco|treinar|malhar|corer|comer)\\b)(?! (?:na|no) (?:academia|treino|trabalho|servico|dieta|esteira|corida|estudo|estudos)\\b)";

/**
 * Revisao de 30/10/2026: os sujeitos de exagero CONCRETOS de "vai me matar"
 * ("esse preco vai me matar", "essa dieta ta me matando", "meu marido vai me
 * matar"). O sofrimento nunca e exagero ("essa tristeza ta me matando", "essa
 * depressao vai me matar", "a vida ta me matando"), nem o pronome ("isso vai
 * me matar", "ela vai me matar").
 */
const SUJEITO_DE_EXAGERO =
  "(?:preco|precos|valor|valores|conta|contas|boleto|boletos|fatura|faturas|parcela|parcelas|juros|divida|dividas|aluguel|orcamento|gasto|gastos|dieta|dietas|regime|academia|treino|treinos|malhacao|corida|trabalho|trabalhos|servico|emprego|chefe|patrao|patroa|faculdade|escola|prova|provas|estudo|estudos|marido|esposo|esposa|namorado|namorada|noivo|noiva|calor|frio|transito|fila|filas|espera|demora|engarafamento)";

/**
 * As palavras do telefone e do atendimento: "nao consigo falar" com elas e
 * nao conseguir falar COM a clinica, nao a fala.
 */
const TELEFONE_OU_ATENDIMENTO =
  "\\b(?:lig\\w*|telefon\\w*|chamada|chamadas|audio|audios|whats\\w*|zap\\w*|atend\\w*|recepc\\w*|secretaria|ocupad\\w*|caixa postal|respond\\w*|retorn\\w*)\\b";

/**
 * Revisao de 30/10/2026: o telefone so desfaz quando o alvo e a clinica.
 * Com a PESSOA como alvo ("liguei pro meu marido", "tentei ligar pra minha
 * filha", "liguei pra ela") e o pedido de ajuda de quem nao fala, nunca a
 * clinica.
 */
const PESSOA_NO_TELEFONE =
  "\\b(?:pra|pro|para|pras|pros|com)(?: (?:a|o|as|os))?(?: (?:minha|meu|minhas|meus|sua|seu|nosa|noso))? (?:mae|mamae|pai|papai|filha|filho|filhas|filhos|marido|esposa|esposo|mulher|irma|irmao|avo|vo|vovo|tia|tio|amiga|amigo|vizinha|vizinho|namorada|namorado|noiva|noivo|sogra|sogro|neta|neto|prima|primo|cunhada|cunhado|familia|parente|parentes|alguem|ela|ele|elas|eles|samu|192|ambulancia|bombeiro|bombeiros)\\b";

/**
 * O comeco de repente ("acordei assim", "do nada", "de repente"): o sinal e
 * o do corpo, nunca o telefone, a estetica ou o procedimento.
 */
const INICIO_SUBITO =
  "\\b(?:acordei|acordou|acordamos|de repente|derepente|do nada|subitamente)\\b";

/**
 * A queixa do corpo na mesma mensagem ("nao consigo mexer o braco", "a boca
 * ta dormente"): o "nao consigo falar" e a fala, nunca o telefone ou a
 * reuniao.
 */
const QUEIXA_DO_CORPO =
  "\\b(?:boca|lingua|rosto|face|braco|bracos|perna|pernas|lado do corpo|dormente|dormentes|dormencia|formig\\w*|enrolad\\w*|tort[oa]s?|fraquez\\w*|sem forca|paralis\\w*|tontura|tont[oa]|desmai\\w*|mexer)\\b";

/**
 * Revisao de 30/10/2026: quem esta ocupado ou prefere mensagem ("agora nao
 * consigo falar, me manda mensagem", "nao consigo falar, estou numa
 * reuniao"): e a ligacao, nao a fala.
 */
const OCUPADO =
  "\\b(?:(?:me |pode |por favor )?(?:manda|mande|mandem|envia|envie|escreve|escreva|escrevam)(?: (?:aqui|por aqui))?(?: (?:uma|um|por|em))? (?:mensagem|mensagens|msg|texto|escrito)|(?:so |somente |apenas )?por (?:mensagem|escrito|texto|aqui|whats\\w*|zap\\w*)|(?:to|tou|estou|ta|esta|estamos) (?:numa|em uma|em|no|na|num|dentro d[oa]) (?:reuniao|aula|trabalho|servico|onibus|metro|transito|culto|igreja|misa|velorio|evento|curso|prova|faculdade|escola|plantao|expediente|cinema|teatro|biblioteca|palestra|treinamento|ligacao|chamada)|(?:to|tou|estou|ta|esta) (?:dirigindo|trabalhando|ocupad[oa])|(?:te |lhe )?(?:ligo|retorno|chamo|respondo|falo|mando) (?:depois|mais tarde|em seguida|daqui a pouco|amanha|asim que)|(?:depois|mais tarde|daqui a pouco) (?:eu )?(?:te |lhe )?(?:ligo|retorno|chamo|respondo|falo)|no momento)\\b";

/**
 * Revisao de 30/10/2026: a emergencia da AGENDA do paciente ("tenho uma
 * emergencia, preciso remarcar", "estou com uma emergencia, nao vou poder
 * ir", "por motivo de emergencia preciso cancelar"). O pedido de ajuda, em
 * qualquer mensagem da rajada, desfaz ("e uma emergencia, cancela tudo e me
 * ajuda").
 */
const AGENDA_DO_PACIENTE =
  "\\b(?:remarcar|remarca|remarque|remarcacao|desmarcar|desmarca|desmarque|cancelar|cancela|cancele|cancelamento|reagendar|reagenda|reagende|reagendamento|adiar|adia|adie|(?:mudar|trocar|transferir) (?:a|o|minha|meu) (?:consulta|horario|data|dia|agendamento)|(?:nao|nem) (?:vou|vai|irei|poso|poderei|consigo|vou conseguir|vou poder|vamos poder|vamos conseguir|da pra|deu pra|dara pra|pude|consegui) (?:mais )?(?:ir|comparecer|chegar|vir|estar ai|estar la|estar presente)|(?:vou|vou ter que|vou precisar|preciso|tenho que) faltar|faltar (?:a|na) consulta)\\b";
const PEDIDO_DE_AJUDA =
  "\\b(?:socoro|me ajud\\w*|preciso de ajuda|samu|ambulancia|192|morendo)\\b";

/**
 * O procedimento ja feito pela PROPRIA pessoa (revisao de 30/10/2026): o
 * verbo na primeira pessoa ("fiz botox", "apliquei", "depois que fiz"), o
 * possessivo ("meu botox") ou sem pessoa ("depois do botox", "o botox
 * deixou"). Sem "com o botox" ("quanto fica com o botox?" e pergunta) e sem
 * a terceira pessoa ("minha mae fez botox").
 */
const PROCEDIMENTO =
  "(?:botox|toxina|botulinica|aplicacao|aplicacoes|prenchimento|prenchimentos|harmonizacao|bichectomia|procedimento|fios|lifting|bioestimulador)";
const PROCEDIMENTO_FEITO = `\\b(?:fiz|apliquei|coloquei|tomei|fizemos|fui fazer|acabei de fazer|(?:depois|desde|apos) que (?:eu )?(?:fiz|apliquei|coloquei|tomei))(?: \\S+){0,2}? ${PROCEDIMENTO}\\b|\\b(?:meu|minha|meus|minhas) ${PROCEDIMENTO}\\b|\\b(?:depois d[oa]s?|apos (?:o|a|os|as)|desde (?:o|a|os|as)|por causa d[oa]s?) (?:\\S+ )?${PROCEDIMENTO}\\b|\\b${PROCEDIMENTO}\\b(?: \\S+){0,2}? (?:deixou|entortou|causou|pegou)\\b`;

/** A terceira pessoa na mensagem: o procedimento nao e o da propria pessoa. */
const TERCEIRA_PESSOA =
  "\\b(?:ela|ele|elas|eles|dela|dele|delas|deles|(?:minha|meu|sua|seu) (?:mae|pai|avo|vo|filha|filho|irma|irmao|tia|tio|esposa|marido|mulher|namorada|namorado|amiga|amigo|vizinha|vizinho|sogra|sogro|prima|primo|bebe|neta|neto|companheira|companheiro|paciente)|a paciente|o paciente|a crianca)\\b";

/** O procedimento antigo (nao recente): anos ou meses atras. */
const TEMPO_ANTIGO =
  "\\b(?:(?:ha|faz|tem) (?:\\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|alguns|algumas|uns|umas|muitos|muitas|varios|varias|mais de \\S+) (?:anos?|meses|mes)|(?:ano|mes) pasado|(?:anos|meses) atras|em (?:19|20)\\d\\d)\\b";

/**
 * A excecao do procedimento (D-51: o efeito do procedimento continua
 * "sintoma", sem a marca): na MESMA mensagem do sinal, na primeira pessoa e
 * recente. O que nunca se apaga ("de repente", "acordei" e, no rosto, "de um
 * lado" e "metade") fica em semExcecaoCom, lido na rajada inteira.
 */
const PROCEDIMENTO_NA_MESMA_MENSAGEM = `^(?!.*${TERCEIRA_PESSOA})(?!.*${TEMPO_ANTIGO})(?=.*(?:${PROCEDIMENTO_FEITO}))`;

/**
 * O que nenhuma excecao apaga no rosto torto: "de um lado", pela "metade"
 * (revisao de 30/10/2026), alem do comeco de repente.
 */
const UM_LADO_DO_ROSTO =
  "\\b(?:de um lado|so de um lado|do lado (?:esquerdo|direito)|metade|pela metade)\\b";

/**
 * Revisao de 30/10/2026: o ESTADO PERMANENTE da boca e do rosto e estetica
 * ("tenho a boca torta de nascenca", "sempre tive o rosto torto"). O "e",
 * "era" e "sempre" no meio do sinal ja nao casam ("meu rosto e torto", "o
 * lado direito do meu rosto e mais caido": PALAVRA_DO_MEIO_ATUAL).
 */
const PERMANENTE_DEPOIS =
  "^\\s*(?:\\S+ ){0,2}?(?:de nascenca|de nascimento|desde (?:sempre|crianca|pequen[oa]|nov[oa]|que nasci|o nascimento|bebe|a infancia)|congenit\\w*|naturalmente|por natureza|de familia|genetic\\w*)\\b";
const PERMANENTE_ANTES =
  "\\b(?:sempre (?:tive|teve|tivemos|fui|foi)|desde (?:sempre|crianca|pequen[oa]|que nasci|bebe|a infancia) (?:tenho|tive|tem|teve))\\b(?: \\S+){0,3}?\\s*$";

/**
 * O evento grave AGORA, ou a suspeita dele, antes do nome do evento ("to
 * tendo um infarto", "acho que e um AVC", "pode ser derrame?", "acabou de
 * ter um AVC"). O nome sozinho e historia ou pergunta ("tive infarto ano
 * passado", "meu pai morreu de AVC", "botox causa AVC?") e nao conta.
 */
const EVENTO_AGORA =
  "(?:tendo|acho que|achamos que|acha que|parece|pode ser|sera que|deve ser|nao sei se|suspeita de|suspeito de|com cara de|sintomas de|sinais de|acabou de ter|acabei de ter|acabaram de ter|acabou de sofrer|acabei de sofrer)";
const ANTES_DO_EVENTO = `(?<=\\b${EVENTO_AGORA}(?: \\S+){0,3}? )(?:um |uma |o |a )?`;

/**
 * O agora junto do evento grave (revisao de 28/10/2026: "minha mae teve um
 * AVC agora", "teve um derrame hoje", "hoje ela teve um AVC"). "Hoje em
 * dia", "hoje faz um ano", "agora em setembro" e "ha pouco tempo" (o
 * recente, que pode ser de semanas) nao sao o agora.
 */
const AGORA_DO_EVENTO =
  "(?:agora(?! (?:em|no|na|nese|neste|nesta) (?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|comeco|inicio|final|fim|mes|ano|semestre)\\b)|agorinha|hoje(?! (?:em dia|faz|fazem|completa|completam)\\b)|neste momento|nese momento|de novo|outra vez|novamente|(?:ha|faz) pouco(?! tempo\\b))";

/**
 * O agora logo DEPOIS do evento: ate duas palavras no meio, sem passar da
 * pontuacao nem do "e" ("teve um AVC agora", "teve um derrame aqui hoje";
 * "teve um AVC e agora esta bem" e "teve um AVC ano passado e hoje quer
 * fazer botox" nao).
 */
const AGORA_LOGO_DEPOIS = `(?=(?: (?!(?:e|mas|so|que|porque|pq|ou|nem)\\b)[^\\s.!?;,:]+){0,2} ${AGORA_DO_EVENTO}\\b)`;

/** O agora no comeco da oracao, ate tres palavras antes (sem pontuacao). */
const AGORA_LOGO_ANTES = `(?<=\\b${AGORA_DO_EVENTO}(?: [^\\s.!?;,:]+){0,3} )`;

/**
 * O pedido de socorro antes do evento, na mesma frase ("socorro, minha mae
 * teve um AVC", "socorro meu pai infartou"). Sem letra dobrada ("socoro").
 */
const SOCORRO_ANTES = "(?<=\\bsocoro\\b[^.!?;\\n]{0,40})";

/** O verbo de quem teve o evento ("hoje ela TEVE um AVC"). */
const VERBO_DO_EVENTO =
  "(?:teve|tive|tivemos|tiveram|sofreu|sofri|sofreram|deu|deram|ta com|esta com|to com|tou com|estou com|ficou com|entrou em)";

/**
 * Os caminhos do agora para o evento grave (o infarto, o AVC, a hemorragia,
 * a parada): o nome com o agora logo depois; o agora no comeco da oracao
 * com o verbo do evento; ou o socorro antes, na mesma frase. O nome sozinho
 * e historia ou pergunta ("minha mae teve um AVC", "botox causa AVC?") e
 * nao conta.
 */
function eventoComOAgora(nomes: string): string {
  const nome = `(?:${nomes})\\b`;
  return [
    `\\b${nome}${AGORA_LOGO_DEPOIS}`,
    `(?<=\\b${AGORA_DO_EVENTO}(?: [^\\s.!?;,:]+){0,3} ${VERBO_DO_EVENTO} (?:um |uma |o |a )?)${nome}`,
    `${SOCORRO_ANTES}\\b${nome}`,
  ].join("|");
}

/**
 * O verbo no passado do evento ("infartou"), so com o agora ou o socorro
 * junto.
 */
function passadoComOAgora(verbos: string): string {
  const verbo = `(?:${verbos})\\b`;
  return `\\b${verbo}${AGORA_LOGO_DEPOIS}|${AGORA_LOGO_ANTES}${verbo}|${SOCORRO_ANTES}\\b${verbo}`;
}

/** Os nomes dos eventos graves (sem letra dobrada: "derame", "hemoragia"). */
const INFARTO = "infarto|enfarte|ataque cardiaco|ataque do coracao";
const PARADA =
  "parada (?:cardiaca|cardiorespiratoria|cardio respiratoria|respiratoria)";
const AVC = "avc|derame|acidente vascular(?: cerebral| encefalico)?";
const HEMORAGIA = "hemoragia";

/**
 * Antes do evento grave, a pergunta ou a informacao ("o botox pode ser a
 * causa de um AVC?", "quais os sinais de infarto?") e o exagero da propria
 * pessoa ("acho que vou ter um infarto com esse preco").
 */
const INFORMACAO_SOBRE_O_EVENTO =
  "\\b(?:causa|causar|causou|causam|provoca|provocar|risco|riscos|chance|chances|perigo|prevenir|previne|prevencao|evitar|evita|historico|historia|antecedente|antecedentes|sequela|sequelas|quais|qual|como (?:saber|identificar|reconhecer|evitar)|o que (?:sao|e)|sobre|reportagem|materia|artigo|palestra|documentario|aula|curso)\\b|\\b(?:vou (?:ter|dar|sofrer)|vai me dar|vao me dar|ia me dar)\\b";

/**
 * Uma palavra no meio do sinal ("minha boca FICOU torta", "a lingua DELA
 * ta inchada"), que nunca e a negacao: "minha lingua nao esta inchada" e
 * "a boca nao ficou torta" nao casam (revisao de 28/10/2026: a negacao
 * dentro do sinal, onde a negacao de antes nao olha).
 */
const PALAVRA_DO_MEIO = "(?!(?:nao|nem|nunca|jamais|sem)\\b)\\S+ ";

/**
 * Na boca e no rosto, a palavra do meio tambem nunca e o ESTADO PERMANENTE
 * (revisao de 30/10/2026): "minha boca e torta", "meu rosto e torto", "o
 * lado direito do meu rosto e mais caido", "sempre foi torta" sao a
 * estetica. "Ta", "ficou" e "esta" continuam casando.
 */
const PALAVRA_DO_MEIO_ATUAL =
  "(?!(?:nao|nem|nunca|jamais|sem|e|eh|era|sempre)\\b)\\S+ ";

/**
 * Quem "apagou" (desmaiou): a pessoa antes ("ela apagou do nada", "meu pai
 * apagou") ou o de repente depois ("apaguei do nada"). Com objeto ("apaguei
 * a mensagem", "ela apagou a foto") ou o sono ("apaguei de sono") nao.
 */
const QUEM_APAGOU =
  "(?:ela|ele|eu|(?:a |o )?(?:minha|meu) (?:mae|pai|avo|vo|filha|filho|marido|esposa|mulher|irma|irmao|tia|tio|amiga|amigo|namorada|namorado|sogra|sogro|bebe|neta|neto)|a paciente|o paciente|a crianca|o bebe|a bebe)";
const APAGOU_SEM_OBJETO =
  "(?! (?:a|o|as|os|um|uma|minha|meu|minhas|meus|sua|seu|esa|ese|esta|este|iso|isto|tudo|sem querer|mensagem|mensagens|foto|fotos|audio|audios|conversa|luz|luzes|vela|fogo|cigaro|contato|numero|cedo|dormindo|de sono|de cansaco|no sofa)\\b)";

/** O corte que nao e no corpo: o cabelo, a unha ("me cortar o cabelo"). */
const CORTE_DO_CORPO =
  "(?! (?:o|a|os|as|meu|minha|seu|sua) (?:cabelo|cabelos|franja|unha|unhas|barba|cuticula|cuticulas|ponta|pontas|fio|fios|bigode)\\b)";

/** O querer da propria pessoa ("queria dormir e nao acordar mais"). */
const QUERER =
  "(?:quero|queria|quis|vontade de|so quero|so queria|preferia|prefiro|desejo|desejava|gostaria de|penso em|pensei em|pensando em|to querendo|tou querendo|estou querendo)";

/** O fim da oracao logo depois do sinal (ou o "e" que abre outra). */
const FIM_LOGO_DEPOIS = "(?=\\s*$|\\s*[.!?,;:]|\\s+e\\b)";

/**
 * A lista PROPOSTA ao RT (D-51; desenho 5.2), com as variacoes de escrita
 * de cada sinal. Fisica primeiro, risco de vida depois.
 */
export const SINAIS_DE_EMERGENCIA: readonly SinalDeEmergencia[] = [
  // ---- respirar -----------------------------------------------------------
  {
    // Revisao de 30/10/2026: "falta di ar" ("tou cum falta di ar").
    nome: "falta_de_ar",
    tipo: "fisica",
    fonte: `\\b(?:falta(?: d[ei])?|faltando|faltou)(?: o)? ar\\b${NAO_E_O_AR_DE_RESPIRAR}`,
  },
  {
    nome: "sem_ar",
    tipo: "fisica",
    fonte: `\\b(?:sem|perdi o|perdendo o) ar\\b${NAO_E_O_AR_DE_RESPIRAR}${PERGUNTA_DO_LUGAR}`,
    excecaoAntes: LUGAR_SEM_AR,
  },
  {
    // Revisao de 28/10/2026 (lacuna da proposta ao RT): "to sem folego",
    // "falta de folego". O exagero ("sem folego de tanto rir") nao conta.
    nome: "sem_folego",
    tipo: "fisica",
    fonte: "\\b(?:sem|falta d[ei]|faltando|perdi o|perdendo o) folego\\b",
    excecaoDepois:
      "^\\s*de (?:tanto|rir|felicidade|emocao|alegria|ansiedade)\\b",
  },
  {
    nome: "nao_consigo_respirar",
    tipo: "fisica",
    fonte:
      "\\b(?:(?:nao|nem) (?:consigo|consegui|conseguia|consegue|conseguimos|to conseguindo|tou conseguindo|estou conseguindo|ta conseguindo|esta conseguindo|estava conseguindo|tava conseguindo)|sem conseguir) (?:mais )?respirar\\b",
    excecaoNaMensagem: NARIZ_COM_PROCEDIMENTO,
  },
  {
    nome: "dificuldade_para_respirar",
    tipo: "fisica",
    fonte:
      "\\bdificuldades? (?:(?:de|di|para|pra|pa|em|pro) )?respirar\\b|\\bdificuldade respiratoria\\b|\\brespirando com dificuldade\\b",
    // Revisao de 30/10/2026: o nariz com a rinoplastia na mesma mensagem.
    excecaoNaMensagem: NARIZ_COM_PROCEDIMENTO,
  },
  { nome: "sufocando", tipo: "fisica", fonte: "\\bsufocando\\b" },
  {
    nome: "garganta_fechando",
    tipo: "fisica",
    fonte: `\\bgarganta (?:${PALAVRA_DO_MEIO}){0,3}?(?:fechando|fechou)\\b`,
  },
  // ---- peito e coracao ----------------------------------------------------
  {
    nome: "dor_no_peito",
    tipo: "fisica",
    fonte: `\\b(?:dor|dores|dorzinha|aperto|apertos|queimacao|queimor|pontada|pontadas)(?: ${REFORCO_DA_DOR})* (?:(?:no|do|em|nese|neste|aqui no|bem no)(?: meu)?|(?:no|do) (?:lado (?:esquerdo|direito)|meio|centro) do) peito\\b|\\bpeito (?:(?:ta|esta|todo|muito|bem|meio|super|tao|ficou|fica) )*(?:doendo|apertad[oa]|queimando|ardendo)\\b`,
  },
  {
    // Revisao de 28/10/2026 (lacuna): o infarto AGORA ou a suspeita dele
    // ("to tendo um infarto", "acho que e infarto", "ele ta infartando",
    // "meu pai infartou agora", "teve um infarto hoje"). A historia ("tive
    // infarto ano passado", "meu pai morreu de infarto", "meu pai
    // infartou") e a pergunta ("botox pode causar infarto?") nao contam.
    nome: "infarto",
    tipo: "fisica",
    fonte: `${ANTES_DO_EVENTO}(?:${INFARTO})\\b|${eventoComOAgora(INFARTO)}|\\b(?:infartando|enfartando)\\b|${passadoComOAgora("infartou|enfartou|infartei|enfartei")}`,
    excecaoAntes: INFORMACAO_SOBRE_O_EVENTO,
  },
  {
    // Revisao de 28/10/2026 (lacuna): a parada AGORA ("ela ta tendo uma
    // parada cardiaca", "esta em parada", "teve uma parada cardiaca agora",
    // "parou de respirar", "nao esta respirando"). O nome sozinho e a
    // historia ("minha avo teve parada cardiaca") nao contam; o nariz
    // entupido tambem nao.
    nome: "parada_cardiaca",
    tipo: "fisica",
    fonte: `${ANTES_DO_EVENTO}${PARADA}\\b|\\bem ${PARADA}\\b|${eventoComOAgora(PARADA)}|\\b(?:parou|parando) de respirar\\b|\\b(?:nao|nem) (?:ta|esta|tava|estava) (?:mais )?respirando\\b|\\b(?:nao|nem) respira mais\\b`,
    excecaoAntes: `${INFORMACAO_SOBRE_O_EVENTO}|\\bnariz\\b`,
  },
  // ---- desmaio, consciencia e convulsao -----------------------------------
  {
    nome: "desmaio",
    tipo: "fisica",
    fonte: "\\bdesmai(?:ei|ou|ando|aram|amos)\\b|\\bdesmaiad[oa]s?\\b",
  },
  {
    // Revisao de 30/10/2026 (lacuna): "ela apagou do nada", "meu pai
    // apagou". Com objeto ("apaguei a mensagem") ou o sono, nao.
    nome: "apagou",
    tipo: "fisica",
    fonte: `\\b${QUEM_APAGOU} (?:${PALAVRA_DO_MEIO})?(?:apagou|apaguei)\\b${APAGOU_SEM_OBJETO}|\\b(?:apagou|apaguei)(?: \\S+)? (?:do nada|de repente|derepente|e cai|e caiu|completamente|de vez)\\b`,
  },
  {
    nome: "perdeu_os_sentidos",
    tipo: "fisica",
    fonte:
      "\\bperd(?:i|eu|emos|eram|endo|ido) (?:os sentidos|a consciencia)\\b|\\b(?:ta|esta|ficou|estava|tava) (?:\\S+ )?(?:inconsciente|desacordad[oa])\\b",
  },
  {
    // Revisao de 30/10/2026 (lacuna): "ela nao acorda", "desmaiou e nao
    // acordou mais", "ele nao reage". O horario de acordar ("minha filha
    // nao acorda cedo") nao conta.
    nome: "nao_acorda",
    tipo: "fisica",
    fonte: `\\b(?:nao|nem) (?:acorda|acordou|ta acordando|esta acordando|quer acordar|consegue acordar|consigo acordar|conseguimos acordar|conseguem acordar|consegui acordar)\\b(?! (?:cedo|antes|de manha|a tempo|na hora|no horario|sozinh\\w*|com (?:o )?despertador|(?:pra|para) (?:ir|trabalhar|escola|aula|a escola|a aula))\\b)|\\b(?:nao|nem) (?:reage|reagiu|ta reagindo|esta reagindo)(?=\\s*$|\\s*[.!?,;:]|\\s+(?:e|mais|a nada|de jeito nenhum|quando)\\b)`,
  },
  {
    // Revisao de 30/10/2026 (lacuna): "ele ta morrendo". O exagero
    // ("morrendo de rir", "de vontade") e o celular ou a planta nao contam.
    nome: "morrendo",
    tipo: "fisica",
    fonte: `\\bmorendo\\b${EXAGERO_DE_MORRER}`,
    excecaoAntes:
      "\\b(?:celular|cel|bateria|carga|planta|plantas|flor|flores)\\b",
  },
  {
    nome: "convulsao",
    tipo: "fisica",
    fonte: "\\bconvuls(?:ao|oes|ionando|ionou|ionei|ionaram|iva|ivo)\\b",
    // O historico e o remedio sao assunto clinico, nao a crise agora.
    excecaoAntes:
      "\\b(?:historico|historia|antecedente|antecedentes|ja tive|ja teve|ja tivemos|ja tinha|remedio|remedios|medicamento|medicamentos|medicacao|tratamento|tomo|toma|tomava|controle)\\b(?:\\s+(?:de|da|do|pra|para|pela|pelo|contra|com|uma|um|anti|alguma|algum|as|os))*\\s*$",
  },
  // ---- rosto, fala e um lado do corpo (sinais de AVC) ----------------------
  {
    // A boca torta (e, revisao de 30/10/2026, a boca que caiu de um lado).
    // Depois do botox, da aplicacao ou do preenchimento, na MESMA mensagem,
    // na primeira pessoa e recente ("fiz botox e minha boca ficou torta") e
    // efeito do procedimento: continua "sintoma", sem a marca (D-51, como a
    // palpebra caida). O estado permanente ("minha boca e torta", "tenho a
    // boca torta de nascenca") e a estetica. "De repente", "do nada" e
    // "acordei" desfazem as duas excecoes.
    nome: "boca_torta",
    tipo: "fisica",
    fonte: `\\bboca (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:tort[oa]s?|entortou|entortando|entortada)\\b|\\bboca (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:caiu|caindo)(?: \\S+){0,3}? (?:de um lado|so de um lado|do lado (?:esquerdo|direito)|pela metade|de repente|derepente)\\b`,
    excecaoAntes: PERMANENTE_ANTES,
    excecaoDepois: PERMANENTE_DEPOIS,
    excecaoNaMensagem: PROCEDIMENTO_NA_MESMA_MENSAGEM,
    semExcecaoCom: INICIO_SUBITO,
  },
  {
    // Revisao de 28/10/2026: o rosto "caido" e "caindo" e a flacidez da
    // estetica ("papada e rosto caindo", "meu rosto caiu depois que
    // emagreci", "rosto caido, quanto custa?"). Aqui, o rosto TORTO (ou que
    // entortou). O procedimento recente da propria pessoa, na mesma
    // mensagem ("fiz harmonizacao e meu rosto ficou torto"), e efeito dele,
    // como a boca torta: "sintoma". Revisao de 30/10/2026: nunca com "de um
    // lado", "metade" ou "de repente"; o estado permanente ("meu rosto e
    // torto") e a estetica.
    nome: "rosto_torto",
    tipo: "fisica",
    fonte: `\\b(?:rosto|face) (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:tort[oa]s?|entortou|entortando|entortado|entortada)\\b`,
    excecaoAntes: PERMANENTE_ANTES,
    excecaoDepois: PERMANENTE_DEPOIS,
    excecaoNaMensagem: PROCEDIMENTO_NA_MESMA_MENSAGEM,
    semExcecaoCom: `${INICIO_SUBITO}|${UM_LADO_DO_ROSTO}`,
  },
  {
    // O rosto caido de UM LADO, pela METADE ou DE REPENTE ("o rosto caiu
    // de um lado", "metade do rosto caiu", "de repente o rosto caiu"):
    // nenhuma excecao apaga (revisao de 30/10/2026: nem o procedimento).
    // So o estado permanente dito com o "e" ("o lado direito do meu rosto e
    // mais caido") nao casa.
    nome: "rosto_caido_de_um_lado",
    tipo: "fisica",
    fonte:
      `\\b(?:lado|metade|banda) (?:esquerd[oa] |direit[oa] )?d[oa] (?:meu |minha |seu |sua )?(?:rosto|face|cara) (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:caiu|caido|caida|caindo)\\b` +
      `|\\b(?:rosto|face) (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:caiu|caido|caida|caindo)(?: \\S+){0,3}? (?:de um lado|so de um lado|do lado (?:esquerdo|direito)|pela metade|de repente|derepente)\\b` +
      `|\\b(?:de repente|derepente)(?: \\S+){0,4}? (?:rosto|face) (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:caiu|caido|caida|caindo)\\b`,
  },
  {
    nome: "fala_enrolada",
    tipo: "fisica",
    fonte: `\\b(?:fala|falando) (?:${PALAVRA_DO_MEIO})?(?:enrolad[ao]|arastad[ao])\\b`,
  },
  {
    // A propria pessoa ("nao consigo falar"). So no fim da oracao: "nao
    // consigo falar com a clinica" e "nao consigo falar agora" nao sao o
    // sinal. O telefone (ligacao, atendimento ou a clinica) na mesma oracao
    // ou na anterior, e quem esta ocupado na mesma mensagem ("agora nao
    // consigo falar, me manda mensagem"), sao a ligacao, nao a fala. Revisao
    // de 30/10/2026: o telefone so desfaz quando o alvo e a clinica (dita ou
    // nao): a pessoa nomeada ("liguei pro meu marido"), "acordei", "de
    // repente" e a queixa do corpo ("nao consigo mexer o braco") desfazem
    // as excecoes, e o "falar direito" e outro sinal, sem excecao. Sem
    // "alguem" na excecao: "alguem me ajuda nao consigo falar" e o sinal.
    nome: "nao_consigo_falar",
    tipo: "fisica",
    fonte: `\\b(?:nao|nem) (?:consigo|to conseguindo|tou conseguindo|estou conseguindo) (?:mais )?falar(?! direito)${FIM_LOGO_DEPOIS}`,
    excecaoAntes:
      "\\b(?:lig\\w*|telefon\\w*|chamada|chamadas|audio|whats|zap|zapzap|atend\\w*|recepc\\w*|secretaria|clinica|ninguem|voces|vcs|vc|doutor\\w*|dra|dr|medic\\w*)\\b",
    excecaoNaOracaoAnterior: TELEFONE_OU_ATENDIMENTO,
    excecaoNaMensagem: OCUPADO,
    semExcecaoCom: `${PESSOA_NO_TELEFONE}|${INICIO_SUBITO}|${QUEIXA_DO_CORPO}`,
  },
  {
    // Revisao de 30/10/2026: "nao consigo falar direito" (a fala, de quem
    // for) nunca e o telefone: nenhuma excecao ("liguei pro meu marido, nao
    // consigo mexer o braco e nao consigo falar direito").
    nome: "nao_fala_direito",
    tipo: "fisica",
    fonte: `\\b(?:nao|nem) (?:consigo|consegue|conseguia|to conseguindo|tou conseguindo|estou conseguindo|ta conseguindo|esta conseguindo) (?:mais )?falar direito${FIM_LOGO_DEPOIS}`,
  },
  {
    // Outra pessoa ("minha mae nao consegue falar", "liguei pra ela, ela
    // nao consegue falar"): o telefone NAO desfaz (quem liga e descobre que
    // a pessoa nao fala e o sinal). So a clinica como sujeito ("a recepcao
    // nao consegue falar") fica de fora.
    nome: "nao_consegue_falar",
    tipo: "fisica",
    fonte: `\\b(?:nao|nem) (?:consegue|conseguia|ta conseguindo|esta conseguindo) (?:mais )?falar(?! direito)${FIM_LOGO_DEPOIS}`,
    excecaoAntes:
      "\\b(?:recepc\\w*|secretaria|atendente|clinica|consultorio|voces|vcs)\\b",
    semExcecaoCom: `${PESSOA_NO_TELEFONE}|${INICIO_SUBITO}|${QUEIXA_DO_CORPO}`,
  },
  {
    nome: "lado_do_corpo",
    tipo: "fisica",
    fonte: `\\b(?:lado|metade|parte|banda) (?:esquerd[oa] |direit[oa] )?do (?:meu )?corpo (?:${PALAVRA_DO_MEIO}){0,2}?(?:sem forca|fraco|fraca|dormente|dormentes|paralisad[oa]|adormecid[oa])\\b`,
  },
  {
    // Revisao de 28/10/2026 (lacuna): o AVC ou o derrame AGORA, ou a
    // suspeita ("acho que e um AVC", "ela ta tendo um derrame", "minha mae
    // teve um AVC agora", "hoje ela teve um derrame"). A historia ("minha
    // mae teve um AVC", "meu pai ja teve AVC") e a pergunta nao contam (como
    // o infarto); o derrame no olho tambem nao.
    nome: "avc",
    tipo: "fisica",
    fonte: `${ANTES_DO_EVENTO}(?:${AVC})\\b|${eventoComOAgora(AVC)}`,
    excecaoAntes: INFORMACAO_SOBRE_O_EVENTO,
    excecaoDepois:
      "^\\s*(?:(?:no|nos|na|nas) (?:olho|olhos|vista|pele|rosto|joelho|ombro)|ocular|pleural|articular)\\b",
  },
  // ---- alergia forte ------------------------------------------------------
  {
    nome: "garganta_ou_lingua_inchando",
    tipo: "fisica",
    fonte: `\\b(?:garganta|lingua) (?:${PALAVRA_DO_MEIO}){0,2}?(?:inchando|inchou)\\b`,
  },
  {
    // Revisao de 28/10/2026 (lacuna): "minha lingua ta inchada". A garganta
    // inflamada da gripe, na mesma mensagem, nao conta (continua
    // "sintoma"), nem a negacao no meio ("minha lingua nao esta inchada").
    nome: "garganta_ou_lingua_inchada",
    tipo: "fisica",
    fonte: `\\b(?:garganta|lingua) (?:${PALAVRA_DO_MEIO}){0,2}?(?:inchada|inchado|inchadas|inchados)\\b`,
    excecaoNaMensagem:
      "\\b(?:inflamad\\w*|amigdal\\w*|amidal\\w*|gripe|gripad[oa]|resfriad[oa]|dor de garganta|faringite|laringite|infecao|infecionad[oa]|pus)\\b",
  },
  {
    nome: "reacao_alergica_forte",
    tipo: "fisica",
    fonte:
      "\\breac(?:ao|oes) alergicas? (?:\\S+ )?(?:forte|fortes|grave|graves|severa|severas|seria|serias)\\b|\\b(?:forte|grave|severa|seria) reac(?:ao|oes) alergicas?\\b",
  },
  {
    nome: "anafilaxia",
    tipo: "fisica",
    fonte: "\\banafila(?:xia|tic[oa]s?)\\b",
  },
  // ---- sangramento (o antecedente nunca apaga) -----------------------------
  {
    nome: "sangrando_muito",
    tipo: "fisica",
    fonte:
      "\\bsangrando (?:muito|mto|mt|demais|bastante|sem parar|tanto|um monte|horores)\\b",
    semAntecedente: true,
  },
  {
    nome: "nao_para_de_sangrar",
    tipo: "fisica",
    fonte:
      "\\b(?:nao|nem) (?:para|parou|ta parando|esta parando|quer parar|consigo parar|consegue parar|conseguimos parar|estanca|estancou) de sangrar\\b|\\b(?:sangue|sangramento) (?:que )?(?:nao|nem) (?:para|parou|estanca|estancou)\\b",
    semAntecedente: true,
  },
  {
    nome: "muito_sangue",
    tipo: "fisica",
    fonte:
      "\\b(?:muito|mto|mt|bastante|tanto|um monte de) sangue\\b|\\bsangue (?:demais|pra todo lado)\\b",
    semAntecedente: true,
  },
  {
    // Revisao de 28/10/2026 (lacuna): a hemorragia AGORA ("to com uma
    // hemorragia", "ta tendo uma hemorragia", "acho que e hemorragia", "ela
    // teve uma hemorragia agora"). O risco perguntado ("risco de
    // hemorragia?") e a historia ("tive hemorragia no parto") nao contam.
    nome: "hemorragia",
    tipo: "fisica",
    fonte: `(?<=\\b(?:${EVENTO_AGORA}|(?:to|tou|estou|ta|esta) com)(?: \\S+){0,3}? )(?:uma )?${HEMORAGIA}\\b|${eventoComOAgora(HEMORAGIA)}`,
    excecaoAntes: INFORMACAO_SOBRE_O_EVENTO,
    semAntecedente: true,
  },
  // ---- emergencia e socorro -----------------------------------------------
  {
    nome: "emergencia",
    tipo: "fisica",
    fonte: "\\bemergencias?\\b",
    // O nome de uma coisa ("contato de emergencia", "saida de emergencia"),
    // a hipotese ("em caso de emergencia", "se for emergencia") e, na
    // revisao de 28/10/2026, a agenda ("encaixe de emergencia", "consulta
    // de emergencia"), o que ja passou ("surgiu uma emergencia", "tive uma
    // emergencia"), a pergunta sobre o servico ("voces atendem emergencia?",
    // "o plano cobre emergencia?", e na revisao de 30/10/2026 "voces fazem
    // atendimento de urgencia e emergencia?") e o lugar onde ja esteve ("fui
    // na emergencia ontem") nao sao a emergencia agora.
    excecaoAntes:
      "\\b(?:(?:contato|contatos|telefone|telefones|numero|numeros|fone|celular|whats|whatsap|ramal|pesoa|saida|saidas|kit|luz|luzes|freio|botao|fundo|porta|portas|escada|plantao|servico|servicos) (?:de|da|pra|para)|(?:em|no|num) caso de|se (?:for|tiver|houver|der|acontecer|precisar)(?: de)?(?: uma| um| alguma| algum)?)\\s*$" +
      "|\\b(?:encaixe|encaixes|encaixar|encaixa|horario|horarios|vaga|vagas|agenda|agendamento|marcacao|consulta|consultas|retorno) (?:de|em|para|pra)\\s*$" +
      "|\\b(?:surgiu|surgiram|apareceu|aconteceu|tive|teve|tivemos|tinha|houve|deu|rolou|ocoreu)(?: (?:uma|um|umas|uns|outra|outro))?(?: (?:pequena|pequeno|grande|baita))?\\s*$" +
      "|\\b(?:atende|atendem|faz|fazem|cobre|cobrem|aceita|aceitam|oferece|oferecem|trabalha|trabalham)(?: \\S+){0,2}?\\s*$" +
      "|\\b(?:voces|vcs|vc|clinica|consultorio) (?:tem|teriam)(?: \\S+){0,2}?\\s*$" +
      "|\\b(?:fui|foi|fomos|foram|levei|levou|levaram|estive|esteve|pasei|pasou|sai|saiu|voltei|voltou|atendid[oa]|internad[oa]|(?:tive|teve|tivemos|precisei|precisou) (?:que |de )?ir) (?:\\S+ ){0,2}?(?:na|da|pra|para a|a|numa)\\s*$" +
      "|\\b(?:atendimento|atendimentos|pronto atendimento|plantao|plantoes|servico|servicos|setor|ala|equipe|medico|medicos|hospital) (?:de|da|em|para|pra) (?:urgencia (?:e|ou) )?\\s*$",
    // Depois: "emergencia familiar", "no trabalho", "do hospital" e o "nao"
    // que fecha a oracao ("e emergencia nao", "emergencia nenhuma").
    excecaoDepois:
      "^\\s*(?:familiar|familiares|de familia|na familia|em familia|pesoal|particular|no trabalho|do trabalho|no servico|do servico|no emprego|do emprego|d[oa] (?:hospital|upa|pronto socoro|posto|clinica)\\b|(?:que )?(?:apareceu|surgiu|aconteceu)\\b|(?:nao|nenhuma)(?:\\s+(?:viu|ta|tah|ok|ne|so|k|rs\\w*))*\\s*$)",
    // Revisao de 30/10/2026: a agenda do paciente na mesma mensagem
    // ("tenho uma emergencia, preciso remarcar"), sem o pedido de ajuda.
    excecaoNaMensagem: AGENDA_DO_PACIENTE,
    // O pedido de ajuda, em qualquer mensagem da rajada, desfaz.
    semExcecaoCom: PEDIDO_DE_AJUDA,
  },
  {
    nome: "chamar_o_socorro",
    tipo: "fisica",
    // "Chama o SAMU", "liguei pro 192", "a ambulancia esta a caminho". O
    // SAMU citado sem o pedido ("o SAMU fica perto dai?") nao conta. A
    // historia nunca apaga ("ja tive que chamar o SAMU pra ela").
    fonte: `\\b${CHAMAR_O_SOCORRO}(?: (?:o|a|um|uma|pro|pra|para|ao|no|na|de|do|da))?(?: (?:o|a))? (?:samu|ambulancia|192)\\b|\\b(?:samu|ambulancia) (?:(?:ja|ta|esta) )?(?:a caminho|vindo|chegando|chegou|veio|levou|levando)\\b`,
    semAntecedente: true,
  },
  // ---- risco de vida (sofrimento) -----------------------------------------
  {
    nome: "quero_morrer",
    tipo: "risco_de_vida",
    fonte: `\\b(?:quero|queria|quis|vontade de|to querendo|tou querendo|estou querendo|so quero|so queria|prefiro|preferia|desejo|pensando em|penso em|pensei em)(?: (?:muito|tanto|mesmo|so|logo))? morer\\b${EXAGERO_DE_MORRER}`,
  },
  {
    // Revisao de 28/10/2026 (lacuna): "melhor eu morrer", "seria melhor se
    // eu morresse", "melhor que eu morra" e a outra pessoa ("ela diz que
    // seria melhor ela morrer"). A pergunta retorica com o "nao" ("nao
    // seria melhor eu morrer?") e o sinal, nunca a negacao dele: o "nao"
    // entra no sinal (SINAL_COM_A_PROPRIA_NEGACAO).
    nome: "melhor_morrer",
    tipo: "risco_de_vida",
    fonte: `\\b(?:(?:nao|nem) (?:seria|e|era|fica|ficaria) )?(?:melhor|preferivel) (?:(?:se |que )?(?:eu|ela|ele) (?:ja )?|pra mim )?(?:morer|morese|estar mort[oa]|ficar mort[oa])\\b${EXAGERO_DE_MORRER}|\\bmelhor que (?:eu|ela|ele) mora\\b`,
  },
  {
    // Revisao de 28/10/2026 (lacuna): "queria estar morta". O cansaco ("to
    // morta de cansaco") nao tem o querer e nao casa.
    nome: "estar_morta",
    tipo: "risco_de_vida",
    fonte: `\\b(?:quero|queria|quis|preferia|prefiro|desejo|desejava|so queria|so quero|gostaria de|vontade de) (?:estar|ficar|ser) mort[oa]s?\\b${EXAGERO_DE_MORRER}`,
  },
  {
    // Revisao de 30/10/2026 (lacuna): "queria dormir e nao acordar mais",
    // "quero dormir pra sempre" e a outra pessoa ("ela disse que queria
    // dormir e nao acordar mais"). O medo ("tenho medo de dormir e nao
    // acordar na anestesia") nao tem o querer e nao casa.
    nome: "dormir_e_nao_acordar",
    tipo: "risco_de_vida",
    fonte: `\\b${QUERER} (?:so )?dormir (?:e )?(?:nao acordar(?: mais)?|nunca mais acordar|pra sempre|para sempre)\\b`,
  },
  {
    // "vou me matar", "pensei em me matar". Revisao de 28/10/2026, refeita
    // em 30/10/2026: com o sujeito de exagero CONCRETO ("esse preco vai me
    // matar", "meu marido vai me matar", "essa dieta ta me matando") nao e
    // risco de vida. O sofrimento ("essa tristeza ta me matando", "a vida ta
    // me matando"), o pronome ("isso vai me matar"), o "eu" ("hoje a noite
    // eu ia me matar", "se nao fosse a minha filha eu ia me matar"), o "ia"
    // sem sujeito e a ameaca de outra pessoa ("meu ex quer me matar")
    // continuam (o lado conservador).
    nome: "me_matar",
    tipo: "risco_de_vida",
    fonte: `\\bme mat(?:ar|o|ando)\\b${EXAGERO_DE_MATAR}`,
    excecaoAntes: `\\b(?:(?:o|a|os|as) )?(?:meu|minha|meus|minhas|seu|sua|seus|suas|teu|tua|nosa|noso|nosas|nosos|ese|esa|eses|esas|este|esta|estes|estas|aquele|aquela|o|a|os|as) ${SUJEITO_DE_EXAGERO}(?: (?!eu\\b)[a-z]+){0,2} (?:(?:ainda|asim|quase|ja) )?(?:vai|vao|ta|tao|esta|estao|vive)\\s*$`,
    excecaoDepois: `^\\s*(?:com|de) (?:ese|esa|eses|esas|este|esta|tanto|tanta|tantos|tantas|o|a|os|as|seu|sua|meu|minha) ${SUJEITO_DE_EXAGERO}\\b`,
  },
  {
    // Outra pessoa em risco ("ela disse que vai se matar") continua sendo
    // risco de vida: a conversa passa como urgente.
    nome: "se_matar",
    tipo: "risco_de_vida",
    fonte: `\\bse mat(?:ar|o|ando)\\b${EXAGERO_DE_MATAR}`,
  },
  {
    // Revisao de 30/10/2026 (lacuna): o corte em si mesma ("vou me cortar",
    // "to me cortando"). O cabelo e a unha ("me cortar o cabelo") e a
    // cirurgia, com o medico ou a equipe como sujeito ("na lipo, vao me
    // cortar onde?", "o medico vai me cortar muito?"), nao contam.
    nome: "me_cortar",
    tipo: "risco_de_vida",
    fonte: `\\bme cort(?:ar|ando|o|a)\\b${CORTE_DO_CORPO}`,
    excecaoAntes:
      "(?:\\b(?:medic\\w*|doutor\\w*|dra|dr|cirurgi\\w*|equipe|voces|vcs|eles|elas)\\b(?: \\S+){0,2}? (?:vai|vao|iria|iriam|precisa|precisam|tem que|teria que)|\\b(?:vao|iriam|precisam))\\s*$",
  },
  {
    // A outra pessoa ("ela disse que vai se cortar", "ele ta se cortando"):
    // risco de vida, como o "se matar".
    nome: "se_cortar",
    tipo: "risco_de_vida",
    fonte: `\\bse cort(?:ar|ando|a)\\b${CORTE_DO_CORPO}`,
  },
  {
    nome: "tirar_a_propria_vida",
    tipo: "risco_de_vida",
    fonte:
      "\\btirar (?:a )?(?:minha|propria|sua|tua) (?:propria )?vida\\b|\\bacabar com (?:a )?(?:minha|propria) vida\\b|\\bdar fim (?:a|na) (?:minha )?vida\\b",
  },
  {
    // Revisao de 28/10/2026 (lacuna): "vou acabar com tudo", "quero acabar
    // com tudo isso" e a outra pessoa ("meu filho falou que vai acabar com
    // tudo", "ela ameacou acabar com tudo"). Com o objeto dito logo depois
    // ("acabar com tudo de mancha", "acabar com tudo isso de ruga", "acabar
    // com tudo no rosto", "acabar com tudo: rugas e manchas") e a estetica,
    // nao conta. "Isso vai acabar com tudo" (sem a pessoa) tambem nao.
    nome: "acabar_com_tudo",
    tipo: "risco_de_vida",
    fonte:
      "\\b(?:vou|vo|quero|queria|vontade de|penso em|pensando em|pensei em|decidi|resolvi|(?:dise|falou|fala|diz|escreveu|avisou|ameacou|ameaca) que (?:vai|ia|vou|quer|queria)|ameacou|ameaca|ameacando|(?:ele|ela) (?:vai|quer|queria|ta querendo|esta querendo|ta pensando em|esta pensando em|pensa em)) acabar com tudo\\b(?! (?:de|da|do|das|dos|na|no|nas|nos|em|que|nese|nesa|neste|nesta)\\b)(?! (?:iso|isto|aquilo) (?:de|da|do|das|dos|que|na|no|em)\\b)(?!\\s*[:,]?\\s*(?:(?:as|os|a|o|minhas|meus|minha|meu|eses|esas) )?(?:rugas?|manchas?|flacidez|celulite|estrias?|olheiras?|acne|espinhas?|cravos?|papada|gordura|gordurinhas?|pelos?|melasma|cicatriz|cicatrizes|marcas?|linhas?|vincos?|sinais)\\b)",
  },
  { nome: "suicidio", tipo: "risco_de_vida", fonte: "\\bsuicid\\w*" },
  {
    nome: "nao_quero_mais_viver",
    tipo: "risco_de_vida",
    fonte:
      "\\b(?:(?:nao|nem) (?:quero|queria|aguento|consigo|tenho (?:mais )?vontade de|vejo sentido em)|sem vontade de|cansad[oa] de) (?:mais )?viver\\b|\\b(?:vida|viver) nao (?:tem|faz) (?:mais )?sentido\\b",
  },
  {
    // Revisao de 30/10/2026 (lacuna): "nao vejo mais sentido na vida" e a
    // outra pessoa ("ela diz que nao ve mais sentido na vida").
    nome: "sem_sentido_na_vida",
    tipo: "risco_de_vida",
    fonte:
      "\\b(?:nao|nem) (?:vejo|ve|via|encontro|encontra|acho|acha|tenho|tem|sinto|sente) (?:mais )?(?:nenhum |algum )?sentido (?:na|em|pra|para) (?:minha |a |esa |esta )?(?:vida|viver|continuar)\\b",
  },
];

/**
 * As palavras curtas que podem ficar entre a negacao e o sinal ("nao ESTOU
 * COM falta de ar", "nunca TIVE convulsao"). Sem letra repetida ("iso").
 */
const PONTE_DA_NEGACAO =
  "(?:e|eh|foi|era|sera|seria|ta|to|tou|estou|esta|estava|estive|tava|tive|teve|tenho|tem|tinha|sinto|senti|sentiu|sentindo|sentir|com|cum|de|da|do|uma|um|nenhuma|nenhum|mais|muita|muito|qualquer|tipo|caso|se|trata|me|eu|ela|ele|iso|deu|ficou|fiquei|houve|aconteceu|sou|ter|tido|estar|nada|ainda|mesmo|tanta|tanto|penso|pensei|pensou|pensar|pensando|em|nem|nunca|tendo)";

/** A negacao logo antes do sinal, no fim do trecho da mesma oracao. */
const NEGACAO_ANTES = new RegExp(
  `\\b(?:nao|nunca|nem|jamais|sem|nenhum|nenhuma)(?:\\s+${PONTE_DA_NEGACAO}){0,4}\\s*$`,
);

/**
 * O "nunca" (ou "jamais") logo antes do sinal: com a INTENSIDADE, e enfase,
 * nao negacao ("nunca senti uma dor tao forte no peito", "nunca tive tanta
 * falta de ar"). O "nao" com a intensidade continua negacao ("nao tenho
 * tanta falta de ar").
 */
const NEGACAO_ENFATICA_ANTES = new RegExp(
  `\\b(?:nunca|jamais)(?:\\s+${PONTE_DA_NEGACAO}){0,4}\\s*$`,
);

/** A intensidade: entre o "nunca" e o sinal, ou dentro do sinal. */
const INTENSIDADE =
  "(?:tao|tanta|tanto|tantas|tantos|tamanha|tamanho|tal|asim)";
const INTENSIDADE_NO_TRECHO = new RegExp(`\\b${INTENSIDADE}\\b`);

/** A intensidade logo depois do sinal ("falta de ar assim", "como essa"). */
const INTENSIDADE_DEPOIS = new RegExp(
  `^\\s*(?:\\S+\\s+){0,2}?(?:${INTENSIDADE}|igual|parecid[oa]s?|como (?:esa|ese|esta|este|aquela|aquele|agora|hoje)|desa (?:forma|maneira|vez|intensidade)|dese jeito)\\b`,
);

/**
 * As marcas de tempo da historia, que governam o sinal antes ou logo depois
 * dele ("ano passado desmaiei", "desmaiei ano passado", "quando eu era
 * crianca tive convulsao", "tive convulsao quando era crianca"). Sem letra
 * repetida ("pasado").
 */
const MARCA_DE_TEMPO_DA_HISTORIA =
  "as vezes|de vez em quando|quando (?:eu |ele |ela )?(?:era|tinha)|quando (?:crianca|pequen[oa]|nov[oa]|menin[oa]|adolescente|jovem)|na (?:infancia|adolescencia)|antigamente|no pasado|(?:ano|mes|semestre) pasado|semana pasada|(?:anos|meses) atras|(?:faz|ha) (?:um ano|(?:muitos |alguns |uns |\\d+ )?anos)|em (?:19|20)\\d\\d";

/**
 * O antecedente ANTES do sinal, na mesma parte da oracao: "ja desmaiei",
 * "ja tive", "toda vez que", "uma vez" (no comeco: "desmaiou uma vez" e a
 * contagem, nao a historia) e as marcas de tempo. "Mais uma vez" e "de uma
 * vez" nao sao historia. Com a flag g: o marcador tem de comecar antes do
 * sinal (pode avancar sobre ele: "ja desmaiei").
 */
const ANTECEDENTE_ANTES = new RegExp(
  `\\b(?:ja (?:tive|tivemos|tinha|teve|senti|sentia|fiquei|ficava|desmaiei|desmaiava|pasei|sofri|sofreu|perdi)|toda vez que|sempre que|(?<!\\b(?:mais|de) )uma vez|certa vez|${MARCA_DE_TEMPO_DA_HISTORIA})\\b`,
  "g",
);

/** O antecedente logo DEPOIS do sinal: so as marcas de tempo. */
const ANTECEDENTE_DEPOIS = new RegExp(
  `\\b(?:${MARCA_DE_TEMPO_DA_HISTORIA})\\b`,
);

/**
 * O AGORA na mesma oracao desfaz a historia ("ja desmaiei duas vezes hoje").
 * "Hoje em dia" e "hoje faz um ano" nao sao o agora.
 */
const AGORA =
  /\b(?:agora|agorinha|hoje(?! (?:em dia|faz|fazem|completa|completam)\b)|neste momento|nese momento|de novo|outra vez|novamente|mais uma vez|acabei de|acabou de|acabamos de|ha pouco|faz pouco)\b/;

/**
 * O PRESENTE na parte do sinal desfaz a historia (revisao de 30/10/2026):
 * "to com", "esta com", "continua", "ainda" e o gerundio com o verbo de
 * agora ("ta convulsionando", "fica desmaiando"). O gerundio solto ("ja
 * desmaiei tirando sangue") e o do passado ("uma vez ela tava morrendo")
 * sao a historia e nao desfazem.
 */
const PRESENTE =
  /\b(?:(?:to|tou|ta|tah|esta|estou|estamos|estao|tao) (?:com|cum)|continua|continuo|continuam|continuando|ainda|(?:to|tou|ta|tah|esta|estou|estamos|estao|tao|fica|fico|continua|continuo|segue|sigo) \S+(?:ando|endo|indo))\b/;

/**
 * A retomada nas partes seguintes da mesma oracao ("ja tive falta de ar e
 * continua", "e voltou", "e ainda tenho"): a historia volta a ser agora.
 */
const RETOMADA =
  /\b(?:ainda|continua|continuo|continuam|voltou|voltaram|piorou|piorando|de novo|outra vez|novamente)\b/;

/**
 * A ORACAO SEGUINTE a do sinal: a adversativa que a abre ("mas", "porem",
 * "so que") e o que ela diz, ate a pontuacao.
 */
const ORACAO_SEGUINTE =
  /^[\s.,;:!?]*(?:(mas|porem|so que|contudo|todavia)\b\s*)?([^.!?;,:\n]*)/;

/**
 * O estado de AGORA na oracao seguinte ("agora ta muito forte", "hoje
 * piorou", "agora voltou").
 */
const ESTADO_DE_AGORA =
  /\b(?:ta|tah|esta|estou|to|tou|estamos|estao|tao|ficou|fiquei|piorou|piorando|voltou|voltaram|continua|continuo|doi|doendo|forte|fortes|pior)\b/;

/**
 * O estado BOM na oracao seguinte ("hoje estou bem", "mas agora to otima"):
 * a historia continua historia. "Ta bem forte" nao e o estado bom.
 */
const ESTADO_BOM =
  /\b(?:(?:to|tou|estou|ta|tah|esta|estamos|fiquei|fico|me sinto|me sentindo) (?:bem|otim[oa]|melhor|normal|tranquil[oa]|curad[oa]|recuperad[oa]|de boa)(?! (?:forte|fortes|pior|ruim|mal|intens\w*|grave|esquisit\w*|estranh\w*|dolorid\w*|inchad\w*))|(?:nao|nem) (?:tenho|sinto) mais nada)\b/;

/**
 * O agora na oracao SEGUINTE desfaz a historia (revisao de 30/10/2026): com
 * a adversativa ("ja tive dor no peito, mas agora ta muito forte"), ou com
 * o estado de agora ("ja tive dor no peito, agora ta muito forte"). O
 * estado bom ("ja desmaiei, hoje estou bem") nao desfaz.
 */
function agoraNaOracaoSeguinte(resto: string): boolean {
  const m = ORACAO_SEGUINTE.exec(resto);
  const oracao = m?.[2] ?? "";
  if (!AGORA.test(oracao) || ESTADO_BOM.test(oracao)) {
    return false;
  }
  return m?.[1] !== undefined || ESTADO_DE_AGORA.test(oracao);
}

/** O " e " que tambem quebra a oracao para o antecedente. */
const E_DA_ORACAO = /\be\b/g;

/** Onde a oracao comeca: depois da ultima pontuacao ou do "mas". */
const FIM_DA_ORACAO =
  /[.!?;,:\n]|\b(?:mas|porem|so que|entao|contudo|todavia)\b/g;

/** O primeiro fim de oracao (sem a flag g, para o search). */
const PRIMEIRO_FIM_DA_ORACAO = new RegExp(FIM_DA_ORACAO.source);

function regexOuNulo(fonte: string | undefined): RegExp | null {
  return fonte === undefined ? null : new RegExp(fonte);
}

const SINAIS_COMPILADOS = SINAIS_DE_EMERGENCIA.map((sinal) => ({
  sinal,
  regex: new RegExp(sinal.fonte, "g"),
  excecaoAntes: regexOuNulo(sinal.excecaoAntes),
  excecaoDepois: regexOuNulo(sinal.excecaoDepois),
  excecaoNaOracaoAnterior: regexOuNulo(sinal.excecaoNaOracaoAnterior),
  excecaoNaMensagem: regexOuNulo(sinal.excecaoNaMensagem),
  semExcecaoCom: regexOuNulo(sinal.semExcecaoCom),
}));

type SinalCompilado = (typeof SINAIS_COMPILADOS)[number];

/** A letra repetida vira uma so ("faltaaa de arrr" vira "falta de ar"). */
function semLetraRepetida(texto: string): string {
  return texto.replace(/([a-z])\1+/g, "$1");
}

/** As trocas de expressao permitida do portao ("Maria do Socorro"). */
const neutralizarEntrada = neutralizador(NEUTRALIZACOES_DE_ENTRADA);

/** As visoes do portao de um texto, na ordem, cada uma sem letra repetida. */
function visoesSemRepeticao(texto: string): string[] {
  return frasesDasVisoes(visoesDoTexto(texto, [], neutralizarEntrada)).map(
    semLetraRepetida,
  );
}

/**
 * Uma leitura: o texto lido e onde fica cada mensagem nele (um texto so: uma
 * mensagem; a juncao: as mensagens na ordem, separadas por espaco).
 */
type Leitura = {
  texto: string;
  mensagens: readonly { inicio: number; fim: number }[];
};

/**
 * As leituras de um ou mais textos (cada visao do portao, juntando as
 * mensagens na ordem), sem repetir.
 */
function leiturasDe(visoesPorTexto: readonly (readonly string[])[]): Leitura[] {
  const vistas = new Set<string>();
  const leituras: Leitura[] = [];
  const quantas = Math.max(0, ...visoesPorTexto.map((v) => v.length));
  for (let k = 0; k < quantas; k += 1) {
    let texto = "";
    const mensagens: { inicio: number; fim: number }[] = [];
    for (const visoes of visoesPorTexto) {
      const parte = visoes[k] ?? "";
      if (parte !== "" && texto !== "") {
        texto += " ";
      }
      mensagens.push({
        inicio: texto.length,
        fim: texto.length + parte.length,
      });
      texto += parte;
    }
    const chave = `${texto}\u0000${mensagens.map((m) => m.inicio).join(",")}`;
    if (!vistas.has(chave)) {
      vistas.add(chave);
      leituras.push({ texto, mensagens });
    }
  }
  return leituras;
}

/**
 * A MESMA mensagem do sinal: o trecho da leitura das mensagens que o sinal
 * toca (um texto so: o texto inteiro; na juncao, a mensagem dele ou, se o
 * sinal atravessa mensagens, todas as que ele toca).
 */
function mensagemDoSinal(
  leitura: Leitura,
  inicio: number,
  fim: number,
): string {
  let comeco = -1;
  let final = -1;
  for (const mensagem of leitura.mensagens) {
    if (
      mensagem.fim > mensagem.inicio &&
      mensagem.inicio < fim &&
      mensagem.fim > inicio
    ) {
      comeco =
        comeco === -1 ? mensagem.inicio : Math.min(comeco, mensagem.inicio);
      final = Math.max(final, mensagem.fim);
    }
  }
  return comeco === -1 ? leitura.texto : leitura.texto.slice(comeco, final);
}

/**
 * Onde comeca a oracao da posicao (depois do ultimo fim de oracao antes
 * dela) e onde comeca esse fim (-1: a oracao e a primeira).
 */
function inicioDaOracao(
  texto: string,
  posicao: number,
): { inicio: number; fim: number } {
  const antes = texto.slice(0, posicao);
  let inicio = 0;
  let fim = -1;
  for (const m of antes.matchAll(FIM_DA_ORACAO)) {
    fim = m.index ?? 0;
    inicio = fim + m[0].length;
  }
  return { inicio, fim };
}

/** Onde acaba a oracao que comeca antes da posicao (no proximo fim). */
function fimDaOracao(texto: string, posicao: number): number {
  const corte = texto.slice(posicao).search(PRIMEIRO_FIM_DA_ORACAO);
  return corte === -1 ? texto.length : posicao + corte;
}

/** O trecho da mesma oracao antes da posicao. */
function oracaoAntes(texto: string, posicao: number): string {
  return texto.slice(inicioDaOracao(texto, posicao).inicio, posicao);
}

/** O trecho da mesma oracao depois da posicao. */
function oracaoDepois(texto: string, posicao: number): string {
  return texto.slice(posicao, fimDaOracao(texto, posicao));
}

/** A oracao inteira que acaba logo antes da oracao da posicao. */
function oracaoAnterior(texto: string, posicao: number): string {
  const { fim } = inicioDaOracao(texto, posicao);
  return fim < 0 ? "" : oracaoAntes(texto, fim);
}

/**
 * O sinal que ja traz a propria negacao ("nao consigo respirar", "nao para
 * de sangrar"): o "nao" logo antes e enfase ("nao, nao consigo respirar"),
 * nunca a negacao do sinal. O "sem" nao entra: "nao estou sem ar" nega.
 */
const SINAL_COM_A_PROPRIA_NEGACAO = /^(?:nao|nem) /;

/** O "nunca" com a intensidade: enfase, nao negacao. */
function negacaoEnfatica(
  antes: string,
  sinal: string,
  depois: string,
): boolean {
  const enfatica = NEGACAO_ENFATICA_ANTES.exec(antes);
  if (enfatica === null) {
    return false;
  }
  return (
    INTENSIDADE_NO_TRECHO.test(enfatica[0]) ||
    INTENSIDADE_NO_TRECHO.test(sinal) ||
    INTENSIDADE_DEPOIS.test(depois)
  );
}

/**
 * O antecedente governa o sinal: comeca antes dele na mesma parte da oracao
 * (pode avancar sobre ele: "ja desmaiei"), ou e uma marca de tempo logo
 * depois dele ("desmaiei ano passado").
 */
function antecedenteGoverna(
  antesNaParte: string,
  sinal: string,
  depoisNaParte: string,
): boolean {
  for (const m of `${antesNaParte}${sinal}`.matchAll(ANTECEDENTE_ANTES)) {
    if ((m.index ?? 0) < antesNaParte.length) {
      return true;
    }
  }
  return ANTECEDENTE_DEPOIS.test(depoisNaParte);
}

/**
 * O sinal fisico conta uma HISTORIA (revisao de 30/10/2026): o antecedente
 * governa o sinal na parte da oracao dele (a oracao quebra tambem no " e "),
 * sem o agora na oracao, sem o presente na parte do sinal, sem a retomada
 * nas partes seguintes e sem o agora na oracao seguinte.
 */
function ehHistoria(texto: string, inicio: number, fim: number): boolean {
  const comeco = inicioDaOracao(texto, inicio).inicio;
  const final = fimDaOracao(texto, fim);
  const sinal = texto.slice(inicio, fim);
  const antesNaOracao = texto.slice(comeco, inicio);
  const depoisNaOracao = texto.slice(fim, final);
  let corteAntes = 0;
  for (const m of antesNaOracao.matchAll(E_DA_ORACAO)) {
    corteAntes = (m.index ?? 0) + m[0].length;
  }
  const antesNaParte = antesNaOracao.slice(corteAntes);
  const corteDepois = depoisNaOracao.search(E_DA_ORACAO);
  const depoisNaParte =
    corteDepois === -1 ? depoisNaOracao : depoisNaOracao.slice(0, corteDepois);
  const seguintes = corteDepois === -1 ? "" : depoisNaOracao.slice(corteDepois);
  if (!antecedenteGoverna(antesNaParte, sinal, depoisNaParte)) {
    return false;
  }
  return !(
    AGORA.test(`${antesNaOracao}${sinal}${depoisNaOracao}`) ||
    PRESENTE.test(`${antesNaParte}${sinal}${depoisNaParte}`) ||
    RETOMADA.test(seguintes) ||
    agoraNaOracaoSeguinte(texto.slice(final))
  );
}

/**
 * Uma excecao do sinal vale, e nada na leitura a desfaz (a excecao tira a
 * urgencia e le estreito; o que desfaz a devolve e le a leitura inteira).
 */
function excecaoVale(
  compilado: SinalCompilado,
  trechos: {
    antes: string;
    depois: string;
    anterior: string;
    mensagem: string;
    /** A leitura inteira (na juncao, a rajada toda), para o que desfaz. */
    leitura: string;
  },
): boolean {
  if (compilado.semExcecaoCom?.test(trechos.leitura) === true) {
    return false;
  }
  return (
    compilado.excecaoAntes?.test(trechos.antes) === true ||
    compilado.excecaoDepois?.test(trechos.depois) === true ||
    compilado.excecaoNaOracaoAnterior?.test(trechos.anterior) === true ||
    compilado.excecaoNaMensagem?.test(trechos.mensagem) === true
  );
}

/**
 * O sinal casou numa leitura, fora da negacao, das excecoes (da oracao e da
 * mesma mensagem) e, no fisico, da historia.
 */
function sinalNaLeitura(leitura: Leitura, compilado: SinalCompilado): boolean {
  const { texto } = leitura;
  for (const m of texto.matchAll(compilado.regex)) {
    const inicio = m.index ?? 0;
    const fim = inicio + m[0].length;
    const antes = oracaoAntes(texto, inicio);
    const depois = oracaoDepois(texto, fim);
    if (
      !SINAL_COM_A_PROPRIA_NEGACAO.test(m[0]) &&
      NEGACAO_ANTES.test(antes) &&
      !negacaoEnfatica(antes, m[0], depois)
    ) {
      continue;
    }
    if (
      excecaoVale(compilado, {
        antes,
        depois,
        anterior: oracaoAnterior(texto, inicio),
        mensagem: mensagemDoSinal(leitura, inicio, fim),
        leitura: texto,
      })
    ) {
      continue;
    }
    if (
      compilado.sinal.tipo === "fisica" &&
      compilado.sinal.semAntecedente !== true &&
      ehHistoria(texto, inicio, fim)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * O sinal de emergencia nos textos (os originais do paciente: o texto e a
 * legenda da midia, na ordem). Cada texto e lido sozinho e, com mais de um,
 * tambem a juncao deles na ordem ("to com dor" e "no peito"). A excecao da
 * mensagem (excecaoNaMensagem) le so a MESMA mensagem do sinal, nunca a
 * rajada inteira (revisao de 30/10/2026: "quanto fica com o botox?" e depois
 * "minha mae acordou com a boca torta agora" e urgencia). Nulo: nenhum sinal
 * fora da negacao, das excecoes e da historia. Risco de vida vence o fisico
 * (o aviso da AG6c para o risco de vida cita o CVV e o SAMU). Nunca lanca;
 * texto nulo ou vazio e ignorado.
 */
export function detectarUrgencia(
  textos: readonly (string | null | undefined)[],
): Urgencia | null {
  const validos = textos.filter(
    (texto): texto is string =>
      typeof texto === "string" && texto.trim() !== "",
  );
  if (validos.length === 0) {
    return null;
  }
  const visoes = validos.map(visoesSemRepeticao);
  const lidas =
    visoes.length > 1
      ? [...visoes.map((v) => leiturasDe([v])), leiturasDe(visoes)]
      : [leiturasDe(visoes)];
  let fisica: string | null = null;
  for (const leituras of lidas) {
    for (const compilado of SINAIS_COMPILADOS) {
      if (compilado.sinal.tipo === "fisica" && fisica !== null) {
        continue;
      }
      if (leituras.some((leitura) => sinalNaLeitura(leitura, compilado))) {
        if (compilado.sinal.tipo === "risco_de_vida") {
          return { tipo: "risco_de_vida", sinal: compilado.sinal.nome };
        }
        fisica = compilado.sinal.nome;
      }
    }
  }
  return fisica === null ? null : { tipo: "fisica", sinal: fisica };
}

/**
 * As regras de leitura (a negacao, a enfase, a historia e a oracao), na
 * ordem, para a versao e para o teste das fontes sem letra repetida.
 */
export const REGRAS_DE_LEITURA_DA_URGENCIA: readonly string[] = [
  NEGACAO_ANTES.source,
  NEGACAO_ENFATICA_ANTES.source,
  INTENSIDADE_NO_TRECHO.source,
  INTENSIDADE_DEPOIS.source,
  ANTECEDENTE_ANTES.source,
  ANTECEDENTE_DEPOIS.source,
  AGORA.source,
  PRESENTE.source,
  RETOMADA.source,
  ORACAO_SEGUINTE.source,
  ESTADO_DE_AGORA.source,
  ESTADO_BOM.source,
  E_DA_ORACAO.source,
  FIM_DA_ORACAO.source,
  SINAL_COM_A_PROPRIA_NEGACAO.source,
];

/**
 * O que define a urgencia, para a versao do portao (fontesDoPortao,
 * filtro.ts): cada sinal (tipo, nome, fonte, as excecoes, o que as desfaz e
 * o antecedente), as regras de leitura e o modo de ler. Sem hash aqui: roda
 * no navegador.
 */
export const FONTES_DA_URGENCIA: readonly string[] = [
  ...SINAIS_DE_EMERGENCIA.map((sinal) =>
    [
      sinal.tipo,
      sinal.nome,
      sinal.fonte,
      sinal.excecaoAntes ?? "",
      sinal.excecaoDepois ?? "",
      sinal.excecaoNaOracaoAnterior ?? "",
      sinal.excecaoNaMensagem ?? "",
      sinal.semExcecaoCom ?? "",
      sinal.semAntecedente === true ? "sem antecedente" : "",
    ].join(" "),
  ),
  ...REGRAS_DE_LEITURA_DA_URGENCIA,
  "leitura: as visoes do portao com as neutralizacoes de entrada, sem letra repetida; cada texto sozinho e a juncao das visoes na ordem; a excecao da mensagem le so a mensagem do sinal",
  "risco_de_vida vence fisica; o antecedente so nos sinais fisicos, so quando governa o sinal (a oracao quebra no e) e nunca no socorro nem no sangramento; urgencia e o primeiro gatilho de entrada",
];
