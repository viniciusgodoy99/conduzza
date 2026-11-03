import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DesfechoDoTurno } from "@/lib/agente/laco";
import type { SaidaDoTurno } from "@/lib/agente/whatsapp";
import type { Database } from "@/lib/supabase/database.types";

// AG7 (contrato, secao 7.3, ag7-espelhos): o que o motor grava e chama
// contra a migration nova (20261103100000_preparo_aprovado_pelo_rt.sql), que
// a frente B escreveu: o desfecho do turno contra o CHECK de
// ai_decision_log.desfecho, a saida do turno contra o de ai_turno.saida, e
// as RPCs que o motor e a regua chamam (o nome, os parametros e o grant so
// para a service role). E a migration nao contem os textos que os testes
// usam para achar "a migration mais nova" dos outros objetos (contrato,
// secao 0, item 18). Nada de banco: so os arquivos.

const RAIZ = path.resolve(__dirname, "../../..");
const MIGRATION = readFileSync(
  path.join(
    RAIZ,
    "supabase/migrations/20261103100000_preparo_aprovado_pelo_rt.sql",
  ),
  "utf8",
);

/** Os valores de um CHECK "<coluna> in ('a', 'b')" de uma constraint. */
function valoresDoCheck(constraint: string, coluna: string): string[] {
  const inicio = MIGRATION.indexOf(`add constraint ${constraint}`);
  expect(inicio, constraint).toBeGreaterThanOrEqual(0);
  const trecho = MIGRATION.slice(inicio, inicio + 600);
  const lista = new RegExp(`${coluna} in \\(([^)]*)\\)`).exec(trecho)?.[1];
  expect(lista, constraint).toBeDefined();
  return [...(lista ?? "").matchAll(/'([^']*)'/g)].map((m) => m[1] ?? "");
}

// Os valores do TS, com a conferencia de que a lista e completa (um tipo
// novo sem estar aqui nao compila).
const DESFECHOS = [
  "respondeu",
  "escalou",
  "bloqueou",
  "falhou",
  "enviou_preparo",
] as const satisfies readonly DesfechoDoTurno["tipo"][];
const SAIDAS = [
  "resposta",
  "frase",
  "nenhuma",
  "preparo",
] as const satisfies readonly SaidaDoTurno[];
type DesfechoQueFalta = Exclude<
  DesfechoDoTurno["tipo"],
  (typeof DESFECHOS)[number]
>;
type SaidaQueFalta = Exclude<SaidaDoTurno, (typeof SAIDAS)[number]>;
const desfechosCompletos: [DesfechoQueFalta] extends [never] ? true : false =
  true;
const saidasCompletas: [SaidaQueFalta] extends [never] ? true : false = true;

/** As RPCs que o motor, o executor, o simulador e a regua chamam. */
const RPCS_DO_MOTOR: Readonly<Record<string, readonly string[]>> = {
  preparos_em_vigor_da_clinica: ["p_clinic_id uuid"],
  textos_de_preparo_da_clinica: ["p_clinic_id uuid"],
  ler_preparo_para_envio: [
    "p_clinic_id uuid",
    "p_versao_id uuid",
    "p_simulador boolean default false",
  ],
  preparo_em_vigor_do_procedimento: ["p_clinic_id uuid", "p_procedure_id uuid"],
};

describe("o desfecho e a saida do turno contra a migration", () => {
  it("DesfechoDoTurno e o CHECK ai_decision_log_desfecho_valido", () => {
    expect(desfechosCompletos).toBe(true);
    expect(
      valoresDoCheck("ai_decision_log_desfecho_valido", "desfecho").sort(),
    ).toEqual([...DESFECHOS].sort());
  });

  it("SaidaDoTurno e o CHECK ai_turno_saida_valida", () => {
    expect(saidasCompletas).toBe(true);
    expect(valoresDoCheck("ai_turno_saida_valida", "saida").sort()).toEqual(
      [...SAIDAS].sort(),
    );
  });

  it("a decisao do preparo leva a versao e o hash (ai_decision_log_preparo_coerente)", () => {
    const inicio = MIGRATION.indexOf(
      "add constraint ai_decision_log_preparo_coerente",
    );
    const trecho = MIGRATION.slice(inicio, inicio + 700);
    expect(trecho).toContain(
      "(desfecho is not distinct from 'enviou_preparo') = (preparo_versao_id is not null)",
    );
    expect(trecho).toContain("texto_sha256 is not null");
    expect(trecho).toContain("aprovado is not true");
    expect(trecho).toContain("escalation_reason is null");
  });
});

describe("as RPCs do motor contra a migration e os tipos", () => {
  it.each(Object.entries(RPCS_DO_MOTOR))(
    "%s: a assinatura, so a service role executa, e os tipos tem a funcao",
    (nome, parametros) => {
      expect(MIGRATION).toContain(
        `create function public.${nome}(${parametros.join(", ")})`,
      );
      const tipos = parametros.map((p) => p.split(" ")[1]).join(", ");
      expect(MIGRATION).toMatch(
        new RegExp(
          `grant execute on function public\\.${nome}\\(${tipos.replace(/[()]/g, "\\$&")}\\)\\s+to service_role;`,
        ),
      );
      expect(MIGRATION).not.toMatch(
        new RegExp(
          `grant execute on function public\\.${nome}\\([^)]*\\)\\s+to [^;]*authenticated`,
        ),
      );
      const funcoes: readonly string[] = [
        "preparos_em_vigor_da_clinica",
        "textos_de_preparo_da_clinica",
        "ler_preparo_para_envio",
        "preparo_em_vigor_do_procedimento",
      ] satisfies readonly (keyof Database["public"]["Functions"])[];
      expect(funcoes).toContain(nome);
    },
  );

  it("a coluna preparo_versao_id nos tipos de ai_decision_log", () => {
    const coluna: keyof Database["public"]["Tables"]["ai_decision_log"]["Row"] =
      "preparo_versao_id";
    expect(coluna).toBe("preparo_versao_id");
  });
});

describe("a migration nao se passa pela mais nova de outro objeto (item 18)", () => {
  it.each([
    "escalation_reason is null or escalation_reason in (",
    "add constraint ai_decision_log_escalation_reason_valida",
    "add constraint ai_decision_log_gatilho_entrada_valido",
    "function public.rotulo_do_motivo_da_ia(",
    "function public.passar_conversa_da_ia_para_equipe(",
    "function public.atribuir_conversa_passada_pela_ia(",
    "function public.frase_de_escalonamento_da_ia(",
    "add constraint job_queue_kind_check",
  ])("sem %s", (texto) => {
    expect(MIGRATION).not.toContain(texto);
  });
});
