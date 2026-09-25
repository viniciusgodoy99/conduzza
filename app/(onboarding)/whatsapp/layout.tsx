import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getSessionContext } from "@/lib/auth/active-clinic";

// Onboarding do WhatsApp: fora do shell principal, foco total na conexao.
// Coluna unica de 560px (brief, Tela 13), sem logo: a volta leva ao
// Atendimento. O assistente de 4 etapas e do canal oficial (atras de
// isOfficialChannel) e nao existe no pareamento por QR.
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
      <div className="mx-auto grid w-full max-w-[560px] content-start gap-6 px-4 pt-10 pb-16">
        <Button asChild variant="ghost" className="-ml-3 h-10 w-fit">
          <Link href="/atendimento">
            <ArrowLeft className="size-4" />
            Voltar para o Atendimento
          </Link>
        </Button>
        {children}
      </div>
    </main>
  );
}
