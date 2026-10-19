import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// A migration 20261019120000 (ajustes da revisao de producao do E3, 19/10/2026)
// e o arquivo de rollback dela, lidos do repositorio. O comportamento de
// verdade e provado pelo ensaio (~/.claude/plans/e3-whatsapp/ensaios/
// ensaio-m6-20261019120000.sql, validado num Postgres 18 local com os corpos
// de producao) e pelas suites de RLS e integracao; aqui, o que da para
// conferir sem banco:
//   - os md5 dos corpos novos (os mesmos que o ensaio exige) e os dos
//     corpos de producao guardados no rollback (os mesmos da pre-condicao);
//   - rotulo_do_motivo_da_ia: so 'parada' muda, para o texto neutro;
//   - definir_contato_liberado_da_ia: a assinatura antiga sai (DROP), a
//     nova tem a confirmacao do aviso da OpenAI por nome, recusa telefone
//     novo sem ela, grava a trilha e mantem os grants de hoje;
//   - ia_devolver_disponivel: a pergunta pendente depois da liberacao;
//   - situacao_da_ia_na_clinica: a chave nova conversas_abertas, com a antiga.

const MIGRATION = readFileSync(
  "supabase/migrations/20261019120000_ia_ajustes_do_teste.sql",
  "utf-8",
);
const ROLLBACK = readFileSync(
  "supabase/operacao/rollback/20261019120000-corpos-anteriores.sql",
  "utf-8",
);
const M1 = readFileSync(
  "supabase/migrations/20261013100000_ia_whatsapp_fila.sql",
  "utf-8",
);

const PARADA_NOVA =
  "O assistente não atendeu esta mensagem: ele está parado para este telefone ou este número.";

/** O corpo (prosrc) de uma funcao: o texto entre os $function$ dela. */
function corpo(sql: string, nome: string, assinatura = ""): string {
  const inicio = sql.search(
    new RegExp(`function public\\.${nome}\\(${assinatura}`, "i"),
  );
  expect(inicio, nome).toBeGreaterThan(-1);
  const resto = sql.slice(inicio);
  const m = resto.match(/\bas \$function\$([\s\S]*?)\$function\$/i);
  expect(m, nome).not.toBeNull();
  return m![1]!;
}

function md5(texto: string): string {
  return createHash("md5").update(texto).digest("hex");
}

/** Motivo a motivo, os textos de rotulo_do_motivo_da_ia de um corpo. */
function rotulos(corpoDaFuncao: string): Record<string, string> {
  return Object.fromEntries(
    [...corpoDaFuncao.matchAll(/when '([a-z_]+)' then '([^']*)'/g)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  );
}

describe("migration 20261019120000: os corpos e o rollback", () => {
  it("os md5 dos corpos novos são os que o ensaio exige", () => {
    expect(md5(corpo(MIGRATION, "situacao_da_ia_na_clinica"))).toBe(
      "e3511c98e850a1c864583bb7a18d810c",
    );
    expect(
      md5(
        corpo(
          MIGRATION.slice(
            MIGRATION.indexOf("create function public.definir_contato"),
          ),
          "definir_contato_liberado_da_ia",
        ),
      ),
    ).toBe("fb255417969a243fb52b8c1ec81dec33");
    expect(md5(corpo(MIGRATION, "ia_devolver_disponivel"))).toBe(
      "faa9933cb6dfd6375e33d2ba22d7f6bc",
    );
    expect(md5(corpo(MIGRATION, "rotulo_do_motivo_da_ia"))).toBe(
      "ffb97d9cafc2f4762ba7360d3ad3e938",
    );
  });

  it("o rollback guarda os corpos de produção lidos em 19/10/2026 (os md5 da pré-condição)", () => {
    expect(md5(corpo(ROLLBACK, "situacao_da_ia_na_clinica"))).toBe(
      "b55aac57b8ba2a3deaf4f891ec849569",
    );
    expect(md5(corpo(ROLLBACK, "definir_contato_liberado_da_ia"))).toBe(
      "277d6a2d9d9570d053cc0f5babf2c464",
    );
    expect(md5(corpo(ROLLBACK, "ia_devolver_disponivel"))).toBe(
      "51e075928ba19e3134fa20fbc4359edf",
    );
    expect(md5(corpo(ROLLBACK, "rotulo_do_motivo_da_ia"))).toBe(
      "0bced0b96b2e7af3fb4ff5749f877125",
    );
    // a nova sai e a de cinco parametros volta, com os grants de hoje
    expect(ROLLBACK).toContain(
      "drop function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean);",
    );
    expect(ROLLBACK).toContain(
      "grant execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean) to authenticated, service_role;",
    );
  });
});

describe("migration 20261019120000: o que muda", () => {
  it("rotulo_do_motivo_da_ia: só parada muda, para o texto neutro (nunca 'parado nesta clínica')", () => {
    const antes = rotulos(corpo(M1, "rotulo_do_motivo_da_ia"));
    const depois = rotulos(corpo(MIGRATION, "rotulo_do_motivo_da_ia"));
    expect(Object.keys(depois).sort()).toEqual(Object.keys(antes).sort());
    expect(depois.parada).toBe(PARADA_NOVA);
    expect(antes.parada).toBe(
      "O assistente não atendeu esta mensagem: ele está parado nesta clínica.",
    );
    const semParada = (rotulosDeUmCorpo: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(rotulosDeUmCorpo).filter(
          ([motivo]) => motivo !== "parada",
        ),
      );
    expect(semParada(depois)).toEqual(semParada(antes));
    expect(PARADA_NOVA).not.toMatch(/clínica|Configura|[—–]/);
    expect(MIGRATION).toMatch(/RETURNS text\n LANGUAGE sql\n IMMUTABLE/);
  });

  it("definir_contato_liberado_da_ia: DROP da assinatura de hoje e a nova com a confirmação por nome", () => {
    expect(MIGRATION).toContain(
      "drop function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean);",
    );
    expect(MIGRATION).toContain(
      "p_forcar_contato_existente boolean DEFAULT false, p_confirmou_aviso_da_openai boolean DEFAULT false)",
    );
    const novo = corpo(
      MIGRATION.slice(
        MIGRATION.indexOf("create function public.definir_contato"),
      ),
      "definir_contato_liberado_da_ia",
    );
    // telefone fora da lista: desligar nao cria linha; ligar exige a
    // confirmacao (23514), e a trilha sai na mesma transacao
    const semLinha = novo.indexOf("if not found then");
    expect(novo.indexOf("return false;", semLinha)).toBeGreaterThan(semLinha);
    expect(novo).toContain(
      "raise exception using errcode = '23514', message = 'aviso_da_openai_nao_confirmado';",
    );
    expect(novo.indexOf("aviso_da_openai_nao_confirmado")).toBeLessThan(
      novo.indexOf("insert into public.ia_contato_liberado"),
    );
    expect(novo).toContain(
      "values (p_clinic_id, auth.uid(), 'confirmou_aviso_da_openai', 'ia_contato_liberado', v_id);",
    );
    expect(novo).toContain(
      "if p_ativo and coalesce(p_confirmou_aviso_da_openai, false) then",
    );
    // o guarda e o forcar de hoje continuam, antes de qualquer leitura
    expect(novo.indexOf("ia_exigir_quem_libera")).toBeLessThan(
      novo.indexOf("ia_exigir_equipe_conduzza"),
    );
    // os grants de hoje: nada para anon nem public
    expect(MIGRATION).toContain(
      "revoke execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean) from public, anon;",
    );
    expect(MIGRATION).toContain(
      "grant execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean) to authenticated, service_role;",
    );
  });

  it("os tipos gerados têm o parâmetro novo, opcional", () => {
    const tipos = readFileSync("lib/supabase/database.types.ts", "utf-8");
    const bloco = tipos.match(
      /definir_contato_liberado_da_ia: \{\s*Args: \{([\s\S]*?)\}/,
    )?.[1];
    expect(bloco).toContain("p_confirmou_aviso_da_openai?: boolean");
    expect(bloco).toContain("p_forcar_contato_existente?: boolean");
  });

  it("ia_devolver_disponivel: a pergunta pendente só depois da liberação", () => {
    const novo = corpo(MIGRATION, "ia_devolver_disponivel");
    const pergunta = novo.indexOf("'pergunta_pendente'");
    expect(pergunta).toBeGreaterThan(
      novo.indexOf("v_motivo := 'assistente_desligado'"),
    );
    expect(pergunta).toBeGreaterThan(
      novo.indexOf("v_motivo := 'nao_liberada'"),
    );
    expect(pergunta).toBeGreaterThan(
      novo.indexOf("v_motivo := 'contato_de_paciente'"),
    );
    // e so com a liberacao conferida (dentro do v_motivo nulo)
    expect(pergunta).toBeGreaterThan(novo.indexOf("if v_motivo is null then"));
    expect(novo.match(/'pergunta_pendente'/g)).toHaveLength(1);
    // o de antes conferia a pergunta antes
    const antigo = corpo(ROLLBACK, "ia_devolver_disponivel");
    expect(antigo.indexOf("'pergunta_pendente'")).toBeLessThan(
      antigo.indexOf("v_motivo := 'nao_liberada'"),
    );
  });

  it("situacao_da_ia_na_clinica: conversas_abertas por telefone e número, com a chave antiga", () => {
    const novo = corpo(MIGRATION, "situacao_da_ia_na_clinica");
    expect(novo).toContain("'conversas_abertas', v_conversas,");
    expect(novo).toContain("'telefones_com_conversa_aberta', v_abertas,");
    for (const campo of [
      "'telefone_id'",
      "'whatsapp_account_id'",
      "'conversation_id'",
    ]) {
      expect(novo).toContain(campo);
    }
    const bloco = novo.slice(novo.indexOf("into v_conversas"));
    expect(bloco).toContain(
      "and c.status in ('aguardando_humano', 'em_atendimento')",
    );
    expect(bloco).toContain("and n.ativo");
    expect(bloco).toContain("and w.removido_em is null");
    expect(bloco).toContain("and k.ativo");
    // a guarda de hoje continua
    expect(novo).toContain("public.ia_membro_ve_a_liberacao(p_clinic_id)");
  });

  it("nenhuma DDL de tabela: só funções e os grants da recriada", () => {
    expect(MIGRATION).not.toMatch(/\b(alter|lock)\s+table\b/i);
    expect(MIGRATION).not.toMatch(/\bcreate\s+(unique\s+)?index\b/i);
    expect(MIGRATION).not.toMatch(
      /\b(insert\s+into|update|delete\s+from)\s+public\.(?!ia_contato_liberado|audit_log)/i,
    );
  });
});
