import { describe, expect, it } from "vitest";

import {
  aplicarLinhaDoNumero,
  aplicarVerificacao,
  assinaturaDaConexao,
  lerVerificacao,
  numerosVigiados,
  textoDaFaixa,
  type NumeroDaFaixa,
} from "@/lib/domain/conexao-dos-numeros";

// Faixa de WhatsApp desconectado e recarregar do Inbox com varios numeros por
// clinica (docs/07, Fase 2, decisao D6).

const PRINCIPAL = "11111111-1111-4111-8111-111111111111";
const RECEPCAO = "22222222-2222-4222-8222-222222222222";
const NOVO = "33333333-3333-4333-8333-333333333333";

function numero(campos: Partial<NumeroDaFaixa> = {}): NumeroDaFaixa {
  return {
    id: PRINCIPAL,
    nome: "Número principal",
    connection_status: "conectado",
    principal: true,
    connected_at: "2026-09-20T12:00:00.000Z",
    ...campos,
  };
}

describe("numerosVigiados (D6)", () => {
  it("considera o principal mesmo sem nunca ter conectado", () => {
    const lista = [numero({ connected_at: null })];
    expect(numerosVigiados(lista).map((n) => n.id)).toEqual([PRINCIPAL]);
  });

  it("deixa de fora o numero que nunca conectou e nao e o principal", () => {
    const lista = [
      numero(),
      numero({
        id: NOVO,
        nome: "Novo",
        principal: false,
        connected_at: null,
        connection_status: "desconectado",
      }),
    ];
    expect(numerosVigiados(lista).map((n) => n.id)).toEqual([PRINCIPAL]);
  });
});

describe("textoDaFaixa", () => {
  it("sem numero, sem faixa", () => {
    expect(textoDaFaixa([])).toBeNull();
  });

  it("com um numero conectado, sem faixa", () => {
    expect(textoDaFaixa([numero()])).toBeNull();
  });

  it("com um numero desconectado, o texto de sempre", () => {
    expect(
      textoDaFaixa([numero({ connection_status: "desconectado" })]),
    ).toEqual({
      titulo: "WhatsApp desconectado",
      detalhe: "os pacientes não estão sendo atendidos",
    });
  });

  it("aguardando QR tambem acende a faixa, como antes", () => {
    expect(
      textoDaFaixa([numero({ connection_status: "aguardando_qr" })])?.titulo,
    ).toBe("WhatsApp desconectado");
  });

  it("com varios numeros, nomeia o que caiu", () => {
    const lista = [
      numero(),
      numero({
        id: RECEPCAO,
        nome: "Recepção",
        principal: false,
        connection_status: "desconectado",
      }),
    ];
    expect(textoDaFaixa(lista)).toEqual({
      titulo: "WhatsApp Recepção desconectado",
      detalhe: "os pacientes deste número não estão sendo atendidos",
    });
  });

  it("com dois caidos, conta", () => {
    const lista = [
      numero({ connection_status: "desconectado" }),
      numero({
        id: RECEPCAO,
        nome: "Recepção",
        principal: false,
        connection_status: "desconectado",
      }),
    ];
    expect(textoDaFaixa(lista)?.titulo).toBe("2 números desconectados");
  });

  it("numero novo que nunca conectou nao acende a faixa", () => {
    const lista = [
      numero(),
      numero({
        id: NOVO,
        nome: "Novo",
        principal: false,
        connected_at: null,
        connection_status: "aguardando_qr",
      }),
    ];
    expect(textoDaFaixa(lista)).toBeNull();
  });

  it("nenhum texto tem travessao", () => {
    const lista = [
      numero({ connection_status: "desconectado" }),
      numero({
        id: RECEPCAO,
        nome: "Recepção",
        principal: false,
        connection_status: "desconectado",
      }),
    ];
    for (const caso of [
      lista,
      lista.slice(0, 1),
      [lista[0]!, numero({ id: RECEPCAO, principal: false, nome: "Recepção" })],
    ]) {
      const texto = textoDaFaixa(caso);
      expect(`${texto?.titulo} ${texto?.detalhe}`).not.toContain(
        String.fromCharCode(0x2014),
      );
    }
  });
});

describe("aplicarLinhaDoNumero", () => {
  it("devolve a MESMA lista quando so o slot de envio mudou", () => {
    const lista = [numero()];
    const depois = aplicarLinhaDoNumero(lista, {
      id: PRINCIPAL,
      nome: "Número principal",
      connection_status: "conectado",
      principal: true,
      connected_at: "2026-09-20T12:00:00.000Z",
      removido_em: null,
    });
    expect(depois).toBe(lista);
  });

  it("aplica o status pela linha (id), sem mexer nos outros numeros", () => {
    const lista = [
      numero(),
      numero({ id: RECEPCAO, nome: "Recepção", principal: false }),
    ];
    const depois = aplicarLinhaDoNumero(lista, {
      id: RECEPCAO,
      connection_status: "desconectado",
    });
    expect(depois.map((n) => [n.id, n.connection_status])).toEqual([
      [PRINCIPAL, "conectado"],
      [RECEPCAO, "desconectado"],
    ]);
  });

  it("tira da lista o numero removido", () => {
    const lista = [
      numero(),
      numero({ id: RECEPCAO, nome: "Recepção", principal: false }),
    ];
    const depois = aplicarLinhaDoNumero(lista, {
      id: RECEPCAO,
      connection_status: "desconectado",
      removido_em: "2026-09-25T12:00:00.000Z",
    });
    expect(depois.map((n) => n.id)).toEqual([PRINCIPAL]);
  });

  it("acrescenta numero novo quando a linha traz nome e status", () => {
    const depois = aplicarLinhaDoNumero([numero()], {
      id: NOVO,
      nome: "Novo",
      connection_status: "aguardando_qr",
      principal: false,
      connected_at: null,
      removido_em: null,
    });
    expect(depois.map((n) => n.id)).toEqual([PRINCIPAL, NOVO]);
  });

  it("ignora numero desconhecido sem nome (a verificacao so traz status)", () => {
    const lista = [numero()];
    expect(
      aplicarLinhaDoNumero(lista, { id: NOVO, connection_status: "conectado" }),
    ).toBe(lista);
  });
});

describe("assinaturaDaConexao", () => {
  it("muda com o status e com a remocao, e nao com o resto da linha", () => {
    const base = { id: PRINCIPAL, connection_status: "conectado" };
    expect(assinaturaDaConexao(base)).toBe(
      assinaturaDaConexao({ ...base, nome: "Outro nome" }),
    );
    expect(assinaturaDaConexao(base)).not.toBe(
      assinaturaDaConexao({ ...base, connection_status: "desconectado" }),
    );
    expect(assinaturaDaConexao(base)).not.toBe(
      assinaturaDaConexao({ ...base, removido_em: "2026-09-25T12:00:00Z" }),
    );
  });

  it("linha sem status nao tem assinatura", () => {
    expect(assinaturaDaConexao({ id: PRINCIPAL })).toBeNull();
  });
});

describe("lerVerificacao e aplicarVerificacao", () => {
  it("le a lista de numeros verificados", () => {
    const lida = lerVerificacao({
      numeros: [
        { id: PRINCIPAL, status: "conectado" },
        { id: RECEPCAO, connection_status: "desconectado" },
        { id: 7, status: "conectado" },
      ],
    });
    expect(lida.erro).toBeNull();
    expect(lida.linhas).toEqual([
      { id: PRINCIPAL, connection_status: "conectado" },
      { id: RECEPCAO, connection_status: "desconectado" },
    ]);
    expect(lida.statusUnico).toBeUndefined();
  });

  it("le a ChecagemDeConexao da Fase 2: a lista vale, o status do principal nao sobrescreve", () => {
    const lista = [
      numero({ connection_status: "desconectado" }),
      numero({
        id: RECEPCAO,
        nome: "Recepção",
        principal: false,
        connection_status: "desconectado",
      }),
    ];
    const lida = lerVerificacao({
      status: "conectado",
      numeros: [
        {
          id: PRINCIPAL,
          nome: "Número principal",
          principal: true,
          connection_status: "conectado",
        },
        {
          id: RECEPCAO,
          nome: "Recepção",
          principal: false,
          connection_status: "desconectado",
        },
        {
          id: NOVO,
          nome: "Novo",
          principal: false,
          connection_status: "aguardando_qr",
        },
      ],
    });
    expect(lida.statusUnico).toBeUndefined();
    const depois = aplicarVerificacao(lista, lida);
    expect(depois.map((n) => [n.id, n.connection_status])).toEqual([
      [PRINCIPAL, "conectado"],
      [RECEPCAO, "desconectado"],
      [NOVO, "aguardando_qr"],
    ]);
    expect(textoDaFaixa(depois)?.titulo).toBe("WhatsApp Recepção desconectado");
  });

  it("aceita a resposta que ja e a propria lista", () => {
    const lista = [
      numero(),
      numero({ id: RECEPCAO, nome: "Recepção", principal: false }),
    ];
    const lida = lerVerificacao([{ id: RECEPCAO, status: "desconectado" }]);
    expect(
      aplicarVerificacao(lista, lida).map((n) => n.connection_status),
    ).toEqual(["conectado", "desconectado"]);
  });

  it("aceita a forma antiga (status unico), que vale para o principal", () => {
    const lista = [numero({ connection_status: "desconectado" })];
    const lida = lerVerificacao({ status: "conectado" });
    expect(lida.statusUnico).toBe("conectado");
    expect(aplicarVerificacao(lista, lida)[0]?.connection_status).toBe(
      "conectado",
    );
  });

  it("devolve o erro da acao", () => {
    expect(
      lerVerificacao({ status: null, error: "Sessão expirada." }).erro,
    ).toBe("Sessão expirada.");
  });

  it("resposta sem forma conhecida nao quebra nem muda nada", () => {
    const lista = [numero()];
    for (const resposta of [null, undefined, 42, "x", { outra: true }]) {
      expect(aplicarVerificacao(lista, lerVerificacao(resposta))).toBe(lista);
    }
  });
});
