import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { can } from "@/lib/domain/permissions";

// Guarda de modulo do Agente de IA (matriz da secao 5 do brief): profissional
// e leitura tem acesso "nada", entao a tela nem abre (e o item ja nao
// aparece no rail); recepcao entra e ve tudo desabilitado, com a dica.
// Mesmo padrao de configuracoes/layout.tsx. O super admin (equipe Conduzza)
// entra com qualquer papel: ele edita tudo (decisao do dono de 06/10/2026).
// Esconder a tela nao protege nada: a RLS e as Server Actions conferem de
// novo.
export default async function AgenteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getSessionContext();
  if (!context) {
    redirect("/login");
  }
  const role = context.active?.role;
  if (!role || (can(role, "agente") === "nada" && !context.isProductAdmin)) {
    redirect("/inicio");
  }
  return children;
}
