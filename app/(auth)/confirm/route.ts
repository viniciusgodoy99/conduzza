import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { destinoSeguro } from "@/lib/auth/destino-seguro";
import { createClient } from "@/lib/supabase/server";

// Destino dos links de e-mail (convite, recuperacao, confirmacao).
// Aceita os dois formatos do Supabase: token_hash + type (verifyOtp) e
// code (PKCE, exchangeCodeForSession). Depois redireciona para `next`.
//
// Os modelos de e-mail de supabase/templates mandam token_hash (achado 117):
// o verifyOtp nao depende do cookie do navegador que pediu o link, entao a
// recuperacao pedida no computador abre no celular, e o convite (que o
// GoTrue nao emite em PKCE) nao devolve mais a sessao no fragmento da URL,
// que esta rota nunca le. O `code` fica para o modelo padrao do Supabase.

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = destinoSeguro(searchParams.get("next"), origin);

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Link vencido ou ja usado: explica na tela de login em vez de devolver a
  // pessoa sem dizer nada.
  return NextResponse.redirect(new URL("/login?erro=link_expirado", origin));
}
