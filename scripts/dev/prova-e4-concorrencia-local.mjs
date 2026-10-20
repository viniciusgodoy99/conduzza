/**
 * PROVA DETERMINISTICA DAS TRAVAS DA E4 (a IA marca consulta), no Postgres
 * LOCAL descartavel. NUNCA na producao: o host e fixo em 127.0.0.1.
 *
 * Por que existe (revisao da E4, 20/10/2026): o teste de integracao
 * (tests/integration/ia-agenda-concorrencia.test.ts) dispara as RPCs por
 * HTTP e nao forca a sobreposicao dentro do Postgres; se o PostgREST as
 * executar em sequencia, ele passa sem trava nenhuma. Aqui uma conexao SEGURA
 * a transacao aberta de proposito e a outra TEM de esperar a trava; depois do
 * commit, o resultado e o certo. Pega a falta da trava do profissional, da
 * conversa e do recurso (as sabotagens s01, s39, s43 e s44 do ensaio).
 *
 * Como rodar (o pacote pg NAO e dependencia do projeto):
 *   1. um banco local com as migrations do repositorio aplicadas, a
 *      20261020130000_ia_agenda inclusive (o harness da E4 usa o Postgres 18
 *      em 127.0.0.1:55449);
 *   2. psql ... -f scripts/dev/prova-e4-concorrencia-dados.sql nesse banco;
 *   3. PG_MODULE=<pasta com o pg>/node_modules/pg/lib/index.js \
 *      PROVA_PG_PORTA=55449 PROVA_PG_BANCO=e4conc \
 *      node scripts/dev/prova-e4-concorrencia-local.mjs
 * Rodar uma vez por banco recem criado (os dados ficam gravados).
 *
 * Cenarios: A, a segunda conversa espera a trava do profissional e perde;
 * B, cinco ao mesmo tempo, uma reserva; C e D, o mesmo job no reservar e no
 * agendar espera e reutiliza; E, o 23P01 de verdade vira conflito sem gravar;
 * F, a IA primeiro, a recepcao recebe 23P01; G e H, dois turnos da mesma
 * conversa (mesmo profissional e dois profissionais) deixam uma reserva; I,
 * duas conversas em dois profissionais que usam a mesma sala: a segunda
 * espera a trava do recurso e perde; J, o agendar tambem toma a trava do
 * recurso.
 */

const HOST = "127.0.0.1";
const PORTA = Number(process.env.PROVA_PG_PORTA ?? "55449");
const BANCO = process.env.PROVA_PG_BANCO ?? "e4conc";

const A = "00000000-0000-4000-8000-00000000000a";
const P1 = "00000000-0000-4000-8000-0000000000c1";
const L1 = "00000000-0000-4000-8000-0000000000e1";
const L2 = "00000000-0000-4000-8000-0000000000e2";
const SALA_P1 = "00000000-0000-4000-8000-0000000000e3";
const SALA_P2 = "00000000-0000-4000-8000-0000000000e4";
const K0 = "00000000-0000-4000-8000-0000000000f0";
const conv = (i) =>
  `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;
const uuid = () => globalThis.crypto.randomUUID();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let falhas = 0;
function confere(cond, msg) {
  if (cond) {
    console.log("ok   ", msg);
  } else {
    falhas += 1;
    console.log("FALHA", msg);
  }
}

async function main() {
  const { default: pg } = await import(process.env.PG_MODULE ?? "pg");

  async function conectar() {
    const c = new pg.Client({
      host: HOST,
      port: PORTA,
      user: "postgres",
      database: BANCO,
    });
    await c.connect();
    await c.query(`set request.jwt.claims = '{"role":"service_role"}'`);
    await c.query("set role service_role");
    return c;
  }

  async function horario(c, hora) {
    const r = await c.query(
      "select ((((now() at time zone 'America/Fortaleza')::date + 3) + $1::time) at time zone 'America/Fortaleza') as t",
      [hora],
    );
    return r.rows[0].t;
  }

  async function reservar(c, conversa, inicio, job = uuid(), vinculo = L1) {
    const r = await c.query(
      "select public.reservar_horario_da_ia($1, $2, $3, $4, $5) as r",
      [A, conversa, vinculo, inicio, job],
    );
    return r.rows[0].r;
  }

  async function agendar(c, conversa, job = uuid()) {
    const r = await c.query("select public.agendar_pela_ia($1, $2, $3) as r", [
      A,
      conversa,
      job,
    ]);
    return r.rows[0].r;
  }

  // A pergunta da IA e, DEPOIS dela, a confirmacao do paciente (o agendar so
  // aceita a mensagem dele posterior a pergunta). Cada insert e uma
  // transacao: os created_at saem em ordem.
  async function mensagem(c, conversa) {
    await c.query(
      "insert into public.message (clinic_id, conversation_id, direction, author, content_type, body) values ($1, $2, 'saida', 'ia', 'texto', 'Confirma?')",
      [A, conversa],
    );
    await dormir(5);
    await c.query(
      "insert into public.message (clinic_id, conversation_id, direction, author, content_type, body) values ($1, $2, 'entrada', 'paciente', 'texto', 'sim')",
      [A, conversa],
    );
  }

  async function recepcao(c, inicio) {
    await c.query(
      "insert into public.appointment (clinic_id, contact_id, professional_id, service_link_id, starts_at, ends_at, created_by) values ($1, $2, $3, $4, $5, $5::timestamptz + interval '30 minutes', 'usuario')",
      [A, K0, P1, L1, inicio],
    );
  }

  /** Dispara a promessa e diz se ela ainda esta pendente depois de ms. */
  async function aindaEspera(promessa, ms = 400) {
    let terminou = false;
    promessa.then(
      () => {
        terminou = true;
      },
      () => {
        terminou = true;
      },
    );
    await dormir(ms);
    return !terminou;
  }

  const a = await conectar();
  const b = await conectar();
  const extras = await Promise.all([1, 2, 3, 4, 5].map(() => conectar()));

  // A. Duas conversas, o mesmo horario: a segunda espera a trava e perde.
  {
    const s = await horario(a, "09:00");
    await a.query("begin");
    const r1 = await reservar(a, conv(1), s);
    const p2 = reservar(b, conv(2), s);
    confere(
      await aindaEspera(p2),
      "A: a segunda conversa ESPERA a trava do profissional",
    );
    await a.query("commit");
    const r2 = await p2;
    confere(
      r1.ok === true,
      `A: a primeira reservou (${JSON.stringify(r1.ok)})`,
    );
    confere(
      r2.ok === false && r2.motivo === "reservado_por_outra_conversa",
      `A: a segunda perdeu: ${JSON.stringify(r2)}`,
    );
  }

  // B. Cinco conversas ao mesmo tempo: uma reserva so.
  {
    const s = await horario(a, "10:00");
    const rs = await Promise.all(
      extras.map((c, i) => reservar(c, conv(3 + i), s)),
    );
    const ganhou = rs.filter((r) => r.ok);
    confere(
      ganhou.length === 1,
      `B: cinco ao mesmo tempo, ${ganhou.length} reserva(s)`,
    );
    confere(
      rs
        .filter((r) => !r.ok)
        .every((r) => r.motivo === "reservado_por_outra_conversa"),
      "B: as outras quatro, reservado_por_outra_conversa",
    );
  }

  // C. O mesmo job no reservar, ao mesmo tempo: a segunda espera e reutiliza.
  {
    const s = await horario(a, "11:00");
    const job = uuid();
    await a.query("begin");
    const r1 = await reservar(a, conv(8), s, job);
    const p2 = reservar(b, conv(8), s, job);
    confere(await aindaEspera(p2), "C: o mesmo job ESPERA a trava da conversa");
    await a.query("commit");
    const r2 = await p2;
    confere(
      r1.ok &&
        r2.ok &&
        r1.hold_id === r2.hold_id &&
        r1.reutilizado === false &&
        r2.reutilizado === true,
      `C: a mesma reserva, a segunda reutilizada: ${JSON.stringify([r1.reutilizado, r2.reutilizado])}`,
    );
    const n = await a.query(
      "select count(*)::int as n from public.slot_hold where job_id = $1",
      [job],
    );
    confere(n.rows[0].n === 1, "C: uma linha so com o job");
  }

  // D. O mesmo job no agendar, ao mesmo tempo: a mesma consulta.
  {
    await dormir(20);
    await mensagem(a, conv(8));
    const job = uuid();
    await a.query("begin");
    const r1 = await agendar(a, conv(8), job);
    const p2 = agendar(b, conv(8), job);
    confere(await aindaEspera(p2), "D: o mesmo job do agendar ESPERA");
    await a.query("commit");
    const r2 = await p2;
    confere(
      r1.ok &&
        r2.ok &&
        r1.appointment_id === r2.appointment_id &&
        r2.reutilizado === true,
      `D: a mesma consulta, a segunda reutilizada: ${JSON.stringify([r1, r2].map((r) => r.reutilizado))}`,
    );
    const n = await a.query(
      "select count(*)::int as n from public.appointment where created_by = 'ia'",
    );
    confere(n.rows[0].n === 1, "D: uma consulta da IA so");
  }

  // E. 23P01 de verdade: a recepcao grava (sem commit) entre a conferencia e
  // o insert da IA; o agendar espera, e com o commit da recepcao da conflito
  // sem gravar nada.
  {
    const s = await horario(a, "13:00");
    const r = await reservar(a, conv(9), s);
    confere(r.ok, "E: reservou");
    await dormir(20);
    await mensagem(a, conv(9));
    await b.query("begin");
    await recepcao(b, s);
    const p = agendar(a, conv(9));
    confere(
      await aindaEspera(p),
      "E: o agendar ESPERA a consulta da recepcao (exclusion constraint)",
    );
    await b.query("commit");
    const m = await p;
    confere(
      m.ok === false && m.motivo === "conflito",
      `E: 23P01 virou conflito: ${JSON.stringify(m)}`,
    );
    const q = await a.query(
      "select (select count(*)::int from public.appointment where starts_at = $1 and status = 'agendado') as consultas, (select consumido_em from public.slot_hold where id = $2) as consumido, (select count(*)::int from public.message where conversation_id = $3 and content_type = 'evento') as eventos",
      [s, r.hold_id, conv(9)],
    );
    confere(
      q.rows[0].consultas === 1 &&
        q.rows[0].consumido === null &&
        q.rows[0].eventos === 0,
      `E: nada gravado pela IA: ${JSON.stringify(q.rows[0])}`,
    );
  }

  // F. A IA primeiro: a recepcao espera e recebe 23P01.
  {
    const s = await horario(a, "14:00");
    const r = await reservar(a, conv(10), s);
    confere(r.ok, "F: reservou");
    await dormir(20);
    await mensagem(a, conv(10));
    await a.query("begin");
    const m = await agendar(a, conv(10));
    confere(m.ok === true, "F: a IA marcou (transacao aberta)");
    const p = recepcao(b, s);
    confere(await aindaEspera(p), "F: a recepcao ESPERA a consulta da IA");
    await a.query("commit");
    let codigo = null;
    try {
      await p;
    } catch (e) {
      codigo = e.code;
    }
    confere(codigo === "23P01", `F: a recepcao recebeu 23P01 (${codigo})`);
  }

  // G. Dois turnos da mesma conversa, horarios diferentes: fica uma reserva.
  {
    const s1 = await horario(a, "15:00");
    const s2 = await horario(a, "15:30");
    await a.query("begin");
    const r1 = await reservar(a, conv(11), s1);
    const p2 = reservar(b, conv(11), s2);
    confere(
      await aindaEspera(p2),
      "G: o segundo turno ESPERA a trava da conversa",
    );
    await a.query("commit");
    const r2 = await p2;
    const n = await a.query(
      "select array_agg(id) as ids from public.slot_hold where conversation_id = $1 and consumido_em is null",
      [conv(11)],
    );
    confere(
      r1.ok &&
        r2.ok &&
        n.rows[0].ids.length === 1 &&
        n.rows[0].ids[0] === r2.hold_id,
      `G: uma reserva viva, a do segundo turno: ${JSON.stringify(n.rows[0].ids)}`,
    );
  }

  // H. A mesma conversa em DOIS profissionais ao mesmo tempo: a trava da
  // conversa (e nao a do profissional) e que deixa uma reserva so.
  {
    const s1 = await horario(a, "16:00");
    await a.query("begin");
    const r1 = await reservar(a, conv(12), s1, uuid(), L1);
    const p2 = reservar(b, conv(12), s1, uuid(), L2);
    confere(
      await aindaEspera(p2),
      "H: o turno no outro profissional ESPERA a trava da conversa",
    );
    await a.query("commit");
    const r2 = await p2;
    const n = await a.query(
      "select array_agg(id) as ids from public.slot_hold where conversation_id = $1 and consumido_em is null",
      [conv(12)],
    );
    confere(
      r1.ok &&
        r2.ok &&
        n.rows[0].ids.length === 1 &&
        n.rows[0].ids[0] === r2.hold_id,
      `H: uma reserva viva na conversa: ${JSON.stringify(n.rows[0].ids)}`,
    );
  }

  // I. (revisao da E4) Duas conversas em DOIS profissionais que usam a mesma
  // sala, o mesmo horario: a segunda espera a trava do RECURSO e perde.
  {
    const s = await horario(a, "17:00");
    await a.query("begin");
    const r1 = await reservar(a, conv(13), s, uuid(), SALA_P1);
    const p2 = reservar(b, conv(14), s, uuid(), SALA_P2);
    confere(
      await aindaEspera(p2),
      "I: a conversa no outro profissional ESPERA a trava do recurso",
    );
    await a.query("commit");
    const r2 = await p2;
    confere(
      r1.ok === true,
      `I: a primeira reservou a sala (${JSON.stringify(r1.ok)})`,
    );
    confere(
      r2.ok === false && r2.motivo === "reservado_por_outra_conversa",
      `I: a segunda perdeu a sala: ${JSON.stringify(r2)}`,
    );
  }

  // J. (revisao da E4) O agendar tambem toma a trava do recurso: com outra
  // conversa segurando a sala (reserva em outro horario, transacao aberta),
  // o agendar espera; depois do commit, marca.
  {
    const s = await horario(a, "18:00");
    const r = await reservar(a, conv(15), s, uuid(), SALA_P2);
    confere(r.ok, "J: reservou a sala com o P2");
    await dormir(20);
    await mensagem(a, conv(15));
    await a.query("begin");
    const outra = await reservar(
      a,
      conv(16),
      await horario(a, "19:00"),
      uuid(),
      SALA_P1,
    );
    confere(
      outra.ok,
      "J: a outra conversa reservou a sala as 19:00 (transacao aberta)",
    );
    const p = agendar(b, conv(15));
    confere(await aindaEspera(p), "J: o agendar ESPERA a trava do recurso");
    await a.query("commit");
    const m = await p;
    confere(m.ok === true, `J: depois do commit, marcou: ${JSON.stringify(m)}`);
  }

  for (const c of [a, b, ...extras]) {
    await c.end();
  }
  console.log(
    falhas === 0 ? "\nCONCORRENCIA LOCAL OK" : `\n${falhas} FALHA(S)`,
  );
  process.exitCode = falhas === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("ERRO:", e.message, e.code || "");
  process.exit(1);
});
