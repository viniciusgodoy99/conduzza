import { describe, expect, it } from "vitest";

import {
  etapaPorTermoChave,
  termoValePara,
  type QuemEscreveu,
  type TermosDeQuem,
} from "@/lib/domain/jornada";

// Aceite da fase 4 da jornada configuravel: a decisao pura de mover contato
// por termo-chave. As regras de protecao (nunca sair de nem entrar em perda,
// so andar para frente) sao o que impede palavra solta de estragar o funil.

type Etapa = {
  chave: string;
  posicao: number;
  papel: "entrada" | "agendou" | "compareceu" | "perdido" | null;
  termos_chave: string[];
  termos_de_quem: TermosDeQuem;
};

function etapa(
  chave: string,
  posicao: number,
  termos: string[] = [],
  papel: Etapa["papel"] = null,
  termosDeQuem: TermosDeQuem = "paciente",
): Etapa {
  return {
    chave,
    posicao,
    papel,
    termos_chave: termos,
    termos_de_quem: termosDeQuem,
  };
}

// As regras de sempre sao provadas com o texto do PACIENTE (o padrao de toda
// etapa que ja existia); o bloco de "quem escreve o termo" vem no fim.
const P: QuemEscreveu = "paciente";

const jornada: Etapa[] = [
  etapa("novo", 10, [], "entrada"),
  etapa("em_contato", 20, ["quero saber"]),
  etapa("orcamento", 30, ["valor", "quanto custa"]),
  etapa("agendou", 40, ["agendar"], "agendou"),
  etapa("compareceu", 50, [], "compareceu"),
  etapa("perdido", 60, ["nao quero"], "perdido"),
];

describe("etapaPorTermoChave", () => {
  it("corpo vazio ou nulo não move", () => {
    expect(etapaPorTermoChave(null, "novo", jornada, P)).toBeNull();
    expect(etapaPorTermoChave("   ", "novo", jornada, P)).toBeNull();
  });

  it("etapa atual fora da jornada (cache velho) não move", () => {
    expect(
      etapaPorTermoChave("valor", "etapa_fantasma", jornada, P),
    ).toBeNull();
  });

  it("termo casa e move para a etapa dele", () => {
    const destino = etapaPorTermoChave(
      "oi, qual o valor da consulta?",
      "novo",
      jornada,
      P,
    );
    expect(destino?.chave).toBe("orcamento");
  });

  it("normaliza acento e maiúsculas dos dois lados", () => {
    const comAcento: Etapa[] = [
      etapa("novo", 10, [], "entrada"),
      etapa("avaliacao", 20, ["avaliação"]),
    ];
    expect(
      etapaPorTermoChave("Quero uma AVALIAÇÃO", "novo", comAcento, P)?.chave,
    ).toBe("avaliacao");
    expect(
      etapaPorTermoChave("quero uma avaliacao", "novo", comAcento, P)?.chave,
    ).toBe("avaliacao");
  });

  it("só anda para frente: termo de etapa anterior não volta o contato", () => {
    expect(
      etapaPorTermoChave("quero saber mais", "agendou", jornada, P),
    ).toBeNull();
  });

  it("termo da própria etapa não move (posição igual não é para frente)", () => {
    expect(etapaPorTermoChave("o valor", "orcamento", jornada, P)).toBeNull();
  });

  it("nunca move PARA a etapa de perda, mesmo com termo configurado nela", () => {
    expect(etapaPorTermoChave("nao quero", "novo", jornada, P)).toBeNull();
  });

  it("nunca move contato que ESTÁ na etapa de perda", () => {
    expect(
      etapaPorTermoChave("quero agendar", "perdido", jornada, P),
    ).toBeNull();
  });

  it("o termo mais longo vence, como na atribuição de campanha", () => {
    // "quanto custa" (12) esta em orcamento; "agendar" (7) em agendou.
    const destino = etapaPorTermoChave(
      "quanto custa? ja quero agendar",
      "novo",
      jornada,
      P,
    );
    expect(destino?.chave).toBe("orcamento");
  });

  it("empate de comprimento fica com a etapa mais cedo na jornada", () => {
    const empatada: Etapa[] = [
      etapa("novo", 10, [], "entrada"),
      etapa("a", 20, ["pacote"]),
      etapa("b", 30, ["exames"]),
    ];
    expect(
      etapaPorTermoChave("quero pacote de exames", "novo", empatada, P)?.chave,
    ).toBe("a");
  });

  it("termo vazio ou só espaço na configuração nunca casa", () => {
    const suja: Etapa[] = [
      etapa("novo", 10, [], "entrada"),
      etapa("x", 20, ["", "  "]),
    ];
    expect(etapaPorTermoChave("qualquer texto", "novo", suja, P)).toBeNull();
  });
});

// "Quem escreve o termo" (pedido do dono em 02/10/2026): cada etapa diz se o
// termo vale quando o paciente escreve, quando a clinica escreve (pelo
// sistema ou pelo celular conectado) ou nos dois casos. As regras de sempre
// (mais longo vence, so para frente, perda intocavel) valem igual.
describe("etapaPorTermoChave: quem escreve o termo", () => {
  const mista: Etapa[] = [
    etapa("novo", 10, [], "entrada"),
    etapa("boas_vindas", 20, ["seja bem-vinda à clínica"], null, "clinica"),
    etapa("orcamento", 30, ["quanto custa"], null, "paciente"),
    etapa("proposta", 40, ["proposta"], null, "qualquer"),
    etapa("agendou", 50, [], "agendou"),
    etapa("perdido", 60, ["desisto"], "perdido", "qualquer"),
  ];

  it("termo de etapa da clínica move quando a clínica escreve", () => {
    expect(
      etapaPorTermoChave(
        "Olá! Seja bem-vinda à Clínica Salud Care",
        "novo",
        mista,
        "clinica",
      )?.chave,
    ).toBe("boas_vindas");
  });

  it("termo de etapa da clínica NÃO move quando é o paciente que escreve", () => {
    expect(
      etapaPorTermoChave(
        "me disseram: seja bem-vinda à clínica",
        "novo",
        mista,
        "paciente",
      ),
    ).toBeNull();
  });

  it("termo de etapa do paciente NÃO move quando é a clínica que escreve", () => {
    expect(
      etapaPorTermoChave(
        "Quanto custa? Custa R$ 200",
        "novo",
        mista,
        "clinica",
      ),
    ).toBeNull();
    expect(
      etapaPorTermoChave("quanto custa?", "novo", mista, "paciente")?.chave,
    ).toBe("orcamento");
  });

  it("etapa de qualquer um move pelos dois lados", () => {
    expect(
      etapaPorTermoChave("segue a proposta", "novo", mista, "clinica")?.chave,
    ).toBe("proposta");
    expect(
      etapaPorTermoChave("recebi a proposta", "novo", mista, "paciente")?.chave,
    ).toBe("proposta");
  });

  it("o termo mais longo vence só entre as etapas que aceitam quem escreveu", () => {
    // "quanto custa" (12) e mais longo que "proposta" (8), mas e termo do
    // paciente: quando a clinica escreve os dois, vence a proposta.
    expect(
      etapaPorTermoChave("quanto custa a proposta", "novo", mista, "clinica")
        ?.chave,
    ).toBe("proposta");
    expect(
      etapaPorTermoChave("quanto custa a proposta", "novo", mista, "paciente")
        ?.chave,
    ).toBe("orcamento");
  });

  it("termo da clínica também só anda para frente", () => {
    expect(
      etapaPorTermoChave(
        "seja bem-vinda à clínica de novo",
        "proposta",
        mista,
        "clinica",
      ),
    ).toBeNull();
  });

  it("perda continua intocável pelos dois lados, mesmo com etapa de qualquer um", () => {
    expect(etapaPorTermoChave("desisto", "novo", mista, "clinica")).toBeNull();
    expect(etapaPorTermoChave("desisto", "novo", mista, "paciente")).toBeNull();
    expect(
      etapaPorTermoChave("segue a proposta", "perdido", mista, "clinica"),
    ).toBeNull();
  });
});

describe("termoValePara", () => {
  it("cada configuração aceita exatamente os lados certos", () => {
    expect(termoValePara("paciente", "paciente")).toBe(true);
    expect(termoValePara("paciente", "clinica")).toBe(false);
    expect(termoValePara("clinica", "clinica")).toBe(true);
    expect(termoValePara("clinica", "paciente")).toBe(false);
    expect(termoValePara("qualquer", "paciente")).toBe(true);
    expect(termoValePara("qualquer", "clinica")).toBe(true);
  });

  it("valor desconhecido (cache velho) não aceita ninguém", () => {
    const estranho = "todos" as TermosDeQuem;
    expect(termoValePara(estranho, "paciente")).toBe(false);
    expect(termoValePara(estranho, "clinica")).toBe(false);
  });
});
