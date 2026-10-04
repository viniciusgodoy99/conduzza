import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  FORMATO_DA_CHAVE,
  frasesNoFormato,
} from "@/lib/domain/rastreio-do-site";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

// Frases do rastreio do site pela chave (ajuste de 04/10/2026 na F1 do
// Google). O script public/rastreio/v1.js, so em visita com sinal do Google,
// busca aqui as frases que a clinica cadastrou para o botao do WhatsApp sem
// mensagem pronta, e sorteia uma por clique. Regras em
// lib/domain/rastreio-do-site.ts; contrato do banco na migration
// 20261005110000_frases_do_rastreio.sql.
//
// ROTA PUBLICA, SEM LOGIN. Por isso:
// - a chave passa por Zod estrito (20 hexadecimais minusculos) antes de
//   qualquer coisa; fora do formato nem chega ao banco;
// - a clinica e identificada pela chave do rastreio (publica, fica no HTML
//   do site, rotacionavel), e frases_do_rastreio so roda com a service role;
// - responde SO as frases ({"frases": [...]}), nada da clinica. A saida da
//   funcao e conferida de novo com as regras dos checks do banco: qualquer
//   item fora da regra e tratado como sem frases;
// - rastreio desligado, chave inexistente (ou a velha, depois da troca),
//   chave fora do formato, erro ou demora do banco: 404 SEM CORPO, e o script
//   fica com a frase de fabrica. Desligado e inexistente respondem igual;
// - log so com o resultado (status), o codigo do erro e quantas frases
//   (count). Nunca a chave nem o texto das frases (lib/log.ts descarta
//   qualquer outra chave).
//
// Cache: 200 com public, max-age=300 (o navegador do visitante reaproveita
// as frases por 5 minutos entre paginas do site; trocar as frases vale no
// maximo 5 minutos depois). 404 com no-store: ligar o rastreio vale na hora.
//
// CORS aberto (*): o fetch do script e um GET simples, sem credencial e sem
// cabecalho proprio, entao nem pergunta (OPTIONS); o OPTIONS responde do
// mesmo jeito para qualquer navegador que pergunte. Nenhuma credencial e
// lida aqui.
//
// O matcher de middleware.ts exclui api/publico/: sem isso, o visitante sem
// sessao seria redirecionado para /login.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 5;

/** Teto da chamada ao banco, abaixo do maxDuration e da espera do script. */
const TEMPO_DO_BANCO_MS = 3_000;

const parametrosSchema = z.strictObject({
  chave: z.string().regex(FORMATO_DA_CHAVE),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
} as const;

function semFrases(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { ...CORS, "Cache-Control": "no-store" },
  });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS, "Cache-Control": "no-store" },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ chave: string }> },
): Promise<NextResponse> {
  try {
    const entrada = parametrosSchema.safeParse(await params);
    if (!entrada.success) {
      log.info("frases_do_rastreio", { status: "chave_fora_do_formato" });
      return semFrases();
    }
    const { data, error } = await createAdminClient()
      .rpc("frases_do_rastreio", { p_chave: entrada.data.chave })
      .abortSignal(AbortSignal.timeout(TEMPO_DO_BANCO_MS));
    if (error) {
      log.error("frases_do_rastreio_falhou", {
        error_code: error.code || "desconhecido",
      });
      return semFrases();
    }
    // O tipo gerado diz string[], mas a funcao devolve null para rastreio
    // desligado, chave inexistente ou velha.
    const bruto: unknown = data;
    if (bruto === null || bruto === undefined) {
      log.info("frases_do_rastreio", { status: "sem_frases" });
      return semFrases();
    }
    const frases = frasesNoFormato(bruto);
    if (!frases) {
      log.warn("frases_do_rastreio", { status: "fora_da_regra" });
      return semFrases();
    }
    log.info("frases_do_rastreio", { status: "ok", count: frases.length });
    return NextResponse.json(
      { frases },
      {
        status: 200,
        headers: {
          ...CORS,
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (erro) {
    log.error("frases_do_rastreio_falhou", {
      error_code: erro instanceof Error ? erro.name : "desconhecido",
    });
    return semFrases();
  }
}
