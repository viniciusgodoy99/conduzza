import { redirect } from "next/navigation";

import { AvisoCelular } from "@/components/shared/aviso-celular";
import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { auditarLeituraDePaciente } from "@/lib/auth/read-audit";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import {
  fetchConfigDaEspera,
  fetchFilaDeEspera,
  fetchMetricasDaEspera,
  fetchOfertasEmAndamento,
} from "@/lib/queries/espera";
import { createClient } from "@/lib/supabase/server";

import { EsperaClient } from "./espera-client";

// Tela 10, Lista de espera (tarefa 4.9). A fila mostra nome e telefone de
// paciente: a leitura humana vai para a trilha (regra 3.1), com a entidade
// que read-audit ja declarava para esta tela.
export default async function EsperaPage({
  searchParams,
}: {
  searchParams: Promise<{ adicionar?: string }>;
}) {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const supabase = await createClient();
  void auditarLeituraDePaciente(supabase, {
    clinicId: active.clinicId,
    userId: context.userId,
    entity: "lista_espera",
  });

  const { adicionar } = await searchParams;
  const [
    fila,
    ofertas,
    metricas,
    config,
    procedimentos,
    profissionais,
    contatoParaAdicionar,
  ] = await Promise.all([
    fetchFilaDeEspera(supabase, active.clinicId),
    fetchOfertasEmAndamento(supabase, active.clinicId),
    fetchMetricasDaEspera(supabase, active.clinicId),
    fetchConfigDaEspera(supabase, active.clinicId),
    supabase
      .from("procedure")
      .select("id, name")
      .eq("clinic_id", active.clinicId)
      .eq("active", true)
      .order("name"),
    supabase
      .from("professional")
      .select("id, name")
      .eq("clinic_id", active.clinicId)
      .eq("active", true)
      .order("name"),
    adicionar
      ? supabase
          .from("contact")
          .select("id, name, phone_e164")
          .eq("clinic_id", active.clinicId)
          .eq("id", adicionar)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const contatoInicial = contatoParaAdicionar.data
    ? {
        id: contatoParaAdicionar.data.id as string,
        nome:
          (contatoParaAdicionar.data.name as string | null) ??
          (contatoParaAdicionar.data.phone_e164 as string),
        telefone: contatoParaAdicionar.data.phone_e164 as string,
      }
    : null;

  // Registrar a autorizacao de mensagens a partir do modal e a mesma acao da
  // ficha (concederConsentimentoAction), guardada pela chave de leads e
  // pacientes: a permissao vem resolvida daqui, com a dica do mesmo modulo.
  const podeRegistrarAutorizacao = canEdit(active.role, "leads_pacientes");

  return (
    <div className="flex flex-col gap-3.5 p-6">
      <PageHeader
        title="Lista de espera"
        description="Quem espera por um horário e a reoferta automática quando uma vaga abre."
      />
      <AvisoCelular />
      <EsperaClient
        clinicId={active.clinicId}
        timezone={active.timezone}
        ehAdmin={active.role === "admin"}
        podeEditar={canEdit(active.role, "confirmacoes_espera")}
        dicaSemPermissao={
          "Seu perfil vê a lista de espera, sem alterar (quem altera é a recepção e a gestão)"
        }
        podeRegistrarAutorizacao={podeRegistrarAutorizacao}
        dicaAutorizacao={
          permissionHint(active.role, "leads_pacientes") ??
          "Seu perfil não pode editar leads e pacientes"
        }
        filaInicial={fila}
        ofertasIniciais={ofertas}
        metricasIniciais={metricas}
        config={config}
        procedimentos={
          (procedimentos.data ?? []) as { id: string; name: string }[]
        }
        profissionais={
          (profissionais.data ?? []) as { id: string; name: string }[]
        }
        contatoParaAdicionar={contatoInicial}
      />
    </div>
  );
}
