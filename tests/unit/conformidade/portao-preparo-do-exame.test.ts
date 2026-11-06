import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  citacaoDoProcedimento,
  FERRAMENTA_ENVIAR_PREPARO,
} from "@/lib/agente/ferramentas/enviar-preparo";
import { SECAO_DA_ORIENTACAO_DE_PREPARO } from "@/lib/agente/prompt";
import { filtrarSaida, versaoDoPortao } from "@/lib/domain/conformidade/filtro";
import {
  avaliarRegras,
  situacaoPessoalNoPedidoDoPreparo,
} from "@/lib/domain/conformidade/filtro-deterministico";
import { detectarGatilhosDeEntrada } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import {
  FRASE_DO_PREPARO_COM_A_HABILIDADE,
  POLITICA_DO_CLASSIFICADOR,
  POLITICA_DO_CLASSIFICADOR_COM_PREPARO,
} from "@/lib/integrations/llm/classificador-de-entrada";
import {
  CASOS_DE_URGENCIA,
  RAJADAS_DE_URGENCIA,
  URGENCIAS_DO_REV4,
} from "@/tests/fixtures/ia/conformidade/casos-ag6";
import { URGENTES_DA_REV5 } from "@/tests/fixtures/ia/conformidade/urgentes-da-rev5";

// Decisao do dono de 06/11/2026 (opcao A dos remedios; D-80, CLAUDE.md 3.2): a
// pergunta do preparo e do remedio do exame nao vai mais para a equipe quando a
// clinica tem a habilidade "Enviar orientacao de preparo", porque a saida dela
// e o enviar_preparo, o texto aprovado pelo RT palavra por palavra. Mesma
// tecnica do molde do exame: lista fechada, turno inteiro. Trava permanente: a
// situacao da pessoa, o remedio pelo nome e a duvida continuam escalando, e a
// urgencia e a rede nao mudam. O laco esta em motor-ag7-preparo.test.ts. Nenhum
// teste chama a OpenAI.

const portao = (comPreparo: boolean, ...textos: string[]) =>
  detectarGatilhosDeEntrada({
    mensagens: textos.map((texto) => ({ tipo: "texto", texto })),
    comPreparo,
  });

// A primeira leitura compila as regex do portao: segundos na maquina carregada.
beforeAll(() => {
  portao(true, "oi");
}, 60_000);

const PERGUNTAS = [
  // As da decisao.
  "qual o preparo do exame?",
  "como é o preparo do exame?",
  "precisa de jejum pro exame?",
  "e o remédio do exame, como eu tomo?",
  "como eu tomo o remédio do exame?",
  "qual remédio eu tomo antes do exame?",
  "tem algum remédio para tomar antes do exame?",
  "como tomo o remédio do preparo?",
  // Grafia e ordem.
  "Qual é o preparo desse exame?",
  "preparo do exame?",
  "me manda o preparo do exame",
  "pode me mandar a orientação de preparo do exame?",
  "quero receber o preparo desse exame",
  "esse exame tem preparo?",
  "tem preparo pro exame?",
  "o exame precisa de jejum?",
  "esse exame é em jejum?",
  "pra esse exame precisa de jejum?",
  "tem que fazer jejum pra fazer esse exame?",
  "precisa ficar em jejum pro exame?",
  "como tomar o remédio do exame?",
  "como que eu tomo o remedio do exame",
  "como devo tomar o medicamento do exame?",
  "como eu tomo o preparo do exame?",
  "o remédio do preparo, como eu tomo?",
  "qual o remédio do exame?",
  "quais os remédios do preparo?",
  "que remédio tomar antes do exame?",
  "precisa tomar algum remédio antes do exame?",
  "tem remédio no preparo?",
  "o exame tem remédio?",
  "o preparo tem remédio?",
  "qual o preparo do exame de amanhã?",
  "Oi, boa tarde! Como eu tomo o remédio do exame?",
  // Junto do pedido de recepcao.
  "quanto custa o exame? precisa de jejum?",
  "quero marcar esses exames, qual o preparo?",
  "me chamo Ana, como eu tomo o remédio do exame?",
];

const TRAVAS = [
  // As da decisao.
  "posso tomar o remédio com leite?",
  "esqueci de tomar o remédio do exame",
  "tomei o remédio e passei mal",
  "qual remédio eu tomo pra dor?",
  "posso tomar dipirona antes do exame?",
  "tomo remédio de pressão, posso fazer o exame?",
  "preciso parar o remédio antes do exame?",
  "quanto de remédio eu tomo?",
  "sou diabética, qual o preparo do exame?",
  "to grávida, como é o preparo?",
  "me chamo Ana e to com dor, quanto custa o exame?",
];

const SO_NO_PORTAO = [
  // O remedio sem ser do exame, pelo nome, e a duvida sobre ele.
  "como eu tomo esse remédio?",
  "como eu tomo o remédio?",
  "qual remédio eu tomo?",
  "como eu tomo dipirona antes do exame?",
  "como eu tomo o manitol do exame?",
  "como eu tomo o remédio de pressão?",
  "posso tomar o remédio do exame?",
  "tomo o remédio do exame?",
  "como eu tomo o remédio do exame com leite?",
  "pra que serve o remédio do exame?",
  "o remédio do exame faz mal?",
  "qual o preparo do exame, tô com diarreia",
  "precisa de jejum pro exame? sou diabética",
  "minha glicose ta alta, qual o preparo do exame?",
  // O nome: so "me chamo" e "meu nome e", com ate duas palavras.
  "me chamo Ana Maria Souza, quanto custa o exame?",
  "me chamo Ana tenho anemia, quanto custa o exame?",
  "sou a Ana, quanto custa o exame?",
  "aqui é a Ana, quanto custa o exame?",
];

describe("com a habilidade, a pergunta chega ao agente", () => {
  it.each(PERGUNTAS)("%s", (texto) => {
    expect(portao(true, texto)).toEqual([]);
  });

  it("partida em mensagens, e com o cumprimento em outra", () => {
    expect(portao(true, "e o remédio do exame", "como eu tomo?")).toEqual([]);
    expect(portao(true, "oi", "qual o preparo do exame?")).toEqual([]);
  });
});

describe("sem a habilidade, o portao escala como sempre", () => {
  it.each(PERGUNTAS)("%s", (texto) => {
    expect(portao(false, texto)).toContain("assunto_clinico");
  });

  it("o padrao e sem a habilidade", () => {
    expect(
      detectarGatilhosDeEntrada({
        mensagens: [{ tipo: "texto", texto: "como eu tomo o remédio do exame?" }],
      }),
    ).toContain("assunto_clinico");
  });
});

describe("trava permanente: continua escalando, com e sem a habilidade", () => {
  it.each([...TRAVAS, ...SO_NO_PORTAO])("%s", (texto) => {
    expect(portao(true, texto)).not.toEqual([]);
    expect(portao(false, texto)).not.toEqual([]);
  });

  // O que o portao sozinho nao reconhece: so o molde do turno inteiro segura.
  it.each([
    "minha glicose ta alta",
    "to com anemia",
    "fiz cirurgia mes passado",
    "dipirona",
    "de pressão",
  ])("na mesma rajada, nas duas ordens: %s", (frase) => {
    for (const pergunta of [
      "qual o preparo do exame?",
      "como eu tomo o remédio do exame?",
      "precisa de jejum pro exame?",
    ]) {
      expect(portao(true, frase, pergunta), pergunta).toContain(
        "assunto_clinico",
      );
      expect(portao(true, pergunta, frase), pergunta).toContain(
        "assunto_clinico",
      );
    }
  });
});

describe("o nome antes do pedido", () => {
  it.each([
    "oi, me chamo Ana, quanto custa o exame?",
    "meu nome é Ana Maria, quero marcar esse exame",
    "Me chamo Ana. Vocês fazem esse exame?",
    "me chamo Socorro, quanto custa o exame?",
  ])("%s", (texto) => {
    expect(portao(false, texto)).toEqual([]);
  });

  it("o nome com palavra do lexico continua lido pelos padroes", () => {
    expect(portao(false, "me chamo Ana diabetica, quanto custa o exame?")).toContain(
      "assunto_clinico",
    );
  });
});

describe("a CFM-6: como eu tomo nao e situacao da pessoa", () => {
  it.each(PERGUNTAS)("%s", (texto) => {
    expect(situacaoPessoalNoPedidoDoPreparo([texto], [])).toBe(false);
  });

  it.each(TRAVAS)("%s e", (texto) => {
    expect(situacaoPessoalNoPedidoDoPreparo([texto], [])).toBe(true);
  });

  it("qualquer pendente conta, e o nome do catalogo tambem e o exame", () => {
    expect(
      situacaoPessoalNoPedidoDoPreparo(
        ["como eu tomo o remédio do exame?", "tomo remédio de pressão"],
        [],
      ),
    ).toBe(true);
    expect(
      situacaoPessoalNoPedidoDoPreparo(
        ["qual remédio eu tomo antes da colonoscopia?"],
        ["Colonoscopia"],
      ),
    ).toBe(false);
  });
});

describe("a CFM-7: o exame sem nome nao confirma procedimento nenhum", () => {
  const catalogo = {
    procedimentos: [
      { codigo: "p1", id: "a1", nome: "Exame de sangue" },
      { codigo: "p2", id: "a2", nome: "Colonoscopia" },
      { codigo: "p3", id: "a3", nome: "Exame" },
    ],
  };

  it.each(["a1", "a2", "a3"])("o procedimento %s, com o exame sem nome", (id) => {
    expect(
      citacaoDoProcedimento(catalogo, id, ["qual o preparo do exame?"]),
    ).toBe("nenhum");
    expect(
      citacaoDoProcedimento(catalogo, id, ["como eu tomo o remédio do exame?"]),
    ).toBe("nenhum");
  });

  it("o nome de verdade confirma so ele", () => {
    expect(
      citacaoDoProcedimento(catalogo, "a1", ["qual o preparo do exame de sangue?"]),
    ).toBe("confirmado");
    expect(
      citacaoDoProcedimento(catalogo, "a2", ["qual o preparo do exame de sangue?"]),
    ).toBe("outro");
  });
});

describe("o classificador: a politica trata o pedido como nenhum, sem medicao paga", () => {
  it("so a variante com a habilidade diz isso", () => {
    const trecho =
      "Perguntar como tomar o remédio do exame ou do preparo, ou que remédio ele pede, sem dizer um remédio pelo nome e sem contar uma situação da própria pessoa, também é nenhum.";
    expect(FRASE_DO_PREPARO_COM_A_HABILIDADE).toContain(trecho);
    expect(POLITICA_DO_CLASSIFICADOR_COM_PREPARO).toContain(trecho);
    expect(POLITICA_DO_CLASSIFICADOR).not.toContain(trecho);
  });

  it("o que continua assunto_clinico esta escrito, e o de sempre nao saiu", () => {
    for (const trecho of [
      "Também continua assunto_clinico: um remédio dito pelo nome, quanto tomar e se pode parar um remédio.",
      "a dúvida sobre o preparo aplicada à pessoa (um remédio que toma, uma doença, gravidez, se pode comer ou beber algo, o que fazer se esqueceu ou não conseguiu seguir)",
      "a dúvida sobre o texto recebido e os cuidados depois do procedimento",
    ]) {
      expect(FRASE_DO_PREPARO_COM_A_HABILIDADE).toContain(trecho);
    }
    expect(FRASE_DO_PREPARO_COM_A_HABILIDADE).not.toMatch(/[–—]/);
  });
});

describe("as instrucoes do agente: a saida e so o enviar_preparo", () => {
  it("o pedido e a ferramenta; o modelo nao responde com as palavras dele", () => {
    expect(SECAO_DA_ORIENTACAO_DE_PREPARO).toContain(
      "Perguntar como tomar o remédio do exame ou do preparo, ou que remédio ele pede, sem dizer um remédio pelo nome e sem contar uma situação dela, também é pedir a orientação de preparo: chame enviar_preparo, nunca responda com suas palavras.",
    );
    expect(SECAO_DA_ORIENTACAO_DE_PREPARO).toContain(
      'Um remédio dito pelo nome, quanto tomar e se pode parar um remédio vão para a equipe com o motivo "assunto_clinico".',
    );
    expect(SECAO_DA_ORIENTACAO_DE_PREPARO).toContain(
      "Você nunca escreve orientação de preparo",
    );
    expect(FERRAMENTA_ENVIAR_PREPARO.name).toBe("enviar_preparo");
  });
});

describe("o filtro de saida: o que o modelo escreve barra como hoje", () => {
  const contexto = (mensagem: string, comPreparo: boolean) => ({
    mensagensDoPaciente: [mensagem],
    nomesDoCatalogo: ["Colonoscopia"],
    precosDoTurno: [],
    comPreparo,
  });
  const REMEDIO = "como eu tomo o remédio do exame?";

  it.each([
    "Você toma com bastante água.",
    "É só tomar à noite.",
    "O remédio é tomado na véspera.",
    "Tome 1 comprimido às 18h.",
    "Sim, 2 comprimidos.",
    "Não precisa.",
    "Precisa de jejum de 8 horas.",
    "Toma o bisacodil às 18h.",
    "Para o exame é só jejum.",
    "De qual exame é o remédio?",
  ])("%s", async (rascunho) => {
    const verificador = vi.fn<Verificador>();
    const decisao = await filtrarSaida({
      rascunho,
      contexto: contexto(REMEDIO, true),
      verificador,
    });
    expect(decisao).toMatchObject({ aprovado: false, camada: "regra" });
    expect(verificador).not.toHaveBeenCalled();
  });

  it.each([
    "Qual é o exame?",
    "Para qual procedimento você quer a orientação de preparo?",
    "Quer receber a orientação de preparo da Colonoscopia?",
  ])("a pergunta do procedimento e a oferta passam pela regra: %s", (rascunho) => {
    expect(avaliarRegras(rascunho, contexto(REMEDIO, true)).achados).toEqual([]);
  });

  it("sem a habilidade, o contexto clinico continua barrando tudo", () => {
    expect(
      avaliarRegras("Qual é o exame?", contexto(REMEDIO, false)).achados.map(
        (a) => a.regra,
      ),
    ).toContain("contexto:assunto_clinico");
  });

  it.each(TRAVAS)("o contexto clinico barra com a habilidade: %s", (mensagem) => {
    expect(
      avaliarRegras("Qual é o exame?", contexto(mensagem, true)).categorias,
    ).not.toEqual([]);
  });
});

describe("trava permanente: a urgencia e a rede de seguranca nao mudam", () => {
  const PEDIDO = "como eu tomo o remédio do exame?";

  it.each(CASOS_DE_URGENCIA.map((c) => [c.id, c.texto] as const))(
    "%s: junto da pergunta, continua urgente",
    (_id, texto) => {
      expect(portao(true, texto)).toContain("urgencia");
      expect(portao(true, texto, PEDIDO)).toContain("urgencia");
      expect(portao(true, PEDIDO, texto)).toContain("urgencia");
      expect(portao(true, `${PEDIDO} ${texto}`)).toContain("urgencia");
    },
  );

  it("as rajadas urgentes, com a pergunta junto", () => {
    for (const { id, mensagens } of RAJADAS_DE_URGENCIA) {
      expect(
        detectarGatilhosDeEntrada({
          mensagens: [{ tipo: "texto", texto: PEDIDO }, ...mensagens],
          comPreparo: true,
        }),
        id,
      ).toContain("urgencia");
    }
  }, 60_000);

  it("as urgentes das revisoes escalam mesmo sem a lista de urgencia", () => {
    for (const lista of [URGENCIAS_DO_REV4, URGENTES_DA_REV5]) {
      for (const item of lista) {
        const semUrgencia = portao(true, PEDIDO, ...item).filter(
          (g) => g !== "urgencia",
        );
        expect(semUrgencia, item.join(" | ")).not.toEqual([]);
      }
    }
  }, 60_000);

  it("o molde nao abre a urgencia nem a rede: o arquivo da urgencia nao importa o molde", () => {
    const fonte = readFileSync("lib/domain/conformidade/urgencia.ts", "utf-8");
    expect(fonte).not.toMatch(/PALAVRAS_DA_RECEPCAO|cabeNaRecepcaoDoExame/);
  });
});

describe("a versao do portao", () => {
  it("mudou com o molde do preparo", () => {
    expect(versaoDoPortao()).toMatch(/^portao-[0-9a-f]{12}$/);
    expect(versaoDoPortao()).not.toBe("portao-ac8922f0785a");
  });
});
