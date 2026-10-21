import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { can } from "@/lib/domain/permissions";

// Guarda de modulo de Automacoes (matriz da secao 5 do brief): profissional
// e leitura tem acesso "nada", entao a tela nem abre (e o item ja nao
// aparece no rail); recepcao entra e ve as reguas desabilitadas, com a dica;
// administrador e gestor entram e editam. Mesmo padrao de
// configuracoes/layout.tsx. Ate 20/10/2026 a rota nao tinha guarda: so o
// menu escondia o item, e profissional e leitura abriam /automacoes pela URL
// (achado do levantamento da onda 4).
//
// A aba "Automacoes de fluxo" tem regra propria, mais estreita (so
// administrador e gestor, decisao do dono de 20/10/2026): a pagina decide no
// servidor se ela existe, e cada Server Action confere o papel de novo.
// Esconder a tela nao protege nada: a RLS e as Server Actions conferem.
export default async function AutomacoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getSessionContext();
  if (!context) {
    redirect("/login");
  }
  const role = context.active?.role;
  if (!role || can(role, "automacoes") === "nada") {
    redirect("/inicio");
  }
  return children;
}
