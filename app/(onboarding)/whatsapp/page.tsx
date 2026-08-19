import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { createClient } from "@/lib/supabase/server";

import { ConnectClient } from "./connect-client";
import type { ConnectState } from "./actions";

// Tela 13 reformulada para o canal atual: conexao do numero por pareamento
// (QR code), status ao vivo e desconexao. O assistente da Meta (verificacao
// de empresa, templates) volta quando o canal oficial for ativado.
export default async function WhatsAppOnboardingPage() {
  const context = await getSessionContext();
  const active = context?.active;

  const supabase = await createClient();
  const { data: account } = await supabase
    .from("whatsapp_account")
    .select("connection_status, display_phone, connected_at, provider")
    .eq("clinic_id", active?.clinicId ?? "")
    .maybeSingle();

  const initial: ConnectState = {
    status:
      (account?.connection_status as ConnectState["status"]) ?? "desconectado",
    qrCode: null,
    displayPhone: account?.display_phone ?? null,
  };

  const isAdmin = active?.role === "admin";

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Conexão do WhatsApp"
        description={`O número que atende os pacientes de ${active?.clinicName ?? "sua clínica"}`}
      />
      <ConnectClient
        initial={initial}
        connectedAt={account?.connected_at ?? null}
        canManage={isAdmin}
        providerName={(account?.provider as string) ?? "fake"}
      />
    </div>
  );
}
