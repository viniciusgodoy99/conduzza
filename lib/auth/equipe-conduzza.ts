import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * A equipe Conduzza: o super admin ou a conta normal marcada em
 * equipe_conduzza (10/11/2026: o dono e o Victor trabalham na clinica pela
 * conta normal, e o super admin nao entra em clinica). So para o que a
 * equipe LE (o motivo do convite recusado, o texto barrado no simulador),
 * nunca para dar poder de super admin. A sessao nao le essa tabela: quem
 * chama passa o service role. Na duvida (leitura que falhou), nao e.
 */
export async function ehDaEquipeConduzza(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  superAdmin: boolean,
): Promise<boolean> {
  if (superAdmin) {
    return true;
  }
  const { data } = await admin
    .from("equipe_conduzza")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return data !== null;
}
