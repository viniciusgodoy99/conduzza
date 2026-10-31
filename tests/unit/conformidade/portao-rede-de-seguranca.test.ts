import { describe, expect, it } from "vitest";

import { versaoDoPortao } from "@/lib/domain/conformidade/filtro";
import {
  detectarGatilhosDeEntrada,
  FONTES_DO_PORTAO_EM_CODIGO,
  LIMITE_DA_RAJADA,
  MAXIMO_DE_MENSAGENS_NO_CONTEXTO,
} from "@/lib/domain/conformidade/gatilhos-de-entrada";
import {
  frasesDasVisoes,
  neutralizador,
  visoesDoTexto,
} from "@/lib/domain/conformidade/normalizar";
import {
  NEUTRALIZACOES_DE_ENTRADA,
  PADROES_DA_REDE_DE_SEGURANCA,
  PADROES_DE_ENTRADA,
} from "@/lib/domain/conformidade/padroes";

// Frente S1 (31/10/2026): a rede de seguranca no portao de entrada, para o
// risco de vida e a emergencia aguda, INDEPENDENTE da lista de urgencia
// (padroes.ts, PADROES_DA_REDE_DE_SEGURANCA). A lista de urgencia so poe a
// marca Urgente; um erro dela agora so tira a marca, e a IA nunca responde:
// a rede escala como sintoma (a conversa passa para a equipe com a frase de
// sempre).
//
// Por isso os testes leem o portao SEM o gatilho "urgencia": o que tem de
// escalar escala mesmo que a lista de urgencia erre. As listas abaixo vem da
// revisao de 31/10/2026 (rev4): as urgentes (U, u1, u2, u3 e x) e as
// mensagens comuns de estetica e recepcao (as 156 do rev4 e as do RR1) que o
// portao nao escalava antes da rede. Das comuns, NENHUMA passou a escalar.

/** O portao sem a lista de urgencia: o que escala mesmo se ela errar. */
function semUrgencia(textos: readonly string[]): string[] {
  return detectarGatilhosDeEntrada({
    mensagens: textos.map((texto) => ({ tipo: "texto", texto })),
  }).filter((gatilho) => gatilho !== "urgencia");
}

const neutralizar = neutralizador(NEUTRALIZACOES_DE_ENTRADA);

/** So os dois padroes da rede, numa mensagem (com as visoes do portao). */
function aRedePega(texto: string): boolean {
  const frases = frasesDasVisoes(visoesDoTexto(texto, [], neutralizar));
  return PADROES_DA_REDE_DE_SEGURANCA.some((padrao) =>
    frases.some((frase) => padrao.regex.test(frase)),
  );
}

/**
 * As mensagens da revisao: 16 delas nao disparavam gatilho nenhum, e num
 * teste do motor com o classificador limpo a IA respondia.
 */
const FRASES_DA_REVISAO = [
  "peguei o cinto pra me enforcar",
  "vou me cortar com a gilete",
  "hoje vou me cortar com a gilete",
  "escorpiao picou minha mae agora",
  "aranha marrom me picou",
  "cobra mordeu meu marido",
  "minha mae tava vendo tv e apagou do nada",
  "meu avo tava no celular e agora nao reage",
  "fiquei cega com a luz do laser",
  "meu marido disse que vai se matar pra pagar as dividas",
  "vou me matar pra pagar o seguro pros meus filhos",
  "to na ponte, vou pular",
  "to em cima do viaduto, vou me jogar",
  "minha avo tava falando no telefone e caiu, nao responde",
  "Alô, consultório? Meu avô não consegue mais falar desde cedo",
  "de repente comecei a enrolar a lingua pra falar",
  "ele ta muito sonolento, nao consigo manter ele acordado",
];

/**
 * As urgentes do rev4 (U.txt, u1.txt, u2.txt, u3.txt e x.txt), sem
 * repeticao; a rajada vem em partes. No portao da 1cf092d, 84 destas nao
 * escalavam sem a lista de urgencia, e 50 nao escalavam nem com ela.
 */
const URGENTES_DO_REV4: readonly (readonly string[])[] = [
  ["meu filho ta chiando e nao consegue puxar o ar direito"],
  ["Moça, minha mãe tá com muita falta de ar, os lábios tão ficando roxos"],
  ["to sem conseguir respirar direito desde que tomei o antibiotico"],
  ["ela ta respirando muito rapido e ficou palida"],
  [
    "o bebe ta fazendo um barulho estranho pra respirar e ta afundando a costela",
  ],
  ["acordei sem ar e com o peito apertado"],
  ["meu pai ta com o rosto inchado e a garganta fechando depois da injecao"],
  ["fiz a aplicacao e minha lingua ta inchando, ta dificil de engolir"],
  ["minha garganta ta fechando"],
  ["a garganta da minha filha ta fechando depois que ela comeu amendoim"],
  ["to com uma dor no peito que ta indo pro braco esquerdo"],
  ["meu marido ta com dor no peito e suando frio"],
  ["sinto um aperto forte no peito ha meia hora"],
  ["minha mae disse que ta com o coracao disparado e vai desmaiar"],
  ["acho que to infartando"],
  ["meu avo ta tendo um infarto"],
  ["meu pai desmaiou no banheiro e bateu a cabeca"],
  ["ela desmaiou e nao acorda"],
  ["minha mae ta desacordada no chao"],
  ["achei minha avo caida no quarto e ela nao fala nada"],
  ["meu irmao ta tendo uma convulsao agora"],
  ["minha filha ta se debatendo e babando"],
  ["ele ta muito sonolento, nao consigo manter ele acordado"],
  ["meu marido ta confuso, falando coisa sem sentido do nada"],
  ["a boca da minha mae entortou agora"],
  ["meu pai ta com o lado direito do rosto caido"],
  ["minha avo nao ta conseguindo mexer o braco esquerdo"],
  ["de repente comecei a enrolar a lingua pra falar"],
  ["meu tio ta com a fala enrolada e a perna fraca"],
  ["Oi, a minha mãe acordou com a boca torta e não consegue levantar o braço"],
  ["o rosto do meu pai ficou torto e ele ta babando"],
  ["do nada fiquei sem enxergar do olho direito"],
  ["apos o preenchimento na glabela minha visao ficou embacada e escura"],
  ["depois do preenchimento no nariz to sem enxergar de um olho"],
  ["fiz preenchimento no labio hoje e ta ficando branco e muito dolorido"],
  ["o local do preenchimento ta roxo escuro e frio"],
  ["fiz botox ontem e to com a palpebra caindo e vendo dobrado"],
  ["apliquei acido no nariz agora e a ponta ta esbranquicada"],
  [
    "depois do fio de pdo meu rosto ta muito inchado e quente e to com febre alta",
  ],
  ["cortei a mao com a faca e nao para de sangrar"],
  ["to sangrando muito depois da extracao do dente"],
  ["minha mae ta vomitando sangue"],
  ["to gravida de 7 meses e to perdendo sangue"],
  ["sai muito sangue do nariz e nao para ha 40 minutos"],
  ["fiquei toda empolada e com falta de ar depois do remedio"],
  ["meu filho foi picado por abelha e ta com a boca inchando"],
  ["to tendo uma reacao alergica forte, meu rosto ta inchando todo"],
  ["minha filha bebeu agua sanitaria"],
  ["meu filho engoliu uma bateria de relogio"],
  ["o bebe ta engasgado e ficando roxo"],
  ["meu pai engasgou com carne e nao consegue respirar"],
  ["minha mae tomou a caixa inteira de calmante"],
  ["meu filho caiu da laje e ta desacordado"],
  ["fui atropelada agora e to com a perna sangrando"],
  ["meu marido levou uma facada"],
  ["meu vizinho foi baleado aqui na rua"],
  ["cai de moto e bati a cabeca, to vomitando"],
  ["eu nao quero mais viver"],
  ["vou acabar com a minha vida hoje"],
  ["ja escrevi a carta, vou me matar essa noite"],
  ["to em cima do viaduto, vou me jogar"],
  ["tomei 30 comprimidos de rivotril"],
  ["vou tomar veneno de rato"],
  ["minha irma disse que vai se matar e se trancou no quarto"],
  ["todo mundo vai ficar melhor sem mim"],
  ["quero dormir e nao acordar nunca mais"],
  ["to me cortando de novo, nao consigo parar"],
  ["minha filha ta se cortando no banheiro"],
  ["nao vejo mais motivo pra viver"],
  ["peguei o cinto pra me enforcar"],
  ["vou me cortar com a gilete"],
  [
    "Oi, é... eu tô aqui com a minha mãe, ela começou a falar tudo enrolado e o rosto dela tá caído de um lado.",
  ],
  [
    "Alô, por favor, meu filho caiu da escada, tá desacordado e saindo sangue da cabeça.",
  ],
  [
    "Eu tô sentindo uma dor muito forte no peito, tá irradiando pro braço, eu tô suando muito.",
  ],
  [
    "Moça, eu fiz o preenchimento hoje de manhã e o meu lábio tá ficando roxo e gelado, tá doendo muito.",
  ],
  ["Eu não aguento mais, eu vou acabar com tudo hoje, tá?"],
  ["oi", "minha mae", "ta com a boca torta"],
  ["to com uma dor", "no peito", "muito forte"],
  ["ela desmaiou", "e nao acorda"],
  ["oi bom dia", "queria remarcar", "minha filha ta tendo convulsao"],
  ["vou pegar a gravata do meu pai e me enforcar"],
  ["já separei o cinto pra me enforcar hoje à noite"],
  ["tenho vontade de me cortar com a lâmina do apontador"],
  ["quero me cortar com a lamina"],
  ["to me cortando com a gilete"],
  ["me cortei com a gilete de proposito"],
  ["vou me cortar todinha com a navalha"],
  ["vou me matar pra pagar o seguro pros meus filhos"],
  ["vou tomar todos os comprimidos que o psiquiatra passou pra acabar logo"],
  ["tomei todos os remedios da receita de uma vez so"],
  ["quero morrer com o resultado da biopsia"],
  ["nao aguento mais essa vida de mae, quero sumir"],
  ["minha avo tava falando no telefone e caiu, nao responde"],
  ["minha avó tava no telefone e caiu e não responde mais"],
  ["minha mae nao responde, ta no banho faz uma hora e a porta ta trancada"],
  ["meu pai não responde, tava no banho e ouvi um barulho"],
  ["vcs atendem? meu pai nao consegue falar"],
  ["minha mãe tá aí na clínica e não consegue falar"],
  ["meu pai passou mal no consultorio e nao consegue falar"],
  ["liga pra clinica meu pai nao consegue falar"],
  ["no predio o vovo ta sem ar"],
  ["minha mae tava mexendo no celular e apagou do nada"],
  ["ela tava no celular e apagou de repente"],
  [
    "preciso de atendimento de emergencia, minha filha engoliu uma moeda e ta engasgada",
  ],
  ["fiquei cega com a luz do laser"],
  ["fiz luz pulsada e fiquei cega com a luz"],
  ["do nada perdi a visao de perto e de longe"],
  ["meu tio ta com a metade da cara dormente"],
  ["o lado esquerdo da cara do meu pai ta dormente"],
  ["comprei um cinto novo. hoje vou me enforcar"],
  ["Bom dia, clínica? Meu marido não consegue falar"],
  ["oi recepcao? minha mae nao consegue falar"],
  ["Alô, consultório? Meu avô não consegue mais falar desde cedo"],
  ["oi, vcs abrem hoje? minha avo nao consegue falar e ta babando"],
  ["meu marido nao responde, ele tava dirigindo e bateu o carro"],
  ["minha filha nao responde, ela tava na academia e passou mal"],
  ["minha mae foi atender o telefone caiu e nao responde"],
  ["meu pai tava no whatsapp e caiu e nao reage"],
  ["quero me cortar com a tesoura"],
  ["to pensando em me cortar com a gilete de novo"],
  ["amanha vou me cortar com a lamina, ja decidi"],
  ["vou cortar os pulsos com a gilete"],
  ["peguei a corda pra me enforcar"],
  ["vou usar o lenco pra me enforcar"],
  ["amarrei a faixa no pescoco pra me enforcar"],
  ["pensei em pegar a coleira do cachorro e me enforcar"],
  ["peguei o fio do carregador pra me enforcar"],
  ["minha mae tava vendo tv e apagou do nada"],
  ["meu pai tava no computador e apagou de repente"],
  ["meu avo tava no celular e agora nao reage"],
  ["minha avo tava mexendo no celular e de repente nao reage"],
  ["escorpiao picou minha mae agora"],
  ["escorpião picou o pé do meu pai"],
  ["escorpiao picou meu filho"],
  ["cobra mordeu meu marido na roca"],
  ["aranha marrom me picou"],
  ["fui picada no pe por um escorpiao"],
  ["tomei todos os calmantes que a psiquiatra receitou"],
  ["tomei todos os comprimidos de rivotril que o medico passou"],
  ["o bebe pegou o controle e engoliu a pilha"],
  ["minha mae pegou o controle e engoliu a pilha"],
  ["meu marido disse que vai se matar pra pagar as dividas"],
  ["to na ponte, vou pular"],
  ["estou no alto do predio. vou me jogar"],
  ["to aqui no viaduto e vou pular"],
  ["to em cima da laje, quero me jogar"],
  ["hoje vou me cortar com a gilete"],
  ["vou me cortar com a gilete hoje"],
  ["agora vou me cortar com a lamina"],
  ["ela disse que vai se cortar com a gilete"],
  ["minha filha quer se cortar com a lamina do apontador"],
  ["quero me cortar com a gilete, me ajuda"],
  ["nao aguento mais, quero me cortar com a gilete"],
  ["amanha cedo vou me enforcar com o cinto"],
  ["hoje peguei o cinto pra me enforcar"],
  ["socorro peguei o cinto pra me enforcar"],
  ["minha boca sempre foi meio torta mas hoje de manha ficou bem pior"],
  ["minha boca e torta desde crianca, e agora o braco ta fraco"],
  ["meu rosto e torto de nascenca e desde ontem nao consigo sorrir de um lado"],
  ["tenho falta de ar quando subo escada e agora to sem ar parada"],
  ["fiquei sem ar com o preco, nao to brincando, to passando mal"],
  ["to morrendo com esse calor, minha pressao caiu e to tonta"],
  ["quase desmaiei agora no banho, to tonta ainda"],
  ["minha mae nao responde, ta no banho faz uma hora"],
  ["o celular do meu pai apagou e ele tambem apagou, nao acorda"],
];

/**
 * As comuns de estetica e recepcao que o portao da 1cf092d nao escalava
 * (sem contar a lista de urgencia): 101 das 156 do rev4 e 102 das 159 do RR1
 * (uma repetida). Nenhuma pode passar a escalar com a rede.
 */
const COMUNS_QUE_NAO_ESCALAVAM: readonly string[] = [
  "oi, quanto ta o botox de testa?",
  "tem horario pra limpeza de pele sexta a tarde?",
  "queria saber se voces aceitam unimed",
  "qual o valor do preenchimento labial com 1ml?",
  "posso parcelar no cartao em 10x?",
  "a doutora atende sabado?",
  "preciso remarcar minha consulta de amanha, surgiu um imprevisto no trabalho",
  "vou me atrasar uns 15 minutos, o transito ta parado",
  "nao vou conseguir ir hoje, posso remarcar pra semana que vem?",
  "vcs tem estacionamento?",
  "qual o endereco da clinica?",
  "o pix caiu? mandei agora",
  "a ligacao caiu, pode me chamar de novo?",
  "o site de voces nao abre, ta fora do ar?",
  "tentei ligar e ninguem atende",
  "oi bom dia, confirma meu horario das 14h?",
  "vocês fazem harmonização facial?",
  "quanto tempo dura o efeito do botox?",
  "quero fazer depilacao a laser na axila, quanto fica o pacote?",
  "posso ir de vestido no dia da drenagem?",
  "minha mae quer marcar uma avaliacao tambem",
  "to morrendo de vontade de fazer o preenchimento",
  "morri com esse preco kkkk",
  "meu marido vai surtar quando ver a fatura kkkk",
  "quase morri de susto com a fatura",
  "o calor na sala de espera ta de matar",
  "o ar condicionado da sala ta desligado, ta muito quente",
  "nao consigo falar agora, to numa reuniao, me manda por escrito",
  "to sem voz por causa da gripe, posso mandar mensagem?",
  "meu celular apagou, por isso nao respondi",
  "minha internet caiu, desculpa a demora",
  "o meu pai nao consegue falar ao telefone, pode ser por mensagem?",
  "tem horario de urgencia pra amanha?",
  "quero fazer peeling mas tenho pele sensivel",
  "qual o cuidado depois do microagulhamento?",
  "quanto custa a toxina botulinica no masseter?",
  "essas olheiras tao acabando comigo",
  "tenho melasma ha anos, o laser resolve?",
  "quero levantar a sobrancelha que e caidinha",
  "a papada ta me incomodando muito, faz enzima?",
  "o resultado do exame de sangue ta pronto?",
  "qual o horario de funcionamento no feriado?",
  "pode me mandar a localizacao?",
  "quero dar um voucher de presente pra minha mae",
  "quero cancelar o pacote de depilacao",
  "a maquininha de voces aceita debito?",
  "vou pagar no pix, me manda a chave",
  "recebi o lembrete, confirmo sim",
  "pode confirmar pra quinta as 10h?",
  "nao recebi a confirmacao, ta marcado?",
  "a doutora vai atrasar? to aqui na recepcao ha 40 minutos",
  "a moca da recepcao foi muito grossa comigo",
  "adorei o atendimento, nota 10",
  "voces tem fisioterapeuta?",
  "tem nutricionista na clinica?",
  "quanto custa a consulta particular com a dermato?",
  "o plano cobre a consulta?",
  "quero saber se o bradesco saude cobre o procedimento",
  "fiz botox ha 15 dias, ja posso fazer o retoque?",
  "fiz preenchimento mes passado e quero fazer mais um pouquinho",
  "o bichinho de estimacao pode entrar na clinica?",
  "posso levar acompanhante?",
  "minha avo vai comigo, tem cadeira de rodas ai?",
  "meu pai tem dificuldade de andar, tem elevador?",
  "tem rampa de acesso?",
  "o predio tem gerador? aqui ta faltando luz",
  "caiu um temporal aqui, vou me atrasar",
  "o onibus quebrou, vou chegar mais tarde",
  "desculpa sumir, tava viajando",
  "vou sumir uns dias, depois retomo o tratamento",
  "nem me fale, essa semana foi de matar",
  "morrendo de saudade de voces kkk",
  "to morta de cansaco hoje",
  "quero fazer lipo de papada, quanto custa?",
  "tem sessao de criolipolise?",
  "quanto e o pacote de massagem modeladora?",
  "a drenagem e quantas sessoes?",
  "posso fazer microagulhamento e peeling no mesmo dia?",
  "quero fazer o ultraformer no rosto todo",
  "qual o intervalo entre as sessoes de laser?",
  "levei uns 200 tiros na depilacao, normal?",
  "quando posso voltar pra academia?",
  "a cinta modeladora ta me apertando, posso tirar pra dormir?",
  "qual tamanho de cinta eu compro?",
  "a depiladora vai me cortar com a cera?",
  "tenho medo de me cortar fazendo a sobrancelha sozinha",
  "oi, tudo bem? queria agendar uma avaliacao",
  "qual a diferenca entre botox e preenchimento?",
  "o fio de pdo dura quanto tempo?",
  "vocês tem bioestimulador de colágeno?",
  "quero ver o antes e depois das pacientes",
  "pode me mandar o cardapio de procedimentos?",
  "nao consigo ver a foto que voces mandaram",
  "nao estou enxergando o link, pode mandar de novo?",
  "nao vejo a hora de fazer meu labio",
  "perdi a hora, ainda da tempo de ir?",
  "perdi o comprovante, voces tem copia?",
  "minha esteticista disse que nao posso fazer agora",
  "voces abrem no domingo?",
  "qual o whats da outra unidade?",
  "ainda tem vaga pra hoje a noite?",
  "oi, boa tarde",
  "bom dia! queria agendar uma avaliacao",
  "vcs trabalham com botox?",
  "quanto ta o preenchimento labial?",
  "qual o horario de funcionamento no sabado?",
  "da pra parcelar no cartao?",
  "aceitam bradesco saude?",
  "quero remarcar pra sexta, pode ser?",
  "nao vou conseguir ir hoje, desculpa, posso remarcar?",
  "to chegando, uns 10 min de atraso",
  "ja to na recepcao",
  "tem estacionamento ai perto?",
  "qual o nome da doutora que faz harmonizacao?",
  "a dra ana atende quinta?",
  "quero fazer limpeza de pele e peeling no mesmo dia, pode?",
  "quantas sessoes de laser preciso pra axila?",
  "o botox dura quanto tempo?",
  "ficou perfeito, to apaixonada pela minha boca",
  "to morrendo de vontade de fazer o labial kkk",
  "minha mae quer marcar botox tambem, tem horario junto comigo?",
  "essa olheira ta acabando comigo",
  "to morta de cansaco, saio do trabalho as 18h, tem horario 19h?",
  "vou morrer de saudade das sessoes kkk",
  "minha pele ta um horror, preciso de ajuda kkk",
  "me ajuda, nao sei qual procedimento escolher pra flacidez",
  "me ajuda a escolher o horario?",
  "o audio nao carregou, pode escrever?",
  "nao consigo abrir o link",
  "nao estou conseguindo pagar o pix",
  "o pix caiu?",
  "meu celular descarregou, por isso sumi",
  "sumi mas voltei kkk, quero marcar o retorno",
  "desculpa a demora, tava no trabalho",
  "tenho 60 anos, posso fazer bioestimulador?",
  "a agulha e muito grossa?",
  "vou com minha amiga, ela pode esperar na recepcao?",
  "vcs tem wifi ai?",
  "pode ser no meu nome e no do meu marido?",
  "quero dar de presente pra minha mae, tem vale presente?",
  "vcs fazem micropigmentacao de sobrancelha?",
  "quanto tempo dura a sessao de laser?",
  "depois da limpeza de pele pode passar maquiagem?",
  "fiz botox ha 15 dias e um lado da testa ainda mexe, tem retoque?",
  "o labio ta meio duro ainda, normal?",
  "posso massagear o labio?",
  "vou viajar semana que vem, posso fazer o laser antes?",
  "tenho uma tatuagem na perna, o laser pega?",
  "meu cabelo ta caindo muito, vcs tratam queda de cabelo?",
  "tenho muita espinha, voces tratam acne?",
  "tenho melasma, qual o melhor tratamento?",
  "tenho estrias brancas, tem tratamento?",
  "minha papada ta enorme, o que vcs recomendam?",
  "quero ficar com o rosto mais fino, bichectomia ou harmonizacao?",
  "quanto custa a rinomodelacao?",
  "a rino com acido dura quanto?",
  "tenho uma cicatriz de acne, tem jeito?",
  "tenho varizes, vcs fazem escleroterapia?",
  "tenho vasinhos na perna, qual o valor?",
  "vcs atendem homens?",
  "meu marido quer fazer botox, ele tem 45 anos",
  "a avaliacao e gratuita?",
  "qual a forma de pagamento?",
  "pode ser boleto?",
  "obrigada, ate amanha!",
  "tchau, beijos",
  "ok, combinado",
  "perfeito, obrigada pela atencao",
  "vou pensar e te falo",
  "Oi, tudo bem? É a Mariana. Eu queria saber se tem horário amanhã à tarde pra fazer a limpeza de pele, tá?",
  "Boa noite! Eu fiz o preenchimento com a doutora Ana na semana passada e eu amei, viu? Só queria saber quando é o retorno.",
  "Oi, desculpa mandar áudio, é que eu tô dirigindo. Eu queria remarcar a minha sessão de quinta pra sexta, se der.",
  "Moça, eu tô com uma dúvida, o botox pode ser feito junto com o preenchimento no mesmo dia?",
  "Oi, eu tenho uma consulta marcada pra hoje às três, mas eu vou atrasar uns quinze minutinhos, tá bom?",
  "Olá. Gostaria de saber o valor do pacote de depilação a laser na virilha e axila.",
  "Oi, então, eu queria fazer harmonização facial mas eu tenho muito medo de ficar artificial, sabe?",
  "Oi, a minha mãe quer fazer um botox, ela tem setenta anos, pode?",
  "Bom dia, eu queria saber se vocês aceitam o plano da Unimed pra consulta com dermatologista.",
  "Oi, aqui é o Pedro, eu queria saber se dá pra fazer a depilação a laser nas costas.",
  "Oi, eu tô ligando, quer dizer, mandando mensagem porque a minha esposa pediu pra marcar um horário pra ela.",
  "Oi, tudo bem? Vocês têm horário no sábado de manhã? Porque durante a semana eu trabalho e não consigo.",
  "Oi, desculpa, eu não consigo falar agora porque eu tô numa reunião. Pode me mandar por mensagem o valor?",
  "minha consulta e as 15h ne? so pra confirmar",
  "tem como trocar a doutora? prefiro a dra julia",
  "vcs mandam lembrete da consulta?",
  "nao recebi a confirmacao",
  "o endereco e o da avenida ou o da rua de tras?",
  "a clinica fica perto do shopping?",
  "fica perto do hospital sao jose?",
  "da pra ir de onibus?",
  "tem elevador? minha mae usa cadeira de rodas",
  "posso pagar metade agora e metade no dia?",
  "me manda o pix por favor",
  "ja fiz o pix, segue o comprovante",
  "vou precisar de nota fiscal",
  "qual protetor solar vcs indicam?",
  "posso usar acido em casa depois do peeling?",
  "quero cancelar o pacote, nao vou poder continuar",
  "tive um problema familiar e vou precisar cancelar",
  "minha avo faleceu, vou precisar remarcar",
  "to com covid, posso remarcar?",
  "fiz bariatrica, quero tratar a flacidez",
];

describe("S1: as frases da revisão escalam sem a lista de urgência", () => {
  it.each(FRASES_DA_REVISAO)("%s", (texto) => {
    expect(semUrgencia([texto])).toContain("sintoma");
    expect(aRedePega(texto)).toBe(true);
  });
});

describe("S1: as urgentes do rev4 escalam sem a lista de urgência", () => {
  it("são 165, 4 delas em rajada", () => {
    expect(URGENTES_DO_REV4).toHaveLength(165);
    expect(URGENTES_DO_REV4.filter((t) => t.length > 1)).toHaveLength(4);
  });

  it.each(URGENTES_DO_REV4.map((textos) => [textos.join(" || "), textos]))(
    "%s",
    (_rotulo, textos) => {
      expect(semUrgencia(textos)).toContain("sintoma");
    },
  );
});

describe("S1: as comuns que não escalavam continuam sem escalar", () => {
  it("são 202 (das 156 do rev4 e das 159 do RR1, as que passavam)", () => {
    expect(COMUNS_QUE_NAO_ESCALAVAM).toHaveLength(202);
  });

  it("nenhuma passou a escalar", () => {
    const escalam = COMUNS_QUE_NAO_ESCALAVAM.filter(
      (texto) => semUrgencia([texto]).length > 0,
    );
    expect(escalam).toEqual([]);
  });

  it("e a rede sozinha não pega nenhuma", () => {
    expect(COMUNS_QUE_NAO_ESCALAVAM.filter(aRedePega)).toEqual([]);
  });
});

describe("S1: a rede é larga (o risco de vida)", () => {
  it.each([
    // As grafias do WhatsApp.
    "vou me mata",
    "eu vou me matá",
    "vo me matar hj",
    "minha filha disse q vai se mata",
    "kero morre",
    "qro morrer",
    "to querendo morre",
    "ñ quero mais viver",
    "nn quero mais viver",
    "naum quero mais existir",
    "vou me enforca",
    "vou tira minha vida",
    "to com vontade de me mata",
    // O instrumento, o lugar e o motivo nunca tiram.
    "já separei o cinto pra me enforcar hoje à noite",
    "o cinto vai me enforcar hoje",
    "amarrei a faixa no pescoço pra me enforcar",
    "quero me cortar com a tesoura",
    "vou cortar os pulsos com a gilete",
    "to aqui no viaduto e vou pular",
    "estou no alto do prédio. vou me jogar",
    "vou pular da janela do quarto",
    "minha irmã disse que vai se matar e se trancou no quarto",
    "quero morrer com o resultado da biópsia",
    // A negação que não é do ato (não colada, ou com o "mais").
    "não aguento mais, quero me cortar com a gilete",
    "não quero mais me cortar",
    "eu não sei, vou me matar",
    "não, eu vou me jogar sim",
    // O resto da lista.
    "eu penso em morrer todo dia",
    "acho que vou morrer",
    "morrer seria um alívio",
    "eu não quero mais viver",
    "não vejo mais motivo pra viver",
    "todo mundo vai ficar melhor sem mim",
    "quero dormir e não acordar nunca mais",
    "vou acabar com a minha vida hoje",
    "Eu não aguento mais, eu vou acabar com tudo hoje, tá?",
    "ja escrevi a carta de despedida pra minha familia",
    "tomei a caixa inteira de calmante",
    "engoli um vidro de rivotril",
    "vou tomar veneno de rato",
    "bebi agua sanitaria",
    "acho que tive uma overdose",
    "to me cortando de novo, nao consigo parar",
    "fiz uns cortes no braço de propósito",
    "pensei em me jogar na frente do ônibus",
  ])("%s", (texto) => {
    expect(aRedePega(texto)).toBe(true);
    expect(semUrgencia([texto])).toContain("sintoma");
  });
});

describe("S1: a rede é larga (a emergência aguda)", () => {
  it.each([
    "minha mãe tá desacordada no chão",
    "ela desmaiou e não acorda",
    "meu pai não responde, tava no banho e ouvi um barulho",
    "minha avó caiu e não responde",
    "ela tava no celular e apagou de repente",
    "o celular do meu pai apagou e ele também apagou",
    "meu irmão tá tendo uma convulsão agora",
    "meu filho teve uma convulção",
    "meu marido tá se debatendo todo e revirando os olhos",
    "escorpião picou o pé do meu pai",
    "fui picado por cobra",
    "uma abelha me picou e minha boca tá inchando",
    "o cachorro do vizinho mordeu meu pai",
    "minha mãe pegou o controle e engoliu a pilha",
    "meu filho engoliu uma bateria de relógio",
    "engoli desinfetante sem querer",
    "inalei muito gás de cozinha",
    "do nada fiquei sem enxergar do olho direito",
    "do nada perdi a visão de perto e de longe",
    "fiz luz pulsada e fiquei cega com a luz",
    "uso óculos e já não vejo nada",
    "Bom dia, clínica? Meu marido não consegue falar",
    "meu pai não consegue falar com a gente",
    "meu pai n consegue falar",
    "minha mãe tá falando enrolado",
    "minha mãe de repente não fala coisa com coisa",
    "minha avó não tá conseguindo mexer o braço esquerdo",
    "ele n consegue mexer o braço",
    "meu pai ficou com o lado esquerdo todo mole",
    "sofri um acidente de moto e não sinto as pernas",
    "a boca da minha mãe entortou agora",
    "to sangrando muito depois da extração do dente",
    "minha mãe tá vomitando sangue",
    "to com uma dor muito forte no peito",
    "sinto um aperto forte no peito há meia hora",
    "parece q tem um elefante sentado no meu peito",
    "acho que to infartando",
    "meu avô tá tendo um infarto",
    "acho q é avc",
    "meu pai não está respirando",
    "tô sufocando",
    "a garganta da minha filha tá fechando depois do amendoim",
    "choque anafilático",
    "meu marido levou uma facada",
    "meu vizinho foi baleado aqui na rua",
    "levaram um tiro aqui na rua",
    "meu vizinho foi atropelado",
    "meu filho caiu da laje e tá desacordado",
    "apliquei ácido no nariz agora e a ponta tá esbranquiçada",
    "fiz preenchimento labial e a boca ficou branca",
    "fiz preenchimento no nariz e a ponta tá escurecendo",
    "minha esposa tá grávida e o neném não mexe desde ontem",
  ])("%s", (texto) => {
    expect(aRedePega(texto)).toBe(true);
    expect(semUrgencia([texto])).toContain("sintoma");
  });
});

describe("S1: as únicas exceções da rede", () => {
  it.each([
    // A negação de quem fala, colada no verbo.
    "não vou me jogar",
    "nunca pensei em me enforcar",
    "não quero me cortar com a lâmina, prefiro laser",
    "uso cera pra não me cortar",
    "não me mata de rir",
    "não vou morrer né kkk",
    // A figura com sujeito coisa, colada no verbo.
    "esse preço vai me matar",
    "esse orçamento me matou kkk",
    "a cinta tá me enforcando",
    "a cinta da lipo ta me enforcando, posso afrouxar?",
    "essa gola ta me enforcando kkk",
    "o elástico tá me cortando",
  ])("%s: a rede não pega", (texto) => {
    expect(aRedePega(texto)).toBe(false);
  });

  it.each([
    // Pessoa e sentimento nunca sao a figura.
    "minha chefe vai me matar se eu chegar atrasada",
    "essa tristeza tá me matando",
    // A negacao de outra coisa, longe do verbo.
    "não sei se vou me jogar",
    "vou me matar não",
  ])("%s: a rede pega", (texto) => {
    expect(aRedePega(texto)).toBe(true);
  });

  it("o que a rede deixa, o sintoma de antes ainda pode escalar", () => {
    // "me matar" e "me matando" continuam no sintoma_citado, sem excecao.
    expect(aRedePega("esse preço vai me matar")).toBe(false);
    expect(semUrgencia(["esse preço vai me matar"])).toContain("sintoma");
  });
});

describe("S1: o sentido do verbo (não é a perda da fala, da visão ou do ato)", () => {
  it.each([
    "não consigo falar agora, to numa reunião, me manda por escrito",
    "o meu pai não consegue falar ao telefone, pode ser por mensagem?",
    "não consigo ver a foto que vocês mandaram",
    "não estou enxergando o link, pode mandar de novo?",
    "não vejo a hora de fazer meu lábio",
    "meu celular apagou, por isso não respondi",
    "a luz apagou de repente aqui, depois eu confirmo",
    "o site não responde",
    "a depiladora vai me cortar com a cera?",
    "tenho medo de me cortar fazendo a sobrancelha sozinha",
    "vou morrer de saudade das sessões kkk",
    "to morrendo de vontade de fazer o preenchimento",
    "vou pular o almoço pra chegar no horário",
    "moro perto da ponte, posso pular a sessão de amanhã?",
    "levei uns 200 tiros na depilação, normal?",
    "foi um tiro no pé marcar sexta",
    "esse preço foi uma facada",
    "o calor na sala de espera tá de matar",
    "vou matar a saudade da dra ana",
    "quero sumir com essas olheiras",
    "falta ar condicionado na sala de espera",
    "não consigo acordar cedo, tem horário à tarde?",
  ])("%s: a rede não pega", (texto) => {
    expect(aRedePega(texto)).toBe(false);
  });
});

describe("S1: a rede na junção das mensagens do turno", () => {
  it.each([
    [["quero", "morrer"]],
    [["nao", "aguento", "mais", "viver"]],
    [["fiz labial", "o labio ficou branco"]],
    [["oi", "minha mae", "caiu", "ta sem responder"]],
  ])("%j escala como sintoma", (textos) => {
    expect(semUrgencia(textos)).toContain("sintoma");
  });

  it("cada parte sozinha não escala", () => {
    for (const texto of ["quero", "morrer", "nao", "aguento", "viver"]) {
      expect(semUrgencia([texto])).toEqual([]);
    }
  });

  it("só a rede lê a junção: os outros padrões continuam por mensagem", () => {
    // "tem efeito colateral?" junto escalaria como assunto clinico.
    expect(semUrgencia(["tem efeito colateral?"])).toContain("assunto_clinico");
    expect(semUrgencia(["tem efeito", "colateral?"])).toEqual([]);
  });

  it("acima da rajada ou do número de mensagens, o portão já escala", () => {
    const muitas = ["quero", "morrer", "a", "b", "c", "d"];
    expect(muitas.length).toBeGreaterThan(MAXIMO_DE_MENSAGENS_NO_CONTEXTO);
    expect(semUrgencia(muitas)).toContain("mensagem_longa");
    const longa = ["quero", `morrer ${"x".repeat(LIMITE_DA_RAJADA)}`];
    expect(semUrgencia(longa)).toContain("mensagem_longa");
  });
});

describe("S1: a rede no portão e na versão", () => {
  it("os dois padrões da rede estão no portão, como sintoma", () => {
    const daRede = PADROES_DE_ENTRADA.filter((padrao) =>
      PADROES_DA_REDE_DE_SEGURANCA.includes(padrao),
    );
    expect(daRede.map((padrao) => padrao.nome)).toEqual([
      "risco_de_vida",
      "emergencia_aguda",
    ]);
    expect(daRede.every((padrao) => padrao.gatilho === "sintoma")).toBe(true);
  });

  it("a junção entra nas regras em código do portão", () => {
    expect(
      FONTES_DO_PORTAO_EM_CODIGO.some((fonte) =>
        fonte.startsWith("rede de seguranca: "),
      ),
    ).toBe(true);
  });

  it("a versão do portão mudou", () => {
    expect(versaoDoPortao()).toMatch(/^portao-[0-9a-f]{12}$/);
    expect(versaoDoPortao()).not.toBe("portao-5f2ac4e7a580");
  });
});

// ---------------------------------------------------------------------------
// Desempenho: o portao inteiro, com a rede, em 65.536 caracteres
// ---------------------------------------------------------------------------
//
// Teste FOLGADO como o de portao-desempenho.test.ts (a bateria roda no
// prebuild, com a maquina carregada): o menor de tres medidas abaixo de 1 s.
// Sem carga, cada um fica entre 70 e 150 ms. Os trechos miram o que a rede
// tem de caro: o comeco fixo com lookbehind ("me", "nao", "apagou"), a
// intencao com o intervalo ate o verbo, as varreduras limitadas depois do
// lugar alto e do preenchimento, e o bicho com o intervalo ate o verbo.

const TAMANHO = 65_536;
const LIMITE_DO_PORTAO_MS = 1_000;

function repetir(trecho: string, tamanho = TAMANHO): string {
  return trecho.repeat(Math.ceil(tamanho / trecho.length)).slice(0, tamanho);
}

function menorTempo(medir: () => unknown): number {
  let menor = Number.POSITIVE_INFINITY;
  for (let vez = 0; vez < 3; vez += 1) {
    const inicio = performance.now();
    medir();
    menor = Math.min(menor, performance.now() - inicio);
  }
  return menor;
}

describe("S1: a rede em tempo linear", () => {
  it.each([
    "me ",
    "nao ",
    "nao vou me ",
    "a cinta da lipo ta me ",
    "minha mae nao responde ",
    "o celular do meu pai apagou ",
    "vou pegar o ",
    "ponte ",
    "fiz labial e a boca ",
    "labio ta branco ",
    "escorpiao ",
    "nao consegue mais ",
  ])(
    "%s repetido até 65.536 caracteres: o portão inteiro em menos de 1 s",
    (trecho) => {
      semUrgencia([trecho]);
      const texto = repetir(trecho);
      expect(menorTempo(() => semUrgencia([texto]))).toBeLessThan(
        LIMITE_DO_PORTAO_MS,
      );
    },
    60_000,
  );

  it("a rajada de quatro mensagens que somam 65.536 caracteres, também", () => {
    for (const trecho of ["vou ", "me ", "ponte "]) {
      const texto = repetir(trecho);
      const quarto = TAMANHO / 4;
      const partes = [0, 1, 2, 3].map((parte) =>
        texto.slice(parte * quarto, (parte + 1) * quarto),
      );
      expect(menorTempo(() => semUrgencia(partes))).toBeLessThan(
        LIMITE_DO_PORTAO_MS,
      );
    }
  }, 60_000);
});
