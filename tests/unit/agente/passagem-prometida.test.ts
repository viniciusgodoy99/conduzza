import { describe, expect, it } from "vitest";

import { prometePassagemParaAEquipe } from "@/lib/agente/passagem-prometida";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import { FRASES_DE_RECEPCAO } from "@/tests/fixtures/ia/conformidade/casos";

// Revisao de producao de 19/10/2026 (Q5): a resposta final que promete
// passar a conversa para a equipe (ou que alguem vai retornar) sem ter
// chamado escalar_humano. O laco trata como passagem (motor-laco.test.ts);
// aqui, o que conta e o que nao conta como promessa.

describe("prometePassagemParaAEquipe", () => {
  it.each([
    FRASE_DE_ESCALONAMENTO,
    "Vou passar sua conversa para a equipe, que te informa o valor.",
    "Ainda não tenho esse valor. Vou passar para a equipe confirmar.",
    "Vou encaminhar sua dúvida para nossa equipe.",
    "Vou te transferir para um atendente.",
    "Vou encaminhar seu pedido.",
    "Já encaminhei sua mensagem para a recepção.",
    "Estou passando seu atendimento para alguém da equipe.",
    "Sua conversa foi encaminhada para a equipe.",
    "Vou confirmar o valor com a equipe e já te retorno.",
    "Vou verificar com a recepção.",
    "Vou pedir para a equipe te ligar.",
    "Vou avisar a equipe.",
    "Quer que eu passe sua conversa para a equipe?",
    "Posso te encaminhar para a Dra. Helena?",
    "Um atendente já vai falar com você.",
    "A equipe vai te responder em breve.",
    "Nossa equipe entrará em contato.",
    "Alguém da nossa equipe te responde assim que possível.",
    "A recepção vai te passar o valor no dia.",
    "Entraremos em contato para confirmar.",
    "Já te dou um retorno.",
    "VOU PASSAR PARA A EQUIPE",
  ])("conta: %s", (texto) => {
    expect(prometePassagemParaAEquipe(texto)).toBe(true);
  });

  it.each([
    "Olá! Aqui é a Ana, da clínica. Como posso ajudar?",
    "A Prostota custa R$ 500,00 no particular.",
    "Vou te passar o valor: a consulta custa R$ 317,00.",
    "Vou te mandar a localização da clínica.",
    "Nossa equipe atende de segunda a sexta, das 8h às 18h.",
    "Para remarcar, fale com a recepção.",
    "Você pode passar na recepção para retirar o recibo.",
    "Retornamos às 14h, depois do almoço.",
    "O retorno é em 30 dias.",
    "Entramos em contato um dia antes para confirmar.",
    "A médica vai avaliar na consulta.",
    "A Dra. Helena vai te atender na quinta.",
    "Posso te ajudar com mais alguma coisa?",
    "Qualquer dúvida, é só chamar.",
    "O pagamento é feito na recepção.",
    "Pode me dizer qual é o seu convênio e o plano?",
  ])("não conta: %s", (texto) => {
    expect(prometePassagemParaAEquipe(texto)).toBe(false);
  });

  it("nas frases de recepção da bateria, só as que prometem passar ou retornar contam", () => {
    const contam = FRASES_DE_RECEPCAO.filter(prometePassagemParaAEquipe);
    expect(contam).toEqual([
      "Entendi! Vou passar sua dúvida para a equipe, tudo bem?",
      "Vou verificar a agenda e já te retorno.",
      "Recebemos sua mensagem fora do horário de atendimento. Amanhã cedo alguém te responde.",
      // AG2: a IA nao poe ninguem na lista de espera nem volta para avisar.
      "Vou te colocar na lista de espera e aviso se surgir uma vaga.",
      "Entendo, vou repassar para a equipe.",
    ]);
  });
});

// AG2 (27/10/2026): conferir alguma coisa e prometer voltar depois, sem
// chamar a ferramenta de passar, e passagem de verdade: a IA so fala quando
// o paciente manda mensagem, e quem espera a volta dela fica sem resposta.
describe("prometePassagemParaAEquipe: conferir e voltar depois (AG2)", () => {
  it.each([
    "Vou verificar e já te retorno.",
    "Deixa eu confirmar e te aviso.",
    "Deixe-me verificar a disponibilidade e retorno em breve.",
    "Vou checar aqui e te falo.",
    "Vou ver a agenda e retorno.",
    "Vou consultar o valor e entro em contato.",
    "Vou conferir com calma e já te digo.",
    "Vou dar uma olhada na agenda e te falo.",
    "Obrigada pela mensagem! Vou verificar os horários e já te respondo.",
    "Te aviso assim que souber.",
    "Te falo em seguida, tá bom?",
    "Assim que eu tiver a resposta, te falo.",
    "Assim que souber, te aviso por aqui.",
    "Já volto com a resposta.",
    "Volto em seguida com o valor.",
    "Aguarde um momento, por favor.",
    "Espera só um minutinho que eu confiro.",
    "Me dá um minutinho que eu confiro.",
    "Só um instante.",
    "Um momento, por favor, vou verificar.",
    "Vou te colocar na lista de espera e aviso se surgir uma vaga.",
    "VOU VERIFICAR E JÁ TE RETORNO",
  ])("conta: %s", (texto) => {
    expect(prometePassagemParaAEquipe(texto)).toBe(true);
  });

  it.each([
    // A oferta em pergunta: a resposta do paciente traz a IA de volta.
    "Posso verificar a agenda e te aviso os horários?",
    // O texto que o fluxo de marcar pede (a mensagem do sistema depois da
    // aprovacao chega sem a IA).
    "Sua consulta ficou marcada, pendente da aprovação da equipe. A confirmação chega por aqui.",
    "Entramos em contato um dia antes para confirmar.",
    "Retornamos às 14h, depois do almoço.",
    "O retorno é em 30 dias.",
    "Chegando, aguarde um momento na recepção que a Dra. Ana te chama.",
    "Vou verificar a agenda: tenho terça às 14:00.",
    "Te aviso que a clínica fecha às 18h.",
    "Confirma terça, 21/10 às 14:00 com a Dra. Ana?",
    "Em um momento oportuno, a avaliação é feita na consulta.",
    "Se quiser, posso ver outro dia. Qual prefere?",
  ])("não conta: %s", (texto) => {
    expect(prometePassagemParaAEquipe(texto)).toBe(false);
  });
});
