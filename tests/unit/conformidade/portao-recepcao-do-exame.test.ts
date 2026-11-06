import { beforeAll, describe, expect, it, vi } from "vitest";

import { filtrarSaida } from "@/lib/domain/conformidade/filtro";
import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import {
  detectarGatilhosDeEntrada,
  FONTES_DO_PORTAO_EM_CODIGO,
} from "@/lib/domain/conformidade/gatilhos-de-entrada";
import { detectarUrgencia } from "@/lib/domain/conformidade/urgencia";
import { FONTES_DA_RECEPCAO_DO_EXAME } from "@/lib/domain/conformidade/padroes";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import {
  CASOS_DE_URGENCIA,
  RAJADAS_DE_URGENCIA,
  URGENCIAS_DO_REV4,
} from "@/tests/fixtures/ia/conformidade/casos-ag6";
import { SONDAS_DO_EXAME_DA_REVISAO_R2 } from "@/tests/fixtures/ia/conformidade/casos-ag6b";
import { URGENTES_DA_REV5 } from "@/tests/fixtures/ia/conformidade/urgentes-da-rev5";

// Decisao do dono de 06/11/2026 ("preciso que nem tudo vá para a equipe"): o
// pedido de recepcao sobre o exame (preco, convenio, agenda, se a clinica faz,
// ter um pedido do medico) nao escala mais pelo portao. Trava permanente: o
// conteudo clinico na mesma mensagem ou na mesma rajada continua escalando, e
// a lista de urgencia e a rede de seguranca nao mudam. Nenhum teste chama a
// OpenAI.

const portao = (...textos: string[]) =>
  detectarGatilhosDeEntrada({
    mensagens: textos.map((texto) => ({ tipo: "texto", texto })),
  });

// A primeira leitura compila as regex do portao: segundos na maquina carregada,
// o que estourava o prazo do primeiro caso (sem relacao com a regra testada).
beforeAll(() => {
  portao("oi");
}, 60_000);

const PEDIDOS_DE_RECEPCAO = [
  // Os do defeito, como o dono viu.
  "quanto custa esse exame?",
  "quero agendar esse exame",
  "quero agendar esses exames",
  "quero marcar o exame do pedido",
  "meu médico pediu esse exame, vocês fazem?",
  "vocês fazem esse exame?",
  "vocês fazem esses exames?",
  "tenho um pedido de exame",
  // Preco.
  "Oi, boa tarde! Quanto fica esse exame?",
  "gostaria de saber o valor desse exame",
  "queria um orçamento desses exames",
  "esses exames, quanto custa?",
  // Convenio.
  "a unimed cobre esse exame?",
  "aceita amil pra esses exames?",
  "meu plano cobre esses exames?",
  // Agenda.
  "como faço pra marcar esse exame?",
  "quero remarcar meu exame pra sexta",
  "pode cancelar o exame de amanhã?",
  "tem vaga pra esse exame na segunda de manhã?",
  // Se a clinica faz.
  "esse exame vocês fazem?",
  "vcs fazem exame de urina?",
  // O pedido do medico.
  "estou com o pedido do médico pra esse exame",
  "o médico pediu esses exames, aceita bradesco?",
];

const CLINICOS = [
  "minha glicose ta alterada, quanto custa esses exames?",
  "vale a pena fazer esses exames?",
  "meu exame deu alterado",
  "o que significa esse resultado?",
  "esse exame pode ser tumor?",
  "preciso fazer esse exame?",
  "esse exame dói?",
  "quanto custa esse exame, to com muita dor",
  "qual exame eu devo fazer?",
  "o médico pediu porque estou com tontura, quanto custa?",
  // A necessidade, a opiniao e a permissao.
  "vc faria esse exame?",
  "posso cancelar esse exame?",
  "tenho que fazer esse exame?",
  "esse exame é obrigatório?",
  "como funciona esse exame?",
  "esse exame é perigoso?",
  // O exame sem pedido nenhum, e o resultado da propria pessoa.
  "exames",
  "meus exames",
  "esses exames aqui",
  "seguem os exames",
  // O nome fora da lista fechada.
  "quero marcar esse exame de urgencia",
  "quanto custa esse exame de tumor?",
  // A mesma regra na pergunta de preco com o artigo, que antes passava.
  "minha glicose ta alterada, quanto custa o exame?",
  "to com anemia, vcs fazem o exame?",
  "meu colesterol ta alto, qual o valor do exame?",
];

describe("decisao de 06/11/2026: o pedido de recepcao sobre o exame", () => {
  it.each(PEDIDOS_DE_RECEPCAO)("nao escala pelo portao: %s", (texto) => {
    expect(portao(texto)).toEqual([]);
  });

  it("vale tambem partido em mensagens e com o cumprimento em outra", () => {
    expect(portao("oi", "quanto custa esse exame?")).toEqual([]);
    expect(portao("esses exames", "quanto custa?")).toEqual([]);
    expect(portao("quanto custa esse exame?", "aceita unimed?")).toEqual([]);
  });

  it("o molde entra na versao do portao", () => {
    expect(FONTES_DO_PORTAO_EM_CODIGO).toEqual(
      expect.arrayContaining([...FONTES_DA_RECEPCAO_DO_EXAME]),
    );
  });

  it("o filtro de saida nao barra a resposta pelo contexto, e os outros gatilhos seguem", () => {
    const contexto = {
      mensagensDoPaciente: ["quanto custa esse exame?"],
      nomesDoCatalogo: ["Hemograma"],
      precosDoTurno: [5_000],
    };
    expect(
      avaliarRegras("O hemograma custa R$ 50,00.", contexto).achados.map(
        (a) => a.regra,
      ),
    ).not.toContain("contexto:assunto_clinico");
    // A letra trocada para escapar da palavra continua no gatilho de sempre.
    expect(portao("QUERO AGENDAR ESSES EXAMES PRA SEXTA")).toEqual([
      "insatisfacao",
    ]);
    expect(portao("qu4nto cust4 esse ex4me")).toEqual(["assunto_clinico"]);
  });

  it("o molde e barato no pior texto que ele aceita ler", () => {
    const inicio = performance.now();
    for (const pedaco of [
      "quero marcar o exame de amanha ",
      "tem exame hoje de manha ",
      "oi ",
      "e ",
    ]) {
      portao(`${pedaco.repeat(Math.floor(299 / pedaco.length))}x`);
    }
    expect(performance.now() - inicio).toBeLessThan(1_000);
  });
});

describe("trava permanente: o conteudo clinico continua escalando", () => {
  it.each(CLINICOS)("na mensagem: %s", (texto) => {
    expect(portao(texto)).not.toEqual([]);
  });

  it.each(SONDAS_DO_EXAME_DA_REVISAO_R2.map((c) => [c.id, c.texto] as const))(
    "%s: a sonda do revisor nas duas ordens da rajada",
    (_id, texto) => {
      expect(portao(texto)).toContain("assunto_clinico");
      expect(portao(texto, "quanto custa esse exame?")).toContain(
        "assunto_clinico",
      );
      expect(portao("quanto custa esse exame?", texto)).toContain(
        "assunto_clinico",
      );
    },
  );

  // O que o portao sozinho nao reconhece como clinico: so o molde do turno
  // inteiro segura o exame escalando.
  it.each([
    "minha glicose ta alterada",
    "to com anemia",
    "meu colesterol ta muito alto",
    "pode ser tumor",
    "o medico acha que eu to com anemia",
    "fiz semana passada e veio 300",
  ])("na rajada, com a frase sem palavra do lexico: %s", (frase) => {
    for (const pedido of [
      "quanto custa esses exames?",
      "quero marcar esses exames",
      "quanto custa o exame?",
      "tenho um pedido de exame",
    ]) {
      expect(portao(frase, pedido), pedido).toContain("assunto_clinico");
      expect(portao(pedido, frase), pedido).toContain("assunto_clinico");
    }
  });

  it("o nome fora da lista nao entra pela rajada", () => {
    expect(portao("quero marcar esses exames", "de calmante")).toContain(
      "assunto_clinico",
    );
  });

  it("o contexto clinico da rajada continua barrando o rascunho", async () => {
    const contexto = {
      mensagensDoPaciente: [
        "minha glicose ta alterada",
        "quanto custa esses exames?",
      ],
      nomesDoCatalogo: ["Hemograma"],
      precosDoTurno: [5_000],
    };
    const verificador = vi.fn<Verificador>();
    const decisao = await filtrarSaida({
      rascunho: "O hemograma custa R$ 50,00.",
      contexto,
      verificador,
    });
    expect(decisao).toMatchObject({ aprovado: false, camada: "regra" });
    expect(verificador).not.toHaveBeenCalled();
  });
});

describe("trava permanente: a urgencia e a rede de seguranca nao mudam", () => {
  const PEDIDO = "quanto custa esse exame?";

  it.each(CASOS_DE_URGENCIA.map((c) => [c.id, c.texto] as const))(
    "%s: junto do pedido de recepcao, continua urgente",
    (_id, texto) => {
      expect(detectarUrgencia([texto])).not.toBeNull();
      expect(portao(texto)).toContain("urgencia");
      expect(portao(texto, PEDIDO)).toContain("urgencia");
      expect(portao(PEDIDO, texto)).toContain("urgencia");
      expect(portao(`${PEDIDO} ${texto}`)).toContain("urgencia");
    },
  );

  it("as rajadas urgentes, com o pedido junto", () => {
    for (const { id, mensagens } of RAJADAS_DE_URGENCIA) {
      expect(
        detectarGatilhosDeEntrada({
          mensagens: [{ tipo: "texto", texto: PEDIDO }, ...mensagens],
        }),
        id,
      ).toContain("urgencia");
    }
  }, 60_000);

  it("as urgentes das revisoes escalam mesmo sem a lista de urgencia", () => {
    for (const lista of [URGENCIAS_DO_REV4, URGENTES_DA_REV5]) {
      for (const item of lista) {
        const textos = typeof item === "string" ? [item] : [...item];
        const semUrgencia = portao(PEDIDO, ...textos).filter(
          (g) => g !== "urgencia",
        );
        expect(semUrgencia, textos.join(" | ")).not.toEqual([]);
      }
    }
  }, 60_000);
});
