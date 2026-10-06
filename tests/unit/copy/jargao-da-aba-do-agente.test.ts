import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Linguagem de recepcionista na aba "Agente de IA" de Configuracoes (CLAUDE.md
// secao 5). Os textos fixos estao em TEXTOS_DA_IA (agente-de-ia.test.ts), mas
// parte da copy mora no JSX (o dialogo de ligar, que a renderizacao estatica
// nao abre). Este teste le os arquivos da aba inteiros:
// - "janela de 24 horas" e conceito do canal oficial do WhatsApp (CLAUDE.md
//   3.3), fora da tela com uazapi; o teto diz "completar 24 horas";
// - "no servidor" (ativar, ativou) e jargao de programador; a frase e "A
//   equipe Conduzza ainda nao ativou o assistente para esta clinica.";
// - e os termos de sempre: tenant, opt-in, handoff, kill switch.
// Os comentarios entram na varredura de proposito: nenhum deles precisa
// desses termos.

const ARQUIVOS_DA_ABA = [
  "components/configuracoes/agente-de-ia.ts",
  "components/configuracoes/agente-de-ia-tab.tsx",
  "app/(app)/configuracoes/ia-liberacao-actions.ts",
];

const JARGAO: readonly RegExp[] = [
  /janela de 24 horas/i,
  /ativ\w* (o assistente )?no servidor/i,
  /assistente no servidor/i,
  /\b(tenant|opt-in|handoff|kill switch)\b/i,
];

describe("jargão na aba Agente de IA", () => {
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
