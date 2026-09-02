import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  bearerDoCabecalho,
  segredosConferem,
} from "@/lib/http/segredo-de-rota";
import { executarPassagemDoMotor } from "@/lib/jobs/motor";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

// Tick do motor de automacao, chamado pelo pg_cron (via pg_net) a cada 20
// segundos. Esta rota e a UNICA parte do motor que precisa de Node: a
// manutencao periodica (limpar holds, fechar runs orfas, planejar reguas) roda
// em SQL dentro do banco, em motor_manutencao().
//
// POR QUE ELA MORA EM /api/webhooks/motor. O matcher de middleware.ts exclui
// literalmente "api/webhooks". Uma rota em /api/motor exigiria editar a regex
// que protege o app inteiro, e errar essa regex transformaria cada tick num
// redirecionamento para /login: o pg_net registraria "resposta recebida", o
// historico do cron mostraria sucesso, e o sistema ficaria identico a um
// sistema saudavel enquanto nenhuma mensagem sai. O nome ficou torto de
// proposito; o custo do erro alternativo e alto demais.
//
// REGRA ABSOLUTA: nenhum conteudo de mensagem de paciente em log. So
// contadores.

export const runtime = "nodejs";
// Sem force-dynamic, uma resposta poderia ser servida de cache: o pg_net
// receberia 200, o diagnostico mostraria saude perfeita e nenhum job rodaria.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Corpo = z.object({
  origem: z.string().min(1),
  disparado_em: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const esperado = process.env.MOTOR_TICK_SECRET ?? "";
  const recebido = bearerDoCabecalho(request.headers.get("authorization"));
  // Ambiente sem o segredo responde 401 sempre: um deploy que esqueceu a
  // variavel nao pode virar uma rota aberta que dispara mensagem a paciente.
  if (!segredosConferem(esperado, recebido)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Corpo.safeParse(corpo);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const resultado = await executarPassagemDoMotor(admin, {
      executorId: "motor-fila",
    });
    return NextResponse.json({ ok: true, ...resultado });
  } catch (erro) {
    // Nunca lanca: um 500 faria o pg_net registrar falha e nao ha reenvio
    // automatico, entao o proximo tick e a recuperacao. O log e o que permite
    // descobrir o motivo sem dado de paciente junto.
    log.error("motor_tick_falhou", {
      error_code: erro instanceof Error ? erro.name : "desconhecido",
    });
    return NextResponse.json({ error: "tick_failed" }, { status: 500 });
  }
}
