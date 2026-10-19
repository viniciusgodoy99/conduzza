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
      "Entendo, vou repassar para a equipe.",
    ]);
  });
});
