import { redirect } from "next/navigation";

import { AvisoCelular } from "@/components/shared/aviso-celular";
import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { fetchLeads } from "@/lib/queries/leads";
import { fetchClinicAuthorNames } from "@/lib/queries/profiles";
import { createClient } from "@/lib/supabase/server";

import { LeadsClient } from "./leads-client";

// Tela 4, Leads: funil da clinica em Kanban e lista, carga inicial no
// servidor e interatividade, filtros e tempo real no cliente. A RLS recorta
// os dados por clinica; a matriz de papeis decide quem edita.
export default async function LeadsPage() {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();

  // Regra 3.1: a tela mostra nome e telefone de paciente (dado sensivel); a
  // leitura vai para a trilha, com throttle no helper. Sem await: nao atrasa
  // a renderizacao.
  void auditarLeituraDePaciente(supabase, {
    clinicId: active.clinicId,
    userId: context.userId,
    entity: "leads",
  });

  const [leads, membros] = await Promise.all([
    fetchLeads(supabase, active.clinicId),
    fetchClinicAuthorNames(supabase, active.clinicId),
  ]);

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Leads"
        description="Quem chegou e ainda não agendou, do primeiro contato ao comparecimento"
      />
      <AvisoCelular />
      <LeadsClient
        clinicId={active.clinicId}
        timezone={active.timezone}
        leadsIniciais={leads}
        membros={membros}
        podeEditar={canEdit(active.role, "leads_pacientes")}
        dica={
          permissionHint(active.role, "leads_pacientes") ??
          "Seu perfil não pode editar leads e pacientes"
        }
      />
    </div>
  );
}
