import { describe, expect, it } from "vitest";

import {
  fatosVazios,
  regrasDosFatos,
  type CoberturaDoTurno,
  type ConvenioDosFatos,
} from "@/lib/domain/conformidade/fatos-do-turno";
import { detectarGatilhosDeEntrada } from "@/lib/domain/conformidade/gatilhos-de-entrada";

// Revisao de 11/11/2026 ("Revise isso para realmente funcionar"): o motor
// de verdade com o Cadastro da teste123 e um roteiro de respostas (sem
// OpenAI) achou perguntas e respostas de recepcao que passavam para a equipe.

const CONVENIOS: ConvenioDosFatos[] = [
  { nome: "Bradesco Saúde", plano: "Nacional Flex e Top" },
  { nome: "Saúde Petrobras", plano: "Nacional" },
  { nome: "Unimed", plano: "Unimed Natal (Estadual e Nacional)" },
];
const PROCEDIMENTO = "Consulta dermatológica";
const ACEITOS: CoberturaDoTurno[] = CONVENIOS.map((c) => ({
  ...c,
  estado: "atende",
  procedimento: PROCEDIMENTO,
}));

function regras(rascunho: string, coberturas: CoberturaDoTurno[] = ACEITOS) {
  return regrasDosFatos(rascunho, {
    fatos: {
      ...fatosVazios(2026),
      convenios: CONVENIOS,
      procedimentos: [PROCEDIMENTO],
      coberturas,
    },
    nomesDoCatalogo: [PROCEDIMENTO, ...CONVENIOS.map((c) => c.nome)],
    mensagensDoPaciente: ["Quais convênios aceitam na consulta dermatológica?"],
  }).map((a) => `${a.categoria}:${a.regra}`);
}

describe("a lista dos aceitos com o plano escrito como lista", () => {
  it("aceitamos a lista que a ferramenta trouxe, com virgula e 'e' dentro do plano, passa", () => {
    for (const texto of [
      "Na consulta dermatológica, aceitamos Bradesco Saúde (Nacional Flex e Top), Saúde Petrobras (Nacional) e Unimed (Unimed Natal (Estadual e Nacional)).",
      "Aceitamos Bradesco Saúde (Nacional Flex e Top).",
      "Aceitamos Unimed (Unimed Natal, Estadual e Nacional).",
    ]) {
      expect(regras(texto), texto).toEqual([]);
    }
  });

  it("o convenio fora do Cadastro e a lista sem fato continuam barrando", () => {
    expect(regras("Aceitamos Humana Saúde e Unimed.")).toContain(
      "cobertura_nao_verificada:aceitacao_sem_fato",
    );
    expect(regras("Aceitamos Bradesco Saúde (Nacional Flex e Top).", [])).toContain(
      "cobertura_nao_verificada:aceitacao_sem_fato",
    );
  });
});

const portao = (texto: string) =>
  detectarGatilhosDeEntrada({ mensagens: [{ tipo: "texto", texto }] });

describe("o portao: a pergunta de recepcao sobre exame passa", () => {
  it.each([
    "Quais exames vocês fazem?",
    "quais exames voces fazem",
    "Que exames vocês realizam?",
    "Quais são os exames que vocês fazem?",
    "Que exames tem aí?",
    "Oi, boa tarde! Quais exames vocês fazem?",
    "Preciso de pedido médico para o exame?",
    "Para o exame precisa de pedido médico?",
    "Fazem exame de ouvido?",
    "Fazem exame de pele?",
    "Vocês fazem exame de coração?",
    "Fazem exame admissional?",
  ])("%s", (texto) => {
    expect(portao(texto)).toEqual([]);
  });

  it.each([
    "quais exames eu preciso fazer?",
    "que exame devo fazer?",
    "quais exames voces fazem pra diabetes?",
    "minha glicose ta alterada, quais exames voces fazem?",
    "preciso fazer exame de sangue?",
    "o exame de pele deu alterado",
    "que exames tem que fazer antes da cirurgia?",
    "preciso de pedido medico pra tomar remedio?",
    "o exame de coracao deu alterado, quanto custa repetir?",
    "quais exames mostram cancer?",
    "meus exames voces fazem?",
  ])("o exame clinico continua escalando: %s", (texto) => {
    expect(portao(texto)).toContain("assunto_clinico");
  });
});
