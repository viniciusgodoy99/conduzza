import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
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
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ agendar?: string }>;
}) {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  const hoje = diaCivil(active.timezone, new Date());

  // Deep link do Inbox e da ficha: /agenda?agendar=<contactId> abre o modal
  // com o paciente ja escolhido (o modal resolve nome e telefone sozinho;
  // a RLS recorta a clinica). Padrao do /espera?adicionar=.
  const { agendar } = await searchParams;
  const agendarContato =
    agendar &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      agendar,
    )
      ? agendar
      : null;

  // Regra 3.1: abrir a agenda mostra nome de paciente (dado de saude); a
  // leitura vai para a trilha (com throttle no helper). Sem await: nao
  // atrasa a tela.
  void auditarLeituraDePaciente(supabase, {
    clinicId: active.clinicId,
    userId: context.userId,
    entity: "agenda_dia",
  });

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
    <div className="h-[calc(100dvh-3.5rem)] overflow-hidden print:hidden">
      <AgendaClient
        clinicId={active.clinicId}
        timezone={active.timezone}
        viewerId={context.userId}
        diaInicial={hoje}
        agendarContato={agendarContato}
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
        papelProfissionalSemVinculo={
          active.role === "profissional" &&
          !((membroProfissional.data?.professional_id as string | null) ?? null)
        }
      />
    </div>
  );
}
