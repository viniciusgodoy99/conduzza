import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Utilitarios do seed: credenciais e guarda anti-producao.
// O seed usa a service role (ignora RLS) e por isso NUNCA pode rodar contra
// um banco que nao seja de desenvolvimento. Regra: localhost roda direto;
// URL remota exige SEED_ALLOW_REMOTE=1 no ambiente (hoje o projeto remoto E o
// ambiente de dev, autorizado no .env.local; remover quando houver producao).

function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    return;
  }
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
    if (match?.[1] && match[2] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

export function seedClient(): SupabaseClient {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Preencha NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local antes de rodar o seed.",
    );
  }
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const remoteAllowed =
    process.env.SEED_ALLOW_REMOTE === "1" ||
    process.argv.includes("--allow-remote");
  if (!isLocal && !remoteAllowed) {
    throw new Error(
      `Guarda anti-produção: ${url} não é local. Se este banco É o ambiente de desenvolvimento, defina SEED_ALLOW_REMOTE=1 no .env.local ou rode com --allow-remote.`,
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Cria o usuario se nao existir e devolve o id. Idempotente por e-mail.
// O nome vai em user_metadata.name e e atualizado tambem para quem ja existe.
export async function ensureUser(
  admin: SupabaseClient,
  email: string,
  password: string,
  name: string,
): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (created.data.user) {
    return created.data.user.id;
  }
  // Ja existe: localizar pelo e-mail na listagem (base de dev e pequena).
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) {
      throw new Error(`Falha ao listar usuários: ${error.message}`);
    }
    const found = data.users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase(),
    );
    if (found) {
      await admin.auth.admin.updateUserById(found.id, {
        user_metadata: { name },
      });
      return found.id;
    }
    if (data.users.length < 100) {
      break;
    }
  }
  throw new Error(
    `Não foi possível criar nem localizar o usuário ${email}: ${created.error?.message}`,
  );
}
