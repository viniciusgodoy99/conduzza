import { TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { createT } from "@/lib/branding/labels";
import { diaCivil, somarDias } from "@/lib/domain/horarios";
import { fetchConversoesDevolvidas } from "@/lib/queries/conversoes-meta";
import {
  fetchAgendaDoPeriodo,
  fetchAtendimentoDoPeriodo,
  fetchFunilDoPeriodo,
  fetchLinhaDeBase,
} from "@/lib/queries/relatorios";
import { createClient } from "@/lib/supabase/server";

import { RelatoriosClient } from "./relatorios-client";
import { VisaoDoProfissional } from "./visao-do-profissional";

// Tela 11, Relatorios (Modulo 10): de qual canal vem o paciente que
// comparece, agora com periodo livre (?de=&ate=, dias civis da clinica),
// comparacao contra o periodo anterior e exportacao. So contagens agregadas,
// nenhum nome ou telefone de paciente, entao nao ha leitura a auditar; a
// EXPORTACAO, essa sim, grava trilha antes do download (action propria).

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ResultadosPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; de?: string; ate?: string }>;
}) {
  const context = await getSessionContext();
  const active = context?.active;
  if (!context || !active) {
    redirect("/inicio");
  }

  const t = createT(active.labels);

  // Periodo padrao: ultimos 30 dias civis no fuso da clinica, incluindo hoje.
  const diaAtePadrao = diaCivil(active.timezone, new Date());
  const diaDePadrao = somarDias(diaAtePadrao, -29);

  // Matriz de papeis (brief secao 5): profissional ve "so os proprios". A
  // visao dele e a dos proprios atendimentos, com recorte explicito; a RPC
  // no banco recusa qualquer agregado da clinica para o papel.
  if (active.role === "profissional") {
    const supabaseProfissional = await createClient();
    const { data: membro } = await supabaseProfissional
      .from("clinic_member")
      .select("professional_id")
      .eq("clinic_id", active.clinicId)
      .eq("user_id", context.userId)
      .maybeSingle();
    const professionalId = membro?.professional_id as string | null;

    if (!professionalId) {
      return (
        <div className="grid gap-6 p-6">
          <PageHeader
            title="Resultados"
            description="Os resultados dos seus atendimentos."
          />
          <EmptyState
            icon={TrendingUp}
            title="Seu perfil ainda não está ligado à agenda"
            description="Peça para a administração vincular o seu usuário a um profissional da agenda. Depois disso, os seus resultados aparecem aqui."
          />
        </div>
      );
    }

    const agendaPropria = await fetchAgendaDoPeriodo(
      supabaseProfissional,
      active.clinicId,
      active.timezone,
      diaDePadrao,
      diaAtePadrao,
      { professionalId },
    );
    return (
      <div className="grid gap-6 p-6">
        <PageHeader
          title="Resultados"
          description="Os resultados dos seus atendimentos."
        />
        <VisaoDoProfissional agenda={agendaPropria} />
      </div>
    );
  }

  const { aba, de, ate } = await searchParams;
  const recorteValido =
    de !== undefined &&
    ate !== undefined &&
    DIA_RE.test(de) &&
    DIA_RE.test(ate) &&
    de <= ate;
  const diaDe = recorteValido ? de : diaDePadrao;
  const diaAte = recorteValido ? ate : diaAtePadrao;

  const supabase = await createClient();
  const [funil, agenda, atendimento, conversoes, linhaDeBase] =
    await Promise.all([
      fetchFunilDoPeriodo(supabase, active.clinicId, active.timezone, diaDe, diaAte),
      fetchAgendaDoPeriodo(supabase, active.clinicId, active.timezone, diaDe, diaAte),
      fetchAtendimentoDoPeriodo(supabase, active.clinicId, active.timezone, diaDe, diaAte),
      fetchConversoesDevolvidas(supabase, active.clinicId),
      fetchLinhaDeBase(supabase, active.clinicId),
    ]);

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="Resultados"
        description={`De qual canal vem o ${t("paciente")} que comparece.`}
      />
      <RelatoriosClient
        clinicId={active.clinicId}
        timezone={active.timezone}
        ehAdmin={active.role === "admin"}
        abaInicial={aba}
        diaDeInicial={diaDe}
        diaAteInicial={diaAte}
        diaDePadrao={diaDePadrao}
        diaAtePadrao={diaAtePadrao}
        funilInicial={funil}
        agendaInicial={agenda}
        atendimentoInicial={atendimento}
        conversoes={conversoes}
        linhaDeBaseInicial={linhaDeBase}
      />
    </div>
  );
}
