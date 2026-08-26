// Leitura PURA da resposta do paciente ao toque de confirmacao (tarefa 4.7).
//
// O paciente pode ter recebido BOTAO interativo ou o texto numerado: o uazapi
// degrada sozinho quando o botao falha, e a clinica nao controla isso. Entao
// as duas formas valem: o rotulo do botao ("Confirmar"), o id dele
// ("confirmar") e o numero da lista ("1").
//
// A regra e SER CONSERVADOR. Nao interpretar e barato: a conversa ja nasce
// em 'aguardando_humano' e a recepcao assume. Interpretar errado cancela a
// consulta de alguem. Por isso a comparacao e por frase inteira, nunca por
// "contem": "11" e "10" NAO sao confirmacao (o paciente que digita 11 quis
// dizer outra coisa, talvez a hora), "nao vou poder confirmar" nao vira
// confirmacao so por conter a palavra, e qualquer sobra cai em
// 'nao_reconhecida'.

export type IntencaoDoPaciente =
  | "confirmar"
  | "remarcar"
  | "cancelar"
  | "nao_reconhecida";

// Joinha e sinais de certo. Sozinhos valem confirmacao; acompanhados de texto,
// quem decide e o texto.
const EMOJIS_DE_CONFIRMACAO = [
  "\u{1F44D}", // joinha
  "\u{1F44C}", // sinal de ok
  "✅", // certo em quadro verde
  "✔", // certo pesado
  "☑", // caixa marcada
];

// Seletores de variacao e tom de pele acompanham o emoji e nao mudam o
// sentido: saem antes da comparacao.
const MODIFICADORES = /[\u{FE0E}\u{FE0F}\u{1F3FB}-\u{1F3FF}]/gu;

const CONFIRMAR = new Set([
  "1",
  "confirmar",
  "confirmo",
  "confirmado",
  "confirmada",
  "confirmar presenca",
  "sim",
  "sim confirmo",
  "sim confirmado",
  "ok",
  "okay",
  "pode ser",
  "sim pode ser",
  "esta confirmado",
  "estara confirmado",
  "vou",
  "vou sim",
  "estarei la",
]);

const REMARCAR = new Set([
  "2",
  "remarcar",
  "remarca",
  "quero remarcar",
  "preciso remarcar",
  "reagendar",
  "quero reagendar",
  "mudar",
  "mudar horario",
  "mudar o horario",
  "mudar de horario",
]);

const CANCELAR = new Set([
  "3",
  "cancelar",
  "cancela",
  "cancelado",
  "quero cancelar",
  "preciso cancelar",
  "desmarcar",
  "desmarca",
  "quero desmarcar",
  "nao vou",
  "nao vou poder ir",
  "nao vou poder",
  "nao posso ir",
]);

/**
 * Normaliza para comparacao: sem espaco nas pontas, sem maiuscula, sem
 * acento, sem pontuacao e com espaco unico entre palavras.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Le a intencao do paciente. Devolve 'nao_reconhecida' em qualquer duvida:
 * o fail-safe do fluxo e a recepcao assumir a conversa.
 */
export function interpretarResposta(body: string | null): IntencaoDoPaciente {
  if (!body) {
    return "nao_reconhecida";
  }

  const semModificadores = body.replace(MODIFICADORES, "");
  let restante = semModificadores;
  let temEmojiDeConfirmacao = false;
  for (const emoji of EMOJIS_DE_CONFIRMACAO) {
    if (restante.includes(emoji)) {
      temEmojiDeConfirmacao = true;
      restante = restante.split(emoji).join(" ");
    }
  }

  const texto = normalizar(restante);
  if (texto.length === 0) {
    return temEmojiDeConfirmacao ? "confirmar" : "nao_reconhecida";
  }
  if (CONFIRMAR.has(texto)) {
    return "confirmar";
  }
  if (REMARCAR.has(texto)) {
    return "remarcar";
  }
  if (CANCELAR.has(texto)) {
    return "cancelar";
  }
  return "nao_reconhecida";
}
