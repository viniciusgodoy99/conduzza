import { describe, expect, it } from "vitest";

import {
  aplicarLinhaDoNumero,
  aplicarVerificacao,
  assinaturaDaConexao,
  avisoDaVerificacao,
  lerVerificacao,
  numerosParaContar,
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
    // Fase 4 (docs/07): a faixa NOMEIA os que cairam (ate 3).
    expect(textoDaFaixa(lista)?.titulo).toBe(
      "WhatsApp Número principal e Recepção desconectados",
    );
  });

  it("com mais de 3 caidos, conta em vez de nomear", () => {
    const lista = ["A", "B", "C", "D"].map((nome, indice) =>
      numero({
        id: `0000000${indice}-0000-4000-8000-000000000000`,
        nome,
        principal: indice === 0,
        connection_status: "desconectado",
      }),
    );
    expect(textoDaFaixa(lista)?.titulo).toBe("4 números desconectados");
  });

  it("com tres caidos, nomeia na forma falada", () => {
    const lista = ["Recepção", "Centro", "Sul"].map((nome, indice) =>
      numero({
        id: `0000000${indice}-0000-4000-8000-000000000000`,
        nome,
        principal: indice === 0,
        connection_status: "desconectado",
      }),
    );
    expect(textoDaFaixa(lista)?.titulo).toBe(
      "WhatsApp Recepção, Centro e Sul desconectados",
    );
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
      const texto = textoDaFaixa(caso, { [PRINCIPAL]: 2, [RECEPCAO]: 1 });
      expect(`${texto?.titulo} ${texto?.detalhe}`).not.toContain(
        String.fromCharCode(0x2014),
      );
    }
  });
});

describe("mensagens automaticas esperando na faixa (Fase 4)", () => {
  const recepcaoCaida = numero({
    id: RECEPCAO,
    nome: "Recepção",
    principal: false,
    connection_status: "desconectado",
  });

  it("com um numero so, o texto de sempre, mesmo com contagem", () => {
    expect(
      textoDaFaixa([numero({ connection_status: "desconectado" })], {
        [PRINCIPAL]: 7,
      }),
    ).toEqual({
      titulo: "WhatsApp desconectado",
      detalhe: "os pacientes não estão sendo atendidos",
    });
  });

  it("nomeia o numero e diz quantas esperam a reconexao", () => {
    expect(textoDaFaixa([numero(), recepcaoCaida], { [RECEPCAO]: 3 })).toEqual({
      titulo: "WhatsApp Recepção desconectado",
      detalhe:
        "os pacientes deste número não estão sendo atendidos e 3 mensagens automáticas esperam a reconexão",
    });
  });

  it("uma mensagem so, no singular", () => {
    expect(
      textoDaFaixa([numero(), recepcaoCaida], { [RECEPCAO]: 1 })?.detalhe,
    ).toBe(
      "os pacientes deste número não estão sendo atendidos e 1 mensagem automática espera a reconexão",
    );
  });

  it("zero, ou sem contagem, nao fala da fila", () => {
    const esperado = "os pacientes deste número não estão sendo atendidos";
    expect(
      textoDaFaixa([numero(), recepcaoCaida], { [RECEPCAO]: 0 })?.detalhe,
    ).toBe(esperado);
    expect(textoDaFaixa([numero(), recepcaoCaida])?.detalhe).toBe(esperado);
  });

  it("so conta o que caiu: a contagem do numero conectado nao entra", () => {
    expect(
      textoDaFaixa([numero(), recepcaoCaida], {
        [PRINCIPAL]: 9,
        [RECEPCAO]: 2,
      })?.detalhe,
    ).toContain(" e 2 mensagens automáticas esperam a reconexão");
  });

  it("com dois caidos, soma; sem a contagem de um deles, nao afirma total", () => {
    const lista = [
      numero({ connection_status: "desconectado" }),
      recepcaoCaida,
    ];
    expect(
      textoDaFaixa(lista, { [PRINCIPAL]: 2, [RECEPCAO]: 3 })?.detalhe,
    ).toBe(
      "os pacientes destes números não estão sendo atendidos e 5 mensagens automáticas esperam a reconexão",
    );
    expect(textoDaFaixa(lista, { [PRINCIPAL]: 2 })?.detalhe).toBe(
      "os pacientes destes números não estão sendo atendidos",
    );
  });
});

describe("numerosParaContar", () => {
  it("com um numero so, ninguem consulta a fila", () => {
    expect(
      numerosParaContar([numero({ connection_status: "desconectado" })]),
    ).toEqual([]);
  });

  it("com varios, so os vigiados que estao fora do ar", () => {
    const lista = [
      numero(),
      numero({
        id: RECEPCAO,
        nome: "Recepção",
        principal: false,
        connection_status: "desconectado",
      }),
      // Nunca conectou: nao e vigiado (D6), nao conta.
      numero({
        id: NOVO,
        nome: "Novo",
        principal: false,
        connected_at: null,
        connection_status: "desconectado",
      }),
    ];
    expect(numerosParaContar(lista)).toEqual([RECEPCAO]);
  });

  it("tudo conectado: nada a contar", () => {
    expect(
      numerosParaContar([
        numero(),
        numero({ id: RECEPCAO, nome: "Recepção", principal: false }),
      ]),
    ).toEqual([]);
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

// O motivo da recusa do celular no "Verificar conexao" (continuacao do
// achado M[0] da revisao das Fases 3 e 4): vai no complemento do aviso, e
// nao no texto da faixa.
describe("motivo da recusa na verificacao", () => {
  const OUTRA_CONTA =
    "Este número já está conectado em outra conta do Conduzza. Fale com o suporte.";
  // Pelo codigo, para o caractere nao aparecer escrito no fonte.
  const TRAVESSAO = String.fromCharCode(0x2014);

  it("lerVerificacao le o motivo de cada numero, so quando e texto", () => {
    const lida = lerVerificacao({
      numeros: [
        {
          id: PRINCIPAL,
          connection_status: "desconectado",
          motivo: OUTRA_CONTA,
        },
        { id: RECEPCAO, connection_status: "desconectado", motivo: "" },
        { id: NOVO, connection_status: "desconectado", motivo: 7 },
      ],
    });
    expect(lida.linhas.map((linha) => linha.motivo)).toEqual([
      OUTRA_CONTA,
      undefined,
      undefined,
    ]);
  });

  it("um numero so: o motivo vai como veio, no complemento do aviso", () => {
    const lista = [numero({ connection_status: "desconectado" })];
    const aviso = avisoDaVerificacao(
      lista,
      lerVerificacao({
        status: "desconectado",
        numeros: [
          {
            id: PRINCIPAL,
            connection_status: "desconectado",
            motivo: OUTRA_CONTA,
          },
        ],
      }),
    );
    expect(aviso).toEqual({
      mensagem: "Ainda desconectado. Abra Configurações para reconectar.",
      motivo: OUTRA_CONTA,
    });
    // A faixa continua curta: o motivo nao entra no texto dela.
    expect(JSON.stringify(textoDaFaixa(lista))).not.toContain(OUTRA_CONTA);
  });

  it("varios numeros: cada motivo leva o nome do numero na frente", () => {
    const lista = [
      numero(),
      numero({ id: RECEPCAO, nome: "Recepção", principal: false }),
      numero({ id: NOVO, nome: "Centro", principal: false }),
    ];
    const aviso = avisoDaVerificacao(
      lista,
      lerVerificacao({
        numeros: [
          { id: PRINCIPAL, connection_status: "conectado" },
          {
            id: RECEPCAO,
            connection_status: "desconectado",
            motivo: "Este número já está conectado como Centro.",
          },
          { id: NOVO, connection_status: "desconectado" },
        ],
      }),
    );
    expect(aviso).toEqual({
      mensagem:
        "WhatsApp Recepção e Centro desconectados. Abra Configurações para reconectar.",
      motivo: "Recepção: Este número já está conectado como Centro.",
    });
    expect(JSON.stringify(aviso)).not.toContain(TRAVESSAO);
  });

  it("sem motivo, o aviso e o de antes", () => {
    const lista = [numero({ connection_status: "desconectado" })];
    expect(
      avisoDaVerificacao(lista, lerVerificacao({ status: "desconectado" })),
    ).toEqual({
      mensagem: "Ainda desconectado. Abra Configurações para reconectar.",
      motivo: null,
    });
  });

  it("numero que a faixa nao nomeia (nunca conectou e nao e o principal) nao entra no motivo", () => {
    const lista = [
      numero({ connection_status: "desconectado" }),
      numero({
        id: NOVO,
        nome: "Novo",
        principal: false,
        connected_at: null,
      }),
    ];
    const aviso = avisoDaVerificacao(
      lista,
      lerVerificacao({
        numeros: [
          { id: PRINCIPAL, connection_status: "desconectado" },
          {
            id: NOVO,
            connection_status: "desconectado",
            motivo: OUTRA_CONTA,
          },
        ],
      }),
    );
    expect(aviso?.mensagem).toBe(
      "WhatsApp Número principal desconectado. Abra Configurações para reconectar.",
    );
    expect(aviso?.motivo).toBeNull();
  });

  it("a verificacao que apaga a faixa nao abre aviso nenhum", () => {
    const lista = [numero({ connection_status: "desconectado" })];
    expect(
      avisoDaVerificacao(
        lista,
        lerVerificacao({
          numeros: [{ id: PRINCIPAL, connection_status: "conectado" }],
        }),
      ),
    ).toBeNull();
  });
});
