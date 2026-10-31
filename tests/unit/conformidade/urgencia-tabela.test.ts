import { describe, expect, it } from "vitest";

import {
  detectarUrgencia,
  EXCLUSOES_NA_FONTE,
  SINAIS_DE_EMERGENCIA,
} from "@/lib/domain/conformidade/urgencia";

// Revisao RR2 (rev4, regra 3): a TABELA de toda excecao e de toda exclusao da
// lista de urgencia (lib/domain/conformidade/urgencia.ts), com o nome, a prova
// positiva que ela exige e as marcas que a desfazem, e o teste gerado que
// confere cada uma com as marcas.
//
// O que desfaz, por classe:
//  - a excecao de CONTEXTO (antes, depois, no trecho do sinal, na oracao
//    anterior e na frase): as marcas da leitura inteira (o tempo recente, a
//    terceira pessoa, o pedido de ajuda, o relato que retoma o sinal, o "nao
//    to brincando" e o sintoma de agora), as da oracao do sinal (o verbo de
//    mudanca e o estado de agora) e o semExcecaoCom do sinal;
//  - a FIGURA: as marcas da leitura e o semExcecaoCom; no risco de vida (a
//    coisa que "vai me matar"), tambem o relato atual em outra oracao;
//  - a EXCLUSAO na fonte: a negacao e a estrutura sao o proprio sinal; a
//    coisa colada no verbo fala da coisa, nao da pessoa, e so vale colada:
//    perto, e urgencia;
//  - o REQUISITO nao e excecao: sem ele, o sinal nao existe.
// O risco de vida nao tem excecao nenhuma, a nao ser a negacao de quem fala e
// a figura com a coisa como sujeito do matar (regra 1).

type CampoDeExcecao =
  | "excecaoAntes"
  | "excecaoDepois"
  | "excecaoNoSinal"
  | "excecaoNaOracaoAnterior"
  | "excecaoNaFrase"
  | "figuraAntes"
  | "figuraDepois";

const CAMPOS: readonly CampoDeExcecao[] = [
  "excecaoAntes",
  "excecaoDepois",
  "excecaoNoSinal",
  "excecaoNaOracaoAnterior",
  "excecaoNaFrase",
  "figuraAntes",
  "figuraDepois",
];

/** Cada excecao de cada sinal: a prova que ela exige e a frase em que vale. */
const EXCECOES: readonly {
  sinal: string;
  campo: CampoDeExcecao;
  nome: string;
  prova: string;
  vale: string;
}[] = [
  {
    sinal: "falta_de_ar",
    campo: "excecaoDepois",
    nome: "o esforco de sempre",
    prova:
      "o esforco ou a situacao de sempre logo depois (quando subo escada, no calor)",
    vale: "tenho falta de ar quando subo escada, posso fazer lipo?",
  },
  {
    sinal: "falta_de_ar",
    campo: "figuraAntes",
    nome: "a figura do preco antes",
    prova: "a coisa que deixou (o preco, o resultado, a foto me deixou)",
    vale: "o preco me deixou falta de ar kkk",
  },
  {
    sinal: "falta_de_ar",
    campo: "figuraDepois",
    nome: "a figura do preco e do riso depois",
    prova: "com o preco, de tanto rir, de tao lindo",
    vale: "tive uma falta de ar de tanto rir",
  },
  {
    sinal: "sem_ar",
    campo: "excecaoDepois",
    nome: "o esforco de sempre",
    prova: "o esforco ou a situacao de sempre logo depois",
    vale: "fico sem ar quando corro",
  },
  {
    sinal: "sem_ar",
    campo: "figuraAntes",
    nome: "a figura do preco antes",
    prova: "a coisa que deixou sem ar",
    vale: "o preço me deixou sem ar kkkk",
  },
  {
    sinal: "sem_ar",
    campo: "figuraDepois",
    nome: "a figura do preco e do riso depois",
    prova: "com o preco, quando vi o resultado, de tanto rir",
    vale: "fiquei sem ar quando vi o resultado do botox, ficou lindo",
  },
  {
    sinal: "sem_folego",
    campo: "excecaoDepois",
    nome: "o esforco de sempre",
    prova: "o esforco ou a situacao de sempre logo depois",
    vale: "fico sem folego quando subo escada",
  },
  {
    sinal: "sem_folego",
    campo: "figuraAntes",
    nome: "a figura do preco antes",
    prova: "a coisa que deixou sem folego",
    vale: "o resultado me deixou sem folego",
  },
  {
    sinal: "sem_folego",
    campo: "figuraDepois",
    nome: "a figura do riso e da emocao depois",
    prova: "de tanto rir, de felicidade, de emocao",
    vale: "fiquei sem folego de tanto rir",
  },
  {
    sinal: "nao_consigo_respirar",
    campo: "excecaoNaFrase",
    nome: "o nariz com a cirurgia do nariz",
    prova: "respirar pelo nariz e a rinoplastia ou o septo na frase",
    vale: "não consigo respirar pelo nariz, quero fazer rinoplastia",
  },
  {
    sinal: "dificuldade_para_respirar",
    campo: "excecaoDepois",
    nome: "o esforco de sempre",
    prova: "o esforco ou a situacao de sempre logo depois",
    vale: "tenho dificuldade pra respirar quando subo escada",
  },
  {
    sinal: "dificuldade_para_respirar",
    campo: "excecaoNaFrase",
    nome: "o nariz com a cirurgia do nariz",
    prova: "respirar pelo nariz e a rinoplastia na frase",
    vale: "Tenho dificuldade para respirar pelo nariz, quero fazer rinoplastia",
  },
  {
    sinal: "nao_respira",
    campo: "excecaoAntes",
    nome: "o nariz como sujeito ou entupido",
    prova: "o nariz logo antes (meu nariz nao respira) ou entupido",
    vale: "meu nariz nao respira",
  },
  {
    sinal: "nao_respira",
    campo: "excecaoDepois",
    nome: "o pelo nariz",
    prova: "pelo nariz, por uma narina, logo depois",
    vale: "o bebe nao respira pelo nariz, e normal?",
  },
  {
    sinal: "nao_respira",
    campo: "figuraDepois",
    nome: "o sem respirar de tanto rir",
    prova: "de tanto rir, de susto, de emocao",
    vale: "fiquei sem respirar de tanto rir",
  },
  {
    sinal: "dor_que_vai_pro_braco",
    campo: "excecaoAntes",
    nome: "a dor do osso antes",
    prova: "o ombro, o pescoco, a coluna logo antes",
    vale: "no ombro uma dor que desce pro braco",
  },
  {
    sinal: "dor_que_vai_pro_braco",
    campo: "excecaoNoSinal",
    nome: "a dor do osso no meio",
    prova: "o ombro, o pescoco, a coluna no meio do sinal",
    vale: "tenho uma dor no ombro que desce pro braco",
  },
  {
    sinal: "infarto",
    campo: "excecaoAntes",
    nome: "a informacao sobre o evento",
    prova: "a reportagem, o video, a aula, o curso logo antes",
    vale: "vi um video sobre sintomas de infarto",
  },
  {
    sinal: "parada_cardiaca",
    campo: "excecaoAntes",
    nome: "a informacao e o nariz",
    prova: "a reportagem logo antes, ou o nariz como sujeito ou entupido",
    vale: "meu nariz nao respira mais",
  },
  {
    sinal: "desmaio",
    campo: "excecaoNoSinal",
    nome: "o habito (eu desmaio)",
    prova: "o eu desmaio no presente (o habito)",
    vale: "eu desmaio quando vejo agulha",
  },
  {
    sinal: "quase_desmaio",
    campo: "figuraDepois",
    nome: "a figura do preco e da emocao",
    prova: "quando vi a conta, de emocao, de vergonha",
    vale: "quase desmaiei quando vi a conta kkk",
  },
  {
    sinal: "nao_acorda",
    campo: "excecaoDepois",
    nome: "a hora de acordar",
    prova: "cedo, a tempo, com o despertador, pra ir pra escola, logo depois",
    vale: "nao acorda cedo, tem horario a tarde?",
  },
  {
    sinal: "morrendo",
    campo: "figuraDepois",
    nome: "o exagero do morrendo",
    prova: "de rir, de vontade, de vergonha, de dor, com esse preco, kkk",
    vale: "to morrendo de rir",
  },
  {
    sinal: "convulsao",
    campo: "excecaoAntes",
    nome: "o historico e o remedio",
    prova: "historico de, ja tive, remedio pra, tenho, logo antes",
    vale: "tenho historico de convulsao",
  },
  {
    sinal: "boca_torta",
    campo: "excecaoAntes",
    nome: "o estado de sempre antes",
    prova:
      "sempre tive, desde crianca tenho, ou o e e o sempre foi no meio do sinal",
    vale: "sempre tive a boca torta",
  },
  {
    sinal: "boca_torta",
    campo: "excecaoDepois",
    nome: "o estado de sempre depois",
    prova: "de nascenca, desde sempre, desde crianca, logo depois",
    vale: "Tenho a boca torta de nascença",
  },
  {
    sinal: "boca_torta",
    campo: "excecaoNaFrase",
    nome: "a estetica (o pedido com o objeto, o sorriso de sempre)",
    prova:
      "o pedido com o objeto estetico ou o fica torta quando sorrio, sem a terceira pessoa, o agora, o lado ou a queda",
    vale: "minha boca fica torta quando eu sorrio",
  },
  {
    sinal: "rosto_torto",
    campo: "excecaoAntes",
    nome: "o estado de sempre antes",
    prova: "sempre tive, ou o e e o sempre foi",
    vale: "Meu rosto é torto, quero harmonização facial",
  },
  {
    sinal: "rosto_torto",
    campo: "excecaoDepois",
    nome: "o estado de sempre depois",
    prova: "de nascenca, desde sempre, logo depois",
    vale: "tenho o rosto torto de nascença",
  },
  {
    sinal: "rosto_torto",
    campo: "excecaoNaFrase",
    nome: "a estetica",
    prova: "o pedido com o objeto estetico na frase",
    vale: "tenho o rosto torto e queria harmonizar",
  },
  {
    sinal: "rosto_caido_de_um_lado",
    campo: "excecaoAntes",
    nome: "o estado de sempre (o e)",
    prova: "o e, o era e o sempre foi no meio do sinal",
    vale: "O lado direito do meu rosto é mais caído, quero corrigir",
  },
  {
    sinal: "rosto_caido_de_um_lado",
    campo: "excecaoNaFrase",
    nome: "a estetica",
    prova: "o pedido com o objeto estetico na frase",
    vale: "o lado esquerdo do rosto mais caido, quero fazer fios",
  },
  {
    sinal: "metade_do_rosto_dormente",
    campo: "excecaoNaFrase",
    nome: "o dentista e a anestesia",
    prova: "o dentista, a anestesia, o canal ou o procedimento na frase",
    vale: "a metade do rosto dormente por causa da anestesia do dentista, normal?",
  },
  {
    sinal: "nao_consigo_falar",
    campo: "excecaoAntes",
    nome: "o telefone e a clinica antes",
    prova: "ligar, telefone, atendimento, a clinica logo antes",
    vale: "liguei e nao consigo falar",
  },
  {
    sinal: "nao_consigo_falar",
    campo: "excecaoDepois",
    nome: "o agora do ocupado",
    prova: "agora, no momento, hoje logo depois (nao consigo falar agora)",
    vale: "nao consigo falar agora, me manda mensagem",
  },
  {
    sinal: "nao_consigo_falar",
    campo: "excecaoNaOracaoAnterior",
    nome: "o telefone na oracao anterior",
    prova: "o telefone na oracao anterior da mesma frase",
    vale: "tentei ligar várias vezes, não consigo falar.",
  },
  {
    sinal: "nao_consigo_falar",
    campo: "excecaoNaFrase",
    nome: "quem esta ocupado e a rouquidao",
    prova: "numa reuniao, me manda mensagem, rouca, sem voz, na frase",
    vale: "Não consigo falar, estou numa reunião",
  },
  {
    sinal: "avc",
    campo: "excecaoAntes",
    nome: "a informacao sobre o evento",
    prova: "a reportagem, o video, a aula logo antes",
    vale: "vi um video sobre sintomas de avc",
  },
  {
    sinal: "perdendo_a_visao",
    campo: "excecaoAntes",
    nome: "o estado de sempre (sou, nasci)",
    prova: "sou, era, nasci logo antes",
    vale: "sou cega de um olho",
  },
  {
    sinal: "perdendo_a_visao",
    campo: "excecaoDepois",
    nome: "a vista de sempre e a luz",
    prova: "de perto, de longe, pra ler, com o flash, de nascenca, logo depois",
    vale: "perdi a visao de perto com a idade",
  },
  {
    sinal: "perdendo_a_visao",
    campo: "excecaoNaFrase",
    nome: "o oculos e o grau, e a historia de informacao",
    prova:
      "o oculos, a lente, o grau, o oftalmo na frase, ou a historia de outra pessoa com a pergunta",
    vale: "perdi a vista, preciso trocar os oculos",
  },
  {
    sinal: "perdendo_a_visao",
    campo: "figuraDepois",
    nome: "a figura (cega de raiva)",
    prova: "de raiva, de amor, de ciume logo depois",
    vale: "fiquei cega de raiva",
  },
  {
    sinal: "nao_enxerga",
    campo: "excecaoDepois",
    nome: "a vista de sempre e a luz",
    prova: "de longe, de perto, pra ler, com o flash, logo depois",
    vale: "nao enxergo nada de longe",
  },
  {
    sinal: "nao_enxerga",
    campo: "excecaoNaFrase",
    nome: "o oculos e o grau, e a historia de informacao",
    prova: "o oculos, a lente, o grau na frase",
    vale: "nao enxergo nada sem os oculos",
  },
  {
    sinal: "oclusao_do_preenchimento",
    campo: "excecaoNoSinal",
    nome: "o estado de sempre no lugar",
    prova: "o e, o era, o sempre no trecho do sinal (minha boca e branquinha)",
    vale: "fiz preenchimento, minha boca e muito branquinha",
  },
  {
    sinal: "oclusao_do_preenchimento",
    campo: "excecaoNaFrase",
    nome: "a historia de informacao",
    prova:
      "a historia de outra pessoa ou da internet, com a pergunta, sem relato",
    vale: "vi no instagram que o labio fica branco depois do preenchimento, isso e verdade?",
  },
  {
    sinal: "garganta_ou_lingua_inchada",
    campo: "excecaoNaFrase",
    nome: "a gripe e a inflamacao",
    prova: "a gripe, a amigdala, a inflamacao, o pus na frase",
    vale: "garganta inchada por causa da gripe, voces atendem?",
  },
  {
    sinal: "hemorragia",
    campo: "excecaoAntes",
    nome: "a informacao sobre o evento",
    prova: "a reportagem, o video, a aula logo antes",
    vale: "vi um video sobre sintomas de hemorragia",
  },
  {
    sinal: "ferimento_grave",
    campo: "excecaoAntes",
    nome: "o ja (a historia)",
    prova: "o ja logo antes",
    vale: "ja levei um tiro",
  },
  {
    sinal: "ferimento_grave",
    campo: "figuraDepois",
    nome: "a figura do preco",
    prova: "no orcamento, no bolso, na conta logo depois",
    vale: "levei uma facada no orcamento",
  },
  {
    sinal: "atropelado",
    campo: "excecaoAntes",
    nome: "o quase",
    prova: "o quase logo antes",
    vale: "quase fui atropelada",
  },
  {
    sinal: "atropelado",
    campo: "figuraDepois",
    nome: "a figura do preco e da rotina",
    prova: "pelo preco, pela semana, pela rotina logo depois",
    vale: "fui atropelada pelo preco",
  },
  {
    sinal: "picada_de_animal",
    campo: "excecaoAntes",
    nome: "o ja (a historia)",
    prova: "o ja fui logo antes",
    vale: "ja fui picada por escorpiao",
  },
  {
    sinal: "gestante_sangrando",
    campo: "excecaoNaFrase",
    nome: "a gravidez que passou",
    prova: "na primeira gravidez, quando eu estava gravida, na frase",
    vale: "na minha primeira gravidez tive sangramento",
  },
  {
    sinal: "vomito_com_sangue",
    campo: "excecaoAntes",
    nome: "a escova e a gengiva",
    prova: "escovei, os dentes, a gengiva logo antes",
    vale: "escovei os dentes e cuspi sangue",
  },
  {
    sinal: "labios_roxos",
    campo: "excecaoAntes",
    nome: "o estado de sempre e o batom antes",
    prova: "sempre tive, os labios sao, o batom logo antes",
    vale: "sempre tive os labios roxos",
  },
  {
    sinal: "labios_roxos",
    campo: "excecaoDepois",
    nome: "o natural, o frio e o onde furou",
    prova: "naturalmente, de nascenca, de frio, onde furou logo depois",
    vale: "os labios roxos de frio",
  },
  {
    sinal: "labios_roxos",
    campo: "excecaoNoSinal",
    nome: "o estado de sempre no meio",
    prova: "o sao, o era, o sempre no trecho do sinal",
    vale: "meus labios sao roxos",
  },
  {
    sinal: "respiracao_alterada",
    campo: "excecaoAntes",
    nome: "o nariz como sujeito",
    prova: "o nariz logo antes",
    vale: "meu nariz respira mal",
  },
  {
    sinal: "respiracao_alterada",
    campo: "excecaoDepois",
    nome: "o esforco de sempre",
    prova: "o esforco ou a situacao de sempre logo depois",
    vale: "fico ofegante quando subo escada",
  },
  {
    sinal: "emergencia",
    campo: "excecaoAntes",
    nome: "a hipotese, o que passou e a pergunta do servico",
    prova: "em caso de, se for, tive uma, voces atendem logo antes",
    vale: "em caso de emergencia, ligo pra quem?",
  },
  {
    sinal: "emergencia",
    campo: "excecaoDepois",
    nome: "a familiar, a estetica e o nao",
    prova: "familiar, no trabalho, estetica, nao logo depois",
    vale: "tenho uma emergência estética kkk",
  },
  {
    sinal: "emergencia",
    campo: "excecaoNaFrase",
    nome: "a agenda sem sintoma",
    prova:
      "remarcar, cancelar, preciso de um horario na frase, sem palavra de sintoma",
    vale: "Tenho uma emergência, preciso remarcar",
  },
  {
    sinal: "me_matar",
    campo: "figuraAntes",
    nome: "a coisa como sujeito do matar (regra 1b)",
    prova: "o preco, a dieta, a ruga, a dor como sujeito, nunca a pessoa",
    vale: "esse preço vai me matar",
  },
];

/**
 * Cada exclusao na fonte (EXCLUSOES_NA_FONTE): a prova, a frase em que ela
 * vale (nenhuma urgencia daquele sinal) e o contra (a coisa perto, nao
 * colada, ou o sinal sem a negacao: urgencia).
 */
const EXCLUSOES: readonly {
  nome: string;
  prova: string;
  vale: string;
  contra: string;
}[] = [
  {
    nome: "o ar condicionado (o ar livre, o ar puro): o ar colado a outra palavra",
    prova:
      "o ar seguido da palavra que faz dele outra coisa (condicionado, livre, puro)",
    vale: "tem falta de ar condicionado na sala de espera?",
    contra: "to com falta de ar, o ar condicionado ta desligado",
  },
  {
    nome: "o lugar sem ar como sujeito colado (a sala, a clinica, voces)",
    prova: "o lugar como sujeito, colado no sem ar (a sala ta sem ar)",
    vale: "a sala ta sem ar",
    contra: "no predio o vovo ta sem ar",
  },
  {
    nome: "o lugar perguntado, colado (ta sem ar ai?)",
    prova: "o ai, o la ou o aqui colados e a pergunta",
    vale: "ta sem ar ai?",
    contra: "fiquei sem ar aqui em casa",
  },
  {
    nome: "a negacao no meio do sinal (nao, nem, nunca, jamais, sem)",
    prova: "a negacao dentro do sinal",
    vale: "minha língua não está inchada",
    contra: "minha língua está inchada",
  },
  {
    nome: "o agora do evento grave nao atravessa o e, o mas nem o que",
    prova: "o agora do evento a ate duas palavras, sem o e no meio",
    vale: "minha mae teve um avc e agora esta bem",
    contra: "minha mae teve um avc agora",
  },
  {
    nome: "o agora com o mes ou o ano e a data, nao o agora",
    prova: "o agora seguido do mes, do ano, do comeco ou do fim",
    vale: "minha mae teve um avc agora em setembro",
    contra: "minha mae teve um avc agora",
  },
  {
    nome: "o hoje em dia e o hoje faz um ano",
    prova: "o hoje seguido de em dia, faz ou completa",
    vale: "hoje faz um ano que meu pai teve um infarto",
    contra: "meu pai teve um infarto hoje",
  },
  {
    nome: "o ha pouco tempo nao e o ha pouco",
    prova: "o ha pouco seguido de tempo",
    vale: "meu pai teve um infarto ha pouco tempo",
    contra: "meu pai teve um infarto ha pouco",
  },
  {
    nome: "o objeto do apagar (apaguei a mensagem, apagou a luz)",
    prova: "o objeto colado no apagar (a, o, a mensagem, a foto, a luz)",
    vale: "ela apagou a foto",
    contra: "ela apagou do nada",
  },
  {
    nome: "a coisa que apagou, como sujeito colado (a tv apagou)",
    prova: "a coisa como sujeito, no comeco da oracao, colada no apagou",
    vale: "a tv apagou do nada",
    contra: "minha mae tava vendo tv e apagou do nada",
  },
  {
    nome: "a coisa que nao reage, como sujeito colado (o site nao reage)",
    prova: "a coisa como sujeito, colada no nao reage",
    vale: "o site nao reage",
    contra: "meu avo tava no celular e agora nao reage",
  },
  {
    nome: "a coisa que caiu, como sujeito colado (a ligacao caiu)",
    prova: "a coisa como sujeito, colada no caiu",
    vale: "a ligacao caiu e a moca nao ta respondendo",
    contra: "minha avo tava falando no telefone e caiu, nao responde",
  },
  {
    nome: "a mensagem, o canal ou a clinica colados no verbo (nao responde no whats, falar ao telefone)",
    prova: "a mensagem, o canal ou a clinica logo depois do verbo",
    vale: "minha filha nao responde no whats",
    contra: "minha filha nao responde",
  },
  {
    nome: "a pessoa da familia nao atravessa a conjuncao nem a negacao ate o nao responde",
    prova:
      "a pessoa da familia e o nao responde sem o que, o mas ou outra negacao no meio",
    vale: "minha mae falou que o site nao responde",
    contra: "minha mae nao responde",
  },
  {
    nome: "a coisa que esta morrendo, como sujeito colado (meu celular ta morrendo, meu cabelo ta morrendo)",
    prova: "a coisa como sujeito, colada no morrendo",
    vale: "meu celular ta morrendo",
    contra: "meu pai tava no celular e ta morrendo",
  },
  {
    nome: "a negacao no meio da boca e do rosto; o e, o era e o sempre vao para a excecao de antes (o estado de sempre)",
    prova: "a negacao dentro do sinal",
    vale: "minha boca não ficou torta",
    contra: "minha boca ficou torta",
  },
  {
    nome: "o quase desmaiei e o sinal proprio (quase_desmaio)",
    prova: "o quase logo antes do desmaiei",
    vale: "quase desmaiei quando vi a conta kkk",
    contra: "desmaiei",
  },
  {
    nome: "o falar direito e o sinal proprio (nao_fala_direito)",
    prova: "o direito logo depois do falar",
    vale: "nao consigo falar direito",
    contra: "nao consigo falar",
  },
  {
    nome: "a clinica como sujeito colado (a recepcao nao consegue falar)",
    prova: "a clinica como sujeito, colada no nao consegue",
    vale: "a recepcao nao consegue falar",
    contra: "vcs atendem? meu pai nao consegue falar",
  },
  {
    nome: "a negacao no meio do braco fraco e da cor do preenchimento (nao, nem, nunca, jamais)",
    prova: "a negacao dentro do sinal",
    vale: "meu braco e minha perna nao estao fracos",
    contra: "meu braco e minha perna estao fracos",
  },
  {
    nome: "o derrame no olho, o pleural e o articular (o nome de outra coisa)",
    prova: "o derrame seguido de no olho, pleural, articular",
    vale: "tive um derrame no olho hoje",
    contra: "minha mae teve um derrame hoje",
  },
  {
    nome: "a tela colada no ver (nao vejo nada no app)",
    prova: "o app, o site, a tela logo depois do ver",
    vale: "nao vejo nada no app",
    contra: "nao vejo nada desde ontem",
  },
  {
    nome: "a tela como objeto colado (nao estou enxergando o link)",
    prova: "o link, a foto, a mensagem como objeto do enxergar",
    vale: "nao estou enxergando o link",
    contra: "nao estou enxergando o rosto da minha filha",
  },
  {
    nome: "a coisa que fica branca, escura ou manchada, como sujeito colado (meus dentes estao brancos)",
    prova: "o dente, a roupa, a tela como sujeito, colados no branco",
    vale: "fiz preenchimento ontem e meus dentes estao brancos",
    contra: "fiz preenchimento ontem e ta tudo branco",
  },
  {
    nome: "a dor de cabeca, de dente, de garganta (o nome de outra dor, colado)",
    prova: "a dor seguida de de cabeca, de dente, de garganta",
    vale: "fiz preenchimento ontem e to com dor de cabeca forte",
    contra: "fiz preenchimento ontem e to com dor forte",
  },
  {
    nome: "a dor nas costas (o lugar de outra dor, colado)",
    prova: "a dor seguida de nas costas",
    vale: "fiz preenchimento ontem e to com dor nas costas forte",
    contra: "fiz preenchimento ontem e to com dor muito forte",
  },
  {
    nome: "a mancha de uma coisa, colada (manchado de batom)",
    prova: "a mancha seguida do batom, da tinta, do cafe",
    vale: "fiz a boca ontem e ela ta toda manchada de batom",
    contra: "fiz a boca ontem e ela ta toda manchada",
  },
  {
    nome: "o sangue tirado ou doado, colado no verbo (no exame, na doacao)",
    prova: "o tirar, o doar ou o colher logo antes do muito sangue",
    vale: "vai tirar muito sangue no exame?",
    contra: "ta saindo muito sangue",
  },
  {
    nome: "o tomar banho (outro verbo)",
    prova: "o banho logo depois do tomei",
    vale: "tomei banho de mar com detergente",
    contra: "tomei detergente",
  },
  {
    nome: "o tiro do laser, colado (levei 300 tiros de laser)",
    prova: "o laser, a depilacao, a sessao logo depois do tiro",
    vale: "levei 300 tiros de laser",
    contra: "meu irmao levou 12 tiros, cancela a sessao dele de laser",
  },
  {
    nome: "o aparelho que engoliu a pilha, como sujeito colado",
    prova: "o aparelho como sujeito, colado no engoliu",
    vale: "o controle engoliu a pilha",
    contra: "o bebe pegou o controle e engoliu a pilha",
  },
  {
    nome: "a aranha vascular (os vasinhos, o nome composto)",
    prova: "a aranha seguida de vascular",
    vale: "a picada de aranha vascular doi?",
    contra: "fui picada por uma aranha",
  },
  {
    nome: "o sangue do exame, da doacao e da gengiva, colado (exame de sangue, a gengiva ta sangrando)",
    prova: "o exame, a doacao, a gengiva logo antes do sangue",
    vale: "fiz exame de sangue, to gravida",
    contra: "to gravida e to perdendo sangue",
  },
  {
    nome: "a negacao no meio dos labios roxos (nao, nem, nunca)",
    prova: "a negacao dentro do sinal",
    vale: "meus labios nao estao roxos",
    contra: "meus labios estao roxos",
  },
  {
    nome: "o roxo do batom, da tinta e da fruta, colado",
    prova: "o roxo seguido do batom, da tinta, do acai",
    vale: "meus labios estao roxos de batom",
    contra: "meus labios estao roxos",
  },
  {
    nome: "a confusao com alguma coisa, colada (confusa com os precos)",
    prova: "o com logo depois do confuso",
    vale: "fiquei confusa com os precos do nada",
    contra: "ela ficou confusa do nada",
  },
  {
    nome: "a negacao entre a pancada e o sinal de alarme",
    prova: "a negacao entre a pancada e o sinal",
    vale: "bati a cabeca mas nao vomitei",
    contra: "bati a cabeca e vomitei",
  },
  {
    nome: "o nome com emergencia, colado (contato de emergencia, encaixe de emergencia, fui na emergencia)",
    prova: "o nome da coisa ou o lugar colado antes da emergencia",
    vale: "qual o contato de emergencia?",
    contra: "e uma emergencia",
  },
  {
    nome: "a unidade da dose: o numero conta comprimidos, nao gotas, mg ou ml (as gotas contam de 100 para cima; o mg e o ml, com a intencao ou de uma vez)",
    prova: "a gota, o mg ou o ml entre o numero e o remedio",
    vale: "tomei 40 gotas de dipirona",
    contra: "tomei 40 comprimidos de dipirona",
  },
];

/** Os requisitos (nao sao excecao): sem eles o sinal nao existe. */
const REQUISITOS: readonly {
  sinal: string;
  requer: string;
  sem: string;
  com: string;
}[] = [
  {
    sinal: "oclusao_do_preenchimento",
    requer: "o preenchimento feito (e, se antigo, com o agora)",
    sem: "o labio ta branco e frio",
    com: "fiz preenchimento ontem e o labio ta branco e frio",
  },
  {
    sinal: "mancha_depois_do_preenchimento",
    requer: "o preenchimento feito e o tempo recente",
    sem: "minha pele ta toda manchada",
    com: "fiz a boca ontem e ela ta toda manchada",
  },
  {
    sinal: "vazamento_de_gas",
    requer: "o mal-estar do gas (tontura, dor de cabeca, desmaio)",
    sem: "o gas ta vazando, ja chamei o tecnico",
    com: "o gas ta vazando e to tonta",
  },
  {
    sinal: "gestante_sangrando",
    requer: "a gravidez na leitura",
    sem: "to com um sangramento",
    com: "to gravida e to com um sangramento",
  },
  {
    sinal: "coracao_disparado",
    requer: "o mal-estar junto (vai desmaiar, suando frio, falta de ar)",
    sem: "meu coracao disparou de ansiedade",
    com: "meu coracao disparou e to suando frio",
  },
  {
    sinal: "febre_depois_do_procedimento",
    requer: "o procedimento ou a cirurgia feitos",
    sem: "to com febre alta",
    com: "fiz lipo e to com febre alta",
  },
  {
    sinal: "inchaco_alergico",
    requer:
      "a alergia na leitura (a picada, o camarao, o remedio, o engolir dificil)",
    sem: "minha boca ta inchada",
    com: "comi camarao e minha boca ta inchada",
  },
];

/** As marcas da leitura, cada uma numa frase propria (nenhuma e sinal). */
const MARCAS_DA_LEITURA: readonly (readonly [string, string])[] = [
  ["o tempo recente", "Desde ontem."],
  ["a terceira pessoa", "Minha mãe também."],
  ["o pedido de ajuda", "Socorro."],
  ["o relato que retoma o sinal", "Aconteceu comigo."],
  ["o sintoma de agora", "Tô tonta."],
];

/** As marcas da oracao do sinal (o verbo de mudanca e o estado de agora). */
const MARCAS_DA_ORACAO: readonly (readonly [string, string])[] = [
  ["minha boca tá torta, quero fazer preenchimento", "boca_torta"],
  ["minha boca entortou, preenchimento resolve?", "boca_torta"],
  ["não tô enxergando bem de longe", "nao_enxerga"],
  ["fiquei cega com a luz do laser", "perdendo_a_visao"],
  ["meu nariz não está respirando direito", "parada_cardiaca"],
  ["meus lábios estão roxos onde furou", "labios_roxos"],
  ["tô com uma emergência, preciso remarcar", "emergencia"],
];

const urgente = (texto: string) => detectarUrgencia([texto]);

describe("a tabela das exceções e das exclusões (revisão RR2, regra 3)", () => {
  it("a tabela tem uma linha para cada exceção de cada sinal, e só para elas", () => {
    const naTabela = new Set(EXCECOES.map((l) => `${l.sinal}.${l.campo}`));
    const noCodigo = new Set<string>();
    for (const sinal of SINAIS_DE_EMERGENCIA) {
      for (const campo of CAMPOS) {
        if (sinal[campo] !== undefined) {
          noCodigo.add(`${sinal.nome}.${campo}`);
        }
      }
    }
    expect([...naTabela].sort()).toEqual([...noCodigo].sort());
    for (const l of EXCECOES) {
      expect(l.prova.trim().length, l.nome).toBeGreaterThan(5);
      expect(l.nome, l.nome).not.toMatch(/[–—]/);
    }
  });

  it("a tabela tem uma linha para cada exclusão na fonte, e nenhuma fonte tem outro lookaround negativo", () => {
    expect(EXCLUSOES.map((l) => l.nome).sort()).toEqual(
      EXCLUSOES_NA_FONTE.map((e) => e.nome).sort(),
    );
    expect(new Set(EXCLUSOES_NA_FONTE.map((e) => e.nome)).size).toBe(
      EXCLUSOES_NA_FONTE.length,
    );
    for (const sinal of SINAIS_DE_EMERGENCIA) {
      let resto = sinal.fonte;
      for (const exclusao of EXCLUSOES_NA_FONTE) {
        resto = resto.split(exclusao.fonte).join("");
      }
      expect(resto, sinal.nome).not.toMatch(/\(\?<?!/);
    }
    for (const exclusao of EXCLUSOES_NA_FONTE) {
      expect(
        SINAIS_DE_EMERGENCIA.some((s) => s.fonte.includes(exclusao.fonte)),
        exclusao.nome,
      ).toBe(true);
    }
  });

  it("o risco de vida só tem a negação, a estrutura e a figura da coisa que mata (regra 1)", () => {
    for (const sinal of SINAIS_DE_EMERGENCIA) {
      if (sinal.tipo !== "risco_de_vida") {
        continue;
      }
      const campos = CAMPOS.filter((campo) => sinal[campo] !== undefined);
      expect(campos, sinal.nome).toEqual(
        sinal.nome === "me_matar" ? ["figuraAntes"] : [],
      );
      for (const exclusao of EXCLUSOES_NA_FONTE) {
        if (sinal.fonte.includes(exclusao.fonte)) {
          expect(exclusao.classe, `${sinal.nome}: ${exclusao.nome}`).not.toBe(
            "coisa_colada",
          );
        }
      }
    }
  });

  it("cada requisito tem a linha dele", () => {
    expect(REQUISITOS.map((r) => r.sinal).sort()).toEqual(
      SINAIS_DE_EMERGENCIA.filter((s) => s.requer !== undefined)
        .map((s) => s.nome)
        .sort(),
    );
  });

  it.each(EXCECOES.map((l) => [l.sinal, l.campo, l] as const))(
    "%s.%s: vale sem urgência, e cada marca da leitura a desfaz",
    (_sinal, _campo, l) => {
      expect(urgente(l.vale)).toBeNull();
      for (const [marca, frase] of MARCAS_DA_LEITURA) {
        expect(
          urgente(`${l.vale} ${frase}`),
          `${l.vale} [${marca}]`,
        ).not.toBeNull();
      }
    },
  );

  it.each(MARCAS_DA_ORACAO)(
    "%s: a mudança ou o estado de agora na oração do sinal desfazem o contexto (%s)",
    (texto, sinal) => {
      expect(urgente(texto)?.sinal).toBe(sinal);
    },
  );

  it.each(EXCLUSOES.map((l) => [l.nome, l] as const))(
    "%s: colada, não é o sinal; perto (ou sem a negação), urgência",
    (_nome, l) => {
      const exclusao = EXCLUSOES_NA_FONTE.find((e) => e.nome === l.nome);
      const sinais = SINAIS_DE_EMERGENCIA.filter(
        (s) => exclusao !== undefined && s.fonte.includes(exclusao.fonte),
      ).map((s) => s.nome);
      const vale = urgente(l.vale);
      expect(vale === null || !sinais.includes(vale.sinal), l.vale).toBe(true);
      expect(urgente(l.contra), l.contra).not.toBeNull();
    },
  );

  it.each(REQUISITOS.map((r) => [r.sinal, r] as const))(
    "%s: sem o requisito o sinal não existe; com ele, urgência",
    (sinal, r) => {
      expect(urgente(r.sem)).toBeNull();
      expect(urgente(r.com)?.sinal).toBe(sinal);
    },
  );
});
