import { NextResponse, type NextRequest } from "next/server";

import {
  argumentosDoRegistro,
  contarSinais,
  LIMITE_DO_CORPO_EM_BYTES,
  lerCorpoDoClique,
  resultadoDoRegistro,
} from "@/lib/domain/rastreio-do-site";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

// Aviso do clique de anuncio do Google no site da clinica (F1 do Google). O
// script public/rastreio/v1.js manda, no clique do link do WhatsApp, um JSON
// em text/plain com a chave do rastreio, o codigo que foi para o texto da
// mensagem e os sinais do Google da URL. Regras em
// lib/domain/rastreio-do-site.ts.
//
// ROTA PUBLICA, SEM LOGIN. Por isso:
// - corpo de ate 2 KB, lido aos pedacos (corta antes de ler tudo) e validado
//   com Zod estrito (campo a mais, formato errado ou nenhum sinal recusam o
//   corpo inteiro, sem tocar no banco);
// - RESPONDE SEMPRE 204, venha o que vier: nao revela se a chave existe, se o
//   rastreio esta ligado, se bateu no limite ou se o banco falhou. O script
//   nem le a resposta;
// - a clinica e identificada pela chave do rastreio (publica, fica no HTML do
//   site, rotacionavel), nunca pelo slug nem pelo codigo de cadastro. O
//   limite (30 por minuto por clinica) e o teto de vivos ficam no banco, em
//   registrar_clique_do_site, chamada so com a service role;
// - sem IP, sem user agent, sem caminho da pagina: do Origin sai so o host;
// - log so com o resultado (status), o codigo do erro e quantos sinais do
//   Google vieram (count). Nunca a chave, o gclid ou o codigo (lib/log.ts
//   descarta qualquer outra chave).
//
// CORS permissivo: o sendBeacon em text/plain nao faz preflight e o fetch de
// reserva vai em no-cors, mas o OPTIONS responde do mesmo jeito para qualquer
// navegador que pergunte. Nenhuma credencial e lida aqui.
//
// O matcher de middleware.ts exclui api/publico/: sem isso, o visitante sem
// sessao seria redirecionado para /login.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// O aviso e fire-and-forget: ninguem espera esta resposta.
export const maxDuration = 5;

/** Teto da chamada ao banco, abaixo do maxDuration. */
const TEMPO_DO_BANCO_MS = 4_000;

const CABECALHOS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
} as const;

function semConteudo(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CABECALHOS });
}

/**
 * O corpo como texto, ou null se passar de `limite` bytes ou nao for UTF-8.
 * O Content-Length declarado corta antes de ler; sem ele (ou mentindo), a
 * leitura para no primeiro pedaco que estoura o teto.
 */
async function lerCorpoLimitado(
  request: NextRequest,
  limite: number,
): Promise<string | null> {
  const declarado = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declarado) && declarado > limite) {
    return null;
  }
  if (!request.body) {
    return "";
  }
  const leitor = request.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    pedacos.push(value);
  }
  const bytes = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) {
    bytes.set(pedaco, posicao);
    posicao += pedaco.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function OPTIONS(): NextResponse {
  return semConteudo();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const texto = await lerCorpoLimitado(request, LIMITE_DO_CORPO_EM_BYTES);
    if (texto === null) {
      log.info("clique_do_site_recusado", { status: "corpo_grande" });
      return semConteudo();
    }
    const leitura = lerCorpoDoClique(texto);
    if (!leitura.ok) {
      log.info("clique_do_site_recusado", { status: leitura.motivo });
      return semConteudo();
    }
    const sinais = contarSinais(leitura.corpo);
    const { data, error } = await createAdminClient()
      .rpc(
        "registrar_clique_do_site",
        argumentosDoRegistro(leitura.corpo, request.headers.get("origin")),
      )
      .abortSignal(AbortSignal.timeout(TEMPO_DO_BANCO_MS));
    if (error) {
      // 22023 (dado fora do formato) nao deveria acontecer: o Zod usa os
      // mesmos formatos da funcao. Se acontecer, o codigo no log mostra.
      log.error("clique_do_site_falhou", {
        error_code: error.code || "desconhecido",
        count: sinais,
      });
      return semConteudo();
    }
    log.info("clique_do_site", {
      status: resultadoDoRegistro(data),
      count: sinais,
    });
  } catch (erro) {
    log.error("clique_do_site_falhou", {
      error_code: erro instanceof Error ? erro.name : "desconhecido",
    });
  }
  return semConteudo();
}
