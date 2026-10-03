import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  eProblemaDeLeitura,
  normalizarContaDeAnuncios,
  PROBLEMAS_DE_LEITURA,
  PROBLEMAS_QUE_PAUSAM,
  textoDoProblemaDeLeitura,
} from "@/lib/domain/meta-anuncios";

// Fase 4: o formato da conta de anuncios (o banco recusa o que nao for
// act_<digitos>, CHECK ad_account_id_formato), os 12 problemas de leitura (a
// mesma lista do CHECK de meta_gasto_leitura.problema) e o texto que a
// clinica le sobre cada um, sem travessao.

const MIGRATION = readFileSync(
  path.resolve(
    __dirname,
    "../../../supabase/migrations/20261003100000_investimento_da_meta.sql",
  ),
  "utf8",
);

function codigosEntreAspas(trecho: string): string[] {
  return [...trecho.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe("normalizarContaDeAnuncios", () => {
  it.each([
    ["123456789", "act_123456789"],
    ["act_123456789", "act_123456789"],
    ["ACT_123456789", "act_123456789"],
    ["Act_123456789", "act_123456789"],
    ["  act_123456789  ", "act_123456789"],
    ["1234 5678 9", "act_123456789"],
    ["12345", "act_12345"],
    ["12345678901234567890", "act_12345678901234567890"],
    [
      "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789&business_id=987654321",
      "act_123456789",
    ],
    [
      "https://business.facebook.com/adsmanager/manage/ads?business_id=1&act=987654321",
      "act_987654321",
    ],
    [
      "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789#filtro",
      "act_123456789",
    ],
  ])("%j vira %j", (entrada, esperado) => {
    expect(normalizarContaDeAnuncios(entrada)).toBe(esperado);
  });

  it.each([
    "",
    "   ",
    "act_",
    "act_abc",
    "123-456-789",
    "1234",
    "123456789012345678901",
    "act__123456789",
    "acct_123456789",
    "act_12345abc",
    "https://adsmanager.facebook.com/adsmanager/manage/campaigns?business_id=987654321",
    "https://exemplo.com/?act=12a456789",
    "https://exemplo.com/?xact=123456789",
  ])("%j é recusado", (entrada) => {
    expect(normalizarContaDeAnuncios(entrada)).toBeNull();
  });

  it("todo valor aceito bate com o CHECK do banco", () => {
    const aceitos = [
      "123456789",
      "ACT_123456789",
      "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789&x=1",
    ].map(normalizarContaDeAnuncios);
    for (const conta of aceitos) {
      expect(conta).toMatch(/^act_[0-9]{5,20}$/);
    }
  });
});

describe("problemas de leitura", () => {
  it("são os 12 do CHECK de meta_gasto_leitura.problema, na mesma ordem", () => {
    const check = /problema text\s+check \(problema in \(([\s\S]*?)\)\)/.exec(
      MIGRATION,
    );
    expect(check).not.toBeNull();
    expect(codigosEntreAspas(check![1]!)).toEqual([...PROBLEMAS_DE_LEITURA]);
    expect(new Set(PROBLEMAS_DE_LEITURA).size).toBe(12);
  });

  it("os que pausam são os 4 de configuração, a mesma lista do diário no banco", () => {
    expect([...PROBLEMAS_QUE_PAUSAM].sort()).toEqual(
      [
        "conta_sem_acesso",
        "exige_prova_do_app",
        "sem_permissao",
        "token_invalido",
      ].sort(),
    );
    const doDiario = /l\.problema in \(([\s\S]*?)\)/.exec(MIGRATION);
    expect(doDiario).not.toBeNull();
    expect(codigosEntreAspas(doDiario![1]!).sort()).toEqual(
      [...PROBLEMAS_QUE_PAUSAM].sort(),
    );
  });

  it("eProblemaDeLeitura reconhece só os 12", () => {
    for (const problema of PROBLEMAS_DE_LEITURA) {
      expect(eProblemaDeLeitura(problema)).toBe(true);
    }
    expect(eProblemaDeLeitura("conta_inexistente")).toBe(false);
    expect(eProblemaDeLeitura(null)).toBe(false);
    expect(eProblemaDeLeitura(190)).toBe(false);
  });
});

describe("textoDoProblemaDeLeitura", () => {
  it.each(PROBLEMAS_DE_LEITURA)(
    "%s tem texto sem travessão, com e sem contexto",
    (problema) => {
      const textos = [
        textoDoProblemaDeLeitura(problema),
        textoDoProblemaDeLeitura(problema, {
          adAccountId: "act_123456789",
          codigo: 2500,
        }),
        textoDoProblemaDeLeitura(problema, { adAccountId: null, codigo: null }),
      ];
      for (const texto of textos) {
        expect(texto.length).toBeGreaterThan(20);
        expect(texto).not.toMatch(/[—–]/);
        // Linguagem de recepcionista: nada de jargao de programador.
        expect(texto).not.toMatch(/\b(token_|http|api|null|undefined)\b/i);
        expect(texto.endsWith(".")).toBe(true);
      }
    },
  );

  it("a conta sem acesso cita a conta quando ela vem", () => {
    expect(
      textoDoProblemaDeLeitura("conta_sem_acesso", {
        adAccountId: "act_123456789",
      }),
    ).toBe(
      "A Meta não encontrou a conta act_123456789 para este token. Confira o número da conta e se o usuário do sistema tem acesso a ela no Gerenciador de Negócios.",
    );
    expect(textoDoProblemaDeLeitura("conta_sem_acesso")).toContain(
      "a conta de anúncios",
    );
  });

  it("o problema sem nome cita o código da Meta só quando ele existe", () => {
    expect(textoDoProblemaDeLeitura("outro", { codigo: 1234 })).toBe(
      "A Meta recusou a leitura (código 1234). Tente de novo; se continuar, fale com o suporte.",
    );
    expect(textoDoProblemaDeLeitura("outro")).toBe(
      "A Meta recusou a leitura. Tente de novo; se continuar, fale com o suporte.",
    );
  });

  it("os textos da tabela de Configurações ficam como combinados", () => {
    expect(textoDoProblemaDeLeitura("token_invalido")).toBe(
      "A Meta recusou o token: ele expirou, foi revogado ou foi colado pela metade. Gere um novo e cole aqui.",
    );
    expect(textoDoProblemaDeLeitura("sem_permissao")).toBe(
      "O token não tem permissão para ler anúncios. Gere de novo marcando a permissão ads_read (ler anúncios).",
    );
    expect(textoDoProblemaDeLeitura("limite_da_meta")).toBe(
      "A Meta pediu uma pausa nas consultas desta conta. Tente de novo em alguns minutos.",
    );
    expect(textoDoProblemaDeLeitura("meta_indisponivel")).toBe(
      "A Meta não respondeu agora. Tente de novo em instantes.",
    );
    expect(textoDoProblemaDeLeitura("exige_prova_do_app")).toBe(
      "O aplicativo da Meta deste token exige uma assinatura extra que o Conduzza não usa. Gere o token por um usuário do sistema sem essa exigência.",
    );
  });
});
