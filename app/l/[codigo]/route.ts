import { NextResponse, type NextRequest } from "next/server";

import {
  argumentosDoCliqueDoLink,
  CAMINHO_DO_LINK_INDISPONIVEL,
  destinoDoCliqueDoLink,
  ehRoboOuPrevia,
  FORMATO_DO_CODIGO_PUBLICO,
  lerRespostaDoCliqueDoLink,
  type ArgumentosDoCliqueDoLink,
  type RespostaDoCliqueDoLink,
} from "@/lib/domain/link-rastreado";
import { contarSinais, sinaisDaUrl } from "@/lib/domain/rastreio-do-site";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

// Link rastreado da origem (etapa 3a do plano de 16/11/2026, o link da bio
// com endereco proprio): <sistema>/l/<codigo publico>. Grava o clique com os
// sinais da URL (UTMs, clique do Google e da Meta) e redireciona para o
// wa.me com a mensagem pronta e um codigo por clique. Regras em
// lib/domain/link-rastreado.ts; o banco e registrar_clique_do_link
// (migration 20261116120000), chamada so com a service role.
//
// ROTA PUBLICA, SEM LOGIN. Por isso:
// - o destino e SEMPRE o wa.me com o numero que o banco devolve: nada do
//   pedido entra no endereco de destino (nao e redirecionador aberto);
// - a clinica e identificada pelo codigo publico da origem, que nao e
//   segredo e fica na bio;
// - sem IP, sem user agent e sem pagina: o user agent so decide, aqui, se e
//   robo ou previa de link (que nao conta clique), e nao e gravado;
// - log so com o resultado e quantos sinais vieram. Nunca o codigo, o
//   numero ou um identificador de clique.
//
// O RASTREIO E MELHOR ESFORCO: se gravar o clique falha, o pedido e refeito
// sem gravar e a pessoa segue para o WhatsApp com o codigo fixo da origem,
// que a ingestao reconhece. So sem resposta do banco (nao da para saber o
// numero), ou com o link desativado, aparece a pagina de indisponivel.
//
// O matcher de middleware.ts exclui l/: sem isso, o visitante sem sessao
// seria redirecionado para /login.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** Teto de cada chamada ao banco (sao no maximo duas). */
const TEMPO_DO_BANCO_MS = 3_000;

const CABECALHOS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

function redirecionar(destino: string): NextResponse {
  return new NextResponse(null, {
    status: 302,
    headers: { ...CABECALHOS, Location: destino },
  });
}

async function perguntarAoBanco(
  argumentos: ArgumentosDoCliqueDoLink,
): Promise<RespostaDoCliqueDoLink | null> {
  try {
    const { data, error } = await createAdminClient()
      .rpc("registrar_clique_do_link", argumentos)
      .abortSignal(AbortSignal.timeout(TEMPO_DO_BANCO_MS));
    if (error) {
      log.error("clique_do_link_falhou", {
        error_code: error.code || "desconhecido",
      });
      return null;
    }
    return lerRespostaDoCliqueDoLink(data);
  } catch (erro) {
    log.error("clique_do_link_falhou", {
      error_code: erro instanceof Error ? erro.name : "desconhecido",
    });
    return null;
  }
}

async function responder(
  request: NextRequest,
  codigo: string,
  contaClique: boolean,
): Promise<NextResponse> {
  const indisponivel = redirecionar(
    new URL(CAMINHO_DO_LINK_INDISPONIVEL, request.url).href,
  );
  if (!FORMATO_DO_CODIGO_PUBLICO.test(codigo)) {
    return indisponivel;
  }
  const gravar =
    contaClique && !ehRoboOuPrevia(request.headers.get("user-agent"));
  const sinais = gravar ? sinaisDaUrl(request.nextUrl.search) : null;

  let resposta = await perguntarAoBanco(
    argumentosDoCliqueDoLink(codigo, gravar, sinais),
  );
  if (resposta === null && gravar) {
    resposta = await perguntarAoBanco(
      argumentosDoCliqueDoLink(codigo, false, null),
    );
  }
  const destino = resposta ? destinoDoCliqueDoLink(resposta) : null;
  if (!resposta || !destino) {
    log.info("clique_do_link", {
      status: resposta?.resultado ?? "sem_resposta",
    });
    return indisponivel;
  }
  log.info("clique_do_link", {
    status: resposta.resultado,
    count: sinais ? contarSinais(sinais) : 0,
  });
  return redirecionar(destino);
}

type Contexto = { params: Promise<{ codigo: string }> };

export async function GET(
  request: NextRequest,
  { params }: Contexto,
): Promise<NextResponse> {
  return responder(request, (await params).codigo, true);
}

/** Conferidor de link e previa pedem so o cabecalho: nunca conta clique. */
export async function HEAD(
  request: NextRequest,
  { params }: Contexto,
): Promise<NextResponse> {
  return responder(request, (await params).codigo, false);
}
