import type { SupabaseClient } from "@supabase/supabase-js";

// Nomes de exibicao por id de usuario, para a clinica. Le a tabela profile
// por join com clinic_member, tudo indexado e sob RLS. Substitui a chamada
// admin.auth.admin.listUsers(page 1), que listava o GoTrue do projeto inteiro
// e perdia quem ficava fora da primeira pagina a partir de ~100 usuarios.

// Nomes por lista de ids (usado onde a lista de membros ja esta em maos).
export async function fetchProfileNames(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Record<string, string>> {
  if (userIds.length === 0) {
    return {};
  }
  const { data, error } = await supabase
    .from("profile")
    .select("user_id, name")
    .in("user_id", userIds);
  if (error) {
    throw new Error(error.message);
  }
  const nomes: Record<string, string> = {};
  for (const perfil of (data ?? []) as { user_id: string; name: string }[]) {
    nomes[perfil.user_id] = perfil.name;
  }
  return nomes;
}

export async function fetchClinicAuthorNames(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<Record<string, string>> {
  // clinic_member e profile apontam ambos para auth.users, sem FK direta
  // entre si, entao o embed do PostgREST nao resolve: duas consultas, as duas
  // indexadas (clinic_member(clinic_id), profile PK por user_id).
  const { data: membros, error: erroMembros } = await supabase
    .from("clinic_member")
    .select("user_id")
    .eq("clinic_id", clinicId);
  if (erroMembros) {
    throw new Error(erroMembros.message);
  }
  const ids = ((membros ?? []) as { user_id: string }[]).map((m) => m.user_id);
  if (ids.length === 0) {
    return {};
  }

  const { data: perfis, error: erroPerfis } = await supabase
    .from("profile")
    .select("user_id, name")
    .in("user_id", ids);
  if (erroPerfis) {
    throw new Error(erroPerfis.message);
  }
  const nomes: Record<string, string> = {};
  for (const perfil of (perfis ?? []) as { user_id: string; name: string }[]) {
    nomes[perfil.user_id] = perfil.name;
  }
  return nomes;
}
