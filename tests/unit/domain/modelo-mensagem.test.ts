import { describe, expect, it } from "vitest";

import { PLACEHOLDERS, renderizarModelo } from "@/lib/domain/modelo-mensagem";
import {
  CONFIRMACAO_24H,
  CONFIRMACAO_3H,
  CONFIRMACAO_72H,
  POS_FALTA_D0,
  POS_FALTA_D2,
} from "@/lib/domain/textos-padrao";

const VALORES = {
  nome: "Ana",
  clinica: "Clínica Sorriso",
  data: "10/09",
  hora: "14:00",
  profissional: "Dra. Marina",
  procedimento: "Limpeza",
  preparo: "Venha em jejum de 4 horas.",
};

describe("renderizarModelo", () => {
  it("substitui as chaves conhecidas", () => {
    expect(
      renderizarModelo("Olá, {{nome}}! Aqui é da {{clinica}}.", VALORES),
    ).toBe("Olá, Ana! Aqui é da Clínica Sorriso.");
  });

  it("aceita espaco em volta da chave", () => {
    expect(renderizarModelo("Oi, {{ nome }}.", VALORES)).toBe("Oi, Ana.");
  });

  it("a linha do preparo aparece quando o procedimento tem preparo", () => {
    const texto = renderizarModelo(CONFIRMACAO_24H, VALORES);
    expect(texto.split("\n")).toEqual([
      "Oi, Ana! Amanhã, 10/09 às 14:00, você tem Limpeza com Dra. Marina.",
      "Venha em jejum de 4 horas.",
      "Podemos confirmar sua presença?",
    ]);
  });

  it("a linha do preparo SOME quando nao ha preparo cadastrado", () => {
    for (const vazio of [undefined, null, "", "   "]) {
      const texto = renderizarModelo(CONFIRMACAO_24H, {
        ...VALORES,
        preparo: vazio,
      });
      expect(texto.split("\n")).toEqual([
        "Oi, Ana! Amanhã, 10/09 às 14:00, você tem Limpeza com Dra. Marina.",
        "Podemos confirmar sua presença?",
      ]);
      expect(texto).not.toContain("\n\n");
    }
  });

  it("linha que sobra so com pontuacao tambem some", () => {
    const modelo = "Antes\n{{preparo}}.\nDepois";
    expect(renderizarModelo(modelo, { preparo: null })).toBe("Antes\nDepois");
  });

  it("linha em branco escrita pela clinica e mantida (e paragrafo, nao sobra)", () => {
    const modelo = "Oi, {{nome}}.\n\nAté logo.";
    expect(renderizarModelo(modelo, VALORES)).toBe("Oi, Ana.\n\nAté logo.");
  });

  it("nunca deixa chave sobrando no texto que vai ao paciente", () => {
    const modelo = "Oi, {{nome}}. Valor: {{desconhecido}} e um {{ meio aberto.";
    const texto = renderizarModelo(modelo, VALORES);
    expect(texto).not.toContain("{{");
    expect(texto).not.toContain("}}");
    expect(texto).toContain("Oi, Ana.");
  });

  it("todos os textos padrao rendem sem sobrar chave", () => {
    const modelos = [
      CONFIRMACAO_72H,
      CONFIRMACAO_24H,
      CONFIRMACAO_3H,
      POS_FALTA_D0,
      POS_FALTA_D2,
    ];
    for (const modelo of modelos) {
      const cheio = renderizarModelo(modelo, VALORES);
      const vazio = renderizarModelo(modelo, {});
      expect(cheio).not.toContain("{{");
      expect(vazio).not.toContain("{{");
    }
  });

  describe("paciente sem nome cadastrado", () => {
    const SEM_NOME = { ...VALORES, preparo: null };

    it("os cinco textos padrao saem sem vocativo quebrado", () => {
      for (const nome of [null, undefined, "", "   "]) {
        const valores = { ...SEM_NOME, nome };
        expect(renderizarModelo(CONFIRMACAO_72H, valores)).toBe(
          "Olá! Aqui é da Clínica Sorriso. Sua consulta de Limpeza com Dra. Marina está marcada para 10/09 às 14:00. Podemos confirmar sua presença?",
        );
        expect(renderizarModelo(CONFIRMACAO_24H, valores)).toBe(
          "Oi! Amanhã, 10/09 às 14:00, você tem Limpeza com Dra. Marina.\nPodemos confirmar sua presença?",
        );
        expect(renderizarModelo(CONFIRMACAO_3H, valores)).toBe(
          "Sua consulta é hoje às 14:00 com Dra. Marina. Está tudo certo para você vir?",
        );
        expect(renderizarModelo(POS_FALTA_D0, valores)).toBe(
          "Oi. Sentimos sua falta na Clínica Sorriso, no seu horário de 10/09. Aconteceu algum imprevisto? Se quiser remarcar, é só responder esta mensagem.",
        );
        expect(renderizarModelo(POS_FALTA_D2, valores)).toBe(
          "Olá! Ainda dá tempo de remarcar seu Limpeza. Quer que a gente encontre um novo horário para você?",
        );
      }
    });

    it("com nome, nada muda", () => {
      expect(renderizarModelo(CONFIRMACAO_3H, VALORES)).toBe(
        "Ana, sua consulta é hoje às 14:00 com Dra. Marina. Está tudo certo para você vir?",
      );
    });

    it("texto editado pela clinica: vocativo no meio, entre virgulas, sem virgula e no fim", () => {
      const valores = { nome: null, clinica: "Clínica Sorriso" };
      expect(
        renderizarModelo(
          "Bom dia, {{nome}}, tudo bem? Aqui é a {{clinica}}.",
          valores,
        ),
      ).toBe("Bom dia, tudo bem? Aqui é a Clínica Sorriso.");
      expect(renderizarModelo("Oi {{nome}}, tudo bem?", valores)).toBe(
        "Oi, tudo bem?",
      );
      expect(renderizarModelo("Obrigado {{nome}} por vir!", valores)).toBe(
        "Obrigado por vir!",
      );
      expect(renderizarModelo("Até logo, {{nome}}", valores)).toBe("Até logo");
      expect(renderizarModelo("{{nome}}! Tudo certo?", valores)).toBe(
        "Tudo certo?",
      );
      expect(
        renderizarModelo("Oi, {{ nome }}.\n\n{{nome}}, até lá.", valores),
      ).toBe("Oi.\n\nAté lá.");
    });

    it("linha que so tinha o nome some inteira", () => {
      expect(
        renderizarModelo("{{nome}},\nSua consulta é amanhã.", { nome: "" }),
      ).toBe("Sua consulta é amanhã.");
    });

    it("so o nome aciona a limpeza: outro campo vazio segue a regra antiga", () => {
      expect(
        renderizarModelo("Oi, {{nome}}! Com {{profissional}}.", {
          nome: "Ana",
          profissional: null,
        }),
      ).toBe("Oi, Ana! Com .");
    });
  });

  it("os textos padrao so usam chaves da lista publicada", () => {
    const conhecidas = new Set<string>(PLACEHOLDERS);
    const usadas = new Set<string>();
    for (const modelo of [
      CONFIRMACAO_72H,
      CONFIRMACAO_24H,
      CONFIRMACAO_3H,
      POS_FALTA_D0,
      POS_FALTA_D2,
    ]) {
      for (const achado of modelo.matchAll(/\{\{([^{}]*)\}\}/g)) {
        usadas.add((achado[1] ?? "").trim());
      }
    }
    for (const chave of usadas) {
      expect(conhecidas.has(chave)).toBe(true);
    }
  });
});
