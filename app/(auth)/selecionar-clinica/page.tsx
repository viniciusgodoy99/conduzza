import { redirect } from "next/navigation";

import { pickClinicAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, getSessionContext } from "@/lib/auth/active-clinic";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Selecao de clinica para quem pertence a mais de uma (estilo do handoff:
// cartoes com avatar de iniciais, nome e papel).
export default async function SelecionarClinicaPage() {
  const context = await getSessionContext();
  if (!context) {
    redirect("/login");
  }

  // SO vinculos ativos entram na escolha: oferecer uma clinica pendente
  // levaria a pessoa para uma tela de espera sem explicacao.
  const ativos = context.memberships.filter(
    (membership) => membership.status === "ativo",
  );

  // Com menos de duas clinicas ativas nao ha o que escolher. Mandar de volta
  // para /login criaria laco (o login devolve para ca quando ha sessao sem
  // clinica ativa); quem decide o que mostrar e o layout da area logada.
  if (ativos.length < 2) {
    redirect("/inicio");
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h1 className="text-[22px] font-semibold">Escolha a clínica</h1>
        <p className="text-sm text-text-secondary">
          Você tem acesso a mais de uma operação. Em qual vai trabalhar agora?
        </p>
      </div>
      <div className="grid gap-2">
        {ativos.map((membership) => (
          <form key={membership.clinicId} action={pickClinicAction}>
            <input type="hidden" name="clinicId" value={membership.clinicId} />
            <button
              type="submit"
              className="border-border-strong flex w-full items-center gap-3 rounded-[11px] border bg-card p-3 text-left transition-colors hover:border-primary"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {initialsOf(membership.clinicName)}
              </span>
              <span className="grid min-w-0">
                <span className="truncate text-sm font-medium">
                  {membership.clinicName}
                </span>
                <span className="text-xs text-text-tertiary">
                  {ROLE_LABELS[membership.role]}
                </span>
              </span>
            </button>
          </form>
        ))}
      </div>
      <Button variant="ghost" asChild className="justify-self-start">
        <a href="/login">Voltar</a>
      </Button>
    </div>
  );
}
