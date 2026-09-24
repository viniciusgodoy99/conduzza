import { NextResponse, type NextRequest } from "next/server";

import { alertasDoMotor, type SaudeDoMotor } from "@/lib/domain/motor";
import {
  bearerDoCabecalho,
  segredosConferem,
} from "@/lib/http/segredo-de-rota";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

// Saude do motor para um monitor EXTERNO (UptimeRobot, Better Stack ou
// similar), que chama esta rota a cada 5 minutos e alerta o dono por e-mail
// quando ela deixa de responder 200. Configuracao no runbook
// supabase/operacao/motor-por-cron.md, secao "Alerta externo".
//
// POR QUE EXTERNO. A faixa "as mensagens automaticas estao paradas" so avisa
// quem estiver com a tela aberta: um motor que para no sabado a noite so seria
// descoberto na segunda, pela falta do paciente. E o alerta nao pode sair de
// dentro do banco (pg_cron + pg_net), porque morreria junto quando o pg_net
// trava, que e justamente um dos modos de falha que ele precisa pegar.
//
// POR QUE EM /api/webhooks. O matcher de middleware.ts exclui esse prefixo.
// Fora dele, o monitor receberia um redirecionamento para /login, que muitos
// monitores seguem ate um 200: o alerta ficaria verde para sempre.
//
// POR QUE UM SEGREDO PROPRIO (MOTOR_SAUDE_SECRET) e nao o do tick. Nem todo
// monitor gratuito manda cabecalho, entao a rota tambem aceita o segredo na
// query, e URL com query acaba em log de requisicao e na tela do monitor. O
// segredo do tick dispara o motor; este so le um diagnostico sem dado de
// paciente. Vazar este custa pouco, vazar aquele nao.
//
// 200 quando saudavel; 503 quando qualquer alerta de alertasDoMotor() vale ou
// quando a propria leitura da saude falha; 401 com o segredo errado ou
// ausente no ambiente (um monitor mal configurado tambem precisa ficar
// vermelho). O corpo carrega so idades, contagem e codigos.

export const runtime = "nodejs";
// Sem isto a resposta poderia vir de cache e o monitor veria saude antiga.
export const dynamic = "force-dynamic";
// O monitor desiste por volta de 30 segundos; esperar mais so gasta funcao.
export const maxDuration = 20;

const SEM_CACHE = { "Cache-Control": "no-store" };

function segundosDesde(
  carimbo: string | null | undefined,
  agora: Date,
): number | null {
  if (!carimbo) {
    return null;
  }
  const instante = new Date(carimbo).getTime();
  if (Number.isNaN(instante)) {
    return null;
  }
  return Math.max(0, Math.round((agora.getTime() - instante) / 1000));
}

export async function GET(request: NextRequest) {
  const esperado = process.env.MOTOR_SAUDE_SECRET ?? "";
  const recebido =
    bearerDoCabecalho(request.headers.get("authorization")) ||
    (request.nextUrl.searchParams.get("token") ?? "");
  if (!segredosConferem(esperado, recebido)) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: SEM_CACHE },
    );
  }

  let saude: SaudeDoMotor | null;
  try {
    const { data, error } = await createAdminClient().rpc("saude_do_motor");
    if (error) {
      log.error("saude_do_motor_ilegivel", { error_code: error.code ?? null });
      return NextResponse.json(
        { ok: false, erro: "saude_ilegivel" },
        { status: 503, headers: SEM_CACHE },
      );
    }
    saude = (data ?? null) as SaudeDoMotor | null;
  } catch (erro) {
    log.error("saude_do_motor_ilegivel", {
      error_code: erro instanceof Error ? erro.name : "desconhecido",
    });
    return NextResponse.json(
      { ok: false, erro: "saude_ilegivel" },
      { status: 503, headers: SEM_CACHE },
    );
  }

  const agora = new Date();
  const alertas = alertasDoMotor(saude, agora);
  const corpo = {
    ok: alertas.length === 0,
    alertas,
    fila_ha_s: segundosDesde(saude?.fila?.batida_em, agora),
    planner_ha_s: segundosDesde(saude?.planner?.batida_em, agora),
    atrasados: saude?.atrasados ?? 0,
    // Codigo curto do tipo "planejar_reguas:42P01" (rotina e SQLSTATE),
    // gravado por motor_manutencao(). Nunca carrega conteudo.
    planner_erro: saude?.planner?.ultimo_erro ?? null,
  };

  if (alertas.length > 0) {
    log.warn("saude_do_motor_alerta", {
      status: alertas.join(","),
      count: corpo.atrasados,
    });
    return NextResponse.json(corpo, { status: 503, headers: SEM_CACHE });
  }
  return NextResponse.json(corpo, { status: 200, headers: SEM_CACHE });
}
