import { redirect } from "next/navigation";

import { AvisoCelular } from "@/components/shared/aviso-celular";
import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { fetchCatalogo, fetchUsoDosPacotes } from "@/lib/queries/catalogo";
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
  // O uso dos pacotes e um detalhe de uma aba: se falhar, a tela carrega o
  // resto e a aba Pacotes tenta de novo no navegador (e mostra o erro se
  // continuar falhando), em vez de derrubar Cadastros inteiro.
  const [catalogo, usoDosPacotes] = await Promise.all([
    fetchCatalogo(supabase, active.clinicId),
    fetchUsoDosPacotes(supabase, active.clinicId).catch(() => null),
  ]);
  const { aba } = await searchParams;

  const podeEditar = canEdit(active.role, "cadastros");
  const dica = permissionHint(active.role, "cadastros");

  return (
    <div className="mx-auto grid w-full max-w-content content-start gap-4 p-6">
      <PageHeader
        eyebrow="Administração"
        title="Cadastros"
        description="Profissionais, procedimentos, convênios e a matriz de vínculos da clínica"
      />
      {/* Tela de computador (brief secao 6): no celular so avisa, nada trava */}
      <AvisoCelular />
      <CadastrosClient
        clinicId={active.clinicId}
        catalogoInicial={catalogo}
        usoDosPacotesInicial={usoDosPacotes}
        abaInicial={aba}
        podeEditar={podeEditar}
        dica={dica ?? "Seu perfil não altera os cadastros"}
        timezone={active.timezone}
      />
    </div>
  );
}
