import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { diaCivil } from "@/lib/domain/horarios";
import { fetchAgendaDia, fetchPendencias } from "@/lib/queries/agenda";
import { fetchCatalogo } from "@/lib/queries/catalogo";
import { createClient } from "@/lib/supabase/server";

import { AgendaClient } from "./agenda-client";

// Tela 3, Agenda (tarefas 2.5 a 2.7): carga inicial no servidor (o dia de
// hoje NO FUSO DA CLINICA), interatividade e tempo real no cliente. O papel
// 'profissional' recebe o proprio professional_id e a tela trava na coluna
// dele (a RLS ja recorta os dados; isto e so a experiencia).
export default async function AgendaPage() {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  const hoje = diaCivil(active.timezone, new Date());

  const [catalogo, dia, pendencias, membroProfissional] = await Promise.all([
    fetchCatalogo(supabase, active.clinicId),
    fetchAgendaDia(supabase, active.clinicId, hoje, active.timezone),
    fetchPendencias(supabase, active.clinicId),
    active.role === "profissional"
      ? supabase
          .from("clinic_member")
          .select("professional_id")
          .eq("clinic_id", active.clinicId)
          .eq("user_id", context.userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="h-[calc(100dvh-3.5rem)] overflow-hidden">
      <AgendaClient
        clinicId={active.clinicId}
        timezone={active.timezone}
        viewerId={context.userId}
        diaInicial={hoje}
        catalogoInicial={catalogo}
        diaInicialDados={dia}
        pendenciasIniciais={pendencias}
        podeEditar={canEdit(active.role, "agenda")}
        dica={
          permissionHint(active.role, "agenda") ??
          "Seu perfil só consulta a agenda"
        }
        ownProfessionalId={
          (membroProfissional.data?.professional_id as string | null) ?? null
        }
      />
    </div>
  );
}
