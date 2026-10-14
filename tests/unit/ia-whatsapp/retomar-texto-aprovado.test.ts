import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  filtrarSaida,
  retomarTextoAprovado,
  sha256DoTexto,
  type DecisaoParaRetomar,
} from "@/lib/domain/conformidade/filtro";
import { CONTEXTO_PADRAO } from "@/tests/fixtures/ia/conformidade/casos";

// Retomada do envio (E3): o texto aprovado num turno anterior volta a ser
// TextoAprovado SEM o verificador, so com a DECISAO APROVADA do mesmo job
// (lida de ai_decision_log pelo executor), o hash do texto, o de ai_turno e
// o da decisao iguais, e as regras deterministicas limpas. A conversao
// continua uma so, no filtro, e so o executor chama a funcao.

const JOB = "10000000-0000-4000-8000-000000000001";
const OUTRO_JOB = "10000000-0000-4000-8000-000000000002";
const APROVADO =
  "Temos horário amanhã de manhã. Quer que eu passe para a equipe?";

function decisaoAprovada(
  texto: string,
  extra: Partial<DecisaoParaRetomar> = {},
): DecisaoParaRetomar {
  return {
    job_id: JOB,
    desfecho: "respondeu",
    aprovado: true,
    compliance_blocked: false,
    texto_sha256: sha256DoTexto(texto),
    ...extra,
  };
}

function retomar(
  texto: string,
  decisao: DecisaoParaRetomar | null,
  sha256DoTurno: string = sha256DoTexto(texto),
) {
  return retomarTextoAprovado({ jobId: JOB, texto, sha256DoTurno, decisao });
}

describe("retomarTextoAprovado", () => {
  it("decisão aprovada do mesmo job, os três hashes iguais e regras limpas: o mesmo texto, byte a byte", () => {
    const texto = retomar(APROVADO, decisaoAprovada(APROVADO));
    expect(texto).not.toBeNull();
    const enviado: string | null = texto;
    expect(enviado).toBe(APROVADO);
  });

  it("o mesmo texto que filtrarSaida aprovou volta pela retomada, com o hash da decisão", async () => {
    const decisao = await filtrarSaida({
      rascunho: APROVADO,
      contexto: CONTEXTO_PADRAO,
      verificador: async () => ({
        tipo: "veredicto",
        veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
        modelo: "x",
        uso: null,
      }),
    });
    expect(decisao.aprovado).toBe(true);
    if (decisao.aprovado) {
      expect(
        retomar(
          APROVADO,
          decisaoAprovada(APROVADO, { texto_sha256: decisao.sha256 }),
        ),
      ).toBe(APROVADO);
    }
  });

  it("forja: o texto de ai_turno trocado, com o hash recalculado na mesma linha, não passa sem a decisão daquele hash", () => {
    // Achado 3 do executor: antes, retomarTextoAprovado(x, sha256(x)) virava
    // TextoAprovado para qualquer x que passasse nas regras (promessa de
    // resultado inclusive), sem o verificador.
    for (const forjado of [
      "Esse tratamento resolve o seu problema em poucas sessões.",
      "Pode vir sem medo, ninguém sai daqui insatisfeita.",
      "A doutora vai deixar sua pele igualzinha à de antes.",
    ]) {
      expect(retomar(forjado, decisaoAprovada(APROVADO))).toBeNull();
      // Sem decisao nenhuma, tambem nao.
      expect(retomar(forjado, null)).toBeNull();
    }
  });

  it("a decisão tem de ser a aprovada do MESMO job", () => {
    const casos: Partial<DecisaoParaRetomar>[] = [
      { job_id: OUTRO_JOB },
      { job_id: null },
      { desfecho: "bloqueou" },
      { desfecho: "escalou" },
      { aprovado: false },
      { aprovado: "true" },
      { compliance_blocked: true },
      { compliance_blocked: null },
      { texto_sha256: null },
      { texto_sha256: "abc" },
      { texto_sha256: sha256DoTexto(APROVADO).toUpperCase() },
    ];
    for (const troca of casos) {
      expect(retomar(APROVADO, decisaoAprovada(APROVADO, troca))).toBeNull();
    }
  });

  it("hash de ai_turno, do texto e da decisão: qualquer um diferente, null", () => {
    expect(
      retomar(
        APROVADO,
        decisaoAprovada(APROVADO),
        sha256DoTexto(`${APROVADO} `),
      ),
    ).toBeNull();
    expect(retomar(`${APROVADO}!`, decisaoAprovada(APROVADO))).toBeNull();
    expect(
      retomar(
        APROVADO,
        decisaoAprovada(`${APROVADO} `),
        sha256DoTexto(APROVADO),
      ),
    ).toBeNull();
  });

  it("regra disparada derruba mesmo com a decisão e os hashes certos (remédio, moeda estrangeira)", () => {
    for (const texto of [
      "Pode tomar dipirona de 6 em 6 horas.",
      "O procedimento custa US$ 100.",
    ]) {
      expect(retomar(texto, decisaoAprovada(texto))).toBeNull();
    }
  });

  it("o preço do turno não é conferido de novo (a aprovação já conferiu e o hash prende o texto)", () => {
    const comPreco = "A consulta custa R$ 150,00.";
    expect(retomar(comPreco, decisaoAprovada(comPreco))).toBe(comPreco);
  });

  it("a conversão para TextoAprovado continua uma só, dentro do filtro", () => {
    const fonte = readFileSync("lib/domain/conformidade/filtro.ts", "utf-8");
    expect(fonte.match(/\bas TextoAprovado\b/g)).toHaveLength(1);
    expect(fonte).toMatch(/return aprovar\(texto\);/);
  });
});

// So o executor chama retomarTextoAprovado, e sempre com a decisao lida de
// ai_decision_log. Nos testes, TextoAprovado vem de filtrarSaida
// (texto-aprovado-de-teste.ts); este arquivo e o unico que chama a funcao.
describe("quem chama retomarTextoAprovado", () => {
  const RAIZ = process.cwd();
  const CHAMADA = /\bretomarTextoAprovado\s*\(/;

  function arquivos(pasta: string): string[] {
    const saida: string[] = [];
    for (const nome of readdirSync(pasta)) {
      if (nome === "node_modules" || nome.startsWith(".")) {
        continue;
      }
      const caminho = join(pasta, nome);
      if (statSync(caminho).isDirectory()) {
        saida.push(...arquivos(caminho));
      } else if (/\.(ts|tsx|mts)$/.test(nome)) {
        saida.push(caminho);
      }
    }
    return saida;
  }

  function quemChama(pastas: readonly string[]): string[] {
    return pastas
      .flatMap((pasta) => arquivos(join(RAIZ, pasta)))
      .filter((arquivo) => CHAMADA.test(readFileSync(arquivo, "utf-8")))
      .map((arquivo) => relative(RAIZ, arquivo))
      .sort();
  }

  it("no app: só a definição (filtro.ts) e o executor", () => {
    expect(quemChama(["app", "components", "lib", "scripts"])).toEqual([
      "lib/domain/conformidade/filtro.ts",
      "lib/jobs/responder-com-ia.ts",
    ]);
  });

  it("nos testes: só este arquivo (nenhum teste forja TextoAprovado pela retomada)", () => {
    expect(quemChama(["tests"])).toEqual([
      "tests/unit/ia-whatsapp/retomar-texto-aprovado.test.ts",
    ]);
  });

  it("o executor lê a decisão de ai_decision_log pelo id e pelo job antes de retomar", () => {
    const executor = readFileSync(
      join(RAIZ, "lib/jobs/responder-com-ia.ts"),
      "utf-8",
    );
    const leitura = executor.indexOf("lerDecisaoParaRetomar(c.admin");
    const chamada = executor.search(CHAMADA);
    expect(leitura).toBeGreaterThan(-1);
    expect(chamada).toBeGreaterThan(leitura);
    // A leitura e de ai_decision_log, filtrada pela clinica, pelo id e pelo
    // JOB (nunca de ai_turno).
    const travas = readFileSync(join(RAIZ, "lib/agente/whatsapp.ts"), "utf-8");
    const corpo = travas.slice(
      travas.indexOf("export async function lerDecisaoParaRetomar"),
    );
    const fim = corpo.indexOf("\n}\n");
    const funcao = corpo.slice(0, fim);
    expect(funcao).toContain('.from("ai_decision_log")');
    expect(funcao).not.toContain("ai_turno");
    expect(funcao).toMatch(/\.eq\("clinic_id", e\.clinicId\)/);
    expect(funcao).toMatch(/\.eq\("id", e\.decisionId\)/);
    expect(funcao).toMatch(/\.eq\("job_id", e\.jobId\)/);
  });
});
