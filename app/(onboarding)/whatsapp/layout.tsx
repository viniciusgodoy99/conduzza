import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";

// Onboarding do WhatsApp: fora do shell principal, foco total na conexao.
export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getSessionContext();
  if (!context) {
    redirect("/login");
  }
  if (!context.active) {
    redirect("/selecionar-clinica");
  }
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto grid max-w-xl gap-6 p-6 pt-10">
        <Link
          href="/atendimento"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-text-secondary hover:text-foreground"
        >
          <ArrowLeft strokeWidth={1.5} className="size-4" />
          Voltar para o Atendimento
        </Link>
        {children}
      </div>
    </main>
  );
}
