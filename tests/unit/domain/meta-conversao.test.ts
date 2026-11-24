import { describe, expect, it } from "vitest";

import {
  EVENTOS_MAIS_USADOS,
  EVENTOS_META_PADRAO,
  OUTROS_EVENTOS,
  ehEventoPadrao,
  recomendadoParaAJornada,
  avisoDoWhatsapp,
  eventoNoWhatsapp,
  rotuloDoEvento,
  textoDoRecomendado,
} from "@/lib/domain/meta-conversao";
import { centavosParaReais, reaisParaCentavos } from "@/lib/utils/moeda";

// O catalogo alimenta o Select do mapa de conversao e, depois, o payload do
// CAPI (R4). O nome do evento e o que a Meta recebe LITERALMENTE, entao um
// typo aqui viraria evento desconhecido na conta de anuncios da clinica.

describe("catálogo de eventos da Meta", () => {
  it("tem os 17 eventos padrão, sem duplicata", () => {
    expect(EVENTOS_META_PADRAO).toHaveLength(17);
    const nomes = EVENTOS_META_PADRAO.map((evento) => evento.nome);
    expect(new Set(nomes).size).toBe(17);
  });

  it("os nomes são os literais que a Meta espera, sensíveis a maiúsculas", () => {
    // Amostra dos que o produto sugere (docs/06 D2): errar a caixa aqui
    // mandaria um evento que a Meta não reconhece como padrão.
    for (const nome of ["Lead", "Schedule", "Purchase", "Contact"]) {
      expect(ehEventoPadrao(nome)).toBe(true);
    }
    expect(ehEventoPadrao("purchase")).toBe(false);
    expect(ehEventoPadrao("QualquerCoisa")).toBe(false);
  });

  it("todo rótulo é português com o nome da Meta entre parênteses (pedido do dono em 24/11/2026)", () => {
    for (const evento of EVENTOS_META_PADRAO) {
      expect(evento.rotulo.endsWith(` (${evento.nome})`)).toBe(true);
      expect(evento.rotulo.length).toBeGreaterThan(evento.nome.length + 4);
      expect(evento.rotulo).not.toMatch(/[—–]/);
    }
    expect(rotuloDoEvento("Schedule")).toBe("Agendamento (Schedule)");
    expect(rotuloDoEvento("Lead")).toBe("Novo interessado (Lead)");
  });

  it("os mais usados em clínica têm o quando usar; os outros vão no fim, sem perder nenhum", () => {
    expect(EVENTOS_MAIS_USADOS.map((evento) => evento.nome)).toEqual([
      "Lead",
      "Schedule",
      "Purchase",
    ]);
    // Todos os mais usados valem tambem no anuncio que abre o WhatsApp.
    for (const evento of EVENTOS_MAIS_USADOS) {
      expect(eventoNoWhatsapp(evento.nome)).not.toBeNull();
    }
    expect(EVENTOS_MAIS_USADOS.length + OUTROS_EVENTOS.length).toBe(17);
  });

  it("evento personalizado exibe o próprio nome", () => {
    expect(rotuloDoEvento("MinhaConversaoCustom")).toBe("MinhaConversaoCustom");
    expect(rotuloDoEvento("Purchase")).toBe("Compra (Purchase)");
  });
});

describe("conversão de dinheiro do formulário", () => {
  it("ida e volta preserva os centavos", () => {
    expect(reaisParaCentavos(centavosParaReais(25000))).toBe(25000);
    expect(centavosParaReais(25000)).toBe("250,00");
  });

  it("aceita os jeitos que a recepção digita", () => {
    expect(reaisParaCentavos("250,00")).toBe(25000);
    expect(reaisParaCentavos("250")).toBe(25000);
    expect(reaisParaCentavos("1.250,50")).toBe(125050);
    expect(reaisParaCentavos(" 90,9 ")).toBe(9090);
  });

  it("vazio e inválido viram null, nunca zero", () => {
    // null e "sem valor" sao coisas diferentes de "custa zero": a constraint
    // do banco exige centavos no modo fixo, e o formulario usa o null para
    // pedir o valor de novo.
    expect(reaisParaCentavos("")).toBeNull();
    expect(reaisParaCentavos("abc")).toBeNull();
    expect(reaisParaCentavos("-10")).toBeNull();
    expect(centavosParaReais(null)).toBe("");
  });
});

describe("recomendado para começar", () => {
  const JORNADA = [
    { chave: "novo", nome: "Novo", papel: "entrada" },
    { chave: "em_contato", nome: "Contato inicial", papel: "em_contato" },
    { chave: "agendou", nome: "Agendou", papel: "agendou" },
    { chave: "compareceu", nome: "Consulta feita", papel: "compareceu" },
    { chave: "perdido", nome: "Perdido", papel: "perdido" },
  ];

  it("Novo = Lead, Agendou = Schedule e Compareceu = Purchase com o preço da consulta, pelo papel", () => {
    expect(recomendadoParaAJornada(JORNADA, () => true)).toEqual([
      { chave: "novo", evento: "Lead", valor: "sem" },
      { chave: "agendou", evento: "Schedule", valor: "sem" },
      { chave: "compareceu", evento: "Purchase", valor: "service_link" },
    ]);
  });

  it("nunca troca a escolha da clínica: só preenche a etapa que ainda não envia nada", () => {
    expect(
      recomendadoParaAJornada(JORNADA, (chave) => chave !== "agendou").map(
        (item) => item.chave,
      ),
    ).toEqual(["novo", "compareceu"]);
    expect(recomendadoParaAJornada(JORNADA, () => false)).toEqual([]);
  });

  it("o texto usa os nomes que a clínica deu", () => {
    expect(textoDoRecomendado(JORNADA)).toBe(
      "Novo interessado (Lead) em Novo, Agendamento (Schedule) em Agendou e Compra (Purchase) em Consulta feita, com o preço da consulta.",
    );
    expect(textoDoRecomendado([])).toBe("");
  });
});

describe("o anúncio que abre o WhatsApp (doc da Meta lida em 24/11/2026)", () => {
  it("o recomendado inteiro vale lá: Lead e Schedule com o nome de lá, Purchase igual", () => {
    expect(eventoNoWhatsapp("Lead")).toBe("LeadSubmitted");
    expect(eventoNoWhatsapp("Schedule")).toBe("QualifiedLead");
    expect(eventoNoWhatsapp("Purchase")).toBe("Purchase");
    expect(eventoNoWhatsapp("ViewContent")).toBe("ViewContent");
  });

  it("o que a Meta não aceita lá dá null e a tela avisa em alerta", () => {
    for (const nome of ["Contact", "Search", "Donate", "MeuEventoProprio"]) {
      expect(eventoNoWhatsapp(nome)).toBeNull();
      expect(avisoDoWhatsapp(nome)?.tom).toBe("alerta");
    }
  });

  it("a tela diz o nome de lá quando muda, e não diz nada quando é igual", () => {
    expect(avisoDoWhatsapp("Lead")).toEqual({
      tom: "nota",
      texto:
        "No anúncio que abre o WhatsApp, vai como LeadSubmitted, o nome que a Meta aceita lá.",
    });
    expect(avisoDoWhatsapp("Purchase")).toBeNull();
    for (const nome of ["Lead", "Schedule", "Contact"]) {
      expect(avisoDoWhatsapp(nome)!.texto).not.toMatch(/[—–]/);
    }
  });
});
