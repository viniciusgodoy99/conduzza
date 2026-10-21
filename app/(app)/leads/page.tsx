import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { podeExportarLeads } from "@/lib/domain/exportacao-de-leads";
import {
  dicaParaIniciarConversa,
  podeIniciarConversa,
} from "@/lib/domain/iniciar-conversa";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { fetchEtiquetasDeConversa } from "@/lib/queries/etiquetas-de-conversa";
import { fetchJornada } from "@/lib/queries/jornada";
import {
  fetchLeads,
  fetchMapaDeAtribuicao,
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

  // O total, as reguas, o mapa de campanhas e as etiquetas cadastradas sao
  // acessorios: se falharem, a tela abre sem eles e o cliente tenta de novo
  // (o aviso de corte some; o Mudar etapa pede confirmacao dizendo que nao
  // conseguiu conferir as reguas; o filtro de campanha espera o mapa; os
  // chips de etiqueta saem neutros e o Etiquetar lead fica com as em uso).
  const [leads, membros, ativos, jornada, total, reguas, mapa, etiquetas] =
    await Promise.all([
      fetchLeads(supabase, active.clinicId),
      fetchClinicAuthorNames(supabase, active.clinicId),
      fetchResponsaveisAtivos(supabase, active.clinicId),
      fetchJornada(supabase, active.clinicId),
      fetchTotalDeLeads(supabase, active.clinicId).catch(() => null),
      fetchReguasDeFollowup(supabase, active.clinicId).catch(() => null),
      fetchMapaDeAtribuicao(supabase, active.clinicId).catch(() => null),
      fetchEtiquetasDeConversa(supabase, active.clinicId).catch(() => null),
    ]);

  return (
    <LeadsClient
      clinicId={active.clinicId}
      timezone={active.timezone}
      leadsIniciais={leads}
      totalInicial={total}
      reguasIniciais={reguas}
      mapaInicial={mapa}
      jornada={jornada}
      membros={membros}
      responsaveisAtivos={ativos}
      podeEditar={canEdit(active.role, "leads_pacientes")}
      dica={
        permissionHint(active.role, "leads_pacientes") ??
        "Seu perfil não pode editar leads e pacientes"
      }
      // Exportar e so de administrador e gestor (decisao do dono em
      // 20/10/2026), e o Implementador nao exporta (P18-6, onda 5); a rota
      // confere o papel de novo no servidor.
      podeExportar={podeExportarLeads(active.role, active.implementador)}
      // "Agendar" do drawer respeita a permissao do modulo DE DESTINO: sem
      // ela, a Agenda nao abre o modal do link (achados 6 e 22).
      podeAgendar={canEdit(active.role, "agenda")}
      dicaAgendar={
        permissionHint(active.role, "agenda") ??
        "Seu perfil não pode alterar a agenda"
      }
      // "Iniciar conversa" (20/10/2026): manda a primeira mensagem, entao
      // pede Atendimento e Leads editaveis; a Server Action confere de novo.
      podeIniciarConversa={podeIniciarConversa(active.role)}
      dicaIniciarConversa={dicaParaIniciarConversa(active.role) ?? ""}
      // Profissional so le as conversas atribuidas a ele (RLS de
      // conversation): o drawer diz isso em vez de afirmar que nao ha
      // conversa (achado 7), como a ficha faz.
      soAtribuidas={active.role === "profissional"}
      etiquetasIniciais={etiquetas}
    />
  );
}
