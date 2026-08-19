import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Credenciais do Supabase para os testes de RLS, em ordem de prioridade:
// 1. Variaveis de ambiente ja carregadas
// 2. Arquivo .env.local na raiz do projeto (desenvolvimento remoto)
// 3. `supabase status -o env` (stack local via CLI, se existir)
// Os testes rodam contra GoTrue, PostgREST e Postgres reais, sem mock.

type StackCredentials = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

let cached: StackCredentials | null = null;

function fromEnvLocal(): Map<string, string> {
  const values = new Map<string, string>();
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    return values;
  }
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
    if (match?.[1] && match[2]) {
      values.set(match[1], match[2].trim());
    }
  }
  return values;
}

function fromLocalCli(): Map<string, string> {
  const values = new Map<string, string>();
  try {
    const output = execSync("supabase status -o env", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const line of output.split("\n")) {
      const match = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
      if (match?.[1] && match[2]) {
        values.set(match[1], match[2]);
      }
    }
  } catch {
    // Stack local ausente: sem problema, o remoto e o caminho padrao.
  }
  return values;
}

export function stackCredentials(): StackCredentials {
  if (cached) {
    return cached;
  }
  const envLocal = fromEnvLocal();
  const pick = (...names: string[]) => {
    for (const name of names) {
      const value = process.env[name] ?? envLocal.get(name);
      if (value) {
        return value;
      }
    }
    return undefined;
  };

  let url = pick("NEXT_PUBLIC_SUPABASE_URL");
  let anonKey = pick("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  let serviceRoleKey = pick("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !anonKey || !serviceRoleKey) {
    const local = fromLocalCli();
    url = url ?? local.get("API_URL");
    anonKey = anonKey ?? local.get("ANON_KEY");
    serviceRoleKey = serviceRoleKey ?? local.get("SERVICE_ROLE_KEY");
  }

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "Credenciais do Supabase não encontradas. Preencha NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY em .env.local.",
    );
  }

  cached = { url, anonKey, serviceRoleKey };
  return cached;
}

// Cliente com service role: ignora RLS. Uso restrito a setup, verificacao
// anti falso-positivo e teardown dos testes.
export function adminClient() {
  const { url, serviceRoleKey } = stackCredentials();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Cliente anonimo: autentica com signInWithPassword para obter um JWT real.
export function anonClient() {
  const { url, anonKey } = stackCredentials();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
