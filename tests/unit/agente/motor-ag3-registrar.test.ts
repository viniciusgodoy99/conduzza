import { describe, expect, it } from "vitest";

import {
  carteirinhaValida,
  codigosCurtos,
  cpfValido,
  dataNoTextoDoPaciente,
  entradaDoRegistroDeDadosSchema,
  esconderCodigosCurtos,
  extrairCarteirinha,
  extrairCpf,
  falaDaCarteirinha,
  FERRAMENTA_REGISTRAR_DADOS,
  idadeNoDia,
  lerRespostaDoRegistro,
  nascimentoValido,
  nomeCompletoValido,
  nomeNoTextoDoPaciente,
  prepararRegistro,
  type MensagemDoPaciente,
} from "@/lib/agente/ferramentas/registrar-dados";
import { mascararNome } from "@/lib/agente/historico";
import { minimizarParaLlm } from "@/lib/domain/conformidade/minimizar";

// registrar_dados_do_paciente (AG3), a parte pura: o nome e a data vem do
// modelo e sao conferidos no que o paciente escreveu; o CPF e a carteirinha o
// servidor acha no texto ORIGINAL (o modelo so ve [cpf] e [numero]). Nada
// daqui devolve valor ao modelo. Nenhum teste fala com o banco nem com a
// OpenAI. CPFs de teste com digito verificador valido, gerados para o teste.

const CPF = "529.982.247-25";
const CPF_DIGITOS = "52998224725";
const OUTRO_CPF = "111.444.777-35";

/** A mensagem como o turno guarda: o mascarado pelo nome e o original. */
function msg(original: string, nomeDoContato: string | null = null): MensagemDoPaciente {
  return { mascarado: mascararNome(original, nomeDoContato), original };
}

describe("definição de registrar_dados_do_paciente", () => {
  it("é strict, exige todas as propriedades e bate com o Zod, sem travessão", () => {
    const parametros = FERRAMENTA_REGISTRAR_DADOS.parameters as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(FERRAMENTA_REGISTRAR_DADOS.strict).toBe(true);
    expect(parametros.additionalProperties).toBe(false);
    expect(Object.keys(parametros.properties).sort()).toEqual(
      Object.keys(entradaDoRegistroDeDadosSchema.shape).sort(),
    );
    expect([...parametros.required].sort()).toEqual(
      Object.keys(parametros.properties).sort(),
    );
    // O modelo nunca manda CPF nem carteirinha: so diz se vieram.
    expect(Object.keys(parametros.properties)).not.toContain("cpf");
    expect(Object.keys(parametros.properties)).not.toContain("carteirinha");
    expect(JSON.stringify(FERRAMENTA_REGISTRAR_DADOS)).not.toMatch(/[–—]/);
  });
});

describe("as regras de cada dado (o espelho do banco)", () => {
  it("CPF: 11 dígitos, não todos iguais, com os verificadores", () => {
    expect(cpfValido(CPF_DIGITOS)).toBe(true);
    expect(cpfValido("11144477735")).toBe(true);
    expect(cpfValido("52998224724")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
    expect(cpfValido("5299822472")).toBe(false);
  });

  it("nome, nascimento, carteirinha e idade", () => {
    expect(nomeCompletoValido("  Maria   da Silva ")).toBe("Maria da Silva");
    expect(nomeCompletoValido("Maria")).toBeNull();
    expect(nomeCompletoValido("Maria 2 Silva")).toBeNull();
    expect(nomeCompletoValido("Maria (Silva)")).toBeNull();
    expect(nascimentoValido("1985-03-12", "2026-10-20")).toBe(true);
    expect(nascimentoValido("2026-10-21", "2026-10-20")).toBe(false);
    expect(nascimentoValido("1899-12-31", "2026-10-20")).toBe(false);
    expect(nascimentoValido("1985-02-30", "2026-10-20")).toBe(false);
    expect(carteirinhaValida("0 123 4567 8901")).toBe("0 123 4567 8901");
    expect(carteirinhaValida("ABC-12")).toBeNull();
    expect(carteirinhaValida("ÁB1234")).toBeNull();
    expect(idadeNoDia("2008-10-21", "2026-10-20")).toBe(17);
    expect(idadeNoDia("2008-10-20", "2026-10-20")).toBe(18);
  });
});

describe("o nome como o paciente escreveu", () => {
  it("letra por letra, sem diferenciar caixa, acento e espaço; nunca inventado", () => {
    const mensagens = [msg("Meu nome é   josé da silva souza, quero marcar")];
    expect(nomeNoTextoDoPaciente("José da Silva Souza", mensagens)).toBe(
      "José da Silva Souza",
    );
    expect(nomeNoTextoDoPaciente("José Silva", mensagens)).toBeNull();
    expect(nomeNoTextoDoPaciente("José da Silva Souzaa", mensagens)).toBeNull();
    // So minusculas: vira "Nome da Silva", com a particula em minusculas.
    expect(nomeNoTextoDoPaciente("jose da silva souza", mensagens)).toBe(
      "José da Silva Souza",
    );
  });

  it("com a marca do nome do contato, vale o trecho ORIGINAL da mesma mensagem", () => {
    // O contato e "Maria Souza" no WhatsApp; ela escreve o nome completo.
    const mensagens = [
      msg("Sou Maria da Silva Souza, nascida em 12/03/1985", "Maria Souza"),
    ];
    expect(mensagens[0]?.mascarado).toBe(
      "Sou Fulano da Silva Souza, nascida em 12/03/1985",
    );
    expect(nomeNoTextoDoPaciente("Fulano da Silva Souza", mensagens)).toBe(
      "Maria da Silva Souza",
    );
    // "Fulana" (o modelo concordando com o genero) e a mesma marca.
    expect(nomeNoTextoDoPaciente("Fulana da Silva Souza", mensagens)).toBe(
      "Maria da Silva Souza",
    );
    // O modelo que tirou a marca do comeco: o nome volta com o trecho dela.
    expect(nomeNoTextoDoPaciente("da Silva Souza", mensagens)).toBe(
      "Maria da Silva Souza",
    );
  });

  it("a data escrita pelo paciente, em qualquer formato comum", () => {
    expect(dataNoTextoDoPaciente("1985-03-12", [msg("nasci em 12/03/1985")])).toBe(true);
    expect(dataNoTextoDoPaciente("1985-03-12", [msg("12.03.1985")])).toBe(true);
    expect(dataNoTextoDoPaciente("1985-03-12", [msg("12/3/85")])).toBe(true);
    expect(
      dataNoTextoDoPaciente("1985-03-12", [msg("12 de março de 1985")]),
    ).toBe(true);
    expect(dataNoTextoDoPaciente("1985-03-12", [msg("12/03")])).toBe(false);
    expect(dataNoTextoDoPaciente("1985-03-12", [msg("13/03/1985")])).toBe(false);
  });
});

describe("o CPF e a carteirinha do texto ORIGINAL", () => {
  it("o modelo vê [cpf] ou [numero]; o servidor acha o CPF e confere o dígito", () => {
    for (const escrito of [CPF, CPF_DIGITOS, "529 982 247 25"]) {
      const original = `meu cpf é ${escrito}`;
      expect(minimizarParaLlm(original)).not.toContain(CPF_DIGITOS.slice(0, 6));
      expect(extrairCpf([msg(original)]), escrito).toEqual({
        tipo: "achou",
        cpf: CPF_DIGITOS,
      });
    }
    expect(extrairCpf([msg("meu cpf é 529.982.247-24")])).toEqual({
      tipo: "invalido",
    });
    expect(extrairCpf([msg("não lembro o cpf")])).toEqual({
      tipo: "nao_encontrado",
    });
    expect(extrairCpf([msg(`${CPF} ou ${OUTRO_CPF}`)])).toEqual({
      tipo: "ambiguo",
    });
  });

  it("a carteirinha: o número escondido que não é o CPF; a curta com letras também", () => {
    const original = `cpf ${CPF} e a carteirinha 0 123 4567 8901 2345`;
    expect(minimizarParaLlm(original)).toBe("cpf [cpf] e a carteirinha [numero]");
    expect(extrairCarteirinha([msg(original)], CPF_DIGITOS)).toEqual({
      tipo: "achou",
      carteirinha: "0 123 4567 8901 2345",
    });
    expect(extrairCarteirinha([msg("minha carteirinha é ABC12345")], null)).toEqual({
      tipo: "achou",
      carteirinha: "ABC12345",
    });
    // Data e hora nunca sao carteirinha.
    expect(
      extrairCarteirinha([msg("quero dia 21/10/2026 às 14h30")], null),
    ).toEqual({ tipo: "nao_encontrada" });
    expect(
      extrairCarteirinha([msg("12345678901 e 98765432109876")], null),
    ).toEqual({ tipo: "ambigua" });
  });
});

describe("a carteirinha curta: o que a minimização deixa passar", () => {
  const esconder = (texto: string) => esconderCodigosCurtos(minimizarParaLlm(texto));

  it("esconde o código de 4 dígitos ou mais, com letras, ponto, hífen, barra ou espaço entre dígitos", () => {
    expect(esconder("minha carteirinha é 12345")).toBe("minha carteirinha é [numero]");
    expect(esconder("carteirinha ABC12345 ok")).toBe("carteirinha [numero] ok");
    expect(esconder("12.345-6")).toBe("[numero]");
    expect(esconder("123 456")).toBe("[numero]");
    expect(esconder("AB1234CD5678")).toBe("[numero]");
    expect(esconder("nº 98765.")).toBe("nº [numero].");
    // O que a minimizacao troca fica com o marcador dela.
    expect(esconder(`cpf ${CPF} e carteirinha 1234-5`)).toBe(
      "cpf [cpf] e carteirinha [numero]",
    );
  });

  it("deixa a data, a hora, o ano sozinho e o número com menos de 4 dígitos", () => {
    for (const texto of [
      "nasci em 12/03/1985 às 14h30",
      "12 de março de 1985",
      "nasci em 1985",
      "às 14:30 ou 10h",
      "21.10.2026",
      "R$ 150",
      "AB-12",
    ]) {
      expect(esconder(texto)).toBe(texto);
      expect(codigosCurtos(minimizarParaLlm(texto))).toEqual([]);
    }
  });

  it("fala da carteirinha: carteirinha, carteira, cartão e matrícula, com ou sem acento", () => {
    expect(falaDaCarteirinha("Minha CARTEIRINHA")).toBe(true);
    expect(falaDaCarteirinha("o cartão do plano")).toBe(true);
    expect(falaDaCarteirinha("Matrícula 123")).toBe(true);
    expect(falaDaCarteirinha("quero marcar uma consulta")).toBe(false);
  });

  it("o servidor acha a curta entre os códigos escondidos; mais de um candidato é ambígua, nunca escolhe", () => {
    expect(extrairCarteirinha([msg("carteirinha 12345")], null)).toEqual({
      tipo: "achou",
      carteirinha: "12345",
    });
    expect(extrairCarteirinha([msg(`cpf ${CPF} carteirinha AB1234`)], CPF_DIGITOS)).toEqual({
      tipo: "achou",
      carteirinha: "AB1234",
    });
    // O telefone junto: ambigua (antes, o telefone virava carteirinha).
    expect(
      extrairCarteirinha([msg("carteirinha 12345, telefone 85 99999-9999")], null),
    ).toEqual({ tipo: "ambigua" });
    // A data no formato aaaa-mm-dd (que a minimizacao esconde) nunca e carteirinha.
    expect(extrairCarteirinha([msg("nasci em 1985-03-12")], null)).toEqual({
      tipo: "nao_encontrada",
    });
    // O ano sozinho tambem nao.
    expect(extrairCarteirinha([msg("nasci em 1985")], null)).toEqual({
      tipo: "nao_encontrada",
    });
  });
});

describe("o preparo do registro", () => {
  const hoje = "2026-10-20";

  it("nome e data conferidos, o CPF do texto; problema de um campo não derruba os outros", () => {
    const pendentes = [msg(`Maria da Silva, 12/03/1985, cpf ${CPF}`)];
    const pronto = prepararRegistro({
      argumentos: {
        nome_completo: "Maria da Silva",
        data_nascimento: "1985-03-12",
        para_o_titular: true,
        campos_mascarados: ["cpf"],
      },
      doPaciente: pendentes,
      pendentes,
      hoje,
    });
    expect(pronto).toEqual({
      tipo: "pronto",
      dados: {
        paraOTitular: true,
        nomeCompleto: "Maria da Silva",
        dataNascimento: "1985-03-12",
        cpf: CPF_DIGITOS,
        carteirinha: null,
      },
      campos: ["nome_completo", "data_nascimento", "cpf"],
      problemas: {},
    });
    const comProblema = prepararRegistro({
      argumentos: {
        nome_completo: "Maria da Silva",
        data_nascimento: "1985-04-12",
        para_o_titular: true,
        campos_mascarados: ["cpf", "carteirinha"],
      },
      doPaciente: [msg("Maria da Silva, cpf 529.982.247-24")],
      pendentes: [msg("Maria da Silva, cpf 529.982.247-24")],
      hoje,
    });
    expect(comProblema).toMatchObject({
      tipo: "pronto",
      campos: ["nome_completo"],
      problemas: {
        data_nascimento: "nao_encontrado",
        cpf: "invalido",
        carteirinha: "nao_encontrado",
      },
    });
  });

  it("outra pessoa: só a marca; nada mandado: entrada inválida", () => {
    expect(
      prepararRegistro({
        argumentos: {
          nome_completo: "João Pedro",
          data_nascimento: null,
          para_o_titular: false,
          campos_mascarados: [],
        },
        doPaciente: [],
        pendentes: [],
        hoje,
      }),
    ).toEqual({ tipo: "outra_pessoa" });
    expect(
      prepararRegistro({
        argumentos: {
          nome_completo: null,
          data_nascimento: null,
          para_o_titular: true,
          campos_mascarados: [],
        },
        doPaciente: [],
        pendentes: [],
        hoje,
      }),
    ).toEqual({ tipo: "entrada_invalida" });
    expect(
      prepararRegistro({
        argumentos: { nome_completo: "x", cpf: CPF_DIGITOS },
        doPaciente: [],
        pendentes: [],
        hoje,
      }),
    ).toEqual({ tipo: "entrada_invalida" });
  });

  it("a resposta da RPC é lida sem confiar no formato (nunca com valor)", () => {
    expect(lerRespostaDoRegistro({ ok: true, dados_id: "d", faltam: ["cpf"] })).toEqual(
      { ok: true, faltam: ["cpf"] },
    );
    expect(
      lerRespostaDoRegistro({
        ok: false,
        motivo: "dados_invalidos",
        invalidos: ["nome_completo"],
      }),
    ).toEqual({ ok: false, motivo: "dados_invalidos", invalidos: ["nome_completo"] });
    for (const motivo of ["ia_desligada", "consulta_para_outra_pessoa", "menor_de_idade"]) {
      expect(lerRespostaDoRegistro({ ok: false, motivo, dados_id: "d" })).toEqual({
        ok: false,
        motivo,
      });
    }
    for (const ruim of [
      null,
      { ok: true },
      { ok: true, faltam: ["rg"] },
      { ok: false, motivo: "dados_invalidos" },
      { ok: false, motivo: "outro" },
    ]) {
      expect(lerRespostaDoRegistro(ruim), JSON.stringify(ruim)).toBeNull();
    }
  });
});
