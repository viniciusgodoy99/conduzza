import { beforeAll, describe, expect, it } from "vitest";

import {
  detectarGatilhosDeEntrada,
  pedidoDeConsultaParaOutraPessoa,
} from "@/lib/domain/conformidade/gatilhos-de-entrada";

// Revisao de 23/11/2026: o portao de entrada medido com 306 turnos de
// paciente de clinica do Nordeste no WhatsApp (decisao do dono: corrigir o
// que vai para a equipe sem precisar). Escalava 23 dos 223 turnos de
// recepcao e deixava passar 8 dos 83 que precisam de pessoa. Cada turno e uma
// ou mais mensagens de texto ainda nao respondidas, lido como o laco le
// (detectarGatilhosDeEntrada e, sem gatilho, a consulta para outra pessoa).

type Turno = string | readonly string[];

function motivos(turno: Turno, comPreparo: boolean): string[] {
  const textos = typeof turno === "string" ? [turno] : [...turno];
  const gatilhos = detectarGatilhosDeEntrada({
    mensagens: textos.map((texto) => ({ tipo: "texto", texto })),
    comPreparo,
  });
  if (gatilhos.length > 0) {
    return gatilhos;
  }
  return pedidoDeConsultaParaOutraPessoa(textos)
    ? ["consulta_para_outra_pessoa"]
    : [];
}

// A primeira leitura compila as regex do portao (as duas variantes do molde):
// segundos na maquina carregada, o que estourava o prazo do primeiro caso.
beforeAll(() => {
  motivos("oi", false);
  motivos("oi", true);
}, 60_000);

const comRotulo = (lista: readonly Turno[]) =>
  lista.map(
    (turno) =>
      [typeof turno === "string" ? turno : turno.join(" | "), turno] as const,
  );

/** Recepcao: segue para o assistente. */
const SEGUEM_PARA_O_ASSISTENTE: readonly Turno[] = [
  // preco
  "boa tarde quanto ta a consulta com a dermato?",
  "Qual o valor da consulta particular?",
  "oi, qnt custa a limpeza de pele?",
  "quanto é o botox? 💉",
  "Quanto custa harmonização facial?",
  "vcs fazem preenchimento labial? qual o valor",
  "oxe e quanto ta a depilação a laser na virilha?",
  "Bom dia! Gostaria de saber o preço do ultrassom de abdome total",
  "quanto fica o exame de vista?",
  "valor da consulta com cardiologista pfv",
  "o valor da consulta pode parcelar no cartao?",
  "quanto ta o pacote de 3 sessoes de limpeza de pele",
  "Qual o preço do peeling?",
  "mainha quer saber quanto ta a consulta, é pra mim mesmo",
  "quanto custa o eletrocardiograma?",
  "qto ta o ultrassom transvaginal particular",
  // convenio
  "vcs aceitam unimed?",
  "Atende Hapvida?",
  "meu plano é bradesco saude top, cobre a consulta?",
  "aceita amil pro exame?",
  "oi, a dra ana atende pelo convenio unimed fortaleza?",
  "tem convenio com a cassi?",
  "e pelo plano da camed, atende?",
  "Boa noite, vocês trabalham com o SulAmérica?",
  "o ultrassom é coberto pelo meu plano? é unimed nacional",
  "aceitam o plano Hapvida? se nao aceitar quanto fica particular",
  "o plano cobre a consulta de retorno?",
  // funcionamento
  "que horas vcs abrem?",
  "Funciona sabado?",
  "vcs atendem no feriado de quinta?",
  "ate que horas a clinica fica aberta hj?",
  "abre na hora do almoço?",
  // endereco
  "onde fica a clinica?",
  "Qual o endereço de vocês? sou de Caucaia",
  "tem estacionamento?",
  "da pra ir de onibus? qual parada desce",
  "fica perto do shopping iguatemi?",
  "me manda a localização por favor 🙏",
  "Tem elevador? minha vó vai comigo e ela tem dificuldade pra subir escada",
  "qual andar é a sala?",
  "Tem acessibilidade pra cadeirante?",
  "vou de uber, coloco qual endereço?",
  // pagamento
  "aceita cartao de credito?",
  "pode pagar no pix?",
  "vcs emitem nota fiscal? preciso pra reembolso do plano",
  "preciso da segunda via do recibo da consulta de setembro",
  "Consegue me mandar o recibo por aqui pra eu pedir reembolso?",
  "aceita dinheiro?",
  "parcela em quantas vezes?",
  "o pagamento é antes ou depois da consulta?",
  // procedimento
  "vcs fazem ultrassom de abdome?",
  "faz exame de vista?",
  "tem eletrocardiograma ai?",
  "Vocês fazem exame de sangue?",
  "faz mamografia?",
  "vcs tem ginecologista?",
  "tem pediatra?",
  "fazem botox?",
  "voces fazem limpeza de pele profunda?",
  "tem depilação a laser pra homem?",
  "fazem preenchimento de olheira?",
  "faz bioestimulador de colageno?",
  "vcs fazem drenagem linfatica?",
  "tem dermatologista que atende sabado?",
  "faz ultrassom transvaginal?",
  "vocês fazem exame de tireoide?",
  "tem ultrassom de mama?",
  "fazem raio x do joelho?",
  "faz ultrassom da próstata?",
  "oi vcs fazem check up completo?",
  "Vcs fazem holter?",
  "tem endocrinologista?",
  "tem ortopedista ai?",
  "vcs fazem preventivo?",
  "faz ultrassom de tireoide e de rins?",
  "tem cardiologista pra fazer risco cirurgico?",
  // marcar
  "quero marcar uma consulta",
  "queria agendar com a dermatologista pra semana que vem",
  "tem horario amanha de manha?",
  "quero falar com a Dra. Ana, marcar com ela",
  "Quero marcar com o Dr. Bruno, tem vaga sexta?",
  "boa tarde! tem vaga pra limpeza de pele no sabado?",
  "Oi, tudo bem? Eu queria marcar uma consulta com a dermatologista, pode ser pela manhã, de preferência terça ou quinta",
  "tem encaixe pra hj?",
  "qual o proximo horario livre?",
  "pode ser às 14h?",
  "pode ser o das 9h30",
  "quero o primeiro horario",
  "Meu nome é Francisca das Chagas Silva, nasci em 12/03/1985",
  "francisca de assis pereira, 05/07/79",
  "pode marcar sim",
  "1",
  "sim, confirma",
  "tem como ser depois das 17h? saio do trabalho as 5",
  "queria uma avaliacao pra fazer botox",
  "Maria das Dores Ferreira, 22/09/1970",
  "meu nome é Socorro Alves",
  // remarcar
  "preciso remarcar minha consulta de amanha",
  "nao vou poder ir na quinta, da pra mudar pra outro dia?",
  // cancelar
  "quero cancelar meu horario",
  "Desmarca minha consulta por favor, surgiu um imprevisto no trabalho",
  "Vou ter que cancelar, painho vai viajar e eu vou ter que ficar com os meninos",
  // remarcar
  "da pra adiantar minha consulta?",
  "posso trocar de medico? queria passar com a dra ana",
  "consegue passar minha consulta pra parte da tarde?",
  // confirmar
  "Confirmado, estarei lá",
  "sim vou sim",
  "confirmo presença 👍",
  "to indo, chego em 10 min",
  "vou sim, obrigada",
  // logistica
  "posso levar acompanhante?",
  "posso levar meu filho de 5 anos comigo? nao tenho com quem deixar",
  "minha filha de 8 anos pode ficar na sala de espera enquanto eu faço o procedimento?",
  "vou chegar uns 15 min atrasada, tem problema?",
  "to preso no transito, vou atrasar uns 20 minutos",
  "precisa levar algum documento?",
  "preciso levar a carteirinha do plano?",
  "tenho que levar o pedido do medico?",
  "posso levar meu marido pra me acompanhar?",
  "meu esposo pode entrar comigo na sala?",
  "Preciso chegar quanto tempo antes?",
  "posso levar meu bebe? ele tem 6 meses, ainda mama",
  // social
  "obrigada viu, Deus abençoe 🙏",
  "valeu, arretado o atendimento de vcs",
  "brigadu",
  "Bom dia",
  "oi",
  "oxe, nao entendi, pode repetir?",
  "ok",
  "tá certo, visse",
  "👍",
  "kkkk ta bom",
  "Boa noite, tudo bem?",
  // familia
  "é pra mim mesmo, minha mãe que indicou vcs",
  "minha irmã fez limpeza de pele ai e gostou, quero fazer também",
  "Minha prima falou que vcs atendem unimed, é verdade?",
  "mainha disse que a dra ana é otima, quero marcar com ela",
  "vou com meu esposo, ele vai me levar de carro, tem onde estacionar?",
  // retorno
  "quero marcar meu retorno com a dra ana",
  "o retorno é pago?",
  "tenho direito a retorno em quantos dias?",
  "a dra pediu pra eu voltar com os exames, marca o retorno pra mim",
  // estetica
  "qual o valor do preenchimento labial com acido hialuronico?",
  "botox na testa quanto fica?",
  "qnts sessoes de laser precisa geralmente?",
  "faz rinomodelação?",
  "quanto custa o skinbooster?",
  // audio
  "oi bom dia tudo bem é que eu queria saber se vocês atendem pelo plano da unimed porque eu tô precisando marcar uma consulta com a dermatologista e queria ver se tem horário pra semana que vem de preferência de manhã porque de tarde eu trabalho",
  "boa tarde menina é a Socorro eu marquei uma consulta pra quinta mas não vou poder ir não porque vou viajar pro interior aí queria ver se dá pra passar pra semana que vem visse",
  "alô é da clínica né eu queria saber quanto tá a limpeza de pele e se pode pagar no cartão em duas vezes",
  // rajada
  ["oi", "bom dia", "queria saber o valor da consulta"],
  ["boa tarde", "vcs atendem hapvida?", "se nao atender quanto e particular"],
  ["quero marcar", "pode ser sexta", "de manha"],
  // digitacao
  "qto e a cosulta com dermatologita",
  "vcs atende sabdo?",
  "kero agenda uma limpesa de pele",
  "onde fika a clinica? n achei no mapa",
  // caixa_alta
  "QUANTO CUSTA A CONSULTA?",
  // outros
  "vocês tem atendimento online?",
  "a consulta é por ordem de chegada ou hora marcada?",
  "quanto tempo demora a consulta?",
  "o resultado do exame de sangue sai em quantos dias?",
  "posso pegar o resultado do exame por aqui ou tenho que ir buscar?",
  "vocês atendem idoso pelo plano?",
  "a dra é boa? é a primeira vez que vou",
  // figura
  "to morrendo de vontade de fazer harmonização kkkk",
  "esse preço me mata kkkk tem parcelamento?",
  "Nossa, to doida pra fazer o botox, quando tem horario?",
  "meu Deus que horario ruim, tem outro?",
  // procedimento
  "quero fazer limpeza de pele nas costas, vocês fazem?",
  "faz botox no pescoço?",
  "quanto custa tirar sinal do rosto?",
  "vocês fazem exame de urina?",
  "tem como fazer o exame de sangue no sabado?",
  "o exame de sangue precisa marcar ou é por ordem de chegada?",
  "minha medica pediu um ultrassom de abdome, vcs fazem? quanto fica?",
  "o medico pediu hemograma completo, quanto fica?",
  "tem horario pra coleta de sangue amanha cedo?",
  "faz exame admissional?",
  "vcs fazem teste de gravidez?",
  "tem vacina da gripe?",
  "tem nutricionista?",
  "quanto custa a consulta com o psicologo?",
  "quanto ta a consulta de pré-natal?",
  "Bom dia, gostaria de saber se a Dra. Carla faz preventivo",
  "a consulta com a ginecologista é quanto?",
  "quero marcar uma consulta de rotina com o cardiologista",
  // convenio
  "o dr bruno atende pelo amil?",
  "vocês atendem pelo SUS?",
  "aceita vale saude?",
  // marcar
  "tem horario com a dra carla na sexta de tarde?",
  "pode ser no centro ou só aldeota?",
  "tem horário dia 15 às 8h?",
  "Oi, sou paciente da Dra. Ana, queria marcar a revisão",
  // familia
  "minha mãe já é paciente de vcs, eu quero marcar pra mim",
  "levo minha mãe comigo, ela tem 70 anos, pode entrar?",
  "meu marido vai me levar, tem estacionamento?",
  // pagamento
  "manda o pix que eu pago o sinal",
  "qual a chave pix?",
  "tem que pagar sinal pra reservar?",
  "mandei o comprovante do pix, chegou?",
  "o estacionamento é pago?",
  // logistica
  "minha consulta é dia 12, tá confirmada?",
  "pode me lembrar um dia antes?",
  "esqueci que horas é minha consulta",
  "tô na porta, vou subir",
  "posso ir direto do trabalho de uniforme?",
  "posso remarcar sem pagar de novo?",
  "a consulta de retorno precisa levar os exames?",
  // social
  "a medica que me atendeu foi muito atenciosa, obrigada",
  // funcionamento
  "vcs atendem de noite?",
  // audio
  "é o seguinte eu fiz uma limpeza de pele aí com vocês mês passado e gostei muito aí queria marcar outra pra esse mês se tiver horário no sábado de manhã",
  "oi tudo bom então eu vi aqui no instagram de vocês que vocês fazem depilação a laser né queria saber o valor da axila e da virilha e se precisa fazer avaliação antes",
  "bom dia minha filha é o seguinte meu exame tá marcado pra sexta né aí eu queria saber se precisa levar o pedido do médico ou se só a carteirinha resolve",
  // vocativo
  "oi minha filha quanto ta a consulta?",
  "bom dia meu filho, tem horario pra sexta?",
  "minha filha me diga uma coisa, vcs atendem unimed?",
];

/**
 * Recepcao que continua com a equipe por decisao do dono: desconto e
 * promocao (valor_fora_da_tabela), "a dra atende crianca?" (D-8) e a
 * mensagem toda em caixa alta (Q2). "Socorro que fila" e ambiguo e continua.
 */
const PASSAM_PARA_A_EQUIPE_POR_DECISAO: readonly Turno[] = [
  "tem desconto no pix?",
  "Tem promoção de depilação a laser esse mês?",
  "Oi! Vi o anúncio no Instagram da promoção de limpeza de pele, ainda tá valendo?",
  "BOM DIA QUERO MARCAR UMA CONSULTA COM A DRA ANA PARA SEXTA",
  "a dra ana atende criança?",
  "socorro que fila, ainda tem muita gente na frente?",
];

/** Precisa de pessoa: passa para a equipe. */
const PASSAM_PARA_A_EQUIPE: readonly Turno[] = [
  // sintoma
  "to com uma dor de cabeça que nao passa faz 3 dias",
  "minha pele ta descascando depois do peeling, é normal?",
  "fiz botox semana passada e meu olho ta caido",
  "to com uma mancha vermelha no braço que coça muito",
  "oxe meu rosto inchou todo depois da limpeza de pele",
  "tô sentindo uma queimação no estômago direto",
  "minha garganta ta inflamada e to com febre",
  "apareceu um caroço no meu pescoço, preciso marcar urgente?",
  "to com corrimento e coceira la embaixo",
  "meu filho ta com febre de 39 desde ontem",
  "tô com tontura e enjoo faz uns dias",
  "a boca ficou roxa depois do preenchimento",
  "sinto uma pontada no peito quando respiro fundo",
  "minha pressão ta 18 por 11",
  "to sangrando ainda depois do procedimento",
  "fiz o laser e ficou bolha na perna",
  "meu joelho ta doendo muito quando subo escada",
  "tô com uns carocinho no rosto que nao sai, sera que é espinha ou alergia?",
  "minha menstruação ta atrasada 2 meses",
  "faz uma semana que to com diarreia",
  "o local da aplicação ta quente e vermelho",
  "eu to com muita dor nas costas, nao consigo nem andar direito",
  // emergencia
  "Painho caiu e bateu a cabeça, ta meio grogue",
  "socorro meu pai ta com dor no peito e suando frio",
  "minha mae desmaiou aqui agora",
  "ele ta sem conseguir respirar direito",
  "to tendo uma crise de falta de ar",
  "meu lábio ta inchando muito rapido depois do preenchimento e ta dificil engolir",
  "meu bebe convulsionou",
  "minha boca ficou torta e o braço ta dormente",
  "to vomitando sangue",
  // risco_de_vida
  "nao aguento mais viver",
  "to pensando em me matar",
  "tomei um monte de remedio pra dormir de proposito",
  ["quero", "morrer"],
  // remedio
  "posso tomar dipirona antes do botox?",
  "qual remedio vcs recomendam pra espinha?",
  "quantos ml de amoxicilina eu dou pro meu filho de 20kg?",
  "posso parar de tomar o anticoncepcional antes do exame?",
  "posso tomar ibuprofeno depois da limpeza de pele?",
  "tomo remedio de pressao, posso fazer o procedimento?",
  "o medico passou um creme e ta ardendo, continuo usando?",
  "esqueci de tomar o remedio da tireoide hoje, tem problema pro exame?",
  // resultado
  "meu exame de sangue deu glicose 180, isso é diabetes?",
  "o resultado do ultrassom deu nodulo, é grave?",
  "pode me explicar o que significa o resultado do meu exame?",
  "meu colesterol deu alto no exame, o que eu faço?",
  "o exame veio alterado, preciso me preocupar?",
  // reclamacao
  "fui muito mal atendida ontem, a recepcionista foi grossa comigo, quero falar com o responsável",
  "vou denunciar vcs no procon",
  "paguei e nao fui atendida, quero meu dinheiro de volta",
  "o procedimento ficou horrivel, quero reembolso",
  "esperei 2 horas e o medico nao apareceu, que absurdo",
  "vou botar no reclame aqui",
  "o botox nao fez efeito nenhum, quero refazer de graça",
  // humano
  "quero falar com uma pessoa",
  "me passa pra atendente por favor",
  "tem alguem de verdade ai? nao quero falar com robo",
  "quero falar com a gerente",
  "me liga por favor",
  // clinico
  "posso fazer limpeza de pele gravida?",
  "botox é perigoso pra quem tem enxaqueca?",
  "qual a diferença entre botox e preenchimento, qual é melhor pra mim?",
  // menor
  "tenho 16 anos, posso fazer botox?",
  // outra_pessoa
  "Minha mae quer marcar uma consulta com a dra ana",
  "quero marcar pro meu marido",
  // sintoma
  "to com uma dor no pé da barriga que ta me matando",
  "to sentindo uma agonia no peito",
  "meu menino ta com o olho remelando e vermelho",
  "tô com uma zuada no ouvido faz dias",
  "deu uma gastura e um passamento aqui",
  "to com uma ingua na virilha",
  "minha vista ta escurecendo",
  "deu uma moleza no corpo e febre",
  "o lugar do botox ficou com um calombo",
  // humano
  "quero falar com um humano",
  // reclamacao
  "voces sao uns incompetentes",
  "remarcaram minha consulta sem me avisar, absurdo",
  // clinico
  "posso beber cerveja depois do botox?",
  "quanto tempo depois do preenchimento posso malhar?",
  "posso tomar sol depois do peeling?",
  // remedio
  "a receita que a doutora passou acabou, ela pode mandar outra?",
  // resultado
  "quero que alguem me explique o laudo",
];

/**
 * Cada correcao de 23/11/2026 e a frase vizinha que TEM de continuar com a
 * equipe (o gatilho esperado).
 */
const VIZINHOS_QUE_CONTINUAM: readonly (readonly [string, string])[] = [
  // "minha filha" e "meu filho" como vocativo
  ["menor_de_idade", "oi minha filha quer marcar uma consulta"],
  ["menor_de_idade", "bom dia, minha filha ta com febre"],
  ["menor_de_idade", "oi minha filha tem 15 anos"],
  ["menor_de_idade", "oi, minha filha, quanto custa a consulta pra ela?"],
  ["menor_de_idade", "minha filha quanto ta a consulta"],
  ["menor_de_idade", "minha filha me disse que vcs atendem unimed"],
  // a crianca que acompanha
  ["menor_de_idade", "vou levar meu filho comigo"],
  ["menor_de_idade", "posso levar meu filho pra consultar?"],
  ["menor_de_idade", "posso levar meu filho de 5 anos pra consulta?"],
  ["menor_de_idade", "minha filha de 8 anos pode fazer o procedimento?"],
  [
    "menor_de_idade",
    "posso levar meu filho? ele tem 10 anos e quer fazer botox",
  ],
  // risco cirurgico
  ["assunto_clinico", "qual o risco cirurgico da lipo?"],
  ["assunto_clinico", "preciso fazer risco cirurgico?"],
  ["assunto_clinico", "fiz o risco cirurgico e deu alterado"],
  ["assunto_clinico", "o botox tem risco?"],
  // "tem problema" fora do atraso
  ["assunto_clinico", "minha menstruação tá atrasada, tem problema?"],
  ["assunto_clinico", "esqueci de tomar o remedio, tem problema?"],
  ["assunto_clinico", "vou chegar sem jejum, tem problema?"],
  // o exame comentado
  ["assunto_clinico", "meus exames deram alterado"],
  [
    "assunto_clinico",
    "a dra pediu pra eu voltar com os exames, deram alterado",
  ],
  [
    "assunto_clinico",
    "o exame de sangue deu alterado, precisa marcar retorno?",
  ],
  ["sintoma", "preciso levar os exames? to com dor"],
  // teste de gravidez e vacina
  ["assunto_clinico", "fiz teste de gravidez e deu positivo"],
  ["sintoma", "tomei a vacina da gripe e meu braço ta inchado"],
  ["assunto_clinico", "posso tomar vacina da gripe gravida?"],
  ["assunto_clinico", "posso fazer o teste de gravidez?"],
  // Socorro
  ["sintoma", "socorro, me ajuda"],
  ["sintoma", "oi, socorro, meu rosto inchou"],
  // falar com a doutora
  ["pedido_humano", "quero falar com a dra ana"],
  ["pedido_humano", "quero falar com a dra ana sobre o resultado"],
  // os que passavam e agora escalam
  ["sintoma", "to com zumbido no ouvido"],
  ["sintoma", "tô sentindo uma queimação no estômago direto"],
  ["sintoma", "to sentindo uma agonia no peito"],
  ["sintoma", "tô com uma zuada no ouvido faz dias"],
  ["sintoma", "deu uma gastura e um passamento aqui"],
  ["sintoma", "to com uma ingua na virilha"],
  ["insatisfacao", "voces sao uns incompetentes"],
  ["insatisfacao", "o botox nao fez efeito nenhum, quero refazer de graça"],
  [
    "assunto_clinico",
    "qual a diferença entre botox e preenchimento, qual é melhor pra mim?",
  ],
  ["assunto_clinico", "qual tratamento é o mais indicado pra mancha?"],
];

/** Vizinhos de recepcao das palavras novas: seguem para o assistente. */
const VIZINHOS_QUE_SEGUEM: readonly string[] = [
  "posso levar meu filho?",
  "boa tarde minha filha, vcs aceitam amil?",
  "obrigada minha filha",
  "quanto custa a consulta de risco cirurgico?",
  "vou me atrasar um pouco, tem problema?",
  "preciso levar os exames na consulta?",
  "quanto custa a vacina da gripe?",
  "oi, é a Socorro",
  "quero falar com a dra ana pra marcar uma consulta",
  "que agonia essa fila kkk",
  "que zuada ai na recepcao",
  "qual a lingua que vcs falam?",
  "qual é melhor pra mim, manhã ou tarde?",
  "qual horario é melhor pra mim?",
  "a avaliação é de graça?",
];

describe.each([false, true])(
  "frases reais de paciente (revisao de 23/11/2026, comPreparo %s)",
  (comPreparo) => {
    it.each(comRotulo(SEGUEM_PARA_O_ASSISTENTE))(
      "segue para o assistente: %s",
      (_rotulo, turno) => {
        expect(motivos(turno, comPreparo)).toEqual([]);
      },
    );

    it.each(comRotulo(PASSAM_PARA_A_EQUIPE_POR_DECISAO))(
      "continua com a equipe por decisao do dono: %s",
      (_rotulo, turno) => {
        expect(motivos(turno, comPreparo)).not.toEqual([]);
      },
    );

    it.each(comRotulo(PASSAM_PARA_A_EQUIPE))(
      "passa para a equipe: %s",
      (_rotulo, turno) => {
        expect(motivos(turno, comPreparo)).not.toEqual([]);
      },
    );

    it.each(VIZINHOS_QUE_CONTINUAM)(
      "o vizinho continua com a equipe (%s): %s",
      (gatilho, texto) => {
        expect(motivos(texto, comPreparo)).toContain(gatilho);
      },
    );

    it.each(VIZINHOS_QUE_SEGUEM)("o vizinho segue: %s", (texto) => {
      expect(motivos(texto, comPreparo)).toEqual([]);
    });
  },
);
