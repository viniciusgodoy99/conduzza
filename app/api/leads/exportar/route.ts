import { NextResponse, type NextRequest } from "next/server";

import { getSessionContext } from "@/lib/auth/active-clinic";
import {
  CABECALHO_DA_CLINICA_DA_TELA,
  MENSAGEM_EXPORTACAO_ACESSO_INDISPONIVEL,
  MENSAGEM_EXPORTACAO_SEM_CLINICA,
  MENSAGEM_EXPORTACAO_SESSAO_EXPIRADA,
} from "@/lib/domain/exportacao-de-leads";
import { log } from "@/lib/log";
import { exportarLeads } from "@/lib/queries/exportacao-de-leads";
import { createClient } from "@/lib/supabase/server";

// Exportar os leads da Tela 4 em CSV (pedido do dono em 20/10/2026). O
// trabalho mora em lib/queries/exportacao-de-leads.ts (papel, filtros,
// leitura paginada pela sessao, teto, CSV e trilha); aqui so a sessao, a
// clinica ativa e a traducao do resultado em HTTP.
//
// POST com JSON, e nao GET: a gravacao da trilha e um efeito, e o corpo
// application/json nao sai de formulario de outro site sem a pre-checagem
// do navegador (o cookie de sessao, Lax, tambem nao vai em POST de outro
// site).
//
// Respostas: 200 com o arquivo (text/csv, BOM, nome no
// Content-Disposition); 204 sem lead com esses filtros (nada gravado na
// trilha, nada sai); JSON { mensagem } em 400, 401, 403, 409, 422, 500 e
// 503, com o texto que a tela mostra. 409 tambem quando a clinica que a
// tela mostra (cabecalho x-clinica-da-tela) nao e a ativa: troca em outra
// aba. Log so com ids, contagem, o passo que falhou e o codigo do
// PostgREST: nunca filtro, nome ou telefone.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pedaco do corpo da resposta: o arquivo sai aos poucos, sem um bloco so. */
const PEDACO_DO_ARQUIVO = 64 * 1024;

function erro(status: number, mensagem: string): NextResponse {
  return NextResponse.json(
    { mensagem },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** O CSV em UTF-8, entregue em pedacos de 64 KiB. */
function corpoEmPedacos(conteudo: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(conteudo);
  let posicao = 0;
  return new ReadableStream<Uint8Array>({
    pull(controle) {
      if (posicao >= bytes.length) {
        controle.close();
        return;
      }
      controle.enqueue(bytes.subarray(posicao, posicao + PEDACO_DO_ARQUIVO));
      posicao += PEDACO_DO_ARQUIVO;
    },
  });
}

export async function POST(request: NextRequest) {
  const inicio = Date.now();
  const context = await getSessionContext();
  if (!context) {
    return erro(401, MENSAGEM_EXPORTACAO_SESSAO_EXPIRADA);
  }
  // Os vinculos nao carregaram: sem eles nao ha clinica ativa, mas a clinica
  // da pessoa existe. 503 (o navegador oferece tentar de novo), nunca o
  // "Escolha a clinica" numa tela que ja tem clinica.
  if (context.vinculoIndisponivel) {
    return erro(503, MENSAGEM_EXPORTACAO_ACESSO_INDISPONIVEL);
  }
  const ativa = context.active;
  if (!ativa) {
    return erro(409, MENSAGEM_EXPORTACAO_SEM_CLINICA);
  }

  // Corpo que nao e JSON (ou sem o Content-Type de JSON) fica indefinido: o
  // Zod recusa como filtros invalidos, mas so depois da guarda de papel, que
  // vem primeiro para todo mundo.
  const ehJson = (request.headers.get("content-type") ?? "")
    .toLowerCase()
    .startsWith("application/json");
  const entrada: unknown = ehJson
    ? await request.json().catch(() => undefined)
    : undefined;

  const supabase = await createClient();
  const resultado = await exportarLeads({
    supabase,
    sessao: {
      userId: context.userId,
      clinicId: ativa.clinicId,
      role: ativa.role,
      timezone: ativa.timezone,
    },
    clinicaDaTela: request.headers.get(CABECALHO_DA_CLINICA_DA_TELA),
    entrada,
    agora: new Date(),
  });

  const campos = { clinic_id: ativa.clinicId, user_id: context.userId };
  switch (resultado.tipo) {
    case "arquivo":
      if (resultado.trilhaSemDetalhes) {
        // A migration 20261020120000 ainda nao foi aplicada.
        log.warn("exportacao_de_leads_trilha_sem_detalhes", {
          ...campos,
          error_code: "PGRST204",
        });
      }
      log.info("leads_exportados", {
        ...campos,
        count: resultado.quantidade,
        duration_ms: Date.now() - inicio,
      });
      return new Response(corpoEmPedacos(resultado.conteudo), {
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
      log.error("exportacao_de_leads_falhou", {
        ...campos,
        status: resultado.motivo,
        http_status: resultado.status,
        error_code: resultado.codigo ?? undefined,
        duration_ms: Date.now() - inicio,
      });
      return erro(resultado.status, resultado.mensagem);
  }
}
