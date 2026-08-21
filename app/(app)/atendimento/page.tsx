import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { fetchClinicAuthorNames } from "@/lib/queries/profiles";
import { fetchConversations } from "@/lib/queries/conversations";
import { createClient } from "@/lib/supabase/server";

import { InboxClient } from "./inbox-client";

// Tela 1, Atendimento: carga inicial no servidor (sessao do usuario, RLS
// aplica) e interatividade no cliente. O mapa de nomes vem da tabela profile
// por join indexado (antes era admin.listUsers do projeto inteiro, que
// quebrava a partir de ~100 usuarios).
export default async function AtendimentoPage() {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  const [conversations, accountResult, authorNames] = await Promise.all([
    fetchConversations(supabase, active.clinicId),
    supabase
      .from("whatsapp_account")
      .select("connection_status")
      .eq("clinic_id", active.clinicId)
      .maybeSingle(),
    fetchClinicAuthorNames(supabase, active.clinicId),
  ]);

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
