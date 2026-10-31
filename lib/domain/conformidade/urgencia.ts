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
// A PERGUNTA SOBRE O EFEITO (revisao de 6eae43d; so nos sinais fisicos): o
// verbo de causa logo antes do sinal, na mesma oracao ("da", "pode dar",
// "causa", "provoca", "e perigoso dar", "tem risco de", "posso ter"), com a
// frase do sinal acabando em "?" ("botox da falta de ar?", "pode dar falta
// de ar?"), e a duvida sobre o procedimento, nao o relato: nao conta. O
// relato presente nunca e essa pergunta ("to com falta de ar agora" continua
// urgente), nem "e normal dar falta de ar?" nem "me da falta de ar" (quem
// pergunta se e normal, ou diz que lhe da, pode estar sentindo agora).
// Revisao R2 de d1a15f6: tambem "pode deixar" ("botox pode deixar a boca
// torta?") e a HIPOTESE logo antes ("tenho pavor de ficar com a boca torta",
// "e se eu tiver uma reacao alergica forte"); o RELATO de agora em qualquer
// ponto da leitura ("to sentindo agora", "fiz", "tomei", "socorro") desfaz
// as duas.
//
// A REVISAO R2 DE d1a15f6 (o defeito de metodo: a trava compara a frase
// exata, e as excecoes dos aceitos generalizaram): a excecao estetica so com
// o OBJETO estetico (o nome do procedimento ou "deixar simetrico") e nunca
// com o agora, o lado, a queda ou a terceira pessoa; o preenchimento antigo
// so com o agora; a ameaca de verdade desfaz o exagero do "vai me matar"; as
// grafias do WhatsApp ("vou me mata", "kero morrer", "n consigo respirar",
// "acho q e avc", "convulcao"); e os sinais novos PROPOSTOS ao RT (o engasgo,
// a pilha engolida, o atropelamento, a picada de cobra, escorpiao ou aranha,
// o gas, a gestante que sangra, o bebe que parou de mexer, o vomito com
// sangue, os labios roxos e a confusao de repente). As matrizes geradas da
// bateria (MATRIZES_DA_URGENCIA) cruzam o relato de agora de cada sinal com
// excecao com os finais que as excecoes leem.
//
// O TEMPO e linear (revisao R2 de d1a15f6, B5): os fins de oracao, os " e "
// e os fins de frase sao achados uma vez por leitura; o que depende de um
// trecho fixo (a mensagem, a oracao, a leitura inteira) e testado uma vez so;
// e o que se le antes e depois do sinal na oracao e uma janela de 400 letras
// (o que fica mais longe, so numa oracao enorme sem pontuacao, nao apaga o
// sinal: o lado seguro).
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
  /**
   * A pergunta sobre o efeito nunca apaga este sinal fisico (revisao de
   * 6eae43d: a complicacao do preenchimento JA FEITO, em que quem pergunta
   * "pode dar visao embacada?" pode estar sentindo agora).
   */
  semPergunta?: true;
};

export type Urgencia = {
  tipo: TipoDeUrgencia;
  /** O primeiro sinal do tipo que venceu (so para teste; nunca para log). */
  sinal: string;
};

/**
 * Revisao R2 de d1a15f6 (A3): a negacao DENTRO do sinal com as abreviacoes do
 * WhatsApp ("n consigo respirar", "nn", "naum"; o "ñ" vira "n" na leitura).
 */
const NAO = "(?:nao|nem|n|naum)";

/** "ar condicionado", "ar livre": nao e o ar de respirar. */
const NAO_E_O_AR_DE_RESPIRAR =
  "(?!\\s?-?condicionad|\\s?cond\\b|\\s(?:livre|puro|fresco|quente|frio|seco|umido)\\b)";

/**
 * Quem esta "sem ar" e o lugar (a sala sem ar condicionado). Sem o "ai":
 * "ai, to sem ar" e de dor.
 */
const LUGAR_SEM_AR =
  "\\b(?:sala|salas|clinica|consultorio|recepcao|predio|espera|voces|vcs|vc|lugar|local|loja)\\b(?:\\s+(?!(?:to|tou|estou|fiquei|fico|ficou|ficamos|ela|ele|eu|me|minha|meu)\\b)\\S+){0,3}\\s*$";

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
  "(?!(?: (?:aqui|ja|ate|so|literalmente))? de (?:tanto|rir|vergonha|fome|sede|calor|frio|saudade|saudades|medo|tedio|sono|inveja|preguica|cansaco|curiosidade|amor|amores|ciume|raiva|susto|felicidade|alegria|emocao|orgulho|chorar|vontade|ansiedade|nervoso|dor de cabeca)\\b)";

/**
 * Revisao de 6eae43d (M2): "morrendo DE DOR" ("to morrendo de dor nas
 * costas", "de colica", "de dor de dente") e a dor, sinal fisico que o
 * "sintoma" do portao ja escala (a dor no peito tem sinal proprio). So no
 * "morrendo" (fisico): o "quero morrer de dor" continua risco de vida (o lado
 * conservador).
 */
const MORRENDO_DE_DOR =
  "(?! de (?:dor|dores|dorzinha|colica|colicas|enxaqueca|dente|dentes|tpm)\\b)";

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
  "(?:preco|precos|valor|valores|conta|contas|boleto|boletos|fatura|faturas|parcela|parcelas|juros|divida|dividas|aluguel|orcamento|gasto|gastos|dieta|dietas|regime|academia|treino|treinos|malhacao|corida|trabalho|trabalhos|servico|emprego|chefe|patrao|patroa|faculdade|escola|prova|provas|estudo|estudos|marido|esposo|esposa|namorado|namorada|noivo|noiva|calor|frio|transito|fila|filas|espera|demora|engarafamento" +
  // Revisao de 6eae43d (M2): a queixa ESTETICA ("essas rugas estao me
  // matando", "essa papada ta me matando kkk").
  "|ruga|rugas|ruguinha|ruguinhas|linha|linhas|vinco|vincos|papada|flacidez|estria|estrias|olheira|olheiras|acne|espinha|espinhas|cravo|cravos|melasma|mancha|manchas|celulite|celulites|gordura|gordurinha|gordurinhas|bariga|bariguinha|pochete|culote|culotes|cabelo|cabelos|calvicie|careca|caspa|pelinho|pelinhos|buco|bigode|sobrancelha|sobrancelhas|oleosidade|poro|poros|cicatriz|cicatrizes|veruga|verugas|nariz|queixo|bochecha|bochechas|pele|cutis|quilo|quilos|quilinhos|kilos|unha|unhas" +
  // e a DOR (fisica, nunca risco de vida: o "sintoma" do portao escala a dor
  // forte): "essa dor nas costas ta me matando", "essa colica", "essa
  // enxaqueca". A dor emocional ("essa dor na alma", "a dor dessa perda",
  // "dor de cotovelo") e o sofrimento, e continua. Sem o "pelo" ("pelo
  // jeito isso vai me matar" e o pronome).
  "|(?:dor|dores|dorzinha)(?!(?: \\S+){0,3} (?:emocional|alma|coracao|perda|luto|saudade|saudades|separacao|psicologic\\w*|tristeza|solidao|abandono|traicao|rejeicao|amor|cotovelo|vazio|angustia|culpa|morte|falecimento|partida|dentro)\\b)|enxaqueca|enxaquecas|colica|colicas|dente|dentes|siso|joelho|joelhos|coluna|costas|lombar|hernia|ciatico|gastrite|refluxo|azia|coceira|alergia|rinite|sinusite|tendinite|bursite|artrose|artrite|fibromialgia|pescoco|ombro|ombros|joanete|varizes|hemoroida|hemoroidas|tose|garganta|ouvido|labirintite|torcicolo|cervical|cistite|herpes|micose)";

/**
 * Revisao R2 de d1a15f6 (M4): a AMEACA de verdade. A fala ou a ameaca de
 * outra pessoa ("disse que vai me matar", "ameacou me matar", "ta me
 * ameacando"), a arma ("ele ta com uma faca"), a agressao ("ta me batendo",
 * "me bateu", "de pancada"), a policia e o medo dela: o sujeito concreto
 * ("meu marido vai me matar") deixa de ser o exagero e a conversa volta a
 * passar como urgencia.
 */
const AMEACA_DE_VERDADE =
  "\\b(?:dise|falou|fala|diz|dizendo|disendo|jurou|prometeu|avisou|escreveu|gritou|gritando|mandou mensagem)(?: \\S+){0,2}? (?:que|q) (?:vai|ia|iria|vao|quer) (?:me |te |nos )?mat\\w*" +
  "|\\b(?:ameacou|ameaca|ameacando|ameacava|tentou|tentando|tenta|tentaram|quer|queria) (?:de )?(?:me |nos )?mat(?:ar|a)\\b|\\b(?:me|nos) ameac\\w*|\\bameacas? de morte\\b" +
  "|\\b(?:faca|facas|facao|arma|armas|armad[oa]|revolver|pistola|espingarda|canivete|machado)\\b" +
  "|\\b(?:me|nos) (?:bat\\w*|agred\\w*|espanc\\w*|esgan\\w*|empurou|empurando|chutou|chutando|amarou|trancou)\\b|\\b(?:bateu|batendo|agrediu|agredindo|espancou|espancando) (?:em )?(?:mim|nos)\\b|\\bde (?:pancada|porada|soco|socos|tapa|muro|faca|tiro)\\b|\\b(?:me|nos) (?:deu|dando|da) (?:uma |um )?(?:pancada|soco|tapa|muro|chute|sura)\\b" +
  "|\\b(?:policia|190|180|delegacia|medida protetiva)\\b|\\bmedo (?:dele|dela|de apanhar)\\b|\\b(?:me escondi|me tranquei|escondid[oa] (?:dele|dela))\\b";

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
 * Revisao de 6eae43d (M1): junto da boca ou do rosto torto, a queixa de
 * OUTRO membro ou do corpo (o braco, a perna, um lado do corpo, a dormencia,
 * o formigamento, a fraqueza, "sem forca"), da FALA ("fala estranha",
 * "enrolada") e a dor de cabeca FORTE: os sinais de AVC juntos, que nem o
 * procedimento nem a estetica apagam. Sem QUEIXA_DO_CORPO (que tem a boca, o
 * rosto e o torto do proprio sinal): a dormencia e o formigamento so contam
 * fora do rosto e da boca ("a boca ficou torta e dormente" depois do
 * preenchimento e a anestesia, continua efeito do procedimento).
 */
const OUTRO_SINAL_DE_AVC =
  "\\b(?:braco|bracos|perna|pernas|lado do corpo|metade do corpo|lado (?:esquerdo|direito) do corpo)\\b" +
  "|(?<!\\b(?:boca|labio|labios|rosto|face|bochecha|bochechas|queixo|nariz|testa|gengiva|lingua|regiao|local)(?: \\S+){0,4} )\\b(?:dormente|dormentes|dormencia|formigando|formigamento|formigamentos|adormecid[oa]s?)\\b" +
  "|\\b(?:fraqueza|fraquezas|sem forca|perdi a forca|perdeu a forca)\\b" +
  "|\\b(?:fala|falando|voz) (?:\\S+ ){0,2}?(?:estranha|estranho|enrolad[oa]|arastad[oa]|esquisit[oa]|embolad[oa]|diferente|mole|torta|erad[oa])\\b" +
  "|\\b(?:nao|nem) (?:consigo|consegue|to conseguindo|tou conseguindo|estou conseguindo|ta conseguindo|esta conseguindo) (?:mais )?falar\\b|\\benrolando (?:a lingua|pra falar|as palavras)\\b" +
  "|\\b(?:(?:muita|forte|fortisima|intensa|terivel|horivel|insuportavel) dor de cabeca|dor de cabeca (?:muito |bem |super |tao )?(?:forte|fortisima|intensa|terivel|horivel|insuportavel|absurda)|pior dor de cabeca)\\b";

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
  "\\b(?:remarcar|remarca|remarque|remarcacao|desmarcar|desmarca|desmarque|cancelar|cancela|cancele|cancelamento|reagendar|reagenda|reagende|reagendamento|adiar|adia|adie|(?:mudar|trocar|transferir) (?:a|o|minha|meu) (?:consulta|horario|data|dia|agendamento)|(?:nao|nem) (?:vou|vai|irei|poso|poderei|consigo|vou conseguir|vou poder|vamos poder|vamos conseguir|da pra|deu pra|dara pra|pude|consegui) (?:mais )?(?:ir|comparecer|chegar|vir|estar ai|estar la|estar presente)|(?:vou|vou ter que|vou precisar|preciso|tenho que) faltar|faltar (?:a|na) consulta" +
  // Revisao de 6eae43d (M2): o pedido de HORARIO ou de ENCAIXE ("e uma
  // emergencia! Preciso de um horario pra amanha, tenho casamento", "tenho
  // uma emergencia estetica, preciso de um horario hoje"). Sem a consulta e
  // o atendimento ("preciso de atendimento" pode ser o pedido de ajuda).
  "|(?:preciso|precisava|precisaria|precisamos|queria|quero|gostaria) (?:muito )?(?:de )?(?:um |uma |algum |alguma )?(?:horario|horarios|encaixe|vaga|vaguinha|agendar|marcar|agendamento|encaixar)|(?:tem|teria|tem como|consegue|conseguem|voces tem|vcs tem|consigo) (?:um |uma |algum |alguma )?(?:horario|encaixe|vaga|vaguinha|encaixar)|(?:pode|podem|poderia|poderiam|da pra|daria pra|consegue|conseguem|conseguiria|tem como) (?:me )?(?:marcar|encaixar|agendar|remarcar)|(?:me )?encaixa(?:r)? (?:hoje|amanha|ainda hoje|esa semana|esta semana|nesta semana|nesa semana))\\b";
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

/**
 * A terceira pessoa na mensagem: o procedimento nao e o da propria pessoa.
 * Revisao R2 de d1a15f6 (A1): tambem sem o possessivo ("a boca da mae"), os
 * outros parentes ("vovo", "esposo", "cunhada") e "nele", "nela".
 */
const PARENTE =
  "(?:mae|mamae|pai|papai|avo|vo|vovo|vozinha|vozinho|filha|filho|irma|irmao|tia|tio|titia|titio|esposa|esposo|marido|mulher|namorada|namorado|noiva|noivo|amiga|amigo|vizinha|vizinho|sogra|sogro|prima|primo|bebe|neta|neto|nora|genro|cunhada|cunhado|enteada|enteado|madrasta|padrasto|companheira|companheiro|paciente)";
const TERCEIRA_PESSOA = `\\b(?:ela|ele|elas|eles|dela|dele|delas|deles|nela|nele|nelas|neles|(?:minha|meu|sua|seu|nosa|noso) ${PARENTE}|d[oa] ${PARENTE}|a paciente|o paciente|a crianca)\\b`;

/**
 * O procedimento antigo (nao recente): anos ou meses atras e, na revisao R2
 * de d1a15f6 (M2), "faz tempo" ("ja fiz faz tempo").
 */
const TEMPO_ANTIGO =
  "\\b(?:(?:ha|faz|tem) (?:\\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|alguns|algumas|uns|umas|muitos|muitas|varios|varias|mais de \\S+) (?:anos?|meses|mes)|(?:ano|mes) pasado|(?:anos|meses) atras|em (?:19|20)\\d\\d|(?:ha|faz|tem) (?:muito |bastante )?tempo)\\b";

/**
 * A excecao do procedimento (D-51: o efeito do procedimento continua
 * "sintoma", sem a marca): na MESMA mensagem do sinal, na primeira pessoa e
 * recente. O que nunca se apaga ("de repente", "acordei" e, no rosto, "de um
 * lado" e "metade") fica em semExcecaoCom, lido na rajada inteira.
 */
const PROCEDIMENTO_NA_MESMA_MENSAGEM = `^(?!.*${TERCEIRA_PESSOA})(?!.*${TEMPO_ANTIGO})(?=.*(?:${PROCEDIMENTO_FEITO}))`;

/**
 * Revisao R2 de d1a15f6 (A1): o OBJETO estetico, o nome do procedimento da
 * estetica do rosto. O verbo generico sozinho ("quero tratar", "vou fazer
 * uma consulta", "tem como resolver?", "quanto custa o tratamento?") nunca e
 * estetica: a boca torta continua urgencia (63 das 100 frases da matriz do
 * revisor tinham ficado de fora so com o verbo).
 */
const OBJETO_ESTETICO =
  "(?:botox|toxina|botulinica|prenchimento|prenchimentos|prencher|harmonizacao|harmonizar|fios|fio de pdo|fios de pdo|lifting|bichectomia|bioestimulador|bioestimuladores)";

/**
 * O PEDIDO de procedimento ESTETICO na mesma mensagem (revisao de 6eae43d,
 * M2; refeito na revisao R2 de d1a15f6, A1): o pedido COM o objeto ("quero
 * fazer preenchimento", "queria harmonizar", "da pra corrigir com botox?",
 * "preenchimento resolve?", "quanto custa o botox?", "voces fazem fios?") ou
 * o pedido estetico explicito ("deixar simetrico", "corrigir a assimetria").
 * Sem a negacao logo antes ("nao quero fazer botox").
 */
const PEDIDO_DE_PROCEDIMENTO =
  `(?<!\\b(?:nao|nem|nunca|jamais|n) )\\b(?:quero|queria|gostaria de|pretendo|penso em|pensando em|vou|preciso|precisava|tenho vontade de)(?: (?:fazer|colocar|aplicar|por|botar|um|uma|o|a|uns|umas))*? ${OBJETO_ESTETICO}\\b` +
  `|\\b(?:da|daria|tem como|e posivel|consigo|consegue|conseguem|voces conseguem|vcs conseguem)(?: (?:pra|para|de))?(?: (?:corigir|arumar|melhorar|resolver|tratar|disfarcar|ajeitar))? (?:com|usando|fazendo) (?:o |a |um |uma )?${OBJETO_ESTETICO}\\b` +
  `|\\b${OBJETO_ESTETICO}(?: \\S+){0,2}? (?:resolve|resolveria|corige|corigiria|ajuda|ajudaria|melhora|melhoraria|funciona|funcionaria|da jeito)\\b` +
  `|\\bquanto (?:custa|fica|sai|e|seria|cobra|cobram)(?: (?:o|a|um|uma))? ${OBJETO_ESTETICO}\\b` +
  `|\\b(?:voces|vcs|vc) (?:fazem|faz|tem|aplicam|trabalham com)(?: (?:o|a))? ${OBJETO_ESTETICO}\\b` +
  "|\\b(?:deixar|ficar|fique|deixe) (?:\\S+ ){0,2}?simetric[oa]s?\\b|\\bcorigir (?:a |esa |esta |minha |uma )?asimetria\\b";

/**
 * Revisao de 6eae43d (M2), refeito na revisao R2 de d1a15f6 (A1): o sorriso
 * da propria pessoa, no estado de SEMPRE ("minha boca fica torta quando eu
 * sorrio"): a assimetria do movimento, a estetica. So o sorriso (a fala,
 * "quando eu falo", pode ser o AVC) e so com o "fica" (o "ficou", o "ta" e
 * o "entortou" sao a mudanca, a urgencia).
 */
const NO_SORRISO =
  "\\b(?:(?:quando|so quando|na hora que|na hora de|ao) (?:eu )?(?:sorio|sori|sorir|rio|dou risada|dar risada)|(?:no|meu|o|do|ao) soriso|sorindo)\\b";
const FICA_TORTA = "\\bfica(?:m)? (?:\\S+ )?tort[oa]s?\\b";

/**
 * Revisao R2 de d1a15f6 (A1): o que NUNCA e estetica na boca e no rosto, em
 * qualquer ponto da mensagem: o agora ("agora", "hoje", "ontem", "acordei",
 * "de repente", "do nada"), o lado ("de um lado", "do lado esquerdo") e a
 * queda ("caiu"). Com eles (ou com a terceira pessoa), nem o pedido nem o
 * sorriso apagam a urgencia.
 */
const AGORA_NA_BOCA_OU_NO_ROSTO =
  "\\b(?:agora|agr|agorinha|hoje|hj|ontem|anteontem|de manha|esta manha|esa manha|esta noite|esa noite|de madrugada|desde cedo|acordei|acordou|acordamos|de repente|derepente|do nada|subitamente|de um lado|so de um lado|do lado (?:esquerdo|direito)|caiu)\\b";

/**
 * Revisao de 6eae43d (M2), refeito na revisao R2 de d1a15f6 (A1): a EXCECAO
 * ESTETICA da boca e do rosto, na mesma mensagem: o pedido de procedimento
 * estetico (com o objeto) ou o sorriso de sempre. Nunca com o procedimento
 * ja feito na mensagem (esse e o efeito do procedimento, que tem regra
 * propria), a terceira pessoa ("a boca da minha mae ficou torta, quero
 * fazer preenchimento"), o agora, o lado ou a queda. "De repente", o outro
 * membro e a fala (semExcecaoCom) desfazem tambem na rajada. "Mais caido" e
 * "meio torta" sozinhos NAO sao estetica.
 */
const ESTETICA_NA_MESMA_MENSAGEM = `^(?!.*(?:${PROCEDIMENTO_FEITO}))(?!.*${TERCEIRA_PESSOA})(?!.*${AGORA_NA_BOCA_OU_NO_ROSTO})(?:(?=.*(?:${PEDIDO_DE_PROCEDIMENTO}))|(?=.*${FICA_TORTA})(?=.*${NO_SORRISO}))`;

/**
 * Revisao de 6eae43d (A1): de quem e a boca ou o rosto ("a boca DO MEU PAI
 * ficou torta", "o rosto DA MINHA MAE entortou").
 */
const DE_QUEM =
  "(?: d[oa]s? (?:(?:minha|meu|minhas|meus|sua|seu|nosa|noso) )?[a-z]+)?";

/** A pessoa de quem e o rosto (o rosto DELA caiu). */
const DE_OUTRA_PESSOA =
  "(?:dela|dele|d[oa] (?:minha |meu |sua |seu )?(?:mae|mamae|pai|papai|avo|vo|vovo|filha|filho|irma|irmao|tia|tio|esposa|marido|mulher|namorada|namorado|amiga|amigo|vizinha|vizinho|sogra|sogro|bebe|neta|neto|crianca|paciente))";

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
  "(?:tendo|dando|acho que|acho q|achamos que|achamos q|acha que|acha q|acredito que|acredito q|creio que|parece|pode ser|sera que|sera q|deve ser|nao sei se|suspeita de|suspeito de|com cara de|sintomas de|sinais de|acabou de ter|acabei de ter|acabaram de ter|acabou de sofrer|acabei de sofrer)";
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

/** Revisao R2 de d1a15f6 (A3): a crise epileptica (o nome, com o agora). */
const CRISE_EPILEPTICA =
  "(?:crise|ataque) (?:epilet\\w*|epilept\\w*|convulsiv\\w*)";

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
 * Revisao R2 de d1a15f6 (M4: a regra que generalizou): a informacao so PERTO
 * do nome do evento, ate cinco palavras antes e sem o " e " no meio ("o
 * botox pode ser a causa de um AVC?", "historico familiar de infarto"). Antes
 * valia em qualquer ponto da oracao: "meu pai tem historico de AVC e acho que
 * ta tendo outro AVC" perdia o segundo.
 */
const INFORMACAO_PERTO_DO_EVENTO = `(?:${INFORMACAO_SOBRE_O_EVENTO})(?: (?!e\\b)\\S+){0,5}?\\s*$`;

/**
 * Revisao R2 de d1a15f6 (M4: a regra que generalizou): o nariz ENTUPIDO ou o
 * nariz como sujeito, logo antes do sinal ("o nariz dele ta entupido e ele
 * nao respira", "meu nariz nao esta respirando direito"), nao o nariz em
 * qualquer ponto da oracao ("bateu o nariz e nao respira" e urgencia).
 */
const NARIZ_ENTUPIDO =
  "\\bnariz\\b(?: \\S+){0,3}? (?:entupid[oa]|tapad[oa]|fechad[oa]|obstruid[oa]|congestionad[oa]|escorendo|sujo)\\b|\\bnariz\\b(?: (?!e\\b)\\S+)?\\s*$";

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

/**
 * O querer da propria pessoa ("queria dormir e nao acordar mais"). Revisao
 * R2 de d1a15f6 (A3): com o "k" e o "q" ("kero", "qro", "qria").
 */
const QUERER =
  "(?:quero|qro|kero|kro|qero|queria|qria|keria|kria|qeria|quis|vontade de|so quero|so queria|preferia|prefiro|desejo|desejava|gostaria de|penso em|pensei em|pensando em|to querendo|tou querendo|estou querendo)";

/**
 * Revisao R2 de d1a15f6 (A3): o verbo que pede o infinitivo, para a grafia
 * sem o "r" final ("vou me mata", "vou pula da ponte", "vou tira minha
 * vida", "vou acaba com tudo"). So depois dele: "ela me mata de rir" e
 * "isso me mata" nao sao o infinitivo.
 */
const AUXILIAR_DO_INFINITIVO = `(?:vou|vo|vai|vamos|ia|iria|${QUERER}|quer|decidi|resolvi|decidiu|resolveu|preciso|devia|deveria|tentar|tentei|tentou|tenta|tentando|ameacou|ameaca|ameacando)`;

/** O fim da oracao logo depois do sinal (ou o "e" que abre outra). */
const FIM_LOGO_DEPOIS = "(?=\\s*$|\\s*[.!?,;:]|\\s+(?:e|nem)\\b)";

/**
 * Revisao de 6eae43d (M2): a falta de ar que vem com o esforco ou a
 * situacao de sempre, logo depois do sinal ("tenho falta de ar quando subo
 * escada", "fico sem ar quando corro"): a condicao contada, nao a crise
 * agora (o "sintoma" do portao continua escalando).
 */
/**
 * Revisao R2 de d1a15f6 (alarme falso seguro): a FIGURA do preco e do
 * resultado na falta de ar ("o preco me deixou sem ar kkkk", "fiquei sem
 * folego com o preco", "fiquei sem ar quando vi o resultado do botox") e o
 * riso ("sem ar de tanto rir"). O pedido de ajuda e a piora desfazem.
 */
const FIGURA =
  "(?:preco|precos|valor|valores|orcamento|orcamentos|conta|boleto|fatura|parcela|parcelas|resultado|resultados|foto|fotos|noticia|surpresa|beleza|video)";
const FIGURA_ANTES = `\\b${FIGURA}\\b(?: \\S+){0,2}? (?:me |nos )?deixou\\s*$`;
const FIGURA_DEPOIS = `^\\s*(?:(?:com|de|quando (?:eu )?vi|ao ver|so de ver|depois que (?:eu )?vi) (?:o |a |os |as |ese |esa |este |esta |tanto |tanta |tamanho |tamanha )?${FIGURA}\\b|de (?:tanto )?rir\\b)`;
const PIOROU_OU_SOCORO =
  "\\b(?:de repente|derepente|do nada|piorou|piorando|cada vez pior|nao pasa|nao para|socoro|me ajud\\w*|samu|192)\\b";

const FALTA_DE_AR_DE_SEMPRE =
  "^(?:\\s+\\S+){0,3}?\\s+(?:quando|sempre que|toda vez que) (?:eu )?(?:subo|subir|coro|corer|ando|andar|caminho|caminhar|faco (?:exercicio|esforco|academia|atividade)|pratico|treino|treinar|malho|malhar|me esforco|danco|nado|pedalo|deito|durmo|fico nervos[oa]|fico ansios[oa])\\b";

/**
 * Revisao de 6eae43d (A1): o que aconteceu com a pessoa antes de ela nao
 * responder ("caiu", "desmaiou", "bateu a cabeca", "ta roxa"). "Minha mae
 * nao esta respondendo" sozinho e, na recepcao, a mensagem que ela nao
 * respondeu ("vou confirmar com minha mae, ela nao esta respondendo").
 */
const O_QUE_ACONTECEU =
  "(?:caiu|desmaiou|apagou|bateu a cabeca|pasou mal|engasgou|convulsionou|tombou|(?:ta|tah|esta|ficou|ficando) (?:toda |todo |meio )?rox[oa])";

/**
 * Revisao de 6eae43d (A1): a pessoa da familia (ou o bebe, a crianca) que
 * nao responde ("meu pai nao esta respondendo"). Na recepcao, e a mensagem
 * que ela nao respondeu ("vou confirmar com minha mae, ela nao esta
 * respondendo"): o assunto da recepcao na mesma mensagem tira, e o que
 * aconteceu, o socorro e o pedido de ajuda devolvem.
 */
const QUEM_DA_FAMILIA =
  "(?:(?:a |o )?(?:minha|meu) (?:mae|mamae|pai|papai|avo|vo|vovo|filha|filho|marido|esposa|esposo|mulher|irma|irmao|tia|tio|sogra|sogro|bebe|neta|neto|companheira|companheiro)|a crianca|o bebe|a bebe)";
const ASSUNTO_DA_RECEPCAO =
  "\\b(?:confirm\\w*|avis\\w*|retorn\\w*|tent\\w* de novo|depois (?:eu )?(?:te |lhe )?(?:falo|aviso|chamo|mando|confirmo|respondo)|lig\\w*|telefon\\w*|mensag\\w*|msg|whats\\w*|zap\\w*|email|e-mail|horario|horarios|consulta|consultas|agend\\w*|remarc\\w*|desmarc\\w*|cancel\\w*|marcar|marcacao|pagamento|pix|boleto|cadastro)\\b";

/** O objeto da mensagem ("nao responde as mensagens", "o whatsapp"). */
const SEM_OBJETO_DE_MENSAGEM =
  "(?! (?:(?:a|as|o|os|minha|minhas|meu|meus|sua|suas|seu|seus|nas|nos|no|na) )?(?:mensagem|mensagens|msg|msgs|whats\\w*|zap\\w*|ligac\\w*|telefone|telefonema|celular|e-?mail|email|direct|dm|chamada|chamadas|audio|audios|voces|vcs|ninguem|a gente|recado|recados)\\b)";

/**
 * Revisao de 6eae43d (A1): o braco, a perna e a mao (a fraqueza de um
 * membro). Sem o dedo, a testa e a boca ("nao consigo mexer a testa" depois
 * do botox e o efeito esperado).
 */
const MEMBRO =
  "(?:braco|bracos|perna|pernas|mao|maos|pe|pes|lado (?:esquerdo|direito)(?: do corpo)?|lado do corpo|metade do corpo|corpo)";
const FRACO =
  "(?:fraco|fraca|fracos|fracas|sem forca|paralisad[oa]s?|dormente|dormentes|formigando|adormecid[oa]s?)";
const DE_REPENTE = "(?:de repente|derepente|do nada|subitamente)";

/**
 * Revisao de 6eae43d (A1): o remedio tomado (ou que a pessoa quer tomar)
 * em QUANTIDADE. O numero so de 3 para cima (1 ou 2 comprimidos e a dose de
 * sempre); a cartela, a caixa, o frasco, o vidro, "todos", "varios", "um
 * monte de". Sem a gota, o mg e o ml (a dose de gotas nao se conta assim).
 */
const TOMAR =
  "(?:tomei|tomou|tomamos|tomaram|tomando|engoli|engoliu|engolimos|engoliram|engolindo|ingeri|ingeriu|ingerimos|ingeriram|ingerindo|(?:vou|vo|quero|queria|vontade de|penso em|pensei em|pensando em|decidi|resolvi|ameacou|ameaca|vai|ia) (?:tomar|engolir))";
const NUMERO_DE_SOBRA =
  "(?:[3-9]|[1-9]\\d+|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezeseis|dezesete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sesenta|setenta|oitenta|noventa|cem)";
/**
 * O recipiente do remedio. Revisao R2 de d1a15f6 (M5): nos dois generos ("um
 * vidro de remedio", "o frasco inteiro", "a cartela"): antes, so o artigo
 * feminino ("tomei um vidro de remedio" ficava de fora).
 */
const RECIPIENTE =
  "(?:cartela|cartelas|caixa|caixas|caixinha|frasco|frascos|vidro|vidros|vidrinho|pote|potes|potinho|tubo|tubos|blister|envelope|envelopes)";
const MUITO_REMEDIO = `(?:(?:uns |umas |mais de |quase |cerca de )?${NUMERO_DE_SOBRA}|(?:a|as|o|os|um|uma|uns|umas|dois|duas|tres|meu|minha|meus|minhas|ese|esa|aquele|aquela|tod[oa] (?:o|a)|tod[oa]s (?:os|as)) ${RECIPIENTE}(?: (?:inteira|inteiras|toda|todas|inteiro|inteiros|todo|todos|cheia|cheio))?|(?:todos|todas)(?: (?:os|as))?(?: (?:meus|minhas|seus|suas))?|varios|varias|muitos|muitas|um monte de|monte de|um punhado de|uma porada de|um tanto de|um bocado de)`;
const REMEDIO =
  "(?:comprimido|comprimidos|remedio|remedios|pilula|pilulas|capsula|capsulas|medicamento|medicamentos|calmante|calmantes|rivotril|clonazepam|diazepam|alprazolam|frontal|lexotan|zolpidem|paracetamol|tylenol|dipirona|dorflex|antidepresivo|antidepresivos|xarope|xaropes)";

/**
 * Revisao R2 de d1a15f6 (M5): o recipiente INTEIRO sem o nome do remedio
 * ("tomei a caixa inteira", "o bebe tomou o xarope inteiro"). A comida e a
 * bebida ("tomei o pote inteiro de sorvete") nao contam.
 */
const NAO_E_REMEDIO =
  "(?! d[eoa]s? (?:agua|suco|leite|cerveja|refri\\w*|chocolate|bombo\\w*|chiclete|balas?|biscoito\\w*|bolacha\\w*|cha|cafe|vinho|sorvete|iogurte|acai|doces?|pipoca|salgadinho\\w*|cereal|whey|proteina|creatina)\\b)";
const UNIDADE_DE_DOSE =
  "(?:gota|gotas|gotinha|gotinhas|mg|ml|miligrama|miligramas|mililitro|mililitros|grama|gramas|dose|doses|colher|colheres|jato|jatos|borifada|borifadas)";

/**
 * O tratamento de sempre, logo depois do remedio ("tomei 3 comprimidos por
 * dia", "tomei todos os remedios que a doutora passou", "certinho"): nao e o
 * remedio de uma vez. "De uma vez" (DE_UMA_VEZ) desfaz.
 */
const TRATAMENTO_DE_SEMPRE =
  "^(?:\\s+\\S+){0,4}?\\s+(?:por dia|ao dia|por semana|na semana|a cada|de \\d+ em \\d+|de (?:quatro|seis|oito|doze) em (?:quatro|seis|oito|doze)|diariamente|todo dia|todos os dias|durante (?:\\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|dez|quinze|trinta) (?:dias|semanas|meses)|conforme|como (?:\\S+ ){0,2}?(?:pediu|mandou|orientou|receitou|pasou|indicou|prescreveu)|que (?:\\S+ ){0,2}?(?:pasou|pasaram|receitou|receitaram|prescreveu|prescreveram|indicou|indicaram|mandou|mandaram|pediu|pediram|recomendou|recomendaram)|certinho|direitinho|na hora certa|no horario|nos horarios|ate o (?:fim|final)|(?:d[oa]s?|de) (?:antibiotico\\w*|anticoncepcional\\w*|vitamina\\w*|suplemento\\w*|colageno|fero|tratamento|receita|ciclo))\\b";
const DE_UMA_VEZ =
  "\\b(?:de uma (?:so )?vez|tudo junto|(?:todos|todas) junt[oa]s|pra (?:morer|sumir|nao acordar|acabar com tudo))\\b";
const REMEDIO_EM_EXCESO = `\\b(?:[1-9]\\d+|dez|onze|doze|treze|catorze|quatorze|quinze|dezeseis|dezesete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sesenta|setenta|oitenta|noventa|cem)(?: \\S+){0,2}? ${REMEDIO}\\b|\\b${RECIPIENTE} (?:inteir[oa]s?|tod[oa]s?|cheio|cheia)\\b|\\b(?:inteir[oa]|tod[oa]) (?:a|o) ${RECIPIENTE}\\b`;

/**
 * Revisao de 6eae43d (A1): o que se engole por engano ou de proposito e
 * envenena ("engoli um produto de limpeza", "bebeu agua sanitaria", "tomei
 * veneno"). Sem o "banho" no meio ("tomei banho de..."), sem o acido e a
 * acetona (da estetica: "tomei sol depois do acido") e sem a figura ("tomei
 * refrigerante, que e veneno").
 */
const VENENO =
  "(?<!\\b(?:e|eh|sao|era|e um|e uma|sao um) )(?:produto de limpeza|produtos de limpeza|veneno|venenos|veneno de rato|mata rato|agua sanitaria|alvejante|desinfetante|soda caustica|chumbinho|raticida|inseticida|formicida|pesticida|agrotoxico|querosene|gasolina|solvente|thiner|removedor|detergente|amonia)";

/**
 * Revisao de 6eae43d (A1): a perda da visao. O olho com o oculos, a lente e
 * o grau ("nao estou enxergando bem de longe") e o oftalmologista sao a
 * vista de sempre, nao a perda agora. O texto da tela ("nao estou
 * enxergando o link") e a mensagem, nao a visao.
 */
const VISTA_DE_SEMPRE_DEPOIS =
  "^\\s*(?:(?:muito |tao )?(?:bem|direito) )?(?:de (?:longe|perto)|pra ler|para ler|as letras|letra pequena|(?:sem|com) (?:o |os |meu |meus )?oculos|com a idade|com o tempo)\\b";
const VISTA_DE_SEMPRE_NA_MENSAGEM =
  "\\b(?:oftalm\\w*|oculos|lente|lentes|grau|miopia|astigmatismo|hipermetropia|presbiopia|catarata|vista cansada|exame de vista|consulta de vista)\\b";
const TEXTO_DA_TELA =
  "(?! (?:o|a|os|as|um|uma|seu|sua|seus|suas|meu|minha|meus|minhas|ese|esa|eses|esas|este|esta|iso|isto|aquilo|nenhum|nenhuma) (?!(?:lado|metade|olho|olhos|vista)\\b)\\S+)(?! (?:mensagem|mensagens|link|botao|horario|horarios|foto|fotos|imagem|imagens|audio|video|arquivo|pdf|site|ap|aplicativo|tela|letra|letras|texto|endereco|numero|valor|preco|agenda|data|resposta|opcao|opcoes|campo|formulario|pix|boleto|codigo|anexo|diferenca|resultado|resultados|melhora|efeito|mudanca|onde|como|qual|quais)\\b)";

/**
 * A origem da dor no osso, no musculo ou no dente ("dor no ombro que desce
 * pro braco"): nao e a dor do peito que vai para o braco.
 */
const DOR_DO_OSO =
  "(?:ombro|ombros|pescoco|cervical|coluna|costas|lombar|cotovelo|punho|mao|maos|dedo|dedos|tendao|tendinite|bursite|hernia|dente|dentes|siso)";

/**
 * O procedimento ou a cirurgia JA FEITOS (de quem for), para a perda da
 * visao depois dele ("fiz preenchimento e nao estou enxergando direito"): o
 * oculos e o grau na mesma mensagem nao apagam. So citado ("sou cega de um
 * olho, posso fazer botox?") nao conta.
 */
const PROCEDIMENTO_OU_CIRURGIA =
  "(?:botox|toxina|botulinica|aplicacao|aplicacoes|prenchimento|prenchimentos|harmonizacao|bichectomia|procedimento|fios|lifting|bioestimulador|rinomodelacao|lipo\\w*|cirurgia|cirurgias|operacao|anestesia|sedacao|rinoplastia|blefaroplastia|plastica)";
const PROCEDIMENTO_OU_CIRURGIA_FEITOS = `\\b(?:fiz|fez|fizemos|fizeram|operei|operou|apliquei|aplicou|coloquei|colocou|tomei|tomou|fui fazer|foi fazer|acabei de fazer|acabou de fazer|(?:depois|desde|apos) que (?:eu |ela |ele )?(?:fiz|fez|operei|operou|apliquei|aplicou|coloquei|colocou|tomei|tomou))(?: \\S+){0,2}? ${PROCEDIMENTO_OU_CIRURGIA}\\b|\\b(?:meu|minha|meus|minhas) ${PROCEDIMENTO_OU_CIRURGIA}\\b|\\b(?:depois d[oa]s?|apos (?:o|a|os|as)|desde (?:o|a|os|as)|por causa d[oa]s?|no pos (?:operatorio )?d[oa]s?) (?:\\S+ )?${PROCEDIMENTO_OU_CIRURGIA}\\b|\\b${PROCEDIMENTO_OU_CIRURGIA}\\b(?: \\S+){0,2}? (?:deixou|causou|pegou)\\b`;

/**
 * Revisao de 6eae43d (pedido do coordenador): a overdose PERGUNTADA ("o que
 * e overdose de vitamina?", "existe overdose de botox?", "vi uma reportagem
 * sobre overdose") e a informacao, nao o fato. "Falando sobre overdose" (sem
 * a reportagem, o video ou a aula) continua: pode ser a ideia de quem fala.
 */
const OVERDOSE_PERGUNTADA =
  "\\b(?:o que (?:e|eh|sao|seria)|existe|tem como (?:ter|dar)|da pra (?:ter|dar)|pode (?:me )?(?:dar|ter|causar)|podem (?:dar|ter|causar)|poso ter|risco de|riscos de|chance de|chances de|perigo de|como (?:evitar|saber|identificar|reconhecer|e)|qual|quais|(?:reportagem|materia|noticia|artigo|documentario|filme|serie|novela|video|aula|palestra|livro|post|podcast)(?: \\S+){0,2}? (?:sobre|de|com))\\b(?: \\S+){0,3}?\\s*$";

/** A overdose como figura ("overdose de fofura", "de amor", "de cafe"). */
const OVERDOSE_FIGURADA =
  "^\\s*de (?:fofura|beleza|amor|carinho|informac\\w*|alegria|felicidade|cafe|cafeina|chocolate|doce|doces|acucar|serie|series|netflix|compras|treino|treinos|academia|foto|fotos|selfie|selfies|emoc\\w*|trabalho|estudo|estudos|filtro|filtros|maquiagem|skincare|cuidado|cuidados|perfume|gliter|brilho|rosa|fofoca|fofocas|novela|novelas|musica|musicas|meme|memes)\\b";

/**
 * Revisao de 6eae43d (pedido do coordenador): o "tiro" e a "facada" da
 * figura ("o preco foi uma facada", "levei uma facada nesse orcamento") e
 * os disparos do laser ("levei 300 tiros de laser na axila").
 */
const TIRO_FIGURADO_DEPOIS =
  "^\\s*(?:(?:\\S+ ){0,2}?(?:no|na|nese|nesa|neste|nesta|dese|desa|do|da) (?:preco|valor|conta|orcamento|bolso|cartao|fatura|parcela|parcelas|boleto|salario|carteira)|de (?:laser|luz|paintbal|airsoft|festim|espuma|agua))\\b";
const LASER =
  "\\b(?:laser|depila\\w*|luz pulsada|disparo|disparos|sesao|sesoes|ultraformer|hifu|radiofrequencia|fotona)\\b";
/**
 * Os disparos do laser contados ("levei uns 500 tiros na depilacao"): o
 * numero alto (de 10 para cima) e o laser na mesma mensagem. "Meu filho
 * levou um tiro, preciso cancelar a sessao de laser" continua urgente.
 */
const DISPARO_DO_LASER = `^(?=.*\\b\\d{2,} tiros\\b)(?=.*${LASER})`;

/**
 * Revisao de 6eae43d (pedido do coordenador): o PREENCHIMENTO (e a
 * harmonizacao, o bioestimulador, o acido hialuronico, os fios e a
 * rinomodelacao) JA FEITO, de quem for ("fiz preenchimento", "minha mae fez
 * harmonizacao", "depois do bioestimulador", "o preenchimento de ontem", "fiz
 * a boca"). So pedido ("quero fazer preenchimento", "quero preencher o
 * labio") nao conta. A complicacao do preenchimento e A emergencia da
 * clinica de estetica (a oclusao vascular).
 */
// Revisao R2 de d1a15f6 (A3): a giria ("fiz labial", "preench", "fiz rino")
// e o acido no lugar do preenchimento ("coloquei acido no labio", "apliquei
// ah no labio": o "ah" e o acido hialuronico).
const PREENCHIMENTO =
  "(?:prenchimento|prenchimentos|prench|harmonizacao|harmonizacoes|bioestimulador|bioestimuladores|acido hialuronico|hialuronico|fio|fios|rinomodelacao|rinomodelagem|rino|labial|labiais)";
/** Sem o fio (o "meu fio" e tambem o fio de cabelo). */
const PREENCHIMENTO_SEM_FIO =
  "(?:prenchimento|prenchimentos|prench|harmonizacao|harmonizacoes|bioestimulador|bioestimuladores|acido hialuronico|hialuronico|rinomodelacao|rinomodelagem|rino|labial|labiais)";
/** O lugar do rosto onde se poe o preenchimento (sem a pele e a testa: o acido do peeling). */
const LOCAL_DO_PREENCHIMENTO =
  "(?:labio|labios|boca|nariz|olheira|olheiras|bigode chines|queixo|mandibula|glabela|tempora|temporas|maca do rosto|macas do rosto|malar|bochecha|bochechas)";
const PREENCHIMENTO_FEITO = `\\b(?:fiz|fez|fizemos|fizeram|apliquei|aplicou|aplicaram|coloquei|colocou|colocaram|pasei por|pasou por|fui fazer|foi fazer|acabei de fazer|acabou de fazer|(?:depois|desde|apos) que (?:eu |ela |ele )?(?:fiz|fez|apliquei|aplicou|coloquei|colocou))(?: \\S+){0,3}? ${PREENCHIMENTO}\\b|\\b(?:fiz|fez|fizeram) (?:a |o |os |as |um |uma |minha |meu |minhas |meus )?${LOCAL_DO_PREENCHIMENTO}\\b|\\b(?:coloquei|colocou|colocaram|apliquei|aplicou|aplicaram|fiz|fez|injetei|injetou|pasei|pasou)(?: (?:o|um|uma|a))? (?:acido|ah)(?: \\S+){0,2}? (?:no|na|nos|nas|em) (?:\\S+ )?${LOCAL_DO_PREENCHIMENTO}\\b|\\bacido (?:no|na|nos|nas|em) (?:\\S+ )?${LOCAL_DO_PREENCHIMENTO}\\b(?: \\S+){0,2}? (?:ontem|anteontem|hoje|hj)\\b|\\b(?:meu|minha|meus|minhas) ${PREENCHIMENTO_SEM_FIO}\\b|\\b(?:o|os|a|as) ${PREENCHIMENTO_SEM_FIO} (?:de |que (?:eu |ela |ele )?)?(?:ontem|hoje|anteontem|fiz|fez|fizeram)\\b|\\b(?:depois d[oa]s?|apos (?:o|a|os|as)|desde (?:o|a|os|as)|por causa d[oa]s?|no pos d[oa]s?) (?:\\S+ )?${PREENCHIMENTO}\\b|\\b${PREENCHIMENTO_SEM_FIO}\\b(?: \\S+){0,2}? (?:ontem|hoje|anteontem|ha (?:\\S+ )?(?:minuto|minutos|hora|horas|dia|dias))\\b`;

/**
 * Os sinais da oclusao vascular depois do preenchimento: a VISAO embacada,
 * turva, dupla ou escurecendo; a pele ou o labio BRANCO, palido ou
 * esbranquicado, manchado, rendilhado ou frio; o ROXO que espalha ou
 * aumenta (o roxo sozinho e o hematoma: "fiquei com um roxinho", "ficou
 * roxo onde furou"); e a DOR forte no lugar ou que piora ("muito
 * dolorido"; "um pouco dolorido" nao).
 */
const LUGAR_DO_PREENCHIMENTO =
  "(?:pele|labio|labios|boca|nariz|ponta do nariz|ponta|rosto|face|regiao|local|area|bochecha|bochechas|queixo|testa|sulco|sulcos|olheira|olheiras|bigode chines|mandibula|maca do rosto|macas do rosto|tempora|temporas|glabela)";
/**
 * Revisao R2 de d1a15f6: sem o "manchada" sozinho (M2: "fiz harmonizacao ha
 * 2 anos, minha pele ta manchada" e o melasma; a mancha conta com o branco,
 * o palido, o rendilhado, o frio, o roxo que espalha ou a dor forte, que
 * casam sozinhos) e com o escuro e o cinza da necrose (A3: "a ponta ta
 * ficando escura", "acinzentada") e as bolhas.
 */
const COR_DA_ISQUEMIA =
  "(?:branc[oa]s?|branquinh[oa]s?|palid[oa]s?|esbranquicad[oa]s?|descorad[oa]s?|rendilhad[oa]s?|marmorizad[oa]s?|pret[oa]s?|necros\\w*|fri[oa]s?|gelad[oa]s?|escur[oa]s?|escurecid[oa]s?|escurecendo|escureceu|cinza|cinzas|acinzentad[oa]s?|cinzent[oa]s?|bolhas?|bolhinhas?)";
const ROXO =
  "(?:roxo|roxa|roxos|roxas|roxinho|roxinha|aroxead[oa]s?|roxead[oa]s?|mancha roxa|manchas roxas|hematoma|hematomas)";
/** O que fica branco e nao e a pele ("meus dentes estao brancos"). */
const NAO_E_A_PELE =
  "(?:dente|dentes|unha|unhas|cabelo|cabelos|fio|fios|roupa|roupas|camisa|blusa|parede|tela|foto|fotos|papel|lencol|toalha|pomada|creme|curativo|esparadrapo|gaze|algodao|esmalte|quarto|sala|casa|ceu|tempo|dia|noite|rua|luz|ambiente|imagem|video)";
const ESPALHANDO =
  "(?:espalhando|se espalhando|aumentando|crescendo|alastrando|se alastrando|tomando conta)";
const DOR_FORTE =
  "(?:dor|dores|ardencia|ardor|queimacao)(?! de (?:cabeca|dente|garganta|bariga|estomago|ouvido)\\b)(?! nas costas\\b)(?: (?:muito|mto|mt|bem|super|tao|cada vez mais))* (?:forte|fortes|fortisima|intensa|intenso|insuportavel|horivel|terivel|absurda|latejante)" +
  "|(?:muita|tanta|uma baita|forte|fortisima|intensa|insuportavel|horivel|terivel) dor(?! de (?:cabeca|dente|garganta|bariga|estomago|ouvido)\\b)(?! nas costas\\b)" +
  "|(?:doendo|doi|latejando|lateja) (?:muito|demais|dms|horores|absurdo|bastante|mt|mto|cada vez mais|mais e mais|pra caramba)" +
  "|(?:muito|mto|mt|super|tao) dolorid[oa]s?|dolorid[oa]s? demais" +
  "|(?:dor|dores) (?:que )?(?:so )?(?:piora|piorando|aumenta|aumentando|nao pasa|nao para)" +
  "|(?:dor|dores)(?: (?!(?:nao|nem|nunca|jamais)\\b)\\S+){0,3}? (?:ta |esta )?(?:piorando|piorou|aumentando|aumentou)";

/** Revisao R2 de d1a15f6 (M2): a mancha do sol, do melasma e da acne. */
const MANCHA_DE_SEMPRE =
  "(?! (?:\\S+ )?(?:de|do|da|pelo|pela|por causa do|por causa da) (?:sol|melasma|espinha|espinhas|acne|idade|nascenca|sarda|sardas|cravo|cravos)\\b)";

/**
 * Revisao R2 de d1a15f6 (M2): o agora que faz o preenchimento antigo contar
 * ("fiz harmonizacao ha 2 anos e hoje o labio ficou branco"). O querer de
 * agora ("agora quero tratar as manchas") nao e o agora do sintoma.
 */
const AGORA_DA_OCLUSAO =
  "\\b(?:agora|agorinha|agr|hoje|hj|ontem|anteontem|de repente|derepente|do nada|acordei|acordou|ha pouco|faz pouco|acabei de|acabou de)\\b(?! (?:eu )?(?:quero|queria|gostaria|vou|pretendo|penso|preciso|to pensando|estou pensando|resolvi|decidi)\\b)";

/**
 * O preenchimento feito que CONTA (revisao R2 de d1a15f6, M2): feito e, se
 * antigo, com o agora. Lookaheads no comeco do texto.
 */
const PREENCHIMENTO_QUE_CONTA = `(?:(?=.*(?:${PREENCHIMENTO_FEITO}))|(?=.*\\b${PREENCHIMENTO}\\b)(?=.*\\b(?:fiz|fez|apliquei|aplicou|coloquei|colocou) (?:ontem|anteontem|hoje|hj|agora|agorinha|ha pouco)\\b))(?!(?=.*${TEMPO_ANTIGO})(?!.*${AGORA_DA_OCLUSAO}))`;

/**
 * A HISTORIA de outra pessoa (revisao R2 de d1a15f6, M2): quem conta o que
 * soube ("conheco uma moca que ficou cega", "vi no instagram", "li que",
 * "dizem que") e pergunta ("isso e comum?"), sem o relato da propria pessoa
 * ("fiz", "to", "minha visao"), sem a pessoa da familia ("minha amiga fez
 * ontem": o relato presente de outra pessoa conta) e sem o agora. A
 * informacao, nao o caso. Lookaheads no comeco do texto.
 */
const HISTORIA_DE_OUTRA_PESSOA =
  "\\b(?:conheco|conheci|sei de|soube de|ouvi falar de) (?:uma|um|alguem|gente|casos?)\\b|\\b(?:vi|li|asisti)(?: \\S+){0,2}? (?:no|na|num|numa|em|um|uma) (?:instagram|insta|tiktok|youtube|internet|video|videos|reportagem|reportagens|noticia|noticias|post|materia|site|jornal|tv|televisao|rels|grupo|twiter|facebok|kwai)\\b|\\b(?:li|ouvi|vi) (?:que|dizer|falar|falarem|uma historia|um caso|casos|relatos?)\\b|\\b(?:dizem|falam|contam) que\\b";
const RELATO_DA_PROPRIA_PESSOA =
  "\\b(?:fiz|fizemos|apliquei|coloquei|operei|pasei por|fui fazer|acabei de fazer|to|tou|estou|fiquei|minha (?:visao|vista|boca|pele|labio)|meu (?:olho|labio|nariz|rosto)|meus (?:olhos|labios))\\b";
const HISTORIA_DE_INFORMACAO = `(?=.*${HISTORIA_DE_OUTRA_PESSOA})(?=.*[?])(?!.*${RELATO_DA_PROPRIA_PESSOA})(?!.*\\b(?:minha|meu|minhas|meus|nosa|noso) ${PARENTE}\\b)(?!.*${AGORA_DA_OCLUSAO})`;

/**
 * Revisao R2 de d1a15f6 (M4: a regra que generalizou): a vista de sempre (o
 * oculos, o grau, o oftalmologista na mensagem) nao apaga a perda de um olho
 * so nem o apagao ("uso oculos e perdi a visao do olho direito", "uso
 * oculos e minha vista ficou toda preta"), e o agora desfaz as excecoes da
 * visao ("uso oculos e nao to enxergando nada agora"; o "agora quero" nao).
 */
const UM_OLHO =
  "\\b(?:de um olho|de um dos olhos|do olho (?:direito|esquerdo)|de um lado|metade da (?:visao|vista)|tudo (?:preto|escuro)|(?:ficou|ficando|ta|esta) (?:tod[oa] |meio |bem )?(?:preta|escura|apagada)|apagou|sumiu|ceg[oa]s?)\\b";
const VISAO_DE_AGORA =
  "\\b(?:agora|agorinha|agr)\\b(?! (?:eu )?(?:quero|queria|gostaria|vou|pretendo|penso|preciso)\\b)";

/**
 * Revisao R2 de d1a15f6 (M4): a outra pessoa ameacada de morte ("o namorado
 * da minha filha disse que vai matar ela").
 */
const PESSOA_AMEACADA = `(?:ela|ele|eles|elas|a gente|nos|todo mundo|todos|(?:a |o )?(?:minha|meu|nosa|noso|sua|seu) ${PARENTE}|(?:a|o) (?:crianca|bebe|menina|menino))`;

/**
 * Revisao R2 de d1a15f6 (A3): os bichos de veneno (sem a "aranha vascular",
 * os vasinhos da estetica).
 */
const BICHO_PECONHENTO =
  "(?:cobra|cobras|serpente|jararaca|cascavel|coral|escorpiao|escorpioes|aranha|aranhas|armadeira|viuva negra|lacraia)(?! vascula\\w*)";

/** Revisao R2 de d1a15f6 (A3): o que o gas de cozinha faz em quem respira. */
const SINTOMA_DO_GAS =
  "\\b(?:tont[oa]s?|tontura|desmai\\w*|pasando mal|pasou mal|pasei mal|enjoad[oa]s?|enjo|vomit\\w*|dor de cabeca|desacordad[oa]s?|inconsciente|nao acorda|sonolent[oa]s?|falta de ar|sem ar|dificuldade (?:de|pra|para) respirar)\\b";

/**
 * Revisao R2 de d1a15f6 (A3): a gravidez na mensagem ("to gravida", "de 8
 * meses", "gestante") e a gravidez que ja passou ("na minha primeira
 * gravidez", "no parto").
 */
const GESTACAO =
  "\\b(?:gravida|gravidas|gestante|gestantes|gestacao|gravidez|gravidinha|esperando (?:um )?bebe|(?:de|com) (?:\\d+|um|dois|tres|quatro|cinco|seis|sete|oito|nove) (?:meses|semanas)(?: de (?:gravidez|gestacao))?)\\b";
const GESTACAO_PASADA =
  "\\b(?:(?:na|da|nas|em) (?:minha |outra |ultima )?(?:gravidez|gestacao) (?:pasada|anterior)|(?:na|da) (?:minha )?(?:primeira|segunda|terceira|outra|ultima) (?:gravidez|gestacao)|quando (?:eu )?(?:estava|tava|fiquei|tive) gravida|(?:no|depois do|apos o) parto)\\b";

/**
 * A lista PROPOSTA ao RT (D-51; desenho 5.2), com as variacoes de escrita
 * de cada sinal. Fisica primeiro, risco de vida depois.
 */
export const SINAIS_DE_EMERGENCIA: readonly SinalDeEmergencia[] = [
  // ---- respirar -----------------------------------------------------------
  {
    // Revisao de 30/10/2026: "falta di ar" ("tou cum falta di ar"). Revisao
    // de 6eae43d: a falta de ar do esforco de sempre ("tenho falta de ar
    // quando subo escada, posso fazer lipo?") e a condicao, nao a crise.
    nome: "falta_de_ar",
    tipo: "fisica",
    fonte: `\\b(?:falta(?: d[ei])?|faltando|faltou)(?: o)? ar\\b${NAO_E_O_AR_DE_RESPIRAR}`,
    excecaoAntes: FIGURA_ANTES,
    excecaoDepois: `${FALTA_DE_AR_DE_SEMPRE}|${FIGURA_DEPOIS}`,
    semExcecaoCom: PIOROU_OU_SOCORO,
  },
  {
    nome: "sem_ar",
    tipo: "fisica",
    fonte: `\\b(?:sem|perdi o|perdendo o) ar\\b${NAO_E_O_AR_DE_RESPIRAR}${PERGUNTA_DO_LUGAR}`,
    excecaoAntes: `${LUGAR_SEM_AR}|${FIGURA_ANTES}`,
    excecaoDepois: `${FALTA_DE_AR_DE_SEMPRE}|${FIGURA_DEPOIS}`,
    semExcecaoCom: PIOROU_OU_SOCORO,
  },
  {
    // Revisao de 28/10/2026 (lacuna da proposta ao RT): "to sem folego",
    // "falta de folego". O exagero ("sem folego de tanto rir") e o esforco
    // de sempre ("fico sem folego quando subo escada") nao contam.
    nome: "sem_folego",
    tipo: "fisica",
    fonte: "\\b(?:sem|falta d[ei]|faltando|perdi o|perdendo o) folego\\b",
    excecaoAntes: FIGURA_ANTES,
    excecaoDepois: `^\\s*de (?:tanto|rir|felicidade|emocao|alegria|ansiedade)\\b|${FALTA_DE_AR_DE_SEMPRE}|${FIGURA_DEPOIS}`,
    semExcecaoCom: PIOROU_OU_SOCORO,
  },
  {
    nome: "nao_consigo_respirar",
    tipo: "fisica",
    fonte:
      // Revisao R2 de d1a15f6 (A3): "n consigo respirar", "naum", "nao
      // consigo respira".
      `\\b(?:${NAO} (?:consigo|consegui|conseguia|consegue|conseguimos|to conseguindo|tou conseguindo|estou conseguindo|ta conseguindo|esta conseguindo|estava conseguindo|tava conseguindo)|sem conseguir) (?:mais )?respirar?\\b`,
    excecaoNaMensagem: NARIZ_COM_PROCEDIMENTO,
  },
  {
    nome: "dificuldade_para_respirar",
    tipo: "fisica",
    fonte:
      "\\bdificuldades? (?:(?:de|di|para|pra|pa|em|pro) )?respirar?\\b|\\bdificuldade respiratoria\\b|\\brespirando com dificuldade\\b",
    // Revisao de 30/10/2026: o nariz com a rinoplastia na mesma mensagem.
    excecaoNaMensagem: NARIZ_COM_PROCEDIMENTO,
    excecaoDepois: FALTA_DE_AR_DE_SEMPRE,
    semExcecaoCom: PIOROU_OU_SOCORO,
  },
  { nome: "sufocando", tipo: "fisica", fonte: "\\bsufocando\\b" },
  {
    nome: "garganta_fechando",
    tipo: "fisica",
    // Revisao R2 de d1a15f6 (A3): "a garganta ta trancando", "apertando".
    fonte: `\\bgarganta (?:${PALAVRA_DO_MEIO}){0,3}?(?:fechando|fechou|trancando|trancou|apertando|apertou)\\b`,
  },
  {
    // Revisao de 6eae43d (A1, lacuna): "minha mae ta roxa e nao respira",
    // "ela nao respira", "ficou sem respirar". O nariz ("meu filho nao
    // respira pelo nariz, tem otorrino?") nao conta; o "nao respira mais" e
    // o "nao esta respirando" sao da parada.
    nome: "nao_respira",
    tipo: "fisica",
    fonte:
      `\\b${NAO} respira\\b(?! (?:mais )?(?:direito |bem |muito bem )?(?:pelo|pela|com o|com a|por um|de um) (?:nariz|narina|narinas|lado do nariz)\\b)|` +
      "\\b(?:ficou|fiquei|ta|tah|esta|to|tou|estou|tava|estava) sem respirar\\b(?! de (?:tanto|rir|susto|emocao|medo|ansiedade|nervos\\w*)\\b)",
    excecaoAntes: NARIZ_ENTUPIDO,
  },
  // ---- peito e coracao ----------------------------------------------------
  {
    // Revisao de 6eae43d (A1, lacuna): a PRESSAO no peito ("to com uma
    // pressao no peito") e o PESO no peito ("sinto um peso no peito"; sem o
    // "peso do peito" de "tirei um peso do peito", o alivio).
    nome: "dor_no_peito",
    tipo: "fisica",
    fonte: `\\b(?:dor|dores|dorzinha|aperto|apertos|queimacao|queimor|pontada|pontadas|presao|presoes)(?: ${REFORCO_DA_DOR})* (?:(?:no|do|em|nese|neste|aqui no|bem no)(?: meu)?|(?:no|do) (?:lado (?:esquerdo|direito)|meio|centro) do) (?:peito|peitu|peto)\\b|\\bpeso(?: ${REFORCO_DA_DOR})* (?:no|nese|neste|aqui no|bem no)(?: meu)? peito\\b|\\bpeito (?:(?:ta|esta|todo|muito|bem|meio|super|tao|ficou|fica) )*(?:doendo|apertad[oa]|queimando|ardendo)\\b`,
  },
  {
    // Revisao de 6eae43d (A1, lacuna): a dor que vai para o braco, a
    // mandibula ou o queixo ("meu coracao apertado e uma dor que vai pro
    // braco", "dor que desce pro braco esquerdo"). A dor que vem do ombro,
    // do pescoco ou da coluna e a do osso e do musculo ("dor no ombro que
    // desce pro braco"); a que desce pra perna (o ciatico) nao entra.
    nome: "dor_que_vai_pro_braco",
    tipo: "fisica",
    fonte: `\\b(?:dor|dores|dorzinha|pontada|pontadas|aperto|queimacao|formigamento)(?: (?!${DOR_DO_OSO}\\b)\\S+){0,4}? (?:que )?(?:vai|vem|desce|sobe|core|iradia|iradiando|espalha|espalhando|pasa|pasando|indo|descendo|subindo|corendo)(?: \\S+){0,2}? (?:pro|pra|para o|para a|ate o|ate a|pelo|pela|no|na) (?:meu |minha |o |a )?(?:braco|bracos|mandibula|queixo|maxilar)\\b`,
    excecaoAntes: `\\b${DOR_DO_OSO}\\b(?: \\S+){0,4}?\\s*$`,
  },
  {
    // Revisao de 28/10/2026 (lacuna): o infarto AGORA ou a suspeita dele
    // ("to tendo um infarto", "acho que e infarto", "ele ta infartando",
    // "meu pai infartou agora", "teve um infarto hoje"). A historia ("tive
    // infarto ano passado", "meu pai morreu de infarto", "meu pai
    // infartou") e a pergunta ("botox pode causar infarto?") nao contam.
    nome: "infarto",
    tipo: "fisica",
    fonte: `${ANTES_DO_EVENTO}(?:${INFARTO})\\b|${eventoComOAgora(INFARTO)}|\\b(?:infartando|enfartando|infatando|enfatando)\\b|${passadoComOAgora("infartou|enfartou|infartei|enfartei")}`,
    excecaoAntes: INFORMACAO_PERTO_DO_EVENTO,
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
    excecaoAntes: `${INFORMACAO_PERTO_DO_EVENTO}|${NARIZ_ENTUPIDO}`,
  },
  // ---- desmaio, consciencia e convulsao -----------------------------------
  {
    nome: "desmaio",
    tipo: "fisica",
    // Revisao R2 de d1a15f6 (A3): as grafias ("desmaiu", "desmaida", "minha
    // mae desmaio agr") e o desmaio que alguem teve ("teve um desmaio
    // agora"; a historia, "ja tive desmaio", continua de fora). O "quase"
    // ("quase desmaiei quando vi a conta kkk") nao conta, salvo com o mal
    // estar, a tontura, o agora ou o gerundio ("to quase desmaiando").
    fonte: `\\bdesmai(?:ei|ou|u|ando|aram|amos)\\b|\\bdesmai(?:ad|d)[oa]s?\\b|\\b(?:teve|tive|deu|dando|tendo) (?:um |uns )?desmaios?\\b|(?<=\\b${QUEM_APAGOU} )desmaio\\b|\\bdesmaio (?:agora|agr|agorinha|aqui|do nada|de repente|derepente)\\b`,
    excecaoAntes: "\\bquase\\s*$",
    semExcecaoCom:
      "\\b(?:agora|agr|agorinha|tont[oa]s?|tontura|pasando mal|pasei mal|pasou mal|ainda|de novo|socoro|me ajud\\w*|sem ar|falta de ar|dor no peito|desmaiando)\\b",
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
    fonte: `\\b${NAO} (?:acorda|acordou|ta acordando|esta acordando|quer acordar|consegue acordar|consigo acordar|conseguimos acordar|conseguem acordar|consegui acordar)\\b(?! (?:cedo|antes|de manha|a tempo|na hora|no horario|sozinh\\w*|com (?:o )?despertador|(?:pra|para) (?:ir|trabalhar|escola|aula|a escola|a aula))\\b)|\\b(?:nao|nem) (?:reage|reagiu|ta reagindo|esta reagindo)(?=\\s*$|\\s*[.!?,;:]|\\s+(?:e|mais|a nada|de jeito nenhum|quando)\\b)`,
  },
  {
    // Revisao de 6eae43d (A1, lacuna): quem nao responde depois do que
    // aconteceu ("minha mae caiu e nao ta respondendo", "ela ta roxa, nao
    // responde") e quem nao responde a nada ("nao reage quando a gente
    // chama"). A mensagem ("minha filha nao responde minhas mensagens"), a
    // clinica ("voces nao estao respondendo") e "minha mae nao esta
    // respondendo" sozinho (na recepcao, a mensagem que ela nao respondeu)
    // nao contam.
    nome: "nao_responde",
    tipo: "fisica",
    fonte: `\\b${O_QUE_ACONTECEU}(?: \\S+){0,3}?(?:,? e|,) (?:\\S+ ){0,2}?${NAO} (?:(?:ta|tah|esta|tava|estava) )?(?:respondendo|responde|reage|reagindo)\\b${SEM_OBJETO_DE_MENSAGEM}|\\b${O_QUE_ACONTECEU}\\b(?: \\S+){0,3}? (?:(?:ta|tah|esta|ficou|fica|e) )?sem (?:responder|reagir|reacao)\\b${SEM_OBJETO_DE_MENSAGEM}|\\b${NAO} (?:(?:ta|tah|esta|tava|estava) )?(?:respondendo|responde|reage|reagindo) (?:mais )?(?:a nada|a estimulos?|aos estimulos|quando (?:eu |a gente )?(?:chamo|chama|chamamos|chamei))\\b`,
    // O que "caiu" na recepcao: a ligacao, o pix, o sistema ("a ligacao
    // caiu e a moca nao ta respondendo").
    excecaoAntes:
      "\\b(?:ligac\\w*|chamada|pix|pagamento|sistema|internet|sinal|conexao|rede|whats\\w*|zap\\w*|site|ap|aplicativo|telefone|celular|linha|mensagem|mensagens)\\b(?: \\S+){0,2}?\\s*$",
  },
  {
    // Revisao de 6eae43d (A1, lacuna): a pessoa da familia que nao responde,
    // sem mais nada ("meu pai nao esta respondendo", "o bebe nao responde").
    // O assunto da recepcao na mesma mensagem ("vou confirmar com minha mae,
    // ela nao esta respondendo", "minha mae nao responde, depois eu te
    // aviso") e a mensagem que ela nao respondeu; o que aconteceu ("caiu",
    // "desmaiou"), o socorro e o pedido de ajuda devolvem a urgencia.
    nome: "familia_nao_responde",
    tipo: "fisica",
    fonte: `\\b${QUEM_DA_FAMILIA}(?: (?!(?:mas|porem|so|que|nao|nem)\\b)\\S+){0,3}? (?:nao|nem) (?:(?:ta|tah|esta|tava|estava) )?(?:respondendo|responde)(?: mais)?${FIM_LOGO_DEPOIS}`,
    excecaoNaMensagem: ASSUNTO_DA_RECEPCAO,
    semExcecaoCom: `\\b${O_QUE_ACONTECEU}\\b|${PEDIDO_DE_AJUDA}|${INICIO_SUBITO}`,
  },
  {
    // Revisao de 30/10/2026 (lacuna): "ele ta morrendo". O exagero
    // ("morrendo de rir", "de vontade") e o celular ou a planta nao contam.
    // Revisao de 6eae43d (M2): "morrendo de dor" ("de colica", "de dor de
    // dente") e a dor, que o "sintoma" escala; o cabelo, a pele e a unha
    // ("meu cabelo ta morrendo") sao a estetica.
    nome: "morrendo",
    tipo: "fisica",
    fonte: `\\bmorendo\\b${EXAGERO_DE_MORRER}${MORRENDO_DE_DOR}`,
    // Revisao R2 de d1a15f6: o sujeito colado ao sinal (antes valia em
    // qualquer ponto da oracao: "meu celular ta morrendo e minha mae ta
    // morrendo" perdia a mae).
    excecaoAntes:
      "\\b(?:celular|cel|bateria|carga|planta|plantas|flor|flores|cabelo|cabelos|fio|fios|cacho|cachos|raiz|raizes|ponta|pontas|cilio|cilios|sobrancelha|sobrancelhas|pele|unha|unhas)\\b(?: \\S+){0,2}?\\s*$",
    // Revisao R2 de d1a15f6 (alarme falso seguro): a figura do preco ("to
    // morrendo com esse preco") e o riso ("to morrendo kkkkk").
    excecaoDepois: `^\\s*(?:com|de) (?:ese|esa|este|esta|tanto|tanta|o|a|os|as|meu|minha) ${FIGURA}\\b|^[\\s,.!]*(?:k[ak]*|(?:ha)+h?|(?:rs)+|lol)\\b`,
    semExcecaoCom:
      "\\b(?:socoro|me ajud\\w*|preciso de ajuda|samu|ambulancia|192)\\b",
  },
  {
    nome: "convulsao",
    tipo: "fisica",
    // Revisao R2 de d1a15f6 (A3): as grafias ("convulcao", "comvulsao",
    // "convusao", "convulsionano") e a crise epileptica de agora ("ta tendo
    // uma crise epiletica", "teve um ataque epileptico agora").
    fonte: `\\bco[mn]vul?[sc](?:ao|oes|ionando|ionano|ionou|ionei|ionaram|iva|ivo|ivas|ivos)\\b|${ANTES_DO_EVENTO}${CRISE_EPILEPTICA}\\b|${eventoComOAgora(CRISE_EPILEPTICA)}`,
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
    // "acordei" desfazem as duas excecoes. Revisao de 6eae43d: de quem e a
    // boca ("a boca do meu pai ficou torta", A1); a excecao estetica na
    // mesma mensagem (o pedido de procedimento, a idade, o sorriso: "minha
    // boca fica torta quando eu sorrio", M2); e a queixa de outro membro, da
    // fala ou a dor de cabeca forte, na rajada, desfaz o procedimento e a
    // estetica ("fiz botox ontem e minha boca ficou torta e meu braco ta
    // dormente", M1).
    nome: "boca_torta",
    tipo: "fisica",
    fonte: `\\bboca${DE_QUEM} (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:tort[oa]s?|entortou|entortando|entortada)\\b|\\bboca${DE_QUEM} (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:caiu|caindo|caida|caido)(?: \\S+){0,3}? (?:de um lado|so de um lado|do lado (?:esquerdo|direito)|pela metade|pro lado|pra um lado|para (?:o|um) lado|de repente|derepente)\\b`,
    excecaoAntes: PERMANENTE_ANTES,
    excecaoDepois: PERMANENTE_DEPOIS,
    excecaoNaMensagem: `${PROCEDIMENTO_NA_MESMA_MENSAGEM}|${ESTETICA_NA_MESMA_MENSAGEM}`,
    semExcecaoCom: `${INICIO_SUBITO}|${OUTRO_SINAL_DE_AVC}`,
  },
  {
    // Revisao de 28/10/2026: o rosto "caido" e "caindo" e a flacidez da
    // estetica ("papada e rosto caindo", "meu rosto caiu depois que
    // emagreci", "rosto caido, quanto custa?"). Aqui, o rosto TORTO (ou que
    // entortou). O procedimento recente da propria pessoa, na mesma
    // mensagem ("fiz harmonizacao e meu rosto ficou torto"), e efeito dele,
    // como a boca torta: "sintoma". Revisao de 30/10/2026: nunca com "de um
    // lado", "metade" ou "de repente"; o estado permanente ("meu rosto e
    // torto") e a estetica. Revisao de 6eae43d: de quem e o rosto, a excecao
    // estetica e o que a desfaz, como na boca torta (A1, M1 e M2).
    nome: "rosto_torto",
    tipo: "fisica",
    fonte: `\\b(?:rosto|face)${DE_QUEM} (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:tort[oa]s?|entortou|entortando|entortado|entortada)\\b`,
    excecaoAntes: PERMANENTE_ANTES,
    excecaoDepois: PERMANENTE_DEPOIS,
    excecaoNaMensagem: `${PROCEDIMENTO_NA_MESMA_MENSAGEM}|${ESTETICA_NA_MESMA_MENSAGEM}`,
    semExcecaoCom: `${INICIO_SUBITO}|${UM_LADO_DO_ROSTO}|${OUTRO_SINAL_DE_AVC}`,
  },
  {
    // O rosto caido de UM LADO, pela METADE ou DE REPENTE ("o rosto caiu
    // de um lado", "metade do rosto caiu", "de repente o rosto caiu"):
    // o procedimento nunca apaga (revisao de 30/10/2026). So o estado
    // permanente dito com o "e" ("o lado direito do meu rosto e mais caido")
    // nao casa. Revisao de 6eae43d (M2): a excecao estetica na mesma
    // mensagem ("o lado esquerdo do meu rosto ta mais caido, quero fazer
    // fios"), que "de repente", o outro membro e a fala desfazem; "mais
    // caido" sozinho continua urgente ("meu rosto ta mais caido de um lado").
    nome: "rosto_caido_de_um_lado",
    tipo: "fisica",
    fonte:
      // Revisao R2 de d1a15f6 (A3): tambem o paralisado, o travado e o mole
      // ("meu pai ta com o rosto paralisado de um lado"; a dormencia nao: a
      // anestesia do dentista).
      `\\b(?:lado|metade|banda) (?:esquerd[oa] |direit[oa] )?d[oa] (?:meu |minha |seu |sua )?(?:rosto|face|cara)${DE_QUEM} (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:caiu|caido|caida|caindo|paralisad[oa]|paralizad[oa]|travad[oa]|mole)\\b` +
      `|\\b(?:rosto|face)${DE_QUEM} (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:caiu|caido|caida|caindo|paralisad[oa]|paralizad[oa]|travad[oa])(?: \\S+){0,3}? (?:de um lado|so de um lado|do lado (?:esquerdo|direito)|pela metade|pro lado|pra um lado|de repente|derepente)\\b` +
      `|\\b(?:de repente|derepente)(?: \\S+){0,4}? (?:rosto|face) (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:caiu|caido|caida|caindo)\\b`,
    excecaoNaMensagem: ESTETICA_NA_MESMA_MENSAGEM,
    semExcecaoCom: `${INICIO_SUBITO}|${OUTRO_SINAL_DE_AVC}`,
  },
  {
    // Revisao de 6eae43d: o rosto de OUTRA PESSOA que caiu ("o rosto dela
    // caiu", "o rosto da minha mae caiu"): quem conta a queda do rosto de
    // alguem fala do agora (a flacidez da propria pessoa, "meu rosto caiu
    // depois que emagreci", continua de fora). O "caindo" e a flacidez ("o
    // rosto da minha mae ta caindo, voces fazem lifting?"). Revisao R2 de
    // d1a15f6 (A1): sem excecao estetica (a terceira pessoa nunca e
    // estetica: "o rosto dela caiu muito com a idade, voces fazem fios?" e
    // urgencia).
    nome: "rosto_caido_de_outra_pessoa",
    tipo: "fisica",
    fonte: `\\b(?:rosto|face|cara) ${DE_OUTRA_PESSOA} (?:${PALAVRA_DO_MEIO_ATUAL}){0,2}?(?:caiu|caido|caida)\\b`,
  },
  {
    nome: "fala_enrolada",
    tipo: "fisica",
    // Revisao R2 de d1a15f6 (A3): "a fala embolada", "a fala ta estranha".
    fonte: `\\b(?:fala|falando) (?:${PALAVRA_DO_MEIO})?(?:enrolad[ao]|arastad[ao]|embolad[ao]|estranh[ao]|esquisit[ao])\\b`,
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
    fonte: `\\b${NAO} (?:consigo|to conseguindo|tou conseguindo|estou conseguindo) (?:mais )?falar?(?! direito)${FIM_LOGO_DEPOIS}`,
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
    fonte: `\\b${NAO} (?:consigo|consegue|conseguia|to conseguindo|tou conseguindo|estou conseguindo|ta conseguindo|esta conseguindo) (?:mais )?falar? direito${FIM_LOGO_DEPOIS}`,
  },
  {
    // Outra pessoa ("minha mae nao consegue falar", "liguei pra ela, ela
    // nao consegue falar"): o telefone NAO desfaz (quem liga e descobre que
    // a pessoa nao fala e o sinal). So a clinica como sujeito ("a recepcao
    // nao consegue falar") fica de fora.
    nome: "nao_consegue_falar",
    tipo: "fisica",
    fonte: `\\b${NAO} (?:consegue|conseguia|ta conseguindo|esta conseguindo) (?:mais )?falar?(?! direito)${FIM_LOGO_DEPOIS}`,
    excecaoAntes:
      "\\b(?:recepc\\w*|secretaria|atendente|clinica|consultorio|voces|vcs)\\b",
    semExcecaoCom: `${PESSOA_NO_TELEFONE}|${INICIO_SUBITO}|${QUEIXA_DO_CORPO}`,
  },
  {
    nome: "lado_do_corpo",
    tipo: "fisica",
    fonte: `\\b(?:lado|metade|parte|banda) (?:esquerd[oa] |direit[oa] )?do (?:meu )?corpo (?:${PALAVRA_DO_MEIO}){0,2}?(?:sem forca|fraco|fraca|dormente|dormentes|paralisad[oa]|adormecid[oa])\\b|\\b(?:ficou|ficaram|ta|tah|esta|to|tou|estou|fiquei|tava|estava) com (?:o|a) (?:lado|metade|banda) (?:esquerd[oa]|direit[oa])(?: do corpo)?(?: \\S+)? (?:mole|fraco|fraca|dormente|paralisad[oa]|sem forca|adormecid[oa])\\b`,
  },
  {
    // Revisao de 6eae43d (A1, lacuna): "nao consigo mexer o braco direito",
    // "ela nao consegue mexer a perna", "nao sinto o braco", "o braco nao
    // mexe". So o braco, a perna, a mao, o pe e o lado do corpo: a testa e a
    // boca depois do botox sao o efeito esperado, e o dedo e o machucado. O
    // "levantar o braco" e o ombro (a ortopedia) nao entram.
    nome: "nao_mexe_o_braco",
    tipo: "fisica",
    fonte: `\\b${NAO} (?:consigo|consegue|conseguia|consegui|conseguiu|to conseguindo|tou conseguindo|estou conseguindo|ta conseguindo|esta conseguindo) (?:mais )?(?:mexer?|mover?|movimentar?|sentir?)(?: (?:o|a|os|as|meu|minha|meus|minhas|seu|sua))? ${MEMBRO}\\b|\\b${NAO} (?:(?:to|tou|estou|ta|esta|tava|estava) )?(?:mexe|mexendo|movimenta|movimentando|sinto|sente|sentindo) (?:mais )?(?:o|a|os|as|meu|minha|meus|minhas|seu|sua) ${MEMBRO}\\b|\\bnem (?:mexer?|mover?|movimentar?)(?: (?:o|a|os|as|meu|minha|meus|minhas|seu|sua))? ${MEMBRO}\\b|\\b(?:braco|bracos|perna|pernas|mao|maos) (?:${PALAVRA_DO_MEIO}){0,2}?(?:nao|nem) (?:mexe|move|movimenta|obedece|tem forca|responde)\\b`,
  },
  {
    // Revisao de 6eae43d (A1, lacuna): o braco, a perna ou a mao fracos,
    // dormentes ou sem forca DE REPENTE ("meu braco ficou fraco do nada") e
    // o braco e a perna juntos ("meu braco e minha perna do lado direito
    // ficaram fracos"). Sem o "de repente", a dormencia de um membro so e o
    // de sempre (o braco que dormiu) e segue pelo portao.
    nome: "braco_ou_perna_fraco",
    tipo: "fisica",
    fonte: `\\b${DE_REPENTE}(?: \\S+){0,6}? ${MEMBRO} (?:${PALAVRA_DO_MEIO}){0,4}?${FRACO}\\b|\\b${MEMBRO} (?:${PALAVRA_DO_MEIO}){0,6}?${FRACO}(?: \\S+){0,3}? ${DE_REPENTE}\\b|\\b(?:braco|bracos) (?:e|ou) (?:\\S+ )?(?:perna|pernas)\\b(?: (?!(?:nao|nem|nunca|jamais)\\b)\\S+){0,6}? ${FRACO}\\b|\\b(?:perna|pernas) (?:e|ou) (?:\\S+ )?(?:braco|bracos)\\b(?: (?!(?:nao|nem|nunca|jamais)\\b)\\S+){0,6}? ${FRACO}\\b|\\bperd(?:i|eu|endo|emos) (?:a )?forca d[oa]s? (?:\\S+ )?(?:braco|bracos|perna|pernas|mao|maos|lado)\\b`,
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
    excecaoAntes: INFORMACAO_PERTO_DO_EVENTO,
    excecaoDepois:
      "^\\s*(?:(?:no|nos|na|nas) (?:olho|olhos|vista|pele|rosto|joelho|ombro)|ocular|pleural|articular)\\b",
  },
  // ---- visao (revisao de 6eae43d) ------------------------------------------
  {
    // A1 (lacuna): a visao que se perde agora ("fiz preenchimento ha 1 hora
    // e estou perdendo a visao", "perdi a vista do olho direito", "fiquei
    // cega de um olho", "minha vista escureceu", "escureceu a vista"). O
    // medo e a pergunta ("tenho medo de perder a visao", "pode deixar
    // cego?") nao casam (sem o verbo no infinitivo); o "sou cega de um olho"
    // e o estado de sempre. A vista de longe e de perto, o oculos e o grau
    // ("estou perdendo a visao de perto") sao a vista de sempre; o
    // procedimento ou a cirurgia na rajada desfaz. "A vista escureceu quando
    // levantei" FICA urgente (a queda de pressao, que no pos-operatorio pode
    // ser o sangramento, e nenhum outro gatilho do portao a escala).
    nome: "perdendo_a_visao",
    tipo: "fisica",
    fonte:
      "\\b(?:perdi|perdeu|perdendo|perdemos|perderam) (?:a|minha|sua|toda a|parte da) (?:visao|vista)\\b" +
      "|\\b(?:fiquei|ficou|ficaram|ficando) (?:\\S+ )?ceg[oa]s?\\b(?! de (?:raiva|amor|paixao|ciume|odio|sono|cansaco)\\b)" +
      "|\\bceg[oa]s? (?:de|do|da) (?:um|uma|1|o|a) (?:olho|vista|lado)\\b" +
      "|\\b(?:vista|visao|vistas) (?:\\S+ ){0,2}?(?:escureceu|escurecendo|escureceram|(?:ficou|ficando|ta|esta) (?:tod[oa] |meio |bem )?(?:escura|preta|apagada)|apagou|apagando|sumiu|sumindo)\\b" +
      "|\\b(?:escureceu|escurecendo|escureceram|deu uma escurecida)(?: \\S+){0,2}? (?:a |minha |na |da )?(?:vista|visao)\\b" +
      // Revisao R2 de d1a15f6 (A3): "to vendo tudo preto", "meu olho
      // direito apagou".
      "|\\b(?:to|tou|estou|ta|esta|fiquei|ficou|comecei a|comecou a) (?:ver|vendo) tudo (?:preto|escuro|apagado)\\b" +
      "|\\bolho (?:direito |esquerdo )?(?:apagou|escureceu|ficou cego|ficou escuro|parou de enxergar)\\b",
    excecaoAntes: "\\b(?:sou|era|nasci|nasceu)\\b(?: \\S+){0,2}?\\s*$",
    excecaoDepois: `${VISTA_DE_SEMPRE_DEPOIS}|${PERMANENTE_DEPOIS}`,
    // Revisao R2 de d1a15f6 (M2): a historia de outra pessoa com a pergunta
    // de informacao ("conheco uma moca que ficou cega depois de
    // preenchimento, isso e comum?") nao conta.
    excecaoNaMensagem: `^(?!.*${UM_OLHO})(?=.*${VISTA_DE_SEMPRE_NA_MENSAGEM})|^${HISTORIA_DE_INFORMACAO}`,
    semExcecaoCom: `^(?!${HISTORIA_DE_INFORMACAO})(?=.*(?:${INICIO_SUBITO}|${PROCEDIMENTO_OU_CIRURGIA_FEITOS}|${VISAO_DE_AGORA}))`,
  },
  {
    // A1 (lacuna): "nao estou enxergando", "nao consigo enxergar", "nao
    // enxergo nada", "parei de enxergar". A vista de sempre ("nao estou
    // enxergando bem de longe, voces tem oftalmologista?") e o texto da tela
    // ("nao estou enxergando o link") nao contam; o procedimento ou a
    // cirurgia na rajada e "de repente" desfazem.
    nome: "nao_enxerga",
    tipo: "fisica",
    fonte:
      `\\b${NAO} (?:(?:to|tou|estou|ta|tah|esta|tava|estava) )?enxergando\\b${TEXTO_DA_TELA}|\\b${NAO} (?:consigo|consegue|to conseguindo|tou conseguindo|estou conseguindo|ta conseguindo|esta conseguindo|consegui|conseguiu) (?:mais )?enxergar?\\b${TEXTO_DA_TELA}|\\b${NAO} enxergo (?:mais )?nada\\b|\\b(?:parei|parou|deixei|deixou) de enxergar\\b|\\b(?:fiquei|ficou) sem enxergar\\b` +
      // Revisao R2 de d1a15f6 (A3): "nao enxergo direito", "nao enxergo do
      // olho direito", "nao vejo nada do olho direito", "fiquei sem ver do
      // olho esquerdo". O "nao vejo" sozinho nao ("nao vejo a hora", "nao
      // vejo diferenca").
      `|\\b${NAO} (?:enxergo|enxerga)\\b${TEXTO_DA_TELA}` +
      `|\\b${NAO} (?:vejo|ve|to vendo|tou vendo|estou vendo|ta vendo|esta vendo|consigo ver|consegue ver)(?: mais)? nada\\b` +
      `|\\b${NAO} (?:enxergo|enxerga|vejo|ve|to vendo|tou vendo|estou vendo|ta vendo|esta vendo|consigo ver|consegue ver|to enxergando|estou enxergando)(?: mais)?(?: nada)? (?:do|de um|de uma|com o|com um|pelo|pela) (?:olho|olhos|vista|lado)\\b` +
      "|\\b(?:fiquei|ficou|to|tou|estou|ta|esta) sem (?:ver|enxergar) (?:nada|do|de um|de uma|com o|pelo|pela|direito)\\b",
    excecaoDepois: `${VISTA_DE_SEMPRE_DEPOIS}|${PERMANENTE_DEPOIS}`,
    excecaoNaMensagem: `^(?!.*${UM_OLHO})(?=.*${VISTA_DE_SEMPRE_NA_MENSAGEM})|^${HISTORIA_DE_INFORMACAO}`,
    semExcecaoCom: `^(?!${HISTORIA_DE_INFORMACAO})(?=.*(?:${INICIO_SUBITO}|${PROCEDIMENTO_OU_CIRURGIA_FEITOS}|${VISAO_DE_AGORA}))`,
  },
  // ---- a complicacao do preenchimento (revisao de 6eae43d) -----------------
  {
    // Pedido do coordenador (a emergencia tipica da clinica de estetica, a
    // oclusao vascular): com o preenchimento (a harmonizacao, o
    // bioestimulador, o acido hialuronico, os fios) JA FEITO na mensagem ou
    // na rajada, de quem for, e
    //  - a visao embacada, turva, dupla ou escurecendo ("fiz preenchimento
    //    e minha visao ta embacada");
    //  - a pele ou o labio branco, palido, esbranquicado, manchado ou
    //    rendilhado ("o labio ficou branco depois do preenchimento");
    //  - o roxo que espalha ou aumenta ("ta roxo e espalhando"); o roxo
    //    sozinho e o hematoma ("fiquei com um roxinho", "ficou roxo onde
    //    furou") e fica de fora;
    //  - a dor forte no lugar ou a dor que piora.
    // Sem o procedimento feito (so pedido, ou nenhum: "visao embacada, voces
    // tem oftalmologista?", "quero preencher o labio, ele e muito palido")
    // nao conta: a EXCECAO e a falta dele na mensagem, e o procedimento feito
    // em qualquer mensagem da rajada a desfaz. Nem a pergunta sobre o efeito
    // apaga (semPergunta): quem fez e pergunta "pode dar visao embacada?"
    // pode estar sentindo agora.
    nome: "oclusao_do_preenchimento",
    tipo: "fisica",
    fonte:
      `\\b(?:visao|vista|vistas|olho|olhos)\\b(?: (?!(?:nao|nem|nunca|jamais|sem)\\b)\\S+){0,3}? (?:embacad[oa]s?|embacando|embacou|turv[oa]s?|turvando|turvou|dupla|duplas|duplicad[oa]s?|escurecendo|escureceu|borad[oa]s?|nublad[oa]s?|desfocad[oa]s?|embaralhad[oa]s?)\\b` +
      `|\\b(?:vendo|enxergando|vejo|enxergo)(?: (?:tudo|meio|bem|muito|um pouco))? (?:embacado|duplo|dobrado|turvo|borado|nublado|desfocado|escuro|preto|cinza)\\b` +
      // Revisao R2 de d1a15f6 (A3): as bolhas depois do preenchimento.
      `|\\b(?:apareceu|apareceram|surgiu|surgiram|saiu|sairam|ta com|esta com|cheio de|cheia de) (?:\\S+ )?(?:bolha|bolhas|bolhinha|bolhinhas)\\b` +
      `|\\b(?:embacou|turvou|escureceu|embacando|escurecendo)(?: \\S+){0,2}? (?:a |minha |na |da )?(?:visao|vista)\\b` +
      // Revisao R2 de d1a15f6 (M2): o "e" (o estado de sempre: "minha boca e
      // muito branquinha", "a pele dela e escura") nas duas primeiras
      // palavras depois do lugar, e o "era", o "sempre", o "sou" e o "foi"
      // em qualquer uma (o "e" do meio e o de "roxo e frio").
      `|\\b${LUGAR_DO_PREENCHIMENTO}\\b(?! (?:\\S+ )?(?:e|eh|era|sao|eram|sempre|sou|foi|fui|foram)\\b)(?: (?!(?:nao|nem|nunca|jamais|sem|eh|era|sao|eram|sempre|sou|foi|fui|foram)\\b)\\S+){0,4}? ${COR_DA_ISQUEMIA}\\b` +
      `|(?<!\\b${NAO_E_A_PELE}(?: \\S+){0,2} )\\b(?:ficou|ficaram|ficando|ta|tah|esta|tao|estao) (?:tudo |toda |todo |meio |bem |muito )?(?:branc[oa]s?|branquinh[oa]s?|esbranquicad[oa]s?|palid[oa]s?|rendilhad[oa]s?|escur[oa]s?|cinza|acinzentad[oa]s?|pret[oa]s?)\\b` +
      `|\\b${ROXO}\\b(?: (?!(?:nao|nem|nunca|jamais)\\b)\\S+){0,5}? (?:${ESPALHANDO}|manchad[oa]s?|rendilhad[oa]s?)\\b|\\b${ESPALHANDO}(?: (?!(?:nao|nem|nunca|jamais)\\b)\\S+){0,3}? ${ROXO}\\b` +
      `|\\b(?:${DOR_FORTE})\\b`,
    // Revisao R2 de d1a15f6 (M2): o preenchimento ANTIGO ("fiz harmonizacao
    // ha 2 anos") so conta com o agora ("de repente", "hoje"); e a historia
    // de outra pessoa com a pergunta de informacao ("conheco uma moca que",
    // "vi no instagram", "isso e comum?") nao conta. O relato presente de
    // outra pessoa conta ("minha amiga fez preenchimento ontem e o labio ta
    // branco").
    excecaoNaMensagem: `^(?!${PREENCHIMENTO_QUE_CONTA})|^${HISTORIA_DE_INFORMACAO}`,
    semExcecaoCom: `^(?!${HISTORIA_DE_INFORMACAO})${PREENCHIMENTO_QUE_CONTA}`,
    semPergunta: true,
  },
  {
    // Revisao R2 de d1a15f6 (M2): a MANCHA so conta com o preenchimento
    // RECENTE dito (ontem, hoje, agora, de repente: "fiz a boca ontem e ela
    // ta toda manchada"). Com o preenchimento antigo, sem o agora ("fiz
    // harmonizacao ha 2 anos, minha pele ta manchada"; "ja fiz harmonizacao
    // e agora quero tratar o melasma"), com o sol e o melasma, ou com a
    // historia de outra pessoa, nao conta. O branco, o palido, o rendilhado,
    // o frio, o roxo que espalha e a dor forte continuam na oclusao.
    nome: "mancha_depois_do_preenchimento",
    tipo: "fisica",
    fonte: `(?:\\b${LUGAR_DO_PREENCHIMENTO}\\b(?! (?:\\S+ )?(?:e|eh|era|sao|eram|sempre|sou|foi|fui|foram)\\b)(?: (?!(?:nao|nem|nunca|jamais|sem|eh|era|sao|eram|sempre|sou|foi|fui|foram)\\b)\\S+){0,4}? (?:manchad[oa]s?|com manchas|cheia de manchas|cheio de manchas)|(?<!\\b${NAO_E_A_PELE}(?: \\S+){0,2} )\\b(?:ficou|ficaram|ficando|ta|tah|esta|tao|estao) (?:tudo |toda |todo |meio |bem |muito )?manchad[oa]s?)\\b${MANCHA_DE_SEMPRE}`,
    excecaoNaMensagem: `^(?!(?=.*(?:${PREENCHIMENTO_FEITO}))(?=.*${AGORA_DA_OCLUSAO}))|^${HISTORIA_DE_INFORMACAO}`,
    semExcecaoCom: `^(?!${HISTORIA_DE_INFORMACAO})(?=.*(?:${PREENCHIMENTO_FEITO}))(?=.*${AGORA_DA_OCLUSAO})`,
    semPergunta: true,
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
    // Revisao R2 de d1a15f6 (A3): "a lingua ta grossa".
    fonte: `\\b(?:garganta|lingua) (?:${PALAVRA_DO_MEIO}){0,2}?(?:inchada|inchado|inchadas|inchados|grosa|groso)\\b`,
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
      "\\bsangrando (?:muito|mto|mt|demais|dms|dmais|bastante|sem parar|tanto|um monte|horores|pra caramba)\\b",
    semAntecedente: true,
  },
  {
    nome: "nao_para_de_sangrar",
    tipo: "fisica",
    fonte:
      `\\b${NAO} (?:para|parou|ta parando|esta parando|quer parar|consigo parar|consegue parar|conseguimos parar|estanca|estancou) de sangrar?\\b|` +
      "\\b(?:sangue|sangramento) (?:que )?(?:nao|nem) (?:para|parou|estanca|estancou)\\b",
    semAntecedente: true,
  },
  {
    nome: "muito_sangue",
    tipo: "fisica",
    fonte:
      "\\b(?:muito|mto|mt|bastante|tanto|um monte de) sangue\\b|\\bsangue (?:demais|pra todo lado|sem parar)\\b|\\b(?:jorando|jorou|esguichando|esguichou) sangue\\b|\\bsangue (?:jorando|esguichando)\\b",
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
    excecaoAntes: INFORMACAO_PERTO_DO_EVENTO,
    semAntecedente: true,
  },
  // ---- envenenamento (revisao de 6eae43d) -----------------------------------
  {
    // A1 (lacuna): "engoli um produto de limpeza", "minha filha bebeu agua
    // sanitaria", "tomei veneno", "o bebe engoliu soda caustica". O banho
    // ("tomei um banho de...") e o acido da pele nao entram.
    nome: "engoliu_veneno",
    tipo: "fisica",
    fonte: `\\b(?:engoli|engoliu|engoliram|engolindo|engolir|bebi|bebeu|beberam|bebendo|tomei|tomou|tomaram|tomando|ingeri|ingeriu|ingeriram|ingerindo|comi|comeu)(?: (?!banho\\b)\\S+){0,3}? ${VENENO}\\b`,
  },
  // ---- ferimento grave (revisao de 6eae43d) ---------------------------------
  {
    // Pedido do coordenador: o tiro e a facada ("levei um tiro", "meu filho
    // levou um tiro", "fui baleada", "foi esfaqueado", "levei uma facada",
    // "atiraram nele", "bala perdida"). A figura ("foi tiro e queda", "isso
    // foi um tiro no pe", "esse preco e uma facada", "levei uma facada nesse
    // orcamento"), os disparos do laser ("levei 300 tiros de laser na
    // axila") e a historia ("ja levei um tiro") nao contam. Sem a "bala"
    // solta (no Brasil, tambem o doce).
    nome: "ferimento_grave",
    tipo: "fisica",
    fonte:
      "\\b(?:levei|levou|levaram|levamos|tomei|tomou|tomaram|acabei de levar|acabou de levar|acabei de tomar|acabou de tomar)(?: (?:um|uma|uns|umas|dois|duas|tres|varios|varias|muitos|muitas|alguns|algumas|\\d+))? (?:tiro|tiros|facada|facadas|balaco|balacos)\\b" +
      "|\\b(?:deram|meteram)(?: (?:um|uns|dois|tres|varios|muitos|uma|duas|varias))? (?:tiro|tiros|facada|facadas)\\b" +
      "|\\batiraram (?:nele|nela|neles|nelas|em mim|no|na|nos|nas|contra)\\b" +
      "|\\b(?:baleado|baleada|baleados|baleadas|esfaqueado|esfaqueada|esfaqueados|esfaqueadas|esfaquearam|esfaqueou)\\b" +
      "|\\b(?:atingid[oa]s?|ferid[oa]s?) (?:por|de|a|com) (?:um |uma )?(?:tiro|bala|disparo|faca|facada|arma)\\b" +
      "|\\bbala perdida\\b|\\bferimento (?:de|por|a|com) (?:bala|tiro|faca|arma)\\b",
    excecaoAntes: "\\bja\\s*$",
    excecaoDepois: TIRO_FIGURADO_DEPOIS,
    excecaoNaMensagem: DISPARO_DO_LASER,
  },
  // ---- revisao R2 de d1a15f6 (A3): os sinais novos para o RT ---------------
  {
    // O engasgo de agora ("ta engasgado", "engasgando") e o que vem com ele
    // ("engasgou e nao respira", "engasgou e ta ficando roxa"). O engasgo
    // que passou ("engasguei com a agua kkk", "engasgou mas ja ta bem") e
    // o medo ("medo de engasgar") nao contam.
    nome: "engasgo",
    tipo: "fisica",
    fonte: `\\b(?:ta|tah|esta|to|tou|estou|ficou|fica) engasgad[oa]s?\\b|\\bengasgando\\b|\\bengasg(?:ou|ei|aram|ad[oa])\\b(?: \\S+){0,4}? (?:${NAO} (?:respira|ta respirando|esta respirando|consegue respirar|consigo respirar|consegue falar|consegue tosir|consegue chorar)|(?:ta|esta|ficou|ficando|fica) (?:tod[oa] |meio )?rox[oa]|sem respirar|sem ar|sufocando|desmai\\w*|apagou|desacordad[oa])\\b`,
  },
  {
    // A pilha ou a bateria engolida (a crianca, de botao: "meu filho
    // engoliu uma pilha", "engoliu uma bateria dessas de relogio"). O
    // aparelho que "engoliu" a bateria nao conta.
    nome: "pilha_engolida",
    tipo: "fisica",
    fonte:
      "\\b(?:engoli|engoliu|engoliram|engolindo|engolir|comeu|ingeriu|colocou na boca|botou na boca)(?: \\S+){0,3}? (?:uma |um |a |o |as |os )?(?:pilha|pilhas|pilhinha|bateria|baterias|bateriazinha)\\b",
    excecaoAntes:
      "\\b(?:celular|telefone|cel|aparelho|controle|relogio|caro|notebok|computador|maquina)\\b(?: \\S+){0,2}?\\s*$",
  },
  {
    // O atropelamento ("meu vizinho foi atropelado", "atropelaram meu
    // filho"). O "quase" ("quase fui atropelada kkk") e a historia ("fui
    // atropelado ano passado") nao contam.
    nome: "atropelado",
    tipo: "fisica",
    fonte:
      "\\b(?:atropelad[oa]s?|atropelamento|atropelaram)\\b|\\b(?:caro|moto|onibus|caminhao|bicicleta|bike|van|uber|trem)(?: \\S+){0,2}? atropelou\\b",
    excecaoAntes: "\\bquase(?: (?:fui|foi|fomos|foram|ser|sendo))?\\s*$",
  },
  {
    // A picada ou a mordida de cobra, escorpiao ou aranha ("fui picado por
    // cobra", "o escorpiao picou ele"). O mosquito, a abelha, a agulha e a
    // "aranha vascular" (os vasinhos) nao entram; a historia ("ja fui
    // picada por escorpiao") nao conta.
    nome: "picada_de_animal",
    tipo: "fisica",
    fonte: `\\b(?:picad[oa]s?|mordid[oa]s?|feroad[oa]s?|picada|picadas|mordida|mordidas|feroada)\\b(?: \\S+){0,3}? (?:por |de |pela |pelo |uma |um )?(?:\\S+ )?${BICHO_PECONHENTO}\\b|\\b${BICHO_PECONHENTO} (?:\\S+ ){0,2}?(?:picou|mordeu|ferou)\\b`,
    excecaoAntes: "\\bja(?: (?:fui|foi|fomos|foram))?\\s*$",
  },
  {
    // O gas de cozinha respirado ("inalei muito gas de cozinha",
    // "intoxicado com gas").
    nome: "gas_inalado",
    tipo: "fisica",
    fonte:
      "\\b(?:inalei|inalou|inalaram|inalando|respirei|respirou|respirando|aspirei|aspirou) (?:muito |bastante |um monte de |um pouco de )?(?:o )?gas\\b|\\bintoxica(?:do|da|dos|das|cao) (?:com|de|por) gas\\b",
  },
  {
    // O vazamento de gas com a tontura, o desmaio ou o mal estar na mesma
    // mensagem ou na rajada ("o gas ta vazando e to tonta"). Sem o sintoma
    // ("o botijao ta vazando, ja chamei o tecnico") nao conta.
    nome: "vazamento_de_gas",
    tipo: "fisica",
    fonte:
      "\\b(?:vazamento de gas|gas (?:de cozinha |do fogao |de botijao |do botijao |de casa )?(?:ta |esta )?(?:vazando|vazou|escapando)|cheiro (?:forte )?de gas)\\b",
    excecaoNaMensagem: `^(?!.*${SINTOMA_DO_GAS})`,
    semExcecaoCom: SINTOMA_DO_GAS,
  },
  {
    // A gestante que sangra ("to gravida e to sangrando", "to de 8 meses e
    // to com sangramento", "a bolsa estourou"): a gravidez na mensagem ou
    // na rajada. A gengiva, o exame de sangue e a gravidez que ja passou
    // ("na minha primeira gravidez tive sangramento") nao contam.
    nome: "gestante_sangrando",
    tipo: "fisica",
    fonte:
      "\\b(?:sangrando|sangrou|sangramento|sangramentos|sangue|hemoragia|perdendo (?:muito )?(?:sangue|liquido)|bolsa (?:estourou|rompeu))\\b",
    excecaoAntes:
      "\\b(?:gengiva|gengivas|dente|dentes|exame|exames|doar|doacao|doei|tirar|tirei|colher|colhi|coleta)\\b(?: \\S+){0,3}?\\s*$",
    excecaoNaMensagem: `^(?!.*${GESTACAO})|^(?=.*${GESTACAO_PASADA})`,
    semExcecaoCom: `^(?!.*${GESTACAO_PASADA})(?=.*${GESTACAO})`,
    semAntecedente: true,
  },
  {
    // O bebe que parou de mexer (na barriga ou nao: "to gravida e o bebe
    // parou de mexer", "nao sinto mais o bebe mexer").
    nome: "bebe_parou_de_mexer",
    tipo: "fisica",
    fonte: `\\b(?:bebe|nenem|feto)\\b(?: \\S+){0,3}? (?:parou de (?:se )?mexer|${NAO} (?:mexe|se mexe|ta mexendo|esta mexendo|ta se mexendo|esta se mexendo|mexeu|se mexeu)(?: mais)?)\\b|\\b${NAO} (?:sinto|to sentindo|estou sentindo|senti) (?:mais )?(?:o bebe|o nenem|ele|ela) (?:se )?mexer\\b`,
  },
  {
    // O vomito ou a tosse com sangue ("to vomitando sangue", "meu pai ta
    // tossindo sangue").
    nome: "vomito_com_sangue",
    tipo: "fisica",
    fonte:
      "\\b(?:vomit\\w*|golfando|golfou|tosind\\w*|tosiu|tosi|cuspind\\w*|cuspiu|cuspi|escar\\w*)\\b(?: \\S+){0,2}? sangu\\w*|\\bvomito (?:com|de) sangue\\b|\\bsangue (?:no|na) (?:vomito|tose|cuspe)\\b",
  },
  {
    // Os labios roxos ("meu bebe ta com os labios roxos", "a boca dela ta
    // azul"). O batom, a tinta, o frio como causa ("roxos de frio"; o "bebe
    // ta frio" e o sinal), a fruta e o procedimento na mesma mensagem (o
    // roxinho do preenchimento e o hematoma; o roxo que espalha e a oclusao)
    // nao contam.
    nome: "labios_roxos",
    tipo: "fisica",
    fonte:
      "\\b(?:labio|labios|boca|boquinha|beico|beicos)\\b(?: (?!(?:nao|nem|nunca|e|eh|era|sempre)\\b)\\S+){0,3}? (?:rox[oa]s?|azul|azuis|azulad[oa]s?|aroxead[oa]s?|roxead[oa]s?)\\b",
    excecaoNaMensagem: `\\b(?:batom|batons|glos|lapis|maquiagem|tinta|pintei|pintar|pinta|tatuagem|micropigmentacao|corante|acai|jabuticaba|amora|uva|vinho|picole|sorvete|hematoma|(?:de|do|com o|com|por causa do|pelo) frio)\\b|${PREENCHIMENTO_FEITO}|${PROCEDIMENTO_OU_CIRURGIA_FEITOS}`,
  },
  {
    // A confusao de repente ("minha mae de repente nao fala coisa com
    // coisa", "ficou confuso do nada") e a confusao depois da queda ("caiu
    // e ta confusa"). "Fiquei confusa com os precos" nao conta.
    nome: "confusao_mental",
    tipo: "fisica",
    fonte: `\\b${NAO} (?:fala|falo|ta falando|esta falando|tava falando|falava) (?:coisa com coisa|nada com nada|coisa com nada|nada com coisa)\\b|\\b(?:ficou|ta|tah|esta|tava|estava|fiquei|to|tou|estou) (?:\\S+ )?(?:confus[oa]s?|desorientad[oa]s?)\\b(?! com\\b)(?: \\S+){0,3}? (?:do nada|de repente|derepente)\\b|\\b(?:do nada|de repente|derepente)(?: \\S+){0,4}? (?:confus[oa]s?|desorientad[oa]s?)\\b(?! com\\b)|\\b(?:caiu|cai|bateu a cabeca|bati a cabeca)\\b(?: \\S+){0,12}? (?:confus[oa]s?|desorientad[oa]s?)\\b(?! com\\b)|\\b${NAO} (?:reconhece|reconheceu|ta reconhecendo|esta reconhecendo) (?:ninguem|a gente|a familia|os filhos|mais ninguem|ninguem mais)\\b`,
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
      "\\b(?:(?:contato|contatos|telefone|telefones|numero|numeros|fone|celular|whats|whatsap|ramal|pesoa|saida|saidas|kit|luz|luzes|freio|botao|fundo|porta|portas|escada|plantao|servico|servicos) (?:de|da|pra|para)|(?:em|no|num) caso de(?: urgencia (?:e|ou))?|se (?:for|tiver|houver|der|acontecer|precisar)(?: de)?(?: uma| um| alguma| algum)?)\\s*$" +
      "|\\b(?:encaixe|encaixes|encaixar|encaixa|horario|horarios|vaga|vagas|agenda|agendamento|marcacao|consulta|consultas|retorno) (?:de|em|para|pra)\\s*$" +
      "|\\b(?:surgiu|surgiram|apareceu|aconteceu|tive|teve|tivemos|tinha|houve|deu|rolou|ocoreu)(?: (?:uma|um|umas|uns|outra|outro))?(?: (?:pequena|pequeno|grande|baita))?\\s*$" +
      "|\\b(?:atende|atendem|faz|fazem|cobre|cobrem|aceita|aceitam|oferece|oferecem|trabalha|trabalham)(?: \\S+){0,2}?\\s*$" +
      "|\\b(?:voces|vcs|vc|clinica|consultorio) (?:tem|teriam)(?: \\S+){0,2}?\\s*$" +
      "|\\b(?:fui|foi|fomos|foram|levei|levou|levaram|estive|esteve|pasei|pasou|sai|saiu|voltei|voltou|atendid[oa]|internad[oa]|(?:tive|teve|tivemos|precisei|precisou) (?:que |de )?ir) (?:\\S+ ){0,2}?(?:na|da|pra|para a|a|numa)\\s*$" +
      "|\\b(?:atendimento|atendimentos|pronto atendimento|plantao|plantoes|servico|servicos|setor|ala|equipe|medico|medicos|hospital) (?:de|da|em|para|pra) (?:urgencia (?:e|ou) )?\\s*$",
    // Depois: "emergencia familiar", "no trabalho", "do hospital" e o "nao"
    // que fecha a oracao ("e emergencia nao", "emergencia nenhuma"). Revisao
    // de 6eae43d (M2): a "emergencia estetica" (e "de beleza", "capilar").
    excecaoDepois:
      "^\\s*(?:familiar|familiares|de familia|na familia|em familia|pesoal|particular|no trabalho|do trabalho|no servico|do servico|no emprego|do emprego|d[oa] (?:hospital|upa|pronto socoro|posto|clinica)\\b|(?:que )?(?:apareceu|surgiu|aconteceu)\\b|(?:nao|nenhuma)(?:\\s+(?:viu|ta|tah|ok|ne|so|k|rs\\w*))*\\s*$|estetica\\b|de beleza\\b|capilar\\b)",
    // Revisao de 30/10/2026: a agenda do paciente na mesma mensagem
    // ("tenho uma emergencia, preciso remarcar"), sem o pedido de ajuda.
    // Revisao de 6eae43d (M2): tambem o pedido de horario ou de encaixe ("e
    // uma emergencia! Preciso de um horario pra amanha").
    excecaoNaMensagem: AGENDA_DO_PACIENTE,
    // O pedido de ajuda, em qualquer mensagem da rajada, desfaz. Revisao R2
    // de d1a15f6: tambem quem esta passando mal e o acidente ("aconteceu uma
    // emergencia, minha mae ta passando mal"; "e uma emergencia, minha filha
    // caiu, pode marcar um encaixe?").
    semExcecaoCom: `${PEDIDO_DE_AJUDA}|\\b(?:pasando mal|pasou mal|pasei mal|nao ta bem|nao esta bem|caiu|desmai\\w*|machuc\\w*|sangr\\w*|bateu a cabeca|acidente|convuls\\w*|nao respira)\\b`,
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
    // Revisao R2 de d1a15f6 (A3): "kero morrer", "qro morrer", "quero
    // morre" (sem o "r": "more" na leitura).
    fonte: `\\b(?:quero|qro|kero|kro|qero|queria|qria|keria|kria|qeria|quis|vontade de|to querendo|tou querendo|estou querendo|so quero|so queria|prefiro|preferia|desejo|pensando em|penso em|pensei em)(?: (?:muito|tanto|mesmo|so|logo))? (?:morer|more)\\b${EXAGERO_DE_MORRER}`,
  },
  {
    // Revisao de 28/10/2026 (lacuna): "melhor eu morrer", "seria melhor se
    // eu morresse", "melhor que eu morra" e a outra pessoa ("ela diz que
    // seria melhor ela morrer"). A pergunta retorica com o "nao" ("nao
    // seria melhor eu morrer?") e o sinal, nunca a negacao dele: o "nao"
    // entra no sinal (SINAL_COM_A_PROPRIA_NEGACAO).
    nome: "melhor_morrer",
    tipo: "risco_de_vida",
    fonte: `\\b(?:(?:nao|nem) (?:seria|e|era|fica|ficaria) )?(?:melhor|preferivel) (?:(?:se |que )?(?:eu|ela|ele) (?:ja )?|pra mim )?(?:morer|more|morese|estar mort[oa]|ficar mort[oa])\\b${EXAGERO_DE_MORRER}|\\bmelhor que (?:eu|ela|ele) mora\\b`,
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
    fonte:
      `\\b${QUERER} (?:so )?(?:dormir|deitar|deitar e dormir) (?:e )?(?:nao acordar(?: mais)?(?: nunca mais)?|nunca mais acordar|pra sempre|para sempre)\\b` +
      // Revisao R2 de d1a15f6 (A3): "eu nao quero mais acordar". A hora e a
      // outra pessoa ("nao quero acordar cedo", "nao quero acordar ela") nao.
      `|\\b${NAO} ${QUERER} (?:mais )?acordar\\b(?! (?:cedo|tarde|antes|de manha|amanha|as \\d+|a tempo|na hora|pra|para|ela|ele|eles|elas|o|a|os|as|meu|minha|seu|sua|ninguem|voce|vc)\\b)`,
  },
  {
    // "vou me matar", "pensei em me matar". Revisao de 28/10/2026, refeita
    // em 30/10/2026: com o sujeito de exagero CONCRETO ("esse preco vai me
    // matar", "meu marido vai me matar", "essa dieta ta me matando") nao e
    // risco de vida. O sofrimento ("essa tristeza ta me matando", "a vida ta
    // me matando"), o pronome ("isso vai me matar"), o "eu" ("hoje a noite
    // eu ia me matar", "se nao fosse a minha filha eu ia me matar"), o "ia"
    // sem sujeito e a ameaca de outra pessoa ("meu ex quer me matar")
    // continuam (o lado conservador). Revisao de 6eae43d (M2): a queixa
    // estetica e a dor como sujeito ("essas rugas estao me matando", "essa
    // dor nas costas ta me matando") sao a figura de linguagem; o artigo
    // pode faltar ("rugas tao me matando") e cabem tres palavras no meio
    // ("essa dor nas minhas costas").
    nome: "me_matar",
    tipo: "risco_de_vida",
    // Revisao R2 de d1a15f6 (A3): sem o "r" depois do verbo que pede o
    // infinitivo ("vou me mata", "to pensando em me mata").
    fonte: `\\bme mat(?:ar|o|ando)\\b${EXAGERO_DE_MATAR}|(?<=\\b${AUXILIAR_DO_INFINITIVO} )me mata\\b${EXAGERO_DE_MATAR}`,
    excecaoAntes: `\\b(?:(?:(?:o|a|os|as) )?(?:meu|minha|meus|minhas|seu|sua|seus|suas|teu|tua|nosa|noso|nosas|nosos|ese|esa|eses|esas|este|esta|estes|estas|aquele|aquela|o|a|os|as) )?${SUJEITO_DE_EXAGERO}(?: (?!eu\\b)[a-z]+){0,3} (?:(?:ainda|asim|quase|ja) )?(?:vai|vao|ta|tao|esta|estao|vive)\\s*$`,
    excecaoDepois: `^\\s*(?:com|de) (?:ese|esa|eses|esas|este|esta|tanto|tanta|tantos|tantas|o|a|os|as|seu|sua|meu|minha) ${SUJEITO_DE_EXAGERO}\\b`,
    // Revisao R2 de d1a15f6 (M4): a ameaca de verdade e o pedido de ajuda, em
    // qualquer mensagem da rajada, desfazem o exagero ("meu marido disse que
    // vai me matar", "meu marido vai me matar, ele ta com uma faca").
    semExcecaoCom: `${AMEACA_DE_VERDADE}|${PEDIDO_DE_AJUDA}`,
  },
  {
    // Outra pessoa em risco ("ela disse que vai se matar") continua sendo
    // risco de vida: a conversa passa como urgente.
    nome: "se_matar",
    tipo: "risco_de_vida",
    fonte: `\\bse mat(?:ar|o|ando)\\b${EXAGERO_DE_MATAR}|(?<=\\b${AUXILIAR_DO_INFINITIVO} )se mata\\b${EXAGERO_DE_MATAR}`,
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
    fonte: `\\btirar (?:a )?(?:minha|propria|sua|tua) (?:propria )?vida\\b|(?<=\\b${AUXILIAR_DO_INFINITIVO} )tira (?:a )?(?:minha|propria|sua) (?:propria )?vida\\b|\\bacabar com (?:a )?(?:minha|propria) vida\\b|(?<=\\b${AUXILIAR_DO_INFINITIVO} )acaba com (?:a )?(?:minha|propria) vida\\b|\\bdar fim (?:a|na) (?:minha )?vida\\b`,
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
      "\\b(?:vou|vo|quero|qro|kero|queria|qria|keria|vontade de|penso em|pensando em|pensei em|decidi|resolvi|(?:dise|falou|fala|diz|escreveu|avisou|ameacou|ameaca) (?:que|q) (?:vai|ia|vou|quer|queria)|ameacou|ameaca|ameacando|(?:ele|ela) (?:vai|quer|queria|ta querendo|esta querendo|ta pensando em|esta pensando em|pensa em)) acabar? com tudo\\b(?! (?:de|da|do|das|dos|na|no|nas|nos|em|que|nese|nesa|neste|nesta)\\b)(?! (?:iso|isto|aquilo) (?:de|da|do|das|dos|que|na|no|em)\\b)(?!\\s*[:,]?\\s*(?:(?:as|os|a|o|minhas|meus|minha|meu|eses|esas) )?(?:rugas?|manchas?|flacidez|celulite|estrias?|olheiras?|acne|espinhas?|cravos?|papada|gordura|gordurinhas?|pelos?|melasma|cicatriz|cicatrizes|marcas?|linhas?|vincos?|sinais)\\b)",
  },
  { nome: "suicidio", tipo: "risco_de_vida", fonte: "\\bsuicid\\w*" },
  {
    nome: "nao_quero_mais_viver",
    tipo: "risco_de_vida",
    // Revisao R2 de d1a15f6 (A3): "n quero mais viver", "ñ aguento mais
    // viver", "kero", "nao aguento mais essa vida", "nao vale a pena viver"
    // e "nao tenho mais forcas pra viver".
    fonte:
      `\\b(?:${NAO} (?:quero|qro|kero|queria|qria|aguento|consigo|tenho (?:mais )?vontade de|vejo sentido em)|sem vontade de|cansad[oa] de) (?:mais )?viver?\\b|\\b(?:vida|viver) nao (?:tem|faz) (?:mais )?sentido\\b` +
      `|\\b${NAO} aguento mais (?:esa|esta|a|minha) vida\\b` +
      `|\\b${NAO} vale (?:mais )?a pena (?:viver|continuar vivendo|continuar viv[oa]|estar viv[oa])\\b|\\b(?:viver|a vida|minha vida) nao vale (?:mais )?a pena\\b` +
      `|\\b${NAO} tenho (?:mais )?(?:forca|forcas|animo|vontade) (?:pra|para|de) (?:viver|continuar)\\b`,
  },
  {
    // Revisao de 30/10/2026 (lacuna): "nao vejo mais sentido na vida" e a
    // outra pessoa ("ela diz que nao ve mais sentido na vida").
    nome: "sem_sentido_na_vida",
    tipo: "risco_de_vida",
    fonte:
      "\\b(?:nao|nem) (?:vejo|ve|via|encontro|encontra|acho|acha|tenho|tem|sinto|sente) (?:mais )?(?:nenhum |algum )?sentido (?:na|em|pra|para) (?:minha |a |esa |esta )?(?:vida|viver|continuar)\\b",
  },
  // ---- risco de vida: as lacunas da revisao de 6eae43d (A1) ---------------
  {
    // "Vou me enforcar hoje", "ela tentou se enforcar". O "enforcar o
    // feriado" (a folga entre o feriado e o fim de semana) nao tem o "me"
    // nem o "se".
    nome: "enforcar",
    tipo: "risco_de_vida",
    fonte:
      "\\b(?:me|se) enforc(?:ar|o|a|ou|ando|aria|ei|aram)\\b|\\benforcamento\\b",
  },
  {
    // "Vou me jogar do predio", "vou pular da ponte", "ela ameacou se jogar
    // da janela" (e o viaduto, a sacada, a varanda, o andar alto, o
    // telhado) e se jogar na frente do carro, do onibus ou do trem. Sem o
    // lugar ("quero pular o almoco", "vou me jogar nessa promocao") nao
    // conta.
    nome: "pular_ou_se_jogar",
    tipo: "risco_de_vida",
    fonte:
      `\\b(?:pular|pulo|pulando|pulei|pulou|pularia|me jogar|me jogo|me jogando|me joguei|se jogar|se joga|se jogou|se jogando|se jogaria|me atirar|me atiro|se atirar|se atirou|(?<=\\b${AUXILIAR_DO_INFINITIVO} )(?:pula|me joga|me atira|se atira))(?: \\S+){0,3}? (?:d[oa]s?|de uma?|de cima d[oa]|do alto d[oa]|pela|pelo) (?:\\S+ )?(?:ponte|predio|predios|janela|janelas|sacada|varanda|viaduto|teraco|laje|telhado|edificio|penhasco|precipicio|abismo|andar)\\b` +
      "|\\b(?:me jogar|me jogo|me joguei|me jogando|se jogar|se joga|se jogou|se jogando|me atirar|se atirar) na frente d[oe] (?:um |uma |o |a )?(?:caro|onibus|caminhao|trem|metro|moto)\\b",
  },
  {
    // O remedio de uma vez, em quantidade ("tomei 20 comprimidos de
    // rivotril", "tomei a cartela inteira de remedio pra dormir", "tomei
    // todos os comprimidos da cartela", "um monte de remedio", "ela tomou
    // remedio demais") e a intencao ("vou tomar todos os meus remedios").
    // A dose de sempre nao conta: o numero so de 3 para cima ("tomei 2
    // comprimidos de dipirona ontem, posso fazer o procedimento?" e a
    // pergunta do preparo, com a dose comum de 1 ou 2), sem a gota, o mg e o
    // ml; o tratamento ("tomei 3 comprimidos por dia", "tomei todos os
    // remedios que a doutora passou") tambem nao, salvo "de uma vez".
    nome: "remedio_demais",
    tipo: "risco_de_vida",
    fonte:
      `\\b${TOMAR}(?: \\S+){0,3}? ${MUITO_REMEDIO}(?: (?!${UNIDADE_DE_DOSE}\\b)\\S+){0,3}? ${REMEDIO}\\b|\\b${TOMAR}(?: \\S+){0,2}? ${REMEDIO} (?:demais|em exceso)\\b` +
      // Revisao R2 de d1a15f6 (M5): o recipiente ou o remedio INTEIRO ("tomei
      // a caixa inteira", "tomou o xarope inteiro") e o remedio separado para
      // tomar de uma vez ("ja separei os comprimidos pra tomar tudo de uma
      // vez").
      `|\\b${TOMAR}(?: \\S+){0,2}? (?:a|o|os|as|um|uma|tod[oa]s? (?:a|o|os|as)) (?:${RECIPIENTE}|${REMEDIO})(?: \\S+){0,3}? (?:inteir[oa]s?|tod[oa]s?|tudo|cheia|cheio)\\b${NAO_E_REMEDIO}` +
      `|\\b(?:separei|juntei|guardei|comprei|peguei|separou|juntou|guardou)(?: \\S+){0,3}? ${REMEDIO}(?: \\S+){0,3}? (?:pra|para) (?:tomar|engolir)(?: \\S+){0,2}? (?:tudo|todos|todas)(?: \\S+){0,2}? (?:de uma (?:so )?vez|junt[oa]s?)\\b`,
    excecaoDepois: TRATAMENTO_DE_SEMPRE,
    // Revisao R2 de d1a15f6: o numero alto junto do remedio ("tomei 20
    // comprimidos que a doutora passou") e o recipiente inteiro tambem
    // desfazem o tratamento de sempre.
    semExcecaoCom: `${DE_UMA_VEZ}|${REMEDIO_EM_EXCESO}`,
  },
  {
    // Pedido do coordenador: a overdose ("tomei uma overdose", "overdose de
    // remedio", "ela teve uma overdose", "acho que e overdose"). A pergunta
    // de informacao ("o que e overdose de vitamina?", "existe overdose de
    // botox?", "vi uma reportagem sobre overdose") e a figura ("overdose de
    // fofura", "de cafe") nao contam; a negacao tambem nao ("nao foi
    // overdose"). Como todo risco de vida, a historia nao apaga ("ja tive
    // overdose").
    nome: "overdose",
    tipo: "risco_de_vida",
    fonte: "\\bover ?-?doses?\\b|\\b(?:super|sobre)dosage(?:m|ns)\\b",
    excecaoAntes: OVERDOSE_PERGUNTADA,
    excecaoDepois: OVERDOSE_FIGURADA,
  },
  {
    // "Cortei os pulsos", "vou cortar o pulso", "pulsos cortados".
    nome: "cortar_os_pulsos",
    tipo: "risco_de_vida",
    fonte:
      "\\bcort(?:ar|ei|ou|o|a|ando|aram|amos|aria|e)(?: (?:o|os|meu|meus|seu|seus|no|nos))? pulsos?\\b|\\bpulsos? cortad[oa]s?\\b",
  },
  {
    // "To me automutilando", "automutilacao", "autolesao", "me machucar de
    // proposito".
    nome: "automutilacao",
    tipo: "risco_de_vida",
    fonte:
      "\\bauto ?-?mutil\\w*|\\b(?:me|se) mutil\\w*|\\bauto ?-?les(?:ao|oes|iv\\w*)\\b|\\b(?:me|se) machuc\\w* de proposito\\b" +
      // Revisao R2 de d1a15f6 (A3): "fiz uns cortes no braco ontem a noite de
      // proposito", "me cortei de proposito".
      "|\\b(?:me cortei|me cortando|me corto|se cortou|se cortando|me queimei|me queimando|cortes?|cortei|queimei)\\b(?: \\S+){0,6}? de proposito\\b",
  },
  {
    // "Escrevi uma carta de despedida", "deixei um bilhete de adeus". A
    // despedida de solteira e a festa de despedida nao tem a carta.
    nome: "carta_de_despedida",
    tipo: "risco_de_vida",
    fonte:
      "\\b(?:carta|cartas|cartinha|bilhete|bilhetes) de (?:despedida|adeus)\\b",
  },
  {
    // "Nao vejo mais motivo pra viver", "nao tenho razao pra viver", "sem
    // motivo pra continuar vivendo", "que motivo eu tenho pra viver?". O
    // motivo dito ("meus filhos sao meu motivo pra viver") nao tem a
    // negacao e nao casa; a negacao faz parte do sinal.
    nome: "sem_motivo_pra_viver",
    tipo: "risco_de_vida",
    fonte:
      "\\b(?:(?:nao|nem) (?:\\S+ ){0,3}?|(?:sem|nenhum|nenhuma|perdi o|perdi a|perdeu o|perdeu a|que|qual) (?:\\S+ ){0,2}?)(?:motivo|motivos|razao|razoes)(?: (?:nenhum|nenhuma|algum|alguma))?(?: \\S+){0,2}? (?:pra|para|de) (?:continuar )?(?:viver|vivendo|vivo|viva|existir)\\b",
  },
  {
    // "Queria nao ter nascido", "preferia nao ter nascido", "nao devia ter
    // nascido", "pra que eu nasci?". O "queria ter nascido com o nariz
    // menor" nao tem a negacao, e o "por que nasci com esse nariz" tem o
    // complemento.
    nome: "nao_ter_nascido",
    tipo: "risco_de_vida",
    fonte:
      "\\b(?:queria|quero|preferia|prefiro|gostaria de|melhor|devia|deveria|era pra|quisera)(?: (?:eu|que eu|se eu|mesmo))? (?:nao|nunca) (?:ter|tivese) nascido\\b|\\b(?:nao|nunca) (?:devia|deveria|devese) ter nascido\\b|\\b(?:pra|para|por) que (?:eu )?nasci(?=\\s*$|\\s*[.!?,;:])",
  },
  // ---- risco de vida: revisao R2 de d1a15f6 (A3 e M4) ----------------------
  {
    // "Morrer seria um alivio", "seria um alivio se eu morresse".
    nome: "morrer_seria_alivio",
    tipo: "risco_de_vida",
    fonte:
      "\\b(?:morer|more) (?:seria|e|eh|ia ser|vai ser|sera) (?:um |uma |o |a )?(?:alivio|solucao|descanso|melhor saida|melhor coisa)\\b|\\b(?:seria|e|eh|sera) (?:um |uma )?(?:alivio|descanso|solucao) (?:se eu )?(?:morer|more|morese|sumir|sumise)\\b",
  },
  {
    // "To pensando em sumir pra sempre", "eu so queria sumir, acabar com
    // tudo isso". O "sumir de vergonha" e o "sumir do mapa" nao.
    nome: "sumir",
    tipo: "risco_de_vida",
    fonte: `\\b(?:${QUERER}|to pensando em|tou pensando em|estou pensando em|vou|vo)(?: so)? sumir (?:pra sempre|para sempre|dese mundo|deste mundo|do mundo|de vez|e nunca mais voltar|e acabar com tudo)\\b|\\bsumir,? (?:e |pra |para )?acabar com tudo\\b`,
  },
  {
    // "Todo mundo ficaria melhor sem mim", "seria melhor pra todo mundo se
    // eu nao existisse", "ninguem vai sentir minha falta".
    nome: "melhor_sem_mim",
    tipo: "risco_de_vida",
    fonte:
      "\\b(?:todo mundo|todos|minha familia|meus filhos|eles|elas) (?:ficaria|ficariam|seria|seriam|estaria|estariam|vai ficar|vao ficar|ia ficar|iam ficar|fica|ficam) (?:\\S+ )?(?:melhor|melhores|mais feliz|mais felizes|em paz) sem mim\\b|\\b(?:melhor|preferivel)(?: (?:pra|para) (?:todo mundo|todos|minha familia|eles))? (?:se |que )?eu (?:nao existise|nao existir|nao estivese aqui|sumise|morese|nao tivese nascido)\\b|\\bninguem (?:vai|iria|ia) sentir (?:a )?minha falta\\b",
  },
  {
    // A corda para acabar com tudo ("to com uma corda aqui pra acabar com
    // tudo").
    nome: "corda",
    tipo: "risco_de_vida",
    fonte:
      "\\bcordas?\\b(?: \\S+){0,5}? (?:pra|para) (?:acabar com tudo|acabar com (?:a )?minha vida|me enforcar|morer|me matar|dar fim)\\b",
  },
  {
    // Revisao R2 de d1a15f6 (M4): a outra pessoa ameacada de morte ("o
    // namorado da minha filha disse que vai matar ela", "ameacou matar a
    // gente", "recebi ameaca de morte"). "Matar a saudade", "matar aula" e
    // "matar a fome" nao tem a pessoa.
    nome: "ameaca_de_morte",
    tipo: "risco_de_vida",
    fonte: `\\b(?:dise|falou|fala|diz|dizendo|disendo|jurou|prometeu|avisou|escreveu|gritou|gritando|mandou mensagem)(?: \\S+){0,2}? (?:que|q) (?:vai|ia|iria|vao|quer) mat(?:ar|a) ${PESSOA_AMEACADA}\\b|\\b(?:ameacou|ameaca|ameacando|ameacava|tentou|tentando|tenta|tentaram) (?:de )?mat(?:ar|a) ${PESSOA_AMEACADA}\\b|\\bameacas? de morte\\b`,
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
 * Revisao de 6eae43d (M2): o verbo de CAUSA logo antes do sinal fisico, na
 * mesma oracao ("botox DA falta de ar?", "PODE DAR falta de ar?", "CAUSA
 * convulsao?", "tem risco de"). Sem o "me da" ("me da falta de ar" e o
 * relato) e sem "e normal dar" / "e comum dar" (quem pergunta se e normal
 * pode estar sentindo agora).
 */
const CAUSA_PERGUNTADA = new RegExp(
  "(?:(?<!\\b(?:me|normal|comum) )\\b(?:da|dao|dar|deixa|deixar)|\\b(?:pode (?:me )?dar|pode (?:me )?deixar|podem (?:me )?deixar|poderia (?:me )?deixar|costuma deixar|vai (?:me )?deixar|podem (?:me )?dar|poderia (?:me )?dar|costuma dar|costumam dar|vai (?:me )?dar|causa|causam|causar|pode causar|podem causar|provoca|provocam|provocar|pode provocar|e perigoso (?:dar|causar)|tem risco de|core risco de|existe risco de|risco de|riscos de|chance de|chances de|perigo de|poso ter|pode ter|podem ter|vou ter|vai ter))(?: (?:um|uma|o|a|uns|umas|algum|alguma))?\\s*$",
);

/**
 * Revisao R2 de d1a15f6 (alarme falso seguro): a HIPOTESE logo antes do
 * sinal fisico ("tenho pavor de ficar com a boca torta", "e se eu tiver uma
 * reacao alergica forte no procedimento?"): o medo e a condicao, nao o
 * relato.
 */
const HIPOTESE_ANTES = new RegExp(
  "\\b(?:(?:medo|pavor|receio|panico) de (?:ficar|ter|dar|sentir|acontecer)(?: com)?|(?:se|caso) (?:eu |ela |ele )?(?:tiver|tivese|sentir|der|acontecer|ficar com))(?: (?:um|uma|algum|alguma|a|o))?\\s*$",
);

/**
 * Revisao R2 de d1a15f6 (M4: a regra que generalizou): o RELATO de agora em
 * qualquer ponto da leitura desfaz a pergunta sobre o efeito e a hipotese
 * ("botox pode dar falta de ar? to sentindo agora", "fiz botox ontem, pode
 * dar falta de ar?", "tomei a vacina, pode dar falta de ar?").
 */
const RELATO_DE_AGORA =
  /\b(?:agora|agorinha|agr|neste momento|nese momento|(?:to|tou|estou|ta|esta) sentindo|comecei a sentir|comecou a|ta acontecendo|esta acontecendo|socoro|me ajud\w*|fiz|apliquei|tomei|coloquei|operei|acabei de|acabou de)\b/;

/** O fim da frase (o "?" diz que a frase do sinal e uma pergunta). */
const FIM_DA_FRASE = /[.!?\n]/;

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

/** Os fins de frase e as retomadas, na leitura inteira (para o indice). */
const FINS_DE_FRASE = new RegExp(FIM_DA_FRASE.source, "g");
const RETOMADAS = new RegExp(RETOMADA.source, "g");

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

/** Um trecho da leitura: onde comeca e onde acaba (sem incluir). */
type Trecho = { inicio: number; fim: number };

/**
 * Revisao R2 de d1a15f6 (B5, o tempo LINEAR): os indices de uma leitura,
 * achados uma vez so. Antes, cada sinal casado relia o texto desde o comeco
 * (o comeco da oracao, o fim da frase, a excecao da mensagem e o que a
 * desfaz): "dor forte " repetido levava 4 segundos em 65.536 caracteres.
 * Aqui: os fins de oracao, os " e ", os fins de frase e as retomadas, na
 * ordem; e o que ja foi testado num trecho FIXO (a leitura inteira, a
 * mensagem, a oracao anterior, a oracao, a parte da oracao), para nao
 * testar de novo a cada sinal casado.
 */
type Indice = {
  fins: readonly Trecho[];
  es: readonly Trecho[];
  frases: readonly Trecho[];
  retomadas: readonly Trecho[];
  memo: Map<string, boolean>;
};

/**
 * Uma leitura: o texto lido, onde fica cada mensagem nele (um texto so: uma
 * mensagem; a juncao: as mensagens na ordem, separadas por espaco) e o
 * indice.
 */
type Leitura = {
  texto: string;
  mensagens: readonly Trecho[];
  indice: Indice;
};

function trechosDe(texto: string, regex: RegExp): Trecho[] {
  return [...texto.matchAll(regex)].map((m) => ({
    inicio: m.index ?? 0,
    fim: (m.index ?? 0) + m[0].length,
  }));
}

function indexar(texto: string): Indice {
  return {
    fins: trechosDe(texto, FIM_DA_ORACAO),
    es: trechosDe(texto, E_DA_ORACAO),
    frases: trechosDe(texto, FINS_DE_FRASE),
    retomadas: trechosDe(texto, RETOMADAS),
    memo: new Map(),
  };
}

/** O ultimo trecho da lista (na ordem, sem sobrepor) que acaba ate a posicao. */
function ultimoAte(
  lista: readonly Trecho[],
  posicao: number,
): Trecho | undefined {
  let baixo = 0;
  let alto = lista.length;
  while (baixo < alto) {
    const meio = (baixo + alto) >>> 1;
    if ((lista[meio]?.fim ?? Number.POSITIVE_INFINITY) <= posicao) {
      baixo = meio + 1;
    } else {
      alto = meio;
    }
  }
  return lista[baixo - 1];
}

/** O primeiro trecho da lista (na ordem) que comeca a partir da posicao. */
function primeiroDesde(
  lista: readonly Trecho[],
  posicao: number,
): Trecho | undefined {
  let baixo = 0;
  let alto = lista.length;
  while (baixo < alto) {
    const meio = (baixo + alto) >>> 1;
    if ((lista[meio]?.inicio ?? Number.POSITIVE_INFINITY) < posicao) {
      baixo = meio + 1;
    } else {
      alto = meio;
    }
  }
  return lista[baixo];
}

/**
 * A posicao no meio de uma palavra. O sinal comeca e acaba na borda da
 * palavra, e o fim de oracao tambem: o indice vale para todas as posicoes
 * que a leitura pergunta. Mesmo assim, no meio da palavra (onde o recorte
 * mudaria o \b), a leitura volta ao recorte de antes: o resultado e sempre
 * o do recorte.
 */
const LETRA_DE_PALAVRA = /\w/;
function noMeioDaPalavra(texto: string, posicao: number): boolean {
  return (
    LETRA_DE_PALAVRA.test(texto.charAt(posicao - 1)) &&
    LETRA_DE_PALAVRA.test(texto.charAt(posicao))
  );
}

/**
 * Onde comeca a oracao da posicao (depois do ultimo fim de oracao antes
 * dela) e onde comeca esse fim (-1: a oracao e a primeira).
 */
function inicioDaOracao(
  leitura: Leitura,
  posicao: number,
): { inicio: number; fim: number } {
  if (noMeioDaPalavra(leitura.texto, posicao)) {
    let inicio = 0;
    let fim = -1;
    for (const m of leitura.texto.slice(0, posicao).matchAll(FIM_DA_ORACAO)) {
      fim = m.index ?? 0;
      inicio = fim + m[0].length;
    }
    return { inicio, fim };
  }
  const ultimo = ultimoAte(leitura.indice.fins, posicao);
  return ultimo === undefined
    ? { inicio: 0, fim: -1 }
    : { inicio: ultimo.fim, fim: ultimo.inicio };
}

/** Onde acaba a oracao que comeca antes da posicao (no proximo fim). */
function fimDaOracao(leitura: Leitura, posicao: number): number {
  const { texto } = leitura;
  if (noMeioDaPalavra(texto, posicao)) {
    const corte = texto.slice(posicao).search(PRIMEIRO_FIM_DA_ORACAO);
    return corte === -1 ? texto.length : posicao + corte;
  }
  return primeiroDesde(leitura.indice.fins, posicao)?.inicio ?? texto.length;
}

/**
 * Revisao R2 de d1a15f6 (B5): o que se le ANTES do sinal na oracao (a
 * negacao, a pergunta, a excecao de antes e a historia) e uma JANELA das
 * ultimas 400 letras, a partir da borda de uma palavra; DEPOIS (a marca de
 * tempo da historia), as primeiras 400. A negacao, a pergunta e a excecao
 * presa ao sinal sao as ultimas palavras e cabem inteiras; o que fica mais
 * longe (so numa oracao de mais de 400 letras sem pontuacao) nao apaga o
 * sinal: o lado seguro. O que DESFAZ a historia ou a excecao (o agora, o
 * presente, a retomada, o semExcecaoCom) le o trecho inteiro, uma vez so.
 */
const JANELA = 400;

/** As ultimas letras do trecho, a partir da borda de uma palavra. */
function finalDaJanela(trecho: string): string {
  if (trecho.length <= JANELA) {
    return trecho;
  }
  const corte = trecho.indexOf(" ", trecho.length - JANELA);
  return corte === -1 ? "" : trecho.slice(corte + 1);
}

/** As primeiras letras do trecho, ate a borda de uma palavra. */
function comecoDaJanela(trecho: string): string {
  if (trecho.length <= JANELA) {
    return trecho;
  }
  const corte = trecho.lastIndexOf(" ", JANELA);
  return corte === -1 ? "" : trecho.slice(0, corte);
}

/** O trecho da mesma oracao antes da posicao. */
function oracaoAntes(leitura: Leitura, posicao: number): string {
  return leitura.texto.slice(inicioDaOracao(leitura, posicao).inicio, posicao);
}

/** O trecho da mesma oracao depois da posicao. */
function oracaoDepois(leitura: Leitura, posicao: number): string {
  return leitura.texto.slice(posicao, fimDaOracao(leitura, posicao));
}

/** A oracao inteira que acaba logo antes da oracao da posicao. */
function oracaoAnterior(leitura: Leitura, posicao: number): Trecho {
  const { fim } = inicioDaOracao(leitura, posicao);
  return fim < 0
    ? { inicio: 0, fim: 0 }
    : { inicio: inicioDaOracao(leitura, fim).inicio, fim };
}

/**
 * O que depende so de um trecho FIXO da leitura (a leitura inteira, a
 * mensagem, a oracao anterior, a oracao, a parte da oracao), calculado uma
 * vez so: o mesmo resultado para todo sinal casado nele.
 */
function lembrar(
  leitura: Leitura,
  chave: string,
  calcular: () => boolean,
): boolean {
  const salvo = leitura.indice.memo.get(chave);
  if (salvo !== undefined) {
    return salvo;
  }
  const resultado = calcular();
  leitura.indice.memo.set(chave, resultado);
  return resultado;
}

/** O teste de uma regex num trecho fixo da leitura, uma vez so. */
function testarUmaVez(
  leitura: Leitura,
  chave: string,
  regex: RegExp,
  trecho: Trecho,
): boolean {
  return lembrar(leitura, `${chave}:${trecho.inicio}:${trecho.fim}`, () =>
    regex.test(leitura.texto.slice(trecho.inicio, trecho.fim)),
  );
}

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
    const mensagens: Trecho[] = [];
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
      leituras.push({ texto, mensagens, indice: indexar(texto) });
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
): Trecho {
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
  return comeco === -1
    ? { inicio: 0, fim: leitura.texto.length }
    : { inicio: comeco, fim: final };
}

/**
 * O sinal que ja traz a propria negacao ("nao consigo respirar", "nao para
 * de sangrar"): o "nao" logo antes e enfase ("nao, nao consigo respirar"),
 * nunca a negacao do sinal. O "sem" nao entra: "nao estou sem ar" nega.
 */
const SINAL_COM_A_PROPRIA_NEGACAO = /^(?:nao|nem|n|naum) /;

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
 * A pergunta sobre o efeito (so nos sinais fisicos; revisao de 6eae43d): o
 * verbo de causa logo antes do sinal, na mesma oracao, e a frase do sinal
 * acaba em "?" ("botox da falta de ar?", "pode dar falta de ar?").
 */
function perguntaDoEfeito(
  leitura: Leitura,
  antes: string,
  fim: number,
): boolean {
  if (!CAUSA_PERGUNTADA.test(antes)) {
    return false;
  }
  const fimDaFrase = primeiroDesde(leitura.indice.frases, fim);
  return (
    fimDaFrase !== undefined && leitura.texto.charAt(fimDaFrase.inicio) === "?"
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
function ehHistoria(leitura: Leitura, inicio: number, fim: number): boolean {
  const { texto, indice } = leitura;
  const comeco = inicioDaOracao(leitura, inicio).inicio;
  const final = fimDaOracao(leitura, fim);
  // A parte da oracao do sinal: do ultimo " e " antes dele (na oracao) ao
  // primeiro depois dele (na oracao).
  const eAntes = ultimoAte(indice.es, inicio);
  const corteAntes =
    eAntes !== undefined && eAntes.inicio >= comeco ? eAntes.fim : comeco;
  const eDepois = primeiroDesde(indice.es, fim);
  const corteDepois =
    eDepois !== undefined && eDepois.fim <= final ? eDepois.inicio : final;
  if (
    !antecedenteGoverna(
      finalDaJanela(texto.slice(corteAntes, inicio)),
      texto.slice(inicio, fim),
      comecoDaJanela(texto.slice(fim, corteDepois)),
    )
  ) {
    return false;
  }
  const retomada = primeiroDesde(indice.retomadas, corteDepois);
  return !(
    testarUmaVez(leitura, "agora", AGORA, { inicio: comeco, fim: final }) ||
    testarUmaVez(leitura, "presente", PRESENTE, {
      inicio: corteAntes,
      fim: corteDepois,
    }) ||
    (corteDepois < final && retomada !== undefined && retomada.fim <= final) ||
    lembrar(leitura, `seguinte:${final}`, () =>
      agoraNaOracaoSeguinte(texto.slice(final)),
    )
  );
}

/**
 * Uma excecao do sinal vale, e nada na leitura a desfaz (a excecao tira a
 * urgencia e le estreito; o que desfaz a devolve e le a leitura inteira).
 */
function excecaoVale(
  leitura: Leitura,
  compilado: SinalCompilado,
  trechos: { inicio: number; fim: number; antes: string; depois: string },
): boolean {
  const { nome } = compilado.sinal;
  if (
    compilado.semExcecaoCom !== null &&
    testarUmaVez(leitura, `${nome}:desfaz`, compilado.semExcecaoCom, {
      inicio: 0,
      fim: leitura.texto.length,
    })
  ) {
    return false;
  }
  return (
    compilado.excecaoAntes?.test(trechos.antes) === true ||
    compilado.excecaoDepois?.test(trechos.depois) === true ||
    (compilado.excecaoNaOracaoAnterior !== null &&
      testarUmaVez(
        leitura,
        `${nome}:anterior`,
        compilado.excecaoNaOracaoAnterior,
        oracaoAnterior(leitura, trechos.inicio),
      )) ||
    (compilado.excecaoNaMensagem !== null &&
      testarUmaVez(
        leitura,
        `${nome}:mensagem`,
        compilado.excecaoNaMensagem,
        mensagemDoSinal(leitura, trechos.inicio, trechos.fim),
      ))
  );
}

/**
 * O sinal casou numa leitura, fora da negacao, das excecoes (da oracao e da
 * mesma mensagem) e, no fisico, da historia.
 */
function sinalNaLeitura(leitura: Leitura, compilado: SinalCompilado): boolean {
  for (const m of leitura.texto.matchAll(compilado.regex)) {
    const inicio = m.index ?? 0;
    const fim = inicio + m[0].length;
    const antes = finalDaJanela(oracaoAntes(leitura, inicio));
    const depois = oracaoDepois(leitura, fim);
    if (
      !SINAL_COM_A_PROPRIA_NEGACAO.test(m[0]) &&
      NEGACAO_ANTES.test(antes) &&
      !negacaoEnfatica(antes, m[0], depois)
    ) {
      continue;
    }
    if (
      compilado.sinal.tipo === "fisica" &&
      compilado.sinal.semPergunta !== true &&
      (perguntaDoEfeito(leitura, antes, fim) || HIPOTESE_ANTES.test(antes)) &&
      !lembrar(leitura, "relato", () => RELATO_DE_AGORA.test(leitura.texto))
    ) {
      continue;
    }
    if (excecaoVale(leitura, compilado, { inicio, fim, antes, depois })) {
      continue;
    }
    if (
      compilado.sinal.tipo === "fisica" &&
      compilado.sinal.semAntecedente !== true &&
      ehHistoria(leitura, inicio, fim)
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
  CAUSA_PERGUNTADA.source,
  FIM_DA_FRASE.source,
  HIPOTESE_ANTES.source,
  RELATO_DE_AGORA.source,
];

/**
 * O que define a urgencia, para a versao do portao (fontesDoPortao,
 * filtro.ts): cada sinal (tipo, nome, fonte, as excecoes, o que as desfaz, o
 * antecedente e a pergunta), as regras de leitura e o modo de ler. Sem hash
 * aqui: roda no navegador.
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
      sinal.semPergunta === true ? "sem pergunta" : "",
    ].join(" "),
  ),
  ...REGRAS_DE_LEITURA_DA_URGENCIA,
  `leitura: as visoes do portao com as neutralizacoes de entrada, sem letra repetida; cada texto sozinho e a juncao das visoes na ordem; a excecao da mensagem le so a mensagem do sinal; linear: os indices da leitura achados uma vez, o trecho fixo testado uma vez e a janela de ${JANELA} letras antes e depois do sinal na oracao`,
  "risco_de_vida vence fisica; o antecedente so nos sinais fisicos, so quando governa o sinal (a oracao quebra no e) e nunca no socorro nem no sangramento; a pergunta sobre o efeito (o verbo de causa logo antes e a frase acabando em ?) so nos sinais fisicos e nunca na complicacao do preenchimento feito; a hipotese logo antes, como a pergunta; o relato de agora na leitura desfaz a pergunta e a hipotese; urgencia e o primeiro gatilho de entrada",
];
