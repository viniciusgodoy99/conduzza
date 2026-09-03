import { describe, expect, it } from "vitest";

import {
  conciliarEnvios,
  enviosDaConversa,
  type EnvioEmVoo,
} from "@/lib/domain/envios-em-voo";
import type { MessageItem } from "@/lib/queries/conversations";

// A conciliacao decide QUANDO a bolha otimista some. Errar para um lado deixa
// a mensagem duplicada na tela por segundos; errar para o outro deixa um
// "enviando" eterno. Por isso ela e uma funcao pura, e por isso estes testes
// existem.

const EU = "user-atendente";

function mensagem(over: Partial<MessageItem> = {}): MessageItem {
  return {
    id: crypto.randomUUID(),
    direction: "saida",
    author: "usuario",
    author_user_id: EU,
    content_type: "texto",
    body: "bom dia",
    media_url: null,
    transcript: null,
    is_internal_note: false,
    delivery_status: "enviada",
    error_code: null,
    created_at: "2026-09-03T10:00:00Z",
    deleted_at: null,
    deleted_by: null,
    deleted_source: null,
    deleted_escopo: null,
    reply_to_message_id: null,
    reply_to_wa_message_id: null,
    reply_to: null,
    ...over,
  };
}

function envio(over: Partial<EnvioEmVoo> = {}): EnvioEmVoo {
  return {
    chave: crypto.randomUUID(),
    conversationId: "conversa-1",
    corpo: "bom dia",
    ehNota: false,
    citandoId: null,
    idsAntes: new Set<string>(),
    apartirDe: "2026-09-03T09:00:00Z",
    estado: "enviando",
    ...over,
  };
}

describe("conciliarEnvios", () => {
  it("some quando a linha real chega", () => {
    const emVoo = [envio()];
    expect(conciliarEnvios([mensagem()], emVoo, EU, "conversa-1")).toHaveLength(
      0,
    );
  });

  it("continua enquanto a linha real não chegou", () => {
    const emVoo = [envio({ corpo: "boa tarde" })];
    expect(conciliarEnvios([mensagem()], emVoo, EU, "conversa-1")).toHaveLength(
      1,
    );
  });

  it("compara o corpo APARADO", () => {
    // O Zod da Server Action grava o corpo com .trim(), então comparar com o
    // texto cru nunca casaria e a bolha ficaria em "enviando" para sempre.
    const emVoo = [envio({ corpo: "bom dia" })];
    const real = mensagem({ body: "bom dia" });
    expect(conciliarEnvios([real], emVoo, EU, "conversa-1")).toHaveLength(0);
  });

  it("mensagem que JÁ estava na tela não conta", () => {
    // O caso que o horário não resolveria: a atendente manda de novo um texto
    // que ela já tinha mandado antes. Sem idsAntes, a bolha nova casaria com a
    // mensagem velha e sumiria antes de a nova existir.
    const antiga = mensagem();
    const emVoo = [envio({ idsAntes: new Set([antiga.id]) })];
    expect(conciliarEnvios([antiga], emVoo, EU, "conversa-1")).toHaveLength(1);
  });

  it("dois envios idênticos consomem duas linhas distintas", () => {
    // Sem a atribuição um para um, a primeira linha real casaria com os dois
    // envios e as duas bolhas sumiriam, deixando uma mensagem só na tela.
    const emVoo = [envio(), envio()];
    expect(conciliarEnvios([mensagem()], emVoo, EU, "conversa-1")).toHaveLength(
      1,
    );
    expect(
      conciliarEnvios([mensagem(), mensagem()], emVoo, EU, "conversa-1"),
    ).toHaveLength(0);
  });

  it("nota interna não casa com resposta ao paciente", () => {
    // Os dois planos podem ter o mesmo texto. Confundi-los faria a bolha da
    // nota sumir porque uma resposta ao paciente chegou, e vice-versa.
    const emVoo = [envio({ ehNota: true })];
    expect(conciliarEnvios([mensagem()], emVoo, EU, "conversa-1")).toHaveLength(
      1,
    );
    expect(
      conciliarEnvios(
        [mensagem({ is_internal_note: true })],
        emVoo,
        EU,
        "conversa-1",
      ),
    ).toHaveLength(0);
  });

  it("mensagem de outra pessoa não casa", () => {
    const emVoo = [envio()];
    expect(
      conciliarEnvios(
        [mensagem({ author_user_id: "outra-pessoa" })],
        emVoo,
        EU,
        "conversa-1",
      ),
    ).toHaveLength(1);
  });

  it("mensagem do paciente não casa", () => {
    const emVoo = [envio()];
    const doPaciente = mensagem({
      direction: "entrada",
      author: "paciente",
      author_user_id: null,
    });
    expect(conciliarEnvios([doPaciente], emVoo, EU, "conversa-1")).toHaveLength(
      1,
    );
  });

  it("envio que falhou some quando a linha falhada chega", () => {
    // O provedor pode recusar DEPOIS do insert: a linha real existe marcada
    // como 'falhou' e a bolha já diz isso. Sem casar, o erro apareceria duas
    // vezes, uma no cartão e outra na bolha.
    const emVoo = [envio({ estado: "falhou", erro: "desconectado" })];
    const real = mensagem({ delivery_status: "falhou" });
    expect(conciliarEnvios([real], emVoo, EU, "conversa-1")).toHaveLength(0);
  });

  it("linha apagada não serve de par", () => {
    const emVoo = [envio()];
    const apagada = mensagem({
      body: null,
      deleted_at: "2026-09-03T10:01:00Z",
    });
    expect(conciliarEnvios([apagada], emVoo, EU, "conversa-1")).toHaveLength(1);
  });

  // O defeito que foi para produção no commit 8343d82 e voltou nesta revisão.
  it("envio de OUTRA conversa nunca é conciliado aqui", () => {
    // Mandei "bom dia" para a Maria (conversa-1) e abri a conversa do João
    // (conversa-2), que tem um "bom dia" meu de ontem. Sem o recorte por
    // conversa, o idsAntes (montado com as mensagens da Maria) não protege
    // nada: toda mensagem do João conta como nova e casa. A bolha da Maria
    // sumia com o envio ainda em voo, e o cartão "Não enviada" dela sumia
    // junto, levando o texto embora sem avisar ninguém.
    const emVoo = [envio({ conversationId: "conversa-1" })];
    const doOutroPaciente = [mensagem({ body: "bom dia" })];
    expect(
      conciliarEnvios(doOutroPaciente, emVoo, EU, "conversa-2"),
    ).toHaveLength(1);
  });

  it("sem conversa aberta, nada é conciliado", () => {
    const emVoo = [envio()];
    expect(conciliarEnvios([mensagem()], emVoo, EU, null)).toHaveLength(1);
  });

  // Achado da revisão de 03/09/2026: idsAntes é retrato só do que estava
  // CARREGADO, e o fio pagina de 50 em 50 para trás.
  it("mensagem antiga que entra depois não é aceita como prova de chegada", () => {
    // A pessoa manda "bom dia", e só então clica em "Carregar mensagens
    // anteriores". Chega um "bom dia" dela de duas semanas atrás, que não está
    // em idsAntes porque não estava na tela. Sem o piso de tempo, ele contava
    // como a mensagem nova: a bolha sumia com o envio ainda em voo e, se ele
    // tivesse falhado, o cartão "Não enviada" sumia levando o texto junto.
    const emVoo = [envio({ apartirDe: "2026-09-03T09:00:00Z" })];
    const antiga = mensagem({ created_at: "2026-08-20T14:00:00Z" });
    expect(conciliarEnvios([antiga], emVoo, EU, "conversa-1")).toHaveLength(1);
  });

  it("sem o fio carregado, nada casa por conteúdo", () => {
    // apartirDe nulo significa que o compositor foi usado antes de o fio
    // carregar: não existe piso confiável, então espera o id da ação.
    const emVoo = [envio({ apartirDe: null })];
    expect(conciliarEnvios([mensagem()], emVoo, EU, "conversa-1")).toHaveLength(
      1,
    );
  });

  it("com o id real, o casamento é exato e ignora o conteúdo", () => {
    const real = mensagem({ body: "outra coisa qualquer" });
    const emVoo = [envio({ messageId: real.id, apartirDe: null })];
    expect(conciliarEnvios([real], emVoo, EU, "conversa-1")).toHaveLength(0);
  });

  it("com o id real e a linha ainda ausente, continua pendente", () => {
    const emVoo = [envio({ messageId: "id-que-nao-chegou" })];
    expect(conciliarEnvios([mensagem()], emVoo, EU, "conversa-1")).toHaveLength(
      1,
    );
  });

  it("sem envios em voo não faz trabalho nenhum", () => {
    expect(conciliarEnvios([mensagem()], [], EU, "conversa-1")).toEqual([]);
  });
});

describe("enviosDaConversa", () => {
  it("separa por conversa e preserva a ordem", () => {
    // A trava contra o defeito grave já visto neste módulo: o texto de um
    // paciente não pode aparecer na tela de outro.
    const a1 = envio({ conversationId: "a", corpo: "1" });
    const b1 = envio({ conversationId: "b", corpo: "2" });
    const a2 = envio({ conversationId: "a", corpo: "3" });
    expect(enviosDaConversa([a1, b1, a2], "a")).toEqual([a1, a2]);
    expect(enviosDaConversa([a1, b1, a2], "b")).toEqual([b1]);
  });
});
