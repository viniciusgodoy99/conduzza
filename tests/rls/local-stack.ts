import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

// Credenciais do stack local do Supabase, lidas de `supabase status -o env`.
// Os testes de RLS rodam contra GoTrue, PostgREST e Postgres reais, sem mock.

type LocalStack = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

let cached: LocalStack | null = null;

export function localStack(): LocalStack {
  if (cached) {
    return cached;
  }
  let output: string;
  try {
    output = execSync("supabase status -o env", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "Supabase local não está rodando. Rode: supabase start (exige Docker).",
    );
  }
  const values = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
    if (match?.[1] && match[2]) {
      values.set(match[1], match[2]);
    }
  }
  const url = values.get("API_URL");
  const anonKey = values.get("ANON_KEY");
  const serviceRoleKey = values.get("SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "Não foi possível ler API_URL, ANON_KEY e SERVICE_ROLE_KEY de `supabase status -o env`.",
    );
  }
  cached = { url, anonKey, serviceRoleKey };
  return cached;
}

// Cliente com service role: ignora RLS. Uso restrito a setup, verificacao
// anti falso-positivo e teardown dos testes.
export function adminClient() {
  const { url, serviceRoleKey } = localStack();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Cliente anonimo: autentica com signInWithPassword para obter um JWT real.
export function anonClient() {
  const { url, anonKey } = localStack();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
