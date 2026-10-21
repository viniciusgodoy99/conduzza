import { notFound } from "next/navigation";

import {
  DetalheDaClinica,
  VoltarParaOPainel,
} from "@/components/painel-geral/detalhe-da-clinica";
import { ErroDoPainel } from "@/components/painel-geral/erro-do-painel";
import { publicoDosRequisitos } from "@/components/painel-geral/painel-geral";
import { versaoDoFiltroDoTurno } from "@/lib/agente/whatsapp";
import { ambienteDaIaLigado } from "@/lib/ia/liberacao";
import { modeloDoAgente } from "@/lib/integrations/llm/openai";
import { fetchLiberacaoDaIa } from "@/lib/queries/ia-liberacao";
import {
  fetchClinicaDoPainel,
  fetchRequisitosDaProducao,
  fetchTetosDaIa,
} from "@/lib/queries/painel-geral";
import { createClient } from "@/lib/supabase/server";

// Detalhe de uma clinica no Painel geral (onda 1, decisao do dono de
// 20/10/2026), so para a equipe Conduzza (a guarda e o layout da rota). Aqui
// so se le; o desenho e o DetalheDaClinica (components/painel-geral).
//
// A linha da clinica vem do painel (painel_geral_das_clinicas, obrigatoria:
// sem ela, o estado de erro com "Tentar de novo"; fora do painel, o
// not-found). As leituras do agente (a liberacao, os numeros ligados, os
// telefones da equipe e a situacao) sao as mesmas da aba WhatsApp da Tela
// 6, com a sessao: o super admin le pelas policies proprias, sem ser membro
// da clinica. Cada uma que falha tira so o cartao que dependia dela. Nenhuma
// le dado de paciente. Do ambiente, so T1 (ambienteDaIaLigado): a clinica
// estar habilitada sai da propria linha do painel.
//
// Onda 2 (item 11): os requisitos da producao (requisitos_da_producao, so
// do super admin, com o registro da equipe Conduzza no detalhe; antes da
// migration da producao, "indisponivel"), o publico da ultima versao
// publicada (o dialogo da producao diz a quem o agente passa a responder;
// vem do requisito publico_escolhido, o mesmo que o banco confere, e e nulo
// sem a leitura), os telefones forcados (o dialogo de excluir) e as versoes
// de agora do filtro e do modelo (P11e: o aviso quando a rodada do CFM
// registrada fala de outra versao).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** O valor da leitura, ou "erro" quando ela lancou. */
async function ouErro<T>(promessa: Promise<T>): Promise<T | "erro"> {
  try {
    return await promessa;
  } catch {
    return "erro";
  }
}

/** Os ids dos telefones forcados da clinica. Nulo: a leitura falhou. */
async function lerTelefonesForcados(
  supabase: Supabase,
  clinicId: string,
): Promise<string[] | null> {
  try {
    const { data, error } = await supabase
      .from("ia_contato_liberado")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("forcado", true);
    return error
      ? null
      : ((data ?? []) as { id: string }[]).map((linha) => linha.id);
  } catch {
    return null;
  }
}

/**
 * As versoes de agora (P11e): a do filtro (as quatro camadas da
 * conformidade, a mesma que vai em ai_decision_log.versao_filtro) e o
 * modelo do agente pelo ambiente. Nulas se algo falhar: o cartao so nao
 * avisa.
 */
function versoesDeAgora(): { filtro: string; modelo: string } | null {
  try {
    const modelo = modeloDoAgente();
    return modelo ? { filtro: versaoDoFiltroDoTurno(), modelo } : null;
  } catch {
    return null;
  }
}

export default async function DetalheDaClinicaNoPainelPage({
  params,
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const { clinicId } = await params;
  if (!UUID.test(clinicId)) {
    notFound();
  }

  const supabase = await createClient();
  const [clinica, dados, tetos, requisitos, forcados] = await Promise.all([
    ouErro(fetchClinicaDoPainel(supabase, clinicId)),
    ouErro(fetchLiberacaoDaIa(supabase, clinicId)),
    ouErro(fetchTetosDaIa(supabase, clinicId)),
    ouErro(fetchRequisitosDaProducao(supabase, clinicId)),
    lerTelefonesForcados(supabase, clinicId),
  ]);

  if (clinica === "erro") {
    return (
      <div className="mx-auto grid w-full max-w-content content-start gap-4 p-4 md:p-6">
        <VoltarParaOPainel />
        <ErroDoPainel titulo="Não foi possível carregar esta clínica" />
      </div>
    );
  }
  if (!clinica) {
    notFound();
  }

  // So o ambiente (T1) vem daqui: a parte da clinica (agente habilitado e
  // conta ativa) sai da propria linha do painel (agenteAtendeNoAmbiente).
  return (
    <DetalheDaClinica
      clinica={clinica}
      dados={dados}
      tetos={tetos}
      ambienteDaIa={ambienteDaIaLigado()}
      agoraMs={Date.now()}
      requisitos={requisitos}
      publicoPublicado={publicoDosRequisitos(requisitos)}
      telefonesForcados={forcados}
      versoes={versoesDeAgora()}
    />
  );
}
