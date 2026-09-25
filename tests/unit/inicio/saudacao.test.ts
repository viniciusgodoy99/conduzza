import { describe, expect, it } from "vitest";

import {
  primeiroNome,
  resumoDoDia,
  saudacaoDoMomento,
  textoDoResumo,
} from "@/components/inicio/saudacao";

// Cabecalho do Inicio (decisao C26): saudacao pelo horario LOCAL da clinica,
// primeiro nome so quando existe nome de verdade, e a frase montada so com
// as contagens de Proximas acoes, com singular e plural corretos.

describe("saudacaoDoMomento", () => {
  it("usa bom dia, boa tarde e boa noite pelos minutos locais", () => {
    expect(saudacaoDoMomento(5 * 60)).toBe("Bom dia");
    expect(saudacaoDoMomento(11 * 60 + 59)).toBe("Bom dia");
    expect(saudacaoDoMomento(12 * 60)).toBe("Boa tarde");
    expect(saudacaoDoMomento(17 * 60 + 59)).toBe("Boa tarde");
    expect(saudacaoDoMomento(18 * 60)).toBe("Boa noite");
    expect(saudacaoDoMomento(2 * 60)).toBe("Boa noite");
  });
});

describe("primeiroNome", () => {
  it("devolve só o primeiro nome", () => {
    expect(primeiroNome("  Rafaela Souza Lima ", "rafa@clinica.com")).toBe(
      "Rafaela",
    );
  });

  it("não cumprimenta pelo e-mail nem pelo nome genérico", () => {
    expect(primeiroNome("rafa@clinica.com", "rafa@clinica.com")).toBeNull();
    expect(primeiroNome("Usuário", "")).toBeNull();
    expect(primeiroNome("   ", "rafa@clinica.com")).toBeNull();
  });
});

describe("resumoDoDia", () => {
  it("monta a frase no plural", () => {
    expect(
      textoDoResumo(resumoDoDia({ confirmacoesAmanha: 3, aguardandoVoce: 12 })),
    ).toBe(
      "3 confirmações pendentes para amanhã e 12 conversas aguardando você.",
    );
  });

  it("monta a frase no singular", () => {
    expect(
      textoDoResumo(resumoDoDia({ confirmacoesAmanha: 1, aguardandoVoce: 1 })),
    ).toBe("1 confirmação pendente para amanhã e 1 conversa aguardando você.");
  });

  it("diz nenhuma quando a contagem é zero, sem travessão", () => {
    const texto = textoDoResumo(
      resumoDoDia({ confirmacoesAmanha: 0, aguardandoVoce: 0 }),
    );
    expect(texto).toBe(
      "Nenhuma confirmação pendente para amanhã e nenhuma conversa aguardando você.",
    );
    expect(texto).not.toContain("—");
    expect(texto).not.toContain("--");
  });

  it("marca os números para a fonte mono", () => {
    const trechos = resumoDoDia({
      confirmacoesAmanha: 1234,
      aguardandoVoce: 0,
    });
    expect(trechos[0]).toEqual({ tipo: "numero", valor: "1.234" });
  });
});
