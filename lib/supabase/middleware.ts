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

  // Importante: manter a chamada para o token nao expirar em navegacao longa.
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
