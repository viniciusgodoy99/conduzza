import { NextResponse, type NextRequest } from "next/server";

import { exportarPainel } from "@/app/(app)/painel-geral/exportar/exportar-painel";
import { TEXTOS_DO_PAINEL } from "@/components/painel-geral/painel-geral";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

// Exportar a lista do Painel geral em CSV (segunda leva, 26/10/2026;
// escolha (7) do dono), so a equipe Conduzza. O trabalho mora em
// exportar-painel.ts (filtros, leitura pela sessao, CSV e trilha); aqui so
// a sessao, a guarda e a traducao do resultado em HTTP. O layout da rota
// nao vale para o Route Handler: a guarda e esta, e a funcao do banco
// recusa (42501) quem nao e da equipe Conduzza do mesmo jeito.
//
// POST com JSON, e nao GET: a trilha e um efeito, e o corpo
// application/json nao sai de formulario de outro site sem a pre-checagem
// do navegador (o cookie de sessao, Lax, tambem nao vai em POST de outro
// site).
//
// Respostas: 200 com o arquivo (text/csv, BOM, nome no
// Content-Disposition); 204 sem clinica com esses filtros (nada na trilha,
// nada sai); JSON { mensagem } em 400, 401, 403, 500 e 503, com o texto que
// a tela mostra. Log so com o usuario, a contagem, o passo que falhou e a
// duracao: nunca o filtro nem a busca.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function erro(status: number, mensagem: string): NextResponse {
  return NextResponse.json(
    { mensagem },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const inicio = Date.now();
  const context = await getSessionContext();
  if (!context) {
    return erro(401, TEXTOS_DO_PAINEL.sessaoExpirada);
  }
  if (!context.isProductAdmin) {
    return erro(403, TEXTOS_DO_PAINEL.soEquipeConduzza);
  }

  // Corpo que nao e JSON (ou sem o Content-Type de JSON) fica indefinido: o
  // Zod recusa como dados invalidos.
  const ehJson = (request.headers.get("content-type") ?? "")
    .toLowerCase()
    .startsWith("application/json");
  const entrada: unknown = ehJson
    ? await request.json().catch(() => undefined)
    : undefined;

  const supabase = await createClient();
  const resultado = await exportarPainel({
    supabase,
    userId: context.userId,
    entrada,
    agora: new Date(),
  });

  switch (resultado.tipo) {
    case "arquivo":
      log.info("painel_geral_exportado", {
        user_id: context.userId,
        count: resultado.quantidade,
        duration_ms: Date.now() - inicio,
      });
      return new Response(resultado.conteudo, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${resultado.nome}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    case "vazio":
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    case "recusada":
      return erro(resultado.status, resultado.mensagem);
    case "falhou":
      log.error("exportacao_do_painel_falhou", {
        user_id: context.userId,
        status: resultado.motivo,
        http_status: resultado.status,
        duration_ms: Date.now() - inicio,
      });
      return erro(resultado.status, resultado.mensagem);
  }
}
