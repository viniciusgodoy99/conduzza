import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Tudo, exceto estaticos e imagens. Rotas de API de webhook tambem ficam
    // fora: a Meta nao carrega sessao.
    //
    // api/atendimento/midia tambem fica fora, e a razao e diferente: ela E
    // autenticada, mas por conta propria, respondendo 401 em JSON. Deixada no
    // matcher, o middleware devolveria um redirecionamento para /login, e uma
    // tag <img> ou <audio> recebendo HTML de login simplesmente quebra, sem
    // nenhum erro que alguem consiga diagnosticar olhando a tela.
    //
    // api/publico/ e rastreio/ (F1 do Google) ficam fora porque quem chama e
    // o VISITANTE do site da clinica, sem sessao nenhuma: o script
    // rastreio/v1.js e o aviso do clique em api/publico/clique. Dentro do
    // matcher, os dois virariam um redirecionamento para /login e o rastreio
    // pararia calado.
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/atendimento/midia|api/publico/|rastreio/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
