import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Renova o token de sessao a cada request e propaga os cookies.
// A protecao de rota da area logada entra na tarefa 0.5.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Ambiente ainda sem Supabase configurado (antes da 0.2 completa): nao ha
  // sessao para renovar. A protecao de rota da 0.5 continua valendo.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return response;
  }

  // Protecao de rota (tarefa 0.5): area logada exige sessao. A checagem de
  // papel NAO vive aqui: fica nos layouts e nas Server Actions, e o isolamento
  // de dados e da RLS.
  const { pathname } = request.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/cadastro") ||
    pathname.startsWith("/recuperar-senha") ||
    pathname.startsWith("/confirm") ||
    pathname.startsWith("/dev") ||
    pathname.startsWith("/brand");

  // Sem cookie de sessao nao ha token para validar nem renovar: decide o
  // redirect sem tocar na rede. Anonimo em /login parava de carregar por
  // causa de uma ida ao Auth remoto que sempre voltava vazia.
  const temCookieDeSessao = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-"));
  if (!temCookieDeSessao) {
    if (isPublic) {
      return response;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // getClaims valida a assinatura do JWT localmente (o projeto usa chave
  // ES256, conferida no JWKS publico), em vez do round-trip de rede que o
  // getUser fazia em TODO request. Token expirado ainda renova aqui (o
  // getClaims carrega a sessao e dispara o refresh), entao a navegacao longa
  // continua sem deslogar. Se um dia a chave voltar a HS256, o getClaims
  // degrada sozinho para a validacao remota, sem mudanca de codigo.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
