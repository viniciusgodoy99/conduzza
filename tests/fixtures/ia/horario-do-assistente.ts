// Tabela verdade UNICA do horario do assistente (onda 2, item 7; contrato,
// secao 4.3 e risco 2). Os mesmos casos rodam nos dois lados:
//  - no TypeScript: tests/unit/agente/horario-do-assistente.test.ts roda
//    horarioDoAssistente (horarioDoBanco + agenteAtendeAgora,
//    lib/domain/agente/config.ts), que e o que o executor decide;
//  - no banco: o ensaio da migration 20261022110000 copia estes casos
//    (casosDoHorarioEmSql, abaixo) e roda cada um em
//    ia_horario_do_assistente. Divergencia daria conversa nascendo de um
//    jeito na ingestao e o executor tirando de outro.
//
// Cada caso e uma linha de ai_agent_config (so as colunas do horario, como
// o banco guarda), o clinic.timezone e o instante (UTC). O resultado esta no
// vocabulario do banco: 'atende', 'no_expediente' ou 'modo_nao_suportado'
// ('sem_versao' e 'indisponivel' so existem no banco e ficam no ensaio).
//
// Regras que a tabela prende (as do TS, que o banco espelha):
//  - 24h atende sempre; fallback ("Se a equipe não responder") e
//    'modo_nao_suportado' (ainda nao atende no WhatsApp); modo que o codigo
//    nao conhece vira 24h (horarioDoBanco; no banco o CHECK nao deixa
//    gravar, o caso so prende o espelho);
//  - dia da semana e hora no fuso da clinica (0 = domingo, como extract(dow));
//  - dentro do expediente = minutos locais (hora x 60 + minuto, sem os
//    segundos) >= inicio e < fim;
//  - faixa do dia fora do formato (dia ausente, "aberto" que nao e booleano,
//    valor que nao e objeto, grade que nao e objeto) vira a padrao do dia:
//    segunda a sexta 08:00 a 18:00 abertas, sabado e domingo fechados;
//  - dia ABERTO com hora fora do formato HH:mm ou fim antes do inicio vira
//    08:00 a 18:00 aberto; dia FECHADO continua fechado, com qualquer hora;
//  - fuso nulo, vazio ou invalido cai em America/Fortaleza (no banco, o
//    "at time zone" invalido levanta 22023 e o bloco exception pega).
//
// Os ids sao estaveis: o ensaio e o relato citam o caso pelo id.

export type HorarioEsperado = "atende" | "no_expediente" | "modo_nao_suportado";

export type CasoDoHorario = {
  id: string;
  /** O que o caso prova (sem dado de paciente). */
  descricao: string;
  /** ai_agent_config.operating_mode como gravado. */
  operating_mode: string;
  /** ai_agent_config.operating_hours (jsonb). null = coluna nula. */
  operating_hours: unknown;
  fallback_minutes: number | null;
  /** clinic.timezone. null = coluna nula. */
  timezone: string | null;
  /** O instante da decisao, ISO em UTC (com Z). */
  agora: string;
  esperado: HorarioEsperado;
};

type Faixa = { aberto: unknown; inicio: unknown; fim: unknown };

const ABERTO = (inicio = "08:00", fim = "18:00"): Faixa => ({
  aberto: true,
  inicio,
  fim,
});
const FECHADO = (inicio = "08:00", fim = "18:00"): Faixa => ({
  aberto: false,
  inicio,
  fim,
});

/** A grade padrao da tela (expedientePadrao), como o banco guarda. */
function grade(trocas: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dom: FECHADO(),
    seg: ABERTO(),
    ter: ABERTO(),
    qua: ABERTO(),
    qui: ABERTO(),
    sex: ABERTO(),
    sab: FECHADO(),
    ...trocas,
  };
}

const FORTALEZA = "America/Fortaleza";
const NOVA_YORK = "America/New_York";

function caso(
  id: string,
  descricao: string,
  operating_mode: string,
  operating_hours: unknown,
  timezone: string | null,
  agora: string,
  esperado: HorarioEsperado,
  fallback_minutes: number | null = 5,
): CasoDoHorario {
  return {
    id,
    descricao,
    operating_mode,
    operating_hours,
    fallback_minutes,
    timezone,
    agora,
    esperado,
  };
}

// Semana de referencia (Fortaleza, UTC-3 o ano inteiro): segunda 19/10/2026
// a domingo 25/10/2026. 10:00 local = 13:00Z.
export const CASOS_DO_HORARIO: readonly CasoDoHorario[] = [
  // ---- modos ---------------------------------------------------------------
  caso(
    "H01",
    "24h sem grade atende",
    "24h",
    null,
    FORTALEZA,
    "2026-10-21T15:00:00Z",
    "atende",
  ),
  caso(
    "H02",
    "24h ignora a grade (quarta 10:00)",
    "24h",
    grade(),
    FORTALEZA,
    "2026-10-21T13:00:00Z",
    "atende",
  ),
  caso(
    "H03",
    "fallback nao e suportado no WhatsApp (quarta 10:00)",
    "fallback",
    grade(),
    FORTALEZA,
    "2026-10-21T13:00:00Z",
    "modo_nao_suportado",
  ),
  caso(
    "H04",
    "fallback nao e suportado nem fora do expediente (sabado)",
    "fallback",
    grade(),
    FORTALEZA,
    "2026-10-24T13:00:00Z",
    "modo_nao_suportado",
    null,
  ),
  caso(
    "H05",
    "modo desconhecido vira 24h (o CHECK do banco nao deixa gravar)",
    "noturno",
    grade(),
    FORTALEZA,
    "2026-10-21T13:00:00Z",
    "atende",
  ),

  // ---- fora do expediente: dia aberto e as bordas --------------------------
  caso(
    "H06",
    "quarta 10:00 e expediente",
    "fora_expediente",
    grade(),
    FORTALEZA,
    "2026-10-21T13:00:00Z",
    "no_expediente",
  ),
  caso(
    "H07",
    "quarta 07:59:59 ainda e fora (segundos nao contam)",
    "fora_expediente",
    grade(),
    FORTALEZA,
    "2026-10-21T10:59:59Z",
    "atende",
  ),
  caso(
    "H08",
    "quarta 08:00:00, o inicio entra",
    "fora_expediente",
    grade(),
    FORTALEZA,
    "2026-10-21T11:00:00Z",
    "no_expediente",
  ),
  caso(
    "H09",
    "quarta 17:59:59 ainda e expediente",
    "fora_expediente",
    grade(),
    FORTALEZA,
    "2026-10-21T20:59:59Z",
    "no_expediente",
  ),
  caso(
    "H10",
    "quarta 18:00:00, o fim nao entra",
    "fora_expediente",
    grade(),
    FORTALEZA,
    "2026-10-21T21:00:00Z",
    "atende",
  ),
  caso(
    "H11",
    "faixa com minutos: 12:14 dentro de 08:30 a 12:15",
    "fora_expediente",
    grade({ qua: ABERTO("08:30", "12:15") }),
    FORTALEZA,
    "2026-10-21T15:14:00Z",
    "no_expediente",
  ),
  caso(
    "H12",
    "faixa com minutos: 12:15 e o fim",
    "fora_expediente",
    grade({ qua: ABERTO("08:30", "12:15") }),
    FORTALEZA,
    "2026-10-21T15:15:00Z",
    "atende",
  ),
  caso(
    "H13",
    "faixa com minutos: 08:29 antes do inicio",
    "fora_expediente",
    grade({ qua: ABERTO("08:30", "12:15") }),
    FORTALEZA,
    "2026-10-21T11:29:00Z",
    "atende",
  ),

  // ---- dias fechados -------------------------------------------------------
  caso(
    "H14",
    "sabado fechado atende o dia todo",
    "fora_expediente",
    grade(),
    FORTALEZA,
    "2026-10-24T13:00:00Z",
    "atende",
  ),
  caso(
    "H15",
    "domingo fechado atende o dia todo",
    "fora_expediente",
    grade(),
    FORTALEZA,
    "2026-10-25T13:00:00Z",
    "atende",
  ),
  caso(
    "H16",
    "segunda fechada pela clinica atende",
    "fora_expediente",
    grade({ seg: FECHADO() }),
    FORTALEZA,
    "2026-10-19T13:00:00Z",
    "atende",
  ),
  caso(
    "H17",
    "sabado aberto 09:00 a 13:00: 10:00 e expediente",
    "fora_expediente",
    grade({ sab: ABERTO("09:00", "13:00") }),
    FORTALEZA,
    "2026-10-24T13:00:00Z",
    "no_expediente",
  ),
  caso(
    "H18",
    "sabado aberto 09:00 a 13:00: 13:00 e o fim",
    "fora_expediente",
    grade({ sab: ABERTO("09:00", "13:00") }),
    FORTALEZA,
    "2026-10-24T16:00:00Z",
    "atende",
  ),
  caso(
    "H19",
    "dia fechado com hora fora do formato continua fechado",
    "fora_expediente",
    grade({ sab: FECHADO("xx", "yy") }),
    FORTALEZA,
    "2026-10-24T13:00:00Z",
    "atende",
  ),

  // ---- grade nula e faixas fora do formato ---------------------------------
  caso(
    "H20",
    "grade nula: quarta usa a padrao (aberta 08:00 a 18:00)",
    "fora_expediente",
    null,
    FORTALEZA,
    "2026-10-21T13:00:00Z",
    "no_expediente",
  ),
  caso(
    "H21",
    "grade nula: sabado usa a padrao (fechado)",
    "fora_expediente",
    null,
    FORTALEZA,
    "2026-10-24T13:00:00Z",
    "atende",
  ),
  caso(
    "H22",
    "dia aberto com hora invalida (25:00 a 12:00) vira 08:00 a 18:00: 13:00 dentro",
    "fora_expediente",
    grade({ qua: ABERTO("25:00", "12:00") }),
    FORTALEZA,
    "2026-10-21T16:00:00Z",
    "no_expediente",
  ),
  caso(
    "H23",
    "dia aberto com fim antes do inicio (14:00 a 10:00) vira 08:00 a 18:00: 12:00 dentro",
    "fora_expediente",
    grade({ qua: ABERTO("14:00", "10:00") }),
    FORTALEZA,
    "2026-10-21T15:00:00Z",
    "no_expediente",
  ),
  caso(
    "H24",
    "dia aberto com fim antes do inicio vira 08:00 a 18:00: 18:30 fora",
    "fora_expediente",
    grade({ qua: ABERTO("14:00", "10:00") }),
    FORTALEZA,
    "2026-10-21T21:30:00Z",
    "atende",
  ),
  caso(
    "H25",
    "hora sem o zero (8:00 a 9:00) e fora do formato: vira 08:00 a 18:00, e 09:30 fica dentro",
    "fora_expediente",
    grade({ qua: ABERTO("8:00", "9:00") }),
    FORTALEZA,
    "2026-10-21T12:30:00Z",
    "no_expediente",
  ),
  caso(
    "H26",
    "fim igual ao inicio vira 08:00 a 18:00",
    "fora_expediente",
    grade({ qua: ABERTO("10:00", "10:00") }),
    FORTALEZA,
    "2026-10-21T13:00:00Z",
    "no_expediente",
  ),
  caso(
    "H27",
    "dia ausente na grade usa a padrao do dia (quarta aberta)",
    "fora_expediente",
    { seg: FECHADO() },
    FORTALEZA,
    "2026-10-21T13:00:00Z",
    "no_expediente",
  ),
  caso(
    "H28",
    "dia ausente na grade usa a padrao do dia (sabado fechado)",
    "fora_expediente",
    { seg: FECHADO() },
    FORTALEZA,
    "2026-10-24T13:00:00Z",
    "atende",
  ),
  caso(
    "H29",
    "'aberto' que nao e booleano usa a padrao do dia, nao a faixa (09:00 a 10:00)",
    "fora_expediente",
    grade({ qua: { aberto: "sim", inicio: "09:00", fim: "10:00" } }),
    FORTALEZA,
    "2026-10-21T15:00:00Z",
    "no_expediente",
  ),
  caso(
    "H30",
    "faixa do dia que nao e objeto usa a padrao do dia",
    "fora_expediente",
    grade({ qua: "aberto" }),
    FORTALEZA,
    "2026-10-21T13:00:00Z",
    "no_expediente",
  ),
  caso(
    "H31",
    "grade que e texto usa a padrao inteira",
    "fora_expediente",
    "segunda a sexta",
    FORTALEZA,
    "2026-10-21T13:00:00Z",
    "no_expediente",
  ),
  caso(
    "H32",
    "grade que e lista usa a padrao inteira",
    "fora_expediente",
    [],
    FORTALEZA,
    "2026-10-24T13:00:00Z",
    "atende",
  ),

  // ---- fuso -----------------------------------------------------------------
  // 19:30Z: 16:30 em Fortaleza (expediente); em UTC seria 19:30 (fora).
  caso(
    "H33",
    "fuso invalido cai em Fortaleza (nao em UTC)",
    "fora_expediente",
    grade(),
    "Invalid/Zone",
    "2026-10-21T19:30:00Z",
    "no_expediente",
  ),
  caso(
    "H34",
    "fuso nulo cai em Fortaleza",
    "fora_expediente",
    grade(),
    null,
    "2026-10-21T19:30:00Z",
    "no_expediente",
  ),
  caso(
    "H35",
    "fuso vazio cai em Fortaleza",
    "fora_expediente",
    grade(),
    "",
    "2026-10-21T19:30:00Z",
    "no_expediente",
  ),
  // 21:30Z: 17:30 em Manaus (UTC-4, expediente); em Fortaleza seria 18:30.
  caso(
    "H36",
    "o fuso da clinica vale: Manaus 17:30 e expediente",
    "fora_expediente",
    grade(),
    "America/Manaus",
    "2026-10-21T21:30:00Z",
    "no_expediente",
  ),
  caso(
    "H37",
    "o mesmo instante em Fortaleza (18:30) e fora",
    "fora_expediente",
    grade(),
    FORTALEZA,
    "2026-10-21T21:30:00Z",
    "atende",
  ),
  // 02:30Z de quinta e 23:30 de quarta em Fortaleza: o dia e o local.
  caso(
    "H38",
    "o dia da semana e o local: quarta 23:30 (quinta em UTC)",
    "fora_expediente",
    grade({ qua: ABERTO("20:00", "23:59"), qui: FECHADO() }),
    FORTALEZA,
    "2026-10-22T02:30:00Z",
    "no_expediente",
  ),
  caso(
    "H39",
    "quarta 23:59 e o fim (exclusivo)",
    "fora_expediente",
    grade({ qua: ABERTO("20:00", "23:59"), qui: FECHADO() }),
    FORTALEZA,
    "2026-10-22T02:59:00Z",
    "atende",
  ),

  // ---- horario de verao de um fuso estrangeiro (Nova York, 2026) ----------
  // Comeca domingo 08/03 (02:00 vira 03:00) e acaba domingo 01/11 (02:00
  // vira 01:00). Sexta 06/03: UTC-5. Segunda 09/03: UTC-4. Segunda 02/11:
  // UTC-5.
  caso(
    "H40",
    "antes do horario de verao: 08:00 (13:00Z) e expediente",
    "fora_expediente",
    grade(),
    NOVA_YORK,
    "2026-03-06T13:00:00Z",
    "no_expediente",
  ),
  caso(
    "H41",
    "antes do horario de verao: 07:59:59 e fora",
    "fora_expediente",
    grade(),
    NOVA_YORK,
    "2026-03-06T12:59:59Z",
    "atende",
  ),
  caso(
    "H42",
    "no horario de verao: 08:00 e 12:00Z",
    "fora_expediente",
    grade(),
    NOVA_YORK,
    "2026-03-09T12:00:00Z",
    "no_expediente",
  ),
  caso(
    "H43",
    "no horario de verao: 07:59:59 (11:59:59Z) e fora",
    "fora_expediente",
    grade(),
    NOVA_YORK,
    "2026-03-09T11:59:59Z",
    "atende",
  ),
  caso(
    "H44",
    "no horario de verao: 17:59:59 (21:59:59Z) ainda e expediente",
    "fora_expediente",
    grade(),
    NOVA_YORK,
    "2026-03-09T21:59:59Z",
    "no_expediente",
  ),
  caso(
    "H45",
    "depois do horario de verao: 08:00 volta a ser 13:00Z",
    "fora_expediente",
    grade(),
    NOVA_YORK,
    "2026-11-02T13:00:00Z",
    "no_expediente",
  ),
  caso(
    "H46",
    "depois do horario de verao: 12:59:59Z e 07:59:59",
    "fora_expediente",
    grade(),
    NOVA_YORK,
    "2026-11-02T12:59:59Z",
    "atende",
  ),
];

// ---------------------------------------------------------------------------
// Copia para o ensaio do banco
// ---------------------------------------------------------------------------

/** As colunas de cada linha de casosDoHorarioEmSql, na ordem. */
export const COLUNAS_DO_HORARIO_EM_SQL =
  "id text, operating_mode text, operating_hours jsonb, fallback_minutes integer, timezone text, agora timestamptz, esperado text";

function literal(texto: string | null): string {
  return texto === null ? "null" : `'${texto.replaceAll("'", "''")}'`;
}

/**
 * A tabela como linhas de VALUES do SQL (uma por caso, na ordem), com as
 * colunas de COLUNAS_DO_HORARIO_EM_SQL. A grade nula vira null (coluna
 * nula); qualquer outro valor vira o jsonb dele. O ensaio cola isto num
 * "with casos (...) as (values ...)" e compara ia_horario_do_assistente com
 * `esperado` caso a caso.
 */
export function casosDoHorarioEmSql(): string {
  return CASOS_DO_HORARIO.map((c) =>
    [
      literal(c.id),
      literal(c.operating_mode),
      c.operating_hours === null
        ? "null::jsonb"
        : `${literal(JSON.stringify(c.operating_hours))}::jsonb`,
      c.fallback_minutes === null
        ? "null::integer"
        : String(c.fallback_minutes),
      literal(c.timezone),
      `${literal(c.agora)}::timestamptz`,
      literal(c.esperado),
    ].join(", "),
  )
    .map((linha) => `(${linha})`)
    .join(",\n");
}
