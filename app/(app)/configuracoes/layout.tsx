import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { can } from "@/lib/domain/permissions";

// Guarda de modulo (matriz da secao 5 do brief): recepcao, profissional e
// leitura tem acesso "nada" em Configuracoes, entao o modulo nem abre (e ja
// nao aparece no rail). Gestor entra e edita, menos o que envolve
// administrador (decisao do dono em 25/08/2026).
export default async function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getSessionContext();
  if (!context) {
    redirect("/login");
  }
  const role = context.active?.role;
  if (!role || can(role, "configuracoes") === "nada") {
    redirect("/inicio");
  }
  return children;
}
