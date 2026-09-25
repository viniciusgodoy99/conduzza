import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { fetchJornada } from "@/lib/queries/jornada";
import {
  fetchLeads,
  fetchReguasDeFollowup,
  fetchTotalDeLeads,
} from "@/lib/queries/leads";
import {
  fetchClinicAuthorNames,
  fetchResponsaveisAtivos,
} from "@/lib/queries/profiles";
import { createClient } from "@/lib/supabase/server";

import { LeadsClient } from "./leads-client";

// Tela 4, Leads: funil da clinica em Kanban e lista, carga inicial no
// servidor e interatividade, filtros e tempo real no cliente. A RLS recorta
// os dados por clinica; a matriz de papeis decide quem edita. O cabecalho e o
// aviso de celular moram no cliente, para as acoes da tela ficarem no slot
// direito do PageHeader (docs/06 secao 5.4).
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

  // O total e as reguas sao acessorios: se falharem, a tela abre sem eles e
  // o cliente tenta de novo (o aviso de corte some; o Mudar etapa pede
  // confirmacao dizendo que nao conseguiu conferir as reguas).
  const [leads, membros, ativos, jornada, total, reguas] = await Promise.all([
    fetchLeads(supabase, active.clinicId),
    fetchClinicAuthorNames(supabase, active.clinicId),
    fetchResponsaveisAtivos(supabase, active.clinicId),
    fetchJornada(supabase, active.clinicId),
    fetchTotalDeLeads(supabase, active.clinicId).catch(() => null),
    fetchReguasDeFollowup(supabase, active.clinicId).catch(() => null),
  ]);

  return (
    <LeadsClient
      clinicId={active.clinicId}
      timezone={active.timezone}
      leadsIniciais={leads}
      totalInicial={total}
      reguasIniciais={reguas}
      jornada={jornada}
      membros={membros}
      responsaveisAtivos={ativos}
      podeEditar={canEdit(active.role, "leads_pacientes")}
      dica={
        permissionHint(active.role, "leads_pacientes") ??
        "Seu perfil não pode editar leads e pacientes"
      }
      // "Agendar" do drawer respeita a permissao do modulo DE DESTINO: sem
      // ela, a Agenda nao abre o modal do link (achados 6 e 22).
      podeAgendar={canEdit(active.role, "agenda")}
      dicaAgendar={
        permissionHint(active.role, "agenda") ??
        "Seu perfil não pode alterar a agenda"
      }
      // Profissional so le as conversas atribuidas a ele (RLS de
      // conversation): o drawer diz isso em vez de afirmar que nao ha
      // conversa (achado 7), como a ficha faz.
      soAtribuidas={active.role === "profissional"}
    />
  );
}
