import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CABECALHO_DA_NOTA_DA_PASSAGEM } from "@/lib/agente/nota-da-passagem";
import { UFS as UFS_DO_CADASTRO } from "@/lib/domain/cadastro-para-o-agente";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import {
  CABECALHO_DO_PREPARO,
  codigoDoTexto,
  CONSELHOS,
  conteudoRecusadoPeloBanco,
  ehConselho,
  ehMensagemDoPreparo,
  ehUf,
  FRASE_DO_PREPARO_DEPOIS_DE_MARCAR,
  LIMITE_DO_TEXTO_DO_PREPARO,
  LINHA_DO_RT,
  mensagemDoPreparo,
  normalizarTextoDoPreparo,
  partesDaMensagemDoPreparo,
  podeSerAMensagemDoPreparo,
  procedimentoDaMensagemDoPreparo,
  RODAPE_DO_PREPARO,
  SEM_ENVIOS_DO_PREPARO,
  semOPreparo,
  SITUACOES_DO_PREPARO,
  situacaoDoPreparoNaTela,
  SUBSTITUTO_DO_TEXTO_DO_PREPARO,
  substitutoDaMensagemDoPreparo,
  textoDoPreparoValido,
  textoRecusadoPeloBanco,
  UFS,
  type VersaoNaTela,
} from "@/lib/domain/preparo";

// AG7 (03/11/2026): o dominio puro do preparo aprovado pelo responsavel
// tecnico. Cada regra espelha o banco (migration 20261103100000): a
// normalizacao da copia do texto antigo, o CHECK preparo_texto_valido e a
// funcao mensagem_do_preparo. A igualdade com o banco de verdade e da
// integracao (frente B); aqui, a igualdade com o literal do contrato.

const c = (...codigos: number[]) => String.fromCodePoint(...codigos);

const RT = {
  nome: "Dra. Ana Souza",
  conselho: "CRM",
  uf: "CE",
  numero: "12345",
};
const TEXTO =
  "Jejum de 8 horas antes do exame.\nÀs 18h da véspera, tome 2 comprimidos de bisacodil.";
const MENSAGEM = mensagemDoPreparo({
  procedimento: "Colonoscopia",
  rt: RT,
  texto: TEXTO,
});

describe("o modulo e puro", () => {
  it("nao importa nada (o navegador importa este arquivo)", () => {
    const fonte = readFileSync(
      join(process.cwd(), "lib/domain/preparo.ts"),
      "utf-8",
    );
    expect(fonte).not.toMatch(/^\s*import\s/m);
    expect(fonte).not.toMatch(/\brequire\(/);
    // Nenhum caractere invisivel solto no fonte (os do CHECK vao escapados).
    expect(fonte).not.toMatch(
      new RegExp(
        `[${c(0xad, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0xfeff)}]`,
      ),
    );
  });
});

describe("listas e textos fixos", () => {
  it("os conselhos sao os dez da proposta (D-70)", () => {
    expect(CONSELHOS).toEqual([
      "CRM",
      "CRO",
      "CRBM",
      "CRF",
      "COREN",
      "CREFITO",
      "CRN",
      "CRP",
      "CRFa",
      "CREF",
    ]);
    expect(ehConselho("CRM")).toBe(true);
    expect(ehConselho("CRFa")).toBe(true);
    expect(ehConselho("crm")).toBe(false);
    expect(ehConselho("CRMV")).toBe(false);
    expect(ehConselho(null)).toBe(false);
  });

  it("as 27 UFs sao as do CHECK da unidade, na mesma ordem", () => {
    expect(UFS).toHaveLength(27);
    expect(new Set(UFS).size).toBe(27);
    expect(UFS).toEqual(UFS_DO_CADASTRO.map(([sigla]) => sigla));
    expect(ehUf("CE")).toBe(true);
    expect(ehUf("ce")).toBe(false);
    expect(ehUf("XX")).toBe(false);
  });

  it("as seis situacoes da versao", () => {
    expect(SITUACOES_DO_PREPARO).toEqual([
      "aguardando_rt",
      "aprovado",
      "devolvido",
      "descartado",
      "substituido",
      "suspenso",
    ]);
  });

  it("os textos fixos sao os do contrato, sem travessao", () => {
    expect(LIMITE_DO_TEXTO_DO_PREPARO).toBe(3500);
    expect(CABECALHO_DO_PREPARO).toBe("Orientação de preparo para ");
    expect(LINHA_DO_RT).toBe("Responsável técnico da clínica: ");
    expect(RODAPE_DO_PREPARO).toBe(
      "Se tiver qualquer dúvida sobre o preparo, responda por aqui que a equipe da clínica te ajuda.",
    );
    expect(FRASE_DO_PREPARO_DEPOIS_DE_MARCAR).toBe(
      "Este procedimento tem orientação de preparo aprovada pela clínica. Se quiser recebê-la agora, é só pedir.",
    );
    expect(SUBSTITUTO_DO_TEXTO_DO_PREPARO).toBe(
      "(o texto da orientação de preparo aprovada pela clínica estava aqui)",
    );
    expect(substitutoDaMensagemDoPreparo("Colonoscopia")).toBe(
      "Mensagem do sistema: a orientação de preparo de Colonoscopia, aprovada pela clínica, foi enviada aqui.",
    );
    // Sem o nome (nunca deveria faltar), a frase fica sem ele.
    expect(substitutoDaMensagemDoPreparo("  ")).toBe(
      "Mensagem do sistema: a orientação de preparo, aprovada pela clínica, foi enviada aqui.",
    );
    for (const texto of [
      CABECALHO_DO_PREPARO,
      LINHA_DO_RT,
      RODAPE_DO_PREPARO,
      FRASE_DO_PREPARO_DEPOIS_DE_MARCAR,
      SUBSTITUTO_DO_TEXTO_DO_PREPARO,
      substitutoDaMensagemDoPreparo("Colonoscopia"),
      MENSAGEM,
    ]) {
      expect(texto).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("normalizarTextoDoPreparo (a ordem da copia do texto antigo)", () => {
  it("CRLF e CR viram LF, depois NFC, depois o trim()", () => {
    expect(normalizarTextoDoPreparo("linha 1\r\nlinha 2\rlinha 3")).toBe(
      "linha 1\nlinha 2\nlinha 3",
    );
    // "a" + acento agudo combinante vira o "a" acentuado (NFC).
    expect(normalizarTextoDoPreparo(`Jejum na v${c(0x65, 0x301)}spera`)).toBe(
      "Jejum na véspera",
    );
    expect(normalizarTextoDoPreparo("  \r\n Jejum \r\n\t ")).toBe("Jejum");
    // O meio fica como esta (so as pontas).
    expect(normalizarTextoDoPreparo("Jejum\n\n  de 8 horas")).toBe(
      "Jejum\n\n  de 8 horas",
    );
  });

  it("apara exatamente os 25 brancos do trim() do JavaScript", () => {
    const brancos = [
      0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002,
      0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028,
      0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
    ];
    expect(brancos).toHaveLength(25);
    for (const codigo of brancos) {
      const texto = `${c(codigo)}Jejum${c(codigo)}`;
      expect(c(codigo).trim(), codigo.toString(16)).toBe("");
      expect(normalizarTextoDoPreparo(texto), codigo.toString(16)).toBe(
        "Jejum",
      );
    }
    // O invisivel que o trim() nao tira continua (e o CHECK recusa).
    const comZeroWidth = `${c(0x200b)}Jejum`;
    expect(comZeroWidth.trim()).toBe(comZeroWidth);
    expect(normalizarTextoDoPreparo(comZeroWidth)).toBe(comZeroWidth);
    expect(textoDoPreparoValido(normalizarTextoDoPreparo(comZeroWidth))).toBe(
      false,
    );
  });

  it("o texto normalizado de um preparo comum e valido", () => {
    expect(
      textoDoPreparoValido(normalizarTextoDoPreparo(`  ${TEXTO}\r\n`)),
    ).toBe(true);
  });

  it("a tabulacao vira espaco, antes da NFC, e a lista colada do Word fica valida", () => {
    const colada = "1.\tJejum de 8 horas.\r\n2.\tTraga o pedido.\t";
    expect(normalizarTextoDoPreparo(colada)).toBe(
      "1. Jejum de 8 horas.\n2. Traga o pedido.",
    );
    expect(textoDoPreparoValido(normalizarTextoDoPreparo(colada))).toBe(true);
  });

  it("a copia do texto antigo na migration faz as mesmas trocas, na mesma ordem (D-83: o texto e o hash iguais)", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261103100000_preparo_aprovado_pelo_rt.sql",
      ),
      "utf-8",
    );
    const copia = migration.slice(migration.indexOf("do $copia$"));
    // CR LF, depois CR, depois a tabulacao, depois a NFC, depois as pontas
    // com os 25 brancos: a ordem de normalizarTextoDoPreparo.
    expect(copia).toMatch(
      /btrim\(normalize\(replace\(replace\(replace\(p\.prep_instructions, E'\\r\\n', E'\\n'\), E'\\r', E'\\n'\), E'\\t', ' '\), nfc\),\s+c_brancos\) as texto/,
    );
  });
});

describe("textoDoPreparoValido (espelho do CHECK preparo_texto_valido)", () => {
  it("de 1 a 3.500 caracteres, contados por ponto de codigo", () => {
    expect(textoDoPreparoValido("J")).toBe(true);
    expect(textoDoPreparoValido("a".repeat(3500))).toBe(true);
    expect(textoDoPreparoValido("a".repeat(3501))).toBe(false);
    expect(textoDoPreparoValido("")).toBe(false);
    // O emoji tem duas unidades UTF-16 e conta um (char_length).
    const comEmoji = `${"a".repeat(3499)}${c(0x1f48a)}`;
    expect(comEmoji.length).toBe(3501);
    expect(textoDoPreparoValido(comEmoji)).toBe(true);
    expect(textoDoPreparoValido(`${comEmoji}a`)).toBe(false);
  });

  it("aparado, em NFC, com quebra de linha e acento", () => {
    expect(textoDoPreparoValido(TEXTO)).toBe(true);
    expect(textoDoPreparoValido(" Jejum")).toBe(false);
    expect(textoDoPreparoValido("Jejum\n")).toBe(false);
    expect(textoDoPreparoValido(`Jejum${c(0x3000)}`)).toBe(false);
    expect(textoDoPreparoValido(`v${c(0x65, 0x301)}spera`)).toBe(false);
    expect(textoDoPreparoValido("véspera")).toBe(true);
  });

  it("sem CR, sem controle alem do LF e sem invisivel", () => {
    expect(textoDoPreparoValido("Jejum\r\nde 8 horas")).toBe(false);
    expect(textoDoPreparoValido("Jejum\rde 8 horas")).toBe(false);
    expect(textoDoPreparoValido("Jejum\tde 8 horas")).toBe(false);
    for (const codigo of [
      0x00, 0x01, 0x08, 0x0b, 0x0c, 0x1f, 0x7f, 0x85, 0x9f,
    ]) {
      expect(
        textoDoPreparoValido(`Jejum${c(codigo)}de 8 horas`),
        codigo.toString(16),
      ).toBe(false);
    }
    for (const codigo of [
      0xad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a,
      0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064,
      0xfeff,
    ]) {
      expect(
        textoDoPreparoValido(`Jejum${c(codigo)}de 8 horas`),
        codigo.toString(16),
      ).toBe(false);
    }
    // O emoji (com o seletor de variacao) e o micro (U+00B5) nao sao
    // controle nem invisivel para o CHECK.
    expect(textoDoPreparoValido(`Tome ${c(0x2764, 0xfe0f)}`)).toBe(true);
    expect(textoDoPreparoValido(`Tome 400 ${c(0xb5)}g`)).toBe(true);
  });

  it("sem {{ nem }} (a regua os apagaria); a chave sozinha passa", () => {
    expect(textoDoPreparoValido("Jejum de {{horas}}")).toBe(false);
    expect(textoDoPreparoValido("Jejum {{")).toBe(false);
    expect(textoDoPreparoValido("}} Jejum")).toBe(false);
    expect(textoDoPreparoValido("Jejum {8 horas}")).toBe(true);
  });

  it("recusa o que nao e texto", () => {
    expect(textoDoPreparoValido(null as unknown as string)).toBe(false);
    expect(textoDoPreparoValido(42 as unknown as string)).toBe(false);
  });
});

describe("mensagemDoPreparo (espelho de mensagem_do_preparo)", () => {
  it("e igual ao literal do contrato (secao 1.4)", () => {
    expect(MENSAGEM).toBe(
      "Orientação de preparo para Colonoscopia\nResponsável técnico da clínica: Dra. Ana Souza (CRM-CE 12345)\n\nJejum de 8 horas antes do exame.\nÀs 18h da véspera, tome 2 comprimidos de bisacodil.\n\nSe tiver qualquer dúvida sobre o preparo, responda por aqui que a equipe da clínica te ajuda.",
    );
  });

  it("o texto entra byte a byte, com as quebras", () => {
    const texto = "Linha 1\n\n  Linha 3 com espaço   \nFim";
    const mensagem = mensagemDoPreparo({
      procedimento: "Ultrassom de abdome",
      rt: { ...RT, conselho: "CRFa", uf: "SP", numero: "12.345-A" },
      texto,
    });
    expect(mensagem).toContain(
      "\nResponsável técnico da clínica: Dra. Ana Souza (CRFa-SP 12.345-A)\n\n",
    );
    expect(partesDaMensagemDoPreparo(mensagem)?.texto).toBe(texto);
  });

  it("com o maior nome, registro e texto, cabe no WhatsApp (D-84)", () => {
    const mensagem = mensagemDoPreparo({
      procedimento: "P".repeat(120),
      rt: {
        nome: "N".repeat(120),
        conselho: "CREFITO",
        uf: "RS",
        numero: "9".repeat(20),
      },
      texto: "T".repeat(3500),
    });
    expect(Array.from(mensagem).length).toBeLessThan(3950);
  });
});

describe("partesDaMensagemDoPreparo e procedimentoDaMensagemDoPreparo", () => {
  it("le o procedimento, a linha do RT e o texto", () => {
    expect(partesDaMensagemDoPreparo(MENSAGEM)).toEqual({
      procedimento: "Colonoscopia",
      linhaDoRt:
        "Responsável técnico da clínica: Dra. Ana Souza (CRM-CE 12345)",
      texto: TEXTO,
    });
    expect(procedimentoDaMensagemDoPreparo(MENSAGEM)).toBe("Colonoscopia");
  });

  it("fora do formato: null", () => {
    const sem = (de: string, por = "") => MENSAGEM.replace(de, por);
    for (const corpo of [
      "",
      TEXTO,
      sem(CABECALHO_DO_PREPARO),
      sem(`\n\n${RODAPE_DO_PREPARO}`),
      `${MENSAGEM} `,
      `${MENSAGEM}\nObrigada!`,
      sem(LINHA_DO_RT, "Responsável: "),
      sem("\n\nJejum", "\nJejum"),
      sem("Colonoscopia", " "),
      mensagemDoPreparo({ procedimento: "Colonoscopia", rt: RT, texto: " " }),
      `${CABECALHO_DO_PREPARO}Colonoscopia\n\n${RODAPE_DO_PREPARO}`,
    ]) {
      expect(partesDaMensagemDoPreparo(corpo), JSON.stringify(corpo)).toBe(
        null,
      );
    }
  });

  it("o procedimento sai de todo corpo que comeca pelo cabecalho (o historico esconde)", () => {
    expect(
      procedimentoDaMensagemDoPreparo(
        `${CABECALHO_DO_PREPARO}Endoscopia\nqualquer coisa`,
      ),
    ).toBe("Endoscopia");
    expect(procedimentoDaMensagemDoPreparo(`${CABECALHO_DO_PREPARO}  `)).toBe(
      "",
    );
    expect(procedimentoDaMensagemDoPreparo("Oi! Orientação de preparo")).toBe(
      null,
    );
    expect(procedimentoDaMensagemDoPreparo(TEXTO)).toBe(null);
  });
});

describe("ehMensagemDoPreparo (a bolha do Atendimento)", () => {
  const JOB = "11111111-1111-4111-8111-111111111111";
  const JOB_DA_REGUA = "22222222-2222-4222-8222-222222222222";
  /** O envio confirmado: a decisao 'enviou_preparo' do job (TELA-13). */
  const ENVIOS = new Set([JOB]);
  const doSistema = {
    author: "sistema",
    body: MENSAGEM,
    is_internal_note: false,
    author_user_id: null,
    direction: "saida",
    content_type: "texto",
    pelo_celular: false,
    media_url: null,
    job_id: JOB,
  };

  it("a mensagem do sistema no formato, com o envio confirmado, e o preparo", () => {
    expect(ehMensagemDoPreparo(doSistema, ENVIOS)).toBe(true);
    expect(podeSerAMensagemDoPreparo(doSistema)).toBe(true);
    // Direcao e tipo podem faltar (o reconhecimento le o que vier).
    expect(
      ehMensagemDoPreparo(
        {
          author: "sistema",
          body: MENSAGEM,
          is_internal_note: false,
          job_id: JOB,
        },
        ENVIOS,
      ),
    ).toBe(true);
  });

  it("sem a decisao 'enviou_preparo' do job, nao e o preparo (TELA-13 e CFM-10a)", () => {
    // O passo de regua escrito no mesmo formato: o job da regua nunca tem a
    // decisao do envio do preparo.
    const daRegua = { ...doSistema, job_id: JOB_DA_REGUA };
    expect(podeSerAMensagemDoPreparo(daRegua)).toBe(true);
    expect(ehMensagemDoPreparo(daRegua, ENVIOS)).toBe(false);
    // A consulta ainda nao voltou, ou falhou: nenhum envio, falha fechada.
    expect(ehMensagemDoPreparo(doSistema, SEM_ENVIOS_DO_PREPARO)).toBe(false);
    expect(SEM_ENVIOS_DO_PREPARO.size).toBe(0);
    // Sem job (o fio antigo, a mensagem montada sem o campo): nao e.
    const semJob = { ...doSistema, job_id: undefined };
    expect(podeSerAMensagemDoPreparo(semJob)).toBe(false);
    expect(ehMensagemDoPreparo(semJob, ENVIOS)).toBe(false);
    expect(
      ehMensagemDoPreparo({ ...doSistema, job_id: "" }, new Set([""])),
    ).toBe(false);
  });

  it("a frase fixa, a nota da passagem e o texto da equipe nao sao o preparo", () => {
    expect(
      ehMensagemDoPreparo(
        { ...doSistema, body: FRASE_DE_ESCALONAMENTO },
        ENVIOS,
      ),
    ).toBe(false);
    expect(
      ehMensagemDoPreparo(
        {
          ...doSistema,
          is_internal_note: true,
          body: `${CABECALHO_DA_NOTA_DA_PASSAGEM}\nMotivo: assunto clínico.`,
        },
        ENVIOS,
      ),
    ).toBe(false);
    expect(
      ehMensagemDoPreparo(
        { ...doSistema, author: "usuario", author_user_id: "u1" },
        ENVIOS,
      ),
    ).toBe(false);
    expect(
      ehMensagemDoPreparo({ ...doSistema, author: "usuario" }, ENVIOS),
    ).toBe(false);
    expect(ehMensagemDoPreparo({ ...doSistema, author: "ia" }, ENVIOS)).toBe(
      false,
    );
    expect(
      ehMensagemDoPreparo({ ...doSistema, author: "paciente" }, ENVIOS),
    ).toBe(false);
  });

  it("nota, celular, entrada, midia, pessoa ou job nulo: nao e o preparo, nem com o envio", () => {
    for (const desvio of [
      { is_internal_note: true },
      { pelo_celular: true },
      { direction: "entrada" },
      { content_type: "imagem" },
      { media_url: "storage://x" },
      { author_user_id: "u1" },
      { job_id: null },
      { body: null },
      { body: undefined },
      { body: TEXTO },
      { body: `${MENSAGEM} ` },
    ]) {
      expect(
        ehMensagemDoPreparo({ ...doSistema, ...desvio }, ENVIOS),
        JSON.stringify(desvio),
      ).toBe(false);
      expect(
        podeSerAMensagemDoPreparo({ ...doSistema, ...desvio }),
        JSON.stringify(desvio),
      ).toBe(false);
    }
  });
});

describe("conteudoRecusadoPeloBanco (o espelho de preparo_texto_recusado)", () => {
  it("o texto de preparo comum passa", () => {
    for (const texto of [
      TEXTO,
      "Jejum absoluto de 8 horas antes do exame.",
      "Beba 1 litro de manitol a 10% gelado.",
      "Traga o pedido médico e um documento com foto.",
      "Escreva para contato@clinica",
      "Leve 2 garrafas de 1,5 litro.",
      "50reais",
      "Jejum \u2764\ufe0f.",
    ]) {
      expect(conteudoRecusadoPeloBanco(texto), texto).toEqual([]);
      expect(textoRecusadoPeloBanco(texto), texto).toBe(false);
    }
  });

  it("o link, o valor em reais e o arroba, com a frase que dispara sozinha", () => {
    expect(
      conteudoRecusadoPeloBanco(
        "Jejum de 8 horas.\nVeja o vídeo em clinica.com.br. Traga R$ 50,00 para o estacionamento.",
      ),
    ).toEqual([
      { causa: "link", trecho: "Veja o vídeo em clinica.com.br." },
      {
        causa: "valor_em_reais",
        trecho: "Traga R$ 50,00 para o estacionamento.",
      },
    ]);
    expect(
      conteudoRecusadoPeloBanco("Siga @clinica.ensaio para mais dicas."),
    ).toEqual([
      { causa: "arroba", trecho: "Siga @clinica.ensaio para mais dicas." },
    ]);
    expect(conteudoRecusadoPeloBanco("Pague 50 reais na recepção.")).toEqual([
      { causa: "valor_em_reais", trecho: "Pague 50 reais na recepção." },
    ]);
    // A palavra "arroba" tambem (o banco nao separa o peso do arroba).
    expect(conteudoRecusadoPeloBanco("Uma arroba de peso.")).toEqual([
      { causa: "arroba", trecho: "Uma arroba de peso." },
    ]);
    for (const texto of [
      "Veja https://bit.ly/abc",
      "Acesse www.clinica.com.br",
      "Abra ://preparo",
      "Veja em http, no site.",
      "ＷＷＷ．site",
    ]) {
      expect(
        conteudoRecusadoPeloBanco(texto).map((c) => c.causa),
        texto,
      ).toContain("link");
    }
  });

  it("o invisivel que o filtro recusa e o CHECK nao, com a posicao do primeiro", () => {
    expect(conteudoRecusadoPeloBanco("Jejum de \u20668 horas\u2069.")).toEqual([
      { causa: "invisivel", posicao: 9 },
    ]);
    // O seletor de variacao colado no digito (o emoji de tecla).
    expect(conteudoRecusadoPeloBanco("Tome 1\ufe0f\u20e3 comprimido.")).toEqual(
      [{ causa: "invisivel", posicao: 6 }],
    );
    expect(textoRecusadoPeloBanco("Je\u{e0041}jum.")).toBe(true);
  });

  it("vazio ou fora do tipo: nada", () => {
    expect(conteudoRecusadoPeloBanco("")).toEqual([]);
    expect(conteudoRecusadoPeloBanco(null as unknown as string)).toEqual([]);
  });
});

describe("codigoDoTexto", () => {
  it("os 8 primeiros do hash, em maiusculas, em dois grupos", () => {
    expect(codigoDoTexto(`a1b2c3d4${"0".repeat(56)}`)).toBe("A1B2 C3D4");
    expect(codigoDoTexto(`A1B2C3D4${"f".repeat(56)}`)).toBe("A1B2 C3D4");
  });

  it("fora do formato: vazio", () => {
    expect(codigoDoTexto("")).toBe("");
    expect(codigoDoTexto("a1b2c3")).toBe("");
    expect(codigoDoTexto(`g1b2c3d4${"0".repeat(56)}`)).toBe("");
    expect(codigoDoTexto(null as unknown as string)).toBe("");
  });
});

describe("semOPreparo (o historico que vai ao modelo)", () => {
  const TOQUE = `Oi, Maria! Amanhã, 29/10/2026 às 08:00, você tem Colonoscopia com Dr. Bruno.\n${TEXTO}\nPodemos confirmar sua presença?`;

  it("o texto da clinica dentro do toque da regua vira o marcador", () => {
    expect(semOPreparo(TOQUE, [TEXTO])).toBe(
      `Oi, Maria! Amanhã, 29/10/2026 às 08:00, você tem Colonoscopia com Dr. Bruno.\n${SUBSTITUTO_DO_TEXTO_DO_PREPARO}\nPodemos confirmar sua presença?`,
    );
  });

  it("o branco diferente nao salva o texto (CRLF, espaco no fim da linha)", () => {
    const comCrlf = TOQUE.replace("exame.\nÀs", "exame.  \r\nÀs");
    expect(semOPreparo(comCrlf, [TEXTO])).not.toContain("bisacodil");
    expect(semOPreparo(comCrlf, [TEXTO])).toContain(
      SUBSTITUTO_DO_TEXTO_DO_PREPARO,
    );
  });

  it("varios textos, o mais longo primeiro, e o marcador nunca e lido de novo", () => {
    // O curto e o comeco do TEXTO: o TEXTO vale primeiro, e o curto so troca
    // o que sobrou. "aqui" so existe dentro do marcador, que nao e relido.
    const curto = "Jejum de 8 horas antes do exame.";
    const resultado = semOPreparo(`${TOQUE}\n${curto}`, ["aqui", curto, TEXTO]);
    expect(resultado).toBe(
      `Oi, Maria! Amanhã, 29/10/2026 às 08:00, você tem Colonoscopia com Dr. Bruno.\n${SUBSTITUTO_DO_TEXTO_DO_PREPARO}\nPodemos confirmar sua presença?\n${SUBSTITUTO_DO_TEXTO_DO_PREPARO}`,
    );
  });

  it("nao troca no meio de uma palavra nem texto so de branco", () => {
    expect(semOPreparo("Prostotas e Prostota.", ["Prostota"])).toBe(
      `Prostotas e ${SUBSTITUTO_DO_TEXTO_DO_PREPARO}.`,
    );
    expect(semOPreparo("Oi, tudo bem?", ["  ", "\n\n", "", "."])).toBe(
      "Oi, tudo bem?",
    );
    expect(semOPreparo("Oi, tudo bem?", [])).toBe("Oi, tudo bem?");
    expect(semOPreparo("", [TEXTO])).toBe("");
  });

  it("o texto com simbolo de regex e trocado ao pe da letra", () => {
    const texto = "Tome 1 (um) comprimido às 18h? Sim: [sempre] 2+2 $5.";
    expect(semOPreparo(`Lembrete: ${texto} Até amanhã.`, [texto])).toBe(
      `Lembrete: ${SUBSTITUTO_DO_TEXTO_DO_PREPARO} Até amanhã.`,
    );
  });
});

describe("situacaoDoPreparoNaTela (os cinco chips)", () => {
  const RT_ABERTO = { id: "rt-1", userId: "u-1" };
  const versao = (
    v: number,
    situacao: VersaoNaTela["situacao"],
    extra: Partial<VersaoNaTela> = {},
  ): VersaoNaTela => ({
    id: `v${v}`,
    versao: v,
    situacao,
    textoSha256: "a".repeat(64),
    nomeDoProcedimento: "Colonoscopia",
    rtId:
      situacao === "aprovado" ||
      situacao === "substituido" ||
      situacao === "suspenso"
        ? "rt-1"
        : null,
    ...extra,
  });
  const situacao = (
    versoes: VersaoNaTela[],
    extra: Partial<Parameters<typeof situacaoDoPreparoNaTela>[0]> = {},
  ) =>
    situacaoDoPreparoNaTela({
      versoes,
      rtAberto: RT_ABERTO,
      rtComAcesso: true,
      nomeAtual: "Colonoscopia",
      ...extra,
    });

  it("aprovada: a versao aprovada com o RT aberto, com acesso e o mesmo nome", () => {
    expect(situacao([versao(1, "substituido"), versao(2, "aprovado")])).toBe(
      "aprovada",
    );
    // O texto novo esperando o RT tem bloco proprio: o chip continua.
    expect(situacao([versao(1, "aprovado"), versao(2, "aguardando_rt")])).toBe(
      "aprovada",
    );
  });

  it("precisa de nova aprovacao: RT trocado, sem RT, sem acesso ou nome mudado", () => {
    const aprovada = [versao(1, "aprovado")];
    expect(
      situacao(aprovada, { rtAberto: { id: "rt-2", userId: "u-2" } }),
    ).toBe("precisa_de_nova_aprovacao");
    expect(situacao(aprovada, { rtAberto: null })).toBe(
      "precisa_de_nova_aprovacao",
    );
    expect(situacao(aprovada, { rtComAcesso: false })).toBe(
      "precisa_de_nova_aprovacao",
    );
    expect(situacao(aprovada, { nomeAtual: "Colonoscopia com sedação" })).toBe(
      "precisa_de_nova_aprovacao",
    );
    expect(situacao([versao(1, "aprovado", { rtId: null })])).toBe(
      "precisa_de_nova_aprovacao",
    );
    expect(
      situacao([versao(1, "aprovado"), versao(2, "aguardando_rt")], {
        rtComAcesso: false,
      }),
    ).toBe("precisa_de_nova_aprovacao");
  });

  it("aguardando: texto esperando o RT sem aprovada (inclusive depois de suspender)", () => {
    expect(situacao([versao(1, "aguardando_rt")])).toBe("aguardando");
    expect(situacao([versao(1, "suspenso"), versao(2, "aguardando_rt")])).toBe(
      "aguardando",
    );
    expect(situacao([versao(1, "aguardando_rt")], { rtAberto: null })).toBe(
      "aguardando",
    );
  });

  it("suspenso: a ultima aprovada foi suspensa", () => {
    expect(situacao([versao(1, "suspenso")])).toBe("suspenso");
    expect(
      situacao([
        versao(1, "substituido"),
        versao(2, "suspenso"),
        versao(3, "devolvido"),
        versao(4, "descartado"),
      ]),
    ).toBe("suspenso");
  });

  it("sem orientacao: nenhuma versao, ou so devolvidas e descartadas", () => {
    expect(situacao([])).toBe("sem_orientacao");
    expect(situacao([versao(1, "devolvido"), versao(2, "descartado")])).toBe(
      "sem_orientacao",
    );
  });
});
