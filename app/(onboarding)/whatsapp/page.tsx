import { AvisoCelular } from "@/components/shared/aviso-celular";
import { PageHeader } from "@/components/shared/page-header";
import { ConnectClient } from "@/components/whatsapp/connect-client";
import type { ConnectState } from "@/lib/actions/whatsapp-connect";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { provedorDoAmbiente } from "@/lib/integrations/whatsapp/provider";
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

  // Os numeros ATIVOS da clinica; o cartao e o do principal (docs/07, Fase
  // 2). Sem numero nenhum, o cartao abre sem id e Conectar cria o principal.
  const supabase = await createClient();
  const { data: numeros, error: erroDaConta } = await supabase
    .from("whatsapp_account")
    .select(
      "id, nome, principal, connection_status, display_phone, connected_at, provider",
    )
    .eq("clinic_id", active?.clinicId ?? "")
    .is("removido_em", null)
    .order("principal", { ascending: false })
    .order("created_at", { ascending: true });
  const account =
    (numeros ?? []).find((numero) => numero.principal) ??
    (numeros ?? [])[0] ??
    null;

  const initial: ConnectState = {
    status:
      (account?.connection_status as ConnectState["status"]) ?? "desconectado",
    qrCode: null,
    displayPhone: account?.display_phone ?? null,
    // Leitura que falhou nao pode parecer "desconectado" sem explicacao.
    ...(erroDaConta
      ? {
          error:
            "Não foi possível carregar a situação da conexão. Clique em Verificar agora.",
        }
      : {}),
  };

  const podeConectar = active ? canEdit(active.role, "configuracoes") : false;
  const dica = active ? permissionHint(active.role, "configuracoes") : null;

  // Sem linha de whatsapp_account ainda, o provedor e o do AMBIENTE, pela
  // mesma regra que cria a conta (achado 30): fora de producao, sem
  // configuracao, e o fake; em producao sem provedor real vem nulo e a tela
  // avisa que o canal nao esta configurado, em vez de prometer demonstracao.
  const providerName =
    (account?.provider as string | undefined) ?? provedorDoAmbiente();

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Conexão do WhatsApp"
        description={`O número que atende os pacientes de ${active?.clinicName ?? "sua clínica"}`}
      />
      {/* O QR se le com o celular: aberta no proprio celular, a tela nao tem
          como ser escaneada. */}
      <AvisoCelular />
      <ConnectClient
        accountId={account?.id ?? null}
        nome={account?.nome ?? null}
        initial={initial}
        connectedAt={account?.connected_at ?? null}
        canManage={podeConectar}
        hint={dica}
        providerName={providerName}
        timezone={active?.timezone ?? "America/Fortaleza"}
      />
    </div>
  );
}
