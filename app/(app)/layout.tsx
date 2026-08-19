import { redirect } from "next/navigation";

import { QueryProvider } from "@/components/providers/query-provider";
import { AppShell } from "@/components/shell/app-shell";
import { WhatsappBanner } from "@/components/shell/whatsapp-banner";
import { ROLE_LABELS, getSessionContext } from "@/lib/auth/active-clinic";
import { createClient } from "@/lib/supabase/server";

// Layout da area logada: exige sessao e clinica ativa validada em
// clinic_member (tarefa 0.5). O isolamento de dados e da RLS; aqui so se
// decide o que renderizar e para onde mandar quem nao pode ver.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getSessionContext();
  if (!context) {
    redirect("/login");
  }

  if (context.memberships.length === 0) {
    // Dono do produto sem vinculo de clinica: shell minimo ate a Tela 14 (5.5).
    if (context.isProductAdmin) {
      return (
        <AppShell
          viewer={{
            name: context.userName,
            role: "admin",
            roleLabel: "Dono do produto",
            clinicName: "Administração do produto",
            productName: "Conduzza Clínicas",
          }}
        >
          {children}
        </AppShell>
      );
    }
    return (
      <main className="grid min-h-dvh place-items-center p-8">
        <div className="grid max-w-md gap-2 rounded-lg border bg-card p-6 text-center">
          <h1 className="text-[15px] font-semibold">Sem clínica vinculada</h1>
          <p className="text-sm text-text-secondary">
            Seu usuário ainda não pertence a nenhuma clínica. Peça o convite ao
            administrador.
          </p>
        </div>
      </main>
    );
  }

  const active = context.active;
  if (!active) {
    redirect("/selecionar-clinica");
  }

  // Faixa de WhatsApp desconectado (estado 5 da secao 8 do brief): so quando
  // a clinica tem conta e ela nao esta conectada.
  const supabase = await createClient();
  const { data: whatsappAccount } = await supabase
    .from("whatsapp_account")
    .select("connection_status")
    .eq("clinic_id", active.clinicId)
    .maybeSingle();
  const banner =
    whatsappAccount && whatsappAccount.connection_status !== "conectado" ? (
      <WhatsappBanner />
    ) : null;

  // Badge do rail: conversas aguardando um humano (fonte real, sem inventar).
  const { count: aguardandoHumano } = await supabase
    .from("conversation")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", active.clinicId)
    .eq("status", "aguardando_humano");

  return (
    <AppShell
      viewer={{
        name: context.userName,
        role: active.role,
        roleLabel: ROLE_LABELS[active.role],
        clinicName: active.clinicName,
        productName: active.productName,
      }}
      canSwitchClinic={context.memberships.length > 1}
      labels={active.labels}
      banner={banner}
      counts={{ conversas: aguardandoHumano ?? 0 }}
    >
      <QueryProvider>{children}</QueryProvider>
    </AppShell>
  );
}
