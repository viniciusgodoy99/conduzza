import { describe, expect, it } from "vitest";

import {
  lerPoliticaDeEnvio,
  numeroPadraoDoTeste,
  numerosFixosDaPolitica,
  politicaNoUltimoUsado,
  situacaoDoNumero,
  telefoneDoNumero,
  temEscolhaDeNumero,
  tiposQueMudaram,
  type NumerosDasAutomaticas,
  type PoliticaDeEnvio,
} from "@/components/automacoes/numeros-de-envio";
import { WHATSAPP_CONNECTION_STATUS } from "@/lib/design/status";
import type { NumeroDaClinica } from "@/lib/queries/conversations";

// Calculos puros da tela de Automacoes com varios numeros (docs/07, Fase 4;
// escolha POR TIPO desde 29/09/2026): quando o cartao aparece, como as
// linhas cruas da politica viram a escolha de cada tipo, a situacao em 3
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
    cor: "azul",
    ...campos,
  };
}

const DOIS: NumeroDaClinica[] = [
  numero(),
  numero({ id: RECEPCAO, nome: "Recepção", principal: false }),
];

const TODOS_NO_ULTIMO: PoliticaDeEnvio = {
  confirmacao: null,
  pos_falta: null,
  followup: null,
  lista_espera: null,
  aviso_remarcacao: null,
};

describe("lerPoliticaDeEnvio", () => {
  it("sem linha, todo tipo vale o último usado", () => {
    expect(lerPoliticaDeEnvio([], DOIS)).toEqual(TODOS_NO_ULTIMO);
    expect(lerPoliticaDeEnvio(null, DOIS)).toEqual(TODOS_NO_ULTIMO);
    expect(politicaNoUltimoUsado()).toEqual(TODOS_NO_ULTIMO);
  });

  it("cada tipo lê a própria linha: confirmação fixa, follow-up no último usado", () => {
    expect(
      lerPoliticaDeEnvio(
        [
          { tipo: "confirmacao", modo: "fixo", conta_fixa_id: RECEPCAO },
          { tipo: "followup", modo: "ultimo_usado", conta_fixa_id: null },
          { tipo: "aviso_remarcacao", modo: "fixo", conta_fixa_id: PRINCIPAL },
        ],
        DOIS,
      ),
    ).toEqual({
      ...TODOS_NO_ULTIMO,
      confirmacao: RECEPCAO,
      aviso_remarcacao: PRINCIPAL,
    });
  });

  it("fixo apontando para número fora dos ativos vale o último usado, como no banco", () => {
    expect(
      lerPoliticaDeEnvio(
        [{ tipo: "pos_falta", modo: "fixo", conta_fixa_id: UNIDADE }],
        DOIS,
      ),
    ).toEqual(TODOS_NO_ULTIMO);
  });

  it("modo ou tipo desconhecido é ignorado", () => {
    expect(
      lerPoliticaDeEnvio(
        [
          { tipo: "confirmacao", modo: "outro", conta_fixa_id: RECEPCAO },
          { tipo: "reativacao", modo: "fixo", conta_fixa_id: RECEPCAO },
          null,
          "lixo",
        ],
        DOIS,
      ),
    ).toEqual(TODOS_NO_ULTIMO);
  });
});

describe("numerosFixosDaPolitica", () => {
  it("os números fixos de algum tipo, sem repetição", () => {
    expect(numerosFixosDaPolitica(TODOS_NO_ULTIMO)).toEqual([]);
    expect(
      numerosFixosDaPolitica({
        ...TODOS_NO_ULTIMO,
        confirmacao: RECEPCAO,
        lista_espera: RECEPCAO,
        aviso_remarcacao: PRINCIPAL,
      }).sort(),
    ).toEqual([PRINCIPAL, RECEPCAO].sort());
  });
});

describe("tiposQueMudaram", () => {
  it("só os tipos cuja escolha mudou, na ordem da tela", () => {
    const salva = { ...TODOS_NO_ULTIMO, followup: RECEPCAO };
    expect(tiposQueMudaram(salva, salva)).toEqual([]);
    expect(
      tiposQueMudaram(salva, {
        ...salva,
        aviso_remarcacao: PRINCIPAL,
        confirmacao: RECEPCAO,
        followup: null,
      }),
    ).toEqual(["confirmacao", "followup", "aviso_remarcacao"]);
  });
});

describe("temEscolhaDeNumero", () => {
  const politica = TODOS_NO_ULTIMO;

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
    confirmacaoFixa: string | null = null,
  ): NumerosDasAutomaticas {
    return {
      numeros,
      politica: { ...TODOS_NO_ULTIMO, confirmacao: confirmacaoFixa },
    };
  }

  it("no último usado, marca o principal", () => {
    expect(numeroPadraoDoTeste(dados(DOIS), "confirmacao")).toBe(PRINCIPAL);
  });

  it("com o tipo da régua fixo, marca o número fixo dele", () => {
    expect(numeroPadraoDoTeste(dados(DOIS, RECEPCAO), "confirmacao")).toBe(
      RECEPCAO,
    );
  });

  it("o fixo de OUTRO tipo não conta: o follow-up marca o principal", () => {
    expect(numeroPadraoDoTeste(dados(DOIS, RECEPCAO), "followup")).toBe(
      PRINCIPAL,
    );
    expect(numeroPadraoDoTeste(dados(DOIS, RECEPCAO), null)).toBe(PRINCIPAL);
  });

  it("o padrão desconectado cede ao primeiro conectado", () => {
    const numeros = [
      numero({ connection_status: "desconectado" }),
      numero({ id: RECEPCAO, nome: "Recepção", principal: false }),
    ];
    expect(numeroPadraoDoTeste(dados(numeros), "pos_falta")).toBe(RECEPCAO);
  });

  it("nenhum conectado, nada marcado", () => {
    const numeros = DOIS.map((n) => ({
      ...n,
      connection_status: "desconectado",
    }));
    expect(numeroPadraoDoTeste(dados(numeros), "confirmacao")).toBeNull();
  });
});
