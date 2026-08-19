import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { fetchConversations } from "@/lib/queries/conversations";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { InboxClient } from "./inbox-client";

// Tela 1, Atendimento: carga inicial no servidor (sessao do usuario, RLS
// aplica) e interatividade no cliente. O mapa de nomes de autores vem do
// GoTrue via admin (server-only), sem expor nada alem de nome por id.
export default async function AtendimentoPage() {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  const [conversations, accountResult, memberRows] = await Promise.all([
    fetchConversations(supabase, active.clinicId),
    supabase
      .from("whatsapp_account")
      .select("connection_status")
      .eq("clinic_id", active.clinicId)
      .maybeSingle(),
    supabase
      .from("clinic_member")
      .select("user_id")
      .eq("clinic_id", active.clinicId),
  ]);

  const memberIds = new Set(
    ((memberRows.data ?? []) as { user_id: string }[]).map(
      (row) => row.user_id,
    ),
  );
  const authorNames: Record<string, string> = {};
  if (memberIds.size > 0) {
    const admin = createAdminClient();
    const { data: usersPage } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 100,
    });
    for (const user of usersPage?.users ?? []) {
      if (memberIds.has(user.id)) {
        authorNames[user.id] =
          typeof user.user_metadata?.name === "string"
            ? (user.user_metadata.name as string)
            : (user.email ?? "Atendente");
      }
    }
  }

  return (
    <div className="h-[calc(100dvh-3.5rem)] overflow-hidden">
      <InboxClient
        clinicId={active.clinicId}
        viewerId={context.userId}
        authorNames={authorNames}
        initialConversations={conversations}
        hasWhatsappAccount={accountResult.data !== null}
      />
    </div>
  );
}
