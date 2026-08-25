import { PageHeader } from "@/components/shared/page-header";
import { ConnectClient } from "@/components/whatsapp/connect-client";
import type { ConnectState } from "@/lib/actions/whatsapp-connect";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { createClient } from "@/lib/supabase/server";

// Tela 13 reformulada para o canal atual: conexao do numero por pareamento
// (QR code), status ao vivo e desconexao. O assistente da Meta (verificacao
// de empresa, templates) volta quando o canal oficial for ativado.
//
// Esta rota e o onboarding de primeiro acesso; o mesmo painel aparece na aba
// de WhatsApp das Configuracoes, pelo componente compartilhado.
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

  const podeConectar = active ? canEdit(active.role, "configuracoes") : false;
  const dica = active ? permissionHint(active.role, "configuracoes") : null;

  // Sem linha de whatsapp_account ainda, o provedor e o do ambiente: assumir
  // "fake" faria a clinica em producao ver o aviso de demonstracao.
  const providerName =
    (account?.provider as string | undefined) ??
    process.env.WHATSAPP_PROVIDER ??
    "fake";

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Conexão do WhatsApp"
        description={`O número que atende os pacientes de ${active?.clinicName ?? "sua clínica"}`}
      />
      <ConnectClient
        initial={initial}
        connectedAt={account?.connected_at ?? null}
        canManage={podeConectar}
        hint={dica}
        providerName={providerName}
      />
    </div>
  );
}
