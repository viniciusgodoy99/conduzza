import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { fetchVolumesDaEstimativa } from "@/lib/queries/automacoes";
import { fetchReguasDaClinica } from "@/lib/queries/confirmacoes";
import { createClient } from "@/lib/supabase/server";

import { AutomacoesClient } from "./automacoes-client";

// Tela 7, Automacoes (tarefa 4.8): onde a clinica edita as reguas. Sem
// auditarLeituraDePaciente de proposito: a tela mostra configuracao e
// contagens agregadas, nenhum dado identificado de paciente.
export default async function AutomacoesPage({
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
  const [reguas, volumes] = await Promise.all([
    fetchReguasDaClinica(supabase, active.clinicId),
    fetchVolumesDaEstimativa(supabase, active.clinicId),
  ]);
  const { aba } = await searchParams;

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Automações"
        description="As mensagens que saem sozinhas: o que dizem, quando saem e para quem."
      />
      <AutomacoesClient
        clinicId={active.clinicId}
        nomeDaClinica={active.clinicName}
        abaInicial={aba}
        reguasIniciais={reguas}
        volumes={volumes}
        podeEditar={canEdit(active.role, "automacoes")}
        dicaSemPermissao={
          permissionHint(active.role, "automacoes") ??
          "Somente administradores e gestores alteram as automações"
        }
      />
    </div>
  );
}
