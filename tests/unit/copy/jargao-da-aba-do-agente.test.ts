import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Linguagem de recepcionista na aba "WhatsApp" da tela Agente de IA (ate a
// onda 2, a aba "Agente de IA" de Configuracoes; CLAUDE.md secao 5). Os
// textos fixos estao em TEXTOS_DA_IA (agente-de-ia.test.ts), mas parte da
// copy mora no JSX (os dialogos de ligar, excluir, retomar e o do teste com
// paciente, que a renderizacao estatica nao abre). Este teste le os arquivos
// da aba inteiros:
// - "janela de 24 horas" e conceito do canal oficial do WhatsApp (CLAUDE.md
//   3.3), fora da tela com uazapi; o teto diz "completar 24 horas";
// - "no servidor" (ativar, ativou) e jargao de programador; a frase e "A
//   equipe Conduzza ainda nao ativou o assistente para esta clinica.";
// - e os termos de sempre: tenant, opt-in, handoff, kill switch.
// Os comentarios entram na varredura de proposito: nenhum deles precisa
// desses termos.

// Os arquivos de uma pasta inteira (Tela 6, 06/10/2026): arquivo novo nela
// entra na varredura sem ninguem lembrar de listar.
function arquivosDe(pasta: string): string[] {
  return readdirSync(pasta, { recursive: true, encoding: "utf-8" })
    .filter((nome) => /\.(ts|tsx)$/.test(nome))
    .map((nome) => join(pasta, nome));
}

const ARQUIVOS_DA_ABA = [
  // Tela 6 (configuracao do agente, motor e simulador; 06/10/2026), com a
  // aba WhatsApp desde a onda 2 (components/agente/whatsapp e
  // app/(app)/agente/whatsapp-actions.ts entram pela pasta)
  ...arquivosDe("app/(app)/agente"),
  ...arquivosDe("components/agente"),
  ...arquivosDe("lib/agente"),
  ...arquivosDe("lib/domain/agente"),
];

const JARGAO: readonly RegExp[] = [
  /janela de 24 horas/i,
  /ativ\w* (o assistente )?no servidor/i,
  /assistente no servidor/i,
  /\b(tenant|opt-in|handoff|kill switch)\b/i,
];

describe("jargão na tela Agente de IA e na aba WhatsApp", () => {
  it("a aba WhatsApp entra na varredura", () => {
    expect(ARQUIVOS_DA_ABA).toContain(
      join("components/agente", "whatsapp/agente-de-ia.ts"),
    );
    expect(ARQUIVOS_DA_ABA).toContain(
      join("components/agente", "whatsapp/agente-de-ia-tab.tsx"),
    );
    expect(ARQUIVOS_DA_ABA).toContain(
      join("app/(app)/agente", "whatsapp-actions.ts"),
    );
  });

  it.each(ARQUIVOS_DA_ABA)("%s fala como a recepção", (arquivo) => {
    const texto = readFileSync(arquivo, "utf-8");
    for (const termo of JARGAO) {
      expect(texto, `${arquivo}: ${termo}`).not.toMatch(termo);
    }
  });

  it("a regra pega os textos antigos (anti falso positivo)", () => {
    const antigos = [
      "Ao chegar no teto, o assistente para de responder até o gasto mais antigo sair da janela de 24 horas.",
      "A equipe Conduzza ainda não ativou o assistente no servidor.",
      "quando a equipe Conduzza ligar o interruptor geral e ativar o assistente no servidor.",
    ];
    for (const antigo of antigos) {
      expect(
        JARGAO.some((termo) => termo.test(antigo)),
        antigo,
      ).toBe(true);
    }
  });
});
