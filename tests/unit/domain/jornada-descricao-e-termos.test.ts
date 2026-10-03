import { describe, expect, it } from "vitest";

import { RECUSA_DA_ETAPA_USADA } from "@/lib/domain/automacoes-de-fluxo";
import {
  AJUDA_QUEM_ESCREVE,
  LIMITE_DA_DESCRICAO,
  OPCOES_TERMOS_DE_QUEM,
  TERMOS_DE_QUEM,
  ajudaDosTermos,
  algumaEtapaComDescricao,
  normalizarDescricaoDaEtapa,
  resumoDosTermos,
  traduzirRecusaDaJornada,
} from "@/lib/domain/jornada";

// Pedido do dono em 02/10/2026, itens 0 e 1 do plano "Automacoes de fluxo e
// CRM": "quem escreve o termo" por etapa e a descricao da etapa no Kanban.
// Aqui ficam as partes puras que a tela Jornada, a action e o Kanban usam:
// os textos por quem escreve, a normalizacao da descricao (o check do banco
// recusa string vazia), a reserva de altura e a traducao das recusas.

const TRAVESSOES = /[–—]/;

describe("quem escreve o termo: opções e textos", () => {
  it("as opções da tela são exatamente os valores do check do banco, na mesma ordem", () => {
    expect(OPCOES_TERMOS_DE_QUEM.map((opcao) => opcao.valor)).toEqual([
      ...TERMOS_DE_QUEM,
    ]);
    expect(TERMOS_DE_QUEM).toEqual(["paciente", "clinica", "qualquer"]);
    expect(OPCOES_TERMOS_DE_QUEM.map((opcao) => opcao.rotulo)).toEqual([
      "Paciente",
      "Clínica",
      "Qualquer um",
    ]);
  });

  it("a linha recolhida diz quem escreve, no singular e no plural", () => {
    expect(resumoDosTermos(1, "paciente")).toBe("termo escrito pelo paciente");
    expect(resumoDosTermos(3, "paciente")).toBe(
      "termos escritos pelo paciente",
    );
    expect(resumoDosTermos(2, "clinica")).toBe("termos escritos pela clínica");
    expect(resumoDosTermos(1, "qualquer")).toBe(
      "termo escrito por qualquer um",
    );
  });

  it("a ajuda do bloco de termos muda com quem escreve e mantém as travas", () => {
    expect(ajudaDosTermos("paciente")).toMatch(/^Quando o paciente escrever/);
    expect(ajudaDosTermos("clinica")).toMatch(/^Quando a clínica escrever/);
    expect(ajudaDosTermos("clinica")).toContain(
      "pelo sistema ou pelo celular conectado",
    );
    expect(ajudaDosTermos("qualquer")).toMatch(
      /^Quando o paciente ou a clínica escrever/,
    );
    for (const quem of TERMOS_DE_QUEM) {
      expect(ajudaDosTermos(quem)).toContain(
        "só para frente na jornada, nunca para a etapa de perda",
      );
    }
  });

  it("nenhum texto de quem escreve tem travessão (regra 5)", () => {
    const textos = [
      AJUDA_QUEM_ESCREVE,
      ...TERMOS_DE_QUEM.map((quem) => ajudaDosTermos(quem)),
      ...TERMOS_DE_QUEM.map((quem) => resumoDosTermos(2, quem)),
      ...OPCOES_TERMOS_DE_QUEM.map((opcao) => opcao.rotulo),
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(TRAVESSOES);
    }
  });
});

describe("normalizarDescricaoDaEtapa", () => {
  it("vazio, só espaços e nulo viram null (o check do banco recusa string vazia)", () => {
    expect(normalizarDescricaoDaEtapa(null)).toBeNull();
    expect(normalizarDescricaoDaEtapa(undefined)).toBeNull();
    expect(normalizarDescricaoDaEtapa("")).toBeNull();
    expect(normalizarDescricaoDaEtapa("   ")).toBeNull();
    expect(normalizarDescricaoDaEtapa("\n\t \n")).toBeNull();
  });

  it("apara as pontas e colapsa espaços e quebras de linha num espaço só", () => {
    expect(
      normalizarDescricaoDaEtapa("  Pediu o valor\n\ne ainda   não marcou  "),
    ).toBe("Pediu o valor e ainda não marcou");
  });

  it("não corta texto longo: o teto é conferido por quem chama", () => {
    const longo = "a".repeat(LIMITE_DA_DESCRICAO + 5);
    expect(normalizarDescricaoDaEtapa(longo)).toBe(longo);
    expect(LIMITE_DA_DESCRICAO).toBe(140);
  });
});

describe("algumaEtapaComDescricao", () => {
  it("só reserva a altura quando alguma etapa tem descrição de verdade", () => {
    expect(algumaEtapaComDescricao([])).toBe(false);
    expect(
      algumaEtapaComDescricao([{ descricao: null }, { descricao: null }]),
    ).toBe(false);
    expect(
      algumaEtapaComDescricao([{ descricao: null }, { descricao: "" }]),
    ).toBe(false);
    expect(
      algumaEtapaComDescricao([
        { descricao: null },
        { descricao: "Pediu o valor" },
      ]),
    ).toBe(true);
  });
});

describe("traduzirRecusaDaJornada", () => {
  it("etapa com régua de follow-up: mensagem que diz o que fazer (faltava antes)", () => {
    const mensagem = traduzirRecusaDaJornada(
      "Exclua a régua de follow-up desta etapa antes de excluí-la.",
    );
    expect(mensagem).toBe(
      "Esta etapa tem uma régua de follow-up. Exclua a régua em Automações antes de excluir a etapa.",
    );
  });

  it("etapa usada por automação de fluxo: diz onde resolver, igual à action", () => {
    const mensagem = traduzirRecusaDaJornada(
      "Esta etapa é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etapa.",
    );
    // O mesmo texto que a action devolve pelo hint (os dois nao podem se
    // desencontrar).
    expect(mensagem).toBe(RECUSA_DA_ETAPA_USADA);
    expect(mensagem).toContain("aba Automações de fluxo");
  });

  it("as recusas do gatilho que já explicam passam como vieram", () => {
    for (const recusa of [
      "Etapa de sistema não pode ser excluída. Renomeie ou reordene.",
      "Mova os contatos desta etapa antes de excluí-la.",
      "A chave de uma etapa não muda. Renomeie o nome da etapa.",
      "O papel de sistema de uma etapa não muda.",
    ]) {
      expect(traduzirRecusaDaJornada(recusa)).toBe(recusa);
    }
  });

  it("check da descrição e de quem escreve viram texto de gente, nunca nome de constraint", () => {
    const descricao = traduzirRecusaDaJornada(
      'new row for relation "funnel_stage_def" violates check constraint "descricao_de_etapa_com_tamanho"',
    );
    expect(descricao).toBe("A descrição da etapa cabe em até 140 caracteres.");
    const quem = traduzirRecusaDaJornada(
      'new row for relation "funnel_stage_def" violates check constraint "termos_de_quem_valido"',
    );
    expect(quem).toBe(
      "Escolha quem escreve o termo: paciente, clínica ou qualquer um.",
    );
  });

  it("recusa desconhecida ou ausente cai no genérico de quem chama", () => {
    expect(traduzirRecusaDaJornada(undefined)).toBeNull();
    expect(traduzirRecusaDaJornada(null)).toBeNull();
    expect(traduzirRecusaDaJornada("")).toBeNull();
    expect(
      traduzirRecusaDaJornada("permission denied for table funnel_stage_def"),
    ).toBeNull();
  });

  it("nenhuma tradução tem travessão", () => {
    for (const recusa of [
      "Exclua a régua de follow-up desta etapa antes de excluí-la.",
      "Esta etapa é usada por uma automação de fluxo.",
      "descricao_de_etapa_com_tamanho",
      "termos_de_quem_valido",
    ]) {
      expect(traduzirRecusaDaJornada(recusa)).not.toMatch(TRAVESSOES);
    }
  });
});
