import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MOTIVOS_DO_AGENTE } from "@/lib/agente/ferramentas/escalar-humano";
import type { FalhaDoAgente } from "@/lib/agente/laco";
import { TEXTO_FIXO_DO_AGENTE } from "@/lib/agente/prompt";
import {
  MOTIVOS_DE_ESCALONAMENTO,
  MOTIVOS_DE_SISTEMA_DA_IA,
  ROTULO_DO_MOTIVO_DE_ESCALONAMENTO,
  TEXTO_DO_EVENTO_DA_IA,
} from "@/lib/domain/agente/config";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import {
  MOTIVOS_DA_FALHA,
  type MotivoDaFalha,
} from "@/lib/domain/conformidade/veredicto";

// Espelhos do E3 entre o TS e a migration 20261013100000 (M1): a frase fixa,
// o corpo de cada evento no fio, os motivos de escalonamento, os codigos de
// motivo_da_falha e o grant de colunas de ai_decision_log (todas menos
// blocked_draft). Mudou de um lado, o teste quebra ate mudar do outro.

const M1 = readFileSync(
  "supabase/migrations/20261013100000_ia_whatsapp_fila.sql",
  "utf-8",
);

/** Os literais entre aspas simples de um trecho de SQL. */
function literais(trecho: string): string[] {
  return [...trecho.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

/** O corpo de uma funcao da M1 ($function$ ... $function$). */
function corpoDaFuncao(nome: string): string {
  const corpo = M1.match(
    new RegExp(
      `create function public\\.${nome}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`,
    ),
  )?.[1];
  if (!corpo) {
    throw new Error(`${nome} nao encontrada na M1`);
  }
  return corpo;
}

// As falhas do turno alem das do verificador (FalhaDoAgente), conferidas
// pelo tipo: se FalhaDoAgente ganhar um codigo, isto deixa de compilar.
const FALHAS_DO_TURNO = [
  "rodadas_esgotadas",
  "ferramenta_invalida",
  "liberacao_suspensa",
  "sem_identificador",
  "sem_mensagem",
] as const satisfies readonly FalhaDoAgente[];
type Sobra = Exclude<
  FalhaDoAgente,
  MotivoDaFalha | (typeof FALHAS_DO_TURNO)[number]
>;
const semSobra: [Sobra] extends [never] ? true : false = true;

describe("espelhos do E3 com a M1", () => {
  it("a frase fixa do SQL é a do TS, palavra por palavra", () => {
    const corpo = corpoDaFuncao("frase_de_escalonamento_da_ia");
    const frase = corpo.match(/select '([^']*)'::text/)?.[1];
    expect(frase).toBe(FRASE_DE_ESCALONAMENTO);
  });

  it("rotulo_do_motivo_da_ia é TEXTO_DO_EVENTO_DA_IA, motivo a motivo", () => {
    const corpo = corpoDaFuncao("rotulo_do_motivo_da_ia");
    const doBanco = Object.fromEntries(
      [...corpo.matchAll(/when '([a-z_]+)' then '([^']*)'/g)].map((m) => [
        m[1]!,
        m[2]!,
      ]),
    );
    expect(doBanco).toEqual({ ...TEXTO_DO_EVENTO_DA_IA });
    expect(Object.keys(doBanco).sort()).toEqual(
      [...MOTIVOS_DE_ESCALONAMENTO, ...MOTIVOS_DE_SISTEMA_DA_IA].sort(),
    );
  });

  it("os eventos de passagem usam o rótulo do motivo", () => {
    for (const motivo of MOTIVOS_DE_ESCALONAMENTO) {
      if (motivo === "nao_individual") {
        continue;
      }
      expect(TEXTO_DO_EVENTO_DA_IA[motivo]).toBe(
        `A IA passou a conversa para a equipe: ${ROTULO_DO_MOTIVO_DE_ESCALONAMENTO[motivo]}.`,
      );
    }
    for (const texto of Object.values(TEXTO_DO_EVENTO_DA_IA)) {
      expect(texto).not.toMatch(/[–—]/);
    }
  });

  it("MOTIVOS_DE_ESCALONAMENTO é o CHECK de escalation_reason (17)", () => {
    const bloco = M1.match(
      /escalation_reason is null or escalation_reason in \(([\s\S]*?)\)\)/,
    )?.[1];
    expect(literais(bloco ?? "").sort()).toEqual(
      [...MOTIVOS_DE_ESCALONAMENTO].sort(),
    );
    expect(MOTIVOS_DE_ESCALONAMENTO).toHaveLength(17);
  });

  it("motivo_da_falha é MOTIVOS_DA_FALHA mais as falhas do turno", () => {
    expect(semSobra).toBe(true);
    const bloco = M1.match(
      /motivo_da_falha is null or motivo_da_falha in \(([\s\S]*?)\)\)/,
    )?.[1];
    expect(literais(bloco ?? "").sort()).toEqual(
      [...MOTIVOS_DA_FALHA, ...FALHAS_DO_TURNO].sort(),
    );
  });

  it("o grant de colunas de ai_decision_log é a tabela menos blocked_draft", () => {
    const grant = M1.match(
      /grant select \(([\s\S]*?)\) on public\.ai_decision_log to authenticated/,
    )?.[1];
    const colunasDoGrant = (grant ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const tipos = readFileSync("lib/supabase/database.types.ts", "utf-8");
    const linha = tipos.match(
      /ai_decision_log: \{\s*Row: \{([\s\S]*?)\n\s*\}/,
    )?.[1];
    const colunasDaTabela = [...(linha ?? "").matchAll(/^\s*([a-z_0-9]+):/gm)]
      .map((m) => m[1]!)
      .filter((c) => c !== "blocked_draft");
    expect(colunasDoGrant.sort()).toEqual(colunasDaTabela.sort());
    expect(colunasDoGrant).not.toContain("blocked_draft");
    expect(colunasDoGrant).toContain("desfecho");
    expect(colunasDoGrant).toContain("motivo_da_falha");
  });

  it("D41: o agente tem o motivo pedido_de_agenda e o prompt o usa para agenda", () => {
    expect(MOTIVOS_DO_AGENTE).toContain("pedido_de_agenda");
    for (const motivo of MOTIVOS_DO_AGENTE) {
      expect(MOTIVOS_DE_ESCALONAMENTO).toContain(motivo);
    }
    expect(TEXTO_FIXO_DO_AGENTE).toContain(
      'passe para a equipe com o motivo "pedido_de_agenda"',
    );
    // Os motivos do sistema continuam fora do alcance do modelo.
    for (const doSistema of [
      "falha_tecnica",
      "teto_de_respostas",
      "nao_individual",
      "teto_atingido",
      "conformidade",
    ]) {
      expect(MOTIVOS_DO_AGENTE as readonly string[]).not.toContain(doSistema);
    }
  });

  it("os rótulos novos do contrato (4.2)", () => {
    expect(ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.falha_tecnica).toBe(
      "o assistente teve uma falha técnica",
    );
    expect(ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.teto_de_respostas).toBe(
      "o limite de respostas desta conversa na última hora acabou",
    );
    expect(ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.nao_individual).toBe(
      "a mensagem veio de um grupo, de um status ou de um canal",
    );
    expect(ROTULO_DO_MOTIVO_DE_ESCALONAMENTO.pedido_de_agenda).toBe(
      "o paciente quer marcar, remarcar ou cancelar",
    );
  });
});
