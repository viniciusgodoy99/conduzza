import { createBrowserClient } from "@supabase/ssr";

// Cliente de browser. Usa somente a anon key: o isolamento entre clinicas e a
// RLS do Postgres, nunca este cliente.
// TODO(0.4): tipar com o Database gerado por `npm run db:types` quando o stack
// local estiver de pe (tipos do banco sao gerados, nunca escritos a mao).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
