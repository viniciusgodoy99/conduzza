import { describe, expect, it, vi } from "vitest";

// O compositor importa a Server Action de enviar arquivo; aqui so a logica
// pura da lista importa.
vi.mock("@/app/(app)/atendimento/actions", () => ({
  enviarArquivoAction: vi.fn(),
}));

import {
  chaveDaListaAberta,
  LISTA_INICIAL,
  proximoEstadoDaLista,
  type EstadoDaLista,
  type EventoDaLista,
} from "@/components/atendimento/composer";

// Quando a lista de mensagens padrao do compositor aparece (spec 1.11).
//
// O defeito corrigido aqui (revisao do CRM de 02/10/2026): a lista aberta
// pelo botao da barra sumia quando o foco saia do campo, mas VOLTAVA SOZINHA
// quando a recepcionista clicava de novo no campo. Com a lista aberta, o
// Enter ESCOLHE (nunca envia), entao o Enter que ela apertava para mandar o
// rascunho inseria a primeira mensagem padrao no meio do texto. O mesmo
// acontecia depois de clicar em Enviar com a lista aberta pelo botao.
//
// "Lista fechada" aqui e exatamente o que faz o Enter voltar a enviar: o
// onKeyDown do campo so entrega a tecla a lista quando chaveDaListaAberta
// devolve uma chave. O teclado no navegador fica no e2e
// tests/e2e/mensagens-padrao.spec.ts.

/** A chave do "/conf" digitado no comeco do campo (chaveDoGatilho). */
const BARRA_CONF = "0:conf";

function depois(...eventos: EventoDaLista[]): EstadoDaLista {
  return eventos.reduce(proximoEstadoDaLista, LISTA_INICIAL);
}

/** A lista que aparece, sem "/" sob o cursor (so o botao pode abrir). */
function semBarra(estado: EstadoDaLista): string | null {
  return chaveDaListaAberta(estado, { gatilho: null, disponivel: true });
}

/** A lista que aparece com o cursor logo depois de "/conf". */
function comBarra(estado: EstadoDaLista): string | null {
  return chaveDaListaAberta(estado, { gatilho: BARRA_CONF, disponivel: true });
}

describe("lista aberta pelo botão da barra", () => {
  it("abre com o foco no campo", () => {
    expect(
      semBarra(depois({ tipo: "focou" }, { tipo: "abriu_pelo_botao" })),
    ).not.toBeNull();
  });

  it("o foco sai do compositor e volta: a lista NÃO reaparece, e o Enter volta a enviar", () => {
    const aberta = depois({ tipo: "focou" }, { tipo: "abriu_pelo_botao" });
    const foraDoCampo = proximoEstadoDaLista(aberta, { tipo: "saiu" });
    expect(semBarra(foraDoCampo)).toBeNull();

    // Clicou de novo no campo (ou em "Responder" numa bolha, que foca o campo).
    const deVolta = proximoEstadoDaLista(foraDoCampo, { tipo: "focou" });
    expect(deVolta.focado).toBe(true);
    expect(semBarra(deVolta)).toBeNull();
  });

  it("só um novo toque no botão abre de novo", () => {
    const deVolta = depois(
      { tipo: "focou" },
      { tipo: "abriu_pelo_botao" },
      { tipo: "saiu" },
      { tipo: "focou" },
      { tipo: "abriu_pelo_botao" },
    );
    expect(semBarra(deVolta)).not.toBeNull();
  });

  it("pelo teclado: Tab até o botão (fora do formulário) e Enter nele abre a lista", () => {
    // O Tab para fora do formulario fecha tudo; o botao marca a lista e leva
    // o foco ao campo.
    const estado = depois(
      { tipo: "focou" },
      { tipo: "saiu" },
      { tipo: "abriu_pelo_botao" },
      { tipo: "focou" },
    );
    expect(semBarra(estado)).not.toBeNull();
  });

  it("depois de enviar, a lista não fica aberta sobre o campo vazio", () => {
    // O clique em Enviar mantem o foco dentro do formulario (Chrome) ou o
    // envio devolve o foco ao campo (Safari): nos dois, focado continua true.
    const enviado = depois(
      { tipo: "focou" },
      { tipo: "abriu_pelo_botao" },
      { tipo: "enviou" },
    );
    expect(enviado.focado).toBe(true);
    expect(semBarra(enviado)).toBeNull();
  });

  it("trocar para Nota interna e voltar não reabre a lista", () => {
    const estado = depois(
      { tipo: "focou" },
      { tipo: "abriu_pelo_botao" },
      { tipo: "trocou_de_aba" },
      { tipo: "focou" },
    );
    expect(semBarra(estado)).toBeNull();
  });

  it("digitar, escolher, Esc ou o botão de novo fecham a lista do botão", () => {
    const aberta = depois({ tipo: "focou" }, { tipo: "abriu_pelo_botao" });
    expect(
      semBarra(proximoEstadoDaLista(aberta, { tipo: "digitou" })),
    ).toBeNull();
    expect(
      semBarra(
        proximoEstadoDaLista(aberta, { tipo: "escolheu", seguinte: null }),
      ),
    ).toBeNull();
    expect(
      semBarra(proximoEstadoDaLista(aberta, { tipo: "fechou", gatilho: null })),
    ).toBeNull();
  });

  it("sem a lista disponível (nota interna, sem escrita), nada abre", () => {
    const aberta = depois({ tipo: "focou" }, { tipo: "abriu_pelo_botao" });
    expect(
      chaveDaListaAberta(aberta, { gatilho: null, disponivel: false }),
    ).toBeNull();
    expect(
      chaveDaListaAberta(aberta, { gatilho: BARRA_CONF, disponivel: false }),
    ).toBeNull();
  });
});

describe('lista aberta pelo "/"', () => {
  it('vale pelo cursor: com o foco de volta no mesmo "/conf", aparece de novo', () => {
    // Nao e o defeito: aqui a pessoa digitou o "/" e o cursor continua nele.
    const estado = depois(
      { tipo: "focou" },
      { tipo: "saiu" },
      { tipo: "focou" },
    );
    expect(comBarra(estado)).toBe(BARRA_CONF);
  });

  it("sem foco no compositor, não aparece", () => {
    expect(comBarra(depois({ tipo: "focou" }, { tipo: "saiu" }))).toBeNull();
  });

  it("o Esc fecha até o termo mudar, mesmo com o foco saindo e voltando", () => {
    const fechada = depois(
      { tipo: "focou" },
      { tipo: "fechou", gatilho: BARRA_CONF },
    );
    expect(comBarra(fechada)).toBeNull();
    const deVolta = depois(
      { tipo: "focou" },
      { tipo: "fechou", gatilho: BARRA_CONF },
      { tipo: "saiu" },
      { tipo: "focou" },
    );
    expect(comBarra(deVolta)).toBeNull();

    // O cursor no mesmo gatilho nao solta a trava; outro termo solta.
    const mesmo = proximoEstadoDaLista(fechada, {
      tipo: "moveu_cursor",
      gatilho: BARRA_CONF,
    });
    expect(comBarra(mesmo)).toBeNull();
    const outro = proximoEstadoDaLista(fechada, {
      tipo: "moveu_cursor",
      gatilho: "0:confi",
    });
    expect(
      chaveDaListaAberta(outro, { gatilho: "0:confi", disponivel: true }),
    ).toBe("0:confi");
  });

  it('a mensagem escolhida que termina em "/termo" não reabre a lista em cima dela', () => {
    const estado = depois(
      { tipo: "focou" },
      { tipo: "escolheu", seguinte: "12:fim" },
    );
    expect(
      chaveDaListaAberta(estado, { gatilho: "12:fim", disponivel: true }),
    ).toBeNull();
  });

  it('o botão nunca colide com a chave de um "/"', () => {
    const estado = depois({ tipo: "focou" }, { tipo: "abriu_pelo_botao" });
    expect(semBarra(estado)).not.toMatch(/^\d+:/);
  });
});

describe("estado sem mudança", () => {
  it("devolve o mesmo objeto (o React não re-renderiza a cada seleção)", () => {
    const focado = depois({ tipo: "focou" });
    expect(proximoEstadoDaLista(focado, { tipo: "focou" })).toBe(focado);
    expect(
      proximoEstadoDaLista(focado, { tipo: "moveu_cursor", gatilho: null }),
    ).toBe(focado);
    expect(proximoEstadoDaLista(focado, { tipo: "digitou" })).toBe(focado);
  });
});
