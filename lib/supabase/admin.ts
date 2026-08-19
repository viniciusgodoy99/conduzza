import "server-only";

import { createClient } from "@supabase/supabase-js";

// Cliente com service role: ignora RLS. Decisao registrada no plano da Fase 0:
// uso permitido SOMENTE neste modulo (server-only, nunca chega ao browser) e
// em scripts locais de seed e teste. Hoje o unico uso de aplicacao e o convite
// por e-mail (auth.admin), que nao existe com a anon key.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ausente no ambiente do servidor.",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
