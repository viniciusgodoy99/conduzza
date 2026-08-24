import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { fetchCatalogo } from "@/lib/queries/catalogo";
import { createClient } from "@/lib/supabase/server";

import { CadastrosClient } from "./cadastros-client";

// Tela 8, Cadastros (tarefa 2.2): as oito abas do catalogo clinico. Escrita
// so de administrador e gestor; recepcao e demais papeis VEEM tudo, com as
// acoes visiveis e desabilitadas com dica (nunca escondidas).
export default async function CadastrosPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  const catalogo = await fetchCatalogo(supabase, active.clinicId);
  const { aba } = await searchParams;

  const podeEditar = canEdit(active.role, "cadastros");
  const dica = permissionHint(active.role, "cadastros");

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Cadastros"
        description="Profissionais, procedimentos, convênios e a matriz de vínculos da clínica"
      />
      <CadastrosClient
        clinicId={active.clinicId}
        catalogoInicial={catalogo}
        abaInicial={aba}
        podeEditar={podeEditar}
        dica={dica ?? "Seu perfil não altera os cadastros"}
        timezone={active.timezone}
      />
    </div>
  );
}
