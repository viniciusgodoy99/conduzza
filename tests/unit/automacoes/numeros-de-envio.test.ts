import { describe, expect, it } from "vitest";

import {
  lerPoliticaDeEnvio,
  numeroPadraoDoTeste,
  situacaoDoNumero,
  telefoneDoNumero,
  temEscolhaDeNumero,
  type NumerosDasAutomaticas,
} from "@/components/automacoes/numeros-de-envio";
import { WHATSAPP_CONNECTION_STATUS } from "@/lib/design/status";
import type { NumeroDaClinica } from "@/lib/queries/conversations";

// Calculos puros da tela de Automacoes com varios numeros (docs/07, Fase 4):
// quando o cartao aparece, como a politica crua e lida, a situacao em 3
// camadas, o telefone exibido e o numero que o dialogo de teste ja marca.

const PRINCIPAL = "0a0a0a0a-0000-4000-8000-00000000000a";
const RECEPCAO = "0b0b0b0b-0000-4000-8000-00000000000b";
const UNIDADE = "0c0c0c0c-0000-4000-8000-00000000000c";

function numero(campos: Partial<NumeroDaClinica> = {}): NumeroDaClinica {
  return {
    id: PRINCIPAL,
    nome: "Número principal",
    display_phone: "5584911110000",
    connection_status: "conectado",
    principal: true,
    connected_at: "2026-09-01T12:00:00Z",
    ...campos,
  };
}

const DOIS: NumeroDaClinica[] = [
  numero(),
  numero({ id: RECEPCAO, nome: "Recepção", principal: false }),
];

describe("lerPoliticaDeEnvio", () => {
  it("sem linha vale o último usado", () => {
    expect(lerPoliticaDeEnvio(null, DOIS)).toEqual({
      modo: "ultimo_usado",
      contaFixaId: null,
    });
  });

  it("fixo com número ativo guarda o número", () => {
    expect(
      lerPoliticaDeEnvio({ modo: "fixo", conta_fixa_id: RECEPCAO }, DOIS),
    ).toEqual({ modo: "fixo", contaFixaId: RECEPCAO });
  });

  it("fixo apontando para número fora dos ativos fica fixo sem número", () => {
    expect(
      lerPoliticaDeEnvio({ modo: "fixo", conta_fixa_id: UNIDADE }, DOIS),
    ).toEqual({ modo: "fixo", contaFixaId: null });
  });

  it("modo desconhecido cai no último usado", () => {
    expect(
      lerPoliticaDeEnvio({ modo: "outro", conta_fixa_id: RECEPCAO }, DOIS),
    ).toEqual({ modo: "ultimo_usado", contaFixaId: null });
  });
});

describe("temEscolhaDeNumero", () => {
  const politica = { modo: "ultimo_usado" as const, contaFixaId: null };

  it("só com mais de um número ativo", () => {
    expect(temEscolhaDeNumero({ numeros: DOIS, politica })).toBe(true);
    expect(temEscolhaDeNumero({ numeros: [numero()], politica })).toBe(false);
    expect(temEscolhaDeNumero({ numeros: [], politica })).toBe(false);
  });

  it("leitura que falhou não abre escolha", () => {
    expect(temEscolhaDeNumero(null)).toBe(false);
    expect(temEscolhaDeNumero(undefined)).toBe(false);
  });
});

describe("situacaoDoNumero", () => {
  it("usa o mapa de 3 camadas do WhatsApp", () => {
    expect(situacaoDoNumero("conectado")).toBe(
      WHATSAPP_CONNECTION_STATUS.conectado,
    );
    expect(situacaoDoNumero("aguardando_qr")).toBe(
      WHATSAPP_CONNECTION_STATUS.aguardando_qr,
    );
  });

  it("valor desconhecido nunca promete conexão", () => {
    expect(situacaoDoNumero("qualquer")).toBe(
      WHATSAPP_CONNECTION_STATUS.desconectado,
    );
    expect(situacaoDoNumero("toString")).toBe(
      WHATSAPP_CONNECTION_STATUS.desconectado,
    );
  });
});

describe("telefoneDoNumero", () => {
  it("formata o telefone pareado", () => {
    expect(telefoneDoNumero("5584911110000")).toBe("(84) 91111-0000");
    expect(telefoneDoNumero("+55 84 92222-0000")).toBe("(84) 92222-0000");
  });

  it("nome de perfil guardado no lugar do telefone não aparece", () => {
    expect(telefoneDoNumero("Clínica Sorriso")).toBeNull();
    expect(telefoneDoNumero(null)).toBeNull();
  });
});

describe("numeroPadraoDoTeste", () => {
  function dados(
    numeros: NumeroDaClinica[],
    contaFixaId: string | null = null,
  ): NumerosDasAutomaticas {
    return {
      numeros,
      politica: contaFixaId
        ? { modo: "fixo", contaFixaId }
        : { modo: "ultimo_usado", contaFixaId: null },
    };
  }

  it("no último usado, marca o principal", () => {
    expect(numeroPadraoDoTeste(dados(DOIS))).toBe(PRINCIPAL);
  });

  it("no modo fixo, marca o número fixo", () => {
    expect(numeroPadraoDoTeste(dados(DOIS, RECEPCAO))).toBe(RECEPCAO);
  });

  it("o padrão desconectado cede ao primeiro conectado", () => {
    const numeros = [
      numero({ connection_status: "desconectado" }),
      numero({ id: RECEPCAO, nome: "Recepção", principal: false }),
    ];
    expect(numeroPadraoDoTeste(dados(numeros))).toBe(RECEPCAO);
  });

  it("nenhum conectado, nada marcado", () => {
    const numeros = DOIS.map((n) => ({
      ...n,
      connection_status: "desconectado",
    }));
    expect(numeroPadraoDoTeste(dados(numeros))).toBeNull();
  });
});
