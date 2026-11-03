import { OctagonAlert } from "lucide-react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { QueryProvider } from "@/components/providers/query-provider";
import { BotaoRecarregar } from "@/components/shell/botao-recarregar";
import { EstadoDeTela, TelaSemShell } from "@/components/shell/estado-de-tela";
import { SairDaConta } from "@/components/shell/sair-da-conta";
import { ShellDaEquipe } from "@/components/shell/shell-da-equipe";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { entradaNaAreaDaEquipe } from "@/lib/auth/area-da-equipe";
import { COOKIE_DO_RAIL, preferenciaDoRail } from "@/lib/navigation";

// A area do super admin (decisao do dono de 03/11/2026, "Conta propria so
// para o painel"): o Painel geral fora da clinica, com o menu proprio
// (components/shell/shell-da-equipe.tsx). Nao exige clinica ativa: a conta
// do painel nao e membro de clinica nenhuma. As URLs sao as de antes
// (/painel-geral e /painel-geral/{id da clinica}).
//
// A guarda (lib/auth/area-da-equipe.ts): sem sessao, o login; leitura da
// sessao que falhou, "Seu acesso nao carregou" (sem a leitura nao da para
// saber se a pessoa e da equipe Conduzza); quem nao e super admin, o Inicio.
// Esta e a primeira camada: cada Server Action do painel confere o super
// admin de novo, a rota de exportar tem a guarda propria (o layout nao vale
// para Route Handler) e as funcoes do banco recusam (42501) quem nao e
// is_product_admin().
export default async function AreaDaEquipeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getSessionContext();
  if (!context) {
    redirect("/login");
  }

  const entrada = entradaNaAreaDaEquipe(context);
  if (entrada.destino === "login") {
    redirect("/login");
  }
  if (entrada.destino === "inicio") {
    redirect("/inicio");
  }
  if (entrada.destino === "indisponivel") {
    return (
      <TelaSemShell>
        <EstadoDeTela
          emCartao
          icone={OctagonAlert}
          tom="alerta"
          titulo="Seu acesso não carregou"
          descricao={
            <p>
              Houve uma falha ao consultar o acesso desta conta. Nada foi
              alterado: tente de novo em instantes.
            </p>
          }
        >
          <BotaoRecarregar rotulo="Tentar de novo" />
          <SairDaConta
            email={context.userEmail}
            className="mt-2 w-full border-t border-border pt-4"
          />
        </EstadoDeTela>
      </TelaSemShell>
    );
  }

  const cookieStore = await cookies();
  return (
    <ShellDaEquipe
      email={context.userEmail}
      nome={context.userName}
      abrirClinica={entrada.abrirClinica}
      preferenciaDoRail={preferenciaDoRail(
        cookieStore.get(COOKIE_DO_RAIL)?.value,
      )}
    >
      <QueryProvider>{children}</QueryProvider>
    </ShellDaEquipe>
  );
}
