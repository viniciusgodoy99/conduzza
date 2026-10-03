import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { log } from "@/lib/log";
import {
  fetchAtividadesDaClinica,
  fetchEquipeDaAtividade,
} from "@/lib/queries/atividades";
import { createClient } from "@/lib/supabase/server";

import { AtividadesClient } from "./atividades-client";

// Tela Atividades (escopo acrescentado em 02/10/2026): os lembretes da
// equipe sobre leads e pacientes, com Minhas e Todas, situacao, responsavel
// e busca na URL (o Inicio abre a tela ja filtrada). Carga inicial no
// servidor com a trilha de leitura (regra 3.1: o texto da atividade e dado de
// paciente e pode ser dado de saude); os filtros rodam no cliente sobre a
// mesma lista, como em Leads. Matriz de Leads e Pacientes: todos veem;
// admin, gestor e recepcao criam e concluem.
export default async function AtividadesPage() {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  const agora = new Date();

  // A trilha entra no MESMO Promise.all da carga (como na ficha): as duas
  // comecam juntas e a linha existe antes de o texto sair do servidor.
  // Falha de leitura nao derruba a tela nem vira lista vazia: o cliente
  // mostra o erro com "Tentar de novo". O log leva so a clinica e o tipo,
  // nunca texto de atividade.
  const [lista, equipe] = await Promise.all([
    fetchAtividadesDaClinica(
      supabase,
      active.clinicId,
      active.timezone,
      agora,
    ).catch(() => {
      log.error("atividades_lista_falhou", {
        clinic_id: active.clinicId,
        kind: "lista",
      });
      return null;
    }),
    fetchEquipeDaAtividade(supabase, active.clinicId, context.userId).catch(
      () => null,
    ),
    auditarLeituraDePaciente(supabase, {
      clinicId: active.clinicId,
      userId: context.userId,
      entity: "atividades",
    }),
  ]);

  return (
    <AtividadesClient
      clinicId={active.clinicId}
      timezone={active.timezone}
      eu={context.userId}
      listaInicial={lista}
      equipeInicial={equipe}
      agoraInicial={agora.toISOString()}
      podeEditar={canEdit(active.role, "leads_pacientes")}
      dica={
        permissionHint(active.role, "leads_pacientes") ??
        "Seu perfil não pode alterar atividades"
      }
    />
  );
}
