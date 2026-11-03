import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MOTIVOS_DO_AGENTE } from "@/lib/agente/ferramentas/escalar-humano";
import type { FalhaDoAgente } from "@/lib/agente/laco";
import { TEXTO_FIXO_DO_AGENTE } from "@/lib/agente/prompt";
import { CODIGOS_DA_ATRIBUICAO } from "@/lib/agente/whatsapp";
import {
  LIMITE_DO_NOME_NA_ATRIBUICAO,
  MOTIVOS_DE_ESCALONAMENTO,
  MOTIVOS_DE_SISTEMA_DA_IA,
  MOTIVOS_QUE_NUNCA_ATRIBUEM,
  ROTULO_DO_MOTIVO_DE_ESCALONAMENTO,
  TEXTO_DO_EVENTO_DA_IA,
  textoDaAtribuicaoDaIa,
  type PassagemDaConversa,
} from "@/lib/domain/agente/config";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";
import {
  MOTIVOS_DA_FALHA,
  type MotivoDaFalha,
} from "@/lib/domain/conformidade/veredicto";

// Espelhos do E3 entre o TS e o banco: a frase fixa e o corpo de cada evento
// no fio (lidos da migration MAIS NOVA que define cada funcao, que e o corpo
// que vale com todas aplicadas), os motivos de escalonamento, os codigos de
// motivo_da_falha e o grant de colunas de ai_decision_log (todas menos
// blocked_draft; estes tres da migration 20261013100000, M1). Mudou de um
// lado, o teste quebra ate mudar do outro.

const PASTA_DAS_MIGRATIONS = "supabase/migrations";
const ARQUIVO_DA_M1 = "20261013100000_ia_whatsapp_fila.sql";

const M1 = readFileSync(`${PASTA_DAS_MIGRATIONS}/${ARQUIVO_DA_M1}`, "utf-8");

/** As migrations em ordem de aplicacao (o nome comeca pela data e hora). */
const MIGRATIONS = readdirSync(PASTA_DAS_MIGRATIONS)
  .filter((arquivo) => arquivo.endsWith(".sql"))
  .sort();

/** Os literais entre aspas simples de um trecho de SQL. */
function literais(trecho: string): string[] {
  return [...trecho.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

/**
 * O corpo ($function$ ... $function$) de uma funcao na migration MAIS NOVA
 * que a cria ou recria (create ou create or replace): o banco aplica as
 * migrations em ordem, entao e esse o corpo que vale. Devolve tambem o
 * arquivo, para o teste dizer de onde leu.
 */
function corpoMaisNovo(nome: string): { arquivo: string; corpo: string } {
  const definicao = new RegExp(
    `create (?:or replace )?function public\\.${nome}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`,
    "gi",
  );
  for (const arquivo of [...MIGRATIONS].reverse()) {
    const sql = readFileSync(`${PASTA_DAS_MIGRATIONS}/${arquivo}`, "utf-8");
    // A ultima definicao do arquivo, se ele tiver mais de uma.
    const corpo = [...sql.matchAll(definicao)].at(-1)?.[1];
    if (corpo !== undefined) {
      return { arquivo, corpo };
    }
  }
  throw new Error(`${nome} nao encontrada nas migrations`);
}

/**
 * Os literais do CHECK ai_decision_log_escalation_reason_valida na migration
 * MAIS NOVA que o (re)define: o E3 (M1); na onda 2 (item 5), a
 * 20261022110000, que acrescenta fora_do_assunto; e, na AG3, a
 * 20261027120000, que acrescenta consulta_para_outra_pessoa, ja_tem_consulta
 * e faltam_dados com o CHECK NOT VALID (validado logo depois). O "not valid"
 * entre o fim do CHECK e o ponto e virgula e opcional: sem ele, a busca
 * preguicosa passaria do fim do CHECK e juntaria literais de outro trecho.
 */
function checkDoMotivoMaisNovo(): { arquivo: string; motivos: string[] } {
  const definicao =
    /add constraint ai_decision_log_escalation_reason_valida\s+check\s*\(([\s\S]*?)\)\s*\)\s*(?:not valid\s*)?[,;]/gi;
  for (const arquivo of [...MIGRATIONS].reverse()) {
    const sql = readFileSync(`${PASTA_DAS_MIGRATIONS}/${arquivo}`, "utf-8");
    const bloco = [...sql.matchAll(definicao)].at(-1)?.[1];
    if (bloco !== undefined) {
      return { arquivo, motivos: literais(bloco) };
    }
  }
  throw new Error("CHECK de escalation_reason nao encontrado nas migrations");
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

describe("espelhos do E3 com as migrations", () => {
  it("a frase fixa do SQL é a do TS, palavra por palavra", () => {
    const { corpo } = corpoMaisNovo("frase_de_escalonamento_da_ia");
    const frase = corpo.match(/select '([^']*)'::text/)?.[1];
    expect(frase).toBe(FRASE_DE_ESCALONAMENTO);
  });

  it("rotulo_do_motivo_da_ia vem da migration mais nova que o define, não da M1", () => {
    const { arquivo } = corpoMaisNovo("rotulo_do_motivo_da_ia");
    expect(arquivo).not.toBe(ARQUIVO_DA_M1);
    // A 20261019120000 (revisao de producao de 19/10/2026) recriou a funcao
    // com o texto novo de 'parada'; a da onda 2 (20261022110000, itens 5 e
    // 7) a recria com no_expediente, retomou_no_horario, fora_do_assunto e
    // o texto novo de horario_nao_suportado. Uma migration posterior que a
    // recrie passa a valer no lugar dela.
    expect(arquivo >= "20261022110000").toBe(true);
  });

  it("rotulo_do_motivo_da_ia é TEXTO_DO_EVENTO_DA_IA, motivo a motivo", () => {
    const { corpo } = corpoMaisNovo("rotulo_do_motivo_da_ia");
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

  it("MOTIVOS_DE_ESCALONAMENTO é o CHECK de escalation_reason mais novo (22, com os três da AG3 e o da AG4)", () => {
    const { arquivo, motivos } = checkDoMotivoMaisNovo();
    // Onda 2 (item 5): a 20261022110000 redefine o CHECK com
    // fora_do_assunto (18). AG3: a 20261027120000 o redefine de novo com
    // consulta_para_outra_pessoa, ja_tem_consulta e faltam_dados (21). AG4:
    // a 20261028100000, com fora_do_prazo (22). O E3 (M1) tinha 17.
    expect(arquivo >= "20261028100000").toBe(true);
    expect(motivos.sort()).toEqual([...MOTIVOS_DE_ESCALONAMENTO].sort());
    // [AG6 urgência] início
    // AG6a: a 20261029120000, com urgencia (23).
    expect(arquivo >= "20261029120000").toBe(true);
    // [AG6 urgência] fim
    // [AG6b mídia] início
    // AG6b: a 20261030100000, com os tres da midia (26).
    expect(arquivo >= "20261030100000").toBe(true);
    expect(MOTIVOS_DE_ESCALONAMENTO).toHaveLength(26);
    // [AG6b mídia] fim
    for (const motivo of [
      "fora_do_assunto",
      "consulta_para_outra_pessoa",
      "ja_tem_consulta",
      "faltam_dados",
      "fora_do_prazo",
      // [AG6 urgência] início
      "urgencia",
      // [AG6 urgência] fim
    ]) {
      expect(MOTIVOS_DE_ESCALONAMENTO).toContain(motivo);
    }
  });

  it("AG4: fora_do_prazo e do sistema (a ferramenta e o banco decidem pelo prazo), nunca do modelo", () => {
    expect(MOTIVOS_DO_AGENTE as readonly string[]).not.toContain(
      "fora_do_prazo",
    );
    expect(TEXTO_DO_EVENTO_DA_IA.fora_do_prazo).toBe(
      "A IA passou a conversa para a equipe: o pedido de cancelar ou remarcar ficou dentro do prazo da clínica.",
    );
    expect(
      corpoMaisNovo("rotulo_do_motivo_da_ia").arquivo >= "20261028100000",
    ).toBe(true);
  });

  it("o CHECK do E3 (M1) tinha os 17 de antes da onda 2 e da AG3", () => {
    const bloco = M1.match(
      /escalation_reason is null or escalation_reason in \(([\s\S]*?)\)\)/,
    )?.[1];
    const depoisDoE3: readonly string[] = [
      "fora_do_assunto",
      "consulta_para_outra_pessoa",
      "ja_tem_consulta",
      "faltam_dados",
      "fora_do_prazo",
      // [AG6 urgência] início
      "urgencia",
      // [AG6 urgência] fim
      // [AG6b mídia] início
      "midia_clinica",
      "documento_do_paciente",
      "midia_nao_identificada",
      // [AG6b mídia] fim
    ];
    expect(literais(bloco ?? "").sort()).toEqual(
      MOTIVOS_DE_ESCALONAMENTO.filter((m) => !depoisDoE3.includes(m)).sort(),
    );
  });

  it("AG3: os eventos dos três motivos novos são os do banco", () => {
    expect(TEXTO_DO_EVENTO_DA_IA.consulta_para_outra_pessoa).toBe(
      "A IA passou a conversa para a equipe: a consulta é para outra pessoa.",
    );
    expect(TEXTO_DO_EVENTO_DA_IA.ja_tem_consulta).toBe(
      "A IA passou a conversa para a equipe: o paciente já tem consulta marcada deste procedimento.",
    );
    expect(TEXTO_DO_EVENTO_DA_IA.faltam_dados).toBe(
      "A IA passou a conversa para a equipe: faltaram dados do paciente para marcar.",
    );
    // O corpo que vale e o da AG3 (ou de uma migration posterior).
    expect(
      corpoMaisNovo("rotulo_do_motivo_da_ia").arquivo >= "20261027120000",
    ).toBe(true);
  });

  it("onda 2: os motivos e os textos novos do contrato (seção 9)", () => {
    expect(MOTIVOS_DE_SISTEMA_DA_IA).toContain("no_expediente");
    expect(MOTIVOS_DE_SISTEMA_DA_IA).toContain("retomou_no_horario");
    expect(TEXTO_DO_EVENTO_DA_IA.fora_do_assunto).toBe(
      "A IA passou a conversa para a equipe: a pessoa insistiu num assunto fora da clínica.",
    );
    expect(TEXTO_DO_EVENTO_DA_IA.no_expediente).toBe(
      "O assistente não respondeu: agora é o horário da equipe. Se ninguém da equipe responder, ele assume quando o horário dele começar.",
    );
    expect(TEXTO_DO_EVENTO_DA_IA.retomou_no_horario).toBe(
      "Começou o horário do assistente: ele assumiu esta conversa, que ninguém da equipe tinha respondido.",
    );
    expect(TEXTO_DO_EVENTO_DA_IA.horario_nao_suportado).toBe(
      "O assistente não atende pelo WhatsApp no modo de horário escolhido. A conversa ficou com a equipe.",
    );
    // fora_do_assunto e do sistema (o laco conta a janela), nunca do modelo.
    expect(MOTIVOS_DO_AGENTE as readonly string[]).not.toContain(
      "fora_do_assunto",
    );
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
    // [AG7 preparo] início
    // O grant que vale com todas as migrations aplicadas: o do M1 (que
    // revoga tudo da sessão e dá as colunas) mais o de toda migration depois
    // dele (a AG7, 20261103100000, dá o SELECT de preparo_versao_id). Um
    // "revoke all" de ai_decision_log recomeça a conta.
    const eventos =
      /(revoke all on public\.ai_decision_log from anon, authenticated)|grant select \(([\s\S]*?)\) on public\.ai_decision_log to authenticated/g;
    const colunas = new Set<string>();
    for (const arquivo of MIGRATIONS) {
      const sql = readFileSync(`${PASTA_DAS_MIGRATIONS}/${arquivo}`, "utf-8");
      for (const evento of sql.matchAll(eventos)) {
        if (evento[1] !== undefined) {
          colunas.clear();
          continue;
        }
        for (const coluna of (evento[2] ?? "").split(",")) {
          if (coluna.trim()) {
            colunas.add(coluna.trim());
          }
        }
      }
    }
    const colunasDoGrant = [...colunas];
    expect(colunasDoGrant).toContain("preparo_versao_id");
    // [AG7 preparo] fim
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
      "fora_do_assunto",
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

// [AG6 urgência] início
// AG6a (migration 20261029120000): o motivo urgencia e do sistema (so o
// portao deterministico decide, D-52), com o evento do banco, a passagem de
// tres parametros e a atribuicao depois da frase (Revisao R1 do contrato da
// frente de banco, que substituiu a secao 2).
describe("AG6a: os espelhos da urgência e da passagem", () => {
  it("urgencia é do sistema: o modelo nunca escolhe", () => {
    expect(MOTIVOS_DO_AGENTE as readonly string[]).not.toContain("urgencia");
  });

  it("o evento da urgência é o do rótulo da migration da AG6a", () => {
    const { arquivo, corpo } = corpoMaisNovo("rotulo_do_motivo_da_ia");
    expect(arquivo >= "20261029120000").toBe(true);
    expect(corpo).toContain(
      "when 'urgencia' then 'A IA passou a conversa para a equipe: a pessoa descreveu algo que pode ser uma emergência.'",
    );
    expect(TEXTO_DO_EVENTO_DA_IA.urgencia).toBe(
      "A IA passou a conversa para a equipe: a pessoa descreveu algo que pode ser uma emergência.",
    );
  });

  it("a frase ao contato não muda na AG6a (a do 192 é da AG6c)", () => {
    const { corpo } = corpoMaisNovo("frase_de_escalonamento_da_ia");
    expect(corpo.match(/select '([^']*)'::text/)?.[1]).toBe(
      FRASE_DE_ESCALONAMENTO,
    );
    expect(FRASE_DE_ESCALONAMENTO).not.toMatch(/192|samu|188|cvv/i);
  });

  /** Os parametros e o corpo da definicao MAIS NOVA de uma funcao. */
  function definicaoMaisNova(nome: string): {
    arquivo: string;
    parametros: string;
    corpo: string;
  } | null {
    const definicao = new RegExp(
      `create (?:or replace )?function public\\.${nome}\\(([\\s\\S]*?)\\)\\s*returns jsonb[\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`,
      "gi",
    );
    for (const arquivo of [...MIGRATIONS].reverse()) {
      const sql = readFileSync(`${PASTA_DAS_MIGRATIONS}/${arquivo}`, "utf-8");
      const ultimo = [...sql.matchAll(definicao)].at(-1);
      if (ultimo !== undefined) {
        return {
          arquivo,
          parametros: (ultimo[1] ?? "").replace(/\s+/g, " ").trim(),
          corpo: ultimo[2] ?? "",
        };
      }
    }
    return null;
  }

  // Revisao R1 do contrato do banco (28/10/2026): a passagem volta aos tres
  // parametros e nunca atribui; a atribuicao e a RPC nova, chamada DEPOIS
  // da frase.
  it("a passagem da migration mais nova tem os três parâmetros de sempre, devolve {passou, codigo, urgente} e nunca atribui", () => {
    const achado = definicaoMaisNova("passar_conversa_da_ia_para_equipe");
    expect(achado?.arquivo).toBe(
      "20261029120000_urgencia_e_passagem_da_ia.sql",
    );
    expect(achado?.parametros).toBe(
      "p_job_id uuid, p_worker text, p_motivo text",
    );
    for (const chave of ["'passou'", "'codigo'", "'urgente'"]) {
      expect(achado?.corpo).toContain(chave);
    }
    expect(achado?.corpo).not.toContain("'atribuida'");
    expect(achado?.corpo).not.toContain("p_atribuir");
    expect(achado?.corpo).not.toMatch(/assignee_user_id\s*=/);
  });

  it("a atribuição (atribuir_conversa_passada_pela_ia) tem os parâmetros, os códigos e as listas do motor", () => {
    const achado = definicaoMaisNova("atribuir_conversa_passada_pela_ia");
    // [AG6b mídia] início
    // A AG6b (20261030100000) recria a funcao com midia_nao_lida e os oito
    // motivos; o corpo que vale e o dela.
    expect(achado?.arquivo).toBe("20261030100000_midia_pela_ia.sql");
    // [AG6b mídia] fim
    expect(achado?.parametros).toBe("p_job_id uuid, p_worker text");
    const corpo = achado?.corpo ?? "";
    // Cada codigo que o motor conhece sai do banco, e nenhum outro.
    const devolvidos = new Set(
      [...corpo.matchAll(/'codigo', '([a-z_]+)'/g)].map((m) => m[1]),
    );
    expect(devolvidos).toEqual(new Set(CODIGOS_DA_ATRIBUICAO));
    // Revisao R2 do contrato do banco: as recusas na ORDEM do motor (a
    // primeira vez que cada codigo aparece no corpo), com mensagem_nova
    // entre urgente e regra_fila. "atribuida" e "erro" ficam de fora (o
    // sucesso e o bloco de excecao vem no fim do corpo).
    const naOrdem = [
      ...new Set(
        [...corpo.matchAll(/'codigo', '([a-z_]+)'/g)].map((m) => m[1]),
      ),
    ].filter((codigo) => codigo !== "atribuida" && codigo !== "erro");
    expect(naOrdem).toEqual(
      CODIGOS_DA_ATRIBUICAO.filter(
        (codigo) => codigo !== "atribuida" && codigo !== "erro",
      ),
    );
    // As listas do banco sao as do motor.
    const lista = (constante: string) =>
      literais(
        corpo.match(
          new RegExp(
            `${constante} constant text\\[\\] := array\\[([^\\]]*)\\]`,
          ),
        )?.[1] ?? "",
      );
    expect(lista("c_motivos_que_nunca_atribuem")).toEqual([
      ...MOTIVOS_QUE_NUNCA_ATRIBUEM,
    ]);
    expect(lista("c_desfechos_que_passam")).toEqual([
      "escalou",
      "bloqueou",
      "falhou",
    ]);
    expect(lista("c_papeis_que_recebem")).toEqual([
      "admin",
      "gestor",
      "recepcao",
      "profissional",
    ]);
    expect(corpo).toContain(
      `c_regra_do_responsavel constant text := '${"responsavel_do_lead" satisfies PassagemDaConversa}'`,
    );
    expect(corpo).toContain(
      `c_limite_do_nome constant integer := ${LIMITE_DO_NOME_NA_ATRIBUICAO}`,
    );
    // O evento da atribuicao e o espelho do motor.
    expect(corpo).toContain(`'${textoDaAtribuicaoDaIa(null)}'`);
    expect(corpo).toContain(
      "'A conversa ficou com ' || v_nome || ', responsável pelo lead.'",
    );
    expect(textoDaAtribuicaoDaIa("Ana")).toBe(
      "A conversa ficou com Ana, responsável pelo lead.",
    );
  });
});
// [AG6 urgência] fim

// [AG6b mídia] início
// AG6b (migration 20261030100000; contrato da frente de banco,
// ag6/contrato-ag6b.md): o CHECK dos papeis de ia_uso, os codigos de
// gravar_leitura_da_midia NA ORDEM, o portao do aviso e os textos do rotulo
// dos tres motivos novos.
describe("AG6b: os espelhos da midia", () => {
  const AG6B = "20261030100000_midia_pela_ia.sql";
  const sql = readFileSync(`${PASTA_DAS_MIGRATIONS}/${AG6B}`, "utf-8");

  it("o CHECK de ia_uso.papel tem os dois papeis novos do motor", () => {
    const papeis = literais(
      sql.match(/add constraint ia_uso_papel_valido\s+check \(papel in \(([^)]*)\)/)?.[1] ?? "",
    );
    expect(papeis).toEqual([
      "agente",
      "verificador",
      "classificador",
      "transcricao",
      "leitor_de_midia",
    ]);
  });

  it("gravar_leitura_da_midia: os erros e as recusas na ordem do motor", () => {
    const corpo =
      sql.match(
        /create function public\.gravar_leitura_da_midia\([\s\S]*?\$function\$([\s\S]*?)\$function\$/,
      )?.[1] ?? "";
    const erros = [...corpo.matchAll(/errcode = '22023', message = '([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    expect(erros).toEqual([
      "midia_invalida",
      "tipo_invalido",
      "transcricao_invalida",
      "segundos_invalidos",
      "itens_invalidos",
      "fora_do_cadastro_invalido",
      "confianca_invalida",
      "resumo_invalido",
      "modelo_invalido",
      "versao_invalida",
    ]);
    const recusas = [
      ...new Set(
        [...corpo.matchAll(/'ok', false, 'motivo', '([a-z_]+)'/g)].map((m) => m[1]),
      ),
    ];
    expect(recusas).toEqual([
      "sem_posse",
      "job_antigo",
      "fora_da_ia",
      "mensagem_invalida",
      "mensagem_nao_lida",
      "leitura_desligada",
      "midia_bloqueada",
      "procedimento_invalido",
    ]);
    // As chaves das habilidades que o banco le (as de config.ts).
    expect(corpo).toContain("'ler_audio'");
    expect(corpo).toContain("'ler_imagem_e_documento'");
  });

  it("midia_da_ia_liberada devolve boolean (o motor confere antes de mandar)", () => {
    expect(sql).toMatch(
      /create function public\.midia_da_ia_liberada\(p_clinic_id uuid, p_telefone text\)\s*returns boolean/,
    );
  });

  it("o rotulo dos tres motivos novos e o do motor", () => {
    const { arquivo, corpo } = corpoMaisNovo("rotulo_do_motivo_da_ia");
    expect(arquivo).toBe(AG6B);
    for (const motivo of [
      "midia_clinica",
      "documento_do_paciente",
      "midia_nao_identificada",
    ] as const) {
      expect(corpo).toContain(`when '${motivo}' then '${TEXTO_DO_EVENTO_DA_IA[motivo]}'`);
    }
  });
});
// [AG6b mídia] fim
