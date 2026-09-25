import { describe, expect, it } from "vitest";

import {
  conviteRegistrado,
  nomeDoEmail,
  nomeNaEquipe,
  temNomeProprio,
  ultimoConvitePorPessoa,
} from "@/components/configuracoes/convite-na-equipe";

// Convite para a equipe (achados L17 e L20 da revisao da leva 2): quem foi
// convidado e ainda nao usou a clinica aparece na lista da equipe com o nome
// que uma conta nova teria (o comeco do e-mail, regra do gatilho
// sincronizar_perfil), para a lista nao revelar que o e-mail ja tinha conta
// nem o nome que a pessoa usa.

describe("nome na lista da equipe", () => {
  it("o nome de conta nova é o começo do e-mail", () => {
    expect(nomeDoEmail("ana.souza@clinica.test")).toBe("ana.souza");
  });

  it("escondido, mostra exatamente o que uma conta nova mostraria", () => {
    const email = "ana.souza@clinica.test";
    const contaNova = nomeNaEquipe({
      nome: nomeDoEmail(email),
      email,
      esconder: false,
    });
    const contaExistenteEscondida = nomeNaEquipe({
      nome: "Ana Souza",
      email,
      esconder: true,
    });
    expect(contaExistenteEscondida).toBe(contaNova);
  });

  it("sem esconder, mostra o nome do perfil", () => {
    expect(
      nomeNaEquipe({
        nome: "Ana Souza",
        email: "ana@clinica.test",
        esconder: false,
      }),
    ).toBe("Ana Souza");
  });

  it("sem perfil, cai no e-mail e depois em Usuário", () => {
    expect(
      nomeNaEquipe({
        nome: undefined,
        email: "ana@clinica.test",
        esconder: false,
      }),
    ).toBe("ana@clinica.test");
    expect(nomeNaEquipe({ nome: undefined, email: "", esconder: false })).toBe(
      "Usuário",
    );
    expect(
      nomeNaEquipe({ nome: "Ana Souza", email: undefined, esconder: true }),
    ).toBe("Usuário");
  });

  it("só o nome diferente do começo do e-mail precisa de conferência", () => {
    expect(temNomeProprio("Ana Souza", "ana@clinica.test")).toBe(true);
    expect(temNomeProprio("ana", "ana@clinica.test")).toBe(false);
    expect(temNomeProprio(undefined, "ana@clinica.test")).toBe(false);
    expect(temNomeProprio("Ana Souza", undefined)).toBe(true);
  });
});

describe("último convite por pessoa", () => {
  it("fica com o convite mais recente de cada pessoa e ignora linha sem pessoa", () => {
    const ultimo = ultimoConvitePorPessoa([
      { entity_id: "ana", created_at: "2026-09-20T10:00:00.000000+00:00" },
      { entity_id: "ana", created_at: "2026-09-24T10:00:00.000000+00:00" },
      { entity_id: "ana", created_at: "2026-09-22T10:00:00.000000+00:00" },
      { entity_id: "bia", created_at: "2026-09-21T10:00:00+00:00" },
      { entity_id: null, created_at: "2026-09-25T10:00:00+00:00" },
    ]);
    expect([...ultimo]).toEqual([
      ["ana", "2026-09-24T10:00:00.000000+00:00"],
      ["bia", "2026-09-21T10:00:00+00:00"],
    ]);
  });
});

describe("resposta do convite", () => {
  it("não fala em conta, senha nem acesso liberado", () => {
    const texto = conviteRegistrado("ana@clinica.test");
    expect(texto).toBe("Convite registrado para ana@clinica.test");
    expect(texto).not.toMatch(/conta|senha|liberad/i);
  });
});
