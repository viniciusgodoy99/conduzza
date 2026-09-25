import { ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";

import { pickClinicAction } from "@/app/(auth)/actions";
import { SairDaConta } from "@/components/shell/sair-da-conta";
import { ROLE_LABELS, getSessionContext } from "@/lib/auth/active-clinic";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Selecao de clinica para quem pertence a mais de uma (docs/06 secao 5.13:
// cartoes com iniciais em lime suave, nome, papel e seta).
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
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <h1 className="text-[24px] leading-[1.2] font-bold tracking-[-0.02em]">
          Escolha a clínica
        </h1>
        <p className="text-[13.5px] text-text-secondary">
          Você tem acesso a mais de uma operação. Em qual vai trabalhar agora?
        </p>
      </div>
      <div className="grid gap-2.5">
        {ativos.map((membership) => (
          <form key={membership.clinicId} action={pickClinicAction}>
            <input type="hidden" name="clinicId" value={membership.clinicId} />
            <button
              type="submit"
              className="flex min-h-14 w-full items-center gap-3 rounded-card border border-border bg-card p-3 pr-4 text-left shadow-sm cz-transition hover:-translate-y-px hover:shadow-md motion-reduce:transform-none"
            >
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-text"
              >
                {initialsOf(membership.clinicName)}
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-bold text-text-strong">
                  {membership.clinicName}
                </span>
                <span className="text-xs text-text-secondary">
                  {ROLE_LABELS[membership.role]}
                </span>
              </span>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-text-secondary"
              />
            </button>
          </form>
        ))}
      </div>
      {/* Sair, e nao "Voltar" para /login: o login devolve quem tem sessao
          para a area logada, que manda de volta para ca (laco sem saida). */}
      <SairDaConta
        email={context.userEmail}
        className="justify-items-start border-t border-border pt-4"
      />
    </div>
  );
}
