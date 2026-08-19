import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Cliente de servidor por request. No Next 15, cookies() e assincrono.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Chamado a partir de um Server Component, onde nao se pode
            // escrever cookie. O middleware renova a sessao nesse caso.
          }
        },
      },
    },
  );
}
