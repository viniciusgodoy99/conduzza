// Padroes do filtro de conformidade (saida da IA) e do portao de entrada
// (mensagem do paciente). PURO, zero I/O.
//
// Todos os padroes sao escritos para o texto JA NORMALIZADO (normalizar.ts):
// minusculas, sem acento, homoglifo trocado, letras soltas juntadas. Por isso
// "orientacao" aqui casa "orientação", "ORIENTAÇÃO" e "0r1ent4cao".
//
// A regra so BLOQUEIA (ou escala, na entrada). Ela nunca aprova sozinha: o
// rascunho limpo ainda passa pelo verificador por modelo, que falha fechado
// (sem veredicto valido, nao envia). Por isso a camada deterministica pega o
// OBVIO com precisao alta (revisao de 05/10/2026): parafrase, giria rara e
// outro idioma ficam para o modelo. Na duvida entre bloquear frase normal de
// recepcao e deixar uma parafrase para o modelo, fica para o modelo. A
// excecao e preco: o modelo nao julga valor, entao numero com cara de preco
// so e lido aqui. Todo padrao novo precisa de controle (frase normal que
// nao pode cair) na bateria.
//
// Os padroes casam PREFIXO de palavra (sem \b no fim) quando a palavra tem
// flexao ("garant" pega garante, garantido, garantia, garantimos).
//
// Nenhuma regex aqui tem a flag g: elas sao compartilhadas e usadas com
// .test(), que com g guardaria estado entre chamadas.
//
// PENDENCIA DO DONO (lista de remedios): MEDICAMENTOS abaixo foi montada a
// mao (principios ativos e marcas comuns no Brasil e em estetica) e ampliada
// depois da revisao adversarial de 05/10/2026. A lista DEFINITIVA tem de vir
// de fonte oficial (Anvisa: lista de DCB e bulario; CMED: lista de precos de
// medicamentos), com o dono indicando a fonte e a data. Ate la, nao digitar
// mais nomes de cabeca: o verificador por modelo cobre o que falta.

import type {
  CategoriaDeConformidade,
  GatilhoDeEntrada,
} from "@/lib/domain/conformidade/categorias";
import {
  compactar,
  type Neutralizacao,
} from "@/lib/domain/conformidade/normalizar";

export type PadraoDeSaida = {
  categoria: Exclude<CategoriaDeConformidade, "falha_verificador">;
  nome: string;
  regex: RegExp;
};

export type PadraoDeEntrada = {
  gatilho: GatilhoDeEntrada;
  nome: string;
  regex: RegExp;
};

function alternativas(termos: readonly string[]): string {
  return `(?:${termos.join("|")})`;
}

// ---------------------------------------------------------------------------
// Lexicos compartilhados
// ---------------------------------------------------------------------------

/**
 * Remedios: principios ativos e marcas comuns no Brasil, como PREFIXO (pega
 * plural, feminino e nome truncado). Procedimento estetico (toxina,
 * preenchimento, bioestimulador) NAO entra: e catalogo, nao remedio.
 */
export const MEDICAMENTOS = [
  "dipir",
  "dipi\\b",
  "novalgin",
  "paracetamo",
  "tylenol",
  "ibuprof",
  "advil",
  "alivium",
  "buscopan",
  "escopolamin",
  "nimesulid",
  "diclofenac",
  "cataflam",
  "voltaren",
  "cetoprof",
  "profenid",
  "naproxen",
  "aspirin",
  "acido acetilsalicilico",
  "\\baas\\b",
  "amoxicil",
  "amoxil\\b",
  "clavulanat",
  "azitromicin",
  "cefalexin",
  "ciprofloxacin",
  "doxiciclin",
  "metronidazol",
  "nistatin",
  "fluconazol",
  "cetoconazol",
  "clotrimazol",
  "aciclovir",
  "valaciclovir",
  "predniso",
  "dexametason",
  "betametason",
  "hidrocortison",
  "loratadin",
  "desloratadin",
  "cetirizin",
  "fexofenadin",
  "allegra\\b",
  "polaramine",
  "dexclorfeniramin",
  "hidroxizin",
  "prometazin",
  "fenergan",
  "omeprazol",
  "pantoprazol",
  "ranitidin",
  "dramin\\b",
  "dimenidrinat",
  "ondansetron",
  "plasil",
  "metoclopramid",
  "simeticon",
  "luftal",
  "loperamid",
  "isotretinoin",
  "roacutan",
  "tretinoin",
  "acido retinoico",
  "adapalen",
  "hidroquinon",
  "acido tranexamico",
  "minoxidil",
  "finasterid",
  "dutasterid",
  "espironolacton",
  "metformin",
  "glifage",
  "semaglutid",
  "ozempic",
  "wegovy",
  "rybelsus",
  "tirzepatid",
  "mounjaro",
  "liraglutid",
  "saxenda",
  "victoza",
  "sibutramin",
  "orlistat",
  "topiramat",
  "fluoxetin",
  "sertralin",
  "escitalopram",
  "citalopram",
  "paroxetin",
  "venlafaxin",
  "bupropion",
  "amitriptilin",
  "clonazepam",
  "rivotril",
  "alprazolam",
  "diazepam",
  "zolpidem",
  "melatonin",
  "varfarin",
  "warfarin",
  "marevan",
  "clopidogrel",
  "rivaroxaban",
  "xarelto",
  "apixaban",
  "eliquis",
  "heparin",
  "enoxaparin",
  "clexane",
  "losartan",
  "enalapril",
  "captopril",
  "atenolol",
  "propranolol",
  "anlodipin",
  "hidroclorotiazid",
  "furosemid",
  "sinvastatin",
  "atorvastatin",
  "rosuvastatin",
  "levotiroxin",
  "puran t4",
  "euthyrox",
  "insulin",
  "cortison",
  "morfin",
  "tramadol",
  "tramal\\b",
  "codein",
  "dorflex",
  "neosaldin",
  "torsilax",
  "miosan",
  "ciclobenzaprin",
  "sildenafil",
  "tadalafil",
  "viagra",
  "cialis",
  "misoprostol",
  "cytotec",
  "lidocain",
  "arnica",
  "hirudoid",
  "bepantol",
  "nebacetin",
  "neomicin",
  "bacitracin",
  "mupirocin",
  "bactroban",
  "fucidin",
  "acido fusidico",
  "sulfadiazin",
  // Revisao adversarial de 05/10/2026 (estetica e marcas comuns)
  "emla\\b",
  "hialuronidas",
  "triancinolon",
  "kenalog",
  "trombofob",
  "thrombocid",
  "decadron",
  "diprospan",
  "celestone",
  "benzetacil",
  "penicilin",
  "bactrim",
  "sulfametoxazol",
  "benegrip",
  "cimegrip",
  "resfenol",
  "melhoral",
  "doril\\b",
  "nisulid",
  "toragesic",
  "cetorolac",
  "lexotan",
  "bromazepam",
  "valium",
  "ivermectin",
  "albendazol",
  "hipoglos",
  "prozac",
  "lexapro",
  "pregabalin",
  "gabapentin",
] as const;

/** Classes e palavras genericas de remedio (pt, en, es). */
const REMEDIO_GENERICO = [
  "remedi",
  "antitermic",
  "antiacid",
  "laxante",
  "diuretic",
  "antiemetic",
  "antidiarreic",
  "descongestionante",
  "expectorante",
  "soro fisiologico",
  "cicatrizante",
  "medicament",
  "medicac",
  "farmac",
  "comprimid",
  "capsul",
  "pilul",
  "pastilh",
  "xarope",
  "colirio",
  "pomad",
  "antibiot",
  "anti-?inflamat",
  "antinflamat",
  "analges",
  "anti-?alerg",
  "anti-?histamin",
  "corticoi",
  "corticosteroi",
  "anticoagul",
  "antidepress",
  "ansiolit",
  "anticoncep",
  "antiviral",
  "antifung",
  "antissept",
  "anestesic",
  "relaxante muscular",
  "calmante",
  "suplement",
  "vitamina",
  "polivitamin",
  "hormoni",
  "receita medica",
  "receita de",
  "receitar",
  "receito",
  "prescri",
  "prescrev",
  "automedic",
  // en
  "painkiller",
  "pain reliever",
  "acetaminophen",
  "antibiotic",
  "antihistamine",
  "ointment",
  "medication",
  "medicine",
  "pills?\\b",
  "drugs?\\b",
  "prescription",
  // es
  "pastilla",
  "jarabe",
  "receta\\b",
];

/** Sintomas e sinais que a recepcao virtual nunca descreve nem comenta. */
const SINTOMAS = [
  "dor\\b",
  "dores\\b",
  "dorzinha",
  "dorzona",
  "febr",
  "doendo",
  "\\bdoi\\b",
  "dolorid",
  "febril",
  "sangr",
  "inchac",
  "inchad",
  "inchou",
  "incha\\b",
  "hematoma",
  "vermelhidao",
  "coceira",
  "cocando",
  "ardencia",
  "ardendo",
  "ardor\\b",
  "pus\\b",
  "secrecao",
  "falta de ar",
  "tontura",
  "desmai",
  "vomit",
  "nausea",
  "enjoo",
  "diarreia",
  "infecc",
  "infeccion",
  "infectad",
  "inflamac",
  "inflamad",
  "alergi",
  "alergic",
  "formigament",
  "dormencia",
  "caroco",
  "nodulo",
  "ferida",
  "lesao",
  "lesoes",
  "queimadura",
  "sintoma",
  "latej",
  "roxinh",
  "carocinh",
  "desinch",
  "calombo",
  "pontada",
  "fisgada",
  "repux",
  "zonz",
  "tontei",
  // en
  "fever",
  "bleed",
  "swelling",
  "swollen",
  "rash\\b",
  "itch",
  "dizz",
  "vomit",
  "nause",
  "chest pain",
  "headache",
  "infection",
  "allerg",
  // es
  "fiebre",
  "sangrado",
  "hinchazon",
  "hinchad",
  "mareo",
  "dolor\\b",
];

/** Doencas e quadros: nomear um deles para o paciente e diagnostico. */
const DOENCAS = [
  "rinite",
  "sinusite",
  "enxaqueca",
  "migranea",
  "dermatite",
  "eczema",
  "psoriase",
  "herpes",
  "micose",
  "candidiase",
  "cistite",
  "tumor",
  "cancer",
  "cisto\\b",
  "cistos\\b",
  "trombose",
  "embolia",
  "infarto",
  "avc\\b",
  "derrame",
  "apendicite",
  "gastrite",
  "ulcera",
  "hernia",
  "hipertens",
  "diabet",
  "anemia",
  "depressao",
  "ansiedade",
  "pneumonia",
  "covid",
  "dengue",
  "zika",
  "chikungunya",
  "catapora",
  "sarampo",
  "conjuntivite",
  "otite",
  "amigdalite",
  "faringite",
  "bronquite",
  "asma\\b",
  "refluxo",
  "virose",
  "gripe",
  "resfriad",
  "intoxicac",
  "foliculite",
  "urticaria",
  "erisipela",
  "celulite infecciosa",
  "fungo",
  "bacteria",
  "virus\\b",
  "necrose",
  "granuloma",
  "ptose",
  "edema",
  "abscesso",
  "rejeicao (?:ao|do|da) (?:produto|preenchimento|implante|organismo|fio|material)",
  "reacao alergica",
  "reacao ao (?:produto|procedimento|preenchimento|acido|botox|anestesico)",
  // en
  "rhinitis",
  "migraine",
  "dermatitis",
  "allergic reaction",
  // es
  "rinitis",
  "migrana",
  "reaccion alergica",
  "infeccion",
];

// ---------------------------------------------------------------------------
// Saida: padroes por categoria
// ---------------------------------------------------------------------------

function p(
  categoria: PadraoDeSaida["categoria"],
  nome: string,
  fonte: string,
): PadraoDeSaida {
  return { categoria, nome, regex: new RegExp(fonte) };
}

const ALVOS_DE_CUIDADO = alternativas([
  "compress\\w*",
  "gel\\w*",
  "bolsa de gelo",
  "agua morna",
  "agua fria",
  "agua gelada",
  "pomada",
  "creme",
  "protetor",
  "filtro solar",
  "hidratante",
  "soro\\b",
  "curativo",
  "atadura",
  "cha\\b",
  "oleo",
  "vaselina",
  "babosa",
  "aloe",
  "arnica",
  "toalha",
  "sabonete",
]);

// Habitos que nao sao lugar: valem tambem depois de "longe de" ("longe do
// sol"). Lugar ("longe da praia") e endereco, nao orientacao.
const HABITOS_QUE_NAO_SAO_LUGAR = [
  "sol\\b",
  "exposicao",
  "calor",
  "bebida alcoolica",
  "bebidas?",
  "alcool",
  "cerveja",
  "vinho",
  "cafe\\b",
  "cafeina",
  "cigarro",
  "fumar",
  "maquiagem",
  // emoji de sol (o filtro le o emoji como caractere)
  "\\u2600",
  "\\ud83c\\udf1e",
];

// "Mexer" e "tocar" sairam em 05/10/2026: "sem mexer no seu horario" e
// recepcao. Mexer ou tocar NA REGIAO continua em mexer_na_regiao.
const HABITOS_DE_LUGAR_E_DO_CORPO = [
  "praia",
  "piscina",
  "mar\\b",
  "sauna",
  "atividade fisica",
  "atividades fisicas",
  "exercicio",
  "academia",
  "musculacao",
  "malhar",
  "treinar",
  "deitar",
  "abaixar",
  "cocar",
  "apertar",
  "espremer",
  "massagear",
  "molhar",
  "depilar",
  "banho quente",
  "tomar banho",
  "relac(?:ao|oes) sexua",
  "sexo",
];

// "Sem esforco" e jeito de falar ("remarca sem esforco"); "evite esforco"
// e orientacao.
const HABITOS = alternativas([
  ...HABITOS_QUE_NAO_SAO_LUGAR,
  ...HABITOS_DE_LUGAR_E_DO_CORPO,
  "esforco",
]);
const HABITOS_DEPOIS_DE_SEM = alternativas([
  ...HABITOS_QUE_NAO_SAO_LUGAR,
  ...HABITOS_DE_LUGAR_E_DO_CORPO,
]);
const HABITOS_DEPOIS_DE_LONGE = alternativas(HABITOS_QUE_NAO_SAO_LUGAR);

const REGIOES = alternativas([
  "regiao",
  "area\\b",
  "local\\b",
  "rosto",
  "pele",
  "ferida",
  "lesao",
  "curativo",
  "pontos",
  "olhos?\\b",
  "labios?\\b",
  "testa",
  "machucado",
  "cicatriz",
  "tratad",
  "aplicad",
]);

export const PADROES_DE_SAIDA: readonly PadraoDeSaida[] = [
  // ---- triagem -------------------------------------------------------------
  p("triagem", "sintoma_citado", `\\b${alternativas(SINTOMAS)}`),
  // "O atendimento e normal amanha" e funcionamento, nao triagem. "Comum"
  // so com "isso" na frente ("e comum a agenda lotar" e recepcao).
  p(
    "triagem",
    "normalidade_ou_gravidade",
    "(?<!\\b(?:atendimento|funcionamento|expediente|horario|agenda|movimento|transito) )\\b(?:e|eh|esta|estao|sao|parece|parecem|ficou|isso e|isso ai e|nao e|nao parece|nao deve ser|deve ser|tudo|provavelmente)\\b (?:bem |muito |totalmente |super |algo |nada |so |completamente |perfeitamente |bastante )?(?:normal|normais|grave|graves|serio|serios|preocupante|preocupantes|perigos[oa]s?|benign[oa]s?|passageir[oa]s?|inofensiv[oa]s?)\\b|\\bisso (?:ai )?(?:e|eh) (?:bem |muito |super |algo |totalmente )?comu(?:m|ns)\\b",
  ),
  // Estreitado em 05/10/2026 (precisao): "nao foi nada demais", "que
  // bobagem", "coisa simples" e "a agenda deve normalizar" sao recepcao.
  // Bobagem e besteira so com "isso" na frente; o resto fica para o modelo.
  p(
    "triagem",
    "normalidade_coloquial",
    "\\bnormalzinh|\\b(?:dias?|horas?|semanas?) normaliz|\\bnormaliz\\w* sozinh|\\b(?:dentro|faz parte) do esperado\\b|\\bcoisa (?:boba|normal|a toa|passageira|d[oa] (?:primeiro|segundo|terceiro|primeira|segunda) (?:dia|semana))|\\bisso (?:ai )?(?:e|eh) (?:so )?(?:uma )?(?:bobeira|bobagem|besteira|nada demais)\\b|\\bda e passa\\b",
  ),
  p(
    "triagem",
    "comum_ou_esperado_no_corpo",
    "\\b(?:e|sao|parece|isso e) (?:bem |muito |super |totalmente )?(?:comum|comuns|esperad[oa]s?|natural|naturais|leve|leves) (?:sentir|ficar|ter|aparecer|acontecer|surgir|dar|inchar|doer|arder|cocar|sangrar|que (?:fique|inche|doa|arda|apareca|aconteca|surja))",
  ),
  p(
    "triagem",
    "nada_grave",
    "\\bnada (?:de )?(?:grave|serio|preocupante)|\\b(?:nao ha|nao tem|sem|nenhum) motivo (?:para|de|pra) (?:preocupac|alarme|panico|se preocupar)",
  ),
  p(
    "triagem",
    "reacao_normal",
    "\\b(?:reac(?:ao|oes)|efeitos?|inchaco|vermelhidao|ardencia|coceira|hematomas?|roxo|sensibilidade|descamacao|incomodo|desconforto) (?:\\w+ ){0,2}?(?:normal|normais|comum|comuns|esperad[oa]s?|passageir[oa]s?|natural|naturais|benign[oa]s?|leve|leves|tranquil[oa]s?)\\b",
  ),
  p(
    "triagem",
    "parece_reacao",
    "\\b(?:parece|e|eh|deve ser|pode ser|sera|seria) (?:ser )?(?:so |apenas )?(?:uma? )?(?:reac|irritac|sensibilidade|alergi|inflamac|infecc|hematoma|inchac|vermelhidao)",
  ),
  p(
    "triagem",
    "faz_parte",
    "\\bfaz parte (?:do processo|da recuperacao|do procedimento|do tratamento|da cicatrizacao)|\\b(?:e|isso e|sao) (?:o |bem |totalmente |algo )?esperad[oa]s?\\b(?! que)|\\be (?:do|da) (?:proprio |propria )?(?:processo|recuperacao|cicatrizacao)\\b",
  ),

  p(
    "triagem",
    "pronto_socorro",
    // "Urgencia", "hospital", "posto de saude" e "plantao" so como destino
    // ("va ao hospital", "corre pra urgencia"): "tem urgencia?", "ao lado
    // do Hospital X" e "a Dra. Ana esta no plantao" sao recepcao.
    "\\b(?:pronto[ -]?socorro|pronto[ -]?atendimento|upa\\b|emergencia|samu\\b|(?<![\\d.,$])192\\b(?![.,]\\d)|ambulancia)|\\b(?:na|pra|para a|numa|caso de|sala de|servico de|atendimento de|ir a|va a|vai a|corra a|corre a|liga pra|ligue para a|procure a|procura a) urgencia\\b|\\b(?:ao|pro|para o|pra o|num|para um|pra um|a um|ir no|va no|vai no|corre no|corra no) (?:hospital|posto de saude|plantao|ps)\\b(?!:)",
  ),
  p(
    "triagem",
    "procure_medico",
    "\\bprocur(?:e|ar|a)\\b (?:um |uma |o |a |seu |sua )?(?:medic|atendimento|ajuda medica|socorro|hospital|especialista|dermatologista|cardiologista|clinico|ortopedista|ginecologista|pediatra|neurologista|oftalmologista|dentista)",
  ),
  p(
    "triagem",
    "avaliou_descricao",
    "\\b(?:pela|pelas|pelo|pelos) (?:sua |seu |suas |seus )?(?:descric|sintoma|relato|foto|imagem|caracteristica)|\\bpelo que (?:voce |a senhora |o senhor )?(?:descreveu|contou|falou|disse|relatou|mandou|mostrou)",
  ),
  p(
    "triagem",
    "previsao_de_melhora",
    "\\b(?:costuma|costumam|tende a|tendem a)\\b (?:\\w+ )?(?:passar|sumir|melhorar|desaparecer|diminuir|regredir|desinchar|reduzir|cicatrizar|sarar|aliviar|absorver)\\b|\\b(?:deve|devem)\\b (?:\\w+ )?(?:sumir|melhorar|desaparecer|diminuir|regredir|desinchar|cicatrizar|sarar|aliviar|absorver)\\b",
  ),
  p(
    "triagem",
    "vai_melhorar",
    "\\b(?:vai|vao|ira|irao)\\b (?:\\w+ )?(?:sumir|melhorar|desaparecer|diminuir|regredir|desinchar|cicatrizar|sarar|aliviar|absorver)\\b|\\b(?:da|dar|deu|vai dar) uma (?:aliviada|melhorada|desinchada|diminuida|acalmada|sumida)\\b",
  ),
  p(
    "triagem",
    "passa_sozinho",
    // "Sai sozinho" fica de fora: "o lembrete sai sozinho" e recepcao.
    "\\bpassa(?:r)? (?:logo|sozinh|rapido|em (?:poucos|alguns|\\d+) (?:dias|horas|semanas))|\\bmelhora(?:m)? em (?:poucos|alguns|\\d+)|\\b(?:some|desaparece|desincha|melhora|sara) sozinh",
  ),
  p(
    "triagem",
    "fica_bom_em_dias",
    "\\b(?:daqui a|em) (?:uns |alguns |poucos |\\d+ |dois |tres )?(?:dias?|semanas?|horas?) (?:\\w+ ){0,2}?(?:ta|fica|esta|estara|vai estar|vai ficar) (?:novinh|bo[am]\\b|sarad|curad|desinchad|cicatrizad)",
  ),
  p(
    "triagem",
    "dispensa_atendimento",
    "\\bnao (?:precisa|e necessario|ha necessidade de|tem necessidade de|e preciso)\\b (?:\\w+ ){0,2}(?:ir ao|ir a|ir no|ir na|procurar|ver um|consultar|se preocupar|preocupar|fazer nada|tomar nada)",
  ),
  p(
    "triagem",
    "se_piorar",
    "\\bse (?:piorar|piora|persistir|nao melhorar|sangrar|inchar|doer|tiver febre|der febre)",
  ),
  p(
    "triagem",
    "acontece_com_todos",
    "\\bacontece (?:com )?(?:muita gente|muitas pessoas|todo mundo|frequencia|bastante|direto|sempre)",
  ),
  // en
  p(
    "triagem",
    "normalidade_en",
    "\\b(?:it'?s|its|it is|that'?s|that is|this is|looks|seems|sounds) (?:totally |completely |perfectly |pretty |very |quite |probably |just )?(?:normal|fine|common|nothing serious|not serious|serious|harmless|expected)\\b",
  ),
  p(
    "triagem",
    "pode_ser_en",
    "\\b(?:could|might|may|must|probably) (?:just )?be (?:a |an )?(?:infection|allerg|reaction|inflammation|virus|flu|cold|migraine|sinus|nothing)",
  ),
  p(
    "triagem",
    "procure_medico_en",
    "\\b(?:go to (?:the )?(?:er|emergency|hospital|doctor)|see a doctor)\\b",
  ),
  // es
  p(
    "triagem",
    "normalidade_es",
    "\\b(?:es|parece|esta) (?:muy |totalmente |completamente )?(?:normal|grave|serio|comun)\\b|\\bno es (?:nada )?grave\\b",
  ),
  p(
    "triagem",
    "procure_medico_es",
    "\\b(?:vaya|acuda) (?:a|al) (?:urgencias|hospital|medico)",
  ),

  // ---- diagnostico ---------------------------------------------------------
  p("diagnostico", "doenca_citada", `\\b${alternativas(DOENCAS)}`),
  p(
    "diagnostico",
    "voce_tem",
    "\\b(?:voce|vc|a senhora|o senhor)\\b.{0,25}\\b(?:tem|esta com|esta tendo|teve|deve ter|pode ter|parece ter|apresenta|desenvolveu|pegou)\\b.{0,25}\\b(?:quadro|sindrome|doenca|condicao|disturbio|deficiencia|reacao|alergi|infecc|inflamac|virose|sintoma)",
  ),
  p(
    "diagnostico",
    "sinal_de",
    "\\b(?:sintoma|sintomas|sinal|sinais|indicio|indicios|indicativo) (?:de|da|do|tipico)\\b(?! (?:r ?\\$|rs\\b|brl\\b|\\d|uma parte\\b|pagamento|reserva|entrada))|\\b(?:e|sao|parece) (?:bem |muito )?(?:tipic|caracteristic|classic)[oa]s? (?:de|da|do)\\b|\\bquadro (?:de|clinico) (?:alergi|infecc|inflamac|virose|gripe|ansiedade|depressao|dermatite|rinite)",
  ),
  p(
    "diagnostico",
    "tem_cara_de",
    "\\b(?:tem cara de|tem jeito de|lembra muito)\\b",
  ),
  p(
    "diagnostico",
    "isso_e_quadro_comum",
    "\\b(?:isso (?:ai )?e|e so|deve ser|pode ser|parece|parece ser|jeitao de|jeito de|cara de|provavelmente e|voce tem|vc tem|esta com|ta com) (?:so )?(?:uma? )?(?:coisa de )?(?:acne|melasma|rosacea|queloide|tercol|labirintite|pelo encravado|espinha|estresse|pressao alta)\\b",
  ),
  p(
    "diagnostico",
    "indica_que",
    "\\b(?:indica|indicam|sugere|sugerem|significa|significam)\\b (?:que )?(?:voce|a senhora|o senhor|uma? (?:reacao|alergi|infecc|inflamac|quadro|problema))",
  ),
  // en
  p(
    "diagnostico",
    "voce_tem_en",
    "\\byou (?:have|probably have|might have|may have|could have|got)\\b (?:a |an )?(?:\\w+ )?(?:infection|allerg|rhinitis|migraine|dermatitis|flu|virus|condition|disease|reaction)|\\b(?:symptom|sign)s? of\\b|\\bsounds like\\b",
  ),
  // es
  p(
    "diagnostico",
    "voce_tem_es",
    "\\b(?:usted tiene|tienes|tiene usted)\\b.{0,20}(?:infeccion|alergia|rinitis|migrana|dermatitis|gripe)|\\b(?:sintoma|senal) de\\b",
  ),

  // ---- orientacao clinica --------------------------------------------------
  p(
    "orientacao_clinica",
    "aplicar_algo",
    `\\b(?:faca|faz|fazer|aplique|aplica|aplicar|coloque|coloca|colocar|ponha|poe|use|usa|usar|passe|passa|passar|bote|botar)\\b (?:\\w+ ){0,3}?${ALVOS_DE_CUIDADO}`,
  ),
  p(
    "orientacao_clinica",
    "evitar_habito",
    // "Melhor nao mexer no seu horario" passa porque mexer e tocar sairam
    // da lista. "Sem" nao junta com esforco, e "longe de" um lugar so com
    // prazo ("longe da praia uns dias"; "fica longe da praia" e endereco).
    `\\b(?:evite|evitar|evita|nao (?:pode|deve|e bom|e recomendado|e indicado)|melhor nao|proibido|nada de|esquece (?:o|a|os|as)|segura a onda|corta (?:o|a)|corte (?:o|a)|nao (?:pega|mexe|toca))\\b (?:\\w+ ){0,2}?${HABITOS}|\\bsem\\b (?:\\w+ ){0,2}?${HABITOS_DEPOIS_DE_SEM}|\\blonge d[ao]s? (?:\\w+ )?${HABITOS_DEPOIS_DE_LONGE}|\\blonge d[ao]s? (?:praia|piscina|mar|sauna|academia) (?:por |uns |umas |durante |nos proximos |nas proximas )(?:\\d+ |uns |umas |alguns |algumas |uma |um |dois |duas |tres )?(?:dias?|semanas?|mes|meses)\\b`,
  ),
  p(
    "orientacao_clinica",
    "nao_faca_no_corpo",
    "\\bnao (?:deita|abaixa|malha|treina|molha|coca|esfrega|aperta|massageia|espreme)\\b",
  ),
  p(
    "orientacao_clinica",
    "habito_so_depois",
    `\\b${HABITOS}\\b(?: \\w+){0,2} so (?:depois|apos)(?: de| das?)? \\d+ ?(?:h|hs|horas?|dias?)\\b`,
  ),
  p(
    "orientacao_clinica",
    "cuidado_citado",
    "\\b(?:gelo|gelinho|compress(?:a|as|inha|inhas)|bolsa de gelo|bolsinha de gelo)\\b",
  ),
  p(
    "orientacao_clinica",
    "liberar_normalmente",
    // Sem "passar" ("pode passar tranquila na recepcao") e "dormir" so com
    // "normalmente" ("pode dormir tranquila, ja esta confirmado").
    "\\bpode (?:\\w+ )?(?:lavar|molhar|maquiar|deitar|malhar|treinar|tomar banho|pegar sol|ir a praia|beber|nadar)\\b (?:normalmente|tranquil\\w*|sem problema)|\\bpode (?:\\w+ )?dormir normalmente\\b",
  ),
  p(
    "orientacao_clinica",
    "suspender_uso",
    "\\b(?:suspend|interromp|pare de tomar|parar de tomar|pare o uso|parar o uso|deixe de tomar|deixar de tomar|continue tomando|continuar tomando|mantenha o uso|manter o uso)",
  ),
  p(
    "orientacao_clinica",
    "jejum",
    "\\bjejum\\b|\\bayuno\\b|\\bfasting\\b|\\bestomago vazio\\b",
  ),
  p("orientacao_clinica", "repouso", "\\brepous|\\breposo\\b"),
  p(
    "orientacao_clinica",
    "posicao_de_dormir",
    "\\b(?:durma|dormir|dorme) (?:de barriga|de lado|de ladinho|de costas|sentad|com a cabeca|com travesseiro)|\\bde ladinho\\b",
  ),
  p(
    "orientacao_clinica",
    "beber_liquido",
    "\\b(?:beba|beber|tome|tomar|ingira|ingerir) (?:bastante |muita |mais |pelo menos |\\d+ |um |uma |uns )?(?:agua|liquido|cha\\b|soro|suco|litros)",
  ),
  p(
    "orientacao_clinica",
    "mexer_na_regiao",
    `\\b(?:molhe|molhar|molha|lave|lavar|lava|coce|cocar|coca|mexa|mexer|mexe|toque|tocar|toca|aperte|apertar|aperta|esprema|espremer|espreme|esfregue|esfregar|esfrega|massageie|massagear|massageia|exponha|expor|expoe) (?:a |o |na |no |nessa |nesse |essa |esse |sua |seu )?${REGIOES}`,
  ),
  p(
    "orientacao_clinica",
    "cuidar_da_pele",
    // So o imperativo: "a hidratacao da pele custa" e "o peeling hidrata a
    // pele" descrevem procedimento do catalogo.
    `\\b(?:hidrate|hidratem|esfolie|esfoliem)\\b (?:\\w+ ){0,2}?${REGIOES}|(?:^|[.!?;]\\s*)(?:hidrata|esfolia)\\b (?:\\w+ ){0,2}?${REGIOES}`,
  ),
  p(
    "orientacao_clinica",
    "recomendacao_de_cuidado",
    "\\b(?:recomend|aconselh|orient|indic|sugir|sugerim|prescrev|o ideal e|o melhor e|o mais indicado|e importante|e fundamental|e essencial|e bom|seria bom|e recomendado|e aconselhavel|voce deve|voce precisa|tem que|precisa)\\w*\\b.{0,40}\\b(?:tomar|usar|aplicar|evitar|beber|comer|dormir|repous|descans|lavar|molhar|hidratar|massagear|compressa|gelo|sol\\b|exercicio|remedi|pomad|creme|protetor|jejum|suspend|parar de|cuidado)",
  ),
  p(
    "orientacao_clinica",
    "cuidados_do_procedimento",
    "\\bcuidados? (?:pos|pre|antes|depois|apos|com a pele|com o local|com a regiao|especiais)",
  ),
  // en
  p(
    "orientacao_clinica",
    "orientacao_en",
    "\\b(?:apply|use|put|place)\\b (?:\\w+ ){0,2}?(?:ice|cream|ointment|compress|sunscreen|lotion|gel)|\\bavoid (?:the )?(?:sun|exercise|alcohol|makeup|heat|sauna)|\\b(?:i recommend|we recommend|you should|you must|make sure to|stop taking)\\b|\\bdrink (?:plenty of |lots of )?water\\b",
  ),
  // es
  p(
    "orientacao_clinica",
    "orientacao_es",
    "\\b(?:aplique|aplicar|ponga|poner)\\b (?:\\w+ ){0,2}?(?:hielo|crema|pomada|compresa|protector)|\\bevite (?:el )?(?:sol|ejercicio|alcohol|maquillaje)|\\b(?:le recomiendo|te recomiendo|recomiendo|deberia)\\b",
  ),

  // ---- medicamento ---------------------------------------------------------
  p("medicamento", "remedio_citado", `\\b${alternativas(MEDICAMENTOS)}`),
  p("medicamento", "classe_de_remedio", `\\b${alternativas(REMEDIO_GENERICO)}`),
  p(
    "medicamento",
    "liberar_tomar",
    "\\b(?:pode|podera|deve|devera|precisa|tem que|e so|basta)\\b (?:\\w+ )?(?:tomar|ingerir)\\b",
  ),
  p(
    "medicamento",
    "tomar_en_es",
    "\\b(?:take|taking)\\b (?:\\w+ ){0,2}?(?:ibuprofen|paracetamol|aspirin|pill|tablet|medicine|medication|antibiotic)|\\bpuede tomar\\b|\\b(?:tome|tomar) (?:un|una|el|la)\\b",
  ),

  // ---- dosagem -------------------------------------------------------------
  p(
    "dosagem",
    "quantidade_com_unidade",
    // "Unidades" so com o produto ("50 unidades de toxina") ou na regiao
    // (unidades_na_regiao): "temos 2 unidades" sao filiais.
    "\\b\\d[\\d.,o]*\\s?(?:m\\W{0,2}g|mcg|ug|m\\W{0,2}l|g|u\\W{0,2}i|ui|u|un|gotas?|gotinhas?|pingos?|comprimidos?|capsulas?|cps?|caps|saches?|colher(?:es)?|colheradas?|doses?|ampolas?|jatos?|borrifadas?|puffs?|miligramas?|mililitros?|microgramas?|gramas?|seringas?|frascos?)\\b|\\b\\d[\\d.,o]*\\s?unidades? (?:de |do |da )?(?:botox|toxina|dysport|xeomin|botulift|produto|acido|preenchimento)",
  ),
  p(
    "dosagem",
    "quantidade_por_extenso",
    "\\b(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|meio|meia|vinte|trinta|quarenta|cinquenta|cem|duzentos|quinhentos|mil)\\b (?:\\w+ )?(?:gotas?|gotinhas?|pingos?|comprimidos?|capsulas?|colher(?:es)?|colheradas?|doses?|ampolas?|miligramas?|mililitros?|mg|ml|saches?|jatos?|borrifadas?)\\b|\\bquinhentinh|\\bmeio grama\\b",
  ),
  p(
    "dosagem",
    "unidades_na_regiao",
    "\\b(?:\\d+|uma?|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem)\\b (?:e \\w+ )?unidades? (?:\\w+ )?(?:na|no|nas|nos|em cada|de cada|por) (?:testa|glabela|lado|olhos?|regiao|area|ponto|rosto|face|labios?|pes de galinha|axilas?|bochechas?|queixo|pescoco|sobrancelhas?|pontos?)\\b",
  ),
  p(
    "dosagem",
    "manha_e_noite",
    // So com verbo de uso na frente: "uma (vaga) de manha e outra a noite"
    // e agenda.
    "\\b(?:tome|toma|tomar|tomando|passe|passa|passar|aplique|aplica|aplicar|use|usa|usar|pingue|pinga|pingar|bote|bota|coloque|coloca)\\b (?:\\w+ ){0,3}?(?:uma|um|duas|dois|\\d+|meia|meio) (?:de|pela) manha e (?:outr[ao]|uma|um|duas|dois|\\d+|mais uma) (?:a|de|pela) noite\\b",
  ),
  p(
    "dosagem",
    "frequencia",
    "\\b(\\d{1,2}) ?/ ?\\1 ?(?:h|hs|horas?)\\b|\\b\\d+ ?x ?/ ?dia\\b|\\bde \\d+ em \\d+ ?(?:h|hs|horas?)\\b|\\bde (?:duas|quatro|seis|oito|doze) em (?:duas|quatro|seis|oito|doze) horas\\b|\\ba cada \\d+ ?(?:h|hs|horas?)\\b|\\ba cada (?:duas|quatro|seis|oito|doze|vinte e quatro) horas\\b|\\b\\d+ ?(?:x|vezes) (?:ao|por|no) dia\\b|\\b(?:uma|duas|tres|quatro) vezes (?:ao|por|no) dia\\b",
  ),
  p(
    "dosagem",
    "horario_de_uso",
    "\\b(?:antes|depois|apos|durante|com) (?:das|as|de|da|do) refeic|\\bem jejum\\b|\\bao deitar\\b|\\bdose (?:unica|diaria|dupla)\\b|\\b(?:dosagem|posologia)\\b",
  ),
  // en, es
  p(
    "dosagem",
    "frequencia_en_es",
    "\\b(?:twice|once|three times) a day\\b|\\bevery \\d+ hours\\b|\\bcada \\d+ horas\\b|\\b(?:una|dos|tres) veces al dia\\b",
  ),

  // ---- promessa de resultado -----------------------------------------------
  p("promessa_resultado", "garantia", "\\bgarant|\\bguarante|\\bgarantiz"),
  p("promessa_resultado", "cem_por_cento", "\\b100 ?%|\\bcem por cento\\b"),
  p(
    "promessa_resultado",
    "seguranca",
    "\\b(?:totalmente|completamente|absolutamente|super|muito|bem|extremamente) (?:segur|eficaz|eficiente|natural|indolor)|\\b(?:e|sao|eh) (?:um |uma )?(?:procedimento |tratamento |metodo |produto )?(?:bem |muito |super |totalmente |100% )?segur[oa]s?\\b(?! saude)|\\bsegur[oa]s? e eficaz|\\bsegur\\w*issim|\\b(?:nao tem|nao ha|sem|nenhum|zero) perigo\\b(?! de (?:perder|ficar sem|faltar|esquecer|atrasar|cancel))",
  ),
  p(
    "promessa_resultado",
    "definitivo",
    "\\bdefinitiv[oa]s?\\b|\\bpermanente(?:s|mente)?\\b|\\bpara sempre\\b",
  ),
  p(
    "promessa_resultado",
    "acaba_de_vez",
    "\\b(?:acaba|acabar|elimina|eliminar|resolve|resolver|some|sumir|tira|tirar|remove|remover|livre)\\b.{0,30}\\b(?:de vez|para sempre|definitivamente|totalmente|completamente)",
  ),
  p(
    "promessa_resultado",
    "sem_dor_sem_risco",
    "\\bsem (?:nenhuma |nenhum |qualquer )?(?:dor|dorzinha|riscos?(?! de (?:perder|ficar sem|faltar|esquecer|atrasar|cancel|cobranc|multa))|efeitos?|colateral|colaterais|contraindicac\\w*|cicatriz|cicatrizes|marcas?|inchaco|hematomas?|roxos?|recuperacao|downtime|sofrimento|complicac\\w*|reac(?:ao|oes)|adverso)\\b",
  ),
  p(
    "promessa_resultado",
    "nenhum_risco",
    // Estreitado em 05/10/2026: sem "da certo" ("com certeza vai dar certo,
    // te espero"), sem "nenhuma chance" ("nenhuma chance de encaixe") e
    // "nao sente" so com o que se sente ("nao se sente confortavel com o
    // horario" e recepcao). Risco de perder a vaga nao e promessa.
    "\\b(?:nenhum|nenhuma|zero|nao tem|nao ha|nao oferece|nao apresenta|nao causa|nao deixa|isento de)\\b (?:\\w+ )?(?:riscos?(?! de (?:perder|ficar sem|faltar|esquecer|atrasar|cancel|cobranc|multa))|efeito colateral|efeitos colaterais|contraindicac\\w*|dor|cicatriz|marcas?|complicac\\w*)\\b|\\brisco (?:nenhum|zero)\\b|\\bindolor\\b|\\bnao doi\\b|\\bnao vai doer\\b|\\bquase nao (?:se )?sente\\b|\\bnao (?:se )?sente (?:nada|dor|quase nada|nenhuma dor|a picada|a agulha)\\b|\\bnem (?:se )?sente\\b|\\bpicadinha|\\b(?:ninguem|nunca) (?:se )?arrepend|\\bnao vai se arrepender|\\b(?:pode confiar que|confia que|confie que|garanto que) (?:vai )?da(?:r)? certo\\b|\\b(?:zero|nenhuma|sem) chance de (?:dar errado|nao dar certo|nao funcionar|falhar|ficar ruim|complicac)|\\brisco (?:muito |super |bem )?(?:baix\\w*|minim\\w*|praticamente)",
  ),
  p(
    "promessa_resultado",
    "milagre",
    "\\bmilagr|\\binfalivel|\\bnunca (?:falha|falhou|deu errado)|\\bnao falha\\b|\\bfunciona (?:com todo mundo|para todo mundo|em todo mundo|em todos os casos|em qualquer pessoa|para qualquer pessoa|de verdade|100%)",
  ),
  p(
    "promessa_resultado",
    "resultado_prometido",
    // Duracao so como piso ("dura no minimo 6 meses"): "o pedido medico dura
    // ate 6 meses" e validade de documento.
    "\\bresultados? (?:e |sao |fica |ficam |sera |serao |vai ser |ja )?(?:imediat|garantid|cert[oa]s?\\b|certeir|perfeit|incrive|impressionante|definitiv|permanente|visive|natural garantid|duradour|surpreendente|maravilhos|espetacular|rapid|(?:ja )?na primeira|top\\b|show\\b)|\\b(?:efeito lifting|lifting (?:na hora|instantaneo|imediato))|\\bdura(?:m|r)? (?:no minimo|pelo menos|mais de) (?:\\d+|um|uma|dois|tres|seis|doze) (?:meses|mes|anos?)\\b|\\bdura(?:m|r)? (?:uns |umas |cerca de |em media )?(?:\\d+|um|uma|dois|tres|quatro|seis|oito|doze) (?:meses|mes|anos?) (?:no minimo|pelo menos|garantid)",
  ),
  p(
    "promessa_resultado",
    "voce_vai_ficar",
    // Sem "fica perfeito e" ("fica perfeito e ja esta confirmado" e agenda).
    "\\b(?:voce|vc|a senhora|o senhor|sua pele|seu rosto|sua aparencia|seu sorriso|seus labios|sua barriga|seu corpo|o resultado|ela|ele)\\b (?:\\w+ )?(?:vai|ira)\\b (?:\\w+ )?(?:ficar|sair|parecer|estar) (?:\\w+ )?(?:lind|bel[oa]|perfeit|maravilhos|jovem|mais jovem|mais nov|renovad|rejuvenescid|incrivel|otim|satisfeit|feliz|realizad|outra pessoa|diferente|sem ruga|sem mancha|magr|natural)|\\b(?:fica|ficam|ficou|ficaram|vai ficar|vao ficar|ficara) (?:\\w+ ){0,2}?(?:lind[oa]s?|maravilhos[oa]s?|naturais|natural|rejuvenescid\\w*)\\b|\\b(?:sai|sair|saira|vai sair) (?:\\w+ ){0,2}?outr[ao] (?:mulher|pessoa|homem)\\b|\\b(?:tchau|adeus),? (?:as |aos )?(?:ruga|mancha|gordur|flacid|celulit|papada|olheira)",
  ),
  p(
    "promessa_resultado",
    "vai_amar",
    "\\bvai (?:amar|adorar|se apaixonar|se surpreender|se encantar|ficar encantad|rejuvenescer|emagrecer|notar a diferenca|notar diferenca|ver o resultado|ver resultado|ver a diferenca|ver diferenca|ter resultado|ter o resultado|se olhar e nao acreditar)",
  ),
  p(
    "promessa_resultado",
    "rejuvenescer",
    "\\brejuvenesc|\\b\\d+ anos (?:mais jovem|mais nova|mais novo|a menos)|\\banos mais jovem|\\b(?:tira|tirar|tirou|tiram)\\b (?:\\w+ ){0,2}?anos\\b",
  ),
  p(
    "promessa_resultado",
    "todos_satisfeitos",
    "\\b(?:sempre|todos|todas|todo mundo|100% d[oa]s)\\b (?:\\w+ ){0,2}?(?:ficam|saem|ficaram|sairam|amam|adoram|aprovam|gostam|voltam) (?:\\w+ )?(?:satisfeit|feliz|felizes|content|encantad|realizad|apaixonad)|\\bsatisfacao (?:garantida|total|de 100)|\\bdinheiro de volta\\b|\\b(?:todo mundo|todos|todas|ninguem)\\b (?:que (?:fez|fizeram|faz|experimentou|experimentaram) )?(?:amou|amaram|adorou|adoraram|aprovou|aprovaram|gostou|gostaram|reclamou|reclamaram)\\b",
  ),
  p(
    "promessa_resultado",
    "superlativo",
    // "E o/a mais" so com adjetivo de autopromocao: "o Dr. Carlos e o mais
    // antigo da equipe" e informacao.
    "\\b(?:dr|dra|doutor|doutora)\\.? \\w+(?: \\w+)? (?:e|eh) (?:o|a) (?:melhor|mais (?:procurad|requisitad|famos|conhecid|indicad|experiente|competente|qualificad|renomad|premiad|recomendad|preparad|capacitad|habilidos|top\\b))|\\b(?:e|sao|somos) (?:o|a|os|as) melhor(?:es)? (?:medic|profission|dermatolog|especialista|clinica|doutor|dra|dr\\b|da cidade|do brasil|do estado|da regiao|do mundo|que existe|que ha)|\\bnumero (?:1|um) (?:em|no brasil|do brasil|da cidade|do estado|da regiao)\\b|\\b(?:somos|e|sao) (?:uma? )?referencia\\b|\\bunic[oa] (?:clinica|medic|profissional) (?:que|da|do)|\\b(?:o|a|os|as) melhor(?:es)? (?:clinica|medic|profission|dermatolog|especialista)\\w* (?:da|do|de) (?:cidade|brasil|estado|regiao|mundo|fortaleza|nordeste)|\\bninguem vai (?:perceber|notar|saber)|\\b(?:o|a|os|as) mais (?:procurad|requisitad|famos|conhecid|indicad)\\w* (?:da cidade|do brasil|da regiao|do estado|do nordeste|de fortaleza)",
  ),
  p(
    "promessa_resultado",
    "cura",
    "\\b(?:cura|curar|curamos|curou|cure|curam|curado|curada)\\b|\\btratamento definitivo",
  ),
  p(
    "promessa_resultado",
    "emagrecimento",
    "\\b(?:emagrec|perder|perde|elimina|eliminar|secar|seca)\\b (?:\\w+ ){0,2}?\\d+ ?(?:kg|quilos|kilos|cm|centimetros|medidas|numeros|manequins)|\\b(?:elimina|acaba com|derrete|queima) (?:a |as |toda |todas )?gordura",
  ),
  // en
  p(
    "promessa_resultado",
    "promessa_en",
    "\\b(?:100% safe|risk[- ]free|no risk|painless|pain[- ]free|no side effects|permanent|miracle|you(?:'ll| will) (?:look|love|be)|best results|years younger)",
  ),
  // es
  p(
    "promessa_resultado",
    "promessa_es",
    "\\b(?:sin dolor|sin riesgo|sin efectos secundarios|va a quedar|quedara perfect|anos mas joven)",
  ),

  // ---- oferta casada -------------------------------------------------------
  p(
    "oferta_casada",
    "na_compra",
    "\\bna compra (?:do|da|de|dos|das)\\b|\\bcomprando (?:o|a|os|as|um|uma)\\b",
  ),
  p(
    "oferta_casada",
    "leve_pague",
    "\\bleve \\d+ (?:e )?pague \\d+|\\bleve (?:dois|duas|tres|quatro) (?:e )?pague|\\bpague \\d+ (?:e )?leve|\\b(?:compre|feche|contrate|leve|agende|marque|faca|pague) (?:\\w+ ){0,3}?(?:e )?(?:ganhe|ganha)\\b",
  ),
  p(
    "oferta_casada",
    "gratis_ou_brinde",
    // "Sem custo" para remarcar ou cancelar e "cortesia" do estacionamento
    // saem antes, como expressao permitida (NEUTRALIZACOES_DE_SAIDA).
    // Pacote, combo, promocao, gratis e brinde continuam bloqueando.
    "\\b(?:gratis|gratuit|de graca|sem custo|custo zero|sem cobranca|cortesia|brinde|de presente|bonus|bonificac|combo|pacote|kit (?:de|com)|promoc|promocional|oferta|black friday|cashback|voucher|vale[- ]presente)",
  ),
  p(
    "oferta_casada",
    "obrigatorio_fechar",
    "\\b(?:obrigatori|exigid|so (?:e possivel|da|podemos)|precisa|tem que|e necessario|necessariamente)\\w*\\b.{0,25}\\b(?:fechar|contratar|comprar|adquirir|pagar) (?:\\w+ ){0,2}?(?:pacote|combo|kit|sessoes|plano|tambem|junto)",
  ),
  p(
    "oferta_casada",
    "condicionado",
    // "So se avisar com 24h" e regra de remarcacao, nao condicao de compra
    // (politica da fase controlada, 05/10/2026).
    "\\b(?:so|somente|apenas|unicamente) se\\b(?! (?:voce |vc |a senhora |o senhor )?(?:avisar|avisa|avisarem|avisou|cancelar|desmarcar|remarcar|reagendar)\\b)|\\bse (?:voce )?(?:fechar|comprar|contratar|levar) (?:\\w+ ){0,3}?(?:junto|tambem)\\b|\\b(?:so|somente|apenas|unicamente)\\b (?:com|na|no|para quem|pra quem|quem)\\b (?:\\w+ ){0,3}?(?:fech|compr|contrat|pacote|combo|junto|tambem)|\\b(?:valor|preco|desconto|condicao|beneficio|vantagem)\\b (?:\\w+ ){0,3}?(?:so|somente|apenas) (?:para quem|pra quem|quem)\\b",
  ),
  p(
    "oferta_casada",
    "fechando_ganha",
    "\\b(?:fechando|levando|comprando|contratando|agendando|marcando|fazendo)\\b.{0,40}\\b(?:ganha|ganhe|ganham|de brinde|de graca|gratis|de cortesia|sai mais barat|fica mais barat|com desconto|de bonus|leva (?:junto|tambem|de))",
  ),
  p(
    "oferta_casada",
    "por_conta_da_casa",
    // Estreitado em 05/10/2026: "na faixa" so saindo de graca ("sai na
    // faixa"; "na faixa etaria" e "na faixa de R$" nao), "para quem faz" so
    // com preco ou condicao ("para quem faz botox, o retorno e em 15 dias" e
    // agenda), "desde que" so com fechar, levar ou agendar junto ("desde que
    // os dois cheguem as 10h" e agenda), "presente" so ganho ou levado ("a
    // Dra. Ana e presente") e "sem pagar" sem "faz" e "fica" ("o retorno
    // voce faz sem pagar" e regra do convenio).
    "\\bpor nossa conta\\b|\\bpor conta (?:da casa|da clinica|nossa)\\b|\\b(?:leva|levam|ganha|ganham|sai)\\b.{0,30}\\bsem pagar\\b|\\b(?:sai|fica|vem)(?: \\w+)? zerad|\\bmimo\\b|\\bpresente (?:nosso|nossa|da casa|da clinica)\\b|\\b(?:ganha|ganhe|leva|leve|ganhar|levar) (?:um |de )?presente\\b|\\bdesde que (?:\\w+ ){0,3}?(?:fech|compr|contrat|lev|agend|marq|fac|faz)\\w* (?:\\w+ ){0,3}?junto\\b|\\bdesde que (?:\\w+ ){0,3}?(?:fech|compr|contrat|lev)\\w* (?:\\w+ ){0,3}?tambem\\b|\\b(?:sai|sair|fica|vem|leva)(?: \\w+)? na faixa\\b(?! (?:de|etaria|dos|das)\\b)|\\b(?:pra|para) quem (?:ja )?(?:fecha|fechar|contrata|contratar|compra|comprar)\\b|\\b(?:r\\$ ?[\\d.,]+|valor|preco|desconto|condicao)\\b.{0,30}\\b(?:pra|para) quem (?:ja )?(?:faz|fizer|leva|levar)\\b|\\b(?:so|somente|apenas) (?:sai|fica|custa|e)\\b.{0,40}\\bjunto\\b",
  ),
  p(
    "oferta_casada",
    "preco_especial",
    // "Pagar metade no dia da avaliacao e metade no procedimento" e forma de
    // pagamento (politica da fase controlada, 05/10/2026); "paga metade" e
    // "paga so metade" continuam sendo preco especial.
    "\\bpaga(?:r)? (?:so|apenas|somente) (?:a )?metade\\b|\\bpaga(?:r)? (?:a )?metade\\b(?! (?:\\w+ ){0,6}?e (?:a )?(?:outra )?metade\\b)|\\b(?:metade do preco|pela metade|meio preco|preco especial|condicao especial|valor especial|preco promocional|valor promocional)|\\bsegunda (?:sessao|aplicacao|area) (?:sai|e) (?:de graca|gratis|pela metade|com desconto|mais barat|por)",
  ),
  // en, es
  p(
    "oferta_casada",
    "oferta_en_es",
    "\\b(?:buy one|get one free|free\\b|bundle|package deal|special offer|promo\\b)|\\b(?:paquete|promocion|regalo)\\b",
  ),

  // ---- antes e depois ------------------------------------------------------
  p(
    "antes_depois",
    "antes_e_depois",
    "\\bantes ?(?:e|x|ou|/|-|&|y) ?(?:o )?depois\\b|\\bbefore ?(?:and |& |/ ?)?after\\b|\\bcomparativo|\\bdepoimentos?\\b",
  ),
  p(
    "antes_depois",
    "fotos_de_pacientes",
    // Estreitado em 05/10/2026: "fot" e "vide" eram prefixo e pegavam
    // fotodepilacao, fototerapia e videochamada; "registro do seu caso", "foto
    // do documento antes da consulta" e "foto do resultado do exame" sao
    // recepcao. Antes e depois so colado na foto ("foto do antes").
    "\\b(?:fotos?|fotinh[ao]s?|fotografias?|imagem|imagens|videos?|videozinhos?|prints?)\\b (?:\\w+ ){0,2}?(?:de |das |dos |da |do )?(?:pacientes|clientes|resultados|casos|outr[oa]s? pessoas|quem (?:ja )?(?:fez|fizeram|faz|fazem|fizer))\\b|\\b(?:fotos?|fotinhas?|imagens?|videos?|prints?) (?:de|do|da) (?:antes|depois)\\b|\\b(?:fotos?|fotinhas?|imagens?|videos?) (?:de|da|do) (?:uma|um|outra|outro|nossa|nosso) (?:paciente|cliente)\\b",
  ),
  p(
    "antes_depois",
    "mandar_fotos",
    // So quem oferece ("te mando", "posso enviar"): "pode mandar a foto do
    // documento?" pede ao paciente. "Resultado" no singular e o do exame.
    "\\b(?<!\\bme )(?:mando|mandamos|envio|enviamos|te mando|te envio|posso mandar|posso enviar|posso te mandar|posso te enviar|podemos mandar|podemos enviar|vou mandar|vou enviar|vou te mandar|vou te enviar|segue|seguem|compartilho|mostro|te mostro|posso mostrar|posso te mostrar|vou mostrar|vou te mostrar)\\b (?:\\w+ ){0,3}?(?:fotos?|fotinhas?|imagem|imagens|videos?|videozinhos?|prints?|resultados|comparativo)",
  ),
  p(
    "antes_depois",
    "veja_como_ficou",
    // "Vou ver como ficou a agenda" e "confira antes se trouxe o documento"
    // sao recepcao: sai o "ver" solto e o "antes".
    "\\b(?:mostrar|mostro|te mostro|mostrando|quer ver|pode ver|pra ver|para ver) como (?:ficou|ficaram)\\b|\\b(?:veja|olha|olhe|confira|confere|repare|imagina|imagine) (?:so |como |o |os |a |as |esse |esses |essa |essas |este |estes |nosso |nossos |nossa |nossas )*(?:como ficou|como ficaram|resultado|caso|casos|transformac|paciente|cliente|depoimento)|\\bespiad\\w* (?:\\w+ ){0,2}?(?:resultado|antes|perfil|fotos?\\b|caso|paciente|cliente|insta\\w*)",
  ),
  p(
    "antes_depois",
    "caso_real",
    "\\b(?:caso|casos|resultado|resultados|historia|historias|depoimento|depoimentos) (?:real|reais|de sucesso|verdadeir)|\\b(?:nossas|nossos) (?:pacientes|clientes) (?:ficaram|ficou|amaram|adoraram|aprovaram)|\\btransformac",
  ),
  p(
    "antes_depois",
    "rede_social_resultado",
    // "Caso" e "perfil" soltos sao recepcao ("nosso Instagram, caso queira";
    // "pacientes com o perfil indicado").
    "\\b(?:instagram|insta|tiktok|youtube|facebook|nosso perfil|no perfil)\\b.{0,30}\\b(?:resultado|antes\\b|casos\\b|fotos?\\b|videos?\\b|clientes|pacientes)|\\b(?:clientes|pacientes)\\b.{0,30}\\b(?:instagram|insta|tiktok)\\b",
  ),

  // ---- preco nao verificado (o que nao e numero) ---------------------------
  p("preco_nao_verificado", "percentual", "%|\\bpor cento\\b|\\bpercent\\b"),
  p(
    "preco_nao_verificado",
    "desconto_ou_parcela",
    // Parcelamento simples ("em ate 10x sem juros", "10x de R$ 150") e
    // forma de pagamento sairam em 05/10/2026 (politica da fase controlada):
    // o valor da parcela e lido como preco e tem de estar no turno
    // (valoresEmDinheiro). Desconto, abatimento e negociacao continuam.
    "\\bdesconto|\\babatimento|\\bmais barat|\\bmenor preco\\b|\\bpreco (?:menor|melhor)\\b|\\bvalor menor\\b|\\bnegoci|\\bcupom|\\b(?:discount|descuento)\\b|\\bconsigo (?:menos|baixar|um desconto)\\b|\\bconsigo (?:fazer|deixar) (?:por|a|em) (?:r\\$ ?)?\\d|\\bcada lado\\b|\\bcondicao (?:boa|otima|melhor|diferenciad\\w*|imperdivel|unica)\\b",
  ),

  // ---- formato invalido (o que nao e estrutural) ---------------------------
  // A palavra "link" sozinha saiu em 05/10/2026 ("o link da videochamada
  // chega 10 min antes", "te enviei o link de pagamento"): o que conta e a
  // URL escrita, que continua bloqueando.
  p(
    "formato_invalido",
    "url",
    "https?|:\\/\\/|\\bwww\\b|\\b[a-z0-9-]{2,}\\.(?:com|net|org|br|io|ly|me|gl|co|app|link|site|info|xyz|online|store|shop|page|to|cc|ai|gg|tk|ml)(?:\\.[a-z]{2})?\\b|\\b(?:ponto|dot) ?(?:com|br|net|org)\\b|\\bbit ?\\. ?ly\\b|\\bwa ?\\. ?me\\b|\\bt ?\\. ?me\\b|\\bencurtador",
  ),
  p(
    "formato_invalido",
    "arroba",
    "\\barroba\\b|(?<![a-z0-9._%+-])@[a-z0-9_.]{2,}",
  ),
  p("formato_invalido", "marcacao", "[<>{}\\[\\]\\\\`]|#{2,}"),
  p(
    "formato_invalido",
    "contato_fora_da_conversa",
    // A conversa ja e no WhatsApp: "me chama no WhatsApp" e "nosso WhatsApp
    // e este numero" ficam dentro dela. "O perfil e" sem dono e outra coisa.
    "\\bme (?:chama|chame|liga|ligue|segue|siga|adiciona|add)\\b (?:no|na|pelo|pela) (?:insta\\w*|tiktok|face\\w*|numero|telefone|celular|fixo|\\d|zero|um|dois|tres|quatro|cinco|seis|sete|oito|nove|onze|doze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa)|\\b(?:meu|nosso) (?:insta\\w*|tiktok|perfil) (?:e|eh|:)",
  ),
  p(
    "formato_invalido",
    "identificador_de_codigo",
    "\\b[a-z]+_[a-z0-9_]+\\b|\\b[0-9a-f]{8}-[0-9a-f]{4}-|\\b(?=[a-z0-9]*\\d)(?=[a-z0-9]*[a-z])[a-z0-9]{16,}\\b",
  ),
  p(
    "formato_invalido",
    "fala_de_bastidor",
    // "Sistema" e "programacao" soltos sao recepcao ("vou verificar no
    // sistema", "a programacao do feriado"); "aprovado:" e o convenio
    // ("seu convenio foi aprovado: pode vir"). Fica o rotulo de veredicto.
    "\\b(?:instruc(?:ao|oes)|instruid[oa]|prompt|system|anthropic|claude|openai|chatgpt|gpt|llm|modelo de linguagem|language model|tool_use|function_call|json|nonce|token|configurad[oa] para|fui programad[oa]|minha programacao|minhas regras|regras internas|diretrizes|avaliador\\w*|avaliacao interna|verificador\\w*|revisor\\w*|rascunho|veredicto|considere aprovad\\w*|pode aprovar|conformidade|cfm)\\b|\\b(?:prompt|instruc\\w*|regras|mensagem|comando)s? d[oe] sistema\\b|\\bmarque como (?:aprovad|conforme|ok|valid)|\\baprovad[oa] ?=|\\b(?:status|parecer|decisao|verificacao|moderacao|validacao|revisao)\\s*[:=]\\s*(?:aprovad|conforme|liberad)|\\bconfianca\\s*[:=]?\\s*(?:alta|media)\\b",
  ),
];

// ---------------------------------------------------------------------------
// Saida: expressoes permitidas (trocadas antes dos padroes)
// ---------------------------------------------------------------------------

/** O que a recepcao "garante" sem prometer resultado: lugar na agenda. */
const OBJETO_DE_AGENDA =
  "(?:vagas?|horarios?|agendas?|lugar|lugares|reservas?|encaixes?|datas?|agendamentos?|consultas?)";
const DETERMINANTE =
  "(?:a|o|as|os|sua|seu|suas|seus|esse|essa|esses|essas|este|esta|um|uma)";
const NAO_E_RESULTADO = "(?:resultado|efeito|melhora|sucesso)";
/** Nada de resultado no resto da frase ("sua vaga, e o resultado tambem"). */
const SEM_RESULTADO_NA_FRASE = `(?![^.!?]{0,40}\\b${NAO_E_RESULTADO})`;
const LUGAR_DO_CARRO = "(?:estacionamento|ticket|valet|manobrista|garagem)";
const TEMPO_DE_CORTESIA = "\\d+ ?(?:h|hs|horas?|min|minutos) de ";

/**
 * Expressoes de recepcao que tem uma palavra dos padroes mas nao sao
 * violacao (revisao de precisao do conjunto cego 1, 05/10/2026, e politica
 * da fase controlada). Trocadas no texto normalizado ANTES dos padroes, do
 * lexico compacto e do aproximado, em todas as visoes de frase. Cada troca e
 * estreita, com o objeto colado na palavra: "garantir sua vaga" sai, e
 * "garantir resultado" ou "garanto o horario e o resultado" continuam.
 */
export const NEUTRALIZACOES_DE_SAIDA: readonly Neutralizacao[] = [
  {
    // "Pra garantir sua vaga", "nao consigo garantir o mesmo horario".
    nome: "garantir_vaga",
    fonte: `\\bgarant\\w*(?= (?:te |lhe )?(?:${DETERMINANTE} ){0,2}(?:mesm[oa]s? |propri[oa]s? )?${OBJETO_DE_AGENDA}\\b${SEM_RESULTADO_NA_FRASE})`,
    troca: "reservar",
  },
  {
    // "Sua vaga esta garantida", "horario garantido".
    nome: "vaga_garantida",
    fonte: `(?<=\\b${OBJETO_DE_AGENDA} (?:(?!${NAO_E_RESULTADO})\\w+ ){0,2})garantid(?=[oa]s?\\b${SEM_RESULTADO_NA_FRASE})`,
    troca: "reservad",
  },
  {
    // "Os horarios de sabado ja estao 100% preenchidos" (nem promessa nem
    // percentual de preco).
    nome: "agenda_cem_por_cento",
    fonte:
      "\\b(?:100 ?%|cem por cento) (?=(?:\\w+ )?(?:preenchid|lotad|ocupad|reservad|esgotad|agendad|tomad|cheio\\b|cheia\\b|completo\\b|completa\\b))",
    troca: "",
  },
  {
    // "30% de sinal", "sinal de 50%", "entrada de 30%", "taxa de 50%":
    // percentual de pagamento antecipado ou de taxa, nao de desconto
    // (politica da fase controlada). "10% de desconto na entrada" continua.
    nome: "percentual_do_sinal",
    fonte:
      "\\b\\d{1,3} ?%(?= (?:do valor |do total |do procedimento )?(?:de |como |pra |para |no |na )?(?:sinal|entrada|adiantamento|reserva)\\b)|(?<=\\b(?:sinal|entrada|adiantamento|taxa|multa) (?:e |de |e de |sera de |fica em |fica de )?)\\d{1,3} ?%",
    troca: "uma parte",
  },
  {
    // "50% no agendamento e 50% no dia", "30% agora e o restante no dia":
    // divisao do pagamento, como "metade e metade". So 50 e 50 ou "o
    // restante": "10% no pix e 5% no cartao" e desconto e continua.
    nome: "percentual_da_divisao",
    fonte:
      "\\b50 ?%(?= (?:\\w+ ){0,4}?e (?:os outros )?50 ?%)|(?<=\\b50 ?% (?:\\w+ ){0,4}?e (?:os outros )?)50 ?%|\\b\\d{1,2} ?%(?= (?:\\w+ ){0,4}?e (?:o )?(?:restante|resto)\\b)",
    troca: "uma parte",
  },
  {
    // "Fica do lado da farmacia Pague Menos": referencia de endereco.
    nome: "farmacia_de_referencia",
    fonte:
      "(?<=\\b(?:lado|frente|perto|proxim[oa]|vizinh[oa]|esquina|em cima|embaixo|atras|junto|colad[oa]|depois|antes|rua|predio|galeria|quadra|referencia:?(?: e)?) (?:d[aoe]s? |a |ao |as )?(?:uma |um )?)farmacias?\\b",
    troca: "loja",
  },
  {
    // "Pra cancelar sem custo pedimos aviso", "pode remarcar sim, sem
    // custo": politica da fase controlada.
    nome: "remarcar_sem_custo",
    fonte:
      "(?<=\\b(?:remarc|cancel|desmarc|reagend)\\w*(?:,? \\w+){0,2},? )sem (?:custo|cobranca)\\b",
    troca: "sem taxa",
  },
  {
    nome: "sem_custo_para_remarcar",
    fonte:
      "\\bsem (?:custo|cobranca)(?= (?:nenhum |nenhuma |algum |adicional |extra )?(?:pra|para|de|ao|no|na) (?:a |o )?(?:remarc|cancel|desmarc|reagend))",
    troca: "sem taxa",
  },
  {
    // "Cortesia no estacionamento", "o estacionamento e cortesia", "2h de
    // cortesia ... validar o ticket": politica da fase controlada.
    nome: "cortesia_do_estacionamento",
    fonte: `\\bcortesia(?= (?:no|do|de|da|pro|para o|pra o|para|pra|com o|com) (?:\\w+ ){0,3}?${LUGAR_DO_CARRO}\\b)|(?<=\\b${LUGAR_DO_CARRO}\\b(?: \\w+){0,3} (?:e|eh|tem|com|de|da) (?:\\w+ ){0,2}?)cortesia\\b|(?<=\\b${TEMPO_DE_CORTESIA})cortesia\\b(?=.{0,120}\\b${LUGAR_DO_CARRO}\\b)|(?<=\\b${LUGAR_DO_CARRO}\\b.{0,120}\\b${TEMPO_DE_CORTESIA})cortesia\\b`,
    troca: "tolerancia",
  },
];

export type TermoCompacto = {
  categoria: PadraoDeSaida["categoria"];
  termo: string;
  /**
   * So vale quando o termo comeca no inicio de uma palavra do texto ("trama
   * dol" e remedio; "especialista" nao e "cialis").
   */
  soNoInicioDePalavra?: true;
};

// Remedios da lista que NAO entram no compacto mesmo com a ancora no inicio
// da palavra, porque o nome comeca com palavra comum seguida de comeco de
// outra palavra comum: "voltar entre" contem "voltaren", "melhor
// alternativa" contem "melhoral".
const FORA_DO_COMPACTO = new Set(["voltaren", "melhoral"]);

/**
 * Os remedios de MEDICAMENTOS com 6 letras ou mais (compactados), para a
 * visao compacta pegar "Trama dol", "Cata flam", "Sildena fil" e "Alpra
 * zolam". Termo com \b ou numero fica de fora: o \b esta la justamente
 * porque o nome aparece dentro de outras palavras.
 */
function medicamentosParaOCompacto(): TermoCompacto[] {
  const termos = new Set<string>();
  for (const termo of MEDICAMENTOS) {
    if (/[^a-z ]/.test(termo)) {
      continue;
    }
    const compacto = compactar(termo);
    if (compacto.length >= 6 && !FORA_DO_COMPACTO.has(compacto)) {
      termos.add(compacto);
    }
  }
  return [...termos].map((termo) => ({
    categoria: "medicamento",
    termo,
    soNoInicioDePalavra: true,
  }));
}

/**
 * Lexico forte para a visao compacta (so letras, sem espaco, sem letra
 * repetida). So entra termo que nao aparece por acaso juntando o fim de uma
 * palavra com o comeco da outra; o teste dos controles prova isso. Ja
 * escrito na forma compactada (sem letra dobrada). Os remedios da lista
 * geral entram no fim, ancorados no inicio da palavra.
 */
export const LEXICO_COMPACTO: readonly TermoCompacto[] = [
  ...[
    "dipirona",
    "novalgina",
    "paracetamol",
    "ibuprof",
    "amoxicilina",
    "azitromicina",
    "cefalexina",
    "nimesulida",
    "diclofenaco",
    "cetoprofeno",
    "prednisona",
    "prednisolona",
    "dexametasona",
    "betametasona",
    "loratadina",
    "cetirizina",
    "isotretinoina",
    "roacutan",
    "semaglutida",
    "ozempic",
    "wegovy",
    "tirzepatida",
    "mounjaro",
    "liraglutida",
    "sibutramina",
    "anticoagulante",
    "antibiotico",
    "antinflamatorio",
    "antialergico",
    "analgesico",
    "corticoide",
    "varfarina",
    "marevan",
    "clonazepam",
    "rivotril",
    "fluoxetina",
    "sertralina",
    "finasterida",
    "minoxidil",
    "omeprazol",
    "metformina",
    "tylenol",
    "buscopan",
    "dorflex",
    "neosaldina",
    "remedio",
    "medicamento",
    "medicacao",
    "pomada",
    "xarope",
    "comprimido",
    "hidroquinona",
    "tretinoina",
    "aciclovir",
    "fluconazol",
    "cetoconazol",
    "nistatina",
    "hirudoid",
    "bepantol",
    "nebacetin",
    "lidocaina",
    "anestesic",
  ].map((termo) => ({ categoria: "medicamento" as const, termo })),
  ...["garant", "milagr", "infalivel", "indolor", "rejuvenesc"].map(
    (termo) => ({ categoria: "promessa_resultado" as const, termo }),
  ),
  ...["antesedepois", "antesdepois", "antesxdepois", "beforeafter"].map(
    (termo) => ({ categoria: "antes_depois" as const, termo }),
  ),
  ...["gratis", "degraca", "brinde", "cortesia"].map((termo) => ({
    categoria: "oferta_casada" as const,
    termo,
  })),
  ...[
    "prontosocoro",
    "sangramento",
    "sangrando",
    "inchaco",
    "inchado",
    "hematoma",
    "infecao",
    "inflamacao",
    "alergia",
    "vomito",
    "tontura",
    "desmaio",
    "coceira",
  ].map((termo) => ({ categoria: "triagem" as const, termo })),
  ...["miligrama", "mililitro"].map((termo) => ({
    categoria: "dosagem" as const,
    termo,
  })),
  ...["rinite", "sinusite", "enxaqueca", "dermatite", "conjuntivite"].map(
    (termo) => ({ categoria: "diagnostico" as const, termo }),
  ),
  ...medicamentosParaOCompacto(),
];

/**
 * Nomes que pegam mesmo mal escritos ("dypirona", "paracetamoll",
 * "garamtido"): distancia de edicao 1 para palavra de 7 a 10 letras, 2 a
 * partir de 11.
 */
export const LEXICO_APROXIMADO: readonly {
  categoria: PadraoDeSaida["categoria"];
  termo: string;
}[] = [
  ...[
    "dipirona",
    "novalgina",
    "paracetamol",
    "ibuprofeno",
    "amoxicilina",
    "azitromicina",
    "nimesulida",
    "diclofenaco",
    "prednisona",
    "dexametasona",
    "loratadina",
    "isotretinoina",
    "roacutan",
    "semaglutida",
    "ozempic",
    "tirzepatida",
    "mounjaro",
    "anticoagulante",
    "antibiotico",
    "antiinflamatorio",
    "antialergico",
    "analgesico",
    "corticoide",
    "clonazepam",
    "fluoxetina",
    "sertralina",
    "sibutramina",
    "finasterida",
    "minoxidil",
    "omeprazol",
    "metformina",
    "tylenol",
    "buscopan",
    "medicamento",
    "remedio",
    "comprimido",
  ].map((termo) => ({ categoria: "medicamento" as const, termo })),
  ...["garantido", "garantida", "garantimos", "milagroso"].map((termo) => ({
    categoria: "promessa_resultado" as const,
    termo,
  })),
];

// ---------------------------------------------------------------------------
// Contexto: o paciente falou de saude, entao qualquer resposta e clinica
// ---------------------------------------------------------------------------

/**
 * Quando a mensagem do paciente tem um destes gatilhos, nenhum rascunho
 * passa: "pode sim" depois de "posso tomar dipirona?" e orientacao clinica,
 * e "fique tranquila" depois de "meu rosto inchou" e triagem. O portao de
 * entrada ja escala esses casos antes do agente; isto e a segunda trava.
 */
export const CONTEXTO_CLINICO: ReadonlyMap<
  GatilhoDeEntrada,
  PadraoDeSaida["categoria"]
> = new Map([
  ["sintoma", "triagem"],
  ["assunto_clinico", "orientacao_clinica"],
]);

// ---------------------------------------------------------------------------
// Entrada: padroes por gatilho
// ---------------------------------------------------------------------------

function e(
  gatilho: GatilhoDeEntrada,
  nome: string,
  fonte: string,
): PadraoDeEntrada {
  return { gatilho, nome, regex: new RegExp(fonte) };
}

const PROCEDIMENTOS = alternativas([
  "procedimento",
  "aplicac(?:ao|oes)",
  "botox",
  "toxina",
  "preenchimento",
  "peeling",
  "laser",
  "limpeza",
  "cirurgia",
  "harmonizacao",
  "bioestimulador",
  "fios",
  "microagulhamento",
  "depilacao",
  "tratamento",
  "sessao",
  "consulta",
]);

export const PADROES_DE_ENTRADA: readonly PadraoDeEntrada[] = [
  // ---- sintoma -------------------------------------------------------------
  e(
    "sintoma",
    "sintoma_citado",
    "\\b(?:dor\\b|dores\\b|dorzinha|dorzona|doi\\b|doendo|doeu|doer\\b|dolorid|febr|sangr|inchad|inchac|inchou|incha\\b|inchando|desinch|inx[ao]|reac(?:ao|oes)\\b|falta de ar|sem ar\\b|nao consigo respirar|dificuldade (?:de|para|pra) respirar|tontura|tont[oa]\\b|desmai|vomit|enjo|nausea|diarreia|manch|coceira|cocando|coca\\b|cocar|alergi|alergic|infecc|infeccion|infectad|inflama|pus\\b|caroco|nodulo|bolinha|bolha|empol|passando mal|mal estar|me sentindo mal|estou mal|to mal|machuc|ferid|queimad|queimou|queimando|ardencia|ardend|arde\\b|ardeu|ardor|vermelh|roxo|roxa|hematoma|sangue|edema|formigament|dormencia|dormente|paralis|visao turva|vista embacada|convuls|pressao alta|pressao baixa|taquicardia|palpitac|coracao acelerado|quebrei|fratur|torci\\b|torcao|luxac|cortei|cortou|picada|mordida|irritac|descamand|descascand|secrecao|catarro|tosse|gripad|resfriad|garganta|colica|corrimento|enxaqueca|crise|panico|suicid|me matar|quero morrer|tirar minha vida|socorro|urgente|emergencia|grave\\b|piorou|piorando|estranh[oa]|tort[oa]\\b|caid[oa]\\b|assimetric|deformad|endurecid|aperto no peito|peito (?:\\w+ )?(?:doendo|apertad|queimando|ardendo|chiando)|respir|entort|latej|pontada|fisgada|repux|zonz|tontei|puxando pro lado|aguinha|roxinh|carocinh|calombo)|\\bcostas? (?:ta|tao|esta|estao) me matando",
  ),
  // Sinais de urgencia graves e inequivocos (revisao de 05/10/2026): boca ou
  // rosto formigando (AVC), palpebra ou olho caido (ptose da toxina), falta
  // de folego, coracao disparado, visao embacada, braco ou perna sem forca,
  // liquido saindo e "to muito mal". So a forma inequivoca: "o alarme
  // disparou" ou "a foto ficou embacada" nao entram.
  e(
    "sintoma",
    "urgencia_inequivoca",
    "\\bformig(?:ando|ament|ou\\b|am\\b)|\\bpalpebras? (?:\\w+ )?(?:caiu|cairam|caid|caindo|baixa|pesad|fechand)|\\b(?:olho|olhos) (?:\\w+ )?(?:caid|caiu|cairam|caindo|fechando sozinh|nao abre)|\\bnao consigo abrir (?:o|os|meu|meus) olhos?\\b|\\b(?:sem|falta de|faltando|perdendo o) folego\\b|\\bcoracao (?:\\w+ )?(?:disparad|disparou|acelerad|acelerou|batendo (?:muito |tao )?(?:rapido|forte|acelerado))|\\b(?:visao|vista) (?:\\w+ )?(?:embacad|turv|borrad|dobrad|dupla)|\\b(?:enxergando|vendo)(?: tudo)? (?:embacad|turv|borrad|dobrad|duplo|em dobro)|\\b(?:braco|bracos|perna|pernas|mao|lado do corpo) (?:\\w+ ){0,2}?(?:fraco|fraca|sem forca|dormente|pesad|paralisad)|\\bsaindo (?:um |uma )?(?:liquido|aguinha|pus|secrecao)|\\b(?:to|tou|estou|me sinto|me sentindo|to me sentindo|estou me sentindo) (?:muito|bem|super) (?:mal|ruim)\\b|\\bme sentindo (?:muito |bem |meio )?(?:esquisit|ruim)",
  ),
  e(
    "sintoma",
    "ficou_depois_do_procedimento",
    `\\b(?:depois|apos|desde)\\b (?:d[oa]s? |que (?:fiz|fez|apliquei|aplicou|passei|fui) (?:o |a |no |na )?)?${PROCEDIMENTOS}\\b.{0,40}\\b(?:ficou|ficaram|fiquei|apareceu|apareceram|surgiu|surgiram|comecou|esta|estou|to|tenho|sinto)\\b|\\b(?:ficou|ficaram|fiquei|apareceu|surgiu|esta|estou|to|sinto)\\b.{0,40}\\b(?:depois|apos|desde)\\b (?:d[oa]s? |que )?${PROCEDIMENTOS}`,
  ),
  e(
    "sintoma",
    "sintoma_en_es",
    "\\b(?:pain|hurts?|hurting|fever|bleed|swell|swollen|rash|itch|dizz|faint|vomit|nause|sick\\b|infection|allerg|chest|headache|migraine|bruise|dolor|duele|fiebre|hinchad|hinchazon|mareo|picazon|picor|infeccion)",
  ),

  // ---- menor de idade ------------------------------------------------------
  e(
    "menor_de_idade",
    "menor_citado",
    "\\b(?:meu filho|minha filha|meus filhos|minhas filhas|meu menino|minha menina|meu bebe|minha bebe|meu neto|minha neta|meu enteado|minha enteada|meu sobrinho|minha sobrinha|crianca|bebe\\b|bebes\\b|recem[- ]nascid|adolescente|menor de idade|de menor\\b|sou menor|e menor\\b|meus pais|minha mae deixa|meu pai deixa|autorizacao dos (?:pais|responsaveis)|ensino fundamental|ensino medio|\\d+ ?(?:o|a) ano do)",
  ),
  e(
    "menor_de_idade",
    "menor_en_es",
    "\\b(?:my son|my daughter|my kid|my child|my baby|minor\\b|teen|teenager|underage|mi hijo|mi hija|nino|nina|menor de edad)",
  ),

  // ---- assunto clinico -----------------------------------------------------
  e("assunto_clinico", "remedio_citado", `\\b${alternativas(MEDICAMENTOS)}`),
  // Sem "acido", "farmacia" e "de N meses" (revisao de precisao de
  // 05/10/2026): "quanto custa o preenchimento com acido hialuronico?",
  // "fica perto de qual farmacia?" e "o retorno de 6 meses" sao recepcao.
  e(
    "assunto_clinico",
    "assunto_clinico",
    "\\b(?:remedi|medicament|medicac|tomar\\b|tomo\\b|tomei\\b|tomando|pomad|creme|gestante|gravida|gravidez|gestacao|engravid|amament|lactante|resultado|garant|efeito colateral|efeitos colaterais|contraindic|contra-indic|risco|perigos|faz mal|fazer mal|e seguro|cuidados|pos-operatorio|pos operatorio|pos-procedimento|pos procedimento|recuperacao|anestesi|cirurgia|operei|operad[oa]\\b|exame|laudo|receita|prescri|dose|dosagem|\\d+ ?mg\\b|diabet|hipertens|pressao|cardiac|marca-?passo|doenca|o que pode ser|e normal|e grave|devo me preocupar|tem problema|dar problema|da problema|resguardo|pos-parto|pos parto|antes do procedimento|depois do procedimento|vacina|hormoni|anticoncep|menstru|herpes|lupus|autoimun|cancer|quimioterapia|radioterapia|antibiot|anti-?inflamat|antinflamat|analges|corticoi|anticoagul)",
  ),
  // A segunda parte pede o verbo colado ("posso ir na praia", "libera
  // piscina", "pode tomar uma cervejinha"): "pode ser depois da academia?"
  // e "consigo ir depois da praia" sao horario. Tambem "uso aquele acido"
  // e "to de 3 meses" (gravidez).
  e(
    "assunto_clinico",
    "posso_fazer_algo_com_o_corpo",
    "\\bposso (?:tomar|beber|pegar sol|tomar sol|ir a praia|ir na praia|ir pra praia|malhar|treinar|nadar|usar maquiagem|lavar|molhar|deitar|dormir|fazer exercicio|fazer academia|fazer atividade|fazer (?:o procedimento|isso|assim) (?:gravida|amamentando|tomando))|\\b(?:posso|da pra|consigo|libera|liberado|pode)\\b (?:\\w+ ){0,2}?(?:beber|tomar (?:uma |um )?(?:cerveja|cervejinha|vinho|bebida|drink|sol)|pegar (?:uma |um )?(?:sol|praia|piscina)|ir (?:a|na|pra|pro|ao|no) (?:praia|piscina|sauna|academia|sol)\\b|malhar|treinar|nadar|usar maquiagem|me maquiar|maquiar|lavar (?:o|a|os) (?:rosto|cabelo|regiao|local|area)|molhar|deitar|dormir de)|\\b(?:libera|liberou|liberado|liberada)\\b (?:a |o )?(?:praia|piscina|sauna|academia|sol|bebida|cerveja|alcool|maquiagem|treino|exercicio)\\b|\\b(?:uso|usando|usei|passo|passando|passei|aplico|aplicando)\\b (?:\\w+ ){0,3}?(?:acido|retinoico|retinol)|\\b(?:to|tou|estou|ja to|ja estou) de \\d+ (?:meses|semanas)\\b",
  ),
  e(
    "assunto_clinico",
    "assunto_clinico_en_es",
    "\\b(?:medicine|medication|pill|pregnan|breastfeed|side effects?|safe\\b|risk|results?\\b|guarantee|pastilla|embarazad|lactancia|efectos secundarios|riesgo|garantia)",
  ),

  // ---- manipulacao ---------------------------------------------------------
  // Estreitado em 05/10/2026: "sistema" so como "prompt/regras do sistema"
  // ("o sistema de voces ta fora?"), "programad" so de quem responde ("minha
  // consulta ta programada"), "a partir de agora" so com ordem ao robo,
  // "em ingles" so com "responda/fale", "aprovada:" sai ("minha consulta foi
  // aprovada: posso confirmar?") e e-mail com sublinhado nao e codigo.
  e(
    "manipulacao",
    "manipulacao",
    "\\b(?:ignor|desconsider|esquec(?:e|a) (?:tudo|suas|as|o que)|instruc|prompt|system\\b|(?:prompt|instruc\\w*|regras|mensagem|comando|modo)s? d[oe] sistema\\b|diretriz|configurac|(?:voce|vc|tu|foi|fui|sou|es) (?:\\w+ )?programad|voce agora e|agora voce e|a partir de agora (?:voce|vc|tu|responda|responde|ignore|ignora|esqueca|esquece|seja|aja|finja|fale|fala|so|apenas|sem)\\b|finja|finge|fingir|faca de conta|faz de conta|role ?play|personagem|modo (?:desenvolvedor|dev|debug|admin|teste|livre|sem filtro)|jailbreak|dan\\b|developer mode|sem filtro|sem restric|responda (?:apenas|so|somente)|repita|traduz|translate|(?:responda|responde|fale|fala|escreva|escreve|continue|answer|reply) (?:\\w+ ){0,2}?em ingles|in english|token|administrador|admin\\b|root\\b|override|bypass|act as|pretend|you are now|forget (?:your|all|previous)|olvida|ignora las|aja como|age como|atue como|comporte-se como|modelo de linguagem|language model|avaliador|avaliacao interna|verificador|revisor|rascunho|veredicto|considere aprovad|pode aprovar|aprovad[oa] ?=|(?:status|parecer|decisao|verificacao|moderacao|validacao|revisao)\\s*[:=]\\s*(?:aprovad|conforme|liberad)|marque como (?:aprovad|conforme|ok|valid)|confianca\\s*[:=]?\\s*(?:alta|media)|conformidade)|[\\u00ab\\u00bb\\u2039\\u203a]{2,}|\\b[a-z]+_[a-z]+_[a-z]+\\b(?![a-z0-9_.+-]*(?:@|\\.(?:com|br|net|org)\\b))",
  ),
  // Revisao de precisao de 05/10/2026 (conjunto cego 1): autorizacao da
  // medica alegada pelo paciente ("a dra ja autorizou, pode me falar
  // quantas unidades"). "A dra liberou a agenda" e "o dr autorizou a guia"
  // sao agenda e convenio.
  e(
    "manipulacao",
    "autorizacao_alegada",
    "\\b(?:dra|dr|doutora|doutor|medica|medico)\\b(?:\\.? (?!(?:ja|me|tinha|que)\\b)\\w+)? (?:(?:ja )?(?:me )?(?:autorizou|liberou|permitiu)|(?:ja )?tinha (?:me )?(?:autorizado|liberado|permitido))\\b(?! (?:a |o |os |as |mais |um |uma |novos? |novas? |sua |seu |minha |meu )?(?:agenda|horario|vaga|encaixe|data|dia|guia|atestado|declaracao|retorno|pedido|consulta|exame|laudo)s?\\b)",
  ),
  e(
    "manipulacao",
    "marcacao",
    "[<>{}\\[\\]\\\\`]|#{3,}|\\b(?:assistant|user|human|system)\\s*:|\\b[a-z0-9+/]{40,}={0,2}",
  ),

  // ---- pedido de humano ----------------------------------------------------
  e(
    "pedido_humano",
    "pedido_humano",
    "\\b(?:atendente|humano|humana|ser humano|pessoa (?:de verdade|real|fisica)|gente de verdade|robo|robozinho|bot\\b|chatbot|chat bot|maquina\\b|(?<!debito )automatic|inteligencia artificial|e uma ia\\b|voce e (?:uma )?ia\\b|e ia\\b|gerente|supervisor|responsavel|dono\\b|dona da clinica|recepcionista|secretaria|falar com (?:alguem|uma? pessoa|o medico|a medica|o doutor|a doutora|a dra|o dr|voces|a clinica)|conversar com (?:alguem|uma? pessoa)|quero (?:falar|conversar) com|me liga|me ligue|ligar (?:pra|para) mim|pode me ligar|telefonar|tem alguem ai|alguem ai|alguem de verdade|e voce mesm[oa]|voce e real|e uma pessoa|e gente)",
  ),
  // Revisao de precisao de 05/10/2026 (conjunto cego 1): pedir para chamar
  // ou falar com a doutora ("chama a dra ai pra falar cmg", "a dra pode
  // falar comigo?", "me passa pra dra"). "Quero marcar com a dra Ana" e
  // "a dra pode me atender sexta?" sao agenda.
  e(
    "pedido_humano",
    "falar_com_a_doutora",
    "\\b(?:chama|chame|chamar|chamem|transfere|transfira|transferir|pede (?:pra|para)|peca (?:pra|para)|(?:me )?(?:passa|passe|passar) (?:pra|para|pro))\\b (?:ai |aqui |logo |pra mim )?(?:pra |para |pro )?(?:a |o )?(?:dra|dr|doutora|doutor|medica|medico)\\b(?:\\.? (?!(?:pra|para|pro|ai|aqui|me|falar|conversar|logo|por)\\b)\\w+)?(?: (?:ai|aqui|pra mim|logo|por favor|pfv|pfvr|pf|urgente))*(?: (?:pra|para|pro) (?:falar|conversar|me (?:ligar|liga|ligue|responder|retornar|chamar))| (?:falar|conversar) (?:comigo|cmg)| me (?:ligar|liga|ligue|responder|retornar|chamar)|\\s*(?:$|[?!.,]))|\\b(?:dra|dr|doutora|doutor|medica|medico)\\b(?:\\.? (?!(?:pode|poderia|podia|consegue|conseguiria|vai)\\b)\\w+)? (?:pode |poderia |podia |consegue |conseguiria |vai )?(?:falar|conversar) (?:comigo|cmg)\\b|\\b(?:dra|dr|doutora|doutor|medica|medico)\\b(?:\\.? (?!(?:pode|poderia|podia)\\b)\\w+)? (?:pode|poderia|podia) me (?:ligar|liga|responder|retornar|chamar)\\b|\\b(?:falar|conversar) (?:direto |diretamente |pessoalmente )?com (?:a |o )?(?:dra|dr|doutora|doutor|medica|medico)\\b",
  ),
  e(
    "pedido_humano",
    "pedido_humano_en_es",
    "\\b(?:human|real person|agent\\b|operator|manager|robot|are you real|talk to someone|persona real|hablar con alguien|agente\\b)",
  ),

  // ---- insatisfacao --------------------------------------------------------
  e(
    "insatisfacao",
    "insatisfacao",
    "\\b(?:pessim|horrivel|horroros|ridicul|absurd|procon|reclame ?aqui|reclamac|reclamar|advogad|processar|processo judicial|entrar na justica|justica|juizado|denunci|cfm\\b|crm\\b|vigilancia sanitaria|anvisa|nunca mais|palhacada|vergonha|descaso|desrespeit|falta de respeito|irritad|indignad|decepcion|insatisfeit|chatead|lixo|porcaria|enganad|golpe|fraude|mentira|mentiros|roubo|ladr|estorno|exijo\\b|devolv(?:er|am|e) (?:meu|o) dinheiro|dinheiro de volta|cancelar tudo|porra|merda|caralho|puta\\b|foda|pqp\\b|vtnc\\b|fdp\\b|desgrac|inferno|cansad[oa] de esperar|demorando|ninguem (?:me )?responde|sem resposta|nao respondem|terrivel|lamentavel)",
  ),
  // "Reembolso" sozinho saiu em 05/10/2026 ("qual o cnpj? preciso pro
  // reembolso" e convenio). Fica o reembolso cobrado da clinica.
  e(
    "insatisfacao",
    "reembolso_cobrado",
    "\\b(?:quero|exijo|cade|kd) (?:o |meu |um |a )?(?:reembolso|ressarcimento)\\b(?! (?:\\w+ ){0,3}?(?:plano|convenio|seguro|operadora|unimed|bradesco|amil|sulamerica|hapvida))",
  ),
  e(
    "insatisfacao",
    "insatisfacao_en_es",
    "\\b(?:terrible|awful|worst|lawyer|sue\\b|complain|refund|scam|fraud|horrible|abogado|demanda|queja|estafa)",
  ),
  e("insatisfacao", "exclamacoes", "!{3,}|[!?]{4,}"),

  // ---- valor fora da tabela ------------------------------------------------
  // Sem "pix" e "a vista" soltos ("voces aceitam pix?").
  e(
    "valor_fora_da_tabela",
    "valor_fora_da_tabela",
    "\\b(?:desconto|descontinho|mais barat|baratinh|barato|negoci|cupom|abaixa|abaixar|baixar o (?:preco|valor)|reduzir o (?:preco|valor)|melhor (?:preco|valor|condicao)|condicao especial|promoc|promo\\b|black friday|cashback|valor menor|preco menor|muito caro|ta caro|esta caro|caro demais|mais em conta|tem como (?:fazer|deixar) por|outra clinica cobra|concorrente|cobrir (?:o |a )?(?:oferta|preco|valor))",
  ),
  e(
    "valor_fora_da_tabela",
    "faz_por",
    // O numero nao recua um digito para escapar da unidade ("faz em 10x"
    // nao e "faz em 1"; bug achado na revisao de 05/10/2026).
    "\\b(?:faz|faria|fazer|fecha|fechar|consegue|deixa|deixar|sai|faco|aceita|aceitam)\\b (?:\\w+ )?(?:por|em|a) \\d+(?![\\d.,]*\\s*(?:h\\b|hs\\b|horas?|min|minutos?|dias?|semanas?|meses|x\\b|sessoes|sessao|vezes|aplicacoes|pessoas|[:/]|de (?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)))",
  ),
  // Revisao de precisao de 05/10/2026 (conjunto cego 1): contraproposta
  // com o procedimento no meio ("consegue fazer o botox por 800?", "por
  // 800 vc faz?") e "precinho" pedindo condicao ("faz um precinho
  // melhor?"). "Qual o precinho da consulta?" e pergunta de preco.
  e(
    "valor_fora_da_tabela",
    "contraproposta",
    "\\b(?:faz|faria|fazer|fecha|fechar|fecham|consegue|conseguiria|conseguem|deixa|deixar|deixaria|sai|sairia|aceita|aceitam|aceitaria|topa|topam|toparia|rola|pode fazer|podia fazer|poderia fazer)\\b (?:\\w+ ){0,3}?(?:por (?:r\\$ ?)?|(?:a|em) r\\$ ?)\\d{2,}(?:[.,]\\d+)?(?![\\d.,]*\\s*(?:h\\b|hs\\b|horas?|min|minutos?|dias?|semanas?|meses|anos?|x\\b|sessoes|sessao|vezes|aplicacoes|pessoas|unidades|ml|areas|regioes|[:/%]))|\\bpor (?:r\\$ ?)?\\d{2,}(?:[.,]\\d+)? (?:voce |vc |vcs |voces |cs )?(?:faz|fazem|fecha|fecham|aceita|aceitam|topa|topam|consegue|conseguem)\\b",
  ),
  e(
    "valor_fora_da_tabela",
    "precinho",
    "\\b(?:faz|faca|fazer|faria|da|dar|daria|tem|teria|rola|consegue|conseguiria)\\b (?:\\w+ ){0,2}?precinho|\\bprecinho (?:melhor|camarada|especial|bom|amigo|diferente|legal|de amig|em conta|mais em conta|mais baixo|menor)",
  ),
  e(
    "valor_fora_da_tabela",
    "valor_en_es",
    "\\b(?:discount|cheaper|deal\\b|coupon|descuento|mas barato|rebaja)",
  ),
];

// ---------------------------------------------------------------------------
// Entrada: expressoes permitidas (trocadas antes dos padroes)
// ---------------------------------------------------------------------------

/** "Laudo", "exame" e "o resultado do exame", como documento. */
const EXAME_COMO_DOCUMENTO =
  "(?:resultados? d[aoe]s? (?:meus? |minhas? )?(?:laudo|exame|biopsia|ultrassom|ultrassonografia|ultra|eletro\\w*|raio[- ]?x|mamografia|tomografia|ressonancia|hemograma|preventivo|papanicolau|holter|ecocardiograma|ecg)s?|(?:laudo|exame)s?)";
const DONO_DO_DOCUMENTO = "(?:o |a |os |as |meu |minha |meus |minhas )?";

/**
 * Perguntas de recepcao sobre o exame como DOCUMENTO (quando fica pronto,
 * onde pegar), que o padrao de assunto clinico pegava pela palavra "laudo"
 * ou "exame" (revisao de precisao do conjunto cego 1, 05/10/2026). O
 * resultado comentado ("o exame saiu alterado") continua escalando.
 */
export const NEUTRALIZACOES_DE_ENTRADA: readonly Neutralizacao[] = [
  {
    // "Exame de sangue" e nome de exame, nao sangramento.
    nome: "exame_de_sangue",
    fonte: "(?<=\\b(?:exames?|coleta|teste) )de sangue\\b",
    troca: "laboratorial",
  },
  {
    // "O laudo do ultrassom fica pronto qdo?", "o resultado do exame ja
    // saiu?"
    nome: "exame_fica_pronto",
    fonte: `\\b${EXAME_COMO_DOCUMENTO}(?= (?:(?:d[aoe]s? )?\\w+ ){0,3}?(?:ja |ainda |vai |nao )?(?:(?:fica|ficam|ficou|ficaram|ficar|ficaria|esta|estao|ta|tao) pront[oa]s?|sai|saem|saiu|sairam|sair|chega|chegou|chegam|libera|liberou|liberam|vem|vai por)\\b(?! (?:alterad|normal|ruim|bom|boa|positiv|negativ|com\\b|dando|deu)))`,
    troca: "documento",
  },
  {
    // "Quando sai o resultado do exame?"
    nome: "quando_sai_o_exame",
    fonte: `(?<=\\b(?:quando|qdo|qnd|qndo|que dia|que horas|quantos dias|quanto tempo)(?: \\w+){0,2} (?:fica pronto|fica pronta|ficam prontos|ficar pronto|ficar pronta|sai|saem|sair|chega|chegam|libera|liberam|posso pegar|posso buscar|posso retirar|pego|busco|retiro) ${DONO_DO_DOCUMENTO})${EXAME_COMO_DOCUMENTO}\\b`,
    troca: "documento",
  },
  {
    // "Posso pegar o laudo amanha?", "manda o exame por e-mail?"
    nome: "buscar_o_exame",
    fonte: `(?<=\\b(?:pegar|buscar|retirar|receber|retiro|pego|busco|recebo|mandar|manda|mandam|enviar|envia|enviam|entregar|entrega|entregam|imprimir|segunda via d[oe]) ${DONO_DO_DOCUMENTO})${EXAME_COMO_DOCUMENTO}\\b`,
    troca: "documento",
  },
];

/** Lexico forte da entrada, na forma compactada (sem letra dobrada). */
export const LEXICO_COMPACTO_DE_ENTRADA: readonly {
  gatilho: GatilhoDeEntrada;
  termo: string;
}[] = [
  ...[
    "febre",
    "sangrando",
    "sangramento",
    "sangrou",
    "inchou",
    "inchado",
    "inchada",
    "inchaco",
    "desmai",
    "vomit",
    "tontura",
    "faltadear",
    "alergia",
    "infecao",
    "inflama",
    "coceira",
    "ardendo",
    "doendo",
    "hematoma",
  ].map((termo) => ({ gatilho: "sintoma" as const, termo })),
  ...["remedio", "medicamento", "dipirona", "paracetamol", "gravida"].map(
    (termo) => ({ gatilho: "assunto_clinico" as const, termo }),
  ),
  ...["ignore", "ignora", "instruc", "prompt", "jailbreak"].map((termo) => ({
    gatilho: "manipulacao" as const,
    termo,
  })),
  ...["atendente", "humano", "chatbot"].map((termo) => ({
    gatilho: "pedido_humano" as const,
    termo,
  })),
  ...["procon", "reclameaqui", "advogado"].map((termo) => ({
    gatilho: "insatisfacao" as const,
    termo,
  })),
  ...["desconto"].map((termo) => ({
    gatilho: "valor_fora_da_tabela" as const,
    termo,
  })),
];

/** Numeros por extenso de 1 a 17, para "tenho dezesseis anos". */
export const IDADES_POR_EXTENSO: ReadonlyMap<string, number> = new Map([
  ["um", 1],
  ["uma", 1],
  ["dois", 2],
  ["duas", 2],
  ["tres", 3],
  ["quatro", 4],
  ["cinco", 5],
  ["seis", 6],
  ["sete", 7],
  ["oito", 8],
  ["nove", 9],
  ["dez", 10],
  ["onze", 11],
  ["doze", 12],
  ["treze", 13],
  ["quatorze", 14],
  ["catorze", 14],
  ["quinze", 15],
  ["dezesseis", 16],
  ["dezeseis", 16],
  ["dezessete", 17],
  ["dezesete", 17],
]);
