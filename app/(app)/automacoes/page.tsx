import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import {
  lerPoliticaDeEnvio,
  type NumerosDasAutomaticas,
} from "@/components/automacoes/numeros-de-envio";
import { AvisoCelular } from "@/components/shared/aviso-celular";
import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { canEdit, permissionHint } from "@/lib/domain/permissions";
import { NAV_GROUPS } from "@/lib/navigation";
import {
  fetchExcecoesDeConfirmacao,
  fetchFollowups,
  fetchVolumesDaEstimativa,
} from "@/lib/queries/automacoes";
import { fetchJornada } from "@/lib/queries/jornada";
import { fetchReguasDaClinica } from "@/lib/queries/confirmacoes";
import { fetchNumerosDaClinica } from "@/lib/queries/conversations";
import { createClient } from "@/lib/supabase/server";

import { AutomacoesClient } from "./automacoes-client";

// Os numeros ATIVOS e a politica das mensagens automaticas (varios numeros
// por clinica, docs/07, Fase 4), pela SESSAO: todo membro ativo le as duas
// tabelas (RLS). Falha de leitura vira null, e o cartao mostra o erro sem
// derrubar a tela inteira: as reguas nao dependem disto.
async function fetchNumerosDasAutomaticas(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<NumerosDasAutomaticas | null> {
  try {
    const [numeros, politica] = await Promise.all([
      fetchNumerosDaClinica(supabase, clinicId),
      supabase
        .from("whatsapp_envio_automatico")
        .select("modo, conta_fixa_id")
        .eq("clinic_id", clinicId)
        .maybeSingle(),
    ]);
    if (politica.error) {
      return null;
    }
    return {
      numeros,
      politica: lerPoliticaDeEnvio(
        politica.data as { modo: unknown; conta_fixa_id: unknown } | null,
        numeros,
      ),
    };
  } catch {
    return null;
  }
}

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
  const [reguas, volumes, excecoes, followups, jornada, numeros] =
    await Promise.all([
      fetchReguasDaClinica(supabase, active.clinicId),
      fetchVolumesDaEstimativa(supabase, active.clinicId),
      fetchExcecoesDeConfirmacao(supabase, active.clinicId),
      fetchFollowups(supabase, active.clinicId),
      fetchJornada(supabase, active.clinicId),
      fetchNumerosDasAutomaticas(supabase, active.clinicId),
    ]);
  const { aba } = await searchParams;

  return (
    <div className="mx-auto grid w-full max-w-content content-start gap-4 p-6">
      <PageHeader
        eyebrow={NAV_GROUPS.inteligencia ?? undefined}
        title="Automações"
        description="As mensagens que saem sozinhas: o que dizem, quando saem e para quem."
      />
      {/* Tela pensada para computador (brief secao 6): no celular, o aviso. */}
      <AvisoCelular />
      <AutomacoesClient
        clinicId={active.clinicId}
        nomeDaClinica={active.clinicName}
        abaInicial={aba}
        reguasIniciais={reguas}
        excecoesIniciais={excecoes}
        followupsIniciais={followups}
        etapasParaFollowup={jornada
          .filter((etapa) => etapa.papel !== "perdido")
          .map((etapa) => ({ chave: etapa.chave, nome: etapa.nome }))}
        volumes={volumes}
        numeros={numeros}
        podeEditar={canEdit(active.role, "automacoes")}
        dicaSemPermissao={
          permissionHint(active.role, "automacoes") ??
          "Somente administradores e gestores alteram as automações"
        }
        ehAdministrador={active.role === "admin"}
      />
    </div>
  );
}
