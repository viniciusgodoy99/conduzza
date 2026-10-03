import { TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";

import { AvisoCelular } from "@/components/shared/aviso-celular";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth/active-clinic";
import { createT } from "@/lib/branding/labels";
import { diaCivil, somarDias } from "@/lib/domain/horarios";
import { fetchConversoesDevolvidas } from "@/lib/queries/conversoes-meta";
import {
  fetchAgendaDoPeriodo,
  fetchAtendimentoDoPeriodo,
  fetchCampanhasDoPeriodo,
  fetchFaturamentoDoPeriodo,
  fetchFunilDoPeriodo,
  fetchLinhaDeBase,
  fetchObjetivoDeConversao,
  fetchSerieDiariaDoPeriodo,
} from "@/lib/queries/relatorios";
import { createClient } from "@/lib/supabase/server";

import { RelatoriosClient } from "./relatorios-client";
import { VisaoDoProfissional } from "./visao-do-profissional";

// Tela 11, Relatorios (Modulo 10): de qual canal vem o paciente que
// comparece, agora com periodo livre (?de=&ate=, dias civis da clinica),
// comparacao contra o periodo anterior e exportacao. So contagens agregadas,
// nenhum nome ou telefone de paciente, entao nao ha leitura a auditar; a
// EXPORTACAO, essa sim, grava trilha antes do download (action propria).
//
// Fase 3: 4 vistas (Visao geral, Marketing, Comercial, Agente de IA). Os
// valores em reais sao so de admin e gestor, decidido AQUI no servidor: para
// os outros papeis o faturamento nem e buscado (e o banco devolveria null).
//
// Fase 4: campanhas_do_periodo e buscada para todo papel que chega aqui (as
// contagens de leads por campanha sao de todos); o investimento da Meta vem
// null do banco para quem nao e admin nem gestor, e a tela nem olha para ele
// sem podeVerValores.

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Casca do design system (docs/06 secao 5.9). A tela inteira some na
// impressao: o que imprime e o layout proprio da exportacao.
const CONTEINER =
  "mx-auto grid w-full max-w-content content-start gap-4 p-6 print:hidden";

/**
 * A clinica tem algum numero no canal OFICIAL da Meta. Hoje so o provedor
 * cloud_api tem isOfficialChannel (lib/integrations/whatsapp/provider.ts), e
 * a fabrica ainda recusa instancia-lo; por isso a pergunta e feita pelo nome
 * do provedor gravado na conta. Sem canal oficial, custo por mensagem nao
 * aparece na tela (regra 3.3).
 */
async function temCanalOficial(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("whatsapp_account")
    .select("provider")
    .eq("clinic_id", clinicId)
    .is("removido_em", null);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).some((conta) => conta.provider === "cloud_api");
}

/** "26/08/26 a 24/09/26" (nunca meia-risca entre as datas). */
function rotuloDoRecorte(diaDe: string, diaAte: string): string {
  const curto = (dia: string) => {
    const [ano, mes, diaDoMes] = dia.split("-");
    return `${diaDoMes}/${mes}/${ano?.slice(2)}`;
  };
  return `${curto(diaDe)} a ${curto(diaAte)}`;
}

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
    const { data: membro, error: erroDeVinculo } = await supabaseProfissional
      .from("clinic_member")
      .select("professional_id")
      .eq("clinic_id", active.clinicId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (erroDeVinculo) {
      // Leitura que DECIDE a visao: erro vira erro, nunca o estado falso
      // "seu perfil nao esta ligado a agenda" (achado da revisao de 18/09).
      throw new Error(erroDeVinculo.message);
    }
    const professionalId = (membro?.professional_id ?? null) as string | null;

    if (!professionalId) {
      return (
        <div className={CONTEINER}>
          <AvisoCelular />
          <PageHeader
            title="Resultados"
            description="Os resultados dos seus atendimentos."
          />
          <Card>
            <EmptyState
              icon={TrendingUp}
              title="Seu perfil ainda não está ligado à agenda"
              description="Peça para a administração vincular o seu usuário a um profissional da agenda. Depois disso, os seus resultados aparecem aqui."
            />
          </Card>
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
      <div className={CONTEINER}>
        <AvisoCelular />
        <PageHeader
          eyebrow="Últimos 30 dias"
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

  // Matriz de papeis da Fase 3: reais (faturamento, receita das
  // recuperadas, custo) e o objetivo de conversao sao de admin e gestor.
  const podeVerValores = active.role === "admin" || active.role === "gestor";

  const supabase = await createClient();
  const [
    funil,
    agenda,
    atendimento,
    serie,
    faturamento,
    conversoes,
    linhaDeBase,
    objetivo,
    canalOficial,
    campanhas,
  ] = await Promise.all([
    fetchFunilDoPeriodo(
      supabase,
      active.clinicId,
      active.timezone,
      diaDe,
      diaAte,
    ),
    fetchAgendaDoPeriodo(
      supabase,
      active.clinicId,
      active.timezone,
      diaDe,
      diaAte,
    ),
    fetchAtendimentoDoPeriodo(
      supabase,
      active.clinicId,
      active.timezone,
      diaDe,
      diaAte,
    ),
    fetchSerieDiariaDoPeriodo(
      supabase,
      active.clinicId,
      active.timezone,
      diaDe,
      diaAte,
    ),
    podeVerValores
      ? fetchFaturamentoDoPeriodo(
          supabase,
          active.clinicId,
          active.timezone,
          diaDe,
          diaAte,
        )
      : Promise.resolve(undefined),
    fetchConversoesDevolvidas(supabase, active.clinicId),
    fetchLinhaDeBase(supabase, active.clinicId),
    fetchObjetivoDeConversao(supabase, active.clinicId),
    temCanalOficial(supabase, active.clinicId),
    // Bloco com estado proprio: se falhar aqui, o cliente busca de novo e
    // mostra o erro so no Custo por lead e em Campanhas, com "Tentar de
    // novo", em vez de derrubar a tela inteira.
    fetchCampanhasDoPeriodo(
      supabase,
      active.clinicId,
      active.timezone,
      diaDe,
      diaAte,
    ).catch(() => undefined),
  ]);

  const recortePadrao = diaDe === diaDePadrao && diaAte === diaAtePadrao;

  return (
    <div className={CONTEINER}>
      <AvisoCelular />
      <PageHeader
        eyebrow={
          recortePadrao ? "Últimos 30 dias" : rotuloDoRecorte(diaDe, diaAte)
        }
        title="Resultados"
        description={`De qual canal vem o ${t("paciente")}, quanto agenda e quanto comparece.`}
      />
      <RelatoriosClient
        clinicId={active.clinicId}
        timezone={active.timezone}
        ehAdmin={active.role === "admin"}
        podeVerValores={podeVerValores}
        podeDefinirObjetivo={podeVerValores}
        canalOficial={canalOficial}
        abaInicial={aba}
        diaDeInicial={diaDe}
        diaAteInicial={diaAte}
        diaDePadrao={diaDePadrao}
        diaAtePadrao={diaAtePadrao}
        funilInicial={funil}
        agendaInicial={agenda}
        atendimentoInicial={atendimento}
        serieInicial={serie}
        faturamentoInicial={faturamento}
        campanhasInicial={campanhas}
        conversoes={conversoes}
        linhaDeBaseInicial={linhaDeBase}
        objetivoInicial={objetivo}
      />
    </div>
  );
}
