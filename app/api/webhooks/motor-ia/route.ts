import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  bearerDoCabecalho,
  segredosConferem,
} from "@/lib/http/segredo-de-rota";
import { executarPassagemDaIa } from "@/lib/jobs/motor-ia";
import { log } from "@/lib/log";

// Tick do motor da IA (E3), chamado pelo pg_cron (entrada 'motor-ia', via
// disparar_ciclo_da_ia) so quando ha resposta da IA devida de clinica da
// lista fechada. Mora em /api/webhooks pelo mesmo motivo da rota do motor
// principal (o matcher do middleware exclui o prefixo; fora dele cada tick
// viraria redirecionamento para /login com cara de sucesso).
//
// O mesmo segredo do motor principal (MOTOR_TICK_SECRET): ambiente sem ele
// responde 401 sempre. O executor nasce DENTRO do handler, um por
// invocacao, para duas invocacoes sobrepostas nunca dividirem a posse.
//
// REGRA ABSOLUTA: nenhum conteudo de mensagem em log nem na resposta. So
// contadores.

export const runtime = "nodejs";
// Sem force-dynamic, uma resposta poderia vir de cache e nenhum job rodaria.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Folga entre o fim do executor e o maxDuration (fechamento e batida). */
const FOLGA_DA_INVOCACAO_MS = 5_000;

const Corpo = z.object({
  origem: z.string().optional(),
  disparado_em: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const inicio = Date.now();
  const esperado = process.env.MOTOR_TICK_SECRET ?? "";
  const recebido = bearerDoCabecalho(request.headers.get("authorization"));
  if (!segredosConferem(esperado, recebido)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!Corpo.safeParse(corpo).success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const resumo = await executarPassagemDaIa({
      executorId: `motor-ia:${crypto.randomUUID()}`,
      prazoFinalMs: inicio + maxDuration * 1_000 - FOLGA_DA_INVOCACAO_MS,
    });
    return NextResponse.json({ ok: true, motor: "ia", ...resumo });
  } catch (erro) {
    const nome = erro instanceof Error ? erro.name : "desconhecido";
    log.error("motor_ia_tick_falhou", { error_code: nome });
    return NextResponse.json({ error: nome }, { status: 500 });
  }
}
