import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// O executor de verdade fica de fora: aqui so importam as listas.
vi.mock("@/lib/jobs/worker", () => ({ executarJobComPosse: vi.fn() }));

import {
  KINDS_DE_ENVIO,
  KINDS_DE_GASTO,
  KINDS_DE_INTEGRACAO,
  KINDS_DE_MIDIA,
  KINDS_DO_MOTOR,
} from "@/lib/jobs/kinds";
import { CUSTO_ESTIMADO_MS } from "@/lib/jobs/motor";
import { KINDS_DE_ENVIO_AUTOMATICO } from "@/lib/queries/mensagens-esperando";

// As listas de kinds da fila contra o banco (desenho revisado 2.4 e o item
// "o CHECK de kinds do banco e igual a uniao das listas de claim do motor").
// Kind que o banco aceita e nenhum trilho reivindica fica pendente para
// sempre, sem last_error; kind que o motor reivindica e o banco recusa
// nunca nasce. E a traducao do codigo de erro do executor para o motivo da
// tela (motivo_da_agendada) conferida contra o SQL da migration.

const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");

/** O SQL da migration mais recente que redefine o CHECK de kind. */
function ultimaDefinicaoDoCheck(): { arquivo: string; sql: string } {
  const arquivos = readdirSync(MIGRATIONS)
    .filter((nome) => nome.endsWith(".sql"))
    .sort();
  for (const arquivo of arquivos.reverse()) {
    const sql = readFileSync(path.join(MIGRATIONS, arquivo), "utf8");
    if (/add constraint job_queue_kind_check/i.test(sql)) {
      return { arquivo, sql };
    }
  }
  throw new Error("Nenhuma migration define job_queue_kind_check.");
}

function kindsDoCheck(sql: string): string[] {
  const trechos = [
    ...sql.matchAll(
      /add constraint job_queue_kind_check\s+check\s*\(\s*kind\s+(?:in\s*\(|=\s*any\s*\(\s*array\s*\[)([^)\]]*)/gi,
    ),
  ];
  const ultimo = trechos[trechos.length - 1];
  if (!ultimo) {
    throw new Error("CHECK de kind ilegivel.");
  }
  return [...ultimo[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe("kinds da fila", () => {
  it("o CHECK de kind do banco é exatamente a união dos trilhos do motor", () => {
    const { sql } = ultimaDefinicaoDoCheck();
    expect([...kindsDoCheck(sql)].sort()).toEqual([...KINDS_DO_MOTOR].sort());
  });

  it("nenhum kind em dois trilhos", () => {
    const todos = [
      ...KINDS_DE_ENVIO,
      ...KINDS_DE_MIDIA,
      ...KINDS_DE_INTEGRACAO,
      ...KINDS_DE_GASTO,
    ];
    expect(new Set(todos).size).toBe(todos.length);
  });

  it("a mensagem agendada disputa o slot de envio e entra na faixa de mensagens esperando", () => {
    expect(KINDS_DE_ENVIO).toContain("enviar_mensagem_agendada");
    expect([...KINDS_DE_ENVIO_AUTOMATICO]).toEqual([...KINDS_DE_ENVIO]);
  });

  it("todo kind do motor tem custo estimado (o da agendada é o do envio ativo)", () => {
    for (const kind of KINDS_DO_MOTOR) {
      expect(CUSTO_ESTIMADO_MS[kind], kind).toBeGreaterThan(0);
    }
    expect(CUSTO_ESTIMADO_MS.enviar_mensagem_agendada).toBe(
      CUSTO_ESTIMADO_MS.enviar_mensagem_ativa,
    );
  });
});

// motivo_da_agendada (SQL): le os ramos "when p_codigo in (...) then 'x'" e
// "when p_codigo = '...' then 'x'" e o "else 'y'" do corpo da funcao.
function motivoDaAgendadaDoSql(): (codigo: string) => string {
  const sql = readFileSync(
    path.join(MIGRATIONS, "20261006140000_mensagem_agendada.sql"),
    "utf8",
  );
  const corpo = sql.match(
    /create or replace function public\.motivo_da_agendada\(p_codigo text\)[\s\S]*?\$\$([\s\S]*?)\$\$/i,
  )?.[1];
  if (!corpo) {
    throw new Error("motivo_da_agendada ilegivel.");
  }
  const ramos: { codigos: string[]; motivo: string }[] = [];
  for (const ramo of corpo.matchAll(
    /when\s+p_codigo\s+(?:in\s*\(([^)]*)\)|=\s*('[^']*'))\s+then\s+'([a-z_]+)'/gi,
  )) {
    const lista = ramo[1] ?? ramo[2] ?? "";
    ramos.push({
      codigos: [...lista.matchAll(/'([^']*)'/g)].map((m) => m[1]!),
      motivo: ramo[3]!,
    });
  }
  const padrao = corpo.match(/else\s+'([a-z_]+)'/i)?.[1];
  if (!padrao || ramos.length === 0) {
    throw new Error("motivo_da_agendada ilegivel.");
  }
  return (codigo) =>
    ramos.find((ramo) => ramo.codigos.includes(codigo))?.motivo ?? padrao;
}

describe("código do executor para o motivo da tela (motivo_da_agendada)", () => {
  const motivo = motivoDaAgendadaDoSql();

  it.each([
    // Os desfechos que a tela explica com um motivo proprio.
    ["atrasou", "atrasou"],
    // F4: cairia de madrugada (o 08:00 seguinte passa do prazo).
    ["madrugada", "madrugada"],
    ["numero_removido", "numero_removido"],
    ["desconectado", "numero_desconectado"],
    ["sem_consentimento", "sem_autorizacao"],
    ["sem_consentimento_no_envio", "sem_autorizacao"],
    ["canal_ocupado", "canal_ocupado"],
    ["devolucoes_demais", "canal_ocupado"],
    ["envio_incerto", "envio_incerto"],
    // O resto e "erro do sistema no envio".
    ["payload_invalido", "falha_no_envio"],
    ["conta_divergente", "falha_no_envio"],
    ["conversa_indisponivel", "falha_no_envio"],
    ["leitura_falhou", "falha_no_envio"],
    ["excecao_no_worker", "falha_no_envio"],
    ["consentimento_ilegivel: 57014", "falha_no_envio"],
    ["provider_indisponivel", "falha_no_envio"],
    ["registro_falhou", "falha_no_envio"],
    ["silencio_noturno", "falha_no_envio"],
  ])("'%s' vira '%s'", (codigo, esperado) => {
    expect(motivo(codigo)).toBe(esperado);
  });
});
