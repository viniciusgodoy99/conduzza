import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  HORIZONTE_EM_MESES,
  MOTIVOS_DA_AGENDADA,
  SITUACOES_DA_AGENDADA,
  TETO_DE_AGENDADAS_POR_CONTATO,
  TEXTO_MAXIMO_DA_AGENDADA,
} from "@/lib/domain/mensagem-agendada";
import {
  envioCertamenteNaoSaiu,
  FALHAS_SEM_ENVIO,
  falhaPermiteRetry,
} from "@/lib/integrations/whatsapp/send";

// As listas fechadas do dominio sao as dos CHECKs da migration da mensagem
// agendada: mudou la, muda aqui (e o contrario). Enquanto a migration nao
// existe no repositorio, os testes ficam pulados (nao ha o que cruzar).

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261006140000_mensagem_agendada.sql",
);
const existe = existsSync(MIGRATION);
const sql = existe ? readFileSync(MIGRATION, "utf8") : "";

/** Os literais entre aspas simples do trecho que comeca em `marco`. */
function literaisDoCheck(marco: RegExp): string[] {
  const inicio = sql.search(marco);
  if (inicio < 0) {
    return [];
  }
  // O CHECK termina no primeiro "))" (o "in (...)" dentro do "check (...)").
  const fim = sql.indexOf("))", inicio);
  const trecho = sql.slice(inicio, fim < 0 ? undefined : fim);
  return [...trecho.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? "");
}

/** O corpo de uma funcao SQL, do create ate o fim do dollar quote. */
function corpoDaFuncao(nome: string): string {
  const inicio = sql.search(
    new RegExp(`function\\s+public\\.${nome}\\s*\\(`, "i"),
  );
  if (inicio < 0) {
    return "";
  }
  const fim = sql.indexOf("$$;", inicio);
  return sql.slice(inicio, fim < 0 ? undefined : fim);
}

describe.skipIf(!existe)("listas do domínio contra a migration", () => {
  it("CHECK situacao_da_agendada = SITUACOES_DA_AGENDADA", () => {
    const doBanco = literaisDoCheck(/constraint\s+situacao_da_agendada\b/i);
    expect([...doBanco].sort()).toEqual([...SITUACOES_DA_AGENDADA].sort());
  });

  it("CHECK motivo_da_agendada = MOTIVOS_DA_AGENDADA", () => {
    const doBanco = literaisDoCheck(/constraint\s+motivo_da_agendada\b/i);
    expect([...doBanco].sort()).toEqual([...MOTIVOS_DA_AGENDADA].sort());
  });

  it("a função motivo_da_agendada só devolve motivos da lista", () => {
    const corpo = corpoDaFuncao("motivo_da_agendada");
    expect(corpo).not.toBe("");
    const devolvidos = [...corpo.matchAll(/(?:then|else)\s+'([a-z_]+)'/gi)].map(
      (m) => m[1] ?? "",
    );
    expect(devolvidos.length).toBeGreaterThan(0);
    for (const motivo of devolvidos) {
      expect(MOTIVOS_DA_AGENDADA).toContain(motivo);
    }
  });

  it("teto por contato, tamanho do texto e horizonte iguais aos do banco", () => {
    const teto = sql.match(/v_teto\s+constant\s+integer\s*:=\s*(\d+)/i);
    expect(Number(teto?.[1])).toBe(TETO_DE_AGENDADAS_POR_CONTATO);
    expect(sql).toMatch(
      new RegExp(`between\\s+1\\s+and\\s+${TEXTO_MAXIMO_DA_AGENDADA}\\b`),
    );
    expect(HORIZONTE_EM_MESES).toBe(12);
    expect(sql).toMatch(/interval\s+'(1 year|12 months)'/i);
  });
});

// F2: a lista de falhas que garantem que a mensagem NAO saiu existe em dois
// lugares. No send.ts (FALHAS_SEM_ENVIO: o retry e seguro) e no SQL
// (falhas_sem_envio(): excluir a agendada, remover o numero e revogar a
// autorizacao cancelam o job pendente cuja unica mensagem falhou assim).
// Uma diferenca entre as duas e mensagem que sai depois de excluida, ou
// exclusao recusada de uma mensagem que nao saiu.
describe.skipIf(!existe)("falhas sem envio: send.ts contra a migration", () => {
  /** Os literais do array devolvido por public.falhas_sem_envio(). */
  function listaDoSql(): string[] {
    const corpo = corpoDaFuncao("falhas_sem_envio");
    const arranjo = corpo.match(/array\s*\[([\s\S]*?)\]/i)?.[1] ?? "";
    return [...arranjo.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1] ?? "");
  }

  it("falhas_sem_envio() = FALHAS_SEM_ENVIO do send.ts", () => {
    const doBanco = listaDoSql();
    expect(doBanco.length).toBeGreaterThan(0);
    expect([...doBanco].sort()).toEqual([...FALHAS_SEM_ENVIO].sort());
  });

  it("todo predicado de mensagem 'falhou' na migration usa a função, nunca uma cópia da lista", () => {
    const usos = [...sql.matchAll(/error_code\s*=\s*any\s*\(([^)]*\)?)/gi)];
    expect(usos.length).toBeGreaterThan(0);
    for (const uso of usos) {
      expect(uso[1]).toMatch(/public\.falhas_sem_envio\(\)/);
    }
    // Nenhuma lista solta de codigo de falha (error_code in ('...')).
    expect(sql).not.toMatch(/error_code\s+in\s*\(\s*'/i);
  });

  it("toda falha da lista permite retry e garante que nada saiu", () => {
    for (const codigo of FALHAS_SEM_ENVIO) {
      expect(falhaPermiteRetry(codigo)).toBe(true);
      expect(
        envioCertamenteNaoSaiu({ reason: "falha_envio", code: codigo }),
      ).toBe(true);
    }
    expect(falhaPermiteRetry("envio_incerto")).toBe(false);
    expect(
      envioCertamenteNaoSaiu({ reason: "falha_envio", code: "envio_incerto" }),
    ).toBe(false);
  });
});
