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
// dos sinais). Falso negativo: cai no "sintoma", sem a marca (o de hoje).
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
// continua valendo.
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
//    oracao anterior ou na mensagem inteira (cada sinal diz quais);
//  - o ANTECEDENTE (so nos sinais fisicos; revisao de 28/10/2026): a
//    historia contada ("ja desmaiei tirando sangue", "ja tive choque
//    anafilatico", "as vezes falta de ar", "quando eu era crianca") nao e
//    emergencia AGORA. Com "agora", "hoje", "de novo" ou "acabei de" na
//    mesma oracao, volta a contar ("ja desmaiei duas vezes hoje"). O risco
//    de vida nunca tem antecedente: "ja pensei em suicidio" passa como
//    urgencia (o lado conservador; o falso negativo ali nao escala por
//    nenhum outro gatilho).
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
   * familiar", "e emergencia nao").
   */
  excecaoDepois?: string;
  /**
   * A excecao lida na ORACAO ANTERIOR, a que acaba logo antes da do sinal
   * ("tentei ligar varias vezes, nao consigo falar").
   */
  excecaoNaOracaoAnterior?: string;
  /**
   * A excecao lida na mensagem INTEIRA (com mais de um texto, na juncao: a
   * rajada inteira): casou, o sinal nao conta em lugar nenhum dela ("fiz
   * botox e minha boca ficou torta").
   */
  excecaoNaMensagem?: string;
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

/** O verbo de quem chama ou espera o socorro ("chama o SAMU"). */
const CHAMAR_O_SOCORRO =
  "(?:chamar|chama|chame|chamem|chamei|chamou|chamaram|chamamos|chamando|ligar|liga|ligue|liguem|liguei|ligou|ligaram|ligamos|ligando|acionar|aciona|acione|acionei|acionou|acionaram|esperando|aguardando|preciso d[ae]|precisa d[ae]|precisando d[ae])";

/**
 * As palavras que reforcam a dor ("uma dor muito forte no peito", "uma dor
 * assim no peito").
 */
const REFORCO_DA_DOR =
  "(?:muito|mto|mt|bem|super|tao|forte|fortes|intensa|intenso|aguda|horivel|terivel|insuportavel|esquisita|estranha|enorme|grande|grave|fortisima|absurda|danada|aqui|ai|la|asim)";

/** Expressoes de exagero que nao sao risco de vida ("morrer de rir"). */
const EXAGERO_DE_MORRER =
  "(?! de (?:tanto|rir|vergonha|fome|sede|calor|frio|saudade|saudades|medo|tedio|sono|inveja|preguica|cansaco|curiosidade|amor|ciume|raiva|susto|felicidade|alegria|emocao|orgulho|chorar|dor de cabeca)\\b)";

/**
 * "me matar de rir", "se matando de trabalhar" e, na revisao de 28/10/2026,
 * "vou me matar na academia", "me matando no trabalho".
 */
const EXAGERO_DE_MATAR =
  "(?! de (?:tanto|rir|trabalhar|estudar|fome|vergonha|cansaco|treinar|malhar|corer|comer)\\b)(?! (?:na|no) (?:academia|treino|trabalho|servico|dieta|esteira|corida|estudo|estudos)\\b)";

/**
 * As palavras do telefone e do atendimento: "nao consigo falar" com elas e
 * nao conseguir falar COM a clinica, nao a fala.
 */
const TELEFONE_OU_ATENDIMENTO =
  "\\b(?:lig\\w*|telefon\\w*|chamada|chamadas|audio|audios|whats\\w*|zap\\w*|atend\\w*|recepc\\w*|secretaria|ocupad\\w*|caixa postal|respond\\w*|retorn\\w*)\\b";

/**
 * O procedimento ja feito na mensagem ("fiz botox", "depois do
 * preenchimento", "o botox deixou"): a boca torta depois dele e efeito do
 * procedimento, como a palpebra caida (D-51 mantem "sintoma").
 */
const PROCEDIMENTO = "(?:botox|toxina|botulinica|aplicacao|aplicacoes|prenchimento|prenchimentos|harmonizacao|bichectomia|procedimento|fios|lifting|bioestimulador)";
const PROCEDIMENTO_FEITO = `\\b(?:fiz|fez|fizemos|fizeram|apliquei|aplicou|aplicaram|coloquei|colocou|tomei|tomou|depois d[oa]s?|depois que fiz|apos (?:o|a|os|as)|desde (?:o|a|os|as)|por causa d[oa]s?|com (?:o|a|os|as))(?: \\S+){0,2}? ${PROCEDIMENTO}\\b|\\b${PROCEDIMENTO}\\b(?: \\S+){0,2}? (?:deixou|entortou|causou|fez|pegou)\\b`;

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
 * Quem "vai me matar" sem ser a propria pessoa ("meu marido vai me matar",
 * "esse preco vai me matar", "isso vai me matar"): o sujeito e outro, nao e
 * risco de vida. Sem sujeito ("ia me matar"), ou com "eu", continua.
 */
const OUTRO_SUJEITO =
  "(?:(?:(?:o|a|os|as) )?(?:meu|minha|meus|minhas|seu|sua|seus|suas|teu|tua|nosa|noso|nosas|nosos|ese|esa|eses|esas|este|esta|estes|estas|aquele|aquela|o|a|os|as) [a-z]+(?: [a-z]+)?|ele|ela|eles|elas|voce|voces|vc|vcs|iso|isto|aquilo|tudo|ninguem|alguem|a gente)";

/**
 * Uma palavra no meio do sinal ("minha boca FICOU torta", "a lingua DELA
 * ta inchada"), que nunca e a negacao: "minha lingua nao esta inchada" e
 * "a boca nao ficou torta" nao casam (revisao de 28/10/2026: a negacao
 * dentro do sinal, onde a negacao de antes nao olha).
 */
const PALAVRA_DO_MEIO = "(?!(?:nao|nem|nunca|jamais|sem)\\b)\\S+ ";

/**
 * A lista PROPOSTA ao RT (D-51; desenho 5.2), com as variacoes de escrita
 * de cada sinal. Fisica primeiro, risco de vida depois.
 */
export const SINAIS_DE_EMERGENCIA: readonly SinalDeEmergencia[] = [
  // ---- respirar -----------------------------------------------------------
  {
    nome: "falta_de_ar",
    tipo: "fisica",
    fonte: `\\b(?:falta(?: de)?|faltando|faltou)(?: o)? ar\\b${NAO_E_O_AR_DE_RESPIRAR}`,
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
    fonte: "\\b(?:sem|falta de|faltando|perdi o|perdendo o) folego\\b",
    excecaoDepois:
      "^\\s*de (?:tanto|rir|felicidade|emocao|alegria|ansiedade)\\b",
  },
  {
    nome: "nao_consigo_respirar",
    tipo: "fisica",
    fonte:
      "\\b(?:(?:nao|nem) (?:consigo|consegui|conseguia|consegue|conseguimos|to conseguindo|tou conseguindo|estou conseguindo|ta conseguindo|esta conseguindo|estava conseguindo|tava conseguindo)|sem conseguir) (?:mais )?respirar\\b",
  },
  {
    nome: "dificuldade_para_respirar",
    tipo: "fisica",
    fonte:
      "\\bdificuldades? (?:(?:de|para|pra|pa|em|pro) )?respirar\\b|\\bdificuldade respiratoria\\b|\\brespirando com dificuldade\\b",
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
  // ---- desmaio e convulsao ------------------------------------------------
  {
    nome: "desmaio",
    tipo: "fisica",
    fonte: "\\bdesmai(?:ei|ou|ando|aram|amos)\\b|\\bdesmaiad[oa]s?\\b",
  },
  {
    nome: "perdeu_os_sentidos",
    tipo: "fisica",
    fonte:
      "\\bperd(?:i|eu|emos|eram|endo|ido) (?:os sentidos|a consciencia)\\b|\\b(?:ta|esta|ficou|estava|tava) (?:\\S+ )?(?:inconsciente|desacordad[oa])\\b",
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
    nome: "boca_torta",
    tipo: "fisica",
    fonte: `\\bboca (?:${PALAVRA_DO_MEIO}){0,2}?(?:torta|entortou|entortando)\\b`,
    // Revisao de 28/10/2026: depois do botox, da aplicacao ou do
    // preenchimento ("fiz botox e minha boca ficou torta") e efeito do
    // procedimento: continua "sintoma", sem a marca (D-51, como a palpebra
    // caida).
    excecaoNaMensagem: PROCEDIMENTO_FEITO,
  },
  {
    // Revisao de 28/10/2026: o rosto "caido" e "caindo" e a flacidez da
    // estetica ("papada e rosto caindo", "meu rosto caiu depois que
    // emagreci", "rosto caido, quanto custa?"). So conta o rosto torto (ou
    // que entortou), ou caido junto com "de um lado", "metade" ou "de
    // repente" ("o rosto caiu de um lado", "metade do rosto caiu", "de
    // repente o rosto caiu"). Depois do procedimento ("fiz harmonizacao e
    // meu rosto ficou torto") e efeito dele, como a boca torta: "sintoma".
    nome: "rosto_torto_ou_caido",
    tipo: "fisica",
    fonte:
      `\\b(?:rosto|face) (?:${PALAVRA_DO_MEIO}){0,2}?(?:torto|torta|entortou|entortando|entortado)\\b` +
      `|\\b(?:lado|metade|banda) (?:esquerd[oa] |direit[oa] )?d[oa] (?:meu |minha |seu |sua )?(?:rosto|face|cara) (?:${PALAVRA_DO_MEIO}){0,2}?(?:caiu|caido|caida|caindo)\\b` +
      `|\\b(?:rosto|face) (?:${PALAVRA_DO_MEIO}){0,2}?(?:caiu|caido|caida|caindo)(?: \\S+){0,3}? (?:de um lado|so de um lado|do lado (?:esquerdo|direito)|pela metade|de repente|derepente)\\b` +
      `|\\b(?:de repente|derepente)(?: \\S+){0,4}? (?:rosto|face) (?:${PALAVRA_DO_MEIO}){0,2}?(?:caiu|caido|caida|caindo)\\b`,
    excecaoNaMensagem: PROCEDIMENTO_FEITO,
  },
  {
    nome: "fala_enrolada",
    tipo: "fisica",
    fonte: `\\b(?:fala|falando) (?:${PALAVRA_DO_MEIO})?(?:enrolad[ao]|arastad[ao])\\b`,
  },
  {
    // A propria pessoa ("nao consigo falar"). So no fim da oracao: "nao
    // consigo falar com a clinica" e "nao consigo falar agora" nao sao o
    // sinal.
    nome: "nao_consigo_falar",
    tipo: "fisica",
    fonte:
      "\\b(?:nao|nem) (?:consigo|to conseguindo|tou conseguindo|estou conseguindo) (?:mais )?falar(?: direito)?(?=\\s*$|\\s*[.!?,;:]|\\s+e\\b)",
    // Ligacao, atendimento ou alguem da clinica: e o telefone, nao a fala.
    excecaoAntes:
      "\\b(?:lig\\w*|telefon\\w*|chamada|chamadas|audio|whats|zap|zapzap|atend\\w*|recepc\\w*|secretaria|clinica|alguem|ninguem|voces|vcs|vc|doutor\\w*|dra|dr|medic\\w*)\\b",
    // Revisao de 28/10/2026: o telefone tambem na oracao anterior ("tentei
    // ligar varias vezes, nao consigo falar.", "a recepcao nao atende, nao
    // consigo falar").
    excecaoNaOracaoAnterior: TELEFONE_OU_ATENDIMENTO,
  },
  {
    // Outra pessoa ("minha mae nao consegue falar", "liguei pra ela, ela
    // nao consegue falar"): a oracao anterior com o telefone NAO desfaz
    // (revisao de 28/10/2026; quem liga e descobre que a pessoa nao fala e
    // o sinal).
    nome: "nao_consegue_falar",
    tipo: "fisica",
    fonte:
      "\\b(?:nao|nem) (?:consegue|conseguia|ta conseguindo|esta conseguindo) (?:mais )?falar(?: direito)?(?=\\s*$|\\s*[.!?,;:]|\\s+e\\b)",
    excecaoAntes:
      "\\b(?:lig\\w*|telefon\\w*|chamada|chamadas|audio|whats|zap|zapzap|atend\\w*|recepc\\w*|secretaria|clinica|alguem|ninguem|voces|vcs|vc|doutor\\w*|dra|dr|medic\\w*)\\b",
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
    // inflamada da gripe nao conta (continua "sintoma"), nem a negacao no
    // meio ("minha lingua nao esta inchada").
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
  // ---- sangramento --------------------------------------------------------
  {
    nome: "sangrando_muito",
    tipo: "fisica",
    fonte:
      "\\bsangrando (?:muito|mto|mt|demais|bastante|sem parar|tanto|um monte|horores)\\b",
  },
  {
    nome: "nao_para_de_sangrar",
    tipo: "fisica",
    fonte:
      "\\b(?:nao|nem) (?:para|parou|ta parando|esta parando|quer parar|consigo parar|consegue parar|conseguimos parar|estanca|estancou) de sangrar\\b|\\b(?:sangue|sangramento) (?:que )?(?:nao|nem) (?:para|parou|estanca|estancou)\\b",
  },
  {
    nome: "muito_sangue",
    tipo: "fisica",
    fonte:
      "\\b(?:muito|mto|mt|bastante|tanto|um monte de) sangue\\b|\\bsangue (?:demais|pra todo lado)\\b",
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
    // "o plano cobre emergencia?") e o lugar onde ja esteve ("fui na
    // emergencia ontem") nao sao a emergencia agora.
    excecaoAntes:
      "\\b(?:(?:contato|contatos|telefone|telefones|numero|numeros|fone|celular|whats|whatsap|ramal|pesoa|saida|saidas|kit|luz|luzes|freio|botao|fundo|porta|portas|escada|plantao|servico|servicos) (?:de|da|pra|para)|(?:em|no|num) caso de|se (?:for|tiver|houver|der|acontecer|precisar)(?: de)?(?: uma| um| alguma| algum)?)\\s*$" +
      "|\\b(?:encaixe|encaixes|encaixar|encaixa|horario|horarios|vaga|vagas|agenda|agendamento|marcacao|consulta|consultas|retorno) (?:de|em|para|pra)\\s*$" +
      "|\\b(?:surgiu|surgiram|apareceu|aconteceu|tive|teve|tivemos|tinha|houve|deu|rolou|ocoreu)(?: (?:uma|um|umas|uns|outra|outro))?(?: (?:pequena|pequeno|grande|baita))?\\s*$" +
      "|\\b(?:atende|atendem|faz|fazem|cobre|cobrem|aceita|aceitam|oferece|oferecem|trabalha|trabalham)(?: \\S+){0,2}?\\s*$" +
      "|\\b(?:voces|vcs|vc|clinica|consultorio) (?:tem|teriam)(?: \\S+){0,2}?\\s*$" +
      "|\\b(?:fui|foi|fomos|foram|levei|levou|levaram|estive|esteve|pasei|pasou|sai|saiu|voltei|voltou|atendid[oa]|internad[oa]|(?:tive|teve|tivemos|precisei|precisou) (?:que |de )?ir) (?:\\S+ ){0,2}?(?:na|da|pra|para a|a|numa)\\s*$",
    // Depois: "emergencia familiar", "no trabalho", "do hospital" e o "nao"
    // que fecha a oracao ("e emergencia nao", "emergencia nenhuma").
    excecaoDepois:
      "^\\s*(?:familiar|familiares|de familia|na familia|em familia|pesoal|particular|no trabalho|do trabalho|no servico|do servico|no emprego|do emprego|d[oa] (?:hospital|upa|pronto socoro|posto|clinica)\\b|(?:que )?(?:apareceu|surgiu|aconteceu)\\b|(?:nao|nenhuma)(?:\\s+(?:viu|ta|tah|ok|ne|so|k|rs\\w*))*\\s*$)",
  },
  {
    nome: "chamar_o_socorro",
    tipo: "fisica",
    // "Chama o SAMU", "liguei pro 192", "a ambulancia esta a caminho". O
    // SAMU citado sem o pedido ("o SAMU fica perto dai?") nao conta.
    fonte: `\\b${CHAMAR_O_SOCORRO}(?: (?:o|a|um|uma|pro|pra|para|ao|no|na|de|do|da))?(?: (?:o|a))? (?:samu|ambulancia|192)\\b|\\b(?:samu|ambulancia) (?:(?:ja|ta|esta) )?(?:a caminho|vindo|chegando|chegou|veio|levou|levando)\\b`,
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
    // "vou me matar", "pensei em me matar". Revisao de 28/10/2026: com o
    // sujeito que nao e a pessoa ("meu marido vai me matar", "esse preco vai
    // me matar", "isso vai me matar", "essa dieta ta me matando") nao e risco
    // de vida. Sem sujeito ("ia me matar") ou com "eu" ("eu ia me matar"),
    // continua. A ameaca de outra pessoa ("meu ex quer me matar") tambem
    // continua: o "quer" fica fora da excecao (o lado conservador).
    nome: "me_matar",
    tipo: "risco_de_vida",
    fonte: `\\bme mat(?:ar|o|ando)\\b${EXAGERO_DE_MATAR}`,
    excecaoAntes: `\\b${OUTRO_SUJEITO} (?:(?:ainda|asim|quase) )?(?:vai|vao|ia|iam|ta|tao|esta|estao|vive)\\s*$`,
  },
  {
    // Outra pessoa em risco ("ela disse que vai se matar") continua sendo
    // risco de vida: a conversa passa como urgente.
    nome: "se_matar",
    tipo: "risco_de_vida",
    fonte: `\\bse mat(?:ar|o|ando)\\b${EXAGERO_DE_MATAR}`,
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
];

/**
 * As palavras curtas que podem ficar entre a negacao e o sinal ("nao ESTOU
 * COM falta de ar", "nunca TIVE convulsao"). Sem letra repetida ("iso").
 */
const PONTE_DA_NEGACAO =
  "(?:e|eh|foi|era|sera|seria|ta|to|tou|estou|esta|estava|estive|tava|tive|teve|tenho|tem|tinha|sinto|senti|sentiu|sentindo|sentir|com|de|da|do|uma|um|nenhuma|nenhum|mais|muita|muito|qualquer|tipo|caso|se|trata|me|eu|ela|ele|iso|deu|ficou|fiquei|houve|aconteceu|sou|ter|tido|estar|nada|ainda|mesmo|tanta|tanto|penso|pensei|pensou|pensar|pensando|em|nem|nunca|tendo)";

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
 * A historia contada (so nos sinais fisicos): "ja desmaiei", "ja tive",
 * "as vezes", "quando eu era crianca", "ano passado". "Mais uma vez" e "de
 * uma vez" nao sao historia. Sem letra repetida ("pasado").
 */
const ANTECEDENTE = new RegExp(
  "\\b(?:ja (?:tive|tivemos|tinha|teve|senti|sentia|fiquei|ficava|desmaiei|desmaiava|pasei|sofri|sofreu|perdi)|as vezes|de vez em quando|toda vez que|sempre que|(?<!\\b(?:mais|de) )uma vez|certa vez|quando (?:eu |ele |ela )?(?:era|tinha)|quando (?:crianca|pequen[oa]|nov[oa]|menin[oa]|adolescente|jovem)|na (?:infancia|adolescencia)|antigamente|no pasado|(?:ano|mes|semestre) pasado|semana pasada|(?:anos|meses) atras|(?:faz|ha) (?:um ano|(?:muitos |alguns |uns |\\d+ )?anos)|em (?:19|20)\\d\\d)\\b",
);

/**
 * O AGORA na mesma oracao desfaz a historia ("ja desmaiei duas vezes hoje").
 * "Hoje em dia" e "hoje faz um ano" nao sao o agora.
 */
const AGORA =
  /\b(?:agora|agorinha|hoje(?! (?:em dia|faz|fazem|completa|completam)\b)|neste momento|nese momento|de novo|outra vez|novamente|mais uma vez|acabei de|acabou de|acabamos de|ha pouco|faz pouco)\b/;

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
}));

/** A letra repetida vira uma so ("faltaaa de arrr" vira "falta de ar"). */
function semLetraRepetida(texto: string): string {
  return texto.replace(/([a-z])\1+/g, "$1");
}

/** As trocas de expressao permitida do portao ("Maria do Socorro"). */
const neutralizarEntrada = neutralizador(NEUTRALIZACOES_DE_ENTRADA);

/** As visoes do portao, cada uma sem letra repetida, sem repetir. */
function leiturasDoTexto(texto: string): string[] {
  const visoes = visoesDoTexto(texto, [], neutralizarEntrada);
  return [...new Set(frasesDasVisoes(visoes).map(semLetraRepetida))];
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

/** O trecho da mesma oracao antes da posicao. */
function oracaoAntes(texto: string, posicao: number): string {
  return texto.slice(inicioDaOracao(texto, posicao).inicio, posicao);
}

/** O trecho da mesma oracao depois da posicao. */
function oracaoDepois(texto: string, posicao: number): string {
  const depois = texto.slice(posicao);
  const fim = depois.search(PRIMEIRO_FIM_DA_ORACAO);
  return fim === -1 ? depois : depois.slice(0, fim);
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
function negacaoEnfatica(antes: string, sinal: string, depois: string): boolean {
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

/** A oracao conta uma historia (e nao fala de agora). */
function ehHistoria(oracao: string): boolean {
  return ANTECEDENTE.test(oracao) && !AGORA.test(oracao);
}

/**
 * O sinal casou numa leitura, fora da negacao, das excecoes da oracao e da
 * historia (a excecao da mensagem inteira e conferida antes, na rajada).
 */
function sinalNaLeitura(
  leitura: string,
  compilado: (typeof SINAIS_COMPILADOS)[number],
): boolean {
  for (const m of leitura.matchAll(compilado.regex)) {
    const posicao = m.index ?? 0;
    const antes = oracaoAntes(leitura, posicao);
    const depois = oracaoDepois(leitura, posicao + m[0].length);
    if (
      !SINAL_COM_A_PROPRIA_NEGACAO.test(m[0]) &&
      NEGACAO_ANTES.test(antes) &&
      !negacaoEnfatica(antes, m[0], depois)
    ) {
      continue;
    }
    if (compilado.excecaoAntes?.test(antes) === true) {
      continue;
    }
    if (compilado.excecaoDepois?.test(depois) === true) {
      continue;
    }
    if (
      compilado.excecaoNaOracaoAnterior?.test(
        oracaoAnterior(leitura, posicao),
      ) === true
    ) {
      continue;
    }
    if (
      compilado.sinal.tipo === "fisica" &&
      ehHistoria(`${antes}${m[0]}${depois}`)
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
 * mensagem inteira (excecaoNaMensagem) e lida na juncao: vale para a rajada
 * inteira ("fiz botox semana passada" e depois "minha boca ficou torta").
 * Nulo: nenhum sinal fora da negacao, das excecoes e da historia. Risco de
 * vida vence o fisico (o aviso da AG6c para o risco de vida cita o CVV e o
 * SAMU). Nunca lanca; texto nulo ou vazio e ignorado.
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
  const leiturasDaJuncao = leiturasDoTexto(validos.join(" "));
  const lidas =
    validos.length > 1
      ? [...validos.map(leiturasDoTexto), leiturasDaJuncao]
      : [leiturasDaJuncao];
  const sinais = SINAIS_COMPILADOS.filter(
    (compilado) =>
      compilado.excecaoNaMensagem === null ||
      !leiturasDaJuncao.some((leitura) =>
        compilado.excecaoNaMensagem?.test(leitura),
      ),
  );
  let fisica: string | null = null;
  for (const leituras of lidas) {
    for (const compilado of sinais) {
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
  ANTECEDENTE.source,
  AGORA.source,
  FIM_DA_ORACAO.source,
  SINAL_COM_A_PROPRIA_NEGACAO.source,
];

/**
 * O que define a urgencia, para a versao do portao (fontesDoPortao,
 * filtro.ts): cada sinal (tipo, nome, fonte e as excecoes), as regras de
 * leitura e o modo de ler. Sem hash aqui: roda no navegador.
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
    ].join(" "),
  ),
  ...REGRAS_DE_LEITURA_DA_URGENCIA,
  "leitura: as visoes do portao com as neutralizacoes de entrada, sem letra repetida; cada texto sozinho e a juncao deles na ordem",
  "risco_de_vida vence fisica; o antecedente so nos sinais fisicos; urgencia e o primeiro gatilho de entrada",
];
