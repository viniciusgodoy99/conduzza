import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";

// Guarda do Painel geral (onda 1, decisao do dono de 20/10/2026): so a
// equipe Conduzza (super admin, product_admin) abre a rota, qualquer que
// seja o papel na clinica ativa; os demais vao para o Inicio (o item do
// menu ja nao aparece para eles). Esconder a tela nao protege nada: cada
// Server Action confere de novo e as RPCs do painel recusam (42501) quem
// nao e is_product_admin().
export default async function PainelGeralLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getSessionContext();
  if (!context) {
    redirect("/login");
  }
  if (!context.isProductAdmin) {
    redirect("/inicio");
  }
  return children;
}
