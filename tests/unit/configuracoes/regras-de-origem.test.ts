import { describe, expect, it } from "vitest";

import { extrairToken } from "@/lib/domain/attribution";
import { METODO_LABELS, rotuloDoMetodo } from "@/lib/domain/leads-ui";
import { FRASE_PADRAO } from "@/lib/domain/rastreio-do-site";
import {
  avisoDasPalavrasRepetidas,
  avisosDaMensagem,
  campoDoProblema,
  camposDaRegra,
  contarCaracteres,
  ERRO_DA_MENSAGEM_CURTA,
  ERRO_SEM_JEITO_DE_RECONHECER,
  formularioDaOrigemSchema,
  frasesDoBotaoDoSite,
  fraseDoTeste,
  jeitosDeReconhecer,
  LIMITE_DE_ORIGENS_ATIVAS,
  linkDoWhatsApp,
  mensagemComTamanhoBom,
  numerosParaOLink,
  origemComAMesmaMensagem,
  palavraChaveValida,
  palavrasDoTexto,
  palavrasEmOutraOrigem,
  recusaDaMensagemRepetida,
  recusaDoBancoNaOrigem,
  recusaDoLimite,
  regraDaLinha,
  regrasQueAIngestaoUsa,
  salvarOrigemSchema,
  testarMensagem,
  textoDoCanalDaRegra,
  textoDoLink,
  textoDoReconhecimento,
  valoresDaRegra,
  VALORES_DE_UMA_ORIGEM_NOVA,
  type RegraDeOrigem,
  type ValoresDaOrigem,
} from "@/lib/domain/regras-de-origem";

// Regras puras da aba "Origem dos leads" (onda 5, item 17; contrato A.2 a
// A.4): o schema do formulario e da action (o mesmo), as travas da P17-4
// (mensagem pronta com 3 palavras e 15 caracteres, palavra-chave com 4), os
// conflitos com a normalizacao da ingestao, o link para a bio, os avisos, o
// "Testar uma mensagem" e a traducao das recusas do banco. Nenhum texto com
// travessao.

const MENSAGEM =
  "Olá! Vi o perfil da clínica no Instagram e quero agendar uma avaliação.";

function origem(campos: Partial<RegraDeOrigem> = {}): RegraDeOrigem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nome: "Link da bio",
    codigo: "K7Q2MX",
    canal: "redes_sociais",
    origem: "Instagram",
    detalhe: "Bio",
    campanha: null,
    mensagem: MENSAGEM,
    palavrasChave: [],
    ativa: true,
    ...campos,
  };
}

function valores(campos: Partial<ValoresDaOrigem> = {}): ValoresDaOrigem {
  return { ...VALORES_DE_UMA_ORIGEM_NOVA, nome: "Link da bio", ...campos };
}

/** As mensagens de erro do schema, por campo. */
function errosDe(entrada: unknown): Record<string, string[]> {
  const resultado = formularioDaOrigemSchema.safeParse(entrada);
  if (resultado.success) {
    return {};
  }
  const erros: Record<string, string[]> = {};
  for (const problema of resultado.error.issues) {
    const campo = String(problema.path[0] ?? "");
    (erros[campo] ??= []).push(problema.message);
  }
  return erros;
}

describe("o método no lead se chama Mensagem pronta do link (P17-2)", () => {
  it("rótulo novo, a chave do banco segue mensagem_padrao", () => {
    expect(METODO_LABELS.mensagem_padrao).toBe("Mensagem pronta do link");
    expect(rotuloDoMetodo("mensagem_padrao")).toBe("Mensagem pronta do link");
    expect(Object.values(METODO_LABELS)).not.toContain(
      "Mensagem padrão do anúncio",
    );
  });
});

describe("schema da origem (formulário e Server Action)", () => {
  it("a origem nova nasce com o código no link ligado (P17-3)", () => {
    expect(VALORES_DE_UMA_ORIGEM_NOVA.com_codigo).toBe(true);
    expect(errosDe(valores())).toEqual({});
  });

  it("nome de 2 a 120 caracteres, sem quebra de linha", () => {
    expect(errosDe(valores({ nome: "a" })).nome).toBeDefined();
    expect(errosDe(valores({ nome: "x".repeat(121) })).nome).toBeDefined();
    expect(errosDe(valores({ nome: "Link\nda bio" })).nome).toBeDefined();
    expect(errosDe(valores({ nome: "Bi" })).nome).toBeUndefined();
  });

  it("origem, detalhe e campanha: opcionais, até 120, sem quebra de linha", () => {
    expect(errosDe(valores({ origem: "", detalhe: "", campanha: "" }))).toEqual(
      {},
    );
    expect(errosDe(valores({ origem: "x".repeat(121) })).origem).toBeDefined();
    expect(
      errosDe(valores({ campanha: "Bio\noutubro" })).campanha,
    ).toBeDefined();
  });

  it("canal só entre os 8 de sempre", () => {
    expect(errosDe(valores({ canal: "tiktok" as never })).canal).toBeDefined();
  });

  it("mensagem pronta: pelo menos 3 palavras e 15 caracteres depois de normalizar (P17-4)", () => {
    for (const curta of ["Olá", "Bom dia", "Oi, tudo bem", "Quero agendar"]) {
      expect(errosDe(valores({ mensagem: curta })).mensagem).toEqual([
        ERRO_DA_MENSAGEM_CURTA,
      ]);
      expect(mensagemComTamanhoBom(curta)).toBe(false);
    }
    // 15 caracteres, mas 2 palavras.
    expect(mensagemComTamanhoBom("Agendamentos avaliacao")).toBe(false);
    // 3 palavras, mas 14 caracteres.
    expect(mensagemComTamanhoBom("Oi bom diaaaaa")).toBe(false);
    expect(mensagemComTamanhoBom("Oi, bom diaaaaa")).toBe(true);
    expect(errosDe(valores({ mensagem: MENSAGEM }))).toEqual({});
  });

  it("os invisíveis não contam para o tamanho da mensagem", () => {
    const invisiveis = String.fromCodePoint(0x200b).repeat(40);
    expect(mensagemComTamanhoBom(`Bom ${invisiveis} dia`)).toBe(false);
  });

  it("mensagem até 1000 caracteres e sem caractere de controle (a quebra de linha vale)", () => {
    expect(
      errosDe(valores({ mensagem: `${MENSAGEM} ${"a".repeat(1000)}` }))
        .mensagem,
    ).toBeDefined();
    expect(
      errosDe(valores({ mensagem: `${MENSAGEM}\nAté logo!` })).mensagem,
    ).toBeUndefined();
    expect(
      errosDe(valores({ mensagem: `${MENSAGEM}${String.fromCharCode(7)}` }))
        .mensagem,
    ).toBeDefined();
  });

  it("palavra-chave: de 4 a 40 caracteres, no máximo 20, sem repetir", () => {
    expect(palavraChaveValida("bio")).toBe(false);
    expect(palavraChaveValida("perfil")).toBe(true);
    expect(palavraChaveValida("x".repeat(41))).toBe(false);
    expect(palavraChaveValida("linha\nquebrada")).toBe(false);
    expect(
      palavraChaveValida(`a${String.fromCodePoint(0x200b).repeat(5)}`),
    ).toBe(false);
    expect(
      errosDe(valores({ palavras_chave: ["sim"] })).palavras_chave,
    ).toBeDefined();
    expect(
      errosDe(
        valores({
          palavras_chave: Array.from({ length: 21 }, (_, i) => `palavra${i}`),
        }),
      ).palavras_chave,
    ).toBeDefined();
    expect(
      errosDe(valores({ palavras_chave: ["Perfil", "perfil"] })).palavras_chave,
    ).toEqual(["A palavra-chave perfil está repetida."]);
  });

  it("pelo menos um jeito de reconhecer: mensagem, código ou palavra-chave", () => {
    const nada = valores({
      com_codigo: false,
      mensagem: "",
      palavras_chave: [],
    });
    expect(errosDe(nada).mensagem).toEqual([ERRO_SEM_JEITO_DE_RECONHECER]);
    expect(errosDe({ ...nada, com_codigo: true })).toEqual({});
    expect(errosDe({ ...nada, palavras_chave: ["perfil"] })).toEqual({});
    expect(errosDe({ ...nada, mensagem: MENSAGEM })).toEqual({});
  });

  it("a action aceita os mesmos campos e o id da edição", () => {
    expect(
      salvarOrigemSchema.safeParse({
        ...valores(),
        id: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
    expect(
      salvarOrigemSchema.safeParse({ ...valores(), id: "nao-e-uuid" }).success,
    ).toBe(false);
  });

  it("o campo do problema volta para o formulário", () => {
    expect(campoDoProblema(["mensagem"])).toBe("mensagem");
    expect(campoDoProblema(["id"])).toBeUndefined();
    expect(campoDoProblema(undefined)).toBeUndefined();
  });

  it("as colunas gravadas: vazio vira nulo, a mensagem sem retorno de carro nem tabulação", () => {
    expect(
      camposDaRegra(
        valores({
          origem: "  Instagram ",
          detalhe: "",
          campanha: " ",
          mensagem: ` Olá!\r\nQuero\tagendar uma avaliação. `,
          palavras_chave: [" perfil "],
        }),
      ),
    ).toEqual({
      name: "Link da bio",
      channel: "redes_sociais",
      origin: "Instagram",
      medium: null,
      campaign: null,
      default_message: "Olá!\nQuero agendar uma avaliação.",
      keywords: ["perfil"],
    });
  });

  it("os valores de uma origem existente voltam para o formulário", () => {
    expect(valoresDaRegra(origem({ codigo: null, campanha: "Bio" }))).toEqual({
      nome: "Link da bio",
      canal: "redes_sociais",
      origem: "Instagram",
      detalhe: "Bio",
      campanha: "Bio",
      mensagem: MENSAGEM,
      palavras_chave: [],
      com_codigo: false,
    });
  });

  it("palavras do campo de texto: vírgula ou quebra de linha, sem vazias nem repetidas", () => {
    expect(palavrasDoTexto("perfil, bio do insta,\n Perfil ,,")).toEqual([
      "perfil",
      "bio do insta",
    ]);
  });
});

describe("os tamanhos contam como o banco conta: pontos de código", () => {
  // Revisao da onda 5: char_length e o regex dos CHECKs da migration
  // 20261025100000 contam pontos de codigo, e o .length do JavaScript conta
  // unidades UTF-16 (um emoji fora do BMP vale 2 nele). Contado pelo
  // .length, o Zod aceitava nome, mensagem e palavra-chave que o banco
  // recusava (23514), e a tela mostrava a recusa para algo que o proprio
  // formulario tinha aceitado. Os casos daqui foram conferidos no Postgres
  // local com a migration (recusa e aceite nos mesmos pontos).
  const DENTE = String.fromCodePoint(0x1f9b7);

  it("contarCaracteres conta pontos de código, não unidades UTF-16", () => {
    expect(DENTE.length).toBe(2);
    expect(contarCaracteres(DENTE)).toBe(1);
    expect(contarCaracteres(`Oi ${DENTE.repeat(4)} tudo`)).toBe(12);
    expect(contarCaracteres("Olá")).toBe(3);
  });

  it("o mínimo não passa onde o banco recusa", () => {
    expect(errosDe(valores({ nome: DENTE })).nome).toEqual([
      "Dê um nome com pelo menos 2 caracteres.",
    ]);
    expect(palavraChaveValida(DENTE.repeat(2))).toBe(false);
    expect(palavraChaveValida(`oi${DENTE}`)).toBe(false);
    expect(
      errosDe(valores({ palavras_chave: [DENTE.repeat(2)] })).palavras_chave,
    ).toBeDefined();
    // 12 pontos de codigo (16 unidades UTF-16), 3 palavras.
    expect(mensagemComTamanhoBom(`Oi ${DENTE.repeat(4)} tudo`)).toBe(false);
    expect(
      errosDe(valores({ mensagem: `Oi ${DENTE.repeat(4)} tudo` })).mensagem,
    ).toEqual([ERRO_DA_MENSAGEM_CURTA]);
  });

  it("no limite exato, aceita como o banco aceita", () => {
    expect(errosDe(valores({ nome: DENTE.repeat(2) })).nome).toBeUndefined();
    expect(palavraChaveValida(DENTE.repeat(4))).toBe(true);
    // 15 pontos de codigo, 3 palavras.
    expect(mensagemComTamanhoBom(`Oi ${DENTE.repeat(7)} tudo`)).toBe(true);
  });

  it("o máximo também em pontos de código (nome, origem, palavra-chave e mensagem)", () => {
    expect(errosDe(valores({ nome: DENTE.repeat(120) })).nome).toBeUndefined();
    expect(errosDe(valores({ nome: DENTE.repeat(121) })).nome).toBeDefined();
    expect(
      errosDe(valores({ origem: DENTE.repeat(120) })).origem,
    ).toBeUndefined();
    expect(
      errosDe(valores({ origem: DENTE.repeat(121) })).origem,
    ).toBeDefined();
    expect(palavraChaveValida(DENTE.repeat(40))).toBe(true);
    expect(palavraChaveValida(DENTE.repeat(41))).toBe(false);
    const longa = `Quero agendar ${DENTE.repeat(986)}`;
    expect(contarCaracteres(longa)).toBe(1000);
    expect(errosDe(valores({ mensagem: longa })).mensagem).toBeUndefined();
    expect(errosDe(valores({ mensagem: `${longa}a` })).mensagem).toBeDefined();
  });

  it("hangul: a sílaba vale 1, como no banco (a normalização decompõe em jamos)", () => {
    expect(palavraChaveValida("안녕")).toBe(false);
    expect(palavraChaveValida("안녕하세")).toBe(true);
    // 8 silabas, 3 palavras.
    expect(mensagemComTamanhoBom("안녕 하세 요요")).toBe(false);
    // 15 pontos de codigo, 3 palavras.
    expect(mensagemComTamanhoBom("안녕하세요 반갑습니다 여러분")).toBe(true);
  });
});

describe("rótulos da origem", () => {
  it("o canal com origem e detalhe, como o lead vai mostrar", () => {
    expect(textoDoCanalDaRegra(origem())).toBe(
      "Redes sociais, Instagram (Bio)",
    );
    expect(
      textoDoCanalDaRegra(
        origem({ canal: "indicacao", origem: null, detalhe: null }),
      ),
    ).toBe("Indicação");
  });

  it("Reconhece por: mensagem pronta, código e palavras-chave", () => {
    expect(
      textoDoReconhecimento(
        origem({ palavrasChave: ["perfil", "bio do insta"] }),
      ),
    ).toBe("Reconhece por: mensagem pronta, código #K7Q2MX, 2 palavras-chave");
    expect(
      jeitosDeReconhecer(
        origem({ mensagem: null, codigo: null, palavrasChave: ["perfil"] }),
      ),
    ).toEqual(["1 palavra-chave"]);
  });
});

describe("link para a bio", () => {
  it("wa.me com os dígitos, a mensagem codificada e o código no fim", () => {
    const link = linkDoWhatsApp("558599990000", MENSAGEM, "K7Q2MX");
    expect(link).toBe(
      `https://wa.me/558599990000?text=${encodeURIComponent(`${MENSAGEM} [#K7Q2MX]`)}`,
    );
    const texto = decodeURIComponent(link?.split("?text=")[1] ?? "");
    expect(extrairToken(texto)).toBe("K7Q2MX");
  });

  it("sem código, só a mensagem; a quebra de linha vai codificada", () => {
    const link = linkDoWhatsApp(
      "+55 (85) 9999-0000",
      "Linha um\nlinha dois e tres",
      null,
    );
    expect(link).toBe(
      "https://wa.me/558599990000?text=Linha%20um%0Alinha%20dois%20e%20tres",
    );
  });

  it("sem mensagem ou com número fora do formato, não há link", () => {
    expect(linkDoWhatsApp("558599990000", null, "K7Q2MX")).toBeNull();
    expect(linkDoWhatsApp("558599990000", "   ", null)).toBeNull();
    expect(linkDoWhatsApp("123", MENSAGEM, null)).toBeNull();
  });

  it("o texto que aparece no WhatsApp leva o código no fim", () => {
    expect(textoDoLink(MENSAGEM, "k7q2mx")).toBe(`${MENSAGEM} [#K7Q2MX]`);
    expect(textoDoLink(MENSAGEM, null)).toBe(MENSAGEM);
  });

  it("só os números que já têm telefone servem ao link, na ordem da leitura", () => {
    expect(
      numerosParaOLink([
        { id: "a", nome: "Recepção", displayPhone: "558599990000" },
        { id: "b", nome: "Novo", displayPhone: null },
        { id: "c", nome: "Unidade 2", displayPhone: "+55 85 98888-1111" },
      ]),
    ).toEqual([
      {
        id: "a",
        nome: "Recepção",
        // O link usa os digitos como estao gravados; a tela mostra o numero
        // pela regra de sempre (formatarTelefone poe o 9 do celular).
        digitos: "558599990000",
        telefone: "(85) 99999-0000",
      },
      {
        id: "c",
        nome: "Unidade 2",
        digitos: "5585988881111",
        telefone: "(85) 98888-1111",
      },
    ]);
  });
});

describe("avisos da mensagem pronta (não impedem salvar)", () => {
  const frases = frasesDoBotaoDoSite(["Oi, vim pelo site da clínica"]);

  it("as frases do botão do site: as da clínica, a de fábrica e o Olá!", () => {
    expect(frases).toEqual([
      "Oi, vim pelo site da clínica",
      FRASE_PADRAO,
      "Olá!",
    ]);
    expect(frasesDoBotaoDoSite(null)).toEqual([FRASE_PADRAO, "Olá!"]);
  });

  it("cerquilha com 6 letras do alfabeto vira candidato a código", () => {
    expect(avisosDaMensagem("Quero #agendar uma avaliação", frases)).toEqual([
      {
        chave: "codigo",
        texto:
          "O trecho #AGENDA da mensagem é lido como código. Tire a cerquilha (#) do texto.",
      },
    ]);
  });

  it("mensagem igual a uma frase do botão do site avisa", () => {
    const avisos = avisosDaMensagem(
      "ola! vim pelo site e gostaria de agendar uma consulta.",
      frases,
    );
    expect(avisos.map((aviso) => aviso.chave)).toEqual(["site"]);
  });

  it("mensagem própria do link não avisa nada", () => {
    expect(avisosDaMensagem(MENSAGEM, frases)).toEqual([]);
  });
});

describe("conflitos entre origens (normalização da ingestão)", () => {
  const outra = origem({
    id: "22222222-2222-4222-8222-222222222222",
    nome: "QR da recepção",
    mensagem:
      "ola! vi o perfil da clinica no instagram e quero agendar uma avaliacao.",
    palavrasChave: ["Perfil", "recepção"],
  });

  it("mensagem pronta igual à de outra origem ATIVA recusa", () => {
    expect(origemComAMesmaMensagem(MENSAGEM, [outra], null)?.nome).toBe(
      "QR da recepção",
    );
    expect(recusaDaMensagemRepetida("QR da recepção")).toBe(
      "Esta mensagem já reconhece a origem QR da recepção.",
    );
  });

  it("a própria origem e a desativada não contam", () => {
    expect(origemComAMesmaMensagem(MENSAGEM, [outra], outra.id)).toBeNull();
    expect(
      origemComAMesmaMensagem(MENSAGEM, [{ ...outra, ativa: false }], null),
    ).toBeNull();
    expect(origemComAMesmaMensagem(null, [outra], null)).toBeNull();
  });

  it("palavra-chave repetida em outra origem ativa só avisa", () => {
    const repetidas = palavrasEmOutraOrigem(["perfil", "bio"], [outra], null);
    expect(repetidas).toEqual([
      { palavra: "perfil", origem: "QR da recepção" },
    ]);
    expect(avisoDasPalavrasRepetidas(repetidas)).toBe(
      "A palavra-chave perfil também está na origem QR da recepção. Vale a palavra mais longa e, no empate, a origem cadastrada primeiro.",
    );
    expect(avisoDasPalavrasRepetidas([])).toBeNull();
  });

  it("o limite de origens ativas é 50 (P17-8)", () => {
    expect(LIMITE_DE_ORIGENS_ATIVAS).toBe(50);
    expect(recusaDoLimite("criar")).toBe(
      "A clínica já tem 50 origens ativas. Desative uma antes de criar outra.",
    );
    expect(recusaDoLimite("ativar")).toBe(
      "A clínica já tem 50 origens ativas. Desative uma antes de ativar esta.",
    );
  });
});

describe("Testar uma mensagem (a decisão da ingestão, no navegador)", () => {
  const regras = [
    origem(),
    origem({
      id: "33333333-3333-4333-8333-333333333333",
      nome: "Parceiro academia",
      codigo: null,
      canal: "indicacao",
      origem: "Academia Forte",
      detalhe: null,
      mensagem: null,
      palavrasChave: ["academia forte"],
    }),
    origem({
      id: "44444444-4444-4444-8444-444444444444",
      nome: "Desativada",
      codigo: "ABCDEF",
      ativa: false,
      mensagem: null,
      canal: "offline",
    }),
  ];

  it("só as ativas, na ordem de criação, vão para a decisão", () => {
    expect(regrasQueAIngestaoUsa(regras).map((regra) => regra.id)).toEqual([
      regras[0]?.id,
      regras[1]?.id,
    ]);
  });

  it("pela mensagem pronta", () => {
    const resultado = testarMensagem(MENSAGEM, regras);
    expect(fraseDoTeste(resultado)).toBe(
      "Esta mensagem seria reconhecida como Redes sociais, Instagram (Bio), pela mensagem pronta da origem Link da bio.",
    );
  });

  it("pelo código do link, mesmo com o texto editado", () => {
    expect(fraseDoTeste(testarMensagem("oi! [#k7q2mx]", regras))).toBe(
      "Esta mensagem seria reconhecida como Redes sociais, Instagram (Bio), pelo código do link da origem Link da bio.",
    );
  });

  it("pela palavra-chave", () => {
    expect(
      fraseDoTeste(
        testarMensagem("Vim pela Academia Forte, tem horário?", regras),
      ),
    ).toBe(
      "Esta mensagem seria reconhecida como Indicação, Academia Forte, pela palavra-chave da origem Parceiro academia.",
    );
  });

  it("nada casa, origem desativada não reconhece e texto vazio não diz nada", () => {
    expect(fraseDoTeste(testarMensagem("Bom dia", regras))).toBe(
      "Nenhuma origem cadastrada reconhece esta mensagem.",
    );
    expect(testarMensagem("[#ABCDEF]", regras).tipo).toBe("nenhuma");
    expect(fraseDoTeste(testarMensagem("   ", regras))).toBeNull();
  });

  // Revisao da onda 5: o teste chamava a decisao sem os codigos de clique, e
  // a ingestao os passa (tentarAtribuirOrigem). O codigo que nao e de
  // nenhuma origem ativa conta como clique do site nao achado: a mensagem
  // pronta vale tambem sem o sufixo " [#XXXXXX]" dele.
  it("link antigo ainda publicado (código de origem desativada) casa pela mensagem pronta da nova", () => {
    const antiga = origem({
      id: "55555555-5555-4555-8555-555555555555",
      nome: "Bio antiga",
      codigo: "ABC234",
      ativa: false,
    });
    const nova = origem({
      id: "66666666-6666-4666-8666-666666666666",
      nome: "Bio nova",
      codigo: "K7Q2MX",
    });
    const resultado = testarMensagem(`${MENSAGEM} [#ABC234]`, [antiga, nova]);
    expect(resultado.tipo).toBe("reconhecida");
    expect(fraseDoTeste(resultado)).toBe(
      "Esta mensagem seria reconhecida como Redes sociais, Instagram (Bio), pela mensagem pronta da origem Bio nova.",
    );
  });

  it("código digitado errado ou de origem excluída: a mensagem pronta ainda casa", () => {
    expect(fraseDoTeste(testarMensagem(`${MENSAGEM} [#ZZZZZZ]`, regras))).toBe(
      "Esta mensagem seria reconhecida como Redes sociais, Instagram (Bio), pela mensagem pronta da origem Link da bio.",
    );
    // O codigo de uma origem ativa continua vencendo tudo.
    expect(testarMensagem(`${MENSAGEM} [#K7Q2MX]`, regras)).toMatchObject({
      tipo: "reconhecida",
      metodo: "link_token",
    });
  });

  it("frase do botão do site com o código perdido não reconhece nada, como na ingestão", () => {
    const frases = frasesDoBotaoDoSite(["Oi, vim pelo site da clínica"]);
    const comPalavra = [
      origem({
        id: "77777777-7777-4777-8777-777777777777",
        nome: "Quem fala do site",
        codigo: null,
        mensagem: null,
        canal: "busca_organica",
        origem: "Site",
        detalhe: null,
        palavrasChave: ["site"],
      }),
    ];
    expect(
      testarMensagem(
        "Oi, vim pelo site da clínica [#ABC234]",
        comPalavra,
        frases,
      ).tipo,
    ).toBe("nenhuma");
    expect(testarMensagem("Olá! [#ABC234]", regras, frases).tipo).toBe(
      "nenhuma",
    );
    // Sem codigo de clique a ingestao nao confere a frase: a palavra-chave
    // vale, como la.
    expect(
      testarMensagem("Oi, vim pelo site da clínica", comPalavra, frases),
    ).toMatchObject({ tipo: "reconhecida", metodo: "palavra_chave" });
  });
});

describe("recusas do banco (migration 20261025100000) em texto de recepção", () => {
  it.each([
    ["campaign_link_nome", "nome"],
    ["campaign_link_textos", "origem"],
    ["campaign_link_mensagem", "mensagem"],
    ["campaign_link_palavras_de_1_dimensao", "palavras_chave"],
    ["campaign_link_palavras_no_formato", "palavras_chave"],
    ["campaign_link_reconhece_algo", "mensagem"],
  ])("23514 de %s vai para o campo %s", (check, campo) => {
    const recusa = recusaDoBancoNaOrigem({
      code: "23514",
      message: `new row for relation "campaign_link" violates check constraint "${check}"`,
    });
    expect(recusa?.campo).toBe(campo);
    expect(recusa?.texto).not.toContain(check);
  });

  it("o limite de origens ativas (P0001) e a falta de permissão (42501)", () => {
    expect(
      recusaDoBancoNaOrigem(
        { code: "P0001", message: "limite_de_origens_ativas" },
        "ativar",
      )?.texto,
    ).toBe(recusaDoLimite("ativar"));
    expect(recusaDoBancoNaOrigem({ code: "42501", message: "x" })?.texto).toBe(
      "Somente administradores e gestores cadastram as origens dos leads.",
    );
    expect(recusaDoBancoNaOrigem({ code: "XX000", message: "x" })).toBeNull();
  });
});

describe("leitura da linha do banco", () => {
  it("o código vem em maiúsculas e palavras nulas viram lista vazia", () => {
    expect(
      regraDaLinha({
        id: "i",
        name: "Bio",
        token: "k7q2mx",
        channel: "redes_sociais",
        origin: null,
        medium: null,
        campaign: null,
        default_message: null,
        keywords: null,
        active: false,
        created_at: "2026-10-21T12:00:00Z",
      }),
    ).toEqual({
      id: "i",
      nome: "Bio",
      codigo: "K7Q2MX",
      canal: "redes_sociais",
      origem: null,
      detalhe: null,
      campanha: null,
      mensagem: null,
      palavrasChave: [],
      ativa: false,
    });
  });
});

describe("nenhum travessão nos textos da origem", () => {
  it("mensagens fixas e frases geradas", () => {
    const textos = [
      ERRO_DA_MENSAGEM_CURTA,
      ERRO_SEM_JEITO_DE_RECONHECER,
      recusaDoLimite("criar"),
      recusaDoLimite("ativar"),
      recusaDaMensagemRepetida("X"),
      textoDoReconhecimento(origem({ palavrasChave: ["perfil"] })),
      fraseDoTeste(testarMensagem(MENSAGEM, [origem()])) ?? "",
      fraseDoTeste(testarMensagem("nada", [origem()])) ?? "",
      ...avisosDaMensagem("Quero #agendar", frasesDoBotaoDoSite(null)).map(
        (aviso) => aviso.texto,
      ),
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
